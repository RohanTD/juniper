# @juniper/family — caregiver monitoring

Read-only Expo app for caregivers on a patient's `CareTeam`. It answers one
question — *how is Mom doing?* — with a qualitative timeline of check-ins,
plain-language summaries, and alerts that are safe to read at 11pm.

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

Sign-in is OAuth2/PKCE via `expo-auth-session` against Medplum's hosted auth —
the app never handles a password. Tokens live in `expo-secure-store`
(`localStorage` on web), wired through `@juniper/medplum-rn`.

## What it shows

A timeline, not a clinical dashboard: when the last call happened, how it went,
what's coming, and any alert raised. Reassurance and awareness, not diagnosis.

Data comes from exactly three queries (docs/CONTRACTS.md §2):

| Surface | Query |
|---|---|
| Check-in timeline | `Encounter?subject=…&reason-code=juniper-4m-checkin&_sort=-date` |
| Per-check-in summary | `DocumentReference?encounter=…&category=juniper-family-summary` → `Binary` |
| Alerts | `Task?patient=…&code=juniper-escalation&_sort=-authored-on` |

Alerts arrive live via `useSubscription` (WebSocket, works in React Native),
with 60-second polling as a fallback so a dropped socket degrades to
slightly-stale rather than silent.

## What is deliberately NOT here

- **No access to the clinical note or the raw transcript.** The caregiver
  `AccessPolicy` admits only the `juniper-family-summary` category; the note and
  transcript are excluded server-side. No client code path references them, and
  [`__tests__/access-scope.test.ts`](__tests__/access-scope.test.ts) fails the
  build if one appears. A caregiver must never be one URL guess away from a full
  recording of their parent's conversation.
- **No charts or trends.** Writes are currently limited to notes, so there is no
  structured data to trend — mood graphs and adherence charts would be mockups
  with nothing behind them. They arrive with the phase-2 `Observation` writes.
- **No writes at all.** The app is read-only by design and by policy.

## Theme

Uses `@juniper/theme`'s **base** variant — the readers are adult children, not
the patients (the onboarding app uses the accessible variant). Component recipes
in use: cards-over-tables for the timeline (icon-in-circle, title, subtitle,
chevron), label-plus-rule headers for the month groupings, and the
serif-display-plus-mono-eyebrow signature on the one screen that earns it — the
summary at the top. Semantic ramps carry meaning only: an alert is `error`, a
completed check-in is `success`, never decoration.

## When there's nothing to show

Empty and denied states are first-class. A caregiver whose access was just
revoked, or whose patient has not consented to family sharing, sees a calm
explanation — not an error screen and not a blank list.
