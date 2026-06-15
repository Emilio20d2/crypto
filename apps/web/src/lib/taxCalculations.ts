export interface TaxBracket {
  upTo: number | null;
  rate: number;
}

// Spanish capital gains tax brackets for savings income (ganancias patrimoniales del ahorro) — 2024
export const SPAIN_SAVINGS_TAX_2024: TaxBracket[] = [
  { upTo: 6_000,   rate: 0.19 },
  { upTo: 50_000,  rate: 0.21 },
  { upTo: 200_000, rate: 0.23 },
  { upTo: 300_000, rate: 0.27 },
  { upTo: null,    rate: 0.28 },
];

export function calculateSpanishSavingsTax(
  netGain: number,
  brackets: TaxBracket[] = SPAIN_SAVINGS_TAX_2024
): number {
  if (netGain <= 0) return 0;
  let remaining = netGain;
  let tax = 0;
  let previousUpTo = 0;
  for (const bracket of brackets) {
    const bracketSize = bracket.upTo !== null ? bracket.upTo - previousUpTo : Infinity;
    const taxable = Math.min(remaining, bracketSize);
    tax += taxable * bracket.rate;
    remaining -= taxable;
    if (remaining <= 0) break;
    if (bracket.upTo !== null) previousUpTo = bracket.upTo;
  }
  return tax;
}

export interface GainWithDate {
  transactionId: string;
  assetId: string;
  amountSold: number;
  sellValueEur: number;
  costBasisEur: number;
  realizedGainEur: number;
  date: number;
}

export interface FiscalYearSummary {
  year: number;
  gains: GainWithDate[];
  totalSellValueEur: number;
  totalCostBasisEur: number;
  netGainEur: number;
  estimatedTaxEur: number;
  reservaRecomendadaEur: number;
}

export function buildFiscalYearSummaries(
  gains: GainWithDate[],
  brackets: TaxBracket[] = SPAIN_SAVINGS_TAX_2024
): FiscalYearSummary[] {
  const byYear = new Map<number, GainWithDate[]>();
  for (const g of gains) {
    const year = new Date(g.date).getFullYear();
    const list = byYear.get(year) ?? [];
    list.push(g);
    byYear.set(year, list);
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => b - a)
    .map(([year, yearGains]) => {
      const totalSellValueEur = yearGains.reduce((s, g) => s + g.sellValueEur, 0);
      const totalCostBasisEur = yearGains.reduce((s, g) => s + g.costBasisEur, 0);
      const netGainEur = yearGains.reduce((s, g) => s + g.realizedGainEur, 0);
      const estimatedTaxEur = calculateSpanishSavingsTax(netGainEur, brackets);
      return {
        year,
        gains: yearGains,
        totalSellValueEur,
        totalCostBasisEur,
        netGainEur,
        estimatedTaxEur,
        reservaRecomendadaEur: estimatedTaxEur,
      };
    });
}
