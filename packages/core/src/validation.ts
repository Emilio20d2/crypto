import { z } from "zod";

export const AssetSchema = z.object({
  id: z.string().uuid(),
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
  assetId: z.string().uuid(),
  accountId: z.string().uuid().optional(),
  amount: z.number(), // Positivo = entrada, Negativo = salida
  legType: z.enum(["source", "destination", "fee"]),
  valuationEur: z.number().optional()
});

export const FeeSchema = z.object({
  assetId: z.string().uuid(),
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

export type CreateTransactionInput = z.infer<typeof CreateTransactionSchema>;
export type TransactionType = z.infer<typeof TransactionTypeEnum>;
export type Asset = z.infer<typeof AssetSchema>;
export type Account = z.infer<typeof AccountSchema>;
