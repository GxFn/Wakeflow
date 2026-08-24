import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { inspectFutureFileInside } from "./wakeflow-fs-safety.mjs";

/**
 * Wakeflow共享单文件原子发布primitive。
 *
 * 阅读地图：输入层冻结exact expectation与可选physical source identity；提交层创建同目录私有
 * stage并在commit前重验；predecessor分支为具名domain recovery保留精确旧inode；mixed-owned
 * guard只提供领域前置判定。这里没有业务锁、跨文件事务、目录创建或持久化完成证明。
 */

// ==================== 一、公开合同与摘要 ====================

const DEFAULT_FILE_MODE = 0o600;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const OWNERSHIP_KINDS = new Set(["whole-file", "mixed-owned"]);
const ATOMIC_WRITE_OPTION_FIELDS = Object.freeze([
  "captureCommitIdentity",
  "content",
  "expectation",
  "label",
  "mixedOwnedGuard",
  "mode",
  "ownership",
  "root",
  "sourceIdentity",
  "target",
]);

export class WakeflowAtomicWriteError extends Error {
  constructor(message, { code = "atomic-write-error", cause, ...details } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowAtomicWriteError";
    this.code = code;
    this.details = {
      ...details,
      code,
    };
    if (cause !== undefined && this.cause === undefined) this.cause = cause;
  }
}

export function sha256Bytes(value) {
  return createHash("sha256").update(toBytes(value)).digest("hex");
}

/**
 * 通过目标同目录的exclusive stage创建或替换一个regular file。
 *
 * caller必须给出absent或exact digest expectation；已有physical identity时还可要求inode级前任。
 * primitive在staging前、guard后和rename前重复检查，但独立进程CAS仍依赖domain lock。它不执行
 * fsync、不创建父目录、不合并mixed-owned内容，也不把一次rename解释为业务事务完成。
 */
