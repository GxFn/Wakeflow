/**
 * Claude direct-thread transport 的宿主 effect owner。
 *
 * 职责导航：
 * 1. 从当前config、需求state与immutable transport记录重建一次发送authority；
 * 2. 把binding、locator、lease及envelope闭合到同一个stable window；
 * 3. 在locator owner签发的逐窗口mutex内解析唯一live tmux pane；
 * 4. 通过stdin加载operation-scoped tmux buffer，只执行一次paste、Enter和readback；
 * 5. 把宿主结果交回shared delivery/review owner结算，不自行解释业务接受；
 * 6. callback失败时只按durable claim/run/event事实判断mutex可否安全释放；
 * 7. 显式恢复只处理exact retained operation，不扫描或重放未知发送。
 *
 * 本模块不创建第二套transport状态机，不持有current workspace缓存，不写binding/locator，
 * 也不把pane回显、tmux返回码或文件存在解释为目标任务完成。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import { loadWakeflowConfigV3Snapshot } from "./wakeflow-config-v3-snapshot.mjs";
import {
  claimTargetDelivery,
  recordTargetDeliveryOutcome,
} from "./wakeflow-delivery-orchestration.mjs";
import {
  loadDemandCoreRecordsWithArtifactClosure,
} from "./wakeflow-demand-state-service.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import {
  inspectControllerReturnPreSend,
  recordControllerReturnOutcome,
} from "./wakeflow-result-review-orchestration.mjs";
import {
  inspectTransportDemandAuthority,
} from "./wakeflow-transport-store.mjs";
import {
  inspectWindowBindingInventory,
} from "./wakeflow-window-binding-service.mjs";
import {
  inspectWindowCoordinationLeaseInventory,
} from "./wakeflow-window-lease-service.mjs";
import {
  inspectClaudeWindowLocatorInventory,
  recoverClaudeWindowOperationMutex,
  resolveClaudeWindowOperationEndpoint,
  withClaudeWindowOperationMutex,
} from "./wakeflow-claude-locator.mjs";

export const WAKEFLOW_CLAUDE_TRANSPORT_HOST_ID = "claude-code";
export const WAKEFLOW_CLAUDE_TRANSPORT_SCHEMA_VERSION = 1;

const HOST_ID = WAKEFLOW_CLAUDE_TRANSPORT_HOST_ID;
const SCHEMA_VERSION = WAKEFLOW_CLAUDE_TRANSPORT_SCHEMA_VERSION;
const HOST_METHOD = "tmux-paste";
const HOST_MODE = "direct-thread";
const DEFAULT_TMUX_SESSION = "wakeflow";
const MAX_PANES = 4_096;
const MAX_CAPTURE_BYTES = 1024 * 1024;
const TMUX_TIMEOUT_MS = 5_000;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/u;
const OPERATION_ID_RE = /^claude-operation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PANE_FORMAT = [
  "#{session_name}",
  "#{window_id}",
  "#{pane_id}",
  "#{pane_dead}",
  "#{pane_current_command}",
  "#{@wakeflow_program_id}",
  "#{@wakeflow_host_id}",
  "#{@wakeflow_window_id}",
  "#{@wakeflow_binding_id}",
  "#{@wakeflow_locator_id}",
].join("\t");

/** 为Claude发送边界保留稳定code与有限details，prompt和pane原文不进入公开错误。 */
export class WakeflowClaudeTransportError extends Error {
  constructor(code, message, { cause, details = {} } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowClaudeTransportError";
    this.code = code;
    this.details = Object.freeze({ ...details });
    if (cause !== undefined && this.cause === undefined) this.cause = cause;
  }
}

function fail(code, message, details = {}, cause = undefined) {
  throw new WakeflowClaudeTransportError(code, message, { cause, details });
}

function boundary(label, cause, code = "wakeflow-claude-transport") {
  if (cause instanceof WakeflowClaudeTransportError) throw cause;
  const details = {};
  if (typeof cause?.code === "string" && /^[-a-z0-9]+$/u.test(cause.code)) {
    details.causeCode = cause.code;
  }
  if (typeof cause?.details?.operationId === "string" && OPERATION_ID_RE.test(cause.details.operationId)) {
    details.operationId = cause.details.operationId;
  }
  if (new Set(["before-send", "ambiguous"]).has(cause?.details?.effectBoundary)) {
    details.effectBoundary = cause.details.effectBoundary;
  }
  fail(code, `${label} failed closed`, details, cause);
}

function plainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactDataObject(value, required, optional, label) {
  if (!plainObject(value)) fail("wakeflow-claude-transport-contract", `${label} must be a plain object`);
  const allowed = new Set([...required, ...optional]);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      fail("wakeflow-claude-transport-contract", `${label} has an unknown field`, {
        field: String(key),
      });
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-claude-transport-contract", `${label}.${key} must be one enumerable data property`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail("wakeflow-claude-transport-contract", `${label} is missing ${key}`);
    }
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function typedId(value, type, label) {
  try {
    return assertWakeflowId(value, type, `$/${label}`);
  } catch (cause) {
    fail("wakeflow-claude-transport-identifier", `${label} must be one typed ${type} ID`, {}, cause);
  }
}

function normalizeRoot(value, label) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || CONTROL_RE.test(value)
    || !path.isAbsolute(value)
    || path.resolve(value) !== value
  ) {
    fail("wakeflow-claude-transport-contract", `${label} must be one normalized absolute path`);
  }
  return value;
}

