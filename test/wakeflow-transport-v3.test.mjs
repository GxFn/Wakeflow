import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { canonicalJsonDigest } from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  WAKEFLOW_CONTROLLER_RETURN_ENVELOPE_KIND,
  WAKEFLOW_DIRECT_THREAD_DELIVERY_RUN_KIND,
  WAKEFLOW_DISPATCH_GROUP_KIND,
  WAKEFLOW_DISPATCH_PACKET_KIND,
  WAKEFLOW_TARGET_DELIVERY_ENVELOPE_KIND,
  WAKEFLOW_TRANSPORT_SCHEMA_VERSION,
  createControllerReturnEnvelopeRecord,
  createDeliveryRunRecord,
  createDispatchGroupRecord,
  createDispatchPacketRecord,
  createTargetDeliveryEnvelopeRecord,
  deliveryEnvelopeCanonicalBytes,
  deliveryEnvelopeDigest,
  deliveryEnvelopeRef,
  deliveryRunCanonicalBytes,
  deliveryRunDigest,
  deliveryRunRef,
  dispatchGroupCanonicalBytes,
  dispatchGroupDigest,
  dispatchGroupRef,
  dispatchPacketCanonicalBytes,
  dispatchPacketDigest,
  dispatchPacketRef,
  validateControllerReturnEnvelopeAgainstGroup,
  validateDeliveryEnvelopeRecord,
  validateDeliveryRunAgainstSources,
  validateDeliveryRunChain,
  validateDeliveryRunRecord,
  validateDispatchGroupRecord,
  validateDispatchPacketAgainstGroup,
  validateDispatchPacketRecord,
  validateTargetDeliveryEnvelopeAgainstSources,
} from "../core/scripts/lib/wakeflow-transport-records.mjs";
import {
  WAKEFLOW_ID_TYPES,
  assertWakeflowId,
  generateWakeflowId,
} from "../core/scripts/lib/wakeflow-identifiers.mjs";
import {
  createWindowBindingRecord,
  windowBindingDigest,
  windowBindingRef,
} from "../core/scripts/lib/wakeflow-window-binding-records.mjs";
import {
  createWindowCoordinationLeaseRecord,
  windowCoordinationLeaseRef,
} from "../core/scripts/lib/wakeflow-window-lease-records.mjs";

const UUIDS = Object.freeze({
  program: "00000000-0000-4000-8000-000000000001",
  demand: "00000000-0000-4000-8000-000000000002",
  controllerWindow: "00000000-0000-4000-8000-000000000003",
  targetWindow: "00000000-0000-4000-8000-000000000004",
  targetTask: "00000000-0000-4000-8000-000000000005",
  group: "00000000-0000-4000-8000-000000000006",
  packet: "00000000-0000-4000-8000-000000000007",
  otherPacket: "00000000-0000-4000-8000-000000000008",
  delivery: "00000000-0000-4000-8000-000000000009",
  run: "00000000-0000-4000-8000-00000000000a",
  secondTargetWindow: "00000000-0000-4000-8000-00000000000b",
  secondTargetTask: "00000000-0000-4000-8000-00000000000c",
  secondPacket: "00000000-0000-4000-8000-00000000000d",
  taskPackage: "00000000-0000-4000-8000-00000000000e",
  testCard: "00000000-0000-4000-8000-00000000000f",
  otherProgram: "00000000-0000-4000-8000-000000000010",
  otherDemand: "00000000-0000-4000-8000-000000000011",
  controllerDelivery: "00000000-0000-4000-8000-000000000012",
  secondRun: "00000000-0000-4000-8000-000000000013",
  thirdRun: "00000000-0000-4000-8000-000000000014",
  controllerRun: "00000000-0000-4000-8000-000000000015",
});

const IDS = Object.freeze({
  program: `program_${UUIDS.program}`,
  demand: `demand_${UUIDS.demand}`,
  controllerWindow: `window_${UUIDS.controllerWindow}`,
  targetWindow: `window_${UUIDS.targetWindow}`,
  targetTask: `target-task_${UUIDS.targetTask}`,
  group: `dispatch-group_${UUIDS.group}`,
  packet: `dispatch-packet_${UUIDS.packet}`,
  otherPacket: `dispatch-packet_${UUIDS.otherPacket}`,
  delivery: `delivery_${UUIDS.delivery}`,
  run: `delivery-run_${UUIDS.run}`,
  secondTargetWindow: `window_${UUIDS.secondTargetWindow}`,
  secondTargetTask: `target-task_${UUIDS.secondTargetTask}`,
  secondPacket: `dispatch-packet_${UUIDS.secondPacket}`,
  taskPackage: `task-package_${UUIDS.taskPackage}`,
  testCard: `test-card_${UUIDS.testCard}`,
  otherProgram: `program_${UUIDS.otherProgram}`,
  otherDemand: `demand_${UUIDS.otherDemand}`,
  controllerDelivery: `delivery_${UUIDS.controllerDelivery}`,
  secondRun: `delivery-run_${UUIDS.secondRun}`,
  thirdRun: `delivery-run_${UUIDS.thirdRun}`,
  controllerRun: `delivery-run_${UUIDS.controllerRun}`,
});

const INVALID_DIGEST = `sha256:${"1".repeat(64)}`;
const TASK_PACKAGE_DIGEST = `sha256:${"2".repeat(64)}`;
const RESULT_SET_DIGEST = `sha256:${"5".repeat(64)}`;
const REVIEW_SNAPSHOT_DIGEST = `sha256:${"6".repeat(64)}`;
const READBACK_EVIDENCE_DIGEST = `sha256:${"8".repeat(64)}`;
const BINDING_ID = "binding_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RAW_CODEX_THREAD_HANDLE = "10000000-0000-4000-8000-000000000001";

