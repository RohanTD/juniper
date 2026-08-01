# Juniper voice service

The entire call pipeline: Twilio audio ⇄ Deepgram Voice Agent ⇄ the Companion
turn loop ⇄ Medplum. Built to the design authority in the repo docs — read
those first:

- `docs/PLAN.md` — architecture, latency rules, safety rules, FHIR contracts
- `docs/DEEPGRAM_INTEGRATION.md` — the bring-your-own-LLM integration shape
- `docs/CONTRACTS.md` — cross-track contracts (preferences API, Task shape, model roster)
- `packages/terminology/terminology.json` — every code; nothing here hardcodes one

## Architecture in one paragraph

Twilio hits `POST /twilio/voice`, which returns TwiML `<Connect><Stream>`
pointing at the `WS /media` bridge. That bridge holds one persistent audio
task per call against a Deepgram Voice Agent session whose custom "think"
stage calls back into this same service at `POST /v1/chat/completions`
(OpenAI-compatible, SSE). That endpoint is not an LLM proxy — it is the entry
point to `ConversationController.take_turn`: urgency filter ∥ Companion, then
the compassion filter, then emit. The 4M agent and the Closer advise on a slow
loop off the critical path; the Companion is the only speaker for the entire
call. On hangup the post-call pass reads the full transcript and writes
`Encounter` → note → transcript → (consent-gated) family summary →
escalation `Task`s to Medplum.

## Running

```sh
# from the repo root — Python 3.14 venv at .venv
.venv/bin/pip install -e "services/voice[dev]"

# environment
cp services/voice/.env.example services/voice/.env  # then fill in values

# serve
cd services/voice
../../.venv/bin/python -m uvicorn "juniper_voice.app:create_app" --factory --port 8000
```

For a live call: expose the port publicly (e.g. ngrok), set
`JUNIPER_PUBLIC_HOST` to that domain, and point a Twilio number's voice
webhook at `https://<host>/twilio/voice?patientId=<Patient id>`. The pre-call
gate refuses to dial (returns `<Hangup/>`) unless the patient's `Consent`
grants `ai-calling` and `call-recording`.

## Tests

Fully offline — zero network. LLM calls run through a scripted `FakeProvider`,
FHIR through an in-memory Medplum stub.

```sh
cd services/voice
/path/to/.venv/bin/python -m pytest -q
```

## Environment variables

See `.env.example` — every variable is listed there with its default.

## Layout

```
juniper_voice/
  app.py            # FastAPI factory: Twilio webhook, /media bridge, preferences API
  llm_endpoint.py   # POST /v1/chat/completions — the turn-loop entry point
  controller.py     # ConversationController — deterministic; no LLM
  transcript.py     # TranscriptBuffer — append-only source of truth
  filters/          # urgency (parallel with Companion), compassion (critical path)
  agents/           # companion (THE voice), fourm, closer, gatekeeper, advisory
  context_brain.py  # experiential (app store) + clinical (FHIR) memory tiers
  documentation.py  # post-call pass: transcript -> note + family summary
  medplum.py        # broad pre-call reads -> EHR brief; narrow post-call writes
  escalation.py     # urgent-concern sink (fires mid-call, Task written post-call)
  terminology.py    # typed accessors over packages/terminology/terminology.json
  latency.py        # per-turn per-stage timings, p95, 800ms budget assertion
  llm/provider.py   # the single LLM abstraction (Anthropic + Fake)
  preferences.py    # app-level preference store (docs/CONTRACTS.md §1)
```
