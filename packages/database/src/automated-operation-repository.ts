import type {
  AutomatedOperationKind,
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

const OPERATION_KINDS = new Set<AutomatedOperationKind>(["BULL_PARTIAL_SALE", "BEAR_REBUY"]);
const OPERATION_STATES = new Set<AutomatedOperationState>([
  "SCHEDULED",
  "MONITORING",
  "BLOCKED_DATA",
  "BLOCKED_RISK",
  "REVIEW_REQUIRED",
  "READY_TO_PREVIEW",
  "PREVIEWING",
  "READY_TO_SUBMIT",
  "SUBMITTED",
  "COMPLETED",
  "FAILED",
  "PAUSED",
  "CANCELLED",
  "EXPIRED",
]);
const CLAIMABLE_STATES = new Set<AutomatedOperationState>([
  "SCHEDULED",
  "MONITORING",
  "BLOCKED_DATA",
  "BLOCKED_RISK",
  "REVIEW_REQUIRED",
  "READY_TO_PREVIEW",
]);
const RETRYABLE_STATE_SQL = "'SCHEDULED','MONITORING','BLOCKED_DATA','BLOCKED_RISK','REVIEW_REQUIRED','READY_TO_PREVIEW'";

const ALLOWED_TRANSITIONS: Record<AutomatedOperationState, ReadonlySet<AutomatedOperationState>> = {
  SCHEDULED: new Set(["SCHEDULED", "MONITORING", "BLOCKED_DATA", "BLOCKED_RISK", "REVIEW_REQUIRED", "READY_TO_PREVIEW", "PAUSED", "CANCELLED", "EXPIRED"]),
  MONITORING: new Set(["MONITORING", "BLOCKED_DATA", "BLOCKED_RISK", "REVIEW_REQUIRED", "READY_TO_PREVIEW", "PAUSED", "CANCELLED", "EXPIRED"]),
  BLOCKED_DATA: new Set(["BLOCKED_DATA", "MONITORING", "BLOCKED_RISK", "REVIEW_REQUIRED", "READY_TO_PREVIEW", "PAUSED", "CANCELLED", "EXPIRED"]),
  BLOCKED_RISK: new Set(["BLOCKED_RISK", "MONITORING", "BLOCKED_DATA", "REVIEW_REQUIRED", "READY_TO_PREVIEW", "PAUSED", "CANCELLED", "EXPIRED"]),
  REVIEW_REQUIRED: new Set(["REVIEW_REQUIRED", "MONITORING", "BLOCKED_DATA", "BLOCKED_RISK", "READY_TO_PREVIEW", "PAUSED", "CANCELLED", "EXPIRED"]),
  READY_TO_PREVIEW: new Set(["READY_TO_PREVIEW", "PREVIEWING", "REVIEW_REQUIRED", "BLOCKED_DATA", "BLOCKED_RISK", "PAUSED", "CANCELLED", "EXPIRED"]),
  PREVIEWING: new Set(["PREVIEWING", "READY_TO_SUBMIT", "FAILED", "CANCELLED", "EXPIRED"]),
  READY_TO_SUBMIT: new Set(["READY_TO_SUBMIT", "SUBMITTED", "COMPLETED", "FAILED", "CANCELLED", "EXPIRED"]),
  SUBMITTED: new Set(["SUBMITTED", "COMPLETED", "FAILED"]),
  COMPLETED: new Set(["COMPLETED"]),
  FAILED: new Set(["FAILED"]),
  PAUSED: new Set(["PAUSED", "MONITORING", "CANCELLED", "EXPIRED"]),
  CANCELLED: new Set(["CANCELLED"]),
  EXPIRED: new Set(["EXPIRED"]),
};

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validatePolicy(policy: unknown, expectedId?: string): asserts policy is AutomatedOperationPolicy {
  if (!isObject(policy)) throw new Error("Corrupt automated operation policy: invalid JSON object");
  if (!nonEmptyString(policy.id) || (expectedId && policy.id !== expectedId)) throw new Error("Corrupt automated operation policy: invalid id");
  if (!OPERATION_KINDS.has(policy.kind as AutomatedOperationKind)) throw new Error("Corrupt automated operation policy: invalid kind");
  if (!nonEmptyString(policy.assetId)) throw new Error("Corrupt automated operation policy: invalid asset");
  if (typeof policy.enabled !== "boolean" || typeof policy.simulationOnly !== "boolean") throw new Error("Corrupt automated operation policy: invalid flags");
  if (!finiteNumber(policy.startsAt) || !finiteNumber(policy.createdAt)) throw new Error("Corrupt automated operation policy: invalid dates");
  if (policy.expiresAt !== null && !finiteNumber(policy.expiresAt)) throw new Error("Corrupt automated operation policy: invalid expiry");
  if (!finiteNumber(policy.executionCount) || policy.executionCount < 0 || !Number.isInteger(policy.executionCount)) throw new Error("Corrupt automated operation policy: invalid execution count");
  if (!isObject(policy.authorization)) throw new Error("Corrupt automated operation policy: authorization missing");
  if (typeof policy.authorization.enabled !== "boolean" || typeof policy.authorization.autoExecute !== "boolean") throw new Error("Corrupt automated operation policy: invalid authorization flags");
  if (!finiteNumber(policy.authorization.maxSingleOperationEur) || !finiteNumber(policy.authorization.maxDailyNotionalEur)) throw new Error("Corrupt automated operation policy: invalid authorization limits");
  if (!finiteNumber(policy.authorization.maxDailyOperations) || !Number.isInteger(policy.authorization.maxDailyOperations)) throw new Error("Corrupt automated operation policy: invalid daily operation limit");
  if (policy.kind === "BULL_PARTIAL_SALE" && !isObject(policy.bull)) throw new Error("Corrupt automated operation policy: bull configuration missing");
  if (policy.kind === "BEAR_REBUY" && !isObject(policy.bear)) throw new Error("Corrupt automated operation policy: bear configuration missing");
}

function validateProposal(proposal: unknown): asserts proposal is AutomatedOperationProposal {
  if (!isObject(proposal)) throw new Error("Corrupt automated operation proposal: invalid JSON object");
  if (!nonEmptyString(proposal.policyId) || !nonEmptyString(proposal.idempotencyKey) || !nonEmptyString(proposal.assetId)) throw new Error("Corrupt automated operation proposal: identity missing");
  if (!OPERATION_KINDS.has(proposal.kind as AutomatedOperationKind)) throw new Error("Corrupt automated operation proposal: invalid kind");
  if (!OPERATION_STATES.has(proposal.state as AutomatedOperationState)) throw new Error("Corrupt automated operation proposal: invalid state");
  if (!finiteNumber(proposal.amountEur) || proposal.amountEur < 0) throw new Error("Corrupt automated operation proposal: invalid amount");
  if (!Array.isArray(proposal.reasons) || !Array.isArray(proposal.blockers)) throw new Error("Corrupt automated operation proposal: audit data missing");
}

function mapPolicy(row: PolicyRow): StoredAutomatedPolicy {
  const enabled = row.enabled === 1;
  const parsed = parseJson(row.policy_json);
  validatePolicy(parsed, row.id);
  const policy: AutomatedOperationPolicy = { ...parsed, id: row.id, enabled };
  return {
    id: row.id,
    label: row.label,
    enabled,
    policy,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRun(row: RunRow): AutomatedOperationRun {
  if (!OPERATION_STATES.has(row.state)) throw new Error(`Corrupt automated operation run ${row.id}: invalid state`);
  const proposal = parseJson(row.proposal_json);
  validateProposal(proposal);
  const orderIdsRaw = parseJson(row.order_ids_json);
  const orderIds = Array.isArray(orderIdsRaw) && orderIdsRaw.every((value) => typeof value === "string") ? orderIdsRaw : [];
  return {
    id: row.id,
    policyId: row.policy_id,
    idempotencyKey: row.idempotency_key,
    state: row.state,
    proposal,
    previewToken: row.preview_token,
    previewId: row.preview_id,
    orderIds,
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
    validatePolicy(policy);
    if (!label.trim()) throw new Error("Automated operation policy label is required");
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
    `).run(policy.id, label.trim(), policy.enabled ? 1 : 0, JSON.stringify(policy), now, now);
    const stored = this.getPolicy(policy.id);
    if (!stored) throw new Error("Automated operation policy could not be persisted");
    return stored;
  }

  getPolicy(id: string): StoredAutomatedPolicy | null {
    this.ensureTables();
    const row = this.db().prepare(`SELECT * FROM automated_operation_policies_v1 WHERE id = ?`).get(id) as PolicyRow | undefined;
    return row ? mapPolicy(row) : null;
  }

  listPolicies(enabledOnly = false): StoredAutomatedPolicy[] {
    this.ensureTables();
    const query = enabledOnly
      ? "SELECT * FROM automated_operation_policies_v1 WHERE enabled = 1 ORDER BY updated_at DESC"
      : "SELECT * FROM automated_operation_policies_v1 ORDER BY updated_at DESC";
    const valid: StoredAutomatedPolicy[] = [];
    for (const row of this.db().prepare(query).all() as PolicyRow[]) {
      try {
        valid.push(mapPolicy(row));
      } catch (error) {
        console.error(`[AutomationRepository] Policy ${row.id} disabled because it is corrupt:`, error instanceof Error ? error.message : String(error));
        this.db().prepare("UPDATE automated_operation_policies_v1 SET enabled = 0, updated_at = ? WHERE id = ?").run(Date.now(), row.id);
      }
    }
    return valid;
  }

  listEnabledPolicies(): AutomatedOperationPolicy[] {
    return this.listPolicies(true).map((item) => item.policy);
  }

  setPolicyEnabled(id: string, enabled: boolean): void {
    this.ensureTables();
    const stored = this.getPolicy(id);
    if (!stored) throw new Error(`Automated operation policy ${id} not found or corrupt`);
    const policy = { ...stored.policy, enabled };
    validatePolicy(policy, id);
    this.db().prepare(`
      UPDATE automated_operation_policies_v1
      SET enabled = ?, policy_json = ?, updated_at = ?
      WHERE id = ?
    `).run(enabled ? 1 : 0, JSON.stringify(policy), Date.now(), id);
  }

  markPolicyExecuted(policyId: string, executedAt: number): void {
    this.ensureTables();
    if (!finiteNumber(executedAt) || executedAt <= 0) throw new Error("Invalid policy execution timestamp");
    const sqlite = this.db();
    const update = sqlite.transaction(() => {
      const row = sqlite.prepare("SELECT * FROM automated_operation_policies_v1 WHERE id = ?").get(policyId) as PolicyRow | undefined;
      if (!row) throw new Error(`Automated operation policy ${policyId} not found`);
      const stored = mapPolicy(row);
      const policy: AutomatedOperationPolicy = {
        ...stored.policy,
        executionCount: stored.policy.executionCount + 1,
        lastExecutedAt: executedAt,
      };
      validatePolicy(policy, policyId);
      sqlite.prepare(`
        UPDATE automated_operation_policies_v1
        SET policy_json = ?, updated_at = ?
        WHERE id = ?
      `).run(JSON.stringify(policy), executedAt, policyId);
    });
    update();
  }

  claimProposal(runId: string, proposal: AutomatedOperationProposal): AutomatedOperationRun {
    this.ensureTables();
    validateProposal(proposal);
    if (!CLAIMABLE_STATES.has(proposal.state)) throw new Error(`Proposal state ${proposal.state} cannot be claimed`);
    if (!nonEmptyString(runId)) throw new Error("Automated operation run id is required");
    const policy = this.getPolicy(proposal.policyId);
    if (!policy || !policy.enabled) throw new Error(`Automated operation policy ${proposal.policyId} is not active`);
    if (policy.policy.kind !== proposal.kind || policy.policy.assetId !== proposal.assetId) throw new Error("Proposal does not match its stored policy");

    const now = Date.now();
    this.db().prepare(`
      INSERT INTO automated_operation_runs_v1
        (id, policy_id, idempotency_key, state, proposal_json, notional_eur, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(idempotency_key) DO UPDATE SET
        state = CASE WHEN automated_operation_runs_v1.state IN (${RETRYABLE_STATE_SQL}) THEN excluded.state ELSE automated_operation_runs_v1.state END,
        proposal_json = CASE WHEN automated_operation_runs_v1.state IN (${RETRYABLE_STATE_SQL}) THEN excluded.proposal_json ELSE automated_operation_runs_v1.proposal_json END,
        notional_eur = CASE WHEN automated_operation_runs_v1.state IN (${RETRYABLE_STATE_SQL}) THEN excluded.notional_eur ELSE automated_operation_runs_v1.notional_eur END,
        updated_at = CASE WHEN automated_operation_runs_v1.state IN (${RETRYABLE_STATE_SQL}) THEN excluded.updated_at ELSE automated_operation_runs_v1.updated_at END
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
    const row = this.db().prepare("SELECT * FROM automated_operation_runs_v1 WHERE idempotency_key = ?").get(proposal.idempotencyKey) as RunRow | undefined;
    if (!row) throw new Error("Automated operation proposal could not be claimed");
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
    if (!OPERATION_STATES.has(input.state)) throw new Error(`Invalid automated operation state ${input.state}`);
    const current = this.getRun(input.id);
    if (!current) throw new Error(`Automated operation run ${input.id} not found or corrupt`);
    if (!ALLOWED_TRANSITIONS[current.state].has(input.state)) {
      throw new Error(`Invalid automated operation transition ${current.state} -> ${input.state}`);
    }
    if (input.orderIds && !input.orderIds.every((id) => nonEmptyString(id))) throw new Error("Order ids must be non-empty strings");
    if ((input.state === "SUBMITTED" || input.state === "COMPLETED") && (input.orderIds ?? current.orderIds).length === 0) {
      throw new Error(`State ${input.state} requires at least one Coinbase order id`);
    }

    const now = Date.now();
    const completedAt = input.state === "COMPLETED" || input.completed ? now : current.completedAt;
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
      completedAt,
      input.id,
    );
    const updated = this.getRun(input.id);
    if (!updated) throw new Error("Automated operation run could not be updated");
    return updated;
  }

  getRun(id: string): AutomatedOperationRun | null {
    this.ensureTables();
    const row = this.db().prepare("SELECT * FROM automated_operation_runs_v1 WHERE id = ?").get(id) as RunRow | undefined;
    return row ? mapRun(row) : null;
  }

  listRuns(policyId?: string, limit = 100): AutomatedOperationRun[] {
    this.ensureTables();
    const safeLimit = Math.max(1, Math.min(1_000, Math.floor(limit)));
    const rows = policyId
      ? this.db().prepare("SELECT * FROM automated_operation_runs_v1 WHERE policy_id = ? ORDER BY created_at DESC LIMIT ?").all(policyId, safeLimit)
      : this.db().prepare("SELECT * FROM automated_operation_runs_v1 ORDER BY created_at DESC LIMIT ?").all(safeLimit);
    return (rows as RunRow[]).map(mapRun);
  }

  dailyExecutionStats(policyId: string, dayStartUtc: number, dayEndUtc: number): { executions: number; notionalEur: number } {
    this.ensureTables();
    if (!finiteNumber(dayStartUtc) || !finiteNumber(dayEndUtc) || dayEndUtc <= dayStartUtc) throw new Error("Invalid daily execution window");
    const row = this.db().prepare(`
      SELECT COUNT(*) AS executions, COALESCE(SUM(notional_eur), 0) AS notional
      FROM automated_operation_runs_v1
      WHERE policy_id = ?
        AND COALESCE(completed_at, updated_at) >= ?
        AND COALESCE(completed_at, updated_at) < ?
        AND state IN ('SUBMITTED', 'COMPLETED')
    `).get(policyId, dayStartUtc, dayEndUtc) as { executions: number; notional: number };
    return { executions: row.executions, notionalEur: row.notional };
  }
}
