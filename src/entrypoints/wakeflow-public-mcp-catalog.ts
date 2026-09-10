import {
  WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
  type WakeflowMaintenancePublicResult,
} from "../capabilities/workspace/maintain-workspace.js";
import { WAKEFLOW_MAINTENANCE_PUBLIC_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-maintenance-public-request.generated.js";
import { WAKEFLOW_MAINTENANCE_PUBLIC_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-maintenance-public-result.generated.js";
import { WAKEFLOW_MANAGED_EVIDENCE_PUBLICATION_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-managed-evidence-publication-request.generated.js";
import { WAKEFLOW_MANAGED_EVIDENCE_PUBLICATION_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-managed-evidence-publication-result.generated.js";
import { WAKEFLOW_MANAGED_EVIDENCE_PUBLIC_TOOL_NAME } from "../governance/evidence/managed-evidence-public-contract.js";
import type { ManagedEvidencePublicResult } from "../governance/evidence/managed-evidence-public-coordinator.js";
import {
  IMPLEMENTATION_REVIEW_DECISION_TOOL_REGISTRATION,
  TARGET_RESULT_IMPORT_TOOL_REGISTRATION,
  TARGET_RESULT_REVIEW_INSPECTION_TOOL_REGISTRATION,
  TEST_REVIEW_DECISION_TOOL_REGISTRATION,
  type ImplementationReviewDecisionResult,
  type TargetResultImportResult,
  type TargetResultReviewInspectionResult,
  type TestReviewDecisionResult,
} from "../capabilities/result-review/contract.js";
import {
  createWakeflowToolCatalog,
  type WakeflowToolCatalog,
  type WakeflowToolRegistration,
} from "../kernel/tool-registry.js";
import {
  DEMAND_CANCELLATION_TOOL_REGISTRATION,
  DEMAND_COMPLETION_TOOL_REGISTRATION,
  DEMAND_CONTINUATION_TOOL_REGISTRATION,
  DEMAND_CREATION_TOOL_REGISTRATION,
  DEMAND_ROUTE_INSPECTION_TOOL_REGISTRATION,
  type DemandCancellationResult,
  type DemandCompletionResult,
  type DemandContinuationResult,
  type DemandCreationResult,
  type DemandRouteInspectionResult,
} from "../capabilities/demand/contract.js";
import { WINDOW_BINDING_TOOL_REGISTRATION } from "../capabilities/endpoint/contract.js";
import {
  PREPARE_DELIVERY_TOOL_REGISTRATION,
  REARM_DELIVERY_TOOL_REGISTRATION,
  RECORD_DELIVERY_OUTCOME_TOOL_REGISTRATION,
  type PrepareDeliveryResult,
  type RearmDeliveryResult,
  type RecordDeliveryOutcomeResult,
} from "../capabilities/delivery/contract.js";
import {
  TARGET_TASK_PLANNING_TOOL_REGISTRATION,
  type TargetTaskPlanningResult,
} from "../capabilities/tasking/contract.js";
import {
  BOARD_INSPECTION_TOOL_REGISTRATION,
  REQUIREMENT_PUBLICATION_TOOL_REGISTRATION,
  type BoardInspectionResult,
  type RequirementPublicationResult,
} from "../capabilities/requirement/contract.js";
import type { WindowBindingResult } from "../capabilities/endpoint/contract.js";
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
  readonly inspectDemandRoute: WakeflowPublicMcpExecutor<DemandRouteInspectionResult>;
  readonly inspectTargetResultReview: WakeflowPublicMcpExecutor<TargetResultReviewInspectionResult>;
  readonly planTargetTask: WakeflowPublicMcpExecutor<TargetTaskPlanningResult>;
  readonly prepareDelivery: WakeflowPublicMcpExecutor<PrepareDeliveryResult>;
  readonly publishRequirement: WakeflowPublicMcpExecutor<RequirementPublicationResult>;
  readonly inspectBoard: WakeflowPublicMcpExecutor<BoardInspectionResult>;
  readonly rearmDelivery: WakeflowPublicMcpExecutor<RearmDeliveryResult>;
  readonly recordImplementationReviewDecision: WakeflowPublicMcpExecutor<ImplementationReviewDecisionResult>;
  readonly recordTestReviewDecision: WakeflowPublicMcpExecutor<TestReviewDecisionResult>;
  readonly recordManagedEvidence: WakeflowPublicMcpExecutor<ManagedEvidencePublicResult>;
  readonly recordDeliveryOutcome: WakeflowPublicMcpExecutor<RecordDeliveryOutcomeResult>;
  readonly registerWindowHostBinding: WakeflowPublicMcpExecutor<WindowBindingResult>;
}

export type WakeflowPublicMcpExecutorField = keyof WakeflowPublicMcpExecutors;

type Registration = Readonly<
  Omit<WakeflowToolRegistration, "executor"> & {
    readonly executor: WakeflowPublicMcpExecutorField;
  }
>;

const ADDITIVE = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false as const,
});

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
  DEMAND_ROUTE_INSPECTION_TOOL_REGISTRATION satisfies Registration,
  DEMAND_COMPLETION_TOOL_REGISTRATION satisfies Registration,
  DEMAND_CANCELLATION_TOOL_REGISTRATION satisfies Registration,
  DEMAND_CONTINUATION_TOOL_REGISTRATION satisfies Registration,
  {
    name: WAKEFLOW_MANAGED_EVIDENCE_PUBLIC_TOOL_NAME,
    slice: "evidence",
    shape: "effect",
    executor: "recordManagedEvidence",
    title: "Record Wakeflow Managed Evidence",
    description:
      "Preview, apply, or recover one immutable local Managed Evidence publication for an existing Demand from a configured repository or support-surface source selection; Wakeflow derives Evidence, Event, and Commit identities, capture time, source digest, Manifest, record tree, and CAS expectations, and apply takes the exact preview plan and digest. Results carry typed IDs, digests, and cursors only, never a source path, Manifest body, payload bytes, private node, or host identity.",
    requestSchema: WAKEFLOW_MANAGED_EVIDENCE_PUBLICATION_REQUEST_SCHEMA,
    resultSchema: WAKEFLOW_MANAGED_EVIDENCE_PUBLICATION_RESULT_SCHEMA,
    annotations: ADDITIVE,
  },
  TARGET_TASK_PLANNING_TOOL_REGISTRATION satisfies Registration,
  PREPARE_DELIVERY_TOOL_REGISTRATION satisfies Registration,
  RECORD_DELIVERY_OUTCOME_TOOL_REGISTRATION satisfies Registration,
  REARM_DELIVERY_TOOL_REGISTRATION satisfies Registration,
  TARGET_RESULT_IMPORT_TOOL_REGISTRATION satisfies Registration,
  TARGET_RESULT_REVIEW_INSPECTION_TOOL_REGISTRATION satisfies Registration,
  IMPLEMENTATION_REVIEW_DECISION_TOOL_REGISTRATION satisfies Registration,
  TEST_REVIEW_DECISION_TOOL_REGISTRATION satisfies Registration,
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
