import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleOff, Plus, RotateCcw, Save, Search, Trash2, XCircle } from "lucide-react";
import { Button } from "../../components/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/Card";
import { CryptoLogo } from "../../components/CryptoLogo";
import { Input } from "../../components/Input";
import { formatMoney } from "../../lib/format";
import type { Asset, AssetAllocation, CatalogAsset, InvestmentAsset, MarkGoalReachedInput, PortfolioPosition, Result } from "@crypto-control/core";

// ── Goal evaluation types (mirror of plan-goals.ts, browser-safe) ─────────────

type GoalType = "quantity" | "value" | "portfolio_percentage";

type GoalEvalResult =
  | { hasGoal: false }
  | { hasGoal: true; goalType: GoalType; target: number; observedValue: number; reached: boolean; progress: number }
  | { hasGoal: true; goalType: GoalType; target: number; evaluable: false; reason: string };

interface PositionData {
  balance: number;
  currentValueEur: number | null;
  currentWeightPct: number | null;
}

function evaluateGoal(asset: InvestmentAsset, pos?: PositionData): GoalEvalResult {
  if (asset.targetAmount !== null) {
    const target = asset.targetAmount;
    const observed = pos?.balance ?? 0;
    return { hasGoal: true, goalType: "quantity", target, observedValue: observed, reached: observed >= target, progress: target > 0 ? Math.min(1, observed / target) : 0 };
  }
  if (asset.targetValueEur !== null) {
    const target = asset.targetValueEur;
    if (!pos || pos.currentValueEur === null) return { hasGoal: true, goalType: "value", target, evaluable: false, reason: "Precio no disponible" };
    const observed = pos.currentValueEur;
    return { hasGoal: true, goalType: "value", target, observedValue: observed, reached: observed >= target, progress: target > 0 ? Math.min(1, observed / target) : 0 };
  }
  if (asset.targetPortfolioPercentage !== null) {
    const target = asset.targetPortfolioPercentage;
    if (!pos || pos.currentWeightPct === null) return { hasGoal: true, goalType: "portfolio_percentage", target, evaluable: false, reason: "Valoración no disponible" };
    const observed = pos.currentWeightPct;
    return { hasGoal: true, goalType: "portfolio_percentage", target, observedValue: observed, reached: observed >= target, progress: target > 0 ? Math.min(1, observed / target) : 0 };
  }
  return { hasGoal: false };
}

function formatGoalProgress(eval_: GoalEvalResult, monthlyEur: number): { label: string; releasedLabel: string | null } | null {
  if (!eval_.hasGoal) return null;
  if (!("observedValue" in eval_) && "evaluable" in eval_) {
    return { label: `Objetivo: ${eval_.reason}`, releasedLabel: null };
  }
  if (!("observedValue" in eval_)) return null;
  const pct = Math.round(eval_.progress * 100);
  const label = eval_.goalType === "quantity"
    ? `${eval_.observedValue.toLocaleString("es-ES", { maximumFractionDigits: 4 })} / ${eval_.target.toLocaleString("es-ES", { maximumFractionDigits: 4 })} monedas (${pct}%)`
    : eval_.goalType === "value"
      ? `${formatMoney(eval_.observedValue)} / ${formatMoney(eval_.target)} (${pct}%)`
      : `${eval_.observedValue.toFixed(1)}% / ${eval_.target}% cartera (${pct}%)`;
  const releasedLabel = eval_.reached ? `Libera ~${formatMoney(monthlyEur)}/mes` : null;
  return { label, releasedLabel };
}

