import { deepEqual, equal } from "node:assert/strict";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { type FileHandle, open as openFileHandle } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  issueDurableAtomicFileStageAddress,
  releaseDurableAtomicFileStageAddress,
} from "../../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import {
  createFileAtomically,
  type DurableAtomicFileCreateOptions,
  type DurableAtomicFileReplaceOptions,
  DurableAtomicFileWriteError,
  type DurableAtomicFileWriteErrorReason,
  replaceFileAtomically,
} from "../../../src/foundation/filesystem/durable-atomic-file-write.js";
import { createFileCandidateDurably } from "../../../src/foundation/filesystem/durable-file-candidate.js";
import { filesystemMutation } from "../../../src/foundation/filesystem/filesystem-mutation.js";
import {
  type PortableResourcePath,
  parsePortableResourcePath,
} from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { RootedResourceParentHandle } from "../../../src/foundation/filesystem/rooted-resource-parent-handle.js";
import { readStableFileDigest } from "../../../src/foundation/filesystem/stable-file-read.js";
import { parseByteCount } from "../../../src/foundation/numeric/byte-count.js";
import { fail as failWakeflow, isWakeflowError } from "../../../src/kernel/error.js";
import { describeIncidentChain } from "../../../src/kernel/incident.js";
import { durableAtomicFileStageRefForTest } from "./durable-atomic-file-test-support.js";
import { countFsyncs } from "./fsync-count-probe.js";

/**
 * Level 1 (component): 单个文件的耐久原子创建与替换——字节、模式、摘要与回执，暂存恢复与清理，
 * 错误分类，以及各档持久性的同步次数与顺序（1.4.1 第 1 段清单 2.1、2.2 节）。数同步的用例在真实
 * 同步的根上打开（显式 `durability: "fsync"`），并钉住内容同步先于发布调用（创建的 `link`、替换的
 * `rename`）、父目录同步落在发布之后（创建两次同步时目标都在、暂存先在后删；替换同步时已经重命名）。
 *
 * 深审之后的几条也钉在这里：`fsync` 级别报 `target-exists` 之前先同步一次父目录（三处：第一次与
 * 第二次“目标不存在”检查、链接的 `EEXIST`），`none` 与 `none` 的根不同步，这次同步
 * 失败时调用方拿不到 `target-exists`；主错误是 `target-exists` 时暂存清理失败要浮上来；替换没有逐次
 * `durability`；过时的替换预期在建暂存之前的一次 `lstat` 预检里失败、磁盘上什么都不留，预检时父目录
 * 已被换走则报 `parent-changed`；内容同步、父目录同步与暂存句柄关闭的失败路径。
 */

async function expectAtomicWriteError(
  action: () => unknown | Promise<unknown>,
  reason: DurableAtomicFileWriteErrorReason,
  expectedPath: string,
): Promise<DurableAtomicFileWriteError> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof DurableAtomicFileWriteError)) {
    throw new Error("Expected DurableAtomicFileWriteError.");
  }
  equal(caught.name, "DurableAtomicFileWriteError");
  equal(caught.code, "wakeflow-durable-atomic-file-write");
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
  return caught;
}

function directoryNames(directory: string): readonly string[] {
  return Object.freeze(
    readdirSync(directory).filter((name) => name.startsWith(".wakeflow-atomic-")),
  );
}

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

function injectedFailure(message: string): Error {
  return Object.assign(new Error(message), { code: "EIO" });
}

/**
 * 只记目标父目录上的同步：每次同步时调用 `observe`，再转调原方法。每个用例只装一次（同一个方法上
 * 叠两层 mock，按装入顺序还原时会把外层留在原型上），目标路径由 `targetAbsolutePath` 每次现取。
 */
function observeTargetParentSyncs(
  t: TestContext,
  targetAbsolutePath: () => string,
  observe: () => void,
): void {
  const originalSync = RootedResourceParentHandle.prototype.sync;
  t.mock.method(
    RootedResourceParentHandle.prototype,
    "sync",
    async function observedSync(this: RootedResourceParentHandle) {
      if (this.resourceAbsolutePath === targetAbsolutePath()) observe();
      return originalSync.call(this);
    },
  );
}

/** 执行 `run`，把它抛出的原子写错误的 reason 记进 `events`；其他错误原样抛出。 */
async function recordWriteError(events: string[], run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error: unknown) {
    if (!(error instanceof DurableAtomicFileWriteError)) throw error;
    events.push(`error:${error.reason}:${error.path}`);
  }
}

/**
 * 数同步的同时钉住顺序：发布调用（创建的 `link`、替换的 `rename`）真正执行的那一刻，
 * 已经发生过几次同步。`countFsyncs` 在外层改写 `FileHandle.prototype.sync`，这里在它之内
 * 再包一层自己的计数，并在 `filesystemMutation` 的发布方法上记下当时的计数；两层都在
 * `finally` 里按相反顺序还原。
 */
async function countFsyncsWithPublicationOrder<Result>(
  t: TestContext,
  scratchDirectory: string,
  publication: "link" | "rename",
  run: () => Promise<Result>,
) {
  const prototype = await fileHandlePrototype(scratchDirectory);
  const syncsAtPublication: number[] = [];
  const counted = await countFsyncs(async () => {
    const outerSync = prototype.sync;
    let syncsSoFar = 0;
    prototype.sync = async function orderedSync(this: FileHandle): Promise<void> {
      syncsSoFar += 1;
      return outerSync.call(this);
    };
    const original = filesystemMutation[publication];
    const mocked = t.mock.method(
      filesystemMutation,
      publication,
      async (from: string, to: string) => {
        syncsAtPublication.push(syncsSoFar);
        return original.call(filesystemMutation, from, to);
      },
    );
    try {
      return await run();
    } finally {
      mocked.mock.restore();
      prototype.sync = outerSync;
    }
  });
  return Object.freeze({ ...counted, syncsAtPublication: Object.freeze(syncsAtPublication) });
}

function asCreateOptions(value: unknown): DurableAtomicFileCreateOptions {
  return value as DurableAtomicFileCreateOptions;
}

function asReplaceOptions(value: unknown): DurableAtomicFileReplaceOptions {
  return value as DurableAtomicFileReplaceOptions;
}

function asPortableResourcePath(value: unknown): PortableResourcePath {
  return value as PortableResourcePath;
}

