import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { createChart } from "lightweight-charts";
import type { IChartApi, ISeriesApi } from "lightweight-charts";

const PERIODS = ["1h", "24h", "7d", "30d", "1y", "all"] as const;
type Period = typeof PERIODS[number];

export function Mercado() {
  const [selectedAsset, setSelectedAsset] = useState<string>("BTC");
  const [period, setPeriod] = useState<Period>("24h");
  
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

  const { data: assetsRes, isLoading: loadingAssets } = useQuery({
    queryKey: ['assets'],
    queryFn: () => window.cryptoControl.assets.list()
  });

  const { data: priceRes, isLoading: loadingPrice, error: priceErr } = useQuery({
    queryKey: ['market', 'price', selectedAsset],
    queryFn: () => window.cryptoControl.market.getCurrentPrice({ assetId: selectedAsset, quoteCurrency: "EUR" }),
    enabled: !!selectedAsset
  });

  const { data: historyRes, isLoading: loadingHistory, error: historyErr, refetch: refetchHistory } = useQuery({
    queryKey: ['market', 'history', selectedAsset, period],
    queryFn: () => window.cryptoControl.market.getHistoricalPrices({ assetId: selectedAsset, period, quoteCurrency: "EUR" }),
    enabled: !!selectedAsset
  });

  useEffect(() => {
    if (!chartContainerRef.current) return;

    if (!chartRef.current) {
      chartRef.current = createChart(chartContainerRef.current, {
        width: chartContainerRef.current.clientWidth,
        height: 400,
        layout: {
          background: { color: "#ffffff" },
          textColor: "#333",
        },
        grid: {
          vertLines: { color: "#eaf6ff" },
          horzLines: { color: "#eaf6ff" },
        },
        rightPriceScale: {
          borderVisible: false,
        },
        timeScale: {
          borderVisible: false,
          timeVisible: true,
          secondsVisible: false,
        },
      });

      seriesRef.current = (chartRef.current as any).addAreaSeries({
        lineColor: "#327cff",
        topColor: "rgba(37, 191, 232, 0.4)",
        bottomColor: "rgba(37, 191, 232, 0)",
        lineWidth: 2,
      });

      const handleResize = () => {
        if (chartContainerRef.current && chartRef.current) {
          chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
        }
      };
      window.addEventListener('resize', handleResize);
    }

    if (seriesRef.current && historyRes && historyRes.ok) {
      const chartData = historyRes.data.points.map((p: {time: number; value: number}) => ({
        time: p.time,
        value: p.value
      }));
      seriesRef.current.setData(chartData);
      chartRef.current.timeScale().fitContent();
    }

  }, [historyRes]);

  const assets = assetsRes?.ok ? assetsRes.data : [];
  const currentPrice = priceRes?.ok ? priceRes.data.price : null;
  const errorMsg = (priceRes && !priceRes.ok && priceRes.error) || (historyRes && !historyRes.ok && historyRes.error) || (priceErr?.message) || (historyErr?.message);
  const loading = loadingAssets || loadingPrice || loadingHistory;

  return (
    <div className="mercado-page">
      <h1 className="page-title">Mercado</h1>

      <div className="card">
        <div className="market-header">
          <select value={selectedAsset} onChange={(e) => setSelectedAsset(e.target.value)}>
            {assets.map((a: any) => (
              <option key={a.id} value={a.id}>{a.name} ({a.symbol})</option>
            ))}
          </select>
          {currentPrice !== null && currentPrice !== undefined && (
            <div className="current-price">
              <h2>{currentPrice.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</h2>
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

        {loading && <div className="loading-state">Cargando datos...</div>}
        {errorMsg && <div className="error-banner">
            {errorMsg}
            <button onClick={() => refetchHistory()}>Reintentar</button>
        </div>}
        
        <div ref={chartContainerRef} className="chart-container" style={{ position: "relative", width: "100%", height: "400px", display: (loading || errorMsg) && (!historyRes || !historyRes.ok) ? "none" : "block" }} />
      </div>
    </div>
  );
}
