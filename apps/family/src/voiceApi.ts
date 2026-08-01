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
  /** Override the request deadline; see REQUEST_TIMEOUT_MS. */
  timeoutMs?: number;
}

/**
 * How long to wait before giving up on the voice service.
 *
 * `fetch` has no default timeout. A host that *refuses* a connection fails
 * fast and reads as an error; a host that simply swallows the packets — a
 * laptop asleep, a VPN, a dev server bound to the wrong interface, an emulator
 * that cannot see `localhost` — never resolves at all. The screen then sits on
 * "Loading…" or "Saving…" indefinitely, which is the worst of the three
 * outcomes: the user cannot retry, cannot tell it has failed, and has no
 * reason to think anything is wrong.
 */
export const REQUEST_TIMEOUT_MS = 15000;

/**
 * Plain-language reason a load or save failed. A caregiver should never see an
 * HTTP status; they should see what to do about it.
 */
export function describeVoiceApiError(error: unknown): string {
  if (error instanceof VoiceApiError) {
    if (error.status === 401) return 'your session has expired — please sign in again';
    if (error.status === 403) return 'this account is not allowed to change these settings';
    if (error.status === 503) return 'we could not verify your access just now';
    if (error.status === 0) return 'the Juniper service did not respond in time';
    return `the service returned an error (${error.status})`;
  }
  return 'we could not reach the Juniper service';
}

/** Base for the tiny typed clients below — URL joining, auth headers, errors. */
export abstract class VoiceApiClient {
  protected readonly baseUrl: string;
  protected readonly token: string;
  protected readonly fetchImpl: typeof fetch;
  protected readonly timeoutMs: number;

  constructor(options: VoiceApiOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    // `fetch.bind(globalThis)`, never a bare `fetch`.
    //
    // Storing the browser's fetch as an instance property and calling it as
    // `this.fetchImpl(...)` invokes it with THIS CLIENT as the receiver, and
    // the DOM binding requires `window`:
    //
    //     TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation
    //
    // It throws before any request is made, so it presents exactly like an
    // unreachable service — which is what it was mistaken for. Node and the
    // React Native polyfill are both lenient about the receiver, so this only
    // ever fails on web, and only at runtime.
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
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
    // Status 0 is not a real HTTP status; it is this client's way of saying
    // "no response at all", so callers can distinguish a service that said no
    // from a service that never spoke.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...init,
        headers: this.headers(),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new VoiceApiError(0, `${label} timed out after ${this.timeoutMs}ms`);
      }
      // A fetch that THROWS never reached the service: the browser refused to
      // send it (cross-origin), or nothing was listening. Both surface to the
      // user as the same sentence, so log what was actually attempted —
      // without this the only clue was "we could not reach the Juniper
      // service", which is equally true of a dead server and a blocked one.
      const origin = typeof location !== 'undefined' ? location.origin : 'native';
      console.error(
        `[juniper] ${label} never reached the service.\n` +
          `  from origin: ${origin}\n` +
          `  to:          ${url}\n` +
          `  cause:       ${error instanceof Error ? error.message : String(error)}\n` +
          '  A TypeError here is a bug in this client, not an environment problem. ' +
          'Otherwise: the service may not be running, or this origin may not be ' +
          'allowed by JUNIPER_CORS_ORIGINS / JUNIPER_CORS_ORIGIN_REGEX — a browser ' +
          'blocks a disallowed origin before the request leaves, so the service log ' +
          'stays empty either way.',
        error
      );
      throw error;
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      throw new VoiceApiError(response.status, `${label} failed: ${response.status}`);
    }
    return (await response.json()) as T;
  }
}
