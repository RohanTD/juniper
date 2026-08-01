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
import logging
import os
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Callable, Mapping, Sequence

logger = logging.getLogger("juniper.llm")


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

    # Critical-path roles run on Groq: measured on the real Companion prompt,
    # llama-3.3-70b returns a COMPLETE utterance in ~362ms vs ~1553ms for
    # claude-sonnet-5. Urgency shares the stage with the Companion (it runs in
    # parallel, so the stage costs max(urgency, companion)) — leaving it on a
    # ~850ms model would just make it the new bottleneck, so it moves too.
    # All three critical-path roles run 70b, not the faster 8b. Measured
    # against the real filters: 8b scored 6/8 on urgency, missing "I stopped
    # taking my warfarin" and "I got real dizzy standing up" — the latter is
    # the exact example docs/PLAN.md calls a patient-safety miss. 70b scored
    # 8/8 at 294ms. Urgency runs in PARALLEL with the Companion, so its cost
    # is hidden entirely; compassion adds ~233ms sequentially. The ~60ms 8b
    # would save is not worth a filter that misses an anticoagulant stop.
    companion: str = "llama-3.3-70b-versatile"
    compassion: str = "llama-3.3-70b-versatile"
    urgency: str = "llama-3.3-70b-versatile"
    advisor: str = "llama-3.3-70b-versatile"  # 4M and Closer, slow loop
    # Off the critical path and the one output a clinician reads and signs:
    # quality over latency, so the documentation pass stays on Opus.
    documentation: str = "claude-opus-5"

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


# Groq model -> Anthropic model to use when Groq fails. Not a quality
# preference — an availability one: Groq's on-demand tier caps
# llama-3.3-70b-versatile at 12,000 tokens/minute PER MODEL, shared across
# every role routed to it. Measured live: a real 12-turn call exhausted that
# bucket by turn 7, and the Groq SDK's own retry/backoff turned single turns
# into 11-19 SECOND dead air — one request exhausted its retries entirely and
# raised, crashing that turn's SSE stream outright. Falling back to Anthropic
# caps the worst case at Anthropic's own latency (~2s) instead.
_GROQ_FALLBACK_MODEL: dict[str, str] = {
    "llama-3.3-70b-versatile": "claude-sonnet-5",
    "llama-3.1-8b-instant": "claude-haiku-4-5-20251001",
}
_DEFAULT_GROQ_FALLBACK_MODEL = "claude-sonnet-5"


