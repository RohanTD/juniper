"""Moss-mode controller behavior — docs/MOSS_PLAN.md's verification list.

Everything here runs offline against FakeRetrieval (the deterministic double
mirroring FakeProvider). The properties under test are the plan's invariants:
the pinned core is never retrieval-gated, retrieval failures degrade a turn
rather than breaking it, session writes stay off the critical path, the
session is never pushed, and brief mode remains byte-identical (the rest of
this suite *is* that guarantee — it runs with retrieval=None).
"""

from __future__ import annotations

import asyncio

import pytest

from juniper_voice.controller import ControllerSettings, Phase
from juniper_voice.retrieval import FakeRetrieval, RetrievedContext, RetrievedDoc

from conftest import COMPASSION_PASS, URGENCY_OK, FakeClock, compassion_flag, urgency_urgent

FOURM_NO_OP = '{"advisory": null, "completed": []}'
CONSTRAINT = "never mention her late husband Robert"

CORE_HEADER = (
    "## Patient\n- Edith Wilson (goes by \"Edie\"), born 1941-03-22, speaks English\n"
    "## Allergies\n- Penicillin\n"
    "## Active medications (names)\n- Metformin 500mg"
)

CHART_DOC = RetrievedDoc(
    source="chart",
    id="condition-1",
    text="Osteoarthritis, both knees",
    metadata={"domain": "condition", "date": "2020-04-01"},
)
MEMORY_DOC = RetrievedDoc(
    source="memories",
    id="memory-1",
    text="Granddaughter Maya started college this fall",
    metadata={"type": "memory", "date": "2026-07-01"},
)
SESSION_DOC = RetrievedDoc(
    source="session",
    id="turn-000003",
    text="patient: I felt dizzy on the stairs this morning.\ncompanion: ...",
    metadata={"type": "turn", "turn": "000003"},
)

RETRIEVED = RetrievedContext(chart=(CHART_DOC,), memories=(MEMORY_DOC,), session=(SESSION_DOC,))


def script_benign(provider) -> None:
    provider.script("urgency", URGENCY_OK)
    provider.script("compassion", COMPASSION_PASS)
    provider.script("companion", "How lovely — tell me more about that.")
    provider.script("fourm", FOURM_NO_OP)


def moss_controller(make_controller, retrieval, **kwargs):
    controller = make_controller(**kwargs)
    controller.retrieval = retrieval
    controller.core_header = CORE_HEADER
    return controller


# ---------------------------------------------------------------------------
# Retrieval reaches the Companion; the pinned core always does
# ---------------------------------------------------------------------------

async def test_retrieved_context_reaches_the_companion_prompt(provider, make_controller):
    script_benign(provider)
    retrieval = FakeRetrieval(context=RETRIEVED)
    controller = moss_controller(make_controller, retrieval)

    await controller.take_turn("My knee has been aching on the stairs.")

    request = provider.requests_for("companion")[0]
    content = str(request.messages[0]["content"])
    assert "Osteoarthritis, both knees" in content
    assert "Maya started college" in content
    assert "dizzy on the stairs" in content
    # Framed as reference material, never instructions (prompt-injection guard).
    assert "NOT" in content and "instructions" in content
    # The utterance drove the query.
    assert retrieval.retrieve_calls[0]["utterance"] == "My knee has been aching on the stairs."


async def test_core_header_replaces_bulk_brief_in_moss_mode(provider, make_controller):
    script_benign(provider)
    controller = moss_controller(make_controller, FakeRetrieval(context=RETRIEVED))

    await controller.take_turn("Just a quiet week here.")

    system = provider.requests_for("companion")[0].system
    assert "Active medications (names)" in system  # the pinned core
    assert "Metformin" in system  # med names always present
    assert "Penicillin" in system  # allergies always present
    # The bulk brief text is NOT in the prompt — retrieval carries the chart.
    assert "Type 2 diabetes mellitus" not in system


