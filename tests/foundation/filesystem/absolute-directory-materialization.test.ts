import { deepEqual, equal } from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import {
  materializeAbsoluteDirectoryPlacement,
  AbsoluteDirectoryMaterializationError,
  type AbsoluteDirectoryMaterializationErrorReason,
} from "../../../src/foundation/filesystem/absolute-directory-materialization.js";

function fixture(t: TestContext): string {
  const root = realpathSync(mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-absolute-directory-materialization-",
  )));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

async function expectMaterializationError(
  action: () => Promise<unknown>,
  reason: AbsoluteDirectoryMaterializationErrorReason,
  pathValue: string,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof AbsoluteDirectoryMaterializationError, true);
  if (caught instanceof AbsoluteDirectoryMaterializationError) {
    equal(caught.code, "wakeflow-absolute-directory-materialization");
    equal(caught.reason, reason);
    equal(caught.path, pathValue);
  }
}

test("absolute directory materialization creates nested child or sibling paths", async (t) => {
  const root = fixture(t);
  const child = path.join(root, "Workspace", "Design");
  mkdirSync(path.join(root, "Workspace"), { mode: 0o755 });
  const created = await materializeAbsoluteDirectoryPlacement(child, {
    mode: 0o755,
  });
  equal(created.absolutePath, child);
  deepEqual(created.segments.map((entry) => entry.disposition), ["created"]);
  equal(statSync(child).mode & 0o777, 0o755);

  const sibling = path.join(root, "Support", "Test");
  const nested = await materializeAbsoluteDirectoryPlacement(sibling, {
    mode: 0o755,
  });
  deepEqual(
    nested.segments.map((entry) => entry.disposition),
    ["created", "created"],
  );
  equal(statSync(path.join(root, "Support")).mode & 0o777, 0o755);
  equal(statSync(sibling).mode & 0o777, 0o755);

  const current = await materializeAbsoluteDirectoryPlacement(sibling, {
    mode: 0o700,
  });
  deepEqual(current.segments.map((entry) => entry.disposition), ["existing"]);
  equal(statSync(sibling).mode & 0o777, 0o755);
});

test("absolute directory materialization rejects unsafe paths without mutation", async (t) => {
  const root = fixture(t);
  const real = path.join(root, "real");
  const link = path.join(root, "link");
  mkdirSync(real);
  symlinkSync(real, link);
  await expectMaterializationError(
    () => materializeAbsoluteDirectoryPlacement(path.join(link, "Design"), {
      mode: 0o755,
    }),
    "symlink",
    "$absolutePath",
  );

  const file = path.join(root, "file");
  writeFileSync(file, "not a directory");
  await expectMaterializationError(
    () => materializeAbsoluteDirectoryPlacement(path.join(file, "Test"), {
      mode: 0o755,
    }),
    "not-directory",
    "$absolutePath",
  );

  const controller = new AbortController();
  controller.abort();
  await expectMaterializationError(
    () => materializeAbsoluteDirectoryPlacement(path.join(root, "aborted"), {
      mode: 0o755,
      signal: controller.signal,
    }),
    "aborted",
    "$signal",
  );
});
