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
  records: AutomationRunRecord[];
}

function defaultRunId(proposal: AutomatedOperationProposal): string {
  return `auto:${proposal.idempotencyKey}`;
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
      records: [],
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
        result.records.push(record);

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
        const preview = await this.deps.preview(proposal);
        if (preview.expiresAt <= (this.deps.now ?? Date.now)()) {
          throw Object.assign(new Error("El preview automático ha caducado antes del envío"), { code: "PREVIEW_EXPIRED" });
        }
        record = await this.deps.repository.updateRun({
          id: record.id,
          state: "READY_TO_SUBMIT",
          previewToken: preview.previewToken,
          previewId: preview.previewId,
        });
        result.previewed += 1;

        const submitted = await this.deps.submit(preview, proposal);
        record = await this.deps.repository.updateRun({
          id: record.id,
          state: submitted.completed ? "COMPLETED" : "SUBMITTED",
          orderIds: submitted.orderIds,
          completed: submitted.completed,
        });
        result.submitted += 1;
        if (submitted.completed) result.completed += 1;
      } catch (error) {
        result.failed += 1;
        const code = typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : "AUTOMATION_FAILED";
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`[AutomatedOperationRunner] ${policy.id}: ${code} ${message}`);
        if (record) {
          const failed = await this.deps.repository.updateRun({
            id: record.id,
            state: "FAILED",
            errorCode: code,
            errorMessage: message,
          });
          const index = result.records.findIndex((item) => item.id === failed.id);
          if (index >= 0) result.records[index] = failed;
        }
      }
    }

    return result;
  }
}
