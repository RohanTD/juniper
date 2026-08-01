"""Condescension screening.

Patronizing "elder-speak" is a documented harm in geriatrics, and a filter
tuned solely toward gentleness drifts straight into it.  docs/PLAN.md requires
the compassion filter to screen for condescension, not only harshness — so the
prompt must say so, and the flagged path must trigger a rewrite.
"""

from __future__ import annotations

import json

import pytest

from juniper_voice.filters.compassion import CompassionFilter
from juniper_voice.llm.provider import ModelRoster

from conftest import COMPASSION_PASS, URGENCY_OK, compassion_flag

PATRONIZING = [
    "Are we remembering to take our pills today?",
    "Good girl, that's exactly right!",
    "Let's not worry your head about that, sweetie.",
    "Did we have a nice little nap today?",
]


@pytest.mark.parametrize("text", PATRONIZING)
async def test_patronizing_output_is_flagged(provider, text):
    provider.script("compassion", compassion_flag("condescending elder-speak"))
    verdict = await CompassionFilter(provider, ModelRoster().compassion).review(text)
    assert verdict.passed is False
    assert verdict.reasons


async def test_filter_prompt_screens_for_condescension_not_only_harshness(provider):
    """The screen must be in the instruction itself — a filter that only asks
    'is this harsh?' systematically misses elder-speak."""
    provider.script("compassion", COMPASSION_PASS)
    await CompassionFilter(provider, ModelRoster().compassion).review("How are you today?")

    system = provider.requests_for("compassion")[0].system.lower()
    assert "condescen" in system or "patronis" in system or "patroniz" in system
    assert "elder" in system


async def test_negative_constraints_are_enforced_independently_of_the_companion(provider):
    """Negative constraints are hard prohibitions, not prompt flavour: the
    compassion filter checks them itself rather than trusting the Companion to
    have honoured them."""
    provider.script(
        "compassion",
        json.dumps(
            {
                "pass": False,
                "reasons": ["mentions a prohibited topic"],
                "violated_constraints": ["never mention her late husband Robert"],
            }
        ),
    )
    verdict = await CompassionFilter(provider, ModelRoster().compassion).review(
        "Robert would have loved that story.",
        negative_constraints=("never mention her late husband Robert",),
    )
    assert verdict.passed is False
    assert verdict.violated_constraints

    # The constraints must actually reach the filter's prompt.
    request = provider.requests_for("compassion")[0]
    rendered = request.system + json.dumps([dict(m) for m in request.messages])
    assert "Robert" in rendered


async def test_condescending_draft_is_rewritten_before_it_ships(provider, make_controller):
    provider.script("urgency", URGENCY_OK)
    provider.script("compassion", [compassion_flag("condescending"), COMPASSION_PASS])
    provider.script("companion", "Are we remembering to take our pills today?")
    provider.script("companion.rewrite", "How are the pills going this week?")
    provider.script("fourm", '{"advisory": null, "completed": []}')

    controller = make_controller()
    reply = await controller.take_turn("Not much new here.")

    assert "we remembering" not in reply
    assert reply == "How are the pills going this week?"
