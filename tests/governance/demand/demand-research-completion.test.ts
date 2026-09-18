import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { executeDemandCompletionRequest } from "../../../src/capabilities/demand/lifecycle.js";
import { executeDemandCreationRequest } from "../../../src/capabilities/demand/service.js";
import { executeRecordEvidenceRequest } from "../../../src/capabilities/evidence/service.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { buildDemandControllerRoute } from "../../../src/governance/controller/demand-controller-route.js";
import {
  closeDemandOperationAuthorityContext,
  openDemandOperationAuthorityContext,
  type DemandOperationAuthorityContext,
} from "../../../src/governance/demand/demand-operation-authority-context.js";
import {
  demandWindowIds,
  evaluateVerifyGates,
  type VerifyReport,
} from "../../../src/governance/demand/demand-verify-gates.js";
import { executeDemandEventSourcingCommand } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import {
  completeDemandAggregateState,
  computeDemandAggregateStateDigest,
  createInitialDemandAggregateState,
  DemandAggregateStateError,
  type DemandAggregateState,
} from "../../../src/governance/demand/model/demand-aggregate-state.js";
import { requirementLineageRecordRef } from "../../../src/governance/demand/model/requirement-lineage.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { LedgerAuthorityStore } from "../../../src/governance/ledger/ledger-authority-store.js";
import {
  createDemandCompletion,
  type DemandCompletionTestingMode,
} from "../../../src/governance/lifecycle/demand-completion.js";
import { readDemandPostAcceptanceRoute } from "../../../src/governance/review/demand-post-acceptance-route.js";
import { readDemandResultReviewSnapshot } from "../../../src/governance/review/demand-result-review-snapshot.js";
import { createTaskPackage } from "../../../src/governance/tasking/task-package.js";
import { deriveNextProjection } from "../../../src/kernel/next-projection.js";
import { readRequirementClaimState } from "../../../src/kernel/requirement-board.js";
import { publishFixtureRequirement } from "../ledger/requirement-package.fixture.js";
import {
  cleanupTargetTaskPlanningWorkspaceFixture,
  createTargetTaskPlanningWorkspaceFixture,
  PLANNING_REQUIREMENT_ID,
} from "../tasking/target-task-planning-service.fixture.js";
import {
  TASKING_AUTHORITY_DIGEST,
  TASKING_DEMAND_ID,
  taskPackageDraft,
} from "../tasking/task-package.fixture.js";
import {
  cleanupTestTaskPlanningWorkspaceFixture,
  createTestTaskPlanningWorkspaceFixture,
  planFixtureTestTask,
} from "../tasking/test-task-planning.fixture.js";
import {
  cleanupDemandEventSourcingPublicationWorkspaceFixture,
  createDemandEventSourcingPublicationWorkspaceFixture,
  type DemandEventSourcingPublicationWorkspaceFixture,
} from "./demand-event-sourcing-publication-service.fixture.js";
import { placePendingClaimState } from "./requirement-board.fixture.js";

/**
 * research Demand 的完成路径（gate-log §13.94 D8）：完成物是 document 类受管证据。
 * 没有证据：post-acceptance 路由 `not-ready / research-evidence-missing`，Controller 路由
 * `blocked` 加 `research-evidence-missing`；有证据：`completion-preflight{not-applicable}`、
 * `work-available`，内核前沿表把 `research-completion-required` 交给 Controller 的
 * `wakeflow_complete_demand`。verify 只对 research 加 `research-evidence` 门；聚合完成对
 * `not-applicable` 允许零实现目标。全系统不再有 not-implemented 阻塞项。
 */

