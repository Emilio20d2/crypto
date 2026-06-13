// Coinbase Advanced Trade API types

export interface CoinbaseFill {
  entry_id: string;
  trade_id: string;
  order_id: string;
  trade_time: string; // ISO 8601
  trade_type: string;
  price: string;
  size: string;
  commission: string;
  product_id: string; // e.g. "BTC-EUR"
  sequence_timestamp: string; // ISO 8601
  liquidity_indicator: string;
  size_in_quote: boolean;
  user_id: string;
  side: "BUY" | "SELL";
  retail_portfolio_id?: string;
  preview_id?: string | null;
}

export interface FillsResponse {
  fills: CoinbaseFill[];
  cursor: string;
}

export interface CoinbaseAccount {
  uuid: string;
  name: string;
  currency: string;
  available_balance: { value: string; currency: string };
  hold: { value: string; currency: string };
}

export interface AccountsResponse {
  accounts: CoinbaseAccount[];
  has_next: boolean;
  cursor: string;
  size: number;
}

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
