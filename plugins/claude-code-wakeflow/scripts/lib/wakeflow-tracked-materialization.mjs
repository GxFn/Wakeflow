import {
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import { assertWakeflowMutationContext } from "./wakeflow-workspace-mutation.mjs";

/**
 * 已确认领域计划到唯一 M3 workspace mutation 的底层目录/文件物化适配器。
 *
 * 职责导航：
 * 1. 被动快照领域 codec、authority callback 与私有物理 operation。
 * 2. 把 absent→directory 和 absent/file→staged file 两类已确认 step 映射为严格 handler。
 * 3. 在 prepare/observe/commit/cleanup 边界复核 owner、mode、link、摘要与稳定文件身份。
 * 4. recovery 只识别同一 confirmed step 的合法物理中间态，terminal 只接受已清理终态。
 *
 * 本模块不选择路径、内容、容量政策或业务动作，也不签发 gate；这些事实分别由领域 owner
 * 和 wakeflow-workspace-mutation 持有。
 */

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const MODES = new Set(["0600", "0644", "0700", "0755"]);
const FILE_MODES = new Set(["0600", "0644"]);
const DIRECTORY_MODES = new Set(["0700", "0755"]);

export class WakeflowTrackedMaterializationError extends Error {
  constructor(code, message, { path: errorPath = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowTrackedMaterializationError";
    this.code = code;
    this.path = errorPath;
    this.details = deepFreeze({ ...details });
  }
}

function fail(code, message, { path: errorPath = "$", details = {}, cause } = {}) {
  throw new WakeflowTrackedMaterializationError(code, message, {
    path: errorPath,
    details,
    cause,
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected, label) {
  if (!isPlainObject(value)) fail("wakeflow-tracked-materialization-contract", `${label} must be a plain object`);
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== expected.length
    || actual.some((key) => typeof key !== "string" || !expected.includes(key))
  ) {
    fail("wakeflow-tracked-materialization-contract", `${label} has an invalid field set`, {
      details: { expected, actual: actual.map(String) },
    });
  }
  const snapshot = Object.create(null);
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-tracked-materialization-contract", `${label}.${key} must be an enumerable data property`);
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

// M3 callback 参数是可扩展 facade；这里只读取本 handler 真正拥有的字段，且绝不执行 getter。
function projectCallbackArguments(value, keys, label) {
  if (!isPlainObject(value)) {
    fail("wakeflow-tracked-materialization-contract", `${label} must be a plain object facade`);
  }
  const snapshot = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-tracked-materialization-contract", `${label}.${key} must be an enumerable data property`);
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

// 私有 operation 含 Buffer，不能走 JSON codec；仍必须是 standard dense own-data array。
function snapshotDenseDataArray(value, label) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail("wakeflow-tracked-materialization-contract", `${label} must be a standard array`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length) {
      fail("wakeflow-tracked-materialization-contract", `${label} has an additional property`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-tracked-materialization-contract", `${label}[${key}] must be an enumerable data property`);
    }
  }
  const snapshot = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-tracked-materialization-contract", `${label}[${index}] must be a dense data slot`);
    }
    snapshot.push(descriptor.value);
  }
  return Object.freeze(snapshot);
}

function canonicalSnapshot(value, label) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (cause) {
    fail("wakeflow-tracked-materialization-canonical", `${label} must be canonical JSON data`, { cause });
  }
}

function sameCanonical(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function currentEuid() {
  if (typeof process.geteuid !== "function") {
    fail("wakeflow-tracked-materialization-platform", "tracked materialization requires POSIX ownership semantics");
  }
  return process.geteuid();
}

function ownedByCurrentUser(stat) {
  const expected = currentEuid();
  return stat.uid === (typeof stat.uid === "bigint" ? BigInt(expected) : expected);
}

function modeString(stat) {
  const mode = typeof stat.mode === "bigint"
    ? Number(stat.mode & 0o777n)
    : stat.mode & 0o777;
  return `0${mode.toString(8).padStart(3, "0")}`;
}

function numericMode(value) {
  if (!MODES.has(value)) fail("wakeflow-tracked-materialization-mode", `unsupported target mode ${String(value)}`);
  return Number.parseInt(value, 8);
}

function sameIdentity(left, right) {
  return left !== null
    && right !== null
    && left.dev === right.dev
    && left.ino === right.ino;
}

function sameFileSnapshot(left, right) {
  return sameIdentity(left, right)
    && left.uid === right.uid
    && left.gid === right.gid
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function assertAbsolute(value, label) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || value.includes("\0")
    || !path.isAbsolute(value)
    || path.resolve(value) !== value
  ) fail("wakeflow-tracked-materialization-path", `${label} must be one normalized absolute path`);
  return value;
}

function assertNoSymlinkAncestor(candidate, { allowMissing = false, boundaryRoot }) {
  const absolute = path.resolve(candidate);
  const boundary = path.resolve(boundaryRoot);
  const relative = path.relative(boundary, absolute);
  if (
    relative === ".."
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) fail("wakeflow-tracked-materialization-path", "materialization target escapes its workspace parent boundary");
  let current = boundary;
  let missing = false;
  for (const segment of ["", ...relative.split(path.sep).filter(Boolean)]) {
    if (segment) current = path.join(current, segment);
    if (missing) continue;
    let stat;
    try {
      stat = lstatSync(current, { bigint: true });
    } catch (cause) {
      if (cause?.code === "ENOENT" && allowMissing) {
        missing = true;
        continue;
      }
      fail("wakeflow-tracked-materialization-path", "materialization ancestor cannot be inspected", {
        details: { ref: path.basename(absolute) },
        cause,
      });
    }
    if (stat.isSymbolicLink() || (!stat.isDirectory() && current !== absolute)) {
      fail("wakeflow-tracked-materialization-path", "materialization ancestry must contain only real directories");
    }
    if (stat.isDirectory()) {
      try {
        realpathSync(current);
      } catch (cause) {
        fail("wakeflow-tracked-materialization-path", "materialization ancestor cannot be resolved", { cause });
      }
    }
  }
}

function openDirectory(candidate, { expectedIdentity = null, allowedModes = null, label, boundaryRoot }) {
  assertNoSymlinkAncestor(candidate, { boundaryRoot });
  let descriptor;
  try {
    descriptor = openSync(
      candidate,
      fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0) | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const stat = fstatSync(descriptor, { bigint: true });
    const refreshed = lstatSync(candidate, { bigint: true });
    if (
      !stat.isDirectory()
      || !ownedByCurrentUser(stat)
      || !sameIdentity(stat, refreshed)
      || (expectedIdentity !== null && !sameIdentity(stat, expectedIdentity))
      || (allowedModes !== null && !allowedModes.includes(modeString(stat)))
    ) fail("wakeflow-tracked-materialization-directory", `${label} differs from its directory contract`);
    return { descriptor, stat };
  } catch (cause) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (cause instanceof WakeflowTrackedMaterializationError) throw cause;
    fail("wakeflow-tracked-materialization-directory", `cannot open ${label}`, { cause });
  }
}

