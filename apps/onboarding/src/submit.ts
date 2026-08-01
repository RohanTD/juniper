/**
 * The one write path of the onboarding app, per docs/CONTRACTS.md section 3:
 *
 *   Legal name, DOB, phone,     -> Preferences API `enrollment` (section 1).
 *   preferred name, language       NOT the FHIR Patient. See below.
 *   Family/caregiver contact    -> RelatedPerson + CareTeam.participant
 *   Three consents              -> ONE Consent, one provision per GRANTED item,
 *                                  coded with terminology consentProvision codes;
 *                                  Consent.performer records who consented
 *   Call windows, topics, proxy -> Preferences API (section 1)
 *
 * ## Why onboarding does not write demographics
 *
 * It used to update `Patient` — name, birthDate, telecom, communication — and
 * that was wrong. The chart belongs to the clinic that keeps it. An app on a
 * phone, filled in by someone in their eighties or by whichever relative is
 * sitting with them, is not an authority to overwrite a legal name, a date of
 * birth, or the number a practice has on file; the most likely outcome of a
 * typo is a demographic correction nobody clinical ever asked for and nobody
 * notices. Juniper needs these facts operationally — a number to dial, a name
 * to greet with — so it keeps its own copy and reconciles at call time,
 * preferring what the patient told us for operational fields and *reporting*
 * any disagreement with the chart rather than silently resolving it.
 *
 * RelatedPerson, CareTeam and Consent are still written, and deliberately so:
 * they are not the clinic's demographics but new, Juniper-scoped facts —
 * who the patient named as family (which is what caregiver access derives
 * from) and what they authorized.
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
  Patient,
  Reference,
  RelatedPerson,
  Resource,
} from '@medplum/fhirtypes';
import type {
  CallWindow,
  CompletedBy,
  EnrollmentProfile,
  PatientPreferences,
} from './preferences';

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
  interests: string[];
  familyContact?: FamilyContact;
  consents: ConsentAnswers;
}

/** The narrow slice of MedplumClient that submit needs; fakes are trivial. */
export interface OnboardingFhirClient {
  createResource<T extends Resource>(resource: T): Promise<T>;
  /** Only ever an existing CareTeam gaining a participant. Never a Patient. */
  updateResource<T extends Resource>(resource: T): Promise<T>;
  searchOne(resourceType: 'CareTeam', query: string): Promise<CareTeam | undefined>;
}

export interface PreferencesWriter {
  putPreferences(patientId: string, preferences: PatientPreferences): Promise<PatientPreferences>;
}

// ---------------------------------------------------------------------------
// Resource builders (pure)
// ---------------------------------------------------------------------------

/**
 * The demographics, shaped for Juniper's own store instead of for `Patient`.
 *
 * Every field here was previously written to the chart. Keeping the same set
 * is deliberate — the voice service needs all of it (a number to dial, a name
 * to greet with, a language to speak, and legal name / birth date to fall back
 * on when the chart is a stub an admin created and never filled in).
 */
export function buildEnrollmentProfile(answers: OnboardingAnswers): EnrollmentProfile {
  const profile: EnrollmentProfile = {
    legalName: {
      given: answers.legalName.given.trim(),
      family: answers.legalName.family.trim(),
    },
    birthDate: answers.dob,
    phone: answers.phone.trim(),
    language: { code: answers.language.code, label: answers.language.label },
  };
  const preferred = answers.preferredName?.trim();
  if (preferred) {
    profile.preferredName = preferred;
  }
  return profile;
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

  // 1. Family/caregiver contact -> RelatedPerson + CareTeam.participant.
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

  // 2. Who consented. Proxy-captured consent must survive as such in the record.
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

  // 3. ONE Consent, one provision per granted item.
  const consent = await fhir.createResource(
    buildConsent(patientRef, performerRef, answers.consents)
  );

  // 4. Everything else -> Preferences API: call windows, topics to avoid,
  //    who completed the form, and the demographics that used to go to the
  //    chart. Last, because it is the only step that is safely repeatable —
  //    a whole-object PUT — so a retry after a partial failure converges.
  const preferences = await preferencesApi.putPreferences(patientId, {
    callWindows: answers.callWindows,
    topicsToAvoid: answers.topicsToAvoid,
    interests: answers.interests,
    completedBy: answers.completedBy,
    enrollment: buildEnrollmentProfile(answers),
  });

  return { familyRelatedPerson, careTeam, proxyRelatedPerson, consent, preferences };
}
