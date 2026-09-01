import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { createTargetDeliveryIntent } from "../../../src/governance/delivery/target-delivery-intent.js";
import { parseWakeflowWindowHostBindingId } from "../../../src/workspace/window-runtime/wakeflow-window-host-binding-id.js";
import { createTaskPackageFixture } from "../tasking/task-package.fixture.js";

export const TARGET_DELIVERY_ID = parseWakeflowDurableIdOfKind(
  "target-delivery_88888888-8888-4888-8888-888888888888",
  "target-delivery",
);
export const TARGET_DELIVERY_BINDING_ID = parseWakeflowWindowHostBindingId(
  "window_binding_99999999-9999-4999-8999-999999999999",
);
export const TARGET_DELIVERY_PREPARED_AT = parseUtcInstant(
  "2026-08-29T09:59:00.000Z",
);

export function createTargetDeliveryIntentFixture() {
  return createTargetDeliveryIntent(
    {
      targetDeliveryId: TARGET_DELIVERY_ID,
      taskPackage: createTaskPackageFixture(),
      hostId: "codex",
      bindingId: TARGET_DELIVERY_BINDING_ID,
      language: "zh-Hans",
    },
    {
      clock: () => TARGET_DELIVERY_PREPARED_AT,
    },
  );
}
