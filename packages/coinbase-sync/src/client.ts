import * as crypto from "crypto";
import type { FillsResponse, AccountsResponse, KeyPermissionsResponse } from "./types";

const BASE_URL = "https://api.coinbase.com";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

function base64url(data: Buffer | string): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  return buf.toString("base64url");
}

export function buildJWT(keyName: string, privateKeyPem: string, method: string, path: string): string {
  const now   = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(16).toString("hex");

  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyName, nonce }));
  const payload = base64url(
    JSON.stringify({
      iss: "cdp",
      nbf: now,
      exp: now + 120,
      sub: keyName,
      uri: `${method} api.coinbase.com${path}`,
    })
  );

  const message    = `${header}.${payload}`;
  const privateKey = crypto.createPrivateKey(privateKeyPem);

  const signature = crypto.sign("sha256", Buffer.from(message), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });

  return `${message}.${base64url(signature)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyHttpError(status: number, path: string): Error {
  if (status === 401) {
    return new Error(
      "Credenciales no válidas (401). La clave puede haber sido revocada o el JWT está mal formado."
    );
  }
  if (status === 403) {
    return new Error(
      "Acceso denegado (403). La clave no tiene permisos suficientes para esta operación."
    );
  }
  if (status === 429) {
    return new Error("Límite de peticiones alcanzado (429). Vuelve a intentarlo en unos segundos.");
  }
  return new Error(`Error de la API de Coinbase (${status}) en ${path}`);
}

export class CoinbaseClient {
  private readonly keyName: string;
  private readonly privateKeyPem: string;

  constructor(keyName: string, privateKeyPem: string) {
    this.keyName       = keyName;
    this.privateKeyPem = privateKeyPem;
  }

  private buildHeaders(method: string, path: string): Record<string, string> {
    const jwt = buildJWT(this.keyName, this.privateKeyPem, method, path);
    return {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    };
  }

  private async fetchWithRetry<T>(
    method: string,
    path: string,
    params?: Record<string, string>
  ): Promise<T> {
    const url = new URL(BASE_URL + path);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await sleep(500 * Math.pow(2, attempt - 1));
      }

      const controller = new AbortController();
      const timeoutId  = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(url.toString(), {
          method,
          headers: this.buildHeaders(method, path),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get("Retry-After") ?? "2", 10);
          await sleep(retryAfter * 1000);
          lastError = classifyHttpError(429, path);
          continue;
        }

        if (response.status === 401 || response.status === 403) {
          throw classifyHttpError(response.status, path);
        }

        if (!response.ok) {
          throw classifyHttpError(response.status, path);
        }

        return (await response.json()) as T;
      } catch (e: unknown) {
        clearTimeout(timeoutId);
        const msg = (e as Error).message ?? "";
        // Do not retry auth errors
        if (msg.includes("401") || msg.includes("403") || msg.includes("revocada") || msg.includes("denegado")) {
          throw e;
        }
        if ((e as { name?: string }).name === "AbortError") {
          lastError = new Error("La petición a Coinbase superó el tiempo de espera. Comprueba tu conexión a internet.");
        } else {
          lastError = e instanceof Error ? e : new Error(String(e));
        }
        if (attempt < MAX_RETRIES - 1) continue;
      }
    }

    throw lastError ?? new Error(`Fallo en petición a ${path} tras ${MAX_RETRIES} intentos`);
  }

  async getAccounts(): Promise<AccountsResponse> {
    return this.fetchWithRetry<AccountsResponse>("GET", "/api/v3/brokerage/accounts");
  }

  async getKeyPermissions(): Promise<KeyPermissionsResponse> {
    return this.fetchWithRetry<KeyPermissionsResponse>("GET", "/api/v3/brokerage/key_permissions");
  }

  async getFills(params: {
    limit?: string;
    cursor?: string;
    start_sequence_timestamp?: string;
    product_id?: string;
  }): Promise<FillsResponse> {
    const queryParams: Record<string, string> = {};
    if (params.limit)                    queryParams.limit = params.limit;
    if (params.cursor)                   queryParams.cursor = params.cursor;
    if (params.start_sequence_timestamp) queryParams.start_sequence_timestamp = params.start_sequence_timestamp;
    if (params.product_id)               queryParams.product_id = params.product_id;

    return this.fetchWithRetry<FillsResponse>(
      "GET",
      "/api/v3/brokerage/orders/historical/fills",
      queryParams
    );
  }

  async testConnection(): Promise<void> {
    await this.getAccounts();
  }
}
