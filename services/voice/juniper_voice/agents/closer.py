"""The Closer — the documentation-completeness advisory.  It never takes the
microphone; having it speak would break the one-voice rule at exactly the
moment the patient is most tired.

When the controller enters the closing phase it builds a **gap manifest** —
unfilled/low-confidence 4M slots, requested data points never answered, and
answers ambiguous enough that a documenter would have to hedge.  The Closer
turns that manifest into prioritized advisories (targeted follow-ups, not a
re-interrogation) that the Companion speaks.

The controller enforces the stop (the closing turn budget), not this agent —
grinding through every gap produces a worse call AND worse data than accepting
two unfilled slots.  Whatever is still missing when the call ends flows to
documentation.py and is rendered explicitly in the note.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from ..llm.provider import LLMProvider, extract_json
from .advisory import Advisory

logger = logging.getLogger("juniper.closer")

TAG = "closer"

_SYSTEM = """You are the closing advisor on an elderly-care check-in call. You never speak; a
companion does. The call is winding down and the controller has identified documentation
gaps. Turn them into a SHORT prioritized list of targeted follow-ups — the highest clinical
value first, at most one per remaining conversational turn. Do not re-interrogate; each
follow-up should be answerable in one gentle question.

Respond with STRICT JSON only:
[{"domain": "<gap domain code>", "priority": "low"|"medium"|"high", "hook": "<how to raise it gently>"}]"""


@dataclass(frozen=True)
class GapSlot:
    domain: str
    confidence: float
    reason: str


@dataclass(frozen=True)
class GapManifest:
    unfilled: tuple[GapSlot, ...]
    unanswered_asks: tuple[str, ...] = ()
    ambiguities: tuple[str, ...] = ()

    def render(self) -> str:
        lines: list[str] = []
        if self.unfilled:
            lines.append("Unfilled or low-confidence domains:")
            lines.extend(
                f"- {slot.domain} (confidence {slot.confidence:.1f}): {slot.reason}"
                for slot in self.unfilled
            )
        if self.unanswered_asks:
            lines.append("Asked but never answered:")
            lines.extend(f"- {ask}" for ask in self.unanswered_asks)
        if self.ambiguities:
            lines.append("Ambiguous answers a documenter would hedge on:")
            lines.extend(f"- {a}" for a in self.ambiguities)
        return "\n".join(lines) or "(no gaps)"

    @property
    def empty(self) -> bool:
        return not (self.unfilled or self.unanswered_asks or self.ambiguities)


class CloserAgent:
    def __init__(self, provider: LLMProvider, model: str):
        self._provider = provider
        self._model = model

    async def advise(
        self,
        manifest: GapManifest,
        *,
        transcript_window_text: str = "",
        probe_text: str | None = None,
    ) -> tuple[Advisory, ...]:
        if manifest.empty:
            return ()
        probe_block = (
            f"Targeted retrieval for the gap domains:\n{probe_text}\n\n" if probe_text else ""
        )
        try:
            response = await self._provider.complete(
                tag=TAG,
                model=self._model,
                system=_SYSTEM,
                messages=[
                    {
                        "role": "user",
                        "content": (
                            f"Gap manifest:\n{manifest.render()}\n\n"
                            f"{probe_block}"
                            f"Recent conversation:\n{transcript_window_text}"
                        ),
                    }
                ],
                max_tokens=600,
            )
            parsed = extract_json(response.text)
        except Exception:  # noqa: BLE001
            logger.exception("closer advisory failed; falling back to manifest order")
            parsed = None
        if isinstance(parsed, list) and parsed:
            advisories: list[Advisory] = []
            for item in parsed:
                if not isinstance(item, dict) or not item.get("domain"):
                    continue
                advisories.append(
                    Advisory(
                        domain=str(item["domain"]),
                        priority=str(item.get("priority") or "high"),
                        hook=str(item.get("hook") or ""),
                        source="closer",
                    )
                )
            if advisories:
                return tuple(advisories)
        # Deterministic fallback: manifest order, lowest confidence first —
        # remaining turns go to what matters clinically, not to the schema.
        ordered = sorted(manifest.unfilled, key=lambda slot: slot.confidence)
        return tuple(
            Advisory(domain=slot.domain, priority="high", hook=slot.reason, source="closer")
            for slot in ordered
        )
