import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { CoinbaseProvider } from "./coinbase";
import { CoinGeckoProvider } from "./coingecko";
import { CryptoCompareProvider } from "./cryptocompare";
import { MarketNotFoundError } from "./errors";
import type { MarketCacheRepository } from "./interfaces";
import { MarketService } from "./index";
import * as mapping from "./mapping";

const originalFetch = global.fetch;

describe("Market Providers y Resiliencia", () => {
  let marketService: MarketService;
  
  const mockMeta = {
    internalId: "BTC",
    cryptoControlId: "bitcoin",
    coinbaseProductId: "BTC-EUR",
    coinGeckoId: "bitcoin",
    symbol: "BTC",
    quoteCurrency: "EUR",
    supportedProviders: ["coinbase", "coingecko"]
  };
  
  beforeEach(() => {
    marketService = new MarketService();
    vi.spyOn(mapping, 'getAssetMetadata').mockReturnValue(mockMeta);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("Coinbase - Fetch current price (success)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ price: "50000.50" })
    });
    const cb = new CoinbaseProvider();
    const price = await cb.getCurrentPrice(mockMeta);
    expect(price).toBe(50000.50);
  });

  test("CoinGecko - Fetch current price (success)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ bitcoin: { eur: 49000.00 } })
    });
    const cg = new CoinGeckoProvider();
    const price = await cg.getCurrentPrice(mockMeta);
    expect(price).toBe(49000.00);
  });

  test("MarketService - Fallback a CoinGecko si Coinbase falla (Timeout o 500)", async () => {
    const cb = (marketService as unknown as { coinbase: { getCurrentPrice: unknown } }).coinbase;
    vi.spyOn(cb, "getCurrentPrice").mockRejectedValue(new Error("Timeout simulado"));
    
    const cg = (marketService as unknown as { coingecko: { getCurrentPrice: unknown } }).coingecko;
    vi.spyOn(cg, "getCurrentPrice").mockResolvedValue(48000.00);

    const result = await marketService.getCurrentPrice("bitcoin");
    
    expect(cb.getCurrentPrice).toHaveBeenCalled();
    expect(cg.getCurrentPrice).toHaveBeenCalled();
    expect(result).toMatchObject({ price: 48000.00, state: "live", provider: "coingecko" });
  }, 10000);

  test("MarketService - Rate limit / Fallo total no rompe en blanco (Lanza error recuperable)", async () => {
    const cg = (marketService as unknown as { coingecko: { getCurrentPrice: unknown } }).coingecko;
    const cb = (marketService as unknown as { coinbase: { getCurrentPrice: unknown } }).coinbase;
    vi.spyOn(cb, "getCurrentPrice").mockRejectedValue(new Error("Rate limit 429 Coinbase"));
    vi.spyOn(cg, "getCurrentPrice").mockRejectedValue(new Error("Rate limit 429 CoinGecko"));

    const result = await marketService.getCurrentPrice("bitcoin");
    expect(result).toMatchObject({ price: null, state: "unavailable", reason: "Rate limit 429 CoinGecko" });
  }, 10000);

  test("MarketService - usa CryptoCompare si Coinbase y CoinGecko fallan", async () => {
    process.env.CRYPTOCOMPARE_API_KEY = "test-key";
    marketService = new MarketService();
    vi.mocked(mapping.getAssetMetadata).mockReturnValue({
      ...mockMeta,
      supportedProviders: ["coinbase", "coingecko", "cryptocompare"],
    });
    const cb = (marketService as unknown as { coinbase: { getCurrentPrice: unknown } }).coinbase;
    const cg = (marketService as unknown as { coingecko: { getCurrentPrice: unknown } }).coingecko;
    const cc = (marketService as unknown as { cryptocompare: { getCurrentPrice: unknown } }).cryptocompare;
    vi.spyOn(cb, "getCurrentPrice").mockRejectedValue(new Error("Coinbase sin par"));
    vi.spyOn(cg, "getCurrentPrice").mockRejectedValue(new Error("CoinGecko rate limit"));
    vi.spyOn(cc, "getCurrentPrice").mockResolvedValue(47_500);

    const result = await marketService.getCurrentPrice("BTC");

    expect(result).toMatchObject({ price: 47_500, state: "live", provider: "cryptocompare" });
    delete process.env.CRYPTOCOMPARE_API_KEY;
  }, 15000);

  test("CoinGecko - Historical Prices filtra 1h correctamente", async () => {
    const now = Date.now();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        prices: [
          [now - 2 * 60 * 60 * 1000, 40000], // Hace 2 horas
          [now - 30 * 60 * 1000, 41000],     // Hace 30 min
          [now, 42000]                       // Ahora
        ]
      })
    });
    const cg = new CoinGeckoProvider();
    const history = await cg.getHistoricalPrices(mockMeta, "1h");
    expect(history.length).toBe(2);
    expect(history[0].price).toBe(41000);
    expect(history.every((point) => point.timestamp >= now - 60 * 60 * 1000)).toBe(true);
  });

  test("Coinbase - Historical Prices usa la resolución real de cada timeframe", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    });
    const cb = new CoinbaseProvider();

    await cb.getHistoricalPrices(mockMeta, "24h");
    expect(global.fetch).toHaveBeenLastCalledWith(expect.stringContaining("granularity=900"), expect.anything());

    await cb.getHistoricalPrices(mockMeta, "7d");
    expect(global.fetch).toHaveBeenLastCalledWith(expect.stringContaining("granularity=3600"), expect.anything());

    await cb.getHistoricalPrices(mockMeta, "30d");
    expect(global.fetch).toHaveBeenLastCalledWith(expect.stringContaining("granularity=21600"), expect.anything());
  });

  test("CoinGecko - Historical Prices periodos mapean bien (7d)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ prices: [] })
    });
    const cg = new CoinGeckoProvider();
    await cg.getHistoricalPrices(mockMeta, "7d");
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("days=7"), expect.anything());
  });

  test("CryptoCompare - current price y fuente trazable", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ EUR: 47500 }),
    });
    const provider = new CryptoCompareProvider("test-key");
    const price = await provider.getCurrentPrice(mockMeta);
    expect(price).toBe(47500);
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/data/price?"), expect.anything());
  });

  test("CryptoCompare - historical 24h usa minutos agregados de 15m", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        Data: {
          Data: [
            { time: 1_000, close: 100 },
            { time: 2_000, close: 105 },
          ],
        },
      }),
    });
    const provider = new CryptoCompareProvider("test-key");
    const history = await provider.getHistoricalPrices(mockMeta, "24h");
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ timestamp: 1_000_000, price: 100, source: "cryptocompare", confidence: 0.85 });
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/data/v2/histominute?"), expect.anything());
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("aggregate=15"), expect.anything());
  });

  test("Respuesta inválida / Activo inexistente", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404
    });
    const cg = new CoinGeckoProvider();
    await expect(cg.getCurrentPrice(mockMeta)).rejects.toThrow();
  });

  test("SUI usa CoinGecko si Coinbase no tiene SUI-EUR", async () => {
    vi.mocked(mapping.getAssetMetadata).mockReturnValue({
      ...mockMeta,
      internalId: "SUI",
      cryptoControlId: "SUI",
      symbol: "SUI",
      coinGeckoId: "sui",
      coinbaseProductId: "SUI-EUR",
    });

    const cb = (marketService as unknown as { coinbase: { getCurrentPrice: unknown } }).coinbase;
    const cg = (marketService as unknown as { coingecko: { getCurrentPrice: unknown } }).coingecko;
    vi.spyOn(cb, "getCurrentPrice").mockRejectedValue(new MarketNotFoundError("SUI-EUR no existe en Coinbase"));
    vi.spyOn(cg, "getCurrentPrice").mockResolvedValue(2.35);

    const result = await marketService.getCurrentPrice("SUI");

    expect(result).toMatchObject({ price: 2.35, state: "live", provider: "coingecko" });
  });

  test("SEI usa histórico de CoinGecko si Coinbase devuelve datos insuficientes", async () => {
    vi.mocked(mapping.getAssetMetadata).mockReturnValue({
      ...mockMeta,
      internalId: "SEI",
      cryptoControlId: "SEI",
      symbol: "SEI",
      coinGeckoId: "sei-network",
      coinbaseProductId: "SEI-EUR",
    });

    const cb = (marketService as unknown as { coinbase: { getHistoricalPrices: unknown } }).coinbase;
    const cg = (marketService as unknown as { coingecko: { getHistoricalPrices: unknown } }).coingecko;
    vi.spyOn(cb, "getHistoricalPrices").mockResolvedValue([]);
    vi.spyOn(cg, "getHistoricalPrices").mockResolvedValue([
      { timestamp: 1_000, price: 0.1 },
      { timestamp: 2_000, price: 0.12 },
    ]);

    const result = await marketService.getHistoricalPrices("SEI", "24h");

    expect(result.provider).toBe("coingecko");
    expect(result.points).toHaveLength(2);
    expect(result.points[0]).toMatchObject({ source: "coingecko", confidence: 0.9 });
  });

  test("MarketService - usa último precio válido en caché si todas las fuentes fallan", async () => {
    const cache: MarketCacheRepository = {
      getCurrentPrice: vi.fn().mockResolvedValue({ price: 47_000, fetchedAt: Date.now() - 10 * 60_000, provider: "coingecko" }),
      saveCurrentPrice: vi.fn(),
      getHistoricalPrices: vi.fn(),
      saveHistoricalPrices: vi.fn(),
    };
    marketService = new MarketService(cache);
    vi.mocked(mapping.getAssetMetadata).mockReturnValue(mockMeta);

    const cb = (marketService as unknown as { coinbase: { getCurrentPrice: unknown } }).coinbase;
    const cg = (marketService as unknown as { coingecko: { getCurrentPrice: unknown } }).coingecko;
    vi.spyOn(cb, "getCurrentPrice").mockRejectedValue(new MarketNotFoundError("Coinbase sin par"));
    vi.spyOn(cg, "getCurrentPrice").mockRejectedValue(new MarketNotFoundError("CoinGecko sin dato"));

    const result = await marketService.getCurrentPrice("BTC");

    expect(result).toMatchObject({ price: 47_000, state: "cached", provider: "coingecko" });
    expect(result.reason).toMatch(/Caché local/);
  });

  test("MarketService - usa último histórico válido en caché si todas las fuentes fallan", async () => {
    const stalePoints = [
      { timestamp: 1_000, price: 1.1, source: "coingecko", confidence: 0.9 },
      { timestamp: 2_000, price: 1.2, source: "coingecko", confidence: 0.9 },
    ];
    const cache: MarketCacheRepository = {
      getCurrentPrice: vi.fn(),
      saveCurrentPrice: vi.fn(),
      getHistoricalPrices: vi.fn().mockImplementation((_assetId: string, _quoteCurrency: string, _period: string, options?: { allowStale?: boolean }) => options?.allowStale ? stalePoints : null),
      saveHistoricalPrices: vi.fn(),
    };
    marketService = new MarketService(cache);
    vi.mocked(mapping.getAssetMetadata).mockReturnValue(mockMeta);

    const cb = (marketService as unknown as { coinbase: { getHistoricalPrices: unknown } }).coinbase;
    const cg = (marketService as unknown as { coingecko: { getHistoricalPrices: unknown } }).coingecko;
    vi.spyOn(cb, "getHistoricalPrices").mockRejectedValue(new MarketNotFoundError("Coinbase sin histórico"));
    vi.spyOn(cg, "getHistoricalPrices").mockRejectedValue(new MarketNotFoundError("CoinGecko sin histórico"));

    const result = await marketService.getHistoricalPrices("BTC", "24h");

    expect(result.provider).toBe("coingecko");
    expect(result.cacheStatus).toBe("stale");
    expect(result.isCached).toBe(true);
    expect(result.points).toEqual(stalePoints);
  });

  test("MarketService - recorta caché histórica a la ventana solicitada", async () => {
    const now = Date.now();
    const cachedPoints = [
      { timestamp: now - 2 * 60 * 60 * 1000, price: 100, source: "coingecko", confidence: 0.9 },
      { timestamp: now - 30 * 60 * 1000, price: 101, source: "coingecko", confidence: 0.9 },
      { timestamp: now, price: 102, source: "coingecko", confidence: 0.9 },
    ];
    const cache: MarketCacheRepository = {
      getCurrentPrice: vi.fn(),
      saveCurrentPrice: vi.fn(),
      getHistoricalPrices: vi.fn().mockResolvedValue(cachedPoints),
      saveHistoricalPrices: vi.fn(),
    };
    marketService = new MarketService(cache);
    vi.mocked(mapping.getAssetMetadata).mockReturnValue(mockMeta);

    const result = await marketService.getHistoricalPrices("BTC", "1h");

    expect(result.isCached).toBe(true);
    expect(result.points).toHaveLength(2);
    expect(result.points[0].price).toBe(101);
    expect(result.points.every((point) => point.timestamp >= now - 60 * 60 * 1000)).toBe(true);
  });

  test("MarketService - deduplica llamadas paralelas al mismo precio", async () => {
    vi.mocked(mapping.getAssetMetadata).mockReturnValue({
      ...mockMeta,
      internalId: "SUI",
      cryptoControlId: "SUI",
      symbol: "SUI",
      coinGeckoId: "sui",
      coinbaseProductId: "SUI-EUR",
    });

    const cb = (marketService as unknown as { coinbase: { getCurrentPrice: unknown } }).coinbase;
    const cg = (marketService as unknown as { coingecko: { getCurrentPrice: unknown } }).coingecko;
    const cbSpy = vi.spyOn(cb, "getCurrentPrice").mockRejectedValue(new MarketNotFoundError("SUI-EUR no existe"));
    const cgSpy = vi.spyOn(cg, "getCurrentPrice").mockResolvedValue(2.4);

    const [first, second] = await Promise.all([
      marketService.getCurrentPrice("SUI"),
      marketService.getCurrentPrice("SUI"),
    ]);

    expect(first.price).toBe(2.4);
    expect(second.price).toBe(2.4);
    expect(cbSpy).toHaveBeenCalledTimes(1);
    expect(cgSpy).toHaveBeenCalledTimes(1);
  });
});
