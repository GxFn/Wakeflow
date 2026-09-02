import { types } from "node:util";

import {
  fromJsonSchema,
  McpServer,
  type CallToolResult,
} from "@modelcontextprotocol/server";

import {
  WAKEFLOW_MAINTENANCE_PUBLIC_REQUEST_SCHEMA,
  type WakeflowMaintenancePublicRequestV1,
} from "../contracts/generated/entrypoints/wakeflow-maintenance-public-request.generated.js";
import {
  WAKEFLOW_MAINTENANCE_PUBLIC_RESULT_SCHEMA,
  type WakeflowMaintenancePublicResultV1,
} from "../contracts/generated/entrypoints/wakeflow-maintenance-public-result.generated.js";
import {
  WAKEFLOW_DEMAND_PUBLICATION_REQUEST_SCHEMA,
  type WakeflowDemandPublicationRequestV1,
} from "../contracts/generated/entrypoints/wakeflow-demand-publication-request.generated.js";
import {
  WAKEFLOW_DEMAND_PUBLICATION_RESULT_SCHEMA,
  type WakeflowDemandPublicationResultV1,
} from "../contracts/generated/entrypoints/wakeflow-demand-publication-result.generated.js";
import {
  WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_REQUEST_SCHEMA,
  type WakeflowWindowHostBindingRegistrationRequestV1,
} from "../contracts/generated/entrypoints/wakeflow-window-host-binding-registration-request.generated.js";
import {
  WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_RESULT_SCHEMA,
  type WakeflowWindowHostBindingRegistrationResultV1,
} from "../contracts/generated/entrypoints/wakeflow-window-host-binding-registration-result.generated.js";
import {
  WAKEFLOW_TARGET_TASK_PLANNING_REQUEST_SCHEMA,
  type WakeflowTargetTaskPlanningRequestV1,
} from "../contracts/generated/entrypoints/wakeflow-target-task-planning-request.generated.js";
import {
  WAKEFLOW_TARGET_TASK_PLANNING_RESULT_SCHEMA,
  type WakeflowTargetTaskPlanningResultV1,
} from "../contracts/generated/entrypoints/wakeflow-target-task-planning-result.generated.js";
import {
  WAKEFLOW_TARGET_DELIVERY_PREPARATION_REQUEST_SCHEMA,
  type WakeflowTargetDeliveryPreparationRequestV1,
} from "../contracts/generated/entrypoints/wakeflow-target-delivery-preparation-request.generated.js";
import {
  WAKEFLOW_TARGET_DELIVERY_PREPARATION_RESULT_SCHEMA,
  type WakeflowTargetDeliveryPreparationResultV1,
} from "../contracts/generated/entrypoints/wakeflow-target-delivery-preparation-result.generated.js";
import {
  WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_REQUEST_SCHEMA,
  type WakeflowTargetHostEffectClaimRequestV1,
} from "../contracts/generated/entrypoints/wakeflow-target-host-effect-claim-request.generated.js";
import {
  WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_RESULT_SCHEMA,
  type WakeflowTargetHostEffectClaimResultV1,
} from "../contracts/generated/entrypoints/wakeflow-target-host-effect-claim-result.generated.js";
import {
  WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_REQUEST_SCHEMA,
  type WakeflowTargetHostEffectOutcomeRequestV1,
} from "../contracts/generated/entrypoints/wakeflow-target-host-effect-outcome-request.generated.js";
import {
  WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_RESULT_SCHEMA,
  type WakeflowTargetHostEffectOutcomeResultV1,
} from "../contracts/generated/entrypoints/wakeflow-target-host-effect-outcome-result.generated.js";
import {
  WAKEFLOW_TARGET_HOST_EFFECT_REARM_REQUEST_SCHEMA,
  type WakeflowTargetHostEffectRearmRequestV1,
} from "../contracts/generated/entrypoints/wakeflow-target-host-effect-rearm-request.generated.js";
import {
  WAKEFLOW_TARGET_HOST_EFFECT_REARM_RESULT_SCHEMA,
  type WakeflowTargetHostEffectRearmResultV1,
} from "../contracts/generated/entrypoints/wakeflow-target-host-effect-rearm-result.generated.js";
import {
  WAKEFLOW_TARGET_RESULT_IMPORT_REQUEST_SCHEMA,
  type WakeflowTargetResultImportRequestV1,
} from "../contracts/generated/entrypoints/wakeflow-target-result-import-request.generated.js";
import {
  WAKEFLOW_TARGET_RESULT_IMPORT_RESULT_SCHEMA,
  type WakeflowTargetResultImportResultV1,
} from "../contracts/generated/entrypoints/wakeflow-target-result-import-result.generated.js";
import {
  WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_REQUEST_SCHEMA,
  type WakeflowTargetResultReviewInspectionRequestV1,
} from "../contracts/generated/entrypoints/wakeflow-target-result-review-inspection-request.generated.js";
import {
  WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_RESULT_SCHEMA,
  type WakeflowTargetResultReviewInspectionResultV1,
} from "../contracts/generated/entrypoints/wakeflow-target-result-review-inspection-result.generated.js";
import {
  WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_REQUEST_SCHEMA,
  type WakeflowTargetResultReviewResumeRequestV1,
} from "../contracts/generated/entrypoints/wakeflow-target-result-review-resume-request.generated.js";
import {
  WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_RESULT_SCHEMA,
  type WakeflowTargetResultReviewResumeResultV1,
} from "../contracts/generated/entrypoints/wakeflow-target-result-review-resume-result.generated.js";
import {
  WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_REQUEST_SCHEMA,
  type WakeflowControllerImplementationReviewDecisionRequestV1,
} from "../contracts/generated/entrypoints/wakeflow-controller-implementation-review-decision-request.generated.js";
import {
  WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_RESULT_SCHEMA,
  type WakeflowControllerImplementationReviewDecisionResultV1,
} from "../contracts/generated/entrypoints/wakeflow-controller-implementation-review-decision-result.generated.js";
import {
  WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_REQUEST_SCHEMA,
  type WakeflowControllerTestReviewDecisionRequestV1,
} from "../contracts/generated/entrypoints/wakeflow-controller-test-review-decision-request.generated.js";
import {
  WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_RESULT_SCHEMA,
  type WakeflowControllerTestReviewDecisionResultV1,
} from "../contracts/generated/entrypoints/wakeflow-controller-test-review-decision-result.generated.js";
import {
  WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_REQUEST_SCHEMA,
  type WakeflowControllerProductDefectRemediationRequestV1,
} from "../contracts/generated/entrypoints/wakeflow-controller-product-defect-remediation-request.generated.js";
import {
  WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_RESULT_SCHEMA,
  type WakeflowControllerProductDefectRemediationResultV1,
} from "../contracts/generated/entrypoints/wakeflow-controller-product-defect-remediation-result.generated.js";
import {
  WAKEFLOW_DEMAND_COMPLETION_REQUEST_SCHEMA,
  type WakeflowDemandCompletionRequestV1,
} from "../contracts/generated/entrypoints/wakeflow-demand-completion-request.generated.js";
import {
  WAKEFLOW_DEMAND_COMPLETION_RESULT_SCHEMA,
  type WakeflowDemandCompletionResultV1,
} from "../contracts/generated/entrypoints/wakeflow-demand-completion-result.generated.js";
import {
  WAKEFLOW_DEMAND_CONTROLLER_ROUTE_REQUEST_SCHEMA,
  type WakeflowDemandControllerRouteRequestV1,
} from "../contracts/generated/entrypoints/wakeflow-demand-controller-route-request.generated.js";
import {
  WAKEFLOW_DEMAND_CONTROLLER_ROUTE_RESULT_SCHEMA,
  type WakeflowDemandControllerRouteResultV1,
} from "../contracts/generated/entrypoints/wakeflow-demand-controller-route-result.generated.js";
import {
  WAKEFLOW_TEST_CARD_PLANNING_REQUEST_SCHEMA,
  type WakeflowTestCardPlanningRequestV1,
} from "../contracts/generated/entrypoints/wakeflow-test-card-planning-request.generated.js";
import {
  WAKEFLOW_TEST_CARD_PLANNING_RESULT_SCHEMA,
  type WakeflowTestCardPlanningResultV1,
} from "../contracts/generated/entrypoints/wakeflow-test-card-planning-result.generated.js";
import {
  WAKEFLOW_TEST_DELIVERY_PREPARATION_REQUEST_SCHEMA,
  type WakeflowTestDeliveryPreparationRequestV1,
} from "../contracts/generated/entrypoints/wakeflow-test-delivery-preparation-request.generated.js";
import {
  WAKEFLOW_TEST_DELIVERY_PREPARATION_RESULT_SCHEMA,
  type WakeflowTestDeliveryPreparationResultV1,
} from "../contracts/generated/entrypoints/wakeflow-test-delivery-preparation-result.generated.js";
import { canonicalizeJson } from "../foundation/data/canonical-json.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../foundation/data/passive-own-data.js";
import {
  WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
  WakeflowMaintenancePublicContractError,
} from "../workspace/maintenance/wakeflow-maintenance-public-contract.js";
import {
  WakeflowMaintenancePublicCoordinatorError,
  type WakeflowMaintenancePublicResult,
} from "../workspace/maintenance/wakeflow-maintenance-public-coordinator.js";
import {
  WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
  WakeflowWindowHostBindingPublicContractError,
} from "../workspace/window-runtime/wakeflow-window-host-binding-public-contract.js";
import {
  WakeflowWindowHostBindingPublicCoordinatorError,
  type WakeflowWindowHostBindingPublicResult,
} from "../workspace/window-runtime/wakeflow-window-host-binding-public-coordinator.js";
import {
  TargetTaskPlanningPublicContractError,
  WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
} from "../governance/tasking/target-task-planning-public-contract.js";
import {
  TargetTaskPlanningPublicCoordinatorError,
  type TargetTaskPlanningPublicResult,
} from "../governance/tasking/target-task-planning-public-coordinator.js";
import {
  TargetDeliveryPreparationPublicContractError,
  WAKEFLOW_TARGET_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
} from "../governance/delivery/target-delivery-preparation-public-contract.js";
import {
  TargetDeliveryPreparationPublicCoordinatorError,
  type TargetDeliveryPreparationPublicResult,
} from "../governance/delivery/target-delivery-preparation-public-coordinator.js";
import {
  TargetHostEffectClaimPublicContractError,
  WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_TOOL_NAME,
} from "../governance/delivery/target-host-effect-claim-public-contract.js";
import {
  TargetHostEffectClaimPublicCoordinatorError,
  type TargetHostEffectClaimPublicResult,
} from "../governance/delivery/target-host-effect-claim-public-coordinator.js";
import {
  TargetHostEffectOutcomePublicContractError,
  WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_TOOL_NAME,
} from "../governance/delivery/target-host-effect-outcome-public-contract.js";
import {
  TargetHostEffectOutcomePublicCoordinatorError,
  type TargetHostEffectOutcomePublicResult,
} from "../governance/delivery/target-host-effect-outcome-public-coordinator.js";
import {
  TargetHostEffectRearmPublicContractError,
  WAKEFLOW_TARGET_HOST_EFFECT_REARM_PUBLIC_TOOL_NAME,
} from "../governance/delivery/target-host-effect-rearm-public-contract.js";
import {
  TargetHostEffectRearmPublicCoordinatorError,
  type TargetHostEffectRearmPublicResult,
} from "../governance/delivery/target-host-effect-rearm-public-coordinator.js";
import {
  TargetResultImportPublicContractError,
  WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
} from "../governance/result/target-result-import-public-contract.js";
import {
  TargetResultImportPublicCoordinatorError,
  type TargetResultImportPublicResult,
} from "../governance/result/target-result-import-public-coordinator.js";
import {
  TargetResultReviewInspectionPublicContractError,
  WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
} from "../governance/review/target-result-review-inspection-public-contract.js";
import {
  TargetResultReviewInspectionPublicCoordinatorError,
  type TargetResultReviewInspectionPublicResult,
} from "../governance/review/target-result-review-inspection-public-coordinator.js";
import {
  TargetResultReviewResumePublicContractError,
  WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_PUBLIC_TOOL_NAME,
} from "../governance/review/target-result-review-resume-public-contract.js";
import {
  TargetResultReviewResumePublicCoordinatorError,
  type TargetResultReviewResumePublicResult,
} from "../governance/review/target-result-review-resume-public-coordinator.js";
import {
  ControllerImplementationReviewDecisionPublicContractError,
  WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
} from "../governance/review/controller-implementation-review-decision-public-contract.js";
import {
  ControllerImplementationReviewDecisionPublicCoordinatorError,
  type ControllerImplementationReviewDecisionPublicResult,
} from "../governance/review/controller-implementation-review-decision-public-coordinator.js";
import {
  ControllerTestReviewDecisionPublicContractError,
  WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME,
} from "../governance/review/controller-test-review-decision-public-contract.js";
import {
  ControllerTestReviewDecisionPublicCoordinatorError,
  type ControllerTestReviewDecisionPublicResult,
} from "../governance/review/controller-test-review-decision-public-coordinator.js";
import {
  ControllerProductDefectRemediationPublicContractError,
  WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_PUBLIC_TOOL_NAME,
} from "../governance/review/controller-product-defect-remediation-public-contract.js";
import {
  ControllerProductDefectRemediationPublicCoordinatorError,
  type ControllerProductDefectRemediationPublicResult,
} from "../governance/review/controller-product-defect-remediation-public-coordinator.js";
import {
  DemandCompletionPublicContractError,
  WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
} from "../governance/lifecycle/demand-completion-public-contract.js";
import {
  DemandCompletionPublicCoordinatorError,
  type DemandCompletionPublicResult,
} from "../governance/lifecycle/demand-completion-public-coordinator.js";
import {
  DemandPublicationPublicContractError,
  WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME,
} from "../governance/demand/publication/demand-publication-public-contract.js";
import {
  DemandPublicationPublicCoordinatorError,
  type DemandPublicationPublicResult,
} from "../governance/demand/publication/demand-publication-public-coordinator.js";
import {
  DemandControllerRoutePublicContractError,
  WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
} from "../governance/controller/demand-controller-route-public-contract.js";
import {
  DemandControllerRoutePublicCoordinatorError,
  type DemandControllerRoutePublicResult,
} from "../governance/controller/demand-controller-route-public-coordinator.js";
import {
  TestCardPlanningPublicContractError,
  WAKEFLOW_TEST_CARD_PLANNING_PUBLIC_TOOL_NAME,
} from "../governance/testing/test-card-planning-public-contract.js";
import {
  TestCardPlanningPublicCoordinatorError,
  type TestCardPlanningPublicResult,
} from "../governance/testing/test-card-planning-public-coordinator.js";
import {
  TestDeliveryPreparationPublicContractError,
  WAKEFLOW_TEST_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
} from "../governance/testing/test-delivery-preparation-public-contract.js";
import {
  TestDeliveryPreparationPublicCoordinatorError,
  type TestDeliveryPreparationPublicResult,
} from "../governance/testing/test-delivery-preparation-public-coordinator.js";