const RESEARCH_REQUIREMENT_ID = parseWakeflowDurableIdOfKind(
  "requirement_5e5e5e5e-5e5e-45e5-85e5-5e5e5e5e5e5e",
  "requirement",
);
const DESIGN_SURFACE_ID = "surface_33333333-3333-4333-8333-333333333333";
const REPOSITORY_ID = parseWakeflowDurableIdOfKind(
  "repository_22222222-2222-4222-8222-222222222222",
  "repository",
);
const PRODUCT_WINDOW_ID = parseWakeflowDurableIdOfKind(
  "window_88888888-8888-4888-8888-888888888888",
  "window",
);
const CONTROLLER_WINDOW_ID = parseWakeflowDurableIdOfKind(
  "window_55555555-5555-4555-8555-555555555555",
  "window",
);
const PROGRAM_ID = parseWakeflowDurableIdOfKind(
  "program_11111111-1111-4111-8111-111111111111",
  "program",
);
const PLAN_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_6f6f6f6f-6f6f-46f6-86f6-6f6f6f6f6f6f",
  "demand-event",
);
const PLAN_COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_7a7a7a7a-7a7a-47a7-87a7-7a7a7a7a7a7a",
  "demand-event-commit",
);
const RECORDED_AT = parseUtcInstant("2026-09-18T09:00:00.000Z");
const CLOCK = { clock: () => RECORDED_AT };
const RESEARCH_FRONTIER = Object.freeze({
  scope: "demand",
  kind: "research-completion-required",
  owner: "demand-lifecycle",
});
const RESEARCH_BLOCKER = Object.freeze({
  kind: "research-evidence-missing",
  owner: "demand-lifecycle",
});
/** demand 切片八门里 payload-privacy 只在完成路径扫描；这里 `payloadBlockers: null`，所以是七门加 research。 */
const BASE_GATES = Object.freeze([
  "config-authority",
  "ledger-layout",
  "demand-root-audit",
  "board-claim",
  "work-claims-released",
  "append-candidates-clear",
  "evidence-integrity",
]);

interface ResearchDemandFixture {
  readonly publication: Readonly<DemandEventSourcingPublicationWorkspaceFixture>;
  readonly root: string;
  readonly workspaceRoot: RootedDirectory;
  readonly demandId: string;
}

/** 一份 research 类需求包（testingDecision not-applicable）经公共 create_demand 认领成 Demand。 */
async function createResearchDemandFixture(t: TestContext): Promise<ResearchDemandFixture> {
  const publication = await createDemandEventSourcingPublicationWorkspaceFixture();
  t.after(() => cleanupDemandEventSourcingPublicationWorkspaceFixture(publication));
  const ledgerRoot = await RootedDirectory.open(publication.ledgerPath);
  try {
    const loaded = await publishFixtureRequirement(new LedgerAuthorityStore(ledgerRoot), {
      requirementId: RESEARCH_REQUIREMENT_ID,
      title: "研究：证据通道的可行性",
      demandType: "research",
      testingDecision: { mode: "not-applicable", summary: "研究不测；完成物是 document 类证据。" },
    });
    await placePendingClaimState(publication.workspaceRoot, loaded);
  } finally {
    await ledgerRoot.close();
  }
  const request = {
    root: publication.workspacePath,
    requirementId: RESEARCH_REQUIREMENT_ID,
    demand: {
      title: "Research the evidence channel",
      goal: "判断 hook 证据通道能否支撑 L2 退出门",
      completionDefinition: "一份 document 类受管证据记录结论",
    },
  };
  const preview = await executeDemandCreationRequest({ ...request, mode: "preview" }, CLOCK);
  if (preview.kind !== "WakeflowDemandCreationPreview" || preview.planDigest === null) {
    throw new Error(`Expected a ready research Demand plan: ${JSON.stringify(preview)}`);
  }
  const created = await executeDemandCreationRequest(
    { ...request, mode: "apply", planDigest: preview.planDigest },
    CLOCK,
  );
  if (created.kind !== "WakeflowDemandCreationMutation") {
    throw new Error("Expected a research Demand creation mutation.");
  }
  const findings = path.join(publication.workspacePath, "Design", "research");
  mkdirSync(findings, { recursive: true, mode: 0o755 });
  writeFileSync(
    path.join(findings, "findings.md"),
    "# 研究结论\n\n证据通道可行：hook 记录可投影为受管证据。\n",
    { mode: 0o644 },
  );
  return Object.freeze({
    publication,
    root: publication.workspacePath,
    workspaceRoot: publication.workspaceRoot,
    demandId: created.publication.demandId,
  });
}

