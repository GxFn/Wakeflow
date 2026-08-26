import { deepEqual, equal } from "node:assert/strict";
import {
  constants as fileSystemConstants,
  lstatSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  createFileNodeSnapshot,
  FileNodeSnapshotError,
  sameFileNodeIdentity,
  sameFileNodeSnapshot,
  type FileNodeKind,
  type FileNodeSnapshot,
  type FileNodeSnapshotErrorReason,
} from "../../../src/foundation/filesystem/file-node-snapshot.js";

function expectFileNodeSnapshotError(
  action: () => unknown,
  reason: FileNodeSnapshotErrorReason,
  expectedPath: string,
): FileNodeSnapshotError {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }

  if (!(caught instanceof FileNodeSnapshotError)) {
    throw new Error("Expected FileNodeSnapshotError.");
  }
  equal(caught.name, "FileNodeSnapshotError");
  equal(caught.code, "wakeflow-file-node-snapshot");
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
  return caught;
}

function fakeBigIntStats(
  mode: number,
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    dev: 1n,
    ino: 2n,
    mode: BigInt(mode),
    nlink: 1n,
    uid: 501n,
    gid: 20n,
    rdev: 0n,
    size: 3n,
    mtimeNs: 4n,
    ctimeNs: 5n,
    ...overrides,
  };
}

function asFileNodeSnapshot(value: unknown): FileNodeSnapshot {
  return value as FileNodeSnapshot;
}

