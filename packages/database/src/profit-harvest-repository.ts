import { asc, desc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { ProfitHarvestCycle } from "@crypto-control/portfolio";
import * as schema from "./schema";

type ProfitHarvestCycleRow = typeof schema.profitHarvestCycles.$inferSelect;

export interface ProfitHarvestCycleFilters {
  assetId?: string;
  cycleId?: string;
  status?: ProfitHarvestCycle["status"];
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapRow(row: ProfitHarvestCycleRow): ProfitHarvestCycle {
  return {
    id: row.id,
    assetId: row.assetId,
    cycleId: row.cycleId,
    planId: row.planId,
    openedAt: row.openedAt,
    closedAt: row.closedAt,
    status: row.status as ProfitHarvestCycle["status"],
    strategyMode: row.strategyMode as ProfitHarvestCycle["strategyMode"],
    strategySource: row.strategySource as ProfitHarvestCycle["strategySource"],
    simulationOnly: row.simulationOnly === 1,
    requiresUserConfirmation: row.requiresUserConfirmation === 1,
    lotsAffected: parseJson<string[]>(row.lotsAffectedJson, []),
    unitsSold: row.unitsSold,
    sellPriceEur: row.sellPriceEur,
    grossSaleEur: row.grossSaleEur,
    acquisitionCostEur: row.acquisitionCostEur,
    realizedGainEur: row.realizedGainEur,
    taxEur: row.taxEur,
    costsEur: row.costsEur,
    eurcFiscalReserveEur: row.eurcFiscalReserveEur,
    eurcOperationalEur: row.eurcOperationalEur,
    reason: row.reason,
    positiveSignals: parseJson<ProfitHarvestCycle["positiveSignals"]>(row.positiveSignalsJson, []),
    negativeSignals: parseJson<ProfitHarvestCycle["negativeSignals"]>(row.negativeSignalsJson, []),
    breakEvenRebuyPriceEur: row.breakEvenRebuyPriceEur,
    minimumDropPct: row.minimumDropPct,
    targetZone: parseJson<ProfitHarvestCycle["targetZone"]>(row.targetZoneJson, {
      minPriceEur: 0,
      maxPriceEur: 0,
      minDropPct: 0,
      maxDropPct: 0,
    }),
    rebuys: parseJson<ProfitHarvestCycle["rebuys"]>(row.rebuysJson, []),
    unitsRebought: row.unitsRebought,
    additionalUnits: row.additionalUnits,
    resultVsHoldEur: row.resultVsHoldEur,
    expiresAt: row.expiresAt,
  };
}

function valuesForCycle(cycle: ProfitHarvestCycle, now: number) {
  return {
    id: cycle.id,
    assetId: cycle.assetId,
    cycleId: cycle.cycleId,
    planId: cycle.planId,
    openedAt: cycle.openedAt,
    closedAt: cycle.closedAt,
    status: cycle.status,
    strategyMode: cycle.strategyMode,
    strategySource: cycle.strategySource,
    simulationOnly: cycle.simulationOnly ? 1 : 0,
    requiresUserConfirmation: cycle.requiresUserConfirmation ? 1 : 0,
    lotsAffectedJson: JSON.stringify(cycle.lotsAffected),
    unitsSold: cycle.unitsSold,
    sellPriceEur: cycle.sellPriceEur,
    grossSaleEur: cycle.grossSaleEur,
    acquisitionCostEur: cycle.acquisitionCostEur,
    realizedGainEur: cycle.realizedGainEur,
    taxEur: cycle.taxEur,
    costsEur: cycle.costsEur,
    eurcFiscalReserveEur: cycle.eurcFiscalReserveEur,
    eurcOperationalEur: cycle.eurcOperationalEur,
    reason: cycle.reason,
    positiveSignalsJson: JSON.stringify(cycle.positiveSignals),
    negativeSignalsJson: JSON.stringify(cycle.negativeSignals),
    breakEvenRebuyPriceEur: cycle.breakEvenRebuyPriceEur,
    minimumDropPct: cycle.minimumDropPct,
    targetZoneJson: JSON.stringify(cycle.targetZone),
    rebuysJson: JSON.stringify(cycle.rebuys),
    unitsRebought: cycle.unitsRebought,
    additionalUnits: cycle.additionalUnits,
    resultVsHoldEur: cycle.resultVsHoldEur,
    expiresAt: cycle.expiresAt,
    createdAt: now,
    updatedAt: now,
  };
}

export class DatabaseProfitHarvestRepository {
  constructor(private readonly db: BetterSQLite3Database<typeof schema>) {}

  upsert(cycle: ProfitHarvestCycle): ProfitHarvestCycle {
    const now = Date.now();
    const values = valuesForCycle(cycle, now);
    const { createdAt: _createdAt, ...updateValues } = values;
    this.db.insert(schema.profitHarvestCycles)
      .values(values)
      .onConflictDoUpdate({
        target: schema.profitHarvestCycles.id,
        set: {
          ...updateValues,
          updatedAt: now,
        },
      })
      .run();

    return this.getById(cycle.id) ?? cycle;
  }

  getById(id: string): ProfitHarvestCycle | null {
    const row = this.db.select().from(schema.profitHarvestCycles)
      .where(eq(schema.profitHarvestCycles.id, id))
      .get();
    return row ? mapRow(row) : null;
  }

  list(filters: ProfitHarvestCycleFilters = {}): ProfitHarvestCycle[] {
    let rows = this.db.select().from(schema.profitHarvestCycles)
      .orderBy(desc(schema.profitHarvestCycles.openedAt), asc(schema.profitHarvestCycles.assetId))
      .all();
    if (filters.assetId) rows = rows.filter((row) => row.assetId === filters.assetId);
    if (filters.cycleId) rows = rows.filter((row) => row.cycleId === filters.cycleId);
    if (filters.status) rows = rows.filter((row) => row.status === filters.status);
    return rows.map(mapRow);
  }
}
