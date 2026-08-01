# @juniper/terminology

Single source of truth for every Juniper code, CodeSystem URL and category slug.
`terminology.json` is the artifact; everything else derives from it:

- **TypeScript** (apps): `import { NOTE_CATEGORY, CONSENT_PROVISION } from '@juniper/terminology'`
- **Python** (voice service): `services/voice/juniper_voice/terminology.py` loads the same JSON by path
  (override with `JUNIPER_TERMINOLOGY_PATH`).
- **Medplum config** (`medplum/`): the CodeSystem resources are generated from this file —
  run `medplum/scripts/generate-codesystems` after editing.

Rules:

- Nothing anywhere hardcodes a code string. If you need a code, import it.
- Adding a code here is a cross-cutting change: regenerate the Medplum CodeSystems and check
  both consumers' typechecks/tests.
- LOINC `34748-4` (Telephone encounter Note) was verified against the NLM LOINC API 2026-08-01;
  see the `$comment` inline for the variants considered.
