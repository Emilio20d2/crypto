import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, AlertCircle, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent } from "../../components/Card";
import type {
  ContributionMonthlySummary,
  CycleContributionAggregates,
  InvestmentCycle,
  InvestmentPlan,
  Result,
} from "@crypto-control/core";
import { formatMoney } from "../../lib/format";

async function unwrap<T>(p: Promise<Result<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
}

function formatMonthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
}

const STATUS_CONFIG: Record<string, { label: string; badge: string; icon: React.ReactNode }> = {
  prevista:  { label: "Prevista",  badge: "badge-secondary", icon: <Clock size={12} /> },
  pendiente: { label: "Pendiente", badge: "badge-warning",   icon: <Clock size={12} /> },
  parcial:   { label: "Parcial",   badge: "badge-warning",   icon: <TrendingDown size={12} /> },
  cumplida:  { label: "Cumplida",  badge: "badge-success",   icon: <CheckCircle2 size={12} /> },
  superada:  { label: "Superada",  badge: "badge-success",   icon: <TrendingUp size={12} /> },
  omitida:   { label: "Omitida",   badge: "badge-error",     icon: <AlertCircle size={12} /> },
  cancelada: { label: "Cancelada", badge: "badge-secondary", icon: <Minus size={12} /> },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, badge: "badge", icon: null };
  return (
    <span className={`badge ${cfg.badge} badge-sm`} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function pickUsableCycle(current: InvestmentCycle | null | undefined, cycles: InvestmentCycle[] | undefined) {
  return current
    ?? cycles?.find((item) => item.status === "active")
    ?? cycles?.find((item) => item.status === "planned")
    ?? cycles?.[0]
    ?? null;
}

// ── Metric card ───────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="plan-metric-card">
      <span className="plan-metric-label">{label}</span>
      <span className="plan-metric-value">{value}</span>
      {sub ? <span className="plan-metric-sub">{sub}</span> : null}
    </div>
  );
}

// ── Monthly history row ───────────────────────────────────────────────────────

