// Pure domain engine for plan monitoring — no I/O, no React, independently testable.
// Calculates asset health, compliance, and strategic alerts.
// All outputs are derived from inputs; no global state.

export type PlanAssetHealthStatus =
  | "excelente" | "buena" | "neutral" | "vigilancia" | "deterioro" | "critica" | "candidato_sustitucion";

export type PlanAlertType =
  | "aportacion_pendiente"
  | "deficit"
  | "objetivo_proximo"
  | "objetivo_alcanzado"
  | "activo_infraponderado"
  | "activo_sobreponderado"
  | "venta_parcial_activada"
  | "compra_caida_activada"
  | "sustitucion_pendiente"
  | "etapa_proxima_fin"
  | "activo_vigilancia"
  | "recomendacion_compra_inteligente";

export type PlanAlertPriority = "informativa" | "baja" | "media" | "alta" | "critica";

export interface PlanAlert {
  id: string;
  type: PlanAlertType;
  priority: PlanAlertPriority;
  assetId: string | null;
  cycleId: string;
  title: string;
  message: string;
  dataUsed: Record<string, unknown>;
  actionAvailable: string | null;
  generatedAt: number;
}

export interface AssetPlanStatus {
  assetId: string;
  cycleId: string;
  investmentAssetId: string | null;
  targetAllocationPct: number | null;
  currentValueEur: number | null;
  targetValueEur: number | null;
  deviationEur: number | null;
  deviationPct: number | null;
  isUnderweight: boolean | null;
  goalProgress: number | null;
  healthStatus: PlanAssetHealthStatus;
  healthReason: string;
  activeRules: number;
  triggeredRules: number;
  lastReviewDate: number | null;
  nextAction: string | null;
}

export interface MonitoringAsset {
  id: string;
  assetId: string;
  cycleId: string;
  investmentAssetId: string | null;
  targetAllocationPct: number | null;
  status: string;
  targetAmount: number | null;
  targetValueEur: number | null;
  targetPortfolioPercentage: number | null;
  goalReachedAt: number | null;
  endDate: number | null;
}

export interface MonitoringPosition {
  assetId: string;
  balance: number;
  currentValueEur: number | null;
  averagePriceEur: number | null;
}

export interface MonitoringCycle {
  id: string;
  planId: string | null;
  endDate: number | null;
  monthlyAmountEur: number;
}

export function calculateAssetHealth(
  asset: MonitoringAsset,
  position: MonitoringPosition | null,
  totalPortfolioValueEur: number | null,
  triggeredRuleCount: number
): { status: PlanAssetHealthStatus; reason: string } {
  if (asset.goalReachedAt !== null) {
    return { status: "excelente", reason: "Objetivo alcanzado" };
  }

  if (asset.status === "paused") {
    return { status: "vigilancia", reason: "Activo pausado en el Plan" };
  }

  if (asset.status === "closed" || asset.status === "goal_reached") {
    return { status: "excelente", reason: "Posición completada o cerrada" };
  }

  if (!position || position.currentValueEur === null) {
    return { status: "neutral", reason: "Sin datos de valoración disponibles" };
  }

  if (triggeredRuleCount > 0) {
    return { status: "activada" as PlanAssetHealthStatus, reason: `${triggeredRuleCount} regla(s) de venta activada(s)` };
  }

  const target = asset.targetAllocationPct;
  if (target !== null && totalPortfolioValueEur !== null && totalPortfolioValueEur > 0) {
    const currentPct = (position.currentValueEur / totalPortfolioValueEur) * 100;
    const deviation = currentPct - target;
    if (deviation > 15) return { status: "vigilancia", reason: `Sobreponderado: ${currentPct.toFixed(1)}% vs objetivo ${target}%` };
    if (deviation > 5) return { status: "buena", reason: `Ligeramente sobreponderado: ${currentPct.toFixed(1)}% vs objetivo ${target}%` };
    if (deviation < -15) return { status: "vigilancia", reason: `Infraponderado: ${currentPct.toFixed(1)}% vs objetivo ${target}%` };
    if (deviation < -5) return { status: "buena", reason: `Ligeramente infraponderado: ${currentPct.toFixed(1)}% vs objetivo ${target}%` };
    return { status: "excelente", reason: `Dentro del rango objetivo (${currentPct.toFixed(1)}% vs ${target}%)` };
  }

  if (position.averagePriceEur !== null && position.currentValueEur > 0 && position.balance > 0) {
    const currentPrice = position.currentValueEur / position.balance;
    const ratio = currentPrice / position.averagePriceEur;
    if (ratio >= 1.5) return { status: "excelente", reason: `Precio ${((ratio - 1) * 100).toFixed(0)}% sobre el coste medio` };
    if (ratio >= 1.0) return { status: "buena", reason: `Precio positivo respecto al coste medio` };
    if (ratio >= 0.8) return { status: "vigilancia", reason: `Precio ${((1 - ratio) * 100).toFixed(0)}% bajo el coste medio` };
    return { status: "deterioro", reason: `Precio ${((1 - ratio) * 100).toFixed(0)}% bajo el coste medio` };
  }

  return { status: "neutral", reason: "Datos insuficientes para evaluar salud" };
}

