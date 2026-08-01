"""Reconciling the chart with what the patient told Juniper at onboarding.

Onboarding deliberately does not write ``Patient`` — the clinic owns its
demographics — so two sources of truth exist and they can disagree.  The rules
under test:

* operational fields (the number we dial, the name we greet with, the language
  we speak) follow **enrollment**, because they are facts about our own
  interaction, given directly and more recently than the chart;
* identity fields (legal name, date of birth) follow the **chart**, and
  enrollment only fills a gap;
* a disagreement is **reported in the brief**, never silently resolved.

Also covered: the store must not let a client destroy the dial number by
omitting it, which would stop the patient being called at all.
"""

from __future__ import annotations

import pytest

from juniper_voice.medplum import _resolve_identity
from juniper_voice.preferences import Preferences, PreferencesStore

CHART = {
    "patient_id": "pat-1",
    "chart_name": "Edith Wilson",
    "chart_preferred": "Edie",
    "chart_phone": "+15550001111",
    "chart_language": "English",
    "chart_birth_date": "1941-03-22",
}


def resolve(**enrollment):
    return _resolve_identity(**CHART, enrollment=enrollment or None)


def test_no_enrollment_leaves_the_chart_exactly_as_it_was():
    name, preferred, phone, language, birth_date, conflicts = resolve()
    assert (name, preferred, phone, language, birth_date) == (
        "Edith Wilson",
        "Edie",
        "+15550001111",
        "English",
        "1941-03-22",
    )
    assert conflicts == []


def test_the_number_we_dial_is_the_one_the_patient_gave_us():
    # The likeliest real disagreement: a mobile the practice was never told
    # about. Dialing the chart's stale landline means not reaching them at all.
    _, _, phone, _, _, conflicts = resolve(phone="+15559998888")
    assert phone == "+15559998888"
    assert any("+15559998888" in line and "+15550001111" in line for line in conflicts)


def test_a_matching_phone_number_produces_no_noise():
    _, _, phone, _, _, conflicts = resolve(phone="+15550001111")
    assert phone == "+15550001111"
    assert conflicts == []


def test_preferred_name_and_language_follow_enrollment():
    _, preferred, _, language, _, conflicts = resolve(
        preferredName="Peggy", language={"code": "es", "label": "Spanish"}
    )
    assert preferred == "Peggy"
    assert language == "Spanish"
    assert any("Peggy" in line for line in conflicts)
    assert any("Spanish" in line for line in conflicts)


def test_legal_name_and_birth_date_stay_with_the_chart():
    """The chart wins on identity — but the discrepancy is still surfaced.

    Someone typing a different name into an onboarding app must not silently
    rename a patient in the record their clinicians read.
    """
    name, _, _, _, birth_date, conflicts = resolve(
        legalName={"given": "Edythe", "family": "Wilson-Barnes"},
        birthDate="1941-03-23",
    )
    assert name == "Edith Wilson"
    assert birth_date == "1941-03-22"
    assert any("Edythe Wilson-Barnes" in line for line in conflicts)
    assert any("1941-03-23" in line for line in conflicts)


def test_enrollment_fills_identity_gaps_on_a_stub_chart():
    """A Patient created by an admin and never completed still needs a name."""
    name, preferred, phone, language, birth_date, conflicts = _resolve_identity(
        patient_id="pat-2",
        chart_name=None,
        chart_preferred=None,
        chart_phone=None,
        chart_language=None,
        chart_birth_date=None,
        enrollment={
            "legalName": {"given": "Harold", "family": "Nakamura"},
            "preferredName": "Hal",
            "birthDate": "1938-11-02",
            "phone": "+15557770000",
            "language": {"code": "en", "label": "English"},
        },
    )
    assert (name, preferred, phone, language, birth_date) == (
        "Harold Nakamura",
        "Hal",
        "+15557770000",
        "English",
        "1938-11-02",
    )
    # Filling a gap is not a disagreement.
    assert conflicts == []


def test_a_wholly_unknown_patient_still_gets_an_identity():
    name, *_ = _resolve_identity(
        patient_id="pat-3",
        chart_name=None,
        chart_preferred=None,
        chart_phone=None,
        chart_language=None,
        chart_birth_date=None,
        enrollment=None,
    )
    assert name == "pat-3"


@pytest.mark.parametrize("blank", ["", "   "])
def test_blank_enrollment_values_are_not_treated_as_answers(blank):
    _, preferred, phone, _, _, conflicts = resolve(preferredName=blank, phone=blank)
    assert preferred == "Edie"
    assert phone == "+15550001111"
    assert conflicts == []


# ---------------------------------------------------------------------------
# Store: enrollment survives writes that don't mention it
# ---------------------------------------------------------------------------


def test_a_put_that_omits_enrollment_does_not_delete_the_dial_number(tmp_path):
    """The family app's call-settings screen and the Companion's
    ``update_call_windows`` tool both PUT what they know about, and neither has
    any business restating a phone number. Under strict replacement the first
    save from either would silently delete the only way to reach the patient.
    """
    store = PreferencesStore(tmp_path / "prefs.json")
    store.put(
        "pat-1",
        {
            "callWindows": [],
            "topicsToAvoid": [],
            "enrollment": {"phone": "+15559998888", "preferredName": "Peggy"},
        },
    )

    store.put("pat-1", {"callWindows": [], "topicsToAvoid": ["the stairs"]})

    stored = store.get("pat-1")
    assert stored.topicsToAvoid == ["the stairs"]
    assert stored.enrollment is not None
    assert stored.enrollment.phone == "+15559998888"
    assert stored.enrollment.preferredName == "Peggy"


def test_a_put_that_supplies_enrollment_still_replaces_it(tmp_path):
    """Preservation must not become immutability — a patient who re-runs setup
    with a new number has to be able to change it."""
    store = PreferencesStore(tmp_path / "prefs.json")
    store.put("pat-1", {"enrollment": {"phone": "+15550000000"}})
    store.put("pat-1", {"enrollment": {"phone": "+15551111111"}})
    assert store.get("pat-1").enrollment.phone == "+15551111111"


def test_the_companion_tools_carry_enrollment_through(tmp_path):
    store = PreferencesStore(tmp_path / "prefs.json")
    store.put("pat-1", {"enrollment": {"phone": "+15559998888"}})

    store.add_topic_to_avoid("pat-1", "her late husband Robert")
    store.update_call_windows(
        "pat-1",
        [{"days": ["mon"], "start": "09:00", "end": "11:00", "timezone": "America/New_York"}],
    )

    stored = store.get("pat-1")
    assert stored.enrollment.phone == "+15559998888"
    assert stored.topicsToAvoid == ["her late husband Robert"]
    assert stored.callWindows[0].start == "09:00"


def test_an_absent_patient_reads_as_empty_rather_than_raising(tmp_path):
    assert PreferencesStore(tmp_path / "prefs.json").get("nobody") == Preferences()