function groupInput(overrides = {}) {
  return {
    programId: IDS.program,
    demandId: IDS.demand,
    groupId: IDS.group,
    stateRevision: 7,
    controllerWindowId: IDS.controllerWindow,
    members: [{
      windowId: IDS.targetWindow,
      targetTaskId: IDS.targetTask,
      packetId: IDS.packet,
    }],
    returnPolicy: { mode: "group-ready" },
    createdAt: "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

function packetInput(group, overrides = {}) {
  return {
    programId: IDS.program,
    demandId: IDS.demand,
    groupId: IDS.group,
    groupDigest: group.groupDigest,
    packetId: IDS.packet,
    windowId: IDS.targetWindow,
    targetTaskId: IDS.targetTask,
    taskPackageId: IDS.taskPackage,
    taskPackageDigest: TASK_PACKAGE_DIGEST,
    objective: "Implement the bounded Wakeflow change.",
    taskBriefing: {
      workType: "implementation",
      confirmedContext: ["The requirement and implementation boundary are confirmed."],
      completionExpectations: ["Return focused verification evidence."],
      requiredSkills: [
        "skills/wakeflow-target/SKILL.md",
        "skills/wakeflow-target-craft/SKILL.md",
      ],
      commitExpectation: "leave-uncommitted",
    },
    boundaries: {
      inScope: ["Only the assigned target repository."],
      outOfScope: ["Wakeflow controller source."],
      forbidden: ["Do not modify another product repository."],
    },
    acceptanceAnchors: [{
      anchorId: "anchor-transport-1",
      claim: "The target change is implemented.",
      probe: "Run the focused regression test.",
      expected: "The regression test passes.",
    }],
    designIntent: "Preserve the existing authority direction.",
    reviewInputContract: {
      requiredKinds: ["focused-test"],
      requiredAcceptanceAnchorIds: ["anchor-transport-1"],
    },
    resultContract: {
      artifactKind: "wakeflow-target-result",
      schemaVersion: 1,
    },
    contextPolicy: "refresh-if-missing",
    prompt: "Execute only this immutable packet and return one strict TargetResult.",
    createdAt: "2026-08-08T00:00:01.000Z",
    ...overrides,
  };
}

function testPacketInput(group, overrides = {}) {
  return packetInput(group, {
    taskBriefing: {
      workType: "test",
      confirmedContext: ["Controller approved the bounded real-environment test."],
      completionExpectations: ["Return only the approved test evidence."],
      requiredSkills: [
        "skills/wakeflow-target/SKILL.md",
        "skills/wakeflow-test/SKILL.md",
      ],
    },
    acceptanceAnchors: [],
    reviewInputContract: {
      requiredKinds: ["test-report"],
      requiredAcceptanceAnchorIds: [],
    },
    testContract: {
      testCard: {
        testCardId: IDS.testCard,
        ref: `test-cards/${IDS.testCard}.json`,
        digest: `sha256:${"3".repeat(64)}`,
      },
      executionContract: {
        requirementGoal: "Validate the approved Wakeflow behavior.",
        approvedPlan: ["Run the focused real-environment scenario."],
        allowedSkills: ["wakeflow-test"],
        setupPolicy: "reuse-existing",
        maxAttempts: 2,
        restartConditions: ["The first attempt was rejected before host send."],
        changeControl: {
          testMayChangeApproach: false,
          testMayChangeGoal: false,
          testMayAddUnmappedSteps: false,
          testMayUseUnlistedSkills: false,
          route: "return-blocked-to-controller",
        },
      },
    },
    ...overrides,
  });
}

function bindingFixture(windowId = IDS.targetWindow) {
  return createWindowBindingRecord({
    programId: IDS.program,
    hostId: "codex",
    windowId,
    bindingId: BINDING_ID,
    handle: { kind: "codex-thread", value: RAW_CODEX_THREAD_HANDLE },
    registeredAt: "2026-08-08T00:00:02.000Z",
  });
}

function targetEnvelopeInput(group, packet, binding, overrides = {}) {
  return {
    programId: IDS.program,
    demandId: IDS.demand,
    deliveryId: IDS.delivery,
    groupId: IDS.group,
    groupDigest: group.groupDigest,
    packetId: IDS.packet,
    packetDigest: packet.packetDigest,
    preparedByHostId: "codex",
    windowId: IDS.targetWindow,
    bindingId: binding.bindingId,
    identityBindingDigest: windowBindingDigest(binding),
    prompt: packet.prompt,
    oneShot: true,
    transportPolicy: {
      kind: "direct-thread",
      missingIdentity: "rejected-before-send",
    },
    readbackPolicy: {
      required: true,
      maxObservations: 1,
    },
    automationRequested: false,
    createdAt: "2026-08-08T00:00:03.000Z",
    ...overrides,
  };
}

function controllerReturnEnvelopeInput(group, binding, overrides = {}) {
  return {
    programId: IDS.program,
    demandId: IDS.demand,
    deliveryId: IDS.controllerDelivery,
    groupId: IDS.group,
    groupDigest: group.groupDigest,
    resultSetDigest: RESULT_SET_DIGEST,
    reviewSnapshotDigest: REVIEW_SNAPSHOT_DIGEST,
    preparedByHostId: "codex",
    windowId: IDS.controllerWindow,
    bindingId: binding.bindingId,
    identityBindingDigest: windowBindingDigest(binding),
    prompt: "Review this immutable result set and return the controller decision.",
    oneShot: true,
    transportPolicy: {
      kind: "direct-thread",
      missingIdentity: "rejected-before-send",
    },
    readbackPolicy: {
      required: true,
      maxObservations: 1,
    },
    automationRequested: true,
    createdAt: "2026-08-08T00:00:04.000Z",
    ...overrides,
  };
}

function targetLeaseFixture(envelope, packet, overrides = {}) {
  return createWindowCoordinationLeaseRecord({
    programId: envelope.programId,
    hostId: envelope.preparedByHostId,
    windowId: envelope.windowId,
    leaseId: "lease_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    demandId: envelope.demandId,
    targetTaskId: packet.targetTaskId,
    groupId: envelope.groupId,
    groupDigest: envelope.groupDigest,
    deliveryId: envelope.deliveryId,
    envelopeDigest: envelope.envelopeDigest,
    bindingId: envelope.bindingId,
    identityBindingDigest: envelope.identityBindingDigest,
    acquiredAt: "2026-08-08T00:00:05.000Z",
    expiresAt: "2026-08-08T01:00:05.000Z",
    ...overrides,
  });
}

function observedLeaseTuple(lease) {
  return {
    leaseId: lease.leaseId,
    leaseRef: windowCoordinationLeaseRef({ windowId: lease.windowId }),
    leaseDigest: lease.leaseDigest,
  };
}

function deliveryRunInput(envelope, overrides = {}) {
  return {
    programId: envelope.programId,
    demandId: envelope.demandId,
    runId: IDS.run,
    deliveryId: envelope.deliveryId,
    envelopeDigest: envelope.envelopeDigest,
    hostId: envelope.preparedByHostId,
    windowId: envelope.windowId,
    attemptOrdinal: 1,
    hostMethod: "send_message_to_thread",
    hostMode: "new-turn",
    transportStatus: "accepted",
    readback: {
      status: "confirmed",
      attempts: 1,
      evidence: [{
        kind: "host-readback",
        digest: READBACK_EVIDENCE_DIGEST,
      }],
    },
    createdAt: "2026-08-08T00:00:06.000Z",
    ...overrides,
  };
}

function rejectedRunInput(envelope, overrides = {}) {
  return deliveryRunInput(envelope, {
    transportStatus: "rejected-before-send",
    readback: {
      status: "unavailable",
      attempts: 0,
      evidence: [],
    },
    error: {
      code: "host-send-rejected-before-send",
      message: "The exact identity binding was unavailable before host send.",
    },
    ...overrides,
  });
}

test("T06 freezes program-generated transport IDs in the shared typed-ID codec", () => {
  assert.deepEqual(WAKEFLOW_ID_TYPES, [
    "archive",
    "confirmation",
    "demand",
    "delivery",
    "delivery-run",
    "dispatch-group",
    "dispatch-packet",
    "evidence",
    "pod",
    "pod-design-handoff",
    "pod-design-request",
    "program",
    "preservation",
    "repository",
    "requirement",
    "review-candidate",
    "surface",
    "target-result",
    "target-task",
    "task-package",
    "test-attempt",
    "test-card",
    "window",
  ]);
  assert.equal(generateWakeflowId("dispatch-group", () => UUIDS.group), IDS.group);
  assert.equal(generateWakeflowId("dispatch-packet", () => UUIDS.packet), IDS.packet);
  assert.equal(generateWakeflowId("delivery", () => UUIDS.delivery), IDS.delivery);
  assert.equal(generateWakeflowId("delivery-run", () => UUIDS.run), IDS.run);
  assert.equal(assertWakeflowId(IDS.group, "dispatch-group"), IDS.group);
  assert.throws(() => assertWakeflowId("GROUP-STATE", "dispatch-group"));
  assert.throws(() => assertWakeflowId(IDS.packet, "dispatch-group"));
});

test("T06 dispatch group is a closed single-target-capable immutable round manifest", () => {
  const record = createDispatchGroupRecord(groupInput());
  assert.equal(WAKEFLOW_DISPATCH_GROUP_KIND, "wakeflow-dispatch-group");
  assert.equal(record.artifactKind, WAKEFLOW_DISPATCH_GROUP_KIND);
  assert.equal(record.schemaVersion, WAKEFLOW_TRANSPORT_SCHEMA_VERSION);
  assert.equal(record.groupId, IDS.group);
  assert.equal(record.members.length, 1, "single-target rounds still require one group manifest");
  assert.equal(record.groupDigest, dispatchGroupDigest(record));
  assert.match(record.groupDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.members), true);
  assert.equal(Object.isFrozen(record.members[0]), true);
  assert.equal(Object.isFrozen(record.returnPolicy), true);
  assert.deepEqual(validateDispatchGroupRecord(record), record);
  assert.equal(
    dispatchGroupRef({ demandId: IDS.demand, groupId: IDS.group }),
    `.wakeflow-local/runtime/shared/transport/demands/${IDS.demand}/groups/${IDS.group}.json`,
  );

  const bytes = dispatchGroupCanonicalBytes(record);
  assert.equal(bytes.at(-1), 0x0a);
  assert.equal(JSON.parse(bytes).groupDigest, record.groupDigest);
  assert.deepEqual(dispatchGroupCanonicalBytes(createDispatchGroupRecord(groupInput())), bytes);

  const { groupDigest, ...unsignedRecord } = record;
  assert.equal(groupDigest, canonicalJsonDigest(unsignedRecord), "groupDigest excludes only itself");

  const changed = createDispatchGroupRecord(groupInput({
    members: [{
      windowId: IDS.targetWindow,
      targetTaskId: IDS.targetTask,
      packetId: IDS.otherPacket,
    }],
  }));
  assert.notEqual(changed.groupDigest, record.groupDigest);

  for (const changedInput of [
    { stateRevision: 8 },
    { controllerWindowId: IDS.targetWindow },
    { returnPolicy: { mode: "per-target" } },
  ]) {
    assert.notEqual(createDispatchGroupRecord(groupInput(changedInput)).groupDigest, record.groupDigest);
  }

  assert.throws(() => createDispatchGroupRecord(groupInput({ members: [] })));
  assert.throws(() => createDispatchGroupRecord(groupInput({ updatedAt: "2026-08-08T00:01:00.000Z" })));
  assert.throws(() => validateDispatchGroupRecord({ ...record, groupDigest: INVALID_DIGEST }));
  assert.throws(() => createDispatchGroupRecord(groupInput({
    members: [{ ...groupInput().members[0], unknown: true }],
  })));
  assert.throws(() => createDispatchGroupRecord(groupInput({
    returnPolicy: { mode: "group-ready", status: "ready" },
  })));

  let memberGetterCalls = 0;
  const activeMembers = new Array(1);
  Object.defineProperty(activeMembers, "0", {
    enumerable: true,
    get() {
      memberGetterCalls += 1;
      return groupInput().members[0];
    },
  });
  assert.throws(() => createDispatchGroupRecord(groupInput({ members: activeMembers })));
  assert.equal(memberGetterCalls, 0, "transport array admission must not execute getters");
});

test("T06 dispatch group preserves one complete deterministic ordered member set", () => {
  const first = groupInput().members[0];
  const second = {
    windowId: IDS.secondTargetWindow,
    targetTaskId: IDS.secondTargetTask,
    packetId: IDS.secondPacket,
  };
  const record = createDispatchGroupRecord(groupInput({ members: [first, second] }));
  assert.deepEqual(record.members, [first, second]);

  assert.throws(() => createDispatchGroupRecord(groupInput({ members: [second, first] })));
  assert.throws(() => createDispatchGroupRecord(groupInput({
    members: [first, { ...second, targetTaskId: first.targetTaskId }],
  })));
  assert.throws(() => createDispatchGroupRecord(groupInput({
    members: [first, { ...second, packetId: first.packetId }],
  })));
  assert.throws(() => createDispatchGroupRecord(groupInput({
    members: [first, { ...second, windowId: first.windowId, targetTaskId: first.targetTaskId }],
  })));
});

test("T06 dispatch-group schema is closed and matches the runtime record identity", () => {
  const schema = JSON.parse(readFileSync(
    new URL("../core/schemas/wakeflow-delivery/dispatch-group.schema.json", import.meta.url),
    "utf8",
  ));
  assert.equal(schema.$id, "urn:wakeflow:internal:delivery:dispatch-group:v1");
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.artifactKind.const, WAKEFLOW_DISPATCH_GROUP_KIND);
  assert.equal(schema.properties.schemaVersion.const, WAKEFLOW_TRANSPORT_SCHEMA_VERSION);
  assert.equal(schema.properties.members.minItems, 1);
  assert.equal(schema.properties.groupDigest.pattern, "^sha256:[0-9a-f]{64}$");
  assert.equal(schema.properties.members.items.$ref, "#/$defs/member");
  assert.equal(schema.$defs.member.additionalProperties, false);
  assert.equal(schema.properties.returnPolicy.$ref, "#/$defs/returnPolicy");
  assert.equal(schema.$defs.returnPolicy.additionalProperties, false);
  assert.deepEqual(schema.$defs.returnPolicy.properties.mode.enum, ["group-ready", "per-target"]);
  assert.equal(schema.properties.stateRef, undefined);
  assert.equal(schema.properties.stateDigest, undefined);
});

