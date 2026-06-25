import { describe, it, expect } from "vitest";
import {
  observationToForecastSources, computeCoverageMatrix, computeFinalWeight,
  MIN_SOURCES_FOR_QUANTILE, type ObservationRow,
} from "./forecast-repository";
import { SEED_FORECAST_OBSERVATIONS, SEED_FORECAST_SOURCES } from "./forecast-seed";

const NOW = new Date("2026-06-25").getTime();

function makeObs(overrides: Partial<ObservationRow> = {}): ObservationRow {
  return {
    id: "test-obs-1",
    source_id: "ark-invest",
    asset_id: "bitcoin",
    ticker: "BTC",
    publisher: "ARK Invest",
    report_title: "Test Report",
    original_url: "https://example.com/report",
    source_type: "asset_manager",
    published_at: NOW - 30 * 24 * 3600 * 1000,
    expires_at: NOW + 365 * 24 * 3600 * 1000,
    target_year: 2030,
    target_type: "point",
    original_currency: "USD",
    target_low_original: null,
    target_base_original: 710_000,
    target_high_original: null,
    fx_rate: 0.92,
    final_weight: 0.85,
    verified: 1,
    active: 1,
    ...overrides,
  };
}

describe("observationToForecastSources", () => {
  it("devuelve [] si active=0", () => {
    const obs = makeObs({ active: 0 });
    expect(observationToForecastSources(obs)).toHaveLength(0);
  });

  it("devuelve 1 ForecastSource para targetType=point", () => {
    const obs = makeObs({ target_type: "point", target_base_original: 710_000 });
    const sources = observationToForecastSources(obs);
    expect(sources).toHaveLength(1);
    expect(sources[0].targetPriceUsd).toBeCloseTo(710_000); // USD ya
    expect(sources[0].assetId).toBe("bitcoin");
    expect(sources[0].targetYear).toBe(2030);
  });

  it("devuelve 3 ForecastSources para targetType=low_base_high", () => {
    const obs = makeObs({
      target_type: "low_base_high",
      target_low_original: 300_000,
      target_base_original: 710_000,
      target_high_original: 1_500_000,
    });
    const sources = observationToForecastSources(obs);
    expect(sources).toHaveLength(3);
    const ids = sources.map(s => s.id);
    expect(ids).toContain("test-obs-1_low");
    expect(ids).toContain("test-obs-1_base");
    expect(ids).toContain("test-obs-1_high");
    const prices = sources.map(s => s.targetPriceUsd).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(prices[0]).toBeCloseTo(300_000);
    expect(prices[1]).toBeCloseTo(710_000);
    expect(prices[2]).toBeCloseTo(1_500_000);
  });

  it("devuelve 2 ForecastSources para targetType=range", () => {
    const obs = makeObs({
      target_type: "range",
      target_low_original: 300_000,
      target_high_original: 500_000,
    });
    const sources = observationToForecastSources(obs);
    expect(sources).toHaveLength(2);
  });

  it("convierte EUR a USD si original_currency=EUR", () => {
    const obs = makeObs({
      target_type: "point",
      original_currency: "EUR",
      target_base_original: 92_000, // 92k EUR → 100k USD con fx=0.92
      fx_rate: 0.92,
    });
    const sources = observationToForecastSources(obs);
    expect(sources[0].targetPriceUsd).toBeCloseTo(92_000 / 0.92, 0);
  });

  it("respeta expiresAt de la observación si está presente", () => {
    const customExpiry = NOW + 2 * 365 * 24 * 3600 * 1000;
    const obs = makeObs({ expires_at: customExpiry });
    const sources = observationToForecastSources(obs);
    expect(sources[0].expiresAt).toBe(customExpiry);
  });

  it("calcula expiresAt como 1 enero del año siguiente si expires_at es null", () => {
    const obs = makeObs({ expires_at: null, target_year: 2030 });
    const sources = observationToForecastSources(obs);
    const expected = new Date(2031, 0, 1).getTime();
    expect(sources[0].expiresAt).toBe(expected);
  });
});