async function unwrap<T>(p: Promise<Result<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDateInput(v: number | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fromDateInput(v: string, required = false): number | null {
  if (!v) { if (required) throw new Error("Obligatorio."); return null; }
  return new Date(`${v}T00:00:00`).getTime();
}

function parseNumber(v: string): number {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function parseOptionalNumber(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function formatDate(v: number | null | undefined): string {
  if (!v) return "Abierta";
  return new Date(v).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

function dateRangesOverlap(
  aStart: number, aEnd: number | null | undefined,
  bStart: number, bEnd: number | null | undefined,
): boolean {
  const leftEnd = aEnd ?? Number.MAX_SAFE_INTEGER;
  const rightEnd = bEnd ?? Number.MAX_SAFE_INTEGER;
  return aStart <= rightEnd && bStart <= leftEnd;
}

function hasOverlappingActiveAsset(
  items: InvestmentAsset[],
  assetId: string,
  startDate: number,
  endDate: number | null,
  excludingId?: string,
): boolean {
  return items.some(item =>
    item.id !== excludingId
    && item.assetId === assetId
    && item.status === "active"
    && item.isActive
    && dateRangesOverlap(startDate, endDate, item.startDate, item.endDate),
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

type AssetPlanStatus = InvestmentAsset["status"];
type AccumulationType = "continua" | "hasta_objetivo";
type AllocationMode = "porcentaje" | "fijo";
type TargetType = "cantidad" | "valor" | "porcentaje_cartera";

// ── Label maps ────────────────────────────────────────────────────────────────

const ASSET_STATUS_LABEL: Record<AssetPlanStatus, string> = {
  active: "Activa",
  paused: "Pausada",
  closed: "Retirada",
  goal_reached: "Objetivo alcanzado",
};

const ASSET_STATUS_BADGE: Record<AssetPlanStatus, string> = {
  active: "badge-success",
  paused: "badge-warning",
  closed: "",
  goal_reached: "badge-info",
};

// ── Asset display helpers ─────────────────────────────────────────────────────

function getPct(item: InvestmentAsset): number | null {
  return item.allocationPercentage ?? (item.allocationType === "percentage" ? item.allocationValue : null);
}

function getFixed(item: InvestmentAsset): number | null {
  return item.fixedAmountEur ?? (item.allocationType === "amount" ? item.allocationValue : null);
}

function getAccumulationType(item: InvestmentAsset): AccumulationType {
  return (item.targetAmount !== null || item.targetValueEur !== null || item.targetPortfolioPercentage !== null)
    ? "hasta_objetivo"
    : "continua";
}

function getTargetDisplay(item: InvestmentAsset): string | null {
  if (item.targetAmount !== null) return `Hasta ${item.targetAmount.toLocaleString("es-ES")} monedas`;
  if (item.targetValueEur !== null) return `Hasta ${formatMoney(item.targetValueEur)}`;
  if (item.targetPortfolioPercentage !== null) return `Hasta el ${item.targetPortfolioPercentage}% de la cartera`;
  return null;
}

function getMonthlyAmount(item: InvestmentAsset, cycleMonthly: number): number | null {
  const pct = getPct(item);
  if (pct !== null) return cycleMonthly * pct / 100;
  return getFixed(item);
}

// ── AssetPicker — selector buscable con catálogo completo ─────────────────────

function AssetPicker({
  catalog,
  value,
  onChange,
  disabled,
}: {
  catalog: CatalogAsset[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = Array.isArray(catalog) ? catalog.find(a => a.id === value) : undefined;

  const safeCatalog = Array.isArray(catalog) ? catalog : [];
  const filtered = query.length < 1
    ? safeCatalog
    : safeCatalog.filter(a =>
        a.symbol.toLowerCase().includes(query.toLowerCase()) ||
        a.name.toLowerCase().includes(query.toLowerCase()) ||
        a.id.toLowerCase().includes(query.toLowerCase()),
      );

  // Cerrar al hacer click fuera
  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  function select(a: CatalogAsset) {
    onChange(a.id);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className="asset-picker" ref={containerRef}>
      <button
        type="button"
        className="asset-picker-trigger ui-select"
        onClick={() => { if (!disabled) setOpen(v => !v); }}
        disabled={disabled}
      >
        {selected ? (
          <span className="asset-picker-selected">
            <CryptoLogo symbol={selected.symbol} logoUrl={selected.logoUrl} size={18} />
            <strong>{selected.symbol}</strong>
            <span className="asset-picker-name">{selected.name}</span>
          </span>
        ) : (
          <span className="asset-picker-placeholder">Selecciona una moneda…</span>
        )}
        <span className="asset-picker-caret">▾</span>
      </button>

      {open ? (
        <div className="asset-picker-dropdown">
          <div className="asset-picker-search">
            <Search size={14} />
            <input
              autoFocus
              type="text"
              placeholder="Buscar por nombre o ticker…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="asset-picker-input"
            />
          </div>
          <ul className="asset-picker-list">
            {filtered.length === 0 ? (
              <li className="asset-picker-empty">Sin resultados para &laquo;{query}&raquo;</li>
            ) : (
              filtered.map(a => (
                <li
                  key={a.id}
                  className={`asset-picker-item${a.id === value ? " asset-picker-item--selected" : ""}`}
                  onClick={() => select(a)}
                >
                  <CryptoLogo symbol={a.symbol} logoUrl={a.logoUrl} size={22} />
                  <div className="asset-picker-item-info">
                    <span className="asset-picker-item-symbol">{a.symbol}</span>
                    <span className="asset-picker-item-name">{a.name}</span>
                  </div>
                  <div className="asset-picker-item-badges">
                    {a.hasCoinbase ? (
                      <span className="badge badge-success" title="Disponible en Coinbase">CB</span>
                    ) : a.supportedProviders.length > 0 ? (
                      <span className="badge" title="Fuente secundaria">SEC</span>
                    ) : (
                      <span className="badge badge-warning" title="Sin fuente de precio">?</span>
                    )}
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ── AddAssetForm ──────────────────────────────────────────────────────────────

function AddAssetForm({
  cycleId,
  cycleStart,
  catalog,
  cycleAssets,
  onSuccess,
  onCancel,
}: {
  cycleId: string;
  cycleStart: number;
  catalog: CatalogAsset[];
  cycleAssets: InvestmentAsset[];
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const [assetId, setAssetId] = useState(catalog[0]?.id ?? "");
  const [allocationMode, setAllocationMode] = useState<AllocationMode>("porcentaje");

  // Sync assetId when catalog loads after first render (async query)
  useEffect(() => {
    if (!assetId && catalog.length > 0) {
      setAssetId(catalog[0].id);
    }
  }, [catalog, assetId]);
  const [percentage, setPercentage] = useState("");
  const [fixedAmount, setFixedAmount] = useState("");
  const [accumulationType, setAccumulationType] = useState<AccumulationType>("continua");
  const [targetType, setTargetType] = useState<TargetType>("cantidad");
  const [targetValue, setTargetValue] = useState("");
  const [priority, setPriority] = useState("0");
  const [startDate, setStartDate] = useState(toDateInput(cycleStart));
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (data: Parameters<typeof window.cryptoControl.investmentAssets.create>[0]) =>
      unwrap(window.cryptoControl.investmentAssets.create(data)),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["investment-assets"] });
      setPercentage(""); setFixedAmount(""); setTargetValue(""); setNotes(""); setEndDate("");
      onSuccess();
    },
  });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!assetId) { setError("Selecciona un activo."); return; }

    const pct = allocationMode === "porcentaje" ? parseOptionalNumber(percentage) : null;
    const fixed = allocationMode === "fijo" ? parseOptionalNumber(fixedAmount) : null;

    if (allocationMode === "porcentaje") {
      if (pct === null || pct <= 0 || pct > 100) { setError("El porcentaje debe estar entre 1 y 100."); return; }
    } else {
      if (fixed === null || fixed <= 0) { setError("El importe fijo debe ser mayor de 0."); return; }
    }

    const start = fromDateInput(startDate, true);
    const end = fromDateInput(endDate);
    if (!start) { setError("La fecha de inicio es obligatoria."); return; }
    if (end !== null && end < start) { setError("La fecha de fin no puede ser anterior al inicio."); return; }

    if (hasOverlappingActiveAsset(cycleAssets, assetId, start, end)) {
      setError("Esta moneda ya está activa en esta etapa para un rango de fechas solapado.");
      return;
    }

    // Auto-registrar en DB si el activo está en el catálogo pero todavía no en assets table
    const catalogEntry = catalog.find(a => a.id === assetId);
    if (catalogEntry && !catalogEntry.inDb) {
      const regResult = await window.cryptoControl.assets.register({
        id: catalogEntry.id, symbol: catalogEntry.symbol,
        name: catalogEntry.name, logoUrl: catalogEntry.logoUrl,
      }) as { ok: boolean; error?: { message: string } };
      if (!regResult?.ok) {
        setError(`No se pudo registrar el activo: ${regResult?.error?.message ?? "error desconocido"}`);
        return;
      }
      await qc.invalidateQueries({ queryKey: ["assets"] });
      await qc.invalidateQueries({ queryKey: ["assets-catalog"] });
    }

    let targetAmount: number | null = null;
    let targetValueEur: number | null = null;
    let targetPortfolioPercentage: number | null = null;

    if (accumulationType === "hasta_objetivo") {
      const tv = parseOptionalNumber(targetValue);
      if (tv === null || tv <= 0) { setError("El objetivo debe ser mayor de 0."); return; }
      if (targetType === "cantidad") targetAmount = tv;
      else if (targetType === "valor") targetValueEur = tv;
      else targetPortfolioPercentage = tv;
    }

    const allocationType = allocationMode === "porcentaje" ? "percentage" : "amount";
    const allocationValue = pct ?? fixed ?? 0;

    await create.mutateAsync({
      cycleId, assetId, allocationType, allocationValue,
      allocationPercentage: pct, fixedAmountEur: fixed,
      priority: Math.trunc(parseNumber(priority)),
      targetAmount, targetValueEur, targetPortfolioPercentage,
      startDate: start, endDate: end, status: "active", isActive: true, notes: notes || null,
    });
  }

  const targetLabel = targetType === "cantidad" ? "Número de monedas" : targetType === "valor" ? "Valor en euros (€)" : "Porcentaje de cartera (%)";

  return (
    <div className="asset-add-form">
      <h4 className="asset-add-title">Añadir moneda a esta etapa</h4>
      {error ? <p className="error-msg">{error}</p> : null}
      <form className="investment-form-grid compact" onSubmit={(e) => void handleSubmit(e)}>
        <label className="form-group investment-wide">
          <span>Activo *</span>
          <AssetPicker catalog={catalog} value={assetId} onChange={setAssetId} />
        </label>

        <label className="form-group">
          <span>Tipo de asignación</span>
          <select className="ui-select" value={allocationMode} onChange={e => setAllocationMode(e.target.value as AllocationMode)}>
            <option value="porcentaje">Porcentaje del total mensual</option>
            <option value="fijo">Importe fijo mensual</option>
          </select>
        </label>

        {allocationMode === "porcentaje" ? (
          <label className="form-group">
            <span>Porcentaje (%)</span>
            <Input inputMode="decimal" value={percentage} onChange={e => setPercentage(e.target.value)} placeholder="Ej. 40" />
          </label>
        ) : (
          <label className="form-group">
            <span>Importe fijo (€/mes)</span>
            <Input inputMode="decimal" value={fixedAmount} onChange={e => setFixedAmount(e.target.value)} placeholder="Ej. 50" />
          </label>
        )}

        <label className="form-group">
          <span>Tipo de acumulación</span>
          <select className="ui-select" value={accumulationType} onChange={e => setAccumulationType(e.target.value as AccumulationType)}>
            <option value="continua">Compra continua</option>
            <option value="hasta_objetivo">Compra hasta objetivo</option>
          </select>
        </label>

        {accumulationType === "hasta_objetivo" ? (
          <>
            <label className="form-group">
              <span>Tipo de objetivo</span>
              <select className="ui-select" value={targetType} onChange={e => setTargetType(e.target.value as TargetType)}>
                <option value="cantidad">Cantidad de monedas</option>
                <option value="valor">Valor en euros</option>
                <option value="porcentaje_cartera">% de la cartera</option>
              </select>
            </label>
            <label className="form-group">
              <span>{targetLabel} *</span>
              <Input inputMode="decimal" value={targetValue} onChange={e => setTargetValue(e.target.value)} />
            </label>
          </>
        ) : null}

        <label className="form-group">
          <span>Inicio en esta etapa</span>
          <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
        </label>
        <label className="form-group">
          <span>Fin (vacío = sin fecha final)</span>
          <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
        </label>
        <label className="form-group">
          <span>Prioridad</span>
          <Input inputMode="numeric" value={priority} onChange={e => setPriority(e.target.value)} />
        </label>
        <label className="form-group investment-wide">
          <span>Notas</span>
          <Input value={notes} onChange={e => setNotes(e.target.value)} />
        </label>

        <div className="investment-form-actions">
          <Button type="submit" variant="primary" size="sm" loading={create.isPending} disabled={!assetId}>
            <Plus size={14} /> Añadir moneda
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancelar</Button>
        </div>
      </form>
    </div>
  );
}

// ── AssetEditForm — state safe because item is guaranteed non-null ─────────────

function AssetEditForm({
  item,
  cycleAssets,
  onCollapse,
  onUpdate,
  onPause,
  onClose,
  onDelete,
  onMarkGoalReached,
  goalEval,
}: {
  item: InvestmentAsset;
  cycleAssets: InvestmentAsset[];
  onCollapse: () => void;
  onUpdate: (id: string, data: Partial<InvestmentAsset>) => Promise<void>;
  onPause: (id: string, data: { effectiveDate?: number; notes?: string | null }) => Promise<void>;
  onClose: (id: string, data: { effectiveDate?: number; notes?: string | null }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onMarkGoalReached: (id: string, data: MarkGoalReachedInput) => Promise<void>;
  goalEval: GoalEvalResult;
}) {
  const pctInit = getPct(item);
  const fixedInit = getFixed(item);

  const [allocationMode, setAllocationMode] = useState<AllocationMode>(pctInit !== null ? "porcentaje" : "fijo");
  const [percentage, setPercentage] = useState(pctInit !== null ? String(pctInit) : "");
  const [fixedAmount, setFixedAmount] = useState(fixedInit !== null ? String(fixedInit) : "");

  const hasTarget = item.targetAmount !== null || item.targetValueEur !== null || item.targetPortfolioPercentage !== null;
  const [accumulationType, setAccumulationType] = useState<AccumulationType>(hasTarget ? "hasta_objetivo" : "continua");
  const [targetType, setTargetType] = useState<TargetType>(
    item.targetAmount !== null ? "cantidad" :
    item.targetValueEur !== null ? "valor" : "porcentaje_cartera",
  );
  const [targetValue, setTargetValue] = useState(
    item.targetAmount !== null ? String(item.targetAmount) :
    item.targetValueEur !== null ? String(item.targetValueEur) :
    item.targetPortfolioPercentage !== null ? String(item.targetPortfolioPercentage) : "",
  );
  const [status, setStatus] = useState<AssetPlanStatus>(item.status);
  const [priority, setPriority] = useState(String(item.priority));
  const [startDate, setStartDate] = useState(toDateInput(item.startDate));
  const [endDate, setEndDate] = useState(toDateInput(item.endDate));
  const [notes, setNotes] = useState(item.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const pct = allocationMode === "porcentaje" ? parseOptionalNumber(percentage) : null;
    const fixed = allocationMode === "fijo" ? parseOptionalNumber(fixedAmount) : null;

    if (allocationMode === "porcentaje" && (pct === null || pct <= 0 || pct > 100)) {
      setError("El porcentaje debe estar entre 1 y 100."); return;
    }
    if (allocationMode === "fijo" && (fixed === null || fixed <= 0)) {
      setError("El importe fijo debe ser mayor de 0."); return;
    }

    const start = fromDateInput(startDate, true);
    const end = fromDateInput(endDate);
    if (!start) { setError("La fecha de inicio es obligatoria."); return; }
    if (end !== null && end < start) { setError("La fecha de fin no puede ser anterior al inicio."); return; }

    if (status === "active" && hasOverlappingActiveAsset(cycleAssets, item.assetId, start, end, item.id)) {
      setError("Esta moneda ya está activa en esta etapa para un rango de fechas solapado."); return;
    }

    let targetAmount: number | null = null;
    let targetValueEur: number | null = null;
    let targetPortfolioPercentage: number | null = null;

    if (accumulationType === "hasta_objetivo") {
      const tv = parseOptionalNumber(targetValue);
      if (tv === null || tv <= 0) { setError("El objetivo debe ser mayor de 0."); return; }
      if (targetType === "cantidad") targetAmount = tv;
      else if (targetType === "valor") targetValueEur = tv;
      else targetPortfolioPercentage = tv;
    }

    const allocationType = allocationMode === "porcentaje" ? "percentage" : "amount";
    const allocationValue = pct ?? fixed ?? 0;

    await onUpdate(item.id, {
      allocationType, allocationValue, allocationPercentage: pct, fixedAmountEur: fixed,
      targetAmount, targetValueEur, targetPortfolioPercentage,
      priority: Math.trunc(parseNumber(priority)),
      startDate: start, endDate: end, status, isActive: status === "active",
      notes: notes || null,
    });
    onCollapse();
  }

  const targetLabel = targetType === "cantidad" ? "Número de monedas" : targetType === "valor" ? "Valor en euros (€)" : "Porcentaje de cartera (%)";

  return (
    <div className="asset-edit-form">
      {error ? <p className="error-msg">{error}</p> : null}
      <form className="investment-form-grid compact" onSubmit={(e) => void handleSubmit(e)}>
        <label className="form-group">
          <span>Tipo de asignación</span>
          <select className="ui-select" value={allocationMode} onChange={e => setAllocationMode(e.target.value as AllocationMode)}>
            <option value="porcentaje">Porcentaje del total mensual</option>
            <option value="fijo">Importe fijo mensual</option>
          </select>
        </label>

        {allocationMode === "porcentaje" ? (
          <label className="form-group">
            <span>Porcentaje (%)</span>
            <Input inputMode="decimal" value={percentage} onChange={e => setPercentage(e.target.value)} />
          </label>
        ) : (
          <label className="form-group">
            <span>Importe fijo (€/mes)</span>
            <Input inputMode="decimal" value={fixedAmount} onChange={e => setFixedAmount(e.target.value)} />
          </label>
        )}

        <label className="form-group">
          <span>Tipo de acumulación</span>
          <select className="ui-select" value={accumulationType} onChange={e => setAccumulationType(e.target.value as AccumulationType)}>
            <option value="continua">Compra continua</option>
            <option value="hasta_objetivo">Compra hasta objetivo</option>
          </select>
        </label>

        {accumulationType === "hasta_objetivo" ? (
          <>
            <label className="form-group">
              <span>Tipo de objetivo</span>
              <select className="ui-select" value={targetType} onChange={e => setTargetType(e.target.value as TargetType)}>
                <option value="cantidad">Cantidad de monedas</option>
                <option value="valor">Valor en euros</option>
                <option value="porcentaje_cartera">% de la cartera</option>
              </select>
            </label>
            <label className="form-group">
              <span>{targetLabel}</span>
              <Input inputMode="decimal" value={targetValue} onChange={e => setTargetValue(e.target.value)} />
            </label>
          </>
        ) : null}

        <label className="form-group">
          <span>Estado</span>
          <select className="ui-select" value={status} onChange={e => setStatus(e.target.value as AssetPlanStatus)}>
            <option value="active">Activa</option>
            <option value="paused">Pausada</option>
            <option value="closed">Retirada</option>
          </select>
        </label>

        <label className="form-group">
          <span>Inicio en esta etapa</span>
          <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
        </label>
        <label className="form-group">
          <span>Dejar de comprar a partir de (opcional)</span>
          <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
        </label>
        <label className="form-group">
          <span>Prioridad</span>
          <Input inputMode="numeric" value={priority} onChange={e => setPriority(e.target.value)} />
        </label>
        <label className="form-group investment-wide">
          <span>Notas</span>
          <Input value={notes} onChange={e => setNotes(e.target.value)} />
        </label>

        <div className="investment-form-actions">
          <Button type="submit" variant="secondary" size="sm">
            <Save size={14} /> Guardar cambios
          </Button>
          {item.status !== "paused" ? (
            <Button
              type="button" variant="ghost" size="sm"
              onClick={() => {
                const effectiveDate = fromDateInput(endDate) ?? Date.now();
                void onPause(item.id, { effectiveDate, notes: notes || null }).then(onCollapse);
              }}
            >
              <CircleOff size={14} /> Pausar compras
            </Button>
          ) : (
            <Button
              type="button" variant="ghost" size="sm"
              onClick={() => {
                void onUpdate(item.id, { status: "active", isActive: true, endDate: null }).then(onCollapse);
              }}
            >
              Reactivar
            </Button>
          )}
          {item.status !== "closed" ? (
            <Button
              type="button" variant="ghost" size="sm"
              onClick={() => {
                const effectiveDate = fromDateInput(endDate) ?? Date.now();
                void onClose(item.id, { effectiveDate, notes: notes || null }).then(onCollapse);
              }}
            >
              <XCircle size={14} /> Dejar de comprar
            </Button>
          ) : null}
          {goalEval.hasGoal && "observedValue" in goalEval ? (
            <Button
              type="button" variant="ghost" size="sm"
              onClick={() => {
                const effectiveDate = fromDateInput(endDate) ?? Date.now();
                void onMarkGoalReached(item.id, {
                  effectiveDate,
                  observedValue: goalEval.observedValue,
                  goalType: goalEval.goalType,
                }).then(onCollapse);
              }}
            >
              <CheckCircle2 size={14} /> Marcar como alcanzado
            </Button>
          ) : null}
          <Button
            type="button" variant="danger" size="sm"
            onClick={() => {
              if (confirm(`¿Eliminar esta moneda del plan? La posición en cartera se conserva.`)) {
                void onDelete(item.id).then(onCollapse);
              }
            }}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </form>
    </div>
  );
}

// ── AssetCard ─────────────────────────────────────────────────────────────────

function GoalProgressSection({ eval_, monthly }: { eval_: GoalEvalResult; monthly: number }) {
  const info = formatGoalProgress(eval_, monthly);
  if (!info) return null;
  const isReached = "reached" in eval_ && eval_.reached;
  const progress = "progress" in eval_ ? eval_.progress : null;
  return (
    <div className="asset-goal-progress">
      <div className="asset-goal-bar-row">
        {progress !== null ? (
          <div className="asset-goal-bar-track">
            <div className="asset-goal-bar-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        ) : null}
        <span className={`asset-goal-label ${isReached ? "asset-goal-reached" : ""}`}>{info.label}</span>
      </div>
      {info.releasedLabel ? <span className="asset-goal-released">{info.releasedLabel}</span> : null}
    </div>
  );
}

function AssetCard({
  item,
  globalAssets,
  cycleAssets,
  monthlyAmountEur,
  goalEval,
  onUpdate,
  onPause,
  onClose,
  onDelete,
  onMarkGoalReached,
  onReactivate,
}: {
  item: InvestmentAsset;
  globalAssets: Asset[];
  cycleAssets: InvestmentAsset[];
  monthlyAmountEur: number;
  goalEval: GoalEvalResult;
  onUpdate: (id: string, data: Partial<InvestmentAsset>) => Promise<void>;
  onPause: (id: string, data: { effectiveDate?: number; notes?: string | null }) => Promise<void>;
  onClose: (id: string, data: { effectiveDate?: number; notes?: string | null }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onMarkGoalReached: (id: string, data: MarkGoalReachedInput) => Promise<void>;
  onReactivate: (id: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const asset = Array.isArray(globalAssets) ? globalAssets.find(a => a.id === item.assetId) : undefined;
  const pct = getPct(item);
  const fixed = getFixed(item);
  const monthly = getMonthlyAmount(item, monthlyAmountEur);
  const accType = getAccumulationType(item);
  const target = getTargetDisplay(item);
  const isGoalReached = item.status === "goal_reached";

  return (
    <article className="asset-plan-card">
      <div className="asset-plan-header">
        <div className="asset-plan-info">
          <CryptoLogo symbol={asset?.symbol ?? item.assetId} logoUrl={asset?.logoUrl ?? null} size={28} />
          <div>
            <strong className="asset-plan-name">
              {asset ? `${asset.symbol} · ${asset.name}` : item.assetId}
            </strong>
            <span className="asset-plan-meta">
              {pct !== null ? `${pct}%` : fixed !== null ? `${formatMoney(fixed)}/mes` : "Sin asignación"}
              {monthly !== null && !isGoalReached ? ` → ${formatMoney(monthly)}/mes` : ""}
              {" · "}{accType === "hasta_objetivo" ? "Hasta objetivo" : "Compra continua"}
            </span>
          </div>
        </div>
        <div className="asset-plan-actions">
          <span className={`badge ${ASSET_STATUS_BADGE[item.status]}`}>
            {isGoalReached ? <CheckCircle2 size={12} style={{ marginRight: 4 }} /> : null}
            {ASSET_STATUS_LABEL[item.status]}
          </span>
          {!isGoalReached ? (
            <Button
              type="button" variant="ghost" size="sm"
              onClick={() => setExpanded(v => !v)}
            >
              {expanded ? "Cerrar" : "Editar"}
            </Button>
          ) : null}
        </div>
      </div>

      <dl className="asset-plan-details">
        <div><dt>Inicio</dt><dd>{formatDate(item.startDate)}</dd></div>
        <div><dt>Fin</dt><dd>{isGoalReached && item.goalReachedAt ? formatDate(item.goalReachedAt) : formatDate(item.endDate)}</dd></div>
        {target ? <div className="asset-plan-target-row"><dt>Objetivo</dt><dd>{target}</dd></div> : null}
      </dl>

      {!isGoalReached && goalEval.hasGoal ? (
        <GoalProgressSection eval_={goalEval} monthly={monthly ?? 0} />
      ) : null}

      {isGoalReached ? (
        <div className="asset-goal-reached-section">
          <p className="asset-goal-reached-msg">
            <CheckCircle2 size={14} /> Objetivo alcanzado
            {item.goalReachedAt ? ` el ${formatDate(item.goalReachedAt)}` : ""}
            {item.goalReachedValue !== null && item.goalReachedValue !== undefined
              ? ` · Valor observado: ${item.goalReachedType === "quantity"
                  ? item.goalReachedValue.toLocaleString("es-ES", { maximumFractionDigits: 4 })
                  : item.goalReachedType === "portfolio_percentage"
                    ? `${item.goalReachedValue.toFixed(1)}%`
                    : formatMoney(item.goalReachedValue)}`
              : ""}
          </p>
          <p className="asset-goal-released-msg">
            Presupuesto liberado: ~{formatMoney(monthly ?? 0)}/mes — redistribuido a otras monedas activas.
          </p>
          <Button
            type="button" variant="ghost" size="sm"
            onClick={() => void onReactivate(item.id)}
          >
            <RotateCcw size={14} /> Reactivar
          </Button>
        </div>
      ) : null}

      {expanded && !isGoalReached ? (
        <AssetEditForm
          key={item.id}
          item={item}
          cycleAssets={cycleAssets}
          onCollapse={() => setExpanded(false)}
          onUpdate={onUpdate}
          onPause={onPause}
          onClose={onClose}
          onDelete={onDelete}
          onMarkGoalReached={onMarkGoalReached}
          goalEval={goalEval}
        />
      ) : null}
    </article>
  );
}

// ── PlanEtapaActivos ──────────────────────────────────────────────────────────

export function PlanEtapaActivos({
  cycleId,
  cycleStart,
  monthlyAmountEur,
}: {
  cycleId: string;
  cycleStart: number;
  monthlyAmountEur: number;
}) {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);

  const globalAssetsQ = useQuery({
    queryKey: ["assets"],
    queryFn: () => unwrap(window.cryptoControl.assets.list()),
  });
  const globalAssets: Asset[] = Array.isArray(globalAssetsQ.data) ? globalAssetsQ.data : [];

  const catalogQ = useQuery({
    queryKey: ["assets-catalog"],
    queryFn: () => unwrap(window.cryptoControl.assets.catalog()),
    staleTime: 300_000,
  });
  const catalog: CatalogAsset[] = Array.isArray(catalogQ.data)
    ? catalogQ.data
    : globalAssets.map(a => ({
        ...a, logoUrl: a.logoUrl ?? null, inDb: true, supportedProviders: [], hasCoinbase: false,
      }));

  const cycleAssetsQ = useQuery({
    queryKey: ["investment-assets"],
    queryFn: () => unwrap(window.cryptoControl.investmentAssets.list()),
  });
  const cycleAssets: InvestmentAsset[] = (cycleAssetsQ.data ?? []).filter(a => a.cycleId === cycleId);

  const positionsQ = useQuery({
    queryKey: ["portfolio-positions"],
    queryFn: () => unwrap(window.cryptoControl.portfolio.getPositions()),
    staleTime: 60_000,
  });
  const positions: Record<string, PortfolioPosition> = positionsQ.data ?? {};

  const allocationQ = useQuery({
    queryKey: ["portfolio-allocation"],
    queryFn: () => unwrap(window.cryptoControl.portfolio.getAllocation()),
    staleTime: 60_000,
  });
  const allocations: AssetAllocation[] = allocationQ.data ?? [];
  const allocationMap: Record<string, AssetAllocation> = {};
  for (const a of allocations) allocationMap[a.assetId] = a;

  const summaryQ = useQuery({
    queryKey: ["portfolio-summary"],
    queryFn: () => unwrap(window.cryptoControl.portfolio.getSummary()),
    staleTime: 60_000,
  });
  const totalValueEur = summaryQ.data?.totalValueEur ?? 0;

  function getPositionData(assetId: string): PositionData | undefined {
    const pos = positions[assetId];
    if (!pos) return undefined;
    const alloc = allocationMap[assetId];
    const currentValueEur = alloc?.valueEur ?? null;
    const currentWeightPct = totalValueEur > 0 && alloc ? (alloc.valueEur / totalValueEur) * 100 : null;
    return { balance: pos.balance, currentValueEur, currentWeightPct };
  }

  const invalidateAssets = () => qc.invalidateQueries({ queryKey: ["investment-assets"] });
  const invalidateAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["investment-assets"] }),
      qc.invalidateQueries({ queryKey: ["strategy-revisions"] }),
    ]);
  };

  const updateAsset = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<InvestmentAsset> }) =>
      unwrap(window.cryptoControl.investmentAssets.update(id, data)),
    onSuccess: invalidateAssets,
  });

  const pauseAsset = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { effectiveDate?: number; notes?: string | null } }) =>
      unwrap(window.cryptoControl.investmentAssets.pause(id, data)),
    onSuccess: invalidateAssets,
  });

  const closeAsset = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { effectiveDate?: number; notes?: string | null } }) =>
      unwrap(window.cryptoControl.investmentAssets.close(id, data)),
    onSuccess: invalidateAssets,
  });

  const deleteAsset = useMutation({
    mutationFn: (id: string) => unwrap(window.cryptoControl.investmentAssets.delete(id)),
    onSuccess: invalidateAssets,
  });

  const markGoalReached = useMutation({
    mutationFn: ({ id, data }: { id: string; data: MarkGoalReachedInput }) =>
      unwrap(window.cryptoControl.investmentAssets.markGoalReached(id, data)),
    onSuccess: invalidateAll,
  });

  const reactivate = useMutation({
    mutationFn: (id: string) => unwrap(window.cryptoControl.investmentAssets.reactivate(id)),
    onSuccess: invalidateAssets,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Monedas de esta etapa</CardTitle>
        {!showAdd ? (
          <Button variant="secondary" size="sm" onClick={() => setShowAdd(true)}>
            <Plus size={14} /> Añadir moneda
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {showAdd ? (
          <AddAssetForm
            cycleId={cycleId}
            cycleStart={cycleStart}
            catalog={catalog}
            cycleAssets={cycleAssets}
            onSuccess={() => setShowAdd(false)}
            onCancel={() => setShowAdd(false)}
          />
        ) : null}

        {cycleAssets.length === 0 && !showAdd ? (
          <p className="empty-inline">
            Esta etapa todavía no tiene monedas asignadas.
          </p>
        ) : null}

        <div className="asset-plan-list">
          {cycleAssets.map(item => (
            <AssetCard
              key={item.id}
              item={item}
              globalAssets={globalAssets}
              cycleAssets={cycleAssets}
              monthlyAmountEur={monthlyAmountEur}
              goalEval={evaluateGoal(item, getPositionData(item.assetId))}
              onUpdate={(id, data) => updateAsset.mutateAsync({ id, data }).then(() => undefined)}
              onPause={(id, data) => pauseAsset.mutateAsync({ id, data }).then(() => undefined)}
              onClose={(id, data) => closeAsset.mutateAsync({ id, data }).then(() => undefined)}
              onDelete={(id) => deleteAsset.mutateAsync(id).then(() => undefined)}
              onMarkGoalReached={(id, data) => markGoalReached.mutateAsync({ id, data }).then(() => undefined)}
              onReactivate={(id) => reactivate.mutateAsync(id).then(() => undefined)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
