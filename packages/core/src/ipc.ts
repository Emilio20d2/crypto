import type { CreateTransactionInput } from "./validation";
import { CryptoControlAPI, Result, Asset } from "./types";

import { TransactionInput } from "@crypto-control/portfolio";

export interface CoinbaseCredentials {
  apiKeyName: string;
  privateKeyPem: string;
}

export interface CoinbaseStatus {
  connected: boolean;
  lastSyncAt: number | null;
  lastSyncItemsProcessed: number | null;
  lastSyncStatus: "success" | "error" | null;
  lastSyncError: string | null;
}

export interface CoinbaseSyncResult {
  itemsProcessed: number;
  newTransactions: number;
  skippedDuplicates: number;
}

export interface FullCryptoControlAPI extends CryptoControlAPI {
  transactions: {
    list: () => Promise<Result<TransactionInput[]>>;
    create: (data: CreateTransactionInput) => Promise<Result<{ id?: string }>>;
    update: (id: string, data: CreateTransactionInput) => Promise<Result<null>>;
    delete: (id: string) => Promise<Result<null>>;
  };
  settings: {
    get: (key: string) => Promise<Result<string | null>>;
    update: (key: string, value: string) => Promise<Result<null>>;
  };
  coinbase: {
    connect: (credentials: CoinbaseCredentials) => Promise<Result<{ connected: boolean }>>;
    disconnect: () => Promise<Result<null>>;
    getStatus: () => Promise<Result<CoinbaseStatus>>;
    sync: () => Promise<Result<CoinbaseSyncResult>>;
  };
}

export interface ElectronWindow {
  cryptoControl: FullCryptoControlAPI;
}