async def test_pinned_core_invariance_when_retrieval_returns_nothing(
    provider, make_controller
):
    """The plan's core claim: safety context is never retrieval-gated."""
    script_benign(provider)
    controller = moss_controller(
        make_controller,
        FakeRetrieval(context=RetrievedContext()),  # retrieval finds NOTHING
        negative_constraints=(CONSTRAINT,),
    )

    await controller.take_turn("Tell me a story about the old days.")

    system = provider.requests_for("companion")[0].system
    assert CONSTRAINT in system
    assert "Penicillin" in system
    assert "Metformin" in system


async def test_advisory_hook_feeds_the_chart_query(provider, make_controller):
    from juniper_voice.agents.advisory import Advisory

    script_benign(provider)
    retrieval = FakeRetrieval(context=RETRIEVED)
    controller = moss_controller(make_controller, retrieval)
    controller.standing_advisory = Advisory(
        domain="medication", priority="high", hook="she mentioned a new pharmacy", source="fourm"
    )

    await controller.take_turn("The pharmacy moved across town, you know.")

    call = retrieval.retrieve_calls[0]
    assert call["advisory_domain"] == "medication"
    assert call["advisory_hook"] == "she mentioned a new pharmacy"


# ---------------------------------------------------------------------------
# Fail-soft: retrieval failure or hang degrades the turn, never breaks it
# ---------------------------------------------------------------------------

async def test_retrieval_failure_degrades_to_core_header_and_window(
    provider, make_controller
):
    script_benign(provider)
    controller = moss_controller(make_controller, FakeRetrieval(fail_retrieve=True))

    reply = await controller.take_turn("I'm doing all right today.")

    assert reply == "How lovely — tell me more about that."
    # The pinned core still reached the prompt.
    assert "Metformin" in provider.requests_for("companion")[0].system
    # The stage was still recorded — degradation is visible, not silent.
    assert "moss_retrieval" in controller.latency.records[0].stages


async def test_hanging_retrieval_is_cut_off_by_the_controller_deadline(
    provider, make_controller, fake_clock
):
    """The controller does not trust any retrieval implementation with the
    latency budget: a hang is cut at retrieval_deadline and the turn ships."""
    script_benign(provider)
    controller = moss_controller(
        make_controller,
        FakeRetrieval(hang_retrieve=True),
        settings=ControllerSettings(retrieval_deadline=0.05),
    )

    reply = await asyncio.wait_for(controller.take_turn("Hello there."), timeout=5.0)
    assert reply == "How lovely — tell me more about that."


async def test_urgency_still_fires_when_retrieval_fails(provider, make_controller):
    """No safety property may depend on Moss: the urgency path runs in
    parallel with retrieval and survives its failure."""
    provider.script("urgency", urgency_urgent("cardiac", "chest pain", "call the doctor today"))
    provider.script("compassion", COMPASSION_PASS)
    provider.script("companion", "That chest pain needs a call to your doctor today.")
    provider.script("fourm", FOURM_NO_OP)
    controller = moss_controller(make_controller, FakeRetrieval(fail_retrieve=True))

    await controller.take_turn("My chest has been hurting since breakfast.")

    assert len(controller.escalation.escalations) == 1
    assert controller.escalation.escalations[0].category == "cardiac"


# ---------------------------------------------------------------------------
# Session writes: off the critical path, never pushed
# ---------------------------------------------------------------------------

async def test_turns_are_appended_to_the_session_off_path(provider, make_controller):
    script_benign(provider)
    retrieval = FakeRetrieval(context=RETRIEVED)
    controller = moss_controller(make_controller, retrieval)

    reply = await controller.take_turn("The garden is coming along nicely.")
    # The reply is already shipped; the append happens in the background.
    await controller.drain_background()

    assert len(retrieval.appended_turns) == 1
    appended = retrieval.appended_turns[0]
    assert appended["patient_text"] == "The garden is coming along nicely."
    assert appended["companion_text"] == reply
    assert appended["phase"] == "main"
    assert appended["urgent"] is False


