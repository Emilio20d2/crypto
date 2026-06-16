import type {
  CreateInvestmentAssetInput,
  CreateInvestmentCycleInput,
  CreateInvestmentPlanInput,
  CreateStrategyRevisionInput,
  CreateTreasuryMovementInput,
  CreateTransactionInput,
  CreatePartialSaleInput,
  PartialSale,
  InvestmentAsset,
  InvestmentAssetStateChangeInput,
  InvestmentCycle,
  InvestmentPlan,
  StrategyRevision,
  SetFiscalReserveInput,
  TreasuryMovement,
  TreasurySummary,
  AllocateEurcToRebuyInput,
  AllocateCashToRebuyInput,
  CycleLiquidityAllocation,
  CycleLiquidityStatus,
  FiscalReserveMovement,
  CycleMetrics,
  AssetHealthResult,
  UpdateInvestmentAssetInput,
  UpdateInvestmentCycleInput,
  UpdateInvestmentPlanInput,
  UpdateTreasuryMovementInput
} from "./validation";
import { CryptoControlAPI, Result, Asset, MarketSentiment, MarketSentimentTimeframe } from "./types";

import { TransactionInput } from "@crypto-control/portfolio";

export interface CoinbaseCredentials {
  apiKeyName: string;
  privateKeyPem: string;
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

export interface CoinbaseStatus {
  connected: boolean;
  lastSyncAt: number | null;
  lastSyncItemsProcessed: number | null;
  lastSyncStatus: "success" | "error" | null;
  lastSyncError: string | null;
  keyDisplayName?: string | null;
  algorithm?: string | null;
  credentialType?: string | null;
  keychainStatus?: "stored" | "missing" | "legacy" | "unknown";
  lastValidationAt?: number | null;
  permissions?: CdpKeyPermissions | null;
}

export interface CoinbaseSyncResult {
  itemsProcessed: number;
  newTransactions: number;
  skippedDuplicates: number;
  durationMs?: number;
  accountsConsulted?: number;
  pagesDownloaded?: number;
  transactionsDownloaded?: number;
  fillsDownloaded?: number;
  updatedTransactions?: number;
  pendingValuations?: number;
  errors?: string[];
}

export interface CoinbaseSyncHistoryItem {
  id: string;
  timestamp: number;
  status: string;
  itemsProcessed: number;
  newTransactions?: number | null;
  skippedDuplicates?: number | null;
  durationMs?: number | null;
  error?: string | null;
}

export interface DiagnosticsAsset {
  symbol: string;
  amount: number;
  hasPrice: boolean;
  hasHistoricalPrice: boolean;
  hasCostBasis: boolean;
  rendered: boolean;
}

export interface DiagnosticsReport {
  accounts: number;
  balances: number;
  transactions: number;
  conversions: number;
  fees: number;
  assets: number;
  positions: number;
  historicalPrices: number;
  missingPrices: number;
  missingCosts: number;
  perAsset: DiagnosticsAsset[];
}

export interface FullCryptoControlAPI extends CryptoControlAPI {
  diagnostics: {
    getReport: () => Promise<Result<DiagnosticsReport>>;
  };
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
    importCredentialsFile: () => Promise<Result<CdpImportResult>>;
    connectFromJson: (jsonContent: string) => Promise<Result<CdpImportResult>>;
    connect: (credentials: CoinbaseCredentials) => Promise<Result<{ connected: boolean }>>;
    disconnect: () => Promise<Result<null>>;
    getStatus: () => Promise<Result<CoinbaseStatus>>;
    sync: () => Promise<Result<CoinbaseSyncResult>>;
    getSyncHistory: () => Promise<Result<CoinbaseSyncHistoryItem[]>>;
    listPortfolios: () => Promise<Result<any>>;
    getPortfolioBreakdown: (portfolioUuid: string, currency: string) => Promise<Result<any>>;
    getPortfolioSnapshots: (portfolioUuid: string) => Promise<Result<any>>;
  };
  sentiment: {
    getGlobal: (input: { timeframe: MarketSentimentTimeframe }) => Promise<Result<MarketSentiment>>;
    getAsset: (input: { assetId: string; timeframe: MarketSentimentTimeframe }) => Promise<Result<MarketSentiment>>;
    getHistory: (input: { scope: "global" | "asset"; assetId?: string | null; timeframe: MarketSentimentTimeframe; limit?: number }) => Promise<Result<MarketSentiment[]>>;
    refresh: (input: { scope: "global" | "asset"; assetId?: string | null; timeframe: MarketSentimentTimeframe }) => Promise<Result<MarketSentiment>>;
  };
  targets: {
    list: () => Promise<Result<Array<{ id: string; assetId: string; targetPriceEur: number }>>>;
    upsert: (data: { id?: string; assetId: string; targetPriceEur: number }) => Promise<Result<{ id: string }>>;
    delete: (id: string) => Promise<Result<null>>;
  };
  alerts: {
    list: () => Promise<Result<Array<{ id: string; assetId: string; priceThreshold: number; direction: "above" | "below"; isActive: boolean }>>>;
    create: (data: { assetId: string; priceThreshold: number; direction: "above" | "below" }) => Promise<Result<{ id: string }>>;
    delete: (id: string) => Promise<Result<null>>;
    toggle: (id: string) => Promise<Result<null>>;
  };
  investmentPlan: {
    list: () => Promise<Result<InvestmentPlan[]>>;
    getActive: () => Promise<Result<InvestmentPlan | null>>;
    create: (data: CreateInvestmentPlanInput) => Promise<Result<{ id: string }>>;
    update: (id: string, data: UpdateInvestmentPlanInput) => Promise<Result<InvestmentPlan>>;
    delete: (id: string) => Promise<Result<null>>;
  };
  investmentCycles: {
    list: (input?: { planId?: string }) => Promise<Result<InvestmentCycle[]>>;
    getCurrent: (input?: { planId?: string; at?: number }) => Promise<Result<InvestmentCycle | null>>;
    create: (data: CreateInvestmentCycleInput) => Promise<Result<{ id: string }>>;
    update: (id: string, data: UpdateInvestmentCycleInput) => Promise<Result<InvestmentCycle>>;
    delete: (id: string) => Promise<Result<null>>;
    getMetrics: (input: { cycleId: string }) => Promise<Result<CycleMetrics>>;
    listPartialSales: (input?: { cycleId?: string }) => Promise<Result<PartialSale[]>>;
    createPartialSale: (data: CreatePartialSaleInput) => Promise<Result<{ id: string }>>;
    deletePartialSale: (id: string) => Promise<Result<null>>;
  };
  investmentAssets: {
    list: (input?: { cycleId?: string }) => Promise<Result<InvestmentAsset[]>>;
    create: (data: CreateInvestmentAssetInput) => Promise<Result<{ id: string }>>;
    update: (id: string, data: UpdateInvestmentAssetInput) => Promise<Result<InvestmentAsset>>;
    pause: (id: string, data?: InvestmentAssetStateChangeInput) => Promise<Result<InvestmentAsset>>;
    close: (id: string, data?: InvestmentAssetStateChangeInput) => Promise<Result<InvestmentAsset>>;
    delete: (id: string) => Promise<Result<null>>;
    getHealth: (input: { assetId: string }) => Promise<Result<AssetHealthResult>>;
  };
  strategyRevisions: {
    list: (input?: { cycleId?: string }) => Promise<Result<StrategyRevision[]>>;
    create: (data: CreateStrategyRevisionInput) => Promise<Result<{ id: string }>>;
  };
  treasury: {
    getSummary: () => Promise<Result<TreasurySummary>>;
    listMovements: () => Promise<Result<TreasuryMovement[]>>;
    createMovement: (data: CreateTreasuryMovementInput) => Promise<Result<{ id: string }>>;
    updateMovement: (id: string, data: UpdateTreasuryMovementInput) => Promise<Result<TreasuryMovement>>;
    deleteMovement: (id: string) => Promise<Result<null>>;
    setFiscalReserve: (data: SetFiscalReserveInput) => Promise<Result<TreasurySummary>>;
    allocateEurcToRebuy: (data: AllocateEurcToRebuyInput) => Promise<Result<{ id: string }>>;
    allocateCashToRebuy: (data: AllocateCashToRebuyInput) => Promise<Result<{ id: string }>>;
    listCycleLiquidity: (input?: { cycleId?: string; status?: CycleLiquidityStatus }) => Promise<Result<CycleLiquidityAllocation[]>>;
    listFiscalReserveMovements: (input?: { realizedGainIds?: string[] }) => Promise<Result<FiscalReserveMovement[]>>;
  };
}

export interface ElectronWindow {
  cryptoControl: FullCryptoControlAPI;
}
