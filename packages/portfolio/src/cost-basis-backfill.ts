export interface PendingLeg {
  id: string;
  assetId: string;
  amount: number;
  transactionDate: number;
}

export interface BackfillResult {
  legId: string;
  acquisitionValueEur: number;
  unitAcquisitionPriceEur: number;
}

// Computes the EUR cost basis for a leg that has no Coinbase-reported
// valuation (typically crypto-to-crypto converts, or rewards/transfers-in)
// from a real historical market price at the leg's own transaction date.
// This is not fabricating a number — it's the standard "cost basis from
// market price at acquisition time" method — but it only ever applies when
// a real price was actually resolved; never guesses, never reuses another
// date's price, never returns a result for an unresolved price.
export function computeBackfillForLeg(leg: PendingLeg, priceAtDateEur: number | null): BackfillResult | null {
  if (priceAtDateEur === null || !Number.isFinite(priceAtDateEur) || priceAtDateEur <= 0) return null;
  const amount = Math.abs(leg.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return {
    legId: leg.id,
    acquisitionValueEur: amount * priceAtDateEur,
    unitAcquisitionPriceEur: priceAtDateEur,
  };
}

// Binary search over an ascending-by-time price series — same approach
// already used by the portfolio historical-value reconstruction — so a
// leg's acquisition price always comes from the closest real price at or
// before its own transaction date, never an interpolation or a later price.
export function priceAtOrBefore(prices: { time: number; price: number }[], targetTimeMs: number): number | null {
  if (prices.length === 0) return null;
  let lo = 0;
  let hi = prices.length - 1;
  let result: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (prices[mid].time <= targetTimeMs) {
      result = prices[mid].price;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}