export function atomicWriteFile(input = undefined) {
  const {
    root,
    target,
    content,
    expectation,
    mode,
    ownership,
    mixedOwnedGuard,
    sourceIdentity,
    captureCommitIdentity,
    label,
  } = normalizeAtomicWriteOptions(input);
  assertSupportedPlatform();
  const bytes = toBytes(content);
  const expected = normalizeExpectation(expectation);
  const normalizedMode = normalizeMode(mode);
  const normalizedOwnership = normalizeOwnership(ownership, mixedOwnedGuard);
  const normalizedSourceIdentity = normalizeSourceIdentity(sourceIdentity, expected);
  if (typeof captureCommitIdentity !== "boolean") {
    throw new WakeflowAtomicWriteError("captureCommitIdentity must be a boolean", {
      code: "invalid-commit-identity-option",
    });
  }

  const first = inspectFutureFileInside({ root, candidate: target, label });
  assertParentExists(first, label);
  const initialSource = inspectExpectedSource({
    inspected: first,
    expected,
    sourceIdentity: normalizedSourceIdentity,
    label,
  });
  runMixedOwnedGuard({
    ownership: normalizedOwnership,
    guard: mixedOwnedGuard,
    source: initialSource,
    target: first.lexicalCandidate,
    expectation: expected,
    phase: "before-stage",
  });

  const stageDirectory = path.dirname(first.lexicalCandidate);
  const stagePath = path.join(
    stageDirectory,
    `.${path.basename(first.lexicalCandidate)}.wakeflow-stage-${process.pid}-${randomUUID()}`,
  );
  const predecessorPath = path.join(
    stageDirectory,
    `.${path.basename(first.lexicalCandidate)}.wakeflow-predecessor-${process.pid}-${randomUUID()}`,
  );
  let descriptor = null;
  let stageOwned = false;
  let predecessorOwned = false;
  let stageIdentity = null;
  let primaryError = null;

  try {
    try {
      const noFollow = fs.constants.O_NOFOLLOW ?? 0;
      descriptor = fs.openSync(
        stagePath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow,
        normalizedMode,
      );
      stageOwned = true;
    } catch (cause) {
      throw new WakeflowAtomicWriteError(`cannot create exclusive stage for ${label}`, {
        code: "stage-create-failed",
        target: first.lexicalCandidate,
        stageDirectory,
        cause,
      });
    }

    try {
      fs.fchmodSync(descriptor, normalizedMode);
      fs.writeFileSync(descriptor, bytes);
      const staged = fs.fstatSync(descriptor, { bigint: true });
      if (
        !staged.isFile()
        || staged.nlink !== 1n
        || Number(staged.mode & 0o777n) !== normalizedMode
        || staged.size !== BigInt(bytes.length)
      ) {
        throw new WakeflowAtomicWriteError(`private stage changed while writing ${label}`, {
          code: "stage-write-failed",
          target: first.lexicalCandidate,
          stageDirectory,
        });
      }
      stageIdentity = commitIdentity(staged);
      fs.closeSync(descriptor);
      descriptor = null;
    } catch (cause) {
      throw new WakeflowAtomicWriteError(`cannot write private stage for ${label}`, {
        code: "stage-write-failed",
        target: first.lexicalCandidate,
        stageDirectory,
        cause,
      });
    }

    const finalInspection = inspectFutureFileInside({
      root,
      candidate: first.lexicalCandidate,
      label,
    });
    assertParentExists(finalInspection, label);
    const finalSource = inspectExpectedSource({
      inspected: finalInspection,
      expected,
      sourceIdentity: normalizedSourceIdentity,
      label,
    });
    runMixedOwnedGuard({
      ownership: normalizedOwnership,
      guard: mixedOwnedGuard,
      source: finalSource,
      target: finalInspection.lexicalCandidate,
      expectation: expected,
      phase: "before-rename",
    });

    // A caller-supplied guard must not be able to invalidate the primitive's
    // exact-source fence by mutating the target while returning { ok: true }.
    // No callback runs between this last check and rename. Independent process
    // races still require the owning domain's lock/admission protocol.
    const commitInspection = inspectFutureFileInside({
      root,
      candidate: finalInspection.lexicalCandidate,
      label,
    });
    assertParentExists(commitInspection, label);
    inspectExpectedSource({
      inspected: commitInspection,
      expected,
      sourceIdentity: normalizedSourceIdentity,
      label,
    });

    let stagedPathStat;
    try {
      stagedPathStat = fs.lstatSync(stagePath, { bigint: true });
    } catch (cause) {
      throw new WakeflowAtomicWriteError(`private stage disappeared before commit for ${label}`, {
        code: "stage-source-changed",
        target: first.lexicalCandidate,
        stageDirectory,
        cause,
      });
    }
    if (!stageIdentity || !sameCommitIdentity(stageIdentity, commitIdentity(stagedPathStat))) {
      throw new WakeflowAtomicWriteError(`private stage changed before commit for ${label}`, {
        code: "stage-source-changed",
        target: first.lexicalCandidate,
        stageDirectory,
      });
    }

    if (normalizedSourceIdentity !== null) {
      try {
        fs.renameSync(commitInspection.lexicalCandidate, predecessorPath);
        predecessorOwned = true;
      } catch (cause) {
        throw new WakeflowAtomicWriteError(`cannot capture exact predecessor for ${label}`, {
          code: "predecessor-capture-failed",
          target: commitInspection.lexicalCandidate,
          stageDirectory,
          cause,
        });
      }
      let predecessor;
      try {
        predecessor = fs.lstatSync(predecessorPath, { bigint: true });
      } catch (cause) {
        throw new WakeflowAtomicWriteError(`captured predecessor is unavailable for ${label}`, {
          code: "predecessor-identity-changed",
          target: commitInspection.lexicalCandidate,
          stageDirectory,
          cause,
        });
      }
      if (!sameMovedSourceIdentity(normalizedSourceIdentity, statSourceIdentity(predecessor))) {
        throw new WakeflowAtomicWriteError(`captured predecessor changed for ${label}`, {
          code: "predecessor-identity-changed",
          target: commitInspection.lexicalCandidate,
          stageDirectory,
        });
      }
      publishStageWithoutReplacement({
        stagePath,
        target: commitInspection.lexicalCandidate,
        stageIdentity,
        label,
        stageDirectory,
      });
      stageOwned = false;
      unlinkExactPredecessor({
        predecessorPath,
        sourceIdentity: normalizedSourceIdentity,
        target: commitInspection.lexicalCandidate,
        label,
        stageDirectory,
      });
      predecessorOwned = false;
    } else if (captureCommitIdentity) {
      publishStageWithoutReplacement({
        stagePath,
        target: commitInspection.lexicalCandidate,
        stageIdentity,
        label,
        stageDirectory,
      });
      stageOwned = false;
    } else {
      try {
        fs.renameSync(stagePath, commitInspection.lexicalCandidate);
        stageOwned = false;
      } catch (cause) {
        throw new WakeflowAtomicWriteError(`cannot rename private stage for ${label}`, {
          code: "rename-failed",
          target: commitInspection.lexicalCandidate,
          stageDirectory,
          cause,
        });
      }
    }

    let committed;
    try {
      committed = fs.lstatSync(commitInspection.lexicalCandidate, { bigint: true });
    } catch (cause) {
      throw new WakeflowAtomicWriteError(`committed target is unavailable for ${label}`, {
        code: "commit-target-changed",
        target: commitInspection.lexicalCandidate,
        cause,
      });
    }
    const committedIdentity = commitIdentity(committed);
    if (!sameCommitIdentity(stageIdentity, committedIdentity)) {
      throw new WakeflowAtomicWriteError(`committed target changed during rename for ${label}`, {
        code: "commit-target-changed",
        target: commitInspection.lexicalCandidate,
      });
    }

    return {
      path: commitInspection.lexicalCandidate,
      ownership: normalizedOwnership,
      previous: publicSourceState(initialSource),
      current: {
        type: "file",
        sha256: sha256Bytes(bytes),
      },
      bytes: bytes.length,
      mode: normalizedMode,
      commit: "same-directory-rename",
      ...(captureCommitIdentity ? { commitIdentity: committedIdentity } : {}),
    };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Preserve the primary structured error. The private stage is still
        // unlinked below when the descriptor close itself failed.
      }
    }
    // An exact predecessor is deliberately left in place on failure. It is
    // recovery evidence owned by the caller's mutation gate, not disposable
    // scratch that this primitive can safely guess away.
    if (predecessorOwned) {
      primaryError = primaryError ?? new WakeflowAtomicWriteError(
        `exact predecessor remains for ${label}`,
        {
          code: "predecessor-recovery-required",
          target: first.lexicalCandidate,
          stageDirectory,
        },
      );
    }
    if (stageOwned) {
      try {
        fs.unlinkSync(stagePath);
      } catch (error) {
        if (error?.code !== "ENOENT") {
          const cleanupError = new WakeflowAtomicWriteError(`cannot clean private stage for ${label}`, {
            code: "stage-cleanup-failed",
            target: first.lexicalCandidate,
            stageDirectory,
            cause: error,
          });
          if (primaryError) {
            // Preserve the operation failure as primary while making the
            // leftover-stage condition machine-readable for the owning domain.
            primaryError.cleanupError = cleanupError;
          } else {
            throw cleanupError;
          }
        }
      }
    }
  }
}