export function buildAssetPlanStatus(
  asset: MonitoringAsset,
  position: MonitoringPosition | null,
  totalPortfolioValueEur: number | null,
  activeRuleCount: number,
  triggeredRuleCount: number,
  lastReviewDate: number | null
): AssetPlanStatus {
  const health = calculateAssetHealth(asset, position, totalPortfolioValueEur, triggeredRuleCount);

  const currentValueEur = position?.currentValueEur ?? null;
  const targetValueEur = asset.targetAllocationPct !== null && totalPortfolioValueEur !== null
    ? totalPortfolioValueEur * (asset.targetAllocationPct / 100)
    : asset.targetValueEur;

  const deviationEur = currentValueEur !== null && targetValueEur !== null
    ? currentValueEur - targetValueEur
    : null;

  const deviationPct = targetValueEur !== null && targetValueEur > 0 && deviationEur !== null
    ? (deviationEur / targetValueEur) * 100
    : null;

  const isUnderweight = deviationEur !== null ? deviationEur < 0 : null;

  let goalProgress: number | null = null;
  if (asset.targetAmount !== null && position && position.balance > 0) {
    goalProgress = Math.min(100, (position.balance / asset.targetAmount) * 100);
  } else if (asset.targetValueEur !== null && currentValueEur !== null) {
    goalProgress = Math.min(100, (currentValueEur / asset.targetValueEur) * 100);
  } else if (asset.targetPortfolioPercentage !== null && totalPortfolioValueEur !== null && currentValueEur !== null && totalPortfolioValueEur > 0) {
    goalProgress = Math.min(100, ((currentValueEur / totalPortfolioValueEur) / (asset.targetPortfolioPercentage / 100)) * 100);
  }

  let nextAction: string | null = null;
  if (triggeredRuleCount > 0) {
    nextAction = "Revisar regla de venta activada";
  } else if (isUnderweight === true) {
    nextAction = "Considerar aportación adicional";
  } else if (goalProgress !== null && goalProgress >= 90 && goalProgress < 100) {
    nextAction = "Objetivo próximo — preparar cierre de posición";
  }

  return {
    assetId: asset.assetId,
    cycleId: asset.cycleId,
    investmentAssetId: asset.investmentAssetId,
    targetAllocationPct: asset.targetAllocationPct,
    currentValueEur: currentValueEur !== null ? Math.round(currentValueEur * 100) / 100 : null,
    targetValueEur: targetValueEur !== null ? Math.round(targetValueEur * 100) / 100 : null,
    deviationEur: deviationEur !== null ? Math.round(deviationEur * 100) / 100 : null,
    deviationPct: deviationPct !== null ? Math.round(deviationPct * 10) / 10 : null,
    isUnderweight,
    goalProgress: goalProgress !== null ? Math.round(goalProgress * 10) / 10 : null,
    healthStatus: health.status,
    healthReason: health.reason,
    activeRules: activeRuleCount,
    triggeredRules: triggeredRuleCount,
    lastReviewDate,
    nextAction,
  };
}

