import {
  WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
  type WakeflowMaintenancePublicResult,
} from "../capabilities/workspace/maintain-workspace.js";
import { WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-controller-implementation-review-decision-request.generated.js";
import { WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-controller-implementation-review-decision-result.generated.js";
import { WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-controller-product-defect-remediation-request.generated.js";
import { WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-controller-product-defect-remediation-result.generated.js";
import { WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-controller-test-review-decision-request.generated.js";
import { WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-controller-test-review-decision-result.generated.js";
import { WAKEFLOW_MAINTENANCE_PUBLIC_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-maintenance-public-request.generated.js";
import { WAKEFLOW_MAINTENANCE_PUBLIC_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-maintenance-public-result.generated.js";
import { WAKEFLOW_MANAGED_EVIDENCE_PUBLICATION_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-managed-evidence-publication-request.generated.js";
import { WAKEFLOW_MANAGED_EVIDENCE_PUBLICATION_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-managed-evidence-publication-result.generated.js";
import { WAKEFLOW_TARGET_RESULT_IMPORT_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-target-result-import-request.generated.js";
import { WAKEFLOW_TARGET_RESULT_IMPORT_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-target-result-import-result.generated.js";
import { WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-target-result-review-inspection-request.generated.js";
import { WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-target-result-review-inspection-result.generated.js";
import { WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-target-result-review-resume-request.generated.js";
import { WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-target-result-review-resume-result.generated.js";
import { WAKEFLOW_MANAGED_EVIDENCE_PUBLIC_TOOL_NAME } from "../governance/evidence/managed-evidence-public-contract.js";
import type { ManagedEvidencePublicResult } from "../governance/evidence/managed-evidence-public-coordinator.js";
import { WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME } from "../governance/result/target-result-import-public-contract.js";
import type { TargetResultImportPublicResult } from "../governance/result/target-result-import-public-coordinator.js";
import { WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME } from "../governance/review/controller-implementation-review-decision-public-contract.js";
import type { ControllerImplementationReviewDecisionPublicResult } from "../governance/review/controller-implementation-review-decision-public-coordinator.js";
import { WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_PUBLIC_TOOL_NAME } from "../governance/review/controller-product-defect-remediation-public-contract.js";
import type { ControllerProductDefectRemediationPublicResult } from "../governance/review/controller-product-defect-remediation-public-coordinator.js";
import { WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME } from "../governance/review/controller-test-review-decision-public-contract.js";
import type { ControllerTestReviewDecisionPublicResult } from "../governance/review/controller-test-review-decision-public-coordinator.js";
import { WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME } from "../governance/review/target-result-review-inspection-public-contract.js";
import type { TargetResultReviewInspectionPublicResult } from "../governance/review/target-result-review-inspection-public-coordinator.js";
import { WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_PUBLIC_TOOL_NAME } from "../governance/review/target-result-review-resume-public-contract.js";
import type { TargetResultReviewResumePublicResult } from "../governance/review/target-result-review-resume-public-coordinator.js";
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
  readonly authorizeProductDefectRemediation: WakeflowPublicMcpExecutor<ControllerProductDefectRemediationPublicResult>;
  readonly cancelDemand: WakeflowPublicMcpExecutor<DemandCancellationResult>;
  readonly completeDemand: WakeflowPublicMcpExecutor<DemandCompletionResult>;
  readonly continueDemand: WakeflowPublicMcpExecutor<DemandContinuationResult>;
  readonly createDemand: WakeflowPublicMcpExecutor<DemandCreationResult>;
  readonly executeMaintenance: WakeflowPublicMcpExecutor<WakeflowMaintenancePublicResult>;
  readonly importTargetResult: WakeflowPublicMcpExecutor<TargetResultImportPublicResult>;
  readonly inspectDemandRoute: WakeflowPublicMcpExecutor<DemandRouteInspectionResult>;
  readonly inspectTargetResultReview: WakeflowPublicMcpExecutor<TargetResultReviewInspectionPublicResult>;
  readonly planTargetTask: WakeflowPublicMcpExecutor<TargetTaskPlanningResult>;
  readonly prepareDelivery: WakeflowPublicMcpExecutor<PrepareDeliveryResult>;
  readonly publishRequirement: WakeflowPublicMcpExecutor<RequirementPublicationResult>;
  readonly inspectBoard: WakeflowPublicMcpExecutor<BoardInspectionResult>;
  readonly rearmDelivery: WakeflowPublicMcpExecutor<RearmDeliveryResult>;
  readonly recordControllerImplementationReviewDecision: WakeflowPublicMcpExecutor<ControllerImplementationReviewDecisionPublicResult>;
  readonly recordControllerTestReviewDecision: WakeflowPublicMcpExecutor<ControllerTestReviewDecisionPublicResult>;
  readonly recordManagedEvidence: WakeflowPublicMcpExecutor<ManagedEvidencePublicResult>;
  readonly recordDeliveryOutcome: WakeflowPublicMcpExecutor<RecordDeliveryOutcomeResult>;
  readonly registerWindowHostBinding: WakeflowPublicMcpExecutor<WindowBindingResult>;
  readonly resumeTargetResultReview: WakeflowPublicMcpExecutor<TargetResultReviewResumePublicResult>;
}

export type WakeflowPublicMcpExecutorField = keyof WakeflowPublicMcpExecutors;

type Registration = Readonly<
  Omit<WakeflowToolRegistration, "executor"> & {
    readonly executor: WakeflowPublicMcpExecutorField;
  }
>;

const READ_ONLY = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false as const,
});
const ADDITIVE = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false as const,
});
const DESTRUCTIVE = Object.freeze({
  readOnlyHint: false,
  destructiveHint: true,
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
  {
    name: WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
    slice: "result-review",
    shape: "append",
    executor: "importTargetResult",
    title: "Import Wakeflow Target Result",
    description:
      "Import one exact target-authored Implementation or Test Agent Report after an accepted or indeterminate Host Effect Outcome; the stored TaskPackage, Delivery, Claim, Observation, Test lineage, Result identity, and Event identity are derived by Wakeflow rather than echoed by the caller. The Result Event is appended before the exact Claim is released, and the returned TargetResult is Controller review input only, never acceptance, a Test verdict, or Demand completion.",
    requestSchema: WAKEFLOW_TARGET_RESULT_IMPORT_REQUEST_SCHEMA,
    resultSchema: WAKEFLOW_TARGET_RESULT_IMPORT_RESULT_SCHEMA,
    annotations: DESTRUCTIVE,
  },
  {
    name: WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
    slice: "result-review",
    shape: "read",
    executor: "inspectTargetResultReview",
    title: "Inspect Wakeflow Target Result Review",
    description:
      "Read one current reported or review-blocked Implementation or Test TargetResult review unit from the authoritative Demand Event Stream, including the complete TaskPackage, authority-enriched TargetResult, evidence locators, source Event receipts, prior review history, exact Snapshot and Review-unit digests, and, for a blocked unit, the current blocked Controller Decision. Review input only: it performs no checks, derives no allowed decision or verdict, and creates no Resume, Controller acceptance, or ReviewCandidate.",
    requestSchema: WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_REQUEST_SCHEMA,
    resultSchema: WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_RESULT_SCHEMA,
    annotations: READ_ONLY,
  },
  {
    name: WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_PUBLIC_TOOL_NAME,
    slice: "result-review",
    shape: "append",
    executor: "resumeTargetResultReview",
    title: "Resume Wakeflow Target Result Review",
    description:
      "Record the Controller's explicit assertion that the external condition blocking one exact current Implementation or Test TargetResult review generation is resolved, using the exact target and blocked stream revision and state digest from the current Review Inspection plus a bounded resolution summary. It only reopens the same review: it runs no checks, creates no Test attempt or Delivery, performs no host effect, and grants no accept, rework, or Test conclusion; inspect again and perform fresh independent checks before a new Decision.",
    requestSchema: WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_REQUEST_SCHEMA,
    resultSchema: WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_RESULT_SCHEMA,
    annotations: ADDITIVE,
  },
  {
    name: WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
    slice: "result-review",
    shape: "append",
    executor: "recordControllerImplementationReviewDecision",
    title: "Record Wakeflow Controller Implementation Review Decision",
    description:
      "Record the Controller's independently established accept, rework, redesign, or blocked judgment for one exact inspected Implementation TargetResult, carrying the current Snapshot, Review-unit, and TargetResult identities plus explicit assessment, independent checks, rationale, blockers, and residual risks. It does not run checks, trust the Target report as truth, dispatch follow-up work, route Design, create Test, or complete the Demand; its Decision Event is the only implementation Target acceptance authority.",
    requestSchema: WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_REQUEST_SCHEMA,
    resultSchema: WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_RESULT_SCHEMA,
    annotations: DESTRUCTIVE,
  },
  {
    name: WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME,
    slice: "result-review",
    shape: "append",
    executor: "recordControllerTestReviewDecision",
    title: "Record Wakeflow Controller Test Review Decision",
    description:
      "Record the Controller's independently established accept, request-another-attempt, escalate-product-defect, or blocked judgment for one exact inspected Test TargetResult, carrying the current Snapshot, Review-unit, and TargetResult identities plus explicit assessment, independent checks, rationale, blockers, and residual risks. It does not run checks, create another attempt, authorize product remediation, dispatch work, run Test, or complete the Demand; inspect the Route again after its Decision Event is current.",
    requestSchema: WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_REQUEST_SCHEMA,
    resultSchema: WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_RESULT_SCHEMA,
    annotations: DESTRUCTIVE,
  },
  {
    name: WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_PUBLIC_TOOL_NAME,
    slice: "result-review",
    shape: "append",
    executor: "authorizeProductDefectRemediation",
    title: "Authorize Wakeflow Product Defect Remediation",
    description:
      "Authorize bounded remediation of exact existing Implementation TaskPackage baselines only when the current Demand Route selects Product Defect Remediation Authorization, carrying the exact product-defect Test Decision, post-acceptance Route digest, affected product Target identities, failed-check mappings, correction objectives, and Controller rationale while Wakeflow derives every baseline and Event identity. It does not create Delivery, execute a fix, let Test modify product code, plan the retest task package, or complete the Demand.",
    requestSchema: WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_REQUEST_SCHEMA,
    resultSchema: WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_RESULT_SCHEMA,
    annotations: DESTRUCTIVE,
  },
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