/** 经公共 record_evidence 记录一条 document 类证据（Design 支撑面上的 markdown）。 */
async function recordDocumentEvidence(fixture: ResearchDemandFixture) {
  const selection = {
    kind: "document",
    source: {
      kind: "managed-path",
      root: { kind: "support-surface", surfaceId: DESIGN_SURFACE_ID },
      path: "research/findings.md",
      resourceType: "file",
    },
    contentReview: "reject",
  };
  const base = { root: fixture.root, demandId: fixture.demandId, selection };
  const previewed = await executeRecordEvidenceRequest({ ...base, mode: "preview" }, CLOCK);
  if (previewed.kind !== "WakeflowRecordEvidencePreview" || previewed.planDigest === null) {
    throw new Error(`Expected a ready evidence plan: ${JSON.stringify(previewed)}`);
  }
  const recorded = await executeRecordEvidenceRequest(
    { ...base, mode: "apply", planDigest: previewed.planDigest },
    CLOCK,
  );
  if (recorded.kind !== "WakeflowRecordEvidenceMutation") {
    throw new Error("Expected an evidence mutation.");
  }
  return recorded;
}

async function withAuthorityContext<Result>(
  workspaceRoot: RootedDirectory,
  demandId: string,
  use: (context: Readonly<DemandOperationAuthorityContext>) => Promise<Result>,
): Promise<Result> {
  const context = await openDemandOperationAuthorityContext(
    workspaceRoot,
    parseWakeflowDurableIdOfKind(demandId, "demand"),
    undefined,
  );
  try {
    return await use(context);
  } finally {
    await closeDemandOperationAuthorityContext(context);
  }
}

async function readControllerRoute(workspaceRoot: RootedDirectory, demandId: string) {
  return withAuthorityContext(workspaceRoot, demandId, async (context) =>
    buildDemandControllerRoute(context.loaded, await readDemandResultReviewSnapshot(context.demandRoot)),
  );
}

/** 与完成路径同一份门集合，但不扫描负载（`payloadBlockers: null`）。 */
async function readVerifyGates(
  workspaceRoot: RootedDirectory,
  demandId: string,
  requirementId: string,
): Promise<VerifyReport> {
  return withAuthorityContext(workspaceRoot, demandId, async (context) =>
    evaluateVerifyGates({
      workspaceRoot,
      ledgerRoot: context.ledgerRoot,
      snapshot: context.config,
      demandRoot: context.demandRoot,
      loaded: context.loaded,
      claim: await readRequirementClaimState(workspaceRoot, requirementId),
      windowIds: demandWindowIds(context.loaded.aggregate.state),
      payloadBlockers: null,
      signal: undefined,
    }),
  );
}

async function previewCompletion(fixture: ResearchDemandFixture) {
  const preview = await executeDemandCompletionRequest({
    root: fixture.root,
    mode: "preview",
    demandId: fixture.demandId,
  });
  if (preview.kind !== "WakeflowDemandCompletionPreview") throw new Error("Expected a preview.");
  return preview;
}

function demandRootPath(fixture: ResearchDemandFixture): string {
  return path.join(fixture.root, ...demandFinalRootRef(fixture.demandId).split("/"));
}

/** 归档负载里所有文件的文本：用来断言终态事件带的 testingMode。 */
function archivePayloadTexts(directory: string): readonly string[] {
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .map((entry) => path.join(directory, entry))
    .filter((entry) => statSync(entry).isFile())
    .map((entry) => readFileSync(entry, "utf8"));
}

