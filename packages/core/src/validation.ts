import { z } from "zod";

export const AssetSchema = z.object({
  id: z.string().min(1),
  symbol: z.string().min(1),
  name: z.string().min(1),
  logoUrl: z.string().url().optional().nullable(),
  type: z.enum(["crypto", "fiat"]),
  createdAt: z.number().int(),
  updatedAt: z.number().int()
});

export const AccountSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  type: z.enum(["exchange", "wallet", "bank"]),
  createdAt: z.number().int()
});

export const TransactionTypeEnum = z.enum([
  "buy", "sell", "convert", "transfer_in", "transfer_out", 
  "reward", "staking", "airdrop", "fee", "adjustment"
]);

export const TransactionLegSchema = z.object({
  id: z.string().uuid().optional(),
  assetId: z.string().min(1),
  accountId: z.string().uuid().optional(),
  amount: z.number(), // Positivo = entrada, Negativo = salida
  legType: z.enum(["source", "destination", "fee"]),
  valuationEur: z.number().optional()
});

export const FeeSchema = z.object({
  assetId: z.string().min(1),
  amount: z.number().positive()
});

// Esquema unificado para validación desde el formulario
export const CreateTransactionSchema = z.object({
  type: TransactionTypeEnum,
  date: z.number().int(),
  externalId: z.string().optional(),
  notes: z.string().optional(),
  cycleId: z.string().nullable().optional(),
  legs: z.array(TransactionLegSchema).min(1),
  fees: z.array(FeeSchema).optional()
});

export const TransactionLegInputSchema = z.object({
  assetId: z.string().min(1),
  amount: z.number(),
  legType: z.enum(["source", "destination", "fee"]),
  valuationEur: z.number().optional().nullable(),
  valuationStatus: z.enum(["valued", "pending", "estimated"]).optional().nullable()
});

export const TransactionInputSchema = z.object({
  id: z.string(),
  type: TransactionTypeEnum,
  date: z.number().int(),
  externalId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  cycleId: z.string().nullable().optional(),
  fees: z.array(FeeSchema).optional(),
  legs: z.array(TransactionLegInputSchema)
});

export const TransactionInputListSchema = z.array(TransactionInputSchema);

const TimestampSchema = z.number().int().nonnegative();
const OptionalTextSchema = z.string().trim().nullable().optional();

export const InvestmentPlanStatusSchema = z.enum(["active", "inactive", "archived"]);

export const InvestmentPlanSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  status: InvestmentPlanStatusSchema,
  baseCurrency: z.string().min(1),
  notes: z.string().nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});

export const CreateInvestmentPlanSchema = z.object({
  name: z.string().trim().min(1),
  description: OptionalTextSchema,
  status: InvestmentPlanStatusSchema.optional(),
  baseCurrency: z.string().trim().min(1).optional(),
  notes: OptionalTextSchema
});

export const UpdateInvestmentPlanSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: OptionalTextSchema,
  status: InvestmentPlanStatusSchema.optional(),
  baseCurrency: z.string().trim().min(1).optional(),
  notes: OptionalTextSchema
});

export const InvestmentCycleStatusSchema = z.enum(["planned", "active", "closed", "paused"]);
export const CycleGoalEnum = z.enum(["acumulacion", "crecimiento", "preservacion", "renta"]);
export const CycleRiskEnum = z.enum(["bajo", "moderado", "alto", "muy_alto"]);

export const InvestmentCycleSchema = z.object({
  id: z.string().min(1),
  planId: z.string().min(1),
  name: z.string().min(1),
  startDate: TimestampSchema,
  endDate: TimestampSchema.nullable(),
  monthlyAmountEur: z.number().nonnegative(),
  contributionCurrency: z.string().min(1),
  status: InvestmentCycleStatusSchema,
  priority: z.number().int(),
  objetivo: CycleGoalEnum.nullable().optional(),
  riesgo: CycleRiskEnum.nullable().optional(),
  allowExtraContributions: z.boolean().optional().default(true),
  notes: z.string().nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});

export const CreateInvestmentCycleSchema = z.object({
  planId: z.string().min(1),
  name: z.string().trim().min(1),
  startDate: TimestampSchema,
  endDate: TimestampSchema.nullable().optional(),
  monthlyAmountEur: z.number().nonnegative(),
  contributionCurrency: z.string().trim().min(1).optional(),
  status: InvestmentCycleStatusSchema.optional(),
  priority: z.number().int().optional(),
  objetivo: CycleGoalEnum.nullable().optional(),
  riesgo: CycleRiskEnum.nullable().optional(),
  allowExtraContributions: z.boolean().optional(),
  notes: OptionalTextSchema
});

export const UpdateInvestmentCycleSchema = z.object({
  planId: z.string().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  startDate: TimestampSchema.optional(),
  endDate: TimestampSchema.nullable().optional(),
  monthlyAmountEur: z.number().nonnegative().optional(),
  contributionCurrency: z.string().trim().min(1).optional(),
  status: InvestmentCycleStatusSchema.optional(),
  priority: z.number().int().optional(),
  objetivo: CycleGoalEnum.nullable().optional(),
  riesgo: CycleRiskEnum.nullable().optional(),
  allowExtraContributions: z.boolean().optional(),
  notes: OptionalTextSchema
});

