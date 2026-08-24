/**
 * 需求终态生命周期编排器。
 *
 * 本模块只组合 complete/cancel 所需的现有领域 owner，不建立第二状态机：
 *
 * - 输入与计划合同：关闭 transition、confirmed plan 及 apply/recover 输入，并绑定同一个事件和状态增量。
 * - Authority 读取：每次读取 strict config、canonical current demand、TargetResult 闭包和全量 coordination lease。
 * - 业务准入：complete 要求结果与 review 已闭合；cancel 只终结可变生命周期并保留 immutable 事实。
 * - 原子提交：复用 demand-state-service 的 lifecycle journal，在 state-root lock 内提交唯一 event/state 对。
 * - Lease effect：只在终态提交后，通过现有 lease owner 删除该 demand 的 exact state-selected lease。
 * - 失败闭包：在 workspace mutation gate 内区分未写入基线与已授权 effect，决定安全释放或前向恢复。
 *
 * TODO 创建、artifact/evidence 写入、review 决定、Pod 物理关闭、BusinessArchive 和 Active 投影均由各自
 * owner 负责；这里既不接管这些事实，也不把“完成需求”自动扩张为归档或资源清理。
 */
import path from "node:path";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import { loadWakeflowConfigV3Snapshot } from "./wakeflow-config-v3-snapshot.mjs";
import {
  validateControllerEventRecord,
  validateDemandStateRecord,
} from "./wakeflow-demand-core-records.mjs";
import {
  commitDemandLifecycleTransitionWhileLocked,
  loadDemandCoreRecordsWithArtifactClosure,
  loadDemandCoreRecordsWithArtifactClosureWhileLocked,
  recoverDemandLifecycleTransitionWhileLocked,
} from "./wakeflow-demand-state-service.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import { buildTargetResultAuthoritySnapshotFromLoaded } from "./wakeflow-target-result-authority.mjs";
import { assertWindowBindingId } from "./wakeflow-window-binding-records.mjs";
import {
  inspectWindowCoordinationLeaseInventory,
  releaseWindowCoordinationLeaseAdmitted,
} from "./wakeflow-window-lease-service.mjs";
import { assertWindowCoordinationLeaseId } from "./wakeflow-window-lease-records.mjs";
import { withStateRootLock } from "./wakeflow-state-lock.mjs";
import { withWakeflowRuntimeMutation } from "./wakeflow-workspace-mutation.mjs";

const PLAN_KIND = "WakeflowDemandLifecyclePlan";
const SCHEMA_VERSION = 1;
const ACTION_CONTRACTS = Object.freeze({
  complete: Object.freeze({ command: "complete-demand", type: "demand.completed", to: "completed" }),
  cancel: Object.freeze({ command: "cancel-demand", type: "demand.cancelled", to: "cancelled" }),
});
const TERMINAL_STATES = new Set(["archived", "cancelled", "completed"]);
const IDLE_REVIEW = Object.freeze({
  status: "idle",
  readyTargetTaskIds: Object.freeze([]),
  blockedTargetTaskIds: Object.freeze([]),
  missingTargetTaskIds: Object.freeze([]),
});
const TIMESTAMP_RE = /^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]{1,9})?Z$/u;
const HUMAN_CONTROL_RE = /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;

// ── 1. 领域错误与纯数据基础合同 ──────────────────────────────────────────────

/**
 * 对外稳定的生命周期编排错误；下层 cause 只通过受限 causeCode 进入 details。
 */
export class WakeflowDemandLifecycleOrchestrationError extends Error {
  constructor(code, message, { cause, ...details } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowDemandLifecycleOrchestrationError";
    this.code = code;
    this.details = Object.freeze({ code, ...details });
    if (cause !== undefined && this.cause === undefined) this.cause = cause;
  }
}

// 将本域失败统一收口为可识别错误，不改变原始 cause 链供内部诊断使用。
function fail(code, message, details = {}, cause = undefined) {
  throw new WakeflowDemandLifecycleOrchestrationError(code, message, {
    ...details,
    cause,
  });
}

// 把 config/state/lease 等相邻 owner 的错误压缩为生命周期边界错误。
function boundary(scope, cause, message) {
  if (cause instanceof WakeflowDemandLifecycleOrchestrationError) throw cause;
  fail(`wakeflow-demand-lifecycle-${scope}`, message, {
    causeCode: typeof cause?.code === "string" ? cause.code : null,
  }, cause);
}

// 递归冻结已经与调用方隔离的结果对象。
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

// structuredClone 先切断调用方引用，再冻结本域输出。
function frozen(value) {
  return deepFreeze(structuredClone(value));
}

// 这里只识别无数组、无外来原型的普通数据对象。
function isPlainObject(value) {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)),
  );
}

// 在字段读取前关闭 required/optional 集合和 enumerable data descriptor。
function exactKeys(value, required, optional, label) {
  if (!isPlainObject(value)) {
    fail("wakeflow-demand-lifecycle-contract", `${label} must be one plain data object`);
  }
  const allowed = new Set([...required, ...optional]);
  const keys = Reflect.ownKeys(value);
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  const unknown = keys.filter((key) => typeof key !== "string" || !allowed.has(key));
  if (missing.length > 0 || unknown.length > 0) {
    fail("wakeflow-demand-lifecycle-contract", `${label} has an invalid field set`, {
      missing,
      unknown: unknown.map(String),
    });
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-demand-lifecycle-contract", `${label}.${String(key)} must be an enumerable data field`);
    }
  }
  return value;
}

