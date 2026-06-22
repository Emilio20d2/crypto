import type { ScenarioHypotheses, AssetScenarioRates, ProjectionScenario } from "./types";

// ── Phase-based price projection ──────────────────────────────────────────────
//
// Wealth = Σ(balance[assetId] × price[assetId]) — the engine computes this per asset.
//
// Price model: decaying annual rate + halving-cycle phase modulation + cap.
// Rate decays each 4-year cycle; phase adds realistic bull/correction/recovery waves.
//
// Example — Optimista BTC (30% initial, 0.55 decay, 4% terminal, 10 years):
//   Cycle 0 (yr 0-4):  30%   → ×1.30^4 = ×2.86
//   Cycle 1 (yr 4-8):  16.5% → ×1.165^4 = ×1.84
//   Cycle 2 (yr 8-10): 9.1%  → ×1.091^2 = ×1.19
//   Total: 6.26× (cap 7× → no ceiling)
//   vs old compound:   1.35^10 = 20.1× ← was the root bug

// ── Halving-cycle phase modulation ───────────────────────────────────────────
//
// Without corrections, monotonically rising prices mean rebuy tiers never fire.
//
// Phase model (48-month cycle aligned to crypto halving):
//   Months  0-13: accumulation  — price at trend (phase = 1.0)
//   Months 13-30: bull run      — price rises to trend × (1 + corrDepth)
//   Months 30-42: correction    — price falls to trend × (1 - corrDepth)
//   Months 42-48: recovery      — price returns to trend × 1.0
function cyclePhaseMultiplier(
  totalMonthsElapsed: number,
  cycleLen: number,
  corrDepth: number,
): number {
  const cycleMonths = Math.round(cycleLen * 12);
  const m = Math.round(totalMonthsElapsed) % cycleMonths;

  const BULL_START = Math.round(cycleMonths * 0.27);
  const BULL_PEAK  = Math.round(cycleMonths * 0.63);
  const CORR_END   = Math.round(cycleMonths * 0.88);

  if (m <= BULL_START) return 1.0;
  if (m <= BULL_PEAK) {
    const t = (m - BULL_START) / (BULL_PEAK - BULL_START);
    return 1.0 + corrDepth * Math.sin(t * Math.PI / 2);
  }
  if (m <= CORR_END) {
    const t = (m - BULL_PEAK) / (CORR_END - BULL_PEAK);
    return (1 + corrDepth) - 2 * corrDepth * t;
  }
  const t = (m - CORR_END) / (cycleMonths - CORR_END);
  return (1 - corrDepth) + corrDepth * t;
}

export function projectAssetPrice(
  basePrice: number,
  assetId: string,
  baseDateMs: number,
  targetDateMs: number,
  hypotheses: ScenarioHypotheses,
): number | null {
  if (basePrice <= 0) return null;
  if (targetDateMs <= baseDateMs) return basePrice;

  const rates = hypotheses.assetRates.find(r => r.assetId === assetId);
  const initialRate  = rates?.annualGrowthRate    ?? hypotheses.defaultAnnualGrowthRate;
  const decayFactor  = rates?.decayFactor          ?? 0.70;
  const terminalRate = rates?.terminalAnnualRate    ?? 0.03;
  const cycleLen     = rates?.cycleLengthYears      ?? 4;
  const maxMult      = rates?.maxPriceMultiplier    ?? 5;
  const corrDepth    = rates?.correctionDepth       ?? 0.35;

  const yearsTotal = (targetDateMs - baseDateMs) / (365.25 * 24 * 3600 * 1000);

  let trend = basePrice;
  let yearsLeft = yearsTotal;
  let cycleIndex = 0;
  while (yearsLeft > 1e-9) {
    const cycleYears = Math.min(cycleLen, yearsLeft);
    const decayed = initialRate * Math.pow(decayFactor, cycleIndex);
    const rate = initialRate > 0 ? Math.max(decayed, terminalRate) : decayed;
    trend *= Math.pow(1 + rate, cycleYears);
    yearsLeft -= cycleYears;
    cycleIndex++;
  }

  const phase = corrDepth > 0
    ? cyclePhaseMultiplier(yearsTotal * 12, cycleLen, corrDepth)
    : 1.0;

  return Math.min(Math.max(trend * phase, basePrice * 0.01), basePrice * maxMult);
}

export function getAssetAnnualRate(assetId: string, hypotheses: ScenarioHypotheses): number {
  const specific = hypotheses.assetRates.find(r => r.assetId === assetId);
  return specific?.annualGrowthRate ?? hypotheses.defaultAnnualGrowthRate;
}