test("T06 packet freezes every target and review-consumed field into packetDigest", () => {
  const group = createDispatchGroupRecord(groupInput());
  const packet = createDispatchPacketRecord(packetInput(group));
  assert.equal(WAKEFLOW_DISPATCH_PACKET_KIND, "wakeflow-controller-dispatch-packet");
  assert.equal(packet.artifactKind, WAKEFLOW_DISPATCH_PACKET_KIND);
  assert.equal(packet.schemaVersion, WAKEFLOW_TRANSPORT_SCHEMA_VERSION);
  assert.equal(packet.groupRef, dispatchGroupRef({ demandId: IDS.demand, groupId: IDS.group }));
  assert.equal(
    packet.taskPackageRef,
    `task-packages/${IDS.taskPackage}.json`,
  );
  assert.equal(packet.packetDigest, dispatchPacketDigest(packet));
  const { packetDigest, ...unsignedPacket } = packet;
  assert.equal(packetDigest, canonicalJsonDigest(unsignedPacket), "packetDigest excludes only itself");
  assert.equal(Object.isFrozen(packet), true);
  assert.equal(Object.isFrozen(packet.taskBriefing), true);
  assert.equal(Object.isFrozen(packet.boundaries), true);
  assert.equal(Object.isFrozen(packet.acceptanceAnchors[0]), true);
  assert.equal(Object.isFrozen(packet.reviewInputContract), true);
  assert.deepEqual(validateDispatchPacketRecord(packet), packet);
  assert.deepEqual(validateDispatchPacketAgainstGroup({ packet, group }), packet);
  assert.equal(
    dispatchPacketRef({ demandId: IDS.demand, packetId: IDS.packet }),
    `.wakeflow-local/runtime/shared/transport/demands/${IDS.demand}/packets/${IDS.packet}.json`,
  );
  const bytes = dispatchPacketCanonicalBytes(packet);
  assert.equal(bytes.at(-1), 0x0a);
  assert.equal(JSON.parse(bytes).packetDigest, packet.packetDigest);

  const digestChanges = [
    { designIntent: "A different advisory design intent." },
    {
      reviewInputContract: {
        requiredKinds: ["focused-test", "source-diff"],
        requiredAcceptanceAnchorIds: ["anchor-transport-1"],
      },
    },
    { prompt: "A different exact target prompt." },
    { objective: "A different authorized objective." },
  ];
  for (const overrides of digestChanges) {
    const changed = createDispatchPacketRecord(packetInput(group, overrides));
    assert.notEqual(changed.packetDigest, packet.packetDigest);
  }
  const withoutDesignIntent = packetInput(group);
  delete withoutDesignIntent.designIntent;
  assert.equal(
    Object.hasOwn(createDispatchPacketRecord(withoutDesignIntent), "designIntent"),
    false,
  );
});

