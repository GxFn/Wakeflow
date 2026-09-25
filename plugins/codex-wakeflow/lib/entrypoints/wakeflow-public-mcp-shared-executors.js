import { executeDemandCancellationRequest, executeDemandCompletionRequest, executeDemandContinuationRequest, } from "../capabilities/demand/lifecycle.js";
import { executeDemandCreationRequest } from "../capabilities/demand/service.js";
import { executeRecordEvidenceRequest } from "../capabilities/evidence/service.js";
import { executeBoardInspectionRequest, executeRequirementPublicationRequest, } from "../capabilities/requirement/service.js";
import { executeTargetTaskPlanningPublicRequest } from "../capabilities/tasking/service.js";
/**
 * Wakeflow Entrypoint / MCP：与宿主无关的公共 executor。
 *
 * 这些工具不消费宿主 profile；两个宿主组合根原样复用，只有需要宿主身份或
 * profile 的工具在各自的组合根里绑定 facade。
 */
export const WAKEFLOW_SHARED_PUBLIC_EXECUTORS = Object.freeze({
    cancelDemand: executeDemandCancellationRequest,
    completeDemand: executeDemandCompletionRequest,
    continueDemand: executeDemandContinuationRequest,
    createDemand: executeDemandCreationRequest,
    inspectBoard: executeBoardInspectionRequest,
    planTargetTask: executeTargetTaskPlanningPublicRequest,
    publishRequirement: executeRequirementPublicationRequest,
    recordEvidence: executeRecordEvidenceRequest,
});