// 路径只做词法规范化；真实归属随后由 config/state owner 复验。
function normalizeRoot(value, label) {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    fail("wakeflow-demand-lifecycle-contract", `${label} is required`);
  }
  return path.resolve(value);
}

// typed ID、lease ID 和 binding ID 均复用各自现有 codec，不在编排层复制语法。
function typedId(value, type, label) {
  try {
    return assertWakeflowId(value, type, label);
  } catch (cause) {
    boundary("contract", cause, `${label} must be one typed ${type} ID`);
  }
}

// 机器事件/transport token 必须去首尾空白且不含控制字符。
function token(value, label) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value !== value.trim()
    || /[\u0000-\u001F\u007F-\u009F]/u.test(value)
  ) {
    fail("wakeflow-demand-lifecycle-contract", `${label} must be one trimmed control-free token`);
  }
  return value;
}

// Controller 原因与决定摘要允许正常换行以外的人类文本，但拒绝不可见控制字符。
function humanText(value, label) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value !== value.trim()
    || HUMAN_CONTROL_RE.test(value)
  ) {
    fail("wakeflow-demand-lifecycle-contract", `${label} must be non-empty trimmed human text`);
  }
  return value;
}

// 严格 UTC 时间同时校验词法格式与真实日历日期，拒绝 Date 的自动进位。
function timestamp(value, label) {
  if (typeof value !== "string" || !TIMESTAMP_RE.test(value) || Number.isNaN(Date.parse(value))) {
    fail("wakeflow-demand-lifecycle-contract", `${label} must be one strict UTC timestamp`);
  }
  const parsed = new Date(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/u.exec(value);
  if (
    !match
    || parsed.getUTCFullYear() !== Number(match[1])
    || parsed.getUTCMonth() + 1 !== Number(match[2])
    || parsed.getUTCDate() !== Number(match[3])
    || parsed.getUTCHours() !== Number(match[4])
    || parsed.getUTCMinutes() !== Number(match[5])
    || parsed.getUTCSeconds() !== Number(match[6])
  ) {
    fail("wakeflow-demand-lifecycle-contract", `${label} is not a real UTC calendar instant`);
  }
  return value;
}

// Plan 中所有 authority 身份都使用带算法前缀的 lowercase sha256。
function digest(value, label) {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    fail("wakeflow-demand-lifecycle-contract", `${label} must be one sha256 digest`);
  }
  return value;
}

// Coordination lease ID 仍由 lease records owner 解释。
function leaseId(value, label) {
  try {
    return assertWindowCoordinationLeaseId(value, label);
  } catch (cause) {
    boundary("contract", cause, `${label} must be one typed coordination lease ID`);
  }
}

// Binding ID 仍由 window binding records owner 解释。
function bindingId(value, label) {
  try {
    return assertWindowBindingId(value, label);
  } catch (cause) {
    boundary("contract", cause, `${label} must be one typed window binding ID`);
  }
}

// canonical JSON 相等用于比较完整 authority/plan，而不是对象引用。
function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

// Durable plan 顺序使用 Unicode code-unit，不依赖机器 locale。
function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * 在任一公开入口读取字段前复制严格 JSON 数据，拒绝 accessor、symbol、稀疏数组和隐藏字段。
 */
function canonicalLifecycleInput(value, label) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (cause) {
    boundary("contract", cause, `${label} must be exact canonical data`);
  }
}

// ── 2. Preview/apply 输入规范化 ───────────────────────────────────────────────

// Transition 只携带 Controller 已决定的事件身份、时间和两段人类说明。
function normalizeTransition(value) {
  exactKeys(
    value,
    ["eventId", "createdAt", "reason", "decisionSummary"],
    [],
    "transition",
  );
  return frozen({
    eventId: token(value.eventId, "transition.eventId"),
    createdAt: timestamp(value.createdAt, "transition.createdAt"),
    reason: humanText(value.reason, "transition.reason"),
    decisionSummary: humanText(value.decisionSummary, "transition.decisionSummary"),
  });
}

/**
 * 关闭 preview 输入；action 只选择 complete 或 cancel，不接受通用状态目标。
 */
function normalizePlanInput(value) {
  exactKeys(
    value,
    ["workspaceRoot", "stateRoot", "expectedProgramId", "action", "transition"],
    [],
    "planDemandLifecycleTransition input",
  );
  if (!Object.hasOwn(ACTION_CONTRACTS, value.action)) {
    fail("wakeflow-demand-lifecycle-contract", "action must be complete or cancel");
  }
  return frozen({
    workspaceRoot: normalizeRoot(value.workspaceRoot, "workspaceRoot"),
    stateRoot: normalizeRoot(value.stateRoot, "stateRoot"),
    expectedProgramId: typedId(value.expectedProgramId, "program", "expectedProgramId"),
    action: value.action,
    transition: normalizeTransition(value.transition),
  });
}

// ── 3. 当前 authority 读取 ────────────────────────────────────────────────────

