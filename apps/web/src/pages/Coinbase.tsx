import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../components/Button";
import { Badge } from "../components/Badge";
import type { CdpImportResult } from "@crypto-control/core";

type ConnectionState = "checking" | "disconnected" | "connecting" | "connected" | "syncing" | "error";
type ImportMode = "none" | "paste";

interface SyncStatus {
  lastSyncAt: number | null;
  lastSyncItemsProcessed: number | null;
  lastSyncStatus: "success" | "error" | null;
  lastSyncError: string | null;
}

interface ConnectedKeyInfo {
  keyDisplayName: string;
  algorithm: string;
  permissions?: { canView: boolean; canTrade: boolean; canTransfer: boolean };
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleString("es-ES", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// Map structured error codes to user-friendly messages
function humanizeError(code: string, message: string, httpStatus?: number): string {
  const codeMessages: Record<string, string> = {
    UNAUTHORIZED:             "Credenciales no aceptadas (401). Verifica que la clave no haya sido revocada y que el archivo JSON es el correcto.",
    INSUFFICIENT_PERMISSIONS: "La clave no tiene permisos suficientes. Asegúrate de que tiene activado el permiso de lectura (can_view).",
    IP_RESTRICTED:            "Este dispositivo no está en la lista de IPs permitidas para esta API Key. Actualiza la allowlist en Coinbase Developer Platform.",
    INVALID_JWT_SIGNATURE:    "La firma del JWT no fue aceptada. Verifica que la clave privada corresponde a esta API Key y que el archivo no fue modificado.",
    CLOCK_SKEW:               "El reloj del sistema puede estar desincronizado. Verifica la fecha y hora del Mac y vuelve a intentarlo.",
    RATE_LIMITED:             "Demasiadas peticiones (429). Espera unos segundos antes de volver a intentarlo.",
    NETWORK_ERROR:            "No se pudo conectar con Coinbase. Verifica tu conexión a internet.",
    KEY_ED25519_INCOMPATIBLE: "Esta clave usa ED25519, incompatible con Coinbase Advanced Trade. Crea una nueva clave ECDSA de solo lectura.",
    KEY_WRONG_CURVE:          "La clave EC no usa la curva P-256 requerida para ES256. Crea una nueva clave CDP seleccionando ECDSA.",
    KEY_NOT_EC:               "La clave privada no es EC (ECDSA). Se requiere una clave ECDSA P-256.",
    PEM_INVALID:              "La clave privada no es un PEM válido. Verifica que el archivo no esté corrupto o modificado.",
    FIELDS_MISSING:           "El archivo JSON no tiene los campos requeridos. Asegúrate de que sea el archivo oficial de Coinbase Developer Platform.",
    KEY_NAME_INCOMPLETE:      "El identificador de la clave está incompleto. Se requiere el formato organizations/{org}/apiKeys/{key}.",
    JSON_INVALID:             "El archivo no contiene JSON válido. Comprueba que no esté corrupto.",
    JSON_EMPTY:               "El archivo está vacío.",
  };
  if (httpStatus) {
    return codeMessages[code] ?? `${message} (${httpStatus})`;
  }
  return codeMessages[code] ?? message;
}

const STATE_LABEL: Record<ConnectionState, string> = {
  checking:     "Verificando...",
  disconnected: "No conectado",
  connecting:   "Conectando...",
  connected:    "Conectado",
  syncing:      "Sincronizando...",
  error:        "Error",
};

const STATE_VARIANT: Record<ConnectionState, "neutral" | "success" | "warning" | "danger"> = {
  checking:     "neutral",
  disconnected: "neutral",
  connecting:   "warning",
  connected:    "success",
  syncing:      "warning",
  error:        "danger",
};

function PermissionRow({ label, active }: { label: string; active: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.875rem" }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%",
        background: active ? "var(--color-success)" : "var(--color-danger)",
        flexShrink: 0,
      }} />
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span style={{ color: active ? "var(--color-success-text)" : "var(--color-danger)", fontWeight: 600 }}>
        {active ? "Activado" : "Desactivado"}
      </span>
    </div>
  );
}

