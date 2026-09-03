import {
  fromJsonSchema,
  type McpServer,
} from "@modelcontextprotocol/server";

import {
  WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_REQUEST_SCHEMA,
  type WakeflowControllerImplementationReviewDecisionRequestV1,
} from "../contracts/generated/entrypoints/wakeflow-controller-implementation-review-decision-request.generated.js";
import {
  WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_RESULT_SCHEMA,
  type WakeflowControllerImplementationReviewDecisionResultV1,
} from "../contracts/generated/entrypoints/wakeflow-controller-implementation-review-decision-result.generated.js";
import {
  WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_REQUEST_SCHEMA,
  type WakeflowControllerProductDefectRemediationRequestV1,
} from "../contracts/generated/entrypoints/wakeflow-controller-product-defect-remediation-request.generated.js";
import {
  WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_RESULT_SCHEMA,
  type WakeflowControllerProductDefectRemediationResultV1,
} from "../contracts/generated/entrypoints/wakeflow-controller-product-defect-remediation-result.generated.js";
import {
  WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_REQUEST_SCHEMA,
  type WakeflowControllerTestReviewDecisionRequestV1,
} from "../contracts/generated/entrypoints/wakeflow-controller-test-review-decision-request.generated.js";
import {
  WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_RESULT_SCHEMA,
  type WakeflowControllerTestReviewDecisionResultV1,
} from "../contracts/generated/entrypoints/wakeflow-controller-test-review-decision-result.generated.js";
import {
  WAKEFLOW_DEMAND_COMPLETION_REQUEST_SCHEMA,
  type WakeflowDemandCompletionRequestV1,
} from "../contracts/generated/entrypoints/wakeflow-demand-completion-request.generated.js";
import {
  WAKEFLOW_DEMAND_COMPLETION_RESULT_SCHEMA,
  type WakeflowDemandCompletionResultV1,
} from "../contracts/generated/entrypoints/wakeflow-demand-completion-result.generated.js";
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
  DemandCompletionPublicContractError,
  WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
} from "../governance/lifecycle/demand-completion-public-contract.js";
import {
  DemandCompletionPublicCoordinatorError,
  type DemandCompletionPublicResult,
} from "../governance/lifecycle/demand-completion-public-coordinator.js";
import {
  ControllerImplementationReviewDecisionPublicContractError,
  WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
} from "../governance/review/controller-implementation-review-decision-public-contract.js";
import {
  ControllerImplementationReviewDecisionPublicCoordinatorError,
  type ControllerImplementationReviewDecisionPublicResult,
} from "../governance/review/controller-implementation-review-decision-public-coordinator.js";
import {
  ControllerProductDefectRemediationPublicContractError,
  WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_PUBLIC_TOOL_NAME,
} from "../governance/review/controller-product-defect-remediation-public-contract.js";
import {
  ControllerProductDefectRemediationPublicCoordinatorError,
  type ControllerProductDefectRemediationPublicResult,
} from "../governance/review/controller-product-defect-remediation-public-coordinator.js";
import {
  ControllerTestReviewDecisionPublicContractError,
  WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME,
} from "../governance/review/controller-test-review-decision-public-contract.js";
import {
  ControllerTestReviewDecisionPublicCoordinatorError,
  type ControllerTestReviewDecisionPublicResult,
} from "../governance/review/controller-test-review-decision-public-coordinator.js";
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
  registerWakeflowPublicMcpTool,
  type WakeflowPublicMcpErrorDetails,
  type WakeflowPublicMcpExecutor,
} from "./wakeflow-public-mcp-tool.js";

/** Review、Remediation与Completion公共工具所需的executor。 */
export interface WakeflowPublicMcpReviewExecutors {
  readonly authorizeProductDefectRemediation: WakeflowPublicMcpExecutor<ControllerProductDefectRemediationPublicResult>;
  readonly completeDemand: WakeflowPublicMcpExecutor<DemandCompletionPublicResult>;
  readonly inspectTargetResultReview: WakeflowPublicMcpExecutor<TargetResultReviewInspectionPublicResult>;
  readonly recordControllerImplementationReviewDecision: WakeflowPublicMcpExecutor<ControllerImplementationReviewDecisionPublicResult>;
  readonly recordControllerTestReviewDecision: WakeflowPublicMcpExecutor<ControllerTestReviewDecisionPublicResult>;
  readonly resumeTargetResultReview: WakeflowPublicMcpExecutor<TargetResultReviewResumePublicResult>;
}

