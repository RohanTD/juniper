/**
 * Environment configuration. EXPO_PUBLIC_* variables are inlined by Expo at
 * bundle time; see README.md.
 */
export const ENV = {
  /** Medplum base URL, e.g. https://api.medplum.com/ */
  medplumBaseUrl: process.env.EXPO_PUBLIC_MEDPLUM_BASE_URL ?? 'https://api.medplum.com/',
  /** OAuth ClientApplication id for the family app. */
  medplumClientId: process.env.EXPO_PUBLIC_MEDPLUM_CLIENT_ID ?? '',
  /**
   * Juniper voice service base URL, for the call-preferences screen.
   * NOTE: no token here, deliberately. The caregiver's own Medplum access
   * token is sent instead, and the service checks with Medplum whether that
   * user may read the patient. A shared service token shipped in a caregiver
   * app would be a master key over every patient's preferences.
   */
  voiceApiUrl: process.env.EXPO_PUBLIC_VOICE_API_URL ?? '',
} as const;

/** Native deep-link scheme; must match app.json "scheme". */
export const APP_SCHEME = 'juniper-family';
