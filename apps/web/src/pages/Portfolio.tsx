import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { calculateLiveTotalAssetValue, type LivePortfolioValueSnapshot } from "../lib/live-snapshot";

// Snapshot ligero en vivo: cuentas + balances + precios cada 5 s
const LIVE_COINBASE_REFRESH_MS = 5_000;
// Breakdown completo (sparklines + metadatos de mercado) cada 30 s
const BREAKDOWN_REFRESH_MS = 30_000;
// Auto-sync completo de Coinbase cada 5 min — operación pesada (histórico + FIFO)
const COINBASE_SYNC_REFRESH_MS = 5 * 60_000;
const COINBASE_SYNC_INITIAL_DELAY_MS = 8_000;
// Series históricas: 60 s para periodos cortos, 120 s para largos
const CHART_SHORT_STALE_MS = 60_000;
const CHART_LONG_STALE_MS = 120_000;

function chartRefreshMs(period: Period) {
  return period === "1h" || period === "24h" ? CHART_SHORT_STALE_MS : CHART_LONG_STALE_MS;
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
  const liveSnapshotRunning = useRef(false);
  const prevSnapshotVersionRef = useRef<string | null>(null);
  const [manualPortfolioId, setManualPortfolioId] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("24h");
  const [liveUpdateMs, setLiveUpdateMs] = useState<number | null>(null);
  const [secondsAgo, setSecondsAgo] = useState<number | null>(null);

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

  // Breakdown completo: posiciones, sparklines, coste base. Cada 30 s.
  const { data: breakdownRes, isLoading: loadingBreakdown, isFetching: fetchingBreakdown } = useQuery({
    queryKey: ["coinbase", "breakdown", selectedPortfolioId],
    queryFn: () => window.cryptoControl.coinbase.getPortfolioBreakdown(selectedPortfolioId!, "EUR"),
    enabled: !!selectedPortfolioId,
    staleTime: 20_000,
    refetchInterval: BREAKDOWN_REFRESH_MS,
    refetchIntervalInBackground: true,
  });

  const breakdown = breakdownRes?.ok ? breakdownRes.data : null;

  // Snapshot ligero de precios: solo precio + valor calculado. Cada 5 s.
  // Solo activo cuando ya tenemos el breakdown base (necesitamos las cantidades).
  // Guard de solapamiento: si la petición anterior sigue activa, se descarta.
  const { data: liveSnapshotRes } = useQuery({
    queryKey: ["portfolio", "live-snapshot", selectedPortfolioId],
    queryFn: async () => {
      if (liveSnapshotRunning.current) return undefined;
      liveSnapshotRunning.current = true;
      try {
        return await window.cryptoControl.portfolio.getLiveSnapshot(selectedPortfolioId!);
      } finally {
        liveSnapshotRunning.current = false;
      }
    },
    enabled: !!selectedPortfolioId,
    staleTime: 4_000,
    refetchInterval: LIVE_COINBASE_REFRESH_MS,
    refetchIntervalInBackground: true,
  });

  // Real reconstruction: historical qty (from transactionLegs) × historical
  // price (from priceHistory/candle cache) per asset, summed per timestamp.
  // No refetch en background: la serie histórica es pesada y el último punto
  // viene del liveSnapshot, no de una reconstrucción completa.
  const { data: historicalSeriesRes } = useQuery({
    queryKey: ["portfolio", "historical-series", period],
    queryFn: () => window.cryptoControl.portfolio.getHistoricalSeries({ period }),
    staleTime: CHART_SHORT_STALE_MS,
    refetchInterval: chartRefreshMs(period),
    refetchIntervalInBackground: false,
  });

  // Always 24h, for the "Variación 24h" metric.
  const { data: historicalSeries24hRes } = useQuery({
    queryKey: ["portfolio", "historical-series", "24h"],
    queryFn: () => window.cryptoControl.portfolio.getHistoricalSeries({ period: "24h" }),
    staleTime: CHART_SHORT_STALE_MS,
    refetchInterval: CHART_SHORT_STALE_MS,
    refetchIntervalInBackground: false,
  });

  const { data: assetsRes } = useQuery({
    queryKey: ["assets"],
    queryFn: () => window.cryptoControl.assets.list(),
  });

  const { data: localPositionsRes } = useQuery({
    queryKey: ["portfolio", "positions"],
    queryFn: () => window.cryptoControl.portfolio.getPositions(),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });

  // Shared sync function — called by auto-interval AND by balance-change detection
  const syncInBackground = useCallback(async () => {
    if (backgroundSyncRunning.current || !connected) return;
    backgroundSyncRunning.current = true;
    try {
      const result = await window.cryptoControl.coinbase.sync();
      if (result.ok) {
        // Selective invalidation: only what a Coinbase sync actually changes.
        // Excluir historical-series: es demasiado pesado para invalidar en cada sync.
        await queryClient.invalidateQueries({ queryKey: ["coinbase", "breakdown"] });
        await queryClient.invalidateQueries({ queryKey: ["coinbase", "portfolios"] });
        await queryClient.invalidateQueries({ queryKey: ["transactions"] });
        await queryClient.invalidateQueries({ queryKey: ["portfolio", "positions"] });
        await queryClient.invalidateQueries({ queryKey: ["portfolio", "live-snapshot"] });
      }
    } finally {
      backgroundSyncRunning.current = false;
    }
  }, [connected, queryClient]);

  useEffect(() => {
    if (!connected) return;

    // Delay first auto-sync so the UI is interactive before the network round-trip
    const initialTimer = window.setTimeout(() => void syncInBackground(), COINBASE_SYNC_INITIAL_DELAY_MS);
    const intervalId = window.setInterval(() => void syncInBackground(), COINBASE_SYNC_REFRESH_MS);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(intervalId);
    };
  }, [connected, syncInBackground]);

  // Balance change detection: when snapshotVersion changes, trigger a full sync
  // to import any new transactions and recalculate FIFO/average cost.
  const liveSnapshot = useMemo((): LivePortfolioValueSnapshot | null => {
    const res = liveSnapshotRes;
    if (!res) return null;
    if (typeof res === "object" && "ok" in res) {
      return res.ok ? (res as any).data : null;
    }
    return res ?? null;
  }, [liveSnapshotRes]);

  // Mapa rápido de activos del snapshot vivo: assetId → datos en vivo
  // Actualizado cada 5 s para que los campos de cantidad/precio/valor sean siempre frescos.
  const livePositionMap = useMemo(() => {
    const map = new Map<string, { quantity: number; availableBalance: number; holdBalance: number; currentPriceEur: number | null; currentValueEur: number | null }>();
    if (!Array.isArray(liveSnapshot?.positions)) return map;
    for (const p of liveSnapshot.positions as any[]) {
      if (p?.assetId) {
        map.set(p.assetId, {
          quantity:         typeof p.quantity         === "number" ? p.quantity         : 0,
          availableBalance: typeof p.availableBalance === "number" ? p.availableBalance : 0,
          holdBalance:      typeof p.holdBalance      === "number" ? p.holdBalance      : 0,
          currentPriceEur:  typeof p.currentPriceEur  === "number" && Number.isFinite(p.currentPriceEur)  ? p.currentPriceEur  : null,
          currentValueEur:  typeof p.currentValueEur  === "number" && Number.isFinite(p.currentValueEur)  ? p.currentValueEur  : null,
        });
      }
    }
    return map;
  }, [liveSnapshot]);

  useEffect(() => {
    if (!liveSnapshot?.receivedAt) return;
    setLiveUpdateMs(liveSnapshot.receivedAt);

    const version = liveSnapshot.snapshotVersion ?? liveSnapshot.portfolioVersion ?? null;
    if (version && prevSnapshotVersionRef.current !== null && prevSnapshotVersionRef.current !== version) {
      // Balance changed on Coinbase — trigger a full sync to import new transactions
      void syncInBackground();
    }
    prevSnapshotVersionRef.current = version;
  }, [liveSnapshot, syncInBackground]);

  // "Actualizado hace X s" counter — ticks every second
  useEffect(() => {
    const tick = () => {
      setSecondsAgo(liveUpdateMs !== null ? Math.floor((Date.now() - liveUpdateMs) / 1000) : null);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [liveUpdateMs]);

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
    // refreshes every 60s and the live point is genuinely contemporaneous.
    // For longer periods (1w, 1m, 1y, all) the last historical point may be
    // hours or days old: appending a live value from a different time creates
    // an artificial spike/drop at the right edge of the chart.
    if (period !== "1h" && period !== "24h") return reconstructed;

    // Preferir liveSnapshot (más fresco, actualizado cada 5 s) sobre breakdown
    const liveTotal = liveSnapshot && typeof liveSnapshot.totalAssetValueEur === "number" && liveSnapshot.totalAssetValueEur > 0
      ? liveSnapshot.totalAssetValueEur
      : null;

    if (liveTotal !== null && liveSnapshot) {
      const nowSeconds = Math.floor(liveSnapshot.timestamp / 1000) as import("lightweight-charts").Time;
      const last = reconstructed[reconstructed.length - 1];
      if ((nowSeconds as number) > (last.time as number)) {
        return [...reconstructed, { time: nowSeconds, value: liveTotal }];
      }
      // Actualizar último punto si el timestamp es prácticamente el mismo
      return [...reconstructed.slice(0, -1), { time: last.time, value: liveTotal }];
    }

    // Fallback: usar breakdown si liveSnapshot no está disponible aún
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
        const capturedSeconds = Math.floor(liveBreakdown.capturedAt / 1000) as import("lightweight-charts").Time;
        const last = reconstructed[reconstructed.length - 1];
        if ((capturedSeconds as number) > (last.time as number)) {
          return [...reconstructed, { time: capturedSeconds, value: liveValue }];
        }
      }
    }
    return reconstructed;
  }, [reconstructedSeries, liveSnapshot, breakdownRes, period]);

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

  // Block only on first-load (no data in cache yet). While revalidating, show
  // the last valid state with a subtle "Actualizando…" indicator instead of a
  // full spinner. loadingBreakdown is true only when there is no cached data.
  if (loadingStatus) {
    return (
      <section className="page-stack">
        <PageToolbar title="Cartera" meta="Iniciando…" />
        <LoadingState message="Comprobando conexión…" />
      </section>
    );
  }
  if (connected && loadingPortfolios) {
    return (
      <section className="page-stack">
        <PageToolbar title="Cartera" meta="Obteniendo portfolios" />
        <LoadingState message="Cargando portfolios…" />
      </section>
    );
  }
  // Only full-block on breakdown when there's no cached data at all.
  // If the live snapshot has already arrived (5 s polling starts immediately),
  // show the total value right away instead of a blank spinner.
  if (selectedPortfolioId && loadingBreakdown) {
    const earlySnap = liveSnapshot;
    if (earlySnap) {
      const earlyTotal = calculateLiveTotalAssetValue(earlySnap);
      return (
        <section className="page-stack portfolio-page">
          <PageToolbar title="Cartera" eyebrow="Portfolio activo"
            meta={<span className="toolbar-status"><span>Cargando detalle…</span></span>}
          />
          <PortfolioMetrics
            totalBalance={earlyTotal}
            cryptoTotalEur={earlySnap.cryptoValueEur}
            eurcTotalEur={earlySnap.eurcValueEur > 0 ? earlySnap.eurcValueEur : null}
            totalInvested={null}
            totalInvestedIsPartial={false}
            totalInvestedPendingLabel={undefined}
            performance={null}
            performanceIsPartial={false}
            variation24h={null}
            variation24hPercent={null}
            positionsCount={0}
          />
        </section>
      );
    }
    return (
      <section className="page-stack">
        <PageToolbar title="Cartera" meta="Cargando datos" />
        <LoadingState message="Cargando cartera…" />
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

  // Investment positions from breakdown (estructura base: sparklines, metadatos 24h).
  const breakdownPositions = allAggregated
    .filter((position) => position.asset !== "EURC" && !position.isCash)
    .sort((a, b) => (b.totalBalanceFiat ?? -1) - (a.totalBalanceFiat ?? -1));

  // Merge live snapshot (5 s) into breakdown cards:
  // – quantity, price, value override comes from liveSnapshot;
  // – sparkline, 24h change, market metadata stays from breakdown.
  // This makes individual position cards reflect Coinbase at 5 s resolution.
  const mergedPositions = breakdownPositions.map((pos) => {
    const live = livePositionMap.get(pos.asset);
    if (!live) return pos;
    return {
      ...pos,
      totalBalanceCrypto: live.quantity,
      totalBalanceFiat:   live.currentValueEur ?? pos.totalBalanceFiat,
      market: pos.market
        ? { ...pos.market, price: live.currentPriceEur ?? pos.market.price }
        : (live.currentPriceEur != null ? { price: live.currentPriceEur } : pos.market),
    };
  });

  // Assets that appeared in the live snapshot but not in the last breakdown
  // (e.g. a very recent purchase before the next 30-s breakdown tick).
  // Show them with pending cost so the user never sees a missing asset.
  const extraLivePositions = Array.from(livePositionMap.entries())
    .filter(([assetId]) =>
      assetId !== "EUR" && assetId !== "EURC" &&
      !breakdownPositions.some((p) => p.asset === assetId)
    )
    .map(([assetId, live]) => ({
      asset:              assetId,
      totalBalanceCrypto: live.quantity,
      totalBalanceFiat:   live.currentValueEur,
      market:             live.currentPriceEur != null ? { price: live.currentPriceEur } : null,
      allocation:         null,
      isCash:             false,
      accountType:        "exchange" as const,
      sparkline:          [] as number[],
    }));

  // Final list: merged breakdown (live-updated) + any extra assets from live snapshot
  const positions = [...mergedPositions, ...extraLivePositions]
    .sort((a, b) => ((b.totalBalanceFiat ?? -1) as number) - ((a.totalBalanceFiat ?? -1) as number));

  // Cost basis — from local FIFO DB (30 s, changes only after transactions)
  let totalInvestedSum = 0;
  let totalInvestedComplete = positions.length > 0;
  const pendingCostAssets: string[] = [];
  for (const position of positions) {
    const localCost = localPositionMap[position.asset];
    if (typeof localCost === "number" && Number.isFinite(localCost) && localCost > 0 && !localCostPendingByAsset[position.asset]) {
      totalInvestedSum += localCost;
    } else {
      totalInvestedComplete = false;
      pendingCostAssets.push(position.asset);
    }
  }

  // Mostrar suma parcial incluso cuando no todos los activos tienen coste completo.
  const totalInvested = totalInvestedSum > 0 ? totalInvestedSum : null;
  const totalInvestedIsPartial = !totalInvestedComplete && totalInvestedSum > 0;
  const totalInvestedPendingLabel = pendingCostAssets.length > 0
    ? `Pendiente: ${pendingCostAssets.join(", ")}`
    : undefined;

  // Valor cripto: preferir liveSnapshot (precios frescos cada 5 s) sobre breakdown.
  // cryptoValueEur del liveSnapshot excluye explícitamente EURC y EUR.
  const snapshotCryptoTotal = typeof liveSnapshot?.cryptoValueEur === "number" && liveSnapshot.cryptoValueEur > 0
    ? liveSnapshot.cryptoValueEur : null;
  const snapshotEurcValue = typeof liveSnapshot?.eurcValueEur === "number"
    ? liveSnapshot.eurcValueEur : eurcTotalFiat;
  const snapshotEurBalance = typeof liveSnapshot?.eurBalance === "number" ? liveSnapshot.eurBalance : 0;
  const cryptoTotal = snapshotCryptoTotal ?? positionsTotalBalance(mergedPositions);

  // Total patrimonial = cripto + EURC + EUR via shared function (no double-counting).
  const totalBalance = liveSnapshot
    ? calculateLiveTotalAssetValue(liveSnapshot)
    : (cryptoTotal !== null || snapshotEurcValue > 0
      ? (cryptoTotal ?? 0) + snapshotEurcValue + snapshotEurBalance
      : null);

  // P&L is crypto-only: EURC is a stablecoin reserve, not a speculative asset.
  const performance = totalInvested !== null && cryptoTotal !== null ? cryptoTotal - totalInvested : null;
  const performanceIsPartial = totalInvestedIsPartial;

  const variationFromPositions = portfolio24hVariation(mergedPositions, snapshotEurcValue);
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
            <DataStatus
              state={liveSnapshot?.usingFallback ? "cached" : breakdown?.state === "unavailable" ? "unavailable" : "live"}
              reason={liveSnapshot?.usingFallback ? "Usando caché local" : breakdown?.reason}
            />
            <span>
              {secondsAgo === null
                ? (fetchingBreakdown ? "Sincronizando…" : "Conectando…")
                : secondsAgo <= 7
                ? `Actualizado hace ${secondsAgo} s`
                : secondsAgo <= 20
                ? `Datos de hace ${secondsAgo} s`
                : `Última actualización: ${formatDateTime(liveUpdateMs ?? breakdown?.capturedAt)}`
              }
            </span>
          </span>
        }
      />

      <PortfolioMetrics
        totalBalance={totalBalance}
        cryptoTotalEur={cryptoTotal}
        eurcTotalEur={snapshotEurcValue > 0 ? snapshotEurcValue : null}
        totalInvested={totalInvested}
        totalInvestedIsPartial={totalInvestedIsPartial}
        totalInvestedPendingLabel={totalInvestedPendingLabel}
        performance={performance}
        performanceIsPartial={performanceIsPartial}
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
