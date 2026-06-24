// ─── ARCHIVO DEPRECADO — NO USAR EN PRODUCCIÓN ───────────────────────────────
// Este modelo interno de precios por ciclos NO se usa en Perspectivas.
// El motor de Perspectivas usa exclusivamente previsiones externas verificables.
// Fuente de precios activa: external-price-builder.ts
// NO importar este archivo en código de producción.
// Se conserva únicamente como referencia histórica.
// ─────────────────────────────────────────────────────────────────────────────
// Genera trayectorias de precio mensuales basadas en ciclos de mercado reales.
// Cada ciclo pasa por: acumulación → recuperación → alcista → euforia →
//   distribución → bajista → capitulación → fondo
// La trayectoria es determinista y reproducible dado assetId + escenario.

import type { SimScenario, AssetTier } from "./types";
import type { ForecastConsensus } from "./forecast-sources";

// ─── Clasificación de tier ───────────────────────────────────────────────────

const KNOWN_TIERS: Record<string, AssetTier> = {
  bitcoin:            "store_of_value",
  ethereum:           "large_cap",
  binancecoin:        "large_cap",
  solana:             "mid_cap",
  cardano:            "mid_cap",
  avalanche:          "mid_cap",
  polkadot:           "mid_cap",
  chainlink:          "mid_cap",
  "the-open-network": "mid_cap",
  toncoin:            "mid_cap",
  optimism:           "small_cap",
  arbitrum:           "small_cap",
  sui:                "small_cap",
  sei:                "small_cap",
  aptos:              "small_cap",
  near:               "small_cap",
  injective:          "small_cap",
};

const SYMBOL_TIERS: Record<string, AssetTier> = {
  BTC:  "store_of_value",
  ETH:  "large_cap",
  BNB:  "large_cap",
  SOL:  "mid_cap",
  ADA:  "mid_cap",
  AVAX: "mid_cap",
  DOT:  "mid_cap",
  LINK: "mid_cap",
  TON:  "mid_cap",
  OP:   "small_cap",
  ARB:  "small_cap",
  SUI:  "small_cap",
  SEI:  "small_cap",
  APT:  "small_cap",
  NEAR: "small_cap",
  INJ:  "small_cap",
};

// Suministro circulante aprox. en millones de tokens (fuentes: CMC/CoinGecko/docs, 2025)
export const CIRCULATING_SUPPLY_M: Record<string, number> = {
  BTC:   21,        // 21M máximo; ~19.8M minados
  ETH:   120,       // ~120M (sin límite duro)
  BNB:   145,       // ~145M (quemas periódicas)
  SOL:   580,       // ~580M
  ADA:   36_000,    // ~36B (de 45B max)
  AVAX:  400,       // ~400M
  DOT:   1_500,     // ~1.5B
  LINK:  600,       // ~600M (de 1B max)
  TON:   5_000,     // ~5B
  OP:    4_300,     // ~4.3B en circulación
  ARB:   10_000,    // ~10B en circulación
  SUI:   3_500,     // ~3.5B en circulación (de ~10B emitidos)
  SEI:   4_500,     // ~4.5B en circulación (de ~10B emitidos)
  APT:   1_100,     // ~1.1B
  NEAR:  1_100,     // ~1.1B
  INJ:   100,       // ~100M
};

export function getAssetTier(assetId: string): AssetTier {
  const lower = assetId.toLowerCase();
  if (KNOWN_TIERS[lower]) return KNOWN_TIERS[lower];
  const upper = assetId.toUpperCase();
  if (SYMBOL_TIERS[upper]) return SYMBOL_TIERS[upper];
  return "speculative";
}

// ─── Fases del ciclo de mercado ───────────────────────────────────────────────

export type CyclePhase =
  | "accumulation"
  | "recovery"
  | "bull"
  | "euphoria"
  | "distribution"
  | "bear"
  | "capitulation"
  | "bottom";

const PHASES: CyclePhase[] = [
  "accumulation", "recovery", "bull", "euphoria",
  "distribution", "bear", "capitulation", "bottom",
];

// Distribución temporal de fases (suma = 1.0)
const PHASE_WEIGHTS: Record<CyclePhase, number> = {
  accumulation:  0.20,
  recovery:      0.15,
  bull:          0.20,
  euphoria:      0.08,
  distribution:  0.07,
  bear:          0.15,
  capitulation:  0.08,
  bottom:        0.07,  // absorbe el resto
};

// Volatilidad mensual por fase (como fracción del precio)
const PHASE_VOLATILITY: Record<CyclePhase, number> = {
  accumulation:  0.08,
  recovery:      0.10,
  bull:          0.15,
  euphoria:      0.22,
  distribution:  0.18,
  bear:          0.12,
  capitulation:  0.25,
  bottom:        0.09,
};

// ─── Parámetros de ciclo por escenario y tier ────────────────────────────────

