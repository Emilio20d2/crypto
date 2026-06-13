import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { MarketChart } from "../components/MarketChart";
import { CryptoLogo } from "../components/CryptoLogo";
import { EmptyState } from "../components/EmptyState";
import { Card, CardHeader, CardContent } from "../components/Card";
import { Input } from "../components/Input";
import { PeriodSelector } from "../components/PeriodSelector";
import type { Period } from "../components/PeriodSelector";
import { PriceDisplay } from "../components/PriceDisplay";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import "../mercado.css";

const PERIOD_MAP: Record<Period, "1h" | "24h" | "7d" | "30d" | "1y" | "all"> = {
  "1h": "1h",
  "1d": "24h",
  "1s": "7d",
  "1m": "30d",
  "1a": "1y",
  "Todo": "all",
};

export function Mercado() {
  const [selectedAsset, setSelectedAsset] = useState<string>("BTC");
  const [uiPeriod, setUiPeriod] = useState<Period>("1d");
  const [search, setSearch] = useState("");
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  const backendPeriod = PERIOD_MAP[uiPeriod];

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const { data: assetsRes } = useQuery({
    queryKey: ["assets"],
    queryFn: () => window.cryptoControl.assets.list(),
  });

  const { data: priceRes } = useQuery({
    queryKey: ["market", "price", selectedAsset],
    queryFn: () => window.cryptoControl.market.getCurrentPrice({ assetId: selectedAsset, quoteCurrency: "EUR" }),
    enabled: !!selectedAsset,
  });

  const { data: historyRes, isLoading: loadingHistory, refetch: refetchHistory } = useQuery({
    queryKey: ["market", "history", selectedAsset, backendPeriod],
    queryFn: () => window.cryptoControl.market.getHistoricalPrices({ assetId: selectedAsset, period: backendPeriod, quoteCurrency: "EUR" }),
    enabled: !!selectedAsset,
  });

  const { data: txsRes } = useQuery({
    queryKey: ["transactions"],
    queryFn: () => window.cryptoControl.transactions.list(),
  });

  const assets = useMemo(() => assetsRes?.ok ? assetsRes.data : [], [assetsRes]);
  const currentPrice = priceRes?.ok ? priceRes.data.price : null;

  const filteredAssets = useMemo(() => assets.filter(
    (a: { id: string; name: string; symbol: string }) =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.symbol.toLowerCase().includes(search.toLowerCase())
  ), [assets, search]);

  const selectedAssetData = assets.find((a: { id: string; name: string }) => a.id === selectedAsset);

  let variationPeriod: number | null = null;
  let chartStartTime = 0;
  if (historyRes?.ok && historyRes.data?.points.length > 0) {
    const pts = historyRes.data.points;
    variationPeriod = ((pts[pts.length - 1].value - pts[0].value) / pts[0].value) * 100;
    chartStartTime = pts[0].time as number;
  }

  const operations = useMemo(() => {
    if (!txsRes?.ok || !txsRes.data || !chartStartTime) return [];
    const ops: { time: import("lightweight-charts").Time; type: string; label: string; color: string }[] = [];

    for (const tx of txsRes.data) {
      const txTimeSec = Math.floor(tx.date / 1000);
      if (txTimeSec < chartStartTime - 86_400) continue;

      for (const leg of tx.legs) {
        if (leg.assetId !== selectedAsset) continue;
        let type = "";
        let label = "";
        let color = "";

        if (tx.type === "buy" && leg.legType === "destination") {
          type = "buy"; label = `Compra ${leg.amount}`; color = "#16a34a";
        } else if (tx.type === "sell" && leg.legType === "source") {
          type = "sell"; label = `Venta ${Math.abs(leg.amount)}`; color = "#ef4444";
        } else if (tx.type === "convert" && leg.legType === "destination") {
          type = "buy"; label = `Conv. (in) ${leg.amount}`; color = "#327cff";
        } else if (tx.type === "convert" && leg.legType === "source") {
          type = "sell"; label = `Conv. (out) ${Math.abs(leg.amount)}`; color = "#f59e0b";
        }

        if (type) ops.push({ time: txTimeSec as import("lightweight-charts").Time, type, label, color });
      }
    }
    return ops;
  }, [txsRes, selectedAsset, chartStartTime]);

  return (
    <div>
      <h1 className="page-title">Mercado</h1>

      <div className="mercado-layout">
        {/* Sidebar con lista de activos */}
        <div className="mercado-sidebar">
          <Input
            type="text"
            placeholder="Buscar activo..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className="asset-list" style={{ marginTop: 8 }}>
            {filteredAssets.map((a: { id: string; name: string; symbol: string; logoUrl?: string | null }) => (
              <div
                key={a.id}
                className={`asset-item ${selectedAsset === a.id ? "selected" : ""}`}
                onClick={() => setSelectedAsset(a.id)}
              >
                <CryptoLogo logoUrl={a.logoUrl} symbol={a.symbol} size={28} />
                <div className="asset-info">
                  <span className="asset-name">{a.name}</span>
                  <span className="asset-symbol">{a.symbol}</span>
                </div>
              </div>
            ))}
            {filteredAssets.length === 0 && (
              <EmptyState title="Sin resultados" description="No hay activos que coincidan con la búsqueda." />
            )}
          </div>
        </div>

        {/* Panel principal */}
        <Card className="mercado-main" style={{ padding: 0, overflow: "hidden" }}>
          <CardHeader>
            <div className="market-header" style={{ marginBottom: 0 }}>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 700, margin: 0 }}>{selectedAssetData?.name ?? selectedAsset}</h2>
              {typeof currentPrice === "number" && Number.isFinite(currentPrice) && (
                <div className="current-price">
                  <PriceDisplay value={currentPrice} className="price-value" style={{ fontSize: "1.5rem", fontWeight: 700 }} />
                  {variationPeriod !== null && (
                    <span className={`asset-change ${variationPeriod >= 0 ? "text-positive" : "text-negative"}`}>
                      {variationPeriod >= 0 ? "+" : ""}{variationPeriod.toFixed(2)}%
                    </span>
                  )}
                </div>
              )}
            </div>
          </CardHeader>

          <CardContent style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <div style={{ flex: 1, minHeight: 0 }}>
              {loadingHistory ? (
                <div style={{ height: isMobile ? 260 : 400, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <LoadingState text="Cargando datos de mercado..." />
                </div>
              ) : historyRes?.ok && historyRes.data ? (
                <MarketChart
                  data={historyRes.data.points.map((p: { time: number; value: number }) => ({
                    time: p.time as import("lightweight-charts").Time,
                    value: p.value,
                  }))}
                  operations={operations}
                  provider={historyRes.data.provider}
                  isCached={historyRes.data.isCached}
                  height={isMobile ? 260 : 400}
                />
              ) : (
                <div style={{ height: isMobile ? 260 : 400, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <ErrorState
                    message="No se pudo cargar la gráfica del mercado."
                    onRetry={() => refetchHistory()}
                  />
                </div>
              )}
            </div>

            <div style={{ marginTop: "16px" }}>
              <PeriodSelector
                activePeriod={uiPeriod}
                onChange={setUiPeriod}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
