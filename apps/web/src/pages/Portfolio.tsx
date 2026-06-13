import { useQuery, useQueries } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { createChart, LineSeries } from "lightweight-charts";
import { CryptoLogo } from "../components/CryptoLogo";
import { EmptyState } from "../components/EmptyState";
import { Card, CardHeader, CardTitle, CardContent } from "../components/Card";
import { StatCard } from "../components/StatCard";
import { ErrorState } from "../components/ErrorState";
import { ResponsiveTable } from "../components/ResponsiveTable";
import { PriceDisplay } from "../components/PriceDisplay";
import type { AssetAllocation } from "@crypto-control/portfolio";

function Sparkline({ data, positive = true }: { data: { time: number; value: number }[]; positive?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    const chart = createChart(containerRef.current, {
      width: 80,
      height: 28,
      layout: { background: { color: "transparent" }, textColor: "transparent" },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { visible: false },
      timeScale: { visible: false },
      crosshair: { vertLine: { visible: false }, horzLine: { visible: false } },
      handleScroll: false,
      handleScale: false,
    });

    const series = chart.addSeries(LineSeries, {
      color: positive ? "var(--color-success-text)" : "var(--color-danger)",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    series.setData(data.map(d => ({ time: d.time as import("lightweight-charts").Time, value: d.value })));
    chart.timeScale().fitContent();

    return () => { chart.remove(); };
  }, [data, positive]);

  return <div ref={containerRef} style={{ width: 80, height: 28 }} />;
}

function PortfolioRowSparkline({ assetId }: { assetId: string }) {
  const { data: historyRes } = useQuery({
    queryKey: ["market", "history", assetId, "24h"],
    queryFn: () => window.cryptoControl.market.getHistoricalPrices({ assetId, period: "24h", quoteCurrency: "EUR" }),
    staleTime: 60_000,
  });

  if (!historyRes?.ok || !historyRes.data || historyRes.data.points.length < 2) {
    return <span className="text-muted-color text-sm">—</span>;
  }

  const pts = historyRes.data.points;
  const positive = pts[pts.length - 1].value >= pts[0].value;
  return <Sparkline data={pts} positive={positive} />;
}

const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

export function Portfolio() {
  const { data: summaryRes,    isLoading: l1 } = useQuery({ queryKey: ["portfolio", "summary"],    queryFn: () => window.cryptoControl.portfolio.getSummary() });
  const { data: positionsRes,  isLoading: l2 } = useQuery({ queryKey: ["portfolio", "positions"],  queryFn: () => window.cryptoControl.portfolio.getPositions() });
  const { data: allocationRes, isLoading: l3 } = useQuery({ queryKey: ["portfolio", "allocation"], queryFn: () => window.cryptoControl.portfolio.getAllocation() });
  const { data: assetsRes }                     = useQuery({ queryKey: ["assets"],                  queryFn: () => window.cryptoControl.assets.list() });
  const { data: targetRes }                     = useQuery({ queryKey: ["settings", "portfolio_target"], queryFn: () => window.cryptoControl.settings.get("portfolio_target") });

  const allocationData = allocationRes?.ok ? allocationRes.data : [];

  const histories = useQueries({
    queries: allocationData.map((alloc: AssetAllocation) => ({
      queryKey: ["market", "history", alloc.assetId, "24h"],
      queryFn: () => window.cryptoControl.market.getHistoricalPrices({ assetId: alloc.assetId, period: "24h", quoteCurrency: "EUR" }),
      staleTime: 60_000,
    })),
  });

  if (l1 || l2 || l3) {
    return (
      <div>
        <h1 className="page-title">Cartera</h1>
        <div className="stat-grid">
          {[...Array(4)].map((_, i) => <div key={i} className="ui-stat-card skeleton" style={{ height: 90 }} />)}
        </div>
        <Card className="skeleton" style={{ height: 300 }} />
      </div>
    );
  }

  if ((summaryRes && !summaryRes.ok) || (positionsRes && !positionsRes.ok) || (allocationRes && !allocationRes.ok)) {
    return (
      <div>
        <h1 className="page-title">Cartera</h1>
        <Card>
          <ErrorState message="No se pudo obtener la información de la cartera. Inténtalo de nuevo." />
        </Card>
      </div>
    );
  }

  const summary      = summaryRes?.data;
  const portfolioData = positionsRes?.data;
  const assets        = assetsRes?.ok ? assetsRes.data : [];

  if (!summary || !portfolioData) return null;

  if (allocationData.length === 0) {
    return (
      <div>
        <h1 className="page-title">Cartera</h1>
        <Card>
          <CardContent style={{ padding: "48px 24px" }}>
            <EmptyState
              icon="💼"
              title="Todavía no hay operaciones registradas"
              description="Añade tu primera compra, venta o conversión para comenzar a controlar tu cartera de criptomonedas."
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  let totalNow = 0;
  let total24h = 0;
  let hasHistory = false;

  for (let i = 0; i < allocationData.length; i++) {
    const alloc = allocationData[i];
    const pos   = portfolioData[alloc.assetId];
    const hist  = histories[i]?.data;
    if (hist?.ok && hist.data && hist.data.points.length >= 2) {
      const pts = hist.data.points;
      if (pos) {
        totalNow += pos.balance * pts[pts.length - 1].value;
        total24h += pos.balance * pts[0].value;
        hasHistory = true;
      }
    }
  }

  const variation24h = hasHistory && total24h > 0
    ? ((totalNow - total24h) / total24h) * 100
    : null;

  const targetValue = targetRes?.ok && targetRes.data ? parseFloat(targetRes.data) : null;
  const targetPct   = targetValue ? Math.min((summary.totalValueEur / targetValue) * 100, 100) : 0;

  return (
    <div>
      <h1 className="page-title">Cartera</h1>

      <div className="stat-grid">
        <StatCard
          label="Valor Total"
          value={<PriceDisplay value={summary.totalValueEur} />}
          subValue={
            variation24h !== null && (
              <span className={variation24h >= 0 ? "text-positive" : "text-negative"}>
                {pct(variation24h)} hoy
              </span>
            )
          }
        />
        <StatCard
          label="Capital Invertido"
          value={<PriceDisplay value={summary.totalInvestedEur} />}
        />
        <StatCard
          label="Ganancia / Pérdida"
          value={
            <span className={summary.unrealizedGainEur >= 0 ? "text-positive" : "text-negative"}>
              {summary.unrealizedGainEur >= 0 ? "+" : ""}
              <PriceDisplay value={summary.unrealizedGainEur} />
            </span>
          }
          subValue={
            <span className={summary.unrealizedGainEur >= 0 ? "text-positive" : "text-negative"}>
              {pct(summary.unrealizedGainPercentage)}
            </span>
          }
        />
        <StatCard
          label={targetValue !== null && !isNaN(targetValue) ? `Objetivo — ${new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(targetValue)}` : "Objetivo"}
          value={
            targetValue !== null && !isNaN(targetValue) ? (
              `${targetPct.toFixed(1)}%`
            ) : (
              <span style={{ fontSize: "1rem", color: "var(--text-secondary)", fontWeight: 400 }}>No configurado</span>
            )
          }
          subValue={
            targetValue !== null && !isNaN(targetValue) ? (
              <div className="progress" style={{ marginTop: 6 }}>
                <div className="progress-bar" style={{ width: `${targetPct}%` }} />
              </div>
            ) : undefined
          }
        />
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <CardHeader style={{ paddingBottom: 16, borderBottom: "1px solid var(--border)" }}>
          <CardTitle style={{ fontSize: "1rem" }}>Posiciones</CardTitle>
        </CardHeader>

        <div className="portfolio-desktop-view">
          <ResponsiveTable
            headers={[
              "Activo",
              <div className="text-right">Balance</div>,
              <div className="text-right">Precio Medio</div>,
              <div className="text-right">Precio Actual</div>,
              <div className="text-center">Tendencia</div>,
              <div className="text-right">Valor</div>,
              <div className="text-right">Coste Base</div>,
              <div className="text-right">Rentabilidad</div>,
              <div className="text-right">Peso</div>
            ]}
          >
            {allocationData.map((alloc: AssetAllocation) => {
              const pos   = portfolioData[alloc.assetId];
              if (!pos) return null;
              const asset = assets.find((a: { id: string; name: string; symbol: string; logoUrl?: string | null }) => a.id === alloc.assetId);

              const currentPrice   = pos.balance > 0 ? alloc.valueEur / pos.balance : 0;
              const unrealizedGain = alloc.valueEur - pos.totalInvestedEur;
              const unrealizedPct  = pos.totalInvestedEur > 0 ? (unrealizedGain / pos.totalInvestedEur) * 100 : 0;

              return (
                <tr key={alloc.assetId}>
                  <td>
                    <div className="asset-identity">
                      <CryptoLogo logoUrl={asset?.logoUrl} symbol={asset?.symbol || alloc.assetId} size={32} />
                      <div>
                        <div className="asset-identity-name">{asset?.name || alloc.assetId}</div>
                        <div className="asset-identity-symbol">{asset?.symbol || alloc.assetId}</div>
                        {pos.hasPendingValuation && <span className="valuation-pending">Pendiente valoración</span>}
                      </div>
                    </div>
                  </td>
                  <td className="num font-semibold">
                    {pos.balance.toLocaleString("es-ES", { maximumFractionDigits: 6 })}
                  </td>
                  <td className="num text-secondary-color">
                    {pos.averagePriceEur != null ? <PriceDisplay value={pos.averagePriceEur} /> : "—"}
                  </td>
                  <td className="num">
                    {currentPrice > 0 ? <PriceDisplay value={currentPrice} /> : "—"}
                  </td>
                  <td className="ctr">
                    <PortfolioRowSparkline assetId={alloc.assetId} />
                  </td>
                  <td className="num font-semibold"><PriceDisplay value={alloc.valueEur} /></td>
                  <td className="num text-secondary-color"><PriceDisplay value={pos.totalInvestedEur} /></td>
                  <td className="num font-semibold">
                    <span className={unrealizedGain >= 0 ? "text-positive" : "text-negative"}>
                      {unrealizedGain >= 0 ? "+" : ""}<PriceDisplay value={unrealizedGain} />
                    </span>
                    <div className={`text-xs ${unrealizedGain >= 0 ? "text-positive" : "text-negative"}`}>
                      {pct(unrealizedPct)}
                    </div>
                  </td>
                  <td className="num">{alloc.weight.toFixed(1)}%</td>
                </tr>
              );
            })}
          </ResponsiveTable>
        </div>

        <div className="portfolio-cards">
          {allocationData.map((alloc: AssetAllocation) => {
            const pos   = portfolioData[alloc.assetId];
            if (!pos) return null;
            const asset = assets.find((a: { id: string; name: string; symbol: string; logoUrl?: string | null }) => a.id === alloc.assetId);

            const currentPrice   = pos.balance > 0 ? alloc.valueEur / pos.balance : 0;
            const unrealizedGain = alloc.valueEur - pos.totalInvestedEur;
            const unrealizedPct  = pos.totalInvestedEur > 0 ? (unrealizedGain / pos.totalInvestedEur) * 100 : 0;

            return (
              <div key={alloc.assetId} className="portfolio-card">
                <div className="portfolio-card-header">
                  <div className="asset-identity">
                    <CryptoLogo logoUrl={asset?.logoUrl} symbol={asset?.symbol || alloc.assetId} size={32} />
                    <div>
                      <div className="asset-identity-name">{asset?.name || alloc.assetId}</div>
                      <div className="asset-identity-symbol">{asset?.symbol || alloc.assetId}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="font-semibold"><PriceDisplay value={alloc.valueEur} /></div>
                    <div className="text-secondary-color text-xs">{alloc.weight.toFixed(1)}% cartera</div>
                  </div>
                </div>

                <div className="portfolio-card-row">
                  <span className="portfolio-card-label">Balance</span>
                  <span className="portfolio-card-value">{pos.balance.toLocaleString("es-ES", { maximumFractionDigits: 6 })}</span>
                </div>
                <div className="portfolio-card-row">
                  <span className="portfolio-card-label">Precio Medio</span>
                  <span className="portfolio-card-value">{pos.averagePriceEur != null ? <PriceDisplay value={pos.averagePriceEur} /> : "—"}</span>
                </div>
                <div className="portfolio-card-row">
                  <span className="portfolio-card-label">Precio Actual</span>
                  <span className="portfolio-card-value">{currentPrice > 0 ? <PriceDisplay value={currentPrice} /> : "—"}</span>
                </div>
                <div className="portfolio-card-row">
                  <span className="portfolio-card-label">Tendencia</span>
                  <span className="portfolio-card-value"><PortfolioRowSparkline assetId={alloc.assetId} /></span>
                </div>
                <div className="portfolio-card-row">
                  <span className="portfolio-card-label">Coste Base</span>
                  <span className="portfolio-card-value"><PriceDisplay value={pos.totalInvestedEur} /></span>
                </div>
                <div className="portfolio-card-row">
                  <span className="portfolio-card-label">Rentabilidad</span>
                  <div className="portfolio-card-value">
                    <span className={`font-semibold ${unrealizedGain >= 0 ? "text-positive" : "text-negative"}`}>
                      {unrealizedGain >= 0 ? "+" : ""}<PriceDisplay value={unrealizedGain} />
                    </span>
                    <div className={`text-xs ${unrealizedGain >= 0 ? "text-positive" : "text-negative"}`}>
                      {pct(unrealizedPct)}
                    </div>
                  </div>
                </div>

                {pos.hasPendingValuation && (
                  <div style={{ marginTop: 8 }}>
                    <span className="valuation-pending">Pendiente de valoración</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
