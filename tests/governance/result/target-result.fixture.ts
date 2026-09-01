import { createImplementationTargetResult } from "../../../src/governance/result/implementation-target-result.js";
import { createTargetDeliveryHostEffectObservationFixture } from "../delivery/target-delivery-host-effect-observation.fixture.js";
import type { TargetDeliveryHostEffectObservation } from "../../../src/governance/delivery/target-delivery-host-effect-observation.js";
import { createTargetDeliveryIntentFixture } from "../delivery/target-delivery-intent.fixture.js";
import { createWindowWorkClaimFixture } from "../delivery/window-work-claim.fixture.js";
import type { WindowWorkClaim } from "../../../src/governance/delivery/window-work-claim.js";
import { createTaskPackageFixture } from "../tasking/task-package.fixture.js";
import { createImplementationTargetResultReportFixture } from "./implementation-target-result-report.fixture.js";

export function createTargetResultFixture(
  options: Readonly<{
    readonly claim?: Readonly<WindowWorkClaim>;
    readonly observation?: Readonly<TargetDeliveryHostEffectObservation>;
  }> = {},
) {
  const claim = options.claim ?? createWindowWorkClaimFixture();
  const taskPackage = createTaskPackageFixture();
  if (taskPackage.workType !== "implementation") {
    throw new Error("Expected implementation TaskPackage fixture.");
  }
  return createImplementationTargetResult({
    taskPackage,
    intent: createTargetDeliveryIntentFixture(),
    claim,
    observation:
      options.observation ??
      createTargetDeliveryHostEffectObservationFixture({ claim }),
    report: createImplementationTargetResultReportFixture(),
  });
}
