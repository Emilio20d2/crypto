import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { CoinbaseProvider } from "./coinbase";
import { CoinGeckoProvider } from "./coingecko";
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
    expect(history.length).toBe(3); // 1h param translates to 1 day on CoinGecko
    expect(history[0].price).toBe(40000);
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
    expect(result.reason).toMatch(/Último dato válido/);
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