function publicResource(ref, value) {
  return { ref, ...value };
}

function absentResource(ref) {
  return { ref, type: "absent" };
}

function inspectDirectoryTarget(operation, step, boundaryRoot) {
  const target = operation.targetPath;
  assertNoSymlinkAncestor(target, { allowMissing: true, boundaryRoot });
  let stat;
  try {
    stat = lstatSync(target, { bigint: true });
  } catch (cause) {
    if (cause?.code !== "ENOENT") {
      fail("wakeflow-tracked-materialization-directory", "cannot inspect tracked directory target", { cause });
    }
    const absent = { type: "absent" };
    return {
      state: "initial",
      targetIdentity: null,
      observation: {
        source: publicResource(step.source.ref, absent),
        staging: null,
        final: publicResource(step.final.ref, absent),
      },
    };
  }
  if (
    stat.isSymbolicLink()
    || !stat.isDirectory()
    || !ownedByCurrentUser(stat)
    || modeString(stat) !== step.final.mode
  ) fail("wakeflow-tracked-materialization-directory", "tracked directory target is unsafe or has mode drift");
  const current = { type: "directory", mode: step.final.mode, digest: step.final.digest };
  return {
    state: "committed",
    targetIdentity: stat,
    observation: {
      source: publicResource(step.source.ref, current),
      staging: null,
      final: publicResource(step.final.ref, current),
    },
  };
}

