export type AutomatedOperationKind = "BULL_PARTIAL_SALE" | "BEAR_REBUY";

export type AutomatedOperationState =
  | "SCHEDULED"
  | "MONITORING"
  | "BLOCKED_DATA"
  | "BLOCKED_RISK"
  | "REVIEW_REQUIRED"
  | "READY_TO_PREVIEW"
  | "PREVIEWING"
  | "READY_TO_SUBMIT"
  | "SUBMITTED"
  | "COMPLETED"
  | "FAILED"
  | "PAUSED"
  | "CANCELLED"
  | "EXPIRED";

export type AutomationMarketRegime =
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

export type AutomationSentimentDirection =
  | "very_bullish"
  | "bullish"
  | "neutral"
  | "bearish"
  | "very_bearish";

export type AutomationDataState = "live" | "cached" | "partial" | "stale" | "unavailable";

export interface AutomationGoalContext {
  goalId: string | null;
  targetValueEur: number | null;
  currentProjectedValueEur: number | null;
  targetDate: number | null;
  reached: boolean;
}

export interface AutomationAuthorization {
  enabled: boolean;
  autoExecute: boolean;
  authorizedAt: number | null;
  expiresAt: number | null;
  authorizationVersion: string | null;
  maxSingleOperationEur: number;
  maxDailyOperations: number;
  maxDailyNotionalEur: number;
}

export interface AutomatedOperationPolicy {
  id: string;
  kind: AutomatedOperationKind;
  assetId: string;
  cycleId: string | null;
  planId: string | null;
  goalId: string | null;
  enabled: boolean;
  simulationOnly: boolean;
  createdAt: number;
  startsAt: number;
  expiresAt: number | null;
  cooldownHours: number;
  maxExecutions: number | null;
  executionCount: number;
  lastExecutedAt: number | null;
  minConfidence: number;
  minIndependentSources: number;
  requireCompleteData: boolean;
  maxMarketDataAgeMinutes: number;
  maxOperationEur: number;
  bull?: {
    allowedRegimes: AutomationMarketRegime[];
    minimumUnrealizedGainPct: number;
    minimumSentimentScore: number;
    sellPercentage: number;
    minimumResidualPositionPct: number;
  };
  bear?: {
    allowedRegimes: AutomationMarketRegime[];
    minimumDrawdownPct: number;
    maximumSentimentScore: number;
    rebuyPercentageOfFreeEurc: number;
    minimumStabilizationScore: number;
  };
  authorization: AutomationAuthorization;
}

export interface AutomationMarketContext {
  evaluatedAt: number;
  assetId: string;
  currentPriceEur: number | null;
  referencePriceEur: number | null;
  assetUnits: number;
  assetMarketValueEur: number;
  assetCostBasisEur: number;
  totalPortfolioValueEur: number;
  /** EURC operativo ya disponible después de separar la reserva fiscal. */
  operatingEurcEur: number;
  fiscalReserveEur: number;
  cashEur: number;
  regime: AutomationMarketRegime;
  sentimentDirection: AutomationSentimentDirection;
  sentimentScore: number | null;
  confidence: number;
  independentSourceCount: number;
  dataState: AutomationDataState;
  newestMarketDataAt: number | null;
  missingSignals: string[];
  stabilizationScore: number | null;
  executionsToday: number;
  notionalExecutedTodayEur: number;
  goal: AutomationGoalContext;
}

export interface AutomatedOperationProposal {
  policyId: string;
  idempotencyKey: string;
  kind: AutomatedOperationKind;
  state: AutomatedOperationState;
  assetId: string;
  cycleId: string | null;
  planId: string | null;
  goalId: string | null;
  evaluatedAt: number;
  operationType: "sell" | "rebuy";
  amountEur: number;
  baseUnits: number | null;
  percentage: number;
  fundingSource: "CRYPTO" | "EURC_FREE";
  fiscalReserveExcludedEur: number;
  currentPriceEur: number | null;
  referencePriceEur: number | null;
  drawdownPct: number | null;
  unrealizedGainPct: number | null;
  reasons: string[];
  blockers: string[];
  requiresFreshPreview: true;
  requiresUserAuthorization: boolean;
  simulationOnly: boolean;
}

