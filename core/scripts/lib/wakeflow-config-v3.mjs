import { readFileSync } from "node:fs";
import path from "node:path";

import { canonicalJsonDigest } from "./wakeflow-canonical-json.mjs";
import {
  assertWakeflowId,
  assertWakeflowRef,
  createWakeflowIdIndex,
} from "./wakeflow-identifiers.mjs";

/**
 * Wakeflow v3 跟踪配置的规范化运行时解析器与只读领域模型。
 *
 * 公共 JSON Schema 描述持久化结构；本模块补充实体引用、基数和职责关系等
 * 跨字段约束，并返回深冻结模型。它不负责发现工作区、读取旧版覆盖配置、
 * 迁移历史格式或推断宿主实时状态；这些职责分别属于快照/布局、迁移和宿主服务。
 *
 * 阅读导航：
 * 1. objectAt / arrayAt 等方法闭合普通数据、精确字段与基础值合同；
 * 2. normalizeProgram / normalizeTopology 闭合稳定身份、引用、角色和基数；
 * 3. normalizeStorage / normalizeGovernance / normalizeHosts 分别解释三个职责分区；
 * 4. parse/read/serialize/digest 四个入口区分内存模型、便利读取、持久字节和语义身份；
 * 5. buildWakeflowConfigV3Indexes / explainWakeflowConfigV3 只生成只读派生视图。
 */
export const WAKEFLOW_CONFIG_V3_SCHEMA_ID = "https://raw.githubusercontent.com/GxFn/Wakeflow/main/core/schemas/wakeflow-config.schema.json";
export const WAKEFLOW_CONFIG_V3_KIND = "WakeflowConfig";
export const WAKEFLOW_CONFIG_V3_VERSION = 3;

// 这两个目录名是 Wakeflow 协议固定根，不是可由项目配置改写的 storage 字段；
// storage 只负责声明 ledger 的放置位置。
export const WAKEFLOW_ACTIVE_ROOT = ".wakeflow-active";
export const WAKEFLOW_LOCAL_ROOT = ".wakeflow-local";

// 这里只接受 v3 公共合同中的封闭词汇，不把旧字段、宿主别名或历史默认值悄悄映射成
// 新配置；兼容性识别与转换必须留在显式迁移链路中。
const INSTRUCTION_MANAGEMENT = new Set(["owner-managed", "managed-block"]);
const INTERFACE_LANGUAGES = new Set(["auto", "en", "zh"]);
const WINDOW_ROLES = new Set(["controller", "design", "test", "product"]);
const SUPPORT_CAPABILITIES = new Set(["design", "test"]);
const OWNERSHIP_VALUES = new Set(["wakeflow-managed", "external-owned"]);
const HOST_ID_ORDER = ["codex", "claude-code"];
const HOST_IDS = new Set(HOST_ID_ORDER);
const ROLE_OVERRIDE_KEYS = ["controller", "design", "test", "product", "default"];
const REASONING_EFFORTS = new Set(["medium", "high", "xhigh", "max"]);
const CLAUDE_PERMISSION_MODES = new Set(["acceptEdits", "bypassPermissions"]);
const MAX_PRESERVED_REVIEW_AFTER_DAYS = 36_500;
const MAX_CLAUDE_TMUX_NAME_LENGTH = 128;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/u;
const CLAUDE_TMUX_SOCKET_NAME_RE = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,128}$/u;
const EMPTY_OBJECT = Object.freeze({});
const validatedModels = new WeakSet();
const indexCache = new WeakMap();

// ==================== 一、严格普通数据合同 ====================

/**
 * 配置错误同时携带稳定错误码和 JSON Pointer 路径。message 用于人工诊断，调用方
 * 应依据 code/path 做机器判断，不能解析英文消息来恢复或降级配置。
 */
export class WakeflowConfigV3Error extends Error {
  constructor(code, message, { path = "$", details = {} } = {}) {
    super(message);
    this.name = "WakeflowConfigV3Error";
    this.code = code;
    this.path = path;
    this.details = details;
  }
}

// 使用稳定 code 与 JSON Pointer 中止解析；message 只供人工诊断。
function fail(code, at, message, details = {}) {
  throw new WakeflowConfigV3Error(code, `${message} at ${at}`, { path: at, details });
}

