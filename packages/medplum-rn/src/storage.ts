/**
 * Token storage for MedplumClient.
 *
 * Native: expo-secure-store (Keychain / Keystore). SecureStore has no key
 * enumeration, so an index key tracks which keys we own; everything is
 * preloaded into memory at init so the synchronous IClientStorage contract
 * holds, and writes persist asynchronously.
 *
 * Web (Expo web export — the magic-link-on-a-laptop flow): localStorage.
 *
 * Await `getInitPromise()` before constructing the MedplumClient so session
 * restore sees the persisted login.
 */
import type { IClientStorage } from '@medplum/core';
import * as SecureStore from 'expo-secure-store';

const KEY_PREFIX = 'juniper.medplum.';
const INDEX_KEY = 'juniper.medplum.__keys__';

function isWebRuntime(): boolean {
  return typeof document !== 'undefined' && typeof localStorage !== 'undefined';
}

/** SecureStore keys must match [A-Za-z0-9._-]. */
function toSecureStoreKey(key: string): string {
  return KEY_PREFIX + key.replace(/[^A-Za-z0-9._-]/g, '_');
}

export class ExpoClientStorage implements IClientStorage {
  private readonly data = new Map<string, string>();
  private readonly web = isWebRuntime();
  private readonly initPromise: Promise<void>;

  constructor() {
    this.initPromise = this.web ? Promise.resolve() : this.loadFromSecureStore();
  }

  getInitPromise(): Promise<void> {
    return this.initPromise;
  }

  /**
   * The key this storage actually writes under.
   *
   * MedplumClient uses it for two things that break silently if it lies: the
   * cross-tab `storage` event comparison (`event.key === makeKey('activeLogin')`)
   * and the Web Locks name guarding token refresh. So it must return exactly
   * what the underlying store sees — the localStorage key on web, the
   * sanitised SecureStore key on native.
   */
  makeKey(key: string): string {
    return this.web ? KEY_PREFIX + key : toSecureStoreKey(key);
  }

  private async loadFromSecureStore(): Promise<void> {
    try {
      const indexJson = await SecureStore.getItemAsync(INDEX_KEY);
      if (!indexJson) {
        return;
      }
      const keys = JSON.parse(indexJson) as string[];
      await Promise.all(
        keys.map(async (key) => {
          const value = await SecureStore.getItemAsync(toSecureStoreKey(key));
          if (value !== null) {
            this.data.set(key, value);
          }
        })
      );
    } catch {
      // A corrupt store degrades to a signed-out state, never a crash.
      this.data.clear();
    }
  }

  private persistIndex(): void {
    const keys = JSON.stringify([...this.data.keys()]);
    SecureStore.setItemAsync(INDEX_KEY, keys).catch(() => undefined);
  }

  clear(): void {
    if (this.web) {
      for (const key of [...this.data.keys()]) {
        localStorage.removeItem(KEY_PREFIX + key);
      }
      this.data.clear();
      return;
    }
    for (const key of [...this.data.keys()]) {
      SecureStore.deleteItemAsync(toSecureStoreKey(key)).catch(() => undefined);
    }
    this.data.clear();
    this.persistIndex();
  }

  getString(key: string): string | undefined {
    if (this.web) {
      return localStorage.getItem(KEY_PREFIX + key) ?? undefined;
    }
    return this.data.get(key);
  }

  setString(key: string, value: string | undefined): void {
    if (this.web) {
      if (value === undefined) {
        localStorage.removeItem(KEY_PREFIX + key);
      } else {
        localStorage.setItem(KEY_PREFIX + key, value);
      }
      return;
    }
    if (value === undefined) {
      this.data.delete(key);
      SecureStore.deleteItemAsync(toSecureStoreKey(key)).catch(() => undefined);
    } else {
      this.data.set(key, value);
      SecureStore.setItemAsync(toSecureStoreKey(key), value).catch(() => undefined);
    }
    this.persistIndex();
  }

  getObject<T>(key: string): T | undefined {
    const raw = this.getString(key);
    if (raw === undefined) {
      return undefined;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  setObject<T>(key: string, value: T): void {
    this.setString(key, value === undefined ? undefined : JSON.stringify(value));
  }
}
