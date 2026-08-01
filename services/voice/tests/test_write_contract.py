"""The narrow write surface: order, shapes, and the Binary security boundary.

docs/PLAN.md's FHIR write contract, asserted resource by resource.  The write
order matters (the Encounter is the anchor everything else hangs off), and so
does every field a clinic depends on: Device authorship, preliminary docStatus,
category codings from the terminology package, relatesTo(transforms) back to
the raw conversation, and — the one that is a genuine access-control boundary
rather than a shape detail — Binary.securityContext.
"""

from __future__ import annotations

from juniper_voice.escalation import EscalationSink
from juniper_voice.medplum import write_post_call

DEVICE_REF = "Device/juniper-voice-agent"
ORG_REF = "Organization/juniper-pilot-clinic"
START = "2026-08-01T15:00:00+00:00"
END = "2026-08-01T15:12:00+00:00"


async def _write(medplum, terminology, *, family: str | None = "family text", tasks=()):
    return await write_post_call(
        medplum,
        terminology,
        patient_id="pat-1",
        note_text="note text",
        transcript_text="transcript text",
        family_summary_text=family,
        call_start_iso=START,
        call_end_iso=END,
        device_ref=DEVICE_REF,
        organization_ref=ORG_REF,
        escalation_tasks=tasks,
    )


def _by_type(medplum, resource_type):
    return [r for _, r in medplum.writes if r["resourceType"] == resource_type]


def _category_code(resource):
    return resource["category"][0]["coding"][0]["code"]


async def test_write_order_anchors_on_the_encounter(medplum, terminology):
    await _write(medplum, terminology)
    order = [r["resourceType"] for _, r in medplum.writes]

    # Encounter first — everything else references it.
    assert order[0] == "Encounter"
    # Then note pair, transcript pair, family pair.
    assert order == [
        "Encounter",
        "Binary",
        "DocumentReference",
        "Binary",
        "DocumentReference",
        "Binary",
        "DocumentReference",
    ]
    docs = _by_type(medplum, "DocumentReference")
    assert [_category_code(d) for d in docs] == [
        "juniper-note",
        "juniper-transcript",
        "juniper-family-summary",
    ]


async def test_only_the_four_contracted_resource_types_are_written(medplum, terminology):
    sink = EscalationSink(clock=lambda: 0.0)
    sink.record(
        call_id="call-1",
        patient_id="pat-1",
        category="cardiac",
        summary="chest pain",
        utterance="my chest hurts",
        actions_taken=("addressed on the call",),
    )
    tasks = sink.build_tasks(
        terminology=terminology, device_ref=DEVICE_REF, owner_ref="Practitioner/pcp-1"
    )
    await _write(medplum, terminology, tasks=tasks)

    written = {r["resourceType"] for _, r in medplum.writes}
    assert written <= {"Encounter", "Binary", "DocumentReference", "Task"}
    # Structured clinical resources are deliberately deferred to phase 2.
    assert not written & {"Goal", "Observation", "MedicationStatement", "Condition"}


async def test_encounter_shape(medplum, terminology):
    await _write(medplum, terminology)
    encounter = _by_type(medplum, "Encounter")[0]

    assert encounter["status"] == "finished"
    assert encounter["class"]["code"] == "VR"  # virtual
    assert encounter["subject"] == {"reference": "Patient/pat-1"}
    assert encounter["period"] == {"start": START, "end": END}
    reason = encounter["reasonCode"][0]["coding"][0]
    assert reason["code"] == "juniper-4m-checkin"
    assert reason["system"] == terminology.encounter_reason("fourMCheckIn").system
    # Device must NOT appear as a participant — Encounter.participant does not
    # accept Device; AI attribution lives on DocumentReference.author.
    for participant in encounter.get("participant", []):
        assert "Device/" not in (participant.get("individual", {}) or {}).get("reference", "")