async def test_findings_are_appended_to_the_session(provider, make_controller):
    script_benign(provider)
    retrieval = FakeRetrieval(context=RETRIEVED)
    controller = moss_controller(make_controller, retrieval)

    controller.mark_domain_complete(
        "medication", {"medications": [{"name": "metformin", "adherence": "as prescribed"}]}, 0.9
    )
    await controller.drain_background()

    assert retrieval.appended_findings == [
        ("medication", {"medications": [{"name": "metformin", "adherence": "as prescribed"}]})
    ]


async def test_the_session_is_never_pushed():
    """The invariant is structural: neither the protocol nor the fake exposes
    push_index, and MossRetrieval's close() discards the session. This test
    pins the seam so adding a push becomes a deliberate, reviewed act."""
    from juniper_voice.retrieval import MossRetrieval, PatientRetrieval

    assert not hasattr(FakeRetrieval, "push_index")
    assert "push_index" not in PatientRetrieval.__protocol_attrs__
    import inspect

    source = inspect.getsource(MossRetrieval)
    assert "push_index" not in source


# ---------------------------------------------------------------------------
# Latency: the retrieval stage is measured; slow-loop probes stay off-path
# ---------------------------------------------------------------------------

async def test_moss_retrieval_is_a_measured_critical_path_stage(
    provider, make_controller, fake_clock
):
    def cheap(response):
        def _handler(_request):
            fake_clock.advance(0.05)
            return response

        return _handler

    provider.script("urgency", cheap(URGENCY_OK))
    provider.script("compassion", cheap(COMPASSION_PASS))
    provider.script("companion", cheap("Lovely."))
    provider.script("fourm", FOURM_NO_OP)

    class TimedFake(FakeRetrieval):
        async def retrieve(self, utterance, **kwargs):
            fake_clock.advance(0.02)
            return await super().retrieve(utterance, **kwargs)

    controller = moss_controller(make_controller, TimedFake(context=RETRIEVED))
    await controller.take_turn("Hello.")

    record = controller.latency.records[0]
    assert record.stages["moss_retrieval"] == pytest.approx(0.02)
    # Retrieval is on the critical path and counted as such.
    assert record.critical_path_seconds() >= 0.02


async def test_domain_probes_run_only_in_the_slow_loop(provider, make_controller):
    """Probes reach the 4M agent's prompt via the slow loop; the per-turn path
    never awaits them."""
    provider.script("urgency", URGENCY_OK)
    provider.script("compassion", COMPASSION_PASS)
    provider.script("companion", "Tell me more.")
    provider.script(
        "fourm",
        '{"advisory": {"domain": "medication", "priority": "high", "hook": "pharmacy"}, '
        '"completed": []}',
    )
    retrieval = FakeRetrieval(
        context=RETRIEVED,
        probe_results={
            "medication": (
                RetrievedDoc(
                    source="chart",
                    id="medreq-9",
                    text="warfarin sodium 5 MG — INR-adjusted",
                    metadata={"domain": "medication"},
                ),
            )
        },
    )
    controller = moss_controller(
        make_controller, retrieval, settings=ControllerSettings(fourm_refresh_every=1)
    )

    await controller.take_turn("Not much new here.")
    await controller.drain_background()

    assert "medication" in retrieval.probe_calls
    fourm_request = provider.requests_for("fourm")[0]
    assert "warfarin sodium 5 MG" in str(fourm_request.messages[0]["content"])