function operationId(value, label) {
  if (typeof value !== "string" || !OPERATION_ID_RE.test(value)) {
    fail("wakeflow-claude-transport-identifier", `${label} must be one Claude operation ID`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail("wakeflow-claude-transport-contract", `${label} must be one positive integer`);
  }
  return value;
}

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function nextTimestamp(...values) {
  const milliseconds = Math.max(
    Date.now(),
    ...values.map((value) => Date.parse(value)).filter(Number.isFinite).map((value) => value + 1),
  );
  return new Date(milliseconds).toISOString();
}

function normalizeTargetInput(value) {
  exactDataObject(value, [
    "workspaceRoot",
    "stateRoot",
    "expectedProgramId",
    "targetTaskId",
    "deliveryId",
    "sendGeneration",
  ], [], "Claude target delivery input");
  return deepFreeze({
    workspaceRoot: normalizeRoot(value.workspaceRoot, "workspaceRoot"),
    stateRoot: normalizeRoot(value.stateRoot, "stateRoot"),
    expectedProgramId: typedId(value.expectedProgramId, "program", "expectedProgramId"),
    targetTaskId: typedId(value.targetTaskId, "target-task", "targetTaskId"),
    deliveryId: typedId(value.deliveryId, "delivery", "deliveryId"),
    sendGeneration: positiveInteger(value.sendGeneration, "sendGeneration"),
  });
}

function normalizeControllerInput(value) {
  exactDataObject(value, [
    "workspaceRoot",
    "stateRoot",
    "expectedProgramId",
    "deliveryId",
    "runId",
  ], [], "Claude Controller-return input");
  return deepFreeze({
    workspaceRoot: normalizeRoot(value.workspaceRoot, "workspaceRoot"),
    stateRoot: normalizeRoot(value.stateRoot, "stateRoot"),
    expectedProgramId: typedId(value.expectedProgramId, "program", "expectedProgramId"),
    deliveryId: typedId(value.deliveryId, "delivery", "deliveryId"),
    runId: typedId(value.runId, "delivery-run", "runId"),
  });
}

function normalizeRecoverySubject(value) {
  // 先证明所有候选字段都是own data property，再读取discriminator，避免拒绝路径执行getter。
  exactDataObject(value, ["kind"], [
    "targetTaskId",
    "deliveryId",
    "sendGeneration",
    "runId",
  ], "recovery subject");
  const kind = value.kind;
  if (kind === "target") {
    exactDataObject(value, [
      "kind",
      "targetTaskId",
      "deliveryId",
      "sendGeneration",
    ], [], "target recovery subject");
    return deepFreeze({
      kind: "target",
      targetTaskId: typedId(value.targetTaskId, "target-task", "subject.targetTaskId"),
      deliveryId: typedId(value.deliveryId, "delivery", "subject.deliveryId"),
      sendGeneration: positiveInteger(value.sendGeneration, "subject.sendGeneration"),
    });
  }
  if (kind === "controller-return") {
    exactDataObject(value, ["kind", "deliveryId", "runId"], [], "Controller recovery subject");
    return deepFreeze({
      kind: "controller-return",
      deliveryId: typedId(value.deliveryId, "delivery", "subject.deliveryId"),
      runId: typedId(value.runId, "delivery-run", "subject.runId"),
    });
  }
  fail("wakeflow-claude-transport-contract", "recovery subject kind is unsupported");
}

function normalizeRecoveryInput(value) {
  exactDataObject(value, [
    "workspaceRoot",
    "stateRoot",
    "expectedProgramId",
    "windowId",
    "operationId",
    "subject",
  ], [], "Claude transport recovery input");
  return deepFreeze({
    workspaceRoot: normalizeRoot(value.workspaceRoot, "workspaceRoot"),
    stateRoot: normalizeRoot(value.stateRoot, "stateRoot"),
    expectedProgramId: typedId(value.expectedProgramId, "program", "expectedProgramId"),
    windowId: typedId(value.windowId, "window", "windowId"),
    operationId: operationId(value.operationId, "operationId"),
    subject: normalizeRecoverySubject(value.subject),
  });
}

function subjectDigest(programId, subject) {
  return canonicalJsonDigest({
    schemaVersion: SCHEMA_VERSION,
    hostId: HOST_ID,
    programId,
    subject,
  });
}

// 每次调用都从canonical config与完整需求closure重建authority，禁止跨发送缓存旧快照。
function loadAuthority(input) {
  let snapshot;
  let stack;
  try {
    snapshot = loadWakeflowConfigV3Snapshot({ workspaceRoot: input.workspaceRoot });
    if (snapshot.model.program.programId !== input.expectedProgramId) {
      fail("wakeflow-claude-transport-authority", "expected program does not own current config");
    }
    stack = loadDemandCoreRecordsWithArtifactClosure({
      stateRoot: input.stateRoot,
      expectedProgramId: input.expectedProgramId,
      ledgerRoot: snapshot.ledgerRoot,
    });
  } catch (cause) {
    if (cause instanceof WakeflowClaudeTransportError) throw cause;
    boundary("Claude transport config/state authority", cause, "wakeflow-claude-transport-authority");
  }
  return deepFreeze({ snapshot, stack });
}

// 在真正paste前把本轮决策重新绑定到同一语义config，避免旧socket/root偏好跨配置漂移。
function assertConfigSnapshotCurrent(input, expectedSnapshot) {
  let current;
  try {
    current = loadWakeflowConfigV3Snapshot({ workspaceRoot: input.workspaceRoot });
  } catch (cause) {
    boundary("Claude transport current config", cause, "wakeflow-claude-transport-authority");
  }
  if (
    current.model.program.programId !== input.expectedProgramId
    || current.configDigest !== expectedSnapshot.configDigest
  ) {
    fail(
      "wakeflow-claude-transport-authority",
      "current config authority differs from the transport decision snapshot",
    );
  }
  return current;
}

function tmuxContext(snapshot) {
  const configured = snapshot.model.hosts?.[HOST_ID]?.tmux ?? {};
  return deepFreeze({
    socketName: configured.socketName ?? null,
    sessionName: configured.sessionName ?? DEFAULT_TMUX_SESSION,
  });
}

function currentBinding(workspaceRoot, windowId) {
  let inventory;
  try {
    inventory = inspectWindowBindingInventory({ workspaceRoot });
  } catch (cause) {
    boundary("Claude transport binding inventory", cause, "wakeflow-claude-transport-authority");
  }
  if (inventory.hostId !== HOST_ID) {
    fail("wakeflow-claude-transport-host", "current identity inventory is not Claude Code");
  }
  const binding = inventory.bindings.find((entry) => entry.windowId === windowId) ?? null;
  if (!binding) fail("wakeflow-claude-transport-authority", "target window has no current Claude binding");
  return binding;
}

function currentLocator(workspaceRoot, windowId, expectedBindingId) {
  let inventory;
  try {
    inventory = inspectClaudeWindowLocatorInventory({ workspaceRoot });
  } catch (cause) {
    boundary("Claude locator preflight", cause, "wakeflow-claude-transport-authority");
  }
  const window = inventory.windows.find((entry) => entry.windowId === windowId) ?? null;
  if (
    !window
    || window.bindingId !== expectedBindingId
    || !window.locator
    || window.locator.status !== "current"
    || window.locator.bindingId !== expectedBindingId
  ) {
    fail("wakeflow-claude-transport-authority", "target window has no exact current locator");
  }
  return window.locator;
}

function transportInventory(input, demandId) {
  try {
    return inspectTransportDemandAuthority({
      workspaceRoot: input.workspaceRoot,
      programId: input.expectedProgramId,
      demandId,
    });
  } catch (cause) {
    boundary("Claude transport immutable inventory", cause, "wakeflow-claude-transport-authority");
  }
}

function targetPreflight(input) {
  const authority = loadAuthority(input);
  const task = authority.stack.state.targetTasks.find(
    (entry) => entry.targetTaskId === input.targetTaskId,
  ) ?? null;
  const delivery = task?.currentDelivery ?? null;
  if (
    !task
    || !delivery
    || delivery.envelope.deliveryId !== input.deliveryId
    || delivery.sendGeneration !== input.sendGeneration
  ) {
    fail("wakeflow-claude-transport-authority", "requested target delivery is not current");
  }
  if (["accepted", "ambiguous", "rejected-before-send"].includes(delivery.phase)) {
    return deepFreeze({ status: "already-settled", authority, task, delivery });
  }
  if (delivery.phase === "send-claimed") {
    fail("wakeflow-claude-transport-recovery-required", "target delivery is already send-claimed without a settled caller result");
  }
  if (delivery.phase !== "prepared" || task.lifecycleStatus !== "dispatched") {
    fail("wakeflow-claude-transport-authority", "target delivery is not prepared for one host send");
  }
  const transport = transportInventory(input, authority.stack.demand.demandId);
  const envelope = transport.entries.envelopes.find(
    (entry) => entry.record.deliveryId === input.deliveryId,
  ) ?? null;
  const packet = transport.entries.packets.find(
    (entry) => entry.record.packetId === delivery.packet.packetId,
  ) ?? null;
  if (
    !envelope
    || !packet
    || envelope.ref !== delivery.envelope.ref
    || envelope.digest !== delivery.envelope.digest
    || packet.ref !== delivery.packet.ref
    || packet.digest !== delivery.packet.digest
    || envelope.record.preparedByHostId !== HOST_ID
    || envelope.record.windowId !== task.windowId
    || packet.record.targetTaskId !== input.targetTaskId
    || packet.record.windowId !== task.windowId
    || envelope.record.packetId !== packet.record.packetId
    || envelope.record.packetDigest !== packet.record.packetDigest
  ) {
    fail("wakeflow-claude-transport-authority", "current target envelope closure is incomplete");
  }
  const binding = currentBinding(input.workspaceRoot, task.windowId);
  if (
    binding.bindingId !== envelope.record.bindingId
    || binding.identityRef !== envelope.record.identityRef
    || binding.identityBindingDigest !== envelope.record.identityBindingDigest
  ) {
    fail("wakeflow-claude-transport-authority", "target envelope binding is no longer current");
  }
  const locator = currentLocator(input.workspaceRoot, task.windowId, binding.bindingId);
  return deepFreeze({
    status: "ready",
    authority,
    task,
    delivery,
    binding,
    locator,
  });
}

function controllerPreflight(input) {
  let preSend;
  try {
    preSend = inspectControllerReturnPreSend({
      workspaceRoot: input.workspaceRoot,
      stateRoot: input.stateRoot,
      expectedProgramId: input.expectedProgramId,
      deliveryId: input.deliveryId,
    });
  } catch (cause) {
    boundary("Claude Controller-return pre-send", cause, "wakeflow-claude-transport-authority");
  }
  if (preSend.status !== "ready") {
    return deepFreeze({ status: preSend.status, preSend });
  }
  if (
    preSend.requiresHostOperationFence !== true
    || preSend.envelope.preparedByHostId !== HOST_ID
    || preSend.binding.hostId !== HOST_ID
  ) {
    fail("wakeflow-claude-transport-authority", "Controller-return lacks Claude host operation authority");
  }
  const authority = loadAuthority(input);
  const transport = transportInventory(input, preSend.envelope.demandId);
  if (transport.entries.runs.some((entry) => entry.record.runId === input.runId)) {
    fail(
      "wakeflow-claude-transport-authority",
      "Controller-return runId is already bound inside current demand transport",
    );
  }
  const locator = currentLocator(
    input.workspaceRoot,
    preSend.envelope.windowId,
    preSend.binding.bindingId,
  );
  return deepFreeze({ status: "ready", preSend, locator, authority });
}

function bindingTuple(binding) {
  return deepFreeze({
    programId: binding.programId,
    hostId: binding.hostId,
    windowId: binding.windowId,
    bindingId: binding.bindingId,
  });
}

function tmuxCommand() {
  const value = process.env.WAKEFLOW_TMUX_BIN ?? "tmux";
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || value.length > 4_096
    || CONTROL_RE.test(value)
  ) {
    fail("wakeflow-claude-transport-host", "WAKEFLOW_TMUX_BIN is invalid");
  }
  return value;
}

