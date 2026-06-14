import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createChart, LineSeries, ColorType } from "lightweight-charts";
import { Wallet } from "lucide-react";
import { CryptoLogo } from "../components/CryptoLogo";
import { EmptyState } from "../components/EmptyState";
import { Card, CardHeader, CardTitle, CardContent } from "../components/Card";
import { StatCard } from "../components/StatCard";
import { ErrorState } from "../components/ErrorState";
import { ResponsiveTable } from "../components/ResponsiveTable";
import { PriceDisplay } from "../components/PriceDisplay";
import { ErrorBoundary } from "../components/ErrorBoundary";

function Sparkline({ data, positive = true }: { data: { time: number; close: number }[]; positive?: boolean }) {
// ... resto del componente Sparkline (sin cambios) ...
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    const chart = createChart(containerRef.current, {
      width: 80,
      height: 28,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "transparent" },
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

    series.setData(data.map(d => ({ time: d.time as any, value: d.close })));
    chart.timeScale().fitContent();

    return () => { chart.remove(); };
  }, [data, positive]);

  return <div ref={containerRef} style={{ width: 80, height: 28 }} />;
}

const pct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;

export function Portfolio() {
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | null>(null);

  const { data: statusRes, isLoading: l1 } = useQuery({ 
    queryKey: ["coinbase", "status"], 
    queryFn: () => window.cryptoControl.coinbase.getStatus() 
  });

  const connected = statusRes?.ok ? statusRes.data.connected : false;

  const { data: portfoliosRes, isLoading: l2 } = useQuery({ 
    queryKey: ["coinbase", "portfolios"], 
    queryFn: () => window.cryptoControl.coinbase.listPortfolios(),
    enabled: connected
  });

  useEffect(() => {
    if (portfoliosRes?.ok && portfoliosRes.data && portfoliosRes.data.length > 0 && !selectedPortfolioId) {
      setSelectedPortfolioId(portfoliosRes.data[0].uuid);
    }
  }, [portfoliosRes, selectedPortfolioId]);

  const { data: breakdownRes, isLoading: l3 } = useQuery({ 
    queryKey: ["coinbase", "breakdown", selectedPortfolioId], 
    queryFn: () => window.cryptoControl.coinbase.getPortfolioBreakdown(selectedPortfolioId!, "EUR"),
    enabled: !!selectedPortfolioId,
    refetchInterval: 60000 // Refresca cada minuto
  });

  const { data: assetsRes } = useQuery({ 
    queryKey: ["assets"], 
    queryFn: () => window.cryptoControl.assets.list() 
  });

  if (l1 || (connected && l2) || (selectedPortfolioId && l3)) {
    return (
      <div>
        <h1 className="page-title">Cartera</h1>
        <div className="stat-grid">
          {[...Array(4)].map((_, i) => <div key={i} className="ui-stat-card skeleton" style={{ height: 90 }} />)}
        </div>
        <Card className="skeleton" style={{ height: 300, marginTop: "var(--card-gap)" }} />
      </div>
    );
  }

  if (!connected) {
    return (
      <div>
        <h1 className="page-title">Cartera</h1>
        <Card>
          <CardContent style={{ padding: "48px 24px" }}>
            <EmptyState
              icon={<Wallet size={48} strokeWidth={1.5} color="var(--text-muted)" />}
              title="Coinbase no conectado"
              description="La página de cartera profesional sincroniza tu balance directamente desde Coinbase. Ve a Ajustes > Conexión para importar tu clave CDP."
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (breakdownRes && !breakdownRes.ok) {
    return (
      <div>
        <h1 className="page-title">Cartera</h1>
        <Card>
          <ErrorState message="No se pudo obtener la información de la cartera de Coinbase. Revisa tu conexión de red o permisos API." />
        </Card>
      </div>
    );
  }

  const breakdown = breakdownRes?.data;
  const assets = assetsRes?.ok ? assetsRes.data : [];

  if (!breakdown || !breakdown.balances) return null;

  const { balances, positions, state, capturedAt } = breakdown;

  const totalValue = balances.totalBalance?.value ?? 0;
  // Sum up unrealized pnl from spots
  const totalUnrealizedPnl = positions.reduce((sum: number, p: any) => sum + (p.unrealizedPnl || 0), 0);
  const totalInvested = totalValue - totalUnrealizedPnl;
  const totalUnrealizedPct = totalInvested > 0 ? (totalUnrealizedPnl / totalInvested) * 100 : 0;

  // Let's approximate 24h variation using markets if available
  let past24hValue = 0;
  let has24hData = false;
  
  for (const pos of positions) {
    if (pos.isCash) {
      past24hValue += pos.totalBalanceFiat || 0;
    } else if (pos.market && pos.market.pricePercentageChange24h !== null) {
      const currentFiat = pos.totalBalanceFiat || 0;
      const pctChange = pos.market.pricePercentageChange24h; // e.g. 5.5 for 5.5%
      // prevPrice = currentPrice / (1 + pctChange/100)
      const pastFiat = currentFiat / (1 + pctChange / 100);
      past24hValue += pastFiat;
      has24hData = true;
    } else {
      past24hValue += pos.totalBalanceFiat || 0; // Assume no change if no data
    }
  }

  const variation24h = has24hData && past24hValue > 0 ? ((totalValue - past24hValue) / past24hValue) * 100 : null;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 24 }}>
        <h1 className="page-title" style={{ margin: 0 }}>Cartera</h1>
        <span className="text-sm text-secondary-color">
          Fuente: <strong style={{ color: "var(--color-primary)" }}>Coinbase</strong>
          {state === "cached" && " (Modo sin conexión)"}
          {state === "live" && ` • Actualizado a las ${new Date(capturedAt).toLocaleTimeString()}`}
        </span>
      </div>

      <div className="stat-grid">
        <StatCard
          label="Valor Total"
          value={<PriceDisplay value={totalValue} />}
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
          value={<PriceDisplay value={totalInvested} />}
        />
        <StatCard
          label="Ganancia / Pérdida"
          value={
            <span className={totalUnrealizedPnl >= 0 ? "text-positive" : "text-negative"}>
              {totalUnrealizedPnl >= 0 ? "+" : ""}
              <PriceDisplay value={totalUnrealizedPnl} />
            </span>
          }
          subValue={
            <span className={totalUnrealizedPnl >= 0 ? "text-positive" : "text-negative"}>
              {pct(totalUnrealizedPct)}
            </span>
          }
        />
        <StatCard
          label="Saldo Fiat (Efectivo)"
          value={<PriceDisplay value={balances.totalCashEquivalentBalance?.value ?? 0} />}
          subValue={<span className="text-secondary-color">Disponible para operar</span>}
        />
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <CardHeader style={{ paddingBottom: 16, borderBottom: "1px solid var(--border)" }}>
          <CardTitle style={{ fontSize: "1rem" }}>Posiciones (Spot)</CardTitle>
        </CardHeader>

        <div className="portfolio-desktop-view">
          <ResponsiveTable
            headers={[
              "Activo",
              <div className="text-right">Balance</div>,
              <div className="text-right">Precio Actual</div>,
              <div className="text-right">Precio de Compra</div>,
              <div className="text-center">24h</div>,
              <div className="text-right">Valor Fiat</div>,
              <div className="text-right">Ganancia</div>,
              <div className="text-right">Distribución</div>
            ]}
          >
            {positions.map((pos: any) => {
              const symbol = pos.asset;
              const isEur = symbol === "EUR";
              const currentFiat = pos.totalBalanceFiat || 0;
              const balanceStr = isEur 
                ? new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(pos.totalBalanceCrypto || pos.totalBalanceFiat)
                : pos.totalBalanceCrypto?.toLocaleString("es-ES", { maximumFractionDigits: 8 });

              const currentPrice = pos.market?.price;
              const avgEntry = pos.averageEntryPrice?.value;
              const unrealized = pos.unrealizedPnl;
              const costBasis = pos.costBasis?.value;
              
              const hasUnrealized = unrealized !== null && unrealized !== undefined;
              const hasCostBasis = costBasis !== null && costBasis !== undefined;
              
              let roi: number | null = null;
              if (hasCostBasis && hasUnrealized) {
                if (costBasis > 0) {
                  roi = (unrealized / costBasis) * 100;
                } else if (costBasis === 0 && unrealized > 0) {
                  roi = 100; // infinito/ganancia neta
                } else if (costBasis === 0 && unrealized === 0) {
                  roi = 0;
                }
              }

              const allocation = pos.allocation ? pos.allocation * 100 : 0;

              const assetInfo = assets.find((a: any) => a.symbol === symbol || a.id === symbol);
              const name = assetInfo?.name || symbol;
              const logoUrl = pos.assetImageUrl || assetInfo?.logoUrl;
              
              const sparklinePts = pos.sparkline || [];
              const positive24h = sparklinePts.length > 0 ? sparklinePts[sparklinePts.length - 1].close >= sparklinePts[0].close : true;

              return (
                <tr key={pos.accountUuid || symbol}>
                  <td>
                    <div className="asset-identity">
                      <CryptoLogo logoUrl={logoUrl} symbol={symbol} size={32} />
                      <div>
                        <div className="asset-identity-name">{name}</div>
                        <div className="asset-identity-symbol">{symbol}</div>
                      </div>
                    </div>
                  </td>
                  <td className="num font-semibold">{balanceStr}</td>
                  <td className="num">
                    {!isEur && currentPrice !== null && currentPrice !== undefined ? <PriceDisplay value={currentPrice} /> : "—"}
                  </td>
                  <td className="num text-secondary-color">
                    {!isEur ? (avgEntry !== null && avgEntry !== undefined ? <PriceDisplay value={avgEntry} /> : <span className="text-secondary-color text-xs">N/D</span>) : "—"}
                  </td>
                  <td className="ctr" style={{ width: 100 }}>
                    {!isEur && sparklinePts.length > 0 ? (
                      <ErrorBoundary>
                        <Sparkline data={sparklinePts} positive={positive24h} />
                      </ErrorBoundary>
                    ) : "—"}
                  </td>
                  <td className="num font-semibold">
                    <PriceDisplay value={currentFiat} />
                  </td>
                  <td className="num font-semibold">
                    {!isEur ? (hasCostBasis && hasUnrealized ? (
                      <>
                        <span className={unrealized >= 0 ? "text-positive" : "text-negative"}>
                          {unrealized >= 0 ? "+" : ""}<PriceDisplay value={unrealized} />
                        </span>
                        {roi !== null && (
                          <div className={`text-xs ${unrealized >= 0 ? "text-positive" : "text-negative"}`}>
                            {pct(roi)}
                          </div>
                        )}
                      </>
                    ) : <span className="text-secondary-color text-xs">N/D</span>) : "—"}
                  </td>
                  <td className="num">{allocation.toFixed(1)}%</td>
                </tr>
              );
            })}
          </ResponsiveTable>
        </div>

        <div className="portfolio-cards">
          {/* Mobile view similar implementation */}
          {positions.map((pos: any) => {
            const symbol = pos.asset;
            const isEur = symbol === "EUR";
            const currentFiat = pos.totalBalanceFiat || 0;
            const balanceStr = isEur 
                ? new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(pos.totalBalanceCrypto || pos.totalBalanceFiat)
                : pos.totalBalanceCrypto?.toLocaleString("es-ES", { maximumFractionDigits: 8 });

            const unrealized = pos.unrealizedPnl;
            const costBasis = pos.costBasis?.value;
            const hasUnrealized = unrealized !== null && unrealized !== undefined;
            const hasCostBasis = costBasis !== null && costBasis !== undefined;

            let roi: number | null = null;
            if (hasCostBasis && hasUnrealized) {
              if (costBasis > 0) {
                roi = (unrealized / costBasis) * 100;
              } else if (costBasis === 0 && unrealized > 0) {
                roi = 100;
              } else if (costBasis === 0 && unrealized === 0) {
                roi = 0;
              }
            }

            const assetInfo = assets.find((a: any) => a.symbol === symbol || a.id === symbol);
            const logoUrl = pos.assetImageUrl || assetInfo?.logoUrl;
            
            return (
              <div key={pos.accountUuid || symbol} className="portfolio-card">
                <div className="portfolio-card-header">
                  <div className="asset-identity">
                    <CryptoLogo logoUrl={logoUrl} symbol={symbol} size={32} />
                    <div>
                      <div className="asset-identity-name">{assetInfo?.name || symbol}</div>
                      <div className="asset-identity-symbol">{symbol}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="font-semibold"><PriceDisplay value={currentFiat} /></div>
                    <div className="text-secondary-color text-xs">{(pos.allocation ? pos.allocation * 100 : 0).toFixed(1)}% cartera</div>
                  </div>
                </div>

                <div className="portfolio-card-row">
                  <span className="portfolio-card-label">Balance</span>
                  <span className="portfolio-card-value">{balanceStr}</span>
                </div>
                {!isEur && (
                  <>
                    <div className="portfolio-card-row">
                      <span className="portfolio-card-label">Precio Compra</span>
                      <span className="portfolio-card-value">
                        {pos.averageEntryPrice?.value !== null && pos.averageEntryPrice?.value !== undefined ? <PriceDisplay value={pos.averageEntryPrice.value} /> : <span className="text-secondary-color text-xs">N/D</span>}
                      </span>
                    </div>
                    <div className="portfolio-card-row">
                      <span className="portfolio-card-label">Rendimiento</span>
                      <div className="portfolio-card-value">
                        {hasCostBasis && hasUnrealized ? (
                          <>
                            <span className={`font-semibold ${unrealized >= 0 ? "text-positive" : "text-negative"}`}>
                              {unrealized >= 0 ? "+" : ""}<PriceDisplay value={unrealized} />
                            </span>
                            {roi !== null && (
                              <div className={`text-xs ${unrealized >= 0 ? "text-positive" : "text-negative"}`}>
                                {pct(roi)}
                              </div>
                            )}
                          </>
                        ) : <span className="text-secondary-color text-xs">N/D</span>}
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
