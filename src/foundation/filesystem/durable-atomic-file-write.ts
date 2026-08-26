import {
  link,
  rename,
} from "node:fs/promises";

import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import {
  assertDurableAtomicFileNotAborted,
  assertDurableAtomicFileRoot,
  failDurableAtomicFileWrite as fail,
  parseDurableAtomicFileCreateOptions,
  parseDurableAtomicFileReplaceOptions,
  snapshotDurableAtomicFileInputBytes,
  type DurableAtomicFileCreateOptions,
  type DurableAtomicFileExpectation,
  type DurableAtomicFileInputBytes,
  type DurableAtomicFilePublication,
  type DurableAtomicFileReplaceOptions,
  type DurableAtomicFileReplaceResult,
  type DurableAtomicFileWriteResult,
} from "./durable-atomic-file-write-contract.js";
import {
  assertDurableAtomicFileStageCurrent,
  closeDurableAtomicFileStageHandle,
  createExclusiveDurableAtomicFileStage,
  prepareDurableAtomicFileStage,
  recoverDurableAtomicFileStagesBeforeWrite,
  releaseDurableAtomicFileStage,
  unlinkOwnedDurableAtomicFileStage,
  verifyDurableAtomicFileHandleBytes,
  type OpenDurableAtomicFileStage,
  type PreparedDurableAtomicFileStage,
} from "./durable-atomic-file-stage-io.js";
import {
  assertDurableAtomicFileTargetAbsent,
  assertDurableAtomicFileTargetParentCurrent,
  assertExpectedDurableAtomicFileTarget,
  closeDurableAtomicFileTargetParent,
  inspectCommittedDurableAtomicFileTarget,
  openDurableAtomicFileTargetParent,
  syncDurableAtomicFileTargetParent,
} from "./durable-atomic-file-target-io.js";
import {
  sameFileNodeSnapshot,
  type FileNodeSnapshot,
} from "./file-node-snapshot.js";
import type { PortableResourcePath } from "./portable-resource-path.js";
import { RootedDirectory } from "./rooted-directory.js";

/**
 * Wakeflow Foundation / Filesystem：单个完整字节文件的持久化原子发布 facade。
 *
 * 本文件独占 create hard-link 与 replace rename 的 commit point，并编排相邻的合同、
 * self-describing stage I/O、target expectation 与 parent durability。子模块不公开第二套
 * writer；调用方仍只使用本文件的 create/replace API。
 *
 * Create 在 two-link 状态先同步 target parent，再退休 stage 并第二次同步；Replace 在
 * exact expectation 下 rename 后同步 file 与 parent。本层不创建父目录、不解释业务
 * authority，也不替代领域 lock/journal。
 */

async function performWrite<
  Publication extends DurableAtomicFilePublication,
