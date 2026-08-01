/**
 * Where the in-progress onboarding draft is stored.
 *
 * **expo-secure-store, not AsyncStorage.** The task framing calls a draft
 * "non-secret", but this one is not: it holds a legal name, a date of birth, a
 * phone number, a family member's phone number, and free-text topics to avoid
 * — which is the single most sensitive field in the app ("her late husband
 * Robert", a diagnosis, a bereavement). That is identifiable health-adjacent
 * data sitting on a device that, by design, is handed back and forth between a
 * patient and a family member.
 *
 * Three reasons SecureStore wins here:
 *
 *  1. AsyncStorage on iOS is a plain file in the app container and is included
 *     in unencrypted local backups by default. SecureStore is Keychain /
 *     Android Keystore backed, and `WHEN_UNLOCKED_THIS_DEVICE_ONLY` keeps the
 *     draft out of iCloud and iTunes backups entirely — it never leaves the
 *     device it was typed on.
 *  2. It is already a dependency and already an `app.json` plugin (the Medplum
 *     tokens live there). AsyncStorage would be a new native module, a new pod
 *     install, and a rebuild, bought for a weaker guarantee.
 *  3. The volumes are trivial — one small JSON record, written on a debounce.
 *     SecureStore's cost only matters for bulk data, which this is not.
 *
 * Android caveat: SecureStore documents a ~2048-byte limit per value. A full
 * draft is a few hundred bytes; a pathological list of "topics to avoid" could
 * approach it, and a failed write degrades to "this session does not resume"
 * rather than to a crash — see `OnboardingDraftStore`'s failure tolerance.
 *
 * **Web** (the Expo web export — a caregiver opening the magic link on a
 * laptop) has no SecureStore: `expo-secure-store` ships an empty stub there.
 * It falls back to `localStorage`, which is exactly where `@juniper/medplum-rn`
 * already keeps the Medplum access token on web — a strictly more sensitive
 * secret — so this adds no new exposure. `localStorage` rather than
 * `sessionStorage` because surviving a closed tab is the entire point.
 */
import * as SecureStore from 'expo-secure-store';
import type { DraftStorage } from './draft';

function isWebRuntime(): boolean {
  return typeof document !== 'undefined' && typeof localStorage !== 'undefined';
}

/** Keeps the draft off iCloud/iTunes backups: it stays on the device it was typed on. */
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const draftStorage: DraftStorage = {
  async getItem(key) {
    if (isWebRuntime()) {
      return localStorage.getItem(key);
    }
    return SecureStore.getItemAsync(key, SECURE_OPTIONS);
  },
  async setItem(key, value) {
    if (isWebRuntime()) {
      localStorage.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value, SECURE_OPTIONS);
  },
  async removeItem(key) {
    if (isWebRuntime()) {
      localStorage.removeItem(key);
      return;
    }
    await SecureStore.deleteItemAsync(key, SECURE_OPTIONS);
  },
};
