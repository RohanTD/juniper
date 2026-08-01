/**
 * The default `fetch` must be callable.
 *
 * This is a regression test for a bug that cost several rounds of debugging
 * because it disguised itself as something else entirely.
 *
 * `this.fetchImpl = options.fetchImpl ?? fetch` stores the browser's fetch as
 * an instance property. Calling it as `this.fetchImpl(...)` then invokes it
 * with the *client* as its receiver, and the DOM binding refuses that:
 *
 *     TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation
 *
 * It throws before a request is made, so from the app's side it is
 * indistinguishable from a service that is down or an origin that is blocked —
 * and it was mistaken for both in turn, first for a missing CORS policy and
 * then for a permissions problem, while the real fault sat in the client and
 * would have failed against any origin, any server, any policy.
 *
 * Node's fetch and React Native's polyfill are both lenient about the
 * receiver, so a plain unit test passes with the bug present and only the web
 * build breaks. The fixture below therefore *enforces* what a browser
 * enforces: a global fetch that throws unless it is called on globalThis.
 */
import { VoiceApiClient, type VoiceApiOptions } from '../src/voiceApi';

class TestClient extends VoiceApiClient {
  constructor(options: VoiceApiOptions) {
    super(options);
  }
  run(url: string) {
    return this.request<{ ok: boolean }>(url, { method: 'GET' }, 'GET test');
  }
}

describe('the default fetch', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /** Stands in for the DOM binding, which checks its receiver. */
  function installStrictFetch() {
    const calls: string[] = [];
    function strictFetch(this: unknown, url: string) {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      calls.push(url);
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }
    globalThis.fetch = strictFetch as unknown as typeof fetch;
    return calls;
  }

  test('is invoked with the right receiver, not with the client', async () => {
    const calls = installStrictFetch();
    const client = new TestClient({ baseUrl: 'http://localhost:8000', token: 't' });

    await expect(client.run('http://localhost:8000/ping')).resolves.toEqual({ ok: true });
    expect(calls).toEqual(['http://localhost:8000/ping']);
  });

  test('the fixture would catch the bug — a bare reference really does throw', () => {
    installStrictFetch();
    // Proof the guard above is not vacuous: this is precisely what the client
    // used to do, and it must fail.
    const holder = { impl: globalThis.fetch };
    expect(() => holder.impl('http://localhost:8000/ping')).toThrow(/Illegal invocation/);
  });

  test('an injected fetch is still used unchanged', async () => {
    installStrictFetch();
    const injected = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const client = new TestClient({
      baseUrl: 'http://localhost:8000',
      token: 't',
      fetchImpl: injected as unknown as typeof fetch,
    });

    await client.run('http://localhost:8000/ping');
    expect(injected).toHaveBeenCalledTimes(1);
  });
});
