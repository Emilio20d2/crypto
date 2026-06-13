import type { TransactionInput } from "./types";
import type { Lot, LotConsumption } from "./fifo";
import type { RealizedGain } from "./schemas";

export interface PortfolioRepository {
  getTransactions(): Promise<TransactionInput[]>;
  saveFifoResults(lots: Lot[], consumptions: LotConsumption[], realizedGains: RealizedGain[]): Promise<void>;
}
