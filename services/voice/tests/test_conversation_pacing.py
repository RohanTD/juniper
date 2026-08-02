"""Conversation pacing — warm-up, the per-topic question budget, and the
easing-in transition.

All three are controller decisions rather than prompt guidance, deliberately:
the Companion cannot be talked out of a clinical intent it has been handed, so
the controller withholds the intent instead. That was learned the hard way —
an explicit "REQUIRED INTENT (must be acted on this turn)" reliably beat the
persona's "weave naturally, never interrogate" and produced an audible
mid-sentence topic yank on live calls.
"""

from __future__ import annotations

import json

from conftest import COMPASSION_PASS, URGENCY_OK

from juniper_voice.controller import ControllerSettings

FOURM_NO_OP = json.dumps({"advisory": None, "completed": []})


def _script(provider):
    provider.script("urgency", URGENCY_OK)
    provider.script("compassion", COMPASSION_PASS)
    provider.script("companion", "That sounds lovely.")
    provider.script("fourm", FOURM_NO_OP)


def _instructions(provider):
    """The turn-instruction text handed to the Companion, per turn."""
    return [r.prompt_text() for r in provider.requests_for("companion")]


async def test_warmup_turns_carry_no_clinical_intent(provider, make_controller):
    """The opening of a call is a conversation, not an intake form.

    Before this, _unfilled_domains() returned all four domains on turn one, so
    a clinical push fired immediately and there was no room for small talk.
    """
    _script(provider)
    controller = make_controller(settings=ControllerSettings(warmup_turns=2))
    controller.phase = controller.phase.MAIN

    for _ in range(2):
        await controller.take_turn("The garden has been keeping me busy.")

    for text in _instructions(provider):
        assert "Worth steering toward" not in text
        assert "NEEDED THIS TURN" not in text
        # The no-advisory fallback instruction is what should be there.
        assert "Respond naturally and keep the conversation going" in text


async def test_first_clinical_intent_is_phrased_as_easing_in(provider, make_controller):
    """The crossing out of small talk gets a three-beat shape (acknowledge ->
    turn tentatively -> invite), and only the FIRST crossing gets it."""
    _script(provider)
    controller = make_controller(settings=ControllerSettings(warmup_turns=1))
    controller.phase = controller.phase.MAIN

    for _ in range(4):
        await controller.take_turn("Not a lot to report, really.")

    texts = _instructions(provider)
    easing = [t for t in texts if "first time the call turns toward anything clinical" in t]
    assert len(easing) == 1, "the easing-in framing must appear exactly once per call"
    # It carries the human topic name, never a raw slug.
    assert "Medication" in easing[0] or "What Matters" in easing[0]
    # And it is an invitation, not a demand.
    assert "anything you'd want to share" in easing[0]


async def test_a_topic_is_dropped_after_its_question_budget(provider, make_controller):
    """Two questions on a topic, three at the outside. A topic that keeps
    producing nothing is abandoned so the call can move on — and the miss is
    recorded rather than silently forgotten.
    """
    _script(provider)
    controller = make_controller(
        settings=ControllerSettings(warmup_turns=0, max_asks_per_domain=3)
    )
    controller.phase = controller.phase.MAIN

    first_domain = controller._unfilled_domains()[0]
    for _ in range(6):
        await controller.take_turn("Fine, fine. Nothing new.")

    # The exhausted topic is no longer pursued...
    assert controller._is_exhausted(first_domain)
    advisory = controller._current_advisory()
    assert advisory is None or advisory.domain != first_domain
    # ...and the gap is on the record for the note, not dropped silently.
    assert any(ask.domain == first_domain for ask in controller.unanswered_asks)


async def test_a_productive_answer_extends_the_budget(provider, make_controller):
    """The ceiling counts turns WITHOUT PROGRESS, so a patient who is actually
    engaging is never cut off by it — which is what makes the limit elastic."""
    _script(provider)
    controller = make_controller(
        settings=ControllerSettings(warmup_turns=0, max_asks_per_domain=2)
    )
    controller.phase = controller.phase.MAIN
    domain = controller._unfilled_domains()[0]

    for _ in range(2):
        await controller.take_turn("Same as always.")
    assert controller._is_exhausted(domain), "budget should be spent after 2 flat turns"

    # The patient gives something real: the 4M advisor reports findings.
    controller.mark_domain_complete(domain, {"note": "patient described it in detail"}, 0.2)

    # Confidence is below threshold so the domain is still unfilled — but the
    # counter reset, so the topic is live again rather than abandoned.
    assert not controller.coverage[domain].filled
    assert not controller._is_exhausted(domain)
