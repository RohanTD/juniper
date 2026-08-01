"""Filter-precedence — the one interaction between the two filters that can
cause real harm.

Urgency outranks compassion.  A compassion filter that softens "that chest
pain needs a call to your doctor today" into something gentler is itself a
harm, so an urgency-driven turn must ship its clinical directive verbatim.
docs/PLAN.md requires this to be enforced in the controller as a code path,
not as a prompt instruction — so the test drives the controller with a
compassion filter that flags *everything* and asserts the directive survives.
"""

from __future__ import annotations

from conftest import COMPASSION_PASS, URGENCY_OK, compassion_flag, urgency_urgent

DIRECTIVE = (
    "I want you to call Dr. Chen today about that chest pain — today, not next week."
)


async def test_compassion_may_not_weaken_an_urgency_driven_directive(
    provider, make_controller
):
    provider.script("urgency", urgency_urgent("cardiac", "chest pain since yesterday", "call today"))
    # The compassion filter flags this turn as harsh — it must NOT win.
    provider.script("compassion", compassion_flag("too blunt for an elderly patient"))
    provider.script("companion", DIRECTIVE)
    provider.script("companion.rewrite", "Only if you feel up to it, maybe mention it sometime.")
    provider.script("fourm", '{"advisory": null, "completed": []}')

    controller = make_controller()
    reply = await controller.take_turn("My chest has been hurting since yesterday.")

    assert reply == DIRECTIVE
    # The rewrite path must never have been entered for an urgency turn.
    assert provider.requests_for("companion.rewrite") == []


async def test_non_urgent_turns_still_obey_the_compassion_filter(provider, make_controller):
    """The precedence rule is narrow: without urgency, a flag still rewrites."""
    provider.script("urgency", URGENCY_OK)
    provider.script("compassion", [compassion_flag("condescending"), COMPASSION_PASS])
    provider.script("companion", "Are we remembering to take our pills today?")
    provider.script("companion.rewrite", "How have you been managing the pills this week?")
    provider.script("fourm", '{"advisory": null, "completed": []}')

    controller = make_controller()
    reply = await controller.take_turn("Oh, not much to report.")

    assert reply == "How have you been managing the pills this week?"
    assert len(provider.requests_for("companion.rewrite")) == 1


async def test_urgency_escalates_before_the_post_call_pass(provider, make_controller):
    """The sink fires during the call, not at hangup."""
    provider.script("urgency", urgency_urgent("fall", "fell yesterday", "assess injury"))
    provider.script("compassion", COMPASSION_PASS)
    provider.script("companion", "That sounds frightening — are you hurt anywhere?")
    provider.script("fourm", '{"advisory": null, "completed": []}')

    controller = make_controller()
    await controller.take_turn("I fell yesterday coming down the stairs.")

    # Recorded immediately — no post-call pass has run at this point.
    assert len(controller.escalation.escalations) == 1
    assert controller.escalation.escalations[0].category == "fall"
