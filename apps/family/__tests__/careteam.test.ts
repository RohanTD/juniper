/**
 * Care-team contacts, and the access boundary that shapes them.
 *
 * The caregiver AccessPolicy is a strict allow-list that does NOT include
 * CareTeam or Practitioner, so a clinician's name can only ever reach this app
 * as display text riding along on a resource the caregiver may read. These
 * tests pin that: the sources are the readable ones, and where a phone number
 * genuinely is not available the module reports the absence instead of
 * inventing something a frightened caregiver would dial at 11pm.
 */
import type { Patient, Task } from '@medplum/fhirtypes';
import {
  careContacts,
  hasReachableNumber,
  NO_CONTACT_NOTE,
  NO_NUMBER_NOTE,
} from '../src/data/careteam';

const seededPatient: Patient = {
  resourceType: 'Patient',
  id: 'pat-1',
  name: [{ use: 'official', family: 'Alvarez', given: ['Margaret'] }],
  // The seed's shape: a Reference display, with the Practitioner itself
  // unreadable under the caregiver policy.
  generalPractitioner: [{ reference: 'Practitioner/pr-1', display: 'Dr. Priya Chen' }],
};

const task = (owner?: { reference: string; display?: string }): Task =>
  ({
    resourceType: 'Task',
    id: 'task-1',
    status: 'requested',
    intent: 'order',
    ...(owner ? { owner } : {}),
  }) as Task;

describe('careContacts', () => {
  it('reads the general practitioner from the reference display', () => {
    const contacts = careContacts(seededPatient, []);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      name: 'Dr. Priya Chen',
      role: 'Primary care physician',
      source: 'general-practitioner',
    });
  });

  it('does NOT invent a phone number for a Practitioner it cannot read', () => {
    const contacts = careContacts(seededPatient, []);
    expect(contacts[0].phone).toBeUndefined();
    expect(hasReachableNumber(contacts)).toBe(false);
  });

  it('reads Patient.contact in full, telecom included — Patient IS readable', () => {
    const contacts = careContacts(
      {
        ...seededPatient,
        contact: [
          {
            name: { given: ['Carmen'], family: 'Reyes' },
            relationship: [{ text: 'Daughter' }],
            telecom: [
              { system: 'phone', value: '+1-301-555-0186' },
              { system: 'email', value: 'carmen.reyes@example.com' },
            ],
          },
        ],
      },
      []
    );
    expect(contacts[0]).toMatchObject({
      name: 'Carmen Reyes',
      role: 'Daughter',
      phone: '+1-301-555-0186',
      email: 'carmen.reyes@example.com',
      source: 'patient-contact',
    });
    expect(hasReachableNumber(contacts)).toBe(true);
  });

  it('surfaces the alert owner when the Task reference carries a display', () => {
    const contacts = careContacts(undefined, [task({ reference: 'Practitioner/pr-1', display: 'Dr. Priya Chen' })]);
    expect(contacts).toEqual([
      { name: 'Dr. Priya Chen', role: 'Handling the latest alert', source: 'alert-owner' },
    ]);
  });

  it('degrades silently when the owner reference has no display', () => {
    // The voice service is not required to write one; a blank row would be
    // worse than no row.
    expect(careContacts(undefined, [task({ reference: 'Practitioner/pr-1' })])).toEqual([]);
    expect(careContacts(undefined, [task()])).toEqual([]);
  });

  it('does not list the same person twice from two sources', () => {
    const contacts = careContacts(seededPatient, [
      task({ reference: 'Practitioner/pr-1', display: 'Dr. Priya Chen' }),
    ]);
    expect(contacts).toHaveLength(1);
    // First source wins, so the richer role survives.
    expect(contacts[0].role).toBe('Primary care physician');
  });

  it('returns nothing at all when no readable resource names anyone', () => {
    expect(careContacts({ resourceType: 'Patient' } as Patient, [])).toEqual([]);
    expect(careContacts(undefined, undefined)).toEqual([]);
  });
});

describe('the honest disclosures', () => {
  it('name the emergency route rather than leaving a caregiver stuck', () => {
    expect(NO_NUMBER_NOTE).toContain('911');
    expect(NO_CONTACT_NOTE).toContain('911');
  });

  it('say plainly that the app cannot read the directory, not that none exists', () => {
    expect(NO_NUMBER_NOTE).toMatch(/not permitted to read/);
  });
});
