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
export * from "./profit-harvest-cycle";
// perspectives exports — selective to avoid naming conflicts with plan-substitutions
export type {
  SimScenario, AssetTier, SimLot, AssetSimState, MonthlyState,
  AnnualSnapshot, AnnualAssetPosition, SimEvent, SimEventType,
  ScenarioResult, ScenarioSummary, AssetSimSummary,
  PerspectivesSimulation, CurrentPosition, HistoricalLot,
  SimInput, SimCycle, SimCycleAsset, SimSaleRule, SimRebuyTier,
  SimSubstitution, SimRevision, SimOptions, TaxBand,
  ForecastDataset,
  PriceModelType, CoverageState, ExternalPriceResult,
  ObservationRow, SourceRow, IngestionLogRow, AssetYearCoverage,
  IngestableSource, IngestResult, SeedSource, SeedObservation,
} from "./perspectives";
export {
  SIM_SCENARIOS, SCENARIO_LABELS, DEFAULT_SPANISH_TAX_BANDS, DEFAULT_SIM_OPTIONS,
  monthKey, runPerspectivesSimulation, buildExternalPriceMap,
  observationToForecastSources, normalizeForecastSourceType, computeCoverageMatrix, computeFinalWeight,
  MIN_SOURCES_FOR_QUANTILE, ingestSource, ingestRssSource, ingestHttpSource, verifyUrl,
  SEED_FORECAST_SOURCES, SEED_FORECAST_OBSERVATIONS,
  validateStagingObservations, validateMonotonicity, runRegressionTest,
  ForecastCandidateRepository, ForecastActiveRepository, PERSPECTIVES_EXTERNAL_FORECASTS_ENABLED,
} from "./perspectives";
export type {
  ForecastSource, ForecastDirection, ForecastSourceType,
  ValidationReport, ValidationError, RegressionReport, StagingRow,
  CandidateVersion, CandidateRow, SqliteDb, ActiveVersion,
} from "./perspectives";
