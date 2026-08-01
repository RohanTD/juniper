/**
 * Timeline grouping and copy — the pure logic behind the check-in list.
 */
import type { Encounter } from '@medplum/fhirtypes';

import {
  checkInSubtitle,
  durationMinutes,
  encounterDate,
  groupEncountersByMonth,
  lastCheckInPhrase,
  monthKey,
} from '../src/data/timeline';

function encounter(start?: string, end?: string): Encounter {
  return {
    resourceType: 'Encounter',
    status: 'finished',
    class: { code: 'VR' },
    ...(start ? { period: { start, ...(end ? { end } : {}) } } : {}),
  } as Encounter;
}

describe('encounterDate', () => {
  it('reads period.start', () => {
    expect(encounterDate(encounter('2026-07-28T09:15:00Z'))?.getUTCFullYear()).toBe(2026);
  });

  it('returns undefined for a missing or unparseable date rather than throwing', () => {
    expect(encounterDate(encounter())).toBeUndefined();
    expect(encounterDate(encounter('not-a-date'))).toBeUndefined();
  });
});

describe('groupEncountersByMonth', () => {
  it('groups into month sections and preserves server sort order', () => {
    const groups = groupEncountersByMonth([
      encounter('2026-07-28T09:15:00Z'),
      encounter('2026-07-14T09:15:00Z'),
      encounter('2026-06-30T09:15:00Z'),
    ]);

    expect(groups.map((g) => g.key)).toEqual(['2026-07', '2026-06']);
    expect(groups[0].encounters).toHaveLength(2);
    expect(groups[1].encounters).toHaveLength(1);
  });

  it('never drops an undated encounter — it lands in a trailing group', () => {
    const groups = groupEncountersByMonth([encounter('2026-07-28T09:15:00Z'), encounter()]);

    expect(groups.map((g) => g.key)).toEqual(['2026-07', 'undated']);
    expect(groups[1].encounters).toHaveLength(1);
  });

  it('handles an empty list', () => {
    expect(groupEncountersByMonth([])).toEqual([]);
  });
});

describe('monthKey', () => {
  it('zero-pads the month so keys sort lexically', () => {
    expect(monthKey(new Date(Date.UTC(2026, 0, 5)))).toBe('2026-01');
    expect(monthKey(new Date(Date.UTC(2026, 10, 5)))).toBe('2026-11');
  });
});

describe('durationMinutes', () => {
  it('computes whole minutes', () => {
    expect(durationMinutes(encounter('2026-07-28T09:00:00Z', '2026-07-28T09:12:00Z'))).toBe(12);
  });

  it('returns undefined without both endpoints, and rejects a negative span', () => {
    expect(durationMinutes(encounter('2026-07-28T09:00:00Z'))).toBeUndefined();
    expect(
      durationMinutes(encounter('2026-07-28T09:12:00Z', '2026-07-28T09:00:00Z'))
    ).toBeUndefined();
  });
});

describe('checkInSubtitle', () => {
  it('degrades gracefully when the date is unusable', () => {
    expect(checkInSubtitle(encounter())).toBe('Date unavailable');
  });

  it('includes the duration when both endpoints exist', () => {
    expect(checkInSubtitle(encounter('2026-07-28T09:00:00Z', '2026-07-28T09:12:00Z'))).toContain(
      '12 min'
    );
  });
});

describe('lastCheckInPhrase', () => {
  it('reports when there is nothing yet', () => {
    expect(lastCheckInPhrase([])).toBe('No check-ins yet');
  });

  it('uses relative phrasing for recent calls', () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    expect(lastCheckInPhrase([encounter(yesterday)])).toBe('Last check-in yesterday');

    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();
    expect(lastCheckInPhrase([encounter(threeDaysAgo)])).toBe('Last check-in 3 days ago');
  });

  it('falls back to an absolute date beyond a week', () => {
    const longAgo = new Date(Date.now() - 40 * 86_400_000).toISOString();
    expect(lastCheckInPhrase([encounter(longAgo)])).toMatch(/^Last check-in \w+ \d+$/);
  });
});
