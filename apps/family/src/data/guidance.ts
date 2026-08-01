/**
 * Fetching the family guidance document.
 *
 * Read-only, and read exactly like the family summary: one
 * `DocumentReference` of an allowed category, resolved through the presigned
 * attachment URL. The app does no reasoning of its own here and could not —
 * the material guidance is derived from, clinical notes across many calls, is
 * hidden from this reader by the AccessPolicy. That is precisely why the voice
 * service generates it and the app only renders the result.
 *
 * Consent-gated at generation, so an absent document is the normal state for a
 * patient who has not agreed to family sharing, not an error.
 */
import { readBinaryText } from '@juniper/medplum-rn';
import { categoryToken, NOTE_CATEGORY } from '@juniper/terminology';
import { useMedplum } from '@medplum/react-hooks';
import { useEffect, useState } from 'react';
import type { GuidanceDocument, GuidanceState } from '../guidance';

export * from '../guidance';

export function useGuidance(patientRef: string | undefined): GuidanceState {
  const medplum = useMedplum();
  const [state, setState] = useState<GuidanceState>({
    guidance: undefined,
    loading: true,
    absent: false,
    error: false,
  });

  useEffect(() => {
    if (!patientRef) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const document = await medplum.searchOne('DocumentReference', {
          subject: patientRef,
          category: categoryToken(NOTE_CATEGORY.familyGuidance),
          _sort: '-date',
        });
        if (!document) {
          if (!cancelled) {
            setState({ guidance: undefined, loading: false, absent: true, error: false });
          }
          return;
        }
        const url = document.content?.[0]?.attachment?.url;
        const text = url ? await readBinaryText(medplum, url) : '';
        // A malformed document is a bug on our side, never something to throw
        // at a caregiver — it degrades to "nothing to suggest yet".
        const parsed = text ? (JSON.parse(text) as GuidanceDocument) : undefined;
        if (!cancelled) {
          setState({
            guidance: parsed,
            loading: false,
            absent: !parsed,
            error: false,
          });
        }
      } catch {
        if (!cancelled) {
          setState({ guidance: undefined, loading: false, absent: false, error: true });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [medplum, patientRef]);

  return state;
}
