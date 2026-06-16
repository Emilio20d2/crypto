import { describe, test, expect } from "vitest";
import { normalizeFill, normalizeV2Transactions } from "./normalizer";
import type { CoinbaseFill, V2Transaction } from "./types";

function makeV2Tx(overrides: Partial<V2Transaction> = {}): V2Transaction {
  return {
    id: "v2-001",
    type: "send",
    status: "completed",
    created_at: "2024-01-15T10:30:00Z",
    updated_at: "2024-01-15T10:30:00Z",
    resource: "transaction",
    resource_path: "/v2/accounts/acc/transactions/v2-001",
    amount: { amount: "1", currency: "BTC" },
    native_amount: { amount: "50000", currency: "EUR" },
    description: null,
    details: { title: "", subtitle: "" },
    ...overrides,
  };
}

function makeFill(overrides: Partial<CoinbaseFill> = {}): CoinbaseFill {
  return {
    entry_id: "fill-001",
    trade_id: "trade-001",
    order_id: "order-001",
    trade_time: "2024-01-15T10:30:00Z",
    trade_type: "FILL",
    price: "50000",
    size: "0.001",
    commission: "1.25",
    product_id: "BTC-EUR",
    sequence_timestamp: "2024-01-15T10:30:00.123Z",
    liquidity_indicator: "MAKER",
    size_in_quote: false,
    user_id: "user-123",
    side: "BUY",
    ...overrides,
  };
}

describe("normalizeFill — normalizer de fills de Coinbase", () => {
  test("BUY BTC-EUR → type=buy, leg destination, valoración EUR correcta", () => {
    const result = normalizeFill(makeFill({ price: "50000", size: "0.001", commission: "1.25" }));

    expect(result.type).toBe("buy");
    expect(result.externalId).toBe("fill-001");
    expect(result.date).toBe(new Date("2024-01-15T10:30:00Z").getTime());

    const leg = result.legs.find(l => l.legType === "destination");
    expect(leg).toBeDefined();
    expect(leg!.assetId).toBe("BTC");
    expect(leg!.amount).toBeCloseTo(0.001);
    // acquisitionValueEur = quoteAmount + commission = (0.001 * 50000) + 1.25 = 51.25
    expect(leg!.acquisitionValueEur).toBeCloseTo(51.25);
    expect(leg!.unitAcquisitionPriceEur).toBeCloseTo(51250);
    expect(leg!.valuationStatus).toBe("valued");
  });

  test("SELL ETH-EUR → type=sell, leg source con amount negativo", () => {
    const result = normalizeFill(
      makeFill({ product_id: "ETH-EUR", side: "SELL", price: "3000", size: "0.5", commission: "0.75" })
    );

    expect(result.type).toBe("sell");

    const leg = result.legs.find(l => l.legType === "source");
    expect(leg).toBeDefined();
    expect(leg!.assetId).toBe("ETH");
    expect(leg!.amount).toBeCloseTo(-0.5);
    // saleEur = quoteAmount - commission = (0.5 * 3000) - 0.75 = 1499.25
    expect(leg!.acquisitionValueEur).toBeCloseTo(1499.25);
    expect(leg!.valuationStatus).toBe("valued");
  });

  test("BUY BTC-ETH (cripto/cripto) → type=convert, dos legs, pending", () => {
    const result = normalizeFill(
      makeFill({ product_id: "BTC-ETH", side: "BUY", price: "20", size: "0.01", commission: "0" })
    );

    expect(result.type).toBe("convert");
    expect(result.legs).toHaveLength(2);

    const source = result.legs.find(l => l.legType === "source");
    expect(source!.assetId).toBe("ETH");
    expect(source!.amount).toBeCloseTo(-0.2); // 0.01 * 20

    const dest = result.legs.find(l => l.legType === "destination");
    expect(dest!.assetId).toBe("BTC");
    expect(dest!.amount).toBeCloseTo(0.01);

    expect(source!.valuationStatus).toBe("pending");
    expect(dest!.valuationStatus).toBe("pending");
    expect(source!.acquisitionValueEur).toBeNull();
  });

  test("size_in_quote=true → baseAmount calculado como size/price", () => {
    const result = normalizeFill(
      makeFill({ price: "50000", size: "50", size_in_quote: true, commission: "0" })
    );

    // baseAmount = 50 / 50000 = 0.001
    const leg = result.legs.find(l => l.legType === "destination");
    expect(leg!.amount).toBeCloseTo(0.001);
    // quoteAmount = size = 50; totalEur = 50 + 0 = 50
    expect(leg!.acquisitionValueEur).toBeCloseTo(50);
  });

  test("commission=0 → fees vacío", () => {
    const result = normalizeFill(makeFill({ commission: "0" }));
    expect(result.fees).toHaveLength(0);
  });

  test("commission>0 → fees tiene una entrada con assetId del quote", () => {
    const result = normalizeFill(makeFill({ commission: "1.25" }));
    expect(result.fees).toHaveLength(1);
    expect(result.fees[0].assetId).toBe("EUR");
    expect(result.fees[0].amount).toBeCloseTo(1.25);
  });

  test("SELL BTC-USDC (stablecoin) → type=sell, valuationStatus=estimated", () => {
    const result = normalizeFill(
      makeFill({ product_id: "BTC-USDC", side: "SELL", price: "50000", size: "0.001", commission: "0.5" })
    );

    expect(result.type).toBe("sell");
    const leg = result.legs.find(l => l.legType === "source");
    expect(leg!.valuationStatus).toBe("estimated");
    // saleEur ≈ (0.001 * 50000) - 0.5 = 49.5 (at 1 USDC = 1 EUR)
    expect(leg!.acquisitionValueEur).toBeCloseTo(49.5);
  });

  test("requiredAssets incluye base (crypto) y quote (fiat) correctamente", () => {
    const result = normalizeFill(makeFill({ product_id: "ETH-EUR" }));
    const ids = result.requiredAssets.map(a => a.id);
    expect(ids).toContain("ETH");
    expect(ids).toContain("EUR");

    const eth = result.requiredAssets.find(a => a.id === "ETH")!;
    expect(eth.type).toBe("crypto");
    const eur = result.requiredAssets.find(a => a.id === "EUR")!;
    expect(eur.type).toBe("fiat");
  });

  test("producto mal formado → lanza error", () => {
    expect(() => normalizeFill(makeFill({ product_id: "BTCEUR" }))).toThrow(
      /Formato de producto no reconocido/
    );
  });

  test("BUY BTC-GBP → valuationStatus=pending (fiat no EUR)", () => {
    const result = normalizeFill(
      makeFill({ product_id: "BTC-GBP", side: "BUY", price: "42000", size: "0.001", commission: "0" })
    );

    expect(result.type).toBe("buy");
    const leg = result.legs.find(l => l.legType === "destination");
    expect(leg!.valuationStatus).toBe("pending");
    expect(leg!.acquisitionValueEur).toBeNull();
  });
});

