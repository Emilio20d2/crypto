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
export * from "./fiscal-config";
export * from "./plan-snapshot";
export * from "./profit-harvest-cycle";

// Perspectivas V5 es la única superficie nueva que debe usarse a partir de esta rama.
// La carpeta ./perspectives queda como legado temporal hasta terminar la migración de
// Electron/preload/UI; no se reexporta como API principal para evitar usar V4 por accidente.
export * from "./perspectives-v5";

// Compatibilidad estrictamente necesaria para módulos heredados que todavía importan
// ingestion/forecast repositories desde @crypto-control/portfolio. No exportar aquí
// runPerspectivesSimulation ni tipos de simulación V4.
export type {
  ForecastSource, ForecastDirection, ForecastSourceType,
  ValidationReport, ValidationError, RegressionReport, StagingRow,
  CandidateVersion, CandidateRow, SqliteDb, ActiveVersion,
  ExternalPriceResult, ObservationRow, SourceRow, IngestionLogRow,
  AssetYearCoverage, IngestableSource, IngestResult, SeedSource, SeedObservation,
} from "./perspectives";
export {
  buildExternalPriceMap,
  observationToForecastSources, normalizeForecastSourceType, computeCoverageMatrix, computeFinalWeight,
  MIN_SOURCES_FOR_QUANTILE, ingestSource, ingestRssSource, ingestHttpSource, verifyUrl,
  SEED_FORECAST_SOURCES, SEED_FORECAST_OBSERVATIONS,
  validateStagingObservations, validateMonotonicity, runRegressionTest,
  ForecastCandidateRepository, ForecastActiveRepository, PERSPECTIVES_EXTERNAL_FORECASTS_ENABLED,
} from "./perspectives";
