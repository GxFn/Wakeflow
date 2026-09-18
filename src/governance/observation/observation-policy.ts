import {
  MAXIMUM_WORK_CLAIM_GENERATION,
  WORK_CLAIM_RECOVERY_WINDOW_MILLISECONDS,
} from "../../kernel/work-claims.js";
import { DELIVERY_LANDING_SILENCE_MILLISECONDS } from "../delivery/delivery-outcome.js";
import { DELIVERY_REARM_LIMIT } from "../delivery/delivery-rearm.js";
import { DEMAND_REWORK_ESCALATION_THRESHOLD } from "../demand/event-sourcing/demand-event-sourcing-decider.js";
import {
  TARGET_RESULT_CALLBACK_GENERATION_LIMIT,
  TARGET_RESULT_CALLBACK_SILENCE_MILLISECONDS,
} from "../result/target-result-callback.js";

/**
 * Wakeflow Governance / Observation：生效阈值的一张表（gate-log §13.94 D7）。
 *
 * ADR-0012 未决的数值先作常量，各自住在拥有它的模块；这里只汇总成 status 的 `policy` 段
 * 原样报告，不做配置化。进配置留作 ADR-0012 未决项，L2 视场景需要再开。
 */

export interface WakeflowObservationPolicy {
  readonly deliveryLandingSilenceMilliseconds: number;
  readonly deliveryRearmLimit: number;
  readonly workClaimGenerationLimit: number;
  readonly workClaimRecoveryWindowMilliseconds: number;
  readonly targetResultCallbackSilenceMilliseconds: number;
  readonly targetResultCallbackGenerationLimit: number;
  readonly demandReworkEscalationThreshold: number;
}

export const WAKEFLOW_OBSERVATION_POLICY: Readonly<WakeflowObservationPolicy> = Object.freeze({
  deliveryLandingSilenceMilliseconds: DELIVERY_LANDING_SILENCE_MILLISECONDS,
  deliveryRearmLimit: DELIVERY_REARM_LIMIT,
  workClaimGenerationLimit: MAXIMUM_WORK_CLAIM_GENERATION,
  workClaimRecoveryWindowMilliseconds: WORK_CLAIM_RECOVERY_WINDOW_MILLISECONDS,
  targetResultCallbackSilenceMilliseconds: TARGET_RESULT_CALLBACK_SILENCE_MILLISECONDS,
  targetResultCallbackGenerationLimit: TARGET_RESULT_CALLBACK_GENERATION_LIMIT,
  demandReworkEscalationThreshold: DEMAND_REWORK_ESCALATION_THRESHOLD,
});
