// ─── Motor de precios externos — Perspectivas ────────────────────────────────
// Fuente ÚNICA de precios para la simulación de Perspectivas.
// Utiliza exclusivamente previsiones externas verificables (KNOWN_FORECASTS).
// Para meses entre dos años cubiertos: interpolación lineal.
// Para meses más allá del último año cubierto: precio carry-forward (sin cobertura).
// SIN modelo de ciclos interno. SIN extrapolación inventada.

import type { SimScenario, AssetTier } from "./types";
import type { ForecastSource } from "./forecast-sources";

// ─── Tipos de cobertura ──────────────────────────────────────────────────────

export type CoverageState = "direct" | "interpolated" | "uncovered";

export interface ExternalPriceResult {
  pricesByMonth: Record<string, number>;
  coverageByYear: Record<number, CoverageState>;
  directYears: number[];
  interpolatedYears: number[];
  lastCoveredYear: number | null;
  sourceCount: number;
}

// ─── Tipo de cambio ──────────────────────────────────────────────────────────

export const EUR_PER_USD = 0.92;

// ─── Mapa de tickers de la simulación a IDs de ForecastSource ───────────────

const TICKER_TO_FORECAST_ID: Record<string, string> = {
  BTC:  "bitcoin",
  ETH:  "ethereum",
  SOL:  "solana",
  ADA:  "cardano",
  SUI:  "sui",
  DOT:  "polkadot",
  AVAX: "avalanche",
  LINK: "chainlink",
  BNB:  "binancecoin",
  TON:  "toncoin",
  NEAR: "near-protocol",
  INJ:  "injective",
};

// ─── Datos de tier (movidos desde price-model.ts deprecado) ─────────────────

const KNOWN_TIERS: Record<string, AssetTier> = {
  bitcoin:   "store_of_value",
  btc:       "store_of_value",
  ethereum:  "large_cap",
  eth:       "large_cap",
  binancecoin: "large_cap",
  bnb:       "large_cap",
  toncoin:   "large_cap",
  ton:       "large_cap",
  solana:    "mid_cap",
  sol:       "mid_cap",
  cardano:   "mid_cap",
  ada:       "mid_cap",
  avalanche: "mid_cap",
  avax:      "mid_cap",
  polkadot:  "mid_cap",
  dot:       "mid_cap",
  chainlink: "mid_cap",
  link:      "mid_cap",
  near:      "mid_cap",
  "near-protocol": "mid_cap",
  injective: "small_cap",
  inj:       "small_cap",
  sui:       "small_cap",
  sei:       "small_cap",
  optimism:  "small_cap",
  op:        "small_cap",
  arbitrum:  "small_cap",
  arb:       "small_cap",
  aptos:     "small_cap",
  apt:       "small_cap",
};

const SYMBOL_TIERS: Record<string, AssetTier> = {
  BTC: "store_of_value",
  ETH: "large_cap",
  BNB: "large_cap",
  TON: "large_cap",
  SOL: "mid_cap",
  ADA: "mid_cap",
  AVAX: "mid_cap",
  DOT: "mid_cap",
  LINK: "mid_cap",
  NEAR: "mid_cap",
  INJ: "small_cap",
  SUI: "small_cap",
  SEI: "small_cap",
  OP: "small_cap",
  ARB: "small_cap",
  APT: "small_cap",
};

export function getAssetTier(assetId: string): AssetTier {
  const lower = assetId.toLowerCase();
  if (KNOWN_TIERS[lower]) return KNOWN_TIERS[lower];
  const upper = assetId.toUpperCase();
  if (SYMBOL_TIERS[upper]) return SYMBOL_TIERS[upper];
  return "speculative";
}

// Suministro circulante aprox. en millones de tokens (fuentes: CMC/CoinGecko, 2025)
export const CIRCULATING_SUPPLY_M: Record<string, number> = {
  BTC:   21,
  ETH:   120,
  BNB:   145,
  SOL:   580,
  ADA:   36_000,
  AVAX:  400,
  DOT:   1_500,
  LINK:  600,
  TON:   5_000,
  OP:    4_300,
  ARB:   10_000,
  SUI:   3_500,
  SEI:   4_500,
  APT:   1_100,
  NEAR:  1_100,
  INJ:   100,
};

// ─── Utilidades de fecha ─────────────────────────────────────────────────────

