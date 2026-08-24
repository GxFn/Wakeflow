import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  canonicalJsonDigest,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  parseWakeflowAssetBundle,
  WAKEFLOW_ASSET_CONTRACTS,
} from "../core/scripts/lib/wakeflow-template-renderer.mjs";
import {
  buildWakeflowAssetBundle,
} from "../tools/build-asset-bundle.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(repositoryRoot, "core/template-sources");
const builderRelative = "core/scripts/lib/wakeflow-demand-document-builder.mjs";
const builderUrl = new URL(`../${builderRelative}`, import.meta.url);
const demandLayoutUrl = new URL("../core/scripts/lib/wakeflow-demand-layout.mjs", import.meta.url);

const IDS = Object.freeze({
  program: "program_11111111-1111-4111-8111-111111111111",
  demand: "demand_22222222-2222-4222-8222-222222222222",
  requirement: "requirement_33333333-3333-4333-8333-333333333333",
  confirmation: "confirmation_44444444-4444-4444-8444-444444444444",
  taskPackageActive: "task-package_55555555-5555-4555-8555-555555555555",
  taskPackageClosed: "task-package_66666666-6666-4666-8666-666666666666",
  taskPackageSuperseded: "task-package_77777777-7777-4777-8777-777777777777",
  targetTask: "target-task_88888888-8888-4888-8888-888888888888",
  targetResultCurrent: "target-result_99999999-9999-4999-8999-999999999999",
  targetResultHistorical: "target-result_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  testCardActive: "test-card_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  testCardClosed: "test-card_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  testCardSuperseded: "test-card_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  evidence: "evidence_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  reviewCandidate: "review-candidate_ffffffff-ffff-4fff-bfff-ffffffffffff",
});
const CREATED_AT = "2026-08-07T01:02:03.000Z";
const UPDATED_AT = "2026-08-07T01:03:04.000Z";
const REQUIREMENT_ROLES = Object.freeze([
  "code-facts",
  "landing-plan",
  "non-goals",
  "original-plan",
  "requirement-design",
  "user-confirmation",
]);
const CURRENT_ASSET_DIGESTS = Object.freeze({
  "progress.demand.en": "sha256:235512389c9fe63f302cb305bd2a7359db462aa51feee80fe7e4b25de9d47c67",
  "progress.demand.zh-CN": "sha256:06f76d3ad5056c3d1006011c463ca9f9f0e3889b18df76f286f9dcce7466d585",
});

function clone(value) {
  return structuredClone(value);
}

function digest(value) {
  return canonicalJsonDigest(value);
}

function contentDigest(content) {
  return `sha256:${createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex")}`;
}

function parsedBundle() {
  return parseWakeflowAssetBundle(buildWakeflowAssetBundle({ sourceRoot }));
}

async function builderModule() {
  return import(builderUrl.href);
}

async function demandLayoutModule() {
  return import(demandLayoutUrl.href);
}

function todoLineage() {
  return {
    artifactKind: "wakeflow-todo-lineage-ref",
    schemaVersion: 1,
    boardRef: ".wakeflow-active/current/global-todo-board.md",
    todoId: "TODO-M2-T08",
    intakeRowDigest: `sha256:${"a".repeat(64)}`,
  };
}

function requirementRef(role, index) {
  const memberName = `${String(index + 1).padStart(2, "0")}-${role}.md`;
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-ledger-member-ref",
    family: "requirement",
    recordId: IDS.requirement,
    recordRef: `requirement-designs/${IDS.requirement}/record.json`,
    recordDigest: `sha256:${"b".repeat(64)}`,
    memberRef: `requirement-designs/${IDS.requirement}/${memberName}`,
    memberDigest: `sha256:${"c".repeat(64)}`,
    role,
  };
}

function confirmationRef(role = "goal-stage-decision") {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-ledger-member-ref",
    family: "confirmation",
    recordId: IDS.confirmation,
    recordRef: `goal-stage-confirmation/${IDS.confirmation}/record.json`,
    recordDigest: `sha256:${"d".repeat(64)}`,
    memberRef: `goal-stage-confirmation/${IDS.confirmation}/01-${role}.md`,
    memberDigest: `sha256:${"e".repeat(64)}`,
    role,
  };
}

function demandRecord(overrides = {}) {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-demand",
    programId: IDS.program,
    demandId: IDS.demand,
    createdAt: CREATED_AT,
    title: "Candidate demand documents",
    goal: "Build deterministic human orientation from the strict demand stack.",
    completionDefinition: "The two Markdown files bind one exact source fingerprint.",
    demandType: "requirement",
    source: todoLineage(),
    executionPlacement: { mode: "main" },
    ...overrides,
  };
}

function authorityRecord(demand, overrides = {}) {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-demand-authority",
    demandId: demand.demandId,
    demandRef: "demand.json",
    demandDigest: digest(demand),
    entryMode: "design-delivery",
    authorityRefs: REQUIREMENT_ROLES.map(requirementRef),
    testDecision: {
      mode: "controller-only",
      summary: "Run the bounded candidate projector regression suite.",
    },
    ...overrides,
  };
}

