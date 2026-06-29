import type { AssetTier, SimScenario } from "./types";
import { monthKey } from "./external-price-builder";

export type MarketRegime =
  | "ACCUMULATION"
  | "EARLY_BULL"
  | "BULL_EXPANSION"
  | "EUPHORIA"
  | "DISTRIBUTION"
  | "CORRECTION"
  | "BEAR_MARKET"
  | "CAPITULATION"
  | "EARLY_RECOVERY"
  | "LATERAL"
  | "INSUFFICIENT_DATA";

export interface MarketRegimePoint {
  month: string;
  regime: MarketRegime;
  marketReturn: number;
  assetReturn: number;
  priceEur: number;
  drawdownFromPeak: number;
  sourceTimestamp: number;
  fetchedAt: number;
  expiresAt: number;
  provider: string;
  reliability: number;
  confidence: number;
  freshnessStatus: "fresh" | "stale" | "expired";
}

export interface MarketIntelligenceSnapshot {
  assetId: string;
  generatedAt: number;
  priceEur: number;
  dailyTrend: number | null;
  weeklyTrend: number | null;
  monthlyTrend: number | null;
  momentum: number | null;
  volatility: number | null;
  volume: number | null;
  distanceFromHigh: number | null;
  currentDrawdown: number | null;
  supports: number[];
  resistances: number[];
  funding: number | null;
  openInterest: number | null;
  liquidations: number | null;
  onChainFlows: number | null;
  whaleActivity: number | null;
  fundamentalHealth: "strong" | "neutral" | "weak" | "unknown";
  protocolRisk: "low" | "medium" | "high" | "unknown";
  regulatoryRisk: "low" | "medium" | "high" | "unknown";
  macroContext: "risk_on" | "neutral" | "risk_off" | "unknown";
  marketSentiment: "fear" | "neutral" | "greed" | "unknown";
  analystConsensus: "bearish" | "neutral" | "bullish" | "unknown";
  mediaConsensus: "bearish" | "neutral" | "bullish" | "unknown";
  detectedRegime: MarketRegime;
  dataQuality: "high" | "medium" | "low" | "insufficient";
  provider: string;
  confidence: number;
  sourceTimestamps: Record<string, number | null>;
  expiresAt: number;
}

export interface MarketRegimePath {
  pricesByMonth: Record<string, number>;
  regimesByMonth: Record<string, MarketRegime>;
  points: MarketRegimePoint[];
  intelligence: MarketIntelligenceSnapshot;
  seed: number;
}

export interface HistoricalMarketBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  marketCap: number | null;
  provider: string;
}

export interface ClassifiedMarketRegime {
  timestamp: number;
  regime: MarketRegime;
  probableRegime: MarketRegime;
  confirmed: boolean;
  confidence: number;
  signals: string[];
}

interface RegimeParameters {
  expectedReturn: number;
  volatility: number;
  drawdownShock: number;
}

const REGIME_PARAMS: Record<MarketRegime, RegimeParameters> = {
  ACCUMULATION:      { expectedReturn:  0.012, volatility: 0.055, drawdownShock: 0.00 },
  EARLY_BULL:        { expectedReturn:  0.045, volatility: 0.085, drawdownShock: 0.00 },
  BULL_EXPANSION:    { expectedReturn:  0.070, volatility: 0.120, drawdownShock: 0.00 },
  EUPHORIA:          { expectedReturn:  0.090, volatility: 0.180, drawdownShock: 0.08 },
  DISTRIBUTION:      { expectedReturn: -0.010, volatility: 0.130, drawdownShock: 0.10 },
  CORRECTION:        { expectedReturn: -0.075, volatility: 0.120, drawdownShock: 0.18 },
  BEAR_MARKET:       { expectedReturn: -0.055, volatility: 0.100, drawdownShock: 0.12 },
  CAPITULATION:      { expectedReturn: -0.160, volatility: 0.180, drawdownShock: 0.30 },
  EARLY_RECOVERY:    { expectedReturn:  0.035, volatility: 0.110, drawdownShock: 0.00 },
  LATERAL:           { expectedReturn:  0.000, volatility: 0.060, drawdownShock: 0.02 },
  INSUFFICIENT_DATA: { expectedReturn:  0.000, volatility: 0.000, drawdownShock: 0.00 },
};

