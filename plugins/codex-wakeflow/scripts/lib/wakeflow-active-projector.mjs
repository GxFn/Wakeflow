import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import path from "node:path";

import {
  atomicWriteFile,
  sha256Bytes,
} from "./wakeflow-atomic-write.mjs";
import {
  WAKEFLOW_ACTIVE_PROJECTION_LOCK_REF as PROJECTOR_LOCK_REF,
  withWakeflowActiveProjectionLock,
} from "./wakeflow-active-projection-lock.mjs";
import { inspectWakeflowFreshTodoTransitionAuthority } from "./wakeflow-active-foundation.mjs";
import { canonicalJson, canonicalJsonDigest } from "./wakeflow-canonical-json.mjs";
import {
  buildWakeflowConfigV3Indexes,
  parseWakeflowConfigV3,
  wakeflowConfigV3Digest,
} from "./wakeflow-config-v3.mjs";
import { loadWakeflowConfigV3Snapshot } from "./wakeflow-config-v3-snapshot.mjs";
import { assertWakeflowConfigV3TransitionAuthority } from "./wakeflow-config-v3-transition-authority.mjs";
import {
  inspectDemandArtifactInventory,
  loadDemandArtifactByRef,
} from "./wakeflow-demand-artifact-records.mjs";
import { validateDemandTaskAssignmentAgainstTopology } from "./wakeflow-demand-artifact-service.mjs";
import {
  loadDemandCoreRecordsWhileLocked,
} from "./wakeflow-demand-core-records.mjs";
import {
  buildWakeflowDemandDocuments,
  selectWakeflowStateSelectedArtifacts,
} from "./wakeflow-demand-document-builder.mjs";
import {
  WAKEFLOW_DEMAND_COMMON_CAPABILITY_ROOTS,
  WAKEFLOW_DEMAND_ISOLATED_CAPABILITY_ROOTS,
  WAKEFLOW_DEMAND_RECOVERY_ROOT,
  wakeflowDemandCapabilityRoots,
} from "./wakeflow-demand-layout.mjs";
import { inspectManagedEvidenceInventory } from "./wakeflow-evidence-records.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import { createWakeflowTrackedMaterializationParticipant } from "./wakeflow-tracked-materialization.mjs";
import {
  withStateRootLock,
} from "./wakeflow-state-lock.mjs";
import { buildTargetResultAuthoritySnapshotFromLoaded } from "./wakeflow-target-result-authority.mjs";
import { assertParsedWakeflowAssetBundle } from "./wakeflow-template-renderer.mjs";

/**
 * `.wakeflow-active`确定性投影服务，把严格配置、demand core、artifact/evidence inventory和模板
 * 转换为workspace index/status以及每个demand的index/progress Markdown。
 *
 * 职责导航：
 * 1. exactInput只接收workspaceRoot、已解析bundle和已解析language；普通inspect/rebuild不接收caller plan或config。
 * 2. initialCollection在projection lock→state-root lock顺序下收集权威，并把authority、recovery与storage问题分轴。
 * 3. buildProjectionPlan绑定配置、模板、demand/state/event/result摘要，生成不依赖mtime、TODO内容或local runtime的字节。
 * 4. inspectTarget/writeProjectionFiles只管理四类投影文件，TODO、demand JSON、ledger和local evidence永不由本模块写入。
 * 5. maintenance planner把同一renderer接入fresh/reconfigure/reconcile；participant重建动态文件全集后才接受confirmed plan。
 * 6. public boundary只返回脱敏轴、摘要、库存和portable ref，不把workspaceRoot、原始配置或私有残留名带出。
 *
 * 本模块不是第二份状态机：Markdown永远是可重建投影，精确状态仍由demand core、artifact/evidence owner和TODO service拥有。
 */

export const WAKEFLOW_ACTIVE_PROJECTOR_SCHEMA_VERSION = 1;
export const WAKEFLOW_ACTIVE_PROJECTION_MAINTENANCE_SCHEMA_ID =
  "urn:wakeflow:internal:active-projection-maintenance-plan:v1";
export const WAKEFLOW_ACTIVE_PROJECTION_MAINTENANCE_KIND =
  "WakeflowActiveProjectionMaintenancePlan";
export const WAKEFLOW_ACTIVE_PROJECTION_MAINTENANCE_SCHEMA_VERSION = 1;

const ACTIVE_ROOT_REF = ".wakeflow-active";
const CURRENT_ROOT_REF = `${ACTIVE_ROOT_REF}/current`;
const WORKSPACE_INDEX_REF = `${ACTIVE_ROOT_REF}/index.md`;
const WORKSPACE_STATUS_REF = `${CURRENT_ROOT_REF}/workspace-current-status.md`;
const CONFIG_REF = "wakeflow.config.json";
const MAX_PROJECTION_BYTES = 8 * 1024 * 1024;
const FILE_MODE = 0o600;
const FILE_MODE_STRING = "0600";
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const INPUT_KEYS = Object.freeze(["workspaceRoot", "bundle", "language"]);
const LANGUAGES = new Set(["en", "zh"]);
const DEMAND_ID_RE = /^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CREATE_INTENT_RE = new RegExp(`^(${DEMAND_ID_RE.source.slice(1, -1)})\\.create-intent\\.json$`, "u");
const CREATE_STAGE_RE = new RegExp(`^\\.wakeflow-create-stage-(${DEMAND_ID_RE.source.slice(1, -1)})$`, "u");
const DEMAND_CREATE_LOCK_RE = new RegExp(`^(${DEMAND_ID_RE.source.slice(1, -1)})\\.create-lock$`, "u");
const DEMAND_STATE_LOCK_RE = new RegExp(`^(${DEMAND_ID_RE.source.slice(1, -1)})\\.state-lock$`, "u");
const ARCHIVE_INTENT_RE = new RegExp(`^\\.(${DEMAND_ID_RE.source.slice(1, -1)})\\.wakeflow-archive-intent\\.json$`, "u");
const ARCHIVE_TOMBSTONE_RE = new RegExp(`^\\.(${DEMAND_ID_RE.source.slice(1, -1)})\\.wakeflow-archive-stage$`, "u");
const ACTIVE_MARKER_RE = /<!-- wakeflow:active-projection:v1:sha256:[0-9a-f]{64} -->/u;
const DEMAND_MARKER_RE = /<!-- wakeflow:demand-projection:v1:sha256:[0-9a-f]{64} -->/u;
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });
const INVENTORY_ROOT_CODES = new Set([
  "wakeflow-demand-artifact-inventory-root-missing",
  "wakeflow-demand-artifact-inventory-root-unsafe",
  "wakeflow-demand-artifact-inventory-root-unreadable",
  "wakeflow-evidence-inventory-root-invalid",
  "wakeflow-evidence-inventory-capability-root-failure",
  "wakeflow-evidence-inventory-root-missing",
  "wakeflow-evidence-inventory-root-unsafe",
  "wakeflow-evidence-inventory-root-unreadable",
]);

// ==================== 一、协议常量、语言文本与严格公共输入 ====================

function expandedCapabilityRoots(leafRoots) {
  const roots = new Set();
  for (const leaf of leafRoots) {
    const segments = leaf.split("/");
    for (let index = 1; index <= segments.length; index += 1) {
      roots.add(segments.slice(0, index).join("/"));
    }
  }
  return [...roots].sort(lexicalCompare);
}

const ALL_DEMAND_CAPABILITY_ROOTS = Object.freeze(expandedCapabilityRoots([
  ...WAKEFLOW_DEMAND_COMMON_CAPABILITY_ROOTS,
  WAKEFLOW_DEMAND_RECOVERY_ROOT,
  ...WAKEFLOW_DEMAND_ISOLATED_CAPABILITY_ROOTS,
]));
const DEMAND_OPERATION_EVENT_KEYS = Object.freeze([
  "event.demand.publication.identity-lock",
  "event.demand.publication.intent",
  "event.demand.publication.stage",
  "event.demand.publication.create-lock",
  "event.demand.transition.state-lock",
  "event.demand.evidence.stage",
  "event.demand.transaction.create",
  "event.demand.transaction.state-transition",
  "event.demand.transaction.archive",
  "event.demand.archive.intent",
  "event.demand.archive.tombstone",
]);
const DEMAND_ARTIFACT_KEY_BY_KIND = Object.freeze({
  "wakeflow-task-package": "event.demand.task-package",
  "wakeflow-target-result": "event.demand.target-result",
  "wakeflow-review-candidate": "event.demand.review-candidate",
  "wakeflow-test-card": "event.demand.test-card",
  "wakeflow-pod-design-request": "event.demand.pod.design-request",
  "wakeflow-pod-design-handoff": "event.demand.pod.design-handoff",
});

const LOCALES = Object.freeze({
  en: Object.freeze({
    indexTitle: "Wakeflow Active Workspace",
    indexNotice: "Generated navigation only. Linked machine records remain authoritative.",
    program: "Program",
    programId: "Program ID",
    status: "Current status",
    todo: "Global TODO",
    ledger: "Workspace record map",
    demands: "Active demand roots",
    noDemands: "No active demand roots.",
    statusTitle: "Workspace Current Status",
    statusNotice: "Projection only. Exact demand state and controller events remain authoritative.",
    source: "Source fingerprint",
    authority: "Authority",
    frozen: "frozen",
    pending: "pending",
    placement: "Execution placement",
    state: "State",
    revision: "Revision",
    assignments: "Configured assignments",
    noAssignments: "none",
    exactState: "Exact state",
    nextAuthority: "Next authority references",
    nextAction: "Next action",
    inspectTodo: "Inspect the global TODO authority.",
    readState: "Read the exact demand state root before acting.",
    repair: "Repair the listed authority source before rebuilding this projection.",
  }),
  zh: Object.freeze({
    indexTitle: "Wakeflow 活动工作区",
    indexNotice: "仅为生成式导航。链接的机器记录仍是权威。",
    program: "程序",
    programId: "程序 ID",
    status: "当前状态",
    todo: "全局 TODO",
    ledger: "工作区记录映射",
    demands: "活动需求根",
    noDemands: "当前没有活动需求根。",
    statusTitle: "工作区当前状态",
    statusNotice: "仅为投影。精确需求状态和 Controller 事件仍是权威。",
    source: "来源指纹",
    authority: "授权",
    frozen: "已冻结",
    pending: "待冻结",
    placement: "执行位置",
    state: "状态",
    revision: "修订号",
    assignments: "配置任务分配",
    noAssignments: "无",
    exactState: "精确状态",
    nextAuthority: "下一权威引用",
    nextAction: "下一动作",
    inspectTodo: "检查全局 TODO 权威。",
    readState: "执行前读取精确需求状态根。",
    repair: "修复列出的权威来源后再重建投影。",
  }),
});

export class WakeflowActiveProjectorError extends Error {
  constructor(code, message, { path: errorPath = "$", details = {} } = {}) {
    super(message);
    this.name = "WakeflowActiveProjectorError";
    this.code = code;
    this.path = errorPath;
    this.details = deepFreeze({ ...details });
  }
}

function fail(code, message, { path: errorPath = "$", details = {} } = {}) {
  throw new WakeflowActiveProjectorError(code, message, { path: errorPath, details });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("wakeflow-active-projector-input", "active projector input must be one plain data object");
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("wakeflow-active-projector-input", "active projector input must be one plain data object");
  }
  const ownKeys = Reflect.ownKeys(input);
  const unknownFieldCount = ownKeys.filter((key) => (
    typeof key !== "string" || !INPUT_KEYS.includes(key)
  )).length;
  if (unknownFieldCount > 0) {
    fail("wakeflow-active-projector-input-unknown", "active projector input contains unknown fields", {
      path: "$",
      details: { unknownFieldCount },
    });
  }
  const missing = INPUT_KEYS.find((key) => !Object.hasOwn(input, key));
  if (missing) {
    fail("wakeflow-active-projector-input", `missing active projector input ${missing}`, {
      path: `$/${missing}`,
    });
  }
  const values = {};
  for (const key of INPUT_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-active-projector-input", `active projector input ${key} must be an enumerable data property`, {
        path: `$/${key}`,
      });
    }
    values[key] = descriptor.value;
  }
  if (
    typeof values.workspaceRoot !== "string"
    || !values.workspaceRoot.trim()
    || values.workspaceRoot !== values.workspaceRoot.trim()
    || /[\u0000-\u001f\u007f-\u009f]/u.test(values.workspaceRoot)
  ) {
    fail("wakeflow-active-projector-input", "workspaceRoot must be one trimmed control-free path", {
      path: "$/workspaceRoot",
    });
  }
  if (!LANGUAGES.has(values.language)) {
    fail("wakeflow-active-projector-language", "language must be the caller-resolved value en or zh", {
      path: "$/language",
    });
  }
  try {
    assertParsedWakeflowAssetBundle(values.bundle);
  } catch {
    fail("wakeflow-active-projector-bundle", "bundle must be validated and frozen before projection", {
      path: "$/bundle",
    });
  }
  return Object.freeze(values);
}

