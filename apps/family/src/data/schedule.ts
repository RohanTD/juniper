/**
 * "What's coming up" — the next expected call, derived from the saved call
 * windows and their timezone.
 *
 * PLAN.md promises the family app answers *when the last call happened, how it
 * went, what's coming up, and any alert raised*. The first three of those had a
 * home and the fourth did not; this module supplies it from data that already
 * exists (the preferences store's call windows) rather than from anything
 * invented.
 *
 * Two honesty constraints shape the whole file:
 *
 * 1. **A window is not an appointment.** Juniper calls somewhere inside the
 *    window, and a caregiver told "9:00 AM Monday" who gets a call at 10:40
 *    has been misled by the app, not by the service. Every string this module
 *    produces is a range, and `NEXT_CALL_CAVEAT` is rendered next to it.
 * 2. **Times belong to the patient, not the viewer.** A daughter in California
 *    watching a mother in Maryland must see her mother's morning. Everything is
 *    computed and formatted in the window's own IANA zone, with the zone name
 *    shown so the difference is visible rather than confusing.
 *
 * Pure and React-free so it is trivially testable.
 */
import type { CallWindow, Weekday } from '../preferences';

/** Rendered wherever a next-call time appears. The window is a promise about a range, not a time. */
export const NEXT_CALL_CAVEAT =
  'This is the scheduled window, not a set appointment — Juniper calls somewhere inside it.';

const WEEKDAY_ORDER: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export interface NextCall {
  window: CallWindow;
  /** Instant the window opens. */
  start: Date;
  /** Instant the window closes. */
  end: Date;
  /** True when `now` is already inside the window. */
  inProgress: boolean;
}

// ---------------------------------------------------------------------------
// Timezone arithmetic
//
// No date library is available here, and the correctness bar is real: a window
// stored as "09:00 America/New_York" must resolve to the right instant across a
// DST boundary and from a viewer in any zone. Intl is the only mechanism in the
// runtime that knows zone rules, so both directions go through it.
// ---------------------------------------------------------------------------

interface ZoneParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zoneParts(instant: Date, timeZone: string): ZoneParts | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(instant);
    const read = (type: string): number =>
      Number.parseInt(parts.find((p) => p.type === type)?.value ?? '', 10);
    const result = {
      year: read('year'),
      month: read('month'),
      day: read('day'),
      hour: read('hour'),
      minute: read('minute'),
      second: read('second'),
    };
    return Object.values(result).some((n) => Number.isNaN(n)) ? undefined : result;
  } catch {
    // An unknown zone, or a runtime built without full ICU. Fall back to the
    // device's own zone below rather than dropping the feature entirely — a
    // slightly-wrong hour beats a blank card.
    return undefined;
  }
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function zoneOffsetMs(instant: Date, timeZone: string): number | undefined {
  const parts = zoneParts(instant, timeZone);
  if (!parts) {
    return undefined;
  }
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return asUtc - instant.getTime();
}

/**
 * Turn a wall-clock time in `timeZone` into an instant.
 *
 * The offset depends on the instant we are trying to find, so this guesses,
 * measures the offset there, and re-measures once — which is what makes the
 * spring-forward and fall-back boundaries land correctly instead of an hour out
 * twice a year.
 */
function fromZonedTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const first = zoneOffsetMs(new Date(naive), timeZone);
  if (first === undefined) {
    return new Date(year, month - 1, day, hour, minute);
  }
  const candidate = naive - first;
  const second = zoneOffsetMs(new Date(candidate), timeZone);
  return new Date(second === undefined || second === first ? candidate : naive - second);
}

function parseHhMm(value: string | undefined): [number, number] | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec((value ?? '').trim());
  if (!match) {
    return undefined;
  }
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return undefined;
  }
  return [hour, minute];
}

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

// ---------------------------------------------------------------------------
// The derivation
// ---------------------------------------------------------------------------

