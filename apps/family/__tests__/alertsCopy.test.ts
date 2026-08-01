/**
 * Alert prose is read by a family member at 11pm, not by a machine.
 *
 * The generator used to write a raw ISO instant into the middle of
 * `Task.description`. That is fixed at the source, but alerts already written
 * keep the text they were written with, and rewriting clinical resources to
 * tidy their wording is not this app's business — so the noise is removed on
 * the way to the screen.
 */
import { humaniseDescription } from '../src/data/alerts';

describe('humaniseDescription', () => {
  test('replaces a machine timestamp with the day and time of day it encodes', () => {
    const out = humaniseDescription(
      'During the Juniper check-in call on 2026-08-01T19:24:24.664005+00:00, the patient said: "my chest hurts".'
    );
    expect(out).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(out).toMatch(/(morning|afternoon|evening|night)/);
    // The rest of the sentence is untouched — nothing is summarised away.
    expect(out).toContain('my chest hurts');
  });

  test('handles a Z-suffixed instant', () => {
    const out = humaniseDescription('Raised at 2026-08-01T09:10:00Z.');
    expect(out).not.toContain('2026-08-01T');
  });

  test('replaces every occurrence, not just the first', () => {
    const out = humaniseDescription(
      'From 2026-08-01T09:10:00Z until 2026-08-01T22:40:00Z.'
    );
    expect(out).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  test('leaves prose with no timestamp exactly as it was', () => {
    const prose = 'She said her chest had been hurting since yesterday.';
    expect(humaniseDescription(prose)).toBe(prose);
  });

  test('a plain date is left alone — only full instants are machine noise', () => {
    const prose = 'Follow-up booked for 2026-08-20.';
    expect(humaniseDescription(prose)).toBe(prose);
  });

  test('passes undefined through rather than inventing text', () => {
    expect(humaniseDescription(undefined)).toBeUndefined();
  });
});
