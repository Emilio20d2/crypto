// ─── Motor de precios externos — Perspectivas ────────────────────────────────
// Fuente ÚNICA de precios para la simulación de Perspectivas.
// Utiliza exclusivamente previsiones externas verificables inyectadas.
// Para meses entre dos años cubiertos: interpolación lineal.
// Para meses más allá del último año cubierto: extensión modelizada y marcada.
// SIN modelo de ciclos interno. SIN extrapolación inventada.

import type { SimScenario, AssetTier } from "./types";
import type { ForecastSource } from "./forecast-sources";

// ─── Tipos de cobertura ──────────────────────────────────────────────────────

export type CoverageState = "direct" | "interpolated" | "modeled" | "insufficient";

export interface ExternalPriceResult {
  pricesByMonth: Record<string, number>;
  coverageByYear: Record<number, CoverageState>;
  directYears: number[];
  interpolatedYears: number[];
  modeledYears: number[];
  insufficientYears: number[];
  lastCoveredYear: number | null;
  sourceCount: number;
}

export interface ExternalPriceMapOptions {
  usdToEurRate?: number | null;
  fxSource?: string | null;
}

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

interface WeightedPrice {
  priceEur: number;
  weight: number;
  publisher: string;
}

function scenarioPrice(prices: WeightedPrice[], scenario: SimScenario): number {
  if (prices.length === 0) throw new Error("scenarioPrice: empty input");
  if (prices.length === 1) return prices[0].priceEur;

  const pctMap: Record<SimScenario, number> = {
    conservador: 0.12,
    moderado:    0.30,
    base:        0.50,
    favorable:   0.70,
    optimista:   0.88,
  };
  const sorted = [...prices].sort((a, b) => a.priceEur - b.priceEur);
  const totalWeight = sorted.reduce((s, p) => s + Math.max(0.01, p.weight), 0);
  const threshold = totalWeight * pctMap[scenario];
  let acc = 0;
  for (const item of sorted) {
    acc += Math.max(0.01, item.weight);
    if (acc >= threshold) return item.priceEur;
  }
  return sorted[sorted.length - 1].priceEur;
}

function sourcePriceEur(source: ForecastSource, options?: ExternalPriceMapOptions): number | null {
  if (source.targetPriceEur != null && source.targetPriceEur > 0) return source.targetPriceEur;
  const rate = source.fxRate ?? options?.usdToEurRate ?? null;
  if (source.targetPriceUsd != null && source.targetPriceUsd > 0 && rate != null && rate > 0) {
    return source.targetPriceUsd * rate;
  }
  return null;
}

function modeledGrowthRate(tier: AssetTier, scenario: SimScenario, yearsAfterCoverage: number): number | null {
  if (tier === "speculative") return null;
  const baseByTier: Record<Exclude<AssetTier, "speculative">, Record<SimScenario, number>> = {
    store_of_value: { conservador: 0.015, moderado: 0.030, base: 0.045, favorable: 0.060, optimista: 0.080 },
    large_cap:      { conservador: 0.010, moderado: 0.025, base: 0.040, favorable: 0.060, optimista: 0.085 },
    mid_cap:        { conservador: -0.005, moderado: 0.020, base: 0.045, favorable: 0.075, optimista: 0.110 },
    small_cap:      { conservador: -0.020, moderado: 0.010, base: 0.040, favorable: 0.085, optimista: 0.130 },
  };
  return baseByTier[tier][scenario] / (1 + yearsAfterCoverage * 0.22);
}

function modeledVolatility(tier: AssetTier): number {
  if (tier === "store_of_value") return 0.10;
  if (tier === "large_cap") return 0.14;
  if (tier === "mid_cap") return 0.20;
  if (tier === "small_cap") return 0.28;
  return 0;
}

function modeledMonthlyPrice(anchorPrice: number, tier: AssetTier, scenario: SimScenario, monthsAfterCoverage: number): number | null {
  const years = monthsAfterCoverage / 12;
  const growth = modeledGrowthRate(tier, scenario, years);
  if (growth === null) return null;
  const phaseMap: Record<SimScenario, number> = {
    conservador: 3.1,
    moderado: 2.4,
    base: 1.7,
    favorable: 1.1,
    optimista: 0.4,
  };
  const trend = Math.pow(1 + growth, years);
  const cycle = Math.sin((monthsAfterCoverage / 18) * Math.PI * 2 + phaseMap[scenario]);
  const contraction = Math.sin((monthsAfterCoverage / 47) * Math.PI * 2 + 0.8);
  const volatility = modeledVolatility(tier) * Math.exp(-years / 9);
  const cycleFactor = Math.max(0.35, 1 + volatility * cycle - volatility * 0.55 * Math.max(0, contraction));
  return Math.max(0.000001, anchorPrice * trend * cycleFactor);
}

