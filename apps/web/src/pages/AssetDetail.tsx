import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { Activity } from "lucide-react";
import { AssetDetailHeader } from "../components/AssetDetailHeader";
import { Card, CardContent, CardHeader, CardTitle } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { MarketChartPanel, MarketStats } from "../components/MarketPanels";
import { PageToolbar } from "../components/PageToolbar";
import type { ChartPoint } from "../components/MarketChart";
import type { Period } from "../components/PeriodSelector";
import { formatAllocation, formatCrypto, formatDateTime, formatMoney, formatPercent } from "../lib/format";

const PERIOD_MAP: Record<Period, "1h" | "24h" | "7d" | "30d" | "1y" | "all"> = {
  "1h": "1h",
  "24h": "24h",
  "1w": "7d",
  "1m": "30d",
  "1y": "1y",
  "all": "all",
};

function chartPoints(points: { time: number; value: number }[]): ChartPoint[] {
  return points.map((point) => ({
    time: point.time as import("lightweight-charts").Time,
    value: point.value,
  }));
}

function matchAsset(asset: any, id: string) {
  return asset.id === id || asset.symbol === id;
}

function changeFor(points: ChartPoint[]) {
  if (points.length < 2) return null;
  const first = points[0].value;
  const last = points[points.length - 1].value;
  return first > 0 ? ((last - first) / first) * 100 : null;
}