/**
 * 每次操作重读 strict v3 config，并用 expectedProgramId 证明当前程序归属。
 */
function loadConfig(input) {
  let config;
  try {
    config = loadWakeflowConfigV3Snapshot({ workspaceRoot: input.workspaceRoot });
  } catch (cause) {
    boundary("config", cause, "strict Wakeflow v3 config is unavailable");
  }
  if (config.model.program.programId !== input.expectedProgramId) {
    fail("wakeflow-demand-lifecycle-config", "expectedProgramId does not own wakeflow.config.json");
  }
  return config;
}

/**
 * 读取完整 demand/core/artifact 闭包，并证明 stateRoot 正是 workspace 当前 demand 的 canonical root。
 * whileLocked 仅切换到已持有 state lock 的 reader，不改变状态语义。
 */
function loadState(input, config, { whileLocked = false } = {}) {
  try {
    const load = whileLocked
      ? loadDemandCoreRecordsWithArtifactClosureWhileLocked
      : loadDemandCoreRecordsWithArtifactClosure;
    const loaded = load({
      stateRoot: input.stateRoot,
      expectedProgramId: input.expectedProgramId,
      ledgerRoot: config.ledgerRoot,
    });
    const expectedStateRoot = path.join(
      input.workspaceRoot,
      ".wakeflow-active",
      "current",
      loaded.demand.demandId,
    );
    if (path.resolve(loaded.paths.stateRoot) !== expectedStateRoot) {
      fail("wakeflow-demand-lifecycle-state", "stateRoot is not the canonical current demand root");
    }
    return loaded;
  } catch (cause) {
    boundary("state", cause, "strict demand state authority is unavailable");
  }
}

// Lease inventory 始终由 T05 owner 严格读取；本模块不直接扫描 lease 文件。
function loadLeases(input) {
  try {
    return inspectWindowCoordinationLeaseInventory({ workspaceRoot: input.workspaceRoot });
  } catch (cause) {
    boundary("lease", cause, "strict coordination lease authority is unavailable");
  }
}

// ── 4. 终态准入与计划构造 ────────────────────────────────────────────────────

// 证明一份物理 lease 正是某 TargetTask 当前 delivery 在 state 中选中的 tuple。
function exactCurrentLeaseForTask(task, entry) {
  const delivery = task.currentDelivery;
  return Boolean(
    delivery
    && task.windowId === entry.lease.windowId
    && delivery.lease.leaseId === entry.lease.leaseId
    && delivery.lease.ref === entry.leaseRef
    && delivery.lease.digest === entry.lease.leaseDigest
    && delivery.envelope.deliveryId === entry.lease.deliveryId
    && delivery.envelope.digest === entry.lease.envelopeDigest
  );
}

/**
 * 从全量 lease authority 中选择本 demand 的 exact state-bound release 集合，并按 windowId 规范排序。
 */
function demandLeaseReleases(loaded, leases) {
  const taskById = new Map(loaded.state.targetTasks.map((task) => [task.targetTaskId, task]));
  return leases.leases
    .filter((entry) => entry.lease.demandId === loaded.demand.demandId)
    .map((entry) => {
      const task = taskById.get(entry.lease.targetTaskId);
      if (!task || !exactCurrentLeaseForTask(task, entry)) {
        fail(
          "wakeflow-demand-lifecycle-lease",
          "a matching demand lease is not the exact current state delivery authority",
        );
      }
      return {
        windowId: entry.lease.windowId,
        leaseId: entry.lease.leaseId,
        deliveryId: entry.lease.deliveryId,
        bindingId: entry.lease.bindingId,
        leaseDigest: entry.lease.leaseDigest,
      };
    })
    .sort((left, right) => lexicalCompare(left.windowId, right.windowId));
}

/**
 * complete 的额外业务门：review 必须 idle、无未释放 lease、工作与结果均已诚实闭合。
 * 无目标任务的捷径只对零 artifact research demand 成立。
 */
function assertCompletionAdmission(loaded, resultAuthority, releases) {
  if (!same(loaded.state.review, IDLE_REVIEW)) {
    fail("wakeflow-demand-lifecycle-complete", "completion requires idle review authority");
  }
  if (releases.length !== 0) {
    fail("wakeflow-demand-lifecycle-complete", "completion cannot retain a target coordination lease");
  }
  if (loaded.state.targetTasks.length === 0) {
    if (
      loaded.demand.demandType !== "research"
      || loaded.state.taskPackages.length !== 0
      || loaded.state.testCards.length !== 0
    ) {
      fail(
        "wakeflow-demand-lifecycle-complete",
        "only a zero-artifact research demand may complete without target tasks",
      );
    }
    return;
  }
  const artifactById = new Map(resultAuthority.artifacts.map((entry) => [entry.targetResultId, entry]));
  for (const task of loaded.state.targetTasks) {
    if (!["accepted", "superseded"].includes(task.lifecycleStatus)) {
      fail("wakeflow-demand-lifecycle-complete", "every target task must be accepted or superseded");
    }
    if (task.lifecycleStatus === "accepted") {
      const selected = task.currentResult
        ? artifactById.get(task.currentResult.targetResultId)
        : null;
      if (
        !selected
        || selected.lifecycleStatus !== "current"
        || selected.record.outcome === "blocked"
      ) {
        fail(
          "wakeflow-demand-lifecycle-complete",
          "every accepted target task must select one current non-blocked TargetResult",
        );
      }
    }
  }
  if (loaded.state.taskPackages.some((entry) => !["closed", "superseded"].includes(entry.lifecycleStatus))) {
    fail("wakeflow-demand-lifecycle-complete", "every task package must be closed or superseded");
  }
  if (loaded.state.testCards.some((entry) => !["closed", "superseded"].includes(entry.lifecycleStatus))) {
    fail("wakeflow-demand-lifecycle-complete", "every TestCard must be closed or superseded");
  }
}

