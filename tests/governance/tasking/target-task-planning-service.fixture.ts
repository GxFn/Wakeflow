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
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
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
  computeDemandIdentityDigest,
  createDemandIdentity,
  renderDemandIdentity,
} from "../../../src/governance/demand/model/demand-identity.js";
import {
  createConfirmationRecord,
  createRequirementRecord,
} from "../../../src/governance/ledger/ledger-authority-record.js";
import {
  createLedgerAuthorityMemberReference,
  LedgerAuthorityStore,
} from "../../../src/governance/ledger/ledger-authority-store.js";
import { parseTodoItemId } from "../../../src/governance/todo/todo-item-id.js";
import {
  appendTodoItem,
  claimTodoItem,
  initializeTodoCollection,
} from "../../../src/governance/todo/todo-collection-service.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { materializeWakeflowActiveLayout } from "../../../src/workspace/active/wakeflow-active-layout-materialization.js";
import type { TargetTaskPlanningPreviewRequest } from "../../../src/governance/tasking/target-task-planning-service.js";
import { createMinimalWakeflowConfigV3 } from "../../configuration/wakeflow-config-v3.fixture.js";

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
const REQUIREMENT_ID = parseWakeflowDurableIdOfKind(
  "requirement_33333333-3333-4333-8333-333333333333",
  "requirement",
);
const PLACEMENT_CONFIRMATION_ID = parseWakeflowDurableIdOfKind(
  "confirmation_34343434-3434-4434-8434-343434343434",
  "confirmation",
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
const TODO_ID = parseTodoItemId("TODO-TARGET-TASK-PLANNING");
const ROLES = [
  "code-facts",
  "landing-plan",
  "non-goals",
  "original-plan",
  "requirement-design",
  "user-confirmation",
] as const;

export const PLANNING_UUIDS = Object.freeze([
  "66666666-6666-4666-8666-666666666666",
  "77777777-7777-4777-8777-777777777777",
  "88888888-8888-4888-8888-888888888888",
  "99999999-9999-4999-8999-999999999999",
] as const);

export interface TargetTaskPlanningWorkspaceFixture {
  readonly fixtureRoot: string;
  readonly workspacePath: string;
  readonly workspaceRoot: RootedDirectory;
  readonly request: Readonly<TargetTaskPlanningPreviewRequest>;
}

export interface TargetTaskPlanningWorkspaceFixtureOptions {
  readonly testingMode?: Exclude<DemandTestingMode, "not-applicable">;
  readonly executionPlacement?: "main" | "isolated";
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
  const controllerWindow = config.topology.windows.find(
    (window) => window.role === "controller",
  );
  if (controllerWindow === undefined) {
    throw new Error("Expected Controller window fixture.");
  }
  writeFileSync(
    path.join(workspacePath, "wakeflow.config.json"),
    renderWakeflowConfigV3(config),
    { mode: 0o644 },
  );
  const workspaceRoot = await RootedDirectory.open(workspacePath);
  await materializeWakeflowActiveLayout(workspaceRoot, {
    recoveringFreshLayout: false,
  });
  await initializeTodoCollection(workspaceRoot, { freshWorkspace: true });
  const testingSummary =
    testingMode === "real-environment"
      ? "在已确认Test环境中运行真实场景验证"
      : "运行新增 TypeScript 聚焦测试";
  const appendedTodo = await appendTodoItem(
    workspaceRoot,
    {
      todoId: TODO_ID,
      initialStatus: "pending-claim",
      type: "requirement",
      priority: "P1",
      ownerWindowId: controllerWindow.windowId,
      goal: "建立一份可审计的 implementation TaskPackage",
      affectsRetestOrDispatch: false,
      dependency: null,
      recommendedWindowId: PLANNING_WINDOW_ID,
      autoClaim: true,
      testingDecision: {
        mode: testingMode,
        summary: testingSummary,
      },
      documents: [
        {
          label: "requirement",
          ref: `requirements/${REQUIREMENT_ID}/record.json`,
          anchor: null,
        },
      ],
    },
    { clock: () => PLANNING_RECORDED_AT },
  );

  const ledgerRoot = await RootedDirectory.open(ledgerPath);
  const ledgerStore = new LedgerAuthorityStore(ledgerRoot);
  await ledgerStore.initialize({ freshLedger: true });
  const roles: readonly ((typeof ROLES)[number] | "test-environment")[] =
    testingMode === "real-environment"
      ? Object.freeze([
          ...ROLES.slice(0, 5),
          "test-environment" as const,
          ROLES[5],
        ])
      : ROLES;
  const members = roles.map((role) => {
    const bytes = encodeUtf8(`# ${role}\n`);
    return {
      role,
      path: `authority/${role}.md`,
      mediaType: "text/markdown",
      digest: computeSha256Digest(bytes),
      bytes,
    };
  });
  const requirement = createRequirementRecord(
    {
      requirementId: REQUIREMENT_ID,
      programId: PLANNING_PROGRAM_ID,
      title: "Target Task Planning requirement",
      documents: members.map(({ bytes: _bytes, ...document }) => document),
    },
    { clock: () => PLANNING_RECORDED_AT },
  );
  const published = await ledgerStore.publish(
    requirement,
    members.map(({ path: memberPath, bytes }) => ({
      path: memberPath,
      bytes,
    })),
  );
  const requirementAuthorityRefs = published.loaded.documents.map((document) =>
    createLedgerAuthorityMemberReference(published.loaded, document.path),
  );
  let placementAuthority:
    ReturnType<typeof createLedgerAuthorityMemberReference> | undefined;
  if (executionPlacement === "isolated") {
    const placementBytes = encodeUtf8("# Explicit isolated placement\n");
    const placementPath = "decisions/isolated-placement.md";
    const confirmation = createConfirmationRecord(
      {
        confirmationId: PLACEMENT_CONFIRMATION_ID,
        programId: PLANNING_PROGRAM_ID,
        demandId: PLANNING_DEMAND_ID,
        title: "Authorize isolated execution placement",
        documents: [
          {
            role: "goal-stage-decision",
            path: placementPath,
            mediaType: "text/markdown",
            digest: computeSha256Digest(placementBytes),
          },
        ],
      },
      { clock: () => PLANNING_RECORDED_AT },
    );
    const publishedConfirmation = await ledgerStore.publish(confirmation, [
      { path: placementPath, bytes: placementBytes },
    ]);
    placementAuthority = createLedgerAuthorityMemberReference(
      publishedConfirmation.loaded,
      placementPath,
    );
  }
  const authorityRefs = Object.freeze([
    ...requirementAuthorityRefs,
    ...(placementAuthority === undefined ? [] : [placementAuthority]),
  ]);
  const environmentAuthority = authorityRefs.find(
    (reference) => reference.role === "test-environment",
  );
  if (
    testingMode === "real-environment" &&
    environmentAuthority === undefined
  ) {
    throw new Error("Expected real-environment authority member fixture.");
  }

  const identity = createDemandIdentity(
    {
      programId: PLANNING_PROGRAM_ID,
      demandId: PLANNING_DEMAND_ID,
      title: "Plan one target task",
      goal: "建立一份可审计的 implementation TaskPackage",
      completionDefinition: "事件提交并生成严格可重建投影",
      demandType: "requirement",
      source: appendedTodo.lineageRef,
      executionPlacement:
        placementAuthority === undefined
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
      environmentMemberRef: environmentAuthority?.memberRef ?? null,
    },
  });
  await claimTodoItem(
    workspaceRoot,
    {
      todoId: TODO_ID,
      intakeDigest: appendedTodo.item.intakeDigest,
      stateDigest: appendedTodo.item.stateDigest,
      mount: {
        demandId: PLANNING_DEMAND_ID,
        stateRootRef: demandFinalRootRef(PLANNING_DEMAND_ID),
        identityDigest: computeDemandIdentityDigest(identity),
      },
    },
    { clock: () => PLANNING_RECORDED_AT },
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

  return Object.freeze({
    fixtureRoot,
    workspacePath,
    workspaceRoot,
    request: Object.freeze({
      demandId: PLANNING_DEMAND_ID,
      taskPackage: Object.freeze({
        assignment: Object.freeze({
          repositoryId: PLANNING_REPOSITORY_ID,
          windowId: PLANNING_WINDOW_ID,
        }),
        workType: "implementation" as const,
        objective: "实现 Target Task Planning 公共垂直切片",
        confirmedContext: Object.freeze([
          "Demand Authority 已发布",
          "当前只规划任务，不执行 Delivery",
        ]) as readonly [string, ...string[]],
        selectedAuthorityMemberRefs: Object.freeze(
          authority.authorityRefs.map((reference) => reference.memberRef),
        ) as readonly [
          (typeof authority.authorityRefs)[number]["memberRef"],
          ...(typeof authority.authorityRefs)[number]["memberRef"][],
        ],
        boundaries: Object.freeze({
          inScope: Object.freeze([
            "追加 target-task-planned 事件",
          ]) as readonly [string, ...string[]],
          outOfScope: Object.freeze(["Delivery transport"]),
          forbidden: Object.freeze(["调用宿主发送能力"]),
        }),
        completionExpectations: Object.freeze([
          "Apply 可幂等重试",
          "TaskPackage 投影严格回读",
        ]) as readonly [string, ...string[]],
        commitExpectation: "leave-uncommitted" as const,
        acceptanceAnchors: Object.freeze([
          Object.freeze({
            anchorId: "planning-commit",
            claim: "Planning 只追加一条业务事件",
            probe: "审计 Event Store 并检查 stream revision",
            expected: "同一 plan 重试不增加事件",
          }),
        ]) as readonly [
          Readonly<{
            anchorId: string;
            claim: string;
            probe: string;
            expected: string;
          }>,
        ],
      }),
    }),
  });
}

export async function cleanupTargetTaskPlanningWorkspaceFixture(
  fixture: Readonly<TargetTaskPlanningWorkspaceFixture>,
): Promise<void> {
  await fixture.workspaceRoot.close();
  rmSync(fixture.fixtureRoot, { recursive: true, force: true });
}
