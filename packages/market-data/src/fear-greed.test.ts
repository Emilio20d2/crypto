import { describe, expect, test } from "vitest";
import { FearGreedService, parseAlternativeMeFearGreed } from "./fear-greed";

const payload = {
  name: "Fear and Greed Index",
  data: [
    {
      value: "20",
      value_classification: "Extreme Fear",
      timestamp: "1781481600",
      time_until_update: "57746",
    },
  ],
  metadata: { error: null },
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    statusText: status === 200 ? "OK" : "Upstream Error",
    headers: { "content-type": "application/json" },
  });
}

describe("Fear & Greed alternative.me", () => {
  test("parsea correctamente la respuesta de alternative.me", () => {
    const parsed = parseAlternativeMeFearGreed(payload, 1_000);
    expect(parsed.value).toBe(20);
    expect(parsed.label).toBe("Extreme Fear");
    expect(parsed.timestamp).toBe(1_781_481_600_000);
    expect(parsed.fetchedAt).toBe(1_000);
    expect(parsed.source).toBe("alternative.me");
  });

  test("usa fallback con el último valor válido si falla la red", async () => {
    let now = 1_000;
    let calls = 0;
    const service = new FearGreedService({
      ttlMs: 10,
      now: () => now,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return jsonResponse(payload);
        throw new Error("Network timeout");
      },
    });

    const live = await service.get();
    expect(live.state).toBe("live");
    expect(live.value).toBe(20);

    now = 20_000;
    const fallback = await service.get();
    expect(fallback.state).toBe("fallback");
    expect(fallback.isCached).toBe(true);
    expect(fallback.value).toBe(20);
    expect(fallback.error).toBe("Network timeout");
  });

  test("devuelve error controlado si no existe último valor válido", async () => {
    const service = new FearGreedService({
      fetchImpl: async () => {
        throw new Error("DNS failure");
      },
    });

    const result = await service.get();
    expect(result.state).toBe("unavailable");
    expect(result.value).toBeNull();
    expect(result.label).toBe("No disponible");
    expect(result.source).toBe("alternative.me");
    expect(result.error).toBe("DNS failure");
  });
});