// cancel 保留 accepted/cancelled/superseded 结论，只终结仍开放的 TargetTask。
function cancelledTask(task) {
  const next = structuredClone(task);
  if (!["accepted", "cancelled", "superseded"].includes(next.lifecycleStatus)) {
    next.lifecycleStatus = "cancelled";
  }
  return next;
}

// cancel 只把 active package/TestCard 关闭，历史 closed/superseded 保持原样。
function closedArtifact(entry) {
  const next = structuredClone(entry);
  if (next.lifecycleStatus === "active") next.lifecycleStatus = "closed";
  return next;
}

/**
 * 从已验证当前状态构造唯一 lifecycle event 与 nextState；它不写盘，也不创建 immutable artifact。
 */
function buildEventAndState(input, loaded) {
  const contract = ACTION_CONTRACTS[input.action];
  const event = validateControllerEventRecord({
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: input.transition.eventId,
    demandId: loaded.demand.demandId,
    createdAt: input.transition.createdAt,
    actor: "controller",
    command: contract.command,
    type: contract.type,
    previousRevision: loaded.state.revision,
    nextRevision: loaded.state.revision + 1,
    from: loaded.state.state,
    to: contract.to,
    reason: input.transition.reason,
    decisionSummary: input.transition.decisionSummary,
    changedArtifacts: [],
    lifecycleTransition: { action: input.action },
  });
  const nextState = structuredClone(loaded.state);
  nextState.revision = event.nextRevision;
  nextState.state = event.to;
  nextState.stateReason = event.reason;
  nextState.updatedAt = event.createdAt;
  nextState.review = structuredClone(IDLE_REVIEW);
  if (input.action === "cancel") {
    nextState.targetTasks = nextState.targetTasks.map(cancelledTask);
    nextState.taskPackages = nextState.taskPackages.map(closedArtifact);
    nextState.testCards = nextState.testCards.map(closedArtifact);
  }
  nextState.lastEvent = {
    eventId: event.eventId,
    eventDigest: canonicalJsonDigest(event),
  };
  return frozen({ event, nextState: validateDemandStateRecord(nextState) });
}

// Plan 只冻结提交 CAS 所需的上一版 state/event tail，不复制完整历史。
function sourceStateTuple(loaded) {
  return {
    revision: loaded.state.revision,
    digest: loaded.digests.state,
    eventId: loaded.state.lastEvent.eventId,
    eventDigest: loaded.state.lastEvent.eventDigest,
  };
}

/**
 * 生成零写、portable 的 confirmed plan，绑定 config、demand、result authority、lease inventory 与状态增量。
 */
function buildPlan(input, config, loaded, leases) {
  if (TERMINAL_STATES.has(loaded.state.state)) {
    fail("wakeflow-demand-lifecycle-terminal", "demand is already terminal");
  }
  if (loaded.events.some((event) => event.eventId === input.transition.eventId)) {
    fail("wakeflow-demand-lifecycle-conflict", "transition eventId is already committed");
  }
  let resultAuthority;
  try {
    resultAuthority = buildTargetResultAuthoritySnapshotFromLoaded(loaded);
  } catch (cause) {
    boundary("result", cause, "TargetResult authority is not closed");
  }
  const releases = demandLeaseReleases(loaded, leases);
  if (input.action === "complete") {
    assertCompletionAdmission(loaded, resultAuthority, releases);
  }
  const transition = buildEventAndState(input, loaded);
  const unsigned = {
    kind: PLAN_KIND,
    schemaVersion: SCHEMA_VERSION,
    programId: input.expectedProgramId,
    demandId: loaded.demand.demandId,
    action: input.action,
    config: { ref: config.ref, digest: config.configDigest },
    demand: { ref: "demand.json", digest: loaded.digests.demand },
    sourceState: sourceStateTuple(loaded),
    resultAuthorityDigest: canonicalJsonDigest(resultAuthority),
    leaseInventoryDigest: leases.inventoryDigest,
    leaseReleases: releases,
    transition: input.transition,
    event: transition.event,
    nextState: transition.nextState,
  };
  return frozen({ ...unsigned, planDigest: canonicalJsonDigest(unsigned) });
}

// ── 5. Confirmed plan 闭包 ────────────────────────────────────────────────────

/**
 * 关闭完整 plan 的字段、类型、规范顺序、交叉引用和 digest。
 * 调用方自行重算 planDigest 不会绕过 action→event→nextState 的同一转换关系。
 */