export function buildPlanAlerts(params: {
  cycleId: string;
  assets: MonitoringAsset[];
  assetStatuses: AssetPlanStatus[];
  deficitEur: number;
  triggeredSaleRules: number;
  triggeredRebuyRules: number;
  pendingSubstitutions: number;
  cycle: MonitoringCycle;
  now: number;
}): PlanAlert[] {
  const { cycleId, assets, assetStatuses, deficitEur, triggeredSaleRules, triggeredRebuyRules, pendingSubstitutions, cycle, now } = params;
  const alerts: PlanAlert[] = [];

  if (deficitEur > 0) {
    alerts.push({
      id: `deficit-${cycleId}`,
      type: "deficit",
      priority: "media",
      assetId: null,
      cycleId,
      title: "Déficit de aportaciones",
      message: `Hay un déficit acumulado de ${deficitEur.toFixed(2)} € en aportaciones programadas.`,
      dataUsed: { deficitEur },
      actionAvailable: "Registrar aportación",
      generatedAt: now,
    });
  }

  if (triggeredSaleRules > 0) {
    alerts.push({
      id: `sale-rules-${cycleId}`,
      type: "venta_parcial_activada",
      priority: "alta",
      assetId: null,
      cycleId,
      title: "Regla(s) de venta activadas",
      message: `${triggeredSaleRules} regla(s) de venta parcial están activadas. Revisa Beneficios y caídas.`,
      dataUsed: { triggeredSaleRules },
      actionAvailable: "Ver reglas activadas",
      generatedAt: now,
    });
  }

  if (triggeredRebuyRules > 0) {
    alerts.push({
      id: `rebuy-rules-${cycleId}`,
      type: "compra_caida_activada",
      priority: "alta",
      assetId: null,
      cycleId,
      title: "Oportunidad de compra en caída",
      message: `${triggeredRebuyRules} regla(s) de recompra están activadas. Hay EURC disponible para desplegar.`,
      dataUsed: { triggeredRebuyRules },
      actionAvailable: "Ver compras en caída",
      generatedAt: now,
    });
  }

  if (pendingSubstitutions > 0) {
    alerts.push({
      id: `substitutions-${cycleId}`,
      type: "sustitucion_pendiente",
      priority: "media",
      assetId: null,
      cycleId,
      title: "Sustituciones pendientes",
      message: `${pendingSubstitutions} sustitución(es) de activo en estado borrador o programada.`,
      dataUsed: { pendingSubstitutions },
      actionAvailable: "Aplicar sustitución",
      generatedAt: now,
    });
  }

  if (cycle.endDate && cycle.endDate - now < 90 * 24 * 3600 * 1000 && cycle.endDate > now) {
    alerts.push({
      id: `cycle-end-${cycleId}`,
      type: "etapa_proxima_fin",
      priority: "baja",
      assetId: null,
      cycleId,
      title: "Etapa próxima a finalizar",
      message: `La etapa finaliza el ${new Date(cycle.endDate).toLocaleDateString("es-ES")}. Prepara la transición.`,
      dataUsed: { endDate: cycle.endDate },
      actionAvailable: null,
      generatedAt: now,
    });
  }

  for (const status of assetStatuses) {
    const asset = assets.find(a => a.assetId === status.assetId);
    if (!asset) continue;

    if (status.goalProgress !== null && status.goalProgress >= 90 && status.goalProgress < 100 && asset.goalReachedAt === null) {
      alerts.push({
        id: `goal-nearby-${cycleId}-${status.assetId}`,
        type: "objetivo_proximo",
        priority: "media",
        assetId: status.assetId,
        cycleId,
        title: `Objetivo próximo: ${status.assetId}`,
        message: `${status.assetId} alcanzó el ${status.goalProgress.toFixed(0)}% de su objetivo.`,
        dataUsed: { goalProgress: status.goalProgress },
        actionAvailable: "Marcar objetivo alcanzado",
        generatedAt: now,
      });
    }

    if (status.isUnderweight === true && status.deviationPct !== null && status.deviationPct < -10) {
      alerts.push({
        id: `underweight-${cycleId}-${status.assetId}`,
        type: "activo_infraponderado",
        priority: "baja",
        assetId: status.assetId,
        cycleId,
        title: `Infraponderado: ${status.assetId}`,
        message: `${status.assetId} está un ${Math.abs(status.deviationPct).toFixed(1)}% por debajo de su asignación objetivo.`,
        dataUsed: { deviationPct: status.deviationPct, targetAllocationPct: status.targetAllocationPct },
        actionAvailable: "Incluir en Compra Inteligente",
        generatedAt: now,
      });
    }
  }

  return deduplicatePlanAlerts(alerts);
}

export function deduplicatePlanAlerts(alerts: PlanAlert[]): PlanAlert[] {
  const seen = new Set<string>();
  return alerts.filter(a => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
}
