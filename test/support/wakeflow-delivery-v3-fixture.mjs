import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "../../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  createTaskPackageArtifact,
  createTestCardArtifact,
} from "../../core/scripts/lib/wakeflow-demand-artifact-service.mjs";
import {
  loadDemandCoreRecords,
} from "../../core/scripts/lib/wakeflow-demand-core-records.mjs";
import { commitDemandStateTransition } from "../../core/scripts/lib/wakeflow-demand-state-service.mjs";
import {
  createLedgerMemberReference,
  createLedgerRecord,
  loadLedgerRecord,
} from "../../core/scripts/lib/wakeflow-ledger-records.mjs";
import {
  createWindowBindingRecord,
  windowBindingCanonicalBytes,
  windowBindingRef,
} from "../../core/scripts/lib/wakeflow-window-binding-records.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const minimalConfigFile = path.join(
  repositoryRoot,
  "test/fixtures/wakeflow-config-v3/valid-minimal.json",
);

const IDS = Object.freeze({
  program: "program_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  demand: "demand_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  taskPackage: "task-package_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  targetTask: "target-task_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  window: "window_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  group: "dispatch-group_ffffffff-ffff-4fff-8fff-ffffffffffff",
  packet: "dispatch-packet_11111111-1111-4111-8111-111111111111",
  delivery: "delivery_22222222-2222-4222-8222-222222222222",
  lease: "lease_33333333-3333-4333-8333-333333333333",
});
const DIGESTS = Object.freeze({
  package: `sha256:${"1".repeat(64)}`,
  group: `sha256:${"2".repeat(64)}`,
  packet: `sha256:${"3".repeat(64)}`,
  envelope: `sha256:${"4".repeat(64)}`,
  lease: `sha256:${"5".repeat(64)}`,
  previousEvent: `sha256:${"6".repeat(64)}`,
});

export const INTEGRATION_IDS = Object.freeze({
  program: "program_11111111-1111-4111-8111-111111111111",
  demand: "demand_12121212-1212-4212-8212-121212121212",
  requirement: "requirement_13131313-1313-4313-8313-131313131313",
  repository: "repository_22222222-2222-4222-8222-222222222222",
  repositoryTwo: "repository_20202020-2020-4020-8020-202020202020",
  controllerWindow: "window_55555555-5555-4555-8555-555555555555",
  controllerBinding: "binding_34343434-3434-4434-8434-343434343434",
  controllerHandle: "35353535-3535-4535-8535-353535353535",
  productWindow: "window_88888888-8888-4888-8888-888888888888",
  productWindowTwo: "window_21212121-2121-4121-8121-212121212121",
  taskPackage: "task-package_14141414-1414-4414-8414-141414141414",
  targetTask: "target-task_15151515-1515-4515-8515-151515151515",
  taskPackageTwo: "task-package_22222222-2222-4222-8222-222222222222",
  targetTaskTwo: "target-task_23232323-2323-4323-8323-232323232323",
  binding: "binding_16161616-1616-4616-8616-161616161616",
  handle: "17171717-1717-4717-8717-171717171717",
  bindingTwo: "binding_24242424-2424-4424-8424-242424242424",
  handleTwo: "25252525-2525-4525-8525-252525252525",
  testWindow: "window_77777777-7777-4777-8777-777777777777",
  testCard: "test-card_26262626-2626-4626-8626-262626262626",
  testTaskPackage: "task-package_27272727-2727-4727-8727-272727272727",
  testTargetTask: "target-task_28282828-2828-4828-8828-282828282828",
  testBinding: "binding_29292929-2929-4929-8929-292929292929",
  testHandle: "30303030-3030-4030-8030-303030303030",
  testResult: "target-result_31313131-3131-4131-8131-313131313131",
  testResultTwo: "target-result_32323232-3232-4232-8232-323232323232",
});

function integrationByteDigest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function ensurePrivateDirectory(root, ref) {
  let current = root;
  for (const segment of ref.split("/")) {
    current = path.join(current, segment);
    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 });
    if (process.platform !== "win32") chmodSync(current, 0o700);
  }
  return current;
}

