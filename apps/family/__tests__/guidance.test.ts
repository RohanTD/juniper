/**
 * Rendering helpers for family guidance.
 *
 * The generator's safety filters live in the voice service and are tested
 * there (`test_family_guidance.py`). What matters here is the other half of
 * the contract: this app renders what it is given without editorialising, and
 * never presents a suggestion more confidently than its evidence supports.
 */
import {
  DOMAIN_LABELS,
  KIND_LABELS,
  domainLabel,
  evidencePhrase,
  kindLabel,
  type GuidanceDocument,
} from '../src/guidance';
import { NOTE_CATEGORY } from '@juniper/terminology';

describe('labels', () => {
  test('every 4M domain has plain-language copy for a family reader', () => {
    // "Mentation" is a clinical word. A daughter reads "Mood and memory".
    for (const domain of ['what-matters', 'medication', 'mentation', 'mobility']) {
      expect(DOMAIN_LABELS[domain]).toBeTruthy();
      expect(domainLabel(domain)).toBe(DOMAIN_LABELS[domain]);
    }
    expect(DOMAIN_LABELS.mentation).not.toMatch(/mentation/i);
  });

  test('an unknown domain falls back to the code rather than rendering blank', () => {
    expect(domainLabel('nutrition')).toBe('nutrition');
  });

  test('every suggestion kind the service can emit has a label here', () => {
    // Mirrors ALLOWED_KINDS in guidance.py — a kind added there without a
    // label here would render as a bare bullet with no framing.
    for (const kind of [
      'companionship',
      'physical-activity',
      'home-safety',
      'routine-support',
      'raise-with-care-team',
    ] as const) {
      expect(KIND_LABELS[kind]).toBeTruthy();
    }
  });

  test('an unrecognised kind renders as nothing rather than as raw code', () => {
    expect(kindLabel('prescribe')).toBe('');
  });
});

describe('evidencePhrase', () => {
  const doc = (callsConsidered: number): GuidanceDocument => ({
    suggestions: [],
    callsConsidered,
  });

  test('states how many calls the suggestions rest on', () => {
    expect(evidencePhrase(doc(6))).toBe('Based on 6 recent calls');
  });

  test('singular reads correctly', () => {
    expect(evidencePhrase(doc(1))).toBe('Based on 1 recent call');
  });

  test('no evidence means no claim, rather than "based on 0 calls"', () => {
    expect(evidencePhrase(doc(0))).toBeUndefined();
    expect(evidencePhrase(undefined)).toBeUndefined();
  });
});

describe('access scope', () => {
  test('guidance is read from its own category, never from the clinical note', () => {
    expect(NOTE_CATEGORY.familyGuidance.code).toBe('juniper-family-guidance');
    // The categories this app is permitted to read are family-facing only;
    // the AccessPolicy enforces it, and `access-scope.test.ts` guards the
    // source for any mention of the forbidden ones.
    expect(NOTE_CATEGORY.familyGuidance.code).not.toBe(NOTE_CATEGORY.note.code);
    expect(NOTE_CATEGORY.familyGuidance.code).not.toBe(NOTE_CATEGORY.transcript.code);
  });
});
