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
  ipcMain.handle("portfolio:get-summary", async () => {
    return { totalValueEur: 0 };
  });

  ipcMain.handle("transactions:list", async () => {
    try {
      const db = getDb();
      return await db.select().from(schema.transactions).all();
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("transactions:create", async (_, payload) => {
    try {
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
            legType: leg.legType
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
        
        return { success: true, id: txId };
      });
    } catch (e: any) {
      console.error("IPC Error transactions:create", e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("transactions:update", async (_, id: string, payload) => {
    return { success: true };
  });

  ipcMain.handle("transactions:delete", async (_, id: string) => {
    try {
      const db = getDb();
      await db.delete(schema.transactions).where(eq(schema.transactions.id, id)).run();
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("assets:list", async () => {
    try {
      const db = getDb();
      return await db.select().from(schema.assets).all();
    } catch (e) {
      return [];
    }
  });

  const { MarketService } = require("@crypto-control/market-data");
  const marketService = new MarketService();

  ipcMain.handle("market:get-current-price", async (_, assetId: string, currency: string = "EUR") => {
    try {
      return await marketService.getCurrentPrice(assetId, currency);
    } catch (e: any) {
      return { error: e.message };
    }
  });

  ipcMain.handle("market:get-historical-prices", async (_, assetId: string, period: string, currency: string = "EUR") => {
    try {
      return await marketService.getHistoricalPrices(assetId, period, currency);
    } catch (e: any) {
      return { error: e.message };
    }
  });
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
