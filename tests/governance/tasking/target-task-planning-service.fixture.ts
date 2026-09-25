import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { parseWakeflowConfig } from "../../../src/configuration/wakeflow-config.js";
import { renderWakeflowConfig } from "../../../src/configuration/wakeflow-config-document.js";
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
import { materializeActiveLayout } from "../../../src/kernel/active-projection.js";
import type { WakeflowTargetTaskPlanningRequestV1 } from "../../../src/contracts/generated/entrypoints/wakeflow-target-task-planning-request.generated.js";
import {
  executeTargetTaskPlanningPublicRequest,
  type ExecuteTargetTaskPlanningOptions,
} from "../../../src/capabilities/tasking/service.js";
import type { TargetTaskPlanningResult } from "../../../src/capabilities/tasking/contract.js";
import { createMinimalWakeflowConfig } from "../../configuration/wakeflow-config.fixture.js";
import {
  createPreparedWorkspaceStore,
  DISPOSABLE_ROOT_OPTIONS,
  DISPOSABLE_WORKSPACE_DURABILITY,
} from "../../support/prepared-workspace.js";
import {
  claimFixtureRequirement,
  placePendingClaimState,
  requirementLineageOf,
} from "../demand/requirement-board.fixture.js";
import { fixtureDocuments, publishFixtureRequirement } from "../ledger/requirement-package.fixture.js";

export const PLANNING_PROGRAM_ID = parseWakeflowDurableIdOfKind(
  "program_11111111-1111-4111-8111-111111111111",
  "program",
);
export const PLANNING_DEMAND_ID = parseWakeflowDurableIdOfKind(
  "demand_22222222-2222-4222-8222-222222222222",
  "demand",
);
/** 最小配置夹具里 fresh-initialize 生成的 primary pod。 */
export const PLANNING_POD_ID = parseWakeflowDurableIdOfKind(
  "pod_99999999-9999-4999-8999-999999999999",
  "pod",
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
  /** 需求包头部的任务清单审阅要求；user 时切片要求请求带 planReview。 */
  readonly taskPlanReview?: "controller" | "user";
  /**
   * 退出共享预备基线，重跑一遍初始化链。需要不同拓扑（例如另行改写基线里的文件）
   * 的测试用它，其余测试共享按 `testingMode` / `taskPlanReview` 分档的基线副本。
   */
  readonly freshBaseline?: boolean;
  /**
   * 替换需求包的 requirement.md 正文（例如追加自定义 Unicode 章节）。给出时退出共享
   * 基线，保证这份正文真的被发布进需求包记录。
   */
  readonly requirementMarkdown?: string;
}

/** 基线里与路径无关的事实：同一档基线的所有副本共享同一份身份值与记录摘要。 */
export interface TargetTaskPlanningWorkspaceFacts {
  readonly recordDigest: string;
  readonly taskPackage: WakeflowTargetTaskPlanningRequestV1["taskPackage"];
}

