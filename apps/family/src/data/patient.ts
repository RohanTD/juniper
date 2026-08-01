/**
 * Who is signed in, and whose check-ins are we reading?
 *
 * ## Three kinds of signed-in profile, not one
 *
 * The app was written for a single shape — a `RelatedPerson` caregiver, whose
 * monitored patient is simply `RelatedPerson.patient`. That is the real
 * product, and server-side AccessPolicy does the real scoping (CareTeam-derived
 * and parameterized on `%patient`); this file only decides what to *ask* for.
 *
 * But two other profiles sign in during development and in a clinic, and both
 * used to resolve to `patientRef === undefined`, which every hook below treats
 * as "don't query". The result was a dashboard that rendered perfectly and
 * showed nothing at all — no error, no explanation, indistinguishable from a
 * patient who has never been called. That is the failure this module now
 * prevents:
 *
 * - **`RelatedPerson`** — a caregiver. Bound to exactly one patient, forever.
 *   Never offered a choice; the choice was made by their CareTeam membership.
 * - **`Patient`** — someone viewing their own record. Harmless and read-only.
 * - **`Practitioner` / anything else** — clinic staff or a project admin, with
 *   no single patient implied. They pick one, and the pick is remembered.
 *
 * The distinction is deliberate: a caregiver must NEVER see a patient picker,
 * because being able to choose implies there is something to choose between.
 * `profileKind` is what the UI branches on, so that stays impossible by
 * construction rather than by remembering to check.
 */
import { useMedplumProfile, useResource } from '@medplum/react-hooks';
import type { Patient } from '@medplum/fhirtypes';
import { useCallback, useSyncExternalStore } from 'react';

export type ProfileKind = 'caregiver' | 'patient' | 'staff' | 'signed-out';

export interface MonitoredPatient {
  /** e.g. "Patient/abc" — undefined when staff have not picked one yet. */
  patientRef: string | undefined;
  patient: Patient | undefined;
  signedIn: boolean;
  profileKind: ProfileKind;
  /** True when the UI should offer a patient picker (staff only). */
  canChoosePatient: boolean;
  /** Choose (or clear) the patient staff are looking at. No-op for caregivers. */
  choosePatient: (ref: string | undefined) => void;
}

/**
 * Staff's chosen patient, persisted so a page reload does not dump them back on
 * an empty dashboard.
 *
 * A module-level store rather than a context provider: `_layout.tsx` renders
 * `<Stack>` directly and every consumer is a leaf screen, so a provider would
 * be ceremony around one string. `useSyncExternalStore` keeps every screen in
 * step when the pick changes.
 *
 * Scoped by nothing on purpose — it is a *view* preference, not an entitlement.
 * Choosing a patient grants no access whatsoever: the request still goes to
 * Medplum and still fails if the AccessPolicy says so.
 */
const STORAGE_KEY = 'juniper.family.selectedPatient';

let selectedPatient: string | undefined = readStoredSelection();
const listeners = new Set<() => void>();

function readStoredSelection(): string | undefined {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    // Native, or a browser with storage disabled. The pick simply does not
    // survive a reload; nothing else changes.
    return undefined;
  }
}

function setSelectedPatient(ref: string | undefined): void {
  selectedPatient = ref;
  try {
    if (ref) {
      globalThis.localStorage?.setItem(STORAGE_KEY, ref);
    } else {
      globalThis.localStorage?.removeItem(STORAGE_KEY);
    }
  } catch {
    /* see readStoredSelection */
  }
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Cleared on sign-out so the next person to use this browser starts blank. */
export function clearSelectedPatient(): void {
  setSelectedPatient(undefined);
}

/** Which of the three shapes is signed in. Exported for tests and for the UI. */
export function profileKindOf(resourceType: string | undefined): ProfileKind {
  if (!resourceType) return 'signed-out';
  if (resourceType === 'RelatedPerson') return 'caregiver';
  if (resourceType === 'Patient') return 'patient';
  return 'staff';
}

export function useMonitoredPatient(): MonitoredPatient {
  const profile = useMedplumProfile();
  const chosen = useSyncExternalStore(
    subscribe,
    () => selectedPatient,
    () => undefined // server render: nothing chosen yet
  );
  const profileKind = profileKindOf(profile?.resourceType);

  let patientRef: string | undefined;
  if (profileKind === 'caregiver') {
    patientRef = (profile as { patient?: { reference?: string } }).patient?.reference;
  } else if (profileKind === 'patient') {
    patientRef = `Patient/${profile?.id}`;
  } else if (profileKind === 'staff') {
    patientRef = chosen;
  }

  const patient = useResource<Patient>(patientRef ? { reference: patientRef } : undefined);

  const choosePatient = useCallback(
    (ref: string | undefined) => {
      // Guarded here rather than at every call site: a caregiver's patient is
      // decided by their CareTeam, and nothing in this app may override it.
      if (profileKind !== 'staff') return;
      setSelectedPatient(ref);
    },
    [profileKind]
  );

  return {
    patientRef,
    patient,
    signedIn: profile !== undefined,
    profileKind,
    canChoosePatient: profileKind === 'staff',
    choosePatient,
  };
}

/** Preferred name first (name.use = nickname), then official given name. */
export function patientFirstName(patient: Patient | undefined): string {
  if (!patient?.name) {
    return 'your loved one';
  }
  const nickname = patient.name.find((n) => n.use === 'nickname')?.given?.[0];
  if (nickname) {
    return nickname;
  }
  const official = patient.name.find((n) => n.use === 'official') ?? patient.name[0];
  return official?.given?.[0] ?? 'your loved one';
}

/** Full display name for a picker row: "Margaret Alvarez (Peggy)". */
export function patientDisplayName(patient: Patient): string {
  const official = patient.name?.find((n) => n.use === 'official') ?? patient.name?.[0];
  const full = [official?.given?.join(' '), official?.family].filter(Boolean).join(' ').trim();
  const nickname = patient.name?.find((n) => n.use === 'nickname')?.given?.[0];
  const base = full || patient.id || 'Unnamed patient';
  return nickname && nickname !== official?.given?.[0] ? `${base} (${nickname})` : base;
}
