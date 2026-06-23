// ─── Modelo de precios por activo — Perspectivas (nuevo, desde cero) ─────────
// Genera trayectorias de precio mensuales por activo y escenario.
// No hardcodea activos: el tier se determina dinámicamente.
// La trayectoria es determinista y reproducible dado assetId + escenario.

import type { SimScenario, AssetTier } from "./types";

// ─── Clasificación de tier ───────────────────────────────────────────────────

const KNOWN_TIERS: Record<string, AssetTier> = {
  bitcoin:       "store_of_value",
  ethereum:      "large_cap",
  binancecoin:   "large_cap",
  solana:        "mid_cap",
  cardano:       "mid_cap",
  avalanche:     "mid_cap",
  polkadot:      "mid_cap",
  chainlink:     "mid_cap",
  "the-open-network": "mid_cap",
  toncoin:       "mid_cap",
  optimism:      "small_cap",
  arbitrum:      "small_cap",
  sui:           "small_cap",
  sei:           "small_cap",
  aptos:         "small_cap",
  near:          "small_cap",
  injective:     "small_cap",
};

// Aliases de symbol (uppercase) a tier
const SYMBOL_TIERS: Record<string, AssetTier> = {
  BTC: "store_of_value",
  ETH: "large_cap",
  BNB: "large_cap",
  SOL: "mid_cap",
  ADA: "mid_cap",
  AVAX: "mid_cap",
  DOT: "mid_cap",
  LINK: "mid_cap",
  TON: "mid_cap",
  OP:  "small_cap",
  ARB: "small_cap",
  SUI: "small_cap",
  SEI: "small_cap",
  APT: "small_cap",
  NEAR: "small_cap",
  INJ: "small_cap",
};

export function getAssetTier(assetId: string): AssetTier {
  const lower = assetId.toLowerCase();
  if (KNOWN_TIERS[lower]) return KNOWN_TIERS[lower];
  const upper = assetId.toUpperCase();
  if (SYMBOL_TIERS[upper]) return SYMBOL_TIERS[upper];
  return "speculative";
}

// ─── Tasas anuales de crecimiento real por tier y escenario ─────────────────
// No se aplica directamente — se modula por ciclo de halving y decaimiento.

const ANNUAL_GROWTH: Record<AssetTier, Record<SimScenario, number>> = {
  store_of_value: {
    conservador: 0.05, moderado: 0.22, base: 0.42, favorable: 0.80, optimista: 1.50,
  },
  large_cap: {
    conservador: 0.03, moderado: 0.18, base: 0.36, favorable: 0.70, optimista: 1.30,
  },
  mid_cap: {
    conservador: 0.01, moderado: 0.14, base: 0.30, favorable: 0.65, optimista: 1.20,
  },
  small_cap: {
    conservador: -0.03, moderado: 0.10, base: 0.25, favorable: 0.60, optimista: 1.10,
  },
  speculative: {
    conservador: -0.10, moderado: 0.08, base: 0.22, favorable: 0.55, optimista: 1.00,
  },
};

// Tasa terminal (horizonte > 12 años) — el modelo decae hacia esto
const TERMINAL_GROWTH: Record<AssetTier, Record<SimScenario, number>> = {
  store_of_value: {
    conservador: 0.02, moderado: 0.10, base: 0.18, favorable: 0.25, optimista: 0.35,
  },
  large_cap: {
    conservador: 0.01, moderado: 0.08, base: 0.14, favorable: 0.22, optimista: 0.30,
  },
  mid_cap: {
    conservador: -0.02, moderado: 0.05, base: 0.10, favorable: 0.18, optimista: 0.26,
  },
  small_cap: {
    conservador: -0.05, moderado: 0.02, base: 0.07, favorable: 0.14, optimista: 0.22,
  },
  speculative: {
    conservador: -0.10, moderado: 0.01, base: 0.05, favorable: 0.10, optimista: 0.18,
  },
};

// Profundidad de corrección máxima por escenario (% desde pico)
const MAX_DRAWDOWN: Record<SimScenario, number> = {
  conservador: -0.75,
  moderado:    -0.55,
  base:        -0.45,
  favorable:   -0.35,
  optimista:   -0.25,
};

// ─── Fases del ciclo de halving ───────────────────────────────────────────────
// BTC halvings: Abril 2024 (último), ~Abril 2028, ~Abril 2032, ~Abril 2036

interface HalvingPhase {
  name: "accumulation" | "bull_run" | "peak" | "bear" | "capitulation";
  multiplier: number;  // modificador sobre la tasa base
}

