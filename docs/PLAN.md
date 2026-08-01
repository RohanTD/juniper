# Juniper — Voice agent, onboarding app, family app

## Context

Juniper is an AI-native elderly patient management platform built on Medplum. An agentic voice system calls elderly patients on a recurring basis, holds a warm conversation structured around the 4Ms of geriatric care (What Matters, Medication, Mentation, Mobility), and documents the encounter into the EHR. Two apps surround it: a family/caregiver monitoring app scoped by CareTeam, and a one-time patient onboarding app that captures preferences before handing the patient off to the voice system permanently.

Nothing has been built yet — the working directory is empty. This plan covers three deliverables: the voice service, the onboarding app, and the family app. A patient receives a call, the agent converses, and one `DocumentReference` categorized as "Juniper Notes" lands in Medplum alongside its `Encounter` and the raw transcript. Structured 4M resources (`Goal`, `Observation`, `MedicationStatement`) are the one thing deliberately deferred — writing AI-extracted structured clinical data is a materially higher-stakes act than writing prose a clinician reads and judges — but the design must not foreclose them.

`deepgram-devs/deepgram-voice-agent-multi-agent` was the starting reference — a persistent Twilio audio task with ephemeral Voice Agent sessions swapped between agents. **Juniper deliberately departs from it.** Rather than handing the microphone between agents, the **Companion is the only speaker** for the entire call; the 4M agent and the Closer advise it and never address the patient directly. The patient therefore experiences one continuous person, which matters more here than anywhere else — the primary value of the call is feeling known, and meeting three personalities in twelve minutes destroys that.

There is no separate orchestrator agent. What would have been the orchestrator's job splits cleanly in two: **speaking** belongs to the Companion, and **bookkeeping and control** belong to deterministic code (`ConversationController`). Slot coverage, phase transitions, turn budgets and priority escalation were never LLM work — an agent "remembering" which of four domains are filled is strictly worse than a counter.

## Locked decisions

These were settled with the user and drive everything below.

