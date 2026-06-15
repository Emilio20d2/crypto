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
  notes: OptionalTextSchema
});

export const InvestmentAssetAllocationTypeSchema = z.enum(["percentage", "amount"]);
export const InvestmentAssetStatusSchema = z.enum(["active", "paused", "closed"]);

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
  referenceType: z.string().trim().nullable().optional(),
  referenceId: z.string().trim().nullable().optional(),
  notes: OptionalTextSchema
});

export const CycleLiquidityAllocationSchema = z.object({
  id: z.string().min(1),
  cycleId: z.string().nullable(),
  amountEur: z.number().positive(),
  status: CycleLiquidityStatusSchema,
  reason: z.string().min(1),
  referenceType: z.string().nullable().optional(),
  referenceId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  usedAt: TimestampSchema.nullable()
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
export type CycleLiquidityAllocation = z.infer<typeof CycleLiquidityAllocationSchema>;
