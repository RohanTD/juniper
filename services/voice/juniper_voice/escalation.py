"""Urgent-concern sink.

When the urgency filter trips, the controller records the concern here
**immediately, mid-call** — before the post-call pass runs — and the pluggable
notifier fires.  The FHIR ``Task`` (docs/CONTRACTS.md §4) is written during
the post-call pass once the anchoring ``Encounter`` exists.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

from .terminology import Terminology

logger = logging.getLogger("juniper.escalation")


def describe_when(iso: str) -> str:
    """An ISO instant as a phrase a person can place: "on Saturday afternoon".

    ``Task.description`` is written to be read by a family member at 11pm, and
    a raw ``2026-08-01T19:24:24.664005+00:00`` in the middle of that sentence
    is noise they have to decode. The exact instant is not lost — it stays in
    ``Task.authoredOn``, which is where a machine looks for it.

    An unparseable value degrades to "recently" rather than to the raw string:
    a sentence that reads oddly is better than one with a timestamp in it, and
    both are better than raising inside the post-call pass.
    """
    try:
        moment = datetime.fromisoformat(iso)
    except (TypeError, ValueError):
        return "recently"
    hour = moment.hour
    if hour < 12:
        part = "morning"
    elif hour < 17:
        part = "afternoon"
    elif hour < 21:
        part = "evening"
    else:
        part = "night"
    return f"on {moment.strftime('%A')} {part}"


@dataclass(frozen=True)
class Escalation:
    call_id: str
    patient_id: str
    category: str
    summary: str
    utterance: str
    noted_at_iso: str
    actions_taken: tuple[str, ...] = ()


Notifier = Callable[[Escalation], None]


class EscalationSink:
    def __init__(
        self,
        notifier: Notifier | None = None,
        clock: Callable[[], float] = time.time,
    ):
        self._notifier = notifier
        self._clock = clock
        self._escalations: list[Escalation] = []

    @property
    def escalations(self) -> tuple[Escalation, ...]:
        return tuple(self._escalations)

    def record(
        self,
        *,
        call_id: str,
        patient_id: str,
        category: str,
        summary: str,
        utterance: str,
        actions_taken: tuple[str, ...] = (),
    ) -> Escalation:
        """Record and notify immediately — never waiting on the post-call pass."""
        for prior in self._escalations:
            if prior.category == category:
                # One Task per concern per call. The 19:24 call produced two
                # Tasks seventeen seconds apart for the same episode of
                # distress — a caregiver opens the dashboard to two urgent
                # alerts about one moment, and duplicate alarms are how real
                # ones get ignored. The first recording already fired the
                # notifier; the note carries the full context.
                logger.info(
                    "escalation for category=%s already recorded this call; not duplicating",
                    category,
                )
                return prior
        noted_at = datetime.fromtimestamp(self._clock(), tz=timezone.utc).isoformat()
        escalation = Escalation(
            call_id=call_id,
            patient_id=patient_id,
            category=category,
            summary=summary,
            utterance=utterance,
            noted_at_iso=noted_at,
            actions_taken=actions_taken,
        )
        self._escalations.append(escalation)
        logger.warning(
            "escalation recorded call=%s patient=%s category=%s: %s",
            call_id, patient_id, category, summary,
        )
        if self._notifier is not None:
            try:
                self._notifier(escalation)
            except Exception:  # noqa: BLE001 - a broken notifier must not sink the call
                logger.exception("escalation notifier failed")
        return escalation

    def build_tasks(
        self,
        *,
        terminology: Terminology,
        device_ref: str,
        owner_ref: str | None,
        owner_display: str | None = None,
    ) -> list[dict[str, Any]]:
        """Escalation Task shapes per docs/CONTRACTS.md §4.  The controller's
        post-call pass links each to the Encounter as it writes them.

        The description must be self-sufficient for a caregiver reading it at
        11pm: what was said, when, and what has already happened — never a
        bare "urgent".

        ``owner_display`` matters for the same reason.  The caregiver
        AccessPolicy grants neither ``CareTeam`` nor ``Practitioner``, so
        ``owner`` resolves to nothing on the family side; without the
        denormalised display the app can say an alert was routed but never to
        whom, which is the part a worried family member actually wants.
        """
        tasks: list[dict[str, Any]] = []
        for escalation in self._escalations:
            actions = list(escalation.actions_taken) or [
                "the companion addressed the concern directly during the call",
                "the care team was notified when the concern was raised",
            ]
            # "on 2026-08-01T19:24:24.664005+00:00" is a machine timestamp in a
            # sentence written for a family member reading it at 11pm. The
            # Task carries the exact instant in authoredOn, where a machine
            # wants it; the prose says "on Saturday afternoon", which is what a
            # person needs to place the event.
            description = (
                f"During the Juniper check-in call {describe_when(escalation.noted_at_iso)}, "
                f'the patient said: "{escalation.utterance}". '
                f"Assessed as {escalation.category}: {escalation.summary} "
                f"What has already happened: {'; '.join(actions)}."
            )
            task: dict[str, Any] = {
                "resourceType": "Task",
                "status": "requested",
                "intent": "order",
                "priority": "urgent",
                "code": terminology.task_category("escalation").as_codeable_concept(),
                "description": description,
                "for": {"reference": f"Patient/{escalation.patient_id}"},
                "authoredOn": escalation.noted_at_iso,
                "requester": {"reference": device_ref},
            }
            if owner_ref:
                task["owner"] = {"reference": owner_ref}
                if owner_display:
                    task["owner"]["display"] = owner_display
            tasks.append(task)
        return tasks
