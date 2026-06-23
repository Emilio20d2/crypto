import { useMemo, useState, type FormEvent } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlanLayout } from "./plan/PlanLayout";
import { PlanConfigurar } from "./plan/PlanConfigurar";
import { PlanResumen } from "./plan/PlanResumen";
import { PlanAportaciones } from "./plan/PlanAportaciones";
import { PlanBeneficiosCaidas } from "./plan/PlanBeneficiosCaidas";
import { PlanSeguimiento } from "./plan/PlanSeguimiento";
import { PlanEscenarios } from "./plan/PlanEscenarios";
import type {
  Asset,
  AssetHealthResult,
  AssetSubstitution,
  ContributionSchedule,
  CycleLiquidityAllocation,
  CycleGoal,
  CycleMetrics,
  CycleRebuyTier,
  CycleRisk,
  CycleStrategyReport,
  InvestmentAsset,
  InvestmentCycle,
  InvestmentPlan,
  PartialSale,
  Result,
  SmartBuyRecommendation,
  StrategyRevision,
  StrategicAlert,
  TransactionInput,
  TreasurySummary,
} from "@crypto-control/core";
import { CalendarDays, CheckCircle, CircleOff, Copy, Plus, Save, Trash2, XCircle } from "lucide-react";
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
  goal_reached: "Objetivo alcanzado",
};

const CYCLE_GOAL_LABEL: Record<CycleGoal, string> = {
  acumulacion: "Acumulación",
  crecimiento: "Crecimiento",
  preservacion: "Preservación",
  renta: "Renta",
};

const CYCLE_RISK_LABEL: Record<CycleRisk, string> = {
  bajo: "Bajo",
  moderado: "Moderado",
  alto: "Alto",
  muy_alto: "Muy alto",
};

const ASSET_HEALTH_LABEL: Record<AssetHealthResult["status"], string> = {
  activo: "Activo",
  observacion: "Observación",
  riesgo_elevado: "Riesgo elevado",
  salida_recomendada: "Salida recomendada",
  retirado: "Retirado",
};

const ASSET_HEALTH_BADGE: Record<AssetHealthResult["status"], string> = {
  activo: "badge-success",
  observacion: "badge-warning",
  riesgo_elevado: "badge-danger",
  salida_recomendada: "badge-danger",
  retirado: "",
};

const ASSET_TREND_LABEL: Record<NonNullable<AssetHealthResult["tendencia"]>, string> = {
  alcista: "Alcista",
  lateral: "Lateral",
  bajista: "Bajista",
};

const ASSET_RISK_LABEL: Record<AssetHealthResult["riesgoNivel"], string> = {
  bajo: "Bajo",
  moderado: "Moderado",
  alto: "Alto",
  muy_alto: "Muy alto",
};

const ASSET_RISK_BADGE: Record<AssetHealthResult["riesgoNivel"], string> = {
  bajo: "badge-success",
  moderado: "badge-warning",
  alto: "badge-danger",
  muy_alto: "badge-danger",
};

const STRATEGIC_STATE_LABEL: Record<AssetHealthResult["estadoEstrategico"], string> = {
  excelente: "Excelente",
  buena: "Buena",
  neutral: "Neutral",
  vigilancia: "Vigilancia",
  deterioro: "Deterioro",
  sustitucion_recomendada: "Sustitución recomendada",
};

const ALERT_SEVERITY_BADGE: Record<string, string> = {
  critica: "badge-danger",
  advertencia: "badge-warning",
  info: "",
};

const MARKET_PHASE_LABEL: Record<string, string> = {
  acumulacion: "Acumulación",
  recuperacion: "Recuperación",
  inicio_alcista: "Alcista temprano",
  alcista_fuerte: "Alcista avanzado",
  euforia: "Euforia",
  distribucion: "Distribución",
  bajista: "Mercado bajista",
  correccion: "Corrección",
  capitulacion: "Capitulación",
  incertidumbre: "Incertidumbre",
};

const MARKET_PHASE_BADGE: Record<string, string> = {
  acumulacion: "badge-success",
  recuperacion: "badge-success",
  inicio_alcista: "badge-success",
  alcista_fuerte: "badge-success",
  euforia: "badge-warning",
  distribucion: "badge-warning",
  bajista: "badge-danger",
  correccion: "badge-warning",
  capitulacion: "badge-danger",
  incertidumbre: "badge-secondary",
};

const SALE_PROPOSAL_LABEL: Record<string, string> = {
  mantener: "Mantener",
  vigilar: "Vigilar",
  venta_parcial: "Venta parcial sugerida",
  recogida_beneficios: "Recogida de beneficios",
};

const SALE_PROPOSAL_BADGE: Record<string, string> = {
  mantener: "badge-success",
  vigilar: "badge-warning",
  venta_parcial: "badge-danger",
  recogida_beneficios: "badge-warning",
};

const CS_TYPE_LABEL: Record<ContributionSchedule["type"], string> = {
  periodica: "Periódica",
  extraordinaria: "Extraordinaria",
};

const CS_STATUS_LABEL: Record<ContributionSchedule["status"], string> = {
  pendiente: "Pendiente",
  ejecutada: "Ejecutada",
  cancelada: "Cancelada",
};

const CS_STATUS_BADGE: Record<ContributionSchedule["status"], string> = {
  pendiente: "badge-warning",
  ejecutada: "badge-success",
  cancelada: "",
};

const LIQUIDITY_STATUS_LABEL: Record<CycleLiquidityAllocation["status"], string> = {
  reserved: "Reservada",
  used: "Usada",
  released: "Liberada",
};

