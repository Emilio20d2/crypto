import { useRef, useState, type RefObject } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileJson, KeyRound, RotateCw, ShieldCheck, Trash2 } from "lucide-react";
import type { CdpImportResult, CoinbaseStatus, CoinbaseSyncHistoryItem, CoinbaseSyncResult } from "@crypto-control/core";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card, CardContent, CardHeader, CardTitle } from "./Card";
import { FormField } from "./FormField";
import { formatDateTime } from "../lib/format";

export type ConnectionState = "checking" | "disconnected" | "connecting" | "connected" | "syncing" | "error";
type ImportMode = "none" | "paste";

const STATE_LABEL: Record<ConnectionState, string> = {
  checking: "Verificando",
  disconnected: "No conectado",
  connecting: "Conectando",
  connected: "Conectado",
  syncing: "Sincronizando",
  error: "Error",
};

const STATE_VARIANT: Record<ConnectionState, "neutral" | "success" | "warning" | "danger"> = {
  checking: "neutral",
  disconnected: "neutral",
  connecting: "warning",
  connected: "success",
  syncing: "warning",
  error: "danger",
};

function humanizeError(code: string, message: string, httpStatus?: number): string {
  const codeMessages: Record<string, string> = {
    UNAUTHORIZED: "Credenciales no aceptadas (401). Verifica que la clave no haya sido revocada.",
    INSUFFICIENT_PERMISSIONS: "La clave no tiene permisos de lectura suficientes.",
    IP_RESTRICTED: "Este dispositivo no está en la lista de IPs permitidas de Coinbase.",
    INVALID_JWT_SIGNATURE: "La firma del JWT no fue aceptada por Coinbase.",
    CLOCK_SKEW: "El reloj del sistema puede estar desincronizado.",
    RATE_LIMITED: "Demasiadas peticiones. Espera unos segundos antes de volver a intentarlo.",
    NETWORK_ERROR: "No se pudo conectar con Coinbase.",
    KEY_ED25519_INCOMPATIBLE: "Esta clave usa ED25519. Se requiere ECDSA.",
    KEY_WRONG_CURVE: "La clave EC no usa la curva P-256 requerida.",
    KEY_NOT_EC: "La clave privada no es EC (ECDSA).",
    PEM_INVALID: "La clave privada no es un PEM válido.",
    FIELDS_MISSING: "El JSON no tiene los campos requeridos.",
    KEY_NAME_INCOMPLETE: "El identificador de la clave está incompleto.",
    JSON_INVALID: "El archivo no contiene JSON válido.",
    JSON_EMPTY: "El archivo está vacío.",
  };
  return httpStatus ? (codeMessages[code] ?? `${message} (${httpStatus})`) : (codeMessages[code] ?? message);
}

function permissionLabel(active?: boolean) {
  return active ? "Permitido" : "No permitido";
}

export function CoinbaseConnectionStatus({
  state,
  status,
  portfolioName,
}: {
  state: ConnectionState;
  status?: CoinbaseStatus | null;
  portfolioName?: string | null;
}) {
  const keychainLabel = status?.keychainStatus === "stored"
    ? "Guardada de forma segura en el Llavero"
    : status?.keychainStatus === "legacy"
      ? "Guardada en ubicación heredada"
      : "Sin credenciales guardadas";

  return (
    <Card className="coinbase-connection-panel">
      <CardHeader>
        <CardTitle>Estado de conexión</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="sync-grid">
          <div><dt>Estado</dt><dd><Badge variant={STATE_VARIANT[state]}>{STATE_LABEL[state]}</Badge></dd></div>
          <div><dt>Portfolio activo</dt><dd>{portfolioName || "No disponible"}</dd></div>
          <div><dt>Tipo de credencial</dt><dd>{status?.credentialType || "Clave CDP"}</dd></div>
          <div><dt>Algoritmo</dt><dd>{status?.algorithm ? `ECDSA · ${status.algorithm}` : "No disponible"}</dd></div>
          <div><dt>Identificador</dt><dd>{status?.keyDisplayName || "No disponible"}</dd></div>
          <div><dt>Estado del Llavero</dt><dd>{keychainLabel}</dd></div>
          <div><dt>Última validación</dt><dd>{formatDateTime(status?.lastValidationAt)}</dd></div>
        </dl>
      </CardContent>
    </Card>
  );
}