describe("computeCoverageMatrix", () => {
  it("devuelve cobertura insuficiente cuando hay menos de 3 fuentes independientes", () => {
    const rows: ObservationRow[] = [
      makeObs({ id: "a", publisher: "ARK Invest" }),
      makeObs({ id: "b", publisher: "ARK Invest" }), // mismo publisher → 1 única fuente
    ];
    const coverage = computeCoverageMatrix(rows);
    expect(coverage).toHaveLength(1);
    expect(coverage[0].sufficient).toBe(false);
    expect(coverage[0].sourceCount).toBe(1);
  });

  it("marca cobertura suficiente con 3+ fuentes independientes", () => {
    const rows: ObservationRow[] = [
      makeObs({ id: "a", publisher: "ARK Invest" }),
      makeObs({ id: "b", publisher: "VanEck" }),
      makeObs({ id: "c", publisher: "Bernstein" }),
    ];
    const coverage = computeCoverageMatrix(rows);
    expect(coverage[0].sufficient).toBe(true);
    expect(coverage[0].sourceCount).toBe(3);
  });

  it("agrupa por asset_id y target_year", () => {
    const rows: ObservationRow[] = [
      makeObs({ id: "a1", asset_id: "bitcoin",  ticker: "BTC", target_year: 2030, publisher: "ARK" }),
      makeObs({ id: "a2", asset_id: "bitcoin",  ticker: "BTC", target_year: 2030, publisher: "VanEck" }),
      makeObs({ id: "b1", asset_id: "ethereum", ticker: "ETH", target_year: 2030, publisher: "ARK" }),
    ];
    const coverage = computeCoverageMatrix(rows);
    expect(coverage).toHaveLength(2);
    const btcCov = coverage.find(c => c.assetId === "bitcoin");
    const ethCov = coverage.find(c => c.assetId === "ethereum");
    expect(btcCov?.sourceCount).toBe(2);
    expect(ethCov?.sourceCount).toBe(1);
  });

  it("ignora observaciones con active=0", () => {
    const rows: ObservationRow[] = [
      makeObs({ id: "a", publisher: "ARK", active: 0 }),
      makeObs({ id: "b", publisher: "VanEck", active: 1 }),
    ];
    const coverage = computeCoverageMatrix(rows);
    expect(coverage[0].sourceCount).toBe(1); // solo VanEck está activo
  });
});

describe("computeFinalWeight", () => {
  it("calcula peso > 0 para una observación estándar", () => {
    const w = computeFinalWeight({
      quality_score: 0.8,
      freshness_score: 0.9,
      horizon_score: 0.85,
      methodology_score: 0.75,
      independence_score: 0.8,
      verified: 1,
    });
    expect(w).toBeGreaterThan(0.5);
    expect(w).toBeLessThanOrEqual(1);
  });

  it("da mayor peso a observaciones verificadas", () => {
    const base = { quality_score: 0.7, freshness_score: 0.7, horizon_score: 0.7, methodology_score: 0.7, independence_score: 0.7 };
    const wUnverified = computeFinalWeight({ ...base, verified: 0 });
    const wVerified   = computeFinalWeight({ ...base, verified: 1 });
    expect(wVerified).toBeGreaterThan(wUnverified);
  });
});

