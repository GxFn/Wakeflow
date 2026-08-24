import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  constants as fsConstants,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import path from "node:path";

import {
  parseWakeflowConfigV3,
  serializeWakeflowConfigV3,
  wakeflowConfigV3Digest,
} from "./wakeflow-config-v3.mjs";
import { loadWakeflowConfigV3Snapshot } from "./wakeflow-config-v3-snapshot.mjs";
import { assertWakeflowMutationContext } from "./wakeflow-workspace-mutation.mjs";

/**
 * 配置转换证明层。
 *
 * 普通 snapshot 只接受已经稳定落盘的单链接 v3 配置；fresh 初始化与
 * explicit migration 在同一 M3 事务内还会短暂经过“配置不存在”、
 * “已确认 legacy source”或“fresh hard-link committed pair”等合法状态。
 * 本模块只证明当前物理状态属于调用方已经冻结的 source -> desired 转换，
 * 不负责规划配置、签发 M3 context、取得锁，也不写入任何文件。
 *
 * 返回值只用于说明被接纳的转换状态：strict 的 configDigest 是当前观测到
 * 的 source/desired semantic digest；migration/pair 状态返回的是已确认目标
 * digest。consumer 不能脱离 status 把它统一解释为“当前文件字节摘要”。
 *
 * 阅读导航：create/withWakeflowMigrationConfigTransitionScope 只签发显式迁移的
 * 动态证明范围；inspectExactFile 提供配置转换所需的强物理读取；
 * assertFreshCommittedPair 识别 fresh 发布后的合法 hard-link 中间态；
 * assertWakeflowConfigV3TransitionAuthority 统一区分 strict、absent、migration source
 * 与 committed pair。四种结果只是转换证明，不是写入授权或第二配置 authority。
 */
const CONFIG_REF = "wakeflow.config.json";
const ACTIONS = new Set(["fresh-initialize", "reconfigure", "reconcile"]);
const V3_CONFIG_MAX_BYTES = 1024n * 1024n;
// Legacy classifier/inventory 的已确认输入上限是 8 MiB。这里只复核其
// source digest，不能错误套用新 v3 config 的 1 MiB 运行期上限。
const MIGRATION_SOURCE_MAX_BYTES = 8n * 1024n * 1024n;
const MIGRATION_SCOPES = new WeakSet();
const migrationScopeStorage = new AsyncLocalStorage();

// ==================== 一、转换合同与 issued-only migration scope ====================

/**
 * 配置转换证明层的稳定错误类型；不携带原始配置字节或私有路径。
 */
export class WakeflowConfigV3TransitionAuthorityError extends Error {
  constructor(code, message, { cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowConfigV3TransitionAuthorityError";
    this.code = code;
  }
}

// 用单一领域错误类型拒绝无效转换或物理状态。
function fail(code, message, { cause } = {}) {
  throw new WakeflowConfigV3TransitionAuthorityError(code, message, { cause });
}

// 识别无数组、无自定义原型的普通输入对象。
function plainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// 校验精确字段集合并拒绝 accessor，防止 authority 检查执行调用方代码。
function exactKeys(value, expected) {
  if (!plainObject(value)) fail("wakeflow-config-v3-transition-contract", "transition authority input is invalid");
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== expected.length
    || actual.some((key) => typeof key !== "string" || !expected.includes(key))
  ) fail("wakeflow-config-v3-transition-contract", "transition authority input has an invalid field set");
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-config-v3-transition-contract", "transition authority input fields must be data properties");
    }
  }
  return value;
}

// 为已稳定读取的原始字节生成来源摘要。
function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/**
 * 从显式迁移计划签发一个进程内、不可伪造的配置 source→desired scope。
 * scope 只绑定 workspace、legacy source digest 与目标语义摘要，不会自行生效或持久化。
 */
export function createWakeflowMigrationConfigTransitionScope(value = {}) {
  exactKeys(value, ["workspaceRoot", "sourceDigest", "desiredModel"]);
  if (
    typeof value.workspaceRoot !== "string"
    || !value.workspaceRoot
    || path.resolve(value.workspaceRoot) !== value.workspaceRoot
    || typeof value.sourceDigest !== "string"
    || !/^sha256:[0-9a-f]{64}$/u.test(value.sourceDigest)
  ) fail("wakeflow-config-v3-transition-contract", "migration transition scope input is invalid");
  const desiredModel = parseWakeflowConfigV3(value.desiredModel);
  const scope = Object.freeze({
    workspaceRoot: value.workspaceRoot,
    sourceDigest: value.sourceDigest,
    desiredConfigDigest: wakeflowConfigV3Digest(desiredModel),
  });
  // WeakSet 品牌阻止恢复计划或结构化克隆直接伪造 scope；它不是持久
  // workspace registry，只有下面 AsyncLocalStorage.run 的动态调用区间有效。
  MIGRATION_SCOPES.add(scope);
  return scope;
}

