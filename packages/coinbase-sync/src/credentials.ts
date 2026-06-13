import { execFileSync, spawnSync } from "child_process";
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

function keychainGet(service: string, account: string): string | null {
  try {
    const result = execFileSync(
      "security",
      ["find-generic-password", "-s", service, "-a", account, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    return result || null;
  } catch {
    return null;
  }
}

function keychainSet(service: string, account: string, value: string): void {
  try {
    execFileSync(
      "security",
      ["delete-generic-password", "-s", service, "-a", account],
      { stdio: "ignore" }
    );
  } catch {}

  // Use -i so the value is never visible in process arguments
  const result = spawnSync(
    "security",
    ["add-generic-password", "-s", service, "-a", account, "-i"],
    { input: value, stdio: ["pipe", "ignore", "ignore"] }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`security add-generic-password failed with status ${result.status}`);
  }
}

function keychainDelete(service: string, account: string): void {
  try {
    execFileSync(
      "security",
      ["delete-generic-password", "-s", service, "-a", account],
      { stdio: "ignore" }
    );
  } catch {}
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
    // Try new CDP location first
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
    const keyName    = keychainGet(CDP_SERVICE, ACCT_KEY_NAME);
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
