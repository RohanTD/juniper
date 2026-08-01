"""The Deepgram-facing endpoint, and barge-in cancellation.

docs/DEEPGRAM_INTEGRATION.md: Deepgram's Voice Agent calls this service as an
OpenAI-compatible custom LLM.  Two properties matter beyond the wire format:

- Our ``TranscriptBuffer`` is canonical.  Deepgram's ``messages`` array is a
  degraded copy of conversation state, so only the *last user message* is
  consumed as the new patient utterance.
- Barge-in is a client disconnect.  Cancellation must propagate into the turn
  loop so interrupted turns do not leak work and cost, and the transcript must
  stay consistent afterwards.
"""

from __future__ import annotations

import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from juniper_voice.app import create_app
from juniper_voice.config import Settings
from juniper_voice.llm_endpoint import extract_last_user_message
from juniper_voice.session import CallRegistry

from conftest import COMPASSION_PASS, URGENCY_OK

TOKEN = "test-token"
FOURM_NO_OP = '{"advisory": null, "completed": []}'


@pytest.fixture
def endpoint(tmp_path, provider, make_controller):
    controller = make_controller()
    registry = CallRegistry()
    registry.register("call-1", controller)
    settings = Settings(
        api_token=TOKEN,
        preferences_path=str(tmp_path / "prefs.json"),
        context_brain_path=str(tmp_path / "brain.json"),
    )
    app = create_app(settings=settings, provider=provider, medplum=None, registry=registry)
    with TestClient(app) as client:
        client.headers["Authorization"] = f"Bearer {TOKEN}"
        yield client, controller


def test_extract_last_user_message_ignores_deepgrams_history():
    messages = [
        {"role": "system", "content": "you are a helpful assistant"},
        {"role": "user", "content": "an older, degraded copy of a turn"},
        {"role": "assistant", "content": "something we said"},
        {"role": "user", "content": "the actual new utterance"},
    ]
    assert extract_last_user_message(messages) == "the actual new utterance"


def test_extract_last_user_message_handles_content_parts():
    messages = [
        {"role": "user", "content": [{"type": "text", "text": "hello there"}]},
    ]
    assert extract_last_user_message(messages) == "hello there"


def test_endpoint_requires_the_bearer_token(endpoint):
    client, _ = endpoint
    response = client.post(
        "/v1/chat/completions",
        json={"model": "juniper-companion", "messages": []},
        headers={"Authorization": ""},
    )
    assert response.status_code == 401


def test_unknown_call_session_is_rejected(endpoint):
    client, _ = endpoint
    response = client.post(
        "/v1/chat/completions?call=nonexistent",
        json={"model": "juniper-companion", "messages": [{"role": "user", "content": "hi"}]},
    )
    assert response.status_code == 404


def test_non_streaming_completion_is_openai_shaped(endpoint, provider):
    client, controller = endpoint
    provider.script("urgency", URGENCY_OK)
    provider.script("compassion", COMPASSION_PASS)
    provider.script("companion", "Good morning, Edie — how has your week been?")
    provider.script("fourm", FOURM_NO_OP)

    response = client.post(
        "/v1/chat/completions?call=call-1",
        json={
            "model": "juniper-companion",
            "messages": [{"role": "user", "content": "Hello?"}],
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["object"] == "chat.completion"
    assert payload["choices"][0]["message"]["role"] == "assistant"
    assert payload["choices"][0]["message"]["content"].startswith("Good morning")
    assert payload["choices"][0]["finish_reason"] == "stop"

    # The canonical transcript recorded both sides of the turn.
    rendered = controller.transcript.render()
    assert "Hello?" in rendered
    assert "Good morning" in rendered


def test_streaming_completion_emits_chunk_frames(endpoint, provider):
    client, _ = endpoint
    provider.script("urgency", URGENCY_OK)
    provider.script("compassion", COMPASSION_PASS)
    provider.script("companion", "It is so good to hear your voice this morning.")
    provider.script("fourm", FOURM_NO_OP)

    with client.stream(
        "POST",
        "/v1/chat/completions?call=call-1",
        json={
            "model": "juniper-companion",
            "stream": True,
            "messages": [{"role": "user", "content": "Hello?"}],
        },
    ) as response:
        assert response.status_code == 200
        body = "".join(response.iter_text())

    assert "chat.completion.chunk" in body
    assert body.rstrip().endswith("data: [DONE]")

    # The full utterance is reconstructable from the deltas — that, not the raw
    # byte stream, is what Deepgram's TTS actually consumes.
    reconstructed = ""
    finish_reasons = []
    for line in body.splitlines():
        if not line.startswith("data: ") or line == "data: [DONE]":
            continue
        frame = json.loads(line.removeprefix("data: "))
        assert frame["object"] == "chat.completion.chunk"
        choice = frame["choices"][0]
        reconstructed += choice["delta"].get("content", "")
        if choice.get("finish_reason"):
            finish_reasons.append(choice["finish_reason"])

    assert reconstructed == "It is so good to hear your voice this morning."
    assert finish_reasons == ["stop"]


async def test_bargein_cancels_the_in_flight_turn_without_leaking_tasks(
    provider, make_controller
):
    """A client disconnect must propagate cancellation into the turn loop."""
    composing = asyncio.Event()

    async def slow_companion(_request):
        composing.set()
        await asyncio.sleep(30)  # the patient interrupts long before this
        return "a reply that never ships"

    provider.script("urgency", URGENCY_OK)
    provider.script("compassion", COMPASSION_PASS)
    provider.script("companion", slow_companion)
    provider.script("fourm", FOURM_NO_OP)

    controller = make_controller()
    turn = asyncio.create_task(controller.take_turn("I was going to say—"))
    await asyncio.wait_for(composing.wait(), timeout=2.0)

    turn.cancel()
    with pytest.raises(asyncio.CancelledError):
        await turn

    # The patient's words stay on the record; the aborted reply is marked
    # rather than silently lost.
    rendered = controller.transcript.render()
    assert "I was going to say" in rendered
    assert "interrupted" in rendered
    assert "a reply that never ships" not in rendered

    # Nothing was left running.
    controller.cancel_background()
    await asyncio.sleep(0)
    leaked = [
        task
        for task in asyncio.all_tasks()
        if task is not asyncio.current_task() and not task.done()
    ]
    assert leaked == []


async def test_the_call_survives_a_barge_in_and_keeps_going(provider, make_controller):
    """Cancellation must leave the controller usable — the patient interrupted,
    they did not hang up."""
    first = asyncio.Event()

    async def companion(request):
        if not first.is_set():
            first.set()
            await asyncio.sleep(30)
        return "Of course — go on."

    provider.script("urgency", URGENCY_OK)
    provider.script("compassion", COMPASSION_PASS)
    provider.script("companion", companion)
    provider.script("fourm", FOURM_NO_OP)

    controller = make_controller()
    turn = asyncio.create_task(controller.take_turn("Actually, wait—"))
    await asyncio.wait_for(first.wait(), timeout=2.0)
    turn.cancel()
    with pytest.raises(asyncio.CancelledError):
        await turn

    reply = await controller.take_turn("Sorry, what I meant was the garden.")
    assert reply == "Of course — go on."
    controller.cancel_background()
