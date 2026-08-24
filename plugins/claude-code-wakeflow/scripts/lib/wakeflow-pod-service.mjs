import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { atomicWriteFile } from "./wakeflow-atomic-write.mjs";
import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import { loadWakeflowConfigV3Snapshot } from "./wakeflow-config-v3-snapshot.mjs";
import {
  normalizeWakeflowHostCapabilityProfile,
  WAKEFLOW_PROTOCOL_HOST_IDS,
} from "./wakeflow-host-capability.mjs";
import {
  hostDecommissionResultDigest,
  validateHostDecommissionResult,
} from "./wakeflow-host-decommission-result.mjs";
import { hostProfile } from "./wakeflow-host-profile.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import {
  demandArtifactIdentity,
  loadDemandArtifactByRef,
  validatePodDesignHandoffArtifact,
  validatePodDesignRequestArtifact,
} from "./wakeflow-demand-artifact-records.mjs";
import {
  createPodCloseIntentRecord,
  createPodCloseReceiptRecord,
  createPodLaunchIntentRecord,
  createPodCreationReceiptRecord,
  createPodMaterializationEventRecord,
  createPodScopeRecord,
  createPodTestAccessPlanRecord,
  createPodTestAccessReceiptRecord,
  podTestAccessBindingSetDigest,
  podRecordCanonicalBytes,
  podRecordDigest,
  podRecordRef,
  validatePodRecord,
  WAKEFLOW_POD_CLOSE_INTENT_KIND,
  WAKEFLOW_POD_CLOSE_RECEIPT_KIND,
  WAKEFLOW_POD_CREATION_RECEIPT_KIND,
  WAKEFLOW_POD_LAUNCH_INTENT_KIND,
  WAKEFLOW_POD_MATERIALIZATION_EVENT_KIND,
  WAKEFLOW_POD_SCOPE_KIND,
  WAKEFLOW_POD_TEST_ACCESS_PLAN_KIND,
  WAKEFLOW_POD_TEST_ACCESS_RECEIPT_KIND,
} from "./wakeflow-pod-records.mjs";
import {
  loadDemandCoreRecords,
  validateControllerEventRecord,
  validateDemandStateRecord,
} from "./wakeflow-demand-core-records.mjs";
import {
  commitDemandPodTransitionWhileLocked,
  loadDemandCoreRecordsWithArtifactClosureWhileLocked,
  recoverDemandPodTransitionWhileLocked,
} from "./wakeflow-demand-state-service.mjs";
import { withStateRootLock } from "./wakeflow-state-lock.mjs";
import {
  createWindowBindingRecord,
  windowBindingDigest,
} from "./wakeflow-window-binding-records.mjs";
import {
  decommissionPreauthorizedWindowBindingWithinMutation,
  inspectWindowBindingInventory,
  registerPreauthorizedWindowBindingWithinMutation,
} from "./wakeflow-window-binding-service.mjs";
import {
  assertWakeflowMutationContext,
  withWakeflowRuntimeMutation,
} from "./wakeflow-workspace-mutation.mjs";

/**
 * Pod领域服务的职责地图：
 * - inventory严格读取Pod证据树，并把immutable record收敛为可诊断快照；
 * - materialization把launch intent推进为宿主操作计划、事件链、creation receipt与window binding；
 * - initialization、Design artifact、Product append负责Pod阶段内的证据先行与demand state事务；
 * - Test access负责plan、文件系统/Git观察、receipt与准入检查；close负责intent、宿主观察、receipt和事后binding退役；
 * - 宿主窗口创建/关闭的物理effect不在本文件执行，portable codec也继续由pod-records拥有。
 */

const PLAN_KIND = "WakeflowPodLaunchInitializationPlan";
const PRODUCT_APPEND_PLAN_KIND = "WakeflowPodProductLaunchAppendPlan";
const INVENTORY_KIND = "WakeflowPodEvidenceInventory";
const SCHEMA_VERSION = 1;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const MAX_RECORD_BYTES = 256 * 1024;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/u;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const HOST_IDS = new Set(WAKEFLOW_PROTOCOL_HOST_IDS);
const TERMINAL_DEMAND_STATES = new Set(["archived", "cancelled", "completed"]);
const CONTROL_ROLES = Object.freeze(["controller", "design", "test"]);
const CONTROL_ROLE_SET = new Set(CONTROL_ROLES);
const POD_LAUNCH_ID_RE = /^pod-launch_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const POD_TEST_PROBE_ID_RE = /^pod-test-probe_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const POD_CLOSE_ID_RE = /^pod-close_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const POD_MATERIALIZATION_ATTEMPT_ID_RE = /^pod-materialization-attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const POD_MATERIALIZATION_EVENT_ID_RE = /^pod-materialization-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MATERIALIZATION_STATUS_SET = new Set(["creating", "pending", "finalized", "failed"]);
const POD_TEST_BLOCK_REASON_SET = new Set([
  "capability-unsupported",
  "git-identity-mismatch",
  "observer-identity-mismatch",
  "probe-execution-failed",
  "root-unreadable",
]);
const POD_CLOSE_WORKTREE_STATUS_SET = new Set([
  "not-applicable",
  "removed",
  "retained",
  "unknown",
]);
const POD_DIRECTORIES = Object.freeze([
  "bindings",
  "close",
  "launch-intents",
  "materialization",
  "test-access",
]);

export class WakeflowPodServiceError extends Error {
  constructor(code, message, { cause, ...details } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowPodServiceError";
    this.code = code;
    this.details = deepFreeze({ code, ...details });
    if (cause !== undefined && this.cause === undefined) this.cause = cause;
  }
}

function fail(code, message, details = {}, cause = undefined) {
  throw new WakeflowPodServiceError(code, message, { ...details, cause });
}

function boundary(scope, cause, message) {
  if (cause instanceof WakeflowPodServiceError) throw cause;
  fail(`wakeflow-pod-service-${scope}`, `${message}: ${cause?.message ?? "unknown failure"}`, {
    causeCode: typeof cause?.code === "string" ? cause.code : null,
  }, cause);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  if (ArrayBuffer.isView(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function frozen(value) {
  return deepFreeze(structuredClone(value));
}

// 公开边界中的嵌套计划、数组与观察值必须先复制成无行为数据；校验过程不能执行调用方 getter。
function canonicalSnapshot(value, label) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (cause) {
    fail(
      "wakeflow-pod-service-contract",
      `${label} must be canonical plain data without accessors, symbols, hidden fields, or sparse slots`,
      { causeCode: typeof cause?.code === "string" ? cause.code : null },
      cause,
    );
  }
}

// 进入digest、state或证据集合的顺序只使用跨机器稳定的UTF-16 code-unit比较。
function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function plainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function exactKeys(value, required, optional, label) {
  if (!plainObject(value)) {
    fail("wakeflow-pod-service-contract", `${label} must be one plain object`);
  }
  const allowed = new Set([...required, ...optional]);
  const keys = Reflect.ownKeys(value);
  const unknown = keys.filter((key) => typeof key !== "string" || !allowed.has(key));
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  if (unknown.length > 0 || missing.length > 0) {
    fail("wakeflow-pod-service-contract", `${label} has the wrong closed field set`, {
      unknown: unknown.map(String),
      missing,
    });
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-pod-service-contract", `${label}.${String(key)} must be an enumerable data property`);
    }
  }
  return value;
}

function canonicalLoadedCloseSnapshot(value) {
  if (!plainObject(value)) {
    fail("wakeflow-pod-service-contract", "locked Pod close loaded snapshot must be one plain object");
  }
  const selected = {};
  for (const key of ["demand", "state", "events", "digests", "paths"]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(
        "wakeflow-pod-service-contract",
        `locked Pod close loaded snapshot.${key} must be an enumerable data property`,
      );
    }
    selected[key] = descriptor.value;
  }
  return frozen(canonicalSnapshot(selected, "locked Pod close loaded snapshot"));
}

function rootPath(value, label) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || CONTROL_RE.test(value)
  ) {
    fail("wakeflow-pod-service-contract", `${label} must be one trimmed control-free path`);
  }
  return path.resolve(value);
}

function typedId(value, type, label) {
  try {
    return assertWakeflowId(value, type, label);
  } catch (cause) {
    boundary("contract", cause, `${label} must be one typed ${type} ID`);
  }
}

function token(value, label) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || CONTROL_RE.test(value)
  ) {
    fail("wakeflow-pod-service-contract", `${label} must be one trimmed control-free token`);
  }
  return value;
}

function text(value, label) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value)
  ) {
    fail("wakeflow-pod-service-contract", `${label} must be one non-empty bounded human text value`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail("wakeflow-pod-service-contract", `${label} must be one sha256 digest`);
  }
  return value;
}

function timeout(value) {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0 || value > 300_000) {
    fail("wakeflow-pod-service-contract", "acquireTimeoutMs must be an integer from 0 through 300000");
  }
  return value;
}

function currentEuid() {
  return typeof process.geteuid === "function" ? BigInt(process.geteuid()) : null;
}

function modeOf(stat) {
  return Number(stat.mode & 0o777n);
}

function sameNode(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.uid === right.uid
    && left.gid === right.gid
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function sameDirectoryNode(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.uid === right.uid
    && left.gid === right.gid;
}

function sameDirectorySnapshot(left, right) {
  return sameDirectoryNode(left, right)
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function resolveRef(workspaceRoot, ref) {
  const target = path.resolve(workspaceRoot, ...ref.split("/"));
  if (!inside(workspaceRoot, target) || target === workspaceRoot) {
    fail("wakeflow-pod-service-layout", "Pod evidence ref escaped the workspace root");
  }
  return target;
}

function inspectDirectory(directory, label, { allowMissing = false } = {}) {
  let stat;
  try {
    stat = fs.lstatSync(directory, { bigint: true });
  } catch (cause) {
    if (allowMissing && cause?.code === "ENOENT") return null;
    fail("wakeflow-pod-service-layout", `${label} is unavailable`, {}, cause);
  }
  const euid = currentEuid();
  if (
    stat.isSymbolicLink()
    || !stat.isDirectory()
    || (euid !== null && stat.uid !== euid)
    || (process.platform !== "win32" && modeOf(stat) !== DIRECTORY_MODE)
  ) {
    fail(
      "wakeflow-pod-service-layout",
      `${label} must be one current-euid real 0700 directory`,
    );
  }
  return stat;
}

function syncDirectory(directory, label) {
  let descriptor = null;
  try {
    descriptor = fs.openSync(directory, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0));
    const opened = fs.fstatSync(descriptor, { bigint: true });
    const linked = fs.lstatSync(directory, { bigint: true });
    if (!sameDirectoryNode(opened, linked)) {
      fail("wakeflow-pod-service-durability", `${label} changed before durability sync`);
    }
    fs.fsyncSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    const afterPath = fs.lstatSync(directory, { bigint: true });
    if (!sameDirectoryNode(opened, after) || !sameDirectoryNode(opened, afterPath)) {
      fail("wakeflow-pod-service-durability", `${label} changed during durability sync`);
    }
  } catch (cause) {
    if (cause instanceof WakeflowPodServiceError) throw cause;
    boundary("durability", cause, `${label} cannot be durability-synced`);
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function createPrivateDirectory(directory, parent, label) {
  const parentBefore = inspectDirectory(parent, `${label} parent`);
  try {
    fs.mkdirSync(directory, { mode: DIRECTORY_MODE });
  } catch (cause) {
    boundary("directory-create", cause, `${label} cannot be created`);
  }
  inspectDirectory(directory, label);
  const parentAfter = inspectDirectory(parent, `${label} parent`);
  if (!sameDirectoryNode(parentBefore, parentAfter)) {
    fail("wakeflow-pod-service-layout", `${label} parent changed during directory creation`);
  }
  syncDirectory(directory, label);
  syncDirectory(parent, `${label} parent`);
}

function readCanonicalRecord(file, ref) {
  let descriptor = null;
  try {
    const initial = fs.lstatSync(file, { bigint: true });
    const euid = currentEuid();
    if (
      initial.isSymbolicLink()
      || !initial.isFile()
      || initial.nlink !== 1n
      || (euid !== null && initial.uid !== euid)
      || (process.platform !== "win32" && modeOf(initial) !== FILE_MODE)
      || initial.size > BigInt(MAX_RECORD_BYTES)
    ) {
      fail("wakeflow-pod-service-evidence-file", "Pod evidence must be one bounded private 0600 file", { ref });
    }
    descriptor = fs.openSync(
      file,
      fs.constants.O_RDONLY
        | (fs.constants.O_NOFOLLOW ?? 0)
        | (fs.constants.O_NONBLOCK ?? 0),
    );
    const opened = fs.fstatSync(descriptor, { bigint: true });
    const linked = fs.lstatSync(file, { bigint: true });
    if (!sameNode(initial, opened) || !sameNode(opened, linked)) {
      fail("wakeflow-pod-service-evidence-race", "Pod evidence changed while being opened", { ref });
    }
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    const afterPath = fs.lstatSync(file, { bigint: true });
    if (!sameNode(opened, after) || !sameNode(opened, afterPath)) {
      fail("wakeflow-pod-service-evidence-race", "Pod evidence changed while being read", { ref });
    }
    let parsed;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch (cause) {
      fail("wakeflow-pod-service-evidence-json", "Pod evidence is not valid JSON", { ref }, cause);
    }
    let record;
    try {
      record = validatePodRecord(parsed);
    } catch (cause) {
      fail("wakeflow-pod-service-evidence-record", "Pod evidence does not satisfy its strict record contract", { ref }, cause);
    }
    if (!bytes.equals(podRecordCanonicalBytes(record)) || podRecordRef(record) !== ref) {
      fail("wakeflow-pod-service-evidence-canonical", "Pod evidence bytes or ref are not canonical", { ref });
    }
    return Object.freeze({
      ref,
      record,
      digest: podRecordDigest(record),
      bytes,
    });
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function issue(code, ref, details = {}) {
  return { code, ref, ...details };
}

function allowedPodDirectoryRef(rootRef, ref) {
  if (ref === rootRef) return true;
  const relative = ref.slice(rootRef.length + 1);
  const parts = relative.split("/");
  if (parts.length === 1 && POD_DIRECTORIES.includes(parts[0])) return true;
  if (
    parts[0] === "materialization"
    && parts.length === 2
    && POD_LAUNCH_ID_RE.test(parts[1])
  ) return true;
  if (
    parts[0] === "materialization"
    && parts.length === 3
    && POD_LAUNCH_ID_RE.test(parts[1])
    && parts[2] === "events"
  ) return true;
  if (parts[0] === "bindings" && parts.length === 2) {
    try {
      assertWakeflowId(parts[1], "window", "$podWindowId");
      return true;
    } catch {
      return false;
    }
  }
  if (parts[0] === "bindings" && parts.length === 3 && parts[2] === "resume-observations") {
    try {
      assertWakeflowId(parts[1], "window", "$podWindowId");
      return true;
    } catch {
      return false;
    }
  }
  if (
    parts[0] === "test-access"
    && parts.length === 2
    && POD_TEST_PROBE_ID_RE.test(parts[1])
  ) return true;
  return parts[0] === "close"
    && parts.length === 2
    && POD_CLOSE_ID_RE.test(parts[1]);
}

function scanOnePod({ workspaceRoot, expectedProgramId, hostId, podId, podRoot }) {
  const records = [];
  const issues = [];
  const directories = new Set();
  const rootRef = `.wakeflow-local/runtime/hosts/${hostId}/evidence/pods/${podId}`;
  const visit = (directory, relativeRoot) => {
    if (!allowedPodDirectoryRef(rootRef, relativeRoot)) {
      issues.push(issue("wakeflow-pod-service-evidence-unknown", relativeRoot));
      return;
    }
    let directoryStat;
    try {
      directoryStat = inspectDirectory(directory, `Pod evidence directory ${relativeRoot}`);
      directories.add(relativeRoot);
    } catch (cause) {
      issues.push(issue(cause.code ?? "wakeflow-pod-service-layout", relativeRoot));
      return;
    }
    let names;
    try {
      names = fs.readdirSync(directory).sort();
    } catch (cause) {
      issues.push(issue("wakeflow-pod-service-evidence-read", relativeRoot));
      return;
    }
    const afterNames = fs.lstatSync(directory, { bigint: true });
    if (!sameDirectorySnapshot(directoryStat, afterNames)) {
      issues.push(issue("wakeflow-pod-service-evidence-race", relativeRoot));
      return;
    }
    for (const name of names) {
      const absolute = path.join(directory, name);
      const ref = `${relativeRoot}/${name}`;
      let stat;
      try {
        stat = fs.lstatSync(absolute, { bigint: true });
      } catch {
        issues.push(issue("wakeflow-pod-service-evidence-race", ref));
        continue;
      }
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        visit(absolute, ref);
        continue;
      }
      if (!stat.isFile() || stat.isSymbolicLink()) {
        issues.push(issue("wakeflow-pod-service-evidence-node", ref));
        continue;
      }
      try {
        const source = readCanonicalRecord(absolute, ref);
        if (
          source.record.programId !== expectedProgramId
          || source.record.hostId !== hostId
          || source.record.podId !== podId
        ) {
          issues.push(issue("wakeflow-pod-service-evidence-identity", ref));
        } else {
          records.push(source);
        }
      } catch (cause) {
        issues.push(issue(cause.code ?? "wakeflow-pod-service-evidence-invalid", ref));
      }
    }
    try {
      const afterVisit = fs.lstatSync(directory, { bigint: true });
      if (!sameDirectorySnapshot(directoryStat, afterVisit)) {
        issues.push(issue("wakeflow-pod-service-evidence-race", relativeRoot));
      }
    } catch {
      issues.push(issue("wakeflow-pod-service-evidence-race", relativeRoot));
    }
  };
  visit(podRoot, `.wakeflow-local/runtime/hosts/${hostId}/evidence/pods/${podId}`);
  records.sort((left, right) => left.ref < right.ref ? -1 : left.ref > right.ref ? 1 : 0);
  issues.sort((left, right) => left.ref < right.ref ? -1 : left.ref > right.ref ? 1 : 0);
  const scopeSources = records.filter((entry) => entry.record.kind === WAKEFLOW_POD_SCOPE_KIND);
  const launchSources = records.filter((entry) => entry.record.kind === WAKEFLOW_POD_LAUNCH_INTENT_KIND);
  const hasAllDirectories = POD_DIRECTORIES.every((name) => directories.has(`${rootRef}/${name}`));
  for (const field of ["windowId", "launchOperationId", "bindingId"]) {
    const values = launchSources.map((entry) => entry.record[field]);
    if (new Set(values).size !== values.length) {
      issues.push(issue("wakeflow-pod-service-evidence-duplicate", `${rootRef}/launch-intents`, { field }));
    }
  }
  if (scopeSources.length === 1) {
    const [scopeSource] = scopeSources;
    if (launchSources.some((entry) => entry.record.demandId !== scopeSource.record.demandId)) {
      issues.push(issue("wakeflow-pod-service-evidence-demand", `${rootRef}/launch-intents`));
    }
  }
  const controlCounts = new Map(CONTROL_ROLES.map((role) => [
    role,
    launchSources.filter((entry) => entry.record.role === role).length,
  ]));
  for (const [role, count] of controlCounts) {
    if (count > 1) {
      issues.push(issue("wakeflow-pod-service-evidence-control-members", `${rootRef}/launch-intents`, { role }));
    }
  }
  issues.sort((left, right) => {
    const refOrder = left.ref < right.ref ? -1 : left.ref > right.ref ? 1 : 0;
    if (refOrder !== 0) return refOrder;
    const codeOrder = left.code < right.code ? -1 : left.code > right.code ? 1 : 0;
    if (codeOrder !== 0) return codeOrder;
    return lexicalCompare(canonicalJson(left), canonicalJson(right));
  });
  const linkage = issues.length > 0
    ? "structural-invalid"
    : scopeSources.length === 1
        && hasAllDirectories
        && CONTROL_ROLES.every((role) => controlCounts.get(role) === 1)
      ? "structural-current"
      : "structural-prefix";
  return {
    podId,
    linkage,
    rootRef,
    records,
    recordsByRef: new Map(records.map((entry) => [entry.ref, entry])),
    scopeSource: scopeSources.length === 1 ? scopeSources[0] : null,
    launchSources,
    directories,
    issues,
  };
}

function normalizeInventoryInput(input) {
  exactKeys(input, ["workspaceRoot", "expectedProgramId", "hostId"], [], "Pod inventory input");
  const hostId = token(input.hostId, "hostId");
  if (!HOST_IDS.has(hostId)) {
    fail("wakeflow-pod-service-contract", "hostId is not a Wakeflow protocol host");
  }
  return Object.freeze({
    workspaceRoot: rootPath(input.workspaceRoot, "workspaceRoot"),
    expectedProgramId: typedId(input.expectedProgramId, "program", "expectedProgramId"),
    hostId,
  });
}

function scanPodInventory(input) {
  const normalized = normalizeInventoryInput(input);
  const podsRootRef = `.wakeflow-local/runtime/hosts/${normalized.hostId}/evidence/pods`;
  const podsRoot = resolveRef(normalized.workspaceRoot, podsRootRef);
  const podsRootStat = inspectDirectory(podsRoot, "Pod evidence static capability root");
  let names;
  try {
    names = fs.readdirSync(podsRoot).sort();
  } catch (cause) {
    boundary("inventory", cause, "Pod evidence static capability root cannot be read");
  }
  const pods = [];
  const issues = [];
  for (const name of names) {
    let podId;
    try {
      podId = assertWakeflowId(name, "pod", "$podId");
    } catch {
      issues.push(issue("wakeflow-pod-service-evidence-pod-id", `${podsRootRef}/${name}`));
      continue;
    }
    const podRoot = path.join(podsRoot, name);
    try {
      pods.push(scanOnePod({
        workspaceRoot: normalized.workspaceRoot,
        expectedProgramId: normalized.expectedProgramId,
        hostId: normalized.hostId,
        podId,
        podRoot,
      }));
    } catch (cause) {
      issues.push(issue(cause.code ?? "wakeflow-pod-service-evidence-invalid", `${podsRootRef}/${name}`));
    }
  }
  const podsRootAfter = inspectDirectory(podsRoot, "Pod evidence static capability root");
  if (!sameDirectorySnapshot(podsRootStat, podsRootAfter)) {
    fail("wakeflow-pod-service-inventory-race", "Pod evidence static capability root changed during scan");
  }
  issues.push(...pods.flatMap((pod) => pod.issues));
  issues.sort((left, right) => left.ref < right.ref ? -1 : left.ref > right.ref ? 1 : 0);
  const publicPods = pods.map((pod) => ({
    podId: pod.podId,
    rootRef: pod.rootRef,
    linkage: pod.linkage,
    scope: pod.scopeSource === null
      ? null
      : { ref: pod.scopeSource.ref, digest: pod.scopeSource.digest },
    launchIntents: pod.launchSources.map((entry) => ({
      windowId: entry.record.windowId,
      launchOperationId: entry.record.launchOperationId,
      ref: entry.ref,
      digest: entry.digest,
    })),
    records: pod.records.map((entry) => ({
      kind: entry.record.kind,
      ref: entry.ref,
      digest: entry.digest,
    })),
    recordCount: pod.records.length,
  }));
  const unsigned = {
    kind: INVENTORY_KIND,
    schemaVersion: SCHEMA_VERSION,
    programId: normalized.expectedProgramId,
    hostId: normalized.hostId,
    rootRef: podsRootRef,
    status: issues.length > 0 ? "degraded" : publicPods.length === 0 ? "empty" : "current",
    pods: publicPods,
    issues,
  };
  return {
    normalized,
    podsRoot,
    pods,
    podById: new Map(pods.map((pod) => [pod.podId, pod])),
    public: deepFreeze({ ...unsigned, inventoryDigest: canonicalJsonDigest(unsigned) }),
  };
}

// 严格列举当前宿主Pod证据，返回bounded公开诊断；不从文件存在推导demand或宿主状态。
export function inspectPodEvidenceInventory(input = {}) {
  return scanPodInventory(input).public;
}

// layout owner复用同一只读扫描结果，不获得Pod mutation authority。
export function inspectPodEvidenceInventoryForLayout(input = {}) {
  return inspectPodEvidenceInventory(input);
}

function materializationDomainId(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    fail("wakeflow-pod-service-contract", `${label} must be one typed Pod materialization ID`);
  }
  return value;
}

function transientSecret(value, label) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || value.length > 4096
    || CONTROL_RE.test(value)
  ) {
    fail("wakeflow-pod-service-contract", `${label} must be one bounded transient token`);
  }
  return value;
}

function normalizeMaterializationAuthorityInput(input, label) {
  exactKeys(
    input,
    ["workspaceRoot", "stateRoot", "expectedProgramId", "windowId"],
    [],
    label,
  );
  const workspaceRoot = rootPath(input.workspaceRoot, "workspaceRoot");
  const stateRoot = rootPath(input.stateRoot, "stateRoot");
  if (!inside(workspaceRoot, stateRoot) || stateRoot === workspaceRoot) {
    fail("wakeflow-pod-service-contract", "stateRoot must be one child of workspaceRoot");
  }
  return frozen({
    workspaceRoot,
    stateRoot,
    expectedProgramId: typedId(input.expectedProgramId, "program", "expectedProgramId"),
    windowId: typedId(input.windowId, "window", "windowId"),
  });
}

function normalizeMaterializationRecordInput(input) {
  exactKeys(input, [
    "workspaceRoot",
    "stateRoot",
    "expectedProgramId",
    "windowId",
    "attemptId",
    "eventId",
    "expectedPreviousEventDigest",
    "status",
    "observedAt",
  ], [
    "hostRequestId",
    "failure",
    "retryAuthorizationDigest",
    "acquireTimeoutMs",
  ], "Pod materialization record input");
  const authority = normalizeMaterializationAuthorityInput({
    workspaceRoot: input.workspaceRoot,
    stateRoot: input.stateRoot,
    expectedProgramId: input.expectedProgramId,
    windowId: input.windowId,
  }, "Pod materialization authority input");
  if (input.expectedPreviousEventDigest !== null) {
    digest(input.expectedPreviousEventDigest, "expectedPreviousEventDigest");
  }
  if (!MATERIALIZATION_STATUS_SET.has(input.status)) {
    fail("wakeflow-pod-service-contract", "materialization status is unsupported");
  }
  const normalized = {
    ...authority,
    attemptId: materializationDomainId(
      input.attemptId,
      POD_MATERIALIZATION_ATTEMPT_ID_RE,
      "attemptId",
    ),
    eventId: materializationDomainId(
      input.eventId,
      POD_MATERIALIZATION_EVENT_ID_RE,
      "eventId",
    ),
    expectedPreviousEventDigest: input.expectedPreviousEventDigest,
    status: input.status,
    observedAt: token(input.observedAt, "observedAt"),
    acquireTimeoutMs: timeout(input.acquireTimeoutMs),
  };
  const hasRequest = Object.hasOwn(input, "hostRequestId");
  const hasFailure = Object.hasOwn(input, "failure");
  const hasRetry = Object.hasOwn(input, "retryAuthorizationDigest");
  if (input.status === "pending") {
    if (!hasRequest || hasFailure || hasRetry) {
      fail("wakeflow-pod-service-contract", "pending materialization requires only hostRequestId");
    }
    normalized.hostRequestId = transientSecret(input.hostRequestId, "hostRequestId");
  } else if (input.status === "failed") {
    if (hasRequest || !hasFailure || hasRetry) {
      fail("wakeflow-pod-service-contract", "failed materialization requires only failure");
    }
    exactKeys(input.failure, ["code"], ["detail"], "materialization failure");
    normalized.failure = {
      code: token(input.failure.code, "failure.code"),
      ...(Object.hasOwn(input.failure, "detail")
        ? { detail: transientSecret(input.failure.detail, "failure.detail") }
        : {}),
    };
  } else if (input.status === "creating") {
    if (hasRequest || hasFailure) {
      fail("wakeflow-pod-service-contract", "creating materialization cannot contain request or failure input");
    }
    if (hasRetry) {
      normalized.retryAuthorizationDigest = digest(
        input.retryAuthorizationDigest,
        "retryAuthorizationDigest",
      );
    }
  } else if (hasRequest || hasFailure || hasRetry) {
    fail("wakeflow-pod-service-contract", "finalized materialization cannot contain request, failure, or retry input");
  }
  return frozen(normalized);
}

function materializationRecordFromInput(input, authority) {
  const record = {
    kind: WAKEFLOW_POD_MATERIALIZATION_EVENT_KIND,
    schemaVersion: 1,
    programId: authority.loaded.demand.programId,
    hostId: authority.loaded.state.pod.hostId,
    podId: authority.loaded.state.pod.podId,
    windowId: authority.member.windowId,
    launchOperationId: authority.member.launchOperationId,
    attemptId: input.attemptId,
    eventId: input.eventId,
    previousEventDigest: input.expectedPreviousEventDigest,
    status: input.status,
    observedAt: input.observedAt,
    ...(input.status === "pending" ? {
      hostRequestIdDigest: canonicalJsonDigest({
        kind: "WakeflowTransientHostRequestId",
        value: input.hostRequestId,
      }),
    } : {}),
    ...(input.status === "failed" ? {
      failureCode: input.failure.code,
      ...(input.failure.detail === undefined ? {} : {
        failureDetailDigest: canonicalJsonDigest({
          kind: "WakeflowTransientHostFailureDetail",
          value: input.failure.detail,
        }),
      }),
    } : {}),
    ...(input.retryAuthorizationDigest === undefined ? {} : {
      retryAuthorizationDigest: input.retryAuthorizationDigest,
    }),
  };
  try {
    return createPodMaterializationEventRecord(record);
  } catch (cause) {
    boundary("materialization-record", cause, "materialization event failed its closed record contract");
  }
}

function materializationSources(podSource, member) {
  return podSource.records.filter((source) => (
    source.record.kind === WAKEFLOW_POD_MATERIALIZATION_EVENT_KIND
    && source.record.launchOperationId === member.launchOperationId
  ));
}

function reduceMaterializationChain(podSource, member) {
  const sources = materializationSources(podSource, member);
  if (sources.length === 0) {
    const publicValue = frozen({
      status: "empty",
      eventCount: 0,
      attemptCount: 0,
      attempts: [],
      tail: null,
      chainDigest: canonicalJsonDigest({
        launchOperationId: member.launchOperationId,
        events: [],
      }),
    });
    return { sources: [], tailSource: null, public: publicValue };
  }
  const byDigest = new Map();
  const children = new Map();
  const roots = [];
  for (const source of sources) {
    if (
      source.record.windowId !== member.windowId
      || source.record.programId !== podSource.scopeSource.record.programId
      || source.record.hostId !== podSource.scopeSource.record.hostId
      || source.record.podId !== podSource.podId
    ) {
      fail(
        "wakeflow-pod-service-materialization-chain",
        "materialization event identity differs from its state-selected launch intent",
      );
    }
    if (byDigest.has(source.digest)) {
      fail("wakeflow-pod-service-materialization-chain", "materialization chain contains a duplicate event digest");
    }
    byDigest.set(source.digest, source);
    if (source.record.previousEventDigest === null) {
      roots.push(source);
    } else {
      const existing = children.get(source.record.previousEventDigest) ?? [];
      existing.push(source);
      children.set(source.record.previousEventDigest, existing);
    }
  }
  if (roots.length !== 1) {
    fail("wakeflow-pod-service-materialization-chain", "materialization chain must contain one exact root");
  }
  for (const source of sources) {
    const previous = source.record.previousEventDigest;
    if (previous !== null && !byDigest.has(previous)) {
      fail("wakeflow-pod-service-materialization-chain", "materialization event references a missing predecessor");
    }
    if ((children.get(source.digest) ?? []).length > 1) {
      fail("wakeflow-pod-service-materialization-chain", "materialization chain is forked");
    }
  }
  const ordered = [];
  let cursor = roots[0];
  while (cursor) {
    ordered.push(cursor);
    cursor = (children.get(cursor.digest) ?? [])[0] ?? null;
  }
  if (ordered.length !== sources.length) {
    fail("wakeflow-pod-service-materialization-chain", "materialization chain contains unreachable events");
  }
  const attempts = [];
  let currentAttempt = null;
  for (let index = 0; index < ordered.length; index += 1) {
    const source = ordered[index];
    const record = source.record;
    const previous = ordered[index - 1]?.record ?? null;
    if (index === 0) {
      if (
        record.status !== "creating"
        || record.previousEventDigest !== null
        || Object.hasOwn(record, "retryAuthorizationDigest")
      ) {
        fail("wakeflow-pod-service-materialization-chain", "first materialization attempt must start with creating and no retry authority");
      }
      currentAttempt = {
        attemptId: record.attemptId,
        status: record.status,
        eventCount: 1,
        tail: { eventId: record.eventId, ref: source.ref, digest: source.digest },
      };
      attempts.push(currentAttempt);
      continue;
    }
    if (Date.parse(record.observedAt) <= Date.parse(previous.observedAt)) {
      fail("wakeflow-pod-service-materialization-chain", "materialization event time must increase strictly");
    }
    if (record.attemptId === previous.attemptId) {
      const allowed = previous.status === "creating"
        ? new Set(["pending", "finalized", "failed"])
        : previous.status === "pending"
          ? new Set(["finalized", "failed"])
          : new Set();
      if (!allowed.has(record.status) || Object.hasOwn(record, "retryAuthorizationDigest")) {
        fail("wakeflow-pod-service-materialization-chain", "materialization status transition is invalid within one attempt");
      }
      currentAttempt.status = record.status;
      currentAttempt.eventCount += 1;
      currentAttempt.tail = { eventId: record.eventId, ref: source.ref, digest: source.digest };
    } else {
      if (
        previous.status !== "failed"
        || record.status !== "creating"
        || !Object.hasOwn(record, "retryAuthorizationDigest")
        || attempts.some((entry) => entry.attemptId === record.attemptId)
      ) {
        fail("wakeflow-pod-service-materialization-chain", "new materialization attempt requires one failed predecessor and retry authority");
      }
      currentAttempt = {
        attemptId: record.attemptId,
        status: record.status,
        eventCount: 1,
        tail: { eventId: record.eventId, ref: source.ref, digest: source.digest },
      };
      attempts.push(currentAttempt);
    }
  }
  const tailSource = ordered.at(-1);
  const publicValue = frozen({
    status: tailSource.record.status,
    eventCount: ordered.length,
    attemptCount: attempts.length,
    attempts,
    tail: {
      eventId: tailSource.record.eventId,
      attemptId: tailSource.record.attemptId,
      status: tailSource.record.status,
      ref: tailSource.ref,
      digest: tailSource.digest,
      observedAt: tailSource.record.observedAt,
    },
    chainDigest: canonicalJsonDigest({
      launchOperationId: member.launchOperationId,
      events: ordered.map((source) => ({ ref: source.ref, digest: source.digest })),
    }),
  });
  return { sources: ordered, tailSource, public: publicValue };
}

function assertBoundMemberEvidenceClosure(input, config, profile, loaded, podSource) {
  const selectedMembers = loaded.state.pod.windows.filter((entry) => (
    Object.hasOwn(entry, "materializationFinalEvent")
  ));
  if (selectedMembers.length === 0) return null;
  const inventory = inspectWindowBindingInventory({ workspaceRoot: input.workspaceRoot });
  if (
    inventory.programId !== loaded.demand.programId
    || inventory.hostId !== profile.hostId
    || inventory.configDigest !== config.configDigest
  ) {
    fail(
      "wakeflow-pod-service-authority-damaged",
      "state-selected Pod identities differ from current program, host, or config authority",
    );
  }
  const identityByWindow = new Map(inventory.bindings.map((entry) => [entry.windowId, entry]));
  for (const member of selectedMembers) {
    const intentSource = podSource.recordsByRef.get(member.launchIntent.ref) ?? null;
    const materialization = reduceMaterializationChain(podSource, member);
    const finalSource = podSource.recordsByRef.get(member.materializationFinalEvent.ref) ?? null;
    const receiptSource = podSource.recordsByRef.get(member.creationReceipt.ref) ?? null;
    const identity = identityByWindow.get(member.windowId) ?? null;
    if (
      !intentSource
      || intentSource.digest !== member.launchIntent.digest
      || materialization.public.status !== "finalized"
      || !materialization.tailSource
      || materialization.tailSource.ref !== member.materializationFinalEvent.ref
      || materialization.tailSource.digest !== member.materializationFinalEvent.digest
      || materialization.tailSource.record.eventId !== member.materializationFinalEvent.eventId
      || finalSource !== materialization.tailSource
      || !receiptSource
      || receiptSource.record.kind !== WAKEFLOW_POD_CREATION_RECEIPT_KIND
      || receiptSource.digest !== member.creationReceipt.digest
      || !identity
      || identity.bindingId !== member.bindingId
      || identity.identityBindingDigest !== member.identityBindingDigest
    ) {
      fail(
        "wakeflow-pod-service-authority-damaged",
        "bound Pod member does not close its exact launch, materialization, receipt, and identity chain",
        { windowId: member.windowId },
      );
    }
    const receipt = receiptSource.record;
    if (
      receipt.programId !== loaded.demand.programId
      || receipt.hostId !== loaded.state.pod.hostId
      || receipt.podId !== loaded.state.pod.podId
      || receipt.demandId !== loaded.demand.demandId
      || receipt.windowId !== member.windowId
      || receipt.launchOperationId !== member.launchOperationId
      || receipt.bindingId !== member.bindingId
      || receipt.launchIntentDigest !== intentSource.digest
      || receipt.materializationFinalEventDigest !== materialization.tailSource.digest
      || receipt.identityBindingDigest !== member.identityBindingDigest
      || (member.role === "product") !== (receipt.resource.kind === "git-worktree")
    ) {
      fail(
        "wakeflow-pod-service-authority-damaged",
        "bound Pod creation receipt differs from its exact state-selected authority",
        { windowId: member.windowId },
      );
    }
  }
  return inventory;
}

function materializationAuthorityFromLoaded(input, config, profile, loaded) {
  if (TERMINAL_DEMAND_STATES.has(loaded.state.state)) {
    fail("wakeflow-pod-service-state", "terminal demand cannot materialize a Pod window");
  }
  if (
    !loaded.state.pod
    || loaded.state.pod.hostId !== profile.hostId
    || loaded.demand.executionPlacement.mode !== "isolated"
  ) {
    fail("wakeflow-pod-service-authority", "current demand does not own a Pod for this host");
  }
  const inventory = scanPodInventory({
    workspaceRoot: input.workspaceRoot,
    expectedProgramId: input.expectedProgramId,
    hostId: profile.hostId,
  });
  const podSource = inventory.podById.get(loaded.state.pod.podId) ?? null;
  const selected = selectedLaunchTuples(loaded.state, podSource);
  assertExactStateEvidence(loaded.state, podSource, podSource.scopeSource, selected);
  const identityInventory = assertBoundMemberEvidenceClosure(
    input,
    config,
    profile,
    loaded,
    podSource,
  );
  const member = loaded.state.pod.windows.find((entry) => entry.windowId === input.windowId) ?? null;
  if (!member) {
    fail("wakeflow-pod-service-authority", "windowId is not one current state-selected Pod member");
  }
  const intentSource = podSource.recordsByRef.get(member.launchIntent.ref) ?? null;
  if (
    !intentSource
    || intentSource.digest !== member.launchIntent.digest
    || intentSource.record.windowId !== member.windowId
  ) {
    fail("wakeflow-pod-service-authority-damaged", "Pod member launch intent is unavailable or changed");
  }
  return {
    loaded,
    inventory,
    podSource,
    identityInventory,
    member,
    intentSource,
    materialization: reduceMaterializationChain(podSource, member),
  };
}

function loadMaterializationAuthorityWhileLocked(input, config, profile) {
  return materializationAuthorityFromLoaded(input, config, profile, loadLocked(input, config));
}

function publicMaterializationInspection(authority) {
  return frozen({
    kind: "WakeflowPodWindowMaterializationInspection",
    schemaVersion: 1,
    programId: authority.loaded.demand.programId,
    demandId: authority.loaded.demand.demandId,
    hostId: authority.loaded.state.pod.hostId,
    podId: authority.loaded.state.pod.podId,
    windowId: authority.member.windowId,
    role: authority.member.role,
    launchOperationId: authority.member.launchOperationId,
    bindingId: authority.member.bindingId,
    memberStatus: authority.member.status,
    launchIntent: {
      ref: authority.intentSource.ref,
      digest: authority.intentSource.digest,
    },
    state: {
      revision: authority.loaded.state.revision,
      digest: authority.loaded.digests.state,
    },
    materialization: authority.materialization.public,
    status: authority.materialization.public.status,
  });
}

// 联合launch intent、materialization event、creation receipt、binding与state，投影一个窗口的当前物化闭包。
export function inspectPodWindowMaterialization(value = {}) {
  const input = normalizeMaterializationAuthorityInput(
    value,
    "Pod materialization inspection input",
  );
  const config = loadConfig(input);
  const profile = currentPodProfile();
  try {
    return withStateRootLock(input.stateRoot, () => publicMaterializationInspection(
      loadMaterializationAuthorityWhileLocked(input, config, profile),
    ));
  } catch (cause) {
    boundary("materialization-inspection", cause, "Pod materialization inspection failed closed");
  }
}

function portableStateRootRef(input) {
  return path.relative(input.workspaceRoot, input.stateRoot).split(path.sep).join("/");
}

function gitText(cwd, args, label, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (cause) {
    if (allowFailure) return null;
    boundary("git-observation", cause, `${label} could not be observed`);
  }
}

function materializationOperation(input, config, authority) {
  const intent = authority.intentSource.record;
  const stateRootRef = portableStateRootRef(input);
  if (intent.role !== "product") {
    let controlRoot;
    try {
      controlRoot = fs.realpathSync.native(input.workspaceRoot);
    } catch (cause) {
      boundary("materialization-root", cause, "program root cannot be resolved for Pod materialization");
    }
    return frozen({
      role: intent.role,
      environmentIntent: intent.environmentIntent,
      launchOperationId: intent.launchOperationId,
      correlationId: intent.launchOperationId,
      stateRootRef,
      controlRoot,
    });
  }
  const repository = config.indexes.repositoryById[intent.repositoryId] ?? null;
  if (
    !repository
    || canonicalJsonDigest({ repositoryId: repository.repositoryId, path: repository.path })
      !== intent.repositorySourceDigest
  ) {
    fail("wakeflow-pod-service-repository", "product launch intent no longer matches configured repository source");
  }
  const configuredRoot = path.resolve(input.workspaceRoot, ...repository.path.split("/"));
  let repositoryRoot;
  try {
    repositoryRoot = fs.realpathSync.native(configuredRoot);
  } catch (cause) {
    boundary("materialization-root", cause, "configured product repository cannot be resolved");
  }
  const currentHead = gitText(repositoryRoot, ["rev-parse", "HEAD"], "configured product HEAD");
  if (currentHead !== intent.expectedBaseHead) {
    fail("wakeflow-pod-service-base-head", "configured product HEAD differs from frozen launch intent");
  }
  return frozen({
    role: intent.role,
    environmentIntent: intent.environmentIntent,
    launchOperationId: intent.launchOperationId,
    correlationId: intent.launchOperationId,
    stateRootRef,
    repositoryId: intent.repositoryId,
    repositoryRoot,
    repositorySourceDigest: intent.repositorySourceDigest,
    expectedBaseHead: intent.expectedBaseHead,
    ...(intent.hostResourceKey === undefined ? {} : { hostResourceKey: intent.hostResourceKey }),
  });
}

// 在state-root锁内重读当前权威，派生下一步record/host-create/recovery/receipt模式；计划本身不执行宿主effect。
export function planPodWindowMaterialization(value = {}) {
  const input = normalizeMaterializationAuthorityInput(
    value,
    "Pod materialization plan input",
  );
  const config = loadConfig(input);
  const profile = currentPodProfile();
  try {
    return withStateRootLock(input.stateRoot, () => {
      const authority = loadMaterializationAuthorityWhileLocked(input, config, profile);
      const status = authority.materialization.public.status;
      const mode = authority.member.status === "bound"
        ? "bound"
        : status === "empty" || status === "failed"
          ? "record-creating"
          : status === "creating"
            ? "host-create"
            : status === "pending"
              ? "host-recovery"
              : "record-creation";
      const operation = materializationOperation(input, config, authority);
      const unsigned = {
        kind: "WakeflowPodWindowMaterializationPlan",
        schemaVersion: 1,
        mode,
        programId: authority.loaded.demand.programId,
        demandId: authority.loaded.demand.demandId,
        hostId: profile.hostId,
        podId: authority.loaded.state.pod.podId,
        windowId: authority.member.windowId,
        bindingId: authority.member.bindingId,
        configDigest: config.configDigest,
        state: {
          revision: authority.loaded.state.revision,
          digest: authority.loaded.digests.state,
        },
        launchIntent: {
          ref: authority.intentSource.ref,
          digest: authority.intentSource.digest,
        },
        materialization: authority.materialization.public,
        operation,
        requiresHostOperationFence: ["host-create", "host-recovery", "record-creation"].includes(mode),
        hostCreateAllowed: mode === "host-create",
        recoveryOnly: ["host-recovery", "record-creation"].includes(mode),
      };
      return frozen({ ...unsigned, planDigest: canonicalJsonDigest(unsigned) });
    });
  } catch (cause) {
    boundary("materialization-plan", cause, "Pod materialization planning failed closed");
  }
}

function ensureMaterializationEventTree(input, authority) {
  const materializationRoot = resolveRef(
    input.workspaceRoot,
    `${authority.podSource.rootRef}/materialization`,
  );
  inspectDirectory(materializationRoot, "Pod materialization root");
  const launchRoot = path.join(materializationRoot, authority.member.launchOperationId);
  if (!fs.existsSync(launchRoot)) {
    createPrivateDirectory(launchRoot, materializationRoot, "Pod launch materialization root");
  } else {
    inspectDirectory(launchRoot, "Pod launch materialization root");
  }
  const eventsRoot = path.join(launchRoot, "events");
  if (!fs.existsSync(eventsRoot)) {
    createPrivateDirectory(eventsRoot, launchRoot, "Pod materialization events root");
  } else {
    inspectDirectory(eventsRoot, "Pod materialization events root");
  }
}

function assertMaterializationAppendAllowed(authority, desiredRecord) {
  const tail = authority.materialization.tailSource?.record ?? null;
  if (tail === null) {
    if (
      desiredRecord.previousEventDigest !== null
      || desiredRecord.status !== "creating"
      || Object.hasOwn(desiredRecord, "retryAuthorizationDigest")
    ) {
      fail("wakeflow-pod-service-materialization-chain", "first materialization event must start one creating attempt");
    }
    return;
  }
  if (desiredRecord.previousEventDigest !== authority.materialization.tailSource.digest) {
    fail("wakeflow-pod-service-materialization-stale", "expected previous materialization event is not the current chain tail");
  }
  if (Date.parse(desiredRecord.observedAt) <= Date.parse(tail.observedAt)) {
    fail("wakeflow-pod-service-materialization-chain", "materialization event time must increase strictly");
  }
  if (desiredRecord.attemptId === tail.attemptId) {
    const allowed = tail.status === "creating"
      ? new Set(["pending", "finalized", "failed"])
      : tail.status === "pending"
        ? new Set(["finalized", "failed"])
        : new Set();
    if (!allowed.has(desiredRecord.status) || Object.hasOwn(desiredRecord, "retryAuthorizationDigest")) {
      fail("wakeflow-pod-service-materialization-chain", "materialization status transition is invalid within one attempt");
    }
    return;
  }
  if (
    tail.status !== "failed"
    || desiredRecord.status !== "creating"
    || !Object.hasOwn(desiredRecord, "retryAuthorizationDigest")
    || authority.materialization.sources.some((source) => (
      source.record.attemptId === desiredRecord.attemptId
    ))
  ) {
    fail("wakeflow-pod-service-materialization-chain", "new materialization attempt requires one failed predecessor and retry authority");
  }
}

function materializationRecordResult(status, authority) {
  return frozen({
    status,
    programId: authority.loaded.demand.programId,
    demandId: authority.loaded.demand.demandId,
    hostId: authority.loaded.state.pod.hostId,
    podId: authority.loaded.state.pod.podId,
    windowId: authority.member.windowId,
    launchOperationId: authority.member.launchOperationId,
    materialization: authority.materialization.public,
    revision: authority.loaded.state.revision,
    stateDigest: authority.loaded.digests.state,
  });
}

function verifyMaterializationFailureClosure(input, tracker) {
  if (!tracker.before) {
    fail("wakeflow-pod-service-recovery-required", "materialization failure has no captured authority prefix");
  }
  const config = loadConfig(input);
  const profile = currentPodProfile();
  return withStateRootLock(input.stateRoot, () => {
    const authority = loadMaterializationAuthorityWhileLocked(input, config, profile);
    const currentDigest = authority.materialization.public.chainDigest;
    if (![tracker.before.chainDigest, tracker.afterChainDigest].includes(currentDigest)) {
      fail("wakeflow-pod-service-recovery-required", "materialization failure left an unknown event chain");
    }
    return safeReleaseVerdict({
      operation: "pod-materialization-event",
      configDigest: config.configDigest,
      stateDigest: authority.loaded.digests.state,
      chainDigest: currentDigest,
      inventoryDigest: authority.inventory.public.inventoryDigest,
    }, "pod-materialization-event-closure");
  });
}

// 追加一个严格前驱相连的物化事件，并在workspace mutation失败时验证已知前缀仍可恢复。
export async function recordPodMaterializationEvent(value = {}) {
  const input = normalizeMaterializationRecordInput(value);
  const config = loadConfig(input);
  const profile = currentPodProfile();
  const tracker = { before: null, afterChainDigest: null };
  try {
    return await withWakeflowRuntimeMutation({
      workspaceRoot: input.workspaceRoot,
      operationKind: "pod-materialization-event",
      domainOwner: "core-pod-service",
      ...(input.acquireTimeoutMs === undefined ? {} : { acquireTimeoutMs: input.acquireTimeoutMs }),
      onCallbackFailure: () => verifyMaterializationFailureClosure(input, tracker),
    }, (mutationContext) => withStateRootLock(input.stateRoot, () => {
      assertWakeflowMutationContext({
        workspaceRoot: input.workspaceRoot,
        context: mutationContext,
        mode: "runtime-mutation",
      });
      const currentConfig = loadConfig(input);
      if (currentConfig.configDigest !== config.configDigest) {
        fail("wakeflow-pod-service-stale-plan", "config changed before materialization event append");
      }
      let authority = loadMaterializationAuthorityWhileLocked(input, currentConfig, profile);
      tracker.before = authority.materialization.public;
      const desiredRecord = materializationRecordFromInput(input, authority);
      const desired = tuple(desiredRecord);
      const existing = authority.podSource.recordsByRef.get(desired.ref) ?? null;
      if (existing !== null) {
        if (existing.digest !== desired.digest || !same(existing.record, desired.record)) {
          fail("wakeflow-pod-service-evidence-conflict", "materialization event ID already has different immutable bytes");
        }
        return materializationRecordResult("replayed", authority);
      }
      const tailDigest = authority.materialization.tailSource?.digest ?? null;
      if (input.expectedPreviousEventDigest !== tailDigest) {
        fail("wakeflow-pod-service-materialization-stale", "expected previous materialization event is not the current chain tail");
      }
      assertMaterializationAppendAllowed(authority, desiredRecord);
      ensureMaterializationEventTree(input, authority);
      ensureImmutableRecord(input.workspaceRoot, desired);
      authority = loadMaterializationAuthorityWhileLocked(input, currentConfig, profile);
      if (
        authority.materialization.tailSource?.digest !== desired.digest
        || authority.materialization.tailSource?.record.eventId !== input.eventId
      ) {
        fail("wakeflow-pod-service-evidence-closure", "materialization append did not produce the exact strict chain tail");
      }
      tracker.afterChainDigest = authority.materialization.public.chainDigest;
      return materializationRecordResult("recorded", authority);
    }));
  } catch (cause) {
    boundary("materialization-append", cause, "Pod materialization event append failed closed");
  }
}

function normalizeCreationReceiptInput(input) {
  exactKeys(input, [
    "workspaceRoot",
    "stateRoot",
    "expectedProgramId",
    "windowId",
    "expectedPrevious",
    "expectedFinalEventDigest",
    "handle",
    "observation",
    "transition",
  ], ["acquireTimeoutMs"], "Pod creation receipt input");
  const authority = normalizeMaterializationAuthorityInput({
    workspaceRoot: input.workspaceRoot,
    stateRoot: input.stateRoot,
    expectedProgramId: input.expectedProgramId,
    windowId: input.windowId,
  }, "Pod creation authority input");
  exactKeys(input.handle, ["kind", "value"], [], "Pod creation final handle");
  exactKeys(input.observation, ["actualCwd", "verifiedAt"], ["hostCreatedAt"], "Pod creation observation");
  const actualCwd = rootPath(input.observation.actualCwd, "observation.actualCwd");
  if (
    !path.isAbsolute(input.observation.actualCwd)
    || path.normalize(input.observation.actualCwd) !== input.observation.actualCwd
  ) {
    fail("wakeflow-pod-service-contract", "observation.actualCwd must be one normalized absolute path");
  }
  const observation = {
    actualCwd,
    verifiedAt: token(input.observation.verifiedAt, "observation.verifiedAt"),
    ...(Object.hasOwn(input.observation, "hostCreatedAt")
      ? { hostCreatedAt: token(input.observation.hostCreatedAt, "observation.hostCreatedAt") }
      : {}),
  };
  if (
    observation.hostCreatedAt !== undefined
    && Date.parse(observation.hostCreatedAt) > Date.parse(observation.verifiedAt)
  ) {
    fail("wakeflow-pod-service-contract", "hostCreatedAt cannot follow verifiedAt");
  }
  const transition = normalizeTransition(input.transition);
  if (Date.parse(transition.createdAt) < Date.parse(observation.verifiedAt)) {
    fail("wakeflow-pod-service-contract", "bind transition cannot precede creation verification");
  }
  return frozen({
    ...authority,
    expectedPrevious: normalizeExpectedPrevious(input.expectedPrevious),
    expectedFinalEventDigest: digest(
      input.expectedFinalEventDigest,
      "expectedFinalEventDigest",
    ),
    handle: {
      kind: token(input.handle.kind, "handle.kind"),
      value: transientSecret(input.handle.value, "handle.value"),
    },
    observation,
    transition,
    acquireTimeoutMs: timeout(input.acquireTimeoutMs),
  });
}

function inspectActualDirectory(actualCwd) {
  let stat;
  let real;
  try {
    stat = fs.lstatSync(actualCwd, { bigint: true });
    real = fs.realpathSync.native(actualCwd);
  } catch (cause) {
    boundary("creation-resource", cause, "observed Pod cwd cannot be inspected");
  }
  if (stat.isSymbolicLink() || !stat.isDirectory() || real !== actualCwd) {
    fail("wakeflow-pod-service-creation-resource", "observed Pod cwd must be one canonical real directory");
  }
  return real;
}

function canonicalGitPath(cwd, args, label) {
  const observed = gitText(cwd, args, label);
  const absolute = path.isAbsolute(observed) ? path.normalize(observed) : path.resolve(cwd, observed);
  try {
    return fs.realpathSync.native(absolute);
  } catch (cause) {
    boundary("git-observation", cause, `${label} cannot be resolved canonically`);
  }
}

function currentDemandRoots(workspaceRoot) {
  const currentRoot = path.join(workspaceRoot, ".wakeflow-active", "current");
  const before = inspectDirectory(currentRoot, "current demand authority root");
  let entries;
  try {
    entries = fs.readdirSync(currentRoot, { withFileTypes: true });
  } catch (cause) {
    boundary("active-pod-inventory", cause, "current demand authority root cannot be enumerated");
  }
  const roots = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      fail("wakeflow-pod-service-active-authority", "current demand authority root contains a symlink");
    }
    let demandId = null;
    try {
      demandId = assertWakeflowId(entry.name, "demand", "$currentDemandId");
    } catch {
      // 投影文档与短时同级锁文件不是demand authority；未知目录可能藏匿未扫描state root，因此宿主级资源claim证明必须失败关闭。
    }
    if (demandId !== null) {
      if (!entry.isDirectory()) {
        fail("wakeflow-pod-service-active-authority", "typed current demand entry is not one directory");
      }
      roots.push({ demandId, stateRoot: path.join(currentRoot, demandId) });
    } else if (entry.isDirectory()) {
      fail("wakeflow-pod-service-active-authority", "unknown current directory blocks complete Pod claim inspection");
    }
  }
  const after = inspectDirectory(currentRoot, "current demand authority root");
  if (!sameDirectorySnapshot(before, after)) {
    fail("wakeflow-pod-service-active-authority", "current demand set changed during Pod claim inspection");
  }
  return roots.sort((left, right) => lexicalCompare(left.demandId, right.demandId));
}

