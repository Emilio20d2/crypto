import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { Card, CardContent } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { PageToolbar } from "../components/PageToolbar";
import {
  DataStatus,
  PortfolioChart,
  PortfolioMetrics,
  PositionList,
} from "../components/PortfolioPanels";
import type { ChartPoint } from "../components/MarketChart";
import type { Period } from "../components/PeriodSelector";
import { formatDateTime } from "../lib/format";

const PRICE_REFRESH_MS = 5_000;
const COINBASE_SYNC_REFRESH_MS = 30_000;
const PORTFOLIO_CHART_REFRESH_MS = 5_000;
const PORTFOLIO_LONG_CHART_REFRESH_MS = 60_000;

function chartRefreshMs(period: Period) {
  return period === "1h" || period === "24h" ? PORTFOLIO_CHART_REFRESH_MS : PORTFOLIO_LONG_CHART_REFRESH_MS;
}

// The backend (portfolio:get-historical-series, given a period) already
// returns the exact grid for that period — same granularity Mercado's own
// candles use, generated from "now" backwards, with explicit zeros before
// the cartera's first ever transaction. This just shapes those points for
// the chart component.
function toChartPoints(points: { time: number; value: number }[]): ChartPoint[] {
  return points
    .filter((point) => Number.isFinite(point.value) && point.value >= 0)
    .map((point) => ({ time: point.time as import("lightweight-charts").Time, value: point.value }))
    .sort((a, b) => (a.time as number) - (b.time as number));
}

// eurcFiatStable: EURC reserve in EUR — added symmetrically to current and
// previous so it dilutes the crypto % without adding spurious gain or loss.
function portfolio24hVariation(positions: any[], eurcFiatStable: number = 0) {
  let currentTotal = eurcFiatStable;
  let previousTotal = eurcFiatStable;

  for (const position of positions) {
    const current = position.totalBalanceFiat;
    const change = position.market?.pricePercentageChange24h;
    if (typeof current !== "number" || !Number.isFinite(current) || current <= 0) continue;
    if (typeof change !== "number" || !Number.isFinite(change)) continue;
    const previous = current / (1 + change / 100);
    if (!Number.isFinite(previous) || previous <= 0) continue;
    currentTotal += current;
    previousTotal += previous;
  }

  if (currentTotal <= 0 || previousTotal <= 0) return { value: null, percent: null };
  const value = currentTotal - previousTotal;
  return { value, percent: (value / previousTotal) * 100 };
}


function positionsTotalBalance(positions: any[]) {
  const values = positions
    .map((position) => position.totalBalanceFiat)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
}

function chartVariation(points: ChartPoint[]) {
  if (points.length < 2) return { value: null, percent: null };
  const first = points[0].value;
  const last = points[points.length - 1].value;
  if (!Number.isFinite(first) || !Number.isFinite(last) || first <= 0) return { value: null, percent: null };
  const value = last - first;
  return { value, percent: (value / first) * 100 };
}

function sumNumber(a: unknown, b: unknown) {
  const left = typeof a === "number" && Number.isFinite(a) ? a : 0;
  const right = typeof b === "number" && Number.isFinite(b) ? b : 0;
  return left + right;
}

function aggregatePositionsByAsset(positions: any[]) {
  const grouped = new Map<string, any>();

  for (const position of positions) {
    const key = position.asset;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        ...position,
        accountUuid: position.asset,
        costBasis: position.costBasis ? { ...position.costBasis } : null,
      });
      continue;
    }

    existing.totalBalanceFiat = sumNumber(existing.totalBalanceFiat, position.totalBalanceFiat);
    existing.totalBalanceCrypto = sumNumber(existing.totalBalanceCrypto, position.totalBalanceCrypto);
    existing.allocation = sumNumber(existing.allocation, position.allocation);
    existing.unrealizedPnl = sumNumber(existing.unrealizedPnl, position.unrealizedPnl);
    existing.fundingPnl = sumNumber(existing.fundingPnl, position.fundingPnl);
    existing.availableToTradeFiat = sumNumber(existing.availableToTradeFiat, position.availableToTradeFiat);
    existing.availableToTradeCrypto = sumNumber(existing.availableToTradeCrypto, position.availableToTradeCrypto);
    existing.availableToTransferFiat = sumNumber(existing.availableToTransferFiat, position.availableToTransferFiat);
    existing.availableToTransferCrypto = sumNumber(existing.availableToTransferCrypto, position.availableToTransferCrypto);
    existing.availableToSendFiat = sumNumber(existing.availableToSendFiat, position.availableToSendFiat);
    existing.availableToSendCrypto = sumNumber(existing.availableToSendCrypto, position.availableToSendCrypto);

    const currentCost = existing.costBasis?.value;
    const nextCost = position.costBasis?.value;
    if (typeof currentCost === "number" || typeof nextCost === "number") {
      existing.costBasis = {
        value: sumNumber(currentCost, nextCost),
        currency: existing.costBasis?.currency || position.costBasis?.currency || "EUR",
      };
    }

    existing.market = existing.market?.price ? existing.market : position.market || existing.market;
    existing.sparkline = existing.sparkline?.length ? existing.sparkline : position.sparkline || [];
    existing.assetImageUrl = existing.assetImageUrl || position.assetImageUrl;
    existing.assetColor = existing.assetColor || position.assetColor;
  }

  return Array.from(grouped.values()).map((position) => {
    const cost = position.costBasis?.value;
    const amount = position.totalBalanceCrypto;
    if (typeof cost === "number" && Number.isFinite(cost) && typeof amount === "number" && Number.isFinite(amount) && amount > 0) {
      position.averageEntryPrice = { value: cost / amount, currency: position.costBasis?.currency || "EUR" };
    }
    return position;
  });
}

