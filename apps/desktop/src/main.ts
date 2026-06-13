import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import { db, transactions, transactionLegs, fees, assets } from "@crypto-control/database";
import { CreateTransactionSchema } from "@crypto-control/core";
import crypto from "crypto";
import { eq } from "drizzle-orm";

let mainWindow: BrowserWindow | null = null;

function setupIpcHandlers() {
  ipcMain.handle("portfolio:get-summary", async () => {
    return { totalValueEur: 0 };
  });

  ipcMain.handle("transactions:list", async () => {
    try {
      return await db.select().from(transactions).all();
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("transactions:create", async (_, payload) => {
    try {
      const parsed = CreateTransactionSchema.parse(payload);
      
      return db.transaction((tx) => {
        const txId = crypto.randomUUID();
        
        tx.insert(transactions).values({
          id: txId,
          type: parsed.type,
          date: parsed.date,
          externalId: parsed.externalId,
          notes: parsed.notes,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }).run();

        for (const leg of parsed.legs) {
          tx.insert(transactionLegs).values({
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
            tx.insert(fees).values({
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
    // Para simplificar, requerirá una implementación detallada en Hito 2
    return { success: true };
  });

  ipcMain.handle("transactions:delete", async (_, id: string) => {
    try {
      await db.delete(transactions).where(eq(transactions.id, id)).run();
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("assets:list", async () => {
    return await db.select().from(assets).all();
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
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../web/dist/index.html"));
  }
}

app.whenReady().then(() => {
  setupIpcHandlers();
  createWindow();

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
