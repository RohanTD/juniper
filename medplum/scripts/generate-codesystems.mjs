#!/usr/bin/env node
/**
 * Generates one FHIR R4 CodeSystem resource per entry in
 * packages/terminology/terminology.json — the single source of truth for every
 * Juniper code — into medplum/resources/codesystem-<slug>.json.
 *
 * Deterministic and idempotent: the output depends only on terminology.json,
 * so re-running produces byte-identical files. Run it after any terminology
 * change and commit the outputs. scripts/check.mjs fails if the committed
 * outputs ever drift from what this script would generate.
 *
 * Usage: node medplum/scripts/generate-codesystems.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const TERMINOLOGY_PATH = resolve(HERE, '..', '..', 'packages', 'terminology', 'terminology.json');
export const RESOURCES_DIR = resolve(HERE, '..', 'resources');

export function loadTerminology() {
  return JSON.parse(readFileSync(TERMINOLOGY_PATH, 'utf8'));
}

function pascalCase(slug) {
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/**
 * Builds every CodeSystem resource from the terminology file.
 * @returns {Map<string, object>} filename -> CodeSystem resource
 */
export function buildCodeSystems(terminology = loadTerminology()) {
  const out = new Map();
  for (const entry of Object.values(terminology.codeSystems)) {
    const slug = entry.url.split('/').pop();
    const resource = {
      resourceType: 'CodeSystem',
      url: entry.url,
      // FHIR "name" must match [A-Z][A-Za-z0-9]*; derive it from the URL slug
      // so it is stable and never starts with a digit (e.g. "4Ms...").
      name: `Juniper${pascalCase(slug)}`,
      title: entry.title,
      status: 'active',
      publisher: 'Juniper Health',
      ...(entry.$comment ? { description: entry.$comment } : {}),
      caseSensitive: true,
      content: 'complete',
      count: Object.keys(entry.codes).length,
      concept: Object.values(entry.codes).map(({ code, display }) => ({ code, display })),
    };
    out.set(`codesystem-${slug}.json`, resource);
  }
  return out;
}

export function serialize(resource) {
  return JSON.stringify(resource, null, 2) + '\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const built = buildCodeSystems();
  for (const [filename, resource] of built) {
    const path = join(RESOURCES_DIR, filename);
    writeFileSync(path, serialize(resource));
    console.log(`wrote ${path} (${resource.count} concepts)`);
  }
}