// 只接受 JSON 可表达的普通对象，不把数组或类实例当成配置分区。
function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// 校验对象类型、封闭字段集与必填字段，返回值仍由具体分区方法继续规范化。
function objectAt(value, at, {
  allowed,
  required = [],
  code = "wakeflow-config-v3-unknown-field",
} = {}) {
  if (!isPlainObject(value)) {
    fail("wakeflow-config-v3-type", at, "expected an object", { actualType: Array.isArray(value) ? "array" : typeof value });
  }
  const keys = Object.keys(value);
  if (allowed) {
    const allowedSet = new Set(allowed);
    const unknown = keys.find((key) => !allowedSet.has(key));
    if (unknown) fail(code, `${at}/${unknown}`, `unknown field ${unknown}`, { allowed });
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail("wakeflow-config-v3-required", `${at}/${key}`, `missing required field ${key}`);
    }
  }
  return value;
}

// 校验数组基数和稠密性，保证解析后的模型可以按同一 JSON 合同重新序列化。
function arrayAt(value, at, { min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min) {
    fail("wakeflow-config-v3-type", at, `expected an array with at least ${min} item(s)`, {
      actualType: Array.isArray(value) ? "array" : typeof value,
      minimum: min,
    });
  }
  // JSON 会把稀疏槽序列化为 null；若在这里接纳，解析成功的模型将无法按同一合同重新读取。
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      fail("wakeflow-config-v3-type", `${at}/${index}`, "expected a dense array without missing items", {
        index,
      });
    }
  }
  return value;
}

// 校验无首尾空白的非空文本，调用点负责选择更具体的领域错误码。
function nonEmptyString(value, at, code = "wakeflow-config-v3-value") {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    fail(code, at, "expected a non-empty string without leading or trailing whitespace");
  }
  return value;
}

// tmux session 是可展示的容器名，允许普通Unicode文本；但它随后会成为宿主命令参数，
// 因此必须在任何host effect之前闭合长度和控制字符边界。
function claudeTmuxSessionName(value, at) {
  const candidate = nonEmptyString(value, at, "wakeflow-config-v3-host");
  if ([...candidate].length > MAX_CLAUDE_TMUX_NAME_LENGTH || CONTROL_RE.test(candidate)) {
    fail(
      "wakeflow-config-v3-host",
      at,
      `expected a control-free tmux session name of at most ${MAX_CLAUDE_TMUX_NAME_LENGTH} characters`,
    );
  }
  return candidate;
}

// socketName会直接传给tmux -L；它与Claude locator采用同一个封闭词法合同，避免
// config先被接纳、物理窗口创建后才在locator提交阶段失败并留下恢复残留。
function claudeTmuxSocketName(value, at) {
  if (typeof value !== "string" || !CLAUDE_TMUX_SOCKET_NAME_RE.test(value)) {
    fail("wakeflow-config-v3-host", at, "expected one safe tmux socket name");
  }
  return value;
}

// 从调用点给出的闭合集合中选择一个值，并保留 allowed 诊断信息。
function enumValue(value, allowed, at, code = "wakeflow-config-v3-value") {
  if (!allowed.has(value)) {
    fail(code, at, `expected one of ${[...allowed].join(", ")}`, { value, allowed: [...allowed] });
  }
  return value;
}

// 可选说明不存在时保持缺失，存在时仍服从严格非空文本合同。
function optionalDescription(value, at) {
  return value === undefined ? undefined : nonEmptyString(value, at);
}

// 这里只校验不依赖工作区的可移植词法形式；realpath、根目录别名和目录重叠
// 需要文件系统上下文，由配置快照与布局层负责。
function canonicalRelativePath(value, at, { childOnly = false } = {}) {
  const candidate = nonEmptyString(value, at, "wakeflow-config-v3-path");
  if (
    candidate.includes("\\")
    || candidate.includes("\0")
    || /[\r\n]/u.test(candidate)
    || candidate.endsWith("/")
    || path.posix.isAbsolute(candidate)
    || /^[A-Za-z]:/u.test(candidate)
  ) {
    fail("wakeflow-config-v3-path", at, "expected a portable relative path", { value: candidate });
  }
  const normalized = path.posix.normalize(candidate);
  const onlyParentSegments = normalized.split("/").every((segment) => segment === "..");
  if (normalized !== candidate || normalized === "." || onlyParentSegments) {
    fail("wakeflow-config-v3-path", at, "path must already be in canonical relative form", {
      value: candidate,
      normalized,
    });
  }
  if (childOnly && (normalized === "." || normalized === ".." || normalized.startsWith("../"))) {
    fail("wakeflow-config-v3-path", at, "path must stay below its owning repository", { value: candidate });
  }
  return candidate;
}

// ==================== 二、Program 与 Topology 领域模型 ====================

