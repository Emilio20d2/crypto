import { describe, test, expect, vi, beforeAll } from "vitest";
import * as crypto from "crypto";
import { parseCdpJson, normalizePrivateKey, CdpParseError } from "./cdp-parser";
import { buildJWT } from "./client";

// ── Generate real test keys once ─────────────────────────────────────────────

let ecKeyPemSec1: string;   // BEGIN EC PRIVATE KEY
let ecKeyPemPkcs8: string;  // BEGIN PRIVATE KEY (PKCS#8 EC)
let ed25519KeyPem: string;
let keyName: string;

beforeAll(() => {
  const { privateKey: ecKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  ecKeyPemSec1  = ecKey.export({ type: "sec1",  format: "pem" }) as string;
  ecKeyPemPkcs8 = ecKey.export({ type: "pkcs8", format: "pem" }) as string;

  const { privateKey: edKey } = crypto.generateKeyPairSync("ed25519");
  ed25519KeyPem = edKey.export({ type: "pkcs8", format: "pem" }) as string;

  keyName = "organizations/test-org-id/apiKeys/test-key-id-abcd";
});

function makeJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ name: keyName, privateKey: ecKeyPemSec1, ...overrides });
}

// ── Group A — JSON formats ────────────────────────────────────────────────────

describe("parseCdpJson — formatos JSON", () => {
  test("archivo oficial con `name` y `privateKey` (PEM multilínea real)", () => {
    const result = parseCdpJson(makeJson());
    expect(result.keyName).toBe(keyName);
    expect(result.algorithm).toBe("ES256");
    expect(result.keyDisplayName).toMatch(/^••••/);
    expect(result.privateKeyPem).not.toBe("");
  });

  test("alias `keyName`", () => {
    const json = JSON.stringify({ keyName, privateKey: ecKeyPemSec1 });
    const result = parseCdpJson(json);
    expect(result.keyName).toBe(keyName);
  });

  test("alias `apiKeyId`", () => {
    const json = JSON.stringify({ apiKeyId: keyName, privateKey: ecKeyPemSec1 });
    const result = parseCdpJson(json);
    expect(result.keyName).toBe(keyName);
  });

  test("alias `id` con formato completo", () => {
    const json = JSON.stringify({ id: keyName, privateKey: ecKeyPemSec1 });
    const result = parseCdpJson(json);
    expect(result.keyName).toBe(keyName);
  });

  test("alias `apiKeySecret` para la clave privada", () => {
    const json = JSON.stringify({ name: keyName, apiKeySecret: ecKeyPemSec1 });
    const result = parseCdpJson(json);
    expect(result.privateKeyPem).not.toBe("");
  });

  test("UUID aislado en `id` → error KEY_NAME_INCOMPLETE", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const json = JSON.stringify({ id: uuid, privateKey: ecKeyPemSec1 });
    expect(() => parseCdpJson(json)).toThrow(CdpParseError);
    try {
      parseCdpJson(json);
    } catch (e) {
      expect((e as CdpParseError).code).toBe("KEY_NAME_INCOMPLETE");
    }
  });

  test("JSON mal formado → error JSON_INVALID", () => {
    expect(() => parseCdpJson("{not valid json")).toThrow(CdpParseError);
    try {
      parseCdpJson("{not valid json");
    } catch (e) {
      expect((e as CdpParseError).code).toBe("JSON_INVALID");
    }
  });

  test("JSON vacío → error JSON_EMPTY", () => {
    expect(() => parseCdpJson("")).toThrow(CdpParseError);
    try {
      parseCdpJson("");
    } catch (e) {
      expect((e as CdpParseError).code).toBe("JSON_EMPTY");
    }
  });

  test("campos ausentes (sin privateKey) → error FIELDS_MISSING", () => {
    const json = JSON.stringify({ name: keyName });
    expect(() => parseCdpJson(json)).toThrow(CdpParseError);
    try {
      parseCdpJson(json);
    } catch (e) {
      expect((e as CdpParseError).code).toBe("FIELDS_MISSING");
    }
  });

  test("campos ausentes (sin nombre de clave) → error FIELDS_MISSING", () => {
    const json = JSON.stringify({ privateKey: ecKeyPemSec1 });
    expect(() => parseCdpJson(json)).toThrow(CdpParseError);
    try {
      parseCdpJson(json);
    } catch (e) {
      expect((e as CdpParseError).code).toBe("FIELDS_MISSING");
    }
  });

  test("identificador con formato incorrecto → error KEY_NAME_FORMAT_INVALID", () => {
    const json = JSON.stringify({ name: "not-the-right-format", privateKey: ecKeyPemSec1 });
    expect(() => parseCdpJson(json)).toThrow(CdpParseError);
    try {
      parseCdpJson(json);
    } catch (e) {
      expect((e as CdpParseError).code).toBe("KEY_NAME_FORMAT_INVALID");
    }
  });
});

