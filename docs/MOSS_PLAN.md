# Moss integration — restructuring the context architecture

**Status: implemented 2026-08-01** (`retrieval.py` and the moss-mode wiring across the
voice service; 98 tests green, brief mode remains the configured default per Phase B).
This extends `docs/PLAN.md` (the design authority); nothing here overrides a locked
decision, and one section below deliberately pushes back on part of the original ask.

> **Implementation deviations from the text below** (each verified during build):
>
> 1. **The SDK validates credentials even for local sessions** — there is no fully
>    offline mode. Real-SDK tests are therefore integration-gated on `MOSS_PROJECT_ID`;
>    the offline suite runs against `FakeRetrieval`, and session-open failure is one more
>    input to the fail-soft path. (Verified against `moss` 1.7.2 on PyPI — which IS the
>    real Moss SDK, wrapping `inferedge-moss-core`; installs clean on Python 3.14.)
> 2. **The pre-call full FHIR read stays, even in moss mode.** The consent gate must be
>    fresh per call, the compiled brief remains the documentation context and the
>    fail-soft target, and the same snapshot feeds the chart-document extraction — so
>    one read produces brief + core header + documents, and the delta is computed
>    client-side against the watermark (only changed documents are re-embedded). The
>    "skip the read entirely" optimization moves to the Subscription→Bot future.
> 3. **Per-query timeout defaults to 150ms, not ~50ms** — still noise against the 800ms
>    budget, but tolerant of first-query warm-up; the controller additionally enforces a
>    hard 500ms deadline on the whole retrieval step, trusting no implementation.
> 4. **First-ever call for a patient runs in brief mode** while the chart index builds in
>    the background (there is no enrollment hook yet; a heavy chart must never block
>    dial). From the second call on, hydration + delta applies.
> 5. **The chart delta cannot see FHIR deletions**, so every Nth call
>    (`JUNIPER_MOSS_FULL_REBUILD_EVERY`, default 20) the index is rebuilt from scratch
>    off the call path — the pragmatic stand-in for delete propagation until the
>    Subscription→Bot path exists.

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
- Their published pricing lists **HIPAA, SOC 2, data residency and VPC deployment under
  Enterprise**. Per project direction this plan assumes HIPAA compliance and a signed BAA
  (see the assumption note below). Storage/ingest/egress are metered; local queries are
  free on every tier.
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

## Deployment shape: cloud-persistent, still local at query time

> **Assumption, set by project direction (2026-08-01):** Moss is treated as HIPAA-compliant
> with a BAA in place. Their published pricing lists HIPAA under Enterprise, so the contract
> is a procurement item, not an architectural one — but it must be signed before real PHI
> lands. Everything below assumes it.

That assumption removes the reason to keep indexes ephemeral and makes the **durable cloud
path the default**. What it does *not* change is the latency architecture, and this is the
distinction that matters most:

**`load_index()` is still mandatory. The cloud is for persistence and hydration, never for
query time.** Moss's own numbers are ~1–10ms in-memory versus ~100–500ms against their cloud
API — a cloud query per turn would blow the 800ms budget by itself. Every per-turn query
still runs in-process against a loaded index. HIPAA compliance buys durability, not a
different query path.

What becomes possible:

- **Indexes survive across calls.** `chart-{patient}` and `memories-{patient}` become real
  cloud indexes, hydrated at call start with `load_index()` — pre-embedded, so no embedding
  work happens on the pre-call path at all.
- **Pre-call gets faster, not slower.** Today's brief compiler does a broad FHIR read and
  compiles every call. With a durable index, the pre-call path becomes a *delta*
  reconciliation: fetch only `_lastUpdated=gt{index_built_at}` from Medplum and upsert what
  changed. Embedding 400 observations happens once, not once per call.
- **`auto_refresh` keeps warm processes current** without a rebuild, which matters when
  several concurrent calls share a host.
- **Cross-agent handoff** becomes available for whatever follows the pilot — a clinician
  console or an SMS follow-up agent can load the same patient context.

What is newly required, precisely *because* PHI now persists in someone else's system:

