"""The single LLM abstraction for the voice service.

Every LLM call in the service goes through an :class:`LLMProvider` — no other
module talks to an SDK directly.  Two implementations:

* :class:`AnthropicProvider` — the production provider (Anthropic API).
* :class:`FakeProvider` — fully scripted, records every request; used by the
  offline test suite.

Model defaults follow docs/CONTRACTS.md §5 and are env-overridable via
:class:`ModelRoster`.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Callable, Mapping, Sequence


@dataclass(frozen=True)
class ToolCall:
    name: str
    input: Mapping[str, Any]
    id: str = ""


@dataclass(frozen=True)
class LLMResponse:
    text: str
    tool_calls: tuple[ToolCall, ...] = ()
    stop_reason: str | None = None


@dataclass(frozen=True)
class LLMRequest:
    """A captured request — what the FakeProvider records for assertions."""

    tag: str
    model: str
    system: str
    messages: tuple[Mapping[str, Any], ...]
    tools: tuple[Mapping[str, Any], ...] = ()
    max_tokens: int = 1024

    def prompt_text(self) -> str:
        """All text content of system + messages, for test assertions."""
        parts: list[str] = [self.system]
        for message in self.messages:
            content = message.get("content")
            if isinstance(content, str):
                parts.append(content)
            elif isinstance(content, Sequence):
                for block in content:
                    if isinstance(block, Mapping) and isinstance(block.get("text"), str):
                        parts.append(block["text"])
        return "\n".join(parts)


@dataclass(frozen=True)
class ModelRoster:
    """Model per role, per docs/CONTRACTS.md §5.  Env-overridable."""

    companion: str = "claude-sonnet-5"
    compassion: str = "claude-haiku-4-5-20251001"
    urgency: str = "claude-haiku-4-5-20251001"
    advisor: str = "claude-sonnet-5"  # 4M and Closer, slow loop
    documentation: str = "claude-opus-5"  # post-call, quality over latency

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "ModelRoster":
        env = env if env is not None else os.environ
        default = cls()
        return cls(
            companion=env.get("JUNIPER_MODEL_COMPANION", default.companion),
            compassion=env.get("JUNIPER_MODEL_COMPASSION", default.compassion),
            urgency=env.get("JUNIPER_MODEL_URGENCY", default.urgency),
            advisor=env.get("JUNIPER_MODEL_ADVISOR", default.advisor),
            documentation=env.get("JUNIPER_MODEL_DOCUMENTATION", default.documentation),
        )


class LLMProvider(ABC):
    """async complete()/stream() over model + system + messages (+ tools)."""

    @abstractmethod
    async def complete(
        self,
        *,
        tag: str,
        model: str,
        system: str,
        messages: Sequence[Mapping[str, Any]],
        tools: Sequence[Mapping[str, Any]] | None = None,
        max_tokens: int = 1024,
    ) -> LLMResponse:
        """Run one completion. ``tag`` names the calling role (companion,
        urgency, compassion, fourm, closer, gatekeeper, documentation.*)."""

    async def stream(
        self,
        *,
        tag: str,
        model: str,
        system: str,
        messages: Sequence[Mapping[str, Any]],
        tools: Sequence[Mapping[str, Any]] | None = None,
        max_tokens: int = 1024,
    ) -> AsyncIterator[str]:
        """Yield text chunks.  Default implementation falls back to
        :meth:`complete` and yields the whole text once."""
        response = await self.complete(
            tag=tag, model=model, system=system, messages=messages,
            tools=tools, max_tokens=max_tokens,
        )
        if response.text:
            yield response.text


class AnthropicProvider(LLMProvider):
    """Production provider over the official ``anthropic`` SDK.

    Notes:
    - Thinking configuration is deliberately omitted: current models run
      adaptive thinking by default and calibrate spend to task complexity.
    - For ``claude-opus-5`` (the documentation pass) we opt into server-side
      refusal fallbacks (``fallbacks: "default"``) so a safety-classifier
      decline is transparently rerouted rather than dropping the note.
    """

    _FALLBACK_BETA = "server-side-fallback-2026-07-01"

    def __init__(self, api_key: str | None = None, client: Any | None = None):
        if client is None:
            from anthropic import AsyncAnthropic

            client = AsyncAnthropic(api_key=api_key) if api_key else AsyncAnthropic()
        self._client = client

    @staticmethod
    def _wants_fallbacks(model: str) -> bool:
        return model.startswith("claude-opus-5") or model.startswith("claude-fable-5")

    async def complete(
        self,
        *,
        tag: str,
        model: str,
        system: str,
        messages: Sequence[Mapping[str, Any]],
        tools: Sequence[Mapping[str, Any]] | None = None,
        max_tokens: int = 1024,
    ) -> LLMResponse:
        kwargs: dict[str, Any] = {}
        if tools:
            kwargs["tools"] = list(tools)
        if self._wants_fallbacks(model):
            response = await self._client.beta.messages.create(
                model=model,
                max_tokens=max_tokens,
                system=system,
                messages=list(messages),
                betas=[self._FALLBACK_BETA],
                fallbacks="default",
                **kwargs,
            )
        else:
            response = await self._client.messages.create(
                model=model,
                max_tokens=max_tokens,
                system=system,
                messages=list(messages),
                **kwargs,
            )
        if response.stop_reason == "refusal":
            return LLMResponse(text="", stop_reason="refusal")
        text_parts: list[str] = []
        tool_calls: list[ToolCall] = []
        for block in response.content:
            if block.type == "text":
                text_parts.append(block.text)
            elif block.type == "tool_use":
                tool_calls.append(ToolCall(name=block.name, input=block.input, id=block.id))
        return LLMResponse(
            text="".join(text_parts),
            tool_calls=tuple(tool_calls),
            stop_reason=response.stop_reason,
        )

    async def stream(
        self,
        *,
        tag: str,
        model: str,
        system: str,
        messages: Sequence[Mapping[str, Any]],
        tools: Sequence[Mapping[str, Any]] | None = None,
        max_tokens: int = 1024,
    ) -> AsyncIterator[str]:
        kwargs: dict[str, Any] = {}
        if tools:
            kwargs["tools"] = list(tools)
        async with self._client.messages.stream(
            model=model,
            max_tokens=max_tokens,
            system=system,
            messages=list(messages),
            **kwargs,
        ) as stream:
            async for text in stream.text_stream:
                yield text


# ---------------------------------------------------------------------------
# Fake provider for tests
# ---------------------------------------------------------------------------

Handler = (
    str
    | LLMResponse
    | list  # queue of str/LLMResponse popped per call
    | Callable[[LLMRequest], Any]
)


class FakeProvider(LLMProvider):
    """Scripted provider.  Handlers are keyed by request *tag*.

    A handler may be a plain string, an :class:`LLMResponse`, a list (popped
    per call), or a callable ``(LLMRequest) -> str | LLMResponse`` (sync or
    async).  Every request is recorded in :attr:`requests`.
    """

    def __init__(
        self,
        handlers: Mapping[str, Handler] | None = None,
        default: Handler | None = None,
    ):
        self.handlers: dict[str, Handler] = dict(handlers or {})
        self.default: Handler | None = default
        self.requests: list[LLMRequest] = []

    def script(self, tag: str, handler: Handler) -> None:
        self.handlers[tag] = handler

    def requests_for(self, tag: str) -> list[LLMRequest]:
        return [request for request in self.requests if request.tag == tag]

    async def _resolve(self, handler: Handler, request: LLMRequest) -> LLMResponse:
        if isinstance(handler, list):
            if not handler:
                raise AssertionError(f"FakeProvider queue for tag {request.tag!r} is empty")
            handler = handler.pop(0)
        result: Any = handler
        if callable(result):
            result = result(request)
        if inspect.isawaitable(result):
            result = await result
        if isinstance(result, LLMResponse):
            return result
        if isinstance(result, str):
            return LLMResponse(text=result)
        raise AssertionError(
            f"FakeProvider handler for tag {request.tag!r} returned {type(result)!r}"
        )

    async def complete(
        self,
        *,
        tag: str,
        model: str,
        system: str,
        messages: Sequence[Mapping[str, Any]],
        tools: Sequence[Mapping[str, Any]] | None = None,
        max_tokens: int = 1024,
    ) -> LLMResponse:
        request = LLMRequest(
            tag=tag,
            model=model,
            system=system,
            messages=tuple(messages),
            tools=tuple(tools or ()),
            max_tokens=max_tokens,
        )
        self.requests.append(request)
        handler = self.handlers.get(tag, self.default)
        if handler is None:
            raise AssertionError(f"FakeProvider has no handler for tag {tag!r}")
        # Yield once so scripted 'concurrent' tasks interleave like real IO.
        await asyncio.sleep(0)
        return await self._resolve(handler, request)


# ---------------------------------------------------------------------------
# Shared parsing helper for structured LLM output
# ---------------------------------------------------------------------------

def extract_json(text: str) -> Any | None:
    """Best-effort extraction of the first JSON value in ``text``.

    Model output frequently wraps JSON in prose or code fences; this scans for
    the first decodable object/array.  Returns None when nothing parses.
    """
    if not text:
        return None
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = stripped.strip("`")
        if stripped.startswith("json"):
            stripped = stripped[4:]
    decoder = json.JSONDecoder()
    for index, char in enumerate(stripped):
        if char in "{[":
            try:
                value, _ = decoder.raw_decode(stripped[index:])
                return value
            except json.JSONDecodeError:
                continue
    return None
