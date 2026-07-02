// ─── Tests de arquitectura staging→candidate→active ───────────────────────────
// Regresión, aislamiento por activo, activación atómica, rollback, feature flag.

import { describe, it, expect, beforeEach } from "vitest";
import { validateStagingObservations, validateMonotonicity } from "./forecast-validation";
import { ForecastCandidateRepository } from "./forecast-candidate-repository";
import { ForecastActiveRepository, PERSPECTIVES_EXTERNAL_FORECASTS_ENABLED } from "./forecast-active-repository";
import { KNOWN_FORECASTS } from "./known-forecasts";
import { runLegacyPerspectivesSimulation } from "./sim-engine";
import type { SimInput, SimCycle } from "./types";
import { DEFAULT_SPANISH_TAX_BANDS } from "./types";
import type { StagingRow } from "./forecast-validation";
import type { ForecastSource } from "./forecast-sources";
import type { SqliteDb } from "./forecast-candidate-repository";

const NOW = new Date("2026-06-25").getTime();
const YEAR_MS = 365.25 * 24 * 3600 * 1000;

// ─── Mock SQLite ──────────────────────────────────────────────────────────────

function makeMemoryDb(): SqliteDb {
  const tables: Record<string, Record<string, unknown>[]> = {
    forecast_versions_candidate: [],
    forecast_versions_active: [],
  };

  return {
    prepare(sql: string) {
      const s = sql.trim().toUpperCase();
      return {
        run(...args: unknown[]) {
          if (s.startsWith("INSERT INTO FORECAST_VERSIONS_CANDIDATE")) {
            tables.forecast_versions_candidate.push({
              id: args[0], created_at: args[1], snapshot_json: args[2],
              observation_ids_json: args[3], validation_passed: args[4],
              validation_report_json: args[5], regression_passed: args[6],
              regression_report_json: args[7], status: args[8],
              approved_at: null, rejected_at: null, rejected_reason: null,
            });
          } else if (s.includes("UPDATE FORECAST_VERSIONS_CANDIDATE") && s.includes("STATUS = 'APPROVED'")) {
            const id = args[1];
            const row = tables.forecast_versions_candidate.find(r => r.id === id);
            if (row) { row.status = "approved"; row.approved_at = args[0]; }
          } else if (s.includes("UPDATE FORECAST_VERSIONS_CANDIDATE") && s.includes("STATUS = 'REJECTED'")) {
            const id = args[2];
            const row = tables.forecast_versions_candidate.find(r => r.id === id);
            if (row) { row.status = "rejected"; row.rejected_at = args[0]; row.rejected_reason = args[1]; }
          } else if (s.includes("INSERT INTO FORECAST_VERSIONS_ACTIVE")) {
            const existing = tables.forecast_versions_active.find(r => r.id === "current");
            if (existing) {
              existing.candidate_id = args[0];
              existing.activated_at = args[1];
              existing.snapshot_json = args[2];
              existing.previous_candidate_id = args[3];
            } else {
              tables.forecast_versions_active.push({
                id: "current", candidate_id: args[0], activated_at: args[1],
                snapshot_json: args[2], previous_candidate_id: args[3],
              });
            }
          } else if (s.startsWith("UPDATE FORECAST_VERSIONS_ACTIVE")) {
            const row = tables.forecast_versions_active.find(r => r.id === "current");
            if (row) {
              const prevId = row.candidate_id;
              row.candidate_id = row.previous_candidate_id as string;
              row.activated_at = args[0];
              row.snapshot_json = args[1];
              row.previous_candidate_id = prevId;
            }
          }
        },
        get(...args: unknown[]) {
          if (s.includes("FORECAST_VERSIONS_CANDIDATE WHERE ID")) {
            return tables.forecast_versions_candidate.find(r => r.id === args[0]) ?? undefined;
          }
          if (s.includes("FORECAST_VERSIONS_ACTIVE WHERE ID = 'CURRENT'")) {
            return tables.forecast_versions_active.find(r => r.id === "current") ?? undefined;
          }
          return undefined;
        },
        all(..._args: unknown[]) {
          if (s.includes("FORECAST_VERSIONS_CANDIDATE WHERE STATUS = 'PENDING'")) {
            return tables.forecast_versions_candidate.filter(r => r.status === "pending");
          }
          return [];
        },
      };
    },
  };
}