test("T06 packet is closed and cannot escape its exact group membership", () => {
  const group = createDispatchGroupRecord(groupInput());
  const packet = createDispatchPacketRecord(packetInput(group));

  assert.throws(() => createDispatchPacketRecord(packetInput(group, { windowConfig: {} })));
  assert.throws(() => createDispatchPacketRecord(packetInput(group, {
    taskBriefing: { ...packetInput(group).taskBriefing, cwd: "/private/target" },
  })));
  assert.throws(() => createDispatchPacketRecord(packetInput(group, {
    reviewInputContract: {
      requiredKinds: ["focused-test"],
      requiredAcceptanceAnchorIds: ["missing-anchor"],
    },
  })));
  assert.throws(() => createDispatchPacketRecord(packetInput(group, {
    acceptanceAnchors: [
      ...packetInput(group).acceptanceAnchors,
      {
        anchorId: "anchor-transport-2",
        claim: "A second required claim is satisfied.",
        probe: "Run the second focused probe.",
        expected: "The second probe passes.",
      },
    ],
  })));
  assert.throws(() => validateDispatchPacketRecord({ ...packet, packetDigest: INVALID_DIGEST }));

  const wrongMemberGroup = createDispatchGroupRecord(groupInput({
    members: [{ ...groupInput().members[0], packetId: IDS.otherPacket }],
  }));
  assert.throws(() => validateDispatchPacketAgainstGroup({ packet, group: wrongMemberGroup }));
  const wrongGroupDigestPacket = createDispatchPacketRecord(packetInput(group, {
    groupDigest: wrongMemberGroup.groupDigest,
  }));
  assert.throws(() => validateDispatchPacketAgainstGroup({
    packet: wrongGroupDigestPacket,
    group,
  }));
  for (const overrides of [
    { windowId: IDS.controllerWindow },
    { targetTaskId: IDS.secondTargetTask },
    { programId: IDS.otherProgram },
    { demandId: IDS.otherDemand },
  ]) {
    const mismatched = createDispatchPacketRecord(packetInput(group, overrides));
    assert.throws(() => validateDispatchPacketAgainstGroup({ packet: mismatched, group }));
  }
  assert.throws(() => createDispatchPacketRecord(packetInput(group, {
    evidenceContract: {
      requiredKinds: ["legacy-name"],
      requiredAcceptanceAnchorIds: ["anchor-transport-1"],
    },
  })));
  assert.throws(() => createDispatchPacketRecord(packetInput(group, {
    testContract: testPacketInput(group).testContract,
  })));
});