function reviewInspectionError(
  error: unknown,
): Readonly<WakeflowPublicMcpErrorDetails> | null {
  if (error instanceof TargetResultReviewInspectionPublicContractError) {
    return Object.freeze({ code: error.code, reason: error.reason, path: error.path });
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

function reviewResumeError(
  error: unknown,
): Readonly<WakeflowPublicMcpErrorDetails> | null {
  if (error instanceof TargetResultReviewResumePublicContractError) {
    return Object.freeze({ code: error.code, reason: error.reason, path: error.path });
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

function implementationDecisionError(
  error: unknown,
): Readonly<WakeflowPublicMcpErrorDetails> | null {
  if (error instanceof ControllerImplementationReviewDecisionPublicContractError) {
    return Object.freeze({ code: error.code, reason: error.reason, path: error.path });
  }
  if (error instanceof ControllerImplementationReviewDecisionPublicCoordinatorError) {
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

function testDecisionError(
  error: unknown,
): Readonly<WakeflowPublicMcpErrorDetails> | null {
  if (error instanceof ControllerTestReviewDecisionPublicContractError) {
    return Object.freeze({ code: error.code, reason: error.reason, path: error.path });
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

function remediationError(
  error: unknown,
): Readonly<WakeflowPublicMcpErrorDetails> | null {
  if (error instanceof ControllerProductDefectRemediationPublicContractError) {
    return Object.freeze({ code: error.code, reason: error.reason, path: error.path });
  }
  if (error instanceof ControllerProductDefectRemediationPublicCoordinatorError) {
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

function demandCompletionError(
  error: unknown,
): Readonly<WakeflowPublicMcpErrorDetails> | null {
  if (error instanceof DemandCompletionPublicContractError) {
    return Object.freeze({ code: error.code, reason: error.reason, path: error.path });
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

/** 注册只读Review输入、Controller决定、Remediation与Completion工具。 */
export function registerWakeflowPublicMcpReviewTools(
  server: McpServer,
  executors: Readonly<WakeflowPublicMcpReviewExecutors>,
): void {
  registerWakeflowPublicMcpTool<
    WakeflowTargetResultReviewInspectionRequestV1,
    WakeflowTargetResultReviewInspectionResultV1
  >(server, {
    name: WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
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
    execute: executors.inspectTargetResultReview,
    mapError: reviewInspectionError,
  });

  registerWakeflowPublicMcpTool<
    WakeflowTargetResultReviewResumeRequestV1,
    WakeflowTargetResultReviewResumeResultV1
  >(server, {
    name: WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_PUBLIC_TOOL_NAME,
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
    execute: executors.resumeTargetResultReview,
    mapError: reviewResumeError,
  });

  registerWakeflowPublicMcpTool<
    WakeflowControllerImplementationReviewDecisionRequestV1,
    WakeflowControllerImplementationReviewDecisionResultV1
  >(server, {
    name: WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
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
    execute: executors.recordControllerImplementationReviewDecision,
    mapError: implementationDecisionError,
  });

  registerWakeflowPublicMcpTool<
    WakeflowControllerTestReviewDecisionRequestV1,
    WakeflowControllerTestReviewDecisionResultV1
  >(server, {
    name: WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME,
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
    execute: executors.recordControllerTestReviewDecision,
    mapError: testDecisionError,
  });

  registerWakeflowPublicMcpTool<
    WakeflowControllerProductDefectRemediationRequestV1,
    WakeflowControllerProductDefectRemediationResultV1
  >(server, {
    name: WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_PUBLIC_TOOL_NAME,
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
    execute: executors.authorizeProductDefectRemediation,
    mapError: remediationError,
  });

  registerWakeflowPublicMcpTool<
    WakeflowDemandCompletionRequestV1,
    WakeflowDemandCompletionResultV1
  >(server, {
    name: WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
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
    execute: executors.completeDemand,
    mapError: demandCompletionError,
  });
}
