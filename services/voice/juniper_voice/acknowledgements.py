"""Family-side alert acknowledgements — an app-level store, deliberately NOT FHIR.

An escalation ``Task`` (docs/CONTRACTS.md §4) is addressed to the **care team**:
``owner`` is a CareTeam participant and ``status`` tracks what a clinician has
done about the concern.  A caregiver tapping "I've seen this" must therefore
never touch ``Task.status`` — flipping it to ``completed`` would tell every
other reader that a clinician acted, which is a clinical falsehood written by
the least-qualified reader.  The caregiver AccessPolicy is read-only on ``Task``
anyway, so the client could not do it even if the UI tried.

What a caregiver *does* need is somewhere to record "I have read this and I am
not going to be surprised by it at 11pm again."  That is a family-side fact
about a family-side reader, so it lives here, next to call windows and
topics-to-avoid, for exactly the same reason those do: FHIR has no home for it
and inventing one would put non-clinical state into the clinical record.

Wire shape (both directions), keyed per patient:

.. code-block:: json

    {"acknowledgements": [
       {"taskId": "abc", "acknowledgedAt": "2026-08-01T23:10:00Z",
        "acknowledgedBy": "RelatedPerson/xyz"}
    ]}

PUT **replaces** the set rather than merging it.  That is what makes "undo"
possible — a caregiver who taps acknowledge by accident at 11pm must be able to
put the alert back in front of themselves, and a merge-only store cannot
express removal.  The cost is last-writer-wins between two caregivers editing
at the same second, which is the cheaper failure of the two.
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, field_validator


class AlertAcknowledgement(BaseModel):
    """One caregiver's acknowledgement of one escalation Task."""

    taskId: str
    """The FHIR Task id (not a reference) — the join key back to the alert."""

    acknowledgedAt: str
    """ISO8601 timestamp, supplied by the client that acknowledged."""

    acknowledgedBy: str | None = None
    """Profile reference of the caregiver, e.g. ``RelatedPerson/<id>``.  Optional
    because the store must stay honest about what it was actually told; a
    missing value means "someone on this patient's care circle", not "nobody"."""

    @field_validator("taskId", "acknowledgedAt")
    @classmethod
    def _non_empty(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be empty")
        return value


class AlertAcknowledgements(BaseModel):
    acknowledgements: list[AlertAcknowledgement] = Field(default_factory=list)

    @field_validator("acknowledgements")
    @classmethod
    def _one_per_task(
        cls, value: list[AlertAcknowledgement]
    ) -> list[AlertAcknowledgement]:
        """Collapse duplicates by taskId, last write winning.

        Two tabs open on the same alert is an ordinary thing to do; storing the
        same taskId twice would make "is this acknowledged?" ambiguous for every
        later reader.
        """
        merged: dict[str, AlertAcknowledgement] = {}
        for entry in value:
            merged[entry.taskId] = entry
        return list(merged.values())


class AlertAcknowledgementStore:
    """JSON-file-backed store keyed by patient id.

    Same shape and same guarantees as :class:`~juniper_voice.preferences.PreferencesStore`
    (atomic replace, process-local lock); path is env-configurable via
    ``JUNIPER_ALERT_ACKNOWLEDGEMENTS_PATH``.
    """

    def __init__(self, path: str | os.PathLike[str]):
        self._path = Path(path)
        self._lock = threading.Lock()

    def _load_all(self) -> dict[str, Any]:
        if not self._path.exists():
            return {}
        with open(self._path, "r", encoding="utf-8") as fh:
            return json.load(fh)

    def _save_all(self, data: dict[str, Any]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, sort_keys=True)
        os.replace(tmp, self._path)

    def get(self, patient_id: str) -> AlertAcknowledgements:
        with self._lock:
            raw = self._load_all().get(patient_id)
        if raw is None:
            return AlertAcknowledgements()
        return AlertAcknowledgements.model_validate(raw)

    def put(
        self,
        patient_id: str,
        acknowledgements: AlertAcknowledgements | dict[str, Any],
    ) -> AlertAcknowledgements:
        if not isinstance(acknowledgements, AlertAcknowledgements):
            acknowledgements = AlertAcknowledgements.model_validate(acknowledgements)
        with self._lock:
            data = self._load_all()
            data[patient_id] = acknowledgements.model_dump(exclude_none=True)
            self._save_all(data)
        return acknowledgements