function changedArtifact(artifactKind, ref, artifactDigest) {
  return { artifactKind, ref, digest: artifactDigest };
}

function controllerEvent({
  demand,
  eventId = "event-initial-0001",
  createdAt = CREATED_AT,
  command = "init",
  type = "state.initialized",
  previousRevision = 0,
  nextRevision = 1,
  from = null,
  to = "intake",
  reason = "candidate demand documents initialized",
  decisionSummary = "Publish the strict immutable demand identity.",
  changedArtifacts = [],
} = {}) {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId,
    demandId: demand.demandId,
    createdAt,
    actor: "controller",
    command,
    type,
    previousRevision,
    nextRevision,
    from,
    to,
    reason,
    decisionSummary,
    changedArtifacts,
  };
}

function stateRecord({ demand, authority = null, event }) {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-state",
    programId: demand.programId,
    demandId: demand.demandId,
    demandRef: "demand.json",
    demandDigest: digest(demand),
    ...(authority === null ? {} : {
      demandAuthorityRef: "demand-authority.json",
      demandAuthorityDigest: digest(authority),
    }),
    revision: event.nextRevision,
    state: event.to,
    stateReason: event.reason,
    updatedAt: event.createdAt,
    lastEvent: {
      eventId: event.eventId,
      eventDigest: digest(event),
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
}

function draftFixture(overrides = {}) {
  const demand = demandRecord(overrides);
  const event = controllerEvent({
    demand,
    changedArtifacts: [changedArtifact("wakeflow-demand", "demand.json", digest(demand))],
  });
  return {
    demand,
    authority: null,
    state: stateRecord({ demand, event }),
    events: [event],
  };
}

function frozenFixture(overrides = {}) {
  const demand = demandRecord(overrides);
  const authority = authorityRecord(demand);
  const event = controllerEvent({
    demand,
    decisionSummary: "Publish the demand identity and its frozen execution authority.",
    changedArtifacts: [
      changedArtifact("wakeflow-demand", "demand.json", digest(demand)),
      changedArtifact("wakeflow-demand-authority", "demand-authority.json", digest(authority)),
    ],
  });
  return {
    demand,
    authority,
    state: stateRecord({ demand, authority, event }),
    events: [event],
  };
}

function advancedFixture({ to = "planned" } = {}) {
  const fixture = draftFixture();
  const event = controllerEvent({
    demand: fixture.demand,
    eventId: "event-transition-0002",
    createdAt: UPDATED_AT,
    command: "continue-demand",
    type: "state.transitioned",
    previousRevision: 1,
    nextRevision: 2,
    from: "intake",
    to,
    reason: `candidate demand moved to ${to}`,
    decisionSummary: `Use the existing ${to} state without inventing a projection state enum.`,
  });
  return {
    ...fixture,
    state: stateRecord({ demand: fixture.demand, event }),
    events: [...fixture.events, event],
  };
}

function managedArtifactChange(artifactKind, artifactId, ref, artifactDigest) {
  return {
    artifactKind,
    artifactId,
    ref,
    digest: artifactDigest,
  };
}

function artifactNavigationFixture() {
  const fixture = draftFixture();
  const tupleDigest = (character) => `sha256:${character.repeat(64)}`;
  const taskPackages = [
    {
      taskPackageId: IDS.taskPackageActive,
      ref: `task-packages/${IDS.taskPackageActive}.json`,
      digest: tupleDigest("1"),
      lifecycleStatus: "active",
    },
    {
      taskPackageId: IDS.taskPackageClosed,
      ref: `task-packages/${IDS.taskPackageClosed}.json`,
      digest: tupleDigest("2"),
      lifecycleStatus: "closed",
    },
    {
      taskPackageId: IDS.taskPackageSuperseded,
      ref: `task-packages/${IDS.taskPackageSuperseded}.json`,
      digest: tupleDigest("3"),
      lifecycleStatus: "superseded",
    },
  ];
  const currentResult = {
    targetResultId: IDS.targetResultCurrent,
    targetTaskId: IDS.targetTask,
    ref: `target-results/${IDS.targetTask}/${IDS.targetResultCurrent}.json`,
    digest: tupleDigest("4"),
    lifecycleStatus: "current",
  };
  const historicalResult = {
    targetResultId: IDS.targetResultHistorical,
    targetTaskId: IDS.targetTask,
    ref: `target-results/${IDS.targetTask}/${IDS.targetResultHistorical}.json`,
    digest: tupleDigest("5"),
    lifecycleStatus: "historical",
  };
  const testCards = [
    {
      testCardId: IDS.testCardActive,
      ref: `test-cards/${IDS.testCardActive}.json`,
      digest: tupleDigest("6"),
      lifecycleStatus: "active",
    },
    {
      testCardId: IDS.testCardClosed,
      ref: `test-cards/${IDS.testCardClosed}.json`,
      digest: tupleDigest("7"),
      lifecycleStatus: "closed",
    },
    {
      testCardId: IDS.testCardSuperseded,
      ref: `test-cards/${IDS.testCardSuperseded}.json`,
      digest: tupleDigest("8"),
      lifecycleStatus: "superseded",
    },
  ];
  const evidence = {
    evidenceId: IDS.evidence,
    ref: `evidence/${IDS.evidence}/evidence.json`,
    digest: tupleDigest("9"),
  };
  const pendingCandidate = {
    reviewCandidateId: IDS.reviewCandidate,
    ref: `review-candidates/${IDS.reviewCandidate}.json`,
    digest: tupleDigest("a"),
  };
  const changes = [
    ...taskPackages.map((entry) => managedArtifactChange(
      "wakeflow-task-package",
      entry.taskPackageId,
      entry.ref,
      entry.digest,
    )),
    ...[currentResult, historicalResult].map((entry) => managedArtifactChange(
      "wakeflow-target-result",
      entry.targetResultId,
      entry.ref,
      entry.digest,
    )),
    ...testCards.map((entry) => managedArtifactChange(
      "wakeflow-test-card",
      entry.testCardId,
      entry.ref,
      entry.digest,
    )),
    managedArtifactChange("wakeflow-evidence", evidence.evidenceId, evidence.ref, evidence.digest),
    managedArtifactChange(
      "wakeflow-review-candidate",
      pendingCandidate.reviewCandidateId,
      pendingCandidate.ref,
      pendingCandidate.digest,
    ),
  ];
  const events = [...fixture.events];
  for (const [index, change] of changes.entries()) {
    const previous = events.at(-1);
    events.push(controllerEvent({
      demand: fixture.demand,
      eventId: `event-artifact-${String(index + 2).padStart(4, "0")}`,
      createdAt: `2026-08-07T01:${String(index + 4).padStart(2, "0")}:00.000Z`,
      command: "record-artifact",
      type: "artifact.recorded",
      previousRevision: previous.nextRevision,
      nextRevision: previous.nextRevision + 1,
      from: previous.to,
      to: index === changes.length - 1 ? "review-ready" : "planned",
      reason: "Publish one immutable artifact identity into validated demand state.",
      decisionSummary: "Expose only the current state-selected portable reference.",
      changedArtifacts: [change],
    }));
  }
  const tail = events.at(-1);
  return {
    ...fixture,
    state: {
      ...fixture.state,
      revision: tail.nextRevision,
      state: tail.to,
      stateReason: tail.reason,
      updatedAt: tail.createdAt,
      lastEvent: {
        eventId: tail.eventId,
        eventDigest: digest(tail),
      },
      taskPackages,
      targetTasks: [{
        targetTaskId: IDS.targetTask,
        taskPackageId: IDS.taskPackageActive,
        windowId: "window_12121212-1212-4212-8212-121212121212",
        lifecycleStatus: "review-ready",
        currentResult: {
          targetResultId: currentResult.targetResultId,
          ref: currentResult.ref,
          digest: currentResult.digest,
        },
      }],
      targetResults: [currentResult, historicalResult],
      testCards,
      evidence: [evidence],
      review: {
        status: "pending",
        readyTargetTaskIds: [IDS.targetTask],
        blockedTargetTaskIds: [],
        missingTargetTaskIds: [],
        pendingCandidate,
      },
    },
    events,
  };
}

function builderInput(fixture, options = {}) {
  return {
    bundle: options.bundle ?? parsedBundle(),
    language: options.language ?? "en",
    demand: fixture.demand,
    authority: fixture.authority,
    state: fixture.state,
    events: fixture.events,
    ...(options.extra ?? {}),
  };
}

function resignBundle(bundle) {
  bundle.bundleDigest = canonicalJsonDigest({
    schemaVersion: bundle.schemaVersion,
    artifactKind: bundle.artifactKind,
    source: bundle.source,
    sourceDigest: bundle.sourceDigest,
    assets: bundle.assets,
  });
  return bundle;
}

function mutateBundle(assetId, mutate) {
  const bundle = buildWakeflowAssetBundle({ sourceRoot });
  const entry = bundle.assets[assetId];
  entry.content = mutate(entry.content);
  entry.sha256 = contentDigest(entry.content);
  return parseWakeflowAssetBundle(resignBundle(bundle));
}

function assertDeepFrozen(value, at = "$", seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true, `${at} must be frozen`);
  for (const [key, child] of Object.entries(value)) {
    assertDeepFrozen(child, `${at}/${key}`, seen);
  }
}

