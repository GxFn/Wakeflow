/**
 * TargetResult 只读权威投影。
 *
 * 本模块把 demand core 中已经提交的结果事实收敛成供 Controller consumer 使用的
 * 瞬时快照，但不取得任何写权限：
 *
 * - 唯一选择器来自 `state.targetTasks[].currentResult`，不扫描 local transport 或孤立文件；
 * - event identity、state inventory 与 immutable TargetResult 必须形成双向 exact 闭包；
 * - ready / blocked / missing / closed 只按当前 task lifecycle 与 exact current result 派生；
 * - pending review candidate 只作为已提交输入快照返回，不在这里判断接受、返工或重设计；
 * - 输出不包含运行时路径、原始字节或 wall clock，也不写 state、transport、Active 或 archive。
 *
 * `record` 中的目标窗口原始人类文本仍属于 immutable TargetResult；本模块不充当
 * redactor、真实性验证器或验收 owner。隐私门、review 决定和生命周期提交分别由其领域 owner 负责。
 */
import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import { loadDemandArtifactByRef } from "./wakeflow-demand-artifact-records.mjs";
import { loadDemandCoreRecordsWithArtifactClosure } from "./wakeflow-demand-state-service.mjs";

const SNAPSHOT_SCHEMA_VERSION = 1;
const SNAPSHOT_KIND = "WakeflowTargetResultAuthoritySnapshot";
const READY_LIFECYCLE = "review-ready";
const BLOCKED_LIFECYCLE = "blocked";
const MISSING_LIFECYCLES = new Set([
  "dispatched",
  "needs-rework",
  "planned",
  "waiting-result",
]);
const CLOSED_LIFECYCLES = new Set([
  "accepted",
  "cancelled",
  "superseded",
]);
const SAFE_ERROR_CODE_RE = /^wakeflow-[a-z0-9-]+$/u;
const STRICT_LOADED_SOURCE_KEYS = Object.freeze([
  "demand",
  "authority",
  "state",
  "events",
  "digests",
  "paths",
  "bytes",
  "byteDigests",
]);
const STRICT_LOADED_SOURCE_OPTIONAL_KEYS = Object.freeze([
  "journal",
]);

// ── 1. 领域错误与无行为输入合同 ──────────────────────────────────────────────

/** TargetResult authority 对外稳定、路径脱敏的领域错误。 */
export class WakeflowTargetResultAuthorityError extends Error {
  constructor(code, message, { details = {}, cause } = {}) {
    super(message);
    this.name = "WakeflowTargetResultAuthorityError";
    this.code = code;
    this.details = Object.freeze({
      ...details,
      ...(typeof cause?.code === "string" ? { causeCode: cause.code } : {}),
    });
  }
}

function authorityError(code, message, details = {}, cause = undefined) {
  return new WakeflowTargetResultAuthorityError(code, message, { details, cause });
}

// 只提升可信的 wakeflow 错误码；任意内部 message、路径与 cause 都不进入公开结果。
function boundaryError(cause) {
  if (cause instanceof WakeflowTargetResultAuthorityError) return cause;
  const causeCode = typeof cause?.code === "string" && SAFE_ERROR_CODE_RE.test(cause.code)
    ? cause.code
    : null;
  return authorityError(
    causeCode ?? "wakeflow-target-result-authority-load",
    `target result authority load failed closed${causeCode ? ` (${causeCode})` : ""}`,
    { causeCode },
  );
}

function fail(code, message, details = {}) {
  throw authorityError(code, message, details);
}

