import { createHash } from "node:crypto";
import {
  lstatSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import { WAKEFLOW_PROTOCOL_HOST_IDS } from "./wakeflow-host-capability.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import { planWakeflowLocalLayout } from "./wakeflow-local-layout.mjs";
import { inspectPodEvidenceInventoryForLayout } from "./wakeflow-pod-service.mjs";
import { inspectKeepLiveInventoryForLayout } from "./wakeflow-keep-live-service.mjs";
import { inspectWindowBindingInventoryForLayout } from "./wakeflow-window-binding-service.mjs";
import { inspectWindowCoordinationLeaseInventoryForLayout } from "./wakeflow-window-lease-service.mjs";
import { inspectWindowRuntimeProjectionsForLayout } from "./wakeflow-window-runtime-projector.mjs";
import { inspectLocalPreservationInventoryForLayout } from "./wakeflow-preservation.mjs";
import { inspectTransportDemandForLayout } from "./wakeflow-transport-store.mjs";
import { inspectWakeflowWorkspaceMutation } from "./wakeflow-workspace-mutation.mjs";

const INSPECTION_KIND = "WakeflowLocalLayoutInspection";
const INSPECTION_SCHEMA_VERSION = 1;
const LOCAL_ROOT = ".wakeflow-local";
const HOST_ROOT = `${LOCAL_ROOT}/runtime/hosts`;
const MAX_INVENTORY_ENTRIES = 100_000;
const MAX_INVENTORY_DEPTH = 128;
const SAFE_VISIBLE_COMPONENT = /^[A-Za-z0-9._-]{1,128}$/u;
const SAFE_EVENT_COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const HOST_EVENT_INSPECTOR_NAMES = Object.freeze(["activityTemp", "locator"]);
const ISSUED_INSPECTIONS = new WeakSet();

const LEGACY_LOCAL_ROOTS = Object.freeze([
  ".wakeflow-local/README.md",
  ".wakeflow-local/preserved",
  ".wakeflow-local/wakeflow-delivery",
  ".wakeflow-local/wakeflow-statusline.mjs",
  ".wakeflow-local/wakeflow.config.json",
  ".wakeflow-local/workspace.config.json",
  ".wakeflow-local/worktrees",
  ".wakeflow-local/pod-reservations",
  ".wakeflow-local/preserved-state-roots",
  ".wakeflow-local/preserved-wakeflow-delivery",
  ".wakeflow-local/preserved-delivery-artifacts",
  ".wakeflow-local/runtime-quarantine",
  ".wakeflow-local/wakeflow-delivery-quarantine",
  ".wakeflow-local/wakeflow-intake",
]);

/**
 * `.wakeflow-local` 的只读诊断组合器。
 *
 * 阅读导航：
 * 1. `exactInput()` 与 `hostEventInspectorFacade()` 只接纳显式输入和宿主观察器接缝。
 * 2. `scanActualTree()` 递归观察真实节点，并把 T02 mutation 命名空间留给唯一 owner。
 * 3. `close*OwnerValidation()` 调用各领域已有检查器，不在本文件复制记录 parser。
 * 4. `inspectWakeflowLocalLayout()` 汇总诊断、blocker 与脱敏摘要，并签发进程内 inspection fact。
 *
 * 本文件不创建、修复或删除任何节点，也不把路径形状当成领域 authority。
 */

export class WakeflowLocalLayoutInspectionError extends Error {
  constructor(code, message, { errorPath = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowLocalLayoutInspectionError";
    this.code = code;
    this.path = errorPath;
    this.details = Object.freeze({ ...details });
  }
}

// inspection 的进程内签发身份与内容摘要是两层合同；调用方自算同一摘要也不能伪造签发事实。
export function assertWakeflowLocalLayoutInspection(value) {
  if (!isPlainObject(value) || !ISSUED_INSPECTIONS.has(value)) {
    fail(
      "wakeflow-local-inspection-authority",
      "inspection must be the exact immutable result issued by inspectWakeflowLocalLayout",
    );
  }
  return value;
}

function fail(code, message, { errorPath = "$", details = {}, cause } = {}) {
  throw new WakeflowLocalLayoutInspectionError(code, message, { errorPath, details, cause });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function countByClassification(items) {
  const counts = {};
  for (const item of items) {
    counts[item.classification] = (counts[item.classification] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => lexicalCompare(left, right)));
}

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactInput(value) {
  if (!isPlainObject(value)) fail("wakeflow-local-inspection-input", "inspection input must be a plain object");
  const expected = ["workspaceRoot", "model", "layoutDescriptor", "hostProfile"];
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expected.length
    || keys.some((key) => typeof key !== "string" || !expected.includes(key))
  ) {
    fail("wakeflow-local-inspection-input", "inspection input has an invalid field set", {
      details: { expected, actual: keys.map(String) },
    });
  }
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-local-inspection-input", `inspection input field ${key} must be an enumerable data property`);
    }
  }
  if (typeof value.workspaceRoot !== "string" || !value.workspaceRoot.trim()) {
    fail("wakeflow-local-inspection-input", "workspaceRoot is required");
  }
  return value;
}

// 宿主画像允许保留其他静态扩展，但本检查器只读取这两个 own data-property 函数。
function hostEventInspectorFacade(hostProfile) {
  if (!isPlainObject(hostProfile)) {
    fail("wakeflow-local-inspection-host-profile", "host profile must be a plain object facade");
  }
  const descriptor = Object.getOwnPropertyDescriptor(hostProfile, "localEventInspectors");
  if (descriptor === undefined) {
    return Object.freeze({ activityTemp: null, locator: null });
  }
  if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
    fail(
      "wakeflow-local-inspection-host-profile",
      "host localEventInspectors must be an enumerable data property",
    );
  }
  const facade = descriptor.value;
  if (!isPlainObject(facade)) {
    fail(
      "wakeflow-local-inspection-host-profile",
      "host localEventInspectors must be a plain object facade",
    );
  }
  const keys = Reflect.ownKeys(facade);
  if (keys.some((key) => typeof key !== "string" || !HOST_EVENT_INSPECTOR_NAMES.includes(key))) {
    fail(
      "wakeflow-local-inspection-host-profile",
      "host localEventInspectors contains an unsupported field",
      { details: { actual: keys.map(String), allowed: HOST_EVENT_INSPECTOR_NAMES } },
    );
  }
  const admitted = { activityTemp: null, locator: null };
  for (const key of keys) {
    const field = Object.getOwnPropertyDescriptor(facade, key);
    if (!field?.enumerable || !Object.hasOwn(field, "value") || typeof field.value !== "function") {
      fail(
        "wakeflow-local-inspection-host-profile",
        `host localEventInspectors.${key} must be an enumerable data-property function`,
      );
    }
    admitted[key] = field.value;
  }
  return Object.freeze(admitted);
}

