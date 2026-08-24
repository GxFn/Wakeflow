/**
 * Claude Code 窗口物理生命周期的宿主专属编排器。
 *
 * 能力导航：
 * - preflight：观察tmux与Claude命令是否可用，但不把可用性当成窗口authority。
 * - launch/resume：解析strict config中的root、标题和启动偏好，执行一次物理创建。
 * - identity/locator收口：复用binding owner保存私有session handle，再由locator owner发布坐标。
 * - retitle/arrange：在逐窗口operation mutex内取得唯一live endpoint后执行精确宿主效果。
 * - fleet inspection：组合当前binding、locator与一次pane观察形成脱敏诊断。
 * - default adapter：把上述窄宿主效果翻译为参数数组和逐值quoted的tmux/Claude命令调用。
 *
 * 本文件不拥有config写入、binding/locator存储codec、transport发送、close证明、Pod或业务状态；
 * 宿主效果后的不确定性必须由locator operation lock保留并走owner-specific recovery。
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { canonicalJsonDigest } from "./wakeflow-canonical-json.mjs";
import { loadWakeflowConfigV3Snapshot } from "./wakeflow-config-v3-snapshot.mjs";
import { hostProfile } from "./wakeflow-host-profile.mjs";
import {
  commitClaudeWindowLocator,
  createClaudeWindowLocatorRecord,
  generateClaudeWindowLocatorId,
  inspectClaudeWindowLocatorInventory,
  inspectClaudeWindowLocatorObservation,
  resolveClaudeWindowOperationEndpoint,
  withClaudeWindowOperationMutex,
} from "./wakeflow-claude-locator.mjs";
import {
  inspectWindowBindingInventory,
  registerWindowBinding,
  withCurrentWindowBindingHandle,
} from "./wakeflow-window-binding-service.mjs";

export const WAKEFLOW_CLAUDE_LIFECYCLE_HOST_ID = "claude-code";
export const WAKEFLOW_CLAUDE_LIFECYCLE_SCHEMA_VERSION = 1;

const HOST_ID = WAKEFLOW_CLAUDE_LIFECYCLE_HOST_ID;
const DEFAULT_TMUX_SESSION = "wakeflow";
const MAX_PANES = 4_096;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_BOOT_WAIT_MS = 30_000;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/u;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TMUX_WINDOW_ID_RE = /^@[0-9]+$/u;
const TMUX_PANE_ID_RE = /^%[0-9]+$/u;
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

/** 统一承载Claude lifecycle的稳定错误码和脱敏诊断。 */
export class WakeflowClaudeLifecycleError extends Error {
  constructor(code, message, { details = {} } = {}) {
    super(message);
    this.name = "WakeflowClaudeLifecycleError";
    this.code = code;
    this.details = deepFreeze({ ...details });
  }
}

function fail(code, message, details = {}) {
  throw new WakeflowClaudeLifecycleError(code, message, { details });
}

function boundary(label, cause, code = "wakeflow-claude-lifecycle-operation") {
  if (cause instanceof WakeflowClaudeLifecycleError) throw cause;
  fail(code, `${label} failed closed`, {
    causeCode: typeof cause?.code === "string" ? cause.code : null,
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, required, optional, label) {
  if (!plainObject(value)) fail("wakeflow-claude-lifecycle-contract", `${label} must be one plain data object`);
  const allowed = new Set([...required, ...optional]);
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== "string" || !allowed.has(key))
    || required.some((key) => !Object.hasOwn(value, key))
  ) {
    fail("wakeflow-claude-lifecycle-contract", `${label} has the wrong field set`);
  }
  const result = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-claude-lifecycle-contract", `${label} fields must be enumerable data properties`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

// 宿主回调返回的数组只允许标准原型、连续own data索引和唯一length。
function exactDataArray(value, label, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail("wakeflow-claude-lifecycle-observation", `${label} must be one standard array`);
  }
  const keys = Reflect.ownKeys(value);
  if (
    value.length > maximum
    || keys.length !== value.length + 1
    || keys.at(-1) !== "length"
  ) {
    fail(
      "wakeflow-claude-lifecycle-observation",
      `${label} must be bounded, dense and have no extra fields`,
    );
  }
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      keys[index] !== key
      || !descriptor?.enumerable
      || !Object.hasOwn(descriptor, "value")
    ) {
      fail(
        "wakeflow-claude-lifecycle-observation",
        `${label}[${index}] must be one enumerable data property`,
      );
    }
  }
  return value;
}

function token(value, label, max = 512) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || value.length > max
    || CONTROL_RE.test(value)
  ) {
    fail("wakeflow-claude-lifecycle-contract", `${label} must be one bounded non-empty token`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail("wakeflow-claude-lifecycle-contract", `${label} must be one sha256 digest`);
  }
  return value;
}

function boundedWait(value) {
  if (value === undefined) return 6_000;
  if (!Number.isInteger(value) || value < 0 || value > MAX_BOOT_WAIT_MS) {
    fail("wakeflow-claude-lifecycle-contract", "bootWaitMs must be an integer from 0 through 30000");
  }
  return value;
}

