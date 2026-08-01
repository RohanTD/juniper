#!/usr/bin/env node
/**
 * Static integrity checks for everything in medplum/. No network.
 *
 * Verifies:
 *   1. Every JSON file in medplum/ parses.
 *   2. The committed codesystem-*.json files are byte-identical to what
 *      generate-codesystems.mjs produces from packages/terminology/terminology.json.
 *   3. Every Coding whose system is a Juniper CodeSystem URL matches
 *      terminology.json exactly (system, code, and display when present).
 *   4. Seed bundles are internally consistent: transaction type, unique
 *      urn:uuid fullUrls, every reference resolves inside the bundle, every
 *      entry is a conditional create whose ifNoneExist matches the resource's
 *      own identifier, and every patient-compartment resource points at the
 *      bundle's Patient.
 *   5. Consent gating fixtures: bundle 1 grants all three provisions;
 *      bundle 2 grants ai-calling + call-recording and NOT family-sharing.
 *   6. The voice-service AccessPolicy is writable for exactly
 *      {Encounter, Binary, DocumentReference, Task} and read-only elsewhere.
 *   7. The caregiver AccessPolicy is entirely read-only, parameterized on
 *      %patient, restricted to the allowed resource types, carries the exact
 *      terminology-derived criteria codes, and never mentions juniper-note or
 *      juniper-transcript (nor grants Binary).
 *   8. Device/Organization identifiers match terminology.json.
 *
 * Usage: node medplum/scripts/check.mjs   (exit code 0 = all checks pass)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCodeSystems, loadTerminology, serialize, RESOURCES_DIR } from './generate-codesystems.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SEED_DIR = join(ROOT, 'seed');

let failures = 0;
const ok = (msg) => console.log(`  ok    ${msg}`);
const fail = (msg) => {
  failures++;
  console.error(`  FAIL  ${msg}`);
};
const section = (msg) => console.log(`\n${msg}`);

const terminology = loadTerminology();
const JUNIPER_CS_PREFIX = 'https://juniper.health/fhir/CodeSystem/';

// Index terminology: system url -> Map(code -> display)
const csByUrl = new Map();
for (const entry of Object.values(terminology.codeSystems)) {
  csByUrl.set(entry.url, new Map(Object.values(entry.codes).map((c) => [c.code, c.display])));
}

/** Depth-first over every plain object in a JSON tree. */
function* objects(node) {
  if (Array.isArray(node)) {
    for (const item of node) yield* objects(item);
  } else if (node && typeof node === 'object') {
    yield node;
    for (const value of Object.values(node)) yield* objects(value);
  }
}

// ---------------------------------------------------------------- 1. parsing
section('1. JSON parsing');
const files = new Map(); // relative path -> parsed
for (const dir of [RESOURCES_DIR, SEED_DIR]) {
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const path = join(dir, name);
    try {
      files.set(path, JSON.parse(readFileSync(path, 'utf8')));
    } catch (err) {
      fail(`${path}: ${err.message}`);
    }
  }
}
ok(`${files.size} JSON files parsed`);

// -------------------------------------------------- 2. codesystem generation
section('2. CodeSystems match terminology.json (regenerated in memory)');
const generated = buildCodeSystems(terminology);
for (const [filename, resource] of generated) {
  const path = join(RESOURCES_DIR, filename);
  let onDisk;
  try {
    onDisk = readFileSync(path, 'utf8');
  } catch {
    fail(`${filename}: missing — run node scripts/generate-codesystems.mjs`);
    continue;
  }
  if (onDisk === serialize(resource)) {
    ok(`${filename} is byte-identical to generated output`);
  } else {
    fail(`${filename}: drifted from terminology.json — run node scripts/generate-codesystems.mjs`);
  }
  if (resource.status !== 'active' || resource.content !== 'complete' || resource.caseSensitive !== true) {
    fail(`${filename}: expected status=active, content=complete, caseSensitive=true`);
  }
}
const strayCodeSystems = readdirSync(RESOURCES_DIR).filter(
  (n) => n.startsWith('codesystem-') && !generated.has(n)
);
if (strayCodeSystems.length > 0) {
  fail(`stray codesystem files not derived from terminology.json: ${strayCodeSystems.join(', ')}`);
} else {
  ok('no stray codesystem-*.json files');
}