export const InvestmentAssetAllocationTypeSchema = z.enum(["percentage", "amount"]);
export const InvestmentAssetStatusSchema = z.enum(["active", "paused", "closed", "goal_reached"]);
export const GoalTypeSchema = z.enum(["quantity", "value", "portfolio_percentage"]);

export const InvestmentAssetSchema = z.object({
  id: z.string().min(1),
  cycleId: z.string().min(1),
  assetId: z.string().min(1),
  allocationType: InvestmentAssetAllocationTypeSchema,
  allocationValue: z.number().nonnegative(),
  allocationPercentage: z.number().nonnegative().max(100).nullable(),
  fixedAmountEur: z.number().nonnegative().nullable(),
  priority: z.number().int(),
  targetAmount: z.number().nonnegative().nullable(),
  targetValueEur: z.number().nonnegative().nullable(),
  targetPortfolioPercentage: z.number().nonnegative().max(100).nullable(),
  startDate: TimestampSchema,
  endDate: TimestampSchema.nullable(),
  status: InvestmentAssetStatusSchema,
  isActive: z.boolean(),
  notes: z.string().nullable().optional(),
  goalReachedAt: TimestampSchema.nullable().optional(),
  goalReachedValue: z.number().nullable().optional(),
  goalReachedType: GoalTypeSchema.nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});

export const CreateInvestmentAssetSchema = z.object({
  cycleId: z.string().min(1),
  assetId: z.string().min(1),
  allocationType: InvestmentAssetAllocationTypeSchema.optional(),
  allocationValue: z.number().nonnegative().optional(),
  allocationPercentage: z.number().nonnegative().max(100).nullable().optional(),
  fixedAmountEur: z.number().nonnegative().nullable().optional(),
  priority: z.number().int().optional(),
  targetAmount: z.number().nonnegative().nullable().optional(),
  targetValueEur: z.number().nonnegative().nullable().optional(),
  targetPortfolioPercentage: z.number().nonnegative().max(100).nullable().optional(),
  startDate: TimestampSchema,
  endDate: TimestampSchema.nullable().optional(),
  status: InvestmentAssetStatusSchema.optional(),
  isActive: z.boolean().optional(),
  notes: OptionalTextSchema
});

export const UpdateInvestmentAssetSchema = z.object({
  cycleId: z.string().min(1).optional(),
  assetId: z.string().min(1).optional(),
  allocationType: InvestmentAssetAllocationTypeSchema.optional(),
  allocationValue: z.number().nonnegative().optional(),
  allocationPercentage: z.number().nonnegative().max(100).nullable().optional(),
  fixedAmountEur: z.number().nonnegative().nullable().optional(),
  priority: z.number().int().optional(),
  targetAmount: z.number().nonnegative().nullable().optional(),
  targetValueEur: z.number().nonnegative().nullable().optional(),
  targetPortfolioPercentage: z.number().nonnegative().max(100).nullable().optional(),
  startDate: TimestampSchema.optional(),
  endDate: TimestampSchema.nullable().optional(),
  status: InvestmentAssetStatusSchema.optional(),
  isActive: z.boolean().optional(),
  notes: OptionalTextSchema
});

export const InvestmentAssetStateChangeSchema = z.object({
  effectiveDate: TimestampSchema.optional(),
  notes: OptionalTextSchema
});

export const MarkGoalReachedInputSchema = z.object({
  effectiveDate: TimestampSchema,
  observedValue: z.number(),
  goalType: GoalTypeSchema,
  redistribution: z.array(z.object({
    investmentAssetId: z.string().min(1),
    newAllocationValue: z.number().nonnegative(),
    newAllocationPercentage: z.number().nonnegative().max(100).nullable(),
  })).optional(),
});

export const StrategyRevisionSchema = z.object({
  id: z.string().min(1),
  cycleId: z.string().min(1),
  effectiveDate: TimestampSchema,
  title: z.string().min(1),
  notes: z.string().nullable().optional(),
  changesJson: z.string(),
  createdAt: TimestampSchema
});

export const CreateStrategyRevisionSchema = z.object({
  cycleId: z.string().min(1),
  effectiveDate: TimestampSchema,
  title: z.string().trim().min(1),
  notes: OptionalTextSchema,
  changesJson: z.string().optional()
});

export const TreasuryAccountTypeSchema = z.enum(["cash", "eurc", "fiscal_reserve"]);
export const TreasuryMovementTypeSchema = z.enum([
  "efectivo_entrada",
  "efectivo_salida",
  "eurc_entrada",
  "eurc_salida",
  "reserva_fiscal",
  "liberar_reserva",
  "asignar_recompra",
  "usar_recompra",
]);
export const CycleLiquidityStatusSchema = z.enum(["reserved", "used", "released"]);

export const TreasuryMovementSchema = z.object({
  id: z.string().min(1),
  date: TimestampSchema,
  type: TreasuryMovementTypeSchema,
  sourceAccountType: TreasuryAccountTypeSchema.nullable(),
  destinationAccountType: TreasuryAccountTypeSchema.nullable(),
  amount: z.number().positive(),
  currency: z.string().min(1),
  reason: z.string().min(1),
  referenceType: z.string().nullable().optional(),
  referenceId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});

