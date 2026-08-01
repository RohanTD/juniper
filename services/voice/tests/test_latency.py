"""Latency instrumentation — continuous, not a one-off.

The p95 end-of-speech -> first-audio budget is the number that decides whether
this architecture works at all.  The slow-loop design exists to protect it, so
the load-bearing assertion here is structural: **no slow-loop work ever lands
on the critical path of a turn.**  A regression there would not show up as a
failing feature — it would show up as dead air on every call.
"""

from __future__ import annotations

import asyncio

import pytest

from juniper_voice.controller import ControllerSettings, Phase
from juniper_voice.latency import (
    DEFAULT_BUDGET_SECONDS,
    LatencyBudgetExceeded,
    LatencyLog,
    assert_latency_budget,
    p95,
)

from conftest import COMPASSION_PASS, URGENCY_OK, FakeClock

FOURM_ADVISORY = (
    '{"advisory": {"domain": "medication", "priority": "high", '
    '"hook": "she mentioned a new pharmacy"}, "completed": []}'
)


def test_p95_uses_nearest_rank():
    assert p95([]) == 0.0
    assert p95([0.5]) == 0.5
    # 20 values, ceil(0.95*20) = 19 -> the 19th smallest.
    assert p95([i / 100 for i in range(1, 21)]) == pytest.approx(0.19)
    assert p95([0.1, 0.9]) == pytest.approx(0.9)


def test_budget_gate_fails_above_the_threshold():
    clock = FakeClock()
    log = LatencyLog(clock=clock, call_id="call-1")
    for _ in range(10):
        timer = log.begin_turn(log_index := len(log.records) + 1)
        assert timer.turn_index == log_index
        timer.record_stage("companion", 0.30)
        timer.record_stage("compassion", 0.20)
        timer.close()

    # 500ms per turn is inside the 800ms budget.
    assert log.p95_end_to_first_audio() == pytest.approx(0.5)
    assert_latency_budget(log)

    slow = LatencyLog(clock=FakeClock(), call_id="call-2")
    timer = slow.begin_turn(1)
    timer.record_stage("companion", 0.9)
    timer.record_stage("compassion", 0.4)
    timer.close()
    with pytest.raises(LatencyBudgetExceeded):
        assert_latency_budget(slow)


def test_default_budget_is_the_documented_800ms():
    assert DEFAULT_BUDGET_SECONDS == pytest.approx(0.8)


async def test_every_turn_records_the_critical_path_stages(provider, make_controller):
    provider.script("urgency", URGENCY_OK)
    provider.script("compassion", COMPASSION_PASS)
    provider.script("companion", "That sounds like a good week.")
    provider.script("fourm", FOURM_ADVISORY)

    controller = make_controller()
    for text in ("I'm doing all right.", "The garden is coming along.", "Not too bad."):
        await controller.take_turn(text)
    await controller.drain_background()

    assert len(controller.latency.records) == 3
    for record in controller.latency.records:
        assert "stt_finalize" in record.stages
        assert "companion" in record.stages
        assert "compassion" in record.stages


async def test_slow_loop_work_never_lands_on_the_critical_path(provider, make_controller):
    """The 4M advisory refresh is deliberately expensive here.  If it were on
    the critical path the turn's measured stages would absorb its cost; the
    whole point of the slow loop is that they do not."""
    clock = FakeClock()

    async def slow_fourm(_request):
        # A refresh that costs far more than the entire turn budget.
        clock.advance(5.0)
        return FOURM_ADVISORY

    def cheap(response: str):
        def _handler(_request):
            clock.advance(0.05)
            return response

        return _handler

    provider.script("urgency", cheap(URGENCY_OK))
    provider.script("compassion", cheap(COMPASSION_PASS))
    provider.script("companion", cheap("Lovely to hear."))
    provider.script("fourm", slow_fourm)

    controller = make_controller(
        settings=ControllerSettings(fourm_refresh_every=1), start_phase=Phase.MAIN
    )
    controller.clock = clock
    controller.latency = LatencyLog(clock=clock, call_id="call-1")

    for text in ("I'm well, thank you.", "The weather's been kind.", "Yes, quite well."):
        await controller.take_turn(text)
        await controller.drain_background()

    # The slow loop did run, and it was expensive.
    slow_records = controller.latency.slow_loop
    assert slow_records, "the 4M advisory never refreshed"
    assert max(record.duration for record in slow_records) >= 5.0

    # ...and not one microsecond of it reached a turn's critical path.
    assert controller.latency.p95_end_to_first_audio() < 1.0
    assert_latency_budget(controller.latency)


async def test_slow_loop_failure_never_sinks_a_call(provider, make_controller):
    async def exploding(_request):
        raise RuntimeError("advisor unavailable")

    provider.script("urgency", URGENCY_OK)
    provider.script("compassion", COMPASSION_PASS)
    provider.script("companion", "Tell me more about that.")
    provider.script("fourm", exploding)

    controller = make_controller(settings=ControllerSettings(fourm_refresh_every=1))
    reply = await controller.take_turn("It's been a quiet week.")
    await controller.drain_background()

    assert reply == "Tell me more about that."
    assert controller.phase is not Phase.DONE


async def test_urgency_runs_concurrently_with_the_companion(provider, make_controller):
    """Urgency needs only what the patient said, so it costs zero added
    latency — it overlaps composition rather than following it."""
    order: list[str] = []
    started = asyncio.Event()

    async def companion(_request):
        order.append("companion:start")
        started.set()
        await asyncio.sleep(0.02)
        order.append("companion:end")
        return "I hear you."

    async def urgency(_request):
        await started.wait()  # only completes if it is running in parallel
        order.append("urgency:done")
        return URGENCY_OK

    provider.script("companion", companion)
    provider.script("urgency", urgency)
    provider.script("compassion", COMPASSION_PASS)
    provider.script("fourm", '{"advisory": null, "completed": []}')

    controller = make_controller()
    await asyncio.wait_for(controller.take_turn("Just the usual around here."), timeout=2.0)

    assert order.index("urgency:done") < order.index("companion:end")
