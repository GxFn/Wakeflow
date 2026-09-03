import {
  fromJsonSchema,
  type McpServer,
} from "@modelcontextprotocol/server";

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
  WAKEFLOW_TARGET_TASK_PLANNING_REQUEST_SCHEMA,
  type WakeflowTargetTaskPlanningRequestV1,
} from "../contracts/generated/entrypoints/wakeflow-target-task-planning-request.generated.js";
import {
  WAKEFLOW_TARGET_TASK_PLANNING_RESULT_SCHEMA,
  type WakeflowTargetTaskPlanningResultV1,
} from "../contracts/generated/entrypoints/wakeflow-target-task-planning-result.generated.js";
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
  TargetTaskPlanningPublicContractError,
  WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
} from "../governance/tasking/target-task-planning-public-contract.js";
import {
  TargetTaskPlanningPublicCoordinatorError,
  type TargetTaskPlanningPublicResult,
} from "../governance/tasking/target-task-planning-public-coordinator.js";
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
import {
  registerWakeflowPublicMcpTool,
  type WakeflowPublicMcpErrorDetails,
  type WakeflowPublicMcpExecutor,
} from "./wakeflow-public-mcp-tool.js";

/** Task、Delivery、Host Effect与Result公共执行链所需的executor。 */
export interface WakeflowPublicMcpExecutionExecutors {
  readonly claimTargetHostEffect: WakeflowPublicMcpExecutor<TargetHostEffectClaimPublicResult>;
  readonly importTargetResult: WakeflowPublicMcpExecutor<TargetResultImportPublicResult>;
  readonly planTargetTask: WakeflowPublicMcpExecutor<TargetTaskPlanningPublicResult>;
  readonly planTestCard: WakeflowPublicMcpExecutor<TestCardPlanningPublicResult>;
  readonly prepareImplementationDelivery: WakeflowPublicMcpExecutor<TargetDeliveryPreparationPublicResult>;
  readonly prepareTestDelivery: WakeflowPublicMcpExecutor<TestDeliveryPreparationPublicResult>;
  readonly rearmTargetHostEffect: WakeflowPublicMcpExecutor<TargetHostEffectRearmPublicResult>;
  readonly recordTargetHostEffectOutcome: WakeflowPublicMcpExecutor<TargetHostEffectOutcomePublicResult>;
}

function targetTaskPlanningError(
  error: unknown,
): Readonly<WakeflowPublicMcpErrorDetails> | null {
  if (error instanceof TargetTaskPlanningPublicContractError) {
    return Object.freeze({ code: error.code, reason: error.reason, path: error.path });
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

function testCardPlanningError(
  error: unknown,
): Readonly<WakeflowPublicMcpErrorDetails> | null {
  if (error instanceof TestCardPlanningPublicContractError) {
    return Object.freeze({ code: error.code, reason: error.reason, path: error.path });
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

function targetDeliveryPreparationError(
  error: unknown,
): Readonly<WakeflowPublicMcpErrorDetails> | null {
  if (error instanceof TargetDeliveryPreparationPublicContractError) {
    return Object.freeze({ code: error.code, reason: error.reason, path: error.path });
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

function testDeliveryPreparationError(
  error: unknown,
): Readonly<WakeflowPublicMcpErrorDetails> | null {
  if (error instanceof TestDeliveryPreparationPublicContractError) {
    return Object.freeze({ code: error.code, reason: error.reason, path: error.path });
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

function targetHostEffectClaimError(
  error: unknown,
): Readonly<WakeflowPublicMcpErrorDetails> | null {
  if (error instanceof TargetHostEffectClaimPublicContractError) {
    return Object.freeze({ code: error.code, reason: error.reason, path: error.path });
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

function targetHostEffectOutcomeError(
  error: unknown,
): Readonly<WakeflowPublicMcpErrorDetails> | null {
  if (error instanceof TargetHostEffectOutcomePublicContractError) {
    return Object.freeze({ code: error.code, reason: error.reason, path: error.path });
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

function targetHostEffectRearmError(
  error: unknown,
): Readonly<WakeflowPublicMcpErrorDetails> | null {
  if (error instanceof TargetHostEffectRearmPublicContractError) {
    return Object.freeze({ code: error.code, reason: error.reason, path: error.path });
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

function targetResultImportError(
  error: unknown,
): Readonly<WakeflowPublicMcpErrorDetails> | null {
  if (error instanceof TargetResultImportPublicContractError) {
    return Object.freeze({ code: error.code, reason: error.reason, path: error.path });
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

/** 注册Task Planning到TargetResult Import的公共执行工具。 */
export function registerWakeflowPublicMcpExecutionTools(
  server: McpServer,
  executors: Readonly<WakeflowPublicMcpExecutionExecutors>,
): void {
  registerWakeflowPublicMcpTool<
    WakeflowTestCardPlanningRequestV1,
    WakeflowTestCardPlanningResultV1
  >(server, {
    name: WAKEFLOW_TEST_CARD_PLANNING_PUBLIC_TOOL_NAME,
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
    execute: executors.planTestCard,
    mapError: testCardPlanningError,
  });

  registerWakeflowPublicMcpTool<
    WakeflowTargetTaskPlanningRequestV1,
    WakeflowTargetTaskPlanningResultV1
  >(server, {
    name: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
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
    execute: executors.planTargetTask,
    mapError: targetTaskPlanningError,
  });

  registerWakeflowPublicMcpTool<
    WakeflowTargetDeliveryPreparationRequestV1,
    WakeflowTargetDeliveryPreparationResultV1
  >(server, {
    name: WAKEFLOW_TARGET_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
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
    execute: executors.prepareImplementationDelivery,
    mapError: targetDeliveryPreparationError,
  });

  registerWakeflowPublicMcpTool<
    WakeflowTestDeliveryPreparationRequestV1,
    WakeflowTestDeliveryPreparationResultV1
  >(server, {
    name: WAKEFLOW_TEST_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
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
    execute: executors.prepareTestDelivery,
    mapError: testDeliveryPreparationError,
  });

  registerWakeflowPublicMcpTool<
    WakeflowTargetHostEffectClaimRequestV1,
    WakeflowTargetHostEffectClaimResultV1
  >(server, {
    name: WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_TOOL_NAME,
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
    execute: executors.claimTargetHostEffect,
    mapError: targetHostEffectClaimError,
  });

  registerWakeflowPublicMcpTool<
    WakeflowTargetHostEffectOutcomeRequestV1,
    WakeflowTargetHostEffectOutcomeResultV1
  >(server, {
    name: WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_TOOL_NAME,
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
    execute: executors.recordTargetHostEffectOutcome,
    mapError: targetHostEffectOutcomeError,
  });

  registerWakeflowPublicMcpTool<
    WakeflowTargetHostEffectRearmRequestV1,
    WakeflowTargetHostEffectRearmResultV1
  >(server, {
    name: WAKEFLOW_TARGET_HOST_EFFECT_REARM_PUBLIC_TOOL_NAME,
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
    execute: executors.rearmTargetHostEffect,
    mapError: targetHostEffectRearmError,
  });

  registerWakeflowPublicMcpTool<
    WakeflowTargetResultImportRequestV1,
    WakeflowTargetResultImportResultV1
  >(server, {
    name: WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
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
    execute: executors.importTargetResult,
    mapError: targetResultImportError,
  });
}
