import { equal } from "node:assert/strict";
import { test } from "node:test";

import {
  WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_REQUEST_SCHEMA,
  type WakeflowTargetHostEffectClaimRequestV1 as ClaimRequestWire,
} from "../../../src/contracts/generated/entrypoints/wakeflow-target-host-effect-claim-request.generated.js";
import {
  WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_RESULT_SCHEMA,
  type WakeflowTargetHostEffectClaimResultV1 as ClaimResultWire,
} from "../../../src/contracts/generated/entrypoints/wakeflow-target-host-effect-claim-result.generated.js";
import { createRuntimeJsonSchemaValidator } from "../../../src/foundation/schema/runtime-json-schema.js";

const validateRequest = createRuntimeJsonSchemaValidator<ClaimRequestWire>(
  WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_REQUEST_SCHEMA,
);
const validateResult = createRuntimeJsonSchemaValidator<ClaimResultWire>(
  WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_RESULT_SCHEMA,
);

const DIGEST = `sha256:${"0".repeat(64)}`;
const DEMAND_ID = "demand_11111111-1111-4111-8111-111111111111";
const TARGET_TASK_ID = "target-task_22222222-2222-4222-8222-222222222222";
const TARGET_DELIVERY_ID =
  "target-delivery_33333333-3333-4333-8333-333333333333";
const WINDOW_ID = "window_44444444-4444-4444-8444-444444444444";
const BINDING_ID = "window_binding_55555555-5555-4555-8555-555555555555";
const CLAIM_ID = "window_work_claim_66666666-6666-4666-8666-666666666666";
const EVENT_ID = "demand-event_77777777-7777-4777-8777-777777777777";
const COMMIT_ID = "demand-event-commit_88888888-8888-4888-8888-888888888888";
const TEST_ATTEMPT_ID = "test-attempt_99999999-9999-4999-8999-999999999999";
const OBSERVED_AT = "2026-09-01T10:00:00.000Z";
const CLAIMED_AT = "2026-09-01T10:00:01.000Z";
const CLAIM_REF = `.wakeflow-local/runtime/shared/coordination/window-work-claims/${WINDOW_ID}.json`;
const TEST_PACKET_REF = `.wakeflow-active/current/${DEMAND_ID}/artifacts/test-dispatch-packets/${TARGET_DELIVERY_ID}.json`;

