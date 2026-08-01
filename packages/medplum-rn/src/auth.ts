/**
 * OAuth2 Authorization Code + PKCE against Medplum's hosted auth, via
 * expo-auth-session. No password ever touches either app: the system browser
 * (or a popup on web) handles the credential; we exchange the code and hand
 * the tokens to MedplumClient.
 */
import type { MedplumClient, ProfileResource } from '@medplum/core';
import {
  AuthRequest,
  exchangeCodeAsync,
  makeRedirectUri,
  type DiscoveryDocument,
} from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

// Completes a pending browser auth session after the redirect lands back on
// the web app. No-op on native.
WebBrowser.maybeCompleteAuthSession();

/** Medplum's OAuth endpoints live at fixed paths under the base URL. */
export function medplumOAuthDiscovery(baseUrl: string): DiscoveryDocument {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    authorizationEndpoint: `${base}/oauth2/authorize`,
    tokenEndpoint: `${base}/oauth2/token`,
  };
}

export interface SignInOptions {
  clientId: string;
  /** Native deep-link scheme of the app, e.g. "juniper-family". */
  scheme: string;
  /** Redirect path, default "auth/callback". */
  path?: string;
}

/**
 * Run the full PKCE flow and sign the MedplumClient in.
 * Resolves to the signed-in profile (Patient in onboarding, RelatedPerson in
 * the family app), or undefined if the user dismissed the browser.
 */
export async function signInWithMedplum(
  medplum: MedplumClient,
  options: SignInOptions
): Promise<ProfileResource | undefined> {
  const discovery = medplumOAuthDiscovery(medplum.getBaseUrl());
  const redirectUri = makeRedirectUri({
    scheme: options.scheme,
    path: options.path ?? 'auth/callback',
  });
  const request = new AuthRequest({
    clientId: options.clientId,
    redirectUri,
    scopes: ['openid', 'profile'],
    usePKCE: true,
  });

  const result = await request.promptAsync(discovery);
  if (result.type !== 'success' || !result.params.code) {
    return undefined;
  }

  const tokens = await exchangeCodeAsync(
    {
      clientId: options.clientId,
      code: result.params.code,
      redirectUri,
      extraParams: { code_verifier: request.codeVerifier ?? '' },
    },
    discovery
  );

  medplum.setAccessToken(tokens.accessToken, tokens.refreshToken);
  return medplum.getProfileAsync();
}

/** Sign out locally: drop tokens and cached session state. */
export async function signOut(medplum: MedplumClient): Promise<void> {
  await medplum.signOut();
}
