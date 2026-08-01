/**
 * The FHIR write path, tested against docs/CONTRACTS.md section 3 with a fake
 * client. All codes must come from @juniper/terminology.
 */
import { CONSENT_POLICY_URI, CONSENT_PROVISION, EXTERNAL } from '@juniper/terminology';
import type { CareTeam, Patient, Resource } from '@medplum/fhirtypes';
import type { PatientPreferences } from '../src/preferences';
import {
  buildConsent,
  buildPatientUpdate,
  submitOnboarding,
  type OnboardingAnswers,
  type OnboardingFhirClient,
} from '../src/submit';

const baseAnswers: OnboardingAnswers = {
  completedBy: { role: 'patient' },
  legalName: { given: 'Margaret', family: 'Hollis' },
  dob: '1946-03-12',
  phone: '(555) 201-8890',
  preferredName: 'Peggy',
  language: { code: 'en', label: 'English' },
  callWindows: [
    { days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '11:00', timezone: 'America/New_York' },
  ],
  topicsToAvoid: ['her late husband Robert'],
  familyContact: { name: 'Anne Chen', relationship: 'daughter', phone: '555-777-1212' },
  consents: { aiCalling: true, recording: true, familySharing: false },
};

function makeFakeFhir(existingCareTeam?: CareTeam) {
  let nextId = 1;
  const created: Resource[] = [];
  const updated: Resource[] = [];
  const fhir: OnboardingFhirClient = {
    readResource: async (_type, id) => ({ resourceType: 'Patient', id }) as Patient,
    createResource: async <T extends Resource>(resource: T) => {
      const withId = { ...resource, id: `${resource.resourceType.toLowerCase()}-${nextId++}` } as T;
      created.push(withId);
      return withId;
    },
    updateResource: async <T extends Resource>(resource: T) => {
      updated.push(resource);
      return resource;
    },
    searchOne: async () => existingCareTeam,
  };
  return { fhir, created, updated };
}

function makeFakePrefs() {
  const calls: Array<{ patientId: string; preferences: PatientPreferences }> = [];
  return {
    calls,
    putPreferences: async (patientId: string, preferences: PatientPreferences) => {
      calls.push({ patientId, preferences });
      return preferences;
    },
  };
}

describe('buildPatientUpdate', () => {
  it('writes official name, nickname, birthDate, telecom and communication', () => {
    const patient = buildPatientUpdate({ resourceType: 'Patient', id: 'p1' }, baseAnswers);
    expect(patient.name).toEqual([
      { use: 'official', family: 'Hollis', given: ['Margaret'] },
      { use: 'nickname', given: ['Peggy'] },
    ]);
    expect(patient.birthDate).toBe('1946-03-12');
    expect(patient.telecom?.[0]).toMatchObject({ system: 'phone', value: '(555) 201-8890' });
    expect(patient.communication?.[0].language.coding?.[0]).toEqual({
      system: 'urn:ietf:bcp:47',
      code: 'en',
    });
    expect(patient.communication?.[0].preferred).toBe(true);
  });

  it('omits the nickname entry when no preferred name is given', () => {
    const patient = buildPatientUpdate(
      { resourceType: 'Patient', id: 'p1' },
      { ...baseAnswers, preferredName: undefined }
    );
    expect(patient.name).toHaveLength(1);
    expect(patient.name?.[0].use).toBe('official');
  });
});

describe('buildConsent', () => {
  it('creates ONE Consent with a provision per GRANTED item, using terminology codes', () => {
    const consent = buildConsent(
      { reference: 'Patient/p1' },
      { reference: 'Patient/p1' },
      { aiCalling: true, recording: true, familySharing: false }
    );
    expect(consent.status).toBe('active');
    expect(consent.scope.coding?.[0]).toEqual(EXTERNAL.consentScope);
    expect(consent.policy?.[0].uri).toBe(CONSENT_POLICY_URI);
    const provisions = consent.provision?.provision ?? [];
    expect(provisions).toHaveLength(2);
    const codes = provisions.map((p) => p.code?.[0].coding?.[0].code);
    expect(codes).toContain(CONSENT_PROVISION.aiCalling.code);
    expect(codes).toContain(CONSENT_PROVISION.recording.code);
    expect(codes).not.toContain(CONSENT_PROVISION.familySharing.code);
    for (const p of provisions) {
      expect(p.type).toBe('permit');
      expect(p.code?.[0].coding?.[0].system).toBe(CONSENT_PROVISION.aiCalling.system);
    }
  });

  it('omits provisions entirely when everything is declined', () => {
    const consent = buildConsent(
      { reference: 'Patient/p1' },
      { reference: 'Patient/p1' },
      { aiCalling: false, recording: false, familySharing: false }
    );
    expect(consent.provision).toBeUndefined();
  });
});

