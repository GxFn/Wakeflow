import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { parseWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3.js";
import { renderWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3-document.js";
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  createConfirmationRecord,
  createRequirementRecord,
} from "../../../src/governance/ledger/ledger-authority-record.js";
import {
  createLedgerAuthorityMemberReference,
  LedgerAuthorityStore,
} from "../../../src/governance/ledger/ledger-authority-store.js";
import {
  appendTodoItem,
  initializeTodoCollection,
} from "../../../src/governance/todo/todo-collection-service.js";
import { parseTodoItemId } from "../../../src/governance/todo/todo-item-id.js";
import { materializeWakeflowActiveLayout } from "../../../src/workspace/active/wakeflow-active-layout-materialization.js";
import { createMinimalWakeflowConfigV3 } from "../../configuration/wakeflow-config-v3.fixture.js";
import { todoIntakeDraft } from "../todo/todo-intake.fixture.js";

export const PUBLICATION_TODO_ID = parseTodoItemId(
  "todo_88340ce6-2c27-4cb8-83bb-86f46b74d5b1",
);
export const PUBLICATION_REQUIREMENT_ID =
  "requirement_33333333-3333-4333-8333-333333333333";
export const PUBLICATION_CONFIRMATION_A_ID =
  "confirmation_44444444-4444-4444-8444-444444444444";
export const PUBLICATION_CONFIRMATION_B_ID =
  "confirmation_55555555-5555-4555-8555-555555555555";
export const PUBLICATION_CONFIRMATION_DEMAND_A =
  "demand_66666666-6666-4666-8666-666666666666";
export const PUBLICATION_CONFIRMATION_DEMAND_B =
  "demand_77777777-7777-4777-8777-777777777777";
export const PUBLICATION_RECORDED_AT = parseUtcInstant(
  "2026-09-01T12:00:00.000Z",
);
export const PUBLICATION_REQUIRED_ROLES = [
  "code-facts",
  "landing-plan",
  "non-goals",
  "original-plan",
  "requirement-design",
  "user-confirmation",
] as const;

export interface PublicationAuthorityMemberSelectionFixture {
  readonly recordId: string;
  readonly memberPath: string;
}

export interface DemandEventSourcingPublicationWorkspaceFixture {
  readonly fixtureRoot: string;
  readonly workspacePath: string;
  readonly workspaceRoot: RootedDirectory;
  readonly initialTodoStateDigest: string;
  readonly requirementMembers: readonly Readonly<PublicationAuthorityMemberSelectionFixture>[];
  readonly confirmationA: Readonly<PublicationAuthorityMemberSelectionFixture>;
  readonly confirmationB: Readonly<PublicationAuthorityMemberSelectionFixture>;
}

function memberBytes(role: string): Uint8Array {
  return encodeUtf8(`# ${role}\n`);
}

async function publishConfirmation(
  store: LedgerAuthorityStore,
  input: Readonly<{
    confirmationId: string;
    demandId: string;
    role: "goal-stage-decision" | "supporting-evidence";
    memberPath: string;
  }>,
): Promise<Readonly<PublicationAuthorityMemberSelectionFixture>> {
  const bytes = memberBytes(input.role);
  const record = createConfirmationRecord(
    {
      confirmationId: input.confirmationId,
      programId: "program_11111111-1111-4111-8111-111111111111",
      demandId: input.demandId,
      title: `Confirmation ${input.confirmationId}`,
      documents: [
        {
          role: input.role,
          path: input.memberPath,
          mediaType: "text/markdown",
          digest: computeSha256Digest(bytes),
        },
      ],
    },
    { clock: () => PUBLICATION_RECORDED_AT },
  );
  await store.publish(record, [{ path: input.memberPath, bytes }]);
  return Object.freeze({
    recordId: input.confirmationId,
    memberPath: input.memberPath,
  });
}

export type DemandPublicationFixtureAuthorityMode =
  | "requirement"
  | "isolated"
  | "conflicting-confirmations";

/** 创建Preview、Apply和Recovery测试共用的一份未领取TODO及完整Ledger Authority。 */
export async function createDemandEventSourcingPublicationWorkspaceFixture(
  authorityMode: DemandPublicationFixtureAuthorityMode = "requirement",
): Promise<
  Readonly<DemandEventSourcingPublicationWorkspaceFixture>
> {
  const fixtureRoot = mkdtempSync(
    path.join(os.tmpdir(), "wakeflow-demand-publication-planning-"),
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
  const originWindow = config.topology.windows.find(
    (window) => window.role === "design",
  );
  if (controllerWindow === undefined || originWindow === undefined) {
    throw new Error("Expected Controller and Design window fixtures.");
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

  const ledgerRoot = await RootedDirectory.open(ledgerPath);
  try {
    const store = new LedgerAuthorityStore(ledgerRoot);
    await store.initialize({ freshLedger: true });
    const members = PUBLICATION_REQUIRED_ROLES.map((role) => {
      const bytes = memberBytes(role);
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
        requirementId: PUBLICATION_REQUIREMENT_ID,
        programId: "program_11111111-1111-4111-8111-111111111111",
        title: "Demand Publication planning requirement",
        documents: members.map(({ bytes: _bytes, ...document }) => document),
      },
      { clock: () => PUBLICATION_RECORDED_AT },
    );
    const publishedRequirement = await store.publish(
      requirement,
      members.map(({ path: memberPath, bytes }) => ({
        path: memberPath,
        bytes,
      })),
    );
    const requirementMembers = publishedRequirement.loaded.documents.map(
      (document) =>
        Object.freeze({
          recordId: PUBLICATION_REQUIREMENT_ID,
          memberPath: document.path,
        }),
    );
    const requirementAuthorityRefs = publishedRequirement.loaded.documents.map(
      (document) => createLedgerAuthorityMemberReference(
        publishedRequirement.loaded,
        document.path,
      ),
    );
    const confirmationA = await publishConfirmation(store, {
      confirmationId: PUBLICATION_CONFIRMATION_A_ID,
      demandId: PUBLICATION_CONFIRMATION_DEMAND_A,
      role: "goal-stage-decision",
      memberPath: "decisions/isolated-placement.md",
    });
    const confirmationB = await publishConfirmation(store, {
      confirmationId: PUBLICATION_CONFIRMATION_B_ID,
      demandId: PUBLICATION_CONFIRMATION_DEMAND_B,
      role: "supporting-evidence",
      memberPath: "evidence/other-demand.md",
    });
    const loadedConfirmationA = await store.loadConfirmation(
      PUBLICATION_CONFIRMATION_A_ID,
    );
    const loadedConfirmationB = await store.loadConfirmation(
      PUBLICATION_CONFIRMATION_B_ID,
    );
    const confirmationAReference = createLedgerAuthorityMemberReference(
      loadedConfirmationA,
      confirmationA.memberPath,
    );
    const confirmationBReference = createLedgerAuthorityMemberReference(
      loadedConfirmationB,
      confirmationB.memberPath,
    );
    const authorityRefs = authorityMode === "isolated"
      ? [...requirementAuthorityRefs, confirmationAReference]
      : authorityMode === "conflicting-confirmations"
        ? [
            ...requirementAuthorityRefs,
            confirmationAReference,
            confirmationBReference,
          ]
        : requirementAuthorityRefs;
    const appended = await appendTodoItem(
      workspaceRoot,
      todoIntakeDraft(PUBLICATION_TODO_ID, {
        programId: config.program.programId,
        originWindowId: originWindow.windowId,
        controllerWindowId: controllerWindow.windowId,
        summary: "发布一份完整 Demand Event Sourcing 初始权威",
        intakeRationale: "已确认的 Ledger Authority 可以进入 Demand 发布规划。",
        testingDecision: {
          mode: "controller-only",
          summary: "运行新增 TypeScript 聚焦测试",
          environmentMemberRef: null,
        },
        authorityRefs,
      }),
      { clock: () => PUBLICATION_RECORDED_AT },
    );
    return Object.freeze({
      fixtureRoot,
      workspacePath,
      workspaceRoot,
      initialTodoStateDigest: appended.item.stateDigest,
      requirementMembers: Object.freeze(requirementMembers),
      confirmationA,
      confirmationB,
    });
  } catch (error: unknown) {
    await workspaceRoot.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
    throw error;
  } finally {
    await ledgerRoot.close();
  }
}

export async function cleanupDemandEventSourcingPublicationWorkspaceFixture(
  fixture: Readonly<DemandEventSourcingPublicationWorkspaceFixture>,
): Promise<void> {
  await fixture.workspaceRoot.close();
  rmSync(fixture.fixtureRoot, { recursive: true, force: true });
}

export function demandEventSourcingPublicationAuthoredDemand<
  const ExecutionPlacement,
>(executionPlacement: ExecutionPlacement) {
  return {
    title: "Demand Event Sourcing Publication",
    goal: "从当前TODO与Ledger生成完整revision 1计划",
    completionDefinition: "计划可精确Apply并支持前向Recovery",
    executionPlacement,
  };
}

export function demandEventSourcingPublicationUuidFactory(
  values: readonly string[],
  calls: { value: number },
) {
  return () => {
    const value = values[calls.value];
    calls.value += 1;
    if (value === undefined) throw new Error("Unexpected UUID allocation.");
    return value;
  };
}

export function demandEventSourcingPublicationPhysicalPath(
  root: string,
  ref: string,
): string {
  return path.join(root, ...ref.split("/"));
}
