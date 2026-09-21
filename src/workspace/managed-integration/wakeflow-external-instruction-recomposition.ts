import { types } from "node:util";

import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  createFileAtomically,
  replaceFileAtomically,
  DurableAtomicFileWriteError,
  type DurableAtomicFileReplaceResult,
  type DurableAtomicFileWriteResult,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import { sameFileNodeSnapshot } from "../../foundation/filesystem/file-node-snapshot.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import type { StableFileSource } from "../../foundation/filesystem/stable-file-read.js";
import {
  inspectWakeflowExternalInstruction,
  parseWakeflowExternalInstructionInspectionRequest,
  WakeflowExternalInstructionInspectionError,
  WAKEFLOW_EXTERNAL_INSTRUCTION_FILE_MODE,
  type ParsedWakeflowExternalInstructionInspectionRequest,
  type WakeflowExternalInstructionInspection,
  type WakeflowExternalInstructionInspectionRequest,
} from "./wakeflow-external-instruction-inspection.js";

/**
 * Wakeflow Workspace / Managed Integration：外部根托管块的 CAS owner。
 *
 * 本模块在调用方已经持有的维护事务内重新执行完整只读 inspection：目标不存在时以
 * 0644 原子创建，只含托管块；目标存在时以完整 StableFileSource 执行 CAS 替换并保留
 * 所有者原有的权限位。外部根不属于 Wakeflow 静态矩阵，所以这里没有宿主专属短锁与
 * 恢复 owner；并发写入由 CAS 拒绝（`conflict`），未知暂存残留按 `recovery-required` 报告。
 *
 * 提交后重新读取并重推导 desired authority。只有节点、摘要、权限、envelope 与 Config
 * 摘要全部闭合才返回成功。
 */

export type WakeflowExternalInstructionRecompositionRequest = Omit<
  WakeflowExternalInstructionInspectionRequest,
  "signal"
>;

export interface WakeflowExternalInstructionRecompositionOptions {
  readonly signal?: AbortSignal;
}

export type WakeflowExternalInstructionRecompositionEffect =
  | Readonly<DurableAtomicFileWriteResult<"created">>
  | Readonly<DurableAtomicFileReplaceResult>;

export interface WakeflowExternalInstructionRecompositionReceipt {
  readonly disposition: "current" | "created" | "replaced";
  readonly effect: Readonly<WakeflowExternalInstructionRecompositionEffect> | null;
  readonly inspection: Readonly<WakeflowExternalInstructionInspection>;
}

export type WakeflowExternalInstructionRecompositionErrorReason =
  | "input"
  | "unsupported-platform"
  | "root-scope"
  | "root-policy"
  | "source-invalid"
  | "capacity"
  | "conflict"
  | "recovery-required"
  | "aborted"
  | "effect-failure"
  | "commit-uncertain";

const ERROR_MESSAGES = {
  input: "Wakeflow external instruction recomposition input is invalid.",
  "unsupported-platform":
    "Wakeflow external instruction recomposition requires POSIX ownership facts.",
  "root-scope":
    "Wakeflow external instruction recomposition lost its root scope.",
  "root-policy":
    "Wakeflow external instruction recomposition requires a current-user root.",
  "source-invalid":
    "Wakeflow external instruction source cannot be recomposed safely.",
  capacity: "Wakeflow external instruction recomposition exceeds its byte budget.",
  conflict:
    "Wakeflow external instruction source changed before atomic publication.",
  "recovery-required":
    "Wakeflow external instruction target has stage residue that requires explicit recovery.",
  aborted: "Wakeflow external instruction recomposition was aborted.",
  "effect-failure": "Wakeflow external instruction recomposition effect failed.",
  "commit-uncertain":
    "Wakeflow external instruction recomposition commit outcome is uncertain.",
} as const satisfies Readonly<Record<
  WakeflowExternalInstructionRecompositionErrorReason,
  string
>>;

