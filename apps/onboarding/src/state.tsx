/**
 * Flow state: one answer object built up across the one-question-per-screen
 * flow (docs/PLAN.md apps/onboarding), persisted to the device as it is entered
 * and restored automatically on launch.
 *
 * The shape, the step order and the choice lists live in `./answers` (pure);
 * the persistence rules live in `./draft` (pure); the platform storage choice
 * lives in `./draftStorage`. This file is only the React wiring — and it
 * re-exports the pure modules so screens keep importing from '../../src/state'.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { hasAnyAnswer, initialDraft, type AnswersDraft, type StepPath } from './answers';
import { OnboardingDraftStore, resumeStepFor, type DraftStorage } from './draft';
import { draftStorage } from './draftStorage';

export * from './answers';
export { DRAFT_TTL_MS, resumeStepFor, type StoredDraft } from './draft';

/**
 * Keystrokes are persisted, so collapse a burst of them into one write. Short
 * enough that a call arriving mid-sentence loses at most the last word; long
 * enough that typing a name is one keychain write rather than eight.
 */
const SAVE_DEBOUNCE_MS = 250;

interface OnboardingStore {
  answers: AnswersDraft;
  /** Merge an answer. Called as fields change, not only on Continue. */
  update: (partial: Partial<AnswersDraft>) => void;
  /**
   * Merge an answer and record the question as answered. This is what resume
   * reads: it distinguishes "declined the family contact" from "never got
   * there", which no amount of inspecting the answers can.
   */
  completeStep: (step: StepPath, partial?: Partial<AnswersDraft>) => void;
  /** Where "pick up where you left off" should land. */
  resumeStep: StepPath;
  /** A saved draft was restored this launch and the user has not been told yet. */
  restored: boolean;
  acknowledgeRestore: () => void;
  /** Scope the draft to a patient, so a second patient's link cannot see it. */
  adoptPatient: (patientId: string) => void;
  /** Throw the saved draft away and begin again (the explicit "Start over"). */
  discardDraft: () => void;
  /**
   * Run the submit, then delete the draft — and only then. A failed submit
   * leaves everything intact so "try again" is possible; see ./draft.
   */
  clearDraftAfterSubmit: <T>(submit: () => Promise<T>) => Promise<T>;
  reset: () => void;
}

const OnboardingContext = createContext<OnboardingStore | undefined>(undefined);

export interface OnboardingProviderProps {
  children: ReactNode;
  /** Injectable for tests and for the web export; defaults to the secure store. */
  storage?: DraftStorage;
}

export function OnboardingProvider({ children, storage }: OnboardingProviderProps) {
  const [answers, setAnswers] = useState<AnswersDraft>(initialDraft);
  const [completedSteps, setCompletedSteps] = useState<StepPath[]>([]);
  const [restored, setRestored] = useState(false);
  // Nothing renders until the draft has been read back. Otherwise the welcome
  // screen would flash "Begin setup" and then swap to "Welcome back", which is
  // exactly the moment of doubt this feature exists to remove.
  const [hydrated, setHydrated] = useState(false);

  const drafts = useRef<OnboardingDraftStore | undefined>(undefined);
  if (!drafts.current) {
    drafts.current = new OnboardingDraftStore(storage ?? draftStorage);
  }
  const store = drafts.current;

  // Latest values for callbacks that must stay referentially stable (they are
  // effect dependencies in screens).
  const latest = useRef({ answers, completedSteps });
  latest.current = { answers, completedSteps };

  useEffect(() => {
    let mounted = true;
    store
      .load()
      .then((draft) => {
        if (!mounted) {
          return;
        }
        if (draft && (draft.completedSteps.length > 0 || hasAnyAnswer(draft.answers))) {
          setAnswers(draft.answers);
          setCompletedSteps(draft.completedSteps);
          setRestored(true);
        }
      })
      .finally(() => {
        if (mounted) {
          setHydrated(true);
        }
      });
    return () => {
      mounted = false;
    };
  }, [store]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    const timer = setTimeout(() => {
      void store.save(answers, completedSteps);
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [hydrated, answers, completedSteps, store]);

  const update = useCallback((partial: Partial<AnswersDraft>) => {
    setAnswers((previous) => ({ ...previous, ...partial }));
  }, []);

  const completeStep = useCallback((step: StepPath, partial?: Partial<AnswersDraft>) => {
    if (partial) {
      setAnswers((previous) => ({ ...previous, ...partial }));
    }
    setCompletedSteps((previous) =>
      previous.includes(step) ? previous : [...previous, step]
    );
  }, []);

  const adoptPatient = useCallback(
    (patientId: string) => {
      if (!patientId || store.currentScope() === patientId) {
        return;
      }
      setAnswers((previous) =>
        previous.patientId === patientId ? previous : { ...previous, patientId }
      );
      const { answers: current, completedSteps: steps } = latest.current;
      void (async () => {
        const result = await store.adopt(patientId, current, steps);
        if (result.switched) {
          // Someone else's link on this device. Their answers, or a clean start.
          const draft = result.draft;
          setAnswers({ ...(draft?.answers ?? initialDraft), patientId });
          setCompletedSteps(draft?.completedSteps ?? []);
          setRestored(Boolean(draft));
        }
      })();
    },
    [store]
  );

  const reset = useCallback(() => {
    // The patient this link is for survives "start over" — it came from the
    // link, not from an answer, and losing it would strand the submit.
    setAnswers((previous) => ({ ...initialDraft, patientId: previous.patientId }));
    setCompletedSteps([]);
    setRestored(false);
  }, []);

  const discardDraft = useCallback(() => {
    void store.clear();
    reset();
  }, [reset, store]);

  const clearDraftAfterSubmit = useCallback(
    <T,>(submit: () => Promise<T>) => store.clearAfterSubmit(submit),
    [store]
  );

  const value = useMemo<OnboardingStore>(
    () => ({
      answers,
      update,
      completeStep,
      resumeStep: resumeStepFor(completedSteps),
      restored,
      acknowledgeRestore: () => setRestored(false),
      adoptPatient,
      discardDraft,
      clearDraftAfterSubmit,
      reset,
    }),
    [
      answers,
      completedSteps,
      restored,
      update,
      completeStep,
      adoptPatient,
      discardDraft,
      clearDraftAfterSubmit,
      reset,
    ]
  );

  if (!hydrated) {
    return null;
  }
  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingStore {
  const store = useContext(OnboardingContext);
  if (!store) {
    throw new Error('useOnboarding must be used inside OnboardingProvider');
  }
  return store;
}