test("T06 packet preserves required Skill order and M2 ordered-set semantics", () => {
  const group = createDispatchGroupRecord(groupInput());
  const implementationPacket = createDispatchPacketRecord(packetInput(group));
  assert.deepEqual(implementationPacket.taskBriefing.requiredSkills, [
    "skills/wakeflow-target/SKILL.md",
    "skills/wakeflow-target-craft/SKILL.md",
  ]);

  const codeUnitOrdered = createDispatchPacketRecord(packetInput(group, {
    reviewInputContract: {
      requiredKinds: ["z", "ä"],
      requiredAcceptanceAnchorIds: ["anchor-transport-1"],
    },
  }));
  assert.deepEqual(codeUnitOrdered.reviewInputContract.requiredKinds, ["z", "ä"]);

  const anchorOrdered = createDispatchPacketRecord(packetInput(group, {
    acceptanceAnchors: [
      {
        anchorId: "anchor-Z",
        claim: "The first code-unit anchor is satisfied.",
        probe: "Run the first code-unit probe.",
        expected: "The first code-unit probe passes.",
      },
      {
        anchorId: "anchor-a",
        claim: "The second code-unit anchor is satisfied.",
        probe: "Run the second code-unit probe.",
        expected: "The second code-unit probe passes.",
      },
    ],
    reviewInputContract: {
      requiredKinds: ["focused-test"],
      requiredAcceptanceAnchorIds: ["anchor-Z", "anchor-a"],
    },
  }));
  assert.deepEqual(
    anchorOrdered.reviewInputContract.requiredAcceptanceAnchorIds,
    ["anchor-Z", "anchor-a"],
  );

  assert.throws(() => createDispatchPacketRecord(packetInput(group, {
    taskBriefing: {
      ...packetInput(group).taskBriefing,
      requiredSkills: ["skills/wakeflow-target-craft/SKILL.md"],
    },
  })));
  assert.throws(() => createDispatchPacketRecord(packetInput(group, {
    taskBriefing: {
      ...packetInput(group).taskBriefing,
      requiredSkills: [
        "skills/wakeflow-target-craft/SKILL.md",
        "skills/wakeflow-target/SKILL.md",
      ],
    },
  })));
  assert.throws(() => createDispatchPacketRecord(packetInput(group, {
    reviewInputContract: {
      requiredKinds: ["ä", "z"],
      requiredAcceptanceAnchorIds: ["anchor-transport-1"],
    },
  })));

  const testPacket = createDispatchPacketRecord(testPacketInput(group));
  assert.deepEqual(testPacket.taskBriefing.requiredSkills, [
    "skills/wakeflow-target/SKILL.md",
    "skills/wakeflow-test/SKILL.md",
  ]);
  const codeUnitOrderedTestPacket = createDispatchPacketRecord(testPacketInput(group, {
    testContract: {
      ...testPacketInput(group).testContract,
      executionContract: {
        ...testPacketInput(group).testContract.executionContract,
        allowedSkills: ["z", "ä"],
      },
    },
  }));
  assert.deepEqual(
    codeUnitOrderedTestPacket.testContract.executionContract.allowedSkills,
    ["z", "ä"],
  );

  const source = readFileSync(new URL(
    "../core/scripts/lib/wakeflow-transport-records.mjs",
    import.meta.url,
  ), "utf8");
  assert.doesNotMatch(source, /\.localeCompare\(/u);
});

test("T06 Test packet freezes only the exact TestCard and execution contract", () => {
  const group = createDispatchGroupRecord(groupInput());
  const packet = createDispatchPacketRecord(testPacketInput(group));
  assert.equal(packet.taskBriefing.workType, "test");
  assert.equal(Object.hasOwn(packet.taskBriefing, "commitExpectation"), false);
  assert.equal(Object.isFrozen(packet.testContract), true);
  assert.equal(Object.isFrozen(packet.testContract.executionContract), true);
  assert.deepEqual(Object.keys(packet.testContract), ["testCard", "executionContract"]);

  const changed = createDispatchPacketRecord(testPacketInput(group, {
    testContract: {
      ...testPacketInput(group).testContract,
      executionContract: {
        ...testPacketInput(group).testContract.executionContract,
        maxAttempts: 3,
      },
    },
  }));
  assert.notEqual(changed.packetDigest, packet.packetDigest);

  const missingTestContract = testPacketInput(group);
  delete missingTestContract.testContract;
  assert.throws(() => createDispatchPacketRecord(missingTestContract));
  assert.throws(() => createDispatchPacketRecord(testPacketInput(group, {
    taskBriefing: {
      ...testPacketInput(group).taskBriefing,
      commitExpectation: "leave-uncommitted",
    },
  })));
  assert.throws(() => createDispatchPacketRecord(testPacketInput(group, {
    reviewInputContract: {
      requiredKinds: ["test-report"],
      requiredAcceptanceAnchorIds: ["anchor-transport-1"],
    },
  })));

  assert.throws(() => createDispatchPacketRecord(testPacketInput(group, {
    testContract: {
      ...testPacketInput(group).testContract,
      attempt: { ordinal: 1, mode: "initial" },
    },
  })));
});

test("T06 dispatch-packet schema is closed through every nested contract", () => {
  const schema = JSON.parse(readFileSync(
    new URL("../core/schemas/wakeflow-delivery/dispatch-packet.schema.json", import.meta.url),
    "utf8",
  ));
  assert.equal(schema.$id, "urn:wakeflow:internal:delivery:dispatch-packet:v1");
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.artifactKind.const, WAKEFLOW_DISPATCH_PACKET_KIND);
  assert.equal(schema.properties.schemaVersion.const, WAKEFLOW_TRANSPORT_SCHEMA_VERSION);
  for (const definition of [
    "acceptanceAnchor",
    "boundaries",
    "resultContract",
    "reviewInputContract",
    "taskBriefing",
    "testContract",
  ]) {
    assert.equal(schema.$defs[definition].additionalProperties, false, definition);
  }
  assert.equal(schema.properties.windowConfig, undefined);
  assert.equal(schema.properties.handle, undefined);
  assert.equal(
    schema.$defs.taskBriefing.properties.requiredSkills.prefixItems[0].const,
    "skills/wakeflow-target/SKILL.md",
  );
  assert.equal(schema.$defs.testContract.properties.attempt, undefined);
});

test("T06 target delivery envelope freezes only immutable transport intent", () => {
  const group = createDispatchGroupRecord(groupInput());
  const packet = createDispatchPacketRecord(packetInput(group));
  const binding = bindingFixture();
  const envelope = createTargetDeliveryEnvelopeRecord(
    targetEnvelopeInput(group, packet, binding),
  );

  assert.equal(WAKEFLOW_TARGET_DELIVERY_ENVELOPE_KIND, "wakeflow-target-delivery-envelope");
  assert.equal(envelope.artifactKind, WAKEFLOW_TARGET_DELIVERY_ENVELOPE_KIND);
  assert.equal(envelope.schemaVersion, WAKEFLOW_TRANSPORT_SCHEMA_VERSION);
  assert.equal(envelope.groupRef, dispatchGroupRef({
    demandId: IDS.demand,
    groupId: IDS.group,
  }));
  assert.equal(envelope.packetRef, dispatchPacketRef({
    demandId: IDS.demand,
    packetId: IDS.packet,
  }));
  assert.equal(envelope.identityRef, windowBindingRef({
    hostDirName: "codex",
    windowId: IDS.targetWindow,
  }));
  assert.equal(envelope.correlationId, IDS.group);
  assert.equal(envelope.envelopeDigest, deliveryEnvelopeDigest(envelope));
  const { envelopeDigest, ...unsignedEnvelope } = envelope;
  assert.equal(
    envelopeDigest,
    canonicalJsonDigest(unsignedEnvelope),
    "envelopeDigest excludes only itself",
  );
  assert.equal(Object.isFrozen(envelope), true);
  assert.equal(Object.isFrozen(envelope.transportPolicy), true);
  assert.equal(Object.isFrozen(envelope.readbackPolicy), true);
  assert.deepEqual(validateDeliveryEnvelopeRecord(envelope), envelope);
  assert.deepEqual(validateTargetDeliveryEnvelopeAgainstSources({
    envelope,
    group,
    packet,
  }), envelope);

  const bytes = deliveryEnvelopeCanonicalBytes(envelope);
  assert.equal(bytes.at(-1), 0x0a);
  assert.equal(JSON.parse(bytes).envelopeDigest, envelope.envelopeDigest);
  assert.equal(bytes.includes(Buffer.from(RAW_CODEX_THREAD_HANDLE, "utf8")), false);
  assert.equal(JSON.stringify(envelope).includes(RAW_CODEX_THREAD_HANDLE), false);
  assert.equal(
    deliveryEnvelopeRef({ demandId: IDS.demand, deliveryId: IDS.delivery }),
    `.wakeflow-local/runtime/shared/transport/demands/${IDS.demand}/envelopes/${IDS.delivery}.json`,
  );
});