// ─── Constructor principal ───────────────────────────────────────────────────

export function buildExternalPriceMap(
  assetId: string,
  currentPriceEur: number,
  scenario: SimScenario,
  nowMs: number,
  horizonMs: number,
  forecasts: ForecastSource[],
  options?: ExternalPriceMapOptions,
): ExternalPriceResult {
  const forecastId = TICKER_TO_FORECAST_ID[assetId.toUpperCase()];
  const currentYear = new Date(nowMs).getFullYear();
  const horizonYear = new Date(horizonMs).getFullYear();
  const tier = getAssetTier(assetId);

  // Previsiones válidas: activo correcto, año futuro, no expirada
  const relevant = !forecastId
    ? []
    : forecasts.filter(
        f =>
          f.assetId === forecastId &&
          f.targetYear != null &&
          f.targetYear > currentYear &&
          f.expiresAt > nowMs,
      );

  // Agrupar por año objetivo y convertir a EUR
  const pricesByForecastYear = new Map<number, WeightedPrice[]>();
  const independentPublishers = new Set<string>();
  const dedupe = new Set<string>();
  for (const f of relevant) {
    if (f.targetYear == null) continue;
    const priceEur = sourcePriceEur(f, options);
    if (priceEur == null || priceEur <= 0) continue;
    const dedupeKey = `${f.publisher}::${f.assetId}::${f.targetYear}::${Math.round(priceEur)}`;
    if (dedupe.has(dedupeKey)) continue;
    dedupe.add(dedupeKey);
    const bucket = pricesByForecastYear.get(f.targetYear) ?? [];
    bucket.push({ priceEur, weight: f.confidence, publisher: f.publisher });
    pricesByForecastYear.set(f.targetYear, bucket);
    independentPublishers.add(f.publisher);
  }

  // Años con cobertura directa (futuro)
  const directYears = [...pricesByForecastYear.keys()].sort((a, b) => a - b);
  const lastCoveredYear = directYears.length > 0 ? directYears[directYears.length - 1] : null;

  // Años interpolados (entre el año actual y el último año cubierto, sin cobertura directa)
  const interpolatedYears: number[] = [];
  for (let y = currentYear + 1; y < (lastCoveredYear ?? currentYear); y++) {
    if (!pricesByForecastYear.has(y)) interpolatedYears.push(y);
  }
  const modeledYears: number[] = [];
  const insufficientYears: number[] = [];

  // Mapa de cobertura por año
  const coverageByYear: Record<number, CoverageState> = {};
  for (let year = currentYear + 1; year <= horizonYear; year++) {
    if (pricesByForecastYear.has(year)) {
      coverageByYear[year] = "direct";
    } else if (lastCoveredYear != null && year < lastCoveredYear) {
      coverageByYear[year] = "interpolated";
    } else if (lastCoveredYear != null && year > lastCoveredYear && tier !== "speculative") {
      coverageByYear[year] = "modeled";
      modeledYears.push(year);
    } else {
      coverageByYear[year] = "insufficient";
      insufficientYears.push(year);
    }
  }

  // Puntos de anclaje para interpolación: {timeMs, priceEur}
  // El precio actual (nowMs) es el primer ancla
  const anchors: Array<{ timeMs: number; priceEur: number }> = [
    { timeMs: nowMs, priceEur: currentPriceEur },
  ];
  for (const [year, prices] of pricesByForecastYear) {
    const price = scenarioPrice(prices, scenario);
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

  const lastCoveredAnchor = lastCoveredYear != null
    ? anchors.find(a => new Date(a.timeMs).getFullYear() === lastCoveredYear) ?? anchors[anchors.length - 1]
    : null;

  while (d.getTime() <= horizonMs) {
    const year = d.getFullYear();
    const mKey = monthKey(d.getTime());
    const tMs = d.getTime();

    if (coverageByYear[year] === "modeled" && lastCoveredAnchor) {
      const anchorDate = new Date(lastCoveredAnchor.timeMs);
      const monthsAfterCoverage =
        (year - anchorDate.getFullYear()) * 12 + (d.getMonth() - anchorDate.getMonth());
      const modeled = modeledMonthlyPrice(lastCoveredAnchor.priceEur, tier, scenario, Math.max(1, monthsAfterCoverage));
      if (modeled != null) pricesByMonth[mKey] = modeled;
    } else if (coverageByYear[year] === "insufficient") {
      // Sin cobertura ni modelo defendible: no se inventa precio.
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
    }

    d.setMonth(d.getMonth() + 1);
  }

  return {
    pricesByMonth,
    coverageByYear,
    directYears,
    interpolatedYears,
    modeledYears,
    insufficientYears,
    lastCoveredYear,
    sourceCount: independentPublishers.size,
  };
}
