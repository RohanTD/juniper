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
  upsert), and a lint test that fails on any raw hex color literal in app
  source — styling must come from theme tokens.

## Intentionally not built

- No account creation or password flows (magic link + hosted auth only).
- No editing of preferences after submission — that is the voice agent's job;
  the app is deliberately one-time.
- No native date/time pickers (large tappable choices instead), no dense
  multi-question forms.
