/**
 * Family guidance — the shapes and the rendering vocabulary.
 *
 * Deliberately free of React, React Native and the Medplum client, exactly
 * like `src/acknowledgements.ts`: the label maps and the evidence phrasing are
 * the parts worth testing, and they should not need a renderer to do it.
 * `src/data/guidance.ts` holds the hook that fetches the document.
 */

/** The five things a family member is ever asked to do; mirrors guidance.py. */
export type SuggestionKind =
  | 'companionship'
  | 'physical-activity'
  | 'home-safety'
  | 'routine-support'
  | 'raise-with-care-team';

export interface Suggestion {
  /** 4M domain code. */
  domain: string;
  kind: SuggestionKind;
  observation: string;
  suggestion: string;
  supportingCalls: number;
}

export interface GuidanceDocument {
  suggestions: Suggestion[];
  callsConsidered: number;
  unavailableReason?: string;
}

export interface GuidanceState {
  guidance: GuidanceDocument | undefined;
  loading: boolean;
  /** True when no guidance document exists yet — the normal early state. */
  absent: boolean;
  error: boolean;
}

/**
 * Plain-language label per 4M domain, for the card's eyebrow.
 *
 * The 4Ms are IHI's framework (Age-Friendly Health Systems), and their names
 * are written for clinicians: "Mentation" is not a word a daughter uses. These
 * are the same four domains in the language of the person reading this screen —
 * which is also IHI's own instruction, since the guide is explicit that the 4Ms
 * should organize care around "the older adult's wellness and strengths rather
 * than solely on disease".
 */
export const DOMAIN_LABELS: Record<string, string> = {
  // IHI: "specific health outcome goals and care preferences" — and the guide
  // is emphatic that these are *activities*: babysitting a grandchild, walking
  // with friends in the morning. Hence "wants to keep doing", not "goals".
  'what-matters': 'What they want to keep doing',
  medication: 'Medication',
  mentation: 'Mood and memory',
  // IHI's Mobility aim is "moves safely every day to maintain function AND do
  // What Matters" — mobility in service of the rest, never for its own sake.
  mobility: 'Getting about safely',
};

/** A short verb phrase per kind, so a caregiver can scan the list. */
export const KIND_LABELS: Record<SuggestionKind, string> = {
  companionship: 'Spend time',
  'physical-activity': 'Keep moving',
  'home-safety': 'At home',
  'routine-support': 'Lend a hand',
  'raise-with-care-team': 'Worth mentioning',
};

export function domainLabel(domain: string): string {
  return DOMAIN_LABELS[domain] ?? domain;
}

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind as SuggestionKind] ?? '';
}

/** "Based on 6 recent calls" — the claim a reader should be able to weigh. */
export function evidencePhrase(guidance: GuidanceDocument | undefined): string | undefined {
  if (!guidance || guidance.callsConsidered <= 0) {
    return undefined;
  }
  const n = guidance.callsConsidered;
  return `Based on ${n} recent ${n === 1 ? 'call' : 'calls'}`;
}
