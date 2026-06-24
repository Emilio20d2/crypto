import type { CSSProperties } from "react";
import { CircleAlert, Database, ShieldCheck, TrendingUp, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./Card";
import { LocalAssetLogo } from "./LocalAssetLogo";
import { MarketChart, type ChartPoint } from "./MarketChart";
import { PeriodSelector, type Period } from "./PeriodSelector";
import { Sparkline } from "./Sparkline";
import { compactEurFormatter, formatAllocation, formatCrypto, formatMoney } from "../lib/format";

type AllocationStyle = CSSProperties & {
  "--allocation-width"?: string;
  "--allocation-color"?: string;
};

const ALLOCATION_COLORS = ["#327cff", "#25bfe8", "#5ae37a", "#111827", "#64748b", "#0f766e", "#9333ea", "#e11d48"];

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positionInvested(position: any, localCostByAsset: Record<string, number> = {}, pendingCostByAsset: Record<string, boolean> = {}) {
  if (pendingCostByAsset[position.asset]) return null;
  return finiteNumber(localCostByAsset[position.asset]);
}

function positionPnL(position: any, localCostByAsset: Record<string, number> = {}, pendingCostByAsset: Record<string, boolean> = {}) {
  const invested = positionInvested(position, localCostByAsset, pendingCostByAsset);
  const value = finiteNumber(position.totalBalanceFiat);
  if (invested !== null && value !== null) return value - invested;
  return null;
}

function positionRoi(position: any, localCostByAsset: Record<string, number> = {}, pendingCostByAsset: Record<string, boolean> = {}) {
  const invested = positionInvested(position, localCostByAsset, pendingCostByAsset);
  const pnl = positionPnL(position, localCostByAsset, pendingCostByAsset);
  return invested !== null && invested > 0 && pnl !== null ? (pnl / invested) * 100 : null;
}

function positionAverageCost(position: any, localCostByAsset: Record<string, number> = {}, pendingCostByAsset: Record<string, boolean> = {}) {
  const invested = positionInvested(position, localCostByAsset, pendingCostByAsset);
  const quantity = finiteNumber(position.totalBalanceCrypto);
  return invested !== null && quantity !== null && quantity > 0 ? invested / quantity : null;
}

function formatMoneyCompact(value: number | null | undefined, fallback = "En cálculo") {
  return typeof value === "number" && Number.isFinite(value) ? compactEurFormatter.format(value) : fallback;
}

function formatPercentPoints(value: number | null | undefined, fallback = "Pendiente") {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value >= 0 ? "+" : ""}${value.toLocaleString("es-ES", { maximumFractionDigits: 2 })}%`
    : fallback;
}

function formatMoneyPerCoin(value: number | null | undefined, fallback = "Pendiente") {
  // No " / moneda" suffix: with real prices (e.g. "59.710,94 €") it pushed the
  // value past the card's ellipsis truncation, hiding the actual number.
  return typeof value === "number" && Number.isFinite(value) ? formatMoney(value) : fallback;
}

function positionCurrentPrice(position: any) {
  const marketPrice = finiteNumber(position.market?.price);
  if (marketPrice !== null) return { price: marketPrice, state: "market" as const };

  const value = finiteNumber(position.totalBalanceFiat);
  const amount = finiteNumber(position.totalBalanceCrypto);
  if (value !== null && amount !== null && amount > 0) {
    return { price: value / amount, state: "partial" as const };
  }

  return { price: null, state: "missing" as const };
}

function priceSourceLabel(position: any, portfolioState?: string) {
  if (portfolioState === "cached") return "Ultimo valido";
  const status = typeof position.market?.status === "string" ? position.market.status : "";
  if (status.startsWith("fallback:")) {
    const provider = status.replace("fallback:", "").trim();
    return provider ? `via ${provider}` : "fuente alternativa";
  }
  return "Live";
}

export function DataStatus({ state, reason }: { state?: string; reason?: string }) {
  const label = state === "live" ? "Live" : state === "cached" ? "Caché" : state === "unavailable" ? "Error" : "Sin estado";
  const Icon = state === "live" ? ShieldCheck : state === "cached" ? Database : CircleAlert;
  return (
    <span className={`data-status data-status-${state || "unknown"}`} title={reason}>
      <Icon size={14} />
      {label}
    </span>
  );
}


export function PortfolioMetrics({
  totalBalance,
  cryptoTotalEur,
  eurcTotalEur,
  totalInvested,
  totalInvestedPendingLabel,
  performance,
  variation24h,
  variation24hPercent,
  positionsCount,
}: {
  totalBalance?: number | null;
  cryptoTotalEur?: number | null;
  eurcTotalEur?: number | null;
  totalInvested?: number | null;
  totalInvestedPendingLabel?: string;
  performance?: number | null;
  variation24h?: number | null;
  variation24hPercent?: number | null;
  positionsCount: number;
}) {
  const variationTone = variation24h != null && variation24h < 0 ? "text-negative" : "text-positive";
  const variationSub = variation24h != null
    ? `${formatMoneyCompact(variation24h)} · ${formatPercentPoints(variation24hPercent, "—")} (24 h)`
    : null;

  // Compact breakdown shown when EURC reserve is present: "Cripto X€ · EURC Y€"
  const hasBothComponents = cryptoTotalEur != null && eurcTotalEur != null && eurcTotalEur > 0;
  const breakdownSub = hasBothComponents
    ? `Cripto ${formatMoneyCompact(cryptoTotalEur)} · EURC ${formatMoneyCompact(eurcTotalEur)}`
    : null;

  const secondaryMetrics = [
    {
      label: "Beneficio / Pérdida",
      sublabel: "Sólo criptomonedas",
      value: formatMoneyCompact(performance),
      tone: performance != null && performance < 0 ? "negative" : "positive",
      icon: TrendingUp,
    },
    {
      label: "Variación 24 h",
      sublabel: undefined as string | undefined,
      value: formatPercentPoints(variation24hPercent, "En cálculo"),
      tone: variation24h != null && variation24h < 0 ? "negative" : "positive",
      icon: TrendingUp,
    },
    { label: "Total invertido", sublabel: totalInvested == null ? totalInvestedPendingLabel : undefined, value: formatMoneyCompact(totalInvested), icon: Database },
    {
      label: "Reserva EURC",
      sublabel: undefined as string | undefined,
      value: eurcTotalEur != null ? formatMoneyCompact(eurcTotalEur) : "Sin reserva",
      tone: undefined as string | undefined,
      icon: Database,
    },
    { label: "Activos", sublabel: undefined as string | undefined, value: positionsCount.toLocaleString("es-ES"), icon: ShieldCheck },
  ];

  return (
    <section className="portfolio-metrics" aria-label="Resumen patrimonial">
      {/* Hero card — full-width, unabridged balance */}
      <div className="portfolio-metric portfolio-metric--hero">
        <Wallet size={15} />
        <span>Valor total de activos</span>
        <strong>{formatMoney(totalBalance, "En cálculo")}</strong>
        {breakdownSub !== null && (
          <small className="portfolio-metric-sub">{breakdownSub}</small>
        )}
        {variationSub !== null && (
          <small className={`portfolio-metric-sub ${variationTone}`}>{variationSub}</small>
        )}
      </div>

      {/* Secondary metrics — explicit 5-column grid, compact format */}
      {secondaryMetrics.map(({ label, sublabel, value, tone, icon: Icon }) => (
        <div className="portfolio-metric" key={label}>
          <Icon size={15} />
          <span>{label}{sublabel ? <em className="portfolio-metric-scope"> · {sublabel}</em> : null}</span>
          <strong className={tone ? `text-${tone}` : ""}>{value}</strong>
        </div>
      ))}
    </section>
  );
}

export function PortfolioChart({
  data,
  period,
  onPeriodChange,
}: {
  data: ChartPoint[];
  period: Period;
  onPeriodChange: (period: Period) => void;
}) {
  return (
    <Card className="portfolio-chart-panel">
      <CardHeader className="chart-panel-header">
        <div>
          <CardTitle>Evolución de cartera</CardTitle>
          <p className="panel-caption">Reconstrucción histórica: cantidad real × precio de mercado</p>
        </div>
        <PeriodSelector value={period} onChange={onPeriodChange} />
      </CardHeader>
      <CardContent className="chart-panel-content">
        <MarketChart
          data={data}
          height={280}
          emptyStateMessage="Todavía no hay suficiente histórico registrado. La evolución se mostrará cuando existan varias capturas reales de Coinbase."
        />
      </CardContent>
    </Card>
  );
}

export function AllocationPanel({
  positions,
  localCostByAsset = {},
  localCostPendingByAsset = {},
}: {
  positions: any[];
  localCostByAsset?: Record<string, number>;
  localCostPendingByAsset?: Record<string, boolean>;
}) {
  const allocated = positions.flatMap((position, index) => {
    const percent = formatAllocation(position.allocation);
    if (percent === null || percent <= 0) return [];
    return [{
      position,
      percent,
      color: position.assetColor || ALLOCATION_COLORS[index % ALLOCATION_COLORS.length],
    }];
  });

  // Held with a real balance but no resolvable price anywhere (Coinbase nor
  // the secondary fallbacks) — never just drop these from the breakdown,
  // show them explicitly as pending instead of silently disappearing.
  const pendingPrice = positions.filter((position) => {
    const percent = formatAllocation(position.allocation);
    if (percent !== null && percent > 0) return false;
    const crypto = finiteNumber(position.totalBalanceCrypto);
    return crypto !== null && crypto > 1e-12;
  });

  return (
    <Card className="allocation-panel">
      <CardHeader className="stacked-card-header">
        <CardTitle>Distribución</CardTitle>
        <p className="panel-caption">Asignación informada por Coinbase</p>
      </CardHeader>
      <CardContent>
        {allocated.length === 0 && pendingPrice.length === 0 ? (
          <p className="empty-inline">No disponible en Coinbase</p>
        ) : (
          <>
            {allocated.length > 0 && (
              <div className="allocation-bar" aria-label="Distribución de cartera">
                {allocated.map(({ position, percent, color }) => {
                  const style: AllocationStyle = {
                    "--allocation-width": `${percent}%`,
                    "--allocation-color": color,
                  };
                  return <span key={position.accountUuid || position.asset} style={style} title={`${position.asset} ${percent.toFixed(2)}%`} />;
                })}
              </div>
            )}
            <div className="allocation-list">
              {allocated.slice(0, 8).map(({ position, percent, color }) => {
                const style: AllocationStyle = { "--allocation-color": color };
                const pnl = positionPnL(position, localCostByAsset, localCostPendingByAsset);
                return (
                  <button type="button" className="allocation-item" key={position.accountUuid || position.asset}>
                    <LocalAssetLogo logoUrl={position.assetImageUrl || position.market?.iconUrl} symbol={position.asset} size={28} />
                    <span>
                      <strong>{position.market?.baseName || position.asset}</strong>
                      <small>{position.asset}</small>
                    </span>
                    <i style={style} />
                    <em>{percent.toLocaleString("es-ES", { maximumFractionDigits: 2 })}%</em>
                    <b>{formatMoney(position.totalBalanceFiat)}</b>
                    <strong className={pnl !== null && pnl < 0 ? "allocation-pnl text-negative" : "allocation-pnl text-positive"}>
                      {formatMoney(pnl, "PnL pendiente")}
                    </strong>
                  </button>
                );
              })}
              {pendingPrice.map((position) => (
                <button type="button" className="allocation-item" key={position.accountUuid || position.asset}>
                  <LocalAssetLogo logoUrl={position.assetImageUrl || position.market?.iconUrl} symbol={position.asset} size={28} />
                  <span>
                    <strong>{position.market?.baseName || position.asset}</strong>
                    <small>{position.asset}</small>
                  </span>
                  <i />
                  <em>Precio pendiente</em>
                  <b>{formatCrypto(position.totalBalanceCrypto)} {position.asset}</b>
                  <strong className="allocation-pnl">Pendiente</strong>
                </button>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PositionCard({
  position,
  name,
  logoUrl,
  onSelect,
  localCostByAsset,
  localCostPendingByAsset,
  portfolioState,
}: {
  position: any;
  name: string;
  logoUrl?: string | null;
  onSelect: () => void;
  localCostByAsset: Record<string, number>;
  localCostPendingByAsset: Record<string, boolean>;
  portfolioState?: string;
}) {
  const invested = positionInvested(position, localCostByAsset, localCostPendingByAsset);
  const pnl = positionPnL(position, localCostByAsset, localCostPendingByAsset);
  const roi = positionRoi(position, localCostByAsset, localCostPendingByAsset);
  const averageCost = positionAverageCost(position, localCostByAsset, localCostPendingByAsset);
  const weight = formatAllocation(position.allocation);
  const change = finiteNumber(position.market?.pricePercentageChange24h);
  const currentPrice = positionCurrentPrice(position);

  return (
    <button type="button" className="position-card" onClick={onSelect}>
      <span className="position-card-header">
        <span className="asset-identity">
          <LocalAssetLogo logoUrl={logoUrl} symbol={position.asset} size={36} />
          <span>
            <strong>{name}</strong>
            <small>{position.asset}</small>
          </span>
        </span>
        <span className="position-card-value">
          <strong>{formatMoney(position.totalBalanceFiat)}</strong>
          <small>{weight === null ? "Peso pendiente" : `${weight.toLocaleString("es-ES", { maximumFractionDigits: 2 })}% cartera`}</small>
        </span>
      </span>

      <span className="position-card-metrics">
        <span><small>Cantidad</small><strong>{formatCrypto(position.totalBalanceCrypto, "Pendiente")} {position.asset}</strong></span>
        <span>
          <small>Precio actual <i className={currentPrice.state === "market" && portfolioState !== "cached" ? "price-source-live" : "price-source-partial"}>{currentPrice.state === "missing" ? "pendiente" : currentPrice.state === "partial" ? "parcial" : priceSourceLabel(position, portfolioState)}</i></small>
          <strong>{formatMoneyPerCoin(currentPrice.price)}</strong>
        </span>
        <span><small>Invertido</small><strong>{formatMoney(invested, "Coste pendiente de completar")}</strong></span>
        <span><small>Beneficio/Pérdida</small><strong className={pnl !== null && pnl < 0 ? "text-negative" : "text-positive"}>{formatMoney(pnl, "Pendiente")}</strong></span>
        <span><small>ROI</small><strong className={roi !== null && roi < 0 ? "text-negative" : "text-positive"}>{formatPercentPoints(roi)}</strong></span>
        <span><small>Coste medio</small><strong>{formatMoneyPerCoin(averageCost, "Coste pendiente de completar")}</strong></span>
        <span><small>Variación 24 h</small><strong className={change !== null && change < 0 ? "text-negative" : "text-positive"}>{formatPercentPoints(change)}</strong></span>
        <span><small>Peso</small><strong>{weight === null ? "Pendiente" : `${weight.toLocaleString("es-ES", { maximumFractionDigits: 2 })}%`}</strong></span>
      </span>

      {(position.sparkline?.length ?? 0) > 0 && (
        <span className="position-card-spark">
          <Sparkline points={position.sparkline} positive={(change ?? 0) >= 0} />
        </span>
      )}
    </button>
  );
}

export function PositionList({
  positions,
  assets,
  onSelect,
  localCostByAsset = {},
  localCostPendingByAsset = {},
  portfolioState,
}: {
  positions: any[];
  assets: any[];
  onSelect: (assetId: string) => void;
  localCostByAsset?: Record<string, number>;
  localCostPendingByAsset?: Record<string, boolean>;
  portfolioState?: string;
}) {
  const allocated = positions.flatMap((position, index) => {
    const percent = formatAllocation(position.allocation);
    if (percent === null || percent <= 0) return [];
    return [{
      position,
      percent,
      color: position.assetColor || ALLOCATION_COLORS[index % ALLOCATION_COLORS.length],
    }];
  });

  return (
    <Card className="position-list-panel">
      <CardHeader>
        <CardTitle>Mis posiciones</CardTitle>
        <p className="panel-caption">Activos sincronizados desde Coinbase con métricas en tiempo real</p>
      </CardHeader>
      <CardContent>
        {allocated.length > 0 && (
          <div className="allocation-bar mis-posiciones-bar" aria-label="Distribución de cartera">
            {allocated.map(({ position, percent, color }) => {
              const style: AllocationStyle = {
                "--allocation-width": `${percent}%`,
                "--allocation-color": color,
              };
              return <span key={position.accountUuid || position.asset} style={style} title={`${position.asset} ${percent.toFixed(2)}%`} />;
            })}
          </div>
        )}
        <div className="position-card-grid">
          {positions.map((position) => {
            const asset = assets.find((item) => item.symbol === position.asset || item.id === position.asset);
            const name = position.market?.baseName || asset?.name || position.asset;
            const logoUrl = position.assetImageUrl || position.market?.iconUrl || asset?.logoUrl;
            const key = position.accountUuid || position.asset;

            return (
              <PositionCard
                key={key}
                position={position}
                name={name}
                logoUrl={logoUrl}
                onSelect={() => onSelect(position.asset)}
                localCostByAsset={localCostByAsset}
                localCostPendingByAsset={localCostPendingByAsset}
                portfolioState={portfolioState}
              />
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
