import path from "node:path";
import { existsSync, realpathSync } from "node:fs";

import { canonicalJson, canonicalJsonDigest } from "./wakeflow-canonical-json.mjs";

/**
 * Codex Pod宿主适配器的职责地图：
 * - 校验shared Pod service签发的候选计划及当前Codex宿主身份；
 * - 以精确launch correlation在有界task快照中恢复既有窗口，并以saved project绑定创建目标；
 * - 产出create/observe-existing宿主操作描述，再把final/pending host response规范化为领域可消费观察；
 * - 本文件不写Pod证据、demand state或window binding，也不把task存在解释为业务完成。
 */

function fail(code, message, cause = undefined) {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.code = code;
  throw error;
}

// 宿主边界只消费JSON式被动数据；先复制快照，避免计划或宿主响应中的getter参与授权判断。
function canonicalDataSnapshot(value, code, label) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (cause) {
    fail(code, `${label} must be canonical passive data`, cause);
  }
}

function canonicalLocalPath(value) {
  const resolved = path.resolve(value);
  if (!existsSync(resolved)) return resolved;
  return realpathSync.native(resolved);
}

function launchCorrelationMarker(launchCorrelationId) {
  const value = boundedToken(launchCorrelationId, "launchCorrelationId");
  return `Wakeflow launch correlation: ${value}`;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function boundedToken(value, label) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || value.length > 4096
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    const error = new Error(`${label} must be one bounded non-empty token`);
    error.code = "invalid-host-observation";
    throw error;
  }
  return value;
}

function finalThreadId(value) {
  const token = boundedToken(value, "threadId");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(token)) {
    const error = new Error("threadId must be one final Codex thread UUID");
    error.code = "invalid-host-observation";
    throw error;
  }
  return token;
}

function planToken(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    fail("invalid-materialization-plan", `${label} is invalid`);
  }
  return value;
}

function exactObject(value, required, optional, label) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    fail("invalid-materialization-plan", `${label} must be one plain object`);
  }
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  if (
    keys.length < required.length
    || keys.some((key) => !allowed.has(key))
    || required.some((key) => !Object.hasOwn(value, key))
  ) {
    fail("invalid-materialization-plan", `${label} has the wrong closed field set`);
  }
  return value;
}

function assertCandidateOperation(plan) {
  const operation = plan.operation;
  const common = [
    "role",
    "environmentIntent",
    "launchOperationId",
    "correlationId",
    "stateRootRef",
  ];
  const product = operation?.role === "product";
  exactObject(
    operation,
    product
      ? [
          ...common,
          "repositoryId",
          "repositoryRoot",
          "repositorySourceDigest",
          "expectedBaseHead",
        ]
      : [...common, "controlRoot"],
    product ? ["hostResourceKey"] : [],
    "Codex Pod materialization operation",
  );
  planToken(
    operation.launchOperationId,
    /^pod-launch_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    "launchOperationId",
  );
  if (
    operation.correlationId !== operation.launchOperationId
    || operation.stateRootRef !== `.wakeflow-active/current/${plan.demandId}`
  ) {
    fail("invalid-materialization-plan", "Codex Pod operation correlation or state-root ref is invalid");
  }
  if (product) {
    if (
      operation.environmentIntent !== "host-worktree"
      || !/^repository_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(operation.repositoryId)
      || !/^sha256:[0-9a-f]{64}$/u.test(operation.repositorySourceDigest)
      || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(operation.expectedBaseHead)
    ) {
      fail("invalid-materialization-plan", "Codex Pod product operation is incomplete or malformed");
    }
    const repositoryRoot = boundedToken(operation.repositoryRoot, "repositoryRoot");
    if (!path.isAbsolute(repositoryRoot) || canonicalLocalPath(repositoryRoot) !== repositoryRoot) {
      fail("invalid-materialization-plan", "repositoryRoot must be one existing canonical absolute root");
    }
    if (operation.hostResourceKey !== undefined) {
      boundedToken(operation.hostResourceKey, "hostResourceKey");
    }
  } else {
    if (
      !["controller", "design", "test"].includes(operation.role)
      || operation.environmentIntent !== "host-local"
    ) {
      fail("invalid-materialization-plan", "Codex Pod control operation role or environment is invalid");
    }
    const controlRoot = boundedToken(operation.controlRoot, "controlRoot");
    if (!path.isAbsolute(controlRoot) || canonicalLocalPath(controlRoot) !== controlRoot) {
      fail("invalid-materialization-plan", "controlRoot must be one existing canonical absolute root");
    }
  }
}

