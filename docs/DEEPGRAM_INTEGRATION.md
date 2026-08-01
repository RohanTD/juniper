# Deepgram Voice Agent integration — bring-your-own-LLM

Verified against Deepgram's Voice Agent docs (2026-08-01, `developers.deepgram.com/docs/voice-agent-llm-models`).
This resolves the plan's open question: the custom-endpoint architecture is supported as designed.

## The contract

Deepgram's Voice Agent API accepts a custom "think" stage. Any endpoint that conforms to the
**OpenAI Chat Completions API format** (including streaming) can be plugged in:

```json
{
  "type": "Settings",
  "audio": { "...": "Twilio mulaw 8kHz in/out" },
  "agent": {
    "listen": { "provider": { "type": "deepgram", "model": "nova-3" } },
    "think": {
      "provider": { "type": "open_ai", "model": "juniper-companion", "temperature": 0.7 },
      "endpoint": {
        "url": "https://<voice-service-host>/v1/chat/completions",
        "headers": { "authorization": "Bearer {{JUNIPER_ENDPOINT_TOKEN}}" }
      }
    },
    "speak": { "provider": { "type": "deepgram", "model": "aura-2-thalia-en" } }
  }
}
```

Key facts confirmed from the docs:

- `provider.type: "open_ai"` designates any OpenAI-compatible LLM service or gateway — it does
  not mean OpenAI hosts the model. Our FastAPI service is the "gateway".
- `endpoint.url` is required for custom LLMs; `endpoint.headers` carries auth.
- No prompt-size cap applies when you bring your own endpoint (managed LLMs cap at 25k chars).
- Deepgram keeps ownership of VAD, barge-in, and streaming TTS. We own only the thinking.

## What this means for `services/voice`

- `llm_endpoint.py` exposes `POST /v1/chat/completions` speaking the OpenAI schema:
  accepts `messages[]`, `stream: true`, returns SSE `chat.completion.chunk` frames.
- The endpoint is **not an LLM proxy** — it is the entry point to the whole turn loop:
  `ConversationController.take_turn()` (urgency ∥ Companion → compassion → emit).
- Conversation state is keyed by call session, not by the messages array Deepgram sends;
  Deepgram's view of history is a degraded copy, ours (the `TranscriptBuffer`) is canonical.
  The last user message in the request is the new patient utterance; everything else is ignored
  in favour of our own state.
- Barge-in: Deepgram aborts the HTTP request when the patient interrupts. The server must treat
  client disconnect as turn cancellation (asyncio cancellation propagates through the turn loop).
- Latency: stream the first tokens as soon as the compassion gate passes. Per-stage timings are
  logged on every turn (see `latency.py` instrumentation and the CI budget of p95 ≤ 800ms).

## Twilio plumbing

`app.py` terminates the Twilio side: a voice webhook returning TwiML `<Connect><Stream>` pointing
at our `/media` WebSocket, which bridges audio frames to a Deepgram Voice Agent WebSocket session
configured with the Settings message above. One persistent audio task per call; the Voice Agent
session's `think` stage calls back into this same service over HTTP.

## MCP note

The repo configures a `deepgram-docs` MCP server (`.mcp.json`) for interactive doc lookup.
It requires OAuth — authorize it via `/mcp` in an interactive Claude Code session.
