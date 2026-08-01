# Juniper Onboarding

One-time patient setup for Juniper's AI check-in calls. A patient — or a
family member or clinic staff acting as a proxy — opens a **magic link** (no
account, no password), answers **one question per screen**, grants or declines
**three separate consents** (AI calling, recording, family sharing), reviews,
and submits. After that the app is never opened again: every preference it
captures can also be changed by voice on a call.

Built with Expo + expo-router + `@medplum/core` / `@medplum/react-hooks`
(never `@medplum/react`), styled exclusively with the **accessible variant**
of `@juniper/theme` — no `text.tertiary`, no 11px mono, AA-audited button
fills, 56px touch targets, one primary action per screen.

## Where the answers go (docs/CONTRACTS.md §3)

| Answer | Destination |
|---|---|
| Legal name, DOB, phone | `Patient` (telecom = number to dial) |
| Preferred name | `Patient.name` with `use: nickname` |
| Language | `Patient.communication` |
| Family/caregiver contact | `RelatedPerson` + `CareTeam.participant` |
| Three consents | ONE `Consent`, one provision per granted item (terminology `consentProvision` codes), `Consent.performer` = patient or proxy `RelatedPerson` |
| Call windows, topics to avoid, completedBy | Voice service Preferences API (§1) via `src/preferences.ts` |

All Juniper codes come from `@juniper/terminology`; nothing is inlined.

## Save and resume

The app is used once, by someone in their seventies or eighties, often passing
the phone back and forth with a family member. A call arriving or a tab
reloading used to cost every answer — the largest completion risk in the whole
funnel. So the flow is a persisted draft:

- **Saved as it is typed** (`src/state.tsx`, 250 ms debounce), not on Continue.
  The half-typed birth-date boxes are saved too, in `answers.dobEntry`, because
  `dob` does not exist until they parse.
- **Stored in `expo-secure-store`** — Keychain / Keystore, with
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY` so the draft never reaches an iCloud or
  iTunes backup. A draft holds a legal name, date of birth, phone numbers and
  topics to avoid; it is not "non-secret draft data". Web falls back to
  `localStorage`, exactly where the Medplum access token already lives.
  Rationale in full in `src/draftStorage.ts`.
- **Keyed by patient** (`juniper.onboarding.draft.v1.<patient id>`), so a clinic
  device that opens a second patient's magic link never shows the first
  patient's answers. A pointer key records the most recent scope, which is what
  lets a mid-flow reload restore with no knowledge of who this is.
- **Restored automatically on launch**, with the welcome screen replaced by
  "We saved your answers" and a button back to the question they stopped at.
  Resume reads recorded steps, not filled fields — "no preferred name" and
  "family sharing declined" are answers, and re-asking them reads as pressure.
- **Deleted after a successful submit, and only then** — `clearAfterSubmit` in
  `src/draft.ts`. `submitOnboarding` writes Patient / RelatedPerson / CareTeam /
  Consent before the preferences call, so a late failure leaves those writes
  done; the draft has to survive for the retry that finishes the job (the FHIR
  writes are update-or-create keyed on the patient, so retrying is safe).
- **Expires after 14 days** so an abandoned enrolment's personal data does not
  sit on a shared device indefinitely.

Progress is shown as a bar in `StepHeader` on every question screen, above the
existing "Question N of 13" label — thirteen screens with no sense of how much
is left is its own abandonment risk.

## Run

```bash
npm install            # from the repo root (npm workspaces)
cd apps/onboarding
npx expo start         # iOS simulator / Android / Expo Go
npx expo start --web   # local web dev
npx expo export --platform web   # static web export (the laptop magic-link flow)
npm run typecheck
npm test
```

## Environment variables

Set as `EXPO_PUBLIC_*` so Expo inlines them at bundle time (e.g. in `.env`):

| Variable | Meaning |
|---|---|
| `EXPO_PUBLIC_MEDPLUM_BASE_URL` | Medplum base URL (default `https://api.medplum.com/`) |
| `EXPO_PUBLIC_MEDPLUM_CLIENT_ID` | OAuth `ClientApplication` id for this app (PKCE, hosted auth) |
| `EXPO_PUBLIC_VOICE_API_URL` | Juniper voice service base URL (Preferences API) |
| `EXPO_PUBLIC_VOICE_API_TOKEN` | Bearer token for the Preferences API (`JUNIPER_API_TOKEN`) |

## Notes

- **Metro + pdfmake**: `@medplum/core` optionally peers on `pdfmake`, a known
  Metro hazard. `metro.config.js` resolves `pdfmake` to an in-repo stub via
  `@juniper/medplum-rn/metro`.
- **Auth**: OAuth2/PKCE via `expo-auth-session` against Medplum hosted auth;
  tokens in `expo-secure-store` (web: `localStorage`). No password collection
  anywhere in this app.
- **Tests** are pure logic (node environment): the Preferences API client, the
  FHIR submit builders (patient/proxy provenance, consent provisions, CareTeam
  upsert), the draft store (restore, resume target, patient scoping, expiry,
  clear-after-submit and survive-failed-submit) and a lint test that fails on
  any raw hex color literal in app source — styling must come from theme
  tokens. `src/draft.ts` takes an injected `DraftStorage`, so none of it needs
  a renderer or a native module.

## Intentionally not built

- No account creation or password flows (magic link + hosted auth only).
- No editing of preferences after submission — that is the voice agent's job;
  the app is deliberately one-time.
- No native date/time pickers (large tappable choices instead), no dense
  multi-question forms.
