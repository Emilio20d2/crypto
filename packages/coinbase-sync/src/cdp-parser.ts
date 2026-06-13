import * as crypto from "crypto";

export type CdpErrorCode =
  | "JSON_INVALID"
  | "JSON_EMPTY"
  | "FIELDS_MISSING"
  | "KEY_NAME_INCOMPLETE"
  | "KEY_NAME_FORMAT_INVALID"
  | "PEM_INVALID"
  | "KEY_NOT_PRIVATE"
  | "KEY_ED25519_INCOMPATIBLE"
  | "KEY_NOT_EC"
  | "KEY_WRONG_CURVE";

export class CdpParseError extends Error {
  constructor(
    public readonly code: CdpErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CdpParseError";
  }
}

export interface ParsedCdpCredentials {
  keyName: string;
  privateKeyPem: string;
  algorithm: "ES256";
  keyDisplayName: string;
}

const KEY_NAME_PATTERN = /^organizations\/[^/]+\/apiKeys\/[^/]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizePrivateKey(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .trim()
    .concat("\n");
}

function maskKeyName(keyName: string): string {
  const id = keyName.split("/").pop() ?? keyName;
  const last4 = id.slice(-4);
  return `••••${last4}`;
}

export function parseCdpJson(jsonString: string): ParsedCdpCredentials {
  if (!jsonString || jsonString.trim().length === 0) {
    throw new CdpParseError("JSON_EMPTY", "El archivo está vacío.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    throw new CdpParseError(
      "JSON_INVALID",
      "El archivo no contiene JSON válido. Verifica que sea el archivo original descargado de Coinbase Developer Platform."
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CdpParseError("JSON_INVALID", "El JSON no tiene la estructura esperada (se esperaba un objeto).");
  }

  const obj = parsed as Record<string, unknown>;

  const rawKeyName =
    (typeof obj["name"] === "string" ? obj["name"] : undefined) ??
    (typeof obj["keyName"] === "string" ? obj["keyName"] : undefined) ??
    (typeof obj["apiKeyId"] === "string" ? obj["apiKeyId"] : undefined) ??
    (typeof obj["id"] === "string" ? obj["id"] : undefined);

  const rawPrivateKey =
    (typeof obj["privateKey"] === "string" ? obj["privateKey"] : undefined) ??
    (typeof obj["apiKeySecret"] === "string" ? obj["apiKeySecret"] : undefined);

  if (!rawKeyName || !rawPrivateKey) {
    const missing: string[] = [];
    if (!rawKeyName) missing.push("name (o keyName / apiKeyId / id)");
    if (!rawPrivateKey) missing.push("privateKey (o apiKeySecret)");
    throw new CdpParseError(
      "FIELDS_MISSING",
      `El archivo no contiene los campos necesarios: ${missing.join(", ")}. Verifica que sea el archivo JSON oficial de Coinbase Developer Platform.`
    );
  }

  const trimmedKeyName = rawKeyName.trim();

  if (UUID_PATTERN.test(trimmedKeyName)) {
    throw new CdpParseError(
      "KEY_NAME_INCOMPLETE",
      `El identificador contiene solo un UUID sin prefijo de organización. El formato requerido es organizations/{organizationId}/apiKeys/{apiKeyId}. Verifica que descargaste el archivo correcto desde Coinbase Developer Platform.`
    );
  }

  if (!KEY_NAME_PATTERN.test(trimmedKeyName)) {
    throw new CdpParseError(
      "KEY_NAME_FORMAT_INVALID",
      `El identificador de la clave no tiene el formato esperado. Se requiere: organizations/{organizationId}/apiKeys/{apiKeyId}.`
    );
  }

  const keyName = trimmedKeyName;
  const privateKeyPem = normalizePrivateKey(rawPrivateKey);

  let keyObject: crypto.KeyObject;
  try {
    keyObject = crypto.createPrivateKey(privateKeyPem);
  } catch {
    throw new CdpParseError(
      "PEM_INVALID",
      "La clave privada no es un PEM válido. Verifica que el archivo no esté corrupto o modificado."
    );
  }

  if (keyObject.type !== "private") {
    throw new CdpParseError(
      "KEY_NOT_PRIVATE",
      "El PEM proporcionado contiene una clave pública, no una clave privada."
    );
  }

  const asymmType = keyObject.asymmetricKeyType;

  if (asymmType === "ed25519" || asymmType === "ed448") {
    throw new CdpParseError(
      "KEY_ED25519_INCOMPATIBLE",
      `Esta credencial utiliza ${asymmType.toUpperCase()} y no es compatible con las APIs de Coinbase Advanced Trade utilizadas por Crypto Control. Crea una nueva clave CDP seleccionando ECDSA y permisos de solo lectura.`
    );
  }

  if (asymmType !== "ec") {
    throw new CdpParseError(
      "KEY_NOT_EC",
      `La clave es de tipo "${asymmType}" y no es compatible. Se requiere una clave EC (ECDSA) para la API de Coinbase Advanced Trade.`
    );
  }

  // Verify the curve is P-256 (prime256v1) — required for ES256
  const details = keyObject.asymmetricKeyDetails;
  const curve   = details?.namedCurve;
  if (curve !== "prime256v1" && curve !== "P-256") {
    throw new CdpParseError(
      "KEY_WRONG_CURVE",
      `La clave EC utiliza la curva "${curve ?? "desconocida"}" en lugar de P-256 (prime256v1) requerida para ES256. Crea una nueva clave CDP seleccionando ECDSA P-256.`
    );
  }

  return {
    keyName,
    privateKeyPem,
    algorithm: "ES256",
    keyDisplayName: maskKeyName(keyName),
  };
}