// ==================== 二、输入归一化与平台边界 ====================

function assertSupportedPlatform() {
  if (process.platform === "win32") {
    throw new WakeflowAtomicWriteError(
      "atomic writes require POSIX file-mode semantics and are unsupported on Windows",
      {
        code: "unsupported-platform",
        platform: process.platform,
      },
    );
  }
}

function toBytes(value) {
  if (typeof value === "string") return Buffer.from(value, "utf8");
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  throw new WakeflowAtomicWriteError("atomic write content must be a string, Buffer, or Uint8Array", {
    code: "invalid-content",
    actualType: value === null ? "null" : typeof value,
  });
}

// 公开primitive先把operation object复制成被动数据；getter、Symbol、hidden字段和自定义原型
// 都不能在filesystem admission之前执行或被静默忽略。
function normalizeAtomicWriteOptions(input) {
  const value = input === undefined ? {} : input;
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw invalidOptions("atomic write options must be one plain data object");
  }
  const allowed = new Set(ATOMIC_WRITE_OPTION_FIELDS);
  const result = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      throw invalidOptions("atomic write options contain an unknown field", {
        field: typeof key === "string" ? key : "<symbol>",
      });
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw invalidOptions("atomic write options must contain only enumerable data properties", {
        field: key,
      });
    }
    result[key] = descriptor.value;
  }
  const label = result.label === undefined ? "atomic write target" : result.label;
  if (typeof label !== "string" || !label.trim()) {
    throw invalidOptions("atomic write label must be one non-empty string", { field: "label" });
  }
  return Object.freeze({
    root: result.root,
    target: result.target,
    content: result.content,
    expectation: result.expectation,
    mode: result.mode === undefined ? DEFAULT_FILE_MODE : result.mode,
    ownership: result.ownership === undefined ? "whole-file" : result.ownership,
    mixedOwnedGuard: result.mixedOwnedGuard === undefined ? null : result.mixedOwnedGuard,
    sourceIdentity: result.sourceIdentity === undefined ? null : result.sourceIdentity,
    captureCommitIdentity: result.captureCommitIdentity === undefined
      ? false
      : result.captureCommitIdentity,
    label,
  });
}