export const CreateTreasuryMovementSchema = z.object({
  date: TimestampSchema,
  type: TreasuryMovementTypeSchema,
  sourceAccountType: TreasuryAccountTypeSchema.nullable().optional(),
  destinationAccountType: TreasuryAccountTypeSchema.nullable().optional(),
  amount: z.number().positive(),
  currency: z.string().trim().min(1).optional(),
  reason: z.string().trim().min(1),
  referenceType: z.string().trim().nullable().optional(),
  referenceId: z.string().trim().nullable().optional(),
  notes: OptionalTextSchema
});

export const UpdateTreasuryMovementSchema = CreateTreasuryMovementSchema;

export const TreasurySummarySchema = z.object({
  cashBalance: z.number(),
  eurcBalance: z.number(),
  fiscalReserveBalance: z.number(),
  totalLiquidity: z.number(),
  freeRebuyLiquidity: z.number(),
  allocatedToRebuy: z.number(),
  freeCashForRebuy: z.number(),
  allocatedCashToRebuy: z.number(),
  recommendedFiscalReserve: z.number(),
  pendingEstimatedTaxes: z.number(),
  updatedAt: TimestampSchema
});

export const SetFiscalReserveSchema = z.object({
  amountEur: z.number().nonnegative(),
  notes: OptionalTextSchema
});

export const AllocateEurcToRebuySchema = z.object({
  cycleId: z.string().trim().nullable().optional(),
  amountEur: z.number().positive(),
  reason: z.string().trim().min(1),
  targetAssetId: z.string().trim().nullable().optional(),
  referenceType: z.string().trim().nullable().optional(),
  referenceId: z.string().trim().nullable().optional(),
  notes: OptionalTextSchema
});

export const AllocateCashToRebuySchema = AllocateEurcToRebuySchema;

export const CycleLiquiditySourceTypeSchema = z.enum(["eurc", "cash"]);

export const CycleLiquidityAllocationSchema = z.object({
  id: z.string().min(1),
  cycleId: z.string().nullable(),
  amountEur: z.number().positive(),
  sourceType: CycleLiquiditySourceTypeSchema,
  targetAssetId: z.string().nullable().optional(),
  status: CycleLiquidityStatusSchema,
  reason: z.string().min(1),
  referenceType: z.string().nullable().optional(),
  referenceId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  usedAt: TimestampSchema.nullable()
});

export const FiscalReserveMovementSchema = z.object({
  id: z.string().min(1),
  treasuryMovementId: z.string().nullable(),
  realizedGainId: z.string().nullable(),
  date: TimestampSchema,
  amountEur: z.number(),
  reason: z.string().min(1),
  notes: z.string().nullable().optional(),
  createdAt: TimestampSchema
});

export const MarketPhaseEnum = z.enum([
  "acumulacion",
  "recuperacion",
  "inicio_alcista",
  "alcista_fuerte",
  "euforia",
  "distribucion",
  "bajista",
  "correccion",
  "capitulacion",
  "incertidumbre",
]);

export const CryptoControlIndexSchema = z.object({
  phase: MarketPhaseEnum.nullable(),
  confidence: z.enum(["alta", "media", "baja"]),
  indicatorsUsed: z.array(z.string()),
  indicatorsUnavailable: z.array(z.string()),
  reasoning: z.string(),
  calculatedAt: TimestampSchema
});

export const CreatePartialSaleSchema = z.object({
  cycleId: z.string().min(1),
  transactionId: z.string().min(1),
  percentageOfHolding: z.number().positive().max(99.99),
  proceedsEur: z.number().positive(),
  notes: OptionalTextSchema
});

export const PartialSaleSchema = z.object({
  id: z.string().min(1),
  cycleId: z.string().min(1),
  transactionId: z.string().min(1),
  assetId: z.string().min(1),
  percentageOfHolding: z.number(),
  proceedsEur: z.number(),
  date: TimestampSchema,
  notes: z.string().nullable().optional(),
  createdAt: TimestampSchema
});

export const MonthlyContributionSchema = z.object({
  monthKey: z.string(),
  programmedEur: z.number(),
  actualEur: z.number(),
  extraEur: z.number()
});

export const CycleMetricsSchema = z.object({
  cycleId: z.string(),
  monthsElapsed: z.number(),
  monthsRemaining: z.number().nullable(),
  percentComplete: z.number().nullable(),
  expectedContributionMonthly: z.number(),
  expectedContributionAnnual: z.number(),
  expectedContributionToDate: z.number(),
  expectedContributionTotal: z.number().nullable(),
  actualContribution: z.number(),
  contributionDifference: z.number(),
  extraContribution: z.number(),
  contributionCompliancePercentage: z.number().nullable(),
  monthlyContributions: z.array(MonthlyContributionSchema),
  currentValueEur: z.number(),
  heldCostBasisEur: z.number(),
  profitEur: z.number(),
  roiPercentage: z.number().nullable(),
  hasPendingValuation: z.boolean()
});

