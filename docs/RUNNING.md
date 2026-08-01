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

Then `cp services/voice/.env.example services/voice/.env` and fill it in. §4 below
walks through provisioning a Medplum project — do that first, since the voice service
needs real values (not the `.env.example` blanks) for `MEDPLUM_CLIENT_SECRET`,
`JUNIPER_DEVICE_REFERENCE` and `JUNIPER_ORGANIZATION_REFERENCE` before it can write
anything. You also need an Anthropic key. Deepgram and Twilio keys are only needed for §3.

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

## 4. Connecting a Medplum project

`medplum/scripts/apply.sh` provisions everything into **whatever project the client
credentials you give it belong to** — it is not tied to one specific project, and
re-running it against the same project is always safe (every write is a conditional
create or update). To point Juniper at a project:

### 4a. Get a bootstrap client (once per project)

In the Medplum app, open the target project → **Clients** → new `ClientApplication`,
give it a name, save it — **don't** attach an AccessPolicy to its `ProjectMembership`
yet. With no policy bound it has full project access, which is exactly what
provisioning needs (creating CodeSystems, AccessPolicies, another ClientApplication).
Copy its client id and secret.

### 4b. Run apply.sh

```bash
cd medplum
MEDPLUM_BASE_URL=https://api.medplum.com \
MEDPLUM_CLIENT_ID=<bootstrap client id> \
MEDPLUM_CLIENT_SECRET=<bootstrap client secret> \
./scripts/apply.sh
```

This creates: five Juniper CodeSystems, the voice-agent `Device`, the pilot-clinic
`Organization`, both `AccessPolicy` resources, the real `Juniper Voice Service`
ClientApplication, and two seeded patients (Margaret "Peggy" Alvarez, MRN `JUN-0001`,
full consent, a complete geriatric chart; Harold "Hal" Nakamura, MRN `JUN-0002`,
**family-sharing withheld**, to exercise consent gating and caregiver isolation).

**Copy its final output straight into `services/voice/.env`** — it prints the exact
`JUNIPER_DEVICE_REFERENCE` / `JUNIPER_ORGANIZATION_REFERENCE` lines for this project.
These are real Medplum-assigned UUIDs, generated fresh on every project, and are
*not* the identifier slugs (`Device/juniper-voice-agent`) — using a stale or
placeholder value here means every note the service writes gets an `author`/
`custodian` reference that resolves to nothing in this project.

### 4c. Still manual after apply.sh

- **Attach the voice-service AccessPolicy.** The real `Juniper Voice Service`
  ClientApplication now exists, but its `ProjectMembership` has no AccessPolicy bound
  yet, so it still has the bootstrap client's full access. In the Medplum app, bind
  "Juniper Voice Service Policy" to its membership — this is what makes the narrow
  write surface (`Encounter`/`Binary`/`DocumentReference`/`Task` only) real rather than
  merely intended. Then set `MEDPLUM_CLIENT_ID`/`MEDPLUM_CLIENT_SECRET` in
  `services/voice/.env` to *this* client's id and secret, not the bootstrap one.
- **Create a public/PKCE client for the apps.** `apply.sh` does not create this —
  `apps/onboarding` and `apps/family` sign in as a human (patient/proxy or caregiver),
  not as a service, so they need a browser/native OAuth client with a redirect URI
  configured, not a client-credentials secret. In the Medplum app: Clients → new
  ClientApplication → set its redirect URI(s) (Expo dev: `exp://127.0.0.1:8081`; the
  app's own scheme for standalone builds, e.g. `juniper-onboarding://`; the deployed
  URL for the web export). Its id goes in both apps'
  `EXPO_PUBLIC_MEDPLUM_CLIENT_ID`.
- **Invite a caregiver.** The caregiver policy is parameterized and grants nothing until
  `%patient` is bound at membership time. `medplum/README.md` has the exact invite payload.
