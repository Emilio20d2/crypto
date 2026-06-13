import { TransactionInput } from "./types";

export interface PortfolioRepository {
  getTransactions(): Promise<TransactionInput[]>;
}
