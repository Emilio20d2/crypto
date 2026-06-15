import type { TransactionInput } from "./types";
import type { FifoLot, LotConsumption } from "./fifo";
import type { RealizedGain } from "./schemas";

export interface PortfolioRepository {
  getTransactions(): Promise<TransactionInput[]>;
  saveFifoResults(lots: FifoLot[], consumptions: LotConsumption[], realizedGains: RealizedGain[]): Promise<void>;
  getAccountBalances(): Promise<Record<string, number>>;
  getStoredRealizedGains?(): Promise<RealizedGain[]>;
  getStoredFifoLots?(): Promise<FifoLot[]>;
}