function invalidOptions(message, details = {}) {
  return new WakeflowAtomicWriteError(message, {
    code: "invalid-options",
    ...details,
  });
}

function normalizeExpectation(expectation) {
  if (
    !expectation
    || typeof expectation !== "object"
    || Array.isArray(expectation)
    || (Object.getPrototypeOf(expectation) !== Object.prototype
      && Object.getPrototypeOf(expectation) !== null)
  ) {
    throw invalidExpectation();
  }
  const ownKeys = Reflect.ownKeys(expectation);
  if (ownKeys.some((key) => typeof key !== "string")) throw invalidExpectation();
  const values = {};
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(expectation, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw invalidExpectation();
    }
    values[key] = descriptor.value;
  }
  const keys = /** @type {string[]} */ (ownKeys).sort();
  if (values.type === "absent") {
    if (keys.length !== 1 || keys[0] !== "type") throw invalidExpectation();
    return Object.freeze({ type: "absent" });
  }
  if (values.type === "file") {
    if (
      keys.length !== 2
      || keys[0] !== "sha256"
      || keys[1] !== "type"
      || typeof values.sha256 !== "string"
      || !SHA256_PATTERN.test(values.sha256)
    ) {
      throw invalidExpectation();
    }
    return Object.freeze({ type: "file", sha256: values.sha256 });
  }
  throw invalidExpectation();
}

function normalizeSourceIdentity(value, expectation) {
  if (value === null || value === undefined) return null;
  const fields = [
    "deviceId",
    "inodeId",
    "mode",
    "uid",
    "gid",
    "linkCount",
    "size",
    "mtimeNs",
    "ctimeNs",
  ];
  if (
    expectation.type !== "file"
    || !value
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== fields.length
    || Reflect.ownKeys(value).some((key) => typeof key !== "string" || !fields.includes(key))
  ) {
    throw new WakeflowAtomicWriteError("sourceIdentity requires one exact file-stat identity", {
      code: "invalid-source-identity",
    });
  }
  const normalized = {};
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (
      !descriptor?.enumerable
      || !Object.hasOwn(descriptor, "value")
      || typeof descriptor.value !== "string"
      || !/^(?:0|[1-9][0-9]*)$/u.test(descriptor.value)
    ) {
      throw new WakeflowAtomicWriteError("sourceIdentity requires decimal data fields", {
        code: "invalid-source-identity",
        field,
      });
    }
    normalized[field] = descriptor.value;
  }
  return Object.freeze(normalized);
}

function invalidExpectation() {
  return new WakeflowAtomicWriteError(
    "atomic write expectation must be exactly { type: \"absent\" } or { type: \"file\", sha256: <lowercase sha256> }",
    {
      code: "invalid-expectation",
    },
  );
}

function normalizeMode(mode) {
  if (!Number.isInteger(mode) || mode < 0 || mode > 0o777) {
    throw new WakeflowAtomicWriteError("atomic write mode must be an integer from 0000 through 0777", {
      code: "invalid-mode",
      mode,
    });
  }
  return mode;
}

