import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { PageToolbar } from "../components/PageToolbar";
import {
  MarketChartPanel,
  MarketHeader,
  MarketSidebar,
  FearGreedCard,
  GlobalMetricsCard,
  TopAssetsPanel,
} from "../components/MarketPanels";
import { MarketSentimentSection } from "../components/SentimentPanels";
import type { ChartPoint } from "../components/MarketChart";
import type { Period } from "../components/PeriodSelector";
import type { MarketSentimentTimeframe } from "@crypto-control/core";
import { rankByPriceChange } from "../lib/marketAnalysis";

type MarketFilter = "all" | "gainers" | "losers";

const PERIOD_MAP: Record<Period, "1h" | "24h" | "7d" | "30d" | "1y" | "all"> = {
  "1h": "1h",
  "24h": "24h",
  "1w": "7d",
  "1m": "30d",
  "1y": "1y",
  "all": "all",
};

const PERIOD_LABEL: Record<MarketFilter, string> = {
  all: "Todos",
  gainers: "Ganadoras 24h",
  losers: "Perdedoras 24h",
};

function historyToChart(points: { time: number; value: number; source?: string; confidence?: number }[]): ChartPoint[] {
  return points.map((point) => ({
    time: point.time as import("lightweight-charts").Time,
    value: point.value,
    source: point.source,
    confidence: point.confidence,
  }));
}

function sourceLabelFor(provider?: string | null, isCached?: boolean, cacheStatus?: string) {
  if (!provider || provider === "coinbase" || provider === "local") return undefined;
  const prefix = isCached || cacheStatus === "stale" ? "Último dato válido" : "Datos";
  if (provider === "coingecko") return `${prefix} vía CoinGecko`;
  if (provider === "cache") return "Último dato válido";
  return isCached || cacheStatus === "stale" ? "Último dato válido de fuente alternativa" : "Fuente alternativa";
}

