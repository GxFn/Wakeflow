import {
  createFileAtomically,
  replaceFileAtomically,
  DurableAtomicFileWriteError,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import { sameFileNodeSnapshot } from "../../foundation/filesystem/file-node-snapshot.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import type { StableFileSource } from "../../foundation/filesystem/stable-file-read.js";
import {
  inspectWakeflowSupportMemory,
  WakeflowSupportMemoryInspectionError,
  WAKEFLOW_SUPPORT_MEMORY_FILE_MODE,
  type WakeflowSupportMemoryInspection,
} from "./wakeflow-support-memory-inspection.js";
import {
  assertWakeflowSupportMemoryPublicationNotAborted,
  failWakeflowSupportMemoryPublication as fail,
  parseWakeflowSupportMemoryPublicationOptions,
  parseWakeflowSupportMemoryPublicationRequest,
  wakeflowSupportMemoryInspectionRequest,
  WakeflowSupportMemoryPublicationError,
  type WakeflowSupportMemoryPublicationEffect,
  type WakeflowSupportMemoryPublicationOptions,
  type WakeflowSupportMemoryPublicationReceipt,
  type WakeflowSupportMemoryPublicationRequest,
} from "./wakeflow-support-memory-publication-contract.js";

/**
 * Wakeflow Workspace / Support：whole-file memory 的无锁单资源 CAS 发布 owner。
 *
 * 整文件没有 outside merge；稳定 source 与 desired bytes 已由 inspection 闭合，因此
 * 单文件原子 create/replace 本身就是并发提交边界。提交后重新执行完整 inspection，
 * 验证节点、摘要、Config/Catalog authority 与 whole-file transition 全部收敛。
 */

function mapInspectionError(
  error: WakeflowSupportMemoryInspectionError,
  afterCommit: boolean,
): never {
  if (afterCommit) fail("commit-uncertain", "$resourcePath");
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "capacity") fail("capacity", "$target");
  if (
    error.reason === "input"
    || error.reason === "config"
    || error.reason === "profile"
    || error.reason === "catalog"
    || error.reason === "surface"
    || error.reason === "authority"
  ) {
    fail("input", error.path);
  }
  fail("source-invalid", "$source");
}

async function inspectCurrent(
  workspaceRoot: RootedDirectory,
  supportRoot: RootedDirectory,
  request: ReturnType<typeof parseWakeflowSupportMemoryPublicationRequest>,
  signal: AbortSignal | undefined,
  afterCommit: boolean,
): Promise<Readonly<WakeflowSupportMemoryInspection>> {
  try {
    return await inspectWakeflowSupportMemory(
      workspaceRoot,
      supportRoot,
      wakeflowSupportMemoryInspectionRequest(request, signal),
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowSupportMemoryInspectionError) {
      mapInspectionError(error, afterCommit);
    }
    fail(afterCommit ? "commit-uncertain" : "source-invalid", "$source");
  }
}

function mapAtomicError(error: DurableAtomicFileWriteError): never {
  if (error.reason === "input") fail("input", error.path);
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "capacity") fail("capacity", "$target");
  if (
    error.reason === "target-exists"
    || error.reason === "expectation-changed"
    || error.reason === "expectation-read-failure"
  ) {
    fail("conflict", "$source");
  }
  if (error.reason === "stage-recovery-required") {
    fail("recovery-required", "$resourcePath");
  }
  if (
    error.reason === "commit-uncertain"
    || error.reason === "durability-failure"
    || error.reason === "stage-cleanup-failure"
    || error.reason === "close-failure"
  ) {
    fail("commit-uncertain", "$resourcePath");
  }
  fail("effect-failure", "$resourcePath");
}