function normalizeOwnership(ownership, mixedOwnedGuard) {
  if (!OWNERSHIP_KINDS.has(ownership)) {
    throw new WakeflowAtomicWriteError("atomic write ownership must be whole-file or mixed-owned", {
      code: "invalid-ownership",
      ownership,
    });
  }
  if (ownership === "mixed-owned" && typeof mixedOwnedGuard !== "function") {
    throw new WakeflowAtomicWriteError("mixed-owned writes require an explicit current-bytes guard", {
      code: "mixed-owned-guard-required",
      ownership,
    });
  }
  if (ownership === "whole-file" && mixedOwnedGuard !== null && mixedOwnedGuard !== undefined) {
    throw new WakeflowAtomicWriteError("a mixed-owned guard is valid only for mixed-owned writes", {
      code: "mixed-owned-guard-unexpected",
      ownership,
    });
  }
  return ownership;
}

function assertParentExists(inspected, label) {
  if (!inspected.parentExists) {
    throw new WakeflowAtomicWriteError(`parent directory does not exist for ${label}`, {
      code: "parent-missing",
      target: inspected.lexicalCandidate,
      nearestExistingAncestor: inspected.nearestExistingAncestor,
      missingSegments: inspected.missingSegments,
    });
  }
}

// ==================== 三、source读取、身份与expectation重验 ====================

function inspectExpectedSource({ inspected, expected, sourceIdentity, label }) {
  const source = inspected.targetType === "absent"
    ? { type: "absent", bytes: null, sha256: null, sourceIdentity: null }
    : readRegularFile(inspected.lexicalCandidate, label);
  const matches = expected.type === source.type
    && (expected.type === "absent" || expected.sha256 === source.sha256);
  if (!matches) {
    throw new WakeflowAtomicWriteError(`source expectation changed for ${label}`, {
      code: "expectation-mismatch",
      target: inspected.lexicalCandidate,
      expected,
      actual: publicSourceState(source),
    });
  }
  if (
    sourceIdentity !== null
    && !sameSourceIdentity(sourceIdentity, source.sourceIdentity)
  ) {
    throw new WakeflowAtomicWriteError(`source identity changed for ${label}`, {
      code: "source-identity-mismatch",
      target: inspected.lexicalCandidate,
    });
  }
  return source;
}

function readRegularFile(file, label) {
  let descriptor = null;
  try {
    const noFollow = fs.constants.O_NOFOLLOW ?? 0;
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile()) {
      throw new WakeflowAtomicWriteError(`${label} source is no longer a regular file`, {
        code: "source-type-changed",
        target: file,
      });
    }
    const bytes = fs.readFileSync(descriptor);
    const afterDescriptor = fs.fstatSync(descriptor, { bigint: true });
    const afterPath = fs.lstatSync(file, { bigint: true });
    if (
      !sameSourceIdentity(statSourceIdentity(opened), statSourceIdentity(afterDescriptor))
      || !sameSourceIdentity(statSourceIdentity(opened), statSourceIdentity(afterPath))
      || afterDescriptor.size !== BigInt(bytes.length)
    ) {
      throw new WakeflowAtomicWriteError(`${label} source changed while being read`, {
        code: "source-identity-changed",
        target: file,
      });
    }
    return {
      type: "file",
      bytes,
      sha256: sha256Bytes(bytes),
      sourceIdentity: statSourceIdentity(opened),
    };
  } catch (cause) {
    if (cause instanceof WakeflowAtomicWriteError) throw cause;
    throw new WakeflowAtomicWriteError(`cannot read current source for ${label}`, {
      code: "source-read-failed",
      target: file,
      cause,
    });
  } finally {
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // A read failure is already reported above; no file mutation occurred.
      }
    }
  }
}

function statSourceIdentity(stat) {
  return Object.freeze({
    deviceId: String(stat.dev),
    inodeId: String(stat.ino),
    mode: String(stat.mode),
    uid: String(stat.uid),
    gid: String(stat.gid),
    linkCount: String(stat.nlink),
    size: String(stat.size),
    mtimeNs: String(stat.mtimeNs),
    ctimeNs: String(stat.ctimeNs),
  });
}

function sameSourceIdentity(left, right) {
  return left !== null
    && right !== null
    && Object.keys(left).every((field) => left[field] === right[field]);
}

