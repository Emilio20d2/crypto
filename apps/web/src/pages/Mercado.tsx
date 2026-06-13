import { useState, useEffect, useRef } from "react";
import { createChart } from "lightweight-charts";
import type { IChartApi, ISeriesApi } from "lightweight-charts";

const PERIODS = ["1h", "24h", "7d", "30d", "1y", "all"] as const;
type Period = typeof PERIODS[number];

export function Mercado() {
  const [assets, setAssets] = useState<any[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<string>("bitcoin");
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [period, setPeriod] = useState<Period>("24h");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

  useEffect(() => {
    // Cargar activos disponibles
    async function loadAssets() {
      // @ts-expect-error IPC
      const data = await window.api.assets.list();
      setAssets(data);
      if (data.length > 0 && !selectedAsset) setSelectedAsset(data[0].id);
    }
    loadAssets();
  }, [selectedAsset]);

  useEffect(() => {
    async function loadMarketData() {
      if (!selectedAsset || !chartContainerRef.current) return;
      setLoading(true);
      setError("");

      try {
        const [priceResult, historyResult] = await Promise.all([
          // @ts-expect-error IPC
          window.api.market.getCurrentPrice(selectedAsset),
          // @ts-expect-error IPC
          window.api.market.getHistoricalPrices(selectedAsset, period)
        ]);

        if (priceResult.error) throw new Error(priceResult.error);
        if (historyResult.error) throw new Error(historyResult.error);

        setCurrentPrice(priceResult);

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

        if (seriesRef.current) {
          const chartData = historyResult.map((p: {timestamp: number; price: number}) => ({
            time: Math.floor(p.timestamp / 1000), // lightweight-charts uses seconds for timestamps
            value: p.price
          }));
          seriesRef.current.setData(chartData);
          chartRef.current.timeScale().fitContent();
        }

      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al cargar datos del mercado");
      } finally {
        setLoading(false);
      }
    }

    loadMarketData();
  }, [selectedAsset, period]);

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
          {currentPrice !== null && (
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
        {error && <div className="error-banner">
            {error}
            <button onClick={() => setPeriod(period)}>Reintentar</button>
        </div>}
        
        <div ref={chartContainerRef} className="chart-container" style={{ position: "relative", width: "100%", height: "400px" }} />
      </div>
    </div>
  );
}
