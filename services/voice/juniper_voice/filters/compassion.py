"""Compassion filter — the only filter on the critical path, kept cheap.

Binary pass/flag on outgoing text.  It screens for harshness AND for
condescension/"elder-speak" (a documented harm in geriatrics — a filter tuned
solely toward gentleness drifts straight into it), and it independently
enforces the Context Brain's negative constraints rather than trusting the
Companion to have honoured them.

It MAY NOT weaken an urgency-driven clinical directive.  That precedence is a
code path in controller.py (urgency-driven turns are never rewritten), not a
prompt instruction here.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Sequence

from ..llm.provider import LLMProvider, extract_json

logger = logging.getLogger("juniper.compassion")

TAG = "compassion"

_SYSTEM = """You screen a single outgoing utterance from a warm phone companion to an elderly patient.
Flag the utterance if ANY of the following apply:
1. HARSHNESS — cold, blunt, dismissive, or frightening phrasing.
2. CONDESCENSION / ELDER-SPEAK — patronizing tone: collective "we" for the patient's own actions
   ("are we remembering our pills?"), baby talk, diminutives ("sweetie", "dear"), exaggerated
   simplification, or talking about the patient as if they were a child. This is as important
   as harshness: do not let gentleness shade into patronizing.
3. NEGATIVE-CONSTRAINT VIOLATION — the utterance mentions or alludes to any forbidden topic
   listed below. These are hard prohibitions from the patient's own record.

Forbidden topics for this patient:
{constraints}

Respond with STRICT JSON only:
{{"pass": true|false, "reasons": ["harshness"|"condescension"|"constraint"|"..."],
  "violated_constraints": ["<the forbidden topic hit, verbatim from the list>"]}}"""


@dataclass(frozen=True)
class CompassionVerdict:
    passed: bool
    reasons: tuple[str, ...] = ()
    violated_constraints: tuple[str, ...] = ()


class CompassionFilter:
    def __init__(self, provider: LLMProvider, model: str):
        self._provider = provider
        self._model = model

    async def review(
        self,
        text: str,
        *,
        negative_constraints: Sequence[str] = (),
    ) -> CompassionVerdict:
        constraints = "\n".join(f"- {c}" for c in negative_constraints) or "(none)"
        try:
            response = await self._provider.complete(
                tag=TAG,
                model=self._model,
                system=_SYSTEM.format(constraints=constraints),
                messages=[{"role": "user", "content": text}],
                max_tokens=300,
            )
            parsed = extract_json(response.text)
        except Exception:  # noqa: BLE001
            # The filter failing must not block the call — fail open, log loudly.
            logger.exception("compassion review failed; passing utterance unfiltered")
            parsed = None
        if parsed is None:
            return CompassionVerdict(passed=True)
        return CompassionVerdict(
            passed=bool(parsed.get("pass", True)),
            reasons=tuple(str(r) for r in parsed.get("reasons", []) or []),
            violated_constraints=tuple(
                str(c) for c in parsed.get("violated_constraints", []) or []
            ),
        )
