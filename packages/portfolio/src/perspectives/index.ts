export * from "./types";
export { runPerspectivesSimulation } from "./sim-engine";
export * from "./forecast-sources";
export { KNOWN_FORECASTS, FORECAST_ASSET_IDS } from "./known-forecasts";
export {
  buildExternalPriceMap, monthKey, getAssetTier, CIRCULATING_SUPPLY_M,
  type CoverageState, type ExternalPriceResult,
} from "./external-price-builder";
export {
  observationToForecastSources, computeCoverageMatrix, computeFinalWeight,
  MIN_SOURCES_FOR_QUANTILE,
  type ObservationRow, type SourceRow, type IngestionLogRow, type AssetYearCoverage,
} from "./forecast-repository";
export {
  ingestSource, ingestRssSource, ingestHttpSource, verifyUrl,
  type IngestableSource, type IngestResult,
} from "./forecast-ingestion";
export { SEED_FORECAST_SOURCES, SEED_FORECAST_OBSERVATIONS, type SeedSource, type SeedObservation } from "./forecast-seed";
export {
  validateStagingObservations, validateMonotonicity, runRegressionTest,
  type ValidationReport, type ValidationError, type RegressionReport, type StagingRow,
} from "./forecast-validation";
export {
  ForecastCandidateRepository,
  type CandidateVersion, type CandidateRow, type SqliteDb,
} from "./forecast-candidate-repository";
export {
  ForecastActiveRepository, PERSPECTIVES_EXTERNAL_FORECASTS_ENABLED,
  type ActiveVersion,
} from "./forecast-active-repository";
