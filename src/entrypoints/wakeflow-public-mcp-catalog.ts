import {
  PREPARE_DELIVERY_TOOL_REGISTRATION,
  type PrepareDeliveryResult,
  REARM_DELIVERY_TOOL_REGISTRATION,
  RECORD_DELIVERY_OUTCOME_TOOL_REGISTRATION,
  type RearmDeliveryResult,
  type RecordDeliveryOutcomeResult,
} from "../capabilities/delivery/contract.js";
import {
  DEMAND_CANCELLATION_TOOL_REGISTRATION,
  DEMAND_COMPLETION_TOOL_REGISTRATION,
  DEMAND_CONTINUATION_TOOL_REGISTRATION,
  DEMAND_CREATION_TOOL_REGISTRATION,
  type DemandCancellationResult,
  type DemandCompletionResult,
  type DemandContinuationResult,
  type DemandCreationResult,
} from "../capabilities/demand/contract.js";
import type { WindowBindingResult } from "../capabilities/endpoint/contract.js";
import { WINDOW_BINDING_TOOL_REGISTRATION } from "../capabilities/endpoint/contract.js";
import {
  RECORD_EVIDENCE_TOOL_REGISTRATION,
  type RecordEvidenceResult,
} from "../capabilities/evidence/contract.js";
import {
  STATUS_TOOL_REGISTRATION,
  type StatusResult,
  VERIFY_TOOL_REGISTRATION,
  type VerifyResult,
} from "../capabilities/observation/contract.js";
import { POD_TOOL_REGISTRATION, type PodResult } from "../capabilities/pod/contract.js";
import {
  BOARD_INSPECTION_TOOL_REGISTRATION,
  type BoardInspectionResult,
  REQUIREMENT_PUBLICATION_TOOL_REGISTRATION,
  type RequirementPublicationResult,
} from "../capabilities/requirement/contract.js";
import {
  IMPLEMENTATION_REVIEW_DECISION_TOOL_REGISTRATION,
  type ImplementationReviewDecisionResult,
  TARGET_RESULT_IMPORT_TOOL_REGISTRATION,
  TARGET_RESULT_REVIEW_INSPECTION_TOOL_REGISTRATION,
  type TargetResultImportResult,
  type TargetResultReviewInspectionResult,
  TEST_REVIEW_DECISION_TOOL_REGISTRATION,
  type TestReviewDecisionResult,
} from "../capabilities/result-review/contract.js";
import {
  TARGET_TASK_PLANNING_TOOL_REGISTRATION,
  type TargetTaskPlanningResult,
} from "../capabilities/tasking/contract.js";
import {
  WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
  type WakeflowMaintenancePublicResult,
} from "../capabilities/workspace/maintain-workspace.js";
import { WAKEFLOW_MAINTENANCE_PUBLIC_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-maintenance-public-request.generated.js";
import { WAKEFLOW_MAINTENANCE_PUBLIC_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-maintenance-public-result.generated.js";
import {
  createWakeflowToolCatalog,
  type WakeflowToolCatalog,
  type WakeflowToolRegistration,
} from "../kernel/tool-registry.js";
import type { WakeflowPublicMcpExecutor } from "./wakeflow-public-mcp-tool.js";

/**
 * Wakeflow Entrypoint / MCP：公共工具登记表（数据）。
 *
 * 每个公共工具在这里登记一次：名字、切片、调用形状、executor 绑定名、标题、
 * 一到两句描述、请求与结果 Schema、注解。组合根按本表生成目录并绑定 executor；
 * 边界说明放在 server instructions 与技能里，不再逐个工具重复（ADR-0004）。
 * 已迁移的切片将来在自己的 contract 里登记，本表只做汇总。
 */

/** 组合根必须提供的完整 executor 集合；键即登记表里的绑定名。 */
export interface WakeflowPublicMcpExecutors {
  readonly cancelDemand: WakeflowPublicMcpExecutor<DemandCancellationResult>;
  readonly completeDemand: WakeflowPublicMcpExecutor<DemandCompletionResult>;
  readonly continueDemand: WakeflowPublicMcpExecutor<DemandContinuationResult>;
  readonly createDemand: WakeflowPublicMcpExecutor<DemandCreationResult>;
  readonly executeMaintenance: WakeflowPublicMcpExecutor<WakeflowMaintenancePublicResult>;
  readonly importTargetResult: WakeflowPublicMcpExecutor<TargetResultImportResult>;
  readonly inspectTargetResultReview: WakeflowPublicMcpExecutor<TargetResultReviewInspectionResult>;
  readonly managePod: WakeflowPublicMcpExecutor<PodResult>;
  readonly inspectStatus: WakeflowPublicMcpExecutor<StatusResult>;
  readonly verifyWorkspace: WakeflowPublicMcpExecutor<VerifyResult>;
  readonly planTargetTask: WakeflowPublicMcpExecutor<TargetTaskPlanningResult>;
  readonly prepareDelivery: WakeflowPublicMcpExecutor<PrepareDeliveryResult>;
  readonly publishRequirement: WakeflowPublicMcpExecutor<RequirementPublicationResult>;
  readonly inspectBoard: WakeflowPublicMcpExecutor<BoardInspectionResult>;
  readonly rearmDelivery: WakeflowPublicMcpExecutor<RearmDeliveryResult>;
  readonly recordImplementationReviewDecision: WakeflowPublicMcpExecutor<ImplementationReviewDecisionResult>;
  readonly recordTestReviewDecision: WakeflowPublicMcpExecutor<TestReviewDecisionResult>;
  readonly recordEvidence: WakeflowPublicMcpExecutor<RecordEvidenceResult>;
  readonly recordDeliveryOutcome: WakeflowPublicMcpExecutor<RecordDeliveryOutcomeResult>;
  readonly registerWindowHostBinding: WakeflowPublicMcpExecutor<WindowBindingResult>;
}

export type WakeflowPublicMcpExecutorField = keyof WakeflowPublicMcpExecutors;

type Registration = Readonly<
  Omit<WakeflowToolRegistration, "executor"> & {
    readonly executor: WakeflowPublicMcpExecutorField;
  }
>;

const REGISTRATIONS: readonly Registration[] = Object.freeze([
  {
    name: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
    slice: "workspace",
    shape: "effect",
    executor: "executeMaintenance",
    title: "Maintain Wakeflow Workspace",
    description:
      "Preview, apply, or recover one workspace Maintenance transaction (fresh-initialize, reconfigure, reconcile): preview is read-only and returns the plan with its planDigest, apply resends the same action and request with that planDigest so Wakeflow re-derives the plan and rejects drift, and recover finishes an interrupted transaction by operationId. Every result carries next; returned window launch intents require explicit Agent host actions.",
    requestSchema: WAKEFLOW_MAINTENANCE_PUBLIC_REQUEST_SCHEMA,
    resultSchema: WAKEFLOW_MAINTENANCE_PUBLIC_RESULT_SCHEMA,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  WINDOW_BINDING_TOOL_REGISTRATION satisfies Registration,
  REQUIREMENT_PUBLICATION_TOOL_REGISTRATION satisfies Registration,
  BOARD_INSPECTION_TOOL_REGISTRATION satisfies Registration,
  DEMAND_CREATION_TOOL_REGISTRATION satisfies Registration,
  DEMAND_COMPLETION_TOOL_REGISTRATION satisfies Registration,
  DEMAND_CANCELLATION_TOOL_REGISTRATION satisfies Registration,
  DEMAND_CONTINUATION_TOOL_REGISTRATION satisfies Registration,
  RECORD_EVIDENCE_TOOL_REGISTRATION satisfies Registration,
  TARGET_TASK_PLANNING_TOOL_REGISTRATION satisfies Registration,
  PREPARE_DELIVERY_TOOL_REGISTRATION satisfies Registration,
  RECORD_DELIVERY_OUTCOME_TOOL_REGISTRATION satisfies Registration,
  REARM_DELIVERY_TOOL_REGISTRATION satisfies Registration,
  TARGET_RESULT_IMPORT_TOOL_REGISTRATION satisfies Registration,
  TARGET_RESULT_REVIEW_INSPECTION_TOOL_REGISTRATION satisfies Registration,
  IMPLEMENTATION_REVIEW_DECISION_TOOL_REGISTRATION satisfies Registration,
  TEST_REVIEW_DECISION_TOOL_REGISTRATION satisfies Registration,
  POD_TOOL_REGISTRATION satisfies Registration,
  STATUS_TOOL_REGISTRATION satisfies Registration,
  VERIFY_TOOL_REGISTRATION satisfies Registration,
]);

/** 全部公共工具的登记表；组合根按它生成目录。 */
export const WAKEFLOW_PUBLIC_TOOL_CATALOG: Readonly<WakeflowToolCatalog> =
  createWakeflowToolCatalog(REGISTRATIONS);

/** 组合根必须绑定的 executor 名（按登记表顺序）。 */
export const WAKEFLOW_PUBLIC_MCP_EXECUTOR_FIELDS: readonly WakeflowPublicMcpExecutorField[] =
  Object.freeze(
    WAKEFLOW_PUBLIC_TOOL_CATALOG.tools.map(
      (tool) => tool.executor as WakeflowPublicMcpExecutorField,
    ),
  );