const BULL_REGIMES = new Set<AutomationMarketRegime>(["BULL_EXPANSION", "EUPHORIA", "DISTRIBUTION"]);
const BEAR_REGIMES = new Set<AutomationMarketRegime>(["CORRECTION", "BEAR_MARKET", "CAPITULATION", "EARLY_RECOVERY"]);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFiniteNonNegative(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundUnits(value: number): number {
  return Math.round((value + Number.EPSILON) * 100_000_000) / 100_000_000;
}

function pctChange(current: number | null, reference: number | null): number | null {
  if (!(current != null && current > 0 && reference != null && reference > 0)) return null;
  return ((current - reference) / reference) * 100;
}

function elapsedHours(now: number, before: number | null): number | null {
  if (before == null) return null;
  return Math.max(0, (now - before) / 3_600_000);
}

function dateKey(timestamp: number): string {
  const value = new Date(timestamp);
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

function baseProposal(policy: AutomatedOperationPolicy, context: AutomationMarketContext): AutomatedOperationProposal {
  return {
    policyId: policy.id,
    idempotencyKey: `${policy.id}:${dateKey(context.evaluatedAt)}:${policy.executionCount + 1}`,
    kind: policy.kind,
    state: "MONITORING",
    assetId: policy.assetId,
    cycleId: policy.cycleId,
    planId: policy.planId,
    goalId: policy.goalId,
    evaluatedAt: context.evaluatedAt,
    operationType: policy.kind === "BULL_PARTIAL_SALE" ? "sell" : "rebuy",
    amountEur: 0,
    baseUnits: null,
    percentage: 0,
    fundingSource: policy.kind === "BULL_PARTIAL_SALE" ? "CRYPTO" : "EURC_FREE",
    fiscalReserveExcludedEur: Math.max(0, context.fiscalReserveEur),
    currentPriceEur: context.currentPriceEur,
    referencePriceEur: context.referencePriceEur,
    drawdownPct: null,
    unrealizedGainPct: null,
    reasons: [],
    blockers: [],
    requiresFreshPreview: true,
    requiresUserAuthorization: !policy.authorization.autoExecute,
    simulationOnly: policy.simulationOnly,
  };
}

function validateCommon(policy: AutomatedOperationPolicy, context: AutomationMarketContext, proposal: AutomatedOperationProposal): void {
  if (!policy.enabled) proposal.blockers.push("Política desactivada");
  if (!policy.id.trim() || !policy.assetId.trim()) proposal.blockers.push("Política incompleta");
  if (context.assetId !== policy.assetId) proposal.blockers.push("El contexto no corresponde al activo configurado");
  if (!isFiniteNumber(context.evaluatedAt) || context.evaluatedAt <= 0) proposal.blockers.push("Fecha de evaluación no válida");
  if (context.evaluatedAt < policy.startsAt) proposal.blockers.push("La política todavía no está vigente");
  if (policy.expiresAt != null && context.evaluatedAt > policy.expiresAt) proposal.blockers.push("La política ha caducado");
  if (policy.maxExecutions != null && policy.executionCount >= policy.maxExecutions) proposal.blockers.push("Número máximo de ejecuciones alcanzado");

  if (!isFiniteNonNegative(policy.cooldownHours) || !isFiniteNonNegative(policy.maxOperationEur) || policy.maxOperationEur <= 0) {
    proposal.blockers.push("Límites de la política no válidos");
  }
  if (!isFiniteNonNegative(policy.executionCount)) proposal.blockers.push("Contador de ejecuciones no válido");
  if (!isFiniteNonNegative(policy.minConfidence) || policy.minConfidence > 100) proposal.blockers.push("Umbral de confianza no válido");
  if (!Number.isInteger(policy.minIndependentSources) || policy.minIndependentSources < 0) proposal.blockers.push("Umbral de fuentes no válido");
  if (!isFiniteNonNegative(policy.maxMarketDataAgeMinutes)) proposal.blockers.push("Antigüedad máxima de datos no válida");

  const hoursSinceExecution = elapsedHours(context.evaluatedAt, policy.lastExecutedAt);
  if (hoursSinceExecution != null && hoursSinceExecution < policy.cooldownHours) {
    proposal.blockers.push(`En periodo de espera: ${hoursSinceExecution.toFixed(1)}h de ${policy.cooldownHours}h`);
  }

  if (!(context.currentPriceEur != null && Number.isFinite(context.currentPriceEur) && context.currentPriceEur > 0)) proposal.blockers.push("Precio actual no disponible");
  if (context.dataState === "unavailable") proposal.blockers.push("Datos de mercado no disponibles");
  if (policy.requireCompleteData && (context.dataState === "partial" || context.dataState === "stale")) {
    proposal.blockers.push(`Datos de mercado ${context.dataState === "partial" ? "parciales" : "caducados"}`);
  }
  if (!isFiniteNonNegative(context.confidence) || context.confidence > 100) proposal.blockers.push("Confianza de mercado no válida");
  else if (context.confidence < policy.minConfidence) proposal.blockers.push(`Confianza insuficiente: ${context.confidence.toFixed(0)} < ${policy.minConfidence.toFixed(0)}`);
  if (!Number.isInteger(context.independentSourceCount) || context.independentSourceCount < 0) proposal.blockers.push("Número de fuentes no válido");
  else if (context.independentSourceCount < policy.minIndependentSources) proposal.blockers.push(`Fuentes independientes insuficientes: ${context.independentSourceCount}/${policy.minIndependentSources}`);
  if (context.newestMarketDataAt == null || !isFiniteNumber(context.newestMarketDataAt)) {
    proposal.blockers.push("No existe fecha verificable del dato de mercado");
  } else {
    const ageMinutes = (context.evaluatedAt - context.newestMarketDataAt) / 60_000;
    if (ageMinutes < -5) proposal.blockers.push("El dato de mercado tiene una fecha futura no válida");
    else if (ageMinutes > policy.maxMarketDataAgeMinutes) proposal.blockers.push(`Datos demasiado antiguos: ${ageMinutes.toFixed(0)} minutos`);
  }
  if (context.missingSignals.length > 0) proposal.reasons.push(`Señales ausentes declaradas: ${context.missingSignals.join(", ")}`);

  const authorization = policy.authorization;
  if (!authorization.enabled) proposal.blockers.push("Autorización de automatización desactivada");
  if (!isFiniteNonNegative(authorization.maxSingleOperationEur) || authorization.maxSingleOperationEur <= 0) proposal.blockers.push("Límite por operación no válido");
  if (!Number.isInteger(authorization.maxDailyOperations) || authorization.maxDailyOperations <= 0) proposal.blockers.push("Límite diario de operaciones no válido");
  if (!isFiniteNonNegative(authorization.maxDailyNotionalEur) || authorization.maxDailyNotionalEur <= 0) proposal.blockers.push("Límite diario de capital no válido");
  if (authorization.autoExecute) {
    if (authorization.authorizedAt == null || !isFiniteNumber(authorization.authorizedAt) || authorization.authorizedAt > context.evaluatedAt) {
      proposal.blockers.push("Autorización automática no firmada o no válida");
    }
    if (authorization.expiresAt == null || !isFiniteNumber(authorization.expiresAt)) {
      proposal.blockers.push("La autorización automática debe tener caducidad");
    } else if (context.evaluatedAt > authorization.expiresAt) {
      proposal.blockers.push("Autorización de automatización caducada");
    }
    if (!authorization.authorizationVersion?.trim()) proposal.blockers.push("Versión de autorización no registrada");
  }

  if (!Number.isInteger(context.executionsToday) || context.executionsToday < 0) proposal.blockers.push("Contador diario de operaciones no válido");
  else if (context.executionsToday >= authorization.maxDailyOperations) proposal.blockers.push("Límite diario de operaciones alcanzado");
  if (!isFiniteNonNegative(context.notionalExecutedTodayEur)) proposal.blockers.push("Capital diario ejecutado no válido");
  else if (context.notionalExecutedTodayEur >= authorization.maxDailyNotionalEur) proposal.blockers.push("Límite diario de capital alcanzado");
  if (context.goal.reached) proposal.blockers.push("El objetivo vinculado ya está alcanzado");
}

function finalizeState(policy: AutomatedOperationPolicy, proposal: AutomatedOperationProposal): AutomatedOperationProposal {
  if (!Number.isFinite(proposal.amountEur) || proposal.amountEur < 0) proposal.blockers.push("Importe calculado no válido");
  if (proposal.blockers.length > 0) {
    const dataBlocked = proposal.blockers.some((reason) => {
      const lower = reason.toLowerCase();
      return lower.includes("dato") || lower.includes("precio") || lower.includes("fuente") || lower.includes("confianza") || lower.includes("fecha futura");
    });
    proposal.state = dataBlocked ? "BLOCKED_DATA" : "BLOCKED_RISK";
    return proposal;
  }
  if (proposal.amountEur <= 0) {
    proposal.state = "MONITORING";
    return proposal;
  }
  if (!policy.authorization.autoExecute || policy.simulationOnly) {
    proposal.state = "REVIEW_REQUIRED";
    proposal.requiresUserAuthorization = true;
    return proposal;
  }
  proposal.state = "READY_TO_PREVIEW";
  proposal.requiresUserAuthorization = false;
  return proposal;
}

function evaluateBullSale(policy: AutomatedOperationPolicy, context: AutomationMarketContext): AutomatedOperationProposal {
  const proposal = baseProposal(policy, context);
  validateCommon(policy, context, proposal);
  const config = policy.bull;
  if (!config) {
    proposal.blockers.push("Configuración alcista ausente");
    return finalizeState(policy, proposal);
  }

  if (!isFiniteNonNegative(config.minimumUnrealizedGainPct) || !isFiniteNumber(config.minimumSentimentScore)) proposal.blockers.push("Umbrales alcistas no válidos");
  if (!isFiniteNonNegative(config.sellPercentage) || config.sellPercentage > 100) proposal.blockers.push("Porcentaje de venta no válido");
  if (!isFiniteNonNegative(config.minimumResidualPositionPct) || config.minimumResidualPositionPct > 100) proposal.blockers.push("Posición residual mínima no válida");

  const allowedRegimes = config.allowedRegimes.length > 0 ? new Set(config.allowedRegimes) : BULL_REGIMES;
  if (!allowedRegimes.has(context.regime)) proposal.blockers.push(`Régimen ${context.regime} no permite venta parcial`);
  const gainPct = context.assetCostBasisEur > 0
    ? ((context.assetMarketValueEur - context.assetCostBasisEur) / context.assetCostBasisEur) * 100
    : null;
  proposal.unrealizedGainPct = gainPct;
  if (gainPct == null || !Number.isFinite(gainPct) || gainPct < config.minimumUnrealizedGainPct) {
    proposal.blockers.push(`Plusvalía insuficiente para vender: ${gainPct == null || !Number.isFinite(gainPct) ? "sin base de coste" : `${gainPct.toFixed(1)}%`}`);
  }
  if (context.sentimentScore == null || !Number.isFinite(context.sentimentScore) || context.sentimentScore < config.minimumSentimentScore) {
    proposal.blockers.push("El sentimiento no confirma una fase alcista de recogida");
  }
  if (!(isFiniteNonNegative(context.assetUnits) && context.assetUnits > 0 && isFiniteNonNegative(context.assetMarketValueEur) && context.assetMarketValueEur > 0)) {
    proposal.blockers.push("No existe posición vendible");
  }

  const configuredPct = clamp(config.sellPercentage, 0, 100);
  const maxSellPct = clamp(100 - config.minimumResidualPositionPct, 0, 100);
  const percentage = Math.min(configuredPct, maxSellPct);
  const authorizationRemaining = Math.max(0, policy.authorization.maxDailyNotionalEur - context.notionalExecutedTodayEur);
  const amountEur = Math.min(
    context.assetMarketValueEur * (percentage / 100),
    policy.maxOperationEur,
    policy.authorization.maxSingleOperationEur,
    authorizationRemaining,
  );
  proposal.percentage = percentage;
  proposal.amountEur = roundMoney(Math.max(0, amountEur));
  proposal.baseUnits = context.currentPriceEur && context.currentPriceEur > 0 ? roundUnits(proposal.amountEur / context.currentPriceEur) : null;
  proposal.reasons.push(`Régimen ${context.regime}; venta parcial configurada del ${percentage.toFixed(1)}%`);
  if (gainPct != null && Number.isFinite(gainPct)) proposal.reasons.push(`Plusvalía no realizada ${gainPct.toFixed(1)}%`);
  proposal.reasons.push(`Capital destinado a reserva y futuras recompras: ${proposal.amountEur.toFixed(2)} EUR antes del preview real`);
  return finalizeState(policy, proposal);
}

function evaluateBearRebuy(policy: AutomatedOperationPolicy, context: AutomationMarketContext): AutomatedOperationProposal {
  const proposal = baseProposal(policy, context);
  validateCommon(policy, context, proposal);
  const config = policy.bear;
  if (!config) {
    proposal.blockers.push("Configuración bajista ausente");
    return finalizeState(policy, proposal);
  }

  if (!isFiniteNonNegative(config.minimumDrawdownPct) || !isFiniteNumber(config.maximumSentimentScore)) proposal.blockers.push("Umbrales bajistas no válidos");
  if (!isFiniteNonNegative(config.rebuyPercentageOfFreeEurc) || config.rebuyPercentageOfFreeEurc > 100) proposal.blockers.push("Porcentaje de recompra no válido");
  if (!isFiniteNonNegative(config.minimumStabilizationScore) || config.minimumStabilizationScore > 100) proposal.blockers.push("Umbral de estabilización no válido");

  const allowedRegimes = config.allowedRegimes.length > 0 ? new Set(config.allowedRegimes) : BEAR_REGIMES;
  if (!allowedRegimes.has(context.regime)) proposal.blockers.push(`Régimen ${context.regime} no permite recompra`);
  const changePct = pctChange(context.currentPriceEur, context.referencePriceEur);
  const drawdownPct = changePct == null ? null : Math.max(0, -changePct);
  proposal.drawdownPct = drawdownPct;
  if (drawdownPct == null || drawdownPct < config.minimumDrawdownPct) {
    proposal.blockers.push(`Caída insuficiente para recomprar: ${drawdownPct == null ? "sin referencia" : `${drawdownPct.toFixed(1)}%`}`);
  }
  if (context.sentimentScore == null || !Number.isFinite(context.sentimentScore) || context.sentimentScore > config.maximumSentimentScore) {
    proposal.blockers.push("El sentimiento todavía no confirma una zona bajista de recompra");
  }
  if (context.stabilizationScore == null || !Number.isFinite(context.stabilizationScore) || context.stabilizationScore < config.minimumStabilizationScore) {
    proposal.blockers.push("No existe estabilización suficiente para desplegar el siguiente tramo");
  }

  const freeEurc = isFiniteNonNegative(context.operatingEurcEur) ? context.operatingEurcEur : 0;
  if (!isFiniteNonNegative(context.operatingEurcEur)) proposal.blockers.push("Saldo EURC operativo no válido");
  if (!isFiniteNonNegative(context.fiscalReserveEur)) proposal.blockers.push("Reserva fiscal no válida");
  if (freeEurc <= 0) proposal.blockers.push("No existe EURC operativo libre; la reserva fiscal queda excluida");
  const percentage = clamp(config.rebuyPercentageOfFreeEurc, 0, 100);
  const authorizationRemaining = Math.max(0, policy.authorization.maxDailyNotionalEur - context.notionalExecutedTodayEur);
  const goalGap = context.goal.targetValueEur != null && context.goal.currentProjectedValueEur != null
    ? Math.max(0, context.goal.targetValueEur - context.goal.currentProjectedValueEur)
    : Number.POSITIVE_INFINITY;
  const amountEur = Math.min(
    freeEurc * (percentage / 100),
    policy.maxOperationEur,
    policy.authorization.maxSingleOperationEur,
    authorizationRemaining,
    goalGap,
  );
  proposal.percentage = percentage;
  proposal.amountEur = roundMoney(Math.max(0, amountEur));
  proposal.baseUnits = context.currentPriceEur && context.currentPriceEur > 0 ? roundUnits(proposal.amountEur / context.currentPriceEur) : null;
  proposal.reasons.push(`Régimen ${context.regime}; recompra escalonada del ${percentage.toFixed(1)}% del EURC operativo libre`);
  if (drawdownPct != null) proposal.reasons.push(`Caída desde referencia: ${drawdownPct.toFixed(1)}%`);
  proposal.reasons.push(`Reserva fiscal excluida: ${Math.max(0, context.fiscalReserveEur).toFixed(2)} EUR`);
  return finalizeState(policy, proposal);
}

export function evaluateAutomatedOperation(
  policy: AutomatedOperationPolicy,
  context: AutomationMarketContext,
): AutomatedOperationProposal {
  if (policy.kind === "BULL_PARTIAL_SALE") return evaluateBullSale(policy, context);
  return evaluateBearRebuy(policy, context);
}

export function isProposalExecutable(proposal: AutomatedOperationProposal): boolean {
  return proposal.state === "READY_TO_PREVIEW" && Number.isFinite(proposal.amountEur) && proposal.amountEur > 0 && proposal.blockers.length === 0;
}