function tmuxArguments(socketName, args) {
  return socketName === null ? args : ["-L", socketName, ...args];
}

function executeTmux(socketName, args, { input } = {}) {
  let result;
  try {
    // socketName=null明确表示default server；不能让调用进程所在tmux client静默重定向它。
    const env = { ...process.env };
    delete env.TMUX;
    delete env.TMUX_PANE;
    if (!/utf-?8/iu.test(env.LC_ALL ?? env.LANG ?? "")) {
      env.LANG = "en_US.UTF-8";
      env.LC_ALL = "en_US.UTF-8";
    }
    result = spawnSync(tmuxCommand(), tmuxArguments(socketName, args), {
      encoding: "utf8",
      shell: false,
      env,
      timeout: TMUX_TIMEOUT_MS,
      maxBuffer: MAX_CAPTURE_BYTES,
      ...(input === undefined ? {} : { input }),
    });
  } catch (cause) {
    return { ok: false, stdout: "", cause };
  }
  return {
    ok: !result.error && result.status === 0,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    cause: result.error,
  };
}

function paneCurrentCommandIsClaude(value) {
  const command = value.trim();
  return command === "claude" || path.posix.basename(command) === "claude";
}

function listRelevantPaneObservations(context, selector) {
  const result = executeTmux(context.socketName, ["list-panes", "-a", "-F", PANE_FORMAT]);
  if (!result.ok) {
    fail(
      "wakeflow-claude-transport-host-observation",
      "tmux pane inventory was unavailable before paste",
      { effectBoundary: "before-send" },
      result.cause,
    );
  }
  const lines = result.stdout.split("\n").filter((line) => line.length > 0);
  if (lines.length > MAX_PANES) {
    fail(
      "wakeflow-claude-transport-host-observation",
      "tmux pane inventory exceeded its closed bound",
      { effectBoundary: "before-send" },
    );
  }
  const observations = [];
  for (const line of lines) {
    const fields = line.split("\t");
    if (fields.length !== 10) {
      fail(
        "wakeflow-claude-transport-host-observation",
        "tmux pane inventory returned an invalid closed row",
        { effectBoundary: "before-send" },
      );
    }
    const [
      sessionName,
      tmuxWindowId,
      paneIdValue,
      paneDead,
      paneCurrentCommand,
      programId,
      hostId,
      windowId,
      observedBindingId,
      observedLocatorId,
    ] = fields;
    const metadataMatches = programId === selector.programId
      && hostId === HOST_ID
      && windowId === selector.windowId
      && observedBindingId === selector.bindingId
      && observedLocatorId === selector.locatorId;
    const coordinateMatches = tmuxWindowId === selector.tmuxWindowId
      || paneIdValue === selector.paneId;
    if (!metadataMatches && !coordinateMatches) {
      continue;
    }
    if (!new Set(["0", "1"]).has(paneDead)) {
      fail(
        "wakeflow-claude-transport-host-observation",
        "tmux pane inventory returned an invalid pane-dead fact",
        { effectBoundary: "before-send" },
      );
    }
    observations.push({
      provider: "tmux",
      socketName: context.socketName,
      sessionName,
      windowId: tmuxWindowId,
      paneId: paneIdValue,
      paneWindowId: tmuxWindowId,
      paneDead: paneDead === "1",
      claudeProcess: paneCurrentCommandIsClaude(paneCurrentCommand),
      metadata: {
        programId,
        hostId,
        windowId,
        bindingId: observedBindingId,
        locatorId: observedLocatorId,
      },
    });
  }
  return observations;
}

