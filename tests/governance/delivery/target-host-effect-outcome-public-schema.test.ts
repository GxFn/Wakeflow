import { equal } from "node:assert/strict";
import { test } from "node:test";

import {
  WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_REQUEST_SCHEMA,
  type WakeflowTargetHostEffectOutcomeRequestV1 as OutcomeRequestWire,
} from "../../../src/contracts/generated/entrypoints/wakeflow-target-host-effect-outcome-request.generated.js";
import {
  WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_RESULT_SCHEMA,
  type WakeflowTargetHostEffectOutcomeResultV1 as OutcomeResultWire,
} from "../../../src/contracts/generated/entrypoints/wakeflow-target-host-effect-outcome-result.generated.js";
import { createRuntimeJsonSchemaValidator } from "../../../src/foundation/schema/runtime-json-schema.js";

const validateRequest = createRuntimeJsonSchemaValidator<OutcomeRequestWire>(
  WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_REQUEST_SCHEMA,
);
const validateResult = createRuntimeJsonSchemaValidator<OutcomeResultWire>(
  WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_RESULT_SCHEMA,
);

const DIGEST = `sha256:${"0".repeat(64)}`;
const DEMAND_ID = "demand_11111111-1111-4111-8111-111111111111";
const TARGET_TASK_ID = "target-task_22222222-2222-4222-8222-222222222222";
const TARGET_DELIVERY_ID =
  "target-delivery_33333333-3333-4333-8333-333333333333";
const CLAIM_ID = "window_work_claim_44444444-4444-4444-8444-444444444444";
const EVENT_ID = "demand-event_55555555-5555-4555-8555-555555555555";
const COMMIT_ID = "demand-event-commit_66666666-6666-4666-8666-666666666666";
const TEST_ATTEMPT_ID = "test-attempt_77777777-7777-4777-8777-777777777777";
const OBSERVED_AT = "2026-09-01T10:00:02.000Z";

function request() {
  return {
    root: "/workspace",
    demandId: DEMAND_ID,
    actionId: CLAIM_ID,
    claimDigest: DIGEST,
    attempt: {
      status: "accepted",
      evidence: { hostResult: "accepted" },
    },
    readback: {
      status: "pending",
      evidence: { visible: false },
    },
    observedAt: OBSERVED_AT,
  } as const;
}

function observation(
  attemptStatus: "accepted" | "indeterminate" | "rejected-before-effect",
  readbackStatus: "confirmed" | "pending" | "unavailable",
) {
  return {
    kind: "WakeflowTargetHostEffectObservationSummary",
    schemaVersion: 1,
    source: "agent-host-effect-observation",
    attempt: {
      status: attemptStatus,
      evidenceDigest: DIGEST,
    },
    readback:
      readbackStatus === "unavailable"
        ? { status: "unavailable" as const }
        : {
            status: readbackStatus,
            evidenceDigest: DIGEST,
          },
    observedAt: OBSERVED_AT,
    observationDigest: DIGEST,
  } as const;
}

function result() {
  return {
    kind: "WakeflowTargetHostEffectOutcomeResult",
    schemaVersion: 1,
    tool: "wakeflow_record_target_host_effect_outcome",
    status: "recorded",
    disposition: "committed",
    effectDisposition: "accepted",
    claimHandling: "retain",
    claimAuthority: "current",
    eventAuthority: "current",
    target: {
      workType: "implementation",
      demandId: DEMAND_ID,
      targetTaskId: TARGET_TASK_ID,
      targetDeliveryId: TARGET_DELIVERY_ID,
    },
    claim: {
      actionId: CLAIM_ID,
      claimDigest: DIGEST,
    },
    observation: observation("accepted", "pending"),
    event: {
      eventId: EVENT_ID,
      streamRevision: 5,
    },
    commit: {
      commitId: COMMIT_ID,
      commitSequence: 5,
      commitDigest: DIGEST,
    },
    stateDigest: DIGEST,
  } as const;
}

test("Outcome Request只接受Claim selector与有界双轴Evidence形状", () => {
  const valid = request();
  equal(validateRequest(valid).ok, true);
  const { claimDigest: _claimDigest, ...missingClaimDigest } = valid;
  equal(validateRequest(missingClaimDigest).ok, false);
  equal(validateRequest({ ...valid, workType: "implementation" }).ok, false);
  equal(validateRequest({ ...valid, targetTaskId: TARGET_TASK_ID }).ok, false);
  equal(
    validateRequest({
      ...valid,
      readback: { status: "unavailable", evidence: { visible: false } },
    }).ok,
    false,
  );
  equal(
    validateRequest({
      ...valid,
      attempt: { status: valid.attempt.status },
    }).ok,
    false,
  );
});

test("Outcome Result关闭状态、双轴Disposition与Claim结算关系", () => {
  const accepted = result();
  equal(validateResult(accepted).ok, true);
  equal(
    validateResult({
      ...accepted,
      status: "already-recorded",
      disposition: "idempotent",
    }).ok,
    true,
  );
  equal(validateResult({ ...accepted, disposition: "idempotent" }).ok, false);
  equal(
    validateResult({
      ...accepted,
      observation: observation("indeterminate", "confirmed"),
    }).ok,
    true,
  );
  equal(
    validateResult({
      ...accepted,
      observation: observation("indeterminate", "pending"),
    }).ok,
    false,
  );

  const indeterminate = {
    ...accepted,
    effectDisposition: "indeterminate",
    observation: observation("indeterminate", "unavailable"),
  } as const;
  equal(validateResult(indeterminate).ok, true);
  equal(
    validateResult({
      ...indeterminate,
      observation: observation("indeterminate", "confirmed"),
    }).ok,
    false,
  );

  const rejected = {
    ...accepted,
    effectDisposition: "rejected-before-effect",
    claimHandling: "release-authorized",
    claimAuthority: "released",
    observation: observation("rejected-before-effect", "unavailable"),
  } as const;
  equal(validateResult(rejected).ok, true);
  equal(validateResult({ ...rejected, claimAuthority: "current" }).ok, false);
  equal(
    validateResult({
      ...rejected,
      observation: {
        ...rejected.observation,
        rawEvidence: { private: true },
      },
    }).ok,
    false,
  );
});

test("Outcome Result用stored Claim派生Implementation或Test目标，不接受宿主私密字段", () => {
  const implementation = result();
  const testing = {
    ...implementation,
    target: {
      workType: "test",
      demandId: DEMAND_ID,
      targetTaskId: TARGET_TASK_ID,
      targetDeliveryId: TARGET_DELIVERY_ID,
      testAttemptId: TEST_ATTEMPT_ID,
      testDispatchPacketDigest: DIGEST,
    },
  } as const;
  equal(validateResult(testing).ok, true);
  equal(
    validateResult({
      ...testing,
      target: {
        ...testing.target,
        handle: "private-codex-thread-id",
      },
    }).ok,
    false,
  );
  equal(validateResult({ ...implementation, root: "/workspace" }).ok, false);
  equal(validateResult({ ...implementation, prompt: "send again" }).ok, false);
});
