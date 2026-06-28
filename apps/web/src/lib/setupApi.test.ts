import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

describe("setupApi HTTP fallback", () => {
  const originalFetch = globalThis.fetch;
  const originalEventSource = globalThis.EventSource;

  class FakeEventSource {
    static instances: FakeEventSource[] = [];
    listeners = new Map<string, (event: MessageEvent<string>) => void>();
    close = vi.fn();
    readonly url: string;

    constructor(url: string) {
      this.url = url;
      FakeEventSource.instances.push(this);
    }

    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      this.listeners.set(type, listener as (event: MessageEvent<string>) => void);
    }

    removeEventListener(type: string) {
      this.listeners.delete(type);
    }

    emit(type: string, data: string) {
      this.listeners.get(type)?.({ data } as MessageEvent<string>);
    }
  }

  beforeEach(() => {
    vi.resetModules();
    FakeEventSource.instances = [];
    delete (window as any).cryptoControl;
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: "ok" }), { status: 200 })) as typeof fetch;
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.stubGlobal("EventSource", originalEventSource);
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

  test("suscribe snapshots en tiempo real por SSE en navegador", async () => {
    await import("./setupApi");
    const received: unknown[] = [];

    const unsubscribe = window.cryptoControl.portfolio.onLiveSnapshot?.((snapshot) => {
      received.push(snapshot);
    });

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe("http://localhost:3001/api/live-snapshot");

    FakeEventSource.instances[0].emit("snapshot", JSON.stringify({ snapshotVersion: "v1", totalAssetValueEur: 123 }));

    expect(received).toEqual([{ snapshotVersion: "v1", totalAssetValueEur: 123 }]);

    unsubscribe?.();
    expect(FakeEventSource.instances[0].close).toHaveBeenCalled();
  });
});