>(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  input: Readonly<DurableAtomicFileInputBytes>,
  mode: number,
  signal: AbortSignal | undefined,
  publication: Publication,
  expected: Readonly<DurableAtomicFileExpectation> | null,
): Promise<Readonly<DurableAtomicFileWriteResult<Publication>>> {
  const parent = await openDurableAtomicFileTargetParent(root, resourcePath);
  let openStage: Readonly<OpenDurableAtomicFileStage> | undefined;
  let stage: Readonly<PreparedDurableAtomicFileStage> | undefined;
  let stagePathOwned = false;
  let committed = false;
  let primaryError: unknown;
  let result: Readonly<DurableAtomicFileWriteResult<Publication>> | undefined;

  try {
    await recoverDurableAtomicFileStagesBeforeWrite(root, resourcePath, signal);
    assertDurableAtomicFileNotAborted(signal);
    if (publication === "created") {
      await assertDurableAtomicFileTargetAbsent(parent);
    } else if (expected !== null) {
      await assertExpectedDurableAtomicFileTarget(
        root,
        resourcePath,
        expected,
        signal,
      );
    }

    openStage = await createExclusiveDurableAtomicFileStage(
      parent,
      publication === "created" ? "create" : "replace",
      resourcePath,
      input.digest,
      mode,
    );
    stagePathOwned = true;
    stage = await prepareDurableAtomicFileStage(
      openStage,
      input,
      mode,
      signal,
    );
    await assertDurableAtomicFileTargetParentCurrent(parent);
    await assertDurableAtomicFileStageCurrent(stage);
    assertDurableAtomicFileNotAborted(signal);

    if (publication === "created") {
      await assertDurableAtomicFileTargetAbsent(parent);
    } else if (expected !== null) {
      await assertExpectedDurableAtomicFileTarget(
        root,
        resourcePath,
        expected,
        signal,
      );
    }
    await assertDurableAtomicFileTargetParentCurrent(parent);
    await assertDurableAtomicFileStageCurrent(stage);
    const verifiedStageNode = await verifyDurableAtomicFileHandleBytes(
      stage.handle,
      input,
      signal,
      "stage-changed",
    );
    if (!sameFileNodeSnapshot(stage.node, verifiedStageNode)) {
      fail("stage-changed", "$stage");
    }
    assertDurableAtomicFileNotAborted(signal);

    let finalNode: Readonly<FileNodeSnapshot>;
    if (publication === "created") {
      try {
        await link(stage.physicalPath, parent.resourceAbsolutePath);
      } catch (error: unknown) {
        if (readNodeSystemErrorCode(error) === "EEXIST") {
          fail("target-exists", "$resourcePath");
        }
        fail("publish-failure", "$resourcePath");
      }
      committed = true;
      const linkedNode = await inspectCommittedDurableAtomicFileTarget(
        parent,
        stage,
        input,
        mode,
        2n,
      );
      try {
        await stage.handle.sync();
      } catch {
        fail("durability-failure", "$resourcePath");
      }
      const verifiedLinkedNode = await verifyDurableAtomicFileHandleBytes(
        stage.handle,
        input,
        undefined,
        "commit-uncertain",
      );
      if (!sameFileNodeSnapshot(linkedNode, verifiedLinkedNode)) {
        fail("commit-uncertain", "$resourcePath");
      }
      // two-link pair 先 durable；后续 cleanup 中断时仍可由 stage recovery 前向结算。
      await syncDurableAtomicFileTargetParent(parent);
      await assertDurableAtomicFileTargetParentCurrent(parent);
      const durableLinkedNode = await inspectCommittedDurableAtomicFileTarget(
        parent,
        stage,
        input,
        mode,
        2n,
      );
      if (!sameFileNodeSnapshot(linkedNode, durableLinkedNode)) {
        fail("commit-uncertain", "$resourcePath");
      }
      await unlinkOwnedDurableAtomicFileStage(stage);
      stagePathOwned = false;
      try {
        await stage.handle.sync();
      } catch {
        fail("durability-failure", "$resourcePath");
      }
      await syncDurableAtomicFileTargetParent(parent);
      await assertDurableAtomicFileTargetParentCurrent(parent);
      const verifiedFinalNode = await verifyDurableAtomicFileHandleBytes(
        stage.handle,
        input,
        undefined,
        "commit-uncertain",
      );
      finalNode = await inspectCommittedDurableAtomicFileTarget(
        parent,
        stage,
        input,
        mode,
        1n,
      );
      if (!sameFileNodeSnapshot(verifiedFinalNode, finalNode)) {
        fail("commit-uncertain", "$resourcePath");
      }
    } else {
      try {
        await rename(stage.physicalPath, parent.resourceAbsolutePath);
      } catch {
        fail("publish-failure", "$resourcePath");
      }
      committed = true;
      stagePathOwned = false;
      try {
        await stage.handle.sync();
      } catch {
        fail("durability-failure", "$resourcePath");
      }
      const verifiedCommittedNode = await verifyDurableAtomicFileHandleBytes(
        stage.handle,
        input,
        undefined,
        "commit-uncertain",
      );
      const committedNode = await inspectCommittedDurableAtomicFileTarget(
        parent,
        stage,
        input,
        mode,
        1n,
      );
      if (!sameFileNodeSnapshot(verifiedCommittedNode, committedNode)) {
        fail("commit-uncertain", "$resourcePath");
      }
      await syncDurableAtomicFileTargetParent(parent);
      await assertDurableAtomicFileTargetParentCurrent(parent);
      finalNode = await inspectCommittedDurableAtomicFileTarget(
        parent,
        stage,
        input,
        mode,
        1n,
      );
      if (!sameFileNodeSnapshot(committedNode, finalNode)) {
        fail("commit-uncertain", "$resourcePath");
      }
    }
    result = Object.freeze({
      resourcePath,
      publication,
      node: finalNode,
      byteCount: input.byteCount,
      digest: input.digest,
    });
  } catch (error: unknown) {
    primaryError = error;
  }

  if (openStage !== undefined && stagePathOwned && !committed) {
    try {
      await unlinkOwnedDurableAtomicFileStage(openStage);
      await syncDurableAtomicFileTargetParent(parent);
      stagePathOwned = false;
    } catch (error: unknown) {
      primaryError = error;
    }
  }
  if (openStage !== undefined) {
    const closeError = await closeDurableAtomicFileStageHandle(openStage.handle);
    if (primaryError === undefined && closeError !== undefined) {
      primaryError = closeError;
    }
    const releaseError = releaseDurableAtomicFileStage(openStage);
    if (primaryError === undefined && releaseError !== undefined) {
      primaryError = releaseError;
    }
  }
  const parentCloseError = await closeDurableAtomicFileTargetParent(parent);
  if (primaryError === undefined && parentCloseError !== undefined) {
    primaryError = parentCloseError;
  }

  if (primaryError !== undefined) throw primaryError;
  if (committed !== true || result === undefined) {
    fail("commit-uncertain", "$resourcePath");
  }
  return result;
}

