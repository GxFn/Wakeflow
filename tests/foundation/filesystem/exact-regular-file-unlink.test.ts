import { deepEqual, equal, rejects } from "node:assert/strict";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { type FileHandle, open as openFileHandle } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  ExactRegularFileUnlinkError,
  type ExactRegularFileUnlinkErrorReason,
  type ExactRegularFileUnlinkOptions,
  unlinkRegularFileExactly,
} from "../../../src/foundation/filesystem/exact-regular-file-unlink.js";
import {
  type PortableResourcePath,
  parsePortableResourcePath,
} from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  RootedExactResourceHandle,
  RootedExactResourceHandleError,
} from "../../../src/foundation/filesystem/rooted-exact-resource-handle.js";
import { RootedResourceParentHandle } from "../../../src/foundation/filesystem/rooted-resource-parent-handle.js";
import { OperationAbortedError } from "../../../src/foundation/node/abort-signal.js";
import { countFsyncs } from "./fsync-count-probe.js";

/**
 * Level 1 (component): 指定普通文件路径名的耐久删除——2→1 与 1→0 的链接数转换、结算策略、过时预期、
 * 不合格的源与父目录链、被动准入的选项，以及持久性：`fsync` 级别恰好一次同步、落在父目录上且发生在
 * 删除之后（同步时路径已经不在），`none` 不同步；父目录同步失败报 `durability-failure`、源句柄关闭失败
 * 报 `close-failure`，两者都不把已经发生的删除说成成功（1.4.1 第 1 段清单 2.1 节）。数同步的用例在
 * 真实同步的根上打开。
 */

interface FileHandleSyncPrototype {
  sync: (this: FileHandle) => Promise<void>;
}

/** `FileHandle` 没有公开构造器，只能从一个真实句柄取到原型；探针文件建完即删。 */
async function fileHandlePrototype(scratchDirectory: string): Promise<FileHandleSyncPrototype> {
  const probePath = path.join(scratchDirectory, ".file-handle-probe");
  const probe = await openFileHandle(probePath, "w");
  const prototype = Object.getPrototypeOf(probe) as FileHandleSyncPrototype;
  await probe.close();
  rmSync(probePath);
  return prototype;
}

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

test("fsync durability syncs only the parent directory, exactly once, after the pathname is gone", {
  concurrency: false,
}, async (t) => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-unlink-fsync-"));
  writeFileSync(path.join(rootPath, "only"), "parent-sync");
  const root = await RootedDirectory.open(rootPath, "$root", { durability: "fsync" });
  const resourcePath = parsePortableResourcePath("only");
  const resourceAbsolutePath = path.join(root.absolutePath, resourcePath);
  // 每次父目录同步时路径名还在不在：同步挪到删除之前，这里会记下 present。
  const atParentSync: string[] = [];
  const originalSync = RootedResourceParentHandle.prototype.sync;
  t.mock.method(
    RootedResourceParentHandle.prototype,
    "sync",
    async function observedSync(this: RootedResourceParentHandle) {
      if (this.resourceAbsolutePath === resourceAbsolutePath) {
        atParentSync.push(existsSync(resourceAbsolutePath) ? "present" : "absent");
      }
      return originalSync.call(this);
    },
  );
  try {
    const expected = await root.inspectExistingResource(resourcePath);
    const counted = await countFsyncs(() =>
      unlinkRegularFileExactly(root, resourcePath, { expectedNode: expected.node }),
    );
    // 被删的文件不再单独同步：唯一的一次落在父目录上，且在删除之后。
    equal(counted.syncCount, 1);
    equal(counted.directorySyncCount, 1);
    deepEqual(atParentSync, ["absent"]);
    equal(counted.result.nodeAfterUnlink.linkCount, 0n);
    equal(statSync(path.join(rootPath, "only"), { throwIfNoEntry: false }), undefined);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("a failed parent sync after the unlink reports durability-failure, never a receipt", {
  concurrency: false,
}, async (t) => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-unlink-sync-failure-"));
  t.after(() => rmSync(rootPath, { recursive: true, force: true }));
  writeFileSync(path.join(rootPath, "only"), "sync-failure");
  const root = await RootedDirectory.open(rootPath, "$root", { durability: "fsync" });
  const prototype = await fileHandlePrototype(rootPath);
  const originalSync = prototype.sync;
  t.mock.method(prototype, "sync", async function failingDirectorySync(this: FileHandle) {
    if ((await this.stat()).isDirectory()) {
      throw Object.assign(new Error("injected directory sync failure"), { code: "EIO" });
    }
    return originalSync.call(this);
  });
  try {
    const resourcePath = parsePortableResourcePath("only");
    const expected = await root.inspectExistingResource(resourcePath);
    await expectUnlinkError(
      () => unlinkRegularFileExactly(root, resourcePath, { expectedNode: expected.node }),
      "durability-failure",
      "$resourcePath",
    );
    // 删除已经发生；没有落盘的保证，所以调用方拿到的是失败而不是回执。
    equal(statSync(path.join(rootPath, "only"), { throwIfNoEntry: false }), undefined);
  } finally {
    await root.close();
  }
});

test("a failed source handle close after the unlink reports close-failure", {
  concurrency: false,
}, async (t) => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-unlink-close-failure-"));
  t.after(() => rmSync(rootPath, { recursive: true, force: true }));
  writeFileSync(path.join(rootPath, "only"), "close-failure");
  const root = await RootedDirectory.open(rootPath);
  // 源句柄照样关掉（不泄漏描述符），再报出关闭失败。
  const originalClose = RootedExactResourceHandle.prototype.close;
  t.mock.method(
    RootedExactResourceHandle.prototype,
    "close",
    async function failingClose(this: RootedExactResourceHandle) {
      await originalClose.call(this);
      throw new RootedExactResourceHandleError("close-failure", "$resourcePath");
    },
  );
  try {
    const resourcePath = parsePortableResourcePath("only");
    const expected = await root.inspectExistingResource(resourcePath);
    await expectUnlinkError(
      () => unlinkRegularFileExactly(root, resourcePath, { expectedNode: expected.node }),
      "close-failure",
      "$resourcePath",
    );
    equal(statSync(path.join(rootPath, "only"), { throwIfNoEntry: false }), undefined);
  } finally {
    await root.close();
  }
});

