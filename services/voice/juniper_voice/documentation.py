"""The post-call pass — triggered on hangup, fully asynchronous.

Reads the **complete transcript** (never a summary — a summarizer that drops
"I've been dizzy standing up" is a patient-safety miss) and produces two
documents from the same source:

* the clinical note, and
* — only when the patient's Consent grants family-sharing — a family summary
  in plain language.  It is generated *from the transcript*, never derived
  from the clinical note: summarizing a summary compounds error, and the
  family version needs different content, not softer wording.  When consent
  is withheld it is not generated at all — not generated-then-hidden.

Unresolved gaps are rendered explicitly ("Mobility: not assessed — patient
tired, call ended early") — appended deterministically in code so an honest
gap can never be lost to model paraphrasing.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Sequence

from .context_brain import ContextBrain
from .controller import ConversationController, UnresolvedGap
from .escalation import Escalation
from .llm.provider import LLMProvider, ModelRoster
from .medplum import FHIRStore, PostCallWriteResult, write_post_call
from .terminology import Terminology

logger = logging.getLogger("juniper.documentation")

NOTE_TAG = "documentation.note"
FAMILY_TAG = "documentation.family"

_NOTE_SYSTEM = """You are writing the clinical note for a recurring Juniper 4M check-in phone call
with an elderly patient, for a clinician reader. You are given the COMPLETE conversation
transcript — base every statement on it, and only on it.

Structure the note around the 4Ms of geriatric care: What Matters, Medication, Mentation,
Mobility. Capture every clinically relevant finding the patient reported, including things
mentioned only in passing. Include distressing findings when clinically necessary — this
note is for clinicians. Note urgent concerns and that they were escalated. Be factual and
concise; hedge explicitly where the patient's answer was ambiguous. Do not invent findings.
Plain text only."""

_FAMILY_SYSTEM = """You are writing a short update for the family caregiver of an elderly patient,
based on the COMPLETE transcript of today's Juniper check-in call. Rules:

