// ─── Repositorio de versiones candidato (capa 2) ─────────────────────────────
// Una "versión candidato" es un snapshot inmutable de ForecastSource[]
// que ha superado la validación completa y espera aprobación para activarse.

import type { ForecastSource } from "./forecast-sources";
import type { ValidationReport, RegressionReport } from "./forecast-validation";

export interface CandidateVersion {
  id: string;
  createdAt: number;
  sources: ForecastSource[];
  observationIds: string[];
  validationPassed: boolean;
  validationReport: ValidationReport | null;
  regressionPassed: boolean;
  regressionReport: RegressionReport | null;
  status: "pending" | "approved" | "rejected";
  approvedAt: number | null;
  rejectedAt: number | null;
  rejectedReason: string | null;
}

export interface CandidateRow {
  id: string;
  created_at: number;
  snapshot_json: string;
  observation_ids_json: string;
  validation_passed: number;
  validation_report_json: string | null;
  regression_passed: number;
  regression_report_json: string | null;
  status: string;
  approved_at: number | null;
  rejected_at: number | null;
  rejected_reason: string | null;
}

function rowToVersion(row: CandidateRow): CandidateVersion {
  return {
    id: row.id,
    createdAt: row.created_at,
    sources: JSON.parse(row.snapshot_json) as ForecastSource[],
    observationIds: JSON.parse(row.observation_ids_json) as string[],
    validationPassed: row.validation_passed === 1,
    validationReport: row.validation_report_json ? JSON.parse(row.validation_report_json) : null,
    regressionPassed: row.regression_passed === 1,
    regressionReport: row.regression_report_json ? JSON.parse(row.regression_report_json) : null,
    status: row.status as CandidateVersion["status"],
    approvedAt: row.approved_at,
    rejectedAt: row.rejected_at,
    rejectedReason: row.rejected_reason,
  };
}

export interface SqliteDb {
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
  };
}

export class ForecastCandidateRepository {
  constructor(private readonly sqlite: SqliteDb) {}

  create(
    id: string,
    sources: ForecastSource[],
    observationIds: string[],
    validationReport: ValidationReport,
    regressionReport: RegressionReport,
  ): CandidateVersion {
    const now = Date.now();
    const validationPassed = validationReport.passed ? 1 : 0;
    const regressionPassed = regressionReport.passed ? 1 : 0;
    const allPassed = validationPassed && regressionPassed;

    this.sqlite.prepare(`
      INSERT INTO forecast_versions_candidate
        (id, created_at, snapshot_json, observation_ids_json,
         validation_passed, validation_report_json,
         regression_passed, regression_report_json, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, now,
      JSON.stringify(sources),
      JSON.stringify(observationIds),
      validationPassed,
      JSON.stringify(validationReport),
      regressionPassed,
      JSON.stringify(regressionReport),
      allPassed ? "approved" : "pending",
    );

    return this.getById(id)!;
  }

  getById(id: string): CandidateVersion | null {
    const row = this.sqlite.prepare(
      `SELECT * FROM forecast_versions_candidate WHERE id = ?`
    ).get(id) as CandidateRow | undefined;
    return row ? rowToVersion(row) : null;
  }

  listPending(): CandidateVersion[] {
    const rows = this.sqlite.prepare(
      `SELECT * FROM forecast_versions_candidate WHERE status = 'pending' ORDER BY created_at DESC`
    ).all() as CandidateRow[];
    return rows.map(rowToVersion);
  }

  approve(id: string): void {
    this.sqlite.prepare(
      `UPDATE forecast_versions_candidate SET status = 'approved', approved_at = ? WHERE id = ?`
    ).run(Date.now(), id);
  }

  reject(id: string, reason: string): void {
    this.sqlite.prepare(
      `UPDATE forecast_versions_candidate SET status = 'rejected', rejected_at = ?, rejected_reason = ? WHERE id = ?`
    ).run(Date.now(), reason, id);
  }
}
