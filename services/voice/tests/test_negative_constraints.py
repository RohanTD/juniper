"""Negative-constraint test.

Seed the Context Brain with "never mention her late husband", plant a
transcript turn that invites it, and assert nothing referencing him is spoken.

Negative constraints are hard prohibitions, not prompt flavour.  The
controller's guarantee is deterministic: if a draft still violates a
constraint after the rewrite budget, a bland utterance ships instead — a safe
fallback is strictly better than breaking a prohibition.
"""

from __future__ import annotations

import json

from juniper_voice.context_brain import ContextBrain
from juniper_voice.controller import SAFE_FALLBACK_UTTERANCE

from conftest import COMPASSION_PASS, URGENCY_OK

CONSTRAINT = "never mention her late husband Robert"
FOURM_NO_OP = '{"advisory": null, "completed": []}'


def _violation(*constraints: str) -> str:
    return json.dumps(
        {
            "pass": False,
            "reasons": ["references a prohibited topic"],
            "violated_constraints": list(constraints),
        }
    )


def test_context_brain_stores_constraints_as_first_class_records(tmp_path):
    brain = ContextBrain(tmp_path / "brain.json")
    brain.add_negative_constraint("pat-1", CONSTRAINT)
    brain.add_memory("pat-1", "granddaughter Maya started college")

    assert CONSTRAINT in brain.negative_constraints("pat-1")
    digest = brain.digest("pat-1")
    assert "Maya" in digest
    assert CONSTRAINT in digest

    # Idempotent — re-adding must not duplicate.
    brain.add_negative_constraint("pat-1", CONSTRAINT)
    assert brain.negative_constraints("pat-1").count(CONSTRAINT) == 1


async def test_constraint_reaches_the_companion_prompt(provider, make_controller):
    provider.script("urgency", URGENCY_OK)
    provider.script("compassion", COMPASSION_PASS)
    provider.script("companion", "That sounds like a lovely afternoon.")
    provider.script("fourm", FOURM_NO_OP)

    controller = make_controller(negative_constraints=(CONSTRAINT,))
    await controller.take_turn("I was going through some old photographs today.")

    system = provider.requests_for("companion")[0].system
    assert CONSTRAINT in system


async def test_a_violating_utterance_never_reaches_the_patient(provider, make_controller):
    """The invitation is planted; every draft the Companion produces mentions
    him; the filter catches each one; the safe fallback ships."""
    provider.script("urgency", URGENCY_OK)
    provider.script("compassion", _violation(CONSTRAINT))
    provider.script("companion", "Robert would have loved those photographs.")
    provider.script("companion.rewrite", "Your Robert would have enjoyed seeing those.")
    provider.script("fourm", FOURM_NO_OP)

    controller = make_controller(negative_constraints=(CONSTRAINT,))
    reply = await controller.take_turn(
        "I was going through old photographs of my wedding day today."
    )

    assert "Robert" not in reply
    assert reply == SAFE_FALLBACK_UTTERANCE
    # And the violating drafts never entered the transcript as spoken text.
    assert "Robert" not in controller.transcript.render()


async def test_a_rewrite_that_clears_the_constraint_is_allowed_through(
    provider, make_controller
):
    """The guarantee is about violations, not about refusing to speak."""
    provider.script("urgency", URGENCY_OK)
    provider.script("compassion", [_violation(CONSTRAINT), COMPASSION_PASS])
    provider.script("companion", "Robert would have loved those photographs.")
    provider.script("companion.rewrite", "What a treasure those photographs must be.")
    provider.script("fourm", FOURM_NO_OP)

    controller = make_controller(negative_constraints=(CONSTRAINT,))
    reply = await controller.take_turn("I was going through old photographs today.")

    assert reply == "What a treasure those photographs must be."
    assert "Robert" not in reply
