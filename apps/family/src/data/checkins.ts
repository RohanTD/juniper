/**
 * Check-in data, read EXCLUSIVELY per docs/CONTRACTS.md section 2:
 *
 *   Timeline:  Encounter?subject=...&reason-code=juniper-4m-checkin&_sort=-date
 *   Summary:   DocumentReference?encounter=...&category=<familySummary> -> Binary
 *
 * The caregiver AccessPolicy admits only the family-summary category; the
 * clinical note and raw transcript are excluded server-side and NO code path
 * here may reference them (a lint test enforces it).
 */
import { readBinaryText } from '@juniper/medplum-rn';
import { categoryToken, ENCOUNTER_REASON, NOTE_CATEGORY } from '@juniper/terminology';
import type { Encounter } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react-hooks';
import { useCallback, useEffect, useState } from 'react';

export interface CheckInsState {
  encounters: Encounter[] | undefined;
  loading: boolean;
  /** True when the server denied or errored — render gently, not as a crash. */
  error: boolean;
  refresh: () => void;
}

export function useCheckIns(patientRef: string | undefined): CheckInsState {
  const medplum = useMedplum();
  const [encounters, setEncounters] = useState<Encounter[]>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = useCallback(() => {
    if (!patientRef) {
      return;
    }
    setLoading(true);
    medplum
      .searchResources('Encounter', {
        subject: patientRef,
        'reason-code': categoryToken(ENCOUNTER_REASON.fourMCheckIn),
        _sort: '-date',
        _count: '100',
      })
      .then((results) => {
        setEncounters([...results]);
        setError(false);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [medplum, patientRef]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { encounters, loading, error, refresh };
}

export interface FamilySummaryState {
  loading: boolean;
  /** Plain-language summary text, when shared. */
  text: string | undefined;
  date: string | undefined;
  /** No summary exists — most likely the patient has not consented to sharing. */
  notShared: boolean;
  error: boolean;
}

export function useFamilySummary(encounterId: string | undefined): FamilySummaryState {
  const medplum = useMedplum();
  const [state, setState] = useState<FamilySummaryState>({
    loading: true,
    text: undefined,
    date: undefined,
    notShared: false,
    error: false,
  });

  useEffect(() => {
    if (!encounterId) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const document = await medplum.searchOne('DocumentReference', {
          encounter: `Encounter/${encounterId}`,
          category: categoryToken(NOTE_CATEGORY.familySummary),
        });
        if (!document) {
          if (!cancelled) {
            setState({ loading: false, text: undefined, date: undefined, notShared: true, error: false });
          }
          return;
        }
        const url = document.content?.[0]?.attachment?.url;
        const text = url ? await readBinaryText(medplum, url) : '';
        if (!cancelled) {
          setState({ loading: false, text, date: document.date, notShared: false, error: false });
        }
      } catch {
        if (!cancelled) {
          setState({ loading: false, text: undefined, date: undefined, notShared: false, error: true });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [medplum, encounterId]);

  return state;
}