export function Coinbase() {
  const queryClient = useQueryClient();

  const [connectionState, setConnectionState] = useState<ConnectionState>("checking");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    lastSyncAt: null, lastSyncItemsProcessed: null, lastSyncStatus: null, lastSyncError: null,
  });
  const [keyInfo, setKeyInfo]       = useState<ConnectedKeyInfo | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>("none");
  const [errorMsg, setErrorMsg]     = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [warnMsg, setWarnMsg]       = useState("");

  const pasteRef = useRef<HTMLTextAreaElement>(null);

  const applyStatus = (result: Awaited<ReturnType<typeof window.cryptoControl.coinbase.getStatus>>) => {
    if (result.ok) {
      const { connected, lastSyncAt, lastSyncItemsProcessed, lastSyncStatus, lastSyncError,
              keyDisplayName, algorithm } = result.data;
      setConnectionState(connected ? "connected" : "disconnected");
      setSyncStatus({ lastSyncAt, lastSyncItemsProcessed, lastSyncStatus, lastSyncError });
      if (connected && keyDisplayName) {
        setKeyInfo(prev => ({
          keyDisplayName,
          algorithm: algorithm ?? "ES256",
          permissions: prev?.permissions,
        }));
      }
    } else {
      setConnectionState("disconnected");
    }
  };

  const loadStatus = async () => {
    const result = await window.cryptoControl.coinbase.getStatus();
    applyStatus(result);
  };

  useEffect(() => {
    let cancelled = false;
    window.cryptoControl.coinbase.getStatus().then(result => {
      if (!cancelled) applyStatus(result);
    });
    return () => { cancelled = true; };
  }, []); // applyStatus is stable (closes over setters only)

  const applyImportResult = (data: CdpImportResult) => {
    setConnectionState("connected");
    setImportMode("none");
    setKeyInfo({
      keyDisplayName: data.keyDisplayName,
      algorithm:      data.algorithm,
      permissions:    data.permissions,
    });

    const extraPerms: string[] = [];
    if (data.permissions.canTrade)    extraPerms.push("operaciones");
    if (data.permissions.canTransfer) extraPerms.push("transferencias");
    if (extraPerms.length > 0) {
      setWarnMsg(
        `Por seguridad, se recomienda crear una clave exclusivamente de lectura. ` +
        `Esta clave tiene permisos adicionales activados: ${extraPerms.join(", ")}.`
      );
    }

    setSuccessMsg("Conectado correctamente a Coinbase.");
    loadStatus();
  };

  const handleImportFile = async () => {
    setConnectionState("connecting");
    setErrorMsg("");
    setSuccessMsg("");
    setWarnMsg("");

    const result = await window.cryptoControl.coinbase.importCredentialsFile();

    if (!result.ok) {
      setConnectionState("error");
      setErrorMsg(humanizeError(result.error.code, result.error.message, result.error.httpStatus));
      return;
    }

    if (result.data.canceled) {
      setConnectionState("disconnected");
      return;
    }

    applyImportResult(result.data);
  };

  const handlePasteSubmit = async () => {
    const jsonContent = pasteRef.current?.value ?? "";
    if (!jsonContent.trim()) {
      setErrorMsg("Pega el contenido JSON antes de continuar.");
      return;
    }

    setConnectionState("connecting");
    setErrorMsg("");
    setSuccessMsg("");
    setWarnMsg("");

    // Clear textarea immediately — before sending to main process
    if (pasteRef.current) pasteRef.current.value = "";

    const result = await window.cryptoControl.coinbase.connectFromJson(jsonContent);

    if (!result.ok) {
      setConnectionState("error");
      setErrorMsg(humanizeError(result.error.code, result.error.message, result.error.httpStatus));
      return;
    }

    applyImportResult(result.data);
  };

  const handleDisconnect = async () => {
    if (!confirm("¿Desconectar Coinbase? Se eliminarán las credenciales del llavero.")) return;
    await window.cryptoControl.coinbase.disconnect();
    setConnectionState("disconnected");
    setKeyInfo(null);
    setSyncStatus({ lastSyncAt: null, lastSyncItemsProcessed: null, lastSyncStatus: null, lastSyncError: null });
    setSuccessMsg("Coinbase desconectado y credenciales eliminadas.");
    setWarnMsg("");
    setErrorMsg("");
  };

  const handleSync = async () => {
    setConnectionState("syncing");
    setErrorMsg("");
    setSuccessMsg("");

    const result = await window.cryptoControl.coinbase.sync();

    if (result.ok) {
      const { newTransactions, skippedDuplicates, itemsProcessed } = result.data;
      setSuccessMsg(
        `Sincronización completada: ${newTransactions} nuevas operaciones importadas, ` +
        `${skippedDuplicates} duplicadas omitidas (${itemsProcessed} procesadas en total).`
      );
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      await loadStatus();
      setConnectionState("connected");
    } else {
      setConnectionState("connected");
      setErrorMsg(humanizeError(result.error.code, result.error.message, result.error.httpStatus));
      await loadStatus();
    }
  };

  const isBusy       = connectionState === "connecting" || connectionState === "syncing" || connectionState === "checking";
  const isConnected  = connectionState === "connected";
  const isDisconnected = connectionState === "disconnected" || connectionState === "error";

  return (
    <div>
      <h1 className="page-title">Coinbase</h1>

      {/* Estado + acciones */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <Badge variant={STATE_VARIANT[connectionState]}>{STATE_LABEL[connectionState]}</Badge>
          {isConnected && keyInfo && (
            <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)", fontFamily: "var(--font-mono, monospace)" }}>
              Clave: {keyInfo.keyDisplayName}
            </span>
          )}
        </div>

        {errorMsg   && <div className="banner banner-error"   style={{ marginBottom: 12 }}>{errorMsg}</div>}
        {successMsg && <div className="banner banner-success" style={{ marginBottom: 12 }}>{successMsg}</div>}
        {warnMsg    && <div className="banner banner-warning" style={{ marginBottom: 12 }}>{warnMsg}</div>}

        {/* Información de la clave conectada */}
        {isConnected && keyInfo && (
          <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
              Tipo de clave:{" "}
              <strong style={{ color: "var(--text-primary)" }}>ECDSA · {keyInfo.algorithm}</strong>
            </div>
            {keyInfo.permissions && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <PermissionRow label="Lectura"        active={keyInfo.permissions.canView} />
                <PermissionRow label="Operaciones"    active={keyInfo.permissions.canTrade} />
                <PermissionRow label="Transferencias" active={keyInfo.permissions.canTransfer} />
              </div>
            )}
          </div>
        )}

        {/* Última sincronización */}
        {syncStatus.lastSyncAt && (
          <div style={{ marginBottom: 16, fontSize: "0.875rem", color: "var(--text-secondary)" }}>
            Última sincronización:{" "}
            <strong style={{ color: "var(--text-primary)" }}>{formatDate(syncStatus.lastSyncAt)}</strong>
            {syncStatus.lastSyncItemsProcessed !== null && (
              <> · <strong style={{ color: "var(--text-primary)" }}>{syncStatus.lastSyncItemsProcessed}</strong> procesadas</>
            )}
            {syncStatus.lastSyncStatus === "error" && syncStatus.lastSyncError && (
              <div style={{ color: "var(--color-danger)", marginTop: 4 }}>
                Error: {syncStatus.lastSyncError}
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {isConnected && (
            <>
              <Button onClick={handleSync} loading={isBusy} disabled={isBusy}>
                {isBusy ? "Sincronizando..." : "Sincronizar ahora"}
              </Button>
              <Button variant="danger" onClick={handleDisconnect} disabled={isBusy}>
                Desconectar
              </Button>
            </>
          )}
          {isBusy && !isConnected && (
            <span style={{ fontSize: "0.875rem", color: "var(--text-secondary)", alignSelf: "center" }}>
              Por favor espera...
            </span>
          )}
        </div>
      </div>

      {/* Formulario de conexión */}
      {isDisconnected && (
        <div className="card" style={{ marginBottom: 20 }}>
          <p className="section-title" style={{ marginBottom: 8 }}>Conectar Coinbase</p>
          <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", marginBottom: 20, lineHeight: 1.6 }}>
            Importa directamente el archivo JSON descargado desde{" "}
            <strong>Coinbase Developer Platform › API Keys</strong>.
            Crea una clave con el algoritmo <strong>ECDSA</strong> y permisos de <strong>solo lectura (View)</strong>.
          </p>

          {/* Opción principal */}
          <Button
            variant="primary"
            onClick={handleImportFile}
            disabled={isBusy}
            loading={isBusy && importMode === "none"}
            style={{ width: "100%", marginBottom: 12 }}
          >
            Seleccionar archivo JSON de CDP
          </Button>

          {importMode === "none" && (
            <>
              <div style={{
                display: "flex", alignItems: "center", gap: 12, marginBottom: 12,
                color: "var(--text-muted)", fontSize: "0.85rem",
              }}>
                <hr style={{ flex: 1, border: "none", borderTop: "1px solid var(--border)" }} />
                o
                <hr style={{ flex: 1, border: "none", borderTop: "1px solid var(--border)" }} />
              </div>
              <Button
                variant="secondary"
                onClick={() => { setImportMode("paste"); setErrorMsg(""); }}
                disabled={isBusy}
                style={{ width: "100%" }}
              >
                Pegar JSON de credenciales
              </Button>
            </>
          )}

          {/* Opción secundaria: pegar JSON */}
          {importMode === "paste" && (
            <div style={{ marginTop: 4 }}>
              <div className="form-group">
                <label htmlFor="cb-paste-json">
                  Pega aquí el contenido completo del archivo JSON de CDP
                </label>
                <textarea
                  id="cb-paste-json"
                  ref={pasteRef}
                  rows={8}
                  placeholder={'{\n  "name": "organizations/.../apiKeys/...",\n  "privateKey": "-----BEGIN EC PRIVATE KEY-----\\n..."\n}'}
                  autoComplete="off"
                  spellCheck={false}
                  style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: "0.8rem" }}
                />
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <Button onClick={handlePasteSubmit} disabled={isBusy} loading={isBusy}>
                  Conectar
                </Button>
                <Button variant="ghost" onClick={() => { setImportMode("none"); setErrorMsg(""); }} disabled={isBusy}>
                  Cancelar
                </Button>
              </div>
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 10, lineHeight: 1.5 }}>
                El JSON se procesa exclusivamente en el proceso principal. Nunca se almacena en la base de datos
                ni queda accesible desde DevTools.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Información */}
      <div className="card">
        <p className="section-title">Acerca de la integración</p>
        <ul style={{ fontSize: "0.875rem", color: "var(--text-secondary)", lineHeight: 2, paddingLeft: 20, margin: 0 }}>
          <li>Importa automáticamente compras, ventas y conversiones de Coinbase</li>
          <li>La sincronización es incremental: solo importa operaciones nuevas</li>
          <li>Las operaciones duplicadas se detectan y omiten automáticamente</li>
          <li>Los valores en EUR se calculan a partir del precio de ejecución</li>
          <li>Los pares cripto/cripto se marcan como pendientes de valoración EUR</li>
        </ul>
      </div>
    </div>
  );
}
