import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChartNoAxesCombined, Target, TrendingUp, PlusCircle, Trash2,
  AlertCircle, Info, Pencil, CheckCircle2,
} from "lucide-react";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/Card";
import { Input } from "../components/Input";
import { PageToolbar } from "../components/PageToolbar";
import {
  computeProjection, formatEur,
  type ProjectionScenario, type CycleInput,
} from "../lib/projection";
import type { PerspectivesGoal, PerspectivesGoalType } from "@crypto-control/core";

// ─── helpers ────────────────────────────────────────────────────────────────

const api = () => window.cryptoControl;

function fmt(v: number) { return formatEur(v); }
function pct(v: number) { return `${(v * 100).toFixed(0)}%`; }

function dateToTs(s: string): number | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function tsToDate(ts: number | null): string {
  if (!ts) return "";
  return new Date(ts).toISOString().slice(0, 10);
}

const SCENARIO_LABELS: Record<ProjectionScenario, string> = {
  conservador: "Conservador",
  base: "Base",
  optimista: "Optimista",
  personalizado: "Personalizado",
};

const SCENARIO_RATES: Record<ProjectionScenario, number | null> = {
  conservador: 5,
  base: 10,
  optimista: 20,
  personalizado: null,
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

  // ── data queries ──────────────────────────────────────────────────────────
  const portfolioQ = useQuery({
    queryKey: ["portfolio:getSummary"],
    queryFn: async () => {
      const r = await api().portfolio.getSummary();
      if (!r.ok) throw new Error(r.error?.message ?? "Error");
      return r.data;
    },
    staleTime: 60_000,
  });

  const cyclesQ = useQuery({
    queryKey: ["investmentCycles:list"],
    queryFn: async () => {
      const r = await api().investmentCycles.list();
      if (!r.ok) throw new Error(r.error?.message ?? "Error");
      return r.data;
    },
    staleTime: 30_000,
  });

  const goalsQ = useQuery({
    queryKey: ["perspectives:getGoals"],
    queryFn: async () => {
      const r = await api().perspectives.getGoals();
      if (!r.ok) throw new Error(r.error?.message ?? "Error");
      return r.data;
    },
    staleTime: 30_000,
  });

  // ── scenario state ────────────────────────────────────────────────────────
  const [activeScenario, setActiveScenario] = useState<ProjectionScenario>("base");
  const [customRate, setCustomRate] = useState("10");
  const [horizonYears, setHorizonYears] = useState("10");

  // ── contribution simulation state ─────────────────────────────────────────
  const [simOverrides, setSimOverrides] = useState<Record<string, string>>({});

  // ── goal form state ───────────────────────────────────────────────────────
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [goalForm, setGoalForm] = useState<GoalFormState>(EMPTY_GOAL_FORM);

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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["perspectives:getGoals"] }); setShowGoalForm(false); setGoalForm(EMPTY_GOAL_FORM); },
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["perspectives:getGoals"] }); setEditingGoalId(null); setGoalForm(EMPTY_GOAL_FORM); },
  });

  const deleteGoal = useMutation({
    mutationFn: (id: string) => api().perspectives.deleteGoal(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["perspectives:getGoals"] }),
  });

  // ── projection ────────────────────────────────────────────────────────────
  const projection = useMemo(() => {
    const portfolio = portfolioQ.data;
    const cycles = cyclesQ.data;
    if (!portfolio || !cycles || cycles.length === 0) return null;

    const cycleInputs: CycleInput[] = cycles.map(c => ({
      id: c.id,
      name: c.name,
      startDate: c.startDate,
      endDate: c.endDate ?? null,
      monthlyAmountEur: simOverrides[c.id] !== undefined
        ? parseFloat(simOverrides[c.id]) || c.monthlyAmountEur
        : c.monthlyAmountEur,
      status: c.status,
    }));

    return computeProjection(
      portfolio.totalValueEur,
      portfolio.totalInvestedEur,
      cycleInputs,
      activeScenario,
      parseFloat(customRate) || 10,
      Date.now(),
      parseInt(horizonYears) || 10,
    );
  }, [portfolioQ.data, cyclesQ.data, activeScenario, customRate, horizonYears, simOverrides]);

  // Compute all 3 fixed scenarios for the comparison tiles
  const allScenarios = useMemo(() => {
    const portfolio = portfolioQ.data;
    const cycles = cyclesQ.data;
    if (!portfolio || !cycles || cycles.length === 0) return null;
    const baseInputs: CycleInput[] = cycles.map(c => ({
      id: c.id, name: c.name, startDate: c.startDate,
      endDate: c.endDate ?? null, monthlyAmountEur: c.monthlyAmountEur, status: c.status,
    }));
    const now = Date.now();
    return {
      conservador: computeProjection(portfolio.totalValueEur, portfolio.totalInvestedEur, baseInputs, "conservador", 5, now, 10),
      base: computeProjection(portfolio.totalValueEur, portfolio.totalInvestedEur, baseInputs, "base", 10, now, 10),
      optimista: computeProjection(portfolio.totalValueEur, portfolio.totalInvestedEur, baseInputs, "optimista", 20, now, 10),
    };
  }, [portfolioQ.data, cyclesQ.data]);

  // ── helper: goal progress ─────────────────────────────────────────────────
  const currentValue = portfolioQ.data?.totalValueEur ?? 0;

  function goalProgress(goal: PerspectivesGoal) {
    const pct = currentValue / goal.targetAmountEur;
    return Math.min(1, pct);
  }

  function goalEta(goal: PerspectivesGoal): string | null {
    if (!projection) return null;
    for (const pt of projection.points) {
      if (pt.netValue >= goal.targetAmountEur) {
        if (pt.periodEnd) return new Date(pt.periodEnd).getFullYear().toString();
        return "en plazo";
      }
    }
    return null;
  }

  // ── confidence ────────────────────────────────────────────────────────────
  const cycles = cyclesQ.data ?? [];
  const hasClosedCycles = cycles.some(c => c.status === "closed");
  const activeCycles = cycles.filter(c => c.status === "active" || c.status === "planned");
  const confidenceLevel =
    activeCycles.length === 0 ? "sin datos" :
    activeCycles.length >= 2 && hasClosedCycles ? "media" :
    activeCycles.length >= 1 ? "baja" : "sin datos";

  const isLoading = portfolioQ.isLoading || cyclesQ.isLoading;
  const hasData = !!portfolioQ.data && !!cyclesQ.data;

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <section className="page-stack">
      <PageToolbar
        title="Perspectivas"
        meta="Proyecciones y simulaciones — no ejecuta operaciones"
      />

      {/* Sección A — Resumen futuro */}
      <Card>
        <CardHeader>
          <CardTitle>
            <ChartNoAxesCombined size={16} />
            Resumen futuro
          </CardTitle>
          <Badge variant="neutral">Simulación hipotética</Badge>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-muted text-sm">Cargando datos…</p>}
          {!isLoading && !hasData && (
            <div className="empty-state-inline">
              <Info size={16} />
              <span>Sin datos de cartera o ciclos. Configura tu plan de inversión primero.</span>
            </div>
          )}
          {hasData && allScenarios && (
            <div className="perspectives-summary-grid">
              <div className="perspectives-current-card">
                <span className="label">Valor actual de la cartera</span>
                <span className="value">{fmt(currentValue)}</span>
                <span className="sub">Invertido: {fmt(portfolioQ.data?.totalInvestedEur ?? 0)}</span>
              </div>
              {(["conservador", "base", "optimista"] as const).map(s => {
                const p = allScenarios[s];
                return (
                  <div
                    key={s}
                    className={`perspectives-scenario-card ${s} ${activeScenario === s ? "active" : ""}`}
                    onClick={() => setActiveScenario(s)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => e.key === "Enter" && setActiveScenario(s)}
                  >
                    <span className="label">{SCENARIO_LABELS[s]} ({SCENARIO_RATES[s]}%/año)</span>
                    <span className="value">{fmt(p.netProjectedValue)}</span>
                    <span className="sub">Bruto: {fmt(p.projectedTotalValue)} · Impuestos estimados: {fmt(p.estimatedTotalTax)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sección B/C — Escenario activo con desglose por ciclo */}
      <Card>
        <CardHeader>
          <CardTitle>
            <TrendingUp size={16} />
            Proyección por ciclos
          </CardTitle>
          <div className="perspectives-scenario-tabs">
            {(["conservador", "base", "optimista", "personalizado"] as const).map(s => (
              <button
                key={s}
                className={`perspectives-tab ${activeScenario === s ? "active" : ""}`}
                onClick={() => setActiveScenario(s)}
              >
                {SCENARIO_LABELS[s]}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {activeScenario === "personalizado" && (
            <div className="perspectives-custom-rate">
              <label className="text-sm font-medium">Tasa anual personalizada (%)</label>
              <Input
                type="number" min="0" max="100" step="1"
                value={customRate}
                onChange={e => setCustomRate(e.target.value)}
                style={{ width: 90 }}
              />
              <label className="text-sm font-medium">Horizonte para ciclos abiertos (años)</label>
              <Input
                type="number" min="1" max="50" step="1"
                value={horizonYears}
                onChange={e => setHorizonYears(e.target.value)}
                style={{ width: 80 }}
              />
            </div>
          )}

          {!projection && (
            <div className="empty-state-inline">
              <Info size={16} />
              <span>Sin ciclos activos o planificados para proyectar.</span>
            </div>
          )}

          {projection && projection.points.length === 0 && (
            <div className="empty-state-inline">
              <Info size={16} />
              <span>Todos los ciclos ya han finalizado. No hay proyección futura disponible.</span>
            </div>
          )}

          {projection && projection.points.length > 0 && (
            <div className="perspectives-cycle-table-wrapper">
              <table className="perspectives-cycle-table">
                <thead>
                  <tr>
                    <th>Ciclo</th>
                    <th>Fin previsto</th>
                    <th>Total invertido</th>
                    <th>Valor proyectado</th>
                    <th>Plusvalía</th>
                    <th>Impuesto est.</th>
                    <th>Valor neto</th>
                  </tr>
                </thead>
                <tbody>
                  {projection.points.map(pt => (
                    <tr key={pt.cycleId}>
                      <td>{pt.cycleName}</td>
                      <td>{pt.periodEnd ? new Date(pt.periodEnd).getFullYear() : "Abierto"}</td>
                      <td className="text-right">{fmt(pt.totalInvested)}</td>
                      <td className="text-right font-medium">{fmt(pt.projectedValue)}</td>
                      <td className={`text-right ${pt.gains > 0 ? "text-success" : ""}`}>
                        {pt.gains > 0 ? `+${fmt(pt.gains)}` : fmt(pt.gains)}
                      </td>
                      <td className="text-right text-muted">{fmt(pt.estimatedTax)}</td>
                      <td className="text-right font-medium">{fmt(pt.netValue)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}><strong>Total proyectado</strong></td>
                    <td className="text-right"><strong>{fmt(projection.totalFutureInvestment)}</strong></td>
                    <td className="text-right"><strong>{fmt(projection.projectedTotalValue)}</strong></td>
                    <td className={`text-right ${projection.gains > 0 ? "text-success" : ""}`}>
                      <strong>{projection.gains > 0 ? `+${fmt(projection.gains)}` : fmt(projection.gains)}</strong>
                    </td>
                    <td className="text-right text-muted"><strong>{fmt(projection.estimatedTotalTax)}</strong></td>
                    <td className="text-right"><strong>{fmt(projection.netProjectedValue)}</strong></td>
                  </tr>
                </tfoot>
              </table>
              <p className="perspectives-disclaimer">
                Escenario {SCENARIO_LABELS[activeScenario]} · CAGR {pct(projection.annualGrowthRate)} ·
                Impuesto sobre plusvalías 19% aplicado al final (simplificado) ·
                No incluye ventas parciales, reinversiones ni variaciones de mercado ·
                <strong> Simulación hipotética, no asesoramiento financiero.</strong>
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sección D — Simulador de aportaciones */}
      <Card>
        <CardHeader>
          <CardTitle>Simulador de aportaciones</CardTitle>
          <Badge variant="neutral">Edición local — no modifica el plan</Badge>
        </CardHeader>
        <CardContent>
          {cycles.length === 0 ? (
            <div className="empty-state-inline">
              <Info size={16} />
              <span>Sin ciclos configurados. Crea ciclos en la sección Plan.</span>
            </div>
          ) : (
            <div className="perspectives-sim-grid">
              {cycles.map(c => (
                <div key={c.id} className="perspectives-sim-row">
                  <span className="cycle-name">{c.name}</span>
                  <div className="sim-input-wrap">
                    <label className="text-sm">Aportación mensual (€)</label>
                    <Input
                      type="number" min="0" step="10"
                      placeholder={String(c.monthlyAmountEur)}
                      value={simOverrides[c.id] ?? ""}
                      onChange={e => setSimOverrides(prev => ({ ...prev, [c.id]: e.target.value }))}
                      style={{ width: 120 }}
                    />
                    {simOverrides[c.id] && simOverrides[c.id] !== String(c.monthlyAmountEur) && (
                      <span className="sim-diff text-warning">
                        ({parseFloat(simOverrides[c.id]) - c.monthlyAmountEur > 0 ? "+" : ""}
                        {fmt(parseFloat(simOverrides[c.id]) - c.monthlyAmountEur)}/mes)
                      </span>
                    )}
                  </div>
                  {simOverrides[c.id] !== undefined && (
                    <button
                      className="ui-button ui-button-ghost ui-button-sm"
                      onClick={() => setSimOverrides(prev => { const n = { ...prev }; delete n[c.id]; return n; })}
                    >
                      Resetear
                    </button>
                  )}
                </div>
              ))}
              {Object.keys(simOverrides).length > 0 && (
                <div className="perspectives-sim-actions">
                  <Button variant="ghost" size="sm" onClick={() => setSimOverrides({})}>
                    Resetear todas
                  </Button>
                  <p className="text-sm text-muted">
                    La proyección de arriba se actualiza automáticamente con estos valores simulados.
                  </p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sección H — Objetivos */}
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
            const progress = goalProgress(goal);
            const eta = goalEta(goal);
            return (
              <div key={goal.id} className="perspectives-goal-row">
                <div className="goal-header">
                  <div className="goal-meta">
                    <span className="goal-name">{goal.name}</span>
                    <Badge variant="neutral">{GOAL_TYPE_LABELS[goal.type] ?? goal.type}</Badge>
                    {eta && <Badge variant="success">{eta}</Badge>}
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
                    <span className="text-sm">{fmt(currentValue)}</span>
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

      {/* Sección I — Confianza y probabilidad */}
      <Card>
        <CardHeader>
          <CardTitle>Confianza en la proyección</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="perspectives-confidence-grid">
            <div className="confidence-item">
              {activeCycles.length > 0
                ? <CheckCircle2 size={16} className="text-success" />
                : <AlertCircle size={16} className="text-warning" />}
              <span>Ciclos activos o planificados: {activeCycles.length}</span>
            </div>
            <div className="confidence-item">
              {hasClosedCycles
                ? <CheckCircle2 size={16} className="text-success" />
                : <AlertCircle size={16} className="text-warning" />}
              <span>Historial previo: {hasClosedCycles ? "Sí (aumenta fiabilidad)" : "Sin ciclos cerrados aún"}</span>
            </div>
            <div className="confidence-item">
              {portfolioQ.data && portfolioQ.data.totalValueEur > 0
                ? <CheckCircle2 size={16} className="text-success" />
                : <AlertCircle size={16} className="text-warning" />}
              <span>Valor actual en cartera: {portfolioQ.data ? fmt(portfolioQ.data.totalValueEur) : "—"}</span>
            </div>
          </div>
          <div className="perspectives-confidence-label">
            <Badge variant={confidenceLevel === "media" ? "success" : confidenceLevel === "baja" ? "warning" : "neutral"}>
              Confianza: {confidenceLevel}
            </Badge>
            <p className="text-sm text-muted">
              La confianza aumenta con ciclos completados, datos reales de aportaciones y rendimientos históricos propios.
              Las proyecciones son escenarios hipotéticos y no garantizan rentabilidades futuras.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Sección K — Hipótesis y explicabilidad */}
      {projection && (
        <Card>
          <CardHeader>
            <CardTitle>Hipótesis del modelo</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="perspectives-hypotheses">
              {projection.hypotheses.map((h, i) => (
                <li key={i} className="text-sm">{h}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </section>
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