// ------------------------------------------------------- 3. coding audit
section('3. Juniper codings match terminology.json in every file');
let codingCount = 0;
for (const [path, json] of files) {
  if (json.resourceType === 'CodeSystem') continue; // covered by check 2
  for (const node of objects(json)) {
    if (typeof node.system === 'string' && node.system.startsWith(JUNIPER_CS_PREFIX) && typeof node.code === 'string') {
      codingCount++;
      const codes = csByUrl.get(node.system);
      if (!codes) {
        fail(`${path}: unknown Juniper CodeSystem ${node.system}`);
      } else if (!codes.has(node.code)) {
        fail(`${path}: code '${node.code}' not defined in ${node.system}`);
      } else if (node.display !== undefined && node.display !== codes.get(node.code)) {
        fail(`${path}: display for ${node.code} is '${node.display}', terminology says '${codes.get(node.code)}'`);
      }
    }
  }
}
ok(`${codingCount} Juniper codings audited against terminology.json`);

// --------------------------------------------------------- 4. seed bundles
section('4. Seed bundle internal consistency');
const consentCodesSeen = new Map(); // seed file -> Set of permitted provision codes
for (const [path, bundle] of files) {
  if (bundle.resourceType !== 'Bundle') continue;
  const label = path.split('/').pop();

  if (bundle.type !== 'transaction') fail(`${label}: Bundle.type must be 'transaction'`);

  const fullUrls = new Set();
  const byUrl = new Map();
  for (const entry of bundle.entry ?? []) {
    const fu = entry.fullUrl ?? '';
    if (!/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(fu)) {
      fail(`${label}: bad fullUrl '${fu}'`);
    }
    if (fullUrls.has(fu)) fail(`${label}: duplicate fullUrl ${fu}`);
    fullUrls.add(fu);
    byUrl.set(fu, entry.resource);

    // conditional create discipline
    if (entry.request?.method !== 'POST') fail(`${label}: ${fu} request.method must be POST`);
    if (entry.request?.url !== entry.resource?.resourceType) {
      fail(`${label}: ${fu} request.url '${entry.request?.url}' != resourceType '${entry.resource?.resourceType}'`);
    }
    const ifNoneExist = entry.request?.ifNoneExist;
    if (!ifNoneExist) {
      fail(`${label}: ${fu} missing request.ifNoneExist (bundle would duplicate on re-run)`);
    } else {
      const m = /^identifier=([^|]+)\|(.+)$/.exec(ifNoneExist);
      if (!m) {
        fail(`${label}: ${fu} ifNoneExist not of form identifier=system|value`);
      } else {
        const matches = (entry.resource.identifier ?? []).some((id) => id.system === m[1] && id.value === m[2]);
        if (!matches) fail(`${label}: ${fu} ifNoneExist '${ifNoneExist}' does not match the resource's own identifier`);
      }
    }
  }

  // every reference resolves inside the bundle
  let refCount = 0;
  for (const entry of bundle.entry ?? []) {
    for (const node of objects(entry.resource)) {
      if (typeof node.reference === 'string') {
        refCount++;
        if (!fullUrls.has(node.reference)) {
          fail(`${label}: unresolved reference '${node.reference}' in ${entry.fullUrl}`);
        }
      }
    }
  }

  // patient-compartment sanity
  const patients = [...byUrl.entries()].filter(([, r]) => r.resourceType === 'Patient');
  if (patients.length !== 1) fail(`${label}: expected exactly 1 Patient, found ${patients.length}`);
  const patientUrl = patients[0]?.[0];
  for (const [fu, resource] of byUrl) {
    if (resource.resourceType === 'Patient') continue;
    const subjectRef = resource.subject?.reference ?? resource.patient?.reference;
    if (subjectRef !== undefined && subjectRef !== patientUrl) {
      fail(`${label}: ${resource.resourceType} ${fu} subject/patient is '${subjectRef}', expected the bundle Patient`);
    }
  }
  const careTeam = [...byUrl.values()].find((r) => r.resourceType === 'CareTeam');
  const relatedPerson = [...byUrl.entries()].find(([, r]) => r.resourceType === 'RelatedPerson');
  const consent = [...byUrl.values()].find((r) => r.resourceType === 'Consent');
  if (!careTeam) fail(`${label}: no CareTeam`);
  if (!relatedPerson) fail(`${label}: no RelatedPerson caregiver`);
  if (!consent) fail(`${label}: no Consent`);
  if (careTeam && careTeam.subject?.reference !== patientUrl) fail(`${label}: CareTeam.subject != Patient`);
  if (relatedPerson && relatedPerson[1].patient?.reference !== patientUrl) fail(`${label}: RelatedPerson.patient != Patient`);
  if (consent && consent.patient?.reference !== patientUrl) fail(`${label}: Consent.patient != Patient`);
  if (consent && consent.performer?.length !== 1) fail(`${label}: Consent.performer must record who consented`);
  if (careTeam && relatedPerson) {
    const members = (careTeam.participant ?? []).map((p) => p.member?.reference);
    if (!members.includes(relatedPerson[0])) fail(`${label}: CareTeam does not list the RelatedPerson caregiver`);
  }
  const appointment = [...byUrl.values()].find((r) => r.resourceType === 'Appointment');
  if (appointment && !(appointment.participant ?? []).some((p) => p.actor?.reference === patientUrl)) {
    fail(`${label}: Appointment has no participant referencing the Patient`);
  }

  if (consent) {
    const permitted = new Set();
    for (const p of consent.provision?.provision ?? []) {
      if (p.type !== 'permit') continue;
      for (const node of objects(p.code)) {
        if (typeof node.system === 'string' && node.system.startsWith(JUNIPER_CS_PREFIX) && node.code) {
          permitted.add(node.code);
        }
      }
    }
    consentCodesSeen.set(label, permitted);
  }

  ok(`${label}: ${bundle.entry.length} entries, ${refCount} references resolve, compartment consistent`);
}

