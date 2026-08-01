/**
 * Who is signed in, and whose check-ins are we reading?
 *
 * The profile is a RelatedPerson (a caregiver on the patient's CareTeam); the
 * monitored patient comes from RelatedPerson.patient. Server-side AccessPolicy
 * does the real scoping (CareTeam-derived) — this app just reads what it is
 * allowed to read and renders empty/denied results gracefully.
 */
import { useMedplumProfile, useResource } from '@medplum/react-hooks';
import type { Patient } from '@medplum/fhirtypes';

export interface MonitoredPatient {
  /** e.g. "Patient/abc" — undefined while signed out or for non-caregiver profiles. */
  patientRef: string | undefined;
  patient: Patient | undefined;
  signedIn: boolean;
}

export function useMonitoredPatient(): MonitoredPatient {
  const profile = useMedplumProfile();
  let patientRef: string | undefined;
  if (profile?.resourceType === 'RelatedPerson') {
    patientRef = profile.patient?.reference;
  } else if (profile?.resourceType === 'Patient') {
    // A patient viewing their own record is harmless and read-only.
    patientRef = `Patient/${profile.id}`;
  }
  const patient = useResource<Patient>(patientRef ? { reference: patientRef } : undefined);
  return { patientRef, patient, signedIn: profile !== undefined };
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