function assertCandidatePlan(plan, admittedModes) {
  plan = canonicalDataSnapshot(plan, "invalid-materialization-plan", "Codex Pod materialization plan");
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    fail("invalid-materialization-plan", "Codex Pod materialization requires one candidate plan object");
  }
  const { planDigest, ...unsigned } = plan;
  exactObject(plan, [
    "kind",
    "schemaVersion",
    "mode",
    "programId",
    "demandId",
    "hostId",
    "podId",
    "windowId",
    "bindingId",
    "configDigest",
    "state",
    "launchIntent",
    "materialization",
    "operation",
    "requiresHostOperationFence",
    "hostCreateAllowed",
    "recoveryOnly",
    "planDigest",
  ], [], "Codex Pod materialization plan");
  const expectedFlags = plan.mode === "host-create"
    ? [true, false, "creating"]
    : plan.mode === "host-recovery"
      ? [false, true, "pending"]
      : [false, true, "finalized"];
  if (
    plan.kind !== "WakeflowPodWindowMaterializationPlan"
    || plan.schemaVersion !== 1
    || plan.hostId !== "codex"
    || !admittedModes.includes(plan.mode)
    || plan.requiresHostOperationFence !== true
    || typeof plan.planDigest !== "string"
    || canonicalJsonDigest(unsigned) !== plan.planDigest
    || plan.hostCreateAllowed !== expectedFlags[0]
    || plan.recoveryOnly !== expectedFlags[1]
    || plan.materialization?.status !== expectedFlags[2]
    || plan.launchIntent?.ref !== `.wakeflow-local/runtime/hosts/codex/evidence/pods/${plan.podId}`
      + `/launch-intents/${plan.operation?.launchOperationId}.json`
    || !/^sha256:[0-9a-f]{64}$/u.test(plan.launchIntent?.digest)
  ) {
    const error = new Error("Codex Pod materialization plan is stale, modified, or belongs to another host/mode");
    error.code = "invalid-materialization-plan";
    throw error;
  }
  for (const [value, pattern, label] of [
    [plan.programId, /^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u, "programId"],
    [plan.demandId, /^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u, "demandId"],
    [plan.podId, /^pod_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u, "podId"],
    [plan.windowId, /^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u, "windowId"],
    [plan.bindingId, /^binding_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u, "bindingId"],
    [plan.configDigest, /^sha256:[0-9a-f]{64}$/u, "configDigest"],
  ]) planToken(value, pattern, label);
  exactObject(plan.state, ["revision", "digest"], [], "Codex Pod source state");
  if (!Number.isInteger(plan.state.revision) || plan.state.revision < 1) {
    fail("invalid-materialization-plan", "Codex Pod source state revision is invalid");
  }
  planToken(plan.state.digest, /^sha256:[0-9a-f]{64}$/u, "state.digest");
  assertCandidateOperation(plan);
  return plan;
}

function recoveryMatches(threadResponse, launchCorrelationId) {
  const snapshot = threadResponse === undefined
    ? []
    : canonicalDataSnapshot(threadResponse, "invalid-host-observation", "Codex thread search response");
  const threads = Array.isArray(snapshot)
    ? snapshot
    : Array.isArray(snapshot?.threads)
      ? snapshot.threads
      : [];
  if (threads.length > 50) {
    fail("invalid-host-observation", "Codex thread search response exceeds the bounded 50-task snapshot");
  }
  const marker = launchCorrelationMarker(launchCorrelationId);
  return threads.filter((thread) => (
    thread
    && typeof thread.threadId === "string"
    && thread.threadId.trim()
    && typeof thread.preview === "string"
    && thread.preview.split(/\r?\n/u).some((line) => line.trim() === marker)
  ));
}

// recovery只能接受唯一final task preview中的整行correlation marker，零个或多个匹配都失败关闭。
export function exactCodexRecoveryThread(threadResponse, launchCorrelationId) {
  const marker = launchCorrelationMarker(launchCorrelationId);
  const matches = recoveryMatches(threadResponse, launchCorrelationId);
  if (matches.length !== 1) {
    const error = new Error(
      `recovery-not-unique: expected exactly one final Codex task preview matching ${marker}; found ${matches.length}`,
    );
    error.code = "recovery-not-unique";
    error.matchCount = matches.length;
    throw error;
  }
  return matches[0];
}

// 创建只能落到唯一saved local project；路径以canonical物理根比较，projectId仍来自宿主响应。
export function exactCodexProject(projectResponse, repositoryRoot) {
  const snapshot = projectResponse === undefined
    ? []
    : canonicalDataSnapshot(projectResponse, "invalid-host-observation", "Codex project response");
  const projects = Array.isArray(snapshot)
    ? snapshot
    : Array.isArray(snapshot?.projects)
      ? snapshot.projects
      : [];
  const expectedPath = canonicalLocalPath(boundedToken(repositoryRoot, "repositoryRoot"));
  const matches = projects.filter((project) => {
    if (!project || project.projectKind !== "local" || typeof project.path !== "string") {
      return false;
    }
    return canonicalLocalPath(project.path) === expectedPath;
  });

  if (matches.length === 0) {
    const error = new Error(`project-not-registered: no saved Codex project exactly matches ${expectedPath}`);
    error.code = "project-not-registered";
    throw error;
  }
  if (matches.length > 1) {
    const error = new Error(`project-ambiguous: more than one saved Codex project exactly matches ${expectedPath}`);
    error.code = "project-ambiguous";
    throw error;
  }
  boundedToken(matches[0].projectId, "projectId");
  return matches[0];
}

