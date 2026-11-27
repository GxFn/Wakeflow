import { equal, rejects } from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  DurableResourceRenameError,
  type DurableResourceRenameErrorReason,
  renameResourceDurably,
} from "../../../src/foundation/filesystem/durable-resource-rename.js";
import {
  type PortableResourcePath,
  parsePortableResourcePath,
} from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { OperationAbortedError } from "../../../src/foundation/node/abort-signal.js";

async function expectRenameError(
  action: () => unknown | Promise<unknown>,
  reason: DurableResourceRenameErrorReason,
  expectedPath: string,
): Promise<DurableResourceRenameError> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof DurableResourceRenameError)) {
    throw new Error("Expected DurableResourceRenameError.");
  }
  equal(caught.name, "DurableResourceRenameError");
  equal(caught.code, "wakeflow-durable-resource-rename");
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
  return caught;
}

function asPortableResourcePath(value: unknown): PortableResourcePath {
  return value as PortableResourcePath;
}

test("same-parent file rename preserves exact inode, bytes, and mode", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-rename-file-"));
  const sourcePath = path.join(rootPath, "source");
  writeFileSync(sourcePath, "payload", { mode: 0o640 });
  const root = await RootedDirectory.open(rootPath);
  try {
    const source = parsePortableResourcePath("source");
    const destination = parsePortableResourcePath("destination");
    const expected = await root.inspectExistingResource(source);
    const result = await renameResourceDurably(root, source, destination, {
      expectedSourceNode: expected.node,
    });

    equal(result.kind, "file");
    equal(result.sourceResourcePath, source);
    equal(result.destinationResourcePath, destination);
    equal(result.node.inodeId, expected.node.inodeId);
    equal(result.node.deviceId, expected.node.deviceId);
    equal(result.node.permissionBits, 0o640);
    equal(readFileSync(path.join(rootPath, "destination"), "utf8"), "payload");
    equal(statSync(sourcePath, { throwIfNoEntry: false }), undefined);
    equal(Object.isFrozen(result), true);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("cross-parent directory rename preserves its complete subtree", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-rename-dir-"));
  mkdirSync(path.join(rootPath, "from", "tree", "nested"), { recursive: true });
  mkdirSync(path.join(rootPath, "to"));
  writeFileSync(path.join(rootPath, "from", "tree", "nested", "file"), "value");
  const root = await RootedDirectory.open(rootPath);
  try {
    const source = parsePortableResourcePath("from/tree");
    const destination = parsePortableResourcePath("to/tree");
    const expected = await root.inspectExistingResource(source);
    const result = await renameResourceDurably(root, source, destination, {
      expectedSourceNode: expected.node,
    });

    equal(result.kind, "directory");
    equal(result.node.inodeId, expected.node.inodeId);
    equal(readFileSync(path.join(rootPath, "to", "tree", "nested", "file"), "utf8"), "value");
    equal(statSync(path.join(rootPath, "from", "tree"), { throwIfNoEntry: false }), undefined);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("existing destination is never intentionally overwritten", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-rename-exists-"));
  writeFileSync(path.join(rootPath, "source"), "source");
  writeFileSync(path.join(rootPath, "destination"), "destination");
  const root = await RootedDirectory.open(rootPath);
  try {
    const source = parsePortableResourcePath("source");
    const expected = await root.inspectExistingResource(source);
    await expectRenameError(
      () =>
        renameResourceDurably(root, source, parsePortableResourcePath("destination"), {
          expectedSourceNode: expected.node,
        }),
      "destination-exists",
      "$destinationResourcePath",
    );
    equal(readFileSync(path.join(rootPath, "source"), "utf8"), "source");
    equal(readFileSync(path.join(rootPath, "destination"), "utf8"), "destination");
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("stale source expectation prevents rename", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-rename-stale-"));
  const sourcePath = path.join(rootPath, "source");
  writeFileSync(sourcePath, "before");
  const root = await RootedDirectory.open(rootPath);
  try {
    const source = parsePortableResourcePath("source");
    const expected = await root.inspectExistingResource(source);
    writeFileSync(sourcePath, "after-change");
    await expectRenameError(
      () =>
        renameResourceDurably(root, source, parsePortableResourcePath("destination"), {
          expectedSourceNode: expected.node,
        }),
      "source-changed",
      "$sourceResourcePath",
    );
    equal(readFileSync(sourcePath, "utf8"), "after-change");
    equal(statSync(path.join(rootPath, "destination"), { throwIfNoEntry: false }), undefined);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("missing, symlink, and descendant source shapes fail closed", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-rename-source-"));
  mkdirSync(path.join(rootPath, "directory"));
  writeFileSync(path.join(rootPath, "target"), "value");
  symlinkSync("target", path.join(rootPath, "link"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const fileNode = (await root.inspectExistingResource(parsePortableResourcePath("target"))).node;
    await expectRenameError(
      () =>
        renameResourceDurably(
          root,
          parsePortableResourcePath("missing"),
          parsePortableResourcePath("destination"),
          { expectedSourceNode: fileNode },
        ),
      "source-not-found",
      "$sourceResourcePath",
    );

    const link = await root.inspectExistingResource(parsePortableResourcePath("link"));
    await expectRenameError(
      () =>
        renameResourceDurably(
          root,
          parsePortableResourcePath("link"),
          parsePortableResourcePath("destination"),
          { expectedSourceNode: link.node },
        ),
      "source-symlink",
      "$sourceResourcePath",
    );

    const directory = await root.inspectExistingResource(parsePortableResourcePath("directory"));
    await expectRenameError(
      () =>
        renameResourceDurably(
          root,
          parsePortableResourcePath("directory"),
          parsePortableResourcePath("directory/inside"),
          { expectedSourceNode: directory.node },
        ),
      "input",
      "$destinationResourcePath",
    );
    await expectRenameError(
      () =>
        renameResourceDurably(
          root,
          parsePortableResourcePath("directory"),
          asPortableResourcePath(null),
          { expectedSourceNode: directory.node },
        ),
      "input",
      "$destinationResourcePath",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("destination requires an existing real parent", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-rename-parent-"));
  const outside = mkdtempSync(path.join(os.tmpdir(), "wakeflow-rename-parent-out-"));
  writeFileSync(path.join(rootPath, "source"), "value");
  writeFileSync(path.join(rootPath, "file-parent"), "value");
  symlinkSync(outside, path.join(rootPath, "link-parent"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const source = parsePortableResourcePath("source");
    const expected = await root.inspectExistingResource(source);
    const cases: readonly [string, DurableResourceRenameErrorReason][] = [
      ["missing/destination", "parent-not-found"],
      ["file-parent/destination", "parent-not-directory"],
      ["link-parent/destination", "parent-symlink"],
    ];
    for (const [candidate, reason] of cases) {
      await expectRenameError(
        () =>
          renameResourceDurably(root, source, parsePortableResourcePath(candidate), {
            expectedSourceNode: expected.node,
          }),
        reason,
        "$destinationResourcePath",
      );
    }
    equal(readFileSync(path.join(rootPath, "source"), "utf8"), "value");
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("paths and AbortSignal are checked before any rename", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-rename-input-"));
  writeFileSync(path.join(rootPath, "source"), "value");
  const root = await RootedDirectory.open(rootPath);
  try {
    const source = parsePortableResourcePath("source");
    const expected = await root.inspectExistingResource(source);
    await expectRenameError(
      () =>
        renameResourceDurably(
          root,
          asPortableResourcePath("../escape"),
          parsePortableResourcePath("destination"),
          { expectedSourceNode: expected.node },
        ),
      "input",
      "$sourceResourcePath",
    );

    const controller = new AbortController();
    controller.abort("private-rename-reason");
    await rejects(
      () =>
        renameResourceDurably(root, source, parsePortableResourcePath("destination"), {
          expectedSourceNode: expected.node,
          signal: controller.signal,
        }),
      (error: unknown) =>
        error instanceof OperationAbortedError && !error.message.includes("private-rename-reason"),
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("commitUncertain is true exactly for the reasons raised after the rename call", () => {
  // The table lists the whole reason union: a new reason that is not decided here fails the typecheck.
  const expected = {
    input: false,
    "root-scope": false,
    "parent-not-found": false,
    "parent-symlink": false,
    "parent-not-directory": false,
    "parent-open-failure": false,
    "parent-changed": false,
    "source-not-found": false,
    "source-symlink": false,
    "source-not-supported": false,
    "source-open-failure": false,
    "source-changed": false,
    "destination-exists": false,
    "destination-inspection-failure": false,
    "cross-device": false,
    "rename-failure": false,
    "commit-uncertain": true,
    "durability-failure": true,
    "close-failure": true,
  } as const satisfies Readonly<Record<DurableResourceRenameErrorReason, boolean>>;
  for (const reason of Object.keys(expected) as DurableResourceRenameErrorReason[]) {
    equal(
      new DurableResourceRenameError(reason, "$test").commitUncertain,
      expected[reason],
      reason,
    );
  }
});
