import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { parseWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3.js";
import { renderWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3-document.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { executeDemandEventSourcingCommand } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { DemandFileEventStore } from "../../../src/governance/demand/event-sourcing/demand-file-event-store.js";
import {
  computeDemandAuthorityDigest,
  createDemandAuthority,
  renderDemandAuthority,
  type DemandTestingMode,
} from "../../../src/governance/demand/model/demand-authority.js";
import {
  createDemandIdentity,
  renderDemandIdentity,
} from "../../../src/governance/demand/model/demand-identity.js";
import {
  createLedgerAuthorityMemberReference,
  LedgerAuthorityStore,
} from "../../../src/governance/ledger/ledger-authority-store.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { materializeWakeflowActiveLayout } from "../../../src/workspace/active/wakeflow-active-layout-materialization.js";
import type { WakeflowTargetTaskPlanningRequestV1 } from "../../../src/contracts/generated/entrypoints/wakeflow-target-task-planning-request.generated.js";
import {
  executeTargetTaskPlanningPublicRequest,
  type ExecuteTargetTaskPlanningOptions,
} from "../../../src/capabilities/tasking/service.js";
import type { TargetTaskPlanningResult } from "../../../src/capabilities/tasking/contract.js";
import { createMinimalWakeflowConfigV3 } from "../../configuration/wakeflow-config-v3.fixture.js";
import {
  claimFixtureRequirement,
  placePendingClaimState,
  requirementLineageOf,
} from "../demand/requirement-board.fixture.js";
import { publishFixtureRequirement } from "../ledger/requirement-package.fixture.js";

export const PLANNING_PROGRAM_ID = parseWakeflowDurableIdOfKind(
  "program_11111111-1111-4111-8111-111111111111",
  "program",
);
export const PLANNING_DEMAND_ID = parseWakeflowDurableIdOfKind(
  "demand_22222222-2222-4222-8222-222222222222",
  "demand",
);
export const PLANNING_REPOSITORY_ID = parseWakeflowDurableIdOfKind(
  "repository_22222222-2222-4222-8222-222222222222",
  "repository",
);
export const PLANNING_WINDOW_ID = parseWakeflowDurableIdOfKind(
  "window_88888888-8888-4888-8888-888888888888",
  "window",
);
export const PLANNING_REQUIREMENT_ID = parseWakeflowDurableIdOfKind(
  "requirement_33333333-3333-4333-8333-333333333333",
  "requirement",
);
const PUBLICATION_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_44444444-4444-4444-8444-444444444444",
  "demand-event",
);
const PUBLICATION_COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_55555555-5555-4555-8555-555555555555",
  "demand-event-commit",
);
export const PLANNING_RECORDED_AT = parseUtcInstant("2026-08-29T12:00:00.000Z");

export const PLANNING_UUIDS = Object.freeze([
  "66666666-6666-4666-8666-666666666666",
  "77777777-7777-4777-8777-777777777777",
  "88888888-8888-4888-8888-888888888888",
  "99999999-9999-4999-8999-999999999999",
] as const);

/** 切片请求里 Controller 拥有的部分：Demand 与任务包草稿；根、幂等键与修订由 `planFixtureTargetTask` 补。 */
export interface TargetTaskPlanningFixtureRequest {
  readonly demandId: string;
  readonly taskPackage: WakeflowTargetTaskPlanningRequestV1["taskPackage"];
}

export interface TargetTaskPlanningWorkspaceFixture {
  readonly fixtureRoot: string;
  readonly workspacePath: string;
  readonly workspaceRoot: RootedDirectory;
  /** 需求包记录摘要：验收锚点的 requirementRef 指向它。 */
  readonly recordDigest: string;
  readonly request: Readonly<TargetTaskPlanningFixtureRequest>;
}

export interface TargetTaskPlanningWorkspaceFixtureOptions {
  readonly testingMode?: Exclude<DemandTestingMode, "not-applicable">;
  readonly executionPlacement?: "main" | "isolated";
  /** 需求包头部的任务清单审阅要求；user 时切片要求请求带 planReview。 */
  readonly taskPlanReview?: "controller" | "user";
}

export function planningUuidFactory(): () => string {
  let index = 0;
  return () => {
    const value = PLANNING_UUIDS[index];
    index += 1;
    if (value === undefined) throw new Error("Unexpected UUID allocation.");
    return value;
  };
}

