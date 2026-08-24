import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  opendirSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  linkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import {
  parseWakeflowConfigV3,
  serializeWakeflowConfigV3,
  wakeflowConfigV3Digest,
} from "./wakeflow-config-v3.mjs";
import {
  validateWakeflowMigrationPlan,
} from "./wakeflow-migration-plan.mjs";
import {
  assertWakeflowMutationContext,
} from "./wakeflow-workspace-mutation.mjs";

// 配置迁移 owner 只负责一个精确 legacy wakeflow.config.json 的物理替换与
// 原来源释放。它不选择迁移 cohort、不签发 M3 写权限、不编排五阶段事务，
// 也不管理其他 v3 文件；这些职责分别属于 migration plan、M3 和 production。
export const WAKEFLOW_MIGRATION_CONFIG_OWNER_SCHEMA_ID =
  "urn:wakeflow:internal:migration-config-owner-plan:v1";
export const WAKEFLOW_MIGRATION_CONFIG_OWNER_KIND = "WakeflowMigrationConfigOwnerPlan";
export const WAKEFLOW_MIGRATION_CONFIG_OWNER_SCHEMA_VERSION = 1;

const CONFIG_REF = "wakeflow.config.json";
const FILE_MODE = 0o644;
const FILE_MODE_STRING = "0644";
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const LEGACY_CONFIG_MAX_BYTES = 8 * 1024 * 1024;
const TARGET_CONFIG_MAX_BYTES = 1024 * 1024;
const MAX_WORKSPACE_ENTRIES = 100_000;
const RESIDUE_PREFIX = ".wakeflow.config.migration.";

// ==================== 一、契约与稳定文件观察 ====================

export class WakeflowMigrationConfigOwnerError extends Error {
  constructor(code, message, { details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowMigrationConfigOwnerError";
    this.code = code;
    this.details = deepFreeze({ ...details });
  }
}

function fail(code, message, { details = {}, cause } = {}) {
  throw new WakeflowMigrationConfigOwnerError(code, message, { details, cause });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function plainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected, label) {
  if (!plainObject(value)) fail("wakeflow-migration-config-contract", `${label} must be one plain object`);
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== expected.length
    || actual.some((key) => typeof key !== "string" || !expected.includes(key))
  ) fail("wakeflow-migration-config-contract", `${label} has an invalid field set`);
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-migration-config-contract", `${label}.${key} must be an enumerable data field`);
    }
  }
  return value;
}

function sameCanonical(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function modeString(stat) {
  const mode = typeof stat.mode === "bigint"
    ? Number(stat.mode & 0o777n)
    : stat.mode & 0o777;
  return `0${mode.toString(8).padStart(3, "0")}`;
}

function currentEuid() {
  if (typeof process.geteuid !== "function") {
    fail(
      "wakeflow-migration-config-platform",
      "config migration owner requires POSIX ownership semantics",
    );
  }
  return BigInt(process.geteuid());
}

function normalizedWorkspaceRoot(value) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || !path.isAbsolute(value)
    || path.resolve(value) !== value
  ) fail("wakeflow-migration-config-root", "workspaceRoot must be one normalized absolute path");
  let stat;
  let real;
  try {
    stat = lstatSync(value);
    real = realpathSync(value);
  } catch (cause) {
    fail("wakeflow-migration-config-root", "workspace root is unavailable", { cause });
  }
  if (stat.isSymbolicLink() || !stat.isDirectory() || real !== value) {
    fail("wakeflow-migration-config-root", "workspace root must be one exact real directory");
  }
  return value;
}

// 把 bigint stat 压缩为可进入 canonical JSON 的稳定元数据；时间字段只用于
// 同一轮观察的一致性比较，不进入持久化 source identity。
function statSnapshot(stat) {
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    uid: Number(stat.uid),
    mode: modeString(stat),
    nlink: Number(stat.nlink),
    size: Number(stat.size),
    mtimeNs: String(stat.mtimeNs),
    ctimeNs: String(stat.ctimeNs),
  };
}

function statIdentity(stat) {
  const snapshot = statSnapshot(stat);
  return {
    dev: snapshot.dev,
    ino: snapshot.ino,
    uid: snapshot.uid,
    mode: snapshot.mode,
    nlink: snapshot.nlink,
    size: snapshot.size,
  };
}

