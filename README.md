# Juniper

AI-native elderly patient management platform built on [Medplum](https://www.medplum.com).

An agentic voice system calls elderly patients on a recurring basis, holds a warm conversation
structured around the **4Ms of geriatric care** (What Matters, Medication, Mentation, Mobility),
and documents the encounter into the EHR. Two apps surround it: a family/caregiver monitoring app
scoped by CareTeam, and a one-time patient onboarding app.

The full architecture, its locked decisions, and the verification plan live in
[docs/PLAN.md](docs/PLAN.md). Read that first — it is the design authority for this repo.

## Layout

| Path | What | Stack |
|---|---|---|
| [services/voice](services/voice/) | The entire call pipeline: Twilio ↔ Deepgram Voice Agent ↔ our turn loop, post-call documentation, Medplum reads/writes | Python 3.14, FastAPI |
| [apps/onboarding](apps/onboarding/) | One-time patient setup (magic link, one question per screen, accessible theme variant) | Expo / React Native |
| [apps/family](apps/family/) | Read-only caregiver monitoring: check-in timeline, family summaries, alerts | Expo / React Native |
| [packages/theme](packages/theme/) | Ported Thoracle design system + Juniper brand ramp + accessible variant | TypeScript |
| [packages/terminology](packages/terminology/) | Single source of truth for every FHIR code and category slug | JSON (+ TS/Python accessors) |
| [medplum/](medplum/) | Project config: CodeSystems, Device, Organization, AccessPolicies, seed data | FHIR JSON + scripts |
| [docs/](docs/) | Plan, Deepgram integration contract, cross-track API contracts | — |

## Architecture in one paragraph

The **Companion is the only voice** on the call. Advisors (the 4M coverage agent and the Closer)
run on a slow loop off the critical path and emit structured intent, never prose. Deterministic
code — the `ConversationController` — owns slot coverage, phase, turn budgets and escalation.
Every patient utterance passes an **urgency filter** (parallel, zero added latency); every outgoing
utterance passes a **compassion filter** (the only critical-path filter, screening for harshness
*and* condescension). After hangup, the full transcript is rendered into a clinical note, the raw
transcript, and — when consent permits — a family summary: `Encounter` + `Binary` +
`DocumentReference` in Medplum, nothing else. Reads are broad; writes are narrow.

## Quick start

```bash
# Voice service
python3 -m venv .venv && .venv/bin/pip install -e "services/voice[dev]"
npm run test:voice

# Apps + packages
npm install
npm run typecheck && npm test

# Medplum project provisioning (idempotent)
cd medplum && ./scripts/apply.sh   # requires MEDPLUM_* env, see medplum/README.md
```

Environment variables are documented in `services/voice/.env.example`. Secrets are never committed.

## What is built, and what still needs a live credential

Everything in this repo is complete and tested offline — 123 tests across the
voice service, the theme, and both apps, plus static integrity checks over the
Medplum configuration. Three steps require credentials this repo does not carry
and must be run once against a live project:

1. **Provision the Medplum project.** `cd medplum && ./scripts/apply.sh` with
   `MEDPLUM_BASE_URL` / `MEDPLUM_CLIENT_ID` / `MEDPLUM_CLIENT_SECRET` set. It is
   idempotent (conditional creates/updates), so re-running is safe. Then bind the
   caregiver `AccessPolicy` per-patient at `ProjectMembership` time — see
   [medplum/README.md](medplum/README.md) for the exact invite payload, since the
   policy grants nothing until its `%patient` parameter is bound.
2. **Create the voice service's ClientApplication secret** in the Medplum app and
   put it in `services/voice/.env` — no secret is committed.
3. **Place a live call.** Twilio number + a public tunnel to `app.py`, then call
   yourself and role-play a patient before any real one. Listen for gaps after
   *every* turn: this architecture's latency risk is continuous, not concentrated
   at transitions.

## Verification

Every safety property in the plan has a test: escalation precedence, coverage escalation,
condescension screening, negative constraints, consent gating, caregiver access scope, write-scope
enforcement, WCAG AA contrast, and a CI latency budget (p95 end-of-speech → first-audio ≤ 800ms).
See the Verification section of [docs/PLAN.md](docs/PLAN.md) and each component's test suite.