// 把当前candidate plan与search/project观察组合为单次Codex创建或恢复操作，不直接调用宿主API。
export function codexPodMaterializationOperation(
  value,
  options = {},
) {
  const plan = assertCandidatePlan(value, ["host-create", "host-recovery"]);
  const normalizedOptions = canonicalDataSnapshot(
    options,
    "invalid-host-observation",
    "Codex Pod materialization host inputs",
  );
  const projectResponse = normalizedOptions.projectResponse ?? null;
  const threadResponse = normalizedOptions.threadResponse ?? null;
  if (!Array.isArray(threadResponse) && !Array.isArray(threadResponse?.threads)) {
    const error = new Error("Codex Pod materialization requires one bounded search snapshot before create/recovery");
    error.code = "search-before-create-required";
    throw error;
  }
  const matches = recoveryMatches(threadResponse, plan.operation.correlationId);
  if (matches.length > 1) {
    const error = new Error("recovery-not-unique: multiple final Codex tasks match the exact Pod launch correlation");
    error.code = "recovery-not-unique";
    error.matchCount = matches.length;
    throw error;
  }
  if (matches.length === 1) {
    return deepFreeze({
      kind: "WakeflowCodexPodMaterializationOperation",
      schemaVersion: 1,
      mode: "observe-existing",
      planDigest: plan.planDigest,
      windowId: plan.windowId,
      launchOperationId: plan.operation.launchOperationId,
      threadId: finalThreadId(matches[0].threadId),
      requiresBoundedReadback: true,
      createAllowed: false,
    });
  }
  if (plan.mode === "host-recovery") {
    const error = new Error("recovery-not-found: no final Codex task matches the exact Pod launch correlation");
    error.code = "recovery-not-found";
    throw error;
  }
  if (plan.hostCreateAllowed !== true || plan.recoveryOnly !== false) {
    const error = new Error("Codex Pod create is not authorized by the candidate plan");
    error.code = "host-create-not-authorized";
    throw error;
  }
  const product = plan.operation.role === "product";
  const projectRoot = product ? plan.operation.repositoryRoot : plan.operation.controlRoot;
  const project = exactCodexProject(projectResponse, projectRoot);
  const prompt = [
    "Wakeflow Pod entry synchronization only; do not execute product work.",
    `Program: ${plan.programId}`,
    `Demand: ${plan.demandId}`,
    `Window: ${plan.windowId}`,
    `Role: ${plan.operation.role}`,
    `State root: ${plan.operation.stateRootRef}`,
    launchCorrelationMarker(plan.operation.correlationId),
  ].join("\n");
  return deepFreeze({
    kind: "WakeflowCodexPodMaterializationOperation",
    schemaVersion: 1,
    mode: "create",
    planDigest: plan.planDigest,
    windowId: plan.windowId,
    launchOperationId: plan.operation.launchOperationId,
    searchBeforeCreate: true,
    createAllowed: true,
    createThread: {
      prompt,
      target: {
        type: "project",
        projectId: project.projectId,
        environment: product
          ? {
              type: "worktree",
              startingState: { type: "branch", branchName: plan.operation.expectedBaseHead },
            }
          : { type: "local" },
      },
    },
  });
}

// 将Codex最终thread或异步clientThread回执收敛为portable finalized/pending观察，供Pod service另行落证。
export function codexPodCreationObservation(value, response = {}) {
  const plan = assertCandidatePlan(value, ["host-create", "host-recovery", "record-creation"]);
  response = canonicalDataSnapshot(response, "invalid-host-observation", "Codex Pod creation observation");
  if (typeof response.threadId === "string" && response.threadId.trim()) {
    const actualCwd = canonicalLocalPath(boundedToken(response.actualCwd, "actualCwd"));
    if (!existsSync(actualCwd)) {
      const error = new Error("final Codex Pod observation cwd does not exist");
      error.code = "invalid-host-observation";
      throw error;
    }
    return deepFreeze({
      status: "finalized",
      handle: {
        kind: "codex-thread",
        value: finalThreadId(response.threadId),
      },
      observation: {
        actualCwd,
        ...(response.hostCreatedAt === undefined
          ? {}
          : { hostCreatedAt: boundedToken(response.hostCreatedAt, "hostCreatedAt") }),
      },
    });
  }
  if (typeof response.clientThreadId === "string" && response.clientThreadId.trim()) {
    return deepFreeze({
      status: "pending",
      hostRequestId: boundedToken(response.clientThreadId, "clientThreadId"),
    });
  }
  const error = new Error("Codex Pod creation observation has neither a final threadId nor a pending clientThreadId");
  error.code = "invalid-host-observation";
  throw error;
}
