import { app, BrowserWindow, ipcMain, dialog } from "electron";
import * as path from "path";
import { initializeDatabase, runMigrations, ensureEssentialTables, getDb, schema } from "@crypto-control/database";
import {
  CreateInvestmentAssetSchema,
  CreateInvestmentCycleSchema,
  CreateInvestmentPlanSchema,
  CreateStrategyRevisionSchema,
  CreateTreasuryMovementSchema,
  CreateTransactionSchema,
  AllocateEurcToRebuySchema,
  AllocateCashToRebuySchema,
  CycleLiquidityAllocationSchema,
  FiscalReserveMovementSchema,
  CycleMetricsSchema,
  CreatePartialSaleSchema,
  PartialSaleSchema,
  CryptoControlIndexSchema,
  AssetHealthResultSchema,
  CurrentPriceResultSchema,
  FearGreedResultSchema,
  GlobalMetricsResultSchema,
  HistoricalPriceResultSchema,
  InvestmentAssetStateChangeSchema,
  MarketOverviewResultSchema,
  MarketSentimentHistoryRequestSchema,
  MarketSentimentSchema,
  MarketSentimentTimeframeSchema,
  SetFiscalReserveSchema,
  TransactionInputListSchema,
  TreasuryMovementSchema,
  TreasurySummarySchema,
  UpdateInvestmentAssetSchema,
  UpdateInvestmentCycleSchema,
  UpdateInvestmentPlanSchema,
  UpdateTreasuryMovementSchema,
  CreateContributionScheduleSchema,
  UpdateContributionScheduleSchema,
  CreateAssetSubstitutionSchema,
  UpdateAssetSubstitutionSchema,
  ContributionMonthlySummarySchema,
  CycleContributionAggregatesSchema,
  StrategicAlertSchema,
} from "@crypto-control/core";
import crypto from "crypto";
import { eq, and, or, asc, desc, isNull, inArray } from "drizzle-orm";
import * as fs from "fs";
import * as http from "http";

if (app.isPackaged) {
  process.env["KEYCHAIN_HELPER_PATH"] = path.join(
    process.resourcesPath, "bin", "keychain-helper"
  );
}

let mainWindow: BrowserWindow | null = null;

