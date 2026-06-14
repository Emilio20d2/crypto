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

export interface KeyPermissionsResponse {
  can_view: boolean;
  can_trade: boolean;
  can_transfer: boolean;
  portfolio_uuid?: string;
  is_default?: boolean;
}

export interface CdpKeyPermissions {
  canView: boolean;
  canTrade: boolean;
  canTransfer: boolean;
}

export interface CdpImportResult {
  connected: boolean;
  canceled?: boolean;
  keyDisplayName: string;
  algorithm: "ES256";
  permissions: CdpKeyPermissions;
}

export interface V2Account {
  id: string;
  name: string;
  primary: boolean;
  type: string;
  currency: {
    code: string;
    name: string;
    color: string;
    exponent: number;
    type: string;
  };
  balance: {
    amount: string;
    currency: string;
  };
  created_at: string;
  updated_at: string;
}

export interface V2AccountsResponse {
  pagination: {
    ending_before: string | null;
    starting_after: string | null;
    limit: number;
    order: string;
    previous_uri: string | null;
    next_uri: string | null;
  };
  data: V2Account[];
}

export interface V2Transaction {
  id: string;
  type: string;
  status: string;
  created_at: string;
  updated_at: string;
  resource: string;
  resource_path: string;
  amount: {
    amount: string;
    currency: string;
  };
  native_amount: {
    amount: string;
    currency: string;
  };
  description: string | null;
  details: {
    title: string;
    subtitle: string;
    [key: string]: any;
  };
  network?: {
    status: string;
    name?: string;
  };
  to?: {
    resource: string;
    [key: string]: any;
  };
  from?: {
    resource: string;
    [key: string]: any;
  };
  buy?: { id: string; resource: string; resource_path: string };
  sell?: { id: string; resource: string; resource_path: string };
  fiat_deposit?: { id: string; resource: string; resource_path: string };
  fiat_withdrawal?: { id: string; resource: string; resource_path: string };
  trade?: { id: string; resource: string; resource_path: string };
  advanced_trade_fill?: { order_id: string; fill_id: string; product_id: string };
}

export interface V2TransactionsResponse {
  pagination: {
    ending_before: string | null;
    starting_after: string | null;
    limit: number;
    order: string;
    previous_uri: string | null;
    next_uri: string | null;
  };
  data: V2Transaction[];
}

export interface CoinbasePortfolio {
  uuid: string;
  name: string;
  type: string;
  deleted: boolean;
}

export interface PortfoliosResponse {
  portfolios: CoinbasePortfolio[];
}

export interface CoinbaseSpotPosition {
  asset: string;
  account_uuid: string;
  asset_uuid: string | null;
  total_balance_fiat: number;
  total_balance_crypto: number;
  available_to_trade_fiat: number;
  available_to_trade_crypto: number;
  available_to_transfer_fiat: number;
  available_to_transfer_crypto: number;
  available_to_send_fiat: number;
  available_to_send_crypto: number;
  allocation: number;
  cost_basis: { value: number; currency: string } | null;
  average_entry_price: { value: number; currency: string } | null;
  unrealized_pnl: number;
  funding_pnl: number;
  asset_img_url: string | null;
  asset_color: string | null;
  is_cash: boolean;
  account_type: string | null;
}

export interface PortfolioBreakdownResponse {
  breakdown: {
    portfolio: CoinbasePortfolio;
    portfolio_balances: {
      total_balance: { value: string; currency: string } | null;
      total_crypto_balance: { value: string; currency: string } | null;
      total_cash_equivalent_balance: { value: string; currency: string } | null;
      total_futures_balance: { value: string; currency: string } | null;
      futures_unrealized_pnl: { value: string; currency: string } | null;
      perp_unrealized_pnl: { value: string; currency: string } | null;
    };
    spot_positions: CoinbaseSpotPosition[];
  };
}

export interface CoinbaseProduct {
  product_id: string;
  price: string;
  price_percentage_change_24h: string;
  volume_24h: string;
  volume_percentage_change_24h: string;
  base_increment: string;
  quote_increment: string;
  quote_min_size: string;
  quote_max_size: string;
  base_min_size: string;
  base_max_size: string;
  base_name: string;
  base_display_symbol: string;
  quote_name: string;
  quote_display_symbol: string;
  status: string;
  cancel_only: boolean;
  limit_only: boolean;
  post_only: boolean;
  trading_disabled: boolean;
  auction_mode: boolean;
  product_type: string;
  icon_url: string | null;
  quote_currency_id: string;
  base_currency_id: string;
  market_cap: string | null;
  view_only: boolean;
}

export interface ProductResponse {
  product_id: string;
  price: string;
  price_percentage_change_24h: string;
  volume_24h: string;
  volume_percentage_change_24h: string;
  base_increment: string;
  quote_increment: string;
  quote_min_size: string;
  quote_max_size: string;
  base_min_size: string;
  base_max_size: string;
  base_name: string;
  base_display_symbol: string;
  quote_name: string;
  quote_display_symbol: string;
  status: string;
  cancel_only: boolean;
  limit_only: boolean;
  post_only: boolean;
  trading_disabled: boolean;
  auction_mode: boolean;
  product_type: string;
  icon_url: string | null;
  quote_currency_id: string;
  base_currency_id: string;
  market_cap: string | null;
  view_only: boolean;
}

export interface CoinbaseCandle {
  start: string;
  low: string;
  high: string;
  open: string;
  close: string;
  volume: string;
}

export interface CandlesResponse {
  candles: CoinbaseCandle[];
}