// readback只有一次脱敏观察：持久层保存prompt/pane摘要，不保存原文，也不轮询推断任务完成。
function promptMarker(prompt) {
  const line = prompt.split("\n").map((entry) => entry.trim()).find(Boolean) ?? "";
  return line.length < 12 ? "" : line.slice(0, 96);
}

function readbackObservation(endpoint, prompt) {
  const result = executeTmux(endpoint.tmux.socketName, [
    "capture-pane",
    "-p",
    "-t",
    endpoint.tmux.paneId,
  ]);
  const promptDigest = canonicalJsonDigest({ prompt });
  if (!result.ok) {
    return deepFreeze({
      status: "unavailable",
      attempts: 1,
      evidence: [{
        kind: "tmux-pane-observation",
        digest: canonicalJsonDigest({
          schemaVersion: 1,
          available: false,
          promptDigest,
        }),
      }],
    });
  }
  const marker = promptMarker(prompt);
  const promptEchoed = marker.length > 0 && result.stdout.includes(marker);
  return deepFreeze({
    status: promptEchoed ? "confirmed" : "pending",
    attempts: 1,
    evidence: [{
      kind: "tmux-pane-observation",
      digest: canonicalJsonDigest({
        schemaVersion: 1,
        available: true,
        promptDigest,
        paneDigest: canonicalJsonDigest({ paneText: result.stdout }),
        promptEchoed,
      }),
    }],
  });
}