// 输出只包含已经 strict-load 的普通 JSON 数据，因此可递归冻结供多个 consumer 共享。
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function assertPlainObject(value, label, code = "wakeflow-target-result-authority-input") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(code, `${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(code, `${label} must be a plain data object`);
  }
  return value;
}

/**
 * 通过 canonical codec 取得与调用方隔离的无行为数据。
 * descriptor、symbol、hidden field、sparse array 与 getter 均在读取前被拒绝。
 */
function canonicalDataSnapshot(value, label, code) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (cause) {
    fail(code, `${label} must contain only canonical plain data`, {
      causeCode: typeof cause?.code === "string" ? cause.code : null,
    });
  }
}

// public loader 只接收 stateRoot/programId 与可选 ledgerRoot，不接受派生或未来字段。
function normalizeOptions(value) {
  const options = assertPlainObject(canonicalDataSnapshot(
    value,
    "options",
    "wakeflow-target-result-authority-input",
  ), "options");
  const allowed = new Set(["stateRoot", "expectedProgramId", "ledgerRoot"]);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) {
      fail("wakeflow-target-result-authority-input", `options contains unknown field ${key}`);
    }
  }
  for (const key of ["stateRoot", "expectedProgramId"]) {
    if (!Object.hasOwn(options, key)) {
      fail("wakeflow-target-result-authority-input", `options is missing ${key}`);
    }
  }
  return Object.freeze({
    stateRoot: options.stateRoot,
    expectedProgramId: options.expectedProgramId,
    ledgerRoot: Object.hasOwn(options, "ledgerRoot") ? options.ledgerRoot : null,
  });
}

/**
 * internal composition seam 接受 T04 普通 strict loader 的完整八字段结果，也接受只多出
 * `journal` 的 BusinessArchive recovery loader 结果。
 * 顶层字段先用 descriptor exact-check，随后仅复制本模块会读取的 core 子树；这样既不执行
 * 外来 accessor，也不把防御性 Buffer 副本误当作本模块的 authority 输入。
 */
function normalizeLoadedSource(value) {
  const source = assertPlainObject(
    value,
    "loaded demand source",
    "wakeflow-target-result-authority-loaded",
  );
  const keys = Reflect.ownKeys(source);
  const expected = new Set([
    ...STRICT_LOADED_SOURCE_KEYS,
    ...STRICT_LOADED_SOURCE_OPTIONAL_KEYS,
  ]);
  if (
    keys.some((key) => typeof key !== "string" || !expected.has(key))
    || STRICT_LOADED_SOURCE_KEYS.some((key) => !Object.hasOwn(source, key))
  ) {
    fail(
      "wakeflow-target-result-authority-loaded",
      "loaded demand source must expose one recognized strict demand-core loader shape",
    );
  }
  const values = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(
        "wakeflow-target-result-authority-loaded",
        `loaded demand source field ${key} must be one enumerable data property`,
      );
    }
    if (STRICT_LOADED_SOURCE_KEYS.includes(key)) values[key] = descriptor.value;
  }
  return canonicalDataSnapshot({
    demand: values.demand,
    state: values.state,
    events: values.events,
    digests: values.digests,
    paths: values.paths,
  }, "loaded demand source", "wakeflow-target-result-authority-loaded");
}

// 所有进入 digest 或持久身份比较的顺序统一使用 ECMAScript code-unit order。
function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

// ── 2. Result identity、event 与 state inventory 闭包 ─────────────────────────

function sameArray(left, right) {
  return left.length === right.length
    && left.every((entry, index) => entry === right[index]);
}

// review candidate tuple 必须与 exact-loaded TargetResult 的可携带身份逐字段相同。
function sameResultTuple(left, right) {
  return left.targetTaskId === right.targetTaskId
    && left.targetResultId === right.targetResultId
    && left.ref === right.ref
    && left.digest === right.digest
    && left.outcome === right.outcome;
}

// 从内部 artifact entry 投影 review 需要的最小结果身份，不复制整个 record。
function resultTuple(artifact) {
  return {
    targetTaskId: artifact.targetTaskId,
    targetResultId: artifact.targetResultId,
    ref: artifact.ref,
    digest: artifact.digest,
    outcome: artifact.record.outcome,
  };
}

/** 按 state ref/digest exact-load 一份 immutable TargetResult，并重验 task 归属。 */
function loadExactResult(loaded, stateTuple) {
  const resolved = loadDemandArtifactByRef({
    stateRoot: loaded.paths.stateRoot,
    ref: stateTuple.ref,
    digest: stateTuple.digest,
    expectedArtifactKind: "wakeflow-target-result",
    expectedArtifactId: stateTuple.targetResultId,
    expectedProgramId: loaded.demand.programId,
    expectedDemandId: loaded.demand.demandId,
  });
  if (resolved.record.targetTaskId !== stateTuple.targetTaskId) {
    fail(
      "wakeflow-target-result-authority-task",
      "TargetResult state tuple and immutable record must name the same target task",
      { targetResultId: stateTuple.targetResultId },
    );
  }
  return {
    targetTaskId: stateTuple.targetTaskId,
    targetResultId: stateTuple.targetResultId,
    ref: stateTuple.ref,
    digest: stateTuple.digest,
    lifecycleStatus: stateTuple.lifecycleStatus,
    record: resolved.record,
  };
}

/**
 * 反向关闭 event 与 state inventory：每个已提交结果必须仍在 state 中，state 也不得
 * 凭空登记没有唯一 committing event 的结果。
 */
function assertCommittedResultStateClosure(loaded) {
  const committed = loaded.events.flatMap((event) => event.changedArtifacts.filter(
    (entry) => entry.artifactKind === "wakeflow-target-result",
  ));
  const stateById = new Map(loaded.state.targetResults.map((entry) => [entry.targetResultId, entry]));
  const committedIds = new Set();
  for (const identity of committed) {
    if (committedIds.has(identity.artifactId)) {
      fail(
        "wakeflow-target-result-authority-closure",
        "one immutable TargetResult identity must be committed by exactly one controller event",
        { targetResultId: identity.artifactId },
      );
    }
    committedIds.add(identity.artifactId);
    const stateTuple = stateById.get(identity.artifactId);
    if (
      !stateTuple
      || stateTuple.ref !== identity.ref
      || stateTuple.digest !== identity.digest
    ) {
      fail(
        "wakeflow-target-result-authority-closure",
        "every committed TargetResult event identity must remain in the exact state inventory",
        { targetResultId: identity.artifactId },
      );
    }
  }
  if (committedIds.size !== stateById.size) {
    fail(
      "wakeflow-target-result-authority-closure",
      "TargetResult event identities and state inventory must form one exact set",
    );
  }
}

function loadResultArtifacts(loaded) {
  assertCommittedResultStateClosure(loaded);
  const artifacts = loaded.state.targetResults.map((stateTuple) => loadExactResult(loaded, stateTuple));
  artifacts.sort((left, right) => lexicalCompare(left.targetResultId, right.targetResultId));
  return artifacts;
}

// ── 3. Current selector 与当前 review 分类 ────────────────────────────────────

/**
 * state.targetTasks[].currentResult 是唯一 current selector；历史结果继续可见，但不能
 * 因文件较新、目录顺序或 transport 声明而抢占 current。
 */
function projectTargetTasks(loaded, artifactById) {
  return loaded.state.targetTasks.map((task) => {
    if (!task.currentResult) {
      return {
        targetTaskId: task.targetTaskId,
        lifecycleStatus: task.lifecycleStatus,
        currentResult: null,
      };
    }
    const selected = artifactById.get(task.currentResult.targetResultId);
    if (
      !selected
      || selected.targetTaskId !== task.targetTaskId
      || selected.ref !== task.currentResult.ref
      || selected.digest !== task.currentResult.digest
      || selected.lifecycleStatus !== "current"
    ) {
      fail(
        "wakeflow-target-result-authority-current",
        "target task currentResult must select the exact current immutable TargetResult tuple",
        { targetTaskId: task.targetTaskId },
      );
    }
    return {
      targetTaskId: task.targetTaskId,
      lifecycleStatus: task.lifecycleStatus,
      currentResult: {
        targetResultId: selected.targetResultId,
        ref: selected.ref,
        digest: selected.digest,
      },
    };
  }).sort((left, right) => lexicalCompare(left.targetTaskId, right.targetTaskId));
}

/**
 * 按 task lifecycle 派生当前完整分类。needs-rework 等待新结果时即使保留旧 current，
 * 仍进入 missing；accepted/cancelled/superseded 只进入 closed，不重新参与 review。
 */
function classifyCurrentReview(targetTasks, artifactById) {
  const ready = [];
  const blocked = [];
  const missing = [];
  const closed = [];
  const results = [];

  for (const task of targetTasks) {
    if (task.lifecycleStatus === READY_LIFECYCLE || task.lifecycleStatus === BLOCKED_LIFECYCLE) {
      const selected = task.currentResult
        ? artifactById.get(task.currentResult.targetResultId)
        : null;
      if (!selected) {
        fail(
          "wakeflow-target-result-authority-review",
          `${task.lifecycleStatus} target task must select one exact current TargetResult`,
          { targetTaskId: task.targetTaskId },
        );
      }
      if (task.lifecycleStatus === READY_LIFECYCLE && selected.record.outcome === "blocked") {
        fail(
          "wakeflow-target-result-authority-review",
          "review-ready target task cannot select a blocked TargetResult",
          { targetTaskId: task.targetTaskId },
        );
      }
      if (task.lifecycleStatus === BLOCKED_LIFECYCLE && selected.record.outcome !== "blocked") {
        fail(
          "wakeflow-target-result-authority-review",
          "blocked target task must select a blocked TargetResult",
          { targetTaskId: task.targetTaskId },
        );
      }
      if (task.lifecycleStatus === READY_LIFECYCLE) ready.push(task.targetTaskId);
      else blocked.push(task.targetTaskId);
      results.push(resultTuple(selected));
      continue;
    }
    if (MISSING_LIFECYCLES.has(task.lifecycleStatus)) {
      missing.push(task.targetTaskId);
      continue;
    }
    if (CLOSED_LIFECYCLES.has(task.lifecycleStatus)) {
      closed.push(task.targetTaskId);
      continue;
    }
    fail(
      "wakeflow-target-result-authority-lifecycle",
      "target task lifecycle is not classifiable for result authority",
      { targetTaskId: task.targetTaskId, lifecycleStatus: task.lifecycleStatus },
    );
  }

  results.sort((left, right) => lexicalCompare(left.targetTaskId, right.targetTaskId));
  return {
    ready,
    blocked,
    missing,
    closed,
    results,
    resultSetDigest: canonicalJsonDigest(results),
  };
}

// ── 4. Pending review candidate 闭包 ──────────────────────────────────────────

/**
 * pending candidate 是 review owner 已提交的 immutable 输入快照。这里只验证它与 state
 * pending selector、当前 exact result 及 fromState event tail 一致，不推导或执行决定。
 */
function loadPendingReview(loaded, artifactById) {
  if (loaded.state.review.status === "idle") return null;
  const pending = loaded.state.review.pendingCandidate;
  if (!pending) {
    fail("wakeflow-target-result-authority-review", "pending review state must select one exact candidate");
  }
  const resolved = loadDemandArtifactByRef({
    stateRoot: loaded.paths.stateRoot,
    ref: pending.ref,
    digest: pending.digest,
    expectedArtifactKind: "wakeflow-review-candidate",
    expectedArtifactId: pending.reviewCandidateId,
    expectedProgramId: loaded.demand.programId,
    expectedDemandId: loaded.demand.demandId,
  });
  const candidate = resolved.record;
  for (const [candidateField, stateField] of [
    ["readyTargetTaskIds", "readyTargetTaskIds"],
    ["blockedTargetTaskIds", "blockedTargetTaskIds"],
    ["missingTargetTaskIds", "missingTargetTaskIds"],
  ]) {
    if (!sameArray(candidate[candidateField], loaded.state.review[stateField])) {
      fail(
        "wakeflow-target-result-authority-review",
        "pending review candidate classification must equal the exact state review snapshot",
        { reviewCandidateId: candidate.reviewCandidateId },
      );
    }
  }

  const taskById = new Map(loaded.state.targetTasks.map((task) => [task.targetTaskId, task]));
  for (const tuple of candidate.results) {
    const task = taskById.get(tuple.targetTaskId);
    const selected = artifactById.get(tuple.targetResultId);
    if (
      !task?.currentResult
      || !selected
      || task.currentResult.targetResultId !== tuple.targetResultId
      || task.currentResult.ref !== tuple.ref
      || task.currentResult.digest !== tuple.digest
      || !sameResultTuple(tuple, resultTuple(selected))
    ) {
      fail(
        "wakeflow-target-result-authority-review",
        "pending review candidate result must equal the state-selected immutable TargetResult tuple",
        { reviewCandidateId: candidate.reviewCandidateId },
      );
    }
  }

  const fromEvent = loaded.events.find((event) => event.nextRevision === candidate.fromState.revision);
  if (
    !fromEvent
    || fromEvent.eventId !== candidate.fromState.eventId
    || canonicalJsonDigest(fromEvent) !== candidate.fromState.eventDigest
  ) {
    fail(
      "wakeflow-target-result-authority-review",
      "pending review candidate must bind an exact committed state event tail",
      { reviewCandidateId: candidate.reviewCandidateId },
    );
  }

  return {
    reviewCandidateId: pending.reviewCandidateId,
    ref: pending.ref,
    digest: pending.digest,
    record: candidate,
  };
}

// ── 5. 确定性快照构造与公开入口 ──────────────────────────────────────────────

/** 由一份 strict core snapshot 构造零写、无运行时路径的 frozen authority projection。 */
function buildSnapshotFromLoaded(value) {
  const loaded = normalizeLoadedSource(value);
  if (
    !loaded.demand
    || !loaded.state
    || !Array.isArray(loaded.events)
    || !loaded.digests
    || !loaded.paths?.stateRoot
  ) {
    fail(
      "wakeflow-target-result-authority-loaded",
      "loaded demand source must be one strict demand-core snapshot",
    );
  }
  const artifacts = loadResultArtifacts(loaded);
  const artifactById = new Map(artifacts.map((artifact) => [artifact.targetResultId, artifact]));
  const targetTasks = projectTargetTasks(loaded, artifactById);
  const current = classifyCurrentReview(targetTasks, artifactById);
  const pending = loadPendingReview(loaded, artifactById);

  return deepFreeze({
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    kind: SNAPSHOT_KIND,
    demand: {
      programId: loaded.demand.programId,
      demandId: loaded.demand.demandId,
      ref: "demand.json",
      digest: loaded.digests.demand,
    },
    state: {
      revision: loaded.state.revision,
      digest: loaded.digests.state,
      eventId: loaded.state.lastEvent.eventId,
      eventDigest: loaded.state.lastEvent.eventDigest,
    },
    artifacts,
    targetTasks,
    review: {
      current,
      pending,
    },
  });
}

/**
 * 已持有 state-root lock 的组合入口；调用者必须把 strict loader 的完整返回值原样传入。
 * 本函数不自行取得第二把锁，也不把调用方判断升级为 authority。
 */
export function buildTargetResultAuthoritySnapshotFromLoaded(loaded) {
  try {
    return buildSnapshotFromLoaded(loaded);
  } catch (cause) {
    throw boundaryError(cause);
  }
}

/** 普通只读入口：严格读取 demand core/artifact closure 后返回同一 projection。 */
export function loadTargetResultAuthoritySnapshot(options = {}) {
  try {
    return buildSnapshotFromLoaded(loadDemandCoreRecordsWithArtifactClosure(normalizeOptions(options)));
  } catch (cause) {
    throw boundaryError(cause);
  }
}
