import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import fs, {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createControllerReturnEnvelopeRecord,
  createDeliveryRunRecord,
  createDispatchGroupRecord,
  createDispatchPacketRecord,
  createTargetDeliveryEnvelopeRecord,
  deliveryEnvelopeCanonicalBytes,
  deliveryEnvelopeRef,
  deliveryRunCanonicalBytes,
  deliveryRunRef,
  dispatchGroupCanonicalBytes,
  dispatchGroupRef,
  dispatchPacketCanonicalBytes,
  dispatchPacketRef,
} from "../core/scripts/lib/wakeflow-transport-records.mjs";
import {
  appendDeliveryRun,
  appendDeliveryRunAdmitted,
  inspectTransportDemandAuthority,
  inspectTransportDemandForLayout,
  publishDeliveryEnvelope,
  publishDeliveryEnvelopeAdmitted,
  publishDispatchGroup,
  publishDispatchGroupAdmitted,
  publishDispatchPacket,
  publishDispatchPacketAdmitted,
  createTransportDemandReleaseParticipant,
} from "../core/scripts/lib/wakeflow-transport-store.mjs";
import {
  inspectWakeflowWorkspaceMutation,
  withWakeflowRuntimeMutation,
} from "../core/scripts/lib/wakeflow-workspace-mutation.mjs";

const UUIDS = Object.freeze({
  program: "10000000-0000-4000-8000-000000000001",
  demand: "10000000-0000-4000-8000-000000000002",
  otherDemand: "10000000-0000-4000-8000-000000000003",
  controllerWindow: "10000000-0000-4000-8000-000000000004",
  targetWindow: "10000000-0000-4000-8000-000000000005",
  targetTask: "10000000-0000-4000-8000-000000000006",
  group: "10000000-0000-4000-8000-000000000007",
  otherGroup: "10000000-0000-4000-8000-000000000008",
  packet: "10000000-0000-4000-8000-000000000009",
  otherPacket: "10000000-0000-4000-8000-00000000000a",
  taskPackage: "10000000-0000-4000-8000-00000000000b",
  delivery: "10000000-0000-4000-8000-00000000000c",
  controllerDelivery: "10000000-0000-4000-8000-00000000000d",
  otherDelivery: "10000000-0000-4000-8000-00000000000e",
  run: "10000000-0000-4000-8000-00000000000f",
  secondRun: "10000000-0000-4000-8000-000000000010",
  forkRun: "10000000-0000-4000-8000-000000000011",
  gapRun: "10000000-0000-4000-8000-000000000012",
  controllerRun: "10000000-0000-4000-8000-000000000013",
});

const IDS = Object.freeze({
  program: `program_${UUIDS.program}`,
  demand: `demand_${UUIDS.demand}`,
  otherDemand: `demand_${UUIDS.otherDemand}`,
  controllerWindow: `window_${UUIDS.controllerWindow}`,
  targetWindow: `window_${UUIDS.targetWindow}`,
  targetTask: `target-task_${UUIDS.targetTask}`,
  group: `dispatch-group_${UUIDS.group}`,
  otherGroup: `dispatch-group_${UUIDS.otherGroup}`,
  packet: `dispatch-packet_${UUIDS.packet}`,
  otherPacket: `dispatch-packet_${UUIDS.otherPacket}`,
  taskPackage: `task-package_${UUIDS.taskPackage}`,
  delivery: `delivery_${UUIDS.delivery}`,
  controllerDelivery: `delivery_${UUIDS.controllerDelivery}`,
  otherDelivery: `delivery_${UUIDS.otherDelivery}`,
  run: `delivery-run_${UUIDS.run}`,
  secondRun: `delivery-run_${UUIDS.secondRun}`,
  forkRun: `delivery-run_${UUIDS.forkRun}`,
  gapRun: `delivery-run_${UUIDS.gapRun}`,
  controllerRun: `delivery-run_${UUIDS.controllerRun}`,
});

const TRANSPORT_ROOT_REF = ".wakeflow-local/runtime/shared/transport";
const DEMANDS_ROOT_REF = `${TRANSPORT_ROOT_REF}/demands`;
const RECORD_DIRECTORIES = Object.freeze(["envelopes", "groups", "packets", "runs"]);
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const IDENTITY_BINDING_DIGEST = `sha256:${"3".repeat(64)}`;
const RESULT_SET_DIGEST = `sha256:${"4".repeat(64)}`;
const REVIEW_SNAPSHOT_DIGEST = `sha256:${"5".repeat(64)}`;
const READBACK_EVIDENCE_DIGEST = `sha256:${"6".repeat(64)}`;
const BINDING_ID = "binding_10000000-0000-4000-8000-000000000014";
const CONTROLLER_BINDING_ID = "binding_10000000-0000-4000-8000-000000000015";
const MAX_DIAGNOSTIC_ISSUES = 64;
const MAX_DIAGNOSTIC_JSON_BYTES = 64 * 1024;

function portablePath(workspaceRoot, ref) {
  return path.resolve(workspaceRoot, ...ref.split("/"));
}

function ensurePrivateDirectory(workspaceRoot, ref) {
  let current = workspaceRoot;
  for (const segment of ref.split("/")) {
    current = path.join(current, segment);
    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 });
    chmodSync(current, 0o700);
  }
  return current;
}

function prepareWorkspace(t) {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-transport-store-v3-"));
  const workspaceRoot = path.join(fixtureRoot, "Program");
  mkdirSync(workspaceRoot, { mode: 0o700 });
  ensurePrivateDirectory(workspaceRoot, ".wakeflow-local/runtime/maintenance/transactions");
  ensurePrivateDirectory(workspaceRoot, DEMANDS_ROOT_REF);
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  return workspaceRoot;
}

function groupInput({
  demandId = IDS.demand,
  groupId = IDS.group,
  packetId = IDS.packet,
  stateRevision = 7,
} = {}) {
  return {
    programId: IDS.program,
    demandId,
    groupId,
    stateRevision,
    controllerWindowId: IDS.controllerWindow,
    members: [{
      windowId: IDS.targetWindow,
      targetTaskId: IDS.targetTask,
      packetId,
    }],
    returnPolicy: { mode: "group-ready" },
    createdAt: "2026-08-08T00:00:00.000Z",
  };
}

function packetInput(group) {
  return {
    programId: group.programId,
    demandId: group.demandId,
    groupId: group.groupId,
    groupDigest: group.groupDigest,
    packetId: group.members[0].packetId,
    windowId: group.members[0].windowId,
    targetTaskId: group.members[0].targetTaskId,
    taskPackageId: IDS.taskPackage,
    taskPackageDigest: `sha256:${"2".repeat(64)}`,
    objective: "Implement only the bounded Wakeflow transport task.",
    taskBriefing: {
      workType: "implementation",
      confirmedContext: ["The transport requirement and source boundary are confirmed."],
      completionExpectations: ["Return focused verification evidence."],
      requiredSkills: [
        "skills/wakeflow-target/SKILL.md",
        "skills/wakeflow-target-craft/SKILL.md",
      ],
      commitExpectation: "leave-uncommitted",
    },
    boundaries: {
      inScope: ["Only the assigned immutable dispatch packet."],
      outOfScope: ["Public v2 delivery behavior."],
      forbidden: ["Do not reconstruct a missing dispatch group."],
    },
    acceptanceAnchors: [{
      anchorId: "anchor-transport-store-1",
      claim: "The transport store preserves the immutable ancestor chain.",
      probe: "Run the focused transport-store regression test.",
      expected: "A packet without its exact group ancestor is rejected.",
    }],
    reviewInputContract: {
      requiredKinds: ["focused-test"],
      requiredAcceptanceAnchorIds: ["anchor-transport-store-1"],
    },
    resultContract: {
      artifactKind: "wakeflow-target-result",
      schemaVersion: 1,
    },
    contextPolicy: "refresh-if-missing",
    prompt: "Execute only this immutable packet and return one strict TargetResult.",
    createdAt: "2026-08-08T00:00:01.000Z",
  };
}

