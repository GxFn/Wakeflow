import { equal } from "node:assert/strict";
import { test } from "node:test";

import {
  executeTodoIntakePublicationPublicRequest,
  TodoIntakePublicationPublicContractError,
} from "../../../src/governance/todo/todo-intake-publication-public-coordinator.js";
import {
  cleanupTodoIntakePublicationFixture,
  createTodoIntakePublicationFixture,
  todoIntakePublicationInput,
  TODO_INTAKE_ID,
  TODO_INTAKE_RECORDED_AT,
  TODO_INTAKE_UUID,
} from "./todo-intake-publication.fixture.js";

function options() {
  return {
    preview: {
      uuidFactory: () => TODO_INTAKE_UUID,
      clock: () => TODO_INTAKE_RECORDED_AT,
    },
  };
}

test("TODO Intake Public完成preview/apply/recover并只返回metadata receipt", async () => {
  const fixture = await createTodoIntakePublicationFixture();
  try {
    const preview = await executeTodoIntakePublicationPublicRequest({
      root: fixture.ledger.workspacePath,
      mode: "preview",
      intake: todoIntakePublicationInput(fixture),
    }, options());
    if (preview.mode !== "preview") throw new Error("Expected preview.");
    equal(
      (preview.plan as {
        readonly targetIntake: Readonly<{ readonly todoId: string }>;
      }).targetIntake.todoId,
      TODO_INTAKE_ID,
    );
    equal(JSON.stringify(preview).includes(fixture.ledger.workspacePath), false);

    const applied = await executeTodoIntakePublicationPublicRequest({
      root: fixture.ledger.workspacePath,
      mode: "apply",
      plan: preview.plan,
      planDigest: preview.planDigest,
    });
    if (applied.mode !== "apply") throw new Error("Expected apply.");
    equal(applied.publication.todoId, TODO_INTAKE_ID);
    equal(applied.publication.todoStatus, "pending-claim");
    equal(applied.publication.disposition, "published");
    const serialized = JSON.stringify(applied);
    equal(serialized.includes("targetIntake"), false);
    equal(serialized.includes("authorityRefs"), false);
    equal(serialized.includes("intakeSource"), false);

    const recovered = await executeTodoIntakePublicationPublicRequest({
      root: fixture.ledger.workspacePath,
      mode: "recover",
      plan: preview.plan,
      planDigest: preview.planDigest,
    });
    if (recovered.mode !== "recover") throw new Error("Expected recover.");
    equal(recovered.publication.disposition, "current");
  } finally {
    await cleanupTodoIntakePublicationFixture(fixture);
  }
});

test("TODO Intake Public拒绝caller owner字段与不带Plan的恢复", async () => {
  const fixture = await createTodoIntakePublicationFixture();
  try {
    for (const request of [
      {
        root: fixture.ledger.workspacePath,
        mode: "preview",
        intake: {
          ...todoIntakePublicationInput(fixture),
          todoId: TODO_INTAKE_ID,
        },
      },
      {
        root: fixture.ledger.workspacePath,
        mode: "recover",
        todoId: TODO_INTAKE_ID,
      },
    ]) {
      let caught: unknown;
      try {
        await executeTodoIntakePublicationPublicRequest(request);
      } catch (error: unknown) {
        caught = error;
      }
      equal(caught instanceof TodoIntakePublicationPublicContractError, true);
    }
  } finally {
    await cleanupTodoIntakePublicationFixture(fixture);
  }
});
