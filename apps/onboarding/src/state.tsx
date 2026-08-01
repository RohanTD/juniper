/**
 * In-memory flow state: one answer object built up across the one-question-
 * per-screen flow, plus the step ordering (docs/PLAN.md apps/onboarding).
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { CallWindow, Weekday } from './preferences';
import type { ConsentAnswers, LanguageChoice, OnboardingAnswers } from './submit';

/** The flow's answer draft — everything optional until review validates it. */
export interface AnswersDraft {
  patientId?: string;
  completedBy: OnboardingAnswers['completedBy'];
  legalName?: { given: string; family: string };
  dob?: string;
  phone?: string;
  preferredName?: string;
  language?: LanguageChoice;
  callWindows: CallWindow[];
  topicsToAvoid: string[];
  familyContact?: OnboardingAnswers['familyContact'];
  consents: ConsentAnswers;
}

const initialDraft: AnswersDraft = {
  completedBy: { role: 'patient' },
  callWindows: [],
  topicsToAvoid: [],
  consents: { aiCalling: false, recording: false, familySharing: false },
};

interface OnboardingStore {
  answers: AnswersDraft;
  update: (partial: Partial<AnswersDraft>) => void;
  reset: () => void;
}

const OnboardingContext = createContext<OnboardingStore | undefined>(undefined);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [answers, setAnswers] = useState<AnswersDraft>(initialDraft);
  const update = useCallback((partial: Partial<AnswersDraft>) => {
    setAnswers((previous) => ({ ...previous, ...partial }));
  }, []);
  const reset = useCallback(() => setAnswers(initialDraft), []);
  const value = useMemo(() => ({ answers, update, reset }), [answers, update, reset]);
  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingStore {
  const store = useContext(OnboardingContext);
  if (!store) {
    throw new Error('useOnboarding must be used inside OnboardingProvider');
  }
  return store;
}

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
  '/steps/topics',
  '/steps/family-contact',
  '/steps/consent-calling',
  '/steps/consent-recording',
  '/steps/consent-sharing',
  '/steps/review',
] as const;

export type StepPath = (typeof STEP_ORDER)[number];

export function nextStepPath(current: StepPath): StepPath | undefined {
  const index = STEP_ORDER.indexOf(current);
  return index >= 0 ? STEP_ORDER[index + 1] : undefined;
}

export function stepPosition(current: StepPath): { index: number; total: number } {
  return { index: STEP_ORDER.indexOf(current) + 1, total: STEP_ORDER.length };
}

/** "your" for a patient filling it in, "their" for a proxy. */
export function subjectWord(answers: AnswersDraft): 'your' | 'their' {
  return answers.completedBy.role === 'proxy' ? 'their' : 'your';
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
    familyContact: answers.familyContact,
    consents: answers.consents,
  };
}
