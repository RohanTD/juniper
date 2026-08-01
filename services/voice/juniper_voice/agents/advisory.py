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
    # Human-readable domain name ("Medication" rather than the raw code). The
    # controller fills this from terminology before the advisory reaches a
    # prompt; the Companion should never be told to pursue a slug.
    display: str = ""
    # True for the FIRST clinical intent of the call — the moment the
    # conversation crosses out of small talk. Set once by the controller.
    opening: bool = False

    def __post_init__(self) -> None:
        if self.priority not in PRIORITIES:
            object.__setattr__(self, "priority", "medium")

    def escalated(self) -> "Advisory":
        """Mechanical priority escalation: the advisory stops being advice and
        becomes a required intent the Companion must act on next turn."""
        return replace(self, required=True, priority="high", source="controller")

    def as_prompt_line(self) -> str:
        """Render the intent for the Companion's prompt.

        Wording matters more than it looks. The previous phrasing — "REQUIRED
        INTENT (must be acted on this turn): cover the 'medication' domain
        now" — read as a command against a raw slug, and produced audible
        topic-yanking mid-sentence ("That's nice that Maya called, Peggy, now
        about those medications..."). It also fought the persona's "weave
        naturally, never interrogate" instruction, and an explicit command
        wins that fight every time.

        So this now states a GOAL in human words and says how to get there.
        The escalation MECHANISM is untouched — ``required`` is still set
        mechanically by the controller and still expressed with real
        insistence, because a rapport-driven Companion reliably under-pushes
        on clinical extraction (docs/PLAN.md's "mechanical teeth"). What
        changed is that insistence now sounds like a person steering a
        conversation rather than a form demanding a field.
        """
        topic = self.display or self.domain
        hook = (
            f" There's a natural way in: {self.hook}."
            if self.hook
            else " If there's no natural opening, make one gently."
        )
        if self.opening:
            # The crossing from small talk into clinical talk is the single
            # most jarring moment in the call — it is where the old build
            # produced "That's nice that Maya called, Peggy, now about those
            # medications...". Ask for a specific three-beat shape rather than
            # a bare topic: close their thread, turn tentatively, invite.
            return (
                f"This is the first time the call turns toward anything clinical, so "
                f"ease into it. Acknowledge what they just told you and let that thread "
                f"close, then raise {topic} lightly — \"I was wondering about...\", "
                f"\"anything you'd want to share about...\". Make it an invitation they "
                f"can take or leave, not a question they owe you an answer to.{hook}"
            )
        if self.required:
            return (
                f"NEEDED THIS TURN: you still haven't heard about {topic}, and it "
                f"can't wait any longer. Get there this turn — bridge from what they "
                f"just said rather than changing the subject on them.{hook}"
            )
        if self.priority in ("high", "urgent"):
            # High priority without the required flag: steer firmly, but the
            # "drop it if it doesn't fit" licence would be wrong here — this is
            # also the shape the closing recap-and-goodbye arrives in.
            return f"Steer toward this now: {topic}.{hook}"
        return (
            f"Worth steering toward ({self.priority} priority): {topic}. Only if it "
            f"fits what they just said — if it doesn't, let it go this turn.{hook}"
        )