export function CoinbasePortfolioInfo({ portfolioName, portfolioType }: { portfolioName?: string | null; portfolioType?: string | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Portfolio</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="stats-list">
          <div><dt>Nombre</dt><dd>{portfolioName || "No disponible"}</dd></div>
          <div><dt>Tipo</dt><dd>{portfolioType || "No disponible"}</dd></div>
          <div><dt>Origen</dt><dd>Coinbase Advanced Trade</dd></div>
        </dl>
      </CardContent>
    </Card>
  );
}

export function CoinbasePermissions({ permissions }: { permissions?: CoinbaseStatus["permissions"] }) {
  const rows = [
    ["Lectura", permissions?.canView],
    ["Operaciones", permissions?.canTrade],
    ["Transferencias", permissions?.canTransfer],
  ] as const;
  const hasExtraPermissions = !!permissions?.canTrade || !!permissions?.canTransfer;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Permisos</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="permission-list">
          {rows.map(([label, active]) => (
            <div className="permission-row" key={label}>
              <span className={active ? "permission-dot active" : "permission-dot"} />
              <span>{label}</span>
              <strong>{permissionLabel(active)}</strong>
            </div>
          ))}
        </div>
        {hasExtraPermissions && (
          <div className="banner banner-warning">
            Esta credencial incluye permisos adicionales. Se recomienda utilizar una clave exclusivamente de lectura.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function CoinbaseCredentialImport({
  connected,
  busy,
  importMode,
  pasteRef,
  onFile,
  onPaste,
  onPasteSubmit,
  onCancelPaste,
  onValidate,
  onDisconnect,
  onDeleteKeychain,
}: {
  connected: boolean;
  busy: boolean;
  importMode: ImportMode;
  pasteRef: RefObject<HTMLTextAreaElement | null>;
  onFile: () => void;
  onPaste: () => void;
  onPasteSubmit: () => void;
  onCancelPaste: () => void;
  onValidate: () => void;
  onDisconnect: () => void;
  onDeleteKeychain: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Credenciales</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="connect-actions">
          <Button type="button" onClick={onFile} loading={busy && importMode === "none"} disabled={busy}>
            <FileJson size={16} />
            {connected ? "Sustituir credencial" : "Seleccionar archivo JSON"}
          </Button>
          <Button type="button" variant="secondary" onClick={onPaste} disabled={busy}>
            Pegar JSON
          </Button>
          <Button type="button" variant="secondary" onClick={onValidate} disabled={busy || !connected}>
            Validar credencial
          </Button>
          <Button type="button" variant="secondary" onClick={onDisconnect} disabled={busy || !connected}>
            Desconectar
          </Button>
          <Button type="button" variant="danger" onClick={onDeleteKeychain} disabled={busy || !connected}>
            <Trash2 size={15} />
            Eliminar del Llavero
          </Button>
        </div>

        {importMode === "paste" && (
          <div className="paste-panel">
            <FormField label="Contenido de credencial CDP" htmlFor="cb-paste-json">
              <textarea
                id="cb-paste-json"
                className="ui-input ui-textarea"
                ref={pasteRef}
                rows={7}
                placeholder="Pega aquí la credencial CDP. Se valida en el proceso principal y no se conserva en el renderer."
                autoComplete="off"
                spellCheck={false}
              />
            </FormField>
            <div className="panel-actions">
              <Button type="button" onClick={onPasteSubmit} disabled={busy} loading={busy}>
                Validar y guardar
              </Button>
              <Button type="button" variant="ghost" onClick={onCancelPaste} disabled={busy}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function CoinbaseSyncSummary({
  status,
  lastResult,
}: {
  status?: CoinbaseStatus | null;
  lastResult?: CoinbaseSyncResult | null;
}) {
  return (
    <dl className="sync-grid">
      <div><dt>Última sincronización</dt><dd>{formatDateTime(status?.lastSyncAt)}</dd></div>
      <div><dt>Duración</dt><dd>{lastResult?.durationMs ? `${(lastResult.durationMs / 1000).toFixed(1)} s` : "No disponible"}</dd></div>
      <div><dt>Cuentas consultadas</dt><dd>{lastResult?.accountsConsulted ?? "No disponible"}</dd></div>
      <div><dt>Páginas descargadas</dt><dd>{lastResult?.pagesDownloaded ?? "No disponible"}</dd></div>
      <div><dt>Transacciones descargadas</dt><dd>{lastResult?.transactionsDownloaded ?? "No disponible"}</dd></div>
      <div><dt>Fills descargados</dt><dd>{lastResult?.fillsDownloaded ?? "No disponible"}</dd></div>
      <div><dt>Operaciones nuevas</dt><dd>{lastResult?.newTransactions ?? status?.lastSyncItemsProcessed ?? 0}</dd></div>
      <div><dt>Operaciones actualizadas</dt><dd>{lastResult?.updatedTransactions ?? 0}</dd></div>
      <div><dt>Duplicados omitidos</dt><dd>{lastResult?.skippedDuplicates ?? "No disponible"}</dd></div>
      <div><dt>Pendientes de valoración</dt><dd>{lastResult?.pendingValuations ?? 0}</dd></div>
      <div><dt>Errores</dt><dd>{lastResult?.errors?.length ? lastResult.errors.join(", ") : status?.lastSyncError || "Sin errores"}</dd></div>
    </dl>
  );
}

export function CoinbaseSyncPanel({
  connected,
  busy,
  status,
  lastResult,
  onSync,
}: {
  connected: boolean;
  busy: boolean;
  status?: CoinbaseStatus | null;
  lastResult?: CoinbaseSyncResult | null;
  onSync: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sincronización</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="panel-actions">
          <Button type="button" onClick={onSync} loading={busy} disabled={!connected || busy}>
            <RotateCw size={15} />
            Sincronizar ahora
          </Button>
        </div>
        <CoinbaseSyncSummary status={status} lastResult={lastResult} />
      </CardContent>
    </Card>
  );
}

export function CoinbaseSyncHistory({ items }: { items: CoinbaseSyncHistoryItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Historial</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="empty-inline">No hay sincronizaciones anteriores.</p>
        ) : (
          <div className="sync-history-list">
            {items.map((item) => (
              <div className="sync-history-row" key={item.id}>
                <span>
                  <strong>{formatDateTime(item.timestamp)}</strong>
                  <small>{item.status}</small>
                </span>
                <span>{item.durationMs ? `${(item.durationMs / 1000).toFixed(1)} s` : "Duración N/D"}</span>
                <span>{item.itemsProcessed.toLocaleString("es-ES")} procesadas</span>
                <span>{item.newTransactions ?? 0} nuevas</span>
                <span>{item.skippedDuplicates ?? "N/D"} duplicadas</span>
                <span>{item.error || "Sin errores"}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function CoinbaseSecurityStatus({ connected }: { connected: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Seguridad</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="security-list">
          <span><ShieldCheck size={16} /> Validación ECDSA P-256 antes de guardar</span>
          <span><ShieldCheck size={16} /> Credenciales protegidas en el Llavero de macOS</span>
          <span><ShieldCheck size={16} /> Secretos fuera del renderer</span>
          <span><KeyRound size={16} /> {connected ? "Credencial activa disponible para sincronizar" : "Sin credencial activa"}</span>
        </div>
      </CardContent>
    </Card>
  );
}

export function CoinbaseSettingsPanel() {
  const queryClient = useQueryClient();
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("checking");
  const [importMode, setImportMode] = useState<ImportMode>("none");
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [warnMsg, setWarnMsg] = useState("");
  const [lastSyncResult, setLastSyncResult] = useState<CoinbaseSyncResult | null>(null);

  const statusQuery = useQuery({
    queryKey: ["coinbase", "status"],
    queryFn: () => window.cryptoControl.coinbase.getStatus(),
  });

  const status = statusQuery.data?.ok ? statusQuery.data.data : null;
  const connected = !!status?.connected;

  const portfoliosQuery = useQuery({
    queryKey: ["coinbase", "portfolios"],
    queryFn: () => window.cryptoControl.coinbase.listPortfolios(),
    enabled: connected,
  });

  const historyQuery = useQuery({
    queryKey: ["coinbase", "sync-history"],
    queryFn: () => window.cryptoControl.coinbase.getSyncHistory(),
  });

  const portfolio = portfoliosQuery.data?.ok && portfoliosQuery.data.data?.[0] ? portfoliosQuery.data.data[0] : null;

  const statusState: ConnectionState = statusQuery.isLoading ? "checking" : connected ? "connected" : "disconnected";
  const isBusy = statusQuery.isLoading || connectionState === "connecting" || connectionState === "syncing";

  const applyImportResult = async (data: CdpImportResult) => {
    setConnectionState("connected");
    setImportMode("none");
    const extraPerms: string[] = [];
    if (data.permissions.canTrade) extraPerms.push("operaciones");
    if (data.permissions.canTransfer) extraPerms.push("transferencias");
    setWarnMsg(extraPerms.length ? `Se recomienda una clave solo lectura. Permisos adicionales: ${extraPerms.join(", ")}.` : "");
    setSuccessMsg("Credencial validada y guardada correctamente.");
    await queryClient.invalidateQueries({ queryKey: ["coinbase"] });
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
      setConnectionState(connected ? "connected" : "disconnected");
      return;
    }
    await applyImportResult(result.data);
  };

  const handlePasteSubmit = async () => {
    const jsonContent = pasteRef.current?.value ?? "";
    if (!jsonContent.trim()) {
      setErrorMsg("Pega el contenido de la credencial antes de continuar.");
      return;
    }
    setConnectionState("connecting");
    setErrorMsg("");
    setSuccessMsg("");
    setWarnMsg("");
    if (pasteRef.current) pasteRef.current.value = "";
    const result = await window.cryptoControl.coinbase.connectFromJson(jsonContent);
    if (!result.ok) {
      setConnectionState("error");
      setErrorMsg(humanizeError(result.error.code, result.error.message, result.error.httpStatus));
      return;
    }
    await applyImportResult(result.data);
  };

  const handleValidate = async () => {
    setConnectionState("checking");
    setErrorMsg("");
    const result = await window.cryptoControl.coinbase.getStatus();
    await queryClient.invalidateQueries({ queryKey: ["coinbase"] });
    setConnectionState(result.ok && result.data.connected ? "connected" : "disconnected");
    setSuccessMsg(result.ok && result.data.connected ? "Credencial validada correctamente." : "");
    if (!result.ok) setErrorMsg(humanizeError(result.error.code, result.error.message, result.error.httpStatus));
  };

  const handleDisconnect = async () => {
    if (!confirm("¿Desconectar Coinbase? Se eliminarán las credenciales del Llavero.")) return;
    await window.cryptoControl.coinbase.disconnect();
    setConnectionState("disconnected");
    setSuccessMsg("Coinbase desconectado.");
    setWarnMsg("");
    setErrorMsg("");
    await queryClient.invalidateQueries({ queryKey: ["coinbase"] });
  };

  const handleSync = async () => {
    setConnectionState("syncing");
    setErrorMsg("");
    setSuccessMsg("");
    const result = await window.cryptoControl.coinbase.sync();
    if (result.ok) {
      setLastSyncResult(result.data);
      setSuccessMsg(`${result.data.newTransactions} nuevas · ${result.data.skippedDuplicates} duplicadas · ${result.data.itemsProcessed} procesadas.`);
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["coinbase"] });
      setConnectionState("connected");
      return;
    }
    setConnectionState("connected");
    setErrorMsg(humanizeError(result.error.code, result.error.message, result.error.httpStatus));
  };

  const visibleState = connectionState === "connecting" || connectionState === "syncing" || connectionState === "error"
    ? connectionState
    : statusState;

  return (
    <div className="coinbase-settings-panel">
      {errorMsg && <div className="banner banner-error">{errorMsg}</div>}
      {successMsg && <div className="banner banner-success">{successMsg}</div>}
      {warnMsg && <div className="banner banner-warning">{warnMsg}</div>}

      <div className="coinbase-settings-grid">
        <CoinbaseConnectionStatus state={visibleState} status={status} portfolioName={portfolio?.name} />
        <CoinbasePortfolioInfo portfolioName={portfolio?.name} portfolioType={portfolio?.type} />
        <CoinbasePermissions permissions={status?.permissions} />
      </div>

      <CoinbaseCredentialImport
        connected={connected}
        busy={isBusy}
        importMode={importMode}
        pasteRef={pasteRef}
        onFile={handleImportFile}
        onPaste={() => { setImportMode("paste"); setErrorMsg(""); }}
        onPasteSubmit={handlePasteSubmit}
        onCancelPaste={() => setImportMode("none")}
        onValidate={handleValidate}
        onDisconnect={handleDisconnect}
        onDeleteKeychain={handleDisconnect}
      />

      <CoinbaseSyncPanel
        connected={connected}
        busy={connectionState === "syncing"}
        status={status}
        lastResult={lastSyncResult}
        onSync={handleSync}
      />

      <CoinbaseSyncHistory items={historyQuery.data?.ok ? historyQuery.data.data : []} />
      <CoinbaseSecurityStatus connected={connected} />
    </div>
  );
}