// Duración total del ciclo en meses
const CYCLE_MONTHS: Record<SimScenario, Record<AssetTier, number>> = {
  conservador: { store_of_value: 60, large_cap: 48, mid_cap: 42, small_cap: 36, speculative: 30 },
  moderado:    { store_of_value: 54, large_cap: 48, mid_cap: 42, small_cap: 36, speculative: 30 },
  base:        { store_of_value: 48, large_cap: 42, mid_cap: 36, small_cap: 30, speculative: 24 },
  favorable:   { store_of_value: 42, large_cap: 36, mid_cap: 30, small_cap: 24, speculative: 20 },
  optimista:   { store_of_value: 36, large_cap: 30, mid_cap: 24, small_cap: 20, speculative: 18 },
};

// Multiplicador de precio en el pico del ciclo (sobre el precio de inicio del ciclo)
const CYCLE_PEAK_MULT: Record<SimScenario, Record<AssetTier, number>> = {
  conservador: { store_of_value: 1.5,  large_cap: 1.8,  mid_cap: 2.0,  small_cap: 2.5,  speculative: 1.5 },
  moderado:    { store_of_value: 2.5,  large_cap: 3.0,  mid_cap: 3.5,  small_cap: 4.0,  speculative: 2.0 },
  base:        { store_of_value: 4.0,  large_cap: 5.0,  mid_cap: 6.0,  small_cap: 8.0,  speculative: 4.0 },
  favorable:   { store_of_value: 7.0,  large_cap: 9.0,  mid_cap: 12.0, small_cap: 15.0, speculative: 8.0 },
  optimista:   { store_of_value: 12.0, large_cap: 15.0, mid_cap: 20.0, small_cap: 25.0, speculative: 15.0 },
};

// Drawdown desde el pico hasta el valle de capitulación
const CYCLE_DRAWDOWN: Record<SimScenario, Record<AssetTier, number>> = {
  conservador: { store_of_value: 0.55, large_cap: 0.65, mid_cap: 0.72, small_cap: 0.80, speculative: 0.90 },
  moderado:    { store_of_value: 0.50, large_cap: 0.60, mid_cap: 0.68, small_cap: 0.75, speculative: 0.85 },
  base:        { store_of_value: 0.45, large_cap: 0.55, mid_cap: 0.65, small_cap: 0.72, speculative: 0.82 },
  favorable:   { store_of_value: 0.40, large_cap: 0.50, mid_cap: 0.60, small_cap: 0.68, speculative: 0.78 },
  optimista:   { store_of_value: 0.35, large_cap: 0.45, mid_cap: 0.55, small_cap: 0.62, speculative: 0.72 },
};

// Precio de inicio del siguiente ciclo relativo al valle (crecimiento inter-ciclo)
const NEXT_CYCLE_MULT: Record<SimScenario, number> = {
  conservador: 1.00,
  moderado:    1.25,
  base:        1.50,
  favorable:   2.00,
  optimista:   3.00,
};

// ─── Utilidades ───────────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

// Convierte string a número semilla (FNV-1a)
function strToSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Ruido determinista [-0.5, 0.5] desde número semilla
function noiseN(n: number): number {
  let h = n | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b);
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b);
  h ^= h >>> 16;
  return ((h >>> 0) % 1_000_000) / 1_000_000 - 0.5;
}

// Ruido calibrado por fase: distribución aprox. normal via suma de 3 uniformes
function phaseNoise(assetSeed: number, monthIdx: number, scenarioSeed: number, volatility: number): number {
  const n1 = noiseN(assetSeed + monthIdx * 997   + scenarioSeed);
  const n2 = noiseN(assetSeed + monthIdx * 9973  + scenarioSeed * 3);
  const n3 = noiseN(assetSeed + monthIdx * 99991 + scenarioSeed * 7);
  const approxNormal = (n1 + n2 + n3) / 1.5; // [-1, 1]
  return approxNormal * volatility;
}

// ─── Precio base por fase ─────────────────────────────────────────────────────

function priceForPhase(
  cycleStart: number,
  peak: number,
  valley: number,
  nextCycleStart: number,
  phase: CyclePhase,
  t: number, // 0..1 dentro de la fase
): number {
  switch (phase) {
    case "accumulation": return lerp(cycleStart,        cycleStart * 1.05,  t);
    case "recovery":     return lerp(cycleStart * 1.05, peak * 0.40,        t);
    case "bull":         return lerp(peak * 0.40,       peak * 0.85,        t);
    case "euphoria":     return lerp(peak * 0.85,       peak,               t);
    case "distribution": return lerp(peak,              peak * 0.85,        t);
    case "bear": {
      // Cap bearEnd below distribution start so this phase is ALWAYS downward.
      // Without the cap, low-drawdown scenarios (favorable/optimista) produce
      // valley×1.5 > peak×0.85, making "bear" go upward — a clear bug.
      const bearEnd = Math.min(valley * 1.50, peak * 0.75);
      return lerp(peak * 0.85, bearEnd, t);
    }
    case "capitulation": {
      const bearEnd = Math.min(valley * 1.50, peak * 0.75);
      return lerp(bearEnd, valley, t);
    }
    case "bottom":       return lerp(valley,            nextCycleStart,     t);
  }
}

