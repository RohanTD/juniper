# @juniper/family — caregiver monitoring

Read-mostly Expo app for caregivers on a patient's `CareTeam`. It answers one
question — *how is Mom doing?* — with a status answer at the top, a qualitative
timeline of check-ins, the next scheduled call, and alerts that are safe to read
at 11pm.

It runs primarily as a **web dashboard** (a link a daughter opens on a laptop
beats an app she installs once) and degrades to a single column on a phone.

## Running

```bash
npx expo start          # device / simulator
npx expo start --web    # browser
npm run typecheck && npm test
```

Environment (via `app.json` → `expo.extra`, or `EXPO_PUBLIC_*` vars):

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_MEDPLUM_BASE_URL` | Medplum server (default `https://api.medplum.com/`) |
| `EXPO_PUBLIC_MEDPLUM_CLIENT_ID` | OAuth2/PKCE client for the caregiver app |
| `EXPO_PUBLIC_VOICE_API_URL` | Juniper voice service — call settings and alert acknowledgements |

Sign-in is OAuth2/PKCE via `expo-auth-session` against Medplum's hosted auth —
the app never handles a password. Tokens live in `expo-secure-store`
(`localStorage` on web), wired through `@juniper/medplum-rn`.

## Screens

| Route | What it is |
|---|---|
| `/sign-in` | The landing screen: the Juniper identity, one line on what this is for a caregiver, what you will (and will not) be able to read, and the way in. |
| `/` | The dashboard: status hero, four stat tiles, open alerts at full measure, then two columns — recent check-ins inline on the left, next call / care team / links on the right. |
| `/checkins` | The full timeline, month by month. |
| `/checkin/[id]` | One call's plain-language family summary. |
| `/alerts` | Every escalation, open first, each with the family-side acknowledgement and the care-team contact. |
| `/preferences` | Call windows and topics to avoid, with a live preview of when the next call would land. |

## Data

Reads come from exactly the three queries in docs/CONTRACTS.md §2, plus the
signed-in `Patient` and `RelatedPerson` the AccessPolicy already admits:

| Surface | Query |
|---|---|
| Check-in timeline | `Encounter?subject=…&reason-code=juniper-4m-checkin&_sort=-date` |
| Per-check-in summary | `DocumentReference?encounter=…&category=juniper-family-summary` → `Binary` |
| Alerts | `Task?patient=…&code=juniper-escalation&_sort=-authored-on` |

Alerts arrive live via `useSubscription` (WebSocket, works in React Native),
with 60-second polling as a fallback so a dropped socket degrades to
slightly-stale rather than silent.

Two non-FHIR surfaces on the voice service's app-level store, both authorized
per-patient with the caregiver's own Medplum token (never a shared secret):

| Endpoint | Purpose |
|---|---|
| `GET/PUT /patients/{id}/preferences` | Call windows and topics to avoid (docs/CONTRACTS.md §1) |
| `GET/PUT /patients/{id}/alert-acknowledgements` | Family-side "I've seen this" |

### The next call

Derived in `src/data/schedule.ts` from the saved call windows and their IANA
timezone — computed and rendered in the **patient's** zone, correct across DST,
and always shown as a **range** with the caveat that Juniper calls somewhere
inside it. A window is not an appointment, and a caregiver told "9:00 AM" who
gets a call at 10:40 was misled by the app.

### Alert acknowledgement

"Mark as seen" writes to the acknowledgement store above, **never to
`Task.status`**. The escalation Task is addressed to the care team: its status
records what a clinician did, and a caregiver completing it would be a clinical
claim made by the reader least placed to make it. (The caregiver AccessPolicy is
read-only on `Task`, so the boundary is enforced on both sides.) An alert
therefore shows two independent facts — what the care team has done, and what
you have done — and acknowledging one never hides it or changes its status.

### Care-team contact — what is actually readable

The caregiver AccessPolicy is a strict allow-list: `Patient` (their own),
`RelatedPerson` (their own profile), check-in `Encounter`s, escalation `Task`s,
family-summary `DocumentReference`s and `Binary`. **`CareTeam` and
`Practitioner` are not on it.** So:

- `CareTeam.participant.member.display` is **not reachable** — the resource is
  denied outright, not field-filtered.
- A clinician's phone number is **not reachable** by any path, because it lives
  on `Practitioner.telecom`.
- What *is* reachable is display text riding along on readable resources:
  `Patient.generalPractitioner[].display`, `Patient.contact[]` (a full
  BackboneElement, telecom included), and `Task.owner.display`.

`src/data/careteam.ts` reads exactly those three. Where a number genuinely is
not available, the card says so and points at 911 rather than rendering a dead
"Call" button — at 11pm a number that does not connect costs the one thing a
caregiver has least of, which is trust that the app is telling them the truth.

## What is deliberately NOT here

- **No access to the clinical note or the raw conversation record.** The
  caregiver `AccessPolicy` admits only the `juniper-family-summary` category;
  both others are excluded server-side. No client code path references them, and
  [`__tests__/access-scope.test.ts`](__tests__/access-scope.test.ts) fails the
  build if one appears. A caregiver must never be one URL guess away from a full
  recording of their parent's conversation.
- **No charts or trends.** Writes are currently limited to notes, so there is no
  structured data to trend — mood graphs and adherence charts would be mockups
  with nothing behind them. The stat tiles are counts and dates the app actually
  holds; real trends arrive with the phase-2 `Observation` writes.
- **No clinical writes.** The only two things this app writes are call
  preferences and its own acknowledgements, both outside FHIR.

## Theme

Uses `@juniper/theme`'s **base** variant — the readers are adult children, not
the patients (the onboarding app uses the accessible variant). Component recipes
in use: cards-over-tables for the timeline (icon-in-circle, title, subtitle,
chevron), label-plus-rule headers for every section, and the
serif-display-plus-mono-eyebrow signature on the two screens that earn it — the
landing screen and the dashboard's "how is …​ doing?". Semantic ramps carry
meaning only: an alert is `error`, a completed check-in is `success`, and "no
recent calls" is deliberately neutral rather than green.

## When there's nothing to show

Empty and denied states are first-class. A caregiver whose access was just
revoked, or whose patient has not consented to family sharing, sees a calm
explanation — not an error screen and not a blank list. A read failure says it
is a read failure, never something that implies a clinical finding.
