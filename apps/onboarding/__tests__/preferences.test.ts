import {
  PreferencesApiError,
  PreferencesClient,
  type PatientPreferences,
} from '../src/preferences';

const samplePreferences: PatientPreferences = {
  callWindows: [
    { days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '11:00', timezone: 'America/New_York' },
  ],
  topicsToAvoid: ['her late husband Robert'],
  completedBy: { role: 'proxy', name: 'Anne Chen', relationship: 'daughter' },
};

function mockFetch(status: number, body: unknown): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

describe('PreferencesClient', () => {
  it('PUTs preferences to the contract URL with bearer auth', async () => {
    const fetchImpl = mockFetch(200, samplePreferences);
    const client = new PreferencesClient({
      baseUrl: 'https://voice.example.com/',
      token: 'secret-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await client.putPreferences('patient-123', samplePreferences);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://voice.example.com/patients/patient-123/preferences');
    expect(init.method).toBe('PUT');
    expect(init.headers.Authorization).toBe('Bearer secret-token');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual(samplePreferences);
    expect(result).toEqual(samplePreferences);
  });

  it('GETs preferences and returns the typed body', async () => {
    const fetchImpl = mockFetch(200, samplePreferences);
    const client = new PreferencesClient({
      baseUrl: 'https://voice.example.com',
      token: 't',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await client.getPreferences('p1');

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://voice.example.com/patients/p1/preferences');
    expect(init.method).toBe('GET');
    expect(result.completedBy.role).toBe('proxy');
    expect(result.callWindows[0].timezone).toBe('America/New_York');
  });

  it('URL-encodes the patient id', async () => {
    const fetchImpl = mockFetch(200, samplePreferences);
    const client = new PreferencesClient({
      baseUrl: 'https://voice.example.com',
      token: 't',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.getPreferences('weird/id');
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://voice.example.com/patients/weird%2Fid/preferences'
    );
  });

  it('throws PreferencesApiError with the HTTP status on failure', async () => {
    const fetchImpl = mockFetch(403, {});
    const client = new PreferencesClient({
      baseUrl: 'https://voice.example.com',
      token: 'bad',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.putPreferences('p1', samplePreferences)).rejects.toThrow(
      PreferencesApiError
    );
    await expect(client.getPreferences('p1')).rejects.toMatchObject({ status: 403 });
  });
});
