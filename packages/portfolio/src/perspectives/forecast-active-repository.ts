// ─── Repositorio de la versión activa (capa 3) ───────────────────────────────
// Una sola fila con la versión actualmente usada por el motor.
// El motor solo lee de aquí cuando PERSPECTIVES_EXTERNAL_FORECASTS_ENABLED = true.
// Toda activación es atómica y guarda el candidato anterior para rollback.

import type { ForecastSource } from "./forecast-sources";
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
  // Devuelve null si el flag está deshabilitado o no hay versión activa.
  getSourcesForEngine(): ForecastSource[] | null {
    if (!PERSPECTIVES_EXTERNAL_FORECASTS_ENABLED) {
      console.log("[PerspectivesSimulation] PERSPECTIVES_EXTERNAL_FORECASTS_ENABLED=false — usando KNOWN_FORECASTS");
      return null;
    }
    const active = this.getCurrent();
    if (!active) {
      console.log("[PerspectivesSimulation] Sin versión activa — usando KNOWN_FORECASTS");
      return null;
    }
    console.log(`[PerspectivesSimulation] Usando versión activa candidate_id=${active.candidateId} activada=${new Date(active.activatedAt).toISOString()}`);
    return active.sources;
  }
}
