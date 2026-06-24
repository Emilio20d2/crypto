// Escenarios de simulación en la página de Plan.
// Consume persp2:getSimulation (el mismo motor que Perspectivas) en modo simulación,
// sin crear alertas reales. Permite configurar el horizonte y el escenario.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/Card";
import { LoadingState } from "../../components/LoadingState";
import { ErrorState } from "../../components/ErrorState";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Badge } from "../../components/Badge";

type SimScenario = "conservador" | "moderado" | "base" | "favorable" | "optimista";

const SCENARIO_LABELS: Record<SimScenario, string> = {
  conservador: "Conservador",
  moderado: "Moderado",
  base: "Base",
  favorable: "Favorable",
  optimista: "Optimista",
};

const HORIZON_OPTIONS = [3, 5, 7, 10, 15, 20];
const SCENARIO_OPTS: { value: SimScenario; label: string }[] = [
  { value: "conservador", label: "Conservador" },
  { value: "moderado", label: "Moderado" },
  { value: "base", label: "Base" },
  { value: "favorable", label: "Favorable" },
  { value: "optimista", label: "Optimista" },
];

const _eur2 = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
function fmt(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  return _eur2.format(v);
}
function fmtSign(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${_eur2.format(v)}`;
}
function fmtPct(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

async function unwrap<T>(p: Promise<{ ok: boolean; data?: T; error?: { message: string } }>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(r.error?.message ?? "Error");
  return r.data as T;
}

function KpiRow({ label, value, color }: { label: string; value: string; color?: "pos" | "neg" | "warn" | "muted" }) {
  const valueClass = color === "pos" ? "text-gain" : color === "neg" ? "text-loss" : color === "warn" ? "text-warning" : "";
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs font-semibold font-mono ${valueClass}`}>{value}</span>
    </div>
  );
}

