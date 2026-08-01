/**
 * Environment configuration. EXPO_PUBLIC_* variables are inlined by Expo at
 * bundle time; see README.md.
 */
export const ENV = {
  /** Medplum base URL, e.g. https://api.medplum.com/ */
  medplumBaseUrl: process.env.EXPO_PUBLIC_MEDPLUM_BASE_URL ?? 'https://api.medplum.com/',
  /** OAuth ClientApplication id for the family app. */
  medplumClientId: process.env.EXPO_PUBLIC_MEDPLUM_CLIENT_ID ?? '',
} as const;

/** Native deep-link scheme; must match app.json "scheme". */
export const APP_SCHEME = 'juniper-family';