const TRANSITIONS: Record<Exclude<MarketRegime, "INSUFFICIENT_DATA">, Partial<Record<MarketRegime, number>>> = {
  ACCUMULATION:   { ACCUMULATION: 0.38, EARLY_BULL: 0.32, LATERAL: 0.18, CORRECTION: 0.12 },
  EARLY_BULL:     { EARLY_BULL: 0.34, BULL_EXPANSION: 0.36, LATERAL: 0.12, CORRECTION: 0.18 },
  BULL_EXPANSION: { BULL_EXPANSION: 0.30, EUPHORIA: 0.20, DISTRIBUTION: 0.18, CORRECTION: 0.22, LATERAL: 0.10 },
  EUPHORIA:       { EUPHORIA: 0.18, DISTRIBUTION: 0.36, CORRECTION: 0.28, BULL_EXPANSION: 0.18 },
  DISTRIBUTION:   { DISTRIBUTION: 0.26, CORRECTION: 0.34, BEAR_MARKET: 0.18, LATERAL: 0.14, BULL_EXPANSION: 0.08 },
  CORRECTION:     { CORRECTION: 0.30, BEAR_MARKET: 0.22, CAPITULATION: 0.08, LATERAL: 0.18, EARLY_RECOVERY: 0.22 },
  BEAR_MARKET:    { BEAR_MARKET: 0.36, CAPITULATION: 0.18, ACCUMULATION: 0.20, LATERAL: 0.18, EARLY_RECOVERY: 0.08 },
  CAPITULATION:   { CAPITULATION: 0.16, ACCUMULATION: 0.38, LATERAL: 0.24, EARLY_RECOVERY: 0.22 },
  EARLY_RECOVERY: { EARLY_RECOVERY: 0.28, ACCUMULATION: 0.22, EARLY_BULL: 0.26, LATERAL: 0.16, CORRECTION: 0.08 },
  LATERAL:        { LATERAL: 0.34, ACCUMULATION: 0.22, EARLY_BULL: 0.16, CORRECTION: 0.18, BEAR_MARKET: 0.10 },
};

const TIER_BETA: Record<AssetTier, number> = {
  store_of_value: 0.82,
  large_cap: 1.00,
  mid_cap: 1.28,
  small_cap: 1.62,
  speculative: 1.95,
};