export type CreateTransactionInput = z.infer<typeof CreateTransactionSchema>;
export type TransactionType = z.infer<typeof TransactionTypeEnum>;
export type Asset = z.infer<typeof AssetSchema>;
export type Account = z.infer<typeof AccountSchema>;
export type TransactionLegInput = z.infer<typeof TransactionLegInputSchema>;
export type TransactionInput = z.infer<typeof TransactionInputSchema>;
export type InvestmentPlan = z.infer<typeof InvestmentPlanSchema>;
export type CreateInvestmentPlanInput = z.infer<typeof CreateInvestmentPlanSchema>;
export type UpdateInvestmentPlanInput = z.infer<typeof UpdateInvestmentPlanSchema>;
export type InvestmentPlanStatus = z.infer<typeof InvestmentPlanStatusSchema>;
export type InvestmentCycle = z.infer<typeof InvestmentCycleSchema>;
export type CreateInvestmentCycleInput = z.infer<typeof CreateInvestmentCycleSchema>;
export type UpdateInvestmentCycleInput = z.infer<typeof UpdateInvestmentCycleSchema>;
export type InvestmentCycleStatus = z.infer<typeof InvestmentCycleStatusSchema>;
export type InvestmentAsset = z.infer<typeof InvestmentAssetSchema>;
export type CreateInvestmentAssetInput = z.infer<typeof CreateInvestmentAssetSchema>;
export type UpdateInvestmentAssetInput = z.infer<typeof UpdateInvestmentAssetSchema>;
export type InvestmentAssetStateChangeInput = z.infer<typeof InvestmentAssetStateChangeSchema>;
export type InvestmentAssetStatus = z.infer<typeof InvestmentAssetStatusSchema>;
export type GoalType = z.infer<typeof GoalTypeSchema>;
export type MarkGoalReachedInput = z.infer<typeof MarkGoalReachedInputSchema>;
export type StrategyRevision = z.infer<typeof StrategyRevisionSchema>;
export type CreateStrategyRevisionInput = z.infer<typeof CreateStrategyRevisionSchema>;
export type TreasuryAccountType = z.infer<typeof TreasuryAccountTypeSchema>;
export type TreasuryMovementType = z.infer<typeof TreasuryMovementTypeSchema>;
export type TreasuryMovement = z.infer<typeof TreasuryMovementSchema>;
export type CreateTreasuryMovementInput = z.infer<typeof CreateTreasuryMovementSchema>;
export type UpdateTreasuryMovementInput = z.infer<typeof UpdateTreasuryMovementSchema>;
export type TreasurySummary = z.infer<typeof TreasurySummarySchema>;
export type SetFiscalReserveInput = z.infer<typeof SetFiscalReserveSchema>;
export type AllocateEurcToRebuyInput = z.infer<typeof AllocateEurcToRebuySchema>;
export type CycleLiquidityStatus = z.infer<typeof CycleLiquidityStatusSchema>;
export type CycleLiquiditySourceType = z.infer<typeof CycleLiquiditySourceTypeSchema>;
export type CycleLiquidityAllocation = z.infer<typeof CycleLiquidityAllocationSchema>;
export type AllocateCashToRebuyInput = z.infer<typeof AllocateCashToRebuySchema>;
export type FiscalReserveMovement = z.infer<typeof FiscalReserveMovementSchema>;
export type CycleMetrics = z.infer<typeof CycleMetricsSchema>;
export type CreatePartialSaleInput = z.infer<typeof CreatePartialSaleSchema>;
export type PartialSale = z.infer<typeof PartialSaleSchema>;
export type MarketPhaseValue = z.infer<typeof MarketPhaseEnum>;
export type CryptoControlIndex = z.infer<typeof CryptoControlIndexSchema>;

// --- CONTRIBUTION SCHEDULE ---

export const ContributionTypeEnum = z.enum(["periodica", "extraordinaria"]);
export const ContributionStatusEnum = z.enum(["pendiente", "ejecutada", "cancelada"]);

export const ContributionScheduleSchema = z.object({
  id: z.string().min(1),
  cycleId: z.string().min(1),
  type: ContributionTypeEnum,
  plannedDate: TimestampSchema,
  amountEur: z.number().positive(),
  currency: z.string().min(1),
  destination: z.string().nullable(),
  status: ContributionStatusEnum,
  executedAt: TimestampSchema.nullable(),
  notes: z.string().nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});

export const CreateContributionScheduleSchema = z.object({
  cycleId: z.string().min(1),
  type: ContributionTypeEnum.optional(),
  plannedDate: TimestampSchema,
  amountEur: z.number().positive(),
  currency: z.string().trim().min(1).optional(),
  destination: z.string().nullable().optional(),
  notes: OptionalTextSchema
});

export const UpdateContributionScheduleSchema = z.object({
  plannedDate: TimestampSchema.optional(),
  amountEur: z.number().positive().optional(),
  currency: z.string().trim().min(1).optional(),
  destination: z.string().nullable().optional(),
  type: ContributionTypeEnum.optional(),
  notes: OptionalTextSchema
});

export const ContributionMonthlyStatusEnum = z.enum([
  "prevista", "pendiente", "parcial", "cumplida", "superada", "omitida", "cancelada"
]);

export const ContributionMonthlySummarySchema = z.object({
  yearMonth: z.string(),
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  cycleId: z.string(),
  plannedAmountEur: z.number(),
  actualAmountEur: z.number(),
  scheduledPortionEur: z.number(),
  extraordinaryAmountEur: z.number(),
  deficitAmountEur: z.number(),
  status: ContributionMonthlyStatusEnum,
  entryCount: z.number().int(),
});

