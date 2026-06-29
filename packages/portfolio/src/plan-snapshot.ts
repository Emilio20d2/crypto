export interface SnapshotPlan {
  id: string;
  name: string;
  status: string;
  baseCurrency: string;
}

export interface SnapshotPosition {
  assetId: string;
  balance: number;
  avgCostEur: number | null;
  currentValueEur: number | null;
  currentPriceEur: number | null;
}

export interface SnapshotCycleAsset {
  id: string;
  assetId: string;
  cycleId: string;
  status: string;
  allocationPercentage: number | null;
  allocationValue: number | null;
  allocationType: string;
  priority: number;
  targetAmount: number | null;
  targetValueEur: number | null;
  targetPortfolioPercentage: number | null;
  goalReachedAt: number | null;
  startDate: number;
  endDate: number | null;
}

export interface SnapshotCycle {
  id: string;
  planId: string;
  name: string;
  startDate: number;
  endDate: number | null;
  monthlyAmountEur: number;
  status: string;
  assets: SnapshotCycleAsset[];
}

export interface SnapshotContribution {
  id: string;
  cycleId: string;
  type: "periodica" | "extraordinaria";
  plannedDate: number;
  amountEur: number;
  destinationAssetId?: string | null;
  status: "pendiente" | "ejecutada" | "saltada" | "cancelada";
  executedAt: number | null;
}

export interface SnapshotSaleRule {
  id: string;
  cycleId: string;
  assetId: string;
  name: string;
  conditionType: string;
  conditionValue: number | null;
  conditionValue2: number | null;
  sellPercentage: number;
  priority: number;
  status: string;
}

export interface SnapshotRebuyTier {
  id: string;
  cycleId: string;
  assetId: string | null;
  drawdownPercentage: number;
  usagePercentage: number;
  priority: number;
  status: string;
  referenceType: string | null;
  referenceValue: number | null;
  lastTriggeredAt: number | null;
}

export interface SnapshotSubstitution {
  id: string;
  cycleId: string;
  fromAssetId: string;
  toAssetId: string | null;
  effectiveDate: number;
  status: string;
  transferMode: string;
}

export interface SnapshotStrategyRevision {
  id: string;
  cycleId: string;
  effectiveDate: number;
  title: string;
  notes: string | null;
  changesJson: string;
}

export interface SnapshotTreasury {
  cashEur: number;
  eurcEur: number;
  eurcAvailableEur: number;
  fiscalReserveEur: number;
  totalLiquidityEur: number;
}

export interface DataQualityInfo {
  overallScore: number;
  missingPrices: string[];
  missingCosts: string[];
  staleData: string[];
  notes: string[];
}

export interface PlanConsolidatedSnapshot {
  snapshotId: string;
  generatedAt: number;
  projectionStartDate: number;
  planId: string;
  planName: string;
  plans?: SnapshotPlan[];
  cycles: SnapshotCycle[];
  positions: Record<string, SnapshotPosition>;
  historicalCapitalEur: number;
  historicalSalesEur: number;
  historicalRebuysEur: number;
  futureContributions: SnapshotContribution[];
  saleRules: SnapshotSaleRule[];
  rebuyTiers: SnapshotRebuyTier[];
  substitutions: SnapshotSubstitution[];
  strategyRevisions: SnapshotStrategyRevision[];
  treasury: SnapshotTreasury;
  prices: Record<string, number | null>;
  dataQuality: DataQualityInfo;
  fiscalVersion: string;
  strategyVersion: string;
}