test("demand capability roots have one frozen placement-aware description", async () => {
  const {
    wakeflowDemandCapabilityRoots,
    WAKEFLOW_DEMAND_COMMON_CAPABILITY_ROOTS,
    WAKEFLOW_DEMAND_ISOLATED_CAPABILITY_ROOTS,
    WAKEFLOW_DEMAND_RECOVERY_ROOT,
  } = await demandLayoutModule();
  assert.deepEqual(WAKEFLOW_DEMAND_COMMON_CAPABILITY_ROOTS, [
    "task-packages",
    "target-results",
    "review-candidates",
    "test-cards",
    "evidence",
  ]);
  assert.equal(WAKEFLOW_DEMAND_RECOVERY_ROOT, "transactions");
  assert.deepEqual(WAKEFLOW_DEMAND_ISOLATED_CAPABILITY_ROOTS, [
    "pod/design-requests",
    "pod/design-handoffs",
  ]);
  assert.equal(Object.isFrozen(WAKEFLOW_DEMAND_COMMON_CAPABILITY_ROOTS), true);
  assert.equal(Object.isFrozen(WAKEFLOW_DEMAND_ISOLATED_CAPABILITY_ROOTS), true);

  const mainPlacement = { mode: "main" };
  const isolatedPlacement = { mode: "isolated", authorizationRef: { opaque: true } };
  const mainRoots = wakeflowDemandCapabilityRoots(mainPlacement);
  const isolatedRoots = wakeflowDemandCapabilityRoots(isolatedPlacement);
  assert.deepEqual(mainRoots, [
    ...WAKEFLOW_DEMAND_COMMON_CAPABILITY_ROOTS,
    WAKEFLOW_DEMAND_RECOVERY_ROOT,
  ]);
  assert.deepEqual(isolatedRoots, [
    ...mainRoots,
    ...WAKEFLOW_DEMAND_ISOLATED_CAPABILITY_ROOTS,
  ]);
  assert.equal(Object.isFrozen(mainRoots), true);
  assert.equal(Object.isFrozen(isolatedRoots), true);
  assert.deepEqual(mainPlacement, { mode: "main" });
  assert.deepEqual(isolatedPlacement, { mode: "isolated", authorizationRef: { opaque: true } });

  let accessorReads = 0;
  const accessorPlacement = {};
  Object.defineProperty(accessorPlacement, "mode", {
    enumerable: true,
    get() {
      accessorReads += 1;
      return "main";
    },
  });
  assert.throws(() => wakeflowDemandCapabilityRoots(accessorPlacement), TypeError);
  assert.equal(accessorReads, 0, "the pure selector must not invoke caller accessors");
  const foreignPlacement = Object.assign(Object.create({ inherited: true }), { mode: "main" });
  assert.throws(() => wakeflowDemandCapabilityRoots(foreignPlacement), TypeError);
  const hiddenPlacement = {};
  Object.defineProperty(hiddenPlacement, "mode", { value: "main" });
  assert.throws(() => wakeflowDemandCapabilityRoots(hiddenPlacement), TypeError);
  assert.throws(() => wakeflowDemandCapabilityRoots({ mode: "main", unexpected: true }), TypeError);
  assert.throws(() => wakeflowDemandCapabilityRoots({ mode: "legacy" }), TypeError);
});