// ------------------------------------------------------ 5. consent fixtures
section('5. Consent gating fixtures');
const cp = terminology.codeSystems.consentProvision.codes;
const firstConsent = consentCodesSeen.get('seed-bundle.json') ?? new Set();
const secondConsent = consentCodesSeen.get('seed-bundle-second-patient.json') ?? new Set();
for (const key of ['aiCalling', 'recording', 'familySharing']) {
  if (firstConsent.has(cp[key].code)) ok(`seed-bundle.json permits ${cp[key].code}`);
  else fail(`seed-bundle.json must permit ${cp[key].code}`);
}
for (const key of ['aiCalling', 'recording']) {
  if (secondConsent.has(cp[key].code)) ok(`seed-bundle-second-patient.json permits ${cp[key].code}`);
  else fail(`seed-bundle-second-patient.json must permit ${cp[key].code}`);
}
if (secondConsent.has(cp.familySharing.code)) {
  fail(`seed-bundle-second-patient.json must NOT permit ${cp.familySharing.code}`);
} else {
  ok(`seed-bundle-second-patient.json withholds ${cp.familySharing.code}`);
}

// ------------------------------------------------- 6. voice-service policy
section('6. Voice-service AccessPolicy read/write asymmetry');
const voicePolicy = files.get(join(RESOURCES_DIR, 'access-policy-voice-service.json'));
const EXPECTED_WRITABLE = new Set(['Encounter', 'Binary', 'DocumentReference', 'Task']);
const EXPECTED_READONLY = [
  'Patient', 'Consent', 'CareTeam', 'Condition', 'MedicationStatement', 'MedicationRequest',
  'AllergyIntolerance', 'Observation', 'Appointment', 'CarePlan', 'Goal',
];
{
  const writable = new Set();
  const readonly = new Set();
  for (const entry of voicePolicy?.resource ?? []) {
    (entry.readonly === true ? readonly : writable).add(entry.resourceType);
  }
  const extraWritable = [...writable].filter((t) => !EXPECTED_WRITABLE.has(t));
  const missingWritable = [...EXPECTED_WRITABLE].filter((t) => !writable.has(t));
  if (extraWritable.length) fail(`voice policy grants write beyond the contract: ${extraWritable.join(', ')}`);
  if (missingWritable.length) fail(`voice policy missing write access to: ${missingWritable.join(', ')}`);
  if (!extraWritable.length && !missingWritable.length) {
    ok(`writable is exactly {${[...EXPECTED_WRITABLE].join(', ')}}`);
  }
  const missingReadonly = EXPECTED_READONLY.filter((t) => !readonly.has(t));
  if (missingReadonly.length) fail(`voice policy missing read-only access to PLAN read-table types: ${missingReadonly.join(', ')}`);
  else ok(`all PLAN.md read-table types present as readonly`);
  const overlap = [...readonly].filter((t) => writable.has(t));
  if (overlap.length) fail(`voice policy lists types as both readonly and writable: ${overlap.join(', ')}`);
}

