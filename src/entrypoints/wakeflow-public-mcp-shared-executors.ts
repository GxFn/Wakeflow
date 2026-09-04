import { executeTargetTaskPlanningPublicRequest } from "../capabilities/tasking/plan-target-task.js";
import { executeDemandControllerRoutePublicRequest } from "../governance/controller/demand-controller-route-public-coordinator.js";
import { executeDemandPublicationPublicRequest } from "../governance/demand/publication/demand-publication-public-coordinator.js";
import { executeManagedEvidencePublicRequest } from "../governance/evidence/managed-evidence-public-coordinator.js";
import {
  executeConfirmationPublicationPublicRequest,
  executeRequirementPublicationPublicRequest,
} from "../governance/ledger/ledger-authority-public-coordinator.js";
import { executeDemandCompletionPublicRequest } from "../governance/lifecycle/demand-completion-public-coordinator.js";
import { executeControllerImplementationReviewDecisionPublicRequest } from "../governance/review/controller-implementation-review-decision-public-coordinator.js";
import { executeControllerProductDefectRemediationPublicRequest } from "../governance/review/controller-product-defect-remediation-public-coordinator.js";
import { executeControllerTestReviewDecisionPublicRequest } from "../governance/review/controller-test-review-decision-public-coordinator.js";
import { executeTargetResultReviewInspectionPublicRequest } from "../governance/review/target-result-review-inspection-public-coordinator.js";
import { executeTargetResultReviewResumePublicRequest } from "../governance/review/target-result-review-resume-public-coordinator.js";
import { executeTestCardPlanningPublicRequest } from "../governance/testing/test-card-planning-public-coordinator.js";
import { executeTodoInspectionPublicRequest } from "../governance/todo/todo-inspection-public-coordinator.js";
import { executeTodoIntakePublicationPublicRequest } from "../governance/todo/todo-intake-publication-public-coordinator.js";
import type { WakeflowPublicMcpExecutors } from "./wakeflow-public-mcp-catalog.js";

/**
 * Wakeflow Entrypoint / MCP：与宿主无关的公共 executor。
 *
 * 这些工具不消费宿主 profile；两个宿主组合根原样复用，只有需要宿主身份或
 * profile 的工具在各自的组合根里绑定 facade。
 */
export const WAKEFLOW_SHARED_PUBLIC_EXECUTORS = Object.freeze({
  authorizeProductDefectRemediation: executeControllerProductDefectRemediationPublicRequest,
  completeDemand: executeDemandCompletionPublicRequest,
  createDemand: executeDemandPublicationPublicRequest,
  inspectDemandRoute: executeDemandControllerRoutePublicRequest,
  inspectTargetResultReview: executeTargetResultReviewInspectionPublicRequest,
  inspectTodo: executeTodoInspectionPublicRequest,
  intakeTodo: executeTodoIntakePublicationPublicRequest,
  planTargetTask: executeTargetTaskPlanningPublicRequest,
  planTestCard: executeTestCardPlanningPublicRequest,
  publishConfirmation: executeConfirmationPublicationPublicRequest,
  publishRequirement: executeRequirementPublicationPublicRequest,
  recordControllerImplementationReviewDecision:
    executeControllerImplementationReviewDecisionPublicRequest,
  recordControllerTestReviewDecision: executeControllerTestReviewDecisionPublicRequest,
  recordManagedEvidence: executeManagedEvidencePublicRequest,
  resumeTargetResultReview: executeTargetResultReviewResumePublicRequest,
}) satisfies Readonly<
  Pick<
    WakeflowPublicMcpExecutors,
    | "authorizeProductDefectRemediation"
    | "completeDemand"
    | "createDemand"
    | "inspectDemandRoute"
    | "inspectTargetResultReview"
    | "inspectTodo"
    | "intakeTodo"
    | "planTargetTask"
    | "planTestCard"
    | "publishConfirmation"
    | "publishRequirement"
    | "recordControllerImplementationReviewDecision"
    | "recordControllerTestReviewDecision"
    | "recordManagedEvidence"
    | "resumeTargetResultReview"
  >
>;
