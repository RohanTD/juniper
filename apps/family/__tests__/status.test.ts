/**
 * The one sentence the dashboard exists to produce.
 *
 * The rules that matter are the ones that stop the app being falsely
 * reassuring: silence is not good news, acknowledging an alert closes nothing,
 * and a read failure is not a clinical finding.
 */
import type { Encounter, Task } from '@medplum/fhirtypes';
import { overallStatus, unseenAlerts, QUIET_SPELL_DAYS } from '../src/data/status';

const NOW = new Date('2026-08-03T15:00:00Z');

function encounter(daysAgo: number): Encounter {
  return {
    resourceType: 'Encounter',
    status: 'finished',
    class: { code: 'VR' },
    period: { start: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString() },
  } as Encounter;
}

const alert = (id: string): Task =>
  ({ resourceType: 'Task', id, status: 'requested', intent: 'order' }) as Task;

const base = {
  firstName: 'Peggy',
  encounters: [encounter(1)],
  openAlerts: [] as Task[],
  unseenAlerts: [] as Task[],
  loading: false,
  error: false,
};

describe('overallStatus', () => {
  it('reports all clear only when there is a recent call AND nothing open', () => {
    const status = overallStatus(base, NOW);
    expect(status.tone).toBe('good');
    expect(status.badge).toBe('All clear');
    expect(status.detail).toContain('yesterday');
  });

  it('puts unread alerts above everything else', () => {
    const status = overallStatus(
      { ...base, openAlerts: [alert('a'), alert('b')], unseenAlerts: [alert('a'), alert('b')] },
      NOW
    );
    expect(status.tone).toBe('attention');
    expect(status.headline).toBe('2 things need your attention');
  });

  it('does NOT claim all-clear when an acknowledged alert is still open with the care team', () => {
    // Acknowledging quiets the alert for this reader. It closes nothing, and
    // the headline must not imply otherwise.
    const status = overallStatus(
      { ...base, openAlerts: [alert('a')], unseenAlerts: [] },
      NOW
    );
    expect(status.badge).toBe('Seen by you');
    expect(status.badge).not.toBe('All clear');
    expect(status.detail).toContain('still open with the care team');
  });

  it('treats a long silence as something to look at, never as good news', () => {
    const status = overallStatus(
      { ...base, encounters: [encounter(QUIET_SPELL_DAYS + 6)] },
      NOW
    );
    expect(status.tone).toBe('attention');
    expect(status.headline).toContain('20 days');
    // ...while still saying the true thing: nothing was actually raised.
    expect(status.detail).toContain('No alerts have been raised');
  });

  it('stays reassuring inside the quiet-spell threshold', () => {
    expect(overallStatus({ ...base, encounters: [encounter(QUIET_SPELL_DAYS)] }, NOW).tone).toBe(
      'good'
    );
  });

  it('renders "no calls yet" as unknown, not as green', () => {
    const status = overallStatus({ ...base, encounters: [] }, NOW);
    expect(status.tone).toBe('unknown');
    expect(status.headline).toContain('hasn’t spoken with Peggy yet');
  });

  it('says a read failure is a read failure, not a clinical finding', () => {
    const status = overallStatus({ ...base, error: true }, NOW);
    expect(status.tone).toBe('unknown');
    expect(status.detail).toContain('not a sign that anything is wrong');
  });

  it('does not guess while still loading', () => {
    expect(overallStatus({ ...base, loading: true }, NOW).tone).toBe('unknown');
  });
});

describe('unseenAlerts', () => {
  it('filters out the ones this caregiver has acknowledged', () => {
    const seen = new Set(['a']);
    expect(
      unseenAlerts([alert('a'), alert('b')], (id) => Boolean(id && seen.has(id))).map((t) => t.id)
    ).toEqual(['b']);
  });

  it('treats an alert with no id as unseen rather than dropping it', () => {
    const idless = { resourceType: 'Task', status: 'requested', intent: 'order' } as Task;
    expect(unseenAlerts([idless], () => false)).toHaveLength(1);
  });
});