test("per-call durability none skips every sync with the same receipt", {
  concurrency: false,
}, async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-unlink-nosync-"));
  writeFileSync(path.join(rootPath, "only"), "no-sync");
  const root = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath("only");
    const expected = await root.inspectExistingResource(resourcePath);
    const counted = await countFsyncs(() =>
      unlinkRegularFileExactly(root, resourcePath, {
        expectedNode: expected.node,
        durability: "none",
      }),
    );
    equal(counted.syncCount, 0);
    equal(counted.result.replacementObserved, false);
    equal(counted.result.nodeAfterUnlink.linkCount, 0n);
    equal(statSync(path.join(rootPath, "only"), { throwIfNoEntry: false }), undefined);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("replacement-allowed settlement without a successor observes no replacement", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-unlink-successor-"));
  writeFileSync(path.join(rootPath, "only"), "lock");
  const root = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath("only");
    const expected = await root.inspectExistingResource(resourcePath);
    const receipt = await unlinkRegularFileExactly(root, resourcePath, {
      expectedNode: expected.node,
      settlement: "replacement-allowed",
    });
    equal(receipt.replacementObserved, false);
    equal(receipt.nodeAfterUnlink.linkCount, 0n);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("stale expected node never removes a changed file", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-unlink-stale-"));
  const target = path.join(rootPath, "file");
  writeFileSync(target, "before");
  const root = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath("file");
    const expected = await root.inspectExistingResource(resourcePath);
    writeFileSync(target, "after-change");
    await expectUnlinkError(
      () =>
        unlinkRegularFileExactly(root, resourcePath, {
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
    const fileNode = (await root.inspectExistingResource(parsePortableResourcePath("target"))).node;
    await expectUnlinkError(
      () =>
        unlinkRegularFileExactly(root, parsePortableResourcePath("missing"), {
          expectedNode: fileNode,
        }),
      "source-not-found",
      "$resourcePath",
    );

    for (const [name, reason] of [
      ["directory", "source-not-file"],
      ["link", "source-symlink"],
    ] as const) {
      const inspected = await root.inspectExistingResource(parsePortableResourcePath(name));
      await expectUnlinkError(
        () =>
          unlinkRegularFileExactly(root, parsePortableResourcePath(name), {
            expectedNode: inspected.node,
          }),
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
    const expected = await root.inspectExistingResource(parsePortableResourcePath("target"));
    const cases: readonly [string, ExactRegularFileUnlinkErrorReason][] = [
      ["missing/source", "parent-not-found"],
      ["file-parent/source", "parent-not-directory"],
      ["link-parent/source", "parent-symlink"],
    ];
    for (const [candidate, reason] of cases) {
      await expectUnlinkError(
        () =>
          unlinkRegularFileExactly(root, parsePortableResourcePath(candidate), {
            expectedNode: expected.node,
          }),
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
      [{ expectedNode: expected.node, durability: "bogus" }, "$options.durability"],
      [{ expectedNode: expected.node, signal: {} }, "$options.signal"],
    ];
    for (const [options, expectedPath] of invalid) {
      await expectUnlinkError(
        () => unlinkRegularFileExactly(root, resourcePath, asOptions(options)),
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
      () =>
        unlinkRegularFileExactly(root, asPortableResourcePath("../escape"), {
          expectedNode: expected.node,
        }),
      "input",
      "$resourcePath",
    );

    const controller = new AbortController();
    controller.abort("private-unlink-reason");
    await rejects(
      () =>
        unlinkRegularFileExactly(root, resourcePath, {
          expectedNode: expected.node,
          signal: controller.signal,
        }),
      (error: unknown) =>
        error instanceof OperationAbortedError && !error.message.includes("private-unlink-reason"),
    );
    equal(readFileSync(path.join(rootPath, "file"), "utf8"), "value");
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("commitUncertain is true exactly for the reasons raised after the unlink call", () => {
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
    "source-not-file": false,
    "source-open-failure": false,
    "source-changed": false,
    "unlink-failure": false,
    "commit-uncertain": true,
    "durability-failure": true,
    "close-failure": true,
  } as const satisfies Readonly<Record<ExactRegularFileUnlinkErrorReason, boolean>>;
  for (const reason of Object.keys(expected) as ExactRegularFileUnlinkErrorReason[]) {
    equal(
      new ExactRegularFileUnlinkError(reason, "$test").commitUncertain,
      expected[reason],
      reason,
    );
  }
});