export const CycleContributionAggregatesSchema = z.object({
  cycleId: z.string(),
  totalPlannedEur: z.number(),
  totalActualEur: z.number(),
  totalScheduledPortionEur: z.number(),
  totalExtraordinaryEur: z.number(),
  totalDeficitEur: z.number(),
  compliancePercentage: z.number().nullable(),
  monthsCumplida: z.number().int(),
  monthsParcial: z.number().int(),
  monthsOmitida: z.number().int(),
  monthsSuperada: z.number().int(),
  lastContributionDate: TimestampSchema.nullable(),
  nextScheduledDate: TimestampSchema.nullable(),
});

export type ContributionType = z.infer<typeof ContributionTypeEnum>;
export type ContributionStatus = z.infer<typeof ContributionStatusEnum>;
export type ContributionMonthlyStatus = z.infer<typeof ContributionMonthlyStatusEnum>;
export type ContributionMonthlySummary = z.infer<typeof ContributionMonthlySummarySchema>;
export type CycleContributionAggregates = z.infer<typeof CycleContributionAggregatesSchema>;
export type ContributionSchedule = z.infer<typeof ContributionScheduleSchema>;
export type CreateContributionScheduleInput = z.infer<typeof CreateContributionScheduleSchema>;
export type UpdateContributionScheduleInput = z.infer<typeof UpdateContributionScheduleSchema>;

// --- ASSET SUBSTITUTIONS ---

export const SubstitutionStatusEnum = z.enum(["borrador", "programada", "aplicada", "cancelada"]);
export const AllocationTransferModeEnum = z.enum(["full", "custom", "pending"]);

export const AssetSubstitutionSchema = z.object({
  id: z.string().min(1),
  cycleId: z.string().min(1),
  fromAssetId: z.string().min(1),
  toAssetId: z.string().nullable(),
  fromInvestmentAssetId: z.string().nullable(),
  toInvestmentAssetId: z.string().nullable(),
  effectiveDate: TimestampSchema,
  status: SubstitutionStatusEnum,
  allocationTransferMode: AllocationTransferModeEnum.nullable(),
  allocationTransferPercentage: z.number().nullable(),
  allocationTransferAmount: z.number().nullable(),
  appliedAt: TimestampSchema.nullable(),
  revisionId: z.string().nullable(),
  reason: z.string().min(1),
  notes: z.string().nullable().optional(),
  createdAt: TimestampSchema
});

export const CreateAssetSubstitutionSchema = z.object({
  cycleId: z.string().min(1),
  fromAssetId: z.string().min(1),
  toAssetId: z.string().nullable().optional(),
  fromInvestmentAssetId: z.string().nullable().optional(),
  effectiveDate: TimestampSchema,
  status: SubstitutionStatusEnum.optional(),
  allocationTransferMode: AllocationTransferModeEnum.nullable().optional(),
  allocationTransferPercentage: z.number().nonnegative().max(100).nullable().optional(),
  allocationTransferAmount: z.number().nonnegative().nullable().optional(),
  reason: z.string().min(1),
  notes: OptionalTextSchema
});

export const UpdateAssetSubstitutionSchema = z.object({
  toAssetId: z.string().nullable().optional(),
  effectiveDate: TimestampSchema.optional(),
  status: SubstitutionStatusEnum.optional(),
  allocationTransferMode: AllocationTransferModeEnum.nullable().optional(),
  allocationTransferPercentage: z.number().nonnegative().max(100).nullable().optional(),
  allocationTransferAmount: z.number().nonnegative().nullable().optional(),
  reason: z.string().min(1).optional(),
  notes: OptionalTextSchema
});

export type SubstitutionStatus = z.infer<typeof SubstitutionStatusEnum>;
export type AllocationTransferMode = z.infer<typeof AllocationTransferModeEnum>;
export type AssetSubstitution = z.infer<typeof AssetSubstitutionSchema>;
export type CreateAssetSubstitutionInput = z.infer<typeof CreateAssetSubstitutionSchema>;
export type UpdateAssetSubstitutionInput = z.infer<typeof UpdateAssetSubstitutionSchema>;
export type CycleGoal = z.infer<typeof CycleGoalEnum>;
export type CycleRisk = z.infer<typeof CycleRiskEnum>;

// --- ASSET HEALTH ---

export const AssetHealthStatusEnum = z.enum(["activo", "observacion", "riesgo_elevado", "salida_recomendada", "retirado", "insufficient_data"]);
export const AssetTrendEnum = z.enum(["alcista", "lateral", "bajista"]);
export const AssetRiskLevelEnum = z.enum(["bajo", "moderado", "alto", "muy_alto"]);
export const AssetStrategicStateEnum = z.enum(["excelente", "buena", "neutral", "vigilancia", "deterioro", "sustitucion_recomendada"]);

export const AssetHealthResultSchema = z.object({
  status: AssetHealthStatusEnum,
  relativeStrengthVsBtc: z.number().nullable(),
  strongEntrySignal: z.boolean(),
  tendencia: AssetTrendEnum.nullable(),
  riesgoNivel: AssetRiskLevelEnum,
  estadoEstrategico: AssetStrategicStateEnum,
  reasoning: z.string(),
  signalsUsed: z.array(z.string()),
  signalsUnavailable: z.array(z.string())
});

