#!/usr/bin/env node
/**
 * Seed the voice service's app-level preference store for the seeded patients.
 *
 * `apply.sh` seeds FHIR and stops there, but call windows, topics-to-avoid and
 * interests have no FHIR home — they live in the voice service's own store
 * (docs/CONTRACTS.md §1). Onboarding is normally the only writer, and a seeded
 * patient never goes through onboarding, so every seeded patient had a full
 * chart and no call schedule. The family dashboard's next-call card and the
 * call-settings screen both read from that store, so both rendered empty and
 * looked broken.
 *
 * Two modes:
 *
 *   --api    PUT through the running voice service (the honest path: it goes
 *            through the same validation and authorization as any writer).
 *   --file   Write the JSON store directly. For local development where the
 *            service may not be running or JUNIPER_API_TOKEN is unset.
 *
 * Patient ids are resolved from Medplum by Juniper MRN, because ids are
 * assigned per project and differ in every environment.
 *
 * Usage:
 *   MEDPLUM_BASE_URL=... MEDPLUM_CLIENT_ID=... MEDPLUM_CLIENT_SECRET=... \
 *     node medplum/scripts/seed-preferences.mjs --file
 *   ... --api --voice-url http://localhost:8000 --token $JUNIPER_API_TOKEN
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const SEED_FILE = join(HERE, '../seed/seed-preferences.json');
const DEFAULT_STORE = join(ROOT, 'services/voice/data/preferences.json');
const MRN_SYSTEM = 'https://juniper.health/fhir/identifier/mrn';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const mode = has('--api') ? 'api' : 'file';
const VOICE_DIR = join(ROOT, 'services/voice');
// JUNIPER_PREFERENCES_PATH is relative to the VOICE SERVICE's working
// directory (`npm run dev:voice` cd's into services/voice), not to wherever
// this script happens to be run from. Resolving it against process.cwd()
// silently seeds a file the service will never read — which is exactly the
// class of bug this script exists to fix.
const storePath = resolve(
  VOICE_DIR,
  valueOf('--store', process.env.JUNIPER_PREFERENCES_PATH || DEFAULT_STORE)
);
const voiceUrl = (valueOf('--voice-url', process.env.JUNIPER_VOICE_URL) || 'http://localhost:8000')
  .replace(/\/+$/, '');
const voiceToken = valueOf('--token', process.env.JUNIPER_API_TOKEN);

const die = (message) => {
  console.error(`ERROR: ${message}`);
  process.exit(1);
};

/** Strip the `_comment` documentation keys before anything is written. */
function withoutComments(value) {
  if (Array.isArray(value)) return value.map(withoutComments);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== '_comment')
        .map(([key, inner]) => [key, withoutComments(inner)])
    );
  }
  return value;
}

const seed = withoutComments(JSON.parse(readFileSync(SEED_FILE, 'utf8'))).byMrn;

// ---------------------------------------------------------------- Medplum
const baseUrl = (process.env.MEDPLUM_BASE_URL || '').replace(/\/+$/, '');
if (!baseUrl) die('MEDPLUM_BASE_URL is required (patient ids are resolved by MRN)');

async function medplumToken() {
  const response = await fetch(`${baseUrl}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.MEDPLUM_CLIENT_ID ?? '',
      client_secret: process.env.MEDPLUM_CLIENT_SECRET ?? '',
    }),
  });
  if (!response.ok) die(`Medplum token request failed: ${response.status}`);
  return (await response.json()).access_token;
}

/** MRN -> Medplum patient id, or undefined when the patient is not seeded here. */
async function resolvePatientIds(token, mrns) {
  const resolved = new Map();
  for (const mrn of mrns) {
    const url = `${baseUrl}/fhir/R4/Patient?identifier=${encodeURIComponent(`${MRN_SYSTEM}|${mrn}`)}&_count=1`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) die(`Patient lookup for ${mrn} failed: ${response.status}`);
    const id = (await response.json()).entry?.[0]?.resource?.id;
    if (id) resolved.set(mrn, id);
    else console.warn(`  warn  ${mrn} is not in this project — skipping`);
  }
  return resolved;
}

// ------------------------------------------------------------------ write
async function writeViaApi(patientId, preferences) {
  const headers = { 'Content-Type': 'application/json' };
  if (voiceToken) headers.Authorization = `Bearer ${voiceToken}`;
  const response = await fetch(`${voiceUrl}/patients/${patientId}/preferences`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(preferences),
  });
  if (!response.ok) {
    die(
      `PUT preferences for ${patientId} failed: ${response.status}. ` +
        'The voice service must be running, and --token must match JUNIPER_API_TOKEN ' +
        'when the service has one set.'
    );
  }
}

function writeToFile(entries) {
  // Merge rather than replace: this store also holds real patients written by
  // onboarding, and seeding a demo must never delete someone's actual setup.
  const existing = existsSync(storePath) ? JSON.parse(readFileSync(storePath, 'utf8')) : {};
  for (const [patientId, preferences] of entries) {
    existing[patientId] = preferences;
  }
  mkdirSync(dirname(storePath), { recursive: true });
  writeFileSync(storePath, `${JSON.stringify(existing, null, 2)}\n`);
}

// ------------------------------------------------------------------- main
const token = await medplumToken();
const ids = await resolvePatientIds(token, Object.keys(seed));
const entries = [...ids].map(([mrn, id]) => [id, seed[mrn]]);

if (entries.length === 0) die('no seeded patients found in this project');

if (mode === 'api') {
  for (const [patientId, preferences] of entries) {
    await writeViaApi(patientId, preferences);
  }
  console.log(`Seeded ${entries.length} patient(s) via ${voiceUrl}`);
} else {
  writeToFile(entries);
  console.log(`Seeded ${entries.length} patient(s) into ${storePath}`);
}
for (const [mrn, id] of ids) {
  const windows = seed[mrn].callWindows?.length ?? 0;
  console.log(`  ok    ${mrn} -> Patient/${id} (${windows} call window(s))`);
}