export function AssetDetail() {
  const { assetId } = useParams<{ assetId: string }>();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>("24h");

  const { data: assetsRes } = useQuery({
    queryKey: ["assets"],
    queryFn: () => window.cryptoControl.assets.list(),
  });

  const assets = useMemo(() => assetsRes?.ok ? assetsRes.data : [], [assetsRes]);
  const asset = assets.find((item: any) => assetId && matchAsset(item, assetId)) || {
    id: assetId,
    symbol: assetId,
    name: assetId,
    logoUrl: null,
  };
  const requestAssetId = asset?.id || assetId;

  const { data: statusRes } = useQuery({
    queryKey: ["coinbase", "status"],
    queryFn: () => window.cryptoControl.coinbase.getStatus(),
  });
  const connected = statusRes?.ok ? statusRes.data.connected : false;

  const { data: portfoliosRes } = useQuery({
    queryKey: ["coinbase", "portfolios"],
    queryFn: () => window.cryptoControl.coinbase.listPortfolios(),
    enabled: connected,
  });

  const selectedPortfolioId = (portfoliosRes?.ok ? portfoliosRes.data?.[0]?.uuid : null) ?? null;

  const { data: breakdownRes } = useQuery({
    queryKey: ["coinbase", "breakdown", selectedPortfolioId],
    queryFn: () => window.cryptoControl.coinbase.getPortfolioBreakdown(selectedPortfolioId!, "EUR"),
    enabled: !!selectedPortfolioId,
  });

  const { data: priceRes } = useQuery({
    queryKey: ["market", "price", requestAssetId],
    queryFn: () => window.cryptoControl.market.getCurrentPrice({ assetId: requestAssetId!, quoteCurrency: "EUR" }),
    enabled: !!requestAssetId,
  });

  const { data: overviewRes } = useQuery({
    queryKey: ["market", "overview", requestAssetId],
    queryFn: () => window.cryptoControl.market.getOverview({ assetId: requestAssetId!, quoteCurrency: "EUR" }),
    enabled: !!requestAssetId,
  });

  const { data: historyRes, isLoading: loadingHistory } = useQuery({
    queryKey: ["market", "history", requestAssetId, period],
    queryFn: () => window.cryptoControl.market.getHistoricalPrices({
      assetId: requestAssetId!,
      quoteCurrency: "EUR",
      period: PERIOD_MAP[period],
    }),
    enabled: !!requestAssetId,
  });

  const { data: txsRes } = useQuery({
    queryKey: ["transactions"],
    queryFn: () => window.cryptoControl.transactions.list(),
  });

  if (!assetId) {
    return <ErrorState message="No se ha especificado el activo." />;
  }

  const breakdown = breakdownRes?.ok ? breakdownRes.data : null;
  const position = breakdown?.positions?.find((item: any) => item.asset === asset.symbol || item.asset === asset.id || item.asset === assetId);
  const data = historyRes?.ok ? chartPoints(historyRes.data.points) : [];
  const overview = overviewRes?.ok ? overviewRes.data : null;
  const selectedPeriodChange = changeFor(data);
  const change = position?.market?.pricePercentageChange24h ?? overview?.change24h ?? (period === "24h" ? selectedPeriodChange : null);
  const price = position?.market?.price ?? overview?.price ?? (priceRes?.ok ? priceRes.data.price : null);
  const transactions = txsRes?.ok ? txsRes.data : [];
  const matchingTransactions = transactions
    .filter((tx) => tx.legs?.some((leg: any) => leg.assetId === asset.id || leg.assetId === asset.symbol || leg.assetId === assetId))
    .sort((a, b) => b.date - a.date);

  const operations = matchingTransactions.map((tx) => ({
    time: Math.floor(tx.date / 1000) as import("lightweight-charts").Time,
    type: tx.type === "sell" || tx.type === "transfer_out" ? "sell" : "buy",
    label: tx.type,
    color: tx.type === "sell" || tx.type === "transfer_out" ? "#ef4444" : "#16a34a",
  }));

  return (
    <section className="page-stack asset-detail-page">
      <PageToolbar title="Detalle de activo" meta="Vista interna de cartera y mercado" />
      <AssetDetailHeader
        asset={asset}
        logoUrl={position?.assetImageUrl || position?.market?.iconUrl || asset.logoUrl}
        price={price}
        change={change}
        onBack={() => navigate(-1)}
      />

      <div className="asset-detail-grid">
        <Card className="asset-position-panel">
          <CardHeader>
            <CardTitle>Posición</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="stats-list">
              <div><dt>Cantidad</dt><dd>{formatCrypto(position?.totalBalanceCrypto)}</dd></div>
              <div><dt>Valor actual</dt><dd>{formatMoney(position?.totalBalanceFiat)}</dd></div>
              <div><dt>Precio</dt><dd>{formatMoney(price, "No disponible")}</dd></div>
              <div><dt>Mercado 24 h</dt><dd className={change && change < 0 ? "text-negative" : "text-positive"}>{formatPercent(change, "No disponible")}</dd></div>
              <div><dt>Coste medio</dt><dd>{formatMoney(position?.averageEntryPrice?.value)}</dd></div>
              <div><dt>Base de coste</dt><dd>{formatMoney(position?.costBasis?.value)}</dd></div>
              <div><dt>PnL no realizado</dt><dd className={position?.unrealizedPnl < 0 ? "text-negative" : "text-positive"}>{formatMoney(position?.unrealizedPnl)}</dd></div>
              <div><dt>Peso</dt><dd>{position?.allocation === null || position?.allocation === undefined ? "No disponible en Coinbase" : `${formatAllocation(position.allocation)?.toFixed(2)}%`}</dd></div>
            </dl>
          </CardContent>
        </Card>

        <Card className="asset-availability-panel">
          <CardHeader>
            <CardTitle>Disponibilidad</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="stats-list">
              <div><dt>Para operar</dt><dd>{formatCrypto(position?.availableToTradeCrypto)}</dd></div>
              <div><dt>Para operar EUR</dt><dd>{formatMoney(position?.availableToTradeFiat)}</dd></div>
              <div><dt>Para transferir</dt><dd>{formatCrypto(position?.availableToTransferCrypto)}</dd></div>
              <div><dt>Transferible EUR</dt><dd>{formatMoney(position?.availableToTransferFiat)}</dd></div>
              <div><dt>Para enviar</dt><dd>{formatCrypto(position?.availableToSendCrypto)}</dd></div>
              <div><dt>Enviable EUR</dt><dd>{formatMoney(position?.availableToSendFiat)}</dd></div>
              <div><dt>Estado Coinbase</dt><dd>{breakdown?.state || "No disponible"}</dd></div>
              <div><dt>Fuente de datos</dt><dd>{breakdown?.source || "Mercado local"}</dd></div>
              <div><dt>Última actualización</dt><dd>{formatDateTime(breakdown?.capturedAt ?? (priceRes?.ok ? priceRes.data.fetchedAt : null))}</dd></div>
            </dl>
          </CardContent>
        </Card>
      </div>

      <MarketChartPanel
        data={data}
        period={period}
        onPeriodChange={setPeriod}
        loading={loadingHistory}
        error={historyRes && !historyRes.ok ? historyRes.error.message : undefined}
        operations={operations}
      />

      <div className="asset-detail-grid">
        <MarketStats
          price={price}
          periodChangeValue={selectedPeriodChange}
          change24h={change}
          high24h={overview?.high24h}
          low24h={overview?.low24h}
          volume24h={overview?.volume24h}
          marketCap={overview?.marketCap}
          dominance={overview?.dominance}
          points={data}
        />

        <Card>
          <CardHeader>
            <CardTitle>Historial y marcadores</CardTitle>
          </CardHeader>
          <CardContent>
            {matchingTransactions.length === 0 ? (
              <EmptyState icon={<Activity size={36} />} title="Sin historial interno" description="No hay operaciones locales registradas para este activo." />
            ) : (
              <div className="activity-list">
                {matchingTransactions.slice(0, 8).map((tx) => (
                  <div className="activity-item" key={tx.id}>
                    <span>
                      <strong>{tx.type}</strong>
                      <small>{formatDateTime(tx.date)}</small>
                    </span>
                    <em>{tx.legs.find((leg: any) => leg.assetId === asset.id || leg.assetId === asset.symbol || leg.assetId === assetId)?.amount}</em>
                  </div>
                ))}
              </div>
            )}
            <p className="panel-caption">{operations.length} marcadores internos disponibles para la gráfica.</p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
