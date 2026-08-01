/**
 * Resolving a DocumentReference attachment URL.
 *
 * Regression test for the bug that stopped every check-in summary from
 * loading. Medplum serves `content.attachment.url` as a short-lived
 * **presigned** URL, and spells the path segment in lower case:
 *
 *     https://storage.medplum.com/binary/<id>/<versionId>?Expires=…&Signature=…
 *
 * The extractor matched `Binary/` case-sensitively, so it recognised the FHIR
 * reference form — the one written by the voice service — and never the served
 * form, which is the only form the family app ever receives. `readBinaryText`
 * therefore threw "Not a Binary attachment URL" before fetching anything, and
 * every summary rendered as an error.
 *
 * This matters more than a parsing nit: the presigned URL is the mechanism the
 * caregiver access model rests on. Medplum cannot scope `Binary` by search
 * criteria, so family-summary content reaches a caregiver *only* through the
 * signed link on a DocumentReference they may read (medplum/README.md).
 *
 * Imported by path because `@juniper/medplum-rn`'s entry point pulls in
 * expo-secure-store; `binary.ts` itself imports only a type.
 */
import { binaryIdFromUrl, isPresignedUrl } from '../../../packages/medplum-rn/src/binary';

/** A real URL shape, taken from the live project (signature truncated). */
const PRESIGNED =
  'https://storage.medplum.com/binary/f1278439-2f1b-49f7-b872-e96e34553138/' +
  '1310fde1-58cf-4776-ae8a-4b6c67418354?Expires=1785626316&Key-Pair-Id=K1PPSRCGJGLWV7&Signature=j2ys5k';

describe('binaryIdFromUrl', () => {
  test('reads the id out of a presigned URL — the form a caregiver actually gets', () => {
    expect(binaryIdFromUrl(PRESIGNED)).toBe('f1278439-2f1b-49f7-b872-e96e34553138');
  });

  test('still reads a plain FHIR reference', () => {
    expect(binaryIdFromUrl('Binary/f1278439-2f1b-49f7-b872-e96e34553138')).toBe(
      'f1278439-2f1b-49f7-b872-e96e34553138'
    );
  });

  test('handles an absolute FHIR URL', () => {
    expect(binaryIdFromUrl('https://api.medplum.com/fhir/R4/Binary/abc-123')).toBe('abc-123');
  });

  test('returns nothing for a URL that has no binary segment at all', () => {
    expect(binaryIdFromUrl('https://example.com/files/report.txt')).toBeUndefined();
    expect(binaryIdFromUrl('')).toBeUndefined();
  });

  test('does not match a segment that merely ends in "binary"', () => {
    // The word boundary keeps `.../notbinary/<id>` from being read as an id.
    expect(binaryIdFromUrl('https://example.com/notbinary/abc-123')).toBeUndefined();
  });
});

describe('isPresignedUrl', () => {
  test('an absolute http(s) URL can be fetched directly', () => {
    expect(isPresignedUrl(PRESIGNED)).toBe(true);
    expect(isPresignedUrl('http://localhost:8103/binary/abc')).toBe(true);
  });

  test('a bare FHIR reference cannot', () => {
    expect(isPresignedUrl('Binary/abc-123')).toBe(false);
  });
});
