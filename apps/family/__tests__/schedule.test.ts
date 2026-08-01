/**
 * Next-call derivation — the "what's coming up" PLAN.md promises.
 *
 * The interesting cases are all timezone cases: a window is stored in the
 * PATIENT's zone, and the caregiver reading it is frequently in another one. A
 * daughter in California must see her mother's Maryland morning, and must see
 * it correctly on both sides of a DST boundary.
 */
import {
  describeNextCall,
  nextCall,
  nextCallSummary,
  NEXT_CALL_CAVEAT,
} from '../src/data/schedule';
import type { CallWindow } from '../src/preferences';

const NY = 'America/New_York';

function window(overrides: Partial<CallWindow> = {}): CallWindow {
  return {
    days: ['mon', 'tue', 'wed', 'thu', 'fri'],
    start: '09:00',
    end: '11:00',
    timezone: NY,
    ...overrides,
  };
}

/** 2026-08-03 is a Monday. */
const MONDAY_6AM_ET = new Date('2026-08-03T10:00:00Z'); // 06:00 EDT
const MONDAY_10AM_ET = new Date('2026-08-03T14:00:00Z'); // 10:00 EDT, mid-window
const MONDAY_NOON_ET = new Date('2026-08-03T16:00:00Z'); // 12:00 EDT, window closed

describe('nextCall', () => {
  it('finds today’s window when it has not opened yet', () => {
    const next = nextCall([window()], MONDAY_6AM_ET);
    expect(next?.start.toISOString()).toBe('2026-08-03T13:00:00.000Z'); // 09:00 EDT
    expect(next?.end.toISOString()).toBe('2026-08-03T15:00:00.000Z'); // 11:00 EDT
    expect(next?.inProgress).toBe(false);
  });

  it('reports a window that is open right now as in progress', () => {
    expect(nextCall([window()], MONDAY_10AM_ET)?.inProgress).toBe(true);
  });

  it('rolls to the next matching day once today’s window has closed', () => {
    const next = nextCall([window()], MONDAY_NOON_ET);
    // Tuesday 09:00 EDT.
    expect(next?.start.toISOString()).toBe('2026-08-04T13:00:00.000Z');
  });

  it('skips days the window does not cover', () => {
    // Friday evening; a weekdays-only window next fires on Monday.
    const fridayNight = new Date('2026-08-08T01:00:00Z'); // Fri 21:00 EDT
    const next = nextCall([window()], fridayNight);
    expect(next?.start.toISOString()).toBe('2026-08-10T13:00:00.000Z');
  });

  it('picks the soonest across several windows', () => {
    const next = nextCall(
      [
        window({ days: ['fri'], start: '15:00', end: '16:00' }),
        window({ days: ['mon'], start: '09:00', end: '11:00' }),
      ],
      MONDAY_6AM_ET
    );
    expect(next?.window.days).toEqual(['mon']);
  });

  it('resolves the wall-clock hour correctly across a DST boundary', () => {
    // 2026-03-08 is the US spring-forward Sunday; the Monday after is EDT
    // (UTC-4) while the Friday before is EST (UTC-5). A naive fixed-offset
    // implementation gets exactly one of these wrong.
    const beforeDst = new Date('2026-03-05T12:00:00Z'); // Thu 07:00 EST
    expect(nextCall([window()], beforeDst)?.start.toISOString()).toBe('2026-03-05T14:00:00.000Z');

    const afterDst = new Date('2026-03-09T10:00:00Z'); // Mon 06:00 EDT
    expect(nextCall([window()], afterDst)?.start.toISOString()).toBe('2026-03-09T13:00:00.000Z');
  });

  it('is undefined when there is nothing usable to derive from', () => {
    expect(nextCall(undefined, MONDAY_6AM_ET)).toBeUndefined();
    expect(nextCall([], MONDAY_6AM_ET)).toBeUndefined();
  });

  it('ignores a half-configured window rather than guessing the missing half', () => {
    expect(nextCall([window({ days: [] })], MONDAY_6AM_ET)).toBeUndefined();
    expect(nextCall([window({ start: '' })], MONDAY_6AM_ET)).toBeUndefined();
    expect(nextCall([window({ start: '25:00' })], MONDAY_6AM_ET)).toBeUndefined();
    expect(nextCall([window({ end: 'noon' })], MONDAY_6AM_ET)).toBeUndefined();
  });

  it('does not silently vanish when the end is not after the start', () => {
    // A typo here would otherwise make every occurrence look already-past and
    // the whole card would go blank.
    const next = nextCall([window({ start: '09:00', end: '09:00' })], MONDAY_6AM_ET);
    expect(next).toBeDefined();
    expect(next!.end.getTime()).toBeGreaterThan(next!.start.getTime());
  });
});

describe('describeNextCall', () => {
  it('says Today, Tomorrow, or the weekday, in the patient’s zone', () => {
    expect(describeNextCall(nextCall([window()], MONDAY_6AM_ET), MONDAY_6AM_ET)?.day).toBe('Today');
    expect(describeNextCall(nextCall([window()], MONDAY_NOON_ET), MONDAY_NOON_ET)?.day).toBe(
      'Tomorrow'
    );
    const fridayNight = new Date('2026-08-08T01:00:00Z');
    expect(describeNextCall(nextCall([window()], fridayNight), fridayNight)?.day).toBe('Monday');
  });

  it('says "Right now" while the window is open', () => {
    expect(describeNextCall(nextCall([window()], MONDAY_10AM_ET), MONDAY_10AM_ET)?.day).toBe(
      'Right now'
    );
  });

  it('renders a RANGE with the patient’s zone, never a single promised time', () => {
    const copy = describeNextCall(nextCall([window()], MONDAY_6AM_ET), MONDAY_6AM_ET);
    expect(copy?.range).toContain('–');
    expect(copy?.range).toMatch(/9:00\s?AM/);
    expect(copy?.range).toMatch(/11:00\s?AM/);
    // The zone is shown because the viewer is frequently not in it.
    expect(copy?.range).toMatch(/E[DS]T|GMT/);
  });

  it('always carries the caveat — the window is not an appointment', () => {
    expect(describeNextCall(nextCall([window()], MONDAY_6AM_ET), MONDAY_6AM_ET)?.caveat).toBe(
      NEXT_CALL_CAVEAT
    );
    // ...and says something true, not the same sentence, mid-window.
    expect(describeNextCall(nextCall([window()], MONDAY_10AM_ET), MONDAY_10AM_ET)?.caveat).toContain(
      'open now'
    );
  });

  it('renders nothing rather than something invented when there is no schedule', () => {
    expect(describeNextCall(undefined)).toBeUndefined();
    expect(nextCallSummary(undefined)).toBe('No call times set');
  });
});