function sameMovedSourceIdentity(left, right) {
  return left !== null
    && right !== null
    && [
      "deviceId",
      "inodeId",
      "mode",
      "uid",
      "gid",
      "linkCount",
      "size",
      "mtimeNs",
    ].every((field) => left[field] === right[field]);
}

function sameUnlinkedSourceIdentity(left, right) {
  return left !== null
    && right !== null
    && right.linkCount === "0"
    && [
      "deviceId",
      "inodeId",
      "mode",
      "uid",
      "gid",
      "size",
      "mtimeNs",
    ].every((field) => left[field] === right[field]);
}

function commitIdentity(stat) {
  return Object.freeze({
    deviceId: String(stat.dev),
    inodeId: String(stat.ino),
    mode: String(stat.mode),
    uid: String(stat.uid),
    gid: String(stat.gid),
    linkCount: String(stat.nlink),
    size: String(stat.size),
  });
}

function sameCommitIdentity(left, right) {
  return left !== null
    && right !== null
    && Object.keys(left).every((field) => left[field] === right[field]);
}

function sameCommitNode(left, right) {
  return left !== null
    && right !== null
    && ["deviceId", "inodeId", "mode", "uid", "gid", "size"]
      .every((field) => left[field] === right[field]);
}

// ==================== 四、stage发布与精确predecessor清理 ====================

function publishStageWithoutReplacement({
  stagePath,
  target,
  stageIdentity,
  label,
  stageDirectory,
}) {
  try {
    fs.linkSync(stagePath, target);
  } catch (cause) {
    throw new WakeflowAtomicWriteError(`cannot publish private stage without replacement for ${label}`, {
      code: "publish-without-replacement-failed",
      target,
      stageDirectory,
      cause,
    });
  }
  let staged;
  let published;
  try {
    staged = commitIdentity(fs.lstatSync(stagePath, { bigint: true }));
    published = commitIdentity(fs.lstatSync(target, { bigint: true }));
  } catch (cause) {
    throw new WakeflowAtomicWriteError(`published stage cannot be verified for ${label}`, {
      code: "commit-target-changed",
      target,
      stageDirectory,
      cause,
    });
  }
  if (
    !sameCommitNode(stageIdentity, staged)
    || !sameCommitNode(stageIdentity, published)
    || staged.linkCount !== "2"
    || published.linkCount !== "2"
  ) {
    throw new WakeflowAtomicWriteError(`published stage identity changed for ${label}`, {
      code: "commit-target-changed",
      target,
      stageDirectory,
    });
  }
  try {
    fs.unlinkSync(stagePath);
  } catch (cause) {
    throw new WakeflowAtomicWriteError(`cannot retire linked private stage for ${label}`, {
      code: "stage-cleanup-failed",
      target,
      stageDirectory,
      cause,
    });
  }
  let current;
  try {
    current = commitIdentity(fs.lstatSync(target, { bigint: true }));
  } catch (cause) {
    throw new WakeflowAtomicWriteError(`committed target is unavailable for ${label}`, {
      code: "commit-target-changed",
      target,
      stageDirectory,
      cause,
    });
  }
  if (!sameCommitIdentity(stageIdentity, current)) {
    throw new WakeflowAtomicWriteError(`committed target changed after stage retirement for ${label}`, {
      code: "commit-target-changed",
      target,
      stageDirectory,
    });
  }
}

