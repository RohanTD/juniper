/**
 * Save-and-resume. The behaviours that matter to someone in their eighties who
 * put the phone down halfway through:
 *
 *   - answers written mid-flow come back on the next launch,
 *   - resume lands on the question they stopped at, not on question one,
 *   - a successful submit deletes the draft,
 *   - a FAILED submit does not — the Medplum writes already landed and the
 *     retry needs the answers.
 */
import {
  familyContactForSubmit,
  initialDraft,
  STEP_ORDER,
  toSubmitAnswers,
  type AnswersDraft,
  type StepPath,
} from '../src/answers';
import {
  DRAFT_TTL_MS,
  DRAFT_VERSION,
  draftKey,
  OnboardingDraftStore,
  parseStoredDraft,
  PENDING_SCOPE,
  resumeStepFor,
  type DraftStorage,
} from '../src/draft';

const NOW = Date.parse('2026-08-01T12:00:00.000Z');

function memoryStorage(): DraftStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => {
      map.set(key, value);
    },
    removeItem: async (key) => {
      map.delete(key);
    },
  };
}

/** A partly-filled draft: the shape a real interruption leaves behind. */
const partialAnswers: AnswersDraft = {
  ...initialDraft,
  completedBy: { role: 'proxy', name: 'Anne Chen', relationship: 'daughter' },
  legalName: { given: 'Margaret', family: 'Hollis' },
  dob: '1946-03-12',
  dobEntry: { month: '3', day: '12', year: '1946' },
  phone: '(555) 201-8890',
  topicsToAvoid: ['her late husband Robert'],
};

const throughPhone: StepPath[] = ['/steps/who', '/steps/name', '/steps/dob', '/steps/phone'];

describe('resumeStepFor', () => {
  it('lands on the first unanswered question, not the beginning', () => {
    expect(resumeStepFor(throughPhone)).toBe('/steps/preferred-name');
  });

  it('starts at the first question when nothing has been answered', () => {
    expect(resumeStepFor([])).toBe('/steps/who');
  });

  it('lands on review once every question has been answered', () => {
    const everything = STEP_ORDER.filter((step) => step !== '/steps/review');
    expect(resumeStepFor(everything)).toBe('/steps/review');
    expect(resumeStepFor([...STEP_ORDER])).toBe('/steps/review');
  });

  it('treats a skipped question as answered — it does not re-ask', () => {
    // "No preferred name" and "no family contact" leave the draft field empty
    // but are real answers; only the recorded step can tell them apart.
    const skipped: StepPath[] = [...throughPhone, '/steps/preferred-name'];
    expect(resumeStepFor(skipped)).toBe('/steps/language');
  });
});

describe('familyContactForSubmit', () => {
  // Persisting as you type means a half-entered contact can now exist in the
  // draft. It must not become a RelatedPerson with a blank phone number.
  const complete = { name: 'Anne Chen', relationship: 'daughter', phone: '555-777-1212' };

  it('passes a complete contact through untouched', () => {
    expect(familyContactForSubmit({ ...initialDraft, familyContact: complete })).toEqual(complete);
  });

  it('drops a contact that is still being typed', () => {
    expect(
      familyContactForSubmit({
        ...initialDraft,
        familyContact: { name: 'Ann', relationship: '', phone: '' },
      })
    ).toBeUndefined();
  });

  it('keeps a partial contact out of the submitted answers', () => {
    const submitted = toSubmitAnswers({
      ...initialDraft,
      legalName: { given: 'Margaret', family: 'Hollis' },
      dob: '1946-03-12',
      phone: '(555) 201-8890',
      language: { code: 'en', label: 'English' },
      callWindows: [
        { days: ['mon'], start: '09:00', end: '11:00', timezone: 'America/New_York' },
      ],
      familyContact: { name: 'Ann', relationship: 'daughter', phone: '' },
    });
    expect(submitted.familyContact).toBeUndefined();
  });
});