// program 分区把机器身份与人类展示信息分开：programId 是跨配置、ledger 和运行记录
// 关联同一程序的稳定身份；displayName/description 只负责展示，不能替代身份引用。
function normalizeProgram(value) {
  const at = "$/program";
  objectAt(value, at, {
    allowed: ["programId", "displayName", "description", "interfaceLanguage"],
    required: ["programId", "displayName", "interfaceLanguage"],
  });
  const description = optionalDescription(value.description, `${at}/description`);
  return {
    programId: assertWakeflowId(value.programId, "program", `${at}/programId`),
    displayName: nonEmptyString(value.displayName, `${at}/displayName`),
    ...(description === undefined ? {} : { description }),
    interfaceLanguage: enumValue(value.interfaceLanguage, INTERFACE_LANGUAGES, `${at}/interfaceLanguage`),
  };
}

// residue exception 是 repository 内部一个精确子路径及其责任说明，不是 glob，也不会
// 放宽 workspace 协议根、符号链接或真实路径边界。
function normalizeResidueException(value, at) {
  objectAt(value, at, { allowed: ["path", "reason"], required: ["path", "reason"] });
  return {
    path: canonicalRelativePath(value.path, `${at}/path`, { childOnly: true }),
    reason: nonEmptyString(value.reason, `${at}/reason`),
  };
}

// 规范化 repository 的 residueExceptions，并拒绝同一路径重复放宽验证意图。
function normalizeRepositoryValidation(value, at) {
  objectAt(value, at, { allowed: ["residueExceptions"], required: ["residueExceptions"] });
  const seen = new Set();
  const residueExceptions = arrayAt(value.residueExceptions, `${at}/residueExceptions`).map((entry, index) => {
    const normalized = normalizeResidueException(entry, `${at}/residueExceptions/${index}`);
    if (seen.has(normalized.path)) {
      fail("wakeflow-config-v3-topology", `${at}/residueExceptions/${index}/path`, "duplicate repository residue exception", {
        path: normalized.path,
      });
    }
    seen.add(normalized.path);
    return normalized;
  });
  return { residueExceptions };
}

// repository.path 是相对 workspace 的可移植逻辑放置，可用规范化 ../ 指向命名兄弟目录；
// 这里不访问文件系统，目录存在性、别名、重叠和 realpath 逃逸由 snapshot/layout 验证。
function normalizeRepository(value, index) {
  const at = `$/topology/repositories/${index}`;
  objectAt(value, at, {
    allowed: ["repositoryId", "path", "displayName", "description", "instructionManagement", "validation"],
    required: ["repositoryId", "path", "displayName", "instructionManagement"],
  });
  const description = optionalDescription(value.description, `${at}/description`);
  const validation = value.validation === undefined
    ? undefined
    : normalizeRepositoryValidation(value.validation, `${at}/validation`);
  return {
    repositoryId: assertWakeflowId(value.repositoryId, "repository", `${at}/repositoryId`),
    path: canonicalRelativePath(value.path, `${at}/path`),
    displayName: nonEmptyString(value.displayName, `${at}/displayName`),
    ...(description === undefined ? {} : { description }),
    instructionManagement: enumValue(
      value.instructionManagement,
      INSTRUCTION_MANAGEMENT,
      `${at}/instructionManagement`,
      "wakeflow-config-v3-ownership",
    ),
    ...(validation === undefined ? {} : { validation }),
  };
}

// ownership 是 support surface 的职责判别器：Wakeflow 管理的 surface 由 Wakeflow
// 完整生成，因此禁止再声明 instructionManagement；外部 surface 不接管整体内容，
// 必须显式说明仅有的 instruction 管理方式。
function normalizeSupportSurface(value, index) {
  const at = `$/topology/supportSurfaces/${index}`;
  objectAt(value, at, {
    allowed: ["surfaceId", "capability", "path", "displayName", "description", "ownership", "instructionManagement"],
    required: ["surfaceId", "capability", "path", "displayName", "ownership"],
  });
  const ownership = enumValue(value.ownership, OWNERSHIP_VALUES, `${at}/ownership`, "wakeflow-config-v3-ownership");
  if (ownership === "wakeflow-managed" && Object.hasOwn(value, "instructionManagement")) {
    fail(
      "wakeflow-config-v3-ownership",
      `${at}/instructionManagement`,
      "wakeflow-managed support surfaces own their whole generated memory and forbid instructionManagement",
    );
  }
  if (ownership === "external-owned" && !Object.hasOwn(value, "instructionManagement")) {
    fail(
      "wakeflow-config-v3-ownership",
      `${at}/instructionManagement`,
      "external-owned support surfaces require an explicit instructionManagement policy",
    );
  }
  const description = optionalDescription(value.description, `${at}/description`);
  return {
    surfaceId: assertWakeflowId(value.surfaceId, "surface", `${at}/surfaceId`),
    capability: enumValue(value.capability, SUPPORT_CAPABILITIES, `${at}/capability`),
    path: canonicalRelativePath(value.path, `${at}/path`),
    displayName: nonEmptyString(value.displayName, `${at}/displayName`),
    ...(description === undefined ? {} : { description }),
    ownership,
    ...(ownership === "external-owned"
      ? {
          instructionManagement: enumValue(
            value.instructionManagement,
            INSTRUCTION_MANAGEMENT,
            `${at}/instructionManagement`,
            "wakeflow-config-v3-ownership",
          ),
        }
      : {}),
  };
}

