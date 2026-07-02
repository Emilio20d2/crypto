import { describe, expect, it } from "vitest";
import {
  buildAnnualScenarioConsensus,
  buildMonthlyPricePathFromConsensus,
  type VerifiedForecastObservation,
} from "./data/annual-consensus";
import { validatePriceAndSourceManifest } from "./data/price-manifest";
import type { PerspectivesSourceEvidence } from "./domain/types";

const START = Date.UTC(2026, 0, 15);
const END = Date.UTC(2028, 11, 31);
const ASSETS = ["BTC", "ETH", "SUI"];

function observations(): VerifiedForecastObservation[] {
  return ASSETS.flatMap((assetId, assetIndex) => {
    const base = assetId === "BTC" ? 100_000 : assetId === "ETH" ? 5_000 : 5;
    return [2026, 2027, 2028].flatMap((year, yearIndex) =>
      [0.82, 1, 1.28].map((multiplier, sourceIndex) => ({
        id: `${assetId}-${year}-${sourceIndex}`,
        assetId,
        publisher: `${assetId} Publisher ${sourceIndex}`,
        sourceId: `${assetId}-source-${sourceIndex}`,
        targetYear: year,
        priceEur: base * Math.pow(1.18 + assetIndex * 0.02, yearIndex) * multiplier,
        finalWeight: 1 + sourceIndex * 0.2,
        verified: true as const,
        publishedAt: START,
        expiresAt: END,
        methodology: "fixture verified observation",
      })),
    );
  });
}

function sources(): PerspectivesSourceEvidence[] {
  return observations().map((observation) => ({
    id: observation.sourceId,
    name: observation.publisher,
    category: "institutional",
    status: "ACTIVE_IN_ENGINE",
    publisher: observation.publisher,
    originalUrl: `https://example.invalid/${observation.sourceId}`,
    publishedAt: observation.publishedAt,
    retrievedAt: START,
    expiresAt: END,
    assetIds: [observation.assetId],
    independentPublicationId: observation.sourceId,
    reliability: observation.finalWeight,
    usedInEngine: true,
  }));
}

describe("Perspectives V5 annual consensus and monthly paths", () => {
  it("builds ordered five-scenario annual consensus for every asset and year", () => {
    const consensus = buildAnnualScenarioConsensus({
      observations: observations(),
      assetIds: ASSETS,
      startYear: 2026,
      endYear: 2028,
    });

    expect(consensus).toHaveLength(ASSETS.length * 3 * 5);
    for (const assetId of ASSETS) {
      for (const year of [2026, 2027, 2028]) {
        const row = consensus.filter((item) => item.assetId === assetId && item.year === year);
        const ordered = ["conservador", "moderado", "base", "favorable", "optimista"].map((scenario) =>
          row.find((item) => item.scenario === scenario)!.priceEur
        );
        expect(ordered[0]).toBeLessThanOrEqual(ordered[1]);
        expect(ordered[1]).toBeLessThanOrEqual(ordered[2]);
        expect(ordered[2]).toBeLessThanOrEqual(ordered[3]);
        expect(ordered[3]).toBeLessThanOrEqual(ordered[4]);
        expect(row.every((item) => item.coverage === "DIRECT")).toBe(true);
      }
    }
  });

  it("builds a complete monthly matrix without flat carry-forward prices", () => {
    const consensus = buildAnnualScenarioConsensus({
      observations: observations(),
      assetIds: ASSETS,
      startYear: 2026,
      endYear: 2028,
    });
    const path = buildMonthlyPricePathFromConsensus({
      assetIds: ASSETS,
      scenario: "base",
      pathId: "base-path-fixture",
      startDate: START,
      endDate: END,
      currentPricesEur: { BTC: 90_000, ETH: 4_000, SUI: 3 },
      annualConsensus: consensus,
      sources: sources(),
    });

    const validation = validatePriceAndSourceManifest({
      path,
      requiredAssetIds: ASSETS,
      startDate: START,
      endDate: END,
      sources: sources(),
    });
    expect(validation.valid).toBe(true);
    expect(validation.assetsCovered).toEqual(ASSETS);
    expect(new Set(path.points.map((point) => point.month)).size).toBe(35);
    for (const assetId of ASSETS) {
      const assetPrices = path.points.filter((point) => point.assetId === assetId).map((point) => point.priceEur);
      expect(new Set(assetPrices.map((price) => price.toFixed(6))).size).toBeGreaterThan(10);
    }
  });

  it("blocks assets without at least three independent verified observations", () => {
    expect(() => buildAnnualScenarioConsensus({
      observations: observations().filter((observation) => observation.assetId !== "SUI"),
      assetIds: ["SUI"],
      startYear: 2026,
      endYear: 2028,
    })).toThrow(/INSUFFICIENT_FORECAST_OBSERVATIONS:SUI/);
  });
});
