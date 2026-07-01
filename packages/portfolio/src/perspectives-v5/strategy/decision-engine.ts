import type {
  MarketRegime,
  PerspectivesDecisionAlternative,
  PerspectivesEurcBucket,
  PerspectivesLot,
  PerspectivesStrategyDecision,
} from "../domain/types";

export interface MonthlyMarketDecisionSignal {
  assetId: string;
  month: string;
  regime: MarketRegime;
  expectedReturn12m: number;
  downsideProbability12m: number;
  expectedDownsideDepth: number;
  stabilizationProbability: number;
  volatility12m: number;
  confidence: number;
  sourceCount: number;
  independentPublisherCount: number;
}

export interface SaleDecisionContext {
  id: string;
  date: number;
  assetId: string;
  currentPriceEur: number;
  openLots: PerspectivesLot[];
  portfolioAssetValueEur: number;
  totalPortfolioValueEur: number;
  commissionRate: number;
  estimatedTaxRate: number;
  signal: MonthlyMarketDecisionSignal;
}

export interface RebuyDecisionContext {
  id: string;
  date: number;
  bucket: PerspectivesEurcBucket;
  currentPriceEur: number;
  commissionRate: number;
  signal: MonthlyMarketDecisionSignal;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function openUnits(lots: PerspectivesLot[]): number {
  return lots.reduce((sum, lot) => sum + lot.unitsOpen, 0);
}

function openCostBasis(lots: PerspectivesLot[]): number {
  return lots.reduce((sum, lot) => {
    const ratio = lot.unitsAcquired > 0 ? lot.unitsOpen / lot.unitsAcquired : 0;
    return sum + lot.costBasisEur * ratio;
  }, 0);
}

function saleActionForFraction(fraction: number): PerspectivesDecisionAlternative["action"] {
  if (fraction === 0.05) return "SELL_5";
  if (fraction === 0.10) return "SELL_10";
  if (fraction === 0.15) return "SELL_15";
  if (fraction === 0.20) return "SELL_20";
  return "SELL_25";
}

function rebuyActionForFraction(fraction: number): PerspectivesDecisionAlternative["action"] {
  if (fraction === 0.20) return "REBUY_20";
  if (fraction === 0.33) return "REBUY_33";
  return "REBUY_50";
}

export function evaluatePartialSaleAlternatives(context: SaleDecisionContext): PerspectivesStrategyDecision {
  const units = openUnits(context.openLots);
  const costBasis = openCostBasis(context.openLots);
  const currentValue = units * context.currentPriceEur;
  const expectedReturn = context.signal.expectedReturn12m;
  const downsideProbability = clamp(context.signal.downsideProbability12m, 0, 1);
  const expectedDownsideDepth = clamp(context.signal.expectedDownsideDepth, 0, 0.95);
  const concentration = context.totalPortfolioValueEur > 0
    ? context.portfolioAssetValueEur / context.totalPortfolioValueEur
    : 0;
  const holdExpectedValue = currentValue * (1 + expectedReturn);

  const alternatives: PerspectivesDecisionAlternative[] = [{
    action: "HOLD",
    expectedNetValueEur: holdExpectedValue,
    costsEur: 0,
    taxEur: 0,
    confidence: context.signal.confidence,
    reason: `Mantener: retorno esperado 12m ${(expectedReturn * 100).toFixed(1)}%, concentración ${(concentration * 100).toFixed(1)}%`,
  }];

  for (const fraction of [0.05, 0.10, 0.15, 0.20, 0.25]) {
    const soldValue = currentValue * fraction;
    const soldCostBasis = costBasis * fraction;
    const saleCosts = soldValue * context.commissionRate;
    const taxableGain = Math.max(0, soldValue - saleCosts - soldCostBasis);
    const taxEur = taxableGain * context.estimatedTaxRate;
    const liquidProceeds = soldValue - saleCosts - taxEur;
    const retainedExpectedValue = currentValue * (1 - fraction) * (1 + expectedReturn);
    const expectedRebuyAdvantage = liquidProceeds * downsideProbability * expectedDownsideDepth * context.signal.stabilizationProbability;
    const concentrationBenefit = liquidProceeds * Math.max(0, concentration - 0.35) * 0.20;
    const expectedNetValueEur = retainedExpectedValue + liquidProceeds + expectedRebuyAdvantage + concentrationBenefit;
    alternatives.push({
      action: saleActionForFraction(fraction),
      expectedNetValueEur,
      costsEur: saleCosts,
      taxEur,
      confidence: context.signal.confidence,
      reason: `Vender ${(fraction * 100).toFixed(0)}%: valor líquido ${liquidProceeds.toFixed(2)} EUR, ventaja esperada de recompra ${expectedRebuyAdvantage.toFixed(2)} EUR`,
    });
  }

  const ordered = [...alternatives].sort((a, b) => b.expectedNetValueEur - a.expectedNetValueEur);
  const best = ordered[0];
  const hold = alternatives[0];
  const minimumSafetyMargin = currentValue * 0.01;
  const selected =
    context.signal.confidence >= 0.55 &&
    context.signal.sourceCount >= 3 &&
    best.action !== "HOLD" &&
    best.expectedNetValueEur > hold.expectedNetValueEur + minimumSafetyMargin
      ? best
      : hold;

  return {
    id: context.id,
    date: context.date,
    assetId: context.assetId,
    profitHarvestCycleId: null,
    alternatives,
    selectedAction: selected.action,
    selectedReason: selected === hold
      ? `Mantener: ninguna venta supera el margen de seguridad de ${minimumSafetyMargin.toFixed(2)} EUR con confianza suficiente`
      : selected.reason,
    usesFutureInformation: false,
  };
}

export function evaluateRebuyAlternatives(context: RebuyDecisionContext): PerspectivesStrategyDecision {
  const available = context.bucket.availableEur;
  const salePrice = context.bucket.grossSaleProceedsEur > 0
    ? context.bucket.grossSaleProceedsEur / Math.max(1e-12, context.bucket.grossSaleProceedsEur / context.bucket.grossSaleProceedsEur)
    : context.currentPriceEur;
  const priceAdvantage = context.bucket.grossSaleProceedsEur > 0
    ? Math.max(0, context.bucket.sourceAssetId ? (context.bucket.realizedGainEur + context.bucket.soldCostBasisEur) : 0)
    : 0;
  const expectedReturn = context.signal.expectedReturn12m;
  const stabilization = clamp(context.signal.stabilizationProbability, 0, 1);
  const downsideProbability = clamp(context.signal.downsideProbability12m, 0, 1);

  const alternatives: PerspectivesDecisionAlternative[] = [{
    action: "KEEP_EURC",
    expectedNetValueEur: available,
    costsEur: 0,
    taxEur: 0,
    confidence: context.signal.confidence,
    reason: `Mantener EURC: estabilización ${(stabilization * 100).toFixed(0)}%, riesgo de caída adicional ${(downsideProbability * 100).toFixed(0)}%`,
  }];

  for (const fraction of [0.20, 0.33, 0.50]) {
    const principal = available * fraction;
    const costs = principal * context.commissionRate;
    const netPurchase = principal - costs;
    const expectedPositionValue = netPurchase * (1 + expectedReturn);
    const remainingEurc = available - principal;
    const riskPenalty = principal * downsideProbability * context.signal.expectedDownsideDepth * (1 - stabilization);
    const expectedNetValueEur = remainingEurc + expectedPositionValue - riskPenalty;
    alternatives.push({
      action: rebuyActionForFraction(fraction),
      expectedNetValueEur,
      costsEur: costs,
      taxEur: 0,
      confidence: context.signal.confidence,
      reason: `Recomprar ${(fraction * 100).toFixed(0)}%: retorno esperado ${(expectedReturn * 100).toFixed(1)}%, penalización de riesgo ${riskPenalty.toFixed(2)} EUR`,
    });
  }

  alternatives.push({
    action: "CANCEL_REBUY",
    expectedNetValueEur: available - Math.max(0, priceAdvantage * 0),
    costsEur: 0,
    taxEur: 0,
    confidence: context.signal.confidence,
    reason: "Cancelar la tesis solo cuando el deterioro fundamental se documente fuera de este evaluador financiero",
  });

  const keep = alternatives[0];
  const candidates = alternatives
    .filter((alternative) => alternative.action !== "CANCEL_REBUY")
    .sort((a, b) => b.expectedNetValueEur - a.expectedNetValueEur);
  const best = candidates[0];
  const minimumSafetyMargin = available * 0.005;
  const selected =
    context.signal.confidence >= 0.55 &&
    context.signal.independentPublisherCount >= 2 &&
    stabilization >= 0.45 &&
    best.action !== "KEEP_EURC" &&
    best.expectedNetValueEur > keep.expectedNetValueEur + minimumSafetyMargin
      ? best
      : keep;

  return {
    id: context.id,
    date: context.date,
    assetId: context.bucket.sourceAssetId,
    profitHarvestCycleId: context.bucket.profitHarvestCycleId,
    alternatives,
    selectedAction: selected.action,
    selectedReason: selected === keep
      ? `Mantener EURC: ninguna recompra supera el margen de seguridad de ${minimumSafetyMargin.toFixed(2)} EUR`
      : selected.reason,
    usesFutureInformation: false,
  };
}

export function saleFractionFromAction(action: PerspectivesDecisionAlternative["action"]): number | null {
  if (action === "SELL_5") return 0.05;
  if (action === "SELL_10") return 0.10;
  if (action === "SELL_15") return 0.15;
  if (action === "SELL_20") return 0.20;
  if (action === "SELL_25") return 0.25;
  return null;
}

export function rebuyFractionFromAction(action: PerspectivesDecisionAlternative["action"]): number | null {
  if (action === "REBUY_20") return 0.20;
  if (action === "REBUY_33") return 0.33;
  if (action === "REBUY_50") return 0.50;
  return null;
}