test("atomic create publishes exact bytes, mode, digest, and no stage residue", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-atomic-create-"));
  mkdirSync(path.join(rootPath, "records"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath("records/state.bin");
    const bytes = Buffer.from("first-state\n", "utf8");
    const result = await createFileAtomically(root, resourcePath, bytes, {
      mode: 0o640,
    });

    equal(result.publication, "created");
    equal(result.resourcePath, resourcePath);
    deepEqual(readFileSync(path.join(rootPath, resourcePath)), bytes);
    equal(statSync(path.join(rootPath, resourcePath)).mode & 0o777, 0o640);
    equal(result.node.kind, "file");
    equal(result.node.permissionBits, 0o640);
    equal(result.byteCount, bytes.byteLength);
    equal(result.digest, computeSha256Digest(bytes));
    equal(Object.isFrozen(result), true);
    deepEqual(directoryNames(path.join(rootPath, "records")), []);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("none 级别的根不执行任何 fsync，字节与回执与 fsync 级别完全一致", {
  concurrency: false,
}, async (t) => {
  const durablePath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-atomic-durability-fsync-"));
  const disposablePath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-atomic-durability-none-"));
  t.after(() => {
    rmSync(durablePath, { recursive: true, force: true });
    rmSync(disposablePath, { recursive: true, force: true });
  });

  const durableRoot = await RootedDirectory.open(durablePath, "$root", {
    durability: "fsync",
  });
  const disposableRoot = await RootedDirectory.open(disposablePath, "$root", {
    durability: "none",
  });
  const resourcePath = parsePortableResourcePath("state.bin");
  const bytes = Buffer.from("durability-level\n", "utf8");

  function writeCountingSyncs(root: RootedDirectory) {
    return countFsyncs(() => createFileAtomically(root, resourcePath, bytes, { mode: 0o640 }));
  }

  try {
    const durable = await writeCountingSyncs(durableRoot);
    const disposable = await writeCountingSyncs(disposableRoot);

    equal(disposable.syncCount, 0);
    // fsync 级别的新建恰好三次：暂存内容一次，链接之后与删暂存之后各一次父目录。
    equal(durable.syncCount, 3);
    equal(durable.directorySyncCount, 2);
    // 字节、权限位与提交后残留都必须与 fsync 级别一模一样：`none` 只省掉同步调用。
    deepEqual(readFileSync(path.join(disposablePath, resourcePath)), bytes);
    deepEqual(
      readFileSync(path.join(disposablePath, resourcePath)),
      readFileSync(path.join(durablePath, resourcePath)),
    );
    equal(
      statSync(path.join(disposablePath, resourcePath)).mode & 0o777,
      statSync(path.join(durablePath, resourcePath)).mode & 0o777,
    );
    deepEqual(directoryNames(disposablePath), []);
    deepEqual(directoryNames(durablePath), []);
    // 回执形状不随级别变化：同样的键集合、同样的冻结、同样的事实字段。
    deepEqual(Object.keys(disposable.result).sort(), Object.keys(durable.result).sort());
    equal(Object.isFrozen(disposable.result), true);
    equal(disposable.result.publication, durable.result.publication);
    equal(disposable.result.resourcePath, durable.result.resourcePath);
    equal(disposable.result.byteCount, durable.result.byteCount);
    equal(disposable.result.digest, durable.result.digest);
    equal(disposable.result.node.kind, durable.result.node.kind);
    equal(disposable.result.node.linkCount, durable.result.node.linkCount);
    equal(disposable.result.node.permissionBits, durable.result.node.permissionBits);
    equal(disposable.result.node.byteCount, durable.result.node.byteCount);
  } finally {
    await durableRoot.close();
    await disposableRoot.close();
  }
});

test("替换没有逐次 durability：带这个键就是非法输入，替换只跟随根的级别（fsync 的根两次，none 的根零次）", {
  concurrency: false,
}, async (t) => {
  const durablePath = mkdtempSync(
    path.join(os.tmpdir(), "wakeflow-atomic-replace-durability-fsync-"),
  );
  const disposablePath = mkdtempSync(
    path.join(os.tmpdir(), "wakeflow-atomic-replace-durability-none-"),
  );
  t.after(() => {
    rmSync(durablePath, { recursive: true, force: true });
    rmSync(disposablePath, { recursive: true, force: true });
  });
  writeFileSync(path.join(durablePath, "state"), "before", { mode: 0o600 });
  writeFileSync(path.join(disposablePath, "state"), "before", { mode: 0o600 });

  const durableRoot = await RootedDirectory.open(durablePath, "$root", {
    durability: "fsync",
  });
  const disposableRoot = await RootedDirectory.open(disposablePath, "$root", {
    durability: "none",
  });
  const resourcePath = parsePortableResourcePath("state");
  const bytes = Buffer.from("after-state", "utf8");

  async function replaceCountingSyncs(root: RootedDirectory) {
    const expected = await readStableFileDigest(root, resourcePath, {
      maximumBytes: parseByteCount(1024),
    });
    return countFsyncs(() =>
      replaceFileAtomically(root, resourcePath, bytes, { mode: 0o600, expected }),
    );
  }

  try {
    // 档表没有要降档的替换（锁不替换）：任何取值的 durability 键，连 `fsync` 在内，都是非法输入，
    // 不是一次悄悄的降档；目标保持原样。
    const expected = await readStableFileDigest(durableRoot, resourcePath, {
      maximumBytes: parseByteCount(1024),
    });
    for (const durability of ["fsync", "none", "bogus"]) {
      await expectAtomicWriteError(
        () =>
          replaceFileAtomically(
            durableRoot,
            resourcePath,
            bytes,
            asReplaceOptions({ mode: 0o600, expected, durability }),
          ),
        "input",
        "$options",
      );
    }
    equal(readFileSync(path.join(durablePath, "state"), "utf8"), "before");
    deepEqual(directoryNames(durablePath), []);

    // fsync 的根恰好两次（暂存内容、重命名之后的父目录），none 的根一次都不同步。
    const durable = await replaceCountingSyncs(durableRoot);
    equal(durable.syncCount, 2);
    equal(durable.directorySyncCount, 1);
    equal(durable.result.publication, "replaced");
    deepEqual(readFileSync(path.join(durablePath, "state")), bytes);
    deepEqual(directoryNames(durablePath), []);

    const disposable = await replaceCountingSyncs(disposableRoot);
    equal(disposable.syncCount, 0);
    equal(disposable.result.publication, "replaced");
    deepEqual(readFileSync(path.join(disposablePath, "state")), bytes);
    deepEqual(directoryNames(disposablePath), []);
    equal(
      statSync(path.join(disposablePath, "state")).mode & 0o777,
      statSync(path.join(durablePath, "state")).mode & 0o777,
    );
  } finally {
    await durableRoot.close();
    await disposableRoot.close();
  }
});

test("创建的逐次 durability：none 一次都不同步，none 级别的根上任何取值都不同步", {
  concurrency: false,
}, async (t) => {
  const durablePath = mkdtempSync(
    path.join(os.tmpdir(), "wakeflow-atomic-create-durability-fsync-"),
  );
  const disposablePath = mkdtempSync(
    path.join(os.tmpdir(), "wakeflow-atomic-create-durability-none-"),
  );
  t.after(() => {
    rmSync(durablePath, { recursive: true, force: true });
    rmSync(disposablePath, { recursive: true, force: true });
  });
  const durableRoot = await RootedDirectory.open(durablePath, "$root", {
    durability: "fsync",
  });
  const disposableRoot = await RootedDirectory.open(disposablePath, "$root", {
    durability: "none",
  });
  const bytes = Buffer.from("create-level\n", "utf8");
  const levels = [undefined, "fsync", "none"] as const;

  try {
    const perCallNone = await countFsyncs(() =>
      createFileAtomically(durableRoot, parsePortableResourcePath("none"), bytes, {
        mode: 0o600,
        durability: "none",
      }),
    );
    equal(perCallNone.syncCount, 0);

    for (const [index, durability] of levels.entries()) {
      const disposable = await countFsyncs(() =>
        createFileAtomically(disposableRoot, parsePortableResourcePath(`level-${index}`), bytes, {
          mode: 0o600,
          ...(durability === undefined ? {} : { durability }),
        }),
      );
      equal(disposable.syncCount, 0, `${durability}`);
      deepEqual(readFileSync(path.join(disposablePath, `level-${index}`)), bytes);
    }
    deepEqual(directoryNames(disposablePath), []);
  } finally {
    await durableRoot.close();
    await disposableRoot.close();
  }
});

test("fsync 级别的创建：内容同步先于链接，两次父目录同步时目标都已在，暂存第一次在、第二次已删", {
  concurrency: false,
}, async (t) => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-atomic-create-sync-order-"));
  t.after(() => rmSync(rootPath, { recursive: true, force: true }));
  const root = await RootedDirectory.open(rootPath, "$root", {
    durability: "fsync",
  });
  const resourcePath = parsePortableResourcePath("state");
  const resourceAbsolutePath = path.join(root.absolutePath, resourcePath);
  // 每次父目录同步时，目标在不在、这个目标的暂存在不在。
  const atParentSync: string[] = [];
  observeTargetParentSyncs(
    t,
    () => resourceAbsolutePath,
    () => {
      const target = existsSync(resourceAbsolutePath) ? "target" : "no-target";
      const stage = directoryNames(rootPath).length > 0 ? "stage" : "no-stage";
      atParentSync.push(`${target}+${stage}`);
    },
  );
  try {
    const ordered = await countFsyncsWithPublicationOrder(t, rootPath, "link", () =>
      createFileAtomically(root, resourcePath, Buffer.from("state"), { mode: 0o600 }),
    );
    equal(ordered.syncCount, 3);
    equal(ordered.directorySyncCount, 2);
    // 链接那一刻已经同步过一次（暂存内容）。
    deepEqual(ordered.syncsAtPublication, [1]);
    // 顺序不变量：链接之后才同步父目录（目标已在），那时暂存还在；暂存只在它之后才删，删完再同步一次。
    // 把第一次父目录同步挪到链接之前，第一项会变成 no-target。
    deepEqual(atParentSync, ["target+stage", "target+no-stage"]);
    deepEqual(directoryNames(rootPath), []);
  } finally {
    await root.close();
  }
});

test("fsync 级别的替换：内容同步先于重命名，父目录同步时重命名已经发生", {
  concurrency: false,
}, async (t) => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-atomic-replace-sync-order-"));
  t.after(() => rmSync(rootPath, { recursive: true, force: true }));
  writeFileSync(path.join(rootPath, "state"), "before", { mode: 0o600 });
  const root = await RootedDirectory.open(rootPath, "$root", {
    durability: "fsync",
  });
  const resourcePath = parsePortableResourcePath("state");
  const resourceAbsolutePath = path.join(root.absolutePath, resourcePath);
  const bytes = Buffer.from("after-state");
  const atParentSync: string[] = [];
  observeTargetParentSyncs(
    t,
    () => resourceAbsolutePath,
    () => {
      const content = readFileSync(resourceAbsolutePath).equals(bytes) ? "renamed" : "not-renamed";
      const stage = directoryNames(rootPath).length > 0 ? "stage" : "no-stage";
      atParentSync.push(`${content}+${stage}`);
    },
  );
  try {
    const expected = await readStableFileDigest(root, resourcePath, {
      maximumBytes: parseByteCount(1024),
    });
    const ordered = await countFsyncsWithPublicationOrder(t, rootPath, "rename", () =>
      replaceFileAtomically(root, resourcePath, bytes, { mode: 0o600, expected }),
    );
    equal(ordered.syncCount, 2);
    equal(ordered.directorySyncCount, 1);
    deepEqual(ordered.syncsAtPublication, [1]);
    // 把父目录同步挪到重命名之前，这里会是 not-renamed+stage。
    deepEqual(atParentSync, ["renamed+no-stage"]);
  } finally {
    await root.close();
  }
});

test("zero-byte files use the same durable publication path", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-atomic-empty-"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const bytes = new Uint8Array(0);
    const result = await createFileAtomically(root, parsePortableResourcePath("empty"), bytes, {
      mode: 0,
    });
    equal(result.byteCount, 0);
    equal(result.node.byteCount, 0);
    equal(result.node.permissionBits, 0);
    equal(result.digest, computeSha256Digest(bytes));
    equal(statSync(path.join(rootPath, "empty")).size, 0);
    deepEqual(directoryNames(rootPath), []);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("atomic create never replaces an existing file", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-atomic-exists-"));
  writeFileSync(path.join(rootPath, "state"), "original");
  const root = await RootedDirectory.open(rootPath);
  try {
    await expectAtomicWriteError(
      () =>
        createFileAtomically(root, parsePortableResourcePath("state"), Buffer.from("replacement"), {
          mode: 0o600,
        }),
      "target-exists",
      "$resourcePath",
    );
    equal(readFileSync(path.join(rootPath, "state"), "utf8"), "original");
    deepEqual(directoryNames(rootPath), []);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("concurrent creates use OS no-replace publication", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-atomic-race-"));
  const root = await RootedDirectory.open(rootPath, "$root", {
    durability: "fsync",
  });
  try {
    const resourcePath = parsePortableResourcePath("winner");
    const attempts = await Promise.allSettled([
      createFileAtomically(root, resourcePath, Buffer.from("first"), {
        mode: 0o600,
      }),
      createFileAtomically(root, resourcePath, Buffer.from("second"), {
        mode: 0o600,
      }),
    ]);
    equal(attempts.filter((entry) => entry.status === "fulfilled").length, 1);
    const rejected = attempts.find((entry) => entry.status === "rejected");
    if (rejected?.status !== "rejected") throw new Error("Expected rejection.");
    if (!(rejected.reason instanceof DurableAtomicFileWriteError)) {
      throw new Error("Expected DurableAtomicFileWriteError.");
    }
    equal(rejected.reason.reason, "target-exists");
    const final = readFileSync(path.join(rootPath, "winner"), "utf8");
    equal(final === "first" || final === "second", true);
    deepEqual(directoryNames(rootPath), []);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("fsync 级别：前一个写入者的链接已在、它的父目录同步还没跑，第二个写入者先同步父目录再报 target-exists", {
  concurrency: false,
}, async (t) => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-atomic-existing-settle-"));
  t.after(() => rmSync(rootPath, { recursive: true, force: true }));
  const root = await RootedDirectory.open(rootPath, "$root", { durability: "fsync" });
  const target = parsePortableResourcePath("record.json");
  const firstBytes = Buffer.from("first-writer");
  // 第一个写入者：暂存内容已经写好并同步，链接到目标之后停住，父目录同步一次都没跑。它的地址仍由
  // 本进程持有，写入前的恢复把它当作活动暂存跳过——与它被杀之后恢复因并发枚举报忙而跳过是同一个局面。
  const address = issueDurableAtomicFileStageAddress(
    "create",
    target,
    computeSha256Digest(firstBytes),
    0o600,
  );
  const stage = durableAtomicFileStageRefForTest(target, address);
  try {
    await createFileCandidateDurably(root, stage, firstBytes, { mode: 0o600 });
    linkSync(path.join(rootPath, stage), path.join(rootPath, target));

    const events: string[] = [];
    const targetAbsolutePath = path.join(root.absolutePath, target);
    observeTargetParentSyncs(
      t,
      () => targetAbsolutePath,
      () => {
        events.push("parent-sync");
      },
    );
    const counted = await countFsyncs(() =>
      recordWriteError(events, () =>
        createFileAtomically(root, target, Buffer.from("second-writer"), { mode: 0o600 }),
      ),
    );
    // 第二个写入者在报 target-exists 之前同步了一次父目录：对方的链接因此落盘，读作成功的调用方
    // 拿到的 target-exists 意味着目录项已经耐久。
    deepEqual(events, ["parent-sync", "error:target-exists:$resourcePath"]);
    equal(counted.syncCount, 1);
    equal(counted.directorySyncCount, 1);
    // 活动暂存和它的目标原样不动。
    equal(readFileSync(path.join(rootPath, target), "utf8"), "first-writer");
    equal(statSync(path.join(rootPath, target)).nlink, 2);
    equal(directoryNames(rootPath).length, 1);
  } finally {
    releaseDurableAtomicFileStageAddress(address);
    await root.close();
  }
});

test("第二次“目标不存在”检查与链接的 EEXIST：报 target-exists 之前同样先同步父目录，随后删本次的暂存并再同步", {
  concurrency: false,
}, async (t) => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-atomic-existing-race-"));
  t.after(() => rmSync(rootPath, { recursive: true, force: true }));
  const root = await RootedDirectory.open(rootPath, "$root", { durability: "fsync" });
  const events: string[] = [];
  let plantAt: "stage-open" | "link" | null = null;
  let plantTarget = "";
  let observedTarget = "";
  observeTargetParentSyncs(
    t,
    () => observedTarget,
    () => {
      events.push("parent-sync");
    },
  );
  // 竞争者在本次写入建好暂存之后（第二次检查之前）或链接的那一刻抢先放下目标。
  const plant = (point: "stage-open" | "link") => {
    if (plantAt !== point) return;
    plantAt = null;
    writeFileSync(plantTarget, "competitor", { mode: 0o600 });
  };
  const originalOpenExclusive = filesystemMutation.openExclusive;
  t.mock.method(
    filesystemMutation,
    "openExclusive",
    async (candidate: string, flags: number, mode: number) => {
      const handle = await originalOpenExclusive.call(filesystemMutation, candidate, flags, mode);
      events.push("stage-open");
      plant("stage-open");
      return handle;
    },
  );
  const originalLink = filesystemMutation.link;
  t.mock.method(filesystemMutation, "link", async (from: string, to: string) => {
    events.push("link");
    plant("link");
    return originalLink.call(filesystemMutation, from, to);
  });
  const originalUnlink = filesystemMutation.unlink;
  t.mock.method(filesystemMutation, "unlink", async (candidate: string) => {
    if (path.basename(candidate).startsWith(".wakeflow-atomic-")) events.push("stage-unlink");
    return originalUnlink.call(filesystemMutation, candidate);
  });
  try {
    const cases = [
      ["stage-open", ["stage-open"]],
      ["link", ["stage-open", "link"]],
    ] as const;
    for (const [point, before] of cases) {
      const target = parsePortableResourcePath(`raced-at-${point}`);
      plantTarget = path.join(rootPath, target);
      observedTarget = path.join(root.absolutePath, target);
      plantAt = point;
      events.length = 0;
      const counted = await countFsyncs(() =>
        recordWriteError(events, () =>
          createFileAtomically(root, target, Buffer.from("ours"), { mode: 0o600 }),
        ),
      );
      deepEqual(
        events,
        [
          ...before,
          "parent-sync",
          "stage-unlink",
          "parent-sync",
          "error:target-exists:$resourcePath",
        ],
        point,
      );
      // 暂存内容一次、报错之前一次、清理之后一次。
      equal(counted.syncCount, 3, point);
      equal(counted.directorySyncCount, 2, point);
      equal(readFileSync(plantTarget, "utf8"), "competitor", point);
      deepEqual(directoryNames(rootPath), [], point);
    }
  } finally {
    await root.close();
  }
});

test("报 target-exists 之前的父目录同步只跟随本次写入的有效级别：none 与 none 的根一次都不同步", {
  concurrency: false,
}, async (t) => {
  const durablePath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-atomic-existing-level-fsync-"));
  const disposablePath = mkdtempSync(
    path.join(os.tmpdir(), "wakeflow-atomic-existing-level-none-"),
  );
  t.after(() => {
    rmSync(durablePath, { recursive: true, force: true });
    rmSync(disposablePath, { recursive: true, force: true });
  });
  writeFileSync(path.join(durablePath, "state"), "existing", { mode: 0o600 });
  writeFileSync(path.join(disposablePath, "state"), "existing", { mode: 0o600 });
  const durableRoot = await RootedDirectory.open(durablePath, "$root", { durability: "fsync" });
  const disposableRoot = await RootedDirectory.open(disposablePath, "$root", {
    durability: "none",
  });
  const resourcePath = parsePortableResourcePath("state");
  const levels = [undefined, "fsync", "none"] as const;

  function createCountingSyncs(
    root: RootedDirectory,
    durability: (typeof levels)[number],
  ): Promise<Readonly<{ syncCount: number; directorySyncCount: number }>> {
    return countFsyncs(() =>
      expectAtomicWriteError(
        () =>
          createFileAtomically(root, resourcePath, Buffer.from("ours"), {
            mode: 0o600,
            ...(durability === undefined ? {} : { durability }),
          }),
        "target-exists",
        "$resourcePath",
      ),
    );
  }

  try {
    const expectedOnDurableRoot = [
      [undefined, 1],
      ["fsync", 1],
      ["none", 0],
    ] as const;
    for (const [durability, directorySyncCount] of expectedOnDurableRoot) {
      const durable = await createCountingSyncs(durableRoot, durability);
      equal(durable.syncCount, directorySyncCount, `${durability}`);
      equal(durable.directorySyncCount, directorySyncCount, `${durability}`);
    }
    for (const durability of levels) {
      const disposable = await createCountingSyncs(disposableRoot, durability);
      equal(disposable.syncCount, 0, `${durability}`);
    }
    equal(readFileSync(path.join(durablePath, "state"), "utf8"), "existing");
    deepEqual(directoryNames(durablePath), []);
    deepEqual(directoryNames(disposablePath), []);
  } finally {
    await durableRoot.close();
    await disposableRoot.close();
  }
});

test("报 target-exists 之前的父目录同步失败时，调用方拿到 durability-failure 而不是 target-exists", {
  concurrency: false,
}, async (t) => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-atomic-existing-sync-failure-"));
  t.after(() => rmSync(rootPath, { recursive: true, force: true }));
  writeFileSync(path.join(rootPath, "existing"), "existing", { mode: 0o600 });
  const root = await RootedDirectory.open(rootPath, "$root", { durability: "fsync" });
  const prototype = await fileHandlePrototype(rootPath);
  const originalSync = prototype.sync;
  // 文件内容同步照常。第一次检查时目录里还没有暂存，那里每一次目录同步都失败；第二次检查与链接的
  // EEXIST 只让“本次的暂存还在目录里”时的目录同步失败——那正是报错之前那一次，清理删掉暂存之后
  // 才同步，照常成功。去掉报错之前的同步，清理的同步就会成功，调用方拿到 target-exists，用例失败。
  let failDirectorySyncs: "always" | "while-stage-present" = "always";
  let failedDirectorySyncs = 0;
  t.mock.method(prototype, "sync", async function failingDirectorySync(this: FileHandle) {
    if (
      (await this.stat()).isDirectory() &&
      (failDirectorySyncs === "always" || directoryNames(rootPath).length > 0)
    ) {
      failedDirectorySyncs += 1;
      throw injectedFailure("injected directory sync failure");
    }
    return originalSync.call(this);
  });
  // 竞争者在本次写入建好暂存之后（第二次检查之前）或链接的那一刻抢先放下目标。
  let plantAt: "stage-open" | "link" | null = null;
  let plantPath = "";
  const plant = (point: "stage-open" | "link") => {
    if (plantAt !== point) return;
    plantAt = null;
    writeFileSync(plantPath, "competitor", { mode: 0o600 });
  };
  const originalOpenExclusive = filesystemMutation.openExclusive;
  t.mock.method(
    filesystemMutation,
    "openExclusive",
    async (candidate: string, flags: number, mode: number) => {
      const handle = await originalOpenExclusive.call(filesystemMutation, candidate, flags, mode);
      plant("stage-open");
      return handle;
    },
  );
  const originalLink = filesystemMutation.link;
  t.mock.method(filesystemMutation, "link", async (from: string, to: string) => {
    plant("link");
    return originalLink.call(filesystemMutation, from, to);
  });
  try {
    // 第一次检查就看见目标：还没建暂存，失败的只能是报错之前那次同步。
    await expectAtomicWriteError(
      () =>
        createFileAtomically(root, parsePortableResourcePath("existing"), Buffer.from("ours"), {
          mode: 0o600,
        }),
      "durability-failure",
      "$resourcePath",
    );
    equal(failedDirectorySyncs, 1);
    equal(readFileSync(path.join(rootPath, "existing"), "utf8"), "existing");

    failDirectorySyncs = "while-stage-present";
    for (const point of ["stage-open", "link"] as const) {
      const target = parsePortableResourcePath(`raced-at-${point}`);
      plantPath = path.join(rootPath, target);
      plantAt = point;
      failedDirectorySyncs = 0;
      await expectAtomicWriteError(
        () => createFileAtomically(root, target, Buffer.from("ours"), { mode: 0o600 }),
        "durability-failure",
        "$resourcePath",
      );
      // 只失败了一次，且发生在暂存还在的时候（删暂存之前）；清理之后的同步成功，暂存已删。
      equal(failedDirectorySyncs, 1, point);
      equal(readFileSync(plantPath, "utf8"), "competitor", point);
      deepEqual(directoryNames(rootPath), [], point);
    }
  } finally {
    await root.close();
  }
});

test("主错误是 target-exists 时暂存清理再失败：调用方看到 stage-cleanup-failure，留下的暂存由下一次写入前的恢复退役", {
  concurrency: false,
}, async (t) => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-atomic-existing-cleanup-"));
  t.after(() => rmSync(rootPath, { recursive: true, force: true }));
  const root = await RootedDirectory.open(rootPath, "$root", { durability: "fsync" });
  const resourcePath = parsePortableResourcePath("raced");
  const resourceAbsolutePath = path.join(rootPath, resourcePath);
  const originalLink = filesystemMutation.link;
  let planted = false;
  t.mock.method(filesystemMutation, "link", async (from: string, to: string) => {
    if (!planted) {
      planted = true;
      writeFileSync(resourceAbsolutePath, "competitor", { mode: 0o600 });
    }
    return originalLink.call(filesystemMutation, from, to);
  });
  const originalUnlink = filesystemMutation.unlink;
  let failedStageUnlinks = 0;
  t.mock.method(filesystemMutation, "unlink", async (candidate: string) => {
    if (failedStageUnlinks === 0 && path.basename(candidate).startsWith(".wakeflow-atomic-")) {
      failedStageUnlinks += 1;
      throw injectedFailure("injected stage unlink failure");
    }
    return originalUnlink.call(filesystemMutation, candidate);
  });
  try {
    // 有的调用方把 target-exists 读作成功：一次没做成的清理不能藏在它后面。
    await expectAtomicWriteError(
      () => createFileAtomically(root, resourcePath, Buffer.from("ours"), { mode: 0o600 }),
      "stage-cleanup-failure",
      "$stage",
    );
    equal(failedStageUnlinks, 1);
    equal(readFileSync(resourceAbsolutePath, "utf8"), "competitor");
    equal(directoryNames(rootPath).length, 1);

    // 下一次写入前的恢复退役这个暂存，然后照常报 target-exists。
    await expectAtomicWriteError(
      () => createFileAtomically(root, resourcePath, Buffer.from("ours"), { mode: 0o600 }),
      "target-exists",
      "$resourcePath",
    );
    deepEqual(directoryNames(rootPath), []);
  } finally {
    await root.close();
  }
});

test("atomic create 自动恢复 inactive partial 与 two-link stage", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-atomic-recovery-"));
  mkdirSync(path.join(rootPath, "records"), { mode: 0o700 });
  const root = await RootedDirectory.open(rootPath);
  try {
    const partialTarget = parsePortableResourcePath("records/partial.json");
    const partialBytes = Buffer.from("complete-partial-target");
    const partialAddress = issueDurableAtomicFileStageAddress(
      "create",
      partialTarget,
      computeSha256Digest(partialBytes),
      0o640,
    );
    const partialStage = durableAtomicFileStageRefForTest(partialTarget, partialAddress);
    try {
      await createFileCandidateDurably(root, partialStage, Buffer.from("partial"), { mode: 0o600 });
    } finally {
      releaseDurableAtomicFileStageAddress(partialAddress);
    }

    await createFileAtomically(root, partialTarget, partialBytes, {
      mode: 0o640,
    });
    equal(
      readFileSync(path.join(rootPath, ...partialTarget.split("/")), "utf8"),
      "complete-partial-target",
    );

    const linkedTarget = parsePortableResourcePath("records/linked.json");
    const linkedBytes = Buffer.from("complete-linked-target");
    const linkedAddress = issueDurableAtomicFileStageAddress(
      "create",
      linkedTarget,
      computeSha256Digest(linkedBytes),
      0o600,
    );
    const linkedStage = durableAtomicFileStageRefForTest(linkedTarget, linkedAddress);
    try {
      await createFileCandidateDurably(root, linkedStage, linkedBytes, {
        mode: 0o600,
      });
      linkSync(
        path.join(rootPath, ...linkedStage.split("/")),
        path.join(rootPath, ...linkedTarget.split("/")),
      );
    } finally {
      releaseDurableAtomicFileStageAddress(linkedAddress);
    }

    await expectAtomicWriteError(
      () =>
        createFileAtomically(root, linkedTarget, linkedBytes, {
          mode: 0o600,
        }),
      "target-exists",
      "$resourcePath",
    );
    equal(statSync(path.join(rootPath, ...linkedTarget.split("/"))).nlink, 1);
    deepEqual(directoryNames(path.join(rootPath, "records")), []);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("atomic write preflight preserves a safe foreign-target stage", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-atomic-foreign-stage-"));
  mkdirSync(path.join(rootPath, "records"), { mode: 0o700 });
  const root = await RootedDirectory.open(rootPath);
  const foreignTarget = parsePortableResourcePath("records/foreign.json");
  const ownTarget = parsePortableResourcePath("records/own.json");
  const foreignBytes = Buffer.from("foreign candidate");
  const address = issueDurableAtomicFileStageAddress(
    "replace",
    foreignTarget,
    computeSha256Digest(foreignBytes),
    0o600,
  );
  const foreignStage = durableAtomicFileStageRefForTest(foreignTarget, address);
  let released = false;
  try {
    await createFileCandidateDurably(root, foreignStage, foreignBytes, {
      mode: 0o600,
    });
    releaseDurableAtomicFileStageAddress(address);
    released = true;

    await createFileAtomically(root, ownTarget, Buffer.from("own target"), {
      mode: 0o600,
    });
    equal(existsSync(path.join(rootPath, ...foreignStage.split("/"))), true);
    equal(readFileSync(path.join(rootPath, ...ownTarget.split("/")), "utf8"), "own target");
  } finally {
    if (!released) releaseDurableAtomicFileStageAddress(address);
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("atomic replace requires and preserves an exact stable-read expectation", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-atomic-replace-"));
  const target = path.join(rootPath, "state");
  writeFileSync(target, "before", { mode: 0o600 });
  const root = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath("state");
    const before = await readStableFileDigest(root, resourcePath, {
      maximumBytes: parseByteCount(1024),
    });
    const bytes = Buffer.from("after-state");
    const result = await replaceFileAtomically(root, resourcePath, bytes, {
      mode: 0o644,
      expected: before,
    });

    equal(result.publication, "replaced");
    deepEqual(result.previous, before);
    equal(Object.isFrozen(result.previous), true);
    deepEqual(readFileSync(target), bytes);
    equal(statSync(target).mode & 0o777, 0o644);
    equal(result.digest, computeSha256Digest(bytes));
    equal(result.node.inodeId === before.node.inodeId, false);
    deepEqual(directoryNames(rootPath), []);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("过时的替换预期在建暂存之前的廉价预检里失败：不建暂存、不同步，较新的目标原样", {
  concurrency: false,
}, async (t) => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-atomic-stale-"));
  t.after(() => rmSync(rootPath, { recursive: true, force: true }));
  const target = path.join(rootPath, "state");
  writeFileSync(target, "initial");
  const root = await RootedDirectory.open(rootPath, "$root", { durability: "fsync" });
  const originalOpenExclusive = filesystemMutation.openExclusive;
  let stageOpens = 0;
  t.mock.method(
    filesystemMutation,
    "openExclusive",
    async (candidate: string, flags: number, mode: number) => {
      stageOpens += 1;
      return originalOpenExclusive.call(filesystemMutation, candidate, flags, mode);
    },
  );
  try {
    const resourcePath = parsePortableResourcePath("state");
    const before = await readStableFileDigest(root, resourcePath, {
      maximumBytes: parseByteCount(1024),
    });
    writeFileSync(target, "external-change");

    const counted = await countFsyncs(() =>
      expectAtomicWriteError(
        () =>
          replaceFileAtomically(root, resourcePath, Buffer.from("ours"), {
            mode: 0o600,
            expected: before,
          }),
        "expectation-changed",
        "$resourcePath",
      ),
    );
    equal(stageOpens, 0);
    equal(counted.syncCount, 0);
    equal(readFileSync(target, "utf8"), "external-change");
    deepEqual(directoryNames(rootPath), []);

    // 目标已经不在：同样在预检里失败，什么都不建。
    rmSync(target);
    await expectAtomicWriteError(
      () =>
        replaceFileAtomically(root, resourcePath, Buffer.from("ours"), {
          mode: 0o600,
          expected: before,
        }),
      "expectation-changed",
      "$resourcePath",
    );
    equal(stageOpens, 0);
    equal(existsSync(target), false);
    deepEqual(directoryNames(rootPath), []);
  } finally {
    await root.close();
  }
});

test("预检时父目录已被换走：拒绝之前先复验父目录，报 parent-changed，而不是过时的预期或读预期失败", {
  concurrency: false,
}, async (t) => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-atomic-precheck-parent-"));
  t.after(() => rmSync(rootPath, { recursive: true, force: true }));
  const root = await RootedDirectory.open(rootPath);
  const originalOpenExclusive = filesystemMutation.openExclusive;
  let stageOpens = 0;
  t.mock.method(
    filesystemMutation,
    "openExclusive",
    async (candidate: string, flags: number, mode: number) => {
      stageOpens += 1;
      return originalOpenExclusive.call(filesystemMutation, candidate, flags, mode);
    },
  );
  // 本次写入已经打开父目录句柄、跑完写入前的恢复；预检读 `resourceAbsolutePath` 的那一刻把父目录
  // 换走，随后的裸 `lstat` 就走进换上来的东西。
  const originalGetter = Object.getOwnPropertyDescriptor(
    RootedResourceParentHandle.prototype,
    "resourceAbsolutePath",
  )?.get;
  if (originalGetter === undefined) throw new Error("resourceAbsolutePath getter is missing.");
  let swapParent: (() => void) | null = null;
  t.mock.getter(
    RootedResourceParentHandle.prototype,
    "resourceAbsolutePath",
    function swappingGetter(this: RootedResourceParentHandle) {
      const swap = swapParent;
      swapParent = null;
      swap?.();
      return originalGetter.call(this);
    },
  );
  // 三种换法：另一个目录里有同名的另一份目标（节点不同）、空目录（`ENOENT`）、普通文件（`ENOTDIR`）。
  const replacements = [
    [
      "other-target",
      (parentPath: string) => {
        mkdirSync(parentPath, { mode: 0o700 });
        writeFileSync(path.join(parentPath, "state"), "other", { mode: 0o600 });
      },
    ],
    ["empty-directory", (parentPath: string) => mkdirSync(parentPath, { mode: 0o700 })],
    ["regular-file", (parentPath: string) => writeFileSync(parentPath, "not a directory")],
  ] as const;
  try {
    for (const [name, replaceParent] of replacements) {
      const parentPath = path.join(rootPath, name);
      const movedPath = path.join(rootPath, `${name}-moved`);
      mkdirSync(parentPath, { mode: 0o700 });
      writeFileSync(path.join(parentPath, "state"), "initial", { mode: 0o600 });
      const resourcePath = parsePortableResourcePath(`${name}/state`);
      const before = await readStableFileDigest(root, resourcePath, {
        maximumBytes: parseByteCount(1024),
      });
      swapParent = () => {
        renameSync(parentPath, movedPath);
        replaceParent(parentPath);
      };
      await expectAtomicWriteError(
        () =>
          replaceFileAtomically(root, resourcePath, Buffer.from("ours"), {
            mode: 0o600,
            expected: before,
          }),
        "parent-changed",
        "$resourcePath",
      );
      equal(swapParent, null, name);
      equal(stageOpens, 0, name);
      // 原来的父目录（已被挪走）里目标原样，两处都没有暂存。
      equal(readFileSync(path.join(movedPath, "state"), "utf8"), "initial", name);
      deepEqual(directoryNames(movedPath), [], name);
      if (statSync(parentPath).isDirectory()) deepEqual(directoryNames(parentPath), [], name);
    }
  } finally {
    await root.close();
  }
});

test("预检之后目标才变：紧挨重命名的完整比较仍报 expectation-changed，暂存清理再失败也不顶替它，残留由下一次写入退役", async (t) => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-atomic-stale-cleanup-"));
  t.after(() => rmSync(rootPath, { recursive: true, force: true }));
  const target = path.join(rootPath, "state");
  writeFileSync(target, "initial");
  const root = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath("state");
    const before = await readStableFileDigest(root, resourcePath, {
      maximumBytes: parseByteCount(1024),
    });

    // 外部写入落在预检之后、建暂存的那一刻：只有完整比较看得见它。
    const originalOpenExclusive = filesystemMutation.openExclusive;
    let changedTarget = false;
    t.mock.method(
      filesystemMutation,
      "openExclusive",
      async (candidate: string, flags: number, mode: number) => {
        if (!changedTarget) {
          changedTarget = true;
          writeFileSync(target, "external-change");
        }
        return originalOpenExclusive.call(filesystemMutation, candidate, flags, mode);
      },
    );
    const originalUnlink = filesystemMutation.unlink;
    let failedStageUnlinks = 0;
    t.mock.method(filesystemMutation, "unlink", async (candidate: string) => {
      if (failedStageUnlinks === 0 && path.basename(candidate).startsWith(".wakeflow-atomic-")) {
        failedStageUnlinks += 1;
        throw injectedFailure("injected stage unlink failure");
      }
      return originalUnlink.call(filesystemMutation, candidate);
    });

    await expectAtomicWriteError(
      () =>
        replaceFileAtomically(root, resourcePath, Buffer.from("ours"), {
          mode: 0o600,
          expected: before,
        }),
      "expectation-changed",
      "$resourcePath",
    );
    equal(changedTarget, true);
    equal(failedStageUnlinks, 1);
    equal(readFileSync(target, "utf8"), "external-change");
    // 清理没做成，暂存留在原地等下一次写入前的恢复处理。
    equal(directoryNames(rootPath).length, 1);

    // 下一次写入（预期是新读的）先退役残留的暂存，再照常替换。
    const current = await readStableFileDigest(root, resourcePath, {
      maximumBytes: parseByteCount(1024),
    });
    await replaceFileAtomically(root, resourcePath, Buffer.from("ours"), {
      mode: 0o600,
      expected: current,
    });
    equal(readFileSync(target, "utf8"), "ours");
    deepEqual(directoryNames(rootPath), []);
  } finally {
    await root.close();
  }
});

test("同步失败：创建或替换的内容同步失败不留暂存、目标不动；提交之后（链接后、删暂存后、重命名后）的父目录同步失败报 durability-failure，留下的双链接对由下一次写入结算", {
  concurrency: false,
}, async (t) => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-atomic-sync-failure-"));
  t.after(() => rmSync(rootPath, { recursive: true, force: true }));
  writeFileSync(path.join(rootPath, "replaced"), "before", { mode: 0o600 });
  const root = await RootedDirectory.open(rootPath, "$root", { durability: "fsync" });
  const prototype = await fileHandlePrototype(rootPath);
  const originalSync = prototype.sync;
  // 文件（content）或目录（directory）句柄上的同步失败一次：先放过 `passBeforeFailing` 次同类同步，
  // 再让下一次失败。
  let failNext: "content" | "directory" | null = null;
  let passBeforeFailing = 0;
  t.mock.method(prototype, "sync", async function injectedSync(this: FileHandle) {
    if (failNext !== null && (failNext === "directory") === (await this.stat()).isDirectory()) {
      if (passBeforeFailing > 0) {
        passBeforeFailing -= 1;
      } else {
        failNext = null;
        throw injectedFailure("injected sync failure");
      }
    }
    return originalSync.call(this);
  });
  const bytes = Buffer.from("payload");
  try {
    failNext = "content";
    const contentFailure = await expectAtomicWriteError(
      () =>
        createFileAtomically(root, parsePortableResourcePath("content"), bytes, { mode: 0o600 }),
      "stage-sync-failure",
      "$stage",
    );
    equal(
      describeIncidentChain(contentFailure).some((link) => link.errno === "EIO"),
      true,
    );
    equal(existsSync(path.join(rootPath, "content")), false);
    deepEqual(directoryNames(rootPath), []);

    // 链接之后那次父目录同步失败：目标已经可见，暂存（两个链接）留着，不报成功。
    failNext = "directory";
    await expectAtomicWriteError(
      () => createFileAtomically(root, parsePortableResourcePath("linked"), bytes, { mode: 0o600 }),
      "durability-failure",
      "$resourcePath",
    );
    deepEqual(readFileSync(path.join(rootPath, "linked")), bytes);
    equal(statSync(path.join(rootPath, "linked")).nlink, 2);
    equal(directoryNames(rootPath).length, 1);
    // 下一次写入前的恢复结算并退役这对链接，然后照常报 target-exists。
    await expectAtomicWriteError(
      () => createFileAtomically(root, parsePortableResourcePath("linked"), bytes, { mode: 0o600 }),
      "target-exists",
      "$resourcePath",
    );
    equal(statSync(path.join(rootPath, "linked")).nlink, 1);
    deepEqual(directoryNames(rootPath), []);

    // 删暂存之后那次父目录同步失败（第一次父目录同步放过）：目标已经可见、只剩一个链接，暂存已删。
    // 目标的目录项由第一次同步落盘，删暂存这个变化没有同步过（断电后暂存可能回来，成为双链接对，
    // 由恢复前向结算），仍报 durability-failure，不报成功。
    failNext = "directory";
    passBeforeFailing = 1;
    await expectAtomicWriteError(
      () =>
        createFileAtomically(root, parsePortableResourcePath("unlinked"), bytes, { mode: 0o600 }),
      "durability-failure",
      "$resourcePath",
    );
    equal(failNext, null);
    deepEqual(readFileSync(path.join(rootPath, "unlinked")), bytes);
    equal(statSync(path.join(rootPath, "unlinked")).nlink, 1);
    deepEqual(directoryNames(rootPath), []);
    // 重试的创建报 target-exists 之前先同步父目录，删暂存这个变化随之落盘。
    await expectAtomicWriteError(
      () =>
        createFileAtomically(root, parsePortableResourcePath("unlinked"), bytes, { mode: 0o600 }),
      "target-exists",
      "$resourcePath",
    );

    // 替换的内容同步失败：还没重命名，暂存已删，目标原样（同一个节点，原来的预期仍然有效）。
    const replaced = parsePortableResourcePath("replaced");
    const expected = await readStableFileDigest(root, replaced, {
      maximumBytes: parseByteCount(1024),
    });
    failNext = "content";
    const replaceContentFailure = await expectAtomicWriteError(
      () => replaceFileAtomically(root, replaced, bytes, { mode: 0o600, expected }),
      "stage-sync-failure",
      "$stage",
    );
    equal(
      describeIncidentChain(replaceContentFailure).some((link) => link.errno === "EIO"),
      true,
    );
    equal(readFileSync(path.join(rootPath, "replaced"), "utf8"), "before");
    equal(statSync(path.join(rootPath, "replaced")).nlink, 1);
    deepEqual(directoryNames(rootPath), []);

    // 替换：重命名之后的父目录同步失败，新内容已经可见，不留暂存，不报成功。
    failNext = "directory";
    await expectAtomicWriteError(
      () => replaceFileAtomically(root, replaced, bytes, { mode: 0o600, expected }),
      "durability-failure",
      "$resourcePath",
    );
    deepEqual(readFileSync(path.join(rootPath, "replaced")), bytes);
    deepEqual(directoryNames(rootPath), []);
  } finally {
    await root.close();
  }
});

test("暂存句柄关闭失败：创建与替换都已提交，调用方仍拿到 close-failure，不留暂存", {
  concurrency: false,
}, async (t) => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-atomic-close-failure-"));
  t.after(() => rmSync(rootPath, { recursive: true, force: true }));
  writeFileSync(path.join(rootPath, "replaced"), "before", { mode: 0o600 });
  const root = await RootedDirectory.open(rootPath);
  const originalOpenExclusive = filesystemMutation.openExclusive;
  t.mock.method(
    filesystemMutation,
    "openExclusive",
    async (candidate: string, flags: number, mode: number) => {
      const stageHandle = await originalOpenExclusive.call(
        filesystemMutation,
        candidate,
        flags,
        mode,
      );
      // `FileHandle.close` 是每个句柄自己的属性，不在原型上：只替换暂存句柄这一个。描述符照样
      // 关掉，不在测试进程里泄漏。
      const originalClose = stageHandle.close;
      t.mock.method(stageHandle, "close", async () => {
        await originalClose.call(stageHandle);
        throw injectedFailure("injected close failure");
      });
      return stageHandle;
    },
  );
  const bytes = Buffer.from("payload");
  try {
    await expectAtomicWriteError(
      () =>
        createFileAtomically(root, parsePortableResourcePath("created"), bytes, { mode: 0o600 }),
      "close-failure",
      "$resourcePath",
    );
    deepEqual(readFileSync(path.join(rootPath, "created")), bytes);
    equal(statSync(path.join(rootPath, "created")).nlink, 1);
    deepEqual(directoryNames(rootPath), []);

    const replaced = parsePortableResourcePath("replaced");
    const expected = await readStableFileDigest(root, replaced, {
      maximumBytes: parseByteCount(1024),
    });
    await expectAtomicWriteError(
      () => replaceFileAtomically(root, replaced, bytes, { mode: 0o600, expected }),
      "close-failure",
      "$resourcePath",
    );
    deepEqual(readFileSync(path.join(rootPath, "replaced")), bytes);
    deepEqual(directoryNames(rootPath), []);
  } finally {
    await root.close();
  }
});

test("input bytes are snapshotted before asynchronous filesystem work", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-atomic-bytes-"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const bytes = Buffer.from("immutable-snapshot");
    const expected = Buffer.from(bytes);
    const pending = createFileAtomically(root, parsePortableResourcePath("state"), bytes, {
      mode: 0o600,
    });
    bytes.fill(0x78);
    await pending;
    deepEqual(readFileSync(path.join(rootPath, "state")), expected);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("missing or unsafe parent chains fail before stage creation", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-atomic-parent-"));
  const outside = mkdtempSync(path.join(os.tmpdir(), "wakeflow-atomic-parent-out-"));
  writeFileSync(path.join(rootPath, "file-parent"), "value");
  symlinkSync(outside, path.join(rootPath, "link-parent"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const cases: readonly [string, DurableAtomicFileWriteErrorReason][] = [
      ["missing/target", "parent-not-found"],
      ["file-parent/target", "parent-not-directory"],
      ["link-parent/target", "parent-symlink"],
    ];
    for (const [candidate, reason] of cases) {
      await expectAtomicWriteError(
        () =>
          createFileAtomically(root, parsePortableResourcePath(candidate), Buffer.from("value"), {
            mode: 0o600,
          }),
        reason,
        "$resourcePath",
      );
    }
    deepEqual(directoryNames(rootPath), []);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("options, bytes, expectation, and AbortSignal are passively admitted", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-atomic-input-"));
  writeFileSync(path.join(rootPath, "state"), "before");
  const root = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath("new");
    const invalidCreate: readonly [unknown, string][] = [
      [{}, "$options"],
      [{ mode: 0o600, extra: true }, "$options"],
      [{ mode: 0o600, durability: "bogus" }, "$options.durability"],
      // 只同步内容的中间一档随锁文件一起删掉了（ADR-0033），不再是合法取值。
      [{ mode: 0o600, durability: "content-only" }, "$options.durability"],
      [{ mode: -1 }, "$options.mode"],
      [{ mode: 0o1000 }, "$options.mode"],
      [{ mode: 0o600, signal: {} }, "$options.signal"],
    ];
    for (const [options, expectedPath] of invalidCreate) {
      await expectAtomicWriteError(
        () =>
          createFileAtomically(root, resourcePath, Buffer.from("value"), asCreateOptions(options)),
        "input",
        expectedPath,
      );
    }
    await expectAtomicWriteError(
      () =>
        createFileAtomically(root, resourcePath, "text" as unknown as Uint8Array, { mode: 0o600 }),
      "input",
      "$bytes",
    );
    await expectAtomicWriteError(
      () =>
        createFileAtomically(root, resourcePath, new Uint8Array(new SharedArrayBuffer(1)), {
          mode: 0o600,
        }),
      "input",
      "$bytes",
    );
    let byteTrapCalls = 0;
    const byteProxy = new Proxy(new Uint8Array([1]), {
      get() {
        byteTrapCalls += 1;
        return undefined;
      },
    });
    await expectAtomicWriteError(
      () => createFileAtomically(root, resourcePath, byteProxy, { mode: 0o600 }),
      "input",
      "$bytes",
    );
    equal(byteTrapCalls, 0);
    await expectAtomicWriteError(
      () =>
        createFileAtomically(root, asPortableResourcePath("../escape"), Buffer.from("value"), {
          mode: 0o600,
        }),
      "input",
      "$resourcePath",
    );

    let getterCalls = 0;
    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, "mode", {
      get: () => {
        getterCalls += 1;
        return 0o600;
      },
      enumerable: true,
    });
    await expectAtomicWriteError(
      () =>
        createFileAtomically(root, resourcePath, Buffer.from("value"), asCreateOptions(accessor)),
      "input",
      "$options",
    );
    equal(getterCalls, 0);

    const controller = new AbortController();
    controller.abort("private-abort");
    const aborted = await expectAtomicWriteError(
      () =>
        createFileAtomically(root, resourcePath, Buffer.from("value"), {
          mode: 0o600,
          signal: controller.signal,
        }),
      "aborted",
      "$signal",
    );
    equal(aborted.message.includes("private-abort"), false);

    const stable = await readStableFileDigest(root, parsePortableResourcePath("state"), {
      maximumBytes: parseByteCount(1024),
    });
    await expectAtomicWriteError(
      () =>
        replaceFileAtomically(
          root,
          parsePortableResourcePath("state"),
          Buffer.from("after"),
          asReplaceOptions({
            mode: 0o600,
            expected: { ...stable, node: { ...stable.node } },
          }),
        ),
      "input",
      "$options.expected.node",
    );
    await expectAtomicWriteError(
      () =>
        replaceFileAtomically(root, parsePortableResourcePath("state"), Buffer.from("after"), {
          mode: 0o600,
          expected: {
            ...stable,
            resourcePath: parsePortableResourcePath("different"),
          },
        }),
      "input",
      "$options.expected.resourcePath",
    );
    await expectAtomicWriteError(
      () =>
        replaceFileAtomically(
          root,
          parsePortableResourcePath("state"),
          Buffer.from("after"),
          asReplaceOptions({
            mode: 0o600,
            expected: { ...stable, byteCount: stable.byteCount + 1 },
          }),
        ),
      "input",
      "$options.expected.byteCount",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("叶子失败把捕到的系统错误留作 cause（open-items G3）：写不进的目录给出 EACCES，公开细节沿链读到它", async (t) => {
  if (typeof process.geteuid === "function" && process.geteuid() === 0) {
    t.skip("root ignores directory permissions");
    return;
  }
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-atomic-cause-"));
  const locked = path.join(rootPath, "locked");
  mkdirSync(locked, { mode: 0o500 });
  const root = await RootedDirectory.open(rootPath);
  try {
    let caught: unknown;
    try {
      await createFileAtomically(
        root,
        parsePortableResourcePath("locked/record.json"),
        new TextEncoder().encode("{}\n"),
        { mode: 0o600 },
      );
    } catch (error: unknown) {
      caught = error;
    }
    equal(caught instanceof DurableAtomicFileWriteError, true);
    // 此前这里是一个空的 catch：EACCES、ENOSPC、EROFS 看起来完全一样。
    const chain = describeIncidentChain(caught);
    equal(
      chain.some((link) => link.errno === "EACCES"),
      true,
      JSON.stringify(chain),
    );
    let wrapped: unknown;
    try {
      failWakeflow("io-failure", "observation-write", "$observation", { cause: caught });
    } catch (error: unknown) {
      wrapped = error;
    }
    equal(isWakeflowError(wrapped) && wrapped.toPublicDetails().causeCode, "EACCES");
    equal(existsSync(path.join(locked, "record.json")), false);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});