/**
 * Wakeflow Entrypoint / MCP：官方 MCP SDK 与当前真实公共 owners 之间的薄适配层。
 *
 * JSON Schema 是每个工具的可移植 wire 权威，官方 SDK 负责协议、tools/list、
 * tools/call 与调用前结构校验。领域 owner 仍独立复验容量、关系、根作用域和 mutation
 * authority。当前只发布已闭环的Maintenance、Demand Publication、Demand Controller
 * Route inspection、Window Host Binding registration、Target Task Planning、Implementation Delivery
 * Preparation、Target Host Effect Claim/Outcome/Rearm、TargetResult Import与Controller
 * Implementation/Test Review Decision、Product Defect Remediation、Review/Resume、
 * Demand Completion、TestCard Planning与Test Delivery Preparation；
 * 不注册未来业务占位工具，也不执行窗口创建、
 * 消息发送、Git worktree、BusinessArchive或其他宿主效果。
 */

type WakeflowMaintenanceMcpExecutor = (
  value: unknown,
) => Promise<Readonly<WakeflowMaintenancePublicResult>>;

type WakeflowWindowHostBindingMcpExecutor = (
  value: unknown,
) => Promise<Readonly<WakeflowWindowHostBindingPublicResult>>;

type WakeflowTargetTaskPlanningMcpExecutor = (
  value: unknown,
) => Promise<Readonly<TargetTaskPlanningPublicResult>>;

type WakeflowTargetDeliveryPreparationMcpExecutor = (
  value: unknown,
) => Promise<Readonly<TargetDeliveryPreparationPublicResult>>;

type WakeflowTargetHostEffectClaimMcpExecutor = (
  value: unknown,
) => Promise<Readonly<TargetHostEffectClaimPublicResult>>;

type WakeflowTargetHostEffectOutcomeMcpExecutor = (
  value: unknown,
) => Promise<Readonly<TargetHostEffectOutcomePublicResult>>;

type WakeflowTargetHostEffectRearmMcpExecutor = (
  value: unknown,
) => Promise<Readonly<TargetHostEffectRearmPublicResult>>;

type WakeflowTargetResultImportMcpExecutor = (
  value: unknown,
) => Promise<Readonly<TargetResultImportPublicResult>>;

type WakeflowTargetResultReviewInspectionMcpExecutor = (
  value: unknown,
) => Promise<Readonly<TargetResultReviewInspectionPublicResult>>;

type WakeflowTargetResultReviewResumeMcpExecutor = (
  value: unknown,
) => Promise<Readonly<TargetResultReviewResumePublicResult>>;

type WakeflowControllerImplementationReviewDecisionMcpExecutor = (
  value: unknown,
) => Promise<Readonly<ControllerImplementationReviewDecisionPublicResult>>;