async function publishTarget(
  supportRoot: RootedDirectory,
  request: ReturnType<typeof parseWakeflowSupportMemoryPublicationRequest>,
  inspection: Readonly<WakeflowSupportMemoryInspection>,
  signal: AbortSignal | undefined,
): Promise<Readonly<WakeflowSupportMemoryPublicationEffect>> {
  if (
    inspection.status !== "publication-required"
    || inspection.transition.disposition === "current"
  ) {
    fail("source-invalid", "$target");
  }
  const target = inspection.transition;
  const resourcePath = request.profile.instructionFileName;
  try {
    if (target.disposition === "create-required") {
      if (inspection.source !== null) fail("source-invalid", "$source");
      return await createFileAtomically(
        supportRoot,
        resourcePath,
        target.desiredBytes,
        {
          mode: WAKEFLOW_SUPPORT_MEMORY_FILE_MODE,
          ...(signal === undefined ? {} : { signal }),
        },
      );
    }
    if (inspection.source === null) fail("source-invalid", "$source");
    return await replaceFileAtomically(
      supportRoot,
      resourcePath,
      target.desiredBytes,
      {
        mode: WAKEFLOW_SUPPORT_MEMORY_FILE_MODE,
        expected: inspection.source,
        ...(signal === undefined ? {} : { signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowSupportMemoryPublicationError) throw error;
    if (error instanceof DurableAtomicFileWriteError) mapAtomicError(error);
    fail("effect-failure", "$resourcePath");
  }
}

function sameSource(
  left: Readonly<StableFileSource>,
  right: Readonly<StableFileSource>,
): boolean {
  return left.resourcePath === right.resourcePath
    && left.byteCount === right.byteCount
    && left.digest === right.digest
    && sameFileNodeSnapshot(left.node, right.node);
}

function currentUserId(): bigint {
  if (process.platform === "win32" || typeof process.geteuid !== "function") {
    fail("source-invalid", "$source");
  }
  return BigInt(process.geteuid());
}

function assertReadback(
  request: ReturnType<typeof parseWakeflowSupportMemoryPublicationRequest>,
  before: Readonly<WakeflowSupportMemoryInspection>,
  effect: Readonly<WakeflowSupportMemoryPublicationEffect>,
  after: Readonly<WakeflowSupportMemoryInspection>,
): void {
  const source = after.source;
  const target = before.transition;
  if (
    before.status !== "publication-required"
    || target.disposition === "current"
    || source === null
    || after.status !== "current"
    || after.transition.sourceAuthority !== "desired"
    || after.currentConfigDigest !== before.currentConfigDigest
    || after.desiredConfigDigest !== before.desiredConfigDigest
    || after.catalogDigest !== before.catalogDigest
    || after.desiredAuthority.authorityDigest
      !== before.desiredAuthority.authorityDigest
    || effect.resourcePath !== request.profile.instructionFileName
    || effect.digest !== target.desiredDigest
    || effect.byteCount !== target.desiredByteCount
    || effect.node.kind !== "file"
    || effect.node.permissionBits !== WAKEFLOW_SUPPORT_MEMORY_FILE_MODE
    || effect.node.linkCount !== 1n
    || effect.node.userId !== currentUserId()
    || source.resourcePath !== effect.resourcePath
    || source.digest !== effect.digest
    || source.byteCount !== effect.byteCount
    || !sameFileNodeSnapshot(source.node, effect.node)
  ) {
    fail("commit-uncertain", "$resourcePath");
  }
  if (effect.publication === "created") {
    if (before.source !== null) fail("commit-uncertain", "$resourcePath");
  } else if (
    before.source === null
    || !sameSource(effect.previous, before.source)
  ) {
    fail("commit-uncertain", "$resourcePath");
  }
}

/** 幂等创建或 CAS 替换一个 Wakeflow-owned Support whole-file memory。 */
export async function publishWakeflowSupportMemory(
  workspaceRoot: RootedDirectory,
  supportRoot: RootedDirectory,
  requestValue: WakeflowSupportMemoryPublicationRequest,
  optionsValue?: WakeflowSupportMemoryPublicationOptions,
): Promise<Readonly<WakeflowSupportMemoryPublicationReceipt>> {
  const request = parseWakeflowSupportMemoryPublicationRequest(requestValue);
  const options = parseWakeflowSupportMemoryPublicationOptions(optionsValue);
  assertWakeflowSupportMemoryPublicationNotAborted(options.signal);
  const before = await inspectCurrent(
    workspaceRoot,
    supportRoot,
    request,
    options.signal,
    false,
  );
  if (before.status === "current") {
    return Object.freeze({
      disposition: "current",
      effect: null,
      inspection: before,
    });
  }
  assertWakeflowSupportMemoryPublicationNotAborted(options.signal);
  const effect = await publishTarget(
    supportRoot,
    request,
    before,
    options.signal,
  );
  const after = await inspectCurrent(
    workspaceRoot,
    supportRoot,
    request,
    options.signal,
    true,
  );
  assertReadback(request, before, effect, after);
  return Object.freeze({
    disposition: effect.publication,
    effect,
    inspection: after,
  });
}

export {
  WakeflowSupportMemoryPublicationError,
  type WakeflowSupportMemoryPublicationEffect,
  type WakeflowSupportMemoryPublicationErrorReason,
  type WakeflowSupportMemoryPublicationOptions,
  type WakeflowSupportMemoryPublicationReceipt,
  type WakeflowSupportMemoryPublicationRequest,
} from "./wakeflow-support-memory-publication-contract.js";