function MonthRow({ summary }: { summary: ContributionMonthlySummary }) {
  return (
    <div className="contribution-month-row">
      <div className="contribution-month-col contribution-month-label">
        <span className="contribution-month-name">{formatMonthLabel(summary.yearMonth)}</span>
      </div>
      <div className="contribution-month-col contribution-month-planned">
        {formatMoney(summary.plannedAmountEur)}
      </div>
      <div className="contribution-month-col contribution-month-actual">
        {summary.actualAmountEur > 0 ? formatMoney(summary.actualAmountEur) : "—"}
      </div>
      <div className="contribution-month-col contribution-month-extra">
        {summary.extraordinaryAmountEur > 0 ? (
          <span style={{ color: "var(--color-success)" }}>+{formatMoney(summary.extraordinaryAmountEur)}</span>
        ) : "—"}
      </div>
      <div className="contribution-month-col contribution-month-deficit">
        {summary.deficitAmountEur > 0 ? (
          <span style={{ color: "var(--color-error)" }}>-{formatMoney(summary.deficitAmountEur)}</span>
        ) : "—"}
      </div>
      <div className="contribution-month-col">
        <StatusBadge status={summary.status} />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function PlanAportaciones() {
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
  const currentCycle = pickUsableCycle(currentCycleQ.data, cyclesQ.data);

  const monthlySummaryQ = useQuery<{ summaries: ContributionMonthlySummary[]; aggregates: CycleContributionAggregates } | null>({
    queryKey: ["contribution-monthly-summary", currentCycle?.id],
    enabled: Boolean(currentCycle?.id),
    queryFn: () => unwrap(window.cryptoControl.contributionSchedule.getMonthlySummary({ cycleId: currentCycle!.id })),
    staleTime: 30_000,
  });

  const [filter, setFilter] = useState<string>("all");

  if (activePlanQ.isLoading || currentCycleQ.isLoading || cyclesQ.isLoading) {
    return <div className="plan-section-loading">Cargando aportaciones…</div>;
  }

  if (!activePlan) {
    return (
      <Card>
        <CardContent>
          <p>No hay ningún plan activo. Ve a <strong>Resumen</strong> para configurar tu plan.</p>
        </CardContent>
      </Card>
    );
  }

  if (!currentCycle) {
    return (
      <Card>
        <CardContent>
          <p>No hay un ciclo activo en este momento. Configura un ciclo en <strong>Configurar mi plan</strong>.</p>
        </CardContent>
      </Card>
    );
  }

  const summaries = monthlySummaryQ.data?.summaries ?? [];
  const agg = monthlySummaryQ.data?.aggregates ?? null;

  // Current month summary (last non-prevista or last)
  const currentSummary = summaries.find(s => s.status === "pendiente" || s.status === "cumplida" || s.status === "superada" || s.status === "parcial")
    ?? summaries.at(-1) ?? null;

  const filteredSummaries = filter === "all"
    ? summaries
    : summaries.filter(s => s.status === filter);

  const compliance = agg?.compliancePercentage;

  return (
    <div className="plan-aportaciones">
      {/* ── Resumen del mes actual ── */}
      <section className="plan-section">
        <h2 className="plan-section-title">Mes actual</h2>
        <p className="panel-caption">Aportaciones reales sincronizadas desde Operaciones/Coinbase. No hay registro manual en esta pantalla.</p>
        {currentSummary ? (
          <div className="plan-metrics-grid">
            <MetricCard
              label="Programado"
              value={formatMoney(currentCycle.monthlyAmountEur)}
              sub="mensual según el plan"
            />
            <MetricCard
              label="Capital nuevo aportado"
              value={currentSummary.actualAmountEur > 0 ? formatMoney(currentSummary.actualAmountEur) : "Sin datos"}
              sub={currentSummary.status === "pendiente" ? "mes abierto" : undefined}
            />
            <MetricCard
              label="Parte programada"
              value={formatMoney(currentSummary.scheduledPortionEur)}
              sub="de la aportación mensual"
            />
            <MetricCard
              label="Extraordinaria"
              value={currentSummary.extraordinaryAmountEur > 0 ? formatMoney(currentSummary.extraordinaryAmountEur) : "—"}
              sub="por encima del plan"
            />
            <MetricCard
              label="Déficit"
              value={currentSummary.deficitAmountEur > 0 ? formatMoney(currentSummary.deficitAmountEur) : "—"}
              sub="por debajo del plan"
            />
            <div className="plan-metric-card">
              <span className="plan-metric-label">Estado</span>
              <StatusBadge status={currentSummary.status} />
            </div>
          </div>
        ) : (
          <p className="empty-inline">Sin datos para el mes actual.</p>
        )}

      </section>

      {/* ── Acumulados del ciclo ── */}
      {agg ? (
        <section className="plan-section">
          <h2 className="plan-section-title">Acumulado del ciclo</h2>
          <div className="plan-metrics-grid">
            <MetricCard label="Total programado" value={formatMoney(agg.totalPlannedEur)} />
            <MetricCard label="Capital real aportado" value={formatMoney(agg.totalActualEur)} />
            <MetricCard label="Aportaciones extra" value={formatMoney(agg.totalExtraordinaryEur)} />
            <MetricCard label="Déficit acumulado" value={formatMoney(agg.totalDeficitEur)} />
            <MetricCard
              label="Cumplimiento"
              value={compliance != null ? `${compliance.toFixed(0)}%` : "—"}
              sub={`${agg.monthsCumplida + agg.monthsSuperada} meses cumplidos · ${agg.monthsParcial} parciales · ${agg.monthsOmitida} omitidos`}
            />
            {agg.lastContributionDate ? (
              <MetricCard
                label="Última aportación"
                value={new Date(agg.lastContributionDate).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" })}
              />
            ) : null}
          </div>
        </section>
      ) : null}

      {/* ── Historial mensual ── */}
      <section className="plan-section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h2 className="plan-section-title" style={{ margin: 0 }}>Historial mensual</h2>
          <select
            className="ui-select"
            style={{ width: "auto", fontSize: "0.85rem" }}
            value={filter}
            onChange={e => setFilter(e.target.value)}
          >
            <option value="all">Todos los estados</option>
            <option value="pendiente">Pendiente</option>
            <option value="cumplida">Cumplida</option>
            <option value="superada">Superada</option>
            <option value="parcial">Parcial</option>
            <option value="omitida">Omitida</option>
            <option value="prevista">Prevista</option>
          </select>
        </div>

        {monthlySummaryQ.isLoading ? (
          <p className="empty-inline">Cargando historial…</p>
        ) : filteredSummaries.length === 0 ? (
          <p className="empty-inline">No hay registros para este filtro.</p>
        ) : (
          <div className="contribution-history">
            <div className="contribution-month-row contribution-month-header">
              <div className="contribution-month-col contribution-month-label">Mes</div>
              <div className="contribution-month-col">Programado</div>
              <div className="contribution-month-col">Real</div>
              <div className="contribution-month-col">Extra</div>
              <div className="contribution-month-col">Déficit</div>
              <div className="contribution-month-col">Estado</div>
            </div>
            {[...filteredSummaries].reverse().map(s => (
              <MonthRow key={s.yearMonth} summary={s} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