/** 持久化创建一个此前不存在的完整字节文件。 */
export async function createFileAtomically(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  bytes: Uint8Array,
  options: DurableAtomicFileCreateOptions,
): Promise<Readonly<DurableAtomicFileWriteResult<"created">>> {
  assertDurableAtomicFileRoot(root);
  const parsed = parseDurableAtomicFileCreateOptions(options);
  const input = snapshotDurableAtomicFileInputBytes(bytes);
  assertDurableAtomicFileNotAborted(parsed.signal);
  return performWrite(
    root,
    resourcePath,
    input,
    parsed.mode,
    parsed.signal,
    "created",
    null,
  );
}

/** 持久化替换一个仍匹配完整前序 StableFileSource 的完整字节文件。 */
export async function replaceFileAtomically(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  bytes: Uint8Array,
  options: DurableAtomicFileReplaceOptions,
): Promise<Readonly<DurableAtomicFileReplaceResult>> {
  assertDurableAtomicFileRoot(root);
  const parsed = parseDurableAtomicFileReplaceOptions(options);
  if (parsed.expected.resourcePath !== resourcePath) {
    fail("input", "$options.expected.resourcePath");
  }
  const input = snapshotDurableAtomicFileInputBytes(bytes);
  assertDurableAtomicFileNotAborted(parsed.signal);
  const result = await performWrite(
    root,
    resourcePath,
    input,
    parsed.mode,
    parsed.signal,
    "replaced",
    parsed.expected,
  );
  return Object.freeze({ ...result, previous: parsed.expected });
}

export {
  DurableAtomicFileWriteError,
  type DurableAtomicFileCreateOptions,
  type DurableAtomicFileExpectation,
  type DurableAtomicFilePublication,
  type DurableAtomicFileReplaceOptions,
  type DurableAtomicFileReplaceResult,
  type DurableAtomicFileWriteErrorReason,
  type DurableAtomicFileWriteResult,
} from "./durable-atomic-file-write-contract.js";
