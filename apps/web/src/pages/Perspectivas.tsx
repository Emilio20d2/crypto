import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChartNoAxesCombined, Target, TrendingUp, PlusCircle, Trash2,
  AlertCircle, Info, Pencil, CheckCircle2, RefreshCw, AlertTriangle,
} from "lucide-react";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/Card";
import { Input } from "../components/Input";
import { PageToolbar } from "../components/PageToolbar";
import type { PerspectivesGoalType, ProjectionResult, ProjectionScenarioResult } from "@crypto-control/core";

// ─── helpers ────────────────────────────────────────────────────────────────

const api = () => window.cryptoControl;

function fmt(v: number | null | undefined) {
  if (v == null || !isFinite(v)) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
}

function pct(v: number | null | undefined) {
  if (v == null || !isFinite(v)) return "—";
  return `${(v * 100).toFixed(0)}%`;
}

function dateToTs(s: string): number | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function tsToDate(ts: number | null): string {
  if (!ts) return "";
  return new Date(ts).toISOString().slice(0, 10);
}

const SCENARIO_COLORS: Record<string, string> = {
  conservador:   "var(--color-muted-fg)",
  moderado:      "var(--color-info, #60a5fa)",
  base:          "var(--color-primary)",
  favorable:     "#10b981",
  muy_favorable: "#f59e0b",
  optimista:     "var(--color-success)",
  dinamico:      "var(--color-warning)",
};

const SCENARIO_ORDER = [
  "conservador", "moderado", "base", "favorable", "muy_favorable", "optimista", "dinamico",
] as const;

type ActiveScenario = typeof SCENARIO_ORDER[number];

const GOAL_TYPE_LABELS: Record<string, string> = {
  patrimonio: "Patrimonio general",
  vivienda: "Vivienda",
  jubilacion: "Jubilación",
  independencia_financiera: "Independencia financiera",
  capital_objetivo: "Capital objetivo",
  personalizado: "Personalizado",
};

// ─── Goal form ──────────────────────────────────────────────────────────────

interface GoalFormState {
  name: string;
  type: string;
  targetAmountEur: string;
  targetDate: string;
  notes: string;
}

const EMPTY_GOAL_FORM: GoalFormState = {
  name: "", type: "personalizado", targetAmountEur: "", targetDate: "", notes: "",
};

// ─── Main component ─────────────────────────────────────────────────────────

