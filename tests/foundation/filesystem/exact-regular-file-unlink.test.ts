import { equal } from "node:assert/strict";
import {
  linkSync,
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
  ExactRegularFileUnlinkError,
  unlinkRegularFileExactly,
  type ExactRegularFileUnlinkErrorReason,
  type ExactRegularFileUnlinkOptions,
} from "../../../src/foundation/filesystem/exact-regular-file-unlink.js";
import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";

async function expectUnlinkError(
  action: () => unknown | Promise<unknown>,
  reason: ExactRegularFileUnlinkErrorReason,
  expectedPath: string,
): Promise<ExactRegularFileUnlinkError> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof ExactRegularFileUnlinkError)) {
    throw new Error("Expected ExactRegularFileUnlinkError.");
  }
  equal(caught.name, "ExactRegularFileUnlinkError");
  equal(caught.code, "wakeflow-exact-regular-file-unlink");
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
  return caught;
}

function asOptions(value: unknown): ExactRegularFileUnlinkOptions {
  return value as ExactRegularFileUnlinkOptions;
}

function asPortableResourcePath(value: unknown): PortableResourcePath {
  return value as PortableResourcePath;
}

test("linked-pair cleanup proves the exact 2 to 1 transition", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-unlink-pair-"));
  const sourcePath = path.join(rootPath, "source");
  const destinationPath = path.join(rootPath, "destination");
  writeFileSync(sourcePath, "payload", { mode: 0o640 });
  linkSync(sourcePath, destinationPath);
  const root = await RootedDirectory.open(rootPath);
  try {
    const source = parsePortableResourcePath("source");
    const expected = await root.inspectExistingResource(source);
    const receipt = await unlinkRegularFileExactly(root, source, {
      expectedNode: expected.node,
    });

    equal(receipt.replacementObserved, false);
    equal(receipt.nodeBefore.linkCount, 2n);
    equal(receipt.nodeBefore.inodeId, receipt.nodeAfterUnlink.inodeId);
    equal(receipt.nodeAfterUnlink.linkCount, 1n);
    equal(statSync(sourcePath, { throwIfNoEntry: false }), undefined);
    equal(readFileSync(destinationPath, "utf8"), "payload");
    equal(statSync(destinationPath).nlink, 1);
    equal(Object.isFrozen(receipt), true);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("last pathname removal proves the exact 1 to 0 transition", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-unlink-last-"));
  const target = path.join(rootPath, "only");
  writeFileSync(target, "last-link");
  const root = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath("only");
    const expected = await root.inspectExistingResource(resourcePath);
    const receipt = await unlinkRegularFileExactly(root, resourcePath, {
      expectedNode: expected.node,
    });
    equal(receipt.replacementObserved, false);
    equal(receipt.nodeBefore.linkCount, 1n);
    equal(receipt.nodeAfterUnlink.linkCount, 0n);
    equal(receipt.nodeAfterUnlink.byteCount, Buffer.byteLength("last-link"));
    equal(statSync(target, { throwIfNoEntry: false }), undefined);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("stale expected node never removes the newer pathname", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-unlink-stale-"));
  const target = path.join(rootPath, "file");
  writeFileSync(target, "before");
  const root = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath("file");
    const expected = await root.inspectExistingResource(resourcePath);
    writeFileSync(target, "after-change");
    await expectUnlinkError(
      () => unlinkRegularFileExactly(root, resourcePath, {
        expectedNode: expected.node,
      }),
      "source-changed",
      "$resourcePath",
    );
    equal(readFileSync(target, "utf8"), "after-change");
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("missing, directory, and symlink sources are not unlink candidates", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-unlink-types-"));
  mkdirSync(path.join(rootPath, "directory"));
  writeFileSync(path.join(rootPath, "target"), "value");
  symlinkSync("target", path.join(rootPath, "link"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const fileNode = (await root.inspectExistingResource(
      parsePortableResourcePath("target"),
    )).node;
    await expectUnlinkError(
      () => unlinkRegularFileExactly(
        root,
        parsePortableResourcePath("missing"),
        { expectedNode: fileNode },
      ),
      "source-not-found",
      "$resourcePath",
    );

    for (const [name, reason] of [
      ["directory", "source-not-file"],
      ["link", "source-symlink"],
    ] as const) {
      const inspected = await root.inspectExistingResource(
        parsePortableResourcePath(name),
      );
      await expectUnlinkError(
        () => unlinkRegularFileExactly(
          root,
          parsePortableResourcePath(name),
          { expectedNode: inspected.node },
        ),
        reason,
        "$resourcePath",
      );
    }
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("source requires an existing real parent chain", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-unlink-parent-"));
  const outside = mkdtempSync(path.join(os.tmpdir(), "wakeflow-unlink-parent-out-"));
  writeFileSync(path.join(rootPath, "target"), "value");
  writeFileSync(path.join(rootPath, "file-parent"), "value");
  symlinkSync(outside, path.join(rootPath, "link-parent"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const expected = await root.inspectExistingResource(
      parsePortableResourcePath("target"),
    );
    const cases: readonly [string, ExactRegularFileUnlinkErrorReason][] = [
      ["missing/source", "parent-not-found"],
      ["file-parent/source", "parent-not-directory"],
      ["link-parent/source", "parent-symlink"],
    ];
    for (const [candidate, reason] of cases) {
      await expectUnlinkError(
        () => unlinkRegularFileExactly(
          root,
          parsePortableResourcePath(candidate),
          { expectedNode: expected.node },
        ),
        reason,
        "$resourcePath",
      );
    }
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("options, path, and AbortSignal are closed and passively admitted", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-unlink-input-"));
  writeFileSync(path.join(rootPath, "file"), "value");
  const root = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath("file");
    const expected = await root.inspectExistingResource(resourcePath);
    const invalid: readonly [unknown, string][] = [
      [{}, "$options"],
      [{ expectedNode: expected.node, extra: true }, "$options"],
      [{ expectedNode: { ...expected.node } }, "$options.expectedNode"],
      [{ expectedNode: expected.node, settlement: null }, "$options.settlement"],
      [{ expectedNode: expected.node, settlement: "eventually-absent" }, "$options.settlement"],
      [{ expectedNode: expected.node, signal: {} }, "$options.signal"],
    ];
    for (const [options, expectedPath] of invalid) {
      await expectUnlinkError(
        () => unlinkRegularFileExactly(
          root,
          resourcePath,
          asOptions(options),
        ),
        "input",
        expectedPath,
      );
    }

    let getterCalls = 0;
    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, "expectedNode", {
      get: () => {
        getterCalls += 1;
        return expected.node;
      },
      enumerable: true,
    });
    await expectUnlinkError(
      () => unlinkRegularFileExactly(root, resourcePath, asOptions(accessor)),
      "input",
      "$options",
    );
    equal(getterCalls, 0);

    await expectUnlinkError(
      () => unlinkRegularFileExactly(
        root,
        asPortableResourcePath("../escape"),
        { expectedNode: expected.node },
      ),
      "input",
      "$resourcePath",
    );

    const controller = new AbortController();
    controller.abort("private-unlink-reason");
    const error = await expectUnlinkError(
      () => unlinkRegularFileExactly(root, resourcePath, {
        expectedNode: expected.node,
        signal: controller.signal,
      }),
      "aborted",
      "$signal",
    );
    equal(error.message.includes("private-unlink-reason"), false);
    equal(readFileSync(path.join(rootPath, "file"), "utf8"), "value");
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});
