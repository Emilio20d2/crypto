import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../components/Button";
import { Badge } from "../components/Badge";

type ConnectionState = "checking" | "disconnected" | "connecting" | "connected" | "syncing" | "error";

interface SyncStatus {
  lastSyncAt: number | null;
  lastSyncItemsProcessed: number | null;
  lastSyncStatus: "success" | "error" | null;
  lastSyncError: string | null;
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleString("es-ES", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const STATE_LABEL: Record<ConnectionState, string> = {
  checking:     "Verificando...",
  disconnected: "No conectado",
  connecting:   "Conectando...",
  connected:    "Conectado",
  syncing:      "Sincronizando...",
  error:        "Error de autenticación",
};

const STATE_VARIANT: Record<ConnectionState, "neutral" | "success" | "warning" | "danger"> = {
  checking:     "neutral",
  disconnected: "neutral",
  connecting:   "warning",
  connected:    "success",
  syncing:      "warning",
  error:        "danger",
};

export function Coinbase() {
  const queryClient = useQueryClient();
  const [connectionState, setConnectionState] = useState<ConnectionState>("checking");
  const [syncStatus, setSyncStatus]           = useState<SyncStatus>({
    lastSyncAt: null, lastSyncItemsProcessed: null, lastSyncStatus: null, lastSyncError: null,
  });
  const [errorMsg,    setErrorMsg]    = useState("");
  const [successMsg,  setSuccessMsg]  = useState("");
  const [formVisible, setFormVisible] = useState(false);

  const keyNameRef    = useRef<HTMLInputElement>(null);
  const privateKeyRef = useRef<HTMLTextAreaElement>(null);

  const applyStatusResult = (result: Awaited<ReturnType<typeof window.cryptoControl.coinbase.getStatus>>) => {
    if (result.ok) {
      const { connected, lastSyncAt, lastSyncItemsProcessed, lastSyncStatus, lastSyncError } = result.data;
      setConnectionState(connected ? "connected" : "disconnected");
      setSyncStatus({ lastSyncAt, lastSyncItemsProcessed, lastSyncStatus, lastSyncError });
    } else {
      setConnectionState("disconnected");
    }
  };

  const loadStatus = async () => {
    const result = await window.cryptoControl.coinbase.getStatus();
    applyStatusResult(result);
  };

  useEffect(() => {
    let cancelled = false;
    window.cryptoControl.coinbase.getStatus().then(result => {
      if (!cancelled) applyStatusResult(result);
    });
    return () => { cancelled = true; };
  }, []); // applyStatusResult is stable (closes over setters only)

  const handleConnect = async () => {
    const apiKeyName   = keyNameRef.current?.value?.trim() ?? "";
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

    // Limpiar formulario inmediatamente tras envío
    if (keyNameRef.current)    keyNameRef.current.value    = "";
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
        `Sincronización completada: ${newTransactions} nuevas operaciones importadas, ` +
        `${skippedDuplicates} duplicadas omitidas (${itemsProcessed} procesadas en total).`
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

  const isBusy = connectionState === "connecting" || connectionState === "syncing" || connectionState === "checking";

  return (
    <div>
      <h1 className="page-title">Coinbase</h1>

      {/* Estado de conexión */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <Badge variant={STATE_VARIANT[connectionState]}>{STATE_LABEL[connectionState]}</Badge>
        </div>

        {errorMsg   && <div className="banner banner-error">{errorMsg}</div>}
        {successMsg && <div className="banner banner-success">{successMsg}</div>}

        {syncStatus.lastSyncAt && (
          <div style={{ marginBottom: 16, fontSize: "0.875rem", color: "var(--text-secondary)" }}>
            <div>
              Última sincronización:{" "}
              <strong style={{ color: "var(--text-primary)" }}>{formatDate(syncStatus.lastSyncAt)}</strong>
            </div>
            {syncStatus.lastSyncItemsProcessed !== null && (
              <div>
                Operaciones importadas:{" "}
                <strong style={{ color: "var(--text-primary)" }}>{syncStatus.lastSyncItemsProcessed}</strong>
              </div>
            )}
            {syncStatus.lastSyncStatus === "error" && syncStatus.lastSyncError && (
              <div className="text-negative" style={{ marginTop: 4 }}>Error: {syncStatus.lastSyncError}</div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {connectionState === "connected" && (
            <>
              <Button onClick={handleSync} loading={isBusy}>
                {isBusy ? " " : "Sincronizar ahora"}
              </Button>
              <Button variant="danger" onClick={handleDisconnect} disabled={isBusy}>
                Desconectar
              </Button>
            </>
          )}
          {connectionState === "disconnected" && (
            <Button variant="secondary" onClick={() => setFormVisible(v => !v)}>
              {formVisible ? "Cancelar" : "Conectar con Coinbase"}
            </Button>
          )}
          {isBusy && (
            <span style={{ fontSize: "0.875rem", color: "var(--text-secondary)", alignSelf: "center" }}>
              {connectionState === "syncing" ? "Importando operaciones..." : "Por favor espera..."}
            </span>
          )}
        </div>
      </div>

      {/* Formulario de credenciales */}
      {formVisible && connectionState === "disconnected" && (
        <div className="card" style={{ marginBottom: 20 }}>
          <p className="section-title">Credenciales de Coinbase CDP API</p>
          <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: 16, lineHeight: 1.6 }}>
            Crea una API Key de solo lectura en <strong>Coinbase Developer Platform › API Keys</strong>.
            Selecciona únicamente el permiso <strong>View</strong>. Las credenciales se guardarán en el
            llavero de macOS y nunca serán visibles una vez enviadas.
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
              placeholder={"-----BEGIN EC PRIVATE KEY-----\n...\n-----END EC PRIVATE KEY-----"}
              autoComplete="off"
              spellCheck={false}
              style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: "0.8rem" }}
            />
          </div>

          <div className="banner banner-warning" style={{ marginBottom: 16 }}>
            Las credenciales se envían directamente al proceso principal de Electron y se almacenan
            en el llavero del sistema. Nunca se guardan en la base de datos, en localStorage, ni son
            accesibles desde DevTools.
          </div>

          <Button onClick={handleConnect} disabled={isBusy}>
            Conectar
          </Button>
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
