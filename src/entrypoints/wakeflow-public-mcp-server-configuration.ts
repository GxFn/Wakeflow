import { types } from "node:util";

import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../foundation/data/passive-own-data.js";
import type { WakeflowPublicMcpAuthorityExecutors } from "./wakeflow-public-mcp-authority-tools.js";
import type { WakeflowPublicMcpExecutionExecutors } from "./wakeflow-public-mcp-execution-tools.js";
import type { WakeflowPublicMcpReviewExecutors } from "./wakeflow-public-mcp-review-tools.js";
import type { WakeflowPublicMcpWorkspaceExecutors } from "./wakeflow-public-mcp-workspace-tools.js";

/** Public Server固定组合所需的完整、关闭依赖集合。 */
export interface CreateWakeflowPublicMcpServerOptions
  extends WakeflowPublicMcpAuthorityExecutors,
    WakeflowPublicMcpExecutionExecutors,
    WakeflowPublicMcpReviewExecutors,
    WakeflowPublicMcpWorkspaceExecutors {
  readonly serverName: string;
  readonly serverVersion: string;
}

export type WakeflowPublicMcpServerConfigurationErrorReason =
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
  | "managed-evidence-executor"
  | "confirmation-publication-executor"
  | "requirement-publication-executor"
  | "maintenance-executor"
  | "demand-controller-route-executor"
  | "todo-inspection-executor"
  | "todo-intake-publication-executor"
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
  "managed-evidence-executor":
    "Wakeflow MCP Managed Evidence executor is invalid.",
  "confirmation-publication-executor":
    "Wakeflow MCP Confirmation Publication executor is invalid.",
  "requirement-publication-executor":
    "Wakeflow MCP Requirement Publication executor is invalid.",
  "maintenance-executor": "Wakeflow MCP Maintenance executor is invalid.",
  "demand-controller-route-executor":
    "Wakeflow MCP Demand Controller Route executor is invalid.",
  "todo-inspection-executor":
    "Wakeflow MCP TODO Inspection executor is invalid.",
  "todo-intake-publication-executor":
    "Wakeflow MCP TODO Intake Publication executor is invalid.",
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

/** MCP composition root配置无效时返回的稳定错误。 */
export class WakeflowPublicMcpServerConfigurationError extends Error {
  override readonly name = "WakeflowPublicMcpServerConfigurationError";
  readonly code = "wakeflow-public-mcp-server-configuration" as const;
  readonly reason: WakeflowPublicMcpServerConfigurationErrorReason;

  constructor(reason: WakeflowPublicMcpServerConfigurationErrorReason) {
    super(CONFIGURATION_ERROR_MESSAGES[reason]);
    this.reason = reason;
  }
}

function fail(
  reason: WakeflowPublicMcpServerConfigurationErrorReason,
): never {
  throw new WakeflowPublicMcpServerConfigurationError(reason);
}

function nonEmptyText(
  value: unknown,
  reason: "server-name" | "server-version",
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    value.trim() !== value ||
    !value.isWellFormed() ||
    value.normalize("NFC") !== value ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    fail(reason);
  }
  return value;
}

function executor<Executor>(
  value: unknown,
  reason: WakeflowPublicMcpServerConfigurationErrorReason,
): Executor {
  if (typeof value !== "function" || types.isProxy(value)) fail(reason);
  return value as Executor;
}

const OPTION_FIELDS = Object.freeze([
  "authorizeProductDefectRemediation",
  "claimTargetHostEffect",
  "completeDemand",
  "createDemand",
  "executeMaintenance",
  "importTargetResult",
  "inspectDemandRoute",
  "inspectTargetResultReview",
  "inspectTodo",
  "intakeTodo",
  "planTargetTask",
  "planTestCard",
  "prepareImplementationDelivery",
  "prepareTestDelivery",
  "publishConfirmation",
  "publishRequirement",
  "rearmTargetHostEffect",
  "recordControllerImplementationReviewDecision",
  "recordControllerTestReviewDecision",
  "recordManagedEvidence",
  "recordTargetHostEffectOutcome",
  "registerWindowHostBinding",
  "resumeTargetResultReview",
  "serverName",
  "serverVersion",
] as const);

