import { describe, test, expect, beforeAll } from "vitest";
import * as crypto from "crypto";
import { parseCdpJson, normalizePrivateKey, CdpParseError } from "./cdp-parser";
import { buildJWT, CoinbaseApiError } from "./client";

// ── Generate real test keys once ────────────────────────────────────────────

let ecP256Private: crypto.KeyObject;
let ecP256KeyPemSec1: string;  // BEGIN EC PRIVATE KEY (SEC1)
let ecP256KeyPemPkcs8: string; // BEGIN PRIVATE KEY (PKCS#8)
let ecP256PublicKey: crypto.KeyObject;
let ecP384KeyPemSec1: string;  // Wrong curve (P-384)
let ed25519KeyPem: string;
let keyName: string;

beforeAll(() => {
  // P-256 keys
  const { privateKey: pk256, publicKey: pub256 } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  ecP256Private     = pk256;
  ecP256PublicKey   = pub256;
  ecP256KeyPemSec1  = pk256.export({ type: "sec1",  format: "pem" }) as string;
  ecP256KeyPemPkcs8 = pk256.export({ type: "pkcs8", format: "pem" }) as string;

  // P-384 key (wrong curve — secp384r1 is the OpenSSL name Node.js accepts)
  const { privateKey: pk384 } = crypto.generateKeyPairSync("ec", { namedCurve: "secp384r1" });
  ecP384KeyPemSec1 = pk384.export({ type: "sec1", format: "pem" }) as string;

  // Ed25519 key
  const { privateKey: edKey } = crypto.generateKeyPairSync("ed25519");
  ed25519KeyPem = edKey.export({ type: "pkcs8", format: "pem" }) as string;

  keyName = "organizations/test-org-uuid/apiKeys/test-key-id-abcd";
});

function makeJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ name: keyName, privateKey: ecP256KeyPemSec1, ...overrides });
}

// ── Group A — JSON formats ───────────────────────────────────────────────────

describe("parseCdpJson — formatos JSON", () => {
  test("archivo oficial con `name` y `privateKey`", () => {
    const r = parseCdpJson(makeJson());
    expect(r.keyName).toBe(keyName);
    expect(r.algorithm).toBe("ES256");
    expect(r.keyDisplayName).toMatch(/^••••/);
  });

  test("alias `keyName`", () => {
    expect(parseCdpJson(JSON.stringify({ keyName, privateKey: ecP256KeyPemSec1 })).keyName).toBe(keyName);
  });

  test("alias `apiKeyId`", () => {
    expect(parseCdpJson(JSON.stringify({ apiKeyId: keyName, privateKey: ecP256KeyPemSec1 })).keyName).toBe(keyName);
  });

  test("alias `id` con formato completo", () => {
    expect(parseCdpJson(JSON.stringify({ id: keyName, privateKey: ecP256KeyPemSec1 })).keyName).toBe(keyName);
  });

  test("alias `apiKeySecret`", () => {
    const r = parseCdpJson(JSON.stringify({ name: keyName, apiKeySecret: ecP256KeyPemSec1 }));
    expect(r.keyDisplayName).toMatch(/^••••/);
  });

  test("UUID aislado en `id` → KEY_NAME_INCOMPLETE", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    try {
      parseCdpJson(JSON.stringify({ id: uuid, privateKey: ecP256KeyPemSec1 }));
      expect.fail("debería lanzar");
    } catch (e) {
      expect((e as CdpParseError).code).toBe("KEY_NAME_INCOMPLETE");
    }
  });

  test("JSON mal formado → JSON_INVALID", () => {
    try {
      parseCdpJson("{not valid");
      expect.fail();
    } catch (e) {
      expect((e as CdpParseError).code).toBe("JSON_INVALID");
    }
  });

  test("cadena vacía → JSON_EMPTY", () => {
    try {
      parseCdpJson("");
      expect.fail();
    } catch (e) {
      expect((e as CdpParseError).code).toBe("JSON_EMPTY");
    }
  });

  test("campos ausentes (sin privateKey) → FIELDS_MISSING", () => {
    try {
      parseCdpJson(JSON.stringify({ name: keyName }));
      expect.fail();
    } catch (e) {
      expect((e as CdpParseError).code).toBe("FIELDS_MISSING");
    }
  });

  test("identificador incorrecto → KEY_NAME_FORMAT_INVALID", () => {
    try {
      parseCdpJson(JSON.stringify({ name: "bad-format", privateKey: ecP256KeyPemSec1 }));
      expect.fail();
    } catch (e) {
      expect((e as CdpParseError).code).toBe("KEY_NAME_FORMAT_INVALID");
    }
  });
});