function validatePlan(value) {
  exactKeys(value, [
    "kind",
    "schemaVersion",
    "programId",
    "demandId",
    "action",
    "config",
    "demand",
    "sourceState",
    "resultAuthorityDigest",
    "leaseInventoryDigest",
    "leaseReleases",
    "transition",
    "event",
    "nextState",
    "planDigest",
  ], [], "lifecycle plan");
  if (value.kind !== PLAN_KIND || value.schemaVersion !== SCHEMA_VERSION) {
    fail("wakeflow-demand-lifecycle-plan", "lifecycle plan kind or schemaVersion is invalid");
  }
  typedId(value.programId, "program", "plan.programId");
  typedId(value.demandId, "demand", "plan.demandId");
  if (!Object.hasOwn(ACTION_CONTRACTS, value.action)) {
    fail("wakeflow-demand-lifecycle-plan", "lifecycle plan action is invalid");
  }
  exactKeys(value.config, ["ref", "digest"], [], "plan.config");
  exactKeys(value.demand, ["ref", "digest"], [], "plan.demand");
  exactKeys(value.sourceState, ["revision", "digest", "eventId", "eventDigest"], [], "plan.sourceState");
  if (value.config.ref !== "wakeflow.config.json" || value.demand.ref !== "demand.json") {
    fail("wakeflow-demand-lifecycle-plan", "lifecycle plan refs are not canonical");
  }
  for (const [label, valueDigest] of [
    ["config.digest", value.config.digest],
    ["demand.digest", value.demand.digest],
    ["sourceState.digest", value.sourceState.digest],
    ["sourceState.eventDigest", value.sourceState.eventDigest],
    ["resultAuthorityDigest", value.resultAuthorityDigest],
    ["leaseInventoryDigest", value.leaseInventoryDigest],
    ["planDigest", value.planDigest],
  ]) digest(valueDigest, `plan.${label}`);
  if (!Number.isInteger(value.sourceState.revision) || value.sourceState.revision < 1) {
    fail("wakeflow-demand-lifecycle-plan", "plan.sourceState.revision is invalid");
  }
  token(value.sourceState.eventId, "plan.sourceState.eventId");
  normalizeTransition(value.transition);
  validateControllerEventRecord(value.event);
  validateDemandStateRecord(value.nextState);
  if (!Array.isArray(value.leaseReleases)) {
    fail("wakeflow-demand-lifecycle-plan", "plan.leaseReleases must be an array");
  }
  const releases = value.leaseReleases.map((entry, index) => {
    exactKeys(
      entry,
      ["windowId", "leaseId", "deliveryId", "bindingId", "leaseDigest"],
      [],
      `plan.leaseReleases[${index}]`,
    );
    typedId(entry.windowId, "window", `plan.leaseReleases[${index}].windowId`);
    leaseId(entry.leaseId, `plan.leaseReleases[${index}].leaseId`);
    bindingId(entry.bindingId, `plan.leaseReleases[${index}].bindingId`);
    token(entry.deliveryId, `plan.leaseReleases[${index}].deliveryId`);
    digest(entry.leaseDigest, `plan.leaseReleases[${index}].leaseDigest`);
    return entry;
  });
  const sorted = [...releases].sort((left, right) => lexicalCompare(left.windowId, right.windowId));
  if (!same(releases, sorted) || new Set(releases.map((entry) => entry.windowId)).size !== releases.length) {
    fail("wakeflow-demand-lifecycle-plan", "plan.leaseReleases must be canonical and window-unique");
  }
  const contract = ACTION_CONTRACTS[value.action];
  const eventDigest = canonicalJsonDigest(value.event);
  if (
    value.event.demandId !== value.demandId
    || value.event.command !== contract.command
    || value.event.type !== contract.type
    || value.event.to !== contract.to
    || value.event.lifecycleTransition.action !== value.action
    || value.event.eventId !== value.transition.eventId
    || value.event.createdAt !== value.transition.createdAt
    || value.event.reason !== value.transition.reason
    || value.event.decisionSummary !== value.transition.decisionSummary
    || value.event.previousRevision !== value.sourceState.revision
    || value.event.nextRevision !== value.sourceState.revision + 1
    || value.nextState.programId !== value.programId
    || value.nextState.demandId !== value.demandId
    || value.nextState.demandRef !== value.demand.ref
    || value.nextState.demandDigest !== value.demand.digest
    || value.nextState.revision !== value.event.nextRevision
    || value.nextState.state !== value.event.to
    || value.nextState.stateReason !== value.event.reason
    || value.nextState.updatedAt !== value.event.createdAt
    || value.nextState.lastEvent.eventId !== value.event.eventId
    || value.nextState.lastEvent.eventDigest !== eventDigest
  ) {
    fail("wakeflow-demand-lifecycle-plan", "lifecycle plan fields do not form one exact transition");
  }
  const unsigned = structuredClone(value);
  delete unsigned.planDigest;
  if (value.planDigest !== canonicalJsonDigest(unsigned)) {
    fail("wakeflow-demand-lifecycle-plan", "planDigest differs from exact plan bytes");
  }
  return frozen(value);
}

/**
 * 关闭 apply/recover 的调用身份，并要求外层 planDigest 与内层 confirmed plan 完全相同。
 */
