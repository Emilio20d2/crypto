import { afterEach, describe, expect, it, vi } from "vitest";
import { CryptoCompareProvider } from "./cryptocompare";

const originalFetch = global.fetch;

const meta = {
  internalId: "BTC",
  cryptoControlId: "bitcoin",
  coinbaseProductId: "BTC-EUR",
  coinGeckoId: "bitcoin",
  symbol: "BTC",
  quoteCurrency: "EUR",
  supportedProviders: ["cryptocompare"],
};

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("CryptoCompare historical resolution", () => {
  it("requests six-hour candles for 30 days so the completeness guard can accept the series", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        Data: {
          Data: [
            { time: 1_000, open: 95, high: 105, low: 90, close: 100, volumeto: 1_000 },
            { time: 22_600, open: 100, high: 110, low: 98, close: 108, volumeto: 1_200 },
          ],
        },
      }),
    });
    const provider = new CryptoCompareProvider("test-key");

    const result = await provider.getHistoricalPrices(meta, "30d");

    expect(result).toHaveLength(2);
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/data/v2/histohour?"), expect.anything());
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("aggregate=6"), expect.anything());
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("limit=120"), expect.anything());
    expect(result[0]).toMatchObject({ open: 95, high: 105, low: 90, price: 100, volume: 1_000 });
  });
});
