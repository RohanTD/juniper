"""Shared advisory schema emitted by the 4M agent and the Closer.

Advisors emit intent, not sentences: an advisory is short and structured —
which domain to pursue, at what priority, and any conversational hook worth
using to get there.  The Companion writes the actual line.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

PRIORITIES = ("low", "medium", "high", "urgent")


@dataclass(frozen=True)
class Advisory:
    domain: str  # a 4M domain code (terminology) or a controller-level intent
    priority: str  # one of PRIORITIES
    hook: str  # conversational hook, e.g. "she mentioned a new pharmacy"
    required: bool = False  # set mechanically by the controller, never by an agent
    source: str = "fourm"  # "fourm" | "closer" | "controller"

    def __post_init__(self) -> None:
        if self.priority not in PRIORITIES:
            object.__setattr__(self, "priority", "medium")

    def escalated(self) -> "Advisory":
        """Mechanical priority escalation: the advisory stops being advice and
        becomes a required intent the Companion must act on next turn."""
        return replace(self, required=True, priority="high", source="controller")

    def as_prompt_line(self) -> str:
        hook = f" Hook: {self.hook}" if self.hook else ""
        if self.required:
            return (
                f"REQUIRED INTENT (must be acted on this turn): cover the "
                f"'{self.domain}' domain now.{hook}"
            )
        return f"Advisory ({self.priority}): pursue the '{self.domain}' domain.{hook}"
