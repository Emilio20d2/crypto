import type { ScenarioHypotheses, AssetScenarioRates } from "./types";

// ── Phase-based price projection ──────────────────────────────────────────────
//
// Replaces the old `basePrice × (1+r)^years` formula that generated absurd results
// when high rates (35-70%) were applied for decades (20-30x in 10 years).
//
// New model: rate decays by decayFactor each 4-year cycle, with a terminal-rate floor
// and a hard capitalisation ceiling (maxPriceMultiplier × basePrice).
//
// Example — Optimista BTC (30% initial, 0.55 decay, 4% terminal, 10 years):
//   Cycle 0 (yr 0-4):  30%      → ×1.30^4  = ×2.86
//   Cycle 1 (yr 4-8):  16.5%    → ×1.165^4 = ×1.84
//   Cycle 2 (yr 8-10): 9.1%     → ×1.091^2 = ×1.19
//   Total multiplier: 6.26× (cap 7× → no ceiling hit)
//   vs old model:     1.35^10  = 20.1× ← was the root cause

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
  const initialRate  = rates?.annualGrowthRate   ?? hypotheses.defaultAnnualGrowthRate;
  const decayFactor  = rates?.decayFactor         ?? 0.70;
  const terminalRate = rates?.terminalAnnualRate   ?? 0.03;
  const cycleLen     = rates?.cycleLengthYears     ?? 4;
  const maxMult      = rates?.maxPriceMultiplier   ?? 5;

  const yearsTotal = (targetDateMs - baseDateMs) / (365.25 * 24 * 3600 * 1000);
  let price = basePrice;
  let yearsLeft = yearsTotal;
  let cycleIndex = 0;

  while (yearsLeft > 1e-9) {
    const cycleYears = Math.min(cycleLen, yearsLeft);
    const decayed = initialRate * Math.pow(decayFactor, cycleIndex);
    // Terminal floor only applies when initial rate is positive (decay toward maturity).
    // Negative rates (explicitly set for stress-tests) are not clamped upward.
    const rate = initialRate > 0 ? Math.max(decayed, terminalRate) : decayed;
    price *= Math.pow(1 + rate, cycleYears);
    yearsLeft -= cycleYears;
    cycleIndex++;
  }

  // Hard capitalisation ceiling
  return Math.min(price, basePrice * maxMult);
}

export function getAssetAnnualRate(assetId: string, hypotheses: ScenarioHypotheses): number {
  const specific = hypotheses.assetRates.find(r => r.assetId === assetId);
  return specific?.annualGrowthRate ?? hypotheses.defaultAnnualGrowthRate;
}

// ── Asset profile tables ───────────────────────────────────────────────────────

type ScenarioKey = "conservador" | "moderado" | "base" | "favorable" | "muy_favorable" | "optimista";

// Phase-1 initial annual growth rates — applied only during the first 4-year cycle.
// Each subsequent cycle is multiplied by DECAY_FACTORS[scenario].
const INITIAL_RATES: Record<string, Record<ScenarioKey, number>> = {
  BTC:  { conservador: 0.06, moderado: 0.10, base: 0.15, favorable: 0.20, muy_favorable: 0.25, optimista: 0.30 },
  ETH:  { conservador: 0.05, moderado: 0.09, base: 0.14, favorable: 0.18, muy_favorable: 0.22, optimista: 0.27 },
  SOL:  { conservador: 0.04, moderado: 0.08, base: 0.13, favorable: 0.17, muy_favorable: 0.22, optimista: 0.28 },
  SUI:  { conservador: 0.03, moderado: 0.07, base: 0.12, favorable: 0.16, muy_favorable: 0.20, optimista: 0.25 },
  BNB:  { conservador: 0.04, moderado: 0.08, base: 0.12, favorable: 0.16, muy_favorable: 0.20, optimista: 0.24 },
  ADA:  { conservador: 0.03, moderado: 0.06, base: 0.10, favorable: 0.13, muy_favorable: 0.17, optimista: 0.21 },
  DOT:  { conservador: 0.03, moderado: 0.07, base: 0.11, favorable: 0.14, muy_favorable: 0.18, optimista: 0.22 },
  AVAX: { conservador: 0.04, moderado: 0.08, base: 0.13, favorable: 0.17, muy_favorable: 0.21, optimista: 0.26 },
  LINK: { conservador: 0.04, moderado: 0.08, base: 0.12, favorable: 0.16, muy_favorable: 0.20, optimista: 0.25 },
};

// Rates for assets without a specific profile (altcoins)
const DEFAULT_RATES: Record<ScenarioKey, number> = {
  conservador:   0.03,
  moderado:      0.07,
  base:          0.10,
  favorable:     0.14,
  muy_favorable: 0.18,
  optimista:     0.22,
};

// Rate decay multiplied per 4-year cycle.
// Example: optimista starts at 30%, cycle 1 = 16.5%, cycle 2 = 9.1%, then terminal floor.
const DECAY_FACTORS: Record<ScenarioKey, number> = {
  conservador:   0.80,
  moderado:      0.75,
  base:          0.70,
  favorable:     0.65,
  muy_favorable: 0.60,
  optimista:     0.55,
};

// Long-run terminal growth rate floor (store-of-value / mature asset thesis)
const TERMINAL_RATES: Record<string, number> = {
  BTC:     0.04,
  ETH:     0.03,
  SOL:     0.02,
  SUI:     0.01,
  BNB:     0.02,
  ADA:     0.01,
  DOT:     0.01,
  AVAX:    0.02,
  LINK:    0.02,
  DEFAULT: 0.01,
};