export type AssetHealthStatus = z.infer<typeof AssetHealthStatusEnum>;
export type AssetTrend = z.infer<typeof AssetTrendEnum>;
export type AssetRiskLevel = z.infer<typeof AssetRiskLevelEnum>;
export type AssetStrategicState = z.infer<typeof AssetStrategicStateEnum>;
export type AssetHealthResult = z.infer<typeof AssetHealthResultSchema>;

// --- ALERTAS ESTRATÉGICAS (calculadas por demanda, no persistidas) ---

export const StrategicAlertTypeEnum = z.enum([
  "debilidad_relativa",
  "debilidad_critica",
  "sustitucion_recomendada",
  "peso_excesivo",
  "peso_insuficiente",
  "activo_en_observacion"
]);
export const StrategicAlertSeverityEnum = z.enum(["info", "advertencia", "critica"]);

export const StrategicAlertSchema = z.object({
  id: z.string(),
  cycleId: z.string(),
  assetId: z.string().nullable(),
  type: StrategicAlertTypeEnum,
  severity: StrategicAlertSeverityEnum,
  title: z.string(),
  message: z.string(),
});

export type StrategicAlertType = z.infer<typeof StrategicAlertTypeEnum>;
export type StrategicAlertSeverity = z.infer<typeof StrategicAlertSeverityEnum>;
export type StrategicAlert = z.infer<typeof StrategicAlertSchema>;

// --- FASE G — MOTOR DE DECISIÓN ESTRATÉGICA ---

export const MarketPhaseResultSchema = z.object({
  phase: MarketPhaseEnum,
  confidence: z.enum(["alta", "media", "baja"]),
  indicatorsUsed: z.array(z.string()),
  indicatorsUnavailable: z.array(z.string()),
  reasoning: z.string(),
});
export type MarketPhaseResult = z.infer<typeof MarketPhaseResultSchema>;

// G3 — Propuestas de venta parcial
export const PartialSaleProposalTypeEnum = z.enum(["mantener", "vigilar", "venta_parcial", "recogida_beneficios"]);
export const PartialSaleProposalSchema = z.object({
  assetId: z.string(),
  type: PartialSaleProposalTypeEnum,
  percentageSuggested: z.number().min(0.01).max(99.99).nullable(),
  reason: z.string(),
  riskLevel: z.enum(["bajo", "moderado", "alto", "muy_alto"]),
  estimatedProceedsEur: z.number().nullable(),
});
export type PartialSaleProposal = z.infer<typeof PartialSaleProposalSchema>;

// G4 — Propuestas de recompra
export const RebuyProposalSchema = z.object({
  assetId: z.string(),
  triggerDropPercentage: z.number(),
  proposedAmountEur: z.number(),
  reason: z.string(),
  availableLiquidityEur: z.number(),
});
export type RebuyProposal = z.infer<typeof RebuyProposalSchema>;

// G8 — Informe estratégico completo del ciclo
export const CycleStrategyReportSchema = z.object({
  cycleId: z.string(),
  marketPhase: MarketPhaseResultSchema,
  partialSaleProposals: z.array(PartialSaleProposalSchema),
  rebuyProposals: z.array(RebuyProposalSchema),
  riskSummary: z.array(z.string()),
  adaptationSuggestions: z.array(z.string()),
  generatedAt: TimestampSchema,
});
export type CycleStrategyReport = z.infer<typeof CycleStrategyReportSchema>;

// Modelo preparado para uso futuro
export const StrategicRecommendationSchema = z.object({
  id: z.string(),
  cycleId: z.string().nullable(),
  assetId: z.string().nullable(),
  type: z.enum(["mantener", "acumular", "reducir", "salir", "vigilar"]),
  confidence: z.enum(["alta", "media", "baja"]),
  reasoning: z.string(),
  generatedAt: TimestampSchema,
  validUntil: TimestampSchema.nullable(),
});
export type StrategicRecommendation = z.infer<typeof StrategicRecommendationSchema>;

// --- PERSPECTIVAS — MOTOR DE SIMULACIÓN Y PROYECCIÓN ---

export const PerspectivesGoalTypeEnum = z.enum([
  "patrimonio",
  "vivienda",
  "jubilacion",
  "independencia_financiera",
  "capital_objetivo",
  "personalizado",
]);
export type PerspectivesGoalType = z.infer<typeof PerspectivesGoalTypeEnum>;

export const PerspectivesGoalSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: PerspectivesGoalTypeEnum,
  targetAmountEur: z.number(),
  targetDate: TimestampSchema.nullable(),
  priority: z.number().int(),
  notes: z.string().nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type PerspectivesGoal = z.infer<typeof PerspectivesGoalSchema>;

export const CreatePerspectivesGoalSchema = z.object({
  name: z.string().min(1),
  type: PerspectivesGoalTypeEnum,
  targetAmountEur: z.number().positive(),
  targetDate: TimestampSchema.nullable().optional(),
  priority: z.number().int().min(0).optional(),
  notes: z.string().nullable().optional(),
});
export type CreatePerspectivesGoalInput = z.infer<typeof CreatePerspectivesGoalSchema>;