class RoutingProvider(LLMProvider):
    """Dispatches each call to a provider chosen by the MODEL NAME.

    The roster stays a flat role -> model map (docs/CONTRACTS.md §5) and the
    provider falls out of the name, so a per-role env override like
    ``JUNIPER_MODEL_COMPANION=claude-sonnet-5`` switches that one role back to
    Anthropic with no code change — which is what makes an A/B or a rollback
    a one-line edit rather than a redeploy.

    Groq calls that fail with a retryable error (rate limit, timeout,
    connection, 5xx) fall back to Anthropic for that one call rather than
    exhausting Groq's own backoff on the latency-critical path — see
    _GROQ_FALLBACK_MODEL above for why this is a real, measured failure mode
    and not defensive speculation.
    """

    _RETRYABLE_GROQ_ERRORS: tuple[type[Exception], ...]

    def __init__(self, *, anthropic: LLMProvider, groq: LLMProvider | None = None):
        self._anthropic = anthropic
        self._groq = groq
        import groq as groq_sdk

        self._RETRYABLE_GROQ_ERRORS = (
            groq_sdk.RateLimitError,
            groq_sdk.APITimeoutError,
            groq_sdk.APIConnectionError,
            groq_sdk.InternalServerError,
        )

    def _for(self, model: str) -> LLMProvider:
        if model.startswith("claude-"):
            return self._anthropic
        if self._groq is None:
            raise RuntimeError(
                f"model {model!r} needs the Groq provider, but GROQ_API_KEY is not configured"
            )
        return self._groq

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
        provider = self._for(model)
        if provider is self._groq:
            try:
                return await provider.complete(
                    tag=tag, model=model, system=system, messages=messages,
                    tools=tools, max_tokens=max_tokens,
                )
            except self._RETRYABLE_GROQ_ERRORS as exc:
                fallback_model = _GROQ_FALLBACK_MODEL.get(model, _DEFAULT_GROQ_FALLBACK_MODEL)
                logger.warning(
                    "groq %s failed for tag=%s (%s); falling back to %s",
                    model, tag, type(exc).__name__, fallback_model,
                )
                return await self._anthropic.complete(
                    tag=tag, model=fallback_model, system=system, messages=messages,
                    tools=tools, max_tokens=max_tokens,
                )
        return await provider.complete(
            tag=tag, model=model, system=system, messages=messages,
            tools=tools, max_tokens=max_tokens,
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
        provider = self._for(model)
        if provider is self._groq:
            try:
                async for chunk in provider.stream(
                    tag=tag, model=model, system=system, messages=messages,
                    tools=tools, max_tokens=max_tokens,
                ):
                    yield chunk
                return
            except self._RETRYABLE_GROQ_ERRORS as exc:
                fallback_model = _GROQ_FALLBACK_MODEL.get(model, _DEFAULT_GROQ_FALLBACK_MODEL)
                logger.warning(
                    "groq %s failed for tag=%s (%s); falling back to %s",
                    model, tag, type(exc).__name__, fallback_model,
                )
                async for chunk in self._anthropic.stream(
                    tag=tag, model=fallback_model, system=system, messages=messages,
                    tools=tools, max_tokens=max_tokens,
                ):
                    yield chunk
                return
        async for chunk in provider.stream(
            tag=tag, model=model, system=system, messages=messages,
            tools=tools, max_tokens=max_tokens,
        ):
            yield chunk


class GroqProvider(LLMProvider):
    """Groq (OpenAI-compatible) — chosen for time-to-first-audio.

    Measured on the real Companion prompt against the Anthropic baseline
    (median of 3, streaming): llama-3.3-70b-versatile returns the COMPLETE
    utterance in ~362ms vs claude-sonnet-5's ~1553ms. That margin is what
    lets the buffered compose-then-filter turn loop stay intact — the
    compassion filter still gates every outgoing utterance in full, rather
    than falling back to releasing an unfiltered first sentence.

    This class translates between the service's Anthropic-shaped provider
    interface and the OpenAI chat-completions wire format: a separate
    ``system`` string becomes a leading system message, ``input_schema``
    becomes ``function.parameters``, and Anthropic's tool_use/tool_result
    content blocks become ``tool_calls`` / ``role: "tool"`` messages.
    """

    BASE_URL = "https://api.groq.com/openai/v1"

    def __init__(self, api_key: str | None = None, client: Any | None = None):
        if client is None:
            from groq import AsyncGroq

            # max_retries=0 is deliberate and load-bearing. The SDK defaults to
            # 2 retries with exponential backoff; on a TPM rate limit that
            # backoff runs BEFORE the exception reaches RoutingProvider, so the
            # Anthropic fallback fires far too late. Measured on a live call:
            # turns stalled 8.8s and 19.9s waiting on Groq's own retries.
            # Failing fast turns those into an immediate ~1.5s Anthropic turn —
            # a graceful degrade instead of dead air.
            client = (
                AsyncGroq(api_key=api_key, max_retries=0)
                if api_key
                else AsyncGroq(max_retries=0)
            )
        self._client = client

    @staticmethod
    def _flatten(content: Any) -> str:
        """Anthropic content may be a string or a list of blocks."""
        if isinstance(content, str):
            return content
        if isinstance(content, Sequence):
            return "\n".join(
                block.get("text", "")
                for block in content
                if isinstance(block, Mapping) and block.get("type") == "text"
            )
        return ""

    @classmethod
    def _to_openai_messages(
        cls, system: str, messages: Sequence[Mapping[str, Any]]
    ) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = [{"role": "system", "content": system}]
        for message in messages:
            role = message.get("role")
            content = message.get("content")
            # A user turn carrying tool_result blocks becomes one OpenAI
            # `role: "tool"` message per result.
            if role == "user" and isinstance(content, Sequence) and not isinstance(content, str):
                results = [
                    block
                    for block in content
                    if isinstance(block, Mapping) and block.get("type") == "tool_result"
                ]
                if results:
                    for block in results:
                        out.append(
                            {
                                "role": "tool",
                                "tool_call_id": block.get("tool_use_id", ""),
                                "content": str(block.get("content", "")),
                            }
                        )
                    continue
            if role == "assistant" and isinstance(content, Sequence) and not isinstance(content, str):
                calls = [
                    block
                    for block in content
                    if isinstance(block, Mapping) and block.get("type") == "tool_use"
                ]
                entry: dict[str, Any] = {"role": "assistant", "content": cls._flatten(content) or None}
                if calls:
                    entry["tool_calls"] = [
                        {
                            "id": block.get("id", ""),
                            "type": "function",
                            "function": {
                                "name": block.get("name", ""),
                                "arguments": json.dumps(block.get("input", {})),
                            },
                        }
                        for block in calls
                    ]
                out.append(entry)
                continue
            out.append({"role": role, "content": cls._flatten(content)})
        return out

    @staticmethod
    def _to_openai_tools(
        tools: Sequence[Mapping[str, Any]] | None,
    ) -> list[dict[str, Any]] | None:
        if not tools:
            return None
        return [
            {
                "type": "function",
                "function": {
                    "name": tool["name"],
                    "description": tool.get("description", ""),
                    "parameters": tool.get("input_schema", {"type": "object", "properties": {}}),
                },
            }
            for tool in tools
        ]

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
        openai_tools = self._to_openai_tools(tools)
        if openai_tools:
            kwargs["tools"] = openai_tools
        started = time.perf_counter()
        response = await self._client.chat.completions.create(
            model=model,
            max_tokens=max_tokens,
            messages=self._to_openai_messages(system, messages),
            **kwargs,
        )
        usage = getattr(response, "usage", None)
        logger.info(
            "llm_call %s",
            json.dumps(
                {
                    "tag": tag,
                    "model": model,
                    "provider": "groq",
                    "ms": round((time.perf_counter() - started) * 1000, 1),
                    "input_tokens": getattr(usage, "prompt_tokens", None),
                    "output_tokens": getattr(usage, "completion_tokens", None),
                }
            ),
        )
        choice = response.choices[0]
        tool_calls: list[ToolCall] = []
        for call in getattr(choice.message, "tool_calls", None) or []:
            try:
                arguments = json.loads(call.function.arguments or "{}")
            except json.JSONDecodeError:
                arguments = {}
            tool_calls.append(ToolCall(name=call.function.name, input=arguments, id=call.id))
        return LLMResponse(
            text=choice.message.content or "",
            tool_calls=tuple(tool_calls),
            stop_reason=choice.finish_reason,
        )


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

    # Roughly 1024 tokens — the API's minimum cacheable prefix on most models.
    # Below this, cache_control is a silent no-op, so don't bother.
    _CACHE_MIN_CHARS = 4096

    @classmethod
    def _system_param(cls, system: str) -> str | list[dict[str, Any]]:
        """Large stable system prompts get cache_control: the Companion's
        system block (persona + digest + EHR brief, ~2500+ tokens) is
        identical on every turn of a call, and without caching the API
        re-processes all of it per turn — measured live as the dominant share
        of companion-stage TTFT. Ephemeral cache TTL is 5 minutes; turns are
        seconds apart, so every turn after the first hits the cache."""
        if len(system) >= cls._CACHE_MIN_CHARS:
            return [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]
        return system

    @staticmethod
    def _log_call(tag: str, model: str, started: float, response: Any) -> None:
        usage = getattr(response, "usage", None)
        record = {
            "tag": tag,
            "model": model,
            "ms": round((time.perf_counter() - started) * 1000, 1),
            "input_tokens": getattr(usage, "input_tokens", None),
            "output_tokens": getattr(usage, "output_tokens", None),
            "cache_read_tokens": getattr(usage, "cache_read_input_tokens", None),
            "cache_write_tokens": getattr(usage, "cache_creation_input_tokens", None),
        }
        logger.info("llm_call %s", json.dumps(record))

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
        started = time.perf_counter()
        if self._wants_fallbacks(model):
            response = await self._client.beta.messages.create(
                model=model,
                max_tokens=max_tokens,
                system=self._system_param(system),
                messages=list(messages),
                betas=[self._FALLBACK_BETA],
                fallbacks="default",
                **kwargs,
            )
        else:
            response = await self._client.messages.create(
                model=model,
                max_tokens=max_tokens,
                system=self._system_param(system),
                messages=list(messages),
                **kwargs,
            )
        self._log_call(tag, model, started, response)
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
            system=self._system_param(system),
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
