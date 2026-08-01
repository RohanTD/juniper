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

/** Plain-language label per 4M domain, for the card's eyebrow. */
export const DOMAIN_LABELS: Record<string, string> = {
  'what-matters': 'What matters to them',
  medication: 'Medication',
  mentation: 'Mood and memory',
  mobility: 'Getting around',
};

/** A short verb phrase per kind, so a caregiver can scan the list. */
export const KIND_LABELS: Record<SuggestionKind, string> = {
  companionship: 'Spend time',
  'physical-activity': 'Get moving',
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