- **Consent revocation must propagate.** Today revoking `ai-calling` simply stops the next
  call, because nothing is retained outside Medplum. With durable indexes, revocation (or a
  patient deletion request) must also `delete_index("chart-{patient}")` and
  `delete_index("memories-{patient}")`. This is a new code path with a test, not an
  operational note — it is the one place where making Moss durable adds a genuine obligation.
- **Retention follows the record.** Moss indexes inherit the patient's retention policy;
  index deletion is part of patient offboarding.
- **Hydration is a new network dependency at call start.** It did not exist when indexes
  were rebuilt locally. It fails soft (see below) into brief mode.

One principle from the locked decisions carries over unchanged and is now *more* important:
**Medplum and the app-level store remain the systems of record. Moss is a durable projection,
not a second record.** Every index must be reproducible by re-projecting from Medplum and the
Context Brain store; deleting all Moss state must cost nothing but rebuild time. That property
is what keeps the consent-revocation path honest and prevents the two systems from silently
diverging — and it is asserted by a test.

The caregiver access model is untouched: Moss serves only the voice service's process, inside
the same trust boundary the EHR brief already occupies. Nothing new is readable by any app.

Remaining diligence (no longer blocking, but confirm before production): the BAA itself, and
whether the Python SDK ships a wheel for our 3.14 runtime (docs say ≥3.10; the Rust core makes
this a build-availability question, not a language-version one).

## Target architecture — three retrieval surfaces

All three are per-patient or per-call, embedded with the same model (`moss-mediumlm` as the
working hypothesis — clinical text rewards the accuracy tier, and embedding happens at
enrollment, post-call, and off-path moments, never on the turn's critical path; measure
against `moss-minilm` in Phase A before committing. Note a resumed index adopts its stored
model, so the model choice hardens at first enrollment — pick before Phase 0 patients are
real, or plan a re-embed migration).

### 1. `chart-{patient_id}` — the EHR index (long-term, cloud-persistent)

A durable cloud index, created on patient enrollment and kept current by delta upsert.
Instead of compiling prose and trimming to budget, each FHIR fact becomes one document —
a compiled *line*, not raw FHIR JSON:

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

**Lifecycle.** Created once at enrollment from a full chart read. Before each call, a delta
reconciliation fetches only `_lastUpdated=gt{index_built_at}` from Medplum and upserts the
changed resources — so the expensive part (embedding a heavy history) happens once rather
than per call, and pre-call work shrinks to a hydrate plus a small upsert. `load_index(...,
auto_refresh=True)` keeps warm processes current when several calls share a host. A
Medplum `Subscription` → Bot → upsert path is the eventual push-based upgrade; delta
reconciliation is the pragmatic default and needs no new infrastructure.

The `index_built_at` watermark lives in the app-level store next to the other
non-FHIR state. If it is missing or the index is absent, the reconciler falls back to a full
rebuild — which is also the recovery path after a `delete_index`, and what makes the
"derivable projection" property true rather than aspirational.

### 2. `memories-{patient_id}` — the conversational index (long-term, cloud-persistent)

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
upserts into this index post-call. The `digest()` method survives only as the fallback path
(below).

Keeping the JSON store authoritative even though the index is now durable is deliberate: it
is what makes re-projection possible after a deletion, keeps the negative-constraint
authoring path independent of any Moss availability, and means a Moss outage degrades recall
rather than losing memories.

### 3. The live-call session — `call-{call_id}` (short-term)

A `SessionIndex` opened at call start. After each emit — **off the critical path**, in
`_after_emit` alongside the other bookkeeping — the turn pair is appended:

```
{ id: "turn-17", text: "patient: My knee's been aching on the stairs again.\ncompanion: ...",
  metadata: { turn: 17, phase: "main", urgent: false } }
```

4M findings are appended as they're recorded (`mark_domain_complete` → a
`{ type: "finding", domain }` document), so the Closer's follow-up retrieval sees them.

**The session stays ephemeral — `push_index()` is not called**, even though HIPAA compliance
now makes it permissible. The reasoning changed but the conclusion did not:

- The durable raw transcript already exists in Medplum as a `Binary` +
  `DocumentReference` — that is the audit trail, and the locked decision that makes every
  machine-authored clinical claim checkable. A second verbatim copy in Moss would be a
  parallel record that has to be retained, deleted and reconciled in lockstep with the first,
  for no retrieval benefit.
- Cross-call continuity is better served by the *curated* chunks the post-call pass writes
  into `memories-{patient_id}`. Resuming a raw prior session would surface every "mm-hm"
  alongside the substance; the chunking step is where editorial judgment happens.

One narrow exception worth building later, not now: if a call drops and reconnects, resuming
the session would restore in-call recall. That requires the same treatment for
`TranscriptBuffer` (which is also in-process), so it belongs to a mid-call recovery design
rather than to this one.

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
today's behavior, not a broken call.

**Hydration failure is the new one.** Making indexes cloud-persistent introduces a network
dependency at call start that the rebuild-locally design did not have. If `load_index()`
fails or times out (budget it at ~2s, since it happens pre-dial and not on the latency
path), the call proceeds in **brief mode**: the existing `compile_ehr_brief` + `digest()`
path, kept alive behind `JUNIPER_CONTEXT_MODE=brief|moss` precisely so the current
architecture remains the tested fallback rather than dead code. A patient still gets their
call; they get today's quality of context instead of tomorrow's.

Delta reconciliation failing is softer still — the index is stale by one call's worth of
chart changes, which is logged and retried next call, not a reason to degrade the call.

The urgency filter, consent gate, escalation path, and the entire documentation pass have
no Moss dependency whatsoever. A total Moss outage costs conversation quality and nothing
else — no safety property, no clinical record, no write.

## Module-by-module restructuring

| Module | Change |
|---|---|
| `retrieval.py` (new) | The only module that imports `moss`. `PatientRetrieval` protocol: `ensure_indexes(patient_id)` (create-or-hydrate + delta upsert), `open_call_session(call_id)`, `retrieve(utterance, advisory, k) -> RetrievedContext`, `append_turn(...)`, `probe_domain(domain) -> [docs]`, `project_memories(...)`, `purge_patient(patient_id)` (consent revocation / offboarding). A `FakeRetrieval` (deterministic, fixture-driven) mirrors `FakeProvider` for tests. Hydration, delta reconciliation and the fallback live behind this seam. |
| `medplum.py` | `compile_ehr_brief` splits: `compile_core_header()` (identity, consent, allergies, active med names, care-team refs — small, deterministic, always-pinned) and `extract_chart_documents(since=None)` (the per-resource compiled lines + metadata that feed the chart index; `since` drives delta reconciliation via `_lastUpdated`). The existing full-brief compiler remains for brief mode. Consent gate unchanged. |
| `consent`/offboarding path | Revoking `ai-calling` or deleting a patient calls `purge_patient()`, deleting both durable indexes. New code path, new test — the obligation durable PHI storage creates. |
| `context_brain.py` | Keeps the JSON store + authoring API + post-call write-back as system of record; gains `project_to_index(retrieval)` and transcript chunking in the write-back. `digest()` demoted to fallback. Negative constraints continue to flow to the pinned header and the compassion filter — never through retrieval. |
| `controller.py` | Holds a `PatientRetrieval` instead of (brief text + digest) in moss mode; `_conversation_turn` awaits `retrieve()` before compose; `_after_emit` appends the turn to the session; slow-loop refreshes pass `probe_domain` results to the advisors. Phase machine, coverage, escalation, budgets: untouched. |
| `agents/companion.py` | `compose()` takes `core_header` + `retrieved: RetrievedContext` in place of `brief_text`/`digest`; prompt renders retrieved facts as a labeled context block ("From her chart:", "From past conversations:", "Earlier in this call:") with dates. Persona, tools, rewrite: unchanged. |
| `agents/fourm.py`, `closer.py` | Accept per-domain probe results; advisory schema unchanged (they still emit intent, never prose). |
| `documentation.py` | **No change.** Full transcript in, note + family summary out. |
| `llm_endpoint.py`, `app.py` | No wire change. `app.py`'s `prepare_call` hydrates the two durable indexes and reconciles the chart delta during pre-call setup; hangup path discards the session (never pushed). |
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
- **Consent revocation purges durable state.** Revoke `ai-calling` for a seeded patient;
  assert `purge_patient()` deletes both indexes and that a subsequent call attempt is
  refused by the existing consent gate before any retrieval happens. This is the test that
  makes durable PHI storage defensible.