// 宿主函数可以执行只读观察；其返回值必须先降为闭合纯数据，才可参与共享分类。
function hostOwnerInventorySnapshot(value, {
  code,
  label,
  programId,
  hostId,
  configDigest,
  statuses,
}) {
  let inventory;
  try {
    inventory = JSON.parse(canonicalJson(value));
  } catch (cause) {
    fail(code, `${label} must return canonical plain data`, { cause });
  }
  const expectedKeys = [
    "configDigest",
    "entries",
    "hostId",
    "issues",
    "kind",
    "programId",
    "schemaVersion",
    "status",
  ];
  if (
    !isPlainObject(inventory)
    || canonicalJson(Object.keys(inventory).sort(lexicalCompare)) !== canonicalJson(expectedKeys)
    || typeof inventory.kind !== "string"
    || inventory.kind.length === 0
    || inventory.schemaVersion !== 1
    || inventory.programId !== programId
    || inventory.hostId !== hostId
    || inventory.configDigest !== configDigest
    || !statuses.includes(inventory.status)
    || !Array.isArray(inventory.entries)
    || !Array.isArray(inventory.issues)
    || inventory.issues.some((issue) => typeof issue !== "string")
  ) {
    fail(code, `${label} returned an invalid inventory contract`);
  }
  const seenRefs = new Set();
  for (const entry of inventory.entries) {
    if (
      !isPlainObject(entry)
      || canonicalJson(Object.keys(entry).sort(lexicalCompare))
        !== canonicalJson(["digest", "kind", "ref", "status"])
      || typeof entry.ref !== "string"
      || path.posix.isAbsolute(entry.ref)
      || entry.ref.includes("\\")
      || path.posix.normalize(entry.ref) !== entry.ref
      || !entry.ref.startsWith(`${LOCAL_ROOT}/`)
      || typeof entry.kind !== "string"
      || typeof entry.status !== "string"
      || typeof entry.digest !== "string"
      || !DIGEST_PATTERN.test(entry.digest)
      || seenRefs.has(entry.ref)
    ) {
      fail(code, `${label} returned an invalid or duplicate inventory entry`);
    }
    seenRefs.add(entry.ref);
  }
  return inventory;
}

// 以下节点 helper 只描述一次 lstat 观察，不把节点存在性解释成领域记录有效性。
function currentEuid() {
  return typeof process.geteuid === "function" ? process.geteuid() : null;
}

function modeString(stat) {
  return `0${(stat.mode & 0o777).toString(8).padStart(3, "0")}`;
}