function normalizeApplyInput(value) {
  exactKeys(
    value,
    ["workspaceRoot", "stateRoot", "expectedProgramId", "plan", "planDigest"],
    [],
    "lifecycle apply input",
  );
  const input = {
    workspaceRoot: normalizeRoot(value.workspaceRoot, "workspaceRoot"),
    stateRoot: normalizeRoot(value.stateRoot, "stateRoot"),
    expectedProgramId: typedId(value.expectedProgramId, "program", "expectedProgramId"),
    plan: validatePlan(value.plan),
    planDigest: digest(value.planDigest, "planDigest"),
  };
  if (
    input.planDigest !== input.plan.planDigest
    || input.plan.programId !== input.expectedProgramId
  ) {
    fail("wakeflow-demand-lifecycle-plan", "apply identity does not match the confirmed lifecycle plan");
  }
  return frozen(input);
}

// 非终态 apply 会用 confirmed plan 的 action/transition 重建当前 expected plan。
function planInputFromApply(input) {
  return frozen({
    workspaceRoot: input.workspaceRoot,
    stateRoot: input.stateRoot,
    expectedProgramId: input.expectedProgramId,
    action: input.plan.action,
    transition: input.plan.transition,
  });
}

// ── 6. Replay 身份与 lease effect 授权 ────────────────────────────────────────

/**
 * 查找同一 eventId 的 exact committed event；只承认其终态或后续 archived 兼容状态。
 */
function exactCommittedEvent(loaded, plan) {
  const matches = loaded.events.filter((event) => event.eventId === plan.event.eventId);
  if (matches.length === 0) return null;
  if (matches.length !== 1 || !same(matches[0], plan.event)) {
    fail("wakeflow-demand-lifecycle-conflict", "lifecycle eventId is committed with different intent");
  }
  if (![plan.event.to, "archived"].includes(loaded.state.state)) {
    fail("wakeflow-demand-lifecycle-conflict", "committed lifecycle event no longer owns a compatible demand state");
  }
  return matches[0];
}

// Release key 只包含 lease owner 执行 compare-and-delete 所需的精确身份。
function releaseKey(value) {
  return canonicalJson({
    windowId: value.windowId,
    leaseId: value.leaseId,
    deliveryId: value.deliveryId,
    bindingId: value.bindingId,
    leaseDigest: value.leaseDigest,
  });
}

// Plan 必须属于本次加载的 immutable demand/program 身份，不能跨 stateRoot 复用。
function assertPlanDemandAuthority(loaded, plan) {
  if (
    loaded.demand.programId !== plan.programId
    || loaded.demand.demandId !== plan.demandId
    || loaded.digests.demand !== plan.demand.digest
  ) {
    fail("wakeflow-demand-lifecycle-plan", "lifecycle plan does not belong to the loaded demand authority");
  }
}

/**
 * 即使 terminal event 已提交，plan 中每个 destructive release 仍必须回绑某个唯一 state-selected delivery。
 */
function assertPlannedLeaseStateAuthority(loaded, releases) {
  for (const expected of releases) {
    const matches = loaded.state.targetTasks.filter((task) => {
      const delivery = task.currentDelivery;
      return Boolean(
        delivery
        && task.windowId === expected.windowId
        && delivery.lease.leaseId === expected.leaseId
        && delivery.lease.digest === expected.leaseDigest
        && delivery.envelope.deliveryId === expected.deliveryId
      );
    });
    if (matches.length !== 1) {
      fail(
        "wakeflow-demand-lifecycle-lease",
        "planned lease release is not the exact state-selected delivery authority",
      );
    }
  }
}

/**
 * 在任何 lease 删除前同时关闭三件事：plan 属于当前 demand、没有遗漏当前 demand lease、现存 tuple
 * 与计划精确一致。只有三者成立才把 tracker 标为允许失败时前向完成该 effect。
 */
function admitPlannedLeaseReleases(input, loaded, leases, tracker) {
  assertPlanDemandAuthority(loaded, input.plan);
  assertPlannedLeaseStateAuthority(loaded, input.plan.leaseReleases);
  const plannedKeys = new Set(input.plan.leaseReleases.map(releaseKey));
  for (const current of demandLeaseReleases(loaded, leases)) {
    if (!plannedKeys.has(releaseKey(current))) {
      fail(
        "wakeflow-demand-lifecycle-lease",
        "confirmed lifecycle plan omits one current demand lease",
      );
    }
  }
  for (const expected of input.plan.leaseReleases) {
    const current = leases.leases.find((entry) => entry.lease.windowId === expected.windowId);
    if (current && releaseKey(current.lease) !== releaseKey(expected)) {
      fail(
        "wakeflow-demand-lifecycle-lease",
        "planned lease release differs from the current lease authority",
      );
    }
  }
  tracker.leaseReleaseAdmitted = true;
}

/**
 * 通过现有 lease owner 逐项执行 compare-and-delete；已删除项是幂等 no-op，successor 或异主 tuple 拒绝。
 */
