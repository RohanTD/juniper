/**
 * @juniper/terminology — typed access to the single source of truth in terminology.json.
 *
 * Never hardcode a Juniper code string anywhere: import from here.
 * The Python voice service reads the same JSON via services/voice/terminology.py.
 */
import terminology from '../terminology.json';

export { terminology };

export interface JuniperCoding {
  system: string;
  code: string;
  display: string;
}

type CodeEntry = { code: string; display: string };
type CodeSystemEntry = { url: string; title: string; codes: Record<string, CodeEntry> };

const systems = terminology.codeSystems as unknown as Record<string, CodeSystemEntry>;

function coding(systemKey: string, codeKey: string): JuniperCoding {
  const cs = systems[systemKey];
  const entry = cs?.codes[codeKey];
  if (!cs || !entry) {
    throw new Error(`Unknown terminology entry: ${systemKey}.${codeKey}`);
  }
  return { system: cs.url, code: entry.code, display: entry.display };
}

/** Note category codings — DocumentReference.category */
export const NOTE_CATEGORY = {
  note: coding('noteCategory', 'note'),
  transcript: coding('noteCategory', 'transcript'),
  familySummary: coding('noteCategory', 'familySummary'),
  familyGuidance: coding('noteCategory', 'familyGuidance'),
} as const;

/** 4M domain codings */
export const FOURM_DOMAIN = {
  whatMatters: coding('fourMDomain', 'whatMatters'),
  medication: coding('fourMDomain', 'medication'),
  mentation: coding('fourMDomain', 'mentation'),
  mobility: coding('fourMDomain', 'mobility'),
} as const;

/** Escalation Task category */
export const TASK_CATEGORY = {
  escalation: coding('taskCategory', 'escalation'),
} as const;

/** Consent provision codings — the three separate consents */
export const CONSENT_PROVISION = {
  aiCalling: coding('consentProvision', 'aiCalling'),
  recording: coding('consentProvision', 'recording'),
  familySharing: coding('consentProvision', 'familySharing'),
} as const;

/** Encounter reason coding for the 4M check-in call */
export const ENCOUNTER_REASON = {
  fourMCheckIn: coding('encounterReason', 'fourMCheckIn'),
} as const;

/** External (standard) codings */
export const EXTERNAL = {
  noteType: terminology.external.noteType as JuniperCoding,
  encounterClass: terminology.external.encounterClass as JuniperCoding,
  consentScope: terminology.external.consentScope as JuniperCoding,
} as const;

export const CONSENT_POLICY_URI: string = terminology.external.consentPolicy.uri;

export const DEVICE_IDENTIFIER = terminology.identifiers.device;
export const ORGANIZATION_IDENTIFIER = terminology.identifiers.organization;

export const DOCUMENTS = terminology.documents;

/** FHIR search token for a category, e.g. `category=https://...|juniper-note` */
export function categoryToken(c: JuniperCoding): string {
  return `${c.system}|${c.code}`;
}
