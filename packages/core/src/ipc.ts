import type { CreateTransactionInput } from "./validation";
import { CryptoControlAPI, Result, Asset } from "./types";

import { TransactionInput } from "@crypto-control/portfolio";

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
}

export interface ElectronWindow {
  cryptoControl: FullCryptoControlAPI;
}
