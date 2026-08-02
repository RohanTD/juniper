"""Turn integrity — the layer beneath the prompts.

Every test here covers a defect observed on a real recorded call, where the
agent's behaviour was wrong for reasons that had nothing to do with what any
model was told. They are grouped because they share a root cause: a turn is
only as good as the signal that produced it, and the signals (STT turn events,
answering-machine detection, the scripted-opening matcher, the fatigue and
question-budget counters) were each wrong in a way that the prompts could not
compensate for.
"""

from __future__ import annotations

from conftest import COMPASSION_PASS, FOURM_NO_OP, URGENCY_OK

from juniper_voice.agents.gatekeeper import is_cooperative_answer
from juniper_voice.controller import ControllerSettings, Phase
from juniper_voice.transcript import PATIENT, TranscriptBuffer


def _script(provider):
    provider.script("urgency", URGENCY_OK)
    provider.script("compassion", COMPASSION_PASS)
    provider.script("companion", "That sounds lovely.")
    provider.script("fourm", FOURM_NO_OP)


# -- STT turn revisions -------------------------------------------------------


async def test_a_revised_utterance_does_not_produce_a_second_reply(provider, make_controller):
    """Flux emitted "I'm doing good. How" and then "I'm doing good. How are
    you?" as two end-of-turn events. On a stateless endpoint both became full
    turns, so the agent spoke twice with no patient turn between them — the
    double monologue at the top of every recorded call."""
    _script(provider)
    controller = make_controller(settings=ControllerSettings(warmup_turns=2))
    controller.phase = Phase.MAIN

    first = await controller.take_turn("I'm doing good. How")
    second = await controller.take_turn("I'm doing good. How are you?")

    assert first, "the first end-of-turn is answered normally"
    # The revision REPLAYS rather than composing again — and must not answer
    # with silence. Deepgram discards the response to the superseded request,
    # so returning "" here threw away the reply entirely and produced 10s of
    # dead air on a live call. Identical responses mean the patient hears the
    # utterance exactly once whichever request the agent ends up speaking.
    assert second == first, "the revision must replay the same reply, not compose a new one"
    # One patient line on the record, carrying the BETTER transcription.
    patient_lines = [e for e in controller.transcript.entries if e.speaker == PATIENT]
    assert len(patient_lines) == 1
    assert patient_lines[0].text == "I'm doing good. How are you?"
    # And only one companion call was ever made.
    assert len(provider.requests_for("companion")) == 1


async def test_a_genuine_repeat_still_gets_an_answer(provider, make_controller):
    """The narrow case matters: an identical repeat is a patient talking to
    us, not the STT correcting itself. Staying silent on it would be worse
    than the bug being fixed."""
    _script(provider)
    controller = make_controller(settings=ControllerSettings(warmup_turns=2))
    controller.phase = Phase.MAIN

    assert await controller.take_turn("Fine.")
    assert await controller.take_turn("Fine."), "an identical repeat is not a revision"


async def test_a_revision_after_the_window_is_a_new_turn(provider, fake_clock, make_controller):
    _script(provider)
    controller = make_controller(settings=ControllerSettings(warmup_turns=2))
    controller.phase = Phase.MAIN

    await controller.take_turn("I went to the")
    fake_clock.advance(30.0)
    assert await controller.take_turn("I went to the doctor on Tuesday.")


def test_replace_last_corrects_rather_than_appends():
    buffer = TranscriptBuffer(clock=lambda: 0.0)
    buffer.append(PATIENT, "I'm doing good. How")
    buffer.replace_last(PATIENT, "I'm doing good. How are you?")
    assert len(buffer) == 1
    assert buffer.entries[0].text == "I'm doing good. How are you?"


# -- The scripted-opening matcher --------------------------------------------


def test_the_matcher_accepts_answers_to_the_question_the_greeting_asks():
    """The greeting was changed to "How are you doing today?" but the matcher
    still only recognised answers to "Is this Peggy?". Nothing matched, so
    every call routed its first turn through the gatekeeper LLM — the least
    reliable component in the system."""
    for answer in (
        "I'm doing good. How are you?",
        "Good, thanks.",
        "Pretty well, thank you.",
        "Oh, not too bad.",
        "I'm alright.",
        "A little tired today.",
    ):
        assert is_cooperative_answer(answer), answer


def test_the_matcher_still_accepts_plain_identity_confirmations():
    for answer in ("Yes", "Speaking", "This is she", "Yes, this is he"):
        assert is_cooperative_answer(answer), answer


def test_the_matcher_defers_anything_that_is_not_clearly_the_patient():
    for answer in (
        "Who is this?",
        "She's not here right now.",
        "Please leave a message after the tone.",
        "Wrong number.",
        "Stop calling me.",
        "Sorry, could you say that again?",
        "Hold on, let me get her.",
    ):
        assert not is_cooperative_answer(answer), answer


# -- Controller accounting ----------------------------------------------------


async def test_opening_pleasantries_do_not_read_as_fatigue(provider, make_controller):
    """"Hello", "Yes", "I'm good" are how phone calls start, not evidence of a
    tired patient. Counting them fired "entering closing phase: patient tired"
    three turns into a live call."""
    _script(provider)
    controller = make_controller(
        settings=ControllerSettings(warmup_turns=2, fatigue_short_replies=3)
    )
    controller.phase = Phase.MAIN

    for _ in range(3):
        await controller.take_turn("Good.")

    assert controller.phase is Phase.MAIN, "the call must not wrap up during small talk"


async def test_fatigue_still_closes_a_call_once_it_is_underway(provider, make_controller):
    """The guard must not disable the mechanism — a genuinely tiring patient is
    still let go."""
    _script(provider)
    controller = make_controller(
        settings=ControllerSettings(warmup_turns=0, fatigue_short_replies=3)
    )
    controller.phase = Phase.MAIN

    for _ in range(3):
        await controller.take_turn("Mm.")

    assert controller.phase is Phase.CLOSING


async def test_warmup_does_not_spend_every_topics_question_budget(provider, make_controller):
    """The budget counts ASKS, not elapsed turns.

    Previously any turn with no standing advisory — which is every warm-up turn
    by construction — charged a turn-without-progress to all four domains at
    once. By the time the first clinical question was asked, every topic was
    already at or near its ceiling, so it arrived pre-escalated and was dropped
    a turn later."""
    _script(provider)
    controller = make_controller(
        settings=ControllerSettings(warmup_turns=3, max_asks_per_domain=3)
    )
    controller.phase = Phase.MAIN

    for _ in range(3):
        await controller.take_turn("The garden has been keeping me busy this week.")

    for domain, slot in controller.coverage.items():
        assert slot.turns_since_progress == 0, f"{domain} was charged for small talk"
        assert not controller._is_exhausted(domain)


async def test_only_the_topic_actually_pursued_spends_its_budget(provider, make_controller):
    _script(provider)
    controller = make_controller(
        settings=ControllerSettings(warmup_turns=0, max_asks_per_domain=3)
    )
    controller.phase = Phase.MAIN

    await controller.take_turn("Nothing much to say.")

    spent = {d: s.turns_since_progress for d, s in controller.coverage.items()}
    assert sum(spent.values()) == 1, f"exactly one topic was asked about: {spent}"
