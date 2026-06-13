import { useQuery } from "@tanstack/react-query";

export function Portfolio() {
  const { data: summaryRes, isLoading: loadingSummary, error: summaryErr } = useQuery({
    queryKey: ['portfolio', 'summary'],
    queryFn: () => window.cryptoControl.portfolio.getSummary()
  });

  const { data: positionsRes, isLoading: loadingPositions, error: positionsErr } = useQuery({
    queryKey: ['portfolio', 'positions'],
    queryFn: () => window.cryptoControl.portfolio.getPositions()
  });

  const { data: assetsRes } = useQuery({
    queryKey: ['assets'],
    queryFn: () => window.cryptoControl.assets.list()
  });

  if (loadingSummary || loadingPositions) return <div className="page-title">Cargando cartera...</div>;
  
  if (summaryErr || positionsErr || (summaryRes && !summaryRes.ok) || (positionsRes && !positionsRes.ok)) {
    return <div className="error-banner">No se pudo cargar la cartera</div>;
  }

  const summary = summaryRes?.ok ? summaryRes.data : null;
  const portfolioData = positionsRes?.ok ? positionsRes.data : null;
  const assets = assetsRes?.ok ? assetsRes.data : [];

  if (!summary || !portfolioData) return null;

  return (
    <div className="portfolio-page">
      <h1 className="page-title">Cartera</h1>
      
      <div className="summary-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '30px' }}>
        <div className="card">
          <h3>Valor Total</h3>
          <h2>{summary.totalValueEur.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</h2>
        </div>
        <div className="card">
          <h3>Capital Invertido</h3>
          <h2>{summary.totalInvestedEur.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</h2>
        </div>
        <div className="card">
          <h3>Ganancia/Pérdida (No realizada)</h3>
          <h2 style={{ color: summary.unrealizedGainEur >= 0 ? "#5ae37a" : "#ff3232" }}>
            {summary.unrealizedGainEur >= 0 ? "+" : ""}{summary.unrealizedGainEur.toLocaleString("es-ES", { style: "currency", currency: "EUR" })} 
            ({summary.unrealizedGainPercentage.toFixed(2)}%)
          </h2>
        </div>
      </div>

      <div className="card">
        <h3>Activos</h3>
        <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #eaf6ff' }}>
              <th style={{ padding: '10px' }}>Activo</th>
              <th style={{ padding: '10px' }}>Balance</th>
              <th style={{ padding: '10px' }}>Precio Medio Compra</th>
              <th style={{ padding: '10px' }}>Coste Base</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(portfolioData.positions).map(([assetId, pos]) => {
              const asset = assets.find((a: any) => a.id === assetId);
              return (
                <tr key={assetId} style={{ borderBottom: '1px solid #f9f9f9' }}>
                  <td style={{ padding: '10px' }}>
                    <strong>{asset?.name || assetId}</strong> <span style={{ color: '#888' }}>{asset?.symbol || assetId}</span>
                  </td>
                  <td style={{ padding: '10px' }}>{pos.balance}</td>
                  <td style={{ padding: '10px' }}>{pos.averagePriceEur ? pos.averagePriceEur.toLocaleString("es-ES", { style: "currency", currency: "EUR" }) : "-"}</td>
                  <td style={{ padding: '10px' }}>{pos.totalInvestedEur.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
