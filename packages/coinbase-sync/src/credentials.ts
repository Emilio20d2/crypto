import { execFileSync } from "child_process";
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

  execFileSync(
    "security",
    ["add-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w", value],
    { stdio: "ignore" }
  );
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
