import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Info, Clock, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/Card";
import type { PlanMonitoringSummary, PlanAlert, AssetPlanStatus } from "@crypto-control/core";
import type { Result } from "@crypto-control/core";

async function unwrap<T>(p: Promise<Result<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
}

function formatEur(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function formatPct(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toFixed(1) + "%";
}

// ── Alert icon and colour mapping ─────────────────────────────────────────────

function AlertIcon({ priority }: { priority: string }) {
  if (priority === "critica" || priority === "alta")
    return <AlertTriangle size={14} style={{ color: "var(--color-danger, #dc2626)" }} />;
  if (priority === "media")
    return <Clock size={14} style={{ color: "var(--color-warning-text, #92400e)" }} />;
  return <Info size={14} style={{ color: "var(--color-text-muted)" }} />;
}

function alertBadgeClass(priority: string): string {
  if (priority === "critica" || priority === "alta") return "badge badge-danger";
  if (priority === "media") return "badge badge-warning";
  return "badge badge-secondary";
}

// ── Asset health badge ────────────────────────────────────────────────────────

function HealthBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    excelente:  { cls: "badge badge-success", label: "Excelente" },
    buena:      { cls: "badge badge-success", label: "Buena" },
    neutral:    { cls: "badge badge-secondary", label: "Neutral" },
    vigilancia: { cls: "badge badge-warning", label: "Vigilancia" },
    activada:   { cls: "badge badge-warning", label: "Activada" },
    critica:    { cls: "badge badge-danger", label: "Crítica" },
  };
  const { cls, label } = map[status] ?? { cls: "badge", label: status };
  return <span className={cls}>{label}</span>;
}

// ── Alert card ────────────────────────────────────────────────────────────────

function AlertCard({ alert }: { alert: PlanAlert }) {
  return (
    <article className="substitution-card" style={{ borderLeft: `3px solid var(--color-${alert.priority === "alta" || alert.priority === "critica" ? "danger" : alert.priority === "media" ? "warning-text" : "border"}, #e2e8f0)` }}>
      <div className="substitution-card-header">
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <AlertIcon priority={alert.priority} />
          <strong style={{ fontSize: "0.88rem" }}>{alert.message}</strong>
        </span>
        <span className={alertBadgeClass(alert.priority)}>{alert.priority}</span>
      </div>
      {alert.assetId && <p className="substitution-meta">{alert.assetId}</p>}
      {alert.actionAvailable && (
        <p className="substitution-notes" style={{ fontStyle: "normal", color: "var(--color-primary, #2563eb)" }}>
          Acción: {alert.actionAvailable}
        </p>
      )}
    </article>
  );
}

// ── Asset status row ──────────────────────────────────────────────────────────