/**
 * 仅在 callback 的动态调用区间激活已签发 migration scope，离开后立即失效。
 */
export function withWakeflowMigrationConfigTransitionScope(scope, callback) {
  if (!MIGRATION_SCOPES.has(scope) || typeof callback !== "function") {
    fail("wakeflow-config-v3-transition-context", "migration transition scope is not an issued authority");
  }
  const current = migrationScopeStorage.getStore();
  if (current !== undefined && current !== scope) {
    fail("wakeflow-config-v3-transition-context", "another migration transition scope is already active");
  }
  return migrationScopeStorage.run(scope, callback);
}

// 在当前动态 scope 内复核 legacy source 的 exact digest；不允许普通 runtime 旁路使用。
function assertMigrationSourceScope({ workspaceRoot, desiredModel }) {
  const scope = migrationScopeStorage.getStore();
  if (
    !MIGRATION_SCOPES.has(scope)
    || scope.workspaceRoot !== workspaceRoot
    || scope.desiredConfigDigest !== wakeflowConfigV3Digest(desiredModel)
  ) return null;
  const source = inspectExactFile(
    path.join(workspaceRoot, CONFIG_REF),
    MIGRATION_SOURCE_MAX_BYTES,
  );
  if (
    source === null
    || source.stat.nlink !== 1n
    || digestBytes(source.bytes) !== scope.sourceDigest
  ) return null;
  return Object.freeze({
    status: "migration-config-source",
    configDigest: scope.desiredConfigDigest,
  });
}

// 比较两个 stat 是否指向同一 inode。
function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

// 比较一次转换读取前后的完整稳定文件元数据，包括合法阶段所需的 link count。
function sameStableFile(left, right) {
  return sameIdentity(left, right)
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
    && left.nlink === right.nlink;
}

// 取得当前 POSIX euid；不支持所有权语义的平台直接 fail closed。
function currentEuid() {
  if (typeof process.geteuid !== "function") {
    fail("wakeflow-config-v3-transition-platform", "transition authority requires POSIX ownership semantics");
  }
  return BigInt(process.geteuid());
}

// ==================== 二、配置转换的物理状态证明 ====================

