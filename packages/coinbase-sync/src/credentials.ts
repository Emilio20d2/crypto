import { execFileSync, spawnSync } from "child_process";
import type { CoinbaseCredentials } from "./types";

const KEYCHAIN_SERVICE = "crypto-control-coinbase";
const ACCOUNT_KEY_NAME = "api-key-name";
const ACCOUNT_PRIVATE_KEY = "private-key-pem";

function keychainGet(account: string): string | null {
  try {
    const result = execFileSync(
      "security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    return result || null;
  } catch {
    return null;
  }
}

function keychainSet(account: string, value: string): void {
  // Delete any existing entry first (ignoring errors)
  try {
    execFileSync(
      "security",
      ["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account],
      { stdio: "ignore" }
    );
  } catch {}

  // Use -i to read the password from stdin so it never appears in process args
  const result = spawnSync(
    "security",
    ["add-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-i"],
    { input: value, stdio: ["pipe", "ignore", "ignore"] }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`security add-generic-password failed with status ${result.status}`);
}

function keychainDelete(account: string): void {
  try {
    execFileSync(
      "security",
      ["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account],
      { stdio: "ignore" }
    );
  } catch {}
}

export class CoinbaseCredentialsManager {
  saveCredentials(creds: CoinbaseCredentials): void {
    keychainSet(ACCOUNT_KEY_NAME, creds.apiKeyName);
    keychainSet(ACCOUNT_PRIVATE_KEY, creds.privateKeyPem);
  }

  getCredentials(): CoinbaseCredentials | null {
    const apiKeyName = keychainGet(ACCOUNT_KEY_NAME);
    const privateKeyPem = keychainGet(ACCOUNT_PRIVATE_KEY);

    if (!apiKeyName || !privateKeyPem) return null;

    return { apiKeyName, privateKeyPem };
  }

  hasCredentials(): boolean {
    return (
      keychainGet(ACCOUNT_KEY_NAME) !== null &&
      keychainGet(ACCOUNT_PRIVATE_KEY) !== null
    );
  }

  deleteCredentials(): void {
    keychainDelete(ACCOUNT_KEY_NAME);
    keychainDelete(ACCOUNT_PRIVATE_KEY);
  }
}
