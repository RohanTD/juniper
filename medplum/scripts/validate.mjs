#!/usr/bin/env node
/**
 * Optional, NETWORKED helper: POSTs every resource in medplum/resources/ and
 * every seed-bundle entry to Medplum's $validate operation and reports the
 * OperationOutcome issues. Run manually against a live project; it writes
 * nothing.
 *
 * Required env: MEDPLUM_BASE_URL, MEDPLUM_CLIENT_ID, MEDPLUM_CLIENT_SECRET
 *
 * Notes:
 *   - Seed entries are validated standalone, so their urn:uuid references may
 *     produce reference-resolution warnings; those are expected (the
 *     references resolve inside the transaction, which scripts/check.mjs
 *     verifies statically).
 *   - AccessPolicy and ClientApplication are Medplum-defined resource types;
 *     $validate works for them on Medplum servers.
 *
 * Usage: node medplum/scripts/validate.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESOURCES_DIR = resolve(HERE, '..', 'resources');
const SEED_DIR = resolve(HERE, '..', 'seed');

const baseUrl = process.env.MEDPLUM_BASE_URL?.replace(/\/$/, '');
const clientId = process.env.MEDPLUM_CLIENT_ID;
const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;
if (!baseUrl || !clientId || !clientSecret) {
  console.error('MEDPLUM_BASE_URL, MEDPLUM_CLIENT_ID and MEDPLUM_CLIENT_SECRET are required');
  process.exit(2);
}
const fhir = `${baseUrl}/fhir/R4`;

async function getToken() {
  const res = await fetch(`${baseUrl}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`token request failed: HTTP ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (!json.access_token) throw new Error('no access_token in token response');
  return json.access_token;
}

let errorCount = 0;

async function validate(token, label, resource) {
  const res = await fetch(`${fhir}/${resource.resourceType}/$validate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/fhir+json',
    },
    body: JSON.stringify(resource),
  });
  let outcome;
  try {
    outcome = await res.json();
  } catch {
    outcome = undefined;
  }
  const issues = outcome?.issue ?? [];
  const errors = issues.filter((i) => i.severity === 'error' || i.severity === 'fatal');
  const warnings = issues.filter((i) => i.severity === 'warning');
  if (!res.ok || errors.length > 0) {
    errorCount++;
    console.error(`  ERROR ${label} (HTTP ${res.status})`);
    for (const issue of errors.length ? errors : issues) {
      console.error(`        [${issue.severity}] ${issue.details?.text ?? issue.diagnostics ?? issue.code}`);
    }
  } else {
    const note = warnings.length ? ` (${warnings.length} warning(s))` : '';
    console.log(`  ok    ${label}${note}`);
    for (const issue of warnings) {
      console.log(`        [warning] ${issue.details?.text ?? issue.diagnostics ?? issue.code}`);
    }
  }
}

const token = await getToken();
console.log(`validating against ${fhir}\n`);

console.log('resources/');
for (const name of readdirSync(RESOURCES_DIR).filter((n) => n.endsWith('.json')).sort()) {
  const resource = JSON.parse(readFileSync(join(RESOURCES_DIR, name), 'utf8'));
  await validate(token, name, resource);
}

for (const name of readdirSync(SEED_DIR).filter((n) => n.endsWith('.json')).sort()) {
  console.log(`\n${name} (entries validated standalone; urn:uuid reference warnings are expected)`);
  const bundle = JSON.parse(readFileSync(join(SEED_DIR, name), 'utf8'));
  for (const entry of bundle.entry ?? []) {
    const r = entry.resource;
    const id = r.identifier?.[0]?.value ?? entry.fullUrl;
    await validate(token, `${r.resourceType} ${id}`, r);
  }
}

console.log('');
if (errorCount > 0) {
  console.error(`validate.mjs: ${errorCount} resource(s) failed $validate`);
  process.exit(1);
}
console.log('validate.mjs: all resources passed $validate');
