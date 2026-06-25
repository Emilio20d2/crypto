// Pure domain engine for Compra Inteligente — no I/O, no React, independently testable.
// Calculates how to allocate a given amount across active plan assets.
// NEVER executes purchases automatically.

export type SmartBuyMode = "plan" | "equilibrar" | "oportunidad" | "mixto" | "potencial";
export type SmartBuyConfidence = "alta" | "media" | "baja" | "no_evaluable";
export type DataQuality = "completo" | "parcial" | "sin_datos";
export type SmartBuyAction =
  | "comprar"
  | "comprar_parcialmente"
  | "mantener"
  | "esperar"
  | "no_evaluable"
  | "candidato_plan"
  | "objetivo_alcanzado"
  | "pausado"
  | "no_elegible";
export type RiskLevel = "bajo" | "medio" | "alto" | "no_evaluable";
export type SmartBuyHorizon = "1-3y" | "3-5y" | "5y+";

export interface SmartBuyAsset {
  assetId: string;
  status: string;
  targetAllocationPct: number | null;
  goalReachedAt: number | null;
  isInPlan?: boolean;
  priority?: number | null;
}

export interface SmartBuyPosition {
  assetId: string;
  balance: number;
  currentValueEur: number | null;
  averagePriceEur: number | null;
  currentPriceEur: number | null;
  priceChange24hPct?: number | null;
  priceChange7dPct?: number | null;
  drawdownFromRecentHighPct?: number | null;
  marketCapEur?: number | null;
  volume24hEur?: number | null;
}

export interface TreasurySnapshot {
  eurcBalance: number;
  fiscalReserveBalance: number;
  freeRebuyLiquidity: number;
}

export interface SmartBuyAssetRecommendation {
  rank: number;
  assetId: string;
  action: SmartBuyAction;
  recommendedAmountEur: number;
  recommendedPercentage: number;
  baseAmountEur: number;
  deviationFromBaseEur: number;
  targetAllocationPct: number | null;
  currentValueEur: number | null;
  currentWeightPct: number | null;
  targetValueEur: number | null;
  estimatedValueAfterBuyEur: number | null;
  estimatedWeightAfterBuyPct: number | null;
  targetGapPct: number | null;
  isUnderweight: boolean;
  isOpportunity: boolean;
  opportunityReason: string | null;
  potentialReason: string | null;
  currentPriceEur: number | null;
  estimatedQuantity: number | null;
  averagePriceEur: number | null;
  estimatedAverageCostAfterBuyEur: number | null;
  riskLevel: RiskLevel;
  horizon: SmartBuyHorizon | null;
  confidenceLevel: SmartBuyConfidence;
  dataQuality: DataQuality;
  sources: string[];
  updatedAt: number;
  scoreBreakdown: {
    planAlignment: number;
    priceOpportunity: number;
    longTermPotential: number;
    risk: number;
    liquidity: number;
    dataQuality: number;
    final: number;
  };
  reason: string;
  explanation: string;
  restrictionsApplied: string[];
}

export interface SmartBuyResult {
  cycleId: string;
  analyzedAmountEur: number;
  totalPortfolioValueEur: number | null;
  recommendations: SmartBuyAssetRecommendation[];
  hasOpportunities: boolean;
  restrictionsApplied: string[];
  pendingAmountEur: number;
  dataQuality: DataQuality;
  mode: SmartBuyMode;
  originType: "cash" | "eurc";
  generatedAt: number;
}

const ELIGIBLE_STATUSES = new Set(["active"]);
const MIN_PROGRESSIVE_REMAINDER_EUR = 0.01;
const MODE_LABELS: Record<SmartBuyMode, string> = {
  plan: "Cumplir el Plan",
  equilibrar: "Equilibrar cartera",
  oportunidad: "Aprovechar oportunidades",
  mixto: "Modo mixto",
  potencial: "Potencial medio/largo plazo",
};

