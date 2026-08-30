import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  parseTaskPackageProjectionFileName,
  taskPackageProjectionRef,
  TaskPackageProjectionPathError,
  TASK_PACKAGE_PROJECTIONS_ROOT_REF,
} from "../../../src/governance/tasking/task-package-projection-paths.js";
import { TASK_PACKAGE_ID } from "./task-package.fixture.js";

test("TaskPackage projection path is a single typed-ID mapping", () => {
  const fileName = `${TASK_PACKAGE_ID}.json`;
  const resourcePath = `${TASK_PACKAGE_PROJECTIONS_ROOT_REF}/${fileName}`;

  equal(taskPackageProjectionRef(TASK_PACKAGE_ID), resourcePath);
  deepEqual(parseTaskPackageProjectionFileName(fileName), {
    taskPackageId: TASK_PACKAGE_ID,
    fileName,
    resourcePath,
  });
  equal(Object.isFrozen(parseTaskPackageProjectionFileName(fileName)), true);
});

test("TaskPackage projection path rejects aliases and unrelated identities", () => {
  for (const value of [
    `${TASK_PACKAGE_ID.toUpperCase()}.json`,
    `${TASK_PACKAGE_ID}.JSON`,
    `${TASK_PACKAGE_ID}.json.bak`,
    `.${TASK_PACKAGE_ID}.json`,
    "target-task_44444444-4444-4444-8444-444444444444.json",
    null,
  ]) {
    throws(
      () => parseTaskPackageProjectionFileName(value),
      TaskPackageProjectionPathError,
    );
  }
  throws(
    () => taskPackageProjectionRef(
      "target-task_44444444-4444-4444-8444-444444444444",
    ),
    (error: unknown) => (
      error instanceof TaskPackageProjectionPathError
      && error.reason === "identifier"
    ),
  );
});