test("research Demand 路由：无 document 证据为 not-ready/research-evidence-missing 与 blocked；有证据后 completion-preflight{not-applicable} 与 work-available，内核投影指向 wakeflow_complete_demand", async (t) => {
  const fixture = await createResearchDemandFixture(t);

  const missing = await readDemandPostAcceptanceRoute(fixture.workspaceRoot, fixture.demandId);
  equal(missing.demandType, "research");
  equal(missing.testingDecision.mode, "not-applicable");
  equal(missing.nextStage.status, "not-ready");
  if (missing.nextStage.status !== "not-ready") throw new Error("Expected not-ready.");
  equal(missing.nextStage.reason, "research-evidence-missing");
  deepEqual(missing.nextStage.blockingTargets, []);
  deepEqual(missing.acceptedTargets, []);

  const blocked = await readControllerRoute(fixture.workspaceRoot, fixture.demandId);
  equal(blocked.disposition, "blocked");
  deepEqual(blocked.frontiers, [RESEARCH_FRONTIER]);
  deepEqual(blocked.blockers, [RESEARCH_BLOCKER]);
  equal(JSON.stringify(blocked).includes("not-implemented"), false);
  deepEqual(deriveNextProjection(blocked), {
    frontier: "research-completion-required",
    owner: "controller",
    suggestedTool: null,
    blockers: ["research-evidence-missing"],
  });

  const recorded = await recordDocumentEvidence(fixture);
  equal(recorded.disposition, "recorded");
  equal(recorded.publication?.kind, "document");

  const present = await readDemandPostAcceptanceRoute(fixture.workspaceRoot, fixture.demandId);
  equal(present.nextStage.status, "completion-preflight");
  if (present.nextStage.status !== "completion-preflight") throw new Error("Expected preflight.");
  deepEqual(present.nextStage.testingClosure, { mode: "not-applicable" });
  deepEqual(present.acceptedTargets, []);

  const available = await readControllerRoute(fixture.workspaceRoot, fixture.demandId);
  equal(available.disposition, "work-available");
  deepEqual(available.frontiers, [RESEARCH_FRONTIER]);
  deepEqual(available.blockers, []);
  deepEqual(deriveNextProjection(available), {
    frontier: "research-completion-required",
    owner: "controller",
    suggestedTool: "wakeflow_complete_demand",
    blockers: [],
  });
});

test("research Demand 带未接受的实现目标：证据在场也先 targets-not-accepted，完成预检被路由阻塞", async (t) => {
  const fixture = await createResearchDemandFixture(t);
  await recordDocumentEvidence(fixture);

  // 不变量：路由与聚合完成对"每个未被替代的实现目标都已接受"的要求一致，research 也不例外。
  // tasking 切片拒绝给 research Demand 规划实现包（research-demand-has-no-implementation），
  // 该状态只在治理层可达：经命令处理器直接追加一个 planned 实现目标。
  const facts = await withAuthorityContext(fixture.workspaceRoot, fixture.demandId, async (context) =>
    Object.freeze({
      programId: context.loaded.identity.programId,
      configDigest: context.config.configDigest,
      authorityDigest: context.loaded.authorityDigest,
      authorityRefs: context.loaded.authority.authorityRefs,
      recordDigest: context.loaded.identity.source.recordDigest,
      streamRevision: context.loaded.aggregate.streamRevision,
    }),
  );
  const draft = taskPackageDraft();
  const taskPackage = createTaskPackage(
    {
      ...draft,
      programId: facts.programId,
      configDigest: facts.configDigest,
      demandId: fixture.demandId,
      demandAuthorityDigest: facts.authorityDigest,
      assignment: { repositoryId: REPOSITORY_ID, windowId: PRODUCT_WINDOW_ID },
      selectedAuthorityRefs: facts.authorityRefs,
      acceptanceAnchors: draft.acceptanceAnchors.map((anchor) => ({
        ...anchor,
        requirementRef: { ...anchor.requirementRef, recordDigest: facts.recordDigest },
      })),
    },
    CLOCK,
  );
  const demandRoot = await RootedDirectory.open(demandRootPath(fixture));
  try {
    await executeDemandEventSourcingCommand(
      new DemandEventSourcingRepository(demandRoot),
      { commandType: "tasking.plan-target-task", commandVersion: 1, eventId: PLAN_EVENT_ID, taskPackage },
      { commitId: PLAN_COMMIT_ID, expectedStreamRevision: facts.streamRevision },
    );
  } finally {
    await demandRoot.close();
  }

  const route = await readDemandPostAcceptanceRoute(fixture.workspaceRoot, fixture.demandId);
  equal(route.nextStage.status, "not-ready");
  if (route.nextStage.status !== "not-ready") throw new Error("Expected not-ready.");
  equal(route.nextStage.reason, "targets-not-accepted");
  equal(route.nextStage.blockingTargets.length, 1);
  equal(route.nextStage.blockingTargets[0]?.targetTaskId, taskPackage.targetTaskId);
  equal(route.nextStage.blockingTargets[0]?.phase, "planned");

  const controller = await readControllerRoute(fixture.workspaceRoot, fixture.demandId);
  equal(controller.disposition, "work-available");
  equal(controller.frontiers[0]?.kind, "implementation-delivery-planning");
  deepEqual(controller.blockers, []);

  const preview = await previewCompletion(fixture);
  equal(preview.status, "blocked");
  ok(preview.blockers.includes("route:not-ready"), preview.blockers.join(","));
});