async def test_closing_probes_reach_the_closer(provider, make_controller, fake_clock):
    provider.script("urgency", URGENCY_OK)
    provider.script("compassion", COMPASSION_PASS)
    provider.script("companion", "It has been so nice talking with you.")
    provider.script("fourm", FOURM_NO_OP)
    provider.script(
        "closer",
        '[{"domain": "mobility", "priority": "high", "hook": "ask about the stairs"}]',
    )
    retrieval = FakeRetrieval(
        context=RETRIEVED,
        probe_results={
            "mobility": (
                RetrievedDoc(
                    source="chart",
                    id="obs-3",
                    text="Fall at home with brief loss of consciousness (2026-07-08)",
                    metadata={"domain": "encounter"},
                ),
            )
        },
    )
    controller = moss_controller(
        make_controller,
        retrieval,
        settings=ControllerSettings(fatigue_short_replies=1, fatigue_word_threshold=5),
    )
    # Mobility is the one remaining gap — the manifest-driven probe targets it.
    for domain in ("what-matters", "medication", "mentation"):
        controller.mark_domain_complete(domain, {"covered": "yes"}, 0.9)

    await controller.take_turn("fine.")  # fatigue → closing → closer refresh
    await controller.drain_background()

    assert controller.phase in (Phase.CLOSING, Phase.DONE)
    closer_requests = provider.requests_for("closer")
    assert closer_requests, "closer never consulted"
    assert "Fall at home" in str(closer_requests[0].messages[0]["content"])


# ---------------------------------------------------------------------------
# Post-call: memories projection; session recall fixture
# ---------------------------------------------------------------------------

async def test_post_call_projects_memories_and_chunks(
    provider, make_controller, medplum, terminology, tmp_path
):
    from juniper_voice.context_brain import ContextBrain
    from juniper_voice.documentation import run_post_call
    from juniper_voice.llm.provider import ModelRoster

    provider.script("urgency", URGENCY_OK)
    provider.script("compassion", COMPASSION_PASS)
    provider.script("companion", "Tell me about the wedding.")
    provider.script("fourm", FOURM_NO_OP)
    provider.script("documentation.note", "SUBJECTIVE: routine check-in.")
    provider.script("documentation.family", "A lovely chat today.")
    provider.script(
        "context_brain.write_back",
        '{"memories": ["Grandson Leo is getting married in October"], "negative_constraints": []}',
    )

    retrieval = FakeRetrieval(context=RETRIEVED)
    controller = moss_controller(make_controller, retrieval)
    brain = ContextBrain(tmp_path / "brain.json")
    await controller.take_turn("Leo is getting married in October, did I tell you?")

    await run_post_call(
        controller=controller,
        provider=provider,
        roster=ModelRoster(),
        medplum=medplum,
        terminology=terminology,
        device_ref="Device/x",
        organization_ref=None,
        context_brain=brain,
        call_start_iso="2026-08-01T15:00:00+00:00",
        call_end_iso="2026-08-01T15:12:00+00:00",
    )

    projected_ids = {doc["id"] for doc in retrieval.projected}
    assert any(doc_id.startswith("memory-") for doc_id in projected_ids)
    assert any(doc_id.startswith("chunk-call-1-") for doc_id in projected_ids)
    projected_text = " ".join(doc["text"] for doc in retrieval.projected)
    assert "Leo is getting married" in projected_text


async def test_session_recall_beyond_the_transcript_window(provider, make_controller):
    """Turn 3 mentions dizziness; 30+ turns later a related utterance must be
    answerable from the session even though the window has long scrolled past.
    FakeRetrieval stands in for the index; the property under test is that the
    controller asks with an exclusion boundary and injects what comes back."""
    script_benign(provider)
    dizzy = RetrievedContext(
        session=(
            RetrievedDoc(
                source="session",
                id="turn-000003",
                text="patient: I felt dizzy coming down the stairs this morning.",
                metadata={"type": "turn", "turn": "000003"},
            ),
        )
    )
    retrieval = FakeRetrieval(contexts_by_query={"light-headed": dizzy})
    controller = moss_controller(make_controller, retrieval)

    for index in range(36):
        await controller.take_turn(f"Filler turn number {index} about the garden and weather.")
    await controller.take_turn("I have been a bit light-headed again, like before.")

    last_call = retrieval.retrieve_calls[-1]
    assert last_call["window_start_turn"] is not None and last_call["window_start_turn"] > 0
    final_request = provider.requests_for("companion")[-1]
    assert "dizzy coming down the stairs" in str(final_request.messages[0]["content"])
    await controller.drain_background()