describe("normalizeV2Transactions — grupo 'trade' (Convert del flujo V2 simple)", () => {
  test("Convert con native_amount en EUR queda valorado, no pendiente", () => {
    const txs: V2Transaction[] = [
      makeV2Tx({
        id: "v2-out",
        type: "trade",
        trade: { id: "trade-1", resource: "trade", resource_path: "/trade/1" },
        amount: { amount: "-300", currency: "SEI" },
        native_amount: { amount: "-16.62", currency: "EUR" },
      }),
      makeV2Tx({
        id: "v2-in",
        type: "trade",
        trade: { id: "trade-1", resource: "trade", resource_path: "/trade/1" },
        amount: { amount: "0.0003", currency: "BTC" },
        native_amount: { amount: "16.62", currency: "EUR" },
      }),
    ];

    const [result] = normalizeV2Transactions(txs);

    expect(result.type).toBe("convert");
    const seiLeg = result.legs.find(l => l.assetId === "SEI");
    const btcLeg = result.legs.find(l => l.assetId === "BTC");

    expect(seiLeg!.valuationStatus).toBe("valued");
    expect(seiLeg!.acquisitionValueEur).toBeCloseTo(16.62);
    expect(btcLeg!.valuationStatus).toBe("valued");
    expect(btcLeg!.acquisitionValueEur).toBeCloseTo(16.62);
  });

  test("Convert sin native_amount en divisa fiat reconocida queda pending", () => {
    const txs: V2Transaction[] = [
      makeV2Tx({
        id: "v2-out-2",
        type: "trade",
        trade: { id: "trade-2", resource: "trade", resource_path: "/trade/2" },
        amount: { amount: "-1", currency: "ETH" },
        native_amount: { amount: "10", currency: "BTC" },
      }),
    ];

    const [result] = normalizeV2Transactions(txs);
    expect(result.legs[0].valuationStatus).toBe("pending");
    expect(result.legs[0].acquisitionValueEur).toBeNull();
  });
});
