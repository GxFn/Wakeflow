import type { DeliveryEnvelope } from "../../../src/governance/delivery/delivery-envelope.js";
import type { DeliveryOutcome } from "../../../src/governance/delivery/delivery-outcome.js";
import {
  createImplementationTargetResult,
  type CreateImplementationTargetResultInput,
} from "../../../src/governance/result/implementation-target-result.js";
import type { TargetResultDeliveryBinding } from "../../../src/governance/result/target-result.js";
import type { WorkClaim } from "../../../src/kernel/work-claims.js";
import {
  createDeliveryEnvelopeFixture,
  createDeliveryOutcomeFixture,
  createWorkClaimFixture,
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
