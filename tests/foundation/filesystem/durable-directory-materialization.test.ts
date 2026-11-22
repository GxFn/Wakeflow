import { deepEqual, equal } from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { open as openFileHandle } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import {
  createDirectoryAtomically,
  createTreeCandidateDirectoryAtomically,
  DurableDirectoryMaterializationError,
  type DurableDirectoryMaterializationErrorReason,
  type DurableDirectoryOptions,
  materializeDirectoryPath,
} from "../../../src/foundation/filesystem/durable-directory-materialization.js";
import { filesystemMutation } from "../../../src/foundation/filesystem/filesystem-mutation.js";
import {
  type PortableResourcePath,
  parsePortableResourcePath,
} from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { disposableRoot } from "../../support/temp-root.js";
import { countFsyncs } from "./fsync-count-probe.js";

/**
 * Level 1 (component): rooted directory creation and path materialization - absent-only atomic
 * create, mode hardening through the handle, idempotent multi-level materialization, collisions,
 * and the syncs of a standalone new directory (1.4.1 stage 1, stage 1-2 lists §2.1 row
 * "单独新建一个目录", record-kind table §3), with the inode each sync reached. A requested mode
 * that grants the owner read, write and search is the mkdir mode itself: under umask 022 a 0755
 * directory is born 0755, gets no chmod and costs one sync, of its parent; under umask 077 it is
 * born 0700, is chmod-ed and costs two, itself first and then its parent. A 0700 directory costs
 * one sync under both. A directory that already exists and a tree-candidate directory cost none,
 * and so does any create on a `none` root. The cases that depend on the umask set it themselves
 * and restore it (every test file runs in its own process). The roots here stay at the default
 * `fsync` level unless a case opens one at `none`; this file does not call
 * `useDisposableDurability`.
 */

async function expectDirectoryError(
  action: () => unknown | Promise<unknown>,
  reason: DurableDirectoryMaterializationErrorReason,
  expectedPath: string,
): Promise<DurableDirectoryMaterializationError> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof DurableDirectoryMaterializationError)) {
    throw new Error("Expected DurableDirectoryMaterializationError.");
  }
  equal(caught.name, "DurableDirectoryMaterializationError");
  equal(caught.code, "wakeflow-durable-directory-materialization");
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
  return caught;
}

function asOptions(value: unknown): DurableDirectoryOptions {
  return value as DurableDirectoryOptions;
}

function asPortableResourcePath(value: unknown): PortableResourcePath {
  return value as PortableResourcePath;
}