test("verify 门：research Demand 加 research-evidence（无 document 证据 fail、有则 pass），完成预检随之从 blocked 到 ready", async (t) => {
  const fixture = await createResearchDemandFixture(t);

  const missing = await readVerifyGates(fixture.workspaceRoot, fixture.demandId, RESEARCH_REQUIREMENT_ID);
  deepEqual(missing.gates.map((gate) => gate.gate), [...BASE_GATES, "research-evidence"]);
  deepEqual(missing.gates.at(-1), {
    gate: "research-evidence",
    status: "fail",
    detail: "document-evidence-missing",
  });
  const blocked = await previewCompletion(fixture);
  equal(blocked.status, "blocked");
  ok(blocked.blockers.includes("route:not-ready"), blocked.blockers.join(","));
  ok(blocked.blockers.includes("verify:research-evidence:fail"), blocked.blockers.join(","));

  await recordDocumentEvidence(fixture);
  const present = await readVerifyGates(fixture.workspaceRoot, fixture.demandId, RESEARCH_REQUIREMENT_ID);
  deepEqual(present.gates.at(-1), { gate: "research-evidence", status: "pass", detail: null });
  equal(
    present.gates.every((gate) => gate.status === "pass"),
    true,
    present.gates.map((gate) => `${gate.gate}:${gate.status}`).join(","),
  );
  equal(present.observationDigest === missing.observationDigest, false);

  const ready = await previewCompletion(fixture);
  equal(ready.status, "ready", ready.blockers.join(","));
  equal(ready.planDigest === null, false);
  equal(ready.verify?.gates.find((gate) => gate.gate === "research-evidence")?.status, "pass");
});

test("verify 门：非 research Demand 不设 research-evidence 门", async (t) => {
  const fixture = await createTargetTaskPlanningWorkspaceFixture();
  t.after(() => cleanupTargetTaskPlanningWorkspaceFixture(fixture));
  const report = await readVerifyGates(
    fixture.workspaceRoot,
    fixture.request.demandId,
    PLANNING_REQUIREMENT_ID,
  );
  deepEqual(report.gates.map((gate) => gate.gate), [...BASE_GATES]);
});

test("research Demand 完成：有 document 证据即完成并归档，终态记 not-applicable，归档 verify 报告带 research-evidence 门", async (t) => {
  const fixture = await createResearchDemandFixture(t);
  await recordDocumentEvidence(fixture);
  const preview = await previewCompletion(fixture);
  if (preview.planDigest === null) throw new Error(preview.blockers.join(","));

  const completed = await executeDemandCompletionRequest({
    root: fixture.root,
    mode: "apply",
    demandId: fixture.demandId,
    planDigest: preview.planDigest,
  });
  if (completed.kind !== "WakeflowDemandCompletionMutation") throw new Error("Expected a mutation.");
  equal(completed.disposition, "completed");
  equal(completed.package.status, "archived");
  equal(completed.releasedClaims, 0);
  equal(completed.next.frontier, "demand-continuation");
  equal(existsSync(demandRootPath(fixture)), false, "active root survived");
  const claim = await readRequirementClaimState(fixture.workspaceRoot, RESEARCH_REQUIREMENT_ID);
  equal(claim?.state.status, "archived");
  equal(claim?.state.archive?.demandId, fixture.demandId);

  const archiveDirectory = path.join(
    fixture.publication.ledgerPath,
    ...completed.archive.archiveRef.split("/"),
  );
  const report = JSON.parse(readFileSync(path.join(archiveDirectory, "verify-report.json"), "utf8")) as {
    readonly gates: readonly { readonly gate: string; readonly status: string }[];
  };
  ok(
    report.gates.some((gate) => gate.gate === "research-evidence" && gate.status === "pass"),
    "archived verify report must carry the research-evidence gate",
  );
  const payloadTexts = archivePayloadTexts(path.join(archiveDirectory, "payload"));
  ok(
    payloadTexts.some((text) => /"testingMode":\s*"not-applicable"/u.test(text)),
    "archived event stream must carry the not-applicable completion",
  );
});

