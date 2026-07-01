import type {
  AutomatedOperationPolicy,
  AutomatedOperationProposal,
  AutomatedOperationState,
} from "@crypto-control/portfolio";
import { getSqlite } from "./db";

export interface StoredAutomatedPolicy {
  id: string;
  label: string;
  enabled: boolean;
  policy: AutomatedOperationPolicy;
  createdAt: number;
  updatedAt: number;
}

export interface AutomatedOperationRun {
  id: string;
  policyId: string;
  idempotencyKey: string;
  state: AutomatedOperationState;
  proposal: AutomatedOperationProposal;
  previewToken: string | null;
  previewId: string | null;
  orderIds: string[];
  notionalEur: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

interface PolicyRow {
  id: string;
  label: string;
  enabled: number;
  policy_json: string;
  created_at: number;
  updated_at: number;
}

interface RunRow {
  id: string;
  policy_id: string;
  idempotency_key: string;
  state: AutomatedOperationState;
  proposal_json: string;
  preview_token: string | null;
  preview_id: string | null;
  order_ids_json: string;
  notional_eur: number;
  error_code: string | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapPolicy(row: PolicyRow): StoredAutomatedPolicy {
  return {
    id: row.id,
    label: row.label,
    enabled: row.enabled === 1,
    policy: parseJson<AutomatedOperationPolicy>(row.policy_json, {} as AutomatedOperationPolicy),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRun(row: RunRow): AutomatedOperationRun {
  return {
    id: row.id,
    policyId: row.policy_id,
    idempotencyKey: row.idempotency_key,
    state: row.state,
    proposal: parseJson<AutomatedOperationProposal>(row.proposal_json, {} as AutomatedOperationProposal),
    previewToken: row.preview_token,
    previewId: row.preview_id,
    orderIds: parseJson<string[]>(row.order_ids_json, []),
    notionalEur: row.notional_eur,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export class DatabaseAutomatedOperationRepository {
  constructor() {
    this.ensureTables();
  }

  private db() {
    const sqlite = getSqlite();
    if (!sqlite) throw new Error("Database not initialized");
    return sqlite;
  }

  private ensureTables(): void {
    const sqlite = getSqlite();
    if (!sqlite) return;
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS automated_operation_policies_v1 (
        id TEXT PRIMARY KEY NOT NULL,
        label TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        policy_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_automated_policy_enabled
        ON automated_operation_policies_v1 (enabled, updated_at);

      CREATE TABLE IF NOT EXISTS automated_operation_runs_v1 (
        id TEXT PRIMARY KEY NOT NULL,
        policy_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        state TEXT NOT NULL,
        proposal_json TEXT NOT NULL,
        preview_token TEXT,
        preview_id TEXT,
        order_ids_json TEXT NOT NULL DEFAULT '[]',
        notional_eur REAL NOT NULL DEFAULT 0,
        error_code TEXT,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        FOREIGN KEY (policy_id) REFERENCES automated_operation_policies_v1(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_automated_runs_policy
        ON automated_operation_runs_v1 (policy_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_automated_runs_state
        ON automated_operation_runs_v1 (state, updated_at);
    `);
  }

  upsertPolicy(label: string, policy: AutomatedOperationPolicy): StoredAutomatedPolicy {
    this.ensureTables();
    const now = Date.now();
    this.db().prepare(`
      INSERT INTO automated_operation_policies_v1
        (id, label, enabled, policy_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        label = excluded.label,
        enabled = excluded.enabled,
        policy_json = excluded.policy_json,
        updated_at = excluded.updated_at
    `).run(policy.id, label, policy.enabled ? 1 : 0, JSON.stringify(policy), now, now);
    return this.getPolicy(policy.id)!;
  }

  getPolicy(id: string): StoredAutomatedPolicy | null {
    this.ensureTables();
    const row = this.db().prepare(`
      SELECT * FROM automated_operation_policies_v1 WHERE id = ?
    `).get(id) as PolicyRow | undefined;
    return row ? mapPolicy(row) : null;
  }

  listPolicies(enabledOnly = false): StoredAutomatedPolicy[] {
    this.ensureTables();
    const sql = enabledOnly
      ? "SELECT * FROM automated_operation_policies_v1 WHERE enabled = 1 ORDER BY updated_at DESC"
      : "SELECT * FROM automated_operation_policies_v1 ORDER BY updated_at DESC";
    return (this.db().prepare(sql).all() as PolicyRow[]).map(mapPolicy);
  }

  setPolicyEnabled(id: string, enabled: boolean): void {
    this.ensureTables();
    this.db().prepare(`
      UPDATE automated_operation_policies_v1
      SET enabled = ?, updated_at = ?
      WHERE id = ?
    `).run(enabled ? 1 : 0, Date.now(), id);
  }

  claimProposal(runId: string, proposal: AutomatedOperationProposal): AutomatedOperationRun {
    this.ensureTables();
    const now = Date.now();
    this.db().prepare(`
      INSERT OR IGNORE INTO automated_operation_runs_v1
        (id, policy_id, idempotency_key, state, proposal_json, notional_eur, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      runId,
      proposal.policyId,
      proposal.idempotencyKey,
      proposal.state,
      JSON.stringify(proposal),
      proposal.amountEur,
      now,
      now,
    );
    const row = this.db().prepare(`
      SELECT * FROM automated_operation_runs_v1 WHERE idempotency_key = ?
    `).get(proposal.idempotencyKey) as RunRow;
    return mapRun(row);
  }

  updateRun(input: {
    id: string;
    state: AutomatedOperationState;
    previewToken?: string | null;
    previewId?: string | null;
    orderIds?: string[];
    errorCode?: string | null;
    errorMessage?: string | null;
    completed?: boolean;
  }): AutomatedOperationRun {
    this.ensureTables();
    const current = this.getRun(input.id);
    if (!current) throw new Error(`Automated operation run ${input.id} not found`);
    const now = Date.now();
    this.db().prepare(`
      UPDATE automated_operation_runs_v1 SET
        state = ?,
        preview_token = ?,
        preview_id = ?,
        order_ids_json = ?,
        error_code = ?,
        error_message = ?,
        updated_at = ?,
        completed_at = ?
      WHERE id = ?
    `).run(
      input.state,
      input.previewToken !== undefined ? input.previewToken : current.previewToken,
      input.previewId !== undefined ? input.previewId : current.previewId,
      JSON.stringify(input.orderIds ?? current.orderIds),
      input.errorCode !== undefined ? input.errorCode : current.errorCode,
      input.errorMessage !== undefined ? input.errorMessage : current.errorMessage,
      now,
      input.completed ? now : current.completedAt,
      input.id,
    );
    return this.getRun(input.id)!;
  }

  getRun(id: string): AutomatedOperationRun | null {
    this.ensureTables();
    const row = this.db().prepare(`
      SELECT * FROM automated_operation_runs_v1 WHERE id = ?
    `).get(id) as RunRow | undefined;
    return row ? mapRun(row) : null;
  }

  listRuns(policyId?: string, limit = 100): AutomatedOperationRun[] {
    this.ensureTables();
    const rows = policyId
      ? this.db().prepare(`SELECT * FROM automated_operation_runs_v1 WHERE policy_id = ? ORDER BY created_at DESC LIMIT ?`).all(policyId, limit)
      : this.db().prepare(`SELECT * FROM automated_operation_runs_v1 ORDER BY created_at DESC LIMIT ?`).all(limit);
    return (rows as RunRow[]).map(mapRun);
  }

  dailyExecutionStats(policyId: string, dayStartUtc: number, dayEndUtc: number): { executions: number; notionalEur: number } {
    this.ensureTables();
    const row = this.db().prepare(`
      SELECT COUNT(*) AS executions, COALESCE(SUM(notional_eur), 0) AS notional
      FROM automated_operation_runs_v1
      WHERE policy_id = ?
        AND created_at >= ?
        AND created_at < ?
        AND state IN ('SUBMITTED', 'COMPLETED')
    `).get(policyId, dayStartUtc, dayEndUtc) as { executions: number; notional: number };
    return { executions: row.executions, notionalEur: row.notional };
  }
}
