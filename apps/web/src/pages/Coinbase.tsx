import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

type ConnectionState =
  | "checking"
  | "disconnected"
  | "connecting"
  | "connected"
  | "syncing"
  | "error";

interface SyncStatus {
  lastSyncAt: number | null;
  lastSyncItemsProcessed: number | null;
  lastSyncStatus: "success" | "error" | null;
  lastSyncError: string | null;
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function Coinbase() {
  const queryClient = useQueryClient();
  const [connectionState, setConnectionState] = useState<ConnectionState>("checking");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    lastSyncAt: null,
    lastSyncItemsProcessed: null,
    lastSyncStatus: null,
    lastSyncError: null,
  });
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Form fields - never persisted outside this component
  const keyNameRef = useRef<HTMLInputElement>(null);
  const privateKeyRef = useRef<HTMLTextAreaElement>(null);
  const [formVisible, setFormVisible] = useState(false);

  const loadStatus = async () => {
    const result = await window.cryptoControl.coinbase.getStatus();
    if (result.ok) {
      const { connected, lastSyncAt, lastSyncItemsProcessed, lastSyncStatus, lastSyncError } =
        result.data;
      setConnectionState(connected ? "connected" : "disconnected");
      setSyncStatus({ lastSyncAt, lastSyncItemsProcessed, lastSyncStatus, lastSyncError });
    } else {
      setConnectionState("disconnected");
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const handleConnect = async () => {
    const apiKeyName = keyNameRef.current?.value?.trim() ?? "";
    const privateKeyPem = privateKeyRef.current?.value?.trim() ?? "";

    if (!apiKeyName || !privateKeyPem) {
      setErrorMsg("Introduce el nombre de la API Key y la clave privada.");
      return;
    }

    if (!privateKeyPem.includes("BEGIN")) {
      setErrorMsg("La clave privada debe estar en formato PEM (-----BEGIN ...).");
      return;
    }

    setConnectionState("connecting");
    setErrorMsg("");
    setSuccessMsg("");

    const result = await window.cryptoControl.coinbase.connect({ apiKeyName, privateKeyPem });

    // Clear sensitive form data immediately after submission
    if (keyNameRef.current) keyNameRef.current.value = "";
    if (privateKeyRef.current) privateKeyRef.current.value = "";

    if (result.ok) {
      setConnectionState("connected");
      setFormVisible(false);
      setSuccessMsg("Conectado correctamente a Coinbase.");
      await loadStatus();
    } else {
      setConnectionState("disconnected");
      setErrorMsg("No se pudo conectar. Verifica las credenciales e inténtalo de nuevo.");
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("¿Desconectar Coinbase? Se eliminarán las credenciales del llavero.")) return;

    await window.cryptoControl.coinbase.disconnect();
    setConnectionState("disconnected");
    setSyncStatus({ lastSyncAt: null, lastSyncItemsProcessed: null, lastSyncStatus: null, lastSyncError: null });
    setSuccessMsg("Coinbase desconectado y credenciales eliminadas.");
  };

  const handleSync = async () => {
    setConnectionState("syncing");
    setErrorMsg("");
    setSuccessMsg("");

    const result = await window.cryptoControl.coinbase.sync();

    if (result.ok) {
      const { newTransactions, skippedDuplicates, itemsProcessed } = result.data;
      setSuccessMsg(
        `Sincronización completada: ${newTransactions} nuevas operaciones importadas, ${skippedDuplicates} duplicadas omitidas (${itemsProcessed} procesadas en total).`
      );
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      await loadStatus();
      setConnectionState("connected");
    } else {
      setConnectionState("connected");
      setErrorMsg("Error durante la sincronización. Revisa los registros o inténtalo de nuevo.");
      await loadStatus();
    }
  };

  const stateLabel: Record<ConnectionState, string> = {
    checking: "Verificando...",
    disconnected: "No conectado",
    connecting: "Conectando...",
    connected: "Conectado",
    syncing: "Sincronizando...",
    error: "Error de autenticación",
  };

  const stateColor: Record<ConnectionState, string> = {
    checking: "#6B7280",
    disconnected: "#6B7280",
    connecting: "#F59E0B",
    connected: "#10B981",
    syncing: "#3B82F6",
    error: "#EF4444",
  };

  const isBusy = connectionState === "connecting" || connectionState === "syncing" || connectionState === "checking";

  return (
    <div className="operaciones-page">
      <h1 className="page-title">Coinbase</h1>

      {/* Status card */}
      <div className="card" style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
          <div
            style={{
              width: "12px",
              height: "12px",
              borderRadius: "50%",
              backgroundColor: stateColor[connectionState],
              flexShrink: 0,
            }}
          />
          <span style={{ fontWeight: 600, fontSize: "1rem" }}>{stateLabel[connectionState]}</span>
        </div>

        {errorMsg && (
          <div className="error-banner" style={{ marginBottom: "12px" }}>
            {errorMsg}
          </div>
        )}
        {successMsg && (
          <div
            style={{
              marginBottom: "12px",
              padding: "10px 14px",
              backgroundColor: "#D1FAE5",
              color: "#065F46",
              borderRadius: "var(--radius-md)",
              fontSize: "0.9rem",
            }}
          >
            {successMsg}
          </div>
        )}

        {syncStatus.lastSyncAt && (
          <div style={{ marginBottom: "16px", fontSize: "0.875rem", color: "var(--text-secondary)" }}>
            <div>
              Última sincronización:{" "}
              <strong style={{ color: "var(--text-primary)" }}>
                {formatDate(syncStatus.lastSyncAt)}
              </strong>
            </div>
            {syncStatus.lastSyncItemsProcessed !== null && (
              <div>
                Operaciones importadas:{" "}
                <strong style={{ color: "var(--text-primary)" }}>
                  {syncStatus.lastSyncItemsProcessed}
                </strong>
              </div>
            )}
            {syncStatus.lastSyncStatus === "error" && syncStatus.lastSyncError && (
              <div style={{ color: "#EF4444", marginTop: "4px" }}>
                Error: {syncStatus.lastSyncError}
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          {connectionState === "connected" && (
            <>
              <button
                onClick={handleSync}
                disabled={isBusy}
                style={{ backgroundColor: "var(--accent)", color: "#fff", border: "none" }}
              >
                {connectionState === "syncing" ? "Sincronizando..." : "Sincronizar ahora"}
              </button>
              <button
                onClick={handleDisconnect}
                disabled={isBusy}
                style={{
                  backgroundColor: "transparent",
                  border: "1px solid #EF4444",
                  color: "#EF4444",
                }}
              >
                Desconectar
              </button>
            </>
          )}

          {connectionState === "disconnected" && (
            <button onClick={() => setFormVisible((v) => !v)} disabled={isBusy}>
              {formVisible ? "Cancelar" : "Conectar con Coinbase"}
            </button>
          )}

          {isBusy && (
            <span style={{ fontSize: "0.875rem", color: "var(--text-secondary)", alignSelf: "center" }}>
              {connectionState === "syncing" ? "Importando operaciones..." : "Por favor espera..."}
            </span>
          )}
        </div>
      </div>

      {/* Connection form */}
      {formVisible && connectionState === "disconnected" && (
        <div className="card" style={{ marginBottom: "24px" }}>
          <h3 style={{ marginBottom: "8px" }}>Credenciales de Coinbase CDP API</h3>
          <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "16px", lineHeight: "1.5" }}>
            Crea una API Key de solo lectura en{" "}
            <strong>Coinbase Developer Platform &gt; API Keys</strong>. Selecciona únicamente el
            permiso <strong>View</strong>. Las credenciales se guardarán en el llavero de macOS y
            nunca serán visibles una vez enviadas.
          </p>

          <div className="form-group">
            <label htmlFor="cb-key-name">Nombre de la API Key (Key Name)</label>
            <input
              id="cb-key-name"
              ref={keyNameRef}
              type="text"
              placeholder="organizations/xxx/apiKeys/yyy"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="form-group">
            <label htmlFor="cb-private-key">Clave Privada EC (PEM)</label>
            <textarea
              id="cb-private-key"
              ref={privateKeyRef}
              rows={6}
              placeholder="-----BEGIN EC PRIVATE KEY-----&#10;...&#10;-----END EC PRIVATE KEY-----"
              autoComplete="off"
              spellCheck={false}
              style={{
                fontFamily: "monospace",
                fontSize: "0.8rem",
                resize: "vertical",
                width: "100%",
                padding: "10px",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-md)",
                backgroundColor: "var(--surface-bg)",
                color: "var(--text-primary)",
              }}
            />
          </div>

          <div
            style={{
              padding: "10px 14px",
              backgroundColor: "#FEF3C7",
              color: "#92400E",
              borderRadius: "var(--radius-md)",
              fontSize: "0.82rem",
              marginBottom: "16px",
              lineHeight: "1.5",
            }}
          >
            Las credenciales se envían directamente al proceso principal de Electron y se almacenan
            en el llavero del sistema. Nunca se guardan en la base de datos, en localStorage, ni son
            accesibles desde DevTools.
          </div>

          <button
            onClick={handleConnect}
            disabled={isBusy}
            style={{ backgroundColor: "var(--accent)", color: "#fff", border: "none" }}
          >
            Conectar
          </button>
        </div>
      )}

      {/* Info card */}
      <div className="card">
        <h3>Acerca de la integración</h3>
        <ul style={{ fontSize: "0.875rem", color: "var(--text-secondary)", lineHeight: "2", paddingLeft: "20px" }}>
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