test("T06 target envelope closes group, packet, binding snapshot and T05 lease tuple", () => {
  const group = createDispatchGroupRecord(groupInput());
  const packet = createDispatchPacketRecord(packetInput(group));
  const binding = bindingFixture();
  const envelope = createTargetDeliveryEnvelopeRecord(
    targetEnvelopeInput(group, packet, binding),
  );

  const lease = createWindowCoordinationLeaseRecord({
    programId: envelope.programId,
    hostId: envelope.preparedByHostId,
    windowId: envelope.windowId,
    leaseId: "lease_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    demandId: envelope.demandId,
    targetTaskId: packet.targetTaskId,
    groupId: envelope.groupId,
    groupDigest: envelope.groupDigest,
    deliveryId: envelope.deliveryId,
    envelopeDigest: envelope.envelopeDigest,
    bindingId: envelope.bindingId,
    identityBindingDigest: envelope.identityBindingDigest,
    acquiredAt: "2026-08-08T00:00:05.000Z",
    expiresAt: "2026-08-08T01:00:05.000Z",
  });
  assert.equal(lease.groupRef, envelope.groupRef);
  assert.equal(lease.envelopeRef, deliveryEnvelopeRef({
    demandId: envelope.demandId,
    deliveryId: envelope.deliveryId,
  }));
  assert.equal(lease.identityRef, envelope.identityRef);

  for (const overrides of [
    { automationRequested: true },
    { prompt: "A different exact prompt." },
    { identityBindingDigest: `sha256:${"7".repeat(64)}` },
    { preparedByHostId: "claude-code" },
  ]) {
    const changed = createTargetDeliveryEnvelopeRecord(
      targetEnvelopeInput(group, packet, binding, overrides),
    );
    assert.notEqual(changed.envelopeDigest, envelope.envelopeDigest);
  }

  const changedGroup = createDispatchGroupRecord(groupInput({ stateRevision: 8 }));
  assert.throws(() => validateTargetDeliveryEnvelopeAgainstSources({
    envelope,
    group: changedGroup,
    packet,
  }));
  const changedPacket = createDispatchPacketRecord(packetInput(group, {
    prompt: "A different packet prompt.",
  }));
  assert.throws(() => validateTargetDeliveryEnvelopeAgainstSources({
    envelope,
    group,
    packet: changedPacket,
  }));
  for (const overrides of [
    { programId: IDS.otherProgram },
    { demandId: IDS.otherDemand },
    { windowId: IDS.controllerWindow },
    { packetId: IDS.otherPacket },
    { packetDigest: INVALID_DIGEST },
    { prompt: "A prompt not frozen by the packet." },
  ]) {
    const mismatched = createTargetDeliveryEnvelopeRecord(
      targetEnvelopeInput(group, packet, binding, overrides),
    );
    assert.throws(() => validateTargetDeliveryEnvelopeAgainstSources({
      envelope: mismatched,
      group,
      packet,
    }));
  }

  for (const overrides of [
    { windowConfig: {} },
    { handle: RAW_CODEX_THREAD_HANDLE },
    { stateRef: ".wakeflow-active/current.json" },
    { transportStatus: "accepted" },
    { targetResult: {} },
    { preparedByHostId: "unknown-host" },
    { oneShot: false },
    { transportPolicy: { kind: "direct-thread", missingIdentity: "retry" } },
    { readbackPolicy: { required: true, maxObservations: 2 } },
  ]) {
    assert.throws(() => createTargetDeliveryEnvelopeRecord(
      targetEnvelopeInput(group, packet, binding, overrides),
    ));
  }
  assert.throws(() => validateDeliveryEnvelopeRecord({
    ...envelope,
    envelopeDigest: INVALID_DIGEST,
  }));
});

test("T06 controller-return envelope carries digest-only review inputs", () => {
  const group = createDispatchGroupRecord(groupInput());
  const binding = bindingFixture(IDS.controllerWindow);
  const envelope = createControllerReturnEnvelopeRecord(
    controllerReturnEnvelopeInput(group, binding),
  );

  assert.equal(
    WAKEFLOW_CONTROLLER_RETURN_ENVELOPE_KIND,
    "wakeflow-controller-return-envelope",
  );
  assert.equal(envelope.artifactKind, WAKEFLOW_CONTROLLER_RETURN_ENVELOPE_KIND);
  assert.equal(envelope.deliveryId, IDS.controllerDelivery);
  assert.equal(envelope.resultSetDigest, RESULT_SET_DIGEST);
  assert.equal(envelope.reviewSnapshotDigest, REVIEW_SNAPSHOT_DIGEST);
  assert.equal(Object.hasOwn(envelope, "packetId"), false);
  assert.equal(Object.hasOwn(envelope, "resultSetRef"), false);
  assert.equal(Object.hasOwn(envelope, "reviewSnapshotRef"), false);
  assert.equal(envelope.envelopeDigest, deliveryEnvelopeDigest(envelope));
  assert.deepEqual(validateControllerReturnEnvelopeAgainstGroup({ envelope, group }), envelope);

  const changedGroup = createDispatchGroupRecord(groupInput({ stateRevision: 8 }));
  assert.throws(() => validateControllerReturnEnvelopeAgainstGroup({
    envelope,
    group: changedGroup,
  }));
  const wrongWindow = createControllerReturnEnvelopeRecord(
    controllerReturnEnvelopeInput(group, binding, { windowId: IDS.targetWindow }),
  );
  assert.throws(() => validateControllerReturnEnvelopeAgainstGroup({
    envelope: wrongWindow,
    group,
  }));
  assert.throws(() => createControllerReturnEnvelopeRecord(
    controllerReturnEnvelopeInput(group, binding, { packetId: IDS.packet }),
  ));
  assert.throws(() => createControllerReturnEnvelopeRecord(
    controllerReturnEnvelopeInput(group, binding, { resultSetDigest: undefined }),
  ));
  assert.throws(() => createControllerReturnEnvelopeRecord(
    controllerReturnEnvelopeInput(group, binding, { reviewSnapshotDigest: undefined }),
  ));
});

test("T06 delivery-envelope schema closes both variants and every nested policy", () => {
  const schema = JSON.parse(readFileSync(
    new URL("../core/schemas/wakeflow-delivery/delivery-envelope.schema.json", import.meta.url),
    "utf8",
  ));
  assert.equal(schema.$id, "urn:wakeflow:internal:delivery:delivery-envelope:v1");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.artifactKind.enum, [
    WAKEFLOW_CONTROLLER_RETURN_ENVELOPE_KIND,
    WAKEFLOW_TARGET_DELIVERY_ENVELOPE_KIND,
  ]);
  assert.equal(schema.properties.transportPolicy.$ref, "#/$defs/transportPolicy");
  assert.equal(schema.properties.readbackPolicy.$ref, "#/$defs/readbackPolicy");
  assert.equal(schema.$defs.transportPolicy.additionalProperties, false);
  assert.equal(schema.$defs.readbackPolicy.additionalProperties, false);
  assert.equal(schema.$defs.transportPolicy.properties.kind.const, "direct-thread");
  assert.equal(schema.$defs.readbackPolicy.properties.maxObservations.const, 1);
  assert.equal(schema.properties.windowConfig, undefined);
  assert.equal(schema.properties.handle, undefined);
  assert.equal(schema.properties.stateRef, undefined);
  assert.equal(schema.properties.transportStatus, undefined);
});

