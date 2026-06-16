import { app, BrowserWindow, ipcMain, dialog } from "electron";
import * as path from "path";
import { initializeDatabase, runMigrations, getDb, schema } from "@crypto-control/database";
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
} from "@crypto-control/core";
import crypto from "crypto";
import { eq, and, or, asc, desc, isNull } from "drizzle-orm";
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
  
  const defaultAssets = [
    { id: "BTC",  symbol: "BTC",  name: "Bitcoin",    type: "crypto", logoUrl: "https://assets.coingecko.com/coins/images/1/small/bitcoin.png" },
    { id: "ETH",  symbol: "ETH",  name: "Ethereum",   type: "crypto", logoUrl: "https://assets.coingecko.com/coins/images/279/small/ethereum.png" },
    { id: "ADA",  symbol: "ADA",  name: "Cardano",    type: "crypto", logoUrl: "https://assets.coingecko.com/coins/images/975/small/cardano.png" },
    { id: "SUI",  symbol: "SUI",  name: "Sui",        type: "crypto", logoUrl: "https://assets.coingecko.com/coins/images/26375/small/sui_asset.jpeg" },
    { id: "SEI",  symbol: "SEI",  name: "Sei",        type: "crypto", logoUrl: "https://assets.coingecko.com/coins/images/28205/small/Sei_Logo_-_Transparent.png" },
    { id: "EURC", symbol: "EURC", name: "Euro Coin",  type: "crypto", logoUrl: "https://assets.coingecko.com/coins/images/26045/small/euro-coin.png" },
  ];

  console.log(`[DB] Se encontraron ${existing.length} activos. Ejecutando siembra de activos ausentes...`);

  const now = Date.now();
  for (const asset of defaultAssets) {
    const found = existing.some(a => a.id === asset.id);
    if (!found) {
      db.insert(schema.assets).values({
        id: asset.id,
        symbol: asset.symbol,
        name: asset.name,
        type: asset.type,
        logoUrl: asset.logoUrl,
        createdAt: now,
        updatedAt: now
      }).run();
    } else {
      // Update logoUrl for existing assets that don't have one yet
      const existing_asset = existing.find(a => a.id === asset.id);
      if (!existing_asset?.logoUrl) {
        db.update(schema.assets)
          .set({ logoUrl: asset.logoUrl, updatedAt: now })
          .where(eq(schema.assets.id, asset.id))
          .run();
      }
    }
  }

  // Volver a consultar y verificar que todos los símbolos requeridos están presentes
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
    // Un fallo en migración detendría la ejecución si es destructiva, 
    // pero idealmente deberíamos hacer un backup del SQLite antes (implementación de backup requerida)
  }
}

