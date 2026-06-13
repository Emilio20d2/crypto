import { spawnSync } from "child_process";
import * as path from "path";
import type { CoinbaseCredentials } from "./types";

// New CDP-specific keychain service names
const CDP_SERVICE     = "Crypto Control Coinbase CDP";
const ACCT_KEY_NAME   = "key-name";
const ACCT_PRIVATE    = "private-key";
const ACCT_ALGORITHM  = "algorithm";
const ACCT_DISPLAY    = "display-name";

// Legacy service name (backward compat reads)
const LEGACY_SERVICE          = "crypto-control-coinbase";
const LEGACY_ACCT_KEY_NAME    = "api-key-name";
const LEGACY_ACCT_PRIVATE_KEY = "private-key-pem";

// Compiled Swift helper: reads/writes Keychain without putting secrets in args
function helperPath(): string {
  if (process.env["KEYCHAIN_HELPER_PATH"]) {
    return process.env["KEYCHAIN_HELPER_PATH"];
  }
  // In production the binary is alongside the app resources;
  // in development it lives next to this package under apps/desktop/bin/
  return path.resolve(
    __dirname,
    "../../../apps/desktop/bin/keychain-helper"
  );
}

function keychainSet(service: string, account: string, value: string): void {
  const result = spawnSync(
    helperPath(),
    ["set", service, account],
    { input: value, stdio: ["pipe", "ignore", "pipe"], encoding: "utf8" }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `keychain-helper set failed (status ${result.status}): ${result.stderr?.trim()}`
    );
  }
}

function keychainGet(service: string, account: string): string | null {
  const result = spawnSync(
    helperPath(),
    ["get", service, account],
    { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }
  );
  if (result.status !== 0 || !result.stdout) return null;
  return result.stdout || null;
}

function keychainDelete(service: string, account: string): void {
  spawnSync(helperPath(), ["delete", service, account], { stdio: "ignore" });
}

export interface ExtendedCoinbaseCredentials extends CoinbaseCredentials {
  algorithm?: string;
  keyDisplayName?: string;
}

export class CoinbaseCredentialsManager {
  saveCredentials(creds: ExtendedCoinbaseCredentials): void {
    keychainSet(CDP_SERVICE, ACCT_KEY_NAME,  creds.apiKeyName);
    keychainSet(CDP_SERVICE, ACCT_PRIVATE,   creds.privateKeyPem);
    if (creds.algorithm)      keychainSet(CDP_SERVICE, ACCT_ALGORITHM, creds.algorithm);
    if (creds.keyDisplayName) keychainSet(CDP_SERVICE, ACCT_DISPLAY,   creds.keyDisplayName);
  }

  getCredentials(): CoinbaseCredentials | null {
    const apiKeyName    = keychainGet(CDP_SERVICE, ACCT_KEY_NAME);
    const privateKeyPem = keychainGet(CDP_SERVICE, ACCT_PRIVATE);

    if (apiKeyName && privateKeyPem) {
      return { apiKeyName, privateKeyPem };
    }

    // Fall back to legacy location
    const legacyKeyName    = keychainGet(LEGACY_SERVICE, LEGACY_ACCT_KEY_NAME);
    const legacyPrivateKey = keychainGet(LEGACY_SERVICE, LEGACY_ACCT_PRIVATE_KEY);

    if (legacyKeyName && legacyPrivateKey) {
      return { apiKeyName: legacyKeyName, privateKeyPem: legacyPrivateKey };
    }

    return null;
  }

  hasCredentials(): boolean {
    const hasNew =
      keychainGet(CDP_SERVICE, ACCT_KEY_NAME) !== null &&
      keychainGet(CDP_SERVICE, ACCT_PRIVATE)  !== null;

    if (hasNew) return true;

    return (
      keychainGet(LEGACY_SERVICE, LEGACY_ACCT_KEY_NAME)    !== null &&
      keychainGet(LEGACY_SERVICE, LEGACY_ACCT_PRIVATE_KEY) !== null
    );
  }

  getKeyInfo(): { keyDisplayName: string; algorithm: string } | null {
    const keyName = keychainGet(CDP_SERVICE, ACCT_KEY_NAME);
    if (!keyName) return null;

    const display   = keychainGet(CDP_SERVICE, ACCT_DISPLAY)   ?? `••••${keyName.slice(-4)}`;
    const algorithm = keychainGet(CDP_SERVICE, ACCT_ALGORITHM) ?? "ES256";

    return { keyDisplayName: display, algorithm };
  }

  deleteCredentials(): void {
    keychainDelete(CDP_SERVICE, ACCT_KEY_NAME);
    keychainDelete(CDP_SERVICE, ACCT_PRIVATE);
    keychainDelete(CDP_SERVICE, ACCT_ALGORITHM);
    keychainDelete(CDP_SERVICE, ACCT_DISPLAY);
    // Also clean up legacy entries
    keychainDelete(LEGACY_SERVICE, LEGACY_ACCT_KEY_NAME);
    keychainDelete(LEGACY_SERVICE, LEGACY_ACCT_PRIVATE_KEY);
  }
}