describe('restoring a draft', () => {
  it('brings back the answers and the place in the flow on the next launch', async () => {
    const storage = memoryStorage();
    const first = new OnboardingDraftStore(storage, () => NOW);
    await first.save(partialAnswers, throughPhone);

    // A fresh launch: a new store, no knowledge of who this is.
    const relaunched = new OnboardingDraftStore(storage, () => NOW);
    const draft = await relaunched.load();

    expect(draft).toBeDefined();
    expect(draft?.answers.legalName).toEqual({ given: 'Margaret', family: 'Hollis' });
    expect(draft?.answers.phone).toBe('(555) 201-8890');
    expect(draft?.answers.topicsToAvoid).toEqual(['her late husband Robert']);
    expect(draft?.answers.completedBy).toEqual({
      role: 'proxy',
      name: 'Anne Chen',
      relationship: 'daughter',
    });
    expect(resumeStepFor(draft?.completedSteps ?? [])).toBe('/steps/preferred-name');
  });

  it('restores a half-typed date of birth, which has no valid `dob` yet', async () => {
    const storage = memoryStorage();
    const store = new OnboardingDraftStore(storage, () => NOW);
    const typing: AnswersDraft = {
      ...initialDraft,
      dobEntry: { month: '', day: '', year: '1948' },
    };
    await store.save(typing, []);

    const draft = await new OnboardingDraftStore(storage, () => NOW).load();
    expect(draft?.answers.dobEntry).toEqual({ month: '', day: '', year: '1948' });
    expect(draft?.answers.dob).toBeUndefined();
  });

  it('writes nothing at all when no question has been touched', async () => {
    const storage = memoryStorage();
    const store = new OnboardingDraftStore(storage, () => NOW);
    await store.save(initialDraft, []);
    expect(storage.map.size).toBe(0);
  });

  it('discards a draft older than the retention window and deletes it', async () => {
    const storage = memoryStorage();
    await new OnboardingDraftStore(storage, () => NOW).save(partialAnswers, throughPhone);

    const later = NOW + DRAFT_TTL_MS + 1;
    const stale = new OnboardingDraftStore(storage, () => later);
    expect(await stale.load()).toBeUndefined();
    // Personal data must not linger past its expiry.
    expect(storage.map.has(draftKey(PENDING_SCOPE))).toBe(false);
  });

  it('degrades to a fresh start on a corrupt or superseded record', () => {
    expect(parseStoredDraft('not json at all', NOW)).toBeUndefined();
    expect(parseStoredDraft(null, NOW)).toBeUndefined();
    expect(
      parseStoredDraft(
        JSON.stringify({ version: DRAFT_VERSION + 1, savedAt: new Date(NOW).toISOString() }),
        NOW
      )
    ).toBeUndefined();
  });

  it('fills in fields an older record did not have, rather than yielding a broken draft', () => {
    const legacy = JSON.stringify({
      version: DRAFT_VERSION,
      scope: 'patient-1',
      savedAt: new Date(NOW).toISOString(),
      completedSteps: ['/steps/who', '/steps/nonsense'],
      answers: { completedBy: { role: 'patient' }, phone: '555' },
    });
    const draft = parseStoredDraft(legacy, NOW);
    expect(draft?.answers.callWindows).toEqual([]);
    expect(draft?.answers.topicsToAvoid).toEqual([]);
    // Unknown steps are dropped, not resumed to.
    expect(draft?.completedSteps).toEqual(['/steps/who']);
  });

  it('never throws when the device storage itself fails', async () => {
    const broken: DraftStorage = {
      getItem: async () => {
        throw new Error('keychain unavailable');
      },
      setItem: async () => {
        throw new Error('keychain unavailable');
      },
      removeItem: async () => {
        throw new Error('keychain unavailable');
      },
    };
    const store = new OnboardingDraftStore(broken, () => NOW);
    await expect(store.save(partialAnswers, throughPhone)).resolves.toBeUndefined();
    await expect(store.load()).resolves.toBeUndefined();
    await expect(store.clear()).resolves.toBeUndefined();
  });
});

describe('scoping by patient', () => {
  it('keeps two patients on one device completely apart', async () => {
    const storage = memoryStorage();
    const forA = new OnboardingDraftStore(storage, () => NOW);
    await forA.adopt('patient-a', partialAnswers, throughPhone);
    await forA.save(partialAnswers, throughPhone);

    // The clinic laptop now opens patient B's link.
    const forB = new OnboardingDraftStore(storage, () => NOW);
    await forB.load();
    const adopted = await forB.adopt('patient-b', initialDraft, []);
    expect(adopted.switched).toBe(true);
    expect(adopted.draft).toBeUndefined(); // B has no answers of their own yet

    await forB.save({ ...initialDraft, phone: '(555) 000-1111' }, ['/steps/who']);

    // A's draft is untouched under its own key.
    const backToA = new OnboardingDraftStore(storage, () => NOW);
    const draftA = await backToA.loadScope('patient-a');
    expect(draftA?.answers.phone).toBe('(555) 201-8890');
    const draftB = await backToA.loadScope('patient-b');
    expect(draftB?.answers.phone).toBe('(555) 000-1111');
  });

  it('re-keys onto the patient once the link names one, without losing answers', async () => {
    const storage = memoryStorage();
    const store = new OnboardingDraftStore(storage, () => NOW);
    await store.save(partialAnswers, throughPhone);
    expect(storage.map.has(draftKey(PENDING_SCOPE))).toBe(true);

    const adopted = await store.adopt('patient-a', partialAnswers, throughPhone);
    expect(adopted.switched).toBe(false);
    expect(storage.map.has(draftKey(PENDING_SCOPE))).toBe(false);

    const relaunched = new OnboardingDraftStore(storage, () => NOW);
    const draft = await relaunched.load();
    expect(draft?.scope).toBe('patient-a');
    expect(draft?.answers.legalName?.family).toBe('Hollis');
  });

  it('adopting the same patient twice is a no-op', async () => {
    const storage = memoryStorage();
    const store = new OnboardingDraftStore(storage, () => NOW);
    await store.adopt('patient-a', partialAnswers, throughPhone);
    await store.save(partialAnswers, throughPhone);
    const again = await store.adopt('patient-a', initialDraft, []);
    expect(again.switched).toBe(false);
    expect((await store.loadScope('patient-a'))?.answers.phone).toBe('(555) 201-8890');
  });

  it('sanitises a scope into a storage-safe key', () => {
    expect(draftKey('Patient/abc 123')).toBe('juniper.onboarding.draft.v1.Patient_abc_123');
  });
});