/**
 * 创建一份已发布并被 `PLANNING_DEMAND_ID` 认领的需求包、Demand 根与修订 1 事件流，
 * 供 tasking、delivery、review、lifecycle 等测试直接进入后续阶段。
 */
export async function createTargetTaskPlanningWorkspaceFixture(
  options: TargetTaskPlanningWorkspaceFixtureOptions = {},
): Promise<Readonly<TargetTaskPlanningWorkspaceFixture>> {
  const testingMode = options.testingMode ?? "controller-only";
  const executionPlacement = options.executionPlacement ?? "main";
  const fixtureRoot = mkdtempSync(
    path.join(os.tmpdir(), "wakeflow-target-task-planning-"),
  );
  const workspacePath = path.join(fixtureRoot, "Workspace");
  const ledgerPath = path.join(fixtureRoot, "wakeflow-ledger");
  const productPath = path.join(fixtureRoot, "ProductA");
  mkdirSync(workspacePath, { mode: 0o755 });
  mkdirSync(ledgerPath, { mode: 0o755 });
  mkdirSync(productPath, { mode: 0o755 });
  for (const relative of [".wakeflow-local", "Design", "Test"]) {
    mkdirSync(path.join(workspacePath, relative), { mode: 0o755 });
  }
  const config = parseWakeflowConfigV3(createMinimalWakeflowConfigV3());
  writeFileSync(
    path.join(workspacePath, "wakeflow.config.json"),
    renderWakeflowConfigV3(config),
    { mode: 0o644 },
  );
  const workspaceRoot = await RootedDirectory.open(workspacePath);
  await materializeWakeflowActiveLayout(workspaceRoot, {
    recoveringFreshLayout: false,
  });
  const testingSummary =
    testingMode === "real-environment"
      ? "在已确认Test环境中运行真实场景验证"
      : "运行新增 TypeScript 聚焦测试";

  const ledgerRoot = await RootedDirectory.open(ledgerPath);
  const ledgerStore = new LedgerAuthorityStore(ledgerRoot);
  await ledgerStore.initialize({ freshLedger: true });
  const loaded = await publishFixtureRequirement(ledgerStore, {
    requirementId: PLANNING_REQUIREMENT_ID,
    title: "Target Task Planning requirement",
    testingDecision: { mode: testingMode, summary: testingSummary },
    taskPlanReview: options.taskPlanReview ?? "controller",
  });
  const authorityRefs = Object.freeze(
    loaded.documents.map((document) =>
      createLedgerAuthorityMemberReference(loaded, document.path),
    ),
  );
  const placementAuthority = authorityRefs.find(
    (reference) => reference.role === "requirement",
  );
  if (placementAuthority === undefined) {
    throw new Error("Expected requirement member fixture.");
  }
  await placePendingClaimState(workspaceRoot, loaded);

  const identity = createDemandIdentity(
    {
      programId: PLANNING_PROGRAM_ID,
      demandId: PLANNING_DEMAND_ID,
      title: "Plan one target task",
      goal: "建立一份可审计的 implementation TaskPackage",
      completionDefinition: "事件提交并生成严格可重建投影",
      demandType: "requirement",
      source: requirementLineageOf(loaded),
      executionPlacement:
        executionPlacement === "main"
          ? { mode: "main" as const }
          : {
              mode: "isolated" as const,
              authorizationRef: placementAuthority,
            },
    },
    { clock: () => PLANNING_RECORDED_AT },
  );
  const authority = createDemandAuthority(identity, {
    authorityRefs,
    testingDecision: {
      mode: testingMode,
      summary: testingSummary,
      environmentMemberRef: null,
    },
  });
  await claimFixtureRequirement(
    workspaceRoot,
    PLANNING_REQUIREMENT_ID,
    PLANNING_DEMAND_ID,
    PLANNING_RECORDED_AT,
  );

  const demandRootPath = path.join(
    workspacePath,
    ...demandFinalRootRef(PLANNING_DEMAND_ID).split("/"),
  );
  mkdirSync(demandRootPath, { mode: 0o700 });
  chmodSync(demandRootPath, 0o700);
  const demandRoot = await RootedDirectory.open(demandRootPath);
  try {
    const eventStore = new DemandFileEventStore(demandRoot);
    await eventStore.initialize();
    mkdirSync(path.join(demandRootPath, "artifacts"), { mode: 0o700 });
    mkdirSync(path.join(demandRootPath, "artifacts", "task-packages"), {
      mode: 0o700,
    });
    mkdirSync(path.join(demandRootPath, "transactions"), { mode: 0o700 });
    writeFileSync(
      path.join(demandRootPath, "identity.json"),
      renderDemandIdentity(identity),
      { mode: 0o600 },
    );
    writeFileSync(
      path.join(demandRootPath, "authority.json"),
      renderDemandAuthority(authority),
      { mode: 0o600 },
    );
    const repository = new DemandEventSourcingRepository(demandRoot);
    const created = await executeDemandEventSourcingCommand(
      repository,
      {
        commandType: "publication.publish-demand",
        commandVersion: 1,
        demandId: PLANNING_DEMAND_ID,
        eventId: PUBLICATION_EVENT_ID,
        recordedAt: PLANNING_RECORDED_AT,
        identityDigest: authority.identityDigest,
        authorityDigest: computeDemandAuthorityDigest(authority),
      },
      {
        commitId: PUBLICATION_COMMIT_ID,
        expectedStreamRevision: 0,
      },
    );
    await repository.publishSnapshot(created.aggregate);
  } finally {
    await demandRoot.close();
    await ledgerRoot.close();
  }

  const memberRefs = authority.authorityRefs.map((reference) => reference.memberRef);
  const [firstMemberRef, ...otherMemberRefs] = memberRefs;
  if (firstMemberRef === undefined) throw new Error("Expected at least one authority member.");
  const taskPackage: WakeflowTargetTaskPlanningRequestV1["taskPackage"] = {
        assignment: {
          repositoryId: PLANNING_REPOSITORY_ID,
          windowId: PLANNING_WINDOW_ID,
        },
        workType: "implementation" as const,
        objective: "实现 Target Task Planning 公共垂直切片",
        confirmedContext: ["Demand Authority 已发布", "当前只规划任务，不执行 Delivery"],
        selectedAuthorityMemberRefs: [firstMemberRef, ...otherMemberRefs],
        boundaries: {
          inScope: ["追加 target-task-planned 事件"],
          outOfScope: ["Delivery transport"],
          forbidden: ["调用宿主发送能力"],
        },
        completionExpectations: ["Apply 可幂等重试", "TaskPackage 投影严格回读"],
        commitExpectation: "leave-uncommitted" as const,
        acceptanceAnchors: [
          {
            anchorId: "planning-commit",
            claim: "Planning 只追加一条业务事件",
            probe: "审计 Event Store 并检查 stream revision",
            expected: "同一 plan 重试不增加事件",
            requirementRef: {
              recordDigest: loaded.recordDigest,
              sectionAnchor: "acceptance-criteria",
              itemId: "ac-1",
            },
          },
        ],
        lineage: null,
        sectionAnchors: [],
  };
  return Object.freeze({
    fixtureRoot,
    workspacePath,
    workspaceRoot,
    recordDigest: loaded.recordDigest,
    request: Object.freeze({ demandId: PLANNING_DEMAND_ID, taskPackage }),
  });
}