/** 共享基线分档：同档选项共用一棵预备工作区；`freshBaseline` 退出共享。 */
export function targetTaskPlanningWorkspaceBaselineKey(
  options: TargetTaskPlanningWorkspaceFixtureOptions,
): string | null {
  if (options.freshBaseline === true || options.requirementMarkdown !== undefined) return null;
  return `${options.testingMode ?? "controller-only"}|${options.taskPlanReview ?? "controller"}`;
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
 * 在一个空目录里建出已发布并被 `PLANNING_DEMAND_ID` 认领的需求包、Demand 根与修订 1
 * 事件流。这是共享预备基线的初始化链；测试拿到的是它的副本。
 */
async function buildTargetTaskPlanningWorkspace(
  fixtureRoot: string,
  options: TargetTaskPlanningWorkspaceFixtureOptions,
): Promise<Readonly<TargetTaskPlanningWorkspaceFacts>> {
  const testingMode = options.testingMode ?? "controller-only";
  const workspacePath = path.join(fixtureRoot, "Workspace");
  const ledgerPath = path.join(fixtureRoot, "wakeflow-ledger");
  const productPath = path.join(fixtureRoot, "ProductA");
  mkdirSync(workspacePath, { mode: 0o755 });
  mkdirSync(ledgerPath, { mode: 0o755 });
  mkdirSync(productPath, { mode: 0o755 });
  for (const relative of [".wakeflow-local", "Design", "Test"]) {
    mkdirSync(path.join(workspacePath, relative), { mode: 0o755 });
  }
  const config = parseWakeflowConfig(createMinimalWakeflowConfig());
  writeFileSync(
    path.join(workspacePath, "wakeflow.config.json"),
    renderWakeflowConfig(config),
    { mode: 0o644 },
  );
  const workspaceRoot = await RootedDirectory.open(
    workspacePath,
    "$root",
    DISPOSABLE_ROOT_OPTIONS,
  );
  await materializeActiveLayout(workspaceRoot, { recovering: false });
  const testingSummary =
    testingMode === "real-environment"
      ? "在已确认Test环境中运行真实场景验证"
      : "运行新增 TypeScript 聚焦测试";

  const ledgerRoot = await RootedDirectory.open(ledgerPath, "$root", DISPOSABLE_ROOT_OPTIONS);
  const ledgerStore = new LedgerAuthorityStore(ledgerRoot);
  await ledgerStore.initialize({ freshLedger: true });
  const loaded = await publishFixtureRequirement(
    ledgerStore,
    {
      requirementId: PLANNING_REQUIREMENT_ID,
      title: "Target Task Planning requirement",
      testingDecision: { mode: testingMode, summary: testingSummary },
      taskPlanReview: options.taskPlanReview ?? "controller",
    },
    options.requirementMarkdown === undefined
      ? undefined
      : fixtureDocuments({ requirement: options.requirementMarkdown }),
  );
  const authorityRefs = Object.freeze(
    loaded.documents.map((document) =>
      createLedgerAuthorityMemberReference(loaded, document.path),
    ),
  );
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
      podId: PLANNING_POD_ID,
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
  const demandRoot = await RootedDirectory.open(
    demandRootPath,
    "$root",
    DISPOSABLE_ROOT_OPTIONS,
  );
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
  await workspaceRoot.close();
  return Object.freeze({ recordDigest: loaded.recordDigest, taskPackage });
}

const targetTaskPlanningWorkspaceStore = createPreparedWorkspaceStore<
  TargetTaskPlanningWorkspaceFixtureOptions,
  Readonly<TargetTaskPlanningWorkspaceFacts>
>({
  prefix: "wakeflow-target-task-planning-",
  keyOf: targetTaskPlanningWorkspaceBaselineKey,
  build: buildTargetTaskPlanningWorkspace,
});

/** 把一棵已建好（或刚复制好）的工作区树打开成夹具。 */
export async function openTargetTaskPlanningWorkspaceFixture(
  fixtureRoot: string,
  facts: Readonly<TargetTaskPlanningWorkspaceFacts>,
): Promise<Readonly<TargetTaskPlanningWorkspaceFixture>> {
  const workspacePath = path.join(fixtureRoot, "Workspace");
  return Object.freeze({
    fixtureRoot,
    workspacePath,
    workspaceRoot: await RootedDirectory.open(workspacePath, "$root", DISPOSABLE_ROOT_OPTIONS),
    recordDigest: facts.recordDigest,
    request: Object.freeze({ demandId: PLANNING_DEMAND_ID, taskPackage: facts.taskPackage }),
  });
}

/**
 * 创建一份已发布并被 `PLANNING_DEMAND_ID` 认领的需求包、Demand 根与修订 1 事件流，
 * 供 tasking、delivery、review、lifecycle 等测试直接进入后续阶段。
 *
 * 同一测试进程里同档选项只初始化一次，之后每次调用复制一份隔离副本；因此同档副本的
 * `recordDigest` 与任务包草稿是同一组稳定值（它们本来就由固定输入决定）。
 */
export async function createTargetTaskPlanningWorkspaceFixture(
  options: TargetTaskPlanningWorkspaceFixtureOptions = {},
): Promise<Readonly<TargetTaskPlanningWorkspaceFixture>> {
  const prepared = await targetTaskPlanningWorkspaceStore.materialize(options);
  return openTargetTaskPlanningWorkspaceFixture(prepared.fixtureRoot, prepared.facts);
}

/** 供更上层基线在本基线之上继续初始化：复制进已存在的目录并打开。 */
export async function materializeTargetTaskPlanningWorkspaceFixture(
  fixtureRoot: string,
  options: TargetTaskPlanningWorkspaceFixtureOptions,
): Promise<Readonly<TargetTaskPlanningWorkspaceFixture>> {
  const facts = await targetTaskPlanningWorkspaceStore.materializeInto(fixtureRoot, options);
  return openTargetTaskPlanningWorkspaceFixture(fixtureRoot, facts);
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
    // 一次性工作区：调用方仍可显式覆盖级别，但默认不为将被删掉的目录付 fsync。
    { durability: DISPOSABLE_WORKSPACE_DURABILITY, ...options },
  );
}

export async function cleanupTargetTaskPlanningWorkspaceFixture(
  fixture: Readonly<TargetTaskPlanningWorkspaceFixture>,
): Promise<void> {
  await fixture.workspaceRoot.close();
  rmSync(fixture.fixtureRoot, { recursive: true, force: true });
}