// --- PLAN — COMPRA INTELIGENTE Y REGLAS DE RECOMPRA ---

export const SmartBuyAssetRecommendationSchema = z.object({
  rank: z.number().optional(),
  assetId: z.string(),
  action: z.enum(["comprar", "comprar_parcialmente", "mantener", "esperar", "no_evaluable", "candidato_plan", "objetivo_alcanzado", "pausado", "no_elegible"]).optional(),
  recommendedAmountEur: z.number(),
  recommendedPercentage: z.number().optional(),
  baseAmountEur: z.number(),
  deviationFromBaseEur: z.number(),
  targetAllocationPct: z.number().nullable(),
  currentValueEur: z.number().nullable(),
  currentWeightPct: z.number().nullable().optional(),
  targetValueEur: z.number().nullable(),
  estimatedValueAfterBuyEur: z.number().nullable().optional(),
  estimatedWeightAfterBuyPct: z.number().nullable().optional(),
  targetGapPct: z.number().nullable().optional(),
  isUnderweight: z.boolean(),
  isOpportunity: z.boolean(),
  opportunityReason: z.string().nullable(),
  potentialReason: z.string().nullable().optional(),
  currentPriceEur: z.number().nullable().optional(),
  estimatedQuantity: z.number().nullable().optional(),
  averagePriceEur: z.number().nullable().optional(),
  estimatedAverageCostAfterBuyEur: z.number().nullable().optional(),
  riskLevel: z.enum(["bajo", "medio", "alto", "no_evaluable"]).optional(),
  horizon: z.enum(["1-3y", "3-5y", "5y+"]).nullable().optional(),
  confidenceLevel: z.enum(["alta", "media", "baja", "no_evaluable"]),
  dataQuality: z.enum(["completo", "parcial", "sin_datos"]).optional(),
  sources: z.array(z.string()).optional(),
  updatedAt: TimestampSchema.optional(),
  scoreBreakdown: z.object({
    planAlignment: z.number(),
    priceOpportunity: z.number(),
    longTermPotential: z.number(),
    risk: z.number(),
    liquidity: z.number(),
    dataQuality: z.number(),
    final: z.number(),
  }).optional(),
  reason: z.string(),
  explanation: z.string().optional(),
  restrictionsApplied: z.array(z.string()).optional(),
});
export type SmartBuyAssetRecommendation = z.infer<typeof SmartBuyAssetRecommendationSchema>;

export const SmartBuyRecommendationSchema = z.object({
  cycleId: z.string(),
  analyzedAmountEur: z.number(),
  totalPortfolioValueEur: z.number().nullable(),
  recommendations: z.array(SmartBuyAssetRecommendationSchema),
  hasOpportunities: z.boolean(),
  restrictionsApplied: z.array(z.string()),
  pendingAmountEur: z.number().optional(),
  dataQuality: z.enum(["completo", "parcial", "sin_datos"]),
  mode: z.enum(["plan", "equilibrar", "oportunidad", "mixto", "potencial"]).optional(),
  originType: z.enum(["cash", "eurc"]).optional(),
  generatedAt: TimestampSchema,
});
export type SmartBuyRecommendation = z.infer<typeof SmartBuyRecommendationSchema>;