function appendProductClaimsFromLoaded(input, loaded, profile, accumulator) {
  if (!loaded.state.pod || loaded.state.pod.hostId !== profile.hostId) return;
  for (const member of loaded.state.pod.windows) {
    if (accumulator.seenWindows.has(member.windowId)) {
      fail("wakeflow-pod-service-active-authority", "one Pod window ID appears in multiple current demands");
    }
    accumulator.seenWindows.add(member.windowId);
    if (
      member.role !== "product"
      || !["active", "retained", "unknown"].includes(member.resourceClaimStatus)
    ) continue;
    if (!member.creationReceipt) {
      fail("wakeflow-pod-service-active-authority", "occupied product claim lacks its state-selected creation receipt");
    }
    const file = resolveRef(input.workspaceRoot, member.creationReceipt.ref);
    const source = readCanonicalRecord(file, member.creationReceipt.ref);
    if (
      source.record.kind !== WAKEFLOW_POD_CREATION_RECEIPT_KIND
      || source.digest !== member.creationReceipt.digest
      || source.record.programId !== loaded.demand.programId
      || source.record.demandId !== loaded.demand.demandId
      || source.record.podId !== loaded.state.pod.podId
      || source.record.windowId !== member.windowId
      || source.record.bindingId !== member.bindingId
      || source.record.resource.kind !== "git-worktree"
    ) {
      fail("wakeflow-pod-service-active-authority", "occupied product claim differs from its immutable creation receipt");
    }
    const actualCwd = source.record.resource.actualCwd;
    if (accumulator.seenCwds.has(actualCwd)) {
      fail("wakeflow-pod-service-active-authority", "multiple current product claims select one actual cwd");
    }
    const claim = {
      demandId: loaded.demand.demandId,
      podId: loaded.state.pod.podId,
      windowId: member.windowId,
      actualCwd,
      resourceClaimStatus: member.resourceClaimStatus,
      receiptDigest: source.digest,
    };
    accumulator.seenCwds.set(actualCwd, claim);
    accumulator.claims.push(claim);
  }
}

function collectActiveProductClaims(input, config, profile) {
  const roots = currentDemandRoots(input.workspaceRoot);
  const accumulator = {
    claims: [],
    seenWindows: new Set(),
    seenCwds: new Map(),
  };
  for (const root of roots) {
    if (path.resolve(root.stateRoot) === input.stateRoot) continue;
    let loaded;
    try {
      loaded = loadDemandCoreRecords({
        stateRoot: root.stateRoot,
        expectedProgramId: input.expectedProgramId,
        ledgerRoot: config.ledgerRoot,
      });
    } catch (cause) {
      boundary("active-pod-authority", cause, "one current demand blocks complete Pod claim inspection");
    }
    if (loaded.demand.demandId !== root.demandId) {
      fail(
        "wakeflow-pod-service-active-authority",
        "current demand directory identity differs from its strict demand authority",
      );
    }
    appendProductClaimsFromLoaded(input, loaded, profile, accumulator);
  }
  const confirmedRoots = currentDemandRoots(input.workspaceRoot);
  if (canonicalJson(confirmedRoots.map((entry) => entry.demandId)) !== canonicalJson(roots.map((entry) => entry.demandId))) {
    fail("wakeflow-pod-service-active-authority", "current demand set changed across Pod claim inspection");
  }
  return accumulator;
}

function assertProductClaimAvailable(authority, receiptRecord, activeClaims) {
  if (receiptRecord.resource.kind !== "git-worktree") return;
  assertProductCwdAvailable(authority, receiptRecord.resource.actualCwd, activeClaims);
}

function assertProductCwdAvailable(authority, actualCwd, activeClaims) {
  if (authority.member.role !== "product") return;
  const conflict = activeClaims.find((claim) => (
    claim.actualCwd === actualCwd
    && !(
      claim.demandId === authority.loaded.demand.demandId
      && claim.podId === authority.loaded.state.pod.podId
      && claim.windowId === authority.member.windowId
    )
  ));
  if (conflict) {
    fail(
      "wakeflow-pod-service-resource-claim-conflict",
      "product actual cwd is already occupied by another current Pod claim",
      { demandId: conflict.demandId, windowId: conflict.windowId },
    );
  }
}

function creationResource(input, config, authority) {
  const actualCwd = inspectActualDirectory(input.observation.actualCwd);
  const intent = authority.intentSource.record;
  if (intent.role !== "product") {
    let expectedRoot;
    try {
      expectedRoot = fs.realpathSync.native(input.workspaceRoot);
    } catch (cause) {
      boundary("creation-resource", cause, "program root cannot be resolved");
    }
    if (actualCwd !== expectedRoot) {
      fail("wakeflow-pod-service-creation-resource", "control Pod window cwd differs from the current program root");
    }
    return createPodCreationReceiptRecord({
      kind: WAKEFLOW_POD_CREATION_RECEIPT_KIND,
      schemaVersion: 1,
      programId: authority.loaded.demand.programId,
      hostId: authority.loaded.state.pod.hostId,
      podId: authority.loaded.state.pod.podId,
      demandId: authority.loaded.demand.demandId,
      windowId: authority.member.windowId,
      launchOperationId: authority.member.launchOperationId,
      bindingId: authority.member.bindingId,
      launchIntentDigest: authority.intentSource.digest,
      materializationFinalEventDigest: authority.materialization.tailSource.digest,
      identityBindingDigest: authority.identity.identityBindingDigest,
      resource: { kind: "program-root", actualCwd },
      ...(input.observation.hostCreatedAt === undefined
        ? {} : { hostCreatedAt: input.observation.hostCreatedAt }),
      verifiedAt: input.observation.verifiedAt,
    });
  }
  const repository = config.indexes.repositoryById[intent.repositoryId] ?? null;
  if (
    !repository
    || canonicalJsonDigest({ repositoryId: repository.repositoryId, path: repository.path })
      !== intent.repositorySourceDigest
  ) {
    fail("wakeflow-pod-service-repository", "product creation no longer matches configured repository source");
  }
  const repositoryRoot = canonicalGitPath(
    path.resolve(input.workspaceRoot, ...repository.path.split("/")),
    ["rev-parse", "--show-toplevel"],
    "configured repository top-level",
  );
  const gitTopLevel = canonicalGitPath(
    actualCwd,
    ["rev-parse", "--show-toplevel"],
    "Pod worktree top-level",
  );
  const gitCommonDir = canonicalGitPath(
    actualCwd,
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    "Pod worktree common directory",
  );
  const expectedCommonDir = canonicalGitPath(
    repositoryRoot,
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    "configured repository common directory",
  );
  const head = gitText(actualCwd, ["rev-parse", "HEAD"], "Pod worktree HEAD");
  const branch = gitText(
    actualCwd,
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    "Pod worktree branch",
    { allowFailure: true },
  );
  if (
    gitTopLevel !== actualCwd
    || actualCwd === repositoryRoot
    || gitCommonDir !== expectedCommonDir
    || head !== intent.expectedBaseHead
  ) {
    fail(
      "wakeflow-pod-service-creation-resource",
      "product creation does not prove one exact non-main worktree at the frozen base HEAD",
    );
  }
  return createPodCreationReceiptRecord({
    kind: WAKEFLOW_POD_CREATION_RECEIPT_KIND,
    schemaVersion: 1,
    programId: authority.loaded.demand.programId,
    hostId: authority.loaded.state.pod.hostId,
    podId: authority.loaded.state.pod.podId,
    demandId: authority.loaded.demand.demandId,
    windowId: authority.member.windowId,
    launchOperationId: authority.member.launchOperationId,
    bindingId: authority.member.bindingId,
    launchIntentDigest: authority.intentSource.digest,
    materializationFinalEventDigest: authority.materialization.tailSource.digest,
    identityBindingDigest: authority.identity.identityBindingDigest,
    resource: {
      kind: "git-worktree",
      actualCwd,
      gitTopLevel,
      gitCommonDir,
      head,
      branch,
      detached: branch === null,
      mainCheckout: false,
    },
    ...(input.observation.hostCreatedAt === undefined
      ? {} : { hostCreatedAt: input.observation.hostCreatedAt }),
    verifiedAt: input.observation.verifiedAt,
  });
}

function nextPodPhaseAfterBinding(pod) {
  const controls = pod.windows.filter((entry) => entry.role !== "product");
  const allControlsBound = controls.every((entry) => entry.status === "bound");
  if (!Object.hasOwn(pod, "designRequest")) {
    return allControlsBound ? "control-ready" : "creating-control";
  }
  if (!Object.hasOwn(pod, "designHandoff")) return "designing";
  return pod.windows.every((entry) => entry.status === "bound")
    ? "execution-ready"
    : "creating-products";
}

function bindTransition(input, authority, receiptSource) {
  const previousPod = authority.loaded.state.pod;
  const previousMember = previousPod.windows.find((entry) => entry.windowId === input.windowId);
  if (previousMember.status !== "planned") {
    fail("wakeflow-pod-service-bind", "only one planned Pod member may consume a creation receipt");
  }
  if (
    (previousMember.role === "product" && previousPod.phase !== "creating-products")
    || (previousMember.role !== "product" && !["reserved", "creating-control"].includes(previousPod.phase))
  ) {
    fail("wakeflow-pod-service-bind", "Pod phase does not admit this member creation receipt");
  }
  const nextPod = structuredClone(previousPod);
  const nextMember = nextPod.windows.find((entry) => entry.windowId === input.windowId);
  nextMember.status = "bound";
  nextMember.materializationFinalEvent = {
    eventId: authority.materialization.tailSource.record.eventId,
    ref: authority.materialization.tailSource.ref,
    digest: authority.materialization.tailSource.digest,
  };
  nextMember.identityBindingDigest = authority.identity.identityBindingDigest;
  nextMember.creationReceipt = { ref: receiptSource.ref, digest: receiptSource.digest };
  if (nextMember.role === "product") nextMember.resourceClaimStatus = "active";
  nextPod.phase = nextPodPhaseAfterBinding(nextPod);
  const frozenPod = frozen(nextPod);
  const event = validateControllerEventRecord({
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: input.transition.eventId,
    demandId: authority.loaded.demand.demandId,
    createdAt: input.transition.createdAt,
    actor: "controller",
    command: "bind-pod-window",
    type: "pod.window-bound",
    previousRevision: authority.loaded.state.revision,
    nextRevision: authority.loaded.state.revision + 1,
    from: authority.loaded.state.state,
    to: authority.loaded.state.state,
    reason: input.transition.reason,
    decisionSummary: input.transition.decisionSummary,
    changedArtifacts: [],
    podTransition: {
      podId: frozenPod.podId,
      action: "bind-window",
      previousPodDigest: canonicalJsonDigest(previousPod),
      nextPodDigest: canonicalJsonDigest(frozenPod),
      windowId: input.windowId,
    },
  });
  const nextState = validateDemandStateRecord({
    ...authority.loaded.state,
    revision: event.nextRevision,
    stateReason: event.reason,
    updatedAt: event.createdAt,
    lastEvent: {
      eventId: event.eventId,
      eventDigest: canonicalJsonDigest(event),
    },
    pod: frozenPod,
  });
  return { event, nextState };
}

