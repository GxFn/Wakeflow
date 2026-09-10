import type { DeliveryEnvelope } from "../../../src/governance/delivery/delivery-envelope.js";
import type { DeliveryOutcome } from "../../../src/governance/delivery/delivery-outcome.js";
import {
  createImplementationTargetResult,
  type CreateImplementationTargetResultInput,
} from "../../../src/governance/result/implementation-target-result.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  computeTargetResultCallbackPromptDigest,
  deriveTargetResultCallbackId,
  parseTargetResultCallbackRecord,
  type TargetResultCallbackRecord,
} from "../../../src/governance/result/target-result-callback.js";
import type {
  TargetResult,
  TargetResultDeliveryBinding,
} from "../../../src/governance/result/target-result.js";
import type { WorkClaim } from "../../../src/kernel/work-claims.js";
import {
  createDeliveryEnvelopeFixture,
  createDeliveryOutcomeFixture,
  createWorkClaimFixture,
  DELIVERY_BINDING_DIGEST,
  DELIVERY_BINDING_ID,
} from "../delivery/delivery-records.fixture.js";
import { createTaskPackageFixture } from "../tasking/task-package.fixture.js";
import { createImplementationTargetResultReportFixture } from "./implementation-target-result-report.fixture.js";

/** 从 accepted（或 indeterminate）结局派生结果的投递绑定。 */
export function deliveryBindingFromOutcome(
  outcome: Readonly<DeliveryOutcome>,
): Readonly<TargetResultDeliveryBinding> {
  if (outcome.disposition === "rejected-before-send") {
    throw new Error("A rejected outcome cannot bind a TargetResult fixture.");
  }
  return Object.freeze({
    generation: outcome.generation,
    fence: Object.freeze({ claimId: outcome.fence.claimId, claimDigest: outcome.fence.claimDigest }),
    outcomeDigest: outcome.outcomeDigest,
    disposition: outcome.disposition,
    readbackStatus: outcome.readback.status,
    observedAt: outcome.observedAt,
  });
}

export const TARGET_RESULT_CALLBACK_ISSUED_AT = parseUtcInstant("2026-08-29T09:56:00.000Z");
export const TARGET_RESULT_CALLBACK_WINDOW_ID = "window_55555555-5555-4555-8555-555555555555";

/** 与结果同时进入事件的 wake-controller 回调记录（纯记录测试用；prompt 是固定文本）。 */
export function createTargetResultCallbackFixture(
  result: Readonly<TargetResult>,
  prompt = `Wakeflow callback fixture for ${result.targetResultId}`,
): Readonly<TargetResultCallbackRecord> {
  return parseTargetResultCallbackRecord({
    callbackId: deriveTargetResultCallbackId(result.targetResultId),
    controllerWindowId: TARGET_RESULT_CALLBACK_WINDOW_ID,
    bindingId: DELIVERY_BINDING_ID,
    bindingDigest: DELIVERY_BINDING_DIGEST,
    portablePrompt: prompt,
    promptDigest: computeTargetResultCallbackPromptDigest(prompt),
    generation: 1,
    issuedAt: TARGET_RESULT_CALLBACK_ISSUED_AT,
  });
}

export function createTargetResultFixture(
  options: Readonly<{
    readonly claim?: Readonly<WorkClaim>;
    readonly envelope?: Readonly<DeliveryEnvelope>;
    readonly outcome?: Readonly<DeliveryOutcome>;
    readonly report?: CreateImplementationTargetResultInput["report"];
  }> = {},
) {
  const claim = options.claim ?? createWorkClaimFixture();
  const envelope = options.envelope ?? createDeliveryEnvelopeFixture({ claim });
  const outcome = options.outcome ?? createDeliveryOutcomeFixture({ claim, envelope });
  const taskPackage = createTaskPackageFixture();
  if (taskPackage.workType !== "implementation") {
    throw new Error("Expected implementation TaskPackage fixture.");
  }
  return createImplementationTargetResult({
    taskPackage,
    envelope,
    delivery: deliveryBindingFromOutcome(outcome),
    report: options.report ?? createImplementationTargetResultReportFixture(),
  });
}
