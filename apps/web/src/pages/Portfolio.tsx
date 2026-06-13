import { useQuery, useQueries } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { createChart, LineSeries } from "lightweight-charts";
import { CryptoLogo } from "../components/CryptoLogo";

function Sparkline({ data, positive = true }: { data: { time: number; value: number }[]; positive?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    const chart = createChart(containerRef.current, {
      width: 80,
      height: 24,
      layout: {
        background: { color: "transparent" },
        textColor: "transparent",
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      rightPriceScale: { visible: false },
      timeScale: { visible: false },
      crosshair: {
        vertLine: { visible: false },
        horzLine: { visible: false },
      },
      handleScroll: false,
      handleScale: false,
    });

    const lineSeries = chart.addSeries(LineSeries, {
      color: positive ? "#10B981" : "#EF4444",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    lineSeries.setData(data.map(d => ({ time: d.time as import('lightweight-charts').Time, value: d.value })));
    chart.timeScale().fitContent();

    return () => {
      chart.remove();
    };
  }, [data, positive]);

  return <div ref={containerRef} style={{ width: "80px", height: "24px" }} />;
}

function PortfolioRowSparkline({ assetId }: { assetId: string }) {
  const { data: historyRes } = useQuery({
    queryKey: ['market', 'history', assetId, '24h'],
    queryFn: () => window.cryptoControl.market.getHistoricalPrices({ assetId, period: "24h", quoteCurrency: "EUR" }),
    staleTime: 60000
  });

  if (!historyRes?.ok || !historyRes.data || historyRes.data.points.length < 2) {
    return <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>-</span>;
  }

  const points = historyRes.data.points;
  const first = points[0].value;
  const last = points[points.length - 1].value;
  const positive = last >= first;

  return <Sparkline data={points} positive={positive} />;
}

export function Portfolio() {
  const { data: summaryRes, isLoading: loadingSummary } = useQuery({
    queryKey: ['portfolio', 'summary'],
    queryFn: () => window.cryptoControl.portfolio.getSummary()
  });

  const { data: positionsRes, isLoading: loadingPositions } = useQuery({
    queryKey: ['portfolio', 'positions'],
    queryFn: () => window.cryptoControl.portfolio.getPositions()
  });

  const { data: allocationRes, isLoading: loadingAllocation } = useQuery({
    queryKey: ['portfolio', 'allocation'],
    queryFn: () => window.cryptoControl.portfolio.getAllocation()
  });

  const { data: assetsRes } = useQuery({
    queryKey: ['assets'],
    queryFn: () => window.cryptoControl.assets.list()
  });

  const { data: targetRes } = useQuery({
    queryKey: ['settings', 'portfolio_target'],
    queryFn: () => window.cryptoControl.settings.get("portfolio_target")
  });

  const allocationData = allocationRes?.ok ? allocationRes.data : [];

  // Query 24h price histories for held assets dynamically
  const histories = useQueries({
    queries: allocationData.map(alloc => ({
      queryKey: ['market', 'history', alloc.assetId, '24h'],
      queryFn: () => window.cryptoControl.market.getHistoricalPrices({ assetId: alloc.assetId, period: "24h", quoteCurrency: "EUR" }),
      staleTime: 60000
    }))
  });

  const loading = loadingSummary || loadingPositions || loadingAllocation;
  
  if (loading) return <div className="page-title" style={{ padding: "24px" }}>Cargando cartera...</div>;
  
  if ((summaryRes && !summaryRes.ok) || (positionsRes && !positionsRes.ok) || (allocationRes && !allocationRes.ok)) {
    return <div className="error-banner" style={{ margin: "24px", padding: "16px", backgroundColor: "#FEE2E2", color: "#B91C1C", borderRadius: "var(--radius-md)" }}>No se pudo cargar la cartera</div>;
  }

  const summary = summaryRes?.data;
  const portfolioData = positionsRes?.data;
  const assets = assetsRes?.ok ? assetsRes.data : [];

  if (!summary || !portfolioData) return null;

  // Render empty state if there are no assets or balance is zero
  if (allocationData.length === 0) {
    return (
      <div className="portfolio-page" style={{ maxWidth: "1200px", margin: "0 auto", padding: "24px" }}>
        <h1 className="page-title">Cartera</h1>
        <div className="card" style={{ 
          padding: "48px 32px", 
          textAlign: "center", 
          display: "flex", 
          flexDirection: "column", 
          alignItems: "center", 
          justifyContent: "center",
          borderRadius: "var(--radius-lg)",
          backgroundColor: "var(--bg-color)",
          border: "1px solid var(--border-color)",
          boxShadow: "var(--shadow-sm)",
          marginTop: "40px"
        }}>
          <div style={{ fontSize: "3rem", marginBottom: "16px" }}>💼</div>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: "8px", marginTop: 0 }}>Todavía no hay operaciones registradas</h2>
          <p style={{ color: "var(--text-secondary)", maxWidth: "400px", margin: "0 0 24px 0", lineHeight: 1.5 }}>
            Añade tu primera compra, venta o conversión para comenzar a controlar tu cartera de criptomonedas.
          </p>
        </div>
      </div>
    );
  }

  // Calculate real 24h portfolio value variation dynamically
  let totalValueNow = 0;
  let totalValue24hAgo = 0;
  let hasHistoryData = false;

  for (let i = 0; i < allocationData.length; i++) {
    const alloc = allocationData[i];
    const pos = portfolioData[alloc.assetId];
    const historyRes = histories[i]?.data;
    
    if (historyRes?.ok && historyRes.data && historyRes.data.points.length >= 2) {
      const points = historyRes.data.points;
      const price24hAgo = points[0].value;
      const priceNow = points[points.length - 1].value;
      
      if (pos) {
        totalValueNow += pos.balance * priceNow;
        totalValue24hAgo += pos.balance * price24hAgo;
        hasHistoryData = true;
      }
    }
  }

  const variation24h = (hasHistoryData && totalValue24hAgo > 0)
    ? ((totalValueNow - totalValue24hAgo) / totalValue24hAgo) * 100
    : null;

  const targetValue = targetRes?.ok && targetRes.data ? parseFloat(targetRes.data) : null;

  return (
    <div className="portfolio-page" style={{ maxWidth: "1200px", margin: "0 auto", padding: "24px" }}>
      <h1 className="page-title">Cartera</h1>
      
      <div className="summary-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '30px' }}>
        <div className="card">
          <h3>Valor Total</h3>
          <h2>{summary.totalValueEur.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</h2>
          {variation24h !== null && (
            <div style={{ fontSize: '0.875rem', marginTop: '4px' }}>
              Variación 24h: <span style={{ color: variation24h >= 0 ? '#10B981' : '#EF4444', fontWeight: 600 }}>
                {variation24h >= 0 ? '+' : ''}{variation24h.toFixed(2)}%
              </span>
            </div>
          )}
        </div>
        <div className="card">
          <h3>Capital Invertido</h3>
          <h2>{summary.totalInvestedEur.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</h2>
        </div>
        <div className="card">
          <h3>Ganancia/Pérdida (No realizada)</h3>
          <h2 style={{ color: summary.unrealizedGainEur >= 0 ? "#10B981" : "#EF4444" }}>
            {summary.unrealizedGainEur >= 0 ? "+" : ""}{summary.unrealizedGainEur.toLocaleString("es-ES", { style: "currency", currency: "EUR" })} 
            <span style={{ fontSize: '1.2rem', marginLeft: '8px' }}>
              ({summary.unrealizedGainPercentage.toFixed(2)}%)
            </span>
          </h2>
        </div>
        <div className="card">
          {targetValue !== null && !isNaN(targetValue) ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <h3 style={{ margin: 0 }}>Objetivo ({targetValue.toLocaleString("es-ES")} €)</h3>
                <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>
                  {Math.min((summary.totalValueEur / targetValue) * 100, 100).toFixed(1)}%
                </span>
              </div>
              <div style={{ width: '100%', height: '8px', backgroundColor: 'var(--surface-hover)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ 
                  width: `${Math.min((summary.totalValueEur / targetValue) * 100, 100)}%`, 
                  height: '100%', 
                  backgroundColor: 'var(--brand-primary)',
                  transition: 'width 0.5s ease-out'
                }} />
              </div>
            </>
          ) : (
            <>
              <h3 style={{ marginBottom: '8px' }}>Objetivo</h3>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Objetivo no configurado</div>
            </>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <h3 style={{ padding: '24px 24px 16px 24px', margin: 0 }}>Activos</h3>
        
        {/* Desktop Table View */}
        <div className="portfolio-desktop-view" style={{ overflowX: 'auto' }}>
          <table className="portfolio-table" style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', minWidth: '600px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '12px 16px' }}>Activo</th>
                <th style={{ padding: '12px 16px', textAlign: 'right' }}>Balance</th>
                <th style={{ padding: '12px 16px', textAlign: 'right' }}>Precio Medio</th>
                <th style={{ padding: '12px 16px', textAlign: 'right' }}>Precio de Mercado</th>
                <th style={{ padding: '12px 16px', textAlign: 'center' }}>Tendencia</th>
                <th style={{ padding: '12px 16px', textAlign: 'right' }}>Valor Actual</th>
                <th style={{ padding: '12px 16px', textAlign: 'right' }}>Coste Base</th>
                <th style={{ padding: '12px 16px', textAlign: 'right' }}>Rentabilidad</th>
                <th style={{ padding: '12px 16px', textAlign: 'right' }}>Peso</th>
              </tr>
            </thead>
            <tbody>
              {allocationData.map((alloc: import("@crypto-control/portfolio").AssetAllocation) => {
                const pos = portfolioData[alloc.assetId];
                if (!pos) return null;
                const asset = assets.find((a: { id: string; name: string; symbol: string; logoUrl?: string | null }) => a.id === alloc.assetId);

                const currentPrice = pos.balance > 0 ? alloc.valueEur / pos.balance : 0;
                const unrealizedGain = alloc.valueEur - pos.totalInvestedEur;
                const unrealizedPct = pos.totalInvestedEur > 0 ? (unrealizedGain / pos.totalInvestedEur) * 100 : 0;

                return (
                  <tr key={alloc.assetId} style={{ borderBottom: '1px solid var(--surface-hover)' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <CryptoLogo logoUrl={asset?.logoUrl} symbol={asset?.symbol || alloc.assetId} size={28} />
                        <div>
                          <div style={{ fontWeight: 600 }}>{asset?.name || alloc.assetId}</div>
                          <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{asset?.symbol || alloc.assetId}</div>
                          {pos.hasPendingValuation && (
                            <span style={{ fontSize: '0.75rem', backgroundColor: '#fef3c7', color: '#d97706', padding: '2px 6px', borderRadius: '4px', marginTop: '4px', display: 'inline-block' }}>
                              Pendiente valoración
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 500 }}>
                      {pos.balance.toLocaleString("es-ES", { maximumFractionDigits: 6 })}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                      {pos.averagePriceEur != null
                        ? pos.averagePriceEur.toLocaleString("es-ES", { style: "currency", currency: "EUR" })
                        : "—"}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      {currentPrice > 0 ? currentPrice.toLocaleString("es-ES", { style: "currency", currency: "EUR" }) : "-"}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      <div style={{ display: 'inline-block', verticalAlign: 'middle' }}>
                        <PortfolioRowSparkline assetId={alloc.assetId} />
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600 }}>
                      {alloc.valueEur.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                      {pos.totalInvestedEur.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 500, color: unrealizedGain >= 0 ? '#10B981' : '#EF4444' }}>
                      {unrealizedGain >= 0 ? "+" : ""}{unrealizedGain.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}
                      <div style={{ fontSize: '0.875rem' }}>{unrealizedPct >= 0 ? "+" : ""}{unrealizedPct.toFixed(2)}%</div>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      {alloc.weight.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        
        {/* Mobile Cards View */}
        <div className="portfolio-cards" style={{ padding: '0 24px 24px 24px' }}>
          {allocationData.map((alloc: import("@crypto-control/portfolio").AssetAllocation) => {
            const pos = portfolioData[alloc.assetId];
            if (!pos) return null;
            const asset = assets.find((a: { id: string; name: string; symbol: string; logoUrl?: string | null }) => a.id === alloc.assetId);

            const currentPrice = pos.balance > 0 ? alloc.valueEur / pos.balance : 0;
            const unrealizedGain = alloc.valueEur - pos.totalInvestedEur;
            const unrealizedPct = pos.totalInvestedEur > 0 ? (unrealizedGain / pos.totalInvestedEur) * 100 : 0;

            return (
              <div key={alloc.assetId} className="portfolio-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <CryptoLogo logoUrl={asset?.logoUrl} symbol={asset?.symbol || alloc.assetId} size={32} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{asset?.name || alloc.assetId}</div>
                      <div style={{ color: 'var(--text-secondary)' }}>{asset?.symbol || alloc.assetId}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{alloc.valueEur.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>{alloc.weight.toFixed(1)}% cartera</div>
                  </div>
                </div>
                
                <div className="portfolio-card-row">
                  <span className="portfolio-card-label">Balance</span>
                  <span className="portfolio-card-value">{pos.balance.toLocaleString("es-ES", { maximumFractionDigits: 6 })}</span>
                </div>

                <div className="portfolio-card-row">
                  <span className="portfolio-card-label">Precio Medio</span>
                  <span className="portfolio-card-value">
                    {pos.averagePriceEur != null
                      ? pos.averagePriceEur.toLocaleString("es-ES", { style: "currency", currency: "EUR" })
                      : "—"}
                  </span>
                </div>

                <div className="portfolio-card-row">
                  <span className="portfolio-card-label">Precio Act.</span>
                  <span className="portfolio-card-value">{currentPrice > 0 ? currentPrice.toLocaleString("es-ES", { style: "currency", currency: "EUR" }) : "-"}</span>
                </div>

                <div className="portfolio-card-row">
                  <span className="portfolio-card-label">Tendencia</span>
                  <span className="portfolio-card-value">
                    <PortfolioRowSparkline assetId={alloc.assetId} />
                  </span>
                </div>
                
                <div className="portfolio-card-row">
                  <span className="portfolio-card-label">Coste Base</span>
                  <span className="portfolio-card-value">{pos.totalInvestedEur.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</span>
                </div>
                
                <div className="portfolio-card-row" style={{ borderTop: '1px dashed var(--border-color)', paddingTop: '8px', marginTop: '8px' }}>
                  <span className="portfolio-card-label">Rentabilidad</span>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 600, color: unrealizedGain >= 0 ? '#10B981' : '#EF4444' }}>
                      {unrealizedGain >= 0 ? "+" : ""}{unrealizedGain.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}
                    </div>
                    <div style={{ fontSize: '0.875rem', color: unrealizedGain >= 0 ? '#10B981' : '#EF4444' }}>
                      {unrealizedPct >= 0 ? "+" : ""}{unrealizedPct.toFixed(2)}%
                    </div>
                  </div>
                </div>
                
                {pos.hasPendingValuation && (
                  <div style={{ marginTop: '12px', fontSize: '0.75rem', backgroundColor: '#fef3c7', color: '#d97706', padding: '4px 8px', borderRadius: '4px', textAlign: 'center' }}>
                    Pendiente de valoración
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