function ensureCreationReceiptTree(input, authority) {
  const bindingsRoot = resolveRef(input.workspaceRoot, `${authority.podSource.rootRef}/bindings`);
  inspectDirectory(bindingsRoot, "Pod creation receipt root");
  const windowRoot = path.join(bindingsRoot, authority.member.windowId);
  if (!fs.existsSync(windowRoot)) {
    createPrivateDirectory(windowRoot, bindingsRoot, "Pod window creation receipt root");
  } else {
    inspectDirectory(windowRoot, "Pod window creation receipt root");
  }
}

function currentIdentityForWindow(input, authority) {
  const inventory = inspectWindowBindingInventory({ workspaceRoot: input.workspaceRoot });
  if (
    inventory.programId !== authority.loaded.demand.programId
    || inventory.hostId !== authority.loaded.state.pod.hostId
  ) {
    fail("wakeflow-pod-service-identity", "window identity inventory differs from current Pod authority");
  }
  const identity = inventory.bindings.find((entry) => entry.windowId === input.windowId) ?? null;
  return { inventory, identity };
}

function assertIdentityMatchesCreationInput(input, authority, identity) {
  if (
    !identity
    || identity.programId !== authority.loaded.demand.programId
    || identity.hostId !== authority.loaded.state.pod.hostId
    || identity.windowId !== authority.member.windowId
    || identity.bindingId !== authority.member.bindingId
  ) {
    fail("wakeflow-pod-service-identity", "current window identity differs from the preauthorized Pod member");
  }
  let expectedDigest;
  try {
    expectedDigest = windowBindingDigest(createWindowBindingRecord({
      programId: identity.programId,
      hostId: identity.hostId,
      windowId: identity.windowId,
      bindingId: identity.bindingId,
      handle: input.handle,
      registeredAt: identity.registeredAt,
    }));
  } catch (cause) {
    boundary("identity", cause, "current window identity cannot be rederived from the creation input");
  }
  if (expectedDigest !== identity.identityBindingDigest) {
    fail("wakeflow-pod-service-bind-conflict", "creation handle differs from the immutable current window identity");
  }
  return identity;
}

function productClaimsIncludingLoaded(input, loaded, profile, accumulator) {
  const combined = {
    claims: [...accumulator.claims],
    seenWindows: new Set(accumulator.seenWindows),
    seenCwds: new Map(accumulator.seenCwds),
  };
  appendProductClaimsFromLoaded(input, loaded, profile, combined);
  return combined;
}

function creationResult(status, authority, receiptSource) {
  return frozen({
    status,
    programId: authority.loaded.demand.programId,
    demandId: authority.loaded.demand.demandId,
    hostId: authority.loaded.state.pod.hostId,
    podId: authority.loaded.state.pod.podId,
    windowId: authority.member.windowId,
    bindingId: authority.member.bindingId,
    identityBindingDigest: authority.identity.identityBindingDigest,
    materializationFinalEvent: {
      eventId: authority.materialization.tailSource.record.eventId,
      ref: authority.materialization.tailSource.ref,
      digest: authority.materialization.tailSource.digest,
    },
    creationReceipt: { ref: receiptSource.ref, digest: receiptSource.digest },
    revision: authority.loaded.state.revision,
    stateDigest: authority.loaded.digests.state,
  });
}

function exactCreationReplay(input, config, profile, authority) {
  if (authority.member.status !== "bound") return null;
  if (
    authority.materialization.public.status !== "finalized"
    || authority.materialization.tailSource.digest !== input.expectedFinalEventDigest
    || authority.member.materializationFinalEvent.digest !== input.expectedFinalEventDigest
  ) {
    fail("wakeflow-pod-service-bind-conflict", "bound member differs from the expected finalized materialization chain");
  }
  const identityState = currentIdentityForWindow(input, authority);
  if (
    !identityState.identity
    || identityState.identity.bindingId !== authority.member.bindingId
    || identityState.identity.identityBindingDigest !== authority.member.identityBindingDigest
  ) {
    fail("wakeflow-pod-service-authority-damaged", "bound member lacks its exact current identity binding");
  }
  authority.identity = assertIdentityMatchesCreationInput(input, authority, identityState.identity);
  const receiptSource = authority.podSource.recordsByRef.get(authority.member.creationReceipt.ref) ?? null;
  if (
    !receiptSource
    || receiptSource.record.kind !== WAKEFLOW_POD_CREATION_RECEIPT_KIND
    || receiptSource.digest !== authority.member.creationReceipt.digest
  ) {
    fail("wakeflow-pod-service-authority-damaged", "bound member lacks its exact creation receipt");
  }
  const expectedReceipt = creationResource(input, config, authority);
  if (!same(receiptSource.record, expectedReceipt)) {
    fail("wakeflow-pod-service-bind-conflict", "creation replay differs from the immutable current receipt");
  }
  const event = authority.loaded.events.find((entry) => entry.eventId === input.transition.eventId) ?? null;
  if (
    !event
    || event.command !== "bind-pod-window"
    || event.podTransition?.windowId !== input.windowId
    || event.createdAt !== input.transition.createdAt
    || event.reason !== input.transition.reason
    || event.decisionSummary !== input.transition.decisionSummary
    || event.previousRevision !== input.expectedPrevious.revision
  ) {
    fail("wakeflow-pod-service-bind-conflict", "creation replay differs from its committed bind event");
  }
  return creationResult("replayed", authority, receiptSource);
}

function recoverExactCreationJournal(input, config, profile, externalClaims) {
  return recoverDemandPodTransitionWhileLocked({
    stateRoot: input.stateRoot,
    expectedProgramId: input.expectedProgramId,
    ledgerRoot: config.ledgerRoot,
    admitRecoveryWhileLocked: ({ loaded, journal }) => {
      if (
        journal.artifactWrites.length !== 0
        || journal.expectedPreviousRevision !== input.expectedPrevious.revision
        || journal.expectedPreviousStateDigest !== input.expectedPrevious.stateDigest
      ) {
        fail(
          "wakeflow-pod-service-recovery-required",
          "pending Pod creation journal differs from the exact requested state prefix",
        );
      }
      const previousLoaded = {
        ...loaded,
        state: journal.previousState,
        digests: {
          ...loaded.digests,
          state: journal.expectedPreviousStateDigest,
        },
      };
      const authority = materializationAuthorityFromLoaded(
        input,
        config,
        profile,
        previousLoaded,
      );
      if (
        authority.member.status !== "planned"
        || authority.materialization.public.status !== "finalized"
        || authority.materialization.tailSource?.digest !== input.expectedFinalEventDigest
      ) {
        fail(
          "wakeflow-pod-service-recovery-required",
          "pending Pod creation journal lacks its exact finalized materialization prefix",
        );
      }
      const identityState = currentIdentityForWindow(input, authority);
      authority.identity = assertIdentityMatchesCreationInput(
        input,
        authority,
        identityState.identity,
      );
      const expectedReceipt = creationResource(input, config, authority);
      const expectedSource = tuple(expectedReceipt);
      const receiptSource = authority.podSource.recordsByRef.get(expectedSource.ref) ?? null;
      if (
        !receiptSource
        || receiptSource.digest !== expectedSource.digest
        || !same(receiptSource.record, expectedSource.record)
      ) {
        fail(
          "wakeflow-pod-service-recovery-required",
          "pending Pod creation journal lacks its exact immutable creation receipt",
        );
      }
      const claims = productClaimsIncludingLoaded(input, previousLoaded, profile, externalClaims);
      assertProductClaimAvailable(authority, receiptSource.record, claims.claims);
      const transition = bindTransition(input, authority, receiptSource);
      if (!same(journal.nextEvent, transition.event) || !same(journal.nextState, transition.nextState)) {
        fail(
          "wakeflow-pod-service-recovery-required",
          "pending Pod creation journal differs from the rederived bind transition",
        );
      }
      return { admitted: true };
    },
  });
}

function verifyCreationFailureClosure(input, tracker) {
  if (!tracker.before) {
    fail("wakeflow-pod-service-recovery-required", "creation failure has no captured authority prefix");
  }
  const config = loadConfig(input);
  const profile = currentPodProfile();
  return withStateRootLock(input.stateRoot, () => {
    const authority = loadMaterializationAuthorityWhileLocked(input, config, profile);
    const stateDigest = authority.loaded.digests.state;
    if (![tracker.before.stateDigest, tracker.nextStateDigest].includes(stateDigest)) {
      fail("wakeflow-pod-service-recovery-required", "creation failure left an unknown Pod state");
    }
    const identityState = currentIdentityForWindow(input, authority);
    const identityDigest = identityState.identity?.identityBindingDigest ?? null;
    if (identityDigest !== null && identityDigest !== tracker.identityDigest) {
      fail("wakeflow-pod-service-recovery-required", "creation failure left a different window identity");
    }
    const receipt = tracker.receiptRef
      ? authority.podSource.recordsByRef.get(tracker.receiptRef) ?? null
      : null;
    if (receipt && receipt.digest !== tracker.receiptDigest) {
      fail("wakeflow-pod-service-recovery-required", "creation failure left a different receipt");
    }
    return safeReleaseVerdict({
      operation: "pod-creation-receipt",
      configDigest: config.configDigest,
      stateDigest,
      chainDigest: authority.materialization.public.chainDigest,
      identityDigest,
      receiptDigest: receipt?.digest ?? null,
    }, "pod-creation-receipt-closure");
  });
}

// 在最终宿主观察后原子闭合creation receipt、window binding与Pod成员状态；不负责创建宿主窗口。
export async function recordPodCreationReceipt(value = {}) {
  const input = normalizeCreationReceiptInput(value);
  const config = loadConfig(input);
  const profile = currentPodProfile();
  const tracker = {
    before: null,
    identityDigest: null,
    receiptRef: null,
    receiptDigest: null,
    nextStateDigest: null,
  };
  try {
    return await withWakeflowRuntimeMutation({
      workspaceRoot: input.workspaceRoot,
      operationKind: "pod-creation-receipt",
      domainOwner: "core-pod-service",
      ...(input.acquireTimeoutMs === undefined ? {} : { acquireTimeoutMs: input.acquireTimeoutMs }),
      onCallbackFailure: () => verifyCreationFailureClosure(input, tracker),
    }, (mutationContext) => {
      const externalClaims = collectActiveProductClaims(input, config, profile);
      return withStateRootLock(input.stateRoot, () => {
        assertWakeflowMutationContext({
          workspaceRoot: input.workspaceRoot,
          context: mutationContext,
          mode: "runtime-mutation",
        });
        const currentConfig = loadConfig(input);
        if (currentConfig.configDigest !== config.configDigest) {
          fail("wakeflow-pod-service-stale-plan", "config changed before creation receipt commit");
        }
        const recovered = recoverExactCreationJournal(
          input,
          currentConfig,
          profile,
          externalClaims,
        );
        let authority = loadMaterializationAuthorityWhileLocked(input, currentConfig, profile);
        const activeClaims = productClaimsIncludingLoaded(
          input,
          authority.loaded,
          profile,
          externalClaims,
        );
        tracker.before = {
          stateDigest: authority.loaded.digests.state,
          chainDigest: authority.materialization.public.chainDigest,
        };
        if (authority.member.status === "bound") {
          tracker.identityDigest = authority.member.identityBindingDigest;
          tracker.receiptRef = authority.member.creationReceipt.ref;
          tracker.receiptDigest = authority.member.creationReceipt.digest;
        }
        const replay = exactCreationReplay(input, currentConfig, profile, authority);
        if (replay !== null) {
          return recovered.status === "recovered"
            ? frozen({ ...replay, status: "recovered" })
            : replay;
        }
        assertExpectedPrevious(authority.loaded, input.expectedPrevious);
        if (
          authority.member.status !== "planned"
          || authority.materialization.public.status !== "finalized"
          || authority.materialization.tailSource?.digest !== input.expectedFinalEventDigest
        ) {
          fail("wakeflow-pod-service-bind", "creation receipt requires the exact finalized materialization chain for one planned member");
        }
        if (authority.member.role === "product") {
          assertProductCwdAvailable(
            authority,
            inspectActualDirectory(input.observation.actualCwd),
            activeClaims.claims,
          );
        }
        const identity = registerPreauthorizedWindowBindingWithinMutation({
          workspaceRoot: input.workspaceRoot,
          expectedProgramId: input.expectedProgramId,
          expectedConfigDigest: currentConfig.configDigest,
          windowId: input.windowId,
          bindingId: authority.member.bindingId,
          handle: input.handle,
          mutationContext,
        });
        authority.identity = assertIdentityMatchesCreationInput(input, authority, identity);
        tracker.identityDigest = identity.identityBindingDigest;
        const receiptRecord = creationResource(input, currentConfig, authority);
        assertProductClaimAvailable(authority, receiptRecord, activeClaims.claims);
        const receiptSource = tuple(receiptRecord);
        tracker.receiptRef = receiptSource.ref;
        tracker.receiptDigest = receiptSource.digest;
        ensureCreationReceiptTree(input, authority);
        ensureImmutableRecord(input.workspaceRoot, receiptSource);
        authority = loadMaterializationAuthorityWhileLocked(input, currentConfig, profile);
        authority.identity = identity;
        const committedReceipt = authority.podSource.recordsByRef.get(receiptSource.ref) ?? null;
        if (
          !committedReceipt
          || committedReceipt.digest !== receiptSource.digest
          || !same(committedReceipt.record, receiptSource.record)
        ) {
          fail("wakeflow-pod-service-evidence-closure", "creation receipt did not close exact immutable evidence");
        }
        const transition = bindTransition(input, authority, committedReceipt);
        tracker.nextStateDigest = canonicalJsonDigest(transition.nextState);
        commitDemandPodTransitionWhileLocked({
          stateRoot: input.stateRoot,
          expectedProgramId: input.expectedProgramId,
          ledgerRoot: currentConfig.ledgerRoot,
          expectedPrevious: input.expectedPrevious,
          event: transition.event,
          nextState: transition.nextState,
        });
        authority = loadMaterializationAuthorityWhileLocked(input, currentConfig, profile);
        authority.identity = identity;
        if (
          authority.loaded.digests.state !== tracker.nextStateDigest
          || authority.member.status !== "bound"
          || authority.member.creationReceipt.digest !== committedReceipt.digest
          || authority.member.identityBindingDigest !== identity.identityBindingDigest
        ) {
          fail("wakeflow-pod-service-authority-closure", "creation receipt did not close exact Pod state authority");
        }
        return creationResult("bound", authority, committedReceipt);
      });
    });
  } catch (cause) {
    boundary("creation-receipt", cause, "Pod creation receipt failed closed");
  }
}

function normalizeTransition(value) {
  exactKeys(value, ["eventId", "createdAt", "reason", "decisionSummary"], [], "transition");
  return frozen({
    eventId: token(value.eventId, "transition.eventId"),
    createdAt: token(value.createdAt, "transition.createdAt"),
    reason: text(value.reason, "transition.reason"),
    decisionSummary: text(value.decisionSummary, "transition.decisionSummary"),
  });
}

function normalizeExpectedPrevious(value) {
  exactKeys(value, ["revision", "stateDigest"], [], "expectedPrevious");
  if (!Number.isInteger(value.revision) || value.revision < 1) {
    fail("wakeflow-pod-service-contract", "expectedPrevious.revision must be a positive integer");
  }
  return frozen({
    revision: value.revision,
    stateDigest: digest(value.stateDigest, "expectedPrevious.stateDigest"),
  });
}

function assertExpectedPrevious(loaded, expected) {
  if (
    loaded.state.revision !== expected.revision
    || loaded.digests.state !== expected.stateDigest
  ) {
    fail("wakeflow-pod-service-stale", "Pod mutation expected a different current state snapshot", {
      expectedRevision: expected.revision,
      expectedStateDigest: expected.stateDigest,
      currentRevision: loaded.state.revision,
      currentStateDigest: loaded.digests.state,
    });
  }
}

function normalizePlanInput(input) {
  exactKeys(input, [
    "workspaceRoot",
    "stateRoot",
    "expectedProgramId",
    "scope",
    "launchIntents",
    "transition",
  ], [], "Pod launch initialization input");
  let scope;
  try {
    scope = createPodScopeRecord(input.scope);
  } catch (cause) {
    boundary("contract", cause, "Pod scope is invalid");
  }
  const launchIntentInput = canonicalSnapshot(input.launchIntents, "launchIntents");
  if (!Array.isArray(launchIntentInput)) {
    fail("wakeflow-pod-service-contract", "launchIntents must be one array");
  }
  let launchIntents;
  try {
    launchIntents = launchIntentInput.map((entry) => createPodLaunchIntentRecord(entry));
  } catch (cause) {
    boundary("contract", cause, "Pod launch intent is invalid");
  }
  return frozen({
    workspaceRoot: rootPath(input.workspaceRoot, "workspaceRoot"),
    stateRoot: rootPath(input.stateRoot, "stateRoot"),
    expectedProgramId: typedId(input.expectedProgramId, "program", "expectedProgramId"),
    scope,
    launchIntents: launchIntents.sort((left, right) => (
      left.windowId < right.windowId ? -1 : left.windowId > right.windowId ? 1 : 0
    )),
    transition: normalizeTransition(input.transition),
  });
}

function normalizeApplyInput(input) {
  exactKeys(input, [
    "workspaceRoot",
    "stateRoot",
    "expectedProgramId",
    "plan",
    "planDigest",
  ], ["acquireTimeoutMs"], "Pod launch apply input");
  const workspaceRoot = rootPath(input.workspaceRoot, "workspaceRoot");
  const stateRoot = rootPath(input.stateRoot, "stateRoot");
  const expectedProgramId = typedId(input.expectedProgramId, "program", "expectedProgramId");
  digest(input.planDigest, "planDigest");
  const plan = canonicalSnapshot(input.plan, "Pod launch initialization plan");
  if (!plainObject(plan) || plan.kind !== PLAN_KIND || plan.schemaVersion !== SCHEMA_VERSION) {
    fail("wakeflow-pod-service-contract", "apply requires one Wakeflow Pod launch initialization plan");
  }
  if (plan.planDigest !== input.planDigest) {
    fail("wakeflow-pod-service-contract", "plan and planDigest differ");
  }
  const unsigned = structuredClone(plan);
  delete unsigned.planDigest;
  if (canonicalJsonDigest(unsigned) !== input.planDigest) {
    fail("wakeflow-pod-service-contract", "planDigest does not cover the exact plan payload");
  }
  if (
    plan.workspaceRoot !== workspaceRoot
    || plan.stateRoot !== stateRoot
    || plan.programId !== expectedProgramId
  ) {
    fail("wakeflow-pod-service-stale-plan", "plan belongs to another explicit workspace/state/program authority");
  }
  return frozen({
    workspaceRoot,
    stateRoot,
    expectedProgramId,
    plan,
    planDigest: input.planDigest,
    acquireTimeoutMs: timeout(input.acquireTimeoutMs),
  });
}

function loadConfig(input) {
  let config;
  try {
    config = loadWakeflowConfigV3Snapshot({ workspaceRoot: input.workspaceRoot });
  } catch (cause) {
    boundary("config", cause, "strict Wakeflow v3 config is unavailable");
  }
  if (config.model.program.programId !== input.expectedProgramId) {
    fail("wakeflow-pod-service-config", "expectedProgramId does not own wakeflow.config.json");
  }
  return config;
}

function currentPodProfile() {
  let profile;
  try {
    profile = normalizeWakeflowHostCapabilityProfile(hostProfile);
  } catch (cause) {
    boundary("host-profile", cause, "current host capability profile is invalid");
  }
  if (!profile.capabilities.pod.applicable) {
    fail("wakeflow-pod-service-host-profile", "current host does not expose the Pod capability");
  }
  return profile;
}

function validateInitializationRequest(input, config, loaded, profile) {
  if (TERMINAL_DEMAND_STATES.has(loaded.state.state)) {
    fail("wakeflow-pod-service-state", `terminal demand ${loaded.state.state} cannot initialize a Pod`);
  }
  if (loaded.demand.executionPlacement.mode !== "isolated") {
    fail("wakeflow-pod-service-placement", "only an explicitly isolated demand may initialize a Pod");
  }
  const expectedPlacementDigest = canonicalJsonDigest(
    loaded.demand.executionPlacement.authorizationRef,
  );
  if (
    input.scope.programId !== input.expectedProgramId
    || input.scope.programId !== config.model.program.programId
    || input.scope.demandId !== loaded.demand.demandId
    || input.scope.hostId !== profile.hostId
    || input.scope.placementAuthorizationDigest !== expectedPlacementDigest
  ) {
    fail("wakeflow-pod-service-authority", "Pod scope differs from config, host, demand, or isolated placement authority");
  }
  if (input.scope.createdAt !== input.transition.createdAt) {
    fail("wakeflow-pod-service-time", "Pod scope createdAt must equal its controller event timestamp");
  }
  if (input.launchIntents.some((entry) => entry.role === "product")) {
    fail(
      "wakeflow-pod-service-product-admission-pending",
      "product launch intent requires the T02b portable Design handoff authority",
    );
  }
  if (
    input.launchIntents.length !== CONTROL_ROLES.length
    || new Set(input.launchIntents.map((entry) => entry.role)).size !== CONTROL_ROLES.length
    || CONTROL_ROLES.some((role) => !input.launchIntents.some((entry) => entry.role === role))
  ) {
    fail("wakeflow-pod-service-control-members", "Pod initialization requires exactly one controller, Design, and Test intent");
  }
  const identityFields = ["windowId", "launchOperationId", "bindingId"];
  for (const field of identityFields) {
    if (new Set(input.launchIntents.map((entry) => entry[field])).size !== input.launchIntents.length) {
      fail("wakeflow-pod-service-control-members", `Pod control ${field} values must be unique`);
    }
  }
  const resourceKeys = input.launchIntents
    .filter((entry) => Object.hasOwn(entry, "hostResourceKey"))
    .map((entry) => entry.hostResourceKey);
  if (new Set(resourceKeys).size !== resourceKeys.length) {
    fail("wakeflow-pod-service-control-members", "Pod hostResourceKey values must be unique when supplied");
  }
  for (const entry of input.launchIntents) {
    if (
      entry.programId !== input.scope.programId
      || entry.hostId !== input.scope.hostId
      || entry.podId !== input.scope.podId
      || entry.demandId !== input.scope.demandId
      || entry.createdAt !== input.transition.createdAt
      || !CONTROL_ROLE_SET.has(entry.role)
    ) {
      fail("wakeflow-pod-service-authority", "control launch intent differs from the exact scope/event identity");
    }
  }
}

function tuple(record) {
  return frozen({ record, ref: podRecordRef(record), digest: podRecordDigest(record) });
}

function initialPodState(input) {
  const scope = tuple(input.scope);
  const launchIntents = input.launchIntents.map(tuple);
  return frozen({
    podId: input.scope.podId,
    hostId: input.scope.hostId,
    placementAuthorizationDigest: input.scope.placementAuthorizationDigest,
    scope: { ref: scope.ref, digest: scope.digest },
    phase: "reserved",
    windows: launchIntents.map((entry) => ({
      windowId: entry.record.windowId,
      role: entry.record.role,
      launchOperationId: entry.record.launchOperationId,
      bindingId: entry.record.bindingId,
      launchIntent: { ref: entry.ref, digest: entry.digest },
      status: "planned",
    })),
  });
}

function buildInitializeEvent(input, loaded, pod) {
  return validateControllerEventRecord({
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: input.transition.eventId,
    demandId: loaded.demand.demandId,
    createdAt: input.transition.createdAt,
    actor: "controller",
    command: "initialize-pod",
    type: "pod.initialized",
    previousRevision: loaded.state.revision,
    nextRevision: loaded.state.revision + 1,
    from: loaded.state.state,
    to: loaded.state.state,
    reason: input.transition.reason,
    decisionSummary: input.transition.decisionSummary,
    changedArtifacts: [],
    podTransition: {
      podId: pod.podId,
      action: "initialize",
      previousPodDigest: null,
      nextPodDigest: canonicalJsonDigest(pod),
    },
  });
}

function buildInitializeState(loaded, event, pod) {
  return validateDemandStateRecord({
    ...loaded.state,
    revision: event.nextRevision,
    stateReason: event.reason,
    updatedAt: event.createdAt,
    lastEvent: {
      eventId: event.eventId,
      eventDigest: canonicalJsonDigest(event),
    },
    pod,
  });
}

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function staticWindow(value) {
  return {
    windowId: value.windowId,
    role: value.role,
    launchOperationId: value.launchOperationId,
    bindingId: value.bindingId,
    launchIntent: value.launchIntent,
    ...(value.repositoryId ? { repositoryId: value.repositoryId } : {}),
  };
}

function assertExactStateEvidence(
  state,
  podSource,
  desiredScope,
  desiredIntents,
  { allowedUnlinkedIntents = [] } = {},
) {
  if (!podSource || podSource.issues.length > 0 || !podSource.scopeSource) {
    fail("wakeflow-pod-service-authority-damaged", "state-selected Pod evidence is missing or structurally invalid");
  }
  if (!POD_DIRECTORIES.every((name) => podSource.directories.has(`${podSource.rootRef}/${name}`))) {
    fail("wakeflow-pod-service-authority-damaged", "state-selected Pod evidence capability tree is incomplete");
  }
  if (
    podSource.scopeSource.ref !== state.pod.scope.ref
    || podSource.scopeSource.digest !== state.pod.scope.digest
    || !same(podSource.scopeSource.record, desiredScope.record)
  ) {
    fail("wakeflow-pod-service-authority-damaged", "state-selected Pod scope differs from immutable local evidence");
  }
  const desiredByWindow = new Map(desiredIntents.map((entry) => [entry.record.windowId, entry]));
  for (const desired of desiredIntents) {
    const current = state.pod.windows.find((entry) => entry.windowId === desired.record.windowId);
    const expectedWindow = {
      windowId: desired.record.windowId,
      role: desired.record.role,
      launchOperationId: desired.record.launchOperationId,
      bindingId: desired.record.bindingId,
      launchIntent: { ref: desired.ref, digest: desired.digest },
      ...(desired.record.repositoryId ? { repositoryId: desired.record.repositoryId } : {}),
    };
    if (!current || !same(staticWindow(current), expectedWindow)) {
      fail("wakeflow-pod-service-conflict", "current Pod control membership differs from the original launch intent");
    }
  }
  for (const current of state.pod.windows) {
    const source = podSource.recordsByRef.get(current.launchIntent.ref);
    if (
      !source
      || source.digest !== current.launchIntent.digest
      || source.record.windowId !== current.windowId
      || source.record.launchOperationId !== current.launchOperationId
      || source.record.bindingId !== current.bindingId
      || source.record.role !== current.role
      || (source.record.repositoryId ?? null) !== (current.repositoryId ?? null)
    ) {
      fail("wakeflow-pod-service-authority-damaged", "current Pod member has no exact immutable launch intent");
    }
  }
  const allowedUnlinkedByRef = new Map(
    allowedUnlinkedIntents.map((entry) => [entry.ref, entry]),
  );
  for (const source of podSource.launchSources) {
    if (!state.pod.windows.some((entry) => entry.launchIntent.ref === source.ref)) {
      const allowed = allowedUnlinkedByRef.get(source.ref);
      if (allowed && allowed.digest === source.digest && same(allowed.record, source.record)) continue;
      fail("wakeflow-pod-service-authority-damaged", "unlinked launch intent exists beside state-selected Pod authority");
    }
  }
  return desiredByWindow;
}

function prefixClassification(podSource, desiredRecords) {
  if (!podSource) return "absent";
  if (podSource.issues.length > 0) {
    fail("wakeflow-pod-service-evidence-conflict", "Pod evidence tree contains invalid or unknown residue", {
      issues: podSource.issues,
    });
  }
  const desiredByRef = new Map(desiredRecords.map((entry) => [entry.ref, entry]));
  for (const source of podSource.records) {
    const desired = desiredByRef.get(source.ref);
    if (!desired || desired.digest !== source.digest || !same(desired.record, source.record)) {
      fail("wakeflow-pod-service-evidence-conflict", "Pod evidence prefix contains a different immutable record", {
        ref: source.ref,
      });
    }
  }
  return desiredRecords.every((entry) => podSource.recordsByRef.has(entry.ref))
    && POD_DIRECTORIES.every((name) => podSource.directories.has(`${podSource.rootRef}/${name}`))
    ? "complete"
    : "prefix";
}

function derivePlanFromLoaded(input, config, loaded, profile) {
  validateInitializationRequest(input, config, loaded, profile);
  const inventory = scanPodInventory({
    workspaceRoot: input.workspaceRoot,
    expectedProgramId: input.expectedProgramId,
    hostId: profile.hostId,
  });
  const podSource = inventory.podById.get(input.scope.podId) ?? null;
  const publicPod = inventory.public.pods.find((entry) => entry.podId === input.scope.podId) ?? null;
  const scope = tuple(input.scope);
  const launchIntents = input.launchIntents.map(tuple);
  const desiredRecords = [scope, ...launchIntents];
  let mode;
  let event;
  let nextState;
  let evidencePrefix;
  if (!loaded.state.pod) {
    evidencePrefix = prefixClassification(podSource, desiredRecords);
    const pod = initialPodState(input);
    event = buildInitializeEvent(input, loaded, pod);
    nextState = buildInitializeState(loaded, event, pod);
    mode = "initialize";
  } else {
    if (
      loaded.state.pod.podId !== input.scope.podId
      || loaded.state.pod.hostId !== input.scope.hostId
      || loaded.state.pod.placementAuthorizationDigest !== input.scope.placementAuthorizationDigest
    ) {
      fail("wakeflow-pod-service-conflict", "demand already owns a different Pod identity");
    }
    assertExactStateEvidence(loaded.state, podSource, scope, launchIntents);
    const initialPod = initialPodState(input);
    const matches = loaded.events.filter((entry) => (
      entry.command === "initialize-pod"
      && entry.type === "pod.initialized"
      && entry.podTransition?.podId === input.scope.podId
      && entry.podTransition?.nextPodDigest === canonicalJsonDigest(initialPod)
    ));
    if (matches.length !== 1) {
      fail("wakeflow-pod-service-authority-damaged", "current Pod has no unique exact initialization event");
    }
    [event] = matches;
    if (
      event.eventId !== input.transition.eventId
      || event.createdAt !== input.transition.createdAt
      || event.reason !== input.transition.reason
      || event.decisionSummary !== input.transition.decisionSummary
    ) {
      fail("wakeflow-pod-service-conflict", "Pod initialization is already bound to a different controller event intent");
    }
    nextState = null;
    mode = "replay";
    evidencePrefix = "complete";
  }
  const unsigned = {
    kind: PLAN_KIND,
    schemaVersion: SCHEMA_VERSION,
    mode,
    workspaceRoot: input.workspaceRoot,
    stateRoot: input.stateRoot,
    programId: input.expectedProgramId,
    demandId: loaded.demand.demandId,
    hostId: profile.hostId,
    podId: input.scope.podId,
    config: { ref: config.ref, digest: config.configDigest },
    sourceState: loaded.state,
    sourceStateDigest: loaded.digests.state,
    evidenceInventoryDigest: canonicalJsonDigest({
      programId: input.expectedProgramId,
      hostId: profile.hostId,
      podId: input.scope.podId,
      pod: publicPod,
    }),
    evidencePrefix,
    scope,
    launchIntents,
    transition: input.transition,
    event,
    nextState,
  };
  return deepFreeze({ ...unsigned, planDigest: canonicalJsonDigest(unsigned) });
}

function derivePlanWhileLocked(input, config, profile) {
  let loaded;
  try {
    loaded = loadDemandCoreRecordsWithArtifactClosureWhileLocked({
      stateRoot: input.stateRoot,
      expectedProgramId: input.expectedProgramId,
      ledgerRoot: config.ledgerRoot,
    });
  } catch (cause) {
    boundary("state", cause, "strict locked demand state authority is unavailable");
  }
  return derivePlanFromLoaded(input, config, loaded, profile);
}

// 为Controller、Design、Test三类控制窗口冻结scope、launch intents及首个Pod state transition。
export function planPodLaunchInitialization(value = {}) {
  const input = normalizePlanInput(value);
  const config = loadConfig(input);
  const profile = currentPodProfile();
  return withStateRootLock(input.stateRoot, () => derivePlanWhileLocked(input, config, profile));
}

function requestFromPlan(plan) {
  return frozen({
    workspaceRoot: plan.workspaceRoot,
    stateRoot: plan.stateRoot,
    expectedProgramId: plan.programId,
    scope: plan.scope.record,
    launchIntents: plan.launchIntents.map((entry) => entry.record),
    transition: plan.transition,
  });
}