type WakeflowControllerTestReviewDecisionMcpExecutor = (
  value: unknown,
) => Promise<Readonly<ControllerTestReviewDecisionPublicResult>>;

type WakeflowControllerProductDefectRemediationMcpExecutor = (
  value: unknown,
) => Promise<Readonly<ControllerProductDefectRemediationPublicResult>>;

type WakeflowDemandCompletionMcpExecutor = (
  value: unknown,
) => Promise<Readonly<DemandCompletionPublicResult>>;

type WakeflowDemandPublicationMcpExecutor = (
  value: unknown,
) => Promise<Readonly<DemandPublicationPublicResult>>;

type WakeflowDemandControllerRouteMcpExecutor = (
  value: unknown,
) => Promise<Readonly<DemandControllerRoutePublicResult>>;

type WakeflowTestCardPlanningMcpExecutor = (
  value: unknown,
) => Promise<Readonly<TestCardPlanningPublicResult>>;

type WakeflowTestDeliveryPreparationMcpExecutor = (
  value: unknown,
) => Promise<Readonly<TestDeliveryPreparationPublicResult>>;

interface CreateWakeflowPublicMcpServerOptions {
  readonly authorizeProductDefectRemediation: WakeflowControllerProductDefectRemediationMcpExecutor;
  readonly serverName: string;
  readonly serverVersion: string;
  readonly claimTargetHostEffect: WakeflowTargetHostEffectClaimMcpExecutor;
  readonly completeDemand: WakeflowDemandCompletionMcpExecutor;
  readonly createDemand: WakeflowDemandPublicationMcpExecutor;
  readonly executeMaintenance: WakeflowMaintenanceMcpExecutor;
  readonly importTargetResult: WakeflowTargetResultImportMcpExecutor;
  readonly inspectDemandRoute: WakeflowDemandControllerRouteMcpExecutor;
  readonly inspectTargetResultReview: WakeflowTargetResultReviewInspectionMcpExecutor;
  readonly resumeTargetResultReview: WakeflowTargetResultReviewResumeMcpExecutor;
  readonly planTargetTask: WakeflowTargetTaskPlanningMcpExecutor;
  readonly planTestCard: WakeflowTestCardPlanningMcpExecutor;
  readonly prepareImplementationDelivery: WakeflowTargetDeliveryPreparationMcpExecutor;
  readonly prepareTestDelivery: WakeflowTestDeliveryPreparationMcpExecutor;
  readonly recordTargetHostEffectOutcome: WakeflowTargetHostEffectOutcomeMcpExecutor;
  readonly rearmTargetHostEffect: WakeflowTargetHostEffectRearmMcpExecutor;
  readonly recordControllerImplementationReviewDecision: WakeflowControllerImplementationReviewDecisionMcpExecutor;
  readonly recordControllerTestReviewDecision: WakeflowControllerTestReviewDecisionMcpExecutor;
  readonly registerWindowHostBinding: WakeflowWindowHostBindingMcpExecutor;
}

type WakeflowPublicMcpServerConfigurationErrorReason =
  | "options"
  | "server-name"
  | "server-version"
  | "target-host-effect-claim-executor"
  | "target-host-effect-outcome-executor"
  | "target-host-effect-rearm-executor"
  | "target-result-import-executor"
  | "target-result-review-inspection-executor"
  | "target-result-review-resume-executor"
  | "controller-implementation-review-decision-executor"
  | "controller-test-review-decision-executor"
  | "controller-product-defect-remediation-executor"
  | "demand-completion-executor"
  | "demand-publication-executor"
  | "maintenance-executor"
  | "demand-controller-route-executor"
  | "target-task-planning-executor"
  | "test-card-planning-executor"
  | "test-delivery-preparation-executor"
  | "target-delivery-preparation-executor"
  | "window-host-binding-executor";

const CONFIGURATION_ERROR_MESSAGES = {
  options: "Wakeflow MCP server options are invalid.",
  "server-name": "Wakeflow MCP server name is invalid.",
  "server-version": "Wakeflow MCP server version is invalid.",
  "target-host-effect-claim-executor":
    "Wakeflow MCP Target Host Effect Claim executor is invalid.",
  "target-host-effect-outcome-executor":
    "Wakeflow MCP Target Host Effect Outcome executor is invalid.",
  "target-host-effect-rearm-executor":
    "Wakeflow MCP Target Host Effect Rearm executor is invalid.",
  "target-result-import-executor":
    "Wakeflow MCP TargetResult Import executor is invalid.",
  "target-result-review-inspection-executor":
    "Wakeflow MCP Target Result Review inspection executor is invalid.",
  "target-result-review-resume-executor":
    "Wakeflow MCP Target Result Review Resume executor is invalid.",
  "controller-implementation-review-decision-executor":
    "Wakeflow MCP Controller Implementation Review Decision executor is invalid.",
  "controller-test-review-decision-executor":
    "Wakeflow MCP Controller Test Review Decision executor is invalid.",
  "controller-product-defect-remediation-executor":
    "Wakeflow MCP Controller Product Defect Remediation executor is invalid.",
  "demand-completion-executor":
    "Wakeflow MCP Demand Completion executor is invalid.",
  "demand-publication-executor":
    "Wakeflow MCP Demand Publication executor is invalid.",
  "maintenance-executor": "Wakeflow MCP Maintenance executor is invalid.",
  "demand-controller-route-executor":
    "Wakeflow MCP Demand Controller Route executor is invalid.",
  "target-task-planning-executor":
    "Wakeflow MCP Target Task Planning executor is invalid.",
  "test-card-planning-executor":
    "Wakeflow MCP TestCard Planning executor is invalid.",
  "test-delivery-preparation-executor":
    "Wakeflow MCP Test Delivery Preparation executor is invalid.",
  "target-delivery-preparation-executor":
    "Wakeflow MCP Target Delivery Preparation executor is invalid.",
  "window-host-binding-executor":
    "Wakeflow MCP Window Host Binding executor is invalid.",
} as const satisfies Readonly<
  Record<WakeflowPublicMcpServerConfigurationErrorReason, string>
>;

/** MCP composition root 配置无效时返回的稳定错误。 */
export class WakeflowPublicMcpServerConfigurationError extends Error {
  override readonly name = "WakeflowPublicMcpServerConfigurationError";
  readonly code = "wakeflow-public-mcp-server-configuration" as const;
  readonly reason: WakeflowPublicMcpServerConfigurationErrorReason;

  constructor(reason: WakeflowPublicMcpServerConfigurationErrorReason) {
    super(CONFIGURATION_ERROR_MESSAGES[reason]);
    this.reason = reason;
  }
}

interface WakeflowMcpErrorEnvelope {
  readonly kind: "WakeflowMcpError";
  readonly schemaVersion: 1;
  readonly tool: string;
  readonly status: "error";
  readonly error: Readonly<{
    readonly code: string;
    readonly reason: string;
    readonly path?: string;
    readonly causeCode?: string;
    readonly causeReason?: string;
    readonly operationId?: string;
    readonly bindingAuthority?: "unchanged" | "current" | "unknown";
    readonly claimAuthority?: "unchanged" | "current" | "released" | "unknown";
    readonly eventAuthority?: "unchanged" | "current" | "unknown";
    readonly publicationAuthority?:
      | "unchanged"
      | "recoverable"
      | "current"
      | "unknown";
  }>;
}

function failConfiguration(
  reason: WakeflowPublicMcpServerConfigurationErrorReason,
): never {
  throw new WakeflowPublicMcpServerConfigurationError(reason);
}

function nonEmptyText(
  value: unknown,
  reason: "server-name" | "server-version",
) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    value.trim() !== value ||
    !value.isWellFormed() ||
    value.normalize("NFC") !== value ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    failConfiguration(reason);
  }
  return value;
}