export const CycleRebuyTierSchema = z.object({
  id: z.string(),
  cycleId: z.string(),
  assetId: z.string().nullable(),
  name: z.string().nullable(),
  drawdownPercentage: z.number(),
  usagePercentage: z.number().min(0.01).max(99.99),
  priority: z.number().int().nullable(),
  status: z.string().nullable(),
  effectiveDate: TimestampSchema.nullable(),
  notes: z.string().nullable(),
  referenceType: z.string().nullable(),
  referenceValue: z.number().nullable(),
  referenceDate: TimestampSchema.nullable(),
  lastTriggeredAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type CycleRebuyTier = z.infer<typeof CycleRebuyTierSchema>;

// --- G-B2 — REGLAS DE VENTA PARCIAL ---

export const PartialSaleConditionTypeEnum = z.enum([
  "price_target",
  "cost_multiple",
  "gain_percentage",
  "market_phase",
  "euphoria",
  "combined",
]);
export type PartialSaleConditionType = z.infer<typeof PartialSaleConditionTypeEnum>;

export const PartialSaleRuleStatusEnum = z.enum([
  "borrador", "activa", "activada", "preparada", "ejecutada", "pausada", "cancelada"
]);
export type PartialSaleRuleStatus = z.infer<typeof PartialSaleRuleStatusEnum>;

export const PartialSaleRuleSchema = z.object({
  id: z.string(),
  planId: z.string().nullable(),
  cycleId: z.string(),
  investmentAssetId: z.string().nullable(),
  assetId: z.string(),
  name: z.string(),
  conditionType: PartialSaleConditionTypeEnum,
  conditionValue: z.number().nullable(),
  conditionValue2: z.number().nullable(),
  sellPercentage: z.number().min(0.01).max(99.99),
  priority: z.number().int(),
  status: PartialSaleRuleStatusEnum,
  effectiveDate: TimestampSchema.nullable(),
  notes: z.string().nullable(),
  lastTriggeredAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type PartialSaleRule = z.infer<typeof PartialSaleRuleSchema>;

export const CreatePartialSaleRuleSchema = z.object({
  planId: z.string().nullable().optional(),
  cycleId: z.string(),
  investmentAssetId: z.string().nullable().optional(),
  assetId: z.string(),
  name: z.string().min(1),
  conditionType: PartialSaleConditionTypeEnum,
  conditionValue: z.number().nullable().optional(),
  conditionValue2: z.number().nullable().optional(),
  sellPercentage: z.number().min(0.01).max(99.99),
  priority: z.number().int().min(0).optional(),
  status: PartialSaleRuleStatusEnum.optional(),
  effectiveDate: TimestampSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type CreatePartialSaleRuleInput = z.infer<typeof CreatePartialSaleRuleSchema>;

export const UpdatePartialSaleRuleSchema = CreatePartialSaleRuleSchema.partial().omit({ cycleId: true, assetId: true });
export type UpdatePartialSaleRuleInput = z.infer<typeof UpdatePartialSaleRuleSchema>;

// G-B2 — EVALUACIÓN DE REGLAS

export const PartialSaleEvaluationSchema = z.object({
  rule: PartialSaleRuleSchema,
  isTriggered: z.boolean(),
  triggeredReason: z.string().nullable(),
  notTriggeredReason: z.string().nullable(),
  preview: z.object({
    quantityToSell: z.number(),
    percentageOfPosition: z.number(),
    referencePrice: z.number(),
    grossProceedsEur: z.number(),
    costBasisProportion: z.number(),
    estimatedGainEur: z.number(),
    estimatedTaxEur: z.number(),
    fiscalReserveEur: z.number(),
    netEurcEur: z.number(),
    remainingBalance: z.number(),
    remainingPercentage: z.number(),
    remainingValueEur: z.number(),
  }).nullable(),
});
export type PartialSaleEvaluation = z.infer<typeof PartialSaleEvaluationSchema>;

// G-B2 — MONITOREO DEL PLAN

export const PlanAssetStatusEnum = z.enum([
  "excelente", "buena", "neutral", "vigilancia", "deterioro", "critica", "candidato_sustitucion"
]);
export type PlanAssetStatus = z.infer<typeof PlanAssetStatusEnum>;

export const PlanAlertTypeEnum = z.enum([
  "aportacion_pendiente",
  "deficit",
  "objetivo_proximo",
  "objetivo_alcanzado",
  "activo_infraponderado",
  "activo_sobreponderado",
  "venta_parcial_activada",
  "compra_caida_activada",
  "sustitucion_pendiente",
  "etapa_proxima_fin",
  "activo_vigilancia",
  "recomendacion_compra_inteligente",
]);
export type PlanAlertType = z.infer<typeof PlanAlertTypeEnum>;

export const PlanAlertPriorityEnum = z.enum(["informativa", "baja", "media", "alta", "critica"]);
export type PlanAlertPriority = z.infer<typeof PlanAlertPriorityEnum>;

export const PlanAlertSchema = z.object({
  id: z.string(),
  type: PlanAlertTypeEnum,
  priority: PlanAlertPriorityEnum,
  assetId: z.string().nullable(),
  cycleId: z.string(),
  title: z.string(),
  message: z.string(),
  dataUsed: z.record(z.unknown()),
  actionAvailable: z.string().nullable(),
  generatedAt: TimestampSchema,
});
export type PlanAlert = z.infer<typeof PlanAlertSchema>;

export const AssetPlanStatusSchema = z.object({
  assetId: z.string(),
  cycleId: z.string(),
  investmentAssetId: z.string().nullable(),
  targetAllocationPct: z.number().nullable(),
  currentValueEur: z.number().nullable(),
  targetValueEur: z.number().nullable(),
  deviationEur: z.number().nullable(),
  deviationPct: z.number().nullable(),
  isUnderweight: z.boolean().nullable(),
  goalProgress: z.number().nullable(),
  healthStatus: PlanAssetStatusEnum,
  healthReason: z.string(),
  activeRules: z.number().int(),
  triggeredRules: z.number().int(),
  lastReviewDate: TimestampSchema.nullable(),
  nextAction: z.string().nullable(),
});
export type AssetPlanStatus = z.infer<typeof AssetPlanStatusSchema>;

export const PlanMonitoringSummarySchema = z.object({
  cycleId: z.string(),
  planId: z.string().nullable(),
  activeAssets: z.number().int(),
  goalsReached: z.number().int(),
  goalsNearby: z.number().int(),
  triggeredSaleRules: z.number().int(),
  triggeredRebuyRules: z.number().int(),
  pendingSubstitutions: z.number().int(),
  compliancePercentage: z.number().nullable(),
  deficitEur: z.number(),
  eurcAvailable: z.number(),
  fiscalReserve: z.number(),
  alerts: z.array(PlanAlertSchema),
  assetStatuses: z.array(AssetPlanStatusSchema),
  generatedAt: TimestampSchema,
});
export type PlanMonitoringSummary = z.infer<typeof PlanMonitoringSummarySchema>;

// G-B2 — MODO COMPRA INTELIGENTE

export const SmartBuyModeEnum = z.enum(["plan", "equilibrar", "oportunidad", "mixto", "potencial"]);
export type SmartBuyMode = z.infer<typeof SmartBuyModeEnum>;
