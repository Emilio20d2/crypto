import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChartNoAxesCombined } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/Card";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { PageToolbar } from "../components/PageToolbar";
import { SegmentedControl } from "../components/SegmentedControl";
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
  totalEurcReinvestedEur: number;
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
const HORIZON_OPTIONS = [3, 5, 7, 10, 15, 20];

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

// ─── Sub-components ───────────────────────────────────────────────────────────

function YearSelector({
  years,
  selected,
  onSelect,
}: {
  years: number[];
  selected: number;
  onSelect: (y: number) => void;
}) {
  return (
    <div className="fiscal-year-selector" role="group" aria-label="Seleccionar año">
      {years.map(y => (
        <button
          key={y}
          type="button"
          className={`fiscal-year-btn${y === selected ? " fiscal-year-btn--active" : ""}`}
          onClick={() => onSelect(y)}
        >
          {y}
        </button>
      ))}
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
              <tr key={s.year} className={s.scope === "extrapol" ? "opacity-70" : ""}>
                <td>
                  <span style={{ fontWeight: 600 }}>{s.year}</span>
                  {s.scope === "extrapol" && <span className="ml-1 text-xs text-muted-foreground">*</span>}
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
      </p>
    </div>
  );
}

// ─── Year detail section ──────────────────────────────────────────────────────

