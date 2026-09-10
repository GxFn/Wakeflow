import {
  executeBoardInspectionRequest,
  executeRequirementPublicationRequest,
} from "../capabilities/requirement/service.js";
import { executeTargetTaskPlanningPublicRequest } from "../capabilities/tasking/service.js";
import {
  executeDemandCancellationRequest,
  executeDemandCompletionRequest,
  executeDemandContinuationRequest,
} from "../capabilities/demand/lifecycle.js";
import {
  executeDemandCreationRequest,
  executeDemandRouteInspectionRequest,
} from "../capabilities/demand/service.js";
import { executeManagedEvidencePublicRequest } from "../governance/evidence/managed-evidence-public-coordinator.js";
import { executeControllerImplementationReviewDecisionPublicRequest } from "../governance/review/controller-implementation-review-decision-public-coordinator.js";
import { executeControllerProductDefectRemediationPublicRequest } from "../governance/review/controller-product-defect-remediation-public-coordinator.js";
import { executeControllerTestReviewDecisionPublicRequest } from "../governance/review/controller-test-review-decision-public-coordinator.js";
import { executeTargetResultReviewInspectionPublicRequest } from "../governance/review/target-result-review-inspection-public-coordinator.js";
import { executeTargetResultReviewResumePublicRequest } from "../governance/review/target-result-review-resume-public-coordinator.js";
import { executeTestCardPlanningPublicRequest } from "../governance/testing/test-card-planning-public-coordinator.js";
import type { WakeflowPublicMcpExecutors } from "./wakeflow-public-mcp-catalog.js";

/**
 * Wakeflow Entrypoint / MCP：与宿主无关的公共 executor。
 *
 * 这些工具不消费宿主 profile；两个宿主组合根原样复用，只有需要宿主身份或
 * profile 的工具在各自的组合根里绑定 facade。
 */
export const WAKEFLOW_SHARED_PUBLIC_EXECUTORS = Object.freeze({
  authorizeProductDefectRemediation: executeControllerProductDefectRemediationPublicRequest,
  cancelDemand: executeDemandCancellationRequest,
  completeDemand: executeDemandCompletionRequest,
  continueDemand: executeDemandContinuationRequest,
  createDemand: executeDemandCreationRequest,
  inspectDemandRoute: executeDemandRouteInspectionRequest,
  inspectTargetResultReview: executeTargetResultReviewInspectionPublicRequest,
  inspectBoard: executeBoardInspectionRequest,
  planTargetTask: executeTargetTaskPlanningPublicRequest,
  planTestCard: executeTestCardPlanningPublicRequest,
  publishRequirement: executeRequirementPublicationRequest,
  recordControllerImplementationReviewDecision:
    executeControllerImplementationReviewDecisionPublicRequest,
  recordControllerTestReviewDecision: executeControllerTestReviewDecisionPublicRequest,
  recordManagedEvidence: executeManagedEvidencePublicRequest,
  resumeTargetResultReview: executeTargetResultReviewResumePublicRequest,
}) satisfies Readonly<
  Pick<
    WakeflowPublicMcpExecutors,
    | "authorizeProductDefectRemediation"
    | "cancelDemand"
    | "completeDemand"
    | "continueDemand"
    | "createDemand"
    | "inspectDemandRoute"
    | "inspectTargetResultReview"
    | "inspectBoard"
    | "planTargetTask"
    | "planTestCard"
    | "publishRequirement"
    | "recordControllerImplementationReviewDecision"
    | "recordControllerTestReviewDecision"
    | "recordManagedEvidence"
    | "resumeTargetResultReview"
  >
>;