function ensurePodTree(workspaceRoot, hostId, podId) {
  const rootRef = `.wakeflow-local/runtime/hosts/${hostId}/evidence/pods`;
  const staticRoot = resolveRef(workspaceRoot, rootRef);
  inspectDirectory(staticRoot, "Pod evidence static capability root");
  const podRoot = path.join(staticRoot, podId);
  if (inspectDirectory(podRoot, "Pod evidence root", { allowMissing: true }) === null) {
    createPrivateDirectory(podRoot, staticRoot, "Pod evidence root");
  }
  for (const name of POD_DIRECTORIES) {
    const directory = path.join(podRoot, name);
    if (inspectDirectory(directory, `Pod ${name} capability`, { allowMissing: true }) === null) {
      createPrivateDirectory(directory, podRoot, `Pod ${name} capability`);
    }
  }
  return podRoot;
}

function syncCommittedFile(target, expectedBytes) {
  let descriptor = null;
  try {
    descriptor = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const opened = fs.fstatSync(descriptor, { bigint: true });
    const linked = fs.lstatSync(target, { bigint: true });
    if (!sameNode(opened, linked) || !fs.readFileSync(descriptor).equals(expectedBytes)) {
      fail("wakeflow-pod-service-durability", "committed Pod evidence differs before durability sync");
    }
    fs.fsyncSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    const afterPath = fs.lstatSync(target, { bigint: true });
    if (!sameNode(opened, after) || !sameNode(opened, afterPath)) {
      fail("wakeflow-pod-service-durability", "committed Pod evidence changed during durability sync");
    }
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
  syncDirectory(path.dirname(target), "Pod evidence parent");
}

function ensureImmutableRecord(workspaceRoot, desired) {
  const target = resolveRef(workspaceRoot, desired.ref);
  let present = true;
  try {
    fs.lstatSync(target);
  } catch (cause) {
    if (cause?.code !== "ENOENT") throw cause;
    present = false;
  }
  if (present) {
    const source = readCanonicalRecord(target, desired.ref);
    if (source.digest !== desired.digest || !same(source.record, desired.record)) {
      fail("wakeflow-pod-service-evidence-conflict", "immutable Pod evidence already has different canonical bytes", {
        ref: desired.ref,
      });
    }
    return "replayed";
  }
  const bytes = podRecordCanonicalBytes(desired.record);
  atomicWriteFile({
    root: workspaceRoot,
    target,
    content: bytes,
    expectation: { type: "absent" },
    mode: FILE_MODE,
    ownership: "whole-file",
    label: "immutable Pod evidence",
  });
  syncCommittedFile(target, bytes);
  return "created";
}

function exactCompleteEvidence(input, plan) {
  const inventory = scanPodInventory({
    workspaceRoot: input.workspaceRoot,
    expectedProgramId: input.expectedProgramId,
    hostId: plan.hostId,
  });
  const podSource = inventory.podById.get(plan.podId) ?? null;
  return prefixClassification(podSource, [plan.scope, ...plan.launchIntents]) === "complete";
}

function recoverExactPlanJournal(input, config, plan) {
  if (plan.mode !== "initialize") return Object.freeze({ status: "none" });
  return recoverDemandPodTransitionWhileLocked({
    stateRoot: input.stateRoot,
    expectedProgramId: input.expectedProgramId,
    ledgerRoot: config.ledgerRoot,
    admitRecoveryWhileLocked: ({ journal }) => {
      if (
        !same(journal.nextEvent, plan.event)
        || !same(journal.nextState, plan.nextState)
        || journal.expectedPreviousRevision !== plan.sourceState.revision
        || journal.expectedPreviousStateDigest !== plan.sourceStateDigest
        || journal.artifactWrites.length !== 0
        || !exactCompleteEvidence(input, plan)
      ) {
        fail("wakeflow-pod-service-recovery-required", "pending Pod state journal is not the exact complete launch initialization");
      }
      return { admitted: true };
    },
  });
}

function resultFromLoaded(status, loaded, plan) {
  return frozen({
    status,
    programId: plan.programId,
    demandId: plan.demandId,
    hostId: plan.hostId,
    podId: plan.podId,
    scope: { ref: plan.scope.ref, digest: plan.scope.digest },
    launchIntents: plan.launchIntents.map((entry) => ({
      windowId: entry.record.windowId,
      launchOperationId: entry.record.launchOperationId,
      ref: entry.ref,
      digest: entry.digest,
    })),
    revision: loaded.state.revision,
    stateDigest: loaded.digests.state,
  });
}

function loadLocked(input, config) {
  try {
    return loadDemandCoreRecordsWithArtifactClosureWhileLocked({
      stateRoot: input.stateRoot,
      expectedProgramId: input.expectedProgramId,
      ledgerRoot: config.ledgerRoot,
    });
  } catch (cause) {
    boundary("state", cause, "strict locked demand state authority is unavailable");
  }
}

function safeReleaseVerdict(value, name = "pod-launch-initialization-closure") {
  return {
    disposition: "safe-to-release",
    closureDigests: [{
      name,
      digest: canonicalJsonDigest(value),
    }],
  };
}

function verifyFailureClosure(input, tracker) {
  if (!tracker.plan) {
    fail("wakeflow-pod-service-recovery-required", "Pod failure has no exact admitted plan");
  }
  return withStateRootLock(input.stateRoot, () => {
    const currentConfig = loadConfig(input);
    if (currentConfig.configDigest !== tracker.plan.config.digest) {
      fail("wakeflow-pod-service-recovery-required", "Pod failure changed config authority");
    }
    recoverExactPlanJournal(input, currentConfig, tracker.plan);
    const loaded = loadLocked(input, currentConfig);
    const inventory = scanPodInventory({
      workspaceRoot: input.workspaceRoot,
      expectedProgramId: input.expectedProgramId,
      hostId: tracker.plan.hostId,
    });
    const podSource = inventory.podById.get(tracker.plan.podId) ?? null;
    const evidence = prefixClassification(podSource, [tracker.plan.scope, ...tracker.plan.launchIntents]);
    let state;
    if (loaded.digests.state === tracker.plan.sourceStateDigest) {
      if (tracker.plan.mode === "replay" && evidence !== "complete") {
        fail("wakeflow-pod-service-recovery-required", "replay failure damaged selected Pod evidence");
      }
      state = "previous";
    } else if (
      tracker.plan.mode === "initialize"
      && loaded.digests.state === canonicalJsonDigest(tracker.plan.nextState)
      && evidence === "complete"
    ) {
      state = "committed";
    } else {
      fail("wakeflow-pod-service-recovery-required", "Pod failure is neither exact previous nor exact committed authority");
    }
    return safeReleaseVerdict({
      state,
      evidence,
      configDigest: currentConfig.configDigest,
      stateDigest: loaded.digests.state,
      eventsDigest: canonicalJsonDigest(loaded.events),
      inventoryDigest: inventory.public.inventoryDigest,
      journal: "absent",
    });
  });
}

function applyWhileLocked(input, config, profile, mutationContext, tracker) {
  assertWakeflowMutationContext({
    workspaceRoot: input.workspaceRoot,
    context: mutationContext,
    mode: "runtime-mutation",
  });
  tracker.plan = input.plan;
  const currentConfig = loadConfig(input);
  if (
    currentConfig.configDigest !== config.configDigest
    || currentConfig.configDigest !== input.plan.config.digest
  ) {
    fail("wakeflow-pod-service-stale-plan", "Pod launch initialization config authority changed");
  }
  const recovered = recoverExactPlanJournal(input, currentConfig, input.plan);
  if (recovered.status === "recovered") {
    const loaded = loadLocked(input, currentConfig);
    if (
      loaded.digests.state !== canonicalJsonDigest(input.plan.nextState)
      || !exactCompleteEvidence(input, input.plan)
    ) {
      fail("wakeflow-pod-service-recovery-required", "recovered Pod initialization did not close exact authority");
    }
    return resultFromLoaded("recovered", loaded, input.plan);
  }

  const request = requestFromPlan(input.plan);
  const currentPlan = derivePlanWhileLocked(request, currentConfig, profile);
  if (!same(currentPlan, input.plan)) {
    fail("wakeflow-pod-service-stale-plan", "Pod launch initialization plan is stale");
  }
  if (input.plan.mode === "replay") {
    return resultFromLoaded("replayed", loadLocked(input, currentConfig), input.plan);
  }

  ensurePodTree(input.workspaceRoot, input.plan.hostId, input.plan.podId);
  ensureImmutableRecord(input.workspaceRoot, input.plan.scope);
  for (const intent of input.plan.launchIntents) ensureImmutableRecord(input.workspaceRoot, intent);
  if (!exactCompleteEvidence(input, input.plan)) {
    fail("wakeflow-pod-service-evidence-closure", "Pod launch evidence did not close after create-only publication");
  }
  commitDemandPodTransitionWhileLocked({
    stateRoot: input.stateRoot,
    expectedProgramId: input.expectedProgramId,
    ledgerRoot: currentConfig.ledgerRoot,
    expectedPrevious: {
      revision: input.plan.sourceState.revision,
      stateDigest: input.plan.sourceStateDigest,
    },
    event: input.plan.event,
    nextState: input.plan.nextState,
  });
  const loaded = loadLocked(input, currentConfig);
  if (
    loaded.digests.state !== canonicalJsonDigest(input.plan.nextState)
    || !exactCompleteEvidence(input, input.plan)
  ) {
    fail("wakeflow-pod-service-authority-closure", "Pod launch initialization did not close exact state and evidence authority");
  }
  return resultFromLoaded("initialized", loaded, input.plan);
}

// 以create-only证据写入优先、state提交在后的顺序应用初始化计划，并支持精确replay与journal恢复。
export async function applyPodLaunchInitializationPlan(value = {}) {
  const input = normalizeApplyInput(value);
  const config = loadConfig(input);
  if (config.configDigest !== input.plan.config.digest) {
    fail("wakeflow-pod-service-stale-plan", "Pod launch initialization plan no longer matches config authority");
  }
  const profile = currentPodProfile();
  const tracker = { plan: null };
  try {
    return await withWakeflowRuntimeMutation({
      workspaceRoot: input.workspaceRoot,
      operationKind: "pod-launch-initialization",
      domainOwner: "core-pod-service",
      ...(input.acquireTimeoutMs === undefined ? {} : { acquireTimeoutMs: input.acquireTimeoutMs }),
      onCallbackFailure: () => verifyFailureClosure(input, tracker),
    }, (mutationContext) => withStateRootLock(input.stateRoot, () => (
      applyWhileLocked(input, config, profile, mutationContext, tracker)
    )));
  } catch (cause) {
    boundary("apply", cause, "Pod launch initialization failed closed");
  }
}

function normalizeDesignArtifactInput(input, artifactKind) {
  exactKeys(input, [
    "workspaceRoot",
    "stateRoot",
    "expectedProgramId",
    "expectedPrevious",
    "artifact",
    "transition",
  ], [], `${artifactKind} input`);
  let artifact;
  try {
    artifact = artifactKind === "wakeflow-pod-design-request"
      ? validatePodDesignRequestArtifact(input.artifact)
      : validatePodDesignHandoffArtifact(input.artifact);
  } catch (cause) {
    boundary("contract", cause, `${artifactKind} is invalid`);
  }
  return frozen({
    workspaceRoot: rootPath(input.workspaceRoot, "workspaceRoot"),
    stateRoot: rootPath(input.stateRoot, "stateRoot"),
    expectedProgramId: typedId(input.expectedProgramId, "program", "expectedProgramId"),
    expectedPrevious: normalizeExpectedPrevious(input.expectedPrevious),
    artifact,
    transition: normalizeTransition(input.transition),
  });
}

function assertMutablePodDemand(loaded, label) {
  if (TERMINAL_DEMAND_STATES.has(loaded.state.state)) {
    fail("wakeflow-pod-service-state", `${label} cannot mutate terminal demand ${loaded.state.state}`);
  }
  if (loaded.demand.executionPlacement.mode !== "isolated") {
    fail("wakeflow-pod-service-placement", `${label} requires an explicitly isolated demand`);
  }
}

function assertDesignArtifactDemandBinding(input, loaded) {
  const artifact = input.artifact;
  if (
    artifact.programId !== input.expectedProgramId
    || artifact.programId !== loaded.demand.programId
    || artifact.demandId !== loaded.demand.demandId
    || artifact.demandRef !== "demand.json"
    || artifact.demandDigest !== loaded.digests.demand
    || artifact.createdAt !== input.transition.createdAt
  ) {
    fail(
      "wakeflow-pod-service-design-authority",
      "Pod Design artifact must bind the exact program, demand, and controller event",
    );
  }
  if (Date.parse(input.transition.createdAt) < Date.parse(loaded.state.updatedAt)) {
    fail("wakeflow-pod-service-time", "Pod Design event cannot precede the current state tail");
  }
}

function assertControlReadyPod(loaded, profile, artifact, phase) {
  const pod = loaded.state.pod;
  if (
    !pod
    || pod.podId !== artifact.podId
    || pod.hostId !== profile.hostId
    || pod.phase !== phase
    || pod.windows.length !== CONTROL_ROLES.length
    || pod.windows.some((entry) => !CONTROL_ROLE_SET.has(entry.role) || entry.status !== "bound")
    || CONTROL_ROLES.some((role) => !pod.windows.some((entry) => entry.role === role))
  ) {
    fail(
      "wakeflow-pod-service-design-gate",
      `Pod Design ${phase === "control-ready" ? "request" : "handoff"} requires exactly three bound control members in phase ${phase}`,
    );
  }
  return pod;
}

function exactDesignArtifact(loaded, tuple, artifactKind, artifactId) {
  try {
    return loadDemandArtifactByRef({
      stateRoot: loaded.paths.stateRoot,
      ref: tuple.ref,
      digest: tuple.digest,
      expectedArtifactKind: artifactKind,
      expectedArtifactId: artifactId,
      expectedProgramId: loaded.demand.programId,
      expectedDemandId: loaded.demand.demandId,
    }).record;
  } catch (cause) {
    boundary("design-authority", cause, `current ${artifactKind} selector is unavailable`);
  }
}

function assertHandoffAuthority(input, config, loaded) {
  const handoff = input.artifact;
  const pod = assertControlReadyPod(loaded, input.profile, handoff, "designing");
  if (
    !pod.designRequest
    || pod.designHandoff
    || loaded.authority === null
    || loaded.authority.entryMode !== "pod-design"
  ) {
    fail(
      "wakeflow-pod-service-design-gate",
      "Pod Design handoff requires one current request, frozen demand authority, and no prior handoff",
    );
  }
  const request = exactDesignArtifact(
    loaded,
    pod.designRequest,
    "wakeflow-pod-design-request",
    pod.designRequest.podDesignRequestId,
  );
  if (
    handoff.podId !== pod.podId
    || handoff.designRequest.podDesignRequestId !== pod.designRequest.podDesignRequestId
    || handoff.designRequest.ref !== pod.designRequest.ref
    || handoff.designRequest.digest !== pod.designRequest.digest
    || handoff.demandAuthority.ref !== "demand-authority.json"
    || handoff.demandAuthority.digest !== loaded.digests.authority
    || !same(handoff.requirementRefs, request.requirementRefs)
    || !same(handoff.nonGoals, request.nonGoals)
    || !same(handoff.testDecision, loaded.authority.testDecision)
  ) {
    fail(
      "wakeflow-pod-service-design-authority",
      "Pod Design handoff differs from the current request or frozen demand authority",
    );
  }
  for (const landing of handoff.landingPlan) {
    const repository = config.indexes.repositoryById[landing.repositoryId] ?? null;
    const responsibilityWindow = config.indexes.windowById[landing.responsibilityWindowId] ?? null;
    if (
      repository === null
      || responsibilityWindow?.role !== "product"
      || responsibilityWindow.root.kind !== "repository"
      || responsibilityWindow.root.repositoryId !== landing.repositoryId
    ) {
      fail(
        "wakeflow-pod-service-design-landing",
        "each Design landing entry must select a configured product responsibility window for the same repository",
        { repositoryId: landing.repositoryId, responsibilityWindowId: landing.responsibilityWindowId },
      );
    }
  }
  return { pod, request };
}

function buildDesignEvent({ loaded, input, nextPod, command, type, action, selectorField }) {
  const identity = demandArtifactIdentity(input.artifact);
  return validateControllerEventRecord({
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: input.transition.eventId,
    demandId: loaded.demand.demandId,
    createdAt: input.transition.createdAt,
    actor: "controller",
    command,
    type,
    previousRevision: loaded.state.revision,
    nextRevision: loaded.state.revision + 1,
    from: loaded.state.state,
    to: loaded.state.state,
    reason: input.transition.reason,
    decisionSummary: input.transition.decisionSummary,
    changedArtifacts: [identity],
    podTransition: {
      podId: nextPod.podId,
      action,
      [selectorField]: identity.artifactId,
      previousPodDigest: canonicalJsonDigest(loaded.state.pod),
      nextPodDigest: canonicalJsonDigest(nextPod),
    },
  });
}

function buildPodNextState(loaded, event, pod) {
  return validateDemandStateRecord({
    ...loaded.state,
    revision: event.nextRevision,
    stateReason: event.reason,
    updatedAt: event.createdAt,
    lastEvent: {
      eventId: event.eventId,
      eventDigest: canonicalJsonDigest(event),
    },
    pod,
  });
}

function deriveDesignArtifactTransition(input, config, loaded) {
  assertMutablePodDemand(loaded, "Pod Design artifact recording");
  assertDesignArtifactDemandBinding(input, loaded);
  const identity = demandArtifactIdentity(input.artifact);
  if (input.artifact.artifactKind === "wakeflow-pod-design-request") {
    const pod = assertControlReadyPod(loaded, input.profile, input.artifact, "control-ready");
    if (pod.designRequest || pod.designHandoff || loaded.authority !== null) {
      fail(
        "wakeflow-pod-service-design-gate",
        "initial Pod Design request requires absent Design selectors and must precede demand-authority freeze",
      );
    }
    if (
      input.artifact.demandType !== loaded.demand.demandType
      || input.artifact.originalGoal !== loaded.demand.goal
      || input.artifact.completionDefinition !== loaded.demand.completionDefinition
    ) {
      fail(
        "wakeflow-pod-service-design-authority",
        "Pod Design request must preserve the immutable demand goal, completion definition, and type",
      );
    }
    const nextPod = frozen({
      ...pod,
      phase: "designing",
      designRequest: {
        podDesignRequestId: identity.artifactId,
        ref: identity.ref,
        digest: identity.digest,
      },
    });
    const event = buildDesignEvent({
      loaded,
      input,
      nextPod,
      command: "record-pod-design-request",
      type: "pod.design-request-recorded",
      action: "record-design-request",
      selectorField: "podDesignRequestId",
    });
    return { event, nextState: buildPodNextState(loaded, event, nextPod) };
  }
  const { pod } = assertHandoffAuthority(input, config, loaded);
  const nextPod = frozen({
    ...pod,
    phase: "creating-products",
    designHandoff: {
      podDesignHandoffId: identity.artifactId,
      ref: identity.ref,
      digest: identity.digest,
    },
  });
  const event = buildDesignEvent({
    loaded,
    input,
    nextPod,
    command: "record-pod-design-handoff",
    type: "pod.design-handoff-recorded",
    action: "record-design-handoff",
    selectorField: "podDesignHandoffId",
  });
  return { event, nextState: buildPodNextState(loaded, event, nextPod) };
}

function existingDesignArtifactReplay(input, config, loaded) {
  const identity = demandArtifactIdentity(input.artifact);
  const events = loaded.events.filter((event) => event.changedArtifacts.some((entry) => (
    entry.artifactKind === identity.artifactKind
    && entry.artifactId === identity.artifactId
  )));
  if (events.length === 0) return null;
  if (events.length !== 1) {
    fail("wakeflow-pod-service-design-conflict", "Pod Design artifact identity has multiple controller events");
  }
  const [event] = events;
  const tuple = identity.artifactKind === "wakeflow-pod-design-request"
    ? loaded.state.pod?.designRequest
    : loaded.state.pod?.designHandoff;
  const selectorField = identity.artifactKind === "wakeflow-pod-design-request"
    ? "podDesignRequestId"
    : "podDesignHandoffId";
  const command = identity.artifactKind === "wakeflow-pod-design-request"
    ? "record-pod-design-request"
    : "record-pod-design-handoff";
  if (
    !tuple
    || tuple[selectorField] !== identity.artifactId
    || tuple.ref !== identity.ref
    || tuple.digest !== identity.digest
    || event.changedArtifacts.length !== 1
    || !same(event.changedArtifacts[0], identity)
    || event.command !== command
    || event.eventId !== input.transition.eventId
    || event.createdAt !== input.transition.createdAt
    || event.reason !== input.transition.reason
    || event.decisionSummary !== input.transition.decisionSummary
    || event.previousRevision !== input.expectedPrevious.revision
    || event.nextRevision !== loaded.state.revision
    || loaded.state.lastEvent.eventId !== event.eventId
    || loaded.state.lastEvent.eventDigest !== canonicalJsonDigest(event)
    || event.podTransition?.[selectorField] !== identity.artifactId
  ) {
    fail(
      "wakeflow-pod-service-design-conflict",
      "Pod Design artifact is already bound to a different state selector or controller intent",
    );
  }
  exactDesignArtifact(loaded, tuple, identity.artifactKind, identity.artifactId);
  const previousTail = loaded.events[event.previousRevision - 1] ?? null;
  if (!previousTail) {
    fail("wakeflow-pod-service-design-conflict", "Pod Design replay lacks its exact previous event tail");
  }
  const previousState = structuredClone(loaded.state);
  previousState.revision = previousTail.nextRevision;
  previousState.state = previousTail.to;
  previousState.stateReason = previousTail.reason;
  previousState.updatedAt = previousTail.createdAt;
  previousState.lastEvent = {
    eventId: previousTail.eventId,
    eventDigest: canonicalJsonDigest(previousTail),
  };
  if (identity.artifactKind === "wakeflow-pod-design-request") {
    previousState.pod.phase = "control-ready";
    delete previousState.pod.designRequest;
  } else {
    previousState.pod.phase = "designing";
    delete previousState.pod.designHandoff;
  }
  const validatedPrevious = validateDemandStateRecord(previousState);
  if (canonicalJsonDigest(validatedPrevious) !== input.expectedPrevious.stateDigest) {
    fail(
      "wakeflow-pod-service-design-conflict",
      "Pod Design replay differs from the exact original previous state digest",
    );
  }
  const rederived = deriveDesignArtifactTransition(input, config, {
    ...loaded,
    state: validatedPrevious,
  });
  if (!same(rederived.event, event) || !same(rederived.nextState, loaded.state)) {
    fail(
      "wakeflow-pod-service-design-conflict",
      "Pod Design replay cannot reproduce its exact committed event and state",
    );
  }
  return frozen({
    status: "replayed",
    programId: loaded.demand.programId,
    demandId: loaded.demand.demandId,
    podId: loaded.state.pod.podId,
    artifact: identity,
    revision: loaded.state.revision,
    stateDigest: loaded.digests.state,
  });
}

function recoverExactDesignArtifactJournal(input, config) {
  const identity = demandArtifactIdentity(input.artifact);
  return recoverDemandPodTransitionWhileLocked({
    stateRoot: input.stateRoot,
    expectedProgramId: input.expectedProgramId,
    ledgerRoot: config.ledgerRoot,
    admitRecoveryWhileLocked: ({ loaded, journal }) => {
      const write = journal.artifactWrites[0] ?? null;
      if (
        journal.artifactWrites.length !== 1
        || !write
        || write.artifactKind !== identity.artifactKind
        || write.artifactId !== identity.artifactId
        || write.ref !== identity.ref
        || write.digest !== identity.digest
        || !same(write.value, input.artifact)
        || journal.expectedPreviousRevision !== input.expectedPrevious.revision
        || journal.expectedPreviousStateDigest !== input.expectedPrevious.stateDigest
      ) {
        fail(
          "wakeflow-pod-service-recovery-required",
          "pending Pod Design journal differs from the exact requested artifact transaction",
        );
      }
      const previousLoaded = {
        ...loaded,
        state: journal.previousState,
        authority: loaded.authority,
      };
      const expected = deriveDesignArtifactTransition(input, config, previousLoaded);
      if (!same(journal.nextEvent, expected.event) || !same(journal.nextState, expected.nextState)) {
        fail(
          "wakeflow-pod-service-recovery-required",
          "pending Pod Design journal differs from the rederived state transition",
        );
      }
      return { admitted: true };
    },
  });
}

function recordPodDesignArtifact(input, artifactKind) {
  const config = loadConfig(input);
  const profile = currentPodProfile();
  input = frozen({ ...input, profile });
  try {
    return withStateRootLock(input.stateRoot, () => {
      const currentConfig = loadConfig(input);
      if (currentConfig.configDigest !== config.configDigest) {
        fail("wakeflow-pod-service-stale", "config authority changed before Pod Design recording");
      }
      const recovered = recoverExactDesignArtifactJournal(input, currentConfig);
      const loaded = loadLocked(input, currentConfig);
      const replay = existingDesignArtifactReplay(input, currentConfig, loaded);
      if (replay) {
        return recovered.status === "recovered" ? frozen({ ...replay, status: "recovered" }) : replay;
      }
      assertExpectedPrevious(loaded, input.expectedPrevious);
      const { event, nextState } = deriveDesignArtifactTransition(input, currentConfig, loaded);
      commitDemandPodTransitionWhileLocked({
        stateRoot: input.stateRoot,
        expectedProgramId: input.expectedProgramId,
        ledgerRoot: currentConfig.ledgerRoot,
        expectedPrevious: input.expectedPrevious,
        event,
        nextState,
        artifact: input.artifact,
      });
      const committed = loadLocked(input, currentConfig);
      const result = existingDesignArtifactReplay(input, currentConfig, committed);
      if (!result || committed.digests.state !== canonicalJsonDigest(nextState)) {
        fail(
          "wakeflow-pod-service-authority-closure",
          `${artifactKind} did not close exact artifact, event, and state authority`,
        );
      }
      return frozen({ ...result, status: "recorded" });
    });
  } catch (cause) {
    boundary("design-record", cause, `${artifactKind} recording failed closed`);
  }
}

// Design Request仍是demand artifact；此入口只组合Pod阶段准入与既有artifact/state事务owner。
export function recordPodDesignRequestArtifact(value = {}) {
  return recordPodDesignArtifact(
    normalizeDesignArtifactInput(value, "wakeflow-pod-design-request"),
    "wakeflow-pod-design-request",
  );
}

// Design Handoff沿用相同事务边界，并校验其request前驱和Pod phase闭包。
export function recordPodDesignHandoffArtifact(value = {}) {
  return recordPodDesignArtifact(
    normalizeDesignArtifactInput(value, "wakeflow-pod-design-handoff"),
    "wakeflow-pod-design-handoff",
  );
}

function normalizeProductPlanInput(input) {
  exactKeys(input, [
    "workspaceRoot",
    "stateRoot",
    "expectedProgramId",
    "launchIntents",
    "transition",
  ], [], "Pod product launch append input");
  const launchIntentInput = canonicalSnapshot(input.launchIntents, "product launchIntents");
  if (!Array.isArray(launchIntentInput) || launchIntentInput.length === 0) {
    fail("wakeflow-pod-service-contract", "product launchIntents must be one non-empty array");
  }
  let launchIntents;
  try {
    launchIntents = launchIntentInput.map((entry) => createPodLaunchIntentRecord(entry));
  } catch (cause) {
    boundary("contract", cause, "product launch intent is invalid");
  }
  if (launchIntents.some((entry) => (
    entry.role !== "product"
    || !Object.hasOwn(entry, "responsibilityWindowId")
  ))) {
    fail(
      "wakeflow-pod-service-product-contract",
      "product append accepts only product intents with an exact responsibilityWindowId",
    );
  }
  launchIntents.sort((left, right) => lexicalCompare(left.windowId, right.windowId));
  return frozen({
    workspaceRoot: rootPath(input.workspaceRoot, "workspaceRoot"),
    stateRoot: rootPath(input.stateRoot, "stateRoot"),
    expectedProgramId: typedId(input.expectedProgramId, "program", "expectedProgramId"),
    launchIntents,
    transition: normalizeTransition(input.transition),
  });
}

function normalizeProductApplyInput(input) {
  exactKeys(input, [
    "workspaceRoot",
    "stateRoot",
    "expectedProgramId",
    "plan",
    "planDigest",
  ], ["acquireTimeoutMs"], "Pod product launch append apply input");
  const workspaceRoot = rootPath(input.workspaceRoot, "workspaceRoot");
  const stateRoot = rootPath(input.stateRoot, "stateRoot");
  const expectedProgramId = typedId(input.expectedProgramId, "program", "expectedProgramId");
  digest(input.planDigest, "planDigest");
  const plan = canonicalSnapshot(input.plan, "Pod product launch append plan");
  if (
    !plainObject(plan)
    || plan.kind !== PRODUCT_APPEND_PLAN_KIND
    || plan.schemaVersion !== SCHEMA_VERSION
  ) {
    fail("wakeflow-pod-service-contract", "apply requires one Pod product launch append plan");
  }
  if (plan.planDigest !== input.planDigest) {
    fail("wakeflow-pod-service-contract", "product append plan and planDigest differ");
  }
  const unsigned = structuredClone(plan);
  delete unsigned.planDigest;
  if (canonicalJsonDigest(unsigned) !== input.planDigest) {
    fail("wakeflow-pod-service-contract", "product append planDigest does not cover the exact plan");
  }
  if (
    plan.workspaceRoot !== workspaceRoot
    || plan.stateRoot !== stateRoot
    || plan.programId !== expectedProgramId
  ) {
    fail("wakeflow-pod-service-stale-plan", "product append plan belongs to another workspace authority");
  }
  return frozen({
    workspaceRoot,
    stateRoot,
    expectedProgramId,
    plan,
    planDigest: input.planDigest,
    acquireTimeoutMs: timeout(input.acquireTimeoutMs),
  });
}

function loadCurrentPodDesignAuthority(loaded, config, profile) {
  const pod = loaded.state.pod;
  if (
    !pod
    || pod.hostId !== profile.hostId
    || !pod.designRequest
    || !pod.designHandoff
    || loaded.authority === null
    || loaded.authority.entryMode !== "pod-design"
  ) {
    fail(
      "wakeflow-pod-service-product-gate",
      "product append requires current Pod request, handoff, and demand authority",
    );
  }
  const request = exactDesignArtifact(
    loaded,
    pod.designRequest,
    "wakeflow-pod-design-request",
    pod.designRequest.podDesignRequestId,
  );
  const handoff = exactDesignArtifact(
    loaded,
    pod.designHandoff,
    "wakeflow-pod-design-handoff",
    pod.designHandoff.podDesignHandoffId,
  );
  if (
    request.podId !== pod.podId
    || handoff.podId !== pod.podId
    || handoff.designRequest.podDesignRequestId !== pod.designRequest.podDesignRequestId
    || handoff.designRequest.ref !== pod.designRequest.ref
    || handoff.designRequest.digest !== pod.designRequest.digest
    || handoff.demandAuthority.ref !== "demand-authority.json"
    || handoff.demandAuthority.digest !== loaded.digests.authority
    || !same(handoff.requirementRefs, request.requirementRefs)
    || !same(handoff.nonGoals, request.nonGoals)
    || !same(handoff.testDecision, loaded.authority.testDecision)
  ) {
    fail(
      "wakeflow-pod-service-product-authority",
      "current Pod Design selectors do not close the exact request and demand authority",
    );
  }
  for (const landing of handoff.landingPlan) {
    const repository = config.indexes.repositoryById[landing.repositoryId] ?? null;
    const responsibility = config.indexes.windowById[landing.responsibilityWindowId] ?? null;
    if (
      repository === null
      || responsibility?.role !== "product"
      || responsibility.root.kind !== "repository"
      || responsibility.root.repositoryId !== landing.repositoryId
    ) {
      fail(
        "wakeflow-pod-service-product-authority",
        "current Design handoff no longer resolves to exact config repository responsibility",
      );
    }
  }
  return { pod, request, handoff };
}

function validateProductIntentSet(input, config, loaded, profile, designAuthority) {
  const { pod, handoff } = designAuthority;
  if (Date.parse(input.transition.createdAt) < Date.parse(loaded.state.updatedAt)) {
    fail("wakeflow-pod-service-time", "product append event cannot precede the current state tail");
  }
  const identityFields = ["windowId", "launchOperationId", "bindingId", "repositoryId"];
  for (const field of identityFields) {
    if (new Set(input.launchIntents.map((entry) => entry[field])).size !== input.launchIntents.length) {
      fail("wakeflow-pod-service-product-coverage", `product intent ${field} values must be unique`);
    }
  }
  const resourceKeys = input.launchIntents
    .filter((entry) => Object.hasOwn(entry, "hostResourceKey"))
    .map((entry) => entry.hostResourceKey);
  if (new Set(resourceKeys).size !== resourceKeys.length) {
    fail("wakeflow-pod-service-product-coverage", "product hostResourceKey values must be unique");
  }
  const landingByRepository = new Map(
    handoff.landingPlan.map((entry) => [entry.repositoryId, entry]),
  );
  const intendedRepositoryIds = input.launchIntents.map((entry) => entry.repositoryId).sort();
  const landingRepositoryIds = [...landingByRepository.keys()].sort();
  if (
    intendedRepositoryIds.length !== landingRepositoryIds.length
    || intendedRepositoryIds.some((repositoryId, index) => repositoryId !== landingRepositoryIds[index])
  ) {
    fail(
      "wakeflow-pod-service-product-coverage",
      "product intents must cover the entire exact Design landing repository set once",
    );
  }
  const currentWindowIds = new Set(pod.windows.map((entry) => entry.windowId));
  const currentProductWindowIds = new Set(
    pod.windows.filter((entry) => entry.role === "product").map((entry) => entry.windowId),
  );
  const currentProductByRepository = new Map(
    pod.windows
      .filter((entry) => entry.role === "product")
      .map((entry) => [entry.repositoryId, entry]),
  );
  for (const intent of input.launchIntents) {
    const landing = landingByRepository.get(intent.repositoryId);
    const repository = config.indexes.repositoryById[intent.repositoryId];
    const sourceDigest = canonicalJsonDigest({
      repositoryId: intent.repositoryId,
      path: repository.path,
    });
    const existingProduct = currentProductByRepository.get(intent.repositoryId) ?? null;
    const launchIdentityConflicts = pod.windows.some((entry) => (
      entry.launchOperationId === intent.launchOperationId
      && entry.windowId !== existingProduct?.windowId
    ));
    const bindingIdentityConflicts = pod.windows.some((entry) => (
      entry.bindingId === intent.bindingId
      && entry.windowId !== existingProduct?.windowId
    ));
    if (
      intent.programId !== input.expectedProgramId
      || intent.programId !== loaded.demand.programId
      || intent.hostId !== profile.hostId
      || intent.podId !== pod.podId
      || intent.demandId !== loaded.demand.demandId
      || intent.createdAt !== input.transition.createdAt
      || intent.responsibilityWindowId !== landing.responsibilityWindowId
      || intent.repositorySourceDigest !== sourceDigest
      || Object.hasOwn(config.indexes.windowById, intent.windowId)
      || (currentWindowIds.has(intent.windowId) && !currentProductWindowIds.has(intent.windowId))
      || launchIdentityConflicts
      || bindingIdentityConflicts
    ) {
      fail(
        "wakeflow-pod-service-product-authority",
        "product launch intent differs from exact program, host, Pod, landing, or config source authority",
        { repositoryId: intent.repositoryId, windowId: intent.windowId },
      );
    }
  }
}

function selectedLaunchTuples(state, podSource) {
  if (!podSource) {
    fail("wakeflow-pod-service-authority-damaged", "state-selected Pod local evidence root is missing");
  }
  return state.pod.windows.map((entry) => {
    const source = podSource.recordsByRef.get(entry.launchIntent.ref) ?? null;
    if (
      !source
      || source.record.kind !== WAKEFLOW_POD_LAUNCH_INTENT_KIND
      || source.digest !== entry.launchIntent.digest
    ) {
      fail(
        "wakeflow-pod-service-authority-damaged",
        "state-selected Pod member lacks its exact immutable launch intent",
        { windowId: entry.windowId },
      );
    }
    return source;
  });
}

function productPrefixClassification(podSource, state, desiredProducts) {
  if (!podSource || podSource.issues.length > 0) {
    fail("wakeflow-pod-service-evidence-conflict", "target Pod evidence is missing or structurally invalid");
  }
  const linkedRefs = new Set(state.pod.windows.map((entry) => entry.launchIntent.ref));
  const desiredByRef = new Map(desiredProducts.map((entry) => [entry.ref, entry]));
  for (const source of podSource.launchSources) {
    if (linkedRefs.has(source.ref)) continue;
    const desired = desiredByRef.get(source.ref);
    if (!desired || desired.digest !== source.digest || !same(desired.record, source.record)) {
      fail(
        "wakeflow-pod-service-evidence-conflict",
        "unlinked product launch evidence differs from the exact append plan",
        { ref: source.ref },
      );
    }
  }
  for (const desired of desiredProducts) {
    const present = podSource.recordsByRef.get(desired.ref) ?? null;
    if (present && (present.digest !== desired.digest || !same(present.record, desired.record))) {
      fail(
        "wakeflow-pod-service-evidence-conflict",
        "immutable product launch evidence has conflicting canonical bytes",
        { ref: desired.ref },
      );
    }
  }
  return desiredProducts.every((entry) => podSource.recordsByRef.has(entry.ref))
    ? "complete"
    : "prefix";
}

function buildProductAppendEvent(input, loaded, nextPod) {
  return validateControllerEventRecord({
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: input.transition.eventId,
    demandId: loaded.demand.demandId,
    createdAt: input.transition.createdAt,
    actor: "controller",
    command: "add-pod-members",
    type: "pod.members-added",
    previousRevision: loaded.state.revision,
    nextRevision: loaded.state.revision + 1,
    from: loaded.state.state,
    to: loaded.state.state,
    reason: input.transition.reason,
    decisionSummary: input.transition.decisionSummary,
    changedArtifacts: [],
    podTransition: {
      podId: nextPod.podId,
      action: "add-members",
      previousPodDigest: canonicalJsonDigest(loaded.state.pod),
      nextPodDigest: canonicalJsonDigest(nextPod),
    },
  });
}

function appendProductMembers(pod, launchIntents) {
  return frozen({
    ...pod,
    windows: [
      ...pod.windows,
      ...launchIntents.map((entry) => {
        const intent = tuple(entry);
        return {
          windowId: entry.windowId,
          role: "product",
          repositoryId: entry.repositoryId,
          launchOperationId: entry.launchOperationId,
          bindingId: entry.bindingId,
          launchIntent: { ref: intent.ref, digest: intent.digest },
          status: "planned",
          resourceClaimStatus: "reserved",
        };
      }),
    ].sort((left, right) => lexicalCompare(left.windowId, right.windowId)),
  });
}

function deriveProductPlanFromLoaded(input, config, loaded, profile) {
  assertMutablePodDemand(loaded, "Pod product append");
  const designAuthority = loadCurrentPodDesignAuthority(loaded, config, profile);
  const { pod, request, handoff } = designAuthority;
  validateProductIntentSet(input, config, loaded, profile, designAuthority);
  const inventory = scanPodInventory({
    workspaceRoot: input.workspaceRoot,
    expectedProgramId: input.expectedProgramId,
    hostId: profile.hostId,
  });
  const podSource = inventory.podById.get(pod.podId) ?? null;
  const publicPod = inventory.public.pods.find((entry) => entry.podId === pod.podId) ?? null;
  const products = input.launchIntents.map(tuple);
  const existingProducts = pod.windows.filter((entry) => entry.role === "product");
  const currentTuples = selectedLaunchTuples(loaded.state, podSource);
  assertExactStateEvidence(loaded.state, podSource, podSource.scopeSource, currentTuples, {
    allowedUnlinkedIntents: products,
  });
  const evidencePrefix = productPrefixClassification(podSource, loaded.state, products);
  let mode;
  let event;
  let nextState;
  if (existingProducts.length === 0) {
    if (
      pod.phase !== "creating-products"
      || pod.windows.some((entry) => entry.status !== "bound")
    ) {
      fail(
        "wakeflow-pod-service-product-gate",
        "first product append requires creating-products with every control member bound",
      );
    }
    const nextPod = appendProductMembers(pod, input.launchIntents);
    event = buildProductAppendEvent(input, loaded, nextPod);
    nextState = buildPodNextState(loaded, event, nextPod);
    mode = "append";
  } else {
    const intendedByRepository = new Map(input.launchIntents.map((entry) => [entry.repositoryId, entry]));
    if (
      pod.phase !== "creating-products"
      || existingProducts.length !== input.launchIntents.length
      || existingProducts.some((entry) => {
        const intended = intendedByRepository.get(entry.repositoryId);
        return !intended
          || entry.windowId !== intended.windowId
          || entry.launchOperationId !== intended.launchOperationId
          || entry.bindingId !== intended.bindingId
          || entry.launchIntent.ref !== podRecordRef(intended)
          || entry.launchIntent.digest !== podRecordDigest(intended)
          || entry.status !== "planned"
          || entry.resourceClaimStatus !== "reserved";
      })
      || evidencePrefix !== "complete"
    ) {
      fail(
        "wakeflow-pod-service-product-conflict",
        "product membership already exists but is not the exact immediate append result",
      );
    }
    const matches = loaded.events.filter((entry) => (
      entry.command === "add-pod-members"
      && entry.type === "pod.members-added"
      && entry.podTransition?.podId === pod.podId
      && entry.podTransition?.nextPodDigest === canonicalJsonDigest(pod)
    ));
    if (
      matches.length !== 1
      || matches[0].eventId !== input.transition.eventId
      || matches[0].createdAt !== input.transition.createdAt
      || matches[0].reason !== input.transition.reason
      || matches[0].decisionSummary !== input.transition.decisionSummary
    ) {
      fail(
        "wakeflow-pod-service-product-conflict",
        "current product set is bound to a different append event intent",
      );
    }
    [event] = matches;
    nextState = null;
    mode = "replay";
  }
  const requestIdentity = demandArtifactIdentity(request);
  const handoffIdentity = demandArtifactIdentity(handoff);
  const unsigned = {
    kind: PRODUCT_APPEND_PLAN_KIND,
    schemaVersion: SCHEMA_VERSION,
    mode,
    workspaceRoot: input.workspaceRoot,
    stateRoot: input.stateRoot,
    programId: input.expectedProgramId,
    demandId: loaded.demand.demandId,
    hostId: profile.hostId,
    podId: pod.podId,
    config: { ref: config.ref, digest: config.configDigest },
    demandAuthority: { ref: "demand-authority.json", digest: loaded.digests.authority },
    designRequest: requestIdentity,
    designHandoff: handoffIdentity,
    sourceState: loaded.state,
    sourceStateDigest: loaded.digests.state,
    evidenceInventoryDigest: canonicalJsonDigest({
      programId: input.expectedProgramId,
      hostId: profile.hostId,
      podId: pod.podId,
      pod: publicPod,
    }),
    evidencePrefix,
    launchIntents: products,
    transition: input.transition,
    event,
    nextState,
  };
  return deepFreeze({ ...unsigned, planDigest: canonicalJsonDigest(unsigned) });
}

function deriveProductPlanWhileLocked(input, config, profile) {
  return deriveProductPlanFromLoaded(input, config, loadLocked(input, config), profile);
}

// 在Design handoff之后冻结全部Product launch intent及Pod成员扩展，不直接创建worktree或窗口。
export function planPodProductLaunchAppend(value = {}) {
  const input = normalizeProductPlanInput(value);
  const config = loadConfig(input);
  const profile = currentPodProfile();
  return withStateRootLock(input.stateRoot, () => (
    deriveProductPlanWhileLocked(input, config, profile)
  ));
}

function productRequestFromPlan(plan) {
  return frozen({
    workspaceRoot: plan.workspaceRoot,
    stateRoot: plan.stateRoot,
    expectedProgramId: plan.programId,
    launchIntents: plan.launchIntents.map((entry) => entry.record),
    transition: plan.transition,
  });
}

function classifyProductEvidence(input, plan, state) {
  const inventory = scanPodInventory({
    workspaceRoot: input.workspaceRoot,
    expectedProgramId: input.expectedProgramId,
    hostId: plan.hostId,
  });
  const podSource = inventory.podById.get(plan.podId) ?? null;
  const currentTuples = selectedLaunchTuples(state, podSource);
  assertExactStateEvidence(state, podSource, podSource.scopeSource, currentTuples, {
    allowedUnlinkedIntents: plan.launchIntents,
  });
  return {
    inventory,
    classification: productPrefixClassification(
      podSource,
      state,
      plan.launchIntents,
    ),
  };
}

function recoverExactProductJournal(input, config, plan) {
  if (plan.mode !== "append") return Object.freeze({ status: "none" });
  return recoverDemandPodTransitionWhileLocked({
    stateRoot: input.stateRoot,
    expectedProgramId: input.expectedProgramId,
    ledgerRoot: config.ledgerRoot,
    admitRecoveryWhileLocked: ({ journal }) => {
      const evidence = classifyProductEvidence(input, plan, plan.sourceState);
      if (
        journal.artifactWrites.length !== 0
        || !same(journal.nextEvent, plan.event)
        || !same(journal.nextState, plan.nextState)
        || journal.expectedPreviousRevision !== plan.sourceState.revision
        || journal.expectedPreviousStateDigest !== plan.sourceStateDigest
        || evidence.classification !== "complete"
      ) {
        fail(
          "wakeflow-pod-service-recovery-required",
          "pending product append journal is not the exact complete planned transaction",
        );
      }
      return { admitted: true };
    },
  });
}

function productResultFromLoaded(status, loaded, plan) {
  return frozen({
    status,
    programId: plan.programId,
    demandId: plan.demandId,
    hostId: plan.hostId,
    podId: plan.podId,
    designHandoff: plan.designHandoff,
    launchIntents: plan.launchIntents.map((entry) => ({
      windowId: entry.record.windowId,
      repositoryId: entry.record.repositoryId,
      launchOperationId: entry.record.launchOperationId,
      ref: entry.ref,
      digest: entry.digest,
    })),
    revision: loaded.state.revision,
    stateDigest: loaded.digests.state,
  });
}

function verifyProductFailureClosure(input, tracker) {
  if (!tracker.plan) {
    fail("wakeflow-pod-service-recovery-required", "product append failure has no exact admitted plan");
  }
  return withStateRootLock(input.stateRoot, () => {
    const config = loadConfig(input);
    if (config.configDigest !== tracker.plan.config.digest) {
      fail("wakeflow-pod-service-recovery-required", "product append failure changed config authority");
    }
    recoverExactProductJournal(input, config, tracker.plan);
    const loaded = loadLocked(input, config);
    let position;
    let state;
    if (loaded.digests.state === tracker.plan.sourceStateDigest) {
      position = classifyProductEvidence(input, tracker.plan, tracker.plan.sourceState);
      state = "previous";
    } else if (
      tracker.plan.mode === "append"
      && loaded.digests.state === canonicalJsonDigest(tracker.plan.nextState)
    ) {
      position = classifyProductEvidence(input, tracker.plan, tracker.plan.nextState);
      if (position.classification !== "complete") {
        fail("wakeflow-pod-service-recovery-required", "committed product state lacks complete intent evidence");
      }
      state = "committed";
    } else {
      fail(
        "wakeflow-pod-service-recovery-required",
        "product append failure is neither exact previous nor exact committed authority",
      );
    }
    return safeReleaseVerdict({
      operation: "pod-product-launch-append",
      state,
      evidence: position.classification,
      configDigest: config.configDigest,
      stateDigest: loaded.digests.state,
      inventoryDigest: position.inventory.public.inventoryDigest,
      journal: "absent",
    }, "pod-product-launch-append-closure");
  });
}

function applyProductWhileLocked(input, config, profile, mutationContext, tracker) {
  assertWakeflowMutationContext({
    workspaceRoot: input.workspaceRoot,
    context: mutationContext,
    mode: "runtime-mutation",
  });
  tracker.plan = input.plan;
  const currentConfig = loadConfig(input);
  if (
    currentConfig.configDigest !== config.configDigest
    || currentConfig.configDigest !== input.plan.config.digest
  ) {
    fail("wakeflow-pod-service-stale-plan", "product append config authority changed");
  }
  const recovered = recoverExactProductJournal(input, currentConfig, input.plan);
  if (recovered.status === "recovered") {
    const loaded = loadLocked(input, currentConfig);
    const evidence = classifyProductEvidence(input, input.plan, input.plan.nextState);
    if (
      loaded.digests.state !== canonicalJsonDigest(input.plan.nextState)
      || evidence.classification !== "complete"
    ) {
      fail("wakeflow-pod-service-recovery-required", "recovered product append did not close exact authority");
    }
    return productResultFromLoaded("recovered", loaded, input.plan);
  }
  const currentPlan = deriveProductPlanWhileLocked(
    productRequestFromPlan(input.plan),
    currentConfig,
    profile,
  );
  if (!same(currentPlan, input.plan)) {
    fail("wakeflow-pod-service-stale-plan", "Pod product launch append plan is stale");
  }
  if (input.plan.mode === "replay") {
    return productResultFromLoaded("replayed", loadLocked(input, currentConfig), input.plan);
  }
  for (const intent of input.plan.launchIntents) ensureImmutableRecord(input.workspaceRoot, intent);
  const complete = classifyProductEvidence(input, input.plan, input.plan.sourceState);
  if (complete.classification !== "complete") {
    fail("wakeflow-pod-service-evidence-closure", "product launch intent evidence did not close");
  }
  commitDemandPodTransitionWhileLocked({
    stateRoot: input.stateRoot,
    expectedProgramId: input.expectedProgramId,
    ledgerRoot: currentConfig.ledgerRoot,
    expectedPrevious: {
      revision: input.plan.sourceState.revision,
      stateDigest: input.plan.sourceStateDigest,
    },
    event: input.plan.event,
    nextState: input.plan.nextState,
  });
  const loaded = loadLocked(input, currentConfig);
  const closed = classifyProductEvidence(input, input.plan, input.plan.nextState);
  if (
    loaded.digests.state !== canonicalJsonDigest(input.plan.nextState)
    || closed.classification !== "complete"
  ) {
    fail("wakeflow-pod-service-authority-closure", "product append did not close exact state and evidence authority");
  }
  return productResultFromLoaded("appended", loaded, input.plan);
}

// 先发布Product launch evidence，再提交精确state delta；失败只允许停留在可识别事务前缀。
export async function applyPodProductLaunchAppendPlan(value = {}) {
  const input = normalizeProductApplyInput(value);
  const config = loadConfig(input);
  if (config.configDigest !== input.plan.config.digest) {
    fail("wakeflow-pod-service-stale-plan", "product append plan no longer matches config authority");
  }
  const profile = currentPodProfile();
  const tracker = { plan: null };
  try {
    return await withWakeflowRuntimeMutation({
      workspaceRoot: input.workspaceRoot,
      operationKind: "pod-product-launch-append",
      domainOwner: "core-pod-service",
      ...(input.acquireTimeoutMs === undefined ? {} : { acquireTimeoutMs: input.acquireTimeoutMs }),
      onCallbackFailure: () => verifyProductFailureClosure(input, tracker),
    }, (mutationContext) => withStateRootLock(input.stateRoot, () => (
      applyProductWhileLocked(input, config, profile, mutationContext, tracker)
    )));
  } catch (cause) {
    boundary("product-apply", cause, "Pod product launch append failed closed");
  }
}

function normalizeTestAccessPlanInput(input) {
  exactKeys(input, [
    "workspaceRoot",
    "stateRoot",
    "expectedProgramId",
    "probeId",
    "expectedPrevious",
    "transition",
  ], ["acquireTimeoutMs"], "Pod Test access plan input");
  return frozen({
    workspaceRoot: rootPath(input.workspaceRoot, "workspaceRoot"),
    stateRoot: rootPath(input.stateRoot, "stateRoot"),
    expectedProgramId: typedId(input.expectedProgramId, "program", "expectedProgramId"),
    probeId: materializationDomainId(input.probeId, POD_TEST_PROBE_ID_RE, "probeId"),
    expectedPrevious: normalizeExpectedPrevious(input.expectedPrevious),
    transition: normalizeTransition(input.transition),
    acquireTimeoutMs: timeout(input.acquireTimeoutMs),
  });
}

function normalizeTestAccessInspectInput(input, label) {
  exactKeys(input, ["workspaceRoot", "stateRoot", "expectedProgramId"], [], label);
  return frozen({
    workspaceRoot: rootPath(input.workspaceRoot, "workspaceRoot"),
    stateRoot: rootPath(input.stateRoot, "stateRoot"),
    expectedProgramId: typedId(input.expectedProgramId, "program", "expectedProgramId"),
  });
}

function normalizeTestAccessObserveInput(input) {
  exactKeys(input, [
    "workspaceRoot",
    "stateRoot",
    "expectedProgramId",
    "probeId",
    "expectedPlanDigest",
    "observedAt",
  ], [], "Pod Test access observation input");
  const observedAt = token(input.observedAt, "observedAt");
  if (!Number.isFinite(Date.parse(observedAt))) {
    fail("wakeflow-pod-service-contract", "observedAt must be one ISO timestamp");
  }
  return frozen({
    workspaceRoot: rootPath(input.workspaceRoot, "workspaceRoot"),
    stateRoot: rootPath(input.stateRoot, "stateRoot"),
    expectedProgramId: typedId(input.expectedProgramId, "program", "expectedProgramId"),
    probeId: materializationDomainId(input.probeId, POD_TEST_PROBE_ID_RE, "probeId"),
    expectedPlanDigest: digest(input.expectedPlanDigest, "expectedPlanDigest"),
    observedAt,
  });
}

function normalizeTestTargetObservation(value, index) {
  const label = `observation.targetObservations[${index}]`;
  const required = [
    "windowId",
    "repositoryId",
    "bindingId",
    "creationReceiptDigest",
    "accessResult",
  ];
  const observations = [
    "observedRootDigest",
    "observedGitTopLevelDigest",
    "observedGitCommonDirDigest",
    "currentHead",
  ];
  exactKeys(value, required, observations, label);
  const accessResult = token(value.accessResult, `${label}.accessResult`);
  exactKeys(value, required, accessResult === "readable" ? observations : [], label);
  const normalized = {
    windowId: typedId(value.windowId, "window", `${label}.windowId`),
    repositoryId: typedId(value.repositoryId, "repository", `${label}.repositoryId`),
    bindingId: normalizeExpectedBindingId(value.bindingId),
    creationReceiptDigest: digest(value.creationReceiptDigest, `${label}.creationReceiptDigest`),
    accessResult,
  };
  if (accessResult === "readable") {
    normalized.observedRootDigest = digest(value.observedRootDigest, `${label}.observedRootDigest`);
    normalized.observedGitTopLevelDigest = digest(
      value.observedGitTopLevelDigest,
      `${label}.observedGitTopLevelDigest`,
    );
    normalized.observedGitCommonDirDigest = digest(
      value.observedGitCommonDirDigest,
      `${label}.observedGitCommonDirDigest`,
    );
    normalized.currentHead = token(value.currentHead, `${label}.currentHead`);
  } else if (accessResult !== "unreadable") {
    fail("wakeflow-pod-service-contract", `${label}.accessResult is unsupported`);
  }
  return frozen(normalized);
}

function normalizeTestAccessObservation(value) {
  if (!plainObject(value)) {
    fail("wakeflow-pod-service-contract", "observation must be one plain data object");
  }
  exactKeys(value, [
    "kind",
    "schemaVersion",
    "programId",
    "hostId",
    "podId",
    "demandId",
    "probeId",
    "planDigest",
    "bindingSetDigest",
    "observerBindingId",
    "observerIdentityBindingDigest",
    "targetObservations",
    "observedAt",
  ], ["failureCode"], "Pod Test access observation");
  value = canonicalSnapshot(value, "Pod Test access observation");
  if (value.kind !== "WakeflowPodTestAccessObservation" || value.schemaVersion !== 1) {
    fail("wakeflow-pod-service-contract", "observation kind or schemaVersion is unsupported");
  }
  if (!Array.isArray(value.targetObservations)) {
    fail("wakeflow-pod-service-contract", "observation.targetObservations must be one array");
  }
  const targetObservations = value.targetObservations.map(normalizeTestTargetObservation);
  const keys = targetObservations.map((entry) => `${entry.repositoryId}\u0000${entry.windowId}`);
  if (
    new Set(keys).size !== keys.length
    || keys.some((entry, index) => index > 0 && lexicalCompare(keys[index - 1], entry) >= 0)
  ) {
    fail(
      "wakeflow-pod-service-contract",
      "observation.targetObservations must use unique canonical repository/window order",
    );
  }
  const observedAt = token(value.observedAt, "observation.observedAt");
  if (!Number.isFinite(Date.parse(observedAt))) {
    fail("wakeflow-pod-service-contract", "observation.observedAt must be one ISO timestamp");
  }
  const failureCode = Object.hasOwn(value, "failureCode")
    ? token(value.failureCode, "observation.failureCode")
    : null;
  if (failureCode !== null && !POD_TEST_BLOCK_REASON_SET.has(failureCode)) {
    fail("wakeflow-pod-service-contract", "observation.failureCode is unsupported");
  }
  return frozen({
    kind: value.kind,
    schemaVersion: value.schemaVersion,
    programId: typedId(value.programId, "program", "observation.programId"),
    hostId: token(value.hostId, "observation.hostId"),
    podId: typedId(value.podId, "pod", "observation.podId"),
    demandId: typedId(value.demandId, "demand", "observation.demandId"),
    probeId: materializationDomainId(
      value.probeId,
      POD_TEST_PROBE_ID_RE,
      "observation.probeId",
    ),
    planDigest: digest(value.planDigest, "observation.planDigest"),
    bindingSetDigest: digest(value.bindingSetDigest, "observation.bindingSetDigest"),
    observerBindingId: normalizeExpectedBindingId(value.observerBindingId),
    observerIdentityBindingDigest: digest(
      value.observerIdentityBindingDigest,
      "observation.observerIdentityBindingDigest",
    ),
    targetObservations,
    observedAt,
    ...(failureCode === null ? {} : { failureCode }),
  });
}

function normalizeTestAccessReceiptInput(input) {
  exactKeys(input, [
    "workspaceRoot",
    "stateRoot",
    "expectedProgramId",
    "probeId",
    "expectedPrevious",
    "observation",
    "transition",
  ], ["acquireTimeoutMs"], "Pod Test access receipt input");
  const observation = normalizeTestAccessObservation(input.observation);
  const transition = normalizeTransition(input.transition);
  if (Date.parse(transition.createdAt) < Date.parse(observation.observedAt)) {
    fail("wakeflow-pod-service-time", "Test access receipt cannot be recorded before observation");
  }
  return frozen({
    workspaceRoot: rootPath(input.workspaceRoot, "workspaceRoot"),
    stateRoot: rootPath(input.stateRoot, "stateRoot"),
    expectedProgramId: typedId(input.expectedProgramId, "program", "expectedProgramId"),
    probeId: materializationDomainId(input.probeId, POD_TEST_PROBE_ID_RE, "probeId"),
    expectedPrevious: normalizeExpectedPrevious(input.expectedPrevious),
    observation,
    transition,
    acquireTimeoutMs: timeout(input.acquireTimeoutMs),
  });
}

function normalizeExpectedBindingId(value) {
  if (typeof value !== "string" || !/^binding_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)) {
    fail("wakeflow-pod-service-contract", "bindingId must be one typed binding identity");
  }
  return value;
}

