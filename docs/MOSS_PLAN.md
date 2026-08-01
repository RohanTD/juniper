# Moss integration — restructuring the context architecture

**Status: proposal.** This extends `docs/PLAN.md` (the design authority); nothing here
overrides a locked decision, and one section below deliberately pushes back on part of the
original ask. Written 2026-08-01 against Moss's published docs (`docs.moss.dev`).

## What Moss is, verified

[Moss](https://www.moss.dev) is a real-time semantic search runtime for conversational AI —
a Rust core with Python/TS SDKs that embeds and queries **in-process**, with optional cloud
sync. The claims that matter to Juniper, taken from their docs rather than their landing page:

- **Local queries run in-memory at ~1–10ms** once an index is loaded; without loading,
  queries fall back to their cloud API at ~100–500ms. Local queries are never metered.
- **A `SessionIndex` is the local-first primitive**: `client.session(name)` opens a local
  index; `add_docs` embeds locally via the Rust core with no network; `query` is in-memory;
  `push_index()` to cloud is **optional**. Only credential validation touches the network
  at session open.
- **`create_index`/`load_index` are the cloud-backed path**: durable indexes persisted on
  their infrastructure, hydrated into memory at load, refreshable in the background.
- **Metadata filtering** (`$eq/$in/$gt/$and/$or`…) evaluates on the locally loaded index;
  **hybrid search** blends semantic and keyword scoring via one `alpha` parameter.
- **Multi-index search** merges a global top-K across loaded indexes (same embedding model
  required, vector-only scoring). Sessions are queried separately from loaded indexes.
- Embedding models: `moss-minilm` (default, fast) and `moss-mediumlm` (higher accuracy),
  plus bring-your-own-embeddings. A resumed session must use the stored model.
- **HIPAA is Enterprise-only** (as are SOC 2, data residency, and VPC deployment). Lower
  tiers meter storage/ingest/voice-minutes; local queries are free on every tier.
- Python SDK: `pip install moss`, Python ≥3.10, async API.

Their documented ["Live-Call Context" pattern](https://docs.moss.dev/docs/build/live-call-context)
is almost literally Juniper's shape: a persistent long-term index (knowledge, profile,
history) plus a per-call session (live transcript), both queried locally each turn, results
injected into the LLM context. Because Juniper owns the Deepgram think endpoint
(`llm_endpoint.py` → `ConversationController.take_turn`), **context injection needs no new
integration surface** — we change what the controller assembles, not how Deepgram calls us.
This is the payoff of the custom-LLM decision: Moss's VAPI/ElevenLabs webhook adapters exist
for teams that don't own their turn loop. We do.

## The proposal, and one disagreement

The ask: feed past conversations and the entire EHR file to Moss, and let its index /
conversational index / session features replace the current contexts (the compiled EHR
brief and the Context Brain digest), feeding relevant information to the agent per turn.

Most of that is right, and the wins are real:

1. **The token-budget problem disappears where it hurts.** The compiled brief trims a
   heavy-history patient to ~2,500 tokens by dropping observation and condition tails —
   under budget pressure, data is *lost*. A retrieval index has no such ceiling: the whole
   chart is indexed, and each turn surfaces the handful of facts relevant to what the
   patient just said. Twenty years of history stops being a liability.
2. **Per-turn relevance beats a static digest.** Today the Companion carries the same brief
   for the whole call. With retrieval, "my knee's been bothering me" surfaces the
   osteoarthritis condition, the last mobility note, and the walker goal — at the moment
   they're useful.
3. **In-call recall beyond the transcript window.** The Companion sees the last 12 turns
   (`transcript_window`); something said 30 turns ago is invisible to it (though never to
   documentation, which reads the full buffer). A live session over every turn makes
   "you mentioned feeling dizzy earlier — is that still bothering you?" possible in turn 40.
4. **Real conversational continuity across calls.** The Context Brain digest is a flat
   summary. An index over prior-call transcripts and memories makes "last time she said the
   stairs were getting harder" a retrieval hit, not a hope that the digest kept it.
5. **It fits the latency budget with two orders of magnitude to spare.** Local queries are
   single-digit milliseconds against an 800ms p95 budget whose dominant cost is the
   Companion's LLM call. Retrieval is the cheapest thing on the critical path.

**The disagreement: not "in place of *all* the contexts."** Retrieval is probabilistic;
some context is safety-critical precisely when it *fails* to look relevant. These stay
pinned in the prompt, always, and are deliberately small:

| Always-pinned (the "core header") | Why it can never be retrieval-gated |
|---|---|
| Negative constraints ("never mention her late husband") | The constraint matters most when the conversation drifts toward the topic by a path no query anticipated. A missed retrieval here is precisely the harm. The compassion filter also enforces these independently — that stays. |
| Allergies | Safety context for anything medication-related; tiny; must be unconditional. |
| Active medication list (names only) | The 4M medication domain needs the agent to name actual drugs reliably, not only when the patient wanders near the topic. ~7 lines. Dosage detail and history move to retrieval. |
| Identity: name, preferred name, language | Every utterance depends on it. |
| Consent flags | Deterministic pre-call gate (`verify_consent` / `require_dialing_consent`) — unchanged, not retrieval, not Moss. |
| Coverage state / standing advisory / phase | Controller-owned control state, never context. Moss changes what the Companion *knows*, never what the controller *decides*. |

Similarly untouched, by locked decision: **documentation reads the complete transcript.**
"Summaries are prompt context, never the clinical record" — and retrieval results are more
partial than summaries. `documentation.py` keeps consuming `TranscriptBuffer.render()`
verbatim; Moss has no role in the post-call clinical record. The existing test that asserts
the full transcript reaches the documentation prompt stays load-bearing.

Everything else — the bulk of the brief, the Context Brain digest, the advisors' context —
moves to retrieval.

## The PHI boundary decides the deployment shape

The EHR, the transcripts, and the memories are PHI. Moss offers HIPAA compliance (BAA, VPC,
residency) **only on Enterprise**. That gives two modes, and the architecture must run in
both:

**Mode L — local-only (default; pilot-safe on any tier).** Every Juniper index is a
`SessionIndex` that is **never pushed**. Documents are embedded in-process by the Rust core;
queries are in-memory; Moss's cloud sees credential validation and nothing else. Long-term
indexes are rebuilt at pre-call time from our own systems of record — which is exactly what
the brief compiler already does every call, so this adds embedding time to an existing
pre-call step, not a new dependency. PHI never leaves our process.

**Mode C — cloud-persistent (Enterprise + BAA, later).** Long-term indexes become real
cloud indexes (`create_index`/`load_index` with `auto_refresh`); call sessions may
`push_index()` for cross-call resume and Moss's cross-agent handoff becomes available
(e.g., a future clinician console sharing the patient's context). Same code, one config
flag — the retrieval interface below hides the difference.

Either way, one principle carries over from the locked decisions unchanged: **Medplum and
the app-level store remain the systems of record. Moss is a runtime, not a store.** Indexes
are always derivable projections; deleting every Moss asset must lose nothing but warm-up
time. (This also keeps the caregiver access model intact: Moss serves only the voice
service's process, inside the same trust boundary as the EHR brief today. Nothing new is
readable by any app.)

Diligence before build (blocking): confirm with Moss that (a) in local-session mode no
document content is transmitted (telemetry included) — the docs say embedding is local and
only auth touches the network, but for PHI this needs a written answer; (b) a BAA is
available on Enterprise for Mode C; (c) the Python SDK wheel supports our Python 3.14
runtime (docs say ≥3.10; the Rust core makes this a wheel-availability question).

## Target architecture — three retrieval surfaces

All three are per-patient or per-call, embedded with the same model (`moss-mediumlm` as the
working hypothesis — clinical text rewards the accuracy tier, and embedding happens at
pre-call/off-path moments; measure against `moss-minilm` in Phase A before committing).

### 1. `chart-{patient_id}` — the EHR index (long-term)

Built pre-call by the same broad FHIR read that builds today's brief. Instead of compiling
prose and trimming to budget, each fact becomes one document — compiled *line*, not raw
FHIR JSON:

```
{ id: "medreq-<fhir-id>",
  text: "warfarin sodium 5 MG oral tablet — one tablet daily at 6 PM; dose adjusted per INR by anticoagulation clinic",
  metadata: { domain: "medication", date: "2026-07-12", code: "855332", status: "active" } }
```

- One resource → one document (Conditions, Medication*, Observations incl. component
  values, Encounters, Appointments, CarePlan/Goal, prior notes' summaries).
- `metadata.domain` uses the 4M-relevant grouping the brief's sections already define, so
  the 4M agent can filter (`domain $eq medication`) when probing a specific slot.
- Recency still matters, but as *metadata for filtering/boosting*, not as a deletion
  criterion. Nothing is dropped for budget anymore.
- Rebuilt fresh each call in Mode L (upserted incrementally in Mode C).

### 2. `memories-{patient_id}` — the conversational index (long-term)

The "past conversations" feed — this is the restructured Context Brain:

- **Experiential memories** ("granddaughter Maya started college"), written back post-call
  exactly as today, each memory one document with `{ type: "memory", date, call_id }`.
- **Prior-call transcript chunks**: the post-call pass already holds the full transcript;
  it additionally chunks it (topic-coherent windows of ~4–8 turns) into documents with
  `{ type: "prior-transcript", call_id, date }`. This is what makes "last time you
  mentioned…" retrievable verbatim rather than as digest residue.
- **Prior clinical/family notes** land as `{ type: "prior-note" }` documents (they're
  already fetched for the brief today).
- **Negative constraints are stored here too** (`type: "constraint"`) so the store stays
  the single authoring surface — but they are *also* always pinned into the prompt and
  enforced by the compassion filter. Their presence in the index is for recall/debugging,
  never the enforcement path.

`context_brain.py` keeps its authoring API (`add_memory`, `add_negative_constraint`,
write-back) and its JSON store as the system of record; it gains a projection step that
maintains this index. The `digest()` method survives only as the fallback path (below).

### 3. The live-call session — `call-{call_id}` (short-term)

A `SessionIndex` opened at call start. After each emit — **off the critical path**, in
`_after_emit` alongside the other bookkeeping — the turn pair is appended:

```
{ id: "turn-17", text: "patient: My knee's been aching on the stairs again.\ncompanion: ...",
  metadata: { turn: 17, phase: "main", urgent: false } }
```

4M findings are appended as they're recorded (`mark_domain_complete` → a
`{ type: "finding", domain }` document), so the Closer's follow-up retrieval sees them.
The session is **never pushed** in either mode: the `TranscriptBuffer` is already the
durable source of truth, and pushing would create a second PHI store outside Medplum for
no gain — cross-call continuity comes from `memories-{patient_id}`, written by the
post-call pass through our own store.

### The per-turn path

```
patient utterance arrives (llm_endpoint → controller.take_turn)
  ├─ urgency.classify(text)                     [parallel, unchanged]
  └─ retrieve(text, advisory) ~ 5–20ms:
       chart.query(utterance + advisory hook, top_k=4)
       memories.query(utterance, top_k=3)
       session.query(utterance, top_k=3, exclude last window)
     → Companion.compose(core_header, retrieved_context, window, advisory, …)
  → compassion gate → emit                       [unchanged]
  → _after_emit: session.add_docs(turn), slow-loop scheduling   [off-path]
```

Retrieval sits *ahead of* the Companion call on the critical path, adding single-digit
milliseconds to a stage whose LLM call costs hundreds. The query text is the patient
utterance, augmented with the standing advisory's hook when one is active (so an advisory
"pursue medication — she mentioned a new pharmacy" pulls pharmacy-adjacent chart facts).
Hybrid `alpha` around 0.7: drug names, dates, and proper nouns reward keyword weight.
`latency.py` gains a `moss_retrieval` stage, logged per turn like the others; the CI
budget stays 800ms and now provably includes retrieval.

The slow loop gets richer, still off-path: the 4M agent's refresh runs domain-targeted
queries (`chart` filtered to the unfilled domain + `memories` for domain history) so its
advisories carry hooks grounded in the record ("she was on warfarin at discharge — ask
about the INR checks") instead of only what the transcript window happens to show. The
Closer does the same per gap-manifest entry. Gatekeeper is untouched — identity and consent
are deterministic.

### Failure modes and the fallback

Retrieval must fail *soft*: any Moss error or timeout (per-query timeout ~50ms) degrades
that turn to core header + transcript window — which is a slightly thinner version of
today's behavior, not a broken call. If the SDK fails at pre-call (index build), the call
proceeds in **brief mode**: the existing `compile_ehr_brief` + `digest()` path, kept alive
behind `JUNIPER_CONTEXT_MODE=brief|moss` precisely so the current architecture remains the
tested fallback. The urgency filter, consent gate, and escalation path have no Moss
dependency whatsoever.

## Module-by-module restructuring

| Module | Change |
|---|---|
| `retrieval.py` (new) | The only module that imports `moss`. `PatientRetrieval` protocol: `build_chart_index(brief_facts)`, `build_memories_index(...)`, `open_call_session(call_id)`, `retrieve(utterance, advisory, k) -> RetrievedContext`, `append_turn(...)`, `probe_domain(domain) -> [docs]`. A `FakeRetrieval` (deterministic, fixture-driven) mirrors `FakeProvider` for tests. Mode L/C and the fallback live behind this seam. |
| `medplum.py` | `compile_ehr_brief` splits: `compile_core_header()` (identity, consent, allergies, active med names, care-team refs — small, deterministic, always-pinned) and `extract_chart_documents()` (the per-resource compiled lines + metadata that feed the chart index). The existing full-brief compiler remains for brief mode. Consent gate unchanged. |
| `context_brain.py` | Keeps the JSON store + authoring API + post-call write-back as system of record; gains `project_to_index(retrieval)` and transcript chunking in the write-back. `digest()` demoted to fallback. Negative constraints continue to flow to the pinned header and the compassion filter — never through retrieval. |
| `controller.py` | Holds a `PatientRetrieval` instead of (brief text + digest) in moss mode; `_conversation_turn` awaits `retrieve()` before compose; `_after_emit` appends the turn to the session; slow-loop refreshes pass `probe_domain` results to the advisors. Phase machine, coverage, escalation, budgets: untouched. |
| `agents/companion.py` | `compose()` takes `core_header` + `retrieved: RetrievedContext` in place of `brief_text`/`digest`; prompt renders retrieved facts as a labeled context block ("From her chart:", "From past conversations:", "Earlier in this call:") with dates. Persona, tools, rewrite: unchanged. |
| `agents/fourm.py`, `closer.py` | Accept per-domain probe results; advisory schema unchanged (they still emit intent, never prose). |
| `documentation.py` | **No change.** Full transcript in, note + family summary out. |
| `llm_endpoint.py`, `app.py` | No wire change. `app.py`'s `prepare_call` builds indexes during pre-call setup; hangup path closes/discards the session. |
| `config.py` | `MOSS_PROJECT_ID/KEY`, `JUNIPER_CONTEXT_MODE`, `JUNIPER_MOSS_MODEL`, retrieval `top_k`s, per-query timeout. |

## Verification additions

Same register as PLAN.md — every property gets a test, offline via `FakeRetrieval` except
where noted:

- **Planted-fact retrieval.** Seed the chart index with a discharge encounter and a
  medication; assert a knee-pain utterance surfaces the mobility-relevant docs and a
  pharmacy utterance surfaces the medication docs (real Moss, small fixture index — this
  one runs the actual SDK in-process; it's local, so it's still offline).
- **Pinned-core invariance.** For every turn in a replayed call, assert the composed prompt
  contains the negative constraints, allergies, and active med names regardless of what
  retrieval returned — including when retrieval returns nothing.
- **Negative-constraint independence.** Retrieval scripted to *never* return the
  constraint; assert the constraint still reaches the prompt and the compassion filter
  still blocks a violating draft. (Extends the existing test, which stays.)
- **Fail-soft.** Retrieval raises / times out mid-call; assert the turn completes with
  header + window, nothing crashes, and the latency log records the degradation.
- **Brief-mode fallback.** `JUNIPER_CONTEXT_MODE=brief` runs the entire existing suite
  unchanged — the old path stays green forever, it's the fallback.
- **Documentation-unchanged guard.** Assert the documentation prompt contains the full
  rendered transcript and *no* retrieval artifacts. (The existing full-transcript test,
  tightened.)
- **Latency.** `moss_retrieval` stage recorded every turn; simulated 50ms retrieval keeps
  p95 within budget; a slow-loop domain probe never lands on the critical path (extends
  the existing structural test).
- **Session recall.** Replay a 40-turn fixture where dizziness is mentioned at turn 3 and
  never again; assert a turn-38 related utterance retrieves the turn-3 chunk while the
  12-turn window alone would not.
- **In-call findings reach the Closer.** `mark_domain_complete` findings appended to the
  session surface in the Closer's gap probes.
- **PHI boundary (Mode L).** With the SDK in session mode, assert no push occurs and no
  index-management cloud call carries document content (instrument the transport in test).
- **Write-back projection.** Post-call, new memories and transcript chunks appear in the
  memories store and its index projection; deleting all Moss state and re-projecting from
  the stores reproduces it (the "runtime, not store" property, tested).

## Rollout

- **Phase A — shadow.** Build indexes pre-call and run per-turn retrieval, *logging only*
  (nothing injected). Measure: retrieval latency distribution, hit-rate against fixture
  probes, index build time for a heavy-history patient (the 400-observation fixture),
  minilm-vs-mediumlm quality on clinical text, memory per concurrent call. Gates: p95
  retrieval < 20ms; build < 2s heavy; planted-fact hit-rate ≥ 95%.
- **Phase B — inject.** Companion gets core header + retrieved context; brief mode remains
  default in config until fixture replays show the moss-mode notes capture every planted
  finding the brief-mode notes do. Latency CI extended.
- **Phase C — advisors + session recall.** Domain probes for 4M/Closer; live session
  appends; the 40-turn recall test goes green.
- **Phase D — retire the bulk brief as default.** Moss mode becomes default; brief mode
  stays as the tested fallback. Memories write-back projection lands; digest demoted.
- **Phase E — Mode C (requires Enterprise + BAA).** Cloud persistence, `auto_refresh`
  hydration, cross-call session resume, and cross-agent handoff for whatever comes after
  the pilot (clinician console, SMS follow-ups). Not before the BAA exists.

## Costs and open questions

Local queries are unmetered on every tier, and Mode L keeps cloud usage near zero — the
Developer tier's 3-index cap doesn't bind because Mode L indexes are sessions, not cloud
indexes. Budget for Start-up ($200/mo) when Mode C trials begin; Enterprise pricing is a
conversation gated on the BAA anyway. Their "voice-minutes" metric applies to their hosted
Founding Agent product, not the SDK path we're taking — worth confirming alongside the
PHI questions.

Open questions to resolve in Phase A: mediumlm vs minilm on clinical vocabulary (BYOE with
a clinical embedding model is the escape hatch if neither is good enough); per-session
memory footprint × concurrent calls on one host; whether chart facts should also carry a
keyword-side boost for drug names (hybrid alpha tuning); and the three blocking diligence
items in the PHI section.