// Max price multiplier from base price (capitalisation ceiling).
// BTC ×7: from ≈€93K → max ≈€651K (≈€13T market cap, conceivable but extreme)
// SOL ×12: from ≈€120  → max ≈€1 440 (≈€600B market cap)
// SUI ×9:  from ≈€2.8  → max ≈€25   (≈€31B market cap)
const MAX_PRICE_MULTIPLIERS: Record<string, number> = {
  BTC:     7,
  ETH:     8,
  SOL:    12,
  SUI:     9,
  BNB:     8,
  ADA:     8,
  DOT:     8,
  AVAX:   10,
  LINK:   10,
  DEFAULT: 5,
};

// Scenario probabilities — 6 static scenarios sum to 1.00; dynamic is separate
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
    "Tasas decrecientes: 6 % BTC fase 1 → 4 % terminal. Horizonte de acumulación constante.",
  moderado:
    "Expansión gradual con correcciones contenidas. " +
    "Varios ciclos positivos con ventas y recompras. Tasas: 10 % BTC fase 1 → 4 % terminal.",
  base:
    "Ciclo alcista de intensidad media, correcciones habituales, buena parte de los objetivos cumplidos. " +
    "Tasas: 15 % BTC fase 1 → 4 % terminal.",
  favorable:
    "Evolución mejor que Base: varios ciclos alcistas positivos, buen cumplimiento de objetivos, " +
    "ventas parciales relevantes y recompras, correcciones normales incluidas. " +
    "Sin rendimientos extraordinarios permanentes. Tasas: 20 % BTC fase 1 → 4 % terminal.",
  muy_favorable:
    "Evolución claramente superior a Favorable: ciclos fuertes, mayor cumplimiento de objetivos, " +
    "buen comportamiento de activos principales y parte de altcoins, " +
    "generación de EURC con recompras posteriores. Tasas: 25 % BTC fase 1 → 4 % terminal.",
  optimista:
    "Resultado excepcional pero matemáticamente justificable: ciclos alcistas especialmente fuertes, " +
    "amplio cumplimiento de objetivos. Tasas decrecientes: 30 % BTC fase 1 → 4 % terminal. " +
    "Límites de capitalización aplicados. Sin tasa perpetua extrema.",
  dinamico:
    "Proyección recalculada con los datos de mercado actuales disponibles.",
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
  dynamicFactors?: { fearAndGreedIndex: number | null; btcDominance: number | null },
): ScenarioHypotheses {

  function getDynamicRate(assetId: string): number {
    const fg = dynamicFactors?.fearAndGreedIndex ?? 50;
    const baseRate        = INITIAL_RATES[assetId]?.base      ?? DEFAULT_RATES.base;
    const optimisticRate  = INITIAL_RATES[assetId]?.optimista ?? DEFAULT_RATES.optimista;
    const conservativeRate = INITIAL_RATES[assetId]?.conservador ?? DEFAULT_RATES.conservador;

    if (fg < 25) return conservativeRate;
    if (fg < 50) return conservativeRate + (baseRate - conservativeRate) * ((fg - 25) / 25);
    if (fg < 75) return baseRate + (optimisticRate - baseRate) * ((fg - 50) / 25) * 0.5;
    return baseRate + (optimisticRate - baseRate) * 0.6;
  }

  const isStatic = scenario !== "dinamico";
  const sKey = scenario as ScenarioKey;

  const assetRates: AssetScenarioRates[] = assetIds.map(assetId => {
    let annualGrowthRate: number;
    if (scenario === "dinamico") {
      annualGrowthRate = getDynamicRate(assetId);
    } else {
      annualGrowthRate = INITIAL_RATES[assetId]?.[sKey] ?? DEFAULT_RATES[sKey];
    }

    const decayFactor  = isStatic ? DECAY_FACTORS[sKey] : DECAY_FACTORS.base;
    const terminalRate = TERMINAL_RATES[assetId] ?? TERMINAL_RATES.DEFAULT;
    const maxMult      = MAX_PRICE_MULTIPLIERS[assetId] ?? MAX_PRICE_MULTIPLIERS.DEFAULT;
    const vol          = VOLATILITIES[isStatic ? sKey : "base"];
    const corrDepth    = CORRECTION_DEPTHS[isStatic ? sKey : "base"];

    return {
      assetId,
      annualGrowthRate,
      decayFactor,
      terminalAnnualRate: terminalRate,
      cycleLengthYears: 4,
      maxPriceMultiplier: maxMult,
      volatility: vol,
      correctionDepth: corrDepth,
      source: INITIAL_RATES[assetId]
        ? "crypto-control:asset-profile-v2-phased"
        : "crypto-control:default-altcoin-profile-v2-phased",
      hypothesis: INITIAL_RATES[assetId]
        ? `Perfil ${assetId} / ${scenario}. ` +
          `Tasa inicial ${(annualGrowthRate * 100).toFixed(0)}% → terminal ${(terminalRate * 100).toFixed(0)}%. ` +
          `Decay ×${decayFactor} por ciclo de 4 años. Precio máx ×${maxMult} base.`
        : `Sin perfil propio. Hipótesis genérica: ` +
          `${(annualGrowthRate * 100).toFixed(0)}% → ${(terminalRate * 100).toFixed(0)}% terminal, cap ×${maxMult}.`,
      dataQuality: INITIAL_RATES[assetId] ? "media" : "baja",
      confidence:  INITIAL_RATES[assetId] ? 0.65 : 0.35,
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
    defaultAnnualGrowthRate: scenario === "dinamico" ? DEFAULT_RATES.base : DEFAULT_RATES[sKey],
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
