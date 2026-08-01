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
    ) -> list[dict[str, Any]]:
        """Escalation Task shapes per docs/CONTRACTS.md §4.  The controller's
        post-call pass links each to the Encounter as it writes them.

        The description must be self-sufficient for a caregiver reading it at
        11pm: what was said, when, and what has already happened — never a
        bare "urgent".
        """
        tasks: list[dict[str, Any]] = []
        for escalation in self._escalations:
            actions = list(escalation.actions_taken) or [
                "the companion addressed the concern directly during the call",
                "the care team was notified when the concern was raised",
            ]
            description = (
                f"During the Juniper check-in call on {escalation.noted_at_iso}, "
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
            tasks.append(task)
        return tasks