function targetEnvelopeInput(group, packet, overrides = {}) {
  return {
    programId: group.programId,
    demandId: group.demandId,
    deliveryId: IDS.delivery,
    groupId: group.groupId,
    groupDigest: group.groupDigest,
    packetId: packet.packetId,
    packetDigest: packet.packetDigest,
    preparedByHostId: "codex",
    windowId: packet.windowId,
    bindingId: BINDING_ID,
    identityBindingDigest: IDENTITY_BINDING_DIGEST,
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
    createdAt: "2026-08-08T00:00:02.000Z",
    ...overrides,
  };
}

function controllerEnvelopeInput(group, overrides = {}) {
  return {
    programId: group.programId,
    demandId: group.demandId,
    deliveryId: IDS.controllerDelivery,
    groupId: group.groupId,
    groupDigest: group.groupDigest,
    resultSetDigest: RESULT_SET_DIGEST,
    reviewSnapshotDigest: REVIEW_SNAPSHOT_DIGEST,
    preparedByHostId: "codex",
    windowId: group.controllerWindowId,
    bindingId: CONTROLLER_BINDING_ID,
    identityBindingDigest: IDENTITY_BINDING_DIGEST,
    prompt: "Review only this immutable result set and return the controller decision.",
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
    createdAt: "2026-08-08T00:00:03.000Z",
    ...overrides,
  };
}

function runInput(envelope, overrides = {}) {
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
    createdAt: "2026-08-08T00:00:04.000Z",
    ...overrides,
  };
}

function previousRunTuple(run) {
  return {
    runId: run.runId,
    ref: deliveryRunRef({ demandId: run.demandId, runId: run.runId }),
    digest: run.runDigest,
  };
}

function inspectInput(workspaceRoot, demandId = IDS.demand) {
  return {
    workspaceRoot,
    programId: IDS.program,
    demandId,
  };
}

function publishInput(workspaceRoot, record) {
  return {
    workspaceRoot,
    programId: record.programId,
    demandId: record.demandId,
    record,
  };
}

