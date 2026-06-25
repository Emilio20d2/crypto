// ─── Repositorio de previsiones externas verificables ────────────────────────
// Fuente ÚNICA de previsiones para el motor de Perspectivas.
// Lee de forecast_observations (SQLite) y devuelve ForecastSource[].
// Una observación con targetType="low_base_high" se expande en 3 ForecastSource.

import type { ForecastSource } from "./forecast-sources";

// FX por defecto cuando la BD no tiene tasa actualizada (ECB promedio ~2025)
const FX_USD_TO_EUR_DEFAULT = 0.92;

export interface ObservationRow {
  id: string;
  source_id: string;
  asset_id: string;
  ticker: string;
  publisher: string;
  report_title: string;
  original_url: string;
  source_type: string;
  published_at: number;
  expires_at: number | null;
  target_year: number;
  target_type: string;
  original_currency: string;
  target_low_original: number | null;
  target_base_original: number | null;
  target_high_original: number | null;
  fx_rate: number | null;
  final_weight: number;
  verified: number;
  active: number;
}

export interface SourceRow {
  id: string;
  name: string;
  category: string;
  base_url: string;
  rss_url: string | null;
  method: string;
  check_frequency_hours: number;
  last_checked_at: number | null;
  last_success_at: number | null;
  consecutive_errors: number;
  status: string;
  priority: number;
  subscription_required: number;
  notes: string | null;
}

export interface IngestionLogRow {
  id: string;
  source_id: string;
  checked_at: number;
  status: string;
  new_items: number;
  items_scanned: number;
  error_message: string | null;
}

// Mínimo de fuentes independientes para generar escenarios por cuantil
export const MIN_SOURCES_FOR_QUANTILE = 3;

function toUsdFactor(currency: string, fxRate: number | null): number {
  if (currency === "USD") return 1;
  // EUR → USD: invierte la tasa EUR/USD
  const rate = fxRate ?? FX_USD_TO_EUR_DEFAULT;
  return 1 / rate;
}

export function computeFinalWeight(row: {
  quality_score: number;
  freshness_score: number;
  horizon_score: number;
  methodology_score: number;
  independence_score: number;
  verified: number;
}): number {
  const base =
    row.quality_score       * 0.30 +
    row.freshness_score     * 0.25 +
    row.horizon_score       * 0.20 +
    row.methodology_score   * 0.15 +
    row.independence_score  * 0.10;
  const verifiedBonus = row.verified ? 0.10 : 0;
  return Math.min(1, base + verifiedBonus);
}

// Dirección implícita: si hay varios precios en la observación, se usa el base.
function impliedDirection(priceUsd: number, refUsd: number): import("./forecast-sources").ForecastDirection {
  const mult = priceUsd / refUsd;
  if (mult > 5) return "very_bullish";
  if (mult > 2) return "bullish";
  if (mult > 0.8) return "neutral";
  if (mult > 0.5) return "bearish";
  return "very_bearish";
}

export function observationToForecastSources(row: ObservationRow, currentPriceUsd?: number): ForecastSource[] {
  if (!row.active) return [];

  const expiresAt = row.expires_at ?? new Date(row.target_year + 1, 0, 1).getTime();
  const toUsd = toUsdFactor(row.original_currency, row.fx_rate);
  const weight = row.final_weight;

  const base: Omit<ForecastSource, "id" | "targetPriceUsd" | "direction"> = {
    publisher: row.publisher,
    sourceType: row.source_type as import("./forecast-sources").ForecastSourceType,
    assetId: row.asset_id,
    targetYear: row.target_year,
    confidence: weight,
    publishedAt: row.published_at,
    expiresAt,
    notes: row.report_title,
  };

  const results: ForecastSource[] = [];

  if (row.target_type === "low_base_high") {
    const baseUsd = row.target_base_original != null ? row.target_base_original * toUsd : null;
    const lowUsd  = row.target_low_original  != null ? row.target_low_original  * toUsd : null;
    const highUsd = row.target_high_original != null ? row.target_high_original * toUsd : null;

    if (lowUsd != null) {
      results.push({
        ...base,
        id: `${row.id}_low`,
        targetPriceUsd: lowUsd,
        direction: currentPriceUsd ? impliedDirection(lowUsd, currentPriceUsd) : "bearish",
      });
    }
    if (baseUsd != null) {
      results.push({
        ...base,
        id: `${row.id}_base`,
        targetPriceUsd: baseUsd,
        direction: currentPriceUsd ? impliedDirection(baseUsd, currentPriceUsd) : "bullish",
      });
    }
    if (highUsd != null) {
      results.push({
        ...base,
        id: `${row.id}_high`,
        targetPriceUsd: highUsd,
        direction: currentPriceUsd ? impliedDirection(highUsd, currentPriceUsd) : "very_bullish",
      });
    }
  } else if (row.target_type === "range") {
    const lowUsd  = row.target_low_original  != null ? row.target_low_original  * toUsd : null;
    const highUsd = row.target_high_original != null ? row.target_high_original * toUsd : null;
    if (lowUsd != null) {
      results.push({
        ...base, id: `${row.id}_low`, targetPriceUsd: lowUsd,
        direction: currentPriceUsd ? impliedDirection(lowUsd, currentPriceUsd) : "neutral",
      });
    }
    if (highUsd != null) {
      results.push({
        ...base, id: `${row.id}_high`, targetPriceUsd: highUsd,
        direction: currentPriceUsd ? impliedDirection(highUsd, currentPriceUsd) : "bullish",
      });
    }
  } else {
    // "point"
    const priceUsd = (row.target_base_original ?? row.target_high_original ?? row.target_low_original);
    if (priceUsd != null) {
      const p = priceUsd * toUsd;
      results.push({
        ...base, id: row.id, targetPriceUsd: p,
        direction: currentPriceUsd ? impliedDirection(p, currentPriceUsd) : "bullish",
      });
    }
  }

  return results;
}

// Metadata de cobertura por activo/año
export interface AssetYearCoverage {
  assetId: string;
  ticker: string;
  targetYear: number;
  observationCount: number;
  sourceCount: number;      // fuentes independientes (por publisher)
  sufficient: boolean;      // >= MIN_SOURCES_FOR_QUANTILE fuentes independientes
  warning: string | null;
}

export function computeCoverageMatrix(rows: ObservationRow[]): AssetYearCoverage[] {
  const map = new Map<string, Set<string>>();
  const assetTicker = new Map<string, string>();

  for (const row of rows) {
    if (!row.active) continue;
    const key = `${row.asset_id}::${row.target_year}`;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(row.publisher);
    assetTicker.set(row.asset_id, row.ticker);
  }

  const result: AssetYearCoverage[] = [];
  for (const [key, publishers] of map) {
    const [assetId, yearStr] = key.split("::");
    const targetYear = parseInt(yearStr, 10);
    const obsCount = rows.filter(r => r.active && r.asset_id === assetId && r.target_year === targetYear).length;
    result.push({
      assetId,
      ticker: assetTicker.get(assetId) ?? assetId.toUpperCase(),
      targetYear,
      observationCount: obsCount,
      sourceCount: publishers.size,
      sufficient: publishers.size >= MIN_SOURCES_FOR_QUANTILE,
      warning: publishers.size < MIN_SOURCES_FOR_QUANTILE
        ? `Solo ${publishers.size} fuente(s) para ${assetId.toUpperCase()} ${targetYear} — se requieren ${MIN_SOURCES_FOR_QUANTILE} para cuantiles`
        : null,
    });
  }
  return result.sort((a, b) => a.assetId.localeCompare(b.assetId) || a.targetYear - b.targetYear);
}
