"""Urgency filter — classifies patient input, runs in parallel with the
Companion (it needs only what was said, not the outgoing message), so the most
safety-critical component adds zero latency.

On a trip the controller both forces the Companion to address the concern and
fires the escalation sink immediately — without waiting for the post-call
pass.  That wiring lives in controller.py; this module only classifies.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from ..llm.provider import LLMProvider, extract_json

logger = logging.getLogger("juniper.urgency")

TAG = "urgency"

_SYSTEM = """You are a clinical triage classifier on a phone check-in call with an elderly patient.
Classify ONLY the patient's most recent utterance for anything that needs prompt attention:
new or worsening chest pain, trouble breathing, a fall, stroke signs, bleeding, medication
overdose or dangerous mix-ups, acute confusion, thoughts of self-harm, or any symptom that
should not wait for a routine visit.

Respond with STRICT JSON only:
{"urgent": true|false,
 "category": "chest-pain"|"breathing"|"fall"|"stroke"|"bleeding"|"medication-harm"|"acute-confusion"|"self-harm"|"other",
 "summary": "<one factual sentence describing the concern>",
 "directive": "<the concrete clinical direction the companion must give, e.g. 'call your doctor today about the chest pain'>"}

Do NOT mark urgent:
- the patient complaining about, describing, or quoting this call itself ("why do you keep
  asking", "it's asking me if I'm ending my life") — that is commentary on the conversation,
  not a report of their own state
- sadness, loneliness or frustration alone, with no danger sign and no thought of self-harm —
  low mood belongs in the visit note, not an urgent alert
Over-alerting is its own harm: it teaches the family to ignore the alert that matters.

If nothing is urgent: {"urgent": false, "category": "other", "summary": "", "directive": ""}."""

# Deterministic backstop used only when the model call itself fails: a broken
# classifier must degrade toward escalation, not toward silence.
_RED_FLAGS = (
    "chest pain", "chest hurts", "can't breathe", "cannot breathe",
    "trouble breathing", "i fell", "took too many", "bleeding",
)


@dataclass(frozen=True)
class UrgencyResult:
    urgent: bool
    category: str = "other"
    summary: str = ""
    directive: str = ""


class UrgencyFilter:
    def __init__(self, provider: LLMProvider, model: str):
        self._provider = provider
        self._model = model

    async def classify(self, patient_text: str) -> UrgencyResult:
        try:
            response = await self._provider.complete(
                tag=TAG,
                model=self._model,
                system=_SYSTEM,
                messages=[{"role": "user", "content": patient_text}],
                max_tokens=300,
            )
            parsed = extract_json(response.text)
        except Exception:  # noqa: BLE001
            logger.exception("urgency classification failed; using keyword backstop")
            parsed = None
        if parsed is None:
            lowered = patient_text.lower()
            if any(flag in lowered for flag in _RED_FLAGS):
                return UrgencyResult(
                    urgent=True,
                    category="other",
                    summary=f"Possible urgent concern (classifier unavailable): {patient_text!r}",
                    directive="tell the patient to contact their doctor today about what they just described",
                )
            return UrgencyResult(urgent=False)
        return UrgencyResult(
            urgent=bool(parsed.get("urgent")),
            category=str(parsed.get("category") or "other"),
            summary=str(parsed.get("summary") or ""),
            directive=str(parsed.get("directive") or ""),
        )