function inspectRegularFile(candidate, allowedModes, maxBytes, { allowLinkedPair = false } = {}) {
  let before;
  try {
    before = lstatSync(candidate, { bigint: true });
  } catch (cause) {
    if (cause?.code === "ENOENT") return { state: "absent", stat: null, digest: null };
    fail("wakeflow-tracked-materialization-file", "tracked file cannot be inspected", { cause });
  }
  if (
    before.isSymbolicLink()
    || !before.isFile()
    || !ownedByCurrentUser(before)
    || !allowedModes.includes(modeString(before))
    || (allowLinkedPair ? ![1n, 2n].includes(before.nlink) : before.nlink !== 1n)
    || before.size > BigInt(maxBytes)
  ) fail("wakeflow-tracked-materialization-file", "tracked file differs from its safe file contract");
  let descriptor;
  try {
    descriptor = openSync(candidate, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor, { bigint: true });
    if (!sameFileSnapshot(before, opened)) {
      fail("wakeflow-tracked-materialization-race", "tracked file changed while opening");
    }
    const expectedSize = Number(opened.size);
    const digest = createHash("sha256");
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, Math.max(1, expectedSize)));
    let offset = 0;
    while (offset < expectedSize) {
      const count = readSync(
        descriptor,
        chunk,
        0,
        Math.min(chunk.length, expectedSize - offset),
        offset,
      );
      if (count === 0) fail("wakeflow-tracked-materialization-race", "tracked file shrank while reading");
      digest.update(chunk.subarray(0, count));
      offset += count;
    }
    const extra = Buffer.allocUnsafe(1);
    const extraCount = readSync(descriptor, extra, 0, 1, expectedSize);
    const after = fstatSync(descriptor, { bigint: true });
    const refreshed = lstatSync(candidate, { bigint: true });
    if (
      extraCount !== 0
      || !sameFileSnapshot(opened, after)
      || !sameFileSnapshot(after, refreshed)
      || BigInt(offset) !== after.size
    ) fail("wakeflow-tracked-materialization-race", "tracked file changed while reading");
    return { state: "file", stat: after, digest: `sha256:${digest.digest("hex")}` };
  } catch (cause) {
    if (cause instanceof WakeflowTrackedMaterializationError) throw cause;
    fail("wakeflow-tracked-materialization-file", "tracked file cannot be read stably", { cause });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function actualDigest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function fileNode(inspected) {
  if (inspected.state === "absent") return { type: "absent" };
  return {
    type: "file",
    mode: modeString(inspected.stat),
    digest: inspected.digest,
  };
}

function inspectFileTarget(operation, step, boundaryRoot) {
  assertNoSymlinkAncestor(path.dirname(operation.targetPath), { boundaryRoot });
  const allowedFinalModes = [...new Set([
    step.final.mode,
    ...(step.source.type === "file" ? [step.source.mode] : []),
  ])];
  const final = inspectRegularFile(
    operation.targetPath,
    allowedFinalModes,
    operation.maxFileBytes,
    { allowLinkedPair: true },
  );
  const stage = inspectRegularFile(
    operation.stagePath,
    [step.final.mode],
    operation.maxFileBytes,
    { allowLinkedPair: true },
  );
  const finalNode = fileNode(final);
  const stageNode = fileNode(stage);
  const sourceExact = sameCanonical(finalNode, withoutRef(step.source));
  const targetExact = sameCanonical(finalNode, withoutRef(step.final));
  const stageAbsent = stage.state === "absent";
  const stageTarget = sameCanonical(stageNode, withoutRef(step.staging));
  const linkedPair = targetExact
    && stageTarget
    && sameIdentity(final.stat, stage.stat)
    && final.stat?.nlink === 2n
    && stage.stat?.nlink === 2n;
  let state = "illegal";
  if (sourceExact && stageAbsent) state = "initial";
  else if (sourceExact && stageTarget && stage.stat?.nlink === 1n) state = "prepared";
  else if (targetExact && stageAbsent) state = "committed";
  else if (step.source.type === "absent" && linkedPair) state = "committed-pair";
  const observation = state === "initial"
    ? {
        source: publicResource(step.source.ref, withoutRef(step.source)),
        staging: absentResource(step.staging.ref),
        final: publicResource(step.final.ref, withoutRef(step.source)),
      }
    : state === "prepared"
      ? {
          source: publicResource(step.source.ref, withoutRef(step.source)),
          staging: publicResource(step.staging.ref, withoutRef(step.staging)),
          final: publicResource(step.final.ref, withoutRef(step.source)),
        }
      : ["committed", "committed-pair"].includes(state)
        ? {
            source: publicResource(step.source.ref, withoutRef(step.final)),
            staging: absentResource(step.staging.ref),
            final: publicResource(step.final.ref, withoutRef(step.final)),
          }
        : null;
  return { state, observation, final, stage };
}

function withoutRef(resource) {
  return Object.fromEntries(Object.entries(resource).filter(([key]) => key !== "ref"));
}

function assertContext(workspaceRoot, context) {
  if (context === null || typeof context !== "object") {
    fail("wakeflow-tracked-materialization-context", "a branded workspace mutation context is required");
  }
  // 先验证 WeakMap 品牌，再读取 recoveryGeneration，避免伪造context在准入前执行getter。
  assertWakeflowMutationContext({ workspaceRoot, context });
  const mode = context.recoveryGeneration > 0 ? "recovery-cleanup" : "maintenance";
  assertWakeflowMutationContext({ workspaceRoot, context, mode });
}

function normalizeOperation(value, stepById) {
  const operation = exactKeys(
    value,
    ["stepId", "kind", "targetPath", "stagePath", "targetBytes", "maxFileBytes"],
    "tracked materialization private operation",
  );
  if (typeof operation.stepId !== "string" || !operation.stepId) {
    fail("wakeflow-tracked-materialization-operation", "private operation stepId is invalid");
  }
  const step = stepById.get(operation.stepId);
  if (!step) fail("wakeflow-tracked-materialization-operation", "private operation has no confirmed step");
  if (!new Set(["directory", "file"]).has(operation.kind)) {
    fail("wakeflow-tracked-materialization-operation", "private operation kind is invalid");
  }
  const targetPath = assertAbsolute(operation.targetPath, "private operation targetPath");
  if (operation.kind === "directory") {
    if (
      operation.stagePath !== null
      || operation.targetBytes !== null
      || operation.maxFileBytes !== null
      || step.stepKind !== "create-or-update"
      || step.source.type !== "absent"
      || step.staging !== null
      || step.final.type !== "directory"
      || !DIRECTORY_MODES.has(step.final.mode)
    ) fail("wakeflow-tracked-materialization-operation", "directory operation differs from its confirmed step");
    return Object.freeze({
      stepId: operation.stepId,
      kind: operation.kind,
      targetPath,
      stagePath: null,
      targetBytes: null,
      maxFileBytes: null,
    });
  }
  const stagePath = assertAbsolute(operation.stagePath, "private operation stagePath");
  if (
    path.dirname(stagePath) !== path.dirname(targetPath)
    || stagePath === targetPath
    || !Buffer.isBuffer(operation.targetBytes)
    || !Number.isSafeInteger(operation.maxFileBytes)
    || operation.maxFileBytes < operation.targetBytes.length
    || step.stepKind !== "create-or-update"
    || !["absent", "file"].includes(step.source.type)
    || (step.source.type === "file" && (
      !FILE_MODES.has(step.source.mode)
      || !DIGEST_RE.test(step.source.digest)
    ))
    || step.staging === null
    || step.staging.type !== "file"
    || step.final.type !== "file"
    || !FILE_MODES.has(step.final.mode)
    || !sameCanonical(withoutRef(step.staging), withoutRef(step.final))
    || actualDigest(operation.targetBytes) !== step.final.digest
  ) fail("wakeflow-tracked-materialization-operation", "file operation differs from its confirmed step");
  return Object.freeze({
    stepId: operation.stepId,
    kind: operation.kind,
    targetPath,
    stagePath,
    targetBytes: Buffer.from(operation.targetBytes),
    maxFileBytes: operation.maxFileBytes,
  });
}

function createDirectoryHandler(workspaceRoot, boundaryRoot, operation, step, validateAuthority) {
  let lastObservation = null;
  return Object.freeze({
    prepare(args) {
      const { context } = projectCallbackArguments(args, ["context"], `${step.stepId}.prepare arguments`);
      assertContext(workspaceRoot, context);
      validateAuthority({ context });
      const inspected = inspectDirectoryTarget(operation, step, boundaryRoot);
      if (inspected.state !== "initial") {
        fail("wakeflow-tracked-materialization-stale", `${step.stepId} changed before prepare`);
      }
    },

    observe(args) {
      const { context } = projectCallbackArguments(args, ["context"], `${step.stepId}.observe arguments`);
      assertContext(workspaceRoot, context);
      validateAuthority({ context });
      const inspected = inspectDirectoryTarget(operation, step, boundaryRoot);
      lastObservation = inspected;
      return inspected.observation;
    },

    commit(args) {
      const { context } = projectCallbackArguments(args, ["context"], `${step.stepId}.commit arguments`);
      assertContext(workspaceRoot, context);
      validateAuthority({ context });
      if (lastObservation?.state !== "initial") {
        fail("wakeflow-tracked-materialization-race", `${step.stepId} commit lacks one exact preceding observation`);
      }
      lastObservation = null;
      const parentPath = path.dirname(operation.targetPath);
      const parent = openDirectory(parentPath, { label: `${step.stepId} parent`, boundaryRoot });
      let created = null;
      try {
        const current = inspectDirectoryTarget(operation, step, boundaryRoot);
        if (current.state !== "initial") {
          fail("wakeflow-tracked-materialization-stale", `${step.stepId} is no longer absent`);
        }
        mkdirSync(operation.targetPath, { mode: numericMode(step.final.mode) });
        created = openDirectory(operation.targetPath, {
          label: step.stepId,
          allowedModes: null,
          boundaryRoot,
        });
        fchmodSync(created.descriptor, numericMode(step.final.mode));
        const hardened = fstatSync(created.descriptor, { bigint: true });
        const refreshed = lstatSync(operation.targetPath, { bigint: true });
        if (
          !sameIdentity(hardened, refreshed)
          || !ownedByCurrentUser(hardened)
          || modeString(hardened) !== step.final.mode
        ) fail("wakeflow-tracked-materialization-commit", `${step.stepId} mode hardening did not converge`);
        fsyncSync(created.descriptor);
        fsyncSync(parent.descriptor);
        if (!sameIdentity(parent.stat, fstatSync(parent.descriptor, { bigint: true }))) {
          fail("wakeflow-tracked-materialization-race", `${step.stepId} parent changed during commit`);
        }
        if (inspectDirectoryTarget(operation, step, boundaryRoot).state !== "committed") {
          fail("wakeflow-tracked-materialization-commit", `${step.stepId} did not reach its directory target`);
        }
      } catch (cause) {
        if (cause instanceof WakeflowTrackedMaterializationError) throw cause;
        fail("wakeflow-tracked-materialization-commit", `${step.stepId} directory commit failed`, { cause });
      } finally {
        if (created !== null) closeSync(created.descriptor);
        closeSync(parent.descriptor);
      }
    },
  });
}

function createFileHandler(workspaceRoot, boundaryRoot, operation, step, validateAuthority) {
  let lastPrepared = null;
  return Object.freeze({
    prepare(args) {
      const { context } = projectCallbackArguments(args, ["context"], `${step.stepId}.prepare arguments`);
      assertContext(workspaceRoot, context);
      validateAuthority({ context });
      const inspected = inspectFileTarget(operation, step, boundaryRoot);
      if (inspected.state !== "initial") {
        fail("wakeflow-tracked-materialization-stale", `${step.stepId} changed before prepare`);
      }
      const parent = openDirectory(path.dirname(operation.targetPath), {
        label: `${step.stepId} parent`,
        boundaryRoot,
      });
      let descriptor;
      try {
        descriptor = openSync(
          operation.stagePath,
          fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0),
          numericMode(step.final.mode),
        );
        writeFileSync(descriptor, operation.targetBytes);
        fchmodSync(descriptor, numericMode(step.final.mode));
        fsyncSync(descriptor);
        const stat = fstatSync(descriptor, { bigint: true });
        if (
          !stat.isFile()
          || !ownedByCurrentUser(stat)
          || stat.nlink !== 1n
          || modeString(stat) !== step.final.mode
          || stat.size !== BigInt(operation.targetBytes.length)
        ) fail("wakeflow-tracked-materialization-prepare", `${step.stepId} stage differs from its target`);
        fsyncSync(parent.descriptor);
      } catch (cause) {
        if (cause instanceof WakeflowTrackedMaterializationError) throw cause;
        fail("wakeflow-tracked-materialization-prepare", `${step.stepId} stage publication failed`, { cause });
      } finally {
        if (descriptor !== undefined) closeSync(descriptor);
        closeSync(parent.descriptor);
      }
    },

    observe(args) {
      const { context } = projectCallbackArguments(args, ["context"], `${step.stepId}.observe arguments`);
      assertContext(workspaceRoot, context);
      validateAuthority({ context });
      const inspected = inspectFileTarget(operation, step, boundaryRoot);
      if (inspected.state === "illegal" || inspected.observation === null) {
        fail("wakeflow-tracked-materialization-residue", `${step.stepId} has illegal file residue`);
      }
      lastPrepared = inspected.state === "prepared" ? {
        finalIdentity: inspected.final.stat,
        stageIdentity: inspected.stage.stat,
      } : null;
      return inspected.observation;
    },

    commit(args) {
      const { context } = projectCallbackArguments(args, ["context"], `${step.stepId}.commit arguments`);
      assertContext(workspaceRoot, context);
      validateAuthority({ context });
      if (lastPrepared === null) {
        fail("wakeflow-tracked-materialization-race", `${step.stepId} commit lacks one exact prepared observation`);
      }
      const expected = lastPrepared;
      lastPrepared = null;
      const inspected = inspectFileTarget(operation, step, boundaryRoot);
      if (
        inspected.state !== "prepared"
        || !sameIdentity(inspected.stage.stat, expected.stageIdentity)
        || (
          step.source.type === "file"
          && !sameIdentity(inspected.final.stat, expected.finalIdentity)
        )
      ) fail("wakeflow-tracked-materialization-stale", `${step.stepId} source or stage changed before commit`);
      const parent = openDirectory(path.dirname(operation.targetPath), {
        label: `${step.stepId} parent`,
        boundaryRoot,
      });
      try {
        const current = inspectFileTarget(operation, step, boundaryRoot);
        if (
          current.state !== "prepared"
          || !sameIdentity(current.stage.stat, expected.stageIdentity)
          || (step.source.type === "file" && !sameIdentity(current.final.stat, expected.finalIdentity))
        ) fail("wakeflow-tracked-materialization-stale", `${step.stepId} changed after opening its parent`);
        if (step.source.type === "absent") linkSync(operation.stagePath, operation.targetPath);
        else renameSync(operation.stagePath, operation.targetPath);
        fsyncSync(parent.descriptor);
        const committed = inspectFileTarget(operation, step, boundaryRoot);
        const expectedState = step.source.type === "absent" ? "committed-pair" : "committed";
        if (committed.state !== expectedState) {
          fail("wakeflow-tracked-materialization-commit", `${step.stepId} did not reach its file target`);
        }
      } catch (cause) {
        if (cause instanceof WakeflowTrackedMaterializationError) throw cause;
        fail("wakeflow-tracked-materialization-commit", `${step.stepId} file commit failed`, { cause });
      } finally {
        closeSync(parent.descriptor);
      }
    },

    cleanup(args) {
      const { context } = projectCallbackArguments(args, ["context"], `${step.stepId}.cleanup arguments`);
      assertContext(workspaceRoot, context);
      validateAuthority({ context });
      const inspected = inspectFileTarget(operation, step, boundaryRoot);
      if (inspected.state === "committed") return;
      if (inspected.state !== "committed-pair") {
        fail("wakeflow-tracked-materialization-cleanup", `${step.stepId} cleanup lacks one committed pair`);
      }
      const parent = openDirectory(path.dirname(operation.targetPath), {
        label: `${step.stepId} parent`,
        boundaryRoot,
      });
      try {
        const current = inspectFileTarget(operation, step, boundaryRoot);
        if (
          current.state !== "committed-pair"
          || !sameIdentity(current.final.stat, inspected.final.stat)
          || !sameIdentity(current.stage.stat, inspected.stage.stat)
        ) fail("wakeflow-tracked-materialization-stale", `${step.stepId} pair changed before cleanup`);
        unlinkSync(operation.stagePath);
        fsyncSync(parent.descriptor);
        if (inspectFileTarget(operation, step, boundaryRoot).state !== "committed") {
          fail("wakeflow-tracked-materialization-cleanup", `${step.stepId} cleanup did not converge`);
        }
      } catch (cause) {
        if (cause instanceof WakeflowTrackedMaterializationError) throw cause;
        fail("wakeflow-tracked-materialization-cleanup", `${step.stepId} cleanup failed`, { cause });
      } finally {
        closeSync(parent.descriptor);
      }
    },
  });
}