function unlinkExactPredecessor({
  predecessorPath,
  sourceIdentity,
  target,
  label,
  stageDirectory,
}) {
  let descriptor = null;
  try {
    descriptor = fs.openSync(
      predecessorPath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    );
    const opened = fs.fstatSync(descriptor, { bigint: true });
    const beforePath = fs.lstatSync(predecessorPath, { bigint: true });
    if (
      !opened.isFile()
      || !sameMovedSourceIdentity(sourceIdentity, statSourceIdentity(opened))
      || !sameMovedSourceIdentity(sourceIdentity, statSourceIdentity(beforePath))
    ) {
      throw new WakeflowAtomicWriteError(`captured predecessor changed before cleanup for ${label}`, {
        code: "predecessor-identity-changed",
        target,
        stageDirectory,
      });
    }
    fs.unlinkSync(predecessorPath);
    const unlinked = fs.fstatSync(descriptor, { bigint: true });
    if (!sameUnlinkedSourceIdentity(sourceIdentity, statSourceIdentity(unlinked))) {
      throw new WakeflowAtomicWriteError(`captured predecessor was not the unlinked inode for ${label}`, {
        code: "predecessor-cleanup-ambiguous",
        target,
        stageDirectory,
      });
    }
    try {
      fs.lstatSync(predecessorPath, { bigint: true });
      throw new WakeflowAtomicWriteError(`captured predecessor path was repopulated for ${label}`, {
        code: "predecessor-cleanup-ambiguous",
        target,
        stageDirectory,
      });
    } catch (cause) {
      if (cause instanceof WakeflowAtomicWriteError) throw cause;
      if (cause?.code !== "ENOENT") {
        throw new WakeflowAtomicWriteError(`captured predecessor absence cannot be proven for ${label}`, {
          code: "predecessor-cleanup-ambiguous",
          target,
          stageDirectory,
          cause,
        });
      }
    }
  } catch (cause) {
    if (cause instanceof WakeflowAtomicWriteError) throw cause;
    throw new WakeflowAtomicWriteError(`cannot clean exact predecessor for ${label}`, {
      code: "predecessor-cleanup-failed",
      target,
      stageDirectory,
      cause,
    });
  } finally {
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      } catch (cause) {
        throw new WakeflowAtomicWriteError(`cannot close exact predecessor for ${label}`, {
          code: "predecessor-cleanup-failed",
          target,
          stageDirectory,
          cause,
        });
      }
    }
  }
}

function runMixedOwnedGuard({ ownership, guard, source, target, expectation, phase }) {
  if (ownership !== "mixed-owned") return;
  let verdict;
  try {
    verdict = guard({
      target,
      phase,
      expectation,
      currentType: source.type,
      currentSha256: source.sha256,
      currentBytes: source.bytes === null ? null : Buffer.from(source.bytes),
    });
  } catch (cause) {
    throw new WakeflowAtomicWriteError("mixed-owned current-bytes guard threw", {
      code: "mixed-owned-guard-rejected",
      target,
      phase,
      reason: "guard threw",
      cause,
    });
  }
  const normalizedVerdict = normalizeMixedOwnedVerdict(verdict);
  if (normalizedVerdict.ok !== true) {
    throw new WakeflowAtomicWriteError("mixed-owned current-bytes guard rejected the write", {
      code: "mixed-owned-guard-rejected",
      target,
      phase,
      reason: normalizedVerdict.reason ?? "guard did not return { ok: true }",
    });
  }
}

// guard是领域回调，但回执仍是数据合同；解析回执时不执行它携带的getter或继承行为。
function normalizeMixedOwnedVerdict(verdict) {
  if (
    !verdict
    || typeof verdict !== "object"
    || Array.isArray(verdict)
    || (Object.getPrototypeOf(verdict) !== Object.prototype
      && Object.getPrototypeOf(verdict) !== null)
  ) {
    return Object.freeze({ ok: false, reason: null });
  }
  const ownKeys = Reflect.ownKeys(verdict);
  if (ownKeys.some((key) => typeof key !== "string")) {
    return Object.freeze({ ok: false, reason: null });
  }
  const keys = /** @type {string[]} */ (ownKeys).sort();
  if (
    (keys.length !== 1 || keys[0] !== "ok")
    && (keys.length !== 2 || keys[0] !== "ok" || keys[1] !== "reason")
  ) {
    return Object.freeze({ ok: false, reason: null });
  }
  const values = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(verdict, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      return Object.freeze({ ok: false, reason: null });
    }
    values[key] = descriptor.value;
  }
  if (values.ok === true && keys.length === 1) return Object.freeze({ ok: true, reason: null });
  if (
    values.ok === false
    && (keys.length === 1 || (typeof values.reason === "string" && values.reason.trim()))
  ) {
    return Object.freeze({
      ok: false,
      reason: typeof values.reason === "string" ? values.reason : null,
    });
  }
  return Object.freeze({ ok: false, reason: null });
}

function publicSourceState(source) {
  return source.type === "absent"
    ? { type: "absent" }
    : { type: "file", sha256: source.sha256 };
}
