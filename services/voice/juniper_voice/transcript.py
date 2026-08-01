"""TranscriptBuffer — durable, append-only, full-turn, never reset.

This is the source of truth for documentation.  Summaries are prompt context,
never the clinical record: the post-call pass reads the *complete* transcript
(see docs/PLAN.md "Safety rules").  There is deliberately no clear/reset API.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable, Iterable

PATIENT = "patient"
COMPANION = "companion"
SYSTEM = "system"

_LABELS = {PATIENT: "PATIENT", COMPANION: "COMPANION", SYSTEM: "SYSTEM"}


@dataclass(frozen=True)
class TranscriptEntry:
    index: int
    speaker: str
    text: str
    at: float  # clock timestamp (injectable clock)

    def render(self) -> str:
        label = _LABELS.get(self.speaker, self.speaker.upper())
        return f"{label}: {self.text}"


class TranscriptBuffer:
    def __init__(self, clock: Callable[[], float] = time.time):
        self._clock = clock
        self._entries: list[TranscriptEntry] = []

    def append(self, speaker: str, text: str) -> TranscriptEntry:
        entry = TranscriptEntry(
            index=len(self._entries), speaker=speaker, text=text, at=self._clock()
        )
        self._entries.append(entry)
        return entry

    @property
    def entries(self) -> tuple[TranscriptEntry, ...]:
        return tuple(self._entries)

    def __len__(self) -> int:
        return len(self._entries)

    def window(self, size: int) -> tuple[TranscriptEntry, ...]:
        """The most recent ``size`` entries (prompt context only)."""
        if size <= 0:
            return ()
        return tuple(self._entries[-size:])

    @staticmethod
    def render_entries(entries: Iterable[TranscriptEntry]) -> str:
        return "\n".join(entry.render() for entry in entries)

    def render(self) -> str:
        """The complete transcript, rendered.  This — never a summary — is
        what the documentation pass consumes."""
        return self.render_entries(self._entries)

    def render_window(self, size: int) -> str:
        return self.render_entries(self.window(size))

    def patient_entries(self) -> tuple[TranscriptEntry, ...]:
        return tuple(e for e in self._entries if e.speaker == PATIENT)
