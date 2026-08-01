"""The 4M agent — slow-loop coverage advisory.  It never speaks.

Runs every few turns, off the critical path.  Reads the transcript window and
current coverage and emits a short structured advisory (advisory.py schema):
which domain to pursue, at what priority, and any hook from the conversation
worth using to get there — intent, not sentences.

Findings are reported through ``mark_domain_complete(domain, findings,
confidence)`` (a controller callback).  ``findings`` must be loosely
structured per-domain data — a shape ``Goal`` / ``MedicationStatement`` /
``Observation`` can later be derived from — never prose.  Non-mapping
findings are rejected here and by the controller.
"""

from __future__ import annotations

import logging
from typing import Callable, Mapping

from ..llm.provider import LLMProvider, extract_json
from ..terminology import Terminology
from .advisory import Advisory

logger = logging.getLogger("juniper.fourm")

TAG = "fourm"

_SYSTEM = """You are the 4M coverage advisor on an elderly-care check-in call. You never speak to
the patient; a companion does. Your job: read the recent conversation and decide which of the
four domains of geriatric care most needs pursuing next, and report any domain the
conversation has now adequately covered.

Domains (use these exact codes): {domains}

Rules:
- Emit intent, not sentences. The companion writes the actual words.
- The "hook" is a short pointer to something in the conversation the companion can use
  to get there naturally (e.g. "she mentioned a new pharmacy").
- For completed domains, "findings" MUST be a structured JSON object (facts, not prose) —
  e.g. medication: {{"medications": [{{"name": "...", "adherence": "taking as prescribed",
  "issues": []}}]}}; mobility: {{"falls_reported": 1, "fall_details": "...", "aids": ["cane"]}};
  mentation: {{"mood": "...", "memory_concerns": false}}; what-matters: {{"goals": ["..."]}}.
- confidence is 0.0-1.0: how confidently a documenter could write this domain from the
  conversation so far.

Respond with STRICT JSON only:
{{"advisory": {{"domain": "<code>", "priority": "low"|"medium"|"high", "hook": "<short>"}} | null,
  "completed": [{{"domain": "<code>", "findings": {{...}}, "confidence": 0.0}}]}}"""

ReportFn = Callable[[str, Mapping, float], None]


class FourMAgent:
    def __init__(self, provider: LLMProvider, model: str, terminology: Terminology):
        self._provider = provider
        self._model = model
        self._domains = tuple(terminology.fourm_domains().keys())

    async def refresh(
        self,
        *,
        transcript_window_text: str,
        coverage_summary: str,
        brief_text: str,
        digest: str,
        report: ReportFn,
    ) -> Advisory | None:
        """One slow-loop pass: report completed domains via ``report`` and
        return the new standing advisory (or None when nothing to advise)."""
        response = await self._provider.complete(
            tag=TAG,
            model=self._model,
            system=_SYSTEM.format(domains=", ".join(self._domains)),
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"Current coverage state:\n{coverage_summary}\n\n"
                        f"Clinical picture:\n{brief_text}\n\n"
                        f"What we know from past calls:\n{digest}\n\n"
                        f"Recent conversation:\n{transcript_window_text}"
                    ),
                }
            ],
            max_tokens=800,
        )
        parsed = extract_json(response.text)
        if parsed is None:
            logger.warning("4M advisory response unparsable; keeping previous advisory")
            return None

        for completed in parsed.get("completed", []) or []:
            domain = completed.get("domain")
            findings = completed.get("findings")
            confidence = completed.get("confidence", 0.0)
            if domain not in self._domains:
                logger.warning("4M reported unknown domain %r", domain)
                continue
            if not isinstance(findings, Mapping):
                # Structured findings only — prose would force phase 2 to
                # re-parse the note to derive Goal/MedicationStatement/Observation.
                logger.warning("4M findings for %s were not structured; discarded", domain)
                continue
            try:
                report(domain, findings, float(confidence))
            except (TypeError, ValueError):
                logger.exception("4M domain report rejected for %s", domain)

        advisory_raw = parsed.get("advisory")
        if not advisory_raw:
            return None
        domain = advisory_raw.get("domain")
        if domain not in self._domains:
            logger.warning("4M advisory named unknown domain %r", domain)
            return None
        return Advisory(
            domain=domain,
            priority=str(advisory_raw.get("priority") or "medium"),
            hook=str(advisory_raw.get("hook") or ""),
            source="fourm",
        )
