// ─── Repositorio de la versión activa (capa 3) ───────────────────────────────
// Una sola fila con la versión actualmente usada por el motor.
// El motor solo lee de aquí cuando PERSPECTIVES_EXTERNAL_FORECASTS_ENABLED = true.
// Toda activación es atómica y guarda el candidato anterior para rollback.

import type { ForecastSource } from "./forecast-sources";
import type { ForecastDataset } from "./types";
import type { SqliteDb } from "./forecast-candidate-repository";

export interface ActiveVersion {
  candidateId: string;
  activatedAt: number;
  sources: ForecastSource[];
  previousCandidateId: string | null;
}

export interface ActiveRow {
  id: string;
  candidate_id: string;
  activated_at: number;
  snapshot_json: string;
  previous_candidate_id: string | null;
}

// Feature flag — permanece false hasta que la arquitectura completa esté validada.
// Cambiar a true requiere: validación, regresión, aprobación manual y tests verdes.
export const PERSPECTIVES_EXTERNAL_FORECASTS_ENABLED = false;

export class ForecastActiveRepository {
  constructor(private readonly sqlite: SqliteDb) {}

  getCurrent(): ActiveVersion | null {
    const row = this.sqlite.prepare(
      `SELECT * FROM forecast_versions_active WHERE id = 'current'`
    ).get() as ActiveRow | undefined;
    if (!row) return null;
    return {
      candidateId: row.candidate_id,
      activatedAt: row.activated_at,
      sources: JSON.parse(row.snapshot_json) as ForecastSource[],
      previousCandidateId: row.previous_candidate_id,
    };
  }

  // Activa un candidato aprobado de forma atómica.
  // Guarda el candidato previo para rollback.
  activate(candidateId: string, sources: ForecastSource[]): void {
    const current = this.getCurrent();
    this.sqlite.prepare(`
      INSERT INTO forecast_versions_active (id, candidate_id, activated_at, snapshot_json, previous_candidate_id)
      VALUES ('current', ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        candidate_id = excluded.candidate_id,
        activated_at = excluded.activated_at,
        snapshot_json = excluded.snapshot_json,
        previous_candidate_id = excluded.previous_candidate_id
    `).run(
      candidateId,
      Date.now(),
      JSON.stringify(sources),
      current?.candidateId ?? null,
    );
    console.log(`[ForecastActivation] Versión activada: candidate_id=${candidateId} previous=${current?.candidateId ?? 'ninguna'}`);
  }

  // Rollback a la versión anterior (intercambia candidate_id y previous_candidate_id).
  rollback(previousSources: ForecastSource[]): void {
    const current = this.getCurrent();
    if (!current?.previousCandidateId) {
      throw new Error("[ForecastActivation] No hay versión anterior para rollback");
    }
    this.sqlite.prepare(`
      UPDATE forecast_versions_active
      SET candidate_id = previous_candidate_id,
          activated_at = ?,
          snapshot_json = ?,
          previous_candidate_id = candidate_id
      WHERE id = 'current'
    `).run(Date.now(), JSON.stringify(previousSources));
    console.log(`[ForecastActivation] Rollback a candidate_id=${current.previousCandidateId}`);
  }

  // Lee las fuentes activas para el motor de simulación.
  // Si el flag está deshabilitado pero existe versión activa, se usa esa
  // versión validada. Si no hay versión activa, no hay fallback silencioso.
  getSourcesForEngine(): ForecastSource[] | null {
    const active = this.getCurrent();
    if (!active) {
      console.log("[PerspectivesSimulation] Sin version activa de previsiones");
      return null;
    }
    const flagState = PERSPECTIVES_EXTERNAL_FORECASTS_ENABLED ? "enabled" : "disabled-active-fallback";
    console.log(`[PerspectivesSimulation] Usando version activa candidate_id=${active.candidateId} flag=${flagState} activada=${new Date(active.activatedAt).toISOString()}`);
    return active.sources;
  }

  getDatasetForEngine(): ForecastDataset | null {
    const active = this.getCurrent();
    if (!active) return null;
    const fxRates = active.sources
      .map(s => s.fxRate)
      .filter((rate): rate is number => typeof rate === "number" && Number.isFinite(rate) && rate > 0);
    const fxRateAts = active.sources
      .map(s => s.fxRateAt)
      .filter((ts): ts is number => typeof ts === "number" && Number.isFinite(ts) && ts > 0);
    const fxSources = active.sources
      .map(s => s.fxSource)
      .filter((source): source is string => typeof source === "string" && source.length > 0);
    return {
      sources: active.sources,
      candidateId: active.candidateId,
      activatedAt: active.activatedAt,
      usdToEurRate: fxRates.length > 0 ? fxRates[0] : null,
      fxSource: fxSources[0] ?? null,
      fxRateAt: fxRateAts[0] ?? null,
    };
  }
}
