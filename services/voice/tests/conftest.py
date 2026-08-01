"""Shared fixtures: FakeProvider, fake clock, in-memory Medplum stub, and the
transcript fixture loader.  Everything runs offline — zero network."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping

import pytest

from juniper_voice.controller import (
    ControllerSettings,
    ConversationController,
    Phase,
)
from juniper_voice.escalation import EscalationSink
from juniper_voice.llm.provider import FakeProvider, ModelRoster
from juniper_voice.medplum import ConsentStatus, EHRBrief
from juniper_voice.preferences import PreferencesStore
from juniper_voice.terminology import get_terminology
from juniper_voice.transcript import TranscriptBuffer

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "transcripts"

# Canned filter responses -----------------------------------------------------
URGENCY_OK = '{"urgent": false, "category": "other", "summary": "", "directive": ""}'
COMPASSION_PASS = '{"pass": true, "reasons": [], "violated_constraints": []}'
FOURM_NO_OP = '{"advisory": null, "completed": []}'


def compassion_flag(*reasons: str, constraints: tuple[str, ...] = ()) -> str:
    return json.dumps(
        {"pass": False, "reasons": list(reasons), "violated_constraints": list(constraints)}
    )


def urgency_urgent(category: str, summary: str, directive: str) -> str:
    return json.dumps(
        {"urgent": True, "category": category, "summary": summary, "directive": directive}
    )


class FakeClock:
    def __init__(self, start: float = 1_000.0):
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture
def fake_clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def provider() -> FakeProvider:
    return FakeProvider()


@pytest.fixture
def terminology():
    return get_terminology()


# ---------------------------------------------------------------------------
# In-memory Medplum stub — records writes, serves canned reads
# ---------------------------------------------------------------------------

class FakeMedplum:
    def __init__(self) -> None:
        self.resources: dict[str, list[dict[str, Any]]] = {}
        self.writes: list[tuple[str, dict[str, Any]]] = []  # (op, stored resource)
        self._counter = 0

    def seed(self, resource: Mapping[str, Any]) -> dict[str, Any]:
        stored = dict(resource)
        rtype = stored["resourceType"]
        stored.setdefault("id", f"{rtype.lower()}-seed-{len(self.resources.get(rtype, []))}")
        self.resources.setdefault(rtype, []).append(stored)
        return stored

    @staticmethod
    def _subject_refs(resource: Mapping[str, Any]) -> set[str]:
        refs: set[str] = set()
        for key in ("subject", "patient", "for"):
            ref = (resource.get(key) or {}).get("reference")
            if ref:
                refs.add(ref)
        for participant in resource.get("participant", []) or []:
            ref = (participant.get("actor") or {}).get("reference")
            if ref:
                refs.add(ref)
        return refs

    @staticmethod
    def _category_codes(resource: Mapping[str, Any]) -> set[str]:
        codes: set[str] = set()
        for concept in resource.get("category", []) or []:
            for coding in concept.get("coding", []) or []:
                if coding.get("code"):
                    codes.add(coding["code"])
        return codes

    async def search(
        self, resource_type: str, params: Mapping[str, str]
    ) -> list[dict[str, Any]]:
        results = list(self.resources.get(resource_type, []))
        for key, value in params.items():
            if key in ("patient", "subject"):
                results = [r for r in results if value in self._subject_refs(r)]
            elif key == "status":
                results = [r for r in results if r.get("status") == value]
            elif key == "category":
                results = [r for r in results if value in self._category_codes(r)]
            # _sort / _count / date are handled below or ignored (stub)
        count = params.get("_count")
        if count is not None:
            results = results[: int(count)]
        return results

    async def create(self, resource: Mapping[str, Any]) -> dict[str, Any]:
        stored = dict(resource)
        self._counter += 1
        stored["id"] = f"{stored['resourceType'].lower()}-{self._counter}"
        self.resources.setdefault(stored["resourceType"], []).append(stored)
        self.writes.append(("create", stored))
        return stored

    async def transaction(self, bundle: Mapping[str, Any]) -> dict[str, Any]:
        """Mirrors real Medplum: assign every entry a real id up front, then
        substitute urn:uuid fullUrls for their resolved "Type/id" reference
        anywhere they appear — including inside plain strings like
        Attachment.url, which Medplum resolves too even though it isn't a
        typed Reference field (verified against a live project)."""
        entries = list(bundle.get("entry", []))
        id_map: dict[str, str] = {}
        for entry in entries:
            resource = entry["resource"]
            self._counter += 1
            bare_id = f"{resource['resourceType'].lower()}-{self._counter}"
            id_map[entry["fullUrl"]] = f"{resource['resourceType']}/{bare_id}"

        def resolve(value: Any) -> Any:
            if isinstance(value, str):
                return id_map.get(value, value)
            if isinstance(value, dict):
                return {k: resolve(v) for k, v in value.items()}
            if isinstance(value, list):
                return [resolve(v) for v in value]
            return value

        response_entries = []
        for entry in entries:
            resource = resolve(dict(entry["resource"]))
            resource_type, bare_id = id_map[entry["fullUrl"]].split("/", 1)
            resource["id"] = bare_id
            self.resources.setdefault(resource_type, []).append(resource)
            self.writes.append(("create", resource))
            response_entries.append({"resource": resource, "response": {"status": "201"}})

        return {
            "resourceType": "Bundle",
            "type": "transaction-response",
            "entry": response_entries,
        }

    async def read(self, resource_type: str, resource_id: str) -> dict[str, Any]:
        for resource in self.resources.get(resource_type, []):
            if resource.get("id") == resource_id:
                return resource
        raise KeyError(f"{resource_type}/{resource_id} not seeded")


@pytest.fixture
def medplum() -> FakeMedplum:
    return FakeMedplum()


def seed_consent(
    store: FakeMedplum,
    terminology,
    patient_id: str = "pat-1",
    codes: tuple[str, ...] = ("ai-calling", "call-recording", "family-sharing"),
    status: str = "active",
) -> dict[str, Any]:
    system = terminology.consent_provision_system
    return store.seed(
        {
            "resourceType": "Consent",
            "id": "consent-1",
            "status": status,
            "patient": {"reference": f"Patient/{patient_id}"},
            "performer": [{"reference": f"Patient/{patient_id}"}],
            "provision": {
                "type": "permit",
                "provision": [
                    {"type": "permit", "code": [{"coding": [{"system": system, "code": code}]}]}
                    for code in codes
                ],
            },
        }
    )


def seed_full_patient(store: FakeMedplum, terminology, patient_id: str = "pat-1") -> None:
    store.seed(
        {
            "resourceType": "Patient",
            "id": patient_id,
            "birthDate": "1941-03-22",
            "name": [
                {"family": "Wilson", "given": ["Edith"]},
                {"use": "nickname", "given": ["Edie"]},
            ],
            "telecom": [{"system": "phone", "value": "+15550001111"}],
            "communication": [{"language": {"text": "English"}}],
        }
    )
    seed_consent(store, terminology, patient_id)
    store.seed(
        {
            "resourceType": "CareTeam",
            "subject": {"reference": f"Patient/{patient_id}"},
            "participant": [
                {"member": {"reference": "RelatedPerson/daughter-1"}},
                {"member": {"reference": "Practitioner/pcp-1"}},
            ],
        }
    )
    store.seed(
        {
            "resourceType": "Condition",
            "subject": {"reference": f"Patient/{patient_id}"},
            "code": {"text": "Type 2 diabetes mellitus"},
        }
    )
    store.seed(
        {
            "resourceType": "MedicationStatement",
            "subject": {"reference": f"Patient/{patient_id}"},
            "medicationCodeableConcept": {"text": "Metformin 500mg"},
            "dosage": [{"text": "twice daily with meals"}],
        }
    )
    store.seed(
        {
            "resourceType": "AllergyIntolerance",
            "patient": {"reference": f"Patient/{patient_id}"},
            "code": {"text": "Penicillin"},
        }
    )
    store.seed(
        {
            "resourceType": "Observation",
            "subject": {"reference": f"Patient/{patient_id}"},
            "code": {"text": "Body weight"},
            "valueQuantity": {"value": 63.5, "unit": "kg"},
            "effectiveDateTime": "2026-07-20",
        }
    )
    store.seed(
        {
            "resourceType": "Encounter",
            "subject": {"reference": f"Patient/{patient_id}"},
            "class": {"code": "IMP"},
            "type": [{"text": "Hospital admission"}],
            "reasonCode": [{"text": "Pneumonia"}],
            "period": {"start": "2026-07-02", "end": "2026-07-06"},
        }
    )
    store.seed(
        {
            "resourceType": "Appointment",
            "participant": [{"actor": {"reference": f"Patient/{patient_id}"}}],
            "description": "Dr. Chen — cardiology follow-up",
            "start": "2026-08-11T10:00:00Z",
        }
    )
    store.seed(
        {
            "resourceType": "Goal",
            "subject": {"reference": f"Patient/{patient_id}"},
            "description": {"text": "Remain independent at home"},
        }
    )


# ---------------------------------------------------------------------------
# Controller factory
# ---------------------------------------------------------------------------

def make_brief(
    consent: ConsentStatus | None = None, patient_id: str = "pat-1"
) -> EHRBrief:
    consent = consent or ConsentStatus(
        ai_calling=True, recording=True, family_sharing=True, resource_id="consent-1"
    )
    text = (
        "## Patient\n- Edith Wilson (goes by \"Edie\"), born 1941-03-22\n"
        "## Medications\n- Metformin 500mg — twice daily with meals\n"
        "## Conditions\n- Type 2 diabetes mellitus"
    )
    return EHRBrief(
        text=text,
        patient_id=patient_id,
        patient_name="Edith Wilson",
        preferred_name="Edie",
        language="English",
        phone="+15550001111",
        consent=consent,
        care_team_refs=("RelatedPerson/daughter-1", "Practitioner/pcp-1"),
        prior_notes=(),
        token_estimate=40,
    )


@pytest.fixture
def make_controller(provider, fake_clock, tmp_path, terminology):
    def _make(
        *,
        consent: ConsentStatus | None = None,
        settings: ControllerSettings | None = None,
        start_phase: Phase = Phase.MAIN,
        negative_constraints: tuple[str, ...] = (),
        escalation_notifier=None,
        preferences: PreferencesStore | None = None,
        digest: str = "(no prior-call memories yet)",
    ) -> ConversationController:
        return ConversationController(
            call_id="call-1",
            patient_id="pat-1",
            provider=provider,
            roster=ModelRoster(),
            terminology=terminology,
            brief=make_brief(consent),
            digest=digest,
            negative_constraints=negative_constraints,
            preferences=preferences or PreferencesStore(tmp_path / "prefs.json"),
            escalation=EscalationSink(notifier=escalation_notifier, clock=fake_clock),
            clock=fake_clock,
            settings=settings or ControllerSettings(),
            start_phase=start_phase,
        )

    return _make


def script_benign(provider: FakeProvider) -> None:
    """Baseline scripting for an uneventful conversational turn."""
    provider.script("urgency", URGENCY_OK)
    provider.script("compassion", COMPASSION_PASS)
    provider.script("companion", "That's lovely to hear — tell me more.")
    provider.script("fourm", FOURM_NO_OP)


# ---------------------------------------------------------------------------
# Transcript fixture loader
# ---------------------------------------------------------------------------

def load_fixture(name: str) -> dict[str, Any]:
    with open(FIXTURE_DIR / f"{name}.json", "r", encoding="utf-8") as fh:
        return json.load(fh)


def all_fixture_names() -> list[str]:
    return sorted(path.stem for path in FIXTURE_DIR.glob("*.json"))


def buffer_from_fixture(fixture: Mapping[str, Any], clock=None) -> TranscriptBuffer:
    buffer = TranscriptBuffer(clock=clock or (lambda: 0.0))
    for turn in fixture["turns"]:
        buffer.append(turn["speaker"], turn["text"])
    return buffer


@pytest.fixture
def fixture_loader():
    return load_fixture