/** 经切片追加一份任务包；同一 fixture 同一键重放得同一结果。 */
export async function planFixtureTargetTask(
  fixture: Readonly<{
    readonly workspacePath: string;
    readonly request: Readonly<TargetTaskPlanningFixtureRequest>;
  }>,
  overrides: Readonly<{
    readonly idempotencyKey?: string;
    readonly expectedStreamRevision?: number;
    readonly taskPackage?: WakeflowTargetTaskPlanningRequestV1["taskPackage"];
    readonly planReview?: { readonly confirmedAt: string };
  }> = {},
  options: ExecuteTargetTaskPlanningOptions = { clock: () => PLANNING_RECORDED_AT },
): Promise<TargetTaskPlanningResult> {
  return executeTargetTaskPlanningPublicRequest(
    {
      root: fixture.workspacePath,
      demandId: fixture.request.demandId,
      idempotencyKey: overrides.idempotencyKey ?? "fixture-plan-1",
      expectedStreamRevision: overrides.expectedStreamRevision ?? 1,
      taskPackage: overrides.taskPackage ?? fixture.request.taskPackage,
      ...(overrides.planReview === undefined ? {} : { planReview: overrides.planReview }),
    },
    options,
  );
}

export async function cleanupTargetTaskPlanningWorkspaceFixture(
  fixture: Readonly<TargetTaskPlanningWorkspaceFixture>,
): Promise<void> {
  await fixture.workspaceRoot.close();
  rmSync(fixture.fixtureRoot, { recursive: true, force: true });
}
