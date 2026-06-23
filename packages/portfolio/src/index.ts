export * from "./signals";
export * from "./types";
export * from "./schemas";
export * from "./calculator";
export * from "./repository";
export * from "./service";
export * from "./fifo";
export * from "./cycle-metrics";
export * from "./rebuy-tiers";
export * from "./value-grid";
export * from "./cost-basis-backfill";
export * from "./plan-goals";
export * from "./plan-contributions";
export * from "./plan-substitutions";
export * from "./partial-sale-engine";
export * from "./rebuy-engine";
export * from "./plan-monitoring";
export * from "./smart-buy-engine";
export * from "./projection-engine";
// perspectives exports — selective to avoid naming conflicts with plan-substitutions
export type {
  SimScenario, AssetTier, SimLot, AssetSimState, MonthlyState,
  AnnualSnapshot, AnnualAssetPosition, SimEvent, SimEventType,
  ScenarioResult, ScenarioSummary, AssetSimSummary,
  PerspectivesSimulation, CurrentPosition, HistoricalLot,
  SimInput, SimCycle, SimCycleAsset, SimSaleRule, SimRebuyTier,
  SimSubstitution, SimRevision, SimOptions, TaxBand, PricePoint,
} from "./perspectives";
export { SIM_SCENARIOS, SCENARIO_LABELS, DEFAULT_SPANISH_TAX_BANDS, DEFAULT_SIM_OPTIONS, buildPricePath, buildPriceMap, monthKey, runPerspectivesSimulation } from "./perspectives";