export function writePrivateCanonical(file, value) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${canonicalJson(value)}\n`, { mode: 0o600 });
  if (process.platform !== "win32") chmodSync(file, 0o600);
}

export function privateTreeSnapshot(root) {
  if (!existsSync(root)) return [];
  const entries = [];
  const visit = (directory, base = "") => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const ref = base ? `${base}/${name}` : name;
      const stat = lstatSync(absolute);
      if (stat.isDirectory()) {
        entries.push({ ref, type: "directory", mode: stat.mode & 0o777 });
        visit(absolute, ref);
      } else if (stat.isFile()) {
        entries.push({
          ref,
          type: "file",
          mode: stat.mode & 0o777,
          digest: integrationByteDigest(readFileSync(absolute)),
        });
      } else {
        entries.push({ ref, type: "other", mode: stat.mode & 0o777 });
      }
    }
  };
  visit(root);
  return entries;
}

export function timestampAfter(...values) {
  return new Date(Math.max(...values.map((value) => Date.parse(value))) + 1).toISOString();
}

export function integrationDeterministicId(type, seed) {
  const bytes = createHash("sha256")
    .update(canonicalJson({ type, seed }))
    .digest();
  const uuidBytes = Buffer.from(bytes.subarray(0, 16));
  uuidBytes[6] = (uuidBytes[6] & 0x0f) | 0x40;
  uuidBytes[8] = (uuidBytes[8] & 0x3f) | 0x80;
  const hex = uuidBytes.toString("hex");
  return `${type}_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`
    + `-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function integrationDeliveryEventId(seed) {
  return `delivery-event-${integrationDeterministicId(
    "delivery",
    { event: seed },
  ).slice("delivery_".length)}`;
}