function releasePlannedLeases(input, loaded, mutationContext) {
  assertPlanDemandAuthority(loaded, input.plan);
  assertPlannedLeaseStateAuthority(loaded, input.plan.leaseReleases);
  for (const expected of input.plan.leaseReleases) {
    const inventory = loadLeases(input);
    const current = inventory.leases.find((entry) => entry.lease.windowId === expected.windowId);
    if (!current) continue;
    if (releaseKey(current.lease) !== releaseKey(expected)) {
      fail("wakeflow-demand-lifecycle-lease", "planned lease was replaced before exact cancellation release");
    }
    const result = releaseWindowCoordinationLeaseAdmitted({
      workspaceRoot: input.workspaceRoot,
      ...expected,
      mutationContext,
    });
    if (result.outcome !== "success") {
      fail("wakeflow-demand-lifecycle-lease", result.message, result.details);
    }
  }
  const after = loadLeases(input);
  if (after.leases.some((entry) => entry.lease.demandId === input.plan.demandId)) {
    fail("wakeflow-demand-lifecycle-lease", "demand cancellation left a matching coordination lease");
  }
  return after;
}

/**
 * 首次 apply 在写入前从当前 authority 重建整份 plan；任一 config/state/result/lease 漂移都会变 stale。
 */
function exactPlanFromCurrent(input, config, loaded, leases) {
  const expected = buildPlan(planInputFromApply(input), config, loaded, leases);
  if (!same(expected, input.plan)) {
    fail("wakeflow-demand-lifecycle-stale-plan", "lifecycle plan is stale against current authority");
  }
  return expected;
}

// Workspace mutation gate 只接受带 closure digest 的明确安全释放判定。
function safeReleaseVerdict(name, value) {
  return {
    disposition: "safe-to-release",
    closureDigests: [{ name, digest: canonicalJsonDigest(value) }],
  };
}

// 失败闭包期望只移除 plan 中已经被准入的 lease，所有无关基线项必须保持不变。
function remainingAfterPlannedReleases(baseline, plan) {
  const releaseKeys = new Set(plan.leaseReleases.map(releaseKey));
  return baseline.leases.filter((entry) => !releaseKeys.has(releaseKey(entry.lease)));
}

// ── 7. Mutation failure 闭包与 journal 恢复 ──────────────────────────────────

/**
 * callback 失败后在同一 state lock 下收敛 exact lifecycle journal，并区分：
 *
 * - effect 尚未获准：只接受 state/events/leases 与 prewrite baseline 完全不变；
 * - effect 已获准且 event 已提交：允许前向完成计划内 lease 删除；
 * - 其他组合：保留 workspace mutation recovery evidence，禁止宣称安全释放。
 */
function verifyFailureClosure(input, config, tracker, mutationContext) {
  if (!tracker.baseline) {
    fail("wakeflow-demand-lifecycle-recovery-required", "lifecycle failure has no exact prewrite baseline");
  }
  return withStateRootLock(input.stateRoot, () => {
    recoverDemandLifecycleTransitionWhileLocked({
      stateRoot: input.stateRoot,
      expectedProgramId: input.expectedProgramId,
      ledgerRoot: config.ledgerRoot,
      admitRecoveryWhileLocked: ({ journal }) => {
        if (
          !same(journal.nextEvent, input.plan.event)
          || !same(journal.nextState, input.plan.nextState)
          || journal.artifactWrites.length !== 0
        ) {
          fail("wakeflow-demand-lifecycle-recovery-required", "pending journal is not the confirmed lifecycle plan");
        }
        return { admitted: true };
      },
    });
    const loaded = loadState(input, config, { whileLocked: true });
    const committed = exactCommittedEvent(loaded, input.plan);
    if (committed && tracker.leaseReleaseAdmitted) {
      releasePlannedLeases(input, loaded, mutationContext);
    }
    const leases = loadLeases(input);
    const stateUnchanged = (
      loaded.digests.state === tracker.baseline.stateDigest
      && canonicalJsonDigest(loaded.events) === tracker.baseline.eventsDigest
    );
    if (!stateUnchanged && !committed) {
      fail("wakeflow-demand-lifecycle-recovery-required", "lifecycle failure is neither unchanged nor exact committed state");
    }
    const expectedLeases = stateUnchanged
      ? tracker.baseline.leases.leases
      : remainingAfterPlannedReleases(tracker.baseline.leases, input.plan);
    if (!same(leases.leases, expectedLeases)) {
      fail("wakeflow-demand-lifecycle-recovery-required", "lifecycle failure changed an unrelated or successor lease");
    }
    return safeReleaseVerdict("demand-lifecycle-authority-closure", {
      state: stateUnchanged ? "unchanged" : "committed",
      stateDigest: loaded.digests.state,
      eventsDigest: canonicalJsonDigest(loaded.events),
      leaseDigest: leases.inventoryDigest,
    });
  });
}

// ── 8. 持锁 apply/recover 主链 ────────────────────────────────────────────────

/**
 * 在 state-root lock 内执行 journal recovery、baseline 捕获、replay 或首次 commit，并在终态可见后释放 lease。
 */
