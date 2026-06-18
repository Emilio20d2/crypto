import type { FiscalConfig } from "./types";

export function computeTaxOnGain(netGain: number, config: FiscalConfig): number {
  if (netGain <= 0) return 0;

  let tax = 0;
  let remaining = netGain;
  let prev = 0;

  for (const bracket of config.brackets) {
    const limit = bracket.upTo ?? Infinity;
    const slice = Math.min(remaining, limit - prev);
    if (slice <= 0) break;
    tax += slice * bracket.rate;
    remaining -= slice;
    prev = limit;
    if (remaining <= 0) break;
  }

  return Math.round(tax * 100) / 100;
}

export function computeFifoGain(
  quantitySold: number,
  lots: Array<{ remaining: number; costPerUnitEur: number }>,
): { gainEur: number; costBasisEur: number; lotsConsumed: Array<{ quantity: number; costPerUnitEur: number }> } {
  let toSell = quantitySold;
  let costBasisEur = 0;
  const lotsConsumed: Array<{ quantity: number; costPerUnitEur: number }> = [];

  for (const lot of lots) {
    if (toSell <= 0) break;
    const fromLot = Math.min(toSell, lot.remaining);
    costBasisEur += fromLot * lot.costPerUnitEur;
    lotsConsumed.push({ quantity: fromLot, costPerUnitEur: lot.costPerUnitEur });
    toSell -= fromLot;
  }

  // If we still need to sell more than what's in lots, use avg cost of last lot
  if (toSell > 0 && lots.length > 0) {
    const lastCost = lots[lots.length - 1].costPerUnitEur;
    costBasisEur += toSell * lastCost;
    lotsConsumed.push({ quantity: toSell, costPerUnitEur: lastCost });
  }

  return { gainEur: 0, costBasisEur, lotsConsumed };
}

export function effectiveTaxRate(gain: number, config: FiscalConfig): number {
  if (gain <= 0) return 0;
  const tax = computeTaxOnGain(gain, config);
  return tax / gain;
}
