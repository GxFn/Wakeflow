import {
  WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
  type WakeflowMaintenancePublicResult,
} from "../capabilities/workspace/maintain-workspace.js";
import { WAKEFLOW_CONFIRMATION_PUBLICATION_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-confirmation-publication-request.generated.js";
import { WAKEFLOW_CONFIRMATION_PUBLICATION_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-confirmation-publication-result.generated.js";
import { WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-controller-implementation-review-decision-request.generated.js";
import { WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-controller-implementation-review-decision-result.generated.js";
import { WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-controller-product-defect-remediation-request.generated.js";
import { WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-controller-product-defect-remediation-result.generated.js";
import { WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-controller-test-review-decision-request.generated.js";
import { WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-controller-test-review-decision-result.generated.js";
import { WAKEFLOW_DEMAND_COMPLETION_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-demand-completion-request.generated.js";
import { WAKEFLOW_DEMAND_COMPLETION_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-demand-completion-result.generated.js";
import { WAKEFLOW_DEMAND_CONTROLLER_ROUTE_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-demand-controller-route-request.generated.js";
import { WAKEFLOW_DEMAND_CONTROLLER_ROUTE_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-demand-controller-route-result.generated.js";
import { WAKEFLOW_DEMAND_PUBLICATION_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-demand-publication-request.generated.js";
import { WAKEFLOW_DEMAND_PUBLICATION_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-demand-publication-result.generated.js";
import { WAKEFLOW_MAINTENANCE_PUBLIC_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-maintenance-public-request.generated.js";
import { WAKEFLOW_MAINTENANCE_PUBLIC_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-maintenance-public-result.generated.js";
import { WAKEFLOW_MANAGED_EVIDENCE_PUBLICATION_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-managed-evidence-publication-request.generated.js";
import { WAKEFLOW_MANAGED_EVIDENCE_PUBLICATION_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-managed-evidence-publication-result.generated.js";
import { WAKEFLOW_REQUIREMENT_PUBLICATION_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-requirement-publication-request.generated.js";
import { WAKEFLOW_REQUIREMENT_PUBLICATION_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-requirement-publication-result.generated.js";
import { WAKEFLOW_TARGET_DELIVERY_PREPARATION_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-target-delivery-preparation-request.generated.js";
import { WAKEFLOW_TARGET_DELIVERY_PREPARATION_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-target-delivery-preparation-result.generated.js";
import { WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-target-host-effect-claim-request.generated.js";
import { WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-target-host-effect-claim-result.generated.js";
import { WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-target-host-effect-outcome-request.generated.js";
import { WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-target-host-effect-outcome-result.generated.js";
import { WAKEFLOW_TARGET_HOST_EFFECT_REARM_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-target-host-effect-rearm-request.generated.js";
import { WAKEFLOW_TARGET_HOST_EFFECT_REARM_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-target-host-effect-rearm-result.generated.js";
import { WAKEFLOW_TARGET_RESULT_IMPORT_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-target-result-import-request.generated.js";
import { WAKEFLOW_TARGET_RESULT_IMPORT_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-target-result-import-result.generated.js";
import { WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-target-result-review-inspection-request.generated.js";
import { WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-target-result-review-inspection-result.generated.js";
import { WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-target-result-review-resume-request.generated.js";
import { WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-target-result-review-resume-result.generated.js";
import { WAKEFLOW_TARGET_TASK_PLANNING_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-target-task-planning-request.generated.js";
import {
  WAKEFLOW_TARGET_TASK_PLANNING_RESULT_SCHEMA,
  type WakeflowTargetTaskPlanningResultV1,
} from "../contracts/generated/entrypoints/wakeflow-target-task-planning-result.generated.js";
import { WAKEFLOW_TEST_CARD_PLANNING_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-test-card-planning-request.generated.js";
import { WAKEFLOW_TEST_CARD_PLANNING_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-test-card-planning-result.generated.js";
import { WAKEFLOW_TEST_DELIVERY_PREPARATION_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-test-delivery-preparation-request.generated.js";
import { WAKEFLOW_TEST_DELIVERY_PREPARATION_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-test-delivery-preparation-result.generated.js";
import { WAKEFLOW_TODO_INSPECTION_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-todo-inspection-request.generated.js";
import { WAKEFLOW_TODO_INSPECTION_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-todo-inspection-result.generated.js";
import { WAKEFLOW_TODO_INTAKE_PUBLICATION_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-todo-intake-publication-request.generated.js";
import { WAKEFLOW_TODO_INTAKE_PUBLICATION_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-todo-intake-publication-result.generated.js";
import { WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME } from "../governance/controller/demand-controller-route-public-contract.js";
import type { DemandControllerRoutePublicResult } from "../governance/controller/demand-controller-route-public-coordinator.js";
import { WAKEFLOW_TARGET_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME } from "../governance/delivery/target-delivery-preparation-public-contract.js";
import type { TargetDeliveryPreparationPublicResult } from "../governance/delivery/target-delivery-preparation-public-coordinator.js";
import { WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_TOOL_NAME } from "../governance/delivery/target-host-effect-claim-public-contract.js";
import type { TargetHostEffectClaimPublicResult } from "../governance/delivery/target-host-effect-claim-public-coordinator.js";
import { WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_TOOL_NAME } from "../governance/delivery/target-host-effect-outcome-public-contract.js";
import type { TargetHostEffectOutcomePublicResult } from "../governance/delivery/target-host-effect-outcome-public-coordinator.js";
import { WAKEFLOW_TARGET_HOST_EFFECT_REARM_PUBLIC_TOOL_NAME } from "../governance/delivery/target-host-effect-rearm-public-contract.js";
import type { TargetHostEffectRearmPublicResult } from "../governance/delivery/target-host-effect-rearm-public-coordinator.js";
import { WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME } from "../governance/demand/publication/demand-publication-public-contract.js";
import type { DemandPublicationPublicResult } from "../governance/demand/publication/demand-publication-public-coordinator.js";
import { WAKEFLOW_MANAGED_EVIDENCE_PUBLIC_TOOL_NAME } from "../governance/evidence/managed-evidence-public-contract.js";
import type { ManagedEvidencePublicResult } from "../governance/evidence/managed-evidence-public-coordinator.js";
import {
  WAKEFLOW_CONFIRMATION_PUBLICATION_PUBLIC_TOOL_NAME,
  WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME,
  type ConfirmationPublicationPublicResult,
  type RequirementPublicationPublicResult,
} from "../governance/ledger/ledger-authority-public-contract.js";
import { WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME } from "../governance/lifecycle/demand-completion-public-contract.js";
import type { DemandCompletionPublicResult } from "../governance/lifecycle/demand-completion-public-coordinator.js";
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
import { WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME } from "../governance/tasking/target-task-planning-public-contract.js";
import { WAKEFLOW_TEST_CARD_PLANNING_PUBLIC_TOOL_NAME } from "../governance/testing/test-card-planning-public-contract.js";
import type { TestCardPlanningPublicResult } from "../governance/testing/test-card-planning-public-coordinator.js";
import { WAKEFLOW_TEST_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME } from "../governance/testing/test-delivery-preparation-public-contract.js";
import type { TestDeliveryPreparationPublicResult } from "../governance/testing/test-delivery-preparation-public-coordinator.js";
import {
  WAKEFLOW_TODO_INSPECTION_PUBLIC_TOOL_NAME,
  type TodoInspectionPublicResult,
} from "../governance/todo/todo-inspection-public-contract.js";
import {
  WAKEFLOW_TODO_INTAKE_PUBLICATION_PUBLIC_TOOL_NAME,
  type TodoIntakePublicationPublicResult,
} from "../governance/todo/todo-intake-publication-public-contract.js";
import {
  createWakeflowToolCatalog,
  type WakeflowToolCatalog,
  type WakeflowToolRegistration,
} from "../kernel/tool-registry.js";
import { WINDOW_BINDING_TOOL_REGISTRATION } from "../capabilities/endpoint/contract.js";
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
  readonly claimTargetHostEffect: WakeflowPublicMcpExecutor<TargetHostEffectClaimPublicResult>;
  readonly completeDemand: WakeflowPublicMcpExecutor<DemandCompletionPublicResult>;
  readonly createDemand: WakeflowPublicMcpExecutor<DemandPublicationPublicResult>;
  readonly executeMaintenance: WakeflowPublicMcpExecutor<WakeflowMaintenancePublicResult>;
  readonly importTargetResult: WakeflowPublicMcpExecutor<TargetResultImportPublicResult>;
  readonly inspectDemandRoute: WakeflowPublicMcpExecutor<DemandControllerRoutePublicResult>;
  readonly inspectTargetResultReview: WakeflowPublicMcpExecutor<TargetResultReviewInspectionPublicResult>;
  readonly inspectTodo: WakeflowPublicMcpExecutor<TodoInspectionPublicResult>;
  readonly intakeTodo: WakeflowPublicMcpExecutor<TodoIntakePublicationPublicResult>;
  readonly planTargetTask: WakeflowPublicMcpExecutor<WakeflowTargetTaskPlanningResultV1>;
  readonly planTestCard: WakeflowPublicMcpExecutor<TestCardPlanningPublicResult>;
  readonly prepareImplementationDelivery: WakeflowPublicMcpExecutor<TargetDeliveryPreparationPublicResult>;
  readonly prepareTestDelivery: WakeflowPublicMcpExecutor<TestDeliveryPreparationPublicResult>;
  readonly publishConfirmation: WakeflowPublicMcpExecutor<ConfirmationPublicationPublicResult>;
  readonly publishRequirement: WakeflowPublicMcpExecutor<RequirementPublicationPublicResult>;
  readonly rearmTargetHostEffect: WakeflowPublicMcpExecutor<TargetHostEffectRearmPublicResult>;
  readonly recordControllerImplementationReviewDecision: WakeflowPublicMcpExecutor<ControllerImplementationReviewDecisionPublicResult>;
  readonly recordControllerTestReviewDecision: WakeflowPublicMcpExecutor<ControllerTestReviewDecisionPublicResult>;
  readonly recordManagedEvidence: WakeflowPublicMcpExecutor<ManagedEvidencePublicResult>;
  readonly recordTargetHostEffectOutcome: WakeflowPublicMcpExecutor<TargetHostEffectOutcomePublicResult>;
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
  {
    name: WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME,
    slice: "requirement",
    shape: "effect",
    executor: "publishRequirement",
    title: "Publish Wakeflow Requirement Authority",
    description:
      "Preview, apply, or recover one immutable Requirement authority publication from the current Design surface: preview takes a title, the Design surface identity, and 1-32 role-bound Markdown member paths, apply takes the exact preview plan and digest and revalidates current source bytes, and recover uses only the exact plan plus durable intent, stage, and final state. Results return metadata-only Requirement and member references, never a physical path, document bytes, or host effect.",
    requestSchema: WAKEFLOW_REQUIREMENT_PUBLICATION_REQUEST_SCHEMA,
    resultSchema: WAKEFLOW_REQUIREMENT_PUBLICATION_RESULT_SCHEMA,
    annotations: ADDITIVE,
  },
  {
    name: WAKEFLOW_CONFIRMATION_PUBLICATION_PUBLIC_TOOL_NAME,
    slice: "requirement",
    shape: "effect",
    executor: "publishConfirmation",
    title: "Publish Wakeflow Confirmation Authority",
    description:
      "Preview, apply, or recover one immutable pre-Demand Confirmation authority publication from the current Design surface: preview takes a title, the Design surface identity, and 1-32 role-bound Markdown member paths while Wakeflow derives the Confirmation identity, the future isolated Demand identity, source digests, and the publication plan; apply takes the exact preview plan and digest and revalidates current source bytes. It creates no Demand and exposes no physical path, document bytes, or host effect.",
    requestSchema: WAKEFLOW_CONFIRMATION_PUBLICATION_REQUEST_SCHEMA,
    resultSchema: WAKEFLOW_CONFIRMATION_PUBLICATION_RESULT_SCHEMA,
    annotations: ADDITIVE,
  },
  {
    name: WAKEFLOW_TODO_INTAKE_PUBLICATION_PUBLIC_TOOL_NAME,
    slice: "requirement",
    shape: "effect",
    executor: "intakeTodo",
    title: "Intake Wakeflow TODO",
    description:
      "Preview, apply, or recover one immutable TODO Intake and its initial State from author-owned queue semantics, one current origin window, a testing decision, and selected immutable Ledger members; apply and recover require the exact preview plan and digest and publish additively and idempotently. Success returns only TODO identity, initial status, and digests; this tool creates no Demand, performs no host effect, and does not execute Auto Claim.",
    requestSchema: WAKEFLOW_TODO_INTAKE_PUBLICATION_REQUEST_SCHEMA,
    resultSchema: WAKEFLOW_TODO_INTAKE_PUBLICATION_RESULT_SCHEMA,
    annotations: ADDITIVE,
  },
  {
    name: WAKEFLOW_TODO_INSPECTION_PUBLIC_TOOL_NAME,
    slice: "requirement",
    shape: "read",
    executor: "inspectTodo",
    title: "Inspect Wakeflow TODO",
    description:
      "List one bounded page of TODO summaries (fixed createdAt and TODO-ID order, optional observation filters, page size 20, maximum 100, opaque snapshot-bound token) or inspect one exact TODO item with its Ledger member references and redacted State. Read-only: it does not derive eligibility, select or claim work, create a TODO or Demand, or expose a workspace root, state-root ref, lock, or projection content.",
    requestSchema: WAKEFLOW_TODO_INSPECTION_REQUEST_SCHEMA,
    resultSchema: WAKEFLOW_TODO_INSPECTION_RESULT_SCHEMA,
    annotations: READ_ONLY,
  },
  {
    name: WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME,
    slice: "demand",
    shape: "effect",
    executor: "createDemand",
    title: "Create Wakeflow Demand",
    description:
      "Preview, apply, or explicitly recover one TODO-backed Demand Event Sourcing publication: preview derives Program, Demand type, testing, Ledger Authority, identities, Event and Commit data, and TODO CAS from current authority, apply takes the exact preview plan and digest, and recover takes a Demand ID with durable sidecar evidence. This tool performs no host effect and returns no machine path; inspect the Demand Route after publication is current.",
    requestSchema: WAKEFLOW_DEMAND_PUBLICATION_REQUEST_SCHEMA,
    resultSchema: WAKEFLOW_DEMAND_PUBLICATION_RESULT_SCHEMA,
    annotations: DESTRUCTIVE,
  },
  {
    name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
    slice: "observation",
    shape: "read",
    executor: "inspectDemandRoute",
    title: "Inspect Wakeflow Demand Route",
    description:
      "Inspect one current, read-only Demand Controller Route derived from the verified Config, Demand Event Stream, Review Snapshot, and Post-Acceptance Route, identifying typed responsibility frontiers and capability blockers without workspace paths, host handles, prompts, or full business records. This observation never authorizes a mutation, host effect, review decision, or acceptance.",
    requestSchema: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_REQUEST_SCHEMA,
    resultSchema: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_RESULT_SCHEMA,
    annotations: READ_ONLY,
  },
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
  {
    name: WAKEFLOW_TEST_CARD_PLANNING_PUBLIC_TOOL_NAME,
    slice: "tasking",
    shape: "effect",
    executor: "planTestCard",
    title: "Plan Wakeflow Test Card",
    description:
      "Preview or apply one Controller-authored real-environment TestCard when the current Demand Route selects Test Card Planning; Wakeflow derives the frozen Test Basis, environment Authority, accepted implementation baselines, Test Window, generation source, and Event identities. Apply only appends the TestCard Event: it creates no Test Task or Delivery, runs no Test, performs no host effect, and grants no Test conclusion.",
    requestSchema: WAKEFLOW_TEST_CARD_PLANNING_REQUEST_SCHEMA,
    resultSchema: WAKEFLOW_TEST_CARD_PLANNING_RESULT_SCHEMA,
    annotations: ADDITIVE,
  },
  {
    name: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
    slice: "tasking",
    shape: "append",
    executor: "planTargetTask",
    title: "Plan Wakeflow Target Task",
    description:
      "Append one immutable Implementation or Test TaskPackage plan to an existing Demand in a single call, supplying the observed stream revision and a client idempotency key: the same key and body replays the first result, a stale revision or a reused key with a different body is rejected, and Test requests carry only workType=test. The result carries the planning event, the projection receipt, and the next Controller frontier; it never performs Delivery or host effects.",
    requestSchema: WAKEFLOW_TARGET_TASK_PLANNING_REQUEST_SCHEMA,
    resultSchema: WAKEFLOW_TARGET_TASK_PLANNING_RESULT_SCHEMA,
    annotations: ADDITIVE,
  },
  {
    name: WAKEFLOW_TARGET_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
    slice: "delivery",
    shape: "effect",
    executor: "prepareImplementationDelivery",
    title: "Prepare Wakeflow Implementation Delivery",
    description:
      "Preview or apply one immutable Implementation Delivery Preparation plan for a current planned, rework-requested, or product-defect-rework-requested Target: preview exposes the exact Intent and portable prompt, apply revalidates current Config, Demand, TaskPackage, Binding, and stream authority before appending the preparation Event. Apply never creates a WindowWorkClaim, returns an Agent Host Action, or performs a host effect.",
    requestSchema: WAKEFLOW_TARGET_DELIVERY_PREPARATION_REQUEST_SCHEMA,
    resultSchema: WAKEFLOW_TARGET_DELIVERY_PREPARATION_RESULT_SCHEMA,
    annotations: ADDITIVE,
  },
  {
    name: WAKEFLOW_TEST_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
    slice: "delivery",
    shape: "effect",
    executor: "prepareTestDelivery",
    title: "Prepare Wakeflow Test Delivery",
    description:
      "Preview or apply one immutable Test Delivery authorization for the current Test Target: preview accepts only Demand and Target identity, Wakeflow derives initial, rerun, or replacement mode with its exact TestCard, attempt, prior review, rejected Host Effect, Binding, and Event lineage, and apply revalidates current authority before appending the preparation Event. This tool creates no Dispatch Packet or WindowWorkClaim, returns no Agent Host Action, performs no host effect, and runs no Test.",
    requestSchema: WAKEFLOW_TEST_DELIVERY_PREPARATION_REQUEST_SCHEMA,
    resultSchema: WAKEFLOW_TEST_DELIVERY_PREPARATION_RESULT_SCHEMA,
    annotations: ADDITIVE,
  },
  {
    name: WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_TOOL_NAME,
    slice: "delivery",
    shape: "append",
    executor: "claimTargetHostEffect",
    title: "Claim Wakeflow Target Host Effect",
    description: `Acquire or recover one durable cross-Demand window Claim for an exact prepared Implementation or Test Delivery using a fresh Agent host observation; only the first committed call returns a transient Agent Host Action, and idempotent replay returns already-claimed with action=null. Wakeflow validates the private Binding but never executes the host effect: after executing an issued Action at most once, record the observed fact with ${WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_TOOL_NAME}.`,
    requestSchema: WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_REQUEST_SCHEMA,
    resultSchema: WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_RESULT_SCHEMA,
    annotations: ADDITIVE,
  },
  {
    name: WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_TOOL_NAME,
    slice: "delivery",
    shape: "append",
    executor: "recordTargetHostEffectOutcome",
    title: "Record Wakeflow Target Host Effect Outcome",
    description:
      "Record an already-observed Implementation or Test Target Host Effect attempt with at most one bounded readback; the stored Claim Event derives all target, route, host observation, and Test lineage fields, and raw evidence is reduced to digests and omitted from the Event and result. accepted and indeterminate outcomes retain the Claim and never authorize another send; only a proved rejected-before-effect outcome records its Event and then releases that exact Claim.",
    requestSchema: WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_REQUEST_SCHEMA,
    resultSchema: WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_RESULT_SCHEMA,
    annotations: DESTRUCTIVE,
  },
  {
    name: WAKEFLOW_TARGET_HOST_EFFECT_REARM_PUBLIC_TOOL_NAME,
    slice: "delivery",
    shape: "append",
    executor: "rearmTargetHostEffect",
    title: "Rearm Wakeflow Target Host Effect",
    description:
      "Explicitly rearm one Implementation Target Host Effect only after its stored Outcome proves rejected-before-effect and the exact old Claim is released; the stored Claim and Observation derive every identity and caller-authored Task or Delivery echoes are rejected. It only appends the Rearm Event for the same immutable Delivery and never performs the host effect, creates a Claim, returns an Agent Host Action, or handles Test replacement Delivery.",
    requestSchema: WAKEFLOW_TARGET_HOST_EFFECT_REARM_REQUEST_SCHEMA,
    resultSchema: WAKEFLOW_TARGET_HOST_EFFECT_REARM_RESULT_SCHEMA,
    annotations: ADDITIVE,
  },
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
      "Authorize bounded remediation of exact existing Implementation TaskPackage baselines only when the current Demand Route selects Product Defect Remediation Authorization, carrying the exact product-defect Test Decision, post-acceptance Route digest, affected product Target identities, failed-check mappings, correction objectives, and Controller rationale while Wakeflow derives every baseline and Event identity. It does not create Delivery, execute a fix, let Test modify product code, create the next TestCard, or complete the Demand.",
    requestSchema: WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_REQUEST_SCHEMA,
    resultSchema: WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_RESULT_SCHEMA,
    annotations: DESTRUCTIVE,
  },
  {
    name: WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
    slice: "demand",
    shape: "effect",
    executor: "completeDemand",
    title: "Complete Wakeflow Demand",
    description:
      "Preview or apply one exact successful Demand terminal transition only when the current Route selects Demand Completion Preflight: preview exposes the immutable Completion plan, apply revalidates current Config, Demand Authority, accepted Implementation and required Test closure, claimed TODO, absent participating WorkClaims, and Event Stream position before appending the terminal Event. Completion is not Archive: it does not archive or delete the TODO, move the Demand, create a BusinessArchive, close host windows, or prune transport.",
    requestSchema: WAKEFLOW_DEMAND_COMPLETION_REQUEST_SCHEMA,
    resultSchema: WAKEFLOW_DEMAND_COMPLETION_RESULT_SCHEMA,
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
