# Cross-track contracts

Interfaces that span the voice service, the apps, and the Medplum config. Each side builds to
this document rather than to the other side's code. Codes come from `packages/terminology` —
never inline a code string.

## 1. Preferences API (voice service ⇄ onboarding app ⇄ Companion tools)

Preferences with no FHIR home (call windows, topics to avoid, proxy provenance) live in the
voice service's app-level store. The onboarding app writes them at setup; the Companion updates
them by voice ("call me in the mornings instead") through the same store — this is what keeps
the onboarding app genuinely one-time.

FastAPI routes:

```
GET  /patients/{patientId}/preferences
PUT  /patients/{patientId}/preferences
```

**Auth — two kinds of caller, two mechanisms** (shared with §5). Both routes are keyed only on
a path parameter, so authorization cannot be skipped for either:

- **The service token** (`JUNIPER_API_TOKEN`) is the voice service and its own tooling. Trusted
  for any patient.
- **A Medplum user access token** is a caregiver or a patient using an app. The service does not
  interpret it; it asks Medplum whether that token may read `Patient/{patientId}` and mirrors the
  answer. Entitlement therefore stays derived from CareTeam membership and AccessPolicy, in one
  place, rather than being re-implemented here.

The apps ship **no** service token. A shared secret embedded in a caregiver build would be a
master key over every patient's preferences.

Body (both directions):

```json
{
  "callWindows": [
    { "days": ["mon", "tue", "wed", "thu", "fri"], "start": "09:00", "end": "11:00",
      "timezone": "America/New_York" }
  ],
  "topicsToAvoid": ["her late husband Robert"],
  "completedBy": { "role": "patient" },
  "enrollment": {
    "legalName": { "given": "Margaret", "family": "Alvarez" },
    "preferredName": "Peggy",
    "birthDate": "1946-03-12",
    "phone": "+15552018890",
    "language": { "code": "en", "label": "English" }
  }
}
```

- `completedBy.role` is `"patient"` or `"proxy"`; proxy adds `name` and `relationship`.
  This mirrors `Consent.performer` — proxy-captured consent is a materially different claim
  and must survive in both records.
- `enrollment` is the demographics onboarding deliberately does **not** write to `Patient`;
  see §3 for why, and for how the voice service reconciles it against the chart. It is
  preserved across a PUT that omits it, so no client can delete the dial number by staying
  quiet.
- `topicsToAvoid` entries become **negative constraints** in the Context Brain's experiential
  tier, enforced independently by the compassion filter.
- Voice-side updates go through Companion tool calls `update_call_windows` and
  `add_topic_to_avoid`, which write the same store. The preference round-trip test exercises
  app → store → voice → store → app.

## 2. What the apps read (written by the voice service)

| App surface | Query |
|---|---|
| Check-in timeline | `Encounter?subject=Patient/<id>&reason-code=juniper-4m-checkin&_sort=-date` |
| Family summary per check-in | `DocumentReference?encounter=Encounter/<id>&category=<noteCategory.familySummary>` → resolve `content.attachment.url` (Binary) |
| Alerts | `Task?patient=Patient/<id>&code=juniper-escalation&_sort=-authored-on` |

The family app must function with **only** these — the caregiver AccessPolicy hides
`juniper-note` and `juniper-transcript` outright, so no code path may depend on them.

## 3. What onboarding writes (read by the voice service pre-call)

| Field | Destination |
|---|---|
| Legal name, DOB, phone, preferred name, language | Preferences API `enrollment` (§1) — **never `Patient`** |
| Family/caregiver contact | `RelatedPerson` + `CareTeam.participant` |
| Three consents | One `Consent` resource, one `provision` per granted item, coded with `consentProvision` codes; `Consent.performer` records who consented |
| Call windows, topics to avoid, proxy flag | Preferences API (§1) |

**Onboarding does not write demographics.** The chart belongs to the clinic that keeps it. An
app filled in on a phone — by someone in their eighties, or by whichever relative is sitting
with them — is not an authority to overwrite a legal name, a date of birth, or the number a
practice has on file; the likeliest outcome of a typo is a demographic correction nobody
clinical asked for and nobody notices. So Juniper keeps its own copy of what it was told, for
its own operational purposes. The onboarding AccessPolicy is read-only on `Patient`, so this is
enforced server-side rather than by this app's good behavior.

