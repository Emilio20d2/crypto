import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChartNoAxesCombined } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/Card";
import { Badge } from "../components/Badge";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { PageToolbar } from "../components/PageToolbar";
// formatMoney no se usa aquí: el formatter local (_eur2) garantiza max 2 decimales

// ─── Types (mirrors packages/portfolio/src/perspectives/types.ts) ────────────

type SimScenario = "conservador" | "moderado" | "base" | "favorable" | "optimista";

interface AnnualAssetPosition {
  assetId: string;
  balance: number;
  avgCostEur: number | null;
  priceEur: number | null;
  valueEur: number | null;
  unrealizedGainEur: number | null;
  totalBought: number;
  totalSold: number;
  totalRebuys: number;
  goalReached: boolean;
  failed: boolean;
}

interface SimEvent {
  date: number;
  type: string;
  assetId?: string;
  amountEur?: number;
  quantity?: number;
  priceEur?: number;
  gainEur?: number;
  taxEur?: number;
  description: string;
}

interface AnnualSnapshot {
  year: number;
  scope: "plan" | "extrapol";
  openingWealthEur: number;
  closingWealthEur: number;
  closingGrossEur: number;
  contributionsEur: number;
  marketGainEur: number;
  salesEur: number;
  rebuysEur: number;
  commissionsEur: number;
  taxEur: number;
  eurcReinvestedEur: number;
  netEurcInflowEur: number;
  fiscalReserveEur: number;
  eurcFreeEur: number;
  eurCashEur: number;
  annualReturnPct: number | null;
  positions: Record<string, AnnualAssetPosition>;
  events: SimEvent[];
  forecastCoverage: "covered" | "uncovered";
}

interface ScenarioSummary {
  scenario: SimScenario;
  initialWealthEur: number;
  finalNetWealthEur: number;
  totalContributionsEur: number;
  totalHistoricalCapitalEur: number;
  totalMarketGainEur: number;
  totalSalesEur: number;
  totalRebuysEur: number;
  totalCommissionsEur: number;
  totalTaxEur: number;
  totalEurcReinvestedEur: number;
  totalNetEurcInflowEur: number;
  initialEurcFreeEur: number;
  initialEurcFiscalReserveEur: number;
  finalEurcFreeEur: number;
  finalFiscalReserveEur: number;
  xirr: number | null;
  twr: number | null;
  maxDrawdownPct: number | null;
}

interface AssetPriceInfo {
  assetId: string;
  tier: string;
  currentPriceEur: number | null;
  horizonPriceEur: number | null;
  priceMultiple: number | null;
  modelType: "external_direct" | "external_interpolated" | "no_coverage";
  externalSourceCount: number;
  directCoverageYears: number[];
  interpolatedCoverageYears: number[];
  lastCoveredYear: number | null;
  circulatingSupplyM: number | null;
  impliedMarketCapBnEur: number | null;
  impliedMarketCapWarning: boolean;
}

interface ScenarioResult {
  scenario: SimScenario;
  label: string;
  annualSnapshots: AnnualSnapshot[];
  summary: ScenarioSummary;
  assetPriceInfo: Record<string, AssetPriceInfo>;
}

interface ValidationResult {
  rule: string;
  passed: boolean;
  detail: string;
}

interface SimDiagnostics {
  engineIsNew: true;
  source: string;
  engineVersion: string;
  engineBuildHash: string;
  engineGeneratedAt: number;
  negativeMonthCount: number;
  negativeYearCount: number;
  maxDrawdownPct: number | null;
  hasBearPeriods: boolean;
}

interface PerspectivesSimulation {
  computedAt: number;
  startYear: number;
  endYear: number;
  horizonDate: number;
  scenarios: ScenarioResult[];
  validations: ValidationResult[];
  diagnostics: SimDiagnostics;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SCENARIOS: SimScenario[] = ["conservador", "moderado", "base", "favorable", "optimista"];
const SCENARIO_LABELS: Record<SimScenario, string> = {
  conservador: "Conservador",
  moderado:    "Moderado",
  base:        "Base",
  favorable:   "Favorable",
  optimista:   "Optimista",
};
const CURRENT_YEAR = new Date().getFullYear();
const HORIZON_YEARS = 20; // siempre 2026-2045, no configurable
const END_YEAR = CURRENT_YEAR + HORIZON_YEARS;

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Siempre 2 decimales máx (formatMoney usa 4 para valores < €100)
const _eur2 = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });

function fmt(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  return _eur2.format(v);
}

function fmtSign(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${_eur2.format(v)}`;
}

function fmtPct(v: number | null | undefined, decimals = 1): string {
  if (v == null || !isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(decimals)}%`;
}

