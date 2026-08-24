import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs, {
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
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  createTaskPackageArtifact,
  createTestCardArtifact,
  recordTargetResultArtifact,
} from "../core/scripts/lib/wakeflow-demand-artifact-service.mjs";
import {
  demandDeliverySummaryDigest,
  loadDemandCoreRecords,
  validateDemandStateRecord,
  validateStateTransitionRecord,
} from "../core/scripts/lib/wakeflow-demand-core-records.mjs";
import { commitDemandStateTransition } from "../core/scripts/lib/wakeflow-demand-state-service.mjs";
import {
  createLedgerMemberReference,
  createLedgerRecord,
  loadLedgerRecord,
} from "../core/scripts/lib/wakeflow-ledger-records.mjs";
import {
  createWindowBindingRecord,
  windowBindingCanonicalBytes,
  windowBindingRef,
} from "../core/scripts/lib/wakeflow-window-binding-records.mjs";
import {
  releaseWindowCoordinationLease,
} from "../core/scripts/lib/wakeflow-window-lease-service.mjs";
import {
  inspectWakeflowWorkspaceMutation,
} from "../core/scripts/lib/wakeflow-workspace-mutation.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

const INTEGRATION_IDS = Object.freeze({
  program: "program_11111111-1111-4111-8111-111111111111",
  demand: "demand_12121212-1212-4212-8212-121212121212",
  requirement: "requirement_13131313-1313-4313-8313-131313131313",
  repository: "repository_22222222-2222-4222-8222-222222222222",
  repositoryTwo: "repository_20202020-2020-4020-8020-202020202020",
  controllerWindow: "window_55555555-5555-4555-8555-555555555555",
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

function writePrivateCanonical(file, value) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${canonicalJson(value)}\n`, { mode: 0o600 });
  if (process.platform !== "win32") chmodSync(file, 0o600);
}

function privateTreeSnapshot(root) {
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

function timestampAfter(...values) {
  return new Date(Math.max(...values.map((value) => Date.parse(value))) + 1).toISOString();
}

function integrationDeterministicId(type, seed) {
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

function integrationDeliveryEventId(seed) {
  return `delivery-event-${integrationDeterministicId(
    "delivery",
    { event: seed },
  ).slice("delivery_".length)}`;
}

async function createIntegrationFixture(t, {
  secondProduct = false,
  testTarget = false,
} = {}) {
  assert.equal(
    secondProduct && testTarget,
    false,
    "the disposable fixture does not combine its independent multi-product and Test variants",
  );
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
    ".wakeflow-local/runtime/hosts/codex/identity/window-bindings",
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
    hostId: "codex",
    windowId: testTarget ? INTEGRATION_IDS.testWindow : INTEGRATION_IDS.productWindow,
    bindingId: testTarget ? INTEGRATION_IDS.testBinding : INTEGRATION_IDS.binding,
    handle: {
      kind: "codex-thread",
      value: testTarget ? INTEGRATION_IDS.testHandle : INTEGRATION_IDS.handle,
    },
    registeredAt: new Date(baseTime + 2_000).toISOString(),
  });
  const bindingRef = windowBindingRef({
    hostDirName: "codex",
    windowId: testTarget ? INTEGRATION_IDS.testWindow : INTEGRATION_IDS.productWindow,
  });
  writeFileSync(
    path.resolve(workspaceRoot, ...bindingRef.split("/")),
    windowBindingCanonicalBytes(binding),
    { flag: "wx", mode: 0o600 },
  );
  if (secondProduct) {
    const bindingTwo = createWindowBindingRecord({
      programId: INTEGRATION_IDS.program,
      hostId: "codex",
      windowId: INTEGRATION_IDS.productWindowTwo,
      bindingId: INTEGRATION_IDS.bindingTwo,
      handle: { kind: "codex-thread", value: INTEGRATION_IDS.handleTwo },
      registeredAt: new Date(baseTime + 3_000).toISOString(),
    });
    const bindingRefTwo = windowBindingRef({
      hostDirName: "codex",
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
  };
}

function loadIntegrationStack(fixture) {
  return loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
}

async function createClaimedIntegrationDelivery(t, orchestration, prompt) {
  const fixture = await createIntegrationFixture(t);
  const source = loadIntegrationStack(fixture);
  const plan = orchestration.planTargetDelivery({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targets: [{
      targetTaskId: INTEGRATION_IDS.targetTask,
      prompt,
      contextPolicy: "assumed-current",
      automationRequested: false,
    }],
    returnPolicy: { mode: "group-ready" },
    createdAt: timestampAfter(source.state.updatedAt, new Date().toISOString()),
  });
  const applied = await orchestration.applyTargetDeliveryPlan({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    plan,
    planDigest: plan.planDigest,
  });
  const claimInput = {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targetTaskId: INTEGRATION_IDS.targetTask,
    deliveryId: applied.members[0].envelope.deliveryId,
    sendGeneration: 1,
  };
  const permit = await orchestration.claimTargetDelivery(claimInput);
  const leaseFile = path.resolve(
    fixture.workspaceRoot,
    ...permit.lease.ref.split("/"),
  );
  return {
    fixture,
    claimInput,
    permit,
    claimed: loadIntegrationStack(fixture),
    leaseFile,
    lease: JSON.parse(readFileSync(leaseFile, "utf8")),
  };
}

function exactClaimJournal(fixture, stack, targetTaskId) {
  const previousState = stack.state;
  const task = previousState.targetTasks.find(
    (entry) => entry.targetTaskId === targetTaskId,
  );
  const delivery = task.currentDelivery;
  const nextDelivery = structuredClone(delivery);
  const eventId = integrationDeliveryEventId({
    command: "claim-target-delivery-send",
    demandId: fixture.demand.demandId,
    targetTaskId,
    deliveryId: delivery.envelope.deliveryId,
    sendGeneration: delivery.sendGeneration,
    previousStateDigest: canonicalJsonDigest(previousState),
  });
  const createdAt = timestampAfter(previousState.updatedAt);
  const placeholder = {
    revision: previousState.revision + 1,
    eventId,
    eventDigest: `sha256:${"0".repeat(64)}`,
  };
  nextDelivery.phase = "send-claimed";
  nextDelivery.claimedBy = placeholder;
  const event = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId,
    demandId: fixture.demand.demandId,
    createdAt,
    actor: "controller",
    command: "claim-target-delivery-send",
    type: "target-delivery.send-claimed",
    previousRevision: previousState.revision,
    nextRevision: previousState.revision + 1,
    from: previousState.state,
    to: previousState.state,
    reason: "Claim the single external-send interval for this delivery generation.",
    decisionSummary: "Only this state revision may cross the host-effect boundary.",
    changedArtifacts: [],
    deliveryTransition: {
      targetTaskId,
      deliveryId: delivery.envelope.deliveryId,
      envelopeDigest: delivery.envelope.digest,
      sendGeneration: delivery.sendGeneration,
      fromPhase: "prepared",
      toPhase: "send-claimed",
      previousSummaryDigest: demandDeliverySummaryDigest(delivery),
      nextSummaryDigest: demandDeliverySummaryDigest(nextDelivery),
    },
  };
  const authority = {
    revision: event.nextRevision,
    eventId,
    eventDigest: canonicalJsonDigest(event),
  };
  nextDelivery.claimedBy = authority;
  const nextState = structuredClone(previousState);
  nextState.revision = event.nextRevision;
  nextState.stateReason = event.reason;
  nextState.updatedAt = event.createdAt;
  nextState.lastEvent = { eventId, eventDigest: authority.eventDigest };
  nextState.targetTasks.find(
    (entry) => entry.targetTaskId === targetTaskId,
  ).currentDelivery = nextDelivery;
  return validateStateTransitionRecord({
    schemaVersion: 1,
    artifactKind: "wakeflow-state-transition",
    demandId: fixture.demand.demandId,
    command: event.command,
    createdAt: event.createdAt,
    expectedPreviousRevision: previousState.revision,
    expectedPreviousStateDigest: canonicalJsonDigest(previousState),
    previousState,
    nextEvent: event,
    nextEventDigest: canonicalJsonDigest(event),
    nextState,
    nextStateDigest: canonicalJsonDigest(nextState),
    artifactWrites: [],
  }, {
    demand: stack.demand,
    currentState: previousState,
    ledgerRoot: fixture.ledgerRoot,
    events: stack.events,
  });
}

function exactJournalFromCommittedTransition(fixture, previous, committed) {
  assert.equal(committed.state.revision, previous.state.revision + 1);
  assert.equal(committed.events.length, previous.events.length + 1);
  const event = committed.events.at(-1);
  return validateStateTransitionRecord({
    schemaVersion: 1,
    artifactKind: "wakeflow-state-transition",
    demandId: fixture.demand.demandId,
    command: event.command,
    createdAt: event.createdAt,
    expectedPreviousRevision: previous.state.revision,
    expectedPreviousStateDigest: canonicalJsonDigest(previous.state),
    previousState: previous.state,
    nextEvent: event,
    nextEventDigest: canonicalJsonDigest(event),
    nextState: committed.state,
    nextStateDigest: canonicalJsonDigest(committed.state),
    artifactWrites: [],
  }, {
    demand: previous.demand,
    currentState: previous.state,
    ledgerRoot: fixture.ledgerRoot,
    events: previous.events,
  });
}

function installPreexistingTransitionJournal(fixture, previous, journal) {
  writePrivateCanonical(path.join(fixture.stateRoot, "wakeflow-state.json"), previous.state);
  writeFileSync(
    path.join(fixture.stateRoot, "controller-events.jsonl"),
    `${previous.events.map((entry) => canonicalJson(entry)).join("\n")}\n`,
    { mode: 0o600 },
  );
  if (process.platform !== "win32") {
    chmodSync(path.join(fixture.stateRoot, "controller-events.jsonl"), 0o600);
  }
  const journalFile = path.join(fixture.stateRoot, "transactions/state-transition.json");
  writePrivateCanonical(journalFile, journal);
  return journalFile;
}

function installCleanupOnlyTransitionJournal(fixture, previous, journal) {
  writePrivateCanonical(path.join(fixture.stateRoot, "wakeflow-state.json"), journal.nextState);
  writeFileSync(
    path.join(fixture.stateRoot, "controller-events.jsonl"),
    `${[...previous.events, journal.nextEvent]
      .map((entry) => canonicalJson(entry)).join("\n")}\n`,
    { mode: 0o600 },
  );
  if (process.platform !== "win32") {
    chmodSync(path.join(fixture.stateRoot, "controller-events.jsonl"), 0o600);
  }
  const journalFile = path.join(fixture.stateRoot, "transactions/state-transition.json");
  writePrivateCanonical(journalFile, journal);
  return journalFile;
}

function buildTestTargetResult(fixture, stack, {
  targetResultId,
  supersedes = null,
} = {}) {
  const task = stack.state.targetTasks.find(
    (entry) => entry.targetTaskId === INTEGRATION_IDS.testTargetTask,
  );
  const delivery = task.currentDelivery;
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-target-result",
    programId: INTEGRATION_IDS.program,
    demandId: INTEGRATION_IDS.demand,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(fixture.demand),
    createdAt: timestampAfter(stack.state.updatedAt),
    targetResultId,
    targetTaskId: INTEGRATION_IDS.testTargetTask,
    taskPackage: {
      taskPackageId: fixture.packageRecord.taskPackageId,
      ref: `task-packages/${fixture.packageRecord.taskPackageId}.json`,
      digest: canonicalJsonDigest(fixture.packageRecord),
    },
    assignment: { windowId: INTEGRATION_IDS.testWindow },
    observedState: {
      revision: stack.state.revision,
      eventId: stack.state.lastEvent.eventId,
      eventDigest: stack.state.lastEvent.eventDigest,
    },
    transport: {
      group: {
        id: delivery.group.groupId,
        ref: delivery.group.ref,
        digest: delivery.group.digest,
      },
      envelope: {
        id: delivery.envelope.deliveryId,
        ref: delivery.envelope.ref,
        digest: delivery.envelope.digest,
      },
    },
    outcome: "completed",
    summary: "The exact disposable Test attempt completed with portable evidence.",
    repositoryChanges: [],
    evidenceLocators: [{
      kind: "test-step",
      ref: `evidence/${targetResultId}.txt`,
      digest: `sha256:${(
        targetResultId === INTEGRATION_IDS.testResult ? "d" : "e"
      ).repeat(64)}`,
    }],
    verification: ["The approved disposable Test step completed."],
    risks: [],
    craftMapping: [{
      kind: "test-step",
      planIndex: 0,
      step: fixture.cardRecord.executionContract.approvedPlan[0],
      ref: `evidence/${targetResultId}.txt`,
    }],
    ...(supersedes ? { supersedes } : {}),
  };
}

function recordTestTargetResult(fixture, targetResultId, supersedes = null) {
  const stack = loadIntegrationStack(fixture);
  const result = buildTestTargetResult(fixture, stack, { targetResultId, supersedes });
  const commit = recordTargetResultArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.config,
    expectedPrevious: {
      revision: stack.state.revision,
      stateDigest: stack.digests.state,
    },
    artifact: result,
    selection: "current",
    transition: {
      eventId: `event-delivery-orchestration-${targetResultId}`,
      createdAt: result.createdAt,
      reason: "Record the exact disposable Test result for Controller rework review.",
      decisionSummary: "Bind the Test result to its current group and envelope authority.",
    },
  });
  return { result, commit };
}

async function moveTestTargetToRework(fixture) {
  const stack = loadIntegrationStack(fixture);
  const createdAt = timestampAfter(stack.state.updatedAt);
  const event = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: `event-delivery-orchestration-test-rework-${stack.state.revision + 1}`,
    demandId: INTEGRATION_IDS.demand,
    createdAt,
    actor: "controller",
    command: "request-review-rework",
    type: "review.rework-requested",
    previousRevision: stack.state.revision,
    nextRevision: stack.state.revision + 1,
    from: stack.state.state,
    to: "needs-rework",
    reason: "Require another logical Test attempt after reviewing the exact current result.",
    decisionSummary: "Retain the immutable result and authorize a bounded Test restart decision.",
    changedArtifacts: [],
  };
  const nextState = structuredClone(stack.state);
  nextState.revision = event.nextRevision;
  nextState.state = event.to;
  nextState.stateReason = event.reason;
  nextState.updatedAt = event.createdAt;
  nextState.lastEvent = {
    eventId: event.eventId,
    eventDigest: canonicalJsonDigest(event),
  };
  nextState.targetTasks.find(
    (entry) => entry.targetTaskId === INTEGRATION_IDS.testTargetTask,
  ).lifecycleStatus = "needs-rework";
  // Review-decision production is intentionally deferred to M3-T08. This
  // disposable fixture materializes that already-confirmed prerequisite state
  // directly so T07 can validate attempt planning without inventing a second
  // review writer in the orchestration owner.
  writePrivateCanonical(path.join(fixture.stateRoot, "wakeflow-state.json"), nextState);
  writeFileSync(
    path.join(fixture.stateRoot, "controller-events.jsonl"),
    `${[...stack.events, event].map((entry) => canonicalJson(entry)).join("\n")}\n`,
    { mode: 0o600 },
  );
  if (process.platform !== "win32") {
    chmodSync(path.join(fixture.stateRoot, "controller-events.jsonl"), 0o600);
  }
  const delivery = nextState.targetTasks.find(
    (entry) => entry.targetTaskId === INTEGRATION_IDS.testTargetTask,
  ).currentDelivery;
  await releaseWindowCoordinationLease({
    workspaceRoot: fixture.workspaceRoot,
    windowId: INTEGRATION_IDS.testWindow,
    leaseId: delivery.lease.leaseId,
    deliveryId: delivery.envelope.deliveryId,
    bindingId: INTEGRATION_IDS.testBinding,
    leaseDigest: delivery.lease.digest,
  });
  return loadIntegrationStack(fixture);
}

function demandRecord() {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-demand",
    programId: IDS.program,
    demandId: IDS.demand,
    createdAt: "2026-08-08T00:00:00Z",
    title: "Delivery transition fixture",
    goal: "Validate delivery authorization state.",
    completionDefinition: "Only one exact delivery state edge is accepted.",
    demandType: "requirement",
    source: {
      schemaVersion: 1,
      artifactKind: "wakeflow-todo-lineage-ref",
      boardRef: ".wakeflow-active/current/global-todo-board.md",
      todoId: "TODO-M3-T07",
      intakeRowDigest: `sha256:${"7".repeat(64)}`,
    },
    executionPlacement: { mode: "main" },
  };
}

function plannedState(demand) {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-state",
    programId: IDS.program,
    demandId: IDS.demand,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(demand),
    revision: 2,
    state: "planned",
    stateReason: "Target task package is ready for delivery.",
    updatedAt: "2026-08-08T00:01:00Z",
    lastEvent: {
      eventId: "event-task-package-created",
      eventDigest: DIGESTS.previousEvent,
    },
    taskPackages: [{
      taskPackageId: IDS.taskPackage,
      ref: `task-packages/${IDS.taskPackage}.json`,
      digest: DIGESTS.package,
      lifecycleStatus: "active",
    }],
    targetTasks: [{
      targetTaskId: IDS.targetTask,
      taskPackageId: IDS.taskPackage,
      windowId: IDS.window,
      lifecycleStatus: "planned",
    }],
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
}

function transitionRecord({ demand, previousState, event, nextState }) {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-state-transition",
    demandId: demand.demandId,
    command: event.command,
    createdAt: event.createdAt,
    expectedPreviousRevision: previousState.revision,
    expectedPreviousStateDigest: canonicalJsonDigest(previousState),
    previousState,
    nextEvent: event,
    nextEventDigest: canonicalJsonDigest(event),
    nextState,
    nextStateDigest: canonicalJsonDigest(nextState),
    artifactWrites: [],
  };
}

function prepareTransitionFixture() {
  const demand = demandRecord();
  const previousState = plannedState(demand);
  const authority = {
    revision: 3,
    eventId: "event-delivery-prepared",
    eventDigest: `sha256:${"0".repeat(64)}`,
  };
  const currentDelivery = {
    sourceState: {
      revision: previousState.revision,
      stateDigest: canonicalJsonDigest(previousState),
      eventId: previousState.lastEvent.eventId,
      eventDigest: previousState.lastEvent.eventDigest,
    },
    group: {
      groupId: IDS.group,
      ref: `.wakeflow-local/runtime/shared/transport/demands/${IDS.demand}/groups/${IDS.group}.json`,
      digest: DIGESTS.group,
    },
    packet: {
      packetId: IDS.packet,
      ref: `.wakeflow-local/runtime/shared/transport/demands/${IDS.demand}/packets/${IDS.packet}.json`,
      digest: DIGESTS.packet,
    },
    envelope: {
      deliveryId: IDS.delivery,
      ref: `.wakeflow-local/runtime/shared/transport/demands/${IDS.demand}/envelopes/${IDS.delivery}.json`,
      digest: DIGESTS.envelope,
    },
    lease: {
      leaseId: IDS.lease,
      ref: `.wakeflow-local/runtime/shared/coordination/window-leases/${IDS.window}.json`,
      digest: DIGESTS.lease,
    },
    phase: "prepared",
    sendGeneration: 1,
    preparedBy: authority,
    authorizedBy: authority,
  };
  const event = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: authority.eventId,
    demandId: IDS.demand,
    createdAt: "2026-08-08T00:02:00Z",
    actor: "controller",
    command: "prepare-target-delivery",
    type: "target-delivery.prepared",
    previousRevision: 2,
    nextRevision: 3,
    from: "planned",
    to: "dispatched",
    reason: "Exact target delivery transport is frozen.",
    decisionSummary: "Authorize one immutable delivery envelope for pre-send claim.",
    changedArtifacts: [],
    deliveryTransition: {
      targetTaskId: IDS.targetTask,
      deliveryId: IDS.delivery,
      envelopeDigest: DIGESTS.envelope,
      sendGeneration: 1,
      fromPhase: null,
      toPhase: "prepared",
      previousSummaryDigest: null,
      nextSummaryDigest: demandDeliverySummaryDigest(currentDelivery),
    },
  };
  authority.eventDigest = canonicalJsonDigest(event);
  const nextState = structuredClone(previousState);
  nextState.revision = 3;
  nextState.state = "dispatched";
  nextState.stateReason = event.reason;
  nextState.updatedAt = event.createdAt;
  nextState.lastEvent = {
    eventId: event.eventId,
    eventDigest: canonicalJsonDigest(event),
  };
  nextState.targetTasks[0].lifecycleStatus = "dispatched";
  nextState.targetTasks[0].currentDelivery = currentDelivery;
  return {
    demand,
    previousState,
    event,
    nextState,
    transition: transitionRecord({ demand, previousState, event, nextState }),
  };
}

test("M3-T07 candidate owner exposes only the reviewed delivery orchestration surface", async () => {
  const identifiers = await import("../core/scripts/lib/wakeflow-identifiers.mjs");
  const orchestration = await import(
    "../core/scripts/lib/wakeflow-delivery-orchestration.mjs"
  );

  assert.deepEqual(Object.keys(orchestration).sort(), [
    "WakeflowDeliveryOrchestrationError",
    "applyTargetDeliveryPlan",
    "claimTargetDelivery",
    "planTargetDelivery",
    "rearmTargetDelivery",
    "recordTargetDeliveryOutcome",
  ]);

  const attemptId = identifiers.generateWakeflowId("test-attempt");
  assert.match(
    attemptId,
    /^test-attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  assert.equal(identifiers.assertWakeflowId(attemptId, "test-attempt"), attemptId);

  const stateSchema = JSON.parse(readFileSync(path.join(
    repositoryRoot,
    "core/schemas/wakeflow-demand-core/wakeflow-state.schema.json",
  ), "utf8"));
  const eventSchema = JSON.parse(readFileSync(path.join(
    repositoryRoot,
    "core/schemas/wakeflow-demand-core/controller-event.schema.json",
  ), "utf8"));

  assert.equal(
    stateSchema.$defs.targetTaskState.properties.currentDelivery.$ref,
    "#/$defs/currentDelivery",
  );
  assert.equal(
    stateSchema.$defs.targetTaskState.properties.testAttempts.type,
    "array",
  );
  assert.equal(
    eventSchema.properties.deliveryTransition.$ref,
    "#/$defs/deliveryTransition",
  );

  const contractError = (error) => (
    error?.code === "wakeflow-delivery-orchestration-contract"
  );
  const validTarget = {
    targetTaskId: INTEGRATION_IDS.targetTask,
    prompt: "Review R26 passive input admission.",
    contextPolicy: "assumed-current",
    automationRequested: false,
  };
  const planInput = (targets) => ({
    workspaceRoot: "/not-read",
    stateRoot: "/not-read",
    expectedProgramId: INTEGRATION_IDS.program,
    targets,
    returnPolicy: { mode: "group-ready" },
    createdAt: "2026-08-24T00:00:00.000Z",
  });

  let targetGetterCalls = 0;
  const activeTargets = new Array(1);
  Object.defineProperty(activeTargets, "0", {
    enumerable: true,
    get() {
      targetGetterCalls += 1;
      return validTarget;
    },
  });
  assert.throws(
    () => orchestration.planTargetDelivery(planInput(activeTargets)),
    contractError,
  );
  assert.equal(targetGetterCalls, 0, "targets accessor must not execute during admission");

  let planKindGetterCalls = 0;
  const activePlan = {};
  Object.defineProperty(activePlan, "kind", {
    enumerable: true,
    get() {
      planKindGetterCalls += 1;
      return "WakeflowTargetDeliveryPlan";
    },
  });
  await assert.rejects(() => orchestration.applyTargetDeliveryPlan({
    workspaceRoot: "/not-read",
    stateRoot: "/not-read",
    expectedProgramId: INTEGRATION_IDS.program,
    plan: activePlan,
    planDigest: `sha256:${"a".repeat(64)}`,
  }), contractError);
  assert.equal(planKindGetterCalls, 0, "plan accessor must not execute during admission");

  for (const targets of [
    (() => {
      const value = [validTarget];
      Object.defineProperty(value, "hidden", { value: true, enumerable: false });
      return value;
    })(),
    Object.assign([validTarget], { [Symbol("unknown")]: true }),
  ]) {
    assert.throws(
      () => orchestration.planTargetDelivery(planInput(targets)),
      contractError,
    );
  }

  const source = readFileSync(path.join(
    repositoryRoot,
    "core/scripts/lib/wakeflow-delivery-orchestration.mjs",
  ), "utf8");
  assert.doesNotMatch(source, /\.localeCompare\(/u);
});

test("delivery prepare retains exact event bytes without a summary digest cycle", () => {
  const fixture = prepareTransitionFixture();
  assert.deepEqual(
    validateStateTransitionRecord(fixture.transition, {
      demand: fixture.demand,
      currentState: fixture.previousState,
    }),
    fixture.transition,
  );

  const cyclicState = structuredClone(fixture.nextState);
  cyclicState.targetTasks[0].currentDelivery.preparedBy.eventDigest = `sha256:${"8".repeat(64)}`;
  assert.doesNotThrow(() => validateDemandStateRecord(cyclicState));
  assert.equal(
    demandDeliverySummaryDigest(cyclicState.targetTasks[0].currentDelivery),
    fixture.event.deliveryTransition.nextSummaryDigest,
  );
  const cyclicTransition = structuredClone(fixture.transition);
  cyclicTransition.nextState = cyclicState;
  cyclicTransition.nextStateDigest = canonicalJsonDigest(cyclicState);
  assert.throws(
    () => validateStateTransitionRecord(cyclicTransition, {
      demand: fixture.demand,
      currentState: fixture.previousState,
    }),
    (error) => error?.code === "wakeflow-demand-core-delivery-transition",
  );
  assert.deepEqual(
    Object.keys(fixture.nextState.targetTasks[0].currentDelivery.preparedBy).sort(),
    ["eventDigest", "eventId", "revision"],
  );
});

test("generic and delivery-owned commands cannot mutate each other's state authority", async () => {
  const fixture = prepareTransitionFixture();
  const genericEvent = {
    ...fixture.event,
    command: "advance-demand",
    type: "state.advanced",
  };
  delete genericEvent.deliveryTransition;
  const genericNextState = structuredClone(fixture.nextState);
  genericNextState.lastEvent.eventDigest = canonicalJsonDigest(genericEvent);
  const genericTransition = transitionRecord({
    demand: fixture.demand,
    previousState: fixture.previousState,
    event: genericEvent,
    nextState: genericNextState,
  });
  assert.throws(
    () => validateStateTransitionRecord(genericTransition, {
      demand: fixture.demand,
      currentState: fixture.previousState,
    }),
    (error) => error?.code === "wakeflow-demand-core-delivery-authority",
  );

  const stateService = await import("../core/scripts/lib/wakeflow-demand-state-service.mjs");
  assert.equal(typeof stateService.loadDemandCoreRecordsWithArtifactClosureWhileLocked, "function");
  assert.equal(typeof stateService.commitDemandDeliveryTransitionWhileLocked, "function");
  assert.equal(typeof stateService.recoverDemandDeliveryTransitionWhileLocked, "function");
  assert.throws(
    () => stateService.commitDemandStateTransition({ event: fixture.event }),
    (error) => error?.code === "wakeflow-demand-state-delivery-owner",
  );
});

test("send claim changes only phase and its exact event pointer", () => {
  const prepared = prepareTransitionFixture();
  const previousState = prepared.nextState;
  const previousDelivery = previousState.targetTasks[0].currentDelivery;
  const authority = {
    revision: 4,
    eventId: "event-delivery-claimed",
    eventDigest: `sha256:${"0".repeat(64)}`,
  };
  const nextDelivery = structuredClone(previousDelivery);
  nextDelivery.phase = "send-claimed";
  nextDelivery.claimedBy = authority;
  const event = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: authority.eventId,
    demandId: IDS.demand,
    createdAt: "2026-08-08T00:03:00Z",
    actor: "controller",
    command: "claim-target-delivery-send",
    type: "target-delivery.send-claimed",
    previousRevision: 3,
    nextRevision: 4,
    from: "dispatched",
    to: "dispatched",
    reason: "Claim the single external-send interval.",
    decisionSummary: "Only this revision may cross the host-effect boundary.",
    changedArtifacts: [],
    deliveryTransition: {
      targetTaskId: IDS.targetTask,
      deliveryId: IDS.delivery,
      envelopeDigest: DIGESTS.envelope,
      sendGeneration: 1,
      fromPhase: "prepared",
      toPhase: "send-claimed",
      previousSummaryDigest: demandDeliverySummaryDigest(previousDelivery),
      nextSummaryDigest: demandDeliverySummaryDigest(nextDelivery),
    },
  };
  authority.eventDigest = canonicalJsonDigest(event);
  const nextState = structuredClone(previousState);
  nextState.revision = 4;
  nextState.stateReason = event.reason;
  nextState.updatedAt = event.createdAt;
  nextState.lastEvent = {
    eventId: event.eventId,
    eventDigest: canonicalJsonDigest(event),
  };
  nextState.targetTasks[0].currentDelivery = nextDelivery;
  const transition = transitionRecord({
    demand: prepared.demand,
    previousState,
    event,
    nextState,
  });
  assert.doesNotThrow(() => validateStateTransitionRecord(transition, {
    demand: prepared.demand,
    currentState: previousState,
  }));

  const forged = structuredClone(transition);
  forged.nextState.targetTasks[0].currentDelivery.lease.digest = `sha256:${"9".repeat(64)}`;
  forged.nextEvent.deliveryTransition.nextSummaryDigest = demandDeliverySummaryDigest(
    forged.nextState.targetTasks[0].currentDelivery,
  );
  forged.nextEventDigest = canonicalJsonDigest(forged.nextEvent);
  forged.nextState.lastEvent.eventDigest = forged.nextEventDigest;
  forged.nextStateDigest = canonicalJsonDigest(forged.nextState);
  assert.throws(
    () => validateStateTransitionRecord(forged, {
      demand: prepared.demand,
      currentState: previousState,
    }),
    (error) => error?.code === "wakeflow-demand-core-delivery-transition",
  );
});

test("M3-T07 closes the real plan, apply, claim, rejected rearm, and accepted outcome chain", async (t) => {
  const fixture = await createIntegrationFixture(t);
  const orchestration = await import(
    "../core/scripts/lib/wakeflow-delivery-orchestration.mjs"
  );
  const stackBeforePlan = loadIntegrationStack(fixture);
  const planInput = {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targets: [{
      targetTaskId: INTEGRATION_IDS.targetTask,
      prompt: "Continue the exact disposable orchestration task and return one strict TargetResult.",
      contextPolicy: "assumed-current",
      automationRequested: false,
    }],
    returnPolicy: { mode: "group-ready" },
    createdAt: timestampAfter(stackBeforePlan.state.updatedAt, new Date().toISOString()),
  };
  const treeBeforePlan = privateTreeSnapshot(fixture.workspaceRoot);
  const plan = orchestration.planTargetDelivery(planInput);
  const replayedPlan = orchestration.planTargetDelivery(planInput);
  assert.deepEqual(replayedPlan, plan);
  assert.deepEqual(privateTreeSnapshot(fixture.workspaceRoot), treeBeforePlan);
  assert.match(plan.planDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(plan.members.length, 1);
  assert.equal(plan.members[0].targetTaskId, INTEGRATION_IDS.targetTask);
  assert.equal(JSON.stringify(plan).includes(INTEGRATION_IDS.handle), false);

  const applyInput = {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    plan,
    planDigest: plan.planDigest,
  };
  const applied = await orchestration.applyTargetDeliveryPlan(applyInput);
  assert.equal(applied.status, "applied");
  assert.equal(applied.members[0].currentDelivery.phase, "prepared");
  const appliedReplay = await orchestration.applyTargetDeliveryPlan(applyInput);
  assert.equal(appliedReplay.status, "replayed");
  assert.equal(appliedReplay.stateDigest, applied.stateDigest);

  const deliveryId = applied.members[0].envelope.deliveryId;
  const claimInput = {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targetTaskId: INTEGRATION_IDS.targetTask,
    deliveryId,
    sendGeneration: 1,
  };
  const firstPermit = await orchestration.claimTargetDelivery(claimInput);
  assert.equal(firstPermit.kind, "WakeflowTargetDeliverySendPermit");
  assert.equal(firstPermit.sendGeneration, 1);
  assert.equal(firstPermit.prompt, planInput.targets[0].prompt);
  assert.equal(JSON.stringify(firstPermit).includes(INTEGRATION_IDS.handle), false);
  await assert.rejects(
    orchestration.claimTargetDelivery(claimInput),
    (error) => error?.code === "wakeflow-delivery-orchestration-state",
  );

  const firstClaimedStack = loadIntegrationStack(fixture);
  const firstLease = JSON.parse(readFileSync(path.resolve(
    fixture.workspaceRoot,
    ...firstPermit.lease.ref.split("/"),
  ), "utf8"));
  const rejectedOutcome = {
    hostMethod: "send-message",
    hostMode: "direct-thread",
    transportStatus: "rejected-before-send",
    readback: { status: "unavailable", attempts: 0, evidence: [] },
    error: { code: "host-send-rejected", message: "The host rejected the send before transport." },
    createdAt: timestampAfter(firstClaimedStack.state.updatedAt, firstLease.acquiredAt),
  };
  const outcomeInput = {
    ...claimInput,
    outcome: rejectedOutcome,
  };
  const rejected = await orchestration.recordTargetDeliveryOutcome(outcomeInput);
  assert.equal(rejected.status, "recorded");
  assert.equal(rejected.delivery.phase, "rejected-before-send");
  assert.equal(rejected.leaseStatus, "released");
  assert.equal(existsSync(path.resolve(
    fixture.workspaceRoot,
    ...firstPermit.lease.ref.split("/"),
  )), false);
  const rejectedReplay = await orchestration.recordTargetDeliveryOutcome(outcomeInput);
  assert.equal(rejectedReplay.status, "replayed");
  assert.equal(rejectedReplay.run.digest, rejected.run.digest);

  const rearmInput = {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targetTaskId: INTEGRATION_IDS.targetTask,
    deliveryId,
    expectedRun: {
      runId: rejected.run.runId,
      ref: rejected.run.ref,
      digest: rejected.run.digest,
    },
  };
  const rearmed = await orchestration.rearmTargetDelivery(rearmInput);
  assert.equal(rearmed.status, "rearmed");
  assert.equal(rearmed.sendGeneration, 2);
  assert.notEqual(rearmed.newLease.leaseId, firstPermit.lease.leaseId);
  assert.notEqual(rearmed.newLease.digest, firstPermit.lease.digest);
  const rearmedReplay = await orchestration.rearmTargetDelivery(rearmInput);
  assert.equal(rearmedReplay.status, "replayed");
  assert.deepEqual(rearmedReplay.newLease, rearmed.newLease);

  const secondClaimInput = { ...claimInput, sendGeneration: 2 };
  const secondPermit = await orchestration.claimTargetDelivery(secondClaimInput);
  assert.equal(secondPermit.sendGeneration, 2);
  assert.equal(secondPermit.envelope.deliveryId, deliveryId);
  const secondClaimedStack = loadIntegrationStack(fixture);
  const secondLease = JSON.parse(readFileSync(path.resolve(
    fixture.workspaceRoot,
    ...secondPermit.lease.ref.split("/"),
  ), "utf8"));
  const acceptedOutcome = {
    hostMethod: "send-message",
    hostMode: "direct-thread",
    transportStatus: "accepted",
    readback: {
      status: "confirmed",
      attempts: 1,
      evidence: [{
        kind: "thread-turn-visible",
        digest: `sha256:${"c".repeat(64)}`,
      }],
    },
    createdAt: timestampAfter(secondClaimedStack.state.updatedAt, secondLease.acquiredAt),
  };
  const acceptedInput = { ...secondClaimInput, outcome: acceptedOutcome };
  const accepted = await orchestration.recordTargetDeliveryOutcome(acceptedInput);
  assert.equal(accepted.status, "recorded");
  assert.equal(accepted.delivery.phase, "accepted");
  assert.equal(accepted.leaseStatus, "retained");
  const acceptedReplay = await orchestration.recordTargetDeliveryOutcome(acceptedInput);
  assert.equal(acceptedReplay.status, "replayed");
  assert.equal(acceptedReplay.run.digest, accepted.run.digest);
  const finalStack = loadIntegrationStack(fixture);
  assert.equal(finalStack.state.state, "waiting-results");
  assert.equal(finalStack.state.targetTasks[0].lifecycleStatus, "waiting-result");
  assert.equal(finalStack.state.targetTasks[0].currentDelivery.phase, "accepted");
  await assert.rejects(
    orchestration.rearmTargetDelivery({
      ...rearmInput,
      expectedRun: {
        runId: accepted.run.runId,
        ref: accepted.run.ref,
        digest: accepted.run.digest,
      },
    }),
    (error) => error?.code === "wakeflow-delivery-orchestration-state",
  );
  assert.equal(
    JSON.stringify({ applied, firstPermit, rejected, rearmed, secondPermit, accepted })
      .includes(INTEGRATION_IDS.handle),
    false,
  );
});

test("M3-T07 retains the exact lease for accepted readback variants and ambiguous transport", async (t) => {
  const orchestration = await import(
    "../core/scripts/lib/wakeflow-delivery-orchestration.mjs"
  );
  const cases = [
    {
      name: "accepted-pending",
      transportStatus: "accepted",
      readback: {
        status: "pending",
        attempts: 1,
        evidence: [{ kind: "host-readback", digest: `sha256:${"d".repeat(64)}` }],
      },
      expectedDemandState: "waiting-results",
      expectedLifecycle: "waiting-result",
    },
    {
      name: "accepted-unavailable",
      transportStatus: "accepted",
      readback: { status: "unavailable", attempts: 0, evidence: [] },
      expectedDemandState: "waiting-results",
      expectedLifecycle: "waiting-result",
    },
    {
      name: "ambiguous-confirmed",
      transportStatus: "ambiguous",
      readback: {
        status: "confirmed",
        attempts: 1,
        evidence: [{ kind: "host-readback", digest: `sha256:${"e".repeat(64)}` }],
      },
      error: {
        code: "host-send-ambiguous",
        message: "The host effect cannot be classified as accepted or rejected.",
      },
      expectedDemandState: "dispatched",
      expectedLifecycle: "dispatched",
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async (caseTest) => {
      const {
        fixture,
        claimInput,
        claimed,
        leaseFile,
        lease,
      } = await createClaimedIntegrationDelivery(
        caseTest,
        orchestration,
        `Record ${scenario.name} without inferring target completion or resend authority.`,
      );
      const leaseBytes = readFileSync(leaseFile, "utf8");
      const outcomeInput = {
        ...claimInput,
        outcome: {
          hostMethod: "send-message",
          hostMode: "direct-thread",
          transportStatus: scenario.transportStatus,
          readback: scenario.readback,
          ...(scenario.error ? { error: scenario.error } : {}),
          createdAt: timestampAfter(claimed.state.updatedAt, lease.acquiredAt),
        },
      };
      const recorded = await orchestration.recordTargetDeliveryOutcome(outcomeInput);
      assert.equal(recorded.delivery.phase, scenario.transportStatus);
      assert.equal(recorded.leaseStatus, "retained");
      assert.equal(readFileSync(leaseFile, "utf8"), leaseBytes);

      const stack = loadIntegrationStack(fixture);
      const target = stack.state.targetTasks.find(
        (entry) => entry.targetTaskId === INTEGRATION_IDS.targetTask,
      );
      assert.equal(stack.state.state, scenario.expectedDemandState);
      assert.equal(target.lifecycleStatus, scenario.expectedLifecycle);
      assert.equal(target.currentDelivery.phase, scenario.transportStatus);

      const replayed = await orchestration.recordTargetDeliveryOutcome(outcomeInput);
      assert.equal(replayed.status, "replayed");
      assert.equal(replayed.leaseStatus, "retained");
      assert.equal(readFileSync(leaseFile, "utf8"), leaseBytes);
      await assert.rejects(
        orchestration.rearmTargetDelivery({
          workspaceRoot: fixture.workspaceRoot,
          stateRoot: fixture.stateRoot,
          expectedProgramId: INTEGRATION_IDS.program,
          targetTaskId: INTEGRATION_IDS.targetTask,
          deliveryId: claimInput.deliveryId,
          expectedRun: {
            runId: recorded.run.runId,
            ref: recorded.run.ref,
            digest: recorded.run.digest,
          },
        }),
        (error) => error?.code === "wakeflow-delivery-orchestration-state",
      );
    });
  }
});

test("M3-T07 competing pre-send claims produce exactly one send permit", async (t) => {
  const fixture = await createIntegrationFixture(t);
  const orchestration = await import(
    "../core/scripts/lib/wakeflow-delivery-orchestration.mjs"
  );
  const source = loadIntegrationStack(fixture);
  const plan = orchestration.planTargetDelivery({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targets: [{
      targetTaskId: INTEGRATION_IDS.targetTask,
      prompt: "Grant one and only one pre-send permit to competing callers.",
      contextPolicy: "assumed-current",
      automationRequested: false,
    }],
    returnPolicy: { mode: "group-ready" },
    createdAt: timestampAfter(source.state.updatedAt, new Date().toISOString()),
  });
  const applied = await orchestration.applyTargetDeliveryPlan({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    plan,
    planDigest: plan.planDigest,
  });
  const claimInput = {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targetTaskId: INTEGRATION_IDS.targetTask,
    deliveryId: applied.members[0].envelope.deliveryId,
    sendGeneration: 1,
  };

  const results = await Promise.allSettled([
    orchestration.claimTargetDelivery(claimInput),
    orchestration.claimTargetDelivery(claimInput),
  ]);
  const fulfilled = results.filter((entry) => entry.status === "fulfilled");
  const rejected = results.filter((entry) => entry.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(fulfilled[0].value.kind, "WakeflowTargetDeliverySendPermit");
  assert.equal(
    rejected[0].reason?.code,
    "wakeflow-delivery-orchestration-state",
  );

  const claimed = loadIntegrationStack(fixture);
  assert.equal(claimed.state.targetTasks[0].currentDelivery.phase, "send-claimed");
  assert.equal(
    claimed.events.filter((event) => event.command === "claim-target-delivery-send").length,
    1,
  );
  assert.equal(inspectWakeflowWorkspaceMutation({
    workspaceRoot: fixture.workspaceRoot,
  }).state, "idle");
});

test("M3-T07 stale apply rejects before transport or lease publication and releases its gate", async (t) => {
  const fixture = await createIntegrationFixture(t);
  const orchestration = await import(
    "../core/scripts/lib/wakeflow-delivery-orchestration.mjs"
  );
  const source = loadIntegrationStack(fixture);
  const plan = orchestration.planTargetDelivery({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targets: [{
      targetTaskId: INTEGRATION_IDS.targetTask,
      prompt: "Apply only the exact previewed target package.",
      contextPolicy: "assumed-current",
      automationRequested: false,
    }],
    returnPolicy: { mode: "group-ready" },
    createdAt: timestampAfter(source.state.updatedAt, new Date().toISOString()),
  });
  const beforeMutation = loadIntegrationStack(fixture);
  const advancedAt = timestampAfter(plan.createdAt);
  const event = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: "event-delivery-orchestration-context-0003",
    demandId: INTEGRATION_IDS.demand,
    createdAt: advancedAt,
    actor: "controller",
    command: "refresh-controller-context",
    type: "state.context-refreshed",
    previousRevision: beforeMutation.state.revision,
    nextRevision: beforeMutation.state.revision + 1,
    from: beforeMutation.state.state,
    to: beforeMutation.state.state,
    reason: "Advance an unrelated business-state revision after delivery preview.",
    decisionSummary: "Invalidate the old preview without changing target assignment.",
    changedArtifacts: [],
  };
  const advancedState = structuredClone(beforeMutation.state);
  advancedState.revision = event.nextRevision;
  advancedState.stateReason = event.reason;
  advancedState.updatedAt = event.createdAt;
  advancedState.lastEvent = {
    eventId: event.eventId,
    eventDigest: canonicalJsonDigest(event),
  };
  commitDemandStateTransition({
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    expectedPrevious: {
      revision: beforeMutation.state.revision,
      stateDigest: beforeMutation.digests.state,
    },
    event,
    nextState: advancedState,
  });
  const localBeforeApply = privateTreeSnapshot(path.join(
    fixture.workspaceRoot,
    ".wakeflow-local/runtime/shared",
  ));
  await assert.rejects(
    orchestration.applyTargetDeliveryPlan({
      workspaceRoot: fixture.workspaceRoot,
      stateRoot: fixture.stateRoot,
      expectedProgramId: INTEGRATION_IDS.program,
      plan,
      planDigest: plan.planDigest,
    }),
    (error) => error?.code === "wakeflow-delivery-orchestration-state",
  );
  assert.deepEqual(
    privateTreeSnapshot(path.join(fixture.workspaceRoot, ".wakeflow-local/runtime/shared")),
    localBeforeApply,
  );
  const freshPlan = orchestration.planTargetDelivery({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targets: [{
      targetTaskId: INTEGRATION_IDS.targetTask,
      prompt: "Apply only the exact previewed target package.",
      contextPolicy: "assumed-current",
      automationRequested: false,
    }],
    returnPolicy: { mode: "group-ready" },
    createdAt: timestampAfter(advancedAt),
  });
  assert.notEqual(freshPlan.planDigest, plan.planDigest);
});

test("M3-T07 apply preserves and resumes an exact immutable transport prefix", async (t) => {
  const fixture = await createIntegrationFixture(t);
  const orchestration = await import(
    "../core/scripts/lib/wakeflow-delivery-orchestration.mjs"
  );
  const source = loadIntegrationStack(fixture);
  const plan = orchestration.planTargetDelivery({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targets: [{
      targetTaskId: INTEGRATION_IDS.targetTask,
      prompt: "Resume only the exact group-first transport publication prefix.",
      contextPolicy: "assumed-current",
      automationRequested: false,
    }],
    returnPolicy: { mode: "group-ready" },
    createdAt: timestampAfter(source.state.updatedAt, new Date().toISOString()),
  });
  const demandTransportRoot = path.join(
    fixture.workspaceRoot,
    ".wakeflow-local/runtime/shared/transport/demands",
    INTEGRATION_IDS.demand,
  );
  const groupFile = path.join(
    demandTransportRoot,
    "groups",
    `${plan.group.groupId}.json`,
  );
  const packetFile = path.join(
    demandTransportRoot,
    "packets",
    `${plan.packets[0].packetId}.json`,
  );
  const envelopeFile = path.join(
    demandTransportRoot,
    "envelopes",
    `${plan.envelopes[0].deliveryId}.json`,
  );
  const originalLink = fs.linkSync;
  let injected = false;
  t.mock.method(fs, "linkSync", (sourceFile, targetFile) => {
    if (!injected && targetFile === packetFile) {
      injected = true;
      const error = new Error("injected packet publication rejection after group commit");
      error.code = "EIO";
      throw error;
    }
    return originalLink(sourceFile, targetFile);
  });
  const applyInput = {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    plan,
    planDigest: plan.planDigest,
  };

  await assert.rejects(
    orchestration.applyTargetDeliveryPlan(applyInput),
    (error) => error?.code === "wakeflow-delivery-orchestration-state",
  );
  assert.equal(injected, true);
  assert.equal(existsSync(groupFile), true);
  assert.equal(existsSync(packetFile), false);
  assert.equal(existsSync(envelopeFile), false);
  assert.deepEqual(loadIntegrationStack(fixture).state, source.state);
  assert.equal(inspectWakeflowWorkspaceMutation({
    workspaceRoot: fixture.workspaceRoot,
  }).state, "idle");
  const resumed = await orchestration.applyTargetDeliveryPlan(applyInput);
  assert.equal(resumed.status, "applied");
  assert.equal(existsSync(packetFile), true);
  assert.equal(existsSync(envelopeFile), true);
});

test("M3-T07 apply preserves and resumes an exact coordination-lease prefix", async (t) => {
  const fixture = await createIntegrationFixture(t, { secondProduct: true });
  const orchestration = await import(
    "../core/scripts/lib/wakeflow-delivery-orchestration.mjs"
  );
  const source = loadIntegrationStack(fixture);
  const plan = orchestration.planTargetDelivery({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targets: [{
      targetTaskId: INTEGRATION_IDS.targetTask,
      prompt: "Acquire the first exact member lease before the injected second-member rejection.",
      contextPolicy: "assumed-current",
      automationRequested: false,
    }, {
      targetTaskId: INTEGRATION_IDS.targetTaskTwo,
      prompt: "Resume this second exact member lease without replacing the first generation.",
      contextPolicy: "assumed-current",
      automationRequested: false,
    }],
    returnPolicy: { mode: "group-ready" },
    createdAt: timestampAfter(source.state.updatedAt, new Date().toISOString()),
  });
  const lastMember = plan.members.at(-1);
  const firstMember = plan.members[0];
  const leaseRoot = path.join(
    fixture.workspaceRoot,
    ".wakeflow-local/runtime/shared/coordination/window-leases",
  );
  const firstLeaseFile = path.join(leaseRoot, `${firstMember.windowId}.json`);
  const lastLeaseFile = path.join(leaseRoot, `${lastMember.windowId}.json`);
  const originalLink = fs.linkSync;
  let injected = false;
  t.mock.method(fs, "linkSync", (sourceFile, targetFile) => {
    if (!injected && targetFile === lastLeaseFile) {
      injected = true;
      const error = new Error("injected second-member lease publication rejection");
      error.code = "EIO";
      throw error;
    }
    return originalLink(sourceFile, targetFile);
  });
  const applyInput = {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    plan,
    planDigest: plan.planDigest,
  };

  await assert.rejects(
    orchestration.applyTargetDeliveryPlan(applyInput),
    (error) => error?.code === "wakeflow-delivery-orchestration-state",
  );
  assert.equal(injected, true);
  assert.equal(existsSync(firstLeaseFile), true);
  assert.equal(existsSync(lastLeaseFile), false);
  const firstLeaseBeforeResume = readFileSync(firstLeaseFile);
  assert.deepEqual(loadIntegrationStack(fixture).state, source.state);
  assert.equal(inspectWakeflowWorkspaceMutation({
    workspaceRoot: fixture.workspaceRoot,
  }).state, "idle");
  const resumed = await orchestration.applyTargetDeliveryPlan(applyInput);
  assert.equal(resumed.status, "applied");
  assert.deepEqual(readFileSync(firstLeaseFile), firstLeaseBeforeResume);
  assert.equal(existsSync(lastLeaseFile), true);
});

test("M3-T07 rejects an outcome at or before claim time with zero run and state writes", async (t) => {
  const fixture = await createIntegrationFixture(t);
  const orchestration = await import(
    "../core/scripts/lib/wakeflow-delivery-orchestration.mjs"
  );
  const source = loadIntegrationStack(fixture);
  const plan = orchestration.planTargetDelivery({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targets: [{
      targetTaskId: INTEGRATION_IDS.targetTask,
      prompt: "Claim once and reject chronologically invalid host facts.",
      contextPolicy: "force-refresh",
      automationRequested: false,
    }],
    returnPolicy: { mode: "group-ready" },
    createdAt: timestampAfter(source.state.updatedAt, new Date().toISOString()),
  });
  const applied = await orchestration.applyTargetDeliveryPlan({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    plan,
    planDigest: plan.planDigest,
  });
  const deliveryId = applied.members[0].envelope.deliveryId;
  const claimInput = {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targetTaskId: INTEGRATION_IDS.targetTask,
    deliveryId,
    sendGeneration: 1,
  };
  const permit = await orchestration.claimTargetDelivery(claimInput);
  const claimed = loadIntegrationStack(fixture);
  const treeBeforeOutcome = privateTreeSnapshot(fixture.workspaceRoot);
  const invalidOutcome = {
    hostMethod: "send-message",
    hostMode: "direct-thread",
    transportStatus: "rejected-before-send",
    readback: { status: "unavailable", attempts: 0, evidence: [] },
    error: { code: "host-send-rejected", message: "The host rejected the send." },
    createdAt: claimed.state.updatedAt,
  };
  await assert.rejects(
    orchestration.recordTargetDeliveryOutcome({ ...claimInput, outcome: invalidOutcome }),
    (error) => error?.code === "wakeflow-delivery-orchestration-state",
  );
  assert.deepEqual(privateTreeSnapshot(fixture.workspaceRoot), treeBeforeOutcome);
  const lease = JSON.parse(readFileSync(path.resolve(
    fixture.workspaceRoot,
    ...permit.lease.ref.split("/"),
  ), "utf8"));
  const valid = await orchestration.recordTargetDeliveryOutcome({
    ...claimInput,
    outcome: {
      ...invalidOutcome,
      createdAt: timestampAfter(claimed.state.updatedAt, lease.acquiredAt),
    },
  });
  assert.equal(valid.delivery.phase, "rejected-before-send");
});

test("M3-T07 recovers run-first outcome state and defers rejected lease release to replay", async (t) => {
  const fixture = await createIntegrationFixture(t);
  const orchestration = await import(
    "../core/scripts/lib/wakeflow-delivery-orchestration.mjs"
  );
  const source = loadIntegrationStack(fixture);
  const plan = orchestration.planTargetDelivery({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targets: [{
      targetTaskId: INTEGRATION_IDS.targetTask,
      prompt: "Persist the run before state and release the lease only after settlement.",
      contextPolicy: "assumed-current",
      automationRequested: false,
    }],
    returnPolicy: { mode: "group-ready" },
    createdAt: timestampAfter(source.state.updatedAt, new Date().toISOString()),
  });
  const applied = await orchestration.applyTargetDeliveryPlan({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    plan,
    planDigest: plan.planDigest,
  });
  const claimInput = {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targetTaskId: INTEGRATION_IDS.targetTask,
    deliveryId: applied.members[0].envelope.deliveryId,
    sendGeneration: 1,
  };
  const permit = await orchestration.claimTargetDelivery(claimInput);
  const claimed = loadIntegrationStack(fixture);
  const leaseFile = path.resolve(
    fixture.workspaceRoot,
    ...permit.lease.ref.split("/"),
  );
  const lease = JSON.parse(readFileSync(leaseFile, "utf8"));
  const outcomeInput = {
    ...claimInput,
    outcome: {
      hostMethod: "send-message",
      hostMode: "direct-thread",
      transportStatus: "rejected-before-send",
      readback: { status: "unavailable", attempts: 0, evidence: [] },
      error: {
        code: "host-send-rejected",
        message: "The host rejected this exact run before send.",
      },
      createdAt: timestampAfter(claimed.state.updatedAt, lease.acquiredAt),
    },
  };
  const journalFile = path.join(
    fixture.stateRoot,
    "transactions/state-transition.json",
  );
  const originalRename = fs.renameSync;
  let injected = false;
  t.mock.method(fs, "renameSync", (sourceFile, targetFile) => {
    const result = originalRename(sourceFile, targetFile);
    if (!injected && targetFile === journalFile) {
      injected = true;
      const error = new Error("injected post-commit outcome journal publication failure");
      error.code = "EIO";
      throw error;
    }
    return result;
  });

  await assert.rejects(
    orchestration.recordTargetDeliveryOutcome(outcomeInput),
    (error) => error?.code === "wakeflow-delivery-orchestration-state",
  );
  assert.equal(injected, true);
  assert.equal(existsSync(journalFile), false);
  const recovered = loadIntegrationStack(fixture);
  assert.equal(recovered.state.targetTasks[0].currentDelivery.phase, "rejected-before-send");
  assert.equal(existsSync(leaseFile), true, "release-last must not run after callback failure");
  const runRoot = path.join(
    fixture.workspaceRoot,
    ".wakeflow-local/runtime/shared/transport/demands",
    INTEGRATION_IDS.demand,
    "runs",
  );
  assert.equal(readdirSync(runRoot).filter((name) => name.endsWith(".json")).length, 1);
  assert.equal(inspectWakeflowWorkspaceMutation({
    workspaceRoot: fixture.workspaceRoot,
  }).state, "idle");

  const replayed = await orchestration.recordTargetDeliveryOutcome(outcomeInput);
  assert.equal(replayed.status, "replayed");
  assert.equal(replayed.leaseStatus, "released");
  assert.equal(existsSync(leaseFile), false);
  assert.equal(readdirSync(runRoot).filter((name) => name.endsWith(".json")).length, 1);
});

test("M3-T07 retains T02 when an outcome journal coexists with premature lease release", async (t) => {
  const orchestration = await import(
    "../core/scripts/lib/wakeflow-delivery-orchestration.mjs"
  );
  const {
    fixture,
    claimInput,
    claimed,
    leaseFile,
    lease,
  } = await createClaimedIntegrationDelivery(
    t,
    orchestration,
    "Never recover outcome state across a prematurely released exact lease.",
  );
  const outcomeInput = {
    ...claimInput,
    outcome: {
      hostMethod: "send-message",
      hostMode: "direct-thread",
      transportStatus: "rejected-before-send",
      readback: { status: "unavailable", attempts: 0, evidence: [] },
      error: {
        code: "host-send-rejected",
        message: "Reject this run before the host send boundary.",
      },
      createdAt: timestampAfter(claimed.state.updatedAt, lease.acquiredAt),
    },
  };
  const journalFile = path.join(
    fixture.stateRoot,
    "transactions/state-transition.json",
  );
  const originalRename = fs.renameSync;
  let injected = false;
  t.mock.method(fs, "renameSync", (sourceFile, targetFile) => {
    const result = originalRename(sourceFile, targetFile);
    if (!injected && targetFile === journalFile) {
      injected = true;
      fs.unlinkSync(leaseFile);
      const error = new Error("injected lease removal beside a pending outcome journal");
      error.code = "EIO";
      throw error;
    }
    return result;
  });

  await assert.rejects(
    orchestration.recordTargetDeliveryOutcome(outcomeInput),
    (error) => error?.code === "wakeflow-delivery-orchestration-recovery-required",
  );
  assert.equal(injected, true);
  assert.equal(existsSync(journalFile), true);
  assert.equal(existsSync(leaseFile), false);
  assert.equal(
    JSON.parse(readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json"), "utf8"))
      .targetTasks[0].currentDelivery.phase,
    "send-claimed",
  );
  const mutation = inspectWakeflowWorkspaceMutation({
    workspaceRoot: fixture.workspaceRoot,
  });
  assert.equal(mutation.state, "busy");
  assert.equal(mutation.lock?.operationKind, "target-delivery-outcome");
});

test("M3-T07 retains T02 when rejected outcome lease release precedes state without a journal", async (t) => {
  const orchestration = await import(
    "../core/scripts/lib/wakeflow-delivery-orchestration.mjs"
  );
  const {
    fixture,
    claimInput,
    claimed,
    leaseFile,
    lease,
  } = await createClaimedIntegrationDelivery(
    t,
    orchestration,
    "Reject an unjournaled release-before-state residue instead of calling it closed.",
  );
  const outcomeInput = {
    ...claimInput,
    outcome: {
      hostMethod: "send-message",
      hostMode: "direct-thread",
      transportStatus: "rejected-before-send",
      readback: { status: "unavailable", attempts: 0, evidence: [] },
      error: {
        code: "host-send-rejected",
        message: "Reject this run before the host send boundary.",
      },
      createdAt: timestampAfter(claimed.state.updatedAt, lease.acquiredAt),
    },
  };
  const journalFile = path.join(
    fixture.stateRoot,
    "transactions/state-transition.json",
  );
  const originalRename = fs.renameSync;
  let injected = false;
  t.mock.method(fs, "renameSync", (sourceFile, targetFile) => {
    if (!injected && targetFile === journalFile) {
      injected = true;
      fs.unlinkSync(leaseFile);
      const error = new Error("injected pre-journal outcome failure after premature lease removal");
      error.code = "EIO";
      throw error;
    }
    return originalRename(sourceFile, targetFile);
  });

  await assert.rejects(
    orchestration.recordTargetDeliveryOutcome(outcomeInput),
    (error) => error?.code === "wakeflow-delivery-orchestration-recovery-required",
  );
  assert.equal(injected, true);
  assert.equal(existsSync(journalFile), false);
  assert.equal(existsSync(leaseFile), false);
  assert.equal(loadIntegrationStack(fixture).state.targetTasks[0].currentDelivery.phase, "send-claimed");
  const mutation = inspectWakeflowWorkspaceMutation({
    workspaceRoot: fixture.workspaceRoot,
  });
  assert.equal(mutation.state, "busy");
  assert.equal(mutation.lock?.operationKind, "target-delivery-outcome");
});

test("M3-T07 safely closes an exact settled-replay lease release after unlink ambiguity", async (t) => {
  const orchestration = await import(
    "../core/scripts/lib/wakeflow-delivery-orchestration.mjs"
  );
  const {
    fixture,
    claimInput,
    claimed,
    leaseFile,
    lease,
  } = await createClaimedIntegrationDelivery(
    t,
    orchestration,
    "Replay only the exact settled rejected run while closing its retained lease.",
  );
  const outcomeInput = {
    ...claimInput,
    outcome: {
      hostMethod: "send-message",
      hostMode: "direct-thread",
      transportStatus: "rejected-before-send",
      readback: { status: "unavailable", attempts: 0, evidence: [] },
      error: {
        code: "host-send-rejected",
        message: "Retain the lease until exact outcome state recovery completes.",
      },
      createdAt: timestampAfter(claimed.state.updatedAt, lease.acquiredAt),
    },
  };
  const journalFile = path.join(
    fixture.stateRoot,
    "transactions/state-transition.json",
  );
  const originalRename = fs.renameSync;
  let stateFaultInjected = false;
  t.mock.method(fs, "renameSync", (sourceFile, targetFile) => {
    const result = originalRename(sourceFile, targetFile);
    if (!stateFaultInjected && targetFile === journalFile) {
      stateFaultInjected = true;
      const error = new Error("injected outcome journal publication ambiguity");
      error.code = "EIO";
      throw error;
    }
    return result;
  });
  await assert.rejects(
    orchestration.recordTargetDeliveryOutcome(outcomeInput),
    (error) => error?.code === "wakeflow-delivery-orchestration-state",
  );
  assert.equal(stateFaultInjected, true);
  assert.equal(loadIntegrationStack(fixture).state.targetTasks[0].currentDelivery.phase, "rejected-before-send");
  assert.equal(existsSync(leaseFile), true);
  assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot: fixture.workspaceRoot }).state, "idle");

  t.mock.restoreAll();
  const originalUnlink = fs.unlinkSync;
  let unlinkFaultInjected = false;
  t.mock.method(fs, "unlinkSync", (targetFile) => {
    const result = originalUnlink(targetFile);
    if (
      !unlinkFaultInjected
      && path.dirname(targetFile) === path.dirname(leaseFile)
      && path.basename(targetFile).includes(".wakeflow-removal-")
    ) {
      unlinkFaultInjected = true;
      const error = new Error("injected lease unlink success-evidence ambiguity");
      error.code = "EIO";
      throw error;
    }
    return result;
  });
  await assert.rejects(
    orchestration.recordTargetDeliveryOutcome(outcomeInput),
    (error) => error?.code === "wakeflow-delivery-orchestration-state",
  );
  assert.equal(unlinkFaultInjected, true);
  assert.equal(existsSync(leaseFile), false);
  assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot: fixture.workspaceRoot }).state, "idle");
  const replayed = await orchestration.recordTargetDeliveryOutcome(outcomeInput);
  assert.equal(replayed.status, "replayed");
  assert.equal(replayed.leaseStatus, "released");
});

test("M3-T07 recovers lease-first rearm state with one distinct generation", async (t) => {
  const fixture = await createIntegrationFixture(t);
  const orchestration = await import(
    "../core/scripts/lib/wakeflow-delivery-orchestration.mjs"
  );
  const source = loadIntegrationStack(fixture);
  const plan = orchestration.planTargetDelivery({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targets: [{
      targetTaskId: INTEGRATION_IDS.targetTask,
      prompt: "Acquire one distinct replacement lease before rearm state settlement.",
      contextPolicy: "assumed-current",
      automationRequested: false,
    }],
    returnPolicy: { mode: "group-ready" },
    createdAt: timestampAfter(source.state.updatedAt, new Date().toISOString()),
  });
  const applied = await orchestration.applyTargetDeliveryPlan({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    plan,
    planDigest: plan.planDigest,
  });
  const claimInput = {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targetTaskId: INTEGRATION_IDS.targetTask,
    deliveryId: applied.members[0].envelope.deliveryId,
    sendGeneration: 1,
  };
  const permit = await orchestration.claimTargetDelivery(claimInput);
  let stack = loadIntegrationStack(fixture);
  const firstLeaseFile = path.resolve(
    fixture.workspaceRoot,
    ...permit.lease.ref.split("/"),
  );
  const firstLease = JSON.parse(readFileSync(firstLeaseFile, "utf8"));
  const rejected = await orchestration.recordTargetDeliveryOutcome({
    ...claimInput,
    outcome: {
      hostMethod: "send-message",
      hostMode: "direct-thread",
      transportStatus: "rejected-before-send",
      readback: { status: "unavailable", attempts: 0, evidence: [] },
      error: { code: "host-send-rejected", message: "Reject before rearm." },
      createdAt: timestampAfter(stack.state.updatedAt, firstLease.acquiredAt),
    },
  });
  assert.equal(existsSync(firstLeaseFile), false);
  const rearmInput = {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targetTaskId: INTEGRATION_IDS.targetTask,
    deliveryId: applied.members[0].envelope.deliveryId,
    expectedRun: {
      runId: rejected.run.runId,
      ref: rejected.run.ref,
      digest: rejected.run.digest,
    },
  };
  const journalFile = path.join(
    fixture.stateRoot,
    "transactions/state-transition.json",
  );
  const originalRename = fs.renameSync;
  let injected = false;
  t.mock.method(fs, "renameSync", (sourceFile, targetFile) => {
    const result = originalRename(sourceFile, targetFile);
    if (!injected && targetFile === journalFile) {
      injected = true;
      const error = new Error("injected post-commit rearm journal publication failure");
      error.code = "EIO";
      throw error;
    }
    return result;
  });

  await assert.rejects(
    orchestration.rearmTargetDelivery(rearmInput),
    (error) => error?.code === "wakeflow-delivery-orchestration-state",
  );
  assert.equal(injected, true);
  assert.equal(existsSync(journalFile), false);
  stack = loadIntegrationStack(fixture);
  const delivery = stack.state.targetTasks[0].currentDelivery;
  assert.equal(delivery.phase, "prepared");
  assert.equal(delivery.sendGeneration, 2);
  assert.notEqual(delivery.lease.leaseId, permit.lease.leaseId);
  assert.notEqual(delivery.lease.digest, permit.lease.digest);
  const replacementLeaseFile = path.resolve(
    fixture.workspaceRoot,
    ...delivery.lease.ref.split("/"),
  );
  assert.equal(existsSync(replacementLeaseFile), true);
  assert.equal(inspectWakeflowWorkspaceMutation({
    workspaceRoot: fixture.workspaceRoot,
  }).state, "idle");
  const replayed = await orchestration.rearmTargetDelivery(rearmInput);
  assert.equal(replayed.status, "replayed");
  assert.deepEqual(replayed.newLease, delivery.lease);
});

test("M3-T07 resumes an exact replacement-lease prefix through rearm state recovery", async (t) => {
  const orchestration = await import(
    "../core/scripts/lib/wakeflow-delivery-orchestration.mjs"
  );
  const {
    fixture,
    claimInput,
    claimed,
    leaseFile,
    lease,
  } = await createClaimedIntegrationDelivery(
    t,
    orchestration,
    "Resume one already-created replacement lease without inventing another generation.",
  );
  const rejected = await orchestration.recordTargetDeliveryOutcome({
    ...claimInput,
    outcome: {
      hostMethod: "send-message",
      hostMode: "direct-thread",
      transportStatus: "rejected-before-send",
      readback: { status: "unavailable", attempts: 0, evidence: [] },
      error: { code: "host-send-rejected", message: "Reject before prefix recovery." },
      createdAt: timestampAfter(claimed.state.updatedAt, lease.acquiredAt),
    },
  });
  assert.equal(existsSync(leaseFile), false);
  const rearmInput = {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targetTaskId: INTEGRATION_IDS.targetTask,
    deliveryId: claimInput.deliveryId,
    expectedRun: {
      runId: rejected.run.runId,
      ref: rejected.run.ref,
      digest: rejected.run.digest,
    },
  };
  const journalFile = path.join(
    fixture.stateRoot,
    "transactions/state-transition.json",
  );
  const originalRename = fs.renameSync;
  let leasePrefixFaultInjected = false;
  t.mock.method(fs, "renameSync", (sourceFile, targetFile) => {
    if (!leasePrefixFaultInjected && targetFile === journalFile) {
      leasePrefixFaultInjected = true;
      const error = new Error("injected state failure after replacement lease creation");
      error.code = "EIO";
      throw error;
    }
    return originalRename(sourceFile, targetFile);
  });
  await assert.rejects(
    orchestration.rearmTargetDelivery(rearmInput),
    (error) => error?.code === "wakeflow-delivery-orchestration-state",
  );
  assert.equal(leasePrefixFaultInjected, true);
  assert.equal(existsSync(journalFile), false);
  assert.equal(existsSync(leaseFile), true);
  const replacementLeaseBytes = readFileSync(leaseFile);
  const replacementLease = JSON.parse(replacementLeaseBytes);
  assert.notEqual(replacementLease.leaseId, lease.leaseId);
  assert.equal(loadIntegrationStack(fixture).state.targetTasks[0].currentDelivery.phase, "rejected-before-send");
  assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot: fixture.workspaceRoot }).state, "idle");

  t.mock.restoreAll();
  let stateFaultInjected = false;
  t.mock.method(fs, "renameSync", (sourceFile, targetFile) => {
    const result = originalRename(sourceFile, targetFile);
    if (!stateFaultInjected && targetFile === journalFile) {
      stateFaultInjected = true;
      const error = new Error("injected resumed rearm journal publication ambiguity");
      error.code = "EIO";
      throw error;
    }
    return result;
  });
  await assert.rejects(
    orchestration.rearmTargetDelivery(rearmInput),
    (error) => error?.code === "wakeflow-delivery-orchestration-state",
  );
  assert.equal(stateFaultInjected, true);
  assert.equal(existsSync(journalFile), false);
  assert.deepEqual(readFileSync(leaseFile), replacementLeaseBytes);
  const recovered = loadIntegrationStack(fixture);
  assert.equal(recovered.state.targetTasks[0].currentDelivery.phase, "prepared");
  assert.equal(recovered.state.targetTasks[0].currentDelivery.sendGeneration, 2);
  assert.equal(
    recovered.state.targetTasks[0].currentDelivery.lease.leaseId,
    replacementLease.leaseId,
  );
  assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot: fixture.workspaceRoot }).state, "idle");
  const replayed = await orchestration.rearmTargetDelivery(rearmInput);
  assert.equal(replayed.status, "replayed");
});

test("M3-T07 forward-recovers an exact claim journal and never reopens the send interval", async (t) => {
  const fixture = await createIntegrationFixture(t);
  const orchestration = await import(
    "../core/scripts/lib/wakeflow-delivery-orchestration.mjs"
  );
  const source = loadIntegrationStack(fixture);
  const plan = orchestration.planTargetDelivery({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targets: [{
      targetTaskId: INTEGRATION_IDS.targetTask,
      prompt: "Claim this exact envelope once even if journal publication reports failure.",
      contextPolicy: "assumed-current",
      automationRequested: false,
    }],
    returnPolicy: { mode: "group-ready" },
    createdAt: timestampAfter(source.state.updatedAt, new Date().toISOString()),
  });
  const applied = await orchestration.applyTargetDeliveryPlan({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    plan,
    planDigest: plan.planDigest,
  });
  const deliveryId = applied.members[0].envelope.deliveryId;
  const claimInput = {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targetTaskId: INTEGRATION_IDS.targetTask,
    deliveryId,
    sendGeneration: 1,
  };
  const journalFile = path.join(
    fixture.stateRoot,
    "transactions/state-transition.json",
  );
  const originalRename = fs.renameSync;
  let injected = false;
  t.mock.method(fs, "renameSync", (sourceFile, targetFile) => {
    const result = originalRename(sourceFile, targetFile);
    if (!injected && targetFile === journalFile) {
      injected = true;
      const error = new Error("injected post-commit claim journal publication failure");
      error.code = "EIO";
      throw error;
    }
    return result;
  });

  await assert.rejects(
    orchestration.claimTargetDelivery(claimInput),
    /claim|callback|state|journal/iu,
  );
  assert.equal(injected, true);
  assert.equal(existsSync(journalFile), false);
  const recovered = loadIntegrationStack(fixture);
  assert.equal(recovered.state.targetTasks[0].currentDelivery.phase, "send-claimed");
  assert.equal(recovered.events.at(-1).command, "claim-target-delivery-send");
  assert.equal(
    recovered.state.targetTasks[0].currentDelivery.claimedBy.eventDigest,
    canonicalJsonDigest(recovered.events.at(-1)),
  );
  assert.equal(inspectWakeflowWorkspaceMutation({
    workspaceRoot: fixture.workspaceRoot,
  }).state, "idle");
  await assert.rejects(
    orchestration.claimTargetDelivery(claimInput),
    (error) => error?.code === "wakeflow-delivery-orchestration-state",
  );
});

test("M3-T07 rehydrates an exact pre-existing claim journal after lease time expiry", async (t) => {
  const fixture = await createIntegrationFixture(t);
  const orchestration = await import(
    "../core/scripts/lib/wakeflow-delivery-orchestration.mjs"
  );
  const source = loadIntegrationStack(fixture);
  const plan = orchestration.planTargetDelivery({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targets: [{
      targetTaskId: INTEGRATION_IDS.targetTask,
      prompt: "Recover only the exact previously journaled claim generation.",
      contextPolicy: "assumed-current",
      automationRequested: false,
    }],
    returnPolicy: { mode: "group-ready" },
    createdAt: timestampAfter(source.state.updatedAt, new Date().toISOString()),
  });
  const applied = await orchestration.applyTargetDeliveryPlan({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    plan,
    planDigest: plan.planDigest,
  });
  const prepared = loadIntegrationStack(fixture);
  const journal = exactClaimJournal(fixture, prepared, INTEGRATION_IDS.targetTask);
  const journalFile = path.join(
    fixture.stateRoot,
    "transactions/state-transition.json",
  );
  writePrivateCanonical(journalFile, journal);
  const preparedDelivery = prepared.state.targetTasks.find(
    (entry) => entry.targetTaskId === INTEGRATION_IDS.targetTask,
  ).currentDelivery;
  const lease = JSON.parse(readFileSync(path.resolve(
    fixture.workspaceRoot,
    ...preparedDelivery.lease.ref.split("/"),
  ), "utf8"));
  t.mock.method(Date, "now", () => Date.parse(lease.expiresAt) + 1);
  const claimInput = {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targetTaskId: INTEGRATION_IDS.targetTask,
    deliveryId: applied.members[0].envelope.deliveryId,
    sendGeneration: 1,
  };

  await assert.rejects(
    orchestration.claimTargetDelivery(claimInput),
    (error) => error?.code === "wakeflow-delivery-orchestration-state",
  );
  assert.equal(existsSync(journalFile), false);
  const recovered = loadIntegrationStack(fixture);
  assert.equal(recovered.state.targetTasks[0].currentDelivery.phase, "send-claimed");
  assert.equal(recovered.events.length, prepared.events.length + 1);
  assert.deepEqual(recovered.events.at(-1), journal.nextEvent);
  assert.equal(inspectWakeflowWorkspaceMutation({
    workspaceRoot: fixture.workspaceRoot,
  }).state, "idle");
  await assert.rejects(
    orchestration.claimTargetDelivery(claimInput),
    (error) => error?.code === "wakeflow-delivery-orchestration-state",
  );
});

test("M3-T07 removes an exact claim journal after its event and state are already committed", async (t) => {
  const fixture = await createIntegrationFixture(t);
  const orchestration = await import(
    "../core/scripts/lib/wakeflow-delivery-orchestration.mjs"
  );
  const source = loadIntegrationStack(fixture);
  const plan = orchestration.planTargetDelivery({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targets: [{
      targetTaskId: INTEGRATION_IDS.targetTask,
      prompt: "Clean up only the exact journal after claim event and state are visible.",
      contextPolicy: "assumed-current",
      automationRequested: false,
    }],
    returnPolicy: { mode: "group-ready" },
    createdAt: timestampAfter(source.state.updatedAt, new Date().toISOString()),
  });
  const applied = await orchestration.applyTargetDeliveryPlan({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    plan,
    planDigest: plan.planDigest,
  });
  const prepared = loadIntegrationStack(fixture);
  const journal = exactClaimJournal(fixture, prepared, INTEGRATION_IDS.targetTask);
  const journalFile = installCleanupOnlyTransitionJournal(fixture, prepared, journal);
  const stateBytes = readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json"), "utf8");
  const eventBytes = readFileSync(path.join(fixture.stateRoot, "controller-events.jsonl"), "utf8");
  const claimInput = {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targetTaskId: INTEGRATION_IDS.targetTask,
    deliveryId: applied.members[0].envelope.deliveryId,
    sendGeneration: 1,
  };

  await assert.rejects(
    orchestration.claimTargetDelivery(claimInput),
    (error) => error?.code === "wakeflow-delivery-orchestration-state",
  );
  assert.equal(existsSync(journalFile), false);
  assert.equal(readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json"), "utf8"), stateBytes);
  assert.equal(readFileSync(path.join(fixture.stateRoot, "controller-events.jsonl"), "utf8"), eventBytes);
  const recovered = loadIntegrationStack(fixture);
  assert.deepEqual(recovered.state, journal.nextState);
  assert.deepEqual(recovered.events.at(-1), journal.nextEvent);
  assert.equal(inspectWakeflowWorkspaceMutation({
    workspaceRoot: fixture.workspaceRoot,
  }).state, "idle");
});

test("M3-T07 retains T02 and the journal when pre-existing claim input differs", async (t) => {
  const fixture = await createIntegrationFixture(t);
  const orchestration = await import(
    "../core/scripts/lib/wakeflow-delivery-orchestration.mjs"
  );
  const source = loadIntegrationStack(fixture);
  const plan = orchestration.planTargetDelivery({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targets: [{
      targetTaskId: INTEGRATION_IDS.targetTask,
      prompt: "Never reinterpret a journal as another send generation.",
      contextPolicy: "assumed-current",
      automationRequested: false,
    }],
    returnPolicy: { mode: "group-ready" },
    createdAt: timestampAfter(source.state.updatedAt, new Date().toISOString()),
  });
  const applied = await orchestration.applyTargetDeliveryPlan({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    plan,
    planDigest: plan.planDigest,
  });
  const prepared = loadIntegrationStack(fixture);
  const journal = exactClaimJournal(fixture, prepared, INTEGRATION_IDS.targetTask);
  const journalFile = path.join(
    fixture.stateRoot,
    "transactions/state-transition.json",
  );
  writePrivateCanonical(journalFile, journal);

  await assert.rejects(
    orchestration.claimTargetDelivery({
      workspaceRoot: fixture.workspaceRoot,
      stateRoot: fixture.stateRoot,
      expectedProgramId: INTEGRATION_IDS.program,
      targetTaskId: INTEGRATION_IDS.targetTask,
      deliveryId: applied.members[0].envelope.deliveryId,
      sendGeneration: 2,
    }),
    (error) => error?.code === "wakeflow-delivery-orchestration-recovery-required",
  );
  assert.equal(existsSync(journalFile), true);
  assert.deepEqual(JSON.parse(readFileSync(journalFile, "utf8")), journal);
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json"), "utf8")),
    prepared.state,
  );
  const mutation = inspectWakeflowWorkspaceMutation({
    workspaceRoot: fixture.workspaceRoot,
  });
  assert.equal(mutation.state, "busy");
  assert.equal(mutation.lock?.operationKind, "target-delivery-claim");
});

test("M3-T07 rehydrates an exact pre-existing apply journal from its plan member prefix", async (t) => {
  const fixture = await createIntegrationFixture(t);
  const orchestration = await import(
    "../core/scripts/lib/wakeflow-delivery-orchestration.mjs"
  );
  const source = loadIntegrationStack(fixture);
  const plan = orchestration.planTargetDelivery({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targets: [{
      targetTaskId: INTEGRATION_IDS.targetTask,
      prompt: "Recover this exact prepared member from its immutable local plan prefix.",
      contextPolicy: "assumed-current",
      automationRequested: false,
    }],
    returnPolicy: { mode: "group-ready" },
    createdAt: timestampAfter(source.state.updatedAt, new Date().toISOString()),
  });
  const applyInput = {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    plan,
    planDigest: plan.planDigest,
  };
  await orchestration.applyTargetDeliveryPlan(applyInput);
  const committed = loadIntegrationStack(fixture);
  const journal = exactJournalFromCommittedTransition(fixture, source, committed);
  const journalFile = installPreexistingTransitionJournal(fixture, source, journal);
  const preparedDelivery = committed.state.targetTasks.find(
    (entry) => entry.targetTaskId === INTEGRATION_IDS.targetTask,
  ).currentDelivery;
  const lease = JSON.parse(readFileSync(path.resolve(
    fixture.workspaceRoot,
    ...preparedDelivery.lease.ref.split("/"),
  ), "utf8"));
  t.mock.method(Date, "now", () => Date.parse(lease.expiresAt) + 1);

  await assert.rejects(
    orchestration.applyTargetDeliveryPlan(applyInput),
    (error) => error?.code === "wakeflow-delivery-orchestration-state",
  );
  assert.equal(existsSync(journalFile), false);
  const recovered = loadIntegrationStack(fixture);
  assert.deepEqual(recovered.state, committed.state);
  assert.deepEqual(recovered.events.at(-1), journal.nextEvent);
  assert.equal(inspectWakeflowWorkspaceMutation({
    workspaceRoot: fixture.workspaceRoot,
  }).state, "idle");

  t.mock.restoreAll();
  const replayed = await orchestration.applyTargetDeliveryPlan(applyInput);
  assert.equal(replayed.status, "replayed");
});

test("M3-T07 rehydrates an exact pre-existing outcome journal from its immutable run", async (t) => {
  const orchestration = await import(
    "../core/scripts/lib/wakeflow-delivery-orchestration.mjs"
  );
  const {
    fixture,
    claimInput,
    claimed,
    lease,
  } = await createClaimedIntegrationDelivery(
    t,
    orchestration,
    "Recover only the exact run already committed for this claimed generation.",
  );
  const outcomeInput = {
    ...claimInput,
    outcome: {
      hostMethod: "send-message",
      hostMode: "direct-thread",
      transportStatus: "accepted",
      readback: {
        status: "confirmed",
        attempts: 1,
        evidence: [{ kind: "host-message", digest: `sha256:${"a".repeat(64)}` }],
      },
      createdAt: timestampAfter(claimed.state.updatedAt, lease.acquiredAt),
    },
  };
  await orchestration.recordTargetDeliveryOutcome(outcomeInput);
  const committed = loadIntegrationStack(fixture);
  const journal = exactJournalFromCommittedTransition(fixture, claimed, committed);
  const journalFile = installPreexistingTransitionJournal(fixture, claimed, journal);

  await assert.rejects(
    orchestration.recordTargetDeliveryOutcome(outcomeInput),
    (error) => error?.code === "wakeflow-delivery-orchestration-state",
  );
  assert.equal(existsSync(journalFile), false);
  const recovered = loadIntegrationStack(fixture);
  assert.deepEqual(recovered.state, committed.state);
  assert.deepEqual(recovered.events.at(-1), journal.nextEvent);
  assert.equal(recovered.state.targetTasks[0].currentDelivery.phase, "accepted");
  assert.equal(inspectWakeflowWorkspaceMutation({
    workspaceRoot: fixture.workspaceRoot,
  }).state, "idle");

  const replayed = await orchestration.recordTargetDeliveryOutcome(outcomeInput);
  assert.equal(replayed.status, "replayed");
  assert.equal(replayed.leaseStatus, "retained");
});

test("M3-T07 rehydrates an exact pre-existing rearm journal from its replacement lease", async (t) => {
  const orchestration = await import(
    "../core/scripts/lib/wakeflow-delivery-orchestration.mjs"
  );
  const {
    fixture,
    claimInput,
    claimed,
    leaseFile,
    lease,
  } = await createClaimedIntegrationDelivery(
    t,
    orchestration,
    "Recover only the distinct replacement lease already acquired for rearm.",
  );
  const rejected = await orchestration.recordTargetDeliveryOutcome({
    ...claimInput,
    outcome: {
      hostMethod: "send-message",
      hostMode: "direct-thread",
      transportStatus: "rejected-before-send",
      readback: { status: "unavailable", attempts: 0, evidence: [] },
      error: {
        code: "host-send-rejected",
        message: "Reject before the host effect so the exact envelope may be rearmed.",
      },
      createdAt: timestampAfter(claimed.state.updatedAt, lease.acquiredAt),
    },
  });
  assert.equal(existsSync(leaseFile), false);
  const rejectedStack = loadIntegrationStack(fixture);
  const rearmInput = {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targetTaskId: INTEGRATION_IDS.targetTask,
    deliveryId: claimInput.deliveryId,
    expectedRun: {
      runId: rejected.run.runId,
      ref: rejected.run.ref,
      digest: rejected.run.digest,
    },
  };
  await orchestration.rearmTargetDelivery(rearmInput);
  const committed = loadIntegrationStack(fixture);
  const journal = exactJournalFromCommittedTransition(fixture, rejectedStack, committed);
  const journalFile = installPreexistingTransitionJournal(fixture, rejectedStack, journal);
  const replacementLease = JSON.parse(readFileSync(leaseFile, "utf8"));
  assert.notEqual(replacementLease.leaseId, lease.leaseId);
  t.mock.method(Date, "now", () => Date.parse(replacementLease.expiresAt) + 1);

  await assert.rejects(
    orchestration.rearmTargetDelivery(rearmInput),
    (error) => error?.code === "wakeflow-delivery-orchestration-state",
  );
  assert.equal(existsSync(journalFile), false);
  const recovered = loadIntegrationStack(fixture);
  assert.deepEqual(recovered.state, committed.state);
  assert.deepEqual(recovered.events.at(-1), journal.nextEvent);
  assert.equal(recovered.state.targetTasks[0].currentDelivery.phase, "prepared");
  assert.equal(recovered.state.targetTasks[0].currentDelivery.sendGeneration, 2);
  assert.equal(
    recovered.state.targetTasks[0].currentDelivery.lease.leaseId,
    replacementLease.leaseId,
  );
  assert.equal(inspectWakeflowWorkspaceMutation({
    workspaceRoot: fixture.workspaceRoot,
  }).state, "idle");

  t.mock.restoreAll();
  const replayed = await orchestration.rearmTargetDelivery(rearmInput);
  assert.equal(replayed.status, "replayed");
});

test("M3-T07 derives Test attempts from TestCard policy and exact previous result authority", async (t) => {
  const fixture = await createIntegrationFixture(t, { testTarget: true });
  const orchestration = await import(
    "../core/scripts/lib/wakeflow-delivery-orchestration.mjs"
  );
  const initialStack = loadIntegrationStack(fixture);
  const basePlanInput = {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targets: [{
      targetTaskId: INTEGRATION_IDS.testTargetTask,
      prompt: "Execute the exact disposable TestCard and return one strict Test result.",
      contextPolicy: "force-refresh",
      automationRequested: false,
    }],
    returnPolicy: { mode: "per-target" },
    createdAt: timestampAfter(initialStack.state.updatedAt, new Date().toISOString()),
  };
  const firstPlan = orchestration.planTargetDelivery(basePlanInput);
  assert.deepEqual(firstPlan.members[0].testIntent, {
    kind: "new-attempt",
    testAttemptId: firstPlan.members[0].testIntent.testAttemptId,
    ordinal: 1,
    mode: "initial",
  });

  const forgedPlan = structuredClone(firstPlan);
  forgedPlan.members[0].testIntent.testAttemptId =
    "test-attempt_33333333-3333-4333-8333-333333333333";
  const forgedUnsigned = structuredClone(forgedPlan);
  delete forgedUnsigned.planDigest;
  forgedPlan.planDigest = canonicalJsonDigest(forgedUnsigned);
  const beforeForgedApply = privateTreeSnapshot(fixture.workspaceRoot);
  await assert.rejects(
    orchestration.applyTargetDeliveryPlan({
      workspaceRoot: fixture.workspaceRoot,
      stateRoot: fixture.stateRoot,
      expectedProgramId: INTEGRATION_IDS.program,
      plan: forgedPlan,
      planDigest: forgedPlan.planDigest,
    }),
    (error) => error?.code === "wakeflow-delivery-orchestration-state",
  );
  assert.deepEqual(privateTreeSnapshot(fixture.workspaceRoot), beforeForgedApply);

  const firstApplied = await orchestration.applyTargetDeliveryPlan({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    plan: firstPlan,
    planDigest: firstPlan.planDigest,
  });
  let stack = loadIntegrationStack(fixture);
  let testTask = stack.state.targetTasks.find(
    (entry) => entry.targetTaskId === INTEGRATION_IDS.testTargetTask,
  );
  assert.equal(testTask.testAttempts.length, 1);
  assert.equal(testTask.testAttempts[0].ordinal, 1);
  assert.equal(testTask.testAttempts[0].mode, "initial");
  assert.equal(testTask.testAttempts[0].deliveryAuthorizations.length, 1);
  assert.equal(
    testTask.currentDelivery.testAttemptId,
    testTask.testAttempts[0].testAttemptId,
  );

  const firstDeliveryId = firstApplied.members[0].envelope.deliveryId;
  const firstClaim = {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targetTaskId: INTEGRATION_IDS.testTargetTask,
    deliveryId: firstDeliveryId,
    sendGeneration: 1,
  };
  const firstPermit = await orchestration.claimTargetDelivery(firstClaim);
  stack = loadIntegrationStack(fixture);
  const firstLease = JSON.parse(readFileSync(path.resolve(
    fixture.workspaceRoot,
    ...firstPermit.lease.ref.split("/"),
  ), "utf8"));
  await orchestration.recordTargetDeliveryOutcome({
    ...firstClaim,
    outcome: {
      hostMethod: "send-message",
      hostMode: "direct-thread",
      transportStatus: "accepted",
      readback: {
        status: "confirmed",
        attempts: 1,
        evidence: [{
          kind: "thread-turn-visible",
          digest: `sha256:${"a".repeat(64)}`,
        }],
      },
      createdAt: timestampAfter(stack.state.updatedAt, firstLease.acquiredAt),
    },
  });
  const firstResult = recordTestTargetResult(
    fixture,
    INTEGRATION_IDS.testResult,
  );
  stack = await moveTestTargetToRework(fixture);
  const beforeMissingRestart = privateTreeSnapshot(fixture.workspaceRoot);
  assert.throws(
    () => orchestration.planTargetDelivery({
      ...basePlanInput,
      createdAt: timestampAfter(stack.state.updatedAt),
    }),
    (error) => error?.code === "wakeflow-delivery-orchestration-test-attempt",
  );
  assert.deepEqual(privateTreeSnapshot(fixture.workspaceRoot), beforeMissingRestart);

  const secondPlan = orchestration.planTargetDelivery({
    ...basePlanInput,
    targets: [{
      ...basePlanInput.targets[0],
      restart: {
        conditionIndex: 0,
        reason: "The first disposable Test environment was proven contaminated.",
      },
    }],
    createdAt: timestampAfter(stack.state.updatedAt),
  });
  assert.equal(secondPlan.members[0].testIntent.ordinal, 2);
  assert.equal(secondPlan.members[0].testIntent.mode, "restart");
  assert.equal(
    secondPlan.members[0].testIntent.restart.condition,
    fixture.cardRecord.executionContract.restartConditions[0],
  );
  const secondApplied = await orchestration.applyTargetDeliveryPlan({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    plan: secondPlan,
    planDigest: secondPlan.planDigest,
  });
  stack = loadIntegrationStack(fixture);
  testTask = stack.state.targetTasks.find(
    (entry) => entry.targetTaskId === INTEGRATION_IDS.testTargetTask,
  );
  assert.equal(testTask.testAttempts.length, 2);
  assert.equal(testTask.testAttempts[1].ordinal, 2);
  assert.equal(testTask.testAttempts[1].mode, "restart");
  assert.equal(
    testTask.testAttempts[1].previousAttemptId,
    testTask.testAttempts[0].testAttemptId,
  );
  assert.deepEqual(testTask.testAttempts[1].previousResult, {
    targetResultId: INTEGRATION_IDS.testResult,
    ref: firstResult.commit.artifact.ref,
    digest: firstResult.commit.artifact.digest,
  });
  assert.notEqual(
    testTask.testAttempts[1].deliveryAuthorizations[0].group.groupId,
    testTask.testAttempts[0].deliveryAuthorizations[0].group.groupId,
  );

  const secondClaim = {
    ...firstClaim,
    deliveryId: secondApplied.members[0].envelope.deliveryId,
  };
  const secondPermit = await orchestration.claimTargetDelivery(secondClaim);
  stack = loadIntegrationStack(fixture);
  const secondLease = JSON.parse(readFileSync(path.resolve(
    fixture.workspaceRoot,
    ...secondPermit.lease.ref.split("/"),
  ), "utf8"));
  await orchestration.recordTargetDeliveryOutcome({
    ...secondClaim,
    outcome: {
      hostMethod: "send-message",
      hostMode: "direct-thread",
      transportStatus: "accepted",
      readback: {
        status: "pending",
        attempts: 1,
        evidence: [{
          kind: "thread-turn-visible",
          digest: `sha256:${"b".repeat(64)}`,
        }],
      },
      createdAt: timestampAfter(stack.state.updatedAt, secondLease.acquiredAt),
    },
  });
  const secondResult = recordTestTargetResult(
    fixture,
    INTEGRATION_IDS.testResultTwo,
  );
  assert.equal(secondResult.commit.created, true);
  assert.equal(secondResult.result.supersedes, undefined);
  assert.equal(
    loadIntegrationStack(fixture).state.targetResults.find(
      (entry) => entry.targetResultId === INTEGRATION_IDS.testResult,
    ).lifecycleStatus,
    "historical",
  );
  stack = await moveTestTargetToRework(fixture);
  const beforeExhaustedPlan = privateTreeSnapshot(fixture.workspaceRoot);
  assert.throws(
    () => orchestration.planTargetDelivery({
      ...basePlanInput,
      targets: [{
        ...basePlanInput.targets[0],
        restart: {
          conditionIndex: 0,
          reason: "A third attempt must be rejected by the immutable limit.",
        },
      }],
      createdAt: timestampAfter(stack.state.updatedAt),
    }),
    (error) => error?.code === "wakeflow-delivery-orchestration-test-attempt",
  );
  assert.deepEqual(privateTreeSnapshot(fixture.workspaceRoot), beforeExhaustedPlan);
});

test("M3-T07 Test rearm and rejected-envelope replacement preserve one logical attempt", async (t) => {
  const fixture = await createIntegrationFixture(t, { testTarget: true });
  const orchestration = await import(
    "../core/scripts/lib/wakeflow-delivery-orchestration.mjs"
  );
  const source = loadIntegrationStack(fixture);
  const prompt = "Keep one logical Test attempt across proved pre-send rejections.";
  const plan = orchestration.planTargetDelivery({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targets: [{
      targetTaskId: INTEGRATION_IDS.testTargetTask,
      prompt,
      contextPolicy: "assumed-current",
      automationRequested: false,
    }],
    returnPolicy: { mode: "per-target" },
    createdAt: timestampAfter(source.state.updatedAt, new Date().toISOString()),
  });
  const applied = await orchestration.applyTargetDeliveryPlan({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    plan,
    planDigest: plan.planDigest,
  });
  const deliveryId = applied.members[0].envelope.deliveryId;
  const claimInput = {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targetTaskId: INTEGRATION_IDS.testTargetTask,
    deliveryId,
    sendGeneration: 1,
  };
  const firstPermit = await orchestration.claimTargetDelivery(claimInput);
  let stack = loadIntegrationStack(fixture);
  let lease = JSON.parse(readFileSync(path.resolve(
    fixture.workspaceRoot,
    ...firstPermit.lease.ref.split("/"),
  ), "utf8"));
  const firstRejected = await orchestration.recordTargetDeliveryOutcome({
    ...claimInput,
    outcome: {
      hostMethod: "send-message",
      hostMode: "direct-thread",
      transportStatus: "rejected-before-send",
      readback: { status: "unavailable", attempts: 0, evidence: [] },
      error: { code: "host-send-rejected", message: "Reject generation one before send." },
      createdAt: timestampAfter(stack.state.updatedAt, lease.acquiredAt),
    },
  });
  stack = loadIntegrationStack(fixture);
  const attemptsBeforeRearm = structuredClone(
    stack.state.targetTasks.find(
      (entry) => entry.targetTaskId === INTEGRATION_IDS.testTargetTask,
    ).testAttempts,
  );
  const rearmed = await orchestration.rearmTargetDelivery({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targetTaskId: INTEGRATION_IDS.testTargetTask,
    deliveryId,
    expectedRun: {
      runId: firstRejected.run.runId,
      ref: firstRejected.run.ref,
      digest: firstRejected.run.digest,
    },
  });
  stack = loadIntegrationStack(fixture);
  let task = stack.state.targetTasks.find(
    (entry) => entry.targetTaskId === INTEGRATION_IDS.testTargetTask,
  );
  assert.equal(rearmed.sendGeneration, 2);
  assert.deepEqual(task.testAttempts, attemptsBeforeRearm);
  assert.equal(task.currentDelivery.testAttemptId, attemptsBeforeRearm[0].testAttemptId);

  const secondClaim = { ...claimInput, sendGeneration: 2 };
  const secondPermit = await orchestration.claimTargetDelivery(secondClaim);
  stack = loadIntegrationStack(fixture);
  lease = JSON.parse(readFileSync(path.resolve(
    fixture.workspaceRoot,
    ...secondPermit.lease.ref.split("/"),
  ), "utf8"));
  const secondRejected = await orchestration.recordTargetDeliveryOutcome({
    ...secondClaim,
    outcome: {
      hostMethod: "send-message",
      hostMode: "direct-thread",
      transportStatus: "rejected-before-send",
      readback: { status: "unavailable", attempts: 0, evidence: [] },
      error: { code: "host-send-rejected", message: "Reject generation two before send." },
      createdAt: timestampAfter(stack.state.updatedAt, lease.acquiredAt),
    },
  });
  stack = loadIntegrationStack(fixture);
  const replacementPlan = orchestration.planTargetDelivery({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targets: [{
      targetTaskId: INTEGRATION_IDS.testTargetTask,
      prompt,
      contextPolicy: "assumed-current",
      automationRequested: true,
    }],
    returnPolicy: { mode: "per-target" },
    createdAt: timestampAfter(stack.state.updatedAt),
  });
  assert.equal(replacementPlan.members[0].testIntent.kind, "replacement-authorization");
  assert.equal(
    replacementPlan.members[0].testIntent.testAttemptId,
    attemptsBeforeRearm[0].testAttemptId,
  );
  assert.equal(replacementPlan.group.groupId, applied.group.groupId);
  assert.equal(replacementPlan.packets[0].packetId, applied.members[0].packet.packetId);
  assert.notEqual(replacementPlan.envelopes[0].deliveryId, deliveryId);
  await orchestration.applyTargetDeliveryPlan({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    plan: replacementPlan,
    planDigest: replacementPlan.planDigest,
  });
  stack = loadIntegrationStack(fixture);
  task = stack.state.targetTasks.find(
    (entry) => entry.targetTaskId === INTEGRATION_IDS.testTargetTask,
  );
  assert.equal(task.testAttempts.length, 1);
  assert.equal(task.testAttempts[0].deliveryAuthorizations.length, 2);
  assert.equal(task.testAttempts[0].deliveryAuthorizations[1].ordinal, 2);
  assert.deepEqual(
    task.testAttempts[0].deliveryAuthorizations[1].replacesRun,
    secondRejected.run,
  );
  assert.equal(task.currentDelivery.sendGeneration, 1);
  assert.equal(task.currentDelivery.testAttemptId, attemptsBeforeRearm[0].testAttemptId);
});

test("M3-T07 multi-target rejected replacement preserves the original group for unsent siblings", async (t) => {
  const fixture = await createIntegrationFixture(t, { secondProduct: true });
  const orchestration = await import(
    "../core/scripts/lib/wakeflow-delivery-orchestration.mjs"
  );
  const source = loadIntegrationStack(fixture);
  const prompts = new Map([
    [INTEGRATION_IDS.targetTask, "Execute the first exact group member."],
    [INTEGRATION_IDS.targetTaskTwo, "Execute the second exact group member."],
  ]);
  const plan = orchestration.planTargetDelivery({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targets: [...prompts].map(([targetTaskId, prompt]) => ({
      targetTaskId,
      prompt,
      contextPolicy: "assumed-current",
      automationRequested: false,
    })),
    returnPolicy: { mode: "group-ready" },
    createdAt: timestampAfter(source.state.updatedAt, new Date().toISOString()),
  });
  const applied = await orchestration.applyTargetDeliveryPlan({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    plan,
    planDigest: plan.planDigest,
  });
  const first = applied.members.find(
    (member) => member.targetTaskId === INTEGRATION_IDS.targetTask,
  );
  const second = applied.members.find(
    (member) => member.targetTaskId === INTEGRATION_IDS.targetTaskTwo,
  );
  const secondClaim = {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targetTaskId: INTEGRATION_IDS.targetTaskTwo,
    deliveryId: second.envelope.deliveryId,
    sendGeneration: 1,
  };
  const secondPermit = await orchestration.claimTargetDelivery(secondClaim);
  const claimed = loadIntegrationStack(fixture);
  const lease = JSON.parse(readFileSync(path.resolve(
    fixture.workspaceRoot,
    ...secondPermit.lease.ref.split("/"),
  ), "utf8"));
  await orchestration.recordTargetDeliveryOutcome({
    ...secondClaim,
    outcome: {
      hostMethod: "send-message",
      hostMode: "direct-thread",
      transportStatus: "rejected-before-send",
      readback: { status: "unavailable", attempts: 0, evidence: [] },
      error: { code: "host-send-rejected", message: "Reject only the second member." },
      createdAt: timestampAfter(claimed.state.updatedAt, lease.acquiredAt),
    },
  });

  const rejected = loadIntegrationStack(fixture);
  const replacementPlan = orchestration.planTargetDelivery({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targets: [{
      targetTaskId: INTEGRATION_IDS.targetTaskTwo,
      prompt: prompts.get(INTEGRATION_IDS.targetTaskTwo),
      contextPolicy: "assumed-current",
      automationRequested: true,
    }],
    returnPolicy: { mode: "group-ready" },
    createdAt: timestampAfter(rejected.state.updatedAt),
  });
  assert.equal(replacementPlan.group.groupId, applied.group.groupId);
  assert.equal(replacementPlan.packets[0].packetId, second.packet.packetId);
  assert.notEqual(replacementPlan.envelopes[0].deliveryId, second.envelope.deliveryId);
  const replacement = await orchestration.applyTargetDeliveryPlan({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    plan: replacementPlan,
    planDigest: replacementPlan.planDigest,
  });
  assert.equal(replacement.members[0].currentDelivery.group.groupId, applied.group.groupId);
  assert.equal(replacement.members[0].currentDelivery.sourceState.revision, first.currentDelivery.sourceState.revision);

  const firstPermit = await orchestration.claimTargetDelivery({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targetTaskId: INTEGRATION_IDS.targetTask,
    deliveryId: first.envelope.deliveryId,
    sendGeneration: 1,
  });
  assert.equal(firstPermit.targetTaskId, INTEGRATION_IDS.targetTask);
  assert.equal(firstPermit.group.groupId, applied.group.groupId);
});
