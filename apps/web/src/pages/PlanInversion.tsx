import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Asset,
  InvestmentAsset,
  InvestmentCycle,
  InvestmentPlan,
  Result,
  StrategyRevision
} from "@crypto-control/core";
import { CalendarDays, CircleOff, Copy, Plus, Save, Trash2, XCircle } from "lucide-react";
import { Button } from "../components/Button";
import { Card, CardActions, CardContent, CardHeader, CardTitle } from "../components/Card";
import { CryptoLogo } from "../components/CryptoLogo";
import { Input } from "../components/Input";
import { formatMoney } from "../lib/format";

async function unwrap<T>(promise: Promise<Result<T>>) {
  const result = await promise;
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function toDateInput(value: number | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function fromDateInput(value: string, required = false) {
  if (!value) {
    if (required) throw new Error("La fecha de inicio es obligatoria.");
    return null;
  }
  return new Date(`${value}T00:00:00`).getTime();
}

function parseNumber(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseOptionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function dateRangesOverlap(aStart: number, aEnd: number | null | undefined, bStart: number, bEnd: number | null | undefined) {
  const leftEnd = aEnd ?? Number.MAX_SAFE_INTEGER;
  const rightEnd = bEnd ?? Number.MAX_SAFE_INTEGER;
  return aStart <= rightEnd && bStart <= leftEnd;
}

function numberInputValue(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function formatDate(value: number | null | undefined) {
  if (!value) return "Abierta";
  return new Date(value).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function assetLabel(asset: Asset | undefined, fallback: string) {
  return asset ? `${asset.symbol} · ${asset.name}` : fallback;
}

type PlanStatus = InvestmentPlan["status"];
type CycleStatus = InvestmentCycle["status"];
type AssetPlanStatus = InvestmentAsset["status"];

const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  active: "Activo",
  inactive: "Inactivo",
  archived: "Archivado",
};

const CYCLE_STATUS_LABEL: Record<CycleStatus, string> = {
  planned: "Planificado",
  active: "Activo",
  paused: "Pausado",
  closed: "Cerrado",
};

const ASSET_STATUS_LABEL: Record<AssetPlanStatus, string> = {
  active: "Activa",
  paused: "Pausada",
  closed: "Cerrada",
};

function allocationSummary(item: Pick<InvestmentAsset, "allocationPercentage" | "fixedAmountEur" | "allocationType" | "allocationValue">) {
  const percentage = item.allocationPercentage ?? (item.allocationType === "percentage" ? item.allocationValue : null);
  const fixed = item.fixedAmountEur ?? (item.allocationType === "amount" ? item.allocationValue : null);
  const parts = [];
  if (percentage !== null && percentage !== undefined) {
    parts.push(`${percentage.toLocaleString("es-ES", { maximumFractionDigits: 2 })}%`);
  }
  if (fixed !== null && fixed !== undefined) {
    parts.push(`${formatMoney(fixed)}/mes`);
  }
  return parts.length ? parts.join(" · ") : "Sin asignación";
}

type CycleDistribution = {
  activeCount: number;
  percentageTotal: number;
  fixedTotal: number;
  unassignedAmount: number | null;
  warnings: string[];
};

function getAssetPercentage(item: Pick<InvestmentAsset, "allocationPercentage" | "allocationType" | "allocationValue">) {
  return item.allocationPercentage ?? (item.allocationType === "percentage" ? item.allocationValue : null);
}

function getAssetFixedAmount(item: Pick<InvestmentAsset, "fixedAmountEur" | "allocationType" | "allocationValue">) {
  return item.fixedAmountEur ?? (item.allocationType === "amount" ? item.allocationValue : null);
}

function calculateCycleDistribution(cycle: InvestmentCycle | null | undefined, cycleAssets: InvestmentAsset[]): CycleDistribution {
  const activeAssets = cycleAssets.filter((item) => item.status === "active" && item.isActive);
  const percentageTotal = activeAssets.reduce((sum, item) => sum + (getAssetPercentage(item) ?? 0), 0);
  const fixedTotal = activeAssets.reduce((sum, item) => sum + (getAssetFixedAmount(item) ?? 0), 0);
  const unassignedAmount = cycle ? Math.max(cycle.monthlyAmountEur - fixedTotal, 0) : null;
  const warnings: string[] = [];

  if (cycle?.status === "active" && activeAssets.length === 0) {
    warnings.push("El ciclo activo necesita al menos una moneda activa.");
  }
  if (cycle?.status === "active" && activeAssets.some((item) => getAssetPercentage(item) !== null) && Math.abs(percentageTotal - 100) > 0.01) {
    warnings.push("La suma de porcentajes activos debe ser 100% antes de activar el ciclo.");
  }
  if (cycle && fixedTotal - cycle.monthlyAmountEur > 0.01) {
    warnings.push("Los importes fijos superan el importe mensual del ciclo.");
  }
  if (cycle?.status !== "active" && activeAssets.some((item) => getAssetPercentage(item) !== null) && Math.abs(percentageTotal - 100) > 0.01) {
    warnings.push("Borrador: revisa que los porcentajes sumen 100% antes de activar.");
  }

  return {
    activeCount: activeAssets.length,
    percentageTotal,
    fixedTotal,
    unassignedAmount,
    warnings,
  };
}

function hasOverlappingActiveAsset(items: InvestmentAsset[], assetId: string, startDate: number, endDate: number | null, excludingId?: string) {
  return items.some((item) => (
    item.id !== excludingId
    && item.assetId === assetId
    && item.status === "active"
    && item.isActive
    && dateRangesOverlap(startDate, endDate, item.startDate, item.endDate)
  ));
}

function revisionSummary(revision: StrategyRevision, assets: Asset[]) {
  try {
    const parsed = JSON.parse(revision.changesJson || "{}") as {
      type?: string;
      assetId?: string | null;
      allocationPercentage?: number | null;
      fixedAmountEur?: number | null;
    };
    const typeLabel: Record<string, string> = {
      note: "Nota estratégica",
      start_asset: "Empezar moneda",
      pause_asset: "Pausar moneda",
      close_asset: "Cerrar moneda",
      change_allocation: "Cambiar asignación",
    };
    const asset = parsed.assetId ? assets.find((item) => item.id === parsed.assetId) : null;
    const parts = [typeLabel[parsed.type ?? "note"] ?? "Cambio estratégico"];
    if (asset) parts.push(asset.symbol);
    if (typeof parsed.allocationPercentage === "number") parts.push(`${parsed.allocationPercentage}%`);
    if (typeof parsed.fixedAmountEur === "number") parts.push(`${formatMoney(parsed.fixedAmountEur)}/mes`);
    return parts.join(" · ");
  } catch {
    return "Cambio estratégico";
  }
}

const EMPTY_ASSETS: Asset[] = [];
const EMPTY_CYCLES: InvestmentCycle[] = [];
const EMPTY_INVESTMENT_ASSETS: InvestmentAsset[] = [];
const EMPTY_REVISIONS: StrategyRevision[] = [];

type PlanEditorProps = {
  plan: InvestmentPlan;
  onUpdate: (id: string, data: { name?: string; description?: string | null; notes?: string | null; status?: PlanStatus; baseCurrency?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

function PlanEditor({ plan, onUpdate, onDelete }: PlanEditorProps) {
  const [name, setName] = useState(plan.name);
  const [description, setDescription] = useState(plan.description ?? "");
  const [notes, setNotes] = useState(plan.notes ?? "");
  const [status, setStatus] = useState<PlanStatus>(plan.status);
  const [baseCurrency, setBaseCurrency] = useState(plan.baseCurrency || "EUR");

  return (
    <Card className="investment-plan-card">
      <CardHeader>
        <div>
          <CardTitle>Plan estratégico</CardTitle>
          <p className="panel-caption">Fuente de verdad para ciclos y monedas futuras.</p>
        </div>
        <span className={status === "active" ? "badge badge-success" : "badge"}>{PLAN_STATUS_LABEL[status]}</span>
      </CardHeader>
      <CardContent>
        <form
          className="investment-form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            void onUpdate(plan.id, { name, description: description || null, notes: notes || null, status, baseCurrency });
          }}
        >
          <label className="form-group">
            <span>Nombre</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="form-group">
            <span>Estado</span>
            <select className="ui-select" value={status} onChange={(event) => setStatus(event.target.value as PlanStatus)}>
              <option value="active">Activo</option>
              <option value="inactive">Inactivo</option>
              {status === "archived" ? <option value="archived">Archivado</option> : null}
            </select>
          </label>
          <label className="form-group">
            <span>Moneda base</span>
            <Input value={baseCurrency} onChange={(event) => setBaseCurrency(event.target.value.toUpperCase())} />
          </label>
          <label className="form-group investment-wide">
            <span>Descripción</span>
            <Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Estrategia general del plan" />
          </label>
          <label className="form-group investment-wide">
            <span>Notas</span>
            <textarea className="ui-textarea investment-textarea" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
          <div className="investment-form-actions">
            <Button type="submit" variant="secondary" size="sm"><Save size={15} /> Guardar plan</Button>
            <Button type="button" variant="danger" size="sm" onClick={() => void onDelete(plan.id)}><Trash2 size={15} /> Eliminar</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

type CycleEditorProps = {
  cycle: InvestmentCycle;
  assets: Asset[];
  cycleAssets: InvestmentAsset[];
  revisions: StrategyRevision[];
  distribution: CycleDistribution;
  onUpdateCycle: (id: string, data: Partial<InvestmentCycle>) => Promise<void>;
  onDeleteCycle: (id: string) => Promise<void>;
  onDuplicateCycle: (cycle: InvestmentCycle, cycleAssets: InvestmentAsset[]) => Promise<void>;
  onCreateAsset: (data: {
    cycleId: string;
    assetId: string;
    allocationType: "percentage" | "amount";
    allocationValue: number;
    allocationPercentage: number | null;
    fixedAmountEur: number | null;
    priority: number;
    targetAmount: number | null;
    targetValueEur: number | null;
    targetPortfolioPercentage: number | null;
    startDate: number;
    endDate: number | null;
    status: AssetPlanStatus;
    isActive: boolean;
    notes: string | null;
  }) => Promise<void>;
  onUpdateAsset: (id: string, data: {
    assetId?: string;
    allocationType?: "percentage" | "amount";
    allocationValue?: number;
    allocationPercentage?: number | null;
    fixedAmountEur?: number | null;
    priority?: number;
    targetAmount?: number | null;
    targetValueEur?: number | null;
    targetPortfolioPercentage?: number | null;
    startDate?: number;
    endDate?: number | null;
    status?: AssetPlanStatus;
    isActive?: boolean;
    notes?: string | null;
  }) => Promise<void>;
  onPauseAsset: (id: string, data: { effectiveDate?: number; notes?: string | null }) => Promise<void>;
  onCloseAsset: (id: string, data: { effectiveDate?: number; notes?: string | null }) => Promise<void>;
  onDeleteAsset: (id: string) => Promise<void>;
  onCreateRevision: (data: { cycleId: string; effectiveDate: number; title: string; notes: string | null; changesJson?: string }) => Promise<void>;
};

function CycleEditor({
  cycle,
  assets,
  cycleAssets,
  revisions,
  distribution,
  onUpdateCycle,
  onDeleteCycle,
  onDuplicateCycle,
  onCreateAsset,
  onUpdateAsset,
  onPauseAsset,
  onCloseAsset,
  onDeleteAsset,
  onCreateRevision,
}: CycleEditorProps) {
  const [name, setName] = useState(cycle.name);
  const [startDate, setStartDate] = useState(toDateInput(cycle.startDate));
  const [endDate, setEndDate] = useState(toDateInput(cycle.endDate));
  const [monthlyAmount, setMonthlyAmount] = useState(String(cycle.monthlyAmountEur));
  const [contributionCurrency, setContributionCurrency] = useState(cycle.contributionCurrency || "EUR");
  const [status, setStatus] = useState<CycleStatus>(cycle.status);
  const [priority, setPriority] = useState(String(cycle.priority));
  const [notes, setNotes] = useState(cycle.notes ?? "");

  const [assetId, setAssetId] = useState(assets[0]?.id ?? "");
  const [allocationPercentage, setAllocationPercentage] = useState("");
  const [fixedAmountEur, setFixedAmountEur] = useState("");
  const [assetPriority, setAssetPriority] = useState("0");
  const [targetAmount, setTargetAmount] = useState("");
  const [targetValueEur, setTargetValueEur] = useState("");
  const [targetPortfolioPercentage, setTargetPortfolioPercentage] = useState("");
  const [assetStartDate, setAssetStartDate] = useState(toDateInput(cycle.startDate));
  const [assetEndDate, setAssetEndDate] = useState("");
  const [assetStatus, setAssetStatus] = useState<AssetPlanStatus>("active");
  const [assetNotes, setAssetNotes] = useState("");

  const [revisionTitle, setRevisionTitle] = useState("");
  const [revisionDate, setRevisionDate] = useState(toDateInput(cycle.startDate));
  const [revisionChangeType, setRevisionChangeType] = useState("note");
  const [revisionAssetId, setRevisionAssetId] = useState("");
  const [revisionAllocationPercentage, setRevisionAllocationPercentage] = useState("");
  const [revisionFixedAmountEur, setRevisionFixedAmountEur] = useState("");
  const [revisionNotes, setRevisionNotes] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  async function submitCycle(event: FormEvent) {
    event.preventDefault();
    setLocalError(null);
    const nextStartDate = fromDateInput(startDate, true) ?? cycle.startDate;
    const nextEndDate = fromDateInput(endDate);
    if (nextEndDate !== null && nextEndDate < nextStartDate) {
      setLocalError("Ciclo: la fecha fin no puede ser anterior a la fecha inicio.");
      return;
    }
    await onUpdateCycle(cycle.id, {
      name,
      startDate: nextStartDate,
      endDate: nextEndDate,
      monthlyAmountEur: parseNumber(monthlyAmount),
      contributionCurrency,
      status,
      priority: Math.trunc(parseNumber(priority)),
      notes: notes || null,
    });
  }

  async function submitAsset(event: FormEvent) {
    event.preventDefault();
    if (!assetId) return;
    setLocalError(null);
    const percentage = parseOptionalNumber(allocationPercentage);
    const fixedAmount = parseOptionalNumber(fixedAmountEur);
    const allocationType = percentage !== null ? "percentage" : "amount";
    const allocationValue = percentage ?? fixedAmount ?? 0;
    const nextStartDate = fromDateInput(assetStartDate, true) ?? cycle.startDate;
    const nextEndDate = fromDateInput(assetEndDate);
    if (nextEndDate !== null && nextEndDate < nextStartDate) {
      setLocalError("Moneda del plan: la fecha fin no puede ser anterior a la fecha inicio.");
      return;
    }
    if (assetStatus === "active" && hasOverlappingActiveAsset(cycleAssets, assetId, nextStartDate, nextEndDate)) {
      setLocalError("Esta moneda ya está activa en ese ciclo para un rango de fechas solapado.");
      return;
    }
    await onCreateAsset({
      cycleId: cycle.id,
      assetId,
      allocationType,
      allocationValue,
      allocationPercentage: percentage,
      fixedAmountEur: fixedAmount,
      priority: Math.trunc(parseNumber(assetPriority)),
      targetAmount: parseOptionalNumber(targetAmount),
      targetValueEur: parseOptionalNumber(targetValueEur),
      targetPortfolioPercentage: parseOptionalNumber(targetPortfolioPercentage),
      startDate: nextStartDate,
      endDate: nextEndDate,
      status: assetStatus,
      isActive: assetStatus === "active",
      notes: assetNotes || null,
    });
    setAllocationPercentage("");
    setFixedAmountEur("");
    setAssetPriority("0");
    setTargetAmount("");
    setTargetValueEur("");
    setTargetPortfolioPercentage("");
    setAssetEndDate("");
    setAssetStatus("active");
    setAssetNotes("");
  }

  async function submitRevision(event: FormEvent) {
    event.preventDefault();
    if (!revisionTitle.trim()) return;
    setLocalError(null);
    const nextEffectiveDate = fromDateInput(revisionDate, true) ?? cycle.startDate;
    if (nextEffectiveDate < cycle.startDate) {
      setLocalError("La revisión no puede ser anterior al inicio del ciclo.");
      return;
    }
    const changes = {
      type: revisionChangeType,
      assetId: revisionAssetId || null,
      allocationPercentage: parseOptionalNumber(revisionAllocationPercentage),
      fixedAmountEur: parseOptionalNumber(revisionFixedAmountEur),
    };
    await onCreateRevision({
      cycleId: cycle.id,
      effectiveDate: nextEffectiveDate,
      title: revisionTitle,
      notes: revisionNotes || null,
      changesJson: JSON.stringify(changes),
    });
    setRevisionTitle("");
    setRevisionChangeType("note");
    setRevisionAssetId("");
    setRevisionAllocationPercentage("");
    setRevisionFixedAmountEur("");
    setRevisionNotes("");
  }

  return (
    <Card className="investment-cycle-card">
      <CardHeader className="investment-cycle-header">
        <div>
          <CardTitle>{cycle.name}</CardTitle>
          <p className="panel-caption">
            {formatDate(cycle.startDate)} - {formatDate(cycle.endDate)} · {formatMoney(cycle.monthlyAmountEur)}/mes · {cycle.contributionCurrency}
          </p>
        </div>
        <CardActions>
          <span className={cycle.status === "active" ? "badge badge-success" : "badge"}>{CYCLE_STATUS_LABEL[cycle.status]}</span>
          <span className="badge">Prioridad {cycle.priority}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => void onDuplicateCycle(cycle, cycleAssets)}><Copy size={15} /> Duplicar</Button>
        </CardActions>
      </CardHeader>
      <CardContent className="investment-cycle-content">
        {localError ? <p className="error-msg">{localError}</p> : null}
        <div className="investment-distribution">
          <span>Activas: <strong>{distribution.activeCount}</strong></span>
          <span>Porcentaje: <strong>{distribution.percentageTotal.toLocaleString("es-ES", { maximumFractionDigits: 2 })}%</strong></span>
          <span>Importe fijo: <strong>{formatMoney(distribution.fixedTotal)}/mes</strong></span>
          <span>Sin asignar: <strong>{distribution.unassignedAmount === null ? "No aplica" : `${formatMoney(distribution.unassignedAmount)}/mes`}</strong></span>
        </div>
        {distribution.warnings.length ? (
          <div className="investment-warning" role="status">
            {distribution.warnings.map((warning) => <span key={warning}>{warning}</span>)}
          </div>
        ) : null}
        <form className="investment-form-grid" onSubmit={(event) => void submitCycle(event)}>
          <label className="form-group">
            <span>Nombre ciclo</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="form-group">
            <span>Inicio</span>
            <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </label>
          <label className="form-group">
            <span>Fin opcional</span>
            <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </label>
          <label className="form-group">
            <span>Importe mensual</span>
            <Input inputMode="decimal" value={monthlyAmount} onChange={(event) => setMonthlyAmount(event.target.value)} />
          </label>
          <label className="form-group">
            <span>Moneda aporte</span>
            <Input value={contributionCurrency} onChange={(event) => setContributionCurrency(event.target.value.toUpperCase())} />
          </label>
          <label className="form-group">
            <span>Estado</span>
            <select className="ui-select" value={status} onChange={(event) => setStatus(event.target.value as CycleStatus)}>
              <option value="planned">Planificado</option>
              <option value="active">Activo</option>
              <option value="paused">Pausado</option>
              <option value="closed">Cerrado</option>
            </select>
          </label>
          <label className="form-group">
            <span>Prioridad</span>
            <Input inputMode="numeric" value={priority} onChange={(event) => setPriority(event.target.value)} />
          </label>
          <label className="form-group investment-wide">
            <span>Notas</span>
            <textarea className="ui-textarea investment-textarea" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
          <div className="investment-form-actions">
            <Button type="submit" variant="secondary" size="sm"><Save size={15} /> Guardar ciclo</Button>
            <Button type="button" variant="danger" size="sm" onClick={() => void onDeleteCycle(cycle.id)}><Trash2 size={15} /> Eliminar ciclo</Button>
          </div>
        </form>

        <section className="investment-section">
          <div className="investment-section-heading">
            <h3>Monedas del ciclo</h3>
            <span>{cycleAssets.length} monedas</span>
          </div>
          <form className="investment-form-grid compact" onSubmit={(event) => void submitAsset(event)}>
            <label className="form-group">
              <span>Activo</span>
              <select className="ui-select" value={assetId} onChange={(event) => setAssetId(event.target.value)}>
                {assets.map((asset) => (
                  <option key={asset.id} value={asset.id}>{asset.symbol} · {asset.name}</option>
                ))}
              </select>
            </label>
            <label className="form-group">
              <span>Porcentaje asignado</span>
              <Input inputMode="decimal" value={allocationPercentage} onChange={(event) => setAllocationPercentage(event.target.value)} placeholder="Ej. 40" />
            </label>
            <label className="form-group">
              <span>Importe fijo opcional</span>
              <Input inputMode="decimal" value={fixedAmountEur} onChange={(event) => setFixedAmountEur(event.target.value)} placeholder="Ej. 25" />
            </label>
            <label className="form-group">
              <span>Prioridad</span>
              <Input inputMode="numeric" value={assetPriority} onChange={(event) => setAssetPriority(event.target.value)} />
            </label>
            <label className="form-group">
              <span>Objetivo cantidad</span>
              <Input inputMode="decimal" value={targetAmount} onChange={(event) => setTargetAmount(event.target.value)} />
            </label>
            <label className="form-group">
              <span>Objetivo valor EUR</span>
              <Input inputMode="decimal" value={targetValueEur} onChange={(event) => setTargetValueEur(event.target.value)} />
            </label>
            <label className="form-group">
              <span>Objetivo peso %</span>
              <Input inputMode="decimal" value={targetPortfolioPercentage} onChange={(event) => setTargetPortfolioPercentage(event.target.value)} />
            </label>
            <label className="form-group">
              <span>Inicio moneda</span>
              <Input type="date" value={assetStartDate} onChange={(event) => setAssetStartDate(event.target.value)} />
            </label>
            <label className="form-group">
              <span>Fin opcional</span>
              <Input type="date" value={assetEndDate} onChange={(event) => setAssetEndDate(event.target.value)} />
            </label>
            <label className="form-group">
              <span>Estado</span>
              <select className="ui-select" value={assetStatus} onChange={(event) => setAssetStatus(event.target.value as AssetPlanStatus)}>
                <option value="active">Activa</option>
                <option value="paused">Pausada</option>
                <option value="closed">Cerrada</option>
              </select>
            </label>
            <label className="form-group investment-wide">
              <span>Notas</span>
              <Input value={assetNotes} onChange={(event) => setAssetNotes(event.target.value)} />
            </label>
            <div className="investment-form-actions">
              <Button type="submit" variant="primary" size="sm" disabled={!assetId}><Plus size={15} /> Añadir moneda</Button>
            </div>
          </form>

          <div className="investment-asset-grid">
            {cycleAssets.length === 0 ? (
              <p className="empty-inline">Este ciclo todavía no tiene monedas asignadas.</p>
            ) : cycleAssets.map((item) => (
              <InvestmentAssetEditor
                key={item.id}
                item={item}
                assets={assets}
                cycleAssets={cycleAssets}
                onUpdate={onUpdateAsset}
                onPause={onPauseAsset}
                onClose={onCloseAsset}
                onDelete={onDeleteAsset}
              />
            ))}
          </div>
        </section>

        <section className="investment-section">
          <div className="investment-section-heading">
            <h3>Revisiones de estrategia</h3>
            <span>{revisions.length} revisiones</span>
          </div>
          <form className="investment-form-grid compact" onSubmit={(event) => void submitRevision(event)}>
            <label className="form-group">
              <span>Fecha efectiva</span>
              <Input type="date" value={revisionDate} onChange={(event) => setRevisionDate(event.target.value)} />
            </label>
            <label className="form-group">
              <span>Tipo cambio</span>
              <select className="ui-select" value={revisionChangeType} onChange={(event) => setRevisionChangeType(event.target.value)}>
                <option value="note">Nota estratégica</option>
                <option value="start_asset">Empezar moneda</option>
                <option value="pause_asset">Pausar moneda</option>
                <option value="close_asset">Cerrar moneda</option>
                <option value="change_allocation">Cambiar asignación</option>
              </select>
            </label>
            <label className="form-group">
              <span>Activo afectado</span>
              <select className="ui-select" value={revisionAssetId} onChange={(event) => setRevisionAssetId(event.target.value)}>
                <option value="">Sin activo concreto</option>
                {assets.map((asset) => (
                  <option key={asset.id} value={asset.id}>{asset.symbol} · {asset.name}</option>
                ))}
              </select>
            </label>
            <label className="form-group">
              <span>Título</span>
              <Input value={revisionTitle} onChange={(event) => setRevisionTitle(event.target.value)} placeholder="Ej. Dejar ADA, empezar TON" />
            </label>
            <label className="form-group">
              <span>Nuevo porcentaje</span>
              <Input inputMode="decimal" value={revisionAllocationPercentage} onChange={(event) => setRevisionAllocationPercentage(event.target.value)} />
            </label>
            <label className="form-group">
              <span>Nuevo importe fijo</span>
              <Input inputMode="decimal" value={revisionFixedAmountEur} onChange={(event) => setRevisionFixedAmountEur(event.target.value)} />
            </label>
            <label className="form-group investment-wide">
              <span>Notas</span>
              <Input value={revisionNotes} onChange={(event) => setRevisionNotes(event.target.value)} />
            </label>
            <div className="investment-form-actions">
              <Button type="submit" variant="secondary" size="sm"><CalendarDays size={15} /> Registrar revisión</Button>
            </div>
          </form>
          <div className="investment-revision-list">
            {revisions.length === 0 ? (
              <p className="empty-inline">No hay revisiones registradas para este ciclo.</p>
            ) : revisions.map((revision) => (
              <article className="investment-revision" key={revision.id}>
                <strong>{revision.title}</strong>
                <span>{formatDate(revision.effectiveDate)}</span>
                <span>{revisionSummary(revision, assets)}</span>
                {revision.notes ? <p>{revision.notes}</p> : null}
              </article>
            ))}
          </div>
        </section>
      </CardContent>
    </Card>
  );
}

function InvestmentAssetEditor({
  item,
  assets,
  cycleAssets,
  onUpdate,
  onPause,
  onClose,
  onDelete,
}: {
  item: InvestmentAsset;
  assets: Asset[];
  cycleAssets: InvestmentAsset[];
  onUpdate: CycleEditorProps["onUpdateAsset"];
  onPause: CycleEditorProps["onPauseAsset"];
  onClose: CycleEditorProps["onCloseAsset"];
  onDelete: CycleEditorProps["onDeleteAsset"];
}) {
  const asset = assets.find((entry) => entry.id === item.assetId);
  const [assetId, setAssetId] = useState(item.assetId);
  const [allocationPercentage, setAllocationPercentage] = useState(numberInputValue(item.allocationPercentage ?? (item.allocationType === "percentage" ? item.allocationValue : null)));
  const [fixedAmountEur, setFixedAmountEur] = useState(numberInputValue(item.fixedAmountEur ?? (item.allocationType === "amount" ? item.allocationValue : null)));
  const [priority, setPriority] = useState(String(item.priority));
  const [targetAmount, setTargetAmount] = useState(numberInputValue(item.targetAmount));
  const [targetValueEur, setTargetValueEur] = useState(numberInputValue(item.targetValueEur));
  const [targetPortfolioPercentage, setTargetPortfolioPercentage] = useState(numberInputValue(item.targetPortfolioPercentage));
  const [startDate, setStartDate] = useState(toDateInput(item.startDate));
  const [endDate, setEndDate] = useState(toDateInput(item.endDate));
  const [status, setStatus] = useState<AssetPlanStatus>(item.status);
  const [notes, setNotes] = useState(item.notes ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  const percentage = parseOptionalNumber(allocationPercentage);
  const fixedAmount = parseOptionalNumber(fixedAmountEur);
  const allocationType = percentage !== null ? "percentage" : "amount";
  const allocationValue = percentage ?? fixedAmount ?? 0;
  const objectiveParts = [
    parseOptionalNumber(targetAmount) !== null ? `Cantidad ${parseOptionalNumber(targetAmount)}` : null,
    parseOptionalNumber(targetValueEur) !== null ? `Valor ${formatMoney(parseOptionalNumber(targetValueEur)! )}` : null,
    parseOptionalNumber(targetPortfolioPercentage) !== null ? `Peso ${parseOptionalNumber(targetPortfolioPercentage)}%` : null,
  ].filter(Boolean);

  return (
    <article className="investment-asset-card">
      <div className="investment-asset-header">
        <CryptoLogo symbol={asset?.symbol ?? item.assetId} logoUrl={asset?.logoUrl} size={34} />
        <div>
          <strong>{assetLabel(asset, item.assetId)}</strong>
          <span>{allocationSummary({ allocationPercentage: percentage, fixedAmountEur: fixedAmount, allocationType, allocationValue })} · prioridad {priority}</span>
        </div>
        <span className={status === "active" ? "badge badge-success" : "badge"}>{ASSET_STATUS_LABEL[status]}</span>
      </div>
      <dl className="investment-asset-summary">
        <div><dt>Inicio</dt><dd>{formatDate(item.startDate)}</dd></div>
        <div><dt>Fin</dt><dd>{formatDate(item.endDate)}</dd></div>
        <div><dt>Objetivos</dt><dd>{objectiveParts.length ? objectiveParts.join(" · ") : "Sin objetivo"}</dd></div>
      </dl>
      {localError ? <p className="error-msg">{localError}</p> : null}
      <form className="investment-form-grid compact" onSubmit={(event) => {
        event.preventDefault();
        setLocalError(null);
        const nextStartDate = fromDateInput(startDate, true) ?? item.startDate;
        const nextEndDate = fromDateInput(endDate);
        if (nextEndDate !== null && nextEndDate < nextStartDate) {
          setLocalError("Moneda del plan: la fecha fin no puede ser anterior a la fecha inicio.");
          return;
        }
        if (status === "active" && hasOverlappingActiveAsset(cycleAssets, assetId, nextStartDate, nextEndDate, item.id)) {
          setLocalError("Esta moneda ya está activa en ese ciclo para un rango de fechas solapado.");
          return;
        }
        void onUpdate(item.id, {
          assetId,
          allocationType,
          allocationValue,
          allocationPercentage: percentage,
          fixedAmountEur: fixedAmount,
          priority: Math.trunc(parseNumber(priority)),
          targetAmount: parseOptionalNumber(targetAmount),
          targetValueEur: parseOptionalNumber(targetValueEur),
          targetPortfolioPercentage: parseOptionalNumber(targetPortfolioPercentage),
          startDate: nextStartDate,
          endDate: nextEndDate,
          status,
          isActive: status === "active",
          notes: notes || null,
        });
      }}>
        <label className="form-group">
          <span>Activo</span>
          <select className="ui-select" value={assetId} onChange={(event) => setAssetId(event.target.value)}>
            {assets.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.symbol} · {entry.name}</option>
            ))}
          </select>
        </label>
        <label className="form-group">
          <span>Porcentaje</span>
          <Input inputMode="decimal" value={allocationPercentage} onChange={(event) => setAllocationPercentage(event.target.value)} />
        </label>
        <label className="form-group">
          <span>Importe fijo</span>
          <Input inputMode="decimal" value={fixedAmountEur} onChange={(event) => setFixedAmountEur(event.target.value)} />
        </label>
        <label className="form-group">
          <span>Prioridad</span>
          <Input inputMode="numeric" value={priority} onChange={(event) => setPriority(event.target.value)} />
        </label>
        <label className="form-group">
          <span>Objetivo cantidad</span>
          <Input inputMode="decimal" value={targetAmount} onChange={(event) => setTargetAmount(event.target.value)} />
        </label>
        <label className="form-group">
          <span>Objetivo valor</span>
          <Input inputMode="decimal" value={targetValueEur} onChange={(event) => setTargetValueEur(event.target.value)} />
        </label>
        <label className="form-group">
          <span>Objetivo peso %</span>
          <Input inputMode="decimal" value={targetPortfolioPercentage} onChange={(event) => setTargetPortfolioPercentage(event.target.value)} />
        </label>
        <label className="form-group">
          <span>Inicio</span>
          <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>
        <label className="form-group">
          <span>Fin opcional</span>
          <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </label>
        <label className="form-group">
          <span>Estado</span>
          <select className="ui-select" value={status} onChange={(event) => setStatus(event.target.value as AssetPlanStatus)}>
            <option value="active">Activa</option>
            <option value="paused">Pausada</option>
            <option value="closed">Cerrada</option>
          </select>
        </label>
        <label className="form-group investment-wide">
          <span>Notas</span>
          <Input value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        <div className="investment-form-actions">
          <Button type="submit" variant="secondary" size="sm"><Save size={15} /> Guardar moneda</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => {
            setLocalError(null);
            const effectiveDate = fromDateInput(endDate) ?? Date.now();
            if (effectiveDate < item.startDate) {
              setLocalError("La fecha efectiva no puede ser anterior al inicio de la moneda.");
              return;
            }
            setStatus("paused");
            void onPause(item.id, { effectiveDate, notes: notes || null });
          }}><CircleOff size={15} /> Pausar</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => {
            setLocalError(null);
            const effectiveDate = fromDateInput(endDate) ?? Date.now();
            if (effectiveDate < item.startDate) {
              setLocalError("La fecha efectiva no puede ser anterior al inicio de la moneda.");
              return;
            }
            setStatus("closed");
            void onClose(item.id, { effectiveDate, notes: notes || null });
          }}><XCircle size={15} /> Cerrar</Button>
          <Button type="button" variant="danger" size="sm" onClick={() => void onDelete(item.id)}><Trash2 size={15} /> Eliminar</Button>
        </div>
      </form>
    </article>
  );
}

export function PlanInversion() {
  const queryClient = useQueryClient();
  const [planName, setPlanName] = useState("Plan principal");
  const [planDescription, setPlanDescription] = useState("");
  const [planNotes, setPlanNotes] = useState("");
  const [cycleName, setCycleName] = useState("Nuevo ciclo");
  const [cycleStart, setCycleStart] = useState("2026-01-01");
  const [cycleEnd, setCycleEnd] = useState("");
  const [cycleAmount, setCycleAmount] = useState("100");
  const [cycleCurrency, setCycleCurrency] = useState("EUR");
  const [cycleStatus, setCycleStatus] = useState<CycleStatus>("planned");
  const [cyclePriority, setCyclePriority] = useState("0");
  const [cycleNotes, setCycleNotes] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [renderTimestamp] = useState(() => Date.now());

  const plansQuery = useQuery({
    queryKey: ["investment-plan", "list"],
    queryFn: () => unwrap(window.cryptoControl.investmentPlan.list()),
  });

  const activePlanQuery = useQuery({
    queryKey: ["investment-plan", "active"],
    queryFn: () => unwrap(window.cryptoControl.investmentPlan.getActive()),
  });

  const assetsQuery = useQuery({
    queryKey: ["assets"],
    queryFn: () => unwrap(window.cryptoControl.assets.list()),
  });

  const activePlan = activePlanQuery.data ?? null;

  const cyclesQuery = useQuery({
    queryKey: ["investment-cycles", activePlan?.id],
    enabled: Boolean(activePlan?.id),
    queryFn: () => unwrap(window.cryptoControl.investmentCycles.list({ planId: activePlan!.id })),
  });

  const currentCycleQuery = useQuery({
    queryKey: ["investment-cycles", "current", activePlan?.id],
    enabled: Boolean(activePlan?.id),
    queryFn: () => unwrap(window.cryptoControl.investmentCycles.getCurrent({ planId: activePlan!.id })),
  });

  const planAssetsQuery = useQuery({
    queryKey: ["investment-assets"],
    enabled: Boolean(activePlan?.id),
    queryFn: () => unwrap(window.cryptoControl.investmentAssets.list()),
  });

  const revisionsQuery = useQuery({
    queryKey: ["strategy-revisions"],
    enabled: Boolean(activePlan?.id),
    queryFn: () => unwrap(window.cryptoControl.strategyRevisions.list()),
  });

  async function invalidatePlan() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["investment-plan"] }),
      queryClient.invalidateQueries({ queryKey: ["investment-cycles"] }),
      queryClient.invalidateQueries({ queryKey: ["investment-assets"] }),
      queryClient.invalidateQueries({ queryKey: ["strategy-revisions"] }),
    ]);
  }

  const createPlan = useMutation({
    mutationFn: (data: { name: string; description: string | null; notes: string | null }) => unwrap(window.cryptoControl.investmentPlan.create({
      name: data.name,
      description: data.description,
      notes: data.notes,
      status: "active",
      baseCurrency: "EUR",
    })),
    onSuccess: async () => {
      setFeedback("Plan creado y guardado.");
      await invalidatePlan();
    },
  });

  const updatePlan = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; description?: string | null; notes?: string | null; status?: PlanStatus; baseCurrency?: string } }) =>
      unwrap(window.cryptoControl.investmentPlan.update(id, data)),
    onSuccess: async () => {
      setFeedback("Plan actualizado.");
      await invalidatePlan();
    },
  });

  const deletePlan = useMutation({
    mutationFn: (id: string) => unwrap(window.cryptoControl.investmentPlan.delete(id)),
    onSuccess: async () => {
      setFeedback("Plan eliminado.");
      await invalidatePlan();
    },
  });

  const createCycle = useMutation({
    mutationFn: (data: {
      planId: string;
      name: string;
      startDate: number;
      endDate: number | null;
      monthlyAmountEur: number;
      contributionCurrency: string;
      status: CycleStatus;
      priority: number;
      notes: string | null;
    }) => unwrap(window.cryptoControl.investmentCycles.create(data)),
    onSuccess: async () => {
      setFeedback("Ciclo creado.");
      await invalidatePlan();
    },
  });

  const updateCycle = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<InvestmentCycle> }) => unwrap(window.cryptoControl.investmentCycles.update(id, data)),
    onSuccess: async () => {
      setFeedback("Ciclo actualizado.");
      await invalidatePlan();
    },
  });

  const deleteCycle = useMutation({
    mutationFn: (id: string) => unwrap(window.cryptoControl.investmentCycles.delete(id)),
    onSuccess: async () => {
      setFeedback("Ciclo eliminado.");
      await invalidatePlan();
    },
  });

  const duplicateCycle = useMutation({
    mutationFn: async ({ cycle, cycleAssets }: { cycle: InvestmentCycle; cycleAssets: InvestmentAsset[] }) => {
      const created = await unwrap(window.cryptoControl.investmentCycles.create({
        planId: cycle.planId,
        name: `${cycle.name} copia`,
        startDate: cycle.startDate,
        endDate: cycle.endDate,
        monthlyAmountEur: cycle.monthlyAmountEur,
        contributionCurrency: cycle.contributionCurrency,
        status: "planned",
        priority: cycle.priority + 1,
        notes: cycle.notes,
      }));
      for (const item of cycleAssets) {
        await unwrap(window.cryptoControl.investmentAssets.create({
          cycleId: created.id,
          assetId: item.assetId,
          allocationType: item.allocationType,
          allocationValue: item.allocationValue,
          allocationPercentage: item.allocationPercentage,
          fixedAmountEur: item.fixedAmountEur,
          priority: item.priority,
          targetAmount: item.targetAmount,
          targetValueEur: item.targetValueEur,
          targetPortfolioPercentage: item.targetPortfolioPercentage,
          startDate: item.startDate,
          endDate: item.endDate,
          status: item.status,
          isActive: item.isActive,
          notes: item.notes,
        }));
      }
      return created;
    },
    onSuccess: async () => {
      setFeedback("Ciclo duplicado como borrador.");
      await invalidatePlan();
    },
  });

  const createAsset = useMutation({
    mutationFn: (data: Parameters<CycleEditorProps["onCreateAsset"]>[0]) => unwrap(window.cryptoControl.investmentAssets.create(data)),
    onSuccess: async () => {
      setFeedback("Moneda añadida al ciclo.");
      await invalidatePlan();
    },
  });

  const updateAsset = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<CycleEditorProps["onUpdateAsset"]>[1] }) =>
      unwrap(window.cryptoControl.investmentAssets.update(id, data)),
    onSuccess: async () => {
      setFeedback("Moneda del ciclo actualizada.");
      await invalidatePlan();
    },
  });

  const pauseAsset = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { effectiveDate?: number; notes?: string | null } }) =>
      unwrap(window.cryptoControl.investmentAssets.pause(id, data)),
    onSuccess: async () => {
      setFeedback("Moneda pausada sin borrar histórico.");
      await invalidatePlan();
    },
  });

  const closeAsset = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { effectiveDate?: number; notes?: string | null } }) =>
      unwrap(window.cryptoControl.investmentAssets.close(id, data)),
    onSuccess: async () => {
      setFeedback("Moneda cerrada sin borrar histórico.");
      await invalidatePlan();
    },
  });

  const deleteAsset = useMutation({
    mutationFn: (id: string) => unwrap(window.cryptoControl.investmentAssets.delete(id)),
    onSuccess: async () => {
      setFeedback("Moneda eliminada del ciclo.");
      await invalidatePlan();
    },
  });

  const createRevision = useMutation({
    mutationFn: (data: Parameters<CycleEditorProps["onCreateRevision"]>[0]) => unwrap(window.cryptoControl.strategyRevisions.create(data)),
    onSuccess: async () => {
      setFeedback("Revisión registrada.");
      await invalidatePlan();
    },
  });

  const cycles = cyclesQuery.data ?? EMPTY_CYCLES;
  const assets = assetsQuery.data ?? EMPTY_ASSETS;
  const planAssets = planAssetsQuery.data ?? EMPTY_INVESTMENT_ASSETS;
  const revisions = revisionsQuery.data ?? EMPTY_REVISIONS;
  const planCount = plansQuery.data?.length ?? 0;

  const assetsByCycle = useMemo(() => {
    const grouped = new Map<string, InvestmentAsset[]>();
    for (const item of planAssets) {
      grouped.set(item.cycleId, [...(grouped.get(item.cycleId) ?? []), item]);
    }
    return grouped;
  }, [planAssets]);

  const revisionsByCycle = useMemo(() => {
    const grouped = new Map<string, StrategyRevision[]>();
    for (const item of revisions) {
      grouped.set(item.cycleId, [...(grouped.get(item.cycleId) ?? []), item]);
    }
    return grouped;
  }, [revisions]);

  const currentCycle = currentCycleQuery.data ?? cycles.find((cycle) => {
    return cycle.status === "active" && cycle.startDate <= renderTimestamp && (cycle.endDate === null || cycle.endDate >= renderTimestamp);
  }) ?? null;
  const currentCycleAssets = currentCycle ? assetsByCycle.get(currentCycle.id) ?? [] : EMPTY_INVESTMENT_ASSETS;
  const currentDistribution = calculateCycleDistribution(currentCycle, currentCycleAssets);

  const loading = plansQuery.isLoading || activePlanQuery.isLoading || assetsQuery.isLoading;
  const error = plansQuery.error ?? activePlanQuery.error ?? assetsQuery.error ?? cyclesQuery.error ?? currentCycleQuery.error ?? planAssetsQuery.error ?? revisionsQuery.error;

  async function submitPlan(event: FormEvent) {
    event.preventDefault();
    await createPlan.mutateAsync({ name: planName, description: planDescription || null, notes: planNotes || null });
  }

  async function submitCycle(event: FormEvent) {
    event.preventDefault();
    if (!activePlan) return;
    setFeedback(null);
    const nextStartDate = fromDateInput(cycleStart, true) ?? Date.now();
    const nextEndDate = fromDateInput(cycleEnd);
    if (nextEndDate !== null && nextEndDate < nextStartDate) {
      setFeedback("Ciclo: la fecha fin no puede ser anterior a la fecha inicio.");
      return;
    }
    await createCycle.mutateAsync({
      planId: activePlan.id,
      name: cycleName,
      startDate: nextStartDate,
      endDate: nextEndDate,
      monthlyAmountEur: parseNumber(cycleAmount),
      contributionCurrency: cycleCurrency,
      status: cycleStatus,
      priority: Math.trunc(parseNumber(cyclePriority)),
      notes: cycleNotes || null,
    });
    setCycleName("Nuevo ciclo");
    setCycleEnd("");
    setCycleStatus("planned");
    setCycleNotes("");
  }

  return (
    <>
      <div className="page-toolbar">
        <div className="page-toolbar-copy">
          <span className="page-eyebrow">Estrategia base</span>
          <h1>Plan de Inversión</h1>
          <span className="page-meta">
            {activePlan ? `${activePlan.name} · ${PLAN_STATUS_LABEL[activePlan.status]} · ${activePlan.baseCurrency}` : `${planCount} planes`}
            {" · "}
            {cycles.length} ciclos · {planAssets.length} monedas planificadas
          </span>
        </div>
      </div>

      <div className="investment-layout">
        {feedback ? <p className="investment-feedback">{feedback}</p> : null}
        {error instanceof Error ? <p className="error-msg">{error.message}</p> : null}

        {loading ? (
          <Card>
            <CardContent>
              <p className="empty-inline">Cargando plan de inversión...</p>
            </CardContent>
          </Card>
        ) : null}

        {!activePlan ? (
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Crear primer plan</CardTitle>
                <p className="panel-caption">Los ciclos y monedas quedarán vinculados a este plan activo.</p>
              </div>
            </CardHeader>
            <CardContent>
              <form className="investment-form-grid" onSubmit={(event) => void submitPlan(event)}>
                <label className="form-group">
                  <span>Nombre</span>
                  <Input value={planName} onChange={(event) => setPlanName(event.target.value)} />
                </label>
                <label className="form-group investment-wide">
                  <span>Descripción</span>
                  <Input value={planDescription} onChange={(event) => setPlanDescription(event.target.value)} />
                </label>
                <label className="form-group investment-wide">
                  <span>Notas</span>
                  <textarea className="ui-textarea investment-textarea" value={planNotes} onChange={(event) => setPlanNotes(event.target.value)} />
                </label>
                <div className="investment-form-actions">
                  <Button type="submit" loading={createPlan.isPending}><Plus size={15} /> Crear plan</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        ) : (
          <>
            <PlanEditor
              plan={activePlan}
              onUpdate={(id, data) => updatePlan.mutateAsync({ id, data }).then(() => undefined)}
              onDelete={(id) => deletePlan.mutateAsync(id).then(() => undefined)}
            />

            <section className="investment-summary-grid" aria-label="Resumen del plan de inversión">
              <article className="investment-summary-tile">
                <span>Ciclos</span>
                <strong>{cycles.length}</strong>
              </article>
              <article className="investment-summary-tile">
                <span>Ciclo actual</span>
                <strong>{currentCycle?.name ?? "Sin ciclo activo"}</strong>
              </article>
              <article className="investment-summary-tile">
                <span>Aporte mensual</span>
                <strong>{currentCycle ? `${formatMoney(currentCycle.monthlyAmountEur)}/mes` : "No definido"}</strong>
              </article>
              <article className="investment-summary-tile">
                <span>Monedas activas</span>
                <strong>{currentDistribution.activeCount}</strong>
              </article>
              <article className="investment-summary-tile">
                <span>Asignado</span>
                <strong>{currentDistribution.fixedTotal > 0 ? `${formatMoney(currentDistribution.fixedTotal)}/mes` : `${currentDistribution.percentageTotal.toLocaleString("es-ES", { maximumFractionDigits: 2 })}%`}</strong>
              </article>
              <article className="investment-summary-tile">
                <span>Sin asignar</span>
                <strong>{currentDistribution.unassignedAmount === null ? "No aplica" : `${formatMoney(currentDistribution.unassignedAmount)}/mes`}</strong>
              </article>
            </section>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Nuevo ciclo</CardTitle>
                  <p className="panel-caption">Define periodos con importe mensual y fechas abiertas si lo necesitas.</p>
                </div>
              </CardHeader>
              <CardContent>
                <form className="investment-form-grid" onSubmit={(event) => void submitCycle(event)}>
                  <label className="form-group">
                    <span>Nombre</span>
                    <Input value={cycleName} onChange={(event) => setCycleName(event.target.value)} />
                  </label>
                  <label className="form-group">
                    <span>Inicio</span>
                    <Input type="date" value={cycleStart} onChange={(event) => setCycleStart(event.target.value)} />
                  </label>
                  <label className="form-group">
                    <span>Fin opcional</span>
                    <Input type="date" value={cycleEnd} onChange={(event) => setCycleEnd(event.target.value)} />
                  </label>
                  <label className="form-group">
                    <span>Importe mensual</span>
                    <Input inputMode="decimal" value={cycleAmount} onChange={(event) => setCycleAmount(event.target.value)} />
                  </label>
                  <label className="form-group">
                    <span>Moneda aporte</span>
                    <Input value={cycleCurrency} onChange={(event) => setCycleCurrency(event.target.value.toUpperCase())} />
                  </label>
                  <label className="form-group">
                    <span>Estado</span>
                    <select className="ui-select" value={cycleStatus} onChange={(event) => setCycleStatus(event.target.value as CycleStatus)}>
                      <option value="planned">Planificado</option>
                      <option value="active">Activo</option>
                      <option value="paused">Pausado</option>
                      <option value="closed">Cerrado</option>
                    </select>
                  </label>
                  <label className="form-group">
                    <span>Prioridad</span>
                    <Input inputMode="numeric" value={cyclePriority} onChange={(event) => setCyclePriority(event.target.value)} />
                  </label>
                  <label className="form-group investment-wide">
                    <span>Notas</span>
                    <Input value={cycleNotes} onChange={(event) => setCycleNotes(event.target.value)} />
                  </label>
                  <div className="investment-form-actions">
                    <Button type="submit" loading={createCycle.isPending}><Plus size={15} /> Crear ciclo</Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <div className="investment-cycle-grid">
              {cycles.length === 0 ? (
                <Card>
                  <CardContent>
                    <p className="empty-inline">Todavía no hay ciclos. Crea el primer ciclo para empezar a asignar monedas.</p>
                  </CardContent>
                </Card>
              ) : cycles.map((cycle) => (
                <CycleEditor
                  key={cycle.id}
                  cycle={cycle}
                  assets={assets}
                  cycleAssets={assetsByCycle.get(cycle.id) ?? []}
                  revisions={revisionsByCycle.get(cycle.id) ?? []}
                  distribution={calculateCycleDistribution(cycle, assetsByCycle.get(cycle.id) ?? [])}
                  onUpdateCycle={(id, data) => updateCycle.mutateAsync({ id, data }).then(() => undefined)}
                  onDeleteCycle={(id) => deleteCycle.mutateAsync(id).then(() => undefined)}
                  onDuplicateCycle={(cycleToDuplicate, cycleAssetsToDuplicate) => duplicateCycle.mutateAsync({ cycle: cycleToDuplicate, cycleAssets: cycleAssetsToDuplicate }).then(() => undefined)}
                  onCreateAsset={(data) => createAsset.mutateAsync(data).then(() => undefined)}
                  onUpdateAsset={(id, data) => updateAsset.mutateAsync({ id, data }).then(() => undefined)}
                  onPauseAsset={(id, data) => pauseAsset.mutateAsync({ id, data }).then(() => undefined)}
                  onCloseAsset={(id, data) => closeAsset.mutateAsync({ id, data }).then(() => undefined)}
                  onDeleteAsset={(id) => deleteAsset.mutateAsync(id).then(() => undefined)}
                  onCreateRevision={(data) => createRevision.mutateAsync(data).then(() => undefined)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