function normalizeWorkspaceRoot(value) {
  const root = token(value, "workspaceRoot", 4_096);
  if (!path.isAbsolute(root) || path.resolve(root) !== root) {
    fail("wakeflow-claude-lifecycle-workspace", "workspaceRoot must be one normalized absolute path");
  }
  let stat;
  try {
    stat = fs.lstatSync(root);
  } catch {
    fail("wakeflow-claude-lifecycle-workspace", "workspaceRoot is unavailable");
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("wakeflow-claude-lifecycle-workspace", "workspaceRoot must be one real directory");
  }
  try {
    return fs.realpathSync.native(root);
  } catch {
    fail("wakeflow-claude-lifecycle-workspace", "workspaceRoot cannot be resolved");
  }
}

function loadAuthority(input) {
  const workspaceRoot = normalizeWorkspaceRoot(input.workspaceRoot);
  let snapshot;
  try {
    snapshot = loadWakeflowConfigV3Snapshot({ workspaceRoot });
  } catch (cause) {
    boundary("strict v3 config authority", cause, "wakeflow-claude-lifecycle-config");
  }
  const expectedProgramId = token(input.expectedProgramId, "expectedProgramId");
  if (snapshot.model.program.programId !== expectedProgramId) {
    fail("wakeflow-claude-lifecycle-program", "expectedProgramId differs from current config authority");
  }
  return Object.freeze({ workspaceRoot, snapshot });
}

// operation mutex落盘后再次绑定最初决策的config digest，避免用新authority执行旧root/标题/偏好。
function assertAuthorityCurrent(authority) {
  let current;
  try {
    current = loadWakeflowConfigV3Snapshot({ workspaceRoot: authority.workspaceRoot });
  } catch (cause) {
    boundary("current v3 config authority", cause, "wakeflow-claude-lifecycle-config");
  }
  if (
    current.configDigest !== authority.snapshot.configDigest
    || current.model.program.programId !== authority.snapshot.model.program.programId
  ) {
    fail(
      "wakeflow-claude-lifecycle-authority-drift",
      "current config authority differs from the lifecycle decision snapshot",
    );
  }
  return current;
}

function configuredWindow(authority, windowIdValue) {
  const windowId = token(windowIdValue, "windowId");
  const window = authority.snapshot.indexes.windowById[windowId] ?? null;
  if (!window) fail("wakeflow-claude-lifecycle-window", "windowId is not one configured stable window");
  return window;
}

function configuredRoot(authority, window) {
  let configuredPath = ".";
  if (window.root.kind === "repository") {
    configuredPath = authority.snapshot.indexes.repositoryById[window.root.repositoryId]?.path ?? null;
  } else if (window.root.kind === "support-surface") {
    configuredPath = authority.snapshot.indexes.surfaceById[window.root.surfaceId]?.path ?? null;
  }
  if (configuredPath === null) {
    fail("wakeflow-claude-lifecycle-window", "window root no longer resolves through current topology");
  }
  const candidate = configuredPath === "."
    ? authority.workspaceRoot
    : path.resolve(authority.workspaceRoot, ...configuredPath.split("/"));
  let stat;
  try {
    stat = fs.lstatSync(candidate);
  } catch {
    fail("wakeflow-claude-lifecycle-root", "configured window root is unavailable");
  }
  if (!stat.isDirectory()) fail("wakeflow-claude-lifecycle-root", "configured window root is not a directory");
  try {
    return fs.realpathSync.native(candidate);
  } catch {
    fail("wakeflow-claude-lifecycle-root", "configured window root cannot be resolved");
  }
}

function tmuxContext(snapshot) {
  const configured = snapshot.model.hosts?.[HOST_ID]?.tmux ?? {};
  return deepFreeze({
    socketName: configured.socketName ?? null,
    sessionName: configured.sessionName ?? DEFAULT_TMUX_SESSION,
  });
}

function launchPreferences(snapshot, window) {
  const configured = snapshot.model.hosts?.[HOST_ID]?.launch ?? {};
  const defaults = hostProfile.launch?.effortByRole ?? {};
  const choose = (map, fallback = {}) => map?.[window.role] ?? map?.default
    ?? fallback?.[window.role] ?? fallback?.default ?? null;
  return deepFreeze({
    permissionMode: configured.permissionMode ?? "acceptEdits",
    effort: choose(configured.reasoningEffortByRole, defaults),
    model: choose(configured.modelByRole),
  });
}

function bindingForWindow(inventory, windowId) {
  return inventory.bindings.find((entry) => entry.windowId === windowId) ?? null;
}

function locatorForWindow(inventory, windowId) {
  return inventory.windows.find((entry) => entry.windowId === windowId)?.locator ?? null;
}

function bindingTuple(binding) {
  return {
    programId: binding.programId,
    hostId: binding.hostId,
    windowId: binding.windowId,
    bindingId: binding.bindingId,
  };
}

function operationSubject(kind, authority, window, binding = null, locator = null) {
  return canonicalJsonDigest({
    kind,
    programId: authority.snapshot.model.program.programId,
    configDigest: authority.snapshot.configDigest,
    windowId: window.windowId,
    ...(binding === null ? {} : {
      bindingId: binding.bindingId,
      bindingDigest: binding.identityBindingDigest,
    }),
    ...(locator === null ? {} : { locatorId: locator.locatorId, locatorDigest: locator.digest }),
  });
}

