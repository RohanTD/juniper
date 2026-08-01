/**
 * Escalation alerts, per docs/CONTRACTS.md sections 2 and 4:
 *
 *   Task?patient=...&code=juniper-escalation&_sort=-authored-on
 *
 * Live arrival via useSubscription (WebSocket, works in RN), with interval
 * polling as a fallback so a dropped socket degrades to slightly-stale rather
 * than silent. Task.description is authored to be self-sufficient: what was
 * said, when, and what has already happened about it.
 */
import { categoryToken, TASK_CATEGORY } from '@juniper/terminology';
import type { Task } from '@medplum/fhirtypes';
import { useMedplum, useSubscription } from '@medplum/react-hooks';
import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_INTERVAL_MS = 60_000;

export interface AlertsState {
  tasks: Task[] | undefined;
  loading: boolean;
  error: boolean;
  /**
   * False once the live subscription has been refused, which is the NORMAL
   * state for a caregiver — the AccessPolicy is a strict allow-list and
   * `Subscription` is not on it. Exposed so the UI can say "checking every
   * minute" rather than leaving the question to the browser console, where a
   * benign, already-handled 403 reads like a broken app.
   */
  live: boolean;
  refresh: () => void;
}

export function useAlerts(patientRef: string | undefined): AlertsState {
  const medplum = useMedplum();
  const [tasks, setTasks] = useState<Task[]>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = useCallback(() => {
    if (!patientRef) {
      return;
    }
    medplum
      .searchResources('Task', {
        patient: patientRef,
        code: categoryToken(TASK_CATEGORY.escalation),
        _sort: '-authored-on',
        _count: '50',
      })
      .then((results) => {
        setTasks([...results]);
        setError(false);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [medplum, patientRef]);

  // Initial load + polling fallback.
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // Live arrival. The subscription criteria mirror the polled query; on any
  // matching event we simply re-run the canonical search.
  //
  // Subscriptions are a BEST-EFFORT upgrade over the polling above, never a
  // requirement. Medplum's WebSocket subscriptions need access to the
  // Subscription resource, which the caregiver AccessPolicy deliberately does
  // not grant — it is a strict allow-list of Patient / RelatedPerson /
  // Encounter / Task / DocumentReference / Binary. Without an onError handler
  // the failed bind surfaced as an unhandled "Forbidden" console error on
  // every refresh cycle, which looks like a broken app even though alerts
  // were arriving fine on the 60s poll.
  //
  // If live delivery is wanted later, the fix is a deliberate access-model
  // decision (granting caregivers Subscription access), not a client change —
  // so this degrades quietly and says so once.
  const criteria = `Task?patient=${patientRef ?? 'Patient/none'}&code=${categoryToken(TASK_CATEGORY.escalation)}`;
  const warnedRef = useRef(false);
  const [live, setLive] = useState(true);
  useSubscription(criteria, refresh, {
    onError: (err) => {
      setLive(false);
      if (!warnedRef.current) {
        warnedRef.current = true;
        console.info(
          '[juniper] live alert subscription unavailable for this account; ' +
            `falling back to ${POLL_INTERVAL_MS / 1000}s polling. This is expected ` +
            'for a caregiver sign-in and alerts still arrive — see src/data/alerts.ts.',
          err
        );
      }
    },
  });

  return { tasks, loading, error, live, refresh };
}

/** Open (unresolved) alerts — everything not yet completed or cancelled. */
export function openAlerts(tasks: Task[] | undefined): Task[] {
  return (tasks ?? []).filter(
    (task) => task.status !== 'completed' && task.status !== 'cancelled' && task.status !== 'rejected'
  );
}

/**
 * Strip machine timestamps out of an alert's prose.
 *
 * `Task.description` is written to be read by a family member at 11pm, and the
 * generator used to drop a raw `2026-08-01T19:24:24.664005+00:00` into the
 * middle of the sentence. That is fixed at the source, but alerts already
 * written keep the text they were written with — rewriting clinical resources
 * to tidy their wording is not something this app should do, so the noise is
 * removed on the way to the screen instead.
 *
 * Nothing is invented: the timestamp is replaced with the day and time of day
 * it encodes, which is what the sentence was trying to say.
 */
export function humaniseDescription(description: string | undefined): string | undefined {
  if (!description) {
    return description;
  }
  return description.replace(
    /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g,
    (iso) => {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) {
        return 'recently';
      }
      const hour = date.getHours();
      const part =
        hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night';
      return `${date.toLocaleDateString('en-US', { weekday: 'long' })} ${part}`;
    }
  );
}

/** Plain-language progress line for an alert's footer. */
export function alertStatusLine(task: Task): string {
  switch (task.status) {
    case 'requested':
      return 'The care team has been notified.';
    case 'received':
    case 'accepted':
      return 'The care team has seen this.';
    case 'in-progress':
      return 'The care team is on it.';
    case 'completed':
      return 'Resolved by the care team.';
    case 'cancelled':
    case 'rejected':
      return 'No longer needs action.';
    default:
      return 'Status unknown — contact the care team with questions.';
  }
}

export function alertWhen(task: Task): string {
  if (!task.authoredOn) {
    return 'Time unknown';
  }
  const date = new Date(task.authoredOn);
  if (Number.isNaN(date.getTime())) {
    return 'Time unknown';
  }
  const day = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day} at ${time}`;
}
