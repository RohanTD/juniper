/**
 * Save-and-resume for the onboarding flow.
 *
 * Why this exists: the app is opened once, by someone in their seventies or
 * eighties, often passing the phone back and forth with a family member. A
 * call arriving, a tab reload or a backgrounded app used to mean every answer
 * was gone and they started at question one. That is the single largest
 * completion risk in the funnel.
 *
 * Three properties this module has to guarantee:
 *
 *  1. **Draft survives a failed submit.** `submitOnboarding` writes
 *     Patient/RelatedPerson/CareTeam/Consent to Medplum BEFORE the preferences
 *     API call, so a late failure leaves those writes already done. Retrying is
 *     the correct action (they are update-or-create keyed on the patient), and
 *     retrying is only possible if the answers are still here. So the draft is
 *     cleared strictly *after* a submit resolves — never before, never in a
 *     `finally`.
 *  2. **One patient's link never shows another patient's answers.** Drafts are
 *     keyed by patient id. A clinic laptop used for two enrolments keeps two
 *     independent drafts.
 *  3. **Personal data does not linger.** A draft holds a legal name, date of
 *     birth, phone number and topics to avoid. It is deleted on successful
 *     submit, and expires on its own after DRAFT_TTL_MS so an abandoned
 *     enrolment does not sit on a shared device indefinitely.
 *
 * Deliberately React-free and platform-free — `DraftStorage` is injected, so
 * this is testable in a plain node environment and the SecureStore / localStorage
 * choice lives in `src/draftStorage.ts`.
 */
import {
  hasAnyAnswer,
  initialDraft,
  isStepPath,
  STEP_ORDER,
  type AnswersDraft,
  type StepPath,
} from './answers';

/** Bumped when the stored shape changes; older records are discarded, not migrated. */
export const DRAFT_VERSION = 1;

/**
 * How long an unfinished draft stays readable. Long enough to cover "I'll
 * finish this when my daughter visits at the weekend", short enough that an
 * abandoned enrolment's personal data does not sit on a device forever.
 */
export const DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Scope used before the magic link / signed-in profile names the patient. */
export const PENDING_SCOPE = 'pending';

const KEY_PREFIX = 'juniper.onboarding.draft.v1.';
/**
 * Which scope was written most recently. SecureStore cannot enumerate keys, and
 * a mid-flow reload (expo-router restores `/steps/topics` directly) never runs
 * the welcome screen that knows the patient id — so restore has to work with no
 * knowledge at all. This pointer is how.
 */
const POINTER_KEY = `${KEY_PREFIX}__scope__`;

export interface DraftStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface StoredDraft {
  version: number;
  /** Patient id, or PENDING_SCOPE when the link did not name one. */
  scope: string;
  savedAt: string;
  completedSteps: StepPath[];
  answers: AnswersDraft;
}

/** SecureStore keys must match [A-Za-z0-9._-]; a FHIR id can contain neither more nor less. */
export function draftKey(scope: string): string {
  return KEY_PREFIX + (scope || PENDING_SCOPE).replace(/[^A-Za-z0-9._-]/g, '_');
}

/**
 * Where resume should land: the first question that has not been answered yet.
 *
 * Answered, not "has a value" — "no preferred name", "no family contact" and a
 * declined consent are all real answers that leave the draft field empty, and
 * sending someone back to a question they already declined reads as if nothing
 * was saved. Recording the step explicitly is the only way to tell the two
 * apart.
 */
export function resumeStepFor(completedSteps: readonly StepPath[]): StepPath {
  for (const step of STEP_ORDER) {
    if (!completedSteps.includes(step)) {
      return step;
    }
  }
  return '/steps/review';
}

function sanitizeCompletedSteps(value: unknown): StepPath[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<StepPath>();
  for (const entry of value) {
    if (isStepPath(entry)) {
      seen.add(entry);
    }
  }
  // Canonical flow order, so resume is stable no matter how it was written.
  return STEP_ORDER.filter((step) => seen.has(step));
}

/**
 * Parse a stored record, rejecting anything we should not resume from: a
 * corrupt value, an older schema, or a draft past its expiry. Never throws —
 * a broken draft degrades to "start fresh", never to a crash on launch.
 */
export function parseStoredDraft(raw: string | null, now: number): StoredDraft | undefined {
  if (!raw) {
    return undefined;
  }
  let parsed: Partial<StoredDraft>;
  try {
    parsed = JSON.parse(raw) as Partial<StoredDraft>;
  } catch {
    return undefined;
  }
  if (!parsed || parsed.version !== DRAFT_VERSION || typeof parsed.savedAt !== 'string') {
    return undefined;
  }
  const savedAt = Date.parse(parsed.savedAt);
  if (Number.isNaN(savedAt) || now - savedAt > DRAFT_TTL_MS) {
    return undefined;
  }
  if (!parsed.answers || typeof parsed.answers !== 'object') {
    return undefined;
  }
  return {
    version: DRAFT_VERSION,
    scope: typeof parsed.scope === 'string' && parsed.scope ? parsed.scope : PENDING_SCOPE,
    savedAt: parsed.savedAt,
    completedSteps: sanitizeCompletedSteps(parsed.completedSteps),
    // Merge over the initial draft so a record written by an older build that
    // lacked a field still yields a well-formed draft (arrays present, etc.).
    answers: { ...initialDraft, ...parsed.answers },
  };
}