const PEAK_FLOOR_BY_TIER: Record<AssetTier, number> = {
  store_of_value: 0.16,
  large_cap: 0.05,
  mid_cap: 0.03,
  small_cap: 0.015,
  speculative: 0.005,
};

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rand: () => number): number {
  const u = Math.max(1e-9, rand());
  const v = Math.max(1e-9, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function scenarioReturnTilt(scenario: SimScenario): number {
  if (scenario === "conservador") return -0.045;
  if (scenario === "moderado") return -0.018;
  if (scenario === "base") return 0;
  if (scenario === "favorable") return 0.030;
  return 0.055;
}

function tierSpecificReturn(tier: AssetTier, regime: MarketRegime): number {
  if (tier === "store_of_value" && (regime === "EARLY_RECOVERY" || regime === "ACCUMULATION")) return 0.010;
  if ((tier === "small_cap" || tier === "speculative") && (regime === "BEAR_MARKET" || regime === "CAPITULATION")) return -0.055;
  if ((tier === "small_cap" || tier === "speculative") && regime === "EUPHORIA") return 0.055;
  if (tier === "mid_cap" && regime === "BULL_EXPANSION") return 0.018;
  return 0;
}

function monthCount(nowMs: number, horizonMs: number): number {
  const d = new Date(nowMs);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() + 1);
  let count = 0;
  while (d.getTime() <= horizonMs) {
    count++;
    d.setMonth(d.getMonth() + 1);
  }
  return count;
}

function scenarioTransitionTilt(scenario: SimScenario, next: MarketRegime): number {
  const bearish = next === "CORRECTION" || next === "BEAR_MARKET" || next === "CAPITULATION";
  const bullish = next === "EARLY_BULL" || next === "BULL_EXPANSION" || next === "EUPHORIA" || next === "EARLY_RECOVERY";
  if (scenario === "conservador") return bearish ? 1.70 : bullish ? 0.55 : 1.12;
  if (scenario === "moderado") return bearish ? 1.25 : bullish ? 0.82 : 1.08;
  if (scenario === "favorable") return bearish ? 0.58 : bullish ? 1.45 : 0.92;
  if (scenario === "optimista") return bearish ? 0.38 : bullish ? 1.85 : 0.82;
  return 1;
}

function tierTransitionTilt(tier: AssetTier, next: MarketRegime): number {
  const stress = next === "CORRECTION" || next === "BEAR_MARKET" || next === "CAPITULATION";
  const euphoric = next === "EUPHORIA" || next === "BULL_EXPANSION";
  if (tier === "store_of_value") return stress ? 0.82 : euphoric ? 0.92 : 1;
  if (tier === "small_cap" || tier === "speculative") return stress ? 1.26 : euphoric ? 1.16 : 1;
  if (tier === "mid_cap") return stress ? 1.10 : euphoric ? 1.07 : 1;
  return 1;
}

function sampleNextRegime(
  current: MarketRegime,
  scenario: SimScenario,
  tier: AssetTier,
  rand: () => number,
): MarketRegime {
  if (current === "INSUFFICIENT_DATA") return "LATERAL";
  const base = TRANSITIONS[current];
  const weighted = Object.entries(base).map(([regime, weight]) => {
    const next = regime as MarketRegime;
    return [next, (weight ?? 0) * scenarioTransitionTilt(scenario, next) * tierTransitionTilt(tier, next)] as const;
  });
  const total = weighted.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = rand() * total;
  for (const [regime, weight] of weighted) {
    cursor -= weight;
    if (cursor <= 0) return regime;
  }
  return weighted.at(-1)?.[0] ?? "LATERAL";
}

function sampleRegimeDurationMonths(regime: MarketRegime, scenario: SimScenario, rand: () => number): number {
  const base =
    regime === "CAPITULATION" ? 2 :
    regime === "CORRECTION" ? 3 :
    regime === "BEAR_MARKET" ? 7 :
    regime === "LATERAL" ? 5 :
    regime === "ACCUMULATION" ? 5 :
    regime === "EUPHORIA" ? 3 :
    4;
  const scenarioFactor =
    scenario === "conservador" && (regime === "BEAR_MARKET" || regime === "CORRECTION") ? 1.85 :
    scenario === "moderado" && (regime === "BEAR_MARKET" || regime === "CORRECTION") ? 1.20 :
    scenario === "optimista" && (regime === "BEAR_MARKET" || regime === "CORRECTION") ? 0.48 :
    scenario === "favorable" && (regime === "EARLY_BULL" || regime === "BULL_EXPANSION") ? 1.60 :
    scenario === "optimista" && (regime === "EARLY_BULL" || regime === "BULL_EXPANSION" || regime === "EUPHORIA") ? 1.75 :
    1;
  return Math.max(1, Math.round(base * scenarioFactor * (0.55 + rand() * 1.35)));
}

function generateRegimePath(input: {
  currentRegime: MarketRegime;
  scenario: SimScenario;
  tier: AssetTier;
  totalMonths: number;
  rand: () => number;
}): MarketRegime[] {
  const regimes: MarketRegime[] = [];
  let current: MarketRegime = input.currentRegime === "INSUFFICIENT_DATA" ? "LATERAL" : input.currentRegime;
  while (regimes.length < input.totalMonths) {
    const duration = sampleRegimeDurationMonths(current, input.scenario, input.rand);
    for (let i = 0; i < duration && regimes.length < input.totalMonths; i++) {
      regimes.push(current);
    }
    current = sampleNextRegime(current, input.scenario, input.tier, input.rand);
  }
  return regimes;
}

function movingAverage(values: number[], endInclusive: number, length: number): number | null {
  const start = endInclusive - length + 1;
  if (start < 0) return null;
  let sum = 0;
  for (let i = start; i <= endInclusive; i++) sum += values[i];
  return sum / length;
}

function probableRegimeFromSignals(input: {
  close: number;
  drawdown: number;
  return12: number | null;
  return24: number | null;
  ma8: number | null;
  ma20: number | null;
  volumeRatio: number | null;
}): { regime: MarketRegime; confidence: number; signals: string[] } {
  const signals: string[] = [];
  let bull = 0;
  let bear = 0;
  let stress = 0;

  if (input.return12 != null && input.return12 > 0.18) { bull += 2; signals.push("12-period return positive"); }
  if (input.return12 != null && input.return12 < -0.18) { bear += 2; signals.push("12-period return negative"); }
  if (input.return24 != null && input.return24 > 0.35) { bull += 2; signals.push("24-period return positive"); }
  if (input.return24 != null && input.return24 < -0.32) { bear += 2; signals.push("24-period return negative"); }
  if (input.ma8 != null && input.ma20 != null && input.ma8 > input.ma20 && input.close > input.ma8) { bull += 2; signals.push("above rising moving averages"); }
  if (input.ma8 != null && input.ma20 != null && input.ma8 < input.ma20 && input.close < input.ma8) { bear += 2; signals.push("below falling moving averages"); }
  if (input.drawdown > 0.65) { stress += 3; signals.push("capitulation-scale drawdown"); }
  else if (input.drawdown > 0.42) { bear += 3; signals.push("deep sustained drawdown"); }
  else if (input.drawdown > 0.22) { stress += 1; signals.push("material correction"); }
  if (input.volumeRatio != null && input.volumeRatio > 1.35) {
    if (bear > bull) stress += 1;
    else bull += 1;
    signals.push("elevated volume confirms move");
  }

  if (stress >= 3 && bear >= 2) return { regime: "CAPITULATION", confidence: 0.74, signals };
  if (bear >= 5 && input.drawdown > 0.35) return { regime: "BEAR_MARKET", confidence: 0.70, signals };
  if (bear >= 3 && input.drawdown > 0.18) return { regime: "CORRECTION", confidence: 0.62, signals };
  if (bull >= 5 && input.drawdown < 0.18) return { regime: "BULL_EXPANSION", confidence: 0.68, signals };
  if (bull >= 3 && input.drawdown < 0.28) return { regime: "EARLY_BULL", confidence: 0.60, signals };
  if (input.drawdown > 0.28 && bull >= 2) return { regime: "EARLY_RECOVERY", confidence: 0.58, signals };
  if (Math.abs((input.return12 ?? 0)) < 0.12) return { regime: "LATERAL", confidence: 0.55, signals: [...signals, "range-bound return"] };
  return { regime: "ACCUMULATION", confidence: 0.52, signals };
}

export function classifyHistoricalMarketRegimes(
  bars: HistoricalMarketBar[],
  options: { confirmationPeriods?: number; minimumConfidence?: number } = {},
): ClassifiedMarketRegime[] {
  const sorted = [...bars].filter(bar => bar.close > 0).sort((a, b) => a.timestamp - b.timestamp);
  const closes = sorted.map(bar => bar.close);
  const volumes = sorted.map(bar => bar.volume ?? 0);
  const confirmationPeriods = options.confirmationPeriods ?? 3;
  const minimumConfidence = options.minimumConfidence ?? 0.58;
  const output: ClassifiedMarketRegime[] = [];
  let confirmed: MarketRegime = "INSUFFICIENT_DATA";
  let pending: MarketRegime | null = null;
  let pendingCount = 0;
  let peak = 0;

  for (let i = 0; i < sorted.length; i++) {
    const close = closes[i];
    peak = Math.max(peak, close);
    const drawdown = peak > 0 ? (peak - close) / peak : 0;
    const close12 = i >= 12 ? closes[i - 12] : null;
    const close24 = i >= 24 ? closes[i - 24] : null;
    const volume4 = movingAverage(volumes, i, 4);
    const volume20 = movingAverage(volumes, i, 20);
    const probable = probableRegimeFromSignals({
      close,
      drawdown,
      return12: close12 != null ? close / close12 - 1 : null,
      return24: close24 != null ? close / close24 - 1 : null,
      ma8: movingAverage(closes, i, 8),
      ma20: movingAverage(closes, i, 20),
      volumeRatio: volume4 != null && volume20 != null && volume20 > 0 ? volume4 / volume20 : null,
    });

    if (confirmed === "INSUFFICIENT_DATA") {
      confirmed = probable.regime;
      pending = null;
      pendingCount = 0;
    } else if (probable.regime === confirmed || probable.confidence < minimumConfidence) {
      pending = null;
      pendingCount = 0;
    } else if (probable.regime === pending) {
      pendingCount += 1;
      if (pendingCount >= confirmationPeriods) {
        confirmed = probable.regime;
        pending = null;
        pendingCount = 0;
      }
    } else {
      pending = probable.regime;
      pendingCount = 1;
    }

    output.push({
      timestamp: sorted[i].timestamp,
      regime: confirmed,
      probableRegime: probable.regime,
      confirmed: pending == null,
      confidence: probable.confidence,
      signals: probable.signals,
    });
  }
  return output;
}

export function buildMarketRegimePricePath(input: {
  assetId: string;
  tier: AssetTier;
  scenario: SimScenario;
  currentPriceEur: number;
  nowMs: number;
  horizonMs: number;
  anchorPricesByMonth: Record<string, number>;
  currentRegime?: MarketRegime;
  seed?: number;
}): MarketRegimePath {
  const totalMonths = monthCount(input.nowMs, input.horizonMs);
  const seed = input.seed ?? hashSeed(`${input.assetId}:${input.scenario}:${input.nowMs}:${input.horizonMs}`);
  const rand = mulberry32(seed);
  const assetSeed = hashSeed(input.assetId);
  const beta = TIER_BETA[input.tier];
  const tilt = scenarioReturnTilt(input.scenario);
  const rawPrices: number[] = [];
  const months: string[] = [];
  const regimes = generateRegimePath({
    currentRegime: input.currentRegime ?? "LATERAL",
    scenario: input.scenario,
    tier: input.tier,
    totalMonths,
    rand,
  });

  let price = input.currentPriceEur;
  const d = new Date(input.nowMs);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() + 1);

  for (let i = 0; i < totalMonths; i++) {
    const mKey = monthKey(d.getTime());
    const regime = regimes[i] ?? "LATERAL";
    const params = REGIME_PARAMS[regime];
    const correlated = normal(rand) * params.volatility;
    const idiosyncratic = normal(rand) * params.volatility * (input.tier === "store_of_value" ? 0.25 : 0.55);
    const scheduledShock = params.drawdownShock > 0 && (i + assetSeed) % 7 === 0 ? -params.drawdownShock : 0;
    const assetReturn = Math.max(
      -0.82,
      Math.min(1.25, (params.expectedReturn + tilt) * beta + tierSpecificReturn(input.tier, regime) + correlated * beta + idiosyncratic + scheduledShock),
    );
    price = Math.max(0.000001, price * (1 + assetReturn));
    months.push(mKey);
    rawPrices.push(price);
    d.setMonth(d.getMonth() + 1);
  }

  if (rawPrices.length === 0) {
    return {
      pricesByMonth: {},
      regimesByMonth: {},
      points: [],
      intelligence: {
        assetId: input.assetId,
        generatedAt: input.nowMs,
        priceEur: input.currentPriceEur,
        dailyTrend: null,
        weeklyTrend: null,
        monthlyTrend: null,
        momentum: null,
        volatility: null,
        volume: null,
        distanceFromHigh: null,
        currentDrawdown: null,
        supports: [],
        resistances: [],
        funding: null,
        openInterest: null,
        liquidations: null,
        onChainFlows: null,
        whaleActivity: null,
        fundamentalHealth: "unknown",
        protocolRisk: "unknown",
        regulatoryRisk: "unknown",
        macroContext: "unknown",
        marketSentiment: "unknown",
        analystConsensus: "unknown",
        mediaConsensus: "unknown",
        detectedRegime: "INSUFFICIENT_DATA",
        dataQuality: "insufficient",
        provider: "market-regime-engine",
        confidence: 0,
        sourceTimestamps: {},
        expiresAt: input.nowMs,
      },
      seed,
    };
  }

  const lastMonth = months[months.length - 1];
  const targetFinal = input.anchorPricesByMonth[lastMonth] ?? rawPrices[rawPrices.length - 1];
  const scaleFinal = targetFinal > 0 && rawPrices[rawPrices.length - 1] > 0
    ? targetFinal / rawPrices[rawPrices.length - 1]
    : 1;
  const pricesByMonth: Record<string, number> = {};
  const regimesByMonth: Record<string, MarketRegime> = {};
  const points: MarketRegimePoint[] = [];
  let peak = input.currentPriceEur;

  for (let i = 0; i < rawPrices.length; i++) {
    const progress = (i + 1) / rawPrices.length;
    const anchor = input.anchorPricesByMonth[months[i]];
    const endScaled = rawPrices[i] * Math.pow(scaleFinal, progress);
    const anchored = anchor != null ? endScaled * 0.72 + anchor * 0.28 : endScaled;
    const tierPeakFloor = peak > 0 ? peak * PEAK_FLOOR_BY_TIER[input.tier] : 0;
    const floorRipple = tierPeakFloor > 0
      ? Math.max(0, Math.sin((i + 1 + (assetSeed % 11)) * 0.73) * 0.075 + normal(rand) * 0.025)
      : 0;
    const dynamicFloor = tierPeakFloor * (1 + floorRipple);
    const finalPrice = Math.max(0.000001, dynamicFloor, anchored);
    peak = Math.max(peak, finalPrice);
    const previous = i === 0 ? input.currentPriceEur : pricesByMonth[months[i - 1]];
    pricesByMonth[months[i]] = finalPrice;
    regimesByMonth[months[i]] = regimes[i];
    points.push({
      month: months[i],
      regime: regimes[i],
      marketReturn: previous > 0 ? finalPrice / previous - 1 : 0,
      assetReturn: previous > 0 ? finalPrice / previous - 1 : 0,
      priceEur: finalPrice,
      drawdownFromPeak: peak > 0 ? Math.max(0, (peak - finalPrice) / peak) : 0,
      sourceTimestamp: input.nowMs,
      fetchedAt: input.nowMs,
      expiresAt: input.nowMs + 30 * 24 * 3600 * 1000,
      provider: "market-regime-engine",
      reliability: 0.72,
      confidence: input.scenario === "base" ? 0.68 : 0.58,
      freshnessStatus: "fresh",
    });
  }

  const last = points[points.length - 1];
  const first = points[0];
  const returns = points.map(p => p.assetReturn);
  const avg = returns.reduce((s, r) => s + r, 0) / Math.max(1, returns.length);
  const vol = Math.sqrt(returns.reduce((s, r) => s + Math.pow(r - avg, 2), 0) / Math.max(1, returns.length));

  return {
    pricesByMonth,
    regimesByMonth,
    points,
    intelligence: {
      assetId: input.assetId,
      generatedAt: input.nowMs,
      priceEur: input.currentPriceEur,
      dailyTrend: null,
      weeklyTrend: null,
      monthlyTrend: first ? first.assetReturn : null,
      momentum: returns.slice(0, 3).reduce((s, r) => s + r, 0),
      volatility: vol,
      volume: null,
      distanceFromHigh: last?.drawdownFromPeak ?? null,
      currentDrawdown: last?.drawdownFromPeak ?? null,
      supports: [Math.min(...Object.values(pricesByMonth))],
      resistances: [Math.max(...Object.values(pricesByMonth))],
      funding: null,
      openInterest: null,
      liquidations: null,
      onChainFlows: null,
      whaleActivity: null,
      fundamentalHealth: "unknown",
      protocolRisk: "unknown",
      regulatoryRisk: "unknown",
      macroContext: input.scenario === "conservador" ? "risk_off" : input.scenario === "optimista" ? "risk_on" : "neutral",
      marketSentiment: last?.regime === "EUPHORIA" ? "greed" : last?.regime === "BEAR_MARKET" || last?.regime === "CAPITULATION" ? "fear" : "neutral",
      analystConsensus: "neutral",
      mediaConsensus: "neutral",
      detectedRegime: last?.regime ?? "INSUFFICIENT_DATA",
      dataQuality: "medium",
      provider: "market-regime-engine",
      confidence: input.scenario === "base" ? 0.68 : 0.58,
      sourceTimestamps: { forecastAnchors: input.nowMs, regimeModel: input.nowMs },
      expiresAt: input.nowMs + 30 * 24 * 3600 * 1000,
    },
    seed,
  };
}