/** The soonest occurrence of ONE window at or after `now`, within the next week. */
function nextOccurrence(window: CallWindow, now: Date): NextCall | undefined {
  const start = parseHhMm(window.start);
  const end = parseHhMm(window.end);
  const days = new Set((window.days ?? []).map((d) => d.toLowerCase()));
  if (!start || !end || days.size === 0) {
    // A half-configured window is not a schedule. Saying nothing is correct;
    // guessing at the missing half is how a caregiver ends up waiting by the
    // phone on a day nobody is calling.
    return undefined;
  }
  const timeZone = window.timezone || deviceTimeZone();
  const today = zoneParts(now, timeZone);
  const base = today
    ? Date.UTC(today.year, today.month - 1, today.day)
    : Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

  for (let offset = 0; offset <= 7; offset += 1) {
    const civil = new Date(base + offset * 86_400_000);
    if (!days.has(WEEKDAY_ORDER[civil.getUTCDay()])) {
      continue;
    }
    const year = civil.getUTCFullYear();
    const month = civil.getUTCMonth() + 1;
    const day = civil.getUTCDate();
    const opens = fromZonedTime(year, month, day, start[0], start[1], timeZone);
    let closes = fromZonedTime(year, month, day, end[0], end[1], timeZone);
    if (closes.getTime() <= opens.getTime()) {
      // An end at or before the start (a typo, or a window crossing midnight)
      // would otherwise make every occurrence look already-past and the card
      // would silently go blank. Treat it as an hour long and move on.
      closes = new Date(opens.getTime() + 3_600_000);
    }
    if (now.getTime() < closes.getTime()) {
      return {
        window,
        start: opens,
        end: closes,
        inProgress: now.getTime() >= opens.getTime(),
      };
    }
  }
  return undefined;
}

/** The soonest call window across all of them, or undefined if none is usable. */
export function nextCall(
  windows: CallWindow[] | undefined,
  now: Date = new Date()
): NextCall | undefined {
  let best: NextCall | undefined;
  for (const window of windows ?? []) {
    const candidate = nextOccurrence(window, now);
    if (!candidate) {
      continue;
    }
    if (!best || candidate.start.getTime() < best.start.getTime()) {
      best = candidate;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

export interface NextCallCopy {
  /** "Right now" / "Today" / "Tomorrow" / "Thursday" / "Mon, Aug 17" */
  day: string;
  /** "9:00 AM – 11:00 AM EDT" */
  range: string;
  /** The honesty line — always rendered with the above. */
  caveat: string;
}

function formatTime(instant: Date, timeZone: string, withZone: boolean): string {
  try {
    return instant.toLocaleTimeString('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      ...(withZone ? { timeZoneName: 'short' as const } : {}),
    });
  } catch {
    return instant.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
}

function civilDayKey(instant: Date, timeZone: string): string {
  const parts = zoneParts(instant, timeZone);
  return parts
    ? `${parts.year}-${parts.month}-${parts.day}`
    : `${instant.getFullYear()}-${instant.getMonth()}-${instant.getDate()}`;
}

export function describeNextCall(next: NextCall | undefined, now: Date = new Date()): NextCallCopy | undefined {
  if (!next) {
    return undefined;
  }
  const timeZone = next.window.timezone || deviceTimeZone();
  const today = civilDayKey(now, timeZone);
  const tomorrow = civilDayKey(new Date(now.getTime() + 86_400_000), timeZone);
  const target = civilDayKey(next.start, timeZone);

  let day: string;
  if (next.inProgress) {
    day = 'Right now';
  } else if (target === today) {
    day = 'Today';
  } else if (target === tomorrow) {
    day = 'Tomorrow';
  } else if (next.start.getTime() - now.getTime() < 7 * 86_400_000) {
    day = next.start.toLocaleDateString('en-US', { timeZone, weekday: 'long' });
  } else {
    day = next.start.toLocaleDateString('en-US', {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }

  return {
    day,
    range: `${formatTime(next.start, timeZone, false)} – ${formatTime(next.end, timeZone, true)}`,
    caveat: next.inProgress
      ? 'The window is open now — Juniper calls somewhere inside it.'
      : NEXT_CALL_CAVEAT,
  };
}

/** Compact "Thu, 9:00 AM – 11:00 AM EDT" for a stat tile caption. */
export function nextCallSummary(copy: NextCallCopy | undefined): string {
  return copy ? `${copy.day} · ${copy.range}` : 'No call times set';
}