// ── Group B — normalización de PEM ──────────────────────────────────────────

describe("parseCdpJson — normalización de PEM", () => {
  test("PEM con saltos de línea reales (\\n)", () => {
    const r = parseCdpJson(makeJson());
    expect(r.privateKeyPem).toContain("-----BEGIN");
  });

  test("PEM con \\\\n escapados en el JSON (formato CDP descargado)", () => {
    // In the downloaded CDP JSON, the PEM is stored with literal \n chars (escaped in JSON)
    // JSON.stringify will escape the backslash again, simulating what CDP does
    const oneLiner = ecP256KeyPemSec1.replace(/\n/g, "\\n");
    const json = `{"name":${JSON.stringify(keyName)},"privateKey":${JSON.stringify(oneLiner)}}`;
    const r = parseCdpJson(json);
    expect(r.privateKeyPem).toContain("\n");
    expect(r.privateKeyPem).not.toContain("\\n");
  });

  test("PEM con CRLF → normalizado a LF", () => {
    const crlfPem = ecP256KeyPemSec1.replace(/\n/g, "\r\n");
    const r = parseCdpJson(makeJson({ privateKey: crlfPem }));
    expect(r.privateKeyPem).not.toContain("\r");
  });

  test("normalizePrivateKey: convierte \\\\n a saltos reales", () => {
    const escaped = ecP256KeyPemSec1.replace(/\n/g, "\\n");
    expect(normalizePrivateKey(escaped)).toContain("\n");
    expect(normalizePrivateKey(escaped)).not.toContain("\\n");
  });

  test("normalizePrivateKey: CRLF → LF", () => {
    const crlf = ecP256KeyPemSec1.replace(/\n/g, "\r\n");
    expect(normalizePrivateKey(crlf)).not.toContain("\r");
  });

  test("normalizePrivateKey: añade \\n final", () => {
    expect(normalizePrivateKey(ecP256KeyPemSec1.trim()).endsWith("\n")).toBe(true);
  });
});

// ── Group C — validación criptográfica + curva ───────────────────────────────

describe("parseCdpJson — validación EC P-256", () => {
  test("SEC1 EC P-256 (BEGIN EC PRIVATE KEY) aceptado", () => {
    expect(parseCdpJson(makeJson({ privateKey: ecP256KeyPemSec1 })).algorithm).toBe("ES256");
  });

  test("PKCS#8 EC P-256 (BEGIN PRIVATE KEY) aceptado", () => {
    expect(parseCdpJson(makeJson({ privateKey: ecP256KeyPemPkcs8 })).algorithm).toBe("ES256");
  });

  test("curva P-384 (incorrecta) → KEY_WRONG_CURVE", () => {
    try {
      parseCdpJson(makeJson({ privateKey: ecP384KeyPemSec1 }));
      expect.fail("debería lanzar");
    } catch (e) {
      expect((e as CdpParseError).code).toBe("KEY_WRONG_CURVE");
      expect((e as CdpParseError).message).toContain("P-256");
    }
  });

  test("clave Ed25519 → KEY_ED25519_INCOMPATIBLE con instrucciones", () => {
    try {
      parseCdpJson(makeJson({ privateKey: ed25519KeyPem }));
      expect.fail("debería lanzar");
    } catch (e) {
      const err = e as CdpParseError;
      expect(err.code).toBe("KEY_ED25519_INCOMPATIBLE");
      expect(err.message).toContain("ECDSA");
    }
  });

  test("PEM corrupto → PEM_INVALID", () => {
    const bad = "-----BEGIN EC PRIVATE KEY-----\nZZZZZ\n-----END EC PRIVATE KEY-----\n";
    try {
      parseCdpJson(makeJson({ privateKey: bad }));
      expect.fail();
    } catch (e) {
      expect((e as CdpParseError).code).toBe("PEM_INVALID");
    }
  });
});