// ── Generic market-tier system ────────────────────────────────────────────────
//
// Any assetId — known or unknown — is classified into a market tier.
// Tiers drive all rate/cap parameters so the engine works for any crypto
// added to the Plan without code changes.

export type MarketTier =
  | "tier1_store_of_value"  // BTC — digital gold thesis
  | "tier1_platform"        // ETH, BNB — large L1 platforms
  | "tier2_platform"        // SOL, AVAX, DOT, LINK, TON — mid L1/L2
  | "tier3_altcoin"         // SUI, ADA, SEI and any unclassified asset
  | "tier4_micro";          // micro-caps with high risk/reward

type ScenarioKey = "conservador" | "moderado" | "base" | "favorable" | "muy_favorable" | "optimista";

// Phase-1 annual growth rates per tier × scenario
const TIER_RATES: Record<MarketTier, Record<ScenarioKey, number>> = {
  tier1_store_of_value: { conservador: 0.06, moderado: 0.10, base: 0.15, favorable: 0.20, muy_favorable: 0.25, optimista: 0.30 },
  tier1_platform:       { conservador: 0.05, moderado: 0.09, base: 0.14, favorable: 0.18, muy_favorable: 0.22, optimista: 0.27 },
  tier2_platform:       { conservador: 0.04, moderado: 0.08, base: 0.13, favorable: 0.17, muy_favorable: 0.22, optimista: 0.28 },
  tier3_altcoin:        { conservador: 0.02, moderado: 0.06, base: 0.10, favorable: 0.14, muy_favorable: 0.18, optimista: 0.23 },
  tier4_micro:          { conservador: 0.00, moderado: 0.04, base: 0.08, favorable: 0.12, muy_favorable: 0.16, optimista: 0.20 },
};

const TIER_TERMINAL_RATES: Record<MarketTier, number> = {
  tier1_store_of_value: 0.04,
  tier1_platform:       0.03,
  tier2_platform:       0.02,
  tier3_altcoin:        0.01,
  tier4_micro:          0.00,
};

type ScenarioMultiplierMap = Record<ScenarioKey, number> & { default: number };

const TIER_MAX_MULTIPLIERS: Record<MarketTier, ScenarioMultiplierMap> = {
  tier1_store_of_value: { conservador: 4, moderado: 5, base: 7, favorable: 9,  muy_favorable: 12, optimista: 15, default: 7  },
  tier1_platform:       { conservador: 4, moderado: 5, base: 7, favorable: 9,  muy_favorable: 12, optimista: 14, default: 7  },
  tier2_platform:       { conservador: 5, moderado: 7, base: 10, favorable: 13, muy_favorable: 17, optimista: 20, default: 10 },
  tier3_altcoin:        { conservador: 3, moderado: 5, base: 7,  favorable: 10, muy_favorable: 13, optimista: 17, default: 7  },
  tier4_micro:          { conservador: 2, moderado: 3, base: 5,  favorable: 7,  muy_favorable: 10, optimista: 13, default: 5  },
};

// Known assets mapped to tiers. Any assetId NOT in this map → tier3_altcoin.
// This is the ONLY place where specific assetIds appear in the rate system.
const ASSET_TIER_MAP: Record<string, MarketTier> = {
  BTC:   "tier1_store_of_value",
  ETH:   "tier1_platform",
  BNB:   "tier1_platform",
  SOL:   "tier2_platform",
  AVAX:  "tier2_platform",
  DOT:   "tier2_platform",
  LINK:  "tier2_platform",
  TON:   "tier2_platform",
  SUI:   "tier3_altcoin",
  ADA:   "tier3_altcoin",
  SEI:   "tier3_altcoin",
};

/** Return the market tier for any assetId. Unknown assets → tier3_altcoin. */
export function getAssetTier(assetId: string): MarketTier {
  return ASSET_TIER_MAP[assetId] ?? "tier3_altcoin";
}

/** Dynamically classify a new asset without code changes. */
export function registerAssetTier(assetId: string, tier: MarketTier): void {
  ASSET_TIER_MAP[assetId] = tier;
}

// Rate decay per 4-year cycle (scenario-level, not asset-level)
const DECAY_FACTORS: Record<ScenarioKey, number> = {
  conservador:   0.80,
  moderado:      0.75,
  base:          0.70,
  favorable:     0.65,
  muy_favorable: 0.60,
  optimista:     0.55,
};