// ─── Punto de precio ─────────────────────────────────────────────────────────

export interface PricePoint {
  monthDate: number;
  priceEur: number;
  phase?: CyclePhase;
}

// ─── Generación de trayectoria de precios ─────────────────────────────────────

export function buildPricePath(
  assetId: string,
  currentPriceEur: number,
  scenario: SimScenario,
  startDate: number,
  horizonDate: number,
  consensus?: ForecastConsensus,  // ajuste opcional basado en analistas
): PricePoint[] {
  const tier = getAssetTier(assetId);
  const cycleDuration = CYCLE_MONTHS[scenario][tier];
  // Aplica ajuste de consenso de analistas al multiplicador de pico (±30% máx).
  const basePeakMult  = CYCLE_PEAK_MULT[scenario][tier];
  const peakMult      = consensus
    ? basePeakMult * (1 + consensus.peakMultAdjustment)
    : basePeakMult;
  const drawdownFrac  = CYCLE_DRAWDOWN[scenario][tier];
  const nextMult      = NEXT_CYCLE_MULT[scenario];

  const assetSeed    = strToSeed(assetId);
  const scenarioSeed = strToSeed(scenario);

  // Compute phase durations (integers summing to cycleDuration)
  const phaseDurations: Record<CyclePhase, number> = {} as Record<CyclePhase, number>;
  let totalAssigned = 0;
  for (let i = 0; i < PHASES.length - 1; i++) {
    const ph = PHASES[i];
    phaseDurations[ph] = Math.round(PHASE_WEIGHTS[ph] * cycleDuration);
    totalAssigned += phaseDurations[ph];
  }
  phaseDurations["bottom"] = Math.max(1, cycleDuration - totalAssigned);

  // Cumulative phase starts within cycle
  const phaseStarts: Record<CyclePhase, number> = {} as Record<CyclePhase, number>;
  let cumulative = 0;
  for (const ph of PHASES) {
    phaseStarts[ph] = cumulative;
    cumulative += phaseDurations[ph];
  }

  // Compute cycle start price for cycle N (iterative, max ~8 cycles over 20y)
  function cycleStartPrice(cycleNum: number): number {
    let price = currentPriceEur;
    for (let i = 0; i < cycleNum; i++) {
      const p = price * peakMult;
      const v = p * (1 - drawdownFrac);
      price = v * nextMult;
    }
    return price;
  }

  // Compute price and phase for global month index m (1-based)
  function computeMonth(m: number): { priceEur: number; phase: CyclePhase } {
    const cycleNum    = Math.floor(m / cycleDuration);
    const idxInCycle  = m % cycleDuration;

    const cStart      = cycleStartPrice(cycleNum);
    const peak        = cStart * peakMult;
    const valley      = peak * (1 - drawdownFrac);
    const nextStart   = valley * nextMult;

    let currentPhase: CyclePhase = "bottom";
    let phaseProgress = 0;
    for (const ph of PHASES) {
      const phStart = phaseStarts[ph];
      const phDur   = phaseDurations[ph];
      if (idxInCycle >= phStart && idxInCycle < phStart + phDur) {
        currentPhase  = ph;
        phaseProgress = phDur > 1 ? (idxInCycle - phStart) / (phDur - 1) : 0;
        break;
      }
    }

    const base  = priceForPhase(cStart, peak, valley, nextStart, currentPhase, phaseProgress);
    const noise = phaseNoise(assetSeed, m, scenarioSeed, PHASE_VOLATILITY[currentPhase]);

    // Apply noise multiplicatively; floor at 0.5% of initial price
    const finalPrice = Math.max(base * (1 + noise), currentPriceEur * 0.005);
    return { priceEur: finalPrice, phase: currentPhase };
  }

  // Build the path
  const points: PricePoint[] = [];
  const startD = new Date(startDate);
  startD.setDate(1);
  startD.setHours(0, 0, 0, 0);

  const totalMonths = Math.ceil((horizonDate - startDate) / (30.44 * 24 * 3600 * 1000)) + 2;

  for (let m = 0; m <= totalMonths; m++) {
    const d = new Date(startD);
    d.setMonth(d.getMonth() + m);
    const monthTs = d.getTime();

    if (monthTs > horizonDate + 31 * 24 * 3600 * 1000) break;

    if (m === 0) {
      points.push({ monthDate: monthTs, priceEur: currentPriceEur });
      continue;
    }

    const { priceEur, phase } = computeMonth(m);
    if (monthTs <= horizonDate) {
      points.push({ monthDate: monthTs, priceEur, phase });
    }
  }

  return points;
}

// ─── Mapa de precios "YYYY-MM" → priceEur ────────────────────────────────────

export function buildPriceMap(
  assetId: string,
  currentPriceEur: number,
  scenario: SimScenario,
  startDate: number,
  horizonDate: number,
  consensus?: ForecastConsensus,
): Record<string, number> {
  const path = buildPricePath(assetId, currentPriceEur, scenario, startDate, horizonDate, consensus);
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