export function PlanEscenarios() {
  const [horizonYears, setHorizonYears] = useState(10);
  const [selectedScenario, setSelectedScenario] = useState<SimScenario>("base");

  const simQuery = useQuery({
    queryKey: ["persp2:getSimulation", horizonYears],
    queryFn: () => unwrap(window.cryptoControl.persp2.getSimulation({ horizonYears, policy: "full_strategy" }) as any),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  if (simQuery.isLoading) return <LoadingState message="Calculando escenarios de simulación…" />;
  if (simQuery.error) return <ErrorState message={(simQuery.error as Error).message} />;
  const simData = simQuery.data as any;
  if (!simData) return null;

  const scenarios = Array.isArray(simData?.scenarios) ? simData.scenarios : [];
  const activeScenario = scenarios.find((s: any) => s.scenario === selectedScenario);
  const sum = activeScenario?.summary;

  return (
    <div className="space-y-3">

      {/* Controles + nota */}
      <Card>
        <CardContent className="pt-3 pb-3 space-y-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Horizonte temporal</span>
            <div className="flex gap-1.5 flex-wrap">
              {HORIZON_OPTIONS.map(y => (
                <button
                  key={y}
                  type="button"
                  onClick={() => setHorizonYears(y)}
                  className={`px-2.5 py-0.5 rounded text-xs border transition-colors ${horizonYears === y ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-foreground"}`}
                >
                  {y}a
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Escenario</span>
            <SegmentedControl
              value={selectedScenario}
              options={SCENARIO_OPTS}
              onChange={v => setSelectedScenario(v as SimScenario)}
              label="Escenario"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Mismo motor que Perspectivas, con las reglas y activos del plan vigente. Las señales son proyecciones — no generan alertas reales.
          </p>
        </CardContent>
      </Card>

      {/* KPIs + comparación en fila */}
      <div className="grid grid-cols-1 gap-3">

        {sum && (
          <Card>
            <CardHeader className="pb-1 pt-3">
              <CardTitle className="text-sm">
                {SCENARIO_LABELS[selectedScenario]} — {horizonYears} años
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-3">
              <KpiRow label="Patrimonio inicial" value={fmt(sum.initialWealthEur)} />
              <KpiRow
                label="Patrimonio final neto"
                value={fmt(sum.finalNetWealthEur)}
                color={sum.finalNetWealthEur >= sum.initialWealthEur ? "pos" : "neg"}
              />
              <KpiRow label="Capital aportado" value={fmt(sum.totalContributionsEur)} />
              <KpiRow
                label="Ganancia de mercado"
                value={fmtSign(sum.totalMarketGainEur)}
                color={sum.totalMarketGainEur >= 0 ? "pos" : "neg"}
              />
              {sum.twr != null && (
                <KpiRow
                  label="TWR acumulado"
                  value={fmtPct(sum.twr * 100)}
                  color={sum.twr >= 0 ? "pos" : "neg"}
                />
              )}
              {sum.xirr != null && (
                <KpiRow
                  label="XIRR anualizado"
                  value={fmtPct(sum.xirr * 100)}
                  color={sum.xirr >= 0 ? "pos" : "neg"}
                />
              )}
              {sum.maxDrawdownPct != null && (
                <KpiRow label="Drawdown máximo" value={fmtPct(sum.maxDrawdownPct)} color="neg" />
              )}
              {sum.totalSalesEur > 0 && (
                <KpiRow label="Ventas simuladas" value={fmt(sum.totalSalesEur)} color="warn" />
              )}
              {sum.totalRebuysEur > 0 && (
                <KpiRow label="Recompras simuladas" value={fmt(sum.totalRebuysEur)} color="pos" />
              )}
              {sum.totalEurcReinvestedEur > 0 && (
                <KpiRow label="Reinv. residual EURC" value={fmt(sum.totalEurcReinvestedEur)} />
              )}
            </CardContent>
          </Card>
        )}

        {/* Comparación de escenarios */}
        {simData.scenarios?.length > 0 && (
          <Card>
            <CardHeader className="pb-1 pt-3">
              <CardTitle className="text-sm">Comparación a {horizonYears} años</CardTitle>
            </CardHeader>
            <CardContent className="pb-3">
              <div className="responsive-table persp-table">
                <table>
                  <thead>
                    <tr>
                      <th>Escenario</th>
                      <th className="num">Patrimonio</th>
                      <th className="num">XIRR</th>
                      <th className="num">Drawdown</th>
                    </tr>
                  </thead>
                  <tbody>
                    {simData.scenarios.map((s: any) => (
                      <tr
                        key={s.scenario}
                        className={s.scenario === selectedScenario ? "bg-muted/30" : ""}
                        style={{ cursor: "pointer" }}
                        onClick={() => setSelectedScenario(s.scenario as SimScenario)}
                      >
                        <td className="font-medium text-xs">{SCENARIO_LABELS[s.scenario as SimScenario]}</td>
                        <td className={`num text-xs ${s.summary.finalNetWealthEur >= s.summary.initialWealthEur ? "text-gain" : "text-loss"}`}>
                          {fmt(s.summary.finalNetWealthEur)}
                        </td>
                        <td className="num text-xs">
                          {s.summary.xirr != null ? fmtPct(s.summary.xirr * 100) : "—"}
                        </td>
                        <td className="num text-xs text-loss">
                          {s.summary.maxDrawdownPct != null ? fmtPct(s.summary.maxDrawdownPct) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

      </div>

      {/* Tabla anual */}
      {activeScenario?.annualSnapshots?.length > 0 && (
        <Card>
          <CardHeader className="pb-1 pt-3">
            <CardTitle className="text-sm">Evolución anual — {SCENARIO_LABELS[selectedScenario]}</CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <div className="responsive-table persp-table">
              <table>
                <thead>
                  <tr>
                    <th>Año</th>
                    <th className="num">Patrimonio</th>
                    <th className="num">Ganancia</th>
                    <th className="num">TWR</th>
                    <th className="num">Ventas</th>
                    <th className="num">Impuesto</th>
                  </tr>
                </thead>
                <tbody>
                  {activeScenario.annualSnapshots.map((snap: any) => (
                    <tr key={snap.year}>
                      <td className="text-xs">
                        {snap.year}
                        {snap.scope === "extrapol" && (
                          <Badge variant="neutral">ext</Badge>
                        )}
                      </td>
                      <td className="num text-xs font-semibold">{fmt(snap.closingWealthEur)}</td>
                      <td className={`num text-xs ${snap.marketGainEur >= 0 ? "text-gain" : "text-loss"}`}>
                        {fmtSign(snap.marketGainEur)}
                      </td>
                      <td className={`num text-xs ${(snap.annualReturnPct ?? 0) >= 0 ? "text-gain" : "text-loss"}`}>
                        {snap.annualReturnPct != null ? fmtPct(snap.annualReturnPct) : "—"}
                      </td>
                      <td className="num text-xs">{snap.salesEur > 0.01 ? fmt(snap.salesEur) : "—"}</td>
                      <td className="num text-xs text-muted-foreground">{snap.taxEur > 0.01 ? fmt(snap.taxEur) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
