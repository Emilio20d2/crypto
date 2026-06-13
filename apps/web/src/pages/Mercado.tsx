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

  const assets = assetsRes?.ok ? assetsRes.data : [];
  const currentPrice = priceRes?.ok ? priceRes.data.price : null;

  const filteredAssets = useMemo(() => {
    return assets.filter((a: { id: string; name: string; symbol: string; }) => 
      a.name.toLowerCase().includes(search.toLowerCase()) || 
      a.symbol.toLowerCase().includes(search.toLowerCase())
    );
  }, [assets, search]);

  let variation24h = null;
  if (period === "24h" && historyRes?.ok && historyRes.data && historyRes.data.points.length > 0) {
    const firstPrice = historyRes.data.points[0].value;
    const lastPrice = historyRes.data.points[historyRes.data.points.length - 1].value;
    variation24h = ((lastPrice - firstPrice) / firstPrice) * 100;
  }

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
                  time: p.time as import('lightweight-charts').Time, 
                  value: p.value
                }))} 
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
