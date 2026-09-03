import { writeFileSync } from "node:fs";
import path from "node:path";

import {
  executeRequirementPublicationPublicRequest,
} from "../../../src/governance/ledger/ledger-authority-public-coordinator.js";
import {
  initializeTodoCollection,
} from "../../../src/governance/todo/todo-collection-service.js";
import { materializeWakeflowActiveLayout } from "../../../src/workspace/active/wakeflow-active-layout-materialization.js";
import {
  cleanupLedgerAuthorityPublicationFixture,
  createLedgerAuthorityPublicationFixture,
  ledgerAuthorityPublicationUuidFactory,
  ORIGINAL_PLAN_PATH,
  RECORDED_AT,
  REQUIREMENT_DESIGN_PATH,
  REQUIREMENT_UUID,
  type LedgerAuthorityPublicationFixture,
} from "../ledger/ledger-authority-publication.fixture.js";

export const TODO_INTAKE_UUID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export const TODO_INTAKE_ID = `todo_${TODO_INTAKE_UUID}`;
export const TODO_INTAKE_RECORDED_AT = RECORDED_AT;
export const TODO_INTAKE_ORIGIN_WINDOW_ID =
  "window_66666666-6666-4666-8666-666666666666";

const EXTRA_DOCUMENTS = Object.freeze([
  { role: "code-facts", path: "authority/code-facts.md" },
  { role: "landing-plan", path: "authority/landing-plan.md" },
  { role: "non-goals", path: "authority/non-goals.md" },
  { role: "user-confirmation", path: "authority/user-confirmation.md" },
] as const);

export interface TodoIntakePublicationFixture {
  readonly ledger: Readonly<LedgerAuthorityPublicationFixture>;
  readonly authorityMembers: readonly Readonly<{
    readonly recordId: string;
    readonly memberPath: string;
  }>[];
}

export async function createTodoIntakePublicationFixture(): Promise<
  Readonly<TodoIntakePublicationFixture>
> {
  const ledger = await createLedgerAuthorityPublicationFixture();
  for (const document of EXTRA_DOCUMENTS) {
    writeFileSync(
      path.join(ledger.designPath, document.path),
      `# ${document.role}\n`,
      { mode: 0o644 },
    );
  }
  const preview = await executeRequirementPublicationPublicRequest({
    root: ledger.workspacePath,
    mode: "preview",
    title: "Complete Requirement authority for TODO Intake",
    designSurfaceId: "surface_33333333-3333-4333-8333-333333333333",
    documents: [
      { role: "original-plan", path: ORIGINAL_PLAN_PATH },
      { role: "requirement-design", path: REQUIREMENT_DESIGN_PATH },
      ...EXTRA_DOCUMENTS,
    ],
  }, {
    preview: {
      uuidFactory: ledgerAuthorityPublicationUuidFactory(
        [REQUIREMENT_UUID],
        { value: 0 },
      ),
      clock: () => RECORDED_AT,
    },
  });
  if (preview.mode !== "preview") throw new Error("Expected Requirement preview.");
  const applied = await executeRequirementPublicationPublicRequest({
    root: ledger.workspacePath,
    mode: "apply",
    plan: preview.plan,
    planDigest: preview.planDigest,
  });
  if (applied.mode !== "apply") throw new Error("Expected Requirement apply.");
  await materializeWakeflowActiveLayout(ledger.workspaceRoot, {
    recoveringFreshLayout: false,
  });
  await initializeTodoCollection(ledger.workspaceRoot, { freshWorkspace: true });
  return Object.freeze({
    ledger,
    authorityMembers: Object.freeze(
      applied.publication.memberReferences.map((reference) => Object.freeze({
        recordId: reference.recordId,
        memberPath: reference.memberPath,
      })),
    ),
  });
}

export async function cleanupTodoIntakePublicationFixture(
  fixture: Readonly<TodoIntakePublicationFixture>,
): Promise<void> {
  await cleanupLedgerAuthorityPublicationFixture(fixture.ledger);
}

export function todoIntakePublicationInput(
  fixture: Readonly<TodoIntakePublicationFixture>,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    demandType: "requirement",
    priority: "P1",
    originWindowId: TODO_INTAKE_ORIGIN_WINDOW_ID,
    summary: "Implement the confirmed Requirement",
    intakeRationale: "Queue confirmed work before Demand publication.",
    readiness: { status: "ready" },
    autoClaim: true,
    testingDecision: {
      mode: "controller-only",
      summary: "Controller validates focused implementation checks.",
    },
    authorityMembers: fixture.authorityMembers,
    ...overrides,
  };
}