test("atomic create publishes one exact durable child directory", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-dir-create-"));
  mkdirSync(path.join(rootPath, "parent"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath("parent/child");
    const result = await createDirectoryAtomically(root, resourcePath, { mode: 0o750 });
    equal(result.resourcePath, resourcePath);
    equal(result.disposition, "created");
    equal(result.node.kind, "directory");
    equal(result.node.permissionBits, 0o750);
    equal(statSync(path.join(rootPath, "parent", "child")).isDirectory(), true);
    equal(statSync(path.join(rootPath, "parent", "child")).mode & 0o777, 0o750);
    equal(Object.isFrozen(result), true);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("a zero-permission directory is hardened through its open handle", async (t) => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-dir-sealed-"));
  const root = await RootedDirectory.open(rootPath);
  const observed = await observeDirectoryBirths(t);
  try {
    const result = await createDirectoryAtomically(root, parsePortableResourcePath("sealed"), {
      mode: 0,
    });
    // 请求缺少属主读写进入：仍以 0700 出生（否则打不开句柄），再经句柄 chmod 到 0。
    const taken = observed.take();
    deepEqual(
      taken.births.map((birth) => birth.requested),
      [0o700],
    );
    equal(taken.chmodCalls, 1);
    equal(result.node.kind, "directory");
    equal(result.node.permissionBits, 0);
    equal(statSync(path.join(rootPath, "sealed")).mode & 0o777, 0);
  } finally {
    await root.close();
    if (existsSync(path.join(rootPath, "sealed"))) {
      chmodSync(path.join(rootPath, "sealed"), 0o700);
    }
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("atomic create is absent-only and concurrent calls have one winner", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-dir-race-"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath("directory");
    const attempts = await Promise.allSettled([
      createDirectoryAtomically(root, resourcePath, { mode: 0o700 }),
      createDirectoryAtomically(root, resourcePath, { mode: 0o700 }),
    ]);
    equal(attempts.filter((entry) => entry.status === "fulfilled").length, 1);
    const rejected = attempts.find((entry) => entry.status === "rejected");
    if (rejected?.status !== "rejected") throw new Error("Expected rejection.");
    if (!(rejected.reason instanceof DurableDirectoryMaterializationError)) {
      throw new Error("Expected DurableDirectoryMaterializationError.");
    }
    equal(rejected.reason.reason, "target-exists");
    equal(statSync(path.join(rootPath, "directory")).isDirectory(), true);

    await expectDirectoryError(
      () => createDirectoryAtomically(root, resourcePath, { mode: 0o700 }),
      "target-exists",
      "$resourcePath",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("multi-level materialization records created segments and is idempotent", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-dir-path-"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath("a/b/c");
    const first = await materializeDirectoryPath(root, resourcePath, {
      mode: 0o700,
    });
    deepEqual(
      first.segments.map((entry) => [
        entry.resourcePath,
        entry.disposition,
        entry.node.permissionBits,
      ]),
      [
        ["a", "created", 0o700],
        ["a/b", "created", 0o700],
        ["a/b/c", "created", 0o700],
      ],
    );
    equal(first.resourcePath, resourcePath);
    equal(first.node.kind, "directory");
    equal(Object.isFrozen(first), true);
    equal(Object.isFrozen(first.segments), true);

    const second = await materializeDirectoryPath(root, resourcePath, {
      mode: 0o755,
    });
    deepEqual(
      second.segments.map((entry) => entry.disposition),
      ["existing", "existing", "existing"],
    );
    deepEqual(
      second.segments.map((entry) => entry.node.permissionBits),
      [0o700, 0o700, 0o700],
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("existing directory modes are observed while only missing segments use mode", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-dir-mode-"));
  mkdirSync(path.join(rootPath, "existing"), { mode: 0o755 });
  chmodSync(path.join(rootPath, "existing"), 0o755);
  const root = await RootedDirectory.open(rootPath);
  try {
    const result = await materializeDirectoryPath(
      root,
      parsePortableResourcePath("existing/private/leaf"),
      { mode: 0o700 },
    );
    deepEqual(
      result.segments.map((entry) => [entry.disposition, entry.node.permissionBits]),
      [
        ["existing", 0o755],
        ["created", 0o700],
        ["created", 0o700],
      ],
    );
    equal(statSync(path.join(rootPath, "existing")).mode & 0o777, 0o755);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("file and symlink collisions fail without modifying the conflicting node", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-dir-type-"));
  const outside = mkdtempSync(path.join(os.tmpdir(), "wakeflow-dir-outside-"));
  writeFileSync(path.join(rootPath, "file"), "value");
  symlinkSync(outside, path.join(rootPath, "link"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const cases: readonly [string, DurableDirectoryMaterializationErrorReason][] = [
      ["file/child", "target-not-directory"],
      ["link/child", "target-symlink"],
    ];
    for (const [candidate, reason] of cases) {
      await expectDirectoryError(
        () => materializeDirectoryPath(root, parsePortableResourcePath(candidate), { mode: 0o700 }),
        reason,
        "$resourcePath",
      );
    }
    equal(readFileSync(path.join(rootPath, "file"), "utf8"), "value");
    equal(lstatSync(path.join(rootPath, "link")).isSymbolicLink(), true);
    equal(existsSync(path.join(outside, "child")), false);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("atomic create requires an existing real parent", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-dir-parent-"));
  const outside = mkdtempSync(path.join(os.tmpdir(), "wakeflow-dir-parent-out-"));
  writeFileSync(path.join(rootPath, "file-parent"), "value");
  symlinkSync(outside, path.join(rootPath, "link-parent"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const cases: readonly [string, DurableDirectoryMaterializationErrorReason][] = [
      ["missing/child", "parent-not-found"],
      ["file-parent/child", "parent-not-directory"],
      ["link-parent/child", "parent-symlink"],
    ];
    for (const [candidate, reason] of cases) {
      await expectDirectoryError(
        () =>
          createDirectoryAtomically(root, parsePortableResourcePath(candidate), { mode: 0o700 }),
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

test("options and AbortSignal are closed and passively admitted", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-dir-input-"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath("directory");
    const invalid: readonly [unknown, string][] = [
      [{}, "$options"],
      [{ mode: 0o700, extra: true }, "$options"],
      [{ mode: -1 }, "$options.mode"],
      [{ mode: 0o1000 }, "$options.mode"],
      [{ mode: 0o700, signal: {} }, "$options.signal"],
    ];
    for (const [options, expectedPath] of invalid) {
      await expectDirectoryError(
        () => createDirectoryAtomically(root, resourcePath, asOptions(options)),
        "input",
        expectedPath,
      );
    }

    let getterCalls = 0;
    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, "mode", {
      get: () => {
        getterCalls += 1;
        return 0o700;
      },
      enumerable: true,
    });
    await expectDirectoryError(
      () => createDirectoryAtomically(root, resourcePath, asOptions(accessor)),
      "input",
      "$options",
    );
    equal(getterCalls, 0);

    await expectDirectoryError(
      () => createDirectoryAtomically(root, asPortableResourcePath("../escape"), { mode: 0o700 }),
      "input",
      "$resourcePath",
    );

    const controller = new AbortController();
    controller.abort("private-directory-abort");
    const error = await expectDirectoryError(
      () =>
        materializeDirectoryPath(root, resourcePath, {
          mode: 0o700,
          signal: controller.signal,
        }),
      "aborted",
      "$signal",
    );
    equal(error.message.includes("private-directory-abort"), false);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

interface FileHandleSyncPrototype {
  sync: (this: unknown) => Promise<void>;
  stat: (this: unknown) => Promise<{ ino: number }>;
  chmod: (this: unknown, mode: number) => Promise<void>;
}

async function fileHandleSyncPrototype(): Promise<FileHandleSyncPrototype> {
  const probe = await openFileHandle(process.execPath, "r");
  const prototype = Object.getPrototypeOf(probe) as FileHandleSyncPrototype;
  await probe.close();
  return prototype;
}

/**
 * 按发生顺序记录 `run` 期间每次 `fsync` 落在哪个 inode 上。记录包在 `countFsyncs` 里面，
 * 两者看到同一批调用；两个补丁都在返回前还原。
 */
async function recordSyncInodes<Result>(
  run: () => Promise<Result>,
): Promise<{ result: Result; inodes: number[]; syncCount: number }> {
  const prototype = await fileHandleSyncPrototype();
  const inodes: number[] = [];
  const counted = await countFsyncs(async () => {
    const countingSync = prototype.sync;
    prototype.sync = async function recordedSync(this: unknown): Promise<void> {
      inodes.push(Number((await prototype.stat.call(this)).ino));
      return countingSync.call(this);
    };
    try {
      return await run();
    } finally {
      prototype.sync = countingSync;
    }
  });
  return { result: counted.result, inodes, syncCount: counted.syncCount };
}

interface DirectoryBirth {
  /** 传给 `mkdir` 的权限位。 */
  readonly requested: number;
  /** `mkdir` 刚返回时盘上的权限位（已被 umask 收窄）。 */
  readonly born: number;
}

/**
 * 记录每次经 `filesystemMutation.mkdir` 新建目录时传入与出生的权限位，并数句柄上的
 * chmod；`take` 取走此前的记录并清零。两个替身都随测试结束还原。
 */
async function observeDirectoryBirths(t: TestContext): Promise<{
  take: () => { births: DirectoryBirth[]; chmodCalls: number };
}> {
  const births: DirectoryBirth[] = [];
  const originalMkdir = filesystemMutation.mkdir;
  t.mock.method(
    filesystemMutation,
    "mkdir",
    async (target: string, options: Parameters<typeof originalMkdir>[1]) => {
      await originalMkdir(target, options);
      births.push({ requested: options.mode, born: lstatSync(target).mode & 0o777 });
    },
  );
  const chmod = t.mock.method(await fileHandleSyncPrototype(), "chmod");
  return {
    take: () => {
      const taken = { births: births.splice(0), chmodCalls: chmod.mock.callCount() };
      chmod.mock.resetCalls();
      return taken;
    },
  };
}

/** 在 `mask` 下执行 `run`，结束时还原进程原来的 umask。 */
async function underUmask<Result>(mask: number, run: () => Promise<Result>): Promise<Result> {
  const previous = process.umask(mask);
  try {
    return await run();
  } finally {
    process.umask(previous);
  }
}

async function reopenedPermissionBits(rootPath: string, resource: string): Promise<number> {
  const reopened = await RootedDirectory.open(rootPath, "$root", { durability: "fsync" });
  try {
    const { node } = await reopened.inspectExistingResource(parsePortableResourcePath(resource));
    return node.permissionBits;
  } finally {
    await reopened.close();
  }
}

test("under umask 022 a standalone 0755 directory is born 0755 and syncs only its parent, a 0700 one too; an existing one, a tree-candidate one born 0755 and a create on a none root sync nothing", {
  concurrency: false,
}, async (t) => {
  const rootPath = disposableRoot(t, "wakeflow-directory-syncs-022-");
  const root = await RootedDirectory.open(rootPath, "$root", { durability: "fsync" });
  t.after(() => root.close());
  const inodeOf = (...segments: string[]) =>
    Number(lstatSync(path.join(rootPath, ...segments)).ino);
  const options = { mode: 0o755 } as const;
  const observed = await observeDirectoryBirths(t);

  await underUmask(0o022, async () => {
    // 0700 私有目录：以 0700 出生，不 chmod，只同步父目录一次。
    const privateDirectory = await recordSyncInodes(() =>
      createDirectoryAtomically(root, parsePortableResourcePath("private"), { mode: 0o700 }),
    );
    equal(privateDirectory.syncCount, 1);
    deepEqual(privateDirectory.inodes, [inodeOf()]);
    deepEqual(observed.take(), { births: [{ requested: 0o700, born: 0o700 }], chmodCalls: 0 });

    // 0755：mkdir 直接以 0755 出生，条目与权限位由同一次 mkdir 写下；不 chmod，不同步
    // 新目录自己，只同步父目录一次。
    const single = await recordSyncInodes(() =>
      createDirectoryAtomically(root, parsePortableResourcePath("single"), options),
    );
    equal(single.syncCount, 1);
    deepEqual(single.inodes, [inodeOf()]);
    deepEqual(observed.take(), { births: [{ requested: 0o755, born: 0o755 }], chmodCalls: 0 });
    equal(await reopenedPermissionBits(rootPath, "single"), 0o755);

    // 两个缺失段各一次，落在各自的父目录上；已经存在的首段不花同步。
    const nested = await recordSyncInodes(() =>
      materializeDirectoryPath(root, parsePortableResourcePath("single/a/b"), options),
    );
    deepEqual(
      nested.result.segments.map((segment) => segment.disposition),
      ["existing", "created", "created"],
    );
    equal(nested.syncCount, 2);
    deepEqual(nested.inodes, [inodeOf("single"), inodeOf("single", "a")]);
    equal(observed.take().chmodCalls, 0);

    const existing = await recordSyncInodes(() =>
      materializeDirectoryPath(root, parsePortableResourcePath("single/a/b"), options),
    );
    equal(existing.syncCount, 0);

    // 目录树候选用同一条出生规则：以 0755 出生，没有要树来覆盖的 chmod，一次都不同步。
    const deferred = await recordSyncInodes(() =>
      createTreeCandidateDirectoryAtomically(root, parsePortableResourcePath("tree"), options),
    );
    equal(deferred.syncCount, 0);
    deepEqual(observed.take(), { births: [{ requested: 0o755, born: 0o755 }], chmodCalls: 0 });
    equal(deferred.result.node.permissionBits, 0o755);
    equal(statSync(path.join(rootPath, "tree")).mode & 0o777, 0o755);

    // `none` 根不发同步，权限位照样是 0755。
    const lightRoot = await RootedDirectory.open(rootPath, "$root", { durability: "none" });
    try {
      const light = await recordSyncInodes(() =>
        createDirectoryAtomically(lightRoot, parsePortableResourcePath("light"), options),
      );
      equal(light.syncCount, 0);
      equal(light.result.node.permissionBits, 0o755);
    } finally {
      await lightRoot.close();
    }
  });
});

test("under umask 077 a standalone 0755 directory is chmod-ed, syncs itself first and then its parent, a 0700 one still syncs only its parent; a tree-candidate one is chmod-ed without a sync", {
  concurrency: false,
}, async (t) => {
  const rootPath = disposableRoot(t, "wakeflow-directory-syncs-077-");
  const root = await RootedDirectory.open(rootPath, "$root", { durability: "fsync" });
  t.after(() => root.close());
  const inodeOf = (...segments: string[]) =>
    Number(lstatSync(path.join(rootPath, ...segments)).ino);
  const options = { mode: 0o755 } as const;
  const observed = await observeDirectoryBirths(t);

  await underUmask(0o077, async () => {
    // 0700 不受 077 影响：以 0700 出生，不 chmod，只同步父目录一次。
    const privateDirectory = await recordSyncInodes(() =>
      createDirectoryAtomically(root, parsePortableResourcePath("private"), { mode: 0o700 }),
    );
    equal(privateDirectory.syncCount, 1);
    deepEqual(privateDirectory.inodes, [inodeOf()]);
    deepEqual(observed.take(), { births: [{ requested: 0o700, born: 0o700 }], chmodCalls: 0 });

    // 0755 被 umask 收窄成 0700 出生：经句柄 chmod 到 0755，先同步新目录自己让 chmod
    // 落盘，再同步父目录让条目落盘。
    const single = await recordSyncInodes(() =>
      createDirectoryAtomically(root, parsePortableResourcePath("single"), options),
    );
    equal(single.syncCount, 2);
    deepEqual(single.inodes, [inodeOf("single"), inodeOf()]);
    deepEqual(observed.take(), { births: [{ requested: 0o755, born: 0o700 }], chmodCalls: 1 });
    equal(await reopenedPermissionBits(rootPath, "single"), 0o755);

    // 两个缺失段各两次（自己，再父目录）；已经存在的首段不花同步。
    const nested = await recordSyncInodes(() =>
      materializeDirectoryPath(root, parsePortableResourcePath("single/a/b"), options),
    );
    deepEqual(
      nested.result.segments.map((segment) => segment.disposition),
      ["existing", "created", "created"],
    );
    equal(nested.syncCount, 4);
    deepEqual(nested.inodes, [
      inodeOf("single", "a"),
      inodeOf("single"),
      inodeOf("single", "a", "b"),
      inodeOf("single", "a"),
    ]);
    equal(observed.take().chmodCalls, 2);

    // 目录树候选同样 chmod，但不发同步：它的权限位由树在成员写完之后的那次目录同步覆盖。
    const deferred = await recordSyncInodes(() =>
      createTreeCandidateDirectoryAtomically(root, parsePortableResourcePath("tree"), options),
    );
    equal(deferred.syncCount, 0);
    deepEqual(observed.take(), { births: [{ requested: 0o755, born: 0o700 }], chmodCalls: 1 });
    equal(deferred.result.node.permissionBits, 0o755);

    // `none` 根连新目录自己那一次也省掉，权限位照样收紧到 0755。
    const lightRoot = await RootedDirectory.open(rootPath, "$root", { durability: "none" });
    try {
      const light = await recordSyncInodes(() =>
        createDirectoryAtomically(lightRoot, parsePortableResourcePath("light"), options),
      );
      equal(light.syncCount, 0);
      equal(light.result.node.permissionBits, 0o755);
    } finally {
      await lightRoot.close();
    }
  });
});

test("under umask 077 a failed sync of a standalone new directory's own handle is durability-failure, before any parent sync, and leaves the directory in place", {
  concurrency: false,
}, async (t) => {
  const rootPath = disposableRoot(t, "wakeflow-directory-sync-failure-");
  const root = await RootedDirectory.open(rootPath, "$root", { durability: "fsync" });
  t.after(() => root.close());
  const prototype = await fileHandleSyncPrototype();
  const attempted: number[] = [];
  t.mock.method(prototype, "sync", async function failingSync(this: unknown): Promise<void> {
    attempted.push(Number((await prototype.stat.call(this)).ino));
    throw Object.assign(new Error("injected sync failure"), { code: "EIO" });
  });
  try {
    // 077 让 0755 以 0700 出生，chmod 之后才有新目录自己那一次同步。
    await underUmask(0o077, () =>
      expectDirectoryError(
        () => createDirectoryAtomically(root, parsePortableResourcePath("shared"), { mode: 0o755 }),
        "durability-failure",
        "$resourcePath",
      ),
    );
  } finally {
    t.mock.restoreAll();
  }
  // 失败的是新目录自己那一次，父目录没有被同步；本层不回滚，目录留在原地供重试解释。
  deepEqual(attempted, [Number(lstatSync(path.join(rootPath, "shared")).ino)]);
  equal(statSync(path.join(rootPath, "shared")).isDirectory(), true);
});