function YearDetail({ snap }: { snap: AnnualSnapshot }) {
  const [eventsOpen, setEventsOpen] = useState(false);
  const positions = Object.values(snap.positions).filter(p => p.balance > 0 || p.failed);

  return (
    <div className="space-y-3">
      {/* Flujos del año */}
      <div className="persp-kpi-grid">
        <div className="persp-kpi">
          <span className="persp-kpi-label">Apertura neta</span>
          <span className="persp-kpi-value">{fmt(snap.openingWealthEur)}</span>
        </div>
        <div className="persp-kpi">
          <span className="persp-kpi-label">Aportaciones</span>
          <span className="persp-kpi-value">{fmt(snap.contributionsEur)}</span>
        </div>
        <div className={`persp-kpi ${snap.marketGainEur >= 0 ? "kpi-pos" : "kpi-neg"}`}>
          <span className="persp-kpi-label">Resultado mercado</span>
          <span className="persp-kpi-value">{fmtSign(snap.marketGainEur)}</span>
        </div>
        <div className={`persp-kpi ${snap.closingWealthEur >= snap.openingWealthEur ? "kpi-pos" : "kpi-neg"}`}>
          <span className="persp-kpi-label">Cierre neto</span>
          <span className="persp-kpi-value">{fmt(snap.closingWealthEur)}</span>
        </div>
        {snap.annualReturnPct != null && (
          <div className={`persp-kpi ${snap.annualReturnPct >= 0 ? "kpi-pos" : "kpi-neg"}`}>
            <span className="persp-kpi-label">TWR anual</span>
            <span className="persp-kpi-value">{fmtAnnualPct(snap.annualReturnPct)}</span>
          </div>
        )}
        {snap.salesEur > 0 && (
          <div className="persp-kpi kpi-warn">
            <span className="persp-kpi-label">Ventas ⓘ</span>
            <span className="persp-kpi-value">{fmt(snap.salesEur)}</span>
          </div>
        )}
        {snap.rebuysEur > 0 && (
          <div className="persp-kpi kpi-pos">
            <span className="persp-kpi-label">Recompras ⓘ</span>
            <span className="persp-kpi-value">{fmt(snap.rebuysEur)}</span>
          </div>
        )}
        {snap.taxEur > 0 && (
          <div className="persp-kpi kpi-warn">
            <span className="persp-kpi-label">Impuesto</span>
            <span className="persp-kpi-value">{fmt(snap.taxEur)}</span>
          </div>
        )}
      </div>

      {/* Tesorería */}
      {(snap.eurcFreeEur > 0.01 || snap.fiscalReserveEur > 0.01 || snap.eurCashEur > 0.01) && (
        <div className="persp-kpi-grid">
          {snap.eurcFreeEur > 0.01 && (
            <div className="persp-kpi">
              <span className="persp-kpi-label">EURC libre</span>
              <span className="persp-kpi-value">{fmt(snap.eurcFreeEur)}</span>
            </div>
          )}
          {snap.fiscalReserveEur > 0.01 && (
            <div className="persp-kpi kpi-warn">
              <span className="persp-kpi-label">Reserva fiscal</span>
              <span className="persp-kpi-value">{fmt(snap.fiscalReserveEur)}</span>
            </div>
          )}
          {snap.eurCashEur > 0.01 && (
            <div className="persp-kpi">
              <span className="persp-kpi-label">Cash EUR</span>
              <span className="persp-kpi-value">{fmt(snap.eurCashEur)}</span>
            </div>
          )}
        </div>
      )}

      {/* Posiciones compactas */}
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
                    {p.failed && <Badge variant="danger" style={{ marginLeft: 4 }}>Fallido</Badge>}
                    {p.goalReached && <Badge variant="success" style={{ marginLeft: 4 }}>Obj.</Badge>}
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

// ─── Scenario comparison table ────────────────────────────────────────────────

function ScenarioComparison({ simData }: { simData: PerspectivesSimulation }) {
  return (
    <div className="space-y-2">
      <div className="responsive-table persp-table">
        <table>
          <thead>
            <tr>
              <th>Escenario</th>
              <th className="num">Patrimonio final</th>
              <th className="num">Resultado mercado</th>
              <th className="num">Capital aportado</th>
              <th className="num">Ventas ⓘ</th>
              <th className="num">Recompras ⓘ</th>
              <th className="num">Impuesto</th>
              <th className="num">XIRR</th>
              <th className="num">Drawdown máx.</th>
            </tr>
          </thead>
          <tbody>
            {simData.scenarios.map(s => (
              <tr key={s.scenario}>
                <td>
                  <Badge variant={
                    s.scenario === "optimista" ? "success" :
                    s.scenario === "favorable" ? "info" :
                    s.scenario === "base" ? "neutral" :
                    s.scenario === "moderado" ? "warning" : "danger"
                  }>
                    {s.label}
                  </Badge>
                </td>
                <td className="num" style={{ fontWeight: 600 }}>{fmt(s.summary.finalNetWealthEur)}</td>
                <td className={`num ${(s.summary.totalMarketGainEur ?? 0) >= 0 ? "text-gain" : "text-loss"}`}>
                  {fmtSign(s.summary.totalMarketGainEur)}
                </td>
                <td className="num">{fmt(s.summary.totalContributionsEur)}</td>
                <td className="num text-muted-foreground">{s.summary.totalSalesEur > 0 ? fmt(s.summary.totalSalesEur) : "—"}</td>
                <td className="num text-muted-foreground">{s.summary.totalRebuysEur > 0 ? fmt(s.summary.totalRebuysEur) : "—"}</td>
                <td className="num">{s.summary.totalTaxEur > 0 ? fmt(s.summary.totalTaxEur) : "—"}</td>
                <td className={`num ${(s.summary.xirr ?? 0) >= 0 ? "text-gain" : "text-loss"}`}>
                  {fmtPct(s.summary.xirr)}
                </td>
                <td className="num text-loss">
                  {s.summary.maxDrawdownPct != null ? `${(s.summary.maxDrawdownPct * 100).toFixed(1)}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">ⓘ Ventas y Recompras son movimientos internos — no afectan el patrimonio neto de forma directa.</p>
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

// ─── Validations ──────────────────────────────────────────────────────────────

function Validations({ items }: { items: ValidationResult[] }) {
  const failed = items.filter(v => !v.passed);
  if (failed.length === 0) return null;
  return (
    <div className="fiscal-tax-note">
      <p className="text-sm font-medium mb-2">Advertencias de validación</p>
      <ul className="space-y-1">
        {failed.map((v, i) => (
          <li key={i} className="text-xs">{v.rule}: {v.detail}</li>
        ))}
      </ul>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const HORIZON_OPTS = HORIZON_OPTIONS.map(y => ({ value: String(y) as string, label: `${y}a` }));
const SCENARIO_OPTS = SCENARIOS.map(s => ({ value: s as string, label: SCENARIO_LABELS[s] }));

export function Perspectivas() {
  const [horizonYears, setHorizonYears] = useState(10);
  const [selectedScenario, setSelectedScenario] = useState<SimScenario>("base");
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [showComparison, setShowComparison] = useState(false);
  const [showChart, setShowChart] = useState(true);

  const { data: simData, isLoading, error, isFetching } = useQuery<PerspectivesSimulation>({
    queryKey: ["persp2:getSimulation", horizonYears],
    queryFn: async () => {
      const result = await window.cryptoControl.persp2.getSimulation({ horizonYears }) as { ok: boolean; data?: unknown; error?: { message?: string } };
      if (!result.ok) throw new Error(result.error?.message ?? "Error en la simulación");
      return result.data as PerspectivesSimulation;
    },
    staleTime: 5 * 60 * 1000,
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
        <PageToolbar title="Perspectivas" icon={ChartNoAxesCombined} />
        <div className="p-4"><LoadingState message="Calculando simulación de perspectivas..." /></div>
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
        <div className="p-4"><ErrorState message={msg} /></div>
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

  const sum = activeScenario.summary;
  const beneficioNetoEur = sum.finalNetWealthEur - sum.initialWealthEur - sum.totalContributionsEur;
  const lastSnap = activeScenario.annualSnapshots.at(-1);

  return (
    <div className="flex-1 overflow-y-auto">
      <PageToolbar
        title="Perspectivas"
        icon={ChartNoAxesCombined}
        actions={
          <div className="flex items-center gap-2">
            {isFetching && <span className="text-xs text-muted-foreground">Calculando…</span>}
            <span className="text-xs text-muted-foreground">
              {new Date(simData.computedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        }
      />

      <div className="p-4 space-y-6 max-w-6xl mx-auto">

        {/* Selectors */}
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Horizonte</span>
              <SegmentedControl
                value={String(horizonYears)}
                options={HORIZON_OPTS}
                onChange={v => { setHorizonYears(Number(v)); setSelectedYear(null); }}
                label="Horizonte de simulación"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Escenario</span>
              <SegmentedControl
                value={selectedScenario}
                options={SCENARIO_OPTS}
                onChange={v => setSelectedScenario(v as SimScenario)}
                label="Escenario de simulación"
              />
            </div>
          </CardContent>
        </Card>

        {/* Validations */}
        <Validations items={simData.validations} />

        {/* KPI summary */}
        <div className="persp-kpi-grid">
          <div className="persp-kpi">
            <span className="persp-kpi-label">Patrimonio inicial</span>
            <span className="persp-kpi-value">{fmt(sum.initialWealthEur)}</span>
          </div>
          <div className={`persp-kpi ${sum.finalNetWealthEur >= sum.initialWealthEur ? "kpi-pos" : "kpi-neg"}`}>
            <span className="persp-kpi-label">Patrimonio final neto</span>
            <span className="persp-kpi-value">{fmt(sum.finalNetWealthEur)}</span>
          </div>
          <div className="persp-kpi">
            <span className="persp-kpi-label">Capital aportado</span>
            <span className="persp-kpi-value">{fmt(sum.totalContributionsEur)}</span>
          </div>
          <div className={`persp-kpi ${beneficioNetoEur >= 0 ? "kpi-pos" : "kpi-neg"}`}>
            <span className="persp-kpi-label">Beneficio neto est.</span>
            <span className="persp-kpi-value">{fmtSign(beneficioNetoEur)}</span>
          </div>
          <div className={`persp-kpi ${(sum.totalMarketGainEur ?? 0) >= 0 ? "kpi-pos" : "kpi-neg"}`}>
            <span className="persp-kpi-label">Resultado mercado</span>
            <span className="persp-kpi-value">{fmtSign(sum.totalMarketGainEur)}</span>
          </div>
          {sum.totalSalesEur > 0 && (
            <div className="persp-kpi kpi-warn">
              <span className="persp-kpi-label">Ventas parciales ⓘ</span>
              <span className="persp-kpi-value">{fmt(sum.totalSalesEur)}</span>
            </div>
          )}
          {sum.totalRebuysEur > 0 && (
            <div className="persp-kpi kpi-pos">
              <span className="persp-kpi-label">Recompras ⓘ</span>
              <span className="persp-kpi-value">{fmt(sum.totalRebuysEur)}</span>
            </div>
          )}
          {sum.totalTaxEur > 0 && (
            <div className="persp-kpi kpi-warn">
              <span className="persp-kpi-label">Impuesto estimado</span>
              <span className="persp-kpi-value">{fmt(sum.totalTaxEur)}</span>
            </div>
          )}
          {(lastSnap?.fiscalReserveEur ?? 0) > 0 && (
            <div className="persp-kpi kpi-warn">
              <span className="persp-kpi-label">Reserva fiscal</span>
              <span className="persp-kpi-value">{fmt(lastSnap?.fiscalReserveEur)}</span>
            </div>
          )}
          {(lastSnap?.eurcFreeEur ?? 0) > 1 && (
            <div className="persp-kpi">
              <span className="persp-kpi-label">EURC pendiente</span>
              <span className="persp-kpi-value">{fmt(lastSnap?.eurcFreeEur)}</span>
            </div>
          )}
          <div className={`persp-kpi ${(sum.xirr ?? 0) >= 0 ? "kpi-pos" : "kpi-neg"}`}>
            <span className="persp-kpi-label">XIRR anual</span>
            <span className="persp-kpi-value">{fmtPct(sum.xirr)}</span>
          </div>
          {sum.maxDrawdownPct != null && (
            <div className="persp-kpi kpi-neg">
              <span className="persp-kpi-label">Drawdown máx.</span>
              <span className="persp-kpi-value">−{(sum.maxDrawdownPct * 100).toFixed(1)}%</span>
            </div>
          )}
        </div>

        {/* Year selector + detail */}
        <Card>
          <CardHeader>
            <CardTitle>Detalle por año</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <YearSelector
              years={years}
              selected={effectiveYear ?? years[0]}
              onSelect={y => setSelectedYear(y)}
            />
            {selectedSnap && (
              <div className="border-t border-border/50 pt-3">
                <YearDetail snap={selectedSnap} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Annual table */}
        <Card>
          <CardHeader>
            <CardTitle>Tabla anual — {SCENARIO_LABELS[selectedScenario]}</CardTitle>
          </CardHeader>
          <CardContent>
            <AnnualTable snapshots={activeScenario.annualSnapshots} />
          </CardContent>
        </Card>

        {/* Evolution chart */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Evolución del patrimonio (5 escenarios)</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setShowChart(!showChart)}>
                {showChart ? "Ocultar" : "Mostrar"}
              </Button>
            </div>
          </CardHeader>
          {showChart && (
            <CardContent>
              <EvolutionChart simData={simData} />
            </CardContent>
          )}
        </Card>

        {/* Scenario comparison */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Comparación de escenarios</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setShowComparison(!showComparison)}>
                {showComparison ? "Ocultar" : "Mostrar"}
              </Button>
            </div>
          </CardHeader>
          {showComparison && (
            <CardContent>
              <ScenarioComparison simData={simData} />
            </CardContent>
          )}
        </Card>

      </div>
    </div>
  );
}
