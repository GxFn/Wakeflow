import { deepEqual, equal, rejects } from "node:assert/strict";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { open as openFileHandle } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import type { DurableDirectoryTreeCandidateErrorReason } from "../../../src/foundation/filesystem/directory-tree-candidate-plan.js";
import { createDirectoryAtomically } from "../../../src/foundation/filesystem/durable-directory-materialization.js";
import {
  createDirectoryTreeCandidateDurably,
  DurableDirectoryTreeCandidateError,
  inspectDirectoryTreeCandidate,
  inspectDirectoryTreeCandidateProgress,
  parseDirectoryTreeCandidatePlan,
  planDirectoryTreeCandidate,
  settleDirectoryTreeCandidateDurably,
} from "../../../src/foundation/filesystem/durable-directory-tree-candidate.js";
import { publishDirectoryTreeCandidateDurably } from "../../../src/foundation/filesystem/durable-directory-tree-publication.js";
import { createFileCandidateDurably } from "../../../src/foundation/filesystem/durable-file-candidate.js";
import { filesystemMutation } from "../../../src/foundation/filesystem/filesystem-mutation.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { OperationAbortedError } from "../../../src/foundation/node/abort-signal.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import { disposableRoot } from "../../support/temp-root.js";
import { countFsyncs } from "./fsync-count-probe.js";

/**
 * Level 1 (component): the directory tree candidate - exact plan, inventory closure, resume of a
 * partial candidate, and the sync protocol of a tree publication (1.4.1 stage 1, stage 1-2 lists
 * §2.1 row "整目录发布", record-kind table §3). On a root opened with real durability, a tree of
 * F files and D sub-directories costs F + D + 2 syncs when the stage and the destination share a
 * parent and F + D + 3 when they do not; every directory of the tree is synced once, after its
 * last member was created, and every member's content sync, like every directory sync, comes
 * before the publication rename. Under umask 022 (set by the case and restored) every tree
 * directory is born at the plan's 0755, so no chmod waits for the tree's directory sync. Settling
 * a partial candidate syncs each existing and each new member's content once and each tree
 * directory once, after its last member. This file does not call
 * `useDisposableDurability`: the roots stay at the default `fsync` level, and the sync-counting
 * cases open their root with `fsync` explicitly.
 */

const OPTIONS = {
  directoryMode: 0o755,
  maximumDepth: 8,
  maximumEntries: 16,
  maximumFileBytes: 1024,
  maximumFiles: 4,
  maximumTotalBytes: 4096,
} as const;

const FILES = [
  {
    path: "design/requirement.md",
    bytes: encodeUtf8("# Requirement\n"),
    mode: 0o644,
  },
  {
    path: "record.json",
    bytes: encodeUtf8('{"kind":"record"}\n'),
    mode: 0o644,
  },
] as const;

async function expectCandidateError(
  action: () => unknown | Promise<unknown>,
  reason: DurableDirectoryTreeCandidateErrorReason,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof DurableDirectoryTreeCandidateError)) {
    throw new Error("Expected DurableDirectoryTreeCandidateError.");
  }
  equal(caught.reason, reason);
}