- **Derivable-projection property.** Delete all Moss state, re-run enrollment projection
  from Medplum + the Context Brain store, and assert the rebuilt indexes return the same
  documents for a fixed probe set. Nothing lives only in Moss.
- **Delta reconciliation.** Add a `Condition` to a seeded patient between two calls; assert
  only the changed resource is upserted (not a full rebuild) and that it is retrievable on
  the second call.
- **Session is never pushed.** Assert `push_index` is not called on the call session across
  a full replayed call, including the hangup path — the raw transcript has exactly one
  durable home, and it is Medplum.
- **Hydration failure falls back.** `load_index` raises/times out; assert the call proceeds
  in brief mode with the existing compiled brief, and that the fallback is logged rather
  than silent.
- **Write-back projection.** Post-call, new memories and transcript chunks appear in the
  Context Brain store and are upserted into the memories index.

## Rollout

Ordered so the durable-state obligations land *before* real PHI does, not after.

- **Phase 0 — enrollment projection and purge.** Build `ensure_indexes()` and
  `purge_patient()` against the two seeded test patients, with the consent-revocation and
  derivable-projection tests green. Deliberately first: the moment durable indexes hold PHI,
  the deletion path must already exist and be tested. Nothing is injected into a call yet.
- **Phase A — shadow.** Hydrate pre-call and run per-turn retrieval, *logging only*.
  Measure: retrieval latency distribution, hydration time, hit-rate against fixture probes,
  full-build time for a heavy-history patient (the 400-observation fixture),
  minilm-vs-mediumlm quality on clinical text, memory per concurrent call. Gates: p95
  retrieval < 20ms; hydration p95 < 1s; full build < 30s (it is now a one-time enrollment
  cost, not per-call, so the old 2s target no longer applies); planted-fact hit-rate ≥ 95%.
- **Phase B — inject.** Companion gets core header + retrieved context; brief mode stays
  the configured default until fixture replays show moss-mode notes capture every planted
  finding brief-mode notes do. Latency CI extended with the `moss_retrieval` stage.
- **Phase C — advisors + session recall.** Domain probes for 4M/Closer; live session
  appends; the 40-turn recall test goes green.
- **Phase D — delta reconciliation + memories write-back.** Chart index stays current
  between calls; post-call projection of memories and transcript chunks lands; `digest()`
  demoted to fallback.
- **Phase E — default flip.** Moss mode becomes the configured default; brief mode remains
  as the tested fallback, exercised by CI forever.
- **Later, unblocked but not scheduled:** Medplum `Subscription` → Bot push-based chart
  updates (replacing delta reconciliation), cross-agent handoff for a clinician console or
  follow-up channel, and mid-call session resume as part of a reconnect design.

## Costs and open questions

Per-turn queries stay local and unmetered on every tier, so cost scales with *storage and
sync*, not conversation volume: two durable indexes per enrolled patient, plus ingest on
enrollment and on each delta. That is a per-patient footprint to model before a large pilot
— chart documents for a heavy-history patient are the bulk of it, and the memories index
grows with every call. Enterprise is the tier this lands on anyway given the compliance
posture; get storage and ingest projections into that pricing conversation rather than
discovering them at the 10 GB Start-up ceiling. Their "voice-minutes" metric applies to
their hosted Founding Agent product, not the SDK path we're taking — worth confirming.

Open questions for Phase A: mediumlm vs minilm on clinical vocabulary (BYOE with a clinical
embedding model is the escape hatch if neither is good enough); per-index memory footprint ×
concurrent calls on one host, now that two durable indexes stay loaded per active patient;
whether chart facts want a keyword-side boost for drug names (hybrid alpha tuning); and
whether `auto_refresh` polling is worth its overhead given that delta reconciliation already
runs pre-call.
