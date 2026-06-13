import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { MarketChart } from "../components/MarketChart";
import "../mercado.css";

const PERIODS = ["1h", "24h", "7d", "30d", "1y", "all"] as const;
type Period = typeof PERIODS[number];

export function Mercado() {
  const [selectedAsset, setSelectedAsset] = useState<string>("BTC");
  const [period, setPeriod] = useState<Period>("24h");
  const [search, setSearch] = useState("");
  
  const { data: assetsRes } = useQuery({
    queryKey: ['assets'],
    queryFn: () => window.cryptoControl.assets.list()
  });

  const { data: priceRes } = useQuery({
    queryKey: ['market', 'price', selectedAsset],
    queryFn: () => window.cryptoControl.market.getCurrentPrice({ assetId: selectedAsset, quoteCurrency: "EUR" }),
    enabled: !!selectedAsset
  });

  const { data: historyRes, isLoading: loadingHistory, refetch: refetchHistory } = useQuery({
    queryKey: ['market', 'history', selectedAsset, period],
    queryFn: () => window.cryptoControl.market.getHistoricalPrices({ assetId: selectedAsset, period, quoteCurrency: "EUR" }),
    enabled: !!selectedAsset
  });

  const { data: txsRes } = useQuery({
    queryKey: ['transactions'],
    queryFn: () => window.cryptoControl.transactions.list()
  });

  const assets = assetsRes?.ok ? assetsRes.data : [];
  const currentPrice = priceRes?.ok ? priceRes.data.price : null;

  const filteredAssets = useMemo(() => {
    return assets.filter((a: { id: string; name: string; symbol: string; }) => 
      a.name.toLowerCase().includes(search.toLowerCase()) || 
      a.symbol.toLowerCase().includes(search.toLowerCase())
    );
  }, [assets, search]);

  let variation24h = null;
  let chartStartTime = 0;
  if (period === "24h" && historyRes?.ok && historyRes.data && historyRes.data.points.length > 0) {
    const firstPrice = historyRes.data.points[0].value;
    const lastPrice = historyRes.data.points[historyRes.data.points.length - 1].value;
    variation24h = ((lastPrice - firstPrice) / firstPrice) * 100;
  }
  
  if (historyRes?.ok && historyRes.data && historyRes.data.points.length > 0) {
    chartStartTime = historyRes.data.points[0].time as number;
  }

  const operations = useMemo(() => {
    if (!txsRes?.ok || !txsRes.data || !chartStartTime) return [];
    
    const ops: { time: import('lightweight-charts').Time; type: string; label: string; color: string }[] = [];
    
    for (const tx of txsRes.data) {
      // Only include operations within the chart's visible timeframe (with a small buffer)
      if (tx.date < chartStartTime - 86400000) continue;

      for (const leg of tx.legs) {
        if (leg.assetId === selectedAsset) {
          // It's related to this asset
          let type = '';
          let label = '';
          let color = '';
          
          if (tx.type === 'buy' && leg.legType === 'destination') {
            type = 'buy';
            label = `Compra ${leg.amount}`;
            color = '#10B981'; // green
          } else if (tx.type === 'sell' && leg.legType === 'source') {
            type = 'sell';
            label = `Venta ${leg.amount}`;
            color = '#EF4444'; // red
          } else if (tx.type === 'convert' && leg.legType === 'destination') {
            type = 'buy';
            label = `Conv. (In) ${leg.amount}`;
            color = '#3B82F6'; // blue
          } else if (tx.type === 'convert' && leg.legType === 'source') {
            type = 'sell';
            label = `Conv. (Out) ${leg.amount}`;
            color = '#F59E0B'; // orange
          }
          
          if (type) {
            ops.push({
              time: Math.floor(tx.date / 1000) as import('lightweight-charts').Time, // assuming lightweight-charts expects seconds for Time
              type,
              label,
              color
            });
          }
        }
      }
    }
    return ops;
  }, [txsRes, selectedAsset, chartStartTime]);

  return (
    <div className="mercado-page">
      <h1 className="page-title">Mercado</h1>

      <div className="mercado-layout">
        <div className="mercado-sidebar">
          <input 
            type="text" 
            className="search-input" 
            placeholder="Buscar activo..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="asset-list">
            {filteredAssets.map((a: { id: string; name: string; symbol: string; }) => (
              <div 
                key={a.id} 
                className={`asset-item ${selectedAsset === a.id ? 'selected' : ''}`}
                onClick={() => setSelectedAsset(a.id)}
              >
                <div className="asset-info">
                  <span className="asset-name">{a.name}</span>
                  <span className="asset-symbol">{a.symbol}</span>
                </div>
              </div>
            ))}
            {filteredAssets.length === 0 && (
              <div style={{ color: "var(--text-secondary)", textAlign: "center", marginTop: "20px" }}>
                No se encontraron activos
              </div>
            )}
          </div>
        </div>

        <div className="mercado-main card">
          <div className="market-header" style={{ marginBottom: "24px" }}>
            <h2>{assets.find((a: { id: string; name: string; }) => a.id === selectedAsset)?.name || selectedAsset}</h2>
            {currentPrice !== null && (
              <div className="current-price" style={{ display: "flex", alignItems: "baseline", gap: "12px" }}>
                <h2 style={{ margin: 0 }}>{currentPrice.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</h2>
                {variation24h !== null && (
                  <span className={`asset-change ${variation24h >= 0 ? 'positive' : 'negative'}`}>
                    {variation24h >= 0 ? '+' : ''}{variation24h.toFixed(2)}%
                  </span>
                )}
              </div>
            )}
          </div>

          <div style={{ flex: 1, minHeight: 0 }}>
            {loadingHistory ? (
              <div className="skeleton" style={{ height: "400px", borderRadius: "var(--radius-md)" }}></div>
            ) : historyRes?.ok && historyRes.data ? (
              <MarketChart 
                data={historyRes.data.points.map((p: { time: number; value: number }) => ({
                  time: (Math.floor(p.time / 1000)) as import('lightweight-charts').Time, 
                  value: p.value
                }))} 
                operations={operations}
                provider={historyRes.data.provider}
                isCached={historyRes.data.isCached}
              />
            ) : (
              <div className="error-box" style={{ height: "400px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div>
                  <p>No se pudo cargar la gráfica</p>
                  <button onClick={() => refetchHistory()} style={{ marginTop: "12px" }}>Reintentar</button>
                </div>
              </div>
            )}
          </div>

          <div className="period-selector">
            {PERIODS.map(p => (
              <button key={p} className={period === p ? "active" : ""} onClick={() => setPeriod(p)}>
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