export interface AdoptResult {
  /**
   * The draft to switch to, when adopting a scope means abandoning what is in
   * memory (a different patient's link). Undefined means "keep what you have".
   */
  draft?: StoredDraft;
  /** True when the caller must replace its in-memory answers with `draft`. */
  switched: boolean;
}

/**
 * Reads and writes the draft, and owns the scope. One instance per app launch.
 *
 * Every storage call is failure-tolerant: a device that refuses the keychain
 * gets an app that simply does not resume, not an app that will not start.
 */
export class OnboardingDraftStore {
  private scope: string = PENDING_SCOPE;
  /** Set once the flow has been submitted; blocks any resurrection of the draft. */
  private finished = false;

  constructor(
    private readonly storage: DraftStorage,
    private readonly now: () => number = Date.now
  ) {}

  currentScope(): string {
    return this.scope;
  }

  private async read(key: string): Promise<string | null> {
    try {
      return await this.storage.getItem(key);
    } catch {
      return null;
    }
  }

  private async write(key: string, value: string): Promise<void> {
    try {
      await this.storage.setItem(key, value);
    } catch {
      // A draft we could not save is a worse experience, never a broken one.
    }
  }

  private async remove(key: string): Promise<void> {
    try {
      await this.storage.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  /** Read a specific patient's draft, discarding it if it is expired or unreadable. */
  async loadScope(scope: string): Promise<StoredDraft | undefined> {
    const key = draftKey(scope);
    const raw = await this.read(key);
    const draft = parseStoredDraft(raw, this.now());
    if (raw && !draft) {
      // Expired or unusable: delete it rather than leaving personal data behind.
      await this.remove(key);
    }
    return draft;
  }

  /**
   * Restore on launch with no knowledge of who this is — follows the pointer
   * written by the last save. Sets the store's scope to whatever it finds.
   */
  async load(): Promise<StoredDraft | undefined> {
    const scope = (await this.read(POINTER_KEY)) ?? PENDING_SCOPE;
    const draft = await this.loadScope(scope);
    this.scope = draft?.scope ?? scope;
    return draft;
  }

  /**
   * Attach the draft to a patient, once the magic link or the signed-in profile
   * names one.
   *
   * - Same patient: nothing to do.
   * - Not yet scoped: re-key what is already in memory onto this patient.
   * - A different patient: this is someone else's link. Their draft (if any)
   *   loads; the first patient's stays under its own key, untouched.
   */
  async adopt(
    patientId: string,
    answers: AnswersDraft,
    completedSteps: readonly StepPath[]
  ): Promise<AdoptResult> {
    const scope = patientId || PENDING_SCOPE;
    if (scope === this.scope) {
      return { switched: false };
    }
    if (this.scope === PENDING_SCOPE) {
      const previousKey = draftKey(PENDING_SCOPE);
      this.scope = scope;
      await this.save(answers, completedSteps);
      await this.write(POINTER_KEY, scope);
      await this.remove(previousKey);
      return { switched: false };
    }
    this.scope = scope;
    const draft = await this.loadScope(scope);
    await this.write(POINTER_KEY, scope);
    return { draft, switched: true };
  }

  /** Persist the current answers. No-op once the flow has been submitted. */
  async save(answers: AnswersDraft, completedSteps: readonly StepPath[]): Promise<void> {
    if (this.finished) {
      return;
    }
    if (completedSteps.length === 0 && !hasAnyAnswer(answers)) {
      return;
    }
    const record: StoredDraft = {
      version: DRAFT_VERSION,
      scope: this.scope,
      savedAt: new Date(this.now()).toISOString(),
      completedSteps: [...completedSteps],
      answers,
    };
    await this.write(draftKey(this.scope), JSON.stringify(record));
    await this.write(POINTER_KEY, this.scope);
  }

  /** Delete the draft but stay live — "start over" is still an onboarding session. */
  async clear(): Promise<void> {
    await this.remove(draftKey(this.scope));
    await this.remove(POINTER_KEY);
  }

  /** Delete the draft and refuse all further writes. Setup is over. */
  async finish(): Promise<void> {
    this.finished = true;
    await this.clear();
  }

  /**
   * Run the submit, then clear the draft — and only then.
   *
   * If `submit` rejects, the draft is left exactly as it was: the Medplum
   * writes that already landed are update-or-create keyed on the patient, so
   * pressing "Finish setup" again is safe, and it is only possible while the
   * answers still exist.
   */
  async clearAfterSubmit<T>(submit: () => Promise<T>): Promise<T> {
    const result = await submit();
    await this.finish();
    return result;
  }
}
