import { useEffect, useState } from "react";

export function Portfolio() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{totalValue: number, totalInvested: number, totalProfit: number, totalProfitPct: number, positions: any[], lastSync: string} | null>(null);

  useEffect(() => {
    async function loadPortfolio() {
      try {
        // Obtenemos los activos reales de la DB vía IPC
        // @ts-expect-error IPC
        const assets = await window.api.assets.list();
        
        // Mock rápido de datos de cartera combinados con precios reales
        let totalValue = 0;
        let totalInvested = 0;
        
        const positions = await Promise.all(assets.map(async (a: {id: string; symbol: string; name: string}) => {
          // @ts-expect-error IPC
          const priceRes = await window.api.market.getCurrentPrice(a.id);
          const price = priceRes.error ? 0 : priceRes;
          const balance = 1.5; // Mock: se conectará a la BD de operaciones reales
          const avgPrice = price * 0.8; // Mock
          const invested = balance * avgPrice;
          const value = balance * price;
          
          totalValue += value;
          totalInvested += invested;

          return {
            ...a,
            balance,
            currentPrice: price,
            avgPrice,
            value,
            profit: value - invested,
            profitPct: ((value - invested) / invested) * 100,
            target: price * 1.5,
            progress: 60 // Mock
          };
        }));

        setData({
          totalValue,
          totalInvested,
          totalProfit: totalValue - totalInvested,
          totalProfitPct: totalInvested > 0 ? ((totalValue - totalInvested) / totalInvested) * 100 : 0,
          positions,
          lastSync: new Date().toLocaleString()
        });
      } catch (e) {
        console.error("Error al cargar la cartera", e);
      } finally {
        setLoading(false);
      }
    }
    loadPortfolio();
  }, []);

  if (loading) return <div className="page-title">Cargando cartera...</div>;
  if (!data) return <div className="error-banner">No se pudo cargar la cartera</div>;

  return (
    <div className="portfolio-page">
      <h1 className="page-title">Visión General</h1>
      
      <div className="summary-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '30px' }}>
        <div className="card">
          <h3>Valor Total</h3>
          <h2>{data.totalValue.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</h2>
          <div className="last-sync">Última sincronización: {data.lastSync}</div>
        </div>
        <div className="card">
          <h3>Capital Invertido</h3>
          <h2>{data.totalInvested.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</h2>
        </div>
        <div className="card">
          <h3>Ganancia/Pérdida</h3>
          <h2 style={{ color: data.totalProfit >= 0 ? "#5ae37a" : "#ff3232" }}>
            {data.totalProfit >= 0 ? "+" : ""}{data.totalProfit.toLocaleString("es-ES", { style: "currency", currency: "EUR" })} 
            ({data.totalProfitPct.toFixed(2)}%)
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
              <th style={{ padding: '10px' }}>Precio Medio</th>
              <th style={{ padding: '10px' }}>Precio Actual</th>
              <th style={{ padding: '10px' }}>Valor</th>
              <th style={{ padding: '10px' }}>G/P</th>
              <th style={{ padding: '10px' }}>Objetivo</th>
            </tr>
          </thead>
          <tbody>
            {data.positions.map((p: {id: string; name: string; symbol: string; balance: number; avgPrice: number; currentPrice: number; value: number; profit: number; profitPct: number; target: number; progress: number}) => (
              <tr key={p.id} style={{ borderBottom: '1px solid #f9f9f9' }}>
                <td style={{ padding: '10px' }}>
                  <strong>{p.name}</strong> <span style={{ color: '#888' }}>{p.symbol}</span>
                </td>
                <td style={{ padding: '10px' }}>{p.balance} {p.symbol}</td>
                <td style={{ padding: '10px' }}>{p.avgPrice.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</td>
                <td style={{ padding: '10px' }}>{p.currentPrice.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</td>
                <td style={{ padding: '10px' }}>{p.value.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</td>
                <td style={{ padding: '10px', color: p.profit >= 0 ? "#5ae37a" : "#ff3232" }}>
                  {p.profit >= 0 ? "+" : ""}{p.profitPct.toFixed(2)}%
                </td>
                <td style={{ padding: '10px' }}>
                  {p.target.toLocaleString("es-ES", { style: "currency", currency: "EUR" })} ({p.progress}%)
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