const STATIC_PROBS: Record<ScenarioKey, number> = {
  conservador:   0.15,
  moderado:      0.22,
  base:          0.28,
  favorable:     0.18,
  muy_favorable: 0.10,
  optimista:     0.07,
};

const CONFIDENCE_LEVELS: Record<string, number> = {
  conservador:   0.70,
  moderado:      0.65,
  base:          0.60,
  favorable:     0.55,
  muy_favorable: 0.50,
  optimista:     0.40,
};

const VOLATILITIES: Record<ScenarioKey, number> = {
  conservador:   0.30,
  moderado:      0.40,
  base:          0.50,
  favorable:     0.60,
  muy_favorable: 0.70,
  optimista:     0.80,
};

const CORRECTION_DEPTHS: Record<ScenarioKey, number> = {
  conservador:   0.55,
  moderado:      0.45,
  base:          0.40,
  favorable:     0.35,
  muy_favorable: 0.30,
  optimista:     0.25,
};

const SCENARIO_LABELS: Record<string, string> = {
  conservador:   "Conservador",
  moderado:      "Moderado",
  base:          "Base",
  favorable:     "Favorable",
  muy_favorable: "Muy favorable",
  optimista:     "Optimista",
  dinamico:      "Dinámico actual",
};

const SCENARIO_DESCS: Record<string, string> = {
  conservador:
    "Crecimiento lento con correcciones frecuentes. " +
    "Tasas decrecientes por tier: tier1 6-5% → tier3 2% fase 1, terminal 4-1%.",
  moderado:
    "Expansión gradual con correcciones contenidas. " +
    "Tasas: tier1 10-9%, tier2 8%, tier3 6% fase 1.",
  base:
    "Ciclo alcista de intensidad media, correcciones habituales. " +
    "Tasas: tier1 15-14%, tier2 13%, tier3 10% fase 1.",
  favorable:
    "Varios ciclos alcistas positivos, ventas parciales y recompras. " +
    "Tasas: tier1 20-18%, tier2 17%, tier3 14% fase 1.",
  muy_favorable:
    "Ciclos fuertes, buena acumulación. " +
    "Tasas: tier1 25-22%, tier2 22%, tier3 18% fase 1.",
  optimista:
    "Resultado excepcional: ciclos alcistas fuertes con tasas decrecientes. " +
    "tier1 30-27%, tier2 28%, tier3 23% fase 1. Caps de capitalización aplicados.",
  dinamico:
    "Proyección recalculada con datos de mercado actuales.",
};

const MARKET_PHASES: Record<string, "bull" | "bear" | "sideways" | "unknown"> = {
  conservador:   "sideways",
  moderado:      "bull",
  base:          "bull",
  favorable:     "bull",
  muy_favorable: "bull",
  optimista:     "bull",
  dinamico:      "unknown",
};

// ── buildDefaultHypotheses ────────────────────────────────────────────────────