test("T06 delivery run is one immutable host attempt fact", () => {
  const group = createDispatchGroupRecord(groupInput());
  const packet = createDispatchPacketRecord(packetInput(group));
  const binding = bindingFixture();
  const envelope = createTargetDeliveryEnvelopeRecord(
    targetEnvelopeInput(group, packet, binding),
  );
  const lease = targetLeaseFixture(envelope, packet);
  const run = createDeliveryRunRecord(deliveryRunInput(envelope, {
    observedLease: observedLeaseTuple(lease),
  }));

  assert.equal(
    WAKEFLOW_DIRECT_THREAD_DELIVERY_RUN_KIND,
    "wakeflow-direct-thread-delivery-run",
  );
  assert.equal(run.artifactKind, WAKEFLOW_DIRECT_THREAD_DELIVERY_RUN_KIND);
  assert.equal(run.schemaVersion, WAKEFLOW_TRANSPORT_SCHEMA_VERSION);
  assert.equal(run.envelopeRef, deliveryEnvelopeRef({
    demandId: IDS.demand,
    deliveryId: IDS.delivery,
  }));
  assert.equal(run.runDigest, deliveryRunDigest(run));
  const { runDigest, ...unsignedRun } = run;
  assert.equal(runDigest, canonicalJsonDigest(unsignedRun), "runDigest excludes only itself");
  assert.equal(Object.isFrozen(run), true);
  assert.equal(Object.isFrozen(run.readback), true);
  assert.equal(Object.isFrozen(run.readback.evidence), true);
  assert.equal(Object.isFrozen(run.readback.evidence[0]), true);
  assert.equal(Object.isFrozen(run.observedLease), true);
  assert.deepEqual(validateDeliveryRunRecord(run), run);
  assert.deepEqual(validateDeliveryRunAgainstSources({
    run,
    envelope,
    lease,
  }), run);
  assert.deepEqual(
    validateDeliveryRunAgainstSources({ run, envelope }),
    run,
    "historical validation must not require the observed lease to remain current",
  );
  assert.deepEqual(validateDeliveryRunChain({ runs: [run] }), [run]);

  const bytes = deliveryRunCanonicalBytes(run);
  assert.equal(bytes.at(-1), 0x0a);
  assert.equal(JSON.parse(bytes).runDigest, run.runDigest);
  assert.equal(
    deliveryRunRef({ demandId: IDS.demand, runId: IDS.run }),
    `.wakeflow-local/runtime/shared/transport/demands/${IDS.demand}/runs/${IDS.run}.json`,
  );
});

test("T06 delivery run digest covers every fact and rejects legacy authority fields", () => {
  const group = createDispatchGroupRecord(groupInput());
  const packet = createDispatchPacketRecord(packetInput(group));
  const binding = bindingFixture();
  const envelope = createTargetDeliveryEnvelopeRecord(
    targetEnvelopeInput(group, packet, binding),
  );
  const lease = targetLeaseFixture(envelope, packet);
  const baseInput = deliveryRunInput(envelope, {
    observedLease: observedLeaseTuple(lease),
  });
  const run = createDeliveryRunRecord(baseInput);

  for (const overrides of [
    { hostMethod: "codex-send-message" },
    { hostMode: "resume-existing" },
    {
      readback: {
        ...baseInput.readback,
        evidence: [{
          kind: "host-readback",
          digest: `sha256:${"9".repeat(64)}`,
        }],
      },
    },
    {
      observedLease: {
        ...baseInput.observedLease,
        leaseDigest: `sha256:${"a".repeat(64)}`,
      },
    },
    {
      error: {
        code: "host-readback-warning",
        message: "The accepted send had a bounded readback warning.",
      },
    },
  ]) {
    const changed = createDeliveryRunRecord({ ...baseInput, ...overrides });
    assert.notEqual(changed.runDigest, run.runDigest);
  }

  for (const forbidden of [
    { status: "sent" },
    { stateRef: ".wakeflow-active/current.json" },
    { targetResult: {} },
    { reviewDecision: "accept" },
    { retryAllowed: true },
    { leaseValid: true },
    { threadId: RAW_CODEX_THREAD_HANDLE },
    { command: "node scripts/send.mjs" },
    { keepLive: {} },
    { wakeflowTrace: {} },
  ]) {
    assert.throws(() => createDeliveryRunRecord({ ...baseInput, ...forbidden }));
  }
  for (const invalid of [
    { hostId: "unknown-host" },
    { hostMethod: "unknown" },
    { hostMethod: "node scripts/send.mjs" },
    { hostMode: "unknown" },
    {
      readback: {
        status: "confirmed",
        attempts: 0,
        evidence: [],
      },
    },
    {
      readback: {
        status: "pending",
        attempts: 1,
        evidence: [],
      },
    },
    {
      readback: {
        status: "unavailable",
        attempts: 2,
        evidence: [],
      },
    },
    {
      readback: {
        status: "unavailable",
        attempts: 0,
        evidence: [{ kind: "host-readback", digest: READBACK_EVIDENCE_DIGEST }],
      },
    },
  ]) {
    assert.throws(() => createDeliveryRunRecord({ ...baseInput, ...invalid }));
  }
  assert.throws(() => validateDeliveryRunRecord({ ...run, runDigest: INVALID_DIGEST }));
});

test("T06 delivery run attempt lineage is continuous and cannot fork", () => {
  const group = createDispatchGroupRecord(groupInput());
  const packet = createDispatchPacketRecord(packetInput(group));
  const binding = bindingFixture();
  const envelope = createTargetDeliveryEnvelopeRecord(
    targetEnvelopeInput(group, packet, binding),
  );
  const lease = targetLeaseFixture(envelope, packet);
  const initial = createDeliveryRunRecord(rejectedRunInput(envelope, {
    observedLease: observedLeaseTuple(lease),
  }));
  const previousRun = {
    runId: initial.runId,
    ref: deliveryRunRef({ demandId: initial.demandId, runId: initial.runId }),
    digest: initial.runDigest,
  };
  const retry = createDeliveryRunRecord(deliveryRunInput(envelope, {
    runId: IDS.secondRun,
    attemptOrdinal: 2,
    previousRun,
    observedLease: observedLeaseTuple(lease),
    createdAt: "2026-08-08T00:00:07.000Z",
  }));
  assert.deepEqual(validateDeliveryRunAgainstSources({
    run: retry,
    envelope,
    previousRun: initial,
    lease,
  }), retry);
  assert.deepEqual(validateDeliveryRunChain({ runs: [retry, initial] }), [initial, retry]);
  assert.deepEqual(validateDeliveryRunChain({ runs: [] }), []);

  assert.throws(() => createDeliveryRunRecord(rejectedRunInput(envelope, {
    previousRun,
  })));
  assert.throws(() => createDeliveryRunRecord(deliveryRunInput(envelope, {
    runId: IDS.secondRun,
    attemptOrdinal: 2,
  })));
  assert.throws(() => createDeliveryRunRecord(deliveryRunInput(envelope, {
    runId: IDS.secondRun,
    attemptOrdinal: 2,
    previousRun: {
      ...previousRun,
      runId: IDS.secondRun,
      ref: deliveryRunRef({ demandId: IDS.demand, runId: IDS.secondRun }),
    },
  })));
  assert.throws(() => createDeliveryRunRecord(deliveryRunInput(envelope, {
    runId: IDS.secondRun,
    attemptOrdinal: 2,
    previousRun: {
      ...previousRun,
      ref: deliveryRunRef({ demandId: IDS.demand, runId: IDS.thirdRun }),
    },
  })));

  const gap = createDeliveryRunRecord(deliveryRunInput(envelope, {
    runId: IDS.thirdRun,
    attemptOrdinal: 3,
    previousRun,
  }));
  assert.throws(() => validateDeliveryRunAgainstSources({
    run: gap,
    envelope,
    previousRun: initial,
    lease,
  }));
  const wrongDigest = createDeliveryRunRecord(deliveryRunInput(envelope, {
    runId: IDS.thirdRun,
    attemptOrdinal: 2,
    previousRun: { ...previousRun, digest: INVALID_DIGEST },
  }));
  assert.throws(() => validateDeliveryRunAgainstSources({
    run: wrongDigest,
    envelope,
    previousRun: initial,
    lease,
  }));
  const fork = createDeliveryRunRecord(deliveryRunInput(envelope, {
    runId: IDS.thirdRun,
    attemptOrdinal: 2,
    previousRun,
    observedLease: observedLeaseTuple(lease),
    createdAt: "2026-08-08T00:00:08.000Z",
  }));
  assert.throws(() => validateDeliveryRunChain({ runs: [initial, retry, fork] }));
});