function testAccessAuthorityFromLoaded(input, config, profile, loaded) {
  if (!loaded.state.pod) {
    fail("wakeflow-pod-service-test-authority", "current demand has no Pod authority");
  }
  const testMembers = loaded.state.pod.windows.filter((entry) => entry.role === "test");
  if (testMembers.length !== 1) {
    fail("wakeflow-pod-service-test-authority", "current Pod requires exactly one Test member");
  }
  return materializationAuthorityFromLoaded(
    { ...input, windowId: testMembers[0].windowId },
    config,
    profile,
    loaded,
  );
}

function loadTestAccessAuthorityWhileLocked(input, config, profile) {
  return testAccessAuthorityFromLoaded(input, config, profile, loadLocked(input, config));
}

function testAccessPathDigest(kind, value) {
  return canonicalJsonDigest({ kind: `wakeflow-pod-test-access-${kind}`, value });
}

function creationSourceForMember(authority, member) {
  const source = authority.podSource.recordsByRef.get(member.creationReceipt?.ref) ?? null;
  if (
    !source
    || source.record.kind !== WAKEFLOW_POD_CREATION_RECEIPT_KIND
    || source.digest !== member.creationReceipt?.digest
    || source.record.windowId !== member.windowId
    || source.record.bindingId !== member.bindingId
    || source.record.identityBindingDigest !== member.identityBindingDigest
  ) {
    fail(
      "wakeflow-pod-service-test-authority",
      "Pod Test access member lacks its exact state-selected creation receipt",
      { windowId: member.windowId },
    );
  }
  return source;
}

function currentTestAccessBindingSet(authority, workspaceRoot) {
  const pod = authority.loaded.state.pod;
  const observerMember = pod.windows.find((entry) => entry.role === "test") ?? null;
  const targetMembers = pod.windows
    .filter((entry) => entry.role === "product")
    .sort((left, right) => (
      lexicalCompare(left.repositoryId, right.repositoryId)
      || lexicalCompare(left.windowId, right.windowId)
    ));
  if (
    pod.windows.some((entry) => entry.status !== "bound")
    || !observerMember
    || targetMembers.length === 0
    || !pod.designHandoff
    || !authority.identityInventory
  ) {
    fail(
      "wakeflow-pod-service-test-authority",
      "Test access requires one fully bound post-Design Pod surface",
    );
  }
  const identityByWindow = new Map(
    authority.identityInventory.bindings.map((entry) => [entry.windowId, entry]),
  );
  const observerIdentity = identityByWindow.get(observerMember.windowId) ?? null;
  const observerReceipt = creationSourceForMember(authority, observerMember);
  let expectedProgramRoot;
  try {
    expectedProgramRoot = fs.realpathSync.native(workspaceRoot);
  } catch (cause) {
    boundary("test-access-root", cause, "program root cannot be resolved for Test access");
  }
  if (
    !observerIdentity
    || observerIdentity.bindingId !== observerMember.bindingId
    || observerIdentity.identityBindingDigest !== observerMember.identityBindingDigest
    || observerReceipt.record.resource.kind !== "program-root"
    || inspectActualDirectory(observerReceipt.record.resource.actualCwd) !== expectedProgramRoot
  ) {
    fail("wakeflow-pod-service-test-authority", "Test observer identity or creation receipt is stale");
  }
  const targets = targetMembers.map((member) => {
    const identity = identityByWindow.get(member.windowId) ?? null;
    const receipt = creationSourceForMember(authority, member);
    if (
      !identity
      || identity.bindingId !== member.bindingId
      || identity.identityBindingDigest !== member.identityBindingDigest
      || receipt.record.resource.kind !== "git-worktree"
    ) {
      fail(
        "wakeflow-pod-service-test-authority",
        "Test target identity or creation receipt is stale",
        { windowId: member.windowId },
      );
    }
    const actualRoot = inspectActualDirectory(receipt.record.resource.actualCwd);
    const gitTopLevel = canonicalGitPath(
      actualRoot,
      ["rev-parse", "--show-toplevel"],
      "Test target Git top-level",
    );
    const gitCommonDir = canonicalGitPath(
      actualRoot,
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      "Test target Git common directory",
    );
    if (
      actualRoot !== receipt.record.resource.actualCwd
      || gitTopLevel !== receipt.record.resource.gitTopLevel
      || gitCommonDir !== receipt.record.resource.gitCommonDir
    ) {
      fail(
        "wakeflow-pod-service-test-authority",
        "Test target current root or Git identity differs from its creation receipt",
        { windowId: member.windowId },
      );
    }
    return {
      windowId: member.windowId,
      repositoryId: member.repositoryId,
      bindingId: member.bindingId,
      identityBindingDigest: member.identityBindingDigest,
      creationReceiptDigest: receipt.digest,
      actualRoot,
      expectedRootDigest: testAccessPathDigest("root", actualRoot),
      expectedGitTopLevelDigest: testAccessPathDigest("git-top-level", gitTopLevel),
      expectedGitCommonDirDigest: testAccessPathDigest("git-common-dir", gitCommonDir),
    };
  });
  const bindingSet = {
    observer: {
      windowId: observerMember.windowId,
      bindingId: observerMember.bindingId,
      identityBindingDigest: observerMember.identityBindingDigest,
      creationReceiptDigest: observerReceipt.digest,
    },
    targets,
  };
  return frozen({
    ...bindingSet,
    bindingSetDigest: podTestAccessBindingSetDigest(bindingSet),
  });
}

function testAccessPlanRef(authority, probeId) {
  return `${authority.podSource.rootRef}/test-access/${probeId}/plan.json`;
}

function testAccessReceiptRef(authority, probeId) {
  return `${authority.podSource.rootRef}/test-access/${probeId}/receipt.json`;
}

function testAccessSource(authority, probeId, kind, { required = true } = {}) {
  const ref = kind === WAKEFLOW_POD_TEST_ACCESS_PLAN_KIND
    ? testAccessPlanRef(authority, probeId)
    : testAccessReceiptRef(authority, probeId);
  const source = authority.podSource.recordsByRef.get(ref) ?? null;
  if (source === null) {
    if (required) {
      fail(
        "wakeflow-pod-service-test-authority",
        `state-selected Test access ${kind === WAKEFLOW_POD_TEST_ACCESS_PLAN_KIND ? "plan" : "receipt"} is missing`,
        { probeId },
      );
    }
    return null;
  }
  if (source.record.kind !== kind) {
    fail("wakeflow-pod-service-test-authority", "Test access evidence kind differs from its canonical ref", {
      probeId,
    });
  }
  return source;
}

function assertTestPlanMatchesCurrent(plan, authority, bindingSet, access = null) {
  const expectedPreviousProbeId = access?.attempt > 1 ? access.previousProbeId : undefined;
  if (
    plan.programId !== authority.loaded.demand.programId
    || plan.hostId !== authority.loaded.state.pod.hostId
    || plan.podId !== authority.loaded.state.pod.podId
    || plan.demandId !== authority.loaded.demand.demandId
    || plan.probeId !== (access?.probeId ?? plan.probeId)
    || plan.bindingSetDigest !== bindingSet.bindingSetDigest
    || !same(plan.observer, bindingSet.observer)
    || !same(plan.targets, bindingSet.targets)
    || (access !== null && plan.attempt !== access.attempt)
    || (access !== null && plan.createdAt !== access.plannedAt)
    || (expectedPreviousProbeId === undefined) !== !Object.hasOwn(plan, "previousProbeId")
    || (expectedPreviousProbeId !== undefined && plan.previousProbeId !== expectedPreviousProbeId)
  ) {
    fail(
      "wakeflow-pod-service-test-authority",
      "Test access plan differs from current Pod membership, identity, creation, or state authority",
      { probeId: plan.probeId },
    );
  }
}

