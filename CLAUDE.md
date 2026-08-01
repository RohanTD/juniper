# Juniper — repo guide

AI-native elderly patient management on Medplum: an agentic voice system makes recurring 4M
check-in calls (What Matters, Medication, Mentation, Mobility) and documents into the EHR;
an Expo onboarding app enrolls patients once; an Expo family app gives caregivers a read-only
timeline.

**`docs/PLAN.md` is the design authority.** Read it before changing architecture. Locked
decisions (one voice, control-in-code, filter precedence, narrow writes) are not up for
re-litigation in code review — change the plan first.

## Commands

```bash
# Voice service tests (Python 3.14, venv at repo root)
.venv/bin/pip install -e "services/voice[dev]"
npm run test:voice

# TS workspaces (theme, terminology, medplum-rn, both apps)
npm install
npm run typecheck && npm test

# Medplum config integrity + provisioning
node medplum/scripts/check.mjs
node medplum/scripts/generate-codesystems.mjs   # after editing packages/terminology
cd medplum && ./scripts/apply.sh                # live apply, needs MEDPLUM_* env
```

## Hard rules

- **Never hardcode a FHIR code string.** Import from `@juniper/terminology` (TS) or
  `juniper_voice/terminology.py` (Python). Adding a code = edit `packages/terminology/terminology.json`,
  regenerate `medplum/resources/codesystem-*.json`, and check both consumers.
- **Safety invariants are code paths, not prompts:** urgency outranks compassion; slow-loop
  advisors never run on the turn's critical path; family summaries are consent-gated at
  generation (never generated-then-hidden); the family app reads only `juniper-family-summary`.
- **Patient-facing UI uses the theme's accessible variant only** — the contrast audit test
  enforces this; don't weaken it.
- **Writes are narrow**: the voice service writes `Encounter`, `Binary`, `DocumentReference`,
  `Task` — nothing else. Enforced by AccessPolicy in `medplum/`.
- Latency budget: p95 end-of-speech → first-audio ≤ 800ms; nothing new lands on the turn's
  critical path without a measurement.

## MCP / infra notes

- `.mcp.json` configures a `deepgram-docs` MCP server (OAuth required — authorize via /mcp
  interactively). Deepgram BYO-LLM contract: `docs/DEEPGRAM_INTEGRATION.md`.
- The Medplum connector (claude.ai) targets the hosted project used for development; the
  repo's `medplum/scripts/apply.sh` is the idempotent way to provision any project.
