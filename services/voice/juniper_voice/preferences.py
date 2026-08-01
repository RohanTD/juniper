"""App-level preference store, per docs/CONTRACTS.md §1.

Preferences with no FHIR home (call windows, topics to avoid, proxy
provenance) live here.  The onboarding app writes them through the FastAPI
routes; the Companion updates them by voice through the same store via its
``update_call_windows`` / ``add_topic_to_avoid`` tools — which is what keeps
the onboarding app genuinely one-time.
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

# Wire format is camelCase (shared with the TS apps); the pydantic models use
# the wire names directly so both directions of the contract body match 1:1.


class CallWindow(BaseModel):
    days: list[str]
    start: str
    end: str
    timezone: str


class CompletedBy(BaseModel):
    role: Literal["patient", "proxy"]
    # proxy adds name and relationship; mirrors Consent.performer — a
    # proxy-captured record is a materially different claim and must survive.
    name: str | None = None
    relationship: str | None = None


class EnrollmentName(BaseModel):
    given: str = ""
    family: str = ""


class EnrollmentLanguage(BaseModel):
    code: str = ""
    label: str = ""


class Enrollment(BaseModel):
    """What the patient told Juniper about themselves during onboarding.

    Deliberately NOT written to ``Patient``.  The EHR's demographics belong to
    the clinic that owns the chart; a phone handed to an eighty-year-old is not
    an authority to overwrite a legal name, a date of birth, or the number the
    practice has on file.  So Juniper keeps what it was told for Juniper's own
    purposes — who to dial, what to call them, which language to speak — and
    leaves the chart alone.

    Precedence when the two disagree is decided in ``medplum.py``: operational
    fields (phone, preferred name, language) follow what the patient told us,
    identity fields (legal name, birth date) follow the chart, and a
    disagreement is *reported in the brief* rather than silently resolved —
    "the chart says one number, the patient gave another" is exactly the kind
    of thing a clinician should see.
    """

    legalName: EnrollmentName | None = None
    preferredName: str | None = None
    #: ISO ``YYYY-MM-DD``.
    birthDate: str | None = None
    #: The number Juniper dials.  Not ``Patient.telecom``.
    phone: str | None = None
    language: EnrollmentLanguage | None = None


class Preferences(BaseModel):
    callWindows: list[CallWindow] = Field(default_factory=list)
    topicsToAvoid: list[str] = Field(default_factory=list)
    #: What the patient enjoys.  The counterpart to ``topicsToAvoid``: that
    #: list is a prohibition the compassion filter enforces, this one is an
    #: invitation the Companion opens with.
    interests: list[str] = Field(default_factory=list)
    completedBy: CompletedBy | None = None
    enrollment: Enrollment | None = None


class PreferencesStore:
    """JSON-file-backed store keyed by patient id.  Path is env-configurable
    (JUNIPER_PREFERENCES_PATH)."""

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

    def get(self, patient_id: str) -> Preferences:
        with self._lock:
            raw = self._load_all().get(patient_id)
        if raw is None:
            return Preferences()
        return Preferences.model_validate(raw)

    def put(self, patient_id: str, preferences: Preferences | dict[str, Any]) -> Preferences:
        """Replace the preferences — except ``enrollment``, which is preserved
        when the body omits it.

        Every other field here is something a caller is editing on purpose, so
        replace-wins is right.  ``enrollment`` is different: it is written once
        by onboarding and thereafter merely carried, and it holds the number
        Juniper dials.  The family app's call-settings screen and the
        Companion's ``update_call_windows`` tool both PUT what they know about
        — neither has any business restating a phone number — and under strict
        replacement the first "save" from either would silently delete the only
        way to reach the patient.  A client can still change it by sending one;
        it just cannot destroy it by staying quiet.
        """
        if not isinstance(preferences, Preferences):
            preferences = Preferences.model_validate(preferences)
        with self._lock:
            data = self._load_all()
            if preferences.enrollment is None:
                existing = data.get(patient_id) or {}
                carried = existing.get("enrollment")
                if carried:
                    preferences = preferences.model_copy(
                        update={"enrollment": Enrollment.model_validate(carried)}
                    )
            data[patient_id] = preferences.model_dump(exclude_none=True)
            self._save_all(data)
        return preferences

    # -- Companion tool write paths (same store, same shape) ---------------
    def update_call_windows(self, patient_id: str, call_windows: list[dict[str, Any]]) -> Preferences:
        current = self.get(patient_id)
        current.callWindows = [CallWindow.model_validate(w) for w in call_windows]
        return self.put(patient_id, current)

    def add_topic_to_avoid(self, patient_id: str, topic: str) -> Preferences:
        current = self.get(patient_id)
        topic = topic.strip()
        if topic and topic not in current.topicsToAvoid:
            current.topicsToAvoid.append(topic)
        return self.put(patient_id, current)
