/**
 * @juniper/medplum-rn — shared Medplum wiring for the Juniper Expo apps.
 *
 * Also ships (outside src/):
 *  - metro.js         — withJuniperMetro(config, projectRoot): monorepo paths + pdfmake stub
 *  - pdfmake-stub.js  — the empty module Metro resolves `pdfmake` to
 */
export { createMedplumClient, type JuniperMedplumConfig } from './client';
export { ExpoClientStorage } from './storage';
export {
  medplumOAuthDiscovery,
  signInWithMedplum,
  signOut,
  type SignInOptions,
} from './auth';
export { binaryIdFromUrl, decodeBase64, readBinaryText } from './binary';
