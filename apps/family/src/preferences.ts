/**
 * Tiny typed client for the voice service's Preferences API
 * (docs/CONTRACTS.md section 1). Call windows, topics to avoid and proxy
 * provenance have no FHIR home; they live in the voice service's app-level
 * store so the Companion can change them by voice later.
 */

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

export class PreferencesApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'PreferencesApiError';
  }
}

export interface PreferencesClientOptions {
  /** Voice service base URL. */
  baseUrl: string;
  /** JUNIPER_API_TOKEN bearer token. */
  token: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

export class PreferencesClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: PreferencesClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private url(patientId: string): string {
    return `${this.baseUrl}/patients/${encodeURIComponent(patientId)}/preferences`;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  async getPreferences(patientId: string): Promise<PatientPreferences> {
    const response = await this.fetchImpl(this.url(patientId), {
      method: 'GET',
      headers: this.headers(),
    });
    if (!response.ok) {
      throw new PreferencesApiError(response.status, `GET preferences failed: ${response.status}`);
    }
    return (await response.json()) as PatientPreferences;
  }

  async putPreferences(
    patientId: string,
    preferences: PatientPreferences
  ): Promise<PatientPreferences> {
    const response = await this.fetchImpl(this.url(patientId), {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify(preferences),
    });
    if (!response.ok) {
      throw new PreferencesApiError(response.status, `PUT preferences failed: ${response.status}`);
    }
    return (await response.json()) as PatientPreferences;
  }
}
