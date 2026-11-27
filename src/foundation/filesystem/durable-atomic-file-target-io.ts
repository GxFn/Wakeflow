import {
  type PreparedDurableAtomicFileStage,
  snapshotDurableAtomicFileHandle,
} from "./durable-atomic-file-stage-io.js";
import {
  type DurableAtomicFileExpectation,
  type DurableAtomicFileInputBytes,
  DurableAtomicFileWriteError,
  failDurableAtomicFileWrite as fail,
} from "./durable-atomic-file-write-contract.js";
import {
  type FileNodeSnapshot,
  sameFileNodeIdentity,
  sameFileNodeSnapshot,
} from "./file-node-snapshot.js";
import type { PortableResourcePath } from "./portable-resource-path.js";
import type { RootedDirectory } from "./rooted-directory.js";
import {
  closeParentHandle,
  parentOpenRefusal,
  RootedResourceParentHandle,
  type RootedResourceParentHandleError,
  translateParentHandleError,
} from "./rooted-resource-parent-handle.js";
import { readStableFileDigest, StableFileReadError } from "./stable-file-read.js";

/** 耐久原子写入中，目标及父目录 I/O 与替换预期的精确复验。 */

function mapParentHandleError(
  error: RootedResourceParentHandleError,
  operation: "open" | "current" | "inspect" | "sync",
): never {
  if (operation === "sync" && error.reason === "sync-failure") {
    fail("durability-failure", "$resourcePath");
  }
  if (operation === "inspect" && error.reason === "target-inspection-failure") {
    fail("target-inspection-failure", "$resourcePath");
  }
  const refusal = operation === "open" ? parentOpenRefusal(error) : undefined;
  if (refusal !== undefined) fail(refusal, "$resourcePath");
  fail("parent-changed", "$resourcePath");
}

export function openDurableAtomicFileTargetParent(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
): Promise<RootedResourceParentHandle> {
  return translateParentHandleError(
    () => RootedResourceParentHandle.open(root, resourcePath, "$resourcePath"),
    (error) => mapParentHandleError(error, "open"),
  );
}

export async function assertDurableAtomicFileTargetParentCurrent(
  parent: RootedResourceParentHandle,
): Promise<void> {
  await translateParentHandleError(
    () => parent.assertCurrent(),
    (error) => mapParentHandleError(error, "current"),
  );
}

function inspectDurableAtomicFileTarget(
  parent: RootedResourceParentHandle,
): Promise<Readonly<FileNodeSnapshot> | null> {
  return translateParentHandleError(
    () => parent.inspectTarget(),
    (error) => mapParentHandleError(error, "inspect"),
  );
}

export async function assertDurableAtomicFileTargetAbsent(
  parent: RootedResourceParentHandle,
): Promise<void> {
  if ((await inspectDurableAtomicFileTarget(parent)) !== null) {
    fail("target-exists", "$resourcePath");
  }
}

export async function syncDurableAtomicFileTargetParent(
  parent: RootedResourceParentHandle,
): Promise<void> {
  await translateParentHandleError(
    () => parent.sync(),
    (error) => mapParentHandleError(error, "sync"),
  );
}

export function closeDurableAtomicFileTargetParent(
  parent: RootedResourceParentHandle,
): Promise<DurableAtomicFileWriteError | undefined> {
  return closeParentHandle(
    parent,
    (error) =>
      new DurableAtomicFileWriteError(
        error.reason === "close-failure" ? "close-failure" : "parent-changed",
        "$resourcePath",
      ),
  );
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
  let current: Awaited<ReturnType<typeof readStableFileDigest>>;
  try {
    current = await readStableFileDigest(
      root,
      resourcePath,
      signal === undefined
        ? {
            maximumBytes: expected.byteCount,
            expectedNode: expected.node,
          }
        : {
            maximumBytes: expected.byteCount,
            expectedNode: expected.node,
            signal,
          },
    );
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) {
      if (error.reason === "input") fail("input", "$resourcePath", error);
      if (error.reason === "root-scope" || error.reason === "unsupported-platform") {
        fail("root-scope", "$resourcePath", error);
      }
      if (
        error.reason === "not-found" ||
        error.reason === "symlink" ||
        error.reason === "not-file" ||
        error.reason === "expectation-changed" ||
        error.reason === "source-changed"
      ) {
        fail("expectation-changed", "$resourcePath", error);
      }
      fail("expectation-read-failure", "$resourcePath", error);
    }
    throw error;
  }
  if (
    current.resourcePath !== expected.resourcePath ||
    current.byteCount !== expected.byteCount ||
    current.digest !== expected.digest ||
    !sameFileNodeSnapshot(current.node, expected.node)
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
    target.kind !== "file" ||
    opened.kind !== "file" ||
    target.byteCount !== input.byteCount ||
    target.permissionBits !== mode ||
    target.linkCount !== expectedLinkCount ||
    opened.linkCount !== expectedLinkCount ||
    !sameFileNodeIdentity(stage.node, opened) ||
    !sameFileNodeIdentity(opened, target) ||
    !sameFileNodeSnapshot(opened, target)
  ) {
    fail("commit-uncertain", "$resourcePath");
  }
  return target;
}