test("demand document assets and module expose only the admitted pure surface", async () => {
  assert.equal(existsSync(path.join(repositoryRoot, builderRelative)), true);
  assert.deepEqual(Object.keys(WAKEFLOW_ASSET_CONTRACTS), [
    "progress.demand.en",
    "progress.demand.zh-CN",
  ]);
  const bundle = buildWakeflowAssetBundle({ sourceRoot });
  assert.deepEqual(Object.keys(bundle.assets), Object.keys(WAKEFLOW_ASSET_CONTRACTS));
  const preFrozenBundle = buildWakeflowAssetBundle({ sourceRoot });
  Object.freeze(preFrozenBundle.assets);
  Object.freeze(preFrozenBundle);
  parseWakeflowAssetBundle(preFrozenBundle);
  assertDeepFrozen(preFrozenBundle);
  assert.throws(() => {
    preFrozenBundle.assets["progress.demand.en"].content += "mutated";
  }, TypeError);
  const accessorBundle = buildWakeflowAssetBundle({ sourceRoot });
  const assets = accessorBundle.assets;
  Object.defineProperty(accessorBundle, "assets", {
    enumerable: true,
    get() {
      return assets;
    },
  });
  assert.throws(() => parseWakeflowAssetBundle(accessorBundle));
  const manifest = JSON.parse(readFileSync(path.join(sourceRoot, "manifest.json"), "utf8"));
  for (const assetId of ["progress.demand.en", "progress.demand.zh-CN"]) {
    const asset = manifest.assets.find((entry) => entry.id === assetId);
    assert.deepEqual(asset?.consumers, ["wakeflow-demand-document-builder"]);
    assert.equal(asset?.owner, "demand-projector");
  }
  const module = await builderModule();
  assert.deepEqual(Object.keys(module).sort(), [
    "WAKEFLOW_DEMAND_DOCUMENT_PROJECTOR_SCHEMA_VERSION",
    "WakeflowDemandDocumentError",
    "buildWakeflowDemandDocuments",
    "selectWakeflowStateSelectedArtifacts",
  ]);
});

