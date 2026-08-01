/**
 * The family-side acknowledgement client, and the boundary it exists to keep.
 *
 * The escalation Task is addressed to the CARE TEAM. A caregiver marking it
 * `completed` would tell every later reader that a clinician acted — so
 * "mark as seen" must go to the voice service's app-level store and touch no
 * FHIR resource at all. These tests pin that at the wire level, which is the
 * only place it can be checked without a server.
 */
import { AcknowledgementsClient } from '../src/acknowledgements';
import { VoiceApiError, describeVoiceApiError } from '../src/voiceApi';

interface Call {
  url: string;
  method: string;
  body?: string;
  headers: Record<string, string>;
}

function fakeFetch(response: { status?: number; body?: unknown }) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit = {}) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: init.body as string | undefined,
      headers: (init.headers ?? {}) as Record<string, string>,
    });
    const status = response.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => response.body ?? { acknowledgements: [] },
    };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const client = (fetchImpl: typeof fetch) =>
  new AcknowledgementsClient({
    baseUrl: 'https://voice.example/',
    token: 'caregiver-medplum-token',
    fetchImpl,
  });

describe('AcknowledgementsClient', () => {
  it('talks to the app-level store and never to a FHIR endpoint', async () => {
    const { impl, calls } = fakeFetch({});
    await client(impl).getAcknowledgements('pat-1');
    expect(calls[0].url).toBe('https://voice.example/patients/pat-1/alert-acknowledgements');
    expect(calls[0].url).not.toMatch(/fhir|\/Task\b/i);
  });

  it('sends the caregiver’s OWN token, never a shared service secret', async () => {
    const { impl, calls } = fakeFetch({});
    await client(impl).getAcknowledgements('pat-1');
    expect(calls[0].headers.Authorization).toBe('Bearer caregiver-medplum-token');
  });

  it('escapes the patient id so a crafted id cannot reach another route', async () => {
    const { impl, calls } = fakeFetch({});
    await client(impl).getAcknowledgements('pat/../other');
    expect(calls[0].url).toContain('pat%2F..%2Fother');
  });

  it('PUTs the whole set, so an accidental acknowledgement can be undone', async () => {
    const { impl, calls } = fakeFetch({ body: { acknowledgements: [] } });
    await client(impl).putAcknowledgements('pat-1', { acknowledgements: [] });
    expect(calls[0].method).toBe('PUT');
    expect(JSON.parse(calls[0].body as string)).toEqual({ acknowledgements: [] });
  });

  it('writes nothing resembling a Task status change', async () => {
    const { impl, calls } = fakeFetch({ body: { acknowledgements: [] } });
    await client(impl).putAcknowledgements('pat-1', {
      acknowledgements: [{ taskId: 'task-1', acknowledgedAt: '2026-08-01T23:10:00Z' }],
    });
    const body = calls[0].body as string;
    expect(body).not.toMatch(/"status"/);
    expect(body).not.toMatch(/"resourceType"/);
    expect(body).not.toMatch(/completed/);
  });

  it('raises a typed error a screen can turn into plain language', async () => {
    const { impl } = fakeFetch({ status: 403 });
    await expect(client(impl).getAcknowledgements('pat-2')).rejects.toBeInstanceOf(VoiceApiError);
  });
});

describe('describeVoiceApiError', () => {
  it('never shows a caregiver an HTTP status', () => {
    expect(describeVoiceApiError(new VoiceApiError(401, 'x'))).toContain('sign in again');
    expect(describeVoiceApiError(new VoiceApiError(403, 'x'))).toContain('not allowed');
    expect(describeVoiceApiError(new VoiceApiError(503, 'x'))).toContain('verify your access');
    expect(describeVoiceApiError(new TypeError('network down'))).toContain('could not reach');
  });
});
