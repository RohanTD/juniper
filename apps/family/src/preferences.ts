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

export interface PatientPreferences {
  callWindows: CallWindow[];
  topicsToAvoid: string[];
  completedBy: CompletedBy;
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
