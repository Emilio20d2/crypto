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
import type { PerspectivesGoal, PerspectivesGoalType, ProjectionResult, ProjectionScenarioResult } from "@crypto-control/core";

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

function yearOf(ts: number) {
  return new Date(ts).getFullYear();
}

const SCENARIO_COLORS: Record<string, string> = {
  conservador: "var(--color-muted-fg)",
  base: "var(--color-primary)",
  optimista: "var(--color-success)",
  dinamico: "var(--color-warning)",
};

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

  const [horizonYears, setHorizonYears] = useState(10);
  const [activeScenario, setActiveScenario] = useState<"conservador" | "base" | "optimista" | "dinamico">("base");

  const [showGoalForm, setShowGoalForm] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [goalForm, setGoalForm] = useState<GoalFormState>(EMPTY_GOAL_FORM);

  // ── projection query ──────────────────────────────────────────────────────
  const projectionQ = useQuery({
    queryKey: ["perspectives:getProjection", horizonYears],
    queryFn: async () => {
      const r = await api().perspectives.getProjection({ horizonYears });
      if (!r.ok) throw new Error(r.error?.message ?? "Error al calcular proyección");
      return r.data as ProjectionResult;
    },
    staleTime: 5 * 60_000,
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

  const currentValueEur = projection?.snapshot.positions
    ? Object.values(projection.snapshot.positions).reduce((s, p) => s + (p.currentValueEur ?? 0), 0)
    : 0;

  function goalEta(goal: PerspectivesGoal): string | null {
    if (!activeScenarioData) return null;
    for (const pt of activeScenarioData.chartPoints) {
      if (pt.netWealthEur >= goal.targetAmountEur) {
        return String(yearOf(pt.date));
      }
    }
    return null;
  }

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

      {/* ── Sección 2: 4 escenarios (comparativa) ── */}
      <Card>
        <CardHeader>
          <CardTitle>
            <ChartNoAxesCombined size={16} />
            Proyección — 4 escenarios
          </CardTitle>
          <div className="flex gap-2 items-center">
            <label className="text-sm text-muted">Horizonte:</label>
            <select
              className="ui-select"
              style={{ width: 100 }}
              value={horizonYears}
              onChange={e => setHorizonYears(parseInt(e.target.value))}
            >
              {[3, 5, 10, 15, 20, 30].map(y => (
                <option key={y} value={y}>{y} años</option>
              ))}
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
              <div className="perspectives-summary-grid">
                <div className="perspectives-current-card">
                  <span className="label">Valor actual</span>
                  <span className="value">{fmt(currentValueEur)}</span>
                  <span className="sub">Tesorería: {fmt(projection.snapshot.treasury.totalLiquidityEur)}</span>
                  <span className="sub">Invertido: {fmt(projection.snapshot.historicalCapitalEur)}</span>
                </div>
                {(["conservador", "base", "optimista", "dinamico"] as const).map(s => {
                  const sc = projection.scenarios.find(x => x.scenario === s);
                  if (!sc) return null;
                  return (
                    <div
                      key={s}
                      className={`perspectives-scenario-card ${s} ${activeScenario === s ? "active" : ""}`}
                      onClick={() => setActiveScenario(s)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => e.key === "Enter" && setActiveScenario(s)}
                    >
                      <span className="label">{sc.label}</span>
                      <span className="value">{fmt(sc.summary.finalNetWealthEur)}</span>
                      <span className="sub">Bruto: {fmt(sc.summary.finalGrossWealthEur)}</span>
                      <span className="sub">Impuesto: {fmt(sc.summary.totalTaxGeneratedEur)}</span>
                      {sc.probability != null && (
                        <span className="sub">Probabilidad: {pct(sc.probability)}</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Comparison table */}
              <div className="perspectives-cycle-table-wrapper" style={{ marginTop: "1rem" }}>
                <table className="perspectives-cycle-table">
                  <thead>
                    <tr>
                      <th>Escenario</th>
                      <th className="text-right">Capital total</th>
                      <th className="text-right">Plusvalía realizada</th>
                      <th className="text-right">No realizada</th>
                      <th className="text-right">Impuesto</th>
                      <th className="text-right">Patrimonio neto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projection.scenarios.map(sc => (
                      <tr
                        key={sc.scenario}
                        className={activeScenario === sc.scenario ? "selected" : ""}
                        style={{ cursor: "pointer" }}
                        onClick={() => setActiveScenario(sc.scenario)}
                      >
                        <td>
                          <span
                            style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: SCENARIO_COLORS[sc.scenario], marginRight: 6 }}
                          />
                          {sc.label}
                        </td>
                        <td className="text-right">{fmt(sc.summary.totalCapitalEur)}</td>
                        <td className={`text-right ${sc.summary.totalRealizedGainEur > 0 ? "text-success" : ""}`}>
                          {sc.summary.totalRealizedGainEur > 0 ? "+" : ""}{fmt(sc.summary.totalRealizedGainEur)}
                        </td>
                        <td className={`text-right ${sc.summary.totalUnrealizedGainEur > 0 ? "text-success" : ""}`}>
                          {sc.summary.totalUnrealizedGainEur > 0 ? "+" : ""}{fmt(sc.summary.totalUnrealizedGainEur)}
                        </td>
                        <td className="text-right text-muted">{fmt(sc.summary.totalTaxGeneratedEur)}</td>
                        <td className="text-right font-medium">{fmt(sc.summary.finalNetWealthEur)}</td>
                      </tr>
                    ))}
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
            />
          </CardContent>
        </Card>
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
            const progress = Math.min(1, currentValueEur / goal.targetAmountEur);
            const eta = goalEta(goal);
            return (
              <div key={goal.id} className="perspectives-goal-row">
                <div className="goal-header">
                  <div className="goal-meta">
                    <span className="goal-name">{goal.name}</span>
                    <Badge variant="neutral">{GOAL_TYPE_LABELS[goal.type] ?? goal.type}</Badge>
                    {eta && <Badge variant="success">ETA: {eta}</Badge>}
                    {!eta && activeScenarioData && (
                      <Badge variant="warning">Fuera del horizonte ({horizonYears}a)</Badge>
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
                    <span className="text-sm">{fmt(currentValueEur)}</span>
                    <span className="text-sm font-medium">{pct(progress)}</span>
                    <span className="text-sm">{fmt(goal.targetAmountEur)}</span>
                  </div>
                </div>

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
      <DataQualitySection projection={projection} dataScore={dataScore} />
    </section>
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
  const scoreVariant = dq.overallScore >= 0.9 ? "success" : dq.overallScore >= 0.6 ? "warning" : "error";

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
}: {
  scenarios: ProjectionScenarioResult[];
  activeScenario: string;
  horizonYears: number;
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
              <td className="font-medium">En {horizonYears} años</td>
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

// ─── Sección 5: Calidad e hipótesis ─────────────────────────────────────────

function DataQualitySection({
  projection,
  dataScore,
}: {
  projection: ProjectionResult | undefined;
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
            Tasas de crecimiento: Conservador +8%/año BTC · Base +15%/año BTC · Optimista +35%/año BTC.
            Los escenarios no garantizan rentabilidades futuras y no modifican el plan ni ejecutan operaciones.
          </p>
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
