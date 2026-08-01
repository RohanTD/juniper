"""Family guidance — "what could I actually do about this?"

A caregiver reading a timeline of check-ins can see that their mother has
mentioned the stairs three times and still not know what they are supposed to
*do*.  This module turns a run of calls into a short list of concrete,
non-clinical suggestions: take her for a walk, visit on the day she said she
gets lonely, put a light on the landing.

## Why it lives here and not in the family app

The obvious place to build this is the dashboard — read the notes, summarise
them.  That is impossible by design, and correctly so: the caregiver
AccessPolicy admits only ``juniper-family-summary`` and hides ``juniper-note``
and ``juniper-transcript`` outright.  The family app cannot read the material
this needs and must never be able to.  So generation happens here, in the
service that already holds broad read, and the app reads only the finished
product — one more consent-gated document of a category it is allowed to see.

## What it is allowed to say

This is the part that matters.  A suggestion aimed at a worried family member
about their parent's health is one short step from medical advice, and the
step is easy to take by accident — "her blood pressure readings look high, ask
about upping the dose" is a plausible sentence for a language model and an
unacceptable one for this product.

Safety here is a code path, not a prompt (docs/PLAN.md's standing rule):

1. **A closed set of suggestion kinds** (:data:`ALLOWED_KINDS`).  Every
   suggestion must map onto one of five things a family member can do —
   spend time, encourage movement, adjust the home, support a routine, or
   raise something with the care team.  There is deliberately no kind that can
   express a medication change, a diagnosis, or a treatment, so the model
   cannot produce one *in a well-formed suggestion* even if it tries.
2. **A prohibited-content filter** (:func:`is_clinical_advice`) applied to the
   free text regardless of kind, because a model that wants to give medical
   advice will happily label it ``companionship``.  Anything mentioning doses,
   starting or stopping a drug, or a diagnosis is dropped — not rewritten,
   dropped.  A suggestion we cannot vouch for is worth less than no suggestion.
3. **Clinical concerns route to the care team, never to advice.**  The
   ``raise-with-care-team`` kind exists so the model has somewhere legitimate
   to put a worry, and its copy is fixed by us, not by the model.
4. **Never the first place a serious concern surfaces.**  Urgency is handled
   on the call, in real time, by the escalation path that writes a ``Task``.
   This is explicitly the slow, non-urgent lane; :data:`MIN_CALLS_FOR_PATTERN`
   stops a single passing remark from being dressed up as a trend.

The result is a feature that can say "she's mentioned feeling unsteady on the
stairs in three of her last four calls — if you're visiting, a walk together
might be welcome" and structurally cannot say "she should stop taking her
water pill".
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping, Sequence

from .llm.provider import LLMProvider
from .terminology import Terminology

#: How many calls of evidence before a pattern may be claimed.  One call is an
#: anecdote; presenting it as a trend to an anxious family member is the exact
#: over-reading this feature could most easily cause.
MIN_CALLS_FOR_PATTERN = 3

#: How many recent calls feed one generation pass.
GUIDANCE_WINDOW = 8

#: The only things a family member is ever asked to do.
#:
#: Read this as the feature's actual specification: if a suggestion does not
#: fit one of these, Juniper does not make it.
ALLOWED_KINDS: dict[str, str] = {
    "companionship": "Spend time together — a visit, a call, a shared meal.",
    "physical-activity": "Encourage gentle movement the patient already can do.",
    "home-safety": "Change something about the home or its lighting or clutter.",
    "routine-support": "Help an existing routine happen — a reminder, a lift, a shopping trip.",
    "raise-with-care-team": "Bring something to the attention of the clinicians.",
}

#: Fixed copy for the escape hatch, so the wording of "talk to a clinician"
#: is ours rather than the model's.
CARE_TEAM_SUFFIX = "Worth mentioning to their care team at the next appointment."

# Words for a thing that is prescribed, and for changing one.  Matched on
# stems, not whole words — the first version of this filter missed "increasing
# her medication" and "stopping the statin" because it looked for "increase"
# and "stop", which is exactly the kind of near-miss that would ship.
_DRUG = (
    r"(?:medication|medicine|drug|pill|tablet|capsule|prescription|dose|dosage"
    r"|insulin|statin|antibiotic|painkiller|inhaler|supplement)"
)
_CHANGE = (
    r"(?:increas|decreas|reduc|lower|rais|doubl|halv|skip|stopp?|start|switch"
    r"|chang|adjust|titrat|wean)\w*"
)

# Anything matching these is dropped outright.  Deliberately broad: a false
# positive costs one suggestion, a false negative is a family member acting on
# medical advice from a companionship app.
_CLINICAL_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        # Dose and regimen changes, in any phrasing or direction.
        r"\b(?:dose|dosage|milligram|titrat\w*)\b",
        r"\d\s*(?:mg|mcg|ml|g)\b",
        rf"\b{_CHANGE}[^.]{{0,40}}\b{_DRUG}",
        rf"\b{_DRUG}\b[^.]{{0,40}}\b{_CHANGE}",
        r"\bstop\w*\s+taking\b|\bcome\s+off\b|\bwean\w*\s+off\b",
        # Diagnosis and treatment claims.
        r"\b(?:diagnos\w+|prognos\w+|symptom of|sign of|indicat\w+ of"
        r"|likely has|probably has|suggests? an?)\b",
        r"\b(?:treat|treatment for|cure|remedy for|therapy for)\b",
        r"\b(?:dementia|alzheimer\w*|depression|stroke|heart failure|infection|uti)\b",
        # Directing care that is not the family's to direct.
        r"\b(?:should see|needs? to see|book an appointment"
        r"|go to (?:the )?(?:er|a&e|emergency)|call 911)\b",
    )
)


def is_clinical_advice(text: str) -> bool:
    """True when this text strays into territory the product must not enter.

    Applied to every suggestion regardless of its declared kind — a model that
    wants to give medical advice will label it ``companionship`` without
    hesitation, so the kind is not evidence of anything.
    """
    return any(pattern.search(text) for pattern in _CLINICAL_PATTERNS)


@dataclass(frozen=True)
class Suggestion:
    """One thing a family member could do, and why it is being suggested."""

    #: 4M domain code, from terminology — never an inline string.
    domain: str
    kind: str
    #: What was noticed, in the family's language. Drawn from the call, never
    #: from the clinical note's assessment.
    observation: str
    #: The concrete thing to do.
    suggestion: str
    #: How many of the recent calls support the observation.
    supporting_calls: int

    def as_dict(self) -> dict[str, Any]:
        return {
            "domain": self.domain,
            "kind": self.kind,
            "observation": self.observation,
            "suggestion": self.suggestion,
            "supportingCalls": self.supporting_calls,
        }


@dataclass(frozen=True)
class Guidance:
    """The document the family app renders."""

    suggestions: tuple[Suggestion, ...] = ()
    #: Calls considered. Shown to the reader so "based on 6 recent calls" is
    #: a claim they can weigh rather than an oracle.
    calls_considered: int = 0
    #: Set when nothing could be said, with the reason in plain language.
    unavailable_reason: str | None = None
    #: Suggestions the filters removed. Not shown to families; logged so a
    #: model drifting toward clinical advice is visible rather than silent.
    rejected: tuple[str, ...] = field(default=())

    def as_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "suggestions": [s.as_dict() for s in self.suggestions],
            "callsConsidered": self.calls_considered,
        }
        if self.unavailable_reason:
            payload["unavailableReason"] = self.unavailable_reason
        return payload


def _coerce_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def sanitize_suggestions(
    raw: Iterable[Mapping[str, Any]],
    *,
    terminology: Terminology,
    calls_considered: int,
) -> tuple[list[Suggestion], list[str]]:
    """Apply every filter to model output.  Returns ``(kept, rejected_reasons)``.

    Split out from :func:`generate_guidance` so the safety rules are testable
    without an LLM, which is the only way they can be trusted.
    """
    valid_domains = set(terminology.fourm_domains())
    kept: list[Suggestion] = []
    rejected: list[str] = []
    seen: set[tuple[str, str]] = set()

    for item in raw:
        if not isinstance(item, Mapping):
            rejected.append("not an object")
            continue
        domain = str(item.get("domain", "")).strip()
        kind = str(item.get("kind", "")).strip()
        observation = str(item.get("observation", "")).strip()
        suggestion = str(item.get("suggestion", "")).strip()
        supporting = _coerce_int(item.get("supportingCalls"), 0)

        if domain not in valid_domains:
            rejected.append(f"unknown domain {domain!r}")
            continue
        if kind not in ALLOWED_KINDS:
            # The closed set doing its job: anything the model invented to
            # carry advice we do not give has nowhere to live.
            rejected.append(f"kind {kind!r} is not one of the five allowed actions")
            continue
        if not observation or not suggestion:
            rejected.append("empty observation or suggestion")
            continue
        if is_clinical_advice(observation) or is_clinical_advice(suggestion):
            rejected.append(f"clinical advice: {suggestion[:80]!r}")
            continue
        if supporting < MIN_CALLS_FOR_PATTERN:
            rejected.append(
                f"only {supporting} call(s) of evidence, need {MIN_CALLS_FOR_PATTERN}"
            )
            continue
        if supporting > calls_considered:
            # A model claiming more evidence than exists is not a rounding
            # error; the number is load-bearing for how much a family trusts it.
            rejected.append(f"claimed {supporting} calls out of {calls_considered}")
            continue
        if (domain, kind) in seen:
            rejected.append(f"duplicate {domain}/{kind}")
            continue
        seen.add((domain, kind))

        if kind == "raise-with-care-team" and CARE_TEAM_SUFFIX not in suggestion:
            suggestion = f"{suggestion} {CARE_TEAM_SUFFIX}".strip()

        kept.append(
            Suggestion(
                domain=domain,
                kind=kind,
                observation=observation,
                suggestion=suggestion,
                supporting_calls=supporting,
            )
        )
    return kept, rejected


GUIDANCE_SYSTEM_PROMPT = """You help the family of an elderly person turn what \
came up on their recent check-in calls into a few things they could actually do.