// ==================== 二、Markdown安全编码与稳定目录观察 ====================

function sha256Text(content) {
  return `sha256:${createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex")}`;
}

function canonicalMarkdown(content) {
  return `${String(content).replaceAll("\r", "").trimEnd()}\n`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function safeHeading(value) {
  return escapeHtml(value)
    .replace(/\s+/gu, " ")
    .replace(/([\\`*_[\]()#+.!|])/gu, "\\$1")
    .trim();
}

function inlineText(value) {
  return String(value).replace(/\s+/gu, " ").trim();
}

function code(value) {
  return `<code>${escapeHtml(inlineText(value))}</code>`;
}

function markdownDestination(target) {
  return String(target).split("/").map((segment) => (
    encodeURIComponent(segment).replace(/[!'()*]/gu, (character) => (
      `%${character.codePointAt(0).toString(16).toUpperCase()}`
    ))
  )).join("/");
}

function link(label, target) {
  return `[${label}](${markdownDestination(target)})`;
}

function activeMarker(fingerprint) {
  return `<!-- wakeflow:active-projection:v${WAKEFLOW_ACTIVE_PROJECTOR_SCHEMA_VERSION}:${fingerprint} -->`;
}

function opaqueUnknownRef(scope, name) {
  const digest = createHash("sha256").update(Buffer.from(name, "utf8")).digest("hex").slice(0, 16);
  return `${scope}/unknown-${digest}`;
}

function issue(codeValue, ref, demandId = null) {
  return Object.freeze({
    code: codeValue,
    ref,
    ...(demandId === null ? {} : { demandId }),
  });
}

function stableDirectoryEntries(directory) {
  const before = lstatSync(directory, { bigint: true });
  if (before.isSymbolicLink() || !before.isDirectory()) {
    throw new Error("unsafe-directory");
  }
  const entries = readdirSync(directory, { withFileTypes: true });
  const after = lstatSync(directory, { bigint: true });
  if (
    after.isSymbolicLink()
    || !after.isDirectory()
    || before.dev !== after.dev
    || before.ino !== after.ino
    || before.mtimeNs !== after.mtimeNs
    || before.ctimeNs !== after.ctimeNs
  ) {
    throw new Error("unstable-directory");
  }
  return entries.sort((left, right) => lexicalCompare(left.name, right.name));
}

function stablePrivateDirectoryEntries(directory) {
  const before = lstatSync(directory, { bigint: true });
  if (
    before.isSymbolicLink()
    || !before.isDirectory()
    || (process.platform !== "win32" && (before.mode & 0o777n) !== 0o700n)
  ) {
    throw new Error("unsafe-private-directory");
  }
  const entries = readdirSync(directory, { withFileTypes: true });
  const after = lstatSync(directory, { bigint: true });
  if (
    after.isSymbolicLink()
    || !after.isDirectory()
    || (process.platform !== "win32" && (after.mode & 0o777n) !== 0o700n)
    || before.dev !== after.dev
    || before.ino !== after.ino
    || before.mtimeNs !== after.mtimeNs
    || before.ctimeNs !== after.ctimeNs
  ) {
    throw new Error("unstable-private-directory");
  }
  return entries.sort((left, right) => lexicalCompare(left.name, right.name));
}

// 锁/journal/stage类底层错误表示尚需恢复；其他解析或关系错误只证明authority降级。
function healthForCause(cause) {
  const codeValue = typeof cause?.code === "string" ? cause.code : "";
  return /journal|transaction|stage|recovery|lock/iu.test(codeValue)
    ? "recovery-required"
    : "degraded";
}

// artifact taxonomy只维护一份：凡能进入投影库存映射的immutable demand artifact都必须被事件引用闭合。
function expectedArtifactTuples(events) {
  return events.flatMap((event) => event.changedArtifacts.filter((entry) => (
    Object.hasOwn(DEMAND_ARTIFACT_KEY_BY_KIND, entry.artifactKind)
  )));
}

function expectedEvidenceTuples(events) {
  return events.flatMap((event) => event.changedArtifacts.filter(
    (entry) => entry.artifactKind === "wakeflow-evidence",
  )).sort((left, right) => lexicalCompare(left.ref, right.ref));
}

function nestedCapabilityTree(capabilityRoots) {
  const root = new Map();
  for (const capabilityRoot of capabilityRoots) {
    const segments = capabilityRoot.split("/");
    if (segments.length < 2) continue;
    let cursor = root;
    for (const segment of segments) {
      if (!cursor.has(segment)) cursor.set(segment, new Map());
      cursor = cursor.get(segment);
    }
  }
  return root;
}

// 只把配置声明的capability目录当作已知；未知basename经摘要化后才能进入公开issue。
function inspectNestedCapabilityResidue(loaded, capabilityRoots) {
  const demandBaseRef = `.wakeflow-active/current/${loaded.demand.demandId}`;
  const issues = [];
  const inspectNode = (directory, segments, children) => {
    let entries;
    try {
      entries = stablePrivateDirectoryEntries(directory);
    } catch {
      issues.push(issue(
        "storage-degraded",
        `${demandBaseRef}/${segments.join("/")}/`,
        loaded.demand.demandId,
      ));
      return;
    }
    // 叶子目录的文件命名、schema、identity和stage残留由artifact/evidence inventory唯一解释；
    // 结构层只验证叶子目录本身安全，不能把合法领域文件再次判成未知子目录残留。
    if (children.size === 0) return;
    for (const entry of entries) {
      if (children.has(entry.name)) continue;
      issues.push(issue(
        "storage-degraded",
        opaqueUnknownRef(
          `${demandBaseRef}/${segments.join("/")}/residue`,
          entry.name,
        ),
        loaded.demand.demandId,
      ));
    }
    for (const [childName, childTree] of children) {
      inspectNode(
        path.join(directory, childName),
        [...segments, childName],
        childTree,
      );
    }
  };
  for (const [rootName, children] of nestedCapabilityTree(capabilityRoots)) {
    inspectNode(path.join(loaded.paths.stateRoot, rootName), [rootName], children);
  }
  return issues;
}

function inspectDemandRootResidue(loaded) {
  const capabilityRoots = wakeflowDemandCapabilityRoots(loaded.demand.executionPlacement);
  const allowed = new Set([
    "demand.json",
    "demand-authority.json",
    "wakeflow-state.json",
    "controller-events.jsonl",
    "index.md",
    "developer-progress.md",
    ...capabilityRoots.map((entry) => entry.split("/")[0]),
  ]);
  const rootIssues = stableDirectoryEntries(loaded.paths.stateRoot)
    .filter((entry) => !allowed.has(entry.name))
    .map((entry) => issue(
      "storage-degraded",
      opaqueUnknownRef(
        `.wakeflow-active/current/${loaded.demand.demandId}/root-residue`,
        entry.name,
      ),
      loaded.demand.demandId,
    ));
  return [
    ...rootIssues,
    ...inspectNestedCapabilityResidue(loaded, capabilityRoots),
  ];
}

function classifyInventoryIssues(inventoryIssues, expectedRefs, demandId, capability) {
  const authorityIssues = [];
  const recoveryIssues = [];
  const storageIssues = [];
  for (const entry of inventoryIssues) {
    const entryRef = typeof entry.ref === "string" ? entry.ref : "";
    const expectedExact = expectedRefs.has(entryRef);
    const expectedDescendant = entryRef.endsWith("/")
      && [...expectedRefs].some((expectedRef) => expectedRef.startsWith(entryRef));
    const expectedRelated = expectedExact || expectedDescendant;
    const capabilityRootFailure = INVENTORY_ROOT_CODES.has(entry.code);
    const recoveryRequired = entry.classification === "stage-residue"
      || entry.classification === "incomplete"
      || /stage-residue|recovery|transaction/iu.test(entry.code ?? "");
    const blocksAuthority = expectedRelated
      || entry.classification === "missing"
      || entry.classification === "conflict";
    const baseRef = `.wakeflow-active/current/${demandId}`;
    const publicRef = expectedRelated || capabilityRootFailure
      ? `${baseRef}/${entryRef}`
      : opaqueUnknownRef(`${baseRef}/${capability}`, `${entry.code ?? "unknown"}\u0000${entryRef}`);
    const destination = recoveryRequired
      ? recoveryIssues
      : blocksAuthority
        ? authorityIssues
        : storageIssues;
    destination.push(issue(
      recoveryRequired ? "recovery-required" : blocksAuthority ? "authority-unhealthy" : "storage-degraded",
      publicRef,
      demandId,
    ));
  }
  return { authorityIssues, recoveryIssues, storageIssues };
}

// ==================== 三、单个demand的authority、assignment与库存闭包 ====================

// task package/TestCard必须仍与当前拓扑和state selector精确一致，投影不能替它们修复分配关系。
function validateAssignments(loaded, snapshot) {
  const packages = new Map();
  for (const statePackage of loaded.state.taskPackages) {
    const resolved = loadDemandArtifactByRef({
      stateRoot: loaded.paths.stateRoot,
      ref: statePackage.ref,
      digest: statePackage.digest,
      expectedArtifactKind: "wakeflow-task-package",
      expectedArtifactId: statePackage.taskPackageId,
      expectedProgramId: loaded.demand.programId,
      expectedDemandId: loaded.demand.demandId,
    });
    validateDemandTaskAssignmentAgainstTopology({
      artifact: resolved.record,
      config: snapshot,
    });
    packages.set(statePackage.taskPackageId, resolved.record);
  }

  const assignments = loaded.state.targetTasks.map((task) => {
    const taskPackage = packages.get(task.taskPackageId);
    const packageRepositoryId = Object.hasOwn(taskPackage ?? {}, "repositoryId")
      ? taskPackage.repositoryId
      : null;
    const stateRepositoryId = Object.hasOwn(task, "repositoryId") ? task.repositoryId : null;
    if (
      !taskPackage
      || taskPackage.targetTaskId !== task.targetTaskId
      || taskPackage.windowId !== task.windowId
      || packageRepositoryId !== stateRepositoryId
    ) {
      throw new Error("task-package-assignment-mismatch");
    }
    return Object.freeze({
      targetTaskId: task.targetTaskId,
      windowId: task.windowId,
      ...(stateRepositoryId === null ? {} : { repositoryId: stateRepositoryId }),
      lifecycleStatus: task.lifecycleStatus,
    });
  });

  for (const stateCard of loaded.state.testCards) {
    const resolved = loadDemandArtifactByRef({
      stateRoot: loaded.paths.stateRoot,
      ref: stateCard.ref,
      digest: stateCard.digest,
      expectedArtifactKind: "wakeflow-test-card",
      expectedArtifactId: stateCard.testCardId,
      expectedProgramId: loaded.demand.programId,
      expectedDemandId: loaded.demand.demandId,
    });
    validateDemandTaskAssignmentAgainstTopology({
      artifact: resolved.record,
      config: snapshot,
      workType: "test",
    });
    const task = loaded.state.targetTasks.find((entry) => entry.targetTaskId === resolved.record.targetTaskId);
    if (task && (
      task.windowId !== resolved.record.windowId
      || Object.hasOwn(task, "repositoryId")
      || task.testCard?.testCardId !== stateCard.testCardId
      || task.testCard?.ref !== stateCard.ref
      || task.testCard?.digest !== stateCard.digest
      || packages.get(task.taskPackageId)?.testCard?.testCardId !== stateCard.testCardId
      || packages.get(task.taskPackageId)?.testCard?.ref !== stateCard.ref
      || packages.get(task.taskPackageId)?.testCard?.digest !== stateCard.digest
    )) {
      throw new Error("test-card-assignment-mismatch");
    }
    if (!task && stateCard.lifecycleStatus === "active") {
      assignments.push(Object.freeze({
        targetTaskId: resolved.record.targetTaskId,
        windowId: resolved.record.windowId,
        lifecycleStatus: stateCard.lifecycleStatus,
      }));
    }
  }
  assignments.sort((left, right) => lexicalCompare(left.targetTaskId, right.targetTaskId));
  return { assignments, packages };
}

function validateResultAssignments(loaded, snapshot, packages, resultAuthority) {
  const packageStates = new Map(loaded.state.taskPackages.map((entry) => [entry.taskPackageId, entry]));
  const tasks = new Map(loaded.state.targetTasks.map((entry) => [entry.targetTaskId, entry]));
  for (const selected of resultAuthority.artifacts) {
    const record = selected.record;
    const task = tasks.get(record.targetTaskId);
    const taskPackage = task ? packages.get(task.taskPackageId) : null;
    const packageState = task ? packageStates.get(task.taskPackageId) : null;
    const taskRepositoryId = Object.hasOwn(task ?? {}, "repositoryId") ? task.repositoryId : null;
    const packageRepositoryId = Object.hasOwn(taskPackage ?? {}, "repositoryId")
      ? taskPackage.repositoryId
      : null;
    const resultRepositoryId = record.assignment.repositoryId ?? null;
    if (
      !task
      || !taskPackage
      || !packageState
      || record.taskPackage.taskPackageId !== task.taskPackageId
      || record.taskPackage.ref !== packageState.ref
      || record.taskPackage.digest !== packageState.digest
      || record.assignment.windowId !== task.windowId
      || record.assignment.windowId !== taskPackage.windowId
      || resultRepositoryId !== taskRepositoryId
      || resultRepositoryId !== packageRepositoryId
    ) {
      throw new Error("target-result-assignment-mismatch");
    }
    validateDemandTaskAssignmentAgainstTopology({
      artifact: record,
      config: snapshot,
      workType: taskPackage.workType,
    });
  }
}

// 在一个state-root lock内读取core、artifact、evidence和result authority，防止混合不同revision的事实。
function collectOneDemand({ snapshot, stateRoot, demandId, bundle, language }) {
  let locked;
  try {
    locked = withStateRootLock(stateRoot, () => {
      const loaded = loadDemandCoreRecordsWhileLocked({
        stateRoot,
        expectedProgramId: snapshot.model.program.programId,
        ledgerRoot: snapshot.ledgerRoot,
      });
      if (loaded.state.state === "archived") {
        return { loaded, archived: true };
      }
      const assignmentClosure = validateAssignments(loaded, snapshot);
      const rootStorageIssues = inspectDemandRootResidue(loaded);
      const expectedArtifacts = expectedArtifactTuples(loaded.events);
      const artifactInventory = inspectDemandArtifactInventory({
        stateRoot,
        expectedProgramId: loaded.demand.programId,
        expectedDemandId: loaded.demand.demandId,
        expectedArtifacts,
      });
      const expectedEvidence = expectedEvidenceTuples(loaded.events);
      const evidenceInventory = inspectManagedEvidenceInventory({
        stateRoot,
        expectedProgramId: loaded.demand.programId,
        expectedDemandId: loaded.demand.demandId,
        expectedDemandDigest: loaded.digests.demand,
        expectedEvidence,
      });
      const artifacts = classifyInventoryIssues(
        artifactInventory.issues,
        new Set(expectedArtifacts.map((entry) => entry.ref)),
        demandId,
        "artifacts",
      );
      const evidence = classifyInventoryIssues(
        evidenceInventory.issues,
        new Set(expectedEvidence.map((entry) => entry.ref)),
        demandId,
        "evidence",
      );
      const recoveryIssues = [...artifacts.recoveryIssues, ...evidence.recoveryIssues];
      const authorityIssues = [...artifacts.authorityIssues, ...evidence.authorityIssues];
      const resultAuthority = recoveryIssues.length === 0 && authorityIssues.length === 0
        ? buildTargetResultAuthoritySnapshotFromLoaded(loaded)
        : null;
      if (resultAuthority) {
        validateResultAssignments(loaded, snapshot, assignmentClosure.packages, resultAuthority);
      }
      const artifactCounts = {};
      for (const entry of artifactInventory.entries) {
        artifactCounts[entry.artifactKind] = (artifactCounts[entry.artifactKind] ?? 0) + 1;
      }
      const targetTaskRoots = new Set(artifactInventory.entries
        .filter((entry) => entry.artifactKind === "wakeflow-target-result")
        .map((entry) => entry.ref.split("/").slice(0, 2).join("/")));
      return {
        loaded,
        assignments: assignmentClosure.assignments,
        resultAuthority,
        storageInventory: {
          authorityPresent: loaded.authority !== null,
          capabilityRoots: expandedCapabilityRoots(
            wakeflowDemandCapabilityRoots(loaded.demand.executionPlacement),
          ),
          artifactCounts,
          targetTaskRootCount: targetTaskRoots.size,
          evidenceCount: evidenceInventory.entries.length,
        },
        recoveryIssues,
        authorityIssues,
        storageIssues: [...rootStorageIssues, ...artifacts.storageIssues, ...evidence.storageIssues],
      };
    });
  } catch (cause) {
    const health = healthForCause(cause);
    return {
      health,
      demand: Object.freeze({
        demandId,
        status: health === "recovery-required" ? "recovery-required" : "degraded",
      }),
      issues: [issue(
        health === "recovery-required" ? "recovery-required" : "authority-unhealthy",
        `.wakeflow-active/current/${demandId}`,
        demandId,
      )],
      storageIssues: [],
    };
  }

  if (locked.archived) {
    return {
      health: "degraded",
      demand: Object.freeze({ demandId, status: "archived-current-residue" }),
      issues: [issue("archived-current-residue", `.wakeflow-active/current/${demandId}`, demandId)],
      storageIssues: [],
    };
  }

  if (locked.recoveryIssues.length > 0) {
    return {
      health: "recovery-required",
      demand: Object.freeze({ demandId, status: "recovery-required" }),
      issues: [...locked.recoveryIssues, ...locked.authorityIssues],
      storageIssues: locked.storageIssues,
    };
  }

  if (locked.authorityIssues.length > 0) {
    return {
      health: "degraded",
      demand: Object.freeze({ demandId, status: "degraded" }),
      issues: locked.authorityIssues,
      storageIssues: locked.storageIssues,
    };
  }

  const { loaded } = locked;
  const documents = buildWakeflowDemandDocuments({
    bundle,
    language,
    demand: loaded.demand,
    authority: loaded.authority,
    state: loaded.state,
    events: loaded.events,
  });
  const nextRefs = [
    "wakeflow-state.json",
    ...selectWakeflowStateSelectedArtifacts(loaded.state).map((entry) => entry.ref),
  ];
  const blocked = loaded.state.state === "blocked"
    || loaded.state.targetTasks.some((entry) => entry.lifecycleStatus === "blocked")
    || locked.resultAuthority.review.current.blocked.length > 0;

  return {
    health: "complete",
    demand: deepFreeze({
      demandId,
      title: loaded.demand.title,
      state: loaded.state.state,
      blocked,
      revision: loaded.state.revision,
      authority: loaded.authority === null ? "pending" : "frozen",
      placement: loaded.demand.executionPlacement.mode,
      assignments: locked.assignments,
      nextRefs: [...new Set(nextRefs)].sort(lexicalCompare),
      source: {
        demandDigest: loaded.digests.demand,
        authorityDigest: loaded.digests.authority,
        stateDigest: loaded.digests.state,
        eventHistoryDigest: canonicalJsonDigest(loaded.events),
        eventId: loaded.state.lastEvent.eventId,
        eventDigest: loaded.state.lastEvent.eventDigest,
        documentFingerprint: documents.source.fingerprint,
        resultSetDigest: locked.resultAuthority.review.current.resultSetDigest,
      },
      progress: {
        targetTaskCount: locked.resultAuthority.targetTasks.length,
        currentResultCount: locked.resultAuthority.review.current.results.length,
        readyResultCount: locked.resultAuthority.review.current.ready.length,
        blockedResultCount: locked.resultAuthority.review.current.blocked.length,
        pendingResultCount: locked.resultAuthority.review.current.missing.length,
        closedTargetCount: locked.resultAuthority.review.current.closed.length,
      },
      storageInventory: locked.storageInventory,
    }),
    documents,
    issues: [],
    storageIssues: locked.storageIssues,
  };
}

// ==================== 四、workspace级collection、渲染与来源指纹 ====================

/**
 * 收集一次workspace投影来源。
 * sourceHealth决定能否重写投影；storageHealth只报告未被authority引用的退化，不擅自改变业务状态。
 */
function initialCollection(values, {
  snapshot: providedSnapshot = null,
  emptyDemandSet = false,
  ignoredProjectionStageRefs = [],
} = {}) {
  const ignoredStageRefs = new Set(ignoredProjectionStageRefs);
  let snapshot;
  if (providedSnapshot === null) {
    try {
      snapshot = loadWakeflowConfigV3Snapshot({ workspaceRoot: values.workspaceRoot });
    } catch {
      return {
        snapshot: null,
        demandSet: "unknown",
        sourceHealth: "unreadable",
        storageHealth: "degraded",
        orientation: "degraded",
        demands: [],
        documents: [],
        issues: [issue("source-unreadable", CONFIG_REF)],
        storageIssues: [],
      };
    }
  } else {
    snapshot = providedSnapshot;
  }
  const configuredLanguage = snapshot.model.program.interfaceLanguage;
  if (configuredLanguage !== "auto" && configuredLanguage !== values.language) {
    fail("wakeflow-active-projector-language", "language conflicts with the explicit current config", {
      path: "$/language",
    });
  }
  if (emptyDemandSet) {
    return {
      snapshot,
      activeProjectionLockPresent: false,
      demandSet: "empty",
      sourceHealth: "complete",
      storageHealth: "healthy",
      orientation: "idle",
      demands: [],
      documents: [],
      issues: [],
      storageIssues: [],
    };
  }

  const activeRoot = path.join(snapshot.workspaceRoot, ACTIVE_ROOT_REF);
  const currentRoot = path.join(activeRoot, "current");
  let activeEntries;
  let currentEntries;
  try {
    activeEntries = stableDirectoryEntries(activeRoot);
    currentEntries = stableDirectoryEntries(currentRoot);
  } catch {
    return {
      snapshot,
      demandSet: "unknown",
      sourceHealth: "unreadable",
      storageHealth: "degraded",
      orientation: "degraded",
      demands: [],
      documents: [],
      issues: [issue("source-unreadable", CURRENT_ROOT_REF)],
      storageIssues: [],
    };
  }

  const issues = [];
  const storageIssues = [];
  const activeProjectionLockPresent = activeEntries.some((entry) => entry.name === "projector.lock");
  let sourceHealth = "complete";
  for (const entry of activeEntries) {
    if (["current", "index.md", "projector.lock"].includes(entry.name)) continue;
    if (ignoredStageRefs.has(`${ACTIVE_ROOT_REF}/${entry.name}`)) continue;
    if (entry.name === "current.identity-lock") {
      sourceHealth = "recovery-required";
      issues.push(issue("recovery-required", `${ACTIVE_ROOT_REF}/current.identity-lock`));
      continue;
    }
    storageIssues.push(issue("storage-degraded", opaqueUnknownRef(ACTIVE_ROOT_REF, entry.name)));
  }

  const typedDemandRootNames = new Set(currentEntries
    .filter((entry) => DEMAND_ID_RE.test(entry.name) && entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name));
  const demandEntries = [];
  for (const entry of currentEntries) {
    if (["global-todo-board.md", "workspace-current-status.md"].includes(entry.name)) continue;
    if (ignoredStageRefs.has(`${CURRENT_ROOT_REF}/${entry.name}`)) continue;
    const createLock = entry.name.match(DEMAND_CREATE_LOCK_RE);
    if (createLock) {
      sourceHealth = "recovery-required";
      issues.push(issue("recovery-required", `${CURRENT_ROOT_REF}/${createLock[1]}`, createLock[1]));
      continue;
    }
    const stateLock = entry.name.match(DEMAND_STATE_LOCK_RE);
    if (stateLock) {
      if (!typedDemandRootNames.has(stateLock[1])) {
        sourceHealth = "recovery-required";
        issues.push(issue("recovery-required", `${CURRENT_ROOT_REF}/${stateLock[1]}`, stateLock[1]));
      }
      continue;
    }
    const intent = entry.name.match(CREATE_INTENT_RE);
    const stage = entry.name.match(CREATE_STAGE_RE);
    const archiveIntent = entry.name.match(ARCHIVE_INTENT_RE);
    const archiveTombstone = entry.name.match(ARCHIVE_TOMBSTONE_RE);
    if (
      intent
      || stage
      || archiveIntent
      || archiveTombstone
      || entry.name.includes(".wakeflow-stage-")
    ) {
      sourceHealth = "recovery-required";
      const demandId = intent?.[1]
        ?? stage?.[1]
        ?? archiveIntent?.[1]
        ?? archiveTombstone?.[1]
        ?? null;
      issues.push(issue("recovery-required", demandId
        ? `${CURRENT_ROOT_REF}/${demandId}`
        : opaqueUnknownRef(CURRENT_ROOT_REF, entry.name), demandId));
      continue;
    }
    if (DEMAND_ID_RE.test(entry.name)) {
      try {
        assertWakeflowId(entry.name, "demand", "$demandId");
      } catch {
        sourceHealth = sourceHealth === "recovery-required" ? sourceHealth : "degraded";
        issues.push(issue("authority-unhealthy", `${CURRENT_ROOT_REF}/${entry.name}`, entry.name));
        continue;
      }
      demandEntries.push(entry);
      continue;
    }
    if (entry.isDirectory() || entry.isSymbolicLink()) {
      if (sourceHealth === "complete") sourceHealth = "degraded";
      issues.push(issue(
        "authority-unhealthy",
        opaqueUnknownRef(CURRENT_ROOT_REF, entry.name),
      ));
      continue;
    }
    storageIssues.push(issue("storage-degraded", opaqueUnknownRef(CURRENT_ROOT_REF, entry.name)));
  }

  const demands = [];
  const documents = [];
  for (const entry of demandEntries.sort((left, right) => lexicalCompare(left.name, right.name))) {
    const stateRoot = path.join(currentRoot, entry.name);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      if (sourceHealth !== "recovery-required") sourceHealth = "degraded";
      demands.push(Object.freeze({ demandId: entry.name, status: "degraded" }));
      issues.push(issue("authority-unhealthy", `${CURRENT_ROOT_REF}/${entry.name}`, entry.name));
      continue;
    }
    const collected = collectOneDemand({
      snapshot,
      stateRoot,
      demandId: entry.name,
      bundle: values.bundle,
      language: values.language,
    });
    demands.push(collected.demand);
    storageIssues.push(...collected.storageIssues);
    if (collected.health !== "complete") {
      if (collected.health === "recovery-required") sourceHealth = "recovery-required";
      else if (sourceHealth === "complete") sourceHealth = "degraded";
      issues.push(...collected.issues);
    } else {
      documents.push(Object.freeze({ demandId: entry.name, documents: collected.documents }));
    }
  }

  demands.sort((left, right) => lexicalCompare(left.demandId, right.demandId));
  issues.sort((left, right) => lexicalCompare(`${left.ref}\u0000${left.code}`, `${right.ref}\u0000${right.code}`));
  storageIssues.sort((left, right) => lexicalCompare(`${left.ref}\u0000${left.code}`, `${right.ref}\u0000${right.code}`));
  const orientation = sourceHealth !== "complete"
    ? "degraded"
    : demands.length === 0
      ? "idle"
      : demands.some((entry) => entry.blocked === true)
        ? "blocked"
        : "active";
  return {
    snapshot,
    activeProjectionLockPresent,
    demandSet: demandEntries.length === 0 ? "empty" : "nonempty",
    sourceHealth,
    storageHealth: storageIssues.length === 0 ? "healthy" : "degraded",
    orientation,
    demands,
    documents,
    issues,
    storageIssues,
  };
}

function renderWorkspaceIndex({ collection, fingerprint, language }) {
  const locale = LOCALES[language];
  const ledgerTarget = path.posix.relative(
    ACTIVE_ROOT_REF,
    path.posix.join(collection.snapshot.model.storage.ledgerRoot, "workspace/workspace-record-map.md"),
  );
  return canonicalMarkdown([
    `# ${safeHeading(collection.snapshot.model.program.displayName)} — ${locale.indexTitle}`,
    "",
    activeMarker(fingerprint),
    "",
    `> ${locale.indexNotice}`,
    "",
    `- ${locale.program}: ${code(collection.snapshot.model.program.displayName)}`,
    `- ${locale.programId}: ${code(collection.snapshot.model.program.programId)}`,
    `- ${link(locale.status, "current/workspace-current-status.md")}`,
    `- ${link(locale.todo, "current/global-todo-board.md")}`,
    `- ${link(locale.ledger, ledgerTarget)}`,
    "",
    `## ${locale.demands}`,
    "",
    ...(collection.demands.length === 0
      ? [locale.noDemands]
      : collection.demands.map((entry) => (
          `- ${link(code(entry.demandId), `current/${entry.demandId}/`)}`
        ))),
  ].join("\n"));
}

function renderAssignments(assignments, locale) {
  if (assignments.length === 0) return [`  - ${locale.noAssignments}`];
  return assignments.map((entry) => [
    `  - ${code(entry.targetTaskId)} → ${code(entry.windowId)}`,
    ...(entry.repositoryId ? [`; ${code(entry.repositoryId)}`] : []),
    `; ${code(entry.lifecycleStatus)}`,
  ].join(""));
}

function renderWorkspaceStatus({ collection, fingerprint, language }) {
  const locale = LOCALES[language];
  const demandSections = collection.demands.flatMap((entry) => [
    `## ${safeHeading(entry.title)} — ${code(entry.demandId)}`,
    "",
    `- ${locale.state}: ${code(entry.state)}`,
    `- ${locale.revision}: ${code(entry.revision)}`,
    `- ${locale.authority}: ${code(entry.authority === "frozen" ? locale.frozen : locale.pending)}`,
    `- ${locale.placement}: ${code(entry.placement)}`,
    `- ${locale.assignments}:`,
    ...renderAssignments(entry.assignments, locale),
    `- ${locale.exactState}: ${link("wakeflow-state.json", `${entry.demandId}/wakeflow-state.json`)}`,
    `- ${locale.nextAuthority}:`,
    ...entry.nextRefs.map((ref) => `  - ${link(code(ref), `${entry.demandId}/${ref}`)}`),
    `- ${locale.nextAction}: ${locale.readState}`,
    "",
  ]);
  return canonicalMarkdown([
    `# ${locale.statusTitle}`,
    "",
    activeMarker(fingerprint),
    "",
    `> ${locale.statusNotice}`,
    "",
    `- ${locale.status}: ${code(collection.orientation)}`,
    `- ${locale.programId}: ${code(collection.snapshot.model.program.programId)}`,
    `- ${locale.source}: ${code(fingerprint)}`,
    `- ${locale.nextAction}: ${collection.demands.length === 0 ? locale.inspectTodo : locale.readState}`,
    "",
    ...demandSections,
  ].join("\n"));
}

// 只在来源完整时生成文件；fingerprint绑定全部权威与模板摘要，但有意忽略TODO/local/mtime等非来源事实。
function buildProjectionPlan(values, collectionOptions = undefined) {
  const collection = initialCollection(values, collectionOptions);
  if (collection.sourceHealth !== "complete") {
    return deepFreeze({
      collection,
      authoritySourceDigest: null,
      fingerprint: null,
      files: [],
    });
  }
  const templateId = values.language === "zh" ? "progress.demand.zh-CN" : "progress.demand.en";
  const authoritySourceDigest = canonicalJsonDigest({
    artifactKind: "wakeflow-active-authority-source",
    schemaVersion: 1,
    configDigest: collection.snapshot.configDigest,
    demands: collection.demands.map((entry) => ({
      demandId: entry.demandId,
      revision: entry.revision,
      stateDigest: entry.source.stateDigest,
      eventId: entry.source.eventId,
      eventDigest: entry.source.eventDigest,
    })),
  });
  const fingerprint = canonicalJsonDigest({
    artifactKind: "wakeflow-active-projection-source",
    schemaVersion: 1,
    projectorSchemaVersion: WAKEFLOW_ACTIVE_PROJECTOR_SCHEMA_VERSION,
    language: values.language,
    configDigest: collection.snapshot.configDigest,
    template: {
      assetId: templateId,
      digest: values.bundle.assets[templateId].sha256,
    },
    authoritySourceDigest,
    demands: collection.demands.map((entry) => ({
      demandId: entry.demandId,
      demandDigest: entry.source.demandDigest,
      authorityDigest: entry.source.authorityDigest,
      stateDigest: entry.source.stateDigest,
      eventHistoryDigest: entry.source.eventHistoryDigest,
      revision: entry.revision,
      eventId: entry.source.eventId,
      eventDigest: entry.source.eventDigest,
      documentFingerprint: entry.source.documentFingerprint,
      resultSetDigest: entry.source.resultSetDigest,
    })),
  });
  const workspaceIndex = renderWorkspaceIndex({ collection, fingerprint, language: values.language });
  const workspaceStatus = renderWorkspaceStatus({ collection, fingerprint, language: values.language });
  const demandFiles = collection.documents.flatMap(({ demandId, documents }) => [
    {
      ref: `${CURRENT_ROOT_REF}/${demandId}/index.md`,
      content: documents.files["index.md"].content,
      digest: documents.files["index.md"].digest,
      kind: "demand",
    },
    {
      ref: `${CURRENT_ROOT_REF}/${demandId}/developer-progress.md`,
      content: documents.files["developer-progress.md"].content,
      digest: documents.files["developer-progress.md"].digest,
      kind: "demand",
    },
  ]).sort((left, right) => lexicalCompare(left.ref, right.ref));
  return deepFreeze({
    collection,
    authoritySourceDigest,
    fingerprint,
    files: [
      ...demandFiles,
      { ref: WORKSPACE_STATUS_REF, content: workspaceStatus, digest: sha256Text(workspaceStatus), kind: "active" },
      { ref: WORKSPACE_INDEX_REF, content: workspaceIndex, digest: sha256Text(workspaceIndex), kind: "active" },
    ],
  });
}

// ==================== 五、投影目标检查、公开库存与窄范围重建 ====================

function sameStableFile(left, right) {
  return left.isFile()
    && right.isFile()
    && left.nlink === 1n
    && right.nlink === 1n
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function readProjectionFile(file) {
  const before = lstatSync(file, { bigint: true });
  if (
    before.isSymbolicLink()
    || !before.isFile()
    || before.nlink !== 1n
    || before.size > BigInt(MAX_PROJECTION_BYTES)
    || (process.platform !== "win32" && Number(before.mode & 0o777n) !== FILE_MODE)
  ) {
    throw new Error("unsafe-projection-target");
  }
  let descriptor;
  try {
    descriptor = openSync(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch {
    throw new Error("unsafe-projection-target");
  }
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (!sameStableFile(before, opened)) throw new Error("unsafe-projection-target");
    const bytes = readFileSync(descriptor);
    const after = lstatSync(file, { bigint: true });
    if (!sameStableFile(opened, after) || opened.size !== BigInt(bytes.length)) {
      throw new Error("unsafe-projection-target");
    }
    let content;
    try {
      content = UTF8_FATAL.decode(bytes);
    } catch {
      throw new Error("unsafe-projection-target");
    }
    return {
      content,
      digest: `sha256:${sha256Bytes(bytes)}`,
    };
  } finally {
    closeSync(descriptor);
  }
}

function inspectTarget(workspaceRoot, expected) {
  const file = path.join(workspaceRoot, ...expected.ref.split("/"));
  let stat;
  try {
    stat = lstatSync(file, { bigint: true });
  } catch (cause) {
    if (cause?.code === "ENOENT") {
      return Object.freeze({ ref: expected.ref, status: "missing", currentDigest: null, expectedDigest: expected.digest });
    }
    return Object.freeze({ ref: expected.ref, status: "unsafe", currentDigest: null, expectedDigest: expected.digest });
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1n) {
    return Object.freeze({ ref: expected.ref, status: "unsafe", currentDigest: null, expectedDigest: expected.digest });
  }
  let current;
  try {
    current = readProjectionFile(file);
  } catch {
    return Object.freeze({ ref: expected.ref, status: "unsafe", currentDigest: null, expectedDigest: expected.digest });
  }
  if (current.digest === expected.digest) {
    return Object.freeze({ ref: expected.ref, status: "current", currentDigest: current.digest, expectedDigest: expected.digest });
  }
  const managed = expected.kind === "active"
    ? ACTIVE_MARKER_RE.test(current.content)
    : DEMAND_MARKER_RE.test(current.content);
  return Object.freeze({
    ref: expected.ref,
    status: managed ? "stale" : "unsafe",
    currentDigest: current.digest,
    expectedDigest: expected.digest,
  });
}

// 先检查全部目标，任何unmanaged/symlink/hard-link目标都会使整轮写入保持零写入。
function inspectPlanTargets(plan) {
  if (plan.collection.sourceHealth !== "complete") {
    return Object.freeze({ status: "stale", targets: Object.freeze([]) });
  }
  const targets = plan.files.map((entry) => inspectTarget(plan.collection.snapshot.workspaceRoot, entry));
  const status = targets.some((entry) => entry.status === "unsafe")
    ? "unsafe"
    : targets.every((entry) => entry.status === "current")
      ? "current"
      : targets.every((entry) => entry.status === "missing")
        ? "missing"
        : "stale";
  return Object.freeze({ status, targets: Object.freeze(targets) });
}

function publicResult(plan, targetInspection, { operation, writeStatus = null, written = [], extraIssues = [] } = {}) {
  const collection = plan.collection;
  const axes = deepFreeze({
    demandSet: collection.demandSet,
    sourceHealth: collection.sourceHealth,
    storageHealth: collection.storageHealth,
    orientation: collection.orientation,
    projectionStatus: targetInspection.status,
  });
  const safeDemands = collection.demands.map((entry) => deepFreeze({
    demandId: entry.demandId,
    status: entry.status ?? entry.state ?? "unknown",
    ...(entry.title === undefined ? {} : { title: entry.title }),
    ...(entry.revision === undefined ? {} : { revision: entry.revision }),
    ...(entry.authority === undefined ? {} : { authority: entry.authority }),
    ...(entry.placement === undefined ? {} : { placement: entry.placement }),
    ...(entry.progress === undefined ? {} : { progress: entry.progress }),
  }));
  const issues = [...collection.issues, ...collection.storageIssues, ...extraIssues]
    .sort((left, right) => lexicalCompare(`${left.ref}\u0000${left.code}`, `${right.ref}\u0000${right.code}`));
  return deepFreeze({
    kind: operation === "rebuild" ? "WakeflowActiveProjectionRebuildResult" : "WakeflowActiveProjectionInspection",
    schemaVersion: WAKEFLOW_ACTIVE_PROJECTOR_SCHEMA_VERSION,
    operation,
    axes,
    ...(writeStatus === null ? {} : { writeStatus }),
    source: {
      authorityDigest: plan.authoritySourceDigest,
      fingerprint: plan.fingerprint,
    },
    // configDigest 只公开规范化语义摘要，用于上层 observation 证明 active
    // inventory 与同一份配置权威一致；不公开 workspaceRoot 或配置原文。
    configDigest: collection.snapshot?.configDigest ?? null,
    storageInventory: activeStorageInventory(collection, targetInspection),
    program: collection.snapshot === null ? null : {
      programId: collection.snapshot.model.program.programId,
      displayName: collection.snapshot.model.program.displayName,
    },
    demands: safeDemands,
    targets: targetInspection.targets,
    written: [...written].sort(lexicalCompare),
    issues,
  });
}

function mergeInventoryHealth(current, next) {
  const rank = new Map([
    ["current", 0],
    ["missing", 1],
    ["digest-mismatch", 2],
    ["blocked-reference", 3],
    ["schema-invalid", 4],
  ]);
  return (rank.get(next) ?? 4) > (rank.get(current) ?? 4) ? next : current;
}

function activeStorageInventory(collection, targetInspection) {
  const counts = new Map();
  const health = new Map();
  const initialize = (key) => {
    counts.set(key, 0);
    health.set(key, "current");
  };
  for (const key of [
    "event.active.projector.lock",
    "event.demand.root",
    "event.demand.identity",
    "event.demand.authority",
    "event.demand.state",
    "event.demand.controller-events",
    "event.demand.index",
    "event.demand.progress",
    "event.demand.task-package",
    "event.demand.target-results.target-task-root",
    "event.demand.target-result",
    "event.demand.review-candidate",
    "event.demand.test-card",
    "event.demand.evidence.artifact-root",
    "event.demand.evidence.manifest",
    "event.demand.evidence.payload",
    "event.demand.pod.design-request",
    "event.demand.pod.design-handoff",
    ...DEMAND_OPERATION_EVENT_KEYS,
    ...ALL_DEMAND_CAPABILITY_ROOTS.map((root) => (
      `event.demand.${root.replaceAll("/", ".")}.root`
    )),
  ]) initialize(key);

  if (
    collection.sourceHealth !== "complete"
    || collection.storageHealth !== "healthy"
    || collection.demands.some((entry) => entry.storageInventory === undefined)
  ) {
    const unsigned = { status: "unavailable", entries: [] };
    return deepFreeze({ ...unsigned, inventoryDigest: canonicalJsonDigest(unsigned) });
  }

  const add = (key, count, itemHealth = "current") => {
    counts.set(key, (counts.get(key) ?? 0) + count);
    health.set(key, mergeInventoryHealth(health.get(key) ?? "current", itemHealth));
  };
  if (collection.activeProjectionLockPresent) {
    add("event.active.projector.lock", 1, "blocked-reference");
  }
  for (const demand of collection.demands) {
    add("event.demand.root", 1);
    add("event.demand.identity", 1);
    add("event.demand.authority", demand.storageInventory.authorityPresent ? 1 : 0);
    add("event.demand.state", 1);
    add("event.demand.controller-events", 1);
    for (const root of demand.storageInventory.capabilityRoots) {
      add(`event.demand.${root.replaceAll("/", ".")}.root`, 1);
    }
    for (const [kind, count] of Object.entries(demand.storageInventory.artifactCounts)) {
      const key = DEMAND_ARTIFACT_KEY_BY_KIND[kind];
      if (key) add(key, count);
    }
    add(
      "event.demand.target-results.target-task-root",
      demand.storageInventory.targetTaskRootCount,
    );
    for (const key of [
      "event.demand.evidence.artifact-root",
      "event.demand.evidence.manifest",
      "event.demand.evidence.payload",
    ]) add(key, demand.storageInventory.evidenceCount);
  }

  const projectionKey = (ref) => ref.endsWith("/index.md")
    ? "event.demand.index"
    : ref.endsWith("/developer-progress.md")
      ? "event.demand.progress"
      : null;
  for (const target of targetInspection.targets) {
    const key = projectionKey(target.ref);
    if (key === null || !target.ref.startsWith(`${CURRENT_ROOT_REF}/demand_`)) continue;
    const targetHealth = target.status === "current"
      ? "current"
      : target.status === "missing"
        ? "missing"
        : target.status === "stale"
          ? "digest-mismatch"
          : "schema-invalid";
    add(key, target.status === "missing" ? 0 : 1, targetHealth);
  }

  const entries = [...counts]
    .map(([key, count]) => ({ key, count, health: health.get(key) ?? "current" }))
    .sort((left, right) => lexicalCompare(left.key, right.key));
  const unsigned = { status: "observed", entries };
  return deepFreeze({ ...unsigned, inventoryDigest: canonicalJsonDigest(unsigned) });
}

function inspectInternal(values) {
  const plan = buildProjectionPlan(values);
  return publicResult(plan, inspectPlanTargets(plan), { operation: "inspect" });
}

// plan signature是同一轮双重来源读取的CAS依据，不承担跨进程状态权威。
function planSignature(plan) {
  if (plan.collection.sourceHealth !== "complete") return null;
  return canonicalJsonDigest({
    fingerprint: plan.fingerprint,
    refs: plan.files.map((entry) => ({ ref: entry.ref, digest: entry.digest })),
  });
}

function writeProjectionFiles(plan, targetInspection, written) {
  const targetByRef = new Map(targetInspection.targets.map((entry) => [entry.ref, entry]));
  for (const entry of plan.files) {
    const current = targetByRef.get(entry.ref);
    if (current.status === "current") continue;
    const expectation = current.status === "missing"
      ? { type: "absent" }
      : { type: "file", sha256: current.currentDigest.slice("sha256:".length) };
    atomicWriteFile({
      root: plan.collection.snapshot.workspaceRoot,
      target: path.join(plan.collection.snapshot.workspaceRoot, ...entry.ref.split("/")),
      content: entry.content,
      expectation,
      mode: FILE_MODE,
      label: "active projection target",
    });
    written.push(entry.ref);
  }
  return written;
}

function hasSafeProjectionLockParent(snapshot) {
  if (snapshot === null) return false;
  try {
    const activeRoot = lstatSync(path.join(snapshot.workspaceRoot, ACTIVE_ROOT_REF));
    return activeRoot.isDirectory() && !activeRoot.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * 在workspace-wide projection lock内执行来源双重读取、全目标预检、逐文件CAS和写后来源复核。
 * 任一步失败只留下可识别的stale投影；不会回滚或改写任何authority。
 */
function rebuildInternal(values) {
  const initial = buildProjectionPlan(values);
  if (!hasSafeProjectionLockParent(initial.collection.snapshot)) {
    return publicResult(initial, inspectPlanTargets(initial), {
      operation: "rebuild",
      writeStatus: "preserved",
    });
  }
  return withWakeflowActiveProjectionLock(initial.collection.snapshot.workspaceRoot, () => {
    const plan = buildProjectionPlan(values);
    const targetInspection = inspectPlanTargets(plan);
    if (plan.collection.sourceHealth !== "complete" || targetInspection.status === "unsafe") {
      return publicResult(plan, targetInspection, {
        operation: "rebuild",
        writeStatus: "preserved",
      });
    }
    const rechecked = buildProjectionPlan(values);
    if (planSignature(plan) !== planSignature(rechecked)) {
      return publicResult(rechecked, inspectPlanTargets(rechecked), {
        operation: "rebuild",
        writeStatus: "source-stale",
        extraIssues: [issue("source-stale", CURRENT_ROOT_REF)],
      });
    }
    const recheckedTargets = inspectPlanTargets(rechecked);
    if (recheckedTargets.status === "unsafe") {
      return publicResult(rechecked, recheckedTargets, {
        operation: "rebuild",
        writeStatus: "preserved",
      });
    }
    const written = [];
    try {
      writeProjectionFiles(rechecked, recheckedTargets, written);
    } catch {
      const afterFailure = inspectPlanTargets(rechecked);
      return publicResult(rechecked, afterFailure, {
        operation: "rebuild",
        writeStatus: "stale",
        written,
        extraIssues: [issue("projection-write-failed", ACTIVE_ROOT_REF)],
      });
    }
    const afterSource = buildProjectionPlan(values);
    if (planSignature(rechecked) !== planSignature(afterSource)) {
      return publicResult(afterSource, inspectPlanTargets(afterSource), {
        operation: "rebuild",
        writeStatus: "source-stale",
        written,
        extraIssues: [issue("source-stale", CURRENT_ROOT_REF)],
      });
    }
    const afterTargets = inspectPlanTargets(afterSource);
    return publicResult(afterSource, afterTargets, {
      operation: "rebuild",
      writeStatus: written.length === 0 ? "current" : "rebuilt",
      written,
    });
  });
}

// ==================== 六、maintenance owner plan与纯aggregate投影 ====================

function maintenancePlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function maintenanceExactKeys(value, expected, label) {
  if (!maintenancePlainObject(value)) {
    fail("wakeflow-active-projector-maintenance-contract", `${label} must be a plain object`);
  }
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== expected.length
    || actual.some((key) => typeof key !== "string" || !expected.includes(key))
  ) {
    fail("wakeflow-active-projector-maintenance-contract", `${label} has an invalid field set`, {
      details: { expected, actual: actual.map(String) },
    });
  }
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(
        "wakeflow-active-projector-maintenance-contract",
        `${label}.${key} must be an enumerable data property`,
      );
    }
  }
  return value;
}

function maintenanceSnapshot(value, label) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch {
    fail("wakeflow-active-projector-maintenance-canonical", `${label} must be canonical JSON data`);
  }
}

function maintenanceSame(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function normalizeMaintenanceInput(value, { participant = false } = {}) {
  const expected = [
    "workspaceRoot",
    "action",
    "sourceModel",
    "desiredModel",
    "bundle",
    "language",
    ...(participant ? ["confirmedPlan"] : []),
  ];
  const input = maintenanceExactKeys(
    value,
    expected,
    participant
      ? "active projection maintenance participant input"
      : "active projection maintenance planning input",
  );
  if (
    typeof input.workspaceRoot !== "string"
    || !input.workspaceRoot.trim()
    || input.workspaceRoot !== input.workspaceRoot.trim()
  ) {
    fail("wakeflow-active-projector-maintenance-input", "workspaceRoot is required");
  }
  const workspaceRoot = path.resolve(input.workspaceRoot);
  if (!new Set(["fresh-initialize", "reconfigure", "reconcile"]).has(input.action)) {
    fail("wakeflow-active-projector-maintenance-input", "maintenance action is invalid");
  }
  const sourceModel = input.sourceModel === null
    ? null
    : parseWakeflowConfigV3(input.sourceModel);
  const desiredModel = parseWakeflowConfigV3(input.desiredModel);
  if (input.action === "fresh-initialize" && sourceModel !== null) {
    fail("wakeflow-active-projector-maintenance-input", "fresh-initialize requires sourceModel=null");
  }
  if (input.action !== "fresh-initialize" && sourceModel === null) {
    fail("wakeflow-active-projector-maintenance-input", `${input.action} requires a strict source model`);
  }
  if (sourceModel !== null && sourceModel.program.programId !== desiredModel.program.programId) {
    fail("wakeflow-active-projector-maintenance-input", "source and desired program identities differ");
  }
  if (
    input.action === "reconcile"
    && wakeflowConfigV3Digest(sourceModel) !== wakeflowConfigV3Digest(desiredModel)
  ) {
    fail("wakeflow-active-projector-maintenance-input", "reconcile cannot change config semantics");
  }
  if (!LANGUAGES.has(input.language)) {
    fail("wakeflow-active-projector-maintenance-input", "maintenance language must be en or zh");
  }
  try {
    assertParsedWakeflowAssetBundle(input.bundle);
  } catch {
    fail("wakeflow-active-projector-maintenance-input", "maintenance bundle must be parsed and frozen");
  }
  return {
    workspaceRoot,
    action: input.action,
    sourceModel,
    desiredModel,
    bundle: input.bundle,
    language: input.language,
    ...(participant ? { confirmedPlan: input.confirmedPlan } : {}),
  };
}

// maintenance在配置提交前使用desired model的合成快照；它不是普通runtime config authority缓存。
function maintenanceSyntheticSnapshot(normalized) {
  const model = normalized.desiredModel;
  return deepFreeze({
    workspaceRoot: normalized.workspaceRoot,
    model,
    indexes: buildWakeflowConfigV3Indexes(model),
    configDigest: wakeflowConfigV3Digest(model),
    ledgerRoot: path.resolve(normalized.workspaceRoot, model.storage.ledgerRoot),
  });
}

function maintenanceProjectionSource(normalized, confirmedPlan = null) {
  const values = {
    workspaceRoot: normalized.workspaceRoot,
    bundle: normalized.bundle,
    language: normalized.language,
  };
  const ignoredProjectionStageRefs = confirmedPlan === null
    ? []
    : confirmedPlan.payload.operations.map((operation) => (
        maintenanceStageRef(operation.ref, operation.operationId)
      ));
  return buildProjectionPlan(values, {
    snapshot: maintenanceSyntheticSnapshot(normalized),
    emptyDemandSet: normalized.action === "fresh-initialize",
    ignoredProjectionStageRefs,
  });
}

function maintenanceOperationId(ref) {
  const suffix = createHash("sha256").update(Buffer.from(ref, "utf8")).digest("hex").slice(0, 32);
  return `active-projection-${suffix}`;
}

function maintenanceResourceRef(programId, ref) {
  return `targets/program/${programId}/${ref}`;
}

function maintenanceStageRef(ref, operationId) {
  const directory = path.posix.dirname(ref);
  const basename = path.posix.basename(ref);
  const suffix = operationId.slice("active-projection-".length, "active-projection-".length + 16);
  return `${directory}/.${basename}.wakeflow-maintenance-${suffix}`;
}

function maintenanceNode(digest) {
  return { type: "file", mode: FILE_MODE_STRING, digest };
}

function maintenanceStep(operation, ordinal) {
  const stageRef = maintenanceStageRef(operation.ref, operation.operationId);
  return {
    stepId: operation.operationId,
    ordinal,
    stepKind: "create-or-update",
    source: { ref: operation.resourceRef, ...operation.source },
    staging: {
      ref: maintenanceResourceRef(operation.root.rootId, stageRef),
      ...operation.target,
    },
    final: { ref: operation.resourceRef, ...operation.target },
  };
}

function maintenanceSourceBlocker(code, ref, index) {
  return {
    blockerId: `active-projection-source-${String(index).padStart(4, "0")}`,
    operationId: null,
    resourceRef: ref,
    code,
  };
}

function deriveMaintenancePlan(normalized, confirmedPlan = null) {
  const projection = maintenanceProjectionSource(normalized, confirmedPlan);
  const targetInspection = inspectPlanTargets(projection);
  const programId = normalized.desiredModel.program.programId;
  const targetByRef = new Map(targetInspection.targets.map((entry) => [entry.ref, entry]));
  const operations = projection.files.map((entry) => {
    const inspected = targetByRef.get(entry.ref);
    const base = {
      operationId: maintenanceOperationId(entry.ref),
      componentId: "active-projection",
      owner: "active-projector",
      ref: entry.ref,
      resourceRef: maintenanceResourceRef(programId, entry.ref),
      root: { kind: "program", rootId: programId, basis: "target", configuredPath: "." },
      kind: entry.kind,
    };
    if (inspected.status === "current") {
      const node = maintenanceNode(entry.digest);
      return {
        ...base,
        classification: "managed-current",
        source: node,
        target: node,
        action: "current",
        reasonCode: "active-projection-current",
      };
    }
    if (inspected.status === "missing") {
      return {
        ...base,
        classification: "managed-missing",
        source: { type: "absent" },
        target: maintenanceNode(entry.digest),
        action: "create-managed",
        reasonCode: "active-projection-create",
      };
    }
    if (inspected.status === "stale") {
      return {
        ...base,
        classification: "managed-stale-known",
        source: maintenanceNode(inspected.currentDigest),
        target: maintenanceNode(entry.digest),
        action: "update-managed",
        reasonCode: "active-projection-refresh",
      };
    }
    return {
      ...base,
      classification: "conflict",
      source: { type: "unsafe", mode: null, digest: null },
      target: null,
      action: "blocked",
      reasonCode: "active-projection-target-unsafe",
    };
  });
  const sourceIssues = [...projection.collection.issues, ...projection.collection.storageIssues]
    .sort((left, right) => lexicalCompare(
      `${left.ref}\u0000${left.code}`,
      `${right.ref}\u0000${right.code}`,
    ));
  const sourceBlockers = sourceIssues.map((entry, index) => maintenanceSourceBlocker(
    entry.code,
    entry.ref,
    index,
  ));
  if (projection.collection.sourceHealth !== "complete" && sourceBlockers.length === 0) {
    sourceBlockers.push(maintenanceSourceBlocker("active-projection-source-incomplete", CURRENT_ROOT_REF, 0));
  }
  const operationBlockers = operations
    .filter((entry) => entry.action === "blocked")
    .map((entry) => ({
      blockerId: `active-projection-target-${entry.operationId}`,
      operationId: entry.operationId,
      resourceRef: entry.resourceRef,
      code: entry.reasonCode,
    }));
  const blockers = [...sourceBlockers, ...operationBlockers];
  const steps = operations
    .filter((entry) => new Set(["create-managed", "update-managed"]).has(entry.action))
    .map(maintenanceStep);
  const sourceSnapshot = {
    kind: "WakeflowActiveProjectionMaintenanceSource",
    schemaVersion: 1,
    action: normalized.action,
    programId,
    language: normalized.language,
    sourceModelDigest: normalized.sourceModel === null
      ? null
      : wakeflowConfigV3Digest(normalized.sourceModel),
    desiredModelDigest: wakeflowConfigV3Digest(normalized.desiredModel),
    authoritySourceDigest: projection.authoritySourceDigest,
    fingerprint: projection.fingerprint,
    demandSet: projection.collection.demandSet,
    sourceHealth: projection.collection.sourceHealth,
    storageHealth: projection.collection.storageHealth,
    issues: sourceIssues,
  };
  const payload = {
    kind: WAKEFLOW_ACTIVE_PROJECTION_MAINTENANCE_KIND,
    schemaVersion: WAKEFLOW_ACTIVE_PROJECTION_MAINTENANCE_SCHEMA_VERSION,
    action: normalized.action,
    status: blockers.length === 0 ? "ready" : "blocked",
    programId,
    language: normalized.language,
    sourceModelDigest: sourceSnapshot.sourceModelDigest,
    desiredModelDigest: sourceSnapshot.desiredModelDigest,
    authoritySourceDigest: projection.authoritySourceDigest,
    fingerprint: projection.fingerprint,
    sourceSnapshotDigest: canonicalJsonDigest(sourceSnapshot),
    operations,
    blockers,
    steps,
  };
  return {
    plan: validateActiveProjectionMaintenancePlanInternal({
      schemaId: WAKEFLOW_ACTIVE_PROJECTION_MAINTENANCE_SCHEMA_ID,
      payload,
    }),
    projection,
  };
}

function validateMaintenanceNode(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return value;
  if (!maintenancePlainObject(value) || typeof value.type !== "string") {
    fail("wakeflow-active-projector-maintenance-plan", `${label} must be one resource node`);
  }
  if (value.type === "absent") {
    maintenanceExactKeys(value, ["type"], label);
    return value;
  }
  if (value.type === "unsafe") {
    maintenanceExactKeys(value, ["type", "mode", "digest"], label);
    if (value.mode !== null || value.digest !== null) {
      fail("wakeflow-active-projector-maintenance-plan", `${label} unsafe node must be redacted`);
    }
    return value;
  }
  maintenanceExactKeys(value, ["type", "mode", "digest"], label);
  if (value.type !== "file" || value.mode !== FILE_MODE_STRING || !DIGEST_RE.test(value.digest)) {
    fail("wakeflow-active-projector-maintenance-plan", `${label} file node is invalid`);
  }
  return value;
}

function maintenanceProjectionKind(ref) {
  if (ref === WORKSPACE_INDEX_REF || ref === WORKSPACE_STATUS_REF) return "active";
  const segments = ref.split("/");
  if (
    segments.length !== 4
    || segments[0] !== ACTIVE_ROOT_REF
    || segments[1] !== "current"
    || !DEMAND_ID_RE.test(segments[2])
    || !new Set(["index.md", "developer-progress.md"]).has(segments[3])
  ) fail("wakeflow-active-projector-maintenance-plan", "maintenance projection ref is invalid");
  try {
    assertWakeflowId(segments[2], "demand", "$activeProjection/demandId");
  } catch {
    fail("wakeflow-active-projector-maintenance-plan", "maintenance projection demand identity is invalid");
  }
  return "demand";
}

// 每个公开operation必须能由ref重新得到identity、owner、root、kind和唯一合法动作语义。
function assertMaintenanceOperationSemantics(operation, payload) {
  const expectedRoot = {
    kind: "program",
    rootId: payload.programId,
    basis: "target",
    configuredPath: ".",
  };
  if (
    operation.operationId !== maintenanceOperationId(operation.ref)
    || operation.componentId !== "active-projection"
    || operation.owner !== "active-projector"
    || !maintenanceSame(operation.root, expectedRoot)
    || operation.kind !== maintenanceProjectionKind(operation.ref)
  ) fail("wakeflow-active-projector-maintenance-plan", "maintenance operation ownership is invalid");

  if (operation.action === "current") {
    if (
      operation.classification !== "managed-current"
      || !maintenanceSame(operation.source, operation.target)
      || operation.reasonCode !== "active-projection-current"
    ) fail("wakeflow-active-projector-maintenance-plan", "maintenance current operation is invalid");
    return;
  }
  if (operation.action === "create-managed") {
    if (
      operation.classification !== "managed-missing"
      || !maintenanceSame(operation.source, { type: "absent" })
      || operation.reasonCode !== "active-projection-create"
    ) fail("wakeflow-active-projector-maintenance-plan", "maintenance create operation is invalid");
    return;
  }
  if (operation.action === "update-managed") {
    if (
      operation.classification !== "managed-stale-known"
      || operation.source.type !== "file"
      || operation.target.type !== "file"
      || operation.source.digest === operation.target.digest
      || operation.reasonCode !== "active-projection-refresh"
    ) fail("wakeflow-active-projector-maintenance-plan", "maintenance update operation is invalid");
    return;
  }
  if (
    operation.action !== "blocked"
    || operation.classification !== "conflict"
    || !maintenanceSame(operation.source, { type: "unsafe", mode: null, digest: null })
    || operation.reasonCode !== "active-projection-target-unsafe"
  ) fail("wakeflow-active-projector-maintenance-plan", "maintenance blocked operation is invalid");
}

// workspace两文件和每个demand两文件都是不可拆分投影集合；动态demand全集还会在participant内复建比较。
function assertMaintenanceOperationRoster(payload) {
  if (payload.operations.length === 0) {
    if (
      payload.status !== "blocked"
      || payload.blockers.length === 0
      || payload.authoritySourceDigest !== null
      || payload.fingerprint !== null
    ) fail("wakeflow-active-projector-maintenance-plan", "empty maintenance projection roster is invalid");
    return;
  }
  const refs = new Set(payload.operations.map((entry) => entry.ref));
  if (!refs.has(WORKSPACE_INDEX_REF) || !refs.has(WORKSPACE_STATUS_REF)) {
    fail("wakeflow-active-projector-maintenance-plan", "workspace projection roster is incomplete");
  }
  if (payload.authoritySourceDigest === null || payload.fingerprint === null) {
    fail("wakeflow-active-projector-maintenance-plan", "projection source digests are missing");
  }
  const demandFiles = new Map();
  for (const ref of refs) {
    if (ref === WORKSPACE_INDEX_REF || ref === WORKSPACE_STATUS_REF) continue;
    const [, , demandId, basename] = ref.split("/");
    if (!demandFiles.has(demandId)) demandFiles.set(demandId, new Set());
    demandFiles.get(demandId).add(basename);
  }
  for (const files of demandFiles.values()) {
    if (!files.has("index.md") || !files.has("developer-progress.md") || files.size !== 2) {
      fail("wakeflow-active-projector-maintenance-plan", "demand projection roster is incomplete");
    }
  }
}

function validateActiveProjectionMaintenancePlanInternal(value) {
  const plan = maintenanceSnapshot(value, "active projection maintenance plan");
  maintenanceExactKeys(plan, ["schemaId", "payload"], "active projection maintenance plan");
  if (plan.schemaId !== WAKEFLOW_ACTIVE_PROJECTION_MAINTENANCE_SCHEMA_ID) {
    fail("wakeflow-active-projector-maintenance-plan", "maintenance schema identity is invalid");
  }
  const payloadKeys = [
    "kind", "schemaVersion", "action", "status", "programId", "language",
    "sourceModelDigest", "desiredModelDigest", "authoritySourceDigest", "fingerprint",
    "sourceSnapshotDigest", "operations", "blockers", "steps",
  ];
  maintenanceExactKeys(plan.payload, payloadKeys, "active projection maintenance payload");
  const payload = plan.payload;
  if (
    payload.kind !== WAKEFLOW_ACTIVE_PROJECTION_MAINTENANCE_KIND
    || payload.schemaVersion !== WAKEFLOW_ACTIVE_PROJECTION_MAINTENANCE_SCHEMA_VERSION
    || !new Set(["fresh-initialize", "reconfigure", "reconcile"]).has(payload.action)
    || !LANGUAGES.has(payload.language)
    || !DIGEST_RE.test(payload.desiredModelDigest)
    || !DIGEST_RE.test(payload.sourceSnapshotDigest)
    || (payload.sourceModelDigest !== null && !DIGEST_RE.test(payload.sourceModelDigest))
    || (payload.authoritySourceDigest !== null && !DIGEST_RE.test(payload.authoritySourceDigest))
    || (payload.fingerprint !== null && !DIGEST_RE.test(payload.fingerprint))
    || !Array.isArray(payload.operations)
    || !Array.isArray(payload.blockers)
    || !Array.isArray(payload.steps)
  ) {
    fail("wakeflow-active-projector-maintenance-plan", "maintenance metadata is invalid");
  }
  try {
    assertWakeflowId(payload.programId, "program", "$activeProjection/programId");
  } catch {
    fail("wakeflow-active-projector-maintenance-plan", "maintenance program identity is invalid");
  }
  if ((payload.action === "fresh-initialize") !== (payload.sourceModelDigest === null)) {
    fail("wakeflow-active-projector-maintenance-plan", "maintenance source model identity is inconsistent");
  }
  const operationIds = new Set();
  let previousRef = null;
  for (const operation of payload.operations) {
    const keys = [
      "operationId", "componentId", "owner", "ref", "resourceRef", "root", "kind",
      "classification", "source", "target", "action", "reasonCode",
    ];
    maintenanceExactKeys(operation, keys, "active projection maintenance operation");
    if (
      typeof operation.operationId !== "string"
      || operationIds.has(operation.operationId)
      || operation.componentId !== "active-projection"
      || operation.owner !== "active-projector"
      || typeof operation.ref !== "string"
      || !operation.ref.startsWith(`${ACTIVE_ROOT_REF}/`)
      || path.posix.isAbsolute(operation.ref)
      || operation.ref.split("/").some((segment) => !segment || segment === "." || segment === "..")
      || operation.resourceRef !== maintenanceResourceRef(payload.programId, operation.ref)
      || (previousRef !== null && lexicalCompare(previousRef, operation.ref) >= 0)
      || !new Set(["active", "demand"]).has(operation.kind)
      || !new Set(["current", "create-managed", "update-managed", "blocked"]).has(operation.action)
    ) {
      fail("wakeflow-active-projector-maintenance-plan", "maintenance operation is invalid");
    }
    previousRef = operation.ref;
    operationIds.add(operation.operationId);
    validateMaintenanceNode(operation.source, "active projection source");
    validateMaintenanceNode(operation.target, "active projection target", { nullable: true });
    if ((operation.action === "blocked") !== (operation.target === null)) {
      fail("wakeflow-active-projector-maintenance-plan", "maintenance operation target is inconsistent");
    }
    assertMaintenanceOperationSemantics(operation, payload);
  }
  const expectedSteps = payload.operations
    .filter((entry) => new Set(["create-managed", "update-managed"]).has(entry.action))
    .map(maintenanceStep);
  if (!maintenanceSame(payload.steps, expectedSteps)) {
    fail("wakeflow-active-projector-maintenance-plan", "maintenance steps are not derived");
  }
  const blockerIds = new Set();
  let sourceBlockerCount = 0;
  let reachedOperationBlockers = false;
  const operationBlockers = [];
  for (const blocker of payload.blockers) {
    maintenanceExactKeys(
      blocker,
      ["blockerId", "operationId", "resourceRef", "code"],
      "active projection maintenance blocker",
    );
    if (
      typeof blocker.blockerId !== "string"
      || blockerIds.has(blocker.blockerId)
      || (blocker.operationId !== null && !operationIds.has(blocker.operationId))
      || typeof blocker.resourceRef !== "string"
      || typeof blocker.code !== "string"
    ) {
      fail("wakeflow-active-projector-maintenance-plan", "maintenance blocker is invalid");
    }
    blockerIds.add(blocker.blockerId);
    if (blocker.operationId === null) {
      if (
        reachedOperationBlockers
        || blocker.blockerId !== `active-projection-source-${String(sourceBlockerCount).padStart(4, "0")}`
      ) fail("wakeflow-active-projector-maintenance-plan", "maintenance source blocker order is invalid");
      sourceBlockerCount += 1;
    } else {
      reachedOperationBlockers = true;
      operationBlockers.push(blocker);
    }
  }
  const expectedOperationBlockers = payload.operations
    .filter((entry) => entry.action === "blocked")
    .map((entry) => ({
      blockerId: `active-projection-target-${entry.operationId}`,
      operationId: entry.operationId,
      resourceRef: entry.resourceRef,
      code: entry.reasonCode,
    }));
  if (!maintenanceSame(operationBlockers, expectedOperationBlockers)) {
    fail("wakeflow-active-projector-maintenance-plan", "maintenance target blockers are not derived");
  }
  if (payload.status !== (payload.blockers.length === 0 ? "ready" : "blocked")) {
    fail("wakeflow-active-projector-maintenance-plan", "maintenance status is not derived");
  }
  assertMaintenanceOperationRoster(payload);
  return deepFreeze(plan);
}

/**
 * 生成maintenance owner plan。plan只携带digest和portable resource图，实际Markdown字节留在私有participant重建。
 */
export function planWakeflowActiveProjectionMaintenance(value) {
  const normalized = normalizeMaintenanceInput(value);
  const plan = deriveMaintenancePlan(normalized).plan;
  if (canonicalJson(plan).includes(normalized.workspaceRoot)) {
    fail("wakeflow-active-projector-maintenance-private", "maintenance plan leaked its workspace root");
  }
  return plan;
}

export function validateWakeflowActiveProjectionMaintenancePlan(value) {
  return validateActiveProjectionMaintenancePlanInternal(value);
}

// 将owner plan转换为aggregate action/check/step，不读取或写入workspace。
export function projectWakeflowActiveProjectionMaintenance(value) {
  const input = maintenanceExactKeys(
    value,
    ["plan", "transactionOffset"],
    "active projection aggregate input",
  );
  const plan = validateActiveProjectionMaintenancePlanInternal(input.plan);
  if (!Number.isSafeInteger(input.transactionOffset) || input.transactionOffset < 0) {
    fail("wakeflow-active-projector-maintenance-input", "transactionOffset must be a non-negative safe integer");
  }
  const planDigest = canonicalJsonDigest(plan);
  const stepIndex = new Map(plan.payload.steps.map((entry, index) => [entry.stepId, index]));
  const dependencyChecks = plan.payload.blockers.map((entry) => ({
    checkId: `active-projection-blocked-${entry.blockerId}`,
    componentId: "active-projection",
    owner: "active-projector",
    subject: { kind: "resource", value: entry.resourceRef },
    status: "blocked",
    code: entry.code,
    evidence: [{ kind: "owner-plan", ref: entry.resourceRef, digest: planDigest }],
  }));
  return deepFreeze({
    components: [{
      componentId: "active-projection",
      owner: "active-projector",
      ownerPlanDigest: planDigest,
    }],
    filesystemActions: plan.payload.operations
      .filter((entry) => entry.action !== "blocked")
      .map((entry) => {
        const index = stepIndex.get(entry.operationId);
        return {
          actionId: entry.operationId,
          componentId: entry.componentId,
          owner: entry.owner,
          root: entry.root,
          ref: entry.ref,
          resourceRef: entry.resourceRef,
          classification: entry.classification,
          source: entry.source,
          target: entry.target,
          action: entry.action,
          authorization: { kind: entry.action === "current" ? "none" : "wakeflow-owned" },
          reasonCode: entry.reasonCode,
          stepId: index === undefined ? null : entry.operationId,
          commitOrder: index === undefined ? null : input.transactionOffset + index,
        };
      }),
    dependencyChecks,
    preserved: [],
    deferredOwnerActions: dependencyChecks.map((entry) => ({
      deferredId: entry.checkId,
      componentId: entry.componentId,
      owner: entry.owner,
      action: "repair-active-projection-source",
      subject: entry.subject,
      prerequisiteCheckIds: [entry.checkId],
      reasonCode: entry.code,
    })),
    blockers: dependencyChecks.map((entry) => ({
      blockerId: entry.checkId,
      componentId: entry.componentId,
      owner: entry.owner,
      subject: entry.subject,
      code: entry.code,
      dependencyCheckId: entry.checkId,
    })),
    steps: plan.payload.steps.map((step, index) => ({
      ...step,
      ordinal: input.transactionOffset + index,
    })),
  });
}

// ==================== 七、维护来源复验、动态文件闭包与M3 participant ====================

function assertMaintenanceConfigAuthority(normalized, context = null) {
  try {
    assertWakeflowConfigV3TransitionAuthority({
      workspaceRoot: normalized.workspaceRoot,
      action: normalized.action,
      sourceModel: normalized.sourceModel,
      desiredModel: normalized.desiredModel,
      context,
    });
  } catch (cause) {
    fail("wakeflow-active-projector-maintenance-config", "strict config authority is unavailable", { cause });
  }
}

function inspectMaintenanceActiveDirectory(candidate) {
  try {
    const stat = lstatSync(candidate, { bigint: true });
    if (
      stat.isSymbolicLink()
      || !stat.isDirectory()
      || (process.platform !== "win32" && Number(stat.mode & 0o777n) !== 0o755)
    ) return { classification: "unsafe" };
    return { classification: "current" };
  } catch (cause) {
    return cause?.code === "ENOENT"
      ? { classification: "missing" }
      : { classification: "unsafe" };
  }
}

function assertFreshProjectionNamespace(normalized, confirmedPlan, context = null) {
  if (normalized.action !== "fresh-initialize") return;
  let todoTransition;
  try {
    todoTransition = inspectWakeflowFreshTodoTransitionAuthority({
      workspaceRoot: normalized.workspaceRoot,
      context,
    });
  } catch (cause) {
    fail("wakeflow-active-projector-maintenance-stale", "fresh TODO transition authority is unavailable", {
      cause,
    });
  }
  const activeRoot = path.join(normalized.workspaceRoot, ACTIVE_ROOT_REF);
  const rootInspection = inspectMaintenanceActiveDirectory(activeRoot);
  if (rootInspection.classification === "missing") return;
  if (rootInspection.classification !== "current") {
    fail("wakeflow-active-projector-maintenance-stale", "fresh active projection root is unsafe");
  }
  const allowedByDirectory = new Map([
    [ACTIVE_ROOT_REF, new Set(["current"])],
    [CURRENT_ROOT_REF, new Set(["global-todo-board.md"])],
  ]);
  if (todoTransition.status === "committed-pair") {
    allowedByDirectory.get(CURRENT_ROOT_REF).add(path.posix.basename(todoTransition.stageRef));
  }
  for (const operation of confirmedPlan.payload.operations) {
    const directoryRef = path.posix.dirname(operation.ref);
    const allowed = allowedByDirectory.get(directoryRef);
    if (!allowed) {
      fail("wakeflow-active-projector-maintenance-plan", "fresh projection target directory is invalid");
    }
    allowed.add(path.posix.basename(operation.ref));
    allowed.add(path.posix.basename(maintenanceStageRef(operation.ref, operation.operationId)));
  }
  for (const [directoryRef, allowed] of allowedByDirectory) {
    const directory = path.join(normalized.workspaceRoot, ...directoryRef.split("/"));
    const inspected = inspectMaintenanceActiveDirectory(directory);
    if (inspected.classification === "missing" && directoryRef === CURRENT_ROOT_REF) continue;
    if (inspected.classification !== "current") {
      fail("wakeflow-active-projector-maintenance-stale", "fresh projection directory is unsafe");
    }
    let entries;
    try {
      entries = readdirSync(directory);
    } catch {
      fail("wakeflow-active-projector-maintenance-stale", "fresh projection directory cannot be inspected");
    }
    if (entries.some((name) => !allowed.has(name))) {
      fail("wakeflow-active-projector-maintenance-stale", "fresh projection namespace contains unknown residue");
    }
  }
}

function assertMaintenanceSourceAuthority(normalized, confirmedPlan, context = null) {
  assertMaintenanceConfigAuthority(normalized, context);
  assertFreshProjectionNamespace(normalized, confirmedPlan, context);
  const current = deriveMaintenancePlan(normalized, confirmedPlan).plan;
  if (
    current.payload.sourceSnapshotDigest !== confirmedPlan.payload.sourceSnapshotDigest
    || current.payload.authoritySourceDigest !== confirmedPlan.payload.authoritySourceDigest
    || current.payload.fingerprint !== confirmedPlan.payload.fingerprint
    || current.payload.blockers.some((entry) => entry.operationId === null)
  ) {
    fail("wakeflow-active-projector-maintenance-stale", "active projection source changed since confirmation");
  }
}

function assertMaintenancePlanMatchesCurrentSource(normalized, confirmedPlan, derived) {
  const currentPlan = derived.plan;
  const expectedSourceModelDigest = normalized.sourceModel === null
    ? null
    : wakeflowConfigV3Digest(normalized.sourceModel);
  if (
    confirmedPlan.payload.action !== normalized.action
    || confirmedPlan.payload.programId !== normalized.desiredModel.program.programId
    || confirmedPlan.payload.language !== normalized.language
    || confirmedPlan.payload.sourceModelDigest !== expectedSourceModelDigest
    || confirmedPlan.payload.desiredModelDigest !== wakeflowConfigV3Digest(normalized.desiredModel)
    || confirmedPlan.payload.sourceSnapshotDigest !== currentPlan.payload.sourceSnapshotDigest
    || confirmedPlan.payload.authoritySourceDigest !== currentPlan.payload.authoritySourceDigest
    || confirmedPlan.payload.fingerprint !== currentPlan.payload.fingerprint
  ) fail("wakeflow-active-projector-maintenance-stale", "projection plan differs from its current authority source");

  const projectedRefs = derived.projection.files.map((entry) => entry.ref);
  const confirmedRefs = confirmedPlan.payload.operations.map((entry) => entry.ref);
  if (!maintenanceSame(confirmedRefs, projectedRefs)) {
    fail("wakeflow-active-projector-maintenance-plan", "confirmed projection plan omits current source files");
  }
  const currentByRef = new Map(currentPlan.payload.operations.map((entry) => [entry.ref, entry]));
  for (const operation of confirmedPlan.payload.operations) {
    const current = currentByRef.get(operation.ref);
    // create/update中断后可能处于prepared、committed或committed-pair；这些物理状态由
    // tracked-materialization按精确target/stage inode与digest复验，领域层不能把它提前误判成语义漂移。
    const delegatedPhysicalRecovery = current?.action === "blocked"
      && new Set(["create-managed", "update-managed"]).has(operation.action);
    const legalPhysicalSuccessor = current && (
      current.action === operation.action
      || (
        current.action === "current"
        && new Set(["create-managed", "update-managed"]).has(operation.action)
      )
      || delegatedPhysicalRecovery
    );
    if (
      !legalPhysicalSuccessor
      || current.kind !== operation.kind
      || (!delegatedPhysicalRecovery && current.target?.digest !== operation.target?.digest)
    ) {
      fail(
        "wakeflow-active-projector-maintenance-stale",
        `projection target changed outside its confirmed transition: ${operation.ref} (${operation.action} -> ${current?.action ?? "missing"})`,
        {
        details: {
          ref: operation.ref,
          confirmedAction: operation.action,
          currentAction: current?.action ?? null,
          confirmedTargetDigest: operation.target?.digest ?? null,
          currentTargetDigest: current?.target?.digest ?? null,
        },
        },
      );
    }
  }
}

/**
 * 从当前authority重新生成完整文件集合，并证明confirmed operation对它逐项、无遗漏覆盖。
 * 允许create/update已经到达current这一合法恢复后继，但不接受missing、unsafe或被删减的目标。
 */
export function createWakeflowActiveProjectionMutationParticipant(value) {
  const normalized = normalizeMaintenanceInput(value, { participant: true });
  const confirmedPlan = validateActiveProjectionMaintenancePlanInternal(normalized.confirmedPlan);
  if (confirmedPlan.payload.status !== "ready") {
    fail("wakeflow-active-projector-maintenance-blocked", "a blocked projection plan cannot create a participant");
  }
  const derived = deriveMaintenancePlan(normalized, confirmedPlan);
  assertMaintenancePlanMatchesCurrentSource(normalized, confirmedPlan, derived);
  const fileByRef = new Map(derived.projection.files.map((entry) => [entry.ref, entry]));
  const operationById = new Map(confirmedPlan.payload.operations.map((entry) => [entry.operationId, entry]));
  const privateOperations = confirmedPlan.payload.steps.map((step) => {
    const operation = operationById.get(step.stepId);
    const file = fileByRef.get(operation.ref);
    if (!file || file.digest !== operation.target.digest) {
      fail("wakeflow-active-projector-maintenance-stale", "projection target bytes cannot be reconstructed");
    }
    const stageRef = maintenanceStageRef(operation.ref, operation.operationId);
    return {
      stepId: step.stepId,
      kind: "file",
      targetPath: path.join(normalized.workspaceRoot, ...operation.ref.split("/")),
      stagePath: path.join(normalized.workspaceRoot, ...stageRef.split("/")),
      targetBytes: Buffer.from(file.content, "utf8"),
      maxFileBytes: MAX_PROJECTION_BYTES,
    };
  });
  return createWakeflowTrackedMaterializationParticipant({
    workspaceRoot: normalized.workspaceRoot,
    confirmedPlan,
    validatePlan: validateActiveProjectionMaintenancePlanInternal,
    deriveCurrentPlan({ context }) {
      assertMaintenanceSourceAuthority(normalized, confirmedPlan, context);
      return deriveMaintenancePlan(normalized, confirmedPlan).plan;
    },
    validateAuthority({ context }) {
      assertMaintenanceSourceAuthority(normalized, confirmedPlan, context);
      return { valid: true };
    },
    privateOperations,
    closureName: "active-projection-closure",
  });
}

// ==================== 八、公开inspect/rebuild边界 ====================

function boundary(operation) {
  try {
    return operation();
  } catch (cause) {
    if (cause instanceof WakeflowActiveProjectorError) throw cause;
    throw new WakeflowActiveProjectorError(
      cause?.code === "WAKEFLOW_STATE_LOCK_UNSAFE"
        ? "wakeflow-active-projector-unsafe"
        : "wakeflow-active-projector-failed",
      "active projection operation failed closed",
    );
  }
}

// inspect严格零写入；即使来源损坏也只返回脱敏诊断轴。
export function inspectWakeflowActiveProjection(input = {}) {
  return boundary(() => inspectInternal(exactInput(input)));
}

// rebuild只重建已证明managed的投影目标，所有authority与未知字节保持不变。
export function rebuildWakeflowActiveProjection(input = {}) {
  return boundary(() => rebuildInternal(exactInput(input)));
}
