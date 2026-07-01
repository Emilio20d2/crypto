import type {
  PerspectivesPricePath,
  PerspectivesSourceEvidence,
} from "../domain/types";

export interface PriceManifestValidation {
  valid: boolean;
  errors: string[];
  activeSourceCount: number;
  independentPublisherCount: number;
  assetsCovered: string[];
  monthsCovered: string[];
}

function monthRange(startDate: number, endDate: number): string[] {
  const output: string[] = [];
  const cursor = new Date(startDate);
  cursor.setUTCDate(1);
  cursor.setUTCHours(0, 0, 0, 0);
  cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  while (cursor.getTime() <= endDate) {
    output.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return output;
}

export function validatePriceAndSourceManifest(input: {
  path: PerspectivesPricePath;
  requiredAssetIds: string[];
  startDate: number;
  endDate: number;
  sources: PerspectivesSourceEvidence[];
}): PriceManifestValidation {
  const errors: string[] = [];
  const requiredMonths = monthRange(input.startDate, input.endDate);
  const pointMap = new Map<string, number>();

  for (const point of input.path.points) {
    const key = `${point.assetId}:${point.month}`;
    if (!(point.priceEur > 0) || point.coverage === "INVALID") {
      errors.push(`INVALID_PRICE_PATH:${point.assetId}:${point.month}`);
      continue;
    }
    if (pointMap.has(key)) errors.push(`DUPLICATE_PRICE_POINT:${point.assetId}:${point.month}`);
    pointMap.set(key, point.priceEur);
  }

  for (const assetId of [...new Set(input.requiredAssetIds)]) {
    for (const month of requiredMonths) {
      if (!pointMap.has(`${assetId}:${month}`)) errors.push(`MISSING_PRICE_POINT:${assetId}:${month}`);
    }
  }

  const activeSources = input.sources.filter((source) => source.status === "ACTIVE_IN_ENGINE" && source.usedInEngine);
  const independentPublications = new Set(
    activeSources.map((source) => source.independentPublicationId ?? `${source.publisher}:${source.originalUrl ?? source.id}`),
  );

  if (activeSources.length === 0) errors.push("NO_ACTIVE_ENGINE_SOURCES");
  if (activeSources.some((source) => source.expiresAt != null && source.expiresAt < input.startDate)) {
    errors.push("EXPIRED_SOURCE_IN_ENGINE");
  }

  return {
    valid: errors.length === 0,
    errors,
    activeSourceCount: activeSources.length,
    independentPublisherCount: independentPublications.size,
    assetsCovered: [...new Set(input.path.points.map((point) => point.assetId))].sort(),
    monthsCovered: [...new Set(input.path.points.map((point) => point.month))].sort(),
  };
}
