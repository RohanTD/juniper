/**
 * Shared plumbing for the two voice-service app-store surfaces the family app
 * talks to: call preferences (docs/CONTRACTS.md §1) and family-side alert
 * acknowledgements.
 *
 * Both send the caregiver's OWN Medplum access token — never a shared service
 * token — and the service asks Medplum whether that user may read the patient,
 * so entitlement stays derived from CareTeam membership. A service token
 * shipped inside a caregiver app would be a master key over every patient's
 * settings, since both routes are keyed only on a path parameter.
 */

export class VoiceApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'VoiceApiError';
  }
}

export interface VoiceApiOptions {
  /** Voice service base URL. */
  baseUrl: string;
  /** The caregiver's Medplum access token. */
  token: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Plain-language reason a load or save failed. A caregiver should never see an
 * HTTP status; they should see what to do about it.
 */
export function describeVoiceApiError(error: unknown): string {
  if (error instanceof VoiceApiError) {
    if (error.status === 401) return 'your session has expired — please sign in again';
    if (error.status === 403) return 'this account is not allowed to change these settings';
    if (error.status === 503) return 'we could not verify your access just now';
    return `the service returned an error (${error.status})`;
  }
  return 'we could not reach the Juniper service';
}

/** Base for the tiny typed clients below — URL joining, auth headers, errors. */
export abstract class VoiceApiClient {
  protected readonly baseUrl: string;
  protected readonly token: string;
  protected readonly fetchImpl: typeof fetch;

  constructor(options: VoiceApiOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  protected patientUrl(patientId: string, suffix: string): string {
    return `${this.baseUrl}/patients/${encodeURIComponent(patientId)}/${suffix}`;
  }

  protected headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  protected async request<T>(url: string, init: RequestInit, label: string): Promise<T> {
    const response = await this.fetchImpl(url, { ...init, headers: this.headers() });
    if (!response.ok) {
      throw new VoiceApiError(response.status, `${label} failed: ${response.status}`);
    }
    return (await response.json()) as T;
  }
}