You are writing for a son or daughter, not for a clinician. They are not \
medically trained and cannot act on medical instructions.

Rules:
- Every suggestion must be one of exactly these kinds:
{kinds}
- Never mention medications, doses, diagnoses, treatments, or symptoms as \
evidence of a condition. If something worries you clinically, use the \
"raise-with-care-team" kind and describe only what was said.
- Only claim a pattern you can support from at least {min_calls} separate \
calls. Set supportingCalls to the real number.
- Quote what the patient actually said or reported. Never infer a mood or a \
decline they did not describe.
- At most 3 suggestions. Fewer is better. If nothing stands out, return an \
empty list — a family that gets nothing this week is better served than one \
given filler.

Return JSON only: {{"suggestions": [{{"domain": "<4M domain code>", \
"kind": "<kind>", "observation": "<what came up, in their words>", \
"suggestion": "<the concrete thing to do>", "supportingCalls": <int>}}]}}"""


def build_guidance_prompt(findings: Sequence[Mapping[str, Any]]) -> str:
    """Render recent per-call 4M findings as the model's only input.

    Structured findings, not note prose. docs/PLAN.md keeps
    ``mark_domain_complete(domain, findings, confidence)`` loosely structured
    precisely so downstream consumers do not have to re-parse a narrative —
    this is the first consumer to take it up on that.
    """
    lines: list[str] = []
    for index, call in enumerate(findings, start=1):
        date = call.get("date") or "unknown date"
        lines.append(f"Call {index} ({date}):")
        domains = call.get("domains") or {}
        if not domains:
            lines.append("  (nothing recorded)")
        for domain, detail in domains.items():
            lines.append(f"  {domain}: {json.dumps(detail, ensure_ascii=False)}")
    return "\n".join(lines)


async def generate_guidance(
    provider: LLMProvider,
    *,
    findings: Sequence[Mapping[str, Any]],
    terminology: Terminology,
    model: str,
    family_sharing_consent: bool,
) -> Guidance:
    """Produce family guidance from recent calls, or explain why not.

    **Consent is checked before generation, never after.** docs/PLAN.md locks
    this: a summary generated and then withheld has already been written down,
    and "we made it but did not show you" is not the same promise as "we did
    not make it". The same rule applies here.
    """
    if not family_sharing_consent:
        return Guidance(
            unavailable_reason=(
                "This is only shared when the patient has agreed to share with family."
            )
        )
    calls_considered = len(findings)
    if calls_considered < MIN_CALLS_FOR_PATTERN:
        return Guidance(
            calls_considered=calls_considered,
            unavailable_reason=(
                f"Juniper waits for {MIN_CALLS_FOR_PATTERN} calls before suggesting "
                "anything, so a single conversation isn't mistaken for a pattern."
            ),
        )

    kinds = "\n".join(f"  - {kind}: {why}" for kind, why in ALLOWED_KINDS.items())
    system = GUIDANCE_SYSTEM_PROMPT.format(kinds=kinds, min_calls=MIN_CALLS_FOR_PATTERN)
    response = await provider.complete(
        tag="guidance",
        model=model,
        system=system,
        messages=[{"role": "user", "content": build_guidance_prompt(findings)}],
    )
    try:
        payload = json.loads(_strip_code_fence(response.text))
        raw = payload.get("suggestions", []) if isinstance(payload, Mapping) else []
    except (json.JSONDecodeError, AttributeError):
        return Guidance(
            calls_considered=calls_considered,
            unavailable_reason="Juniper couldn't put suggestions together this time.",
        )

    kept, rejected = sanitize_suggestions(
        raw if isinstance(raw, list) else [],
        terminology=terminology,
        calls_considered=calls_considered,
    )
    return Guidance(
        suggestions=tuple(kept),
        calls_considered=calls_considered,
        rejected=tuple(rejected),
        unavailable_reason=None if kept else "Nothing stood out across the recent calls.",
    )


def _strip_code_fence(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*", "", stripped)
        stripped = re.sub(r"\s*```$", "", stripped)
    return stripped