function actualType(stat) {
  if (stat.isSymbolicLink()) return "symlink";
  if (stat.isDirectory()) return "directory";
  if (stat.isFile()) return "file";
  return "other";
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameNodeSnapshot(left, right) {
  return sameIdentity(left, right)
    && actualType(left) === actualType(right)
    && left.uid === right.uid
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

// 对外路径显示按组件白名单决定明文或摘要，动态运行标识和异常名称默认不离开检查器。
function safePortableDisplay(ref) {
  const components = ref.split("/");
  if (components.every((component) => SAFE_VISIBLE_COMPONENT.test(component))) {
    return { path: ref, pathDigest: null };
  }
  return {
    path: null,
    pathDigest: `sha256:${createHash("sha256").update(ref, "utf8").digest("hex")}`,
  };
}

function redactedPortableDisplay(ref) {
  return {
    path: null,
    pathDigest: `sha256:${createHash("sha256").update(ref, "utf8").digest("hex")}`,
  };
}

function publicNode(ref, node) {
  return {
    ...safePortableDisplay(ref),
    type: node.type,
    mode: node.mode,
    owner: node.owner,
    linkCount: node.type === "file" ? node.linkCount : null,
  };
}

function makeBoundary(ref, classification, extra = {}) {
  return {
    ...([
      "inventory-limit",
      "unknown",
      "unreadable",
      "unstable",
    ].includes(classification) ? redactedPortableDisplay(ref) : safePortableDisplay(ref)),
    classification,
    ...extra,
  };
}

function legacyRootFor(ref) {
  return LEGACY_LOCAL_ROOTS.find((candidate) => ref === candidate || ref.startsWith(`${candidate}/`)) ?? null;
}

/**
 * 固定本次只读扫描的词法 workspace 根，并拒绝最终路径项为链接。
 * 这里不建立全局 workspace 身份，也不替 mutation gate 签发写入上下文。
 */
function inspectWorkspaceRoot(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  let stat;
  try {
    stat = lstatSync(root);
  } catch (cause) {
    fail("wakeflow-local-inspection-workspace", "cannot inspect workspace root", { cause });
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("wakeflow-local-inspection-workspace", "workspace root must be a real directory");
  }
  try {
    realpathSync(root);
  } catch (cause) {
    fail("wakeflow-local-inspection-workspace", "cannot resolve workspace root", { cause });
  }
  return { root, stat };
}

// 动态事件参数先按 durable ID 或安全组件词汇验证；未知语义参数保持 pending，交给 owner 闭合。
function typedId(value, type) {
  try {
    assertWakeflowId(value, type);
    return true;
  } catch {
    return false;
  }
}

function parameterVerdict(entry, name, value) {
  if (name === "windowId") return { valid: typedId(value, "window"), pending: false };
  if (name === "demandId") return { valid: typedId(value, "demand"), pending: false };
  if (name === "podId") return { valid: typedId(value, "pod"), pending: false };
  if (name === "preservationId") return { valid: typedId(value, "preservation"), pending: false };
  if (name === "automationRunId") {
    return { valid: typedId(value, "dispatch-group"), pending: false };
  }
  if (!SAFE_EVENT_COMPONENT.test(value)) return { valid: false, pending: false };
  return { valid: true, pending: true };
}

// T02 独占 lock、journal、claim、checkpoint 与 publisher residue 的解释权。
function mutationProtocolOwns(ref) {
  if (ref === `${LOCAL_ROOT}/runtime/maintenance.lock`) return true;
  if (ref.startsWith(`${LOCAL_ROOT}/runtime/.wakeflow-publish.`)) return true;
  const transactionRoot = `${LOCAL_ROOT}/runtime/maintenance/transactions`;
  return ref.startsWith(`${LOCAL_ROOT}/runtime/maintenance/`) && ref !== transactionRoot;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function compileSegmentTemplate(template) {
  const parameters = [];
  let source = "^";
  let offset = 0;
  const placeholder = /\{([^{}\/]+)\}/gu;
  for (const match of template.matchAll(placeholder)) {
    source += escapeRegex(template.slice(offset, match.index));
    source += "(.+?)";
    parameters.push(match[1]);
    offset = match.index + match[0].length;
  }
  source += escapeRegex(template.slice(offset));
  source += "$";
  return parameters.length === 0
    ? null
    : { pattern: new RegExp(source, "u"), parameters };
}

function compareSegment(entry, actual, template) {
  const dynamic = compileSegmentTemplate(template);
  if (!dynamic) {
    return {
      matched: actual === template,
      pending: false,
      invalidParameter: false,
      captures: {},
    };
  }
  const match = actual.match(dynamic.pattern);
  if (!match) {
    return { matched: false, pending: false, invalidParameter: false, captures: {} };
  }
  let pending = false;
  const captures = {};
  for (const [index, parameter] of dynamic.parameters.entries()) {
    const captured = match[index + 1];
    const verdict = parameterVerdict(entry, parameter, captured);
    if (!verdict.valid) {
      return {
        matched: false,
        pending: false,
        invalidParameter: true,
        parameter,
        captures: {},
      };
    }
    if (Object.hasOwn(captures, parameter) && captures[parameter] !== captured) {
      return {
        matched: false,
        pending: false,
        invalidParameter: true,
        parameter,
        captures: {},
      };
    }
    captures[parameter] = captured;
    pending ||= verdict.pending;
  }
  return { matched: true, pending, invalidParameter: false, captures };
}

function compareEventPath(entry, ref) {
  const actual = ref.split("/");
  const expected = entry.path.split("/");
  const comparable = Math.min(actual.length, expected.length);
  let pending = false;
  const captures = {};
  for (let index = 0; index < comparable; index += 1) {
    const verdict = compareSegment(entry, actual[index], expected[index]);
    if (!verdict.matched) {
      return {
        relation: null,
        pending: false,
        invalidParameter: verdict.invalidParameter,
        parameter: verdict.parameter ?? null,
        captures: {},
      };
    }
    Object.assign(captures, verdict.captures);
    pending ||= verdict.pending;
  }
  if (actual.length === expected.length) {
    return { relation: "exact", pending, invalidParameter: false, captures };
  }
  if (actual.length < expected.length) {
    return { relation: "ancestor", pending, invalidParameter: false, captures };
  }
  if (entry.allowDescendants === true) {
    return { relation: "descendant", pending, invalidParameter: false, captures };
  }
  return { relation: null, pending: false, invalidParameter: false, captures: {} };
}

/**
 * 把一个真实路径与全部 deferred pattern 比较，区分 exact、descendant 与结构祖先。
 * 匹配只产生候选关系；除 T02 外，具体记录仍必须经过相应 owner validator。
 */
function matchEventPath(ref, eventEntries) {
  const matches = [];
  const invalid = [];
  for (const entry of eventEntries) {
    const verdict = compareEventPath(entry, ref);
    if (verdict.relation) matches.push({ entry, ...verdict });
    else if (verdict.invalidParameter) invalid.push({ entry, parameter: verdict.parameter });
  }
  const exact = matches.filter((match) => match.relation === "exact");
  if (exact.length > 1) return { classification: "ambiguous", matches: exact };
  if (exact.length === 1) {
    const ownerValidationPending = exact[0].pending
      || !exact[0].entry.key.startsWith("event.maintenance.");
    return {
      classification: ownerValidationPending ? "owner-validator-pending" : "event-exact",
      matches: exact,
    };
  }
  const descendants = matches.filter((match) => match.relation === "descendant");
  if (descendants.length > 1) return { classification: "ambiguous", matches: descendants };
  if (descendants.length === 1) {
    return {
      classification: descendants[0].pending ? "owner-validator-pending" : "event-descendant",
      matches: descendants,
    };
  }
  const ancestors = matches.filter((match) => match.relation === "ancestor");
  if (ancestors.length > 0) {
    return {
      classification: ancestors.some((match) => match.pending)
        ? "owner-validator-pending"
        : "event-structural-parent",
      matches: ancestors,
    };
  }
  if (invalid.length > 0) return { classification: "invalid-parameter", matches: invalid };
  return null;
}

function expectedItem(item, partition, classification, node = null, extra = {}) {
  return {
    key: item.key,
    path: item.path,
    partition,
    owner: item.owner,
    authority: item.authority,
    lifecycle: item.lifecycle,
    mode: item.mode,
    classification,
    actual: node ? publicNode(item.path, node) : null,
    repairOwner: partition === "static-directory" ? "layout-manager" : item.owner,
    ...extra,
  };
}

/**
 * 将静态目录和 delegated 文件的物理形状归类。
 * layout manager 只拥有静态目录；delegated 文件即使 mode 正确也先保持 owner-validation 状态。
 */
function classifyExpected(item, partition, node, actualByRef) {
  if (!node) {
    let ancestor = path.posix.dirname(item.path);
    while (ancestor === LOCAL_ROOT || ancestor.startsWith(`${LOCAL_ROOT}/`)) {
      const ancestorNode = actualByRef.get(ancestor);
      if (ancestorNode && (ancestorNode.type !== "directory" || ancestorNode.unreadable || ancestorNode.unstable)) {
        return expectedItem(item, partition, "blocked-by-ancestor", null, { blockedBy: safePortableDisplay(ancestor) });
      }
      if (ancestor === LOCAL_ROOT) break;
      ancestor = path.posix.dirname(ancestor);
    }
    return expectedItem(
      item,
      partition,
      partition === "static-directory" ? "missing" : "delegated-missing",
    );
  }
  if (node.unreadable) return expectedItem(item, partition, "unreadable", node);
  if (node.unstable) return expectedItem(item, partition, "unstable", node);
  if (node.type === "symlink") return expectedItem(item, partition, "symlink", node);
  if (node.type !== item.pathKind) return expectedItem(item, partition, "wrong-type", node);
  if (node.owner !== true) return expectedItem(item, partition, "foreign-owner", node);
  if (node.mode !== item.mode) {
    if (partition !== "static-directory") return expectedItem(item, partition, "delegated-drift", node);
    const numeric = Number.parseInt(node.mode, 8);
    const safe = (numeric & 0o700) === 0o700 && (numeric & 0o022) === 0;
    return expectedItem(item, partition, safe ? "permission-drift" : "unsafe-mode", node);
  }
  if (item.pathKind === "file" && node.linkCount !== 1) {
    return expectedItem(item, partition, "delegated-drift", node);
  }
  return expectedItem(
    item,
    partition,
    partition === "static-directory" ? "current" : "delegated-current-shape",
    node,
  );
}

// 领域检查器共同负责内容与集合级约束；本文件只把其结论映射到统一 local 诊断词汇。
function closeIdentityOwnerValidation({
  workspace,
  plan,
  hostProfile,
  windowIds,
  candidates,
}) {
  if (candidates.length === 0) return;
  let inventory;
  try {
    inventory = inspectWindowBindingInventoryForLayout({
      workspaceRoot: workspace.root,
      programId: plan.programId,
      hostId: plan.host.hostId,
      configDigest: plan.configDigest,
      windowIds,
      hostProfile,
    });
  } catch (error) {
    const code = typeof error?.code === "string"
      ? error.code
      : "wakeflow-window-binding-validation-failed";
    for (const candidate of candidates) {
      candidate.event.classification = "owner-validator-invalid";
      candidate.event.ownerValidationCode = code;
    }
    return;
  }
  const byWindowId = new Map(inventory.bindings.map((binding) => [binding.windowId, binding]));
  for (const candidate of candidates) {
    const binding = byWindowId.get(candidate.windowId);
    if (!binding || candidate.node.unreadable || candidate.node.unstable) {
      candidate.event.classification = "owner-validator-invalid";
      candidate.event.ownerValidationCode = "wakeflow-window-binding-inventory";
      continue;
    }
    candidate.event.classification = "owner-validated";
    candidate.event.bindingId = binding.bindingId;
    candidate.event.identityBindingDigest = binding.identityBindingDigest;
  }
}

// lease owner 同时验证 config、窗口集合和每个 lease generation，路径命中本身不能通过。
function closeLeaseOwnerValidation({
  workspace,
  model,
  plan,
  hostProfile,
  candidates,
}) {
  if (candidates.length === 0) return;
  let inventory;
  try {
    inventory = inspectWindowCoordinationLeaseInventoryForLayout({
      workspaceRoot: workspace.root,
      model,
      configDigest: plan.configDigest,
      hostProfile,
    });
  } catch (error) {
    const code = typeof error?.code === "string"
      ? error.code
      : "wakeflow-window-lease-validation-failed";
    for (const candidate of candidates) {
      candidate.event.classification = "owner-validator-invalid";
      candidate.event.ownerValidationCode = code;
    }
    return;
  }
  const byWindowId = new Map(inventory.leases.map(({ lease }) => [lease.windowId, lease]));
  for (const candidate of candidates) {
    const lease = byWindowId.get(candidate.windowId);
    if (!lease || candidate.node.unreadable || candidate.node.unstable) {
      candidate.event.classification = "owner-validator-invalid";
      candidate.event.ownerValidationCode = "wakeflow-window-lease-inventory";
      continue;
    }
    candidate.event.classification = "owner-validated";
    candidate.event.leaseId = lease.leaseId;
    candidate.event.leaseDigest = lease.leaseDigest;
  }
}

function transportDemandIdFromEventMatch(eventMatch) {
  const demandIds = new Set(
    eventMatch.matches
      .filter((match) => match.entry.key.startsWith("event.transport."))
      .map((match) => match.captures?.demandId)
      .filter((value) => typeof value === "string"),
  );
  return demandIds.size === 1 ? [...demandIds][0] : null;
}

function podIdFromEventMatch(eventMatch) {
  const podIds = new Set(
    eventMatch.matches
      .filter((match) => match.entry.key.startsWith("event.pod."))
      .map((match) => match.captures?.podId)
      .filter((value) => typeof value === "string"),
  );
  return podIds.size === 1 ? [...podIds][0] : null;
}

// Pod evidence 必须由 Pod service 证明完整 immutable control prefix，未闭合前只可标记 stale。
function closePodOwnerValidation({ workspace, plan, candidates }) {
  if (candidates.length === 0) return;
  let inventory;
  try {
    inventory = inspectPodEvidenceInventoryForLayout({
      workspaceRoot: workspace.root,
      expectedProgramId: plan.programId,
      hostId: plan.host.hostId,
    });
  } catch (error) {
    const code = typeof error?.code === "string"
      ? error.code
      : "wakeflow-pod-layout-validation-failed";
    for (const candidate of candidates) {
      candidate.event.classification = "owner-validator-invalid";
      candidate.event.ownerValidationCode = code;
    }
    return;
  }

  const byPodId = new Map(inventory.pods.map((pod) => [pod.podId, pod]));
  for (const candidate of candidates) {
    const pod = byPodId.get(candidate.podId);
    if (
      !pod
      || !(candidate.ref === pod.rootRef || candidate.ref.startsWith(`${pod.rootRef}/`))
      || candidate.node.unreadable
      || candidate.node.unstable
    ) {
      candidate.event.classification = "owner-validator-invalid";
      candidate.event.ownerValidationCode = "wakeflow-pod-service-inventory";
      candidate.event.podInventoryDigest = inventory.inventoryDigest;
      continue;
    }
    candidate.event.podId = pod.podId;
    candidate.event.podInventoryDigest = inventory.inventoryDigest;
    if (pod.linkage === "structural-prefix") {
      candidate.event.classification = "owner-validator-stale";
      candidate.event.ownerValidationCode = "wakeflow-pod-service-evidence-prefix";
      continue;
    }
    if (pod.linkage !== "structural-current") {
      candidate.event.classification = "owner-validator-invalid";
      candidate.event.ownerValidationCode = inventory.issues.find((entry) => (
        entry.ref === pod.rootRef || entry.ref.startsWith(`${pod.rootRef}/`)
      ))?.code ?? "wakeflow-pod-service-inventory";
      continue;
    }
    candidate.event.classification = "owner-validated";
    const record = pod.records.find((entry) => entry.ref === candidate.ref);
    if (record) candidate.event.podRecordDigest = record.digest;
  }
}

// keep-live 的 process、control、lease 与 manager lock 由同一 owner inventory 联合判断。
function closeKeepLiveOwnerValidation({
  workspace,
  model,
  plan,
  hostProfile,
  candidates,
}) {
  if (candidates.length === 0) return;
  let inventory;
  try {
    inventory = inspectKeepLiveInventoryForLayout({
      workspaceRoot: workspace.root,
      model,
      configDigest: plan.configDigest,
      hostProfile,
    });
  } catch (error) {
    const code = typeof error?.code === "string"
      ? error.code
      : "wakeflow-keep-live-layout-validation-failed";
    for (const candidate of candidates) {
      candidate.event.classification = "owner-validator-invalid";
      candidate.event.ownerValidationCode = code;
    }
    return;
  }

  const tuples = new Map([
    ...inventory.leases.map((lease) => [lease.ref, {
      digest: lease.digest,
      automationRunId: lease.automationRunId,
      stale: inventory.issues.includes("lease-without-process"),
    }]),
    ...(inventory.process ? [[inventory.process.ref, {
      digest: inventory.process.digest,
      generationId: inventory.process.generationId,
      stale: ["missing", "identity-mismatch", "unverifiable"].includes(
        inventory.process.health,
      ),
    }]] : []),
    ...(inventory.control ? [[inventory.control.ref, {
      digest: inventory.control.digest,
      generationId: inventory.control.generationId,
      stale: inventory.issues.some((issue) => ["missing-control", "stale-control"].includes(issue)),
    }]] : []),
    ...(inventory.managerLock ? [[inventory.managerLock.ref, {
      digest: inventory.managerLock.digest,
      stale: inventory.managerLock.ownerHealth !== "same-live",
    }]] : []),
  ]);
  for (const candidate of candidates) {
    const tuple = tuples.get(candidate.ref);
    if (!tuple || candidate.node.unreadable || candidate.node.unstable) {
      candidate.event.classification = "owner-validator-invalid";
      candidate.event.ownerValidationCode = "wakeflow-keep-live-inventory";
      continue;
    }
    candidate.event.classification = tuple.stale
      ? "owner-validator-stale"
      : "owner-validated";
    candidate.event.recordDigest = tuple.digest;
    if (tuple.automationRunId) candidate.event.automationRunId = tuple.automationRunId;
    if (tuple.generationId) candidate.event.generationId = tuple.generationId;
  }
}

// 宿主 locator 是明确的只读扩展接缝；共享层只消费已准入函数和纯数据 inventory。
function closeHostLocatorOwnerValidation({
  workspace,
  model,
  plan,
  inspect,
  candidates,
}) {
  if (candidates.length === 0) return;
  if (typeof inspect !== "function") return;
  let inventory;
  try {
    inventory = hostOwnerInventorySnapshot(
      inspect({
        workspaceRoot: workspace.root,
        programId: model.program.programId,
        hostId: plan.host.hostId,
        configDigest: plan.configDigest,
        windowIds: model.topology.windows.map((window) => window.windowId),
      }),
      {
        code: "wakeflow-host-locator-inventory",
        label: "host locator inspector",
        programId: model.program.programId,
        hostId: plan.host.hostId,
        configDigest: plan.configDigest,
        statuses: ["current", "unsafe"],
      },
    );
  } catch (error) {
    const code = typeof error?.code === "string"
      ? error.code
      : "wakeflow-host-locator-validation-failed";
    for (const candidate of candidates) {
      candidate.event.classification = "owner-validator-invalid";
      candidate.event.ownerValidationCode = code;
    }
    return;
  }
  if (!inventory || !Array.isArray(inventory.entries)) {
    for (const candidate of candidates) {
      candidate.event.classification = "owner-validator-invalid";
      candidate.event.ownerValidationCode = "wakeflow-host-locator-inventory";
    }
    return;
  }
  const byRef = new Map(inventory.entries.map((entry) => [entry?.ref, entry]));
  for (const candidate of candidates) {
    const entry = byRef.get(candidate.ref);
    let current;
    try {
      current = lstatSync(path.join(workspace.root, ...candidate.ref.split("/")));
    } catch {
      current = null;
    }
    if (!entry || !current || !sameNodeSnapshot(candidate.node.stat, current)) {
      candidate.event.classification = "owner-validator-invalid";
      candidate.event.ownerValidationCode = "wakeflow-host-locator-inventory";
      continue;
    }
    if (entry.kind === "locator" && entry.status === "current") {
      candidate.event.classification = "owner-validated";
      candidate.event.locatorDigest = entry.digest;
      continue;
    }
    if (entry.kind === "operation-lock" && entry.status === "active") {
      candidate.event.classification = "owner-validated-active-operation";
      candidate.event.operationDigest = entry.digest;
      continue;
    }
    if (entry.kind === "operation-lock" && entry.status === "stale") {
      candidate.event.classification = "owner-validator-stale";
      candidate.event.operationDigest = entry.digest;
      continue;
    }
    candidate.event.classification = "owner-validator-invalid";
    candidate.event.ownerValidationCode = "wakeflow-host-locator-inventory";
  }
}

// activity/temp 共享一个宿主 inventory，但 active operation、stale residue 与 current fact 保持不同分类。
function closeHostActivityTempOwnerValidation({
  workspace,
  model,
  plan,
  inspect,
  candidates,
}) {
  if (candidates.length === 0) return;
  if (typeof inspect !== "function") return;
  let inventory;
  try {
    inventory = hostOwnerInventorySnapshot(
      inspect({
        workspaceRoot: workspace.root,
        programId: model.program.programId,
        hostId: plan.host.hostId,
        configDigest: plan.configDigest,
        windowIds: model.topology.windows.map((window) => window.windowId),
      }),
      {
        code: "wakeflow-host-activity-temp-inventory",
        label: "host activity/temp inspector",
        programId: model.program.programId,
        hostId: plan.host.hostId,
        configDigest: plan.configDigest,
        statuses: ["current", "attention-required"],
      },
    );
  } catch (error) {
    const code = typeof error?.code === "string"
      ? error.code
      : "wakeflow-host-activity-temp-validation-failed";
    for (const candidate of candidates) {
      candidate.event.classification = "owner-validator-invalid";
      candidate.event.ownerValidationCode = code;
    }
    return;
  }
  if (!inventory || !Array.isArray(inventory.entries)) {
    for (const candidate of candidates) {
      candidate.event.classification = "owner-validator-invalid";
      candidate.event.ownerValidationCode = "wakeflow-host-activity-temp-inventory";
    }
    return;
  }
  const byRef = new Map(inventory.entries.map((entry) => [entry?.ref, entry]));
  for (const candidate of candidates) {
    const entry = byRef.get(candidate.ref);
    let current;
    try {
      current = lstatSync(path.join(workspace.root, ...candidate.ref.split("/")));
    } catch {
      current = null;
    }
    if (!entry || !current || !sameNodeSnapshot(candidate.node.stat, current)) {
      candidate.event.classification = "owner-validator-invalid";
      candidate.event.ownerValidationCode = "wakeflow-host-activity-temp-inventory";
      continue;
    }
    if (
      ["activity-process", "activity-context-root"].includes(entry.kind)
      && entry.status === "current"
    ) {
      candidate.event.classification = "owner-validated";
      candidate.event.recordDigest = entry.digest;
      continue;
    }
    if (
      (entry.kind === "activity-manager-lock" && entry.status === "active")
      || (entry.kind === "prompt-fallback" && entry.status === "live")
    ) {
      candidate.event.classification = "owner-validated-active-operation";
      candidate.event.operationDigest = entry.digest;
      continue;
    }
    if (
      (
        ["activity-process", "activity-context-root", "activity-manager-lock"].includes(entry.kind)
        && entry.status === "stale"
      )
      || (entry.kind === "prompt-fallback" && ["orphan", "expired"].includes(entry.status))
    ) {
      candidate.event.classification = "owner-validator-stale";
      candidate.event.recordDigest = entry.digest;
      continue;
    }
    candidate.event.classification = "owner-validator-invalid";
    candidate.event.ownerValidationCode = "wakeflow-host-activity-temp-inventory";
  }
}

// transport 按 demand 隔离检查，避免一个损坏 demand 污染相邻合法 demand 的结论。
function closeTransportOwnerValidation({ workspace, plan, candidatesByDemand }) {
  for (const demandId of [...candidatesByDemand.keys()].sort(lexicalCompare)) {
    const candidates = candidatesByDemand.get(demandId);
    let diagnostic;
    try {
      diagnostic = inspectTransportDemandForLayout({
        workspaceRoot: workspace.root,
        programId: plan.programId,
        demandId,
      });
    } catch (error) {
      const code = typeof error?.code === "string"
        ? error.code
        : "wakeflow-transport-layout-validation-failed";
      for (const candidate of candidates) {
        candidate.event.classification = "owner-validator-invalid";
        candidate.event.ownerValidationCode = code;
        if (candidate.event.owner === "ambiguous") {
          candidate.event.repairOwner = "delivery-runtime";
        }
      }
      continue;
    }

    const valid = diagnostic.status === "current"
      && Array.isArray(diagnostic.issues)
      && diagnostic.issues.length === 0;
    if (!valid) {
      const code = diagnostic.issues?.[0]?.code
        ?? `wakeflow-transport-layout-${diagnostic.status}`;
      for (const candidate of candidates) {
        candidate.event.classification = "owner-validator-invalid";
        candidate.event.ownerValidationCode = code;
        if (candidate.event.owner === "ambiguous") {
          candidate.event.repairOwner = "delivery-runtime";
        }
      }
      continue;
    }

    const recordsByRef = new Map(
      Object.values(diagnostic.entries)
        .flat()
        .map((entry) => [entry.ref, entry]),
    );
    for (const candidate of candidates) {
      candidate.event.classification = "owner-validated";
      candidate.event.transportInventoryDigest = diagnostic.inventoryDigest;
      const record = recordsByRef.get(candidate.ref);
      if (record) candidate.event.transportRecordDigest = record.digest;
      if (candidate.event.owner === "ambiguous") {
        candidate.event.repairOwner = "delivery-runtime";
      }
    }
  }
}

function auditPreservationIdFromEventMatch(eventMatch) {
  const preservationIds = new Set(
    eventMatch.matches
      .filter((match) => match.entry.key.startsWith("event.audit.preservation"))
      .map((match) => match.captures?.preservationId)
      .filter((value) => typeof value === "string"),
  );
  return preservationIds.size === 1 ? [...preservationIds][0] : null;
}

// preservation owner 负责 manifest、payload tree 和短期 manager lock 的集合一致性。
function closePreservationOwnerValidation({ workspace, plan, candidates }) {
  if (candidates.length === 0) return;
  let inventory;
  try {
    inventory = inspectLocalPreservationInventoryForLayout({
      workspaceRoot: workspace.root,
      expectedProgramId: plan.programId,
    });
  } catch (error) {
    const code = typeof error?.code === "string"
      ? error.code
      : "wakeflow-preservation-layout-validation-failed";
    for (const candidate of candidates) {
      candidate.event.classification = "owner-validator-invalid";
      candidate.event.ownerValidationCode = code;
    }
    return;
  }

  const byPreservationId = new Map(
    inventory.entries.map((entry) => [entry.preservationId, entry]),
  );
  const issueByRefDigest = new Map(
    inventory.issues.map((issue) => [issue.refDigest, issue]),
  );
  for (const candidate of candidates) {
    if (candidate.node.unreadable || candidate.node.unstable) {
      candidate.event.classification = "owner-validator-invalid";
      candidate.event.ownerValidationCode = "wakeflow-preservation-inventory";
      continue;
    }
    if (candidate.managerLock) {
      if (inventory.managerLock.status !== "current") {
        const issue = issueByRefDigest.get(redactedPortableDisplay(candidate.ref).pathDigest);
        candidate.event.classification = "owner-validator-invalid";
        candidate.event.ownerValidationCode = issue?.code
          ?? inventory.managerLock.code
          ?? "wakeflow-preservation-manager-lock-inventory";
        continue;
      }
      candidate.event.classification = "owner-validated";
      candidate.event.preservationId = inventory.managerLock.preservationId;
      candidate.event.operationId = inventory.managerLock.operationId;
      candidate.event.preservationInventoryDigest = inventory.inventoryDigest;
      continue;
    }

    const entry = byPreservationId.get(candidate.preservationId);
    if (!entry || !(candidate.ref === entry.ref || candidate.ref.startsWith(`${entry.ref}/`))) {
      const rootRef = candidate.preservationId === null
        ? candidate.ref
        : `.wakeflow-local/audit/preserved/${candidate.preservationId}`;
      const issue = issueByRefDigest.get(redactedPortableDisplay(rootRef).pathDigest)
        ?? issueByRefDigest.get(redactedPortableDisplay(candidate.ref).pathDigest);
      candidate.event.classification = "owner-validator-invalid";
      candidate.event.ownerValidationCode = issue?.code ?? "wakeflow-preservation-inventory";
      continue;
    }
    candidate.event.classification = "owner-validated";
    candidate.event.preservationId = entry.preservationId;
    candidate.event.preservationManifestDigest = entry.manifestDigest;
    candidate.event.preservationPayloadTreeDigest = entry.payloadTreeDigest;
    candidate.event.preservationInventoryDigest = inventory.inventoryDigest;
  }
}

// deterministic projection 必须与当前 config 和窗口全集一致，单文件形状正确仍不等于 current。
function closeProjectionOwnerValidation({
  workspace,
  model,
  plan,
  hostProfile,
  items,
}) {
  const candidates = items.filter((item) => item.classification === "delegated-current-shape");
  if (candidates.length === 0) return;
  let inspection;
  try {
    inspection = inspectWindowRuntimeProjectionsForLayout({
      workspaceRoot: workspace.root,
      model,
      configDigest: plan.configDigest,
      hostProfile,
    });
  } catch (error) {
    const code = typeof error?.code === "string"
      ? error.code
      : "wakeflow-window-runtime-validation-failed";
    for (const candidate of candidates) {
      candidate.classification = "owner-validator-invalid";
      candidate.ownerValidationCode = code;
    }
    return;
  }
  if (inspection.projectionStatus === "unsafe") {
    for (const candidate of candidates) {
      candidate.classification = "owner-validator-invalid";
      candidate.ownerValidationCode = "wakeflow-window-runtime-inventory";
    }
    return;
  }
  const byWindowId = new Map(inspection.windows.map((window) => [window.windowId, window]));
  for (const candidate of candidates) {
    const windowId = path.posix.basename(candidate.path, ".json");
    const projected = byWindowId.get(windowId);
    if (!projected || projected.status === "unsafe") {
      candidate.classification = "owner-validator-invalid";
      candidate.ownerValidationCode = "wakeflow-window-runtime-inventory";
      continue;
    }
    if (projected.status === "stale") {
      candidate.classification = "owner-validator-stale";
      candidate.currentDigest = projected.currentDigest;
      candidate.expectedDigest = projected.expectedDigest;
      continue;
    }
    if (projected.status !== "current") {
      candidate.classification = "owner-validator-invalid";
      candidate.ownerValidationCode = "wakeflow-window-runtime-inventory";
      continue;
    }
    candidate.classification = "owner-validated";
    candidate.projectionDigest = projected.expectedDigest;
  }
}

/**
 * 递归观察 `.wakeflow-local` 的真实树，并按 expected、event、boundary 三类收集事实。
 * 每个节点使用 no-follow lstat 和扫描期 stat 对比；符号链接、异常类型、owner/mode/link 漂移均失败关闭。
 * 扫描结束后再调用各领域 owner，不复制其 parser、业务状态机或修复权限。
 */
function scanActualTree(workspace, model, plan, hostProfile, eventInspectors, windowIds) {
  const actualByRef = new Map();
  const boundaries = [];
  const events = [];
  const identityCandidates = [];
  const leaseCandidates = [];
  const keepLiveCandidates = [];
  const locatorCandidates = [];
  const activityTempCandidates = [];
  const podCandidates = [];
  const preservationCandidates = [];
  const transportCandidatesByDemand = new Map();
  const staticByPath = new Map(plan.staticDirectories.map((item) => [item.path, item]));
  const delegatedByPath = new Map([
    ...plan.managedFiles.map((item) => [item.path, { item, partition: "managed-file" }]),
    ...plan.initialProjections.map((item) => [item.path, { item, partition: "initial-projection" }]),
  ]);
  const eventEntries = plan.deferredEventPatterns;
  const knownHosts = new Set(WAKEFLOW_PROTOCOL_HOST_IDS);
  const euid = currentEuid();
  let entriesSeen = 0;

  const visit = (absolute, ref, depth) => {
    if (depth > MAX_INVENTORY_DEPTH) {
      boundaries.push(makeBoundary(ref, "inventory-limit", { limit: "depth" }));
      return;
    }
    entriesSeen += 1;
    if (entriesSeen > MAX_INVENTORY_ENTRIES) {
      boundaries.push(makeBoundary(ref, "inventory-limit", { limit: "entries" }));
      return;
    }
    let before;
    try {
      before = lstatSync(absolute);
    } catch (cause) {
      actualByRef.set(ref, {
        type: "unknown",
        mode: null,
        owner: null,
        linkCount: null,
        unreadable: true,
        unstable: false,
      });
      boundaries.push(makeBoundary(ref, "unreadable", { code: cause?.code ?? "unknown" }));
      return;
    }
    const node = {
      type: actualType(before),
      mode: modeString(before),
      owner: euid === null ? null : before.uid === euid,
      linkCount: before.nlink,
      unreadable: false,
      unstable: false,
      stat: before,
    };
    actualByRef.set(ref, node);

    // T02 is the sole authority for lock, journal, claim, checkpoint, and
    // publisher residue. The generic descriptor matcher must neither accept
    // nor reinterpret any descendant in that protocol-owned namespace.
    if (mutationProtocolOwns(ref)) return;

    const legacy = legacyRootFor(ref);
    if (legacy === ref) {
      boundaries.push(makeBoundary(ref, "legacy", { repairOwner: "generated-file-migrator" }));
      return;
    }

    const hostPrefix = `${HOST_ROOT}/`;
    if (ref.startsWith(hostPrefix)) {
      const relative = ref.slice(hostPrefix.length);
      const [hostComponent, ...rest] = relative.split("/");
      if (rest.length === 0 && hostComponent !== plan.host.hostDirName) {
        const classification = knownHosts.has(hostComponent) ? "foreign-host-surface" : "unknown";
        boundaries.push(makeBoundary(ref, classification, {
          applicability: classification === "foreign-host-surface"
            ? "not-applicable-to-current-adapter"
            : null,
        }));
        return;
      }
    }

    if (!staticByPath.has(ref) && !delegatedByPath.has(ref)) {
      const eventMatch = matchEventPath(ref, eventEntries);
      if (eventMatch) {
        const matchedKeys = [...new Set(eventMatch.matches.map((match) => match.entry.key))].sort();
        const descendant = eventMatch.matches.some((match) => match.relation === "descendant");
        const preservationPayloadDescendant = descendant
          && matchedKeys.length === 1
          && matchedKeys[0] === "event.audit.preservation.payload";
        const expectedKinds = descendant
          ? preservationPayloadDescendant
            ? ["directory", "file", "symlink"]
            : ["directory", "file"]
          : [...new Set(eventMatch.matches.map((match) => (
            match.relation === "exact" ? match.entry.pathKind : "directory"
          )))];
        const expectedMode = descendant
          ? preservationPayloadDescendant
            ? node.mode
            : (node.type === "file" ? "0600" : "0700")
          : eventMatch.matches.length === 1 && eventMatch.matches[0].relation === "exact"
            ? eventMatch.matches[0].entry.mode
            : "0700";
        let classification = eventMatch.classification;
        if (!["ambiguous", "invalid-parameter"].includes(classification)) {
          if (node.type === "other" || (node.type === "symlink" && !preservationPayloadDescendant)) classification = "invalid-event-node";
          else if (!expectedKinds.includes(node.type)) classification = "invalid-event-node";
          else if (node.owner !== true) classification = "invalid-event-owner";
          else if (node.mode !== expectedMode) classification = "invalid-event-mode";
          else if (node.type === "file" && node.linkCount !== 1) classification = "invalid-event-link-count";
        }
        const owners = [...new Set(eventMatch.matches.map((match) => match.entry.owner))].sort(lexicalCompare);
        const expectedPaths = [...new Set(eventMatch.matches.map((match) => match.entry.path))].sort(lexicalCompare);
        const event = {
          ...redactedPortableDisplay(ref),
          classification,
          matchedKeys,
          expectedPath: expectedPaths.length === 1 ? expectedPaths[0] : null,
          owner: owners.length === 1 ? owners[0] : "ambiguous",
          repairOwner: owners.length === 1 ? owners[0] : "user-review",
          type: node.type,
          mode: node.mode,
        };
        events.push(event);
        const podId = podIdFromEventMatch(eventMatch);
        if (
          podId
          && ["event-descendant", "event-structural-parent", "owner-validator-pending"].includes(classification)
        ) {
          podCandidates.push({ event, node, ref, podId });
        }
        if (
          matchedKeys.some((key) => key.startsWith("event.audit."))
          && ["event-descendant", "event-structural-parent", "owner-validator-pending"].includes(classification)
        ) {
          preservationCandidates.push({
            event,
            node,
            ref,
            managerLock: matchedKeys.length === 1 && matchedKeys[0] === "event.audit.manager-lock",
            preservationId: auditPreservationIdFromEventMatch(eventMatch),
          });
        }
        const transportDemandId = transportDemandIdFromEventMatch(eventMatch);
        if (
          transportDemandId
          && ["event-structural-parent", "owner-validator-pending"].includes(classification)
        ) {
          const candidates = transportCandidatesByDemand.get(transportDemandId) ?? [];
          candidates.push({ event, node, ref });
          transportCandidatesByDemand.set(transportDemandId, candidates);
        }
        if (
          classification === "owner-validator-pending"
          && matchedKeys.length === 1
          && matchedKeys[0] === "event.identity.binding"
          && node.type === "file"
        ) {
          identityCandidates.push({
            event,
            node,
            windowId: path.posix.basename(ref, ".json"),
          });
        }
        if (
          classification === "owner-validator-pending"
          && matchedKeys.length === 1
          && matchedKeys[0] === "event.coordination.window-lease"
          && node.type === "file"
        ) {
          leaseCandidates.push({
            event,
            node,
            windowId: path.posix.basename(ref, ".json"),
          });
        }
        if (
          classification === "owner-validator-pending"
          && matchedKeys.length === 1
          && matchedKeys[0].startsWith("event.keep-live.")
          && node.type === "file"
        ) {
          keepLiveCandidates.push({ event, node, ref });
        }
        if (
          classification === "owner-validator-pending"
          && matchedKeys.length === 1
          && ["event.host.locator", "event.host.locator-lock"].includes(matchedKeys[0])
          && node.type === "file"
        ) {
          locatorCandidates.push({ event, node, ref });
        }
        if (
          ["event-structural-parent", "owner-validator-pending"].includes(classification)
          && matchedKeys.some((key) => key.startsWith("event.host.activity-") || key === "event.host.temp-prompt")
        ) {
          activityTempCandidates.push({ event, node, ref });
        }
      } else if (ref !== LOCAL_ROOT) {
        boundaries.push(makeBoundary(ref, "unknown", { type: node.type }));
      }
    }

    if (node.type !== "directory") {
      try {
        const after = lstatSync(absolute);
        if (!sameNodeSnapshot(before, after)) {
          node.unstable = true;
          boundaries.push(makeBoundary(ref, "unstable"));
        }
      } catch {
        node.unstable = true;
        boundaries.push(makeBoundary(ref, "unstable"));
      }
      return;
    }
    let children;
    try {
      children = readdirSync(absolute, { withFileTypes: true })
        .map((entry) => entry.name)
        .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
    } catch (cause) {
      node.unreadable = true;
      boundaries.push(makeBoundary(ref, "unreadable", { code: cause?.code ?? "unknown" }));
      return;
    }
    let after;
    try {
      after = lstatSync(absolute);
    } catch {
      node.unstable = true;
      boundaries.push(makeBoundary(ref, "unstable"));
      return;
    }
    if (!sameNodeSnapshot(before, after)) {
      node.unstable = true;
      boundaries.push(makeBoundary(ref, "unstable"));
      return;
    }
    for (const name of children) {
      visit(path.join(absolute, name), `${ref}/${name}`, depth + 1);
    }
  };

  const local = path.join(workspace.root, LOCAL_ROOT);
  try {
    lstatSync(local);
  } catch (cause) {
    if (cause?.code === "ENOENT") return { actualByRef, boundaries, events };
    boundaries.push(makeBoundary(LOCAL_ROOT, "unreadable", { code: cause?.code ?? "unknown" }));
    return { actualByRef, boundaries, events };
  }
  visit(local, LOCAL_ROOT, 0);
  closeIdentityOwnerValidation({
    workspace,
    plan,
    hostProfile,
    windowIds,
    candidates: identityCandidates,
  });
  closeLeaseOwnerValidation({
    workspace,
    model,
    plan,
    hostProfile,
    candidates: leaseCandidates,
  });
  closeKeepLiveOwnerValidation({
    workspace,
    model,
    plan,
    hostProfile,
    candidates: keepLiveCandidates,
  });
  closeHostLocatorOwnerValidation({
    workspace,
    model,
    plan,
    inspect: eventInspectors.locator,
    candidates: locatorCandidates,
  });
  closeHostActivityTempOwnerValidation({
    workspace,
    model,
    plan,
    inspect: eventInspectors.activityTemp,
    candidates: activityTempCandidates,
  });
  closePodOwnerValidation({
    workspace,
    plan,
    candidates: podCandidates,
  });
  closeTransportOwnerValidation({
    workspace,
    plan,
    candidatesByDemand: transportCandidatesByDemand,
  });
  closePreservationOwnerValidation({
    workspace,
    plan,
    candidates: preservationCandidates,
  });
  return { actualByRef, boundaries, events };
}

// mutation inspection 失败时只产生脱敏 blocker，不猜测或清理任何运行中事务。
function mutationInspection(workspaceRoot) {
  try {
    return { value: inspectWakeflowWorkspaceMutation({ workspaceRoot }), blocker: null };
  } catch (error) {
    return {
      value: { state: "manual", lock: null, operations: [] },
      blocker: {
        path: `${LOCAL_ROOT}/runtime/maintenance`,
        classification: "workspace-mutation-invalid",
        code: typeof error?.code === "string" ? error.code : "wakeflow-mutation-inspection-failed",
      },
    };
  }
}

// overall 是诊断归约：blocking boundary 优先，其次 pending owner validation，再其次可修复 drift。
function inspectionStatus(items, events, boundaries, mutation) {
  const blockingItem = items.some((item) => [
    "blocked-by-ancestor",
    "unreadable",
    "unstable",
    "symlink",
    "wrong-type",
    "foreign-owner",
    "unsafe-mode",
    "delegated-drift",
    "owner-validator-invalid",
  ].includes(item.classification));
  const blockingEvent = events.some((event) => [
    "ambiguous",
    "invalid-parameter",
    "invalid-event-node",
    "invalid-event-owner",
    "invalid-event-mode",
    "invalid-event-link-count",
    "owner-validator-invalid",
    "owner-validated-active-operation",
  ].includes(event.classification));
  const blockingBoundary = boundaries.some((boundary) => ![
    "foreign-host-surface",
  ].includes(boundary.classification));
  const mutationBlocked = !["absent", "bootstrap-prefix", "idle"].includes(mutation.state);
  if (blockingItem || blockingEvent || blockingBoundary || mutationBlocked) return "blocked";
  if (
    events.some((event) => event.classification === "owner-validator-pending")
    || items.some((item) => item.classification === "delegated-current-shape")
  ) return "partial-owner-validation";
  if (
    events.some((event) => event.classification === "owner-validator-stale")
    || items.some((item) => !["current", "owner-validated"].includes(item.classification))
  ) return "drift";
  return "healthy";
}

// blocker projection 只携带 portable path 或摘要和明确 repair owner，不签发修复动作。
function blockerProjection(items, events, boundaries, mutation, mutationBlocker) {
  const blockers = [];
  for (const item of items) {
    if ([
      "blocked-by-ancestor",
      "unreadable",
      "unstable",
      "symlink",
      "wrong-type",
      "foreign-owner",
      "unsafe-mode",
      "delegated-drift",
      "owner-validator-invalid",
    ].includes(item.classification)) {
      blockers.push({ path: item.path, classification: item.classification, owner: item.repairOwner });
    }
    if (item.classification === "delegated-current-shape") {
      blockers.push({
        path: item.path,
        classification: "owner-validator-pending",
        owner: item.repairOwner,
      });
    }
    if (item.classification === "owner-validator-stale") {
      blockers.push({
        path: item.path,
        classification: item.classification,
        owner: item.repairOwner,
      });
    }
  }
  for (const event of events) {
    if ([
      "ambiguous",
      "invalid-parameter",
      "invalid-event-node",
      "invalid-event-owner",
      "invalid-event-mode",
      "invalid-event-link-count",
      "owner-validator-invalid",
      "owner-validator-pending",
      "owner-validator-stale",
      "owner-validated-active-operation",
    ].includes(event.classification)) {
      blockers.push({
        path: event.path,
        pathDigest: event.pathDigest,
        classification: event.classification,
        owner: event.repairOwner ?? event.owner ?? "user-review",
      });
    }
  }
  for (const boundary of boundaries) {
    if (boundary.classification === "foreign-host-surface") continue;
    blockers.push({
      path: boundary.path,
      pathDigest: boundary.pathDigest,
      classification: boundary.classification,
      owner: boundary.classification === "legacy" ? "generated-file-migrator" : "user-review",
    });
  }
  if (mutationBlocker) blockers.push(mutationBlocker);
  if (!["absent", "bootstrap-prefix", "idle"].includes(mutation.state)) {
    blockers.push({
      path: `${LOCAL_ROOT}/runtime/maintenance`,
      classification: `workspace-mutation-${mutation.state}`,
      owner: "mutation-gate-manager",
    });
  }
  return blockers.sort((left, right) => lexicalCompare(canonicalJson(left), canonicalJson(right)));
}

function publicMutationInspection(value) {
  return {
    state: value.state,
    lockPresent: value.lock !== null,
    operationCount: Array.isArray(value.operations) ? value.operations.length : 0,
  };
}

/**
 * 生成一次不可变、进程内签发的 local layout inspection。
 * 输出可供 observability、realization planner 和只读 storage/verify projection 复用；任何写入仍须重新检查并进入 T02 gate。
 */
export function inspectWakeflowLocalLayout(value) {
  const input = exactInput(value);
  const workspace = inspectWorkspaceRoot(input.workspaceRoot);
  const layoutPlan = planWakeflowLocalLayout({
    model: input.model,
    layoutDescriptor: input.layoutDescriptor,
    hostProfile: input.hostProfile,
  });
  const eventInspectors = hostEventInspectorFacade(input.hostProfile);
  const inventory = scanActualTree(
    workspace,
    input.model,
    layoutPlan,
    input.hostProfile,
    eventInspectors,
    input.model.topology.windows.map((window) => window.windowId),
  );
  const staticItems = layoutPlan.staticDirectories.map((item) => (
    classifyExpected(item, "static-directory", inventory.actualByRef.get(item.path), inventory.actualByRef)
  ));
  const managedItems = layoutPlan.managedFiles.map((item) => (
    classifyExpected(item, "managed-file", inventory.actualByRef.get(item.path), inventory.actualByRef)
  ));
  const projectionItems = layoutPlan.initialProjections.map((item) => (
    classifyExpected(item, "initial-projection", inventory.actualByRef.get(item.path), inventory.actualByRef)
  ));
  closeProjectionOwnerValidation({
    workspace,
    model: input.model,
    plan: layoutPlan,
    hostProfile: input.hostProfile,
    items: projectionItems,
  });
  const items = [...staticItems, ...managedItems, ...projectionItems];
  const mutation = mutationInspection(workspace.root);
  const blockers = blockerProjection(
    items,
    inventory.events,
    inventory.boundaries,
    mutation.value,
    mutation.blocker,
  );
  const capabilities = layoutPlan.host.capabilities.map((capability) => ({
    ...capability,
    classification: capability.applicable ? "applicable" : "not-applicable",
  }));
  const deferredEvents = layoutPlan.deferredEventPatterns.map((entry) => ({
    key: entry.key,
    path: entry.path,
    partition: "event-pattern",
    owner: entry.owner,
    authority: entry.authority,
    lifecycle: entry.lifecycle,
    mode: entry.mode,
    classification: "deferred",
    actual: null,
    repairOwner: entry.owner,
    allowDescendants: entry.allowDescendants,
  }));
  const eventItems = [...deferredEvents, ...inventory.events];
  const itemPartitions = {
    staticDirectories: staticItems,
    managedFiles: managedItems,
    initialProjections: projectionItems,
    events: eventItems,
    boundaries: inventory.boundaries,
  };
  const unsigned = {
    kind: INSPECTION_KIND,
    schemaVersion: INSPECTION_SCHEMA_VERSION,
    protocolRoot: layoutPlan.protocolRoot,
    programId: layoutPlan.programId,
    configDigest: layoutPlan.configDigest,
    layoutDigest: layoutPlan.layoutDigest,
    layoutPlanDigest: layoutPlan.planDigest,
    host: {
      hostId: layoutPlan.host.hostId,
      hostDirName: layoutPlan.host.hostDirName,
      capabilities,
    },
    overall: inspectionStatus(items, inventory.events, inventory.boundaries, mutation.value),
    items: itemPartitions,
    mutation: publicMutationInspection(mutation.value),
    blockers,
    summary: {
      staticDirectories: countByClassification(staticItems),
      delegated: countByClassification([...managedItems, ...projectionItems]),
      events: countByClassification(eventItems),
      boundaries: countByClassification(inventory.boundaries),
      blockers: blockers.length,
    },
  };
  const inspection = deepFreeze({ ...unsigned, inspectionDigest: canonicalJsonDigest(unsigned) });
  ISSUED_INSPECTIONS.add(inspection);
  return inspection;
}
