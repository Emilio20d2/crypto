import {
  evaluateAutomatedOperation,
  isProposalExecutable,
  type AutomatedOperationPolicy,
  type AutomatedOperationProposal,
  type AutomatedOperationState,
  type AutomationMarketContext,
} from "./automated-operations";

export interface AutomationPreviewResult {
  previewToken: string;
  previewId: string | null;
  expiresAt: number;
  notionalEur: number;
}

export interface AutomationSubmitResult {
  orderIds: string[];
  completed: boolean;
}

export interface AutomationRunRecord {
  id: string;
  policyId: string;
  idempotencyKey: string;
  state: AutomatedOperationState;
  proposal: AutomatedOperationProposal;
  previewToken: string | null;
  previewId: string | null;
  orderIds: string[];
}

export interface AutomatedOperationRunRepository {
  listEnabledPolicies(): Promise<AutomatedOperationPolicy[]> | AutomatedOperationPolicy[];
  claimProposal(runId: string, proposal: AutomatedOperationProposal): Promise<AutomationRunRecord> | AutomationRunRecord;
  updateRun(input: {
    id: string;
    state: AutomatedOperationState;
    previewToken?: string | null;
    previewId?: string | null;
    orderIds?: string[];
    errorCode?: string | null;
    errorMessage?: string | null;
    completed?: boolean;
  }): Promise<AutomationRunRecord> | AutomationRunRecord;
  markPolicyExecuted?(policyId: string, executedAt: number): Promise<void> | void;
}

export interface AutomatedOperationRunnerDependencies {
  repository: AutomatedOperationRunRepository;
  buildContext(policy: AutomatedOperationPolicy): Promise<AutomationMarketContext>;
  preview(proposal: AutomatedOperationProposal): Promise<AutomationPreviewResult>;
  submit(preview: AutomationPreviewResult, proposal: AutomatedOperationProposal): Promise<AutomationSubmitResult>;
  now?(): number;
  createRunId?(proposal: AutomatedOperationProposal): string;
  logger?: Pick<Console, "log" | "warn" | "error">;
}

export interface AutomationCycleResult {
  evaluated: number;
  monitoring: number;
  blocked: number;
  reviewRequired: number;
  previewed: number;
  submitted: number;
  completed: number;
  failed: number;
  deduplicated: number;
  bookkeepingWarnings: number;
  records: AutomationRunRecord[];
}

const NON_RETRYABLE_STATES = new Set<AutomatedOperationState>([
  "PREVIEWING",
  "READY_TO_SUBMIT",
  "SUBMITTED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
]);

function defaultRunId(proposal: AutomatedOperationProposal): string {
  return `auto:${proposal.idempotencyKey}`;
}

function validatePreview(preview: AutomationPreviewResult, proposal: AutomatedOperationProposal, now: number): void {
  if (!preview.previewToken.trim()) {
    throw Object.assign(new Error("Coinbase no devolvió un token de preview válido"), { code: "PREVIEW_TOKEN_MISSING" });
  }
  if (!Number.isFinite(preview.notionalEur) || preview.notionalEur <= 0) {
    throw Object.assign(new Error("El preview devolvió un importe no válido"), { code: "PREVIEW_NOTIONAL_INVALID" });
  }
  const toleranceEur = Math.max(1, proposal.amountEur * 0.01);
  if (preview.notionalEur > proposal.amountEur + toleranceEur) {
    throw Object.assign(new Error("El preview supera el límite autorizado para la operación"), { code: "PREVIEW_LIMIT_EXCEEDED" });
  }
  if (preview.expiresAt <= now + 5_000) {
    throw Object.assign(new Error("El preview automático ha caducado o no deja margen seguro para el envío"), { code: "PREVIEW_EXPIRED" });
  }
}

export class AutomatedOperationRunner {
  private running: Promise<AutomationCycleResult> | null = null;
  private readonly logger: Pick<Console, "log" | "warn" | "error">;

  constructor(private readonly deps: AutomatedOperationRunnerDependencies) {
    this.logger = deps.logger ?? console;
  }