describe("SEED_FORECAST_OBSERVATIONS", () => {
  it("tiene al menos 5 observaciones", () => {
    expect(SEED_FORECAST_OBSERVATIONS.length).toBeGreaterThanOrEqual(5);
  });

  it("todas las observaciones tienen IDs únicos", () => {
    const ids = SEED_FORECAST_OBSERVATIONS.map(o => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("las observaciones BTC 2030 generan al menos 3 puntos de precio", () => {
    const btcRows = SEED_FORECAST_OBSERVATIONS.filter(o => o.asset_id === "bitcoin" && o.target_year === 2030);
    const sources = btcRows.flatMap(r => observationToForecastSources(r));
    expect(sources.length).toBeGreaterThanOrEqual(3);
  });

  it("las observaciones ETH 2030 existen (3+ fuentes independientes)", () => {
    const ethRows = SEED_FORECAST_OBSERVATIONS.filter(o => o.asset_id === "ethereum" && o.target_year === 2030 && o.active);
    const coverage = computeCoverageMatrix(ethRows);
    const ethCov = coverage.find(c => c.assetId === "ethereum");
    // Spec: ETH 2030 debe tener >=3 fuentes para escenarios completos
    expect(ethCov?.sourceCount).toBeGreaterThanOrEqual(3);
  });

  it("no hay observaciones activas para SUI (cobertura insuficiente)", () => {
    const suiRows = SEED_FORECAST_OBSERVATIONS.filter(o => o.asset_id === "sui" && o.active);
    expect(suiRows).toHaveLength(0);
  });

  it("todas las observaciones tienen URLs no vacías", () => {
    for (const o of SEED_FORECAST_OBSERVATIONS) {
      expect(o.original_url).toBeTruthy();
      expect(o.original_url.startsWith("http")).toBe(true);
    }
  });

  it("ninguna observación tiene target_year en el pasado (< 2026)", () => {
    const pastObs = SEED_FORECAST_OBSERVATIONS.filter(o => o.active && o.target_year < 2026);
    expect(pastObs).toHaveLength(0);
  });
});

describe("SEED_FORECAST_SOURCES", () => {
  it("contiene 25 fuentes", () => {
    expect(SEED_FORECAST_SOURCES.length).toBe(25);
  });

  it("todas las fuentes tienen IDs únicos", () => {
    const ids = SEED_FORECAST_SOURCES.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("las fuentes RSS tienen rss_url", () => {
    const rssSources = SEED_FORECAST_SOURCES.filter(s => s.method === "rss");
    for (const s of rssSources) {
      expect(s.rss_url).toBeTruthy();
    }
  });
});

describe("Integración: seed → ForecastSource[] → buildExternalPriceMap", () => {
  it("genera precios de simulación para BTC 2030 con datos de seed", async () => {
    const { buildExternalPriceMap } = await import("./external-price-builder");
    const btcRows = SEED_FORECAST_OBSERVATIONS.filter(o => o.asset_id === "bitcoin" && o.active);
    const sources = btcRows.flatMap(r => observationToForecastSources(r));
    expect(sources.length).toBeGreaterThan(0);

    const nowMs = NOW;
    const horizonMs = new Date("2031-01-01").getTime();
    const currentBtcEur = 85_000;

    const result = buildExternalPriceMap("BTC", currentBtcEur, "base", nowMs, horizonMs, sources);
    // Debe tener precios para 2030
    const dec2030 = "2030-12";
    expect(result.pricesByMonth[dec2030]).toBeDefined();
    expect(result.pricesByMonth[dec2030]).toBeGreaterThan(currentBtcEur);
    expect(result.directYears).toContain(2030);
  });

  it("escenario optimista > base > conservador para BTC con datos reales", async () => {
    const { buildExternalPriceMap } = await import("./external-price-builder");
    const btcRows = SEED_FORECAST_OBSERVATIONS.filter(o => o.asset_id === "bitcoin" && o.active);
    const sources = btcRows.flatMap(r => observationToForecastSources(r));

    const nowMs = NOW;
    const horizonMs = new Date("2031-01-01").getTime();
    const currentBtcEur = 85_000;

    const resultOpt  = buildExternalPriceMap("BTC", currentBtcEur, "optimista",   nowMs, horizonMs, sources);
    const resultBase = buildExternalPriceMap("BTC", currentBtcEur, "base",        nowMs, horizonMs, sources);
    const resultCons = buildExternalPriceMap("BTC", currentBtcEur, "conservador", nowMs, horizonMs, sources);

    const p = (r: typeof resultOpt) => r.pricesByMonth["2030-12"] ?? 0;
    expect(p(resultOpt)).toBeGreaterThan(p(resultBase));
    expect(p(resultBase)).toBeGreaterThan(p(resultCons));
  });
});