// window root 只保存按角色约束的 typed reference，不复制物理路径或宿主 handle：
// Controller 归属 program，Design/Test 归属 support surface，Product 归属 repository。
function normalizeWindowRoot(value, role, at) {
  if (role === "controller") {
    objectAt(value, at, { allowed: ["kind"], required: ["kind"] });
    if (value.kind !== "program") fail("wakeflow-config-v3-topology", `${at}/kind`, "controller root must be program");
    return { kind: "program" };
  }
  if (role === "design" || role === "test") {
    objectAt(value, at, { allowed: ["kind", "surfaceId"], required: ["kind", "surfaceId"] });
    if (value.kind !== "support-surface") {
      fail("wakeflow-config-v3-topology", `${at}/kind`, `${role} root must be support-surface`);
    }
    return {
      kind: "support-surface",
      surfaceId: assertWakeflowId(value.surfaceId, "surface", `${at}/surfaceId`),
    };
  }
  objectAt(value, at, { allowed: ["kind", "repositoryId"], required: ["kind", "repositoryId"] });
  if (value.kind !== "repository") fail("wakeflow-config-v3-topology", `${at}/kind`, "product root must be repository");
  return {
    kind: "repository",
    repositoryId: assertWakeflowId(value.repositoryId, "repository", `${at}/repositoryId`),
  };
}

// 配置中的 window 是稳定的逻辑职责窗口，不是某次 Codex thread、Claude pane 或
// session locator；真实宿主绑定属于 .wakeflow-local 的 host-local runtime authority。
function normalizeWindow(value, index) {
  const at = `$/topology/windows/${index}`;
  objectAt(value, at, {
    allowed: ["windowId", "role", "displayName", "description", "root"],
    required: ["windowId", "role", "displayName", "root"],
  });
  const role = enumValue(value.role, WINDOW_ROLES, `${at}/role`, "wakeflow-config-v3-cardinality");
  const description = optionalDescription(value.description, `${at}/description`);
  return {
    windowId: assertWakeflowId(value.windowId, "window", `${at}/windowId`),
    role,
    displayName: nonEmptyString(value.displayName, `${at}/displayName`),
    ...(description === undefined ? {} : { description }),
    root: normalizeWindowRoot(value.root, role, `${at}/root`),
  };
}