function hasPositivePositionBalance(position: any) {
  const crypto = typeof position.totalBalanceCrypto === "number" && Number.isFinite(position.totalBalanceCrypto) ? position.totalBalanceCrypto : 0;
  const fiat = typeof position.totalBalanceFiat === "number" && Number.isFinite(position.totalBalanceFiat) ? position.totalBalanceFiat : 0;
  return crypto > 1e-12 || fiat > 0.005;
}

export function Portfolio() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const backgroundSyncRunning = useRef(false);
  const [manualPortfolioId, setManualPortfolioId] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("24h");

  const { data: statusRes, isLoading: loadingStatus } = useQuery({
    queryKey: ["coinbase", "status"],
    queryFn: () => window.cryptoControl.coinbase.getStatus(),
    refetchInterval: 60_000,
  });

  const connected = statusRes?.ok ? statusRes.data.connected : false;

  const { data: portfoliosRes, isLoading: loadingPortfolios } = useQuery({
    queryKey: ["coinbase", "portfolios"],
    queryFn: () => window.cryptoControl.coinbase.listPortfolios(),
    enabled: connected,
    refetchInterval: 5 * 60_000,
  });

  const portfolioOptions = portfoliosRes?.ok ? portfoliosRes.data : [];
  const selectedPortfolioId = manualPortfolioId ?? portfolioOptions[0]?.uuid ?? null;

  const { data: breakdownRes, isLoading: loadingBreakdown } = useQuery({
    queryKey: ["coinbase", "breakdown", selectedPortfolioId],
    queryFn: () => window.cryptoControl.coinbase.getPortfolioBreakdown(selectedPortfolioId!, "EUR"),
    enabled: !!selectedPortfolioId,
    staleTime: 15_000,
    refetchInterval: PRICE_REFRESH_MS,
    refetchIntervalInBackground: true,
    refetchOnMount: "always",
  });

  // Real reconstruction: historical qty (from transactionLegs) × historical
  // price (from priceHistory/candle cache) per asset, summed per timestamp —
  // not Coinbase's sparse point-in-time snapshots, which only exist for
  // moments the app happened to be open and online.
  const { data: historicalSeriesRes } = useQuery({
    queryKey: ["portfolio", "historical-series", period],
    queryFn: () => window.cryptoControl.portfolio.getHistoricalSeries({ period }),
    staleTime: 15_000,
    refetchInterval: chartRefreshMs(period),
    refetchIntervalInBackground: true,
    refetchOnMount: "always",
  });

  // Independent of the chart's selected period — always 24h, for the
  // "Variación 24h" metric above the chart.
  const { data: historicalSeries24hRes } = useQuery({
    queryKey: ["portfolio", "historical-series", "24h"],
    queryFn: () => window.cryptoControl.portfolio.getHistoricalSeries({ period: "24h" }),
    staleTime: 15_000,
    refetchInterval: PORTFOLIO_CHART_REFRESH_MS,
    refetchIntervalInBackground: true,
    refetchOnMount: "always",
  });

  const { data: assetsRes } = useQuery({
    queryKey: ["assets"],
    queryFn: () => window.cryptoControl.assets.list(),
  });

  const { data: localPositionsRes } = useQuery({
    queryKey: ["portfolio", "positions"],
    queryFn: () => window.cryptoControl.portfolio.getPositions(),
    staleTime: 15_000,
    refetchInterval: PRICE_REFRESH_MS,
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    const syncInBackground = async () => {
      if (backgroundSyncRunning.current) return;
      backgroundSyncRunning.current = true;
      try {
        const result = await window.cryptoControl.coinbase.sync();
        if (!cancelled && result.ok) {
          await queryClient.invalidateQueries({ queryKey: ["coinbase"] });
          await queryClient.invalidateQueries({ queryKey: ["transactions"] });
          await queryClient.invalidateQueries({ queryKey: ["portfolio"] });
          await queryClient.invalidateQueries({ queryKey: ["market"] });
          await queryClient.invalidateQueries({ queryKey: ["assets"] });
        }
      } finally {
        backgroundSyncRunning.current = false;
      }
    };

    void syncInBackground();
    const intervalId = window.setInterval(() => void syncInBackground(), COINBASE_SYNC_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [connected, queryClient]);

  // The backend already generates the exact grid for `period` (same
  // granularity Mercado uses, zero-padded before the first transaction) —
  // no client-side windowing/downsampling needed, just shape it for the chart.
  const reconstructedSeries = useMemo(
    () => (historicalSeriesRes?.ok ? historicalSeriesRes.data.points : []),
    [historicalSeriesRes]
  );
  const series24h = useMemo(
    () => (historicalSeries24hRes?.ok ? historicalSeries24hRes.data.points : []),
    [historicalSeries24hRes]
  );
  const chartData = useMemo((): ChartPoint[] => {
    const reconstructed = toChartPoints(reconstructedSeries);
    if (reconstructed.length < 2) return [];

    // Only pin the live value for short periods (1h, 24h) where the series
    // refreshes every 5s and the live point is genuinely contemporaneous.
    // For longer periods (1w, 1m, 1y, all) the last historical point may be
    // hours or days old: appending a live value from a different time creates
    // an artificial spike/drop at the right edge of the chart.
    if (period !== "1h" && period !== "24h") return reconstructed;

    const liveBreakdown = breakdownRes?.ok && breakdownRes.data.state === "live" ? breakdownRes.data : null;
    if (liveBreakdown) {
      const liveValue = liveBreakdown.positions.reduce(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (sum: number, p: any) => {
          if (typeof p.totalBalanceFiat !== "number" || !Number.isFinite(p.totalBalanceFiat)) return sum;
          if (p.isCash && p.asset !== "EURC") return sum; // exclude EUR fiat, keep EURC
          return sum + p.totalBalanceFiat;
        },
        0,
      );
      if (liveValue > 0) {
        const nowSeconds = Math.floor(Date.now() / 1000) as import("lightweight-charts").Time;
        const last = reconstructed[reconstructed.length - 1];
        if ((nowSeconds as number) > (last.time as number)) {
          return [...reconstructed, { time: nowSeconds, value: liveValue }];
        }
      }
    }
    return reconstructed;
  }, [reconstructedSeries, breakdownRes, period]);

  const localPositionMap = useMemo((): Record<string, number> => {
    const rawPositions = localPositionsRes?.ok ? (localPositionsRes.data as any)?.positions : null;
    if (!rawPositions) return {};
    const map: Record<string, number> = {};
    for (const [assetId, pos] of Object.entries(rawPositions)) {
      if ((pos as any).hasPendingValuation) continue;
      const invested = (pos as any).totalInvestedEur;
      if (typeof invested === "number" && invested > 0) map[assetId] = invested;
    }
    return map;
  }, [localPositionsRes]);

  const localCostPendingByAsset = useMemo((): Record<string, boolean> => {
    const rawPositions = localPositionsRes?.ok ? (localPositionsRes.data as any)?.positions : null;
    if (!rawPositions) return {};
    const map: Record<string, boolean> = {};
    for (const [assetId, pos] of Object.entries(rawPositions)) {
      map[assetId] = Boolean((pos as any).hasPendingValuation);
    }
    return map;
  }, [localPositionsRes]);

  if (loadingStatus || (connected && loadingPortfolios) || (selectedPortfolioId && loadingBreakdown)) {
    return (
      <section className="page-stack">
        <PageToolbar title="Cartera" meta="Preparando datos de Coinbase" />
        <LoadingState message="Cargando cartera..." />
      </section>
    );
  }

  if (!connected) {
    return (
      <section className="page-stack">
        <PageToolbar title="Cartera" meta="Coinbase no conectado" />
        <Card>
          <CardContent>
            <EmptyState
              icon={<Wallet size={44} />}
              title="Coinbase no conectado"
              description="Conecta Coinbase para ver saldos, asignación, histórico y posiciones internas."
            />
            <div className="center-actions">
              <Button type="button" onClick={() => navigate("/configuracion/coinbase")}>Configurar Coinbase</Button>
            </div>
          </CardContent>
        </Card>
      </section>
    );
  }

  if (breakdownRes && !breakdownRes.ok) {
    return (
      <section className="page-stack">
        <PageToolbar title="Cartera" meta="Error de Coinbase" />
        <Card>
          <CardContent>
            <ErrorState message={breakdownRes.error.message} />
          </CardContent>
        </Card>
      </section>
    );
  }

  const breakdown = breakdownRes?.ok ? breakdownRes.data : null;
  const assets = assetsRes?.ok ? assetsRes.data : [];

  if (!breakdown?.balances) {
    return (
      <section className="page-stack">
        <PageToolbar title="Cartera" meta="Sin portfolio activo" />
        <Card>
          <CardContent>
            <EmptyState
              icon={<Wallet size={44} />}
              title="Sin datos de cartera"
              description="Coinbase no ha devuelto todavía un desglose de portfolio para mostrar."
            />
          </CardContent>
        </Card>
      </section>
    );
  }

  // Aggregate all positions, then split: EURC as reserve, rest as investment cards.
  const allAggregated = Array.isArray(breakdown.positions)
    ? aggregatePositionsByAsset(breakdown.positions).filter(hasPositivePositionBalance)
    : [];

  // EURC reserve: stablecoin held as fiscal/rebuy liquidity.
  const eurcPosition = allAggregated.find((p) => p.asset === "EURC");
  const eurcTotalFiat: number =
    typeof eurcPosition?.totalBalanceFiat === "number" && Number.isFinite(eurcPosition.totalBalanceFiat)
      ? eurcPosition.totalBalanceFiat
      : 0;

  // Investment positions: crypto only (no EURC, no EUR fiat).
  const positions = allAggregated
    .filter((position) => position.asset !== "EURC" && !position.isCash)
    .sort((a, b) => (b.totalBalanceFiat ?? -1) - (a.totalBalanceFiat ?? -1));

  let totalInvestedSum = 0;
  let totalInvestedComplete = positions.length > 0;
  for (const position of positions) {
    const localCost = localPositionMap[position.asset];
    if (typeof localCost === "number" && Number.isFinite(localCost) && localCost > 0 && !localCostPendingByAsset[position.asset]) {
      totalInvestedSum += localCost;
    } else {
      totalInvestedComplete = false;
    }
  }

  const totalInvested = totalInvestedComplete ? totalInvestedSum : null;

  // Crypto value (investment positions only) — used for P&L.
  const cryptoTotal = positionsTotalBalance(positions);

  // Total patrimonial = cripto + EURC. Same definition used by live chart pin
  // and historical series. EUR fiat excluded per spec.
  const totalBalance = cryptoTotal !== null || eurcTotalFiat > 0
    ? (cryptoTotal ?? 0) + eurcTotalFiat
    : null;

  // P&L is crypto-only: EURC is a stablecoin reserve, not a speculative asset.
  const performance = totalInvested !== null && cryptoTotal !== null ? cryptoTotal - totalInvested : null;
  const variationFromPositions = portfolio24hVariation(positions, eurcTotalFiat);
  const reconstructed24h = toChartPoints(series24h);
  const variationFromChart = chartVariation(reconstructed24h);
  const variation24h = variationFromPositions.value !== null ? variationFromPositions : variationFromChart;
  return (
    <section className="page-stack portfolio-page">
      <PageToolbar
        title="Cartera"
        eyebrow="Portfolio activo"
        meta={
          <span className="toolbar-status">
            <DataStatus state={breakdown.state === "unavailable" ? "unavailable" : "live"} reason={breakdown.reason} />
            <span>Actualizado {formatDateTime(breakdown.capturedAt)}</span>
          </span>
        }
      />

      <PortfolioMetrics
        totalBalance={totalBalance}
        cryptoTotalEur={cryptoTotal}
        eurcTotalEur={eurcTotalFiat > 0 ? eurcTotalFiat : null}
        totalInvested={totalInvested}
        performance={performance}
        variation24h={variation24h.value}
        variation24hPercent={variation24h.percent}
        positionsCount={positions.length}
      />

      {portfolioOptions.length > 1 && (
        <Card>
          <CardContent className="portfolio-selector-row">
            <label htmlFor="portfolio-selector">Portfolio</label>
            <select id="portfolio-selector" className="ui-select" value={selectedPortfolioId || ""} onChange={(event) => setManualPortfolioId(event.target.value)}>
              {portfolioOptions.map((portfolio: any) => (
                <option key={portfolio.uuid} value={portfolio.uuid}>{portfolio.name}</option>
              ))}
            </select>
          </CardContent>
        </Card>
      )}

      <PortfolioChart data={chartData} period={period} onPeriodChange={setPeriod} />

      <PositionList
        positions={positions}
        assets={assets}
        onSelect={(assetId) => navigate(`/activo/${assetId}`)}
        localCostByAsset={localPositionMap}
        localCostPendingByAsset={localCostPendingByAsset}
        portfolioState={breakdown.state}
      />
    </section>
  );
}
