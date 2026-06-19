import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

describe("setupApi HTTP fallback", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
    delete (window as any).cryptoControl;
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: "ok" }), { status: 200 })) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete (window as any).cryptoControl;
    vi.restoreAllMocks();
  });

  test("expone Perspectivas y handlers avanzados igual que preload", async () => {
    await import("./setupApi");

    expect(typeof window.cryptoControl.perspectives.getProjection).toBe("function");
    expect(typeof window.cryptoControl.perspectives.getConsolidatedSnapshot).toBe("function");
    expect(typeof window.cryptoControl.partialSaleRules.evaluate).toBe("function");
    expect(typeof window.cryptoControl.rebuyTiers.evaluate).toBe("function");
    expect(typeof window.cryptoControl.planMonitoring.getSummary).toBe("function");

    await window.cryptoControl.perspectives.getProjection({ horizonYears: 5 });

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      channel: "perspectives:getProjection",
      args: [{ horizonYears: 5 }],
    });
  });
});