test("real file, directory, and symlink Stats become frozen snapshots", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-node-snapshot-"));
  const file = path.join(root, "record.json");
  const link = path.join(root, "record-link");
  try {
    writeFileSync(file, "abc", { mode: 0o640 });
    symlinkSync("record.json", link);

    const cases = [
      [root, "directory"],
      [file, "file"],
      [link, "symbolic-link"],
    ] as const;
    for (const [candidate, expectedKind] of cases) {
      const stats = lstatSync(candidate, { bigint: true });
      const snapshot = createFileNodeSnapshot(stats);

      equal(snapshot.kind, expectedKind);
      equal(snapshot.deviceId, stats.dev);
      equal(snapshot.inodeId, stats.ino);
      equal(snapshot.byteCount, Number(stats.size));
      equal(snapshot.permissionBits, Number(stats.mode & 0o777n));
      equal(Object.isFrozen(snapshot), true);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("mode bits classify every supported node kind without invoking methods", () => {
  const cases: readonly [number, FileNodeKind][] = [
    [fileSystemConstants.S_IFREG, "file"],
    [fileSystemConstants.S_IFDIR, "directory"],
    [fileSystemConstants.S_IFLNK, "symbolic-link"],
    [fileSystemConstants.S_IFIFO, "fifo"],
    [fileSystemConstants.S_IFSOCK, "socket"],
    [fileSystemConstants.S_IFCHR, "character-device"],
    [fileSystemConstants.S_IFBLK, "block-device"],
    [0, "unknown"],
  ];

  for (const [mode, expectedKind] of cases) {
    const snapshot = createFileNodeSnapshot(
      fakeBigIntStats(mode | 0o754),
    );
    equal(snapshot.kind, expectedKind);
    equal(snapshot.permissionBits, 0o754);
  }
});

test("snapshot preserves exact owner, link, device, size, and nanosecond facts", () => {
  const snapshot = createFileNodeSnapshot(fakeBigIntStats(
    fileSystemConstants.S_IFREG | 0o600,
    {
      dev: 10n,
      ino: 20n,
      nlink: 2n,
      uid: -1n,
      gid: -2n,
      rdev: 30n,
      size: 4_294_967_296n,
      mtimeNs: -40n,
      ctimeNs: 50n,
    },
  ));

  deepEqual(snapshot, {
    kind: "file",
    deviceId: 10n,
    inodeId: 20n,
    rawMode: BigInt(fileSystemConstants.S_IFREG | 0o600),
    permissionBits: 0o600,
    linkCount: 2n,
    userId: -1n,
    groupId: -2n,
    specialDeviceId: 30n,
    byteCount: 4_294_967_296,
    modifiedAtNanoseconds: -40n,
    changedAtNanoseconds: 50n,
  });
});

test("Stats size must fit the shared safe ByteCount range", () => {
  const oversized = fakeBigIntStats(fileSystemConstants.S_IFREG, {
    size: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
  });
  const error = expectFileNodeSnapshotError(
    () => createFileNodeSnapshot(oversized, "$.stats"),
    "stat-size",
    "$.stats.size",
  );

  equal(error.message.includes(String(Number.MAX_SAFE_INTEGER)), false);
});

test("missing, accessor, and invalid Stats fields fail without executing getters", () => {
  expectFileNodeSnapshotError(
    () => createFileNodeSnapshot({}, "$.stats"),
    "stat-field",
    "$.stats.dev",
  );
  expectFileNodeSnapshotError(
    () => createFileNodeSnapshot(
      fakeBigIntStats(fileSystemConstants.S_IFREG, { nlink: -1n }),
      "$.stats",
    ),
    "stat-field",
    "$.stats.nlink",
  );

  let getterCalls = 0;
  const accessor = fakeBigIntStats(fileSystemConstants.S_IFREG);
  Object.defineProperty(accessor, "size", {
    get: () => {
      getterCalls += 1;
      return 3n;
    },
    enumerable: true,
  });
  expectFileNodeSnapshotError(
    () => createFileNodeSnapshot(accessor, "$.stats"),
    "stat-shape",
    "$.stats",
  );
  equal(getterCalls, 0);
});

test("Proxy Stats are rejected before reflection traps run", () => {
  let trapCalls = 0;
  const proxy = new Proxy(fakeBigIntStats(fileSystemConstants.S_IFREG), {
    getOwnPropertyDescriptor: () => {
      trapCalls += 1;
      return undefined;
    },
    getPrototypeOf: () => {
      trapCalls += 1;
      return Object.prototype;
    },
  });

  expectFileNodeSnapshotError(
    () => createFileNodeSnapshot(proxy, "$.stats"),
    "stat-shape",
    "$.stats",
  );
  equal(trapCalls, 0);
});

test("node identity and complete snapshot comparisons remain distinct", () => {
  const base = createFileNodeSnapshot(fakeBigIntStats(
    fileSystemConstants.S_IFREG | 0o600,
  ));
  const contentChanged = createFileNodeSnapshot(fakeBigIntStats(
    fileSystemConstants.S_IFREG | 0o600,
    { size: 4n, mtimeNs: 6n, ctimeNs: 7n },
  ));
  const replacement = createFileNodeSnapshot(fakeBigIntStats(
    fileSystemConstants.S_IFREG | 0o600,
    { ino: 3n },
  ));

  equal(sameFileNodeIdentity(base, base), true);
  equal(sameFileNodeSnapshot(base, base), true);
  equal(sameFileNodeIdentity(base, contentChanged), true);
  equal(sameFileNodeSnapshot(base, contentChanged), false);
  equal(sameFileNodeIdentity(base, replacement), false);
  equal(sameFileNodeSnapshot(base, replacement), false);
});

test("comparison revalidates forged snapshot fields", () => {
  const valid = createFileNodeSnapshot(fakeBigIntStats(
    fileSystemConstants.S_IFREG | 0o600,
  ));
  const wrongKind = { ...valid, kind: "directory" };
  expectFileNodeSnapshotError(
    () => sameFileNodeIdentity(asFileNodeSnapshot(wrongKind), valid),
    "snapshot-field",
    "$left.kind",
  );

  const extra = { ...valid, extra: true };
  expectFileNodeSnapshotError(
    () => sameFileNodeSnapshot(asFileNodeSnapshot(extra), valid),
    "snapshot-shape",
    "$left",
  );
});
