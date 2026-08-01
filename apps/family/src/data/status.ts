/**
 * "How is Mom doing?" — answered in one sentence, from real data only.
 *
 * This is the sentence the whole dashboard exists to produce, so it is derived
 * here rather than assembled inline in a screen: it has to be reviewable as
 * one rule set, and every branch has to be traceable to something the app
 * actually read.
 *
 * The tones map to the theme's semantic ramps by MEANING, never decoration
 * (THEME_SYSTEM.md §2): `attention` is the error ramp, `good` is success,
 * `unknown` is neutral. There is deliberately no "green because everything
 * looks fine" for a patient we have no recent calls for — silence is not
 * reassurance, and rendering it as reassurance is the failure mode that
 * matters most here.
 */
import type { Encounter, Task } from '@medplum/fhirtypes';
import { encounterDate, relativeDayPhrase } from './timeline';

export type StatusTone = 'good' | 'attention' | 'unknown';

export interface OverallStatus {
  tone: StatusTone;
  /** Short pill text: "All clear", "Needs attention", "No recent calls". */
  badge: string;
  /** One sentence, the answer to the question. */
  headline: string;
  /** One supporting sentence — what to do, or what it is based on. */
  detail: string;
}

export interface StatusInput {
  firstName: string;
  encounters: Encounter[] | undefined;
  /** Open with the CARE TEAM — from Task.status, via `openAlerts()`. */
  openAlerts: Task[];
  /**
   * Open alerts this caregiver has not marked as seen. The two counts are
   * genuinely different facts and the headline needs both: acknowledging an
   * alert quiets the dashboard for you, and must not be allowed to imply the
   * concern itself was closed.
   */
  unseenAlerts: Task[];
  loading: boolean;
  error: boolean;
}

/** Open alerts this caregiver has not yet marked as seen. */
export function unseenAlerts(
  open: Task[],
  isAcknowledged: (taskId: string | undefined) => boolean
): Task[] {
  return open.filter((task) => !isAcknowledged(task.id));
}

/**
 * A call cadence measured in days, past which "no news" stops being good news.
 * Two weeks is roughly two missed weekly windows — enough to be a real signal
 * and not so tight that one holiday raises a false alarm.
 */
export const QUIET_SPELL_DAYS = 14;

export function daysSince(date: Date, now: Date = new Date()): number {
  return Math.floor((now.getTime() - date.getTime()) / 86_400_000);
}

/** When the most recent of these alerts was raised. */
export function mostRecentAlertDate(tasks: Task[]): Date | undefined {
  const times = tasks
    .map((task) => (task.authoredOn ? new Date(task.authoredOn) : undefined))
    .filter((d): d is Date => d !== undefined && !Number.isNaN(d.getTime()));
  return times.length > 0
    ? times.reduce((newest, d) => (d > newest ? d : newest))
    : undefined;
}

export function latestCheckInDate(encounters: Encounter[] | undefined): Date | undefined {
  return (encounters ?? []).map(encounterDate).find((d): d is Date => d !== undefined);
}

export function overallStatus(input: StatusInput, now: Date = new Date()): OverallStatus {
  const { firstName, encounters, openAlerts, unseenAlerts: unseen, loading, error } = input;

  if (loading) {
    return {
      tone: 'unknown',
      badge: 'Checking',
      headline: 'Catching up…',
      detail: 'Loading the latest check-ins and alerts.',
    };
  }

  if (error) {
    return {
      tone: 'unknown',
      badge: 'Unavailable',
      headline: 'We can’t show an update right now',
      detail:
        'This is a problem reading the record, not a sign that anything is wrong. If it keeps happening, your access may have changed — the care team manages who can follow along.',
    };
  }

  // Alerts outrank everything. An open escalation nobody has read is the one
  // thing a caregiver must not have to scroll to find.
  if (unseen.length > 0) {
    const count = unseen.length;
    // The headline does NOT restate the badge. "Needs attention" in a red pill
    // above the sentence "one thing needs your attention" above a section
    // headed "Needs attention" is the same fact three times, and the two
    // repetitions crowd out the thing a worried reader actually wants next,
    // which is WHEN. Saying that costs nothing and earns the line.
    // An alert with no authoredOn is malformed, but it must not turn the
    // headline into nonsense ("most recently none yet"). Drop the clause.
    const raisedAt = mostRecentAlertDate(unseen);
    const when = raisedAt ? ` ${relativeDayPhrase(raisedAt, now).toLowerCase()}` : '';
    return {
      tone: 'attention',
      badge: 'Needs attention',
      headline:
        count === 1
          ? `Juniper raised something${when}`
          : `Juniper raised ${count} things${when ? `, most recently${when}` : ''}`,
      detail:
        'Each one says what was said, when, and what has already been done about it.',
    };
  }

  // Read, but still open with the care team. Deliberately NOT "all clear":
  // acknowledging quiets the alert for this reader and closes nothing.
  if (openAlerts.length > 0) {
    const count = openAlerts.length;
    return {
      tone: 'good',
      badge: 'Seen by you',
      headline: 'You’ve seen everything that’s open',
      detail:
        count === 1
          ? 'One concern is still open with the care team. Nothing new needs you right now.'
          : `${count} concerns are still open with the care team. Nothing new needs you right now.`,
    };
  }

  const latest = latestCheckInDate(encounters);
  if (!latest) {
    return {
      tone: 'unknown',
      badge: 'No calls yet',
      headline: `Juniper hasn’t spoken with ${firstName} yet`,
      detail: `Once calls begin, each one appears here with a plain-language summary of how it went.`,
    };
  }

  const days = daysSince(latest, now);
  if (days > QUIET_SPELL_DAYS) {
    // Deliberately NOT green. No calls for two weeks is a fact worth
    // surfacing, and a reassuring colour over it would be the app lying by
    // omission.
    return {
      tone: 'attention',
      badge: 'No recent calls',
      headline: `It has been ${days} days since ${firstName}’s last call`,
      detail:
        'No alerts have been raised. Check the call times below — if the schedule looks wrong, the care team can adjust it.',
    };
  }

  return {
    tone: 'good',
    badge: 'All clear',
    headline: `Nothing needs your attention`,
    detail:
      days <= 0
        ? `Juniper spoke with ${firstName} today and raised no concerns.`
        : days === 1
          ? `Juniper spoke with ${firstName} yesterday and raised no concerns.`
          : `Juniper last spoke with ${firstName} ${days} days ago and raised no concerns.`,
  };
}
