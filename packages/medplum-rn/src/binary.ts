/**
 * Resolve a DocumentReference attachment (content.attachment.url ->
 * Binary/<id>) to plain text, working on both native and web.
 *
 * Reading the Binary as FHIR JSON returns either inline base64 `data` or a
 * `url` to the raw content; both paths are handled without relying on
 * Blob.text() (absent in some RN runtimes) or atob.
 */
import type { MedplumClient } from '@medplum/core';

/**
 * Extract the Binary id from an attachment URL, in either shape Medplum uses.
 *
 * There are two, and only one of them was handled:
 *
 *   FHIR reference   Binary/f1278439-2f1b-49f7-b872-e96e34553138
 *   presigned URL    https://storage.medplum.com/binary/<id>/<versionId>?Expires=…
 *
 * The second is what a *reader* actually gets. Medplum rewrites
 * `content.attachment.url` into a short-lived presigned URL when it serves a
 * DocumentReference, and it spells the path segment `binary` in lower case.
 * The original pattern was case-sensitive on `Binary/`, so it matched the
 * reference form and never the served form — which is the only form the family
 * app ever sees.
 */
export function binaryIdFromUrl(url: string): string | undefined {
  const match = /\bbinary\/([A-Za-z0-9\-.]{1,64})/i.exec(url);
  return match?.[1];
}

/** True for an absolute http(s) URL — i.e. a presigned link we can just GET. */
export function isPresignedUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** Decode base64 to a UTF-8 string without atob/Buffer (pure TS). */
export function decodeBase64(base64: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes: number[] = [];
  for (let i = 0; i + 1 < clean.length; i += 4) {
    const n1 = alphabet.indexOf(clean[i]);
    const n2 = alphabet.indexOf(clean[i + 1]);
    const n3 = i + 2 < clean.length ? alphabet.indexOf(clean[i + 2]) : -1;
    const n4 = i + 3 < clean.length ? alphabet.indexOf(clean[i + 3]) : -1;
    bytes.push(((n1 << 2) | (n2 >> 4)) & 0xff);
    if (n3 >= 0) {
      bytes.push(((n2 << 4) | (n3 >> 2)) & 0xff);
    }
    if (n4 >= 0) {
      bytes.push(((n3 << 6) | n4) & 0xff);
    }
  }
  // UTF-8 decode
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i];
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
      i += 1;
    } else if (b0 < 0xe0) {
      out += String.fromCharCode(((b0 & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if (b0 < 0xf0) {
      out += String.fromCharCode(
        ((b0 & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f)
      );
      i += 3;
    } else {
      const cp =
        ((b0 & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f);
      out += String.fromCodePoint(cp);
      i += 4;
    }
  }
  return out;
}

/**
 * Fetch a Binary's content through the FHIR API, with the caller's own token.
 *
 * `GET /fhir/R4/Binary/<id>` returns the stored bytes, not a FHIR resource, so
 * this reads the body as text rather than parsing JSON — the same trap that
 * raised "Expecting value: line 1 column 1" on the Python side.
 */
async function readBinaryViaApi(medplum: MedplumClient, id: string): Promise<string> {
  const base = medplum.getBaseUrl().replace(/\/+$/, '');
  const token = medplum.getAccessToken();
  const response = await fetch(`${base}/fhir/R4/Binary/${id}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) {
    throw new Error(`Failed to read Binary/${id}: HTTP ${response.status}`);
  }
  return response.text();
}

/**
 * Read the text content behind a Binary attachment URL.
 *
 * **The API first, the presigned link second** — and that order is load-bearing
 * on the web. Medplum's CDN serves presigned URLs without an
 * `Access-Control-Allow-Origin` header, so a browser blocks the request
 * outright:
 *
 *     Access to fetch at 'https://storage.medplum.com/binary/…' from origin
 *     'http://localhost:8081' has been blocked by CORS policy
 *
 * Fetching the signed link first therefore cost a guaranteed failure on every
 * summary before falling back. Going through the API instead reuses the origin
 * the client already talks to, carries the caller's token, and is subject to
 * the same AccessPolicy as everything else — a caregiver can read a
 * family-summary Binary because its securityContext points at a document they
 * may read, and is refused a clinical note's for the same reason.
 *
 * The presigned link stays as the fallback: native runtimes have no CORS to
 * answer to, and it still works where a token is unavailable.
 */
export async function readBinaryText(medplum: MedplumClient, url: string): Promise<string> {
  const id = binaryIdFromUrl(url);
  if (id) {
    try {
      return await readBinaryViaApi(medplum, id);
    } catch {
      // Fall through to the signed link rather than failing outright.
    }
  }

  if (isPresignedUrl(url)) {
    const response = await fetch(url);
    if (response.ok) {
      return response.text();
    }
    throw new Error(`Failed to fetch Binary content: HTTP ${response.status}`);
  }

  throw new Error(`Not a Binary attachment URL: ${url}`);
}
