import { equal, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  assertSupportedDemandEventSourcingStateModelVersion,
  parseDemandEventSourcingStateModelVersion,
  DemandEventSourcingStateVersionError,
  DEMAND_EVENT_SOURCING_CURRENT_STATE_MODEL_VERSION,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-state-version.js";
import { DEMAND_EVENT_SOURCING_EVENT_TYPES } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-event-version-codec.js";

test("Demand Event Sourcing state-model version 独立于 event version", () => {
  equal(
    DEMAND_EVENT_SOURCING_EVENT_TYPES.join(","),
    [
      "delivery.target-delivery-prepared",
      "delivery.target-host-effect-claimed",
      "delivery.target-host-effect-observed",
      "delivery.target-host-effect-rearmed",
      "lifecycle.demand-cancelled",
      "lifecycle.demand-completed",
      "publication.demand-published",
      "result.target-result-recorded",
      "review.product-defect-remediation-authorized",
      "review.target-result-decided",
      "review.target-result-resumed",
      "tasking.target-task-planned",
      "testing.test-card-created",
      "testing.test-delivery-prepared",
    ].join(","),
  );
  equal(parseDemandEventSourcingStateModelVersion(1), 1);
  assertSupportedDemandEventSourcingStateModelVersion(
    DEMAND_EVENT_SOURCING_CURRENT_STATE_MODEL_VERSION,
  );
  throws(
    () => assertSupportedDemandEventSourcingStateModelVersion(2),
    (error: unknown) =>
      error instanceof DemandEventSourcingStateVersionError &&
      error.reason === "unsupported-version",
  );
  throws(
    () => parseDemandEventSourcingStateModelVersion(0),
    DemandEventSourcingStateVersionError,
  );
});
