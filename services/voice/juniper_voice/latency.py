"""Per-turn, per-stage latency instrumentation.

The end-of-speech -> first-audio budget is p95 <= 800ms (docs/PLAN.md,
"Verification").  Critical-path stages are recorded on every turn; slow-loop
work (4M / Closer refresh) is recorded separately and must never appear on a
turn's critical path — that separation is what the slow-loop design protects.

The clock is injectable so tests can drive timing deterministically.
"""

from __future__ import annotations

import json
import logging
import math
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Callable, Iterator, Sequence

logger = logging.getLogger("juniper.latency")

Clock = Callable[[], float]

# The four stages that make up end-of-speech -> first-audio.
# Every stage that sits between end-of-speech and first audio. moss_retrieval
# belongs here: it runs ahead of the Companion on the turn's critical path, so
# omitting it would let per-turn retrieval grow without ever tripping the CI
# budget — the budget would silently stop measuring the thing it exists for.
CRITICAL_STAGES = ("stt_finalize", "moss_retrieval", "companion", "compassion", "first_byte")

DEFAULT_BUDGET_SECONDS = 0.8


class LatencyBudgetExceeded(AssertionError):
    """Raised when p95 end-of-speech -> first-audio exceeds the budget."""


@dataclass
class TurnRecord:
    turn_index: int
    stages: dict[str, float] = field(default_factory=dict)

    def critical_path_seconds(self) -> float:
        return sum(self.stages.get(name, 0.0) for name in CRITICAL_STAGES)


@dataclass(frozen=True)
class SlowLoopRecord:
    turn_index: int
    name: str
    duration: float


class TurnTimer:
    def __init__(self, record: TurnRecord, clock: Clock, log: "LatencyLog"):
        self._record = record
        self._clock = clock
        self._log = log
        self.closed = False

    @property
    def turn_index(self) -> int:
        return self._record.turn_index

    @contextmanager
    def stage(self, name: str) -> Iterator[None]:
        start = self._clock()
        try:
            yield
        finally:
            self.record_stage(name, self._clock() - start)

    def record_stage(self, name: str, duration: float) -> None:
        self._record.stages[name] = self._record.stages.get(name, 0.0) + duration

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        self._log.finish_turn(self._record)


class LatencyLog:
    """Structured per-call latency log with an injectable clock."""

    def __init__(self, clock: Clock = time.monotonic, call_id: str = ""):
        self.clock = clock
        self.call_id = call_id
        self.records: list[TurnRecord] = []
        self.slow_loop: list[SlowLoopRecord] = []
        self.degradations: list[tuple[int, str]] = []

    def begin_turn(self, turn_index: int) -> TurnTimer:
        return TurnTimer(TurnRecord(turn_index=turn_index), self.clock, self)

    def finish_turn(self, record: TurnRecord) -> None:
        self.records.append(record)
        logger.info(
            "turn_latency %s",
            json.dumps(
                {
                    "call_id": self.call_id,
                    "turn": record.turn_index,
                    "stages_ms": {k: round(v * 1000, 1) for k, v in record.stages.items()},
                    "critical_path_ms": round(record.critical_path_seconds() * 1000, 1),
                }
            ),
        )

    def record_stage_on_last(self, name: str, duration: float) -> None:
        """Attach a stage measured outside the turn loop (e.g. first_byte in
        the LLM endpoint) to the most recent turn record."""
        if self.records:
            record = self.records[-1]
            record.stages[name] = record.stages.get(name, 0.0) + duration

    def record_degradation(self, turn_index: int, reason: str) -> None:
        """A turn that shipped with less context than intended.

        Without this a partially-failed retrieval is indistinguishable from a
        healthy turn in the logs, so a silently-degrading deployment looks
        perfect — and MOSS_PLAN's fail-soft verification ("the latency log
        records the degradation") would be unmeetable."""
        self.degradations.append((turn_index, reason))
        logger.warning(
            "turn_degraded %s",
            json.dumps({"call_id": self.call_id, "turn": turn_index, "reason": reason}),
        )

    def record_slow_loop(self, turn_index: int, name: str, duration: float) -> None:
        """Slow-loop work is logged separately; it is never part of a turn's
        critical path (asserted in CI)."""
        self.slow_loop.append(SlowLoopRecord(turn_index=turn_index, name=name, duration=duration))
        logger.info(
            "slow_loop %s",
            json.dumps(
                {
                    "call_id": self.call_id,
                    "turn": turn_index,
                    "stage": name,
                    "duration_ms": round(duration * 1000, 1),
                }
            ),
        )

    def critical_path_durations(self) -> list[float]:
        return [record.critical_path_seconds() for record in self.records]

    def p95_end_to_first_audio(self) -> float:
        return p95(self.critical_path_durations())


def p95(values: Sequence[float]) -> float:
    """95th percentile via the nearest-rank method; 0.0 for an empty input."""
    if not values:
        return 0.0
    ordered = sorted(values)
    rank = math.ceil(0.95 * len(ordered))
    return ordered[rank - 1]


def assert_latency_budget(
    log: LatencyLog, budget_seconds: float = DEFAULT_BUDGET_SECONDS
) -> None:
    """CI gate: fail when p95 end-of-speech -> first-audio exceeds budget."""
    observed = log.p95_end_to_first_audio()
    if observed > budget_seconds:
        raise LatencyBudgetExceeded(
            f"p95 end-of-speech->first-audio {observed * 1000:.0f}ms exceeds "
            f"budget {budget_seconds * 1000:.0f}ms"
        )