// paste是业务effect边界；buffer用已签发operation ID命名，正常成功/失败路径都尝试清除。
function physicalSend(endpoint, prompt) {
  const bufferName = `wakeflow-${endpoint.operationId}`;
  const bytes = prompt.endsWith("\n") ? prompt : `${prompt}\n`;
  const loaded = executeTmux(endpoint.tmux.socketName, [
    "load-buffer",
    "-b",
    bufferName,
    "-",
  ], { input: bytes });
  if (!loaded.ok) {
    executeTmux(endpoint.tmux.socketName, ["delete-buffer", "-b", bufferName]);
    fail(
      "wakeflow-claude-transport-host-rejected",
      "tmux rejected the in-memory prompt before paste",
      { effectBoundary: "before-send" },
      loaded.cause,
    );
  }
  const pasted = executeTmux(endpoint.tmux.socketName, [
    "paste-buffer",
    "-d",
    "-b",
    bufferName,
    "-t",
    endpoint.tmux.paneId,
  ]);
  if (!pasted.ok) {
    executeTmux(endpoint.tmux.socketName, ["delete-buffer", "-b", bufferName]);
    fail(
      "wakeflow-claude-transport-host-ambiguous",
      "tmux paste had an uncertain physical effect",
      { effectBoundary: "ambiguous" },
      pasted.cause,
    );
  }
  const entered = executeTmux(endpoint.tmux.socketName, [
    "send-keys",
    "-t",
    endpoint.tmux.paneId,
    "Enter",
  ]);
  if (!entered.ok) {
    fail(
      "wakeflow-claude-transport-host-ambiguous",
      "tmux Enter had an uncertain physical effect after paste",
      { effectBoundary: "ambiguous" },
      entered.cause,
    );
  }
  return readbackObservation(endpoint, prompt);
}

function failureOutcome(cause, createdAt) {
  const ambiguous = cause?.details?.effectBoundary === "ambiguous";
  return deepFreeze({
    hostMethod: HOST_METHOD,
    hostMode: HOST_MODE,
    transportStatus: ambiguous ? "ambiguous" : "rejected-before-send",
    readback: { status: "unavailable", attempts: 0, evidence: [] },
    error: {
      code: ambiguous ? "claude-send-ambiguous" : "claude-send-rejected",
      message: ambiguous
        ? "The Claude tmux send crossed the paste boundary but its exact effect is uncertain."
        : "The Claude tmux send was rejected before the paste boundary.",
    },
    createdAt,
  });
}

function acceptedOutcome(readback, createdAt) {
  return deepFreeze({
    hostMethod: HOST_METHOD,
    hostMode: HOST_MODE,
    transportStatus: "accepted",
    readback,
    createdAt,
  });
}

function assertTargetPermitClosure(input, permit) {
  const authority = loadAuthority(input);
  const task = authority.stack.state.targetTasks.find(
    (entry) => entry.targetTaskId === input.targetTaskId,
  ) ?? null;
  const delivery = task?.currentDelivery ?? null;
  if (
    !task
    || task.windowId !== permit.windowId
    || task.lifecycleStatus !== "dispatched"
    || !delivery
    || delivery.phase !== "send-claimed"
    || delivery.sendGeneration !== input.sendGeneration
    || !same(delivery.group, permit.group)
    || !same(delivery.packet, permit.packet)
    || !same(delivery.envelope, permit.envelope)
    || !same(delivery.lease, permit.lease)
    || !same(delivery.claimedBy, permit.claimedBy)
  ) {
    fail("wakeflow-claude-transport-authority", "target send permit is no longer current");
  }
  const transport = transportInventory(input, authority.stack.demand.demandId);
  for (const [family, field, tuple] of [
    ["groups", "groupId", permit.group],
    ["packets", "packetId", permit.packet],
    ["envelopes", "deliveryId", permit.envelope],
  ]) {
    const entry = transport.entries[family].find((candidate) => (
      candidate.record[field] === tuple[field]
    )) ?? null;
    if (!entry || entry.ref !== tuple.ref || entry.digest !== tuple.digest) {
      fail("wakeflow-claude-transport-authority", `target permit ${family} tuple is no longer exact`);
    }
  }
  const envelope = transport.entries.envelopes.find(
    (entry) => entry.record.deliveryId === input.deliveryId,
  ).record;
  const packet = transport.entries.packets.find(
    (entry) => entry.record.packetId === permit.packet.packetId,
  ).record;
  if (
    envelope.preparedByHostId !== HOST_ID
    || envelope.windowId !== permit.windowId
    || envelope.packetId !== packet.packetId
    || envelope.packetDigest !== packet.packetDigest
    || packet.targetTaskId !== input.targetTaskId
    || packet.windowId !== permit.windowId
    || envelope.bindingId !== permit.binding.bindingId
    || envelope.identityRef !== permit.binding.identityRef
    || envelope.identityBindingDigest !== permit.binding.identityBindingDigest
    || envelope.prompt !== permit.prompt
  ) {
    fail("wakeflow-claude-transport-authority", "target permit envelope facts changed");
  }
  const binding = currentBinding(input.workspaceRoot, permit.windowId);
  if (
    binding.windowId !== permit.binding.windowId
    || binding.bindingId !== permit.binding.bindingId
    || binding.identityRef !== permit.binding.identityRef
    || binding.identityBindingDigest !== permit.binding.identityBindingDigest
  ) {
    fail("wakeflow-claude-transport-authority", "target permit binding is no longer current");
  }
  let leases;
  try {
    leases = inspectWindowCoordinationLeaseInventory({ workspaceRoot: input.workspaceRoot });
  } catch (cause) {
    boundary("Claude target lease inventory", cause, "wakeflow-claude-transport-authority");
  }
  const leaseEntry = leases.leases.find((entry) => entry.lease.windowId === permit.windowId) ?? null;
  if (
    !leaseEntry
    || leaseEntry.leaseRef !== permit.lease.ref
    || leaseEntry.lease.leaseId !== permit.lease.leaseId
    || leaseEntry.lease.leaseDigest !== permit.lease.digest
    || leaseEntry.lease.deliveryId !== input.deliveryId
    || leaseEntry.lease.bindingId !== permit.binding.bindingId
    || Date.parse(leaseEntry.lease.expiresAt) <= Date.now()
  ) {
    fail("wakeflow-claude-transport-authority", "target permit lease is absent, stale, or expired");
  }
  return deepFreeze({
    authority,
    binding,
    context: tmuxContext(authority.snapshot),
    updatedAt: authority.stack.state.updatedAt,
  });
}

