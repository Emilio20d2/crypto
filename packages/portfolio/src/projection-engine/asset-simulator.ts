import type { ScenarioHypotheses, AssetScenarioRates, ProjectionScenario } from "./types";

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

// ── Halving-cycle phase modulation ───────────────────────────────────────────
//
// Crypto prices don't rise smoothly — they follow a 4-year halving cycle with
// a bull run followed by a bear correction. Without this modulation the price
// path is monotonically increasing, which means rebuy tiers (which trigger on
// drawdown from last sale price) would NEVER fire.
//
// Phase model (48-month cycle):
//   Months  0-13: accumulation — price at trend (phase = 1.0)
//   Months 13-30: bull run      — price rises to trend × (1 + corrDepth)
//   Months 30-42: correction    — price falls to trend × (1 - corrDepth)
//   Months 42-48: recovery      — price returns to trend × 1.0
//
// For base scenario (corrDepth=0.40):
//   Peak = trend × 1.40, bottom = trend × 0.60 → realistic ~57% peak-to-trough.
// The long-run average multiplier ≈ 1.0 (corrections balance out bull gains over
// many full cycles), so the terminal wealth is not inflated.
function cyclePhaseMultiplier(
  totalMonthsElapsed: number,
  cycleLen: number,   // years per cycle (default 4)
  corrDepth: number,  // CORRECTION_DEPTHS value, 0.25-0.55
): number {
  const cycleMonths = Math.round(cycleLen * 12);
  const m = Math.round(totalMonthsElapsed) % cycleMonths;

  // Phase boundaries expressed as integer months:
  const BULL_START = Math.round(cycleMonths * 0.27);  // ~13 months
  const BULL_PEAK  = Math.round(cycleMonths * 0.63);  // ~30 months
  const CORR_END   = Math.round(cycleMonths * 0.88);  // ~42 months

  if (m <= BULL_START) {
    // Accumulation: at trend
    return 1.0;
  }
  if (m <= BULL_PEAK) {
    // Bull run: rises sinusoidally from 1.0 to (1 + corrDepth)
    const t = (m - BULL_START) / (BULL_PEAK - BULL_START);
    return 1.0 + corrDepth * Math.sin(t * Math.PI / 2);
  }
  if (m <= CORR_END) {
    // Correction: falls linearly from (1 + corrDepth) to (1 - corrDepth)
    const t = (m - BULL_PEAK) / (CORR_END - BULL_PEAK);
    return (1 + corrDepth) - 2 * corrDepth * t;
  }
  // Recovery: rises linearly from (1 - corrDepth) to 1.0
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
  const initialRate    = rates?.annualGrowthRate   ?? hypotheses.defaultAnnualGrowthRate;
  const decayFactor    = rates?.decayFactor         ?? 0.70;
  const terminalRate   = rates?.terminalAnnualRate   ?? 0.03;
  const cycleLen       = rates?.cycleLengthYears     ?? 4;
  const maxMult        = rates?.maxPriceMultiplier   ?? 5;
  const corrDepth      = rates?.correctionDepth      ?? 0.35;

  const yearsTotal = (targetDateMs - baseDateMs) / (365.25 * 24 * 3600 * 1000);

  // Compute fundamental trend price (same formula as before)
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

  // Apply halving-cycle phase modulation only for meaningful projections.
  // Scenario "cero" uses corrDepth=0 by convention (set in buildZeroGrowthHypotheses).
  const phase = corrDepth > 0
    ? cyclePhaseMultiplier(yearsTotal * 12, cycleLen, corrDepth)
    : 1.0;

  const price = trend * phase;

  // Hard capitalisation ceiling
  return Math.min(Math.max(price, basePrice * 0.01), basePrice * maxMult);
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

// Max price multiplier from base price (capitalisation ceiling) — SCENARIO-DEPENDENT.
//
// Root cause of the 2044 inversion (Favorable > Muy_favorable > Optimista):
//   With fixed-EUR contributions, higher-scenario prices are higher, so each €200
//   buys FEWER tokens. If every scenario hits the SAME cap by 2044, the scenario that
//   accumulated the most tokens (cheapest = Favorable) ends up worth the most.
//
// Fix: each scenario gets its own ceiling proportional to the market-cap thesis it implies.
//   Optimista assumes BTC could reach ≈€1.4M (≈€28T market cap — extreme but self-consistent).
//   Conservador assumes a lower peak (≈€370K, ≈€7.4T) matching its slow-growth thesis.
//   This ensures Optimista final price always exceeds Favorable even with fewer tokens.
//
// BTC Optimista ×15: €93K → max ≈€1 395K (≈€27.9T market cap)
// BTC Base ×7      : €93K → max ≈€651K   (≈€13.0T market cap, unchanged vs previous)
// BTC Conservador ×4: €93K → max ≈€372K  (≈€7.4T market cap)

type ScenarioMultiplierMap = Partial<Record<ScenarioKey, number>> & { default: number };

const MAX_PRICE_MULTIPLIERS: Record<string, ScenarioMultiplierMap> = {
  BTC:  { conservador: 4, moderado: 5, base: 7, favorable: 9,  muy_favorable: 12, optimista: 15, default: 7  },
  ETH:  { conservador: 4, moderado: 5, base: 7, favorable: 9,  muy_favorable: 12, optimista: 14, default: 7  },
  SOL:  { conservador: 5, moderado: 7, base: 10, favorable: 13, muy_favorable: 17, optimista: 20, default: 10 },
  SUI:  { conservador: 4, moderado: 6, base: 8,  favorable: 11, muy_favorable: 14, optimista: 18, default: 8  },
  BNB:  { conservador: 4, moderado: 5, base: 7,  favorable: 9,  muy_favorable: 11, optimista: 13, default: 7  },
  ADA:  { conservador: 3, moderado: 5, base: 7,  favorable: 9,  muy_favorable: 11, optimista: 13, default: 7  },
  DOT:  { conservador: 3, moderado: 5, base: 7,  favorable: 9,  muy_favorable: 11, optimista: 13, default: 7  },
  AVAX: { conservador: 4, moderado: 6, base: 9,  favorable: 12, muy_favorable: 15, optimista: 18, default: 9  },
  LINK: { conservador: 4, moderado: 6, base: 9,  favorable: 12, muy_favorable: 15, optimista: 18, default: 9  },
};

// Fallback multipliers for unlisted assets (altcoins without a specific profile)
const DEFAULT_MULTIPLIERS: Record<ScenarioKey | "default", number> = {
  conservador: 3, moderado: 4, base: 5, favorable: 6, muy_favorable: 8, optimista: 10, default: 5,
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
  dynamicFactors?: {
    fearAndGreedIndex: number | null;
    btcDominance: number | null;
    // Per-asset sentiment scores (-100..+100) derived from 30d price analysis
    assetSentiment?: Record<string, { score: number; direction: string; confidence: number }>;
  },
): ScenarioHypotheses {

  function getDynamicRate(assetId: string): number {
    const conservativeRate = INITIAL_RATES[assetId]?.conservador ?? DEFAULT_RATES.conservador;
    const baseRate         = INITIAL_RATES[assetId]?.base        ?? DEFAULT_RATES.base;
    const optimisticRate   = INITIAL_RATES[assetId]?.optimista   ?? DEFAULT_RATES.optimista;

    // Prefer per-asset sentiment score when available (30d trend + momentum + Fear&Greed)
    // Fall back to global Fear & Greed if no per-asset data.
    const perAsset = dynamicFactors?.assetSentiment?.[assetId];
    let score: number; // -100..+100
    if (perAsset && typeof perAsset.score === "number" && Number.isFinite(perAsset.score)) {
      // Weight per-asset sentiment by its own confidence; blend with Fear&Greed for robustness
      const fg = dynamicFactors?.fearAndGreedIndex ?? 50;
      const fgScore = (fg - 50) * 2; // 0..100 → -100..+100
      const w = Math.min(1, Math.max(0, perAsset.confidence / 100));
      score = w * perAsset.score + (1 - w) * fgScore;
    } else {
      // Only Fear & Greed available
      const fg = dynamicFactors?.fearAndGreedIndex ?? 50;
      score = (fg - 50) * 2;
    }

    // Map score (-100..+100) to a growth rate between conservador and optimista
    const t = (Math.max(-100, Math.min(100, score)) + 100) / 200; // 0..1
    if (t < 0.25) return conservativeRate * (t * 4); // very bearish → low conservative
    if (t < 0.5)  return conservativeRate + (baseRate - conservativeRate) * ((t - 0.25) * 4);
    if (t < 0.75) return baseRate + (optimisticRate - baseRate) * 0.4 * ((t - 0.5) * 4);
    return baseRate + (optimisticRate - baseRate) * (0.4 + 0.6 * ((t - 0.75) * 4));
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
    const assetMults   = MAX_PRICE_MULTIPLIERS[assetId];
    const effectiveSKey = isStatic ? sKey : "base";
    const maxMult      = assetMults
      ? (assetMults[effectiveSKey as ScenarioKey] ?? assetMults.default)
      : (DEFAULT_MULTIPLIERS[effectiveSKey as ScenarioKey] ?? DEFAULT_MULTIPLIERS.default);
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

// Returns hypotheses for CERO control scenario: 0% growth, prices stay flat.
// No decay, no cap needed — prices never move.
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
    hypothesis: "Sin crecimiento de mercado — suelo mínimo garantizado por aportaciones",
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