function classifyTestObservation(plan, observation) {
  if (
    observation.programId !== plan.programId
    || observation.hostId !== plan.hostId
    || observation.podId !== plan.podId
    || observation.demandId !== plan.demandId
    || observation.probeId !== plan.probeId
    || observation.planDigest !== podRecordDigest(plan)
    || observation.bindingSetDigest !== plan.bindingSetDigest
  ) {
    fail("wakeflow-pod-service-test-observation", "Test access observation differs from its exact plan identity");
  }
  if (Date.parse(observation.observedAt) < Date.parse(plan.createdAt)) {
    fail("wakeflow-pod-service-test-time", "Test access observation cannot precede its plan");
  }
  const observerMismatch = (
    observation.observerBindingId !== plan.observer.bindingId
    || observation.observerIdentityBindingDigest !== plan.observer.identityBindingDigest
  );
  const targetByKey = new Map(plan.targets.map((entry) => [
    `${entry.repositoryId}\u0000${entry.windowId}`,
    entry,
  ]));
  let unreadable = false;
  let gitMismatch = false;
  const seen = new Set();
  for (const observed of observation.targetObservations) {
    const key = `${observed.repositoryId}\u0000${observed.windowId}`;
    const target = targetByKey.get(key) ?? null;
    if (
      !target
      || seen.has(key)
      || observed.bindingId !== target.bindingId
      || observed.creationReceiptDigest !== target.creationReceiptDigest
    ) {
      fail(
        "wakeflow-pod-service-test-observation",
        "Test access observation contains a duplicate, unknown, or stale target",
      );
    }
    seen.add(key);
    if (observed.accessResult === "unreadable") {
      unreadable = true;
      continue;
    }
    if (
      observed.observedRootDigest !== target.expectedRootDigest
      || observed.observedGitTopLevelDigest !== target.expectedGitTopLevelDigest
      || observed.observedGitCommonDirDigest !== target.expectedGitCommonDirDigest
    ) gitMismatch = true;
  }
  const missingTargets = seen.size !== plan.targets.length;
  let reasonCode = null;
  if (observerMismatch) {
    reasonCode = "observer-identity-mismatch";
  } else if (Object.hasOwn(observation, "failureCode")) {
    reasonCode = observation.failureCode;
    if (
      (reasonCode === "observer-identity-mismatch" && !observerMismatch)
      || (reasonCode === "root-unreadable" && !unreadable)
      || (reasonCode === "git-identity-mismatch" && !gitMismatch)
    ) {
      fail(
        "wakeflow-pod-service-test-observation",
        "Test access failureCode is not supported by its structured observations",
      );
    }
  } else if (unreadable) {
    reasonCode = "root-unreadable";
  } else if (gitMismatch) {
    reasonCode = "git-identity-mismatch";
  } else if (missingTargets) {
    fail(
      "wakeflow-pod-service-test-observation",
      "a successful Test access observation must cover every exact product target",
    );
  }
  return frozen({
    status: reasonCode === null ? "validated" : "blocked",
    ...(reasonCode === null ? {} : { reasonCode }),
  });
}

function receiptObservation(receipt) {
  return frozen({
    kind: "WakeflowPodTestAccessObservation",
    schemaVersion: 1,
    programId: receipt.programId,
    hostId: receipt.hostId,
    podId: receipt.podId,
    demandId: receipt.demandId,
    probeId: receipt.probeId,
    planDigest: receipt.planDigest,
    bindingSetDigest: receipt.bindingSetDigest,
    observerBindingId: receipt.observerBindingId,
    observerIdentityBindingDigest: receipt.observerIdentityBindingDigest,
    targetObservations: receipt.targetObservations,
    observedAt: receipt.observedAt,
    ...(receipt.status === "blocked" ? { failureCode: receipt.reasonCode } : {}),
  });
}

function assertReceiptMatchesPlan(receipt, plan) {
  const classification = classifyTestObservation(plan, receiptObservation(receipt));
  if (
    receipt.status !== classification.status
    || receipt.capability !== "direct-multi-root"
    || (classification.status === "blocked" && receipt.reasonCode !== classification.reasonCode)
    || (classification.status === "validated" && Object.hasOwn(receipt, "reasonCode"))
    || Date.parse(receipt.recordedAt) < Date.parse(receipt.observedAt)
  ) {
    fail("wakeflow-pod-service-test-authority", "Test access receipt differs from its derived plan outcome");
  }
  return classification;
}

function testAccessLineage(authority, currentAccess, {
  allowCurrentReceipt = false,
  allowedExtraRefs = [],
} = {}) {
  const allowedRefs = new Set(allowedExtraRefs);
  if (currentAccess === null) {
    const extras = authority.podSource.records.filter((source) => (
      [WAKEFLOW_POD_TEST_ACCESS_PLAN_KIND, WAKEFLOW_POD_TEST_ACCESS_RECEIPT_KIND]
        .includes(source.record.kind)
      && !allowedRefs.has(source.ref)
    ));
    if (extras.length > 0) {
      fail("wakeflow-pod-service-test-orphan", "unlinked Test access evidence blocks a new probe");
    }
    return frozen({ planSource: null, receiptSource: null, historicalProbeIds: [] });
  }
  let probeId = currentAccess.probeId;
  let current = true;
  let planSource = null;
  let receiptSource = null;
  const historicalProbeIds = [];
  const seen = new Set();
  let expectedAttempt = currentAccess.attempt;
  while (probeId !== undefined) {
    if (seen.has(probeId)) {
      fail("wakeflow-pod-service-test-lineage", "Test access retry lineage contains a cycle");
    }
    seen.add(probeId);
    const plan = testAccessSource(authority, probeId, WAKEFLOW_POD_TEST_ACCESS_PLAN_KIND);
    if (
      plan.record.programId !== authority.loaded.demand.programId
      || plan.record.hostId !== authority.loaded.state.pod.hostId
      || plan.record.podId !== authority.loaded.state.pod.podId
      || plan.record.demandId !== authority.loaded.demand.demandId
      || plan.record.attempt !== expectedAttempt
      || plan.record.bindingSetDigest !== currentAccess.bindingSetDigest
      || (expectedAttempt === 1) !== !Object.hasOwn(plan.record, "previousProbeId")
    ) {
      fail("wakeflow-pod-service-test-lineage", "Test access retry lineage is not one exact descending attempt chain");
    }
    allowedRefs.add(plan.ref);
    const receipt = testAccessSource(
      authority,
      probeId,
      WAKEFLOW_POD_TEST_ACCESS_RECEIPT_KIND,
      { required: !current || currentAccess.status !== "pending" },
    );
    if (receipt !== null) {
      allowedRefs.add(receipt.ref);
      assertReceiptMatchesPlan(receipt.record, plan.record);
      if (!current && receipt.record.status !== "blocked") {
        fail("wakeflow-pod-service-test-lineage", "only a blocked Test access attempt may have a successor");
      }
    }
    if (current) {
      planSource = plan;
      receiptSource = receipt;
      if (currentAccess.status === "pending" && receipt !== null && !allowCurrentReceipt) {
        fail("wakeflow-pod-service-test-orphan", "pending Test access has an uncommitted receipt prefix");
      }
    } else {
      historicalProbeIds.push(probeId);
    }
    probeId = plan.record.previousProbeId;
    expectedAttempt -= 1;
    current = false;
  }
  if (expectedAttempt !== 0) {
    fail("wakeflow-pod-service-test-lineage", "Test access retry lineage does not terminate at attempt one");
  }
  const extras = authority.podSource.records.filter((source) => (
    [WAKEFLOW_POD_TEST_ACCESS_PLAN_KIND, WAKEFLOW_POD_TEST_ACCESS_RECEIPT_KIND]
      .includes(source.record.kind)
    && !allowedRefs.has(source.ref)
  ));
  if (extras.length > 0) {
    fail("wakeflow-pod-service-test-orphan", "orphan Test access evidence differs from current retry lineage");
  }
  return frozen({ planSource, receiptSource, historicalProbeIds });
}

function currentTestAccessClosure(input, authority, {
  allowCurrentReceipt = false,
  allowedExtraRefs = [],
} = {}) {
  const access = authority.loaded.state.pod.testAccess ?? null;
  const bindingSet = currentTestAccessBindingSet(authority, input.workspaceRoot);
  const lineage = testAccessLineage(authority, access, {
    allowCurrentReceipt,
    allowedExtraRefs,
  });
  if (access === null) return { access, bindingSet, ...lineage };
  if (
    lineage.planSource.ref !== access.plan.ref
    || lineage.planSource.digest !== access.plan.digest
  ) {
    fail("wakeflow-pod-service-test-authority", "state Test access plan selector differs from immutable evidence");
  }
  assertTestPlanMatchesCurrent(lineage.planSource.record, authority, bindingSet, access);
  if (access.status === "pending") {
    if (Object.hasOwn(access, "receipt")) {
      fail("wakeflow-pod-service-test-authority", "pending Test access cannot select a receipt");
    }
  } else if (
    !lineage.receiptSource
    || lineage.receiptSource.ref !== access.receipt.ref
    || lineage.receiptSource.digest !== access.receipt.digest
    || lineage.receiptSource.record.status !== access.status
    || lineage.receiptSource.record.observedAt !== access.observedAt
    || lineage.receiptSource.record.recordedAt !== access.recordedAt
    || (access.status === "validated"
      ? access.capability !== "direct-multi-root"
      : access.reasonCode !== lineage.receiptSource.record.reasonCode)
  ) {
    fail("wakeflow-pod-service-test-authority", "state Test access outcome differs from immutable receipt");
  }
  return { access, bindingSet, ...lineage };
}

function buildTestAccessPlan(input, authority, bindingSet) {
  const previous = authority.loaded.state.pod.testAccess ?? null;
  if (previous !== null && previous.status !== "blocked") {
    fail("wakeflow-pod-service-test-state", "pending or validated Test access cannot be replaced");
  }
  if (
    (previous === null && authority.loaded.state.pod.phase !== "execution-ready")
    || (previous !== null && authority.loaded.state.pod.phase !== "blocked")
  ) {
    fail("wakeflow-pod-service-test-state", "Pod phase does not admit this Test access plan");
  }
  if (Date.parse(input.transition.createdAt) < Date.parse(authority.loaded.state.updatedAt)) {
    fail("wakeflow-pod-service-test-time", "Test access plan cannot precede current state authority");
  }
  if (previous !== null && previous.probeId === input.probeId) {
    fail("wakeflow-pod-service-test-retry", "blocked Test access retry requires a fresh probeId");
  }
  const attempt = previous === null ? 1 : previous.attempt + 1;
  if (attempt > 32) {
    fail("wakeflow-pod-service-test-retry", "Test access retry exceeds the bounded attempt count");
  }
  return createPodTestAccessPlanRecord({
    kind: WAKEFLOW_POD_TEST_ACCESS_PLAN_KIND,
    schemaVersion: 1,
    programId: authority.loaded.demand.programId,
    hostId: authority.loaded.state.pod.hostId,
    podId: authority.loaded.state.pod.podId,
    demandId: authority.loaded.demand.demandId,
    probeId: input.probeId,
    attempt,
    ...(previous === null ? {} : { previousProbeId: previous.probeId }),
    probeType: "direct-multi-root",
    bindingSetDigest: bindingSet.bindingSetDigest,
    observer: bindingSet.observer,
    targets: bindingSet.targets,
    createdAt: input.transition.createdAt,
  });
}

function buildTestAccessPlanTransition(input, authority, planSource) {
  const previousPod = authority.loaded.state.pod;
  const retry = previousPod.testAccess?.status === "blocked";
  const nextPod = structuredClone(previousPod);
  nextPod.phase = retry ? "retryable" : "execution-ready";
  nextPod.testAccess = {
    probeId: planSource.record.probeId,
    attempt: planSource.record.attempt,
    status: "pending",
    bindingSetDigest: planSource.record.bindingSetDigest,
    productBindingCount: planSource.record.targets.length,
    plan: { ref: planSource.ref, digest: planSource.digest },
    plannedAt: planSource.record.createdAt,
    ...(retry ? { previousProbeId: planSource.record.previousProbeId } : {}),
  };
  const event = validateControllerEventRecord({
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: input.transition.eventId,
    demandId: authority.loaded.demand.demandId,
    createdAt: input.transition.createdAt,
    actor: "controller",
    command: retry ? "retry-pod-test-access" : "plan-pod-test-access",
    type: retry ? "pod.test-access-retry-planned" : "pod.test-access-planned",
    previousRevision: authority.loaded.state.revision,
    nextRevision: authority.loaded.state.revision + 1,
    from: authority.loaded.state.state,
    to: authority.loaded.state.state,
    reason: input.transition.reason,
    decisionSummary: input.transition.decisionSummary,
    changedArtifacts: [],
    podTransition: {
      podId: nextPod.podId,
      action: retry ? "retry-test-access" : "plan-test-access",
      previousPodDigest: canonicalJsonDigest(previousPod),
      nextPodDigest: canonicalJsonDigest(nextPod),
      probeId: input.probeId,
    },
  });
  const nextState = validateDemandStateRecord({
    ...authority.loaded.state,
    revision: event.nextRevision,
    stateReason: event.reason,
    updatedAt: event.createdAt,
    lastEvent: { eventId: event.eventId, eventDigest: canonicalJsonDigest(event) },
    pod: nextPod,
  });
  return { event, nextState };
}

function ensureTestAccessTree(input, authority, probeId) {
  const root = resolveRef(input.workspaceRoot, `${authority.podSource.rootRef}/test-access`);
  inspectDirectory(root, "Pod Test access evidence root");
  const probeRoot = path.join(root, probeId);
  if (!fs.existsSync(probeRoot)) {
    createPrivateDirectory(probeRoot, root, "Pod Test access probe root");
  } else {
    inspectDirectory(probeRoot, "Pod Test access probe root");
  }
}

function testAccessPlanResult(status, authority, source) {
  const access = authority.loaded.state.pod.testAccess;
  return frozen({
    status,
    programId: authority.loaded.demand.programId,
    demandId: authority.loaded.demand.demandId,
    hostId: authority.loaded.state.pod.hostId,
    podId: authority.loaded.state.pod.podId,
    probeId: access.probeId,
    attempt: access.attempt,
    ...(access.previousProbeId === undefined ? {} : { previousProbeId: access.previousProbeId }),
    testAccessStatus: access.status,
    bindingSetDigest: access.bindingSetDigest,
    productBindingCount: access.productBindingCount,
    plan: { ref: source.ref, digest: source.digest },
    revision: authority.loaded.state.revision,
    stateDigest: authority.loaded.digests.state,
  });
}

function assertTestAccessReplayEvent(input, authority, commands) {
  const event = authority.loaded.events.find((entry) => entry.eventId === input.transition.eventId) ?? null;
  if (
    !event
    || !commands.includes(event.command)
    || event.podTransition?.probeId !== input.probeId
    || event.createdAt !== input.transition.createdAt
    || event.reason !== input.transition.reason
    || event.decisionSummary !== input.transition.decisionSummary
    || event.previousRevision !== input.expectedPrevious.revision
  ) {
    fail("wakeflow-pod-service-test-conflict", "Test access replay differs from its committed event");
  }
  return event;
}

function exactTestAccessPlanReplay(input, authority) {
  const access = authority.loaded.state.pod.testAccess ?? null;
  if (!access || access.probeId !== input.probeId) return null;
  const closure = currentTestAccessClosure(input, authority, {
    allowCurrentReceipt: access.status === "pending",
  });
  const source = closure.planSource;
  if (
    source.record.createdAt !== input.transition.createdAt
    || source.record.attempt !== access.attempt
  ) {
    fail("wakeflow-pod-service-test-conflict", "Test access plan replay differs from immutable evidence");
  }
  assertTestAccessReplayEvent(
    input,
    authority,
    ["plan-pod-test-access", "retry-pod-test-access"],
  );
  return testAccessPlanResult("replayed", authority, source);
}

function recoverExactTestAccessPlanJournal(input, config, profile) {
  return recoverDemandPodTransitionWhileLocked({
    stateRoot: input.stateRoot,
    expectedProgramId: input.expectedProgramId,
    ledgerRoot: config.ledgerRoot,
    admitRecoveryWhileLocked: ({ loaded, journal }) => {
      if (
        journal.artifactWrites.length !== 0
        || journal.expectedPreviousRevision !== input.expectedPrevious.revision
        || journal.expectedPreviousStateDigest !== input.expectedPrevious.stateDigest
      ) {
        fail(
          "wakeflow-pod-service-recovery-required",
          "pending Test access plan journal differs from the exact requested prefix",
        );
      }
      const previousLoaded = {
        ...loaded,
        state: journal.previousState,
        digests: { ...loaded.digests, state: journal.expectedPreviousStateDigest },
      };
      const authority = testAccessAuthorityFromLoaded(input, config, profile, previousLoaded);
      const desiredRef = testAccessPlanRef(authority, input.probeId);
      const closure = currentTestAccessClosure(input, authority, {
        allowedExtraRefs: [desiredRef],
      });
      const record = buildTestAccessPlan(input, authority, closure.bindingSet);
      const source = testAccessSource(
        authority,
        input.probeId,
        WAKEFLOW_POD_TEST_ACCESS_PLAN_KIND,
      );
      if (
        source.digest !== podRecordDigest(record)
        || !same(source.record, record)
      ) {
        fail(
          "wakeflow-pod-service-recovery-required",
          "pending Test access journal lacks its exact immutable plan",
        );
      }
      const transition = buildTestAccessPlanTransition(input, authority, source);
      if (!same(journal.nextEvent, transition.event) || !same(journal.nextState, transition.nextState)) {
        fail(
          "wakeflow-pod-service-recovery-required",
          "pending Test access journal differs from the rederived plan transition",
        );
      }
      return { admitted: true };
    },
  });
}

function verifyTestAccessFailureClosure(input, tracker, operation) {
  const config = loadConfig(input);
  return withStateRootLock(input.stateRoot, () => {
    const loaded = loadLocked(input, config);
    if (
      tracker.beforeStateDigest !== null
      && ![tracker.beforeStateDigest, tracker.nextStateDigest].includes(loaded.digests.state)
    ) {
      fail("wakeflow-pod-service-recovery-required", `${operation} left an unknown Pod state`);
    }
    const inventory = scanPodInventory({
      workspaceRoot: input.workspaceRoot,
      expectedProgramId: input.expectedProgramId,
      hostId: loaded.state.pod?.hostId ?? currentPodProfile().hostId,
    });
    const podSource = loaded.state.pod ? inventory.podById.get(loaded.state.pod.podId) ?? null : null;
    const evidence = tracker.evidenceRef && podSource
      ? podSource.recordsByRef.get(tracker.evidenceRef) ?? null
      : null;
    if (evidence !== null && evidence.digest !== tracker.evidenceDigest) {
      fail("wakeflow-pod-service-recovery-required", `${operation} left different immutable evidence`);
    }
    return safeReleaseVerdict({
      operation,
      configDigest: config.configDigest,
      stateDigest: loaded.digests.state,
      evidenceDigest: evidence?.digest ?? null,
    }, `${operation}-closure`);
  });
}

// 记录Test直连访问计划及pending state；计划绑定精确observer/target identity集合但不证明探测已由Test宿主执行。
export async function recordPodTestAccessPlan(value = {}) {
  const input = normalizeTestAccessPlanInput(value);
  const config = loadConfig(input);
  const profile = currentPodProfile();
  const tracker = {
    beforeStateDigest: null,
    nextStateDigest: null,
    evidenceRef: null,
    evidenceDigest: null,
  };
  try {
    return await withWakeflowRuntimeMutation({
      workspaceRoot: input.workspaceRoot,
      operationKind: "pod-test-access-plan",
      domainOwner: "core-pod-service",
      ...(input.acquireTimeoutMs === undefined ? {} : { acquireTimeoutMs: input.acquireTimeoutMs }),
      onCallbackFailure: () => verifyTestAccessFailureClosure(
        input,
        tracker,
        "pod-test-access-plan",
      ),
    }, (mutationContext) => withStateRootLock(input.stateRoot, () => {
      assertWakeflowMutationContext({
        workspaceRoot: input.workspaceRoot,
        context: mutationContext,
        mode: "runtime-mutation",
      });
      const currentConfig = loadConfig(input);
      if (currentConfig.configDigest !== config.configDigest) {
        fail("wakeflow-pod-service-stale", "config changed before Test access plan commit");
      }
      const recovered = recoverExactTestAccessPlanJournal(input, currentConfig, profile);
      let authority = loadTestAccessAuthorityWhileLocked(input, currentConfig, profile);
      tracker.beforeStateDigest = authority.loaded.digests.state;
      const replay = exactTestAccessPlanReplay(input, authority);
      if (replay !== null) {
        return recovered.status === "recovered"
          ? frozen({ ...replay, status: "recovered" })
          : replay;
      }
      assertExpectedPrevious(authority.loaded, input.expectedPrevious);
      const desiredRef = testAccessPlanRef(authority, input.probeId);
      const closure = currentTestAccessClosure(input, authority, {
        allowedExtraRefs: [desiredRef],
      });
      const record = buildTestAccessPlan(input, authority, closure.bindingSet);
      const desired = tuple(record);
      tracker.evidenceRef = desired.ref;
      tracker.evidenceDigest = desired.digest;
      const present = authority.podSource.recordsByRef.get(desired.ref) ?? null;
      if (present && (present.digest !== desired.digest || !same(present.record, desired.record))) {
        fail("wakeflow-pod-service-test-conflict", "Test access probeId already identifies a different plan");
      }
      ensureTestAccessTree(input, authority, input.probeId);
      ensureImmutableRecord(input.workspaceRoot, desired);
      authority = loadTestAccessAuthorityWhileLocked(input, currentConfig, profile);
      const source = testAccessSource(
        authority,
        input.probeId,
        WAKEFLOW_POD_TEST_ACCESS_PLAN_KIND,
      );
      if (source.digest !== desired.digest || !same(source.record, desired.record)) {
        fail("wakeflow-pod-service-evidence-closure", "Test access plan did not close immutable evidence");
      }
      const transition = buildTestAccessPlanTransition(input, authority, source);
      tracker.nextStateDigest = canonicalJsonDigest(transition.nextState);
      commitDemandPodTransitionWhileLocked({
        stateRoot: input.stateRoot,
        expectedProgramId: input.expectedProgramId,
        ledgerRoot: currentConfig.ledgerRoot,
        expectedPrevious: input.expectedPrevious,
        event: transition.event,
        nextState: transition.nextState,
      });
      authority = loadTestAccessAuthorityWhileLocked(input, currentConfig, profile);
      const closed = currentTestAccessClosure(input, authority, { allowCurrentReceipt: true });
      if (
        authority.loaded.digests.state !== tracker.nextStateDigest
        || closed.access?.probeId !== input.probeId
        || closed.access.status !== "pending"
      ) {
        fail("wakeflow-pod-service-authority-closure", "Test access plan did not close exact state authority");
      }
      return testAccessPlanResult("planned", authority, closed.planSource);
    }));
  } catch (cause) {
    boundary("test-access-plan", cause, "Pod Test access planning failed closed");
  }
}

function observeOneTestAccessTarget(target) {
  let actualRoot;
  try {
    const stat = fs.lstatSync(target.actualRoot, { bigint: true });
    actualRoot = fs.realpathSync.native(target.actualRoot);
    if (stat.isSymbolicLink() || !stat.isDirectory() || actualRoot !== target.actualRoot) {
      return { observation: {
        windowId: target.windowId,
        repositoryId: target.repositoryId,
        bindingId: target.bindingId,
        creationReceiptDigest: target.creationReceiptDigest,
        accessResult: "unreadable",
      }, failureCode: "root-unreadable" };
    }
  } catch {
    return { observation: {
      windowId: target.windowId,
      repositoryId: target.repositoryId,
      bindingId: target.bindingId,
      creationReceiptDigest: target.creationReceiptDigest,
      accessResult: "unreadable",
    }, failureCode: "root-unreadable" };
  }
  let gitTopLevel;
  let gitCommonDir;
  let currentHead;
  try {
    gitTopLevel = canonicalGitPath(
      actualRoot,
      ["rev-parse", "--show-toplevel"],
      "Test probe Git top-level",
    );
    gitCommonDir = canonicalGitPath(
      actualRoot,
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      "Test probe Git common directory",
    );
    currentHead = gitText(actualRoot, ["rev-parse", "HEAD"], "Test probe current HEAD");
  } catch {
    return { observation: {
      windowId: target.windowId,
      repositoryId: target.repositoryId,
      bindingId: target.bindingId,
      creationReceiptDigest: target.creationReceiptDigest,
      accessResult: "unreadable",
    }, failureCode: "probe-execution-failed" };
  }
  const observation = {
    windowId: target.windowId,
    repositoryId: target.repositoryId,
    bindingId: target.bindingId,
    creationReceiptDigest: target.creationReceiptDigest,
    accessResult: "readable",
    observedRootDigest: testAccessPathDigest("root", actualRoot),
    observedGitTopLevelDigest: testAccessPathDigest("git-top-level", gitTopLevel),
    observedGitCommonDirDigest: testAccessPathDigest("git-common-dir", gitCommonDir),
    currentHead,
  };
  return {
    observation,
    failureCode: (
      observation.observedRootDigest !== target.expectedRootDigest
      || observation.observedGitTopLevelDigest !== target.expectedGitTopLevelDigest
      || observation.observedGitCommonDirDigest !== target.expectedGitCommonDirDigest
    ) ? "git-identity-mismatch" : null,
  };
}

function observeTestAccessPlanRecord(plan, observedAt) {
  const targetObservations = [];
  const failures = [];
  for (const target of plan.targets) {
    const observed = observeOneTestAccessTarget(target);
    targetObservations.push(observed.observation);
    if (observed.failureCode !== null) failures.push(observed.failureCode);
  }
  const failureCode = [
    "root-unreadable",
    "probe-execution-failed",
    "git-identity-mismatch",
  ].find((code) => failures.includes(code)) ?? null;
  return frozen({
    kind: "WakeflowPodTestAccessObservation",
    schemaVersion: 1,
    programId: plan.programId,
    hostId: plan.hostId,
    podId: plan.podId,
    demandId: plan.demandId,
    probeId: plan.probeId,
    planDigest: podRecordDigest(plan),
    bindingSetDigest: plan.bindingSetDigest,
    observerBindingId: plan.observer.bindingId,
    observerIdentityBindingDigest: plan.observer.identityBindingDigest,
    targetObservations,
    observedAt,
    ...(failureCode === null ? {} : { failureCode }),
  });
}

// 对计划中的每个Product根执行有界文件系统与Git读取；结果只证明本进程观察到的可达性和identity闭包。
export function observePodTestAccessPlan(value = {}) {
  const input = normalizeTestAccessObserveInput(value);
  const config = loadConfig(input);
  const profile = currentPodProfile();
  try {
    return withStateRootLock(input.stateRoot, () => {
      const authority = loadTestAccessAuthorityWhileLocked(input, config, profile);
      const closure = currentTestAccessClosure(input, authority);
      if (
        closure.access?.status !== "pending"
        || closure.access.probeId !== input.probeId
        || closure.planSource.digest !== input.expectedPlanDigest
      ) {
        fail("wakeflow-pod-service-test-state", "only the exact current pending Test access plan may be observed");
      }
      if (Date.parse(input.observedAt) < Date.parse(closure.planSource.record.createdAt)) {
        fail("wakeflow-pod-service-test-time", "Test access observation cannot precede its plan");
      }
      return observeTestAccessPlanRecord(closure.planSource.record, input.observedAt);
    });
  } catch (cause) {
    boundary("test-access-observation", cause, "Pod Test access observation failed closed");
  }
}

function buildTestAccessReceipt(input, authority, closure) {
  const plan = closure.planSource.record;
  if (input.probeId !== input.observation.probeId || input.probeId !== plan.probeId) {
    fail("wakeflow-pod-service-test-observation", "Test access receipt selects a different probe");
  }
  const classification = classifyTestObservation(plan, input.observation);
  return createPodTestAccessReceiptRecord({
    kind: WAKEFLOW_POD_TEST_ACCESS_RECEIPT_KIND,
    schemaVersion: 1,
    programId: plan.programId,
    hostId: plan.hostId,
    podId: plan.podId,
    demandId: plan.demandId,
    probeId: plan.probeId,
    planDigest: closure.planSource.digest,
    bindingSetDigest: plan.bindingSetDigest,
    observerBindingId: input.observation.observerBindingId,
    observerIdentityBindingDigest: input.observation.observerIdentityBindingDigest,
    status: classification.status,
    capability: "direct-multi-root",
    targetObservations: input.observation.targetObservations,
    ...(classification.status === "blocked" ? { reasonCode: classification.reasonCode } : {}),
    observedAt: input.observation.observedAt,
    recordedAt: input.transition.createdAt,
  });
}

function buildTestAccessReceiptTransition(input, authority, receiptSource) {
  const previousPod = authority.loaded.state.pod;
  const previousAccess = previousPod.testAccess;
  if (
    !previousAccess
    || previousAccess.status !== "pending"
    || previousAccess.probeId !== input.probeId
  ) {
    fail("wakeflow-pod-service-test-state", "Test access receipt requires its exact current pending probe");
  }
  const receipt = receiptSource.record;
  const nextPod = structuredClone(previousPod);
  nextPod.phase = receipt.status === "validated" ? "execution-ready" : "blocked";
  nextPod.testAccess = {
    ...previousAccess,
    status: receipt.status,
    receipt: { ref: receiptSource.ref, digest: receiptSource.digest },
    ...(receipt.status === "validated"
      ? { capability: "direct-multi-root" }
      : { reasonCode: receipt.reasonCode }),
    observedAt: receipt.observedAt,
    recordedAt: receipt.recordedAt,
  };
  const event = validateControllerEventRecord({
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: input.transition.eventId,
    demandId: authority.loaded.demand.demandId,
    createdAt: input.transition.createdAt,
    actor: "controller",
    command: "record-pod-test-access",
    type: "pod.test-access-recorded",
    previousRevision: authority.loaded.state.revision,
    nextRevision: authority.loaded.state.revision + 1,
    from: authority.loaded.state.state,
    to: authority.loaded.state.state,
    reason: input.transition.reason,
    decisionSummary: input.transition.decisionSummary,
    changedArtifacts: [],
    podTransition: {
      podId: nextPod.podId,
      action: "settle-test-access",
      previousPodDigest: canonicalJsonDigest(previousPod),
      nextPodDigest: canonicalJsonDigest(nextPod),
      probeId: input.probeId,
    },
  });
  const nextState = validateDemandStateRecord({
    ...authority.loaded.state,
    revision: event.nextRevision,
    stateReason: event.reason,
    updatedAt: event.createdAt,
    lastEvent: { eventId: event.eventId, eventDigest: canonicalJsonDigest(event) },
    pod: nextPod,
  });
  return { event, nextState };
}

function testAccessReceiptResult(status, authority, source) {
  const access = authority.loaded.state.pod.testAccess;
  return frozen({
    status,
    outcome: access.status,
    programId: authority.loaded.demand.programId,
    demandId: authority.loaded.demand.demandId,
    hostId: authority.loaded.state.pod.hostId,
    podId: authority.loaded.state.pod.podId,
    probeId: access.probeId,
    attempt: access.attempt,
    bindingSetDigest: access.bindingSetDigest,
    productBindingCount: access.productBindingCount,
    plan: access.plan,
    receipt: { ref: source.ref, digest: source.digest },
    ...(access.status === "blocked" ? { reasonCode: access.reasonCode } : {}),
    revision: authority.loaded.state.revision,
    stateDigest: authority.loaded.digests.state,
  });
}

function exactTestAccessReceiptReplay(input, authority) {
  const access = authority.loaded.state.pod.testAccess ?? null;
  if (!access || access.probeId !== input.probeId || access.status === "pending") return null;
  const closure = currentTestAccessClosure(input, authority);
  const expected = buildTestAccessReceipt(input, authority, closure);
  if (!same(closure.receiptSource.record, expected)) {
    fail("wakeflow-pod-service-test-conflict", "Test access receipt replay differs from immutable evidence");
  }
  assertTestAccessReplayEvent(input, authority, ["record-pod-test-access"]);
  return testAccessReceiptResult("replayed", authority, closure.receiptSource);
}

