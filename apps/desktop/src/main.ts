import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import { initializeDatabase, runMigrations, getDb, schema } from "@crypto-control/database";
import { CreateTransactionSchema, CurrentPriceResultSchema, HistoricalPriceResultSchema, TransactionInputListSchema } from "@crypto-control/core";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import * as fs from "fs";

let mainWindow: BrowserWindow | null = null;

function sanitizePoints(points: { timestamp: number; price: number }[]): { time: number; value: number }[] {
  const mapped = points
    .map(p => ({
      time: Math.floor(p.timestamp / 1000),
      value: p.price
    }))
    .filter(p => p.time > 0 && typeof p.value === "number" && Number.isFinite(p.value) && p.value > 0);

  mapped.sort((a, b) => a.time - b.time);

  const unique: { time: number; value: number }[] = [];
  for (const p of mapped) {
    if (unique.length === 0 || unique[unique.length - 1].time !== p.time) {
      unique.push(p);
    } else {
      unique[unique.length - 1].value = p.value;
    }
  }

  return unique;
}

function seedDatabase() {
  const db = getDb();
  let existing = db.select().from(schema.assets).all();
  
  const defaultAssets = [
    { id: "BTC", symbol: "BTC", name: "Bitcoin", type: "crypto" },
    { id: "ETH", symbol: "ETH", name: "Ethereum", type: "crypto" },
    { id: "ADA", symbol: "ADA", name: "Cardano", type: "crypto" },
    { id: "SUI", symbol: "SUI", name: "Sui", type: "crypto" },
    { id: "SEI", symbol: "SEI", name: "Sei", type: "crypto" },
    { id: "EURC", symbol: "EURC", name: "Euro Coin", type: "crypto" }
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
        createdAt: now,
        updatedAt: now
      }).run();
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
  const { MarketService } = require("@crypto-control/market-data") as typeof import("@crypto-control/market-data");
  const { DatabasePortfolioRepository, DatabaseMarketCacheRepository } = require("@crypto-control/database") as typeof import("@crypto-control/database");

  const db = getDb();
  const marketCache = new DatabaseMarketCacheRepository(db);
  const marketService = new MarketService(marketCache);

  const getPortfolioService = () => {
    const { PortfolioService, PortfolioCalculator, FifoCalculator } = require("@crypto-control/portfolio") as typeof import("@crypto-control/portfolio");
    const repo = new DatabasePortfolioRepository(db);
    const calc = new PortfolioCalculator();
    const fifoCalc = new FifoCalculator();
    return new PortfolioService(repo, calc, fifoCalc, marketService);
  };

  // Helper to wrap IPC handlers with Result
  const withResult = <T extends unknown[], R>(fn: (...args: T) => Promise<R>) => async (...args: T) => {
    try {
      const data = await fn(...args);
      return { ok: true, data };
    } catch (e: unknown) {
      console.error("IPC Error:", e);
      const err = e as { message?: string; code?: string };
      return { ok: false, error: err.message || "Unknown error", code: err.code };
    }
  };

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
    return null; // TODO implement
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
    if (sanitizedPoints.length < 2) {
      throw new Error("No hay suficientes puntos de precio para generar la gráfica (mínimo 2)");
    }
    return HistoricalPriceResultSchema.parse({
      ...result,
      points: sanitizedPoints
    });
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
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "Crypto Control",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    console.log("[Electron] Cargando desarrollo:", process.env.VITE_DEV_SERVER_URL);
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    const prodPath = path.join(__dirname, "../../web/dist/index.html");
    console.log("[Electron] Cargando producción:", prodPath);
    // Ensure we use file:// protocol for production loading correctly
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
