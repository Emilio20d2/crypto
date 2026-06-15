import type { TransactionInput } from "@crypto-control/portfolio";

export type HistoryPoint = { time: number; value: number };

export type QtyEvent = { time: number; qty: number };

// Builds a sorted event list per asset: each event marks the cumulative balance after that tx
export function reconstructAssetQuantities(
  txs: TransactionInput[]
): Record<string, QtyEvent[]> {
  const sorted = [...txs].sort((a, b) => a.date - b.date);
  const running: Record<string, number> = {};
  const events: Record<string, QtyEvent[]> = {};

  for (const tx of sorted) {
    for (const leg of tx.legs) {
      running[leg.assetId] = (running[leg.assetId] ?? 0) + leg.amount;
      if (!events[leg.assetId]) events[leg.assetId] = [];
      events[leg.assetId].push({ time: tx.date, qty: running[leg.assetId] });
    }
  }
  return events;
}

// Binary search: quantity of an asset at a given ms timestamp (step function, carry-forward)
export function getQtyAtTime(events: QtyEvent[], timestampMs: number): number {
  if (!events.length) return 0;
  let lo = 0, hi = events.length - 1, result = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].time <= timestampMs) {
      result = events[mid].qty;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

// Binary search: last known price at or before a ms timestamp (carry-forward, no interpolation)
export function findPriceAtOrBefore(
  prices: { time: number; price: number }[],
  timestampMs: number
): number | null {
  if (!prices.length) return null;
  let lo = 0, hi = prices.length - 1;
  let result: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (prices[mid].time <= timestampMs) {
      result = prices[mid].price;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

// Builds full portfolio value series from transactions and per-asset price arrays.
// prices[assetId][].time is in ms. Output time is in UNIX SECONDS (for lightweight-charts).
export function buildPortfolioSeries(
  txs: TransactionInput[],
  pricesByAsset: Record<string, { time: number; price: number }[]>
): HistoryPoint[] {
  const assetQty = reconstructAssetQuantities(txs);

  // Merge all price timestamps across all assets
  const allTs = new Set<number>();
  for (const prices of Object.values(pricesByAsset)) {
    for (const p of prices) allTs.add(p.time);
  }

  const sortedTs = [...allTs].sort((a, b) => a - b);
  const points: HistoryPoint[] = [];
  const seen = new Set<number>(); // dedup by second

  for (const ts of sortedTs) {
    let totalValue = 0;
    let hasHolding = false;

    for (const [assetId, prices] of Object.entries(pricesByAsset)) {
      const qty = getQtyAtTime(assetQty[assetId] ?? [], ts);
      if (qty <= 0) continue;
      const price = findPriceAtOrBefore(prices, ts);
      if (price === null || price <= 0) continue;
      totalValue += qty * price;
      hasHolding = true;
    }

    if (!hasHolding || totalValue <= 0) continue;
    const seconds = Math.floor(ts / 1000);
    if (seen.has(seconds)) continue;
    seen.add(seconds);
    points.push({ time: seconds, value: totalValue });
  }

  return points;
}

// Window sizes in seconds per Period key
export const PERIOD_WINDOW_S: Record<string, number | null> = {
  "1h":  3_600,
  "24h": 86_400,
  "1w":  604_800,
  "1m":  2_592_000,
  "1y":  31_536_000,
  "all": null,
};

// Slice a series to the last windowSeconds relative to the latest point.
// Returns original array if windowSeconds is null (all-time view).
// Pure — no Date.now() calls.
export function sliceByPeriod(
  points: HistoryPoint[],
  windowSeconds: number | null
): HistoryPoint[] {
  if (windowSeconds === null || points.length === 0) return points;
  const latest = points[points.length - 1].time as number;
  const cutoff = latest - windowSeconds;
  return points.filter(p => (p.time as number) >= cutoff);
}
