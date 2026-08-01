# Running Juniper

Four things can be run independently. Only the live phone call needs paid accounts;
everything else runs on your laptop against the seeded Medplum project.

## 0. One-time setup

```bash
git clone https://github.com/RohanTD/juniper.git && cd juniper

# Python (repo-root venv). Note: this machine's `python3 -m venv` has a broken
# ensurepip, hence uv.
uv venv .venv --python 3.14
VIRTUAL_ENV=.venv uv pip install -e "services/voice[dev]" --config-settings editable_mode=compat

# JS workspaces
npm install
```

> **`editable_mode=compat` is not optional.** setuptools' default editable install
> writes an import-hook `.pth` that Python 3.14's `site` does not execute, so
> `import juniper_voice` fails and `uvicorn` cannot boot. The `compat` flag writes a
> plain path `.pth` instead, which works. The test suite is insulated from this
> separately (`pythonpath` in `pyproject.toml`), so a green test run does **not**
> prove the install is usable — check `python -c "import juniper_voice"`.

Then `cp services/voice/.env.example services/voice/.env` and fill it in. The Medplum
project is **already provisioned** (see §4) — you need the client secret from the
Medplum app, plus an Anthropic key. Deepgram and Twilio keys are only needed for §3.

## 1. The test suites — no credentials, no network

This is the main development loop. Everything is offline: fake LLM provider, in-memory
Medplum stub, transcript fixtures.

```bash
npm run test:voice     # 71 Python tests
npm test               # theme + both apps
npm run typecheck
node medplum/scripts/check.mjs
```

Transcript replay is how you iterate on documentation quality without placing a call:
add a fixture to `services/voice/tests/fixtures/transcripts/` and assert what the note
must contain.

## 2. The two apps

```bash
npm run -w @juniper/onboarding start     # or: cd apps/onboarding && npx expo start
npm run -w @juniper/family start
```

Press `w` for browser, `i` for iOS simulator, or scan the QR code with Expo Go. The
onboarding app also exports to static web — that is the intended delivery mechanism,
since a patient or their daughter opens it exactly once from a link:

```bash
npm run -w @juniper/onboarding export:web
```

App config lives in each app's `app.json` under `expo.extra`, or as `EXPO_PUBLIC_*`
environment variables: the Medplum base URL, the OAuth client id, and (onboarding only)
the voice service URL and token for the preferences API.

Note the family app shows nothing until a call has actually happened — it renders
`Encounter`s and family summaries the voice service writes. Its empty state is
deliberate and worth looking at.

## 3. The voice service

```bash
npm run -w juniper dev:voice
# or directly:
.venv/bin/python -m uvicorn "juniper_voice.app:create_app" --factory --port 8000
```

`GET /healthz` should return `{"status":"ok"}`.

### Exercising the turn loop without a phone

The service speaks the OpenAI Chat Completions API, so you can drive a conversation
with `curl`. This runs the real pipeline — Companion, both filters, the controller —
and needs only an Anthropic key:

```bash
curl -s localhost:8000/v1/chat/completions \
  -H "Authorization: Bearer $JUNIPER_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"model":"juniper-companion","messages":[{"role":"user","content":"Hello?"}]}'
```

The call session must exist first; `POST /twilio/voice` creates one, or register a
controller directly in a REPL. See `services/voice/README.md`.

### A real phone call

1. Expose the port: `ngrok http 8000`, then set `JUNIPER_PUBLIC_HOST` to the ngrok host.
2. Point a Twilio number's Voice webhook at `https://<host>/twilio/voice`.
3. Call the number and role-play a patient.

Deepgram connects back to `https://<host>/v1/chat/completions` as its custom LLM — so
the tunnel must be reachable from Deepgram, not just from Twilio.

**Listen for gaps after every turn.** This architecture's latency risk is continuous
rather than concentrated at handoffs, which is exactly why the slow loop exists. Per-turn
stage timings are logged as structured JSON (`turn_latency`), and the budget is p95
end-of-speech → first-audio ≤ 800ms.

## 4. The Medplum project (already provisioned)

The project at `https://api.medplum.com` now holds: five Juniper CodeSystems, the
voice-agent `Device`, the pilot-clinic `Organization`, both `AccessPolicy` resources,
and two seeded patients —

| Patient | MRN | Consent | Purpose |
|---|---|---|---|
| Margaret "Peggy" Alvarez, b. 1946 | `JUN-0001` | all three granted | the full-chart test patient: 6 conditions, 7 medications, 2 allergies, a fall hospitalization, an upcoming follow-up, BP/weight/PHQ-2 history |
| Harold "Hal" Nakamura, b. 1943 | `JUN-0002` | **family-sharing withheld** | proves consent gating and caregiver isolation |

Re-running provisioning is safe — every write is a conditional create or update:

```bash
cd medplum && MEDPLUM_BASE_URL=... MEDPLUM_CLIENT_ID=... MEDPLUM_CLIENT_SECRET=... ./scripts/apply.sh
```

### Still manual

- **Attach the voice-service AccessPolicy.** The `Juniper Voice Service` ClientApplication
  exists and its credentials work, but its `ProjectMembership` has no AccessPolicy bound
  yet, so it currently has full project access. Bind "Juniper Voice Service Policy" to it
  in the Medplum app to make the narrow write surface real rather than merely intended.
- **Invite a caregiver.** The caregiver policy is parameterized and grants nothing until
  `%patient` is bound at membership time. `medplum/README.md` has the exact invite payload.
