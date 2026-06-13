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
  legs: z.array(TransactionLegInputSchema)
});

export const TransactionInputListSchema = z.array(TransactionInputSchema);

export type CreateTransactionInput = z.infer<typeof CreateTransactionSchema>;
export type TransactionType = z.infer<typeof TransactionTypeEnum>;
export type Asset = z.infer<typeof AssetSchema>;
export type Account = z.infer<typeof AccountSchema>;
export type TransactionLegInput = z.infer<typeof TransactionLegInputSchema>;
export type TransactionInput = z.infer<typeof TransactionInputSchema>;
