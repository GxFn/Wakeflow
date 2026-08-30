import {
  deepEqual,
  equal,
  throws,
} from "node:assert/strict";
import { test } from "node:test";

import {
  computeTaskPackageDigest,
  createTaskPackage,
  parseTaskPackage,
  parseTaskPackageDocument,
  renderTaskPackage,
  TaskPackageError,
  type TaskPackageErrorReason,
} from "../../../src/governance/tasking/task-package.js";
import {
  createTaskPackageFixture,
  SELECTED_AUTHORITY_REF,
  TARGET_TASK_ID,
  TASKING_CONFIG_DIGEST,
  TASKING_CREATED_AT,
  TASKING_REPOSITORY_ID,
  TASKING_WINDOW_ID,
  TASK_PACKAGE_ID,
  taskPackageDraft,
} from "./task-package.fixture.js";

function expectTaskPackageError(
  action: () => unknown,
  reason: TaskPackageErrorReason,
  path: string,
): TaskPackageError {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof TaskPackageError)) {
    throw new Error("Expected TaskPackageError.");
  }
  equal(caught.code, "wakeflow-task-package");
  equal(caught.reason, reason);
  equal(caught.path, path);
  return caught;
}

test("implementation TaskPackage freezes one exact target assignment and authority selection", () => {
  const taskPackage = createTaskPackageFixture();

  equal(taskPackage.artifactKind, "wakeflow-task-package");
  equal(taskPackage.schemaVersion, 1);
  equal(taskPackage.createdAt, TASKING_CREATED_AT);
  equal(taskPackage.configDigest, TASKING_CONFIG_DIGEST);
  equal(taskPackage.taskPackageId, TASK_PACKAGE_ID);
  equal(taskPackage.targetTaskId, TARGET_TASK_ID);
  deepEqual(taskPackage.assignment, {
    repositoryId: TASKING_REPOSITORY_ID,
    windowId: TASKING_WINDOW_ID,
  });
  deepEqual(taskPackage.selectedAuthorityRefs, [SELECTED_AUTHORITY_REF]);
  equal(Object.isFrozen(taskPackage), true);
  equal(Object.isFrozen(taskPackage.assignment), true);
  equal(Object.isFrozen(taskPackage.confirmedContext), true);
  equal(Object.isFrozen(taskPackage.selectedAuthorityRefs), true);
  equal(Object.isFrozen(taskPackage.boundaries), true);
  equal(Object.isFrozen(taskPackage.acceptanceAnchors[0]), true);
  equal(Object.hasOwn(taskPackage, "delivery"), false);
  equal(Object.hasOwn(taskPackage, "lease"), false);
  equal(Object.hasOwn(taskPackage, "continuation"), false);
});

test("TaskPackage has one deterministic document representation and digest", () => {
  const taskPackage = createTaskPackageFixture();
  const document = renderTaskPackage(taskPackage);

  equal(document.endsWith("\n"), true);
  deepEqual(parseTaskPackageDocument(document), taskPackage);
  equal(
    computeTaskPackageDigest(parseTaskPackage(JSON.parse(document))),
    computeTaskPackageDigest(taskPackage),
  );
  expectTaskPackageError(
    () => parseTaskPackageDocument(JSON.stringify(taskPackage, null, 2)),
    "representation",
    "$taskPackage",
  );
});

test("TaskPackage rejects future workflow branches and duplicate local facts", () => {
  const taskPackage = createTaskPackageFixture();

  for (const extension of [
    { delivery: {} },
    { dependsOnTargetTaskIds: [] },
    { testCard: null },
    { continuation: null },
    { replacesTargetTask: null },
  ]) {
    expectTaskPackageError(
      () => parseTaskPackage({ ...taskPackage, ...extension }),
      "schema",
      "$",
    );
  }
  expectTaskPackageError(
    () => parseTaskPackage({
      ...taskPackage,
      workType: "test",
    }),
    "schema",
    "$/workType",
  );
  expectTaskPackageError(
    () => parseTaskPackage({
      ...taskPackage,
      confirmedContext: [
        taskPackage.confirmedContext[0],
        taskPackage.confirmedContext[0],
      ],
    }),
    "relation",
    "$/confirmedContext/1",
  );
  expectTaskPackageError(
    () => parseTaskPackage({
      ...taskPackage,
      selectedAuthorityRefs: [
        SELECTED_AUTHORITY_REF,
        SELECTED_AUTHORITY_REF,
      ],
    }),
    "relation",
    "$/selectedAuthorityRefs/1",
  );
  expectTaskPackageError(
    () => parseTaskPackage({
      ...taskPackage,
      acceptanceAnchors: [
        taskPackage.acceptanceAnchors[0],
        taskPackage.acceptanceAnchors[0],
      ],
    }),
    "relation",
    "$/acceptanceAnchors/1/anchorId",
  );
});

test("TaskPackage requires canonical text and validates the closed draft before reading time", () => {
  const decomposed = "e\u0301";
  expectTaskPackageError(
    () => createTaskPackage({
      ...taskPackageDraft(),
      objective: decomposed,
    }, { clock: () => TASKING_CREATED_AT }),
    "text",
    "$/objective",
  );

  let clockCalls = 0;
  expectTaskPackageError(
    () => createTaskPackage({
      ...taskPackageDraft(),
      deliveryId: "future-placeholder",
    }, {
      clock: () => {
        clockCalls += 1;
        return TASKING_CREATED_AT;
      },
    }),
    "input",
    "$draft",
  );
  equal(clockCalls, 0);

  const privateFailure = new Error("private clock failure");
  const timeError = expectTaskPackageError(
    () => createTaskPackage(taskPackageDraft(), {
      clock: () => {
        throw privateFailure;
      },
    }),
    "time",
    "$options/clock",
  );
  equal(timeError.message.includes(privateFailure.message), false);
  equal("cause" in timeError, false);
});

test("TaskPackage keeps repository and window inside the explicit assignment relation", () => {
  const taskPackage = createTaskPackageFixture();

  throws(
    () => parseTaskPackage({
      ...taskPackage,
      repositoryId: TASKING_REPOSITORY_ID,
    }),
    TaskPackageError,
  );
  expectTaskPackageError(
    () => parseTaskPackage({
      ...taskPackage,
      assignment: {
        ...taskPackage.assignment,
        windowId: TASKING_REPOSITORY_ID,
      },
    }),
    "schema",
    "$/assignment/windowId",
  );
});