/** 严格准入组合根元数据与23个固定executor，不接受Proxy或扩展字段。 */
export function parseCreateWakeflowPublicMcpServerOptions(
  value: unknown,
): Readonly<CreateWakeflowPublicMcpServerOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("options");
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== OPTION_FIELDS.length ||
    keys.some((key, index) => key !== OPTION_FIELDS[index])
  ) {
    fail("options");
  }

  return Object.freeze({
    serverName: nonEmptyText(record.serverName, "server-name"),
    serverVersion: nonEmptyText(record.serverVersion, "server-version"),
    authorizeProductDefectRemediation: executor<
      WakeflowPublicMcpReviewExecutors["authorizeProductDefectRemediation"]
    >(
      record.authorizeProductDefectRemediation,
      "controller-product-defect-remediation-executor",
    ),
    claimTargetHostEffect: executor<
      WakeflowPublicMcpExecutionExecutors["claimTargetHostEffect"]
    >(
      record.claimTargetHostEffect,
      "target-host-effect-claim-executor",
    ),
    completeDemand: executor<WakeflowPublicMcpReviewExecutors["completeDemand"]>(
      record.completeDemand,
      "demand-completion-executor",
    ),
    createDemand: executor<WakeflowPublicMcpAuthorityExecutors["createDemand"]>(
      record.createDemand,
      "demand-publication-executor",
    ),
    executeMaintenance: executor<
      WakeflowPublicMcpWorkspaceExecutors["executeMaintenance"]
    >(
      record.executeMaintenance,
      "maintenance-executor",
    ),
    importTargetResult: executor<
      WakeflowPublicMcpExecutionExecutors["importTargetResult"]
    >(
      record.importTargetResult,
      "target-result-import-executor",
    ),
    inspectDemandRoute: executor<
      WakeflowPublicMcpAuthorityExecutors["inspectDemandRoute"]
    >(
      record.inspectDemandRoute,
      "demand-controller-route-executor",
    ),
    inspectTargetResultReview: executor<
      WakeflowPublicMcpReviewExecutors["inspectTargetResultReview"]
    >(
      record.inspectTargetResultReview,
      "target-result-review-inspection-executor",
    ),
    inspectTodo: executor<WakeflowPublicMcpAuthorityExecutors["inspectTodo"]>(
      record.inspectTodo,
      "todo-inspection-executor",
    ),
    intakeTodo: executor<WakeflowPublicMcpAuthorityExecutors["intakeTodo"]>(
      record.intakeTodo,
      "todo-intake-publication-executor",
    ),
    planTargetTask: executor<
      WakeflowPublicMcpExecutionExecutors["planTargetTask"]
    >(
      record.planTargetTask,
      "target-task-planning-executor",
    ),
    planTestCard: executor<
      WakeflowPublicMcpExecutionExecutors["planTestCard"]
    >(
      record.planTestCard,
      "test-card-planning-executor",
    ),
    prepareImplementationDelivery: executor<
      WakeflowPublicMcpExecutionExecutors["prepareImplementationDelivery"]
    >(
      record.prepareImplementationDelivery,
      "target-delivery-preparation-executor",
    ),
    prepareTestDelivery: executor<
      WakeflowPublicMcpExecutionExecutors["prepareTestDelivery"]
    >(
      record.prepareTestDelivery,
      "test-delivery-preparation-executor",
    ),
    publishConfirmation: executor<
      WakeflowPublicMcpAuthorityExecutors["publishConfirmation"]
    >(
      record.publishConfirmation,
      "confirmation-publication-executor",
    ),
    publishRequirement: executor<
      WakeflowPublicMcpAuthorityExecutors["publishRequirement"]
    >(
      record.publishRequirement,
      "requirement-publication-executor",
    ),
    rearmTargetHostEffect: executor<
      WakeflowPublicMcpExecutionExecutors["rearmTargetHostEffect"]
    >(
      record.rearmTargetHostEffect,
      "target-host-effect-rearm-executor",
    ),
    recordControllerImplementationReviewDecision: executor<
      WakeflowPublicMcpReviewExecutors[
        "recordControllerImplementationReviewDecision"
      ]
    >(
      record.recordControllerImplementationReviewDecision,
      "controller-implementation-review-decision-executor",
    ),
    recordControllerTestReviewDecision: executor<
      WakeflowPublicMcpReviewExecutors["recordControllerTestReviewDecision"]
    >(
      record.recordControllerTestReviewDecision,
      "controller-test-review-decision-executor",
    ),
    recordManagedEvidence: executor<
      WakeflowPublicMcpAuthorityExecutors["recordManagedEvidence"]
    >(
      record.recordManagedEvidence,
      "managed-evidence-executor",
    ),
    recordTargetHostEffectOutcome: executor<
      WakeflowPublicMcpExecutionExecutors["recordTargetHostEffectOutcome"]
    >(
      record.recordTargetHostEffectOutcome,
      "target-host-effect-outcome-executor",
    ),
    registerWindowHostBinding: executor<
      WakeflowPublicMcpWorkspaceExecutors["registerWindowHostBinding"]
    >(
      record.registerWindowHostBinding,
      "window-host-binding-executor",
    ),
    resumeTargetResultReview: executor<
      WakeflowPublicMcpReviewExecutors["resumeTargetResultReview"]
    >(
      record.resumeTargetResultReview,
      "target-result-review-resume-executor",
    ),
  });
}