// topology 在完成单实体规范化后集中验证 JSON Schema 无法独立闭合的关系：全局 typed
// ID、窗口 root 引用、support capability 与角色匹配，以及协议要求的窗口基数。
function normalizeTopology(value, program) {
  const at = "$/topology";
  objectAt(value, at, {
    allowed: ["repositories", "supportSurfaces", "windows"],
    required: ["repositories", "supportSurfaces", "windows"],
  });
  const repositories = arrayAt(value.repositories, `${at}/repositories`, { min: 1 }).map(normalizeRepository);
  const supportSurfaces = arrayAt(value.supportSurfaces, `${at}/supportSurfaces`, { min: 2 }).map(normalizeSupportSurface);
  const windows = arrayAt(value.windows, `${at}/windows`, { min: 4 }).map(normalizeWindow);
  const surfaceCapabilityCounts = new Map([...SUPPORT_CAPABILITIES].map((capability) => [capability, 0]));
  for (const surface of supportSurfaces) {
    surfaceCapabilityCounts.set(surface.capability, surfaceCapabilityCounts.get(surface.capability) + 1);
  }
  for (const capability of SUPPORT_CAPABILITIES) {
    if (surfaceCapabilityCounts.get(capability) !== 1) {
      fail(
        "wakeflow-config-v3-cardinality",
        `${at}/supportSurfaces`,
        `topology requires exactly one ${capability} support surface`,
        { capability, count: surfaceCapabilityCounts.get(capability) },
      );
    }
  }
  const idIndex = createWakeflowIdIndex([
    { id: program.programId, type: "program", path: "$/program/programId", value: program },
    ...repositories.map((entry, index) => ({
      id: entry.repositoryId,
      type: "repository",
      path: `${at}/repositories/${index}/repositoryId`,
      value: entry,
    })),
    ...supportSurfaces.map((entry, index) => ({
      id: entry.surfaceId,
      type: "surface",
      path: `${at}/supportSurfaces/${index}/surfaceId`,
      value: entry,
    })),
    ...windows.map((entry, index) => ({
      id: entry.windowId,
      type: "window",
      path: `${at}/windows/${index}/windowId`,
      value: entry,
    })),
  ]);

  const roleCounts = new Map([...WINDOW_ROLES].map((role) => [role, 0]));
  const repositoryWindowCounts = new Map(repositories.map((entry) => [entry.repositoryId, 0]));
  for (let index = 0; index < windows.length; index += 1) {
    const window = windows[index];
    roleCounts.set(window.role, roleCounts.get(window.role) + 1);
    if (window.role === "design" || window.role === "test") {
      const surface = assertWakeflowRef(
        window.root.surfaceId,
        "surface",
        idIndex,
        `${at}/windows/${index}/root/surfaceId`,
      );
      if (surface.capability !== window.role) {
        fail(
          "wakeflow-config-v3-topology",
          `${at}/windows/${index}/root/surfaceId`,
          `${window.role} window must reference a ${window.role} support surface`,
          { surfaceCapability: surface.capability },
        );
      }
    } else if (window.role === "product") {
      assertWakeflowRef(
        window.root.repositoryId,
        "repository",
        idIndex,
        `${at}/windows/${index}/root/repositoryId`,
      );
      repositoryWindowCounts.set(
        window.root.repositoryId,
        repositoryWindowCounts.get(window.root.repositoryId) + 1,
      );
    }
  }

  // Controller、Design、Test 是 program 级单例；Product 可以按 repository 拆成多个
  // 逻辑窗口，但每个已声明 repository 至少要有一个 Product 窗口承担责任。
  for (const role of ["controller", "design", "test"]) {
    if (roleCounts.get(role) !== 1) {
      fail(
        "wakeflow-config-v3-cardinality",
        `${at}/windows`,
        `topology requires exactly one ${role} window`,
        { role, count: roleCounts.get(role) },
      );
    }
  }
  for (const [repositoryId, count] of repositoryWindowCounts) {
    if (count === 0) {
      fail(
        "wakeflow-config-v3-topology",
        `${at}/repositories`,
        `repository ${repositoryId} must be referenced by at least one product window`,
        { repositoryId },
      );
    }
  }
  return { repositories, supportSurfaces, windows };
}

// ==================== 三、Storage、Governance 与 Hosts 分区 ====================

// storage 只允许选择 ledger 的 durable placement；active/local 根及其叶子结构仍是
// 代码协议常量。这里返回相对引用，绝对路径解析和放置安全由 snapshot/layout 负责。
function normalizeStorage(value) {
  const at = "$/storage";
  objectAt(value, at, { allowed: ["ledgerRoot"], required: ["ledgerRoot"] });
  return {
    ledgerRoot: canonicalRelativePath(value.ledgerRoot, `${at}/ledgerRoot`),
  };
}

// runtime residue matcher 是持久化的验证意图，不是当前进程观测。regex 在此只验证为
// ECMAScript Unicode 正则源；扫描命令、PID 和匹配结果不得写回配置。
function normalizeRuntimeMatcher(value, at) {
  objectAt(value, at, { allowed: ["kind", "value"], required: ["kind", "value"] });
  const kind = enumValue(value.kind, new Set(["substring", "regex"]), `${at}/kind`);
  const matcherValue = nonEmptyString(value.value, `${at}/value`);
  if (kind === "regex") {
    try {
      new RegExp(matcherValue, "u");
    } catch (cause) {
      fail("wakeflow-config-v3-value", `${at}/value`, "invalid regular expression", { cause: cause.message });
    }
  }
  return { kind, value: matcherValue };
}

