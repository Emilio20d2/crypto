import * as crypto from "crypto";
import type { FillsResponse, AccountsResponse, KeyPermissionsResponse } from "./types";

export type CoinbaseErrorCode =
  | "INVALID_JSON"
  | "INVALID_KEY_NAME"
  | "INVALID_PRIVATE_KEY"
  | "UNSUPPORTED_ALGORITHM"
  | "INVALID_JWT_SIGNATURE"
  | "CLOCK_SKEW"
  | "UNAUTHORIZED"
  | "INSUFFICIENT_PERMISSIONS"
  | "IP_RESTRICTED"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "SERVER_ERROR";

export class CoinbaseApiError extends Error {
  constructor(
    public readonly code: CoinbaseErrorCode,
    message: string,
    public readonly httpStatus?: number,
    public readonly correlationId?: string,
  ) {
    super(message);
    this.name = "CoinbaseApiError";
  }
}

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

  const header = base64url(
    JSON.stringify({ alg: "ES256", typ: "JWT", kid: keyName, nonce })
  );
  const payload = base64url(
    JSON.stringify({
      iss: "cdp",
      nbf: now,
      exp: now + 120,
      sub: keyName,
      uri: `${method} api.coinbase.com${path}`,
    })
  );

  const signingInput = `${header}.${payload}`;
  const privateKey   = crypto.createPrivateKey(privateKeyPem);

  const signature = crypto.sign(
    "sha256",
    Buffer.from(signingInput, "utf8"),
    { key: privateKey, dsaEncoding: "ieee-p1363" }
  );

  if (signature.length !== 64) {
    throw new CoinbaseApiError(
      "INVALID_JWT_SIGNATURE",
      `La firma ES256 no tiene el formato JWS esperado (se obtuvieron ${signature.length} bytes, se esperaban 64).`
    );
  }

  return `${signingInput}.${base64url(signature)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyResponse(status: number, body: string, correlationId?: string): CoinbaseApiError {
  const lower = body.toLowerCase();

  if (status === 401) {
    // Try to distinguish specific 401 causes from the body
    if (lower.includes("clock") || lower.includes("timestamp") || lower.includes("nbf") || lower.includes("exp")) {
      return new CoinbaseApiError(
        "CLOCK_SKEW",
        "El reloj del sistema puede estar desincronizado. Verifica la hora del Mac y vuelve a intentarlo.",
        401, correlationId
      );
    }
    if (lower.includes("signature") || lower.includes("jwt") || lower.includes("invalid token")) {
      return new CoinbaseApiError(
        "INVALID_JWT_SIGNATURE",
        "La firma del JWT no fue aceptada por Coinbase. Verifica que la clave privada corresponde a esta API Key.",
        401, correlationId
      );
    }
    return new CoinbaseApiError(
      "UNAUTHORIZED",
      "Credenciales no válidas (401). La clave puede haber sido revocada o tiene un formato incorrecto.",
      401, correlationId
    );
  }

  if (status === 403) {
    if (lower.includes("ip") || lower.includes("allowlist") || lower.includes("whitelist")) {
      return new CoinbaseApiError(
        "IP_RESTRICTED",
        "Acceso denegado (403): la IP de este dispositivo no está en la lista de IPs permitidas para esta API Key.",
        403, correlationId
      );
    }
    if (lower.includes("permission") || lower.includes("scope") || lower.includes("can_view")) {
      return new CoinbaseApiError(
        "INSUFFICIENT_PERMISSIONS",
        "La clave no tiene permisos suficientes (403). Asegúrate de que tiene activado el permiso de lectura (can_view).",
        403, correlationId
      );
    }
    return new CoinbaseApiError(
      "INSUFFICIENT_PERMISSIONS",
      "Acceso denegado (403). Verifica que la clave tiene permiso de lectura y que este dispositivo no está bloqueado.",
      403, correlationId
    );
  }

  if (status === 429) {
    return new CoinbaseApiError(
      "RATE_LIMITED",
      "Límite de peticiones alcanzado (429). Espera unos segundos antes de volver a intentarlo.",
      429, correlationId
    );
  }

  return new CoinbaseApiError(
    "SERVER_ERROR",
    `Error del servidor de Coinbase (${status}). Inténtalo de nuevo más tarde.`,
    status, correlationId
  );
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
      Accept: "application/json",
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

    let lastError: CoinbaseApiError | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await sleep(500 * Math.pow(2, attempt - 1));
      }

      const controller = new AbortController();
      const timeoutId  = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        // Build fresh JWT for every request — never reuse
        const response = await fetch(url.toString(), {
          method,
          headers: this.buildHeaders(method, path),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const correlationId = response.headers.get("x-correlation-id") ?? undefined;

        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get("Retry-After") ?? "2", 10);
          await sleep(retryAfter * 1000);
          lastError = classifyResponse(429, "", correlationId);
          continue;
        }

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          const err  = classifyResponse(response.status, body, correlationId);
          // Do not retry on 4xx
          if (response.status >= 400 && response.status < 500) throw err;
          lastError = err;
          continue;
        }

        return (await response.json()) as T;
      } catch (e: unknown) {
        clearTimeout(timeoutId);
        if (e instanceof CoinbaseApiError) throw e;

        if ((e as { name?: string }).name === "AbortError") {
          lastError = new CoinbaseApiError(
            "NETWORK_ERROR",
            "La petición a Coinbase superó el tiempo de espera. Comprueba tu conexión a internet."
          );
        } else {
          lastError = new CoinbaseApiError(
            "NETWORK_ERROR",
            "No se pudo contactar con Coinbase. Verifica tu conexión a internet."
          );
        }
        if (attempt < MAX_RETRIES - 1) continue;
      }
    }

    throw lastError ?? new CoinbaseApiError(
      "NETWORK_ERROR",
      `Fallo en petición a ${path} tras ${MAX_RETRIES} intentos`
    );
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