// ── Group D — JWT ES256 P1363 ────────────────────────────────────────────────

describe("buildJWT — firma ES256 P1363", () => {
  test("firma tiene exactamente 64 bytes (32 R + 32 S para P-256)", () => {
    // Extract signature bytes from the generated JWT
    const jwt   = buildJWT(keyName, ecP256KeyPemSec1, "GET", "/api/v3/brokerage/key_permissions");
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);
    const sigBytes = Buffer.from(parts[2], "base64url");
    expect(sigBytes.length).toBe(64);
  });

  test("firma en formato DER tendría longitud != 64 (documenta la diferencia)", () => {
    // DER-encoded ECDSA signatures are variable length (typically 70-72 bytes for P-256)
    // This test shows that ieee-p1363 (64 bytes) is different from DER
    const privateKey = crypto.createPrivateKey(ecP256KeyPemSec1);
    const derSig = crypto.sign("sha256", Buffer.from("test"), {
      key: privateKey,
      dsaEncoding: "der",   // default — wrong for JWS
    });
    const p1363Sig = crypto.sign("sha256", Buffer.from("test"), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    });
    expect(p1363Sig.length).toBe(64);
    expect(derSig.length).not.toBe(64); // DER is variable, typically 70-72
  });

  test("JWT verificable con la clave pública correspondiente", () => {
    const jwt   = buildJWT(keyName, ecP256KeyPemSec1, "GET", "/api/v3/brokerage/accounts");
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);

    const signingInput = `${parts[0]}.${parts[1]}`;
    const sigBytes     = Buffer.from(parts[2], "base64url");

    const valid = crypto.verify(
      "sha256",
      Buffer.from(signingInput, "utf8"),
      { key: ecP256PublicKey, dsaEncoding: "ieee-p1363" },
      sigBytes
    );
    expect(valid).toBe(true);
  });

  test("header contiene alg=ES256, typ=JWT, kid=fullKeyName, nonce", () => {
    const jwt    = buildJWT(keyName, ecP256KeyPemSec1, "GET", "/api/v3/brokerage/key_permissions");
    const header = JSON.parse(Buffer.from(jwt.split(".")[0], "base64url").toString());
    expect(header.alg).toBe("ES256");
    expect(header.typ).toBe("JWT");
    expect(header.kid).toBe(keyName);
    expect(typeof header.nonce).toBe("string");
    expect(header.nonce.length).toBeGreaterThan(0);
  });

  test("payload contiene iss=cdp, sub=fullKeyName, exp-nbf=120", () => {
    const jwt     = buildJWT(keyName, ecP256KeyPemSec1, "GET", "/api/v3/brokerage/key_permissions");
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
    expect(payload.iss).toBe("cdp");
    expect(payload.sub).toBe(keyName);
    expect(payload.exp - payload.nbf).toBe(120);
    expect(typeof payload.nbf).toBe("number");
  });

  test("URI firmada es exactamente: METHOD api.coinbase.com/PATH (sin https://)", () => {
    const jwt     = buildJWT(keyName, ecP256KeyPemSec1, "GET", "/api/v3/brokerage/key_permissions");
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
    expect(payload.uri).toBe("GET api.coinbase.com/api/v3/brokerage/key_permissions");
    expect(payload.uri).not.toContain("https://");
    expect(payload.uri).not.toContain("http://");
  });

  test("cada llamada genera un JWT distinto (nonce único)", () => {
    const j1 = buildJWT(keyName, ecP256KeyPemSec1, "GET", "/api/v3/brokerage/accounts");
    const j2 = buildJWT(keyName, ecP256KeyPemSec1, "GET", "/api/v3/brokerage/accounts");
    expect(j1).not.toBe(j2);
    const n1 = JSON.parse(Buffer.from(j1.split(".")[0], "base64url").toString()).nonce;
    const n2 = JSON.parse(Buffer.from(j2.split(".")[0], "base64url").toString()).nonce;
    expect(n1).not.toBe(n2);
  });

  test("kid y sub son el nombre completo (no solo el UUID final)", () => {
    const jwt     = buildJWT(keyName, ecP256KeyPemSec1, "GET", "/api/v3/brokerage/accounts");
    const header  = JSON.parse(Buffer.from(jwt.split(".")[0], "base64url").toString());
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
    expect(header.kid).toMatch(/^organizations\//);
    expect(payload.sub).toMatch(/^organizations\//);
  });

  test("URI de key_permissions distinta de la de accounts", () => {
    const jwtPerms    = buildJWT(keyName, ecP256KeyPemSec1, "GET", "/api/v3/brokerage/key_permissions");
    const jwtAccounts = buildJWT(keyName, ecP256KeyPemSec1, "GET", "/api/v3/brokerage/accounts");
    const uriPerms    = JSON.parse(Buffer.from(jwtPerms.split(".")[1], "base64url").toString()).uri;
    const uriAccounts = JSON.parse(Buffer.from(jwtAccounts.split(".")[1], "base64url").toString()).uri;
    expect(uriPerms).not.toBe(uriAccounts);
    expect(uriPerms).toContain("key_permissions");
    expect(uriAccounts).toContain("accounts");
  });

  test("lanza si la clave PEM es inválida", () => {
    expect(() => buildJWT(keyName, "not-a-pem", "GET", "/test")).toThrow();
  });
});