export function monthKey(date: number): string {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ─── Derivación de precio por escenario desde la distribución de previsiones ─

function scenarioPrice(sortedPricesEur: number[], scenario: SimScenario): number {
  if (sortedPricesEur.length === 0) throw new Error("scenarioPrice: empty input");
  if (sortedPricesEur.length === 1) return sortedPricesEur[0];

  // Cuantiles ponderados: optimista ≠ máximo absoluto, conservador ≠ mínimo absoluto.
  // Documentado en methodologyVersion "quantile-v1".
  const pctMap: Record<SimScenario, number> = {
    conservador: 0.10,
    moderado:    0.30,
    base:        0.50,
    favorable:   0.70,
    optimista:   0.90,
  };
  const pct = pctMap[scenario];
  const rawIdx = pct * (sortedPricesEur.length - 1);
  const lo = Math.floor(rawIdx);
  const hi = Math.min(Math.ceil(rawIdx), sortedPricesEur.length - 1);
  const frac = rawIdx - lo;
  return sortedPricesEur[lo] * (1 - frac) + sortedPricesEur[hi] * frac;
}

// ─── Constructor principal ───────────────────────────────────────────────────

export function buildExternalPriceMap(
  assetId: string,
  currentPriceEur: number,
  scenario: SimScenario,
  nowMs: number,
  horizonMs: number,
  forecasts: ForecastSource[],
): ExternalPriceResult {
  const forecastId = TICKER_TO_FORECAST_ID[assetId.toUpperCase()];
  const currentYear = new Date(nowMs).getFullYear();
  const horizonYear = new Date(horizonMs).getFullYear();

  // Previsiones válidas: activo correcto, año futuro, no expirada
  const relevant = !forecastId
    ? []
    : forecasts.filter(
        f =>
          f.assetId === forecastId &&
          f.targetPriceUsd != null &&
          f.targetYear != null &&
          f.targetYear > currentYear &&
          f.expiresAt > nowMs,
      );

  // Agrupar por año objetivo y convertir a EUR
  const pricesByForecastYear = new Map<number, number[]>();
  let sourceCount = 0;
  for (const f of relevant) {
    if (f.targetPriceUsd == null || f.targetYear == null) continue;
    const priceEur = f.targetPriceUsd * EUR_PER_USD;
    const bucket = pricesByForecastYear.get(f.targetYear) ?? [];
    bucket.push(priceEur);
    pricesByForecastYear.set(f.targetYear, bucket);
    sourceCount++;
  }

  // Años con cobertura directa (futuro)
  const directYears = [...pricesByForecastYear.keys()].sort((a, b) => a - b);
  const lastCoveredYear = directYears.length > 0 ? directYears[directYears.length - 1] : null;

  // Años interpolados (entre el año actual y el último año cubierto, sin cobertura directa)
  const interpolatedYears: number[] = [];
  for (let y = currentYear + 1; y < (lastCoveredYear ?? currentYear); y++) {
    if (!pricesByForecastYear.has(y)) interpolatedYears.push(y);
  }

  // Mapa de cobertura por año
  const coverageByYear: Record<number, CoverageState> = {};
  for (let year = currentYear + 1; year <= horizonYear; year++) {
    if (pricesByForecastYear.has(year)) {
      coverageByYear[year] = "direct";
    } else if (lastCoveredYear != null && year < lastCoveredYear) {
      coverageByYear[year] = "interpolated";
    } else {
      coverageByYear[year] = "uncovered";
    }
  }

  // Puntos de anclaje para interpolación: {timeMs, priceEur}
  // El precio actual (nowMs) es el primer ancla
  const anchors: Array<{ timeMs: number; priceEur: number }> = [
    { timeMs: nowMs, priceEur: currentPriceEur },
  ];
  for (const [year, prices] of pricesByForecastYear) {
    const sorted = [...prices].sort((a, b) => a - b);
    const price = scenarioPrice(sorted, scenario);
    // Anclar al 31 de diciembre del año objetivo
    anchors.push({ timeMs: new Date(year, 11, 31).getTime(), priceEur: price });
  }
  anchors.sort((a, b) => a.timeMs - b.timeMs);

  // Construir mapa mensual
  const pricesByMonth: Record<string, number> = {};
  const d = new Date(nowMs);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() + 1); // primer mes de simulación (siguiente al actual)

  let lastKnownPrice = currentPriceEur;

  while (d.getTime() <= horizonMs) {
    const year = d.getFullYear();
    const mKey = monthKey(d.getTime());
    const tMs = d.getTime();

    if (coverageByYear[year] === "uncovered") {
      // Sin cobertura externa: mantener el último precio conocido.
      // El motor necesita un número para seguir corriendo, pero el resultado
      // se marcará como "sin cobertura" en los snapshots anuales.
      pricesByMonth[mKey] = lastKnownPrice;
    } else {
      // Interpolación lineal entre los anclajes más próximos
      let lo = anchors[0];
      let hi = anchors[anchors.length - 1];
      for (let i = 0; i < anchors.length - 1; i++) {
        if (anchors[i].timeMs <= tMs && anchors[i + 1].timeMs >= tMs) {
          lo = anchors[i];
          hi = anchors[i + 1];
          break;
        }
      }
      const price =
        lo.timeMs === hi.timeMs
          ? lo.priceEur
          : lo.priceEur +
            ((tMs - lo.timeMs) / (hi.timeMs - lo.timeMs)) *
              (hi.priceEur - lo.priceEur);
      pricesByMonth[mKey] = price;
      lastKnownPrice = price;
    }

    d.setMonth(d.getMonth() + 1);
  }

  return {
    pricesByMonth,
    coverageByYear,
    directYears,
    interpolatedYears,
    lastCoveredYear,
    sourceCount,
  };
}