function parseServerOptions(
  value: unknown,
): Readonly<CreateWakeflowPublicMcpServerOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) failConfiguration("options");
    throw error;
  }
  const fields = Object.freeze([
    "authorizeProductDefectRemediation",
    "claimTargetHostEffect",
    "completeDemand",
    "createDemand",
    "executeMaintenance",
    "importTargetResult",
    "inspectDemandRoute",
    "inspectTargetResultReview",
    "planTargetTask",
    "planTestCard",
    "prepareImplementationDelivery",
    "prepareTestDelivery",
    "rearmTargetHostEffect",
    "recordControllerImplementationReviewDecision",
    "recordControllerTestReviewDecision",
    "recordTargetHostEffectOutcome",
    "registerWindowHostBinding",
    "resumeTargetResultReview",
    "serverName",
    "serverVersion",
  ] as const);
  const keys = Object.keys(record).sort();
  if (
    keys.length !== fields.length ||
    keys.some((key, index) => key !== fields[index])
  ) {
    failConfiguration("options");
  }
  const serverName = nonEmptyText(record.serverName, "server-name");
  const serverVersion = nonEmptyText(record.serverVersion, "server-version");
  if (
    typeof record.authorizeProductDefectRemediation !== "function" ||
    types.isProxy(record.authorizeProductDefectRemediation)
  ) {
    failConfiguration("controller-product-defect-remediation-executor");
  }
  if (
    typeof record.claimTargetHostEffect !== "function" ||
    types.isProxy(record.claimTargetHostEffect)
  ) {
    failConfiguration("target-host-effect-claim-executor");
  }
  if (
    typeof record.completeDemand !== "function" ||
    types.isProxy(record.completeDemand)
  ) {
    failConfiguration("demand-completion-executor");
  }
  if (
    typeof record.createDemand !== "function" ||
    types.isProxy(record.createDemand)
  ) {
    failConfiguration("demand-publication-executor");
  }
  if (
    typeof record.executeMaintenance !== "function" ||
    types.isProxy(record.executeMaintenance)
  ) {
    failConfiguration("maintenance-executor");
  }
  if (
    typeof record.importTargetResult !== "function" ||
    types.isProxy(record.importTargetResult)
  ) {
    failConfiguration("target-result-import-executor");
  }
  if (
    typeof record.inspectDemandRoute !== "function" ||
    types.isProxy(record.inspectDemandRoute)
  ) {
    failConfiguration("demand-controller-route-executor");
  }
  if (
    typeof record.inspectTargetResultReview !== "function" ||
    types.isProxy(record.inspectTargetResultReview)
  ) {
    failConfiguration("target-result-review-inspection-executor");
  }
  if (
    typeof record.resumeTargetResultReview !== "function" ||
    types.isProxy(record.resumeTargetResultReview)
  ) {
    failConfiguration("target-result-review-resume-executor");
  }
  if (
    typeof record.planTargetTask !== "function" ||
    types.isProxy(record.planTargetTask)
  ) {
    failConfiguration("target-task-planning-executor");
  }
  if (
    typeof record.planTestCard !== "function" ||
    types.isProxy(record.planTestCard)
  ) {
    failConfiguration("test-card-planning-executor");
  }
  if (
    typeof record.prepareImplementationDelivery !== "function" ||
    types.isProxy(record.prepareImplementationDelivery)
  ) {
    failConfiguration("target-delivery-preparation-executor");
  }
  if (
    typeof record.prepareTestDelivery !== "function" ||
    types.isProxy(record.prepareTestDelivery)
  ) {
    failConfiguration("test-delivery-preparation-executor");
  }
  if (
    typeof record.rearmTargetHostEffect !== "function" ||
    types.isProxy(record.rearmTargetHostEffect)
  ) {
    failConfiguration("target-host-effect-rearm-executor");
  }
  if (
    typeof record.recordControllerImplementationReviewDecision !== "function" ||
    types.isProxy(record.recordControllerImplementationReviewDecision)
  ) {
    failConfiguration("controller-implementation-review-decision-executor");
  }
  if (
    typeof record.recordControllerTestReviewDecision !== "function" ||
    types.isProxy(record.recordControllerTestReviewDecision)
  ) {
    failConfiguration("controller-test-review-decision-executor");
  }
  if (
    typeof record.recordTargetHostEffectOutcome !== "function" ||
    types.isProxy(record.recordTargetHostEffectOutcome)
  ) {
    failConfiguration("target-host-effect-outcome-executor");
  }
  if (
    typeof record.registerWindowHostBinding !== "function" ||
    types.isProxy(record.registerWindowHostBinding)
  ) {
    failConfiguration("window-host-binding-executor");
  }
  return Object.freeze({
    serverName,
    serverVersion,
    authorizeProductDefectRemediation:
      record.authorizeProductDefectRemediation as WakeflowControllerProductDefectRemediationMcpExecutor,
    claimTargetHostEffect:
      record.claimTargetHostEffect as WakeflowTargetHostEffectClaimMcpExecutor,
    completeDemand:
      record.completeDemand as WakeflowDemandCompletionMcpExecutor,
    createDemand:
      record.createDemand as WakeflowDemandPublicationMcpExecutor,
    executeMaintenance:
      record.executeMaintenance as WakeflowMaintenanceMcpExecutor,
    importTargetResult:
      record.importTargetResult as WakeflowTargetResultImportMcpExecutor,
    inspectDemandRoute:
      record.inspectDemandRoute as WakeflowDemandControllerRouteMcpExecutor,
    inspectTargetResultReview:
      record.inspectTargetResultReview as WakeflowTargetResultReviewInspectionMcpExecutor,
    resumeTargetResultReview:
      record.resumeTargetResultReview as WakeflowTargetResultReviewResumeMcpExecutor,
    planTargetTask:
      record.planTargetTask as WakeflowTargetTaskPlanningMcpExecutor,
    planTestCard: record.planTestCard as WakeflowTestCardPlanningMcpExecutor,
    prepareImplementationDelivery:
      record.prepareImplementationDelivery as WakeflowTargetDeliveryPreparationMcpExecutor,
    prepareTestDelivery:
      record.prepareTestDelivery as WakeflowTestDeliveryPreparationMcpExecutor,
    rearmTargetHostEffect:
      record.rearmTargetHostEffect as WakeflowTargetHostEffectRearmMcpExecutor,
    recordControllerImplementationReviewDecision:
      record.recordControllerImplementationReviewDecision as WakeflowControllerImplementationReviewDecisionMcpExecutor,
    recordControllerTestReviewDecision:
      record.recordControllerTestReviewDecision as WakeflowControllerTestReviewDecisionMcpExecutor,
    recordTargetHostEffectOutcome:
      record.recordTargetHostEffectOutcome as WakeflowTargetHostEffectOutcomeMcpExecutor,
    registerWindowHostBinding:
      record.registerWindowHostBinding as WakeflowWindowHostBindingMcpExecutor,
  });
}

function maintenanceError(error: unknown) {
  if (error instanceof WakeflowMaintenancePublicContractError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      path: error.path,
    });
  }
  if (error instanceof WakeflowMaintenancePublicCoordinatorError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      ...(error.causeCode === null ? {} : { causeCode: error.causeCode }),
      ...(error.operationId === null ? {} : { operationId: error.operationId }),
    });
  }
  return null;
}

function windowHostBindingError(error: unknown) {
  if (error instanceof WakeflowWindowHostBindingPublicContractError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      path: error.path,
    });
  }
  if (error instanceof WakeflowWindowHostBindingPublicCoordinatorError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      ...(error.causeCode === null ? {} : { causeCode: error.causeCode }),
      ...(error.causeReason === null ? {} : { causeReason: error.causeReason }),
      bindingAuthority: error.bindingAuthority,
    });
  }
  return null;
}

function targetTaskPlanningError(error: unknown) {
  if (error instanceof TargetTaskPlanningPublicContractError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      path: error.path,
    });
  }
  if (error instanceof TargetTaskPlanningPublicCoordinatorError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      ...(error.causeCode === null ? {} : { causeCode: error.causeCode }),
      ...(error.causeReason === null ? {} : { causeReason: error.causeReason }),
      eventAuthority: error.eventAuthority,
    });
  }
  return null;
}

function testCardPlanningError(error: unknown) {
  if (error instanceof TestCardPlanningPublicContractError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      path: error.path,
    });
  }
  if (error instanceof TestCardPlanningPublicCoordinatorError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      ...(error.causeCode === null ? {} : { causeCode: error.causeCode }),
      ...(error.causeReason === null ? {} : { causeReason: error.causeReason }),
      eventAuthority: error.eventAuthority,
    });
  }
  return null;
}

function testDeliveryPreparationError(error: unknown) {
  if (error instanceof TestDeliveryPreparationPublicContractError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      path: error.path,
    });
  }
  if (error instanceof TestDeliveryPreparationPublicCoordinatorError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      ...(error.causeCode === null ? {} : { causeCode: error.causeCode }),
      ...(error.causeReason === null ? {} : { causeReason: error.causeReason }),
      eventAuthority: error.eventAuthority,
    });
  }
  return null;
}

function targetDeliveryPreparationError(error: unknown) {
  if (error instanceof TargetDeliveryPreparationPublicContractError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      path: error.path,
    });
  }
  if (error instanceof TargetDeliveryPreparationPublicCoordinatorError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      ...(error.causeCode === null ? {} : { causeCode: error.causeCode }),
      ...(error.causeReason === null ? {} : { causeReason: error.causeReason }),
      eventAuthority: error.eventAuthority,
    });
  }
  return null;
}

function targetHostEffectClaimError(error: unknown) {
  if (error instanceof TargetHostEffectClaimPublicContractError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      path: error.path,
    });
  }
  if (error instanceof TargetHostEffectClaimPublicCoordinatorError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      ...(error.causeCode === null ? {} : { causeCode: error.causeCode }),
      ...(error.causeReason === null ? {} : { causeReason: error.causeReason }),
      claimAuthority: error.claimAuthority,
      eventAuthority: error.eventAuthority,
    });
  }
  return null;
}

