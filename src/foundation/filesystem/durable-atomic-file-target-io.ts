import {
  failDurableAtomicFileWrite as fail,
  DurableAtomicFileWriteError,
  type DurableAtomicFileExpectation,
  type DurableAtomicFileInputBytes,
} from "./durable-atomic-file-write-contract.js";
import {
  snapshotDurableAtomicFileHandle,
  type PreparedDurableAtomicFileStage,
} from "./durable-atomic-file-stage-io.js";
import {
  sameFileNodeIdentity,
  sameFileNodeSnapshot,
  type FileNodeSnapshot,
} from "./file-node-snapshot.js";
import type { PortableResourcePath } from "./portable-resource-path.js";
import { RootedDirectory } from "./rooted-directory.js";
import {
  RootedResourceParentHandle,
  RootedResourceParentHandleError,
} from "./rooted-resource-parent-handle.js";
import {
  readStableFileDigest,
  StableFileReadError,
} from "./stable-file-read.js";

/** 持久化原子写入中，目标及父目录 I/O 与替换预期的精确复验。 */

function mapParentHandleError(
  error: RootedResourceParentHandleError,
  operation: "open" | "current" | "inspect" | "sync",
): never {
  if (operation === "sync" && error.reason === "sync-failure") {
    fail("durability-failure", "$resourcePath");
  }
  if (
    operation === "inspect"
    && error.reason === "target-inspection-failure"
  ) {
    fail("target-inspection-failure", "$resourcePath");
  }
  if (operation === "open") {
    if (error.reason === "input") fail("input", "$resourcePath");
    if (error.reason === "root-scope") fail("root-scope", "$resourcePath");
    if (error.reason === "parent-not-found") {
      fail("parent-not-found", "$resourcePath");
    }
    if (error.reason === "parent-symlink") {
      fail("parent-symlink", "$resourcePath");
    }
    if (error.reason === "parent-not-directory") {
      fail("parent-not-directory", "$resourcePath");
    }
    if (error.reason === "parent-open-failure") {
      fail("parent-open-failure", "$resourcePath");
    }
  }
  fail("parent-changed", "$resourcePath");
}

export async function openDurableAtomicFileTargetParent(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
): Promise<RootedResourceParentHandle> {
  try {
    return await RootedResourceParentHandle.open(
      root,
      resourcePath,
      "$resourcePath",
    );
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) {
      mapParentHandleError(error, "open");
    }
    throw error;
  }
}

export async function assertDurableAtomicFileTargetParentCurrent(
  parent: RootedResourceParentHandle,
): Promise<void> {
  try {
    await parent.assertCurrent();
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) {
      mapParentHandleError(error, "current");
    }
    throw error;
  }
}

export async function inspectDurableAtomicFileTarget(
  parent: RootedResourceParentHandle,
): Promise<Readonly<FileNodeSnapshot> | null> {
  try {
    return await parent.inspectTarget();
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) {
      mapParentHandleError(error, "inspect");
    }
    throw error;
  }
}

export async function assertDurableAtomicFileTargetAbsent(
  parent: RootedResourceParentHandle,
): Promise<void> {
  if (await inspectDurableAtomicFileTarget(parent) !== null) {
    fail("target-exists", "$resourcePath");
  }
}

export async function syncDurableAtomicFileTargetParent(
  parent: RootedResourceParentHandle,
): Promise<void> {
  try {
    await parent.sync();
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) {
      mapParentHandleError(error, "sync");
    }
    throw error;
  }
}

export async function closeDurableAtomicFileTargetParent(
  parent: RootedResourceParentHandle,
): Promise<DurableAtomicFileWriteError | undefined> {
  try {
    await parent.close();
    return undefined;
  } catch (error: unknown) {
    if (error instanceof RootedResourceParentHandleError) {
      return new DurableAtomicFileWriteError(
        error.reason === "close-failure" ? "close-failure" : "parent-changed",
        "$resourcePath",
      );
    }
    throw error;
  }
}

export async function assertExpectedDurableAtomicFileTarget(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  expected: Readonly<DurableAtomicFileExpectation>,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (expected.resourcePath !== resourcePath) {
    fail("input", "$options.expected.resourcePath");
  }
  let current;
  try {
    current = await readStableFileDigest(root, resourcePath, signal === undefined
      ? {
          maximumBytes: expected.byteCount,
          expectedNode: expected.node,
        }
      : {
          maximumBytes: expected.byteCount,
          expectedNode: expected.node,
          signal,
        });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "input") fail("input", "$resourcePath");
      if (
        error.reason === "root-scope"
        || error.reason === "unsupported-platform"
      ) {
        fail("root-scope", "$resourcePath");
      }
      if (
        error.reason === "not-found"
        || error.reason === "symlink"
        || error.reason === "not-file"
        || error.reason === "expectation-changed"
        || error.reason === "too-large"
        || error.reason === "source-changed"
      ) {
        fail("expectation-changed", "$resourcePath");
      }
      fail("expectation-read-failure", "$resourcePath");
    }
    throw error;
  }
  if (
    current.resourcePath !== expected.resourcePath
    || current.byteCount !== expected.byteCount
    || current.digest !== expected.digest
    || !sameFileNodeSnapshot(current.node, expected.node)
  ) {
    fail("expectation-changed", "$resourcePath");
  }
}

export async function inspectCommittedDurableAtomicFileTarget(
  parent: RootedResourceParentHandle,
  stage: Readonly<PreparedDurableAtomicFileStage>,
  input: Readonly<DurableAtomicFileInputBytes>,
  mode: number,
  expectedLinkCount: bigint,
): Promise<Readonly<FileNodeSnapshot>> {
  const target = await inspectDurableAtomicFileTarget(parent);
  if (target === null) fail("commit-uncertain", "$resourcePath");
  const opened = await snapshotDurableAtomicFileHandle(
    stage.handle,
    "commit-uncertain",
    "$resourcePath",
  );
  if (
    target.kind !== "file"
    || opened.kind !== "file"
    || target.byteCount !== input.byteCount
    || target.permissionBits !== mode
    || target.linkCount !== expectedLinkCount
    || opened.linkCount !== expectedLinkCount
    || !sameFileNodeIdentity(stage.node, opened)
    || !sameFileNodeIdentity(opened, target)
  ) {
    fail("commit-uncertain", "$resourcePath");
  }
  return target;
}