// governance 保存跨运行仍然成立的审计/验证策略，不保存 demand、lease、delivery 或
// 当前宿主状态。preservedReviewAfterDays 只定义复查期限，本身不授予自动删除权限；
// audit缺失表示没有配置preservation review policy，相关owner必须fail closed而非补默认值。
function normalizeGovernance(value) {
  const at = "$/governance";
  objectAt(value, at, { allowed: ["audit", "validation"] });
  let audit;
  if (value.audit !== undefined) {
    objectAt(value.audit, `${at}/audit`, {
      allowed: ["preservedReviewAfterDays"],
      required: ["preservedReviewAfterDays"],
    });
    const days = value.audit.preservedReviewAfterDays;
    if (
      !Number.isSafeInteger(days)
      || days < 1
      || days > MAX_PRESERVED_REVIEW_AFTER_DAYS
    ) {
      fail(
        "wakeflow-config-v3-value",
        `${at}/audit/preservedReviewAfterDays`,
        `expected an integer from 1 through ${MAX_PRESERVED_REVIEW_AFTER_DAYS}`,
      );
    }
    audit = { preservedReviewAfterDays: days };
  }
  let validation;
  if (value.validation !== undefined) {
    objectAt(value.validation, `${at}/validation`, {
      allowed: ["runtimeResidue"],
      required: ["runtimeResidue"],
    });
    const runtimeAt = `${at}/validation/runtimeResidue`;
    const runtime = objectAt(value.validation.runtimeResidue, runtimeAt, {
      allowed: ["label", "matchers"],
      required: ["label", "matchers"],
    });
    validation = {
      runtimeResidue: {
        label: nonEmptyString(runtime.label, `${runtimeAt}/label`),
        matchers: arrayAt(runtime.matchers, `${runtimeAt}/matchers`, { min: 1 })
          .map((entry, index) => normalizeRuntimeMatcher(entry, `${runtimeAt}/matchers/${index}`)),
      },
    };
  }
  return {
    ...(audit === undefined ? {} : { audit }),
    ...(validation === undefined ? {} : { validation }),
  };
}

// role map 只规范化显式偏好表；role 与 default 的继承/选择由后续宿主能力层解释，
// parser 不在这里注入某台机器当前可用的模型或推理强度。
function normalizeRoleMap(value, at, { effort = false } = {}) {
  objectAt(value, at, { allowed: ROLE_OVERRIDE_KEYS, code: "wakeflow-config-v3-host" });
  return Object.fromEntries(
    ROLE_OVERRIDE_KEYS
      .filter((role) => Object.hasOwn(value, role))
      .map((role) => [
        role,
        effort
          ? enumValue(value[role], REASONING_EFFORTS, `${at}/${role}`, "wakeflow-config-v3-host")
          : nonEmptyString(value[role], `${at}/${role}`, "wakeflow-config-v3-host"),
      ]),
  );
}

// 规范化 durable launch 偏好；是否采用默认值及如何映射真实宿主调用由 host owner 决定。
function normalizeLaunch(value, at, { claude = false } = {}) {
  const allowed = claude
    ? ["modelByRole", "reasoningEffortByRole", "permissionMode"]
    : ["modelByRole", "reasoningEffortByRole"];
  objectAt(value, at, { allowed, code: "wakeflow-config-v3-host" });
  return {
    ...(value.modelByRole === undefined
      ? {}
      : { modelByRole: normalizeRoleMap(value.modelByRole, `${at}/modelByRole`) }),
    ...(value.reasoningEffortByRole === undefined
      ? {}
      : {
          reasoningEffortByRole: normalizeRoleMap(
            value.reasoningEffortByRole,
            `${at}/reasoningEffortByRole`,
            { effort: true },
          ),
        }),
    ...(value.permissionMode === undefined
      ? {}
      : {
          permissionMode: enumValue(
            value.permissionMode,
            CLAUDE_PERMISSION_MODES,
            `${at}/permissionMode`,
            "wakeflow-config-v3-host",
          ),
        }),
  };
}

// hosts 分区只表达 durable launch/container 偏好。字段缺失表示交给受测 host profile
// 选择默认值，不表示宿主被禁用、窗口已注册或目标会话当前存活。
function normalizeHost(value, hostId) {
  const at = `$/hosts/${hostId}`;
  const claude = hostId === "claude-code";
  objectAt(value, at, {
    allowed: claude ? ["launch", "tmux"] : ["launch"],
    code: "wakeflow-config-v3-host",
  });
  let tmux;
  if (claude && value.tmux !== undefined) {
    objectAt(value.tmux, `${at}/tmux`, {
      allowed: ["sessionName", "socketName"],
      code: "wakeflow-config-v3-host",
    });
    // 这里只保存并预校验期望的Claude tmux容器名称；真实socket/session/window/pane
    // locator是host-local运行事实，不能进入tracked config。
    tmux = {
      ...(value.tmux.sessionName === undefined
        ? {}
        : { sessionName: claudeTmuxSessionName(value.tmux.sessionName, `${at}/tmux/sessionName`) }),
      ...(value.tmux.socketName === undefined
        ? {}
        : { socketName: claudeTmuxSocketName(value.tmux.socketName, `${at}/tmux/socketName`) }),
    };
  }
  return {
    ...(value.launch === undefined ? {} : { launch: normalizeLaunch(value.launch, `${at}/launch`, { claude }) }),
    ...(tmux === undefined ? {} : { tmux }),
  };
}