  runOnce(): Promise<AutomationCycleResult> {
    if (this.running) return this.running;
    this.running = this.executeCycle().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async executeCycle(): Promise<AutomationCycleResult> {
    const result: AutomationCycleResult = {
      evaluated: 0,
      monitoring: 0,
      blocked: 0,
      reviewRequired: 0,
      previewed: 0,
      submitted: 0,
      completed: 0,
      failed: 0,
      deduplicated: 0,
      bookkeepingWarnings: 0,
      records: [],
    };

    const replaceRecord = (next: AutomationRunRecord): void => {
      const index = result.records.findIndex((item) => item.id === next.id);
      if (index >= 0) result.records[index] = next;
      else result.records.push(next);
    };

    const policies = await this.deps.repository.listEnabledPolicies();
    for (const policy of policies) {
      result.evaluated += 1;
      let record: AutomationRunRecord | null = null;
      try {
        const context = await this.deps.buildContext(policy);
        const proposal = evaluateAutomatedOperation(policy, context);
        const runId = (this.deps.createRunId ?? defaultRunId)(proposal);
        record = await this.deps.repository.claimProposal(runId, proposal);
        replaceRecord(record);

        if (NON_RETRYABLE_STATES.has(record.state)) {
          result.deduplicated += 1;
          continue;
        }
        if (proposal.state === "BLOCKED_DATA" || proposal.state === "BLOCKED_RISK") {
          result.blocked += 1;
          continue;
        }
        if (proposal.state === "MONITORING") {
          result.monitoring += 1;
          continue;
        }
        if (proposal.state === "REVIEW_REQUIRED") {
          result.reviewRequired += 1;
          continue;
        }
        if (!isProposalExecutable(proposal)) {
          result.blocked += 1;
          continue;
        }

        record = await this.deps.repository.updateRun({ id: record.id, state: "PREVIEWING" });
        replaceRecord(record);

        const preview = await this.deps.preview(proposal);
        const now = (this.deps.now ?? Date.now)();
        validatePreview(preview, proposal, now);

        record = await this.deps.repository.updateRun({
          id: record.id,
          state: "READY_TO_SUBMIT",
          previewToken: preview.previewToken,
          previewId: preview.previewId,
        });
        replaceRecord(record);
        result.previewed += 1;

        const submitted = await this.deps.submit(preview, proposal);
        if (submitted.orderIds.length === 0) {
          throw Object.assign(new Error("Coinbase no devolvió ningún identificador de orden"), { code: "ORDER_ID_MISSING" });
        }

        record = await this.deps.repository.updateRun({
          id: record.id,
          state: submitted.completed ? "COMPLETED" : "SUBMITTED",
          orderIds: submitted.orderIds,
          completed: submitted.completed,
        });
        replaceRecord(record);
        result.submitted += 1;
        if (submitted.completed) result.completed += 1;

        try {
          await this.deps.repository.markPolicyExecuted?.(policy.id, now);
        } catch (bookkeepingError) {
          result.bookkeepingWarnings += 1;
          const message = bookkeepingError instanceof Error ? bookkeepingError.message : String(bookkeepingError);
          this.logger.error(`[AutomatedOperationRunner] ${policy.id}: POLICY_BOOKKEEPING_FAILED ${message}`);
        }
      } catch (error) {
        result.failed += 1;
        const code = typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : "AUTOMATION_FAILED";
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`[AutomatedOperationRunner] ${policy.id}: ${code} ${message}`);
        if (record && record.state !== "SUBMITTED" && record.state !== "COMPLETED") {
          try {
            const failed = await this.deps.repository.updateRun({
              id: record.id,
              state: "FAILED",
              errorCode: code,
              errorMessage: message,
            });
            replaceRecord(failed);
          } catch (persistenceError) {
            const persistenceMessage = persistenceError instanceof Error ? persistenceError.message : String(persistenceError);
            this.logger.error(`[AutomatedOperationRunner] ${policy.id}: FAILURE_STATE_PERSISTENCE_FAILED ${persistenceMessage}`);
          }
        }
      }
    }

    return result;
  }
}
