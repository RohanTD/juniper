"""Transcript replay — the primary documentation loop (PLAN.md Verification).

FakeProvider returns deterministic canned notes *derived from the request
prompt*: a planted finding can only land in the note if its evidence actually
reached the documentation prompt.  A second test asserts the pipeline passes
the FULL transcript — every turn, verbatim — never a summary.
"""

from __future__ import annotations

import pytest
from conftest import all_fixture_names, buffer_from_fixture, load_fixture

from juniper_voice.documentation import NOTE_TAG, generate_clinical_note
from juniper_voice.llm.provider import FakeProvider


def make_note_handler(fixture):
    """Canned note derived from fixture content: includes a planted finding's
    note text only when its evidence is present in the prompt we received."""

    def handler(request):
        prompt = request.prompt_text()
        lines = [f"JUNIPER 4M CHECK-IN NOTE — {fixture['name']}"]
        for planted in fixture["planted_findings"]:
            if planted["evidence"] in prompt:
                lines.append(planted["note_text"])
        return "\n".join(lines)

    return handler


@pytest.mark.parametrize("name", all_fixture_names())
async def test_every_planted_finding_lands_in_the_note(name):
    fixture = load_fixture(name)
    provider = FakeProvider()
    provider.script(NOTE_TAG, make_note_handler(fixture))
    transcript_text = buffer_from_fixture(fixture).render()

    note = await generate_clinical_note(
        provider, "claude-opus-5", transcript_text=transcript_text
    )

    for planted in fixture["planted_findings"]:
        assert planted["note_text"] in note, (
            f"planted finding missing from note for fixture {name!r}: "
            f"{planted['note_text']!r}"
        )


@pytest.mark.parametrize("name", all_fixture_names())
async def test_documentation_prompt_contains_the_full_transcript(name):
    fixture = load_fixture(name)
    provider = FakeProvider()
    provider.script(NOTE_TAG, make_note_handler(fixture))
    transcript_text = buffer_from_fixture(fixture).render()

    await generate_clinical_note(
        provider, "claude-opus-5", transcript_text=transcript_text
    )

    (request,) = provider.requests_for(NOTE_TAG)
    prompt = request.prompt_text()
    # Every single turn — patient and companion — must be present verbatim.
    # A summarizer that drops "I've been dizzy standing up" is a safety miss.
    for turn in fixture["turns"]:
        assert turn["text"] in prompt, (
            f"turn missing from documentation prompt in fixture {name!r}: "
            f"{turn['text'][:60]!r}"
        )
