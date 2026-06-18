import { describe, expect, test } from "vitest";
import {
  GlobalMetricsService,
  parseCoinGeckoGlobalMetrics,
  parseCoinLoreGlobalMetrics,
  parseCoinPaprikaGlobalMetrics,
} from "./global-metrics";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    statusText: status === 200 ? "OK" : "Upstream Error",
    headers: { "content-type": "application/json" },
  });
}

describe("GlobalMetricsService", () => {
  test("parsea CoinGecko global con dominancias, capitalización y volumen", () => {
    const parsed = parseCoinGeckoGlobalMetrics({
      data: {
        market_cap_percentage: { btc: 55.4, eth: 9.2 },
        total_market_cap: { usd: 2_200_000_000_000 },
        total_volume: { usd: 120_000_000_000 },
        market_cap_change_percentage_24h_usd: -3.2,
      },
    }, 1_000);

    expect(parsed).toMatchObject({
      btcDominance: 55.4,
      ethDominance: 9.2,
      totalMarketCapUsd: 2_200_000_000_000,
      totalVolumeUsd: 120_000_000_000,
      marketCapChangePercentage24h: -3.2,
      source: "coingecko",
      fetchedAt: 1_000,
    });
  });

  test("parsea CoinLore global como fallback completo", () => {
    const parsed = parseCoinLoreGlobalMetrics([{
      total_mcap: 2_100_000_000_000,
      total_volume: 110_000_000_000,
      btc_d: "57.47",
      eth_d: "9.45",
      mcap_change: "-3.74",
    }], 2_000);

    expect(parsed).toMatchObject({
      btcDominance: 57.47,
      ethDominance: 9.45,
      totalMarketCapUsd: 2_100_000_000_000,
      totalVolumeUsd: 110_000_000_000,
      marketCapChangePercentage24h: -3.74,
      source: "coinlore",
    });
  });

  test("parsea CoinPaprika aunque no tenga dominancia ETH", () => {
    const parsed = parseCoinPaprikaGlobalMetrics({
      market_cap_usd: 2_262_888_507_398,
      volume_24h_usd: 132_623_792_129,
      bitcoin_dominance_percentage: 55.48,
      market_cap_change_24h: -4.4,
      last_updated: 1_781_808_505,
    }, 3_000);

    expect(parsed.ethDominance).toBeNull();
    expect(parsed.source).toBe("coinpaprika");
    expect(parsed.fetchedAt).toBe(1_781_808_505_000);
  });

  test("usa CoinLore si CoinGecko falla", async () => {
    const service = new GlobalMetricsService({
      fetchImpl: async (url) => {
        if (String(url).includes("coingecko")) return jsonResponse({ error: "rate limit" }, 429);
        return jsonResponse([{
          total_mcap: 2_100_000_000_000,
          total_volume: 110_000_000_000,
          btc_d: "57.47",
          eth_d: "9.45",
          mcap_change: "-3.74",
        }]);
      },
    });

    const result = await service.get();
    expect(result.state).toBe("live");
    expect(result.source).toBe("coinlore");
    expect(result.providersTried).toEqual(["coingecko", "coinlore"]);
  });

  test("usa último valor válido si todos los proveedores fallan después", async () => {
    let calls = 0;
    let now = 1_000;
    const service = new GlobalMetricsService({
      ttlMs: 10,
      now: () => now,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return jsonResponse({
            data: {
              market_cap_percentage: { btc: 55, eth: 9 },
              total_market_cap: { usd: 2_000_000_000_000 },
              total_volume: { usd: 100_000_000_000 },
              market_cap_change_percentage_24h_usd: 1.2,
            },
          });
        }
        throw new Error("Network timeout");
      },
    });

    expect((await service.get()).state).toBe("live");
    now = 20_000;
    const fallback = await service.get();
    expect(fallback.state).toBe("fallback");
    expect(fallback.isCached).toBe(true);
    expect(fallback.source).toBe("coingecko");
    expect(fallback.error).toMatch(/Network timeout/);
  });

  test("devuelve unavailable controlado sin último valor válido", async () => {
    const service = new GlobalMetricsService({
      fetchImpl: async () => {
        throw new Error("DNS failure");
      },
    });

    const result = await service.get();
    expect(result.state).toBe("unavailable");
    expect(result.totalMarketCapUsd).toBeNull();
    expect(result.error).toMatch(/DNS failure/);
    expect(result.providersTried).toEqual(["coingecko", "coinlore", "coinpaprika"]);
  });
});
