export type PricePoint = { time: number; value: number };

export function computePeriodChange(points: PricePoint[]): number | null {
  const valid = points.filter((p) => Number.isFinite(p.value) && p.value > 0);
  if (valid.length < 2) return null;
  const first = valid[0].value;
  const last = valid[valid.length - 1].value;
  if (!first) return null;
  return ((last - first) / first) * 100;
}

export interface RankedAsset {
  assetId: string;
  changePercent: number;
}

export function rankByPriceChange(
  changes: Record<string, number | null>,
  order: "gainers" | "losers",
  topN = 8
): RankedAsset[] {
  return Object.entries(changes)
    .filter((entry): entry is [string, number] => entry[1] !== null && Number.isFinite(entry[1]))
    .filter(([, v]) => order === "gainers" ? v > 0 : v < 0)
    .sort(([, a], [, b]) => order === "gainers" ? b - a : a - b)
    .slice(0, topN)
    .map(([assetId, changePercent]) => ({ assetId, changePercent }));
}

export function computeRelativeStrength(
  changes: Record<string, number | null>
): Record<string, number | null> {
  const valid = Object.values(changes).filter((v): v is number => v !== null && Number.isFinite(v));
  if (valid.length === 0) return Object.fromEntries(Object.keys(changes).map((k) => [k, null]));
  const avg = valid.reduce((s, v) => s + v, 0) / valid.length;
  return Object.fromEntries(Object.entries(changes).map(([id, v]) => [id, v !== null ? v - avg : null]));
}

export function fearGreedLabel(value: number): string {
  if (value <= 25) return "Miedo Extremo";
  if (value <= 45) return "Miedo";
  if (value <= 55) return "Neutral";
  if (value <= 75) return "Codicia";
  return "Codicia Extrema";
}

export function fearGreedColor(value: number): string {
  if (value <= 25) return "var(--color-danger)";
  if (value <= 45) return "#b7791f";
  if (value <= 55) return "var(--text-secondary)";
  if (value <= 75) return "var(--color-success-text)";
  return "var(--color-success-text)";
}
