import { describe, expect, it } from "vitest";
import {
  getPerspectivesSourceCatalogForAsset,
  PERSPECTIVES_V5_SOURCE_CATALOG,
  type PerspectiveForecastHorizon,
} from "./data/source-catalog";

const ASSETS = ["BTC", "ETH", "SUI"];
const HORIZONS: PerspectiveForecastHorizon[] = ["short", "medium", "long"];

describe("Perspectives V5 source catalog", () => {
  it("registers at least 15 independent sources per required asset with short, medium and long coverage", () => {
    for (const assetId of ASSETS) {
      const sources = getPerspectivesSourceCatalogForAsset(assetId);
      const independentIds = new Set(sources.map((source) => source.independentPublicationId ?? source.id));

      expect(sources.length).toBeGreaterThanOrEqual(15);
      expect(independentIds.size).toBe(sources.length);
      for (const horizon of HORIZONS) {
        expect(sources.filter((source) => source.horizon === horizon).length).toBeGreaterThanOrEqual(5);
      }
    }
  });

  it("does not mark registered sources as active engine observations before verification", () => {
    expect(PERSPECTIVES_V5_SOURCE_CATALOG.every((source) => source.usedInEngine === false)).toBe(true);
    expect(PERSPECTIVES_V5_SOURCE_CATALOG.every((source) => source.status === "REGISTERED_ONLY")).toBe(true);
    expect(PERSPECTIVES_V5_SOURCE_CATALOG.every((source) => source.originalUrl === null || source.originalUrl.startsWith("https://"))).toBe(true);
  });
});