function getHalvingPhase(monthDate: number): HalvingPhase {
  const d = new Date(monthDate);
  const year = d.getFullYear();
  const month = d.getMonth(); // 0-based

  // Halving periods (año del halving = peak a +12-18 meses)
  const halvingYears = [2024, 2028, 2032, 2036];

  let bestPhase: HalvingPhase = { name: "accumulation", multiplier: 0.6 };
  let closestDist = Infinity;

  for (const halvingYear of halvingYears) {
    const halvingMonth = halvingYear * 12 + 3; // April = month 3
    const currentMonth = year * 12 + month;
    const msSinceHalving = currentMonth - halvingMonth;

    if (msSinceHalving < 0) {
      // Before halving: accumulation (0-12 months before = recovering from bear)
      const monthsBefore = -msSinceHalving;
      if (monthsBefore <= 18 && monthsBefore < closestDist) {
        closestDist = monthsBefore;
        bestPhase = { name: "accumulation", multiplier: 0.5 + 0.03 * (18 - monthsBefore) };
      }
    } else if (msSinceHalving <= 18) {
      // 0-18 months after halving: bull run
      if (msSinceHalving < closestDist) {
        closestDist = msSinceHalving;
        const progress = msSinceHalving / 18;
        bestPhase = { name: "bull_run", multiplier: 1.5 + progress * 0.8 };
      }
    } else if (msSinceHalving <= 24) {
      // 18-24 months: peak / distribution
      if (msSinceHalving < closestDist) {
        closestDist = msSinceHalving;
        bestPhase = { name: "peak", multiplier: 2.0 };
      }
    } else if (msSinceHalving <= 36) {
      // 24-36 months: bear market
      if (msSinceHalving < closestDist) {
        closestDist = msSinceHalving;
        const bearProgress = (msSinceHalving - 24) / 12;
        bestPhase = { name: "bear", multiplier: -0.5 - bearProgress * 0.8 };
      }
    } else if (msSinceHalving <= 42) {
      // 36-42 months: capitulation / bottoming
      if (msSinceHalving < closestDist) {
        closestDist = msSinceHalving;
        bestPhase = { name: "capitulation", multiplier: -0.3 };
      }
    }
  }

  return bestPhase;
}

// ─── Generador determinista de "ruido" ───────────────────────────────────────

function deterministicNoise(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const uint = (h >>> 0);
  return (uint % 1000) / 1000 - 0.5; // [-0.5, 0.5]
}

// ─── Generación de trayectoria de precios mensuales ───────────────────────────

export interface PricePoint {
  monthDate: number; // first day of month, ms
  priceEur: number;
}

export function buildPricePath(
  assetId: string,
  currentPriceEur: number,
  scenario: SimScenario,
  startDate: number,
  horizonDate: number,
): PricePoint[] {
  const tier = getAssetTier(assetId);
  const baseAnnualGrowth = ANNUAL_GROWTH[tier][scenario];
  const terminalAnnualGrowth = TERMINAL_GROWTH[tier][scenario];
  const maxDrawdown = MAX_DRAWDOWN[scenario];

  const points: PricePoint[] = [];
  let priceEur = currentPriceEur;
  let peakPrice = currentPriceEur;

  const startD = new Date(startDate);
  startD.setDate(1);
  startD.setHours(0, 0, 0, 0);

  const totalMonths = Math.ceil((horizonDate - startDate) / (30.44 * 24 * 3600 * 1000));

  for (let m = 0; m <= totalMonths; m++) {
    const d = new Date(startD);
    d.setMonth(d.getMonth() + m);
    const monthTs = d.getTime();

    if (m === 0) {
      points.push({ monthDate: monthTs, priceEur });
      continue;
    }

    // Years from start for terminal blending
    const yearsFromStart = m / 12;
    const terminalBlend = Math.min(1, yearsFromStart / 12); // full terminal after 12 years
    const annualGrowth = baseAnnualGrowth * (1 - terminalBlend) + terminalAnnualGrowth * terminalBlend;

    // Monthly growth from annual
    const monthlyBase = Math.pow(1 + annualGrowth, 1 / 12) - 1;

    // Halving cycle modulation (only relevant for store_of_value and large_cap)
    const halvingPhase = getHalvingPhase(monthTs);
    const cycleMultiplier = tier === "store_of_value" ? halvingPhase.multiplier
      : tier === "large_cap" ? halvingPhase.multiplier * 0.7
      : tier === "mid_cap" ? halvingPhase.multiplier * 0.5
      : halvingPhase.multiplier * 0.3;

    const monthlyGrowth = monthlyBase * (0.4 + 0.6 * (1 + cycleMultiplier * 0.3));

    // Deterministic noise (small, reproducible)
    const noiseSeed = `${assetId}-${scenario}-${d.getFullYear()}-${d.getMonth()}`;
    const noiseStrength = tier === "speculative" ? 0.04 : tier === "small_cap" ? 0.03 : 0.015;
    const noise = deterministicNoise(noiseSeed) * noiseStrength;

    priceEur = Math.max(0.000001, priceEur * (1 + monthlyGrowth + noise));

    // Track peak
    if (priceEur > peakPrice) peakPrice = priceEur;

    // Drawdown protection: price cannot fall more than maxDrawdown from peak
    const minAllowed = peakPrice * (1 + maxDrawdown);
    if (priceEur < minAllowed) {
      priceEur = minAllowed;
    }

    if (monthTs <= horizonDate) {
      points.push({ monthDate: monthTs, priceEur });
    }
  }

  return points;
}

// Returns a map: "YYYY-MM" → priceEur
export function buildPriceMap(
  assetId: string,
  currentPriceEur: number,
  scenario: SimScenario,
  startDate: number,
  horizonDate: number,
): Record<string, number> {
  const path = buildPricePath(assetId, currentPriceEur, scenario, startDate, horizonDate);
  const map: Record<string, number> = {};
  for (const pt of path) {
    const d = new Date(pt.monthDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    map[key] = pt.priceEur;
  }
  return map;
}

export function monthKey(date: number): string {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
