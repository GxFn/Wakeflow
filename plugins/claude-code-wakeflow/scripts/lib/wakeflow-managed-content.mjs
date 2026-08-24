import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  opendirSync,
  openSync,
  readSync,
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
  wakeflowConfigV3Digest,
} from "./wakeflow-config-v3.mjs";
import { assertWakeflowConfigV3TransitionAuthority } from "./wakeflow-config-v3-transition-authority.mjs";
import { normalizeWakeflowHostCapabilityProfile } from "./wakeflow-host-capability.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import {
  createWakeflowLayoutDescriptor,
  validateWakeflowConfigRootPlacements,
} from "./wakeflow-layout-descriptor.mjs";
import {
  renderProgramMemoryCandidate,
  renderRepositoryMemoryCandidate,
} from "./wakeflow-rule-model.mjs";
import { planWakeflowSupportMaterialization } from "./wakeflow-support-materialization.mjs";
import { assertWakeflowMutationContext } from "./wakeflow-workspace-mutation.mjs";

/**
 * `.gitignore` 与程序/仓库/Design/Test instruction memory 的领域 owner。
 *
 * 职责导航：
 * 1. 从 strict config、host 窄视图和规则 renderer 形成目标语义 component。
 * 2. 只读识别 user bytes、已知 managed block、whole-file ownership、冲突与恢复残留。
 * 3. 输出 closed owner plan，并投影为 ignore-manager / instruction-renderer maintenance 动作。
 * 4. 在唯一 M3 gate 内保存 outside owner bytes，只替换已证明的 Wakeflow block 或 whole file。
 *
 * support 目录创建属于 support-surface owner；模板/规则语义属于 renderer；gate、journal 与恢复
 * 状态机属于 workspace mutation。本模块不把“目录存在”解释为内容 authority。
 */

export const WAKEFLOW_MANAGED_CONTENT_SCHEMA_ID = "urn:wakeflow:internal:managed-content-plan:v1";
export const WAKEFLOW_MANAGED_CONTENT_KIND = "WakeflowManagedContentPlan";
export const WAKEFLOW_MANAGED_CONTENT_SCHEMA_VERSION = 1;

const ACTIONS = new Set(["fresh-initialize", "reconfigure", "reconcile"]);
const PHYSICAL_ACTIONS = new Set([
  "create-managed",
  "update-managed",
  "remove-managed-block",
]);
const NON_PHYSICAL_ACTIONS = new Set(["current", "preserve", "blocked"]);
const CLASSIFICATIONS = new Set([
  "managed-missing",
  "managed-current",
  "managed-stale-known",
  "managed-modified",
  "user-owned",
  "conflict",
]);
const OWNERSHIPS = new Set(["managed-block", "managed-whole-file"]);
const COMPONENT_KINDS = new Set(["program-memory", "repository-memory", "support-memory", "ignore"]);
const ROOT_KINDS = new Set(["program", "repository", "surface"]);
const TOKEN_PATTERN = /^[a-z][a-z0-9-]{0,127}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const MODE_PATTERN = /^0[0-7]{3}$/u;
const MARKER_PREFIX = "<!-- wakeflow:managed-content:v1:";
const MARKER_PATTERN = /<!-- wakeflow:managed-content:v1:(begin|end) component=([a-z][a-z0-9-]*) owner=([A-Za-z0-9_-]+) digest=(sha256:[0-9a-f]{64}) sep=([01]) -->/gu;
const MAX_MANAGED_FILE_BYTES = 2 * 1024 * 1024;
const MAX_MANAGED_ROOT_ENTRIES = 100_000;
const FILE_MODE = 0o644;
const FILE_MODE_STRING = "0644";
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });
const BLOCKED_REASON_CLASSIFICATIONS = new Map([
  ["fresh-managed-footprint-present", new Set(["managed-current", "managed-stale-known"])],
  ["ignore-duplicate-user-rule", new Set(["conflict"])],
  ["ignore-managed-body-unknown", new Set(["managed-modified"])],
  ["ignore-related-rule-conflict", new Set(["conflict"])],
  ["ignore-source-block-unknown", new Set(["managed-modified"])],
  ["managed-content-not-known-render", new Set(["managed-modified"])],
  ["managed-file-unsafe", new Set(["conflict"])],
  ["managed-marker-body-boundary", new Set(["managed-modified"])],
  ["managed-marker-content-modified", new Set(["managed-modified"])],
  ["managed-marker-end-boundary", new Set(["managed-modified"])],
  ["managed-marker-malformed", new Set(["managed-modified"])],
  ["managed-marker-owner-mismatch", new Set(["managed-modified"])],
  ["managed-marker-pair-invalid", new Set(["managed-modified"])],
  ["managed-marker-separator-invalid", new Set(["managed-modified"])],
  ["managed-root-missing", new Set(["conflict"])],
  ["managed-root-unsafe", new Set(["conflict"])],
  ["managed-source-block-unknown", new Set(["managed-modified"])],
  ["managed-stage-residue", new Set(["conflict"])],
  ["managed-target-too-large", new Set(["conflict"])],
  ["managed-whole-file-has-outside-content", new Set(["managed-modified"])],
  ["managed-whole-file-removal-deferred", new Set(["conflict"])],
  ["managed-whole-file-user-content", new Set(["user-owned"])],
  ["planned-managed-root-has-footprint", new Set(["conflict"])],
]);

export class WakeflowManagedContentError extends Error {
  constructor(code, message, { errorPath = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowManagedContentError";
    this.code = code;
    this.path = errorPath;
    this.details = Object.freeze({ ...details });
    if (cause !== undefined && this.cause === undefined) this.cause = cause;
  }
}

function fail(code, message, { errorPath = "$", details = {}, cause } = {}) {
  throw new WakeflowManagedContentError(code, message, { errorPath, details, cause });
}

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactInput(value, expected, label) {
  if (!isPlainObject(value)) fail("wakeflow-managed-content-input", `${label} must be a plain object`);
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== expected.length
    || actual.some((key) => typeof key !== "string" || !expected.includes(key))
  ) {
    fail("wakeflow-managed-content-input", `${label} has an invalid field set`, {
      details: { expected, actual: actual.map(String) },
    });
  }
  const snapshot = Object.create(null);
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-managed-content-input", `${label}.${key} must be an enumerable data property`);
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

function planningInputSnapshot(value, allowed, required, label) {
  if (!isPlainObject(value)) fail("wakeflow-managed-content-input", `${label} must be a plain object`);
  const allowedSet = new Set(allowed);
  const snapshot = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowedSet.has(key)) {
      fail("wakeflow-managed-content-input", `${label} has an invalid field set`, {
        details: { allowed, required, actual: Reflect.ownKeys(value).map(String) },
      });
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-managed-content-input", `${label}.${key} must be an enumerable data property`);
    }
    snapshot[key] = descriptor.value;
  }
  for (const key of required) {
    if (!Object.hasOwn(snapshot, key)) {
      fail("wakeflow-managed-content-input", `${label}.${key} is required`);
    }
  }
  return Object.freeze(snapshot);
}

function denseDataArray(value, label) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail("wakeflow-managed-content-input", `${label} must be a standard array`);
  }
  const snapshot = [];
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length) {
      fail("wakeflow-managed-content-input", `${label} has an additional property`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-managed-content-input", `${label}[${key}] must be an enumerable data property`);
    }
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-managed-content-input", `${label}[${index}] must be a dense data slot`);
    }
    snapshot.push(descriptor.value);
  }
  return Object.freeze(snapshot);
}

function hostPresentationName(profile) {
  if (!isPlainObject(profile)) {
    fail("wakeflow-managed-content-input", "hostProfile must be a plain object facade");
  }
  const descriptor = Object.getOwnPropertyDescriptor(profile, "hostName");
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
    fail("wakeflow-managed-content-input", "hostProfile.hostName must be an enumerable data property");
  }
  const hostName = descriptor.value;
  if (
    typeof hostName !== "string"
    || !hostName
    || hostName !== hostName.trim()
    || /[\r\n\0]/u.test(hostName)
  ) fail("wakeflow-managed-content-input", "hostProfile.hostName must be canonical single-line text");
  return hostName;
}

