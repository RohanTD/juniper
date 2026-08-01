"""The projection layer: chart documents, core header, transcript chunking,
retrieval state, and the purge path.

The property that makes durable PHI storage defensible is exercised end to
end here: projection is DERIVABLE (same stores in, same documents out — so a
deleted index costs rebuild time and nothing else), and purge is DURABLE
(a failed deletion is recorded, blocks moss mode, and is retried).
"""

from __future__ import annotations

import asyncio

import pytest

from juniper_voice.context_brain import ContextBrain, chunk_transcript
from juniper_voice.medplum import (
    compile_core_header,
    compile_patient_context,
    extract_chart_documents,
)
from juniper_voice.retrieval import MossRetrieval, RetrievalStateStore

from conftest import seed_full_patient


# ---------------------------------------------------------------------------
# Chart documents
# ---------------------------------------------------------------------------

async def _context(medplum, terminology):
    return await compile_patient_context(medplum, "pat-1", terminology, now_iso="2026-08-01T12:00:00+00:00")


async def test_one_resource_one_document(medplum, terminology):
    seed_full_patient(medplum, terminology)
    context = await _context(medplum, terminology)
    docs = extract_chart_documents(context.snapshot)

    by_domain: dict[str, int] = {}
    for doc in docs:
        by_domain[doc.metadata["domain"]] = by_domain.get(doc.metadata["domain"], 0) + 1

    assert by_domain["condition"] == 1
    assert by_domain["medication"] == 1
    assert by_domain["allergy"] == 1
    assert by_domain["observation"] == 1
    assert by_domain["encounter"] == 1
    assert by_domain["appointment"] == 1
    assert by_domain["goal"] == 1

    med = next(d for d in docs if d.metadata["domain"] == "medication")
    assert "Metformin 500mg" in med.text
    assert "twice daily with meals" in med.text  # dosage detail lives in retrieval

    # Ids are stable across projections — the derivable-projection property.
    docs2 = extract_chart_documents((await _context(medplum, terminology)).snapshot)
    assert [d.id for d in docs] == [d.id for d in docs2]
    assert [d.text for d in docs] == [d.text for d in docs2]


async def test_component_observations_render_in_documents(medplum, terminology):
    seed_full_patient(medplum, terminology)
    medplum.seed(
        {
            "resourceType": "Observation",
            "id": "obs-bp",
            "subject": {"reference": "Patient/pat-1"},
            "code": {"text": "Blood pressure"},
            "effectiveDateTime": "2026-07-29",
            "component": [
                {"code": {"text": "Systolic blood pressure"}, "valueQuantity": {"value": 136, "unit": "mmHg"}},
                {"code": {"text": "Diastolic blood pressure"}, "valueQuantity": {"value": 78, "unit": "mmHg"}},
            ],
        }
    )
    context = await _context(medplum, terminology)
    docs = extract_chart_documents(context.snapshot)
    bp = next(d for d in docs if d.id == "observation-obs-bp")
    assert "136" in bp.text and "78" in bp.text


async def test_watermark_is_captured_before_the_read(medplum, terminology):
    """The classic race: a watermark taken AFTER the read loses any change
    that lands during the read window, forever. The snapshot must carry the
    read-start time."""
    seed_full_patient(medplum, terminology)
    context = await compile_patient_context(
        medplum, "pat-1", terminology, now_iso="2026-08-01T12:00:00+00:00"
    )
    assert context.snapshot.read_started_at == "2026-08-01T12:00:00+00:00"


async def test_delta_filter_selects_only_changed_documents(medplum, terminology):
    """The client-side delta: only documents newer than the watermark are
    upserted; documents with no lastUpdated are treated as always-changed
    (an extra upsert is safe; a missed one is not)."""
    seed_full_patient(medplum, terminology)
    medplum.seed(
        {
            "resourceType": "Condition",
            "id": "cond-new",
            "subject": {"reference": "Patient/pat-1"},
            "code": {"text": "New atrial fibrillation"},
            "meta": {"lastUpdated": "2026-07-30T00:00:00+00:00"},
        }
    )
    context = await _context(medplum, terminology)
    docs = extract_chart_documents(context.snapshot)

    watermark = "2026-07-01T00:00:00+00:00"
    changed = [d for d in docs if not d.last_updated or d.last_updated > watermark]
    unchanged_dropped = [d for d in docs if d.last_updated and d.last_updated <= watermark]

    new_condition = next(d for d in docs if d.id == "condition-cond-new")
    assert new_condition in changed
    # Seeded fixtures carry no meta.lastUpdated → all treated as changed.
    assert not unchanged_dropped


# ---------------------------------------------------------------------------
# Core header — the pinned context
# ---------------------------------------------------------------------------

async def test_core_header_is_small_and_carries_the_pinned_facts(medplum, terminology):
    seed_full_patient(medplum, terminology)
    context = await _context(medplum, terminology)
    header = compile_core_header(context.brief, context.snapshot)

    assert "Edith Wilson" in header and "Edie" in header
    assert "Penicillin" in header
    assert "Metformin 500mg" in header
    # Names only: the dosage detail belongs to retrieval, not the pinned core.
    assert "twice daily with meals" not in header
    # Small by construction — the whole point of pinning is that it always fits.
    assert len(header) < 1500