function sessionId(uuidFactory) {
  let value;
  try {
    value = uuidFactory();
  } catch {
    fail("wakeflow-claude-lifecycle-id", "Claude session UUID source failed");
  }
  if (typeof value !== "string" || !SESSION_ID_RE.test(value)) {
    fail("wakeflow-claude-lifecycle-id", "Claude session UUID source returned an invalid UUIDv4");
  }
  return value;
}

function normalizeCoordinate(value, context) {
  const coordinate = exactObject(
    value,
    ["socketName", "sessionName", "windowId", "paneId"],
    [],
    "Claude physical coordinate",
  );
  if (
    coordinate.socketName !== context.socketName
    || coordinate.sessionName !== context.sessionName
    || typeof coordinate.windowId !== "string"
    || !TMUX_WINDOW_ID_RE.test(coordinate.windowId)
    || typeof coordinate.paneId !== "string"
    || !TMUX_PANE_ID_RE.test(coordinate.paneId)
  ) {
    fail("wakeflow-claude-lifecycle-coordinate", "Claude physical coordinate differs from the exact host context");
  }
  return deepFreeze({
    socketName: coordinate.socketName,
    sessionName: coordinate.sessionName,
    windowId: coordinate.windowId,
    paneId: coordinate.paneId,
  });
}

function normalizePaneInventory(value) {
  exactDataArray(value, "host pane inventory", MAX_PANES);
  return Object.freeze(value.map((raw, index) => {
    const entry = exactObject(raw, [
      "provider",
      "socketName",
      "sessionName",
      "windowId",
      "paneId",
      "paneWindowId",
      "paneDead",
      "claudeProcess",
      "metadata",
    ], [], `host pane inventory[${index}]`);
    const metadata = exactObject(entry.metadata, [
      "programId",
      "hostId",
      "windowId",
      "bindingId",
      "locatorId",
    ], [], `host pane inventory[${index}].metadata`);
    return deepFreeze({ ...entry, metadata });
  }));
}

function relevantObservations(observations, locator) {
  return observations.filter((entry) => (
    entry.socketName === locator.tmux.socketName
    && (
      entry.windowId === locator.tmux.windowId
      || entry.paneId === locator.tmux.paneId
      || (
        entry.metadata.programId === locator.programId
        && entry.metadata.hostId === locator.hostId
        && entry.metadata.windowId === locator.windowId
        && entry.metadata.bindingId === locator.bindingId
        && entry.metadata.locatorId === locator.locatorId
      )
    )
  ));
}

function publicLifecycleResult(action, authority, window, binding, locatorCommit = null) {
  return deepFreeze({
    kind: "WakeflowClaudeWindowLifecycleResult",
    schemaVersion: WAKEFLOW_CLAUDE_LIFECYCLE_SCHEMA_VERSION,
    action,
    status: "completed",
    programId: authority.snapshot.model.program.programId,
    hostId: HOST_ID,
    windowId: window.windowId,
    role: window.role,
    binding: {
      bindingId: binding.bindingId,
      ref: binding.identityRef,
      digest: binding.identityBindingDigest,
    },
    ...(locatorCommit === null ? {} : {
      locator: {
        locatorId: locatorCommit.locatorId,
        ref: locatorCommit.ref,
        digest: locatorCommit.digest,
      },
    }),
  });
}

function normalizeHostAdapter(value) {
  const adapter = value ?? defaultClaudeLifecycleHostAdapter;
  const snapshot = exactObject(
    adapter,
    ["probe", "createWindow", "writeMetadata", "listPanes", "renameWindow", "arrangeWindows", "closeWindow"],
    [],
    "Claude lifecycle host adapter",
  );
  for (const [key, callback] of Object.entries(snapshot)) {
    if (typeof callback !== "function") {
      fail("wakeflow-claude-lifecycle-adapter", `host adapter ${key} must be a function`);
    }
  }
  return Object.freeze(snapshot);
}

function normalizeAdapters(value = {}) {
  const snapshot = exactObject(
    value,
    [],
    ["host", "uuidFactory", "clock"],
    "Claude lifecycle adapters",
  );
  if (Object.hasOwn(snapshot, "uuidFactory") && typeof snapshot.uuidFactory !== "function") {
    fail("wakeflow-claude-lifecycle-adapter", "uuidFactory must be a function");
  }
  if (Object.hasOwn(snapshot, "clock") && typeof snapshot.clock !== "function") {
    fail("wakeflow-claude-lifecycle-adapter", "clock must be a function");
  }
  return Object.freeze({
    host: normalizeHostAdapter(snapshot.host),
    uuidFactory: snapshot.uuidFactory ?? randomUUID,
    clock: snapshot.clock ?? (() => new Date().toISOString()),
  });
}

async function invokeHost(callback, input, label) {
  try {
    return await callback(input);
  } catch (cause) {
    boundary(label, cause, "wakeflow-claude-lifecycle-host-effect");
  }
}