function callbackArguments(value, keys, label) {
  if (!isPlainObject(value)) fail("wakeflow-managed-content-input", `${label} must be a plain object facade`);
  const snapshot = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-managed-content-input", `${label}.${key} must be an enumerable data property`);
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

function exactKeys(value, expected, label, errorPath = "$") {
  if (!isPlainObject(value)) {
    fail("wakeflow-managed-content-plan", `${label} must be a plain object`, { errorPath });
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(wanted)) {
    fail("wakeflow-managed-content-plan", `${label} has an invalid field set`, {
      errorPath,
      details: { expected: wanted, actual },
    });
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalSnapshot(value, label) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (cause) {
    fail("wakeflow-managed-content-canonical", `${label} must be canonical JSON data`, { cause });
  }
}

function sameCanonical(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function digestBytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function currentEuid() {
  return typeof process.geteuid === "function" ? BigInt(process.geteuid()) : null;
}

function modeString(stat) {
  return `0${(stat.mode & 0o777n).toString(8).padStart(3, "0")}`;
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

// 对 owner 私有文件做跨观察比较时，inode 相同并不足以证明字节、mode 或 link 状态未变。
function sameStableFile(left, right) {
  return sameIdentity(left, right)
    && left.uid === right.uid
    && left.gid === right.gid
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function portableComponent(value, label) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || value === "."
    || value === ".."
    || value.includes("/")
    || value.includes("\\")
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
    || path.posix.basename(value) !== value
  ) {
    fail("wakeflow-managed-content-path", `${label} must be one portable path component`);
  }
  return value;
}

function token(value, label) {
  if (typeof value !== "string" || !TOKEN_PATTERN.test(value)) {
    fail("wakeflow-managed-content-plan", `${label} must be a bounded lowercase token`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    fail("wakeflow-managed-content-plan", `${label} must be a lowercase sha256 digest`);
  }
  return value;
}

function normalizeAuthorizedRepositoryIds(value, models) {
  const entries = denseDataArray(value, "authorizedRepositoryIds");
  const known = new Set(models.flatMap((model) => (
    model === null ? [] : model.topology.repositories.map((entry) => entry.repositoryId)
  )));
  const normalized = entries.map((entry, index) => {
    if (typeof entry !== "string" || !known.has(entry)) {
      fail("wakeflow-managed-content-authorization", "authorizedRepositoryIds contains an unknown repository", {
        errorPath: `$/authorizedRepositoryIds/${index}`,
      });
    }
    return entry;
  });
  if (new Set(normalized).size !== normalized.length) {
    fail("wakeflow-managed-content-authorization", "authorizedRepositoryIds contains duplicates");
  }
  return normalized.sort(lexicalCompare);
}

function normalizePlanningInput(value, { participant = false } = {}) {
  const required = [
    "workspaceRoot",
    "action",
    "sourceModel",
    "desiredModel",
    "hostProfile",
    "authorizedRepositoryIds",
    ...(participant ? ["confirmedPlan"] : []),
  ];
  const allowed = [...required, "plannedSupportSurfaceIds"];
  const input = planningInputSnapshot(
    value,
    allowed,
    required,
    participant ? "managed-content mutation participant input" : "managed-content planning input",
  );
  if (
    typeof input.workspaceRoot !== "string"
    || !input.workspaceRoot
    || input.workspaceRoot !== input.workspaceRoot.trim()
    || input.workspaceRoot.includes("\0")
    || !path.isAbsolute(input.workspaceRoot)
    || path.resolve(input.workspaceRoot) !== input.workspaceRoot
  ) {
    fail("wakeflow-managed-content-input", "workspaceRoot must be one exact absolute path");
  }
  if (!ACTIONS.has(input.action)) {
    fail("wakeflow-managed-content-input", `unsupported managed-content action: ${String(input.action)}`);
  }
  const sourceModel = input.sourceModel === null
    ? null
    : parseWakeflowConfigV3(input.sourceModel);
  const desiredModel = parseWakeflowConfigV3(input.desiredModel);
  if (input.action === "fresh-initialize" && sourceModel !== null) {
    fail("wakeflow-managed-content-input", "fresh-initialize requires sourceModel=null");
  }
  if (input.action !== "fresh-initialize" && sourceModel === null) {
    fail("wakeflow-managed-content-input", `${input.action} requires a strict sourceModel`);
  }
  if (sourceModel !== null && sourceModel.program.programId !== desiredModel.program.programId) {
    fail("wakeflow-managed-content-input", "source and desired model program IDs differ");
  }
  if (
    input.action === "reconcile"
    && wakeflowConfigV3Digest(sourceModel) !== wakeflowConfigV3Digest(desiredModel)
  ) {
    fail("wakeflow-managed-content-input", "reconcile cannot change config semantics");
  }
  const normalizedHost = normalizeWakeflowHostCapabilityProfile(input.hostProfile);
  const hostName = hostPresentationName(input.hostProfile);
  const hostProfile = deepFreeze({
    hostId: normalizedHost.hostId,
    hostName,
    memoryFile: normalizedHost.memoryFile,
    runtime: { hostDirName: normalizedHost.hostDirName },
    capabilities: normalizedHost.capabilities,
  });
  const workspaceRoot = input.workspaceRoot;
  if (process.platform === "win32" || currentEuid() === null) {
    fail("wakeflow-managed-content-platform", "managed-content owner requires POSIX no-follow semantics");
  }
  validateWakeflowConfigRootPlacements({ workspaceRoot, model: desiredModel });
  if (sourceModel !== null) validateWakeflowConfigRootPlacements({ workspaceRoot, model: sourceModel });
  const plannedSupportSurfaceIds = denseDataArray(
    input.plannedSupportSurfaceIds ?? [],
    "plannedSupportSurfaceIds",
  );
  const desiredSurfaceById = new Map(desiredModel.topology.supportSurfaces.map((entry) => [entry.surfaceId, entry]));
  const normalizedPlannedSupportSurfaceIds = plannedSupportSurfaceIds.map((entry, index) => {
    const surface = desiredSurfaceById.get(entry);
    if (!surface || surface.ownership !== "wakeflow-managed") {
      fail("wakeflow-managed-content-input", "planned support root is not one desired Wakeflow-managed surface", {
        errorPath: `$/plannedSupportSurfaceIds/${index}`,
      });
    }
    return entry;
  }).sort(lexicalCompare);
  if (
    new Set(normalizedPlannedSupportSurfaceIds).size !== normalizedPlannedSupportSurfaceIds.length
    || canonicalJson(plannedSupportSurfaceIds) !== canonicalJson(normalizedPlannedSupportSurfaceIds)
  ) {
    fail("wakeflow-managed-content-input", "plannedSupportSurfaceIds must be unique and canonical");
  }
  return {
    workspaceRoot,
    action: input.action,
    sourceModel,
    desiredModel,
    hostProfile,
    host: {
      hostId: normalizedHost.hostId,
      hostName,
      memoryFile: normalizedHost.memoryFile,
      profileDigest: canonicalJsonDigest(normalizedHost),
      normalized: normalizedHost,
    },
    authorizedRepositoryIds: normalizeAuthorizedRepositoryIds(
      input.authorizedRepositoryIds,
      [sourceModel, desiredModel],
    ),
    plannedSupportSurfaceIds: normalizedPlannedSupportSurfaceIds,
    ...(participant ? { confirmedPlan: input.confirmedPlan } : {}),
  };
}

function hostRendererInput(host) {
  return {
    hostId: host.hostId,
    hostName: host.hostName,
    memoryFile: host.memoryFile,
  };
}

function programMemoryArtifact(model, host) {
  const controller = model.topology.windows.find((entry) => entry.role === "controller");
  return renderProgramMemoryCandidate({
    program: model.program,
    controllerWindowId: controller.windowId,
    host: hostRendererInput(host),
    paths: {
      config: "wakeflow.config.json",
      activeIndex: ".wakeflow-active/index.md",
      activeStatus: ".wakeflow-active/current/workspace-current-status.md",
      activeCurrent: ".wakeflow-active/current",
      localRoot: ".wakeflow-local",
      ledgerRecordMap: `${model.storage.ledgerRoot}/workspace/workspace-record-map.md`,
    },
  });
}

function repositoryMemoryArtifact(model, repository, host) {
  const windows = model.topology.windows.filter((entry) => (
    entry.role === "product"
    && entry.root.kind === "repository"
    && entry.root.repositoryId === repository.repositoryId
  ));
  return renderRepositoryMemoryCandidate({
    programId: model.program.programId,
    repository,
    windows,
    host: hostRendererInput(host),
    paths: {
      programMemory: host.memoryFile,
      activeIndex: ".wakeflow-active/index.md",
      activeStatus: ".wakeflow-active/current/workspace-current-status.md",
      localRoot: ".wakeflow-local",
      ledgerRecordMap: `${model.storage.ledgerRoot}/workspace/workspace-record-map.md`,
    },
  });
}

function semanticMemorySpecs(model, host) {
  if (model === null) return new Map();
  const descriptor = createWakeflowLayoutDescriptor({ model, hostProfile: host.profile });
  const supportPlan = planWakeflowSupportMaterialization({
    model,
    hostProfile: host.profile,
    layoutDescriptor: descriptor,
  });
  const supportArtifacts = new Map(supportPlan.operations
    .filter((entry) => new Set([
      "write-managed-file",
      "provide-managed-component",
    ]).has(entry.kind))
    .map((entry) => [entry.surfaceId, entry.artifact]));
  const specs = new Map();
  const program = programMemoryArtifact(model, host);
  specs.set(`program-memory:${model.program.programId}`, {
    componentKind: "program-memory",
    ownerId: model.program.programId,
    rootKind: "program",
    rootId: model.program.programId,
    configuredPath: ".",
    ref: host.memoryFile,
    ownership: "managed-block",
    body: program.content,
  });
  for (const repository of model.topology.repositories) {
    if (repository.instructionManagement !== "managed-block") continue;
    const artifact = repositoryMemoryArtifact(model, repository, host);
    specs.set(`repository-memory:${repository.repositoryId}`, {
      componentKind: "repository-memory",
      ownerId: repository.repositoryId,
      rootKind: "repository",
      rootId: repository.repositoryId,
      configuredPath: repository.path,
      ref: host.memoryFile,
      ownership: "managed-block",
      body: artifact.content,
    });
  }
  for (const surface of model.topology.supportSurfaces) {
    if (surface.ownership === "external-owned" && surface.instructionManagement === "owner-managed") {
      continue;
    }
    const artifact = supportArtifacts.get(surface.surfaceId);
    if (!artifact) {
      fail("wakeflow-managed-content-render", "support materialization omitted an eligible memory artifact", {
        details: { surfaceId: surface.surfaceId },
      });
    }
    specs.set(`support-memory:${surface.surfaceId}`, {
      componentKind: "support-memory",
      ownerId: surface.surfaceId,
      rootKind: "surface",
      rootId: surface.surfaceId,
      configuredPath: surface.path,
      ref: host.memoryFile,
      ownership: surface.ownership === "wakeflow-managed" ? "managed-whole-file" : "managed-block",
      body: artifact.content,
    });
  }
  return specs;
}

function ignoreEntriesForProgram(host) {
  const entries = [".wakeflow-active/", ".wakeflow-local/"];
  if (host.normalized.capabilities.settings.applicable) {
    entries.push(host.normalized.capabilities.settings.paths.local);
  }
  return entries.sort(lexicalCompare);
}

function ignoreSpecs(model, host, authorizedRepositoryIds) {
  if (model === null) return new Map();
  const specs = new Map();
  specs.set(`ignore:${model.program.programId}`, {
    componentKind: "ignore",
    ownerId: model.program.programId,
    rootKind: "program",
    rootId: model.program.programId,
    configuredPath: ".",
    ref: ".gitignore",
    ownership: "managed-block",
    entries: ignoreEntriesForProgram(host),
  });
  if (!host.normalized.capabilities.settings.applicable) return specs;
  const localRef = host.normalized.capabilities.settings.paths.local;
  for (const surface of model.topology.supportSurfaces) {
    if (surface.ownership !== "wakeflow-managed") continue;
    specs.set(`ignore:${surface.surfaceId}`, {
      componentKind: "ignore",
      ownerId: surface.surfaceId,
      rootKind: "surface",
      rootId: surface.surfaceId,
      configuredPath: surface.path,
      ref: ".gitignore",
      ownership: "managed-block",
      entries: [localRef],
    });
  }
  const authorized = new Set(authorizedRepositoryIds);
  for (const repository of model.topology.repositories) {
    if (!authorized.has(repository.repositoryId)) continue;
    specs.set(`ignore:${repository.repositoryId}`, {
      componentKind: "ignore",
      ownerId: repository.repositoryId,
      rootKind: "repository",
      rootId: repository.repositoryId,
      configuredPath: repository.path,
      ref: ".gitignore",
      ownership: "managed-block",
      entries: [localRef],
    });
  }
  return specs;
}

function withProfile(host, profile) {
  return { ...host, profile };
}

function samePlacement(left, right) {
  return left.rootKind === right.rootKind
    && left.rootId === right.rootId
    && left.configuredPath === right.configuredPath
    && left.ref === right.ref
    && left.ownership === right.ownership;
}

function mergeSpecs(sourceSpecs, desiredSpecs) {
  const merged = [];
  const keys = [...new Set([...sourceSpecs.keys(), ...desiredSpecs.keys()])].sort(lexicalCompare);
  for (const key of keys) {
    const source = sourceSpecs.get(key) ?? null;
    const desired = desiredSpecs.get(key) ?? null;
    if (source && desired && samePlacement(source, desired)) {
      merged.push({ key, source, desired, basis: "target" });
      continue;
    }
    if (source) merged.push({ key: `${key}:source`, source, desired: null, basis: "source" });
    if (desired) merged.push({ key: `${key}:target`, source: null, desired, basis: "target" });
  }
  return merged;
}

function markerCount(value) {
  let count = 0;
  let offset = 0;
  while (true) {
    const found = value.indexOf(MARKER_PREFIX, offset);
    if (found === -1) return count;
    count += 1;
    offset = found + MARKER_PREFIX.length;
  }
}

function parseEnvelope(text) {
  const prefixCount = markerCount(text);
  if (prefixCount === 0) return { kind: "none" };
  const matches = [...text.matchAll(MARKER_PATTERN)];
  if (prefixCount !== 2 || matches.length !== 2) return { kind: "malformed", code: "managed-marker-malformed" };
  const [begin, end] = matches;
  if (
    begin[1] !== "begin"
    || end[1] !== "end"
    || begin[2] !== end[2]
    || begin[3] !== end[3]
    || begin[4] !== end[4]
    || begin[5] !== end[5]
    || begin.index >= end.index
  ) return { kind: "malformed", code: "managed-marker-pair-invalid" };
  const bodyStart = begin.index + begin[0].length;
  if (text[bodyStart] !== "\n") return { kind: "malformed", code: "managed-marker-body-boundary" };
  const body = text.slice(bodyStart + 1, end.index);
  if (!body.endsWith("\n") || digestBytes(Buffer.from(body, "utf8")) !== begin[4]) {
    return { kind: "malformed", code: "managed-marker-content-modified" };
  }
  const markerEnd = end.index + end[0].length;
  if (text[markerEnd] !== "\n") return { kind: "malformed", code: "managed-marker-end-boundary" };
  const separator = begin[5] === "1";
  const ownedStart = begin.index - (separator ? 1 : 0);
  if (ownedStart < 0 || (separator && text[ownedStart] !== "\n")) {
    return { kind: "malformed", code: "managed-marker-separator-invalid" };
  }
  const blockEnd = markerEnd + 1;
  return {
    kind: "managed",
    componentKind: begin[2],
    ownerId: begin[3],
    bodyDigest: begin[4],
    body,
    outside: `${text.slice(0, ownedStart)}${text.slice(blockEnd)}`,
    ownedStart,
    blockEnd,
  };
}

function envelopeBytes({ componentKind, ownerId, body, outside }) {
  if (!body.endsWith("\n")) {
    fail("wakeflow-managed-content-render", "managed component body must end with one newline");
  }
  const bodyDigest = digestBytes(Buffer.from(body, "utf8"));
  const separator = outside.length > 0 && !outside.endsWith("\n") ? "1" : "0";
  const marker = (side) => (
    `${MARKER_PREFIX}${side} component=${componentKind} owner=${ownerId} digest=${bodyDigest} sep=${separator} -->`
  );
  const owned = `${separator === "1" ? "\n" : ""}${marker("begin")}\n${body}${marker("end")}\n`;
  return Buffer.from(`${outside}${owned}`, "utf8");
}

function decodeManagedText(bytes) {
  try {
    return TEXT_DECODER.decode(bytes);
  } catch (cause) {
    fail("wakeflow-managed-content-utf8", "managed memory and ignore files must be strict UTF-8", { cause });
  }
}

function rootState(workspaceRoot, configuredPath) {
  const absolute = path.resolve(workspaceRoot, ...configuredPath.split("/"));
  let stat;
  try {
    stat = lstatSync(absolute, { bigint: true });
  } catch (cause) {
    if (cause?.code === "ENOENT") return {
      classification: "missing",
      absolute,
      realPath: null,
      stat: null,
    };
    return { classification: "unsafe", absolute, realPath: null, stat: null };
  }
  if (stat.isSymbolicLink() || !stat.isDirectory() || stat.uid !== currentEuid()) {
    return { classification: "unsafe", absolute, realPath: null, stat };
  }
  let realPath;
  try {
    realPath = realpathSync(absolute);
  } catch {
    return { classification: "unsafe", absolute, realPath: null, stat };
  }
  return { classification: "current", absolute, realPath, stat };
}

function inspectFile(root, ref, { allowLinkedPair = false } = {}) {
  const absolute = path.join(root.absolute, ref);
  let pathStat;
  try {
    pathStat = lstatSync(absolute, { bigint: true });
  } catch (cause) {
    if (cause?.code === "ENOENT") return { classification: "absent", absolute, stat: null, bytes: null };
    return { classification: "unsafe", absolute, stat: null, bytes: null };
  }
  if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
    return { classification: "unsafe", absolute, stat: pathStat, bytes: null };
  }
  let descriptor;
  try {
    descriptor = openSync(absolute, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const before = fstatSync(descriptor, { bigint: true });
    if (
      !before.isFile()
      || !sameStableFile(before, pathStat)
      || before.uid !== currentEuid()
      || (!allowLinkedPair && before.nlink !== 1n)
      || (allowLinkedPair && ![1n, 2n].includes(before.nlink))
      || before.size > BigInt(MAX_MANAGED_FILE_BYTES)
    ) return { classification: "unsafe", absolute, stat: before, bytes: null };
    // 多分配一个字节，用 bounded read 看见读取期间的增长；完整前后 stat 再拒绝
    // 同 inode 的原位替换、truncate、chmod 或 hard-link 变化。
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(descriptor, buffer, offset, buffer.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    const after = fstatSync(descriptor, { bigint: true });
    const refreshed = lstatSync(absolute, { bigint: true });
    if (
      !sameStableFile(before, after)
      || !sameStableFile(after, refreshed)
      || BigInt(offset) !== after.size
      || offset > MAX_MANAGED_FILE_BYTES
    ) return { classification: "unsafe", absolute, stat: after, bytes: null };
    return { classification: "file", absolute, stat: after, bytes: buffer.subarray(0, offset) };
  } catch {
    return { classification: "unsafe", absolute, stat: pathStat, bytes: null };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function publicNode(inspected) {
  if (inspected.classification === "absent") return { type: "absent" };
  if (inspected.classification !== "file" || inspected.bytes === null) {
    return { type: "unsafe", mode: null, digest: null };
  }
  return {
    type: "file",
    mode: modeString(inspected.stat),
    digest: digestBytes(inspected.bytes),
  };
}

function targetNode(bytes) {
  return { type: "file", mode: FILE_MODE_STRING, digest: digestBytes(bytes) };
}

function stableOperationId(spec) {
  const suffix = createHash("sha256").update(canonicalJson({
    componentKind: spec.componentKind,
    ownerId: spec.ownerId,
    rootKind: spec.rootKind,
    rootId: spec.rootId,
    configuredPath: spec.configuredPath,
    ref: spec.ref,
    basis: spec.basis,
  })).digest("hex").slice(0, 32);
  return `managed-content-${suffix}`;
}

function placementToken(configuredPath) {
  return createHash("sha256").update(configuredPath).digest("hex").slice(0, 16);
}

function logicalResourceRef(spec) {
  return `targets/${spec.rootKind}/${spec.rootId}/${placementToken(spec.configuredPath)}/${spec.ref}`;
}

function stageFileName(operationId, targetDigest) {
  return `.${operationId}.${targetDigest.slice("sha256:".length, "sha256:".length + 16)}.stage`;
}

function stageResidues(root, operationId) {
  if (root.classification !== "current") return [];
  const prefix = `.${operationId}.`;
  let directory;
  try {
    directory = opendirSync(root.absolute);
    const residues = [];
    let count = 0;
    while (true) {
      const entry = directory.readSync();
      if (entry === null) return residues;
      count += 1;
      if (count > MAX_MANAGED_ROOT_ENTRIES) return ["unbounded"];
      if (entry.name.startsWith(prefix) && entry.name.endsWith(".stage")) residues.push(entry.name);
    }
  } catch {
    return ["unreadable"];
  } finally {
    if (directory !== undefined) directory.closeSync();
  }
}

function relatedIgnoreConflict(outside, entries) {
  const exactCounts = new Map(entries.map((entry) => [entry, 0]));
  for (const raw of outside.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (exactCounts.has(line)) {
      exactCounts.set(line, exactCounts.get(line) + 1);
      continue;
    }
    if (
      line.includes(".wakeflow")
      || line.includes(".claude/settings.local.json")
      || line.includes("settings.local.json")
    ) return "ignore-related-rule-conflict";
  }
  if ([...exactCounts.values()].some((count) => count > 1)) return "ignore-duplicate-user-rule";
  return null;
}

function ignoreProbe(entry) {
  if (entry.endsWith("/")) return `${entry}.wakeflow-ignore-probe`;
  return entry;
}

function isEffectivelyIgnored(root, entry) {
  const result = spawnSync("git", [
    "-c", "core.excludesFile=/dev/null",
    "-c", "core.attributesFile=/dev/null",
    "-C", root.absolute,
    "check-ignore", "--no-index", "-q", "--", ignoreProbe(entry),
  ], {
    encoding: "utf8",
    stdio: ["ignore", "ignore", "ignore"],
    timeout: 5_000,
  });
  return result.status === 0;
}

function ignoreBody(entries) {
  return `${[...entries].sort(lexicalCompare).join("\n")}\n`;
}

function parsedMatches(parsed, spec, body) {
  return parsed.kind === "managed"
    && parsed.componentKind === spec.componentKind
    && parsed.ownerId === spec.ownerId
    && parsed.body === body;
}

function validIgnoreBody(body, entries) {
  const lines = body.split("\n");
  if (lines.at(-1) !== "") return null;
  lines.pop();
  if (
    lines.length === 0
    || new Set(lines).size !== lines.length
    || canonicalJson(lines) !== canonicalJson([...lines].sort(lexicalCompare))
    || lines.some((entry) => !entries.includes(entry))
  ) return null;
  return lines;
}

function operationSkeleton(spec) {
  const operationId = stableOperationId(spec);
  return {
    operationId,
    component: { kind: spec.componentKind, ownerId: spec.ownerId },
    owner: spec.componentKind === "ignore" ? "ignore-manager" : "instruction-renderer",
    root: {
      kind: spec.rootKind,
      rootId: spec.rootId,
      configuredPath: spec.configuredPath,
      basis: spec.basis,
    },
    ref: spec.ref,
    resourceRef: logicalResourceRef(spec),
    ownership: spec.ownership,
  };
}

function blockedClassification(base, source, classification, reasonCode) {
  return {
    public: {
      ...base,
      classification,
      source,
      target: null,
      action: "blocked",
      reasonCode,
      stageRef: null,
    },
    private: null,
  };
}

function physicalClassification({ base, source, targetBytes, classification, action, reasonCode, root, final }) {
  if (targetBytes.length > MAX_MANAGED_FILE_BYTES) {
    return blockedClassification(base, source, "conflict", "managed-target-too-large");
  }
  const target = targetNode(targetBytes);
  const physicalStageRef = stageFileName(base.operationId, target.digest);
  if (stageResidues(root, base.operationId).length > 0) {
    return blockedClassification(base, source, "conflict", "managed-stage-residue");
  }
  return {
    public: {
      ...base,
      classification,
      source,
      target,
      action,
      reasonCode,
      stageRef: physicalStageRef,
    },
    private: {
      root,
      final,
      targetBytes,
      physicalStageRef,
    },
  };
}

function currentClassification(base, source, reasonCode, root, final) {
  return {
    public: {
      ...base,
      classification: "managed-current",
      source,
      target: source,
      action: "current",
      reasonCode,
      stageRef: null,
    },
    private: { root, final, targetBytes: final.bytes, physicalStageRef: null },
  };
}

function preserveClassification(base, source, reasonCode, root, final) {
  return {
    public: {
      ...base,
      classification: "user-owned",
      source,
      target: source,
      action: "preserve",
      reasonCode,
      stageRef: null,
    },
    private: { root, final, targetBytes: final.bytes, physicalStageRef: null },
  };
}

function classifyIgnore({ spec, base, root, final, sourceNode, text, parsed }) {
  const sourceEntries = spec.source?.entries ?? [];
  const desiredEntries = spec.desired?.entries ?? [];
  if (parsed.kind === "malformed") {
    return blockedClassification(base, sourceNode, "managed-modified", parsed.code);
  }
  if (parsed.kind === "managed" && (
    parsed.componentKind !== "ignore" || parsed.ownerId !== spec.ownerId
  )) return blockedClassification(base, sourceNode, "managed-modified", "managed-marker-owner-mismatch");

  if (desiredEntries.length === 0) {
    if (parsed.kind === "none") return null;
    if (validIgnoreBody(parsed.body, sourceEntries) === null) {
      return blockedClassification(base, sourceNode, "managed-modified", "ignore-source-block-unknown");
    }
    const conflict = relatedIgnoreConflict(parsed.outside, sourceEntries);
    if (conflict) return blockedClassification(base, sourceNode, "conflict", conflict);
    return physicalClassification({
      base,
      source: sourceNode,
      targetBytes: Buffer.from(parsed.outside, "utf8"),
      classification: "managed-stale-known",
      action: "remove-managed-block",
      reasonCode: "ignore-component-no-longer-desired",
      root,
      final,
    });
  }

  const outside = parsed.kind === "managed" ? parsed.outside : text;
  const conflict = relatedIgnoreConflict(outside, desiredEntries);
  if (conflict) return blockedClassification(base, sourceNode, "conflict", conflict);
  let managedEntries;
  if (parsed.kind === "managed") {
    const known = validIgnoreBody(parsed.body, [...new Set([...sourceEntries, ...desiredEntries])]);
    if (known === null) {
      return blockedClassification(base, sourceNode, "managed-modified", "ignore-managed-body-unknown");
    }
    managedEntries = desiredEntries.filter((entry) => (
      known.includes(entry) || !isEffectivelyIgnored(root, entry)
    ));
  } else {
    managedEntries = desiredEntries.filter((entry) => !isEffectivelyIgnored(root, entry));
  }
  if (managedEntries.length === 0) {
    if (parsed.kind === "none") return preserveClassification(
      base,
      sourceNode,
      "ignore-satisfied-user-owned",
      root,
      final,
    );
    return physicalClassification({
      base,
      source: sourceNode,
      targetBytes: Buffer.from(outside, "utf8"),
      classification: "managed-stale-known",
      action: "remove-managed-block",
      reasonCode: "ignore-now-satisfied-user-owned",
      root,
      final,
    });
  }
  const targetBytes = envelopeBytes({
    componentKind: "ignore",
    ownerId: spec.ownerId,
    body: ignoreBody(managedEntries),
    outside,
  });
  if (
    final.bytes.equals(targetBytes)
    && modeString(final.stat) === FILE_MODE_STRING
    && parsed.kind === "managed"
  ) return currentClassification(base, sourceNode, "ignore-managed-current", root, final);
  return physicalClassification({
    base,
    source: sourceNode,
    targetBytes,
    classification: parsed.kind === "none" ? "user-owned" : "managed-stale-known",
    action: "update-managed",
    reasonCode: parsed.kind === "none" ? "ignore-managed-component-add" : "ignore-managed-component-refresh",
    root,
    final,
  });
}

function classifyMemory({ spec, base, root, final, sourceNode, text, parsed }) {
  const sourceBody = spec.source?.body ?? null;
  const desiredBody = spec.desired?.body ?? null;
  if (parsed.kind === "malformed") {
    return blockedClassification(base, sourceNode, "managed-modified", parsed.code);
  }
  if (parsed.kind === "managed" && (
    parsed.componentKind !== spec.componentKind || parsed.ownerId !== spec.ownerId
  )) return blockedClassification(base, sourceNode, "managed-modified", "managed-marker-owner-mismatch");
  if (desiredBody === null) {
    if (parsed.kind === "none") return null;
    if (sourceBody === null || !parsedMatches(parsed, spec, sourceBody)) {
      return blockedClassification(base, sourceNode, "managed-modified", "managed-source-block-unknown");
    }
    if (spec.ownership === "managed-whole-file") {
      return blockedClassification(base, sourceNode, "conflict", "managed-whole-file-removal-deferred");
    }
    return physicalClassification({
      base,
      source: sourceNode,
      targetBytes: Buffer.from(parsed.outside, "utf8"),
      classification: "managed-stale-known",
      action: "remove-managed-block",
      reasonCode: "managed-component-no-longer-desired",
      root,
      final,
    });
  }
  if (parsed.kind === "none") {
    if (spec.ownership === "managed-whole-file") {
      return blockedClassification(base, sourceNode, "user-owned", "managed-whole-file-user-content");
    }
    return physicalClassification({
      base,
      source: sourceNode,
      targetBytes: envelopeBytes({
        componentKind: spec.componentKind,
        ownerId: spec.ownerId,
        body: desiredBody,
        outside: text,
      }),
      classification: "user-owned",
      action: "update-managed",
      reasonCode: "managed-component-add",
      root,
      final,
    });
  }
  if (spec.ownership === "managed-whole-file" && parsed.outside !== "") {
    return blockedClassification(base, sourceNode, "managed-modified", "managed-whole-file-has-outside-content");
  }
  if (!parsedMatches(parsed, spec, desiredBody) && (
    sourceBody === null || !parsedMatches(parsed, spec, sourceBody)
  )) return blockedClassification(base, sourceNode, "managed-modified", "managed-content-not-known-render");
  const targetBytes = envelopeBytes({
    componentKind: spec.componentKind,
    ownerId: spec.ownerId,
    body: desiredBody,
    outside: parsed.outside,
  });
  if (final.bytes.equals(targetBytes) && modeString(final.stat) === FILE_MODE_STRING) {
    return currentClassification(base, sourceNode, "managed-content-current", root, final);
  }
  return physicalClassification({
    base,
    source: sourceNode,
    targetBytes,
    classification: "managed-stale-known",
    action: "update-managed",
    reasonCode: "managed-content-refresh",
    root,
    final,
  });
}

function classifySpec(spec, workspaceRoot) {
  const effective = {
    ...(spec.desired ?? spec.source),
    source: spec.source,
    desired: spec.desired,
    basis: spec.basis,
  };
  const base = operationSkeleton(effective);
  const root = rootState(workspaceRoot, effective.configuredPath);
  const plannedRoot = root.classification === "missing"
    && effective.rootKind === "surface"
    && effective.plannedRoot === true;
  if (plannedRoot) root.classification = "planned";
  if (root.classification !== "current") {
    if (root.classification === "planned") {
      const final = inspectFile(root, effective.ref);
      if (final.classification !== "absent") {
        return blockedClassification(base, publicNode(final), "conflict", "planned-managed-root-has-footprint");
      }
      const body = effective.componentKind === "ignore"
        ? ignoreBody(effective.desired.entries)
        : effective.desired.body;
      return physicalClassification({
        base,
        source: { type: "absent" },
        targetBytes: envelopeBytes({
          componentKind: effective.componentKind,
          ownerId: effective.ownerId,
          body,
          outside: "",
        }),
        classification: "managed-missing",
        action: "create-managed",
        reasonCode: effective.componentKind === "ignore" ? "ignore-managed-create" : "managed-content-create",
        root,
        final,
      });
    }
    return blockedClassification(base, { type: "absent" }, "conflict", root.classification === "missing"
      ? "managed-root-missing"
      : "managed-root-unsafe");
  }
  const final = inspectFile(root, effective.ref);
  const sourceNode = publicNode(final);
  if (final.classification === "unsafe") {
    return blockedClassification(base, sourceNode, "conflict", "managed-file-unsafe");
  }
  if (final.classification === "absent") {
    if (!effective.desired) return null;
    const body = effective.componentKind === "ignore"
      ? ignoreBody(effective.desired.entries)
      : effective.desired.body;
    const targetBytes = envelopeBytes({
      componentKind: effective.componentKind,
      ownerId: effective.ownerId,
      body,
      outside: "",
    });
    return physicalClassification({
      base,
      source: sourceNode,
      targetBytes,
      classification: "managed-missing",
      action: "create-managed",
      reasonCode: effective.componentKind === "ignore" ? "ignore-managed-create" : "managed-content-create",
      root,
      final,
    });
  }
  const text = decodeManagedText(final.bytes);
  const parsed = parseEnvelope(text);
  return effective.componentKind === "ignore"
    ? classifyIgnore({ spec: effective, base, root, final, sourceNode, text, parsed })
    : classifyMemory({ spec: effective, base, root, final, sourceNode, text, parsed });
}

function enforceFreshManagedFootprintBoundary(classified, action) {
  if (
    action !== "fresh-initialize"
    || !new Set(["managed-current", "managed-stale-known"]).has(classified.public.classification)
  ) return classified;
  return {
    public: {
      ...classified.public,
      target: null,
      action: "blocked",
      reasonCode: "fresh-managed-footprint-present",
      stageRef: null,
    },
    private: null,
  };
}

function stepForOperation(operation, ordinal) {
  const directory = path.posix.dirname(operation.resourceRef);
  const stagingRef = path.posix.join(directory, operation.stageRef);
  return {
    stepId: operation.operationId,
    ordinal,
    stepKind: "create-or-update",
    source: { ref: operation.resourceRef, ...operation.source },
    staging: { ref: stagingRef, ...operation.target },
    final: { ref: operation.resourceRef, ...operation.target },
  };
}

function mergedManagedSpecs(normalized) {
  const host = withProfile(normalized.host, normalized.hostProfile);
  const sourceSemantic = semanticMemorySpecs(normalized.sourceModel, host);
  const desiredSemantic = semanticMemorySpecs(normalized.desiredModel, host);
  const sourceIgnore = ignoreSpecs(normalized.sourceModel, host, normalized.authorizedRepositoryIds);
  const desiredIgnore = ignoreSpecs(normalized.desiredModel, host, normalized.authorizedRepositoryIds);
  const planned = new Set(normalized.plannedSupportSurfaceIds);
  return [
    ...mergeSpecs(sourceSemantic, desiredSemantic),
    ...mergeSpecs(sourceIgnore, desiredIgnore),
  ].map((entry) => {
    const effective = entry.desired ?? entry.source;
    if (effective?.rootKind !== "surface" || !planned.has(effective.rootId)) return entry;
    return {
      ...entry,
      desired: entry.desired === null ? null : { ...entry.desired, plannedRoot: true },
      source: entry.source === null ? null : { ...entry.source, plannedRoot: true },
    };
  });
}

function derivePlanInternal(normalized) {
  const specs = mergedManagedSpecs(normalized);
  const classified = specs
    .map((entry) => classifySpec(entry, normalized.workspaceRoot))
    .filter(Boolean)
    .map((entry) => enforceFreshManagedFootprintBoundary(entry, normalized.action))
    .sort((left, right) => lexicalCompare(left.public.resourceRef, right.public.resourceRef));
  const operations = classified.map((entry) => entry.public);
  const privateOperations = new Map(classified.map((entry) => [entry.public.operationId, entry.private]));
  const blockers = operations
    .filter((entry) => entry.action === "blocked")
    .map((entry) => ({
      blockerId: entry.operationId,
      operationId: entry.operationId,
      resourceRef: entry.resourceRef,
      code: entry.reasonCode,
    }));
  const steps = operations
    .filter((entry) => PHYSICAL_ACTIONS.has(entry.action))
    .map((entry, ordinal) => stepForOperation(entry, ordinal));
  const plan = validatePlanInternal({
    schemaId: WAKEFLOW_MANAGED_CONTENT_SCHEMA_ID,
    payload: {
      kind: WAKEFLOW_MANAGED_CONTENT_KIND,
      schemaVersion: WAKEFLOW_MANAGED_CONTENT_SCHEMA_VERSION,
      action: normalized.action,
      status: blockers.length === 0 ? "ready" : "blocked",
      programId: normalized.desiredModel.program.programId,
      host: {
        hostId: normalized.host.hostId,
        profileDigest: normalized.host.profileDigest,
        memoryFile: normalized.host.memoryFile,
      },
      sourceModelDigest: normalized.sourceModel === null ? null : wakeflowConfigV3Digest(normalized.sourceModel),
      desiredModelDigest: wakeflowConfigV3Digest(normalized.desiredModel),
      authorizedRepositoryIds: normalized.authorizedRepositoryIds,
      plannedSupportSurfaceIds: normalized.plannedSupportSurfaceIds,
      operations,
      blockers,
      steps,
    },
  });
  if (canonicalJson(plan).includes(normalized.workspaceRoot)) {
    fail("wakeflow-managed-content-private-data", "managed-content plan leaked its absolute workspace root");
  }
  return { plan, privateOperations };
}

function assertConfirmedSemanticContract(normalized, confirmedPlan) {
  const expectedMetadata = {
    action: normalized.action,
    programId: normalized.desiredModel.program.programId,
    host: {
      hostId: normalized.host.hostId,
      profileDigest: normalized.host.profileDigest,
      memoryFile: normalized.host.memoryFile,
    },
    sourceModelDigest: normalized.sourceModel === null
      ? null
      : wakeflowConfigV3Digest(normalized.sourceModel),
    desiredModelDigest: wakeflowConfigV3Digest(normalized.desiredModel),
    authorizedRepositoryIds: normalized.authorizedRepositoryIds,
    plannedSupportSurfaceIds: normalized.plannedSupportSurfaceIds,
  };
  const actualMetadata = Object.fromEntries(
    Object.keys(expectedMetadata).map((key) => [key, confirmedPlan.payload[key]]),
  );
  if (!sameCanonical(actualMetadata, expectedMetadata)) {
    fail("wakeflow-managed-content-plan", "confirmed plan metadata differs from its config authority");
  }
  const skeletons = new Map(mergedManagedSpecs(normalized).map((spec) => {
    const effective = {
      ...(spec.desired ?? spec.source),
      source: spec.source,
      desired: spec.desired,
      basis: spec.basis,
    };
    const skeleton = operationSkeleton(effective);
    return [skeleton.operationId, skeleton];
  }));
  for (const operation of confirmedPlan.payload.operations) {
    const expected = skeletons.get(operation.operationId) ?? null;
    const actual = {
      operationId: operation.operationId,
      component: operation.component,
      owner: operation.owner,
      root: operation.root,
      ref: operation.ref,
      resourceRef: operation.resourceRef,
      ownership: operation.ownership,
    };
    if (expected === null || !sameCanonical(actual, expected)) {
      fail("wakeflow-managed-content-plan", "confirmed operation differs from its config-derived skeleton", {
        details: { operationId: operation.operationId },
      });
    }
    if (
      PHYSICAL_ACTIONS.has(operation.action)
      && operation.stageRef !== stageFileName(operation.operationId, operation.target.digest)
    ) {
      fail("wakeflow-managed-content-plan", "confirmed operation stage is not target-derived", {
        details: { operationId: operation.operationId },
      });
    }
  }
}

function validateNode(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (!isPlainObject(value) || typeof value.type !== "string") {
    fail("wakeflow-managed-content-plan", `${label} must be a resource node`);
  }
  if (value.type === "absent") {
    exactKeys(value, ["type"], label);
    return value;
  }
  if (value.type === "unsafe") {
    exactKeys(value, ["type", "mode", "digest"], label);
    if (value.mode !== null || value.digest !== null) {
      fail("wakeflow-managed-content-plan", `${label} unsafe node must be redacted`);
    }
    return value;
  }
  exactKeys(value, ["type", "mode", "digest"], label);
  if (value.type !== "file" || !MODE_PATTERN.test(value.mode)) {
    fail("wakeflow-managed-content-plan", `${label} file node is invalid`);
  }
  digest(value.digest, `${label}.digest`);
  return value;
}

function assertTypedId(value, type, label) {
  try {
    assertWakeflowId(value, type, label);
  } catch (cause) {
    fail("wakeflow-managed-content-plan", `${label} is not a canonical ${type} identifier`, { cause });
  }
}

function portableConfiguredRoot(value, label) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || value.includes("\\")
    || value.includes("\0")
    || /[\r\n]/u.test(value)
    || path.posix.isAbsolute(value)
    || /^[A-Za-z]:/u.test(value)
    || path.posix.normalize(value) !== value
    || value.endsWith("/")
    || value === ".."
    || value.startsWith("../../")
  ) fail("wakeflow-managed-content-plan", `${label} is not a canonical configured root`);
  return value;
}

function assertOperationSkeleton(payload, operation, at) {
  const { kind: componentKind, ownerId } = operation.component;
  const { kind: rootKind, rootId, configuredPath, basis } = operation.root;
  const idType = rootKind === "program" ? "program" : rootKind === "repository" ? "repository" : "surface";
  assertTypedId(rootId, idType, `${at}/root/rootId`);
  if (ownerId !== rootId) {
    fail("wakeflow-managed-content-plan", "managed component owner must equal its root identity", { errorPath: at });
  }
  if (rootKind === "program" && (rootId !== payload.programId || configuredPath !== ".")) {
    fail("wakeflow-managed-content-plan", "program managed content must use the program root", { errorPath: at });
  }
  portableConfiguredRoot(configuredPath, `${at}/root/configuredPath`);
  const expectedRootKind = {
    "program-memory": "program",
    "repository-memory": "repository",
    "support-memory": "surface",
  }[componentKind] ?? null;
  if (expectedRootKind !== null && rootKind !== expectedRootKind) {
    fail("wakeflow-managed-content-plan", "managed memory component uses the wrong root kind", { errorPath: at });
  }
  const expectedOwner = componentKind === "ignore" ? "ignore-manager" : "instruction-renderer";
  if (operation.owner !== expectedOwner) {
    fail("wakeflow-managed-content-plan", "managed component uses the wrong domain owner", { errorPath: at });
  }
  if (
    (componentKind !== "support-memory" && operation.ownership !== "managed-block")
    || (componentKind === "ignore" && operation.ownership !== "managed-block")
  ) fail("wakeflow-managed-content-plan", "managed component ownership is inconsistent", { errorPath: at });
  const expectedRef = componentKind === "ignore" ? ".gitignore" : payload.host.memoryFile;
  if (operation.ref !== expectedRef) {
    fail("wakeflow-managed-content-plan", "managed component ref differs from its host/component contract", {
      errorPath: at,
    });
  }
  const spec = {
    componentKind,
    ownerId,
    rootKind,
    rootId,
    configuredPath,
    ref: operation.ref,
    ownership: operation.ownership,
    basis,
  };
  if (
    operation.operationId !== stableOperationId(spec)
    || operation.resourceRef !== logicalResourceRef(spec)
  ) fail("wakeflow-managed-content-plan", "managed operation identity is not root-derived", { errorPath: at });
  if (payload.action === "fresh-initialize" && basis !== "target") {
    fail("wakeflow-managed-content-plan", "fresh managed content cannot use a source-basis root", { errorPath: at });
  }
}

function assertFileTarget(operation, at) {
  if (operation.target?.type !== "file" || operation.target.mode !== FILE_MODE_STRING) {
    fail("wakeflow-managed-content-plan", "managed physical target must be one 0644 file", { errorPath: at });
  }
}

function assertOperationMatrix(payload, operation, at) {
  const memory = operation.component.kind !== "ignore";
  if (operation.action === "current") {
    if (
      operation.classification !== "managed-current"
      || operation.reasonCode !== (memory ? "managed-content-current" : "ignore-managed-current")
      || operation.source.type !== "file"
      || operation.source.mode !== FILE_MODE_STRING
      || !sameCanonical(operation.source, operation.target)
    ) fail("wakeflow-managed-content-plan", "managed current operation matrix is invalid", { errorPath: at });
    return;
  }
  if (operation.action === "preserve") {
    if (
      memory
      || operation.classification !== "user-owned"
      || operation.reasonCode !== "ignore-satisfied-user-owned"
      || operation.source.type !== "file"
      || !sameCanonical(operation.source, operation.target)
    ) fail("wakeflow-managed-content-plan", "managed preserve operation matrix is invalid", { errorPath: at });
    return;
  }
  if (operation.action === "create-managed") {
    assertFileTarget(operation, at);
    if (
      operation.classification !== "managed-missing"
      || operation.source.type !== "absent"
      || operation.reasonCode !== (memory ? "managed-content-create" : "ignore-managed-create")
    ) fail("wakeflow-managed-content-plan", "managed create operation matrix is invalid", { errorPath: at });
    return;
  }
  if (operation.action === "update-managed") {
    assertFileTarget(operation, at);
    const expectedReason = operation.classification === "user-owned"
      ? (memory ? "managed-component-add" : "ignore-managed-component-add")
      : operation.classification === "managed-stale-known"
        ? (memory ? "managed-content-refresh" : "ignore-managed-component-refresh")
        : null;
    if (
      operation.source.type !== "file"
      || operation.reasonCode !== expectedReason
      || (
        operation.source.mode === FILE_MODE_STRING
        && operation.source.digest === operation.target.digest
      )
    ) fail("wakeflow-managed-content-plan", "managed update operation matrix is invalid", { errorPath: at });
    return;
  }
  if (operation.action === "remove-managed-block") {
    assertFileTarget(operation, at);
    const allowedReasons = memory
      ? new Set(["managed-component-no-longer-desired"])
      : new Set(["ignore-component-no-longer-desired", "ignore-now-satisfied-user-owned"]);
    if (
      operation.ownership !== "managed-block"
      || operation.classification !== "managed-stale-known"
      || operation.source.type !== "file"
      || !allowedReasons.has(operation.reasonCode)
      || operation.source.digest === operation.target.digest
    ) fail("wakeflow-managed-content-plan", "managed removal operation matrix is invalid", { errorPath: at });
    return;
  }
  if (operation.action !== "blocked" || operation.target !== null) {
    fail("wakeflow-managed-content-plan", "managed action/target relation is invalid", { errorPath: at });
  }
  const allowedClassifications = BLOCKED_REASON_CLASSIFICATIONS.get(operation.reasonCode);
  if (
    !allowedClassifications?.has(operation.classification)
    || (operation.reasonCode === "fresh-managed-footprint-present" && payload.action !== "fresh-initialize")
  ) fail("wakeflow-managed-content-plan", "managed blocked operation matrix is invalid", { errorPath: at });
}

function validatePlanInternal(value) {
  const plan = canonicalSnapshot(value, "managed-content plan");
  exactKeys(plan, ["schemaId", "payload"], "managed-content plan");
  if (plan.schemaId !== WAKEFLOW_MANAGED_CONTENT_SCHEMA_ID) {
    fail("wakeflow-managed-content-plan", "managed-content schemaId is invalid");
  }
  exactKeys(plan.payload, [
    "kind",
    "schemaVersion",
    "action",
    "status",
    "programId",
    "host",
    "sourceModelDigest",
    "desiredModelDigest",
    "authorizedRepositoryIds",
    "plannedSupportSurfaceIds",
    "operations",
    "blockers",
    "steps",
  ], "managed-content payload");
  const payload = plan.payload;
  if (
    payload.kind !== WAKEFLOW_MANAGED_CONTENT_KIND
    || payload.schemaVersion !== WAKEFLOW_MANAGED_CONTENT_SCHEMA_VERSION
    || !ACTIONS.has(payload.action)
    || !["ready", "blocked"].includes(payload.status)
  ) fail("wakeflow-managed-content-plan", "managed-content identity is invalid");
  assertTypedId(payload.programId, "program", "$/payload/programId");
  exactKeys(payload.host, ["hostId", "profileDigest", "memoryFile"], "managed-content host");
  if (!new Set(["codex", "claude-code"]).has(payload.host.hostId)) {
    fail("wakeflow-managed-content-plan", "managed-content hostId is invalid");
  }
  digest(payload.host.profileDigest, "host.profileDigest");
  portableComponent(payload.host.memoryFile, "host.memoryFile");
  if (payload.sourceModelDigest !== null) digest(payload.sourceModelDigest, "sourceModelDigest");
  digest(payload.desiredModelDigest, "desiredModelDigest");
  if (
    (payload.action === "fresh-initialize") !== (payload.sourceModelDigest === null)
    || (
      payload.action === "reconcile"
      && payload.sourceModelDigest !== payload.desiredModelDigest
    )
  ) fail("wakeflow-managed-content-plan", "managed-content action/model digests are inconsistent");
  if (
    !Array.isArray(payload.authorizedRepositoryIds)
    || canonicalJson(payload.authorizedRepositoryIds) !== canonicalJson([...payload.authorizedRepositoryIds].sort(lexicalCompare))
    || new Set(payload.authorizedRepositoryIds).size !== payload.authorizedRepositoryIds.length
  ) fail("wakeflow-managed-content-plan", "authorizedRepositoryIds is not canonical");
  for (const [index, repositoryId] of payload.authorizedRepositoryIds.entries()) {
    assertTypedId(repositoryId, "repository", `$/payload/authorizedRepositoryIds/${index}`);
  }
  if (
    !Array.isArray(payload.plannedSupportSurfaceIds)
    || canonicalJson(payload.plannedSupportSurfaceIds) !== canonicalJson([...payload.plannedSupportSurfaceIds].sort(lexicalCompare))
    || new Set(payload.plannedSupportSurfaceIds).size !== payload.plannedSupportSurfaceIds.length
  ) fail("wakeflow-managed-content-plan", "plannedSupportSurfaceIds is not canonical");
  for (const [index, surfaceId] of payload.plannedSupportSurfaceIds.entries()) {
    assertTypedId(surfaceId, "surface", `$/payload/plannedSupportSurfaceIds/${index}`);
  }
  if (!Array.isArray(payload.operations) || !Array.isArray(payload.blockers) || !Array.isArray(payload.steps)) {
    fail("wakeflow-managed-content-plan", "managed-content collections must be arrays");
  }
  const operationIds = new Set();
  let previousResource = null;
  for (const [index, operation] of payload.operations.entries()) {
    const at = `$/payload/operations/${index}`;
    exactKeys(operation, [
      "operationId",
      "component",
      "owner",
      "root",
      "ref",
      "resourceRef",
      "ownership",
      "classification",
      "source",
      "target",
      "action",
      "reasonCode",
      "stageRef",
    ], "managed-content operation", at);
    token(operation.operationId, "operationId");
    token(operation.owner, "operation owner");
    token(operation.reasonCode, "reasonCode");
    if (operationIds.has(operation.operationId)) fail("wakeflow-managed-content-plan", "duplicate operationId", { errorPath: at });
    operationIds.add(operation.operationId);
    exactKeys(operation.component, ["kind", "ownerId"], "managed component", `${at}/component`);
    if (!COMPONENT_KINDS.has(operation.component.kind) || typeof operation.component.ownerId !== "string") {
      fail("wakeflow-managed-content-plan", "managed component identity is invalid", { errorPath: `${at}/component` });
    }
    exactKeys(operation.root, ["kind", "rootId", "configuredPath", "basis"], "managed root", `${at}/root`);
    if (
      !ROOT_KINDS.has(operation.root.kind)
      || typeof operation.root.rootId !== "string"
      || typeof operation.root.configuredPath !== "string"
      || !["source", "target"].includes(operation.root.basis)
    ) fail("wakeflow-managed-content-plan", "managed root is invalid", { errorPath: `${at}/root` });
    assertOperationSkeleton(payload, operation, at);
    portableComponent(operation.ref, "operation.ref");
    if (typeof operation.resourceRef !== "string" || path.posix.isAbsolute(operation.resourceRef) || operation.resourceRef.includes("..")) {
      fail("wakeflow-managed-content-plan", "operation.resourceRef is not portable", { errorPath: `${at}/resourceRef` });
    }
    if (previousResource !== null && lexicalCompare(previousResource, operation.resourceRef) >= 0) {
      fail("wakeflow-managed-content-plan", "operations are not canonical", { errorPath: at });
    }
    previousResource = operation.resourceRef;
    if (!OWNERSHIPS.has(operation.ownership) || !CLASSIFICATIONS.has(operation.classification)) {
      fail("wakeflow-managed-content-plan", "operation ownership/classification is invalid", { errorPath: at });
    }
    validateNode(operation.source, "operation.source");
    validateNode(operation.target, "operation.target", { nullable: true });
    if (!PHYSICAL_ACTIONS.has(operation.action) && !NON_PHYSICAL_ACTIONS.has(operation.action)) {
      fail("wakeflow-managed-content-plan", "operation action is invalid", { errorPath: `${at}/action` });
    }
    if (PHYSICAL_ACTIONS.has(operation.action)) {
      if (operation.target?.type !== "file" || typeof operation.stageRef !== "string") {
        fail("wakeflow-managed-content-plan", "physical operation lacks a target/stage", { errorPath: at });
      }
      portableComponent(operation.stageRef, "operation.stageRef");
      if (operation.stageRef !== stageFileName(operation.operationId, operation.target.digest)) {
        fail("wakeflow-managed-content-plan", "physical operation stage is not target-derived", { errorPath: at });
      }
    } else if (operation.stageRef !== null) {
      fail("wakeflow-managed-content-plan", "non-physical operation cannot have a stage", { errorPath: at });
    }
    assertOperationMatrix(payload, operation, at);
  }
  const expectedBlockers = payload.operations.filter((entry) => entry.action === "blocked").map((entry) => ({
    blockerId: entry.operationId,
    operationId: entry.operationId,
    resourceRef: entry.resourceRef,
    code: entry.reasonCode,
  }));
  if (!sameCanonical(payload.blockers, expectedBlockers)) {
    fail("wakeflow-managed-content-plan", "managed-content blockers are not derived");
  }
  const expectedSteps = payload.operations
    .filter((entry) => PHYSICAL_ACTIONS.has(entry.action))
    .map((entry, ordinal) => stepForOperation(entry, ordinal));
  if (!sameCanonical(payload.steps, expectedSteps)) {
    fail("wakeflow-managed-content-plan", "managed-content steps are not derived");
  }
  const blocked = expectedBlockers.length > 0;
  if (payload.status !== (blocked ? "blocked" : "ready")) {
    fail("wakeflow-managed-content-plan", "managed-content status is not derived");
  }
  return deepFreeze(plan);
}

/**
 * 只读规划所有 eligible memory 与 `.gitignore` component；返回 plan 不携带绝对路径或目标字节。
 */
export function planWakeflowManagedContent(value) {
  const normalized = normalizePlanningInput(value);
  assertManagedContentConfigAuthority(normalized);
  return derivePlanInternal(normalized).plan;
}

/**
 * 独立 codec：校验 plan 的封闭字段、typed identity、action/reason matrix 与派生 steps。
 */
export function validateWakeflowManagedContentPlan(value) {
  return validatePlanInternal(value);
}

function maintenanceComponentId(owner) {
  if (owner === "ignore-manager") return "ignore";
  if (owner === "instruction-renderer") return "managed-memory";
  fail("wakeflow-managed-content-plan", "managed-content operation has an unknown maintenance owner", {
    details: { owner },
  });
}

function maintenanceRoot(root) {
  return {
    kind: root.kind === "surface" ? "support-surface" : root.kind,
    rootId: root.rootId,
    basis: root.basis,
    configuredPath: root.configuredPath,
  };
}

function maintenanceAuthorization(operation) {
  if (operation.root.kind === "repository") {
    return {
      kind: "explicit-repository",
      repositoryId: operation.root.rootId,
    };
  }
  return {
    kind: operation.ownership === "managed-whole-file"
      ? "wakeflow-owned"
      : "configured-managed-component",
  };
}

/**
 * 把 owner plan 投影进统一 maintenance graph；这里只翻译职责，不重新判断文件事实。
 */
export function projectWakeflowManagedContentMaintenance(value) {
  const input = exactInput(
    value,
    ["plan", "transactionOffset"],
    "managed-content maintenance projection input",
  );
  const plan = validatePlanInternal(input.plan);
  if (!Number.isSafeInteger(input.transactionOffset) || input.transactionOffset < 0) {
    fail("wakeflow-managed-content-input", "transactionOffset must be a non-negative safe integer");
  }
  const planDigest = canonicalJsonDigest(plan);
  const componentFor = (operation) => maintenanceComponentId(operation.owner);
  const stepIndexById = new Map(plan.payload.steps.map((step, index) => [step.stepId, index]));
  const filesystemActions = plan.payload.operations
    .filter((operation) => operation.action !== "blocked")
    .map((operation) => {
      const physicalIndex = stepIndexById.get(operation.operationId);
      const physical = physicalIndex !== undefined;
      return {
        actionId: operation.operationId,
        componentId: componentFor(operation),
        owner: operation.owner,
        root: maintenanceRoot(operation.root),
        ref: operation.ref,
        resourceRef: operation.resourceRef,
        classification: operation.classification,
        source: operation.source,
        target: operation.target,
        action: operation.action,
        authorization: maintenanceAuthorization(operation),
        reasonCode: operation.reasonCode,
        stepId: physical ? operation.operationId : null,
        commitOrder: physical ? input.transactionOffset + physicalIndex : null,
      };
    })
    .sort((left, right) => lexicalCompare(left.actionId, right.actionId));
  const blocked = plan.payload.operations.filter((operation) => operation.action === "blocked");
  const dependencyChecks = blocked.map((operation) => ({
    checkId: `managed-content-blocked-${operation.operationId.slice("managed-content-".length)}`,
    componentId: componentFor(operation),
    owner: operation.owner,
    subject: { kind: "resource", value: operation.resourceRef },
    status: "blocked",
    code: operation.reasonCode,
    evidence: [{ kind: "owner-plan", ref: operation.resourceRef, digest: planDigest }],
  }));
  const blockers = dependencyChecks.map((dependency) => ({
    blockerId: dependency.checkId,
    componentId: dependency.componentId,
    owner: dependency.owner,
    subject: dependency.subject,
    code: dependency.code,
    dependencyCheckId: dependency.checkId,
  }));
  const deferredOwnerActions = dependencyChecks.map((dependency) => ({
    deferredId: dependency.checkId,
    componentId: dependency.componentId,
    owner: dependency.owner,
    action: "resolve-managed-content-conflict",
    subject: dependency.subject,
    prerequisiteCheckIds: [dependency.checkId],
    reasonCode: dependency.code,
  }));
  const result = {
    components: [
      {
        componentId: "ignore",
        owner: "ignore-manager",
        ownerPlanDigest: planDigest,
      },
      {
        componentId: "managed-memory",
        owner: "instruction-renderer",
        ownerPlanDigest: planDigest,
      },
    ],
    filesystemActions,
    dependencyChecks,
    preserved: filesystemActions
      .filter((operation) => operation.action === "preserve")
      .map((operation) => ({
        actionId: operation.actionId,
        reasonCode: operation.reasonCode,
      })),
    deferredOwnerActions,
    blockers,
    steps: plan.payload.steps.map((step, index) => ({
      ...step,
      ordinal: input.transactionOffset + index,
    })),
  };
  return deepFreeze(canonicalSnapshot(result, "managed-content maintenance projection"));
}

function assertContext(workspaceRoot, context) {
  if (context === null || typeof context !== "object") {
    fail("wakeflow-managed-content-context", "a branded workspace mutation context is required");
  }
  // 先验证 WeakMap 品牌，再读取 context 字段；伪造对象的 getter 不能在 admission 前执行。
  assertWakeflowMutationContext({ workspaceRoot, context });
  const mode = context.recoveryGeneration > 0 ? "recovery-cleanup" : "maintenance";
  assertWakeflowMutationContext({ workspaceRoot, context, mode });
}

function assertManagedContentConfigAuthority(normalized, context = null) {
  try {
    assertWakeflowConfigV3TransitionAuthority({
      workspaceRoot: normalized.workspaceRoot,
      action: normalized.action,
      sourceModel: normalized.sourceModel,
      desiredModel: normalized.desiredModel,
      context,
    });
    // config 字节仍有 authority 不代表配置根的物理路径仍安全；每个 mutation
    // 边界都重走逐段 lstat，防止 participant 创建后中间目录被换成 symlink。
    validateWakeflowConfigRootPlacements({
      workspaceRoot: normalized.workspaceRoot,
      model: normalized.desiredModel,
    });
    if (normalized.sourceModel !== null) {
      validateWakeflowConfigRootPlacements({
        workspaceRoot: normalized.workspaceRoot,
        model: normalized.sourceModel,
      });
    }
  } catch (cause) {
    fail("wakeflow-managed-content-config", "strict current v3 config authority is unavailable", { cause });
  }
}

function openRoot(root, expected = null) {
  let descriptor;
  try {
    descriptor = openSync(
      root.absolute,
      fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0) | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const stat = fstatSync(descriptor, { bigint: true });
    if (!stat.isDirectory() || stat.uid !== currentEuid() || (expected && !sameIdentity(stat, expected))) {
      fail("wakeflow-managed-content-root", "managed root descriptor is unsafe or stale");
    }
    const refreshed = lstatSync(root.absolute, { bigint: true });
    if (!sameIdentity(stat, refreshed)) fail("wakeflow-managed-content-race", "managed root path changed");
    return { descriptor, stat };
  } catch (cause) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (cause instanceof WakeflowManagedContentError) throw cause;
    fail("wakeflow-managed-content-root", "managed root cannot be opened safely", { cause });
  }
}

function absentResource(ref) {
  return { ref, type: "absent" };
}

function resource(ref, node) {
  return { ref, ...node };
}

function inspectPhysicalOperation(privateOperation, operation, step) {
  const root = rootState(path.dirname(privateOperation.root.absolute), path.basename(privateOperation.root.absolute));
  if (root.classification !== "current") {
    if (
      root.classification === "missing"
      && privateOperation.root.classification === "planned"
      && operation.source.type === "absent"
    ) {
      return {
        state: "initial",
        observation: {
          source: resource(step.source.ref, operation.source),
          staging: absentResource(step.staging.ref),
          final: resource(step.final.ref, operation.source),
        },
        root: privateOperation.root,
        final: { classification: "absent", absolute: path.join(root.absolute, operation.ref), stat: null, bytes: null },
        stage: { classification: "absent", absolute: path.join(root.absolute, privateOperation.physicalStageRef), stat: null, bytes: null },
      };
    }
    fail("wakeflow-managed-content-stale", "managed operation root is unavailable");
  }
  if (
    privateOperation.root.classification === "current"
    && (
      !sameIdentity(root.stat, privateOperation.root.stat)
      || root.realPath !== privateOperation.root.realPath
    )
  ) fail("wakeflow-managed-content-stale", "managed operation root identity changed");
  const final = inspectFile(root, operation.ref, { allowLinkedPair: true });
  const stage = inspectFile(root, privateOperation.physicalStageRef, { allowLinkedPair: true });
  if ([final.classification, stage.classification].includes("unsafe")) {
    fail("wakeflow-managed-content-residue", "managed operation observed unsafe file residue");
  }
  const finalNode = publicNode(final);
  const stageNode = publicNode(stage);
  const sourceExact = sameCanonical(finalNode, operation.source);
  const targetExact = sameCanonical(finalNode, operation.target);
  const stageAbsent = stage.classification === "absent";
  const stageTarget = sameCanonical(stageNode, operation.target);
  const linkedPair = targetExact
    && stageTarget
    && final.stat
    && stage.stat
    && sameIdentity(final.stat, stage.stat)
    && final.stat.nlink === 2n
    && stage.stat.nlink === 2n;
  let state = "illegal";
  if (sourceExact && stageAbsent) state = "initial";
  else if (sourceExact && stageTarget && stage.stat.nlink === 1n) state = "prepared";
  else if (targetExact && stageAbsent) state = "committed";
  else if (operation.source.type === "absent" && linkedPair) state = "committed-pair";
  const observation = state === "initial"
    ? {
        source: resource(step.source.ref, operation.source),
        staging: absentResource(step.staging.ref),
        final: resource(step.final.ref, operation.source),
      }
    : state === "prepared"
      ? {
          source: resource(step.source.ref, operation.source),
          staging: resource(step.staging.ref, operation.target),
          final: resource(step.final.ref, operation.source),
        }
      : ["committed", "committed-pair"].includes(state)
        ? {
            source: resource(step.source.ref, operation.target),
            staging: absentResource(step.staging.ref),
            final: resource(step.final.ref, operation.target),
          }
        : null;
  return { state, observation, root, final, stage };
}

function sameOptionalStableFile(left, right) {
  if (left === null || right === null) return left === right;
  return sameStableFile(left, right);
}

function createStepHandler(workspaceRoot, operation, privateOperation, step, validateAuthority) {
  let lastPrepared = null;
  return Object.freeze({
    prepare(args) {
      const { context } = callbackArguments(args, ["context"], `${step.stepId}.prepare arguments`);
      assertContext(workspaceRoot, context);
      validateAuthority(context);
      const inspected = inspectPhysicalOperation(privateOperation, operation, step);
      if (inspected.state !== "initial") {
        fail("wakeflow-managed-content-stale", "managed source changed before prepare");
      }
      const rootHandle = openRoot(inspected.root, inspected.root.stat);
      let descriptor;
      try {
        const current = inspectPhysicalOperation(privateOperation, operation, step);
        if (
          current.state !== "initial"
          || !sameIdentity(current.root.stat, rootHandle.stat)
          || !sameOptionalStableFile(current.final.stat, inspected.final.stat)
        ) fail("wakeflow-managed-content-stale", "managed source changed after opening its root");
        descriptor = openSync(
          path.join(inspected.root.absolute, privateOperation.physicalStageRef),
          fsConstants.O_WRONLY
            | fsConstants.O_CREAT
            | fsConstants.O_EXCL
            | (fsConstants.O_NOFOLLOW ?? 0),
          0o600,
        );
        writeFileSync(descriptor, privateOperation.targetBytes);
        fchmodSync(descriptor, FILE_MODE);
        fsyncSync(descriptor);
        const stat = fstatSync(descriptor, { bigint: true });
        if (
          !stat.isFile()
          || stat.uid !== currentEuid()
          || stat.nlink !== 1n
          || modeString(stat) !== FILE_MODE_STRING
          || stat.size !== BigInt(privateOperation.targetBytes.length)
        ) fail("wakeflow-managed-content-prepare", "managed stage did not reach its exact contract");
        fsyncSync(rootHandle.descriptor);
        const refreshedRoot = lstatSync(inspected.root.absolute, { bigint: true });
        if (!sameIdentity(refreshedRoot, rootHandle.stat)) {
          fail("wakeflow-managed-content-race", "managed root changed during prepare");
        }
      } catch (cause) {
        if (cause instanceof WakeflowManagedContentError) throw cause;
        fail("wakeflow-managed-content-prepare", "managed stage publication failed", { cause });
      } finally {
        if (descriptor !== undefined) closeSync(descriptor);
        closeSync(rootHandle.descriptor);
      }
    },

    observe(args) {
      const { context } = callbackArguments(args, ["context"], `${step.stepId}.observe arguments`);
      assertContext(workspaceRoot, context);
      validateAuthority(context);
      const inspected = inspectPhysicalOperation(privateOperation, operation, step);
      if (inspected.state === "illegal" || inspected.observation === null) {
        fail("wakeflow-managed-content-residue", "managed operation has an illegal physical state");
      }
      lastPrepared = inspected.state === "prepared" ? {
        rootIdentity: inspected.root.stat,
        finalIdentity: inspected.final.stat,
        stageIdentity: inspected.stage.stat,
      } : null;
      return inspected.observation;
    },

    commit(args) {
      const { context } = callbackArguments(args, ["context"], `${step.stepId}.commit arguments`);
      assertContext(workspaceRoot, context);
      validateAuthority(context);
      if (!lastPrepared) fail("wakeflow-managed-content-race", "managed commit lacks an exact prepared observation");
      const expected = lastPrepared;
      lastPrepared = null;
      const inspected = inspectPhysicalOperation(privateOperation, operation, step);
      if (
        inspected.state !== "prepared"
        || !sameIdentity(inspected.root.stat, expected.rootIdentity)
        || !sameStableFile(inspected.stage.stat, expected.stageIdentity)
        || !sameOptionalStableFile(inspected.final.stat, expected.finalIdentity)
      ) fail("wakeflow-managed-content-stale", "managed source or stage changed before commit");
      const rootHandle = openRoot(inspected.root, expected.rootIdentity);
      try {
        const current = inspectPhysicalOperation(privateOperation, operation, step);
        if (
          current.state !== "prepared"
          || !sameIdentity(current.root.stat, rootHandle.stat)
          || !sameStableFile(current.stage.stat, expected.stageIdentity)
          || !sameOptionalStableFile(current.final.stat, expected.finalIdentity)
        ) fail("wakeflow-managed-content-stale", "managed source or stage changed after opening its root");
        const stagePath = path.join(inspected.root.absolute, privateOperation.physicalStageRef);
        const finalPath = path.join(inspected.root.absolute, operation.ref);
        if (operation.source.type === "absent") linkSync(stagePath, finalPath);
        else renameSync(stagePath, finalPath);
        fsyncSync(rootHandle.descriptor);
        const committed = inspectPhysicalOperation(privateOperation, operation, step);
        const allowed = operation.source.type === "absent" ? "committed-pair" : "committed";
        if (committed.state !== allowed) {
          fail("wakeflow-managed-content-commit", "managed commit did not reach its exact target state");
        }
        const refreshedRoot = lstatSync(inspected.root.absolute, { bigint: true });
        if (!sameIdentity(refreshedRoot, rootHandle.stat)) {
          fail("wakeflow-managed-content-race", "managed root changed during commit");
        }
      } catch (cause) {
        if (cause instanceof WakeflowManagedContentError) throw cause;
        fail("wakeflow-managed-content-commit", "managed commit failed", { cause });
      } finally {
        closeSync(rootHandle.descriptor);
      }
    },

    cleanup(args) {
      const { context } = callbackArguments(args, ["context"], `${step.stepId}.cleanup arguments`);
      assertContext(workspaceRoot, context);
      validateAuthority(context);
      const inspected = inspectPhysicalOperation(privateOperation, operation, step);
      if (inspected.state === "committed") return;
      if (inspected.state !== "committed-pair") {
        fail("wakeflow-managed-content-cleanup", "managed cleanup lacks an exact committed state");
      }
      const rootHandle = openRoot(inspected.root, inspected.root.stat);
      try {
        const current = inspectPhysicalOperation(privateOperation, operation, step);
        if (
          current.state !== "committed-pair"
          || !sameIdentity(current.root.stat, rootHandle.stat)
          || !sameStableFile(current.final.stat, inspected.final.stat)
          || !sameStableFile(current.stage.stat, inspected.stage.stat)
        ) fail("wakeflow-managed-content-stale", "managed committed pair changed before cleanup");
        unlinkSync(path.join(inspected.root.absolute, privateOperation.physicalStageRef));
        fsyncSync(rootHandle.descriptor);
        const terminal = inspectPhysicalOperation(privateOperation, operation, step);
        if (terminal.state !== "committed") {
          fail("wakeflow-managed-content-cleanup", "managed cleanup did not leave one exact final file");
        }
      } catch (cause) {
        if (cause instanceof WakeflowManagedContentError) throw cause;
        fail("wakeflow-managed-content-cleanup", "managed stage cleanup failed", { cause });
      } finally {
        closeSync(rootHandle.descriptor);
      }
    },
  });
}

function terminalOperationTuple(operation, privateOperation, step = null) {
  if (PHYSICAL_ACTIONS.has(operation.action)) {
    const inspected = inspectPhysicalOperation(privateOperation, operation, step);
    // M3 在 cleanup 前持久化第一次 closure；create 的 no-replace 发布此时合法地
    // 保留 final/stage 同 inode 的 exact pair，cleanup 后第二次 closure 必须不变。
    if (!["committed", "committed-pair"].includes(inspected.state)) {
      fail("wakeflow-managed-content-terminal", "managed physical operation is not committed");
    }
  } else {
    const root = rootState(path.dirname(privateOperation.root.absolute), path.basename(privateOperation.root.absolute));
    if (root.classification !== "current") fail("wakeflow-managed-content-terminal", "managed root is unavailable");
    const final = inspectFile(root, operation.ref);
    if (!sameCanonical(publicNode(final), operation.target)) {
      fail("wakeflow-managed-content-terminal", "managed non-physical operation changed");
    }
  }
  return {
    operationId: operation.operationId,
    resourceRef: operation.resourceRef,
    action: operation.action,
    targetDigest: operation.target.digest,
  };
}

function reconstructConfirmedPrivateOperations(normalized, confirmedPlan, currentDerived) {
  const privateOperations = new Map();
  for (const operation of confirmedPlan.payload.operations) {
    if (operation.target?.type !== "file") {
      fail("wakeflow-managed-content-plan", "ready managed-content operation lacks one file target");
    }
    const root = rootState(normalized.workspaceRoot, operation.root.configuredPath);
    const plannedRoot = root.classification === "missing"
      && operation.root.kind === "surface"
      && normalized.plannedSupportSurfaceIds.includes(operation.root.rootId);
    if (plannedRoot) root.classification = "planned";
    if (!new Set(["current", "planned"]).has(root.classification)) {
      fail("wakeflow-managed-content-stale", "confirmed managed-content root is unavailable");
    }
    const final = inspectFile(root, operation.ref, { allowLinkedPair: true });
    if (final.classification === "unsafe") {
      fail("wakeflow-managed-content-residue", "confirmed managed-content final is unsafe");
    }
    const stage = operation.stageRef === null
      ? null
      : inspectFile(root, operation.stageRef, { allowLinkedPair: true });
    if (stage?.classification === "unsafe") {
      fail("wakeflow-managed-content-residue", "confirmed managed-content stage is unsafe");
    }
    const currentPrivate = currentDerived.privateOperations.get(operation.operationId) ?? null;
    const candidates = [
      currentPrivate?.targetBytes ?? null,
      final.bytes,
      stage?.bytes ?? null,
    ].filter((entry) => Buffer.isBuffer(entry));
    const targetBytes = candidates.find((entry) => digestBytes(entry) === operation.target.digest) ?? null;
    if (targetBytes === null) {
      fail("wakeflow-managed-content-stale", "confirmed managed-content target bytes cannot be reconstructed");
    }
    privateOperations.set(operation.operationId, {
      root,
      final,
      targetBytes,
      physicalStageRef: operation.stageRef,
    });
  }
  return privateOperations;
}

/**
 * 为一份已确认 plan 构造 M3 participant；私有目标字节和物理路径只保留在进程内闭包。
 */
export function createWakeflowManagedContentMutationParticipant(value) {
  const normalized = normalizePlanningInput(value, { participant: true });
  const confirmedPlan = validatePlanInternal(normalized.confirmedPlan);
  assertConfirmedSemanticContract(normalized, confirmedPlan);
  const derived = derivePlanInternal(normalized);
  if (confirmedPlan.payload.status !== "ready") {
    fail("wakeflow-managed-content-blocked", "a blocked managed-content plan cannot create a participant");
  }
  const privateOperations = reconstructConfirmedPrivateOperations(normalized, confirmedPlan, derived);
  const operationById = new Map(confirmedPlan.payload.operations.map((entry) => [entry.operationId, entry]));
  const stepById = new Map(confirmedPlan.payload.steps.map((entry) => [entry.stepId, entry]));
  if (!sameCanonical(confirmedPlan, derived.plan)) {
    let recoveryBoundaryObserved = false;
    for (const step of confirmedPlan.payload.steps) {
      const operation = operationById.get(step.stepId);
      const privateOperation = privateOperations.get(step.stepId);
      const inspected = inspectPhysicalOperation(privateOperation, operation, step);
      if (!new Set(["initial", "prepared", "committed", "committed-pair"]).has(inspected.state)) {
        fail("wakeflow-managed-content-residue", "confirmed plan differs at an illegal physical state");
      }
      recoveryBoundaryObserved ||= inspected.state !== "initial";
    }
    if (!recoveryBoundaryObserved) {
      fail("wakeflow-managed-content-plan", "confirmed managed-content plan differs from current owner plan");
    }
  }
  const validateAuthority = (context) => assertManagedContentConfigAuthority(normalized, context);
  const stepHandlers = Object.fromEntries(confirmedPlan.payload.steps.map((step) => {
    const operation = operationById.get(step.stepId);
    const privateOperation = privateOperations.get(step.stepId);
    if (!operation || !privateOperation) {
      fail("wakeflow-managed-content-plan", "managed-content step has no private owner operation");
    }
    return [step.stepId, createStepHandler(
      normalized.workspaceRoot,
      operation,
      privateOperation,
      step,
      validateAuthority,
    )];
  }));

  return Object.freeze({
    validatePlan(args) {
      const { plan } = callbackArguments(args, ["plan"], "managed-content validatePlan arguments");
      const candidate = validatePlanInternal(plan);
      if (!sameCanonical(candidate, confirmedPlan)) {
        fail("wakeflow-managed-content-plan", "managed-content plan differs from participant contract");
      }
      return { valid: true };
    },

    deriveCurrentPlan(args) {
      const { context } = callbackArguments(
        args,
        ["context"],
        "managed-content deriveCurrentPlan arguments",
      );
      if (context !== null) assertContext(normalized.workspaceRoot, context);
      assertManagedContentConfigAuthority(normalized, context);
      const recovery = context === null || context.recoveryGeneration > 0;
      if (!recovery) {
        const current = derivePlanInternal(normalized).plan;
        if (!sameCanonical(current, confirmedPlan)) {
          fail("wakeflow-managed-content-stale", "managed-content source changed since confirmation");
        }
        return confirmedPlan;
      }
      for (const step of confirmedPlan.payload.steps) {
        const operation = operationById.get(step.stepId);
        const privateOperation = privateOperations.get(step.stepId);
        const inspected = inspectPhysicalOperation(privateOperation, operation, step);
        if (!["initial", "prepared", "committed", "committed-pair"].includes(inspected.state)) {
          fail("wakeflow-managed-content-residue", "managed-content recovery observed illegal residue");
        }
      }
      return confirmedPlan;
    },

    deriveTerminalClosure(args) {
      const { context, plan, planDigest } = callbackArguments(
        args,
        ["context", "plan", "planDigest"],
        "managed-content terminal closure arguments",
      );
      assertContext(normalized.workspaceRoot, context);
      assertManagedContentConfigAuthority(normalized, context);
      if (!sameCanonical(plan, confirmedPlan) || planDigest !== canonicalJsonDigest(confirmedPlan)) {
        fail("wakeflow-managed-content-plan", "terminal closure received a different managed-content plan");
      }
      const tuples = confirmedPlan.payload.operations.map((operation) => {
        const privateOperation = privateOperations.get(operation.operationId);
        if (!privateOperation || operation.target?.type !== "file") {
          fail("wakeflow-managed-content-terminal", "ready managed-content operation lacks a terminal target");
        }
        return terminalOperationTuple(operation, privateOperation, stepById.get(operation.operationId) ?? null);
      });
      return {
        planDigest,
        closureDigests: [{
          name: "managed-content-closure",
          digest: canonicalJsonDigest({
            kind: "WakeflowManagedContentClosure",
            schemaVersion: 1,
            programId: confirmedPlan.payload.programId,
            hostId: confirmedPlan.payload.host.hostId,
            operations: tuples,
          }),
        }],
      };
    },

    stepHandlers: Object.freeze(stepHandlers),
  });
}
