import { useState, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, PlusCircle, PlayCircle, XCircle } from "lucide-react";
import { Button } from "../../components/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/Card";
import { Input } from "../../components/Input";
import type {
  Asset,
  AssetSubstitution,
  InvestmentAsset,
  Result,
  StrategyRevision,
} from "@crypto-control/core";

async function unwrap<T>(p: Promise<Result<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
}

function toDateInput(v: number | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fromDateInput(v: string, required = false): number | null {
  if (!v) { if (required) throw new Error("Obligatorio."); return null; }
  return new Date(`${v}T00:00:00`).getTime();
}

function formatDate(v: number | null | undefined): string {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

const SUB_STATUS_LABEL: Record<string, string> = {
  borrador:  "Borrador",
  programada: "Programada",
  aplicada:  "Aplicada",
  cancelada: "Cancelada",
};

const SUB_STATUS_BADGE: Record<string, string> = {
  borrador:  "badge-secondary",
  programada: "badge-warning",
  aplicada:  "badge-success",
  cancelada: "badge",
};

// ── Substitution form ─────────────────────────────────────────────────────────

function NuevaSubstitucionForm({
  cycleId,
  assets,
  allAssets,
  onSuccess,
}: {
  cycleId: string;
  assets: InvestmentAsset[];
  allAssets: Asset[];
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [fromAssetId, setFromAssetId] = useState("");
  const [toAssetId, setToAssetId] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(() => toDateInput(Date.now()));
  const [transferMode, setTransferMode] = useState<"full" | "custom" | "pending">("full");
  const [transferPct, setTransferPct] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: (data: Parameters<typeof window.cryptoControl.assetSubstitutions.create>[0]) =>
      unwrap(window.cryptoControl.assetSubstitutions.create(data)),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["asset-substitutions", cycleId] });
      onSuccess();
      setOpen(false);
      setFromAssetId(""); setToAssetId(""); setReason(""); setNotes(""); setError(null);
    },
  });

  const activeAssetIds = new Set(assets.filter(a => a.status === "active").map(a => a.assetId));
  const availableFrom = assets.filter(a => a.status === "active");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!fromAssetId) { setError("Selecciona el activo saliente."); return; }
    if (toAssetId && toAssetId === fromAssetId) { setError("El activo entrante no puede ser el mismo que el saliente."); return; }
    const date = fromDateInput(effectiveDate, true);
    if (!date) { setError("Fecha efectiva obligatoria."); return; }
    if (!reason.trim()) { setError("El motivo es obligatorio."); return; }

    let pct: number | null = null;
    if (transferMode === "custom") {
      pct = parseFloat(transferPct.replace(",", "."));
      if (isNaN(pct) || pct < 0 || pct > 100) { setError("El porcentaje debe estar entre 0 y 100."); return; }
    }

    await create.mutateAsync({
      cycleId,
      fromAssetId,
      toAssetId: toAssetId || null,
      effectiveDate: date,
      status: "borrador",
      allocationTransferMode: transferMode,
      allocationTransferPercentage: transferMode === "custom" ? pct : null,
      reason: reason.trim(),
      notes: notes || null,
    });
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <PlusCircle size={14} /> Crear sustitución
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle>Nueva sustitución de activo</CardTitle></CardHeader>
      <CardContent>
        <form className="investment-form-grid compact" onSubmit={(e) => void handleSubmit(e)}>
          {error ? <p className="error-msg" style={{ gridColumn: "1 / -1" }}>{error}</p> : null}

          <label className="form-group">
            <span>Activo saliente *</span>
            <select className="ui-select" value={fromAssetId} onChange={e => setFromAssetId(e.target.value)} required>
              <option value="">— selecciona —</option>
              {availableFrom.map(a => (
                <option key={a.id} value={a.assetId}>{a.assetId}</option>
              ))}
            </select>
          </label>

          <label className="form-group">
            <span>Activo entrante (opcional)</span>
            <select className="ui-select" value={toAssetId} onChange={e => setToAssetId(e.target.value)}>
              <option value="">— ninguno (retirada) —</option>
              {allAssets
                .filter(a => a.id !== fromAssetId && !activeAssetIds.has(a.id))
                .map(a => (
                  <option key={a.id} value={a.id}>{a.symbol} — {a.name}</option>
                ))}
            </select>
          </label>

          <label className="form-group">
            <span>Fecha efectiva *</span>
            <Input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} required />
          </label>

          <label className="form-group">
            <span>Transferencia de asignación</span>
            <select className="ui-select" value={transferMode} onChange={e => setTransferMode(e.target.value as typeof transferMode)}>
              <option value="full">Transferir toda la asignación</option>
              <option value="custom">Personalizada</option>
              <option value="pending">Dejar pendiente de asignar</option>
            </select>
          </label>

          {transferMode === "custom" ? (
            <label className="form-group">
              <span>Porcentaje a transferir</span>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.1"
                placeholder="Ej. 60"
                value={transferPct}
                onChange={e => setTransferPct(e.target.value)}
              />
            </label>
          ) : null}

          <label className="form-group investment-wide">
            <span>Motivo *</span>
            <Input
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Ej. Mejor potencial a medio plazo"
              required
            />
          </label>

          <label className="form-group investment-wide">
            <span>Notas adicionales</span>
            <Input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Contexto adicional, referencias, etc."
            />
          </label>

          <p style={{ gridColumn: "1 / -1", fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
            La sustitución se crea como borrador. Para aplicarla y que surta efecto,
            usa "Aplicar" desde la lista. No se ejecuta ninguna venta ni compra automáticamente.
          </p>

          <div style={{ display: "flex", gap: 8, gridColumn: "1 / -1" }}>
            <Button type="submit" loading={create.isPending}>Crear borrador</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ── Substitution card ─────────────────────────────────────────────────────────

function SubstitucionCard({
  sub,
  onApply,
  onCancel,
  onDelete,
  isApplying,
  isCanceling,
}: {
  sub: AssetSubstitution;
  onApply: () => void;
  onCancel: () => void;
  onDelete: () => void;
  isApplying: boolean;
  isCanceling: boolean;
}) {
  const canAct = sub.status === "borrador" || sub.status === "programada";

  return (
    <article className="substitution-card">
      <div className="substitution-card-header">
        <span className="substitution-assets">
          <strong>{sub.fromAssetId}</strong>
          {sub.toAssetId ? (
            <> → <strong>{sub.toAssetId}</strong></>
          ) : " (retirada)"}
        </span>
        <span className={`badge ${SUB_STATUS_BADGE[sub.status] ?? "badge"}`}>
          {SUB_STATUS_LABEL[sub.status] ?? sub.status}
        </span>
      </div>

      <p className="substitution-meta">
        Fecha efectiva: {formatDate(sub.effectiveDate)}
        {sub.allocationTransferMode ? ` · Transferencia: ${sub.allocationTransferMode}` : ""}
        {sub.allocationTransferPercentage != null ? ` (${sub.allocationTransferPercentage}%)` : ""}
      </p>

      <p className="substitution-reason">{sub.reason}</p>
      {sub.notes ? <p className="substitution-notes">{sub.notes}</p> : null}

      {sub.appliedAt ? (
        <p className="substitution-applied">Aplicada el {formatDate(sub.appliedAt)}</p>
      ) : null}

      {canAct ? (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <Button size="sm" loading={isApplying} onClick={onApply}>
            <PlayCircle size={12} /> Aplicar
          </Button>
          <Button size="sm" variant="ghost" loading={isCanceling} onClick={onCancel}>
            <XCircle size={12} /> Cancelar
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete}>
            Eliminar
          </Button>
        </div>
      ) : null}
    </article>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function PlanCambiosEstrategia({ cycleId }: { cycleId: string }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => toDateInput(Date.now()));
  const [notes, setNotes] = useState("");
  const [revError, setRevError] = useState<string | null>(null);

  const revisionsQ = useQuery({
    queryKey: ["strategy-revisions"],
    queryFn: () => unwrap(window.cryptoControl.strategyRevisions.list()),
  });
  const revisions: StrategyRevision[] = (revisionsQ.data ?? []).filter(r => r.cycleId === cycleId);

  const substitutionsQ = useQuery({
    queryKey: ["asset-substitutions", cycleId],
    queryFn: () => unwrap(window.cryptoControl.assetSubstitutions.list({ cycleId })),
  });
  const substitutions: AssetSubstitution[] = substitutionsQ.data ?? [];

  const allAssetsQ = useQuery<Asset[]>({
    queryKey: ["assets"],
    queryFn: () => unwrap(window.cryptoControl.assets.list()),
  });
  const allAssets: Asset[] = allAssetsQ.data ?? [];

  const investmentAssetsQ = useQuery<InvestmentAsset[]>({
    queryKey: ["investment-assets"],
    queryFn: () => unwrap(window.cryptoControl.investmentAssets.list()),
  });

  function invalidateSubs() {
    void qc.invalidateQueries({ queryKey: ["asset-substitutions", cycleId] });
    void qc.invalidateQueries({ queryKey: ["strategy-revisions"] });
    void qc.invalidateQueries({ queryKey: ["investment-assets"] });
  }

  const applyMutation = useMutation({
    mutationFn: (id: string) => unwrap(window.cryptoControl.assetSubstitutions.apply(id)),
    onSuccess: invalidateSubs,
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => unwrap(window.cryptoControl.assetSubstitutions.cancel(id)),
    onSuccess: invalidateSubs,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => unwrap(window.cryptoControl.assetSubstitutions.delete(id)),
    onSuccess: invalidateSubs,
  });

  const createRevision = useMutation({
    mutationFn: (data: Parameters<typeof window.cryptoControl.strategyRevisions.create>[0]) =>
      unwrap(window.cryptoControl.strategyRevisions.create(data)),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["strategy-revisions"] });
      setTitle(""); setNotes(""); setRevError(null);
    },
  });

  async function handleRevisionSubmit(e: FormEvent) {
    e.preventDefault();
    setRevError(null);
    if (!title.trim()) { setRevError("El título o motivo es obligatorio."); return; }
    const effectiveDate = fromDateInput(date, true);
    if (!effectiveDate) { setRevError("La fecha efectiva es obligatoria."); return; }
    await createRevision.mutateAsync({
      cycleId,
      effectiveDate,
      title: title.trim(),
      notes: notes || null,
      changesJson: JSON.stringify({ type: "note" }),
    });
  }

  const activeCycleAssets: InvestmentAsset[] = (investmentAssetsQ.data ?? []).filter(
    a => a.cycleId === cycleId && a.status === "active"
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* ── Sustituciones ── */}
      <Card>
        <CardHeader>
          <CardTitle>Sustituciones de activos</CardTitle>
          {substitutions.length > 0 ? <span className="badge">{substitutions.length}</span> : null}
        </CardHeader>
        <CardContent>
          <div className="substitution-list">
            {substitutions.length === 0 ? (
              <p className="empty-inline">No hay sustituciones registradas para esta etapa.</p>
            ) : (
              substitutions
                .slice()
                .sort((a, b) => b.effectiveDate - a.effectiveDate)
                .map(sub => (
                  <SubstitucionCard
                    key={sub.id}
                    sub={sub}
                    isApplying={applyMutation.isPending}
                    isCanceling={cancelMutation.isPending}
                    onApply={() => applyMutation.mutate(sub.id)}
                    onCancel={() => cancelMutation.mutate(sub.id)}
                    onDelete={() => deleteMutation.mutate(sub.id)}
                  />
                ))
            )}
          </div>
          <div style={{ marginTop: 12 }}>
            <NuevaSubstitucionForm
              cycleId={cycleId}
              assets={activeCycleAssets}
              allAssets={allAssets}
              onSuccess={invalidateSubs}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Revisiones del plan ── */}
      <Card>
        <CardHeader>
          <CardTitle>Cambios del plan</CardTitle>
          {revisions.length > 0 ? <span className="badge">{revisions.length}</span> : null}
        </CardHeader>
        <CardContent>
          <form className="investment-form-grid compact" onSubmit={(e) => void handleRevisionSubmit(e)}>
            {revError ? <p className="error-msg" style={{ gridColumn: "1 / -1" }}>{revError}</p> : null}
            <label className="form-group">
              <span>Fecha efectiva *</span>
              <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
            </label>
            <label className="form-group">
              <span>Título o motivo *</span>
              <Input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Ej. Cambio de estrategia en BTC"
              />
            </label>
            <label className="form-group investment-wide">
              <span>Notas adicionales</span>
              <Input
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Describe los cambios realizados y su motivación"
              />
            </label>
            <div className="investment-form-actions">
              <Button type="submit" variant="secondary" size="sm" loading={createRevision.isPending}>
                <CalendarDays size={14} /> Registrar cambio
              </Button>
            </div>
          </form>

          <div className="revision-list">
            {revisions.length === 0 ? (
              <p className="empty-inline">No hay cambios registrados para esta etapa.</p>
            ) : (
              revisions
                .slice()
                .sort((a, b) => b.effectiveDate - a.effectiveDate)
                .map(rev => (
                  <article key={rev.id} className="revision-item">
                    <div className="revision-header">
                      <strong className="revision-title">{rev.title}</strong>
                      <time className="revision-date">{formatDate(rev.effectiveDate)}</time>
                    </div>
                    {rev.notes ? <p className="revision-notes">{rev.notes}</p> : null}
                  </article>
                ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