export function Perspectivas() {
  const qc = useQueryClient();

  const currentYear = new Date().getFullYear();
  const [targetYear, setTargetYear] = useState(currentYear + 10);
  const horizonYears = Math.max(1, targetYear - currentYear);
  const [activeScenario, setActiveScenario] = useState<ActiveScenario>("base");
  const [simulationPolicy, setSimulationPolicy] = useState<"plan_base" | "confirmed_only" | "confirmed_plus_proposals" | "full_strategy">("confirmed_plus_proposals");

  const [showGoalForm, setShowGoalForm] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [goalForm, setGoalForm] = useState<GoalFormState>(EMPTY_GOAL_FORM);

  // ── projection query ──────────────────────────────────────────────────────
  const projectionQ = useQuery({
    queryKey: ["perspectives:getProjection", horizonYears, simulationPolicy],
    queryFn: async () => {
      const r = await api().perspectives.getProjection({ horizonYears, simulationPolicy });
      if (!r.ok) throw new Error(r.error?.message ?? "Error al calcular proyección");
      return r.data as ProjectionResult;
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: 1,
  });

  // ── goals query ───────────────────────────────────────────────────────────
  const goalsQ = useQuery({
    queryKey: ["perspectives:getGoals"],
    queryFn: async () => {
      const r = await api().perspectives.getGoals();
      if (!r.ok) throw new Error(r.error?.message ?? "Error");
      return r.data;
    },
    staleTime: 30_000,
  });

  const projectionYears = useMemo(
    () => Array.from({ length: 30 }, (_, index) => currentYear + index + 1),
    [currentYear]
  );

  // ── mutations ─────────────────────────────────────────────────────────────
  const createGoal = useMutation({
    mutationFn: (data: GoalFormState) =>
      api().perspectives.createGoal({
        name: data.name,
        type: data.type as PerspectivesGoalType,
        targetAmountEur: parseFloat(data.targetAmountEur),
        targetDate: dateToTs(data.targetDate),
        notes: data.notes || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["perspectives:getGoals"] });
      setShowGoalForm(false);
      setGoalForm(EMPTY_GOAL_FORM);
    },
  });

  const updateGoal = useMutation({
    mutationFn: ({ id, data }: { id: string; data: GoalFormState }) =>
      api().perspectives.updateGoal(id, {
        name: data.name,
        type: data.type as PerspectivesGoalType,
        targetAmountEur: parseFloat(data.targetAmountEur),
        targetDate: dateToTs(data.targetDate),
        notes: data.notes || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["perspectives:getGoals"] });
      setEditingGoalId(null);
      setGoalForm(EMPTY_GOAL_FORM);
    },
  });

  const deleteGoal = useMutation({
    mutationFn: (id: string) => api().perspectives.deleteGoal(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["perspectives:getGoals"] }),
  });

  // ── derived data ──────────────────────────────────────────────────────────
  const projection = projectionQ.data;
  const activeScenarioData = useMemo<ProjectionScenarioResult | null>(
    () => projection?.scenarios.find(s => s.scenario === activeScenario) ?? null,
    [projection, activeScenario],
  );

  const currentValueEur = projection?.snapshot.currentPortfolioValueEur ?? 0;
  const goalResultById = useMemo(
    () => new Map((activeScenarioData?.goalResults ?? []).map(goal => [goal.id, goal])),
    [activeScenarioData],
  );

  const dataScore = projection?.snapshot.dataQuality.overallScore ?? null;

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <section className="page-stack">
      <PageToolbar
        title="Perspectivas"
        meta="Motor de proyección — simulación hipotética, sin ejecutar operaciones"
      />

      {/* ── Sección 1: Estado del plan ── */}
      <PlanSnapshotSection projection={projection} loading={projectionQ.isLoading} error={projectionQ.error} />

      {/* ── Sección 1b: Libro Mayor de aportaciones ── */}
      {projection && (
        <ContributionLedgerSection
          ledger={projection.contributionLedger}
          ceroScenario={projection.scenarios.find(s => s.scenario === "cero") ?? null}
          wealthFloorViolations={projection.wealthFloorViolations ?? []}
          orderingViolations={projection.orderingViolations ?? []}
        />
      )}

      {/* ── Sección 2: 7 escenarios — selector + tarjeta activa + comparativa ── */}
      <Card>
        <CardHeader>
          <CardTitle>
            <ChartNoAxesCombined size={16} />
            Proyección — 7 escenarios
          </CardTitle>
          <div className="flex gap-2 items-center flex-wrap">
            <label className="text-sm text-muted">Año:</label>
            <select
              className="ui-select"
              style={{ width: 110 }}
              value={targetYear}
              onChange={e => setTargetYear(parseInt(e.target.value))}
            >
              {projectionYears.map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
            <label className="text-sm text-muted">Política:</label>
            <select
              className="ui-select"
              style={{ width: 220 }}
              value={simulationPolicy}
              onChange={e => setSimulationPolicy(e.target.value as typeof simulationPolicy)}
            >
              <option value="plan_base">Plan base (solo aportaciones)</option>
              <option value="confirmed_only">Solo reglas confirmadas</option>
              <option value="confirmed_plus_proposals">Propuestas prudentes</option>
              <option value="full_strategy">Estrategia completa</option>
            </select>
            {projectionQ.isFetching && <RefreshCw size={14} className="animate-spin text-muted" />}
          </div>
        </CardHeader>
        <CardContent>
          {projectionQ.isLoading && <p className="text-muted text-sm">Calculando proyección…</p>}
          {projectionQ.error && (
            <div className="empty-state-inline">
              <AlertCircle size={16} />
              <span>{String(projectionQ.error)}</span>
            </div>
          )}
          {projection && (
            <>
              {/* ── Selector de escenario ── */}
              <div className="perspectives-scenario-selector" role="tablist" aria-label="Escenarios de proyección">
                {SCENARIO_ORDER.map(s => {
                  const sc = projection.scenarios.find(x => x.scenario === s);
                  const color = SCENARIO_COLORS[s];
                  const isActive = activeScenario === s;
                  return (
                    <button
                      key={s}
                      role="tab"
                      aria-selected={isActive}
                      className={`perspectives-scenario-tab${isActive ? " active" : ""}`}
                      style={{ "--scenario-color": color } as React.CSSProperties}
                      onClick={() => setActiveScenario(s)}
                    >
                      <span className="tab-dot" style={{ background: color }} />
                      <span className="tab-label">{sc?.label ?? s}</span>
                      {sc?.probability != null && (
                        <span className="tab-prob">{pct(sc.probability)}</span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* ── Tarjeta del escenario activo ── */}
              {activeScenarioData && (
                <div className="perspectives-active-card" style={{ borderLeftColor: SCENARIO_COLORS[activeScenario] }}>
                  <div className="active-card-header">
                    <div>
                      <h3 className="active-card-title">{activeScenarioData.label}</h3>
                      <p className="text-sm text-muted" style={{ marginTop: 2 }}>
                        {activeScenarioData.description}
                      </p>
                    </div>
                    <div className="active-card-badges">
                      {activeScenarioData.probability != null && (
                        <Badge variant="neutral">Probabilidad: {pct(activeScenarioData.probability)}</Badge>
                      )}
                      {activeScenarioData.confidence != null && (
                        <Badge variant={activeScenarioData.confidence >= 0.6 ? "success" : "warning"}>
                          Confianza: {pct(activeScenarioData.confidence)}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="active-card-metrics">
                    <div className="metric-item">
                      <span className="metric-label">Patrimonio bruto</span>
                      <span className="metric-value">{fmt(activeScenarioData.summary.finalGrossWealthEur)}</span>
                    </div>
                    <div className="metric-item highlight" style={{ borderColor: SCENARIO_COLORS[activeScenario] }}>
                      <span className="metric-label">Patrimonio neto</span>
                      <span className="metric-value">{fmt(activeScenarioData.summary.finalNetWealthEur)}</span>
                    </div>
                    <div className="metric-item">
                      <span className="metric-label">Capital histórico</span>
                      <span className="metric-value">{fmt(activeScenarioData.summary.historicalCapitalEur)}</span>
                    </div>
                    <div className="metric-item">
                      <span className="metric-label">Aportaciones futuras</span>
                      <span className="metric-value">{fmt(activeScenarioData.summary.totalFutureCapitalEur)}</span>
                    </div>
                    <div className="metric-item">
                      <span className="metric-label">Plusvalía realizada</span>
                      <span className={`metric-value ${activeScenarioData.summary.totalRealizedGainEur >= 0 ? "text-success" : "text-danger"}`}>
                        {fmt(activeScenarioData.summary.totalRealizedGainEur)}
                      </span>
                    </div>
                    <div className="metric-item">
                      <span className="metric-label">Plusvalía no realizada</span>
                      <span className={`metric-value ${activeScenarioData.summary.totalUnrealizedGainEur >= 0 ? "text-success" : "text-danger"}`}>
                        {fmt(activeScenarioData.summary.totalUnrealizedGainEur)}
                      </span>
                    </div>
                    <div className="metric-item">
                      <span className="metric-label">Impuesto generado</span>
                      <span className="metric-value text-muted">{fmt(activeScenarioData.summary.totalTaxGeneratedEur)}</span>
                    </div>
                    <div className="metric-item">
                      <span className="metric-label">EURC fiscal reserva</span>
                      <span className="metric-value">{fmt(activeScenarioData.summary.finalFiscalReserveEur)}</span>
                    </div>
                    <div className="metric-item">
                      <span className="metric-label">EURC libre</span>
                      <span className="metric-value">{fmt(activeScenarioData.summary.finalEurcAvailableEur)}</span>
                    </div>
                    <div className="metric-item">
                      <span className="metric-label">Ventas proyectadas</span>
                      {(() => {
                        const totalSales = activeScenarioData.cycleResults.reduce((s, c) => s + c.salesEur, 0);
                        return (
                          <>
                            <span className="metric-value">{fmt(totalSales)}</span>
                            {totalSales === 0 && (activeScenarioData.summary as any).salesZeroExplanation && (
                              <details className="metric-zero-detail">
                                <summary className="metric-zero-summary">¿Por qué 0 €?</summary>
                                <span className="metric-zero-text">{(activeScenarioData.summary as any).salesZeroExplanation}</span>
                              </details>
                            )}
                          </>
                        );
                      })()}
                    </div>
                    <div className="metric-item">
                      <span className="metric-label">Recompras proyectadas</span>
                      {(() => {
                        const totalRebuys = activeScenarioData.cycleResults.reduce((s, c) => s + c.rebuysEur, 0);
                        return (
                          <>
                            <span className="metric-value">{fmt(totalRebuys)}</span>
                            {totalRebuys === 0 && (activeScenarioData.summary as any).rebuysZeroExplanation && (
                              <details className="metric-zero-detail">
                                <summary className="metric-zero-summary">¿Por qué 0 €?</summary>
                                <span className="metric-zero-text">{(activeScenarioData.summary as any).rebuysZeroExplanation}</span>
                              </details>
                            )}
                          </>
                        );
                      })()}
                    </div>
                    {/* Propuestas hipotéticas */}
                    {(activeScenarioData.summary as any).hypotheticalSales?.length > 0 && (
                      <div className="metric-item" style={{ gridColumn: "1 / -1" }}>
                        <span className="metric-label">Ventas hipotéticas simuladas</span>
                        <span className="metric-value text-warning">{(activeScenarioData.summary as any).hypotheticalSales.length} eventos</span>
                        <details className="metric-zero-detail">
                          <summary className="metric-zero-summary">Ver propuestas</summary>
                          <ul style={{ fontSize: "0.75rem", margin: "4px 0 0", paddingLeft: "12px" }}>
                            {(activeScenarioData.summary as any).hypotheticalSales.slice(0, 5).map((p: any) => (
                              <li key={p.id}>
                                {new Date(p.date).toLocaleDateString("es-ES", { year: "numeric", month: "short" })} — {p.assetId}: vender {p.sellPercentage.toFixed(0)}% · {fmt(p.grossEur)} bruto · {p.explanation.slice(0, 80)}
                              </li>
                            ))}
                          </ul>
                        </details>
                      </div>
                    )}
                    {(activeScenarioData.summary as any).hypotheticalRebuys?.length > 0 && (
                      <div className="metric-item" style={{ gridColumn: "1 / -1" }}>
                        <span className="metric-label">Recompras hipotéticas simuladas</span>
                        <span className="metric-value text-info">{(activeScenarioData.summary as any).hypotheticalRebuys.length} eventos</span>
                        <details className="metric-zero-detail">
                          <summary className="metric-zero-summary">Ver propuestas</summary>
                          <ul style={{ fontSize: "0.75rem", margin: "4px 0 0", paddingLeft: "12px" }}>
                            {(activeScenarioData.summary as any).hypotheticalRebuys.slice(0, 5).map((p: any) => (
                              <li key={p.id}>
                                {new Date(p.date).toLocaleDateString("es-ES", { year: "numeric", month: "short" })} — {p.assetId}: {fmt(p.eurcUsedEur)} EURC · caída {p.drawdownPercentage.toFixed(0)}%
                              </li>
                            ))}
                          </ul>
                        </details>
                      </div>
                    )}
                    <div className="metric-item highlight" style={{ borderColor: SCENARIO_COLORS[activeScenario], gridColumn: "1 / -1" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem" }}>
                        <div>
                          <span className="metric-label">XIRR — Rent. personal</span>
                          <span className="metric-value">
                            {(activeScenarioData.summary as any).xirrAnnual != null
                              ? `${(((activeScenarioData.summary as any).xirrAnnual as number) * 100).toFixed(2)}% / año`
                              : "—"}
                          </span>
                          <span className="metric-sub">Flujos reales fechados</span>
                        </div>
                        <div>
                          <span className="metric-label">TWR — Rent. estrategia</span>
                          <span className="metric-value">
                            {(activeScenarioData.summary as any).twrAnnual != null
                              ? `${(((activeScenarioData.summary as any).twrAnnual as number) * 100).toFixed(2)}% / año`
                              : "—"}
                          </span>
                          <span className="metric-sub">Sin efecto de flujos</span>
                        </div>
                        <div>
                          <span className="metric-label">ROI acumulado</span>
                          <span className="metric-value">
                            {(activeScenarioData.summary as any).roiAccumulated != null
                              ? `${(((activeScenarioData.summary as any).roiAccumulated as number) * 100).toFixed(1)}%`
                              : "—"}
                          </span>
                          <span className="metric-sub">Patrimonio / Capital − 1</span>
                        </div>
                      </div>
                      <span className="metric-sub" style={{ display: "block", marginTop: "0.5rem" }}>
                        Horizonte: {horizonYears} años · Neto de impuestos
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Comparativa con controles independientes ── */}
              {activeScenarioData && (
                <div className="perspectives-cycle-table-wrapper" style={{ marginTop: "1rem" }}>
                  <h4 style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem", color: "var(--text-muted)" }}>
                    Controles independientes — Horizonte {horizonYears} años
                  </h4>
                  <table className="perspectives-cycle-table">
                    <thead>
                      <tr>
                        <th>Referencia</th>
                        <th className="text-right">Patrimonio final</th>
                        <th className="text-right">Método</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Control 0% (suelo mínimo)</td>
                        <td className="text-right">{fmt((activeScenarioData.summary as any).controlCeroWealth ?? 0)}</td>
                        <td className="text-right text-muted">Anualidad a 0%</td>
                      </tr>
                      <tr>
                        <td>Control 5% anual</td>
                        <td className="text-right">{fmt((activeScenarioData.summary as any).control5pctWealth ?? 0)}</td>
                        <td className="text-right text-muted">Anualidad a 5%</td>
                      </tr>
                      <tr>
                        <td>Control 7% anual</td>
                        <td className="text-right">{fmt((activeScenarioData.summary as any).control7pctWealth ?? 0)}</td>
                        <td className="text-right text-muted">Anualidad a 7%</td>
                      </tr>
                      <tr style={{ fontWeight: 600, background: `${SCENARIO_COLORS[activeScenario]}22` }}>
                        <td>Escenario {activeScenarioData.label}</td>
                        <td className="text-right">{fmt(activeScenarioData.summary.finalNetWealthEur)}</td>
                        <td className="text-right text-muted">Simulación completa</td>
                      </tr>
                    </tbody>
                  </table>
                  <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.4rem" }}>
                    Controles calculados con fórmula analítica independiente (FV anualidad) ·
                    Aportación media: {fmt(activeScenarioData.summary.totalFutureCapitalEur / Math.max(1, horizonYears * 12))}/mes ·
                    Capital inicial: {fmt(activeScenarioData.summary.initialGrossWealthEur)}
                  </p>
                </div>
              )}

              {/* ── Evolución anual acumulada ── */}
              {activeScenarioData && (activeScenarioData as any).annualBreakdown?.length > 0 && (
                <details style={{ marginTop: "1rem" }}>
                  <summary style={{ cursor: "pointer", fontSize: "0.85rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                    Evolución año a año — {activeScenarioData.label}
                    <span className="text-muted" style={{ fontWeight: 400, marginLeft: "0.5rem" }}>
                      (capital inicial heredado + ganancias acumuladas)
                    </span>
                  </summary>
                  <div className="perspectives-cycle-table-wrapper">
                    <table className="perspectives-cycle-table">
                      <thead>
                        <tr>
                          <th>Año</th>
                          <th className="text-right">Capital heredado</th>
                          <th className="text-right">Aportaciones</th>
                          <th className="text-right">Ganancia mercado</th>
                          <th className="text-right">Ventas</th>
                          <th className="text-right">Recompras</th>
                          <th className="text-right">Impuestos</th>
                          <th className="text-right" style={{ fontWeight: 700 }}>Capital final</th>
                        </tr>
                      </thead>
                      <tbody>
                        {((activeScenarioData as any).annualBreakdown as Array<{
                          year: number;
                          inheritedWealthEur: number;
                          contributionsEur: number;
                          salesEur: number;
                          rebuysEur: number;
                          taxEur: number;
                          marketGainEur: number;
                          endWealthEur: number;
                        }>).map(row => (
                          <tr key={row.year}>
                            <td style={{ fontWeight: 600 }}>{row.year}</td>
                            <td className="text-right text-muted">{fmt(row.inheritedWealthEur)}</td>
                            <td className="text-right">{fmt(row.contributionsEur)}</td>
                            <td className="text-right" style={{ color: row.marketGainEur >= 0 ? "var(--color-success, #10b981)" : "var(--color-negative, #ef4444)", fontWeight: 500 }}>
                              {row.marketGainEur >= 0 ? "+" : ""}{fmt(row.marketGainEur)}
                            </td>
                            <td className="text-right text-muted">{row.salesEur > 0 ? fmt(row.salesEur) : "—"}</td>
                            <td className="text-right text-muted">{row.rebuysEur > 0 ? fmt(row.rebuysEur) : "—"}</td>
                            <td className="text-right text-muted">{row.taxEur > 0 ? fmt(row.taxEur) : "—"}</td>
                            <td className="text-right" style={{ fontWeight: 700, color: SCENARIO_COLORS[activeScenario] }}>{fmt(row.endWealthEur)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ borderTop: "2px solid var(--color-border)", fontWeight: 700 }}>
                          <td>Total</td>
                          <td className="text-right text-muted">—</td>
                          <td className="text-right">{fmt(activeScenarioData.summary.totalFutureCapitalEur)}</td>
                          <td className="text-right" style={{ color: activeScenarioData.summary.estimatedMarketGainEur >= 0 ? "var(--color-success, #10b981)" : "var(--color-negative, #ef4444)" }}>
                            {activeScenarioData.summary.estimatedMarketGainEur >= 0 ? "+" : ""}{fmt(activeScenarioData.summary.estimatedMarketGainEur)}
                          </td>
                          <td className="text-right text-muted">{fmt(activeScenarioData.cycleResults.reduce((a: number, c: any) => a + c.salesEur, 0))}</td>
                          <td className="text-right text-muted">{fmt(activeScenarioData.cycleResults.reduce((a: number, c: any) => a + c.rebuysEur, 0))}</td>
                          <td className="text-right text-muted">{fmt(activeScenarioData.summary.totalTaxGeneratedEur)}</td>
                          <td className="text-right" style={{ color: SCENARIO_COLORS[activeScenario] }}>{fmt(activeScenarioData.summary.finalGrossWealthEur)}</td>
                        </tr>
                      </tfoot>
                    </table>
                    <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.4rem" }}>
                      Capital heredado de cada año = Capital final del año anterior · La ganancia de mercado incluye apreciación de posiciones históricas y nuevas aportaciones ·
                      {simulationPolicy === "confirmed_plus_proposals" || simulationPolicy === "full_strategy"
                        ? " Ventas/recompras incluyen propuestas según analistas."
                        : " Política actual no incluye propuestas hipotéticas."}
                    </p>
                  </div>
                </details>
              )}

              {/* ── Comparativa compacta de todos los escenarios ── */}
              <div className="perspectives-cycle-table-wrapper" style={{ marginTop: "1rem" }}>
                <table className="perspectives-cycle-table">
                  <thead>
                    <tr>
                      <th>Escenario</th>
                      <th className="text-right">Patr. neto</th>
                      <th className="text-right">XIRR</th>
                      <th className="text-right">Probabilidad</th>
                      <th className="text-right">Impuesto</th>
                      <th className="text-right">Ventas</th>
                      <th className="text-right">Recompras</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SCENARIO_ORDER.map(s => {
                      const sc = projection.scenarios.find(x => x.scenario === s);
                      if (!sc) return null;
                      const isSelected = activeScenario === s;
                      const totalSales = sc.cycleResults.reduce((a, c) => a + c.salesEur, 0);
                      const totalRebuys = sc.cycleResults.reduce((a, c) => a + c.rebuysEur, 0);
                      return (
                        <tr
                          key={s}
                          className={isSelected ? "selected" : ""}
                          style={{ cursor: "pointer" }}
                          onClick={() => setActiveScenario(s)}
                        >
                          <td>
                            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: SCENARIO_COLORS[s], marginRight: 6 }} />
                            {sc.label}
                            {s === "dinamico" && sc.confidence != null && (
                              <span className="text-muted" style={{ fontSize: "0.75em", marginLeft: 4 }}>
                                conf. {pct(sc.confidence)}
                              </span>
                            )}
                          </td>
                          <td className="text-right font-medium">{fmt(sc.summary.finalNetWealthEur)}</td>
                          <td className="text-right">
                            {(sc.summary as any).xirrAnnual != null
                              ? `${(((sc.summary as any).xirrAnnual as number) * 100).toFixed(1)}%`
                              : sc.summary.weightedAnnualReturn != null
                              ? `${(sc.summary.weightedAnnualReturn * 100).toFixed(1)}%`
                              : "—"}
                          </td>
                          <td className="text-right text-muted">
                            {sc.probability != null ? pct(sc.probability) : s === "dinamico" ? `conf. ${pct(sc.confidence)}` : "—"}
                          </td>
                          <td className="text-right text-muted">{fmt(sc.summary.totalTaxGeneratedEur)}</td>
                          <td className="text-right">{fmt(totalSales)}</td>
                          <td className="text-right">{fmt(totalRebuys)}</td>
                        </tr>
                      );
                    })}
                    {/* CERO control row — separator */}
                    {(() => {
                      const cero = projection.scenarios.find(x => x.scenario === "cero");
                      if (!cero) return null;
                      return (
                        <tr key="cero" style={{ borderTop: "2px dashed var(--color-border)", opacity: 0.7 }}>
                          <td>
                            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "var(--color-muted-fg)", marginRight: 6 }} />
                            {cero.label}
                            <span className="text-muted" style={{ fontSize: "0.7em", marginLeft: 4 }}>(suelo mínimo)</span>
                          </td>
                          <td className="text-right text-muted">{fmt(cero.summary.finalNetWealthEur)}</td>
                          <td className="text-right text-muted">0%</td>
                          <td className="text-right text-muted">—</td>
                          <td className="text-right text-muted">0</td>
                          <td className="text-right text-muted">0</td>
                          <td className="text-right text-muted">0</td>
                        </tr>
                      );
                    })()}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Sección 3: Gráfico evolutivo ── */}
      {activeScenarioData && (
        <Card>
          <CardHeader>
            <CardTitle>
              <TrendingUp size={16} />
              Evolución — {activeScenarioData.label}
            </CardTitle>
            <Badge variant="neutral">Simulación mensual</Badge>
          </CardHeader>
          <CardContent>
            <ScenarioChart
              scenarios={projection!.scenarios}
              activeScenario={activeScenario}
              horizonYears={horizonYears}
              targetYear={targetYear}
            />
          </CardContent>
        </Card>
      )}

      {projection && activeScenarioData && (
        <StrategyBreakdownSection projection={projection} scenario={activeScenarioData} />
      )}

      {/* ── Sección 4: Objetivos ── */}
      <Card>
        <CardHeader>
          <CardTitle>
            <Target size={16} />
            Objetivos de inversión
          </CardTitle>
          <Button
            size="sm" variant="secondary"
            onClick={() => { setShowGoalForm(true); setEditingGoalId(null); setGoalForm(EMPTY_GOAL_FORM); }}
          >
            <PlusCircle size={14} />
            Nuevo objetivo
          </Button>
        </CardHeader>
        <CardContent>
          {(showGoalForm || editingGoalId) && (
            <GoalForm
              form={goalForm}
              onChange={setGoalForm}
              loading={createGoal.isPending || updateGoal.isPending}
              onSave={() => {
                if (!goalForm.name || !goalForm.targetAmountEur) return;
                if (editingGoalId) {
                  updateGoal.mutate({ id: editingGoalId, data: goalForm });
                } else {
                  createGoal.mutate(goalForm);
                }
              }}
              onCancel={() => { setShowGoalForm(false); setEditingGoalId(null); setGoalForm(EMPTY_GOAL_FORM); }}
            />
          )}

          {goalsQ.isLoading && <p className="text-muted text-sm">Cargando…</p>}
          {!goalsQ.isLoading && (goalsQ.data?.length ?? 0) === 0 && !showGoalForm && (
            <div className="empty-state-inline">
              <Target size={16} />
              <span>Sin objetivos definidos. Añade tu primera meta de inversión.</span>
            </div>
          )}

          {(goalsQ.data ?? []).map(goal => {
            const projectedGoal = goalResultById.get(goal.id);
            const progress = projectedGoal?.progress ?? Math.min(1, currentValueEur / goal.targetAmountEur);
            const eta = projectedGoal?.reachedYear ? String(projectedGoal.reachedYear) : null;
            return (
              <div key={goal.id} className="perspectives-goal-row">
                <div className="goal-header">
                  <div className="goal-meta">
                    <span className="goal-name">{goal.name}</span>
                    <Badge variant="neutral">{GOAL_TYPE_LABELS[goal.type] ?? goal.type}</Badge>
                    {eta && <Badge variant="success">ETA: {eta}</Badge>}
                    {!eta && activeScenarioData && (
                      <Badge variant="warning">Fuera del horizonte ({targetYear})</Badge>
                    )}
                  </div>
                  <div className="goal-actions">
                    <button
                      className="ui-button ui-button-ghost ui-button-sm"
                      onClick={() => {
                        setEditingGoalId(goal.id);
                        setShowGoalForm(false);
                        setGoalForm({
                          name: goal.name, type: goal.type,
                          targetAmountEur: String(goal.targetAmountEur),
                          targetDate: tsToDate(goal.targetDate),
                          notes: goal.notes ?? "",
                        });
                      }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="ui-button ui-button-ghost ui-button-sm"
                      onClick={() => { if (confirm(`¿Eliminar objetivo "${goal.name}"?`)) deleteGoal.mutate(goal.id); }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="goal-progress-row">
                  <div className="goal-progress-bar">
                    <div className="goal-progress-fill" style={{ width: `${progress * 100}%` }} />
                  </div>
                  <div className="goal-progress-labels">
                    <span className="text-sm">{fmt(projectedGoal?.currentAssignedEur ?? currentValueEur)}</span>
                    <span className="text-sm font-medium">{pct(progress)}</span>
                    <span className="text-sm">{fmt(goal.targetAmountEur)}</span>
                  </div>
                </div>
                {projectedGoal && (
                  <p className="text-sm text-muted">
                    Proyectado en {activeScenarioData?.label ?? "escenario activo"}: {fmt(projectedGoal.projectedAssignedEur)} asignados por prioridad.
                  </p>
                )}

                {goal.targetDate && (
                  <p className="text-sm text-muted">
                    Fecha objetivo: {new Date(goal.targetDate).toLocaleDateString("es-ES")}
                  </p>
                )}
                {goal.notes && <p className="text-sm text-muted">{goal.notes}</p>}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* ── Sección 5: Calidad de datos e hipótesis ── */}
      <DataQualitySection projection={projection} activeScenario={activeScenarioData} dataScore={dataScore} />
    </section>
  );
}

// ─── Sección 1b: Libro Mayor + Control CERO ─────────────────────────────────

function ContributionLedgerSection({
  ledger,
  ceroScenario,
  wealthFloorViolations,
  orderingViolations,
}: {
  ledger: ProjectionResult["contributionLedger"] | undefined;
  ceroScenario: ProjectionScenarioResult | null;
  wealthFloorViolations: ProjectionResult["wealthFloorViolations"];
  orderingViolations: ProjectionResult["orderingViolations"];
}) {
  const fmtDate = (ts: number | null) =>
    ts ? new Date(ts).toLocaleDateString("es-ES", { year: "numeric", month: "short" }) : "—";

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Info size={16} />
          Libro Mayor de aportaciones
        </CardTitle>
        {ledger && (
          <Badge variant={ledger.cyclesIncluded === ledger.cyclesTotal ? "success" : "warning"}>
            {ledger.cyclesIncluded}/{ledger.cyclesTotal} ciclos incluidos
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        {/* Alertas de violaciones */}
        {orderingViolations?.length > 0 && (
          <div className="empty-state-inline" style={{ marginBottom: "0.75rem", background: "var(--color-warning-bg, #fef3c7)", padding: "8px 12px", borderRadius: "var(--radius)" }}>
            <AlertTriangle size={14} style={{ color: "var(--color-warning)" }} />
            <span className="text-sm">
              <strong>Inversión de escenarios:</strong>{" "}
              {orderingViolations.map(v => v.explanation).join(" · ")}
            </span>
          </div>
        )}
        {wealthFloorViolations?.length > 0 && (
          <div className="empty-state-inline" style={{ marginBottom: "0.75rem", background: "var(--color-danger-bg, #fee2e2)", padding: "8px 12px", borderRadius: "var(--radius)" }}>
            <AlertCircle size={14} style={{ color: "var(--color-danger)" }} />
            <span className="text-sm">
              <strong>Suelo mínimo no alcanzado:</strong>{" "}
              {wealthFloorViolations.map(v => v.explanation).join(" · ")}
            </span>
          </div>
        )}

        {/* Control CERO */}
        {ceroScenario && (
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "1rem" }}>
            <div className="perspectives-current-card" style={{ flex: "1 1 160px" }}>
              <span className="label">Control 0% — patrimonio bruto</span>
              <span className="value">{fmt(ceroScenario.summary.finalGrossWealthEur)}</span>
              <span className="sub">Inicial + aportaciones · sin crecimiento de mercado</span>
            </div>
            <div className="perspectives-current-card" style={{ flex: "1 1 160px" }}>
              <span className="label">Aportaciones futuras (motor)</span>
              <span className="value">{fmt(ceroScenario.summary.totalFutureCapitalEur)}</span>
              <span className="sub">Capital desplegado en el horizonte</span>
            </div>
            <div className="perspectives-current-card" style={{ flex: "1 1 160px" }}>
              <span className="label">Cobertura de ciclos</span>
              <span className="value">{ledger?.cyclesIncluded ?? "?"} / {ledger?.cyclesTotal ?? "?"}</span>
              <span className="sub">{ledger?.coverageNote ?? "Todos los ciclos incluidos"}</span>
            </div>
          </div>
        )}

        {/* Tabla del libro mayor */}
        {ledger && ledger.cycles.length > 0 && (
          <div className="perspectives-cycle-table-wrapper">
            <table className="perspectives-cycle-table">
              <thead>
                <tr>
                  <th>Ciclo</th>
                  <th className="text-right">Inicio ciclo</th>
                  <th className="text-right">Fin ciclo</th>
                  <th className="text-right">€/mes</th>
                  <th className="text-right">1er mes incl.</th>
                  <th className="text-right">Último mes incl.</th>
                  <th className="text-right">Meses</th>
                  <th className="text-right">Total futuro</th>
                </tr>
              </thead>
              <tbody>
                {ledger.cycles.map(c => (
                  <tr key={c.cycleId} style={{ opacity: c.monthsIncluded === 0 ? 0.4 : 1 }}>
                    <td>
                      {c.cycleName}
                      {c.monthsIncluded === 0 && <span className="text-muted" style={{ fontSize: "0.75em", marginLeft: 4 }}>(fuera del horizonte)</span>}
                    </td>
                    <td className="text-right text-muted">{fmtDate(c.startDate)}</td>
                    <td className="text-right text-muted">{c.endDate ? fmtDate(c.endDate) : "abierto"}</td>
                    <td className="text-right">{fmt(c.monthlyAmountEur)}</td>
                    <td className="text-right text-muted">{fmtDate(c.firstMonthIncluded)}</td>
                    <td className="text-right text-muted">{fmtDate(c.lastMonthIncluded)}</td>
                    <td className="text-right">{c.monthsIncluded}</td>
                    <td className="text-right font-medium">{fmt(c.totalFutureEur)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: "2px solid var(--color-border)", fontWeight: 600 }}>
                  <td colSpan={6}>TOTAL aportaciones futuras</td>
                  <td className="text-right">{ledger.cycles.reduce((s, c) => s + c.monthsIncluded, 0)}</td>
                  <td className="text-right">{fmt(ledger.totalFutureEur)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {ledger?.coverageNote && (
          <p className="text-sm text-muted" style={{ marginTop: "0.5rem" }}>
            <Info size={12} style={{ display: "inline", marginRight: 4 }} />
            {ledger.coverageNote}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Sección 1: Estado del plan ─────────────────────────────────────────────

function PlanSnapshotSection({
  projection, loading, error,
}: {
  projection: ProjectionResult | undefined;
  loading: boolean;
  error: Error | null;
}) {
  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle>Estado del plan</CardTitle></CardHeader>
        <CardContent><p className="text-muted text-sm">Cargando estado…</p></CardContent>
      </Card>
    );
  }

  if (error || !projection) {
    return (
      <Card>
        <CardHeader><CardTitle>Estado del plan</CardTitle></CardHeader>
        <CardContent>
          <div className="empty-state-inline">
            <AlertCircle size={16} />
            <span>
              {!projection && !error
                ? "Sin plan activo. Crea un plan de inversión primero."
                : "Error al cargar el estado del plan."
              }
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const snap = projection.snapshot;
  const treasury = snap.treasury;
  const dq = snap.dataQuality;
  const scoreVariant = dq.overallScore >= 0.9 ? "success" : dq.overallScore >= 0.6 ? "warning" : "danger";

  const positions = Object.values(snap.positions);
  const totalPortfolioValueEur = positions.reduce((s, p) => s + (p.currentValueEur ?? 0), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Estado del plan</CardTitle>
        <div className="flex gap-2 items-center">
          <Badge variant={scoreVariant}>
            Calidad: {(dq.overallScore * 100).toFixed(0)}%
          </Badge>
          {dq.missingPrices.length > 0 && (
            <Badge variant="warning">Sin precio: {dq.missingPrices.join(", ")}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="perspectives-summary-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          <div className="perspectives-current-card">
            <span className="label">Cartera</span>
            <span className="value">{new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(totalPortfolioValueEur)}</span>
            <span className="sub">{snap.positionCount} activos · {snap.planName}</span>
          </div>
          <div className="perspectives-current-card">
            <span className="label">Tesorería — Cash</span>
            <span className="value">{new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(treasury.cashEur)}</span>
            <span className="sub">Para aportaciones DCA</span>
          </div>
          <div className="perspectives-current-card">
            <span className="label">EURC disponible</span>
            <span className="value">{new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(treasury.eurcAvailableEur)}</span>
            <span className="sub">Reserva fiscal: {new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(treasury.fiscalReserveEur)}</span>
          </div>
          <div className="perspectives-current-card">
            <span className="label">Capital invertido</span>
            <span className="value">{new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(snap.historicalCapitalEur)}</span>
            <span className="sub">Versión: {snap.strategyVersion}</span>
          </div>
        </div>

        {positions.length > 0 && (
          <div className="perspectives-cycle-table-wrapper" style={{ marginTop: "1rem" }}>
            <table className="perspectives-cycle-table">
              <thead>
                <tr>
                  <th>Activo</th>
                  <th className="text-right">Saldo</th>
                  <th className="text-right">Precio actual</th>
                  <th className="text-right">Valor</th>
                  <th className="text-right">Coste medio</th>
                </tr>
              </thead>
              <tbody>
                {positions.map(p => (
                  <tr key={p.assetId}>
                    <td>{p.assetId}</td>
                    <td className="text-right">{p.balance.toFixed(6)}</td>
                    <td className="text-right">{p.currentPriceEur != null ? new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(p.currentPriceEur) : "—"}</td>
                    <td className="text-right">{p.currentValueEur != null ? new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(p.currentValueEur) : "—"}</td>
                    <td className="text-right text-muted">{p.avgCostEur != null ? new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(p.avgCostEur) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Sección 3: Gráfico evolutivo ───────────────────────────────────────────

function ScenarioChart({
  scenarios,
  activeScenario,
  horizonYears,
  targetYear,
}: {
  scenarios: ProjectionScenarioResult[];
  activeScenario: string;
  horizonYears: number;
  targetYear: number;
}) {
  const active = scenarios.find(s => s.scenario === activeScenario);
  if (!active || active.chartPoints.length === 0) {
    return (
      <div className="empty-state-inline">
        <Info size={16} />
        <span>Sin datos para el horizonte de {horizonYears} años.</span>
      </div>
    );
  }

  const points = active.chartPoints;
  const maxWealth = Math.max(...points.map(p => p.grossWealthEur));
  const h = 200;
  const w = 100; // percentage units

  // Simple SVG polyline chart
  const toXY = (i: number, value: number) => ({
    x: (i / (points.length - 1)) * w,
    y: h - (value / (maxWealth || 1)) * h * 0.9,
  });

  const grossLine = points.map((p, i) => {
    const { x, y } = toXY(i, p.grossWealthEur);
    return `${x},${y}`;
  }).join(" ");

  const netLine = points.map((p, i) => {
    const { x, y } = toXY(i, p.netWealthEur);
    return `${x},${y}`;
  }).join(" ");

  const portfolioLine = points.map((p, i) => {
    const { x, y } = toXY(i, p.portfolioValueEur);
    return `${x},${y}`;
  }).join(" ");

  const color = SCENARIO_COLORS[activeScenario] ?? "var(--color-primary)";

  const first = points[0];
  const last = points[points.length - 1];
  const fmtEur = (v: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);

  return (
    <div>
      <div style={{ display: "flex", gap: "1.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        <span className="text-sm"><span style={{ color }} className="font-medium">—</span> Patrimonio bruto</span>
        <span className="text-sm"><span className="text-muted font-medium">- -</span> Patrimonio neto</span>
        <span className="text-sm"><span className="text-muted font-medium">···</span> Cartera</span>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        style={{ width: "100%", height: 200, overflow: "visible" }}
        preserveAspectRatio="none"
      >
        <polyline points={grossLine} fill="none" stroke={color} strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
        <polyline points={netLine} fill="none" stroke={color} strokeWidth="0.6" strokeDasharray="2,1" vectorEffect="non-scaling-stroke" opacity="0.7" />
        <polyline points={portfolioLine} fill="none" stroke="var(--color-muted-fg)" strokeWidth="0.5" strokeDasharray="1,1.5" vectorEffect="non-scaling-stroke" opacity="0.5" />
      </svg>
      <div className="perspectives-cycle-table-wrapper" style={{ marginTop: "0.75rem" }}>
        <table className="perspectives-cycle-table">
          <thead>
            <tr>
              <th></th>
              <th className="text-right">Patrimonio bruto</th>
              <th className="text-right">Patrimonio neto</th>
              <th className="text-right">Cartera</th>
              <th className="text-right">EURC disponible</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="text-muted">Hoy</td>
              <td className="text-right">{fmtEur(first.grossWealthEur)}</td>
              <td className="text-right">{fmtEur(first.netWealthEur)}</td>
              <td className="text-right">{fmtEur(first.portfolioValueEur)}</td>
              <td className="text-right">{fmtEur(first.eurcAvailableEur)}</td>
            </tr>
            <tr>
              <td className="font-medium">Año {targetYear}</td>
              <td className="text-right font-medium">{fmtEur(last.grossWealthEur)}</td>
              <td className="text-right font-medium">{fmtEur(last.netWealthEur)}</td>
              <td className="text-right">{fmtEur(last.portfolioValueEur)}</td>
              <td className="text-right">{fmtEur(last.eurcAvailableEur)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted" style={{ marginTop: "0.5rem" }}>
        Escenario {active.label} · {points.length} periodos mensuales ·
        <strong> Simulación hipotética, no asesoramiento financiero.</strong>
      </p>
    </div>
  );
}

// ─── Desglose de estrategia completa ─────────────────────────────────────────

function StrategyBreakdownSection({
  projection,
  scenario,
}: {
  projection: ProjectionResult;
  scenario: ProjectionScenarioResult;
}) {
  const activeCycles = projection.snapshot.cycles.filter(cycle =>
    cycle.status === "active" || cycle.status === "planned"
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Info size={16} />
          Desglose de estrategia — {scenario.label}
        </CardTitle>
        <Badge variant="neutral">{projection.snapshot.plans.length || 1} plan(es)</Badge>
      </CardHeader>
      <CardContent>
        <div className="perspectives-summary-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
          <div className="perspectives-current-card">
            <span className="label">Capital actual</span>
            <span className="value">{fmt(scenario.summary.initialGrossWealthEur)}</span>
            <span className="sub">Cartera + tesorería</span>
          </div>
          <div className="perspectives-current-card">
            <span className="label">Aportaciones futuras</span>
            <span className="value">{fmt(scenario.summary.totalFutureCapitalEur)}</span>
            <span className="sub">{activeCycles.length} ciclos proyectables</span>
          </div>
          <div className="perspectives-current-card">
            <span className="label">Ganancia mercado</span>
            <span className={`value ${scenario.summary.estimatedMarketGainEur >= 0 ? "text-success" : "text-danger"}`}>
              {fmt(scenario.summary.estimatedMarketGainEur)}
            </span>
            <span className="sub">Después de impuestos pendientes</span>
          </div>
          <div className="perspectives-current-card">
            <span className="label">Patrimonio neto</span>
            <span className="value">{fmt(scenario.summary.finalNetWealthEur)}</span>
            <span className="sub">XIRR: {(scenario.summary as any).xirrAnnual != null ? pct((scenario.summary as any).xirrAnnual) : pct(scenario.summary.weightedAnnualReturn)}</span>
          </div>
        </div>

        {scenario.cycleResults.length > 0 && (
          <div className="perspectives-cycle-table-wrapper" style={{ marginTop: "1rem" }}>
            <table className="perspectives-cycle-table">
              <thead>
                <tr>
                  <th>Ciclo</th>
                  <th className="text-right">Planificado</th>
                  <th className="text-right">Aportado</th>
                  <th className="text-right">Extra</th>
                  <th className="text-right">Ventas</th>
                  <th className="text-right">Recompras</th>
                </tr>
              </thead>
              <tbody>
                {scenario.cycleResults.map(cycle => (
                  <tr key={cycle.cycleId}>
                    <td>{cycle.cycleName}</td>
                    <td className="text-right">{fmt(cycle.plannedContributionEur)}</td>
                    <td className="text-right">{fmt(cycle.simulatedContributionEur)}</td>
                    <td className="text-right">{fmt(cycle.extraordinaryContributionEur)}</td>
                    <td className="text-right">{fmt(cycle.salesEur)}</td>
                    <td className="text-right">{fmt(cycle.rebuysEur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {scenario.assetResults.length > 0 && (
          <div className="perspectives-cycle-table-wrapper" style={{ marginTop: "1rem" }}>
            <table className="perspectives-cycle-table">
              <thead>
                <tr>
                  <th>Activo</th>
                  <th className="text-right">Saldo final</th>
                  <th className="text-right">Valor final</th>
                  <th className="text-right">Aportado</th>
                  <th className="text-right">Recomprado</th>
                  <th className="text-right">Rentabilidad latente</th>
                  <th className="text-right">Hipótesis</th>
                </tr>
              </thead>
              <tbody>
                {scenario.assetResults.map(asset => (
                  <tr key={asset.assetId}>
                    <td>{asset.assetId}</td>
                    <td className="text-right">{asset.finalBalance.toLocaleString("es-ES", { maximumFractionDigits: 6 })}</td>
                    <td className="text-right">{fmt(asset.finalValueEur)}</td>
                    <td className="text-right">{fmt(asset.costContributionsEur)}</td>
                    <td className="text-right">{fmt(asset.costRebuyEur)}</td>
                    <td className={`text-right ${(asset.unrealizedGainEur ?? 0) >= 0 ? "text-success" : "text-danger"}`}>
                      {fmt(asset.unrealizedGainEur)}
                    </td>
                    <td className="text-right">{pct(asset.hypothesis?.annualGrowthRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Sección 5: Calidad e hipótesis ─────────────────────────────────────────

function DataQualitySection({
  projection,
  activeScenario,
  dataScore,
}: {
  projection: ProjectionResult | undefined;
  activeScenario: ProjectionScenarioResult | null;
  dataScore: number | null;
}) {
  const dq = projection?.snapshot.dataQuality;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Calidad de datos e hipótesis</CardTitle>
        {dataScore != null && (
          <Badge variant={dataScore >= 0.9 ? "success" : dataScore >= 0.6 ? "warning" : "neutral"}>
            Score: {(dataScore * 100).toFixed(0)}%
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        {!projection && (
          <p className="text-muted text-sm">Sin datos de proyección disponibles.</p>
        )}
        {projection && dq && (
          <div className="perspectives-confidence-grid">
            <div className="confidence-item">
              {dq.missingPrices.length === 0
                ? <CheckCircle2 size={16} className="text-success" />
                : <AlertTriangle size={16} className="text-warning" />}
              <span>
                {dq.missingPrices.length === 0
                  ? "Todos los activos tienen precio"
                  : `Sin precio: ${dq.missingPrices.join(", ")}`}
              </span>
            </div>
            <div className="confidence-item">
              {dq.missingCosts.length === 0
                ? <CheckCircle2 size={16} className="text-success" />
                : <AlertTriangle size={16} className="text-warning" />}
              <span>
                {dq.missingCosts.length === 0
                  ? "Todos los activos tienen coste base"
                  : `Sin coste base: ${dq.missingCosts.join(", ")}`}
              </span>
            </div>
            <div className="confidence-item">
              <CheckCircle2 size={16} className="text-success" />
              <span>Versión fiscal: {projection.snapshot.fiscalVersion} (tramos 19/21/23/27/28%)</span>
            </div>
            <div className="confidence-item">
              <CheckCircle2 size={16} className="text-success" />
              <span>Versión estrategia: {projection.snapshot.strategyVersion}</span>
            </div>
            {dq.notes.map((note, i) => (
              <div key={i} className="confidence-item">
                <Info size={16} className="text-muted" />
                <span>{note}</span>
              </div>
            ))}
          </div>
        )}
        <div className="perspectives-confidence-label" style={{ marginTop: "1rem" }}>
          <p className="text-sm text-muted">
            Las proyecciones son escenarios hipotéticos calculados con el motor de proyección interno.
            Cada activo usa su propia hipótesis de crecimiento y calidad de dato; Bitcoin no se reutiliza como proxy global.
            Los escenarios no garantizan rentabilidades futuras y no modifican el plan ni ejecutan operaciones.
          </p>
          {activeScenario && activeScenario.hypotheses.length > 0 && (
            <div className="perspectives-confidence-grid" style={{ marginTop: "0.75rem" }}>
              {activeScenario.hypotheses.map(rate => (
                <div key={rate.assetId} className="confidence-item">
                  <Info size={16} className="text-muted" />
                  <span>
                    {rate.assetId}: {pct(rate.annualGrowthRate)} anual · {rate.dataQuality ?? "calidad no definida"}
                    {rate.source ? ` · ${rate.source}` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── GoalForm component ──────────────────────────────────────────────────────

interface GoalFormProps {
  form: GoalFormState;
  onChange: (f: GoalFormState) => void;
  loading: boolean;
  onSave: () => void;
  onCancel: () => void;
}

function GoalForm({ form, onChange, loading, onSave, onCancel }: GoalFormProps) {
  const set = (key: keyof GoalFormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    onChange({ ...form, [key]: e.target.value });

  return (
    <div className="perspectives-goal-form">
      <div className="form-row">
        <label className="text-sm font-medium">Nombre del objetivo *</label>
        <Input value={form.name} onChange={set("name")} placeholder="Ej: Fondo de vivienda" />
      </div>
      <div className="form-row">
        <label className="text-sm font-medium">Tipo</label>
        <select className="ui-select" value={form.type} onChange={set("type")}>
          {Object.entries(GOAL_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div className="form-row">
        <label className="text-sm font-medium">Importe objetivo (€) *</label>
        <Input type="number" min="0" step="1000" value={form.targetAmountEur} onChange={set("targetAmountEur")} placeholder="100000" />
      </div>
      <div className="form-row">
        <label className="text-sm font-medium">Fecha objetivo</label>
        <Input type="date" value={form.targetDate} onChange={set("targetDate")} />
      </div>
      <div className="form-row">
        <label className="text-sm font-medium">Notas</label>
        <Input value={form.notes} onChange={set("notes")} placeholder="Descripción opcional" />
      </div>
      <div className="form-actions">
        <Button size="sm" loading={loading} disabled={!form.name || !form.targetAmountEur} onClick={onSave}>
          Guardar
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
