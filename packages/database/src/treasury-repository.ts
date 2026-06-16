import { asc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import crypto from "crypto";
import * as schema from "./schema";

export type TreasuryAccountType = "cash" | "eurc" | "fiscal_reserve";
export type TreasuryMovementType =
  | "efectivo_entrada"
  | "efectivo_salida"
  | "eurc_entrada"
  | "eurc_salida"
  | "reserva_fiscal"
  | "liberar_reserva"
  | "asignar_recompra"
  | "usar_recompra";

export type CycleLiquidityStatus = "reserved" | "used" | "released";

export interface TreasuryMovementInput {
  date: number;
  type: TreasuryMovementType;
  sourceAccountType?: TreasuryAccountType | null;
  destinationAccountType?: TreasuryAccountType | null;
  amount: number;
  currency?: string;
  reason: string;
  referenceType?: string | null;
  referenceId?: string | null;
  notes?: string | null;
}

export type CycleLiquiditySourceType = "eurc" | "cash";

export interface CycleLiquidityAllocationInput {
  cycleId?: string | null;
  amountEur: number;
  reason: string;
  targetAssetId?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  notes?: string | null;
}

export interface TreasurySummary {
  cashBalance: number;
  eurcBalance: number;
  fiscalReserveBalance: number;
  totalLiquidity: number;
  freeRebuyLiquidity: number;
  allocatedToRebuy: number;
  freeCashForRebuy: number;
  allocatedCashToRebuy: number;
  recommendedFiscalReserve: number;
  pendingEstimatedTaxes: number;
  updatedAt: number;
}

type TreasuryMovementRow = typeof schema.treasuryMovements.$inferSelect;

function finiteAmount(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} debe ser un importe positivo.`);
  }
  return value;
}

function normalizeMovement(input: TreasuryMovementInput) {
  const amount = finiteAmount(input.amount, "El movimiento");
  const currency = (input.currency ?? "EUR").toUpperCase();

  switch (input.type) {
    case "efectivo_entrada":
      return { sourceAccountType: null, destinationAccountType: "cash" as const, amount, currency };
    case "efectivo_salida":
      return { sourceAccountType: "cash" as const, destinationAccountType: null, amount, currency };
    case "eurc_entrada":
      return { sourceAccountType: null, destinationAccountType: "eurc" as const, amount, currency: currency === "EUR" ? "EURC" : currency };
    case "eurc_salida":
      return { sourceAccountType: "eurc" as const, destinationAccountType: null, amount, currency: currency === "EUR" ? "EURC" : currency };
    case "reserva_fiscal":
      return {
        sourceAccountType: input.sourceAccountType ?? "eurc",
        destinationAccountType: "fiscal_reserve" as const,
        amount,
        currency,
      };
    case "liberar_reserva":
      return {
        sourceAccountType: "fiscal_reserve" as const,
        destinationAccountType: input.destinationAccountType ?? "eurc",
        amount,
        currency,
      };
    case "asignar_recompra":
      return { sourceAccountType: "eurc" as const, destinationAccountType: null, amount, currency: "EURC" };
    case "usar_recompra":
      return { sourceAccountType: "eurc" as const, destinationAccountType: null, amount, currency: "EURC" };
    default:
      throw new Error("Tipo de movimiento de tesorería no soportado.");
  }
}

function movementDelta(row: TreasuryMovementRow) {
  const amount = row.amount;
  switch (row.type as TreasuryMovementType) {
    case "efectivo_entrada":
      return { cash: amount, eurc: 0, fiscal: 0 };
    case "efectivo_salida":
      return { cash: -amount, eurc: 0, fiscal: 0 };
    case "eurc_entrada":
      return { cash: 0, eurc: amount, fiscal: 0 };
    case "eurc_salida":
      return { cash: 0, eurc: -amount, fiscal: 0 };
    case "reserva_fiscal":
      return {
        cash: row.sourceAccountType === "cash" ? -amount : 0,
        eurc: row.sourceAccountType === "eurc" || row.sourceAccountType === null ? -amount : 0,
        fiscal: amount,
      };
    case "liberar_reserva":
      return {
        cash: row.destinationAccountType === "cash" ? amount : 0,
        eurc: row.destinationAccountType === "eurc" || row.destinationAccountType === null ? amount : 0,
        fiscal: -amount,
      };
    case "usar_recompra":
      return { cash: 0, eurc: -amount, fiscal: 0 };
    case "asignar_recompra":
    default:
      return { cash: 0, eurc: 0, fiscal: 0 };
  }
}

export class DatabaseTreasuryRepository {
  constructor(private readonly db: BetterSQLite3Database<typeof schema>) {}

  ensureDefaultAccounts() {
    const now = Date.now();
    const defaults: Array<{ type: TreasuryAccountType; name: string; currency: string }> = [
      { type: "cash", name: "Efectivo", currency: "EUR" },
      { type: "eurc", name: "EuroCrypto / EURC", currency: "EURC" },
      { type: "fiscal_reserve", name: "Reserva fiscal", currency: "EUR" },
    ];

    for (const account of defaults) {
      this.db.insert(schema.treasuryAccounts).values({
        id: crypto.randomUUID(),
        type: account.type,
        name: account.name,
        currency: account.currency,
        isActive: 1,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing().run();
    }
  }

  listMovements() {
    this.ensureDefaultAccounts();
    return this.db.select()
      .from(schema.treasuryMovements)
      .orderBy(asc(schema.treasuryMovements.date), asc(schema.treasuryMovements.createdAt))
      .all();
  }

  getSummary(recommendedFiscalReserve = 0, observedEurcBalance = 0): TreasurySummary {
    this.ensureDefaultAccounts();
    const movements = this.db.select().from(schema.treasuryMovements).all();
    const totals = movements.reduce(
      (acc, row) => {
        const delta = movementDelta(row);
        acc.cash += delta.cash;
        acc.eurc += delta.eurc;
        acc.fiscal += delta.fiscal;
        return acc;
      },
      { cash: 0, eurc: 0, fiscal: 0 }
    );

    const allocations = this.db.select()
      .from(schema.cycleLiquidityAllocations)
      .where(eq(schema.cycleLiquidityAllocations.status, "reserved"))
      .all();
    const allocatedToRebuy = allocations
      .filter((row) => row.sourceType === "eurc")
      .reduce((sum, row) => sum + row.amountEur, 0);
    const allocatedCashToRebuy = allocations
      .filter((row) => row.sourceType === "cash")
      .reduce((sum, row) => sum + row.amountEur, 0);
    const fiscalReserveBalance = Math.max(0, totals.fiscal);
    const observedEurcAvailable = Math.max(0, observedEurcBalance - fiscalReserveBalance);
    const eurcBalance = Math.max(0, totals.eurc, observedEurcAvailable);
    const cashBalance = Math.max(0, totals.cash);
    const freeRebuyLiquidity = Math.max(0, eurcBalance - allocatedToRebuy);
    const freeCashForRebuy = Math.max(0, cashBalance - allocatedCashToRebuy);
    const recommended = Math.max(0, recommendedFiscalReserve);

    return {
      cashBalance,
      eurcBalance,
      fiscalReserveBalance,
      totalLiquidity: cashBalance + eurcBalance + fiscalReserveBalance,
      freeRebuyLiquidity,
      allocatedToRebuy,
      freeCashForRebuy,
      allocatedCashToRebuy,
      recommendedFiscalReserve: recommended,
      pendingEstimatedTaxes: Math.max(0, recommended - fiscalReserveBalance),
      updatedAt: Date.now(),
    };
  }

  createMovement(input: TreasuryMovementInput) {
    this.ensureDefaultAccounts();
    const normalized = normalizeMovement(input);
    const now = Date.now();
    const id = crypto.randomUUID();

    this.db.transaction((tx) => {
      tx.insert(schema.treasuryMovements).values({
        id,
        date: input.date,
        type: input.type,
        sourceAccountType: normalized.sourceAccountType,
        destinationAccountType: normalized.destinationAccountType,
        amount: normalized.amount,
        currency: normalized.currency,
        reason: input.reason,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        notes: input.notes ?? null,
        createdAt: now,
        updatedAt: now,
      }).run();

      if (input.type === "reserva_fiscal" || input.type === "liberar_reserva") {
        tx.insert(schema.fiscalReserveMovements).values({
          id: crypto.randomUUID(),
          treasuryMovementId: id,
          realizedGainId: input.referenceType === "realized_gain" ? input.referenceId ?? null : null,
          date: input.date,
          amountEur: input.type === "reserva_fiscal" ? normalized.amount : -normalized.amount,
          reason: input.reason,
          notes: input.notes ?? null,
          createdAt: now,
        }).run();
      }
    });

    return { id };
  }

  updateMovement(id: string, input: TreasuryMovementInput) {
    const existing = this.db.select().from(schema.treasuryMovements).where(eq(schema.treasuryMovements.id, id)).get();
    if (!existing) throw new Error(`Movimiento de tesorería ${id} no encontrado.`);
    const normalized = normalizeMovement(input);
    const now = Date.now();

    this.db.update(schema.treasuryMovements).set({
      date: input.date,
      type: input.type,
      sourceAccountType: normalized.sourceAccountType,
      destinationAccountType: normalized.destinationAccountType,
      amount: normalized.amount,
      currency: normalized.currency,
      reason: input.reason,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      notes: input.notes ?? null,
      updatedAt: now,
    }).where(eq(schema.treasuryMovements.id, id)).run();

    return this.db.select().from(schema.treasuryMovements).where(eq(schema.treasuryMovements.id, id)).get();
  }

  deleteMovement(id: string) {
    this.db.delete(schema.treasuryMovements).where(eq(schema.treasuryMovements.id, id)).run();
  }

  setFiscalReserve(targetAmountEur: number, notes?: string | null) {
    if (!Number.isFinite(targetAmountEur) || targetAmountEur < 0) {
      throw new Error("La reserva fiscal debe ser un importe igual o superior a 0.");
    }
    const current = this.getSummary(0).fiscalReserveBalance;
    const delta = targetAmountEur - current;
    if (Math.abs(delta) < 0.005) return null;

    return this.createMovement({
      date: Date.now(),
      type: delta > 0 ? "reserva_fiscal" : "liberar_reserva",
      amount: Math.abs(delta),
      currency: "EUR",
      reason: delta > 0 ? "Ajuste de reserva fiscal" : "Liberación de reserva fiscal",
      notes: notes ?? null,
    });
  }

  private reserveLiquidityForRebuy(
    input: CycleLiquidityAllocationInput,
    sourceType: CycleLiquiditySourceType,
    freeLiquidity: number,
    insufficientMessage: string
  ) {
    this.ensureDefaultAccounts();
    const amount = finiteAmount(input.amountEur, "La asignación para recompra");
    if (amount > freeLiquidity) {
      throw new Error(insufficientMessage);
    }

    const now = Date.now();
    const id = crypto.randomUUID();
    this.db.transaction((tx) => {
      tx.insert(schema.cycleLiquidityAllocations).values({
        id,
        cycleId: input.cycleId ?? null,
        amountEur: amount,
        sourceType,
        targetAssetId: input.targetAssetId ?? null,
        status: "reserved",
        reason: input.reason,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        notes: input.notes ?? null,
        createdAt: now,
        updatedAt: now,
        usedAt: null,
      }).run();

      tx.insert(schema.treasuryMovements).values({
        id: crypto.randomUUID(),
        date: now,
        type: "asignar_recompra",
        sourceAccountType: sourceType,
        destinationAccountType: null,
        amount,
        currency: sourceType === "eurc" ? "EURC" : "EUR",
        reason: input.reason,
        referenceType: "cycle_liquidity_allocation",
        referenceId: id,
        notes: input.notes ?? null,
        createdAt: now,
        updatedAt: now,
      }).run();
    });

    return { id };
  }

  allocateEurcToRebuy(input: CycleLiquidityAllocationInput, observedEurcBalance = 0) {
    const summary = this.getSummary(0, observedEurcBalance);
    return this.reserveLiquidityForRebuy(input, "eurc", summary.freeRebuyLiquidity, "No hay EURC libre suficiente para asignar esta recompra.");
  }

  allocateCashToRebuy(input: CycleLiquidityAllocationInput) {
    const summary = this.getSummary(0, 0);
    return this.reserveLiquidityForRebuy(input, "cash", summary.freeCashForRebuy, "No hay efectivo libre suficiente para asignar esta recompra.");
  }

  listCycleLiquidity(filter: { cycleId?: string; status?: CycleLiquidityStatus } = {}) {
    this.ensureDefaultAccounts();
    const rows = this.db.select().from(schema.cycleLiquidityAllocations).all();
    return rows.filter((row) =>
      (filter.cycleId === undefined || row.cycleId === filter.cycleId) &&
      (filter.status === undefined || row.status === filter.status)
    );
  }

  listFiscalReserveMovements(filter: { realizedGainIds?: string[] } = {}) {
    const rows = this.db.select().from(schema.fiscalReserveMovements)
      .orderBy(asc(schema.fiscalReserveMovements.date))
      .all();
    if (!filter.realizedGainIds) return rows;
    const allowed = new Set(filter.realizedGainIds);
    return rows.filter((row) => row.realizedGainId !== null && allowed.has(row.realizedGainId));
  }
}
