/**
 * The onboarding answer draft, the step ordering, and the choice lists.
 *
 * Deliberately React-free and platform-free: the persistence layer
 * (`src/draft.ts`) and its tests need this shape without a renderer or a native
 * module. `src/state.tsx` re-exports everything here, so screens keep importing
 * from '../../src/state'.
 */
import type { CallWindow, Weekday } from './preferences';
import type { ConsentAnswers, LanguageChoice, OnboardingAnswers } from './submit';

/** The flow's answer draft — everything optional until review validates it. */
export interface AnswersDraft {
  patientId?: string;
  completedBy: OnboardingAnswers['completedBy'];
  legalName?: { given: string; family: string };
  dob?: string;
  /**
   * The three date boxes exactly as typed. `dob` only exists once they parse
   * into a real date, so without this a half-entered birth date ("1948" in the
   * year box, nothing else yet) could not survive a reload — and re-typing a
   * birth date is precisely the friction this app cannot afford.
   */
  dobEntry?: { month: string; day: string; year: string };
  phone?: string;
  preferredName?: string;
  language?: LanguageChoice;
  callWindows: CallWindow[];
  topicsToAvoid: string[];
  /**
   * What the patient enjoys — gardening, grandchildren, the Sunday crossword.
   *
   * The counterpart to `topicsToAvoid`, and the only answer in the flow that
   * is not logistics or permission. It gives the Companion something real to
   * open with, gives the What Matters domain a starting point instead of a
   * cold open, and gives family guidance something specific to suggest.
   */
  interests: string[];
  familyContact?: OnboardingAnswers['familyContact'];
  consents: ConsentAnswers;
}

export const initialDraft: AnswersDraft = {
  completedBy: { role: 'patient' },
  callWindows: [],
  topicsToAvoid: [],
  interests: [],
  consents: { aiCalling: false, recording: false, familySharing: false },
};

// ---------------------------------------------------------------------------
// Step ordering — the mandated question order, one screen each.
// ---------------------------------------------------------------------------

export const STEP_ORDER = [
  '/steps/who',
  '/steps/name',
  '/steps/dob',
  '/steps/phone',
  '/steps/preferred-name',
  '/steps/language',
  '/steps/call-times',
  // Interests before topics-to-avoid: naming what you love is a warmer thing
  // to be asked than naming what hurts, and it makes the harder question read
  // as the natural other half rather than as an interrogation.
  '/steps/interests',
  '/steps/topics',
  '/steps/family-contact',
  '/steps/consent-calling',
  '/steps/consent-recording',
  '/steps/consent-sharing',
  '/steps/review',
] as const;

export type StepPath = (typeof STEP_ORDER)[number];

export function isStepPath(value: unknown): value is StepPath {
  return typeof value === 'string' && (STEP_ORDER as readonly string[]).includes(value);
}

export function nextStepPath(current: StepPath): StepPath | undefined {
  const index = STEP_ORDER.indexOf(current);
  return index >= 0 ? STEP_ORDER[index + 1] : undefined;
}

export function stepPosition(current: StepPath): { index: number; total: number } {
  return { index: STEP_ORDER.indexOf(current) + 1, total: STEP_ORDER.length };
}

/** 0..1, for the progress bar. */
export function stepFraction(current: StepPath): number {
  const { index, total } = stepPosition(current);
  return Math.max(0, Math.min(1, index / total));
}

/**
 * Who the form is talking to, and therefore how it must refer to the patient.
 *
 * Two people fill this in and the copy has to hold up for both: the patient
 * ("what is **your** date of birth?") and a proxy ("what is **their** date of
 * birth?"). Getting it wrong is not cosmetic — asking an eighty-year-old about
 * "the patient" reads as if the form has forgotten who it is speaking to, and
 * telling a daughter "it calls at the times **you** chose" about her mother is
 * plainly incorrect.
 *
 * This used to be a single `subjectWord` returning 'your' | 'their', which
 * covered possessives and nothing else — so screens needing a subject or an
 * object pronoun open-coded `you === 'their' ? 'them' : 'you'` at the call
 * site, and the consent screens, which needed whole sentences, simply
 * hardcoded second person and were wrong for every proxy.
 *
 * A note on `they`: singular *they* takes plural agreement, exactly like
 * *you* — "you answer" / "they answer". So no screen needs verb-form
 * branching, which is why there is none here.
 */
export interface Voice {
  /** "you" / "they" — sentence subject. */
  subject: string;
  /** "you" / "them" — sentence object. */
  object: string;
  /** "your" / "their" — possessive determiner. */
  possessive: string;
  /** "yours" / "theirs". */
  possessivePronoun: string;
  /** "yourself" / "themselves". */
  reflexive: string;
  /** True when the patient is filling the form in about themselves. */
  isPatient: boolean;
  /**
   * A noun for the patient, when a pronoun would be ambiguous —
   * "you" / "the person you're helping". Use sparingly; a pronoun is warmer.
   */
  noun: string;
  /** Capitalise the first letter, for sentence-initial use. */
  cap: (word: string) => string;
}

const PATIENT_VOICE: Voice = {
  subject: 'you',
  object: 'you',
  possessive: 'your',
  possessivePronoun: 'yours',
  reflexive: 'yourself',
  isPatient: true,
  noun: 'you',
  cap,
};

const PROXY_VOICE: Voice = {
  subject: 'they',
  object: 'them',
  possessive: 'their',
  possessivePronoun: 'theirs',
  reflexive: 'themselves',
  isPatient: false,
  noun: "the person you're helping",
  cap,
};

