import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChartNoAxesCombined, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { PageToolbar } from "../components/PageToolbar";
import { formatMoney, formatPercent } from "../lib/format";

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
  fiscalReserveEur: number;
  eurcFreeEur: number;
  eurCashEur: number;
  annualReturnPct: number | null;
  positions: Record<string, AnnualAssetPosition>;
  events: SimEvent[];
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
  xirr: number | null;
  maxDrawdownPct: number | null;
}

interface ScenarioResult {
  scenario: SimScenario;
  label: string;
  annualSnapshots: AnnualSnapshot[];
  summary: ScenarioSummary;
}

interface ValidationResult {
  rule: string;
  passed: boolean;
  detail: string;
}

interface PerspectivesSimulation {
  computedAt: number;
  startYear: number;
  endYear: number;
  horizonDate: number;
  scenarios: ScenarioResult[];
  validations: ValidationResult[];
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
const SCENARIO_COLORS: Record<SimScenario, string> = {
  conservador: "#ef4444",
  moderado:    "#f97316",
  base:        "#eab308",
  favorable:   "#22c55e",
  optimista:   "#3b82f6",
};
const HORIZON_OPTIONS = [3, 5, 7, 10, 15, 20];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  return formatMoney(v) ?? "—";
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

function fmtSign(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${formatMoney(v)}`;
}

function eventTypeLabel(type: string): string {
  const map: Record<string, string> = {
    purchase: "Compra", sale: "Venta", rebuy: "Recompra",
    reinvestment: "Reinversión", tax_reserve: "Reserva fiscal",
    goal_reached: "Objetivo alcanzado", asset_deteriorated: "Deterioro",
    asset_failed: "Activo fallido", substitution: "Sustitución",
    strategy_revision: "Revisión estrategia", cycle_change: "Cambio de ciclo",
    contribution: "Aportación",
  };
  return map[type] ?? type;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function HorizonSelector({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-sm text-muted-foreground mr-1">Horizonte:</span>
      {HORIZON_OPTIONS.map(y => (
        <button
          key={y}
          onClick={() => onChange(y)}
          className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
            value === y
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          {y}a
        </button>
      ))}
    </div>
  );
}

function YearSelector({
  years,
  selected,
  onSelect,
}: {
  years: number[];
  selected: number;
  onSelect: (y: number) => void;
}) {
  const idx = years.indexOf(selected);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={() => idx > 0 && onSelect(years[idx - 1])}
        disabled={idx <= 0}
        className="p-1 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label="Año anterior"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      <div className="flex gap-1 flex-wrap">
        {years.map(y => (
          <button
            key={y}
            onClick={() => onSelect(y)}
            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
              y === selected
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {y}
          </button>
        ))}
      </div>

      <button
        onClick={() => idx < years.length - 1 && onSelect(years[idx + 1])}
        disabled={idx >= years.length - 1}
        className="p-1 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label="Año siguiente"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

function ScenarioTabs({
  active,
  onSelect,
}: {
  active: SimScenario;
  onSelect: (s: SimScenario) => void;
}) {
  return (
    <div className="flex gap-1 flex-wrap">
      {SCENARIOS.map(s => (
        <button
          key={s}
          onClick={() => onSelect(s)}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
            s === active
              ? "text-white"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
          style={s === active ? { backgroundColor: SCENARIO_COLORS[s] } : {}}
        >
          {SCENARIO_LABELS[s]}
        </button>
      ))}
    </div>
  );
}

// ─── Annual summary table ─────────────────────────────────────────────────────

function AnnualTable({ snapshots }: { snapshots: AnnualSnapshot[] }) {
  if (snapshots.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="text-left py-2 pr-3 font-medium">Año</th>
            <th className="text-right py-2 px-2 font-medium">Apertura</th>
            <th className="text-right py-2 px-2 font-medium">Aportaciones</th>
            <th className="text-right py-2 px-2 font-medium">Resultado mercado</th>
            <th className="text-right py-2 px-2 font-medium">Ventas</th>
            <th className="text-right py-2 px-2 font-medium">Recompras</th>
            <th className="text-right py-2 px-2 font-medium">Comisiones</th>
            <th className="text-right py-2 px-2 font-medium">Impuesto</th>
            <th className="text-right py-2 px-2 font-medium">Cierre</th>
            <th className="text-right py-2 pl-2 font-medium">Rentab.</th>
          </tr>
        </thead>
        <tbody>
          {snapshots.map(s => (
            <tr key={s.year} className={`border-b border-border/50 hover:bg-muted/30 ${s.scope === "extrapol" ? "opacity-70 italic" : ""}`}>
              <td className="py-2 pr-3 font-medium">
                {s.year}
                {s.scope === "extrapol" && <span className="ml-1 text-xs text-muted-foreground">*</span>}
              </td>
              <td className="text-right py-2 px-2">{fmt(s.openingWealthEur)}</td>
              <td className="text-right py-2 px-2 text-blue-500">{fmt(s.contributionsEur)}</td>
              <td className={`text-right py-2 px-2 ${(s.marketGainEur ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                {fmtSign(s.marketGainEur)}
              </td>
              <td className="text-right py-2 px-2 text-amber-500">{s.salesEur > 0 ? fmt(s.salesEur) : "—"}</td>
              <td className="text-right py-2 px-2 text-cyan-500">{s.rebuysEur > 0 ? fmt(s.rebuysEur) : "—"}</td>
              <td className="text-right py-2 px-2 text-muted-foreground">{s.commissionsEur > 0 ? fmt(s.commissionsEur) : "—"}</td>
              <td className="text-right py-2 px-2 text-muted-foreground">{s.taxEur > 0 ? fmt(s.taxEur) : "—"}</td>
              <td className="text-right py-2 px-2 font-semibold">{fmt(s.closingWealthEur)}</td>
              <td className={`text-right py-2 pl-2 font-medium ${(s.annualReturnPct ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                {s.annualReturnPct != null ? `${s.annualReturnPct >= 0 ? "+" : ""}${s.annualReturnPct.toFixed(1)}%` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border font-semibold text-sm">
            <td className="py-2 pr-3">Total</td>
            <td className="text-right py-2 px-2">{fmt(snapshots[0]?.openingWealthEur)}</td>
            <td className="text-right py-2 px-2 text-blue-500">{fmt(snapshots.reduce((s, r) => s + r.contributionsEur, 0))}</td>
            <td className={`text-right py-2 px-2 ${snapshots.reduce((s, r) => s + r.marketGainEur, 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
              {fmtSign(snapshots.reduce((s, r) => s + r.marketGainEur, 0))}
            </td>
            <td className="text-right py-2 px-2 text-amber-500">{fmt(snapshots.reduce((s, r) => s + r.salesEur, 0))}</td>
            <td className="text-right py-2 px-2 text-cyan-500">{fmt(snapshots.reduce((s, r) => s + r.rebuysEur, 0))}</td>
            <td className="text-right py-2 px-2 text-muted-foreground">{fmt(snapshots.reduce((s, r) => s + r.commissionsEur, 0))}</td>
            <td className="text-right py-2 px-2 text-muted-foreground">{fmt(snapshots.reduce((s, r) => s + r.taxEur, 0))}</td>
            <td className="text-right py-2 px-2">{fmt(snapshots.at(-1)?.closingWealthEur)}</td>
            <td className="text-right py-2 pl-2"></td>
          </tr>
        </tfoot>
      </table>
      <p className="text-xs text-muted-foreground mt-1">* Años extrapolados fuera del plan explícito</p>
    </div>
  );
}

// ─── Year detail section ──────────────────────────────────────────────────────

function YearDetail({ snap }: { snap: AnnualSnapshot }) {
  const positions = Object.values(snap.positions).filter(p => p.balance > 0 || p.failed);

  return (
    <div className="space-y-4">
      {/* Asset positions */}
      {positions.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2">Posiciones a cierre de {snap.year}</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-1.5 pr-2 font-medium">Activo</th>
                  <th className="text-right py-1.5 px-2 font-medium">Saldo</th>
                  <th className="text-right py-1.5 px-2 font-medium">Precio</th>
                  <th className="text-right py-1.5 px-2 font-medium">Valor</th>
                  <th className="text-right py-1.5 px-2 font-medium">G/P lat.</th>
                  <th className="text-right py-1.5 pl-2 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {positions.map(p => (
                  <tr key={p.assetId} className="border-b border-border/40 hover:bg-muted/20">
                    <td className="py-1.5 pr-2 font-mono font-medium text-xs">{p.assetId.toUpperCase()}</td>
                    <td className="text-right py-1.5 px-2 font-mono">{p.balance.toPrecision(4)}</td>
                    <td className="text-right py-1.5 px-2">{fmt(p.priceEur)}</td>
                    <td className="text-right py-1.5 px-2 font-medium">{fmt(p.valueEur)}</td>
                    <td className={`text-right py-1.5 px-2 ${(p.unrealizedGainEur ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {p.unrealizedGainEur != null ? fmtSign(p.unrealizedGainEur) : "—"}
                    </td>
                    <td className="text-right py-1.5 pl-2 text-muted-foreground">
                      {p.failed ? "Fallido" : p.goalReached ? "Objetivo" : "Activo"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Treasury balances */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-muted/30 rounded-lg p-3">
          <div className="text-xs text-muted-foreground">EURC libre</div>
          <div className="font-medium text-sm mt-0.5">{fmt(snap.eurcFreeEur)}</div>
        </div>
        <div className="bg-muted/30 rounded-lg p-3">
          <div className="text-xs text-muted-foreground">Reserva fiscal</div>
          <div className="font-medium text-sm mt-0.5">{fmt(snap.fiscalReserveEur)}</div>
        </div>
        <div className="bg-muted/30 rounded-lg p-3">
          <div className="text-xs text-muted-foreground">Cash EUR</div>
          <div className="font-medium text-sm mt-0.5">{fmt(snap.eurCashEur)}</div>
        </div>
      </div>

      {/* Events */}
      {snap.events.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2">Eventos del año ({snap.events.length})</h4>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {snap.events.map((ev, i) => (
              <div key={i} className="flex items-start gap-2 text-xs py-1 border-b border-border/30">
                <span className="text-muted-foreground shrink-0 font-mono">
                  {new Date(ev.date).toLocaleDateString("es-ES", { month: "short", year: "numeric" })}
                </span>
                <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs ${
                  ev.type === "sale" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" :
                  ev.type === "rebuy" ? "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-400" :
                  ev.type === "purchase" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" :
                  ev.type === "asset_failed" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400" :
                  ev.type === "goal_reached" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" :
                  "bg-muted text-muted-foreground"
                }`}>
                  {eventTypeLabel(ev.type)}
                </span>
                <span className="text-foreground/80 leading-tight">{ev.description}</span>
                {ev.amountEur != null && (
                  <span className="ml-auto shrink-0 font-medium">{fmt(ev.amountEur)}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Scenario comparison table ────────────────────────────────────────────────

function ScenarioComparison({ simData }: { simData: PerspectivesSimulation }) {
  const { scenarios } = simData;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-muted-foreground text-xs">
            <th className="text-left py-2 pr-3 font-medium">Escenario</th>
            <th className="text-right py-2 px-2 font-medium">Patrimonio final</th>
            <th className="text-right py-2 px-2 font-medium">Ganancia mercado</th>
            <th className="text-right py-2 px-2 font-medium">Aportaciones</th>
            <th className="text-right py-2 px-2 font-medium">Comisiones</th>
            <th className="text-right py-2 px-2 font-medium">Impuesto</th>
            <th className="text-right py-2 px-2 font-medium">XIRR</th>
            <th className="text-right py-2 pl-2 font-medium">Drawdown máx.</th>
          </tr>
        </thead>
        <tbody>
          {scenarios.map(s => (
            <tr key={s.scenario} className="border-b border-border/50 hover:bg-muted/30">
              <td className="py-2 pr-3">
                <span
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium text-white"
                  style={{ backgroundColor: SCENARIO_COLORS[s.scenario] }}
                >
                  {s.label}
                </span>
              </td>
              <td className="text-right py-2 px-2 font-semibold">{fmt(s.summary.finalNetWealthEur)}</td>
              <td className={`text-right py-2 px-2 ${(s.summary.totalMarketGainEur ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                {fmtSign(s.summary.totalMarketGainEur)}
              </td>
              <td className="text-right py-2 px-2 text-blue-500">{fmt(s.summary.totalContributionsEur)}</td>
              <td className="text-right py-2 px-2 text-muted-foreground">{fmt(s.summary.totalCommissionsEur)}</td>
              <td className="text-right py-2 px-2 text-muted-foreground">{fmt(s.summary.totalTaxEur)}</td>
              <td className="text-right py-2 px-2 font-medium">
                {s.summary.xirr != null ? fmtPct(s.summary.xirr) : "—"}
              </td>
              <td className="text-right py-2 pl-2 text-red-500">
                {s.summary.maxDrawdownPct != null ? `${(s.summary.maxDrawdownPct * 100).toFixed(1)}%` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Evolution chart (simple SVG bar chart per year) ─────────────────────────

function EvolutionChart({ simData }: { simData: PerspectivesSimulation }) {
  const years = simData.scenarios[0]?.annualSnapshots.map(s => s.year) ?? [];
  if (years.length === 0) return null;

  const allValues = simData.scenarios.flatMap(sc =>
    sc.annualSnapshots.map(s => s.closingWealthEur)
  );
  const maxVal = Math.max(...allValues, 1);

  const W = 600;
  const H = 200;
  const PAD = { top: 10, right: 10, bottom: 30, left: 60 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const xStep = chartW / Math.max(years.length - 1, 1);

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 320, maxWidth: 700 }}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(t => {
          const y = PAD.top + chartH * (1 - t);
          return (
            <g key={t}>
              <line x1={PAD.left} x2={PAD.left + chartW} y1={y} y2={y} stroke="#e5e7eb" strokeWidth={0.5} />
              <text x={PAD.left - 4} y={y + 4} textAnchor="end" fontSize={8} fill="#9ca3af">
                {(maxVal * t / 1000).toFixed(0)}k
              </text>
            </g>
          );
        })}

        {/* Year labels */}
        {years.map((yr, i) => (
          <text key={yr} x={PAD.left + i * xStep} y={H - 6} textAnchor="middle" fontSize={8} fill="#9ca3af">
            {yr}
          </text>
        ))}

        {/* Lines per scenario */}
        {simData.scenarios.map(sc => {
          const pts = sc.annualSnapshots.map((s, i) => [
            PAD.left + i * xStep,
            PAD.top + chartH * (1 - s.closingWealthEur / maxVal),
          ]);
          const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
          return (
            <path key={sc.scenario} d={d} fill="none" stroke={SCENARIO_COLORS[sc.scenario]} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          );
        })}

        {/* Legend */}
        {simData.scenarios.map((sc, i) => (
          <g key={sc.scenario}>
            <rect x={PAD.left + i * 80} y={H - 14} width={6} height={6} fill={SCENARIO_COLORS[sc.scenario]} rx={1} />
            <text x={PAD.left + i * 80 + 9} y={H - 8} fontSize={7} fill="#6b7280">{sc.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ─── Validations ──────────────────────────────────────────────────────────────

function Validations({ items }: { items: ValidationResult[] }) {
  const failed = items.filter(v => !v.passed);
  if (failed.length === 0) return null;

  return (
    <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
      <p className="text-sm font-medium text-amber-800 dark:text-amber-400 mb-2">Advertencias de validación</p>
      <ul className="space-y-1">
        {failed.map((v, i) => (
          <li key={i} className="text-xs text-amber-700 dark:text-amber-400">
            {v.rule}: {v.detail}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function Perspectivas() {
  const [horizonYears, setHorizonYears] = useState(10);
  const [selectedScenario, setSelectedScenario] = useState<SimScenario>("base");
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [showChart, setShowChart] = useState(true);

  const { data: rawData, isLoading, error, isFetching } = useQuery({
    queryKey: ["persp2:getSimulation", horizonYears],
    queryFn: async () => {
      const result = await window.cryptoControl.persp2.getSimulation({ horizonYears });
      if (!result.success) throw new Error(result.error ?? "Error en la simulación");
      return result.data as PerspectivesSimulation;
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const simData = rawData as PerspectivesSimulation | undefined;

  const activeScenario = useMemo(
    () => simData?.scenarios.find(s => s.scenario === selectedScenario),
    [simData, selectedScenario]
  );

  const years = useMemo(
    () => activeScenario?.annualSnapshots.map(s => s.year) ?? [],
    [activeScenario]
  );

  const effectiveYear = useMemo(() => {
    if (selectedYear != null && years.includes(selectedYear)) return selectedYear;
    return years[years.length - 1] ?? null;
  }, [selectedYear, years]);

  const selectedSnap = useMemo(
    () => activeScenario?.annualSnapshots.find(s => s.year === effectiveYear) ?? null,
    [activeScenario, effectiveYear]
  );

  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto">
        <PageToolbar title="Perspectivas" icon={ChartNoAxesCombined} />
        <div className="p-4">
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
          <PageToolbar title="Perspectivas" icon={ChartNoAxesCombined} />
          <div className="p-4">
            <EmptyState
              icon={ChartNoAxesCombined}
              title="Sin plan de inversión"
              description="Crea un plan de inversión activo en la sección Plan para ver las perspectivas de evolución."
            />
          </div>
        </div>
      );
    }
    return (
      <div className="flex-1 overflow-y-auto">
        <PageToolbar title="Perspectivas" icon={ChartNoAxesCombined} />
        <div className="p-4">
          <ErrorState message={msg} />
        </div>
      </div>
    );
  }

  if (!simData || !activeScenario) {
    return (
      <div className="flex-1 overflow-y-auto">
        <PageToolbar title="Perspectivas" icon={ChartNoAxesCombined} />
        <div className="p-4">
          <EmptyState icon={ChartNoAxesCombined} title="Sin datos" description="No hay datos de simulación disponibles." />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <PageToolbar
        title="Perspectivas"
        icon={ChartNoAxesCombined}
        actions={
          <div className="flex items-center gap-2">
            {isFetching && <span className="text-xs text-muted-foreground">Calculando...</span>}
            <span className="text-xs text-muted-foreground">
              {new Date(simData.computedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        }
      />

      <div className="p-4 space-y-4 max-w-6xl mx-auto">
        {/* Horizon + scenario selectors */}
        <Card>
          <CardContent className="pt-4 space-y-3">
            <HorizonSelector value={horizonYears} onChange={y => { setHorizonYears(y); setSelectedYear(null); }} />
            <div className="flex flex-col gap-2">
              <span className="text-sm text-muted-foreground">Escenario:</span>
              <ScenarioTabs active={selectedScenario} onSelect={setSelectedScenario} />
            </div>
          </CardContent>
        </Card>

        {/* Validations */}
        <Validations items={simData.validations} />

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-card border border-border rounded-lg p-3">
            <div className="text-xs text-muted-foreground">Patrimonio inicial</div>
            <div className="font-semibold text-sm mt-0.5">{fmt(activeScenario.summary.initialWealthEur)}</div>
          </div>
          <div className="bg-card border border-border rounded-lg p-3">
            <div className="text-xs text-muted-foreground">Patrimonio final</div>
            <div className="font-semibold text-sm mt-0.5" style={{ color: SCENARIO_COLORS[selectedScenario] }}>
              {fmt(activeScenario.summary.finalNetWealthEur)}
            </div>
          </div>
          <div className="bg-card border border-border rounded-lg p-3">
            <div className="text-xs text-muted-foreground">Ganancia total mercado</div>
            <div className={`font-semibold text-sm mt-0.5 ${(activeScenario.summary.totalMarketGainEur ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
              {fmtSign(activeScenario.summary.totalMarketGainEur)}
            </div>
          </div>
          <div className="bg-card border border-border rounded-lg p-3">
            <div className="text-xs text-muted-foreground">XIRR anual</div>
            <div className="font-semibold text-sm mt-0.5">
              {activeScenario.summary.xirr != null ? fmtPct(activeScenario.summary.xirr) : "—"}
            </div>
          </div>
        </div>

        {/* Year selector — prominent */}
        <Card>
          <CardContent className="pt-4 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-sm font-semibold">Año de detalle</h3>
              {selectedSnap && (
                <span className="text-xs text-muted-foreground">
                  Patrimonio: <span className="font-medium text-foreground">{fmt(selectedSnap.closingWealthEur)}</span>
                  {selectedSnap.annualReturnPct != null && (
                    <span className={`ml-2 font-medium ${selectedSnap.annualReturnPct >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {selectedSnap.annualReturnPct >= 0 ? "+" : ""}{selectedSnap.annualReturnPct.toFixed(1)}%
                    </span>
                  )}
                </span>
              )}
            </div>

            <YearSelector
              years={years}
              selected={effectiveYear ?? years[0]}
              onSelect={y => setSelectedYear(y)}
            />

            {selectedSnap && (
              <button
                onClick={() => setShowDetail(!showDetail)}
                className="text-xs text-primary hover:underline"
              >
                {showDetail ? "Ocultar detalle del año" : "Ver detalle del año"}
              </button>
            )}

            {showDetail && selectedSnap && (
              <div className="border-t border-border pt-4">
                <YearDetail snap={selectedSnap} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Annual table */}
        <Card>
          <CardContent className="pt-4">
            <h3 className="text-sm font-semibold mb-3">Tabla anual — {SCENARIO_LABELS[selectedScenario]}</h3>
            <AnnualTable snapshots={activeScenario.annualSnapshots} />
          </CardContent>
        </Card>

        {/* Evolution chart */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Evolución del patrimonio (5 escenarios)</h3>
              <button
                onClick={() => setShowChart(!showChart)}
                className="text-xs text-primary hover:underline"
              >
                {showChart ? "Ocultar" : "Mostrar"}
              </button>
            </div>
            {showChart && <EvolutionChart simData={simData} />}
          </CardContent>
        </Card>

        {/* Scenario comparison */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Comparación de escenarios</h3>
              <button
                onClick={() => setShowComparison(!showComparison)}
                className="text-xs text-primary hover:underline"
              >
                {showComparison ? "Ocultar" : "Mostrar"}
              </button>
            </div>
            {showComparison && <ScenarioComparison simData={simData} />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