test("T06 run keeps transport and readback independent across envelope variants", () => {
  const group = createDispatchGroupRecord(groupInput());
  const packet = createDispatchPacketRecord(packetInput(group));
  const targetBinding = bindingFixture();
  const targetEnvelope = createTargetDeliveryEnvelopeRecord(
    targetEnvelopeInput(group, packet, targetBinding),
  );
  const lease = targetLeaseFixture(targetEnvelope, packet);

  const acceptedUnavailable = createDeliveryRunRecord(deliveryRunInput(targetEnvelope, {
    readback: { status: "unavailable", attempts: 0, evidence: [] },
    observedLease: observedLeaseTuple(lease),
  }));
  assert.deepEqual(validateDeliveryRunAgainstSources({
    run: acceptedUnavailable,
    envelope: targetEnvelope,
    lease,
  }), acceptedUnavailable);
  const acceptedUnavailableAfterObservation = createDeliveryRunRecord(deliveryRunInput(
    targetEnvelope,
    {
      readback: {
        status: "unavailable",
        attempts: 1,
        evidence: [{ kind: "host-readback", digest: READBACK_EVIDENCE_DIGEST }],
      },
      observedLease: observedLeaseTuple(lease),
    },
  ));
  assert.equal(acceptedUnavailableAfterObservation.readback.attempts, 1);

  const ambiguousConfirmed = createDeliveryRunRecord(deliveryRunInput(targetEnvelope, {
    transportStatus: "ambiguous",
    observedLease: observedLeaseTuple(lease),
    error: {
      code: "host-send-ambiguous",
      message: "The adapter could not classify transport acceptance conclusively.",
    },
  }));
  assert.equal(ambiguousConfirmed.transportStatus, "ambiguous");
  assert.equal(ambiguousConfirmed.readback.status, "confirmed");

  assert.throws(() => createDeliveryRunRecord({
    ...rejectedRunInput(targetEnvelope),
    readback: deliveryRunInput(targetEnvelope).readback,
  }));
  const rejectedWithoutError = rejectedRunInput(targetEnvelope);
  delete rejectedWithoutError.error;
  assert.throws(() => createDeliveryRunRecord(rejectedWithoutError));
  assert.throws(() => createDeliveryRunRecord(deliveryRunInput(targetEnvelope, {
    transportStatus: "ambiguous",
  })));

  const controllerBinding = bindingFixture(IDS.controllerWindow);
  const controllerEnvelope = createControllerReturnEnvelopeRecord(
    controllerReturnEnvelopeInput(group, controllerBinding),
  );
  const controllerRun = createDeliveryRunRecord(deliveryRunInput(controllerEnvelope, {
    runId: IDS.controllerRun,
  }));
  assert.deepEqual(validateDeliveryRunAgainstSources({
    run: controllerRun,
    envelope: controllerEnvelope,
  }), controllerRun);

  const controllerWithLease = createDeliveryRunRecord(deliveryRunInput(controllerEnvelope, {
    runId: IDS.controllerRun,
    observedLease: {
      ...observedLeaseTuple(lease),
      leaseRef: windowCoordinationLeaseRef({ windowId: controllerEnvelope.windowId }),
    },
  }));
  assert.throws(() => validateDeliveryRunAgainstSources({
    run: controllerWithLease,
    envelope: controllerEnvelope,
    lease,
  }));
  assert.throws(() => validateDeliveryRunAgainstSources({
    run: controllerWithLease,
    envelope: controllerEnvelope,
  }));

  for (const overrides of [
    { envelopeDigest: INVALID_DIGEST },
    { hostId: "claude-code" },
    { windowId: IDS.targetWindow },
    { deliveryId: IDS.delivery },
  ]) {
    const mismatched = createDeliveryRunRecord(deliveryRunInput(controllerEnvelope, {
      runId: IDS.controllerRun,
      ...overrides,
    }));
    assert.throws(() => validateDeliveryRunAgainstSources({
      run: mismatched,
      envelope: controllerEnvelope,
    }));
  }

  const mismatchedLease = targetLeaseFixture(targetEnvelope, packet, {
    envelopeDigest: INVALID_DIGEST,
  });
  assert.throws(() => validateDeliveryRunAgainstSources({
    run: acceptedUnavailable,
    envelope: targetEnvelope,
    lease: mismatchedLease,
  }));
});

test("T06 delivery-run schema is closed through lineage, evidence, lease and error", () => {
  const schema = JSON.parse(readFileSync(
    new URL("../core/schemas/wakeflow-delivery/delivery-run.schema.json", import.meta.url),
    "utf8",
  ));
  assert.equal(schema.$id, "urn:wakeflow:internal:delivery:delivery-run:v1");
  assert.equal(schema.additionalProperties, false);
  assert.equal(
    schema.properties.artifactKind.const,
    WAKEFLOW_DIRECT_THREAD_DELIVERY_RUN_KIND,
  );
  assert.deepEqual(schema.properties.transportStatus.enum, [
    "accepted",
    "ambiguous",
    "rejected-before-send",
  ]);
  for (const definition of [
    "error",
    "observedLease",
    "previousRun",
    "readback",
    "readbackEvidence",
  ]) {
    assert.equal(schema.$defs[definition].additionalProperties, false, definition);
  }
  assert.equal(schema.properties.status, undefined);
  assert.equal(schema.properties.stateRef, undefined);
  assert.equal(schema.properties.targetResult, undefined);
  assert.equal(schema.properties.thread, undefined);
  assert.equal(schema.properties.hostAction, undefined);
  assert.equal(schema.properties.wakeflowTrace, undefined);
});
