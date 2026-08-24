import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import {
  parseWakeflowConfigV3,
  serializeWakeflowConfigV3,
  wakeflowConfigV3Digest,
} from "./wakeflow-config-v3.mjs";
import { assertWakeflowMutationContext } from "./wakeflow-workspace-mutation.mjs";

// 本模块只拥有 workspace 根部 wakeflow.config.json 的物理生命周期：
// fresh 创建、reconfigure 替换，以及两个协议在 M3 journal 下的前向恢复。
// 配置字段语义归 config-v3，根目录 placement 归 layout owner，跨 owner
// 的执行顺序归 maintenance composition；这里不形成第二份配置或布局权威。
//
// 阅读导航：targetMetadata 与两套 inspect*SourceInternal 绑定目标字节和物理来源；
// plan/validate 方法生成并复核 fresh 或 reconfigure 的确定性 owner plan；
// createStepHandler 使用 no-replace hard link 完成 fresh 发布；
// createReconfigureStepHandler 以 predecessor hard link + rename 完成可恢复替换；
// 两个 mutation participant 只在精确 M3 context 下暴露 prepare/observe/commit/cleanup，
// 不自行取得 workspace mutation gate，也不决定其他 owner 的执行顺序。
export const WAKEFLOW_CONFIG_V3_OWNER_PLAN_SCHEMA_ID = "urn:wakeflow:internal:config-v3-owner-plan:v1";
export const WAKEFLOW_CONFIG_V3_OWNER_PLAN_KIND = "WakeflowConfigV3OwnerPlan";
export const WAKEFLOW_CONFIG_V3_OWNER_PLAN_SCHEMA_VERSION = 1;

const CONFIG_REF = "wakeflow.config.json";
const CONFIG_OWNER_NAMESPACE_PREFIX = `.${CONFIG_REF}.`;
const CONFIG_MODE = 0o644;
const CONFIG_MODE_STRING = "0644";
// Owner output must remain readable by the runtime snapshot and observability under the same 1 MiB contract.
const MAX_CONFIG_BYTES = 1024 * 1024;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const TOKEN_PATTERN = /^[a-z][a-z0-9-]{0,127}$/u;
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });
const READY_CLASSIFICATION = "absent";
const RECOVERY_CLASSIFICATIONS = new Set([
  "prepared-residue",
  "committed-pair-residue",
]);
const SOURCE_CLASSIFICATIONS = new Set([
  READY_CLASSIFICATION,
  ...RECOVERY_CLASSIFICATIONS,
  "existing-config",
  "unsafe-residue",
]);
const PLAN_PAYLOAD_KEYS = Object.freeze([
  "action",
  "blockers",
  "configBytesDigest",
  "desiredModel",
  "kind",
  "modelDigest",
  "programId",
  "schemaVersion",
  "sourceClassification",
  "sourceInspectionDigest",
  "stageRef",
  "status",
  "steps",
]);

// ==================== 一、Owner 合同、摘要与文件身份原语 ====================

/**
 * Config owner 的稳定错误类型；path/details 不承载原始配置内容。
 */
export class WakeflowConfigV3OwnerError extends Error {
  constructor(code, message, { errorPath = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowConfigV3OwnerError";
    this.code = code;
    this.path = errorPath;
    this.details = Object.freeze({ ...details });
  }
}

// 用统一领域错误中止 source inspection、plan validation 或 mutation step。
function fail(code, message, { errorPath = "$", details = {}, cause } = {}) {
  throw new WakeflowConfigV3OwnerError(code, message, { errorPath, details, cause });
}

// Owner 公共输入只接受标准原型的普通对象。
function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

// 对运行输入执行精确 own-key 与 enumerable data property 校验，拒绝 getter/symbol。
function exactInput(value, expected, label) {
  if (!isPlainObject(value)) fail("wakeflow-config-v3-owner-input", `${label} must be a plain object`);
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== expected.length
    || actual.some((key) => typeof key !== "string" || !expected.includes(key))
  ) {
    fail("wakeflow-config-v3-owner-input", `${label} has an invalid field set`, {
      details: { expected, actual: actual.map(String) },
    });
  }
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-config-v3-owner-input", `${label}.${key} must be an enumerable data property`);
    }
  }
  return value;
}

