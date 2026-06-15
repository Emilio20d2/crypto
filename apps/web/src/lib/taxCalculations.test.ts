import { describe, test, expect } from "vitest";
import {
  calculateSpanishSavingsTax,
  buildFiscalYearSummaries,
  type GainWithDate,
} from "./taxCalculations";

describe("calculateSpanishSavingsTax", () => {
  test("0 ganancia → 0 impuesto", () => {
    expect(calculateSpanishSavingsTax(0)).toBe(0);
  });

  test("ganancia negativa → 0 impuesto", () => {
    expect(calculateSpanishSavingsTax(-500)).toBe(0);
  });

  test("3.000 € → 570 € (todo en primer tramo 19%)", () => {
    expect(calculateSpanishSavingsTax(3_000)).toBeCloseTo(570, 2);
  });

  test("10.000 € → 1.980 € (6k×19% + 4k×21%)", () => {
    // 6000 × 0.19 = 1140
    // 4000 × 0.21 =  840
    // total         1980
    expect(calculateSpanishSavingsTax(10_000)).toBeCloseTo(1_980, 2);
  });

  test("60.000 € → 12.680 € (cruza tres tramos)", () => {
    // 6000  × 0.19 =  1140
    // 44000 × 0.21 =  9240
    // 10000 × 0.23 =  2300
    // total          12680
    expect(calculateSpanishSavingsTax(60_000)).toBeCloseTo(12_680, 2);
  });

  test("tipo efectivo nunca supera el máximo tramo", () => {
    const tax = calculateSpanishSavingsTax(500_000);
    const maxRate = 0.28;
    expect(tax / 500_000).toBeLessThanOrEqual(maxRate);
  });
});

describe("buildFiscalYearSummaries", () => {
  const gain2024: GainWithDate = {
    transactionId: "tx1",
    assetId: "bitcoin",
    amountSold: 0.1,
    sellValueEur: 5_000,
    costBasisEur: 2_000,
    realizedGainEur: 3_000,
    date: new Date("2024-06-15").getTime(),
  };

  const loss2024: GainWithDate = {
    transactionId: "tx2",
    assetId: "ethereum",
    amountSold: 1,
    sellValueEur: 1_500,
    costBasisEur: 2_000,
    realizedGainEur: -500,
    date: new Date("2024-09-01").getTime(),
  };

  const gain2023: GainWithDate = {
    transactionId: "tx3",
    assetId: "bitcoin",
    amountSold: 0.05,
    sellValueEur: 1_500,
    costBasisEur: 800,
    realizedGainEur: 700,
    date: new Date("2023-03-10").getTime(),
  };

  test("agrupa ganancias por año fiscal", () => {
    const summaries = buildFiscalYearSummaries([gain2024, gain2023]);
    expect(summaries).toHaveLength(2);
    expect(summaries[0].year).toBe(2024);
    expect(summaries[1].year).toBe(2023);
  });

  test("netGainEur suma pérdidas y ganancias del mismo año", () => {
    const summaries = buildFiscalYearSummaries([gain2024, loss2024]);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].netGainEur).toBeCloseTo(2_500, 2);
  });

  test("estimatedTaxEur es 0 cuando la ganancia neta es negativa", () => {
    const onlyLoss: GainWithDate = { ...loss2024, realizedGainEur: -1_000 };
    const summaries = buildFiscalYearSummaries([onlyLoss]);
    expect(summaries[0].estimatedTaxEur).toBe(0);
  });

  test("lista vacía devuelve array vacío", () => {
    expect(buildFiscalYearSummaries([])).toHaveLength(0);
  });
});
