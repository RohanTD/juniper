"""Consent gating and the two-audience rule.

Two properties from docs/PLAN.md, tested together because they are the same
seam — what the post-call pass generates, and from what source:

1. When family sharing is withheld the family summary is **not generated at
   all** — not generated and hidden.
2. The family summary is generated **from the transcript**, never from the
   clinical note.  Summarizing a summary compounds error, and the family
   version needs different content, not softer wording.
"""

from __future__ import annotations

from juniper_voice.documentation import FAMILY_TAG, NOTE_TAG, run_post_call
from juniper_voice.llm.provider import ModelRoster
from juniper_voice.medplum import ConsentStatus

from conftest import COMPASSION_PASS, URGENCY_OK, buffer_from_fixture, load_fixture

NOTE_TEXT = "SUBJECTIVE: Patient reports intermittent dizziness on standing."
FAMILY_TEXT = "Your mum sounded cheerful today. She mentioned feeling lightheaded sometimes."

DEVICE_REF = "Device/juniper-voice-agent"
ORG_REF = "Organization/juniper-pilot-clinic"


def _script_documents(provider) -> None:
    provider.script("urgency", URGENCY_OK)
    provider.script("compassion", COMPASSION_PASS)
    provider.script("companion", "Thank you for telling me that.")
    provider.script("fourm", '{"advisory": null, "completed": []}')
    provider.script(NOTE_TAG, NOTE_TEXT)
    provider.script(FAMILY_TAG, FAMILY_TEXT)
    provider.script("context_brain.write_back", '{"memories": [], "negative_constraints": []}')


async def _run(provider, controller, medplum, terminology):
    return await run_post_call(
        controller=controller,
        provider=provider,
        roster=ModelRoster(),
        medplum=medplum,
        terminology=terminology,
        device_ref=DEVICE_REF,
        organization_ref=ORG_REF,
        call_start_iso="2026-08-01T15:00:00+00:00",
        call_end_iso="2026-08-01T15:12:00+00:00",
    )


async def test_family_summary_is_not_generated_when_sharing_is_withheld(
    provider, make_controller, medplum, terminology
):
    _script_documents(provider)
    controller = make_controller(
        consent=ConsentStatus(
            ai_calling=True, recording=True, family_sharing=False, resource_id="consent-1"
        )
    )
    await controller.take_turn("I've been a bit dizzy when I stand up.")

    result = await _run(provider, controller, medplum, terminology)

    # Never generated — not generated-then-hidden.
    assert result.family_summary_text is None
    assert provider.requests_for(FAMILY_TAG) == []

    # And nothing was written for it.
    assert result.write_result is not None
    assert result.write_result.family_summary_id is None
    assert result.write_result.family_summary_binary_id is None
    written_categories = {
        coding["code"]
        for _, resource in medplum.writes
        if resource["resourceType"] == "DocumentReference"
        for concept in resource["category"]
        for coding in concept["coding"]
    }
    assert "juniper-family-summary" not in written_categories


async def test_family_summary_is_generated_when_sharing_is_granted(
    provider, make_controller, medplum, terminology
):
    _script_documents(provider)
    controller = make_controller()  # full consent by default
    await controller.take_turn("I've been a bit dizzy when I stand up.")

    result = await _run(provider, controller, medplum, terminology)

    assert result.family_summary_text == FAMILY_TEXT
    assert result.write_result.family_summary_id is not None


async def test_family_summary_is_derived_from_the_transcript_not_the_note(
    provider, make_controller, medplum, terminology
):
    """Both documents come from the same source, independently."""
    _script_documents(provider)
    controller = make_controller()
    await controller.take_turn("I've been a bit dizzy when I stand up.")

    await _run(provider, controller, medplum, terminology)

    family_request = provider.requests_for(FAMILY_TAG)[0]
    rendered = family_request.system + "".join(
        str(message["content"]) for message in family_request.messages
    )
    # The transcript is the input...
    assert "dizzy when I stand up" in rendered
    # ...and the clinical note is emphatically not.
    assert NOTE_TEXT not in rendered
    assert "SUBJECTIVE" not in rendered


async def test_two_audience_distressing_content(
    provider, make_controller, medplum, terminology
):
    """Something clinically necessary but distressing to a family reader must
    appear in the clinical note, while the family summary stays truthful
    without being alarming — and is still generated from the transcript."""
    fixture = load_fixture("distressing_content")
    clinical = (
        "SUBJECTIVE: Patient reports her legs have been giving out and she is "
        "frightened she is 'going downhill'. ASSESSMENT: Possible functional decline."
    )
    family = (
        "Your mum was in good spirits today. She's finding stairs harder than she "
        "used to and we've flagged that for her care team to follow up."
    )
    _script_documents(provider)
    provider.script(NOTE_TAG, clinical)
    provider.script(FAMILY_TAG, family)

    controller = make_controller()
    controller.transcript = buffer_from_fixture(fixture)

    result = await _run(provider, controller, medplum, terminology)

    # Clinically necessary content is present in the clinical note.
    assert "functional decline" in result.note_text.lower()

    # The family summary is neither false nor alarming.
    assert result.family_summary_text == family
    for alarming in ("going downhill", "decline", "deteriorat"):
        assert alarming not in result.family_summary_text.lower()

    # Both were generated from the same transcript — the note was never an input
    # to the family summary.
    family_request = provider.requests_for(FAMILY_TAG)[0]
    rendered = "".join(str(message["content"]) for message in family_request.messages)
    assert "COMPLETE CALL TRANSCRIPT" in rendered
    assert clinical not in rendered