// ---------------------------------------------------- 7. caregiver policy
section('7. Caregiver AccessPolicy scoping');
const caregiverPolicy = files.get(join(RESOURCES_DIR, 'access-policy-caregiver.json'));
{
  // Binary is the one entry that legitimately carries NO criteria. Medplum
  // cannot filter Binary by search criteria at all; it scopes Binary by
  // securityContext inheritance — a Binary is readable only if the caller can
  // read the resource its securityContext points at. Every Binary the voice
  // service writes carries securityContext -> its owning DocumentReference
  // (enforced by test_write_contract.py), so the caregiver reads
  // family-summary binaries and is denied note/transcript binaries.
  //
  // This check previously asserted the OPPOSITE ("must not grant Binary —
  // transcript binaries would be one ID guess away"). Verified live
  // 2026-08-01 and that assumption was wrong in both directions: without the
  // grant Medplum hands the caregiver a bare "Binary/<id>" instead of a
  // presigned URL and the family app cannot read summary text at all (403);
  // with it, a direct read of the clinical note's Binary still returns 404.
  const CRITERIA_TYPES = new Set(['Patient', 'RelatedPerson', 'Encounter', 'Task', 'DocumentReference']);
  const ALLOWED_TYPES = new Set([...CRITERIA_TYPES, 'Binary']);
  const seenTypes = new Set();
  for (const entry of caregiverPolicy?.resource ?? []) {
    seenTypes.add(entry.resourceType);
    if (entry.readonly !== true) fail(`caregiver policy: ${entry.resourceType} entry is not readonly`);
    if (!ALLOWED_TYPES.has(entry.resourceType)) fail(`caregiver policy: unexpected resourceType ${entry.resourceType}`);
    if (entry.resourceType === 'Binary') continue; // scoped by securityContext, not criteria
    if (!entry.criteria) {
      fail(`caregiver policy: ${entry.resourceType} entry has no criteria (would be project-wide)`);
    } else if (!entry.criteria.includes('%patient') && !entry.criteria.includes('%profile')) {
      fail(`caregiver policy: ${entry.resourceType} criteria not parameterized: ${entry.criteria}`);
    }
  }
  for (const t of CRITERIA_TYPES) {
    if (!seenTypes.has(t)) fail(`caregiver policy: missing ${t} entry`);
  }
  if (seenTypes.has('Binary')) {
    ok('Binary granted read-only (scoped by securityContext inheritance, not criteria)');
  } else {
    fail('caregiver policy: Binary grant missing — the family app cannot read summary text without it (Medplum returns a bare Binary/<id>, 403 on fetch)');
  }

  const enc = terminology.codeSystems.encounterReason;
  const task = terminology.codeSystems.taskCategory;
  const note = terminology.codeSystems.noteCategory;
  const expectations = [
    ['Encounter', `reason-code=${enc.url}|${enc.codes.fourMCheckIn.code}`],
    ['Task', `code=${task.url}|${task.codes.escalation.code}`],
    ['DocumentReference', `category=${note.url}|${note.codes.familySummary.code}`],
  ];
  for (const [type, expected] of expectations) {
    const entry = (caregiverPolicy?.resource ?? []).find((r) => r.resourceType === type);
    if (entry?.criteria?.includes(expected)) ok(`${type} criteria pins ${expected.split('|').pop()} (terminology-derived)`);
    else fail(`caregiver policy: ${type} criteria must contain '${expected}'`);
  }

  const raw = JSON.stringify(caregiverPolicy);
  for (const forbidden of [note.codes.note.code, note.codes.transcript.code]) {
    if (raw.includes(`|${forbidden}`) || raw.includes(`"${forbidden}"`)) {
      fail(`caregiver policy: mentions forbidden category '${forbidden}'`);
    } else {
      ok(`'${forbidden}' appears nowhere in the caregiver policy`);
    }
  }
}

// ------------------------------------------- 8. device / organization ids
section('8. Device and Organization identifiers from terminology.json');
{
  const device = files.get(join(RESOURCES_DIR, 'device-voice-agent.json'));
  const org = files.get(join(RESOURCES_DIR, 'organization-clinic.json'));
  const devId = terminology.identifiers.device;
  const orgId = terminology.identifiers.organization;
  if ((device?.identifier ?? []).some((i) => i.system === devId.system && i.value === devId.value)) {
    ok(`Device identifier is ${devId.system}|${devId.value}`);
  } else {
    fail('device-voice-agent.json identifier does not match terminology identifiers.device');
  }
  if (device?.status !== 'active') fail('device-voice-agent.json: status must be active');
  if ((org?.identifier ?? []).some((i) => i.system === orgId.system && i.value === orgId.value)) {
    ok(`Organization identifier is ${orgId.system}|${orgId.value}`);
  } else {
    fail('organization-clinic.json identifier does not match terminology identifiers.organization');
  }

  // MRNs across bundles must be distinct
  const mrns = [];
  for (const [, json] of files) {
    if (json.resourceType !== 'Bundle') continue;
    for (const entry of json.entry ?? []) {
      if (entry.resource?.resourceType === 'Patient') {
        for (const id of entry.resource.identifier ?? []) {
          if (id.system === 'https://juniper.health/fhir/identifier/mrn') mrns.push(id.value);
        }
      }
    }
  }
  if (new Set(mrns).size === mrns.length && mrns.length === 2) ok(`distinct MRNs: ${mrns.join(', ')}`);
  else fail(`expected 2 distinct MRNs, got: ${mrns.join(', ')}`);
}

// -------------------------------------------------------------- summary
console.log('');
if (failures > 0) {
  console.error(`check.mjs: ${failures} failure(s)`);
  process.exit(1);
}
console.log('check.mjs: all checks passed');
