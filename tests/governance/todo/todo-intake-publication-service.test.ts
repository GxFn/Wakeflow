import { equal } from "node:assert/strict";
import { rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  appendTodoItem,
  inspectTodoItems,
} from "../../../src/governance/todo/todo-collection-service.js";
import {
  TodoIntakePublicationApplicationService,
  TodoIntakePublicationApplicationServiceError,
} from "../../../src/governance/todo/todo-intake-publication-application-service.js";
import {
  parseTodoIntakePublicationInput,
  TodoIntakePublicationInputError,
} from "../../../src/governance/todo/todo-intake-publication-input.js";
import {
  computeTodoIntakePublicationPlanDigest,
  parseTodoIntakePublicationPlan,
  TodoIntakePublicationPlanError,
} from "../../../src/governance/todo/todo-intake-publication-plan.js";
import {
  TodoIntakePublicationPlanningService,
  TodoIntakePublicationPlanningServiceError,
} from "../../../src/governance/todo/todo-intake-publication-planning-service.js";
import { todoIntakeDraft } from "./todo-intake.fixture.js";
import {
  cleanupTodoIntakePublicationFixture,
  createTodoIntakePublicationFixture,
  todoIntakePublicationInput,
  TODO_INTAKE_ID,
  TODO_INTAKE_RECORDED_AT,
  TODO_INTAKE_UUID,
} from "./todo-intake-publication.fixture.js";

function previewOptions() {
  return {
    uuidFactory: () => TODO_INTAKE_UUID,
    clock: () => TODO_INTAKE_RECORDED_AT,
  };
}

test("TODO Intake Publication input与Plan关闭author/owner边界", () => {
  const input = parseTodoIntakePublicationInput({
    demandType: "research",
    priority: "P2",
    originWindowId: "window_66666666-6666-4666-8666-666666666666",
    summary: "Research one bounded question",
    intakeRationale: "Record confirmed research before Demand publication.",
    readiness: { status: "parked", trigger: "Wait for source access." },
    autoClaim: false,
    testingDecision: {
      mode: "not-applicable",
      summary: "Research has no execution target.",
    },
    authorityMembers: [{
      recordId: "requirement_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      memberPath: "authority/research-question.md",
    }],
  });
  equal(input.readiness.status, "parked");
  equal(Object.isFrozen(input.authorityMembers), true);

  let caught: unknown;
  try {
    parseTodoIntakePublicationInput({
      ...input,
      autoClaim: true,
    });
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof TodoIntakePublicationInputError, true);

  caught = undefined;
  try {
    parseTodoIntakePublicationPlan({ kind: "wrong" });
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof TodoIntakePublicationPlanError, true);
});

test("TODO Intake Planning从Config/Ledger/Collection零写派生完整计划", async () => {
  const fixture = await createTodoIntakePublicationFixture();
  try {
    const before = await inspectTodoItems(fixture.ledger.workspaceRoot);
    const preview = await new TodoIntakePublicationPlanningService(
      fixture.ledger.workspaceRoot,
    ).preview(todoIntakePublicationInput(fixture), previewOptions());
    equal(preview.plan.targetIntake.todoId, TODO_INTAKE_ID);
    equal(
      preview.plan.targetIntake.controllerWindowId,
      "window_55555555-5555-4555-8555-555555555555",
    );
    equal(preview.plan.targetIntake.authorityRefs.length, 6);
    equal(preview.plan.targetIntake.createdAt, TODO_INTAKE_RECORDED_AT);
    equal(
      computeTodoIntakePublicationPlanDigest(preview.plan),
      preview.planDigest,
    );
    equal((await inspectTodoItems(fixture.ledger.workspaceRoot)).collection.itemCount, 0);
    equal(before.collection.collectionDigest, preview.plan.expectedCollectionDigest);

    let allocations = 0;
    let clocks = 0;
    let caught: unknown;
    try {
      await new TodoIntakePublicationPlanningService(
        fixture.ledger.workspaceRoot,
      ).preview(todoIntakePublicationInput(fixture, {
        authorityMembers: fixture.authorityMembers.slice(0, 1),
      }), {
        uuidFactory: () => {
          allocations += 1;
          return TODO_INTAKE_UUID;
        },
        clock: () => {
          clocks += 1;
          return TODO_INTAKE_RECORDED_AT;
        },
      });
    } catch (error: unknown) {
      caught = error;
    }
    equal(caught instanceof TodoIntakePublicationPlanningServiceError, true);
    equal(allocations, 0);
    equal(clocks, 0);
  } finally {
    await cleanupTodoIntakePublicationFixture(fixture);
  }
});

