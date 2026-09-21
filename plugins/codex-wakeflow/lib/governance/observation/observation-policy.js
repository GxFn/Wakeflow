import { HOST_HOOK_RETENTION_MILLISECONDS } from "../../kernel/hook-observations.js";
import { MAXIMUM_WORK_CLAIM_GENERATION, WORK_CLAIM_RECOVERY_WINDOW_MILLISECONDS, } from "../../kernel/work-claims.js";
import { DELIVERY_LANDING_SILENCE_MILLISECONDS } from "../delivery/delivery-outcome.js";
import { DELIVERY_REARM_LIMIT } from "../delivery/delivery-rearm.js";
import { DEMAND_REWORK_ESCALATION_THRESHOLD } from "../demand/event-sourcing/demand-event-sourcing-decider.js";
import { TARGET_RESULT_CALLBACK_GENERATION_LIMIT, TARGET_RESULT_CALLBACK_SILENCE_MILLISECONDS, } from "../result/target-result-callback.js";
export const WAKEFLOW_OBSERVATION_POLICY = Object.freeze({
    deliveryLandingSilenceMilliseconds: DELIVERY_LANDING_SILENCE_MILLISECONDS,
    deliveryRearmLimit: DELIVERY_REARM_LIMIT,
    workClaimGenerationLimit: MAXIMUM_WORK_CLAIM_GENERATION,
    workClaimRecoveryWindowMilliseconds: WORK_CLAIM_RECOVERY_WINDOW_MILLISECONDS,
    targetResultCallbackSilenceMilliseconds: TARGET_RESULT_CALLBACK_SILENCE_MILLISECONDS,
    targetResultCallbackGenerationLimit: TARGET_RESULT_CALLBACK_GENERATION_LIMIT,
    demandReworkEscalationThreshold: DEMAND_REWORK_ESCALATION_THRESHOLD,
    hostHookRetentionMilliseconds: HOST_HOOK_RETENTION_MILLISECONDS,
});
