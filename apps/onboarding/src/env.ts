/**
 * Environment configuration. EXPO_PUBLIC_* variables are inlined by Expo at
 * bundle time; see README.md for the full list.
 */
export const ENV = {
  /** Medplum base URL, e.g. https://api.medplum.com/ */
  medplumBaseUrl: process.env.EXPO_PUBLIC_MEDPLUM_BASE_URL ?? 'https://api.medplum.com/',
  /** OAuth ClientApplication id for the onboarding app. */
  medplumClientId: process.env.EXPO_PUBLIC_MEDPLUM_CLIENT_ID ?? '',
  /** Juniper voice service base URL (Preferences API, CONTRACTS.md section 1). */
  voiceApiUrl: process.env.EXPO_PUBLIC_VOICE_API_URL ?? '',
  /** Bearer token for the Preferences API (JUNIPER_API_TOKEN). */
  voiceApiToken: process.env.EXPO_PUBLIC_VOICE_API_TOKEN ?? '',
} as const;

/** Native deep-link scheme; must match app.json "scheme". */
export const APP_SCHEME = 'juniper-onboarding';
