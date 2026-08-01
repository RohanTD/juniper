/**
 * Call preferences for the family app.
 *
 * These live in the voice service's app-level store, not FHIR (there is no
 * FHIR home for "call me in the mornings"), so this is the one place the
 * otherwise read-only family app writes anything — and it writes nothing
 * clinical. The caregiver's own Medplum access token is sent; the service
 * asks Medplum whether that user may read the patient, so entitlement stays
 * derived from CareTeam membership rather than a shared master token.
 */
import { useMedplum } from '@medplum/react-hooks';
import { useCallback, useEffect, useState } from 'react';
import { ENV } from '../env';
import { PreferencesApiError, PreferencesClient, type PatientPreferences } from '../preferences';

export interface PreferencesState {
  preferences: PatientPreferences | undefined;
  loading: boolean;
  /** Human-readable reason the last load or save failed. */
  errorMessage: string | undefined;
  saving: boolean;
  /** True briefly after a successful save, for confirmation copy. */
  justSaved: boolean;
  save: (next: PatientPreferences) => Promise<boolean>;
  reload: () => void;
}

function describe(error: unknown): string {
  if (error instanceof PreferencesApiError) {
    if (error.status === 401) return 'your session has expired — please sign in again';
    if (error.status === 403) return 'this account is not allowed to change these settings';
    if (error.status === 503) return 'we could not verify your access just now';
    return `the service returned an error (${error.status})`;
  }
  return 'we could not reach the Juniper service';
}

export function usePreferences(patientId: string | undefined): PreferencesState {
  const medplum = useMedplum();
  const [preferences, setPreferences] = useState<PatientPreferences>();
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const makeClient = useCallback(() => {
    if (!ENV.voiceApiUrl) return undefined;
    const token = medplum.getAccessToken();
    if (!token) return undefined;
    return new PreferencesClient({ baseUrl: ENV.voiceApiUrl, token });
  }, [medplum]);

  const reload = useCallback(() => {
    if (!patientId) return;
    const client = makeClient();
    if (!client) {
      setLoading(false);
      setErrorMessage('call settings are unavailable (the Juniper service is not configured)');
      return;
    }
    setLoading(true);
    client
      .getPreferences(patientId)
      .then((result) => {
        setPreferences(result);
        setErrorMessage(undefined);
      })
      .catch((error) => setErrorMessage(describe(error)))
      .finally(() => setLoading(false));
  }, [makeClient, patientId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const save = useCallback(
    async (next: PatientPreferences): Promise<boolean> => {
      if (!patientId) return false;
      const client = makeClient();
      if (!client) {
        setErrorMessage('call settings are unavailable (the Juniper service is not configured)');
        return false;
      }
      setSaving(true);
      setErrorMessage(undefined);
      try {
        const stored = await client.putPreferences(patientId, next);
        setPreferences(stored);
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 4000);
        return true;
      } catch (error) {
        console.error('[juniper] saving preferences failed:', error);
        setErrorMessage(describe(error));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [makeClient, patientId]
  );

  return { preferences, loading, errorMessage, saving, justSaved, save, reload };
}

export const WEEKDAYS = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
] as const;

/** "Weekdays, 9:00 AM – 11:00 AM" — plain language for a caregiver. */
export function describeWindow(window: PatientPreferences['callWindows'][number]): string {
  const days = window.days ?? [];
  const isWeekdays =
    days.length === 5 && ['mon', 'tue', 'wed', 'thu', 'fri'].every((d) => days.includes(d as never));
  const isEveryDay = days.length === 7;
  const dayText = isEveryDay
    ? 'Every day'
    : isWeekdays
      ? 'Weekdays'
      : days.map((d) => WEEKDAYS.find((w) => w.key === d)?.label ?? d).join(', ') || 'No days set';
  return `${dayText}, ${to12Hour(window.start)} – ${to12Hour(window.end)}`;
}

export function to12Hour(hhmm: string): string {
  const [h, m] = (hhmm ?? '').split(':').map((n) => Number.parseInt(n, 10));
  if (Number.isNaN(h)) return hhmm ?? '';
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(Number.isNaN(m) ? 0 : m).padStart(2, '0')} ${period}`;
}