/** 外部指令重组失败的稳定、脱敏错误。 */
export class WakeflowExternalInstructionRecompositionError extends Error {
  override readonly name = "WakeflowExternalInstructionRecompositionError";
  readonly code = "wakeflow-external-instruction-recomposition" as const;
  readonly reason: WakeflowExternalInstructionRecompositionErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowExternalInstructionRecompositionErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(
  reason: WakeflowExternalInstructionRecompositionErrorReason,
  path: string,
): never {
  throw new WakeflowExternalInstructionRecompositionError(reason, path);
}

function assertRoot(value: unknown): asserts value is RootedDirectory {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !(value instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
}

function parseOptions(value: unknown): AbortSignal | undefined {
  if (value === undefined) return undefined;
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (Object.keys(record).some((key) => key !== "signal")) {
    fail("input", "$options");
  }
  if (record.signal === undefined) return undefined;
  if (
    typeof record.signal !== "object"
    || record.signal === null
    || types.isProxy(record.signal)
    || !(record.signal instanceof AbortSignal)
  ) {
    fail("input", "$options.signal");
  }
  return record.signal;
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("aborted", "$signal");
}

function parseRequest(
  value: WakeflowExternalInstructionRecompositionRequest,
  signal: AbortSignal | undefined,
): Readonly<ParsedWakeflowExternalInstructionInspectionRequest> {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || Object.hasOwn(value, "signal")
  ) {
    fail("input", "$request");
  }
  try {
    return parseWakeflowExternalInstructionInspectionRequest({
      ...value,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof WakeflowExternalInstructionInspectionError) {
      fail("input", error.path);
    }
    throw error;
  }
}

function currentUserId(): bigint {
  if (process.platform === "win32" || typeof process.geteuid !== "function") {
    fail("unsupported-platform", "$root");
  }
  return BigInt(process.geteuid());
}

async function assertCurrentUserRoot(
  root: RootedDirectory,
  expectedUserId: bigint,
): Promise<void> {
  let userId: bigint;
  try {
    userId = (await root.assertCurrent("$root")).userId;
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root-scope", "$root");
    throw error;
  }
  if (userId !== expectedUserId) fail("root-policy", "$root");
}

function inspectionRequest(
  request: Readonly<ParsedWakeflowExternalInstructionInspectionRequest>,
  signal: AbortSignal | undefined,
): WakeflowExternalInstructionInspectionRequest {
  return {
    profile: request.profile,
    target: request.target,
    currentConfig: request.currentConfig,
    expectedCurrentConfigDigest: request.currentConfigDigest,
    desiredConfig: request.desiredConfig,
    expectedDesiredConfigDigest: request.desiredConfigDigest,
    ...(signal === undefined ? {} : { signal }),
  };
}

async function inspectCurrent(
  root: RootedDirectory,
  request: Readonly<ParsedWakeflowExternalInstructionInspectionRequest>,
  signal: AbortSignal | undefined,
  afterCommit: boolean,
): Promise<Readonly<WakeflowExternalInstructionInspection>> {
  try {
    return await inspectWakeflowExternalInstruction(
      root,
      inspectionRequest(request, afterCommit ? undefined : signal),
    );
  } catch (error: unknown) {
    if (afterCommit) fail("commit-uncertain", "$resourcePath");
    if (error instanceof WakeflowExternalInstructionInspectionError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "unsupported-platform") {
        fail("unsupported-platform", "$root");
      }
      if (error.reason === "target-capacity") fail("capacity", "$target");
      if (error.reason === "source-capacity") fail("capacity", "$source");
      if (error.reason === "input" || error.reason === "authority") {
        fail("input", error.path);
      }
      fail("source-invalid", "$source");
    }
    fail("source-invalid", "$source");
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
  if (error.reason === "root-scope" || error.reason === "parent-changed") {
    fail("root-scope", "$root");
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
  root: RootedDirectory,
  request: Readonly<ParsedWakeflowExternalInstructionInspectionRequest>,
  inspection: Readonly<WakeflowExternalInstructionInspection>,
  signal: AbortSignal | undefined,
): Promise<Readonly<WakeflowExternalInstructionRecompositionEffect>> {
  const target = inspection.transition.target;
  if (inspection.status !== "recompose-required" || target === null) {
    fail("source-invalid", "$target");
  }
  const resourcePath = request.profile.instructionFileName;
  try {
    if (inspection.source === null) {
      return await createFileAtomically(root, resourcePath, target.bytes, {
        mode: WAKEFLOW_EXTERNAL_INSTRUCTION_FILE_MODE,
        ...(signal === undefined ? {} : { signal }),
      });
    }
    return await replaceFileAtomically(root, resourcePath, target.bytes, {
      mode: inspection.source.node.permissionBits,
      expected: inspection.source,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
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

function assertReadback(
  request: Readonly<ParsedWakeflowExternalInstructionInspectionRequest>,
  before: Readonly<WakeflowExternalInstructionInspection>,
  effect: Readonly<WakeflowExternalInstructionRecompositionEffect>,
  after: Readonly<WakeflowExternalInstructionInspection>,
  expectedUserId: bigint,
): void {
  const target = before.transition.target;
  const source = after.source;
  const expectedMode = before.source === null
    ? WAKEFLOW_EXTERNAL_INSTRUCTION_FILE_MODE
    : before.source.node.permissionBits;
  if (
    before.status !== "recompose-required"
    || target === null
    || source === null
    || after.status !== "managed-current"
    || after.transition.sourceAuthority !== "desired"
    || after.transition.target !== null
    || after.currentConfigDigest !== before.currentConfigDigest
    || after.desiredConfigDigest !== before.desiredConfigDigest
    || after.desiredAuthority.authorityDigest
      !== before.desiredAuthority.authorityDigest
    || after.desiredAuthority.bodyDigest !== before.desiredAuthority.bodyDigest
    || effect.resourcePath !== request.profile.instructionFileName
    || effect.digest !== target.digest
    || effect.byteCount !== target.byteCount
    || effect.node.kind !== "file"
    || effect.node.permissionBits !== expectedMode
    || effect.node.linkCount !== 1n
    || effect.node.userId !== expectedUserId
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

/**
 * 在调用方持有的维护事务内重推导并幂等创建或 CAS 替换外部根里的 Wakeflow 托管块。
 */
export async function recomposeWakeflowExternalInstruction(
  rootValue: RootedDirectory,
  requestValue: WakeflowExternalInstructionRecompositionRequest,
  optionsValue?: WakeflowExternalInstructionRecompositionOptions,
): Promise<Readonly<WakeflowExternalInstructionRecompositionReceipt>> {
  assertRoot(rootValue);
  const signal = parseOptions(optionsValue);
  assertNotAborted(signal);
  const request = parseRequest(requestValue, signal);
  const expectedUserId = currentUserId();
  await assertCurrentUserRoot(rootValue, expectedUserId);
  const before = await inspectCurrent(rootValue, request, signal, false);
  if (before.status !== "recompose-required") {
    return Object.freeze({
      disposition: "current",
      effect: null,
      inspection: before,
    });
  }
  await assertCurrentUserRoot(rootValue, expectedUserId);
  assertNotAborted(signal);
  const effect = await publishTarget(rootValue, request, before, signal);
  const after = await inspectCurrent(rootValue, request, signal, true);
  assertReadback(request, before, effect, after, expectedUserId);
  return Object.freeze({
    disposition: effect.publication,
    effect,
    inspection: after,
  });
}