test("durable directory tree candidate closes exact bytes, modes, and inventory", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-directory-candidate-"));
  mkdirSync(path.join(rootPath, "transactions"), { mode: 0o700 });
  chmodSync(path.join(rootPath, "transactions"), 0o700);
  const root = await RootedDirectory.open(rootPath);
  try {
    const plan = planDirectoryTreeCandidate(FILES, OPTIONS);
    deepEqual(plan.directories, ["design"]);
    deepEqual(
      plan.files.map(({ path: filePath, mode }) => ({
        path: filePath,
        mode,
      })),
      [
        {
          path: "design/requirement.md",
          mode: 0o644,
        },
        {
          path: "record.json",
          mode: 0o644,
        },
      ],
    );
    equal(Object.isFrozen(plan), true);
    equal(Object.isFrozen(plan.directories), true);
    equal(Object.isFrozen(plan.files), true);

    const candidateRef = parsePortableResourcePath("transactions/.requirement.stage");
    const created = await createDirectoryTreeCandidateDurably(root, candidateRef, FILES, OPTIONS);
    equal(created.plan.treeDigest, plan.treeDigest);
    equal(created.rootNode.kind, "directory");
    equal(created.rootNode.permissionBits, 0o755);

    const candidatePath = path.join(rootPath, "transactions", ".requirement.stage");
    equal(statSync(candidatePath).mode & 0o777, 0o755);
    equal(statSync(path.join(candidatePath, "design")).mode & 0o777, 0o755);
    equal(statSync(path.join(candidatePath, "design/requirement.md")).mode & 0o777, 0o644);
    equal(readFileSync(path.join(candidatePath, "record.json"), "utf8"), '{"kind":"record"}\n');

    const inspected = await inspectDirectoryTreeCandidate(root, candidateRef, plan, {
      expectedRootNode: created.rootNode,
    });
    equal(inspected.plan.treeDigest, plan.treeDigest);
    equal(inspected.rootNode.permissionBits, 0o755);

    writeFileSync(path.join(candidatePath, "unexpected.txt"), "unexpected\n", {
      mode: 0o644,
    });
    await expectCandidateError(
      () => inspectDirectoryTreeCandidate(root, candidateRef, plan),
      "tree-conflict",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("directory tree plan rejects non-canonical and over-budget input", async () => {
  await expectCandidateError(
    () => planDirectoryTreeCandidate([...FILES].reverse(), OPTIONS),
    "file-order",
  );
  await expectCandidateError(
    () =>
      planDirectoryTreeCandidate(FILES, {
        ...OPTIONS,
        maximumTotalBytes: 1,
      }),
    "capacity",
  );

  await expectCandidateError(
    () =>
      planDirectoryTreeCandidate(
        [
          {
            path: "A/first.txt",
            bytes: encodeUtf8("first\n"),
            mode: 0o644,
          },
          {
            path: "a/second.txt",
            bytes: encodeUtf8("second\n"),
            mode: 0o644,
          },
        ],
        OPTIONS,
      ),
    "path-conflict",
  );

  await expectCandidateError(
    () =>
      planDirectoryTreeCandidate(
        [
          {
            path: `${"a".repeat(1024)}x`,
            bytes: new Uint8Array(),
            mode: 0o644,
          },
        ],
        OPTIONS,
      ),
    "capacity",
  );

  const controller = new AbortController();
  controller.abort();
  await rejects(
    async () =>
      planDirectoryTreeCandidate(FILES, {
        ...OPTIONS,
        signal: controller.signal,
      }),
    OperationAbortedError,
  );

  const plan = planDirectoryTreeCandidate(FILES, OPTIONS);
  await expectCandidateError(
    () =>
      parseDirectoryTreeCandidatePlan(plan, {
        maximumDepth: OPTIONS.maximumDepth,
        maximumEntries: OPTIONS.maximumEntries,
        maximumFileBytes: OPTIONS.maximumFileBytes,
        maximumFiles: OPTIONS.maximumFiles,
        maximumTotalBytes: 1,
      }),
    "capacity",
  );

  await expectCandidateError(
    () =>
      planDirectoryTreeCandidate(FILES, {
        ...OPTIONS,
        maximumDepth: 65,
      }),
    "input",
  );
});

test("directory tree candidate retry fills only missing exact nodes", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-directory-resume-"));
  mkdirSync(path.join(rootPath, "transactions"), { mode: 0o700 });
  chmodSync(path.join(rootPath, "transactions"), 0o700);
  const root = await RootedDirectory.open(rootPath);
  try {
    const stageRef = parsePortableResourcePath("transactions/.resume.stage");
    await createDirectoryAtomically(root, stageRef, { mode: 0o755 });
    await createFileCandidateDurably(
      root,
      parsePortableResourcePath(`${stageRef}/record.json`),
      FILES[1].bytes,
      { mode: 0o644 },
    );

    const progress = await inspectDirectoryTreeCandidateProgress(
      root,
      stageRef,
      planDirectoryTreeCandidate(FILES, OPTIONS),
    );
    equal(progress.status, "incomplete");
    deepEqual(progress.missingFiles, ["design/requirement.md"]);

    const settled = await settleDirectoryTreeCandidateDurably(root, stageRef, FILES, OPTIONS);
    equal(settled.plan.files.length, 2);
    equal(
      readFileSync(path.join(rootPath, ...stageRef.split("/"), "design/requirement.md"), "utf8"),
      "# Requirement\n",
    );

    const conflictRef = parsePortableResourcePath("transactions/.conflict.stage");
    await createDirectoryAtomically(root, conflictRef, { mode: 0o755 });
    await createFileCandidateDurably(
      root,
      parsePortableResourcePath(`${conflictRef}/record.json`),
      encodeUtf8("different\n"),
      { mode: 0o644 },
    );
    await expectCandidateError(
      () => settleDirectoryTreeCandidateDurably(root, conflictRef, FILES, OPTIONS),
      "tree-conflict",
    );
    equal(
      readFileSync(path.join(rootPath, ...conflictRef.split("/"), "record.json"), "utf8"),
      "different\n",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

interface TreeEvent {
  readonly kind: "create" | "rename" | "sync";
  /** create: the new node; sync: the synced node. */
  readonly inode?: number;
  /** create: the directory that received the new entry. */
  readonly parentInode?: number;
  readonly directory?: boolean;
  /** create of a directory: its permission bits right after the mkdir returned. */
  readonly bornMode?: number;
  readonly sourceParentInode?: number;
  readonly destinationParentInode?: number;
}

/**
 * Record, in one sequence, every entry creation and rename through `filesystemMutation` and every
 * `fsync` (with the inode it reached). The sync wrapper sits inside `countFsyncs`, so both see the
 * same calls; both patches are restored before `run` returns.
 */
async function recordTreeEvents<Result>(
  t: TestContext,
  run: () => Promise<Result>,
): Promise<{ result: Result; events: TreeEvent[]; syncCount: number; directorySyncCount: number }> {
  const events: TreeEvent[] = [];
  const inodeOf = (target: string) => Number(lstatSync(target).ino);
  const originalMkdir = filesystemMutation.mkdir;
  const originalOpen = filesystemMutation.openExclusive;
  const originalRename = filesystemMutation.rename;
  t.mock.method(
    filesystemMutation,
    "mkdir",
    async (target: string, options: Parameters<typeof originalMkdir>[1]) => {
      await originalMkdir(target, options);
      events.push({
        kind: "create",
        inode: inodeOf(target),
        parentInode: inodeOf(path.dirname(target)),
        directory: true,
        bornMode: lstatSync(target).mode & 0o777,
      });
    },
  );
  t.mock.method(
    filesystemMutation,
    "openExclusive",
    async (target: string, flags: number, mode: number) => {
      const handle = await originalOpen(target, flags, mode);
      events.push({
        kind: "create",
        inode: inodeOf(target),
        parentInode: inodeOf(path.dirname(target)),
        directory: false,
      });
      return handle;
    },
  );
  t.mock.method(filesystemMutation, "rename", async (source: string, destination: string) => {
    const sourceParentInode = inodeOf(path.dirname(source));
    await originalRename(source, destination);
    events.push({
      kind: "rename",
      sourceParentInode,
      destinationParentInode: inodeOf(path.dirname(destination)),
    });
  });
  const probe = await openFileHandle(process.execPath, "r");
  const prototype = Object.getPrototypeOf(probe) as {
    sync: (this: unknown) => Promise<void>;
    stat: (this: unknown) => Promise<{ ino: number; isDirectory(): boolean }>;
  };
  await probe.close();
  const counted = await countFsyncs(async () => {
    const countingSync = prototype.sync;
    prototype.sync = async function recordedSync(this: unknown): Promise<void> {
      const stat = await prototype.stat.call(this);
      events.push({ kind: "sync", inode: Number(stat.ino), directory: stat.isDirectory() });
      return countingSync.call(this);
    };
    try {
      return await run();
    } finally {
      prototype.sync = countingSync;
    }
  });
  t.mock.restoreAll();
  return {
    result: counted.result,
    events,
    syncCount: counted.syncCount,
    directorySyncCount: counted.directorySyncCount,
  };
}

/** 在 `mask` 下执行 `run`，结束时还原进程原来的 umask（每个测试文件在自己的进程里运行）。 */
async function underUmask<Result>(mask: number, run: () => Promise<Result>): Promise<Result> {
  const previous = process.umask(mask);
  try {
    return await run();
  } finally {
    process.umask(previous);
  }
}

const THREE_FILES = [
  { path: "a.txt", bytes: encodeUtf8("a\n"), mode: 0o644 },
  { path: "b.txt", bytes: encodeUtf8("b\n"), mode: 0o644 },
  { path: "sub/c.txt", bytes: encodeUtf8("c\n"), mode: 0o644 },
] as const;

test("a real-durability tree publication of F = 3, D = 1 syncs F + D + 2 times with one parent and F + D + 3 with two, each directory once after its last member", {
  concurrency: false,
}, async (t) => {
  const rootPath = disposableRoot(t, "wakeflow-directory-tree-syncs-");
  mkdirSync(path.join(rootPath, "stage"), { mode: 0o700 });
  mkdirSync(path.join(rootPath, "final"), { mode: 0o700 });
  const root = await RootedDirectory.open(rootPath, "$root", { durability: "fsync" });
  t.after(() => root.close());

  const cases = [
    { name: "same parent", stage: "stage/.same.stage", destination: "stage/same", expected: 6 },
    { name: "two parents", stage: "stage/.two.stage", destination: "final/two", expected: 7 },
  ] as const;
  for (const entry of cases) {
    const recorded = await underUmask(0o022, () =>
      recordTreeEvents(t, async () => {
        const candidate = await createDirectoryTreeCandidateDurably(
          root,
          parsePortableResourcePath(entry.stage),
          THREE_FILES,
          OPTIONS,
        );
        return publishDirectoryTreeCandidateDurably(
          root,
          candidate,
          parsePortableResourcePath(entry.destination),
        );
      }),
    );
    const { events } = recorded;
    // F + D + 2 (+1): three contents, two tree directories, and one or two parents.
    equal(recorded.syncCount, entry.expected, entry.name);
    equal(recorded.directorySyncCount, entry.expected - THREE_FILES.length, entry.name);

    const created = events.filter((event) => event.kind === "create");
    equal(created.length, 5, entry.name);
    // umask 022 下暂存根与 sub 都以计划的 0755 出生：没有要等树同步才覆盖的 chmod，
    // 断电不会把暂存目录留在 0700。
    deepEqual(
      created.filter((event) => event.directory === true).map((event) => event.bornMode),
      [OPTIONS.directoryMode, OPTIONS.directoryMode],
      `${entry.name}: tree directories born at the plan's mode`,
    );
    const syncs = events.filter((event) => event.kind === "sync");
    const renameIndex = events.findIndex((event) => event.kind === "rename");
    const rename = events[renameIndex];
    if (rename === undefined) throw new Error("Expected one rename.");
    for (const node of created) {
      // Every member and every tree directory is synced exactly once ...
      equal(
        syncs.filter((sync) => sync.inode === node.inode).length,
        1,
        `${entry.name}: one sync per tree node`,
      );
      const syncIndex = events.findIndex(
        (event) => event.kind === "sync" && event.inode === node.inode,
      );
      // ... after the node itself was created and before the rename publishes the tree.
      // 成员文件的内容同步若挪到重命名及其父目录同步之后，断电会留下成员为空的已发布目录。
      equal(
        syncIndex > events.indexOf(node),
        true,
        `${entry.name}: node synced after its creation`,
      );
      equal(syncIndex < renameIndex, true, `${entry.name}: node synced before the rename`);
      if (node.directory !== true) continue;
      // ... and a directory only after its last member exists, never at its own creation.
      const lastMemberIndex = events.findLastIndex(
        (event) => event.kind === "create" && event.parentInode === node.inode,
      );
      equal(lastMemberIndex >= 0, true, entry.name);
      equal(syncIndex > lastMemberIndex, true, `${entry.name}: directory synced after members`);
    }
    // The stage parent and the destination parent are synced after the rename, once each.
    const parentSyncs = events
      .slice(renameIndex + 1)
      .filter((event) => event.kind === "sync")
      .map((event) => event.inode);
    const parents = new Set([rename.sourceParentInode, rename.destinationParentInode]);
    deepEqual(new Set(parentSyncs), parents, entry.name);
    equal(parentSyncs.length, parents.size, entry.name);
    equal(
      events
        .slice(0, renameIndex)
        .some((event) => event.kind === "sync" && parents.has(event.inode)),
      false,
      `${entry.name}: no parent sync at candidate creation`,
    );
    equal(
      readFileSync(path.join(rootPath, ...entry.destination.split("/"), "sub/c.txt"), "utf8"),
      "c\n",
    );
  }
});

test("settling a partial candidate on a real-durability root syncs each existing and each new member's content once and each directory once, after its last member", {
  concurrency: false,
}, async (t) => {
  const rootPath = disposableRoot(t, "wakeflow-directory-tree-settle-syncs-");
  mkdirSync(path.join(rootPath, "stage"), { mode: 0o700 });
  const root = await RootedDirectory.open(rootPath, "$root", { durability: "fsync" });
  t.after(() => root.close());
  const stageRef = parsePortableResourcePath("stage/.partial.stage");
  // 中断留下的半成品：候选根目录与 a.txt 已在盘上，sub/、b.txt 与 sub/c.txt 还没有。
  await createDirectoryAtomically(root, stageRef, { mode: 0o755 });
  await createFileCandidateDurably(
    root,
    parsePortableResourcePath(`${stageRef}/a.txt`),
    THREE_FILES[0].bytes,
    { mode: 0o644 },
  );

  const recorded = await recordTreeEvents(t, () =>
    settleDirectoryTreeCandidateDurably(root, stageRef, THREE_FILES, OPTIONS),
  );
  const { events } = recorded;
  // 三份内容（一份既有、两份新建）各一次，候选根与 sub 两个目录各一次；不同步候选根的父目录。
  equal(recorded.syncCount, 5);
  equal(recorded.directorySyncCount, 2);
  equal(recorded.result.plan.files.length, 3);

  const physical = (member: string) => path.join(rootPath, ...stageRef.split("/"), member);
  const inodeOf = (member: string) => Number(lstatSync(physical(member)).ino);
  const created = events.filter((event) => event.kind === "create");
  // 只新建缺的三个节点；既有的候选根与 a.txt 不重建。
  equal(created.length, 3);
  deepEqual(
    new Set(created.map((event) => event.inode)),
    new Set([inodeOf("sub"), inodeOf("b.txt"), inodeOf("sub/c.txt")]),
  );
  for (const member of ["", "sub", "a.txt", "b.txt", "sub/c.txt"]) {
    equal(
      events.filter((event) => event.kind === "sync" && event.inode === inodeOf(member)).length,
      1,
      `one sync for ${member === "" ? "the candidate root" : member}`,
    );
  }
  for (const directory of ["", "sub"]) {
    const inode = inodeOf(directory);
    const syncIndex = events.findIndex((event) => event.kind === "sync" && event.inode === inode);
    const lastMemberIndex = events.findLastIndex(
      (event) => event.kind === "create" && event.parentInode === inode,
    );
    equal(lastMemberIndex >= 0, true, directory);
    equal(syncIndex > lastMemberIndex, true, `${directory}: synced after its last member`);
  }
  equal(readFileSync(physical("sub/c.txt"), "utf8"), "c\n");
});
