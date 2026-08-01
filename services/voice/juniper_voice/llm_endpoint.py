"""POST /v1/chat/completions — the OpenAI Chat Completions-compatible endpoint
Deepgram's Voice Agent calls as its custom "think" stage.

This is NOT an LLM proxy — it is the entry point to the whole turn loop
(ConversationController.take_turn: urgency ∥ Companion -> compassion -> emit).

Key properties (docs/DEEPGRAM_INTEGRATION.md):
- Session state is keyed by call id (query param / header), never by the
  messages array Deepgram sends: only the LAST user message is consumed as the
  new patient utterance; everything else is ignored in favour of our own
  canonical TranscriptBuffer.
- Client disconnect == barge-in: Deepgram aborts the HTTP request when the
  patient interrupts, starlette cancels the handler task, and the resulting
  asyncio.CancelledError propagates through the in-flight turn, cancelling
  the Companion/urgency subtasks without leaking work.
- Bearer auth against JUNIPER_API_TOKEN.
"""

from __future__ import annotations

import hmac
import json
import re
import time
import uuid
from typing import Any, AsyncIterator, Mapping, Sequence

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

router = APIRouter()

CALL_ID_HEADER = "x-juniper-call-id"


def require_bearer(request: Request, expected_token: str | None) -> None:
    if expected_token is None:
        return  # auth disabled (local development)
    header = request.headers.get("authorization", "")
    match = re.match(r"^Bearer\s+(.+)$", header, flags=re.IGNORECASE)
    if not match or not hmac.compare_digest(match.group(1).strip(), expected_token):
        raise HTTPException(status_code=401, detail="invalid bearer token")


def extract_last_user_message(messages: Sequence[Mapping[str, Any]]) -> str:
    """Only the last user message is the new patient utterance; the rest of
    Deepgram's history is a degraded copy of our own state and is ignored."""
    for message in reversed(list(messages)):
        if message.get("role") != "user":
            continue
        content = message.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            return " ".join(
                part.get("text", "")
                for part in content
                if isinstance(part, dict) and part.get("type") == "text"
            ).strip()
    return ""


def _resolve_call_id(request: Request, body: Mapping[str, Any]) -> str:
    return (
        request.query_params.get("call")
        or request.headers.get(CALL_ID_HEADER)
        or str(body.get("user") or "")
        or "default"
    )


def _completion_id() -> str:
    return f"chatcmpl-{uuid.uuid4().hex[:24]}"


def _chunk_frame(
    completion_id: str,
    model: str,
    created: int,
    *,
    delta: Mapping[str, Any],
    finish_reason: str | None = None,
) -> str:
    payload = {
        "id": completion_id,
        "object": "chat.completion.chunk",
        "created": created,
        "model": model,
        "choices": [{"index": 0, "delta": dict(delta), "finish_reason": finish_reason}],
    }
    return f"data: {json.dumps(payload)}\n\n"


def _split_for_streaming(text: str, words_per_chunk: int = 6) -> list[str]:
    words = text.split(" ")
    return [
        " ".join(words[i : i + words_per_chunk]) + ("" if i + words_per_chunk >= len(words) else " ")
        for i in range(0, len(words), words_per_chunk)
    ] or [text]


@router.post("/v1/chat/completions")
async def chat_completions(request: Request):
    settings = request.app.state.settings
    require_bearer(request, settings.api_token)
    body = await request.json()

    call_id = _resolve_call_id(request, body)
    registry = request.app.state.registry
    try:
        controller = await registry.ensure(call_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"unknown call session {call_id!r}")

    utterance = extract_last_user_message(body.get("messages", []))
    model_name = str(body.get("model") or "juniper-companion")

    if body.get("stream", False):
        return StreamingResponse(
            _stream_turn(controller, utterance, model_name),
            media_type="text/event-stream",
            headers={"cache-control": "no-cache", "x-accel-buffering": "no"},
        )

    reply = await controller.take_turn(utterance)
    controller.latency.record_stage_on_last("first_byte", 0.0)
    return JSONResponse(
        {
            "id": _completion_id(),
            "object": "chat.completion",
            "created": int(time.time()),
            "model": model_name,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": reply},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        }
    )


async def _stream_turn(
    controller: Any, utterance: str, model_name: str
) -> AsyncIterator[str]:
    """Run the turn, then stream the compassion-gated text as SSE
    chat.completion.chunk frames.

    The turn runs inside this generator so that a client disconnect (barge-in)
    cancels it: starlette cancels the task consuming the generator and the
    CancelledError propagates into ConversationController.take_turn.
    """
    clock = controller.latency.clock
    reply = await controller.take_turn(utterance)

    completion_id = _completion_id()
    created = int(time.time())
    first_byte_started = clock()
    yield _chunk_frame(
        completion_id, model_name, created, delta={"role": "assistant", "content": ""}
    )
    controller.latency.record_stage_on_last("first_byte", clock() - first_byte_started)
    for piece in _split_for_streaming(reply):
        yield _chunk_frame(completion_id, model_name, created, delta={"content": piece})
    yield _chunk_frame(completion_id, model_name, created, delta={}, finish_reason="stop")
    yield "data: [DONE]\n\n"