// ── Group B — normalización de PEM ───────────────────────────────────────────

describe("parseCdpJson — normalización de PEM", () => {
  test("PEM con saltos de línea reales (\\n)", () => {
    const result = parseCdpJson(makeJson({ privateKey: ecKeyPemSec1 }));
    expect(result.privateKeyPem).toContain("-----BEGIN");
    expect(result.keyName).toBe(keyName);
  });

  test("PEM con \\\\n escapados dentro del JSON (formato CDP descargado)", () => {
    // CDP JSON stores the PEM with literal \n inside the JSON string
    const escaped = ecKeyPemSec1.replace(/\n/g, "\\n");
    const json = JSON.stringify({ name: keyName, privateKey: escaped });
    const parsed = JSON.parse(json) as { privateKey: string };
    // After JSON.parse, the value has literal \n chars (not newlines)
    expect(parsed.privateKey).toContain("\\n");
    const result = parseCdpJson(json);
    expect(result.privateKeyPem).toContain("\n");
    expect(result.keyName).toBe(keyName);
  });

  test("PEM con CRLF (\\r\\n)", () => {
    const crlfPem = ecKeyPemSec1.replace(/\n/g, "\r\n");
    const result = parseCdpJson(makeJson({ privateKey: crlfPem }));
    expect(result.privateKeyPem).not.toContain("\r");
    expect(result.keyName).toBe(keyName);
  });

  test("normalizePrivateKey: convierte \\\\n escapados", () => {
    const escaped = ecKeyPemSec1.replace(/\n/g, "\\n");
    const normalized = normalizePrivateKey(escaped);
    expect(normalized).toContain("\n");
    expect(normalized).not.toContain("\\n");
  });

  test("normalizePrivateKey: normaliza CRLF", () => {
    const crlf = ecKeyPemSec1.replace(/\n/g, "\r\n");
    const normalized = normalizePrivateKey(crlf);
    expect(normalized).not.toContain("\r");
  });

  test("normalizePrivateKey: añade newline al final si falta", () => {
    const trimmed = ecKeyPemSec1.trim();
    const normalized = normalizePrivateKey(trimmed);
    expect(normalized.endsWith("\n")).toBe(true);
  });
});

// ── Group C — validación de tipo de clave ────────────────────────────────────

describe("parseCdpJson — validación criptográfica", () => {
  test("PKCS#8 EC válido (BEGIN PRIVATE KEY) aceptado", () => {
    const result = parseCdpJson(makeJson({ privateKey: ecKeyPemPkcs8 }));
    expect(result.algorithm).toBe("ES256");
  });

  test("PEM inválido (corrupto) → error PEM_INVALID", () => {
    const badPem = "-----BEGIN EC PRIVATE KEY-----\nZZZZZZZZZZZ\n-----END EC PRIVATE KEY-----\n";
    const json = makeJson({ privateKey: badPem });
    expect(() => parseCdpJson(json)).toThrow(CdpParseError);
    try {
      parseCdpJson(json);
    } catch (e) {
      expect((e as CdpParseError).code).toBe("PEM_INVALID");
    }
  });

  test("clave Ed25519 rechazada con mensaje claro → error KEY_ED25519_INCOMPATIBLE", () => {
    const json = makeJson({ privateKey: ed25519KeyPem });
    expect(() => parseCdpJson(json)).toThrow(CdpParseError);
    try {
      parseCdpJson(json);
    } catch (e) {
      const err = e as CdpParseError;
      expect(err.code).toBe("KEY_ED25519_INCOMPATIBLE");
      expect(err.message).toContain("ED25519");
      expect(err.message).toContain("ECDSA");
    }
  });
});