describe('submitOnboarding', () => {
  it('writes Patient, RelatedPerson + CareTeam, Consent, and preferences (patient-completed)', async () => {
    const { fhir, created, updated } = makeFakeFhir();
    const prefs = makeFakePrefs();

    const result = await submitOnboarding(fhir, prefs, 'p1', baseAnswers);

    // Patient updated in place.
    expect(updated.some((r) => r.resourceType === 'Patient')).toBe(true);
    // Family RelatedPerson created and placed on a new CareTeam.
    expect(result.familyRelatedPerson?.relationship?.[0].text).toBe('daughter');
    const team = created.find((r) => r.resourceType === 'CareTeam') as CareTeam;
    expect(team.subject?.reference).toBe('Patient/p1');
    expect(team.participant?.[0].member?.reference).toBe(
      `RelatedPerson/${result.familyRelatedPerson?.id}`
    );
    // Consent performer is the patient (first-party claim).
    expect(result.consent.performer?.[0].reference).toBe('Patient/p1');
    // Preferences hit the API with call windows, topics, completedBy.
    expect(prefs.calls).toHaveLength(1);
    expect(prefs.calls[0].patientId).toBe('p1');
    expect(prefs.calls[0].preferences.completedBy).toEqual({ role: 'patient' });
    expect(prefs.calls[0].preferences.topicsToAvoid).toEqual(['her late husband Robert']);
  });

  it('records proxy provenance: performer is a RelatedPerson, and completedBy mirrors it', async () => {
    const { fhir } = makeFakeFhir();
    const prefs = makeFakePrefs();
    const proxyAnswers: OnboardingAnswers = {
      ...baseAnswers,
      completedBy: { role: 'proxy', name: 'Sam Ortiz', relationship: 'son' },
    };

    const result = await submitOnboarding(fhir, prefs, 'p1', proxyAnswers);

    expect(result.proxyRelatedPerson).toBeDefined();
    expect(result.consent.performer?.[0].reference).toBe(
      `RelatedPerson/${result.proxyRelatedPerson?.id}`
    );
    // Proxy differs from the family contact, so two RelatedPersons exist.
    expect(result.proxyRelatedPerson?.id).not.toBe(result.familyRelatedPerson?.id);
    expect(prefs.calls[0].preferences.completedBy).toEqual({
      role: 'proxy',
      name: 'Sam Ortiz',
      relationship: 'son',
    });
  });

  it('reuses the family contact RelatedPerson when the proxy is the same person', async () => {
    const { fhir } = makeFakeFhir();
    const prefs = makeFakePrefs();
    const proxyAnswers: OnboardingAnswers = {
      ...baseAnswers,
      completedBy: { role: 'proxy', name: 'anne chen', relationship: 'daughter' },
    };

    const result = await submitOnboarding(fhir, prefs, 'p1', proxyAnswers);

    expect(result.proxyRelatedPerson?.id).toBe(result.familyRelatedPerson?.id);
  });

  it('appends to an existing CareTeam instead of creating a second one', async () => {
    const existingTeam: CareTeam = {
      resourceType: 'CareTeam',
      id: 'team-1',
      status: 'active',
      subject: { reference: 'Patient/p1' },
      participant: [{ member: { reference: 'Practitioner/dr-chen' } }],
    };
    const { fhir, created, updated } = makeFakeFhir(existingTeam);
    const prefs = makeFakePrefs();

    await submitOnboarding(fhir, prefs, 'p1', baseAnswers);

    expect(created.some((r) => r.resourceType === 'CareTeam')).toBe(false);
    const updatedTeam = updated.find((r) => r.resourceType === 'CareTeam') as CareTeam;
    expect(updatedTeam.participant).toHaveLength(2);
    expect(updatedTeam.participant?.[0].member?.reference).toBe('Practitioner/dr-chen');
  });

  it('skips RelatedPerson and CareTeam when no family contact was given', async () => {
    const { fhir, created } = makeFakeFhir();
    const prefs = makeFakePrefs();

    const result = await submitOnboarding(fhir, prefs, 'p1', {
      ...baseAnswers,
      familyContact: undefined,
    });

    expect(result.familyRelatedPerson).toBeUndefined();
    expect(created.some((r) => r.resourceType === 'CareTeam')).toBe(false);
    expect(created.some((r) => r.resourceType === 'RelatedPerson')).toBe(false);
  });
});
