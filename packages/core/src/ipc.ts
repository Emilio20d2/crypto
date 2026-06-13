import type { CreateTransactionInput, Asset, Account } from "./validation";

// Interfaz que el proceso Main expone al Renderer mediante ContextBridge
export interface IPCAPI {
  portfolio: {
    getSummary: () => Promise<{ totalValueEur: number }>;
  };
  transactions: {
    list: () => Promise<any[]>;
    create: (data: CreateTransactionInput) => Promise<{ success: boolean; id?: string; error?: string }>;
    update: (id: string, data: CreateTransactionInput) => Promise<{ success: boolean }>;
    delete: (id: string) => Promise<{ success: boolean }>;
  };
  assets: {
    list: () => Promise<any[]>;
  };
  market: {
    getCurrentPrice: (assetId: string, currency?: string) => Promise<any>;
    getHistoricalPrices: (assetId: string, period: string, currency?: string) => Promise<any>;
  };
  settings: {
    get: (key: string) => Promise<string | null>;
    update: (key: string, value: string) => Promise<{ success: boolean }>;
  };
}

export interface ElectronWindow {
  api: IPCAPI;
}