function applyWhileLocked(input, config, mutationContext, tracker, recoveryMode) {
  recoverDemandLifecycleTransitionWhileLocked({
    stateRoot: input.stateRoot,
    expectedProgramId: input.expectedProgramId,
    ledgerRoot: config.ledgerRoot,
    admitRecoveryWhileLocked: ({ journal }) => {
      if (
        !same(journal.nextEvent, input.plan.event)
        || !same(journal.nextState, input.plan.nextState)
        || journal.artifactWrites.length !== 0
      ) {
        fail("wakeflow-demand-lifecycle-recovery-required", "pending lifecycle journal differs from confirmed plan");
      }
      return { admitted: true };
    },
  });
  const loaded = loadState(input, config, { whileLocked: true });
  const leases = loadLeases(input);
  tracker.baseline = frozen({
    stateDigest: loaded.digests.state,
    eventsDigest: canonicalJsonDigest(loaded.events),
    leases,
  });
  assertPlanDemandAuthority(loaded, input.plan);
  const replay = exactCommittedEvent(loaded, input.plan);
  if (replay) {
    admitPlannedLeaseReleases(input, loaded, leases, tracker);
    const afterLeases = releasePlannedLeases(input, loaded, mutationContext);
    return frozen({
      status: recoveryMode ? "recovered" : "replayed",
      action: input.plan.action,
      demandId: input.plan.demandId,
      eventId: replay.eventId,
      revision: loaded.state.revision,
      stateDigest: loaded.digests.state,
      leaseInventoryDigest: afterLeases.inventoryDigest,
      releasedLeaseCount: input.plan.leaseReleases.length,
    });
  }
  exactPlanFromCurrent(input, config, loaded, leases);
  admitPlannedLeaseReleases(input, loaded, leases, tracker);
  commitDemandLifecycleTransitionWhileLocked({
    stateRoot: input.stateRoot,
    expectedProgramId: input.expectedProgramId,
    ledgerRoot: config.ledgerRoot,
    expectedPrevious: {
      revision: loaded.state.revision,
      stateDigest: loaded.digests.state,
    },
    event: input.plan.event,
    nextState: input.plan.nextState,
  });
  const afterState = loadState(input, config, { whileLocked: true });
  const committed = exactCommittedEvent(afterState, input.plan);
  if (!committed) {
    fail("wakeflow-demand-lifecycle-closure", "lifecycle commit did not become exact state authority");
  }
  const afterLeases = releasePlannedLeases(input, afterState, mutationContext);
  return frozen({
    status: recoveryMode ? "recovered" : "applied",
    action: input.plan.action,
    demandId: input.plan.demandId,
    eventId: committed.eventId,
    revision: afterState.state.revision,
    stateDigest: afterState.digests.state,
    leaseInventoryDigest: afterLeases.inventoryDigest,
    releasedLeaseCount: input.plan.leaseReleases.length,
  });
}

/**
 * 取得唯一 workspace runtime mutation gate，连接 state lock 主链与失败闭包。
 * config digest 在进 gate 前复验；领域 authority 仍在 gate/lock 内重读。
 */
async function runApply(input, { recoveryMode }) {
  const config = loadConfig(input);
  if (
    config.ref !== input.plan.config.ref
    || config.configDigest !== input.plan.config.digest
  ) {
    fail("wakeflow-demand-lifecycle-stale-plan", "config changed after lifecycle preview");
  }
  const tracker = { baseline: null, leaseReleaseAdmitted: false };
  let currentMutationContext = null;
  try {
    return await withWakeflowRuntimeMutation({
      workspaceRoot: input.workspaceRoot,
      operationKind: recoveryMode ? "demand-lifecycle-recovery" : "demand-lifecycle-apply",
      domainOwner: "demand-lifecycle-runtime",
      onCallbackFailure: ({ context }) => verifyFailureClosure(
        input,
        config,
        tracker,
        currentMutationContext ?? context,
      ),
    }, (mutationContext) => {
      currentMutationContext = mutationContext;
      return withStateRootLock(input.stateRoot, () => (
        applyWhileLocked(input, config, mutationContext, tracker, recoveryMode)
      ));
    });
  } catch (cause) {
    boundary(
      recoveryMode ? "recovery" : "apply",
      cause,
      `demand lifecycle ${recoveryMode ? "recovery" : "apply"} failed closed`,
    );
  }
}

// ── 9. 模块公开入口 ───────────────────────────────────────────────────────────

/**
 * 零写 preview：返回完整 frozen confirmed plan，不执行状态提交或 lease 删除。
 */
export function planDemandLifecycleTransition(value = {}) {
  const input = normalizePlanInput(canonicalLifecycleInput(value, "lifecycle preview input"));
  const config = loadConfig(input);
  const loaded = loadState(input, config);
  const leases = loadLeases(input);
  return buildPlan(input, config, loaded, leases);
}

/**
 * apply：消费 preview 返回的 exact plan，在既有 gate/journal 中提交或幂等 replay。
 */
export async function applyDemandLifecycleTransitionPlan(value = {}) {
  return runApply(
    normalizeApplyInput(canonicalLifecycleInput(value, "lifecycle apply input")),
    { recoveryMode: false },
  );
}

/**
 * recover：只恢复与 confirmed plan 完全相同的 lifecycle journal/effect 前缀。
 */
export async function recoverDemandLifecycleTransition(value = {}) {
  return runApply(
    normalizeApplyInput(canonicalLifecycleInput(value, "lifecycle recovery input")),
    { recoveryMode: true },
  );
}