// ── Group D — redacción y seguridad ──────────────────────────────────────────

describe("parseCdpJson — seguridad", () => {
  test("la clave privada NO está en keyDisplayName", () => {
    const result = parseCdpJson(makeJson());
    expect(result.keyDisplayName).not.toContain("BEGIN");
    expect(result.keyDisplayName).not.toContain("KEY");
  });

  test("los errores no incluyen la clave privada", () => {
    // Even with a valid PEM, ensure error messages don't contain the key
    const badJson = JSON.stringify({ name: "bad-format", privateKey: ecKeyPemSec1 });
    try {
      parseCdpJson(badJson);
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain("BEGIN EC PRIVATE KEY");
      expect(msg).not.toContain(ecKeyPemSec1.slice(0, 20));
    }
  });

  test("los errores no incluyen el JSON completo", () => {
    const badJson = makeJson();
    try {
      parseCdpJson(makeJson({ name: "bad" }));
    } catch (e) {
      const msg = (e as Error).message;
      // Error message should not reproduce the full JSON content
      expect(msg.length).toBeLessThan(300);
      expect(msg).not.toContain(badJson);
    }
  });

  test("keyDisplayName muestra solo los últimos 4 chars del id de la clave", () => {
    const result = parseCdpJson(makeJson());
    // keyName ends with "test-key-id-abcd"
    expect(result.keyDisplayName).toBe("••••abcd");
  });
});

// ── Group E — JWT ─────────────────────────────────────────────────────────────

describe("buildJWT — generación de JWT", () => {
  test("JWT ES256 válido: header.payload.signature (3 partes)", () => {
    const jwt = buildJWT(keyName, ecKeyPemSec1, "GET", "/api/v3/brokerage/accounts");
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);

    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    expect(header.alg).toBe("ES256");
    expect(header.kid).toBe(keyName);
    expect(typeof header.nonce).toBe("string");
  });

  test("payload contiene iss=cdp, sub=keyName, uri con método y ruta", () => {
    const jwt = buildJWT(keyName, ecKeyPemSec1, "GET", "/api/v3/brokerage/accounts");
    const parts = jwt.split(".");
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());

    expect(payload.iss).toBe("cdp");
    expect(payload.sub).toBe(keyName);
    expect(payload.uri).toBe("GET api.coinbase.com/api/v3/brokerage/accounts");
    expect(typeof payload.nbf).toBe("number");
    expect(typeof payload.exp).toBe("number");
    expect(payload.exp - payload.nbf).toBe(120);
  });

  test("cada llamada genera un JWT distinto (nonce diferente)", () => {
    const jwt1 = buildJWT(keyName, ecKeyPemSec1, "GET", "/api/v3/brokerage/accounts");
    const jwt2 = buildJWT(keyName, ecKeyPemSec1, "GET", "/api/v3/brokerage/accounts");
    expect(jwt1).not.toBe(jwt2);

    const nonce1 = JSON.parse(Buffer.from(jwt1.split(".")[0], "base64url").toString()).nonce;
    const nonce2 = JSON.parse(Buffer.from(jwt2.split(".")[0], "base64url").toString()).nonce;
    expect(nonce1).not.toBe(nonce2);
  });

  test("URI incluye el método y la ruta exactos (no otra ruta)", () => {
    const jwtFills = buildJWT(keyName, ecKeyPemSec1, "GET", "/api/v3/brokerage/orders/historical/fills");
    const payload = JSON.parse(Buffer.from(jwtFills.split(".")[1], "base64url").toString());
    expect(payload.uri).toContain("/api/v3/brokerage/orders/historical/fills");
    expect(payload.uri).not.toContain("/accounts");
  });

  test("JWT no acepta clave no-EC (lanza si la clave es inválida)", () => {
    expect(() => buildJWT(keyName, "not-a-pem", "GET", "/test")).toThrow();
  });
});
