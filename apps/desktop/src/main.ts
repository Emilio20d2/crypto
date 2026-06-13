import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import { initializeDatabase, runMigrations, getDb, schema } from "@crypto-control/database";
import { CreateTransactionSchema } from "@crypto-control/core";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import * as fs from "fs";

let mainWindow: BrowserWindow | null = null;

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
      : path.join(__dirname, "../../database/drizzle");
    
    // Fallback if the path exists, else we skip (e.g. during test without migrations copied)
    if (fs.existsSync(migrationsPath)) {
      runMigrations(migrationsPath);
      console.log("[DB] Migraciones aplicadas");
    } else {
      console.warn("[DB] No se encontró carpeta de migraciones en", migrationsPath);
    }
  } catch (e: any) {
    console.error("[DB] Fallo en migración:", e.message);
    // Un fallo en migración detendría la ejecución si es destructiva, 
    // pero idealmente deberíamos hacer un backup del SQLite antes (implementación de backup requerida)
  }
}

function setupIpcHandlers() {
  const { MarketService } = require("@crypto-control/market-data");
  const { PortfolioService, PortfolioCalculator } = require("@crypto-control/portfolio");
  const { DatabasePortfolioRepository, DatabaseMarketCacheRepository } = require("@crypto-control/database");

  const db = getDb();
  const marketCache = new DatabaseMarketCacheRepository(db);
  const marketService = new MarketService(marketCache);
  
  // We lazily instantiate the portfolio service per request or once the DB is ready
  const getPortfolioService = () => {
    const repo = new DatabasePortfolioRepository(db);
    const calc = new PortfolioCalculator();
    return new PortfolioService(repo, calc, marketService);
  };

  // Helper to wrap IPC handlers with Result
  const withResult = (fn: (...args: any[]) => Promise<any>) => async (...args: any[]) => {
    try {
      const data = await fn(...args);
      return { ok: true, data };
    } catch (e: any) {
      console.error("IPC Error:", e);
      return { ok: false, error: e.message, code: e.code };
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
    const db = getDb();
    return await db.select().from(schema.transactions).all();
  }));

  ipcMain.handle("transactions:create", withResult(async (_, payload) => {
    const db = getDb();
    const parsed = CreateTransactionSchema.parse(payload);
    
    return db.transaction((tx: any) => {
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
    const price = await marketService.getCurrentPrice(input.assetId);
    return {
      price,
      provider: "market-service",
      timestamp: Date.now()
    };
  }));

  ipcMain.handle("market:get-historical-prices", withResult(async (_, input: {assetId: string, period: string, quoteCurrency?: string}) => {
    const points = await marketService.getHistoricalPrices(input.assetId, input.period);
    return {
      points: points.map((p: any) => ({ time: Math.floor(p.timestamp / 1000), value: p.price })),
      provider: "market-service",
      requestedPeriod: input.period,
      actualInterval: "auto",
      fetchedAt: Date.now(),
      isCached: false
    };
  }));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
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