- Plain, warm, non-clinical language. No jargon, no clinical hedging ("denies acute
  distress" reads as alarming to a daughter).
- Be truthful: never state or imply anything the transcript does not support, and never
  hide that a concern was raised — but present it calmly, with what has already been done
  about it, so it informs rather than alarms.
- This is a different document for a different reader, not a softened clinical note. Focus
  on how the visit went, how their loved one seemed, and anything the family should know
  or do. A few short paragraphs, plain text only."""


@dataclass(frozen=True)
class PostCallResult:
    note_text: str
    family_summary_text: str | None
    transcript_text: str
    write_result: PostCallWriteResult | None


def _render_gaps(gaps: Sequence[UnresolvedGap]) -> str:
    if not gaps:
        return ""
    lines = ["", "NOT ASSESSED THIS CALL:"]
    lines.extend(f"- {gap.display}: not assessed — {gap.reason}" for gap in gaps)
    return "\n".join(lines)


def _render_escalations(escalations: Sequence[Escalation]) -> str:
    if not escalations:
        return ""
    lines = ["Urgent concerns raised and escalated during the call:"]
    lines.extend(
        f'- [{e.category}] "{e.utterance}" — {e.summary}' for e in escalations
    )
    return "\n".join(lines)


async def generate_clinical_note(
    provider: LLMProvider,
    model: str,
    *,
    transcript_text: str,
    gaps: Sequence[UnresolvedGap] = (),
    escalations: Sequence[Escalation] = (),
    brief_text: str = "",
) -> str:
    """Clinical note from the full transcript.  ``transcript_text`` must be
    the complete rendered transcript — this function passes it through
    verbatim, never a summary."""
    sections = [f"COMPLETE CALL TRANSCRIPT:\n{transcript_text}"]
    if brief_text:
        sections.append(f"Patient chart context:\n{brief_text}")
    escalation_block = _render_escalations(escalations)
    if escalation_block:
        sections.append(escalation_block)
    if gaps:
        gap_lines = "\n".join(f"- {g.display}: {g.reason}" for g in gaps)
        sections.append(
            "Domains the call did not manage to assess (state these explicitly in the "
            f"note):\n{gap_lines}"
        )
    response = await provider.complete(
        tag=NOTE_TAG,
        model=model,
        system=_NOTE_SYSTEM,
        messages=[{"role": "user", "content": "\n\n".join(sections)}],
        max_tokens=4000,
    )
    note = response.text.strip()
    # Deterministic guarantee: unresolved gaps are rendered explicitly even if
    # the model paraphrased them away.  Honestly incomplete is safe; silently
    # complete is not.
    return note + _render_gaps(gaps)


async def generate_family_summary(
    provider: LLMProvider,
    model: str,
    *,
    transcript_text: str,
    escalations: Sequence[Escalation] = (),
) -> str:
    """Family summary from the transcript — independent of the clinical note
    by construction: the note text is not an input here."""
    sections = [f"COMPLETE CALL TRANSCRIPT:\n{transcript_text}"]
    escalation_block = _render_escalations(escalations)
    if escalation_block:
        sections.append(
            escalation_block
            + "\nThe care team has already been notified about the above."
        )
    response = await provider.complete(
        tag=FAMILY_TAG,
        model=model,
        system=_FAMILY_SYSTEM,
        messages=[{"role": "user", "content": "\n\n".join(sections)}],
        max_tokens=2000,
    )
    return response.text.strip()


def _iso(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat()


async def run_post_call(
    *,
    controller: ConversationController,
    provider: LLMProvider,
    roster: ModelRoster,
    medplum: FHIRStore | None,
    terminology: Terminology,
    device_ref: str,
    organization_ref: str | None,
    context_brain: ContextBrain | None = None,
    call_start_iso: str | None = None,
    call_end_iso: str | None = None,
) -> PostCallResult:
    """The whole post-call pipeline: drain slow-loop work, generate documents
    from the full transcript, write the contracted FHIR resources, then update
    the Context Brain's experiential tier."""
    await controller.drain_background()

    transcript_text = controller.transcript.render()
    gaps = controller.unresolved_gaps()
    escalations = controller.escalation.escalations

    note_text = await generate_clinical_note(
        provider,
        roster.documentation,
        transcript_text=transcript_text,
        gaps=gaps,
        escalations=escalations,
        brief_text=controller.brief.text,
    )

    family_summary_text: str | None = None
    if controller.brief.consent.family_sharing:
        # Consent-gated at the source: when family-sharing is withheld the
        # summary is never generated at all — not generated-then-hidden.
        family_summary_text = await generate_family_summary(
            provider,
            roster.documentation,
            transcript_text=transcript_text,
            escalations=escalations,
        )

    write_result: PostCallWriteResult | None = None
    if medplum is not None:
        owner_ref = controller.brief.care_team_refs[0] if controller.brief.care_team_refs else None
        tasks = controller.escalation.build_tasks(
            terminology=terminology, device_ref=device_ref, owner_ref=owner_ref
        )
        start_iso = call_start_iso or _iso(controller.call_started_at)
        end_iso = call_end_iso or _iso(controller.clock())
        write_result = await write_post_call(
            medplum,
            terminology,
            patient_id=controller.patient_id,
            note_text=note_text,
            transcript_text=transcript_text,
            family_summary_text=family_summary_text,
            call_start_iso=start_iso,
            call_end_iso=end_iso,
            device_ref=device_ref,
            organization_ref=organization_ref,
            escalation_tasks=tasks,
        )

    if context_brain is not None:
        try:
            await context_brain.write_back(
                controller.patient_id,
                transcript_text,
                provider=provider,
                model=roster.documentation,
            )
        except Exception:  # noqa: BLE001 - write-back must not sink the pass
            logger.exception("context brain write-back failed")

    return PostCallResult(
        note_text=note_text,
        family_summary_text=family_summary_text,
        transcript_text=transcript_text,
        write_result=write_result,
    )
