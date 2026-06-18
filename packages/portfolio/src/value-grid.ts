export type ValueGridPeriod = "1h" | "24h" | "1w" | "1m" | "1y" | "all";

export interface ValueGridPoint {
  time: number;
  value: number;
}

// Same granularity ladder Mercado's own candle fetch uses (ONE_MINUTE for
// 1h, FIFTEEN_MINUTE for 24h, ONE_HOUR for 7d, SIX_HOUR for 30d, ONE_DAY for
// 1y/all) so Cartera's reconstruction generates the same point count/
// timestamps Mercado would for the same period, instead of a fixed/coarser
// step regardless of timeframe.
export const GRID_STEP_SECONDS: Record<ValueGridPeriod, number> = {
  "1h": 60,
  "24h": 15 * 60,
  "1w": 60 * 60,
  "1m": 6 * 60 * 60,
  "1y": 24 * 60 * 60,
  "all": 24 * 60 * 60,
};

export const WINDOW_SECONDS: Record<ValueGridPeriod, number | null> = {
  "1h": 3600,
  "24h": 86400,
  "1w": 7 * 86400,
  "1m": 30 * 86400,
  "1y": 365 * 86400,
  "all": null,
};

export interface BuildValueGridInput {
  period: ValueGridPeriod;
  nowSeconds: number;
  // Seconds of the cartera's very first transaction. If there has never
  // been one, pass nowSeconds (no zero-padding span to generate).
  firstTxSeconds: number;
  // Evaluates qty × historical price summed across every held asset at a
  // given millisecond timestamp. Returns hasHolding=false when no asset had
  // a non-zero balance, distinguishing "didn't exist yet" from "exists but
  // is worth nothing". complete=false means at least one held asset lacked a
  // resolvable price, so the total would be partial and must not be drawn.
  valueAtMs: (ts: number) => { value: number; hasHolding: boolean; complete?: boolean };
}

// Builds a regular timestamp grid for `period` — same step Mercado uses —
// evaluating portfolio value at each point. Points before the cartera's
// first transaction are explicit zeros (never omitted, never interpolated).
// Points after that are omitted when the portfolio total would be partial
// because a held asset has no resolvable price (never zero-filled, never
// reused from another period/timeframe).
export function buildPortfolioValueGrid(input: BuildValueGridInput): ValueGridPoint[] {
  const { period, nowSeconds, firstTxSeconds, valueAtMs } = input;
  const step = GRID_STEP_SECONDS[period];
  const windowSeconds = WINDOW_SECONDS[period];
  const gridStart = windowSeconds !== null ? nowSeconds - windowSeconds : firstTxSeconds;

  const points: ValueGridPoint[] = [];
  for (let t = gridStart; t < nowSeconds; t += step) {
    if (t < firstTxSeconds) {
      points.push({ time: t, value: 0 });
      continue;
    }
    const { value, hasHolding, complete = true } = valueAtMs(t * 1000);
    if (complete && (!hasHolding || value >= 0)) {
      points.push({ time: t, value: hasHolding ? value : 0 });
    }
  }

  const { value: nowValue, hasHolding: nowHasHolding, complete: nowComplete = true } = valueAtMs(nowSeconds * 1000);
  if (nowComplete) {
    points.push({ time: nowSeconds, value: nowHasHolding ? nowValue : 0 });
  }

  return points;
}
