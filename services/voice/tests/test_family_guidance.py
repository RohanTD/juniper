"""Family guidance, and the filters that keep it out of clinical territory.

The feature's whole risk is that a suggestion aimed at a worried family member
is one short step from medical advice, and the step is easy to take by
accident.  These tests exist because docs/PLAN.md's standing rule is that
safety invariants are code paths, not prompts — a prompt that says "don't give
medical advice" is untestable and unenforceable, so the enforcement lives in
:func:`sanitize_suggestions` and is pinned here.
"""

from __future__ import annotations

import json

import pytest

from juniper_voice.guidance import (
    ALLOWED_KINDS,
    CARE_TEAM_SUFFIX,
    GUIDANCE_WINDOW,
    MIN_CALLS_FOR_PATTERN,
    generate_guidance,
    is_clinical_advice,
    sanitize_suggestions,
)
from juniper_voice.llm.provider import FakeProvider
from juniper_voice.terminology import get_terminology

TERMINOLOGY = get_terminology()


def good(**overrides):
    base = {
        "domain": "mobility",
        "kind": "physical-activity",
        "observation": "She's mentioned the stairs feeling harder on three calls.",
        "suggestion": "If you're visiting, a short walk together might be welcome.",
        "supportingCalls": 3,
    }
    base.update(overrides)
    return base


def keep(items, calls=8):
    return sanitize_suggestions(items, terminology=TERMINOLOGY, calls_considered=calls)


# ---------------------------------------------------------------------------
# The closed set of actions
# ---------------------------------------------------------------------------


def test_a_well_formed_suggestion_survives():
    kept, rejected = keep([good()])
    assert len(kept) == 1
    assert rejected == []
    assert kept[0].domain == "mobility"


@pytest.mark.parametrize("kind", sorted(ALLOWED_KINDS))
def test_every_allowed_kind_is_actually_accepted(kind):
    kept, _ = keep([good(kind=kind)])
    assert len(kept) == 1


def test_an_invented_kind_has_nowhere_to_live():
    """The closed set is the primary defence: advice we do not give cannot be
    expressed in a well-formed suggestion."""
    kept, rejected = keep([good(kind="medication-adjustment")])
    assert kept == []
    assert any("not one of the five allowed actions" in r for r in rejected)


def test_no_allowed_kind_can_express_a_medication_change():
    # Stated as an assertion about the vocabulary itself, so adding a kind
    # that reopens this door fails here rather than in production.
    assert not any(
        word in " ".join(ALLOWED_KINDS).lower()
        for word in ("medication", "dose", "drug", "prescription", "treatment", "diagnos")
    )


def test_an_unknown_domain_is_rejected():
    kept, rejected = keep([good(domain="nutrition")])
    assert kept == []
    assert any("unknown domain" in r for r in rejected)


# ---------------------------------------------------------------------------
# The prohibited-content filter, which does not trust the declared kind
# ---------------------------------------------------------------------------


CLINICAL_TEXTS = [
    "Ask her doctor about increasing her blood pressure medication.",
    "She should stop taking the water pill in the evening.",
    "Consider halving the dose of her statin.",
    "Her forgetfulness is a sign of early dementia.",
    "These readings suggest a UTI — she needs to see someone.",
    "Try 500mg of magnesium before bed.",
    "This is the standard treatment for heart failure.",
    "Book an appointment about the swelling.",
    "Wean off the sleeping tablets slowly.",
]


@pytest.mark.parametrize("text", CLINICAL_TEXTS)
def test_clinical_advice_is_recognised(text):
    assert is_clinical_advice(text)


BENIGN_TEXTS = [
    "If you're visiting, a short walk together might be welcome.",
    "She said Tuesdays feel long — a call that afternoon would land well.",
    "A brighter bulb on the landing would make the stairs less daunting.",
    "She's been looking forward to her granddaughter's visit.",
    "Offer to drive her to the shops on Saturday.",
]


@pytest.mark.parametrize("text", BENIGN_TEXTS)
def test_ordinary_family_suggestions_are_not_flagged(text):
    assert not is_clinical_advice(text)


def test_clinical_advice_is_dropped_even_under_an_innocent_kind():
    """A model that wants to give medical advice will label it 'companionship'
    without hesitation, so the declared kind is not evidence of anything."""
    kept, rejected = keep(
        [
            good(
                kind="companionship",
                suggestion="While you're there, ask her doctor about increasing her dose.",
            )
        ]
    )
    assert kept == []
    assert any("clinical advice" in r for r in rejected)


def test_a_clinical_observation_is_dropped_too():
    # Both fields reach the reader, so both are filtered.
    kept, _ = keep([good(observation="Her confusion looks like early dementia.")])
    assert kept == []


def test_rejections_are_reported_rather_than_silently_swallowed():
    """A model drifting toward clinical advice should be visible."""
    _, rejected = keep([good(suggestion="Halve the dose."), good(kind="prescribe")])
    assert len(rejected) == 2


# ---------------------------------------------------------------------------
# Evidence discipline
# ---------------------------------------------------------------------------


def test_one_call_is_an_anecdote_not_a_pattern():
    kept, rejected = keep([good(supportingCalls=1)])
    assert kept == []
    assert any("call(s) of evidence" in r for r in rejected)


def test_a_claim_of_more_evidence_than_exists_is_rejected():
    """The number is load-bearing for how much a family trusts the suggestion."""
    kept, rejected = keep([good(supportingCalls=9)], calls=4)
    assert kept == []
    assert any("claimed 9 calls out of 4" in r for r in rejected)


