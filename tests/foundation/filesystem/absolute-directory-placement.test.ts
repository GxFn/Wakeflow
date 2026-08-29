import { equal } from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  AbsoluteDirectoryPlacementError,
  inspectAbsoluteDirectoryPlacement,
  type AbsoluteDirectoryPlacementErrorReason,
} from "../../../src/foundation/filesystem/absolute-directory-placement.js";

async function expectPlacementError(
  action: () => unknown | Promise<unknown>,
  reason: AbsoluteDirectoryPlacementErrorReason,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof AbsoluteDirectoryPlacementError)) {
    throw new Error("Expected AbsoluteDirectoryPlacementError.");
  }
  equal(caught.reason, reason);
  equal(caught.path, "$.placement");
}

test("present and missing directory placements return bounded physical facts", async () => {
  const rootPath = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "wakeflow-placement-")),
  );
  const present = path.join(rootPath, "present", "nested");
  mkdirSync(present, { recursive: true });
  try {
    const observed = await inspectAbsoluteDirectoryPlacement(
      present,
      "$.placement",
    );
    equal(observed.state, "present");
    equal(observed.realPath, present);
    equal(observed.spellingIsCanonical, true);
    equal(observed.node?.kind, "directory");
    equal(observed.nearestExistingAncestor, null);
    equal(Object.isFrozen(observed), true);

    const missing = await inspectAbsoluteDirectoryPlacement(
      path.join(rootPath, "future", "nested"),
      "$.placement",
    );
    equal(missing.state, "missing");
    equal(missing.realPath, null);
    equal(missing.node, null);
    equal(missing.nearestExistingAncestor?.absolutePath, rootPath);
    equal(missing.nearestExistingAncestor?.realPath, rootPath);
    equal(missing.nearestExistingAncestor?.spellingIsCanonical, true);
    equal(missing.nearestExistingAncestor?.node.kind, "directory");
  } finally {
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("symlink and non-directory path segments fail closed", async () => {
  const rootPath = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "wakeflow-placement-shape-")),
  );
  const target = path.join(rootPath, "target");
  mkdirSync(target);
  symlinkSync(target, path.join(rootPath, "alias"), "dir");
  writeFileSync(path.join(rootPath, "file"), "x");
  try {
    await expectPlacementError(
      () => inspectAbsoluteDirectoryPlacement(
        path.join(rootPath, "alias", "child"),
        "$.placement",
      ),
      "symlink",
    );
    await expectPlacementError(
      () => inspectAbsoluteDirectoryPlacement(
        path.join(rootPath, "file", "child"),
        "$.placement",
      ),
      "not-directory",
    );
  } finally {
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("input requires one normalized non-root absolute path", async () => {
  for (const value of ["relative", "/", "/tmp/../tmp", " /tmp", null]) {
    await expectPlacementError(
      () => inspectAbsoluteDirectoryPlacement(value, "$.placement"),
      "input",
    );
  }
});