test("strict draft stack renders exact deterministic and deeply frozen demand documents", async () => {
  const { buildWakeflowDemandDocuments } = await builderModule();
  const {
    WAKEFLOW_DEMAND_COMMON_CAPABILITY_ROOTS,
    WAKEFLOW_DEMAND_ISOLATED_CAPABILITY_ROOTS,
  } = await demandLayoutModule();
  const fixture = draftFixture();
  const input = builderInput(fixture);
  const before = clone({
    language: input.language,
    demand: input.demand,
    authority: input.authority,
    state: input.state,
    events: input.events,
  });
  const first = buildWakeflowDemandDocuments(input);
  const second = buildWakeflowDemandDocuments(input);
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first), [
    "kind",
    "schemaVersion",
    "programId",
    "demandId",
    "language",
    "source",
    "files",
  ]);
  assert.equal(first.kind, "WakeflowDemandDocumentProjection");
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.programId, IDS.program);
  assert.equal(first.demandId, IDS.demand);
  assert.equal(first.language, "en");
  assert.deepEqual(Object.keys(first.files), ["index.md", "developer-progress.md"]);
  assert.equal(first.source.authorityDigest, null);
  assert.equal(first.source.revision, 1);
  assert.equal(first.source.eventId, fixture.events[0].eventId);
  assert.equal(first.source.eventDigest, digest(fixture.events[0]));
  assert.equal(first.source.eventHistoryDigest, digest(fixture.events));
  assert.equal(first.source.progressTemplate.assetId, "progress.demand.en");
  assert.match(first.source.fingerprint, /^sha256:[0-9a-f]{64}$/u);
  for (const [ref, document] of Object.entries(first.files)) {
    assert.deepEqual(Object.keys(document), ["content", "digest"]);
    assert.equal(document.content.includes("\r"), false, ref);
    assert.equal(document.content.endsWith("\n"), true, ref);
    assert.equal(document.content.endsWith("\n\n"), false, ref);
    assert.equal(document.digest, contentDigest(document.content), ref);
    assert.equal(
      (document.content.match(/<!-- wakeflow:demand-projection:v1:/gu) ?? []).length,
      1,
      ref,
    );
    assert.equal(document.content.includes(first.source.fingerprint), true);
    assert.doesNotMatch(document.content, /projection\.json|Backfill Summaries|Decisions And Append Log/u);
  }
  assert.match(first.files["index.md"].content, /\[demand\.json\]\(demand\.json\)/u);
  assert.match(first.files["index.md"].content, /\[wakeflow-state\.json\]\(wakeflow-state\.json\)/u);
  assert.match(first.files["index.md"].content, /\[controller-events\.jsonl\]\(controller-events\.jsonl\)/u);
  assert.match(first.files["index.md"].content, /\[developer-progress\.md\]\(developer-progress\.md\)/u);
  assert.match(first.files["index.md"].content, /## Recovery[\s\S]*\[transactions\/\]\(transactions\/\)/u);
  const capabilitySection = first.files["index.md"].content.match(
    /## Capability Roots([\s\S]*?)## Recovery/u,
  )?.[1] ?? "";
  for (const root of WAKEFLOW_DEMAND_COMMON_CAPABILITY_ROOTS) {
    assert.equal(capabilitySection.includes(`[${root}/](${root}/)`), true, `${root} must be navigable`);
  }
  for (const root of WAKEFLOW_DEMAND_ISOLATED_CAPABILITY_ROOTS) {
    assert.equal(capabilitySection.includes(`${root}/`), false, `${root} must be isolated-only`);
  }
  assert.doesNotMatch(
    capabilitySection,
    /transactions\//u,
  );
  assert.doesNotMatch(first.files["index.md"].content, /\[demand-authority\.json\]/u);
  assert.match(first.files["developer-progress.md"].content, /## Current State/u);
  assert.match(first.files["developer-progress.md"].content, /not frozen/u);
  assert.deepEqual({
    language: input.language,
    demand: input.demand,
    authority: input.authority,
    state: input.state,
    events: input.events,
  }, before);
  assertDeepFrozen(first);
});

test("empty artifact inventory preserves the admitted T03 projection bytes and fingerprint", async () => {
  const { buildWakeflowDemandDocuments } = await builderModule();
  const fixture = draftFixture();
  const expected = {
    en: {
      fingerprint: "sha256:97d23741b8c553bd2e6f34e2e9607acb5975e1e28f5ca8deab1541ed41ffe7a6",
      index: "sha256:a1503307c3ccfd134f8203e5106bd310568e4ca4a4b75862defdec440a0d8052",
      progress: "sha256:6983b92cec63a9c668a2abf2a8c4f67ccdc72bd969bd7137dd16bdc20c8a1748",
    },
    zh: {
      fingerprint: "sha256:fb960260512150f6d9a96840c6dd5c2e6f4805878ac8cdd34c1e3637cd9ae282",
      index: "sha256:08150c94d98359639ddc3ae5044321cf87100c69110ad8d008ff87c145490cf4",
      progress: "sha256:c908f583399f7a2e9184ad11b216498f99779c1800f78f85a581b22320594598",
    },
  };
  for (const language of ["en", "zh"]) {
    const projection = buildWakeflowDemandDocuments(builderInput(fixture, { language }));
    assert.equal(projection.source.fingerprint, expected[language].fingerprint);
    assert.equal(projection.files["index.md"].digest, expected[language].index);
    assert.equal(projection.files["developer-progress.md"].digest, expected[language].progress);
    assert.doesNotMatch(projection.files["index.md"].content, /Current Artifacts|当前制品/u);
  }
});

