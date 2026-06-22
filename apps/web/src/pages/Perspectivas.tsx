import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChartNoAxesCombined, Target, TrendingUp, PlusCircle, Trash2,
  AlertCircle, Info, Pencil, CheckCircle2, RefreshCw, AlertTriangle,
  ChevronDown, ChevronUp,
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

// ─── constants ───────────────────────────────────────────────────────────────

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

type PerspectiveKey = "conservadora" | "moderada" | "optimista";

const PERSPECTIVE_NAMES: Record<PerspectiveKey, string> = {
  conservadora: "Conservadora",
  moderada:     "Moderada",
  optimista:    "Optimista",
};

const PERSPECTIVE_DESCS: Record<PerspectiveKey, string> = {
  conservadora: "Crecimiento inferior a la media histórica, escenario prudente.",
  moderada:     "Evolución alineada con expectativas medias de largo plazo.",
  optimista:    "Crecimiento superior al escenario moderado.",
};

const PERSPECTIVE_COLORS: Record<PerspectiveKey, string> = {
  conservadora: "var(--color-muted-fg)",
  moderada:     "var(--color-primary)",
  optimista:    "var(--color-success)",
};

const PERSPECTIVE_SCENARIO: Record<PerspectiveKey, ActiveScenario> = {
  conservadora: "conservador",
  moderada:     "base",
  optimista:    "optimista",
};