function sanitizePoints(points: { timestamp: number; price: number; source?: string; confidence?: number }[]): { time: number; timestamp: number; value: number; source?: string; confidence?: number }[] {
  const mapped = points
    .map(p => ({
      time: Math.floor(p.timestamp / 1000),
      timestamp: p.timestamp,
      value: p.price,
      source: p.source,
      confidence: p.confidence
    }))
    .filter(p => p.time > 0 && typeof p.value === "number" && Number.isFinite(p.value) && p.value > 0);

  mapped.sort((a, b) => a.time - b.time);

  const unique: { time: number; timestamp: number; value: number; source?: string; confidence?: number }[] = [];
  for (const p of mapped) {
    if (unique.length === 0 || unique[unique.length - 1].time !== p.time) {
      unique.push(p);
    } else {
      unique[unique.length - 1].value = p.value;
      unique[unique.length - 1].timestamp = p.timestamp;
      unique[unique.length - 1].source = p.source;
      unique[unique.length - 1].confidence = p.confidence;
    }
  }

  return unique;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          console.warn(`[Timeout] ${label} superó ${timeoutMs}ms`);
          resolve(null);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function pointChange(points: { time: number; value: number }[]): number | null {
  if (points.length < 2) return null;
  const first = points[0].value;
  const last = points[points.length - 1].value;
  if (!Number.isFinite(first) || !Number.isFinite(last) || first <= 0) return null;
  return ((last - first) / first) * 100;
}

function seedDatabase() {
  const db = getDb();
  let existing = db.select().from(schema.assets).all();

  // Catálogo canónico de activos — sincronizado con ASSET_MAP de market-data.
  // Añadir aquí cualquier activo nuevo que ya tenga fuente de precio configurada.
  const defaultAssets = [
    { id: "BTC",  symbol: "BTC",  name: "Bitcoin",       type: "crypto", logoUrl: "https://assets.coingecko.com/coins/images/1/small/bitcoin.png" },
    { id: "ETH",  symbol: "ETH",  name: "Ethereum",      type: "crypto", logoUrl: "https://assets.coingecko.com/coins/images/279/small/ethereum.png" },
    { id: "SOL",  symbol: "SOL",  name: "Solana",        type: "crypto", logoUrl: "https://assets.coingecko.com/coins/images/4128/small/solana.png" },
    { id: "ADA",  symbol: "ADA",  name: "Cardano",       type: "crypto", logoUrl: "https://assets.coingecko.com/coins/images/975/small/cardano.png" },
    { id: "SUI",  symbol: "SUI",  name: "Sui",           type: "crypto", logoUrl: "https://assets.coingecko.com/coins/images/26375/small/sui_asset.jpeg" },
    { id: "SEI",  symbol: "SEI",  name: "Sei",           type: "crypto", logoUrl: "https://assets.coingecko.com/coins/images/28205/small/Sei_Logo_-_Transparent.png" },
    { id: "TON",  symbol: "TON",  name: "Toncoin",       type: "crypto", logoUrl: "https://assets.coingecko.com/coins/images/17980/small/ton_symbol.png" },
    { id: "XLM",  symbol: "XLM",  name: "Stellar",       type: "crypto", logoUrl: "https://assets.coingecko.com/coins/images/100/small/Stellar_symbol_black_RGB.png" },
    { id: "USDC", symbol: "USDC", name: "USD Coin",      type: "crypto", logoUrl: "https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png" },
    { id: "EURC", symbol: "EURC", name: "Euro Coin",     type: "crypto", logoUrl: "https://assets.coingecko.com/coins/images/26045/small/euro-coin.png" },
    { id: "LMTS", symbol: "LMTS", name: "Limitless",     type: "crypto", logoUrl: null },
  ];

  console.log(`[DB] Se encontraron ${existing.length} activos. Ejecutando siembra de activos ausentes...`);

  const now = Date.now();
  for (const asset of defaultAssets) {
    const found = existing.some(a => a.id === asset.id);
    if (!found) {
      db.insert(schema.assets).values({
        id: asset.id, symbol: asset.symbol, name: asset.name,
        type: asset.type, logoUrl: asset.logoUrl, createdAt: now, updatedAt: now
      }).run();
    } else {
      const existingAsset = existing.find(a => a.id === asset.id);
      if (!existingAsset?.logoUrl && asset.logoUrl) {
        db.update(schema.assets)
          .set({ logoUrl: asset.logoUrl, updatedAt: now })
          .where(eq(schema.assets.id, asset.id))
          .run();
      }
    }
  }

  existing = db.select().from(schema.assets).all();
  console.log(`[DB] Consulta post-siembra: ${existing.length} activos en base de datos.`);

  const requiredSymbols = ["BTC", "ETH", "ADA", "SUI", "SEI", "EURC"];
  const missingSymbols = requiredSymbols.filter(sym => !existing.some(a => a.symbol === sym));
  if (missingSymbols.length > 0) {
    throw new Error(`La siembra de activos no se completó. Faltan los símbolos: ${missingSymbols.join(", ")}`);
  }
}

function setupDatabase() {
  const userDataPath = app.getPath("userData");
  const dbPath = path.join(userDataPath, "crypto-control.sqlite");
  
  // Imprimir ruta para el informe
  console.log("[DB] Ruta SQLite:", dbPath);
  
  initializeDatabase(dbPath);

  try {
    // La carpeta de migraciones en empaquetado estará junto al asar o en app.getAppPath()
    const migrationsPath = app.isPackaged 
      ? path.join(process.resourcesPath, "migrations") 
      : path.join(__dirname, "../../../packages/database/drizzle");
    
    // Fallback if the path exists, else we skip (e.g. during test without migrations copied)
    if (fs.existsSync(migrationsPath)) {
      runMigrations(migrationsPath);
      console.log("[DB] Migraciones aplicadas");
      seedDatabase();
    } else {
      console.warn("[DB] No se encontró carpeta de migraciones en", migrationsPath);
    }
  } catch (e: unknown) {
    console.error("[DB] Fallo en migración:", e instanceof Error ? e.message : String(e));
  }

  // Ensure plan/cycle tables exist even if the migration above failed on a legacy DB.
  // Uses CREATE TABLE IF NOT EXISTS — safe to run multiple times.
  try {
    ensureEssentialTables();
    console.log("[DB] Tablas esenciales verificadas");
  } catch (e: unknown) {
    console.error("[DB] Error al verificar tablas esenciales:", e instanceof Error ? e.message : String(e));
  }
}

function setupIpcHandlers() {
  const { MarketService, MarketSentimentService, FearGreedService, GlobalMetricsService, getAssetMetadata } = require("@crypto-control/market-data") as typeof import("@crypto-control/market-data");
  const { DatabasePortfolioRepository, DatabaseMarketCacheRepository, DatabaseMarketSentimentRepository, DatabaseTreasuryRepository } = require("@crypto-control/database") as typeof import("@crypto-control/database");

  const db = getDb();
  const marketCache = new DatabaseMarketCacheRepository(db);
  const marketService = new MarketService(marketCache);
  const sentimentRepository = new DatabaseMarketSentimentRepository(db);
  const sentimentService = new MarketSentimentService(marketService, sentimentRepository);
  const fearGreedLogger = app.isPackaged
    ? undefined
    : {
        debug: (...args: unknown[]) => console.log("[Fear & Greed]", ...args),
        warn: (...args: unknown[]) => console.warn("[Fear & Greed]", ...args),
      };
  const fearGreedService = new FearGreedService({
    ttlMs: 30 * 60 * 1000,
    timeoutMs: 6000,
    fetchImpl: fetch,
    logger: fearGreedLogger,
  });
  const globalMetricsLogger = app.isPackaged
    ? undefined
    : {
        debug: (...args: unknown[]) => console.log("[Global Metrics]", ...args),
        warn: (...args: unknown[]) => console.warn("[Global Metrics]", ...args),
      };
  const globalMetricsService = new GlobalMetricsService({
    ttlMs: 60 * 60 * 1000,
    timeoutMs: 8000,
    fetchImpl: fetch,
    logger: globalMetricsLogger,
  });

  // --- Permission settings helpers (no live API calls) ---
  function savePermissions(perms: { canView: boolean; canTrade: boolean; canTransfer: boolean }): void {
    const upsert = (key: string, val: string) =>
      db.insert(schema.settings).values({ key, value: val })
        .onConflictDoUpdate({ target: schema.settings.key, set: { value: val } })
        .run();
    upsert("coinbase:perm-can-view", String(perms.canView));
    upsert("coinbase:perm-can-trade", String(perms.canTrade));
    upsert("coinbase:perm-can-transfer", String(perms.canTransfer));
    upsert("coinbase:perm-validated-at", String(Date.now()));
  }

  function readPermissions(): { permissions: { canView: boolean; canTrade: boolean; canTransfer: boolean } | null; lastValidationAt: number | null } {
    const get = (key: string) => db.select().from(schema.settings).where(eq(schema.settings.key, key)).get()?.value ?? null;
    const canView = get("coinbase:perm-can-view");
    if (canView === null) return { permissions: null, lastValidationAt: null };
    const validatedAt = get("coinbase:perm-validated-at");
    return {
      permissions: {
        canView: canView === "true",
        canTrade: get("coinbase:perm-can-trade") === "true",
        canTransfer: get("coinbase:perm-can-transfer") === "true",
      },
      lastValidationAt: validatedAt ? parseInt(validatedAt, 10) : null,
    };
  }

  function clearPermissions(): void {
    for (const key of ["coinbase:perm-can-view", "coinbase:perm-can-trade", "coinbase:perm-can-transfer", "coinbase:perm-validated-at"]) {
      db.delete(schema.settings).where(eq(schema.settings.key, key)).run();
    }
  }

  function readSyncStatus(): {
    lastSyncAt: number | null;
    lastSyncItemsProcessed: number | null;
    lastSyncStatus: "success" | "error" | null;
    lastSyncError: string | null;
  } {
    const get = (key: string) => db.select().from(schema.settings).where(eq(schema.settings.key, key)).get()?.value ?? null;
    const at = get("coinbase:last-sync-at");
    const count = get("coinbase:last-sync-count");
    const statusRaw = get("coinbase:last-sync-status");
    const error = get("coinbase:last-sync-error");
    return {
      lastSyncAt: at ? parseInt(at, 10) : null,
      lastSyncItemsProcessed: count ? parseInt(count, 10) : null,
      lastSyncStatus: (statusRaw === "success" || statusRaw === "error") ? statusRaw : null,
      lastSyncError: error || null,
    };
  }

  const getPortfolioService = () => {
    const { PortfolioService, PortfolioCalculator, FifoCalculator } = require("@crypto-control/portfolio") as typeof import("@crypto-control/portfolio");
    const repo = new DatabasePortfolioRepository(db);
    const calc = new PortfolioCalculator();
    const fifoCalc = new FifoCalculator();
    return new PortfolioService(repo, calc, fifoCalc, marketService);
  };

  // HTTP dispatch map: captures all ipcMain.handle registrations so the same
  // handlers can be called over HTTP (used by browser clients via Tailscale).
  const httpDispatch = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const _origHandle = ipcMain.handle.bind(ipcMain);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ipcMain as any).handle = (channel: string, listener: (event: any, ...args: unknown[]) => unknown) => {
    httpDispatch.set(channel, (...args: unknown[]) => Promise.resolve(listener(null, ...args)));
    return _origHandle(channel as any, listener as any);
  };

  // Helper to wrap IPC handlers with Result<T> — error shape matches core Result type
  const withResult = <T extends unknown[], R>(fn: (...args: T) => Promise<R>) => async (...args: T) => {
    try {
      const data = await fn(...args);
      return { ok: true as const, data };
    } catch (e: unknown) {
      const err = e as { message?: string; code?: string; httpStatus?: number; correlationId?: string };
      // Log only sanitized info — never the credential or JWT
      console.error("[IPC]", err.code ?? "UNKNOWN", err.httpStatus ?? "", err.correlationId ?? "");
      return {
        ok: false as const,
        error: {
          code:           err.code    || "UNKNOWN",
          message:        err.message || "Error desconocido.",
          recoverable:    false,
          httpStatus:     err.httpStatus,
          correlationId:  err.correlationId,
        },
      };
    }
  };

  const mapInvestmentPlan = (row: typeof schema.investmentPlans.$inferSelect) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status as "active" | "inactive" | "archived",
    baseCurrency: row.baseCurrency,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  const mapInvestmentCycle = (row: typeof schema.investmentCycles.$inferSelect) => ({
    id: row.id,
    planId: row.planId,
    name: row.name,
    startDate: row.startDate,
    endDate: row.endDate,
    monthlyAmountEur: row.monthlyAmountEur,
    contributionCurrency: row.contributionCurrency,
    status: row.status as "planned" | "active" | "closed" | "paused",
    priority: row.priority,
    objetivo: (row.objetivo ?? null) as "acumulacion" | "crecimiento" | "preservacion" | "renta" | null,
    riesgo: (row.riesgo ?? null) as "bajo" | "moderado" | "alto" | "muy_alto" | null,
    allowExtraContributions: row.allowExtraContributions !== 0,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  const mapInvestmentAsset = (row: typeof schema.investmentAssets.$inferSelect) => ({
    id: row.id,
    cycleId: row.cycleId,
    assetId: row.assetId,
    allocationType: row.allocationType as "percentage" | "amount",
    allocationValue: row.allocationValue,
    allocationPercentage: row.allocationPercentage ?? (row.allocationType === "percentage" ? row.allocationValue : null),
    fixedAmountEur: row.fixedAmountEur ?? (row.allocationType === "amount" ? row.allocationValue : null),
    priority: row.priority,
    targetAmount: row.targetAmount,
    targetValueEur: row.targetValueEur,
    targetPortfolioPercentage: row.targetPortfolioPercentage,
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status as "active" | "paused" | "closed" | "goal_reached",
    isActive: row.isActive === 1,
    notes: row.notes,
    goalReachedAt: row.goalReachedAt ?? null,
    goalReachedValue: row.goalReachedValue ?? null,
    goalReachedType: (row.goalReachedType ?? null) as "quantity" | "value" | "portfolio_percentage" | null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  const mapStrategyRevision = (row: typeof schema.strategyRevisions.$inferSelect) => ({
    id: row.id,
    cycleId: row.cycleId,
    effectiveDate: row.effectiveDate,
    title: row.title,
    notes: row.notes,
    changesJson: row.changesJson,
    createdAt: row.createdAt,
  });

  const mapContributionSchedule = (row: typeof schema.contributionSchedule.$inferSelect) => ({
    id: row.id,
    cycleId: row.cycleId,
    type: row.type as "periodica" | "extraordinaria",
    plannedDate: row.plannedDate,
    amountEur: row.amountEur,
    currency: row.currency,
    destination: row.destination ?? null,
    status: row.status as "pendiente" | "ejecutada" | "cancelada",
    executedAt: row.executedAt ?? null,
    notes: row.notes ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  const mapAssetSubstitution = (row: typeof schema.assetSubstitutions.$inferSelect) => ({
    id: row.id,
    cycleId: row.cycleId,
    fromAssetId: row.fromAssetId,
    toAssetId: row.toAssetId ?? null,
    fromInvestmentAssetId: row.fromInvestmentAssetId ?? null,
    toInvestmentAssetId: row.toInvestmentAssetId ?? null,
    effectiveDate: row.effectiveDate,
    status: (row.status ?? "aplicada") as "borrador" | "programada" | "aplicada" | "cancelada",
    allocationTransferMode: (row.allocationTransferMode ?? null) as "full" | "custom" | "pending" | null,
    allocationTransferPercentage: row.allocationTransferPercentage ?? null,
    allocationTransferAmount: row.allocationTransferAmount ?? null,
    appliedAt: row.appliedAt ?? null,
    revisionId: row.revisionId ?? null,
    reason: row.reason,
    notes: row.notes ?? null,
    createdAt: row.createdAt,
  });

  type InvestmentAssetRuleRow = {
    id?: string;
    cycleId: string;
    assetId: string;
    allocationType: string;
    allocationValue: number;
    allocationPercentage: number | null;
    fixedAmountEur: number | null;
    startDate: number;
    endDate: number | null;
    status: string;
    isActive: number;
  };

  function assertDateRange(startDate: number, endDate: number | null | undefined, label: string) {
    if (endDate !== null && endDate !== undefined && endDate < startDate) {
      throw new Error(`${label}: la fecha fin no puede ser anterior a la fecha inicio.`);
    }
  }

  function rangeOverlaps(aStart: number, aEnd: number | null | undefined, bStart: number, bEnd: number | null | undefined) {
    const leftEnd = aEnd ?? Number.MAX_SAFE_INTEGER;
    const rightEnd = bEnd ?? Number.MAX_SAFE_INTEGER;
    return aStart <= rightEnd && bStart <= leftEnd;
  }

  function getInvestmentCycleOrThrow(id: string) {
    const row = db.select().from(schema.investmentCycles).where(eq(schema.investmentCycles.id, id)).get();
    if (!row) throw new Error(`Ciclo de inversión ${id} no encontrado.`);
    return row;
  }

  function getInvestmentAssetOrThrow(id: string) {
    const row = db.select().from(schema.investmentAssets).where(eq(schema.investmentAssets.id, id)).get();
    if (!row) throw new Error(`Activo de plan ${id} no encontrado.`);
    return row;
  }

  function getInvestmentAssetRuleRows(cycleId: string): InvestmentAssetRuleRow[] {
    return db.select()
      .from(schema.investmentAssets)
      .where(eq(schema.investmentAssets.cycleId, cycleId))
      .all()
      .map((row) => ({
        id: row.id,
        cycleId: row.cycleId,
        assetId: row.assetId,
        allocationType: row.allocationType,
        allocationValue: row.allocationValue,
        allocationPercentage: row.allocationPercentage,
        fixedAmountEur: row.fixedAmountEur,
        startDate: row.startDate,
        endDate: row.endDate,
        status: row.status,
        isActive: row.isActive,
      }));
  }

  function assetPercentage(row: InvestmentAssetRuleRow) {
    return row.allocationPercentage ?? (row.allocationType === "percentage" ? row.allocationValue : null);
  }

  function assetFixedAmount(row: InvestmentAssetRuleRow) {
    return row.fixedAmountEur ?? (row.allocationType === "amount" ? row.allocationValue : null);
  }

  function assertAssetInsideCycle(cycle: typeof schema.investmentCycles.$inferSelect, row: InvestmentAssetRuleRow) {
    assertDateRange(row.startDate, row.endDate, "Moneda del plan");
    if (row.startDate < cycle.startDate) {
      throw new Error("La moneda no puede empezar antes que el ciclo.");
    }
    if (cycle.endDate !== null && row.startDate > cycle.endDate) {
      throw new Error("La moneda no puede empezar después de que termine el ciclo.");
    }
    if (cycle.endDate !== null && row.endDate !== null && row.endDate > cycle.endDate) {
      throw new Error("La moneda no puede cerrar después de que termine el ciclo.");
    }
  }

  function assertNoDuplicateActiveAssets(rows: InvestmentAssetRuleRow[]) {
    const activeRows = rows.filter((row) => row.status === "active" && row.isActive === 1);
    for (let index = 0; index < activeRows.length; index += 1) {
      const current = activeRows[index];
      for (const other of activeRows.slice(index + 1)) {
        if (current.assetId === other.assetId && rangeOverlaps(current.startDate, current.endDate, other.startDate, other.endDate)) {
          throw new Error(`La moneda ${current.assetId} ya está activa en ese ciclo para un rango de fechas solapado.`);
        }
      }
    }
  }

  function assertCycleDistribution(cycle: typeof schema.investmentCycles.$inferSelect, rows: InvestmentAssetRuleRow[]) {
    const activeRows = rows.filter((row) => row.status === "active" && row.isActive === 1);
    const percentageRows = activeRows.filter((row) => assetPercentage(row) !== null);
    const percentageTotal = percentageRows.reduce((sum, row) => sum + (assetPercentage(row) ?? 0), 0);
    const fixedTotal = activeRows.reduce((sum, row) => sum + (assetFixedAmount(row) ?? 0), 0);

    if (fixedTotal - cycle.monthlyAmountEur > 0.01) {
      throw new Error("Los importes fijos activos superan el importe mensual del ciclo.");
    }
    if (cycle.status === "active") {
      if (activeRows.length === 0) {
        throw new Error("Un ciclo activo necesita al menos una moneda activa.");
      }
      if (percentageRows.length > 0 && Math.abs(percentageTotal - 100) > 0.01) {
        throw new Error("En un ciclo activo la suma de porcentajes activos debe ser 100%.");
      }
    }
  }

  function assertInvestmentAssetRules(cycleId: string, nextRow: InvestmentAssetRuleRow, excludingId?: string) {
    const cycle = getInvestmentCycleOrThrow(cycleId);
    assertAssetInsideCycle(cycle, nextRow);
    const rows = getInvestmentAssetRuleRows(cycleId).filter((row) => row.id !== excludingId);
    const projectedRows = [...rows, nextRow];
    assertNoDuplicateActiveAssets(projectedRows);
    assertCycleDistribution(cycle, projectedRows);
  }

  function assertInvestmentCycleRules(cycle: typeof schema.investmentCycles.$inferSelect, rows = getInvestmentAssetRuleRows(cycle.id)) {
    assertDateRange(cycle.startDate, cycle.endDate, "Ciclo");
    rows.forEach((row) => assertAssetInsideCycle(cycle, row));
    assertNoDuplicateActiveAssets(rows);
    assertCycleDistribution(cycle, rows);
  }

  const mapTreasuryMovement = (row: typeof schema.treasuryMovements.$inferSelect) => ({
    id: row.id,
    date: row.date,
    type: row.type,
    sourceAccountType: row.sourceAccountType,
    destinationAccountType: row.destinationAccountType,
    amount: row.amount,
    currency: row.currency,
    reason: row.reason,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  function calculateSpanishSavingsTax(netGain: number): number {
    if (netGain <= 0) return 0;
    const brackets = [
      { upTo: 6_000, rate: 0.19 },
      { upTo: 50_000, rate: 0.21 },
      { upTo: 200_000, rate: 0.23 },
      { upTo: 300_000, rate: 0.27 },
      { upTo: null, rate: 0.28 },
    ] as const;
    let remaining = netGain;
    let tax = 0;
    let previousUpTo = 0;
    for (const bracket of brackets) {
      const bracketSize = bracket.upTo !== null ? bracket.upTo - previousUpTo : Infinity;
      const taxable = Math.min(remaining, bracketSize);
      tax += taxable * bracket.rate;
      remaining -= taxable;
      if (remaining <= 0) break;
      if (bracket.upTo !== null) previousUpTo = bracket.upTo;
    }
    return tax;
  }

  function getRecommendedFiscalReserve(): number {
    const gains = db.select().from(schema.realizedGains).all();
    const byYear = new Map<number, number>();
    for (const gain of gains) {
      if (!Number.isFinite(gain.date) || gain.date <= 0) continue;
      const year = new Date(gain.date).getFullYear();
      byYear.set(year, (byYear.get(year) ?? 0) + gain.realizedGainEur);
    }
    return [...byYear.values()].reduce((sum, netGain) => sum + calculateSpanishSavingsTax(netGain), 0);
  }

  function getCoinbaseEurcBalance(): number {
    const latest = db.select({
      totalBalanceFiat: schema.coinbaseSpotPositionSnapshots.totalBalanceFiat,
      totalBalanceCrypto: schema.coinbaseSpotPositionSnapshots.totalBalanceCrypto,
    })
      .from(schema.coinbaseSpotPositionSnapshots)
      .where(eq(schema.coinbaseSpotPositionSnapshots.asset, "EURC"))
      .orderBy(desc(schema.coinbaseSpotPositionSnapshots.capturedAt))
      .get();
    return finiteOrNull(latest?.totalBalanceFiat) ?? finiteOrNull(latest?.totalBalanceCrypto) ?? 0;
  }

  const getTreasuryRepository = () => new DatabaseTreasuryRepository(db);

  function isInvestableAsset(assetId: string): boolean {
    if (assetId === "EUR" || assetId === "EURC") return false;
    const row = db.select({ type: schema.assets.type }).from(schema.assets).where(eq(schema.assets.id, assetId)).get();
    return row?.type !== "fiat";
  }

  type SnapshotPriceResult = {
    price: number | null;
    state: "live" | "cached" | "unavailable";
    provider: string;
    fetchedAt: number;
    reason?: string;
  };

  const SNAPSHOT_PRICE_TIMEOUT_MS = 4500;
  const SNAPSHOT_FRESH_CACHE_MS = 5 * 60 * 1000;
  const snapshotPriceRequests = new Map<string, Promise<SnapshotPriceResult>>();

  function withSoftTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(fallback), timeoutMs);
      promise.then(
        (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        () => {
          clearTimeout(timeout);
          resolve(fallback);
        },
      );
    });
  }

  async function getCachedSnapshotPrice(assetId: string): Promise<SnapshotPriceResult | null> {
    const meta = getAssetMetadata(assetId);
    if (!meta) return null;
    const cached = await marketCache.getCurrentPrice(assetId, meta.quoteCurrency, { allowStale: true }).catch(() => null);
    const price = finiteOrNull(cached?.price);
    if (price === null || !cached) return null;
    return {
      price,
      state: "cached",
      provider: cached.provider,
      fetchedAt: cached.fetchedAt,
      reason: "Ultimo dato valido en cache",
    };
  }

  async function getSnapshotPrice(assetId: string): Promise<SnapshotPriceResult> {
    const key = assetId.toUpperCase();
    const pending = snapshotPriceRequests.get(key);
    if (pending) return pending;

    const request = (async () => {
      const cached = await getCachedSnapshotPrice(assetId);
      if (cached && Date.now() - cached.fetchedAt <= SNAPSHOT_FRESH_CACHE_MS) {
        return cached;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SNAPSHOT_PRICE_TIMEOUT_MS);
      try {
        const live = await marketService.getCurrentPrice(assetId, controller.signal);
        const price = finiteOrNull(live.price);
        if (price !== null) {
          return { ...live, price };
        }
        return cached ?? {
          price: null,
          state: "unavailable",
          provider: live.provider ?? "none",
          fetchedAt: live.fetchedAt ?? Date.now(),
          reason: live.reason ?? "Precio no disponible",
        };
      } catch (error) {
        return cached ?? {
          price: null,
          state: "unavailable",
          provider: "none",
          fetchedAt: Date.now(),
          reason: error instanceof Error ? error.message : "Precio no disponible",
        };
      } finally {
        clearTimeout(timeout);
      }
    })().finally(() => {
      snapshotPriceRequests.delete(key);
    });

    snapshotPriceRequests.set(key, request);
    return request;
  }

  function marketHistoryTimeoutMs(period: string): number {
    if (period === "1h") return 7000;
    if (period === "24h") return 8000;
    if (period === "7d" || period === "30d") return 10_000;
    return 12_000;
  }

  function pointTimestampMs(point: { time?: number; timestamp?: number }): number | null {
    const timestamp = finiteOrNull(point.timestamp);
    if (timestamp !== null) return timestamp;
    const seconds = finiteOrNull(point.time);
    return seconds !== null ? seconds * 1000 : null;
  }

  async function getCurrentPriceFast(assetId: string): Promise<SnapshotPriceResult> {
    const meta = getAssetMetadata(assetId);
    const quoteCurrency = meta?.quoteCurrency ?? "EUR";
    const cached = await marketCache.getCurrentPrice(assetId, quoteCurrency, { allowStale: true }).catch(() => null);
    const cachedPrice = finiteOrNull(cached?.price);
    const cachedFallback: SnapshotPriceResult | null = cached && cachedPrice !== null
      ? {
          price: cachedPrice,
          state: "cached",
          provider: cached.provider,
          fetchedAt: cached.fetchedAt,
          reason: "Ultimo precio valido en cache",
        }
      : null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SNAPSHOT_PRICE_TIMEOUT_MS);
    try {
      const live = await marketService.getCurrentPrice(assetId, controller.signal);
      const price = finiteOrNull(live.price);
      if (price !== null) return { ...live, price };
      return cachedFallback ?? {
        price: null,
        state: "unavailable",
        provider: live.provider ?? "none",
        fetchedAt: live.fetchedAt ?? Date.now(),
        reason: live.reason ?? "Precio no disponible",
      };
    } catch (error) {
      return cachedFallback ?? {
        price: null,
        state: "unavailable",
        provider: "none",
        fetchedAt: Date.now(),
        reason: error instanceof Error ? error.message : "Precio no disponible",
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function getCachedHistoricalResult(assetId: string, period: string, quoteCurrency: string, reason?: string) {
    const cached = await marketCache.getHistoricalPrices(assetId, quoteCurrency, period, { allowStale: true }).catch(() => null);
    const points = cached ? sanitizePoints(cached) : [];
    if (points.length < 2) return null;
    const provider = points.find((point) => point.source)?.source ?? "cache";
    return {
      provider,
      points,
      requestedPeriod: period,
      actualInterval: "auto",
      fetchedAt: Date.now(),
      isCached: true,
      cacheStatus: "stale" as const,
      reason: reason ? `Ultimo historico valido en cache: ${reason}` : "Ultimo historico valido en cache",
    };
  }

  async function getHistoricalPricesFast(assetId: string, period: string, quoteCurrency = "EUR") {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), marketHistoryTimeoutMs(period));
    try {
      const result = await marketService.getHistoricalPrices(assetId, period, controller.signal);
      const points = sanitizePoints(result.points);
      if (points.length >= 2) {
        return {
          ...result,
          points,
        };
      }

      const cached = await getCachedHistoricalResult(assetId, period, quoteCurrency, "La fuente devolvio puntos insuficientes");
      if (cached) return cached;
      return {
        ...result,
        points,
        reason: result.reason ?? "Historico insuficiente para dibujar la grafica",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cached = await getCachedHistoricalResult(assetId, period, quoteCurrency, message);
      if (cached) return cached;
      console.warn(`[Market] Historico no disponible para ${assetId} ${period}:`, message);
      return {
        provider: "none",
        points: [],
        requestedPeriod: period,
        actualInterval: "auto",
        fetchedAt: Date.now(),
        isCached: true,
        cacheStatus: "miss" as const,
        reason: `Sin historico disponible: ${message}`,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function buildPerspectivesSnapshot(now = Date.now()): Promise<import("@crypto-control/portfolio").PlanConsolidatedSnapshot> {
    const planRows = db.select().from(schema.investmentPlans)
      .where(eq(schema.investmentPlans.status, "active"))
      .orderBy(asc(schema.investmentPlans.createdAt))
      .all();
    if (planRows.length === 0) throw new Error("No hay un plan de inversión activo.");

    const primaryPlan = planRows[0];
    const planIds = planRows.map(plan => plan.id);

    const cycleRows = db.select().from(schema.investmentCycles)
      .where(inArray(schema.investmentCycles.planId, planIds))
      .orderBy(asc(schema.investmentCycles.startDate), asc(schema.investmentCycles.priority))
      .all()
      .filter(cycle => cycle.status === "active" || cycle.status === "planned");
    const cycleIds = cycleRows.map(c => c.id);

    const allAssetRows = cycleIds.length > 0
      ? db.select().from(schema.investmentAssets)
        .where(inArray(schema.investmentAssets.cycleId, cycleIds))
        .all()
      : [];

    const cycles: import("@crypto-control/portfolio").SnapshotCycle[] = cycleRows.map(c => ({
      id: c.id,
      planId: c.planId,
      name: c.name,
      startDate: c.startDate,
      endDate: c.endDate ?? null,
      monthlyAmountEur: c.monthlyAmountEur,
      status: c.status,
      assets: allAssetRows
        .filter(a => a.cycleId === c.id)
        .map(a => ({
          id: a.id,
          assetId: a.assetId,
          cycleId: a.cycleId,
          status: a.status,
          allocationPercentage: a.allocationPercentage ?? null,
          allocationValue: a.allocationValue ?? null,
          allocationType: a.allocationType ?? "percentage",
          priority: a.priority,
          targetAmount: a.targetAmount ?? null,
          targetValueEur: a.targetValueEur ?? null,
          targetPortfolioPercentage: a.targetPortfolioPercentage ?? null,
          goalReachedAt: a.goalReachedAt ?? null,
          startDate: a.startDate ?? c.startDate,
          endDate: a.endDate ?? null,
        })),
    }));

    const portfolioService = getPortfolioService();
    const portfolioPositions = (await portfolioService.getPositions()).positions as Record<string, {
      balance: number;
      averagePriceEur: number | null;
      totalInvestedEur: number;
    }>;

    const investablePositionIds = Object.entries(portfolioPositions)
      .filter(([assetId, position]) => isInvestableAsset(assetId) && position.balance > 1e-12)
      .map(([assetId]) => assetId);
    const plannedAssetIds = allAssetRows
      .map(row => row.assetId)
      .filter(isInvestableAsset);
    const assetIds = Array.from(new Set([...investablePositionIds, ...plannedAssetIds]));

    const prices: Record<string, number | null> = {};
    const staleData: string[] = [];

    await Promise.all(assetIds.map(async (assetId) => {
      const priceResult = await getSnapshotPrice(assetId);
      prices[assetId] = finiteOrNull(priceResult.price);
      if (priceResult.state === "cached") staleData.push(assetId);
    }));

    const positions: Record<string, import("@crypto-control/portfolio").SnapshotPosition> = {};
    for (const assetId of investablePositionIds) {
      const pos = portfolioPositions[assetId];
      const price = prices[assetId] ?? null;
      const currentValueEur = price !== null ? pos.balance * price : null;
      positions[assetId] = {
        assetId,
        balance: pos.balance,
        avgCostEur: pos.averagePriceEur,
        currentValueEur,
        currentPriceEur: price,
      };
    }

    const historicalCapitalEur = investablePositionIds.reduce((sum, assetId) => {
      return sum + (portfolioPositions[assetId]?.totalInvestedEur ?? 0);
    }, 0);

    const historicalSaleRows = db.select().from(schema.cyclePartialSales).all();
    const historicalSalesEur = historicalSaleRows.reduce((s, r) => s + r.proceedsEur, 0);
    const historicalRebuysEur = db.select().from(schema.treasuryMovements).all()
      .filter(row => row.type === "usar_recompra")
      .reduce((sum, row) => sum + row.amount, 0);

    const contribRows = cycleIds.length > 0
      ? db.select().from(schema.contributionSchedule)
        .where(inArray(schema.contributionSchedule.cycleId, cycleIds))
        .all()
      : [];
    const futureContributions: import("@crypto-control/portfolio").SnapshotContribution[] = contribRows
      .filter(r => r.status === "pendiente" && r.plannedDate > now)
      .map(r => ({
        id: r.id,
        cycleId: r.cycleId,
        type: r.type as "periodica" | "extraordinaria",
        plannedDate: r.plannedDate,
        amountEur: r.amountEur,
        destinationAssetId: r.destination ?? null,
        status: r.status as "pendiente" | "ejecutada" | "saltada" | "cancelada",
        executedAt: r.executedAt ?? null,
      }));

    const saleRuleRows = cycleIds.length > 0
      ? db.select().from(schema.partialSaleRules)
        .where(inArray(schema.partialSaleRules.cycleId, cycleIds))
        .all()
      : [];
    const saleRules: import("@crypto-control/portfolio").SnapshotSaleRule[] = saleRuleRows.map(r => ({
      id: r.id,
      cycleId: r.cycleId,
      assetId: r.assetId,
      name: r.name,
      conditionType: r.conditionType,
      conditionValue: r.conditionValue ?? null,
      conditionValue2: r.conditionValue2 ?? null,
      sellPercentage: r.sellPercentage,
      priority: r.priority,
      status: r.status,
    }));

    const rebuyTierRows = cycleIds.length > 0
      ? db.select().from(schema.cycleRebuyTiers)
        .where(inArray(schema.cycleRebuyTiers.cycleId, cycleIds))
        .all()
      : [];
    const rebuyTiers: import("@crypto-control/portfolio").SnapshotRebuyTier[] = rebuyTierRows.map(r => ({
      id: r.id,
      cycleId: r.cycleId,
      assetId: r.assetId ?? null,
      drawdownPercentage: r.drawdownPercentage,
      usagePercentage: r.usagePercentage,
      priority: r.priority ?? 0,
      status: r.status ?? "activa",
      referenceType: r.referenceType ?? null,
      referenceValue: r.referenceValue ?? null,
      lastTriggeredAt: r.lastTriggeredAt ?? null,
    }));

    const substitutionRows = cycleIds.length > 0
      ? db.select().from(schema.assetSubstitutions)
        .where(inArray(schema.assetSubstitutions.cycleId, cycleIds))
        .all()
      : [];
    const substitutions: import("@crypto-control/portfolio").SnapshotSubstitution[] = substitutionRows
      .filter(r => r.status === "programada" && r.effectiveDate > now)
      .map(r => ({
        id: r.id,
        cycleId: r.cycleId,
        fromAssetId: r.fromAssetId,
        toAssetId: r.toAssetId ?? null,
        effectiveDate: r.effectiveDate,
        status: r.status,
        transferMode: r.allocationTransferMode ?? "full",
      }));

    const treasurySummary = getTreasuryRepository().getSummary(getRecommendedFiscalReserve(), getCoinbaseEurcBalance());
    const eurcEur = treasurySummary?.eurcBalance ?? 0;
    const fiscalReserveEur = treasurySummary?.fiscalReserveBalance ?? 0;
    const cashEur = treasurySummary?.cashBalance ?? 0;
    const eurcAvailableEur = Math.max(0, eurcEur - fiscalReserveEur);

    const missingPrices = assetIds.filter(id => prices[id] == null);
    const missingCosts = Object.entries(positions)
      .filter(([, p]) => p.avgCostEur == null || p.avgCostEur <= 0)
      .map(([id]) => id);
    const totalAssets = assetIds.length || 1;

    const strategyRevisionRows = cycleIds.length > 0
      ? db.select().from(schema.strategyRevisions)
        .where(inArray(schema.strategyRevisions.cycleId, cycleIds))
        .orderBy(asc(schema.strategyRevisions.effectiveDate))
        .all()
      : [];
    const strategyRevisions: import("@crypto-control/portfolio").SnapshotStrategyRevision[] =
      strategyRevisionRows
        .filter(r => r.effectiveDate != null && r.effectiveDate > now)
        .map(r => ({
          id: r.id,
          cycleId: r.cycleId,
          effectiveDate: r.effectiveDate!,
          title: r.title,
          notes: r.notes ?? null,
          changesJson: r.changesJson ?? "{}",
        }));

    const lastRevision = strategyRevisionRows[strategyRevisionRows.length - 1] ?? null;
    const strategyVersion = lastRevision
      ? `multi-rev-${lastRevision.id.slice(0, 8)}`
      : `multi-${planIds.map(id => id.slice(0, 8)).join("-")}`;

    return {
      snapshotId: `snap-${now}`,
      generatedAt: now,
      projectionStartDate: now,
      planId: primaryPlan.id,
      planName: planRows.length === 1 ? primaryPlan.name : `${planRows.length} planes activos`,
      plans: planRows.map(plan => ({
        id: plan.id,
        name: plan.name,
        status: plan.status,
        baseCurrency: plan.baseCurrency,
      })),
      cycles,
      positions,
      historicalCapitalEur,
      historicalSalesEur,
      historicalRebuysEur,
      futureContributions,
      saleRules,
      rebuyTiers,
      substitutions,
      strategyRevisions,
      treasury: { cashEur, eurcEur, eurcAvailableEur, fiscalReserveEur, totalLiquidityEur: cashEur + eurcEur },
      prices,
      dataQuality: {
        overallScore: Math.max(0, 1 - (missingPrices.length + missingCosts.length) / (2 * totalAssets)),
        missingPrices,
        missingCosts,
        staleData,
        notes: [],
      },
      fiscalVersion: "es-2024",
      strategyVersion,
    };
  }

  async function getProjectionDynamicFactors(assetIds: string[] = []): Promise<{
    fearAndGreedIndex: number | null;
    btcDominance: number | null;
    assetSentiment: Record<string, { score: number; direction: string; confidence: number }>;
  }> {
    const fearGreedValue = getCachedFearGreed();
    const uniqueAssets = [...new Set(assetIds)].slice(0, 8); // cap to avoid rate-limit storms

    const [fearGreed, globalMetrics, ...sentimentResults] = await Promise.all([
      withSoftTimeout(fearGreedService.get(), 2500, null),
      withSoftTimeout(globalMetricsService.get(), 3000, null),
      ...uniqueAssets.map(id =>
        withSoftTimeout(
          sentimentService.getAssetSentiment(id, "30d", { fearGreedValue }),
          3500,
          null,
        )
      ),
    ]);

    const assetSentiment: Record<string, { score: number; direction: string; confidence: number }> = {};
    uniqueAssets.forEach((id, i) => {
      const s = sentimentResults[i];
      if (s && typeof s.score === "number" && Number.isFinite(s.score)) {
        assetSentiment[id] = { score: s.score, direction: s.direction, confidence: s.confidence };
      }
    });

    return {
      fearAndGreedIndex: fearGreed ? finiteOrNull(fearGreed.value) : null,
      btcDominance: globalMetrics ? finiteOrNull(globalMetrics.btcDominance) : null,
      assetSentiment,
    };
  }

  ipcMain.handle("portfolio:get-summary", withResult(async () => {
    return await getPortfolioService().getSummary();
  }));

  ipcMain.handle("portfolio:get-positions", withResult(async () => {
    return await getPortfolioService().getPositions();
  }));

  ipcMain.handle("portfolio:get-allocation", withResult(async () => {
    return await getPortfolioService().getAllocation();
  }));

  ipcMain.handle("portfolio:get-realized-gains", withResult(async () => {
    return await getPortfolioService().getRealizedGains();
  }));

  ipcMain.handle("portfolio:get-fifo-lots", withResult(async () => {
    return await getPortfolioService().getFifoLots();
  }));

  ipcMain.handle("portfolio:get-historical-series", withResult(async (_, input?: { period?: string }) => {
    const { getAssetMetadata } = require("@crypto-control/market-data") as typeof import("@crypto-control/market-data");
    const { buildPortfolioValueGrid, GRID_STEP_SECONDS } = require("@crypto-control/portfolio") as typeof import("@crypto-control/portfolio");
    type ValueGridPeriod = import("@crypto-control/portfolio").ValueGridPeriod;
    const repo = new DatabasePortfolioRepository(db);
    const txs = await repo.getTransactions();

    const assetRows = db.select({ id: schema.assets.id, type: schema.assets.type }).from(schema.assets).all();
    const assetTypeById = new Map(assetRows.map((asset) => [asset.id, asset.type]));
    // EUR (fiat) excluded; EURC (stablecoin reserve) included at price 1.0 EUR.
    const isPortfolioChartAsset = (assetId: string) =>
      assetId !== "EUR" &&
      assetTypeById.get(assetId) !== "fiat";

    // Collect all unique crypto + EURC assets from legs. EUR fiat excluded.
    const heldAssets = new Set<string>();
    for (const tx of txs) {
      for (const leg of tx.legs) {
        if (leg.amount !== 0 && isPortfolioChartAsset(leg.assetId)) heldAssets.add(leg.assetId);
      }
    }

    // Reconstruct running balance per asset at each transaction date
    const sorted = [...txs].sort((a, b) => a.date - b.date);
    const running: Record<string, number> = {};
    type QtyEvent = { time: number; qty: number };
    const assetEvents: Record<string, QtyEvent[]> = {};
    for (const tx of sorted) {
      for (const leg of tx.legs) {
        running[leg.assetId] = (running[leg.assetId] ?? 0) + leg.amount;
        if (!assetEvents[leg.assetId]) assetEvents[leg.assetId] = [];
        assetEvents[leg.assetId].push({ time: tx.date, qty: running[leg.assetId] });
      }
    }

    function getQtyAt(events: QtyEvent[], ts: number): number {
      if (!events.length) return 0;
      let lo = 0, hi = events.length - 1, result = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (events[mid].time <= ts) { result = events[mid].qty; lo = mid + 1; }
        else hi = mid - 1;
      }
      return result;
    }

    function priceAtOrBefore(prices: { time: number; price: number }[], ts: number, maxAgeMs: number | null): number | null {
      if (!prices.length) return null;
      let lo = 0, hi = prices.length - 1;
      let result: { time: number; price: number } | null = null;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (prices[mid].time <= ts) { result = prices[mid]; lo = mid + 1; }
        else hi = mid - 1;
      }
      if (!result) return null;
      if (maxAgeMs !== null && ts - result.time > maxAgeMs) return null;
      return result.price;
    }

    // Same period strings Mercado's own per-asset chart uses, so the
    // portfolio reconstruction gets the SAME granularity (minute-level for
    // 1h, 15-minute for 24h, etc.) instead of only ever the coarse 1y/30d/
    // daily rows — which was why short timeframes looked almost flat:
    // every grid point inside an hour was reusing the same stale daily price.
    const MARKET_PERIOD_BY_PERIOD: Record<string, string> = {
      "1h": "1h", "24h": "24h", "1w": "7d", "1m": "30d", "1y": "1y", "all": "all",
    };
    const requestedPeriod = input?.period;
    const marketPeriod = requestedPeriod ? MARKET_PERIOD_BY_PERIOD[requestedPeriod] : undefined;
    const periodWindowMs = requestedPeriod === "1h"
      ? 60 * 60 * 1000
      : requestedPeriod === "24h"
        ? 24 * 60 * 60 * 1000
        : requestedPeriod === "1w"
          ? 7 * 24 * 60 * 60 * 1000
          : requestedPeriod === "1m"
            ? 30 * 24 * 60 * 60 * 1000
            : null;
    const maxPriceCarryMs = requestedPeriod === "1h"
      ? 15 * 60 * 1000
      : requestedPeriod === "24h"
        ? 45 * 60 * 1000
        : requestedPeriod === "1w"
          ? 3 * 60 * 60 * 1000
          : requestedPeriod === "1m"
            ? 18 * 60 * 60 * 1000
            : null;

    // Fetch price history for each asset: period-matched live fetch first
    // (mirrors Mercado, same Coinbase→cache→CoinGecko→stale fallback chain),
    // then priceHistory table, then candle cache, then a broad API fallback.
    // Assets are fetched in parallel — sequentially awaiting each one made
    // the request take as long as the SUM of every asset's fetch (multiplied
    // by retries when a provider 404s), instead of just the slowest one.
    const pricesByAsset: Record<string, { time: number; price: number }[]> = {};
    const priceSourceByAsset: Record<string, string> = {};
    const marketPointCountByAsset: Record<string, number> = {};
    let totalPricePoints = 0;

    function loadCachedPricesForAsset(assetId: string, interval: string): { time: number; price: number; source: string }[] {
      return db.select({
        timestamp: schema.priceHistory.timestamp,
        price: schema.priceHistory.price,
        provider: schema.priceHistory.provider,
      })
        .from(schema.priceHistory)
        .where(and(
          eq(schema.priceHistory.assetId, assetId),
          eq(schema.priceHistory.quoteCurrency, "EUR"),
          eq(schema.priceHistory.interval, interval),
        ))
        .orderBy(asc(schema.priceHistory.timestamp))
        .all()
        .map((row) => ({ time: row.timestamp, price: row.price, source: row.provider }));
    }

    function cleanPricePoints(points: { time: number; price: number }[]): { time: number; price: number }[] {
      const now = Date.now();
      const start = periodWindowMs !== null ? now - periodWindowMs - (maxPriceCarryMs ?? 0) : null;
      return points
        .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.price) && point.price > 0)
        .filter((point) => start === null || point.time >= start)
        .sort((a, b) => a.time - b.time);
    }

    function hasUsableShortPeriodPrices(points: { time: number; price: number }[]): boolean {
      if (marketPeriod !== "1h" && marketPeriod !== "24h") return points.length > 1;
      if (points.length < (marketPeriod === "1h" ? 10 : 8)) return false;
      const now = Date.now();
      const latest = points[points.length - 1];
      if (!latest || now - latest.time > (maxPriceCarryMs ?? 0) * 2) return false;
      return true;
    }

    async function loadPricesForAsset(assetId: string): Promise<void> {
      if (assetId === "EURC") {
        // EURC is EUR-pegged: price handled directly in valueAtMs as 1.0 EUR.
        // No market-price fetch or anchor points needed here.
        priceSourceByAsset[assetId] = "eur-peg";
        return;
      }
      if (marketPeriod) {
        const cachedExact = loadCachedPricesForAsset(assetId, marketPeriod);
        const cleanedCachedExact = cleanPricePoints(cachedExact.map((point) => ({ time: point.time, price: point.price })));
        if (hasUsableShortPeriodPrices(cleanedCachedExact)) {
          pricesByAsset[assetId] = cleanedCachedExact;
          priceSourceByAsset[assetId] = `${cachedExact[0].source}(cache:${marketPeriod})`;
          marketPointCountByAsset[assetId] = cleanedCachedExact.length;
          totalPricePoints += cleanedCachedExact.length;
          return;
        }

        try {
          const result = await getHistoricalPricesFast(assetId, marketPeriod);
          const cleaned = cleanPricePoints(result.points.map(p => ({ time: pointTimestampMs(p) ?? 0, price: p.value })));
          if (hasUsableShortPeriodPrices(cleaned)) {
            pricesByAsset[assetId] = cleaned;
            priceSourceByAsset[assetId] = result.provider;
            marketPointCountByAsset[assetId] = cleaned.length;
            totalPricePoints += cleaned.length;
            return;
          }
        } catch {
          // fall through to the slower/coarser sources below
        }
      }

      // Short-period rescue: if the exact-period fetch failed for 1h or 24h,
      // try the next broader-but-still-granular period before falling to coarse
      // daily data. Daily data produces only 0–1 price points inside a 1h/24h
      // window, making the chart a flat line instead of real movement.
      // "1h" → try "24h" (1-hour candles); "24h" → try "7d" (6-hour candles).
      if (marketPeriod === "1h" || marketPeriod === "24h") {
        const rescuePeriod = marketPeriod === "1h" ? "24h" : "7d";
        try {
          const rescueResult = await getHistoricalPricesFast(assetId, rescuePeriod);
          const rescueCleaned = cleanPricePoints(rescueResult.points.map(p => ({ time: pointTimestampMs(p) ?? 0, price: p.value })));
          if (hasUsableShortPeriodPrices(rescueCleaned)) {
            pricesByAsset[assetId] = rescueCleaned;
            priceSourceByAsset[assetId] = `${rescueResult.provider}(${rescuePeriod}-rescue)`;
            marketPointCountByAsset[assetId] = rescueCleaned.length;
            totalPricePoints += rescueCleaned.length;
            return;
          }
        } catch {
          // fall through to coarse sources
        }
      }

      // 1. priceHistory table (broad intervals only)
      const phRows = db.select({ timestamp: schema.priceHistory.timestamp, price: schema.priceHistory.price })
        .from(schema.priceHistory)
        .where(and(
          eq(schema.priceHistory.assetId, assetId),
          eq(schema.priceHistory.quoteCurrency, "EUR"),
          or(
            eq(schema.priceHistory.interval, "1y"),
            eq(schema.priceHistory.interval, "all"),
            eq(schema.priceHistory.interval, "30d"),
          )
        ))
        .orderBy(asc(schema.priceHistory.timestamp))
        .all();

      // Daily data (priceHistory, coinbaseCandleCache, 1y API) produces at most
      // 0–1 price points inside a 1h/24h window: every minute-level grid point
      // resolves to the same stale daily close → flat line that misrepresents the
      // period. Return early so Portfolio.tsx handles the empty series honestly
      // (e.g. snapshot fallback) rather than showing misleading flat data.
      //
      // NO modificar esta lógica sin actualizar los tests de regresión de gráficas
      // de cartera en packages/portfolio/src/value-grid.test.ts.
      if (marketPeriod === "1h" || marketPeriod === "24h") return;

      if (phRows.length > 10) {
        pricesByAsset[assetId] = phRows.map(r => ({ time: r.timestamp, price: r.price }));
        priceSourceByAsset[assetId] = "priceHistory";
        totalPricePoints += phRows.length;
        return;
      }

      // 2. coinbaseCandleCache (start is Unix seconds → convert to ms)
      // Only used for broad-period grids (1w/1m/1y/all) — daily candles are
      // appropriate there but useless for 1h/24h (guarded above).
      const meta = getAssetMetadata(assetId);
      if (meta) {
        const candleRows = db.select({ start: schema.coinbaseCandleCache.start, close: schema.coinbaseCandleCache.close })
          .from(schema.coinbaseCandleCache)
          .where(eq(schema.coinbaseCandleCache.productId, meta.coinbaseProductId))
          .orderBy(asc(schema.coinbaseCandleCache.start))
          .all();

        if (candleRows.length > 5) {
          pricesByAsset[assetId] = candleRows.map(r => ({ time: r.start * 1000, price: r.close }));
          priceSourceByAsset[assetId] = "coinbaseCandleCache";
          totalPricePoints += candleRows.length;
          return;
        }
      }

      // 3. Live API fallback (fetches + caches to priceHistory, broad 1y data)
      try {
        const result = await getHistoricalPricesFast(assetId, "1y");
        if (result.points.length > 0) {
          pricesByAsset[assetId] = result.points
            .map(p => ({ time: pointTimestampMs(p) ?? 0, price: p.value }))
            .sort((a, b) => a.time - b.time);
          priceSourceByAsset[assetId] = result.provider;
          totalPricePoints += result.points.length;
        }
      } catch {
        // Asset not mapped or API unavailable — omit from series
      }
    }

    await Promise.all([...heldAssets].map(loadPricesForAsset));

    const valueAtMs = (ts: number): { value: number; hasHolding: boolean; complete: boolean } => {
      let totalValue = 0;
      let hasHolding = false;
      let complete = true;
      for (const assetId of heldAssets) {
        const qty = getQtyAt(assetEvents[assetId] ?? [], ts);
        if (qty <= 0) continue;
        hasHolding = true;
        // EURC is EUR-pegged: 1 EURC = 1.000 EUR at all historical timestamps.
        // Bypass priceAtOrBefore (which would reject time=0 via maxPriceCarryMs).
        if (assetId === "EURC") {
          totalValue += qty * 1.0;
          continue;
        }
        const prices = pricesByAsset[assetId];
        if (!prices || prices.length === 0) {
          complete = false;
          continue;
        }
        const price = priceAtOrBefore(prices, ts, maxPriceCarryMs);
        if (price === null || price <= 0) {
          complete = false;
          continue;
        }
        totalValue += qty * price;
      }
      return { value: totalValue, hasHolding, complete };
    };

    const period = input?.period as ValueGridPeriod | undefined;
    const step = period ? GRID_STEP_SECONDS[period] : undefined;

    let points: { time: number; value: number }[];

    if (period && step) {
      // Fixed, regular grid — same point count/timestamps Mercado would
      // generate for this period — instead of "whenever some asset's price
      // data happens to have a point".
      const nowSeconds = Math.floor(Date.now() / 1000);
      const firstTxSeconds = sorted.length > 0 ? Math.floor(sorted[0].date / 1000) : nowSeconds;
      points = buildPortfolioValueGrid({ period, nowSeconds, firstTxSeconds, valueAtMs });
    } else {
      // No period requested: full irregular series at every timestamp any
      // asset's price history actually has a point (legacy/unfiltered view).
      const allTs = new Set<number>();
      for (const prices of Object.values(pricesByAsset)) {
        for (const p of prices) allTs.add(p.time);
      }
      const sortedTs = [...allTs].sort((a, b) => a - b);
      const seenSeconds = new Set<number>();
      points = [];
      for (const ts of sortedTs) {
        const { value, hasHolding } = valueAtMs(ts);
        if (!hasHolding || value <= 0) continue;
        const seconds = Math.floor(ts / 1000);
        if (seenSeconds.has(seconds)) continue;
        seenSeconds.add(seconds);
        points.push({ time: seconds, value });
      }
    }

    if (period) {
      const marketPoints = Math.max(0, ...Object.values(marketPointCountByAsset));
      console.log(`[Cartera] Periodo: ${period}`);
      console.log(`[Cartera] Market points (por activo): ${JSON.stringify(marketPointCountByAsset)}`);
      console.log(`[Cartera] Portfolio points: ${points.length}`);
      console.log(`[Cartera] Primer timestamp: ${points.length ? new Date(points[0].time * 1000).toISOString() : "-"}`);
      console.log(`[Cartera] Último timestamp: ${points.length ? new Date(points[points.length - 1].time * 1000).toISOString() : "-"}`);
      console.log(`[Cartera] Granularidad: ${step ?? "irregular"}s`);
      console.log(`[Cartera] Assets usados: ${[...heldAssets].join(", ")}`);
      console.log(`[Cartera] Fuentes de precio usadas: ${JSON.stringify(priceSourceByAsset)}`);
      for (const assetId of heldAssets) {
        const prices = pricesByAsset[assetId] ?? [];
        const uniquePrices = new Set(prices.map((point) => point.price.toFixed(8))).size;
        const minPrice = prices.length ? Math.min(...prices.map((point) => point.price)) : null;
        const maxPrice = prices.length ? Math.max(...prices.map((point) => point.price)) : null;
        console.log(`[Cartera] Asset ${assetId}: points=${prices.length}, uniquePrices=${uniquePrices}, min=${minPrice ?? "-"}, max=${maxPrice ?? "-"}, source=${priceSourceByAsset[assetId] ?? "none"}`);
      }
      const uniquePortfolioValues = new Set(points.map((point) => point.value.toFixed(6))).size;
      const minPortfolioValue = points.length ? Math.min(...points.map((point) => point.value)) : null;
      const maxPortfolioValue = points.length ? Math.max(...points.map((point) => point.value)) : null;
      console.log(`[Cartera] Portfolio stats: uniqueValues=${uniquePortfolioValues}, min=${minPortfolioValue ?? "-"}, max=${maxPortfolioValue ?? "-"}`);
      if (marketPoints > 0 && points.length !== marketPoints) {
        console.log(`[Cartera] Portfolio points (${points.length}) !== Market points (${marketPoints}): la rejilla de cartera usa el mismo paso temporal, pero omite minutos sin holding (>0) o sin precio resoluble — no se interpola ni se rellena con datos inventados.`);
      }
    }

    return {
      points,
      meta: { txCount: txs.length, pricePoints: totalPricePoints, assetsTracked: [...heldAssets] },
    };
  }));

  ipcMain.handle("transactions:list", withResult(async () => {
    const repo = new DatabasePortfolioRepository(db);
    const list = await repo.getTransactions();
    return TransactionInputListSchema.parse(list);
  }));

  ipcMain.handle("transactions:create", withResult(async (_, payload) => {
    const db = getDb();
    const parsed = CreateTransactionSchema.parse(payload);
    
    return db.transaction((tx) => {
      const txId = crypto.randomUUID();
      
      tx.insert(schema.transactions).values({
        id: txId,
        type: parsed.type,
        date: parsed.date,
        externalId: parsed.externalId,
        notes: parsed.notes,
        cycleId: parsed.cycleId ?? null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }).run();

      for (const leg of parsed.legs) {
        tx.insert(schema.transactionLegs).values({
          id: crypto.randomUUID(),
          transactionId: txId,
          assetId: leg.assetId,
          accountId: leg.accountId,
          amount: leg.amount,
          legType: leg.legType,
          valuationEur: leg.valuationEur
        }).run();
      }

      if (parsed.fees) {
        for (const fee of parsed.fees) {
          tx.insert(schema.fees).values({
            id: crypto.randomUUID(),
            transactionId: txId,
            assetId: fee.assetId,
            amount: fee.amount
          }).run();
        }
      }
      
      return { id: txId };
    });
  }));

  ipcMain.handle("transactions:update", withResult(async (_, id: string, payload) => {
    const db = getDb();
    const parsed = CreateTransactionSchema.parse(payload);
    const existing = db.select({ id: schema.transactions.id })
      .from(schema.transactions)
      .where(eq(schema.transactions.id, id))
      .get();
    if (!existing) throw new Error(`Operación ${id} no encontrada.`);

    db.transaction((tx) => {
      tx.delete(schema.transactionLegs).where(eq(schema.transactionLegs.transactionId, id)).run();
      tx.delete(schema.fees).where(eq(schema.fees.transactionId, id)).run();
      tx.update(schema.transactions).set({
        type: parsed.type,
        date: parsed.date,
        externalId: parsed.externalId ?? null,
        notes: parsed.notes ?? null,
        cycleId: parsed.cycleId ?? null,
        updatedAt: Date.now(),
      }).where(eq(schema.transactions.id, id)).run();
      for (const leg of parsed.legs) {
        tx.insert(schema.transactionLegs).values({
          id: crypto.randomUUID(),
          transactionId: id,
          assetId: leg.assetId,
          accountId: leg.accountId,
          amount: leg.amount,
          legType: leg.legType,
          valuationEur: leg.valuationEur,
        }).run();
      }
      if (parsed.fees) {
        for (const fee of parsed.fees) {
          tx.insert(schema.fees).values({
            id: crypto.randomUUID(),
            transactionId: id,
            assetId: fee.assetId,
            amount: fee.amount,
          }).run();
        }
      }
    });
    return null;
  }));

  ipcMain.handle("transactions:delete", withResult(async (_, id: string) => {
    const db = getDb();
    await db.delete(schema.transactions).where(eq(schema.transactions.id, id)).run();
    return null;
  }));

  ipcMain.handle("assets:list", withResult(async () => {
    const db = getDb();
    return await db.select().from(schema.assets).all();
  }));

  // Catálogo completo: activos en DB enriquecidos con metadatos de market-data
  ipcMain.handle("assets:catalog", withResult(async () => {
    const { ASSET_MAP } = require("@crypto-control/market-data") as typeof import("@crypto-control/market-data");
    const db = getDb();
    const dbAssets = db.select().from(schema.assets).all();
    const dbById = new Map(dbAssets.map(a => [a.id, a]));

    // Merge: ASSET_MAP entries first, then any extra DB assets not in map
    const catalogIds = new Set<string>();
    const catalog: Array<{
      id: string; symbol: string; name: string; logoUrl: string | null;
      type: string; inDb: boolean; supportedProviders: string[]; hasCoinbase: boolean;
    }> = [];

    for (const [id, meta] of Object.entries(ASSET_MAP)) {
      catalogIds.add(id);
      const db_entry = dbById.get(id);
      catalog.push({
        id, symbol: meta.symbol,
        name: db_entry?.name ?? meta.symbol,
        logoUrl: db_entry?.logoUrl ?? null,
        type: db_entry?.type ?? "crypto",
        inDb: !!db_entry,
        supportedProviders: meta.supportedProviders as string[],
        hasCoinbase: meta.supportedProviders.includes("coinbase"),
      });
    }
    // Extra assets in DB that are not in ASSET_MAP (manually registered)
    for (const a of dbAssets) {
      if (!catalogIds.has(a.id)) {
        catalog.push({
          id: a.id, symbol: a.symbol, name: a.name, logoUrl: a.logoUrl,
          type: a.type, inDb: true, supportedProviders: [], hasCoinbase: false,
        });
      }
    }
    return catalog;
  }));

  // Registrar un activo nuevo en la tabla assets (si no existe ya)
  ipcMain.handle("assets:register", withResult(async (_, input: {
    id: string; symbol: string; name: string; logoUrl?: string | null; type?: string;
  }) => {
    const db = getDb();
    const id = input.id.trim().toUpperCase();
    const existing = db.select().from(schema.assets).where(eq(schema.assets.id, id)).get();
    if (existing) return existing;
    const now = Date.now();
    db.insert(schema.assets).values({
      id, symbol: input.symbol.trim().toUpperCase(),
      name: input.name.trim(), logoUrl: input.logoUrl ?? null,
      type: (input.type ?? "crypto") as "crypto" | "fiat",
      createdAt: now, updatedAt: now,
    }).run();
    return db.select().from(schema.assets).where(eq(schema.assets.id, id)).get();
  }));

  ipcMain.handle("market:get-current-price", withResult(async (_, input: {assetId: string, quoteCurrency?: string}) => {
    const priceRes = await getCurrentPriceFast(input.assetId);
    return CurrentPriceResultSchema.parse(priceRes);
  }));

  ipcMain.handle("market:get-historical-prices", withResult(async (_, input: {assetId: string, period: string, quoteCurrency?: string}) => {
    const result = await getHistoricalPricesFast(input.assetId, input.period, input.quoteCurrency || "EUR");
    return HistoricalPriceResultSchema.parse(result);
  }));

  ipcMain.handle("market:get-overview", withResult(async (_, input: {assetId: string, quoteCurrency?: string}) => {
    const quoteCurrency = (input.quoteCurrency || "EUR").toUpperCase();
    const assetId = input.assetId.toUpperCase();
    const candidateProductIds = [`${assetId}-${quoteCurrency}`, input.assetId].filter(Boolean);
    let snapshot: typeof schema.coinbaseMarketSnapshots.$inferSelect | undefined;

    for (const productId of candidateProductIds) {
      snapshot = db.select()
        .from(schema.coinbaseMarketSnapshots)
        .where(eq(schema.coinbaseMarketSnapshots.productId, productId))
        .get();
      if (snapshot) break;
    }

    const priceSettled = await Promise.resolve(getCurrentPriceFast(input.assetId)).then(
      (data) => ({ status: "fulfilled" as const, data }),
      () => ({ status: "rejected" as const })
    );
    const historySettled = await Promise.resolve(getHistoricalPricesFast(input.assetId, "24h", quoteCurrency)).then(
      (data) => ({ status: "fulfilled" as const, data }),
      () => ({ status: "rejected" as const })
    );

    const historyPoints = historySettled.status === "fulfilled" ? historySettled.data.points : [];
    const values = historyPoints.map((point) => point.value).filter((value) => Number.isFinite(value));
    const high24h = values.length > 0 ? Math.max(...values) : null;
    const low24h = values.length > 0 ? Math.min(...values) : null;
    const currentPrice = (priceSettled.status === "fulfilled" ? finiteOrNull(priceSettled.data.price) : null)
      ?? finiteOrNull(snapshot?.price)
      ?? (historyPoints.length > 0 ? historyPoints[historyPoints.length - 1].value : null);
    const fetchedCandidates = [
      finiteOrNull(snapshot?.capturedAt),
      priceSettled.status === "fulfilled" ? finiteOrNull(priceSettled.data.fetchedAt) : null,
      historySettled.status === "fulfilled" ? finiteOrNull(historySettled.data.fetchedAt) : null,
    ].filter((value): value is number => value !== null);

    return MarketOverviewResultSchema.parse({
      price: currentPrice,
      change24h: finiteOrNull(snapshot?.pricePercentageChange24h) ?? pointChange(historyPoints),
      high24h,
      low24h,
      volume24h: finiteOrNull(snapshot?.volume24h),
      volumeChange24h: finiteOrNull(snapshot?.volumePercentageChange24h),
      marketCap: finiteOrNull(snapshot?.marketCap),
      dominance: null,
      fetchedAt: fetchedCandidates.length > 0 ? Math.max(...fetchedCandidates) : null,
      provider: priceSettled.status === "fulfilled" && priceSettled.data.provider !== "none" ? priceSettled.data.provider : snapshot ? "coinbase" : historySettled.status === "fulfilled" ? historySettled.data.provider : "local",
    });
  }));

  const GLOBAL_METRICS_TTL_MS = 60 * 60 * 1000;

  ipcMain.handle("market:get-fear-greed", withResult(async () => {
    return FearGreedResultSchema.parse(await fearGreedService.get());
  }));

  async function fetchGlobalMetrics() {
    return globalMetricsService.get();
  }

  ipcMain.handle("market:get-global-metrics", withResult(async () => {
    return GlobalMetricsResultSchema.parse(await fetchGlobalMetrics());
  }));

  ipcMain.handle("market:getCryptoControlIndex", withResult(async () => {
    const { classifyMarketPhase } = require("@crypto-control/market-data") as typeof import("@crypto-control/market-data");
    const [fearGreed, globalMetrics] = await Promise.all([fearGreedService.get(), fetchGlobalMetrics()]);
    const result = classifyMarketPhase({
      fearGreed: fearGreed.value,
      marketCapChangePercentage24h: globalMetrics.marketCapChangePercentage24h,
      btcDominance: globalMetrics.btcDominance,
      ethDominance: globalMetrics.ethDominance,
    });
    return CryptoControlIndexSchema.parse({ ...result, calculatedAt: Date.now() });
  }));

  function getCachedFearGreed(): number | null {
    return fearGreedService.getLastValidValue(60 * 60 * 1000);
  }

  function getCachedBtcDominance(): number | null {
    return globalMetricsService.getLastValid(GLOBAL_METRICS_TTL_MS * 2)?.btcDominance ?? null;
  }

  type MediaSignal = {
    assetId: string;
    score: number;
    confidence: "alta" | "media" | "baja";
    state: "live" | "cached" | "unavailable";
    sourceSummary: string[];
    headlines: string[];
    analystMentions: number;
    mediaItems: number;
    updatedAt: number;
  };

  const mediaSignalCache = new Map<string, { expiresAt: number; signal: MediaSignal }>();
  const MEDIA_SIGNAL_TTL_MS = 30 * 60 * 1000;

  function emptyMediaSignal(assetId: string, reason: string): MediaSignal {
    return {
      assetId,
      score: 0,
      confidence: "baja",
      state: "unavailable",
      sourceSummary: [reason],
      headlines: [],
      analystMentions: 0,
      mediaItems: 0,
      updatedAt: Date.now(),
    };
  }

  function scoreMediaItems(assetId: string, items: { title?: string; body?: string; source?: string }[]): MediaSignal {
    const positiveTerms = [
      "bullish", "rally", "surge", "upgrade", "outperform", "inflow", "adoption",
      "partnership", "accumulation", "breakout", "approval", "record inflows",
      "alcista", "subida", "acumulacion", "adopcion",
    ];
    const negativeTerms = [
      "bearish", "crash", "selloff", "sell-off", "downgrade", "outflow", "lawsuit",
      "hack", "exploit", "regulatory", "delist", "liquidation", "plunge",
      "bajista", "caida", "demanda", "salidas",
    ];
    const analystTerms = [
      "analyst", "analysts", "research", "report", "forecast", "predicts", "target",
      "glassnode", "cryptoquant", "coinshares", "messari", "santiment", "into the block",
      "analista", "analistas", "informe",
    ];

    let positive = 0;
    let negative = 0;
    let analystMentions = 0;
    const headlines: string[] = [];

    for (const item of items.slice(0, 20)) {
      const title = String(item.title ?? "").trim();
      const body = String(item.body ?? "").slice(0, 500);
      const text = `${title} ${body}`.toLowerCase();
      if (title && headlines.length < 4) headlines.push(title);
      for (const term of positiveTerms) if (text.includes(term)) positive += 1;
      for (const term of negativeTerms) if (text.includes(term)) negative += 1;
      for (const term of analystTerms) if (text.includes(term)) analystMentions += 1;
    }

    const mediaItems = items.length;
    const raw = mediaItems > 0 ? ((positive - negative) / Math.max(1, Math.min(mediaItems, 20))) * 100 : 0;
    const score = Math.max(-100, Math.min(100, Math.round(raw)));
    const confidence: MediaSignal["confidence"] =
      mediaItems >= 8 && analystMentions >= 2 ? "alta" :
      mediaItems >= 4 ? "media" : "baja";
    return {
      assetId,
      score,
      confidence,
      state: "live",
      sourceSummary: [
        `CryptoCompare News: ${mediaItems} titulares`,
        analystMentions > 0 ? `${analystMentions} menciones de analistas/informes` : "sin consenso de analistas detectado",
        `sesgo medios ${score > 15 ? "positivo" : score < -15 ? "negativo" : "neutral"}`,
      ],
      headlines,
      analystMentions,
      mediaItems,
      updatedAt: Date.now(),
    };
  }

  async function getMediaSignal(assetId: string): Promise<MediaSignal> {
    const key = assetId.toUpperCase();
    const cached = mediaSignalCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.signal, state: cached.signal.state === "live" ? "cached" : cached.signal.state };
    }

    try {
      const url = `https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=latest&categories=${encodeURIComponent(key)}`;
      const response = await withTimeout(fetch(url), 3500, `media:${key}`);
      if (!response || !response.ok) {
        const fallback = cached?.signal ?? emptyMediaSignal(key, "Medios/analistas no disponibles: fuente pública sin respuesta");
        return { ...fallback, state: cached ? "cached" : "unavailable" };
      }
      const json = await response.json() as { Data?: Array<{ title?: string; body?: string; source?: string; categories?: string }> };
      const items = Array.isArray(json.Data) ? json.Data : [];
      const signal = scoreMediaItems(key, items);
      mediaSignalCache.set(key, { expiresAt: Date.now() + MEDIA_SIGNAL_TTL_MS, signal });
      return signal;
    } catch (error) {
      const fallback = cached?.signal ?? emptyMediaSignal(key, error instanceof Error ? `Medios/analistas no disponibles: ${error.message}` : "Medios/analistas no disponibles");
      return { ...fallback, state: cached ? "cached" : "unavailable" };
    }
  }

  ipcMain.handle("sentiment:get-asset", withResult(async (_, input: { assetId: string; timeframe: string }) => {
    const timeframe = MarketSentimentTimeframeSchema.parse(input.timeframe);
    return MarketSentimentSchema.parse(await sentimentService.getAssetSentiment(input.assetId, timeframe, { fearGreedValue: getCachedFearGreed() }));
  }));

  ipcMain.handle("sentiment:get-global", withResult(async (_, input: { timeframe: string }) => {
    const timeframe = MarketSentimentTimeframeSchema.parse(input.timeframe);
    const assets = await db.select().from(schema.assets).all();
    const cryptoAssets = assets
      .filter((asset) => asset.type === "crypto")
      .map((asset) => ({ internalId: asset.id, symbol: asset.symbol }));
    return MarketSentimentSchema.parse(await sentimentService.getGlobalSentiment(cryptoAssets, timeframe, { fearGreedValue: getCachedFearGreed(), btcDominance: getCachedBtcDominance() }));
  }));

  ipcMain.handle("sentiment:get-history", withResult(async (_, input: { scope: "global" | "asset"; assetId?: string | null; timeframe: string; limit?: number }) => {
    const parsed = MarketSentimentHistoryRequestSchema.parse(input);
    const history = await sentimentService.getHistory({
      scope: parsed.scope,
      assetId: parsed.assetId,
      timeframe: parsed.timeframe,
      limit: parsed.limit,
    });
    return history.map((item) => MarketSentimentSchema.parse(item));
  }));

  ipcMain.handle("sentiment:refresh", withResult(async (_, input: { scope: "global" | "asset"; assetId?: string | null; timeframe: string }) => {
    const timeframe = MarketSentimentTimeframeSchema.parse(input.timeframe);
    if (input.scope === "asset") {
      if (!input.assetId) throw new Error("assetId requerido para sentimiento de activo.");
      return MarketSentimentSchema.parse(await sentimentService.getAssetSentiment(input.assetId, timeframe, { fearGreedValue: getCachedFearGreed() }));
    }

    const assets = await db.select().from(schema.assets).all();
    const cryptoAssets = assets
      .filter((asset) => asset.type === "crypto")
      .map((asset) => ({ internalId: asset.id, symbol: asset.symbol }));
    return MarketSentimentSchema.parse(await sentimentService.getGlobalSentiment(cryptoAssets, timeframe, { fearGreedValue: getCachedFearGreed(), btcDominance: getCachedBtcDominance() }));
  }));

  ipcMain.handle("settings:get", withResult(async (_, key: string) => {
    const db = getDb();
    const rows = await db.select().from(schema.settings).where(eq(schema.settings.key, key)).limit(1);
    return rows.length > 0 ? rows[0].value : null;
  }));

  ipcMain.handle("settings:update", withResult(async (_, key: string, value: string) => {
    const db = getDb();
    await db.insert(schema.settings).values({ key, value })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: { value }
      });
    return null;
  }));

  // --- INVESTMENT PLAN ---
  ipcMain.handle("investmentPlan:list", withResult(async () => {
    const db = getDb();
    return db.select()
      .from(schema.investmentPlans)
      .orderBy(asc(schema.investmentPlans.createdAt))
      .all()
      .map(mapInvestmentPlan);
  }));

  ipcMain.handle("investmentPlan:getActive", withResult(async () => {
    const db = getDb();
    const row = db.select()
      .from(schema.investmentPlans)
      .where(eq(schema.investmentPlans.status, "active"))
      .orderBy(asc(schema.investmentPlans.createdAt))
      .get();
    return row ? mapInvestmentPlan(row) : null;
  }));

  ipcMain.handle("investmentPlan:create", withResult(async (_, payload) => {
    const data = CreateInvestmentPlanSchema.parse(payload);
    const now = Date.now();
    const id = crypto.randomUUID();
    if ((data.status ?? "active") === "active") {
      db.update(schema.investmentPlans)
        .set({ status: "inactive", updatedAt: now })
        .where(eq(schema.investmentPlans.status, "active"))
        .run();
    }
    db.insert(schema.investmentPlans).values({
      id,
      name: data.name,
      description: data.description ?? null,
      status: data.status ?? "active",
      baseCurrency: data.baseCurrency ?? "EUR",
      notes: data.notes ?? null,
      createdAt: now,
      updatedAt: now,
    }).run();
    return { id };
  }));

  ipcMain.handle("investmentPlan:update", withResult(async (_, id: string, payload) => {
    const data = UpdateInvestmentPlanSchema.parse(payload);
    const update: Partial<typeof schema.investmentPlans.$inferInsert> = { updatedAt: Date.now() };
    if (data.status === "active") {
      db.update(schema.investmentPlans)
        .set({ status: "inactive", updatedAt: update.updatedAt })
        .where(eq(schema.investmentPlans.status, "active"))
        .run();
    }
    if (data.name !== undefined) update.name = data.name;
    if (data.description !== undefined) update.description = data.description ?? null;
    if (data.status !== undefined) update.status = data.status;
    if (data.baseCurrency !== undefined) update.baseCurrency = data.baseCurrency;
    if (data.notes !== undefined) update.notes = data.notes ?? null;

    db.update(schema.investmentPlans).set(update).where(eq(schema.investmentPlans.id, id)).run();
    const row = db.select().from(schema.investmentPlans).where(eq(schema.investmentPlans.id, id)).get();
    if (!row) throw new Error(`Plan de inversión ${id} no encontrado.`);
    return mapInvestmentPlan(row);
  }));

  ipcMain.handle("investmentPlan:delete", withResult(async (_, id: string) => {
    const db = getDb();
    db.delete(schema.investmentPlans).where(eq(schema.investmentPlans.id, id)).run();
    return null;
  }));

  // --- INVESTMENT CYCLES ---
  ipcMain.handle("investmentCycles:list", withResult(async (_, input?: { planId?: string }) => {
    const db = getDb();
    const query = db.select().from(schema.investmentCycles);
    const rows = input?.planId
      ? query.where(eq(schema.investmentCycles.planId, input.planId)).orderBy(asc(schema.investmentCycles.startDate), asc(schema.investmentCycles.priority)).all()
      : query.orderBy(asc(schema.investmentCycles.startDate), asc(schema.investmentCycles.priority)).all();
    return rows.map(mapInvestmentCycle);
  }));

  ipcMain.handle("investmentCycles:getCurrent", withResult(async (_, input?: { planId?: string; at?: number }) => {
    const at = input?.at ?? Date.now();
    const planId = input?.planId
      ?? db.select().from(schema.investmentPlans).where(eq(schema.investmentPlans.status, "active")).get()?.id;
    if (!planId) return null;
    const rows = db.select()
      .from(schema.investmentCycles)
      .where(eq(schema.investmentCycles.planId, planId))
      .orderBy(desc(schema.investmentCycles.startDate), asc(schema.investmentCycles.priority))
      .all();
    const row = rows.find((cycle) => cycle.status === "active" && cycle.startDate <= at && (cycle.endDate === null || cycle.endDate >= at));
    return row ? mapInvestmentCycle(row) : null;
  }));

  ipcMain.handle("investmentCycles:create", withResult(async (_, payload) => {
    const data = CreateInvestmentCycleSchema.parse(payload);
    const now = Date.now();
    const id = crypto.randomUUID();
    const row = {
      id,
      planId: data.planId,
      name: data.name,
      startDate: data.startDate,
      endDate: data.endDate ?? null,
      monthlyAmountEur: data.monthlyAmountEur,
      contributionCurrency: data.contributionCurrency ?? "EUR",
      status: data.status ?? "planned",
      priority: data.priority ?? 0,
      objetivo: data.objetivo ?? null,
      riesgo: data.riesgo ?? null,
      allowExtraContributions: data.allowExtraContributions !== false ? 1 : 0,
      notes: data.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    assertInvestmentCycleRules(row, []);
    db.insert(schema.investmentCycles).values(row).run();
    return { id };
  }));

  ipcMain.handle("investmentCycles:update", withResult(async (_, id: string, payload) => {
    const data = UpdateInvestmentCycleSchema.parse(payload);
    const existing = getInvestmentCycleOrThrow(id);
    const update: Partial<typeof schema.investmentCycles.$inferInsert> = { updatedAt: Date.now() };
    if (data.planId !== undefined) update.planId = data.planId;
    if (data.name !== undefined) update.name = data.name;
    if (data.startDate !== undefined) update.startDate = data.startDate;
    if (data.endDate !== undefined) update.endDate = data.endDate ?? null;
    if (data.monthlyAmountEur !== undefined) update.monthlyAmountEur = data.monthlyAmountEur;
    if (data.contributionCurrency !== undefined) update.contributionCurrency = data.contributionCurrency;
    if (data.status !== undefined) update.status = data.status;
    if (data.priority !== undefined) update.priority = data.priority;
    if (data.objetivo !== undefined) update.objetivo = data.objetivo ?? null;
    if (data.riesgo !== undefined) update.riesgo = data.riesgo ?? null;
    if (data.allowExtraContributions !== undefined) update.allowExtraContributions = data.allowExtraContributions ? 1 : 0;
    if (data.notes !== undefined) update.notes = data.notes ?? null;

    const nextRow = { ...existing, ...update };
    assertInvestmentCycleRules(nextRow);
    db.update(schema.investmentCycles).set(update).where(eq(schema.investmentCycles.id, id)).run();
    const row = db.select().from(schema.investmentCycles).where(eq(schema.investmentCycles.id, id)).get();
    if (!row) throw new Error(`Ciclo de inversión ${id} no encontrado.`);
    return mapInvestmentCycle(row);
  }));

  ipcMain.handle("investmentCycles:delete", withResult(async (_, id: string) => {
    const db = getDb();
    db.delete(schema.investmentCycles).where(eq(schema.investmentCycles.id, id)).run();
    return null;
  }));

  ipcMain.handle("investmentCycles:getMetrics", withResult(async (_, input: { cycleId: string }) => {
    const db = getDb();
    const { computeCycleMetrics, filterTransactionsForCycle } = require("@crypto-control/portfolio") as typeof import("@crypto-control/portfolio");
    const cycleRow = db.select().from(schema.investmentCycles).where(eq(schema.investmentCycles.id, input.cycleId)).get();
    if (!cycleRow) throw new Error(`Ciclo de inversión ${input.cycleId} no encontrado.`);
    const cycle = mapInvestmentCycle(cycleRow);

    const repo = new DatabasePortfolioRepository(db);
    const allTransactions = await repo.getTransactions();
    const now = Date.now();
    const cycleTransactions = filterTransactionsForCycle(allTransactions, cycle, now);

    const assetIds = Array.from(new Set(cycleTransactions.flatMap((tx) => tx.legs.map((leg) => leg.assetId))));
    const prices: Record<string, number | null> = {};
    for (const assetId of assetIds) {
      const result = await marketService.getCurrentPriceEur(assetId);
      prices[assetId] = result.price;
    }

    const metrics = computeCycleMetrics(cycle, cycleTransactions, prices, now);
    return CycleMetricsSchema.parse(metrics);
  }));

  ipcMain.handle("investmentCycles:listPartialSales", withResult(async (_, input?: { cycleId?: string }) => {
    const db = getDb();
    const query = db.select().from(schema.cyclePartialSales);
    const rows = input?.cycleId
      ? query.where(eq(schema.cyclePartialSales.cycleId, input.cycleId)).orderBy(desc(schema.cyclePartialSales.date)).all()
      : query.orderBy(desc(schema.cyclePartialSales.date)).all();
    return rows.map((row) => PartialSaleSchema.parse(row));
  }));

  // Una venta parcial nunca crea dinero nuevo: siempre referencia una
  // operación "sell" ya registrada en Operaciones. assetId y date se derivan
  // de esa operación, no se aceptan del cliente, para que no puedan divergir.
  ipcMain.handle("investmentCycles:createPartialSale", withResult(async (_, payload) => {
    const db = getDb();
    const data = CreatePartialSaleSchema.parse(payload);
    const tx = db.select().from(schema.transactions).where(eq(schema.transactions.id, data.transactionId)).get();
    if (!tx) throw new Error(`Operación ${data.transactionId} no encontrada.`);
    if (tx.type !== "sell") throw new Error("Una venta parcial debe referenciar una operación de tipo venta.");
    const sourceLeg = db.select().from(schema.transactionLegs)
      .where(and(eq(schema.transactionLegs.transactionId, data.transactionId), eq(schema.transactionLegs.legType, "source")))
      .get();
    if (!sourceLeg) throw new Error("La operación de venta no tiene un leg de origen.");

    const now = Date.now();
    const id = crypto.randomUUID();
    db.insert(schema.cyclePartialSales).values({
      id,
      cycleId: data.cycleId,
      transactionId: data.transactionId,
      assetId: sourceLeg.assetId,
      percentageOfHolding: data.percentageOfHolding,
      proceedsEur: data.proceedsEur,
      date: tx.date,
      notes: data.notes ?? null,
      createdAt: now,
    }).run();
    return { id };
  }));

  ipcMain.handle("investmentCycles:deletePartialSale", withResult(async (_, id: string) => {
    const db = getDb();
    db.delete(schema.cyclePartialSales).where(eq(schema.cyclePartialSales.id, id)).run();
    return null;
  }));

  // --- INVESTMENT ASSETS ---
  ipcMain.handle("investmentAssets:list", withResult(async (_, input?: { cycleId?: string }) => {
    const db = getDb();
    const query = db.select().from(schema.investmentAssets);
    const rows = input?.cycleId
      ? query.where(eq(schema.investmentAssets.cycleId, input.cycleId)).orderBy(asc(schema.investmentAssets.priority), asc(schema.investmentAssets.startDate)).all()
      : query.orderBy(asc(schema.investmentAssets.priority), asc(schema.investmentAssets.startDate)).all();
    return rows.map(mapInvestmentAsset);
  }));

  ipcMain.handle("investmentAssets:create", withResult(async (_, payload) => {
    const data = CreateInvestmentAssetSchema.parse(payload);
    const now = Date.now();
    const id = crypto.randomUUID();
    const allocationType = data.allocationType ?? (data.fixedAmountEur !== null && data.fixedAmountEur !== undefined && (data.allocationPercentage === null || data.allocationPercentage === undefined) ? "amount" : "percentage");
    const allocationPercentage = data.allocationPercentage ?? (allocationType === "percentage" ? data.allocationValue ?? 0 : null);
    const fixedAmountEur = data.fixedAmountEur ?? (allocationType === "amount" ? data.allocationValue ?? 0 : null);
    const allocationValue = data.allocationValue ?? (allocationType === "percentage" ? allocationPercentage ?? 0 : fixedAmountEur ?? 0);
    const status = data.status ?? (data.isActive === false ? "paused" : "active");
    const row = {
      id,
      cycleId: data.cycleId,
      assetId: data.assetId,
      allocationType,
      allocationValue,
      allocationPercentage,
      fixedAmountEur,
      priority: data.priority ?? 0,
      targetAmount: data.targetAmount ?? null,
      targetValueEur: data.targetValueEur ?? null,
      targetPortfolioPercentage: data.targetPortfolioPercentage ?? null,
      startDate: data.startDate,
      endDate: data.endDate ?? null,
      status,
      isActive: status === "active" ? 1 : 0,
      notes: data.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    assertInvestmentAssetRules(data.cycleId, row);
    db.insert(schema.investmentAssets).values(row).run();
    return { id };
  }));

  ipcMain.handle("investmentAssets:update", withResult(async (_, id: string, payload) => {
    const data = UpdateInvestmentAssetSchema.parse(payload);
    const existing = getInvestmentAssetOrThrow(id);
    const update: Partial<typeof schema.investmentAssets.$inferInsert> = { updatedAt: Date.now() };
    if (data.cycleId !== undefined) update.cycleId = data.cycleId;
    if (data.assetId !== undefined) update.assetId = data.assetId;
    if (data.allocationType !== undefined) update.allocationType = data.allocationType;
    if (data.allocationValue !== undefined) update.allocationValue = data.allocationValue;
    if (data.allocationPercentage !== undefined) update.allocationPercentage = data.allocationPercentage ?? null;
    if (data.fixedAmountEur !== undefined) update.fixedAmountEur = data.fixedAmountEur ?? null;
    if (data.priority !== undefined) update.priority = data.priority;
    if (data.targetAmount !== undefined) update.targetAmount = data.targetAmount ?? null;
    if (data.targetValueEur !== undefined) update.targetValueEur = data.targetValueEur ?? null;
    if (data.targetPortfolioPercentage !== undefined) update.targetPortfolioPercentage = data.targetPortfolioPercentage ?? null;
    if (data.startDate !== undefined) update.startDate = data.startDate;
    if (data.endDate !== undefined) update.endDate = data.endDate ?? null;
    if (data.status !== undefined) {
      update.status = data.status;
      update.isActive = data.status === "active" ? 1 : 0;
    } else if (data.isActive !== undefined) {
      update.isActive = data.isActive ? 1 : 0;
      update.status = data.isActive ? "active" : "paused";
    }
    if (data.notes !== undefined) update.notes = data.notes ?? null;

    const nextRow = { ...existing, ...update };
    assertInvestmentAssetRules(nextRow.cycleId, nextRow, id);
    if (nextRow.cycleId !== existing.cycleId) {
      assertInvestmentCycleRules(getInvestmentCycleOrThrow(existing.cycleId), getInvestmentAssetRuleRows(existing.cycleId).filter((row) => row.id !== id));
    }
    db.update(schema.investmentAssets).set(update).where(eq(schema.investmentAssets.id, id)).run();
    const row = db.select().from(schema.investmentAssets).where(eq(schema.investmentAssets.id, id)).get();
    if (!row) throw new Error(`Activo de plan ${id} no encontrado.`);
    return mapInvestmentAsset(row);
  }));

  async function updateInvestmentAssetState(id: string, payload: unknown, status: "paused" | "closed") {
    const data = InvestmentAssetStateChangeSchema.parse(payload ?? {});
    const existing = getInvestmentAssetOrThrow(id);
    const effectiveDate = data.effectiveDate ?? Date.now();
    if (effectiveDate < existing.startDate) {
      throw new Error("La fecha efectiva no puede ser anterior al inicio de la moneda.");
    }
    const update: Partial<typeof schema.investmentAssets.$inferInsert> = {
      status,
      isActive: 0,
      endDate: effectiveDate,
      updatedAt: Date.now(),
    };
    if (data.notes !== undefined) update.notes = data.notes ?? null;
    db.update(schema.investmentAssets).set(update).where(eq(schema.investmentAssets.id, id)).run();
    const row = getInvestmentAssetOrThrow(id);
    return mapInvestmentAsset(row);
  }

  ipcMain.handle("investmentAssets:pause", withResult(async (_, id: string, payload?: unknown) => {
    return updateInvestmentAssetState(id, payload, "paused");
  }));

  ipcMain.handle("investmentAssets:close", withResult(async (_, id: string, payload?: unknown) => {
    return updateInvestmentAssetState(id, payload, "closed");
  }));

  ipcMain.handle("investmentAssets:markGoalReached", withResult(async (_, id: string, payload: unknown) => {
    const { MarkGoalReachedInputSchema } = await import("@crypto-control/core") as typeof import("@crypto-control/core");
    const parsed = MarkGoalReachedInputSchema.safeParse(payload);
    if (!parsed.success) throw new Error("Datos inválidos: " + parsed.error.message);
    const data = parsed.data;

    const db = getDb();
    const assetRow = db.select().from(schema.investmentAssets).where(eq(schema.investmentAssets.id, id)).get();
    if (!assetRow) throw new Error("Activo no encontrado");

    const asset = mapInvestmentAsset(assetRow);
    if (asset.targetAmount === null && asset.targetValueEur === null && asset.targetPortfolioPercentage === null) {
      throw new Error("Este activo no tiene un objetivo configurado");
    }

    const cycleRow = db.select().from(schema.investmentCycles).where(eq(schema.investmentCycles.id, asset.cycleId)).get();
    if (!cycleRow) throw new Error("Etapa no encontrada");

    const now = Date.now();

    db.update(schema.investmentAssets).set({
      status: "goal_reached",
      isActive: 0,
      endDate: data.effectiveDate,
      goalReachedAt: data.effectiveDate,
      goalReachedValue: data.observedValue,
      goalReachedType: data.goalType,
      updatedAt: now,
    }).where(eq(schema.investmentAssets.id, id)).run();

    if (data.redistribution && data.redistribution.length > 0) {
      for (const r of data.redistribution) {
        db.update(schema.investmentAssets).set({
          allocationValue: r.newAllocationValue,
          allocationPercentage: r.newAllocationPercentage,
          updatedAt: now,
        }).where(eq(schema.investmentAssets.id, r.investmentAssetId)).run();
      }
    }

    const { calculateReleasedAllocation, buildGoalReachedRevisionInput } = require("@crypto-control/portfolio") as typeof import("@crypto-control/portfolio");
    const releasedAmountEur = calculateReleasedAllocation(asset, cycleRow.monthlyAmountEur);
    const redistributions = (data.redistribution ?? []).map((r: { investmentAssetId: string; newAllocationValue: number; newAllocationPercentage: number | null }) => ({
      investmentAssetId: r.investmentAssetId,
      previousAllocationValue: 0,
      previousAllocationPercentage: null,
      newAllocationValue: r.newAllocationValue,
      newAllocationPercentage: r.newAllocationPercentage,
    }));
    const revisionInput = buildGoalReachedRevisionInput(
      asset,
      data.goalType,
      data.observedValue,
      releasedAmountEur,
      redistributions,
      data.effectiveDate,
    );

    db.insert(schema.strategyRevisions).values({
      id: crypto.randomUUID(),
      cycleId: revisionInput.cycleId,
      effectiveDate: revisionInput.effectiveDate,
      title: revisionInput.title,
      notes: revisionInput.notes,
      changesJson: revisionInput.changesJson,
      createdAt: now,
    }).run();

    const updated = db.select().from(schema.investmentAssets).where(eq(schema.investmentAssets.id, id)).get();
    if (!updated) throw new Error("Error al recuperar el activo actualizado");
    return mapInvestmentAsset(updated);
  }));

  ipcMain.handle("investmentAssets:reactivate", withResult(async (_, id: string) => {
    const db = getDb();
    const now = Date.now();
    db.update(schema.investmentAssets).set({
      status: "active",
      isActive: 1,
      endDate: null,
      goalReachedAt: null,
      goalReachedValue: null,
      goalReachedType: null,
      updatedAt: now,
    }).where(eq(schema.investmentAssets.id, id)).run();
    const updated = db.select().from(schema.investmentAssets).where(eq(schema.investmentAssets.id, id)).get();
    if (!updated) throw new Error("Activo no encontrado");
    return mapInvestmentAsset(updated);
  }));

  ipcMain.handle("investmentAssets:delete", withResult(async (_, id: string) => {
    const db = getDb();
    db.delete(schema.investmentAssets).where(eq(schema.investmentAssets.id, id)).run();
    return null;
  }));

  ipcMain.handle("investmentAssets:getHealth", withResult(async (_, input: { assetId: string }) => {
    const db = getDb();
    const { assessAssetHealth } = require("@crypto-control/market-data") as typeof import("@crypto-control/market-data");

    const latestAssignment = db.select().from(schema.investmentAssets)
      .where(eq(schema.investmentAssets.assetId, input.assetId))
      .orderBy(desc(schema.investmentAssets.startDate))
      .limit(1)
      .get();
    const isRetiredFromStrategy = latestAssignment?.status === "closed";

    const fearGreedValue = getCachedFearGreed();
    const [assetSentiment, btcSentiment] = await Promise.all([
      sentimentService.getAssetSentiment(input.assetId, "30d", { fearGreedValue }).catch(() => null),
      input.assetId === "BTC" ? Promise.resolve(null) : sentimentService.getAssetSentiment("BTC", "30d", { fearGreedValue }).catch(() => null),
    ]);

    const result = assessAssetHealth({ assetSentiment, btcSentiment, isRetiredFromStrategy });
    return AssetHealthResultSchema.parse(result);
  }));

  // --- STRATEGY REVISIONS ---
  ipcMain.handle("strategyRevisions:list", withResult(async (_, input?: { cycleId?: string }) => {
    const db = getDb();
    const query = db.select().from(schema.strategyRevisions);
    const rows = input?.cycleId
      ? query.where(eq(schema.strategyRevisions.cycleId, input.cycleId)).orderBy(asc(schema.strategyRevisions.effectiveDate)).all()
      : query.orderBy(asc(schema.strategyRevisions.effectiveDate)).all();
    return rows.map(mapStrategyRevision);
  }));

  ipcMain.handle("strategyRevisions:create", withResult(async (_, payload) => {
    const data = CreateStrategyRevisionSchema.parse(payload);
    const changesJson = data.changesJson ?? "{}";
    JSON.parse(changesJson);
    const id = crypto.randomUUID();
    db.insert(schema.strategyRevisions).values({
      id,
      cycleId: data.cycleId,
      effectiveDate: data.effectiveDate,
      title: data.title,
      notes: data.notes ?? null,
      changesJson,
      createdAt: Date.now(),
    }).run();
    return { id };
  }));

  // --- TREASURY ---
  ipcMain.handle("treasury:getSummary", withResult(async () => {
    return TreasurySummarySchema.parse(getTreasuryRepository().getSummary(getRecommendedFiscalReserve(), getCoinbaseEurcBalance()));
  }));

  ipcMain.handle("treasury:listMovements", withResult(async () => {
    return getTreasuryRepository().listMovements().map((row) => TreasuryMovementSchema.parse(mapTreasuryMovement(row)));
  }));

  ipcMain.handle("treasury:createMovement", withResult(async (_, payload) => {
    const data = CreateTreasuryMovementSchema.parse(payload);
    return getTreasuryRepository().createMovement(data);
  }));

  ipcMain.handle("treasury:updateMovement", withResult(async (_, id: string, payload) => {
    const data = UpdateTreasuryMovementSchema.parse(payload);
    const row = getTreasuryRepository().updateMovement(id, data);
    if (!row) throw new Error(`Movimiento de tesorería ${id} no encontrado.`);
    return TreasuryMovementSchema.parse(mapTreasuryMovement(row));
  }));

  ipcMain.handle("treasury:deleteMovement", withResult(async (_, id: string) => {
    getTreasuryRepository().deleteMovement(id);
    return null;
  }));

  ipcMain.handle("treasury:setFiscalReserve", withResult(async (_, payload) => {
    const data = SetFiscalReserveSchema.parse(payload);
    getTreasuryRepository().setFiscalReserve(data.amountEur, data.notes);
    return TreasurySummarySchema.parse(getTreasuryRepository().getSummary(getRecommendedFiscalReserve(), getCoinbaseEurcBalance()));
  }));

  ipcMain.handle("treasury:allocateEurcToRebuy", withResult(async (_, payload) => {
    const data = AllocateEurcToRebuySchema.parse(payload);
    return getTreasuryRepository().allocateEurcToRebuy(data, getCoinbaseEurcBalance());
  }));

  ipcMain.handle("treasury:allocateCashToRebuy", withResult(async (_, payload) => {
    const data = AllocateCashToRebuySchema.parse(payload);
    return getTreasuryRepository().allocateCashToRebuy(data);
  }));

  ipcMain.handle("treasury:listCycleLiquidity", withResult(async (_, input?: { cycleId?: string; status?: "reserved" | "used" | "released" }) => {
    const rows = getTreasuryRepository().listCycleLiquidity(input ?? {});
    return rows.map((row) => CycleLiquidityAllocationSchema.parse(row));
  }));

  ipcMain.handle("treasury:listFiscalReserveMovements", withResult(async (_, input?: { realizedGainIds?: string[] }) => {
    const rows = getTreasuryRepository().listFiscalReserveMovements(input ?? {});
    return rows.map((row) => FiscalReserveMovementSchema.parse(row));
  }));

  // --- TARGETS ---
  ipcMain.handle("targets:list", withResult(async () => {
    const db = getDb();
    return db.select().from(schema.targets).all();
  }));

  ipcMain.handle("targets:upsert", withResult(async (_, data: { id?: string; assetId: string; targetPriceEur: number }) => {
    const db = getDb();
    const id = data.id ?? crypto.randomUUID();
    db.insert(schema.targets)
      .values({ id, assetId: data.assetId, targetPriceEur: data.targetPriceEur })
      .onConflictDoUpdate({ target: schema.targets.id, set: { targetPriceEur: data.targetPriceEur } })
      .run();
    return { id };
  }));

  ipcMain.handle("targets:delete", withResult(async (_, id: string) => {
    const db = getDb();
    db.delete(schema.targets).where(eq(schema.targets.id, id)).run();
    return null;
  }));

  // --- ALERTS ---
  ipcMain.handle("alerts:list", withResult(async () => {
    const db = getDb();
    const rows = db.select().from(schema.alerts).all();
    return rows.map((row) => ({
      id: row.id,
      assetId: row.assetId,
      priceThreshold: row.priceThreshold,
      direction: row.direction as "above" | "below",
      isActive: row.isActive === 1,
    }));
  }));

  ipcMain.handle("alerts:create", withResult(async (_, data: { assetId: string; priceThreshold: number; direction: "above" | "below" }) => {
    const db = getDb();
    const id = crypto.randomUUID();
    db.insert(schema.alerts)
      .values({ id, assetId: data.assetId, priceThreshold: data.priceThreshold, direction: data.direction, isActive: 1 })
      .run();
    return { id };
  }));

  ipcMain.handle("alerts:delete", withResult(async (_, id: string) => {
    const db = getDb();
    db.delete(schema.alerts).where(eq(schema.alerts.id, id)).run();
    return null;
  }));

  ipcMain.handle("alerts:toggle", withResult(async (_, id: string) => {
    const db = getDb();
    const current = db.select().from(schema.alerts).where(eq(schema.alerts.id, id)).get();
    if (!current) throw new Error(`Alerta ${id} no encontrada.`);
    db.update(schema.alerts)
      .set({ isActive: current.isActive === 1 ? 0 : 1 })
      .where(eq(schema.alerts.id, id))
      .run();
    return null;
  }));

  // Coinbase sync handlers
  const {
    CoinbaseCredentialsManager,
    CoinbaseClient,
    CoinbaseApiError,
    CoinbaseSyncService,
    CoinbasePortfolioService,
    parseCdpJson,
  } = require("@crypto-control/coinbase-sync") as typeof import("@crypto-control/coinbase-sync");

  const credsMgr = new CoinbaseCredentialsManager();

  /**
   * Sequence: parse JSON → validate EC P-256 → GET key_permissions → check can_view
   *           → GET accounts → save to Keychain (ONLY if both API calls succeed).
   * Never saves credentials before verifying them.
   */
  async function importCdpCredentials(jsonContent: string) {
    // Step 1-3: Parse + validate key format and curve
    const parsed = parseCdpJson(jsonContent); // throws CdpParseError on any structural issue

    const client = new CoinbaseClient(parsed.keyName, parsed.privateKeyPem);

    // Step 4-5: GET key_permissions — verifies JWT signature + checks can_view
    let permissions = { canView: true, canTrade: false, canTransfer: false };
    try {
      const perms = await client.getKeyPermissions();

      if (!perms.can_view) {
        throw new CoinbaseApiError(
          "INSUFFICIENT_PERMISSIONS",
          "La clave no tiene permiso de lectura (can_view = false). Crea una clave CDP con el permiso View activado.",
          403
        );
      }

      permissions = {
        canView:     perms.can_view,
        canTrade:    perms.can_trade,
        canTransfer: perms.can_transfer,
      };
    } catch (e) {
      if (e instanceof CoinbaseApiError) throw e;
      // If key_permissions endpoint returns an unexpected error, re-throw as a network error
      throw new CoinbaseApiError(
        "NETWORK_ERROR",
        `No se pudo verificar los permisos de la clave: ${(e as Error).message ?? "error desconocido"}.`
      );
    }

    // Step 6: GET accounts — secondary verification (confirms read access to portfolio)
    await client.getAccounts();

    // Step 7: Save to Keychain ONLY after both API calls succeed
    credsMgr.saveCredentials({
      apiKeyName:     parsed.keyName,
      privateKeyPem:  parsed.privateKeyPem,
      algorithm:      parsed.algorithm,
      keyDisplayName: parsed.keyDisplayName,
    });
    savePermissions(permissions);

    return {
      connected:      true,
      canceled:       false,
      keyDisplayName: parsed.keyDisplayName,
      algorithm:      parsed.algorithm,
      permissions,
    };
  }

  ipcMain.handle("coinbase:import-credentials-file", withResult(async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
      title: "Seleccionar credenciales de Coinbase CDP",
      properties: ["openFile"],
      filters: [{ name: "Credenciales Coinbase CDP", extensions: ["json"] }],
    });

    if (canceled || !filePaths[0]) {
      return {
        connected: false, canceled: true, keyDisplayName: "",
        algorithm: "ES256" as const,
        permissions: { canView: false, canTrade: false, canTransfer: false },
      };
    }

    const jsonContent = fs.readFileSync(filePaths[0], "utf8");
    // jsonContent goes out of scope after this call — key not held in main process memory
    return await importCdpCredentials(jsonContent);
  }));

  ipcMain.handle("coinbase:connect-from-json", withResult(async (_, jsonContent: string) => {
    if (typeof jsonContent !== "string" || !jsonContent.trim()) {
      throw new CoinbaseApiError("INVALID_JSON", "No se recibió contenido JSON.");
    }
    // jsonContent goes out of scope after this call
    return await importCdpCredentials(jsonContent);
  }));

  ipcMain.handle("coinbase:connect", withResult(async (_, creds: { apiKeyName: string; privateKeyPem: string }) => {
    if (!creds?.apiKeyName || !creds?.privateKeyPem) {
      throw new Error("Se requieren apiKeyName y privateKeyPem");
    }
    const client = new CoinbaseClient(creds.apiKeyName, creds.privateKeyPem);
    await client.testConnection();
    credsMgr.saveCredentials(creds);
    let connectPerms = { canView: true, canTrade: false, canTransfer: false };
    try {
      const p = await client.getKeyPermissions();
      connectPerms = { canView: p.can_view, canTrade: p.can_trade, canTransfer: p.can_transfer };
    } catch { /* best-effort: permissions stored on next successful import */ }
    savePermissions(connectPerms);
    return { connected: true };
  }));

  ipcMain.handle("coinbase:disconnect", withResult(async () => {
    credsMgr.deleteCredentials();
    clearPermissions();
    return null;
  }));

  ipcMain.handle("coinbase:get-status", withResult(async () => {
    const connected = credsMgr.hasCredentials();
    const keyInfo = connected ? credsMgr.getKeyInfo() : null;
    const syncStatus = readSyncStatus();
    const { permissions, lastValidationAt } = connected
      ? readPermissions()
      : { permissions: null, lastValidationAt: null };

    return {
      connected,
      ...syncStatus,
      keyDisplayName: keyInfo?.keyDisplayName ?? null,
      algorithm:      keyInfo?.algorithm      ?? null,
      credentialType: connected ? "Clave CDP" : null,
      keychainStatus: connected ? "stored" : "missing",
      lastValidationAt,
      permissions,
    };
  }));

  type OperationType = "buy" | "sell" | "convert" | "rebuy";
  type OperationMode = "simulation" | "real";
  type CoinbaseTradeInput = {
    operationType?: OperationType;
    mode?: OperationMode;
    productId?: string;
    assetId?: string;
    fromAssetId?: string;
    toAssetId?: string;
    side?: "BUY" | "SELL";
    quoteAmountEur?: number;
    quoteAmount?: number;
    baseAmount?: number;
    previewId?: string | null;
    previewToken?: string | null;
    confirmationText?: string;
  };
  type CoinbaseOrderRequest = {
    product_id: string;
    side: "BUY" | "SELL";
    order_configuration: {
      market_market_ioc: {
        quote_size?: string;
        base_size?: string;
      };
    };
  };
  type CoinbaseOrderPreview = Record<string, unknown> & {
    preview_id?: string;
    order_total?: unknown;
    commission_total?: unknown;
    base_size?: unknown;
    quote_size?: unknown;
    slippage?: unknown;
  };
  type CoinbaseCreateOrder = CoinbaseOrderRequest & {
    client_order_id: string;
    preview_id?: string;
  };
  type CoinbaseOrderResult = {
    success?: boolean;
    success_response?: { order_id?: string };
    error_response?: { message?: string; error_details?: string; error?: string };
    order_id?: string;
  };
  type CoinbaseOperationClient = {
    getProduct(productId: string): Promise<{ trading_disabled?: boolean; cancel_only?: boolean; view_only?: boolean }>;
    previewOrder(request: CoinbaseOrderRequest): Promise<CoinbaseOrderPreview>;
    createOrder(request: CoinbaseCreateOrder): Promise<CoinbaseOrderResult>;
    getOrder(orderId: string): Promise<unknown>;
  };
  type OperationRouteStep = {
    id: string;
    label: string;
    productId: string;
    side: "BUY" | "SELL";
    request: CoinbaseOrderRequest;
    sourceAsset: string;
    destinationAsset: string;
    preview: CoinbaseOrderPreview | Record<string, unknown>;
    clientOrderId: string;
  };
  type StoredOperationPreview = {
    token: string;
    operationType: OperationType;
    mode: OperationMode;
    routeType: "direct" | "multi_step";
    sourceAsset: string;
    destinationAsset: string;
    fundingSource: "EUR" | "EURC libre" | "Cripto";
    generatedAt: number;
    expiresAt: number;
    submittedAt: number | null;
    input: CoinbaseTradeInput;
    route: OperationRouteStep[];
    balances: Record<string, number>;
    warnings: string[];
    costAnalysis: ReturnType<typeof analyzeCoinbaseCosts>;
  };
  type SubmittedOrderRecord = {
    id: string;
    token: string;
    operationType: OperationType;
    submittedAt: number;
    routeType: string;
    orders: CoinbaseOrderResult[];
  };
  type ScheduledCondition = {
    type: "price_lte" | "price_gte";
    assetId: string;
    value: number;
  };
  type ScheduledOperationRecord = {
    id: string;
    operationType: OperationType;
    mode: "review";
    status: "programada_revision" | "condicion_cumplida" | "cancelada";
    createdAt: number;
    plannedAt: number | null;
    frequency: string;
    maxExecutions: number | null;
    input: CoinbaseTradeInput;
    note: string;
    condicion?: ScheduledCondition;
  };

  const PREVIEW_EXPIRY_MS = 90_000;
  const PREVIEW_SETTINGS_KEY = "coinbase:operation-previews";
  const SUBMITTED_SETTINGS_KEY = "coinbase:submitted-orders";
  const SCHEDULED_SETTINGS_KEY = "coinbase:scheduled-operations";

  function getSettingValue(key: string): string | null {
    return db.select().from(schema.settings).where(eq(schema.settings.key, key)).get()?.value ?? null;
  }

  function setSettingValue(key: string, value: string): void {
    db.insert(schema.settings).values({ key, value })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
      .run();
  }

  function readJsonSetting<T>(key: string, fallback: T): T {
    const raw = getSettingValue(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  function writeJsonSetting<T>(key: string, value: T): void {
    setSettingValue(key, JSON.stringify(value));
  }

  function normalizeAssetId(value: unknown): string {
    return String(value ?? "").trim().toUpperCase();
  }

  function finitePositive(value: unknown, label: string): number {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${label} debe ser mayor que cero.`);
    return n;
  }

  function numberFromCoinbaseMoney(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    if (value && typeof value === "object" && "value" in value) {
      const n = Number((value as { value?: unknown }).value);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  function getAssetBalance(assetId: string): number {
    const row = db.select().from(schema.accounts).where(eq(schema.accounts.assetId, assetId)).all()
      .reduce((sum, account) => sum + (Number.isFinite(account.balance) ? account.balance : 0), 0);
    return Math.max(0, row);
  }

  function analyzeCoinbaseCosts(previews: Array<CoinbaseOrderPreview | Record<string, unknown>>, amountHint: number | null) {
    const commission = previews.reduce((sum, preview) => sum + (numberFromCoinbaseMoney((preview as { commission_total?: unknown }).commission_total) ?? 0), 0);
    const total = previews.reduce((sum, preview) => sum + (numberFromCoinbaseMoney((preview as { order_total?: unknown }).order_total) ?? 0), 0);
    const amount = amountHint && amountHint > 0 ? amountHint : total;
    const slippage = previews.reduce((sum, preview) => sum + Math.abs(Number((preview as { slippage?: unknown }).slippage ?? 0) || 0), 0);
    const friction = commission + slippage;
    const feePct = amount > 0 ? (commission / amount) * 100 : 0;
    const frictionPct = amount > 0 ? (friction / amount) * 100 : 0;
    const level = frictionPct >= 3 ? "muy_alto" : frictionPct >= 1.5 ? "alto" : frictionPct >= 0.5 ? "moderado" : "bajo";
    return {
      amount,
      commission,
      slippage,
      spread: 0,
      friction,
      feePct: Math.round(feePct * 100) / 100,
      frictionPct: Math.round(frictionPct * 100) / 100,
      level,
      message: `La comisión representa ${feePct.toFixed(2)}% del importe. Coste operativo ${level.replace("_", " ")}.`,
    };
  }

  function marketOrder(productId: string, side: "BUY" | "SELL", size: { quote?: number; base?: number }): CoinbaseOrderRequest {
    const market_market_ioc: { quote_size?: string; base_size?: string } = {};
    if (size.quote !== undefined) market_market_ioc.quote_size = String(Math.round(size.quote * 100_000_000) / 100_000_000);
    if (size.base !== undefined) market_market_ioc.base_size = String(size.base);
    if (!market_market_ioc.quote_size && !market_market_ioc.base_size) throw new Error("La orden necesita importe o cantidad.");
    return {
      product_id: productId,
      side,
      order_configuration: { market_market_ioc },
    };
  }

  function ensureProductTradable(product: { trading_disabled?: boolean; cancel_only?: boolean; view_only?: boolean }, productId: string): void {
    if (product.trading_disabled || product.cancel_only || product.view_only) {
      throw new Error(`Coinbase no permite operar ahora el par ${productId}.`);
    }
  }

  async function getTradableProductOrNull(client: CoinbaseOperationClient, productId: string) {
    try {
      const product = await client.getProduct(productId);
      ensureProductTradable(product, productId);
      return product;
    } catch {
      return null;
    }
  }

  function inferLegacyOperation(input: CoinbaseTradeInput): OperationType {
    if (input.operationType) return input.operationType;
    return input.side === "SELL" ? "sell" : "buy";
  }

  function syntheticPreview(request: CoinbaseOrderRequest, amount: number, baseAmount: number | null): CoinbaseOrderPreview {
    return {
      preview_id: `sim-${crypto.randomUUID()}`,
      order_total: { value: amount.toFixed(2), currency: request.product_id.split("-")[1] ?? "EUR" },
      commission_total: { value: "0.00", currency: request.product_id.split("-")[1] ?? "EUR" },
      base_size: baseAmount !== null ? { value: String(baseAmount), currency: request.product_id.split("-")[0] ?? "" } : undefined,
      quote_size: { value: amount.toFixed(2), currency: request.product_id.split("-")[1] ?? "EUR" },
      est_average_filled_price: "simulación",
      slippage: "0",
    };
  }

  async function buildOperationPreview(input: CoinbaseTradeInput, client: CoinbaseOperationClient | null): Promise<StoredOperationPreview> {
    const operationType = inferLegacyOperation(input);
    const mode: OperationMode = input.mode === "simulation" ? "simulation" : "real";
    const token = crypto.randomUUID();
    const now = Date.now();
    const warnings: string[] = [];
    const route: OperationRouteStep[] = [];
    let routeType: "direct" | "multi_step" = "direct";
    let sourceAsset = "EUR";
    let destinationAsset = "";
    let fundingSource: "EUR" | "EURC libre" | "Cripto" = "EUR";
    let amountForAnalysis: number | null = null;

    const addStep = async (step: Omit<OperationRouteStep, "preview" | "clientOrderId"> & { amountHint: number; baseHint: number | null }) => {
      const preview = mode === "simulation"
        ? syntheticPreview(step.request, step.amountHint, step.baseHint)
        : await client!.previewOrder(step.request);
      route.push({ ...step, preview, clientOrderId: crypto.randomUUID() });
      return preview;
    };

    if (operationType === "buy") {
      const assetId = normalizeAssetId(input.assetId ?? input.toAssetId);
      const quoteAmount = finitePositive(input.quoteAmountEur ?? input.quoteAmount, "El importe EUR");
      if (!assetId) throw new Error("Selecciona el activo a comprar.");
      sourceAsset = "EUR";
      destinationAsset = assetId;
      fundingSource = "EUR";
      const eurBalance = getAssetBalance("EUR");
      if (eurBalance > 0 && quoteAmount > eurBalance) throw new Error("Saldo EUR insuficiente para esta compra ordinaria.");
      const productId = normalizeAssetId(input.productId) || `${assetId}-EUR`;
      if (mode === "real") {
        const product = await client!.getProduct(productId);
        ensureProductTradable(product, productId);
      }
      const request = marketOrder(productId, "BUY", { quote: quoteAmount });
      await addStep({ id: "buy-eur", label: "Compra con EUR", productId, side: "BUY", request, sourceAsset, destinationAsset, amountHint: quoteAmount, baseHint: null });
      amountForAnalysis = quoteAmount;
    } else if (operationType === "rebuy") {
      const assetId = normalizeAssetId(input.assetId ?? input.toAssetId);
      const quoteAmount = finitePositive(input.quoteAmountEur ?? input.quoteAmount, "El importe EURC libre");
      if (!assetId) throw new Error("Selecciona el activo de recompra.");
      const treasury = getTreasuryRepository().getSummary(getRecommendedFiscalReserve(), getCoinbaseEurcBalance());
      if (quoteAmount > treasury.freeRebuyLiquidity) throw new Error("EURC libre insuficiente. La reserva fiscal no puede utilizarse.");
      const eurcBalance = getAssetBalance("EURC");
      if (eurcBalance > 0 && quoteAmount > eurcBalance) throw new Error("Saldo físico EURC insuficiente para esta recompra.");
      sourceAsset = "EURC";
      destinationAsset = assetId;
      fundingSource = "EURC libre";
      const productId = normalizeAssetId(input.productId) || `${assetId}-EURC`;
      if (mode === "real") {
        const product = await client!.getProduct(productId);
        ensureProductTradable(product, productId);
      }
      const request = marketOrder(productId, "BUY", { quote: quoteAmount });
      await addStep({ id: "rebuy-eurc", label: "Recompra con EURC libre", productId, side: "BUY", request, sourceAsset, destinationAsset, amountHint: quoteAmount, baseHint: null });
      amountForAnalysis = quoteAmount;
    } else if (operationType === "sell") {
      const assetId = normalizeAssetId(input.assetId ?? input.fromAssetId);
      const baseAmount = finitePositive(input.baseAmount, "La cantidad a vender");
      if (!assetId) throw new Error("Selecciona el activo a vender.");
      const balance = getAssetBalance(assetId);
      if (balance > 0 && baseAmount >= balance) throw new Error("Venta total bloqueada: debe quedar una posición residual.");
      sourceAsset = assetId;
      destinationAsset = "EURC";
      fundingSource = "Cripto";
      const directProduct = `${assetId}-EURC`;
      const directTradable = mode === "real" ? await getTradableProductOrNull(client!, directProduct) : { product_id: directProduct };
      if (directTradable) {
        const request = marketOrder(directProduct, "SELL", { base: baseAmount });
        await addStep({ id: "sell-direct-eurc", label: "Venta directa a EURC", productId: directProduct, side: "SELL", request, sourceAsset, destinationAsset, amountHint: 0, baseHint: baseAmount });
      } else {
        routeType = "multi_step";
        warnings.push("Coinbase no ofrece ruta directa a EURC para este par; se previsualiza ruta multipaso CRIPTO → EUR → EURC.");
        const sellProduct = `${assetId}-EUR`;
        const eurcProduct = "EURC-EUR";
        const sellProductInfo = await client!.getProduct(sellProduct);
        ensureProductTradable(sellProductInfo, sellProduct);
        const eurcProductInfo = await client!.getProduct(eurcProduct);
        ensureProductTradable(eurcProductInfo, eurcProduct);
        const sellRequest = marketOrder(sellProduct, "SELL", { base: baseAmount });
        const sellPreview = await addStep({ id: "sell-to-eur", label: "Paso 1: vender cripto a EUR", productId: sellProduct, side: "SELL", request: sellRequest, sourceAsset, destinationAsset: "EUR", amountHint: 0, baseHint: baseAmount });
        const eurAmount = numberFromCoinbaseMoney(sellPreview.order_total) ?? 0;
        if (eurAmount <= 0) throw new Error("Coinbase no devolvió importe EUR estimado para preparar el segundo paso.");
        const eurcRequest = marketOrder(eurcProduct, "BUY", { quote: eurAmount });
        await addStep({ id: "buy-eurc", label: "Paso 2: comprar EURC con EUR", productId: eurcProduct, side: "BUY", request: eurcRequest, sourceAsset: "EUR", destinationAsset: "EURC", amountHint: eurAmount, baseHint: null });
        amountForAnalysis = eurAmount;
      }
    } else {
      const fromAssetId = normalizeAssetId(input.fromAssetId ?? input.assetId);
      const toAssetId = normalizeAssetId(input.toAssetId);
      const baseAmount = finitePositive(input.baseAmount, "La cantidad origen");
      if (!fromAssetId || !toAssetId || fromAssetId === toAssetId) throw new Error("Selecciona activo origen y destino distintos.");
      if (fromAssetId === "EURC" || toAssetId === "EURC") throw new Error("EURC no se usa como intermedio en conversiones ordinarias.");
      const balance = getAssetBalance(fromAssetId);
      if (balance > 0 && baseAmount > balance) throw new Error("Saldo insuficiente del activo origen.");
      sourceAsset = fromAssetId;
      destinationAsset = toAssetId;
      fundingSource = "Cripto";
      const directProduct = `${fromAssetId}-${toAssetId}`;
      const inverseProduct = `${toAssetId}-${fromAssetId}`;
      const directTradable = mode === "real" ? await getTradableProductOrNull(client!, directProduct) : { product_id: directProduct };
      if (directTradable) {
        const request = marketOrder(directProduct, "SELL", { base: baseAmount });
        await addStep({ id: "convert-direct", label: "Conversión directa", productId: directProduct, side: "SELL", request, sourceAsset, destinationAsset, amountHint: 0, baseHint: baseAmount });
      } else {
        const inverseTradable = mode === "real" ? await getTradableProductOrNull(client!, inverseProduct) : null;
        if (!inverseTradable) throw new Error(`Coinbase no ofrece conversión directa ${fromAssetId} → ${toAssetId}.`);
        const request = marketOrder(inverseProduct, "BUY", { quote: baseAmount });
        await addStep({ id: "convert-inverse", label: "Conversión directa inversa", productId: inverseProduct, side: "BUY", request, sourceAsset, destinationAsset, amountHint: 0, baseHint: baseAmount });
      }
    }

    const balances: Record<string, number> = {
      EUR: getAssetBalance("EUR"),
      EURC: getAssetBalance("EURC"),
      [sourceAsset]: getAssetBalance(sourceAsset),
      [destinationAsset]: getAssetBalance(destinationAsset),
    };
    const costAnalysis = analyzeCoinbaseCosts(route.map(step => step.preview), amountForAnalysis);
    return {
      token,
      operationType,
      mode,
      routeType,
      sourceAsset,
      destinationAsset,
      fundingSource,
      generatedAt: now,
      expiresAt: now + PREVIEW_EXPIRY_MS,
      submittedAt: null,
      input,
      route,
      balances,
      warnings,
      costAnalysis,
    };
  }

  function storeOperationPreview(preview: StoredOperationPreview): void {
    const previews = readJsonSetting<StoredOperationPreview[]>(PREVIEW_SETTINGS_KEY, [])
      .filter(item => item.expiresAt > Date.now() - 10 * 60_000)
      .slice(-20);
    previews.push(preview);
    writeJsonSetting(PREVIEW_SETTINGS_KEY, previews);
  }

  function updateStoredPreview(preview: StoredOperationPreview): void {
    const previews = readJsonSetting<StoredOperationPreview[]>(PREVIEW_SETTINGS_KEY, []);
    writeJsonSetting(PREVIEW_SETTINGS_KEY, previews.map(item => item.token === preview.token ? preview : item));
  }

  function appendSubmittedOrder(record: SubmittedOrderRecord): void {
    const records = readJsonSetting<SubmittedOrderRecord[]>(SUBMITTED_SETTINGS_KEY, []).slice(-100);
    records.push(record);
    writeJsonSetting(SUBMITTED_SETTINGS_KEY, records);
  }

  ipcMain.handle("coinbase:preview-order", withResult(async (_, input: CoinbaseTradeInput) => {
    const mode: OperationMode = input.mode === "simulation" ? "simulation" : "real";
    let client: CoinbaseOperationClient | null = null;
    if (mode === "real") {
      const creds = credsMgr.getCredentials();
      if (!creds) throw new Error("No hay credenciales de Coinbase. Conecta Coinbase primero.");
      const rawClient = new CoinbaseClient(creds.apiKeyName, creds.privateKeyPem);
      client = rawClient as unknown as CoinbaseOperationClient;
      const permissions = await rawClient.getKeyPermissions();
      if (!permissions.can_view) throw new Error("La API Key de Coinbase no tiene permiso de lectura para preparar órdenes.");
    }
    const preview = await buildOperationPreview({ ...input, mode }, client);
    storeOperationPreview(preview);
    return preview;
  }));

  ipcMain.handle("coinbase:submit-order", withResult(async (_, input: CoinbaseTradeInput) => {
    if (input.mode === "simulation") {
      return {
        success: true,
        simulated: true,
        message: "SIMULACIÓN — NO SE ENVIÓ NINGUNA ORDEN A COINBASE",
        submittedAt: Date.now(),
      };
    }
    if (input.confirmationText !== "CONFIRMAR") {
      throw new Error("Confirmación requerida: escribe CONFIRMAR antes de enviar una orden real.");
    }
    const token = input.previewToken ?? null;
    if (!token) throw new Error("Falta el identificador de preview. Solicita una nueva previsualización.");
    const previews = readJsonSetting<StoredOperationPreview[]>(PREVIEW_SETTINGS_KEY, []);
    const stored = previews.find(item => item.token === token);
    if (!stored) throw new Error("Preview no encontrado o ya descartado. Solicita uno nuevo.");
    if (stored.submittedAt) throw new Error("Esta previsualización ya fue enviada. Protección frente a doble clic activada.");
    if (stored.expiresAt <= Date.now()) throw new Error("Cotización caducada. Solicita un nuevo preview antes de confirmar.");

    const creds = credsMgr.getCredentials();
    if (!creds) throw new Error("No hay credenciales de Coinbase. Conecta Coinbase primero.");
    const client = new CoinbaseClient(creds.apiKeyName, creds.privateKeyPem);
    const permissions = await client.getKeyPermissions();
    if (!permissions.can_trade) throw new Error("La API Key de Coinbase no tiene permiso de trading.");

    const orderResults: CoinbaseOrderResult[] = [];
    for (const step of stored.route) {
      const product = await client.getProduct(step.productId);
      ensureProductTradable(product, step.productId);
      const request: CoinbaseCreateOrder = {
        ...step.request,
        client_order_id: step.clientOrderId,
        preview_id: (step.preview as { preview_id?: string }).preview_id ?? undefined,
      };
      const order = await client.createOrder(request);
      if (!order.success) {
        const msg = order.error_response?.message || order.error_response?.error_details || order.error_response?.error || "Coinbase rechazó la orden.";
        throw new Error(msg);
      }
      orderResults.push(order);
    }

    stored.submittedAt = Date.now();
    updateStoredPreview(stored);
    appendSubmittedOrder({
      id: crypto.randomUUID(),
      token: stored.token,
      operationType: stored.operationType,
      submittedAt: stored.submittedAt,
      routeType: stored.routeType,
      orders: orderResults,
    });

    const syncDb = getDb();
    const syncService = new CoinbaseSyncService(syncDb, schema, client);
    void syncService.syncWithErrorHandling()
      .then(() => getPortfolioService().recalculateFifo())
      .catch((error: unknown) => console.warn("[Coinbase] Sync tras orden falló:", error instanceof Error ? error.message : String(error)));

    return {
      success: true,
      operationType: stored.operationType,
      routeType: stored.routeType,
      orders: orderResults,
      sync: "started",
    };
  }));

  ipcMain.handle("coinbase:list-pending-orders", withResult(async () => {
    const records = readJsonSetting<SubmittedOrderRecord[]>(SUBMITTED_SETTINGS_KEY, []);
    const creds = credsMgr.getCredentials();
    if (!creds) return records.map(record => ({ ...record, coinbaseStatus: null, statusSource: "local" }));
    const client = new CoinbaseClient(creds.apiKeyName, creds.privateKeyPem);
    return Promise.all(records.slice().reverse().map(async (record) => {
      const statuses = await Promise.all(record.orders.map(async (order) => {
        const orderId = order.success_response?.order_id ?? order.order_id ?? null;
        if (!orderId) return null;
        try {
          return await (client as unknown as CoinbaseOperationClient).getOrder(orderId);
        } catch {
          return null;
        }
      }));
      return { ...record, coinbaseStatus: statuses, statusSource: "coinbase" };
    }));
  }));

  ipcMain.handle("coinbase:list-scheduled-operations", withResult(async () => {
    const records = readJsonSetting<ScheduledOperationRecord[]>(SCHEDULED_SETTINGS_KEY, [])
      .filter(item => item.status !== "cancelada");

    // Evaluate price conditions for pending records
    const evaluated = await Promise.all(records.map(async (item) => {
      if (!item.condicion || item.status === "condicion_cumplida") return item;
      try {
        const assetId = item.condicion.assetId;
        const priceResult = await marketService.getCurrentPriceEur(assetId);
        const currentPrice = priceResult?.price ?? null;
        if (currentPrice == null) return item;
        const met = item.condicion.type === "price_lte"
          ? currentPrice <= item.condicion.value
          : currentPrice >= item.condicion.value;
        if (met) {
          const updated = { ...item, status: "condicion_cumplida" as const };
          // Persist updated status
          const all = readJsonSetting<ScheduledOperationRecord[]>(SCHEDULED_SETTINGS_KEY, []);
          writeJsonSetting(SCHEDULED_SETTINGS_KEY, all.map(r => r.id === item.id ? updated : r));
          return updated;
        }
      } catch {
        // Non-fatal: condition evaluation failure doesn't block listing
      }
      return item;
    }));

    return evaluated;
  }));

  ipcMain.handle("coinbase:create-scheduled-operation", withResult(async (_, input: CoinbaseTradeInput & { plannedAt?: number | null; frequency?: string; maxExecutions?: number | null; autoExecution?: boolean; condicion?: ScheduledCondition }) => {
    if (input.autoExecution) {
      throw new Error("La ejecución automática real requiere un servicio persistente con límites explícitos. Por seguridad, esta versión programa para revisar.");
    }
    const operationType = inferLegacyOperation(input);
    const condicion: ScheduledCondition | undefined = input.condicion && (input.condicion.type === "price_lte" || input.condicion.type === "price_gte") && typeof input.condicion.value === "number"
      ? { type: input.condicion.type, assetId: normalizeAssetId(input.condicion.assetId), value: input.condicion.value }
      : undefined;
    const record: ScheduledOperationRecord = {
      id: crypto.randomUUID(),
      operationType,
      mode: "review",
      status: "programada_revision",
      createdAt: Date.now(),
      plannedAt: typeof input.plannedAt === "number" ? input.plannedAt : null,
      frequency: String(input.frequency ?? "una_vez"),
      maxExecutions: typeof input.maxExecutions === "number" ? input.maxExecutions : null,
      input,
      note: condicion
        ? `Condición: precio ${condicion.type === "price_lte" ? "≤" : "≥"} ${condicion.value} EUR para ${condicion.assetId}. Al cumplirse se requiere nuevo preview y confirmación.`
        : "Programada para revisar: al activarse debe obtener un nuevo preview y pedir confirmación. No se ejecuta con React cerrado ni con el backend detenido.",
      condicion,
    };
    const records = readJsonSetting<ScheduledOperationRecord[]>(SCHEDULED_SETTINGS_KEY, []);
    records.push(record);
    writeJsonSetting(SCHEDULED_SETTINGS_KEY, records);
    return record;
  }));

  ipcMain.handle("coinbase:delete-scheduled-operation", withResult(async (_, id: string) => {
    const records = readJsonSetting<ScheduledOperationRecord[]>(SCHEDULED_SETTINGS_KEY, []);
    writeJsonSetting(SCHEDULED_SETTINGS_KEY, records.map(record => record.id === id ? { ...record, status: "cancelada" as const } : record));
    return null;
  }));

  ipcMain.handle("coinbase:sync", withResult(async () => {
    const creds = credsMgr.getCredentials();
    if (!creds) throw new Error("No hay credenciales de Coinbase. Conéctate primero.");

    const syncDb = getDb();
    const client = new CoinbaseClient(creds.apiKeyName, creds.privateKeyPem);
    const syncService = new CoinbaseSyncService(syncDb, schema, client);
    const result = await syncService.syncWithErrorHandling();

    // Best-effort, non-blocking — newly-imported legs get a chance at a real
    // historical-price cost basis right away without slowing down sync itself.
    backfillCostBasis()
      .then(async (r) => {
        console.log(`[CostBasis] Backfill: ${r.legsBackfilled}/${r.legsChecked} legs resueltos, ${r.legsStillPending} siguen pendientes.`);
        if (r.legsBackfilled > 0) {
          await getPortfolioService().recalculateFifo();
          console.log("[CostBasis] FIFO recalculado tras backfill.");
        }
      })
      .catch((e) => console.warn("[CostBasis] Backfill falló:", e));

    return result;
  }));

  // Backfills cost basis for legs Coinbase never valued (crypto-to-crypto
  // converts, rewards, transfers-in) using a REAL historical market price at
  // the leg's own transaction date — never a guess, never another date's
  // price. Legs that still can't be resolved stay "pending" and are reported
  // as such; "Coste pendiente" must always mean "we genuinely don't know",
  // not "we didn't try". Run after every sync so newly-imported legs get a
  // chance immediately, and also exposed for an on-demand re-run.
  async function backfillCostBasis() {
    const { computeBackfillForLeg, priceAtOrBefore } = require("@crypto-control/portfolio") as typeof import("@crypto-control/portfolio");
    const { getAssetMetadata } = require("@crypto-control/market-data") as typeof import("@crypto-control/market-data");

    const pendingRows = db
      .select({
        legId: schema.transactionLegs.id,
        assetId: schema.transactionLegs.assetId,
        amount: schema.transactionLegs.amount,
        transactionDate: schema.transactions.date,
      })
      .from(schema.transactionLegs)
      .innerJoin(schema.transactions, eq(schema.transactionLegs.transactionId, schema.transactions.id))
      .where(and(
        eq(schema.transactionLegs.valuationStatus, "pending"),
        isNull(schema.transactionLegs.acquisitionValueEur),
      ))
      .all();

    const byAsset = new Map<string, typeof pendingRows>();
    for (const row of pendingRows) {
      const assetRow = db.select({ type: schema.assets.type }).from(schema.assets).where(eq(schema.assets.id, row.assetId)).get();
      if (assetRow?.type === "fiat") continue;
      if (!getAssetMetadata(row.assetId)) continue;
      const list = byAsset.get(row.assetId) ?? [];
      list.push(row);
      byAsset.set(row.assetId, list);
    }

    let legsBackfilled = 0;
    const byAssetSummary: Record<string, { checked: number; backfilled: number }> = {};

    for (const [assetId, legs] of byAsset.entries()) {
      byAssetSummary[assetId] = { checked: legs.length, backfilled: 0 };
      let priceSeries: { time: number; price: number }[];
      try {
        const result = await marketService.getHistoricalPrices(assetId, "all");
        priceSeries = result.points.map((p) => ({ time: p.timestamp, price: p.price })).sort((a, b) => a.time - b.time);
      } catch {
        continue;
      }
      if (priceSeries.length === 0) continue;

      for (const leg of legs) {
        const price = priceAtOrBefore(priceSeries, leg.transactionDate);
        const backfill = computeBackfillForLeg({ id: leg.legId, assetId, amount: leg.amount, transactionDate: leg.transactionDate }, price);
        if (!backfill) continue;

        db.update(schema.transactionLegs)
          .set({
            acquisitionValueEur: backfill.acquisitionValueEur,
            unitAcquisitionPriceEur: backfill.unitAcquisitionPriceEur,
            valuationStatus: "estimated",
            valuationSource: "historical-price-backfill",
            valuationTimestamp: Date.now(),
          })
          .where(eq(schema.transactionLegs.id, leg.legId))
          .run();

        legsBackfilled++;
        byAssetSummary[assetId].backfilled++;
      }
    }

    return {
      legsChecked: pendingRows.length,
      legsBackfilled,
      legsStillPending: pendingRows.length - legsBackfilled,
      byAsset: byAssetSummary,
    };
  }

  ipcMain.handle("portfolio:backfillCostBasis", withResult(backfillCostBasis));

  // D10: end-to-end pipeline diagnostic — Coinbase API -> accounts/balances
  // -> transactions/legs/fees -> SQLite -> PortfolioService -> what actually
  // renders. Exists so "is this number trustworthy" has a real answer
  // instead of having to read code/logs.
  ipcMain.handle("diagnostics:getReport", withResult(async () => {
    const accountsCount = db.select({ id: schema.accounts.id }).from(schema.accounts).all().length;
    const balancesPositive = db.select({ balance: schema.accounts.balance }).from(schema.accounts).all()
      .filter((r) => r.balance > 1e-12).length;
    const transactionsCount = db.select({ id: schema.transactions.id }).from(schema.transactions).all().length;
    const conversionsCount = db.select({ id: schema.transactions.id }).from(schema.transactions)
      .where(eq(schema.transactions.type, "convert")).all().length;
    const feesCount = db.select({ id: schema.fees.id }).from(schema.fees).all().length;
    const assetsCount = db.select({ id: schema.assets.id }).from(schema.assets).all().length;
    const priceHistoryCount = db.select({ assetId: schema.priceHistory.assetId }).from(schema.priceHistory).all().length;
    const candleCacheCount = db.select({ id: schema.coinbaseCandleCache.id }).from(schema.coinbaseCandleCache).all().length;

    const pendingLegs = db
      .select({ id: schema.transactionLegs.id })
      .from(schema.transactionLegs)
      .where(and(eq(schema.transactionLegs.valuationStatus, "pending"), isNull(schema.transactionLegs.acquisitionValueEur)))
      .all().length;

    const { positions } = await getPortfolioService().getPositions();
    const heldPositions = Object.values(positions).filter((p) => p.balance > 1e-12);

    const perAsset: {
      symbol: string;
      amount: number;
      hasPrice: boolean;
      hasHistoricalPrice: boolean;
      hasCostBasis: boolean;
      rendered: boolean;
    }[] = [];
    let missingPrices = 0;

    for (const pos of heldPositions) {
      const assetRow = db.select({ type: schema.assets.type }).from(schema.assets).where(eq(schema.assets.id, pos.assetId)).get();
      let hasPrice = false;
      try {
        const priceResult = await marketService.getCurrentPriceEur(pos.assetId);
        hasPrice = priceResult.price !== null;
      } catch {
        hasPrice = false;
      }
      if (!hasPrice) missingPrices++;

      const hasHistoricalPriceRow = db.select({ assetId: schema.priceHistory.assetId }).from(schema.priceHistory)
        .where(eq(schema.priceHistory.assetId, pos.assetId)).limit(1).get();
      const hasHistoricalCandleRow = (() => {
        const meta = (require("@crypto-control/market-data") as typeof import("@crypto-control/market-data")).getAssetMetadata(pos.assetId);
        if (!meta) return null;
        return db.select({ id: schema.coinbaseCandleCache.id }).from(schema.coinbaseCandleCache)
          .where(eq(schema.coinbaseCandleCache.productId, meta.coinbaseProductId)).limit(1).get();
      })();

      // EURC/EUR are treated as cash/treasury, not a Cartera position —
      // intentionally excluded there, not a data gap.
      const isCash = pos.assetId === "EUR" || pos.assetId === "EURC" || assetRow?.type === "fiat";

      perAsset.push({
        symbol: pos.assetId,
        amount: pos.balance,
        hasPrice,
        hasHistoricalPrice: !!hasHistoricalPriceRow || !!hasHistoricalCandleRow,
        hasCostBasis: pos.totalInvestedEur > 0 && !pos.hasPendingValuation,
        rendered: !isCash,
      });
    }

    return {
      accounts: accountsCount,
      balances: balancesPositive,
      transactions: transactionsCount,
      conversions: conversionsCount,
      fees: feesCount,
      assets: assetsCount,
      positions: heldPositions.length,
      historicalPrices: priceHistoryCount + candleCacheCount,
      missingPrices,
      missingCosts: pendingLegs,
      perAsset,
    };
  }));

  ipcMain.handle("coinbase:get-sync-history", withResult(async () => {
    const rows = await db.select()
      .from(schema.syncRuns)
      .where(eq(schema.syncRuns.source, "coinbase"))
      .orderBy(schema.syncRuns.timestamp)
      .limit(20);
    const lastErrorRow = await db.select().from(schema.settings).where(eq(schema.settings.key, "coinbase:last-sync-error")).limit(1);
    const lastError = lastErrorRow.length ? lastErrorRow[0].value : null;

    return rows.reverse().map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      status: row.status,
      itemsProcessed: row.itemsProcessed,
      newTransactions: row.status === "success" ? row.itemsProcessed : 0,
      skippedDuplicates: null,
      durationMs: null,
      error: row.status === "error" ? lastError : null,
    }));
  }));

  // --- V3 PORTFOLIO HANDLERS ---
  const getPortfolioServiceInst = () => {
    const syncDb = getDb();
    return new CoinbasePortfolioService(syncDb, async () => {
      const creds = credsMgr.getCredentials();
      if (!creds) return null;
      return new CoinbaseClient(creds.apiKeyName, creds.privateKeyPem);
    });
  };

  ipcMain.handle("coinbase:list-portfolios", withResult(async () => {
    return await getPortfolioServiceInst().listPortfolios();
  }));

  ipcMain.handle("coinbase:get-portfolio-breakdown", withResult(async (_, portfolioUuid: string, currency: string = "EUR") => {
    const quoteCurrency = currency || "EUR";
    const service = getPortfolioServiceInst();
    const liveBreakdown = service.getPortfolioBreakdown(portfolioUuid, quoteCurrency);
    liveBreakdown.catch((error) => {
      console.warn("[Coinbase] Portfolio live breakdown did not complete before fallback:", error instanceof Error ? error.message : String(error));
    });

    const cachedBreakdown = new Promise((resolve) => {
      setTimeout(() => {
        const cached = service.getCachedPortfolioBreakdown(portfolioUuid, quoteCurrency, "Coinbase tardó demasiado; mostrando cache local.");
        void Promise.resolve(cached).then(resolve);
      }, 8000);
    });

    return await Promise.race([liveBreakdown, cachedBreakdown]);
  }));

  ipcMain.handle("coinbase:get-portfolio-snapshots", withResult(async (_, portfolioUuid: string) => {
    return await getPortfolioServiceInst().getPortfolioSnapshots(portfolioUuid);
  }));

  // ── contributionSchedule ────────────────────────────────────────────────────
  ipcMain.handle("contributionSchedule:list", withResult(async (_, input?: { cycleId?: string; status?: string }) => {
    const db = getDb();
    let query = db.select().from(schema.contributionSchedule).orderBy(asc(schema.contributionSchedule.plannedDate));
    const conditions = [];
    if (input?.cycleId) conditions.push(eq(schema.contributionSchedule.cycleId, input.cycleId));
    if (input?.status)  conditions.push(eq(schema.contributionSchedule.status, input.status));
    const rows = conditions.length > 0
      ? query.where(and(...conditions)).all()
      : query.all();
    return rows.map(mapContributionSchedule);
  }));

  ipcMain.handle("contributionSchedule:create", withResult(async (_, payload) => {
    const data = CreateContributionScheduleSchema.parse(payload);
    const id = crypto.randomUUID();
    const now = Date.now();
    db.insert(schema.contributionSchedule).values({
      id,
      cycleId: data.cycleId,
      type: data.type ?? "periodica",
      plannedDate: data.plannedDate,
      amountEur: data.amountEur,
      currency: data.currency ?? "EUR",
      destination: data.destination ?? null,
      status: "pendiente",
      executedAt: null,
      notes: data.notes ?? null,
      createdAt: now,
      updatedAt: now,
    }).run();
    return { id };
  }));

  ipcMain.handle("contributionSchedule:update", withResult(async (_, id: string, payload) => {
    const data = UpdateContributionScheduleSchema.parse(payload);
    const row = db.select().from(schema.contributionSchedule).where(eq(schema.contributionSchedule.id, id)).get();
    if (!row) throw new Error(`Aportación ${id} no encontrada.`);
    const update: Partial<typeof schema.contributionSchedule.$inferInsert> = { updatedAt: Date.now() };
    if (data.plannedDate  !== undefined) update.plannedDate  = data.plannedDate;
    if (data.amountEur    !== undefined) update.amountEur    = data.amountEur;
    if (data.currency     !== undefined) update.currency     = data.currency;
    if (data.destination  !== undefined) update.destination  = data.destination ?? null;
    if (data.type         !== undefined) update.type         = data.type;
    if (data.notes        !== undefined) update.notes        = data.notes ?? null;
    db.update(schema.contributionSchedule).set(update).where(eq(schema.contributionSchedule.id, id)).run();
    const updated = db.select().from(schema.contributionSchedule).where(eq(schema.contributionSchedule.id, id)).get()!;
    return mapContributionSchedule(updated);
  }));

  ipcMain.handle("contributionSchedule:execute", withResult(async (_, id: string) => {
    const row = db.select().from(schema.contributionSchedule).where(eq(schema.contributionSchedule.id, id)).get();
    if (!row) throw new Error(`Aportación ${id} no encontrada.`);
    if (row.status === "ejecutada") throw new Error(`La aportación ${id} ya fue ejecutada.`);
    const now = Date.now();
    db.update(schema.contributionSchedule)
      .set({ status: "ejecutada", executedAt: now, updatedAt: now })
      .where(eq(schema.contributionSchedule.id, id))
      .run();
    const updated = db.select().from(schema.contributionSchedule).where(eq(schema.contributionSchedule.id, id)).get()!;
    return mapContributionSchedule(updated);
  }));

  ipcMain.handle("contributionSchedule:delete", withResult(async (_, id: string) => {
    db.delete(schema.contributionSchedule).where(eq(schema.contributionSchedule.id, id)).run();
    return null;
  }));

  // ── assetSubstitutions ───────────────────────────────────────────────────────
  ipcMain.handle("assetSubstitutions:list", withResult(async (_, input?: { cycleId?: string; fromAssetId?: string; status?: string }) => {
    const db = getDb();
    let query = db.select().from(schema.assetSubstitutions).orderBy(asc(schema.assetSubstitutions.effectiveDate));
    const conditions = [];
    if (input?.cycleId)     conditions.push(eq(schema.assetSubstitutions.cycleId, input.cycleId));
    if (input?.fromAssetId) conditions.push(eq(schema.assetSubstitutions.fromAssetId, input.fromAssetId));
    if (input?.status)      conditions.push(eq(schema.assetSubstitutions.status, input.status));
    const rows = conditions.length > 0
      ? query.where(and(...conditions)).all()
      : query.all();
    return rows.map(mapAssetSubstitution);
  }));

  ipcMain.handle("assetSubstitutions:create", withResult(async (_, payload) => {
    const data = CreateAssetSubstitutionSchema.parse(payload);
    const id = crypto.randomUUID();
    db.insert(schema.assetSubstitutions).values({
      id,
      cycleId: data.cycleId,
      fromAssetId: data.fromAssetId,
      toAssetId: data.toAssetId ?? null,
      fromInvestmentAssetId: data.fromInvestmentAssetId ?? null,
      toInvestmentAssetId: null,
      effectiveDate: data.effectiveDate,
      status: data.status ?? "borrador",
      allocationTransferMode: data.allocationTransferMode ?? null,
      allocationTransferPercentage: data.allocationTransferPercentage ?? null,
      allocationTransferAmount: data.allocationTransferAmount ?? null,
      appliedAt: null,
      revisionId: null,
      reason: data.reason,
      notes: data.notes ?? null,
      createdAt: Date.now(),
    }).run();
    return { id };
  }));

  ipcMain.handle("assetSubstitutions:update", withResult(async (_, id: string, payload) => {
    const db = getDb();
    const data = UpdateAssetSubstitutionSchema.parse(payload);
    const row = db.select().from(schema.assetSubstitutions).where(eq(schema.assetSubstitutions.id, id)).get();
    if (!row) throw new Error(`Sustitución ${id} no encontrada.`);
    if (row.status === "aplicada" || row.status === "cancelada") {
      throw new Error("No se puede editar una sustitución ya aplicada o cancelada.");
    }
    const update: Partial<typeof schema.assetSubstitutions.$inferInsert> = {};
    if (data.toAssetId !== undefined)                   update.toAssetId = data.toAssetId ?? null;
    if (data.effectiveDate !== undefined)               update.effectiveDate = data.effectiveDate;
    if (data.status !== undefined)                      update.status = data.status;
    if (data.allocationTransferMode !== undefined)      update.allocationTransferMode = data.allocationTransferMode ?? null;
    if (data.allocationTransferPercentage !== undefined) update.allocationTransferPercentage = data.allocationTransferPercentage ?? null;
    if (data.allocationTransferAmount !== undefined)    update.allocationTransferAmount = data.allocationTransferAmount ?? null;
    if (data.reason !== undefined)                      update.reason = data.reason;
    if (data.notes !== undefined)                       update.notes = data.notes ?? null;
    db.update(schema.assetSubstitutions).set(update).where(eq(schema.assetSubstitutions.id, id)).run();
    const updated = db.select().from(schema.assetSubstitutions).where(eq(schema.assetSubstitutions.id, id)).get()!;
    return mapAssetSubstitution(updated);
  }));

  ipcMain.handle("assetSubstitutions:cancel", withResult(async (_, id: string) => {
    const db = getDb();
    const row = db.select().from(schema.assetSubstitutions).where(eq(schema.assetSubstitutions.id, id)).get();
    if (!row) throw new Error(`Sustitución ${id} no encontrada.`);
    if (row.status === "aplicada") throw new Error("No se puede cancelar una sustitución ya aplicada.");
    if (row.status === "cancelada") throw new Error("La sustitución ya está cancelada.");
    db.update(schema.assetSubstitutions).set({ status: "cancelada" }).where(eq(schema.assetSubstitutions.id, id)).run();
    const updated = db.select().from(schema.assetSubstitutions).where(eq(schema.assetSubstitutions.id, id)).get()!;
    return mapAssetSubstitution(updated);
  }));

  ipcMain.handle("assetSubstitutions:delete", withResult(async (_, id: string) => {
    db.delete(schema.assetSubstitutions).where(eq(schema.assetSubstitutions.id, id)).run();
    return null;
  }));

  // Ejecutar una sustitución: cierra el investmentAsset de origen y crea uno nuevo
  // para el activo destino heredando la configuración de asignación del origen.
  ipcMain.handle("assetSubstitutions:execute", withResult(async (_, id: string) => {
    const db = getDb();
    const sub = db.select().from(schema.assetSubstitutions).where(eq(schema.assetSubstitutions.id, id)).get();
    if (!sub) throw new Error(`Sustitución ${id} no encontrada.`);

    const fromAsset = db.select().from(schema.investmentAssets)
      .where(and(
        eq(schema.investmentAssets.cycleId, sub.cycleId),
        eq(schema.investmentAssets.assetId, sub.fromAssetId),
        eq(schema.investmentAssets.status, "active"),
      ))
      .orderBy(desc(schema.investmentAssets.startDate))
      .limit(1)
      .get();

    const fromInvestmentAssetId = fromAsset?.id ?? null;
    let toInvestmentAssetId: string | null = null;

    db.transaction((tx) => {
      if (fromAsset) {
        tx.update(schema.investmentAssets)
          .set({ status: "closed", endDate: sub.effectiveDate, updatedAt: Date.now() })
          .where(eq(schema.investmentAssets.id, fromAsset.id))
          .run();
      }

      if (sub.toAssetId) {
        const newId = crypto.randomUUID();
        toInvestmentAssetId = newId;
        const now = Date.now();
        tx.insert(schema.investmentAssets).values({
          id: newId,
          cycleId: sub.cycleId,
          assetId: sub.toAssetId,
          allocationType: fromAsset?.allocationType ?? "percentage",
          allocationValue: fromAsset?.allocationValue ?? 0,
          allocationPercentage: fromAsset?.allocationPercentage ?? null,
          fixedAmountEur: fromAsset?.fixedAmountEur ?? null,
          priority: fromAsset?.priority ?? 0,
          targetAmount: fromAsset?.targetAmount ?? null,
          targetValueEur: fromAsset?.targetValueEur ?? null,
          targetPortfolioPercentage: fromAsset?.targetPortfolioPercentage ?? null,
          startDate: sub.effectiveDate,
          endDate: null,
          status: "active",
          notes: `Sustitución desde ${sub.fromAssetId}. ${sub.reason}`,
          createdAt: now,
          updatedAt: now,
        }).run();
      }

      tx.update(schema.assetSubstitutions)
        .set({
          fromInvestmentAssetId: fromInvestmentAssetId ?? undefined,
          toInvestmentAssetId: toInvestmentAssetId ?? undefined,
        })
        .where(eq(schema.assetSubstitutions.id, id))
        .run();
    });

    return { fromInvestmentAssetId, toInvestmentAssetId };
  }));

  // Apply (nueva versión de execute con status tracking y revisión estratégica)
  ipcMain.handle("assetSubstitutions:apply", withResult(async (_, id: string) => {
    const db = getDb();
    const sub = db.select().from(schema.assetSubstitutions).where(eq(schema.assetSubstitutions.id, id)).get();
    if (!sub) throw new Error(`Sustitución ${id} no encontrada.`);
    if (sub.status === "aplicada") throw new Error("La sustitución ya ha sido aplicada.");
    if (sub.status === "cancelada") throw new Error("No se puede aplicar una sustitución cancelada.");

    const fromAsset = db.select().from(schema.investmentAssets)
      .where(and(
        eq(schema.investmentAssets.cycleId, sub.cycleId),
        eq(schema.investmentAssets.assetId, sub.fromAssetId),
        eq(schema.investmentAssets.status, "active"),
      ))
      .orderBy(desc(schema.investmentAssets.startDate))
      .limit(1)
      .get();

    const fromInvestmentAssetId = fromAsset?.id ?? null;
    let toInvestmentAssetId: string | null = null;
    const now = Date.now();
    const revisionId = crypto.randomUUID();
    const cycleRow = db.select().from(schema.investmentCycles).where(eq(schema.investmentCycles.id, sub.cycleId)).get();
    const monthlyEur = cycleRow?.monthlyAmountEur ?? 0;

    // Compute allocation to transfer
    let transferredValue = fromAsset?.allocationValue ?? 0;
    let transferredPct = fromAsset?.allocationPercentage ?? null;
    let transferredFixed = fromAsset?.fixedAmountEur ?? null;

    if (sub.allocationTransferMode === "custom") {
      if (fromAsset?.allocationType === "percentage" && sub.allocationTransferPercentage !== null) {
        transferredPct = sub.allocationTransferPercentage;
        transferredValue = sub.allocationTransferPercentage;
      } else if (fromAsset?.allocationType === "amount" && sub.allocationTransferAmount !== null) {
        transferredFixed = sub.allocationTransferAmount;
        transferredValue = sub.allocationTransferAmount;
        transferredPct = monthlyEur > 0 ? (sub.allocationTransferAmount / monthlyEur) * 100 : null;
      }
    } else if (sub.allocationTransferMode === "pending") {
      transferredValue = 0;
      transferredPct = null;
      transferredFixed = null;
    }

    const changesJson = JSON.stringify({
      type: "asset_substitution",
      substitutionId: sub.id,
      fromAssetId: sub.fromAssetId,
      toAssetId: sub.toAssetId,
      effectiveDate: sub.effectiveDate,
      allocationTransferMode: sub.allocationTransferMode ?? "full",
      previousAllocationValue: fromAsset?.allocationValue ?? 0,
      newAllocationValue: transferredValue,
      reason: sub.reason,
    });

    db.transaction((tx) => {
      if (fromAsset) {
        tx.update(schema.investmentAssets)
          .set({ status: "closed", isActive: 0, endDate: sub.effectiveDate, updatedAt: now })
          .where(eq(schema.investmentAssets.id, fromAsset.id))
          .run();
      }

      if (sub.toAssetId) {
        const newId = crypto.randomUUID();
        toInvestmentAssetId = newId;
        tx.insert(schema.investmentAssets).values({
          id: newId,
          cycleId: sub.cycleId,
          assetId: sub.toAssetId,
          allocationType: fromAsset?.allocationType ?? "percentage",
          allocationValue: transferredValue,
          allocationPercentage: transferredPct,
          fixedAmountEur: transferredFixed,
          priority: fromAsset?.priority ?? 0,
          targetAmount: null,
          targetValueEur: null,
          targetPortfolioPercentage: null,
          startDate: sub.effectiveDate,
          endDate: null,
          status: "active",
          isActive: 1,
          notes: `Sustitución desde ${sub.fromAssetId}. ${sub.reason}`,
          createdAt: now,
          updatedAt: now,
        }).run();
      }

      tx.insert(schema.strategyRevisions).values({
        id: revisionId,
        cycleId: sub.cycleId,
        effectiveDate: sub.effectiveDate,
        title: sub.toAssetId
          ? `Sustitución: ${sub.fromAssetId} → ${sub.toAssetId}`
          : `Retirada de activo: ${sub.fromAssetId}`,
        notes: sub.notes ?? null,
        changesJson,
        createdAt: now,
      }).run();

      tx.update(schema.assetSubstitutions)
        .set({
          fromInvestmentAssetId: fromInvestmentAssetId ?? undefined,
          toInvestmentAssetId: toInvestmentAssetId ?? undefined,
          status: "aplicada",
          appliedAt: now,
          revisionId,
        })
        .where(eq(schema.assetSubstitutions.id, id))
        .run();
    });

    return { fromInvestmentAssetId, toInvestmentAssetId };
  }));

  // Resumen mensual de aportaciones para un ciclo
  ipcMain.handle("contributionSchedule:getMonthlySummary", withResult(async (_, input: { cycleId: string }) => {
    const db = getDb();
    const {
      buildContributionHistory,
      calculateCycleContributionAggregates,
      deriveContributionEntriesFromOperations,
      mergeManualAndOperationContributions,
    } = require("@crypto-control/portfolio") as typeof import("@crypto-control/portfolio");

    const cycleRow = db.select().from(schema.investmentCycles).where(eq(schema.investmentCycles.id, input.cycleId)).get();
    if (!cycleRow) throw new Error(`Ciclo ${input.cycleId} no encontrado.`);

    const cycle = {
      id: cycleRow.id,
      startDate: cycleRow.startDate,
      endDate: cycleRow.endDate ?? null,
      monthlyAmountEur: cycleRow.monthlyAmountEur,
    };

    const rawEntries = db.select().from(schema.contributionSchedule)
      .where(eq(schema.contributionSchedule.cycleId, input.cycleId))
      .orderBy(asc(schema.contributionSchedule.plannedDate))
      .all();

    const entries = rawEntries.map(e => ({
      id: e.id,
      cycleId: e.cycleId,
      type: e.type as "periodica" | "extraordinaria",
      plannedDate: e.plannedDate,
      amountEur: e.amountEur,
      status: e.status as "pendiente" | "ejecutada" | "cancelada",
      executedAt: e.executedAt ?? null,
      notes: e.notes ?? null,
    }));

    const txRepo = new DatabasePortfolioRepository(db);
    const transactions = await txRepo.getTransactions();
    const assetRows = db.select({ id: schema.assets.id, type: schema.assets.type }).from(schema.assets).all();
    const assetTypeById = new Map(assetRows.map((asset) => [asset.id, asset.type]));
    const operationEntries = deriveContributionEntriesFromOperations(
      cycle,
      transactions,
      (assetId: string) => assetId === "EUR" || assetTypeById.get(assetId) === "fiat",
    );
    const mergedEntries = mergeManualAndOperationContributions(entries, operationEntries);

    const now = Date.now();
    const summaries = buildContributionHistory(cycle, mergedEntries, now);
    const aggregates = calculateCycleContributionAggregates(cycle, summaries, mergedEntries, now);

    const validatedSummaries = summaries.map(s => ContributionMonthlySummarySchema.parse(s));
    const validatedAggregates = CycleContributionAggregatesSchema.parse(aggregates);

    return { summaries: validatedSummaries, aggregates: validatedAggregates };
  }));

  // Alertas estratégicas calculadas por demanda para un ciclo concreto.
  // No se persisten: se calculan desde el estado actual de los activos.
  ipcMain.handle("strategicAlerts:generate", withResult(async (_, input: { cycleId: string }) => {
    const { assessAssetHealth } = require("@crypto-control/market-data") as typeof import("@crypto-control/market-data");
    const db = getDb();

    const assetRows = db.select().from(schema.investmentAssets)
      .where(and(
        eq(schema.investmentAssets.cycleId, input.cycleId),
        eq(schema.investmentAssets.status, "active"),
      ))
      .all();

    const alerts = [];
    for (const assetRow of assetRows) {
      const isRetiredFromStrategy = assetRow.status === "closed";
      const fearGreedValue = getCachedFearGreed();
      const [assetSentiment, btcSentiment] = await Promise.all([
        sentimentService.getAssetSentiment(assetRow.assetId, "30d", { fearGreedValue }).catch(() => null),
        assetRow.assetId === "BTC" ? Promise.resolve(null) : sentimentService.getAssetSentiment("BTC", "30d", { fearGreedValue }).catch(() => null),
      ]);

      const health = assessAssetHealth({ assetSentiment, btcSentiment, isRetiredFromStrategy });

      if (health.status === "salida_recomendada") {
        alerts.push(StrategicAlertSchema.parse({
          id: `${assetRow.assetId}-sustitucion`,
          cycleId: input.cycleId,
          assetId: assetRow.assetId,
          type: "sustitucion_recomendada",
          severity: "critica",
          title: `${assetRow.assetId}: Sustitución recomendada`,
          message: health.reasoning,
        }));
      } else if (health.status === "riesgo_elevado") {
        alerts.push(StrategicAlertSchema.parse({
          id: `${assetRow.assetId}-deterioro`,
          cycleId: input.cycleId,
          assetId: assetRow.assetId,
          type: "debilidad_critica",
          severity: "advertencia",
          title: `${assetRow.assetId}: Deterioro detectado`,
          message: health.reasoning,
        }));
      } else if (health.status === "observacion") {
        alerts.push(StrategicAlertSchema.parse({
          id: `${assetRow.assetId}-observacion`,
          cycleId: input.cycleId,
          assetId: assetRow.assetId,
          type: "activo_en_observacion",
          severity: "info",
          title: `${assetRow.assetId}: En observación`,
          message: health.reasoning,
        }));
      }

      if (health.relativeStrengthVsBtc !== null && health.relativeStrengthVsBtc < -15) {
        alerts.push(StrategicAlertSchema.parse({
          id: `${assetRow.assetId}-debilidad-relativa`,
          cycleId: input.cycleId,
          assetId: assetRow.assetId,
          type: "debilidad_relativa",
          severity: health.relativeStrengthVsBtc < -25 ? "advertencia" : "info",
          title: `${assetRow.assetId}: Debilidad relativa vs BTC`,
          message: `Fuerza relativa vs BTC: ${health.relativeStrengthVsBtc.toFixed(1)} puntos. ${health.reasoning}`,
        }));
      }
    }

    return alerts;
  }));

  // G3+G4+G5+G6+G8 — Informe estratégico completo del ciclo (calculado por demanda, no persistido).
  ipcMain.handle("strategicDecisions:getCycleReport", withResult(async (_, input: { cycleId: string }) => {
    const { assessAssetHealth, classifyMarketPhase } = require("@crypto-control/market-data") as typeof import("@crypto-control/market-data");
    const { CycleStrategyReportSchema, PartialSaleProposalSchema, RebuyProposalSchema } = require("@crypto-control/core") as typeof import("@crypto-control/core");
    const db = getDb();

    // Market phase (G1+G2)
    const [fearGreedResult, globalMetrics] = await Promise.all([
      fearGreedService.get().catch(() => ({ value: null as number | null })),
      fetchGlobalMetrics().catch(() => ({ btcDominance: null, ethDominance: null, marketCapChangePercentage24h: null })),
    ]);
    const marketPhaseResult = classifyMarketPhase({
      fearGreed: fearGreedResult.value,
      marketCapChangePercentage24h: globalMetrics.marketCapChangePercentage24h,
      btcDominance: globalMetrics.btcDominance,
      ethDominance: globalMetrics.ethDominance,
    });

    // Active assets for this cycle
    const assetRows = db.select().from(schema.investmentAssets)
      .where(and(
        eq(schema.investmentAssets.cycleId, input.cycleId),
        eq(schema.investmentAssets.status, "active"),
      ))
      .all();

    // Health per asset (G5)
    const fearGreedValue = getCachedFearGreed();
    const healthMap = new Map<string, ReturnType<typeof assessAssetHealth>>();
    const mediaMap = new Map<string, MediaSignal>();
    for (const assetRow of assetRows) {
      const [assetSentiment, btcSentiment, mediaSignal] = await Promise.all([
        withTimeout(sentimentService.getAssetSentiment(assetRow.assetId, "30d", { fearGreedValue }).catch(() => null), 3500, `strategy:sentiment:${assetRow.assetId}`),
        assetRow.assetId === "BTC" ? Promise.resolve(null) : withTimeout(sentimentService.getAssetSentiment("BTC", "30d", { fearGreedValue }).catch(() => null), 3500, "strategy:sentiment:BTC"),
        getMediaSignal(assetRow.assetId).catch(() => emptyMediaSignal(assetRow.assetId, "Medios/analistas no disponibles")),
      ]);
      healthMap.set(assetRow.assetId, assessAssetHealth({ assetSentiment, btcSentiment, isRetiredFromStrategy: false }));
      mediaMap.set(assetRow.assetId, mediaSignal);
    }

    const allocationRows = await withTimeout(
      getPortfolioService().getAllocation().catch(() => [] as { assetId: string; valueEur: number }[]),
      5000,
      "strategy:allocation"
    ) ?? [];
    const allocationByAsset = new Map((allocationRows as { assetId: string; valueEur: number }[]).map((item) => [item.assetId, item.valueEur]));

    function mediaReason(assetId: string): string {
      const media = mediaMap.get(assetId);
      if (!media) return "Medios/analistas: sin datos.";
      const base = `Medios/analistas: ${media.sourceSummary.join(" · ")}.`;
      const headlines = media.headlines.length > 0 ? ` Titulares: ${media.headlines.slice(0, 2).join(" | ")}.` : "";
      return `${base}${headlines}`;
    }

    // G3 — Propuestas de venta parcial
    const partialSaleProposals = [];
    for (const assetRow of assetRows) {
      const health = healthMap.get(assetRow.assetId);
      if (!health) continue;
      const phase = marketPhaseResult.phase;
      const media = mediaMap.get(assetRow.assetId);
      const mediaScore = media && media.state !== "unavailable" ? media.score : 0;
      const mediaNegative = Boolean(media && media.state !== "unavailable" && mediaScore <= -30);
      const mediaPositive = Boolean(media && media.state !== "unavailable" && mediaScore >= 30);

      let type: "mantener" | "vigilar" | "venta_parcial" | "recogida_beneficios";
      let percentageSuggested: number | null = null;
      let reason: string;
      let riskLevel: "bajo" | "moderado" | "alto" | "muy_alto";

      if (health.estadoEstrategico === "sustitucion_recomendada") {
        type = "venta_parcial"; percentageSuggested = 60; riskLevel = "muy_alto";
        reason = `Deterioro severo detectado. Reducción fuerte propuesta conservando una posición residual del 40%. ${health.reasoning}`;
      } else if (health.estadoEstrategico === "deterioro") {
        type = "venta_parcial"; percentageSuggested = 30; riskLevel = "alto";
        reason = `Activo en deterioro. Reducción del 30% para limitar exposición. ${health.reasoning} ${mediaReason(assetRow.assetId)}`;
      } else if (mediaNegative && health.estadoEstrategico === "vigilancia") {
        type = "venta_parcial"; percentageSuggested = 20; riskLevel = "alto";
        reason = `Señal negativa en medios/analistas y activo en vigilancia. Propuesta de reducción parcial del 20% para proteger capital. ${health.reasoning} ${mediaReason(assetRow.assetId)}`;
      } else if (health.estadoEstrategico === "vigilancia") {
        type = "vigilar"; riskLevel = "moderado";
        reason = `Activo en zona de vigilancia. Monitorear evolución antes de actuar. ${health.reasoning} ${mediaReason(assetRow.assetId)}`;
      } else if ((phase === "euforia" || phase === "distribucion") && mediaPositive) {
        type = "recogida_beneficios";
        percentageSuggested = phase === "euforia" ? 30 : 20;
        riskLevel = "bajo";
        reason = `Mercado en ${phase} con tono positivo de medios/analistas. Propuesta de recoger beneficios (${percentageSuggested}%) sin cerrar la posición completa. ${mediaReason(assetRow.assetId)}`;
      } else if ((phase === "euforia" || phase === "distribucion") && (health.estadoEstrategico === "excelente" || health.estadoEstrategico === "buena")) {
        type = "recogida_beneficios";
        percentageSuggested = phase === "euforia" ? 30 : 20;
        riskLevel = "bajo";
        reason = `El mercado está en fase de ${phase === "euforia" ? "euforia" : "distribución"}. Considerar recoger beneficios (${percentageSuggested}%) mientras el activo mantiene buen estado. ${mediaReason(assetRow.assetId)}`;
      } else {
        type = "mantener"; riskLevel = "bajo";
        reason = health.estadoEstrategico === "excelente"
          ? `Activo en excelente estado. Mantener y continuar acumulando según el plan. ${mediaReason(assetRow.assetId)}`
          : `Activo estable. Mantener posición y seguir el plan de inversión. ${mediaReason(assetRow.assetId)}`;
      }
      const allocationValueEur = allocationByAsset.get(assetRow.assetId);
      const estimatedProceedsEur = percentageSuggested !== null && typeof allocationValueEur === "number"
        ? Math.round((allocationValueEur * percentageSuggested) * 100) / 10_000
        : null;

      partialSaleProposals.push(PartialSaleProposalSchema.parse({
        assetId: assetRow.assetId, type, percentageSuggested, reason, riskLevel, estimatedProceedsEur,
      }));
    }

    // G4 — Propuestas de recompra
    const treasury = getTreasuryRepository().getSummary(getRecommendedFiscalReserve(), getCoinbaseEurcBalance());
    const freeRebuyLiquidity = treasury.freeRebuyLiquidity;
    const rebuyProposals = [];
    const dbTiers = db.select().from(schema.cycleRebuyTiers)
      .where(eq(schema.cycleRebuyTiers.cycleId, input.cycleId))
      .orderBy(schema.cycleRebuyTiers.drawdownPercentage)
      .all();
    const tierDefs: Array<[number, number, string]> = dbTiers
      .filter(t => t.usagePercentage > 0 && t.usagePercentage < 100)
      .sort((a, b) => Math.abs(a.drawdownPercentage) - Math.abs(b.drawdownPercentage))
      .map(t => [t.drawdownPercentage, t.usagePercentage / 100, `Regla configurada: ${t.name ?? `corrección ${Math.abs(t.drawdownPercentage)}%`}`]);

    if (assetRows.length > 0) {
      for (const assetRow of assetRows) {
        const health = healthMap.get(assetRow.assetId);
        if (health?.estadoEstrategico === "sustitucion_recomendada" || health?.estadoEstrategico === "deterioro") continue;
        const media = mediaMap.get(assetRow.assetId);
        const mediaScore = media && media.state !== "unavailable" ? media.score : 0;
        const phaseSupportsRebuy = marketPhaseResult.phase === "capitulacion" || marketPhaseResult.phase === "acumulacion";
        const mediaSupportsRebuy = Boolean(media && media.state !== "unavailable" && mediaScore <= -20);
        if (!phaseSupportsRebuy && !mediaSupportsRebuy) continue;

        const fraction = assetRow.allocationPercentage !== null ? assetRow.allocationPercentage / 100 : 1 / assetRows.length;
        const assetLiquidity = freeRebuyLiquidity * fraction;
        if (freeRebuyLiquidity < 10) {
          rebuyProposals.push(RebuyProposalSchema.parse({
            assetId: assetRow.assetId,
            triggerDropPercentage: marketPhaseResult.phase === "capitulacion" ? -15 : -25,
            proposedAmountEur: 0,
            reason: `Propuesta automática pendiente: ${marketPhaseResult.phase === "capitulacion" ? "capitulación/miedo extremo" : "corrección potencial"} detectada, pero no hay EURC libre para ejecutar recompras. ${mediaReason(assetRow.assetId)}`,
            availableLiquidityEur: 0,
          }));
          continue;
        }

        if (tierDefs.length === 0) {
          rebuyProposals.push(RebuyProposalSchema.parse({
            assetId: assetRow.assetId,
            triggerDropPercentage: marketPhaseResult.phase === "capitulacion" ? -15 : -25,
            proposedAmountEur: 0,
            reason: `No hay escalones de recompra configurados. Configura porcentajes por tramo para que la propuesta use solo EURC libre y mantenga liquidez residual. ${mediaReason(assetRow.assetId)}`,
            availableLiquidityEur: Math.round(assetLiquidity * 100) / 100,
          }));
          continue;
        }

        if (assetLiquidity < 5) continue;

        let remainingAssetLiquidity = assetLiquidity;
        for (const [drop, deployFraction, label] of tierDefs) {
          const amount = Math.round(remainingAssetLiquidity * deployFraction * 100) / 100;
          if (amount < 5) continue;
          rebuyProposals.push(RebuyProposalSchema.parse({
            assetId: assetRow.assetId,
            triggerDropPercentage: drop,
            proposedAmountEur: amount,
            reason: `${label} (${drop}%): desplegar ${Math.round(deployFraction * 100)}% del EURC libre restante asignado a ${assetRow.assetId} (${remainingAssetLiquidity.toFixed(0)} EUR de ${freeRebuyLiquidity.toFixed(0)} EUR libres totales). ${mediaReason(assetRow.assetId)}`,
            availableLiquidityEur: Math.round(remainingAssetLiquidity * 100) / 100,
          }));
          remainingAssetLiquidity = Math.max(0, remainingAssetLiquidity - amount);
        }
      }
    }

    // G5/G6 — Resumen de riesgos y sugerencias de adaptación
    const riskSummary: string[] = [];
    const adaptationSuggestions: string[] = [];
    for (const [assetId, health] of healthMap) {
      if (health.estadoEstrategico === "sustitucion_recomendada") {
        riskSummary.push(`${assetId}: Sustitución recomendada — ${health.reasoning}`);
        adaptationSuggestions.push(`Planificar sustitución de ${assetId}. Usar el módulo de sustituciones para documentar el activo de destino y la fecha efectiva.`);
      } else if (health.estadoEstrategico === "deterioro") {
        riskSummary.push(`${assetId}: Deterioro detectado — ${health.reasoning}`);
      }
    }
    if (freeRebuyLiquidity === 0 && assetRows.length > 0) {
      riskSummary.push("Sin liquidez libre para recompras. Considerar liberar parte de la reserva de tesorería si hay una corrección relevante.");
    }

    return CycleStrategyReportSchema.parse({
      cycleId: input.cycleId,
      marketPhase: marketPhaseResult,
      partialSaleProposals,
      rebuyProposals,
      riskSummary,
      adaptationSuggestions,
      generatedAt: Date.now(),
    });
  }));

  // --- PERSPECTIVAS: objetivos de inversión (CRUD, persistidos en DB) ---

  ipcMain.handle("perspectives:getGoals", withResult(async () => {
    const db = getDb();
    const rows = db.select().from(schema.perspectivesGoals).all();
    return rows.map(r => ({
      id: r.id, name: r.name, type: r.type,
      targetAmountEur: r.targetAmountEur, targetDate: r.targetDate ?? null,
      priority: r.priority, notes: r.notes ?? null,
      createdAt: r.createdAt, updatedAt: r.updatedAt,
    }));
  }));

  ipcMain.handle("perspectives:createGoal", withResult(async (_, data: {
    name: string; type: string; targetAmountEur: number;
    targetDate?: number | null; priority?: number; notes?: string | null;
  }) => {
    const db = getDb();
    const id = `goal-${crypto.randomUUID()}`;
    const now = Date.now();
    db.insert(schema.perspectivesGoals).values({
      id, name: data.name, type: data.type,
      targetAmountEur: data.targetAmountEur,
      targetDate: data.targetDate ?? null,
      priority: data.priority ?? 0,
      notes: data.notes ?? null,
      createdAt: now, updatedAt: now,
    }).run();
    return { id };
  }));

  ipcMain.handle("perspectives:updateGoal", withResult(async (_, id: string, data: {
    name?: string; type?: string; targetAmountEur?: number;
    targetDate?: number | null; priority?: number; notes?: string | null;
  }) => {
    const db = getDb();
    const now = Date.now();
    const row = db.update(schema.perspectivesGoals)
      .set({ ...data, updatedAt: now })
      .where(eq(schema.perspectivesGoals.id, id))
      .returning()
      .get();
    if (!row) throw new Error(`Objetivo ${id} no encontrado.`);
    return { id: row.id, name: row.name, type: row.type,
      targetAmountEur: row.targetAmountEur, targetDate: row.targetDate ?? null,
      priority: row.priority, notes: row.notes ?? null,
      createdAt: row.createdAt, updatedAt: row.updatedAt };
  }));

  ipcMain.handle("perspectives:deleteGoal", withResult(async (_, id: string) => {
    const db = getDb();
    db.delete(schema.perspectivesGoals).where(eq(schema.perspectivesGoals.id, id)).run();
    return null;
  }));

  // --- PERSPECTIVAS: snapshot consolidado para el motor de proyección ---
  // Solo lee datos; no ejecuta compras, ventas ni conversiones.

  ipcMain.handle("perspectives:getConsolidatedSnapshot", withResult(async () => {
    return await buildPerspectivesSnapshot();
  }));

  ipcMain.handle("perspectives:getProjection", withResult(async (_, input?: { horizonYears?: number; complianceRate?: number; simulationPolicy?: string }) => {
    const { runAllScenarios, compareScenarios, validateWealthFloor, validateScenarioOrdering, buildContributionLedger, SPANISH_FISCAL_CONFIG_2024 } = require("@crypto-control/portfolio") as typeof import("@crypto-control/portfolio");
    const now = Date.now();
    const horizonYears = Math.min(Math.max(input?.horizonYears ?? 10, 1), 30);
    const horizonDate = now + horizonYears * 365.25 * 24 * 3600 * 1000;
    const complianceRate = Math.min(Math.max(input?.complianceRate ?? 1.0, 0), 1);
    const VALID_POLICIES = new Set(["plan_base", "confirmed_only", "confirmed_plus_proposals", "full_strategy"]);
    const simulationPolicy = VALID_POLICIES.has(input?.simulationPolicy ?? "") ? input!.simulationPolicy! : "confirmed_plus_proposals";
    const snapshot = await buildPerspectivesSnapshot(now);
    const portfolioAssetIds = [
      ...Object.keys(snapshot.positions),
      ...snapshot.cycles.flatMap(c => c.assets.map(a => a.assetId)),
    ].filter(id => id !== "EURC" && id !== "EUR");
    const dynamicFactors = await getProjectionDynamicFactors(portfolioAssetIds);

    const scenarioSet = runAllScenarios(
      snapshot,
      horizonDate,
      { complianceRate, projectExtraordinaryContributions: true, simulationPolicy: simulationPolicy as any },
      SPANISH_FISCAL_CONFIG_2024,
      now,
      dynamicFactors,
    );
    const comparison = compareScenarios(scenarioSet);
    const wealthFloorViolations = validateWealthFloor(scenarioSet);
    const orderingViolations = validateScenarioOrdering(scenarioSet);
    const contributionLedger = buildContributionLedger(
      snapshot.cycles,
      snapshot.planName,
      now,
      horizonDate,
      snapshot.plans?.length ?? 1,
    );
    const goalRows = db.select().from(schema.perspectivesGoals)
      .orderBy(asc(schema.perspectivesGoals.priority), asc(schema.perspectivesGoals.createdAt))
      .all();

    const LABELS: Record<string, string> = {
      conservador: "Conservador", moderado: "Moderado", base: "Base",
      favorable: "Favorable", muy_favorable: "Muy favorable",
      optimista: "Optimista", dinamico: "Dinámico actual", cero: "Control 0%",
    };

    const scenarios = (["conservador", "moderado", "base", "favorable", "muy_favorable", "optimista", "dinamico", "cero"] as const).map(s => {
      const out = scenarioSet[s];
      const hypothesisByAsset = new Map(out.scenarioHypotheses.assetRates.map(rate => [rate.assetId, rate]));
      let priorityTargetBefore = 0;
      const goalResults = goalRows.map(goal => {
        const targetAmountEur = goal.targetAmountEur;
        const currentAssignedEur = Math.min(targetAmountEur, Math.max(0, out.summary.initialGrossWealthEur - priorityTargetBefore));
        const projectedAssignedEur = Math.min(targetAmountEur, Math.max(0, out.summary.finalNetWealthEur - priorityTargetBefore));
        const reachedPeriod = out.periods.find(period =>
          Math.max(0, period.netWealthEur - priorityTargetBefore) >= targetAmountEur
        ) ?? null;
        priorityTargetBefore += targetAmountEur;
        return {
          id: goal.id,
          name: goal.name,
          type: goal.type,
          targetAmountEur,
          targetDate: goal.targetDate ?? null,
          priority: goal.priority,
          currentAssignedEur: Math.round(currentAssignedEur * 100) / 100,
          projectedAssignedEur: Math.round(projectedAssignedEur * 100) / 100,
          progress: targetAmountEur > 0 ? Math.min(1, projectedAssignedEur / targetAmountEur) : 0,
          reachedAt: reachedPeriod?.date ?? null,
          reachedYear: reachedPeriod ? new Date(reachedPeriod.date).getFullYear() : null,
          isReached: reachedPeriod != null,
        };
      });

      return {
        scenario: s,
        label: LABELS[s],
        probability: out.summary.probability,
        confidence: out.summary.confidence,
        summary: {
          initialGrossWealthEur: out.summary.initialGrossWealthEur,
          finalGrossWealthEur: out.summary.finalGrossWealthEur,
          finalNetWealthEur: out.summary.finalNetWealthEur,
          historicalCapitalEur: out.summary.historicalCapitalEur,
          totalFutureCapitalEur: out.summary.totalFutureCapitalEur,
          totalCapitalEur: out.summary.totalCapitalEur,
          estimatedMarketGainEur: out.summary.estimatedMarketGainEur,
          treasuryInterestEur: out.summary.treasuryInterestEur,
          estimatedFeesEur: out.summary.estimatedFeesEur,
          weightedAnnualReturn: out.summary.weightedAnnualReturn,
          xirrAnnual: out.summary.xirrAnnual ?? null,
          twrAnnual: out.summary.twrAnnual ?? null,
          roiAccumulated: out.summary.roiAccumulated ?? null,
          controlCeroWealth: out.summary.controlCeroWealth ?? null,
          control5pctWealth: out.summary.control5pctWealth ?? null,
          control7pctWealth: out.summary.control7pctWealth ?? null,
          totalRealizedGainEur: out.summary.totalRealizedGainEur,
          totalUnrealizedGainEur: out.summary.totalUnrealizedGainEur,
          totalTaxGeneratedEur: out.summary.totalTaxGeneratedEur,
          totalTaxPendingEur: out.summary.totalTaxPendingEur,
          finalEurcAvailableEur: out.summary.finalEurcAvailableEur,
          finalCashEur: out.summary.finalCashEur,
          finalFiscalReserveEur: out.summary.finalFiscalReserveEur,
          simulationPolicy: out.summary.simulationPolicy,
          salesZeroExplanation: out.summary.salesZeroExplanation ?? null,
          rebuysZeroExplanation: out.summary.rebuysZeroExplanation ?? null,
          hypotheticalSalesCount: out.summary.hypotheticalSales.length,
          hypotheticalRebuysCount: out.summary.hypotheticalRebuys.length,
          hypotheticalSales: out.summary.hypotheticalSales.slice(0, 5),
          hypotheticalRebuys: out.summary.hypotheticalRebuys.slice(0, 5),
        },
        hypotheses: out.scenarioHypotheses.assetRates.map(rate => ({
          assetId: rate.assetId,
          annualGrowthRate: rate.annualGrowthRate,
          volatility: rate.volatility,
          correctionDepth: rate.correctionDepth,
          source: rate.source ?? null,
          hypothesis: rate.hypothesis ?? null,
          dataQuality: rate.dataQuality ?? null,
          confidence: rate.confidence ?? null,
        })),
        chartPoints: out.periods.map(p => ({
          date: p.date,
          grossWealthEur: p.grossWealthEur,
          netWealthEur: p.netWealthEur,
          portfolioValueEur: p.portfolioValueEur,
          cashEur: p.cashEur,
          eurcAvailableEur: p.eurcAvailableEur,
        })),
        annualBreakdown: (() => {
          const lastCycleEndMs = snapshot.cycles.reduce((max, c) =>
            c.endDate != null ? Math.max(max, c.endDate) : max, 0);

          if (out.periods.length === 0) return [];

          // last period of each year, and all periods per year (for events)
          const byYear = new Map<number, typeof out.periods[0]>();
          const periodsByYear = new Map<number, (typeof out.periods[0])[]>();
          for (const p of out.periods) {
            const y = new Date(p.date).getUTCFullYear();
            byYear.set(y, p);
            if (!periodsByYear.has(y)) periodsByYear.set(y, []);
            periodsByYear.get(y)!.push(p);
          }

          let prevWealth = out.summary.initialGrossWealthEur;
          let prevFutureCapital = 0;
          let prevSales = 0;
          let prevRebuys = 0;
          let prevTax = 0;

          return [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, last]) => {
            const contributions = last.futureCapitalEur - prevFutureCapital;
            const sales = last.totalSalesEur - prevSales;
            const rebuys = last.totalRebuysEur - prevRebuys;
            const tax = last.taxGeneratedEur - prevTax;
            const marketGain = last.grossWealthEur - prevWealth - contributions;
            const yearEndMs = new Date(Date.UTC(year, 11, 31)).getTime();
            const annualGrowthPct = prevWealth > 0
              ? Math.round(((last.grossWealthEur - prevWealth) / prevWealth) * 10000) / 100
              : null;

            // collect all events from this year's periods
            const yearEvents = (periodsByYear.get(year) ?? []).flatMap(p => p.events ?? []);

            const row = {
              year,
              inheritedWealthEur: Math.round(prevWealth * 100) / 100,
              contributionsEur: Math.round(contributions * 100) / 100,
              salesEur: Math.round(sales * 100) / 100,
              rebuysEur: Math.round(rebuys * 100) / 100,
              taxEur: Math.round(tax * 100) / 100,
              marketGainEur: Math.round(marketGain * 100) / 100,
              endWealthEur: Math.round(last.grossWealthEur * 100) / 100,
              annualGrowthPct,
              eurcAvailableEur: Math.round((last.eurcAvailableEur ?? 0) * 100) / 100,
              fiscalReserveEur: Math.round((last.fiscalReserveEur ?? 0) * 100) / 100,
              scope: (lastCycleEndMs > 0 && yearEndMs > lastCycleEndMs ? "extrapol" : "plan") as "plan" | "extrapol",
              positions: last.positions ?? {},
              events: yearEvents,
            };

            prevWealth = last.grossWealthEur;
            prevFutureCapital = last.futureCapitalEur;
            prevSales = last.totalSalesEur;
            prevRebuys = last.totalRebuysEur;
            prevTax = last.taxGeneratedEur;
            return row;
          });
        })(),
        assetResults: out.assetResults.map(a => ({
          assetId: a.assetId,
          initialBalance: a.initialBalance,
          initialValueEur: a.initialValueEur,
          initialAvgCostEur: a.initialAvgCostEur,
          balanceBoughtContributions: a.balanceBoughtContributions,
          balanceBoughtExtraordinary: a.balanceBoughtExtraordinary,
          balanceSold: a.balanceSold,
          balanceRebought: a.balanceRebought,
          finalBalance: a.finalBalance,
          costContributionsEur: a.costContributionsEur,
          costRebuyEur: a.costRebuyEur,
          salesProceedsEur: a.salesProceedsEur,
          finalValueEur: a.finalValueEur,
          finalPriceEur: a.finalPriceEur,
          finalAvgCostEur: a.finalAvgCostEur,
          unrealizedGainEur: a.unrealizedGainEur,
          realizedGainEur: a.realizedGainEur,
          targetAmount: a.targetAmount,
          targetValueEur: a.targetValueEur,
          goalReachedProjectedAt: a.goalReachedProjectedAt,
          hypothesis: hypothesisByAsset.has(a.assetId)
            ? {
              annualGrowthRate: hypothesisByAsset.get(a.assetId)!.annualGrowthRate,
              terminalAnnualRate: hypothesisByAsset.get(a.assetId)!.terminalAnnualRate ?? 0,
              source: hypothesisByAsset.get(a.assetId)!.source ?? null,
              hypothesis: hypothesisByAsset.get(a.assetId)!.hypothesis ?? null,
              dataQuality: hypothesisByAsset.get(a.assetId)!.dataQuality ?? null,
              confidence: hypothesisByAsset.get(a.assetId)!.confidence ?? null,
            }
            : null,
          annualPriceTrajectory: a.annualPriceTrajectory ?? null,
        })),
        cycleResults: out.cycleResults.map(cycle => ({
          cycleId: cycle.cycleId,
          cycleName: cycle.cycleName,
          startDate: cycle.startDate,
          endDate: cycle.endDate,
          plannedContributionEur: cycle.plannedContributionEur,
          simulatedContributionEur: cycle.simulatedContributionEur,
          extraordinaryContributionEur: cycle.extraordinaryContributionEur,
          salesEur: cycle.salesEur,
          rebuysEur: cycle.rebuysEur,
          taxGeneratedEur: cycle.taxGeneratedEur,
          eurcGeneratedEur: cycle.eurcGeneratedEur,
          eurcUsedEur: cycle.eurcUsedEur,
          buysByAsset: cycle.buysByAsset,
          goalReachedAssets: cycle.goalReachedAssets,
        })),
        goalResults,
      };
    });

    const currentPortfolioValueEur = Object.values(snapshot.positions)
      .reduce((sum, position) => sum + (position.currentValueEur ?? 0), 0);

    return {
      snapshot: {
        snapshotId: snapshot.snapshotId,
        generatedAt: snapshot.generatedAt,
        planId: snapshot.planId,
        planName: snapshot.planName,
        plans: snapshot.plans ?? [],
        cycles: snapshot.cycles.map(cycle => ({
          id: cycle.id,
          planId: cycle.planId,
          name: cycle.name,
          startDate: cycle.startDate,
          endDate: cycle.endDate,
          monthlyAmountEur: cycle.monthlyAmountEur,
          status: cycle.status,
          assetCount: cycle.assets.length,
        })),
        historicalCapitalEur: snapshot.historicalCapitalEur,
        historicalSalesEur: snapshot.historicalSalesEur,
        currentPortfolioValueEur,
        positionCount: Object.keys(snapshot.positions).length,
        treasury: snapshot.treasury,
        dataQuality: snapshot.dataQuality,
        positions: snapshot.positions,
        fiscalVersion: snapshot.fiscalVersion,
        strategyVersion: snapshot.strategyVersion,
      },
      scenarios,
      comparison,
      contributionLedger,
      wealthFloorViolations,
      orderingViolations,
      horizonYears,
      generatedAt: now,
    };
  }));

  // --- PERSPECTIVAS v2: motor de simulación mensual por activo (nuevo desde cero) ---

  ipcMain.handle("persp2:getSimulation", withResult(async (_, input?: {
    horizonYears?: number;
    policy?: "plan_base" | "full_strategy";
  }) => {
    const { runPerspectivesSimulation, DEFAULT_SPANISH_TAX_BANDS } = require("@crypto-control/portfolio") as typeof import("@crypto-control/portfolio");
    const now = Date.now();
    const horizonYears = Math.min(Math.max(input?.horizonYears ?? 10, 1), 30);
    const horizonDate = now + horizonYears * 365.25 * 24 * 3600 * 1000;

    // Read active plan + cycles
    const planRows = db.select().from(schema.investmentPlans)
      .where(eq(schema.investmentPlans.status, "active"))
      .orderBy(asc(schema.investmentPlans.createdAt))
      .all();
    if (planRows.length === 0) throw new Error("No hay un plan de inversión activo.");
    const planIds = planRows.map(p => p.id);

    const cycleRows = db.select().from(schema.investmentCycles)
      .where(inArray(schema.investmentCycles.planId, planIds))
      .orderBy(asc(schema.investmentCycles.startDate), asc(schema.investmentCycles.priority))
      .all()
      .filter(c => c.status === "active" || c.status === "planned");
    const cycleIds = cycleRows.map(c => c.id);

    const allAssetRows = cycleIds.length > 0
      ? db.select().from(schema.investmentAssets)
        .where(inArray(schema.investmentAssets.cycleId, cycleIds))
        .all()
      : [];

    const saleRuleRows = cycleIds.length > 0
      ? db.select().from(schema.partialSaleRules)
        .where(inArray(schema.partialSaleRules.cycleId, cycleIds))
        .all()
      : [];

    const rebuyTierRows = cycleIds.length > 0
      ? db.select().from(schema.cycleRebuyTiers)
        .where(inArray(schema.cycleRebuyTiers.cycleId, cycleIds))
        .all()
      : [];

    const substitutionRows = cycleIds.length > 0
      ? db.select().from(schema.assetSubstitutions)
        .where(inArray(schema.assetSubstitutions.cycleId, cycleIds))
        .all()
        .filter(r => r.status === "programada" && r.toAssetId != null)
      : [];

    const revisionRows = cycleIds.length > 0
      ? db.select().from(schema.strategyRevisions)
        .where(inArray(schema.strategyRevisions.cycleId, cycleIds))
        .orderBy(asc(schema.strategyRevisions.effectiveDate))
        .all()
        .filter(r => r.effectiveDate > now)
      : [];

    // Build SimCycles
    const cycles = cycleRows.map(c => ({
      id: c.id,
      planId: c.planId,
      name: c.name,
      startDate: c.startDate,
      endDate: c.endDate ?? null,
      monthlyAmountEur: c.monthlyAmountEur,
      assets: allAssetRows
        .filter(a => a.cycleId === c.id)
        .map(a => ({
          id: a.id,
          assetId: a.assetId,
          allocationType: (a.allocationType ?? "percentage") as "percentage" | "amount",
          allocationValue: a.allocationValue ?? 0,
          allocationPercentage: a.allocationPercentage ?? null,
          fixedAmountEur: a.fixedAmountEur ?? null,
          targetAmount: a.targetAmount ?? null,
          targetValueEur: a.targetValueEur ?? null,
          startDate: a.startDate ?? c.startDate,
          endDate: a.endDate ?? null,
          status: (a.status ?? "active") as "active" | "paused" | "closed" | "goal_reached",
        })),
      saleRules: saleRuleRows
        .filter(r => r.cycleId === c.id)
        .map(r => ({
          id: r.id,
          assetId: r.assetId ?? null,
          triggerType: (r.conditionType ?? "gain_multiple") as "gain_multiple" | "price_target" | "portfolio_weight",
          triggerValue: r.conditionValue ?? 0,
          sellPercentage: r.sellPercentage,
          status: (r.status === "activa" ? "active" : "cancelled") as "active" | "pending" | "triggered" | "cancelled",
          triggeredAt: r.lastTriggeredAt ?? null,
        })),
      rebuyTiers: rebuyTierRows
        .filter(r => r.cycleId === c.id)
        .map(r => ({
          id: r.id,
          assetId: r.assetId ?? null,
          drawdownPercentage: r.drawdownPercentage,
          usagePercentage: r.usagePercentage,
          referenceType: (r.referenceType === "last_sale" ? "last_sale" : r.referenceType === "cycle_peak" ? "cycle_peak" : null) as "last_sale" | "cycle_peak" | null,
          status: (r.status === "activa" ? "active" : "cancelled") as "active" | "triggered" | "cancelled",
        })),
      substitutions: substitutionRows
        .filter(r => r.cycleId === c.id)
        .map(r => ({
          id: r.id,
          fromAssetId: r.fromAssetId,
          toAssetId: r.toAssetId!,
          effectiveDate: r.effectiveDate,
          status: "pending" as const,
        })),
      revisions: revisionRows
        .filter(r => r.cycleId === c.id)
        .map(r => ({
          id: r.id,
          effectiveDate: r.effectiveDate,
          changesJson: r.changesJson ?? "{}",
        })),
    }));

    // Read current portfolio positions + lots
    const portfolioService = getPortfolioService();
    const portfolioPositions = (await portfolioService.getPositions()).positions as Record<string, {
      balance: number; averagePriceEur: number | null; totalInvestedEur: number;
    }>;

    const lotRows = db.select().from(schema.lots)
      .orderBy(asc(schema.lots.date))
      .all()
      .filter(l => l.remainingAmount != null && l.remainingAmount > 0);

    const investablePositionIds = Object.entries(portfolioPositions)
      .filter(([assetId, pos]) => isInvestableAsset(assetId) && pos.balance > 1e-12)
      .map(([assetId]) => assetId);

    const allSimAssetIds = Array.from(new Set([
      ...investablePositionIds,
      ...allAssetRows.map(a => a.assetId).filter(isInvestableAsset),
    ]));

    // Fetch current prices
    const prices: Record<string, number | null> = {};
    await Promise.all(allSimAssetIds.map(async (assetId) => {
      const r = await getSnapshotPrice(assetId);
      prices[assetId] = finiteOrNull(r.price);
    }));

    const currentPositions = investablePositionIds.map(assetId => ({
      assetId,
      balance: portfolioPositions[assetId]?.balance ?? 0,
      avgCostEur: finiteOrNull(portfolioPositions[assetId]?.averagePriceEur ?? null),
      currentPriceEur: prices[assetId] ?? null,
    }));

    const currentLots = lotRows
      .filter(l => isInvestableAsset(l.assetId))
      .map(l => ({
        id: l.id,
        assetId: l.assetId,
        date: l.date,
        remainingAmount: l.remainingAmount ?? 0,
        unitAcquisitionPriceEur: l.unitAcquisitionPriceEur ?? 0,
      }));

    const historicalCapitalEur = investablePositionIds.reduce(
      (s, id) => s + (portfolioPositions[id]?.totalInvestedEur ?? 0), 0
    );

    const treasurySummary = getTreasuryRepository().getSummary(getRecommendedFiscalReserve(), getCoinbaseEurcBalance());
    const eurcFree = Math.max(0, (treasurySummary?.eurcBalance ?? 0) - (treasurySummary?.fiscalReserveBalance ?? 0));
    const eurcFiscalReserve = treasurySummary?.fiscalReserveBalance ?? 0;
    const eurCash = treasurySummary?.cashBalance ?? 0;

    const simInput = {
      now,
      horizonDate,
      currentPositions,
      currentLots,
      eurcFree,
      eurcFiscalReserve,
      eurCash,
      historicalCapitalEur,
      cycles,
      options: {
        policy: (input?.policy ?? "full_strategy") as "plan_base" | "full_strategy",
        commissionRate: 0.004,
        taxBands: DEFAULT_SPANISH_TAX_BANDS,
      },
    };

    return runPerspectivesSimulation(simInput);
  }));

  // --- COMPRA INTELIGENTE: recomendación explicable sin ejecución automática ---

  ipcMain.handle("smartBuy:getRecommendation", withResult(async (_, input: {
    cycleId: string;
    amount: number;
    mode?: "plan" | "equilibrar" | "oportunidad" | "mixto" | "potencial";
    originType?: "cash" | "eurc";
    weights?: { planPct?: number; balancePct?: number; opportunityPct?: number; potentialPct?: number };
    horizon?: "1-3y" | "3-5y" | "5y+";
  }) => {
    const { calculateSmartBuyAllocation } = require("@crypto-control/portfolio") as typeof import("@crypto-control/portfolio");
    const db = getDb();
    const requestedEurcForSmartBuy = input.originType === "eurc";
    const smartBuyOrigin: "cash" = "cash";
    const smartBuyOriginRestriction = "Compra Inteligente usa aportaciones EUR; las recompras usan la reserva/liquidez EURC en Ventas/Recompras.";

    const assetRows = db.select().from(schema.investmentAssets)
      .where(eq(schema.investmentAssets.cycleId, input.cycleId))
      .all();

    const now = Date.now();

    if (assetRows.length === 0) {
      return {
        cycleId: input.cycleId,
        analyzedAmountEur: input.amount,
        totalPortfolioValueEur: null,
        recommendations: [],
        hasOpportunities: false,
        restrictionsApplied: requestedEurcForSmartBuy
          ? [smartBuyOriginRestriction, "Sin activos activos en el ciclo"]
          : ["Sin activos activos en el ciclo"],
        pendingAmountEur: input.amount,
        dataQuality: "sin_datos" as const,
        mode: input.mode ?? "plan",
        originType: smartBuyOrigin,
        generatedAt: now,
      };
    }

    const [portfolioResult, allocations] = await Promise.all([
      withTimeout(getPortfolioService().getPositions().catch(() => ({ positions: {} })), 7000, "smartBuy:positions"),
      withTimeout(getPortfolioService().getAllocation().catch(() => [] as { assetId: string; valueEur: number }[]), 7000, "smartBuy:allocation"),
    ]);
    const safePortfolioResult = portfolioResult ?? { positions: {} };
    const safeAllocations = allocations ?? [];
    const allocationMap = new Map(safeAllocations.map((a: { assetId: string; valueEur: number }) => [a.assetId, a]));
    const totalPortfolioValue = safeAllocations.reduce((sum: number, a: { valueEur: number }) => sum + a.valueEur, 0);
    const positionRows = safePortfolioResult.positions as Record<string, { balance: number; averagePriceEur: number | null; hasPendingValuation?: boolean }>;
    const planAssetIds = new Set(assetRows.map((asset) => asset.assetId));
    const assets = assetRows.map((asset) => ({
      assetId: asset.assetId,
      status: asset.status ?? "active",
      targetAllocationPct: asset.allocationPercentage ?? null,
      goalReachedAt: asset.goalReachedAt ?? null,
      priority: asset.priority ?? null,
      isInPlan: true,
    }));

    if (input.mode === "potencial") {
      for (const [assetId, position] of Object.entries(positionRows)) {
        if (planAssetIds.has(assetId) || (position.balance ?? 0) <= 0) continue;
        assets.push({
          assetId,
          status: "active",
          targetAllocationPct: null,
          goalReachedAt: null,
          priority: 999,
          isInPlan: false,
        });
      }
    }

    async function buildSmartPosition(assetId: string) {
      const local = positionRows[assetId];
      const allocation = allocationMap.get(assetId);
      const balance = local?.balance ?? 0;
      let currentPriceEur: number | null = balance > 0 && allocation?.valueEur ? allocation.valueEur / balance : null;
      const currentValueEur = allocation?.valueEur ?? (balance > 0 && currentPriceEur !== null ? balance * currentPriceEur : null);

      let priceChange24hPct: number | null = null;
      let priceChange7dPct: number | null = null;
      let drawdownFromRecentHighPct: number | null = null;

      const [priceResult, history] = await Promise.all([
        currentPriceEur === null || !Number.isFinite(currentPriceEur)
          ? withTimeout(marketService.getCurrentPriceEur(assetId).catch(() => null), 3500, `smartBuy:price:${assetId}`)
          : Promise.resolve(null),
        withTimeout(marketService.getHistoricalPrices(assetId, "7d").catch(() => null), 4500, `smartBuy:history:${assetId}`),
      ]);

      if ((currentPriceEur === null || !Number.isFinite(currentPriceEur)) && priceResult?.price) {
        currentPriceEur = priceResult.price;
      }

      if (history) {
        const points = [...history.points]
          .filter((point: { price: number; timestamp: number }) => Number.isFinite(point.price) && point.price > 0)
          .sort((a: { timestamp: number }, b: { timestamp: number }) => a.timestamp - b.timestamp);
        const latest = currentPriceEur ?? points.at(-1)?.price ?? null;
        if (latest !== null && points.length > 0) {
          if (currentPriceEur === null || !Number.isFinite(currentPriceEur)) currentPriceEur = latest;
          const first7d = points[0]?.price ?? null;
          const first24h = points.find((point: { timestamp: number }) => point.timestamp >= now - 24 * 60 * 60 * 1000)?.price ?? null;
          const high = points.reduce((max: number, point: { price: number }) => Math.max(max, point.price), 0);
          priceChange7dPct = first7d ? ((latest - first7d) / first7d) * 100 : null;
          priceChange24hPct = first24h ? ((latest - first24h) / first24h) * 100 : null;
          drawdownFromRecentHighPct = high > 0 ? ((latest - high) / high) * 100 : null;
        }
      }

      return {
        assetId,
        balance,
        currentValueEur: currentValueEur !== null && Number.isFinite(currentValueEur) ? currentValueEur : null,
        averagePriceEur: local?.hasPendingValuation ? null : local?.averagePriceEur ?? null,
        currentPriceEur: currentPriceEur !== null && Number.isFinite(currentPriceEur) ? currentPriceEur : null,
        priceChange24hPct,
        priceChange7dPct,
        drawdownFromRecentHighPct,
      };
    }

    const smartPositions = Object.fromEntries(
      await Promise.all(assets.map(async (asset) => [asset.assetId, await buildSmartPosition(asset.assetId)]))
    );
    const treasurySummary = getTreasuryRepository().getSummary(getRecommendedFiscalReserve(), getCoinbaseEurcBalance());
    const result = calculateSmartBuyAllocation(
      assets,
      smartPositions,
      Number(input.amount),
      totalPortfolioValue > 0 ? Math.round(totalPortfolioValue * 100) / 100 : null,
      input.mode ?? "plan",
      smartBuyOrigin,
      {
        eurcBalance: treasurySummary.eurcBalance,
        fiscalReserveBalance: treasurySummary.fiscalReserveBalance,
        freeRebuyLiquidity: treasurySummary.freeRebuyLiquidity,
      },
      30,
      now,
      { weights: input.weights, horizon: input.horizon }
    );

    return {
      ...result,
      cycleId: input.cycleId,
      originType: smartBuyOrigin,
      restrictionsApplied: requestedEurcForSmartBuy
        ? [smartBuyOriginRestriction, ...result.restrictionsApplied]
        : result.restrictionsApplied,
    };
  }));

  // --- REGLAS DE RECOMPRA: CRUD sobre cycleRebuyTiers ---

  function mapRebuyTier(r: typeof schema.cycleRebuyTiers.$inferSelect) {
    return {
      id: r.id,
      cycleId: r.cycleId,
      assetId: r.assetId ?? null,
      name: r.name ?? null,
      drawdownPercentage: r.drawdownPercentage,
      usagePercentage: r.usagePercentage,
      priority: r.priority ?? 0,
      status: r.status ?? "activa",
      effectiveDate: r.effectiveDate ?? null,
      notes: r.notes ?? null,
      referenceType: r.referenceType ?? null,
      referenceValue: r.referenceValue ?? null,
      referenceDate: r.referenceDate ?? null,
      lastTriggeredAt: r.lastTriggeredAt ?? null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  ipcMain.handle("rebuyTiers:list", withResult(async (_, input: { cycleId: string }) => {
    const db = getDb();
    const rows = db.select().from(schema.cycleRebuyTiers)
      .where(eq(schema.cycleRebuyTiers.cycleId, input.cycleId))
      .orderBy(schema.cycleRebuyTiers.drawdownPercentage)
      .all();
    return rows.map(mapRebuyTier);
  }));

  ipcMain.handle("rebuyTiers:upsert", withResult(async (_, data: { id?: string; cycleId: string; assetId?: string | null; name?: string | null; drawdownPercentage: number; usagePercentage: number; priority?: number; status?: string; effectiveDate?: number | null; notes?: string | null; referenceType?: string | null; referenceValue?: number | null; referenceDate?: number | null }) => {
    const db = getDb();
    const now = Date.now();
    const id = data.id ?? crypto.randomUUID();
    if (!Number.isFinite(data.drawdownPercentage) || data.drawdownPercentage <= 0 || data.drawdownPercentage > 100) {
      throw new Error("La caída del escalón debe estar entre 0 y 100%.");
    }
    if (!Number.isFinite(data.usagePercentage) || data.usagePercentage <= 0 || data.usagePercentage >= 100) {
      throw new Error("El porcentaje de EURC debe ser mayor que 0 y menor que 100%; siempre debe quedar EURC residual.");
    }
    db.insert(schema.cycleRebuyTiers)
      .values({
        id, cycleId: data.cycleId,
        assetId: data.assetId ?? null,
        name: data.name ?? null,
        drawdownPercentage: data.drawdownPercentage,
        usagePercentage: data.usagePercentage,
        priority: data.priority ?? 0,
        status: data.status ?? "activa",
        effectiveDate: data.effectiveDate ?? null,
        notes: data.notes ?? null,
        referenceType: data.referenceType ?? null,
        referenceValue: data.referenceValue ?? null,
        referenceDate: data.referenceDate ?? null,
        createdAt: now, updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.cycleRebuyTiers.id,
        set: {
          drawdownPercentage: data.drawdownPercentage,
          usagePercentage: data.usagePercentage,
          assetId: data.assetId ?? null,
          name: data.name ?? null,
          priority: data.priority ?? 0,
          status: data.status ?? "activa",
          effectiveDate: data.effectiveDate ?? null,
          notes: data.notes ?? null,
          referenceType: data.referenceType ?? null,
          referenceValue: data.referenceValue ?? null,
          referenceDate: data.referenceDate ?? null,
          updatedAt: now,
        },
      })
      .run();
    return { id };
  }));

  ipcMain.handle("rebuyTiers:delete", withResult(async (_, id: string) => {
    const db = getDb();
    db.delete(schema.cycleRebuyTiers).where(eq(schema.cycleRebuyTiers.id, id)).run();
    return null;
  }));

  ipcMain.handle("rebuyTiers:evaluate", withResult(async (_, input: { cycleId: string; assetId?: string }) => {
    const db = getDb();
    const { evaluateRebuyTiersExtended } = require("@crypto-control/portfolio") as typeof import("@crypto-control/portfolio");

    const tierRows = db.select().from(schema.cycleRebuyTiers)
      .where(eq(schema.cycleRebuyTiers.cycleId, input.cycleId))
      .all();

    const tiers = tierRows.map(mapRebuyTier).filter(t => t.status === "activa");

    const treasurySummary = getTreasuryRepository().getSummary(getRecommendedFiscalReserve(), getCoinbaseEurcBalance());
    const availableLiquidityEur = Math.max(0, treasurySummary?.freeRebuyLiquidity ?? ((treasurySummary?.eurcBalance ?? 0) - (treasurySummary?.fiscalReserveBalance ?? 0)));

    const allocations = await getPortfolioService().getAllocation();
    const prices: Record<string, number | null> = {};
    for (const a of (allocations as { assetId: string; valueEur: number }[])) {
      const pos = await getPortfolioService().getPositions();
      const balance = (pos.positions as Record<string, { balance: number }>)[a.assetId]?.balance;
      prices[a.assetId] = balance > 0 ? a.valueEur / balance : null;
    }

    const results = evaluateRebuyTiersExtended(tiers as any, prices, availableLiquidityEur);
    const triggered = results.filter(r => r.isTriggered).map(r => mapRebuyTier(tierRows.find(t => t.id === r.tier.id)!));
    const totalSuggestedEur = results.reduce((s, r) => s + (r.preview?.proposedAmountEur ?? 0), 0);

    return { triggered, availableLiquidityEur, totalSuggestedEur };
  }));

  // --- REGLAS DE VENTA PARCIAL ---

  function mapPartialSaleRule(r: typeof schema.partialSaleRules.$inferSelect) {
    return {
      id: r.id,
      planId: r.planId ?? null,
      cycleId: r.cycleId,
      investmentAssetId: r.investmentAssetId ?? null,
      assetId: r.assetId,
      name: r.name,
      conditionType: r.conditionType as import("@crypto-control/core").PartialSaleConditionType,
      conditionValue: r.conditionValue ?? null,
      conditionValue2: r.conditionValue2 ?? null,
      sellPercentage: r.sellPercentage,
      priority: r.priority,
      status: r.status as import("@crypto-control/core").PartialSaleRuleStatus,
      effectiveDate: r.effectiveDate ?? null,
      notes: r.notes ?? null,
      lastTriggeredAt: r.lastTriggeredAt ?? null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  ipcMain.handle("partialSaleRules:list", withResult(async (_, input: { cycleId: string; assetId?: string; status?: string }) => {
    const db = getDb();
    let q = db.select().from(schema.partialSaleRules).where(eq(schema.partialSaleRules.cycleId, input.cycleId));
    const rows = q.all();
    return rows
      .filter(r => !input.assetId || r.assetId === input.assetId)
      .filter(r => !input.status || r.status === input.status)
      .map(mapPartialSaleRule);
  }));

  ipcMain.handle("partialSaleRules:create", withResult(async (_, data: import("@crypto-control/core").CreatePartialSaleRuleInput) => {
    const { CreatePartialSaleRuleSchema } = require("@crypto-control/core") as typeof import("@crypto-control/core");
    const parsed = CreatePartialSaleRuleSchema.parse(data);
    const db = getDb();
    const now = Date.now();
    const id = crypto.randomUUID();
    db.insert(schema.partialSaleRules).values({
      id,
      planId: parsed.planId ?? null,
      cycleId: parsed.cycleId,
      investmentAssetId: parsed.investmentAssetId ?? null,
      assetId: parsed.assetId,
      name: parsed.name,
      conditionType: parsed.conditionType,
      conditionValue: parsed.conditionValue ?? null,
      conditionValue2: parsed.conditionValue2 ?? null,
      sellPercentage: parsed.sellPercentage,
      priority: parsed.priority ?? 0,
      status: parsed.status ?? "activa",
      effectiveDate: parsed.effectiveDate ?? null,
      notes: parsed.notes ?? null,
      createdAt: now, updatedAt: now,
    }).run();
    const row = db.select().from(schema.partialSaleRules).where(eq(schema.partialSaleRules.id, id)).get();
    return mapPartialSaleRule(row!);
  }));

  ipcMain.handle("partialSaleRules:update", withResult(async (_, id: string, data: import("@crypto-control/core").UpdatePartialSaleRuleInput) => {
    const { UpdatePartialSaleRuleSchema } = require("@crypto-control/core") as typeof import("@crypto-control/core");
    const parsed = UpdatePartialSaleRuleSchema.parse(data);
    const db = getDb();
    const now = Date.now();
    const updates: Record<string, unknown> = { updatedAt: now };
    if (parsed.name !== undefined) updates.name = parsed.name;
    if (parsed.conditionType !== undefined) updates.conditionType = parsed.conditionType;
    if (parsed.conditionValue !== undefined) updates.conditionValue = parsed.conditionValue;
    if (parsed.conditionValue2 !== undefined) updates.conditionValue2 = parsed.conditionValue2;
    if (parsed.sellPercentage !== undefined) updates.sellPercentage = parsed.sellPercentage;
    if (parsed.priority !== undefined) updates.priority = parsed.priority;
    if (parsed.status !== undefined) updates.status = parsed.status;
    if (parsed.effectiveDate !== undefined) updates.effectiveDate = parsed.effectiveDate;
    if (parsed.notes !== undefined) updates.notes = parsed.notes;
    db.update(schema.partialSaleRules).set(updates).where(eq(schema.partialSaleRules.id, id)).run();
    const row = db.select().from(schema.partialSaleRules).where(eq(schema.partialSaleRules.id, id)).get();
    if (!row) throw new Error("Regla no encontrada");
    return mapPartialSaleRule(row);
  }));

  ipcMain.handle("partialSaleRules:delete", withResult(async (_, id: string) => {
    const db = getDb();
    db.delete(schema.partialSaleRules).where(eq(schema.partialSaleRules.id, id)).run();
    return null;
  }));

  ipcMain.handle("partialSaleRules:evaluate", withResult(async (_, input: { cycleId: string; assetId?: string }) => {
    const db = getDb();
    const { evaluatePartialSaleRules } = require("@crypto-control/portfolio") as typeof import("@crypto-control/portfolio");

    const ruleRows = db.select().from(schema.partialSaleRules)
      .where(eq(schema.partialSaleRules.cycleId, input.cycleId))
      .all();

    const rules = ruleRows
      .filter(r => !input.assetId || r.assetId === input.assetId)
      .map(r => ({
        id: r.id, assetId: r.assetId, cycleId: r.cycleId, name: r.name,
        conditionType: r.conditionType as any,
        conditionValue: r.conditionValue ?? null,
        conditionValue2: r.conditionValue2 ?? null,
        sellPercentage: r.sellPercentage,
        priority: r.priority,
        status: r.status as any,
        effectiveDate: r.effectiveDate ?? null,
        notes: r.notes ?? null,
      }));

    const allocations = await getPortfolioService().getAllocation();
    const positions = (await getPortfolioService().getPositions()).positions as Record<string, { balance: number; averagePriceEur: number | null; totalInvestedEur: number }>;

    const positionMap: Record<string, { assetId: string; balance: number; averagePriceEur: number | null; totalInvestedEur: number }> = {};
    const marketMap: Record<string, { currentPriceEur: number | null; marketPhase: string | null; isEuphoria: boolean }> = {};

    for (const alloc of (allocations as { assetId: string; valueEur: number }[])) {
      const p = positions[alloc.assetId];
      if (p) {
        positionMap[alloc.assetId] = { assetId: alloc.assetId, ...p };
        const price = p.balance > 0 ? alloc.valueEur / p.balance : null;
        marketMap[alloc.assetId] = { currentPriceEur: price, marketPhase: null, isEuphoria: false };
      }
    }

    return evaluatePartialSaleRules(rules, positionMap, marketMap);
  }));

  // --- MONITOREO DEL PLAN ---

  ipcMain.handle("planMonitoring:getSummary", withResult(async (_, input: { cycleId: string }) => {
    const db = getDb();
    const {
      buildAssetPlanStatus,
      buildPlanAlerts,
      buildContributionHistory,
      calculateCycleContributionAggregates,
      deriveContributionEntriesFromOperations,
      mergeManualAndOperationContributions,
    } = require("@crypto-control/portfolio") as typeof import("@crypto-control/portfolio");

    const cycle = db.select().from(schema.investmentCycles).where(eq(schema.investmentCycles.id, input.cycleId)).get();
    if (!cycle) throw new Error("Etapa no encontrada");

    const assetRows = db.select().from(schema.investmentAssets)
      .where(eq(schema.investmentAssets.cycleId, input.cycleId))
      .all();

    const substitutionRows = db.select().from(schema.assetSubstitutions)
      .where(and(eq(schema.assetSubstitutions.cycleId, input.cycleId)))
      .all();

    const pendingSubstitutions = substitutionRows.filter(s => s.status === "borrador" || s.status === "programada").length;

    const saleRuleRows = db.select().from(schema.partialSaleRules)
      .where(and(eq(schema.partialSaleRules.cycleId, input.cycleId), eq(schema.partialSaleRules.status, "activa")))
      .all();

    const rebuyTierRows = db.select().from(schema.cycleRebuyTiers)
      .where(eq(schema.cycleRebuyTiers.cycleId, input.cycleId))
      .all();

    const contribRows = db.select().from(schema.contributionSchedule)
      .where(eq(schema.contributionSchedule.cycleId, input.cycleId))
      .all();

    const now = Date.now();

    const contributions = contribRows.map(r => ({
      id: r.id, cycleId: r.cycleId, type: r.type as "periodica" | "extraordinaria",
      plannedDate: r.plannedDate, amountEur: r.amountEur, status: r.status as any,
      executedAt: r.executedAt ?? null, notes: r.notes ?? null,
    }));

    const cycleMeta = { id: cycle.id, startDate: cycle.startDate, endDate: cycle.endDate ?? null, monthlyAmountEur: cycle.monthlyAmountEur };
    const txRepo = new DatabasePortfolioRepository(db);
    const transactions = await txRepo.getTransactions();
    const catalogAssetRows = db.select({ id: schema.assets.id, type: schema.assets.type }).from(schema.assets).all();
    const assetTypeById = new Map(catalogAssetRows.map((asset) => [asset.id, asset.type]));
    const operationContributions = deriveContributionEntriesFromOperations(
      cycleMeta,
      transactions,
      (assetId: string) => assetId === "EUR" || assetTypeById.get(assetId) === "fiat",
    );
    const mergedContributions = mergeManualAndOperationContributions(contributions, operationContributions);
    const history = buildContributionHistory(cycleMeta, mergedContributions, now);
    const agg = calculateCycleContributionAggregates(cycleMeta, history, mergedContributions, now);
    const deficitEur = agg.totalDeficitEur;

    const allocations = await getPortfolioService().getAllocation();
    const positions = (await getPortfolioService().getPositions()).positions as Record<string, { balance: number; averagePriceEur: number | null; totalInvestedEur: number }>;
    const totalPortfolioValue = (allocations as { valueEur: number }[]).reduce((s, a) => s + a.valueEur, 0);

    const treasurySummaryMon = getTreasuryRepository().getSummary(getRecommendedFiscalReserve(), getCoinbaseEurcBalance());
    const eurcAvailable = Math.max(0, (treasurySummaryMon?.eurcBalance ?? 0) - (treasurySummaryMon?.fiscalReserveBalance ?? 0));
    const fiscalReserve = treasurySummaryMon?.fiscalReserveBalance ?? 0;

    const monitoringAssets = assetRows.map(a => ({
      id: a.id,
      assetId: a.assetId,
      cycleId: a.cycleId,
      investmentAssetId: a.id,
      targetAllocationPct: a.allocationPercentage ?? null,
      status: a.status,
      targetAmount: a.targetAmount ?? null,
      targetValueEur: a.targetValueEur ?? null,
      targetPortfolioPercentage: a.targetPortfolioPercentage ?? null,
      goalReachedAt: a.goalReachedAt ?? null,
      endDate: a.endDate ?? null,
    }));

    const assetStatuses = monitoringAssets.map(ma => {
      const alloc = (allocations as { assetId: string; valueEur: number }[]).find(a => a.assetId === ma.assetId);
      const pos = positions[ma.assetId];
      const monPos = pos ? {
        assetId: ma.assetId,
        balance: pos.balance,
        currentValueEur: alloc?.valueEur ?? null,
        averagePriceEur: pos.averagePriceEur,
      } : null;
      const saleRuleCount = saleRuleRows.filter(r => r.assetId === ma.assetId).length;
      return buildAssetPlanStatus(ma, monPos, totalPortfolioValue, saleRuleCount, 0, null);
    });

    const goalsReached = monitoringAssets.filter(a => a.goalReachedAt !== null).length;
    const goalsNearby = assetStatuses.filter(s => s.goalProgress !== null && s.goalProgress >= 90 && s.goalProgress < 100).length;

    const alerts = buildPlanAlerts({
      cycleId: input.cycleId,
      assets: monitoringAssets,
      assetStatuses,
      deficitEur,
      triggeredSaleRules: 0,
      triggeredRebuyRules: 0,
      pendingSubstitutions,
      cycle: { id: cycle.id, planId: cycle.planId, endDate: cycle.endDate ?? null, monthlyAmountEur: cycle.monthlyAmountEur },
      now,
    });

    return {
      cycleId: input.cycleId,
      planId: cycle.planId,
      activeAssets: assetRows.filter(a => a.status === "active").length,
      goalsReached,
      goalsNearby,
      triggeredSaleRules: 0,
      triggeredRebuyRules: 0,
      pendingSubstitutions,
      compliancePercentage: agg.compliancePercentage,
      deficitEur,
      eurcAvailable,
      fiscalReserve,
      alerts,
      assetStatuses,
      generatedAt: now,
    };
  }));

  // Ping channel: called by the preload every 200 ms to drive uv_run so the
  // Node.js http.Server below can accept TCP connections (Electron event-loop quirk).
  ipcMain.handle("__ping__", () => true);

  // Local HTTP API bridge — exposes all IPC channels as POST /api/ipc, and
  // serves the built web app as static files. Allows browser clients
  // (Tailscale) to load the UI and share the same backend and SQLite DB
  // without needing a separate "vite preview" server running.
  const HTTP_PORT = 3001;
  const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  const webDistPath = app.isPackaged
    ? path.join(process.resourcesPath, "web/dist")
    : path.join(__dirname, "../../web/dist");

  const MIME_TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };

  function serveStaticFile(req: http.IncomingMessage, res: http.ServerResponse) {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    const relativePath = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
    let filePath = path.join(webDistPath, relativePath);

    // Prevent path traversal outside webDistPath
    if (!filePath.startsWith(webDistPath)) {
      res.writeHead(403, CORS_HEADERS);
      res.end();
      return;
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      // SPA fallback: unknown routes (e.g. /portfolio) resolve to index.html
      filePath = path.join(webDistPath, "index.html");
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, CORS_HEADERS);
        res.end();
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { ...CORS_HEADERS, "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
      res.end(data);
    });
  }

  const apiServer = http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(200, CORS_HEADERS);
      res.end();
      return;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      if (req.url !== "/api/ipc") {
        serveStaticFile(req, res);
        return;
      }
    }

    if (req.method !== "POST" || req.url !== "/api/ipc") {
      res.writeHead(404, CORS_HEADERS);
      res.end();
      return;
    }

    let body = "";
    req.on("data", (chunk) => { body += String(chunk); });
    req.on("end", () => {
      void (async () => {
        try {
          const { channel, args = [] } = JSON.parse(body) as { channel: string; args?: unknown[] };
          const handler = httpDispatch.get(channel);
          if (!handler) {
            res.writeHead(404, { ...CORS_HEADERS, "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: `Unknown channel: ${channel}` } }));
            return;
          }
          const result = await handler(...args);
          res.writeHead(200, { ...CORS_HEADERS, "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          res.writeHead(500, { ...CORS_HEADERS, "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: { code: "SERVER_ERROR", message: msg } }));
        }
      })();
    });
  });

  apiServer.on("error", (e) => console.error("[HTTP] API server error:", e));
  apiServer.listen(HTTP_PORT, "0.0.0.0", () => {
    console.log(`[HTTP] API bridge on port ${HTTP_PORT}`);
  });
  app.on("will-quit", () => apiServer.close());

  // ── Motor central de señales estratégicas ─────────────────────────────────
  // Una señal es la fuente de verdad para una acción (compra/venta/recompra).
  // computeTradeAlerts y signals:* consumen el mismo signal-engine.

  interface SellAlert {
    assetId: string;
    currentPriceEur: number;
    avgCostEur: number;
    gainPct: number;
    suggestedSellPct: number;
    suggestedQtyUnits: number;
    suggestedAmountEur: number;
    tier: 50 | 100 | 200;
    signalId?: string;
  }
  interface RebuyAlert {
    assetId: string;
    currentPriceEur: number;
    lastSalePriceEur: number;
    drawdownPct: number;
    eurcToUseEur: number;
    suggestedQtyUnits: number;
    tier: 15 | 25 | 40;
    signalId?: string;
  }
  interface TradeAlertsResult {
    sellAlerts: SellAlert[];
    rebuyAlerts: RebuyAlert[];
    eurcAvailableEur: number;
    checkedAt: number;
  }

  async function gatherSignalInput(now: number) {
    const db = getDb();
    const { evaluateSignals } = require("@crypto-control/portfolio") as typeof import("@crypto-control/portfolio");

    const posResult = await getPortfolioService().getPositions().catch(() => ({ positions: {} }));
    const rawPositions = posResult.positions as Record<string, {
      balance: number; averagePriceEur: number | null; totalInvestedEur: number;
    }>;
    const assetIds = Object.keys(rawPositions).filter(id => (rawPositions[id].balance ?? 0) > 1e-12 && id !== "EURC");

    const priceMap: Record<string, number | null> = {};
    await Promise.all(assetIds.map(async id => {
      const r = await getCurrentPriceFast(id).catch(() => null);
      priceMap[id] = r?.price ?? null;
    }));

    const positions = assetIds.map(assetId => ({
      assetId,
      balance: rawPositions[assetId].balance,
      averagePriceEur: rawPositions[assetId].averagePriceEur,
      currentPriceEur: priceMap[assetId] ?? null,
      totalInvestedEur: rawPositions[assetId].totalInvestedEur ?? 0,
    }));

    const allGains = db.select().from(schema.realizedGains).orderBy(desc(schema.realizedGains.date)).all();
    const lastSalePriceByAsset: Record<string, number> = {};
    for (const g of allGains) {
      if (!lastSalePriceByAsset[g.assetId] && g.amountSold > 0) {
        lastSalePriceByAsset[g.assetId] = g.saleValueEur / g.amountSold;
      }
    }

    const coinbaseEurc = getCoinbaseEurcBalance?.() ?? 0;
    const treasurySummary = getTreasuryRepository().getSummary(getRecommendedFiscalReserve(), coinbaseEurc);
    const freeRebuyLiquidity = Math.max(0, (treasurySummary as any).freeRebuyLiquidity ?? 0);
    const eurcAvailableEur = Math.max(0, (treasurySummary as any).eurcAvailableEur ?? freeRebuyLiquidity);

    // Cargar reglas y tiers del plan activo
    const planRows = db.select().from(schema.investmentPlans)
      .where(eq(schema.investmentPlans.status, "active")).all();
    const activePlanId = planRows[0]?.id ?? null;

    const cycleRows = activePlanId
      ? db.select().from(schema.investmentCycles)
        .where(eq(schema.investmentCycles.planId, activePlanId)).all()
        .filter(c => c.status === "active")
      : [];
    const activeCycleId = cycleRows[0]?.id ?? null;
    const cycleIds = cycleRows.map(c => c.id);

    const saleRuleRows = cycleIds.length
      ? db.select().from(schema.partialSaleRules)
        .where(inArray(schema.partialSaleRules.cycleId, cycleIds)).all()
      : [];

    const rebuyTierRows = cycleIds.length
      ? db.select().from(schema.cycleRebuyTiers)
        .where(inArray(schema.cycleRebuyTiers.cycleId, cycleIds)).all()
      : [];

    return {
      evaluateSignals,
      now,
      positions,
      lastSalePriceByAsset,
      eurcAvailableEur,
      freeRebuyLiquidity,
      activePlanId,
      activeCycleId,
      saleRules: saleRuleRows.map(r => ({
        id: r.id,
        assetId: r.assetId,
        cycleId: r.cycleId,
        name: r.name,
        conditionType: r.conditionType,
        conditionValue: r.conditionValue ?? null,
        conditionValue2: r.conditionValue2 ?? null,
        sellPercentage: r.sellPercentage,
        priority: r.priority,
        status: r.status,
        effectiveDate: r.effectiveDate ?? null,
        notes: r.notes ?? null,
      })),
      rebuyTiers: rebuyTierRows.map(r => ({
        id: r.id,
        cycleId: r.cycleId,
        assetId: r.assetId ?? null,
        name: r.name ?? null,
        drawdownPercentage: r.drawdownPercentage,
        usagePercentage: r.usagePercentage,
        priority: r.priority ?? 0,
        status: r.status ?? "activa",
        referenceType: r.referenceType ?? null,
        referenceValue: r.referenceValue ?? null,
        referenceDate: r.referenceDate ?? null,
        effectiveDate: (r as any).effectiveDate ?? null,
        notes: r.notes ?? null,
        lastTriggeredAt: r.lastTriggeredAt ?? null,
      })),
      treasury: {
        eurcBalance: (treasurySummary as any).eurcBalance ?? 0,
        fiscalReserveBalance: (treasurySummary as any).fiscalReserveBalance ?? 0,
        freeRebuyLiquidity,
      },
    };
  }

  function persistSignals(signals: import("@crypto-control/portfolio").StrategicSignal[]): void {
    if (!signals.length) return;
    const db = getDb();
    const now = Date.now();
    for (const sig of signals) {
      try {
        db.insert(schema.strategicSignals).values({
          id: sig.id,
          deduplicationKey: sig.deduplicationKey,
          assetId: sig.assetId,
          planId: sig.planId,
          cycleId: sig.cycleId,
          ruleId: sig.ruleId,
          actionType: sig.actionType,
          status: sig.status,
          detectedAt: sig.detectedAt,
          validFrom: sig.validFrom,
          expiresAt: sig.expiresAt,
          currentPriceEur: sig.currentPriceEur,
          referencePriceEur: sig.referencePriceEur,
          targetPriceEur: sig.targetPriceEur,
          drawdownPct: sig.drawdownPct,
          recommendedPercentage: sig.recommendedPercentage,
          recommendedAmountEur: sig.recommendedAmountEur,
          recommendedQuantity: sig.recommendedQuantity,
          fundingSource: sig.fundingSource,
          availableFundingEur: sig.availableFundingEur,
          fiscalReserveExcludedEur: sig.fiscalReserveExcludedEur,
          priority: sig.priority,
          confidence: sig.confidence,
          dataQuality: sig.dataQuality,
          reasonsJson: JSON.stringify(sig.reasons),
          conditionsMatchedJson: JSON.stringify(sig.conditionsMatched),
          sourceModulesJson: JSON.stringify(sig.sourceModules),
          simulationOnly: sig.simulationOnly ? 1 : 0,
          createdAt: now,
          updatedAt: now,
        }).onConflictDoUpdate({
          target: schema.strategicSignals.deduplicationKey,
          set: {
            status: sig.status,
            currentPriceEur: sig.currentPriceEur,
            recommendedAmountEur: sig.recommendedAmountEur,
            recommendedQuantity: sig.recommendedQuantity,
            availableFundingEur: sig.availableFundingEur,
            reasonsJson: JSON.stringify(sig.reasons),
            updatedAt: now,
          },
        }).run();
      } catch (e) {
        console.error("[signals] persist error:", e);
      }
    }
  }

  async function computeTradeAlerts(): Promise<TradeAlertsResult> {
    const ctx = await gatherSignalInput(Date.now());
    const result = ctx.evaluateSignals({
      now: ctx.now,
      positions: ctx.positions,
      saleRules: ctx.saleRules,
      rebuyTiers: ctx.rebuyTiers,
      treasury: ctx.treasury,
      lastSalePriceByAsset: ctx.lastSalePriceByAsset,
      activePlanId: ctx.activePlanId,
      activeCycleId: ctx.activeCycleId,
      mode: "live",
    });

    persistSignals(result.signals);

    // Map señales → formato SellAlert/RebuyAlert existente (backwards compat)
    const sellAlerts: SellAlert[] = [];
    const rebuyAlerts: RebuyAlert[] = [];

    for (const sig of result.signals) {
      if (sig.actionType === "sell_partial" && sig.currentPriceEur != null && sig.referencePriceEur != null) {
        const gainPct = sig.referencePriceEur > 0
          ? (sig.currentPriceEur / sig.referencePriceEur - 1) * 100 : 0;
        const sellFraction = (sig.recommendedPercentage ?? 10) / 100;
        const tier = sellFraction >= 0.18 ? 200 : sellFraction >= 0.13 ? 100 : 50;
        sellAlerts.push({
          assetId: sig.assetId,
          currentPriceEur: sig.currentPriceEur,
          avgCostEur: sig.referencePriceEur,
          gainPct,
          suggestedSellPct: sellFraction,
          suggestedQtyUnits: sig.recommendedQuantity ?? 0,
          suggestedAmountEur: sig.recommendedAmountEur ?? 0,
          tier: tier as 50 | 100 | 200,
          signalId: sig.id,
        });
      } else if (sig.actionType === "rebuy" && sig.currentPriceEur != null && sig.referencePriceEur != null) {
        const drawdownPct = sig.drawdownPct ?? 0;
        const tier = drawdownPct >= 35 ? 40 : drawdownPct >= 22 ? 25 : 15;
        rebuyAlerts.push({
          assetId: sig.assetId,
          currentPriceEur: sig.currentPriceEur,
          lastSalePriceEur: sig.referencePriceEur,
          drawdownPct,
          eurcToUseEur: sig.recommendedAmountEur ?? 0,
          suggestedQtyUnits: sig.recommendedQuantity ?? 0,
          tier: tier as 15 | 25 | 40,
          signalId: sig.id,
        });
      }
    }

    return { sellAlerts, rebuyAlerts, eurcAvailableEur: ctx.eurcAvailableEur, checkedAt: ctx.now };
  }

  // ── Señales: handlers IPC ─────────────────────────────────────────────────

  ipcMain.handle("signals:evaluate", withResult(async () => {
    const ctx = await gatherSignalInput(Date.now());
    const result = ctx.evaluateSignals({
      now: ctx.now,
      positions: ctx.positions,
      saleRules: ctx.saleRules,
      rebuyTiers: ctx.rebuyTiers,
      treasury: ctx.treasury,
      lastSalePriceByAsset: ctx.lastSalePriceByAsset,
      activePlanId: ctx.activePlanId,
      activeCycleId: ctx.activeCycleId,
      mode: "live",
    });
    persistSignals(result.signals);
    const db = getDb();
    const allSignals = db.select().from(schema.strategicSignals)
      .where(inArray(schema.strategicSignals.status, ["detected", "active", "acknowledged"]))
      .orderBy(desc(schema.strategicSignals.detectedAt))
      .all()
      .map(s => ({
        ...s,
        reasons: JSON.parse(s.reasonsJson ?? "[]"),
        conditionsMatched: JSON.parse(s.conditionsMatchedJson ?? "[]"),
        sourceModules: JSON.parse(s.sourceModulesJson ?? "[]"),
        simulationOnly: s.simulationOnly === 1,
      }));
    return { signals: allSignals, meta: result };
  }));

  ipcMain.handle("signals:list", withResult(async (_, input?: { status?: string; assetId?: string }) => {
    const db = getDb();
    let rows = db.select().from(schema.strategicSignals)
      .orderBy(desc(schema.strategicSignals.detectedAt))
      .all();
    if (input?.status) rows = rows.filter(s => s.status === input.status);
    if (input?.assetId) rows = rows.filter(s => s.assetId === input.assetId);
    return rows.map(s => ({
      ...s,
      reasons: JSON.parse(s.reasonsJson ?? "[]"),
      conditionsMatched: JSON.parse(s.conditionsMatchedJson ?? "[]"),
      sourceModules: JSON.parse(s.sourceModulesJson ?? "[]"),
      simulationOnly: s.simulationOnly === 1,
    }));
  }));

  ipcMain.handle("signals:acknowledge", withResult(async (_, id: string) => {
    const db = getDb();
    const now = Date.now();
    db.update(schema.strategicSignals)
      .set({ status: "acknowledged", acknowledgedAt: now, updatedAt: now })
      .where(eq(schema.strategicSignals.id, id))
      .run();
    return { ok: true };
  }));

  ipcMain.handle("signals:dismiss", withResult(async (_, id: string) => {
    const db = getDb();
    const now = Date.now();
    db.update(schema.strategicSignals)
      .set({ status: "dismissed", dismissedAt: now, updatedAt: now })
      .where(eq(schema.strategicSignals.id, id))
      .run();
    return { ok: true };
  }));

  ipcMain.handle("trade:get-alerts", withResult(async () => computeTradeAlerts()));

  // Background checker: every 15 minutes; OS notification + IPC push on new alerts
  const { Notification } = require("electron") as typeof import("electron");
  const notifiedSellKeys = new Set<string>();
  const notifiedRebuyKeys = new Set<string>();

  async function runTradeAlertCheck() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      const result = await computeTradeAlerts();

      for (const a of result.sellAlerts) {
        const key = `sell-${a.assetId}-${a.tier}`;
        if (!notifiedSellKeys.has(key)) {
          notifiedSellKeys.add(key);
          new Notification({
            title: `📈 Venta parcial recomendada: ${a.assetId}`,
            body: `+${a.gainPct.toFixed(0)}% de ganancia → vender ${(a.suggestedSellPct * 100).toFixed(0)}% (${a.suggestedQtyUnits.toFixed(6)} ${a.assetId} ≈ ${a.suggestedAmountEur.toFixed(2)} €)`,
            silent: false,
          }).show();
        }
      }

      for (const a of result.rebuyAlerts) {
        const key = `rebuy-${a.assetId}-${a.tier}`;
        if (!notifiedRebuyKeys.has(key)) {
          notifiedRebuyKeys.add(key);
          new Notification({
            title: `📉 Recompra recomendada: ${a.assetId}`,
            body: `-${a.drawdownPct.toFixed(0)}% desde última venta → usar ${a.eurcToUseEur.toFixed(2)} € EURC (${a.suggestedQtyUnits.toFixed(6)} ${a.assetId})`,
            silent: false,
          }).show();
        }
      }

      // Clear "notified" keys when the condition is no longer active, so future alerts fire again
      for (const key of [...notifiedSellKeys]) {
        const [, assetId, tierStr] = key.split("-");
        const still = result.sellAlerts.some(a => a.assetId === assetId && String(a.tier) === tierStr);
        if (!still) notifiedSellKeys.delete(key);
      }
      for (const key of [...notifiedRebuyKeys]) {
        const parts = key.split("-"); // rebuy-ASSETID-TIER
        const assetId = parts[1];
        const tierStr = parts[2];
        const still = result.rebuyAlerts.some(a => a.assetId === assetId && String(a.tier) === tierStr);
        if (!still) notifiedRebuyKeys.delete(key);
      }

      mainWindow.webContents.send("trade:new-alerts", result);
    } catch (e) {
      console.error("[TradeAlerts] check failed:", e);
    }
  }

  // Run immediately on startup (delayed 30s to let prices load) then every 15 min
  setTimeout(() => runTradeAlertCheck(), 30_000);
  setInterval(() => runTradeAlertCheck(), 15 * 60 * 1000);

}

function createWindow() {
  const appIconPath = app.isPackaged
    ? path.join(process.resourcesPath, "assets/brand/logo.png")
    : path.join(__dirname, "../../../assets/brand/logo.png");

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "Crypto Control",
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    const prefix = ["[renderer:verbose]", "[renderer:info]", "[renderer:warn]", "[renderer:error]"][level] ?? "[renderer]";
    console.log(prefix, message, sourceId ? `(${sourceId}:${line})` : "");
  });
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error("[renderer] did-fail-load", code, desc, url);
  });
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    console.error("[renderer] process gone", details.reason, details.exitCode);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    console.log("[Electron] Cargando desarrollo:", process.env.VITE_DEV_SERVER_URL);
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    const prodPath = app.isPackaged
      ? path.join(process.resourcesPath, "web/dist/index.html")
      : path.join(__dirname, "../../web/dist/index.html");
    console.log("[Electron] Cargando producción:", prodPath);
    mainWindow.loadFile(prodPath);
  }
}

app.whenReady().then(() => {
  setupDatabase();
  setupIpcHandlers();
  createWindow();

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});