def test_a_missing_supporting_count_does_not_default_to_trustworthy():
    item = good()
    del item["supportingCalls"]
    kept, _ = keep([item])
    assert kept == []


def test_duplicate_domain_and_kind_collapse():
    kept, rejected = keep([good(), good(suggestion="Another walk.")])
    assert len(kept) == 1
    assert any("duplicate" in r for r in rejected)


def test_two_kinds_within_one_domain_are_fine():
    kept, _ = keep([good(), good(kind="companionship")])
    assert len(kept) == 2


@pytest.mark.parametrize("field", ["observation", "suggestion"])
def test_empty_text_is_rejected(field):
    kept, _ = keep([good(**{field: "   "})])
    assert kept == []


def test_malformed_entries_do_not_crash_the_pass():
    kept, rejected = keep(["not an object", None, good()])
    assert len(kept) == 1
    assert len(rejected) == 2


# ---------------------------------------------------------------------------
# The care-team escape hatch
# ---------------------------------------------------------------------------


def test_care_team_suggestions_carry_our_wording_not_the_models():
    kept, _ = keep(
        [
            good(
                kind="raise-with-care-team",
                suggestion="She's mentioned feeling unsteady when she stands up.",
            )
        ]
    )
    assert kept[0].suggestion.endswith(CARE_TEAM_SUFFIX)


def test_the_suffix_is_not_doubled_when_the_model_already_said_it():
    kept, _ = keep(
        [good(kind="raise-with-care-team", suggestion=f"She seems tired. {CARE_TEAM_SUFFIX}")]
    )
    assert kept[0].suggestion.count(CARE_TEAM_SUFFIX) == 1


# ---------------------------------------------------------------------------
# Generation: consent, evidence, and failure modes
# ---------------------------------------------------------------------------


def findings(n: int):
    return [
        {"date": f"2026-07-{day:02d}", "domains": {"mobility": {"note": "stairs harder"}}}
        for day in range(1, n + 1)
    ]


async def run(provider, *, calls: int = 6, consent: bool = True):
    return await generate_guidance(
        provider,
        findings=findings(calls),
        terminology=TERMINOLOGY,
        model="test-model",
        family_sharing_consent=consent,
    )


async def test_no_consent_means_nothing_is_generated_at_all():
    """PLAN.md locks this: consent-gated AT GENERATION, never
    generated-then-hidden. 'We made it but did not show you' is a different
    promise from 'we did not make it'."""
    provider = FakeProvider({"guidance": ['{"suggestions": []}']})
    guidance = await run(provider, consent=False)
    assert guidance.suggestions == ()
    assert guidance.unavailable_reason
    # The model was never called.
    assert provider.requests == []


async def test_too_few_calls_short_circuits_before_the_model():
    provider = FakeProvider({"guidance": ['{"suggestions": []}']})
    guidance = await run(provider, calls=MIN_CALLS_FOR_PATTERN - 1)
    assert guidance.suggestions == ()
    assert str(MIN_CALLS_FOR_PATTERN) in guidance.unavailable_reason
    assert provider.requests == []


async def test_a_good_response_becomes_guidance():
    provider = FakeProvider({"guidance": [json.dumps({"suggestions": [good()]})]})
    guidance = await run(provider)
    assert len(guidance.suggestions) == 1
    assert guidance.calls_considered == 6


async def test_a_fenced_json_response_is_still_parsed():
    provider = FakeProvider(
        {"guidance": ["```json\n" + json.dumps({"suggestions": [good()]}) + "\n```"]}
    )
    guidance = await run(provider)
    assert len(guidance.suggestions) == 1


async def test_unparseable_output_degrades_to_a_plain_explanation():
    provider = FakeProvider({"guidance": ["I'd suggest taking her for a walk!"]})
    guidance = await run(provider)
    assert guidance.suggestions == ()
    assert guidance.unavailable_reason
    assert not is_clinical_advice(guidance.unavailable_reason)


async def test_an_empty_list_says_so_rather_than_inventing_filler():
    provider = FakeProvider({"guidance": ['{"suggestions": []}']})
    guidance = await run(provider)
    assert guidance.suggestions == ()
    assert "Nothing stood out" in guidance.unavailable_reason


async def test_a_wholly_clinical_response_yields_nothing_shown_to_family():
    provider = FakeProvider(
        {"guidance": [
            json.dumps(
                {
                    "suggestions": [
                        good(suggestion="Ask the doctor to increase her dose."),
                        good(kind="companionship", suggestion="Consider stopping the statin."),
                    ]
                }
            )
        ]}
    )
    guidance = await run(provider)
    assert guidance.suggestions == ()
    assert len(guidance.rejected) == 2


async def test_the_serialized_document_never_leaks_rejections():
    """`rejected` is for our logs. A family member must not read the advice we
    decided not to give them."""
    provider = FakeProvider(
        {"guidance": [json.dumps({"suggestions": [good(), good(suggestion="Halve the dose.")]})]}
    )
    guidance = await run(provider)
    payload = guidance.as_dict()
    assert "rejected" not in payload
    assert "dose" not in json.dumps(payload).lower()


def test_the_window_is_wider_than_the_evidence_threshold():
    # Otherwise a pattern could never be established within one window.
    assert GUIDANCE_WINDOW > MIN_CALLS_FOR_PATTERN
