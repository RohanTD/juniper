/**
 * Pure timeline logic for the check-in list: date extraction, month grouping
 * (rendered as label-plus-rule section headers), and card copy. Kept free of
 * React and react-native so it is trivially testable.
 */
import type { Encounter } from '@medplum/fhirtypes';

export interface TimelineGroup {
  /** Stable key, e.g. "2026-07". */
  key: string;
  /** Section-header label, e.g. "July 2026". */
  label: string;
  encounters: Encounter[];
}

export function encounterDate(encounter: Encounter): Date | undefined {
  const value = encounter.period?.start ?? encounter.period?.end;
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * Group encounters into month sections, preserving the input order (the query
 * is server-sorted by -date). Encounters without a usable date land in a
 * trailing "Undated" group rather than disappearing.
 */
export function groupEncountersByMonth(encounters: Encounter[]): TimelineGroup[] {
  const groups: TimelineGroup[] = [];
  const byKey = new Map<string, TimelineGroup>();
  const undated: Encounter[] = [];
  for (const encounter of encounters) {
    const date = encounterDate(encounter);
    if (!date) {
      undated.push(encounter);
      continue;
    }
    const key = monthKey(date);
    let group = byKey.get(key);
    if (!group) {
      group = { key, label: monthLabel(date), encounters: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.encounters.push(encounter);
  }
  if (undated.length > 0) {
    groups.push({ key: 'undated', label: 'Undated', encounters: undated });
  }
  return groups;
}

export function durationMinutes(encounter: Encounter): number | undefined {
  const start = encounter.period?.start;
  const end = encounter.period?.end;
  if (!start || !end) {
    return undefined;
  }
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) {
    return undefined;
  }
  return Math.max(1, Math.round(ms / 60000));
}

export function checkInTitle(_encounter: Encounter): string {
  return 'Check-in call';
}

/** "Tuesday, July 28 at 9:15 AM · 12 min" */
export function checkInSubtitle(encounter: Encounter): string {
  const date = encounterDate(encounter);
  if (!date) {
    return 'Date unavailable';
  }
  const day = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const minutes = durationMinutes(encounter);
  return minutes === undefined ? `${day} at ${time}` : `${day} at ${time} · ${minutes} min`;
}

/** Short relative phrasing for the summary screen. */
export function lastCheckInPhrase(encounters: Encounter[]): string {
  const latest = encounters.map(encounterDate).find((d): d is Date => d !== undefined);
  if (!latest) {
    return 'No check-ins yet';
  }
  const days = Math.floor((Date.now() - latest.getTime()) / 86_400_000);
  if (days <= 0) {
    return 'Last check-in today';
  }
  if (days === 1) {
    return 'Last check-in yesterday';
  }
  if (days < 7) {
    return `Last check-in ${days} days ago`;
  }
  return `Last check-in ${latest.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`;
}
