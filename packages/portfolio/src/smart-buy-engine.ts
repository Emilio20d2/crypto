// Pure domain engine for Compra Inteligente — no I/O, no React, independently testable.
// Calculates how to allocate a given amount across active plan assets.
// NEVER executes purchases automatically.

export type SmartBuyMode = "plan" | "equilibrar" | "oportunidad" | "mixto";
export type SmartBuyConfidence = "alta" | "media" | "baja" | "no_evaluable";
export type DataQuality = "completo" | "parcial" | "sin_datos";

export interface SmartBuyAsset {
  assetId: string;
  status: string;
  targetAllocationPct: number | null;
  goalReachedAt: number | null;
}

export interface SmartBuyPosition {
  assetId: string;
  balance: number;
  currentValueEur: number | null;
  averagePriceEur: number | null;
  currentPriceEur: number | null;
}

export interface TreasurySnapshot {
  eurcBalance: number;
  fiscalReserveBalance: number;
  freeRebuyLiquidity: number;
}

export interface SmartBuyAssetRecommendation {
  assetId: string;
  recommendedAmountEur: number;
  baseAmountEur: number;
  deviationFromBaseEur: number;
  targetAllocationPct: number | null;
  currentValueEur: number | null;
  targetValueEur: number | null;
  isUnderweight: boolean;
  isOpportunity: boolean;
  opportunityReason: string | null;
  confidenceLevel: SmartBuyConfidence;
  reason: string;
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

function isEligible(asset: SmartBuyAsset, originType: "cash" | "eurc"): { eligible: boolean; reason?: string } {
  if (!ELIGIBLE_STATUSES.has(asset.status)) {
    return { eligible: false, reason: `Estado: ${asset.status}` };
  }
  if (asset.goalReachedAt !== null && originType === "cash") {
    return { eligible: false, reason: "Objetivo alcanzado — excluido de compras normales" };
  }
  return { eligible: true };
}

function calcConfidence(position: SmartBuyPosition | null): SmartBuyConfidence {
  if (!position) return "baja";
  if (position.currentValueEur !== null && position.currentPriceEur !== null) return "alta";
  if (position.balance > 0) return "media";
  return "baja";
}

export function rankSmartBuyCandidates(
  assets: SmartBuyAsset[],
  positions: Record<string, SmartBuyPosition>,
  totalPortfolioValueEur: number | null,
  mode: SmartBuyMode,
  originType: "cash" | "eurc"
): { asset: SmartBuyAsset; position: SmartBuyPosition | null; underweightEur: number; isOpportunity: boolean; opportunityReason: string | null; score: number }[] {
  return assets
    .filter(a => isEligible(a, originType).eligible)
    .map(asset => {
      const position = positions[asset.assetId] ?? null;
      const currentValueEur = position?.currentValueEur ?? 0;
      const targetPct = (asset.targetAllocationPct ?? 0) / 100;
      const targetValueEur = totalPortfolioValueEur !== null ? totalPortfolioValueEur * targetPct : null;
      const underweightEur = targetValueEur !== null ? Math.max(0, targetValueEur - currentValueEur) : 0;

      const avgCost = position?.averagePriceEur ?? null;
      const currentPrice = position?.currentPriceEur ?? null;
      const isOpportunity = avgCost !== null && currentPrice !== null && currentPrice < avgCost * 0.95;
      const opportunityReason = isOpportunity && currentPrice !== null && avgCost !== null
        ? `Precio ${((1 - currentPrice / avgCost) * 100).toFixed(1)}% por debajo del coste medio`
        : null;

      let score = 0;
      if (mode === "plan" || mode === "mixto") score += targetPct * 100;
      if (mode === "equilibrar" || mode === "mixto") score += underweightEur;
      if ((mode === "oportunidad" || mode === "mixto") && isOpportunity) score += 50;

      return { asset, position, underweightEur, isOpportunity, opportunityReason, score };
    })
    .sort((a, b) => b.score - a.score);
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
  now = Date.now()
): SmartBuyResult {
  const restrictions: string[] = [];

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
    const available = treasury.eurcBalance - treasury.fiscalReserveBalance;
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
    }
  }

  const activeAssets = assets.filter(a => ELIGIBLE_STATUSES.has(a.status));
  if (activeAssets.length === 0) {
    return {
      cycleId: "",
      analyzedAmountEur: amount,
      totalPortfolioValueEur,
      recommendations: [],
      hasOpportunities: false,
      restrictionsApplied: ["Sin activos activos en el plan"],
      pendingAmountEur: amount,
      dataQuality: "sin_datos",
      mode,
      originType,
      generatedAt: now,
    };
  }

  const projectedTotal = (totalPortfolioValueEur ?? 0) + amount;
  const candidates = rankSmartBuyCandidates(assets, positions, projectedTotal, mode, originType);

  let hasPositionData = false;
  let hasPriceData = false;

  const totalUnderweight = candidates.reduce((s, c) => s + c.underweightEur, 0);
  const totalTargetPct = candidates.reduce((s, c) => s + ((c.asset.targetAllocationPct ?? 0) / 100), 0);
  let hasOpportunities = false;
  let remaining = amount;

  const recommendations: SmartBuyAssetRecommendation[] = candidates.map(({ asset, position, underweightEur, isOpportunity, opportunityReason }) => {
    if (position) hasPositionData = true;
    if (position?.currentPriceEur) hasPriceData = true;
    if (isOpportunity) hasOpportunities = true;

    const targetPct = (asset.targetAllocationPct ?? 0) / 100;
    const baseAmount = totalTargetPct > 0
      ? Math.round((targetPct / totalTargetPct) * amount * 100) / 100
      : Math.round((amount / candidates.length) * 100) / 100;

    let recommendedAmountEur: number;
    if (mode === "plan") {
      recommendedAmountEur = baseAmount;
    } else if (mode === "equilibrar") {
      recommendedAmountEur = totalUnderweight > 0
        ? Math.round((underweightEur / totalUnderweight) * amount * 100) / 100
        : baseAmount;
    } else if (mode === "oportunidad") {
      recommendedAmountEur = isOpportunity
        ? Math.round((underweightEur > 0 ? (underweightEur / Math.max(totalUnderweight, 1)) : (1 / candidates.length)) * amount * 100) / 100
        : 0;
    } else {
      // mixto: blend plan + opportunity
      const planWeight = baseAmount * 0.5;
      const oppWeight = isOpportunity ? baseAmount * 0.5 : 0;
      const equilWeight = totalUnderweight > 0 ? (underweightEur / totalUnderweight) * amount * 0.3 : 0;
      recommendedAmountEur = Math.round((planWeight + oppWeight + equilWeight) * 100) / 100;
    }

    // Enforce max deviation from base
    const maxAllowed = baseAmount * (1 + maxDeviationPct / 100);
    const assetRestrictions: string[] = [];
    if (recommendedAmountEur > maxAllowed) {
      recommendedAmountEur = Math.round(maxAllowed * 100) / 100;
      assetRestrictions.push(`Desviación limitada al ${maxDeviationPct}% del importe base`);
    }
    recommendedAmountEur = Math.min(recommendedAmountEur, remaining);

    const ineligible = isEligible(asset, originType);
    if (!ineligible.eligible) {
      recommendedAmountEur = 0;
      assetRestrictions.push(ineligible.reason ?? "No elegible");
    }

    remaining -= recommendedAmountEur;
    if (remaining < 0) remaining = 0;

    const currentValueEur = position?.currentValueEur ?? null;
    const targetValueEur = projectedTotal * ((asset.targetAllocationPct ?? 0) / 100);
    const isUnderweight = currentValueEur !== null ? currentValueEur < targetValueEur : false;

    const reasonParts: string[] = [];
    if (isUnderweight) reasonParts.push(`Infraponderado: ${currentValueEur?.toFixed(0) ?? "?"} € vs ${targetValueEur.toFixed(0)} € objetivo`);
    else if (currentValueEur !== null) reasonParts.push(`Objetivo cubierto: ${currentValueEur.toFixed(0)} € vs ${targetValueEur.toFixed(0)} €`);
    if (opportunityReason) reasonParts.push(opportunityReason);

    return {
      assetId: asset.assetId,
      recommendedAmountEur,
      baseAmountEur: baseAmount,
      deviationFromBaseEur: Math.round((recommendedAmountEur - baseAmount) * 100) / 100,
      targetAllocationPct: asset.targetAllocationPct,
      currentValueEur: currentValueEur !== null ? Math.round(currentValueEur * 100) / 100 : null,
      targetValueEur: Math.round(targetValueEur * 100) / 100,
      isUnderweight,
      isOpportunity,
      opportunityReason,
      confidenceLevel: calcConfidence(position),
      reason: reasonParts.join(" · ") || `Asignación según Plan (${asset.targetAllocationPct ?? 0}%)`,
      restrictionsApplied: assetRestrictions,
    };
  });

  const dataQuality: DataQuality = !hasPositionData ? "sin_datos" : !hasPriceData ? "parcial" : "completo";

  return {
    cycleId: "",
    analyzedAmountEur: amount,
    totalPortfolioValueEur,
    recommendations,
    hasOpportunities,
    restrictionsApplied: restrictions,
    pendingAmountEur: Math.max(0, Math.round(remaining * 100) / 100),
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
