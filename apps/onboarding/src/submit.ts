/**
 * The one write path of the onboarding app, per docs/CONTRACTS.md section 3:
 *
 *   Legal name, DOB, phone      -> Patient (telecom = number to dial)
 *   Preferred name              -> Patient.name with use: nickname
 *   Language                    -> Patient.communication
 *   Family/caregiver contact    -> RelatedPerson + CareTeam.participant
 *   Three consents              -> ONE Consent, one provision per GRANTED item,
 *                                  coded with terminology consentProvision codes;
 *                                  Consent.performer records who consented
 *   Call windows, topics, proxy -> Preferences API (section 1)
 *
 * Pure resource-building functions + a submit orchestrator over a minimal
 * FHIR client interface (MedplumClient satisfies it; tests use a fake).
 * All Juniper codes come from @juniper/terminology — nothing inline.
 */
import { CONSENT_POLICY_URI, CONSENT_PROVISION, EXTERNAL } from '@juniper/terminology';
import type {
  CareTeam,
  Coding,
  Consent,
  HumanName,
  Patient,
  Reference,
  RelatedPerson,
  Resource,
} from '@medplum/fhirtypes';
import type { CallWindow, CompletedBy, PatientPreferences } from './preferences';

export interface LanguageChoice {
  /** BCP-47 code, e.g. "en", "es". */
  code: string;
  label: string;
}

export interface FamilyContact {
  name: string;
  relationship: string;
  phone: string;
}

export interface ConsentAnswers {
  aiCalling: boolean;
  recording: boolean;
  familySharing: boolean;
}

export interface OnboardingAnswers {
  completedBy: CompletedBy;
  legalName: { given: string; family: string };
  /** ISO date YYYY-MM-DD. */
  dob: string;
  phone: string;
  preferredName?: string;
  language: LanguageChoice;
  callWindows: CallWindow[];
  topicsToAvoid: string[];
  familyContact?: FamilyContact;
  consents: ConsentAnswers;
}

/** The narrow slice of MedplumClient that submit needs; fakes are trivial. */
export interface OnboardingFhirClient {
  readResource(resourceType: 'Patient', id: string): Promise<Patient>;
  createResource<T extends Resource>(resource: T): Promise<T>;
  updateResource<T extends Resource>(resource: T): Promise<T>;
  searchOne(resourceType: 'CareTeam', query: string): Promise<CareTeam | undefined>;
}

export interface PreferencesWriter {
  putPreferences(patientId: string, preferences: PatientPreferences): Promise<PatientPreferences>;
}

// ---------------------------------------------------------------------------
// Resource builders (pure)
// ---------------------------------------------------------------------------

export function buildPatientUpdate(existing: Patient, answers: OnboardingAnswers): Patient {
  const names: HumanName[] = [
    {
      use: 'official',
      family: answers.legalName.family.trim(),
      given: [answers.legalName.given.trim()],
    },
  ];
  const preferred = answers.preferredName?.trim();
  if (preferred) {
    names.push({ use: 'nickname', given: [preferred] });
  }
  return {
    ...existing,
    name: names,
    birthDate: answers.dob,
    telecom: [{ system: 'phone', value: answers.phone.trim(), use: 'home' }],
    communication: [
      {
        language: {
          coding: [{ system: 'urn:ietf:bcp:47', code: answers.language.code }],
          text: answers.language.label,
        },
        preferred: true,
      },
    ],
  };
}

export function buildFamilyRelatedPerson(
  patientRef: Reference<Patient>,
  contact: FamilyContact
): RelatedPerson {
  return {
    resourceType: 'RelatedPerson',
    patient: patientRef,
    name: [{ text: contact.name.trim() }],
    relationship: [{ text: contact.relationship.trim() }],
    telecom: [{ system: 'phone', value: contact.phone.trim() }],
  };
}

export function buildProxyRelatedPerson(
  patientRef: Reference<Patient>,
  proxy: { name: string; relationship: string }
): RelatedPerson {
  return {
    resourceType: 'RelatedPerson',
    patient: patientRef,
    name: [{ text: proxy.name.trim() }],
    relationship: [{ text: proxy.relationship.trim() }],
  };
}

/** The three consents are genuinely separate; only GRANTED items get a provision. */
export function grantedProvisionCodings(consents: ConsentAnswers): Coding[] {
  const granted: Coding[] = [];
  if (consents.aiCalling) {
    granted.push(CONSENT_PROVISION.aiCalling);
  }
  if (consents.recording) {
    granted.push(CONSENT_PROVISION.recording);
  }
  if (consents.familySharing) {
    granted.push(CONSENT_PROVISION.familySharing);
  }
  return granted;
}