function recoverExactTestAccessReceiptJournal(input, config, profile) {
  return recoverDemandPodTransitionWhileLocked({
    stateRoot: input.stateRoot,
    expectedProgramId: input.expectedProgramId,
    ledgerRoot: config.ledgerRoot,
    admitRecoveryWhileLocked: ({ loaded, journal }) => {
      if (
        journal.artifactWrites.length !== 0
        || journal.expectedPreviousRevision !== input.expectedPrevious.revision
        || journal.expectedPreviousStateDigest !== input.expectedPrevious.stateDigest
      ) {
        fail(
          "wakeflow-pod-service-recovery-required",
          "pending Test access receipt journal differs from the exact requested prefix",
        );
      }
      const previousLoaded = {
        ...loaded,
        state: journal.previousState,
        digests: { ...loaded.digests, state: journal.expectedPreviousStateDigest },
      };
      const authority = testAccessAuthorityFromLoaded(input, config, profile, previousLoaded);
      const receiptRef = testAccessReceiptRef(authority, input.probeId);
      const closure = currentTestAccessClosure(input, authority, {
        allowCurrentReceipt: true,
        allowedExtraRefs: [receiptRef],
      });
      if (closure.access?.status !== "pending" || closure.access.probeId !== input.probeId) {
        fail("wakeflow-pod-service-recovery-required", "pending receipt journal lacks its exact pending probe");
      }
      const record = buildTestAccessReceipt(input, authority, closure);
      const source = testAccessSource(
        authority,
        input.probeId,
        WAKEFLOW_POD_TEST_ACCESS_RECEIPT_KIND,
      );
      if (source.digest !== podRecordDigest(record) || !same(source.record, record)) {
        fail("wakeflow-pod-service-recovery-required", "pending receipt journal lacks exact immutable evidence");
      }
      const transition = buildTestAccessReceiptTransition(input, authority, source);
      if (!same(journal.nextEvent, transition.event) || !same(journal.nextState, transition.nextState)) {
        fail(
          "wakeflow-pod-service-recovery-required",
          "pending Test access receipt journal differs from the rederived settlement",
        );
      }
      return { admitted: true };
    },
  });
}

// 把精确观察归类为granted或blocked receipt并提交Pod Test状态，不把成功探测解释为产品验收。
export async function recordPodTestAccessReceipt(value = {}) {
  const input = normalizeTestAccessReceiptInput(value);
  const config = loadConfig(input);
  const profile = currentPodProfile();
  const tracker = {
    beforeStateDigest: null,
    nextStateDigest: null,
    evidenceRef: null,
    evidenceDigest: null,
  };
  try {
    return await withWakeflowRuntimeMutation({
      workspaceRoot: input.workspaceRoot,
      operationKind: "pod-test-access-receipt",
      domainOwner: "core-pod-service",
      ...(input.acquireTimeoutMs === undefined ? {} : { acquireTimeoutMs: input.acquireTimeoutMs }),
      onCallbackFailure: () => verifyTestAccessFailureClosure(
        input,
        tracker,
        "pod-test-access-receipt",
      ),
    }, (mutationContext) => withStateRootLock(input.stateRoot, () => {
      assertWakeflowMutationContext({
        workspaceRoot: input.workspaceRoot,
        context: mutationContext,
        mode: "runtime-mutation",
      });
      const currentConfig = loadConfig(input);
      if (currentConfig.configDigest !== config.configDigest) {
        fail("wakeflow-pod-service-stale", "config changed before Test access receipt commit");
      }
      const recovered = recoverExactTestAccessReceiptJournal(input, currentConfig, profile);
      let authority = loadTestAccessAuthorityWhileLocked(input, currentConfig, profile);
      tracker.beforeStateDigest = authority.loaded.digests.state;
      const replay = exactTestAccessReceiptReplay(input, authority);
      if (replay !== null) {
        return recovered.status === "recovered"
          ? frozen({ ...replay, status: "recovered" })
          : replay;
      }
      assertExpectedPrevious(authority.loaded, input.expectedPrevious);
      const expectedReceiptRef = testAccessReceiptRef(authority, input.probeId);
      const closure = currentTestAccessClosure(input, authority, {
        allowCurrentReceipt: true,
        allowedExtraRefs: [expectedReceiptRef],
      });
      if (closure.access?.status !== "pending" || closure.access.probeId !== input.probeId) {
        fail("wakeflow-pod-service-test-state", "Test access receipt requires the exact pending state selector");
      }
      const record = buildTestAccessReceipt(input, authority, closure);
      const desired = tuple(record);
      tracker.evidenceRef = desired.ref;
      tracker.evidenceDigest = desired.digest;
      const present = authority.podSource.recordsByRef.get(desired.ref) ?? null;
      if (present && (present.digest !== desired.digest || !same(present.record, desired.record))) {
        fail("wakeflow-pod-service-test-conflict", "Test access receipt conflicts with immutable evidence");
      }
      ensureTestAccessTree(input, authority, input.probeId);
      ensureImmutableRecord(input.workspaceRoot, desired);
      authority = loadTestAccessAuthorityWhileLocked(input, currentConfig, profile);
      const committed = testAccessSource(
        authority,
        input.probeId,
        WAKEFLOW_POD_TEST_ACCESS_RECEIPT_KIND,
      );
      if (committed.digest !== desired.digest || !same(committed.record, desired.record)) {
        fail("wakeflow-pod-service-evidence-closure", "Test access receipt did not close immutable evidence");
      }
      const transition = buildTestAccessReceiptTransition(input, authority, committed);
      tracker.nextStateDigest = canonicalJsonDigest(transition.nextState);
      commitDemandPodTransitionWhileLocked({
        stateRoot: input.stateRoot,
        expectedProgramId: input.expectedProgramId,
        ledgerRoot: currentConfig.ledgerRoot,
        expectedPrevious: input.expectedPrevious,
        event: transition.event,
        nextState: transition.nextState,
      });
      authority = loadTestAccessAuthorityWhileLocked(input, currentConfig, profile);
      const closed = currentTestAccessClosure(input, authority);
      if (
        authority.loaded.digests.state !== tracker.nextStateDigest
        || closed.access?.probeId !== input.probeId
        || closed.access.status !== committed.record.status
      ) {
        fail("wakeflow-pod-service-authority-closure", "Test access receipt did not close exact state authority");
      }
      return testAccessReceiptResult("recorded", authority, closed.receiptSource);
    }));
  } catch (cause) {
    boundary("test-access-receipt", cause, "Pod Test access receipt recording failed closed");
  }
}

function testAccessInspectionResult(authority, closure, {
  authorityEligible,
  blockingReasons,
  status,
}) {
  const access = closure.access;
  return frozen({
    kind: "WakeflowPodTestAccessInspection",
    schemaVersion: 1,
    programId: authority.loaded.demand.programId,
    demandId: authority.loaded.demand.demandId,
    hostId: authority.loaded.state.pod.hostId,
    podId: authority.loaded.state.pod.podId,
    status,
    authorityEligible,
    bindingSetDigest: closure.bindingSet.bindingSetDigest,
    productBindingCount: closure.bindingSet.targets.length,
    ...(access === null ? {} : {
      probeId: access.probeId,
      attempt: access.attempt,
      plan: access.plan,
      ...(access.receipt === undefined ? {} : { receipt: access.receipt }),
    }),
    blockingReasons,
    revision: authority.loaded.state.revision,
    stateDigest: authority.loaded.digests.state,
  });
}

// 只读组合当前plan、receipt、binding set与Pod state，给后续authority gate返回明确blocker。
export function inspectPodTestAccess(value = {}) {
  const input = normalizeTestAccessInspectInput(value, "Pod Test access inspection input");
  try {
    const config = loadConfig(input);
    const profile = currentPodProfile();
    return withStateRootLock(input.stateRoot, () => {
      const loaded = loadLocked(input, config);
      if (!loaded.state.pod) {
        return frozen({
          kind: "WakeflowPodTestAccessInspection",
          schemaVersion: 1,
          programId: loaded.demand.programId,
          demandId: loaded.demand.demandId,
          status: "absent",
          authorityEligible: false,
          blockingReasons: [{ code: "pod-authority-absent" }],
          revision: loaded.state.revision,
          stateDigest: loaded.digests.state,
        });
      }
      const authority = testAccessAuthorityFromLoaded(input, config, profile, loaded);
      const closure = currentTestAccessClosure(input, authority, {
        allowCurrentReceipt: loaded.state.pod.testAccess?.status === "pending",
      });
      if (closure.access === null) {
        return testAccessInspectionResult(authority, closure, {
          status: "absent",
          authorityEligible: false,
          blockingReasons: [{ code: "test-access-not-planned" }],
        });
      }
      if (closure.access.status === "pending") {
        return testAccessInspectionResult(authority, closure, {
          status: "pending",
          authorityEligible: false,
          blockingReasons: [{ code: "test-access-pending" }],
        });
      }
      if (closure.access.status === "blocked") {
        return testAccessInspectionResult(authority, closure, {
          status: "blocked",
          authorityEligible: false,
          blockingReasons: [{ code: closure.access.reasonCode }],
        });
      }
      const live = observeTestAccessPlanRecord(
        closure.planSource.record,
        closure.receiptSource.record.recordedAt,
      );
      if (Object.hasOwn(live, "failureCode")) {
        return testAccessInspectionResult(authority, closure, {
          status: "validated",
          authorityEligible: false,
          blockingReasons: [{ code: `live-${live.failureCode}` }],
        });
      }
      return testAccessInspectionResult(authority, closure, {
        status: "validated",
        authorityEligible: true,
        blockingReasons: [],
      });
    });
  } catch (cause) {
    return frozen({
      kind: "WakeflowPodTestAccessInspection",
      schemaVersion: 1,
      programId: input.expectedProgramId,
      status: "damaged",
      authorityEligible: false,
      blockingReasons: [{
        code: typeof cause?.code === "string" ? cause.code : "wakeflow-pod-service-test-damaged",
      }],
    });
  }
}

function closeDomainId(value, label) {
  if (typeof value !== "string" || !POD_CLOSE_ID_RE.test(value)) {
    fail("wakeflow-pod-service-contract", `${label} must be one typed Pod close operation ID`);
  }
  return value;
}

function normalizeCloseAuthorityInput(input, label, { requireWindow = true } = {}) {
  const required = ["workspaceRoot", "stateRoot", "expectedProgramId"];
  if (requireWindow) required.push("windowId");
  exactKeys(input, required, [], label);
  const workspaceRoot = rootPath(input.workspaceRoot, "workspaceRoot");
  const stateRoot = rootPath(input.stateRoot, "stateRoot");
  if (!inside(workspaceRoot, stateRoot) || stateRoot === workspaceRoot) {
    fail("wakeflow-pod-service-contract", "stateRoot must be one child of workspaceRoot");
  }
  return frozen({
    workspaceRoot,
    stateRoot,
    expectedProgramId: typedId(input.expectedProgramId, "program", "expectedProgramId"),
    ...(requireWindow
      ? { windowId: typedId(input.windowId, "window", "windowId") }
      : {}),
  });
}

function normalizeCloseIntentInput(input) {
  exactKeys(input, [
    "workspaceRoot",
    "stateRoot",
    "expectedProgramId",
    "windowId",
    "closeOperationId",
    "expectedPrevious",
    "transition",
  ], ["acquireTimeoutMs"], "Pod close intent input");
  const authority = normalizeCloseAuthorityInput({
    workspaceRoot: input.workspaceRoot,
    stateRoot: input.stateRoot,
    expectedProgramId: input.expectedProgramId,
    windowId: input.windowId,
  }, "Pod close intent authority input");
  return frozen({
    ...authority,
    closeOperationId: closeDomainId(input.closeOperationId, "closeOperationId"),
    expectedPrevious: normalizeExpectedPrevious(input.expectedPrevious),
    transition: normalizeTransition(input.transition),
    acquireTimeoutMs: timeout(input.acquireTimeoutMs),
  });
}

function normalizeCloseObservation(value) {
  if (!plainObject(value)) {
    fail("wakeflow-pod-service-contract", "Pod close observation requires one closed discriminated kind");
  }
  exactKeys(
    value,
    ["kind", "worktreeStatus"],
    ["hostResult", "confirmedAt"],
    "Pod close observation",
  );
  value = canonicalSnapshot(value, "Pod close observation");
  if (typeof value.kind !== "string") {
    fail("wakeflow-pod-service-contract", "Pod close observation requires one closed discriminated kind");
  }
  if (!POD_CLOSE_WORKTREE_STATUS_SET.has(value.worktreeStatus)) {
    fail("wakeflow-pod-service-contract", "close observation worktreeStatus is unsupported");
  }
  if (value.kind === "host-result") {
    exactKeys(value, ["kind", "hostResult", "worktreeStatus"], [], "Pod close host result observation");
    let hostResult;
    try {
      hostResult = validateHostDecommissionResult(value.hostResult);
    } catch (cause) {
      fail(
        "wakeflow-pod-service-close-host-result",
        "close observation host result is invalid",
        {},
        cause,
      );
    }
    return frozen({
      kind: "host-result",
      hostResult,
      hostResultDigest: hostDecommissionResultDigest(hostResult),
      worktreeStatus: value.worktreeStatus,
      confirmedAt: hostResult.observedAt,
    });
  }
  if (value.kind === "unmaterialized-not-found") {
    exactKeys(
      value,
      ["kind", "worktreeStatus", "confirmedAt"],
      [],
      "Pod unmaterialized close observation",
    );
    if (value.worktreeStatus !== "not-applicable") {
      fail(
        "wakeflow-pod-service-close-observation",
        "an unmaterialized not-found observation cannot invent worktree disposition",
      );
    }
    return frozen({
      kind: "unmaterialized-not-found",
      hostResult: null,
      hostResultDigest: null,
      worktreeStatus: "not-applicable",
      confirmedAt: token(value.confirmedAt, "observation.confirmedAt"),
    });
  }
  fail("wakeflow-pod-service-contract", "Pod close observation kind is unsupported");
}

function normalizeCloseObserveInput(input) {
  exactKeys(input, [
    "workspaceRoot",
    "stateRoot",
    "expectedProgramId",
    "windowId",
    "closeOperationId",
    "expectedIntentDigest",
    "observation",
  ], [], "Pod close observation input");
  const authority = normalizeCloseAuthorityInput({
    workspaceRoot: input.workspaceRoot,
    stateRoot: input.stateRoot,
    expectedProgramId: input.expectedProgramId,
    windowId: input.windowId,
  }, "Pod close observation authority input");
  return frozen({
    ...authority,
    closeOperationId: closeDomainId(input.closeOperationId, "closeOperationId"),
    expectedIntentDigest: digest(input.expectedIntentDigest, "expectedIntentDigest"),
    observation: normalizeCloseObservation(input.observation),
  });
}

function normalizeCloseReceiptInput(input) {
  exactKeys(input, [
    "workspaceRoot",
    "stateRoot",
    "expectedProgramId",
    "windowId",
    "closeOperationId",
    "expectedIntentDigest",
    "expectedPrevious",
    "observation",
    "transition",
  ], ["acquireTimeoutMs"], "Pod close receipt input");
  const observed = normalizeCloseObserveInput({
    workspaceRoot: input.workspaceRoot,
    stateRoot: input.stateRoot,
    expectedProgramId: input.expectedProgramId,
    windowId: input.windowId,
    closeOperationId: input.closeOperationId,
    expectedIntentDigest: input.expectedIntentDigest,
    observation: input.observation,
  });
  const transition = normalizeTransition(input.transition);
  if (Date.parse(transition.createdAt) < Date.parse(observed.observation.confirmedAt)) {
    fail("wakeflow-pod-service-contract", "close receipt transition cannot precede host confirmation");
  }
  return frozen({
    ...observed,
    expectedPrevious: normalizeExpectedPrevious(input.expectedPrevious),
    transition,
    acquireTimeoutMs: timeout(input.acquireTimeoutMs),
  });
}

function normalizeCloseInspectInput(input) {
  return normalizeCloseAuthorityInput(input, "Pod close inspection input", { requireWindow: false });
}

function normalizeCloseDecommissionInput(input) {
  exactKeys(input, [
    "workspaceRoot",
    "stateRoot",
    "expectedProgramId",
    "windowId",
    "closeOperationId",
    "expectedReceiptDigest",
    "expectedAcknowledgedState",
  ], ["acquireTimeoutMs"], "Pod closed identity decommission input");
  const authority = normalizeCloseAuthorityInput({
    workspaceRoot: input.workspaceRoot,
    stateRoot: input.stateRoot,
    expectedProgramId: input.expectedProgramId,
    windowId: input.windowId,
  }, "Pod closed identity decommission authority input");
  return frozen({
    ...authority,
    closeOperationId: closeDomainId(input.closeOperationId, "closeOperationId"),
    expectedReceiptDigest: digest(input.expectedReceiptDigest, "expectedReceiptDigest"),
    expectedAcknowledgedState: normalizeExpectedPrevious(input.expectedAcknowledgedState),
    acquireTimeoutMs: timeout(input.acquireTimeoutMs),
  });
}

function closeIntentRef(podSource, closeOperationId) {
  return `${podSource.rootRef}/close/${closeOperationId}/intent.json`;
}

function closeReceiptRef(podSource, closeOperationId) {
  return `${podSource.rootRef}/close/${closeOperationId}/receipt.json`;
}

function assertCreationSourceMatchesMember(authority, member, source, materialization) {
  const intentSource = authority.podSource.recordsByRef.get(member.launchIntent.ref) ?? null;
  if (
    !intentSource
    || !source
    || source.record.kind !== WAKEFLOW_POD_CREATION_RECEIPT_KIND
    || source.digest !== member.creationReceipt?.digest
    || materialization.public.status !== "finalized"
    || materialization.tailSource?.ref !== member.materializationFinalEvent?.ref
    || materialization.tailSource?.digest !== member.materializationFinalEvent?.digest
    || materialization.tailSource?.record.eventId !== member.materializationFinalEvent?.eventId
  ) {
    fail(
      "wakeflow-pod-service-close-authority",
      "Pod close member lacks its exact historical creation chain",
      { windowId: member.windowId },
    );
  }
  const receipt = source.record;
  if (
    receipt.programId !== authority.loaded.demand.programId
    || receipt.hostId !== authority.loaded.state.pod.hostId
    || receipt.podId !== authority.loaded.state.pod.podId
    || receipt.demandId !== authority.loaded.demand.demandId
    || receipt.windowId !== member.windowId
    || receipt.launchOperationId !== member.launchOperationId
    || receipt.bindingId !== member.bindingId
    || receipt.launchIntentDigest !== intentSource.digest
    || receipt.materializationFinalEventDigest !== materialization.tailSource.digest
    || receipt.identityBindingDigest !== member.identityBindingDigest
    || (member.role === "product") !== (receipt.resource.kind === "git-worktree")
  ) {
    fail(
      "wakeflow-pod-service-close-authority",
      "historical creation receipt differs from the state-selected Pod member",
      { windowId: member.windowId },
    );
  }
}

function expectedClaimFromCloseReceipt(member, receipt) {
  if (receipt.sessionStatus === "unknown") {
    fail(
      "wakeflow-pod-service-close-manual-gate",
      "unknown host session status cannot acknowledge logical Pod closure",
      { windowId: member.windowId },
    );
  }
  if (member.role !== "product") {
    if (receipt.worktreeStatus !== "not-applicable") {
      fail(
        "wakeflow-pod-service-close-observation",
        "control Pod close receipts require not-applicable worktree status",
        { windowId: member.windowId },
      );
    }
    return null;
  }
  if (receipt.worktreeStatus === "removed") return "released";
  if (receipt.worktreeStatus === "retained") return "retained";
  if (receipt.worktreeStatus === "unknown") return "unknown";
  if (
    receipt.worktreeStatus === "not-applicable"
    && receipt.sessionStatus === "not-found"
    && !member.creationReceipt
  ) return "released";
  fail(
    "wakeflow-pod-service-close-observation",
    "product worktree disposition is incompatible with its materialization authority",
    { windowId: member.windowId },
  );
}

function assertCloseIntentMatchesMember(authority, member, source) {
  const intent = source.record;
  if (
    intent.kind !== WAKEFLOW_POD_CLOSE_INTENT_KIND
    || intent.programId !== authority.loaded.demand.programId
    || intent.hostId !== authority.loaded.state.pod.hostId
    || intent.podId !== authority.loaded.state.pod.podId
    || intent.demandId !== authority.loaded.demand.demandId
    || intent.windowId !== member.windowId
    || intent.launchOperationId !== member.launchOperationId
    || intent.bindingId !== member.bindingId
    || intent.closeOperationId !== member.close?.closeOperationId
    || intent.role !== member.role
    || intent.sessionIntent !== "close"
    || intent.worktreeReportingPolicy !== "observe-only"
    || (member.creationReceipt
      ? intent.creationReceiptDigest !== member.creationReceipt.digest
      : Object.hasOwn(intent, "creationReceiptDigest"))
  ) {
    fail(
      "wakeflow-pod-service-close-authority",
      "Pod close intent differs from its exact state-selected member",
      { windowId: member.windowId },
    );
  }
}

function assertCloseReceiptMatchesMember(authority, member, intentSource, receiptSource) {
  const receipt = receiptSource.record;
  if (
    receipt.kind !== WAKEFLOW_POD_CLOSE_RECEIPT_KIND
    || receipt.programId !== authority.loaded.demand.programId
    || receipt.hostId !== authority.loaded.state.pod.hostId
    || receipt.podId !== authority.loaded.state.pod.podId
    || receipt.demandId !== authority.loaded.demand.demandId
    || receipt.windowId !== member.windowId
    || receipt.closeOperationId !== member.close.closeOperationId
    || receipt.bindingId !== member.bindingId
    || receipt.closeIntentDigest !== intentSource.digest
    || Date.parse(receipt.confirmedAt) < Date.parse(intentSource.record.createdAt)
    || Date.parse(receipt.recordedAt) < Date.parse(receipt.confirmedAt)
  ) {
    fail(
      "wakeflow-pod-service-close-authority",
      "Pod close receipt differs from its exact intent and member authority",
      { windowId: member.windowId },
    );
  }
  const expectedClaim = expectedClaimFromCloseReceipt(member, receipt);
  if (member.role === "product" && member.resourceClaimStatus !== expectedClaim) {
    fail(
      "wakeflow-pod-service-close-authority",
      "closed product claim differs from the observed worktree disposition",
      { windowId: member.windowId },
    );
  }
}

function closeAuthorityFromLoaded(input, config, profile, loaded, {
  allowedExtraRefs = [],
} = {}) {
  if (!["completed", "cancelled"].includes(loaded.state.state)) {
    fail("wakeflow-pod-service-close-state", "Pod close requires a completed or cancelled demand");
  }
  if (
    loaded.demand.executionPlacement.mode !== "isolated"
    || !loaded.state.pod
    || loaded.state.pod.hostId !== profile.hostId
  ) {
    fail("wakeflow-pod-service-close-authority", "current terminal demand has no Pod owned by this host");
  }
  const inventory = scanPodInventory({
    workspaceRoot: input.workspaceRoot,
    expectedProgramId: input.expectedProgramId,
    hostId: profile.hostId,
  });
  const podSource = inventory.podById.get(loaded.state.pod.podId) ?? null;
  const selected = selectedLaunchTuples(loaded.state, podSource);
  assertExactStateEvidence(loaded.state, podSource, podSource.scopeSource, selected);
  const identityInventory = inspectWindowBindingInventory({ workspaceRoot: input.workspaceRoot });
  if (
    identityInventory.programId !== loaded.demand.programId
    || identityInventory.hostId !== profile.hostId
    || identityInventory.configDigest !== config.configDigest
  ) {
    fail(
      "wakeflow-pod-service-close-authority",
      "current identity inventory differs from terminal Pod authority",
    );
  }
  const identityByWindow = new Map(
    identityInventory.bindings.map((entry) => [entry.windowId, entry]),
  );
  const authority = {
    loaded,
    inventory,
    podSource,
    identityInventory,
    identityByWindow,
  };
  const selectedCreationRefs = new Set();
  for (const member of loaded.state.pod.windows) {
    const materialization = reduceMaterializationChain(podSource, member);
    const identity = identityByWindow.get(member.windowId) ?? null;
    if (member.creationReceipt) {
      selectedCreationRefs.add(member.creationReceipt.ref);
      const source = podSource.recordsByRef.get(member.creationReceipt.ref) ?? null;
      assertCreationSourceMatchesMember(authority, member, source, materialization);
      if (
        identity !== null
        && (
          identity.bindingId !== member.bindingId
          || identity.identityBindingDigest !== member.identityBindingDigest
        )
      ) {
        fail(
          "wakeflow-pod-service-close-authority",
          "current identity differs from the state-selected historical creation binding",
          { windowId: member.windowId },
        );
      }
      if (member.status !== "closed" && identity === null) {
        fail(
          "wakeflow-pod-service-close-authority",
          "identity cleanup cannot precede state acknowledgement of its close receipt",
          { windowId: member.windowId },
        );
      }
    } else if (identity !== null) {
      fail(
        "wakeflow-pod-service-close-authority",
        "an unmaterialized Pod member cannot own a current identity binding",
        { windowId: member.windowId },
      );
    }
  }
  for (const source of podSource.records) {
    if (
      source.record.kind === WAKEFLOW_POD_CREATION_RECEIPT_KIND
      && !selectedCreationRefs.has(source.ref)
    ) {
      fail(
        "wakeflow-pod-service-close-authority",
        "unlinked creation receipt exists beside terminal Pod authority",
        { ref: source.ref },
      );
    }
  }

  const allowedCloseRefs = new Set(allowedExtraRefs);
  for (const member of loaded.state.pod.windows) {
    if (!member.close) continue;
    allowedCloseRefs.add(member.close.intent.ref);
    const intentSource = podSource.recordsByRef.get(member.close.intent.ref) ?? null;
    if (
      !intentSource
      || intentSource.digest !== member.close.intent.digest
    ) {
      fail(
        "wakeflow-pod-service-close-authority",
        "state-selected Pod close intent is missing or changed",
        { windowId: member.windowId },
      );
    }
    assertCloseIntentMatchesMember(authority, member, intentSource);
    if (member.close.receipt) {
      allowedCloseRefs.add(member.close.receipt.ref);
      const receiptSource = podSource.recordsByRef.get(member.close.receipt.ref) ?? null;
      if (!receiptSource || receiptSource.digest !== member.close.receipt.digest) {
        fail(
          "wakeflow-pod-service-close-authority",
          "state-selected Pod close receipt is missing or changed",
          { windowId: member.windowId },
        );
      }
      assertCloseReceiptMatchesMember(authority, member, intentSource, receiptSource);
    }
  }
  const orphan = podSource.records.find((source) => (
    [WAKEFLOW_POD_CLOSE_INTENT_KIND, WAKEFLOW_POD_CLOSE_RECEIPT_KIND]
      .includes(source.record.kind)
    && !allowedCloseRefs.has(source.ref)
  ));
  if (orphan) {
    fail(
      "wakeflow-pod-service-close-orphan",
      "unlinked Pod close evidence blocks terminal authority",
      { ref: orphan.ref },
    );
  }
  const member = input.windowId === undefined
    ? null
    : loaded.state.pod.windows.find((entry) => entry.windowId === input.windowId) ?? null;
  if (input.windowId !== undefined && member === null) {
    fail("wakeflow-pod-service-close-authority", "windowId is not one state-selected Pod member");
  }
  return { ...authority, member };
}

function loadCloseAuthorityWhileLocked(input, config, profile, options = {}) {
  return closeAuthorityFromLoaded(input, config, profile, loadLocked(input, config), options);
}

function expectedCloseIntentRecord(input, authority) {
  const member = authority.member;
  return createPodCloseIntentRecord({
    kind: WAKEFLOW_POD_CLOSE_INTENT_KIND,
    schemaVersion: 1,
    programId: authority.loaded.demand.programId,
    hostId: authority.loaded.state.pod.hostId,
    podId: authority.loaded.state.pod.podId,
    demandId: authority.loaded.demand.demandId,
    windowId: member.windowId,
    launchOperationId: member.launchOperationId,
    bindingId: member.bindingId,
    closeOperationId: input.closeOperationId,
    role: member.role,
    ...(member.creationReceipt
      ? { creationReceiptDigest: member.creationReceipt.digest }
      : {}),
    sessionIntent: "close",
    worktreeReportingPolicy: "observe-only",
    createdAt: input.transition.createdAt,
  });
}

function buildCloseIntentRecord(input, authority) {
  if (!["planned", "bound"].includes(authority.member.status) || authority.member.close) {
    fail("wakeflow-pod-service-close-state", "new close intent requires one planned or bound Pod member");
  }
  if (Date.parse(input.transition.createdAt) < Date.parse(authority.loaded.state.updatedAt)) {
    fail("wakeflow-pod-service-close-time", "close intent cannot precede current terminal state authority");
  }
  return expectedCloseIntentRecord(input, authority);
}

function buildCloseIntentTransition(input, authority, intentSource) {
  const previousPod = authority.loaded.state.pod;
  const nextPod = structuredClone(previousPod);
  const member = nextPod.windows.find((entry) => entry.windowId === input.windowId);
  member.status = "closing";
  member.close = {
    closeOperationId: input.closeOperationId,
    intent: { ref: intentSource.ref, digest: intentSource.digest },
  };
  nextPod.phase = "closing";
  delete nextPod.testAccess;
  const event = validateControllerEventRecord({
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: input.transition.eventId,
    demandId: authority.loaded.demand.demandId,
    createdAt: input.transition.createdAt,
    actor: "controller",
    command: "plan-pod-close",
    type: "pod.close-planned",
    previousRevision: authority.loaded.state.revision,
    nextRevision: authority.loaded.state.revision + 1,
    from: authority.loaded.state.state,
    to: authority.loaded.state.state,
    reason: input.transition.reason,
    decisionSummary: input.transition.decisionSummary,
    changedArtifacts: [],
    podTransition: {
      podId: nextPod.podId,
      action: "plan-close",
      windowId: input.windowId,
      closeOperationId: input.closeOperationId,
      previousPodDigest: canonicalJsonDigest(previousPod),
      nextPodDigest: canonicalJsonDigest(nextPod),
    },
  });
  const nextState = validateDemandStateRecord({
    ...authority.loaded.state,
    revision: event.nextRevision,
    stateReason: event.reason,
    updatedAt: event.createdAt,
    lastEvent: { eventId: event.eventId, eventDigest: canonicalJsonDigest(event) },
    pod: nextPod,
  });
  return { event, nextState };
}

function ensureCloseTree(input, authority) {
  const closeRoot = resolveRef(input.workspaceRoot, `${authority.podSource.rootRef}/close`);
  inspectDirectory(closeRoot, "Pod close evidence root");
  const operationRoot = path.join(closeRoot, input.closeOperationId);
  if (inspectDirectory(operationRoot, "Pod close operation root", { allowMissing: true }) === null) {
    createPrivateDirectory(operationRoot, closeRoot, "Pod close operation root");
  }
}

function assertCloseReplayEvent(input, authority, command) {
  const event = authority.loaded.events.find((entry) => entry.eventId === input.transition.eventId) ?? null;
  if (
    !event
    || event.command !== command
    || event.podTransition?.windowId !== input.windowId
    || event.podTransition?.closeOperationId !== input.closeOperationId
    || event.createdAt !== input.transition.createdAt
    || event.reason !== input.transition.reason
    || event.decisionSummary !== input.transition.decisionSummary
    || event.previousRevision !== input.expectedPrevious.revision
  ) {
    fail("wakeflow-pod-service-close-conflict", "Pod close replay differs from its committed event");
  }
}

function closeIntentResult(status, authority, source) {
  return frozen({
    status,
    programId: authority.loaded.demand.programId,
    demandId: authority.loaded.demand.demandId,
    hostId: authority.loaded.state.pod.hostId,
    podId: authority.loaded.state.pod.podId,
    windowId: authority.member.windowId,
    role: authority.member.role,
    bindingId: authority.member.bindingId,
    closeOperationId: authority.member.close.closeOperationId,
    intent: { ref: source.ref, digest: source.digest },
    podPhase: authority.loaded.state.pod.phase,
    memberStatus: authority.member.status,
    requiresHostOperationFence: true,
    revision: authority.loaded.state.revision,
    stateDigest: authority.loaded.digests.state,
  });
}

function exactCloseIntentReplay(input, authority) {
  const member = authority.member;
  if (!member.close) return null;
  if (member.close.closeOperationId !== input.closeOperationId) {
    fail("wakeflow-pod-service-close-conflict", "Pod member is already selected by a different close operation");
  }
  const source = authority.podSource.recordsByRef.get(member.close.intent.ref) ?? null;
  const expected = expectedCloseIntentRecord(input, authority);
  if (!source || source.digest !== member.close.intent.digest || !same(source.record, expected)) {
    fail("wakeflow-pod-service-close-conflict", "close intent replay differs from immutable evidence");
  }
  assertCloseReplayEvent(input, authority, "plan-pod-close");
  return closeIntentResult("replayed", authority, source);
}

function recoverExactCloseIntentJournal(input, config, profile) {
  return recoverDemandPodTransitionWhileLocked({
    stateRoot: input.stateRoot,
    expectedProgramId: input.expectedProgramId,
    ledgerRoot: config.ledgerRoot,
    admitRecoveryWhileLocked: ({ loaded, journal }) => {
      if (
        journal.artifactWrites.length !== 0
        || journal.expectedPreviousRevision !== input.expectedPrevious.revision
        || journal.expectedPreviousStateDigest !== input.expectedPrevious.stateDigest
      ) {
        fail("wakeflow-pod-service-recovery-required", "pending close intent journal differs from the requested state prefix");
      }
      const previousLoaded = {
        ...loaded,
        state: journal.previousState,
        digests: { ...loaded.digests, state: journal.expectedPreviousStateDigest },
      };
      const provisionalPodSource = scanPodInventory({
        workspaceRoot: input.workspaceRoot,
        expectedProgramId: input.expectedProgramId,
        hostId: profile.hostId,
      }).podById.get(journal.previousState.pod?.podId) ?? null;
      const desiredRef = provisionalPodSource
        ? closeIntentRef(provisionalPodSource, input.closeOperationId)
        : null;
      const authority = closeAuthorityFromLoaded(input, config, profile, previousLoaded, {
        allowedExtraRefs: desiredRef === null ? [] : [desiredRef],
      });
      const record = buildCloseIntentRecord(input, authority);
      const source = authority.podSource.recordsByRef.get(podRecordRef(record)) ?? null;
      if (!source || source.digest !== podRecordDigest(record) || !same(source.record, record)) {
        fail("wakeflow-pod-service-recovery-required", "pending close intent journal lacks exact immutable evidence");
      }
      const transition = buildCloseIntentTransition(input, authority, source);
      if (!same(journal.nextEvent, transition.event) || !same(journal.nextState, transition.nextState)) {
        fail("wakeflow-pod-service-recovery-required", "pending close intent journal differs from the rederived transition");
      }
      return { admitted: true };
    },
  });
}

