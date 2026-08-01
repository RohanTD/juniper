"""Escalation test: "I fell yesterday and my chest hurts" mid-fixture must trip
the urgency filter, force the Companion to address it, and reach the
escalation sink BEFORE the post-call pass runs."""

from __future__ import annotations

from conftest import (
    COMPASSION_PASS,
    FOURM_NO_OP,
    URGENCY_OK,
    FakeMedplum,
    load_fixture,
    urgency_urgent,
)

from juniper_voice.documentation import FAMILY_TAG, NOTE_TAG, run_post_call
from juniper_voice.llm.provider import ModelRoster

URGENT_TEXT = "I fell yesterday and my chest hurts when I breathe in, but I didn't want to bother anybody about it."
DIRECTIVE_REPLY = (
    "Frank, chest pain after a fall needs a doctor today — please call Dr. Alvarez's "
    "office as soon as we hang up, and call 911 if it gets worse."
)


async def test_urgency_trips_forces_companion_and_escalates_before_post_call(
    provider, make_controller, terminology
):
    fixture = load_fixture("urgent_chest_pain")
    events: list[str] = []

    def urgency_handler(request):
        if "chest hurts" in request.prompt_text():
            return urgency_urgent(
                "chest-pain",
                "Fall yesterday with chest pain on inspiration.",
                "call the doctor today; 911 if it worsens",
            )
        return URGENCY_OK

    def companion_handler(request):
        if "URGENT" in request.prompt_text():
            return DIRECTIVE_REPLY
        return "The Cubs will break our hearts forever. How have you been feeling?"

    provider.script("urgency", urgency_handler)
    provider.script("companion", companion_handler)
    provider.script("compassion", COMPASSION_PASS)
    provider.script("fourm", FOURM_NO_OP)

    def note_handler(request):
        events.append("post_call_note_generated")
        return "Clinical note."

    provider.script(NOTE_TAG, note_handler)
    provider.script(FAMILY_TAG, "Family summary.")

    controller = make_controller(
        escalation_notifier=lambda escalation: events.append("care_team_notified")
    )

    patient_turns = [t["text"] for t in fixture["turns"] if t["speaker"] == "patient"]
    replies = []
    for text in patient_turns:
        replies.append(await controller.take_turn(text))
        await controller.drain_background()

    # The urgency filter tripped on the mid-call reveal.
    assert controller.escalation.escalations, "escalation sink never received the concern"
    escalation = controller.escalation.escalations[0]
    assert escalation.category == "chest-pain"
    assert escalation.utterance == URGENT_TEXT

    # The controller forced the Companion to address it: the forced compose
    # carried the urgent directive, and the emitted reply IS the directive.
    urgent_turn_index = patient_turns.index(URGENT_TEXT)
    assert replies[urgent_turn_index] == DIRECTIVE_REPLY
    forced_requests = [
        r for r in provider.requests_for("companion") if "URGENT" in r.prompt_text()
    ]
    assert forced_requests, "companion was never forced to address the concern"

    # The sink fired mid-call — strictly before the post-call pass ran.
    assert events == ["care_team_notified"]
    await run_post_call(
        controller=controller,
        provider=provider,
        roster=ModelRoster(),
        medplum=FakeMedplum(),
        terminology=terminology,
        device_ref="Device/juniper-voice-agent",
        organization_ref="Organization/juniper-pilot-clinic",
    )
    assert events.index("care_team_notified") < events.index("post_call_note_generated")
