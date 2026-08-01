/**
 * MedplumClient factory shared by both Juniper Expo apps.
 *
 * Per docs/PLAN.md: `@medplum/core` + `@medplum/react-hooks` only — never
 * `@medplum/react`. Token storage is expo-secure-store (web: localStorage),
 * wired explicitly; auth is OAuth2/PKCE via expo-auth-session (see auth.ts).
 */
import { MedplumClient } from '@medplum/core';
import { ExpoClientStorage } from './storage';

export interface JuniperMedplumConfig {
  /** Medplum base URL, e.g. https://api.medplum.com/ */
  baseUrl: string;
  /** OAuth client id of the Medplum ClientApplication for this app. */
  clientId?: string;
}

/**
 * Create a MedplumClient backed by secure storage. Async because the native
 * storage adapter preloads persisted tokens before the client restores its
 * session.
 */
export async function createMedplumClient(config: JuniperMedplumConfig): Promise<MedplumClient> {
  const storage = new ExpoClientStorage();
  await storage.getInitPromise();
  return new MedplumClient({
    baseUrl: config.baseUrl,
    clientId: config.clientId,
    storage,
  });
}
