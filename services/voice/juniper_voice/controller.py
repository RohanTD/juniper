"""ConversationController — deterministic, no LLM.

This is where the removed orchestrator's *accountability* lives, and keeping
it out of a prompt is the whole point.  It owns:

- the always-loaded context (EHR brief + Context Brain digest, compiled once
  pre-call — no FHIR round trips mid-call, they'd land on the latency path);
- the TranscriptBuffer (durable, append-only, source of truth);
- the phase state machine (gatekeeper -> main -> closing -> done), computed
  from slot coverage, elapsed time and fatigue signals — never by an agent;
- slot coverage with mechanical priority escalation (after N turns without
  progress the 4M advisory stops being advice and becomes a REQUIRED intent);
- turn orchestration: urgency ∥ Companion, then compassion, then emit;
- the closing turn budget (the controller enforces the stop, not the Closer);
- barge-in cancellation (wired from the start — interrupted turns must not
  leak work and cost).
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Mapping

from .agents.advisory import Advisory
from .agents.closer import CloserAgent, GapManifest, GapSlot
from .agents.companion import Companion
from .agents.fourm import FourMAgent
from .agents.gatekeeper import Gatekeeper, GatekeeperOutcome
from .escalation import EscalationSink
from .filters.compassion import CompassionFilter
from .filters.urgency import UrgencyFilter, UrgencyResult
from .latency import LatencyLog, TurnTimer
from .llm.provider import LLMProvider, ModelRoster
from .medplum import EHRBrief
from .preferences import PreferencesStore
from .terminology import Terminology
from .transcript import COMPANION, PATIENT, SYSTEM, TranscriptBuffer

logger = logging.getLogger("juniper.controller")

# Deterministic last resort when a rewrite still violates a hard prohibition:
# a bland utterance is strictly safer than one that breaks a negative
# constraint or stays condescending.
SAFE_FALLBACK_UTTERANCE = "Mm-hm — tell me more about how the rest of your week has been."


class Phase(str, Enum):
    GATEKEEPER = "gatekeeper"
    MAIN = "main"
    CLOSING = "closing"
    DONE = "done"


@dataclass
class SlotState:
    domain: str
    filled: bool = False
    confidence: float = 0.0
    findings: dict = field(default_factory=dict)
    turns_since_progress: int = 0


@dataclass(frozen=True)
class ControllerSettings:
    fourm_refresh_every: int = 3  # slow-loop cadence, in turns
    escalate_after_turns: int = 4  # N turns without progress => REQUIRED intent
    max_call_seconds: float = 720.0
    closing_turn_budget: int = 3
    fatigue_short_replies: int = 3  # consecutive short replies => fatigue
    fatigue_word_threshold: int = 4
    max_rewrites: int = 2
    transcript_window: int = 12
    confidence_threshold: float = 0.6
    gatekeeper_max_attempts: int = 3


@dataclass(frozen=True)
class UnresolvedGap:
    domain: str
    display: str
    reason: str


@dataclass(frozen=True)
class UnansweredAsk:
    domain: str
    description: str


class ConversationController:
    def __init__(
        self,
        *,
        call_id: str,
        patient_id: str,
        provider: LLMProvider,
        roster: ModelRoster,
        terminology: Terminology,
        brief: EHRBrief,
        digest: str,
        negative_constraints: tuple[str, ...],
        preferences: PreferencesStore,
        escalation: EscalationSink,
        clock: Callable[[], float] = time.monotonic,
        settings: ControllerSettings | None = None,
        start_phase: Phase = Phase.GATEKEEPER,
    ):
        self.call_id = call_id
        self.patient_id = patient_id
        self.settings = settings or ControllerSettings()
        self.terminology = terminology
        self.clock = clock

        # Always-loaded context: compiled once pre-call, held for the whole
        # conversation.  Re-fetching mid-call would land on the latency path.
        self.brief = brief
        self.digest = digest
        self.negative_constraints = negative_constraints

        self.transcript = TranscriptBuffer(clock=clock)
        self.latency = LatencyLog(clock=clock, call_id=call_id)
        self.escalation = escalation

        self.companion = Companion(
            provider, roster.companion, preferences=preferences, patient_id=patient_id
        )
        self.urgency = UrgencyFilter(provider, roster.urgency)
        self.compassion = CompassionFilter(provider, roster.compassion)
        self.gatekeeper = Gatekeeper(provider, roster.companion)
        self.fourm = FourMAgent(provider, roster.advisor, terminology)
        self.closer = CloserAgent(provider, roster.advisor)

        self.phase = start_phase
        self.coverage: dict[str, SlotState] = {
            code: SlotState(domain=code) for code in terminology.fourm_domains()
        }
        self._domain_display = {
            code: coding.display for code, coding in terminology.fourm_domains().items()
        }
        self.standing_advisory: Advisory | None = None
        self.closing_queue: list[Advisory] = []
        self.unanswered_asks: list[UnansweredAsk] = []

        self._call_started_at = clock()
        # A real wall-clock timestamp, independent of `clock` — `clock`
        # defaults to time.monotonic() (correct for elapsed-time math: turn
        # budgets, latency), which counts from an arbitrary reference point,
        # not the epoch. Feeding it into datetime.fromtimestamp() for the
        # FHIR Encounter/DocumentReference period produces a bogus date near
        # 1970 (caught live: a real call's note landed with
        # period.start == "1970-02-05...").
        self._call_started_at_wall = datetime.now(timezone.utc)
        self._turn_index = 0
        self._gatekeeper_attempts = 0
        self._closing_turns_used = 0
        self._closing_reason: str | None = None
        self._consecutive_short_replies = 0
        self._background: set[asyncio.Task] = set()
        self.hangup_requested = False
        self.urgency_turns: list[int] = []

    # ------------------------------------------------------------------
    # Turn loop
    # ------------------------------------------------------------------
    async def take_turn(self, patient_text: str) -> str:
        """The whole per-turn pipeline: record, (gatekeeper | urgency ∥
        Companion -> compassion), emit.  Cancellation (barge-in) propagates
        cleanly: in-flight subtasks are cancelled and the transcript stays
        consistent."""
        if self.phase is Phase.DONE:
            return "Take good care — goodbye now."
        self._turn_index += 1
        timer = self.latency.begin_turn(self._turn_index)
        with timer.stage("stt_finalize"):
            self.transcript.append(PATIENT, patient_text)
        try:
            if self.phase is Phase.GATEKEEPER:
                reply = await self._gatekeeper_turn(patient_text, timer)
            else:
                reply = await self._conversation_turn(patient_text, timer)
            self.transcript.append(COMPANION, reply)
        except asyncio.CancelledError:
            # Barge-in: the patient's words stay on the record; the aborted
            # reply is marked so documentation sees a consistent transcript.
            self.transcript.append(SYSTEM, "[patient interrupted; turn cancelled]")
            raise
        finally:
            timer.close()
        # Everything below happens after the reply exists — off the
        # critical path of this turn.
        self._after_emit(patient_text)
        return reply

    async def _gatekeeper_turn(self, patient_text: str, timer: TurnTimer) -> str:
        self._gatekeeper_attempts += 1
        with timer.stage("companion"):
            urgency_task = asyncio.create_task(self.urgency.classify(patient_text))
            assess_task = asyncio.create_task(
                self.gatekeeper.assess(
                    patient_text,
                    patient_name=self.brief.patient_name,
                    preferred_name=self.brief.preferred_name,
                    attempt=self._gatekeeper_attempts,
                    max_attempts=self.settings.gatekeeper_max_attempts,
                )
            )
            try:
                result = await assess_task
                concern = await urgency_task
            finally:
                _cancel_pending(assess_task, urgency_task)
        reply = result.reply
        urgency_fired = False
        if concern.urgent:
            self._on_urgency(concern, patient_text)
            urgency_fired = True
            with timer.stage("companion"):
                reply = await self.companion.compose(
                    transcript_window_text=self._window_text(),
                    digest=self.digest,
                    brief_text=self.brief.text,
                    advisory=None,
                    negative_constraints=self.negative_constraints,
                    urgency=concern,
                )
        with timer.stage("compassion"):
            reply = await self._apply_compassion(reply, urgency_fired)
        if result.end_call and not urgency_fired:
            self.phase = Phase.DONE
            self.hangup_requested = True
        elif result.outcome is GatekeeperOutcome.PATIENT_CONFIRMED or urgency_fired:
            self.phase = Phase.MAIN
        elif (
            result.outcome in (GatekeeperOutcome.FAMILY_MEMBER, GatekeeperOutcome.CONFUSED)
            and self._gatekeeper_attempts >= self.settings.gatekeeper_max_attempts
        ):
            self.phase = Phase.DONE
            self.hangup_requested = True
        return reply

    async def _conversation_turn(self, patient_text: str, timer: TurnTimer) -> str:
        advisory = self._current_advisory()
        with timer.stage("companion"):
            # Urgency runs on patient input only, so it runs in parallel with
            # the Companion and costs zero added latency on the happy path.
            urgency_task = asyncio.create_task(self.urgency.classify(patient_text))
            compose_task = asyncio.create_task(
                self.companion.compose(
                    transcript_window_text=self._window_text(),
                    digest=self.digest,
                    brief_text=self.brief.text,
                    advisory=advisory,
                    negative_constraints=self.negative_constraints,
                    closing=self.phase is Phase.CLOSING,
                )
            )
            try:
                draft = await compose_task
                concern = await urgency_task
            finally:
                _cancel_pending(compose_task, urgency_task)
            urgency_fired = concern.urgent
            if urgency_fired:
                # The trip interrupts the normal path: the escalation sink
                # fires NOW (not at post-call), and the Companion is forced to
                # address the concern rather than continue.
                self._on_urgency(concern, patient_text)
                draft = await self.companion.compose(
                    transcript_window_text=self._window_text(),
                    digest=self.digest,
                    brief_text=self.brief.text,
                    advisory=None,
                    negative_constraints=self.negative_constraints,
                    urgency=concern,
                )
        with timer.stage("compassion"):
            final = await self._apply_compassion(draft, urgency_fired)
        return final

    async def _apply_compassion(self, draft: str, urgency_fired: bool) -> str:
        verdict = await self.compassion.review(
            draft, negative_constraints=self.negative_constraints
        )
        if urgency_fired:
            # SAFETY PRECEDENCE — a code path, deliberately not a prompt:
            # urgency outranks compassion.  A compassion filter that softens
            # "that chest pain needs a call to your doctor today" is itself a
            # harm, so an urgency-driven turn is NEVER rewritten or weakened —
            # the directive ships verbatim even if flagged.
            if not verdict.passed:
                logger.info(
                    "compassion flagged an urgency-driven turn (%s); directive preserved",
                    ", ".join(verdict.reasons),
                )
            return draft
        attempts = 0
        while not verdict.passed and attempts < self.settings.max_rewrites:
            draft = await self.companion.rewrite(draft, verdict.reasons)
            verdict = await self.compassion.review(
                draft, negative_constraints=self.negative_constraints
            )
            attempts += 1
        if not verdict.passed:
            # Deterministic guarantee: never emit text that still violates a
            # hard prohibition or stays flagged after rewrites.
            logger.warning(
                "compassion still flagging after %d rewrites (%s); using safe fallback",
                attempts,
                ", ".join(verdict.reasons),
            )
            return SAFE_FALLBACK_UTTERANCE
        return draft

    def _on_urgency(self, concern: UrgencyResult, patient_text: str) -> None:
        self.urgency_turns.append(self._turn_index)
        self.escalation.record(
            call_id=self.call_id,
            patient_id=self.patient_id,
            category=concern.category,
            summary=concern.summary or patient_text,
            utterance=patient_text,
            actions_taken=(
                "the companion addressed the concern directly during the call",
                "the care team was notified the moment the concern was raised",
            ),
        )

    # ------------------------------------------------------------------
    # Advisory selection + mechanical escalation
    # ------------------------------------------------------------------
    def _current_advisory(self) -> Advisory | None:
        if self.phase is Phase.CLOSING:
            # The final budgeted turn is always the recap-and-goodbye.
            if self._closing_turns_used >= self.settings.closing_turn_budget - 1:
                return Advisory(
                    domain="closing",
                    priority="high",
                    hook="recap the visit briefly and close warmly",
                    source="controller",
                )
            if self.closing_queue:
                return self.closing_queue.pop(0)
            return Advisory(
                domain="closing",
                priority="medium",
                hook="wind down gently",
                source="controller",
            )
        advisory = self.standing_advisory
        if advisory is None:
            unfilled = self._unfilled_domains()
            if not unfilled:
                return None
            advisory = Advisory(
                domain=unfilled[0], priority="medium", hook="", source="controller"
            )
        escalated = self._with_escalation(advisory)
        if escalated is not advisory:
            self.standing_advisory = escalated
        return escalated

    def _with_escalation(self, advisory: Advisory | None) -> Advisory | None:
        """Re-derive ``required`` from controller-owned slot state.

        Escalation is the controller's, not the advisor's.  It is applied on
        every path that installs an advisory — selection *and* slow-loop
        refresh — because a refresh returning a fresh, unescalated advisory for
        a still-stalled domain would otherwise silently pull the teeth off a
        domain that has already earned them, which is the exact failure the
        mechanism exists to prevent.
        """
        if advisory is None or advisory.required:
            return advisory
        slot = self.coverage.get(advisory.domain)
        if (
            slot is None
            or slot.filled
            or slot.turns_since_progress < self.settings.escalate_after_turns
        ):
            return advisory
        # Mechanical teeth: a Companion whose identity is rapport will
        # systematically under-push on clinical extraction.  After N turns
        # with no progress, the advisory stops being advice.
        if not any(ask.domain == advisory.domain for ask in self.unanswered_asks):
            self.unanswered_asks.append(
                UnansweredAsk(
                    domain=advisory.domain,
                    description=(
                        f"'{self._domain_display.get(advisory.domain, advisory.domain)}' was "
                        "pursued repeatedly without a usable answer"
                    ),
                )
            )
        logger.info(
            "advisory for %s escalated to REQUIRED after %d turns without progress",
            advisory.domain,
            slot.turns_since_progress,
        )
        return advisory.escalated()

    def mark_domain_complete(self, domain: str, findings: Mapping, confidence: float) -> None:
        """Record a 4M domain report.  ``findings`` must be structured data —
        the shape phase-2 Goal/MedicationStatement/Observation derivation
        hangs off — never prose."""
        if not isinstance(findings, Mapping):
            raise TypeError("findings must be a structured mapping, not prose")
        slot = self.coverage.get(domain)
        if slot is None:
            raise ValueError(f"unknown 4M domain {domain!r}")
        slot.findings = dict(findings)
        slot.confidence = float(confidence)
        slot.filled = slot.confidence >= self.settings.confidence_threshold
        slot.turns_since_progress = 0
        if (
            self.standing_advisory is not None
            and self.standing_advisory.domain == domain
            and slot.filled
        ):
            self.standing_advisory = None

    def coverage_summary(self) -> str:
        lines = []
        for code, slot in self.coverage.items():
            state = f"filled (confidence {slot.confidence:.1f})" if slot.filled else "unfilled"
            lines.append(f"- {self._domain_display.get(code, code)} [{code}]: {state}")
        return "\n".join(lines)

    def _unfilled_domains(self) -> list[str]:
        return [code for code, slot in self.coverage.items() if not slot.filled]

    # ------------------------------------------------------------------
    # After-emit bookkeeping (off the critical path)
    # ------------------------------------------------------------------
    def _after_emit(self, patient_text: str) -> None:
        if self.phase is Phase.MAIN:
            active = self.standing_advisory.domain if self.standing_advisory else None
            for code, slot in self.coverage.items():
                if not slot.filled and (active is None or code == active):
                    slot.turns_since_progress += 1
        if len(patient_text.split()) < self.settings.fatigue_word_threshold:
            self._consecutive_short_replies += 1
        else:
            self._consecutive_short_replies = 0
        if self.phase is Phase.CLOSING:
            self._closing_turns_used += 1
        self._maybe_advance_phase()
        self._maybe_schedule_slow_loop()

    def _maybe_advance_phase(self) -> None:
        if self.phase is Phase.MAIN:
            elapsed = self.clock() - self._call_started_at
            fatigued = self._consecutive_short_replies >= self.settings.fatigue_short_replies
            if not self._unfilled_domains():
                self._enter_closing("coverage complete")
            elif elapsed >= self.settings.max_call_seconds:
                self._enter_closing("call ran long")
            elif fatigued:
                self._enter_closing("patient tired")
        elif self.phase is Phase.CLOSING:
            # The controller holds the stop — the Closer never does.
            if self._closing_turns_used >= self.settings.closing_turn_budget:
                self.phase = Phase.DONE
                self.hangup_requested = True

    def _enter_closing(self, reason: str) -> None:
        logger.info("entering closing phase: %s", reason)
        self.phase = Phase.CLOSING
        self._closing_reason = reason
        # The 4M advisory stands down once closing begins.
        self.standing_advisory = None
        self._spawn(self._refresh_closer(), name="closer_refresh")

    # ------------------------------------------------------------------
    # Slow loop — never on the critical path of a turn
    # ------------------------------------------------------------------
    def _maybe_schedule_slow_loop(self) -> None:
        if self.phase is not Phase.MAIN:
            return
        due = self.standing_advisory is None or (
            self._turn_index % self.settings.fourm_refresh_every == 0
        )
        if due:
            self._spawn(self._refresh_fourm(), name="fourm_refresh")

    async def _refresh_fourm(self) -> None:
        started = self.clock()
        turn = self._turn_index
        try:
            advisory = await self.fourm.refresh(
                transcript_window_text=self._window_text(),
                coverage_summary=self.coverage_summary(),
                brief_text=self.brief.text,
                digest=self.digest,
                report=self.mark_domain_complete,
            )
            if advisory is not None and self.phase is Phase.MAIN:
                slot = self.coverage.get(advisory.domain)
                if slot is not None and slot.filled:
                    advisory = None  # never chase a filled domain
            if self.phase is Phase.MAIN:
                self.standing_advisory = (
                    self._with_escalation(advisory) or self.standing_advisory
                )
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - slow loop must never sink a call
            logger.exception("4M refresh failed")
        finally:
            self.latency.record_slow_loop(turn, "fourm_refresh", self.clock() - started)

    async def _refresh_closer(self) -> None:
        started = self.clock()
        turn = self._turn_index
        try:
            manifest = self.build_gap_manifest()
            advisories = await self.closer.advise(
                manifest, transcript_window_text=self._window_text()
            )
            if self.phase is Phase.CLOSING:
                self.closing_queue = list(advisories)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("closer refresh failed")
        finally:
            self.latency.record_slow_loop(turn, "closer_refresh", self.clock() - started)

    def _spawn(self, coro, name: str) -> asyncio.Task:
        task = asyncio.create_task(coro, name=f"{self.call_id}:{name}")
        self._background.add(task)
        task.add_done_callback(self._background.discard)
        return task

    async def drain_background(self) -> None:
        """Await outstanding slow-loop work (post-call pass and tests)."""
        while self._background:
            await asyncio.gather(*list(self._background), return_exceptions=True)

    def cancel_background(self) -> None:
        for task in list(self._background):
            task.cancel()

    # ------------------------------------------------------------------
    # Gap manifest + unresolved gaps for documentation
    # ------------------------------------------------------------------
    def build_gap_manifest(self) -> GapManifest:
        unfilled: list[GapSlot] = []
        ambiguities: list[str] = []
        for code, slot in self.coverage.items():
            display = self._domain_display.get(code, code)
            if not slot.filled:
                reason = (
                    f"{display} not yet covered"
                    if slot.confidence == 0.0
                    else f"{display} only partially covered"
                )
                unfilled.append(GapSlot(domain=code, confidence=slot.confidence, reason=reason))
            elif slot.confidence < 0.8:
                ambiguities.append(
                    f"{display} answered, but a documenter would hedge "
                    f"(confidence {slot.confidence:.1f})"
                )
        return GapManifest(
            unfilled=tuple(unfilled),
            unanswered_asks=tuple(a.description for a in self.unanswered_asks),
            ambiguities=tuple(ambiguities),
        )

    def unresolved_gaps(self) -> tuple[UnresolvedGap, ...]:
        """Anything still missing when the call ends — passed to
        documentation.py and rendered explicitly in the note.  A note that is
        honestly incomplete is safe; one that reads complete because a gap
        vanished is not."""
        reason_suffix = {
            "patient tired": "patient tired, call ended early",
            "call ran long": "call reached its time limit",
        }.get(self._closing_reason or "", "call ended before it was assessed")
        gaps = []
        for code, slot in self.coverage.items():
            if not slot.filled:
                gaps.append(
                    UnresolvedGap(
                        domain=code,
                        display=self._domain_display.get(code, code),
                        reason=reason_suffix,
                    )
                )
        return tuple(gaps)

    # ------------------------------------------------------------------
    def _window_text(self) -> str:
        return self.transcript.render_window(self.settings.transcript_window)

    @property
    def call_started_at(self) -> float:
        return self._call_started_at

    @property
    def call_started_at_wall(self) -> datetime:
        return self._call_started_at_wall


def _cancel_pending(*tasks: asyncio.Task) -> None:
    for task in tasks:
        if not task.done():
            task.cancel()
