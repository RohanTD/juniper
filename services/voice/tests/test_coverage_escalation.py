"""Coverage-escalation test — the guard against the Companion's structural bias
toward niceness: a chatty patient who avoids medication must mechanically
escalate the medication advisory to a REQUIRED intent, and coverage must not
be silently abandoned in favour of a pleasant conversation."""

from __future__ import annotations

import json

from conftest import COMPASSION_PASS, URGENCY_OK, load_fixture

from juniper_voice.controller import ControllerSettings

FOURM_MEDICATION_ADVISORY = json.dumps(
    {
        "advisory": {
            "domain": "medication",
            "priority": "high",
            "hook": "he mentioned the pharmacy refill",
        },
        "completed": [],
    }
)


async def test_medication_advisory_becomes_required_intent(provider, make_controller):
    fixture = load_fixture("chatty_avoids_medication")
    provider.script("urgency", URGENCY_OK)
    provider.script("compassion", COMPASSION_PASS)
    provider.script("companion", "That bowling final sounds like a thriller — and your heart pill?")
    provider.script("fourm", FOURM_MEDICATION_ADVISORY)

    controller = make_controller(
        settings=ControllerSettings(
            fourm_refresh_every=1,
            escalate_after_turns=2,
            fatigue_short_replies=99,  # keep the call in MAIN for this test
            max_call_seconds=10_000,
        )
    )

    patient_turns = [t["text"] for t in fixture["turns"] if t["speaker"] == "patient"]
    for text in patient_turns:
        await controller.take_turn(text)
        await controller.drain_background()

    # The controller escalated mechanically: the standing advisory became a
    # required intent...
    assert controller.standing_advisory is not None
    assert controller.standing_advisory.domain == "medication"
    assert controller.standing_advisory.required is True

    # ...and the Companion's prompt received it as a non-optional instruction.
    #
    # The marker text changed (was "REQUIRED INTENT (must be acted on this
    # turn)") because that command phrasing made the Companion yank the
    # subject mid-sentence, audibly, on live calls. The MECHANISM is
    # unchanged and still asserted above via .required — what this checks is
    # that an escalated advisory still reaches the prompt with real
    # insistence and without the "drop it if it doesn't fit" licence that
    # non-escalated advisories carry.
    companion_requests = provider.requests_for("companion")
    required_prompts = [
        r for r in companion_requests if "NEEDED THIS TURN" in r.prompt_text()
    ]
    assert required_prompts, "companion never received the required intent"
    final_prompt = required_prompts[-1].prompt_text()
    # Named in human words, not as a raw domain slug.
    assert "Medication" in final_prompt
    # An escalated intent is never presented as optional.
    assert "let it go this turn" not in final_prompt

    # Coverage was not silently abandoned: the domain is still tracked as
    # unfilled and the miss is on the record as an unanswered ask.
    assert not controller.coverage["medication"].filled
    assert any(
        "Medication" in ask.description or ask.domain == "medication"
        for ask in controller.unanswered_asks
    )
