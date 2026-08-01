/**
 * The family-side "I've seen this" for escalation alerts.
 *
 * Reads and writes the voice service's app-level store, never FHIR — see
 * ../acknowledgements.ts for why `Task.status` is the wrong place and why the
 * caregiver could not write it anyway.
 *
 * Updates are OPTIMISTIC and roll back on failure. Acknowledging is a gesture
 * ("yes, I've read it"), and a spinner between the tap and the acknowledgement
 * makes a caregiver tap twice; but a failure that leaves the UI claiming
 * something is acknowledged when the server disagrees would be worse than the
 * spinner, so the rollback is explicit and says what happened.
 */
import { useMedplum, useMedplumProfile } from '@medplum/react-hooks';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AcknowledgementsClient, type AlertAcknowledgement } from '../acknowledgements';
import { ENV } from '../env';
import { describeVoiceApiError } from '../voiceApi';

export interface AcknowledgementsState {
  /** taskId -> acknowledgement. */
  byTaskId: Record<string, AlertAcknowledgement>;
  loading: boolean;
  /** Set while a write is in flight, so the UI can disable the control. */
  saving: boolean;
  errorMessage: string | undefined;
  isAcknowledged: (taskId: string | undefined) => boolean;
  acknowledge: (taskId: string) => Promise<boolean>;
  undo: (taskId: string) => Promise<boolean>;
}

const UNCONFIGURED = 'the Juniper service is not configured';

export function useAcknowledgements(patientId: string | undefined): AcknowledgementsState {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const [byTaskId, setByTaskId] = useState<Record<string, AlertAcknowledgement>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();

  const acknowledgedBy = useMemo(
    () => (profile ? `${profile.resourceType}/${profile.id}` : undefined),
    [profile]
  );

  const makeClient = useCallback(() => {
    if (!ENV.voiceApiUrl) return undefined;
    const token = medplum.getAccessToken();
    if (!token) return undefined;
    return new AcknowledgementsClient({ baseUrl: ENV.voiceApiUrl, token });
  }, [medplum]);

  useEffect(() => {
    if (!patientId) {
      return;
    }
    const client = makeClient();
    if (!client) {
      setLoading(false);
      setErrorMessage(UNCONFIGURED);
      return;
    }
    let cancelled = false;
    setLoading(true);
    client
      .getAcknowledgements(patientId)
      .then((result) => {
        if (cancelled) return;
        const next: Record<string, AlertAcknowledgement> = {};
        for (const entry of result.acknowledgements ?? []) {
          next[entry.taskId] = entry;
        }
        setByTaskId(next);
        setErrorMessage(undefined);
      })
      .catch((error) => {
        if (!cancelled) setErrorMessage(describeVoiceApiError(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [makeClient, patientId]);

  /** Optimistically apply `next`, PUT it, and roll back if the write fails. */
  const commit = useCallback(
    async (next: Record<string, AlertAcknowledgement>): Promise<boolean> => {
      if (!patientId) return false;
      const client = makeClient();
      if (!client) {
        setErrorMessage(UNCONFIGURED);
        return false;
      }
      const previous = byTaskId;
      setByTaskId(next);
      setSaving(true);
      setErrorMessage(undefined);
      try {
        await client.putAcknowledgements(patientId, {
          acknowledgements: Object.values(next),
        });
        return true;
      } catch (error) {
        setByTaskId(previous);
        setErrorMessage(describeVoiceApiError(error));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [byTaskId, makeClient, patientId]
  );

  const acknowledge = useCallback(
    (taskId: string) =>
      commit({
        ...byTaskId,
        [taskId]: {
          taskId,
          acknowledgedAt: new Date().toISOString(),
          ...(acknowledgedBy ? { acknowledgedBy } : {}),
        },
      }),
    [acknowledgedBy, byTaskId, commit]
  );

  const undo = useCallback(
    (taskId: string) => {
      const next = { ...byTaskId };
      delete next[taskId];
      return commit(next);
    },
    [byTaskId, commit]
  );

  const isAcknowledged = useCallback(
    (taskId: string | undefined) => Boolean(taskId && byTaskId[taskId]),
    [byTaskId]
  );

  return { byTaskId, loading, saving, errorMessage, isAcknowledged, acknowledge, undo };
}

/** "Seen by you on Friday at 11:04 PM" — the receipt under an acknowledged alert. */
export function acknowledgedPhrase(entry: AlertAcknowledgement | undefined): string | undefined {
  if (!entry) {
    return undefined;
  }
  const date = new Date(entry.acknowledgedAt);
  if (Number.isNaN(date.getTime())) {
    return 'Marked as seen';
  }
  const day = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `You marked this as seen on ${day} at ${time}`;
}