test("TODO Intake Application首次发布、重试与Recover保持exact current", async () => {
  const fixture = await createTodoIntakePublicationFixture();
  try {
    const preview = await new TodoIntakePublicationPlanningService(
      fixture.ledger.workspaceRoot,
    ).preview(todoIntakePublicationInput(fixture), previewOptions());
    const application = new TodoIntakePublicationApplicationService(
      fixture.ledger.workspaceRoot,
    );
    const applied = await application.apply(preview.plan, preview.planDigest);
    equal(applied.disposition, "published");
    equal(applied.wroteAuthority, true);
    equal(applied.item.todoId, TODO_INTAKE_ID);

    const current = await application.apply(preview.plan, preview.planDigest);
    equal(current.disposition, "current");
    equal(current.wroteAuthority, false);

    const recovered = await application.recover(
      preview.plan,
      preview.planDigest,
    );
    equal(recovered.disposition, "current");
    equal(recovered.item.intakeDigest, applied.item.intakeDigest);
  } finally {
    await cleanupTodoIntakePublicationFixture(fixture);
  }
});

test("TODO Intake Application区分stale Collection与可恢复projection失败", async () => {
  const fixture = await createTodoIntakePublicationFixture();
  try {
    const planning = new TodoIntakePublicationPlanningService(
      fixture.ledger.workspaceRoot,
    );
    const stale = await planning.preview(
      todoIntakePublicationInput(fixture),
      previewOptions(),
    );
    await appendTodoItem(
      fixture.ledger.workspaceRoot,
      todoIntakeDraft("todo_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
      { clock: () => TODO_INTAKE_RECORDED_AT },
    );
    const application = new TodoIntakePublicationApplicationService(
      fixture.ledger.workspaceRoot,
    );
    let caught: unknown;
    try {
      await application.apply(stale.plan, stale.planDigest);
    } catch (error: unknown) {
      caught = error;
    }
    if (!(caught instanceof TodoIntakePublicationApplicationServiceError)) {
      throw new Error("Expected TodoIntakePublicationApplicationServiceError.");
    }
    equal(caught.reason, "conflict");
    equal(caught.publicationAuthority, "unchanged");
  } finally {
    await cleanupTodoIntakePublicationFixture(fixture);
  }

  const recoveryFixture = await createTodoIntakePublicationFixture();
  try {
    const preview = await new TodoIntakePublicationPlanningService(
      recoveryFixture.ledger.workspaceRoot,
    ).preview(todoIntakePublicationInput(recoveryFixture), previewOptions());
    const projectionPath = path.join(
      recoveryFixture.ledger.workspacePath,
      ".wakeflow-active/current/todo/global-todo-board.md",
    );
    const outside = path.join(
      recoveryFixture.ledger.workspacePath,
      "outside-projection.md",
    );
    rmSync(projectionPath);
    writeFileSync(outside, "outside\n", { mode: 0o600 });
    symlinkSync(outside, projectionPath);
    const application = new TodoIntakePublicationApplicationService(
      recoveryFixture.ledger.workspaceRoot,
    );
    let caught: unknown;
    try {
      await application.apply(preview.plan, preview.planDigest);
    } catch (error: unknown) {
      caught = error;
    }
    if (!(caught instanceof TodoIntakePublicationApplicationServiceError)) {
      throw new Error("Expected recoverable application error.");
    }
    equal(caught.reason, "recovery-required");
    equal(caught.publicationAuthority, "recoverable");

    rmSync(projectionPath);
    const recovered = await application.recover(
      preview.plan,
      preview.planDigest,
    );
    equal(recovered.disposition, "current");
    equal(recovered.item.todoId, TODO_INTAKE_ID);
  } finally {
    await cleanupTodoIntakePublicationFixture(recoveryFixture);
  }
});