async function runGroupPublisherChild(workspaceRoot, record) {
  const moduleUrl = new URL(
    "../core/scripts/lib/wakeflow-transport-store.mjs",
    import.meta.url,
  ).href;
  const source = `
    import { publishDispatchGroup } from ${JSON.stringify(moduleUrl)};
    const input = ${JSON.stringify({
      workspaceRoot,
      programId: record.programId,
      demandId: record.demandId,
      record,
      acquireTimeoutMs: 5_000,
    })};
    try {
      const value = await publishDispatchGroup(input);
      process.stdout.write(JSON.stringify({ outcome: "success", status: value.status }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ outcome: "rejected", code: error?.code ?? null }));
      process.exitCode = 2;
    }
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [code, signal] = await once(child, "exit");
  return {
    code,
    signal,
    stderr,
    payload: stdout ? JSON.parse(stdout) : null,
  };
}

function ensureCompleteDemandTree(workspaceRoot, demandId = IDS.demand) {
  const demandRef = `${DEMANDS_ROOT_REF}/${demandId}`;
  ensurePrivateDirectory(workspaceRoot, demandRef);
  for (const directory of RECORD_DIRECTORIES) {
    ensurePrivateDirectory(workspaceRoot, `${demandRef}/${directory}`);
  }
  return portablePath(workspaceRoot, demandRef);
}

function writePrivateRecord(workspaceRoot, ref, bytes) {
  const target = portablePath(workspaceRoot, ref);
  ensurePrivateDirectory(
    workspaceRoot,
    path.relative(workspaceRoot, path.dirname(target)).split(path.sep).join("/"),
  );
  writeFileSync(target, bytes, { mode: 0o600, flag: "wx" });
  chmodSync(target, 0o600);
  return target;
}

function groupRef(record) {
  return dispatchGroupRef({
    demandId: record.demandId,
    groupId: record.groupId,
  });
}

function packetRef(record) {
  return dispatchPacketRef({ demandId: record.demandId, packetId: record.packetId });
}

function envelopeRef(record) {
  return deliveryEnvelopeRef({ demandId: record.demandId, deliveryId: record.deliveryId });
}

function runRef(record) {
  return deliveryRunRef({ demandId: record.demandId, runId: record.runId });
}

function assertPrivateDirectory(target) {
  const stat = lstatSync(target);
  assert.equal(stat.isDirectory(), true, `${target} must be a directory`);
  assert.equal(stat.isSymbolicLink(), false, `${target} must not be a symlink`);
  assert.equal(stat.mode & 0o777, 0o700, `${target} must use mode 0700`);
}

function assertPrivateCanonicalFile(target, expectedBytes) {
  const stat = lstatSync(target);
  assert.equal(stat.isFile(), true, `${target} must be a regular file`);
  assert.equal(stat.isSymbolicLink(), false, `${target} must not be a symlink`);
  assert.equal(stat.nlink, 1, `${target} must have one private source inode`);
  assert.equal(stat.mode & 0o777, 0o600, `${target} must use mode 0600`);
  assert.deepEqual(readFileSync(target), expectedBytes);
}

function treeRefs(root, current = root, refs = []) {
  if (!existsSync(current)) return refs;
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    refs.push(path.relative(root, absolute).split(path.sep).join("/"));
    if (entry.isDirectory()) treeRefs(root, absolute, refs);
  }
  return refs;
}

function assertNoLegacyTransportArtifacts(workspaceRoot) {
  assert.deepEqual(
    readdirSync(portablePath(workspaceRoot, TRANSPORT_ROOT_REF)),
    ["demands"],
    "the v3 transport root must not grow a private lock or flat-record directory",
  );
  assert.equal(
    existsSync(portablePath(workspaceRoot, ".wakeflow-local/wakeflow-delivery")),
    false,
    "the isolated v3 store must not create or consult the frozen public-v2 tree",
  );
  const refs = treeRefs(portablePath(workspaceRoot, ".wakeflow-local"));
  assert.deepEqual(
    refs.filter((ref) => /(?:\.lock|\.record-lock|\.guard)$/u.test(ref)),
    [],
    "T06 must not leave an old private group, run, or lease lock",
  );
}

function assertRejectedOutcome(result, pattern) {
  assert.equal(result?.then, undefined, "an admitted rejection must settle synchronously");
  assert.equal(result?.outcome, "rejected");
  assert.match(`${result.code ?? ""} ${result.message ?? ""}`, pattern);
}

function assertBoundedDiagnostic(diagnostic, workspaceRoot) {
  assert.equal(diagnostic.status, "degraded");
  assert.ok(Array.isArray(diagnostic.issues));
  assert.ok(diagnostic.issues.length > 0);
  assert.ok(diagnostic.issues.length <= MAX_DIAGNOSTIC_ISSUES);
  const serialized = JSON.stringify(diagnostic.issues);
  assert.ok(Buffer.byteLength(serialized, "utf8") <= MAX_DIAGNOSTIC_JSON_BYTES);
  assert.equal(serialized.includes(workspaceRoot), false, "diagnostics must not expose cwd");
  assert.equal(serialized.includes("unknown-"), false, "diagnostics must not expose dynamic filenames");
  assert.equal(
    serialized.includes("Execute only this immutable packet"),
    false,
    "diagnostics must not expose packet prompts",
  );
  assert.match(serialized, /preserve|migrate|manual/iu);
}

test("T06 strict transport inventory distinguishes a missing demand without legacy fallback", (t) => {
  const workspaceRoot = prepareWorkspace(t);
  const inventory = inspectTransportDemandAuthority(inspectInput(workspaceRoot));

  assert.equal(inventory.status, "missing");
  assert.equal(inventory.programId, IDS.program);
  assert.equal(inventory.demandId, IDS.demand);
  assert.deepEqual(inventory.entries, {
    groups: [],
    packets: [],
    envelopes: [],
    runs: [],
  });
  assert.match(inventory.inventoryDigest, DIGEST_RE);
  assertNoLegacyTransportArtifacts(workspaceRoot);
});

test("T06 admitted store publishes one canonical group and rejects divergent or orphan writes", async (t) => {
  const workspaceRoot = prepareWorkspace(t);
  const group = createDispatchGroupRecord(groupInput());
  const divergentGroup = createDispatchGroupRecord(groupInput({ stateRevision: 8 }));
  const orphanGroup = createDispatchGroupRecord(groupInput({
    demandId: IDS.otherDemand,
    groupId: IDS.otherGroup,
    packetId: IDS.otherPacket,
  }));
  const orphanPacket = createDispatchPacketRecord(packetInput(orphanGroup));
  let expiredContext = null;
  let createdInventoryDigest = null;

  assert.throws(
    () => publishDispatchGroupAdmitted({
      ...publishInput(workspaceRoot, group),
      mutationContext: {},
    }),
    /context|forgery|mutation/iu,
  );

  await withWakeflowRuntimeMutation({
    workspaceRoot,
    operationKind: "transport-store-admitted-test",
    domainOwner: "delivery-runtime",
  }, (mutationContext) => {
    expiredContext = mutationContext;
    const created = publishDispatchGroupAdmitted({
      ...publishInput(workspaceRoot, group),
      mutationContext,
    });
    assert.equal(created?.then, undefined, "admitted publish must complete synchronously");
    assert.equal(created.outcome, "success");
    assert.equal(created.value.status, "created");
    assert.equal(created.value.ref, groupRef(group));
    assert.equal(created.value.digest, group.groupDigest);
    assert.deepEqual(created.value.record, group);
    assert.match(created.value.inventoryDigest, DIGEST_RE);
    createdInventoryDigest = created.value.inventoryDigest;

    const replayed = publishDispatchGroupAdmitted({
      ...publishInput(workspaceRoot, group),
      mutationContext,
    });
    assert.equal(replayed?.then, undefined, "admitted replay must complete synchronously");
    assert.equal(replayed.outcome, "success");
    assert.equal(replayed.value.status, "replayed");
    assert.deepEqual(replayed.value.record, group);
    assert.equal(replayed.value.inventoryDigest, created.value.inventoryDigest);

    assertRejectedOutcome(
      publishDispatchGroupAdmitted({
        ...publishInput(workspaceRoot, divergentGroup),
        mutationContext,
      }),
      /conflict|different|immutable|same-id/iu,
    );
    assertRejectedOutcome(
      publishDispatchPacketAdmitted({
        ...publishInput(workspaceRoot, orphanPacket),
        mutationContext,
      }),
      /ancestor|dispatch group|group.*missing|integrity/iu,
    );
  });

  const demandRoot = portablePath(workspaceRoot, `${DEMANDS_ROOT_REF}/${IDS.demand}`);
  assertPrivateDirectory(demandRoot);
  assert.deepEqual(readdirSync(demandRoot).sort(), RECORD_DIRECTORIES);
  for (const directory of RECORD_DIRECTORIES) {
    assertPrivateDirectory(path.join(demandRoot, directory));
  }
  const groupFile = portablePath(workspaceRoot, groupRef(group));
  assertPrivateCanonicalFile(groupFile, dispatchGroupCanonicalBytes(group));
  assert.deepEqual(readdirSync(path.dirname(groupFile)), [`${group.groupId}.json`]);

  const current = inspectTransportDemandAuthority(inspectInput(workspaceRoot));
  assert.equal(current.status, "current");
  assert.deepEqual(current.entries, {
    groups: [{
      ref: groupRef(group),
      digest: group.groupDigest,
      record: group,
    }],
    packets: [],
    envelopes: [],
    runs: [],
  });
  assert.equal(current.inventoryDigest, createdInventoryDigest);
  assert.equal(
    existsSync(portablePath(workspaceRoot, `${DEMANDS_ROOT_REF}/${IDS.otherDemand}`)),
    false,
    "an orphan packet rejection must not materialize a new demand tree",
  );
  assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "idle");
  assert.throws(
    () => publishDispatchGroupAdmitted({
      ...publishInput(workspaceRoot, group),
      mutationContext: expiredContext,
    }),
    /context|expired|inactive|mutation/iu,
  );
  assertNoLegacyTransportArtifacts(workspaceRoot);
});

test("T06 public group publisher obtains and releases the real T02 gate", async (t) => {
  const workspaceRoot = prepareWorkspace(t);
  const group = createDispatchGroupRecord(groupInput());
  const published = await publishDispatchGroup(publishInput(workspaceRoot, group));

  assert.deepEqual(Object.keys(published).sort(), [
    "digest",
    "inventoryDigest",
    "record",
    "ref",
    "status",
  ]);
  assert.equal(published.status, "created");
  assert.equal(published.ref, groupRef(group));
  assert.equal(published.digest, group.groupDigest);
  assert.deepEqual(published.record, group);
  assert.match(published.inventoryDigest, DIGEST_RE);
  assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "idle");

  await withWakeflowRuntimeMutation({
    workspaceRoot,
    operationKind: "transport-store-public-fence-test",
    domainOwner: "delivery-runtime",
  }, async () => {
    await assert.rejects(
      () => publishDispatchGroup({
        ...publishInput(workspaceRoot, group),
        acquireTimeoutMs: 0,
      }),
      /nested|reentrant|mutation|busy/iu,
    );
  });
  assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "idle");
  assertPrivateCanonicalFile(
    portablePath(workspaceRoot, groupRef(group)),
    dispatchGroupCanonicalBytes(group),
  );
  assertNoLegacyTransportArtifacts(workspaceRoot);
});

test("T06 two public publisher processes produce one immutable same-ID winner", async (t) => {
  const workspaceRoot = prepareWorkspace(t);
  const first = createDispatchGroupRecord(groupInput());
  const second = createDispatchGroupRecord(groupInput({ stateRevision: 8 }));
  const results = await Promise.all([
    runGroupPublisherChild(workspaceRoot, first),
    runGroupPublisherChild(workspaceRoot, second),
  ]);
  assert.equal(
    results.filter(({ payload }) => payload?.outcome === "success").length,
    1,
    JSON.stringify(results),
  );
  assert.equal(
    results.filter(({ payload }) => (
      payload?.outcome === "rejected"
      && payload.code === "wakeflow-transport-store-same-id-conflict"
    )).length,
    1,
    JSON.stringify(results),
  );
  assert.equal(results.every(({ signal }) => signal === null), true, JSON.stringify(results));
  const inventory = inspectTransportDemandAuthority(inspectInput(workspaceRoot));
  assert.equal(inventory.entries.groups.length, 1);
  assert.equal(
    [first.groupDigest, second.groupDigest].includes(inventory.entries.groups[0].digest),
    true,
  );
  assertPrivateCanonicalFile(
    portablePath(workspaceRoot, groupRef(first)),
    dispatchGroupCanonicalBytes(inventory.entries.groups[0].record),
  );
  assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "idle");
  assertNoLegacyTransportArtifacts(workspaceRoot);
});

test("T06 commit faults preserve one exact transport outcome or T02 recovery evidence", async (t) => {
  await t.test("one-shot target fsync failure settles the exact committed group", async (subtest) => {
    const workspaceRoot = prepareWorkspace(subtest);
    const group = createDispatchGroupRecord(groupInput());
    const target = portablePath(workspaceRoot, groupRef(group));
    const originalFsync = fs.fsyncSync;
    let injected = false;
    subtest.mock.method(fs, "fsyncSync", (descriptor) => {
      const opened = fs.fstatSync(descriptor, { bigint: true });
      let current = null;
      try {
        current = fs.lstatSync(target, { bigint: true });
      } catch {
        // The immutable group target is not committed yet.
      }
      if (
        !injected
        && current?.isFile()
        && opened.dev === current.dev
        && opened.ino === current.ino
      ) {
        injected = true;
        const error = new Error("injected one-shot transport fsync failure");
        error.code = "EIO";
        throw error;
      }
      return originalFsync(descriptor);
    });

    const published = await publishDispatchGroup(publishInput(workspaceRoot, group));
    assert.equal(injected, true);
    assert.equal(published.status, "created");
    assert.equal(published.digest, group.groupDigest);
    assertPrivateCanonicalFile(target, dispatchGroupCanonicalBytes(group));
    assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "idle");
  });

  await t.test("persistent target fsync failure keeps the group and recovery gate", async (subtest) => {
    const workspaceRoot = prepareWorkspace(subtest);
    const group = createDispatchGroupRecord(groupInput());
    const target = portablePath(workspaceRoot, groupRef(group));
    const originalFsync = fs.fsyncSync;
    let injected = 0;
    subtest.mock.method(fs, "fsyncSync", (descriptor) => {
      const opened = fs.fstatSync(descriptor, { bigint: true });
      let current = null;
      try {
        current = fs.lstatSync(target, { bigint: true });
      } catch {
        // The immutable group target is not committed yet.
      }
      if (
        current?.isFile()
        && opened.dev === current.dev
        && opened.ino === current.ino
      ) {
        injected += 1;
        const error = new Error("injected persistent transport fsync failure");
        error.code = "EIO";
        throw error;
      }
      return originalFsync(descriptor);
    });

    await assert.rejects(
      () => publishDispatchGroup(publishInput(workspaceRoot, group)),
      /recovery|mutation|durability|transport/iu,
    );
    assert.ok(injected >= 2);
    assertPrivateCanonicalFile(target, dispatchGroupCanonicalBytes(group));
    const mutation = inspectWakeflowWorkspaceMutation({ workspaceRoot });
    assert.equal(mutation.state, "busy");
    assert.equal(mutation.lock?.operationKind, "transport-publish-groups");
  });

  await t.test("one-shot parent fsync failure settles the exact committed group", async (subtest) => {
    const workspaceRoot = prepareWorkspace(subtest);
    const group = createDispatchGroupRecord(groupInput());
    const target = portablePath(workspaceRoot, groupRef(group));
    const parent = path.dirname(target);
    const originalFsync = fs.fsyncSync;
    let injected = false;
    subtest.mock.method(fs, "fsyncSync", (descriptor) => {
      const opened = fs.fstatSync(descriptor, { bigint: true });
      let targetStat = null;
      let parentStat = null;
      try {
        targetStat = fs.lstatSync(target, { bigint: true });
        parentStat = fs.lstatSync(parent, { bigint: true });
      } catch {
        // The immutable group target is not committed yet.
      }
      if (
        !injected
        && targetStat?.isFile()
        && opened.dev === parentStat?.dev
        && opened.ino === parentStat?.ino
      ) {
        injected = true;
        const error = new Error("injected one-shot transport parent fsync failure");
        error.code = "EIO";
        throw error;
      }
      return originalFsync(descriptor);
    });

    const published = await publishDispatchGroup(publishInput(workspaceRoot, group));
    assert.equal(injected, true);
    assert.equal(published.status, "created");
    assertPrivateCanonicalFile(target, dispatchGroupCanonicalBytes(group));
    assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "idle");
  });

  await t.test("persistent parent fsync failure keeps the group and recovery gate", async (subtest) => {
    const workspaceRoot = prepareWorkspace(subtest);
    const group = createDispatchGroupRecord(groupInput());
    const target = portablePath(workspaceRoot, groupRef(group));
    const parent = path.dirname(target);
    const originalFsync = fs.fsyncSync;
    let injected = 0;
    subtest.mock.method(fs, "fsyncSync", (descriptor) => {
      const opened = fs.fstatSync(descriptor, { bigint: true });
      let targetStat = null;
      let parentStat = null;
      try {
        targetStat = fs.lstatSync(target, { bigint: true });
        parentStat = fs.lstatSync(parent, { bigint: true });
      } catch {
        // The immutable group target is not committed yet.
      }
      if (
        targetStat?.isFile()
        && opened.dev === parentStat?.dev
        && opened.ino === parentStat?.ino
      ) {
        injected += 1;
        const error = new Error("injected persistent transport parent fsync failure");
        error.code = "EIO";
        throw error;
      }
      return originalFsync(descriptor);
    });

    await assert.rejects(
      () => publishDispatchGroup(publishInput(workspaceRoot, group)),
      /recovery|mutation|durability|transport/iu,
    );
    assert.ok(injected >= 2);
    assertPrivateCanonicalFile(target, dispatchGroupCanonicalBytes(group));
    assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "busy");
  });

  await t.test("one-shot descendant postscan failure settles after a final strict rescan", async (subtest) => {
    const workspaceRoot = prepareWorkspace(subtest);
    const group = createDispatchGroupRecord(groupInput());
    const packet = createDispatchPacketRecord(packetInput(group));
    await publishDispatchGroup(publishInput(workspaceRoot, group));
    const target = portablePath(workspaceRoot, packetRef(packet));
    const demandRoot = portablePath(workspaceRoot, `${DEMANDS_ROOT_REF}/${IDS.demand}`);
    const originalReaddir = fs.readdirSync;
    let injected = false;
    subtest.mock.method(fs, "readdirSync", (candidate, options) => {
      if (!injected && candidate === demandRoot && existsSync(target)) {
        injected = true;
        const error = new Error("injected one-shot transport postscan failure");
        error.code = "EIO";
        throw error;
      }
      return originalReaddir(candidate, options);
    });

    const published = await publishDispatchPacket(publishInput(workspaceRoot, packet));
    assert.equal(injected, true);
    assert.equal(published.status, "created");
    assertPrivateCanonicalFile(target, dispatchPacketCanonicalBytes(packet));
    const strict = inspectTransportDemandAuthority(inspectInput(workspaceRoot));
    assert.equal(strict.entries.packets.length, 1);
    assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "idle");
  });

  await t.test("committed target inode replacement cannot be reported created", async (subtest) => {
    const workspaceRoot = prepareWorkspace(subtest);
    const group = createDispatchGroupRecord(groupInput());
    const target = portablePath(workspaceRoot, groupRef(group));
    const displaced = `${target}.displaced`;
    const desiredBytes = dispatchGroupCanonicalBytes(group);
    const originalFsync = fs.fsyncSync;
    let committedInode = null;
    let injected = false;
    subtest.mock.method(fs, "fsyncSync", (descriptor) => {
      const opened = fs.fstatSync(descriptor, { bigint: true });
      let current = null;
      try {
        current = fs.lstatSync(target, { bigint: true });
      } catch {
        // The immutable group target is not committed yet.
      }
      if (
        !injected
        && current?.isFile()
        && opened.dev === current.dev
        && opened.ino === current.ino
      ) {
        committedInode = opened.ino;
        fs.renameSync(target, displaced);
        writeFileSync(target, desiredBytes, { flag: "wx", mode: 0o600 });
        chmodSync(target, 0o600);
        fs.unlinkSync(displaced);
        injected = true;
      }
      return originalFsync(descriptor);
    });

    await assert.rejects(
      () => publishDispatchGroup(publishInput(workspaceRoot, group)),
      /recovery|mutation|durability|transport/iu,
    );
    assert.equal(injected, true);
    assert.notEqual(lstatSync(target, { bigint: true }).ino, committedInode);
    assert.deepEqual(readFileSync(target), desiredBytes);
    assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "busy");
  });

  await t.test("absent create never overwrites a concurrently published group", async (subtest) => {
    const workspaceRoot = prepareWorkspace(subtest);
    const desired = createDispatchGroupRecord(groupInput());
    const interloper = createDispatchGroupRecord(groupInput({ stateRevision: 8 }));
    const target = portablePath(workspaceRoot, groupRef(desired));
    const interloperBytes = dispatchGroupCanonicalBytes(interloper);
    const originalLink = fs.linkSync;
    let injected = false;
    subtest.mock.method(fs, "linkSync", (source, destination) => {
      if (!injected && destination === target && String(source).includes(".wakeflow-stage-")) {
        writeFileSync(target, interloperBytes, { flag: "wx", mode: 0o600 });
        chmodSync(target, 0o600);
        injected = true;
      }
      return originalLink(source, destination);
    });

    await assert.rejects(
      () => publishDispatchGroup(publishInput(workspaceRoot, desired)),
      /recovery|mutation|commit|transport/iu,
    );
    assert.equal(injected, true);
    assert.deepEqual(readFileSync(target), interloperBytes);
    assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "busy");
  });
});

test("T06 a complete canonical demand tree with no facts is empty, not missing", (t) => {
  const workspaceRoot = prepareWorkspace(t);
  const demandRoot = ensureCompleteDemandTree(workspaceRoot);
  const inventory = inspectTransportDemandAuthority(inspectInput(workspaceRoot));

  assert.equal(inventory.status, "empty");
  assert.deepEqual(inventory.entries, {
    groups: [],
    packets: [],
    envelopes: [],
    runs: [],
  });
  assert.match(inventory.inventoryDigest, DIGEST_RE);
  assert.deepEqual(readdirSync(demandRoot).sort(), RECORD_DIRECTORIES);
  assertNoLegacyTransportArtifacts(workspaceRoot);
});

test("T06 release participant admits only passive dense archived entry arrays", (t) => {
  const workspaceRoot = prepareWorkspace(t);
  ensureCompleteDemandTree(workspaceRoot);
  const inventory = inspectTransportDemandAuthority(inspectInput(workspaceRoot));
  assert.equal(inventory.status, "empty");
  const emptyEntries = Object.fromEntries(RECORD_DIRECTORIES.map((kind) => [kind, []]));
  const baseInput = (entries) => ({
    workspaceRoot,
    programId: IDS.program,
    demandId: IDS.demand,
    archiveId: "archive_41414141-4141-4141-8141-414141414141",
    sourceStatus: "empty",
    inventoryDigest: inventory.inventoryDigest,
    entries,
  });

  let getterCalls = 0;
  const activeGroups = new Array(1);
  Object.defineProperty(activeGroups, "0", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return {
        ref: `${DEMANDS_ROOT_REF}/${IDS.demand}/groups/${IDS.group}.json`,
        digest: `sha256:${"a".repeat(64)}`,
      };
    },
  });
  assert.throws(() => createTransportDemandReleaseParticipant(baseInput({
    ...emptyEntries,
    groups: activeGroups,
  })), (error) => error?.code === "wakeflow-transport-store-release-contract");
  assert.equal(getterCalls, 0, "release entry admission must not execute an array getter");

  for (const groups of [
    (() => {
      const value = [];
      Object.defineProperty(value, "hidden", { value: true, enumerable: false });
      return value;
    })(),
    Object.assign([], { [Symbol("unknown")]: true }),
    new Array(1),
  ]) {
    assert.throws(() => createTransportDemandReleaseParticipant(baseInput({
      ...emptyEntries,
      groups,
    })), (error) => error?.code === "wakeflow-transport-store-release-contract");
  }

  const source = readFileSync(new URL(
    "../core/scripts/lib/wakeflow-transport-store.mjs",
    import.meta.url,
  ), "utf8");
  assert.doesNotMatch(source, /\.localeCompare\(/u);
});

test("T06 first group publication forward-completes an empty structural prefix", async (t) => {
  const workspaceRoot = prepareWorkspace(t);
  const demandRef = `${DEMANDS_ROOT_REF}/${IDS.demand}`;
  ensurePrivateDirectory(workspaceRoot, `${demandRef}/groups`);
  const group = createDispatchGroupRecord(groupInput());

  await withWakeflowRuntimeMutation({
    workspaceRoot,
    operationKind: "transport-store-forward-complete-prefix-test",
    domainOwner: "delivery-runtime",
  }, (mutationContext) => {
    const result = publishDispatchGroupAdmitted({
      ...publishInput(workspaceRoot, group),
      mutationContext,
    });
    assert.equal(result?.then, undefined);
    assert.equal(result.outcome, "success");
    assert.equal(result.value.status, "created");
  });

  assert.deepEqual(
    readdirSync(portablePath(workspaceRoot, demandRef)).sort(),
    RECORD_DIRECTORIES,
  );
  const inventory = inspectTransportDemandAuthority(inspectInput(workspaceRoot));
  assert.equal(inventory.status, "current");
  assert.deepEqual(inventory.entries.groups.map((entry) => entry.record), [group]);
  assertNoLegacyTransportArtifacts(workspaceRoot);
});

test("T06 group, packet and envelope are each a valid forward-completable prefix", async (t) => {
  const workspaceRoot = prepareWorkspace(t);
  const group = createDispatchGroupRecord(groupInput());
  const packet = createDispatchPacketRecord(packetInput(group));
  const envelope = createTargetDeliveryEnvelopeRecord(targetEnvelopeInput(group, packet));

  await publishDispatchGroup(publishInput(workspaceRoot, group));
  let inventory = inspectTransportDemandAuthority(inspectInput(workspaceRoot));
  assert.equal(inventory.status, "current");
  assert.equal(inventory.entries.groups.length, 1);
  assert.equal(inventory.entries.packets.length, 0);

  await publishDispatchPacket(publishInput(workspaceRoot, packet));
  inventory = inspectTransportDemandAuthority(inspectInput(workspaceRoot));
  assert.equal(inventory.status, "current");
  assert.equal(inventory.entries.groups.length, 1);
  assert.equal(inventory.entries.packets.length, 1);
  assert.equal(inventory.entries.envelopes.length, 0);

  const publishedEnvelope = await publishDeliveryEnvelope(
    publishInput(workspaceRoot, envelope),
  );
  assert.equal(publishedEnvelope.status, "created");
  assert.equal(publishedEnvelope.ref, envelopeRef(envelope));
  inventory = inspectTransportDemandAuthority(inspectInput(workspaceRoot));
  assert.equal(inventory.status, "current");
  assert.equal(inventory.entries.groups.length, 1);
  assert.equal(inventory.entries.packets.length, 1);
  assert.equal(inventory.entries.envelopes.length, 1);
  assert.equal(inventory.entries.runs.length, 0);
  const diagnostic = inspectTransportDemandForLayout(inspectInput(workspaceRoot));
  assert.equal(diagnostic.status, "current");
  assert.deepEqual(diagnostic.issues, []);
  assert.equal(diagnostic.inventoryDigest, inventory.inventoryDigest);
  assert.deepEqual(diagnostic.entries.envelopes, [{
    ref: envelopeRef(envelope),
    digest: envelope.envelopeDigest,
  }]);
  assertNoLegacyTransportArtifacts(workspaceRoot);
});

test("T06 admitted and public APIs persist the complete target and controller-return graph", async (t) => {
  const workspaceRoot = prepareWorkspace(t);
  const group = createDispatchGroupRecord(groupInput());
  const packet = createDispatchPacketRecord(packetInput(group));
  const targetEnvelope = createTargetDeliveryEnvelopeRecord(
    targetEnvelopeInput(group, packet),
  );
  const firstRun = createDeliveryRunRecord(runInput(targetEnvelope));
  const secondRun = createDeliveryRunRecord(runInput(targetEnvelope, {
    runId: IDS.secondRun,
    attemptOrdinal: 2,
    previousRun: previousRunTuple(firstRun),
    createdAt: "2026-08-08T00:00:05.000Z",
  }));
  const controllerEnvelope = createControllerReturnEnvelopeRecord(
    controllerEnvelopeInput(group),
  );
  const controllerRun = createDeliveryRunRecord(runInput(controllerEnvelope, {
    runId: IDS.controllerRun,
    createdAt: "2026-08-08T00:00:06.000Z",
  }));

  await withWakeflowRuntimeMutation({
    workspaceRoot,
    operationKind: "transport-store-complete-graph-test",
    domainOwner: "delivery-runtime",
  }, (mutationContext) => {
    for (const operation of [
      () => publishDispatchGroupAdmitted({
        ...publishInput(workspaceRoot, group),
        mutationContext,
      }),
      () => publishDispatchPacketAdmitted({
        ...publishInput(workspaceRoot, packet),
        mutationContext,
      }),
      () => publishDeliveryEnvelopeAdmitted({
        ...publishInput(workspaceRoot, targetEnvelope),
        mutationContext,
      }),
      () => appendDeliveryRunAdmitted({
        ...publishInput(workspaceRoot, firstRun),
        mutationContext,
      }),
      () => appendDeliveryRunAdmitted({
        ...publishInput(workspaceRoot, secondRun),
        mutationContext,
      }),
      () => publishDeliveryEnvelopeAdmitted({
        ...publishInput(workspaceRoot, controllerEnvelope),
        mutationContext,
      }),
      () => appendDeliveryRunAdmitted({
        ...publishInput(workspaceRoot, controllerRun),
        mutationContext,
      }),
    ]) {
      const result = operation();
      assert.equal(result?.then, undefined, "admitted transport writes must be synchronous");
      assert.equal(result.outcome, "success");
      assert.equal(result.value.status, "created");
    }
  });

  for (const [operation, record] of [
    [publishDeliveryEnvelope, targetEnvelope],
    [publishDeliveryEnvelope, controllerEnvelope],
    [appendDeliveryRun, secondRun],
    [appendDeliveryRun, controllerRun],
  ]) {
    const replayed = await operation(publishInput(workspaceRoot, record));
    assert.equal(replayed.status, "replayed");
    assert.deepEqual(replayed.record, record);
  }

  const inventory = inspectTransportDemandAuthority(inspectInput(workspaceRoot));
  assert.equal(inventory.status, "current");
  assert.deepEqual(inventory.entries.groups, [{
    ref: groupRef(group),
    digest: group.groupDigest,
    record: group,
  }]);
  assert.deepEqual(inventory.entries.packets, [{
    ref: packetRef(packet),
    digest: packet.packetDigest,
    record: packet,
  }]);
  assert.deepEqual(inventory.entries.envelopes, [targetEnvelope, controllerEnvelope].map(
    (record) => ({
      ref: envelopeRef(record),
      digest: record.envelopeDigest,
      record,
    }),
  ));
  assert.deepEqual(inventory.entries.runs, [firstRun, secondRun, controllerRun].map(
    (record) => ({
      ref: runRef(record),
      digest: record.runDigest,
      record,
    }),
  ));
  assert.match(inventory.inventoryDigest, DIGEST_RE);

  for (const [ref, bytes] of [
    [groupRef(group), dispatchGroupCanonicalBytes(group)],
    [packetRef(packet), dispatchPacketCanonicalBytes(packet)],
    [envelopeRef(targetEnvelope), deliveryEnvelopeCanonicalBytes(targetEnvelope)],
    [envelopeRef(controllerEnvelope), deliveryEnvelopeCanonicalBytes(controllerEnvelope)],
    [runRef(firstRun), deliveryRunCanonicalBytes(firstRun)],
    [runRef(secondRun), deliveryRunCanonicalBytes(secondRun)],
    [runRef(controllerRun), deliveryRunCanonicalBytes(controllerRun)],
  ]) {
    assertPrivateCanonicalFile(portablePath(workspaceRoot, ref), bytes);
  }
  assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot }).state, "idle");
  assertNoLegacyTransportArtifacts(workspaceRoot);
});

test("T06 diagnostic preserves strict run ordering and the authority inventory digest", async (t) => {
  const workspaceRoot = prepareWorkspace(t);
  const group = createDispatchGroupRecord(groupInput());
  const packet = createDispatchPacketRecord(packetInput(group));
  const envelope = createTargetDeliveryEnvelopeRecord(targetEnvelopeInput(group, packet));
  const firstRun = createDeliveryRunRecord(runInput(envelope, {
    runId: "delivery-run_ffffffff-ffff-4fff-8fff-ffffffffffff",
  }));
  const secondRun = createDeliveryRunRecord(runInput(envelope, {
    runId: "delivery-run_00000000-0000-4000-8000-000000000001",
    attemptOrdinal: 2,
    previousRun: previousRunTuple(firstRun),
    createdAt: "2026-08-08T00:00:05.000Z",
  }));

  await publishDispatchGroup(publishInput(workspaceRoot, group));
  await publishDispatchPacket(publishInput(workspaceRoot, packet));
  await publishDeliveryEnvelope(publishInput(workspaceRoot, envelope));
  await appendDeliveryRun(publishInput(workspaceRoot, firstRun));
  await appendDeliveryRun(publishInput(workspaceRoot, secondRun));

  const strict = inspectTransportDemandAuthority(inspectInput(workspaceRoot));
  const diagnostic = inspectTransportDemandForLayout(inspectInput(workspaceRoot));
  assert.deepEqual(strict.entries.runs.map((entry) => entry.record.runId), [
    secondRun.runId,
    firstRun.runId,
  ]);
  assert.deepEqual(diagnostic.entries.runs, strict.entries.runs.map(({ ref, digest }) => ({
    ref,
    digest,
  })));
  assert.equal(diagnostic.status, "current");
  assert.deepEqual(diagnostic.issues, []);
  assert.equal(diagnostic.inventoryDigest, strict.inventoryDigest);
});

test("T06 store rejects broken envelope ancestry, orphan runs, gaps and forks", async (t) => {
  const workspaceRoot = prepareWorkspace(t);
  const group = createDispatchGroupRecord(groupInput());
  const packet = createDispatchPacketRecord(packetInput(group));
  const targetEnvelope = createTargetDeliveryEnvelopeRecord(
    targetEnvelopeInput(group, packet),
  );
  const firstRun = createDeliveryRunRecord(runInput(targetEnvelope));
  const secondRun = createDeliveryRunRecord(runInput(targetEnvelope, {
    runId: IDS.secondRun,
    attemptOrdinal: 2,
    previousRun: previousRunTuple(firstRun),
    createdAt: "2026-08-08T00:00:05.000Z",
  }));
  const forkRun = createDeliveryRunRecord(runInput(targetEnvelope, {
    runId: IDS.forkRun,
    attemptOrdinal: 2,
    previousRun: previousRunTuple(firstRun),
    createdAt: "2026-08-08T00:00:06.000Z",
  }));
  const gapRun = createDeliveryRunRecord(runInput(targetEnvelope, {
    runId: IDS.gapRun,
    attemptOrdinal: 3,
    previousRun: previousRunTuple(firstRun),
    createdAt: "2026-08-08T00:00:07.000Z",
  }));
  const unpersistedEnvelope = createTargetDeliveryEnvelopeRecord(
    targetEnvelopeInput(group, packet, { deliveryId: IDS.otherDelivery }),
  );
  const orphanRun = createDeliveryRunRecord(runInput(unpersistedEnvelope, {
    runId: IDS.controllerRun,
    createdAt: "2026-08-08T00:00:08.000Z",
  }));
  const wrongPromptEnvelope = createTargetDeliveryEnvelopeRecord(
    targetEnvelopeInput(group, packet, {
      deliveryId: IDS.otherDelivery,
      prompt: "This prompt is not the exact immutable packet prompt.",
    }),
  );
  const otherGroup = createDispatchGroupRecord(groupInput({
    groupId: IDS.otherGroup,
    packetId: IDS.otherPacket,
  }));
  const orphanControllerEnvelope = createControllerReturnEnvelopeRecord(
    controllerEnvelopeInput(otherGroup),
  );

  await withWakeflowRuntimeMutation({
    workspaceRoot,
    operationKind: "transport-store-reject-broken-graph-test",
    domainOwner: "delivery-runtime",
  }, (mutationContext) => {
    for (const [publisher, record] of [
      [publishDispatchGroupAdmitted, group],
      [publishDispatchPacketAdmitted, packet],
      [publishDeliveryEnvelopeAdmitted, targetEnvelope],
      [appendDeliveryRunAdmitted, firstRun],
      [appendDeliveryRunAdmitted, secondRun],
    ]) {
      const result = publisher({ ...publishInput(workspaceRoot, record), mutationContext });
      assert.equal(result.outcome, "success");
    }

    assertRejectedOutcome(
      publishDeliveryEnvelopeAdmitted({
        ...publishInput(workspaceRoot, wrongPromptEnvelope),
        mutationContext,
      }),
      /packet|prompt|ancestor|integrity|source/iu,
    );
    assertRejectedOutcome(
      publishDeliveryEnvelopeAdmitted({
        ...publishInput(workspaceRoot, orphanControllerEnvelope),
        mutationContext,
      }),
      /group|ancestor|missing|integrity/iu,
    );
    assertRejectedOutcome(
      appendDeliveryRunAdmitted({
        ...publishInput(workspaceRoot, orphanRun),
        mutationContext,
      }),
      /envelope|ancestor|missing|integrity/iu,
    );
    assertRejectedOutcome(
      appendDeliveryRunAdmitted({
        ...publishInput(workspaceRoot, gapRun),
        mutationContext,
      }),
      /previous|lineage|gap|ordinal|continuous|integrity/iu,
    );
    assertRejectedOutcome(
      appendDeliveryRunAdmitted({
        ...publishInput(workspaceRoot, forkRun),
        mutationContext,
      }),
      /previous|lineage|fork|ordinal|continuous|integrity/iu,
    );
  });

  const inventory = inspectTransportDemandAuthority(inspectInput(workspaceRoot));
  assert.deepEqual(inventory.entries.envelopes.map((entry) => entry.record.deliveryId), [
    IDS.delivery,
  ]);
  assert.deepEqual(inventory.entries.runs.map((entry) => entry.record.runId), [
    IDS.run,
    IDS.secondRun,
  ]);
  assert.equal(existsSync(portablePath(workspaceRoot, envelopeRef(wrongPromptEnvelope))), false);
  assert.equal(existsSync(portablePath(workspaceRoot, runRef(orphanRun))), false);
  assertNoLegacyTransportArtifacts(workspaceRoot);
});

test("T06 strict authority rejects orphan, tamper, unknown, mode, symlink and hardlink", async (t) => {
  const group = createDispatchGroupRecord(groupInput());
  const packet = createDispatchPacketRecord(packetInput(group));
  const targetEnvelope = createTargetDeliveryEnvelopeRecord(
    targetEnvelopeInput(group, packet),
  );
  const controllerEnvelope = createControllerReturnEnvelopeRecord(
    controllerEnvelopeInput(group),
  );
  const firstRun = createDeliveryRunRecord(runInput(targetEnvelope));
  const secondRun = createDeliveryRunRecord(runInput(targetEnvelope, {
    runId: IDS.secondRun,
    attemptOrdinal: 2,
    previousRun: previousRunTuple(firstRun),
    createdAt: "2026-08-08T00:00:05.000Z",
  }));
  const forkRun = createDeliveryRunRecord(runInput(targetEnvelope, {
    runId: IDS.forkRun,
    attemptOrdinal: 2,
    previousRun: previousRunTuple(firstRun),
    createdAt: "2026-08-08T00:00:06.000Z",
  }));
  const gapRun = createDeliveryRunRecord(runInput(targetEnvelope, {
    runId: IDS.gapRun,
    attemptOrdinal: 3,
    previousRun: previousRunTuple(firstRun),
    createdAt: "2026-08-08T00:00:07.000Z",
  }));
  const writeValidTargetPrefix = (workspaceRoot) => {
    writePrivateRecord(workspaceRoot, groupRef(group), dispatchGroupCanonicalBytes(group));
    writePrivateRecord(workspaceRoot, packetRef(packet), dispatchPacketCanonicalBytes(packet));
    writePrivateRecord(
      workspaceRoot,
      envelopeRef(targetEnvelope),
      deliveryEnvelopeCanonicalBytes(targetEnvelope),
    );
  };
  const cases = [
    {
      name: "orphan packet",
      arrange(workspaceRoot) {
        writePrivateRecord(workspaceRoot, packetRef(packet), dispatchPacketCanonicalBytes(packet));
      },
    },
    {
      name: "orphan target envelope",
      arrange(workspaceRoot) {
        writePrivateRecord(
          workspaceRoot,
          envelopeRef(targetEnvelope),
          deliveryEnvelopeCanonicalBytes(targetEnvelope),
        );
      },
    },
    {
      name: "orphan controller-return envelope",
      arrange(workspaceRoot) {
        writePrivateRecord(
          workspaceRoot,
          envelopeRef(controllerEnvelope),
          deliveryEnvelopeCanonicalBytes(controllerEnvelope),
        );
      },
    },
    {
      name: "orphan delivery run",
      arrange(workspaceRoot) {
        writePrivateRecord(workspaceRoot, runRef(firstRun), deliveryRunCanonicalBytes(firstRun));
      },
    },
    {
      name: "forked delivery run lineage",
      arrange(workspaceRoot) {
        writeValidTargetPrefix(workspaceRoot);
        for (const run of [firstRun, secondRun, forkRun]) {
          writePrivateRecord(workspaceRoot, runRef(run), deliveryRunCanonicalBytes(run));
        }
      },
    },
    {
      name: "gapped delivery run lineage",
      arrange(workspaceRoot) {
        writeValidTargetPrefix(workspaceRoot);
        for (const run of [firstRun, gapRun]) {
          writePrivateRecord(workspaceRoot, runRef(run), deliveryRunCanonicalBytes(run));
        }
      },
    },
    {
      name: "tampered record",
      arrange(workspaceRoot) {
        const target = writePrivateRecord(
          workspaceRoot,
          groupRef(group),
          dispatchGroupCanonicalBytes(group),
        );
        writeFileSync(target, `${JSON.stringify({ ...group, stateRevision: 8 })}\n`);
        chmodSync(target, 0o600);
      },
    },
    {
      name: "unknown sibling",
      arrange(workspaceRoot) {
        writePrivateRecord(
          workspaceRoot,
          `${DEMANDS_ROOT_REF}/${IDS.demand}/runs/unknown-entry.bin`,
          Buffer.from("unknown", "utf8"),
        );
      },
    },
    {
      name: "wrong file mode",
      arrange(workspaceRoot) {
        const target = writePrivateRecord(
          workspaceRoot,
          groupRef(group),
          dispatchGroupCanonicalBytes(group),
        );
        chmodSync(target, 0o644);
      },
    },
    {
      name: "wrong collection mode",
      arrange(workspaceRoot) {
        chmodSync(
          portablePath(workspaceRoot, `${DEMANDS_ROOT_REF}/${IDS.demand}/groups`),
          0o755,
        );
      },
    },
    {
      name: "symlink demand root",
      arrange(workspaceRoot) {
        const demandRoot = portablePath(workspaceRoot, `${DEMANDS_ROOT_REF}/${IDS.demand}`);
        const outside = path.join(workspaceRoot, "outside-symlink-demand");
        rmSync(demandRoot, { recursive: true, force: true });
        mkdirSync(outside, { mode: 0o700 });
        symlinkSync(outside, demandRoot, "dir");
      },
    },
    {
      name: "symlink collection",
      arrange(workspaceRoot) {
        const collection = portablePath(
          workspaceRoot,
          `${DEMANDS_ROOT_REF}/${IDS.demand}/runs`,
        );
        const outside = path.join(workspaceRoot, "outside-symlink-runs");
        rmSync(collection, { recursive: true, force: true });
        mkdirSync(outside, { mode: 0o700 });
        symlinkSync(outside, collection, "dir");
      },
    },
    {
      name: "symlink record",
      arrange(workspaceRoot) {
        const outside = path.join(workspaceRoot, "outside-symlink-group.json");
        writeFileSync(outside, dispatchGroupCanonicalBytes(group), { mode: 0o600 });
        chmodSync(outside, 0o600);
        symlinkSync(outside, portablePath(workspaceRoot, groupRef(group)));
      },
    },
    {
      name: "hardlinked record",
      arrange(workspaceRoot) {
        const outside = path.join(workspaceRoot, "outside-hardlink-group.json");
        writeFileSync(outside, dispatchGroupCanonicalBytes(group), { mode: 0o600 });
        chmodSync(outside, 0o600);
        linkSync(outside, portablePath(workspaceRoot, groupRef(group)));
      },
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, (subtest) => {
      const workspaceRoot = prepareWorkspace(subtest);
      ensureCompleteDemandTree(workspaceRoot);
      fixture.arrange(workspaceRoot);
      assert.throws(
        () => inspectTransportDemandAuthority(inspectInput(workspaceRoot)),
        /transport|ancestor|record|entry|canonical|digest|mode|private|link|file/iu,
      );
    });
  }
});

test("T06 strict and diagnostic inspection reject a FIFO without blocking", (t) => {
  const workspaceRoot = prepareWorkspace(t);
  ensureCompleteDemandTree(workspaceRoot);
  const group = createDispatchGroupRecord(groupInput());
  const target = portablePath(workspaceRoot, groupRef(group));
  const made = spawnSync("mkfifo", [target], { encoding: "utf8" });
  if (made.status !== 0) {
    t.skip("mkfifo is unavailable on this platform");
    return;
  }
  chmodSync(target, 0o600);
  const moduleUrl = new URL(
    "../core/scripts/lib/wakeflow-transport-store.mjs",
    import.meta.url,
  ).href;
  const script = `
    import {
      inspectTransportDemandAuthority,
      inspectTransportDemandForLayout,
    } from ${JSON.stringify(moduleUrl)};
    const input = ${JSON.stringify(inspectInput(workspaceRoot))};
    let strictCode = null;
    try {
      inspectTransportDemandAuthority(input);
    } catch (error) {
      strictCode = error?.code ?? null;
    }
    const diagnostic = inspectTransportDemandForLayout(input);
    process.stdout.write(JSON.stringify({
      strictCode,
      status: diagnostic.status,
      issues: diagnostic.issues,
      groups: diagnostic.entries.groups,
    }));
  `;
  const inspected = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: path.dirname(new URL(import.meta.url).pathname),
    encoding: "utf8",
    timeout: 3_000,
  });
  assert.equal(inspected.error, undefined, inspected.error?.message);
  assert.equal(inspected.status, 0, inspected.stderr);
  const result = JSON.parse(inspected.stdout);
  assert.equal(result.strictCode, "wakeflow-transport-store-file");
  assert.equal(result.status, "degraded");
  assert.deepEqual(result.groups, []);
  assert.ok(result.issues.some((issue) => (
    issue.code === "wakeflow-transport-store-file"
    && issue.scope === "groups"
    && issue.route === "manual-review"
  )));
});

test("T06 diagnostic inventory bounds issues and never promotes invalid descendants", (t) => {
  const workspaceRoot = prepareWorkspace(t);
  ensureCompleteDemandTree(workspaceRoot);
  const group = createDispatchGroupRecord(groupInput());
  const orphanGroup = createDispatchGroupRecord(groupInput({
    groupId: IDS.otherGroup,
    packetId: IDS.otherPacket,
  }));
  const orphanPacket = createDispatchPacketRecord(packetInput(orphanGroup));
  writePrivateRecord(workspaceRoot, groupRef(group), dispatchGroupCanonicalBytes(group));
  writePrivateRecord(
    workspaceRoot,
    packetRef(orphanPacket),
    dispatchPacketCanonicalBytes(orphanPacket),
  );
  for (let index = 0; index < 80; index += 1) {
    writePrivateRecord(
      workspaceRoot,
      `${DEMANDS_ROOT_REF}/${IDS.demand}/runs/unknown-${String(index).padStart(3, "0")}.bin`,
      Buffer.from("invalid transport diagnostic fixture", "utf8"),
    );
  }

  assert.throws(
    () => inspectTransportDemandAuthority(inspectInput(workspaceRoot)),
    /transport|ancestor|record|entry|integrity/iu,
  );
  const diagnostic = inspectTransportDemandForLayout(inspectInput(workspaceRoot));
  assertBoundedDiagnostic(diagnostic, workspaceRoot);
  assert.deepEqual(diagnostic.entries.groups, [{
    ref: groupRef(group),
    digest: group.groupDigest,
  }]);
  assert.deepEqual(diagnostic.entries.packets, []);
  assert.deepEqual(diagnostic.entries.envelopes, []);
  assert.deepEqual(diagnostic.entries.runs, []);
  const serializedEntries = JSON.stringify(diagnostic.entries);
  assert.equal(serializedEntries.includes(IDS.otherPacket), false);
  assert.equal(serializedEntries.includes("unknown-"), false);
  assertNoLegacyTransportArtifacts(workspaceRoot);
});