const LIQUIDITY_SOURCE_LABEL: Record<CycleLiquidityAllocation["sourceType"], string> = {
  eurc: "EURC",
  cash: "Efectivo",
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

// ── Compra Inteligente ────────────────────────────────────────────────────────

type SmartBuyUiMode = "plan" | "oportunidad" | "mixto" | "potencial";

function SmartBuyPanel({ cycleId, defaultAmount }: { cycleId: string; defaultAmount: number }) {
  const navigate = useNavigate();
  const [amount, setAmount] = useState(String(defaultAmount));
  const [mode, setMode] = useState<SmartBuyUiMode>("plan");
  const [horizon, setHorizon] = useState<"1-3y" | "3-5y" | "5y+">("3-5y");
  const [planWeight, setPlanWeight] = useState("60");
  const [balanceWeight, setBalanceWeight] = useState("15");
  const [opportunityWeight, setOpportunityWeight] = useState("20");
  const [potentialWeight, setPotentialWeight] = useState("5");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SmartBuyRecommendation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analyze = async () => {
    const amountNum = parseFloat(amount.replace(",", "."));
    if (!amountNum || amountNum <= 0) { setError("Introduce un importe válido."); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await window.cryptoControl.smartBuy.getRecommendation({
        cycleId,
        amount: amountNum,
        mode,
        originType: "cash",
        horizon,
        weights: mode === "mixto"
          ? {
              planPct: parseNumber(planWeight),
              balancePct: parseNumber(balanceWeight),
              opportunityPct: parseNumber(opportunityWeight),
              potentialPct: parseNumber(potentialWeight),
            }
          : undefined,
      });
      if (!res.ok) { setError(res.error.message); return; }
      setResult(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al calcular la recomendación");
    } finally {
      setLoading(false);
    }
  };

  const prepareBuy = (rec: SmartBuyRecommendation["recommendations"][number]) => {
    if (rec.recommendedAmountEur <= 0 || rec.action === "candidato_plan") return;
    const params = new URLSearchParams({
      source: "smart-buy",
      type: "buy",
      asset: rec.assetId,
      quoteAmount: String(rec.recommendedAmountEur),
      origin: "cash",
      cycleId,
    });
    navigate(`/operaciones?${params.toString()}`);
  };

  return (
    <section className="investment-section" aria-label="Compra Inteligente">
      <div className="investment-section-heading">
        <h3>Compra Inteligente</h3>
        <span className="badge">Solo orientativo — no ejecuta compras automáticas</span>
      </div>
      <p className="panel-caption">
        Analiza las aportaciones disponibles según el Plan, el estado de cartera y señales de mercado trazables. Las recompras con EURC se gestionan aparte en Ventas/Recompras.
      </p>
      <div className="investment-form-grid" style={{ marginBottom: 12 }}>
        <label className="form-group">
          <span>Importe a distribuir (EUR)</span>
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={String(defaultAmount)}
          />
        </label>
        <label className="form-group">
          <span>Modo</span>
          <select className="ui-select" value={mode} onChange={(e) => setMode(e.target.value as SmartBuyUiMode)}>
            <option value="plan">Cumplir el Plan</option>
            <option value="oportunidad">Aprovechar oportunidades</option>
            <option value="mixto">Modo mixto</option>
            <option value="potencial">Potencial medio/largo plazo</option>
          </select>
        </label>
        <div className="form-group">
          <span>Origen de fondos</span>
          <strong>Aportaciones EUR</strong>
          <small>EURC queda reservado para recompras.</small>
        </div>
        {mode === "potencial" ? (
          <label className="form-group">
            <span>Horizonte</span>
            <select className="ui-select" value={horizon} onChange={(e) => setHorizon(e.target.value as "1-3y" | "3-5y" | "5y+")}>
              <option value="1-3y">1-3 años</option>
              <option value="3-5y">3-5 años</option>
              <option value="5y+">Más de 5 años</option>
            </select>
          </label>
        ) : null}
        {mode === "mixto" ? (
          <>
            <label className="form-group">
              <span>Peso Plan</span>
              <Input inputMode="numeric" value={planWeight} onChange={(e) => setPlanWeight(e.target.value)} />
            </label>
            <label className="form-group">
              <span>Peso equilibrio</span>
              <Input inputMode="numeric" value={balanceWeight} onChange={(e) => setBalanceWeight(e.target.value)} />
            </label>
            <label className="form-group">
              <span>Peso oportunidad</span>
              <Input inputMode="numeric" value={opportunityWeight} onChange={(e) => setOpportunityWeight(e.target.value)} />
            </label>
            <label className="form-group">
              <span>Peso potencial</span>
              <Input inputMode="numeric" value={potentialWeight} onChange={(e) => setPotentialWeight(e.target.value)} />
            </label>
          </>
        ) : null}
        <div className="investment-form-actions" style={{ alignSelf: "flex-end" }}>
          <Button type="button" loading={loading} onClick={() => void analyze()}>
            Analizar compra
          </Button>
        </div>
      </div>

      {error ? <p className="error-msg">{error}</p> : null}

      {result ? (
        <div>
          <div className="investment-distribution" style={{ marginBottom: 8 }}>
            <span>Cartera actual: <strong>{result.totalPortfolioValueEur !== null ? `${formatMoney(result.totalPortfolioValueEur)}` : "Sin datos"}</strong></span>
            <span>Importe analizado: <strong>{formatMoney(result.analyzedAmountEur)}</strong></span>
            <span>Origen: <strong>Aportaciones EUR</strong></span>
            {typeof result.pendingAmountEur === "number" && result.pendingAmountEur > 0 ? <span>Pendiente: <strong>{formatMoney(result.pendingAmountEur)}</strong></span> : null}
            <span>Calidad de datos: <strong>{result.dataQuality === "completo" ? "Completa" : result.dataQuality === "parcial" ? "Parcial" : "Sin datos"}</strong></span>
            {result.hasOpportunities ? <span className="badge badge-success">Oportunidades detectadas</span> : null}
          </div>
          <p className="investment-contribution-meta">
            Compra Inteligente usa aportaciones. Las recompras usan la reserva/liquidez EURC en Ventas/Recompras, con sus propias reglas de activación.
          </p>

          {result.restrictionsApplied.length > 0 ? (
            <div className="investment-warning" role="status">
              {result.restrictionsApplied.map((r) => <span key={r}>{r}</span>)}
            </div>
          ) : null}

          {result.recommendations.length === 0 ? (
            <p className="empty-inline">No hay activos activos en el ciclo para distribuir.</p>
          ) : (
            <div className="investment-contribution-list">
              {result.recommendations.map((rec) => (
                <article
                  key={rec.assetId}
                  className={`investment-contribution${rec.isOpportunity ? " investment-contribution--opportunity" : ""}`}
                >
                  <div className="investment-contribution-header">
                    <div>
                      <strong>{rec.rank ? `${rec.rank}. ` : ""}{rec.assetId}</strong>
                      {rec.targetAllocationPct !== null ? <span>{rec.targetAllocationPct}% objetivo · {rec.action?.replaceAll("_", " ") ?? "analizado"}</span> : <span>{rec.action?.replaceAll("_", " ") ?? "analizado"}</span>}
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {rec.isOpportunity ? <span className="badge badge-success">Oportunidad</span> : null}
                      {rec.isUnderweight ? <span className="badge">Infraponderado</span> : null}
                      <span className="badge">{rec.confidenceLevel === "alta" ? "Confianza alta" : rec.confidenceLevel === "media" ? "Confianza media" : rec.confidenceLevel === "baja" ? "Confianza baja" : "No evaluable"}</span>
                    </div>
                  </div>
                  <p className="investment-contribution-meta">
                    Recomendado: <strong>{formatMoney(rec.recommendedAmountEur)}</strong>
                    {typeof rec.recommendedPercentage === "number" ? ` · ${rec.recommendedPercentage.toLocaleString("es-ES", { maximumFractionDigits: 2 })}% del importe` : ""}
                    {" "} · Base por ponderación: {formatMoney(rec.baseAmountEur)}
                    {rec.deviationFromBaseEur !== 0 ? ` · Ajuste: ${rec.deviationFromBaseEur > 0 ? "+" : ""}${formatMoney(rec.deviationFromBaseEur)}` : ""}
                  </p>
                  <p className="investment-contribution-meta">
                    Precio: {typeof rec.currentPriceEur === "number" ? formatMoney(rec.currentPriceEur) : "Pendiente"}
                    {" "} · Cantidad aprox.: {typeof rec.estimatedQuantity === "number" ? `${rec.estimatedQuantity.toLocaleString("es-ES", { maximumFractionDigits: 8 })} ${rec.assetId}` : "—"}
                    {" "} · Riesgo: {rec.riskLevel?.replace("no_evaluable", "no evaluable") ?? "—"}
                  </p>
                  {rec.currentValueEur !== null ? (
                    <p className="investment-contribution-meta">
                      Actual: {formatMoney(rec.currentValueEur)} · Objetivo: {rec.targetValueEur !== null ? formatMoney(rec.targetValueEur) : "—"}
                      {typeof rec.currentWeightPct === "number" ? ` · Peso actual: ${rec.currentWeightPct.toLocaleString("es-ES", { maximumFractionDigits: 2 })}%` : ""}
                      {typeof rec.estimatedWeightAfterBuyPct === "number" ? ` · Tras compra: ${rec.estimatedWeightAfterBuyPct.toLocaleString("es-ES", { maximumFractionDigits: 2 })}%` : ""}
                    </p>
                  ) : null}
                  <p className="investment-contribution-meta">
                    Coste medio: {typeof rec.averagePriceEur === "number" ? formatMoney(rec.averagePriceEur) : "Pendiente"}
                    {" "} · Coste medio estimado: {typeof rec.estimatedAverageCostAfterBuyEur === "number" ? formatMoney(rec.estimatedAverageCostAfterBuyEur) : "—"}
                  </p>
                  {rec.opportunityReason ? (
                    <p className="investment-contribution-meta" style={{ color: "var(--color-success, green)" }}>
                      {rec.opportunityReason}
                    </p>
                  ) : null}
                  {rec.potentialReason ? <p className="investment-contribution-meta">{rec.potentialReason}</p> : null}
                  {rec.scoreBreakdown ? (
                    <p className="investment-contribution-meta">
                      Puntuación: {rec.scoreBreakdown.final}/100 · Plan {rec.scoreBreakdown.planAlignment} · Oportunidad {rec.scoreBreakdown.priceOpportunity} · Potencial {rec.scoreBreakdown.longTermPotential} · Datos {rec.scoreBreakdown.dataQuality}
                    </p>
                  ) : null}
                  <p className="investment-contribution-meta">{rec.explanation ?? rec.reason}</p>
                  {rec.restrictionsApplied && rec.restrictionsApplied.length > 0 ? (
                    <p className="investment-contribution-meta">{rec.restrictionsApplied.join(" · ")}</p>
                  ) : null}
                  <div className="investment-form-actions">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={rec.recommendedAmountEur <= 0 || rec.action === "candidato_plan"}
                      onClick={() => prepareBuy(rec)}
                    >
                      Preparar compra
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

// ── Reglas de Recompra (configurable) ────────────────────────────────────────

function RebuyTiersConfig({ cycleId }: { cycleId: string }) {
  const qc = useQueryClient();
  const queryKey = ["rebuyTiers", cycleId] as const;

  const tiersQuery = useQuery({
    queryKey,
    queryFn: () => unwrap(window.cryptoControl.rebuyTiers.list({ cycleId })),
  });
  const tiers: CycleRebuyTier[] = tiersQuery.data ?? [];

  const [drawdown, setDrawdown] = useState("-15");
  const [usage, setUsage] = useState("30");
  const [tierError, setTierError] = useState<string | null>(null);

  const upsert = useMutation({
    mutationFn: (data: { id?: string; cycleId: string; drawdownPercentage: number; usagePercentage: number }) =>
      unwrap(window.cryptoControl.rebuyTiers.upsert(data)),
    onSuccess: () => { void qc.invalidateQueries({ queryKey }); },
  });

  const remove = useMutation({
    mutationFn: (id: string) => unwrap(window.cryptoControl.rebuyTiers.delete(id)),
    onSuccess: () => { void qc.invalidateQueries({ queryKey }); },
  });

  const submitTier = async (e: FormEvent) => {
    e.preventDefault();
    setTierError(null);
    const d = parseFloat(drawdown.replace(",", "."));
    const u = parseFloat(usage.replace(",", "."));
    if (isNaN(d) || isNaN(u)) { setTierError("Introduce valores numéricos válidos."); return; }
    if (d >= 0) { setTierError("El drawdown debe ser negativo (ej: -15)."); return; }
    if (u <= 0 || u >= 100) { setTierError("El uso debe ser mayor que 0% y menor que 100% para mantener liquidez residual."); return; }
    await upsert.mutateAsync({ cycleId, drawdownPercentage: d, usagePercentage: u });
    setDrawdown("-15");
    setUsage("30");
  };

  return (
    <section className="investment-section" aria-label="Reglas de recompra">
      <div className="investment-section-heading">
        <h3>Reglas de recompra</h3>
        {tiers.length === 0 ? <span className="badge">Usando valores predeterminados</span> : <span className="badge badge-success">{tiers.length} reglas configuradas</span>}
      </div>
      <p className="panel-caption">
        Define a qué porcentaje de caída desplegar qué porcentaje de la liquidez libre. Si no hay reglas configuradas, se usan los valores predeterminados: −15% → 30%, −25% → 50%, −40% → 70%.
      </p>

      {tiers.length > 0 ? (
        <div className="investment-contribution-list" style={{ marginBottom: 12 }}>
          {tiers.map((tier) => (
            <article key={tier.id} className="investment-contribution">
              <div className="investment-contribution-header">
                <div>
                  <strong>Caída {tier.drawdownPercentage}%</strong>
                  <span>Desplegar {tier.usagePercentage}% de liquidez libre y mantener {Math.max(0, 100 - tier.usagePercentage).toFixed(2)}%</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  loading={remove.isPending}
                  onClick={() => void remove.mutateAsync(tier.id)}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {tierError ? <p className="error-msg">{tierError}</p> : null}

      <form className="investment-form-grid" onSubmit={(e) => void submitTier(e)}>
        <label className="form-group">
          <span>Caída (%) negativo, ej: −15</span>
          <Input inputMode="decimal" value={drawdown} onChange={(e) => setDrawdown(e.target.value)} placeholder="-15" />
        </label>
        <label className="form-group">
          <span>Uso de liquidez (%)</span>
          <Input inputMode="decimal" value={usage} onChange={(e) => setUsage(e.target.value)} placeholder="30" />
        </label>
        <div className="investment-form-actions" style={{ alignSelf: "flex-end" }}>
          <Button type="submit" loading={upsert.isPending}><Plus size={15} /> Añadir regla</Button>
        </div>
      </form>
    </section>
  );
}

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
  const [objetivo, setObjetivo] = useState<CycleGoal | "">(cycle.objetivo ?? "");
  const [riesgo, setRiesgo] = useState<CycleRisk | "">(cycle.riesgo ?? "");
  const [allowExtraContributions, setAllowExtraContributions] = useState(cycle.allowExtraContributions ?? true);
  const [notes, setNotes] = useState(cycle.notes ?? "");

  const metricsQuery = useQuery({
    queryKey: ["investment-cycles", "metrics", cycle.id],
    queryFn: () => unwrap(window.cryptoControl.investmentCycles.getMetrics({ cycleId: cycle.id })),
  });
  const metrics: CycleMetrics | null = metricsQuery.data ?? null;

  const alertsQuery = useQuery({
    queryKey: ["strategic-alerts", cycle.id],
    queryFn: () => unwrap(window.cryptoControl.strategicAlerts.generate({ cycleId: cycle.id })),
    staleTime: 10 * 60 * 1000,
  });
  const alerts: StrategicAlert[] = alertsQuery.data ?? [];

  const strategyReportQuery = useQuery({
    queryKey: ["strategic-decisions", "cycle-report", cycle.id],
    queryFn: () => unwrap(window.cryptoControl.strategicDecisions.getCycleReport({ cycleId: cycle.id })),
    staleTime: 10 * 60 * 1000,
  });
  const strategyReport: CycleStrategyReport | null = strategyReportQuery.data ?? null;

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

  // ── Contribution Schedule ──────────────────────────────────────────────────
  const csQueryClient = useQueryClient();
  const csQueryKey = ["contribution-schedule", cycle.id] as const;

  const contributionScheduleQuery = useQuery({
    queryKey: csQueryKey,
    queryFn: () => unwrap(window.cryptoControl.contributionSchedule.list({ cycleId: cycle.id })),
  });
  const contributions: ContributionSchedule[] = contributionScheduleQuery.data ?? [];

  const [csType, setCsType] = useState<"periodica" | "extraordinaria">("periodica");
  const [csDate, setCsDate] = useState(() => toDateInput(Date.now()));
  const [csAmount, setCsAmount] = useState("");
  const [csCurrency, setCsCurrency] = useState("EUR");
  const [csDestination, setCsDestination] = useState("");
  const [csNotes, setCsNotes] = useState("");

  const invalidateCS = () => csQueryClient.invalidateQueries({ queryKey: csQueryKey });

  const createCS = useMutation({
    mutationFn: (data: { cycleId: string; type: "periodica" | "extraordinaria"; plannedDate: number; amountEur: number; currency: string; destination: string | null; notes: string | null }) =>
      unwrap(window.cryptoControl.contributionSchedule.create(data)),
    onSuccess: () => { void invalidateCS(); },
  });

  const executeCS = useMutation({
    mutationFn: (id: string) => unwrap(window.cryptoControl.contributionSchedule.execute(id)),
    onSuccess: () => { void invalidateCS(); },
  });

  const deleteCS = useMutation({
    mutationFn: (id: string) => unwrap(window.cryptoControl.contributionSchedule.delete(id)),
    onSuccess: () => { void invalidateCS(); },
  });

  async function submitCS(event: FormEvent) {
    event.preventDefault();
    const plannedDate = fromDateInput(csDate, true);
    if (!plannedDate) return;
    const amount = parseNumber(csAmount);
    if (!amount) return;
    await createCS.mutateAsync({
      cycleId: cycle.id,
      type: csType,
      plannedDate,
      amountEur: amount,
      currency: csCurrency || "EUR",
      destination: csDestination || null,
      notes: csNotes || null,
    });
    setCsAmount("");
    setCsNotes("");
    setCsDestination("");
  }
  // ── Ventas parciales ────────────────────────────────────────────────────────
  const psQueryKey = ["partial-sales", cycle.id] as const;

  const partialSalesQuery = useQuery({
    queryKey: psQueryKey,
    queryFn: () => unwrap(window.cryptoControl.investmentCycles.listPartialSales({ cycleId: cycle.id })),
  });
  const partialSales: PartialSale[] = partialSalesQuery.data ?? [];

  const sellTxQuery = useQuery({
    queryKey: ["transactions", "sell"],
    queryFn: async () => {
      const all = await unwrap(window.cryptoControl.transactions.list());
      return all.filter((tx: TransactionInput) => tx.type === "sell");
    },
    staleTime: 60 * 1000,
  });
  const sellTransactions: TransactionInput[] = sellTxQuery.data ?? [];

  const [psTransactionId, setPsTransactionId] = useState("");
  const [psPercentage, setPsPercentage] = useState("");
  const [psProceeds, setPsProceeds] = useState("");
  const [psNotes, setPsNotes] = useState("");

  const invalidatePS = () => csQueryClient.invalidateQueries({ queryKey: psQueryKey });

  const createPS = useMutation({
    mutationFn: (data: { cycleId: string; transactionId: string; percentageOfHolding: number; proceedsEur: number; notes: string | null }) =>
      unwrap(window.cryptoControl.investmentCycles.createPartialSale(data)),
    onSuccess: () => { void invalidatePS(); },
  });

  const deletePS = useMutation({
    mutationFn: (id: string) => unwrap(window.cryptoControl.investmentCycles.deletePartialSale(id)),
    onSuccess: () => { void invalidatePS(); },
  });

  async function submitPS(event: FormEvent) {
    event.preventDefault();
    if (!psTransactionId) return;
    const pct = parseNumber(psPercentage);
    const proceeds = parseNumber(psProceeds);
    if (!pct || pct >= 100 || !proceeds) return;
    await createPS.mutateAsync({
      cycleId: cycle.id,
      transactionId: psTransactionId,
      percentageOfHolding: pct,
      proceedsEur: proceeds,
      notes: psNotes || null,
    });
    setPsTransactionId("");
    setPsPercentage("");
    setPsProceeds("");
    setPsNotes("");
  }

  // ── Liquidez del ciclo ─────────────────────────────────────────────────────
  const liquidityQuery = useQuery({
    queryKey: ["liquidity", cycle.id],
    queryFn: () => unwrap(window.cryptoControl.treasury.listCycleLiquidity({ cycleId: cycle.id })),
  });
  const liquidityItems: CycleLiquidityAllocation[] = liquidityQuery.data ?? [];

  // ── Sustituciones de activos ───────────────────────────────────────────────
  const subsQueryKey = ["asset-substitutions", cycle.id] as const;

  const substitutionsQuery = useQuery({
    queryKey: subsQueryKey,
    queryFn: () => unwrap(window.cryptoControl.assetSubstitutions.list({ cycleId: cycle.id })),
  });
  const substitutions: AssetSubstitution[] = substitutionsQuery.data ?? [];

  const [subFromAssetId, setSubFromAssetId] = useState("");
  const [subToAssetId, setSubToAssetId] = useState("");
  const [subEffectiveDate, setSubEffectiveDate] = useState(() => toDateInput(Date.now()));
  const [subReason, setSubReason] = useState("");
  const [subNotes, setSubNotes] = useState("");

  const invalidateSubs = () => csQueryClient.invalidateQueries({ queryKey: subsQueryKey });

  const createSub = useMutation({
    mutationFn: (data: { cycleId: string; fromAssetId: string; toAssetId: string | null; effectiveDate: number; reason: string; notes: string | null }) =>
      unwrap(window.cryptoControl.assetSubstitutions.create(data)),
    onSuccess: () => { void invalidateSubs(); },
  });

  const deleteSub = useMutation({
    mutationFn: (id: string) => unwrap(window.cryptoControl.assetSubstitutions.delete(id)),
    onSuccess: () => { void invalidateSubs(); },
  });

  const executeSub = useMutation({
    mutationFn: (id: string) => unwrap(window.cryptoControl.assetSubstitutions.execute(id)),
    onSuccess: () => { void invalidateSubs(); },
  });

  async function submitSub(event: FormEvent) {
    event.preventDefault();
    if (!subFromAssetId || !subReason.trim()) return;
    const effectiveDate = fromDateInput(subEffectiveDate, true);
    if (!effectiveDate) return;
    await createSub.mutateAsync({
      cycleId: cycle.id,
      fromAssetId: subFromAssetId,
      toAssetId: subToAssetId || null,
      effectiveDate,
      reason: subReason,
      notes: subNotes || null,
    });
    setSubFromAssetId("");
    setSubToAssetId("");
    setSubReason("");
    setSubNotes("");
  }
  // ──────────────────────────────────────────────────────────────────────────

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
      objetivo: objetivo || null,
      riesgo: riesgo || null,
      allowExtraContributions,
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
          {cycle.objetivo ? <span className="badge">{CYCLE_GOAL_LABEL[cycle.objetivo]}</span> : null}
          {cycle.riesgo ? <span className="badge">{CYCLE_RISK_LABEL[cycle.riesgo]}</span> : null}
          {cycle.allowExtraContributions === false ? <span className="badge">Sin extra</span> : null}
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

        {alerts.length > 0 ? (
          <section className="investment-section" role="alert" aria-label="Alertas estratégicas">
            <div className="investment-section-heading">
              <h3>Alertas estratégicas</h3>
              <span className="badge badge-danger">{alerts.filter((a) => a.severity === "critica").length} críticas · {alerts.length} total</span>
            </div>
            <div className="investment-contribution-list">
              {alerts.map((alert) => (
                <article className="investment-contribution" key={alert.id}>
                  <div className="investment-contribution-header">
                    <div>
                      <strong>{alert.title}</strong>
                      {alert.assetId ? <span>{alert.assetId}</span> : null}
                    </div>
                    <span className={`badge ${ALERT_SEVERITY_BADGE[alert.severity] ?? ""}`}>
                      {alert.severity === "critica" ? "Crítica" : alert.severity === "advertencia" ? "Advertencia" : "Info"}
                    </span>
                  </div>
                  <p className="investment-contribution-meta">{alert.message}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {metrics ? (
          <section className="investment-metrics-grid" aria-label="Métricas del ciclo">
            <article className="investment-summary-tile">
              <span>Tiempo transcurrido</span>
              <strong>{metrics.monthsElapsed} {metrics.monthsElapsed === 1 ? "mes" : "meses"}</strong>
            </article>
            {metrics.monthsRemaining !== null ? (
              <article className="investment-summary-tile">
                <span>Tiempo restante</span>
                <strong>{metrics.monthsRemaining} {metrics.monthsRemaining === 1 ? "mes" : "meses"}</strong>
              </article>
            ) : null}
            {metrics.percentComplete !== null ? (
              <article className="investment-summary-tile">
                <span>Completado</span>
                <strong>{metrics.percentComplete.toLocaleString("es-ES", { maximumFractionDigits: 1 })}%</strong>
              </article>
            ) : null}
            <article className="investment-summary-tile">
              <span>Capital esperado</span>
              <strong>{formatMoney(metrics.expectedContributionToDate)}</strong>
            </article>
            <article className="investment-summary-tile">
              <span>Capital real aportado</span>
              <strong>{formatMoney(metrics.actualContribution)}</strong>
            </article>
            {metrics.contributionCompliancePercentage !== null ? (
              <article className="investment-summary-tile">
                <span>Cumplimiento aportaciones</span>
                <strong style={{ color: metrics.contributionCompliancePercentage >= 90 ? "var(--color-success)" : metrics.contributionCompliancePercentage >= 60 ? "var(--color-warning)" : "var(--color-danger)" }}>
                  {metrics.contributionCompliancePercentage.toLocaleString("es-ES", { maximumFractionDigits: 1 })}%
                </strong>
              </article>
            ) : null}
            <article className="investment-summary-tile">
              <span>Desviación</span>
              <strong style={{ color: metrics.contributionDifference >= 0 ? "var(--color-success)" : "var(--color-danger)" }}>
                {metrics.contributionDifference >= 0 ? "+" : ""}{formatMoney(metrics.contributionDifference)}
              </strong>
            </article>
            {metrics.extraContribution > 0 ? (
              <article className="investment-summary-tile">
                <span>Aportaciones extra</span>
                <strong>{formatMoney(metrics.extraContribution)}</strong>
              </article>
            ) : null}
            <article className="investment-summary-tile">
              <span>Valor actual</span>
              <strong>{metrics.hasPendingValuation ? "Pendiente" : formatMoney(metrics.currentValueEur)}</strong>
            </article>
            <article className="investment-summary-tile">
              <span>Coste en cartera</span>
              <strong>{formatMoney(metrics.heldCostBasisEur)}</strong>
            </article>
            <article className="investment-summary-tile">
              <span>Rentabilidad acumulada</span>
              <strong style={{ color: metrics.profitEur >= 0 ? "var(--color-success)" : "var(--color-danger)" }}>
                {metrics.profitEur >= 0 ? "+" : ""}{formatMoney(metrics.profitEur)}
              </strong>
            </article>
            {metrics.roiPercentage !== null ? (
              <article className="investment-summary-tile">
                <span>ROI</span>
                <strong style={{ color: metrics.roiPercentage >= 0 ? "var(--color-success)" : "var(--color-danger)" }}>
                  {metrics.roiPercentage >= 0 ? "+" : ""}{metrics.roiPercentage.toLocaleString("es-ES", { maximumFractionDigits: 2 })}%
                </strong>
              </article>
            ) : null}
          </section>
        ) : null}

        {strategyReport ? (
          <section className="investment-section" aria-label="Panel de estrategia">
            <div className="investment-section-heading">
              <h3>Estrategia actual</h3>
              {strategyReport.marketPhase.phase ? (
                <span className={`badge ${MARKET_PHASE_BADGE[strategyReport.marketPhase.phase] ?? ""}`}>
                  {MARKET_PHASE_LABEL[strategyReport.marketPhase.phase] ?? strategyReport.marketPhase.phase}
                </span>
              ) : (
                <span className="badge">Fase indeterminada</span>
              )}
            </div>

            {/* G1+G2 — Fase de mercado */}
            <div className="investment-contribution-list">
              <article className="investment-contribution">
                <div className="investment-contribution-header">
                  <div>
                    <strong>Fase de mercado</strong>
                    <span>Índice Crypto Control · Confianza: {strategyReport.marketPhase.confidence}</span>
                  </div>
                  {strategyReport.marketPhase.phase ? (
                    <span className={`badge ${MARKET_PHASE_BADGE[strategyReport.marketPhase.phase] ?? ""}`}>
                      {MARKET_PHASE_LABEL[strategyReport.marketPhase.phase] ?? strategyReport.marketPhase.phase}
                    </span>
                  ) : null}
                </div>
                <p className="investment-contribution-meta">{strategyReport.marketPhase.reasoning}</p>
                {strategyReport.marketPhase.indicatorsUsed.length > 0 ? (
                  <p className="investment-contribution-meta">
                    Indicadores usados: {strategyReport.marketPhase.indicatorsUsed.join(" · ")}
                  </p>
                ) : null}
                {strategyReport.marketPhase.indicatorsUnavailable.length > 0 ? (
                  <p className="investment-contribution-meta" style={{ color: "var(--color-muted)" }}>
                    No disponibles: {strategyReport.marketPhase.indicatorsUnavailable.join(" · ")}
                  </p>
                ) : null}
              </article>
            </div>

            {/* G3 — Propuestas de venta parcial */}
            {strategyReport.partialSaleProposals.length > 0 ? (
              <>
                <div className="investment-section-heading" style={{ marginTop: "1rem" }}>
                  <h4>Ventas parciales sugeridas</h4>
                  <span className="badge">{strategyReport.partialSaleProposals.filter(p => p.type !== "mantener").length} propuestas activas</span>
                </div>
                <div className="investment-contribution-list">
                  {strategyReport.partialSaleProposals.map((p) => (
                    <article className="investment-contribution" key={p.assetId}>
                      <div className="investment-contribution-header">
                        <div>
                          <strong>{p.assetId}</strong>
                          {p.percentageSuggested !== null
                            ? <span>{p.percentageSuggested}% sugerido · permanece {Math.max(0, 100 - p.percentageSuggested).toFixed(2)}%</span>
                            : null}
                        </div>
                        <span className={`badge ${SALE_PROPOSAL_BADGE[p.type] ?? ""}`}>{SALE_PROPOSAL_LABEL[p.type] ?? p.type}</span>
                      </div>
                      <p className="investment-contribution-meta">{p.reason}</p>
                    </article>
                  ))}
                </div>
              </>
            ) : null}

            {/* G4 — Propuestas de recompra */}
            {strategyReport.rebuyProposals.length > 0 ? (
              <>
                <div className="investment-section-heading" style={{ marginTop: "1rem" }}>
                  <h4>Recompras sugeridas (escenarios hipotéticos)</h4>
                  <span className="badge">{new Set(strategyReport.rebuyProposals.map(r => r.triggerDropPercentage)).size} niveles de corrección</span>
                </div>
                <div className="investment-contribution-list">
                  {strategyReport.rebuyProposals.map((r, i) => (
                    <article className="investment-contribution" key={`${r.assetId}-${r.triggerDropPercentage}-${i}`}>
                      <div className="investment-contribution-header">
                        <div>
                          <strong>{r.assetId}</strong>
                          <span>
                            Corrección {r.triggerDropPercentage}% · quedará {Math.max(0, r.availableLiquidityEur - r.proposedAmountEur).toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })}
                          </span>
                        </div>
                        <span className="badge badge-success">{r.proposedAmountEur.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })}</span>
                      </div>
                      <p className="investment-contribution-meta">{r.reason}</p>
                    </article>
                  ))}
                </div>
              </>
            ) : null}

            {/* G5+G6 — Riesgos y adaptación */}
            {(strategyReport.riskSummary.length > 0 || strategyReport.adaptationSuggestions.length > 0) ? (
              <>
                <div className="investment-section-heading" style={{ marginTop: "1rem" }}>
                  <h4>Riesgos detectados y adaptación de ciclo</h4>
                </div>
                <div className="investment-contribution-list">
                  {strategyReport.riskSummary.map((risk, i) => (
                    <article className="investment-contribution" key={`risk-${i}`}>
                      <div className="investment-contribution-header">
                        <strong>Riesgo detectado</strong>
                        <span className="badge badge-danger">Atención</span>
                      </div>
                      <p className="investment-contribution-meta">{risk}</p>
                    </article>
                  ))}
                  {strategyReport.adaptationSuggestions.map((sug, i) => (
                    <article className="investment-contribution" key={`adapt-${i}`}>
                      <div className="investment-contribution-header">
                        <strong>Sugerencia de adaptación</strong>
                        <span className="badge badge-warning">Revisar</span>
                      </div>
                      <p className="investment-contribution-meta">{sug}</p>
                    </article>
                  ))}
                </div>
              </>
            ) : null}
          </section>
        ) : null}

        <SmartBuyPanel cycleId={cycle.id} defaultAmount={cycle.monthlyAmountEur} />

        <RebuyTiersConfig cycleId={cycle.id} />

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
          <label className="form-group">
            <span>Objetivo</span>
            <select className="ui-select" value={objetivo} onChange={(event) => setObjetivo(event.target.value as CycleGoal | "")}>
              <option value="">Sin objetivo</option>
              <option value="acumulacion">Acumulación</option>
              <option value="crecimiento">Crecimiento</option>
              <option value="preservacion">Preservación</option>
              <option value="renta">Renta</option>
            </select>
          </label>
          <label className="form-group">
            <span>Perfil de riesgo</span>
            <select className="ui-select" value={riesgo} onChange={(event) => setRiesgo(event.target.value as CycleRisk | "")}>
              <option value="">Sin definir</option>
              <option value="bajo">Bajo</option>
              <option value="moderado">Moderado</option>
              <option value="alto">Alto</option>
              <option value="muy_alto">Muy alto</option>
            </select>
          </label>
          <label className="form-group investment-wide">
            <span>Notas</span>
            <textarea className="ui-textarea investment-textarea" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
          <div className="investment-form-actions">
            <Button type="submit" variant="secondary" size="sm"><Save size={15} /> Guardar ciclo</Button>
            <Button type="button" variant="danger" size="sm" onClick={() => void onDeleteCycle(cycle.id)}><Trash2 size={15} /> Eliminar ciclo</Button>
            <label className="investment-checkbox-label">
              <input
                type="checkbox"
                checked={allowExtraContributions}
                onChange={(event) => setAllowExtraContributions(event.target.checked)}
              />
              <span>Permitir aportaciones extra</span>
            </label>
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

        <section className="investment-section">
          <div className="investment-section-heading">
            <h3>Plan de aportaciones</h3>
            <span>{contributions.length} aportaciones · {contributions.filter((c) => c.status === "pendiente").length} pendientes</span>
          </div>

          <form className="investment-form-grid compact" onSubmit={(event) => void submitCS(event)}>
            <label className="form-group">
              <span>Tipo</span>
              <select className="ui-select" value={csType} onChange={(event) => setCsType(event.target.value as "periodica" | "extraordinaria")}>
                <option value="periodica">Periódica</option>
                <option value="extraordinaria">Extraordinaria</option>
              </select>
            </label>
            <label className="form-group">
              <span>Fecha prevista</span>
              <Input type="date" value={csDate} onChange={(event) => setCsDate(event.target.value)} />
            </label>
            <label className="form-group">
              <span>Importe (EUR)</span>
              <Input inputMode="decimal" value={csAmount} onChange={(event) => setCsAmount(event.target.value)} placeholder="Ej. 100" />
            </label>
            <label className="form-group">
              <span>Moneda</span>
              <Input value={csCurrency} onChange={(event) => setCsCurrency(event.target.value.toUpperCase())} />
            </label>
            <label className="form-group">
              <span>Destino (activo o vacío)</span>
              <select className="ui-select" value={csDestination} onChange={(event) => setCsDestination(event.target.value)}>
                <option value="">Distribuir según ciclo</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>{a.symbol} · {a.name}</option>
                ))}
              </select>
            </label>
            <label className="form-group investment-wide">
              <span>Notas</span>
              <Input value={csNotes} onChange={(event) => setCsNotes(event.target.value)} />
            </label>
            <div className="investment-form-actions">
              <Button type="submit" variant="primary" size="sm" loading={createCS.isPending} disabled={!csAmount}>
                <Plus size={15} /> Añadir aportación
              </Button>
            </div>
          </form>

          <div className="investment-contribution-list">
            {contributions.length === 0 ? (
              <p className="empty-inline">No hay aportaciones planificadas para este ciclo.</p>
            ) : contributions.map((cs) => (
              <article className="investment-contribution" key={cs.id}>
                <div className="investment-contribution-header">
                  <div>
                    <strong>{formatMoney(cs.amountEur)} {cs.currency}</strong>
                    <span>{formatDate(cs.plannedDate)}</span>
                  </div>
                  <div className="investment-asset-badges">
                    <span className="badge">{CS_TYPE_LABEL[cs.type]}</span>
                    <span className={`badge ${CS_STATUS_BADGE[cs.status]}`}>{CS_STATUS_LABEL[cs.status]}</span>
                  </div>
                </div>
                {cs.destination ? (
                  <p className="investment-contribution-meta">
                    Destino: {assets.find((a) => a.id === cs.destination)?.symbol ?? cs.destination}
                  </p>
                ) : null}
                {cs.notes ? <p className="investment-contribution-meta">{cs.notes}</p> : null}
                {cs.executedAt ? (
                  <p className="investment-contribution-meta">Ejecutada: {formatDate(cs.executedAt)}</p>
                ) : null}
                <div className="investment-form-actions">
                  {cs.status === "pendiente" ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      loading={executeCS.isPending}
                      onClick={() => void executeCS.mutateAsync(cs.id)}
                    >
                      <CheckCircle size={15} /> Marcar ejecutada
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    loading={deleteCS.isPending}
                    onClick={() => void deleteCS.mutateAsync(cs.id)}
                  >
                    <Trash2 size={15} /> Eliminar
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="investment-section">
          <div className="investment-section-heading">
            <h3>Ventas parciales</h3>
            <span>{partialSales.length} registradas</span>
          </div>

          <form className="investment-form-grid compact" onSubmit={(event) => void submitPS(event)}>
            <label className="form-group investment-wide">
              <span>Operación de venta</span>
              <select
                className="ui-select"
                value={psTransactionId}
                onChange={(event) => setPsTransactionId(event.target.value)}
              >
                <option value="">Selecciona una venta…</option>
                {sellTransactions.map((tx) => {
                  const src = tx.legs.find((l) => l.legType === "source");
                  return (
                    <option key={tx.id} value={tx.id}>
                      {formatDate(tx.date)} · {src ? `${src.assetId} ${src.amount}` : "?"} {tx.notes ? `· ${tx.notes}` : ""}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="form-group">
              <span>% del holding</span>
              <Input inputMode="decimal" value={psPercentage} onChange={(event) => setPsPercentage(event.target.value)} placeholder="Ej. 25" />
            </label>
            <label className="form-group">
              <span>Ingresos EUR</span>
              <Input inputMode="decimal" value={psProceeds} onChange={(event) => setPsProceeds(event.target.value)} placeholder="Ej. 500" />
            </label>
            <label className="form-group investment-wide">
              <span>Notas</span>
              <Input value={psNotes} onChange={(event) => setPsNotes(event.target.value)} />
            </label>
            <div className="investment-form-actions">
              <Button type="submit" variant="primary" size="sm" loading={createPS.isPending} disabled={!psTransactionId || !psPercentage || !psProceeds}>
                <Plus size={15} /> Registrar venta parcial
              </Button>
            </div>
          </form>

          <div className="investment-contribution-list">
            {partialSales.length === 0 ? (
              <p className="empty-inline">No hay ventas parciales registradas para este ciclo.</p>
            ) : partialSales.map((ps) => (
              <article className="investment-contribution" key={ps.id}>
                <div className="investment-contribution-header">
                  <div>
                    <strong>{ps.assetId} · {ps.percentageOfHolding.toLocaleString("es-ES", { maximumFractionDigits: 2 })}% del holding</strong>
                    <span>{formatDate(ps.date)} · {formatMoney(ps.proceedsEur)} recibidos</span>
                  </div>
                </div>
                {ps.notes ? <p className="investment-contribution-meta">{ps.notes}</p> : null}
                <div className="investment-form-actions">
                  <Button type="button" variant="danger" size="sm" loading={deletePS.isPending} onClick={() => void deletePS.mutateAsync(ps.id)}>
                    <Trash2 size={15} /> Eliminar
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </section>

        {liquidityItems.length > 0 ? (
          <section className="investment-section">
            <div className="investment-section-heading">
              <h3>Liquidez del ciclo</h3>
              <span>{liquidityItems.length} asignaciones · {formatMoney(liquidityItems.filter((l) => l.status === "reserved").reduce((s, l) => s + l.amountEur, 0))} disponible</span>
            </div>
            <div className="investment-contribution-list">
              {liquidityItems.map((liq) => (
                <article className="investment-contribution" key={liq.id}>
                  <div className="investment-contribution-header">
                    <div>
                      <strong>{formatMoney(liq.amountEur)}</strong>
                      <span>{LIQUIDITY_SOURCE_LABEL[liq.sourceType]} · {liq.reason}</span>
                    </div>
                    <span className={`badge ${liq.status === "reserved" ? "badge-success" : ""}`}>
                      {LIQUIDITY_STATUS_LABEL[liq.status]}
                    </span>
                  </div>
                  {liq.notes ? <p className="investment-contribution-meta">{liq.notes}</p> : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <section className="investment-section">
          <div className="investment-section-heading">
            <h3>Sustitución de activos</h3>
            <span>{substitutions.length} registradas</span>
          </div>

          <form className="investment-form-grid compact" onSubmit={(event) => void submitSub(event)}>
            <label className="form-group">
              <span>Activo saliente</span>
              <select className="ui-select" value={subFromAssetId} onChange={(event) => setSubFromAssetId(event.target.value)}>
                <option value="">Selecciona activo…</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>{a.symbol} · {a.name}</option>
                ))}
              </select>
            </label>
            <label className="form-group">
              <span>Activo entrante (vacío = retirada)</span>
              <select className="ui-select" value={subToAssetId} onChange={(event) => setSubToAssetId(event.target.value)}>
                <option value="">Sin sustituto (retirada)</option>
                {assets.filter((a) => a.id !== subFromAssetId).map((a) => (
                  <option key={a.id} value={a.id}>{a.symbol} · {a.name}</option>
                ))}
              </select>
            </label>
            <label className="form-group">
              <span>Fecha efectiva</span>
              <Input type="date" value={subEffectiveDate} onChange={(event) => setSubEffectiveDate(event.target.value)} />
            </label>
            <label className="form-group investment-wide">
              <span>Motivo</span>
              <Input value={subReason} onChange={(event) => setSubReason(event.target.value)} placeholder="Ej. Mejor relación riesgo/retorno de TON frente a ADA" />
            </label>
            <label className="form-group investment-wide">
              <span>Notas</span>
              <Input value={subNotes} onChange={(event) => setSubNotes(event.target.value)} />
            </label>
            <div className="investment-form-actions">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={createSub.isPending}
                disabled={!subFromAssetId || !subReason.trim()}
              >
                <Plus size={15} /> Registrar sustitución
              </Button>
            </div>
          </form>

          <div className="investment-contribution-list">
            {substitutions.length === 0 ? (
              <p className="empty-inline">No hay sustituciones registradas para este ciclo.</p>
            ) : substitutions.map((sub) => {
              const fromAsset = assets.find((a) => a.id === sub.fromAssetId);
              const toAsset = sub.toAssetId ? assets.find((a) => a.id === sub.toAssetId) : null;
              return (
                <article className="investment-contribution" key={sub.id}>
                  <div className="investment-contribution-header">
                    <div>
                      <strong>
                        {fromAsset ? `${fromAsset.symbol} · ${fromAsset.name}` : sub.fromAssetId}
                        {" → "}
                        {toAsset ? `${toAsset.symbol} · ${toAsset.name}` : sub.toAssetId ? sub.toAssetId : "Retirada"}
                      </strong>
                      <span>{formatDate(sub.effectiveDate)}</span>
                    </div>
                  </div>
                  <p className="investment-contribution-meta">{sub.reason}</p>
                  {sub.notes ? <p className="investment-contribution-meta">{sub.notes}</p> : null}
                  <div className="investment-form-actions">
                    {sub.fromInvestmentAssetId == null ? (
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        loading={executeSub.isPending}
                        onClick={() => void executeSub.mutateAsync(sub.id)}
                      >
                        <CheckCircle size={15} /> Ejecutar sustitución
                      </Button>
                    ) : (
                      <span className="badge badge-success">Ejecutada</span>
                    )}
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      loading={deleteSub.isPending}
                      onClick={() => void deleteSub.mutateAsync(sub.id)}
                    >
                      <Trash2 size={15} /> Eliminar
                    </Button>
                  </div>
                </article>
              );
            })}
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
  const healthQuery = useQuery({
    queryKey: ["investment-assets", "health", item.assetId],
    queryFn: () => unwrap(window.cryptoControl.investmentAssets.getHealth({ assetId: item.assetId })),
    staleTime: 5 * 60 * 1000,
  });
  const health: AssetHealthResult | null = healthQuery.data ?? null;

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
        <div className="investment-asset-badges">
          <span className={status === "active" ? "badge badge-success" : "badge"}>{ASSET_STATUS_LABEL[status]}</span>
          {health ? (
            <>
              <span className={`badge ${ASSET_HEALTH_BADGE[health.status]}`}>
                {ASSET_HEALTH_LABEL[health.status]}
              </span>
              <span className={`badge ${ASSET_RISK_BADGE[health.riesgoNivel]}`}>
                Riesgo {ASSET_RISK_LABEL[health.riesgoNivel]}
              </span>
              {health.tendencia ? (
                <span className="badge">{ASSET_TREND_LABEL[health.tendencia]}</span>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
      <dl className="investment-asset-summary">
        <div><dt>Inicio</dt><dd>{formatDate(item.startDate)}</dd></div>
        <div><dt>Fin</dt><dd>{formatDate(item.endDate)}</dd></div>
        <div><dt>Objetivos</dt><dd>{objectiveParts.length ? objectiveParts.join(" · ") : "Sin objetivo"}</dd></div>
      </dl>
      {health ? (
        <section className="investment-section" aria-label="Salud del activo">
          <div className="investment-section-heading">
            <h3>Salud del activo</h3>
            <span className={`badge ${ASSET_HEALTH_BADGE[health.status]}`}>{STRATEGIC_STATE_LABEL[health.estadoEstrategico]}</span>
          </div>
          <div className="investment-metrics-grid">
            <article className="investment-summary-tile">
              <span>Estado general</span>
              <strong className={ASSET_HEALTH_BADGE[health.status].replace("badge-", "text-")}>
                {ASSET_HEALTH_LABEL[health.status]}
              </strong>
            </article>
            <article className="investment-summary-tile">
              <span>Tendencia</span>
              <strong>{health.tendencia ? ASSET_TREND_LABEL[health.tendencia] : "Sin datos"}</strong>
            </article>
            <article className="investment-summary-tile">
              <span>Nivel de riesgo</span>
              <strong>{ASSET_RISK_LABEL[health.riesgoNivel]}</strong>
            </article>
            <article className="investment-summary-tile">
              <span>Fortaleza relativa vs BTC</span>
              <strong style={{ color: health.relativeStrengthVsBtc !== null ? (health.relativeStrengthVsBtc >= 0 ? "var(--color-success)" : "var(--color-danger)") : undefined }}>
                {health.relativeStrengthVsBtc !== null ? `${health.relativeStrengthVsBtc >= 0 ? "+" : ""}${health.relativeStrengthVsBtc.toFixed(1)} pts` : "Sin datos"}
              </strong>
            </article>
            <article className="investment-summary-tile">
              <span>Estado estratégico</span>
              <strong>{STRATEGIC_STATE_LABEL[health.estadoEstrategico]}</strong>
            </article>
            {health.strongEntrySignal ? (
              <article className="investment-summary-tile">
                <span>Señal de entrada</span>
                <strong style={{ color: "var(--color-success)" }}>Fuerte</strong>
              </article>
            ) : null}
          </div>
          <p className="investment-contribution-meta">{health.reasoning}</p>
          {health.signalsUnavailable.length > 0 ? (
            <p className="investment-contribution-meta">
              Sin datos para: {health.signalsUnavailable.join(", ")}
            </p>
          ) : null}
        </section>
      ) : null}
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

export function PlanInversionCiclos() {
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
  const [cycleObjetivo, setCycleObjetivo] = useState<CycleGoal | "">("");
  const [cycleRiesgo, setCycleRiesgo] = useState<CycleRisk | "">("");
  const [cycleAllowExtra, setCycleAllowExtra] = useState(true);
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

  const treasurySummaryQuery = useQuery({
    queryKey: ["treasury", "summary"],
    queryFn: () => unwrap(window.cryptoControl.treasury.getSummary()),
    staleTime: 5 * 60 * 1000,
  });
  const treasurySummary: TreasurySummary | null = treasurySummaryQuery.data ?? null;

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
      objetivo?: CycleGoal | null;
      riesgo?: CycleRisk | null;
      allowExtraContributions?: boolean;
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
      objetivo: cycleObjetivo || null,
      riesgo: cycleRiesgo || null,
      allowExtraContributions: cycleAllowExtra,
      notes: cycleNotes || null,
    });
    setCycleName("Nuevo ciclo");
    setCycleEnd("");
    setCycleStatus("planned");
    setCycleObjetivo("");
    setCycleRiesgo("");
    setCycleAllowExtra(true);
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
                  <label className="form-group">
                    <span>Objetivo</span>
                    <select className="ui-select" value={cycleObjetivo} onChange={(event) => setCycleObjetivo(event.target.value as CycleGoal | "")}>
                      <option value="">Sin objetivo</option>
                      <option value="acumulacion">Acumulación</option>
                      <option value="crecimiento">Crecimiento</option>
                      <option value="preservacion">Preservación</option>
                      <option value="renta">Renta</option>
                    </select>
                  </label>
                  <label className="form-group">
                    <span>Perfil de riesgo</span>
                    <select className="ui-select" value={cycleRiesgo} onChange={(event) => setCycleRiesgo(event.target.value as CycleRisk | "")}>
                      <option value="">Sin definir</option>
                      <option value="bajo">Bajo</option>
                      <option value="moderado">Moderado</option>
                      <option value="alto">Alto</option>
                      <option value="muy_alto">Muy alto</option>
                    </select>
                  </label>
                  <label className="form-group investment-wide">
                    <span>Notas</span>
                    <Input value={cycleNotes} onChange={(event) => setCycleNotes(event.target.value)} />
                  </label>
                  <div className="investment-form-actions">
                    <Button type="submit" loading={createCycle.isPending}><Plus size={15} /> Crear ciclo</Button>
                    <label className="investment-checkbox-label">
                      <input
                        type="checkbox"
                        checked={cycleAllowExtra}
                        onChange={(event) => setCycleAllowExtra(event.target.checked)}
                      />
                      <span>Permitir aportaciones extra</span>
                    </label>
                  </div>
                </form>
              </CardContent>
            </Card>

            {treasurySummary ? (
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Tesorería (resumen)</CardTitle>
                    <p className="panel-caption">Liquidez disponible para la estrategia. Gestión completa en la sección Tesorería.</p>
                  </div>
                </CardHeader>
                <CardContent>
                  <section className="investment-metrics-grid" aria-label="Resumen de tesorería">
                    <article className="investment-summary-tile">
                      <span>Efectivo</span>
                      <strong>{formatMoney(treasurySummary.cashBalance)}</strong>
                    </article>
                    <article className="investment-summary-tile">
                      <span>EURC</span>
                      <strong>{formatMoney(treasurySummary.eurcBalance)}</strong>
                    </article>
                    <article className="investment-summary-tile">
                      <span>Liquidez total</span>
                      <strong>{formatMoney(treasurySummary.totalLiquidity)}</strong>
                    </article>
                    <article className="investment-summary-tile">
                      <span>Libre para recompras</span>
                      <strong>{formatMoney(treasurySummary.freeRebuyLiquidity)}</strong>
                    </article>
                    <article className="investment-summary-tile">
                      <span>Reserva fiscal</span>
                      <strong>{formatMoney(treasurySummary.fiscalReserveBalance)}</strong>
                    </article>
                    <article className="investment-summary-tile">
                      <span>Impuestos estimados pendientes</span>
                      <strong>{formatMoney(treasurySummary.pendingEstimatedTaxes)}</strong>
                    </article>
                  </section>
                </CardContent>
              </Card>
            ) : null}

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



function pickUsableCycle(current: InvestmentCycle | null | undefined, cycles: InvestmentCycle[] | undefined) {
  return current
    ?? cycles?.find((item) => item.status === "active")
    ?? cycles?.find((item) => item.status === "planned")
    ?? cycles?.[0]
    ?? null;
}

// Wrappers que obtienen la etapa activa y la pasan al componente hijo
function PlanBeneficiosCaidasWrapper() {
  const activePlanQ = useQuery<InvestmentPlan | null>({
    queryKey: ["investment-plan", "active"],
    queryFn: () => unwrap(window.cryptoControl.investmentPlan.getActive()),
  });
  const activePlan = activePlanQ.data ?? null;

  const currentCycleQ = useQuery<InvestmentCycle | null>({
    queryKey: ["investment-cycles", "current", activePlan?.id],
    enabled: Boolean(activePlan?.id),
    queryFn: () => unwrap(window.cryptoControl.investmentCycles.getCurrent({ planId: activePlan!.id })),
  });
  const cyclesQ = useQuery<InvestmentCycle[]>({
    queryKey: ["investment-cycles", activePlan?.id],
    enabled: Boolean(activePlan?.id),
    queryFn: () => unwrap(window.cryptoControl.investmentCycles.list({ planId: activePlan!.id })),
  });

  const cycle = pickUsableCycle(currentCycleQ.data, cyclesQ.data);

  if (activePlanQ.isLoading || currentCycleQ.isLoading || cyclesQ.isLoading) {
    return <p style={{ padding: 20, color: "var(--color-text-muted)" }}>Cargando Ventas/Recompras…</p>;
  }

  if (!activePlan) {
    return (
      <Card>
        <CardContent>
          <p className="empty-inline">No hay un Plan activo. Crea un plan antes de configurar ventas y recompras.</p>
        </CardContent>
      </Card>
    );
  }

  if (!cycle) {
    return (
      <Card>
        <CardContent>
          <p className="empty-inline">No hay etapas disponibles para configurar ventas y recompras.</p>
        </CardContent>
      </Card>
    );
  }

  return <PlanBeneficiosCaidas cycleId={cycle.id} />;
}

function PlanCompraInteligenteWrapper() {
  const activePlanQ = useQuery<InvestmentPlan | null>({
    queryKey: ["investment-plan", "active"],
    queryFn: () => unwrap(window.cryptoControl.investmentPlan.getActive()),
  });
  const activePlan = activePlanQ.data ?? null;

  const currentCycleQ = useQuery<InvestmentCycle | null>({
    queryKey: ["investment-cycles", "current", activePlan?.id],
    enabled: Boolean(activePlan?.id),
    queryFn: () => unwrap(window.cryptoControl.investmentCycles.getCurrent({ planId: activePlan!.id })),
  });

  const cyclesQ = useQuery<InvestmentCycle[]>({
    queryKey: ["investment-cycles", activePlan?.id],
    enabled: Boolean(activePlan?.id),
    queryFn: () => unwrap(window.cryptoControl.investmentCycles.list({ planId: activePlan!.id })),
  });

  const cycle = pickUsableCycle(currentCycleQ.data, cyclesQ.data);

  if (activePlanQ.isLoading || currentCycleQ.isLoading || cyclesQ.isLoading) {
    return <p style={{ padding: 20, color: "var(--color-text-muted)" }}>Cargando Compra Inteligente…</p>;
  }

  if (!activePlan) {
    return (
      <Card>
        <CardContent>
          <p className="empty-inline">No hay un Plan activo. Crea un plan antes de usar Compra Inteligente.</p>
        </CardContent>
      </Card>
    );
  }

  if (!cycle) {
    return (
      <Card>
        <CardContent>
          <p className="empty-inline">No hay etapas disponibles para analizar compras.</p>
        </CardContent>
      </Card>
    );
  }

  return <SmartBuyPanel cycleId={cycle.id} defaultAmount={cycle.monthlyAmountEur} />;
}

function PlanSeguimientoWrapper() {
  const activePlanQ = useQuery<InvestmentPlan | null>({
    queryKey: ["investment-plan", "active"],
    queryFn: () => unwrap(window.cryptoControl.investmentPlan.getActive()),
  });
  const activePlan = activePlanQ.data ?? null;

  const currentCycleQ = useQuery<InvestmentCycle | null>({
    queryKey: ["investment-cycles", "current", activePlan?.id],
    enabled: Boolean(activePlan?.id),
    queryFn: () => unwrap(window.cryptoControl.investmentCycles.getCurrent({ planId: activePlan!.id })),
  });
  const cyclesQ = useQuery<InvestmentCycle[]>({
    queryKey: ["investment-cycles", activePlan?.id],
    enabled: Boolean(activePlan?.id),
    queryFn: () => unwrap(window.cryptoControl.investmentCycles.list({ planId: activePlan!.id })),
  });

  const cycle = pickUsableCycle(currentCycleQ.data, cyclesQ.data);

  if (activePlanQ.isLoading || currentCycleQ.isLoading || cyclesQ.isLoading) {
    return <p style={{ padding: 20, color: "var(--color-text-muted)" }}>Cargando seguimiento…</p>;
  }

  if (!activePlan) {
    return (
      <Card>
        <CardContent>
          <p className="empty-inline">No hay un Plan activo. Crea un plan antes de revisar el seguimiento.</p>
        </CardContent>
      </Card>
    );
  }

  if (!cycle) {
    return (
      <Card>
        <CardContent>
          <p className="empty-inline">No hay etapas disponibles para el seguimiento.</p>
        </CardContent>
      </Card>
    );
  }

  return <PlanSeguimiento cycleId={cycle.id} />;
}

export function PlanInversion() {
  return (
    <Routes>
      <Route element={<PlanLayout />}>
        <Route index element={<Navigate to="resumen" replace />} />
        <Route path="resumen" element={<PlanResumen />} />
        {/* "Configurar mi plan": etapas, monedas, reparto, compra inteligente, cambios */}
        <Route path="configurar/*" element={<PlanConfigurar />} />
        {/* Secciones en construcción — G-A4 y siguientes */}
        <Route path="aportaciones" element={<PlanAportaciones />} />
        <Route path="compra-inteligente" element={<PlanCompraInteligenteWrapper />} />
        <Route path="ventas-recompras" element={<PlanBeneficiosCaidasWrapper />} />
        <Route path="seguimiento" element={<PlanSeguimientoWrapper />} />
        <Route path="escenarios" element={<PlanEscenarios />} />
        {/* Redirects desde rutas antiguas de la arquitectura provisional */}
        <Route path="ciclos/*" element={<Navigate to="/plan-inversion/configurar" replace />} />
        <Route path="estrategia" element={<Navigate to="/plan-inversion/configurar" replace />} />
        <Route path="beneficios-y-caidas" element={<Navigate to="/plan-inversion/ventas-recompras" replace />} />
        <Route path="sustituciones" element={<Navigate to="/plan-inversion/ventas-recompras" replace />} />
        <Route path="historial" element={<Navigate to="/plan-inversion/seguimiento" replace />} />
        <Route path="*" element={<Navigate to="resumen" replace />} />
      </Route>
    </Routes>
  );
}