# ---------------------------------------------------------------------------
# Transcript chunking
# ---------------------------------------------------------------------------

def test_chunks_are_stable_overlapping_and_cover_everything():
    lines = [f"patient: line {i}" if i % 2 == 0 else f"companion: line {i}" for i in range(20)]
    transcript = "\n".join(lines)
    docs = chunk_transcript(transcript, "call-9", call_date="2026-08-01", turns_per_chunk=6)

    assert docs, "no chunks produced"
    assert all(doc["id"].startswith("chunk-call-9-") for doc in docs)
    assert all(doc["metadata"]["type"] == "prior-transcript" for doc in docs)
    assert all(doc["metadata"]["date"] == "2026-08-01" for doc in docs)

    joined = "\n".join(doc["text"] for doc in docs)
    for line in lines:
        assert line in joined  # nothing said is lost to a chunk boundary

    # Stable ids: re-chunking yields identical documents (idempotent upsert).
    again = chunk_transcript(transcript, "call-9", call_date="2026-08-01", turns_per_chunk=6)
    assert docs == again


def test_empty_transcript_chunks_to_nothing():
    assert chunk_transcript("", "call-9") == []


def test_memory_documents_have_stable_ids_and_include_constraints(tmp_path):
    brain = ContextBrain(tmp_path / "brain.json")
    brain.add_memory("pat-1", "granddaughter Maya started college")
    brain.add_negative_constraint("pat-1", "never mention her late husband Robert")

    docs = brain.memory_documents("pat-1")
    again = brain.memory_documents("pat-1")
    assert docs == again  # stable → idempotent re-projection

    types = {doc["metadata"]["type"] for doc in docs}
    assert types == {"memory", "constraint"}
    constraint = next(d for d in docs if d["metadata"]["type"] == "constraint")
    assert "Robert" in constraint["text"]


# ---------------------------------------------------------------------------
# Retrieval state store + purge durability
# ---------------------------------------------------------------------------

def test_state_store_roundtrip(tmp_path):
    store = RetrievalStateStore(tmp_path / "state.json")
    assert store.watermark("p1") is None
    store.set_watermark("p1", "2026-08-01T00:00:00+00:00")
    assert store.watermark("p1") == "2026-08-01T00:00:00+00:00"
    assert store.bump_call_count("p1") == 1
    assert store.bump_call_count("p1") == 2
    assert store.call_count("p1") == 2


class _ScriptedMoss:
    """Minimal fake of the moss SDK client for MossRetrieval unit tests."""

    def __init__(self, *, fail_deletes: bool = False):
        self.fail_deletes = fail_deletes
        self.deleted: list[str] = []
        self.loaded: list[str] = []

    async def delete_index(self, name: str) -> bool:
        if self.fail_deletes:
            raise RuntimeError("cloud unavailable")
        self.deleted.append(name)
        return True

    async def load_index(self, name: str) -> str:
        self.loaded.append(name)
        raise RuntimeError("not found")

    async def session(self, name: str, model_id=None):
        raise AssertionError("session must not be opened while a purge is pending")


def _retrieval(tmp_path, client, patient="pat-1") -> MossRetrieval:
    async def chart_supplier():
        return [], "2026-08-01T00:00:00+00:00"

    return MossRetrieval(
        project_id="p",
        project_key="k",
        patient_id=patient,
        call_id="call-1",
        chart_supplier=chart_supplier,
        memory_supplier=lambda: [],
        state=RetrievalStateStore(tmp_path / "state.json"),
        client=client,
    )


async def test_purge_deletes_both_indexes_and_clears_state(tmp_path):
    client = _ScriptedMoss()
    retrieval = _retrieval(tmp_path, client)
    ok = await retrieval.purge_patient()

    assert ok is True
    assert client.deleted == ["juniper-chart-pat-1", "juniper-memories-pat-1"]
    assert not retrieval._state.purge_pending("pat-1")


async def test_failed_purge_is_recorded_and_blocks_moss_mode(tmp_path):
    """Durable-by-intent: the pending record survives the failure, ensure_ready
    refuses to build new PHI indexes, and a later retry clears it."""
    client = _ScriptedMoss(fail_deletes=True)
    retrieval = _retrieval(tmp_path, client)

    ok = await retrieval.purge_patient()
    assert ok is False
    assert retrieval._state.purge_pending("pat-1")

    # ensure_ready must refuse moss mode while the purge is owed...
    assert await retrieval.ensure_ready() is False

    # ...and a later successful retry clears the ledger.
    client.fail_deletes = False
    ok = await retrieval.purge_patient()
    assert ok is True
    assert not retrieval._state.purge_pending("pat-1")


async def test_first_call_builds_in_background_and_falls_back(tmp_path):
    """A missing chart index means THIS call runs in brief mode while the
    build happens in the background — a heavy chart must never block dial."""
    built: list[str] = []

    class _BuildingMoss(_ScriptedMoss):
        async def create_index(self, name, docs, model_id=None, **kwargs):
            built.append(name)
            return None

    client = _BuildingMoss()
    retrieval = _retrieval(tmp_path, client)
    ready = await retrieval.ensure_ready()
    assert ready is False  # this call: brief mode

    await asyncio.gather(*[t for t in retrieval._background if not t.done()], return_exceptions=True)
    assert built == ["juniper-chart-pat-1"]  # next call: hydrates