function assertHostEffectReceipt(value, expectedStatus, label) {
  const receipt = exactObject(value, ["status"], [], label);
  if (receipt.status !== expectedStatus) {
    fail(
      "wakeflow-claude-lifecycle-host-effect",
      `${label} did not confirm ${expectedStatus}`,
    );
  }
  return Object.freeze({ status: expectedStatus });
}

function launchInput(value, label) {
  const snapshot = exactObject(
    value,
    ["workspaceRoot", "expectedProgramId", "windowId"],
    ["bootWaitMs"],
    label,
  );
  return Object.freeze({
    workspaceRoot: snapshot.workspaceRoot,
    expectedProgramId: snapshot.expectedProgramId,
    windowId: snapshot.windowId,
    bootWaitMs: boundedWait(snapshot.bootWaitMs),
  });
}

async function materializeLocator({
  authority,
  window,
  binding,
  operation,
  coordinate,
  locatorId,
  bootWaitMs,
  adapters,
}) {
  const metadata = deepFreeze({
    programId: authority.snapshot.model.program.programId,
    hostId: HOST_ID,
    windowId: window.windowId,
    bindingId: binding.bindingId,
    locatorId,
  });
  assertAuthorityCurrent(authority);
  await invokeHost(adapters.host.writeMetadata, {
    context: tmuxContext(authority.snapshot),
    coordinate,
    metadata,
  }, "Claude exact metadata write");
  assertAuthorityCurrent(authority);
  const locatedAt = adapters.clock();
  const locator = createClaudeWindowLocatorRecord({
    programId: metadata.programId,
    windowId: metadata.windowId,
    bindingId: metadata.bindingId,
    locatorId: metadata.locatorId,
    tmux: coordinate,
    locatedAt,
  });
  assertAuthorityCurrent(authority);
  const deadline = Date.now() + bootWaitMs;
  let observation;
  while (true) {
    const observations = normalizePaneInventory(await invokeHost(adapters.host.listPanes, {
      context: tmuxContext(authority.snapshot),
    }, "Claude pane observation"));
    assertAuthorityCurrent(authority);
    observation = inspectClaudeWindowLocatorObservation({
      locator,
      binding: bindingTuple(binding),
      expectedSocketName: coordinate.socketName,
      observations: relevantObservations(observations, locator),
    });
    if (observation.status === "live" && observation.authorityEligible === true) break;
    if (
      !new Set(["missing", "process-mismatch"]).has(observation.status)
      || Date.now() >= deadline
    ) {
      fail("wakeflow-claude-lifecycle-not-live", "created Claude window has no unique live metadata-bound pane", {
        status: observation.status,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const committed = await commitClaudeWindowLocator({
    operation,
    locator,
    observation,
    expectedSocketName: coordinate.socketName,
  });
  assertAuthorityCurrent(authority);
  return committed;
}

/** 只读观察tmux/Claude命令可用性，并在await后复验同一config snapshot。 */
export async function inspectClaudeHostPreflight(value = {}, adapters = {}) {
  const input = exactObject(value, ["workspaceRoot", "expectedProgramId"], [], "Claude host preflight input");
  const authority = loadAuthority(input);
  const normalized = normalizeAdapters(adapters);
  const observed = await invokeHost(normalized.host.probe, {
    context: tmuxContext(authority.snapshot),
  }, "Claude host preflight");
  const observation = exactObject(
    observed,
    ["tmuxAvailable", "claudeAvailable"],
    [],
    "Claude host preflight observation",
  );
  assertAuthorityCurrent(authority);
  if (typeof observation.tmuxAvailable !== "boolean" || typeof observation.claudeAvailable !== "boolean") {
    fail("wakeflow-claude-lifecycle-observation", "Claude host preflight booleans are invalid");
  }
  return deepFreeze({
    kind: "WakeflowClaudeHostPreflight",
    schemaVersion: WAKEFLOW_CLAUDE_LIFECYCLE_SCHEMA_VERSION,
    programId: authority.snapshot.model.program.programId,
    hostId: HOST_ID,
    configDigest: authority.snapshot.configDigest,
    status: observation.tmuxAvailable && observation.claudeAvailable ? "ready" : "unavailable",
    capabilities: {
      tmux: observation.tmuxAvailable ? "available" : "unavailable",
      claude: observation.claudeAvailable ? "available" : "unavailable",
    },
  });
}

/** 为尚无binding/locator的配置窗口创建一次物理Claude窗口并收口identity与locator。 */
export async function launchClaudeWindow(value = {}, adapters = {}) {
  const input = launchInput(value, "Claude launch input");
  const authority = loadAuthority(input);
  const window = configuredWindow(authority, input.windowId);
  const normalized = normalizeAdapters(adapters);
  const identity = inspectWindowBindingInventory({ workspaceRoot: authority.workspaceRoot });
  const locatorInventory = inspectClaudeWindowLocatorInventory({ workspaceRoot: authority.workspaceRoot });
  if (bindingForWindow(identity, window.windowId) !== null || locatorForWindow(locatorInventory, window.windowId) !== null) {
    fail("wakeflow-claude-lifecycle-already-bound", "initial launch requires no current binding or locator");
  }
  const context = tmuxContext(authority.snapshot);
  const root = configuredRoot(authority, window);
  const preferences = launchPreferences(authority.snapshot, window);
  let physicalAttempted = false;
  return withClaudeWindowOperationMutex({
    workspaceRoot: authority.workspaceRoot,
    windowId: window.windowId,
    operationKind: "launch",
    operationSubjectDigest: operationSubject("launch", authority, window),
    expectedBindingId: null,
    expectedLocatorId: null,
  }, async (operation) => {
    const handleValue = sessionId(normalized.uuidFactory);
    const locatorId = generateClaudeWindowLocatorId(normalized.uuidFactory);
    assertAuthorityCurrent(authority);
    physicalAttempted = true;
    const created = await invokeHost(normalized.host.createWindow, {
      mode: "launch",
      context,
      windowId: window.windowId,
      title: window.displayName,
      cwd: root,
      workspaceRoot: authority.workspaceRoot,
      sessionId: handleValue,
      preferences,
      bootWaitMs: input.bootWaitMs,
    }, "Claude physical launch");
    const coordinate = normalizeCoordinate(created, context);
    assertAuthorityCurrent(authority);
    const binding = await registerWindowBinding({
      workspaceRoot: authority.workspaceRoot,
      windowId: window.windowId,
      handle: { kind: "claude-session", value: handleValue },
    });
    const locatorCommit = await materializeLocator({
      authority,
      window,
      binding,
      operation,
      coordinate,
      locatorId,
      bootWaitMs: input.bootWaitMs,
      adapters: normalized,
    });
    return publicLifecycleResult("launch", authority, window, binding, locatorCommit);
  }, {
    onFailure: () => ({
      disposition: physicalAttempted ? "retain-for-recovery" : "safe-to-release",
    }),
  });
}

/** 在旧locator已确认为missing/dead时复用私有session handle并发布新locator generation。 */
export async function resumeClaudeWindow(value = {}, adapters = {}) {
  const input = launchInput(value, "Claude resume input");
  const authority = loadAuthority(input);
  const window = configuredWindow(authority, input.windowId);
  const normalized = normalizeAdapters(adapters);
  const identity = inspectWindowBindingInventory({ workspaceRoot: authority.workspaceRoot });
  const binding = bindingForWindow(identity, window.windowId);
  if (binding === null) fail("wakeflow-claude-lifecycle-binding", "resume requires one current identity binding");
  const context = tmuxContext(authority.snapshot);
  const observedPanes = normalizePaneInventory(await invokeHost(
    normalized.host.listPanes,
    { context },
    "Claude pre-resume observation",
  ));
  const locatorInventory = inspectClaudeWindowLocatorInventory({
    workspaceRoot: authority.workspaceRoot,
    expectedSocketName: context.socketName,
    observe: (record) => relevantObservations(observedPanes, record),
  });
  const currentLocator = locatorForWindow(locatorInventory, window.windowId);
  if (currentLocator !== null && !new Set(["missing", "pane-dead"]).has(currentLocator.status)) {
    fail("wakeflow-claude-lifecycle-resume-live", "resume requires the previous exact physical generation to be absent or dead", {
      status: currentLocator.status,
    });
  }
  const expectedLocatorId = currentLocator?.locatorId ?? null;
  const root = configuredRoot(authority, window);
  const preferences = launchPreferences(authority.snapshot, window);
  let physicalAttempted = false;
  return withClaudeWindowOperationMutex({
    workspaceRoot: authority.workspaceRoot,
    windowId: window.windowId,
    operationKind: "resume",
    operationSubjectDigest: operationSubject("resume", authority, window, binding, currentLocator),
    expectedBindingId: binding.bindingId,
    expectedLocatorId,
  }, async (operation) => withCurrentWindowBindingHandle({
    workspaceRoot: authority.workspaceRoot,
    windowId: window.windowId,
    expectedBindingId: binding.bindingId,
    expectedBindingDigest: binding.identityBindingDigest,
  }, async (handle) => {
    const locatorId = generateClaudeWindowLocatorId(normalized.uuidFactory);
    assertAuthorityCurrent(authority);
    physicalAttempted = true;
    const created = await invokeHost(normalized.host.createWindow, {
      mode: "resume",
      context,
      windowId: window.windowId,
      title: window.displayName,
      cwd: root,
      workspaceRoot: authority.workspaceRoot,
      sessionId: handle.value,
      preferences,
      bootWaitMs: input.bootWaitMs,
    }, "Claude physical resume");
    const coordinate = normalizeCoordinate(created, context);
    assertAuthorityCurrent(authority);
    const locatorCommit = await materializeLocator({
      authority,
      window,
      binding,
      operation,
      coordinate,
      locatorId,
      bootWaitMs: input.bootWaitMs,
      adapters: normalized,
    });
    return publicLifecycleResult("resume", authority, window, binding, locatorCommit);
  }), {
    onFailure: () => ({
      disposition: physicalAttempted ? "retain-for-recovery" : "safe-to-release",
    }),
  });
}

function exactCurrentTuple(authority, windowId) {
  const identity = inspectWindowBindingInventory({ workspaceRoot: authority.workspaceRoot });
  const binding = bindingForWindow(identity, windowId);
  if (binding === null) fail("wakeflow-claude-lifecycle-binding", "operation requires one current identity binding");
  const locators = inspectClaudeWindowLocatorInventory({ workspaceRoot: authority.workspaceRoot });
  const locator = locatorForWindow(locators, windowId);
  if (locator === null) fail("wakeflow-claude-lifecycle-locator", "operation requires one current Claude locator");
  return Object.freeze({ binding, locator });
}

/** 在唯一live endpoint上把物理窗口标题收敛到当前配置显示名。 */
export async function retitleClaudeWindow(value = {}, adapters = {}) {
  const input = exactObject(
    value,
    ["workspaceRoot", "expectedProgramId", "windowId"],
    [],
    "Claude retitle input",
  );
  const authority = loadAuthority(input);
  const window = configuredWindow(authority, input.windowId);
  const normalized = normalizeAdapters(adapters);
  const { binding, locator } = exactCurrentTuple(authority, window.windowId);
  const context = tmuxContext(authority.snapshot);
  return withClaudeWindowOperationMutex({
    workspaceRoot: authority.workspaceRoot,
    windowId: window.windowId,
    operationKind: "retitle",
    operationSubjectDigest: operationSubject("retitle", authority, window, binding, locator),
    expectedBindingId: binding.bindingId,
    expectedLocatorId: locator.locatorId,
  }, async (operation) => {
    assertAuthorityCurrent(authority);
    const observations = normalizePaneInventory(await invokeHost(
      normalized.host.listPanes,
      { context },
      "Claude retitle observation",
    ));
    assertAuthorityCurrent(authority);
    const endpoint = resolveClaudeWindowOperationEndpoint({
      operation,
      binding: bindingTuple(binding),
      expectedSocketName: context.socketName,
      expectedSessionName: context.sessionName,
      observations,
    });
    const receipt = await invokeHost(normalized.host.renameWindow, {
      endpoint,
      title: window.displayName,
    }, "Claude exact retitle");
    assertHostEffectReceipt(receipt, "renamed", "Claude retitle receipt");
    assertAuthorityCurrent(authority);
    return publicLifecycleResult("retitle", authority, window, binding);
  }, {
    onFailure: () => ({ disposition: "retain-for-recovery" }),
  });
}

async function withFleetMutex(entries, index, operations, callback) {
  if (index >= entries.length) return callback(operations);
  const entry = entries[index];
  return withClaudeWindowOperationMutex({
    workspaceRoot: entry.authority.workspaceRoot,
    windowId: entry.window.windowId,
    operationKind: "arrange",
    operationSubjectDigest: operationSubject(
      "arrange",
      entry.authority,
      entry.window,
      entry.binding,
      entry.locator,
    ),
    expectedBindingId: entry.binding.bindingId,
    expectedLocatorId: entry.locator.locatorId,
  }, async (operation) => withFleetMutex(entries, index + 1, [...operations, operation], callback), {
    onFailure: () => ({ disposition: "retain-for-recovery" }),
  });
}

/** 按stable window ID持有全量窗口锁，再把所有live endpoint收敛到确定顺序。 */
export async function arrangeClaudeWindows(value = {}, adapters = {}) {
  const input = exactObject(value, ["workspaceRoot", "expectedProgramId"], [], "Claude arrange input");
  const authority = loadAuthority(input);
  const normalized = normalizeAdapters(adapters);
  const entries = authority.snapshot.model.topology.windows
    .map((window) => ({ authority, window, ...exactCurrentTuple(authority, window.windowId) }))
    .sort((left, right) => left.window.windowId.localeCompare(right.window.windowId));
  const context = tmuxContext(authority.snapshot);
  return withFleetMutex(entries, 0, [], async (operations) => {
    assertAuthorityCurrent(authority);
    const observations = normalizePaneInventory(await invokeHost(
      normalized.host.listPanes,
      { context },
      "Claude arrange observation",
    ));
    assertAuthorityCurrent(authority);
    const endpoints = entries.map((entry, index) => resolveClaudeWindowOperationEndpoint({
      operation: operations[index],
      binding: bindingTuple(entry.binding),
      expectedSocketName: context.socketName,
      expectedSessionName: context.sessionName,
      observations,
    }));
    const receipt = await invokeHost(
      normalized.host.arrangeWindows,
      { context, endpoints },
      "Claude exact fleet arrange",
    );
    assertHostEffectReceipt(receipt, "arranged", "Claude arrange receipt");
    assertAuthorityCurrent(authority);
    return deepFreeze({
      kind: "WakeflowClaudeWindowArrangeResult",
      schemaVersion: WAKEFLOW_CLAUDE_LIFECYCLE_SCHEMA_VERSION,
      status: "completed",
      programId: authority.snapshot.model.program.programId,
      hostId: HOST_ID,
      windowIds: entries.map((entry) => entry.window.windowId),
    });
  });
}

/** 组合一次pane快照与当前binding/locator库存，返回非授权性的脱敏fleet诊断。 */
export async function inspectClaudeWindowFleet(value = {}, adapters = {}) {
  const input = exactObject(
    value,
    ["workspaceRoot", "expectedProgramId"],
    [],
    "Claude fleet inspection input",
  );
  const authority = loadAuthority(input);
  const normalized = normalizeAdapters(adapters);
  const context = tmuxContext(authority.snapshot);
  const observations = normalizePaneInventory(await invokeHost(
    normalized.host.listPanes,
    { context },
    "Claude fleet observation",
  ));
  assertAuthorityCurrent(authority);
  const identity = inspectWindowBindingInventory({ workspaceRoot: authority.workspaceRoot });
  const locators = inspectClaudeWindowLocatorInventory({
    workspaceRoot: authority.workspaceRoot,
    expectedSocketName: context.socketName,
    observe: (record) => relevantObservations(observations, record),
  });
  const configuredIds = new Set(authority.snapshot.model.topology.windows.map((entry) => entry.windowId));
  const allIds = [...new Set([
    ...configuredIds,
    ...identity.bindings.map((entry) => entry.windowId),
    ...locators.windows.map((entry) => entry.windowId),
  ])].sort();
  const windows = allIds.map((windowId) => {
    const configured = authority.snapshot.indexes.windowById[windowId] ?? null;
    const binding = bindingForWindow(identity, windowId);
    const locator = locatorForWindow(locators, windowId);
    return deepFreeze({
      windowId,
      membership: configured === null ? "host-identity-only" : "configured",
      role: configured?.role ?? null,
      binding: binding === null ? "missing" : "current",
      locator: locator?.status ?? "missing",
      authorityEligible: binding !== null && locator?.status === "live",
    });
  });
  assertAuthorityCurrent(authority);
  return deepFreeze({
    kind: "WakeflowClaudeWindowFleetInspection",
    schemaVersion: WAKEFLOW_CLAUDE_LIFECYCLE_SCHEMA_VERSION,
    programId: authority.snapshot.model.program.programId,
    hostId: HOST_ID,
    configDigest: authority.snapshot.configDigest,
    status: windows.every((entry) => entry.authorityEligible) ? "current" : "attention-required",
    authorityEligible: false,
    windows,
    issues: windows
      .filter((entry) => !entry.authorityEligible)
      .map((entry) => `${entry.windowId}:${entry.binding}/${entry.locator}`),
  });
}

function executable(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (typeof value !== "string" || !value || value !== value.trim() || CONTROL_RE.test(value)) {
    fail("wakeflow-claude-lifecycle-host-command", `${name} is invalid`);
  }
  return value;
}

function tmuxArgs(socketName, args) {
  return socketName === null ? args : ["-L", socketName, ...args];
}

function hostExec(command, args, { input } = {}) {
  const environment = { ...process.env };
  // socketName=null表示tmux默认server，不允许嵌套tmux注入的TMUX把命令重定向到当前client server。
  delete environment.TMUX;
  delete environment.TMUX_PANE;
  let result;
  try {
    result = spawnSync(command, args, {
      encoding: "utf8",
      shell: false,
      input,
      maxBuffer: MAX_OUTPUT_BYTES,
      timeout: 10_000,
      env: environment,
    });
  } catch {
    return Object.freeze({ ok: false, stdout: "", status: null });
  }
  return Object.freeze({
    ok: !result.error && result.status === 0,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    status: Number.isInteger(result.status) ? result.status : null,
  });
}

function tmuxExec(context, args) {
  return hostExec(executable("WAKEFLOW_TMUX_BIN", "tmux"), tmuxArgs(context.socketName, args));
}

function shellQuote(value) {
  return `'${String(value).replace(/'/gu, `'\\''`)}'`;
}

function commandForClaude(input) {
  const argv = [
    executable("WAKEFLOW_CLAUDE_BIN", "claude"),
    input.mode === "resume" ? "--resume" : "--session-id",
    input.sessionId,
    ...(input.cwd === input.workspaceRoot ? [] : ["--add-dir", input.workspaceRoot]),
    "--permission-mode",
    input.preferences.permissionMode,
    ...(input.preferences.effort === null ? [] : ["--effort", input.preferences.effort]),
    ...(input.preferences.model === null ? [] : ["--model", input.preferences.model]),
  ];
  return argv.map(shellQuote).join(" ");
}

function parseCreatedCoordinate(stdout, context) {
  const lines = stdout.split("\n").filter(Boolean);
  if (lines.length !== 1) fail("wakeflow-claude-lifecycle-host-effect", "tmux returned an invalid create cardinality");
  const fields = lines[0].split("\t");
  if (fields.length !== 2 || !TMUX_WINDOW_ID_RE.test(fields[0]) || !TMUX_PANE_ID_RE.test(fields[1])) {
    fail("wakeflow-claude-lifecycle-host-effect", "tmux returned invalid exact window coordinates");
  }
  return deepFreeze({
    socketName: context.socketName,
    sessionName: context.sessionName,
    windowId: fields[0],
    paneId: fields[1],
  });
}

function paneCurrentCommandIsClaude(value) {
  const command = value.trim();
  return command === "claude" || path.posix.basename(command) === "claude";
}

function parsePaneInventory(stdout, context) {
  const lines = stdout.split("\n").filter((line) => line.length > 0);
  if (lines.length > MAX_PANES) fail("wakeflow-claude-lifecycle-observation", "tmux pane inventory exceeded its closed bound");
  return lines.map((line) => {
    const fields = line.split("\t");
    if (fields.length !== 10) fail("wakeflow-claude-lifecycle-observation", "tmux pane inventory returned an invalid row");
    const [
      sessionName,
      windowId,
      paneId,
      paneDead,
      currentCommand,
      programId,
      hostId,
      stableWindowId,
      bindingId,
      locatorId,
    ] = fields;
    if (paneDead !== "0" && paneDead !== "1") {
      fail("wakeflow-claude-lifecycle-observation", "tmux pane inventory returned an invalid pane_dead value");
    }
    return deepFreeze({
      provider: "tmux",
      socketName: context.socketName,
      sessionName,
      windowId,
      paneId,
      paneWindowId: windowId,
      paneDead: paneDead === "1",
      claudeProcess: paneCurrentCommandIsClaude(currentCommand),
      metadata: { programId, hostId, windowId: stableWindowId, bindingId, locatorId },
    });
  });
}

/** 把窄生命周期adapter实现为真实tmux/Claude子进程调用；失败一律保留“不确定”语义。 */
export const defaultClaudeLifecycleHostAdapter = Object.freeze({
  probe() {
    return Object.freeze({
      tmuxAvailable: hostExec(executable("WAKEFLOW_TMUX_BIN", "tmux"), ["-V"]).ok,
      claudeAvailable: hostExec(executable("WAKEFLOW_CLAUDE_BIN", "claude"), ["--version"]).ok,
    });
  },
  async createWindow(input) {
    const command = commandForClaude(input);
    const exists = tmuxExec(input.context, ["has-session", "-t", `=${input.context.sessionName}`]).ok;
    const args = exists
      ? [
          "new-window", "-d", "-t", `=${input.context.sessionName}`,
          "-n", input.title, "-c", input.cwd,
          "-P", "-F", "#{window_id}\t#{pane_id}", command,
        ]
      : [
          "new-session", "-d", "-s", input.context.sessionName,
          "-n", input.title, "-c", input.cwd,
          "-P", "-F", "#{window_id}\t#{pane_id}", command,
        ];
    const created = tmuxExec(input.context, args);
    if (!created.ok) fail("wakeflow-claude-lifecycle-host-effect", "tmux rejected the Claude window creation");
    const coordinate = parseCreatedCoordinate(created.stdout, input.context);
    const rename = tmuxExec(input.context, ["set-option", "-w", "-t", coordinate.windowId, "automatic-rename", "off"]);
    if (!rename.ok) fail("wakeflow-claude-lifecycle-host-effect", "tmux could not freeze the exact window title");
    return coordinate;
  },
  writeMetadata({ context, coordinate, metadata }) {
    const options = [
      ["@wakeflow_program_id", metadata.programId],
      ["@wakeflow_host_id", metadata.hostId],
      ["@wakeflow_window_id", metadata.windowId],
      ["@wakeflow_binding_id", metadata.bindingId],
      ["@wakeflow_locator_id", metadata.locatorId],
    ];
    for (const [name, value] of options) {
      const result = tmuxExec(context, ["set-option", "-w", "-t", coordinate.windowId, name, value]);
      if (!result.ok) fail("wakeflow-claude-lifecycle-host-effect", "tmux metadata write is uncertain");
    }
    return Object.freeze({ status: "written" });
  },
  listPanes({ context }) {
    const result = tmuxExec(context, ["list-panes", "-a", "-F", PANE_FORMAT]);
    if (!result.ok) {
      fail(
        "wakeflow-claude-lifecycle-host-observation",
        "tmux pane inventory is unavailable; absence cannot be proved",
      );
    }
    return Object.freeze(parsePaneInventory(result.stdout, context));
  },
  renameWindow({ endpoint, title }) {
    const result = tmuxExec(endpoint.tmux, ["rename-window", "-t", endpoint.tmux.windowId, title]);
    if (!result.ok) fail("wakeflow-claude-lifecycle-host-effect", "tmux retitle is uncertain");
    return Object.freeze({ status: "renamed" });
  },
  arrangeWindows({ context, endpoints }) {
    for (let index = 0; index < endpoints.length; index += 1) {
      const result = tmuxExec(context, [
        "move-window",
        "-s", endpoints[index].tmux.windowId,
        "-t", `=${context.sessionName}:${index + 1}`,
        "-r",
      ]);
      if (!result.ok) fail("wakeflow-claude-lifecycle-host-effect", "tmux fleet arrangement is uncertain");
    }
    return Object.freeze({ status: "arranged" });
  },
  closeWindow({ endpoint }) {
    const result = tmuxExec(endpoint.tmux, ["kill-window", "-t", endpoint.tmux.windowId]);
    return Object.freeze({ status: result.ok ? "succeeded" : "failed" });
  },
});
