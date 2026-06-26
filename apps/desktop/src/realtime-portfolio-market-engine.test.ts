import { describe, expect, test, vi } from "vitest";
import {
  calculateLiveTotalAssetValue,
  RealtimePortfolioMarketEngine,
  type RealtimePortfolioMarketEngineDeps,
  type RealtimePortfolioSnapshot,
  type RealtimeWebSocket,
} from "./realtime-portfolio-market-engine";

class FakeWebSocket implements RealtimeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = 1;
  sent: string[] = [];
  closed = false;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  open(): void {
    this.onopen?.();
  }

  ticker(productId: string, price: number, time = "2026-06-26T12:00:00.000Z"): void {
    this.onmessage?.({ data: JSON.stringify({ product_id: productId, price: String(price), time }) });
  }
}

function waitForPublished(published: RealtimePortfolioSnapshot[], count = 1) {
  return vi.waitFor(() => {
    expect(published.length).toBeGreaterThanOrEqual(count);
  });
}

function makeDeps(overrides: Partial<RealtimePortfolioMarketEngineDeps> = {}) {
  let now = 1_782_475_000_000;
  const intervals: Array<{ handler: () => void; ms: number; cleared: boolean }> = [];
  const timeouts: Array<{ handler: () => void; ms: number; cleared: boolean }> = [];
  const published: RealtimePortfolioSnapshot[] = [];
  const logger = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const deps: RealtimePortfolioMarketEngineDeps = {
    now: () => now,
    setInterval: (handler, ms) => {
      const timer = { handler, ms, cleared: false };
      intervals.push(timer);
      return timer as unknown as ReturnType<typeof setTimeout>;
    },
    clearInterval: (timer) => {
      (timer as unknown as { cleared: boolean }).cleared = true;
    },
    setTimeout: (handler, ms) => {
      const timer = { handler, ms, cleared: false };
      timeouts.push(timer);
      return timer as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (timer) => {
      (timer as unknown as { cleared: boolean }).cleared = true;
    },
    getCoinbaseClient: () => ({
      getAccounts: async () => ({
        accounts: [
          { uuid: "btc-account", currency: "BTC", available_balance: { value: "0.5" }, hold: { value: "0.1" } },
          { uuid: "eur-account", currency: "EUR", available_balance: { value: "5" } },
          { uuid: "eurc-account", currency: "EURC", available_balance: { value: "3" } },
        ],
      }),
    }),
    getCachedPortfolioBreakdown: async () => ({ positions: [] }),
    getRestPrice: async (assetId) => ({ price: assetId === "BTC" ? 10 : null, state: "live", provider: "coinbase", fetchedAt: now }),
    publish: (snapshot) => published.push(snapshot),
    logger,
    ...overrides,
  };
  return {
    deps,
    published,
    intervals,
    timeouts,
    logger,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe("RealtimePortfolioMarketEngine", () => {
  test("publica una primera actualizacion inmediata y calcula total sin duplicar EURC", async () => {
    const ctx = makeDeps();
    const engine = new RealtimePortfolioMarketEngine(ctx.deps);

    engine.start("portfolio-1");
    await waitForPublished(ctx.published);

    expect(ctx.intervals.some((timer) => timer.ms === 5_000)).toBe(true);
    const snapshot = ctx.published[0];
    expect(snapshot.eurBalance).toBe(5);
    expect(snapshot.eurcBalance).toBe(3);
    expect(snapshot.cryptoValueEur).toBe(6);
    expect(snapshot.totalAssetValueEur).toBe(14);
    expect(calculateLiveTotalAssetValue(snapshot)).toBe(14);
    expect(snapshot.positions).toEqual([
      expect.objectContaining({ assetId: "BTC", quantity: 0.6, priceEur: 10, valueEur: 6 }),
    ]);
  });

  test("mezcla posiciones cacheadas ausentes en getAccounts, como ETH en staking", async () => {
    const ctx = makeDeps({
      getCachedPortfolioBreakdown: async () => ({
        positions: [
          { asset: "ETH", totalBalanceCrypto: 0.25, totalBalanceFiat: 500, isCash: false },
        ],
      }),
      getRestPrice: async (assetId) => ({ price: assetId === "BTC" ? 10 : 2_000, state: "live", provider: "coinbase", fetchedAt: 1_782_475_000_000 }),
    });
    const engine = new RealtimePortfolioMarketEngine(ctx.deps);

    engine.start("portfolio-1");
    await waitForPublished(ctx.published);

    const snapshot = ctx.published[0];
    expect(snapshot.positions.map((p) => p.assetId).sort()).toEqual(["BTC", "ETH"]);
    expect(snapshot.positions.find((p) => p.assetId === "ETH")).toEqual(
      expect.objectContaining({ quantity: 0.25, valueEur: 500 }),
    );
    expect(snapshot.totalAssetValueEur).toBe(514);
  });

  test("evita peticiones simultaneas y registra ticks omitidos", async () => {
    let resolveAccounts: (value: { accounts: unknown[] }) => void = () => {};
    const getAccounts = vi.fn(() => new Promise<{ accounts: unknown[] }>((resolve) => {
      resolveAccounts = resolve;
    }));
    const ctx = makeDeps({
      getCoinbaseClient: () => ({ getAccounts }),
    });
    const engine = new RealtimePortfolioMarketEngine(ctx.deps);

    engine.start("portfolio-1");
    const skipped = await engine.refreshNow("manual-overlap");

    expect(skipped).toBeNull();
    expect(getAccounts).toHaveBeenCalledTimes(1);
    resolveAccounts({
      accounts: [
        { uuid: "btc-account", currency: "BTC", available_balance: { value: "1" } },
      ],
    });
    await waitForPublished(ctx.published);

    expect(ctx.published[0].skippedTicks).toBe(1);
  });

  test("si Coinbase falla conserva el ultimo snapshot valido como cache", async () => {
    const getAccounts = vi
      .fn()
      .mockResolvedValueOnce({ accounts: [{ uuid: "btc-account", currency: "BTC", available_balance: { value: "1" } }] })
      .mockRejectedValueOnce(new Error("coinbase down"));
    const ctx = makeDeps({
      getCoinbaseClient: () => ({ getAccounts }),
    });
    const engine = new RealtimePortfolioMarketEngine(ctx.deps);

    engine.start("portfolio-1");
    await waitForPublished(ctx.published);
    const first = ctx.published[0];
    const second = await engine.refreshNow("coinbase-down");

    expect(first?.totalAssetValueEur).toBe(10);
    expect(second?.totalAssetValueEur).toBe(10);
    expect(second?.usingFallback).toBe(true);
    expect(second?.balances.every((balance) => balance.source === "cache")).toBe(true);
    expect(second?.warnings.some((warning) => warning.includes("Balances unavailable"))).toBe(true);
  });

  test("usa precio WebSocket fresco antes que REST y cierra recursos al detenerse", async () => {
    const sockets: FakeWebSocket[] = [];
    const getRestPrice = vi.fn(async () => ({ price: 10, state: "live", provider: "coinbase-rest", fetchedAt: 1_782_475_000_000 }));
    const ctx = makeDeps({
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
      getRestPrice,
    });
    const engine = new RealtimePortfolioMarketEngine(ctx.deps);

    engine.start("portfolio-1");
    await waitForPublished(ctx.published);
    sockets[0].open();
    sockets[0].ticker("BTC-EUR", 123);
    const snapshot = await engine.refreshNow("ws-price");

    expect(sockets[0].sent.some((message) => message.includes("BTC-EUR"))).toBe(true);
    expect(snapshot?.prices.BTC).toEqual(expect.objectContaining({
      priceEur: 123,
      source: "coinbase-ws",
      state: "live",
    }));
    expect(snapshot?.socket.state).toBe("live");

    engine.stop();
    expect(ctx.intervals.every((timer) => timer.cleared)).toBe(true);
    expect(sockets[0].closed).toBe(true);
  });
});
