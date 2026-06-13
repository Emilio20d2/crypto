import { useQuery } from "@tanstack/react-query";

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

  const loading = loadingSummary || loadingPositions || loadingAllocation;
  
  if (loading) return <div className="page-title">Cargando cartera...</div>;
  
  if ((summaryRes && !summaryRes.ok) || (positionsRes && !positionsRes.ok) || (allocationRes && !allocationRes.ok)) {
    return <div className="error-banner">No se pudo cargar la cartera</div>;
  }

  const summary = summaryRes?.data;
  const portfolioData = positionsRes?.data;
  const allocationData = allocationRes?.data;
  const assets = assetsRes?.ok ? assetsRes.data : [];

  if (!summary || !portfolioData || !allocationData) return null;

  return (
    <div className="portfolio-page">
      <h1 className="page-title">Cartera</h1>
      
      <div className="summary-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '30px' }}>
        <div className="card">
          <h3>Valor Total</h3>
          <h2>{summary.totalValueEur.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</h2>
          <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Variación 24h: <span style={{ color: 'var(--text-secondary)' }}>Calculando...</span>
          </div>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <h3 style={{ margin: 0 }}>Objetivo (50.000 €)</h3>
            <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>
              {Math.min((summary.totalValueEur / 50000) * 100, 100).toFixed(1)}%
            </span>
          </div>
          <div style={{ width: '100%', height: '8px', backgroundColor: 'var(--surface-hover)', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{ 
              width: `${Math.min((summary.totalValueEur / 50000) * 100, 100)}%`, 
              height: '100%', 
              backgroundColor: 'var(--brand-primary)',
              transition: 'width 0.5s ease-out'
            }} />
          </div>
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
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>Precio de Mercado</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>Valor Actual</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>Coste Base</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>Rentabilidad</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>Peso</th>
            </tr>
          </thead>
          <tbody>
            {allocationData.map((alloc: import("@crypto-control/portfolio").AssetAllocation) => {
              const pos = portfolioData[alloc.assetId];
              const asset = assets.find((a: { id: string; name: string; symbol: string }) => a.id === alloc.assetId);
              
              const currentPrice = pos.balance > 0 ? alloc.valueEur / pos.balance : 0;
              const unrealizedGain = alloc.valueEur - pos.totalInvestedEur;
              const unrealizedPct = pos.totalInvestedEur > 0 ? (unrealizedGain / pos.totalInvestedEur) * 100 : 0;

              return (
                <tr key={alloc.assetId} style={{ borderBottom: '1px solid var(--surface-hover)' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ fontWeight: 600 }}>{asset?.name || alloc.assetId}</div>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{asset?.symbol || alloc.assetId}</div>
                    {pos.hasPendingValuation && (
                      <span style={{ fontSize: '0.75rem', backgroundColor: '#fef3c7', color: '#d97706', padding: '2px 6px', borderRadius: '4px', marginTop: '4px', display: 'inline-block' }}>
                        Pendiente valoración
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 500 }}>
                    {pos.balance.toLocaleString("es-ES", { maximumFractionDigits: 6 })}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    {currentPrice > 0 ? currentPrice.toLocaleString("es-ES", { style: "currency", currency: "EUR" }) : "-"}
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
            const asset = assets.find((a: { id: string; name: string; symbol: string }) => a.id === alloc.assetId);
            
            const currentPrice = pos.balance > 0 ? alloc.valueEur / pos.balance : 0;
            const unrealizedGain = alloc.valueEur - pos.totalInvestedEur;
            const unrealizedPct = pos.totalInvestedEur > 0 ? (unrealizedGain / pos.totalInvestedEur) * 100 : 0;

            return (
              <div key={alloc.assetId} className="portfolio-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{asset?.name || alloc.assetId}</div>
                    <div style={{ color: 'var(--text-secondary)' }}>{asset?.symbol || alloc.assetId}</div>
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
                  <span className="portfolio-card-label">Precio Act.</span>
                  <span className="portfolio-card-value">{currentPrice > 0 ? currentPrice.toLocaleString("es-ES", { style: "currency", currency: "EUR" }) : "-"}</span>
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