function targetHostEffectOutcomeError(error: unknown) {
  if (error instanceof TargetHostEffectOutcomePublicContractError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      path: error.path,
    });
  }
  if (error instanceof TargetHostEffectOutcomePublicCoordinatorError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      ...(error.causeCode === null ? {} : { causeCode: error.causeCode }),
      ...(error.causeReason === null ? {} : { causeReason: error.causeReason }),
      claimAuthority: error.claimAuthority,
      eventAuthority: error.eventAuthority,
    });
  }
  return null;
}

function targetHostEffectRearmError(error: unknown) {
  if (error instanceof TargetHostEffectRearmPublicContractError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      path: error.path,
    });
  }
  if (error instanceof TargetHostEffectRearmPublicCoordinatorError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      ...(error.causeCode === null ? {} : { causeCode: error.causeCode }),
      ...(error.causeReason === null ? {} : { causeReason: error.causeReason }),
      eventAuthority: error.eventAuthority,
    });
  }
  return null;
}

function targetResultImportError(error: unknown) {
  if (error instanceof TargetResultImportPublicContractError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      path: error.path,
    });
  }
  if (error instanceof TargetResultImportPublicCoordinatorError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      ...(error.causeCode === null ? {} : { causeCode: error.causeCode }),
      ...(error.causeReason === null ? {} : { causeReason: error.causeReason }),
      claimAuthority: error.claimAuthority,
      eventAuthority: error.eventAuthority,
    });
  }
  return null;
}

function targetResultReviewInspectionError(error: unknown) {
  if (error instanceof TargetResultReviewInspectionPublicContractError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      path: error.path,
    });
  }
  if (error instanceof TargetResultReviewInspectionPublicCoordinatorError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      ...(error.causeCode === null ? {} : { causeCode: error.causeCode }),
      ...(error.causeReason === null ? {} : { causeReason: error.causeReason }),
    });
  }
  return null;
}

function targetResultReviewResumeError(error: unknown) {
  if (error instanceof TargetResultReviewResumePublicContractError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      path: error.path,
    });
  }
  if (error instanceof TargetResultReviewResumePublicCoordinatorError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      ...(error.causeCode === null ? {} : { causeCode: error.causeCode }),
      ...(error.causeReason === null ? {} : { causeReason: error.causeReason }),
      eventAuthority: error.eventAuthority,
    });
  }
  return null;
}

function controllerImplementationReviewDecisionError(error: unknown) {
  if (
    error instanceof ControllerImplementationReviewDecisionPublicContractError
  ) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      path: error.path,
    });
  }
  if (
    error instanceof
    ControllerImplementationReviewDecisionPublicCoordinatorError
  ) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      ...(error.causeCode === null ? {} : { causeCode: error.causeCode }),
      ...(error.causeReason === null ? {} : { causeReason: error.causeReason }),
      eventAuthority: error.eventAuthority,
    });
  }
  return null;
}

function controllerTestReviewDecisionError(error: unknown) {
  if (error instanceof ControllerTestReviewDecisionPublicContractError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      path: error.path,
    });
  }
  if (error instanceof ControllerTestReviewDecisionPublicCoordinatorError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      ...(error.causeCode === null ? {} : { causeCode: error.causeCode }),
      ...(error.causeReason === null ? {} : { causeReason: error.causeReason }),
      eventAuthority: error.eventAuthority,
    });
  }
  return null;
}

function controllerProductDefectRemediationError(error: unknown) {
  if (error instanceof ControllerProductDefectRemediationPublicContractError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      path: error.path,
    });
  }
  if (
    error instanceof ControllerProductDefectRemediationPublicCoordinatorError
  ) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      ...(error.causeCode === null ? {} : { causeCode: error.causeCode }),
      ...(error.causeReason === null ? {} : { causeReason: error.causeReason }),
      eventAuthority: error.eventAuthority,
    });
  }
  return null;
}

function demandPublicationError(error: unknown) {
  if (error instanceof DemandPublicationPublicContractError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      path: error.path,
    });
  }
  if (error instanceof DemandPublicationPublicCoordinatorError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      ...(error.causeCode === null ? {} : { causeCode: error.causeCode }),
      ...(error.causeReason === null ? {} : { causeReason: error.causeReason }),
      publicationAuthority: error.publicationAuthority,
    });
  }
  return null;
}

function demandCompletionError(error: unknown) {
  if (error instanceof DemandCompletionPublicContractError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      path: error.path,
    });
  }
  if (error instanceof DemandCompletionPublicCoordinatorError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      ...(error.causeCode === null ? {} : { causeCode: error.causeCode }),
      ...(error.causeReason === null ? {} : { causeReason: error.causeReason }),
      eventAuthority: error.eventAuthority,
    });
  }
  return null;
}

function demandControllerRouteError(error: unknown) {
  if (error instanceof DemandControllerRoutePublicContractError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      path: error.path,
    });
  }
  if (error instanceof DemandControllerRoutePublicCoordinatorError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      ...(error.causeCode === null ? {} : { causeCode: error.causeCode }),
      ...(error.causeReason === null ? {} : { causeReason: error.causeReason }),
    });
  }
  return null;
}

function errorEnvelope(tool: string, error: unknown): WakeflowMcpErrorEnvelope {
  const known =
    maintenanceError(error) ??
    windowHostBindingError(error) ??
    targetTaskPlanningError(error) ??
    testCardPlanningError(error) ??
    testDeliveryPreparationError(error) ??
    targetDeliveryPreparationError(error) ??
    targetHostEffectClaimError(error) ??
    targetHostEffectOutcomeError(error) ??
    targetHostEffectRearmError(error) ??
    targetResultImportError(error) ??
    targetResultReviewInspectionError(error) ??
    targetResultReviewResumeError(error) ??
    controllerImplementationReviewDecisionError(error) ??
    controllerTestReviewDecisionError(error) ??
    controllerProductDefectRemediationError(error) ??
    demandPublicationError(error) ??
    demandCompletionError(error) ??
    demandControllerRouteError(error);
  return Object.freeze({
    kind: "WakeflowMcpError",
    schemaVersion: 1,
    tool,
    status: "error",
    error:
      known ??
      Object.freeze({
        code: "wakeflow-unexpected",
        reason: "unexpected",
      }),
  });
}

function failedToolResult(tool: string, error: unknown): CallToolResult {
  const envelope = errorEnvelope(tool, error);
  return {
    content: [
      {
        type: "text",
        text: canonicalizeJson(envelope, "$mcpError"),
      },
    ],
    isError: true,
  };
}

/**
 * 把领域层的无原型JSON快照转换为MCP SDK可移植的标准JSON对象。
 * 文本与structuredContent共享同一Canonical JSON事实，避免两份独立投影漂移。
 */
function successfulToolResult(value: unknown): CallToolResult {
  const text = canonicalizeJson(value, "$result");
  const structuredContent: unknown = JSON.parse(text);
  if (
    structuredContent === null ||
    Array.isArray(structuredContent) ||
    typeof structuredContent !== "object"
  ) {
    throw new TypeError("Wakeflow MCP structured result must be an object.");
  }
  return {
    content: [{ type: "text", text }],
    structuredContent: structuredContent as Record<string, unknown>,
  };
}