// 按协议宿主顺序规范化可选 hosts 分区，不推断未声明宿主的 live 状态。
function normalizeHosts(value) {
  const at = "$/hosts";
  objectAt(value, at, { allowed: [...HOST_IDS], code: "wakeflow-config-v3-host" });
  return Object.fromEntries(
    HOST_ID_ORDER
      .filter((hostId) => Object.hasOwn(value, hostId))
      .map((hostId) => [hostId, normalizeHost(value[hostId], hostId)]),
  );
}

// ==================== 四、模型冻结、解析与语义身份 ====================

// deepFreeze 只冻结本次规范化产生的普通数据树。两个 Weak 容器按对象身份复用已验证
// 模型和派生索引，不缓存文件内容，也不形成“当前 workspace 配置”的全局 authority。
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

// 已由本模块签发的模型直接复用；其他值必须重新经过完整 strict parser。
function asValidatedModel(value) {
  return validatedModels.has(value) ? value : parseWakeflowConfigV3(value);
}

/**
 * 把一个内存 JSON 值构造成严格、深冻结的 v3 领域模型。
 *
 * 除逐字段类型检查外，这个入口还闭合 typed reference、角色能力和基数关系，并按固定
 * 字段顺序重建模型。它不读取磁盘、不验证物理 placement，也不执行迁移或宿主探测。
 */
export function parseWakeflowConfigV3(value) {
  const root = objectAt(value, "$", {
    allowed: ["$schema", "kind", "schemaVersion", "program", "topology", "storage", "governance", "hosts"],
    required: ["$schema", "kind", "schemaVersion", "program", "topology", "storage", "governance", "hosts"],
  });
  if (root.$schema !== WAKEFLOW_CONFIG_V3_SCHEMA_ID) {
    fail("wakeflow-config-v3-schema", "$/\u0024schema", `expected ${WAKEFLOW_CONFIG_V3_SCHEMA_ID}`, { value: root.$schema });
  }
  if (root.kind !== WAKEFLOW_CONFIG_V3_KIND) {
    fail("wakeflow-config-v3-kind", "$/kind", `expected ${WAKEFLOW_CONFIG_V3_KIND}`, { value: root.kind });
  }
  if (root.schemaVersion !== WAKEFLOW_CONFIG_V3_VERSION) {
    fail("wakeflow-config-v3-version", "$/schemaVersion", `expected ${WAKEFLOW_CONFIG_V3_VERSION}`, {
      value: root.schemaVersion,
    });
  }
  const program = normalizeProgram(root.program);
  const model = deepFreeze({
    $schema: WAKEFLOW_CONFIG_V3_SCHEMA_ID,
    kind: WAKEFLOW_CONFIG_V3_KIND,
    schemaVersion: WAKEFLOW_CONFIG_V3_VERSION,
    program,
    topology: normalizeTopology(root.topology, program),
    storage: normalizeStorage(root.storage),
    governance: normalizeGovernance(root.governance),
    hosts: normalizeHosts(root.hosts),
  });
  validatedModels.add(model);
  return model;
}

/**
 * 从调用方明确给出的文件读取并解析配置的便利入口。
 *
 * 它没有稳定读取、symlink/owner、并发变化和目录重叠保护；生产 workspace authority
 * 必须通过 wakeflow-config-v3-snapshot.mjs 加载，不能把本函数当作安全快照替代品。
 */
export function readWakeflowConfigV3(file) {
  if (typeof file !== "string" || !file.trim()) {
    fail("wakeflow-config-v3-source", "$file", "v3 config requires an exact file path");
  }
  const exactFile = path.resolve(file);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(exactFile, "utf8"));
  } catch (cause) {
    throw new WakeflowConfigV3Error(
      "wakeflow-config-v3-source",
      `cannot read exact v3 config: ${cause.message}`,
      { path: "$file", details: { causeCode: cause.code ?? null } },
    );
  }
  return parseWakeflowConfigV3(parsed);
}

// 持久化 writer 使用规范化模型的固定字段顺序、两空格缩进和单个末尾换行；这保证
// 相同模型获得稳定可审查字节，但它与下面用于语义身份的 canonical digest 是两种合同。
export function serializeWakeflowConfigV3(value) {
  return `${JSON.stringify(asValidatedModel(value), null, 2)}\n`;
}