// locator owner只接受本次mutex签发的operation，并在同一临界区重验live pane与完整metadata。
function endpointForOperation({ workspaceRoot, operation, binding, locator, context }) {
  let observations = null;
  try {
    inspectClaudeWindowLocatorInventory({
      workspaceRoot,
      expectedSocketName: context.socketName,
      observe(current) {
        if (current.windowId !== binding.windowId) return [];
        if (current.locatorId !== locator.locatorId) {
          fail(
            "wakeflow-claude-transport-authority",
            "observed locator generation differs from the locked preflight",
          );
        }
        observations = listRelevantPaneObservations(context, {
          programId: binding.programId,
          windowId: binding.windowId,
          bindingId: binding.bindingId,
          locatorId: current.locatorId,
          tmuxWindowId: current.tmux.windowId,
          paneId: current.tmux.paneId,
        });
        return observations;
      },
    });
  } catch (cause) {
    boundary("Claude bounded pane observation", cause, "wakeflow-claude-transport-authority");
  }
  if (!observations) {
    fail("wakeflow-claude-transport-authority", "current locator was not observed inside its owner inventory");
  }
  try {
    return resolveClaudeWindowOperationEndpoint({
      operation,
      binding: bindingTuple(binding),
      expectedSocketName: context.socketName,
      expectedSessionName: context.sessionName,
      observations,
    });
  } catch (cause) {
    boundary("Claude exact endpoint resolution", cause, "wakeflow-claude-transport-authority");
  }
}

function publicTargetResult(input, operation, recorded, outcome) {
  return deepFreeze({
    kind: "WakeflowClaudeTargetDeliveryExecution",
    schemaVersion: SCHEMA_VERSION,
    status: recorded.status,
    programId: input.expectedProgramId,
    targetTaskId: input.targetTaskId,
    deliveryId: input.deliveryId,
    sendGeneration: input.sendGeneration,
    windowId: operation.windowId,
    operationId: operation.operationId,
    operationSubjectDigest: operation.operationSubjectDigest,
    transportStatus: recorded.delivery.phase,
    readbackStatus: outcome.readback.status,
    run: recorded.run,
    leaseStatus: recorded.leaseStatus,
    revision: recorded.revision,
    stateDigest: recorded.stateDigest,
  });
}

function publicSettledTargetResult(input, task, delivery) {
  return deepFreeze({
    kind: "WakeflowClaudeTargetDeliveryExecution",
    schemaVersion: SCHEMA_VERSION,
    status: "already-settled",
    programId: input.expectedProgramId,
    targetTaskId: input.targetTaskId,
    deliveryId: input.deliveryId,
    sendGeneration: input.sendGeneration,
    windowId: task.windowId,
    transportStatus: delivery.phase,
    run: delivery.latestRun,
    leaseStatus: delivery.phase === "rejected-before-send" ? "released" : "retained",
  });
}

function publicControllerResult(input, operation, recorded) {
  return deepFreeze({
    kind: "WakeflowClaudeControllerReturnExecution",
    schemaVersion: SCHEMA_VERSION,
    status: recorded.status,
    programId: input.expectedProgramId,
    deliveryId: input.deliveryId,
    windowId: operation.windowId,
    operationId: operation.operationId,
    operationSubjectDigest: operation.operationSubjectDigest,
    transportStatus: recorded.transportStatus,
    readbackStatus: recorded.readbackStatus,
    run: recorded.run,
  });
}

function publicControllerPreflightResult(input, preflight) {
  return deepFreeze({
    kind: "WakeflowClaudeControllerReturnExecution",
    schemaVersion: SCHEMA_VERSION,
    status: preflight.status,
    programId: input.expectedProgramId,
    deliveryId: input.deliveryId,
    run: preflight.preSend.run,
  });
}