export function buildConsent(
  patientRef: Reference<Patient>,
  performerRef: Reference<Patient | RelatedPerson>,
  consents: ConsentAnswers,
  now: () => Date = () => new Date()
): Consent {
  const granted = grantedProvisionCodings(consents);
  const consent: Consent = {
    resourceType: 'Consent',
    status: 'active',
    scope: { coding: [EXTERNAL.consentScope] },
    // CodeableConcept.text only: no standard code exists for this document and
    // CONTRACTS.md forbids inventing inline code strings outside terminology.
    category: [{ text: 'Juniper AI companion consent' }],
    patient: patientRef,
    dateTime: now().toISOString(),
    performer: [performerRef],
    policy: [{ uri: CONSENT_POLICY_URI }],
  };
  if (granted.length > 0) {
    consent.provision = {
      provision: granted.map((coding) => ({
        type: 'permit' as const,
        code: [{ coding: [coding] }],
      })),
    };
  }
  return consent;
}

// ---------------------------------------------------------------------------
// Submit orchestration
// ---------------------------------------------------------------------------

export interface SubmitResult {
  patient: Patient;
  familyRelatedPerson?: RelatedPerson;
  careTeam?: CareTeam;
  proxyRelatedPerson?: RelatedPerson;
  consent: Consent;
  preferences: PatientPreferences;
}

export async function submitOnboarding(
  fhir: OnboardingFhirClient,
  preferencesApi: PreferencesWriter,
  patientId: string,
  answers: OnboardingAnswers
): Promise<SubmitResult> {
  const patientRef: Reference<Patient> = { reference: `Patient/${patientId}` };

  // 1. Patient: official name, nickname, birthDate, telecom, communication.
  const existing = await fhir.readResource('Patient', patientId);
  const patient = await fhir.updateResource(buildPatientUpdate(existing, answers));

  // 2. Family/caregiver contact -> RelatedPerson + CareTeam.participant.
  let familyRelatedPerson: RelatedPerson | undefined;
  let careTeam: CareTeam | undefined;
  if (answers.familyContact) {
    familyRelatedPerson = await fhir.createResource(
      buildFamilyRelatedPerson(patientRef, answers.familyContact)
    );
    const memberRef: Reference<RelatedPerson> = {
      reference: `RelatedPerson/${familyRelatedPerson.id}`,
      display: answers.familyContact.name.trim(),
    };
    const existingTeam = await fhir.searchOne('CareTeam', `patient=Patient/${patientId}`);
    if (existingTeam) {
      const participants = existingTeam.participant ?? [];
      const alreadyMember = participants.some(
        (p) => p.member?.reference === memberRef.reference
      );
      careTeam = alreadyMember
        ? existingTeam
        : await fhir.updateResource({
            ...existingTeam,
            participant: [...participants, { member: memberRef }],
          });
    } else {
      careTeam = await fhir.createResource<CareTeam>({
        resourceType: 'CareTeam',
        status: 'active',
        name: 'Juniper care team',
        subject: patientRef,
        participant: [{ member: memberRef }],
      });
    }
  }

  // 3. Who consented. Proxy-captured consent must survive as such in the record.
  let proxyRelatedPerson: RelatedPerson | undefined;
  let performerRef: Reference<Patient | RelatedPerson>;
  if (answers.completedBy.role === 'proxy') {
    const proxy = answers.completedBy;
    const sameAsFamilyContact =
      familyRelatedPerson &&
      answers.familyContact &&
      answers.familyContact.name.trim().toLowerCase() === proxy.name.trim().toLowerCase();
    proxyRelatedPerson = sameAsFamilyContact
      ? familyRelatedPerson
      : await fhir.createResource(buildProxyRelatedPerson(patientRef, proxy));
    performerRef = {
      reference: `RelatedPerson/${proxyRelatedPerson?.id}`,
      display: proxy.name.trim(),
    };
  } else {
    performerRef = patientRef;
  }

  // 4. ONE Consent, one provision per granted item.
  const consent = await fhir.createResource(
    buildConsent(patientRef, performerRef, answers.consents)
  );

  // 5. Call windows + topics to avoid + completedBy -> Preferences API.
  const preferences = await preferencesApi.putPreferences(patientId, {
    callWindows: answers.callWindows,
    topicsToAvoid: answers.topicsToAvoid,
    completedBy: answers.completedBy,
  });

  return { patient, familyRelatedPerson, careTeam, proxyRelatedPerson, consent, preferences };
}