// 对已 canonicalize 的 plan 数据检查精确字符串 key 集合。
function exactKeys(value, expected, label) {
  if (!isPlainObject(value)) fail("wakeflow-config-v3-owner-plan", `${label} must be a plain object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(wanted)) {
    fail("wakeflow-config-v3-owner-plan", `${label} has an invalid field set`, {
      details: { expected: wanted, actual },
    });
  }
  return value;
}

// 冻结 inspection、plan 与 closure，防止 caller 修改已确认 owner 合同。
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

// 将任意 plan 输入复制为 canonical JSON 数据，排除非数据值和原型行为。
function canonicalSnapshot(value, label) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (cause) {
    fail("wakeflow-config-v3-owner-canonical", `${label} must be canonical JSON data`, { cause });
  }
}

// 用 canonical JSON 比较两个计划/模型的语义内容，而非对象身份。
function sameCanonical(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

// 计算 owner 管理字节的 sha256 摘要。
function digestBytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// 将 stat 权限位格式化为 config owner 的固定字符串合同。
function modeString(stat) {
  return `0${(stat.mode & 0o777).toString(8).padStart(3, "0")}`;
}

// 返回当前 POSIX euid；不支持时由 workspace admission 统一拒绝。
function currentEuid() {
  return typeof process.geteuid === "function" ? process.geteuid() : null;
}

// 比较两个 stat 是否仍指向同一物理 inode。
function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

// ==================== 二、Fresh Source Inspection 与目标字节 ====================

// 从 strict model 一次派生 canonical pretty bytes、双摘要和内容寻址 stage 名称。
function targetMetadata(model) {
  // 计划、stage 名称和最终文件都从同一份 strict pretty bytes 派生，
  // caller 不能分别提交模型摘要、字节摘要或临时文件名。
  const desiredModel = parseWakeflowConfigV3(model);
  const bytes = Buffer.from(serializeWakeflowConfigV3(desiredModel), "utf8");
  if (bytes.length > MAX_CONFIG_BYTES) {
    fail("wakeflow-config-v3-owner-size", "strict v3 config exceeds the bounded owner size");
  }
  const configBytesDigest = digestBytes(bytes);
  return {
    desiredModel,
    bytes,
    modelDigest: wakeflowConfigV3Digest(desiredModel),
    configBytesDigest,
    stageRef: `.${CONFIG_REF}.${configBytesDigest.slice("sha256:".length)}.stage`,
  };
}

// 验证 workspace root 是 current-euid 拥有的真实 POSIX 目录，并捕获其身份。
function workspaceRootState(workspaceRoot) {
  if (typeof workspaceRoot !== "string" || !workspaceRoot.trim()) {
    fail("wakeflow-config-v3-owner-workspace", "workspaceRoot is required");
  }
  if (process.platform === "win32" || currentEuid() === null) {
    fail("wakeflow-config-v3-owner-platform", "config owner requires POSIX no-follow ownership semantics");
  }
  const root = path.resolve(workspaceRoot);
  let stat;
  try {
    stat = lstatSync(root);
  } catch (cause) {
    fail("wakeflow-config-v3-owner-workspace", "workspace root cannot be inspected", { cause });
  }
  if (stat.isSymbolicLink() || !stat.isDirectory() || stat.uid !== currentEuid()) {
    fail("wakeflow-config-v3-owner-workspace", "workspace root must be one current-euid real directory");
  }
  try {
    realpathSync(root);
  } catch (cause) {
    fail("wakeflow-config-v3-owner-workspace", "workspace root cannot be resolved", { cause });
  }
  return { root, stat };
}

// 将 stat 节点形状收敛为 inspection 可公开的类型词汇。
function nodeType(stat) {
  if (stat.isSymbolicLink()) return "symlink";
  if (stat.isFile()) return "file";
  if (stat.isDirectory()) return "directory";
  return "other";
}

// 将内部文件观察脱敏为类型、权限、owner、link count 与内容摘要。
function publicNode(source) {
  if (source === null) return { type: "absent" };
  const result = {
    type: nodeType(source.stat),
    mode: modeString(source.stat),
    owner: source.stat.uid === currentEuid(),
    linkCount: source.stat.nlink,
  };
  if (source.bytes !== null) result.digest = digestBytes(source.bytes);
  return result;
}

// 以 no-follow 方式读取一个 owner 文件，并在读取前后复核 path/descriptor 身份。
function inspectNode(rootState, ref) {
  const absolute = path.join(rootState.root, ref);
  let pathStat;
  try {
    pathStat = lstatSync(absolute);
  } catch (cause) {
    if (cause?.code === "ENOENT") return null;
    fail("wakeflow-config-v3-owner-source", `cannot inspect ${ref}`, { cause });
  }
  if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
    return { absolute, stat: pathStat, bytes: null };
  }
  let descriptor;
  try {
    descriptor = openSync(
      absolute,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const before = fstatSync(descriptor);
    if (!before.isFile() || !sameIdentity(before, pathStat)) {
      fail("wakeflow-config-v3-owner-race", `${ref} path and descriptor identity differ`);
    }
    if (before.size > MAX_CONFIG_BYTES) {
      return { absolute, stat: before, bytes: null };
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const refreshed = lstatSync(absolute);
    if (
      !sameIdentity(before, after)
      || !sameIdentity(after, refreshed)
      || before.size !== after.size
      || bytes.length !== after.size
    ) {
      fail("wakeflow-config-v3-owner-race", `${ref} changed during inspection`);
    }
    return { absolute, stat: after, bytes };
  } catch (cause) {
    if (cause instanceof WakeflowConfigV3OwnerError) throw cause;
    fail("wakeflow-config-v3-owner-source", `cannot read ${ref} without following links`, { cause });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

// 只枚举 workspace 根部属于 config owner 的保留名称，不读取或公开未知名称内容。
function inspectConfigOwnerNamespace(rootState) {
  let entries;
  try {
    // 只盘点 owner 保留的根目录一级命名空间。未知名称本身就是冲突，
    // 无需读取其内容，也不能把可能包含私有文本的名称返回给 caller。
    entries = readdirSync(rootState.root)
      .filter((name) => name.startsWith(CONFIG_OWNER_NAMESPACE_PREFIX))
      .sort();
  } catch (cause) {
    fail("wakeflow-config-v3-owner-source", "config owner namespace cannot be inspected", { cause });
  }
  return entries;
}

// 判断 config owner 的保留命名空间是否只包含当前状态允许的精确名称。
function namespaceContainsExactly(actual, expected) {
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((entry, index) => entry === sortedExpected[index]);
}

// 验证候选节点与目标字节、0644、当前 owner 和指定 link count 完全一致。
function isExactTarget(source, target, expectedLinkCount) {
  return source !== null
    && source.stat.isFile()
    && !source.stat.isSymbolicLink()
    && source.stat.uid === currentEuid()
    && modeString(source.stat) === CONFIG_MODE_STRING
    && source.stat.nlink === expectedLinkCount
    && source.bytes !== null
    && source.bytes.equals(target.bytes);
}

// 将 fresh final/stage 物理关系分类为 absent、可恢复残留、existing 或 unsafe。
function inspectSourceInternal({ workspaceRoot, model }) {
  const target = targetMetadata(model);
  const rootState = workspaceRootState(workspaceRoot);
  const config = inspectNode(rootState, CONFIG_REF);
  const stage = inspectNode(rootState, target.stageRef);
  const namespaceEntries = inspectConfigOwnerNamespace(rootState);
  const sameFile = config !== null && stage !== null && sameIdentity(config.stat, stage.stat);
  let classification = "unsafe-residue";
  // Fresh 是 absent-only 状态机。只有当前目标摘要对应的单一 stage
  // 可以作为 prepared/committed recovery 证据；其他摘要或其他协议留下的
  // owner 名称都不能被忽略后继续初始化。
  if (config === null && stage === null) {
    classification = READY_CLASSIFICATION;
  } else if (config === null && isExactTarget(stage, target, 1)) {
    classification = "prepared-residue";
  } else if (
    sameFile
    && isExactTarget(config, target, 2)
    && isExactTarget(stage, target, 2)
  ) {
    classification = "committed-pair-residue";
  } else if (stage === null && isExactTarget(config, target, 1)) {
    classification = "existing-config";
  }
  const expectedNamespaceRefs = ["prepared-residue", "committed-pair-residue"].includes(classification)
    ? [target.stageRef]
    : [];
  if (!namespaceContainsExactly(namespaceEntries, expectedNamespaceRefs)) {
    classification = "unsafe-residue";
  }
  const unsigned = {
    kind: "WakeflowConfigV3FreshSourceInspection",
    schemaVersion: 1,
    programId: target.desiredModel.program.programId,
    modelDigest: target.modelDigest,
    configBytesDigest: target.configBytesDigest,
    configRef: CONFIG_REF,
    stageRef: target.stageRef,
    classification,
    relation: sameFile ? "same-file" : config !== null && stage !== null ? "distinct" : "none",
    config: publicNode(config),
    stage: publicNode(stage),
  };
  return {
    target,
    rootState,
    config,
    stage,
    public: deepFreeze({ ...unsigned, inspectionDigest: canonicalJsonDigest(unsigned) }),
  };
}

/**
 * 只读检查 fresh config owner 的最终路径与保留 stage 命名空间。
 */
export function inspectWakeflowConfigV3FreshSource(value) {
  const input = exactInput(value, ["workspaceRoot", "model"], "config fresh source inspection input");
  return inspectSourceInternal(input).public;
}

// ==================== 三、Fresh Owner Plan ====================

// 将 fresh source classification 映射为唯一 blocker 集；只有 exact absent 可直接执行。
function blockerFor(classification) {
  if (classification === READY_CLASSIFICATION) return [];
  if (RECOVERY_CLASSIFICATIONS.has(classification)) {
    return [{ code: "fresh-config-recovery-residue", ref: CONFIG_REF }];
  }
  if (classification === "existing-config") {
    return [{ code: "fresh-config-already-exists", ref: CONFIG_REF }];
  }
  return [{ code: "fresh-config-unsafe-residue", ref: CONFIG_REF }];
}

// 从同一 target metadata 构造 fresh 的单一 create step。
function configStep(target) {
  return {
    stepId: "fresh-config-v3-create",
    ordinal: 0,
    stepKind: "create-or-update",
    source: { ref: CONFIG_REF, type: "absent" },
    staging: {
      ref: target.stageRef,
      type: "file",
      mode: CONFIG_MODE_STRING,
      digest: target.configBytesDigest,
    },
    final: {
      ref: CONFIG_REF,
      type: "file",
      mode: CONFIG_MODE_STRING,
      digest: target.configBytesDigest,
    },
  };
}

// 校验 step 内一个 source/staging/final resource 与派生合同完全一致。
function validateResource(value, expected, label) {
  exactKeys(value, Object.keys(expected), label);
  if (!sameCanonical(value, expected)) fail("wakeflow-config-v3-owner-plan", `${label} differs from its derived contract`);
}

// 完整复算 fresh plan 的模型、字节、stage、blocker、status 与 step，拒绝 caller 自报字段。
function validatePlanInternal(value) {
  const plan = canonicalSnapshot(value, "config owner plan");
  exactKeys(plan, ["schemaId", "payload"], "config owner plan");
  if (plan.schemaId !== WAKEFLOW_CONFIG_V3_OWNER_PLAN_SCHEMA_ID) {
    fail("wakeflow-config-v3-owner-plan", "config owner plan schemaId is invalid");
  }
  exactKeys(plan.payload, PLAN_PAYLOAD_KEYS, "config owner plan payload");
  const payload = plan.payload;
  if (
    payload.kind !== WAKEFLOW_CONFIG_V3_OWNER_PLAN_KIND
    || payload.schemaVersion !== WAKEFLOW_CONFIG_V3_OWNER_PLAN_SCHEMA_VERSION
    || payload.action !== "fresh-initialize"
    || !["ready", "blocked"].includes(payload.status)
    || !DIGEST_PATTERN.test(payload.sourceInspectionDigest)
  ) {
    fail("wakeflow-config-v3-owner-plan", "config owner plan identity or status is invalid");
  }
  const target = targetMetadata(payload.desiredModel);
  if (
    payload.programId !== target.desiredModel.program.programId
    || payload.modelDigest !== target.modelDigest
    || payload.configBytesDigest !== target.configBytesDigest
    || payload.stageRef !== target.stageRef
  ) {
    fail("wakeflow-config-v3-owner-plan", "config owner plan derived config metadata is stale");
  }
  if (
    typeof payload.sourceClassification !== "string"
    || !TOKEN_PATTERN.test(payload.sourceClassification)
    || !SOURCE_CLASSIFICATIONS.has(payload.sourceClassification)
  ) {
    fail("wakeflow-config-v3-owner-plan", "config owner source classification is invalid");
  }
  if (!Array.isArray(payload.blockers) || !Array.isArray(payload.steps)) {
    fail("wakeflow-config-v3-owner-plan", "config owner blockers and steps must be arrays");
  }
  for (const [index, blocker] of payload.blockers.entries()) {
    exactKeys(blocker, ["code", "ref"], `config owner blocker ${index}`);
    if (!TOKEN_PATTERN.test(blocker.code) || blocker.ref !== CONFIG_REF) {
      fail("wakeflow-config-v3-owner-plan", `config owner blocker ${index} is invalid`);
    }
  }
  const expectedBlockers = blockerFor(payload.sourceClassification);
  if (!sameCanonical(payload.blockers, expectedBlockers)) {
    fail("wakeflow-config-v3-owner-plan", "config owner blockers differ from source classification");
  }
  const ready = payload.sourceClassification === READY_CLASSIFICATION;
  if (payload.status !== (ready ? "ready" : "blocked")) {
    fail("wakeflow-config-v3-owner-plan", "config owner status is not derived");
  }
  if (ready) {
    if (payload.steps.length !== 1) fail("wakeflow-config-v3-owner-plan", "ready config owner plan needs one step");
    const expected = configStep(target);
    exactKeys(payload.steps[0], ["stepId", "ordinal", "stepKind", "source", "staging", "final"], "config owner step");
    if (
      payload.steps[0].stepId !== expected.stepId
      || payload.steps[0].ordinal !== 0
      || payload.steps[0].stepKind !== "create-or-update"
    ) {
      fail("wakeflow-config-v3-owner-plan", "config owner step identity is invalid");
    }
    validateResource(payload.steps[0].source, expected.source, "config owner step source");
    validateResource(payload.steps[0].staging, expected.staging, "config owner step staging");
    validateResource(payload.steps[0].final, expected.final, "config owner step final");
  } else if (payload.steps.length !== 0) {
    fail("wakeflow-config-v3-owner-plan", "blocked config owner plan cannot expose steps");
  }
  return deepFreeze(plan);
}

/**
 * 基于当前只读 inspection 生成 fresh config owner 的 ready/blocked 确定性计划。
 */
export function planWakeflowConfigV3FreshOwner(value) {
  const input = exactInput(value, ["workspaceRoot", "model"], "config fresh owner plan input");
  const inspected = inspectSourceInternal(input);
  const blockers = blockerFor(inspected.public.classification);
  return validatePlanInternal({
    schemaId: WAKEFLOW_CONFIG_V3_OWNER_PLAN_SCHEMA_ID,
    payload: {
      kind: WAKEFLOW_CONFIG_V3_OWNER_PLAN_KIND,
      schemaVersion: WAKEFLOW_CONFIG_V3_OWNER_PLAN_SCHEMA_VERSION,
      action: "fresh-initialize",
      status: blockers.length === 0 ? "ready" : "blocked",
      programId: inspected.target.desiredModel.program.programId,
      desiredModel: inspected.target.desiredModel,
      modelDigest: inspected.target.modelDigest,
      configBytesDigest: inspected.target.configBytesDigest,
      stageRef: inspected.target.stageRef,
      sourceClassification: inspected.public.classification,
      sourceInspectionDigest: inspected.public.inspectionDigest,
      blockers,
      steps: blockers.length === 0 ? [configStep(inspected.target)] : [],
    },
  });
}

/**
 * 独立复核一份 fresh owner plan；返回深冻结 canonical plan，不接触文件系统。
 */
export function validateWakeflowConfigV3OwnerPlan(value) {
  return validatePlanInternal(value);
}

// ==================== 四、Fresh M3 Mutation Participant ====================

// 要求 caller 已持有与 workspace/mode 完全匹配的 branded M3 context。
function assertContext(workspaceRoot, context) {
  if (context === null || typeof context !== "object") {
    fail("wakeflow-config-v3-owner-context", "a branded workspace mutation context is required");
  }
  const mode = context.recoveryGeneration > 0 ? "recovery-cleanup" : "maintenance";
  assertWakeflowMutationContext({ workspaceRoot, context, mode });
}

// 重新取得 root stat，拒绝 mutation 期间 workspace inode 被替换。
function verifyRootIdentity(rootState, expected) {
  const refreshed = workspaceRootState(rootState.root);
  if (!sameIdentity(refreshed.stat, expected)) {
    fail("wakeflow-config-v3-owner-race", "workspace root identity changed during config mutation");
  }
  return refreshed;
}

// no-follow 打开 workspace directory descriptor，并交叉验证 path 与 descriptor 身份。
function openRoot(rootState, expectedIdentity = null) {
  let descriptor;
  try {
    descriptor = openSync(
      rootState.root,
      fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0) | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const stat = fstatSync(descriptor);
    if (!stat.isDirectory() || stat.uid !== currentEuid()) {
      fail("wakeflow-config-v3-owner-workspace", "workspace root descriptor is unsafe");
    }
    if (expectedIdentity && !sameIdentity(stat, expectedIdentity)) {
      fail("wakeflow-config-v3-owner-race", "workspace root descriptor identity changed");
    }
    verifyRootIdentity(rootState, stat);
    return { descriptor, stat };
  } catch (cause) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (cause instanceof WakeflowConfigV3OwnerError) throw cause;
    fail("wakeflow-config-v3-owner-workspace", "workspace root cannot be opened safely", { cause });
  }
}

// 构造 M3 step observation 使用的标准 absent resource。
function absentResource(ref) {
  return { ref, type: "absent" };
}

// 把 fresh 物理分类映射为 M3 所需的 source/staging/final observation。
function observationFor(inspected, step) {
  const classification = inspected.public.classification;
  if (classification === READY_CLASSIFICATION) {
    return {
      source: absentResource(step.source.ref),
      staging: absentResource(step.staging.ref),
      final: absentResource(step.final.ref),
    };
  }
  if (classification === "prepared-residue") {
    return {
      source: absentResource(step.source.ref),
      staging: step.staging,
      final: absentResource(step.final.ref),
    };
  }
  if (["committed-pair-residue", "existing-config"].includes(classification)) {
    return {
      source: step.final,
      staging: absentResource(step.staging.ref),
      final: step.final,
    };
  }
  fail("wakeflow-config-v3-owner-residue", "config owner observed unsafe or unrelated residue", {
    details: { classification },
  });
}

// 在 terminal closure 前证明最终配置是 exact strict pretty model，而非仅摘要相等。
function assertCanonicalFinal(inspected, target) {
  if (!["committed-pair-residue", "existing-config"].includes(inspected.public.classification)) {
    fail("wakeflow-config-v3-owner-terminal", "strict v3 config has not reached its committed state");
  }
  const bytes = inspected.config?.bytes;
  if (!bytes || !bytes.equals(target.bytes)) {
    fail("wakeflow-config-v3-owner-terminal", "committed config bytes differ from the confirmed model");
  }
  let parsed;
  try {
    parsed = JSON.parse(TEXT_DECODER.decode(bytes));
  } catch (cause) {
    fail("wakeflow-config-v3-owner-terminal", "committed config is not strict UTF-8 JSON", { cause });
  }
  const model = parseWakeflowConfigV3(parsed);
  if (
    !Buffer.from(serializeWakeflowConfigV3(model), "utf8").equals(bytes)
    || wakeflowConfigV3Digest(model) !== target.modelDigest
    || !sameCanonical(model, target.desiredModel)
  ) {
    fail("wakeflow-config-v3-owner-terminal", "committed config is not the exact strict pretty model");
  }
  return model;
}

// 为 fresh 单一步骤构造 prepare→observe→commit→cleanup 的有状态进程内 handler。
function createStepHandler(workspaceRoot, target, step) {
  // lastObservation 只保护同一 participant 内紧邻的 observe -> commit 边界；
  // 可恢复的持久进度由 M3 journal 保存，不能依赖这个进程内变量。
  let lastObservation = null;
  const inspect = () => inspectSourceInternal({ workspaceRoot, model: target.desiredModel });
  const observeAndRemember = () => {
    const inspected = inspect();
    lastObservation = {
      classification: inspected.public.classification,
      rootIdentity: inspected.rootState.stat,
      stageIdentity: inspected.stage?.stat ?? null,
    };
    return observationFor(inspected, step);
  };
  return {
    // 独占创建并 fsync 0600→0644 stage；不触碰已存在 final。
    prepare({ context }) {
      assertContext(workspaceRoot, context);
      const inspected = inspect();
      if (inspected.public.classification !== READY_CLASSIFICATION) {
        fail("wakeflow-config-v3-owner-stale", "config source changed before prepare");
      }
      const rootHandle = openRoot(inspected.rootState, inspected.rootState.stat);
      let stageDescriptor;
      try {
        stageDescriptor = openSync(
          path.join(inspected.rootState.root, target.stageRef),
          fsConstants.O_WRONLY
            | fsConstants.O_CREAT
            | fsConstants.O_EXCL
            | (fsConstants.O_NOFOLLOW ?? 0),
          0o600,
        );
        writeFileSync(stageDescriptor, target.bytes);
        fchmodSync(stageDescriptor, CONFIG_MODE);
        fsyncSync(stageDescriptor);
        const stageStat = fstatSync(stageDescriptor);
        if (
          !stageStat.isFile()
          || stageStat.uid !== currentEuid()
          || stageStat.nlink !== 1
          || modeString(stageStat) !== CONFIG_MODE_STRING
          || stageStat.size !== target.bytes.length
        ) {
          fail("wakeflow-config-v3-owner-prepare", "config stage did not reach its exact file contract");
        }
        fsyncSync(rootHandle.descriptor);
        verifyRootIdentity(inspected.rootState, rootHandle.stat);
      } catch (cause) {
        if (cause instanceof WakeflowConfigV3OwnerError) throw cause;
        fail("wakeflow-config-v3-owner-prepare", "config stage publication failed", { cause });
      } finally {
        if (stageDescriptor !== undefined) closeSync(stageDescriptor);
        closeSync(rootHandle.descriptor);
      }
    },

    // 记录紧邻 commit 所需的 source/root/stage 身份，并返回 M3 标准 observation。
    observe({ context }) {
      assertContext(workspaceRoot, context);
      return observeAndRemember();
    },

    // 以 hard link no-replace 发布 final；并发创建 final 会失败而不会被覆盖。
    commit({ context }) {
      assertContext(workspaceRoot, context);
      if (lastObservation?.classification !== "prepared-residue") {
        fail("wakeflow-config-v3-owner-race", "config commit lacks an immediately preceding exact prepared observation");
      }
      const expected = lastObservation;
      lastObservation = null;
      const inspected = inspect();
      if (
        inspected.public.classification !== "prepared-residue"
        || !inspected.stage
        || !expected.stageIdentity
        || !sameIdentity(inspected.stage.stat, expected.stageIdentity)
      ) {
        fail("wakeflow-config-v3-owner-stale", "config stage changed before no-replace commit");
      }
      const rootHandle = openRoot(inspected.rootState, expected.rootIdentity);
      try {
        // Fresh 通过 hard link 发布：若 final 已被任何并发方创建，link
        // 必然失败，绝不以 rename 覆盖一个无法证明来源的配置。
        linkSync(
          path.join(inspected.rootState.root, target.stageRef),
          path.join(inspected.rootState.root, CONFIG_REF),
        );
        fsyncSync(rootHandle.descriptor);
        const pair = inspect();
        if (pair.public.classification !== "committed-pair-residue") {
          fail("wakeflow-config-v3-owner-commit", "config no-replace link did not form one exact pair");
        }
        verifyRootIdentity(inspected.rootState, rootHandle.stat);
      } catch (cause) {
        if (cause instanceof WakeflowConfigV3OwnerError) throw cause;
        fail("wakeflow-config-v3-owner-commit", "config no-replace link commit failed", { cause });
      } finally {
        closeSync(rootHandle.descriptor);
      }
    },

    // 仅在 final/stage 仍为 exact committed pair 时删除 stage，留下单链接 final。
    cleanup({ context }) {
      assertContext(workspaceRoot, context);
      const inspected = inspect();
      if (inspected.public.classification === "existing-config") return;
      if (
        inspected.public.classification !== "committed-pair-residue"
        || !inspected.stage
        || !inspected.config
        || !sameIdentity(inspected.stage.stat, inspected.config.stat)
      ) {
        fail("wakeflow-config-v3-owner-cleanup", "config stage cleanup lacks one exact committed pair");
      }
      const rootHandle = openRoot(inspected.rootState, inspected.rootState.stat);
      try {
        const expectedStage = inspected.stage.stat;
        const expectedConfig = inspected.config.stat;
        const refreshedStage = lstatSync(path.join(inspected.rootState.root, target.stageRef));
        const refreshedConfig = lstatSync(path.join(inspected.rootState.root, CONFIG_REF));
        if (
          !sameIdentity(refreshedStage, expectedStage)
          || !sameIdentity(refreshedConfig, expectedConfig)
          || !sameIdentity(refreshedStage, refreshedConfig)
          || refreshedStage.nlink !== 2
          || refreshedConfig.nlink !== 2
        ) {
          fail("wakeflow-config-v3-owner-race", "config committed pair changed before cleanup");
        }
        unlinkSync(path.join(inspected.rootState.root, target.stageRef));
        fsyncSync(rootHandle.descriptor);
        const terminal = inspect();
        if (
          terminal.public.classification !== "existing-config"
          || !terminal.config
          || !sameIdentity(terminal.config.stat, expectedConfig)
        ) {
          fail("wakeflow-config-v3-owner-cleanup", "config stage cleanup did not leave one exact final file");
        }
        verifyRootIdentity(inspected.rootState, rootHandle.stat);
      } catch (cause) {
        if (cause instanceof WakeflowConfigV3OwnerError) throw cause;
        fail("wakeflow-config-v3-owner-cleanup", "config stage cleanup failed", { cause });
      } finally {
        closeSync(rootHandle.descriptor);
      }
    },
  };
}

/**
 * 把已确认 ready fresh plan 封装为 M3 mutation participant。
 * participant 不取得 gate；每个 effect 和 terminal closure 都要求外部传入精确 context。
 */
export function createWakeflowConfigV3OwnerMutationParticipant(value) {
  const input = exactInput(
    value,
    ["workspaceRoot", "model", "confirmedPlan"],
    "config v3 owner mutation participant input",
  );
  const target = targetMetadata(input.model);
  const confirmedPlan = validatePlanInternal(input.confirmedPlan);
  if (!sameCanonical(confirmedPlan.payload.desiredModel, target.desiredModel)) {
    fail("wakeflow-config-v3-owner-plan", "participant model differs from the confirmed config owner plan");
  }
  if (confirmedPlan.payload.status !== "ready" || confirmedPlan.payload.blockers.length > 0) {
    fail("wakeflow-config-v3-owner-blocked", "a blocked fresh config plan cannot create a mutation participant");
  }
  workspaceRootState(input.workspaceRoot);
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const [step] = confirmedPlan.payload.steps;
  const handler = createStepHandler(workspaceRoot, target, step);

  return Object.freeze({
    // M3 组合前再次证明传入 plan 与 participant 冻结合同完全相同。
    validatePlan({ plan }) {
      const candidate = validatePlanInternal(plan);
      if (!sameCanonical(candidate, confirmedPlan)) {
        fail("wakeflow-config-v3-owner-plan", "config owner plan differs from the participant contract");
      }
      return { valid: true };
    },

    // normal apply 要求 preview source 未变；recovery 允许已确认事务的合法后继阶段。
    deriveCurrentPlan({ context }) {
      if (context !== null) assertContext(workspaceRoot, context);
      const inspected = inspectSourceInternal({ workspaceRoot, model: target.desiredModel });
      // null 只供 M3 签发 successor recovery gate 之前的只读预检；所有
      // step handler 与 terminal closure 仍要求真实 branded context。
      const recovery = context === null || context.recoveryGeneration > 0;
      const admitted = inspected.public.classification === READY_CLASSIFICATION
        || (recovery && [
          "prepared-residue",
          "committed-pair-residue",
          "existing-config",
        ].includes(inspected.public.classification));
      if (!admitted) {
        fail("wakeflow-config-v3-owner-stale", "fresh config source differs from the confirmed owner plan", {
          details: { classification: inspected.public.classification },
        });
      }
      if (
        !recovery
        && inspected.public.inspectionDigest !== confirmedPlan.payload.sourceInspectionDigest
      ) {
        fail("wakeflow-config-v3-owner-stale", "fresh config source inspection changed since confirmation");
      }
      return confirmedPlan;
    },

    // 只有 exact canonical final 已提交时生成 closure digest，供 M3 关闭 journal。
    deriveTerminalClosure({ context, plan, planDigest }) {
      assertContext(workspaceRoot, context);
      if (!sameCanonical(plan, confirmedPlan) || planDigest !== canonicalJsonDigest(confirmedPlan)) {
        fail("wakeflow-config-v3-owner-plan", "terminal closure received a different config owner plan");
      }
      const inspected = inspectSourceInternal({ workspaceRoot, model: target.desiredModel });
      const model = assertCanonicalFinal(inspected, target);
      const closure = {
        kind: "WakeflowConfigV3OwnerClosure",
        schemaVersion: 1,
        programId: model.program.programId,
        modelDigest: wakeflowConfigV3Digest(model),
        configBytesDigest: target.configBytesDigest,
      };
      return {
        planDigest,
        closureDigests: [{
          name: "config-v3-owner-closure",
          digest: canonicalJsonDigest(closure),
        }],
      };
    },

    stepHandlers: Object.freeze({ [step.stepId]: Object.freeze(handler) }),
  });
}

// ==================== 五、Reconfigure Source Inspection 与 Owner Plan ====================

export const WAKEFLOW_CONFIG_V3_RECONFIGURE_OWNER_PLAN_SCHEMA_ID =
  "urn:wakeflow:internal:config-v3-reconfigure-owner-plan:v1";
export const WAKEFLOW_CONFIG_V3_RECONFIGURE_OWNER_PLAN_KIND =
  "WakeflowConfigV3ReconfigureOwnerPlan";
export const WAKEFLOW_CONFIG_V3_RECONFIGURE_OWNER_PLAN_SCHEMA_VERSION = 1;

const RECONFIGURE_SOURCE_CLASSIFICATIONS = new Set([
  "current",
  "ready-update",
  "prepared-residue",
  "linked-prepared-residue",
  "committed-predecessor-residue",
  "unsafe-residue",
]);
const RECONFIGURE_READY_CLASSIFICATIONS = new Set(["current", "ready-update"]);
const RECONFIGURE_RECOVERY_CLASSIFICATIONS = new Set([
  ...RECONFIGURE_READY_CLASSIFICATIONS,
  "prepared-residue",
  "linked-prepared-residue",
  "committed-predecessor-residue",
]);
const RECONFIGURE_PLAN_PAYLOAD_KEYS = Object.freeze([
  "action",
  "blockers",
  "configBytesDigest",
  "desiredModel",
  "disposition",
  "kind",
  "modelDigest",
  "predecessorRef",
  "programId",
  "schemaVersion",
  "sourceClassification",
  "sourceConfigBytesDigest",
  "sourceFileIdentityDigest",
  "sourceInspectionDigest",
  "sourceModel",
  "sourceModelDigest",
  "stageRef",
  "status",
  "steps",
]);

// 为跨 prepare/commit/recovery 保持稳定的旧配置事实生成持久 fingerprint。
function stableFileIdentityDigest(source) {
  if (source === null || source.bytes === null) return null;
  const stat = source.stat;
  // nlink/ctime 会被本 owner 自己的 predecessor hard-link 步骤合法改变，
  // 因此不属于跨恢复阶段保持不变的 source identity。一次读取期间的
  // stat 稳定性是另一层 admission，不能混入这个持久 fingerprint。
  return canonicalJsonDigest({
    deviceId: String(stat.dev),
    inodeId: String(stat.ino),
    mode: String(stat.mode),
    uid: String(stat.uid),
    gid: String(stat.gid),
    size: String(stat.size),
    mtimeMs: String(stat.mtimeMs),
    bytesDigest: digestBytes(source.bytes),
  });
}

// 把 owner 读取的节点解释为 canonical strict v3 config；任何弱形状都返回 null。
function parseStrictConfigSource(source) {
  if (
    source === null
    || source.bytes === null
    || !source.stat.isFile()
    || source.stat.isSymbolicLink()
    || source.stat.uid !== currentEuid()
    || modeString(source.stat) !== CONFIG_MODE_STRING
    || ![1, 2].includes(source.stat.nlink)
  ) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(TEXT_DECODER.decode(source.bytes));
  } catch {
    return null;
  }
  let model;
  try {
    model = parseWakeflowConfigV3(parsed);
  } catch {
    return null;
  }
  const metadata = targetMetadata(model);
  if (!metadata.bytes.equals(source.bytes)) return null;
  return { model, metadata };
}

// 证明一个节点与给定 config metadata 及阶段 link count 完全一致。
function exactConfigNode(source, metadata, linkCount) {
  return source !== null
    && source.bytes !== null
    && source.stat.isFile()
    && !source.stat.isSymbolicLink()
    && source.stat.uid === currentEuid()
    && modeString(source.stat) === CONFIG_MODE_STRING
    && source.stat.nlink === linkCount
    && source.bytes.equals(metadata.bytes);
}

// 判断两个已检查节点是否为同一 inode；null 永远不构成关系。
function sameFileNode(left, right) {
  return left !== null
    && right !== null
    && sameIdentity(left.stat, right.stat);
}

// 从 source/target bytes digest 派生 reconfigure stage 与 predecessor 保留名称。
function reconfigureRefs(source, target) {
  const targetHex = target.configBytesDigest.slice("sha256:".length);
  const sourceHex = (source?.configBytesDigest ?? target.configBytesDigest).slice("sha256:".length);
  return {
    stageRef: `.${CONFIG_REF}.${targetHex}.reconfigure-stage`,
    predecessorRef: `.${CONFIG_REF}.${sourceHex}.reconfigure-predecessor`,
  };
}

// 分类 final/stage/predecessor 的物理状态，并绑定旧模型、目标模型及恢复身份。
function inspectReconfigureSourceInternal({ workspaceRoot, desiredModel, expectedSourceModel = null }) {
  const target = targetMetadata(desiredModel);
  const expectedSource = expectedSourceModel === null ? null : targetMetadata(expectedSourceModel);
  const rootState = workspaceRootState(workspaceRoot);
  const config = inspectNode(rootState, CONFIG_REF);
  const parsedConfig = parseStrictConfigSource(config);
  const inferredSource = expectedSource ?? parsedConfig?.metadata ?? null;
  const refs = reconfigureRefs(inferredSource, target);
  const stage = inspectNode(rootState, refs.stageRef);
  const predecessor = inspectNode(rootState, refs.predecessorRef);
  const namespaceEntries = inspectConfigOwnerNamespace(rootState);

  const oldMetadata = inferredSource;
  const oldConfigOne = oldMetadata !== null && exactConfigNode(config, oldMetadata, 1);
  const oldConfigTwo = oldMetadata !== null && exactConfigNode(config, oldMetadata, 2);
  const newConfigOne = exactConfigNode(config, target, 1);
  const targetStage = exactConfigNode(stage, target, 1);
  const oldPredecessorOne = oldMetadata !== null && exactConfigNode(predecessor, oldMetadata, 1);
  const oldPredecessorTwo = oldMetadata !== null && exactConfigNode(predecessor, oldMetadata, 2);
  const oldPair = oldConfigTwo
    && oldPredecessorTwo
    && sameFileNode(config, predecessor);
  const sameSourceAndTarget = oldMetadata !== null
    && oldMetadata.configBytesDigest === target.configBytesDigest
    && oldMetadata.modelDigest === target.modelDigest;

  let classification = "unsafe-residue";
  if (expectedSource === null) {
    if (
      parsedConfig !== null
      && config.stat.nlink === 1
      && stage === null
      && predecessor === null
    ) {
      classification = parsedConfig.metadata.configBytesDigest === target.configBytesDigest
        && parsedConfig.metadata.modelDigest === target.modelDigest
        ? "current"
        : "ready-update";
    }
  } else if (stage === null && predecessor === null && (oldConfigOne || newConfigOne)) {
    classification = newConfigOne ? "current" : "ready-update";
  } else if (oldConfigOne && targetStage && predecessor === null) {
    classification = "prepared-residue";
  } else if (oldPair && targetStage) {
    classification = "linked-prepared-residue";
  } else if (newConfigOne && stage === null && oldPredecessorOne) {
    classification = "committed-predecessor-residue";
  }
  // Reconfigure 的保留名称集合随物理阶段严格变化。只要出现本计划之外
  // 的 fresh/reconfigure stage 或 predecessor，就保留现场并 fail closed。
  const expectedNamespaceRefs = classification === "prepared-residue"
    ? [refs.stageRef]
    : classification === "linked-prepared-residue"
      ? [refs.stageRef, refs.predecessorRef]
      : classification === "committed-predecessor-residue"
        ? [refs.predecessorRef]
        : [];
  if (!namespaceContainsExactly(namespaceEntries, expectedNamespaceRefs)) {
    classification = "unsafe-residue";
  }

  const sourceNode = oldConfigOne || oldConfigTwo
    ? config
    : oldPredecessorOne || oldPredecessorTwo
      ? predecessor
      : parsedConfig !== null && config?.stat.nlink === 1
        ? config
        : null;
  const sourceModel = expectedSourceModel ?? parsedConfig?.model ?? null;
  const sourceMetadata = expectedSource
    ?? (sourceModel === null ? null : targetMetadata(sourceModel));
  const sourceFileIdentityDigest = stableFileIdentityDigest(sourceNode);
  const unsigned = {
    kind: "WakeflowConfigV3ReconfigureSourceInspection",
    schemaVersion: 1,
    programId: target.desiredModel.program.programId,
    desiredModelDigest: target.modelDigest,
    desiredConfigBytesDigest: target.configBytesDigest,
    sourceModel,
    sourceModelDigest: sourceMetadata?.modelDigest ?? null,
    sourceConfigBytesDigest: sourceMetadata?.configBytesDigest ?? null,
    sourceFileIdentityDigest,
    configRef: CONFIG_REF,
    stageRef: refs.stageRef,
    predecessorRef: refs.predecessorRef,
    classification,
    relation: sameFileNode(config, predecessor) ? "config-predecessor-same-file" : "none",
    config: publicNode(config),
    stage: publicNode(stage),
    predecessor: publicNode(predecessor),
    sameSourceAndTarget,
  };
  return {
    target,
    source: sourceMetadata,
    sourceModel,
    sourceNode,
    rootState,
    config,
    stage,
    predecessor,
    refs,
    public: deepFreeze({ ...unsigned, inspectionDigest: canonicalJsonDigest(unsigned) }),
  };
}

/**
 * 只读检查 reconfigure 的 strict source、目标 stage 与 predecessor 恢复表面。
 */
export function inspectWakeflowConfigV3ReconfigureSource(value) {
  const input = exactInput(
    value,
    ["workspaceRoot", "desiredModel"],
    "config reconfigure source inspection input",
  );
  return inspectReconfigureSourceInternal(input).public;
}

// 将 reconfigure classification 映射为 ready、recovery-required 或 unsafe blocker。
function reconfigureBlockers(classification) {
  if (RECONFIGURE_READY_CLASSIFICATIONS.has(classification)) return [];
  if (RECONFIGURE_RECOVERY_CLASSIFICATIONS.has(classification)) {
    return [{ code: "reconfigure-config-recovery-required", ref: CONFIG_REF }];
  }
  return [{ code: "reconfigure-config-unsafe-source", ref: CONFIG_REF }];
}

// 构造从旧 canonical config 到新 canonical config 的唯一 update step。
function reconfigureConfigStep(source, target, refs) {
  return {
    stepId: "reconfigure-config-v3-update",
    ordinal: 0,
    stepKind: "create-or-update",
    source: {
      ref: CONFIG_REF,
      type: "file",
      mode: CONFIG_MODE_STRING,
      digest: source.configBytesDigest,
    },
    staging: {
      ref: refs.stageRef,
      type: "file",
      mode: CONFIG_MODE_STRING,
      digest: target.configBytesDigest,
    },
    final: {
      ref: CONFIG_REF,
      type: "file",
      mode: CONFIG_MODE_STRING,
      digest: target.configBytesDigest,
    },
  };
}

// 完整复算 reconfigure plan 的 source identity、目标、refs、disposition、blocker 与 step。
function validateReconfigurePlanInternal(value) {
  const plan = canonicalSnapshot(value, "config reconfigure owner plan");
  exactKeys(plan, ["schemaId", "payload"], "config reconfigure owner plan");
  if (plan.schemaId !== WAKEFLOW_CONFIG_V3_RECONFIGURE_OWNER_PLAN_SCHEMA_ID) {
    fail("wakeflow-config-v3-reconfigure-plan", "config reconfigure owner plan schemaId is invalid");
  }
  exactKeys(plan.payload, RECONFIGURE_PLAN_PAYLOAD_KEYS, "config reconfigure owner plan payload");
  const payload = plan.payload;
  if (
    payload.kind !== WAKEFLOW_CONFIG_V3_RECONFIGURE_OWNER_PLAN_KIND
    || payload.schemaVersion !== WAKEFLOW_CONFIG_V3_RECONFIGURE_OWNER_PLAN_SCHEMA_VERSION
    || payload.action !== "reconfigure"
    || !["ready", "blocked"].includes(payload.status)
    || !["current", "update", "blocked"].includes(payload.disposition)
    || !RECONFIGURE_SOURCE_CLASSIFICATIONS.has(payload.sourceClassification)
    || !DIGEST_PATTERN.test(payload.sourceInspectionDigest)
  ) {
    fail("wakeflow-config-v3-reconfigure-plan", "config reconfigure owner plan identity is invalid");
  }
  const target = targetMetadata(payload.desiredModel);
  if (
    payload.programId !== target.desiredModel.program.programId
    || payload.modelDigest !== target.modelDigest
    || payload.configBytesDigest !== target.configBytesDigest
  ) {
    fail("wakeflow-config-v3-reconfigure-plan", "config reconfigure target metadata is stale");
  }
  let source = null;
  if (payload.sourceModel !== null) {
    source = targetMetadata(payload.sourceModel);
    if (
      payload.sourceModelDigest !== source.modelDigest
      || payload.sourceConfigBytesDigest !== source.configBytesDigest
      || !DIGEST_PATTERN.test(payload.sourceFileIdentityDigest)
      || source.desiredModel.program.programId !== target.desiredModel.program.programId
    ) {
      fail("wakeflow-config-v3-reconfigure-plan", "config reconfigure source metadata is stale");
    }
  } else if (
    payload.sourceModelDigest !== null
    || payload.sourceConfigBytesDigest !== null
    || payload.sourceFileIdentityDigest !== null
  ) {
    fail("wakeflow-config-v3-reconfigure-plan", "blocked config source metadata must be wholly absent");
  }
  const refs = reconfigureRefs(source, target);
  if (payload.stageRef !== refs.stageRef || payload.predecessorRef !== refs.predecessorRef) {
    fail("wakeflow-config-v3-reconfigure-plan", "config reconfigure residue refs are stale");
  }
  if (!Array.isArray(payload.blockers) || !Array.isArray(payload.steps)) {
    fail("wakeflow-config-v3-reconfigure-plan", "config reconfigure blockers and steps must be arrays");
  }
  const expectedBlockers = reconfigureBlockers(payload.sourceClassification);
  if (!sameCanonical(payload.blockers, expectedBlockers)) {
    fail("wakeflow-config-v3-reconfigure-plan", "config reconfigure blockers differ from source state");
  }
  const ready = expectedBlockers.length === 0;
  if (payload.status !== (ready ? "ready" : "blocked")) {
    fail("wakeflow-config-v3-reconfigure-plan", "config reconfigure status is not derived");
  }
  if (ready && source === null) {
    fail("wakeflow-config-v3-reconfigure-plan", "ready config reconfigure plan requires one strict source model");
  }
  const expectedDisposition = !ready
    ? "blocked"
    : source.configBytesDigest === target.configBytesDigest && source.modelDigest === target.modelDigest
      ? "current"
      : "update";
  if (payload.disposition !== expectedDisposition) {
    fail("wakeflow-config-v3-reconfigure-plan", "config reconfigure disposition is not derived");
  }
  if (expectedDisposition === "update") {
    if (payload.steps.length !== 1) {
      fail("wakeflow-config-v3-reconfigure-plan", "config reconfigure update requires one step");
    }
    const expected = reconfigureConfigStep(source, target, refs);
    if (!sameCanonical(payload.steps[0], expected)) {
      fail("wakeflow-config-v3-reconfigure-plan", "config reconfigure step differs from its source and target");
    }
  } else if (payload.steps.length !== 0) {
    fail("wakeflow-config-v3-reconfigure-plan", "non-update config reconfigure plan cannot expose steps");
  }
  return deepFreeze(plan);
}

/**
 * 基于当前 strict source 生成 current/update/blocked 的 reconfigure owner 计划。
 */
export function planWakeflowConfigV3ReconfigureOwner(value) {
  const input = exactInput(
    value,
    ["workspaceRoot", "desiredModel"],
    "config reconfigure owner plan input",
  );
  const inspected = inspectReconfigureSourceInternal(input);
  if (
    inspected.sourceModel !== null
    && inspected.sourceModel.program.programId !== inspected.target.desiredModel.program.programId
  ) {
    fail(
      "wakeflow-config-v3-reconfigure-program",
      "reconfigure must preserve the exact program ID",
    );
  }
  const blockers = reconfigureBlockers(inspected.public.classification);
  const disposition = blockers.length > 0
    ? "blocked"
    : inspected.public.sameSourceAndTarget
      ? "current"
      : "update";
  return validateReconfigurePlanInternal({
    schemaId: WAKEFLOW_CONFIG_V3_RECONFIGURE_OWNER_PLAN_SCHEMA_ID,
    payload: {
      kind: WAKEFLOW_CONFIG_V3_RECONFIGURE_OWNER_PLAN_KIND,
      schemaVersion: WAKEFLOW_CONFIG_V3_RECONFIGURE_OWNER_PLAN_SCHEMA_VERSION,
      action: "reconfigure",
      status: blockers.length === 0 ? "ready" : "blocked",
      disposition,
      programId: inspected.target.desiredModel.program.programId,
      sourceModel: inspected.sourceModel,
      sourceModelDigest: inspected.public.sourceModelDigest,
      sourceConfigBytesDigest: inspected.public.sourceConfigBytesDigest,
      sourceFileIdentityDigest: inspected.public.sourceFileIdentityDigest,
      desiredModel: inspected.target.desiredModel,
      modelDigest: inspected.target.modelDigest,
      configBytesDigest: inspected.target.configBytesDigest,
      stageRef: inspected.refs.stageRef,
      predecessorRef: inspected.refs.predecessorRef,
      sourceClassification: inspected.public.classification,
      sourceInspectionDigest: inspected.public.inspectionDigest,
      blockers,
      steps: disposition === "update"
        ? [reconfigureConfigStep(inspected.source, inspected.target, inspected.refs)]
        : [],
    },
  });
}

/**
 * 独立复核 reconfigure plan；不执行 stage、rename 或 cleanup。
 */
export function validateWakeflowConfigV3ReconfigureOwnerPlan(value) {
  return validateReconfigurePlanInternal(value);
}

// ==================== 六、Reconfigure M3 Mutation Participant ====================

// 将 reconfigure 物理分类映射为 M3 source/staging/final observation。
function reconfigureObservation(inspected, step) {
  if (inspected.public.classification === "ready-update") {
    return {
      source: step.source,
      staging: absentResource(step.staging.ref),
      final: step.source,
    };
  }
  if (["prepared-residue", "linked-prepared-residue"].includes(inspected.public.classification)) {
    return { source: step.source, staging: step.staging, final: step.source };
  }
  if (["committed-predecessor-residue", "current"].includes(inspected.public.classification)) {
    return {
      source: step.final,
      staging: absentResource(step.staging.ref),
      final: step.final,
    };
  }
  fail("wakeflow-config-v3-reconfigure-residue", "config reconfigure observed an unsafe physical state", {
    details: { classification: inspected.public.classification },
  });
}

// 构造旧配置 predecessor 保护下的 prepare→observe→commit→cleanup handler。
function createReconfigureStepHandler(workspaceRoot, target, sourceModel, confirmedPlan, step) {
  // 与 fresh 一样，进程内 observation 只关闭一次紧邻提交；旧配置、stage
  // 和 predecessor 的可恢复关系由文件身份与 M3 durable checkpoint 共同证明。
  let lastObservation = null;
  const inspect = () => inspectReconfigureSourceInternal({
    workspaceRoot,
    desiredModel: target.desiredModel,
    expectedSourceModel: sourceModel,
  });
  const remember = (inspected) => {
    lastObservation = {
      classification: inspected.public.classification,
      sourceFileIdentityDigest: inspected.public.sourceFileIdentityDigest,
      rootIdentity: inspected.rootState.stat,
      configIdentity: inspected.config?.stat ?? null,
      stageIdentity: inspected.stage?.stat ?? null,
      predecessorIdentity: inspected.predecessor?.stat ?? null,
    };
  };
  return {
    // 从 exact ready-update 独占创建并 fsync 新配置 stage。
    prepare({ context }) {
      assertContext(workspaceRoot, context);
      const inspected = inspect();
      if (
        inspected.public.classification !== "ready-update"
        || inspected.public.inspectionDigest !== confirmedPlan.payload.sourceInspectionDigest
        || inspected.public.sourceFileIdentityDigest !== confirmedPlan.payload.sourceFileIdentityDigest
      ) {
        fail("wakeflow-config-v3-reconfigure-stale", "config source changed before update prepare");
      }
      const rootHandle = openRoot(inspected.rootState, inspected.rootState.stat);
      let descriptor;
      try {
        descriptor = openSync(
          path.join(inspected.rootState.root, inspected.refs.stageRef),
          fsConstants.O_WRONLY
            | fsConstants.O_CREAT
            | fsConstants.O_EXCL
            | (fsConstants.O_NOFOLLOW ?? 0),
          0o600,
        );
        writeFileSync(descriptor, target.bytes);
        fchmodSync(descriptor, CONFIG_MODE);
        fsyncSync(descriptor);
        const staged = fstatSync(descriptor);
        if (
          !staged.isFile()
          || staged.uid !== currentEuid()
          || staged.nlink !== 1
          || modeString(staged) !== CONFIG_MODE_STRING
          || staged.size !== target.bytes.length
        ) {
          fail("wakeflow-config-v3-reconfigure-prepare", "config update stage is not exact");
        }
        fsyncSync(rootHandle.descriptor);
        verifyRootIdentity(inspected.rootState, rootHandle.stat);
      } catch (cause) {
        if (cause instanceof WakeflowConfigV3OwnerError) throw cause;
        fail("wakeflow-config-v3-reconfigure-prepare", "config update stage publication failed", { cause });
      } finally {
        if (descriptor !== undefined) closeSync(descriptor);
        closeSync(rootHandle.descriptor);
      }
    },

    // 记录旧 final、stage、predecessor 与 root 的紧邻提交身份。
    observe({ context }) {
      assertContext(workspaceRoot, context);
      const inspected = inspect();
      remember(inspected);
      return reconfigureObservation(inspected, step);
    },

    // 先 hard-link 旧 final 为 predecessor，再 rename 新 stage 覆盖 final。
    commit({ context }) {
      assertContext(workspaceRoot, context);
      if (!lastObservation || !["prepared-residue", "linked-prepared-residue"].includes(lastObservation.classification)) {
        fail("wakeflow-config-v3-reconfigure-race", "config update commit lacks an exact prepared observation");
      }
      const expected = lastObservation;
      lastObservation = null;
      let inspected = inspect();
      if (
        inspected.public.classification !== expected.classification
        || inspected.public.sourceFileIdentityDigest !== confirmedPlan.payload.sourceFileIdentityDigest
        || !sameIdentity(inspected.rootState.stat, expected.rootIdentity)
        || !sameIdentity(inspected.config?.stat, expected.configIdentity)
        || !sameIdentity(inspected.stage?.stat, expected.stageIdentity)
        || (expected.predecessorIdentity !== null
          && !sameIdentity(inspected.predecessor?.stat, expected.predecessorIdentity))
      ) {
        fail("wakeflow-config-v3-reconfigure-stale", "config update artifacts changed before commit");
      }
      const rootHandle = openRoot(inspected.rootState, expected.rootIdentity);
      try {
        if (inspected.public.classification === "prepared-residue") {
          // 先为旧 inode 建立 predecessor recovery 证据，再发布新 stage。
          // hard link 会改变旧文件的 nlink/ctime，所以持久 source identity
          // 有意只绑定保持稳定的 inode、mode、mtime 和 bytes。
          linkSync(
            path.join(inspected.rootState.root, CONFIG_REF),
            path.join(inspected.rootState.root, inspected.refs.predecessorRef),
          );
          fsyncSync(rootHandle.descriptor);
          inspected = inspect();
          if (
            inspected.public.classification !== "linked-prepared-residue"
            || inspected.public.sourceFileIdentityDigest !== confirmedPlan.payload.sourceFileIdentityDigest
          ) {
            fail("wakeflow-config-v3-reconfigure-commit", "config predecessor link is not exact");
          }
        }
        const beforeRename = inspect();
        if (
          beforeRename.public.classification !== "linked-prepared-residue"
          || beforeRename.public.sourceFileIdentityDigest !== confirmedPlan.payload.sourceFileIdentityDigest
        ) {
          fail("wakeflow-config-v3-reconfigure-stale", "config predecessor or stage changed before rename");
        }
        renameSync(
          path.join(beforeRename.rootState.root, beforeRename.refs.stageRef),
          path.join(beforeRename.rootState.root, CONFIG_REF),
        );
        fsyncSync(rootHandle.descriptor);
        const committed = inspect();
        if (
          committed.public.classification !== "committed-predecessor-residue"
          || committed.public.sourceFileIdentityDigest !== confirmedPlan.payload.sourceFileIdentityDigest
        ) {
          fail("wakeflow-config-v3-reconfigure-commit", "config update did not reach committed predecessor state");
        }
        verifyRootIdentity(beforeRename.rootState, rootHandle.stat);
      } catch (cause) {
        if (cause instanceof WakeflowConfigV3OwnerError) throw cause;
        fail("wakeflow-config-v3-reconfigure-commit", "config update commit failed", { cause });
      } finally {
        closeSync(rootHandle.descriptor);
      }
    },

    // 新 final 已提交后，仅在旧 predecessor 身份仍精确时删除恢复链接。
    cleanup({ context }) {
      assertContext(workspaceRoot, context);
      const inspected = inspect();
      if (inspected.public.classification === "current") return;
      if (
        inspected.public.classification !== "committed-predecessor-residue"
        || inspected.public.sourceFileIdentityDigest !== confirmedPlan.payload.sourceFileIdentityDigest
      ) {
        fail("wakeflow-config-v3-reconfigure-cleanup", "config predecessor cleanup lacks exact committed state");
      }
      const rootHandle = openRoot(inspected.rootState, inspected.rootState.stat);
      try {
        const expectedPredecessor = inspected.predecessor.stat;
        const refreshed = lstatSync(path.join(inspected.rootState.root, inspected.refs.predecessorRef));
        if (
          !sameIdentity(refreshed, expectedPredecessor)
          || refreshed.nlink !== 1
          || stableFileIdentityDigest(inspected.predecessor) !== confirmedPlan.payload.sourceFileIdentityDigest
        ) {
          fail("wakeflow-config-v3-reconfigure-race", "config predecessor changed before cleanup");
        }
        unlinkSync(path.join(inspected.rootState.root, inspected.refs.predecessorRef));
        fsyncSync(rootHandle.descriptor);
        const terminal = inspect();
        if (terminal.public.classification !== "current") {
          fail("wakeflow-config-v3-reconfigure-cleanup", "config predecessor cleanup is not terminal");
        }
        verifyRootIdentity(inspected.rootState, rootHandle.stat);
      } catch (cause) {
        if (cause instanceof WakeflowConfigV3OwnerError) throw cause;
        fail("wakeflow-config-v3-reconfigure-cleanup", "config predecessor cleanup failed", { cause });
      } finally {
        closeSync(rootHandle.descriptor);
      }
    },
  };
}

/**
 * 把已确认 reconfigure plan 封装为 M3 participant。
 * current disposition 不创建 step handler；update 的所有 effect 都受同一 source identity 约束。
 */
export function createWakeflowConfigV3ReconfigureMutationParticipant(value) {
  const input = exactInput(
    value,
    ["workspaceRoot", "desiredModel", "confirmedPlan"],
    "config reconfigure mutation participant input",
  );
  const target = targetMetadata(input.desiredModel);
  const confirmedPlan = validateReconfigurePlanInternal(input.confirmedPlan);
  if (!sameCanonical(confirmedPlan.payload.desiredModel, target.desiredModel)) {
    fail("wakeflow-config-v3-reconfigure-plan", "participant desired model differs from confirmed plan");
  }
  if (confirmedPlan.payload.status !== "ready" || confirmedPlan.payload.sourceModel === null) {
    fail("wakeflow-config-v3-reconfigure-blocked", "blocked config reconfigure plan cannot create a participant");
  }
  workspaceRootState(input.workspaceRoot);
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const sourceModel = confirmedPlan.payload.sourceModel;
  const stepHandlers = {};
  if (confirmedPlan.payload.disposition === "update") {
    const [step] = confirmedPlan.payload.steps;
    stepHandlers[step.stepId] = Object.freeze(createReconfigureStepHandler(
      workspaceRoot,
      target,
      sourceModel,
      confirmedPlan,
      step,
    ));
  }

  return Object.freeze({
    // 证明 M3 使用的计划没有偏离 participant 冻结的 source→target 合同。
    validatePlan({ plan }) {
      const candidate = validateReconfigurePlanInternal(plan);
      if (!sameCanonical(candidate, confirmedPlan)) {
        fail("wakeflow-config-v3-reconfigure-plan", "config reconfigure plan differs from participant contract");
      }
      return { valid: true };
    },

    // normal apply 只接受 preview 起点；recovery 接受该事务的合法中间/尾部状态。
    deriveCurrentPlan({ context }) {
      if (context !== null) assertContext(workspaceRoot, context);
      const inspected = inspectReconfigureSourceInternal({
        workspaceRoot,
        desiredModel: target.desiredModel,
        expectedSourceModel: sourceModel,
      });
      // recovery 允许 durable plan 已经推进到 prepared/linked/committed；
      // normal apply 仍只能从 preview 时的 exact ready-update/current 出发。
      const recovery = context === null || context.recoveryGeneration > 0;
      const admitted = confirmedPlan.payload.disposition === "current"
        ? inspected.public.classification === "current"
        : recovery
          ? RECONFIGURE_RECOVERY_CLASSIFICATIONS.has(inspected.public.classification)
          : inspected.public.classification === "ready-update";
      if (!admitted) {
        fail("wakeflow-config-v3-reconfigure-stale", "config reconfigure source differs from confirmed plan", {
          details: { classification: inspected.public.classification },
        });
      }
      const committedCleanupTail = recovery
        && confirmedPlan.payload.disposition === "update"
        && inspected.public.classification === "current";
      if (
        (!committedCleanupTail
          && inspected.public.sourceFileIdentityDigest !== confirmedPlan.payload.sourceFileIdentityDigest)
        || (!recovery
          && inspected.public.inspectionDigest !== confirmedPlan.payload.sourceInspectionDigest)
      ) {
        fail("wakeflow-config-v3-reconfigure-stale", "config reconfigure source identity changed since confirmation");
      }
      return confirmedPlan;
    },

    // update 提交到新 target 后生成 closure；current disposition 无需 terminal effect。
    deriveTerminalClosure: confirmedPlan.payload.disposition === "current"
      ? undefined
      : ({ context, plan, planDigest }) => {
          assertContext(workspaceRoot, context);
          if (!sameCanonical(plan, confirmedPlan) || planDigest !== canonicalJsonDigest(confirmedPlan)) {
            fail("wakeflow-config-v3-reconfigure-plan", "terminal closure received a different config plan");
          }
          const inspected = inspectReconfigureSourceInternal({
            workspaceRoot,
            desiredModel: target.desiredModel,
            expectedSourceModel: sourceModel,
          });
          if (!new Set(["current", "committed-predecessor-residue"]).has(inspected.public.classification)) {
            fail("wakeflow-config-v3-reconfigure-terminal", "config update has not reached its committed target");
          }
          const closure = {
            kind: "WakeflowConfigV3ReconfigureOwnerClosure",
            schemaVersion: 1,
            programId: target.desiredModel.program.programId,
            sourceModelDigest: confirmedPlan.payload.sourceModelDigest,
            modelDigest: target.modelDigest,
            configBytesDigest: target.configBytesDigest,
          };
          return {
            planDigest,
            closureDigests: [{
              name: "config-v3-reconfigure-owner-closure",
              digest: canonicalJsonDigest(closure),
            }],
          };
        },

    stepHandlers: Object.freeze(stepHandlers),
  });
}