function stableNodeIdentity(identity) {
  return {
    dev: identity.dev,
    ino: identity.ino,
    uid: identity.uid,
  };
}

function sameNode(left, right) {
  return left !== null
    && right !== null
    && left.dev === right.dev
    && left.ino === right.ino
    && left.uid === right.uid;
}

function sameStableStat(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.uid === right.uid
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

// 通过 O_NOFOLLOW descriptor 有界读取候选文件，并在打开、读取和路径复查后
// 比较完整稳定元数据，避免把路径替换、硬链变化或超大残留当作迁移状态。
function inspectFile(workspaceRoot, ref, maximumBytes) {
  const file = path.join(workspaceRoot, ref);
  let before;
  try {
    before = lstatSync(file, { bigint: true });
  } catch (cause) {
    if (cause?.code === "ENOENT") return null;
    fail("wakeflow-migration-config-inspection", `${ref} cannot be inspected`, { cause });
  }
  if (
    before.isSymbolicLink()
    || !before.isFile()
    || before.uid !== currentEuid()
    || modeString(before) !== FILE_MODE_STRING
    || (before.nlink !== 1n && before.nlink !== 2n)
    || before.size > BigInt(maximumBytes)
  ) fail("wakeflow-migration-config-inspection", `${ref} is not one exact owned 0644 file`);
  let descriptor;
  try {
    descriptor = openSync(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor, { bigint: true });
    if (!sameStableStat(statSnapshot(before), statSnapshot(opened))) {
      fail("wakeflow-migration-config-race", `${ref} changed while it was opened`);
    }
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) {
        fail("wakeflow-migration-config-race", `${ref} ended while it was read`);
      }
      offset += count;
    }
    const probe = Buffer.alloc(1);
    if (readSync(descriptor, probe, 0, 1, bytes.length) !== 0) {
      fail("wakeflow-migration-config-race", `${ref} grew while it was read`);
    }
    const after = fstatSync(descriptor, { bigint: true });
    const refreshed = lstatSync(file, { bigint: true });
    const openedSnapshot = statSnapshot(opened);
    if (
      !sameStableStat(openedSnapshot, statSnapshot(after))
      || !sameStableStat(statSnapshot(after), statSnapshot(refreshed))
    ) fail("wakeflow-migration-config-race", `${ref} changed while it was read`);
    return {
      ref,
      stat: openedSnapshot,
      identity: statIdentity(opened),
      digest: sha256(bytes),
    };
  } catch (cause) {
    if (cause instanceof WakeflowMigrationConfigOwnerError) throw cause;
    fail("wakeflow-migration-config-inspection", `${ref} cannot be read`, { cause });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

// 对 owner 的私有 residue 前缀做有界闭集扫描。未知同前缀文件既不删除也不
// 猜测来源，直接阻止 preview/recovery，交由人工确认。
function inspectResidueNamespace(workspaceRoot, expectedRefs) {
  let directory;
  const residue = [];
  try {
    directory = opendirSync(workspaceRoot);
    let count = 0;
    let entry;
    while ((entry = directory.readSync()) !== null) {
      count += 1;
      if (count > MAX_WORKSPACE_ENTRIES) {
        fail("wakeflow-migration-config-residue", "workspace entry budget is exceeded");
      }
      if (entry.name.startsWith(RESIDUE_PREFIX)) residue.push(entry.name);
    }
  } catch (cause) {
    if (cause instanceof WakeflowMigrationConfigOwnerError) throw cause;
    fail("wakeflow-migration-config-residue", "config migration residue namespace cannot be inspected", {
      cause,
    });
  } finally {
    if (directory !== undefined) directory.closeSync();
  }
  const expected = new Set(expectedRefs);
  residue.sort();
  if (residue.some((name) => !expected.has(name))) {
    fail("wakeflow-migration-config-residue", "config migration residue namespace contains unknown files");
  }
  return residue;
}

// ==================== 二、config-only cohort 与物理状态机 ====================

function sourceSelection(migrationPlan) {
  const sources = migrationPlan.payload.sources;
  if (sources.length !== 1) {
    fail("wakeflow-migration-config-cohort", "migration config owner requires exactly one legacy source");
  }
  const [source] = sources;
  const [unit] = source.units;
  if (
    source.path !== CONFIG_REF
    || source.parentSourceId !== null
    || source.source?.type !== "file"
    || source.source.mode !== FILE_MODE_STRING
    || !DIGEST_RE.test(source.source.digest)
    || source.units.length !== 1
    || unit?.action !== "transform"
    || unit.route !== "schema-map"
    || unit.scope !== "whole-source"
    || unit.selector !== null
    || unit.sourceDigest !== source.source.digest
    || unit.target?.kind !== "managed-file"
    || unit.target.ref !== CONFIG_REF
    || unit.target.type !== "file"
    || unit.target.mode !== FILE_MODE_STRING
  ) fail("wakeflow-migration-config-cohort", "legacy source is not the exact config-only schema-map cohort");
  return { source, unit };
}

function residueRefs(sourceDigest, targetDigest) {
  const source = sourceDigest.slice("sha256:".length, "sha256:".length + 16);
  const target = targetDigest.slice("sha256:".length, "sha256:".length + 16);
  return {
    stageRef: `.wakeflow.config.migration.${source}.${target}.stage`,
    predecessorRef: `.wakeflow.config.migration.${source}.predecessor`,
    releaseRef: `.wakeflow.config.migration.${source}.release`,
  };
}

function absent(ref) {
  return { ref, type: "absent" };
}

function fileSnapshot(ref, digest) {
  return { ref, type: "file", mode: FILE_MODE_STRING, digest };
}

function inspectStateOnce(workspaceRoot, payload) {
  const residue = inspectResidueNamespace(workspaceRoot, [
    payload.stageRef,
    payload.predecessorRef,
    payload.releaseRef,
  ]);
  const config = inspectFile(workspaceRoot, CONFIG_REF, LEGACY_CONFIG_MAX_BYTES);
  const stage = inspectFile(workspaceRoot, payload.stageRef, TARGET_CONFIG_MAX_BYTES);
  const predecessor = inspectFile(
    workspaceRoot,
    payload.predecessorRef,
    LEGACY_CONFIG_MAX_BYTES,
  );
  const release = inspectFile(workspaceRoot, payload.releaseRef, LEGACY_CONFIG_MAX_BYTES);
  const sourceDigest = payload.source.digest;
  const targetDigest = payload.target.digest;
  const sourceConfig = config?.digest === sourceDigest;
  const targetConfig = config?.digest === targetDigest;
  const targetStage = stage?.digest === targetDigest;
  const sourcePredecessor = predecessor?.digest === sourceDigest;
  const sourceRelease = release?.digest === sourceDigest;
  let state = "unsafe";
  if (sourceConfig && stage === null && predecessor === null && release === null && config.stat.nlink === 1) {
    state = "source";
  } else if (sourceConfig && targetStage && predecessor === null && release === null && config.stat.nlink === 1) {
    state = "prepared";
  } else if (
    sourceConfig
    && targetStage
    && sourcePredecessor
    && release === null
    && sameNode(config.stat, predecessor.stat)
    && config.stat.nlink === 2
    && predecessor.stat.nlink === 2
  ) {
    state = "linked-prepared";
  } else if (
    targetConfig
    && stage === null
    && sourcePredecessor
    && release === null
    && config.stat.nlink === 1
    && predecessor.stat.nlink === 1
  ) {
    state = "committed";
  } else if (
    targetConfig
    && stage === null
    && predecessor === null
    && sourceRelease
    && config.stat.nlink === 1
    && release.stat.nlink === 1
  ) {
    state = "release-staged";
  } else if (
    targetConfig
    && stage === null
    && predecessor === null
    && release === null
    && config.stat.nlink === 1
  ) {
    state = "current";
  }
  return { state, residue, config, stage, predecessor, release };
}

function observationFingerprint(observed) {
  const node = (value) => value === null
    ? null
    : { ref: value.ref, stat: value.stat, digest: value.digest };
  return {
    state: observed.state,
    residue: observed.residue,
    config: node(observed.config),
    stage: node(observed.stage),
    predecessor: node(observed.predecessor),
    release: node(observed.release),
  };
}

// 两次完整观察必须给出同一闭集快照，防止四个路径分别稳定、组合却跨越了
// 一次外部状态变化。POSIX rename 前仍不存在通用 CAS，最终写后还会再次复查。
function inspectState(workspaceRoot, payload) {
  const first = inspectStateOnce(workspaceRoot, payload);
  const second = inspectStateOnce(workspaceRoot, payload);
  if (!sameCanonical(observationFingerprint(first), observationFingerprint(second))) {
    fail("wakeflow-migration-config-race", "config migration state changed while it was inspected");
  }
  return second;
}

function assertOriginalIdentity(observed, payload) {
  const node = observed.state === "source" || observed.state === "prepared" || observed.state === "linked-prepared"
    ? observed.config
    : observed.predecessor ?? observed.release;
  if (
    node !== null
    && canonicalJsonDigest(stableNodeIdentity(node.identity)) !== payload.sourceFileIdentityDigest
  ) {
    fail("wakeflow-migration-config-stale", "legacy config file identity differs from the confirmed source");
  }
}

function migrationProjection(migrationPlan) {
  const { source, unit } = sourceSelection(migrationPlan);
  const desiredModel = parseWakeflowConfigV3(migrationPlan.payload.target.desiredModel);
  const targetBytes = Buffer.from(serializeWakeflowConfigV3(desiredModel), "utf8");
  const targetDigest = sha256(targetBytes);
  if (
    targetDigest !== migrationPlan.payload.target.desiredConfigBytesDigest
    || targetDigest !== unit.target.digest
    || wakeflowConfigV3Digest(desiredModel) !== migrationPlan.payload.target.desiredModelDigest
  ) fail("wakeflow-migration-config-target", "migration target differs from canonical v3 config bytes");
  const refs = residueRefs(source.source.digest, targetDigest);
  return { source, unit, desiredModel, targetBytes, targetDigest, refs };
}

function buildPlan(workspaceRoot, migrationPlan) {
  const {
    source,
    unit,
    desiredModel,
    targetDigest,
    refs,
  } = migrationProjection(migrationPlan);
  const provisional = {
    source: fileSnapshot(CONFIG_REF, source.source.digest),
    target: fileSnapshot(CONFIG_REF, targetDigest),
    ...refs,
  };
  const observed = inspectState(workspaceRoot, provisional);
  if (observed.state !== "source") {
    fail("wakeflow-migration-config-source", "config migration preview requires one exact legacy source");
  }
  const sourceFileIdentityDigest = canonicalJsonDigest(stableNodeIdentity(observed.config.identity));
  const replaceStep = {
    stepId: "migration-config-v3-replace",
    ordinal: 0,
    stepKind: "create-or-update",
    source: provisional.source,
    staging: fileSnapshot(refs.stageRef, targetDigest),
    final: provisional.target,
  };
  const releaseStep = {
    stepId: "migration-config-v3-source-release",
    ordinal: 0,
    stepKind: "remove",
    source: fileSnapshot(refs.predecessorRef, source.source.digest),
    staging: fileSnapshot(refs.releaseRef, source.source.digest),
    final: absent(refs.predecessorRef),
  };
  return {
    schemaId: WAKEFLOW_MIGRATION_CONFIG_OWNER_SCHEMA_ID,
    payload: {
      kind: WAKEFLOW_MIGRATION_CONFIG_OWNER_KIND,
      schemaVersion: WAKEFLOW_MIGRATION_CONFIG_OWNER_SCHEMA_VERSION,
      action: "explicit-migration",
      status: "ready",
      blockers: [],
      programId: desiredModel.program.programId,
      migrationPlanDigest: migrationPlan.planDigest,
      inventoryDigest: migrationPlan.payload.inventory.inventoryDigest,
      sourceId: source.sourceId,
      unitId: unit.unitId,
      sourceClassification: "legacy-config-exact",
      source: provisional.source,
      sourceAuthorityDigest: source.classification.canonicalClassifierDigest,
      sourceFileIdentityDigest,
      desiredModel,
      desiredModelDigest: migrationPlan.payload.target.desiredModelDigest,
      target: provisional.target,
      stageRef: refs.stageRef,
      predecessorRef: refs.predecessorRef,
      releaseRef: refs.releaseRef,
      steps: [replaceStep],
      releaseStep,
    },
  };
}

// ==================== 三、可持久化计划与上游 authority 绑定 ====================

function validatePlan(value) {
  let plan;
  try {
    plan = JSON.parse(canonicalJson(value));
  } catch (cause) {
    fail("wakeflow-migration-config-plan", "config owner plan must be canonical JSON", { cause });
  }
  exactKeys(plan, ["schemaId", "payload"], "config owner plan");
  if (plan.schemaId !== WAKEFLOW_MIGRATION_CONFIG_OWNER_SCHEMA_ID) {
    fail("wakeflow-migration-config-plan", "config owner plan schema identity is invalid");
  }
  exactKeys(plan.payload, [
    "kind", "schemaVersion", "action", "status", "blockers", "programId", "migrationPlanDigest",
    "inventoryDigest", "sourceId", "unitId", "sourceClassification", "source", "sourceAuthorityDigest",
    "sourceFileIdentityDigest", "desiredModel", "desiredModelDigest", "target", "stageRef",
    "predecessorRef", "releaseRef", "steps", "releaseStep",
  ], "config owner plan payload");
  const payload = plan.payload;
  if (
    payload.kind !== WAKEFLOW_MIGRATION_CONFIG_OWNER_KIND
    || payload.schemaVersion !== WAKEFLOW_MIGRATION_CONFIG_OWNER_SCHEMA_VERSION
    || payload.action !== "explicit-migration"
    || payload.status !== "ready"
    || !Array.isArray(payload.blockers)
    || payload.blockers.length !== 0
    || !DIGEST_RE.test(payload.migrationPlanDigest)
    || !DIGEST_RE.test(payload.inventoryDigest)
    || !DIGEST_RE.test(payload.sourceId)
    || !DIGEST_RE.test(payload.unitId)
    || !DIGEST_RE.test(payload.sourceAuthorityDigest)
    || !DIGEST_RE.test(payload.sourceFileIdentityDigest)
    || payload.sourceClassification !== "legacy-config-exact"
  ) fail("wakeflow-migration-config-plan", "config owner plan identity is invalid");
  const model = parseWakeflowConfigV3(payload.desiredModel);
  const targetDigest = sha256(Buffer.from(serializeWakeflowConfigV3(model), "utf8"));
  const refs = residueRefs(payload.source.digest, targetDigest);
  if (
    model.program.programId !== payload.programId
    || wakeflowConfigV3Digest(model) !== payload.desiredModelDigest
    || !DIGEST_RE.test(payload.source.digest)
    || !DIGEST_RE.test(payload.target.digest)
    || payload.source.ref !== CONFIG_REF
    || payload.source.type !== "file"
    || payload.source.mode !== FILE_MODE_STRING
    || payload.target.ref !== CONFIG_REF
    || payload.target.type !== "file"
    || payload.target.mode !== FILE_MODE_STRING
    || payload.target.digest !== targetDigest
    || payload.stageRef !== refs.stageRef
    || payload.predecessorRef !== refs.predecessorRef
    || payload.releaseRef !== refs.releaseRef
  ) fail("wakeflow-migration-config-plan", "config owner source or target contract is invalid");
  const expectedReplace = {
    stepId: "migration-config-v3-replace",
    ordinal: 0,
    stepKind: "create-or-update",
    source: payload.source,
    staging: fileSnapshot(payload.stageRef, payload.target.digest),
    final: payload.target,
  };
  const expectedRelease = {
    stepId: "migration-config-v3-source-release",
    ordinal: 0,
    stepKind: "remove",
    source: fileSnapshot(payload.predecessorRef, payload.source.digest),
    staging: fileSnapshot(payload.releaseRef, payload.source.digest),
    final: absent(payload.predecessorRef),
  };
  if (
    !Array.isArray(payload.steps)
    || payload.steps.length !== 1
    || !sameCanonical(payload.steps[0], expectedReplace)
    || !sameCanonical(payload.releaseStep, expectedRelease)
  ) fail("wakeflow-migration-config-plan", "config owner physical steps are invalid");
  return deepFreeze(plan);
}

/**
 * 从一份 ready、config-only 的上游迁移计划生成零写、可重复的 owner 计划。
 * 规划时只接受 legacy source 的初始物理态，不接纳任何未完成迁移残留。
 */
export function planWakeflowMigrationConfigOwner(value = {}) {
  exactKeys(value, ["workspaceRoot", "migrationPlan"], "config owner planning input");
  const workspaceRoot = normalizedWorkspaceRoot(value.workspaceRoot);
  const migrationPlan = validateWakeflowMigrationPlan(value.migrationPlan);
  if (migrationPlan.payload.status !== "ready") {
    fail("wakeflow-migration-config-blocked", "blocked migration plans cannot produce a config owner plan");
  }
  return validatePlan(buildPlan(workspaceRoot, migrationPlan));
}

/** 校验独立持久化 config owner 计划的完整字段、摘要与两条物理步骤。 */
export function validateWakeflowMigrationConfigOwnerPlan(value) {
  return validatePlan(value);
}

/**
 * 在不重新读取已被迁移的 legacy 文件时，将恢复种子中的 config owner plan
 * 重新绑定到同一份 migration plan。sourceFileIdentityDigest 是物理快照，仍由
 * owner 状态机复核；其余 cohort、分类 authority 与目标语义必须由上游重算。
 */
export function assertWakeflowMigrationConfigOwnerPlanAgainstMigrationPlan(value = {}) {
  exactKeys(value, ["migrationPlan", "plan"], "config owner authority input");
  const migrationPlan = validateWakeflowMigrationPlan(value.migrationPlan);
  if (migrationPlan.payload.status !== "ready") {
    fail("wakeflow-migration-config-blocked", "blocked migration plans cannot confirm a config owner plan");
  }
  const confirmed = validatePlan(value.plan);
  const {
    source,
    unit,
    desiredModel,
    targetDigest,
  } = migrationProjection(migrationPlan);
  const expected = {
    programId: desiredModel.program.programId,
    migrationPlanDigest: migrationPlan.planDigest,
    inventoryDigest: migrationPlan.payload.inventory.inventoryDigest,
    sourceId: source.sourceId,
    unitId: unit.unitId,
    sourceClassification: "legacy-config-exact",
    source: fileSnapshot(CONFIG_REF, source.source.digest),
    sourceAuthorityDigest: source.classification.canonicalClassifierDigest,
    desiredModel,
    desiredModelDigest: migrationPlan.payload.target.desiredModelDigest,
    target: fileSnapshot(CONFIG_REF, targetDigest),
  };
  const actual = Object.fromEntries(
    Object.keys(expected).map((key) => [key, confirmed.payload[key]]),
  );
  if (!sameCanonical(actual, expected)) {
    fail(
      "wakeflow-migration-config-binding",
      "config owner plan belongs to another migration authority",
    );
  }
  return confirmed;
}

// ==================== 四、M3 participant 与 crash-safe 物理步骤 ====================

function assertContext(workspaceRoot, context, admission) {
  try {
    assertWakeflowMutationContext({
      workspaceRoot,
      context,
      mode: admission === "apply" ? "maintenance" : "recovery-cleanup",
    });
  } catch (cause) {
    fail("wakeflow-migration-config-admission", "config owner lacks the exact mutation context", { cause });
  }
}

function syncRoot(workspaceRoot) {
  let descriptor;
  try {
    descriptor = openSync(
      workspaceRoot,
      fsConstants.O_RDONLY
        | (fsConstants.O_DIRECTORY ?? 0)
        | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const stat = fstatSync(descriptor, { bigint: true });
    if (!stat.isDirectory() || stat.uid !== currentEuid()) {
      fail("wakeflow-migration-config-sync", "workspace root descriptor is not exact");
    }
    fsyncSync(descriptor);
  } catch (cause) {
    if (cause instanceof WakeflowMigrationConfigOwnerError) throw cause;
    fail("wakeflow-migration-config-sync", "workspace root cannot be synchronized", { cause });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function replaceObservation(observed, step) {
  if (observed.state === "source") {
    return { source: step.source, staging: absent(step.staging.ref), final: step.source };
  }
  if (observed.state === "prepared" || observed.state === "linked-prepared") {
    return { source: step.source, staging: step.staging, final: step.source };
  }
  if (["committed", "release-staged", "current"].includes(observed.state)) {
    return { source: step.final, staging: absent(step.staging.ref), final: step.final };
  }
  fail("wakeflow-migration-config-residue", "config replace state cannot be represented safely");
}

function releaseObservation(observed, step) {
  if (observed.state === "committed") {
    return { source: step.source, staging: absent(step.staging.ref), final: step.source };
  }
  if (observed.state === "release-staged") {
    return { source: absent(step.source.ref), staging: step.staging, final: step.final };
  }
  if (observed.state === "current") {
    return { source: step.final, staging: absent(step.staging.ref), final: step.final };
  }
  fail("wakeflow-migration-config-residue", "config release state cannot be represented safely");
}

function inspectConfirmed(workspaceRoot, plan) {
  const observed = inspectState(workspaceRoot, plan.payload);
  if (observed.state === "unsafe") {
    fail("wakeflow-migration-config-residue", "config migration residue is unsafe");
  }
  assertOriginalIdentity(observed, plan.payload);
  return observed;
}

/**
 * 把已确认计划适配为 M3 participant。
 *
 * replace 在同一 owner 内依次完成 target stage、legacy predecessor hard link 与
 * canonical rename；release 是 production 最后一阶段的独立 remove step。恢复
 * 只允许沿这组已持久状态前向完成，不重新规划或猜测残留归属。
 */
export function createWakeflowMigrationConfigOwnerParticipant(value = {}) {
  exactKeys(value, ["workspaceRoot", "confirmedPlan", "admission"], "config owner participant input");
  const workspaceRoot = normalizedWorkspaceRoot(value.workspaceRoot);
  const confirmed = validatePlan(value.confirmedPlan);
  const admission = value.admission;
  if (!new Set(["apply", "recovery"]).has(admission)) {
    fail("wakeflow-migration-config-admission", "admission must be apply or recovery");
  }
  const targetBytes = Buffer.from(serializeWakeflowConfigV3(confirmed.payload.desiredModel), "utf8");
  const [replaceStep] = confirmed.payload.steps;
  const releaseStep = confirmed.payload.releaseStep;
  const replaceHandler = Object.freeze({
    // 创建0600独占stage，写完后收敛为0644并fsync；此时不触碰legacy source。
    prepare({ context }) {
      assertContext(workspaceRoot, context, admission);
      const observed = inspectConfirmed(workspaceRoot, confirmed);
      if (observed.state !== "source") {
        fail("wakeflow-migration-config-stale", "config replace prepare requires the exact legacy source");
      }
      let descriptor;
      try {
        descriptor = openSync(
          path.join(workspaceRoot, confirmed.payload.stageRef),
          fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0),
          0o600,
        );
        writeFileSync(descriptor, targetBytes);
        fchmodSync(descriptor, FILE_MODE);
        fsyncSync(descriptor);
        const staged = fstatSync(descriptor);
        if (
          !staged.isFile()
          || modeString(staged) !== FILE_MODE_STRING
          || staged.nlink !== 1
          || staged.size !== targetBytes.length
        ) fail("wakeflow-migration-config-prepare", "config migration stage is not exact");
      } catch (cause) {
        if (cause instanceof WakeflowMigrationConfigOwnerError) throw cause;
        fail("wakeflow-migration-config-prepare", "config migration stage cannot be published", { cause });
      } finally {
        if (descriptor !== undefined) closeSync(descriptor);
      }
      syncRoot(workspaceRoot);
    },
    // 向M3报告replace step在当前物理状态下的source/staging/final三元组。
    observe({ context }) {
      assertContext(workspaceRoot, context, admission);
      return replaceObservation(inspectConfirmed(workspaceRoot, confirmed), replaceStep);
    },
    // 先以hard link固定legacy predecessor，再以same-parent rename发布v3配置。
    commit({ context }) {
      assertContext(workspaceRoot, context, admission);
      let observed = inspectConfirmed(workspaceRoot, confirmed);
      if (observed.state === "prepared") {
        try {
          linkSync(
            path.join(workspaceRoot, CONFIG_REF),
            path.join(workspaceRoot, confirmed.payload.predecessorRef),
          );
          syncRoot(workspaceRoot);
        } catch (cause) {
          fail("wakeflow-migration-config-commit", "legacy config predecessor cannot be fixed", { cause });
        }
        observed = inspectConfirmed(workspaceRoot, confirmed);
      }
      if (observed.state !== "linked-prepared") {
        fail("wakeflow-migration-config-stale", "config replace commit lacks the exact prepared predecessor");
      }
      try {
        renameSync(
          path.join(workspaceRoot, confirmed.payload.stageRef),
          path.join(workspaceRoot, CONFIG_REF),
        );
        syncRoot(workspaceRoot);
      } catch (cause) {
        fail("wakeflow-migration-config-commit", "canonical v3 config cannot replace the legacy source", { cause });
      }
      if (inspectConfirmed(workspaceRoot, confirmed).state !== "committed") {
        fail("wakeflow-migration-config-commit", "config replacement did not reach its exact committed state");
      }
    },
  });
  const releaseHandler = Object.freeze({
    // source release只能发生在v3配置已提交且predecessor仍精确存在时。
    prepare({ context }) {
      assertContext(workspaceRoot, context, admission);
      if (inspectConfirmed(workspaceRoot, confirmed).state !== "committed") {
        fail("wakeflow-migration-config-release", "legacy source release requires committed v3 authority");
      }
    },
    // 向M3报告独立remove step的可恢复物理状态。
    observe({ context }) {
      assertContext(workspaceRoot, context, admission);
      return releaseObservation(inspectConfirmed(workspaceRoot, confirmed), releaseStep);
    },
    // rename predecessor为确定性release tombstone，使“已脱离authority”先持久化。
    commit({ context }) {
      assertContext(workspaceRoot, context, admission);
      if (inspectConfirmed(workspaceRoot, confirmed).state !== "committed") {
        fail("wakeflow-migration-config-release", "legacy source changed before exact release");
      }
      try {
        renameSync(
          path.join(workspaceRoot, confirmed.payload.predecessorRef),
          path.join(workspaceRoot, confirmed.payload.releaseRef),
        );
        syncRoot(workspaceRoot);
      } catch (cause) {
        fail("wakeflow-migration-config-release", "legacy config source cannot be detached", { cause });
      }
      if (inspectConfirmed(workspaceRoot, confirmed).state !== "release-staged") {
        fail("wakeflow-migration-config-release", "legacy config source release did not settle");
      }
    },
    // M3完成terminal closure后删除release tombstone，收敛到无残留current态。
    cleanup({ context }) {
      assertContext(workspaceRoot, context, admission);
      const observed = inspectConfirmed(workspaceRoot, confirmed);
      if (observed.state === "current") return;
      if (observed.state !== "release-staged") {
        fail("wakeflow-migration-config-release", "legacy source cleanup lacks the exact detached stage");
      }
      try {
        unlinkSync(path.join(workspaceRoot, confirmed.payload.releaseRef));
        syncRoot(workspaceRoot);
      } catch (cause) {
        fail("wakeflow-migration-config-release", "legacy source release stage cannot be cleaned", { cause });
      }
      if (inspectConfirmed(workspaceRoot, confirmed).state !== "current") {
        fail("wakeflow-migration-config-release", "config migration cleanup is not terminal");
      }
    },
  });
  return Object.freeze({
    // 防止M3在执行期替换已确认的owner plan。
    validatePlan({ plan }) {
      const candidate = validatePlan(plan);
      if (!sameCanonical(candidate, confirmed)) {
        fail("wakeflow-migration-config-plan", "config owner received another confirmed plan");
      }
      return { valid: true };
    },
    // apply只准从source起步；recovery可接纳同一状态机的全部已知前向状态。
    deriveCurrentPlan({ context }) {
      if (context !== null) assertContext(workspaceRoot, context, admission);
      const observed = inspectConfirmed(workspaceRoot, confirmed);
      const allowed = admission === "apply"
        ? new Set(["source"])
        : new Set(["source", "prepared", "linked-prepared", "committed", "release-staged", "current"]);
      if (!allowed.has(observed.state)) {
        fail("wakeflow-migration-config-stale", "config owner state differs from its admission");
      }
      return confirmed;
    },
    // terminal只证明v3 config已成为authority且legacy source已脱离，不证明激活。
    deriveTerminalClosure({ context, plan, planDigest }) {
      assertContext(workspaceRoot, context, admission);
      if (!sameCanonical(validatePlan(plan), confirmed) || planDigest !== canonicalJsonDigest(confirmed)) {
        fail("wakeflow-migration-config-plan", "config closure received another plan");
      }
      const observed = inspectConfirmed(workspaceRoot, confirmed);
      if (!new Set(["release-staged", "current"]).has(observed.state)) {
        fail("wakeflow-migration-config-closure", "legacy source is not detached after v3 config commit");
      }
      return {
        planDigest,
        closureDigests: [{
          name: "migration-config-authority",
          digest: canonicalJsonDigest({
            programId: confirmed.payload.programId,
            desiredModelDigest: confirmed.payload.desiredModelDigest,
            configDigest: confirmed.payload.target.digest,
            legacySourceDigest: confirmed.payload.source.digest,
            legacySourceDisposition: "detached",
          }),
        }],
      };
    },
    stepHandlers: Object.freeze({ [replaceStep.stepId]: replaceHandler }),
    release: Object.freeze({ step: releaseStep, handler: releaseHandler }),
  });
}
