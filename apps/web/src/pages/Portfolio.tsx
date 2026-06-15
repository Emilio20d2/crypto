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
  AllocationPanel,
  DataStatus,
  PortfolioChart,
  PortfolioMetrics,
  PositionList,
} from "../components/PortfolioPanels";
import type { ChartPoint } from "../components/MarketChart";
import type { Period } from "../components/PeriodSelector";
import { formatDateTime } from "../lib/format";

const PERIOD_WINDOW_MS: Record<Period, number | null> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
  "1m": 30 * 24 * 60 * 60 * 1000,
  "1y": 365 * 24 * 60 * 60 * 1000,
  "all": null,
};

// Fallback: snapshot-based chart (Coinbase portfolio snapshots from since app installed)
function snapshotChartData(snapshots: any[], period: Period): ChartPoint[] {
  const windowMs = PERIOD_WINDOW_MS[period];
  const now = Date.now();

  return snapshots
    .filter((snapshot) => {
      if (!windowMs) return true;
      return now - snapshot.capturedAt <= windowMs;
    })
    .map((snapshot) => ({
      time: Math.floor(snapshot.capturedAt / 1000) as import("lightweight-charts").Time,
      value: snapshot.totalBalance,
    }))
    .filter((point) => Number.isFinite(point.value) && point.value > 0)
    .sort((a, b) => (a.time as number) - (b.time as number));
}

function portfolio24hVariation(positions: any[]) {
  let currentTotal = 0;
  let previousTotal = 0;

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

function fallbackTotalBalance(balances: any) {
  const total = balances?.totalBalance?.value;
  if (typeof total === "number" && Number.isFinite(total)) return total;
  const crypto = balances?.totalCryptoBalance?.value;
  const cash = balances?.totalCashEquivalentBalance?.value;
  const values = [crypto, cash].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
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

function coinbasePositionPnl(position: any) {
  const pnl = typeof position.unrealizedPnl === "number" && Number.isFinite(position.unrealizedPnl)
    ? position.unrealizedPnl
    : null;
  if (pnl !== null) return pnl;

  const cost = position.costBasis?.value;
  const value = position.totalBalanceFiat;
  return typeof cost === "number" && Number.isFinite(cost) && typeof value === "number" && Number.isFinite(value)
    ? value - cost
    : null;
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
    refetchInterval: 60_000,
  });

  const { data: snapshotsRes } = useQuery({
    queryKey: ["coinbase", "snapshots", selectedPortfolioId],
    queryFn: () => window.cryptoControl.coinbase.getPortfolioSnapshots(selectedPortfolioId!),
    enabled: !!selectedPortfolioId,
    refetchInterval: 60_000,
  });

  const { data: assetsRes } = useQuery({
    queryKey: ["assets"],
    queryFn: () => window.cryptoControl.assets.list(),
  });

  const { data: localPositionsRes } = useQuery({
    queryKey: ["portfolio", "positions"],
    queryFn: () => window.cryptoControl.portfolio.getPositions(),
  });

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    const syncInBackground = async () => {
      if (backgroundSyncRunning.current) return;
      backgroundSyncRunning.current = true;
      const result = await window.cryptoControl.coinbase.sync();
      if (!cancelled && result.ok) {
        await queryClient.invalidateQueries({ queryKey: ["coinbase"] });
        await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      }
      backgroundSyncRunning.current = false;
    };

    void syncInBackground();
    const intervalId = window.setInterval(() => void syncInBackground(), 5 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [connected, queryClient]);

  const snapshots = useMemo(() => (snapshotsRes?.ok ? snapshotsRes.data : []), [snapshotsRes]);
  const chartData = useMemo((): ChartPoint[] => {
    return snapshotChartData(snapshots, period);
  }, [snapshots, period]);

  const localPositionMap = useMemo((): Record<string, number> => {
    const rawPositions = localPositionsRes?.ok ? (localPositionsRes.data as any)?.positions : null;
    if (!rawPositions) return {};
    const map: Record<string, number> = {};
    for (const [assetId, pos] of Object.entries(rawPositions)) {
      const invested = (pos as any).totalInvestedEur;
      if (typeof invested === "number" && invested > 0) map[assetId] = invested;
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

  const positions = Array.isArray(breakdown.positions)
    ? aggregatePositionsByAsset(breakdown.positions)
      .filter(hasPositivePositionBalance)
      .filter((position) => position.asset !== "EURC" && !position.isCash)
      .sort((a, b) => (b.totalBalanceFiat ?? -1) - (a.totalBalanceFiat ?? -1))
    : [];

  const pnlValues = positions
    .map(coinbasePositionPnl)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  let totalInvestedSum = 0;
  let totalInvestedHasAny = false;
  for (const position of positions) {
    const coinbaseCost = position.costBasis?.value;
    if (typeof coinbaseCost === "number" && Number.isFinite(coinbaseCost) && coinbaseCost > 0) {
      totalInvestedSum += coinbaseCost;
      totalInvestedHasAny = true;
    } else {
      const localCost = localPositionMap[position.asset];
      if (typeof localCost === "number" && localCost > 0) {
        totalInvestedSum += localCost;
        totalInvestedHasAny = true;
      }
    }
  }
  const totalInvested = totalInvestedHasAny ? totalInvestedSum : null;

  const performance = pnlValues.length > 0 ? pnlValues.reduce((sum, value) => sum + value, 0) : null;
  const totalBalance = fallbackTotalBalance(breakdown.balances) ?? positionsTotalBalance(positions);
  const variationFromPositions = portfolio24hVariation(positions);
  const chart24h = snapshotChartData(snapshots, "24h");
  const variationFromChart = chartVariation(chart24h);
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

      <div className="portfolio-layout-grid">
        <PortfolioChart data={chartData} period={period} onPeriodChange={setPeriod} />
        <AllocationPanel positions={positions} />
      </div>

      <PositionList positions={positions} assets={assets} onSelect={(assetId) => navigate(`/activo/${assetId}`)} />
    </section>
  );
}