// Base probability groups (sum of static scenario probs per group)
// conservador(0.15)+moderado(0.22)=0.37, base(0.28)+favorable(0.18)=0.46, muy_fav(0.10)+opt(0.07)=0.17
const PROB_BASE: Record<PerspectiveKey, number> = {
  conservadora: 0.37,
  moderada:     0.46,
  optimista:    0.17,
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

  const currentYear = new Date().getFullYear();
  const [targetYear, setTargetYear] = useState(currentYear + 10);
  const horizonYears = Math.max(1, targetYear - currentYear);
  const [activePerspective, setActivePerspective] = useState<PerspectiveKey>("moderada");
  const [simulationPolicy, setSimulationPolicy] = useState<"plan_base" | "confirmed_only" | "confirmed_plus_proposals" | "full_strategy">("confirmed_plus_proposals");
  const [showDetail, setShowDetail] = useState(false);
  const [detailTab, setDetailTab] = useState<"evolucion" | "activos" | "estrategia" | "auditoria">("evolucion");

  // Goal form state
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [goalForm, setGoalForm] = useState<GoalFormState>(EMPTY_GOAL_FORM);

  // The active scenario is driven by the selected perspective
  const activeScenario: ActiveScenario = PERSPECTIVE_SCENARIO[activePerspective];

  // ── queries ───────────────────────────────────────────────────────────────
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

  const fearGreedQ = useQuery({
    queryKey: ["market:fearGreed"],
    queryFn: async () => {
      const r = await api().market.getFearGreed();
      return r.ok ? r.data : null;
    },
    staleTime: 5 * 60_000,
    retry: false,
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

  const projectionYears = useMemo(
    () => Array.from({ length: 30 }, (_, i) => currentYear + i + 1),
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

  const conservadoraData = useMemo(
    () => projection?.scenarios.find(s => s.scenario === "conservador") ?? null,
    [projection],
  );
  const moderadaData = useMemo(
    () => projection?.scenarios.find(s => s.scenario === "base") ?? null,
    [projection],
  );
  const optimistaData = useMemo(
    () => projection?.scenarios.find(s => s.scenario === "optimista") ?? null,
    [projection],
  );

  const scenarioByPerspective: Record<PerspectiveKey, ProjectionScenarioResult | null> = {
    conservadora: conservadoraData,
    moderada: moderadaData,
    optimista: optimistaData,
  };

  // Dynamic probabilities from Fear & Greed
  const perspectiveProbs = useMemo(() => {
    const fg: number = (fearGreedQ.data as any)?.value ?? 50;
    const fgNorm = Math.max(0, Math.min(100, fg)) / 100;
    const shift = (fgNorm - 0.5) * 0.30; // max ±0.15

    const raw = {
      conservadora: Math.max(0.08, PROB_BASE.conservadora - shift),
      optimista:    Math.max(0.08, PROB_BASE.optimista + shift),
      moderada:     0,
    };
    raw.moderada = Math.max(0.08, 1 - raw.conservadora - raw.optimista);
    const total = raw.conservadora + raw.moderada + raw.optimista;
    return {
      conservadora: raw.conservadora / total,
      moderada:     raw.moderada / total,
      optimista:    raw.optimista / total,
      fearGreed: fg,
      isReal: fearGreedQ.isSuccess && fearGreedQ.data != null,
    };
  }, [fearGreedQ.data, fearGreedQ.isSuccess]);

  // Totals for hero
  const activeNet    = activeScenarioData?.summary.finalNetWealthEur ?? null;
  const totalCapital = activeScenarioData
    ? activeScenarioData.summary.historicalCapitalEur + activeScenarioData.summary.totalFutureCapitalEur
    : 0;
  const beneficioAcumulado = activeNet != null ? activeNet - totalCapital : null;

  // Annual breakdown row for target year
  const yearRow = useMemo(() => {
    if (!activeScenarioData) return null;
    const bd = (activeScenarioData as any).annualBreakdown as Array<any> | undefined;
    if (!bd || bd.length === 0) return null;
    return bd.find((r: any) => r.year === targetYear) ?? bd[bd.length - 1] ?? null;
  }, [activeScenarioData, targetYear]);

  // Max wealth across 3 perspectives for comparison bars
  const maxWealth = useMemo(() => {
    const values = [
      conservadoraData?.summary.finalNetWealthEur ?? 0,
      moderadaData?.summary.finalNetWealthEur ?? 0,
      optimistaData?.summary.finalNetWealthEur ?? 0,
    ];
    return Math.max(...values, 1);
  }, [conservadoraData, moderadaData, optimistaData]);

  const isUnderperforming = activeNet != null && totalCapital > 0 && activeNet < totalCapital * 0.95;

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
        meta="Simulación hipotética · no ejecuta operaciones"
      />

      {/* ── Mensaje principal ── */}
      <div className="persp-message-banner">
        <Info size={14} style={{ flexShrink: 0 }} />
        <span>
          Con lo que tengo hoy, todo lo que aportaré y la estrategia definida en mi Plan de Inversión, así podría evolucionar mi patrimonio año a año bajo distintas perspectivas de mercado.
          Estas perspectivas y sus probabilidades son <strong>estimaciones dinámicas</strong> que la aplicación calcula y actualiza según la información disponible, por lo que pueden variar con el tiempo.
        </span>
      </div>

      {/* ── Controles compactos ── */}
      <div className="persp-controls-row">
        <label className="text-sm text-muted">Año objetivo:</label>
        <select
          className="ui-select"
          style={{ width: 100 }}
          value={targetYear}
          onChange={e => setTargetYear(parseInt(e.target.value))}
        >
          {projectionYears.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <label className="text-sm text-muted">Política:</label>
        <select
          className="ui-select"
          style={{ width: 200 }}
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

      {/* ── Error o cargando ── */}
      {projectionQ.isLoading && (
        <Card>
          <CardContent>
            <p className="text-muted text-sm">Calculando perspectivas…</p>
          </CardContent>
        </Card>
      )}
      {projectionQ.error && (
        <Card>
          <CardContent>
            <div className="empty-state-inline">
              <AlertCircle size={16} />
              <span>{String(projectionQ.error)}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Sección principal: Hero + 3 perspectivas ── */}
      {projection && (
        <Card>
          <CardContent>

            {/* Hero */}
            <div className="persp-hero">
              <p className="persp-hero-label">
                Patrimonio neto estimado en {targetYear}
                <span className="persp-hero-perspective">
                  &nbsp;·&nbsp;Perspectiva {PERSPECTIVE_NAMES[activePerspective]}
                  &nbsp;·&nbsp;Prob. ≈ {(perspectiveProbs[activePerspective] * 100).toFixed(0)}%
                </span>
              </p>
              <div className="persp-hero-amount" style={{ color: PERSPECTIVE_COLORS[activePerspective] }}>
                {fmt(activeNet)}
              </div>
              <div className="persp-hero-sub">
                <span>Capital aportado: <strong>{fmt(totalCapital)}</strong></span>
                <span className={beneficioAcumulado != null && beneficioAcumulado >= 0 ? "text-success" : "text-danger"}>
                  Beneficio estimado: <strong>
                    {beneficioAcumulado != null ? `${beneficioAcumulado >= 0 ? "+" : ""}${fmt(beneficioAcumulado)}` : "—"}
                  </strong>
                </span>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setShowDetail(v => !v)}
                style={{ marginTop: "0.75rem" }}
              >
                {showDetail ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {showDetail ? "Ocultar detalle" : "Ver detalle"}
              </Button>
            </div>

            {/* 3 tarjetas de perspectiva */}
            <div className="persp-3cards">
              {(["conservadora", "moderada", "optimista"] as PerspectiveKey[]).map(p => {
                const data = scenarioByPerspective[p];
                const prob = perspectiveProbs[p];
                const wealth = data?.summary.finalNetWealthEur ?? null;
                const cap = data
                  ? data.summary.historicalCapitalEur + data.summary.totalFutureCapitalEur
                  : totalCapital;
                const benefit = wealth != null ? wealth - cap : null;
                const color = PERSPECTIVE_COLORS[p];
                return (
                  <button
                    key={p}
                    className={`persp-perspective-card${activePerspective === p ? " active" : ""}`}
                    style={{ "--persp-color": color } as React.CSSProperties}
                    onClick={() => setActivePerspective(p)}
                    aria-pressed={activePerspective === p}
                  >
                    <span className="pcard-name">{PERSPECTIVE_NAMES[p]}</span>
                    <span className="pcard-prob">Prob. estimada: ≈ {(prob * 100).toFixed(0)}%</span>
                    <span className="pcard-wealth" style={{ color }}>{fmt(wealth)}</span>
                    <span className={`pcard-benefit ${benefit != null && benefit >= 0 ? "text-success" : "text-danger"}`}>
                      {benefit != null ? `${benefit >= 0 ? "+" : ""}${fmt(benefit)}` : "—"}
                    </span>
                    <span className="pcard-desc">{PERSPECTIVE_DESCS[p]}</span>
                  </button>
                );
              })}
            </div>

            {/* Comparación visual */}
            <div className="persp-comparison">
              <p className="persp-comparison-title">Comparación de perspectivas — patrimonio neto estimado en {targetYear}</p>
              {(["conservadora", "moderada", "optimista"] as PerspectiveKey[]).map(p => {
                const data = scenarioByPerspective[p];
                const wealth = data?.summary.finalNetWealthEur ?? 0;
                const widthPct = maxWealth > 0 ? (wealth / maxWealth) * 100 : 0;
                const color = PERSPECTIVE_COLORS[p];
                return (
                  <div key={p} className="persp-comparison-row" onClick={() => setActivePerspective(p)} style={{ cursor: "pointer" }}>
                    <span className="persp-comparison-label">{PERSPECTIVE_NAMES[p]}</span>
                    <div className="persp-comparison-bar-track">
                      <div
                        className="persp-comparison-bar-fill"
                        style={{ width: `${widthPct}%`, background: color }}
                      />
                    </div>
                    <span className="persp-comparison-value" style={{ color }}>{fmt(wealth)}</span>
                    <span className="persp-comparison-pct text-muted">({(perspectiveProbs[p] * 100).toFixed(0)}%)</span>
                  </div>
                );
              })}
              {(() => {
                const cero = projection.scenarios.find(s => s.scenario === "cero");
                if (!cero) return null;
                const w = cero.summary.finalNetWealthEur;
                const wPct = maxWealth > 0 ? (w / maxWealth) * 100 : 0;
                return (
                  <div className="persp-comparison-row persp-comparison-cero">
                    <span className="persp-comparison-label text-muted">Sin crecimiento</span>
                    <div className="persp-comparison-bar-track">
                      <div className="persp-comparison-bar-fill" style={{ width: `${wPct}%`, background: "var(--color-muted-fg)" }} />
                    </div>
                    <span className="persp-comparison-value text-muted">{fmt(w)}</span>
                    <span className="persp-comparison-pct text-muted">(suelo)</span>
                  </div>
                );
              })()}
            </div>

            {/* Nota F&G */}
            <p className="text-xs text-muted" style={{ marginTop: "0.5rem" }}>
              Probabilidades calculadas dinámicamente por la aplicación según datos históricos y condiciones actuales de mercado (Fear & Greed: {perspectiveProbs.fearGreed} — {perspectiveProbs.isReal ? "dato real" : "estimación"}).
              Son orientativas y no representan una predicción exacta. Las condiciones de mercado pueden cambiar la distribución con el tiempo.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Resumen para el año seleccionado ── */}
      {yearRow && activeScenarioData && (
        <Card>
          <CardHeader>
            <CardTitle>
              <ChartNoAxesCombined size={16} />
              Resumen año {yearRow.year} — {PERSPECTIVE_NAMES[activePerspective]}
            </CardTitle>
            <Badge variant="neutral">
              Prob. ≈ {(perspectiveProbs[activePerspective] * 100).toFixed(0)}%
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="perspectives-summary-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
              <div className="perspectives-current-card">
                <span className="label">Capital inicial {yearRow.year}</span>
                <span className="value">{fmt(yearRow.inheritedWealthEur)}</span>
                <span className="sub">Heredado del año anterior</span>
              </div>
              <div className="perspectives-current-card">
                <span className="label">Aportaciones</span>
                <span className="value">{fmt(yearRow.contributionsEur)}</span>
                <span className="sub">Plan de inversión</span>
              </div>
              <div className="perspectives-current-card">
                <span className="label">Ganancia mercado</span>
                <span className={`value ${yearRow.marketGainEur >= 0 ? "text-success" : "text-danger"}`}>
                  {yearRow.marketGainEur >= 0 ? "+" : ""}{fmt(yearRow.marketGainEur)}
                </span>
                <span className="sub">Apreciación posiciones</span>
              </div>
              <div className="perspectives-current-card">
                <span className="label">% año</span>
                <span className={`value ${(yearRow.annualGrowthPct ?? 0) >= 0 ? "text-success" : "text-danger"}`} style={{ fontWeight: 700 }}>
                  {yearRow.annualGrowthPct != null
                    ? `${yearRow.annualGrowthPct >= 0 ? "+" : ""}${yearRow.annualGrowthPct.toFixed(1)}%`
                    : "—"}
                </span>
                <span className="sub">Rendimiento patrimonio</span>
              </div>
              <div className="perspectives-current-card">
                <span className="label">Ventas parciales</span>
                <span className="value">{yearRow.salesEur > 0 ? fmt(yearRow.salesEur) : "—"}</span>
                <span className="sub">Según Plan</span>
              </div>
              <div className="perspectives-current-card">
                <span className="label">Recompras</span>
                <span className="value">{yearRow.rebuysEur > 0 ? fmt(yearRow.rebuysEur) : "—"}</span>
                <span className="sub">EURC disponible</span>
              </div>
              <div className="perspectives-current-card">
                <span className="label">Impuestos {yearRow.year}</span>
                <span className="value text-muted">{yearRow.taxEur > 0 ? fmt(yearRow.taxEur) : "—"}</span>
                <span className="sub">Reserva fiscal generada</span>
              </div>
              <div className="perspectives-current-card" style={{ borderColor: PERSPECTIVE_COLORS[activePerspective] }}>
                <span className="label">Patrimonio neto {yearRow.year}</span>
                <span className="value" style={{ color: PERSPECTIVE_COLORS[activePerspective], fontWeight: 700 }}>
                  {fmt(yearRow.endWealthEur)}
                </span>
                <span className="sub">Capital final del año ↓</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Resumen final (escenario activo) ── */}
      {activeScenarioData && (
        <Card>
          <CardHeader>
            <CardTitle>Resumen final — {PERSPECTIVE_NAMES[activePerspective]} en {targetYear}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="perspectives-summary-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
              <div className="perspectives-current-card">
                <span className="label">Patrimonio actual</span>
                <span className="value">{fmt(activeScenarioData.summary.initialGrossWealthEur)}</span>
                <span className="sub">Cartera + tesorería hoy</span>
              </div>
              <div className="perspectives-current-card">
                <span className="label">Capital histórico</span>
                <span className="value">{fmt(activeScenarioData.summary.historicalCapitalEur)}</span>
                <span className="sub">Ya invertido</span>
              </div>
              <div className="perspectives-current-card">
                <span className="label">Aportaciones acumuladas</span>
                <span className="value">{fmt(activeScenarioData.summary.totalFutureCapitalEur)}</span>
                <span className="sub">Plan futuro</span>
              </div>
              <div className="perspectives-current-card">
                <span className="label">Beneficio acumulado</span>
                <span className={`value ${(activeScenarioData.summary.estimatedMarketGainEur ?? 0) >= 0 ? "text-success" : "text-danger"}`}>
                  {fmt(activeScenarioData.summary.estimatedMarketGainEur)}
                </span>
                <span className="sub">Ganancia mercado total</span>
              </div>
              <div className="perspectives-current-card">
                <span className="label">Ventas acumuladas</span>
                <span className="value">{fmt(activeScenarioData.cycleResults.reduce((s, c) => s + c.salesEur, 0))}</span>
                <span className="sub">Ventas parciales Plan</span>
              </div>
              <div className="perspectives-current-card">
                <span className="label">Recompras acumuladas</span>
                <span className="value">{fmt(activeScenarioData.cycleResults.reduce((s, c) => s + c.rebuysEur, 0))}</span>
                <span className="sub">Recompras con EURC</span>
              </div>
              <div className="perspectives-current-card">
                <span className="label">Impuestos generados</span>
                <span className="value text-muted">{fmt(activeScenarioData.summary.totalTaxGeneratedEur)}</span>
                <span className="sub">Reserva fiscal total</span>
              </div>
              <div className="perspectives-current-card">
                <span className="label">EURC disponible</span>
                <span className="value">{fmt(activeScenarioData.summary.finalEurcAvailableEur)}</span>
                <span className="sub">Neto tras reservas</span>
              </div>
              <div className="perspectives-current-card" style={{ borderColor: PERSPECTIVE_COLORS[activePerspective] }}>
                <span className="label">Patrimonio neto final</span>
                <span className="value" style={{ color: PERSPECTIVE_COLORS[activePerspective], fontWeight: 700 }}>
                  {fmt(activeScenarioData.summary.finalNetWealthEur)}
                </span>
                <span className="sub">
                  XIRR: {(activeScenarioData.summary as any).xirrAnnual != null
                    ? `${(((activeScenarioData.summary as any).xirrAnnual as number) * 100).toFixed(1)}% / año`
                    : "—"}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Explicación si resultado < capital aportado ── */}
      {isUnderperforming && (
        <Card>
          <CardHeader>
            <CardTitle>
              <AlertTriangle size={16} style={{ color: "var(--color-warning)" }} />
              Patrimonio estimado inferior al capital aportado
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted" style={{ marginBottom: "0.75rem" }}>
              En la perspectiva {PERSPECTIVE_NAMES[activePerspective]} para el año {targetYear}, el patrimonio neto estimado ({fmt(activeNet)}) no supera el capital total aportado ({fmt(totalCapital)}). Esto puede deberse a:
            </p>
            <div className="perspectives-confidence-grid">
              {activeScenarioData?.summary.estimatedMarketGainEur != null && activeScenarioData.summary.estimatedMarketGainEur < 0 && (
                <div className="confidence-item">
                  <AlertTriangle size={14} style={{ color: "var(--color-warning)" }} />
                  <span>Evolución negativa del mercado en este escenario</span>
                </div>
              )}
              {(activeScenarioData?.summary.totalTaxGeneratedEur ?? 0) > 0 && (
                <div className="confidence-item">
                  <Info size={14} className="text-muted" />
                  <span>Impacto fiscal: {fmt(activeScenarioData?.summary.totalTaxGeneratedEur)}</span>
                </div>
              )}
              <div className="confidence-item">
                <Info size={14} className="text-muted" />
                <span>El horizonte seleccionado ({targetYear}) puede estar dentro de una fase de corrección del ciclo de halving</span>
              </div>
              <div className="confidence-item">
                <Info size={14} className="text-muted" />
                <span>La perspectiva Conservadora asume crecimiento inferior a la media histórica</span>
              </div>
            </div>
            <p className="text-xs text-muted" style={{ marginTop: "0.75rem" }}>
              Compara con las perspectivas Moderada y Optimista, o extiende el horizonte temporal para ver la recuperación.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Validación escenario sin crecimiento ── */}
      {projection && (() => {
        const cero = projection.scenarios.find(s => s.scenario === "cero");
        if (!cero) return null;
        const activeFloor = activeScenarioData?.summary.finalNetWealthEur ?? 0;
        const floorOk = activeFloor >= cero.summary.finalNetWealthEur - 1;
        if (!projection.wealthFloorViolations?.length && floorOk) return null;
        return (
          <div className="empty-state-inline" style={{ padding: "8px 12px", borderRadius: "var(--radius)", background: "var(--color-danger-bg, #fee2e2)" }}>
            <AlertCircle size={14} style={{ color: "var(--color-danger)" }} />
            <span className="text-sm">
              <strong>Validación suelo mínimo:</strong> la perspectiva seleccionada produce un patrimonio inferior al escenario sin crecimiento.
              {" "}Suelo: {fmt(cero.summary.finalNetWealthEur)} · Perspectiva: {fmt(activeFloor)}
            </span>
          </div>
        );
      })()}

      {/* ── Detalle expandible ── */}
      {showDetail && projection && (
        <>
          {/* Tabs de detalle */}
          <div className="persp-detail-tabs" role="tablist">
            {([
              ["evolucion",  "Evolución anual"],
              ["activos",    "Activos"],
              ["estrategia", "Estrategia"],
              ["auditoria",  "Auditoría"],
            ] as [typeof detailTab, string][]).map(([tab, label]) => (
              <button
                key={tab}
                role="tab"
                aria-selected={detailTab === tab}
                className={`persp-detail-tab${detailTab === tab ? " active" : ""}`}
                onClick={() => setDetailTab(tab)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Tab: Evolución anual */}
          {detailTab === "evolucion" && activeScenarioData && (
            <Card>
              <CardHeader>
                <CardTitle>
                  <TrendingUp size={16} />
                  Evolución año a año — {PERSPECTIVE_NAMES[activePerspective]}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/* Gráfico */}
                <ScenarioChart
                  scenarios={projection.scenarios}
                  activeScenario={activeScenario}
                  horizonYears={horizonYears}
                  targetYear={targetYear}
                />

                {/* Tabla anual */}
                {(activeScenarioData as any).annualBreakdown?.length > 0 && (
                  <div className="perspectives-cycle-table-wrapper" style={{ marginTop: "1.25rem" }}>
                    <table className="perspectives-cycle-table">
                      <thead>
                        <tr>
                          <th>Año</th>
                          <th className="text-right">Capital inicial ↓</th>
                          <th className="text-right">Aportaciones</th>
                          <th className="text-right">Ganancia mercado</th>
                          <th className="text-right">% año</th>
                          <th className="text-right">Ventas</th>
                          <th className="text-right">Recompras</th>
                          <th className="text-right">Impuestos</th>
                          <th className="text-right" style={{ fontWeight: 700 }}>Capital final ↓</th>
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
                          annualGrowthPct: number | null;
                          scope?: "plan" | "extrapol";
                        }>).map((row, idx, arr) => {
                          const prevScope = idx > 0 ? arr[idx - 1].scope : undefined;
                          const isFirstExtrapol = row.scope === "extrapol" && prevScope !== "extrapol";
                          return (
                            <>
                              {isFirstExtrapol && (
                                <tr key={`sep-${row.year}`} style={{ background: "transparent" }}>
                                  <td colSpan={9} style={{ padding: "2px 4px", fontSize: "0.7rem", color: "var(--text-muted)", fontStyle: "italic", borderTop: "1px dashed var(--color-border)" }}>
                                    — Extrapolación libre (sin nuevas aportaciones del plan) —
                                  </td>
                                </tr>
                              )}
                              <tr key={row.year} style={row.scope === "extrapol" ? { opacity: 0.65 } : undefined}>
                                <td style={{ fontWeight: 600 }}>
                                  {row.year}
                                  {row.scope === "extrapol" && <span title="Fuera del horizonte del plan" style={{ fontSize: "0.65rem", marginLeft: 3, color: "var(--text-muted)" }}>›</span>}
                                </td>
                                <td className="text-right text-muted">{fmt(row.inheritedWealthEur)}</td>
                                <td className="text-right">{fmt(row.contributionsEur)}</td>
                                <td className="text-right" style={{ color: row.marketGainEur >= 0 ? "var(--color-success, #10b981)" : "var(--color-negative, #ef4444)", fontWeight: 500 }}>
                                  {row.marketGainEur >= 0 ? "+" : ""}{fmt(row.marketGainEur)}
                                </td>
                                <td className="text-right" style={{
                                  fontWeight: 700,
                                  color: row.annualGrowthPct == null ? "var(--text-muted)"
                                    : row.annualGrowthPct >= 0 ? "var(--color-success, #10b981)"
                                    : "var(--color-negative, #ef4444)",
                                }}>
                                  {row.annualGrowthPct != null
                                    ? `${row.annualGrowthPct >= 0 ? "+" : ""}${row.annualGrowthPct.toFixed(1)}%`
                                    : "—"}
                                </td>
                                <td className="text-right text-muted">{row.salesEur > 0 ? fmt(row.salesEur) : "—"}</td>
                                <td className="text-right text-muted">{row.rebuysEur > 0 ? fmt(row.rebuysEur) : "—"}</td>
                                <td className="text-right text-muted">{row.taxEur > 0 ? fmt(row.taxEur) : "—"}</td>
                                <td className="text-right" style={{ fontWeight: 700, color: PERSPECTIVE_COLORS[activePerspective] }}>{fmt(row.endWealthEur)}</td>
                              </tr>
                            </>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr style={{ borderTop: "2px solid var(--color-border)", fontWeight: 700 }}>
                          <td>Total</td>
                          <td className="text-right text-muted">—</td>
                          <td className="text-right">{fmt(activeScenarioData.summary.totalFutureCapitalEur)}</td>
                          <td className="text-right" style={{ color: activeScenarioData.summary.estimatedMarketGainEur >= 0 ? "var(--color-success, #10b981)" : "var(--color-negative, #ef4444)" }}>
                            {activeScenarioData.summary.estimatedMarketGainEur >= 0 ? "+" : ""}{fmt(activeScenarioData.summary.estimatedMarketGainEur)}
                          </td>
                          <td className="text-right text-muted" title="XIRR del escenario">
                            {(activeScenarioData.summary as any).xirrAnnual != null
                              ? `${((activeScenarioData.summary as any).xirrAnnual * 100).toFixed(1)}%`
                              : "—"}
                          </td>
                          <td className="text-right text-muted">{fmt(activeScenarioData.cycleResults.reduce((a, c) => a + c.salesEur, 0))}</td>
                          <td className="text-right text-muted">{fmt(activeScenarioData.cycleResults.reduce((a, c) => a + c.rebuysEur, 0))}</td>
                          <td className="text-right text-muted">{fmt(activeScenarioData.summary.totalTaxGeneratedEur)}</td>
                          <td className="text-right" style={{ color: PERSPECTIVE_COLORS[activePerspective] }}>{fmt(activeScenarioData.summary.finalNetWealthEur)}</td>
                        </tr>
                      </tfoot>
                    </table>
                    <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.4rem" }}>
                      <strong>↓ Capital inicial = Capital final del año anterior</strong> (compounding explícito) ·
                      <strong> % año</strong>: rendimiento del patrimonio acumulado (mercado + recompras − impuestos / capital inicial) ·
                      El motor modela fases bull/corrección de ciclos de halving ·
                      {simulationPolicy !== "plan_base" && simulationPolicy !== "confirmed_only"
                        ? " Ventas/recompras incluyen propuestas según Plan."
                        : " Política sin propuestas automáticas."}
                      {" › = extrapolación libre fuera del plan configurado."}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Tab: Activos */}
          {detailTab === "activos" && activeScenarioData && (
            <StrategyBreakdownSection projection={projection} scenario={activeScenarioData} />
          )}

          {/* Tab: Estrategia — comparativa de los 7 escenarios */}
          {detailTab === "estrategia" && (
            <Card>
              <CardHeader>
                <CardTitle>
                  <ChartNoAxesCombined size={16} />
                  Comparativa — 7 escenarios de proyección
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/* Selector de escenario */}
                <div className="perspectives-scenario-selector" role="tablist" style={{ marginBottom: "1rem" }}>
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
                        onClick={() => {
                          const matchPerspective = (Object.entries(PERSPECTIVE_SCENARIO) as [PerspectiveKey, ActiveScenario][]).find(([, sc]) => sc === s);
                          if (matchPerspective) setActivePerspective(matchPerspective[0]);
                        }}
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

                {/* Tarjeta del escenario activo */}
                {activeScenarioData && (
                  <div className="perspectives-active-card" style={{ borderLeftColor: PERSPECTIVE_COLORS[activePerspective] }}>
                    <div className="active-card-header">
                      <div>
                        <h3 className="active-card-title">{activeScenarioData.label}</h3>
                        <p className="text-sm text-muted" style={{ marginTop: 2 }}>{activeScenarioData.description}</p>
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
                      <div className="metric-item highlight" style={{ borderColor: PERSPECTIVE_COLORS[activePerspective] }}>
                        <span className="metric-label">Patrimonio neto</span>
                        <span className="metric-value">{fmt(activeScenarioData.summary.finalNetWealthEur)}</span>
                      </div>
                      <div className="metric-item">
                        <span className="metric-label">Patrimonio bruto</span>
                        <span className="metric-value">{fmt(activeScenarioData.summary.finalGrossWealthEur)}</span>
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
                        <span className="metric-label">EURC reserva fiscal</span>
                        <span className="metric-value">{fmt(activeScenarioData.summary.finalFiscalReserveEur)}</span>
                      </div>
                      <div className="metric-item">
                        <span className="metric-label">EURC libre (≈0)</span>
                        <span className={`metric-value ${(activeScenarioData.summary.finalEurcAvailableEur ?? 0) > 10 ? "text-danger" : "text-success"}`}>
                          {fmt(activeScenarioData.summary.finalEurcAvailableEur)}
                        </span>
                      </div>
                      <div className="metric-item">
                        <span className="metric-label">EURC generado</span>
                        <span className="metric-value">{fmt((activeScenarioData.summary as any).totalEurcGeneratedEur)}</span>
                      </div>
                      <div className="metric-item">
                        <span className="metric-label">EURC reinvertido</span>
                        <span className={`metric-value ${((activeScenarioData.summary as any).totalEurcReinvestedEur ?? 0) > 0 ? "text-success" : ""}`}>
                          {fmt((activeScenarioData.summary as any).totalEurcReinvestedEur)}
                        </span>
                      </div>
                      <div className="metric-item">
                        <span className="metric-label">Tasa reinversión</span>
                        <span className={`metric-value ${((activeScenarioData.summary as any).reinvestmentRate ?? 0) >= 0.99 ? "text-success" : ((activeScenarioData.summary as any).reinvestmentRate ?? 0) > 0 ? "" : ""}`}>
                          {(activeScenarioData.summary as any).reinvestmentRate != null
                            ? `${(((activeScenarioData.summary as any).reinvestmentRate as number) * 100).toFixed(1)}%`
                            : "—"}
                        </span>
                      </div>
                      {((activeScenarioData.summary as any).totalLossesEur ?? 0) > 0 && (
                        <div className="metric-item">
                          <span className="metric-label">Pérdidas por activos</span>
                          <span className="metric-value text-danger">-{fmt((activeScenarioData.summary as any).totalLossesEur)}</span>
                        </div>
                      )}
                      {(((activeScenarioData.summary as any).failedAssets as string[] | undefined) ?? []).length > 0 && (
                        <div className="metric-item" style={{ gridColumn: "1 / -1" }}>
                          <span className="metric-label">Activos fallidos</span>
                          <span className="metric-value text-danger">
                            {((activeScenarioData.summary as any).failedAssets as string[]).join(", ")}
                          </span>
                        </div>
                      )}
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
                      <div className="metric-item highlight" style={{ borderColor: PERSPECTIVE_COLORS[activePerspective], gridColumn: "1 / -1" }}>
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

                {/* Comparativa compacta 7 escenarios */}
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
                            onClick={() => {
                              const matchP = (Object.entries(PERSPECTIVE_SCENARIO) as [PerspectiveKey, ActiveScenario][]).find(([, sc]) => sc === s);
                              if (matchP) setActivePerspective(matchP[0]);
                            }}
                          >
                            <td>
                              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: SCENARIO_COLORS[s], marginRight: 6 }} />
                              {sc.label}
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
                              {sc.probability != null ? pct(sc.probability) : "—"}
                            </td>
                            <td className="text-right text-muted">{fmt(sc.summary.totalTaxGeneratedEur)}</td>
                            <td className="text-right">{fmt(totalSales)}</td>
                            <td className="text-right">{fmt(totalRebuys)}</td>
                          </tr>
                        );
                      })}
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

                {/* Controles independientes */}
                {activeScenarioData && (
                  <div className="perspectives-cycle-table-wrapper" style={{ marginTop: "1rem" }}>
                    <h4 style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem", color: "var(--text-muted)" }}>
                      Controles independientes — {horizonYears} años
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
                        <tr style={{ fontWeight: 600, background: `${PERSPECTIVE_COLORS[activePerspective]}22` }}>
                          <td>{PERSPECTIVE_NAMES[activePerspective]}</td>
                          <td className="text-right">{fmt(activeScenarioData.summary.finalNetWealthEur)}</td>
                          <td className="text-right text-muted">Simulación completa</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Tab: Auditoría */}
          {detailTab === "auditoria" && (
            <>
              <PlanSnapshotSection projection={projection} loading={false} error={null} />
              <ContributionLedgerSection
                ledger={projection.contributionLedger}
                ceroScenario={projection.scenarios.find(s => s.scenario === "cero") ?? null}
                wealthFloorViolations={projection.wealthFloorViolations ?? []}
                orderingViolations={projection.orderingViolations ?? []}
              />
              <DataQualitySection projection={projection} activeScenario={activeScenarioData} dataScore={dataScore} />
            </>
          )}
        </>
      )}

      {/* ── Sección de objetivos (siempre visible) ── */}
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
                    Proyectado en {PERSPECTIVE_NAMES[activePerspective]}: {fmt(projectedGoal.projectedAssignedEur)} asignados por prioridad.
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
                : "Error al cargar el estado del plan."}
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

// ─── Gráfico evolutivo ───────────────────────────────────────────────────────

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
  const w = 100;

  const toXY = (i: number, value: number) => ({
    x: (i / (points.length - 1)) * w,
    y: h - (value / (maxWealth || 1)) * h * 0.9,
  });

  const grossLine = points.map((p, i) => { const { x, y } = toXY(i, p.grossWealthEur); return `${x},${y}`; }).join(" ");
  const netLine   = points.map((p, i) => { const { x, y } = toXY(i, p.netWealthEur);   return `${x},${y}`; }).join(" ");
  const portLine  = points.map((p, i) => { const { x, y } = toXY(i, p.portfolioValueEur); return `${x},${y}`; }).join(" ");

  const activePerspective = (Object.entries(PERSPECTIVE_SCENARIO) as [PerspectiveKey, ActiveScenario][]).find(([, s]) => s === activeScenario)?.[0];
  const color = activePerspective ? PERSPECTIVE_COLORS[activePerspective] : SCENARIO_COLORS[activeScenario] ?? "var(--color-primary)";
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
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: 200, overflow: "visible" }} preserveAspectRatio="none">
        <polyline points={grossLine} fill="none" stroke={color} strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
        <polyline points={netLine}   fill="none" stroke={color} strokeWidth="0.6" strokeDasharray="2,1" vectorEffect="non-scaling-stroke" opacity="0.7" />
        <polyline points={portLine}  fill="none" stroke="var(--color-muted-fg)" strokeWidth="0.5" strokeDasharray="1,1.5" vectorEffect="non-scaling-stroke" opacity="0.5" />
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
        {active.label} · {points.length} periodos mensuales ·
        <strong> Simulación hipotética, no asesoramiento financiero.</strong>
      </p>
    </div>
  );
}

// ─── Desglose de estrategia ──────────────────────────────────────────────────

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
          Desglose de activos — {scenario.label}
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
          <>
            <div className="perspectives-cycle-table-wrapper" style={{ marginTop: "1rem" }}>
              <table className="perspectives-cycle-table">
                <thead>
                  <tr>
                    <th>Activo</th>
                    <th className="text-right">Saldo final</th>
                    <th className="text-right">Precio prev.</th>
                    <th className="text-right">Valor final</th>
                    <th className="text-right">Aportado</th>
                    <th className="text-right">Vendido</th>
                    <th className="text-right">Recomprado</th>
                    <th className="text-right">Realizado</th>
                    <th className={`text-right`}>Latente</th>
                    <th className="text-right">Tasa</th>
                  </tr>
                </thead>
                <tbody>
                  {scenario.assetResults.map(asset => (
                    <tr key={asset.assetId}>
                      <td><strong>{asset.assetId}</strong></td>
                      <td className="text-right">{asset.finalBalance.toLocaleString("es-ES", { maximumFractionDigits: 6 })}</td>
                      <td className="text-right">{asset.finalPriceEur != null ? fmt(asset.finalPriceEur) : "—"}</td>
                      <td className="text-right"><strong>{fmt(asset.finalValueEur)}</strong></td>
                      <td className="text-right">{fmt(asset.costContributionsEur)}</td>
                      <td className="text-right">{asset.balanceSold > 0 ? asset.balanceSold.toLocaleString("es-ES", { maximumFractionDigits: 6 }) : "—"}</td>
                      <td className="text-right">{fmt(asset.costRebuyEur)}</td>
                      <td className={`text-right ${(asset.realizedGainEur ?? 0) >= 0 ? "text-success" : "text-danger"}`}>
                        {(asset.realizedGainEur ?? 0) !== 0 ? fmt(asset.realizedGainEur) : "—"}
                      </td>
                      <td className={`text-right ${(asset.unrealizedGainEur ?? 0) >= 0 ? "text-success" : "text-danger"}`}>
                        {fmt(asset.unrealizedGainEur)}
                      </td>
                      <td className="text-right" style={{ fontSize: "0.75rem", color: "var(--color-muted-fg)" }}>
                        {asset.hypothesis != null
                          ? `${(asset.hypothesis.annualGrowthRate * 100).toFixed(0)}%→${(asset.hypothesis.terminalAnnualRate * 100).toFixed(0)}%`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Trayectoria anual de precios por activo */}
            {scenario.assetResults.some(a => (a.annualPriceTrajectory?.length ?? 0) > 0) && (
              <details style={{ marginTop: "1rem" }}>
                <summary style={{ cursor: "pointer", fontSize: "0.85rem", color: "var(--color-muted-fg)", padding: "0.25rem 0" }}>
                  Trayectoria de precios por activo ({scenario.scenario})
                </summary>
                <div className="perspectives-cycle-table-wrapper" style={{ marginTop: "0.5rem" }}>
                  <table className="perspectives-cycle-table" style={{ fontSize: "0.8rem" }}>
                    <thead>
                      <tr>
                        <th>Año</th>
                        {scenario.assetResults.filter(a => (a.annualPriceTrajectory?.length ?? 0) > 0).map(a => (
                          <th key={a.assetId} className="text-right">{a.assetId}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const assetsWithTraj = scenario.assetResults.filter(a => (a.annualPriceTrajectory?.length ?? 0) > 0);
                        const years = assetsWithTraj[0]?.annualPriceTrajectory?.map(p => p.year) ?? [];
                        return years.map(yr => (
                          <tr key={yr}>
                            <td><strong>{yr}</strong></td>
                            {assetsWithTraj.map(a => {
                              const point = a.annualPriceTrajectory?.find(p => p.year === yr);
                              return <td key={a.assetId} className="text-right">{point ? fmt(point.priceEur) : "—"}</td>;
                            })}
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Calidad e hipótesis ─────────────────────────────────────────────────────

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
        <CardTitle>Fórmulas e hipótesis utilizadas</CardTitle>
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
            Simulación mes a mes acumulativa: cada mes parte del resultado del mes anterior.
            Cada activo usa su propia hipótesis de crecimiento con fases del ciclo de halving (bull/corrección/recuperación).
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

// ─── GoalForm ────────────────────────────────────────────────────────────────

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
