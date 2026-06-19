import type { ScenarioHypotheses, AssetScenarioRates } from "./types";

// Returns the projected price of an asset at a given date.
// Fully deterministic — no randomness. Uses compounded growth from a base price.
export function projectAssetPrice(
  basePrice: number,
  assetId: string,
  baseDateMs: number,
  targetDateMs: number,
  hypotheses: ScenarioHypotheses,
): number | null {
  if (basePrice <= 0) return null;
  if (targetDateMs <= baseDateMs) return basePrice;

  const rate = getAssetAnnualRate(assetId, hypotheses);
  const yearsElapsed = (targetDateMs - baseDateMs) / (365.25 * 24 * 3600 * 1000);
  const multiplier = Math.pow(1 + rate, yearsElapsed);
  return Math.max(0, basePrice * multiplier);
}

export function getAssetAnnualRate(assetId: string, hypotheses: ScenarioHypotheses): number {
  const specific = hypotheses.assetRates.find(r => r.assetId === assetId);
  return specific?.annualGrowthRate ?? hypotheses.defaultAnnualGrowthRate;
}

// Build default scenario hypotheses from a set of base prices.
// Deterministic methodology: rates are fixed by scenario and asset class.
// BTC and ETH have class-specific rates; others use the default.
export function buildDefaultHypotheses(
  scenario: "conservador" | "base" | "optimista" | "dinamico",
  assetIds: string[],
  dynamicFactors?: { fearAndGreedIndex: number | null; btcDominance: number | null },
): ScenarioHypotheses {
  const RATES: Record<string, { conservador: number; base: number; optimista: number }> = {
    BTC:  { conservador: 0.08, base: 0.15, optimista: 0.35 },
    ETH:  { conservador: 0.07, base: 0.18, optimista: 0.45 },
    SOL:  { conservador: 0.06, base: 0.20, optimista: 0.60 },
    SUI:  { conservador: 0.05, base: 0.22, optimista: 0.70 },
    BNB:  { conservador: 0.06, base: 0.15, optimista: 0.40 },
    ADA:  { conservador: 0.04, base: 0.12, optimista: 0.45 },
    DOT:  { conservador: 0.04, base: 0.13, optimista: 0.50 },
    AVAX: { conservador: 0.05, base: 0.18, optimista: 0.55 },
    LINK: { conservador: 0.06, base: 0.17, optimista: 0.50 },
  };

  const DEFAULTS: Record<string, number> = {
    conservador: 0.05,
    base: 0.12,
    optimista: 0.40,
  };

  function getDynamicRate(assetId: string): number {
    // Dynamic: base adjusted by Fear & Greed (0-100 index)
    // F&G < 25 → conservative, 25-50 → base, 50-75 → base+, >75 → optimistic
    const fg = dynamicFactors?.fearAndGreedIndex ?? 50;
    const baseRate = RATES[assetId]?.base ?? DEFAULTS.base;
    const optimisticRate = RATES[assetId]?.optimista ?? DEFAULTS.optimista;
    const conservativeRate = RATES[assetId]?.conservador ?? DEFAULTS.conservador;

    if (fg < 25) return conservativeRate;
    if (fg < 50) return conservativeRate + (baseRate - conservativeRate) * ((fg - 25) / 25);
    if (fg < 75) return baseRate + (optimisticRate - baseRate) * ((fg - 50) / 25) * 0.5;
    return baseRate + (optimisticRate - baseRate) * 0.6;
  }

  const assetRates: AssetScenarioRates[] = assetIds.map(assetId => {
    let annualGrowthRate: number;
    if (scenario === "dinamico") {
      annualGrowthRate = getDynamicRate(assetId);
    } else {
      annualGrowthRate = RATES[assetId]?.[scenario] ?? DEFAULTS[scenario];
    }
    return {
      assetId,
      annualGrowthRate,
      volatility: scenario === "conservador" ? 0.3 : scenario === "optimista" ? 0.8 : 0.5,
      correctionDepth: scenario === "conservador" ? 0.5 : scenario === "optimista" ? 0.3 : 0.4,
      source: RATES[assetId] ? "crypto-control:asset-profile-v1" : "crypto-control:default-altcoin-profile-v1",
      hypothesis: RATES[assetId]
        ? `Perfil propio ${assetId} para escenario ${scenario}; no se reutiliza BTC como proxy.`
        : `Activo sin perfil propio: usa hipótesis conservadora genérica para no extrapolar BTC.`,
      dataQuality: RATES[assetId] ? "media" : "baja",
      confidence: RATES[assetId] ? 0.65 : 0.35,
    };
  });

  const PROBS: Record<string, number | null> = {
    conservador: 0.25,
    base: 0.45,
    optimista: 0.15,
    dinamico: null,
  };

  const DYNAMIC_CONFIDENCE = dynamicFactors
    ? Math.max(0.2, 0.5 - (dynamicFactors.fearAndGreedIndex == null ? 0.2 : 0))
    : 0.3;

  const CONFS: Record<string, number> = {
    conservador: 0.7,
    base: 0.6,
    optimista: 0.4,
    dinamico: DYNAMIC_CONFIDENCE,
  };

  const LABELS: Record<string, string> = {
    conservador: "Conservador",
    base: "Base",
    optimista: "Optimista",
    dinamico: "Dinámico actual",
  };

  const DESCS: Record<string, string> = {
    conservador: "Crecimiento moderado, correcciones frecuentes, acumulación constante.",
    base: "Ciclo alcista de intensidad media con correcciones habituales.",
    optimista: "Ciclo alcista fuerte con máximos históricos superados.",
    dinamico: "Proyección recalculada con los datos de mercado actuales disponibles.",
  };

  const PHASES: Record<string, "bull" | "bear" | "sideways" | "unknown"> = {
    conservador: "sideways",
    base: "bull",
    optimista: "bull",
    dinamico: "unknown",
  };

  return {
    scenario,
    label: LABELS[scenario],
    description: DESCS[scenario],
    probability: PROBS[scenario] ?? null,
    confidence: CONFS[scenario],
    assetRates,
    defaultAnnualGrowthRate: DEFAULTS[scenario === "dinamico" ? "base" : scenario],
    marketPhase: PHASES[scenario],
    dynamicFactors: dynamicFactors
      ? {
          fearAndGreedIndex: dynamicFactors.fearAndGreedIndex,
          btcDominance: dynamicFactors.btcDominance ?? null,
          globalMarketCapEur: null,
          generatedAt: Date.now(),
          sourcesUsed: dynamicFactors.fearAndGreedIndex != null ? ["fear_and_greed"] : [],
          sourcesUnavailable: dynamicFactors.fearAndGreedIndex == null ? ["fear_and_greed"] : [],
          confidence: DYNAMIC_CONFIDENCE,
        }
      : undefined,
  };
}
