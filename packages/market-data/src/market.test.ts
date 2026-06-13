import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { CoinbaseProvider } from "./coinbase";
import { CoinGeckoProvider } from "./coingecko";
import { MarketService } from "./index";

const originalFetch = global.fetch;

describe("Market Providers y Resiliencia", () => {
  let marketService: MarketService;
  
  beforeEach(() => {
    marketService = new MarketService();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("Coinbase - Fetch current price (success)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { amount: "50000.50" } })
    });
    const cb = new CoinbaseProvider();
    const price = await cb.getCurrentPrice("bitcoin", "EUR");
    expect(price).toBe(50000.50);
  });

  test("CoinGecko - Fetch current price (success)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ bitcoin: { eur: 49000.00 } })
    });
    const cg = new CoinGeckoProvider();
    const price = await cg.getCurrentPrice("bitcoin", "eur");
    expect(price).toBe(49000.00);
  });

  test("MarketService - Fallback a CoinGecko si Coinbase falla (Timeout o 500)", async () => {
    const cb = (marketService as any).coinbase;
    vi.spyOn(cb, "getCurrentPrice").mockRejectedValue(new Error("Timeout simulado"));
    
    const cg = (marketService as any).coingecko;
    vi.spyOn(cg, "getCurrentPrice").mockResolvedValue(48000.00);

    const price = await marketService.getCurrentPrice("bitcoin", "EUR");
    
    expect(cb.getCurrentPrice).toHaveBeenCalled();
    expect(cg.getCurrentPrice).toHaveBeenCalled();
    expect(price).toBe(48000.00);
  });

  test("MarketService - Rate limit / Fallo total no rompe en blanco (Lanza error recuperable)", async () => {
    const cb = (marketService as any).coinbase;
    vi.spyOn(cb, "getCurrentPrice").mockRejectedValue(new Error("Rate limit 429 Coinbase"));
    
    const cg = (marketService as any).coingecko;
    vi.spyOn(cg, "getCurrentPrice").mockRejectedValue(new Error("Rate limit 429 CoinGecko"));

    await expect(marketService.getCurrentPrice("bitcoin", "EUR")).rejects.toThrow("Rate limit 429 CoinGecko");
  });

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
    const history = await cg.getHistoricalPrices("bitcoin", "1h", "eur");
    expect(history.length).toBe(2); // Solo los ultimos 60 min
    expect(history[0].price).toBe(41000);
  });

  test("CoinGecko - Historical Prices periodos mapean bien (7d)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ prices: [] })
    });
    const cg = new CoinGeckoProvider();
    await cg.getHistoricalPrices("bitcoin", "7d", "eur");
    // Verify it called with days=7
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("days=7"));
  });

  test("Respuesta inválida / Activo inexistente", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404
    });
    const cg = new CoinGeckoProvider();
    await expect(cg.getCurrentPrice("fake-coin", "eur")).rejects.toThrow();
  });
});
