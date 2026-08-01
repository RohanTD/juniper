# Cross-track contracts

Interfaces that span the voice service, the apps, and the Medplum config. Each side builds to
this document rather than to the other side's code. Codes come from `packages/terminology` —
never inline a code string.

## 1. Preferences API (voice service ⇄ onboarding app ⇄ Companion tools)

Preferences with no FHIR home (call windows, topics to avoid, proxy provenance) live in the
voice service's app-level store. The onboarding app writes them at setup; the Companion updates
them by voice ("call me in the mornings instead") through the same store — this is what keeps
the onboarding app genuinely one-time.

FastAPI routes (bearer auth: `JUNIPER_API_TOKEN`):

```
GET  /patients/{patientId}/preferences
PUT  /patients/{patientId}/preferences
```

Body (both directions):

```json
{
  "callWindows": [
    { "days": ["mon", "tue", "wed", "thu", "fri"], "start": "09:00", "end": "11:00",
      "timezone": "America/New_York" }
  ],
  "topicsToAvoid": ["her late husband Robert"],
  "completedBy": { "role": "patient" }
}
```

- `completedBy.role` is `"patient"` or `"proxy"`; proxy adds `name` and `relationship`.
  This mirrors `Consent.performer` — proxy-captured consent is a materially different claim
  and must survive in both records.
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
| Legal name, DOB, phone | `Patient` (`telecom` = number to dial) |
| Preferred name | `Patient.name` with `use: nickname` |
| Language | `Patient.communication` |
| Family/caregiver contact | `RelatedPerson` + `CareTeam.participant` |
| Three consents | One `Consent` resource, one `provision` per granted item, coded with `consentProvision` codes; `Consent.performer` records who consented |
| Call windows, topics to avoid, proxy flag | Preferences API (§1) |

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

## 5. Model roster (voice service)

All LLM calls go through one provider abstraction (`llm/provider.py`); tests use fakes.
Defaults (env-overridable):

| Role | Model | Why |
|---|---|---|
| Companion | `claude-sonnet-5` | quality × latency on the critical path |
| Compassion filter | `claude-haiku-4-5-20251001` | binary pass/flag, cheapest and fastest |
| Urgency filter | `claude-haiku-4-5-20251001` | parallel with Companion, latency-free but must be fast on interrupt |
| 4M / Closer advisors | `claude-sonnet-5` | slow loop, off critical path |
| Documentation pass | `claude-opus-5` | post-call, quality over latency |