/** 对一个prepared target delivery执行唯一Claude宿主发送，并由M3 owner记录结果。 */
export async function executeClaudeTargetDelivery(value = {}) {
  const input = normalizeTargetInput(value);
  const preflight = targetPreflight(input);
  if (preflight.status === "already-settled") {
    return publicSettledTargetResult(input, preflight.task, preflight.delivery);
  }
  const subject = deepFreeze({
    kind: "target",
    targetTaskId: input.targetTaskId,
    deliveryId: input.deliveryId,
    sendGeneration: input.sendGeneration,
  });
  const operationSubjectDigest = subjectDigest(input.expectedProgramId, subject);
  try {
    return await withClaudeWindowOperationMutex({
      workspaceRoot: input.workspaceRoot,
      windowId: preflight.task.windowId,
      operationKind: "send",
      operationSubjectDigest,
      expectedBindingId: preflight.binding.bindingId,
      expectedLocatorId: preflight.locator.locatorId,
    }, async (operation) => {
      const currentPreflight = targetPreflight(input);
      if (currentPreflight.status === "already-settled") {
        return publicSettledTargetResult(
          input,
          currentPreflight.task,
          currentPreflight.delivery,
        );
      }
      let permit;
      try {
        permit = await claimTargetDelivery(input);
      } catch (cause) {
        boundary("Claude target send claim", cause, "wakeflow-claude-transport-recovery-required");
      }
      let outcome;
      try {
        const closure = assertTargetPermitClosure(input, permit);
        if (
          closure.authority.snapshot.configDigest
          !== currentPreflight.authority.snapshot.configDigest
        ) {
          fail(
            "wakeflow-claude-transport-authority",
            "target config authority changed after send preflight",
          );
        }
        const endpoint = endpointForOperation({
          workspaceRoot: input.workspaceRoot,
          operation,
          binding: closure.binding,
          locator: currentPreflight.locator,
          context: closure.context,
        });
        assertConfigSnapshotCurrent(input, closure.authority.snapshot);
        const readback = physicalSend(endpoint, permit.prompt);
        outcome = acceptedOutcome(readback, nextTimestamp(closure.updatedAt));
      } catch (cause) {
        outcome = failureOutcome(cause, nextTimestamp(
          loadAuthority(input).stack.state.updatedAt,
        ));
      }
      let recorded;
      try {
        recorded = await recordTargetDeliveryOutcome({ ...input, outcome });
      } catch (cause) {
        boundary("Claude target outcome settlement", cause, "wakeflow-claude-transport-recovery-required");
      }
      return publicTargetResult(input, operation, recorded, outcome);
    }, {
      onFailure: () => ({
        disposition: targetRecoveryDisposition(input, subject, preflight.task.windowId),
      }),
    });
  } catch (cause) {
    boundary("Claude target delivery", cause);
  }
}

/** 把Controller-return envelope发送到Controller窗口；不写目标lease或业务审查决定。 */
export async function executeClaudeControllerReturn(value = {}) {
  const input = normalizeControllerInput(value);
  const preflight = controllerPreflight(input);
  if (preflight.status !== "ready") {
    return publicControllerPreflightResult(input, preflight);
  }
  const subject = deepFreeze({
    kind: "controller-return",
    deliveryId: input.deliveryId,
    runId: input.runId,
  });
  const operationSubjectDigest = subjectDigest(input.expectedProgramId, subject);
  const envelope = preflight.preSend.envelope;
  try {
    return await withClaudeWindowOperationMutex({
      workspaceRoot: input.workspaceRoot,
      windowId: envelope.windowId,
      operationKind: "send",
      operationSubjectDigest,
      expectedBindingId: preflight.preSend.binding.bindingId,
      expectedLocatorId: preflight.locator.locatorId,
    }, async (operation) => {
      let outcome;
      try {
        const current = controllerPreflight(input);
        if (current.status !== "ready") {
          return publicControllerPreflightResult(input, current);
        }
        if (
          !same(current.preSend.envelope, preflight.preSend.envelope)
          || !same(current.preSend.binding, preflight.preSend.binding)
          || current.locator.locatorId !== preflight.locator.locatorId
          || current.authority.snapshot.configDigest
            !== preflight.authority.snapshot.configDigest
        ) {
          fail("wakeflow-claude-transport-authority", "Controller-return authority changed inside its host operation fence");
        }
        const authority = loadAuthority(input);
        if (authority.snapshot.configDigest !== current.authority.snapshot.configDigest) {
          fail(
            "wakeflow-claude-transport-authority",
            "Controller-return config authority changed after send preflight",
          );
        }
        const context = tmuxContext(authority.snapshot);
        const endpoint = endpointForOperation({
          workspaceRoot: input.workspaceRoot,
          operation,
          binding: current.preSend.binding,
          locator: current.locator,
          context,
        });
        assertConfigSnapshotCurrent(input, authority.snapshot);
        const readback = physicalSend(endpoint, current.preSend.envelope.prompt);
        outcome = acceptedOutcome(
          readback,
          nextTimestamp(authority.stack.state.updatedAt, current.preSend.envelope.createdAt),
        );
      } catch (cause) {
        const authority = loadAuthority(input);
        outcome = failureOutcome(
          cause,
          nextTimestamp(authority.stack.state.updatedAt, envelope.createdAt),
        );
      }
      let recorded;
      try {
        recorded = await recordControllerReturnOutcome({ ...input, outcome });
      } catch (cause) {
        boundary("Claude Controller-return settlement", cause, "wakeflow-claude-transport-recovery-required");
      }
      return publicControllerResult(input, operation, recorded);
    }, {
      onFailure: () => ({
        disposition: controllerRecoveryDisposition(input, subject, envelope.windowId),
      }),
    });
  } catch (cause) {
    boundary("Claude Controller return", cause);
  }
}