/** 创建只注册当前十八个真实公共工具的官方 MCP server 实例。 */
export function createWakeflowPublicMcpServer(
  options: Readonly<CreateWakeflowPublicMcpServerOptions>,
): McpServer {
  const admitted = parseServerOptions(options);

  const server = new McpServer(
    {
      name: admitted.serverName,
      version: admitted.serverVersion,
    },
    {
      instructions: [
        `Call ${WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME} in preview mode before apply.`,
        "Apply must return the exact confirmation and digest produced by that preview.",
        "Wakeflow never performs host effects: the Agent executes each returned window launch intent with host capabilities.",
        `After a host window is created, pass its exact opaque result to ${WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME}.`,
        `To publish a pending TODO as a Demand, call ${WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME} in preview mode with only authored Demand text, placement, and selected Ledger members; review the complete owner-derived plan, then apply that exact plan and digest.`,
        `Only call ${WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME} in recover mode when the failed exact operation reports publicationAuthority=recoverable. After apply or recovery is current, inspect the new Demand Route.`,
        `Call ${WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME} to inspect the current Demand responsibility frontiers before selecting a domain owner.`,
        "A Demand Controller Route is a read-only observation, never mutation authority or Controller acceptance.",
        `Only when the Route selects Test Card Planning may the Controller call ${WAKEFLOW_TEST_CARD_PLANNING_PUBLIC_TOOL_NAME} in preview mode, review the complete frozen Card/Event plan, then apply that exact plan and digest.`,
        "The Controller copies only the confirmed Test environment and requirement-stage plan into the authored Card fields; Wakeflow derives Test Basis, environment Authority, accepted implementation baselines, Test Window, generation source, time, and Event identities.",
        "TestCard Planning only appends the immutable Card Event. It never creates a Test Task, prepares Delivery, runs Test, performs a host effect, or grants a Test conclusion; inspect the Route again after apply.",
        `When the Route selects Implementation Task Planning, call ${WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME} in preview mode with the complete Controller-authored implementation package content, review the plan, then apply that exact plan and digest.`,
        `When the Route selects Test Task Planning, call the same ${WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME} with only taskPackage={workType:"test"}; Wakeflow derives the entire Test TaskPackage from the current TestCard, and the caller must not re-author its assignment, objective, Authority, boundaries, or completion expectations.`,
        `When the Route selects Test Delivery Planning, call ${WAKEFLOW_TEST_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME} in preview mode with only the Demand and Test Target identity, review the owner-derived initial, rerun, or rejected-before-effect replacement Intent, then apply that exact plan and digest.`,
        "Test Delivery mode and lineage come only from the current Route, Aggregate, and Event history; the preview request must not echo a mode, prior attempt, Result, Decision, Delivery, Claim, or Observation, while apply must return the exact preview plan.",
        `When the Route selects Implementation Delivery Planning, call ${WAKEFLOW_TARGET_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME} in preview mode, review its complete Intent and portable prompt, then apply that exact plan and digest.`,
        "Both Delivery Preparation tools only append their immutable Event; neither creates a Dispatch Packet, acquires a Claim, returns an Agent Host Action, performs a host effect, or sends a message.",
        `When the Route selects an Implementation or Test Host Effect Claim, obtain one fresh target-window observation through the current host and call ${WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_TOOL_NAME}.`,
        "Only status=issued carries a one-shot Agent Host Action; already-claimed never authorizes a send or reissues the Action.",
        `After executing an issued Action at most once and making at most one bounded readback, call ${WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_TOOL_NAME} with that Claim identity and the exact observed facts.`,
        "The Outcome recorder never performs the host effect. accepted, indeterminate, pending, or unavailable facts never authorize another send; only a proved rejected-before-effect outcome may release its Claim for a later explicit owner.",
        `Only when an Implementation Outcome is rejected-before-effect with its exact old Claim released, call ${WAKEFLOW_TARGET_HOST_EFFECT_REARM_PUBLIC_TOOL_NAME} using that Action and Observation identity.`,
        "Rearm only appends the authorization Event for the same immutable Delivery. It never sends, creates a Claim, or returns an Agent Host Action; inspect the Route again and obtain a fresh target-window observation before the next Claim.",
        `When the exact target-authored Agent Report later arrives for an accepted or indeterminate delivery, call ${WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME}; do not synthesize its Report or submit a caller-authored TargetResult.`,
        "TargetResult Import creates the authority-enriched Result and releases its Claim, but the Result remains review input and never means Controller acceptance.",
        `When the Route selects Implementation or Test Result Review, the Controller must first call ${WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME} and inspect the complete current TaskPackage, TargetResult, evidence locators, and prior review history.`,
        `When the Route selects Implementation or Test Review Resume, call ${WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME} again to inspect the current blocked Decision and exact blocked state before asserting that its external condition is resolved.`,
        "Review inspection is read-only and never derives allowed decisions, blocker resolution, Resume, or acceptance. The Controller must independently inspect raw inputs and run fresh checks outside Wakeflow before deciding.",
        `Only the Controller may then call ${WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_PUBLIC_TOOL_NAME} with the exact blocked Event Stream revision/state digest returned by Review Inspection and its explicit resolution summary.`,
        `After ${WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_PUBLIC_TOOL_NAME} succeeds, call ${WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME} again and perform fresh independent checks before recording any new Decision; Resume never reuses the old judgment or creates acceptance.`,
        `Only the Controller may then call ${WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME} with the exact inspected Snapshot/Review-unit/TargetResult identities and its own independent judgment.`,
        "The Decision recorder does not run checks or infer a verdict from the TargetResult. Its committed Decision Event is the only implementation Target acceptance authority; inspect the Route again before any follow-up owner.",
        `Only the Controller may call ${WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME} with the exact inspected Test Snapshot/Review-unit/TargetResult identities and its own independent judgment.`,
        "The Test Decision recorder does not run checks, create another attempt, authorize product remediation, or complete the Demand. Inspect the Route again after its Decision Event is current.",
        `Only when the Route selects Product Defect Remediation Authorization may the Controller call ${WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_PUBLIC_TOOL_NAME} with the exact Test Decision, post-acceptance route digest, affected existing product targets, failed-check mappings, and correction objectives.`,
        "Product Defect Remediation only appends the bounded existing-TaskPackage Authorization Event. It does not create Delivery, execute a fix, let Test modify product code, create the next TestCard, or complete the Demand; inspect the Route again after it succeeds.",
        `Only when the Route selects Demand Completion Preflight, call ${WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME} in preview mode, review the exact terminal plan, then apply that plan and digest.`,
        "Demand Completion appends the successful terminal Event only after all required acceptance, Test closure, claimed TODO, and absent WorkClaim gates pass. It does not archive the TODO or Demand, close host windows, create a BusinessArchive, or perform resource cleanup.",
      ].join(" "),
    },
  );

  server.registerTool(
    WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME,
    {
      title: "Create Wakeflow Demand",
      description: [
        "Preview, apply, or explicitly recover one TODO-backed Demand Event Sourcing publication.",
        "Preview is read-only and derives Program, Demand type, testing, complete Ledger Authority, IDs, time, paths, Event/Commit data, and TODO CAS from current authority.",
        "Apply accepts only the exact preview plan and digest. Recover accepts only a Demand ID with exact durable sidecar evidence.",
        "This tool performs no host effect and returns no machine path or complete business record; inspect the Demand Route after publication is current.",
      ].join(" "),
      inputSchema: fromJsonSchema<WakeflowDemandPublicationRequestV1>(
        WAKEFLOW_DEMAND_PUBLICATION_REQUEST_SCHEMA,
      ),
      outputSchema: fromJsonSchema<WakeflowDemandPublicationResultV1>(
        WAKEFLOW_DEMAND_PUBLICATION_RESULT_SCHEMA,
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (request) => {
      try {
        const result = await admitted.createDemand(request);
        return successfulToolResult(result);
      } catch (error: unknown) {
        return failedToolResult(
          WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME,
          error,
        );
      }
    },
  );

  server.registerTool(
    WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
    {
      title: "Maintain Wakeflow Workspace",
      description: [
        "Preview, apply a confirmed preview, or recover one Wakeflow workspace Maintenance transaction.",
        "Preview is read-only. Apply and recover may mutate Wakeflow-owned local resources.",
        "Returned window launch intents require explicit Agent host actions.",
      ].join(" "),
      inputSchema: fromJsonSchema<WakeflowMaintenancePublicRequestV1>(
        WAKEFLOW_MAINTENANCE_PUBLIC_REQUEST_SCHEMA,
      ),
      outputSchema: fromJsonSchema<WakeflowMaintenancePublicResultV1>(
        WAKEFLOW_MAINTENANCE_PUBLIC_RESULT_SCHEMA,
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (request) => {
      try {
        const result = await admitted.executeMaintenance(request);
        return successfulToolResult(result);
      } catch (error: unknown) {
        return failedToolResult(WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME, error);
      }
    },
  );

  server.registerTool(
    WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
    {
      title: "Inspect Wakeflow Demand Route",
      description: [
        "Inspect one current, read-only Demand Controller Route from the verified Config, Demand Event Stream, Review Snapshot, and Post-Acceptance Route.",
        "The result identifies typed responsibility frontiers and capability blockers without exposing workspace paths, host handles, prompts, or full business records.",
        "This observation never authorizes a mutation, host effect, review decision, or acceptance.",
      ].join(" "),
      inputSchema: fromJsonSchema<WakeflowDemandControllerRouteRequestV1>(
        WAKEFLOW_DEMAND_CONTROLLER_ROUTE_REQUEST_SCHEMA,
      ),
      outputSchema: fromJsonSchema<WakeflowDemandControllerRouteResultV1>(
        WAKEFLOW_DEMAND_CONTROLLER_ROUTE_RESULT_SCHEMA,
      ),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (request) => {
      try {
        const result = await admitted.inspectDemandRoute(request);
        return successfulToolResult(result);
      } catch (error: unknown) {
        return failedToolResult(
          WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
          error,
        );
      }
    },
  );

  server.registerTool(
    WAKEFLOW_TEST_CARD_PLANNING_PUBLIC_TOOL_NAME,
    {
      title: "Plan Wakeflow Test Card",
      description: [
        "Preview or apply one Controller-authored real-environment TestCard only when the current Demand Route selects Test Card Planning.",
        "Preview is read-only and exposes the complete immutable Card/Event plan. Wakeflow derives the frozen Test Basis, environment Authority, accepted implementation baselines, Test Window, generation source, time, and Event identities.",
        "Apply only appends the TestCard Event. It creates no Test Task or Delivery, runs no Test, performs no host effect, and grants no Test conclusion; inspect the Demand Route again after it succeeds.",
      ].join(" "),
      inputSchema: fromJsonSchema<WakeflowTestCardPlanningRequestV1>(
        WAKEFLOW_TEST_CARD_PLANNING_REQUEST_SCHEMA,
      ),
      outputSchema: fromJsonSchema<WakeflowTestCardPlanningResultV1>(
        WAKEFLOW_TEST_CARD_PLANNING_RESULT_SCHEMA,
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (request) => {
      try {
        const result = await admitted.planTestCard(request);
        return successfulToolResult(result);
      } catch (error: unknown) {
        return failedToolResult(
          WAKEFLOW_TEST_CARD_PLANNING_PUBLIC_TOOL_NAME,
          error,
        );
      }
    },
  );

  server.registerTool(
    WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
    {
      title: "Plan Wakeflow Target Task",
      description: [
        "Preview or apply one complete immutable Implementation or Test TaskPackage for an existing Demand.",
        "Implementation preview accepts complete Controller-authored package content. Test preview accepts only workType=test and derives assignment, objective, Authority references, boundaries, completion expectations, Target identity, and TestCard tuple from the current frozen TestCard.",
        "Preview is read-only. Apply revalidates current Config, Demand Authority, TestCard or Ledger references, product WorkClaims, and stream position.",
        "Apply only appends the planning event and materializes its TaskPackage projection; it never performs Delivery or host effects.",
      ].join(" "),
      inputSchema: fromJsonSchema<WakeflowTargetTaskPlanningRequestV1>(
        WAKEFLOW_TARGET_TASK_PLANNING_REQUEST_SCHEMA,
      ),
      outputSchema: fromJsonSchema<WakeflowTargetTaskPlanningResultV1>(
        WAKEFLOW_TARGET_TASK_PLANNING_RESULT_SCHEMA,
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (request) => {
      try {
        const result = await admitted.planTargetTask(request);
        return successfulToolResult(result);
      } catch (error: unknown) {
        return failedToolResult(
          WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
          error,
        );
      }
    },
  );

  server.registerTool(
    WAKEFLOW_TARGET_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
    {
      title: "Prepare Wakeflow Implementation Delivery",
      description: [
        "Preview or apply one immutable Implementation Delivery Preparation plan for a current planned, rework-requested, or product-defect-rework-requested Target.",
        "Preview is read-only and exposes the exact Intent and portable prompt for Controller review. Apply revalidates current Config, Demand, TaskPackage, Binding, and stream authority before appending the preparation Event.",
        "Apply never creates a WindowWorkClaim, returns an Agent Host Action, or performs a host effect; inspect the Demand Route again after it succeeds.",
      ].join(" "),
      inputSchema: fromJsonSchema<WakeflowTargetDeliveryPreparationRequestV1>(
        WAKEFLOW_TARGET_DELIVERY_PREPARATION_REQUEST_SCHEMA,
      ),
      outputSchema: fromJsonSchema<WakeflowTargetDeliveryPreparationResultV1>(
        WAKEFLOW_TARGET_DELIVERY_PREPARATION_RESULT_SCHEMA,
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (request) => {
      try {
        const result = await admitted.prepareImplementationDelivery(request);
        return successfulToolResult(result);
      } catch (error: unknown) {
        return failedToolResult(
          WAKEFLOW_TARGET_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
          error,
        );
      }
    },
  );

  server.registerTool(
    WAKEFLOW_TEST_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
    {
      title: "Prepare Wakeflow Test Delivery",
      description: [
        "Preview or apply one immutable Test Delivery authorization for the current planned, another-attempt-requested, or rejected-before-effect Test Target.",
        "Preview accepts only Demand and Target identity; Wakeflow derives initial, rerun, or replacement mode plus its exact TestCard, attempt, prior review, rejected Host Effect, Binding, and Event lineage from current authority.",
        "Apply revalidates current Config, Route, Aggregate, TaskPackage, TestCard, Binding, lineage, and stream position before appending the preparation Event.",
        "This tool creates no Dispatch Packet or WindowWorkClaim, returns no Agent Host Action, performs no host effect, and runs no Test; inspect the Demand Route again after apply.",
      ].join(" "),
      inputSchema: fromJsonSchema<WakeflowTestDeliveryPreparationRequestV1>(
        WAKEFLOW_TEST_DELIVERY_PREPARATION_REQUEST_SCHEMA,
      ),
      outputSchema: fromJsonSchema<WakeflowTestDeliveryPreparationResultV1>(
        WAKEFLOW_TEST_DELIVERY_PREPARATION_RESULT_SCHEMA,
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (request) => {
      try {
        const result = await admitted.prepareTestDelivery(request);
        return successfulToolResult(result);
      } catch (error: unknown) {
        return failedToolResult(
          WAKEFLOW_TEST_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
          error,
        );
      }
    },
  );

  server.registerTool(
    WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_TOOL_NAME,
    {
      title: "Claim Wakeflow Target Host Effect",
      description: [
        "Acquire or recover one durable cross-Demand window Claim for an exact prepared Implementation or Test Delivery using a fresh Agent host observation.",
        "Only the first committed call returns a transient Agent Host Action. Idempotent replay returns already-claimed with action=null and must never trigger a send.",
        `Wakeflow validates the private Binding and logical root but does not execute the host effect. After executing an issued Action at most once, record the observed fact with ${WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_TOOL_NAME}.`,
      ].join(" "),
      inputSchema: fromJsonSchema<WakeflowTargetHostEffectClaimRequestV1>(
        WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_REQUEST_SCHEMA,
      ),
      outputSchema: fromJsonSchema<WakeflowTargetHostEffectClaimResultV1>(
        WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_RESULT_SCHEMA,
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (request) => {
      try {
        const result = await admitted.claimTargetHostEffect(request);
        return successfulToolResult(result);
      } catch (error: unknown) {
        return failedToolResult(
          WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_TOOL_NAME,
          error,
        );
      }
    },
  );

  server.registerTool(
    WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_TOOL_NAME,
    {
      title: "Record Wakeflow Target Host Effect Outcome",
      description: [
        "Record an already-observed Implementation or Test Target Host Effect attempt and at most one bounded readback; this tool never performs or retries the host effect.",
        "The stored Claim Event derives all target, route, Host observation, and Test lineage fields. Raw evidence is bounded, reduced to Canonical SHA-256 digests, and omitted from the Event and result.",
        "accepted and indeterminate outcomes retain the Claim and never authorize another send. Only a proved rejected-before-effect outcome records its Event before exactly releasing that Claim.",
      ].join(" "),
      inputSchema: fromJsonSchema<WakeflowTargetHostEffectOutcomeRequestV1>(
        WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_REQUEST_SCHEMA,
      ),
      outputSchema: fromJsonSchema<WakeflowTargetHostEffectOutcomeResultV1>(
        WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_RESULT_SCHEMA,
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (request) => {
      try {
        const result = await admitted.recordTargetHostEffectOutcome(request);
        return successfulToolResult(result);
      } catch (error: unknown) {
        return failedToolResult(
          WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_TOOL_NAME,
          error,
        );
      }
    },
  );

  server.registerTool(
    WAKEFLOW_TARGET_HOST_EFFECT_REARM_PUBLIC_TOOL_NAME,
    {
      title: "Rearm Wakeflow Target Host Effect",
      description: [
        "Explicitly rearm one Implementation Target Host Effect only after its stored Outcome proves rejected-before-effect and the exact old Claim is released.",
        "The stored Claim and Observation derive Task, Delivery, Intent, Host, Window, Binding, and Event identity; caller-authored Task or Delivery echoes are rejected.",
        "This tool only appends the Rearm Event for the same immutable Delivery. It never performs the Host effect, creates a Claim, returns an Agent Host Action, or handles Test replacement Delivery.",
      ].join(" "),
      inputSchema: fromJsonSchema<WakeflowTargetHostEffectRearmRequestV1>(
        WAKEFLOW_TARGET_HOST_EFFECT_REARM_REQUEST_SCHEMA,
      ),
      outputSchema: fromJsonSchema<WakeflowTargetHostEffectRearmResultV1>(
        WAKEFLOW_TARGET_HOST_EFFECT_REARM_RESULT_SCHEMA,
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (request) => {
      try {
        const result = await admitted.rearmTargetHostEffect(request);
        return successfulToolResult(result);
      } catch (error: unknown) {
        return failedToolResult(
          WAKEFLOW_TARGET_HOST_EFFECT_REARM_PUBLIC_TOOL_NAME,
          error,
        );
      }
    },
  );

  server.registerTool(
    WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
    {
      title: "Import Wakeflow Target Result",
      description: [
        "Import one exact target-authored Implementation or Test Agent Report after an accepted or indeterminate Host Effect Outcome.",
        "The stored TaskPackage, Delivery, Claim, Observation, repository/window, Test lineage, Result identity, and Event identity are derived by Wakeflow rather than echoed by the caller.",
        "The Result Event is appended before the exact Claim is released. The returned TargetResult is Controller review input only and never Controller acceptance, a Test verdict, or Demand completion.",
      ].join(" "),
      inputSchema: fromJsonSchema<WakeflowTargetResultImportRequestV1>(
        WAKEFLOW_TARGET_RESULT_IMPORT_REQUEST_SCHEMA,
      ),
      outputSchema: fromJsonSchema<WakeflowTargetResultImportResultV1>(
        WAKEFLOW_TARGET_RESULT_IMPORT_RESULT_SCHEMA,
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (request) => {
      try {
        const result = await admitted.importTargetResult(request);
        return successfulToolResult(result);
      } catch (error: unknown) {
        return failedToolResult(
          WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
          error,
        );
      }
    },
  );

  server.registerTool(
    WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
    {
      title: "Inspect Wakeflow Target Result Review",
      description: [
        "Read one current reported or review-blocked Implementation or Test TargetResult review unit from the authoritative Demand Event Stream.",
        "The result includes the complete TaskPackage, authority-enriched TargetResult, evidence locators, source Event receipts, prior review history, exact Snapshot/Review-unit digests, and—only for a blocked unit—the current blocked Controller Decision.",
        "This tool is review input only: it performs no independent checks, decides no blocker resolution, derives no allowed decisions or verdict, and creates no Resume, Controller acceptance, or ReviewCandidate.",
      ].join(" "),
      inputSchema:
        fromJsonSchema<WakeflowTargetResultReviewInspectionRequestV1>(
          WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_REQUEST_SCHEMA,
        ),
      outputSchema:
        fromJsonSchema<WakeflowTargetResultReviewInspectionResultV1>(
          WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_RESULT_SCHEMA,
        ),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (request) => {
      try {
        const result = await admitted.inspectTargetResultReview(request);
        return successfulToolResult(result);
      } catch (error: unknown) {
        return failedToolResult(
          WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
          error,
        );
      }
    },
  );

  server.registerTool(
    WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_PUBLIC_TOOL_NAME,
    {
      title: "Resume Wakeflow Target Result Review",
      description: [
        "Record the Controller's explicit assertion that the external condition blocking one exact current Implementation or Test TargetResult review generation is resolved enough to review again.",
        "The request must use the exact target and blocked Event Stream revision/state digest returned by the current Review Inspection plus a bounded resolution summary. Wakeflow derives the blocked Decision, TargetResult, Snapshot, Controller, Resume, Event, and Commit identities.",
        `This tool only reopens the same TargetResult review. It runs no checks, creates no Test attempt or Delivery, performs no host effect, and grants no accept, rework, redesign, or Test conclusion. Call ${WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME} again and perform fresh independent checks before a new Decision.`,
      ].join(" "),
      inputSchema: fromJsonSchema<WakeflowTargetResultReviewResumeRequestV1>(
        WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_REQUEST_SCHEMA,
      ),
      outputSchema: fromJsonSchema<WakeflowTargetResultReviewResumeResultV1>(
        WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_RESULT_SCHEMA,
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (request) => {
      try {
        const result = await admitted.resumeTargetResultReview(request);
        return successfulToolResult(result);
      } catch (error: unknown) {
        return failedToolResult(
          WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_PUBLIC_TOOL_NAME,
          error,
        );
      }
    },
  );

  server.registerTool(
    WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
    {
      title: "Record Wakeflow Controller Implementation Review Decision",
      description: [
        "Record the Controller's independently established accept, rework, redesign, or blocked judgment for one exact inspected Implementation TargetResult.",
        "The request must carry the current Snapshot, Review-unit, and TargetResult identities returned by Review Inspection plus explicit assessment, independent checks, rationale, blockers, and residual risks.",
        "This tool does not run checks, trust the Target report as truth, dispatch follow-up work, route Design, create Test, or complete the Demand. Its Decision Event is the only implementation Target acceptance authority.",
      ].join(" "),
      inputSchema:
        fromJsonSchema<WakeflowControllerImplementationReviewDecisionRequestV1>(
          WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_REQUEST_SCHEMA,
        ),
      outputSchema:
        fromJsonSchema<WakeflowControllerImplementationReviewDecisionResultV1>(
          WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_RESULT_SCHEMA,
        ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (request) => {
      try {
        const result =
          await admitted.recordControllerImplementationReviewDecision(request);
        return successfulToolResult(result);
      } catch (error: unknown) {
        return failedToolResult(
          WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
          error,
        );
      }
    },
  );

  server.registerTool(
    WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME,
    {
      title: "Record Wakeflow Controller Test Review Decision",
      description: [
        "Record the Controller's independently established accept, request-another-attempt, escalate-product-defect, or blocked judgment for one exact inspected Test TargetResult.",
        "The request must carry the current Snapshot, Review-unit, and TargetResult identities returned by Review Inspection plus explicit assessment, independent checks, rationale, blockers, and residual risks; Target Task and Test lineage are owner-derived.",
        "This tool does not run checks, create another attempt, authorize product remediation, dispatch work, run Test, or complete the Demand. Inspect the Route again after its Decision Event is current.",
      ].join(" "),
      inputSchema:
        fromJsonSchema<WakeflowControllerTestReviewDecisionRequestV1>(
          WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_REQUEST_SCHEMA,
        ),
      outputSchema:
        fromJsonSchema<WakeflowControllerTestReviewDecisionResultV1>(
          WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_RESULT_SCHEMA,
        ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (request) => {
      try {
        const result =
          await admitted.recordControllerTestReviewDecision(request);
        return successfulToolResult(result);
      } catch (error: unknown) {
        return failedToolResult(
          WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME,
          error,
        );
      }
    },
  );

  server.registerTool(
    WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_PUBLIC_TOOL_NAME,
    {
      title: "Authorize Wakeflow Product Defect Remediation",
      description: [
        "Authorize bounded remediation of exact existing Implementation TaskPackage baselines only when the current Demand Route selects Product Defect Remediation Authorization.",
        "The request must carry the exact product-defect Test Decision, post-acceptance Route digest, affected product Target identities, failed-check mappings, correction objectives, and Controller rationale; Wakeflow derives every baseline and Event identity.",
        "This tool does not create Delivery, execute a fix, let Test modify product code, create the next TestCard, or complete the Demand. Inspect the Route again after the Authorization Event is current.",
      ].join(" "),
      inputSchema:
        fromJsonSchema<WakeflowControllerProductDefectRemediationRequestV1>(
          WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_REQUEST_SCHEMA,
        ),
      outputSchema:
        fromJsonSchema<WakeflowControllerProductDefectRemediationResultV1>(
          WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_RESULT_SCHEMA,
        ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (request) => {
      try {
        const result =
          await admitted.authorizeProductDefectRemediation(request);
        return successfulToolResult(result);
      } catch (error: unknown) {
        return failedToolResult(
          WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_PUBLIC_TOOL_NAME,
          error,
        );
      }
    },
  );

  server.registerTool(
    WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
    {
      title: "Complete Wakeflow Demand",
      description: [
        "Preview or apply one exact successful Demand terminal transition only when the current Route selects Demand Completion Preflight.",
        "Preview is read-only and exposes the complete immutable Completion plan for Controller review. Apply revalidates current Config, Demand Authority, accepted Implementation and required Test closure, claimed TODO, absent participating WorkClaims, and Event Stream position before appending the terminal Event.",
        "Completion is not Archive: this tool does not archive or delete the TODO, move the Demand, create a BusinessArchive, close host windows, prune transport, or clean up resources.",
      ].join(" "),
      inputSchema: fromJsonSchema<WakeflowDemandCompletionRequestV1>(
        WAKEFLOW_DEMAND_COMPLETION_REQUEST_SCHEMA,
      ),
      outputSchema: fromJsonSchema<WakeflowDemandCompletionResultV1>(
        WAKEFLOW_DEMAND_COMPLETION_RESULT_SCHEMA,
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (request) => {
      try {
        const result = await admitted.completeDemand(request);
        return successfulToolResult(result);
      } catch (error: unknown) {
        return failedToolResult(
          WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
          error,
        );
      }
    },
  );

  server.registerTool(
    WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
    {
      title: "Register Wakeflow Window Host Binding",
      description: [
        "Register the opaque current-host window identifier observed by the Agent after executing one Wakeflow launch intent.",
        "Wakeflow does not create or inspect the host window.",
        "The private handle is stored in a 0600 Binding authority file and omitted from the result and runtime projection.",
      ].join(" "),
      inputSchema:
        fromJsonSchema<WakeflowWindowHostBindingRegistrationRequestV1>(
          WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_REQUEST_SCHEMA,
        ),
      outputSchema:
        fromJsonSchema<WakeflowWindowHostBindingRegistrationResultV1>(
          WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_RESULT_SCHEMA,
        ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (request) => {
      try {
        const result = await admitted.registerWindowHostBinding(request);
        return successfulToolResult(result);
      } catch (error: unknown) {
        return failedToolResult(
          WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
          error,
        );
      }
    },
  );

  return server;
}