async def test_document_reference_shape(medplum, terminology):
    result = await _write(medplum, terminology)
    note, transcript, family = _by_type(medplum, "DocumentReference")

    for doc in (note, transcript, family):
        assert doc["status"] == "current"
        # Clinician review is what flips this to 'final'.
        assert doc["docStatus"] == "preliminary"
        # AI-generated text is never attributed to a human clinician.
        assert doc["author"] == [{"reference": DEVICE_REF}]
        assert doc["custodian"] == {"reference": ORG_REF}
        assert doc["subject"] == {"reference": "Patient/pat-1"}
        assert doc["type"]["coding"][0]["code"] == "34748-4"
        # Every document hangs off the same Encounter — the join key.
        assert doc["context"]["encounter"] == [
            {"reference": f"Encounter/{result.encounter_id}"}
        ]
        assert doc["content"][0]["attachment"]["url"].startswith("Binary/")

    # The note is derived from the raw conversation; retaining that link is what
    # makes every clinical claim auditable.
    assert note["relatesTo"][0]["code"] == "transforms"
    assert note["relatesTo"][0]["target"] == {
        "reference": f"DocumentReference/{result.transcript_id}"
    }
    assert family["relatesTo"][0]["target"] == {
        "reference": f"DocumentReference/{result.transcript_id}"
    }
    # The transcript is the source — it transforms nothing.
    assert "relatesTo" not in transcript


async def test_every_binary_carries_security_context_to_its_owning_document(
    medplum, terminology
):
    """The access-control boundary, not a shape detail.

    Medplum cannot scope Binary reads by AccessPolicy criteria — access is
    governed by securityContext.  A Binary pointed at the Patient (or with no
    securityContext at all) would expose the clinical note and the raw
    transcript to any caregiver with patient-compartment visibility.
    """
    result = await _write(medplum, terminology)
    binaries = _by_type(medplum, "Binary")
    docs = _by_type(medplum, "DocumentReference")
    doc_ids = {doc["id"] for doc in docs}

    assert len(binaries) == 3
    for binary in binaries:
        context = binary.get("securityContext")
        assert context is not None, "Binary written without securityContext"
        reference = context["reference"]
        assert reference.startswith("DocumentReference/"), reference
        assert "Patient/" not in reference
        assert reference.split("/", 1)[1] in doc_ids

    # Each document points at the Binary that points back at it.
    for doc in docs:
        binary_id = doc["content"][0]["attachment"]["url"].split("/", 1)[1]
        owner = next(b for b in binaries if b["id"] == binary_id)
        assert owner["securityContext"]["reference"] == f"DocumentReference/{doc['id']}"

    assert result.note_binary_id != result.transcript_binary_id


async def test_escalation_task_shape(medplum, terminology):
    sink = EscalationSink(clock=lambda: 0.0)
    sink.record(
        call_id="call-1",
        patient_id="pat-1",
        category="cardiac",
        summary="reported chest pain since yesterday",
        utterance="my chest has been hurting since yesterday",
        actions_taken=("the companion addressed the concern directly during the call",),
    )
    tasks = sink.build_tasks(
        terminology=terminology,
        device_ref=DEVICE_REF,
        owner_ref="Practitioner/pcp-1",
        owner_display="Dr. Amara Osei",
    )
    result = await _write(medplum, terminology, tasks=tasks)

    task = _by_type(medplum, "Task")[0]
    assert task["status"] == "requested"
    assert task["intent"] == "order"
    assert task["priority"] == "urgent"
    assert task["for"] == {"reference": "Patient/pat-1"}
    assert task["encounter"] == {"reference": f"Encounter/{result.encounter_id}"}
    assert task["requester"] == {"reference": DEVICE_REF}
    # The display is the only way the family app can name who the alert went
    # to: the caregiver AccessPolicy grants neither CareTeam nor Practitioner,
    # so a bare reference resolves to nothing on their side.
    assert task["owner"] == {
        "reference": "Practitioner/pcp-1",
        "display": "Dr. Amara Osei",
    }

    coding = task["code"]["coding"][0]
    assert coding["code"] == "juniper-escalation"
    assert coding["system"] == terminology.task_category("escalation").system

    # A caregiver reading this at 11pm needs it to be self-sufficient: what was
    # said, when, and what has already happened about it.
    description = task["description"]
    assert "chest" in description.lower()
    assert "addressed" in description.lower()
    assert len(result.task_ids) == 1


async def test_no_family_pair_is_written_when_the_summary_is_absent(medplum, terminology):
    result = await _write(medplum, terminology, family=None)

    assert result.family_summary_id is None
    assert len(_by_type(medplum, "Binary")) == 2
    assert len(_by_type(medplum, "DocumentReference")) == 2