function isEligible(asset: SmartBuyAsset, originType: "cash" | "eurc"): { eligible: boolean; reason?: string } {
  if (!ELIGIBLE_STATUSES.has(asset.status)) {
    return { eligible: false, reason: `Estado: ${asset.status}` };
  }
  if (asset.goalReachedAt !== null && originType === "cash") {
    return { eligible: false, reason: "Objetivo alcanzado — excluido de compras normales" };
  }
  return { eligible: true };
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function calcConfidence(position: SmartBuyPosition | null): SmartBuyConfidence {
  if (!position) return "baja";
  if (position.currentValueEur !== null && position.currentPriceEur !== null) return "alta";
  if (position.balance > 0) return "media";
  return "baja";
}

function calcDataQuality(position: SmartBuyPosition | null): DataQuality {
  if (!position) return "sin_datos";
  if (position.currentValueEur !== null && position.currentPriceEur !== null) return "completo";
  if (position.balance > 0 || position.currentValueEur !== null || position.currentPriceEur !== null) return "parcial";
  return "sin_datos";
}

function calcPriceOpportunityScore(position: SmartBuyPosition | null): { score: number; reason: string | null } {
  if (!position?.currentPriceEur) return { score: 0, reason: null };

  const drawdown = position.drawdownFromRecentHighPct;
  if (typeof drawdown === "number" && Number.isFinite(drawdown) && drawdown < 0) {
    const absDrawdown = Math.abs(drawdown);
    const score = clampScore(absDrawdown * 2.4);
    if (score >= 50) {
      return { score, reason: `Corrección trazable de ${absDrawdown.toFixed(1)}% desde máximos recientes` };
    }
    return { score, reason: null };
  }

  const change24h = position.priceChange24hPct;
  const change7d = position.priceChange7dPct;
  if (typeof change7d === "number" && change7d < -12) {
    return { score: clampScore(Math.abs(change7d) * 3), reason: `Caída 7d de ${Math.abs(change7d).toFixed(1)}% con precio disponible` };
  }
  if (typeof change24h === "number" && change24h < -6) {
    return { score: clampScore(Math.abs(change24h) * 5), reason: `Caída 24h de ${Math.abs(change24h).toFixed(1)}% con precio disponible` };
  }

  return { score: 0, reason: null };
}

function calcLiquidityScore(position: SmartBuyPosition | null): number {
  const volume = position?.volume24hEur;
  if (typeof volume !== "number" || !Number.isFinite(volume) || volume <= 0) {
    return position?.currentPriceEur ? 45 : 10;
  }
  if (volume >= 1_000_000_000) return 95;
  if (volume >= 100_000_000) return 80;
  if (volume >= 10_000_000) return 65;
  if (volume >= 1_000_000) return 45;
  return 25;
}

function calcPotentialScore(asset: SmartBuyAsset, position: SmartBuyPosition | null): { score: number; reason: string | null } {
  const liquidity = calcLiquidityScore(position);
  const data = calcDataQuality(position);
  const priorityBoost = typeof asset.priority === "number" ? Math.max(0, 20 - asset.priority * 2) : 8;
  const inPlanBoost = asset.isInPlan === false ? 0 : 12;
  const score = clampScore(liquidity * 0.35 + (data === "completo" ? 25 : data === "parcial" ? 12 : 0) + priorityBoost + inPlanBoost);
  const reason = score >= 60
    ? "Potencial evaluable por liquidez, datos de precio y alineación estratégica disponibles"
    : data === "sin_datos"
      ? "Potencial no evaluable: faltan datos trazables"
      : "Potencial prudente: datos limitados o liquidez moderada";
  return { score, reason };
}

function classifyAction(
  asset: SmartBuyAsset,
  recommendedAmountEur: number,
  isOpportunity: boolean,
  dataQuality: DataQuality,
  originType: "cash" | "eurc"
): SmartBuyAction {
  if (asset.status === "paused") return "pausado";
  if (asset.goalReachedAt !== null && originType === "cash") return "objetivo_alcanzado";
  if (!ELIGIBLE_STATUSES.has(asset.status)) return "no_elegible";
  if (asset.isInPlan === false) return "candidato_plan";
  if (dataQuality === "sin_datos") return "no_evaluable";
  if (recommendedAmountEur <= 0) return isOpportunity ? "esperar" : "mantener";
  return recommendedAmountEur >= 5 ? "comprar" : "comprar_parcialmente";
}

export function rankSmartBuyCandidates(
  assets: SmartBuyAsset[],
  positions: Record<string, SmartBuyPosition>,
  totalPortfolioValueEur: number | null,
  mode: SmartBuyMode,
  originType: "cash" | "eurc"
): { asset: SmartBuyAsset; position: SmartBuyPosition | null; underweightEur: number; isOpportunity: boolean; opportunityReason: string | null; potentialReason: string | null; scores: SmartBuyAssetRecommendation["scoreBreakdown"]; score: number }[] {
  return assets
    .map(asset => {
      const position = positions[asset.assetId] ?? null;
      const currentValueEur = position?.currentValueEur ?? 0;
      const targetPct = (asset.targetAllocationPct ?? 0) / 100;
      const targetValueEur = totalPortfolioValueEur !== null ? totalPortfolioValueEur * targetPct : null;
      const underweightEur = targetValueEur !== null ? Math.max(0, targetValueEur - currentValueEur) : 0;
      const dataQuality = calcDataQuality(position);
      const planAlignment = targetPct > 0 && totalPortfolioValueEur !== null
        ? clampScore(100 - Math.min(100, Math.abs(((currentValueEur / Math.max(totalPortfolioValueEur, 1)) * 100) - (asset.targetAllocationPct ?? 0)) * 4))
        : asset.isInPlan === false ? 0 : 50;
      const priceOpportunity = calcPriceOpportunityScore(position);
      const potential = calcPotentialScore(asset, position);
      const liquidity = calcLiquidityScore(position);
      const risk = dataQuality === "completo" ? (liquidity >= 65 ? 78 : 55) : dataQuality === "parcial" ? 40 : 15;
      const dataQualityScore = dataQuality === "completo" ? 90 : dataQuality === "parcial" ? 55 : 10;

      let score = 0;
      if (mode === "plan" || mode === "mixto") score += planAlignment;
      if (mode === "equilibrar" || mode === "mixto") score += underweightEur;
      if (mode === "oportunidad" || mode === "mixto") score += priceOpportunity.score;
      if (mode === "potencial" || mode === "mixto") score += potential.score;

      const final = clampScore(
        mode === "oportunidad"
          ? priceOpportunity.score * 0.55 + liquidity * 0.2 + dataQualityScore * 0.25
          : mode === "potencial"
            ? potential.score * 0.55 + liquidity * 0.2 + risk * 0.15 + dataQualityScore * 0.1
            : mode === "mixto"
              ? planAlignment * 0.45 + priceOpportunity.score * 0.2 + potential.score * 0.2 + dataQualityScore * 0.15
              : planAlignment * 0.7 + dataQualityScore * 0.3
      );

      return {
        asset,
        position,
        underweightEur,
        isOpportunity: priceOpportunity.score >= 50,
        opportunityReason: priceOpportunity.reason,
        potentialReason: potential.reason,
        scores: {
          planAlignment,
          priceOpportunity: priceOpportunity.score,
          longTermPotential: potential.score,
          risk,
          liquidity,
          dataQuality: dataQualityScore,
          final,
        },
        score: final + score
      };
    })
    .sort((a, b) => b.score - a.score);
}

export interface SmartBuyWeights {
  planPct?: number;
  balancePct?: number;
  opportunityPct?: number;
  potentialPct?: number;
}

export interface SmartBuyOptions {
  weights?: SmartBuyWeights;
  horizon?: SmartBuyHorizon;
}

function normalizedWeights(mode: SmartBuyMode, weights?: SmartBuyWeights): Required<SmartBuyWeights> {
  const defaults: Record<SmartBuyMode, Required<SmartBuyWeights>> = {
    plan: { planPct: 70, balancePct: 30, opportunityPct: 0, potentialPct: 0 },
    equilibrar: { planPct: 0, balancePct: 100, opportunityPct: 0, potentialPct: 0 },
    oportunidad: { planPct: 0, balancePct: 0, opportunityPct: 100, potentialPct: 0 },
    mixto: { planPct: 60, balancePct: 15, opportunityPct: 20, potentialPct: 5 },
    potencial: { planPct: 0, balancePct: 0, opportunityPct: 0, potentialPct: 100 },
  };
  const merged = { ...defaults[mode], ...(weights ?? {}) };
  const total = Math.max(1, merged.planPct + merged.balancePct + merged.opportunityPct + merged.potentialPct);
  return {
    planPct: merged.planPct / total,
    balancePct: merged.balancePct / total,
    opportunityPct: merged.opportunityPct / total,
    potentialPct: merged.potentialPct / total,
  };
}

export function calculateSmartBuyAllocation(
  assets: SmartBuyAsset[],
  positions: Record<string, SmartBuyPosition>,
  amount: number,
  totalPortfolioValueEur: number | null,
  mode: SmartBuyMode,
  originType: "cash" | "eurc",
  treasury: TreasurySnapshot | null,
  maxDeviationPct = 30,
  now = Date.now(),
  options: SmartBuyOptions = {}
): SmartBuyResult {
  const restrictions: string[] = [];
  let spendableAmount = amount;

  if (amount <= 0) {
    return {
      cycleId: "",
      analyzedAmountEur: amount,
      totalPortfolioValueEur,
      recommendations: [],
      hasOpportunities: false,
      restrictionsApplied: ["Importe inválido (debe ser positivo)"],
      pendingAmountEur: amount,
      dataQuality: "sin_datos",
      mode,
      originType,
      generatedAt: now,
    };
  }

  if (originType === "eurc") {
    if (!treasury) {
      return {
        cycleId: "",
        analyzedAmountEur: amount,
        totalPortfolioValueEur,
        recommendations: [],
        hasOpportunities: false,
        restrictionsApplied: ["Tesorería no disponible"],
        pendingAmountEur: amount,
        dataQuality: "sin_datos",
        mode,
        originType,
        generatedAt: now,
      };
    }
    const available = Math.max(0, treasury.freeRebuyLiquidity || (treasury.eurcBalance - treasury.fiscalReserveBalance));
    if (available <= 0) {
      restrictions.push("Sin EURC disponible (excluida reserva fiscal)");
      return {
        cycleId: "",
        analyzedAmountEur: amount,
        totalPortfolioValueEur,
        recommendations: [],
        hasOpportunities: false,
        restrictionsApplied: restrictions,
        pendingAmountEur: amount,
        dataQuality: "sin_datos",
        mode,
        originType,
        generatedAt: now,
      };
    }
    if (amount > available) {
      restrictions.push(`Importe limitado a EURC disponible: ${available.toFixed(2)} €`);
      spendableAmount = available;
    }
  }

  if (assets.length === 0) {
    return {
      cycleId: "",
      analyzedAmountEur: amount,
      totalPortfolioValueEur,
      recommendations: [],
      hasOpportunities: false,
      restrictionsApplied: ["Sin activos en el plan para analizar"],
      pendingAmountEur: amount,
      dataQuality: "sin_datos",
      mode,
      originType,
      generatedAt: now,
    };
  }

  const projectedTotal = (totalPortfolioValueEur ?? 0) + spendableAmount;
  const candidates = rankSmartBuyCandidates(assets, positions, projectedTotal, mode, originType);
  const eligibleCandidates = candidates.filter(({ asset }) => isEligible(asset, originType).eligible && asset.isInPlan !== false);
  if (eligibleCandidates.length === 0 && candidates.every(({ asset }) => asset.isInPlan !== false)) {
    restrictions.push("Sin activos elegibles para compra en este modo");
  }

  let hasPositionData = false;
  let hasPriceData = false;

  const totalUnderweight = eligibleCandidates.reduce((s, c) => s + c.underweightEur, 0);
  const totalTargetPct = eligibleCandidates.reduce((s, c) => s + ((c.asset.targetAllocationPct ?? 0) / 100), 0);
  const totalOpportunityScore = eligibleCandidates.reduce((s, c) => s + (c.isOpportunity ? c.scores.priceOpportunity : 0), 0);
  const totalPotentialScore = eligibleCandidates.reduce((s, c) => s + c.scores.longTermPotential, 0);
  const weights = normalizedWeights(mode, options.weights);
  // When oportunidad mode finds no market signals, fall back to plan base allocation
  const opportunityFallback = mode === "oportunidad" && totalOpportunityScore <= 0;
  if (opportunityFallback) {
    restrictions.push("Sin señales de mercado con suficiente trazabilidad — distribución proporcional al Plan como referencia");
  }
  const isPortfolioNew = totalPortfolioValueEur === null || totalPortfolioValueEur <= 0;
  let hasOpportunities = false;
  let remaining = spendableAmount;

  const recommendations: SmartBuyAssetRecommendation[] = candidates.map(({ asset, position, underweightEur, isOpportunity, opportunityReason, potentialReason, scores }, index) => {
    if (position) hasPositionData = true;
    if (position?.currentPriceEur) hasPriceData = true;
    if (isOpportunity) hasOpportunities = true;
    const eligibility = isEligible(asset, originType);
    const dataQualityForAsset = calcDataQuality(position);

    const targetPct = (asset.targetAllocationPct ?? 0) / 100;
    const baseAmount = totalTargetPct > 0
      ? Math.round((targetPct / totalTargetPct) * spendableAmount * 100) / 100
      : Math.round((spendableAmount / candidates.length) * 100) / 100;

    let recommendedAmountEur: number;
    const balanceAmount = totalUnderweight > 0
      ? Math.round((underweightEur / totalUnderweight) * spendableAmount * 100) / 100
      : baseAmount;
    const opportunityAmount = totalOpportunityScore > 0 && isOpportunity
      ? Math.round((scores.priceOpportunity / totalOpportunityScore) * spendableAmount * 100) / 100
      : 0;
    const potentialAmount = totalPotentialScore > 0
      ? Math.round((scores.longTermPotential / totalPotentialScore) * spendableAmount * 100) / 100
      : 0;

    if (mode === "plan") {
      recommendedAmountEur = Math.round((baseAmount * weights.planPct + balanceAmount * weights.balancePct) * 100) / 100;
    } else if (mode === "equilibrar") {
      recommendedAmountEur = balanceAmount;
    } else if (mode === "oportunidad") {
      // Fallback to plan base when no market signals available
      recommendedAmountEur = opportunityFallback ? baseAmount : opportunityAmount;
    } else if (mode === "potencial") {
      recommendedAmountEur = asset.isInPlan === false ? 0 : potentialAmount;
    } else {
      recommendedAmountEur = Math.round((
        baseAmount * weights.planPct +
        balanceAmount * weights.balancePct +
        opportunityAmount * weights.opportunityPct +
        potentialAmount * weights.potentialPct
      ) * 100) / 100;
    }

    // Enforce max deviation from base
    const maxAllowed = baseAmount * (1 + maxDeviationPct / 100);
    const assetRestrictions: string[] = [];
    if (recommendedAmountEur > maxAllowed) {
      recommendedAmountEur = Math.round(maxAllowed * 100) / 100;
      assetRestrictions.push(`Desviación limitada al ${maxDeviationPct}% del importe base`);
    }
    recommendedAmountEur = Math.min(recommendedAmountEur, remaining);

    if (
      eligibleCandidates.length === 1 &&
      eligibility.eligible &&
      asset.isInPlan !== false &&
      recommendedAmountEur >= spendableAmount &&
      spendableAmount > MIN_PROGRESSIVE_REMAINDER_EUR
    ) {
      recommendedAmountEur = Math.max(0, Math.round((spendableAmount - MIN_PROGRESSIVE_REMAINDER_EUR) * 100) / 100);
      assetRestrictions.push("Compra única limitada para mantener capital sin utilizar");
    }

    if (!eligibility.eligible) {
      recommendedAmountEur = 0;
      assetRestrictions.push(eligibility.reason ?? "No elegible");
    }
    if (asset.isInPlan === false) {
      recommendedAmountEur = 0;
      assetRestrictions.push("Activo fuera del Plan: candidato para estudiar antes de comprar");
    }
    if (mode === "oportunidad" && !isOpportunity && !opportunityFallback) {
      recommendedAmountEur = 0;
      assetRestrictions.push("Sin oportunidad trazable suficiente actualmente");
    }

    remaining -= recommendedAmountEur;
    if (remaining < 0) remaining = 0;

    const currentValueEur = position?.currentValueEur ?? null;
    const targetValueEur = projectedTotal * ((asset.targetAllocationPct ?? 0) / 100);
    const isUnderweight = currentValueEur !== null ? currentValueEur < targetValueEur : false;
    const currentWeightPct = totalPortfolioValueEur !== null && totalPortfolioValueEur > 0 && currentValueEur !== null
      ? (currentValueEur / totalPortfolioValueEur) * 100
      : null;
    const estimatedValueAfterBuyEur = currentValueEur !== null ? currentValueEur + recommendedAmountEur : null;
    const estimatedWeightAfterBuyPct = estimatedValueAfterBuyEur !== null && projectedTotal > 0
      ? (estimatedValueAfterBuyEur / projectedTotal) * 100
      : null;
    const targetGapPct = currentWeightPct !== null && asset.targetAllocationPct !== null
      ? currentWeightPct - asset.targetAllocationPct
      : null;
    const currentPriceEur = position?.currentPriceEur ?? null;
    const estimatedQuantity = currentPriceEur !== null && currentPriceEur > 0 && recommendedAmountEur > 0
      ? recommendedAmountEur / currentPriceEur
      : null;
    const averagePriceEur = position?.averagePriceEur ?? null;
    const currentCost = averagePriceEur !== null && position ? averagePriceEur * position.balance : null;
    const estimatedAverageCostAfterBuyEur = currentCost !== null && estimatedQuantity !== null && position
      ? (currentCost + recommendedAmountEur) / (position.balance + estimatedQuantity)
      : averagePriceEur;
    const riskLevel: RiskLevel = dataQualityForAsset === "sin_datos"
      ? "no_evaluable"
      : scores.risk >= 70
        ? "bajo"
        : scores.risk >= 45
          ? "medio"
          : "alto";
    const action = classifyAction(asset, recommendedAmountEur, isOpportunity, dataQualityForAsset, originType);

    const reasonParts: string[] = [];
    if (isUnderweight) {
      const deficit = targetValueEur - (currentValueEur ?? 0);
      reasonParts.push(`Infraponderado: ${(currentValueEur ?? 0).toFixed(0)} € actual vs ${targetValueEur.toFixed(0)} € objetivo (déficit ${deficit.toFixed(0)} €)`);
    } else if (currentValueEur !== null && currentValueEur > 0) {
      reasonParts.push(`Equilibrado: ${currentValueEur.toFixed(0)} € actual vs ${targetValueEur.toFixed(0)} € objetivo`);
    } else if (isPortfolioNew) {
      reasonParts.push(`Cartera nueva — distribución proporcional al objetivo ${asset.targetAllocationPct ?? 0}%`);
    }
    if (opportunityReason) reasonParts.push(opportunityReason);
    if (opportunityFallback && mode === "oportunidad") reasonParts.push("Sin señales de mercado detectadas — usando distribución de referencia del Plan");
    if (mode === "potencial" || mode === "mixto") reasonParts.push(potentialReason ?? "Potencial no evaluable con los datos actuales");
    if (originType === "eurc") reasonParts.push("Origen EURC libre: compra táctica, no aportación mensual ni Propuesta de Recompra");
    const deviationEur = Math.round((recommendedAmountEur - baseAmount) * 100) / 100;
    if (Math.abs(deviationEur) >= 0.5 && (mode === "plan" || mode === "equilibrar")) {
      reasonParts.push(deviationEur > 0
        ? `Corrección aplicada: +${deviationEur.toFixed(2)} € por infraponderación`
        : `Reducción aplicada: ${deviationEur.toFixed(2)} € por sobreponderación`);
    }

    return {
      rank: index + 1,
      assetId: asset.assetId,
      action,
      recommendedAmountEur,
      recommendedPercentage: amount > 0 ? Math.round((recommendedAmountEur / amount) * 10_000) / 100 : 0,
      baseAmountEur: baseAmount,
      deviationFromBaseEur: deviationEur,
      targetAllocationPct: asset.targetAllocationPct,
      currentValueEur: currentValueEur !== null ? Math.round(currentValueEur * 100) / 100 : null,
      currentWeightPct: currentWeightPct !== null ? Math.round(currentWeightPct * 100) / 100 : null,
      targetValueEur: Math.round(targetValueEur * 100) / 100,
      estimatedValueAfterBuyEur: estimatedValueAfterBuyEur !== null ? Math.round(estimatedValueAfterBuyEur * 100) / 100 : null,
      estimatedWeightAfterBuyPct: estimatedWeightAfterBuyPct !== null ? Math.round(estimatedWeightAfterBuyPct * 100) / 100 : null,
      targetGapPct: targetGapPct !== null ? Math.round(targetGapPct * 100) / 100 : null,
      isUnderweight,
      isOpportunity,
      opportunityReason,
      potentialReason,
      currentPriceEur,
      estimatedQuantity: estimatedQuantity !== null ? Math.round(estimatedQuantity * 1e8) / 1e8 : null,
      averagePriceEur,
      estimatedAverageCostAfterBuyEur: estimatedAverageCostAfterBuyEur !== null ? Math.round(estimatedAverageCostAfterBuyEur * 100) / 100 : null,
      riskLevel,
      horizon: mode === "potencial" ? options.horizon ?? "3-5y" : null,
      confidenceLevel: calcConfidence(position),
      dataQuality: dataQualityForAsset,
      sources: ["Plan de Inversión", "Cartera", "Mercado"],
      updatedAt: now,
      scoreBreakdown: scores,
      reason: reasonParts.join(" · ") || `Asignación según ${MODE_LABELS[mode]} (${asset.targetAllocationPct ?? 0}%)`,
      explanation: reasonParts.join(" · ") || "No hay señales adicionales trazables; se mantiene la asignación base del Plan.",
      restrictionsApplied: assetRestrictions,
    };
  });

  const dataQuality: DataQuality = !hasPositionData ? "sin_datos" : !hasPriceData ? "parcial" : "completo";
  if (mode === "oportunidad" && !hasOpportunities) {
    restrictions.push("No se detectan oportunidades de compra suficientemente claras actualmente.");
  }

  return {
    cycleId: "",
    analyzedAmountEur: amount,
    totalPortfolioValueEur,
    recommendations,
    hasOpportunities,
    restrictionsApplied: restrictions,
    pendingAmountEur: Math.max(0, Math.round((remaining + (amount - spendableAmount)) * 100) / 100),
    dataQuality,
    mode,
    originType,
    generatedAt: now,
  };
}

export function validateSmartBuyProposal(result: SmartBuyResult): { valid: boolean; reason: string | null } {
  if (result.analyzedAmountEur <= 0) return { valid: false, reason: "Importe inválido" };
  if (result.dataQuality === "sin_datos") return { valid: false, reason: "Sin datos suficientes para generar recomendación" };
  if (result.recommendations.length === 0) return { valid: false, reason: "Sin activos elegibles" };
  const allocated = result.recommendations.reduce((s, r) => s + r.recommendedAmountEur, 0);
  if (allocated <= 0) return { valid: false, reason: "No se pudo asignar ningún importe" };
  return { valid: true, reason: null };
}