function setupIpcHandlers() {
  const { MarketService, MarketSentimentService, FearGreedService } = require("@crypto-control/market-data") as typeof import("@crypto-control/market-data");
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
    status: row.status as "active" | "paused" | "closed",
    isActive: row.isActive === 1,
    notes: row.notes,
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

    // Collect all unique assets from legs
    const heldAssets = new Set<string>();
    for (const tx of txs) {
      for (const leg of tx.legs) {
        if (leg.amount !== 0) heldAssets.add(leg.assetId);
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

    function priceAtOrBefore(prices: { time: number; price: number }[], ts: number): number | null {
      if (!prices.length) return null;
      let lo = 0, hi = prices.length - 1;
      let result: number | null = null;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (prices[mid].time <= ts) { result = prices[mid].price; lo = mid + 1; }
        else hi = mid - 1;
      }
      return result;
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

    async function loadPricesForAsset(assetId: string): Promise<void> {
      if (marketPeriod) {
        try {
          const result = await marketService.getHistoricalPrices(assetId, marketPeriod);
          if (result.points.length > 1) {
            pricesByAsset[assetId] = result.points
              .map(p => ({ time: p.timestamp, price: p.price }))
              .sort((a, b) => a.time - b.time);
            priceSourceByAsset[assetId] = result.provider;
            marketPointCountByAsset[assetId] = result.points.length;
            totalPricePoints += result.points.length;
            return;
          }
        } catch {
          // fall through to the slower/coarser sources below
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

      if (phRows.length > 10) {
        pricesByAsset[assetId] = phRows.map(r => ({ time: r.timestamp, price: r.price }));
        priceSourceByAsset[assetId] = "priceHistory";
        totalPricePoints += phRows.length;
        return;
      }

      // 2. coinbaseCandleCache (start is Unix seconds → convert to ms)
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

      // 3. Live API fallback (fetches + caches to priceHistory)
      try {
        const result = await marketService.getHistoricalPrices(assetId, "1y");
        if (result.points.length > 0) {
          pricesByAsset[assetId] = result.points
            .map(p => ({ time: p.timestamp, price: p.price }))
            .sort((a, b) => a.time - b.time);
          priceSourceByAsset[assetId] = result.provider;
          totalPricePoints += result.points.length;
        }
      } catch {
        // Asset not mapped or API unavailable — omit from series
      }
    }

    await Promise.all([...heldAssets].map(loadPricesForAsset));

    const valueAtMs = (ts: number): { value: number; hasHolding: boolean } => {
      let totalValue = 0;
      let hasHolding = false;
      for (const [assetId, prices] of Object.entries(pricesByAsset)) {
        const qty = getQtyAt(assetEvents[assetId] ?? [], ts);
        if (qty <= 0) continue;
        const price = priceAtOrBefore(prices, ts);
        if (price === null || price <= 0) continue;
        totalValue += qty * price;
        hasHolding = true;
      }
      return { value: totalValue, hasHolding };
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

  ipcMain.handle("market:get-current-price", withResult(async (_, input: {assetId: string, quoteCurrency?: string}) => {
    const priceRes = await marketService.getCurrentPrice(input.assetId);
    return CurrentPriceResultSchema.parse(priceRes);
  }));

  ipcMain.handle("market:get-historical-prices", withResult(async (_, input: {assetId: string, period: string, quoteCurrency?: string}) => {
    const result = await marketService.getHistoricalPrices(input.assetId, input.period);
    const sanitizedPoints = sanitizePoints(result.points);
    return HistoricalPriceResultSchema.parse({
      ...result,
      points: sanitizedPoints
    });
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

    const priceSettled = await Promise.resolve(marketService.getCurrentPrice(input.assetId)).then(
      (data) => ({ status: "fulfilled" as const, data }),
      () => ({ status: "rejected" as const })
    );
    const historySettled = await Promise.resolve(marketService.getHistoricalPrices(input.assetId, "24h")).then(
      (data) => ({ status: "fulfilled" as const, data }),
      () => ({ status: "rejected" as const })
    );

    const historyPoints = historySettled.status === "fulfilled" ? sanitizePoints(historySettled.data.points) : [];
    const values = historyPoints.map((point) => point.value).filter((value) => Number.isFinite(value));
    const high24h = values.length > 0 ? Math.max(...values) : null;
    const low24h = values.length > 0 ? Math.min(...values) : null;
    const currentPrice = finiteOrNull(snapshot?.price)
      ?? (priceSettled.status === "fulfilled" ? finiteOrNull(priceSettled.data.price) : null)
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
      provider: snapshot ? "coinbase" : priceSettled.status === "fulfilled" ? priceSettled.data.provider : historySettled.status === "fulfilled" ? historySettled.data.provider : "local",
    });
  }));

  // In-memory caches for external market signals (reset on app restart, acceptable)
  let globalMetricsCache: {
    btcDominance: number | null;
    ethDominance: number | null;
    totalMarketCapUsd: number | null;
    totalVolumeUsd: number | null;
    marketCapChangePercentage24h: number | null;
    fetchedAt: number;
  } | null = null;
  const GLOBAL_METRICS_TTL_MS = 60 * 60 * 1000;

  ipcMain.handle("market:get-fear-greed", withResult(async () => {
    return FearGreedResultSchema.parse(await fearGreedService.get());
  }));

  async function fetchGlobalMetrics(): Promise<{ btcDominance: number | null; ethDominance: number | null; totalMarketCapUsd: number | null; totalVolumeUsd: number | null; marketCapChangePercentage24h: number | null; fetchedAt: number; isCached: boolean }> {
    if (globalMetricsCache && Date.now() - globalMetricsCache.fetchedAt < GLOBAL_METRICS_TTL_MS) {
      return { ...globalMetricsCache, isCached: true };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const resp = await fetch("https://api.coingecko.com/api/v3/global", {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      const json = await resp.json() as {
        data?: {
          market_cap_percentage?: Record<string, number>;
          total_market_cap?: Record<string, number>;
          total_volume?: Record<string, number>;
          market_cap_change_percentage_24h_usd?: number;
        };
      };
      const data = json?.data;
      globalMetricsCache = {
        btcDominance: data?.market_cap_percentage?.btc ?? null,
        ethDominance: data?.market_cap_percentage?.eth ?? null,
        totalMarketCapUsd: data?.total_market_cap?.usd ?? null,
        totalVolumeUsd: data?.total_volume?.usd ?? null,
        marketCapChangePercentage24h: data?.market_cap_change_percentage_24h_usd ?? null,
        fetchedAt: Date.now(),
      };
      return { ...globalMetricsCache, isCached: false };
    } catch {
      if (globalMetricsCache) return { ...globalMetricsCache, isCached: true };
      return {
        btcDominance: null,
        ethDominance: null,
        totalMarketCapUsd: null,
        totalVolumeUsd: null,
        marketCapChangePercentage24h: null,
        fetchedAt: Date.now(),
        isCached: false,
      };
    } finally {
      clearTimeout(timeout);
    }
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
    return globalMetricsCache && Date.now() - globalMetricsCache.fetchedAt < GLOBAL_METRICS_TTL_MS * 2 ? globalMetricsCache.btcDominance : null;
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
      .then((r) => console.log(`[CostBasis] Backfill: ${r.legsBackfilled}/${r.legsChecked} legs resueltos, ${r.legsStillPending} siguen pendientes.`))
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

  ipcMain.handle("coinbase:get-portfolio-breakdown", withResult(async (_, portfolioUuid: string, currency: string) => {
    const service = getPortfolioServiceInst();
    const liveBreakdown = service.getPortfolioBreakdown(portfolioUuid, currency);
    liveBreakdown.catch((error) => {
      console.warn("[Coinbase] Portfolio live breakdown did not complete before fallback:", error instanceof Error ? error.message : String(error));
    });

    const cachedBreakdown = new Promise((resolve) => {
      setTimeout(() => {
        const cached = service.getCachedPortfolioBreakdown(portfolioUuid, currency, "Coinbase tardó demasiado; mostrando cache local.");
        void Promise.resolve(cached).then(resolve);
      }, 8000);
    });

    return await Promise.race([liveBreakdown, cachedBreakdown]);
  }));

  ipcMain.handle("coinbase:get-portfolio-snapshots", withResult(async (_, portfolioUuid: string) => {
    return await getPortfolioServiceInst().getPortfolioSnapshots(portfolioUuid);
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