function verifyCloseFailureClosure(input, tracker, operation) {
  const config = loadConfig(input);
  return withStateRootLock(input.stateRoot, () => {
    const loaded = loadLocked(input, config);
    if (
      tracker.beforeStateDigest !== null
      && ![tracker.beforeStateDigest, tracker.nextStateDigest].includes(loaded.digests.state)
    ) {
      fail("wakeflow-pod-service-recovery-required", `${operation} left an unknown Pod state`);
    }
    const inventory = scanPodInventory({
      workspaceRoot: input.workspaceRoot,
      expectedProgramId: input.expectedProgramId,
      hostId: loaded.state.pod?.hostId ?? currentPodProfile().hostId,
    });
    const podSource = loaded.state.pod
      ? inventory.podById.get(loaded.state.pod.podId) ?? null
      : null;
    const evidence = tracker.evidenceRef && podSource
      ? podSource.recordsByRef.get(tracker.evidenceRef) ?? null
      : null;
    if (evidence !== null && evidence.digest !== tracker.evidenceDigest) {
      fail("wakeflow-pod-service-recovery-required", `${operation} left different immutable evidence`);
    }
    return safeReleaseVerdict({
      operation,
      configDigest: config.configDigest,
      stateDigest: loaded.digests.state,
      evidenceDigest: evidence?.digest ?? null,
    }, `pod-${operation}-closure`);
  });
}

// 在任何宿主关闭effect之前持久化单窗口close intent和closing state，形成可恢复的effect fence。
export async function recordPodCloseIntent(value = {}) {
  const input = normalizeCloseIntentInput(value);
  const config = loadConfig(input);
  const profile = currentPodProfile();
  const tracker = {
    beforeStateDigest: null,
    nextStateDigest: null,
    evidenceRef: null,
    evidenceDigest: null,
  };
  try {
    return await withWakeflowRuntimeMutation({
      workspaceRoot: input.workspaceRoot,
      operationKind: "pod-close-intent",
      domainOwner: "core-pod-service",
      ...(input.acquireTimeoutMs === undefined ? {} : { acquireTimeoutMs: input.acquireTimeoutMs }),
      onCallbackFailure: () => verifyCloseFailureClosure(input, tracker, "close-intent"),
    }, (mutationContext) => withStateRootLock(input.stateRoot, () => {
      assertWakeflowMutationContext({
        workspaceRoot: input.workspaceRoot,
        context: mutationContext,
        mode: "runtime-mutation",
      });
      const currentConfig = loadConfig(input);
      if (currentConfig.configDigest !== config.configDigest) {
        fail("wakeflow-pod-service-stale", "config changed before close intent commit");
      }
      const recovered = recoverExactCloseIntentJournal(input, currentConfig, profile);
      let loaded = loadLocked(input, currentConfig);
      const currentPodSource = loaded.state.pod
        ? scanPodInventory({
            workspaceRoot: input.workspaceRoot,
            expectedProgramId: input.expectedProgramId,
            hostId: profile.hostId,
          }).podById.get(loaded.state.pod.podId) ?? null
        : null;
      const desiredRef = currentPodSource
        ? closeIntentRef(currentPodSource, input.closeOperationId)
        : null;
      let authority = closeAuthorityFromLoaded(input, currentConfig, profile, loaded, {
        allowedExtraRefs: desiredRef === null ? [] : [desiredRef],
      });
      tracker.beforeStateDigest = authority.loaded.digests.state;
      const replay = exactCloseIntentReplay(input, authority);
      if (replay !== null) {
        return recovered.status === "recovered"
          ? frozen({ ...replay, status: "recovered" })
          : replay;
      }
      assertExpectedPrevious(authority.loaded, input.expectedPrevious);
      const record = buildCloseIntentRecord(input, authority);
      const desired = tuple(record);
      tracker.evidenceRef = desired.ref;
      tracker.evidenceDigest = desired.digest;
      const present = authority.podSource.recordsByRef.get(desired.ref) ?? null;
      if (present && (present.digest !== desired.digest || !same(present.record, desired.record))) {
        fail("wakeflow-pod-service-close-conflict", "close intent conflicts with immutable evidence");
      }
      ensureCloseTree(input, authority);
      ensureImmutableRecord(input.workspaceRoot, desired);
      authority = loadCloseAuthorityWhileLocked(input, currentConfig, profile, {
        allowedExtraRefs: [desired.ref],
      });
      const committed = authority.podSource.recordsByRef.get(desired.ref) ?? null;
      if (!committed || committed.digest !== desired.digest || !same(committed.record, desired.record)) {
        fail("wakeflow-pod-service-evidence-closure", "close intent did not close immutable evidence");
      }
      const transition = buildCloseIntentTransition(input, authority, committed);
      tracker.nextStateDigest = canonicalJsonDigest(transition.nextState);
      commitDemandPodTransitionWhileLocked({
        stateRoot: input.stateRoot,
        expectedProgramId: input.expectedProgramId,
        ledgerRoot: currentConfig.ledgerRoot,
        expectedPrevious: input.expectedPrevious,
        event: transition.event,
        nextState: transition.nextState,
      });
      authority = loadCloseAuthorityWhileLocked(input, currentConfig, profile);
      if (
        authority.loaded.digests.state !== tracker.nextStateDigest
        || authority.member.status !== "closing"
        || authority.member.close?.intent.digest !== desired.digest
      ) {
        fail("wakeflow-pod-service-authority-closure", "close intent did not close exact state authority");
      }
      return closeIntentResult("planned", authority, committed);
    }));
  } catch (cause) {
    boundary("close-intent", cause, "Pod close intent recording failed closed");
  }
}

function currentCloseIntentSource(input, authority) {
  const close = authority.member.close ?? null;
  if (
    !close
    || close.closeOperationId !== input.closeOperationId
    || close.intent.digest !== input.expectedIntentDigest
  ) {
    fail("wakeflow-pod-service-close-stale", "close observation does not select the current exact intent");
  }
  const source = authority.podSource.recordsByRef.get(close.intent.ref) ?? null;
  if (!source || source.digest !== close.intent.digest) {
    fail("wakeflow-pod-service-close-authority", "current close intent evidence is unavailable");
  }
  assertCloseIntentMatchesMember(authority, authority.member, source);
  return source;
}

function provisionalCloseReceipt(input, authority, intentSource, recordedAt) {
  const machineVerified = input.observation.kind === "host-result"
    && input.observation.hostResult.status === "machine-verified";
  return createPodCloseReceiptRecord({
    kind: WAKEFLOW_POD_CLOSE_RECEIPT_KIND,
    schemaVersion: 1,
    programId: authority.loaded.demand.programId,
    hostId: authority.loaded.state.pod.hostId,
    podId: authority.loaded.state.pod.podId,
    demandId: authority.loaded.demand.demandId,
    windowId: authority.member.windowId,
    closeOperationId: input.closeOperationId,
    bindingId: authority.member.bindingId,
    closeIntentDigest: intentSource.digest,
    verificationStatus: machineVerified
      ? "machine-verified"
      : "unmaterialized-not-found",
    ...(machineVerified
      ? { hostResultDigest: input.observation.hostResultDigest }
      : {}),
    sessionStatus: machineVerified ? "closed" : "not-found",
    worktreeStatus: input.observation.worktreeStatus,
    confirmedAt: input.observation.confirmedAt,
    recordedAt,
  });
}

function assertCloseHostResultMatchesAuthority(input, authority, intentSource) {
  const result = input.observation.hostResult;
  const member = authority.member;
  const identity = authority.identityByWindow.get(member.windowId) ?? null;
  if (
    result.programId !== authority.loaded.demand.programId
    || result.hostId !== authority.loaded.state.pod.hostId
    || result.windowId !== member.windowId
    || result.binding.bindingId !== member.bindingId
    || result.binding.digest !== member.identityBindingDigest
    || result.subjectDigest !== intentSource.digest
  ) {
    fail(
      "wakeflow-pod-service-close-host-result",
      "host decommission result differs from the exact state-selected close intent and binding",
      { windowId: member.windowId },
    );
  }
  if (
    identity !== null
    && (
      identity.bindingId !== result.binding.bindingId
      || identity.identityBindingDigest !== result.binding.digest
    )
  ) {
    fail(
      "wakeflow-pod-service-close-host-result",
      "host decommission result differs from current identity authority",
      { windowId: member.windowId },
    );
  }
  if (member.status !== "closed" && identity === null) {
    fail(
      "wakeflow-pod-service-close-host-result",
      "host decommission result cannot acknowledge a materialized member after premature identity removal",
      { windowId: member.windowId },
    );
  }
  return result;
}

function classifyCloseObservation(input, authority, intentSource, recordedAt) {
  if (Date.parse(input.observation.confirmedAt) < Date.parse(intentSource.record.createdAt)) {
    fail("wakeflow-pod-service-close-time", "host close confirmation cannot precede its intent");
  }
  if (input.observation.kind === "host-result") {
    const hostResult = assertCloseHostResultMatchesAuthority(input, authority, intentSource);
    if (hostResult.status !== "machine-verified") {
      return frozen({
        status: hostResult.status === "manual-host-gate" ? "manual-host-gate" : "host-blocked",
        receipt: null,
        hostResultStatus: hostResult.status,
        resourceClaimStatus: authority.member.role === "product"
          ? authority.member.resourceClaimStatus
          : null,
      });
    }
    const receipt = provisionalCloseReceipt(input, authority, intentSource, recordedAt);
    const resourceClaimStatus = expectedClaimFromCloseReceipt(authority.member, receipt);
    return frozen({
      status: "receipt-ready",
      receipt,
      hostResultStatus: hostResult.status,
      resourceClaimStatus,
    });
  }
  const currentIdentity = authority.identityByWindow.get(authority.member.windowId) ?? null;
  if (authority.member.creationReceipt || currentIdentity !== null) {
    fail(
      "wakeflow-pod-service-close-observation",
      "unmaterialized not-found can close only a member without creation evidence or current identity",
      { windowId: authority.member.windowId },
    );
  }
  const receipt = provisionalCloseReceipt(input, authority, intentSource, recordedAt);
  const resourceClaimStatus = expectedClaimFromCloseReceipt(authority.member, receipt);
  return frozen({
    status: "receipt-ready",
    receipt,
    hostResultStatus: null,
    resourceClaimStatus,
  });
}

function closeObservationSessionStatus(input) {
  if (input.observation.kind === "unmaterialized-not-found") return "not-found";
  return input.observation.hostResult.session.status;
}

function closeObservationVerificationStatus(input, classification) {
  if (classification.receipt !== null) return classification.receipt.verificationStatus;
  return input.observation.hostResult.status;
}

function closeObservationResult(input, authority, intentSource, classification) {
  return frozen({
    kind: "WakeflowPodCloseObservation",
    schemaVersion: 1,
    status: classification.status,
    programId: authority.loaded.demand.programId,
    demandId: authority.loaded.demand.demandId,
    hostId: authority.loaded.state.pod.hostId,
    podId: authority.loaded.state.pod.podId,
    windowId: authority.member.windowId,
    role: authority.member.role,
    bindingId: authority.member.bindingId,
    closeOperationId: input.closeOperationId,
    closeIntentDigest: intentSource.digest,
    verificationStatus: closeObservationVerificationStatus(input, classification),
    ...(input.observation.hostResultDigest === null
      ? {}
      : { hostResultDigest: input.observation.hostResultDigest }),
    sessionStatus: closeObservationSessionStatus(input),
    worktreeStatus: input.observation.worktreeStatus,
    confirmedAt: input.observation.confirmedAt,
    ...(authority.member.role === "product"
      ? { resourceClaimStatus: classification.resourceClaimStatus }
      : {}),
    receiptWritable: classification.status === "receipt-ready",
    revision: authority.loaded.state.revision,
    stateDigest: authority.loaded.digests.state,
  });
}

// 校验宿主返回的关闭观察、当前claim与host capability，只在证据充分时派生可写receipt。
export function observePodCloseIntent(value = {}) {
  const input = normalizeCloseObserveInput(value);
  const config = loadConfig(input);
  const profile = currentPodProfile();
  try {
    return withStateRootLock(input.stateRoot, () => {
      const authority = loadCloseAuthorityWhileLocked(input, config, profile, {
        allowedExtraRefs: [],
      });
      if (authority.member.status !== "closing") {
        fail("wakeflow-pod-service-close-state", "host close observation requires one current closing member");
      }
      const intentSource = currentCloseIntentSource(input, authority);
      const classification = classifyCloseObservation(
        input,
        authority,
        intentSource,
        input.observation.confirmedAt,
      );
      return closeObservationResult(input, authority, intentSource, classification);
    });
  } catch (cause) {
    boundary("close-observation", cause, "Pod close observation failed closed");
  }
}

function buildCloseReceiptTransition(input, authority, receiptSource) {
  const previousPod = authority.loaded.state.pod;
  const nextPod = structuredClone(previousPod);
  const member = nextPod.windows.find((entry) => entry.windowId === input.windowId);
  member.status = "closed";
  member.close.receipt = { ref: receiptSource.ref, digest: receiptSource.digest };
  if (member.role === "product") {
    member.resourceClaimStatus = expectedClaimFromCloseReceipt(member, receiptSource.record);
  }
  nextPod.phase = nextPod.windows.every((entry) => entry.status === "closed")
    ? "closed"
    : "closing";
  delete nextPod.testAccess;
  const event = validateControllerEventRecord({
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: input.transition.eventId,
    demandId: authority.loaded.demand.demandId,
    createdAt: input.transition.createdAt,
    actor: "controller",
    command: "record-pod-close",
    type: "pod.close-recorded",
    previousRevision: authority.loaded.state.revision,
    nextRevision: authority.loaded.state.revision + 1,
    from: authority.loaded.state.state,
    to: authority.loaded.state.state,
    reason: input.transition.reason,
    decisionSummary: input.transition.decisionSummary,
    changedArtifacts: [],
    podTransition: {
      podId: nextPod.podId,
      action: "settle-close",
      windowId: input.windowId,
      closeOperationId: input.closeOperationId,
      previousPodDigest: canonicalJsonDigest(previousPod),
      nextPodDigest: canonicalJsonDigest(nextPod),
    },
  });
  const nextState = validateDemandStateRecord({
    ...authority.loaded.state,
    revision: event.nextRevision,
    stateReason: event.reason,
    updatedAt: event.createdAt,
    lastEvent: { eventId: event.eventId, eventDigest: canonicalJsonDigest(event) },
    pod: nextPod,
  });
  return { event, nextState };
}

function closeReceiptResult(status, authority, source) {
  const member = authority.member;
  return frozen({
    status,
    programId: authority.loaded.demand.programId,
    demandId: authority.loaded.demand.demandId,
    hostId: authority.loaded.state.pod.hostId,
    podId: authority.loaded.state.pod.podId,
    windowId: member.windowId,
    role: member.role,
    bindingId: member.bindingId,
    closeOperationId: member.close.closeOperationId,
    intent: member.close.intent,
    receipt: { ref: source.ref, digest: source.digest },
    sessionStatus: source.record.sessionStatus,
    verificationStatus: source.record.verificationStatus,
    ...(Object.hasOwn(source.record, "hostResultDigest")
      ? { hostResultDigest: source.record.hostResultDigest }
      : {}),
    worktreeStatus: source.record.worktreeStatus,
    ...(member.role === "product"
      ? { resourceClaimStatus: member.resourceClaimStatus }
      : {}),
    memberStatus: member.status,
    podPhase: authority.loaded.state.pod.phase,
    identityCleanupEligible: true,
    revision: authority.loaded.state.revision,
    stateDigest: authority.loaded.digests.state,
  });
}

function exactCloseReceiptReplay(input, authority) {
  const member = authority.member;
  if (member.status !== "closed" || !member.close?.receipt) return null;
  if (
    member.close.closeOperationId !== input.closeOperationId
    || member.close.intent.digest !== input.expectedIntentDigest
  ) {
    fail("wakeflow-pod-service-close-conflict", "close receipt replay selects a different close operation");
  }
  const intentSource = authority.podSource.recordsByRef.get(member.close.intent.ref) ?? null;
  const receiptSource = authority.podSource.recordsByRef.get(member.close.receipt.ref) ?? null;
  if (!intentSource || !receiptSource) {
    fail("wakeflow-pod-service-close-authority", "closed member lacks state-selected close evidence");
  }
  const classification = classifyCloseObservation(
    input,
    authority,
    intentSource,
    input.transition.createdAt,
  );
  if (classification.status !== "receipt-ready" || !same(receiptSource.record, classification.receipt)) {
    fail("wakeflow-pod-service-close-conflict", "close receipt replay differs from immutable evidence");
  }
  assertCloseReplayEvent(input, authority, "record-pod-close");
  return closeReceiptResult("replayed", authority, receiptSource);
}

function recoverExactCloseReceiptJournal(input, config, profile) {
  return recoverDemandPodTransitionWhileLocked({
    stateRoot: input.stateRoot,
    expectedProgramId: input.expectedProgramId,
    ledgerRoot: config.ledgerRoot,
    admitRecoveryWhileLocked: ({ loaded, journal }) => {
      if (
        journal.artifactWrites.length !== 0
        || journal.expectedPreviousRevision !== input.expectedPrevious.revision
        || journal.expectedPreviousStateDigest !== input.expectedPrevious.stateDigest
      ) {
        fail("wakeflow-pod-service-recovery-required", "pending close receipt journal differs from the requested state prefix");
      }
      const previousLoaded = {
        ...loaded,
        state: journal.previousState,
        digests: { ...loaded.digests, state: journal.expectedPreviousStateDigest },
      };
      const provisionalPodSource = scanPodInventory({
        workspaceRoot: input.workspaceRoot,
        expectedProgramId: input.expectedProgramId,
        hostId: profile.hostId,
      }).podById.get(journal.previousState.pod?.podId) ?? null;
      const desiredRef = provisionalPodSource
        ? closeReceiptRef(provisionalPodSource, input.closeOperationId)
        : null;
      const authority = closeAuthorityFromLoaded(input, config, profile, previousLoaded, {
        allowedExtraRefs: desiredRef === null ? [] : [desiredRef],
      });
      if (authority.member.status !== "closing") {
        fail("wakeflow-pod-service-recovery-required", "pending close receipt journal lacks its closing member");
      }
      const intentSource = currentCloseIntentSource(input, authority);
      const classification = classifyCloseObservation(
        input,
        authority,
        intentSource,
        input.transition.createdAt,
      );
      if (classification.status !== "receipt-ready") {
        fail(
          "wakeflow-pod-service-recovery-required",
          "a non-machine-verified host result cannot recover a receipt commit",
        );
      }
      const source = authority.podSource.recordsByRef.get(podRecordRef(classification.receipt)) ?? null;
      if (
        !source
        || source.digest !== podRecordDigest(classification.receipt)
        || !same(source.record, classification.receipt)
      ) {
        fail("wakeflow-pod-service-recovery-required", "pending close journal lacks exact immutable receipt evidence");
      }
      const transition = buildCloseReceiptTransition(input, authority, source);
      if (!same(journal.nextEvent, transition.event) || !same(journal.nextState, transition.nextState)) {
        fail("wakeflow-pod-service-recovery-required", "pending close receipt journal differs from the rederived transition");
      }
      return { admitted: true };
    },
  });
}

// 记录机器可验证或未物化not-found receipt，并确认到state后才允许后续identity cleanup。
export async function recordPodCloseReceipt(value = {}) {
  const input = normalizeCloseReceiptInput(value);
  const config = loadConfig(input);
  const profile = currentPodProfile();
  const tracker = {
    beforeStateDigest: null,
    nextStateDigest: null,
    evidenceRef: null,
    evidenceDigest: null,
  };
  try {
    return await withWakeflowRuntimeMutation({
      workspaceRoot: input.workspaceRoot,
      operationKind: "pod-close-receipt",
      domainOwner: "core-pod-service",
      ...(input.acquireTimeoutMs === undefined ? {} : { acquireTimeoutMs: input.acquireTimeoutMs }),
      onCallbackFailure: () => verifyCloseFailureClosure(input, tracker, "close-receipt"),
    }, (mutationContext) => withStateRootLock(input.stateRoot, () => {
      assertWakeflowMutationContext({
        workspaceRoot: input.workspaceRoot,
        context: mutationContext,
        mode: "runtime-mutation",
      });
      const currentConfig = loadConfig(input);
      if (currentConfig.configDigest !== config.configDigest) {
        fail("wakeflow-pod-service-stale", "config changed before close receipt commit");
      }
      const recovered = recoverExactCloseReceiptJournal(input, currentConfig, profile);
      let loaded = loadLocked(input, currentConfig);
      const currentPodSource = loaded.state.pod
        ? scanPodInventory({
            workspaceRoot: input.workspaceRoot,
            expectedProgramId: input.expectedProgramId,
            hostId: profile.hostId,
          }).podById.get(loaded.state.pod.podId) ?? null
        : null;
      const desiredRef = currentPodSource
        ? closeReceiptRef(currentPodSource, input.closeOperationId)
        : null;
      let authority = closeAuthorityFromLoaded(input, currentConfig, profile, loaded, {
        allowedExtraRefs: desiredRef === null ? [] : [desiredRef],
      });
      tracker.beforeStateDigest = authority.loaded.digests.state;
      const replay = exactCloseReceiptReplay(input, authority);
      if (replay !== null) {
        return recovered.status === "recovered"
          ? frozen({ ...replay, status: "recovered" })
          : replay;
      }
      assertExpectedPrevious(authority.loaded, input.expectedPrevious);
      if (authority.member.status !== "closing") {
        fail("wakeflow-pod-service-close-state", "close receipt requires one current closing member");
      }
      const intentSource = currentCloseIntentSource(input, authority);
      const classification = classifyCloseObservation(
        input,
        authority,
        intentSource,
        input.transition.createdAt,
      );
      if (classification.status !== "receipt-ready") {
        fail(
          classification.status === "manual-host-gate"
            ? "wakeflow-pod-service-close-manual-gate"
            : "wakeflow-pod-service-close-host-blocked",
          "a non-machine-verified host result requires resolution and cannot write a receipt",
        );
      }
      const desired = tuple(classification.receipt);
      tracker.evidenceRef = desired.ref;
      tracker.evidenceDigest = desired.digest;
      const present = authority.podSource.recordsByRef.get(desired.ref) ?? null;
      if (present && (present.digest !== desired.digest || !same(present.record, desired.record))) {
        fail("wakeflow-pod-service-close-conflict", "close receipt conflicts with immutable evidence");
      }
      ensureCloseTree(input, authority);
      ensureImmutableRecord(input.workspaceRoot, desired);
      authority = loadCloseAuthorityWhileLocked(input, currentConfig, profile, {
        allowedExtraRefs: [desired.ref],
      });
      const committed = authority.podSource.recordsByRef.get(desired.ref) ?? null;
      if (!committed || committed.digest !== desired.digest || !same(committed.record, desired.record)) {
        fail("wakeflow-pod-service-evidence-closure", "close receipt did not close immutable evidence");
      }
      const transition = buildCloseReceiptTransition(input, authority, committed);
      tracker.nextStateDigest = canonicalJsonDigest(transition.nextState);
      commitDemandPodTransitionWhileLocked({
        stateRoot: input.stateRoot,
        expectedProgramId: input.expectedProgramId,
        ledgerRoot: currentConfig.ledgerRoot,
        expectedPrevious: input.expectedPrevious,
        event: transition.event,
        nextState: transition.nextState,
      });
      authority = loadCloseAuthorityWhileLocked(input, currentConfig, profile);
      if (
        authority.loaded.digests.state !== tracker.nextStateDigest
        || authority.member.status !== "closed"
        || authority.member.close?.receipt.digest !== desired.digest
      ) {
        fail("wakeflow-pod-service-authority-closure", "close receipt did not close exact state authority");
      }
      return closeReceiptResult("recorded", authority, committed);
    }));
  } catch (cause) {
    boundary("close-receipt", cause, "Pod close receipt recording failed closed");
  }
}

function closeInspectionFromAuthority(authority) {
  const windows = authority.loaded.state.pod.windows.map((member) => {
    const identity = authority.identityByWindow.get(member.windowId) ?? null;
    const identityStatus = identity !== null
      ? "current"
      : member.creationReceipt
        ? "acknowledged-absent"
        : "not-created";
    return {
      windowId: member.windowId,
      role: member.role,
      bindingId: member.bindingId,
      status: member.status,
      ...(member.repositoryId ? { repositoryId: member.repositoryId } : {}),
      ...(member.resourceClaimStatus
        ? { resourceClaimStatus: member.resourceClaimStatus }
        : {}),
      ...(member.close
        ? {
            closeOperationId: member.close.closeOperationId,
            intent: member.close.intent,
            ...(member.close.receipt ? { receipt: member.close.receipt } : {}),
          }
        : {}),
      identityStatus,
      identityCleanupEligible: member.status === "closed" && identity !== null,
    };
  });
  const archiveEligible = authority.loaded.state.pod.phase === "closed"
    && windows.every((entry) => entry.status === "closed" && entry.receipt);
  return frozen({
    kind: "WakeflowPodCloseInspection",
    schemaVersion: 1,
    programId: authority.loaded.demand.programId,
    demandId: authority.loaded.demand.demandId,
    hostId: authority.loaded.state.pod.hostId,
    podId: authority.loaded.state.pod.podId,
    status: authority.loaded.state.pod.phase === "closed"
      ? "closed"
      : windows.some((entry) => ["closing", "closed"].includes(entry.status))
        ? "closing"
        : "open",
    authorityEligible: true,
    archiveEligible,
    podPhase: authority.loaded.state.pod.phase,
    windows,
    blockingReasons: archiveEligible ? [] : [{ code: "pod-close-incomplete" }],
    revision: authority.loaded.state.revision,
    stateDigest: authority.loaded.digests.state,
  });
}

// 在自己的state-root锁内投影每个窗口关闭闭包和整Pod archive eligibility；损坏输入降级为明确诊断。
export function inspectPodClose(value = {}) {
  const input = normalizeCloseInspectInput(value);
  try {
    const config = loadConfig(input);
    const profile = currentPodProfile();
    return withStateRootLock(input.stateRoot, () => closeInspectionFromAuthority(
      loadCloseAuthorityWhileLocked(input, config, profile),
    ));
  } catch (cause) {
    return frozen({
      kind: "WakeflowPodCloseInspection",
      schemaVersion: 1,
      programId: input.expectedProgramId,
      status: "damaged",
      authorityEligible: false,
      archiveEligible: false,
      windows: [],
      blockingReasons: [{
        code: typeof cause?.code === "string"
          ? cause.code
          : "wakeflow-pod-service-close-damaged",
      }],
    });
  }
}

// BusinessArchive已经持有state-root锁；该只读seam只抽取它加载快照中的既知字段，复用同一关闭reducer并避免重入死锁。
export function inspectPodCloseFromLoadedWhileLocked(value = {}) {
  exactKeys(value, [
    "workspaceRoot",
    "stateRoot",
    "expectedProgramId",
    "loaded",
  ], [], "locked Pod close inspection input");
  const input = normalizeCloseAuthorityInput({
    workspaceRoot: value.workspaceRoot,
    stateRoot: value.stateRoot,
    expectedProgramId: value.expectedProgramId,
  }, "locked Pod close inspection authority", { requireWindow: false });
  const loaded = canonicalLoadedCloseSnapshot(value.loaded);
  if (
    loaded.demand?.programId !== input.expectedProgramId
    || loaded.state?.programId !== input.expectedProgramId
    || path.resolve(loaded.paths?.stateRoot ?? "") !== input.stateRoot
  ) {
    fail(
      "wakeflow-pod-service-close-authority",
      "locked Pod close inspection requires the exact loaded state-root snapshot",
    );
  }
  const config = loadConfig(input);
  const profile = currentPodProfile();
  return closeInspectionFromAuthority(
    closeAuthorityFromLoaded(input, config, profile, loaded),
  );
}

function assertDecommissionAcknowledgement(input, authority) {
  if (
    authority.loaded.state.revision !== input.expectedAcknowledgedState.revision
    || authority.loaded.digests.state !== input.expectedAcknowledgedState.stateDigest
  ) {
    fail("wakeflow-pod-service-close-stale", "identity cleanup expected a different acknowledged Pod state");
  }
  const member = authority.member;
  if (
    member.status !== "closed"
    || member.close?.closeOperationId !== input.closeOperationId
    || member.close?.receipt?.digest !== input.expectedReceiptDigest
  ) {
    fail("wakeflow-pod-service-close-stale", "identity cleanup lacks its exact state-acknowledged close receipt");
  }
  const receipt = authority.podSource.recordsByRef.get(member.close.receipt.ref) ?? null;
  if (!receipt || receipt.digest !== input.expectedReceiptDigest) {
    fail("wakeflow-pod-service-close-authority", "identity cleanup receipt evidence is unavailable or changed");
  }
  return receipt;
}

function verifyCloseDecommissionFailure(input) {
  const config = loadConfig(input);
  const profile = currentPodProfile();
  return withStateRootLock(input.stateRoot, () => {
    const authority = loadCloseAuthorityWhileLocked(input, config, profile);
    const receipt = assertDecommissionAcknowledgement(input, authority);
    const identity = authority.identityByWindow.get(input.windowId) ?? null;
    return safeReleaseVerdict({
      operation: "closed-pod-window-binding-decommission",
      configDigest: config.configDigest,
      stateDigest: authority.loaded.digests.state,
      receiptDigest: receipt.digest,
      identityBindingDigest: identity?.identityBindingDigest ?? null,
    }, "pod-close-identity-decommission-closure");
  });
}

// 只有close receipt已被state确认后才退役对应binding；宿主资源关闭仍不由该清理步骤推断或执行。
export async function decommissionClosedPodWindowBinding(value = {}) {
  const input = normalizeCloseDecommissionInput(value);
  const config = loadConfig(input);
  const profile = currentPodProfile();
  try {
    return await withWakeflowRuntimeMutation({
      workspaceRoot: input.workspaceRoot,
      operationKind: "pod-close-identity-decommission",
      domainOwner: "core-pod-service",
      ...(input.acquireTimeoutMs === undefined ? {} : { acquireTimeoutMs: input.acquireTimeoutMs }),
      onCallbackFailure: () => verifyCloseDecommissionFailure(input),
    }, (mutationContext) => withStateRootLock(input.stateRoot, () => {
      assertWakeflowMutationContext({
        workspaceRoot: input.workspaceRoot,
        context: mutationContext,
        mode: "runtime-mutation",
      });
      const currentConfig = loadConfig(input);
      if (currentConfig.configDigest !== config.configDigest) {
        fail("wakeflow-pod-service-stale", "config changed before closed identity decommission");
      }
      let authority = loadCloseAuthorityWhileLocked(input, currentConfig, profile);
      const receipt = assertDecommissionAcknowledgement(input, authority);
      const identity = authority.identityByWindow.get(input.windowId) ?? null;
      if (identity === null) {
        return frozen({
          status: "replayed",
          programId: authority.loaded.demand.programId,
          demandId: authority.loaded.demand.demandId,
          hostId: authority.loaded.state.pod.hostId,
          podId: authority.loaded.state.pod.podId,
          windowId: input.windowId,
          bindingId: authority.member.bindingId,
          receipt: { ref: receipt.ref, digest: receipt.digest },
          identityStatus: "decommissioned",
          revision: authority.loaded.state.revision,
          stateDigest: authority.loaded.digests.state,
        });
      }
      if (
        identity.bindingId !== authority.member.bindingId
        || identity.identityBindingDigest !== authority.member.identityBindingDigest
      ) {
        fail("wakeflow-pod-service-close-stale", "current identity is a successor or differs from close authority");
      }
      decommissionPreauthorizedWindowBindingWithinMutation({
        workspaceRoot: input.workspaceRoot,
        expectedProgramId: input.expectedProgramId,
        expectedConfigDigest: currentConfig.configDigest,
        windowId: input.windowId,
        expectedBindingId: identity.bindingId,
        expectedBindingDigest: identity.identityBindingDigest,
        mutationContext,
      });
      authority = loadCloseAuthorityWhileLocked(input, currentConfig, profile);
      assertDecommissionAcknowledgement(input, authority);
      if (authority.identityByWindow.has(input.windowId)) {
        fail("wakeflow-pod-service-authority-closure", "closed Pod identity decommission did not settle to absence");
      }
      return frozen({
        status: "decommissioned",
        programId: authority.loaded.demand.programId,
        demandId: authority.loaded.demand.demandId,
        hostId: authority.loaded.state.pod.hostId,
        podId: authority.loaded.state.pod.podId,
        windowId: input.windowId,
        bindingId: authority.member.bindingId,
        receipt: { ref: receipt.ref, digest: receipt.digest },
        identityStatus: "decommissioned",
        revision: authority.loaded.state.revision,
        stateDigest: authority.loaded.digests.state,
      });
    }));
  } catch (cause) {
    boundary("close-identity-decommission", cause, "closed Pod identity decommission failed closed");
  }
}
