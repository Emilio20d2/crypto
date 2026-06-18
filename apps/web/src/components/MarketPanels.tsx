import { Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./Card";
import { Input } from "./Input";
import { LocalAssetLogo } from "./LocalAssetLogo";
import { MarketChart, type ChartPoint } from "./MarketChart";
import { PeriodSelector, type Period } from "./PeriodSelector";
import { compactEurFormatter, formatDateTime, formatMoney, formatPercent } from "../lib/format";
import { fearGreedLabel, fearGreedColor, type RankedAsset } from "../lib/marketAnalysis";
import type { FearGreedResult, GlobalMetricsResult } from "@crypto-control/core";

function formatCompactNumber(value: number | null | undefined, suffix = "") {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Pendiente";
  const formatted = value.toLocaleString("es-ES", {
    notation: "compact",
    maximumFractionDigits: 2,
  });
  return suffix ? `${formatted} ${suffix}` : formatted;
}

function formatCompactMoney(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? compactEurFormatter.format(value) : "Pendiente";
}

function globalMetricsSourceLabel(source?: string | null) {
  if (source === "coingecko") return "CoinGecko";
  if (source === "coinlore") return "CoinLore";
  if (source === "coinpaprika") return "CoinPaprika";
  return source || "No disponible";
}

function globalMetricsStateLabel(state?: string | null, isCached?: boolean) {
  if (state === "live") return "Live";
  if (state === "cached" || isCached) return "Caché";
  if (state === "fallback") return "Fallback";
  if (state === "unavailable") return "Sin dato";
  return "Pendiente";
}

// "No aplica" only for assets where dominance is structurally meaningless
// (anything but BTC/ETH). When it does apply but the value is missing
// (global metrics source down), that must read as "No disponible".
function formatDominance(value: number | null | undefined, applicable?: boolean) {
  if (!applicable) return "No aplica";
  return formatPercent(value, "No disponible");
}

export function PriceChangeChip({ change }: { change?: number | null }) {
  if (typeof change !== "number" || !Number.isFinite(change)) return null;
  const positive = change >= 0;
  return (
    <span className={`asset-sentiment-chip ${positive ? "positive" : "negative"}`}>
      {positive ? "+" : ""}{change.toFixed(2)}%
    </span>
  );
}

export function MarketSidebar({
  assets,
  search,
  filter,
  selectedId,
  onSearch,
  onFilter,
  onSelect,
  priceChanges,
}: {
  assets: any[];
  search: string;
  filter?: "all" | "gainers" | "losers";
  selectedId?: string;
  onSearch: (value: string) => void;
  onFilter?: (value: "all" | "gainers" | "losers") => void;
  onSelect: (asset: any) => void;
  priceChanges?: Record<string, number | null>;
}) {
  return (
    <aside className="market-sidebar">
      <div className="market-search">
        <Search size={15} />
        <Input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Buscar mercado" />
      </div>
      {onFilter && (
        <div className="market-filter-tabs" role="group" aria-label="Filtro de mercado">
          <button type="button" className={filter === "all" ? "active" : ""} onClick={() => onFilter("all")}>Todos</button>
          <button type="button" className={filter === "gainers" ? "active" : ""} onClick={() => onFilter("gainers")}>Ganadoras</button>
          <button type="button" className={filter === "losers" ? "active" : ""} onClick={() => onFilter("losers")}>Perdedoras</button>
        </div>
      )}
      <div className="market-asset-list">
        {assets.length === 0 ? (
          <p className="empty-inline market-empty-filter">Sin activos para este filtro.</p>
        ) : assets.map((asset) => (
          <button
            key={asset.id}
            type="button"
            className={asset.id === selectedId ? "market-asset active" : "market-asset"}
            onClick={() => onSelect(asset)}
          >
            <LocalAssetLogo logoUrl={asset.logoUrl} symbol={asset.symbol} size={30} />
            <span>
              <strong>{asset.name}</strong>
              <small>{asset.symbol}</small>
            </span>
            <PriceChangeChip change={priceChanges?.[asset.id]} />
          </button>
        ))}
      </div>
    </aside>
  );
}

export function MarketHeader({
  asset,
  price,
  change24h,
  high24h,
  low24h,
  volume24h,
  marketCap,
  dominance,
  dominanceApplicable,
  sourceLabel,
}: {
  asset: any;
  price?: number | null;
  change24h?: number | null;
  high24h?: number | null;
  low24h?: number | null;
  volume24h?: number | null;
  marketCap?: number | null;
  dominance?: number | null;
  dominanceApplicable?: boolean;
  sourceLabel?: string;
}) {
  return (
    <section className="market-header">
      <div className="market-title">
        <LocalAssetLogo logoUrl={asset?.logoUrl} symbol={asset?.symbol || "?"} size={44} />
        <span>
          <strong>{asset?.name || "Mercado"}</strong>
          <small>{asset?.symbol || ""} / EUR{sourceLabel ? ` · ${sourceLabel}` : ""}</small>
        </span>
      </div>
      <div className="market-price-block">
        <strong>{formatMoney(price, "Precio pendiente")}</strong>
        <span className={change24h && change24h < 0 ? "text-negative" : "text-positive"}>{formatPercent(change24h, "24 h pendiente")}</span>
      </div>
      <dl className="market-overview-grid">
        <div><dt>Cambio 24 h</dt><dd className={change24h && change24h < 0 ? "text-negative" : "text-positive"}>{formatPercent(change24h, "Pendiente")}</dd></div>
        <div><dt>Máx. 24 h</dt><dd>{formatMoney(high24h, "Pendiente")}</dd></div>
        <div><dt>Mín. 24 h</dt><dd>{formatMoney(low24h, "Pendiente")}</dd></div>
        <div><dt>Volumen</dt><dd>{formatCompactNumber(volume24h, asset?.symbol)}</dd></div>
        <div><dt>Market Cap</dt><dd>{formatCompactMoney(marketCap)}</dd></div>
        <div><dt>Dominancia</dt><dd>{formatDominance(dominance, dominanceApplicable)}</dd></div>
      </dl>
    </section>
  );
}

export function MarketChartPanel({
  data,
  period,
  onPeriodChange,
  loading,
  error,
  operations = [],
  sourceLabel,
}: {
  data: ChartPoint[];
  period: Period;
  onPeriodChange: (period: Period) => void;
  loading?: boolean;
  error?: string;
  operations?: { time: import("lightweight-charts").Time; type: string; label: string; color: string }[];
  sourceLabel?: string;
}) {
  return (
    <Card className="market-chart-panel">
      <CardHeader className="chart-panel-header">
        <div>
          <CardTitle>Gráfica de mercado</CardTitle>
          <p className="panel-caption">
            {loading ? "Cargando periodo..." : error ? error : sourceLabel ? `Histórico real del activo seleccionado · ${sourceLabel}` : "Histórico real del activo seleccionado"}
          </p>
        </div>
        <PeriodSelector value={period} onChange={onPeriodChange} />
      </CardHeader>
      <CardContent className="chart-panel-content">
        <MarketChart data={data} operations={operations} height={310} emptyStateMessage="No hay datos reales suficientes para este periodo." />
      </CardContent>
    </Card>
  );
}

export function MarketStats({
  price,
  periodChangeValue,
  change24h,
  high24h,
  low24h,
  volume24h,
  marketCap,
  dominance,
  dominanceApplicable,
  points,
}: {
  price?: number | null;
  periodChangeValue?: number | null;
  change24h?: number | null;
  high24h?: number | null;
  low24h?: number | null;
  volume24h?: number | null;
  marketCap?: number | null;
  dominance?: number | null;
  dominanceApplicable?: boolean;
  points: ChartPoint[];
}) {
  const values = points.map((point) => point.value).filter((value) => Number.isFinite(value));
  const high = values.length ? Math.max(...values) : null;
  const low = values.length ? Math.min(...values) : null;

  return (
    <Card className="market-stats">
      <CardHeader>
        <CardTitle>Métricas</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="stats-list">
          <div><dt>Precio</dt><dd>{formatMoney(price, "Pendiente")}</dd></div>
          <div><dt>Cambio periodo</dt><dd className={periodChangeValue && periodChangeValue < 0 ? "text-negative" : "text-positive"}>{formatPercent(periodChangeValue, "Pendiente")}</dd></div>
          <div><dt>Cambio 24 h</dt><dd className={change24h && change24h < 0 ? "text-negative" : "text-positive"}>{formatPercent(change24h, "Pendiente")}</dd></div>
          <div><dt>ATH periodo</dt><dd>{formatMoney(high, "Pendiente")}</dd></div>
          <div><dt>ATL periodo</dt><dd>{formatMoney(low, "Pendiente")}</dd></div>
          <div><dt>Máx. 24 h</dt><dd>{formatMoney(high24h, "Pendiente")}</dd></div>
          <div><dt>Mín. 24 h</dt><dd>{formatMoney(low24h, "Pendiente")}</dd></div>
          <div><dt>Volumen 24 h</dt><dd>{formatCompactNumber(volume24h)}</dd></div>
          <div><dt>Capitalización</dt><dd>{formatCompactMoney(marketCap)}</dd></div>
          <div><dt>Dominancia</dt><dd>{formatDominance(dominance, dominanceApplicable)}</dd></div>
        </dl>
      </CardContent>
    </Card>
  );
}

export function FearGreedCard({
  fearGreed,
  loading,
  error,
}: {
  fearGreed?: FearGreedResult | null;
  loading?: boolean;
  error?: string;
}) {
  const value = fearGreed?.value ?? null;
  const state = fearGreed?.state ?? (fearGreed?.isCached ? "cached" : value !== null ? "live" : "unavailable");
  const stateLabel = state === "live"
    ? "Live"
    : state === "cached"
      ? "Caché"
      : state === "fallback"
        ? "Fallback"
        : "Sin dato";
  const label = value !== null ? (fearGreed?.label || fearGreedLabel(value)) : "No disponible";
  const source = fearGreed?.source ?? "alternative.me";
  const displayError = fearGreed?.error ?? error;

  return (
    <Card className="fear-greed-card">
      <CardHeader>
        <CardTitle>Fear &amp; Greed</CardTitle>
        <p className="panel-caption">Índice del mercado global</p>
      </CardHeader>
      <CardContent>
        {loading && !fearGreed ? (
          <div className="fear-greed-skeleton" aria-hidden="true" />
        ) : (
          <div className={`fear-greed-content fear-greed-content-${state}`}>
            {value !== null ? (
              <div className="fear-greed-gauge">
                <div
                  className="fear-greed-needle"
                  style={{ left: `${value}%`, background: fearGreedColor(value) }}
                />
                <div className="fear-greed-track" />
              </div>
            ) : (
              <div className="fear-greed-gauge fear-greed-gauge-empty">
                <div className="fear-greed-track" />
              </div>
            )}
            <strong className="fear-greed-value" style={value !== null ? { color: fearGreedColor(value) } : undefined}>
              {value !== null ? Math.round(value) : "Sin dato"}
            </strong>
            <span className="fear-greed-label">{label}</span>
            <div className="fear-greed-meta">
              <span>Fuente: {source}</span>
              <span>Actualizado: {formatDateTime(fearGreed?.fetchedAt)}</span>
              <span>Estado: {stateLabel}</span>
            </div>
            {displayError && state !== "live" && (
              <small className="fear-greed-cached">{state === "fallback" ? "Último valor válido" : displayError}</small>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function GlobalMetricsCard({
  metrics,
  loading,
}: {
  metrics?: GlobalMetricsResult | null;
  loading?: boolean;
}) {
  return (
    <Card className="global-metrics-card">
      <CardHeader>
        <CardTitle>Métricas globales</CardTitle>
        <p className="panel-caption">Dominancia y capitalización</p>
      </CardHeader>
      <CardContent>
        <dl className="stats-list">
          <div>
            <dt>Dominancia BTC</dt>
            <dd>
              {loading ? "Cargando..." : metrics?.btcDominance != null ? `${metrics.btcDominance.toFixed(1)}%` : "No disponible"}
            </dd>
          </div>
          <div>
            <dt>Dominancia ETH</dt>
            <dd>
              {loading ? "Cargando..." : metrics?.ethDominance != null ? `${metrics.ethDominance.toFixed(1)}%` : "No disponible"}
            </dd>
          </div>
          <div>
            <dt>Cap. total</dt>
            <dd>
              {loading ? "Cargando..." : metrics?.totalMarketCapUsd != null
                ? `$${(metrics.totalMarketCapUsd / 1e12).toFixed(2)}T`
                : "No disponible"}
            </dd>
          </div>
          <div>
            <dt>Volumen 24h</dt>
            <dd>
              {loading ? "Cargando..." : metrics?.totalVolumeUsd != null
                ? `$${(metrics.totalVolumeUsd / 1e9).toFixed(1)}B`
                : "No disponible"}
            </dd>
          </div>
          <div>
            <dt>Tendencia 24h</dt>
            <dd className={metrics?.marketCapChangePercentage24h != null ? (metrics.marketCapChangePercentage24h < 0 ? "text-negative" : "text-positive") : ""}>
              {loading ? "Cargando..." : metrics?.marketCapChangePercentage24h != null
                ? `${metrics.marketCapChangePercentage24h >= 0 ? "+" : ""}${metrics.marketCapChangePercentage24h.toFixed(2)}%`
                : "No disponible"}
            </dd>
          </div>
        </dl>
        <div className="global-metrics-meta">
          <span>Fuente: {globalMetricsSourceLabel(metrics?.source)}</span>
          <span>Estado: {globalMetricsStateLabel(metrics?.state, metrics?.isCached)}</span>
          <span>Actualizado: {formatDateTime(metrics?.fetchedAt)}</span>
        </div>
        {metrics?.error && (
          <p className="global-metrics-error">{metrics.error}</p>
        )}
      </CardContent>
    </Card>
  );
}

export function TopAssetsPanel({
  assets,
  priceChanges,
  period,
}: {
  assets: any[];
  priceChanges: Record<string, number | null>;
  period: string;
}) {
  const ranked = [...assets]
    .filter((a) => typeof priceChanges[a.id] === "number" && Number.isFinite(priceChanges[a.id]))
    .sort((a, b) => (priceChanges[b.id] ?? 0) - (priceChanges[a.id] ?? 0));

  const gainers: RankedAsset[] = ranked
    .filter((a) => (priceChanges[a.id] ?? 0) > 0)
    .slice(0, 3)
    .map((a) => ({ assetId: a.id, changePercent: priceChanges[a.id]! }));

  const losers: RankedAsset[] = [...ranked]
    .reverse()
    .filter((a) => (priceChanges[a.id] ?? 0) < 0)
    .slice(0, 3)
    .map((a) => ({ assetId: a.id, changePercent: priceChanges[a.id]! }));

  const assetMap = Object.fromEntries(assets.map((a) => [a.id, a]));

  function AssetRow({ item, positive }: { item: RankedAsset; positive: boolean }) {
    const a = assetMap[item.assetId];
    return (
      <div className="top-asset-row">
        <LocalAssetLogo logoUrl={a?.logoUrl} symbol={a?.symbol || item.assetId} size={24} />
        <span className="top-asset-name">{a?.symbol || item.assetId}</span>
        <span className={positive ? "text-gain" : "text-loss"}>
          {positive ? "+" : ""}{item.changePercent.toFixed(2)}%
        </span>
      </div>
    );
  }

  return (
    <Card className="top-assets-card">
      <CardHeader>
        <CardTitle>Top activos</CardTitle>
        <p className="panel-caption">Rendimiento real · {period}</p>
      </CardHeader>
      <CardContent>
        {gainers.length === 0 && losers.length === 0 ? (
          <p className="empty-inline">Sin datos de precio suficientes</p>
        ) : (
          <div className="top-assets-grid">
            <div>
              <p className="top-assets-label text-gain">Mayores subidas</p>
              {gainers.length === 0
                ? <p className="empty-inline">Sin ganadoras</p>
                : gainers.map((item) => <AssetRow key={item.assetId} item={item} positive />)
              }
            </div>
            <div>
              <p className="top-assets-label text-loss">Mayores caídas</p>
              {losers.length === 0
                ? <p className="empty-inline">Sin perdedoras</p>
                : losers.map((item) => <AssetRow key={item.assetId} item={item} positive={false} />)
              }
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