describe('clearing the draft around submit', () => {
  const completedFlow = STEP_ORDER.filter((step) => step !== '/steps/review');

  it('deletes the draft after a successful submit, so a later visit starts clean', async () => {
    const storage = memoryStorage();
    const store = new OnboardingDraftStore(storage, () => NOW);
    await store.adopt('patient-a', partialAnswers, completedFlow);
    await store.save(partialAnswers, completedFlow);

    const result = await store.clearAfterSubmit(async () => 'submitted');

    expect(result).toBe('submitted');
    expect(await new OnboardingDraftStore(storage, () => NOW).load()).toBeUndefined();
    expect(await store.loadScope('patient-a')).toBeUndefined();
  });

  it('refuses to resurrect the draft after a successful submit', async () => {
    const storage = memoryStorage();
    const store = new OnboardingDraftStore(storage, () => NOW);
    await store.save(partialAnswers, completedFlow);
    await store.clearAfterSubmit(async () => undefined);

    // A late render or a stray state change must not write the answers back.
    await store.save(partialAnswers, completedFlow);
    expect(storage.map.size).toBe(0);
  });

  it('KEEPS the draft when submit fails, so the retry is possible', async () => {
    const storage = memoryStorage();
    const store = new OnboardingDraftStore(storage, () => NOW);
    await store.adopt('patient-a', partialAnswers, completedFlow);
    await store.save(partialAnswers, completedFlow);

    // submitOnboarding writes Patient/RelatedPerson/CareTeam/Consent BEFORE
    // the preferences API call, so this is the realistic failure: the FHIR
    // writes landed, the last hop did not.
    const failure = new Error('PUT preferences failed: 503');
    await expect(store.clearAfterSubmit(async () => Promise.reject(failure))).rejects.toThrow(
      '503'
    );

    const draft = await new OnboardingDraftStore(storage, () => NOW).load();
    expect(draft).toBeDefined();
    expect(draft?.answers.legalName).toEqual({ given: 'Margaret', family: 'Hollis' });
    expect(draft?.answers.topicsToAvoid).toEqual(['her late husband Robert']);
    // And it still points at review, so "Finish setup" is one tap away.
    expect(resumeStepFor(draft?.completedSteps ?? [])).toBe('/steps/review');
  });

  it('a failed submit followed by a successful retry ends with no draft', async () => {
    const storage = memoryStorage();
    const store = new OnboardingDraftStore(storage, () => NOW);
    await store.save(partialAnswers, completedFlow);

    await expect(
      store.clearAfterSubmit(async () => Promise.reject(new Error('network')))
    ).rejects.toThrow('network');
    await store.clearAfterSubmit(async () => 'ok');

    expect(await new OnboardingDraftStore(storage, () => NOW).load()).toBeUndefined();
  });

  it('"start over" clears the draft but keeps saving afterwards', async () => {
    const storage = memoryStorage();
    const store = new OnboardingDraftStore(storage, () => NOW);
    await store.save(partialAnswers, throughPhone);

    await store.clear();
    expect(await new OnboardingDraftStore(storage, () => NOW).load()).toBeUndefined();

    await store.save({ ...initialDraft, phone: '(555) 999-0000' }, ['/steps/who']);
    const draft = await new OnboardingDraftStore(storage, () => NOW).load();
    expect(draft?.answers.phone).toBe('(555) 999-0000');
  });
});
