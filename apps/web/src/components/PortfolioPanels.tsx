import type { CSSProperties } from "react";
import { CircleAlert, Database, ShieldCheck, TrendingUp, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./Card";
import { LocalAssetLogo } from "./LocalAssetLogo";
import { MarketChart, type ChartPoint } from "./MarketChart";
import { PeriodSelector, type Period } from "./PeriodSelector";
import { Sparkline } from "./Sparkline";
import { formatAllocation, formatCrypto, formatMoney } from "../lib/format";

type AllocationStyle = CSSProperties & {
  "--allocation-width"?: string;
  "--allocation-color"?: string;
};

const ALLOCATION_COLORS = ["#327cff", "#25bfe8", "#5ae37a", "#111827", "#64748b", "#0f766e", "#9333ea", "#e11d48"];

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positionInvested(position: any) {
  return finiteNumber(position.costBasis?.value);
}

function positionPnL(position: any) {
  const coinbasePnl = finiteNumber(position.unrealizedPnl);
  if (coinbasePnl !== null) return coinbasePnl;

  const invested = positionInvested(position);
  const value = finiteNumber(position.totalBalanceFiat);
  if (invested !== null && value !== null) return value - invested;
  return null;
}

function positionRoi(position: any) {
  const invested = positionInvested(position);
  const pnl = positionPnL(position);
  return invested !== null && invested > 0 && pnl !== null ? (pnl / invested) * 100 : null;
}

function positionAverageCost(position: any) {
  const coinbaseAverage = finiteNumber(position.averageEntryPrice?.value);
  if (coinbaseAverage !== null) return coinbaseAverage;

  const invested = positionInvested(position);
  const quantity = finiteNumber(position.totalBalanceCrypto);
  return invested !== null && quantity !== null && quantity > 0 ? invested / quantity : null;
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
  totalInvested,
  performance,
  variation24h,
  variation24hPercent,
  positionsCount,
}: {
  totalBalance?: number | null;
  totalInvested?: number | null;
  performance?: number | null;
  variation24h?: number | null;
  variation24hPercent?: number | null;
  positionsCount: number;
}) {
  const variationLabel =
    variation24h !== null && variation24h !== undefined
      ? `${formatMoney(variation24h, "0,00 €")} · ${formatPercentPoints(variation24hPercent, "0,00%")}`
      : "En cálculo";
  const metrics = [
    { label: "Valor total", value: formatMoney(totalBalance, "En cálculo"), icon: Wallet },
    { label: "Beneficio / Pérdida", value: formatMoney(performance, "En cálculo"), tone: performance && performance < 0 ? "negative" : "positive", icon: TrendingUp },
    {
      label: "Variación 24 h",
      value: variationLabel,
      tone: variation24h && variation24h < 0 ? "negative" : "positive",
      icon: TrendingUp,
    },
    { label: "Total invertido", value: formatMoney(totalInvested, "En cálculo"), icon: Database },
    { label: "Activos", value: positionsCount.toLocaleString("es-ES"), icon: ShieldCheck },
  ];

  return (
    <section className="portfolio-metrics" aria-label="Resumen patrimonial">
      {metrics.map(({ label, value, tone, icon: Icon }) => (
        <div className="portfolio-metric" key={label}>
          <Icon size={15} />
          <span>{label}</span>
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
          <p className="panel-caption">Instantáneas reales capturadas desde Coinbase</p>
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

export function AllocationPanel({ positions }: { positions: any[] }) {
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
    <Card className="allocation-panel">
      <CardHeader className="stacked-card-header">
        <CardTitle>Distribución</CardTitle>
        <p className="panel-caption">Asignación informada por Coinbase</p>
      </CardHeader>
      <CardContent>
        {allocated.length === 0 ? (
          <p className="empty-inline">No disponible en Coinbase</p>
        ) : (
          <>
            <div className="allocation-bar" aria-label="Distribución de cartera">
              {allocated.map(({ position, percent, color }) => {
                const style: AllocationStyle = {
                  "--allocation-width": `${percent}%`,
                  "--allocation-color": color,
                };
                return <span key={position.accountUuid || position.asset} style={style} title={`${position.asset} ${percent.toFixed(2)}%`} />;
              })}
            </div>
            <div className="allocation-list">
              {allocated.slice(0, 8).map(({ position, percent, color }) => {
                const style: AllocationStyle = { "--allocation-color": color };
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
                    <strong className={position.unrealizedPnl && position.unrealizedPnl < 0 ? "allocation-pnl text-negative" : "allocation-pnl text-positive"}>
                      {formatMoney(position.unrealizedPnl, "PnL pendiente")}
                    </strong>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PositionCard({ position, name, logoUrl, onSelect }: { position: any; name: string; logoUrl?: string | null; onSelect: () => void }) {
  const invested = positionInvested(position);
  const pnl = positionPnL(position);
  const roi = positionRoi(position);
  const averageCost = positionAverageCost(position);
  const weight = formatAllocation(position.allocation);
  const change = finiteNumber(position.market?.pricePercentageChange24h);

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
        <span><small>Invertido</small><strong>{formatMoney(invested, "Pendiente")}</strong></span>
        <span><small>Beneficio/Pérdida</small><strong className={pnl !== null && pnl < 0 ? "text-negative" : "text-positive"}>{formatMoney(pnl, "Pendiente")}</strong></span>
        <span><small>ROI</small><strong className={roi !== null && roi < 0 ? "text-negative" : "text-positive"}>{formatPercentPoints(roi)}</strong></span>
        <span><small>Coste medio</small><strong>{formatMoneyPerCoin(averageCost)}</strong></span>
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
}: {
  positions: any[];
  assets: any[];
  onSelect: (assetId: string) => void;
}) {
  return (
    <Card className="position-list-panel">
      <CardHeader>
        <CardTitle>Posiciones</CardTitle>
        <p className="panel-caption">Tarjetas por activo con datos reales sincronizados desde Coinbase</p>
      </CardHeader>
      <CardContent>
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
              />
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