export function buildDefaultHypotheses(
  scenario: "conservador" | "moderado" | "base" | "favorable" | "muy_favorable" | "optimista" | "dinamico",
  assetIds: string[],
  dynamicFactors?: {
    fearAndGreedIndex: number | null;
    btcDominance: number | null;
    assetSentiment?: Record<string, { score: number; direction: string; confidence: number }>;
  },
): ScenarioHypotheses {

  function getDynamicRate(assetId: string): number {
    const tier = getAssetTier(assetId);
    const conservativeRate = TIER_RATES[tier].conservador;
    const baseRate         = TIER_RATES[tier].base;
    const optimisticRate   = TIER_RATES[tier].optimista;

    const perAsset = dynamicFactors?.assetSentiment?.[assetId];
    let score: number;
    if (perAsset && typeof perAsset.score === "number" && Number.isFinite(perAsset.score)) {
      const fg = dynamicFactors?.fearAndGreedIndex ?? 50;
      const fgScore = (fg - 50) * 2;
      const w = Math.min(1, Math.max(0, perAsset.confidence / 100));
      score = w * perAsset.score + (1 - w) * fgScore;
    } else {
      const fg = dynamicFactors?.fearAndGreedIndex ?? 50;
      score = (fg - 50) * 2;
    }

    const t = (Math.max(-100, Math.min(100, score)) + 100) / 200;
    if (t < 0.25) return conservativeRate * (t * 4);
    if (t < 0.5)  return conservativeRate + (baseRate - conservativeRate) * ((t - 0.25) * 4);
    if (t < 0.75) return baseRate + (optimisticRate - baseRate) * 0.4 * ((t - 0.5) * 4);
    return baseRate + (optimisticRate - baseRate) * (0.4 + 0.6 * ((t - 0.75) * 4));
  }

  const isStatic = scenario !== "dinamico";
  const sKey = scenario as ScenarioKey;

  const assetRates: AssetScenarioRates[] = assetIds.map(assetId => {
    const tier = getAssetTier(assetId);

    let annualGrowthRate: number;
    if (scenario === "dinamico") {
      annualGrowthRate = getDynamicRate(assetId);
    } else {
      annualGrowthRate = TIER_RATES[tier][sKey];
    }

    const decayFactor   = isStatic ? DECAY_FACTORS[sKey] : DECAY_FACTORS.base;
    const terminalRate  = TIER_TERMINAL_RATES[tier];
    const effectiveSKey = isStatic ? sKey : "base";
    const maxMult       = TIER_MAX_MULTIPLIERS[tier][effectiveSKey as ScenarioKey] ?? TIER_MAX_MULTIPLIERS[tier].default;
    const vol           = VOLATILITIES[isStatic ? sKey : "base"];
    const corrDepth     = CORRECTION_DEPTHS[isStatic ? sKey : "base"];

    const tierLabel = tier.replace(/_/g, " ");
    return {
      assetId,
      annualGrowthRate,
      decayFactor,
      terminalAnnualRate: terminalRate,
      cycleLengthYears: 4,
      maxPriceMultiplier: maxMult,
      volatility: vol,
      correctionDepth: corrDepth,
      source: "crypto-control:tier-based-v3",
      hypothesis:
        `${assetId} → ${tierLabel} / ${scenario}. ` +
        `Tasa inicial ${(annualGrowthRate * 100).toFixed(0)}% → terminal ${(terminalRate * 100).toFixed(0)}%. ` +
        `Decay ×${decayFactor} por ciclo 4 años. Cap ×${maxMult}.`,
      dataQuality: tier === "tier1_store_of_value" || tier === "tier1_platform" ? "media" : "baja",
      confidence:  tier === "tier1_store_of_value" ? 0.65 : tier === "tier1_platform" ? 0.60 : 0.40,
    };
  });

  const DYNAMIC_CONFIDENCE = dynamicFactors
    ? Math.max(0.2, 0.5 - (dynamicFactors.fearAndGreedIndex == null ? 0.2 : 0))
    : 0.3;

  return {
    scenario,
    label:       SCENARIO_LABELS[scenario] ?? scenario,
    description: SCENARIO_DESCS[scenario]  ?? "",
    probability: isStatic ? (STATIC_PROBS[sKey] ?? null) : null,
    confidence:  scenario === "dinamico" ? DYNAMIC_CONFIDENCE : (CONFIDENCE_LEVELS[scenario] ?? 0.5),
    assetRates,
    defaultAnnualGrowthRate: scenario === "dinamico"
      ? TIER_RATES.tier3_altcoin.base
      : TIER_RATES.tier3_altcoin[sKey],
    marketPhase: MARKET_PHASES[scenario] ?? "unknown",
    dynamicFactors: dynamicFactors
      ? {
          fearAndGreedIndex:  dynamicFactors.fearAndGreedIndex,
          btcDominance:       dynamicFactors.btcDominance ?? null,
          globalMarketCapEur: null,
          generatedAt:        Date.now(),
          sourcesUsed:        dynamicFactors.fearAndGreedIndex != null ? ["fear_and_greed"] : [],
          sourcesUnavailable: dynamicFactors.fearAndGreedIndex == null ? ["fear_and_greed"] : [],
          confidence:         DYNAMIC_CONFIDENCE,
        }
      : undefined,
  };
}

// Zero-growth control scenario — prices stay flat, only contributions matter.
export function buildZeroGrowthHypotheses(assetIds: string[]): ScenarioHypotheses {
  const assetRates: AssetScenarioRates[] = assetIds.map(assetId => ({
    assetId,
    annualGrowthRate: 0,
    decayFactor: 1,
    terminalAnnualRate: 0,
    cycleLengthYears: 4,
    maxPriceMultiplier: 1,
    volatility: 0,
    correctionDepth: 0,
    source: "control_cero",
    hypothesis: "Sin crecimiento de mercado — patrimonio final = inicial + aportaciones",
    dataQuality: "alta",
    confidence: 1,
  }));

  return {
    scenario: "cero" as ProjectionScenario,
    label: "Control 0%",
    description: "Crecimiento de mercado cero — patrimonio final = inicial + aportaciones futuras",
    probability: null,
    confidence: 1,
    assetRates,
    defaultAnnualGrowthRate: 0,
    marketPhase: "sideways",
  };
}
