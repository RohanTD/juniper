"""Gap-manifest test: the mobility-deflection fixture must surface mobility in
the Closer's manifest, and — still unanswered — the note must say so
explicitly rather than omitting the domain."""

from __future__ import annotations

import json

from conftest import COMPASSION_PASS, URGENCY_OK, load_fixture

from juniper_voice.agents.closer import TAG as CLOSER_TAG
from juniper_voice.controller import ControllerSettings, Phase
from juniper_voice.documentation import NOTE_TAG, generate_clinical_note

FOURM_ALL_BUT_MOBILITY = json.dumps(
    {
        "advisory": {"domain": "mobility", "priority": "high", "hook": "ask about the porch steps"},
        "completed": [
            {
                "domain": "medication",
                "findings": {"medications": [{"name": "Metformin", "adherence": "daily"}]},
                "confidence": 0.9,
            },
            {"domain": "mentation", "findings": {"mood": "bright"}, "confidence": 0.9},
            {"domain": "what-matters", "findings": {"goals": ["garden"]}, "confidence": 0.9},
        ],
    }
)

CLOSER_MOBILITY = json.dumps(
    [{"domain": "mobility", "priority": "high", "hook": "one gentle question about the stairs"}]
)


async def test_mobility_deflection_reaches_closer_and_note(provider, make_controller):
    fixture = load_fixture("mobility_deflection")
    provider.script("urgency", URGENCY_OK)
    provider.script("compassion", COMPASSION_PASS)
    provider.script("companion", "And how are the porch steps treating you these days?")
    provider.script("fourm", FOURM_ALL_BUT_MOBILITY)
    provider.script(CLOSER_TAG, CLOSER_MOBILITY)

    controller = make_controller(
        settings=ControllerSettings(
            fourm_refresh_every=1,
            fatigue_short_replies=2,
            fatigue_word_threshold=4,
            closing_turn_budget=2,
        )
    )

    patient_turns = [t["text"] for t in fixture["turns"] if t["speaker"] == "patient"]
    for text in patient_turns:
        await controller.take_turn(text)
        await controller.drain_background()
        if controller.phase in (Phase.CLOSING, Phase.DONE):
            break

    # The deflections (short replies) tipped the fatigue signal into closing,
    # with mobility still unfilled.
    assert controller.phase in (Phase.CLOSING, Phase.DONE)
    assert not controller.coverage["mobility"].filled

    # The Closer received the controller-built manifest and it names mobility.
    closer_requests = provider.requests_for(CLOSER_TAG)
    assert closer_requests, "closer was never consulted"
    assert "mobility" in closer_requests[0].prompt_text().lower()

    # The Closer raised it as a prioritized advisory.
    manifest = controller.build_gap_manifest()
    assert any(slot.domain == "mobility" for slot in manifest.unfilled)

    # One closing follow-up is attempted, still deflected — the call ends with
    # mobility unresolved.
    if controller.phase is Phase.CLOSING:
        await controller.take_turn("I manage fine.")
        await controller.take_turn("Fine.")
    gaps = controller.unresolved_gaps()
    assert any(gap.domain == "mobility" for gap in gaps)

    # The note states the gap explicitly — deterministically, not by model
    # goodwill.
    provider.script(NOTE_TAG, "Patient chatted warmly about her garden and family.")
    note = await generate_clinical_note(
        provider,
        "claude-opus-5",
        transcript_text=controller.transcript.render(),
        gaps=gaps,
    )
    assert "Mobility: not assessed" in note
    assert "patient tired, call ended early" in note
