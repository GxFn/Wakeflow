import { deepEqual, equal } from "node:assert/strict";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  durableAtomicFileStageRef,
  issueDurableAtomicFileStageAddress,
  releaseDurableAtomicFileStageAddress,
} from "../../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import {
  createFileAtomically,
  DurableAtomicFileWriteError,
  replaceFileAtomically,
  type DurableAtomicFileCreateOptions,
  type DurableAtomicFileReplaceOptions,
  type DurableAtomicFileWriteErrorReason,
} from "../../../src/foundation/filesystem/durable-atomic-file-write.js";
import {
  createFileCandidateDurably,
} from "../../../src/foundation/filesystem/durable-file-candidate.js";
import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  RootedResourceParentHandle,
} from "../../../src/foundation/filesystem/rooted-resource-parent-handle.js";
import { readStableFileDigest } from "../../../src/foundation/filesystem/stable-file-read.js";
import { parseByteCount } from "../../../src/foundation/numeric/byte-count.js";

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
    readdirSync(directory).filter((name) => (
      name.startsWith(".wakeflow-atomic-")
    )),
  );
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

test("atomic create 在 stage cleanup 前后分别同步 target parent", {
  concurrency: false,
}, async () => {
  const rootPath = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-atomic-create-sync-order-",
  ));
  const root = await RootedDirectory.open(rootPath);
  const resourcePath = parsePortableResourcePath("state");
  const originalSync = RootedResourceParentHandle.prototype.sync;
  let targetParentSyncCount = 0;
  RootedResourceParentHandle.prototype.sync = async function patchedSync() {
    if (this.resourcePath === resourcePath) targetParentSyncCount += 1;
    return originalSync.call(this);
  };
  try {
    await createFileAtomically(root, resourcePath, Buffer.from("state"), {
      mode: 0o600,
    });
    equal(targetParentSyncCount, 2);
    deepEqual(directoryNames(rootPath), []);
  } finally {
    RootedResourceParentHandle.prototype.sync = originalSync;
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("zero-byte files use the same durable publication path", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-atomic-empty-"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const bytes = new Uint8Array(0);
    const result = await createFileAtomically(
      root,
      parsePortableResourcePath("empty"),
      bytes,
      { mode: 0 },
    );
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
      () => createFileAtomically(
        root,
        parsePortableResourcePath("state"),
        Buffer.from("replacement"),
        { mode: 0o600 },
      ),
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
  const root = await RootedDirectory.open(rootPath);
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

test("atomic create 自动恢复 inactive partial 与 two-link stage", async () => {
  const rootPath = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-atomic-recovery-",
  ));
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
    const partialStage = durableAtomicFileStageRef(
      partialTarget,
      partialAddress,
    );
    try {
      await createFileCandidateDurably(
        root,
        partialStage,
        Buffer.from("partial"),
        { mode: 0o600 },
      );
    } finally {
      releaseDurableAtomicFileStageAddress(partialAddress);
    }

    await createFileAtomically(root, partialTarget, partialBytes, {
      mode: 0o640,
    });
    equal(
      readFileSync(
        path.join(rootPath, ...partialTarget.split("/")),
        "utf8",
      ),
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
    const linkedStage = durableAtomicFileStageRef(linkedTarget, linkedAddress);
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
      () => createFileAtomically(root, linkedTarget, linkedBytes, {
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

test("stale replace expectation leaves the newer target untouched", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-atomic-stale-"));
  const target = path.join(rootPath, "state");
  writeFileSync(target, "initial");
  const root = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath("state");
    const before = await readStableFileDigest(root, resourcePath, {
      maximumBytes: parseByteCount(1024),
    });
    writeFileSync(target, "external-change");

    await expectAtomicWriteError(
      () => replaceFileAtomically(
        root,
        resourcePath,
        Buffer.from("ours"),
        {
          mode: 0o600,
          expected: before,
        },
      ),
      "expectation-changed",
      "$resourcePath",
    );
    equal(readFileSync(target, "utf8"), "external-change");
    deepEqual(directoryNames(rootPath), []);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("input bytes are snapshotted before asynchronous filesystem work", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-atomic-bytes-"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const bytes = Buffer.from("immutable-snapshot");
    const expected = Buffer.from(bytes);
    const pending = createFileAtomically(
      root,
      parsePortableResourcePath("state"),
      bytes,
      { mode: 0o600 },
    );
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
        () => createFileAtomically(
          root,
          parsePortableResourcePath(candidate),
          Buffer.from("value"),
          { mode: 0o600 },
        ),
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
      [{ mode: -1 }, "$options.mode"],
      [{ mode: 0o1000 }, "$options.mode"],
      [{ mode: 0o600, signal: {} }, "$options.signal"],
    ];
    for (const [options, expectedPath] of invalidCreate) {
      await expectAtomicWriteError(
        () => createFileAtomically(
          root,
          resourcePath,
          Buffer.from("value"),
          asCreateOptions(options),
        ),
        "input",
        expectedPath,
      );
    }
    await expectAtomicWriteError(
      () => createFileAtomically(
        root,
        resourcePath,
        "text" as unknown as Uint8Array,
        { mode: 0o600 },
      ),
      "input",
      "$bytes",
    );
    await expectAtomicWriteError(
      () => createFileAtomically(
        root,
        asPortableResourcePath("../escape"),
        Buffer.from("value"),
        { mode: 0o600 },
      ),
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
      () => createFileAtomically(
        root,
        resourcePath,
        Buffer.from("value"),
        asCreateOptions(accessor),
      ),
      "input",
      "$options",
    );
    equal(getterCalls, 0);

    const controller = new AbortController();
    controller.abort("private-abort");
    const aborted = await expectAtomicWriteError(
      () => createFileAtomically(
        root,
        resourcePath,
        Buffer.from("value"),
        { mode: 0o600, signal: controller.signal },
      ),
      "aborted",
      "$signal",
    );
    equal(aborted.message.includes("private-abort"), false);

    const stable = await readStableFileDigest(
      root,
      parsePortableResourcePath("state"),
      { maximumBytes: parseByteCount(1024) },
    );
    await expectAtomicWriteError(
      () => replaceFileAtomically(
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
      () => replaceFileAtomically(
        root,
        parsePortableResourcePath("state"),
        Buffer.from("after"),
        {
          mode: 0o600,
          expected: {
            ...stable,
            resourcePath: parsePortableResourcePath("different"),
          },
        },
      ),
      "input",
      "$options.expected.resourcePath",
    );
    await expectAtomicWriteError(
      () => replaceFileAtomically(
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
