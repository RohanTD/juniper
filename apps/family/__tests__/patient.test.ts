/**
 * Profile resolution — the fix for a dashboard that rendered perfectly and
 * showed nothing.
 *
 * `useMonitoredPatient` used to understand two profile shapes. Anything else
 * (a Practitioner, a project admin — the accounts actually used to develop and
 * operate this) fell through to `patientRef === undefined`, which every data
 * hook reads as "don't query". No error was raised, so the screen was
 * indistinguishable from a patient who had never been called.
 */
import type { Patient } from '@medplum/fhirtypes';
import { patientDisplayName, patientFirstName, profileKindOf } from '../src/data/patient';

describe('profileKindOf', () => {
  test('a RelatedPerson is a caregiver — bound to one patient by their CareTeam', () => {
    expect(profileKindOf('RelatedPerson')).toBe('caregiver');
  });

  test('a Patient is viewing their own record', () => {
    expect(profileKindOf('Patient')).toBe('patient');
  });

  test('a Practitioner is staff, not a dead end', () => {
    // The regression this file exists for: previously this produced no patient
    // reference at all and the dashboard silently emptied itself.
    expect(profileKindOf('Practitioner')).toBe('staff');
  });

  test('an unrecognised profile is treated as staff rather than as nobody', () => {
    // Erring toward "staff" means an unexpected profile gets a patient picker
    // and an explanation. Erring the other way reproduces the original bug.
    expect(profileKindOf('ClientApplication')).toBe('staff');
    expect(profileKindOf('Organization')).toBe('staff');
  });

  test('no profile is signed out', () => {
    expect(profileKindOf(undefined)).toBe('signed-out');
  });
});

describe('patient names', () => {
  const peggy: Patient = {
    resourceType: 'Patient',
    id: 'p1',
    name: [
      { use: 'official', given: ['Margaret', 'Jane'], family: 'Alvarez' },
      { use: 'nickname', given: ['Peggy'] },
    ],
  };

  test('the preferred name wins for greeting copy', () => {
    expect(patientFirstName(peggy)).toBe('Peggy');
  });

  test('a picker row shows the legal name with the nickname alongside', () => {
    expect(patientDisplayName(peggy)).toBe('Margaret Jane Alvarez (Peggy)');
  });

  test('no nickname means no redundant parenthetical', () => {
    expect(
      patientDisplayName({
        resourceType: 'Patient',
        id: 'p2',
        name: [{ use: 'official', given: ['Harold'], family: 'Nakamura' }],
      })
    ).toBe('Harold Nakamura');
  });

  test('an unnamed patient still renders something selectable', () => {
    expect(patientDisplayName({ resourceType: 'Patient', id: 'p3' })).toBe('p3');
  });

  test('a missing patient falls back to warm generic copy, never a blank', () => {
    expect(patientFirstName(undefined)).toBe('your loved one');
  });
});
