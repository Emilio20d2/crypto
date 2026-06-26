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
  modelType: "external_direct" | "external_interpolated" | "external_modeled" | "insufficient";
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

// ─── CompactYearNav ──────────────────────────────────────────────────────────

function CompactYearNav({
  years,
  selected,
  onSelect,
}: {
  years: number[];
  selected: number | null;
  onSelect: (y: number) => void;
}) {
  if (!years.length || selected === null) return null;
  const idx = years.indexOf(selected);
  const hasPrev = idx > 0;
  const hasNext = idx < years.length - 1;
  return (
    <div className="persp-year-nav" role="group" aria-label="Año de consulta">
      <button
        type="button"
        className="persp-year-nav-btn"
        onClick={() => hasPrev && onSelect(years[idx - 1])}
        disabled={!hasPrev}
        aria-label="Año anterior"
      >‹</button>
      <span className="persp-year-nav-display" aria-live="polite">{selected}</span>
      <button
        type="button"
        className="persp-year-nav-btn"
        onClick={() => hasNext && onSelect(years[idx + 1])}
        disabled={!hasNext}
        aria-label="Año siguiente"
      >›</button>
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

// ─── Scenario comparison table (replaces the removed evolution chart) ─────────

function ScenarioComparisonTable({
  simData,
  year,
  activeScenario,
  initialWealthEur,
  totalContributionsEur,
}: {
  simData: PerspectivesSimulation;
  year: number | null;
  activeScenario: SimScenario;
  initialWealthEur: number;
  totalContributionsEur: number;
}) {
  if (!year) return null;

  const baseSnap = simData.scenarios.find(s => s.scenario === "base")
    ?.annualSnapshots.find(a => a.year === year);

  const rows = SCENARIOS.map(sc => {
    const result = simData.scenarios.find(s => s.scenario === sc);
    const snap = result?.annualSnapshots.find(a => a.year === year);
    const closing = snap?.closingWealthEur ?? null;
    const capitalIn = initialWealthEur + totalContributionsEur;
    const beneficio = closing != null ? closing - capitalIn : null;
    const vsBas = closing != null && baseSnap ? closing - baseSnap.closingWealthEur : null;
    const coverage = snap?.forecastCoverage ?? "uncovered";
    return { sc, closing, beneficio, vsBas, coverage };
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Comparación de escenarios — {year}</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Patrimonio neto estimado en {year} bajo cada escenario. Diferencia calculada respecto al escenario Base.
        </p>
      </CardHeader>
      <CardContent>
        <div className="responsive-table persp-table">
          <table>
            <thead>
              <tr>
                <th>Escenario</th>
                <th className="num">Patrimonio neto</th>
                <th className="num">Beneficio estimado</th>
                <th className="num">vs Base</th>
                <th>Cobertura</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ sc, closing, beneficio, vsBas, coverage }) => {
                const isActive = sc === activeScenario;
                return (
                  <tr key={sc} style={isActive ? { background: "var(--surface-2, rgba(128,128,128,0.08))", fontWeight: 600 } : {}}>
                    <td>
                      <span style={isActive ? { fontWeight: 700 } : {}}>{SCENARIO_LABELS[sc]}</span>
                      {isActive && <span className="ml-1 text-xs text-muted-foreground">← activo</span>}
                    </td>
                    <td className="num font-mono">{closing != null ? fmt(closing) : "—"}</td>
                    <td className={`num font-mono ${beneficio != null ? (beneficio >= 0 ? "text-gain" : "text-loss") : ""}`}>
                      {beneficio != null ? fmtSign(beneficio) : "—"}
                    </td>
                    <td className={`num font-mono ${vsBas != null && vsBas !== 0 ? (vsBas > 0 ? "text-gain" : "text-loss") : "text-muted-foreground"}`}>
                      {vsBas != null ? (vsBas === 0 ? "Base" : fmtSign(vsBas)) : "—"}
                    </td>
                    <td className="text-xs">
                      {coverage === "covered"
                        ? <span style={{ color: "var(--color-success-text, #2d8a4e)" }}>✓ Cubierto</span>
                        : <span className="text-muted-foreground">⚠ Sin cobertura</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Analyst Forecast Section ────────────────────────────────────────────────

interface AnalystForecast {
  ticker: string; targetYear: number; scenario: string;
  priceUsd: number; priceEur: number | null;
  source: string; reportTitle: string; reportUrl: string;
  publishedAt: string; reviewedAt: string; nextReviewAt: string;
}

function AnalystForecastSection({ years, activeAssets, assetPriceInfo }: {
  years: number[];
  activeAssets: string[];
  assetPriceInfo: Record<string, AssetPriceInfo>;
}) {
  const [expandedAssets, setExpandedAssets] = useState<Set<string>>(new Set());
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
  const uncoveredAssets = activeAssets.filter(a => !coveredAssets.includes(a));
  const coveredYears = years.filter(y => forecasts?.some(f => f.targetYear === y));

  const lastReviewed = forecasts?.reduce((best, f) =>
    !best || f.reviewedAt > best ? f.reviewedAt : best, null as string | null);
  const nextReview = forecasts?.reduce((earliest, f) =>
    !earliest || f.nextReviewAt < earliest ? f.nextReviewAt : earliest, null as string | null);

  const fmtDate = (d: string) => {
    try { return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }); }
    catch { return d; }
  };

  const toggleAsset = (ticker: string) =>
    setExpandedAssets(prev => {
      const n = new Set(prev);
      if (n.has(ticker)) n.delete(ticker);
      else n.add(ticker);
      return n;
    });

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
          Precios objetivo publicados en informes públicos de analistas institucionales.
          Fuentes originales: {new Set(forecasts?.map(f => f.source) ?? []).size} ·
          Activos con cobertura: {coveredAssets.length} ·
          Años con cobertura: {coveredYears.join(", ") || "—"}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {coveredAssets.map(ticker => {
          const assetForecasts = forecasts?.filter(f => f.ticker === ticker) ?? [];
          const assetYears = coveredYears.filter(y => assetForecasts.some(f => f.targetYear === y));
          const info = assetPriceInfo[ticker];
          const sources = [...new Set(assetForecasts.map(f => f.source))];
          const isExpanded = expandedAssets.has(ticker);

          if (assetYears.length === 0) return null;

          return (
            <div key={ticker} style={{ borderTop: "1px solid var(--border-color)", paddingTop: 12 }}>
              {/* Asset header */}
              <div className="flex items-center justify-between gap-4 mb-3 flex-wrap">
                <div>
                  <span className="font-mono font-bold text-sm">{ticker}</span>
                  {info?.currentPriceEur != null && (
                    <span className="ml-3 text-xs text-muted-foreground">
                      Precio actual: <strong className="text-foreground">{fmt(info.currentPriceEur)}</strong>
                    </span>
                  )}
                  {info?.impliedMarketCapBnEur != null && (
                    <span className="ml-3 text-xs text-muted-foreground">
                      Cap. impl. horizonte: <strong className="text-foreground">{info.impliedMarketCapBnEur.toFixed(0)} mil M €</strong>
                    </span>
                  )}
                </div>
                <div className="flex gap-3 text-xs text-muted-foreground flex-wrap">
                  <span>Fuentes: {sources.length}</span>
                  <span>Años: {assetYears.join(", ")}</span>
                  {info?.modelType === "external_direct" && <Badge variant="success">Cobertura directa</Badge>}
                  {info?.modelType === "external_interpolated" && <Badge variant="warning">Interpolado</Badge>}
                  {info?.modelType === "external_modeled" && <Badge variant="neutral">Modelizado</Badge>}
                  {info?.modelType === "insufficient" && <Badge variant="neutral">Sin cobertura</Badge>}
                </div>
              </div>

              {/* Price ranges per year */}
              <div className="responsive-table persp-table mb-2">
                <table>
                  <thead>
                    <tr>
                      <th>Año</th>
                      <th className="num">Conservador</th>
                      <th className="num">Base</th>
                      <th className="num">Optimista</th>
                      <th className="num">Muy alcista</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assetYears.map(year => {
                      const cons = assetForecasts.find(f => f.targetYear === year && (f.scenario === "conservador"));
                      const base = assetForecasts.find(f => f.targetYear === year && f.scenario === "base") ??
                                   assetForecasts.find(f => f.targetYear === year && f.scenario === "medio");
                      const opt  = assetForecasts.find(f => f.targetYear === year && f.scenario === "optimista");
                      const bull = assetForecasts.find(f => f.targetYear === year && f.scenario === "muy_alcista");
                      return (
                        <tr key={year}>
                          <td className="font-mono text-xs font-semibold">{year}</td>
                          <td className="num text-xs">{cons?.priceEur != null ? `${cons.priceEur.toLocaleString("es-ES")} €` : "—"}</td>
                          <td className="num text-xs font-semibold">{base?.priceEur != null ? `${base.priceEur.toLocaleString("es-ES")} €` : "—"}</td>
                          <td className="num text-xs">{opt?.priceEur != null ? `${opt.priceEur.toLocaleString("es-ES")} €` : "—"}</td>
                          <td className="num text-xs text-muted-foreground">{bull?.priceEur != null ? `${bull.priceEur.toLocaleString("es-ES")} €` : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Expandable sources */}
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                onClick={() => toggleAsset(ticker)}
              >
                <span>{isExpanded ? "▾" : "▸"}</span>
                <span>Ver {sources.length} fuente{sources.length !== 1 ? "s" : ""} originales</span>
              </button>
              {isExpanded && (
                <div className="mt-2 space-y-2">
                  {assetForecasts.map((f, i) => (
                    <div key={i} className="text-xs border-l-2 border-border pl-3 py-1">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div>
                          <span className="font-semibold">{f.source}</span>
                          {f.reportTitle && <span className="ml-2 text-muted-foreground">— {f.reportTitle}</span>}
                        </div>
                        <div className="text-muted-foreground text-right">
                          {f.publishedAt && <span>{fmtDate(f.publishedAt)} · </span>}
                          <span className="font-mono font-semibold text-foreground">{f.priceEur != null ? `${f.priceEur.toLocaleString("es-ES")} €` : "—"} ({f.scenario})</span>
                        </div>
                      </div>
                      {f.reportUrl && (
                        <a href={f.reportUrl} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-muted-foreground underline break-all"
                          style={{ wordBreak: "break-all" }}
                        >
                          {f.reportUrl.length > 80 ? f.reportUrl.slice(0, 80) + "…" : f.reportUrl}
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {uncoveredAssets.length > 0 && (
          <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: 12 }}>
            {uncoveredAssets.map(ticker => {
              const info = assetPriceInfo[ticker];
              return (
                <div key={ticker} className="text-xs text-muted-foreground mb-2">
                  <span className="font-mono font-semibold text-foreground">{ticker}</span>
                  {" "}— Sin cobertura externa de analistas institucionales.
                  {info?.currentPriceEur != null && (
                    <span className="ml-1">Precio actual: <strong className="text-foreground">{fmt(info.currentPriceEur)}</strong>.</span>
                  )}
                  {" "}La simulación usa el precio actual como referencia sin proyección.
                </div>
              );
            })}
          </div>
        )}

        {coveredYears.length === 0 && uncoveredAssets.length === activeAssets.length && (
          <p className="text-xs text-muted-foreground">No hay previsiones institucionales verificadas disponibles para los activos del plan.</p>
        )}

        {coveredAssets.length === 0 && (
          <p className="text-xs text-muted-foreground">No hay previsiones verificadas para los activos de este plan en los años seleccionados.</p>
        )}

        {years.filter(y => !coveredYears.includes(y)).length > 0 && (
          <p className="text-xs text-muted-foreground border-t pt-2 mt-2">
            Años sin cobertura externa: <strong>{years.filter(y => !coveredYears.includes(y)).join(", ")}</strong>.
            La simulación para estos años se muestra como proyección sin respaldo institucional.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── News summary placeholder ─────────────────────────────────────────────────

function NewsSummarySection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Noticias relevantes para esta proyección</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Noticias que pueden afectar a los activos y previsiones del plan. Máximo 3 prioritarias.
        </p>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground italic">
          El módulo de noticias financieras está pendiente de integración con una fuente de datos verificada.
          Próximamente se mostrarán noticias reales con impacto identificado por activo.
        </p>
      </CardContent>
    </Card>
  );
}

// ─── EURC Reconciliation Section — contabilidad estructurada ─────────────────

function EurcReconciliationSection({ sum }: { sum: ScenarioSummary }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const fmtE = (n: number) => n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  const fmtRow = (label: string, value: number, sign: "+" | "−" | "=" | "" = "") => ({
    label, value, sign,
  });

  const eurcInitial      = sum.initialEurcFreeEur ?? 0;
  const fiscalInit       = sum.initialEurcFiscalReserveEur ?? 0;
  const eurcInflow       = sum.totalNetEurcInflowEur ?? 0;
  const rebuys           = sum.totalRebuysEur;
  const reinvested       = sum.totalEurcReinvestedEur;
  const eurcFreeFinal    = sum.finalEurcFreeEur;
  const fiscalGenerated  = sum.totalTaxEur;
  const fiscalFinal      = sum.finalFiscalReserveEur;

  // EURC libre: saldo inicial + entradas − salidas = libre calculado
  const eurcComputed = eurcInitial + eurcInflow - rebuys - reinvested;
  const diffFree     = eurcFreeFinal - eurcComputed;

  // Reserva fiscal: inicial + generada = calculada
  const fiscalComputed = fiscalInit + fiscalGenerated;
  const diffFiscal     = fiscalFinal - fiscalComputed;

  const isConciliated = Math.abs(diffFree) < 0.02 && Math.abs(diffFiscal) < 0.02;
  const hasDiscrepancy = Math.abs(diffFree) >= 0.02 || Math.abs(diffFiscal) >= 0.02;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle>Conciliación EURC</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Origen, utilización y saldo disponible de la liquidez generada por ventas.
            </p>
          </div>
          <div>
            {isConciliated && !hasDiscrepancy && (
              <Badge variant="success">Conciliado</Badge>
            )}
            {hasDiscrepancy && (
              <Badge variant="warning">Diferencia pendiente</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* ── Fórmula contable EURC libre ── */}
        <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">EURC libre</p>
        <table className="w-full text-xs mb-4" style={{ borderCollapse: "collapse" }}>
          <tbody>
            {[
              fmtRow("EURC libre inicial",              eurcInitial,   ""),
              fmtRow("+ EURC neto de ventas",           eurcInflow,    "+"),
              fmtRow("− Recompras (comisión incl.)",    rebuys,        "−"),
              fmtRow("− Reinversión residual",          reinvested,    "−"),
            ].map((r, i) => (
              <tr key={i}>
                <td className="py-1 text-muted-foreground">{r.label}</td>
                <td className="py-1 text-right font-mono">
                  {r.sign === "+" ? <span className="text-gain">+{fmtE(r.value)}</span>
                   : r.sign === "−" ? <span className="text-loss">{r.value !== 0 ? `−${fmtE(r.value)}` : fmtE(0)}</span>
                   : fmtE(r.value)}
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: "1px solid var(--border-color)" }}>
              <td className="py-1 font-semibold">= EURC libre calculado</td>
              <td className="py-1 text-right font-mono font-semibold">{fmtE(eurcComputed)}</td>
            </tr>
            <tr>
              <td className="py-1 text-muted-foreground">EURC libre final (motor)</td>
              <td className="py-1 text-right font-mono">{fmtE(eurcFreeFinal)}</td>
            </tr>
            <tr className={Math.abs(diffFree) < 0.02 ? "text-gain" : "text-loss"}>
              <td className="py-1 font-semibold">Diferencia</td>
              <td className="py-1 text-right font-mono font-semibold">{fmtE(diffFree)}</td>
            </tr>
          </tbody>
        </table>

        {/* ── Reserva fiscal ── */}
        <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Reserva fiscal</p>
        <table className="w-full text-xs mb-4" style={{ borderCollapse: "collapse" }}>
          <tbody>
            <tr>
              <td className="py-1 text-muted-foreground">Reserva fiscal inicial</td>
              <td className="py-1 text-right font-mono">{fmtE(fiscalInit)}</td>
            </tr>
            <tr>
              <td className="py-1 text-muted-foreground">+ Reserva generada por ventas</td>
              <td className="py-1 text-right font-mono text-gain">+{fmtE(fiscalGenerated)}</td>
            </tr>
            <tr style={{ borderTop: "1px solid var(--border-color)" }}>
              <td className="py-1 font-semibold">= Reserva calculada</td>
              <td className="py-1 text-right font-mono font-semibold">{fmtE(fiscalComputed)}</td>
            </tr>
            <tr>
              <td className="py-1 text-muted-foreground">Reserva final (motor)</td>
              <td className="py-1 text-right font-mono">{fmtE(fiscalFinal)}</td>
            </tr>
            <tr className={Math.abs(diffFiscal) < 0.02 ? "text-gain" : "text-loss"}>
              <td className="py-1 font-semibold">Diferencia</td>
              <td className="py-1 text-right font-mono font-semibold">{fmtE(diffFiscal)}</td>
            </tr>
          </tbody>
        </table>

        {/* ── Detalle desplegable ── */}
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 mt-1"
          onClick={() => setDetailOpen(v => !v)}
        >
          <span>{detailOpen ? "▾" : "▸"}</span>
          <span>Ver detalle de movimientos EURC</span>
        </button>
        {detailOpen && (
          <div className="mt-3 text-xs space-y-1">
            <div className="flex justify-between py-1 border-b border-border/30">
              <span className="text-muted-foreground">Total recompras simuladas</span>
              <span className="font-mono">{fmtE(rebuys)}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-border/30">
              <span className="text-muted-foreground">Total reinversión residual</span>
              <span className="font-mono">{fmtE(reinvested)}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-border/30">
              <span className="text-muted-foreground">EURC libre final</span>
              <span className="font-mono font-semibold">{fmtE(eurcFreeFinal)}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Reserva fiscal final</span>
              <span className="font-mono font-semibold">{fmtE(fiscalFinal)}</span>
            </div>
            <p className="text-muted-foreground pt-2">
              Diferencia EURC libre: {Math.abs(diffFree) < 0.02 ? "✓ < 0,02 € (redondeo aceptable)" : `⚠ ${fmtE(Math.abs(diffFree))}`}
              {" · "}Diferencia reserva fiscal: {Math.abs(diffFiscal) < 0.02 ? "✓ < 0,02 €" : `⚠ ${fmtE(Math.abs(diffFiscal))}`}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function Perspectivas() {
  const [selectedScenario, setSelectedScenario] = useState<SimScenario>("base");
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  const { data: simData, isLoading, error, isFetching } = useQuery<PerspectivesSimulation>({
    queryKey: ["persp2:getSimulation"],
    queryFn: async () => {
      const result = await window.cryptoControl.persp2.getSimulation({}) as { ok: boolean; data?: unknown; error?: { message?: string } };
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
        <div className="p-4 space-y-4">
          <div className="persp-controls">
            <div className="persp-horizon-info">Calculando horizonte del Plan…</div>
            <ScenarioSelector value={selectedScenario} onChange={setSelectedScenario} />
          </div>
          <LoadingState message="Calculando simulación de perspectivas..." />
        </div>
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
        <div className="p-4 space-y-4">
          <div className="persp-controls">
            <ScenarioSelector value={selectedScenario} onChange={setSelectedScenario} />
          </div>
          <ErrorState message={msg} />
        </div>
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
          <span className="text-xs text-muted-foreground">
            {new Date(simData.computedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
          </span>
        }
      />

      <div className="persp-page">

        {/* ── BLOQUE 1: Cabecera y controles ── */}
        <div className="persp-controls">
          <div className="persp-horizon-info">
            Plan {simData.startYear}–{simData.endYear}
            {isFetching && <span style={{ marginLeft: 8, opacity: 0.6 }}>· Recalculando…</span>}
          </div>
          <div className="persp-controls-row">
            <div className="persp-controls-section">
              <div className="persp-controls-label">Año de consulta</div>
              <CompactYearNav
                years={years}
                selected={effectiveYear}
                onSelect={y => setSelectedYear(y)}
              />
            </div>
            <div className="persp-controls-section">
              <div className="persp-controls-label">Escenario</div>
              <ScenarioSelector value={selectedScenario} onChange={setSelectedScenario} />
            </div>
          </div>
        </div>

        {/* ── BLOQUE 2: Tarjeta principal de patrimonio ── */}
        <div className="persp-hero">
          <div className="persp-hero-main">
            <div className="persp-hero-label">Patrimonio neto estimado</div>
            <div className="persp-hero-value">{fmt(sum.finalNetWealthEur)}</div>
            <div className="persp-hero-meta">
              <span>{SCENARIO_LABELS[selectedScenario]}</span>
              <span aria-hidden="true">·</span>
              <span>Plan {simData.startYear}–{simData.endYear}</span>
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

        {/* ── BLOQUE 5: Comparación compacta de los 5 escenarios (reemplaza la gráfica eliminada) ── */}
        <ScenarioComparisonTable
          simData={simData}
          year={effectiveYear}
          activeScenario={selectedScenario}
          initialWealthEur={sum.initialWealthEur}
          totalContributionsEur={sum.totalContributionsEur}
        />

        {/* ── BLOQUE 6: Secciones desplegables ── */}
        <CollapsibleSection title={`Tabla anual completa — ${SCENARIO_LABELS[selectedScenario]}`}>
          <AnnualTable snapshots={activeScenario.annualSnapshots} />
        </CollapsibleSection>

        <CollapsibleSection title="Previsiones externas de analistas" defaultOpen>
          <AnalystForecastSection
            years={years}
            activeAssets={[...new Set([
              ...Object.keys(activeScenario.assetPriceInfo ?? {}),
              ...activeScenario.annualSnapshots.flatMap(s => Object.keys(s.positions ?? {})),
            ]).values()].filter(a => a !== "EURC" && a !== "EUR")}
            assetPriceInfo={activeScenario.assetPriceInfo ?? {}}
          />
        </CollapsibleSection>

        <CollapsibleSection title="Noticias relevantes para esta proyección">
          <NewsSummarySection />
        </CollapsibleSection>

        <CollapsibleSection title="Conciliación EURC">
          <EurcReconciliationSection sum={sum} />
        </CollapsibleSection>

      </div>
    </div>
  );
}
