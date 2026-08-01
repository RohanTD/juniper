"""EHR brief — the broad pre-call read, compiled once.

Asserts the four things docs/PLAN.md names: the brief refuses to dial without
consent; a seeded medication surfaces by name; a recent hospitalization and an
upcoming appointment both reach it; and it stays within its token budget for a
patient with heavy history.
"""

from __future__ import annotations

import pytest

from juniper_voice.medplum import (
    ConsentError,
    compile_ehr_brief,
    estimate_tokens,
    verify_consent,
)

from conftest import seed_consent, seed_full_patient


async def test_refuses_to_dial_without_consent(medplum, terminology):
    seed_full_patient(medplum, terminology)
    # Replace the full consent with one that grants calling but not recording.
    medplum.resources["Consent"] = []
    seed_consent(medplum, terminology, codes=("ai-calling",))

    with pytest.raises(ConsentError):
        await compile_ehr_brief(medplum, "pat-1", terminology)


async def test_refuses_to_dial_when_consent_is_absent(medplum, terminology):
    seed_full_patient(medplum, terminology)
    medplum.resources["Consent"] = []

    with pytest.raises(ConsentError):
        await compile_ehr_brief(medplum, "pat-1", terminology)


async def test_refuses_to_dial_when_consent_is_revoked(medplum, terminology):
    seed_full_patient(medplum, terminology)
    medplum.resources["Consent"] = []
    seed_consent(medplum, terminology, status="inactive")

    with pytest.raises(ConsentError):
        await compile_ehr_brief(medplum, "pat-1", terminology)


async def test_family_sharing_is_not_required_to_dial(medplum, terminology):
    """Withholding family sharing must not block the call itself — it gates
    only the family summary."""
    seed_full_patient(medplum, terminology)
    medplum.resources["Consent"] = []
    seed_consent(medplum, terminology, codes=("ai-calling", "call-recording"))

    brief = await compile_ehr_brief(medplum, "pat-1", terminology)
    assert brief.consent.may_dial is True
    assert brief.consent.family_sharing is False


async def test_component_observations_render_their_readings(medplum, terminology):
    """Blood pressure carries systolic/diastolic in component[] with no
    top-level value. A valueQuantity-only reader renders a bare "Blood
    pressure" label with no numbers — the single most relevant vital for this
    population, silently blank. Caught against the live server; kept here.
    """
    seed_full_patient(medplum, terminology)
    medplum.seed(
        {
            "resourceType": "Observation",
            "subject": {"reference": "Patient/pat-1"},
            "code": {"text": "Blood pressure"},
            "effectiveDateTime": "2026-07-29",
            "component": [
                {
                    "code": {"text": "Systolic blood pressure"},
                    "valueQuantity": {"value": 136, "unit": "mmHg"},
                },
                {
                    "code": {"text": "Diastolic blood pressure"},
                    "valueQuantity": {"value": 78, "unit": "mmHg"},
                },
            ],
        }
    )
    brief = await compile_ehr_brief(medplum, "pat-1", terminology)

    assert "136" in brief.text
    assert "78" in brief.text
    assert "mmHg" in brief.text


async def test_ucum_annotation_units_are_not_rendered(medplum, terminology):
    """`{score}` is UCUM machine syntax, not a unit to read aloud."""
    seed_full_patient(medplum, terminology)
    medplum.seed(
        {
            "resourceType": "Observation",
            "subject": {"reference": "Patient/pat-1"},
            "code": {"text": "PHQ-2 depression screen"},
            "effectiveDateTime": "2026-07-29",
            "valueQuantity": {"value": 1, "unit": "{score}"},
        }
    )
    brief = await compile_ehr_brief(medplum, "pat-1", terminology)

    assert "PHQ-2 depression screen 1" in brief.text
    assert "{score}" not in brief.text


async def test_brief_carries_identity_medications_and_recent_events(medplum, terminology):
    seed_full_patient(medplum, terminology)
    brief = await compile_ehr_brief(medplum, "pat-1", terminology)

    # Identity, including the preferred name the Companion will actually use.
    assert brief.patient_name == "Edith Wilson"
    assert brief.preferred_name == "Edie"
    assert brief.phone == "+15550001111"

    # A seeded medication surfaces BY NAME — this is what lets the 4M agent ask
    # about an actual drug rather than asking generically.
    assert "Metformin" in brief.text

    # A recent hospitalization and an upcoming appointment both reach the brief.
    assert "Pneumonia" in brief.text
    assert "Dr. Chen" in brief.text

    assert "Penicillin" in brief.text
    assert "Type 2 diabetes" in brief.text
    assert brief.care_team_refs


async def test_brief_stays_within_budget_for_a_heavy_history(medplum, terminology):
    """A patient with twenty years of history has thousands of Observations.
    The brief is compiled and trimmed, never concatenated."""
    seed_full_patient(medplum, terminology)
    for index in range(400):
        medplum.seed(
            {
                "resourceType": "Observation",
                "subject": {"reference": "Patient/pat-1"},
                "code": {"text": f"Serum chemistry panel component {index}"},
                "valueQuantity": {"value": index, "unit": "mmol/L"},
                "effectiveDateTime": "2026-06-01",
            }
        )
        medplum.seed(
            {
                "resourceType": "Condition",
                "subject": {"reference": "Patient/pat-1"},
                "code": {"text": f"Historical condition {index}"},
            }
        )

    budget = 800
    brief = await compile_ehr_brief(medplum, "pat-1", terminology, token_budget=budget)

    assert brief.token_estimate <= budget
    assert estimate_tokens(brief.text) <= budget
    # Identity survives budget pressure — it is the highest-priority section.
    assert "Edith Wilson" in brief.text


async def test_verify_consent_reads_each_provision_separately(medplum, terminology):
    seed_consent(medplum, terminology, codes=("ai-calling", "family-sharing"))
    status = await verify_consent(medplum, "pat-1", terminology)

    assert status.ai_calling is True
    assert status.family_sharing is True
    assert status.recording is False
    assert status.may_dial is False