function AssetStatusRow({ s }: { s: AssetPlanStatus }) {
  return (
    <tr>
      <td style={{ fontWeight: 600 }}>{s.assetId}</td>
      <td><HealthBadge status={s.healthStatus} /></td>
      <td style={{ textAlign: "right" }}>{formatEur(s.currentValueEur)}</td>
      <td style={{ textAlign: "right" }}>
        {s.targetAllocationPct != null ? `${s.targetAllocationPct}%` : "—"}
      </td>
      <td style={{ textAlign: "right" }}>
        {s.deviationPct != null ? `${s.deviationPct > 0 ? "+" : ""}${s.deviationPct.toFixed(1)}%` : "—"}
      </td>
      <td style={{ textAlign: "right", color: (s.deviationEur ?? 0) < 0 ? "var(--color-danger, #dc2626)" : "inherit" }}>
        {s.deviationEur != null ? `${s.deviationEur > 0 ? "+" : ""}${formatEur(s.deviationEur)}` : "—"}
      </td>
      <td style={{ textAlign: "right" }}>
        {s.goalProgress != null ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            {s.goalProgress.toFixed(0)}%
            {s.goalProgress >= 100 && <CheckCircle2 size={12} style={{ color: "var(--color-success, #16a34a)" }} />}
            {s.goalProgress >= 90 && s.goalProgress < 100 && <TrendingDown size={12} style={{ color: "var(--color-warning-text, #92400e)" }} />}
          </span>
        ) : "—"}
      </td>
    </tr>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function PlanSeguimiento({ cycleId }: { cycleId: string }) {
  const summaryQ = useQuery<PlanMonitoringSummary>({
    queryKey: ["plan-monitoring", cycleId],
    queryFn: () => unwrap(window.cryptoControl.planMonitoring.getSummary({ cycleId })),
    staleTime: 30_000,
    refetchInterval: 120_000,
  });

  if (summaryQ.isLoading) {
    return <p style={{ padding: 20, color: "var(--color-text-muted)" }}>Cargando seguimiento…</p>;
  }
  if (summaryQ.isError) {
    return <p style={{ padding: 20, color: "var(--color-danger, #dc2626)" }}>Error cargando seguimiento: {String(summaryQ.error)}</p>;
  }

  const s = summaryQ.data!;
  const criticalAlerts = s.alerts.filter(a => a.priority === "critica" || a.priority === "alta");
  const otherAlerts = s.alerts.filter(a => a.priority !== "critica" && a.priority !== "alta");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Resumen global ── */}
      <Card>
        <CardHeader><CardTitle>Resumen del plan</CardTitle></CardHeader>
        <CardContent>
          <div className="plan-metrics-grid">
            <div className="plan-metric-card">
              <p className="plan-metric-label">Cumplimiento</p>
              <p className="plan-metric-value" style={{ color: (s.compliancePercentage ?? 0) >= 90 ? "var(--color-success, #16a34a)" : "var(--color-warning-text, #92400e)" }}>
                {formatPct(s.compliancePercentage)}
              </p>
              <p className="plan-metric-sub">De contribuciones</p>
            </div>
            <div className="plan-metric-card">
              <p className="plan-metric-label">Déficit</p>
              <p className="plan-metric-value" style={{ color: (s.deficitEur ?? 0) > 0 ? "var(--color-danger, #dc2626)" : "inherit" }}>
                {formatEur(s.deficitEur)}
              </p>
              <p className="plan-metric-sub">Pendiente de regularizar</p>
            </div>
            <div className="plan-metric-card">
              <p className="plan-metric-label">Objetivos alcanzados</p>
              <p className="plan-metric-value">{s.goalsReached ?? 0} / {s.activeAssets ?? 0}</p>
              <p className="plan-metric-sub">Activos</p>
            </div>
            <div className="plan-metric-card">
              <p className="plan-metric-label">EURC disponible</p>
              <p className="plan-metric-value">{formatEur(s.eurcAvailable)}</p>
              <p className="plan-metric-sub">Para recompras</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Alertas ── */}
      {s.alerts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Alertas activas</CardTitle>
            {criticalAlerts.length > 0 && <span className="badge badge-danger">{criticalAlerts.length} críticas</span>}
          </CardHeader>
          <CardContent>
            <div className="substitution-list">
              {criticalAlerts.map(a => <AlertCard key={a.id} alert={a} />)}
              {otherAlerts.map(a => <AlertCard key={a.id} alert={a} />)}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Estado por activo ── */}
      {s.assetStatuses && s.assetStatuses.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Estado por activo</CardTitle></CardHeader>
          <CardContent>
            <div style={{ overflowX: "auto" }}>
              <table className="data-table" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th>Activo</th>
                    <th>Salud</th>
                    <th style={{ textAlign: "right" }}>Valor actual</th>
                    <th style={{ textAlign: "right" }}>Objetivo %</th>
                    <th style={{ textAlign: "right" }}>Real %</th>
                    <th style={{ textAlign: "right" }}>Desviación</th>
                    <th style={{ textAlign: "right" }}>Progreso</th>
                  </tr>
                </thead>
                <tbody>
                  {s.assetStatuses.map(as => <AssetStatusRow key={as.assetId} s={as} />)}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Info general ── */}
      {s.alerts.length === 0 && (
        <Card>
          <CardContent>
            <p style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--color-success, #16a34a)", padding: "12px 0" }}>
              <CheckCircle2 size={16} /> Plan en buen estado. Sin alertas activas.
            </p>
          </CardContent>
        </Card>
      )}

      <p style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", textAlign: "right" }}>
        Actualizado: {new Date(s.generatedAt).toLocaleString("es-ES")}
      </p>

    </div>
  );
}