function cap(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function voiceFor(answers: AnswersDraft): Voice {
  return answers.completedBy.role === 'proxy' ? PROXY_VOICE : PATIENT_VOICE;
}

/** @deprecated Use {@link voiceFor}; kept so existing call sites keep working. */
export function subjectWord(answers: AnswersDraft): 'your' | 'their' {
  return voiceFor(answers).possessive as 'your' | 'their';
}

// ---------------------------------------------------------------------------
// Choice lists
// ---------------------------------------------------------------------------

export const LANGUAGES: LanguageChoice[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'zh', label: 'Chinese' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'tl', label: 'Tagalog' },
  { code: 'ko', label: 'Korean' },
  { code: 'ru', label: 'Russian' },
  { code: 'ar', label: 'Arabic' },
];

const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
const WEEKEND: Weekday[] = ['sat', 'sun'];

export interface CallWindowChoice {
  id: string;
  title: string;
  subtitle: string;
  days: Weekday[];
  start: string;
  end: string;
}

/** Friendly picks instead of time pickers; timezone is attached at selection. */
export const CALL_WINDOW_CHOICES: CallWindowChoice[] = [
  { id: 'weekday-morning', title: 'Weekday mornings', subtitle: '9:00 to 11:00, Monday through Friday', days: WEEKDAYS, start: '09:00', end: '11:00' },
  { id: 'weekday-afternoon', title: 'Weekday afternoons', subtitle: '1:00 to 3:00, Monday through Friday', days: WEEKDAYS, start: '13:00', end: '15:00' },
  { id: 'weekday-evening', title: 'Weekday evenings', subtitle: '5:00 to 7:00, Monday through Friday', days: WEEKDAYS, start: '17:00', end: '19:00' },
  { id: 'weekend-morning', title: 'Weekend mornings', subtitle: '9:00 to 11:00, Saturday and Sunday', days: WEEKEND, start: '09:00', end: '11:00' },
];

export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'America/New_York';
  } catch {
    return 'America/New_York';
  }
}

export function toCallWindow(choice: CallWindowChoice, timezone: string): CallWindow {
  return { days: choice.days, start: choice.start, end: choice.end, timezone };
}

/** Which of the friendly picks a restored draft corresponds to. */
export function selectedCallWindowIds(answers: AnswersDraft): string[] {
  return CALL_WINDOW_CHOICES.filter((choice) =>
    answers.callWindows.some((w) => w.start === choice.start && w.days[0] === choice.days[0])
  ).map((choice) => choice.id);
}

/** Validate the draft is complete enough to submit; returns missing-field labels. */
export function missingAnswers(answers: AnswersDraft): string[] {
  const missing: string[] = [];
  if (!answers.legalName?.given.trim() || !answers.legalName?.family.trim()) {
    missing.push('Legal name');
  }
  if (!answers.dob) {
    missing.push('Date of birth');
  }
  if (!answers.phone?.trim()) {
    missing.push('Phone number');
  }
  if (!answers.language) {
    missing.push('Language');
  }
  if (answers.callWindows.length === 0) {
    missing.push('Best call times');
  }
  return missing;
}

/**
 * The family contact only if it is complete.
 *
 * The draft persists a contact as it is typed, so a half-entered one can exist
 * mid-flow. It must never reach `submit.ts`, which would turn it into a
 * `RelatedPerson` with a blank phone number and put it on the CareTeam. This
 * changes nothing about a completed contact — it only refuses to write a
 * partial one, a state that was unreachable before drafts were persisted.
 */
export function familyContactForSubmit(
  answers: AnswersDraft
): OnboardingAnswers['familyContact'] {
  const contact = answers.familyContact;
  if (!contact) {
    return undefined;
  }
  const complete =
    contact.name.trim() !== '' &&
    contact.relationship.trim() !== '' &&
    contact.phone.trim() !== '';
  return complete ? contact : undefined;
}

/**
 * Is there anything worth writing to disk yet?
 *
 * Guards against creating a stored draft — which carries personal data — for
 * someone who opened the link and typed nothing.
 */
export function hasAnyAnswer(answers: AnswersDraft): boolean {
  const filled = (value?: string) => typeof value === 'string' && value.trim() !== '';
  const entry = answers.dobEntry;
  return (
    answers.completedBy.role === 'proxy' ||
    filled(answers.legalName?.given) ||
    filled(answers.legalName?.family) ||
    filled(answers.dob) ||
    filled(entry?.month) ||
    filled(entry?.day) ||
    filled(entry?.year) ||
    filled(answers.phone) ||
    filled(answers.preferredName) ||
    answers.language !== undefined ||
    answers.callWindows.length > 0 ||
    answers.topicsToAvoid.length > 0 ||
    answers.familyContact !== undefined ||
    answers.consents.aiCalling ||
    answers.consents.recording ||
    answers.consents.familySharing
  );
}

/** Narrow a validated draft into the strict submit shape. */
export function toSubmitAnswers(answers: AnswersDraft): OnboardingAnswers {
  if (missingAnswers(answers).length > 0) {
    throw new Error('Draft is incomplete');
  }
  return {
    completedBy: answers.completedBy,
    legalName: answers.legalName as { given: string; family: string },
    dob: answers.dob as string,
    phone: answers.phone as string,
    preferredName: answers.preferredName,
    language: answers.language as LanguageChoice,
    callWindows: answers.callWindows,
    topicsToAvoid: answers.topicsToAvoid,
    interests: answers.interests,
    familyContact: familyContactForSubmit(answers),
    consents: answers.consents,
  };
}