function implementationObservation() {
  return {
    kind: "WakeflowAgentHostWindowObservation",
    schemaVersion: 1,
    source: "agent-host-inspection-result",
    hostId: "codex",
    windowId: WINDOW_ID,
    bindingId: BINDING_ID,
    handle: {
      kind: "codex-thread",
      value: "private-codex-thread-id",
    },
    attestedRoot: {
      status: "matches-configured-root",
      logicalRoot: {
        kind: "repository",
        repositoryId: "repository_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
      configuredPlacement: "Product",
    },
    observedAt: OBSERVED_AT,
  } as const;
}

function testObservation() {
  return {
    ...implementationObservation(),
    attestedRoot: {
      status: "matches-configured-root",
      logicalRoot: {
        kind: "support-surface",
        surfaceId: "surface_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      },
      configuredPlacement: "Test",
    },
  } as const;
}

function implementationRequest() {
  return {
    root: "/workspace",
    workType: "implementation",
    demandId: DEMAND_ID,
    targetTaskId: TARGET_TASK_ID,
    targetDeliveryId: TARGET_DELIVERY_ID,
    intentDigest: DIGEST,
    observation: implementationObservation(),
  } as const;
}

function testRequest() {
  return {
    root: "/workspace",
    workType: "test",
    demandId: DEMAND_ID,
    targetTaskId: TARGET_TASK_ID,
    targetDeliveryId: TARGET_DELIVERY_ID,
    intentDigest: DIGEST,
    testDispatchPacketDigest: DIGEST,
    observation: testObservation(),
  } as const;
}

function commonAction() {
  return {
    schemaVersion: 1,
    actionId: CLAIM_ID,
    effect: "send-message-to-observed-target-window",
    hostId: "codex",
    windowId: WINDOW_ID,
    bindingId: BINDING_ID,
    targetDeliveryId: TARGET_DELIVERY_ID,
    intentDigest: DIGEST,
    workClaim: {
      claimId: CLAIM_ID,
      claimRef: CLAIM_REF,
      claimDigest: DIGEST,
      expectedStateDigest: DIGEST,
      claimCommitId: COMMIT_ID,
    },
    hostObservation: {
      authorityDigest: DIGEST,
      observedAt: OBSERVED_AT,
    },
    prompt:
      'Continue the exact target task.\n\nWakeflow workspace root (JSON string): "/workspace"',
    issuedAt: CLAIMED_AT,
    claimEvent: {
      eventId: EVENT_ID,
      streamRevision: 4,
      stateDigest: DIGEST,
    },
  } as const;
}

function commonResult() {
  return {
    kind: "WakeflowTargetHostEffectClaimResult",
    schemaVersion: 1,
    tool: "wakeflow_claim_target_host_effect",
    status: "issued",
    disposition: "committed",
    claimAuthority: "current",
    eventAuthority: "current",
    event: {
      eventId: EVENT_ID,
      streamRevision: 4,
    },
    commit: {
      commitId: COMMIT_ID,
      commitSequence: 4,
      commitDigest: DIGEST,
    },
    stateDigest: DIGEST,
  } as const;
}

function implementationIssuedResult() {
  return {
    ...commonResult(),
    claim: {
      claimId: CLAIM_ID,
      claimRef: CLAIM_REF,
      claimDigest: DIGEST,
      claimedAt: CLAIMED_AT,
      target: {
        workType: "implementation",
        demandId: DEMAND_ID,
        targetTaskId: TARGET_TASK_ID,
        targetDeliveryId: TARGET_DELIVERY_ID,
        intentDigest: DIGEST,
      },
      route: {
        hostId: "codex",
        windowId: WINDOW_ID,
        bindingId: BINDING_ID,
      },
    },
    action: {
      kind: "WakeflowTargetDeliveryAgentHostAction",
      ...commonAction(),
    },
  } as const;
}

function testIssuedResult() {
  return {
    ...commonResult(),
    claim: {
      claimId: CLAIM_ID,
      claimRef: CLAIM_REF,
      claimDigest: DIGEST,
      claimedAt: CLAIMED_AT,
      target: {
        workType: "test",
        demandId: DEMAND_ID,
        targetTaskId: TARGET_TASK_ID,
        targetDeliveryId: TARGET_DELIVERY_ID,
        intentDigest: DIGEST,
        testAttemptId: TEST_ATTEMPT_ID,
        testDispatchPacketDigest: DIGEST,
      },
      route: {
        hostId: "codex",
        windowId: WINDOW_ID,
        bindingId: BINDING_ID,
      },
    },
    action: {
      kind: "WakeflowTestDeliveryAgentHostAction",
      ...commonAction(),
      testAttemptId: TEST_ATTEMPT_ID,
      testDispatchPacket: {
        ref: TEST_PACKET_REF,
        digest: DIGEST,
      },
    },
  } as const;
}

test("共享Claim Request Schema关闭Implementation/Test与瞬时Observation", () => {
  const implementation = implementationRequest();
  const testing = testRequest();
  equal(validateRequest(implementation).ok, true);
  equal(validateRequest(testing).ok, true);
  equal(
    validateRequest({ ...implementation, testDispatchPacketDigest: DIGEST }).ok,
    false,
  );
  const {
    testDispatchPacketDigest: _testDispatchPacketDigest,
    ...incompleteTest
  } = testing;
  equal(validateRequest(incompleteTest).ok, false);
  equal(validateRequest({ ...implementation, hostAction: "send" }).ok, false);
  equal(
    validateRequest({
      ...implementation,
      observation: {
        ...implementation.observation,
        handle: { kind: "codex-thread", value: " current-thread" },
      },
    }).ok,
    false,
  );
});

test("Claim Result Schema只在首次committed返回同workType一次性Action", () => {
  const implementation = implementationIssuedResult();
  const testing = testIssuedResult();
  equal(validateResult(implementation).ok, true);
  equal(validateResult(testing).ok, true);

  const replay = {
    ...implementation,
    status: "already-claimed",
    disposition: "idempotent",
    action: null,
  } as const;
  equal(validateResult(replay).ok, true);
  equal(validateResult({ ...implementation, action: null }).ok, false);
  equal(
    validateResult({
      ...replay,
      action: implementation.action,
    }).ok,
    false,
  );
  equal(
    validateResult({
      ...implementation,
      action: {
        ...implementation.action,
        effect: "send-message-to-current-window",
      },
    }).ok,
    false,
  );
  equal(
    validateResult({
      ...implementation,
      action: testing.action,
    }).ok,
    false,
  );
  equal(
    validateResult({
      ...implementation,
      action: {
        ...implementation.action,
        handle: "private-codex-thread-id",
      },
    }).ok,
    false,
  );
});