// 以 no-follow、owner、0644、容量和前后 stat 一致性读取一个候选配置文件。
function inspectExactFile(candidate, maxBytes = V3_CONFIG_MAX_BYTES) {
  let before;
  try {
    before = lstatSync(candidate, { bigint: true });
  } catch (cause) {
    if (cause?.code === "ENOENT") return null;
    fail("wakeflow-config-v3-transition-source", "transition config source cannot be inspected", { cause });
  }
  if (
    before.isSymbolicLink()
    || !before.isFile()
    || before.uid !== currentEuid()
    || Number(before.mode & 0o777n) !== 0o644
    || before.size > maxBytes
  ) fail("wakeflow-config-v3-transition-source", "transition config source is unsafe");
  let descriptor;
  try {
    descriptor = openSync(candidate, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor, { bigint: true });
    if (!sameStableFile(before, opened)) {
      fail("wakeflow-config-v3-transition-race", "transition config changed while opening");
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    const refreshed = lstatSync(candidate, { bigint: true });
    if (
      !sameStableFile(opened, after)
      || !sameStableFile(after, refreshed)
      || BigInt(bytes.length) !== after.size
    ) fail("wakeflow-config-v3-transition-race", "transition config changed while reading");
    return { stat: after, bytes };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

// 在 exact M3 context 下证明 fresh final/stage 是同 inode 的完整 committed pair。
function assertFreshCommittedPair({ workspaceRoot, desiredModel, context }) {
  if (context === null || typeof context !== "object") {
    fail("wakeflow-config-v3-transition-source", "strict config authority is unavailable");
  }
  const mode = context.recoveryGeneration > 0 ? "recovery-cleanup" : "maintenance";
  try {
    assertWakeflowMutationContext({ workspaceRoot, context, mode });
  } catch (cause) {
    fail("wakeflow-config-v3-transition-context", "transition config requires the exact M3 gate", { cause });
  }
  const expectedBytes = Buffer.from(serializeWakeflowConfigV3(desiredModel), "utf8");
  const bytesDigest = createHash("sha256").update(expectedBytes).digest("hex");
  const stageName = `.${CONFIG_REF}.${bytesDigest}.stage`;
  // fresh owner 用 hard link 做 no-replace publication。M3 terminal closure
  // 发生在 cleanup 之前，因此后续 owner 会短暂看到 final/stage 同 inode、
  // nlink=2；只有精确 M3 context 和完整保留命名空间才能接纳该中间态。
  const final = inspectExactFile(path.join(workspaceRoot, CONFIG_REF));
  const stage = inspectExactFile(path.join(workspaceRoot, stageName));
  if (
    final === null
    || stage === null
    || final.stat.nlink !== 2n
    || stage.stat.nlink !== 2n
    || !sameIdentity(final.stat, stage.stat)
    || !final.bytes.equals(expectedBytes)
    || !stage.bytes.equals(expectedBytes)
  ) fail("wakeflow-config-v3-transition-source", "fresh config transition pair is not exact");
  let configResidue;
  try {
    configResidue = readdirSync(workspaceRoot).filter((name) => name.startsWith(`.${CONFIG_REF}.`));
  } catch (cause) {
    fail("wakeflow-config-v3-transition-source", "config transition namespace cannot be inspected", { cause });
  }
  if (configResidue.length !== 1 || configResidue[0] !== stageName) {
    fail("wakeflow-config-v3-transition-source", "config transition namespace contains unknown residue");
  }
  return Object.freeze({
    status: "fresh-committed-pair",
    configDigest: wakeflowConfigV3Digest(desiredModel),
  });
}

// ==================== 三、统一转换 authority 入口 ====================

/**
 * 证明当前配置物理状态属于已确认的 source→desired 转换。
 *
 * 优先接受严格 v3 source/desired 快照；fresh 才可能接受 absent、issued-only legacy
 * source 或 exact M3 committed pair。返回状态不能被当作写权限，写入仍归 config owner。
 */
export function assertWakeflowConfigV3TransitionAuthority(value) {
  const input = exactKeys(value, [
    "workspaceRoot",
    "action",
    "sourceModel",
    "desiredModel",
    "context",
  ]);
  if (
    typeof input.workspaceRoot !== "string"
    || !input.workspaceRoot
    || path.resolve(input.workspaceRoot) !== input.workspaceRoot
    || !ACTIONS.has(input.action)
  ) fail("wakeflow-config-v3-transition-contract", "transition authority identity is invalid");
  const sourceModel = input.sourceModel === null
    ? null
    : parseWakeflowConfigV3(input.sourceModel);
  const desiredModel = parseWakeflowConfigV3(input.desiredModel);
  if (
    (input.action === "fresh-initialize") !== (sourceModel === null)
    || (sourceModel !== null && sourceModel.program.programId !== desiredModel.program.programId)
  ) fail("wakeflow-config-v3-transition-contract", "transition models do not match the action");
  const allowed = new Set([wakeflowConfigV3Digest(desiredModel)]);
  if (sourceModel !== null) allowed.add(wakeflowConfigV3Digest(sourceModel));
  try {
    // 正常规划可能仍处于 source，配置 owner 提交后则处于 desired；二者
    // 都属于同一个已确认转换，但这不表示 desired 已经完成物理提交。
    const snapshot = loadWakeflowConfigV3Snapshot({ workspaceRoot: input.workspaceRoot });
    if (!allowed.has(snapshot.configDigest)) {
      fail("wakeflow-config-v3-transition-source", "strict config is outside the confirmed transition");
    }
    return Object.freeze({ status: "strict", configDigest: snapshot.configDigest });
  } catch (cause) {
    if (cause instanceof WakeflowConfigV3TransitionAuthorityError) throw cause;
    const final = path.join(input.workspaceRoot, CONFIG_REF);
    try {
      lstatSync(final);
    } catch (missingCause) {
      if (missingCause?.code === "ENOENT" && input.action === "fresh-initialize") {
        // absent 只描述 fresh 配置最终路径尚未创建；完整 fresh owner graph
        // 仍会独立验证其保留 stage 命名空间，不能据此单独取得写权限。
        return Object.freeze({ status: "absent", configDigest: null });
      }
      fail("wakeflow-config-v3-transition-source", "strict config authority is unavailable", { cause });
    }
    if (input.action !== "fresh-initialize") {
      fail("wakeflow-config-v3-transition-source", "strict config authority is unavailable", { cause });
    }
    // Legacy 配置只能由显式 migration 动态 scope 接纳；普通 fresh 若已有
    // 非 v3 final，则必须继续落入 exact committed-pair 检查并 fail closed。
    const migrationSource = assertMigrationSourceScope({
      workspaceRoot: input.workspaceRoot,
      desiredModel,
    });
    if (migrationSource !== null) return migrationSource;
    return assertFreshCommittedPair({
      workspaceRoot: input.workspaceRoot,
      desiredModel,
      context: input.context,
    });
  }
}
