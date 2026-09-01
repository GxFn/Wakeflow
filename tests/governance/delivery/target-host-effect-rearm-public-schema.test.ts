import { equal } from "node:assert/strict";
import { test } from "node:test";

import {
  WAKEFLOW_TARGET_HOST_EFFECT_REARM_REQUEST_SCHEMA,
  type WakeflowTargetHostEffectRearmRequestV1 as RearmRequestWire,
} from "../../../src/contracts/generated/entrypoints/wakeflow-target-host-effect-rearm-request.generated.js";
import {
  WAKEFLOW_TARGET_HOST_EFFECT_REARM_RESULT_SCHEMA,
  type WakeflowTargetHostEffectRearmResultV1 as RearmResultWire,
} from "../../../src/contracts/generated/entrypoints/wakeflow-target-host-effect-rearm-result.generated.js";
import { createRuntimeJsonSchemaValidator } from "../../../src/foundation/schema/runtime-json-schema.js";
import { createTargetDeliveryHostEffectObservationFixture } from "./target-delivery-host-effect-observation.fixture.js";
import { createTargetHostEffectRearmFixture } from "./target-host-effect-rearm.fixture.js";
import { createWindowWorkClaimFixture } from "./window-work-claim.fixture.js";

const validateRequest = createRuntimeJsonSchemaValidator<RearmRequestWire>(
  WAKEFLOW_TARGET_HOST_EFFECT_REARM_REQUEST_SCHEMA,
);
const validateResult = createRuntimeJsonSchemaValidator<RearmResultWire>(
  WAKEFLOW_TARGET_HOST_EFFECT_REARM_RESULT_SCHEMA,
);

const DIGEST = `sha256:${"0".repeat(64)}`;
const EVENT_ID = "demand-event_77777777-7777-4777-8777-777777777777";
const COMMIT_ID = "demand-event-commit_88888888-8888-4888-8888-888888888888";

function request() {
  const claim = createWindowWorkClaimFixture();
  const observation = createTargetDeliveryHostEffectObservationFixture({
    claim,
    attemptStatus: "rejected-before-effect",
    readbackStatus: "unavailable",
  });
  return {
    root: "/workspace",
    demandId: claim.target.demandId,
    actionId: claim.claimId,
    observationDigest: observation.observationDigest,
  } as const;
}

function result() {
  const claim = createWindowWorkClaimFixture();
  const observation = createTargetDeliveryHostEffectObservationFixture({
    claim,
    attemptStatus: "rejected-before-effect",
    readbackStatus: "unavailable",
  });
  return {
    kind: "WakeflowTargetHostEffectRearmResult",
    schemaVersion: 1,
    tool: "wakeflow_rearm_target_host_effect",
    status: "rearmed",
    disposition: "committed",
    claimAuthority: "released",
    eventAuthority: "current",
    rearm: createTargetHostEffectRearmFixture(claim, observation),
    event: {
      eventId: EVENT_ID,
      streamRevision: 6,
    },
    commit: {
      commitId: COMMIT_ID,
      commitSequence: 6,
      commitDigest: DIGEST,
    },
    stateDigest: DIGEST,
  } as const;
}

test("Rearm Request只接受Demand、Action与Observation selector", () => {
  const valid = request();
  equal(validateRequest(valid).ok, true);
  equal(
    validateRequest({
      ...valid,
      targetTaskId: createWindowWorkClaimFixture().target.targetTaskId,
    }).ok,
    false,
  );
  equal(
    validateRequest({
      ...valid,
      targetDeliveryId: createWindowWorkClaimFixture().target.targetDeliveryId,
    }).ok,
    false,
  );
  equal(validateRequest({ ...valid, retryAutomatically: true }).ok, false);
});

test("Rearm Result关闭状态关系且不承载Action或宿主私密字段", () => {
  const committed = result();
  equal(validateResult(committed).ok, true);
  equal(
    validateResult({
      ...committed,
      status: "already-rearmed",
      disposition: "idempotent",
    }).ok,
    true,
  );
  equal(validateResult({ ...committed, disposition: "idempotent" }).ok, false);
  equal(validateResult({ ...committed, claimAuthority: "current" }).ok, false);
  equal(validateResult({ ...committed, action: { send: true } }).ok, false);
  equal(validateResult({ ...committed, root: "/workspace" }).ok, false);
  equal(
    validateResult({ ...committed, handle: "private-codex-thread-id" }).ok,
    false,
  );
});