function fmtAnnualPct(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

const EVENT_BADGE_VARIANT: Record<string, "success" | "danger" | "warning" | "info" | "neutral"> = {
  sale: "warning",
  rebuy: "success",
  purchase: "info",
  asset_failed: "danger",
  asset_deteriorated: "danger",
  goal_reached: "success",
  substitution: "info",
  reinvestment: "neutral",
};

const EVENT_LABELS: Record<string, string> = {
  purchase: "Compra", sale: "Venta", rebuy: "Recompra",
  reinvestment: "Reinversión", tax_reserve: "Reserva fiscal",
  goal_reached: "Objetivo", asset_deteriorated: "Deterioro",
  asset_failed: "Fallido", substitution: "Sustitución",
  strategy_revision: "Revisión", cycle_change: "Ciclo",
  contribution: "Aportación",
};

// ─── ScenarioSelector ─────────────────────────────────────────────────────────

function ScenarioSelector({
  value,
  onChange,
}: {
  value: SimScenario;
  onChange: (s: SimScenario) => void;
}) {
  return (
    <div className="persp-scenario-selector" role="group" aria-label="Escenario de simulación">
      {SCENARIOS.map(s => (
        <button
          key={s}
          type="button"
          className={`persp-scenario-btn${s === value ? " persp-scenario-btn--active" : ""}`}
          onClick={() => onChange(s)}
        >
          {SCENARIO_LABELS[s]}
        </button>
      ))}
    </div>
  );
}

// ─── YearStrip ────────────────────────────────────────────────────────────────

function YearStrip({
  years,
  selected,
  onSelect,
}: {
  years: number[];
  selected: number;
  onSelect: (y: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollRef.current) return;
    const activeEl = scrollRef.current.querySelector(".persp-year-strip-btn--active") as HTMLElement | null;
    activeEl?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [selected]);

  const idx = years.indexOf(selected);

  return (
    <div className="persp-year-strip" role="group" aria-label="Seleccionar año">
      <button
        type="button"
        className="persp-year-strip-nav"
        onClick={() => idx > 0 && onSelect(years[idx - 1])}
        disabled={idx <= 0}
        aria-label="Año anterior"
      >‹</button>
      <div className="persp-year-strip-scroll" ref={scrollRef}>
        {years.map(y => (
          <button
            key={y}
            type="button"
            className={`persp-year-strip-btn${y === selected ? " persp-year-strip-btn--active" : ""}`}
            onClick={() => onSelect(y)}
          >
            {y}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="persp-year-strip-nav"
        onClick={() => idx < years.length - 1 && onSelect(years[idx + 1])}
        disabled={idx >= years.length - 1}
        aria-label="Año siguiente"
      >›</button>
    </div>
  );
}

// ─── CollapsibleSection ───────────────────────────────────────────────────────

function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="persp-collapsible">
      <button
        type="button"
        className="persp-collapsible-toggle"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <span>{title}</span>
        <span className={`persp-collapsible-icon${open ? " persp-collapsible-icon--open" : ""}`}>▸</span>
      </button>
      {open && <div className="persp-collapsible-body">{children}</div>}
    </div>
  );
}

// ─── Annual summary table ─────────────────────────────────────────────────────

function AnnualTable({ snapshots }: { snapshots: AnnualSnapshot[] }) {
  if (snapshots.length === 0) return null;
  const totalContrib = snapshots.reduce((s, r) => s + r.contributionsEur, 0);
  const totalMarket = snapshots.reduce((s, r) => s + r.marketGainEur, 0);
  const totalSales = snapshots.reduce((s, r) => s + r.salesEur, 0);
  const totalRebuys = snapshots.reduce((s, r) => s + r.rebuysEur, 0);
  const totalTax = snapshots.reduce((s, r) => s + r.taxEur, 0);

  return (
    <div className="space-y-2">
      <div className="responsive-table persp-table">
        <table>
          <thead>
            <tr>
              <th>Año</th>
              <th className="num">Apertura neta</th>
              <th className="num">Aportaciones</th>
              <th className="num">Resultado mercado</th>
              <th className="num">Ventas ⓘ</th>
              <th className="num">Recompras ⓘ</th>
              <th className="num">Impuesto</th>
              <th className="num">Cierre neto</th>
              <th className="num">TWR anual</th>
            </tr>
          </thead>
          <tbody>
            {snapshots.map(s => (
              <tr key={s.year} className={`${s.scope === "extrapol" ? "opacity-70" : ""} ${s.forecastCoverage === "uncovered" ? "persp-row-no-coverage" : ""}`}>
                <td>
                  <span style={{ fontWeight: 600 }}>{s.year}</span>
                  {s.scope === "extrapol" && <span className="ml-1 text-xs text-muted-foreground">*</span>}
                  {s.forecastCoverage === "uncovered" && (
                    <span className="ml-1 text-xs text-muted-foreground" title="Sin cobertura de previsiones externas">⚠</span>
                  )}
                </td>
                <td className="num">{fmt(s.openingWealthEur)}</td>
                <td className="num">{fmt(s.contributionsEur)}</td>
                <td className={`num ${s.marketGainEur >= 0 ? "text-gain" : "text-loss"}`}>
                  {fmtSign(s.marketGainEur)}
                </td>
                <td className="num text-muted-foreground">{s.salesEur > 0 ? fmt(s.salesEur) : "—"}</td>
                <td className="num text-muted-foreground">{s.rebuysEur > 0 ? fmt(s.rebuysEur) : "—"}</td>
                <td className="num">{s.taxEur > 0 ? fmt(s.taxEur) : "—"}</td>
                <td className="num" style={{ fontWeight: 600 }}>{fmt(s.closingWealthEur)}</td>
                <td className={`num ${(s.annualReturnPct ?? 0) >= 0 ? "text-gain" : "text-loss"}`}>
                  {s.annualReturnPct != null ? fmtAnnualPct(s.annualReturnPct) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td><strong>Total</strong></td>
              <td className="num">{fmt(snapshots[0]?.openingWealthEur)}</td>
              <td className="num">{fmt(totalContrib)}</td>
              <td className={`num ${totalMarket >= 0 ? "text-gain" : "text-loss"}`}>{fmtSign(totalMarket)}</td>
              <td className="num text-muted-foreground">{totalSales > 0 ? fmt(totalSales) : "—"}</td>
              <td className="num text-muted-foreground">{totalRebuys > 0 ? fmt(totalRebuys) : "—"}</td>
              <td className="num">{totalTax > 0 ? fmt(totalTax) : "—"}</td>
              <td className="num"><strong>{fmt(snapshots.at(-1)?.closingWealthEur)}</strong></td>
              <td className="num"></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        ⓘ Ventas y Recompras son movimientos internos (cripto ↔ EURC). No se suman ni restan al patrimonio — son informativas.
        {snapshots.some(s => s.scope === "extrapol") && " · * Años extrapolados fuera del plan explícito."}
        {snapshots.some(s => s.forecastCoverage === "uncovered") && " · ⚠ Años sin previsiones externas verificadas — valores estimados sin respaldo institucional."}
      </p>
    </div>
  );
}

// ─── Year detail section ──────────────────────────────────────────────────────

function YearDetail({ snap }: { snap: AnnualSnapshot }) {
  const [eventsOpen, setEventsOpen] = useState(false);
  const positions = Object.values(snap.positions).filter(p => p.balance > 0 || p.failed);

  const phaseLabel =
    snap.scope === "extrapol"
      ? "Extrapolado"
      : snap.forecastCoverage === "uncovered"
      ? "Sin cobertura"
      : "Con cobertura";

  return (
    <div className="space-y-4">
      {/* 3×3 grid de métricas */}
      <div className="persp-annual-grid">
        <div className="persp-annual-metric">
          <span className="persp-annual-label">Apertura neta</span>
          <span className="persp-annual-value">{fmt(snap.openingWealthEur)}</span>
        </div>
        <div className="persp-annual-metric">
          <span className="persp-annual-label">Aportaciones</span>
          <span className="persp-annual-value">{fmt(snap.contributionsEur)}</span>
        </div>
        <div className="persp-annual-metric">
          <span className="persp-annual-label">Cierre neto</span>
          <span className={`persp-annual-value ${snap.closingWealthEur >= snap.openingWealthEur ? "pos" : "neg"}`}>
            {fmt(snap.closingWealthEur)}
          </span>
        </div>
        <div className="persp-annual-metric">
          <span className="persp-annual-label">Resultado mercado</span>
          <span className={`persp-annual-value ${snap.marketGainEur >= 0 ? "pos" : "neg"}`}>
            {fmtSign(snap.marketGainEur)}
          </span>
        </div>
        <div className="persp-annual-metric">
          <span className="persp-annual-label">TWR anual</span>
          <span className={`persp-annual-value ${snap.annualReturnPct != null ? (snap.annualReturnPct >= 0 ? "pos" : "neg") : ""}`}>
            {snap.annualReturnPct != null ? fmtAnnualPct(snap.annualReturnPct) : "—"}
          </span>
        </div>
        <div className="persp-annual-metric">
          <span className="persp-annual-label">Fase</span>
          <span className="persp-annual-value">{phaseLabel}</span>
        </div>
        <div className="persp-annual-metric">
          <span className="persp-annual-label">Ventas ⓘ</span>
          <span className="persp-annual-value">{snap.salesEur > 0 ? fmt(snap.salesEur) : "—"}</span>
        </div>
        <div className="persp-annual-metric">
          <span className="persp-annual-label">Recompras ⓘ</span>
          <span className="persp-annual-value">{snap.rebuysEur > 0 ? fmt(snap.rebuysEur) : "—"}</span>
        </div>
        <div className="persp-annual-metric">
          <span className="persp-annual-label">Impuesto</span>
          <span className={`persp-annual-value ${snap.taxEur > 0 ? "warn" : ""}`}>
            {snap.taxEur > 0 ? fmt(snap.taxEur) : "—"}
          </span>
        </div>
      </div>

      {/* Posiciones del año */}
      {positions.length > 0 && (
        <div className="responsive-table persp-table">
          <table>
            <thead>
              <tr>
                <th>Activo</th>
                <th className="num">Saldo</th>
                <th className="num">Precio</th>
                <th className="num">Valor</th>
                <th className="num">G/P lat.</th>
              </tr>
            </thead>
            <tbody>
              {positions.map(p => (
                <tr key={p.assetId}>
                  <td>
                    <span className="font-mono font-semibold text-xs">{p.assetId.toUpperCase()}</span>
                    {p.failed && <span className="ml-1"><Badge variant="danger">Fallido</Badge></span>}
                    {p.goalReached && <span className="ml-1"><Badge variant="success">Obj.</Badge></span>}
                  </td>
                  <td className="num font-mono text-xs">{p.balance.toPrecision(4)}</td>
                  <td className="num">{fmt(p.priceEur)}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{fmt(p.valueEur)}</td>
                  <td className={`num ${(p.unrealizedGainEur ?? 0) >= 0 ? "text-gain" : "text-loss"}`}>
                    {p.unrealizedGainEur != null ? fmtSign(p.unrealizedGainEur) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Eventos colapsables */}
      {snap.events.length > 0 && (
        <div>
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setEventsOpen(v => !v)}
          >
            <span>{eventsOpen ? "▾" : "▸"}</span>
            <span>{snap.events.length} eventos</span>
          </button>
          {eventsOpen && (
            <div className="mt-1.5 max-h-40 overflow-y-auto space-y-px">
              {snap.events.map((ev, i) => (
                <div key={i} className="flex items-center gap-2 text-xs py-1 border-b border-border/20">
                  <span className="text-muted-foreground shrink-0 font-mono w-16">
                    {new Date(ev.date).toLocaleDateString("es-ES", { month: "short", year: "2-digit" })}
                  </span>
                  <Badge variant={EVENT_BADGE_VARIANT[ev.type] ?? "neutral"}>
                    {EVENT_LABELS[ev.type] ?? ev.type}
                  </Badge>
                  <span className="text-foreground/75 truncate">{ev.description}</span>
                  {ev.amountEur != null && (
                    <span className="ml-auto shrink-0 font-medium">{fmt(ev.amountEur)}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Evolution chart (SVG) ────────────────────────────────────────────────────

const SCENARIO_CSS_COLORS: Record<SimScenario, string> = {
  conservador: "var(--color-danger)",
  moderado:    "var(--color-warning)",
  base:        "var(--color-primary)",
  favorable:   "var(--color-success)",
  optimista:   "var(--color-sage)",
};

function EvolutionChart({ simData }: { simData: PerspectivesSimulation }) {
  const years = simData.scenarios[0]?.annualSnapshots.map(s => s.year) ?? [];
  if (years.length === 0) return null;

  const allValues = simData.scenarios.flatMap(sc => sc.annualSnapshots.map(s => s.closingWealthEur));
  const maxVal = Math.max(...allValues, 1);

  const W = 600; const H = 200;
  const PAD = { top: 10, right: 10, bottom: 30, left: 65 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;
  const xStep = chartW / Math.max(years.length - 1, 1);

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 320, maxWidth: 700 }}>
        {[0, 0.25, 0.5, 0.75, 1].map(t => {
          const y = PAD.top + chartH * (1 - t);
          const label = maxVal >= 1000 ? `${(maxVal * t / 1000).toFixed(0)}k` : (maxVal * t).toFixed(0);
          return (
            <g key={t}>
              <line x1={PAD.left} x2={PAD.left + chartW} y1={y} y2={y} stroke="var(--border-color)" strokeWidth={0.5} />
              <text x={PAD.left - 4} y={y + 4} textAnchor="end" fontSize={8} fill="var(--text-muted)">{label}</text>
            </g>
          );
        })}
        {years.map((yr, i) => (
          <text key={yr} x={PAD.left + i * xStep} y={H - 6} textAnchor="middle" fontSize={8} fill="var(--text-muted)">{yr}</text>
        ))}
        {simData.scenarios.map(sc => {
          const pts = sc.annualSnapshots.map((s, i) => [
            PAD.left + i * xStep,
            PAD.top + chartH * (1 - s.closingWealthEur / maxVal),
          ]);
          const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
          return (
            <path key={sc.scenario} d={d} fill="none" stroke={SCENARIO_CSS_COLORS[sc.scenario]} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          );
        })}
        {SCENARIOS.map((sc, i) => (
          <g key={sc}>
            <rect x={PAD.left + i * 84} y={H - 14} width={6} height={6} fill={SCENARIO_CSS_COLORS[sc]} rx={1} />
            <text x={PAD.left + i * 84 + 9} y={H - 8} fontSize={7} fill="var(--text-muted)">{SCENARIO_LABELS[sc]}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ─── Analyst Forecast Section ────────────────────────────────────────────────

interface AnalystForecast {
  ticker: string; targetYear: number; scenario: string;
  priceUsd: number; priceEur: number;
  source: string; reportTitle: string; reportUrl: string;
  publishedAt: string; reviewedAt: string; nextReviewAt: string;
}

const SCENARIO_MAP: Record<string, string> = {
  conservador: "Conservador", moderado: "Moderado",
  base: "Base", favorable: "Favorable", optimista: "Optimista",
  medio: "Medio", muy_alcista: "Muy alcista",
};

function AnalystForecastSection({ years, activeAssets }: { years: number[]; activeAssets: string[] }) {
  const { data: forecasts, isLoading } = useQuery<AnalystForecast[]>({
    queryKey: ["perspectives:getAnalystForecasts"],
    queryFn: async () => {
      const r = await window.cryptoControl.perspectives.getAnalystForecasts() as { ok: boolean; data?: AnalystForecast[]; error?: { message?: string } };
      if (!r.ok) throw new Error(r.error?.message ?? "Error");
      return r.data ?? [];
    },
    staleTime: 15 * 60 * 1000,
  });

  if (isLoading) return null;

  const coveredAssets = activeAssets.filter(a => forecasts?.some(f => f.ticker === a));
  const coveredYears = years.filter(y => forecasts?.some(f => f.targetYear === y));

  if (coveredAssets.length === 0) return null;

  const lastReviewed = forecasts?.reduce((best, f) =>
    !best || f.reviewedAt > best ? f.reviewedAt : best, null as string | null);
  const nextReview = forecasts?.reduce((earliest, f) =>
    !earliest || f.nextReviewAt < earliest ? f.nextReviewAt : earliest, null as string | null);

  const fmtDate = (d: string) => new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle>Previsiones externas de analistas</CardTitle>
          <div className="flex gap-3 text-xs text-muted-foreground">
            {lastReviewed && <span>Revisado: {fmtDate(lastReviewed)}</span>}
            {nextReview && <span>Próx. revisión: {fmtDate(nextReview)}</span>}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Precios objetivo publicados en informes públicos de analistas institucionales. Solo se muestran años con cobertura real documentada.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {coveredAssets.map(ticker => {
          const assetForecasts = forecasts?.filter(f => f.ticker === ticker) ?? [];
          const assetYears = coveredYears.filter(y => assetForecasts.some(f => f.targetYear === y));

          if (assetYears.length === 0) return null;

          return (
            <div key={ticker}>
              <p className="text-sm font-semibold mb-2">{ticker}</p>
              <div className="responsive-table persp-table">
                <table>
                  <thead>
                    <tr>
                      <th>Año</th>
                      <th>Escenario</th>
                      <th className="num">Precio (€)</th>
                      <th>Fuente</th>
                      <th>Publicado</th>
                      <th>Informe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assetYears.flatMap(year =>
                      ["conservador", "moderado", "base", "favorable", "optimista", "medio", "muy_alcista"].map(sc => {
                        const f = assetForecasts.find(x => x.targetYear === year && x.scenario === sc);
                        if (!f) return null;
                        return (
                          <tr key={`${year}-${sc}`}>
                            <td className="font-mono text-xs">{year}</td>
                            <td className="text-xs">{SCENARIO_MAP[sc] ?? sc}</td>
                            <td className="num font-semibold">{f.priceEur.toLocaleString("es-ES")} €</td>
                            <td className="text-xs">{f.source}</td>
                            <td className="text-xs text-muted-foreground">
                              {f.publishedAt ? fmtDate(f.publishedAt) : "—"}
                            </td>
                            <td className="text-xs">
                              {f.reportUrl
                                ? <a href={f.reportUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">Ver informe</a>
                                : "—"
                              }
                            </td>
                          </tr>
                        );
                      }).filter(Boolean)
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}

        {activeAssets.filter(a => !coveredAssets.includes(a)).map(ticker => (
          <p key={ticker} className="text-xs text-muted-foreground">
            <span className="font-mono font-semibold">{ticker}</span>: Sin datos de analistas institucionales disponibles.
          </p>
        ))}

        {years.filter(y => !coveredYears.includes(y)).length > 0 && (
          <p className="text-xs text-muted-foreground border-t pt-2 mt-2">
            Años sin cobertura externa: {years.filter(y => !coveredYears.includes(y)).join(", ")}. La simulación para estos años se muestra como proyección sin respaldo de previsiones institucionales.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── EURC Reconciliation Section ─────────────────────────────────────────────

function EurcReconciliationSection({ sum }: { sum: ScenarioSummary }) {
  const fmtE = (n: number) => n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  const eurcFreeInitial  = sum.initialEurcFreeEur ?? 0;
  const eurcFiscalInit   = sum.initialEurcFiscalReserveEur ?? 0;
  const eurcInflow       = sum.totalNetEurcInflowEur ?? 0;
  const rebuys           = sum.totalRebuysEur;
  const reinvested       = sum.totalEurcReinvestedEur;
  const eurcFreeFinal    = sum.finalEurcFreeEur;
  const fiscalGenerated  = sum.totalTaxEur;
  const fiscalFinal      = sum.finalFiscalReserveEur;

  const computedFree = eurcFreeInitial + eurcInflow - rebuys - reinvested;
  const diffFree     = eurcFreeFinal - computedFree;
  const computedFiscal = eurcFiscalInit + fiscalGenerated;
  const diffFiscal     = fiscalFinal - computedFiscal;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conciliación EURC</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Verificación de saldo EURC libre y reserva fiscal durante toda la simulación. La diferencia debe ser ≤ 0,01 € (redondeo).
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">EURC libre</p>
          <table className="w-full text-xs">
            <tbody>
              <tr><td className="py-0.5">EURC libre inicial</td><td className="text-right font-mono">{fmtE(eurcFreeInitial)}</td></tr>
              <tr className="text-gain"><td className="py-0.5">+ EURC neto de ventas</td><td className="text-right font-mono">+{fmtE(eurcInflow)}</td></tr>
              <tr className="text-loss"><td className="py-0.5">− Recompras (comisión incl.)</td><td className="text-right font-mono">−{fmtE(rebuys)}</td></tr>
              <tr className="text-loss"><td className="py-0.5">− Reinversión residual (comisión incl.)</td><td className="text-right font-mono">−{fmtE(reinvested)}</td></tr>
              <tr className="border-t border-border/40"><td className="py-0.5 font-semibold">= EURC libre calculado</td><td className="text-right font-mono font-semibold">{fmtE(computedFree)}</td></tr>
              <tr><td className="py-0.5">EURC libre final (motor)</td><td className="text-right font-mono">{fmtE(eurcFreeFinal)}</td></tr>
              <tr className={`font-semibold ${Math.abs(diffFree) < 0.02 ? "text-gain" : "text-loss"}`}>
                <td className="py-0.5">Diferencia</td>
                <td className="text-right font-mono">{fmtE(diffFree)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Reserva fiscal</p>
          <table className="w-full text-xs">
            <tbody>
              <tr><td className="py-0.5">Reserva fiscal inicial</td><td className="text-right font-mono">{fmtE(eurcFiscalInit)}</td></tr>
              <tr className="text-gain"><td className="py-0.5">+ Reserva generada por ventas</td><td className="text-right font-mono">+{fmtE(fiscalGenerated)}</td></tr>
              <tr className="border-t border-border/40"><td className="py-0.5 font-semibold">= Reserva calculada</td><td className="text-right font-mono font-semibold">{fmtE(computedFiscal)}</td></tr>
              <tr><td className="py-0.5">Reserva final (motor)</td><td className="text-right font-mono">{fmtE(fiscalFinal)}</td></tr>
              <tr className={`font-semibold ${Math.abs(diffFiscal) < 0.02 ? "text-gain" : "text-loss"}`}>
                <td className="py-0.5">Diferencia</td>
                <td className="text-right font-mono">{fmtE(diffFiscal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function Perspectivas() {
  const [selectedScenario, setSelectedScenario] = useState<SimScenario>("base");
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  const { data: simData, isLoading, error, isFetching } = useQuery<PerspectivesSimulation>({
    queryKey: ["persp2:getSimulation", END_YEAR],
    queryFn: async () => {
      const result = await window.cryptoControl.persp2.getSimulation({ horizonYears: HORIZON_YEARS }) as { ok: boolean; data?: unknown; error?: { message?: string } };
      if (!result.ok) throw new Error(result.error?.message ?? "Error en la simulación");
      const sim = result.data as PerspectivesSimulation;
      return sim;
    },
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  const activeScenario = useMemo(
    () => simData?.scenarios.find(s => s.scenario === selectedScenario),
    [simData, selectedScenario],
  );

  const years = useMemo(
    () => activeScenario?.annualSnapshots.map(s => s.year) ?? [],
    [activeScenario],
  );

  const effectiveYear = useMemo(() => {
    if (selectedYear != null && years.includes(selectedYear)) return selectedYear;
    return years[years.length - 1] ?? null;
  }, [selectedYear, years]);

  const selectedSnap = useMemo(
    () => activeScenario?.annualSnapshots.find(s => s.year === effectiveYear) ?? null,
    [activeScenario, effectiveYear],
  );

  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto">
        <PageToolbar title="Perspectivas" />
        <div className="p-4"><LoadingState message="Calculando simulación de perspectivas..." /></div>
      </div>
    );
  }

  if (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("No hay un plan de inversión activo")) {
      return (
        <div className="flex-1 overflow-y-auto">
          <PageToolbar title="Perspectivas" />
          <div className="p-4">
            <EmptyState
              icon={<ChartNoAxesCombined />}
              title="Sin plan de inversión"
              description="Crea un plan de inversión activo en la sección Plan para ver las perspectivas de evolución."
            />
          </div>
        </div>
      );
    }
    return (
      <div className="flex-1 overflow-y-auto">
        <PageToolbar title="Perspectivas" />
        <div className="p-4"><ErrorState message={msg} /></div>
      </div>
    );
  }

  if (!simData || !activeScenario) {
    return (
      <div className="flex-1 overflow-y-auto">
        <PageToolbar title="Perspectivas" />
        <div className="p-4">
          <EmptyState icon={<ChartNoAxesCombined />} title="Sin datos" description="No hay datos de simulación disponibles." />
        </div>
      </div>
    );
  }

  const sum = activeScenario.summary;
  const beneficioNetoEur = sum.finalNetWealthEur - sum.initialWealthEur - sum.totalContributionsEur;

  return (
    <div className="flex-1 overflow-y-auto">
      <PageToolbar
        title="Perspectivas"
        actions={
          <div className="flex items-center gap-2">
            {isFetching && <span className="text-xs text-muted-foreground">Calculando…</span>}
            <span className="text-xs text-muted-foreground">
              {new Date(simData.computedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        }
      />

      <div className="persp-page">

        {/* ── BLOQUE 1: Cabecera y controles ── */}
        <div className="persp-controls">
          <div className="persp-horizon-info">
            Horizonte · {CURRENT_YEAR}–{END_YEAR} · {HORIZON_YEARS} años
          </div>
          <ScenarioSelector value={selectedScenario} onChange={setSelectedScenario} />
          <p className="persp-controls-hint">
            Las aportaciones y reglas EURC se aplican por ciclo según las fechas configuradas en el Plan. El motor simula el cambio de ciclo automáticamente.
          </p>
        </div>

        {/* ── BLOQUE 2: Tarjeta principal de patrimonio ── */}
        <div className="persp-hero">
          <div className="persp-hero-main">
            <div className="persp-hero-label">Patrimonio neto estimado</div>
            <div className="persp-hero-value">{fmt(sum.finalNetWealthEur)}</div>
            <div className="persp-hero-meta">
              <span>{SCENARIO_LABELS[selectedScenario]}</span>
              <span aria-hidden="true">·</span>
              <span>Horizonte {CURRENT_YEAR}–{END_YEAR}</span>
            </div>
          </div>
          <div className="persp-hero-metrics">
            <div className="persp-hero-metric">
              <span>Patrimonio inicial</span>
              <strong>{fmt(sum.initialWealthEur)}</strong>
            </div>
            <div className="persp-hero-metric">
              <span>Capital aportado</span>
              <strong>{fmt(sum.totalContributionsEur)}</strong>
            </div>
            <div className="persp-hero-metric">
              <span>Beneficio neto estimado</span>
              <strong className={beneficioNetoEur >= 0 ? "pos" : "neg"}>{fmtSign(beneficioNetoEur)}</strong>
            </div>
            {sum.finalFiscalReserveEur > 0 && (
              <div className="persp-hero-metric">
                <span>Patrimonio bruto</span>
                <strong>{fmt(sum.finalNetWealthEur + sum.finalFiscalReserveEur)}</strong>
              </div>
            )}
          </div>
        </div>

        {/* ── BLOQUE 3: Métricas financieras secundarias (3 grupos) ── */}
        <div className="persp-groups">

          <div className="persp-group">
            <div className="persp-group-title">Rentabilidad y riesgo</div>
            <div className="persp-group-rows">
              {sum.twr != null && (
                <div className="persp-group-row">
                  <span>TWR acumulado</span>
                  <strong className={sum.twr >= 0 ? "pos" : "neg"}>{fmtAnnualPct(sum.twr * 100)}</strong>
                </div>
              )}
              <div className="persp-group-row">
                <span>XIRR anual</span>
                <strong className={(sum.xirr ?? 0) >= 0 ? "pos" : "neg"}>{fmtPct(sum.xirr)}</strong>
              </div>
              {sum.maxDrawdownPct != null && (
                <div className="persp-group-row">
                  <span>Drawdown máximo</span>
                  <strong className="neg">−{(sum.maxDrawdownPct * 100).toFixed(1)}%</strong>
                </div>
              )}
            </div>
          </div>

          <div className="persp-group">
            <div className="persp-group-title">Gestión de ciclos</div>
            <div className="persp-group-rows">
              <div className="persp-group-row">
                <span>Ventas simuladas</span>
                <strong>{sum.totalSalesEur > 0 ? fmt(sum.totalSalesEur) : "—"}</strong>
              </div>
              <div className="persp-group-row">
                <span>Recompras simuladas</span>
                <strong>{sum.totalRebuysEur > 0 ? fmt(sum.totalRebuysEur) : "—"}</strong>
              </div>
              <div className="persp-group-row">
                <span>Reinversión EURC</span>
                <strong>{sum.totalEurcReinvestedEur > 0 ? fmt(sum.totalEurcReinvestedEur) : "—"}</strong>
              </div>
            </div>
          </div>

          <div className="persp-group">
            <div className="persp-group-title">Fiscalidad y liquidez</div>
            <div className="persp-group-rows">
              <div className="persp-group-row">
                <span>Impuesto estimado</span>
                <strong className={sum.totalTaxEur > 0 ? "warn" : ""}>{sum.totalTaxEur > 0 ? fmt(sum.totalTaxEur) : "—"}</strong>
              </div>
              <div className="persp-group-row">
                <span>Reserva fiscal final</span>
                <strong className={sum.finalFiscalReserveEur > 0 ? "warn" : ""}>{sum.finalFiscalReserveEur > 0 ? fmt(sum.finalFiscalReserveEur) : "—"}</strong>
              </div>
              <div className="persp-group-row">
                <span>EURC libre final</span>
                <strong>{sum.finalEurcFreeEur > 0 ? fmt(sum.finalEurcFreeEur) : "—"}</strong>
              </div>
            </div>
          </div>

        </div>

        {/* ── BLOQUE 4: Selector anual + Detalle ── */}
        <Card>
          <CardHeader>
            <CardTitle>Resumen de {effectiveYear ?? "—"}</CardTitle>
            <div className="mt-3">
              <YearStrip
                years={years}
                selected={effectiveYear ?? years[0]}
                onSelect={y => setSelectedYear(y)}
              />
            </div>
          </CardHeader>
          <CardContent>
            {selectedSnap && <YearDetail snap={selectedSnap} />}
          </CardContent>
        </Card>

        {/* ── BLOQUE 5: Secciones desplegables ── */}
        <CollapsibleSection title={`Tabla anual completa — ${SCENARIO_LABELS[selectedScenario]}`}>
          <AnnualTable snapshots={activeScenario.annualSnapshots} />
        </CollapsibleSection>

        <CollapsibleSection title="Evolución del patrimonio (5 escenarios)">
          <EvolutionChart simData={simData} />
        </CollapsibleSection>

        <CollapsibleSection title="Previsiones externas de analistas">
          <AnalystForecastSection
            years={years}
            activeAssets={[...new Set([
              ...Object.keys(activeScenario.assetPriceInfo ?? {}),
              ...activeScenario.annualSnapshots.flatMap(s => Object.keys(s.positions ?? {})),
            ]).values()].filter(a => a !== "EURC" && a !== "EUR")}
          />
        </CollapsibleSection>

        <CollapsibleSection title="Conciliación EURC">
          <EurcReconciliationSection sum={sum} />
        </CollapsibleSection>

      </div>
    </div>
  );
}