// 自动失败路径没有公开recovery input，必须显式传入本次preflight已闭合的windowId。
function targetRecoveryDisposition(input, subject, expectedWindowId) {
  const authority = loadAuthority(input);
  const task = authority.stack.state.targetTasks.find(
    (entry) => entry.targetTaskId === subject.targetTaskId,
  ) ?? null;
  const delivery = task?.currentDelivery ?? null;
  const transport = transportInventory(input, authority.stack.demand.demandId);
  const envelope = transport.entries.envelopes.find(
    (entry) => entry.record.deliveryId === subject.deliveryId,
  ) ?? null;
  const packet = envelope
    ? transport.entries.packets.find(
        (entry) => entry.record.packetId === envelope.record.packetId,
      ) ?? null
    : null;
  if (
    !task
    || task.windowId !== expectedWindowId
    || !delivery
    || delivery.sendGeneration !== subject.sendGeneration
    || delivery.envelope.deliveryId !== subject.deliveryId
    || !envelope
    || envelope.record.artifactKind !== "wakeflow-target-delivery-envelope"
    || envelope.record.windowId !== expectedWindowId
    || !packet
    || packet.record.targetTaskId !== subject.targetTaskId
    || packet.record.windowId !== expectedWindowId
    || delivery.packet.packetId !== packet.record.packetId
    || delivery.packet.ref !== packet.ref
    || delivery.packet.digest !== packet.digest
    || delivery.envelope.ref !== envelope.ref
    || delivery.envelope.digest !== envelope.digest
  ) {
    fail(
      "wakeflow-claude-transport-recovery-subject",
      "target recovery subject does not close over its exact task, packet, envelope, and window",
    );
  }
  const claim = authority.stack.events.find((event) => (
    event.command === "claim-target-delivery-send"
    && event.deliveryTransition?.targetTaskId === subject.targetTaskId
    && event.deliveryTransition?.deliveryId === subject.deliveryId
    && event.deliveryTransition?.sendGeneration === subject.sendGeneration
  )) ?? null;
  if (!claim) {
    return delivery.phase === "prepared" && task.lifecycleStatus === "dispatched"
      ? "safe-to-release"
      : "retain-for-recovery";
  }
  const run = transport.entries.runs.find((entry) => (
    entry.record.deliveryId === subject.deliveryId
    && entry.record.attemptOrdinal === subject.sendGeneration
  )) ?? null;
  if (!run) return "retain-for-recovery";
  const settlement = authority.stack.events.find((event) => (
    event.command === "record-target-delivery-run"
    && event.deliveryTransition?.targetTaskId === subject.targetTaskId
    && event.deliveryTransition?.deliveryId === subject.deliveryId
    && event.deliveryTransition?.sendGeneration === subject.sendGeneration
    && event.deliveryTransition?.run?.runId === run.record.runId
    && event.deliveryTransition?.run?.digest === run.digest
  )) ?? null;
  const stateRunMatches = delivery.latestRun?.runId === run.record.runId
    && delivery.latestRun?.ref === run.ref
    && delivery.latestRun?.digest === run.digest;
  return settlement && stateRunMatches ? "safe-to-release" : "retain-for-recovery";
}

function controllerRecoveryDisposition(input, subject, expectedWindowId) {
  const authority = loadAuthority(input);
  const transport = transportInventory(input, authority.stack.demand.demandId);
  const envelope = transport.entries.envelopes.find((entry) => (
    entry.record.deliveryId === subject.deliveryId
  )) ?? null;
  if (
    !envelope
    || envelope.record.artifactKind !== "wakeflow-controller-return-envelope"
    || envelope.record.windowId !== expectedWindowId
  ) {
    fail(
      "wakeflow-claude-transport-recovery-subject",
      "Controller recovery subject does not close over its exact envelope and window",
    );
  }
  const run = transport.entries.runs.find((entry) => (
    entry.record.runId === subject.runId
    && entry.record.deliveryId === subject.deliveryId
  )) ?? null;
  return run ? "safe-to-release" : "retain-for-recovery";
}

/** 根据exact subject与durable state/run/event证明释放或继续保留一个失败的发送mutex。 */
export async function recoverClaudeTransportOperation(value = {}) {
  const input = normalizeRecoveryInput(value);
  const expectedSubjectDigest = subjectDigest(input.expectedProgramId, input.subject);
  try {
    const result = await recoverClaudeWindowOperationMutex({
      workspaceRoot: input.workspaceRoot,
      windowId: input.windowId,
      operationId: input.operationId,
    }, (operation) => {
      if (
        operation.operationKind !== "send"
        || operation.windowId !== input.windowId
        || operation.operationSubjectDigest !== expectedSubjectDigest
      ) {
        fail(
          "wakeflow-claude-transport-recovery-subject",
          "retained operation does not belong to the exact transport subject",
        );
      }
      const disposition = input.subject.kind === "target"
        ? targetRecoveryDisposition(input, input.subject, input.windowId)
        : controllerRecoveryDisposition(input, input.subject, input.windowId);
      return { disposition };
    });
    return deepFreeze({
      kind: "WakeflowClaudeTransportOperationRecovery",
      schemaVersion: SCHEMA_VERSION,
      status: result.status,
      programId: input.expectedProgramId,
      windowId: input.windowId,
      operationId: input.operationId,
      operationSubjectDigest: expectedSubjectDigest,
    });
  } catch (cause) {
    boundary("Claude transport operation recovery", cause, "wakeflow-claude-transport-recovery-required");
  }
}
