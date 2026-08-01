/**
 * Tiny typed client for the voice service's Preferences API
 * (docs/CONTRACTS.md section 1). Call windows, topics to avoid and proxy
 * provenance have no FHIR home; they live in the voice service's app-level
 * store so the Companion can change them by voice later.
 */
import { VoiceApiClient, VoiceApiError, type VoiceApiOptions } from './voiceApi';

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface CallWindow {
  days: Weekday[];
  /** 24h "HH:MM" local to `timezone`. */
  start: string;
  end: string;
  /** IANA timezone, e.g. "America/New_York". */
  timezone: string;
}

/**
 * Mirrors Consent.performer: proxy-captured preferences are a materially
 * different claim and must survive in both records.
 */
export type CompletedBy =
  | { role: 'patient' }
  | { role: 'proxy'; name: string; relationship: string };

/**
 * What the patient told Juniper at setup — legal name, birth date, the number
 * to dial, preferred name, language. Never written to the FHIR `Patient`: the
 * chart's demographics belong to the clinic, so Juniper keeps its own copy for
 * its own purposes.
 *
 * The family app neither renders nor edits this. It is here only so a
 * get → edit → put round-trip on the call-settings screen carries it back
 * untouched. (The service also preserves it when a body omits it, so a client
 * cannot delete the dial number by staying quiet — belt and braces, because
 * losing it means the patient stops being called at all.)
 */
export interface EnrollmentProfile {
  legalName?: { given: string; family: string };
  preferredName?: string;
  /** ISO date YYYY-MM-DD. */
  birthDate?: string;
  /** The number Juniper dials. */
  phone?: string;
  language?: { code: string; label: string };
}

export interface PatientPreferences {
  callWindows: CallWindow[];
  topicsToAvoid: string[];
  /**
   * What the patient enjoys. The counterpart to `topicsToAvoid`: that list is
   * a prohibition the compassion filter enforces, this one is an invitation
   * the Companion opens with. Kept here rather than in FHIR for the same
   * reason as the rest of this file — there is no FHIR home for "loves the
   * Sunday crossword", and inventing one would put non-clinical state into the
   * clinical record.
   */
  interests?: string[];
  completedBy: CompletedBy;
  enrollment?: EnrollmentProfile;
}

/**
 * Retained as a distinct type so existing `instanceof` checks keep working;
 * the behaviour lives on VoiceApiError, which the acknowledgements client
 * shares.
 */
export class PreferencesApiError extends VoiceApiError {
  constructor(status: number, message: string) {
    super(status, message);
    this.name = 'PreferencesApiError';
  }
}

export type PreferencesClientOptions = VoiceApiOptions;

export class PreferencesClient extends VoiceApiClient {
  private url(patientId: string): string {
    return this.patientUrl(patientId, 'preferences');
  }

  async getPreferences(patientId: string): Promise<PatientPreferences> {
    return this.request<PatientPreferences>(
      this.url(patientId),
      { method: 'GET' },
      'GET preferences'
    );
  }

  async putPreferences(
    patientId: string,
    preferences: PatientPreferences
  ): Promise<PatientPreferences> {
    return this.request<PatientPreferences>(
      this.url(patientId),
      { method: 'PUT', body: JSON.stringify(preferences) },
      'PUT preferences'
    );
  }
}