export function Mercado() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("24h");
  const [sentimentPeriod, setSentimentPeriod] = useState<MarketSentimentTimeframe>("24h");
  const [marketFilter, setMarketFilter] = useState<MarketFilter>("all");

  const { data: assetsRes, isLoading: loadingAssets } = useQuery({
    queryKey: ["assets"],
    queryFn: () => window.cryptoControl.assets.list(),
  });

  const { data: fearGreedRes, isLoading: loadingFearGreed } = useQuery({
    queryKey: ["market", "fear-greed"],
    queryFn: () => window.cryptoControl.market.getFearGreed(),
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });

  const { data: globalMetricsRes, isLoading: loadingGlobalMetrics } = useQuery({
    queryKey: ["market", "global-metrics"],
    queryFn: () => window.cryptoControl.market.getGlobalMetrics(),
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

  const assets = useMemo(() => assetsRes?.ok ? assetsRes.data : [], [assetsRes]);

  const searchedAssets = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return assets;
    return assets.filter((asset: any) =>
      asset.name.toLowerCase().includes(term) ||
      asset.symbol.toLowerCase().includes(term)
    );
  }, [assets, search]);

  // Fetch 24h overview for all assets to get real price changes (mostly from local snapshot)
  const overviewQueries = useQueries({
    queries: assets.map((asset: any) => ({
      queryKey: ["market", "overview", asset.id],
      queryFn: () => window.cryptoControl.market.getOverview({ assetId: asset.id, quoteCurrency: "EUR" }),
      enabled: !!asset.id,
      staleTime: 5 * 60 * 1000,
    })),
  });

  const priceChangeMap = useMemo<Record<string, number | null>>(() => {
    const map: Record<string, number | null> = {};
    assets.forEach((asset: any, idx: number) => {
      const res = overviewQueries[idx]?.data;
      map[asset.id] = res?.ok ? (res.data.change24h ?? null) : null;
    });
    return map;
  }, [assets, overviewQueries]);

  const filteredAssets = useMemo(() => {
    if (marketFilter === "gainers") {
      const gainers = rankByPriceChange(priceChangeMap, "gainers", 8);
      const ids = new Set(gainers.map((g) => g.assetId));
      return searchedAssets.filter((a: any) => ids.has(a.id))
        .sort((a: any, b: any) => (priceChangeMap[b.id] ?? -Infinity) - (priceChangeMap[a.id] ?? -Infinity));
    }
    if (marketFilter === "losers") {
      const losers = rankByPriceChange(priceChangeMap, "losers", 8);
      const ids = new Set(losers.map((l) => l.assetId));
      return searchedAssets.filter((a: any) => ids.has(a.id))
        .sort((a: any, b: any) => (priceChangeMap[a.id] ?? Infinity) - (priceChangeMap[b.id] ?? Infinity));
    }
    return searchedAssets;
  }, [marketFilter, searchedAssets, priceChangeMap]);

  const selectedAsset = filteredAssets.find((asset: any) => asset.id === selectedAssetId) || filteredAssets[0] || searchedAssets[0];

  const assetSentimentQuery = useQuery({
    queryKey: ["sentiment", "asset", selectedAsset?.id, sentimentPeriod],
    queryFn: () => window.cryptoControl.sentiment.getAsset({ assetId: selectedAsset.id, timeframe: sentimentPeriod }),
    enabled: !!selectedAsset,
    staleTime: 5 * 60 * 1000,
  });

  const globalSentimentQuery = useQuery({
    queryKey: ["sentiment", "global", sentimentPeriod],
    queryFn: () => window.cryptoControl.sentiment.getGlobal({ timeframe: sentimentPeriod }),
    staleTime: 5 * 60 * 1000,
  });

  const { data: priceRes } = useQuery({
    queryKey: ["market", "price", selectedAsset?.id],
    queryFn: () => window.cryptoControl.market.getCurrentPrice({ assetId: selectedAsset.id, quoteCurrency: "EUR" }),
    enabled: !!selectedAsset,
    staleTime: 60 * 1000,
  });

  const { data: overviewRes } = useQuery({
    queryKey: ["market", "overview", selectedAsset?.id],
    queryFn: () => window.cryptoControl.market.getOverview({ assetId: selectedAsset.id, quoteCurrency: "EUR" }),
    enabled: !!selectedAsset,
    staleTime: 5 * 60 * 1000,
  });

  const { data: historyRes, isLoading: loadingHistory } = useQuery({
    queryKey: ["market", "history", selectedAsset?.id, period],
    queryFn: () => window.cryptoControl.market.getHistoricalPrices({
      assetId: selectedAsset.id,
      quoteCurrency: "EUR",
      period: PERIOD_MAP[period],
    }),
    enabled: !!selectedAsset,
  });

  const chartData = historyRes?.ok ? historyToChart(historyRes.data.points) : [];
  const overview = overviewRes?.ok ? overviewRes.data : null;
  const price = overview?.price ?? (priceRes?.ok ? priceRes.data.price : null);
  const change24h = overview?.change24h ?? null;
  const assetSentiment = assetSentimentQuery.data?.ok ? assetSentimentQuery.data.data : null;
  const globalSentiment = globalSentimentQuery.data?.ok ? globalSentimentQuery.data.data : null;
  const fearGreed = fearGreedRes?.ok ? fearGreedRes.data : null;
  const globalMetrics = globalMetricsRes?.ok ? globalMetricsRes.data : null;

  // Dominance only has meaning for BTC/ETH — other assets correctly show
  // "No aplica". For BTC/ETH a null value means the global metrics source
  // (CoinGecko) is temporarily unavailable, which must read as "No
  // disponible", not "No aplica" (that previously conflated the two).
  const dominanceApplicable = selectedAsset?.id === "BTC" || selectedAsset?.id === "ETH";
  const dominance = selectedAsset?.id === "BTC"
    ? globalMetrics?.btcDominance ?? null
    : selectedAsset?.id === "ETH"
      ? globalMetrics?.ethDominance ?? null
      : overview?.dominance ?? null;
  const headerSourceLabel = sourceLabelFor(
    overview?.provider ?? (priceRes?.ok ? priceRes.data.provider : null),
    priceRes?.ok ? priceRes.data.state === "cached" : false
  );
  const chartSourceLabel = sourceLabelFor(
    historyRes?.ok ? historyRes.data.provider : null,
    historyRes?.ok ? historyRes.data.isCached : false,
    historyRes?.ok ? historyRes.data.cacheStatus : undefined
  );

  if (loadingAssets) {
    return (
      <section className="page-stack">
        <PageToolbar title="Mercado" meta="Cargando activos" />
      </section>
    );
  }

  if (!selectedAsset) {
    return (
      <section className="page-stack">
        <PageToolbar title="Mercado" />
        <EmptyState icon={<ExternalLink size={44} />} title="Sin activos" description="No hay mercados configurados en la base de datos local." />
      </section>
    );
  }

  return (
    <section className="page-stack market-page">
      <PageToolbar
        title="Mercado"
        meta={`${PERIOD_LABEL[marketFilter]} · datos reales`}
        actions={
          <Button type="button" variant="secondary" onClick={() => navigate(`/activo/${selectedAsset.id}`)}>
            Abrir detalle
          </Button>
        }
      />

      <div className="market-mobile-selector">
        <select className="ui-select" value={selectedAsset.id} onChange={(event) => setSelectedAssetId(event.target.value)}>
          {filteredAssets.map((asset: any) => (
            <option key={asset.id} value={asset.id}>{asset.name} ({asset.symbol})</option>
          ))}
        </select>
        <div className="market-filter-tabs" role="group" aria-label="Filtro de mercado móvil">
          <button type="button" className={marketFilter === "all" ? "active" : ""} onClick={() => setMarketFilter("all")}>Todos</button>
          <button type="button" className={marketFilter === "gainers" ? "active" : ""} onClick={() => setMarketFilter("gainers")}>Ganadoras</button>
          <button type="button" className={marketFilter === "losers" ? "active" : ""} onClick={() => setMarketFilter("losers")}>Perdedoras</button>
        </div>
      </div>

      <div className="market-workbench">
        <MarketSidebar
          assets={filteredAssets}
          search={search}
          filter={marketFilter}
          selectedId={selectedAsset.id}
          onSearch={setSearch}
          onFilter={setMarketFilter}
          onSelect={(asset) => setSelectedAssetId(asset.id)}
          priceChanges={priceChangeMap}
        />
        <div className="market-main-panel">
          <MarketHeader
            asset={selectedAsset}
            price={price}
            change24h={change24h}
            high24h={overview?.high24h}
            low24h={overview?.low24h}
            volume24h={overview?.volume24h}
            marketCap={overview?.marketCap}
            dominance={dominance}
            dominanceApplicable={dominanceApplicable}
            sourceLabel={headerSourceLabel}
          />
          <MarketChartPanel
            data={chartData}
            period={period}
            onPeriodChange={setPeriod}
            loading={loadingHistory}
            error={historyRes && !historyRes.ok ? historyRes.error.message : undefined}
            sourceLabel={chartSourceLabel}
          />
        </div>
      </div>

      <div className="market-macro-grid">
        <FearGreedCard
          fearGreed={fearGreed}
          loading={loadingFearGreed}
          error={fearGreedRes && !fearGreedRes.ok ? fearGreedRes.error.message : undefined}
        />
        <GlobalMetricsCard
          metrics={globalMetrics}
          loading={loadingGlobalMetrics}
        />
        <TopAssetsPanel
          assets={assets}
          priceChanges={priceChangeMap}
          period="24h"
        />
      </div>

      <div className="market-insight-grid">
        <MarketSentimentSection
          assetName={selectedAsset.name}
          assetSymbol={selectedAsset.symbol}
          timeframe={sentimentPeriod}
          onTimeframeChange={setSentimentPeriod}
          assetSentiment={assetSentiment}
          globalSentiment={globalSentiment}
          assetLoading={assetSentimentQuery.isLoading}
          globalLoading={globalSentimentQuery.isLoading}
        />
      </div>
    </section>
  );
}