test("demand index lists only exact state-selected current artifact references", async () => {
  const { buildWakeflowDemandDocuments } = await builderModule();
  const fixture = artifactNavigationFixture();
  const before = clone({ state: fixture.state, events: fixture.events });
  const en = buildWakeflowDemandDocuments(builderInput(fixture));
  const zh = buildWakeflowDemandDocuments(builderInput(fixture, { language: "zh" }));
  assert.deepEqual(en, buildWakeflowDemandDocuments(builderInput(fixture)));
  assert.deepEqual(zh, buildWakeflowDemandDocuments(builderInput(fixture, { language: "zh" })));
  const index = en.files["index.md"].content;

  assert.match(index, /## Current Artifacts/u);
  for (const ref of [
    fixture.state.taskPackages[0].ref,
    fixture.state.targetResults[0].ref,
    fixture.state.testCards[0].ref,
    fixture.state.review.pendingCandidate.ref,
    fixture.state.evidence[0].ref,
  ]) {
    assert.equal(index.includes(`](${ref})`), true, `${ref} must be an exact portable link`);
  }
  for (const ref of [
    fixture.state.taskPackages[1].ref,
    fixture.state.taskPackages[2].ref,
    fixture.state.targetResults[1].ref,
    fixture.state.testCards[1].ref,
    fixture.state.testCards[2].ref,
    `target-results/${IDS.targetResultCurrent}.json`,
    `.wakeflow-local/target-results/${IDS.targetResultCurrent}.json`,
    `target-results/${IDS.targetTask}/orphan.json`,
  ]) {
    assert.equal(index.includes(`](${ref})`), false, `${ref} must not be projected`);
  }
  for (const selected of [
    fixture.state.taskPackages[0],
    fixture.state.targetResults[0],
    fixture.state.testCards[0],
    fixture.state.review.pendingCandidate,
    fixture.state.evidence[0],
  ]) {
    assert.equal(index.includes(`<code>${selected.digest}</code>`), true, selected.ref);
  }
  assert.doesNotMatch(en.files["developer-progress.md"].content, /Current Artifacts/u);
  assert.match(zh.files["index.md"].content, /## 当前制品/u);
  assert.match(zh.files["index.md"].content, /### 活跃任务包/u);
  assert.match(zh.files["index.md"].content, /### 当前 TargetResults/u);
  assert.equal(
    index.includes(`[${IDS.taskPackageActive}](${fixture.state.taskPackages[0].ref})`),
    false,
    "typed IDs must be escaped before entering a Markdown link label",
  );
  assert.equal(
    index.includes(`[${IDS.taskPackageActive.replace("_", "\\_")}](${fixture.state.taskPackages[0].ref})`),
    true,
  );
  assert.equal(en.source.stateDigest, digest(fixture.state));
  assert.deepEqual(Object.keys(en.source), [
    "fingerprint",
    "projectorSchemaVersion",
    "demandDigest",
    "authorityDigest",
    "stateDigest",
    "eventHistoryDigest",
    "revision",
    "eventId",
    "eventDigest",
    "progressTemplate",
  ]);
  assert.deepEqual({ state: fixture.state, events: fixture.events }, before);
  assertDeepFrozen(en);
  assertDeepFrozen(zh);
});

test("state-selected artifact selector includes TestCard-before-task and excludes closed, historical, and orphan material", async () => {
  const { selectWakeflowStateSelectedArtifacts } = await builderModule();
  const fixture = artifactNavigationFixture();
  const before = clone(fixture.state);
  const selected = selectWakeflowStateSelectedArtifacts(fixture.state);
  const refs = selected.map((entry) => entry.ref);

  assert.deepEqual(refs, [...refs].sort());
  assert.equal(new Set(refs).size, refs.length);
  assert.deepEqual(selected, [
    {
      artifactKind: "wakeflow-evidence",
      artifactId: fixture.state.evidence[0].evidenceId,
      ref: fixture.state.evidence[0].ref,
      digest: fixture.state.evidence[0].digest,
    },
    {
      artifactKind: "wakeflow-review-candidate",
      artifactId: fixture.state.review.pendingCandidate.reviewCandidateId,
      ref: fixture.state.review.pendingCandidate.ref,
      digest: fixture.state.review.pendingCandidate.digest,
    },
    {
      artifactKind: "wakeflow-target-result",
      artifactId: fixture.state.targetResults[0].targetResultId,
      ref: fixture.state.targetResults[0].ref,
      digest: fixture.state.targetResults[0].digest,
    },
    {
      artifactKind: "wakeflow-task-package",
      artifactId: fixture.state.taskPackages[0].taskPackageId,
      ref: fixture.state.taskPackages[0].ref,
      digest: fixture.state.taskPackages[0].digest,
    },
    {
      artifactKind: "wakeflow-test-card",
      artifactId: fixture.state.testCards[0].testCardId,
      ref: fixture.state.testCards[0].ref,
      digest: fixture.state.testCards[0].digest,
    },
  ]);
  for (const ref of [
    fixture.state.taskPackages[1].ref,
    fixture.state.taskPackages[2].ref,
    fixture.state.targetResults[1].ref,
    fixture.state.testCards[1].ref,
    fixture.state.testCards[2].ref,
    `target-results/${IDS.targetTask}/orphan.json`,
    `.wakeflow-local/target-results/${IDS.targetResultCurrent}.json`,
  ]) {
    assert.equal(refs.includes(ref), false, `${ref} must not be selected`);
  }
  assert.deepEqual(fixture.state, before);
  assertDeepFrozen(selected);

  const beforeTask = draftFixture().state;
  beforeTask.testCards = [clone(fixture.state.testCards[0])];
  assert.deepEqual(beforeTask.targetTasks, []);
  const beforeTaskSelected = selectWakeflowStateSelectedArtifacts(beforeTask);
  assert.deepEqual(beforeTaskSelected, [{
    artifactKind: "wakeflow-test-card",
    artifactId: fixture.state.testCards[0].testCardId,
    ref: fixture.state.testCards[0].ref,
    digest: fixture.state.testCards[0].digest,
  }]);
  assertDeepFrozen(beforeTaskSelected);
});

test("frozen authority, isolated placement, language, and terminal state remain source facts", async () => {
  const { buildWakeflowDemandDocuments } = await builderModule();
  const { WAKEFLOW_DEMAND_ISOLATED_CAPABILITY_ROOTS } = await demandLayoutModule();
  const isolated = frozenFixture({
    executionPlacement: {
      mode: "isolated",
      authorizationRef: confirmationRef(),
    },
  });
  const en = buildWakeflowDemandDocuments(builderInput(isolated));
  const zh = buildWakeflowDemandDocuments(builderInput(isolated, { language: "zh" }));
  assert.notEqual(en.source.fingerprint, zh.source.fingerprint);
  assert.equal(en.source.authorityDigest, digest(isolated.authority));
  assert.equal(en.source.progressTemplate.assetId, "progress.demand.en");
  assert.equal(zh.source.progressTemplate.assetId, "progress.demand.zh-CN");
  assert.match(en.files["index.md"].content, /\[demand-authority\.json\]\(demand-authority\.json\)/u);
  for (const root of WAKEFLOW_DEMAND_ISOLATED_CAPABILITY_ROOTS) {
    assert.equal(en.files["index.md"].content.includes(`[${root}/](${root}/)`), true, `${root} must be navigable`);
  }
  assert.match(en.files["developer-progress.md"].content, /## Execution Authority/u);
  assert.match(en.files["developer-progress.md"].content, /frozen/u);
  assert.match(en.files["developer-progress.md"].content, /controller-only/u);
  assert.match(en.files["developer-progress.md"].content, /recordId=<code>requirement_/u);
  assert.match(en.files["developer-progress.md"].content, /recordRef=<code>requirement-designs\//u);
  assert.match(en.files["developer-progress.md"].content, /recordDigest=<code>sha256:/u);
  assert.match(zh.files["developer-progress.md"].content, /## 当前状态/u);
  assert.match(zh.files["developer-progress.md"].content, /已冻结/u);

  const terminal = buildWakeflowDemandDocuments(builderInput(advancedFixture({ to: "archived" })));
  assert.match(terminal.files["developer-progress.md"].content, /archived/u);
  assert.equal(Object.hasOwn(terminal, "classification"), false);
});

test("source fingerprint binds full history and selected locale while ignoring the other locale", async () => {
  const { buildWakeflowDemandDocuments } = await builderModule();
  const fixture = advancedFixture();
  const baseline = buildWakeflowDemandDocuments(builderInput(fixture));

  const changedEarly = clone(fixture);
  changedEarly.events[0].decisionSummary = "An earlier decision summary changed without altering the valid tail.";
  const earlyProjection = buildWakeflowDemandDocuments(builderInput(changedEarly));
  assert.equal(earlyProjection.source.stateDigest, baseline.source.stateDigest);
  assert.equal(earlyProjection.source.eventDigest, baseline.source.eventDigest);
  assert.notEqual(earlyProjection.source.eventHistoryDigest, baseline.source.eventHistoryDigest);
  assert.notEqual(earlyProjection.source.fingerprint, baseline.source.fingerprint);

  const unrelatedBundle = mutateBundle(
    "progress.demand.zh-CN",
    (content) => content.replace(/\n$/u, "\n未选中的语言格式变化。\n"),
  );
  const unrelated = buildWakeflowDemandDocuments(builderInput(fixture, { bundle: unrelatedBundle }));
  assert.equal(unrelated.source.fingerprint, baseline.source.fingerprint);
  assert.deepEqual(unrelated.files, baseline.files);

  const selectedBundle = mutateBundle(
    "progress.demand.en",
    (content) => content.replace(/\n$/u, "\nSelected candidate format change.\n"),
  );
  const selected = buildWakeflowDemandDocuments(builderInput(fixture, { bundle: selectedBundle }));
  assert.notEqual(selected.source.progressTemplate.digest, baseline.source.progressTemplate.digest);
  assert.notEqual(selected.source.fingerprint, baseline.source.fingerprint);
  assert.notDeepEqual(selected.files, baseline.files);
});

test("builder rejects invalid core relations, unresolved language, unparsed bundles, and unknown input", async () => {
  const { buildWakeflowDemandDocuments } = await builderModule();
  const fixture = draftFixture();

  const stale = clone(fixture);
  stale.state.lastEvent.eventDigest = `sha256:${"f".repeat(64)}`;
  assert.throws(() => buildWakeflowDemandDocuments(builderInput(stale)));
  assert.throws(() => buildWakeflowDemandDocuments(builderInput(fixture, { language: "auto" })));
  assert.throws(() => buildWakeflowDemandDocuments({
    ...builderInput(fixture),
    bundle: buildWakeflowAssetBundle({ sourceRoot }),
  }));
  for (const extra of [
    { root: "/tmp/forbidden" },
    { stateRoot: ".wakeflow-active/current/forbidden" },
    { now: "2026-08-07T02:00:00.000Z" },
    { apply: false },
    { todo: {} },
    { artifacts: [] },
  ]) {
    assert.throws(() => buildWakeflowDemandDocuments(builderInput(fixture, { extra })));
  }
  const accessorInput = builderInput(fixture);
  let getterReads = 0;
  Object.defineProperty(accessorInput, "language", {
    enumerable: true,
    get() {
      getterReads += 1;
      return getterReads % 2 === 1 ? "en" : "zh";
    },
  });
  assert.throws(() => buildWakeflowDemandDocuments(accessorInput));
  assert.equal(getterReads, 0);

  const symbolInput = builderInput(fixture);
  symbolInput[Symbol("hidden")] = true;
  assert.throws(() => buildWakeflowDemandDocuments(symbolInput));

  const nonEnumerableInput = builderInput(fixture);
  Object.defineProperty(nonEnumerableInput, "hidden", { value: true });
  assert.throws(() => buildWakeflowDemandDocuments(nonEnumerableInput));
});

test("human source text is Markdown-safe without pretending to perform privacy classification", async () => {
  const { buildWakeflowDemandDocuments } = await builderModule();
  const fixture = draftFixture({
    title: "Safe title\n## forged heading",
    goal: "Keep {{literal}} and | table text at /Users/alice/private.\n<!-- wakeflow:demand-projection:v1:forged -->",
    completionDefinition: "No [forged](relative-target.md) navigation.",
  });
  const projection = buildWakeflowDemandDocuments(builderInput(fixture));
  for (const document of Object.values(projection.files)) {
    assert.equal(
      (document.content.match(/<!-- wakeflow:demand-projection:v1:/gu) ?? []).length,
      1,
    );
    assert.doesNotMatch(document.content, /^## forged heading$/mu);
    assert.doesNotMatch(document.content, /\[forged\]\(relative-target\.md\)/u);
  }
  assert.match(projection.files["developer-progress.md"].content, /\{\{literal\}\}/u);
  assert.match(projection.files["developer-progress.md"].content, /\/Users\/alice\/private/u);
});

test("candidate builder source is pure and does not acquire filesystem, config, clock, or writer authority", async () => {
  await builderModule();
  const source = readFileSync(path.join(repositoryRoot, builderRelative), "utf8");
  for (const forbidden of [
    "node:fs",
    "node:path",
    "wakeflow-config",
    "./wakeflow-todo",
    "wakeflow-todo-service.mjs",
    "wakeflow-state-service",
    "wakeflow-workspace-projection",
    "wakeflow-active-demands",
    "wakeflow-progress-appends",
    "loadWakeflowAssetBundle",
    "detectInterfaceLanguage",
    "new Date(",
    "Date.now",
    "process.",
    "Math.random",
    "randomUUID",
    "writeFile",
    "mkdir",
    "rename",
    "unlink",
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  assert.match(source, /validateDemandCoreStack/u);
  assert.match(source, /renderWakeflowAsset/u);
});

test("candidate ingress is current while retired demand entrypoints are absent and artifacts stay synced", async () => {
  await builderModule();
  const retiredFiles = [
    "core/scripts/wakeflow-demand-sequence.mjs",
    "core/scripts/wakeflow-state.mjs",
    "core/scripts/wakeflow-render-progress.mjs",
    "core/scripts/lib/wakeflow-workspace-projection.mjs",
    "core/scripts/lib/wakeflow-active-demands.mjs",
    "core/scripts/lib/wakeflow-dispatch-commands.mjs",
  ];
  for (const relative of retiredFiles) assert.equal(existsSync(path.join(repositoryRoot, relative)), false, relative);

  const built = buildWakeflowAssetBundle({ sourceRoot });
  for (const [assetId, expectedDigest] of Object.entries(CURRENT_ASSET_DIGESTS)) {
    assert.equal(built.assets[assetId].sha256, expectedDigest, assetId);
  }
  const sourceModule = readFileSync(path.join(repositoryRoot, builderRelative));
  const sourceBundle = Buffer.from(`${JSON.stringify(built, null, 2)}\n`, "utf8");
  for (const host of ["codex-wakeflow", "claude-code-wakeflow"]) {
    assert.deepEqual(
      readFileSync(path.join(repositoryRoot, `plugins/${host}/scripts/lib/wakeflow-demand-document-builder.mjs`)),
      sourceModule,
      host,
    );
    assert.deepEqual(
      readFileSync(path.join(repositoryRoot, `plugins/${host}/templates/wakeflow-asset-bundle.json`)),
      sourceBundle,
      host,
    );
  }
});