export async function createIntegrationFixture(t, {
  secondProduct = false,
  testTarget = false,
  hostId = "codex",
} = {}) {
  assert.equal(
    secondProduct && testTarget,
    false,
    "the disposable fixture does not combine its independent multi-product and Test variants",
  );
  assert.ok(
    ["codex", "claude-code"].includes(hostId),
    "the disposable fixture supports only the two protocol hosts",
  );
  const hostDirName = hostId;
  const handleKind = hostId === "claude-code" ? "claude-session" : "codex-thread";
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-delivery-orchestration-v3-"));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const workspaceRoot = path.join(fixtureRoot, "Program");
  mkdirSync(workspaceRoot, { mode: 0o700 });
  if (process.platform !== "win32") chmodSync(workspaceRoot, 0o700);

  const config = JSON.parse(readFileSync(minimalConfigFile, "utf8"));
  config.program.interfaceLanguage = "en";
  config.topology.repositories[0].path = "ProductA";
  config.topology.supportSurfaces[0].path = "Design";
  config.topology.supportSurfaces[1].path = "Test";
  config.storage.ledgerRoot = "Ledger";
  if (hostId === "claude-code") {
    config.hosts["claude-code"] = { tmux: { sessionName: "wakeflow" } };
  }
  if (secondProduct) {
    config.topology.repositories.push({
      repositoryId: INTEGRATION_IDS.repositoryTwo,
      path: "ProductB",
      displayName: "Product B",
      instructionManagement: "owner-managed",
    });
    config.topology.windows.push({
      windowId: INTEGRATION_IDS.productWindowTwo,
      role: "product",
      displayName: "Product B",
      root: { kind: "repository", repositoryId: INTEGRATION_IDS.repositoryTwo },
    });
  }
  for (const ref of [
    "ProductA",
    ...(secondProduct ? ["ProductB"] : []),
    "Design",
    "Test",
    ".wakeflow-active/current",
    ".wakeflow-local/runtime/maintenance/transactions",
    ".wakeflow-local/runtime/shared/coordination/window-leases",
    ".wakeflow-local/runtime/shared/transport/demands",
    `.wakeflow-local/runtime/hosts/${hostDirName}/identity/window-bindings`,
  ]) {
    ensurePrivateDirectory(workspaceRoot, ref);
  }
  writeFileSync(
    path.join(workspaceRoot, "wakeflow.config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
    { mode: 0o600 },
  );

  const ledgerRoot = path.join(workspaceRoot, "Ledger");
  mkdirSync(path.join(ledgerRoot, "requirement-designs"), {
    recursive: true,
    mode: 0o700,
  });
  const roles = [
    "original-plan",
    "requirement-design",
    "code-facts",
    "landing-plan",
    "non-goals",
    "user-confirmation",
    ...(testTarget ? ["test-environment"] : []),
  ];
  const documents = roles.map((role, index) => {
    const memberPath = `${String(index + 1).padStart(2, "0")}-${role}.md`;
    const content = `# ${role}\n\nDisposable orchestration integration authority.\n`;
    return {
      role,
      path: memberPath,
      mediaType: "text/markdown",
      digest: integrationByteDigest(content),
      content,
    };
  });
  const createdLedger = createLedgerRecord({
    ledgerRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    record: {
      schemaVersion: 1,
      artifactKind: "wakeflow-requirement-record",
      requirementId: INTEGRATION_IDS.requirement,
      programId: INTEGRATION_IDS.program,
      title: "Delivery orchestration integration authority",
      status: "confirmed",
      relatedDemandIds: [INTEGRATION_IDS.demand],
      documents: documents.map(({ content: _content, ...document }) => document),
    },
    memberContents: Object.fromEntries(
      documents.map((document) => [document.path, document.content]),
    ),
  });
  const loadedLedger = loadLedgerRecord({
    ledgerRoot,
    root: createdLedger.root,
    expectedFamily: "requirement",
    expectedProgramId: INTEGRATION_IDS.program,
  });
  const authorityRefs = documents.map((document) => (
    createLedgerMemberReference(loadedLedger, document.path)
  ));

  const baseTime = Date.now() - 60_000;
  const demand = {
    schemaVersion: 1,
    artifactKind: "wakeflow-demand",
    programId: INTEGRATION_IDS.program,
    demandId: INTEGRATION_IDS.demand,
    createdAt: new Date(baseTime).toISOString(),
    title: "Delivery orchestration integration",
    goal: "Exercise the exact prepare, claim, outcome, and rearm chain.",
    completionDefinition: "Every delivery transition is state, transport, lease, and event closed.",
    demandType: "requirement",
    source: {
      schemaVersion: 1,
      artifactKind: "wakeflow-todo-lineage-ref",
      boardRef: ".wakeflow-active/current/global-todo-board.md",
      todoId: "TODO-M3-T07-INTEGRATION",
      intakeRowDigest: `sha256:${"a".repeat(64)}`,
    },
    executionPlacement: { mode: "main" },
  };
  const authority = {
    schemaVersion: 1,
    artifactKind: "wakeflow-demand-authority",
    demandId: INTEGRATION_IDS.demand,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(demand),
    entryMode: "design-delivery",
    authorityRefs,
    testDecision: testTarget
      ? {
        mode: "real-environment",
        summary: "Use the exact disposable real-environment Test strategy.",
        environmentSpecRef: authorityRefs.find(
          (entry) => entry.role === "test-environment",
        ).memberRef,
      }
      : {
        mode: "controller-only",
        summary: "The disposable orchestration service integration is sufficient.",
      },
  };
  const initialEvent = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: "event-delivery-orchestration-initial-0001",
    demandId: INTEGRATION_IDS.demand,
    createdAt: demand.createdAt,
    actor: "controller",
    command: "init",
    type: "state.initialized",
    previousRevision: 0,
    nextRevision: 1,
    from: null,
    to: "intake",
    reason: "Initialize one disposable delivery orchestration authority.",
    decisionSummary: "Freeze demand and requirement authority before task planning.",
    changedArtifacts: [
      { artifactKind: "wakeflow-demand", ref: "demand.json", digest: canonicalJsonDigest(demand) },
      {
        artifactKind: "wakeflow-demand-authority",
        ref: "demand-authority.json",
        digest: canonicalJsonDigest(authority),
      },
    ],
  };
  const stateRoot = path.join(
    workspaceRoot,
    ".wakeflow-active/current",
    INTEGRATION_IDS.demand,
  );
  for (const ref of [
    "",
    "task-packages",
    "target-results",
    "review-candidates",
    "test-cards",
    "evidence",
    "transactions",
  ]) {
    const directory = ref ? path.join(stateRoot, ref) : stateRoot;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") chmodSync(directory, 0o700);
  }
  const initialState = {
    schemaVersion: 1,
    artifactKind: "wakeflow-state",
    programId: INTEGRATION_IDS.program,
    demandId: INTEGRATION_IDS.demand,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(demand),
    demandAuthorityRef: "demand-authority.json",
    demandAuthorityDigest: canonicalJsonDigest(authority),
    revision: 1,
    state: "intake",
    stateReason: initialEvent.reason,
    updatedAt: initialEvent.createdAt,
    lastEvent: {
      eventId: initialEvent.eventId,
      eventDigest: canonicalJsonDigest(initialEvent),
    },
    taskPackages: [],
    targetTasks: [],
    targetResults: [],
    testCards: [],
    evidence: [],
    review: {
      status: "idle",
      readyTargetTaskIds: [],
      blockedTargetTaskIds: [],
      missingTargetTaskIds: [],
    },
  };
  writePrivateCanonical(path.join(stateRoot, "demand.json"), demand);
  writePrivateCanonical(path.join(stateRoot, "demand-authority.json"), authority);
  writePrivateCanonical(path.join(stateRoot, "wakeflow-state.json"), initialState);
  writeFileSync(
    path.join(stateRoot, "controller-events.jsonl"),
    `${canonicalJson(initialEvent)}\n`,
    { mode: 0o600 },
  );

  let cardRecord = null;
  let cardCommit = null;
  if (testTarget) {
    const strategyRef = authorityRefs.find((entry) => entry.role === "test-environment");
    cardRecord = {
      schemaVersion: 1,
      artifactKind: "wakeflow-test-card",
      programId: INTEGRATION_IDS.program,
      demandId: INTEGRATION_IDS.demand,
      demandRef: "demand.json",
      demandDigest: canonicalJsonDigest(demand),
      createdAt: new Date(baseTime + 1_000).toISOString(),
      testCardId: INTEGRATION_IDS.testCard,
      targetTaskId: INTEGRATION_IDS.testTargetTask,
      windowId: INTEGRATION_IDS.testWindow,
      demandAuthorityRef: "demand-authority.json",
      demandAuthorityDigest: canonicalJsonDigest(authority),
      strategySource: {
        ref: strategyRef.memberRef,
        digest: strategyRef.memberDigest,
      },
      observedState: {
        revision: initialState.revision,
        eventId: initialState.lastEvent.eventId,
        eventDigest: initialState.lastEvent.eventDigest,
      },
      executionContract: {
        requirementGoal: demand.goal,
        approvedPlan: ["Run the approved disposable real-environment scenario."],
        allowedSkills: [],
        setupPolicy: "fresh-per-attempt",
        maxAttempts: 2,
        restartConditions: ["The disposable Test environment is proven contaminated."],
        changeControl: {
          testMayChangeApproach: false,
          testMayChangeGoal: false,
          testMayAddUnmappedSteps: false,
          testMayUseUnlistedSkills: false,
          route: "return-blocked-to-controller",
        },
      },
      boundaryGate: {
        question: "Does the confirmed behavior work in the disposable environment?",
        objectBoundary: "Only the assigned disposable Test behavior.",
        controllerSelfChecks: ["The candidate delivery services already pass focused checks."],
        realScenarioConditions: ["Use a fresh disposable Test environment."],
        successMeans: ["The observed behavior matches the confirmed requirement."],
        failureMeans: ["The observed behavior contradicts the confirmed requirement."],
        cannotConclude: ["The disposable environment is unavailable."],
        stopConditions: ["The immutable attempt limit is reached."],
      },
      evidenceRequired: ["Portable execution summary."],
      allowedOperations: ["Operate only inside the disposable Test environment."],
      forbiddenOperations: ["Do not modify product or controller authority."],
    };
    cardCommit = createTestCardArtifact({
      stateRoot,
      expectedProgramId: INTEGRATION_IDS.program,
      ledgerRoot,
      config,
      expectedPrevious: {
        revision: initialState.revision,
        stateDigest: canonicalJsonDigest(initialState),
      },
      artifact: cardRecord,
      transition: {
        eventId: "event-delivery-orchestration-test-card-0002",
        createdAt: cardRecord.createdAt,
        reason: "Freeze the exact disposable Test execution contract.",
        decisionSummary: "Bind logical Test attempts to one immutable TestCard.",
      },
    });
  }

  const packageRecord = {
    schemaVersion: 1,
    artifactKind: "wakeflow-task-package",
    programId: INTEGRATION_IDS.program,
    demandId: INTEGRATION_IDS.demand,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(demand),
    demandAuthorityRef: "demand-authority.json",
    demandAuthorityDigest: canonicalJsonDigest(authority),
    createdAt: new Date(baseTime + (testTarget ? 2_000 : 1_000)).toISOString(),
    taskPackageId: testTarget
      ? INTEGRATION_IDS.testTaskPackage
      : INTEGRATION_IDS.taskPackage,
    targetTaskId: testTarget
      ? INTEGRATION_IDS.testTargetTask
      : INTEGRATION_IDS.targetTask,
    windowId: testTarget
      ? INTEGRATION_IDS.testWindow
      : INTEGRATION_IDS.productWindow,
    ...(testTarget ? {} : { repositoryId: INTEGRATION_IDS.repository }),
    workType: testTarget ? "test" : "implementation",
    objective: testTarget
      ? "Execute the exact disposable TestCard without conflating host sends and Test attempts."
      : "Exercise the bounded delivery orchestration chain.",
    confirmedContext: ["The Controller confirmed this disposable integration fixture."],
    requirementRefs: [{
      role: "goal",
      ref: authorityRefs.find((entry) => entry.role === "original-plan").memberRef,
      digest: authorityRefs.find((entry) => entry.role === "original-plan").memberDigest,
      anchor: "original-plan",
    }],
    boundaries: {
      inScope: ["Only this disposable fixture."],
      outOfScope: ["Any external workspace."],
      forbidden: ["Do not expose the host handle."],
    },
    completionExpectations: ["The exact orchestration chain closes."],
    dependsOnTargetTaskIds: [],
    ...(testTarget ? {} : { commitExpectation: "leave-uncommitted" }),
    acceptanceAnchors: testTarget ? [] : [{
      anchorId: "A1",
      claim: "Delivery state and local evidence remain exact.",
      probe: "Run this service-level integration test.",
      expected: "The focused integration passes.",
    }],
    reviewInputContract: {
      requiredKinds: testTarget ? [] : ["test-output"],
      requiredAcceptanceAnchorIds: testTarget ? [] : ["A1"],
    },
    ...(testTarget ? {
      testCard: {
        testCardId: INTEGRATION_IDS.testCard,
        ref: cardCommit.artifact.ref,
        digest: cardCommit.artifact.digest,
      },
    } : {}),
  };
  const stateBeforePackage = testTarget ? loadDemandCoreRecords({
    stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    ledgerRoot,
  }) : { state: initialState, digests: { state: canonicalJsonDigest(initialState) } };
  createTaskPackageArtifact({
    stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    ledgerRoot,
    config,
    expectedPrevious: {
      revision: stateBeforePackage.state.revision,
      stateDigest: stateBeforePackage.digests.state,
    },
    artifact: packageRecord,
    transition: {
      eventId: testTarget
        ? "event-delivery-orchestration-test-package-0003"
        : "event-delivery-orchestration-package-0002",
      createdAt: packageRecord.createdAt,
      reason: "Freeze the exact disposable target package.",
      decisionSummary: testTarget
        ? "Bind one Test target and its immutable TestCard before delivery preparation."
        : "Bind one product target before delivery preparation.",
    },
  });

  let packageRecordTwo = null;
  if (secondProduct) {
    const afterFirstPackage = loadDemandCoreRecords({
      stateRoot,
      expectedProgramId: INTEGRATION_IDS.program,
      ledgerRoot,
    });
    packageRecordTwo = {
      ...structuredClone(packageRecord),
      createdAt: new Date(baseTime + 2_000).toISOString(),
      taskPackageId: INTEGRATION_IDS.taskPackageTwo,
      targetTaskId: INTEGRATION_IDS.targetTaskTwo,
      windowId: INTEGRATION_IDS.productWindowTwo,
      repositoryId: INTEGRATION_IDS.repositoryTwo,
      objective: "Exercise the second bounded delivery orchestration target.",
    };
    createTaskPackageArtifact({
      stateRoot,
      expectedProgramId: INTEGRATION_IDS.program,
      ledgerRoot,
      config,
      expectedPrevious: {
        revision: afterFirstPackage.state.revision,
        stateDigest: afterFirstPackage.digests.state,
      },
      artifact: packageRecordTwo,
      transition: {
        eventId: "event-delivery-orchestration-package-0003",
        createdAt: packageRecordTwo.createdAt,
        reason: "Freeze the second exact disposable target package.",
        decisionSummary: "Bind the second repository target before group delivery.",
      },
    });
  }

  const binding = createWindowBindingRecord({
    programId: INTEGRATION_IDS.program,
    hostId,
    windowId: testTarget ? INTEGRATION_IDS.testWindow : INTEGRATION_IDS.productWindow,
    bindingId: testTarget ? INTEGRATION_IDS.testBinding : INTEGRATION_IDS.binding,
    handle: {
      kind: handleKind,
      value: testTarget ? INTEGRATION_IDS.testHandle : INTEGRATION_IDS.handle,
    },
    registeredAt: new Date(baseTime + 2_000).toISOString(),
  });
  const bindingRef = windowBindingRef({
    hostDirName,
    windowId: testTarget ? INTEGRATION_IDS.testWindow : INTEGRATION_IDS.productWindow,
  });
  writeFileSync(
    path.resolve(workspaceRoot, ...bindingRef.split("/")),
    windowBindingCanonicalBytes(binding),
    { flag: "wx", mode: 0o600 },
  );
  const controllerBinding = createWindowBindingRecord({
    programId: INTEGRATION_IDS.program,
    hostId,
    windowId: INTEGRATION_IDS.controllerWindow,
    bindingId: INTEGRATION_IDS.controllerBinding,
    handle: { kind: handleKind, value: INTEGRATION_IDS.controllerHandle },
    registeredAt: new Date(baseTime + 2_500).toISOString(),
  });
  const controllerBindingRef = windowBindingRef({
    hostDirName,
    windowId: INTEGRATION_IDS.controllerWindow,
  });
  writeFileSync(
    path.resolve(workspaceRoot, ...controllerBindingRef.split("/")),
    windowBindingCanonicalBytes(controllerBinding),
    { flag: "wx", mode: 0o600 },
  );
  if (secondProduct) {
    const bindingTwo = createWindowBindingRecord({
      programId: INTEGRATION_IDS.program,
      hostId,
      windowId: INTEGRATION_IDS.productWindowTwo,
      bindingId: INTEGRATION_IDS.bindingTwo,
      handle: { kind: handleKind, value: INTEGRATION_IDS.handleTwo },
      registeredAt: new Date(baseTime + 3_000).toISOString(),
    });
    const bindingRefTwo = windowBindingRef({
      hostDirName,
      windowId: INTEGRATION_IDS.productWindowTwo,
    });
    writeFileSync(
      path.resolve(workspaceRoot, ...bindingRefTwo.split("/")),
      windowBindingCanonicalBytes(bindingTwo),
      { flag: "wx", mode: 0o600 },
    );
  }
  return {
    workspaceRoot,
    stateRoot,
    ledgerRoot,
    config,
    demand,
    authority,
    packageRecord,
    packageRecordTwo,
    cardRecord,
    hostId,
  };
}

export function loadIntegrationStack(fixture) {
  return loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
}