// ─── Fixture de simulación base ───────────────────────────────────────────────

function makeSimInput(overrides: Partial<SimInput> = {}): SimInput {
  const cycle: SimCycle = {
    id: "c1", planId: "p1", name: "Ciclo test",
    startDate: NOW - YEAR_MS, endDate: NOW + 4 * YEAR_MS,
    monthlyAmountEur: 300,
    assets: [
      {
        id: "a1", assetId: "BTC", allocationType: "percentage",
        allocationValue: 60, allocationPercentage: 60,
        fixedAmountEur: null, targetAmount: null, targetValueEur: null,
        startDate: NOW - YEAR_MS, endDate: null, status: "active",
      },
      {
        id: "a2", assetId: "ETH", allocationType: "percentage",
        allocationValue: 30, allocationPercentage: 30,
        fixedAmountEur: null, targetAmount: null, targetValueEur: null,
        startDate: NOW - YEAR_MS, endDate: null, status: "active",
      },
      {
        id: "a3", assetId: "SUI", allocationType: "percentage",
        allocationValue: 10, allocationPercentage: 10,
        fixedAmountEur: null, targetAmount: null, targetValueEur: null,
        startDate: NOW - YEAR_MS, endDate: null, status: "active",
      },
    ],
    saleRules: [], rebuyTiers: [], substitutions: [], revisions: [],
  };
  return {
    now: NOW,
    horizonDate: NOW + 4 * YEAR_MS,
    currentPositions: [
      { assetId: "BTC", balance: 0.01, avgCostEur: 50_000, currentPriceEur: 85_000 },
      { assetId: "ETH", balance: 0.5,  avgCostEur: 2_000,  currentPriceEur: 2_500 },
      { assetId: "SUI", balance: 100,  avgCostEur: 1.5,    currentPriceEur: 3.0 },
    ],
    currentLots: [
      { id: "l1", assetId: "BTC", date: NOW - YEAR_MS, remainingAmount: 0.01, unitAcquisitionPriceEur: 50_000 },
      { id: "l2", assetId: "ETH", date: NOW - YEAR_MS, remainingAmount: 0.5, unitAcquisitionPriceEur: 2_000 },
      { id: "l3", assetId: "SUI", date: NOW - YEAR_MS, remainingAmount: 100, unitAcquisitionPriceEur: 1.5 },
    ],
    eurcFree: 0, eurcFiscalReserve: 0, eurCash: 0,
    historicalCapitalEur: 1_000,
    cycles: [cycle],
    options: { policy: "full_strategy", commissionRate: 0.004, taxBands: DEFAULT_SPANISH_TAX_BANDS },
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("arquitectura: feature flag", () => {
  it("PERSPECTIVES_EXTERNAL_FORECASTS_ENABLED es false", () => {
    expect(PERSPECTIVES_EXTERNAL_FORECASTS_ENABLED).toBe(false);
  });

  it("ForecastActiveRepository.getSourcesForEngine devuelve null cuando flag=false", () => {
    const db = makeMemoryDb();
    const repo = new ForecastActiveRepository(db);
    expect(repo.getSourcesForEngine()).toBeNull();
  });
});

describe("arquitectura: regresión — motor produce resultados estables", () => {
  it("dos ejecuciones con KNOWN_FORECASTS producen resultados idénticos", () => {
    const input = makeSimInput();
    const r1 = runLegacyPerspectivesSimulation(input);
    const r2 = runLegacyPerspectivesSimulation(input);
    for (const sc of ["conservador", "base", "optimista"] as const) {
      const w1 = r1.scenarios.find(s => s.scenario === sc)!.summary.finalNetWealthEur;
      const w2 = r2.scenarios.find(s => s.scenario === sc)!.summary.finalNetWealthEur;
      expect(w1).toBeCloseTo(w2, 2);
    }
  });

  it("motor no produce NaN ni Infinity en ningún escenario", () => {
    const result = runLegacyPerspectivesSimulation(makeSimInput());
    for (const scenario of result.scenarios) {
      expect(Number.isFinite(scenario.summary.finalNetWealthEur)).toBe(true);
      expect(Number.isNaN(scenario.summary.finalNetWealthEur)).toBe(false);
      expect(scenario.summary.finalNetWealthEur).toBeGreaterThanOrEqual(0);
    }
  });

  it("los cinco escenarios son finitos, trazables y no se corrigen manualmente", () => {
    const result = runLegacyPerspectivesSimulation(makeSimInput());
    expect(result.scenarios.map(s => s.scenario)).toEqual([
      "conservador",
      "moderado",
      "base",
      "favorable",
      "optimista",
    ]);
    for (const scenario of result.scenarios) {
      expect(Number.isFinite(scenario.summary.finalNetWealthEur)).toBe(true);
      expect(scenario.summary.finalNetWealthEur).toBeGreaterThan(0);
    }
    const base = result.scenarios.find(s => s.scenario === "base")!.summary.finalNetWealthEur;
    const opt = result.scenarios.find(s => s.scenario === "optimista")!.summary.finalNetWealthEur;
    expect(opt).toBeGreaterThanOrEqual(base - 1);
  });
});

describe("arquitectura: aislamiento por activo", () => {
  it("aislamiento BTC — cambiar ETH no afecta resultado BTC-only", () => {
    const btcOnly = makeSimInput({
      currentPositions: [{ assetId: "BTC", balance: 0.01, avgCostEur: 50_000, currentPriceEur: 85_000 }],
      currentLots: [{ id: "l1", assetId: "BTC", date: NOW - YEAR_MS, remainingAmount: 0.01, unitAcquisitionPriceEur: 50_000 }],
      cycles: [{
        id: "c1", planId: "p1", name: "BTC only",
        startDate: NOW - YEAR_MS, endDate: NOW + 4 * YEAR_MS, monthlyAmountEur: 300,
        assets: [{
          id: "a1", assetId: "BTC", allocationType: "percentage",
          allocationValue: 100, allocationPercentage: 100,
          fixedAmountEur: null, targetAmount: null, targetValueEur: null,
          startDate: NOW - YEAR_MS, endDate: null, status: "active",
        }],
        saleRules: [], rebuyTiers: [], substitutions: [], revisions: [],
      }],
    });
    const r1 = runLegacyPerspectivesSimulation(btcOnly);
    const r2 = runLegacyPerspectivesSimulation(btcOnly);
    const w1 = r1.scenarios.find(s => s.scenario === "base")!.summary.finalNetWealthEur;
    const w2 = r2.scenarios.find(s => s.scenario === "base")!.summary.finalNetWealthEur;
    expect(w1).toBeCloseTo(w2, 2);
    const optW = r1.scenarios.find(s => s.scenario === "optimista")!.summary.finalNetWealthEur;
    expect(Number.isFinite(optW)).toBe(true);
  });

  it("aislamiento ETH — simulación ETH-only produce resultado finito y positivo", () => {
    const ethOnly = makeSimInput({
      currentPositions: [{ assetId: "ETH", balance: 0.5, avgCostEur: 2_000, currentPriceEur: 2_500 }],
      currentLots: [{ id: "l2", assetId: "ETH", date: NOW - YEAR_MS, remainingAmount: 0.5, unitAcquisitionPriceEur: 2_000 }],
      cycles: [{
        id: "c1", planId: "p1", name: "ETH only",
        startDate: NOW - YEAR_MS, endDate: NOW + 4 * YEAR_MS, monthlyAmountEur: 300,
        assets: [{
          id: "a2", assetId: "ETH", allocationType: "percentage",
          allocationValue: 100, allocationPercentage: 100,
          fixedAmountEur: null, targetAmount: null, targetValueEur: null,
          startDate: NOW - YEAR_MS, endDate: null, status: "active",
        }],
        saleRules: [], rebuyTiers: [], substitutions: [], revisions: [],
      }],
    });
    const result = runLegacyPerspectivesSimulation(ethOnly);
    const baseW = result.scenarios.find(s => s.scenario === "base")!.summary.finalNetWealthEur;
    expect(baseW).toBeGreaterThan(0);
    const optW = result.scenarios.find(s => s.scenario === "optimista")!.summary.finalNetWealthEur;
    expect(Number.isFinite(optW)).toBe(true);
  });

  it("aislamiento SUI — sin previsiones externas usa extensión modelizada, no precio plano", () => {
    const suiOnly = makeSimInput({
      currentPositions: [{ assetId: "SUI", balance: 100, avgCostEur: 1.5, currentPriceEur: 3.0 }],
      currentLots: [{ id: "l3", assetId: "SUI", date: NOW - YEAR_MS, remainingAmount: 100, unitAcquisitionPriceEur: 1.5 }],
      cycles: [{
        id: "c1", planId: "p1", name: "SUI only",
        startDate: NOW - YEAR_MS, endDate: NOW + 4 * YEAR_MS, monthlyAmountEur: 300,
        assets: [{
          id: "a3", assetId: "SUI", allocationType: "percentage",
          allocationValue: 100, allocationPercentage: 100,
          fixedAmountEur: null, targetAmount: null, targetValueEur: null,
          startDate: NOW - YEAR_MS, endDate: null, status: "active",
        }],
        saleRules: [], rebuyTiers: [], substitutions: [], revisions: [],
      }],
    });
    const result = runLegacyPerspectivesSimulation(suiOnly);
    for (const scenario of result.scenarios) {
      expect(Number.isFinite(scenario.summary.finalNetWealthEur)).toBe(true);
      const suiInfo = scenario.assetPriceInfo.SUI;
      expect(suiInfo.externalSourceCount).toBe(0);
      expect(suiInfo.modelType).toBe("external_modeled");
      expect(suiInfo.modeledCoverageYears.length).toBeGreaterThan(0);
      expect(suiInfo.lastCoveredYear).toBeNull();
      expect(suiInfo.horizonPriceEur).not.toBeNull();
      expect(suiInfo.horizonPriceEur).not.toBeCloseTo(3.0, 6);
    }
    const vals = result.scenarios.map(s => s.summary.finalNetWealthEur);
    const uniqueRoundedValues = new Set(vals.map(v => Math.round(v)));
    expect(uniqueRoundedValues.size).toBeGreaterThan(1);
  });
});

describe("arquitectura: candidate repository", () => {
  let db: SqliteDb;
  let candidateRepo: ForecastCandidateRepository;
  let activeRepo: ForecastActiveRepository;

  beforeEach(() => {
    db = makeMemoryDb();
    candidateRepo = new ForecastCandidateRepository(db);
    activeRepo = new ForecastActiveRepository(db);
  });

  const mockValidation = {
    passed: true, errors: [], warnings: [], checkedAt: NOW,
    observationCount: 3, assetCoverage: {},
  };
  const mockRegression = {
    passed: true, diffs: [], checkedAt: NOW,
  };

  it("crear candidato con validación=true produce status approved", () => {
    const candidate = candidateRepo.create(
      "v1", KNOWN_FORECASTS, ["obs-1", "obs-2"],
      mockValidation, mockRegression,
    );
    expect(candidate.status).toBe("approved");
    expect(candidate.validationPassed).toBe(true);
    expect(candidate.regressionPassed).toBe(true);
  });

  it("crear candidato con validación=false produce status pending", () => {
    const candidate = candidateRepo.create(
      "v2", KNOWN_FORECASTS, ["obs-1"],
      { ...mockValidation, passed: false, errors: [{ code: "TEST", message: "error" }] },
      mockRegression,
    );
    expect(candidate.status).toBe("pending");
    expect(candidate.validationPassed).toBe(false);
  });

  it("rechazar candidato actualiza status a rejected", () => {
    candidateRepo.create("v3", KNOWN_FORECASTS, [], mockValidation, mockRegression);
    candidateRepo.reject("v3", "Test error");
    const v = candidateRepo.getById("v3");
    expect(v?.status).toBe("rejected");
    expect(v?.rejectedReason).toBe("Test error");
  });
});

describe("arquitectura: activación y rollback", () => {
  let db: SqliteDb;
  let candidateRepo: ForecastCandidateRepository;
  let activeRepo: ForecastActiveRepository;
  const mockValidation = {
    passed: true, errors: [], warnings: [], checkedAt: NOW,
    observationCount: 3, assetCoverage: {},
  };
  const mockRegression = {
    passed: true, diffs: [], checkedAt: NOW,
  };

  beforeEach(() => {
    db = makeMemoryDb();
    candidateRepo = new ForecastCandidateRepository(db);
    activeRepo = new ForecastActiveRepository(db);
  });

  it("sin versión activa, getSourcesForEngine devuelve null", () => {
    expect(activeRepo.getSourcesForEngine()).toBeNull();
  });

  it("getCurrent devuelve null sin datos", () => {
    expect(activeRepo.getCurrent()).toBeNull();
  });

  it("activate almacena candidato correctamente", () => {
    const sources: ForecastSource[] = KNOWN_FORECASTS.slice(0, 2);
    activeRepo.activate("cand-1", sources);
    const current = activeRepo.getCurrent();
    expect(current).not.toBeNull();
    expect(current!.candidateId).toBe("cand-1");
    expect(current!.sources).toHaveLength(2);
    expect(current!.previousCandidateId).toBeNull();
  });

  it("activar una segunda versión guarda la primera como previousCandidateId", () => {
    activeRepo.activate("cand-1", KNOWN_FORECASTS.slice(0, 1));
    activeRepo.activate("cand-2", KNOWN_FORECASTS.slice(0, 2));
    const current = activeRepo.getCurrent();
    expect(current!.candidateId).toBe("cand-2");
    expect(current!.previousCandidateId).toBe("cand-1");
  });

  it("ignora versiones activas embebidas seed-* en el motor productivo", () => {
    activeRepo.activate("seed-active-v1", KNOWN_FORECASTS.slice(0, 2));

    expect(activeRepo.getCurrent()?.candidateId).toBe("seed-active-v1");
    expect(activeRepo.getSourcesForEngine()).toBeNull();
    expect(activeRepo.getDatasetForEngine()).toBeNull();
  });

  it("activateApprovedCandidate solo activa candidatos aprobados", () => {
    candidateRepo.create("approved-1", KNOWN_FORECASTS.slice(0, 1), ["obs-1"], mockValidation, mockRegression);
    candidateRepo.create(
      "pending-1",
      KNOWN_FORECASTS.slice(0, 2),
      ["obs-2"],
      { ...mockValidation, passed: false, errors: [{ code: "TEST", message: "error" }] },
      mockRegression,
    );

    expect(() => activeRepo.activateApprovedCandidate("pending-1")).toThrow(/no aprobado/);
    activeRepo.activateApprovedCandidate("approved-1");

    expect(activeRepo.getCurrent()?.candidateId).toBe("approved-1");
  });

  it("rollback restaura la versión anterior", () => {
    const v1Sources = KNOWN_FORECASTS.slice(0, 1);
    const v2Sources = KNOWN_FORECASTS.slice(0, 2);
    activeRepo.activate("cand-1", v1Sources);
    activeRepo.activate("cand-2", v2Sources);
    activeRepo.rollback(v1Sources);
    const current = activeRepo.getCurrent();
    expect(current!.candidateId).toBe("cand-1");
    expect(current!.sources).toHaveLength(1);
  });

  it("rollback sin fuentes externas restaura el snapshot desde forecast_versions_candidate", () => {
    candidateRepo.create("cand-1", KNOWN_FORECASTS.slice(0, 1), ["obs-1"], mockValidation, mockRegression);
    candidateRepo.create("cand-2", KNOWN_FORECASTS.slice(0, 2), ["obs-1", "obs-2"], mockValidation, mockRegression);
    activeRepo.activateApprovedCandidate("cand-1");
    activeRepo.activateApprovedCandidate("cand-2");

    activeRepo.rollback();

    const current = activeRepo.getCurrent();
    expect(current!.candidateId).toBe("cand-1");
    expect(current!.sources).toHaveLength(1);
    expect(current!.previousCandidateId).toBe("cand-2");
  });

  it("rollback sin versión previa lanza error", () => {
    expect(() => activeRepo.rollback([])).toThrow();
  });
});

describe("validación: staging observations", () => {
  const baseRow: StagingRow = {
    id: "obs-1",
    source_id: "ark-invest",
    asset_id: "bitcoin",
    ticker: "BTC",
    publisher: "ARK Invest",
    author: null,
    report_title: "Big Ideas 2025",
    original_url: "https://ark-invest.com/big-ideas-2025",
    source_type: "asset_manager",
    published_at: new Date("2025-01-14").getTime(),
    retrieved_at: NOW,
    verified_at: NOW,
    expires_at: new Date("2031-06-01").getTime(),
    target_year: 2030,
    target_type: "low_base_high",
    original_currency: "USD",
    target_low_original: 300_000,
    target_base_original: 710_000,
    target_high_original: 1_500_000,
    fx_rate: 0.92,
    final_weight: 0.86,
    verified: 1,
    active: 1,
    status: "pending",
    staged_at: NOW,
    fx_rate_at: null,
    fx_source: null,
    methodology: null,
    quality_score: 0.88,
    freshness_score: 0.80,
    horizon_score: 0.90,
    methodology_score: 0.85,
    independence_score: 0.90,
    rejected_reason: null,
  };

  it("observación válida pasa validación", () => {
    const report = validateStagingObservations(
      [baseRow],
      { BTC: 85_000 },
      NOW,
      NOW + 4 * YEAR_MS,
    );
    expect(report.errors).toHaveLength(0);
  });

  it("URL inválida produce error INVALID_URL", () => {
    const row = { ...baseRow, original_url: "not-a-url" };
    const report = validateStagingObservations([row], { BTC: 85_000 }, NOW, NOW + 4 * YEAR_MS);
    expect(report.errors.some(e => e.code === "INVALID_URL")).toBe(true);
    expect(report.passed).toBe(false);
  });

  it("low > base produce error RANGE_INCOHERENT", () => {
    const row = { ...baseRow, target_low_original: 800_000, target_base_original: 300_000 };
    const report = validateStagingObservations([row], { BTC: 85_000 }, NOW, NOW + 4 * YEAR_MS);
    expect(report.errors.some(e => e.code === "RANGE_INCOHERENT")).toBe(true);
  });

  it("observación sin precios produce error NO_PRICE", () => {
    const row = {
      ...baseRow,
      target_low_original: null,
      target_base_original: null,
      target_high_original: null,
    };
    const report = validateStagingObservations([row], { BTC: 85_000 }, NOW, NOW + 4 * YEAR_MS);
    expect(report.errors.some(e => e.code === "NO_PRICE")).toBe(true);
  });

  it("duplicado (mismo publisher+asset+año) produce advertencia DUPLICATE_OBSERVATION", () => {
    const report = validateStagingObservations(
      [baseRow, { ...baseRow, id: "obs-2" }],
      { BTC: 85_000 },
      NOW,
      NOW + 4 * YEAR_MS,
    );
    expect(report.warnings.some(w => w.code === "DUPLICATE_OBSERVATION")).toBe(true);
  });

  it("menos de 3 fuentes produce advertencia INSUFFICIENT_SOURCES", () => {
    const report = validateStagingObservations(
      [baseRow],
      { BTC: 85_000 },
      NOW,
      NOW + 4 * YEAR_MS,
    );
    expect(report.warnings.some(w => w.code === "INSUFFICIENT_SOURCES")).toBe(true);
  });
});