// digest 基于 canonical JSON 的语义内容，不依赖调用方原对象的键顺序或格式化字节。
export function wakeflowConfigV3Digest(value) {
  return canonicalJsonDigest(asValidatedModel(value));
}

// ==================== 五、只读索引与来源说明 ====================

// 索引是冻结模型的只读派生视图，用于消除 consumer 重复扫描；它不访问文件系统，
// 不记录宿主 live 状态，也不能反向成为配置 authority。
export function buildWakeflowConfigV3Indexes(value) {
  const model = asValidatedModel(value);
  const cached = indexCache.get(model);
  if (cached) return cached;
  const repositoryById = Object.freeze(Object.fromEntries(
    model.topology.repositories.map((entry) => [entry.repositoryId, entry]),
  ));
  const surfaceById = Object.freeze(Object.fromEntries(
    model.topology.supportSurfaces.map((entry) => [entry.surfaceId, entry]),
  ));
  const windowById = Object.freeze(Object.fromEntries(
    model.topology.windows.map((entry) => [entry.windowId, entry]),
  ));
  const windowsByRepositoryMutable = Object.fromEntries(
    model.topology.repositories.map((entry) => [entry.repositoryId, []]),
  );
  for (const window of model.topology.windows) {
    if (window.role === "product") windowsByRepositoryMutable[window.root.repositoryId].push(window);
  }
  const windowsByRepositoryId = Object.freeze(Object.fromEntries(
    Object.entries(windowsByRepositoryMutable).map(([repositoryId, windows]) => [
      repositoryId,
      Object.freeze([...windows]),
    ]),
  ));
  const controllerWindow = model.topology.windows.find((entry) => entry.role === "controller");
  const designWindow = model.topology.windows.find((entry) => entry.role === "design");
  const testWindow = model.topology.windows.find((entry) => entry.role === "test");
  const indexes = Object.freeze({
    repositoryById,
    surfaceById,
    windowById,
    windowsByRepositoryId,
    controllerWindow,
    designWindow,
    testWindow,
    productWindows: Object.freeze(model.topology.windows.filter((entry) => entry.role === "product")),
    // 解析的是逻辑 owner 实体，而不是 cwd 或绝对路径；物理路径仍由 layout/snapshot 派生。
    resolveWindowRoot(windowId) {
      const window = windowById[windowId];
      if (!window) return null;
      if (window.root.kind === "program") return Object.freeze({ kind: "program", program: model.program });
      if (window.root.kind === "repository") {
        return Object.freeze({ kind: "repository", repository: repositoryById[window.root.repositoryId] });
      }
      return Object.freeze({ kind: "support-surface", surface: surfaceById[window.root.surfaceId] });
    },
    // 未配置宿主时返回共享冻结空对象，保留“继承 host profile”的语义。
    hostPreferences(hostId) {
      return model.hosts[hostId] ?? EMPTY_OBJECT;
    },
    ledgerPlacement() {
      return model.storage.ledgerRoot;
    },
  });
  indexCache.set(model, indexes);
  return indexes;
}

// explanation 是面向诊断/展示的来源说明：它标出 durable-input 与固定协议根，但不加入
// 文件存在性、宿主可用性或运行状态，因此不能作为初始化、发送或 mutation authority。
export function explainWakeflowConfigV3(value) {
  const model = asValidatedModel(value);
  const indexes = buildWakeflowConfigV3Indexes(model);
  return deepFreeze({
    kind: "WakeflowConfigV3Explanation",
    schemaVersion: WAKEFLOW_CONFIG_V3_VERSION,
    configDigest: wakeflowConfigV3Digest(model),
    program: {
      value: model.program,
      source: "durable-input",
    },
    topology: {
      source: "durable-input",
      repositories: model.topology.repositories.length,
      supportSurfaces: model.topology.supportSurfaces.length,
      windows: model.topology.windows.length,
      productWindows: indexes.productWindows.length,
    },
    storage: {
      ledgerRoot: {
        value: model.storage.ledgerRoot,
        source: "durable-input",
      },
    },
    governance: {
      value: model.governance,
      source: "durable-input",
    },
    hosts: Object.freeze(Object.fromEntries(Object.entries(model.hosts).map(([hostId, preferences]) => [
      hostId,
      { value: preferences, source: "durable-input" },
    ]))),
    fixedProtocolRoots: {
      active: WAKEFLOW_ACTIVE_ROOT,
      local: WAKEFLOW_LOCAL_ROOT,
    },
  });
}
