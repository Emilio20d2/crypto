import { describe, test, expect } from "vitest";
import { PortfolioCalculator } from "./calculator";
import { TransactionInput } from "./types";

describe("PortfolioCalculator", () => {
  const calculator = new PortfolioCalculator();

  test("Calcula balance y precio medio tras una compra", () => {
    const txs: TransactionInput[] = [
      {
        id: "tx1",
        date: 1000,
        type: "buy",
        legs: [
          { assetId: "BTC", amount: 1, legType: "destination", valuationEur: 30000 }
        ]
      }
    ];

    const result = calculator.calculate(txs);
    expect(result.positions["BTC"].balance).toBe(1);
    expect(result.positions["BTC"].totalInvestedEur).toBe(30000);
    expect(result.positions["BTC"].averagePriceEur).toBe(30000);
  });

  test("Airdrop sin valor mantiene coste base y baja precio medio si ya había", () => {
    const txs: TransactionInput[] = [
      {
        id: "tx1",
        date: 1000,
        type: "buy",
        legs: [{ assetId: "ETH", amount: 2, legType: "destination", valuationEur: 4000 }] // 2 ETH a 2000 c/u
      },
      {
        id: "tx2",
        date: 2000,
        type: "airdrop",
        legs: [{ assetId: "ETH", amount: 2, legType: "destination" }] // 2 ETH extra sin coste (no valuationEur)
      }
    ];

    const result = calculator.calculate(txs);
    expect(result.positions["ETH"].balance).toBe(4);
    expect(result.positions["ETH"].totalInvestedEur).toBe(4000);
    expect(result.positions["ETH"].averagePriceEur).toBe(1000); // 4000 / 4
  });

  test("Venta parcial calcula ganancia realizada correctamente y ajusta capital invertido", () => {
    const txs: TransactionInput[] = [
      {
        id: "tx1",
        date: 1000,
        type: "buy",
        legs: [{ assetId: "BTC", amount: 2, legType: "destination", valuationEur: 60000 }] // Precio medio 30000
      },
      {
        id: "tx2",
        date: 2000,
        type: "sell",
        legs: [{ assetId: "BTC", amount: -1, legType: "source", valuationEur: 40000 }] // Vende 1 BTC por 40000
      }
    ];

    const result = calculator.calculate(txs);
    expect(result.positions["BTC"].balance).toBe(1);
    expect(result.positions["BTC"].totalInvestedEur).toBe(30000); // 60000 - 30000 de coste
    expect(result.positions["BTC"].averagePriceEur).toBe(30000);
    expect(result.realizedGains).toHaveLength(1);
    expect(result.realizedGains[0].realizedGainEur).toBe(10000); // 40000 - 30000
  });

  test("Transferencias no alteran el capital invertido", () => {
     const txs: TransactionInput[] = [
      {
        id: "tx1",
        date: 1000,
        type: "buy",
        legs: [{ assetId: "BTC", amount: 1, legType: "destination", valuationEur: 30000 }]
      },
      {
        id: "tx2",
        date: 2000,
        type: "transfer_out",
        legs: [{ assetId: "BTC", amount: -0.5, legType: "source" }]
      }
    ];

    const result = calculator.calculate(txs);
    expect(result.positions["BTC"].balance).toBe(0.5);
    expect(result.positions["BTC"].totalInvestedEur).toBe(15000); // 30000 - 15000
    expect(result.positions["BTC"].averagePriceEur).toBe(30000); 
  });
});