1. **The Companion is the only voice**, for the whole call including the close. The 4M agent and the Closer advise it; neither ever addresses the patient. No handoffs, no session swaps, no persona discontinuity.
2. **Control lives in code, not in an agent.** A `ConversationController` owns slot coverage, phase, turn budgets and priority escalation. There is no orchestrator LLM.
3. **Two always-on filters gate every turn**: an urgency filter on patient input, and a compassion filter on outgoing messages.
4. **Two contexts are always loaded**: the Context Brain (past-conversation memories) and the EHR context (the patient's Medplum record).
5. **The 4M agent runs on a slow loop, off the critical path.** Coverage state changes slowly; its standing advisory is refreshed every few turns rather than every turn, which is what keeps the per-turn path to roughly one LLM hop.
6. **The note is generated asynchronously after hangup**, from the full transcript — the patient never waits on generation latency. The Closer's job is nonetheless *documentation quality*: it is the last chance to capture anything the async pass would otherwise have to record as missing.
7. **The voice service writes `Encounter` + `Binary` + `DocumentReference` only**, plus a `Task` when the urgency filter escalates. No `Goal`/`MedicationStatement`/`Observation` — writing AI-extracted structured clinical data is a materially higher-stakes act than writing prose a clinician reads and judges, and it waits. The 4M agent must still capture per-domain findings in a shape those resources can be derived from later.
8. **Experiential memory lives in an app-level store, outside FHIR.** Clinical/longitudinal memory goes to FHIR. FHIR has no good home for "granddaughter Maya started college."
9. **Both the summary note and the raw conversation are stored in the EHR**, as two `DocumentReference`s under distinct categories.
10. **Medplum is the system of record.** No outbound integration to a provider EHR, but the note's `DocumentReference` is shaped to port cleanly when a customer requires it.
11. **Reads are broad, writes are narrow.** The Companion is fed the patient's full clinical picture as always-on context, while the system writes back only the note, the transcript, and the encounter that anchors them. Reading widely costs nothing and makes the call dramatically better; writing widely is a much higher-stakes act, deferred deliberately.

## The latency problem, and the four rules that solve it

This is the risk that decides whether the architecture ships or feels broken, and it must shape the code from the first commit rather than be tuned later.

A phone conversation allows roughly **300–800ms** after the patient stops speaking before silence reads as wrong. Elderly patients are *less* tolerant of this, not more — they say "hello? are you there?" or assume the call dropped. A naive multi-agent implementation runs 5–7 sequential LLM calls per turn; at 300ms each that is a 2–3 second gap on *every turn*. The handoff design paid dead air a few times per call; a poorly-structured advisory design would pay it constantly.

Four rules collapse the critical path to roughly one LLM hop plus a filter:

1. **The 4M agent runs on the slow loop.** Coverage state barely changes turn to turn, so it maintains a standing advisory refreshed every few turns rather than being consulted on each one. This is the single largest latency win available, and it is the main reason for collapsing the orchestrator into the Companion — with a separate orchestrator, the Companion still had to propose an intent before anything could be composed.
2. **Advisors emit intent, not sentences.** The 4M advisory is short and structured (`medication adherence unfilled, priority high — she mentioned a new pharmacy`), never draft prose. The Companion writes the actual line, weaving warmth and clinical purpose into one utterance: *"Oh, how nice that Margaret's visiting — is she helping you keep track of your pills while she's there?"*
3. **Urgency runs on patient input, so it is free.** It needs only what was said, not the outgoing message, so it runs **in parallel** with the Companion and interrupts rather than post-filters. The most safety-critical component adds zero latency.
4. **Compassion is the only filter on the critical path — keep it cheap.** Small fast model, binary pass/flag. Most turns pass and ship immediately; only a trip pays the rewrite cost. Backchannels ("mm-hm", "I see") cover composition time and suit the persona anyway.

**Integration consequence:** this breaks Deepgram's managed STT→LLM→TTS loop, since the "LLM" is now a controller wrapping the Companion plus a filter. Expose that whole turn loop as a **custom LLM endpoint** that Deepgram calls — keeping their VAD, barge-in handling and streaming TTS while owning only the thinking. Confirm against Deepgram's bring-your-own-LLM documentation before building; it determines the entire integration shape.

## Safety rules

- **Urgency outranks compassion.** A compassion filter that softens *"that chest pain needs a call to your doctor today"* into something gentler is itself a harm. When urgency fires, the compassion filter may adjust tone but may not weaken or remove the clinical directive. Enforce this in the controller, not in a prompt.
- **The compassion filter screens for condescension, not only harshness.** Patronizing "elder-speak" is a documented harm in geriatrics, and a filter tuned solely toward gentleness drifts straight into it.
- **Summaries are prompt context, never the clinical record.** Documentation reads the complete transcript. A summarizer that drops "I've been dizzy standing up" is a patient-safety miss.
- **Identity and consent gate the call**, before any conversational agent engages. Voicemail, a confused patient, and a family member answering are all common and need explicit handling paths.

## Repository layout

```
juniper/
  services/voice/          # Python — the entire call pipeline
    app.py                 # FastAPI: Twilio voice webhook + /media WebSocket
    llm_endpoint.py        # OpenAI-compatible endpoint Deepgram calls — the turn loop entry point
    controller.py          # ConversationController — deterministic. Coverage, phase, budgets, escalation
    filters/
      urgency.py           # on patient input, runs parallel with the Companion
      compassion.py        # on outgoing message, the only critical-path filter
    agents/
      companion.py         # THE VOICE — composes and speaks every utterance
      fourm.py             # slow-loop coverage advisory; never speaks
      closer.py            # slow-loop gap manifest; never speaks
      gatekeeper.py        # answered-by identification, consent, voicemail bail-out
      advisory.py          # shared advisory schema emitted by fourm and closer
    transcript.py          # durable full-turn buffer (the source of truth)
    context_brain.py       # two-tier read/write
    documentation.py       # post-call: transcript -> note text
    medplum.py             # FHIR reads (patient brief) + writes (Encounter, Binary, DocumentReference)
    escalation.py          # urgent-concern sink
  medplum/                 # project config: CodeSystem, Device, AccessPolicy, seed scripts
  apps/
    family/                # Expo / React Native — caregiver monitoring
    onboarding/            # Expo — one-time patient setup, then never used again
  packages/
    theme/                 # Thoracle theme system, ported (see THEME_SYSTEM.md)
    terminology/           # Juniper codes as JSON — consumed by Python and TS alike
```

Python for the voice service (matches the Deepgram reference and the Twilio media-stream ecosystem), talking to Medplum over the plain FHIR REST API.

### Medplum in React Native

The apps are Expo / React Native, so the Medplum package choice needs care — but less than it first appears. Verified against Medplum 5.1.27:

| Package | RN? | Use it |
|---|---|---|
| `@medplum/core` | Yes — fetch-based `MedplumClient` | Yes |
| `@medplum/react-hooks` | **Yes** — zero runtime deps, peers are only `@medplum/core` and `react` | Yes |
| `@medplum/react` | No — depends on Mantine 8 and `react-dom` | No |

So the apps use **`@medplum/core` + `@medplum/react-hooks`**, which supplies `useMedplum`, `useMedplumProfile`, `useResource`, `useSearch`, `useSearchResources`, `useSearchOne` and `useSubscription`. Only `@medplum/react` is unavailable, and it contains generic FHIR UI (`ResourceTable`, `SearchControl`, Mantine forms) that would have fought the editorial theme regardless. Nothing needed is lost.

Three integration details:

- **`useSubscription` is worth using in the family app.** It is WebSocket-based and works in RN, so alerts arrive live rather than by polling.
- **Token storage is `expo-secure-store`, not `localStorage`.** `MedplumClient` accepts a custom storage implementation; wire it explicitly rather than relying on the default.
- **Auth is OAuth2/PKCE via `expo-auth-session`.** Neither app collects a password directly — onboarding's magic link and the family login both hand off to Medplum's hosted auth.

One known risk: `@medplum/core` has a hard dependency on **`pdfmake`**, which is browser/Node-oriented and can break Metro bundling. If it does, the standard fix is a Metro resolver alias stubbing it out — neither app generates PDFs. Worth checking on day one rather than discovering mid-build.

Expo can also export the onboarding app to web, which is worth using: a link a caregiver opens on a laptop beats "install an app you will open exactly once."

The language split means FHIR knowledge could drift between the service and the apps. `packages/terminology/` is the guard: every Juniper code, CodeSystem URL and category slug lives in one JSON file that both sides read. Nothing hardcodes a code string.

The apps can be built in parallel with the voice service — they read what the service writes, so the only coupling is the terminology package and the seed data.

## Component detail

### `controller.py` — the ConversationController

Deterministic code, no LLM. This is where the removed orchestrator's *accountability* lives, and keeping it out of a prompt is the whole point. It owns:

- **Always-loaded context**: the Context Brain digest and the EHR brief (see the read contract below), both compiled once pre-call and held for the whole conversation. No FHIR round trips mid-call — they would land directly on the latency path.
- **The `TranscriptBuffer`** — durable, full-turn, never reset. The source of truth for documentation.
- **Phase**: `gatekeeper → main → closing → done`. The transitions are computed from slot coverage, elapsed time and fatigue signals — not decided by an agent.
- **Slot coverage and escalation.** Tracks which of the four domains are filled and at what confidence, and **escalates priority mechanically**: after N turns with no progress on a domain, the 4M advisory stops being advice and becomes a required intent the Companion must act on next turn.
- **Turn orchestration**: dispatch urgency ∥ Companion, run compassion, emit, handle barge-in cancellation. Cancellation must be wired from the start or interrupted turns leak work and cost.

The escalation mechanism is not optional polish. A Companion whose identity is rapport will systematically under-push on clinical extraction — too polite to redirect, too willing to follow a tangent. The predictable failure is a series of lovely calls with thin 4M data, and it will not be obvious from listening to them. Mechanical teeth are what counteract that bias.

### `agents/companion.py` — the voice

The only agent that produces patient-facing language, for the entire call. Its prompt carries the persona, the Context Brain digest, the EHR brief, the recent transcript window, and the current standing advisory. It composes one utterance per turn serving both warmth and whatever clinical purpose the advisory carries.

Deliberately **not** in this prompt: coverage bookkeeping, phase logic, turn budgets. Those belong to the controller, and putting them here re-creates the problem the controller exists to solve.

### `filters/` — the two gates

`urgency.py` classifies patient input for anything needing prompt attention, running concurrently with the Companion. On a trip it both interrupts the normal path (the controller forces the Companion to address the concern rather than continue) and raises an out-of-band escalation via `escalation.py` — without waiting for the post-call pass.

`compassion.py` checks outgoing text for harshness *and* condescension, returning pass/flag. On flag, the Companion rewrites. It may never weaken an urgency-driven clinical directive; enforce that as a code path, not a prompt instruction.

### `agents/fourm.py` — the slow-loop advisory

Runs every few turns, off the critical path. Reads the transcript window and current coverage, and emits a short structured advisory (via the schema in `advisory.py`): which domain to pursue, at what priority, and any hook from the conversation worth using to get there. It never writes patient-facing prose.

It reports findings through `mark_domain_complete(domain, findings, confidence)`, which the controller records. `findings` must be loosely-structured per-domain data, not prose, so phase 2 can derive `Goal` / `MedicationStatement` / `Observation` from the same field without re-parsing the note.

### `agents/closer.py` — the documentation-completeness advisory

The Closer is not primarily a goodbye, and it **never takes the microphone** — it is the second slow-loop advisor. Having it speak would break the one-voice rule at exactly the moment the patient is most tired and least tolerant of a personality change.

When the controller enters the `closing` phase, it builds a **gap manifest**: which of the four M slots are unfilled or low-confidence, which requested data points were never answered, and any answer ambiguous enough that a documenter would have to hedge. The Closer turns that manifest into prioritized advisories — targeted follow-ups, not a re-interrogation — and the Companion speaks them, then delivers a brief recap and closes warmly. The 4M advisory stands down once closing begins.

Two constraints:

- **It must know when to stop**, and the controller enforces that, not the agent. An elderly patient will tire, and grinding through every gap produces a worse call *and* worse data than accepting two unfilled slots. The controller holds the closing turn budget; the manifest is priority-ordered so the remaining turns go to what matters clinically rather than to completing the schema.
- **Unresolved gaps must be recorded, not silently dropped.** Anything still missing when the call ends is passed to `documentation.py` and rendered explicitly in the note ("mobility not assessed — patient tired, call ended early"). A note that is honestly incomplete is safe; one that reads complete because a gap vanished is not.

### `context_brain.py` — two tiers

- **Experiential** (app-level store): grandchildren, hobbies, an upcoming beach trip, and **negative constraints** — "don't mention her late husband, it upsets her." Sits in the Companion's prompt. This is what makes the call feel like a relationship rather than a survey.
- **Clinical/longitudinal** (read from FHIR): prior notes, last reported adherence, recent falls. Feeds the 4M advisory for follow-up ("last time she mentioned the stairs were getting harder") and later the family app.

Negative constraints deserve their own treatment: they are not just prompt flavour but hard prohibitions, and the compassion filter should enforce them independently rather than trusting the Companion to have honoured them.

Write-back after each call updates the experiential tier from the transcript.

### `documentation.py` + `medplum.py` — the post-call pass

Triggered on hangup. Reads the full transcript and produces **two documents from the same source**: the clinical note, and — when the patient's `Consent` permits family sharing — a family summary in plain language. Writes in this order: `Encounter` (so everything has an anchor) → `Binary` + `DocumentReference` for the clinical note → the same pair for the raw transcript → the same pair for the family summary.

Generating both from the transcript rather than deriving the family summary from the clinical note matters: summarizing a summary compounds error, and the family version needs different content, not softer wording.

## Medplum read/write contract

### Encounter vs. DocumentReference — both, not either

FHIR separates the *event* from the *artifact describing it*, and Juniper needs both:

- `Encounter` — the call happened: virtual, 12 minutes, this patient, this date.
- `DocumentReference` — the readable note about what was said.

Linked via `DocumentReference.context.encounter`. Without the Encounter, "how many check-ins this quarter?" requires parsing note text — which the family app and any care-gap reporting will need. The Encounter is also the **join key**: the escalation `Task` and every phase-2 resource (`Goal`, `Observation`, `MedicationStatement`) carries an `.encounter` reference, so "everything from this call" is a single query.

Note `Encounter.participant` accepts `Practitioner`/`RelatedPerson` but **not `Device`** — AI attribution lives on `DocumentReference.author`, not on the Encounter.

### Reads — the EHR context

The EHR context is one of the two things always loaded into the orchestrator, so this read is deliberately **broad**. Everything below is fetched once pre-call and compiled into a single **EHR brief** held for the whole conversation — an unbounded record cannot be re-sent every turn, and re-fetching mid-call would put FHIR round trips on the latency path.

| Resource | Purpose |
|---|---|
| `Patient` | Legal name, preferred name (`name.use = nickname`), DOB, `telecom` (number to dial), `communication` (language) |
| `Consent` | Gate the call — verify consent to AI calling and recording *before* dialing |
| `CareTeam` | Escalation targets; later, family app authorization |
| `Condition` | Problem list — shapes which questions matter for this patient |
| `MedicationStatement` / `MedicationRequest` | Lets the 4M agent name actual drugs rather than asking generically |
| `AllergyIntolerance` | Safety context for anything medication-related |
| `Observation` | Recent vitals, weights, prior screening scores — the baseline any change is measured against |
| `Encounter` (recent) | Recent hospitalizations or ED visits. Enormously relevant for a geriatric check-in, and the patient may not volunteer them |
| `Appointment` (upcoming) | Both clinical and conversational: *"you've got Dr. Chen next Tuesday — are you set for a ride?"* |
| `CarePlan` / `Goal` | Existing care goals to follow up against |
| `DocumentReference?category=juniper-note` | Last 2–3 notes, for conversational continuity |

Two practical constraints on the brief:

- **Compile, don't concatenate.** Raw FHIR JSON is verbose and token-expensive on every turn. The brief should be a compact prose or structured digest built once, sized to sit in context alongside the Context Brain without crowding out the conversation itself.
- **Recency-filter aggressively.** A patient with twenty years of history has thousands of Observations. Bound each query by date and count, and prefer the most recent of each type.

Call-window preferences from the onboarding app have no natural FHIR home and belong in the app store. Preferred name and language do have homes and should be written into `Patient` properly.

### Writes, per call

| Resource | Count | Notes |
|---|---|---|
| `Encounter` | 1 | `status: finished`, `class: VR` (virtual), `period` = call start/end, `reasonCode` = 4M check-in |
| `Binary` | 2–3 | Clinical note, raw conversation, and the family summary when consent permits |
| `DocumentReference` | 2–3 | `juniper-note`, `juniper-transcript`, `juniper-family-summary` — all joined by `relatesTo` and hanging off the same `Encounter` |
| `Task` | 0–n | Urgent concerns — `priority: urgent`, `for` Patient, `.encounter` link, owner from CareTeam |

### The provider-EHR boundary

Medplum is the system of record. Nothing is pushed outward, but the design anticipates it:

- **The `Encounter` never ports.** Encounters are the clinic's scheduling and billing domain; they will not accept an external one. It is permanently Juniper's record.
- **The note is the only thing that travels**, and it is the same `DocumentReference` already being written — so later integration is a transport problem, not a re-modeling one.
- **`docStatus` is the gate.** Notes sit at `preliminary`; clinician review flips them to `final`; only `final` would ever cross outward.
- **The raw conversation stays in Medplum.** A full transcript in a clinician's chart is noise and needlessly expands the discoverable record. It is Juniper's audit trail.

Deliberately deferred: writing notes into Epic/athenahealth is rarely a clean FHIR write — most orgs ingest external documents via HL7v2 `MDM^T02`, Direct messaging, or fax. That is a per-customer integration project, and pilot clinics will accept Medplum access or an export long before funding one.

## FHIR write contract

FHIR R4 requires only `status` and `content.attachment` on `DocumentReference`; everything else below is optional per spec but necessary for the note to be usable by a clinic.

```json
{
  "resourceType": "DocumentReference",
  "status": "current",
  "docStatus": "preliminary",
  "type": { "coding": [{ "system": "http://loinc.org", "code": "34748-4",
                         "display": "Telephone encounter note" }] },
  "category": [{ "coding": [{ "system": "https://juniper.health/fhir/CodeSystem/note-category",
                              "code": "juniper-note", "display": "Juniper Notes" }] }],
  "subject":   { "reference": "Patient/<id>" },
  "date":      "<ISO8601>",
  "author":    [{ "reference": "Device/juniper-voice-agent" }],
  "custodian": { "reference": "Organization/<clinic>" },
  "context": {
    "encounter": [{ "reference": "Encounter/<id>" }],
    "period": { "start": "<call start>", "end": "<call end>" }
  },
  "content": [{
    "attachment": { "contentType": "text/plain", "url": "Binary/<id>",
                    "title": "Juniper 4M check-in — <date>" }
  }]
}
```

Non-obvious requirements:

- **`author` is a `Device`, not a `Practitioner`.** AI-generated text must not be attributed to a human clinician. Clinician review populates `authenticator` and flips `docStatus` from `preliminary` to `final` — that one field is the entire human-review workflow, and it costs nothing to support now.
- **`category` needs a custom `CodeSystem`.** No standard code exists for "Juniper Notes". Define it in `medplum/` deliberately so `?category=juniper-note` search works from day one.
- **Note text goes in a `Binary`, referenced by URL.** Medplum explicitly recommends against inlining base64 into `attachment.data`. Use `createBinary`, then point `content.attachment.url` at `Binary/<id>`.
- **The raw conversation is stored as a second `DocumentReference`** (own category, e.g. `juniper-transcript`, own `Binary`, `relatesTo` linking note → transcript with code `transforms`). The note is derived; retaining the source makes every clinical claim auditable, which matters disproportionately when the author is a machine. Both hang off the same `Encounter`.
- **Verify LOINC `34748-4`** against Medplum's terminology service before committing — nurse-specific telephone-note variants exist and may fit better.
- **`Composition` is the better long-term note model** — it supports native sections, one per M, making the 4Ms individually addressable. But `DocumentReference` + `Binary` is what external systems ingest and what Medplum does idiomatically. Start with plain text; revisit once structured 4M resources land in phase 2.

## `packages/theme` — the design system

Port `THEME_SYSTEM.md` verbatim: three font families with fixed roles (Instrument Serif for display only, Outfit for all body and UI, IBM Plex Mono for small uppercase labels and metadata), 10-step color ramps, the text-style recipes, spacing, radii, shadows and component recipes. Never hardcode a hex or px value in a screen — always a token.

Two changes the port must make.

**1. Generate a full Juniper brand ramp.** The theme's step 3 is explicit that swapping only the 500 step leaves the rest persimmon-derived. Pick a juniper-appropriate hex — the plant's deep blue-green or berry tones both work and both read as calmer than persimmon, which suits a health context better than a board-review app — and generate all ten steps from it. Duplicate it into `accent` as a literal, per the theme's own note.

**2. Add an accessible variant for patient-facing surfaces.** This is not optional, and it is the one place the theme cannot be taken as-is. It was designed for a surgical board-review app — young professionals on good screens. Juniper's onboarding app is used by people in their seventies and eighties, and its caregivers are frequently in their fifties and sixties. Three concrete failures, with contrast computed against `background.primary` (#FFFFFF):

| Token | Contrast on white | Verdict |
|---|---|---|
| `text.secondary` (#5A5A66) | ~6.8:1 | Passes AA — safe everywhere |
| `text.tertiary` (#9E9EA7) | ~2.7:1 | **Fails AA badly.** Must not carry any text a patient needs to read |
| White on `primary[500]` (#E8572A) | ~3.6:1 | **Fails AA for normal text.** The default `button.primary` recipe is affected |

The fix for the button is small: use the **600 step** as the fill when white text sits on it (#CC4520 gives ~4.7:1 and passes). Note this applies to the persimmon ramp as computed — recheck both numbers against the new Juniper ramp, since a different hue at the same nominal step will land elsewhere.

Beyond contrast, the patient variant should raise the floor of the type scale (`xs: 11` uppercase mono is a stylish label and an unreadable one at 78), and must respect OS font scaling — RN honours Dynamic Type by default, but the theme's fixed numeric `lineHeights` will clip scaled text unless they are computed as multipliers of the scaled size.

The family app can run much closer to the theme as written. Its readers are adult children, not the patients.

## `apps/onboarding` — one-time patient setup

Deliberately the smallest thing in the system. Its entire job is to capture enough for the voice agent to take over, and then never be opened again. **Every preference it collects must also be changeable by voice** — "call me in the mornings instead" has to work, or the app becomes load-bearing and the premise breaks. That means a small set of preference-update tools available to the Companion, built alongside the app rather than after it.

What it collects, and where each piece lands:

| Field | Destination |
|---|---|
| Legal name, DOB, phone | `Patient` (`telecom` = the number to dial) |
| Preferred name | `Patient.name` with `use: nickname` |
| Language | `Patient.communication` |
| Best call times | App-level store — no FHIR home |
| Topics to avoid | Context Brain, as negative constraints |
| Family/caregiver contacts | `RelatedPerson` + `CareTeam.participant` |
| Consent to AI calling, recording, family sharing | `Consent`, with separate provisions per item |

Design constraints, which matter more than the feature list:

- **Use the theme's accessible variant throughout**, never the base tokens. No `text.tertiary`, no 11px mono labels, no white-on-`primary[500]` buttons. One screen per question rather than a dense form.
- **No account creation.** A magic link, opened on whatever device is handy — Expo web export makes a laptop link viable. Password creation is where elderly onboarding funnels die.
- **Patient or proxy, one flow.** A family member or clinic staff can complete it on the patient's behalf — many elderly patients will not finish a web form alone, and blocking on that blocks enrollment. Record who filled it in (`Consent.performer`, and a proxy flag on the app-level record), because a consent captured by proxy is a materially different claim than one captured first-party, and the distinction must survive in the record rather than being flattened.
- **The three consents are separate**, because they genuinely are: agreeing to be called is not agreeing to be recorded, and neither is agreeing that a daughter can read the summaries.

## `apps/family` — caregiver monitoring

Read-only, for caregivers on the patient's `CareTeam`. Built on `packages/theme`.

**Identity and access.** A caregiver is a `RelatedPerson` linked to the Patient and listed as a `CareTeam.participant`. In Medplum, they get a `ProjectMembership` whose profile is that `RelatedPerson`, with an `AccessPolicy` restricting reads to patients whose CareTeam includes them. Access is derived from CareTeam membership, never granted directly — so removing someone from the care team removes their access, with no second place to remember to revoke.

**What it shows.** A timeline of check-ins rather than a clinical dashboard: when the last call happened, how it went, what's coming up, and any alert raised. Reassurance and awareness, not diagnosis.

The prose it renders is a **separate family summary**, not the clinical note — a third `DocumentReference` (category `juniper-family-summary`) produced by the same post-call pass from the same transcript, but written for a non-clinical reader. This is worth the extra write for two reasons: clinical hedging ("denies acute distress") reads as alarming to a daughter, and the patient may not want everything in the clinical note shared with family. Same source, two audiences, two documents.

The family summary is gated by the sharing provision in `Consent`. If the patient has not agreed to family sharing, it is not generated at all — not generated-then-hidden.

One honest constraint to design around: with writes limited to notes, **there is no structured data to trend.** No mood graphs, no adherence charts — those need the `Observation` writes that are deliberately deferred. The app shows a qualitative timeline, and the design should be built for that rather than mocked up with charts that have no data behind them.

**Alerts** come from the escalation `Task`s the urgency filter raises. Their presentation needs care: a caregiver seeing "urgent" on their phone at 11pm with no context and no one to call is worse than useless. Each alert states what was said, when, and what has already happened about it.

**Where the theme fits.** The check-in timeline is exactly the theme's "cards over tables" pattern — icon-in-circle, title, subtitle, chevron — and the label-plus-rule section header carries the date groupings. The serif-display-plus-mono-eyebrow signature belongs on the one screen that earns it: the "how is Mom doing" summary at the top. Use the semantic ramps only for meaning, per the theme's rule — an alert is `error`, a completed check-in is `success`, and neither is decoration.

## Medplum project setup (`medplum/`)

1. `CodeSystem` for `https://juniper.health/fhir/CodeSystem/note-category` with `juniper-note`, `juniper-transcript` and `juniper-family-summary` codes.
2. `Device` resource representing the voice agent, referenced as `author` on every note.
3. `Organization` for the clinic (`custodian`).
4. Seed script creating a realistically-populated test `Patient` — `CareTeam` with a `RelatedPerson` caregiver, `Consent`, medications, conditions, allergies, a recent hospitalization `Encounter`, an upcoming `Appointment`, and some `Observation` history. The agent reads all of it and the family app authorizes against the CareTeam, so a thin fixture will exercise neither.
5. Client credentials for the voice service, with an `AccessPolicy` that permits broad read across the patient's compartment but **write access only to `Encounter`, `Binary`, `DocumentReference` and `Task`**. The read/write asymmetry should be enforced by policy, not just by convention in the code.
6. A **caregiver `AccessPolicy`** for the family app: read-only, scoped by CareTeam membership, and admitting **only** the `juniper-family-summary` category. Both the clinical note and the raw transcript are excluded outright — a caregiver must never be one URL guess away from a full recording of their parent's conversation.
7. `packages/terminology` as the single source for every code above, generated into both the Medplum config and the apps.

## Build order

Safety and the write path first, conversation quality second — a warm call that silently drops an urgent finding is worse than an awkward call that escalates correctly.

1. `filters/urgency.py` + `escalation.py`
2. Medplum project setup + `medplum.py` — the broad pre-call read compiled into the EHR brief, and the narrow post-call write, verified with a hand-written fake transcript
3. `documentation.py` with a transcript-replay harness (no phone calls needed)
4. Twilio + Deepgram plumbing: `app.py`, `llm_endpoint.py`, and a bare `companion.py` with no advisors — get a full round trip talking end-to-end and **measure the turn latency before adding anything to the path**
5. `filters/compassion.py` — the only other thing that will ever sit on the critical path. Measure again.
6. `controller.py`, then `advisory.py` + `fourm.py` on the slow loop
7. `gatekeeper.py`, then `closer.py`
8. `context_brain.py` and its write-back

The apps run on their own track, in parallel, gated only on the terminology package and seed data:

- A throwaway Expo spike first: `@medplum/core` + `@medplum/react-hooks` fetching one seeded `Patient`. This settles the `pdfmake`/Metro question and the secure-store wiring before any UI exists
- `packages/theme` from `THEME_SYSTEM.md` — port, generate the Juniper ramp, add the accessible variant
- `apps/onboarding` — build it early, since real patients cannot exist without it
- The Companion's preference-update tools, alongside onboarding rather than after it
- `apps/family` last, once there are real family summaries to render

## Verification

- **Transcript replay (primary loop).** A fixture directory of realistic 4M transcripts, including adversarial ones: a patient who rambles, one who answers "fine" to everything, one who mentions a fall in passing. Run `documentation.py` against them and assert the note captures each planted finding. This is how you iterate on documentation quality without placing a single call.
- **FHIR validation.** Assert every written resource passes Medplum's `$validate`; that `GET /DocumentReference?category=juniper-note&subject=Patient/<id>` returns the note and resolves its `Binary`; and that the transcript is retrievable both by its own category and by traversing `relatesTo` from the note.
- **Gap-manifest test.** Replay a fixture where the patient deflects on mobility. Assert the Closer raises it, and that if it stays unanswered the note says so explicitly rather than omitting the domain.
- **Escalation test.** Plant "I fell yesterday and my chest hurts" mid-conversation in a replay fixture; assert the urgency filter trips, the controller forces the Companion to address it rather than continue, and the escalation sink receives it *before* the post-call pass runs.
- **Coverage-escalation test.** This guards the Companion's structural bias toward niceness. Replay a chatty patient who happily talks about anything except medication. Assert the controller escalates the medication advisory to a required intent, that the Companion actually acts on it, and that coverage is not silently abandoned in favour of a pleasant conversation.
- **Filter-precedence test.** Construct a turn where urgency fires and the composed message is clinically direct. Assert the compassion filter does not weaken the directive — this is the one interaction between the two filters that can cause real harm.
- **Condescension test.** Fixtures of patronizing output ("Are we remembering to take our pills today?"). Assert the compassion filter flags them, not just harsh ones.
- **Negative-constraint test.** Seed the Context Brain with "never mention her late husband," plant a transcript turn that invites it, and assert nothing referencing him is spoken.
- **EHR brief test.** Assert the brief refuses to dial when `Consent` is absent or revoked; that a seeded medication surfaces by name in a 4M intent; that a recent hospitalization `Encounter` and an upcoming `Appointment` both reach the orchestrator; and that the compiled brief stays within its token budget for a patient with heavy history.
- **Write-scope test.** Attempt a `MedicationStatement` write with the service credentials and assert Medplum rejects it. The narrow write surface should be provably enforced, not merely intended.
- **Latency instrumentation (continuous, not a one-off).** Log per-stage timings on every turn: STT finalize, Companion composition, compassion, first TTS byte. Fail CI if p95 end-of-speech to first-audio exceeds **800ms**. This is the number that determines whether the architecture works, and the slow-loop design exists to protect it — assert in CI that no slow-loop work ever lands on the critical path.
- **Caregiver access-scope test.** Log in as a seeded `RelatedPerson` and assert: the family summary is readable, the clinical note and raw transcript are not readable by any path, a second patient's records are invisible, and removing them from the `CareTeam` immediately revokes access.
- **Consent-gating test.** Run the post-call pass for a patient whose `Consent` withholds family sharing; assert no family summary is generated at all — not generated and hidden.
- **Two-audience test.** Replay a transcript containing something clinically necessary but distressing to a family reader. Assert it appears in the clinical note, that the family summary is neither false nor alarming, and that the family summary is generated from the transcript rather than from the clinical note.
- **Preference round-trip test.** Set a call window in the onboarding app, then change it by voice, and assert both the app and the next call's scheduling reflect it. If preferences can only be changed in the app, the premise that the app is one-time is false.
- **Contrast audit in CI.** Assert every foreground/background token pair used in the onboarding app meets WCAG AA (4.5:1 normal, 3:1 large). This is cheap to automate over the theme tokens and catches the regression where someone reaches for `text.tertiary` because it looks right on their laptop.
- **Font-scaling test.** Render both apps at the largest OS text size and assert nothing clips or overlaps — the theme's fixed numeric line heights are the specific risk.
- **Live call, own phone first.** Twilio number + ngrok to `app.py`. Call yourself and role-play a patient before any real one. Listen specifically for gaps after *every* turn — unlike the handoff design, this architecture's latency risk is continuous rather than concentrated at transitions.

## Deferred to phase 2

Structured 4M resources (`Goal`, `MedicationStatement`, `Observation` with PHQ-2 / falls LOINC codes) and medication-list reconciliation. The `mark_domain_complete` findings shape is the seam these hang off — keep it structured even though this phase only renders it to prose. Landing them is also what unlocks real trends in the family app, which until then shows a qualitative timeline.

## Open question to resolve before build

Deepgram's bring-your-own-LLM support is the load-bearing assumption for the custom-endpoint integration in step 4. If it turns out their Voice Agent API cannot call an external orchestrator with acceptable latency, the fallback is wiring Deepgram STT (Nova) and TTS (Aura) as separate streaming APIs and owning VAD and barge-in ourselves — meaningfully more work, and worth confirming first rather than discovering in step 4.

> **Resolved 2026-08-01:** Deepgram's Voice Agent API supports bring-your-own-LLM via `agent.think.provider.type: "open_ai"` plus `agent.think.endpoint.url` pointing at any endpoint conforming to the OpenAI Chat Completions API format (streaming included). See `docs/DEEPGRAM_INTEGRATION.md`. The custom-endpoint architecture stands; no fallback needed.