function inspectOperation(operation, step, boundaryRoot) {
  return operation.kind === "directory"
    ? inspectDirectoryTarget(operation, step, boundaryRoot)
    : inspectFileTarget(operation, step, boundaryRoot);
}

/**
 * 为已冻结全部语义决策、读取上限和目标字节的领域 owner 构造 M3 handler seam。
 * 本入口不选择路径、不生成内容，也不解释领域 classification。
 */
export function createWakeflowTrackedMaterializationParticipant(value) {
  const input = exactKeys(value, [
    "workspaceRoot",
    "confirmedPlan",
    "validatePlan",
    "deriveCurrentPlan",
    "validateAuthority",
    "privateOperations",
    "closureName",
  ], "tracked materialization participant input");
  const workspaceRoot = assertAbsolute(input.workspaceRoot, "workspaceRoot");
  const boundaryRoot = path.dirname(workspaceRoot);
  const callbacks = Object.freeze({
    validatePlan: input.validatePlan,
    deriveCurrentPlan: input.deriveCurrentPlan,
    validateAuthority: input.validateAuthority,
  });
  for (const [name, callback] of [
    ["validatePlan", callbacks.validatePlan],
    ["deriveCurrentPlan", callbacks.deriveCurrentPlan],
    ["validateAuthority", callbacks.validateAuthority],
  ]) {
    if (typeof callback !== "function") {
      fail("wakeflow-tracked-materialization-contract", `${name} must be a function`);
    }
  }
  if (typeof input.closureName !== "string" || !/^[a-z][a-z0-9-]{0,63}$/u.test(input.closureName)) {
    fail("wakeflow-tracked-materialization-contract", "closureName must be one bounded lowercase token");
  }
  const confirmedPlan = deepFreeze(canonicalSnapshot(input.confirmedPlan, "confirmed tracked plan"));
  if (!isPlainObject(confirmedPlan.payload) || !Array.isArray(confirmedPlan.payload.steps)) {
    fail("wakeflow-tracked-materialization-plan", "confirmed plan lacks a step collection");
  }
  const stepById = new Map(confirmedPlan.payload.steps.map((step) => [step.stepId, step]));
  const privateOperations = snapshotDenseDataArray(input.privateOperations, "privateOperations");
  if (privateOperations.length !== stepById.size) {
    fail("wakeflow-tracked-materialization-operation", "private operations must exactly cover confirmed steps");
  }
  // 在首次调用任何领域 callback 前冻结 Buffer 与全部私有路径，避免codec反向改写后续authority。
  const operations = privateOperations.map((entry) => normalizeOperation(entry, stepById));
  if (new Set(operations.map((entry) => entry.stepId)).size !== stepById.size) {
    fail("wakeflow-tracked-materialization-operation", "private operations contain duplicate or missing step IDs");
  }
  const operationById = new Map(operations.map((entry) => [entry.stepId, entry]));
  for (const stepId of stepById.keys()) {
    if (!operationById.has(stepId)) {
      fail("wakeflow-tracked-materialization-operation", "private operations omit a confirmed step");
    }
  }
  const validated = callbacks.validatePlan(confirmedPlan);
  if (!sameCanonical(validated, confirmedPlan)) {
    fail("wakeflow-tracked-materialization-plan", "confirmed plan differs from its domain codec");
  }
  const validateAuthority = ({ context }) => {
    const result = exactKeys(
      callbacks.validateAuthority({ context, plan: confirmedPlan }),
      ["valid"],
      "domain authority verdict",
    );
    if (result.valid !== true) {
      fail("wakeflow-tracked-materialization-authority", "domain authority validator must return exact { valid: true }");
    }
  };
  const handlers = Object.fromEntries(confirmedPlan.payload.steps.map((step) => {
    const operation = operationById.get(step.stepId);
    return [step.stepId, operation.kind === "directory"
      ? createDirectoryHandler(workspaceRoot, boundaryRoot, operation, step, validateAuthority)
      : createFileHandler(workspaceRoot, boundaryRoot, operation, step, validateAuthority)];
  }));

  return Object.freeze({
    validatePlan(args) {
      const { plan } = projectCallbackArguments(args, ["plan"], "tracked validatePlan arguments");
      const candidate = callbacks.validatePlan(plan);
      if (!sameCanonical(candidate, confirmedPlan)) {
        fail("wakeflow-tracked-materialization-plan", "plan differs from the participant contract");
      }
      return { valid: true };
    },

    deriveCurrentPlan(args) {
      const { context } = projectCallbackArguments(args, ["context"], "tracked deriveCurrentPlan arguments");
      if (context !== null) assertContext(workspaceRoot, context);
      validateAuthority({ context });
      if (context === null) {
        const current = callbacks.deriveCurrentPlan({ context, confirmedPlan });
        if (sameCanonical(callbacks.validatePlan(current), confirmedPlan)) return confirmedPlan;
        const legalRecoveryBoundary = confirmedPlan.payload.steps.every((step) => {
          try {
            return ["initial", "prepared", "committed", "committed-pair"].includes(
              inspectOperation(operationById.get(step.stepId), step, boundaryRoot).state,
            );
          } catch {
            return false;
          }
        });
        if (!legalRecoveryBoundary) {
          fail("wakeflow-tracked-materialization-stale", "domain plan changed since confirmation");
        }
        return confirmedPlan;
      }
      if (context.recoveryGeneration === 0) {
        const current = callbacks.deriveCurrentPlan({ context, confirmedPlan });
        if (!sameCanonical(callbacks.validatePlan(current), confirmedPlan)) {
          fail("wakeflow-tracked-materialization-stale", "domain plan changed since confirmation");
        }
        return confirmedPlan;
      }
      for (const step of confirmedPlan.payload.steps) {
        const state = inspectOperation(operationById.get(step.stepId), step, boundaryRoot).state;
        if (!["initial", "prepared", "committed", "committed-pair"].includes(state)) {
          fail("wakeflow-tracked-materialization-residue", "recovery observed illegal physical residue");
        }
      }
      return confirmedPlan;
    },

    deriveTerminalClosure(args) {
      const { context, plan, planDigest } = projectCallbackArguments(
        args,
        ["context", "plan", "planDigest"],
        "tracked terminal closure arguments",
      );
      assertContext(workspaceRoot, context);
      validateAuthority({ context });
      if (!sameCanonical(plan, confirmedPlan) || planDigest !== canonicalJsonDigest(confirmedPlan)) {
        fail("wakeflow-tracked-materialization-plan", "terminal closure received a different plan");
      }
      const resources = confirmedPlan.payload.steps.map((step) => {
        const operation = operationById.get(step.stepId);
        const inspected = inspectOperation(operation, step, boundaryRoot);
        // M3 的第一次 terminal closure 先于 cleanup。absent-only 文件用 hard link
        // no-replace 发布时，此处会看到 final/stage 同 inode 的 exact committed pair；
        // cleanup 后再次派生的语义 closure 必须相同，未知 stage 仍由 inspect 拒绝。
        if (!["committed", "committed-pair"].includes(inspected.state)) {
          fail("wakeflow-tracked-materialization-terminal", `${step.stepId} is not committed`);
        }
        return {
          stepId: step.stepId,
          ref: step.final.ref,
          type: step.final.type,
          mode: step.final.mode,
          digest: step.final.digest,
        };
      });
      return {
        planDigest,
        closureDigests: [{
          name: input.closureName,
          digest: canonicalJsonDigest({
            kind: "WakeflowTrackedMaterializationClosure",
            schemaVersion: 1,
            resources,
          }),
        }],
      };
    },

    stepHandlers: Object.freeze(handlers),
  });
}
