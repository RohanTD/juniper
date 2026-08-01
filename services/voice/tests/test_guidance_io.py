"""Reading notes for guidance, and writing the guidance document.

Two bugs shipped here and neither was covered, which is why guidance had never
been produced for anybody:

1. **The notes were never read.** Medplum serves an attachment URL as a
   presigned link with a lower-case path segment
   (``https://storage.medplum.com/binary/<id>/…``), and the reader tested
   ``url.startswith("Binary/")``. That was false on every real read, so
   ``findings`` was always empty and the generator correctly concluded there
   was not enough evidence — on a patient with a year of calls behind them.

2. **The document was never written.** The write used a conditional
   ``PUT DocumentReference?subject=…&category=…``. Hosted Medplum does not
   support update-as-create, so a PUT matching nothing fails rather than
   creating — and the post-call pass's best-effort handler swallowed it.
   Guidance is a nicety that must not sink a clinical write, so the failure
   was invisible by design.

Both are the same shape as defects fixed elsewhere in the codebase: the
lower-case `binary/` twin broke every check-in summary in the TypeScript
client, and update-as-create broke every post-call write once already.
"""

from __future__ import annotations

import base64
import json

import pytest

from juniper_voice.medplum import (
    binary_id_from_url,
    read_recent_note_texts,
    write_family_guidance,
)

DEVICE_REF = "Device/juniper-voice-agent"
PATIENT = "pat-1"

PRESIGNED = (
    "https://storage.medplum.com/binary/f1278439-2f1b-49f7-b872-e96e34553138/"
    "1310fde1-58cf-4776-ae8a-4b6c67418354?Expires=1785626316&Signature=abc"
)


@pytest.mark.parametrize(
    "url,expected",
    [
        (PRESIGNED, "f1278439-2f1b-49f7-b872-e96e34553138"),
        ("Binary/abc-123", "abc-123"),
        ("https://api.medplum.com/fhir/R4/Binary/abc-123", "abc-123"),
        ("https://example.com/files/report.txt", None),
        ("https://example.com/notbinary/abc-123", None),
        ("", None),
    ],
)
def test_binary_id_is_read_from_either_url_shape(url, expected):
    assert binary_id_from_url(url) == expected


def seed_note(store, terminology, text: str, date: str, *, presigned: bool) -> None:
    """Seed a Juniper note whose attachment URL takes the given shape."""
    binary = store.seed(
        {
            "resourceType": "Binary",
            "contentType": "text/plain",
            "data": base64.b64encode(text.encode("utf-8")).decode("ascii"),
        }
    )
    url = (
        f"https://storage.medplum.com/binary/{binary['id']}/v1?Expires=1&Signature=x"
        if presigned
        else f"Binary/{binary['id']}"
    )
    store.seed(
        {
            "resourceType": "DocumentReference",
            "status": "current",
            "category": [terminology.note_category("note").as_codeable_concept()],
            "subject": {"reference": f"Patient/{PATIENT}"},
            "date": date,
            "content": [{"attachment": {"contentType": "text/plain", "url": url}}],
        }
    )


async def test_notes_are_read_from_presigned_urls(medplum, terminology):
    """The regression. This is the form every real read comes back in."""
    seed_note(medplum, terminology, "She mentioned the stairs again.", "2026-07-30", presigned=True)

    notes = await read_recent_note_texts(medplum, terminology, PATIENT)

    assert len(notes) == 1
    assert "stairs" in notes[0]["text"]
    assert notes[0]["date"] == "2026-07-30"


async def test_notes_are_still_read_from_plain_references(medplum, terminology):
    seed_note(medplum, terminology, "A quiet call.", "2026-07-20", presigned=False)

    notes = await read_recent_note_texts(medplum, terminology, PATIENT)

    assert len(notes) == 1
    assert notes[0]["text"] == "A quiet call."


async def test_a_note_with_no_readable_content_is_skipped_not_fatal(medplum, terminology):
    medplum.seed(
        {
            "resourceType": "DocumentReference",
            "status": "current",
            "category": [terminology.note_category("note").as_codeable_concept()],
            "subject": {"reference": f"Patient/{PATIENT}"},
            "date": "2026-07-01",
            "content": [{"attachment": {"url": "https://example.com/nowhere.txt"}}],
        }
    )
    seed_note(medplum, terminology, "Real content.", "2026-07-02", presigned=True)

    notes = await read_recent_note_texts(medplum, terminology, PATIENT)

    assert [n["text"] for n in notes] == ["Real content."]


async def test_the_window_is_honoured(medplum, terminology):
    for day in range(1, 6):
        seed_note(medplum, terminology, f"Call {day}", f"2026-07-0{day}", presigned=True)

    notes = await read_recent_note_texts(medplum, terminology, PATIENT, limit=3)

    assert len(notes) == 3


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------


def guidance_docs(store):
    return [
        d
        for d in store.resources.get("DocumentReference", [])
        if any(
            coding.get("code") == "juniper-family-guidance"
            for concept in d.get("category", [])
            for coding in concept.get("coding", [])
        )
    ]


async def test_the_first_write_creates_the_document(medplum, terminology):
    """It never did. A conditional PUT that matches nothing does not create on
    hosted Medplum, and the post-call pass swallowed the failure."""
    result = await write_family_guidance(
        medplum,
        terminology,
        patient_id=PATIENT,
        guidance_json=json.dumps({"suggestions": [], "callsConsidered": 4}),
        date_iso="2026-08-01T12:00:00+00:00",
        device_ref=DEVICE_REF,
        organization_ref=None,
    )

    assert result["document_id"]
    docs = guidance_docs(medplum)
    assert len(docs) == 1
    assert docs[0]["subject"] == {"reference": f"Patient/{PATIENT}"}
    # Guidance spans a run of calls, so it must NOT be pinned to one encounter.
    assert "context" not in docs[0]


async def test_a_second_write_replaces_rather_than_accumulates(medplum, terminology):
    """Guidance is a current view, not a history. A caregiver opening the
    dashboard must see one list, not one per week stacked up."""
    for calls in (3, 7):
        await write_family_guidance(
            medplum,
            terminology,
            patient_id=PATIENT,
            guidance_json=json.dumps({"suggestions": [], "callsConsidered": calls}),
            date_iso="2026-08-01T12:00:00+00:00",
            device_ref=DEVICE_REF,
            organization_ref=None,
        )

    assert len(guidance_docs(medplum)) == 1


async def test_the_binary_is_scoped_to_its_own_document(medplum, terminology):
    """securityContext points at the owning DocumentReference, never the
    Patient — the invariant the whole Binary access model rests on."""
    await write_family_guidance(
        medplum,
        terminology,
        patient_id=PATIENT,
        guidance_json=json.dumps({"suggestions": [], "callsConsidered": 4}),
        date_iso="2026-08-01T12:00:00+00:00",
        device_ref=DEVICE_REF,
        organization_ref=None,
    )

    doc = guidance_docs(medplum)[0]
    binaries = medplum.resources.get("Binary", [])
    written = [b for b in binaries if b.get("securityContext")]
    assert len(written) == 1
    assert written[0]["securityContext"]["reference"] == f"DocumentReference/{doc['id']}"