// ── Group E — CoinbaseApiError ───────────────────────────────────────────────

describe("CoinbaseApiError — redacción y códigos", () => {
  test("mensaje no contiene clave privada", () => {
    const err = new CoinbaseApiError("UNAUTHORIZED", "Error de autenticación.");
    expect(err.message).not.toContain("BEGIN");
    expect(err.message).not.toContain("PRIVATE KEY");
  });

  test("httpStatus se preserva", () => {
    const err = new CoinbaseApiError("UNAUTHORIZED", "401 error", 401);
    expect(err.httpStatus).toBe(401);
    expect(err.code).toBe("UNAUTHORIZED");
  });

  test("correlationId se preserva", () => {
    const err = new CoinbaseApiError("SERVER_ERROR", "500", 500, "corr-xyz");
    expect(err.correlationId).toBe("corr-xyz");
  });
});

// ── Group F — seguridad ──────────────────────────────────────────────────────

describe("parseCdpJson — seguridad", () => {
  test("keyDisplayName no contiene la clave privada", () => {
    const r = parseCdpJson(makeJson());
    expect(r.keyDisplayName).not.toContain("BEGIN");
    expect(r.keyDisplayName).not.toContain("KEY");
    expect(r.keyDisplayName.length).toBeLessThan(20);
  });

  test("los errores no reproducen la clave privada", () => {
    try {
      parseCdpJson(JSON.stringify({ name: "bad", privateKey: ecP256KeyPemSec1 }));
    } catch (e) {
      expect((e as Error).message).not.toContain(ecP256KeyPemSec1.slice(30, 60));
    }
  });

  test("keyDisplayName muestra ••••{last4}", () => {
    const r = parseCdpJson(makeJson());
    // keyName ends with "test-key-id-abcd"
    expect(r.keyDisplayName).toBe("••••abcd");
  });
});
