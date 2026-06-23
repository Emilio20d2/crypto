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

  const activeScenario = simData.scenarios?.find((s: any) => s.scenario === selectedScenario);
  const sum = activeScenario?.summary;

  return (
    <div className="space-y-4">
      {/* Nota informativa */}
      <Card>
        <CardContent className="pt-4">
          <p className="text-sm text-muted-foreground">
            Simulación con el <strong>mismo motor que Perspectivas</strong> usando las reglas de venta, tiers de recompra y activos del plan vigente.
            Las señales futuras son proyecciones — no generan alertas reales hasta que las condiciones ocurran.
            Cambia el horizonte y el escenario para explorar distintas trayectorias.
          </p>
        </CardContent>
      </Card>

      {/* Controles */}
      <Card>
        <CardContent className="pt-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Horizonte</span>
            <div className="flex gap-2 flex-wrap">
              {HORIZON_OPTIONS.map(y => (
                <button
                  key={y}
                  type="button"
                  onClick={() => setHorizonYears(y)}
                  className={`px-3 py-1 rounded text-sm border transition-colors ${horizonYears === y ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-foreground"}`}
                >
                  {y} años
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
        </CardContent>
      </Card>

      {/* KPIs del escenario seleccionado */}
      {sum && (
        <Card>
          <CardHeader>
            <CardTitle>
              Escenario {SCENARIO_LABELS[selectedScenario]} — {horizonYears} años
            </CardTitle>
          </CardHeader>
          <CardContent>
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
              <div className={`persp-kpi ${sum.totalMarketGainEur >= 0 ? "kpi-pos" : "kpi-neg"}`}>
                <span className="persp-kpi-label">Ganancia mercado</span>
                <span className="persp-kpi-value">{fmtSign(sum.totalMarketGainEur)}</span>
              </div>
              {sum.twr != null && (
                <div className={`persp-kpi ${sum.twr >= 0 ? "kpi-pos" : "kpi-neg"}`}>
                  <span className="persp-kpi-label">TWR acumulado</span>
                  <span className="persp-kpi-value">{fmtPct(sum.twr * 100)}</span>
                </div>
              )}
              {sum.xirr != null && (
                <div className={`persp-kpi ${sum.xirr >= 0 ? "kpi-pos" : "kpi-neg"}`}>
                  <span className="persp-kpi-label">XIRR</span>
                  <span className="persp-kpi-value">{fmtPct(sum.xirr * 100)}</span>
                </div>
              )}
              {sum.maxDrawdownPct != null && (
                <div className="persp-kpi kpi-neg">
                  <span className="persp-kpi-label">Drawdown máx.</span>
                  <span className="persp-kpi-value">{fmtPct(sum.maxDrawdownPct)}</span>
                </div>
              )}
              {sum.totalSalesEur > 0 && (
                <div className="persp-kpi kpi-warn">
                  <span className="persp-kpi-label">Ventas simuladas</span>
                  <span className="persp-kpi-value">{fmt(sum.totalSalesEur)}</span>
                </div>
              )}
              {sum.totalRebuysEur > 0 && (
                <div className="persp-kpi kpi-pos">
                  <span className="persp-kpi-label">Recompras simuladas</span>
                  <span className="persp-kpi-value">{fmt(sum.totalRebuysEur)}</span>
                </div>
              )}
              {sum.totalEurcReinvestedEur > 0 && (
                <div className="persp-kpi">
                  <span className="persp-kpi-label">Reinv. residual EURC</span>
                  <span className="persp-kpi-value">{fmt(sum.totalEurcReinvestedEur)}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabla anual */}
      {activeScenario?.annualSnapshots?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Evolución anual</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="responsive-table persp-table">
              <table>
                <thead>
                  <tr>
                    <th>Año</th>
                    <th className="num">Patrimonio</th>
                    <th className="num">Ganancia</th>
                    <th className="num">TWR</th>
                    <th className="num">Ventas</th>
                    <th className="num">Recompras</th>
                    <th className="num">Impuesto</th>
                  </tr>
                </thead>
                <tbody>
                  {activeScenario.annualSnapshots.map((snap: any) => (
                    <tr key={snap.year}>
                      <td>
                        {snap.year}
                        {snap.scope === "extrapol" && (
                          <Badge variant="neutral">ext</Badge>
                        )}
                      </td>
                      <td className="num font-semibold">{fmt(snap.closingWealthEur)}</td>
                      <td className={`num ${snap.marketGainEur >= 0 ? "text-gain" : "text-loss"}`}>
                        {fmtSign(snap.marketGainEur)}
                      </td>
                      <td className={`num ${(snap.annualReturnPct ?? 0) >= 0 ? "text-gain" : "text-loss"}`}>
                        {snap.annualReturnPct != null ? fmtPct(snap.annualReturnPct) : "—"}
                      </td>
                      <td className="num">{snap.salesEur > 0.01 ? fmt(snap.salesEur) : "—"}</td>
                      <td className="num">{snap.rebuysEur > 0.01 ? fmt(snap.rebuysEur) : "—"}</td>
                      <td className="num text-muted-foreground">{snap.taxEur > 0.01 ? fmt(snap.taxEur) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Comparación de escenarios */}
      {simData.scenarios?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Comparación de escenarios a {horizonYears} años</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="responsive-table persp-table">
              <table>
                <thead>
                  <tr>
                    <th>Escenario</th>
                    <th className="num">Patrimonio final</th>
                    <th className="num">Ganancia total</th>
                    <th className="num">XIRR</th>
                    <th className="num">Drawdown máx.</th>
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
                      <td className="font-medium">{SCENARIO_LABELS[s.scenario as SimScenario]}</td>
                      <td className={`num ${s.summary.finalNetWealthEur >= s.summary.initialWealthEur ? "text-gain" : "text-loss"}`}>
                        {fmt(s.summary.finalNetWealthEur)}
                      </td>
                      <td className={`num ${s.summary.totalMarketGainEur >= 0 ? "text-gain" : "text-loss"}`}>
                        {fmtSign(s.summary.totalMarketGainEur)}
                      </td>
                      <td className="num">
                        {s.summary.xirr != null ? fmtPct(s.summary.xirr * 100) : "—"}
                      </td>
                      <td className="num text-loss">
                        {s.summary.maxDrawdownPct != null ? fmtPct(s.summary.maxDrawdownPct) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Las ventas y recompras simuladas usan exactamente las mismas reglas configuradas en el Plan.
              Si no hay reglas, se aplican umbrales automáticos (±50% / −15%) como fallback.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