`RelatedPerson`, `CareTeam` and `Consent` *are* still written: they are not the clinic's
demographics but new, Juniper-scoped facts — who the patient named as family (which is what
caregiver access derives from) and what they authorized.

### Reconciling the two at call time

The voice service holds both and must choose. `medplum.py::_resolve_identity` decides:

| Field | Wins | Why |
|---|---|---|
| Phone (the number dialed) | **Enrollment** | A mobile the practice was never told about is the likeliest disagreement; dialing the chart's stale number means not reaching the patient at all. |
| Preferred name, language | **Enrollment** | Facts about *our* interaction, given to us directly and more recently. |
| Legal name, birth date | **Chart** | These identify the person to their clinicians. Enrollment fills them in only when the chart has none (a stub record an admin created and never completed). |

**A disagreement is reported, never silently resolved.** Every substituted value adds a line to
the highest-priority section of the EHR brief, where the token budget cannot trim it — "the
chart still lists +1 555 000 1111" is exactly what a clinician should see.

The `enrollment` block is also **preserved by a PUT that omits it**. The family app's
call-settings screen and the Companion's `update_call_windows` tool each write what they know
about, and neither restates a phone number; under strict replacement the first save from either
would silently delete the only way to reach the patient.

The voice service's pre-call gate refuses to dial unless the `Consent` grants `ai-calling`
**and** `call-recording`. `family-sharing` gates only the family summary generation.

## 4. Escalation Task shape (written by voice service, rendered by family app)

```json
{
  "resourceType": "Task",
  "status": "requested",
  "intent": "order",
  "priority": "urgent",
  "code": { "coding": ["<taskCategory.escalation>"] },
  "description": "<plain-language: what was said, when, what has already happened>",
  "for": { "reference": "Patient/<id>" },
  "encounter": { "reference": "Encounter/<id>" },
  "authoredOn": "<ISO8601>",
  "requester": { "reference": "Device/<voice-agent>" },
  "owner": { "reference": "<CareTeam participant chosen as escalation target>" }
}
```

`description` must be self-sufficient for a caregiver reading it at 11pm: what was said, when,
and what has already been done about it. Never a bare "urgent".

## 5. Alert acknowledgements (family app ⇄ voice service)

"I've seen this" from a caregiver. App-level store, same auth as §1, never FHIR:

```
GET  /patients/{patientId}/alert-acknowledgements
PUT  /patients/{patientId}/alert-acknowledgements
```

```json
{ "acknowledgements": [
    { "taskId": "<Task id>", "acknowledgedAt": "<ISO8601>",
      "acknowledgedBy": "RelatedPerson/<id>" }
] }
```

**A caregiver acknowledgement must never touch `Task.status`.** The escalation Task (§4) is
addressed to the *care team*; its status says what a clinician has done. Flipping it to
`completed` because a daughter tapped a button would be a clinical falsehood authored by the
least-qualified reader — and the caregiver AccessPolicy is read-only on `Task` regardless, so
the write would fail rather than mislead. Acknowledgement is a fact about a family-side reader,
so it lives family-side.

PUT **replaces** the set rather than merging, which is what makes undo expressible; the cost is
last-writer-wins between two caregivers editing simultaneously. Duplicate `taskId`s collapse,
last write winning.

## 6. Model roster (voice service)

All LLM calls go through one provider abstraction (`llm/provider.py`); tests use fakes.
Defaults (env-overridable):

| Role | Model | Why |
|---|---|---|
| Companion | `claude-sonnet-5` | quality × latency on the critical path |
| Compassion filter | `claude-haiku-4-5-20251001` | binary pass/flag, cheapest and fastest |
| Urgency filter | `claude-haiku-4-5-20251001` | parallel with Companion, latency-free but must be fast on interrupt |
| 4M / Closer advisors | `claude-sonnet-5` | slow loop, off critical path |
| Documentation pass | `claude-opus-5` | post-call, quality over latency |