// ---- 聚合完成（纯状态转换）------------------------------------------------------

function completionFor(
  state: Readonly<DemandAggregateState>,
  testingMode: DemandCompletionTestingMode,
  streamRevision = 1,
) {
  return createDemandCompletion(
    {
      controllerWindowId: CONTROLLER_WINDOW_ID,
      routeSource: {
        status: "completion-preflight",
        testingClosure: { mode: testingMode },
        programId: PROGRAM_ID,
        demandId: state.demandId,
        authorityDigest: state.authorityDigest,
        routeDigest: parseSha256Digest(`sha256:${"1".repeat(64)}`),
        reviewSnapshotDigest: parseSha256Digest(`sha256:${"2".repeat(64)}`),
        observedState: {
          streamRevision,
          stateDigest: computeDemandAggregateStateDigest(state),
          lastEventId: PLAN_EVENT_ID,
          lastEventDigest: parseSha256Digest(`sha256:${"3".repeat(64)}`),
        },
      },
      packageSource: {
        requirementId: RESEARCH_REQUIREMENT_ID,
        recordRef: requirementLineageRecordRef(RESEARCH_REQUIREMENT_ID),
        recordDigest: parseSha256Digest(`sha256:${"4".repeat(64)}`),
        claimStateRevision: 2,
        claimStateDigest: parseSha256Digest(`sha256:${"5".repeat(64)}`),
      },
    },
    CLOCK,
  );
}

const transitionRejected = (error: unknown) =>
  error instanceof DemandAggregateStateError && error.reason === "transition";

test("聚合完成：not-applicable 允许零实现目标进入 completed（§13.94 D8）", () => {
  const initial = createInitialDemandAggregateState(TASKING_DEMAND_ID, TASKING_AUTHORITY_DIGEST);
  const completed = completeDemandAggregateState(initial, completionFor(initial, "not-applicable"));
  equal(completed.lifecycle, "completed");
  deepEqual(completed.targetTasks, []);
});

test("聚合完成：controller-only 零实现目标仍被拒（规则不变）", () => {
  const initial = createInitialDemandAggregateState(TASKING_DEMAND_ID, TASKING_AUTHORITY_DIGEST);
  throws(
    () => completeDemandAggregateState(initial, completionFor(initial, "controller-only")),
    transitionRejected,
  );
  throws(
    () => completeDemandAggregateState(initial, completionFor(initial, "real-environment")),
    transitionRejected,
  );
});

test("聚合完成：存在 test 目标时 not-applicable 被拒，测试环节不能用 research 闭合绕过", async () => {
  // 未终结的 test 目标只能站在已接受的实现基线上，所以用真实夹具造出该状态。
  const fixture = await createTestTaskPlanningWorkspaceFixture();
  try {
    const planned = await planFixtureTestTask(fixture, 7);
    equal(planned.status, "committed");
    const demandRoot = await RootedDirectory.open(
      path.join(fixture.workspacePath, ...demandFinalRootRef(fixture.demandId).split("/")),
    );
    try {
      const audited = await new DemandEventSourcingRepository(demandRoot).audit();
      const state = audited.aggregate.state;
      equal(state.targetTasks.some((target) => target.workType === "test"), true);
      throws(
        () =>
          completeDemandAggregateState(
            state,
            completionFor(state, "not-applicable", audited.aggregate.streamRevision),
          ),
        transitionRejected,
      );
    } finally {
      await demandRoot.close();
    }
  } finally {
    await cleanupTestTaskPlanningWorkspaceFixture(fixture);
  }
});
