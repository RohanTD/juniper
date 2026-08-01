/**
 * "Who do I call?" — derived strictly from what a caregiver can actually read.
 *
 * PLAN.md is blunt about why this exists: *a caregiver seeing "urgent" on their
 * phone at 11pm with no context and no one to call is worse than useless.* The
 * alert's `description` supplies the context by contract; this module supplies
 * whatever can honestly be said about the "someone".
 *
 * ## What the caregiver AccessPolicy actually admits
 *
 * The policy (medplum/resources/access-policy-caregiver.json) is a strict
 * allow-list: their own Patient, their OWN RelatedPerson (`_id=%profile.id`),
 * check-in Encounters, escalation Tasks, family-summary DocumentReferences and
 * Binary. Practitioner is not on it — and neither is CareTeam. So:
 *
 * - `CareTeam.participant.member.display` is NOT reachable. The resource is
 *   denied outright, not field-filtered.
 * - `Practitioner.telecom` is NOT reachable, so a clinician's direct number
 *   cannot be shown however it is reached.
 * - What IS reachable is display text already embedded in resources the
 *   caregiver may read: `Patient.generalPractitioner[].display`,
 *   `Patient.contact[]` (a full BackboneElement, telecom included), and
 *   `Task.owner.display` on the alert itself.
 *
 * This module reads exactly those three and nothing else. Where a phone number
 * genuinely is not readable, the UI says so — an invented number on a screen a
 * frightened daughter reads at 11pm is the worst possible failure here.
 */
import type { HumanName, Patient, Task } from '@medplum/fhirtypes';

export type CareContactSource = 'patient-contact' | 'general-practitioner' | 'alert-owner';

export interface CareContact {
  name: string;
  /** "Primary care physician", "Daughter", "Assigned to this alert". */
  role?: string;
  /** Present only when a readable resource actually carried one. */
  phone?: string;
  email?: string;
  source: CareContactSource;
}

function humanName(name: HumanName | undefined): string | undefined {
  if (!name) {
    return undefined;
  }
  if (name.text) {
    return name.text;
  }
  const given = (name.given ?? []).join(' ').trim();
  const full = [name.prefix?.join(' '), given, name.family].filter(Boolean).join(' ').trim();
  return full || undefined;
}

/**
 * Care-team contacts, best-first, from readable fields only.
 *
 * `tasks` are the escalation alerts already loaded for the timeline — passing
 * them here adds no query, and `Task.owner.display` is the only place the
 * escalation target's name can surface for a caregiver.
 */
export function careContacts(
  patient: Patient | undefined,
  tasks: Task[] | undefined
): CareContact[] {
  const contacts: CareContact[] = [];
  const seen = new Set<string>();

  const add = (contact: CareContact | undefined): void => {
    if (!contact?.name) {
      return;
    }
    const key = contact.name.trim().toLowerCase();
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    contacts.push(contact);
  };

  // Patient.contact — the emergency/next-of-kin block. Readable in full,
  // telecom included, because Patient itself is readable.
  for (const entry of patient?.contact ?? []) {
    const telecom = entry.telecom ?? [];
    add({
      name: humanName(entry.name) ?? '',
      role:
        entry.relationship?.[0]?.text ??
        entry.relationship?.[0]?.coding?.[0]?.display ??
        entry.organization?.display,
      phone: telecom.find((t) => t.system === 'phone')?.value,
      email: telecom.find((t) => t.system === 'email')?.value,
      source: 'patient-contact',
    });
  }

  // Patient.generalPractitioner — a Reference whose `display` rides along on
  // the Patient. The Practitioner it points at is NOT readable, so this is a
  // name with no number, and the UI must say so rather than imply a tap-to-call.
  for (const practitioner of patient?.generalPractitioner ?? []) {
    add({
      name: practitioner.display ?? '',
      role: 'Primary care physician',
      source: 'general-practitioner',
    });
  }

  // Task.owner.display — whoever the escalation was routed to. Populated only
  // if the voice service wrote a display on the reference; absent is normal and
  // must degrade silently rather than render a blank row.
  for (const task of tasks ?? []) {
    add({
      name: task.owner?.display ?? '',
      role: 'Handling the latest alert',
      source: 'alert-owner',
    });
  }

  return contacts;
}

/** True when nothing readable carries a way to actually reach a person. */
export function hasReachableNumber(contacts: CareContact[]): boolean {
  return contacts.some((contact) => Boolean(contact.phone));
}

/**
 * The honest disclosure rendered when names are known but numbers are not.
 * Stated plainly rather than dressed up: the app cannot dial the clinic, and
 * pretending otherwise at 11pm is worse than admitting it.
 */
export const NO_NUMBER_NOTE =
  'Juniper cannot show clinic phone numbers here — they are part of the clinical directory this app is not permitted to read. Use the number you normally call, and 911 for an emergency.';

/** Shown when even a name is unavailable. */
export const NO_CONTACT_NOTE =
  'No care-team contact has been shared with this app. The care team manages who appears here. In an emergency, call 911.';
