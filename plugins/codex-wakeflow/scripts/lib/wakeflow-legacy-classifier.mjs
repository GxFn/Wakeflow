import { createHash } from "node:crypto";
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";

import { canonicalJson, canonicalJsonDigest } from "./wakeflow-canonical-json.mjs";

/**
 * 本文件是 migration-only legacy 单源分类器，不是迁移执行器。
 *
 * 职责分为五层：
 * 1. 以闭合 schema、逐 entry 语义 digest 和受限 no-follow read 校验发行 catalog；
 * 2. 校验调用方已经观察到的 exact source bytes、portable ref 与 surface/ownership 事实；
 * 3. 将历史 whole-file、config typed shape 和 mixed-owned component 映射为 D39 四动作候选；
 * 4. 只返回 origin、typed-slot digest、前置条件和 release gate，不回显本机或秘密槽值；
 * 5. 始终把 lifecycleConclusion 保持为 unresolved，交由 inventory、owner-drain 与 migration plan 关联。
 *
 * 本文件不扫描目录、不判断旧 owner 已静止、不创建 target、不执行 host/Git/filesystem effect，
 * 也不因 exact-known 或文件名相似而授予删除资格。
 */

export const WAKEFLOW_LEGACY_CLASSIFIER_CATALOG_KIND = "wakeflow-legacy-classifier-catalog";
export const WAKEFLOW_LEGACY_CLASSIFIER_CATALOG_VERSION = 1;
export const WAKEFLOW_LEGACY_CLASSIFIER_ACTIONS = Object.freeze([
  "keep",
  "manual",
  "remove",
  "transform",
]);
export const WAKEFLOW_LEGACY_CLASSIFIER_CONFIDENCE = Object.freeze([
  "component-known",
  "exact-known",
  "typed-known",
  "unknown",
]);

const CATALOG_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../data/wakeflow-legacy-classifier-catalog.json",
);
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SLOT_MARKER_PATTERN = /@wakeflow-classifier-slot\[([a-z0-9-]+)\|([a-z0-9-]+)\|([a-z0-9._-]+)\]@/gu;
const SURFACE_KINDS = Object.freeze([
  "controller",
  "design-support",
  "product-repository",
  "test-support",
  "workspace-parent",
]);
const OWNERSHIP_KINDS = Object.freeze([
  "managed-block",
  "owner-managed",
  "unknown",
  "wakeflow-managed",
]);
const ROOT_FAMILIES = Object.freeze([
  "current-root-flat-canonical-name",
  "current-root-flat-legacy-name",
  "current-root-v2",
  "old-root-flat",
]);
const CLASSIFIER_MODES = Object.freeze([
  "claude-settings-components",
  "config-schema",
  "gitignore-components",
  "memory-marker",
  "memory-whole",
  "whole-file",
]);
const MODE_FORMATS = new Map([
  ["claude-settings-components", "json"],
  ["config-schema", "json"],
  ["gitignore-components", "gitignore"],
  ["memory-marker", "markdown"],
  ["memory-whole", "markdown"],
]);
const FORMATS = Object.freeze([
  "gitignore",
  "javascript",
  "json",
  "jsonl",
  "markdown",
  "text",
]);
const SLOT_TYPES = Object.freeze([
  "absolute-path",
  "artifact-id",
  "digest",
  "host-handle",
  "iso-time",
  "process-id",
  "relative-path",
  "repository-name",
  "secret-token",
  "window-name",
  "workspace-name",
]);
const SLOT_SENSITIVITY = Object.freeze(["local", "portable", "secret"]);
const DISPOSITION_POLICIES = new Set([
  "active-demand",
  "active-derived",
  "active-test-exchange",
  "active-todo",
  "claude-runtime",
  "claude-window-host",
  "keep-live",
  "lease",
  "ledger-derived",
  "legacy-starter",
  "local-derived-config",
  "local-readme",
  "local-result",
  "mixed-claude-settings",
  "mixed-gitignore",
  "mixed-memory",
  "next-work-cache",
  "old-root",
  "pending-merge",
  "pod-aggregate",
  "pod-reservation",
  "preservation",
  "statusline-asset",
  "stop-marker",
  "support-memory",
  "support-scaffold",
  "thread-registry",
  "tracked-config",
  "transport-chain",
  "window-config",
  "worktree",
]);
const INPUT_FIELDS = Object.freeze([
  "gitIgnoreRoot",
  "ownership",
  "relativePath",
  "sourceBytes",
  "surfaceKind",
]);
const CATALOG_FIELDS = Object.freeze([
  "artifactKind",
  "catalogDigest",
  "coverage",
  "entries",
  "schemaVersion",
]);
const COVERAGE_FIELDS = Object.freeze([
  "originCount",
  "pendingOriginCount",
  "scenarioFileReferences",
  "staticFileReferences",
  "templateCount",
]);
const ENTRY_FIELDS = Object.freeze([
  "artifact",
  "canonicalClassifierDigest",
  "classifierMode",
  "contentTemplateBase64",
  "dispositionPolicy",
  "entryId",
  "format",
  "originCandidates",
  "pathTemplate",
  "producerRoutes",
  "rawFixtureDigests",
  "rootFamilies",
  "slots",
  "surfaceKind",
]);
const ARTIFACT_FIELDS = Object.freeze(["kind", "schema"]);
const SLOT_FIELDS = Object.freeze(["id", "marker", "sensitivity", "type"]);
const DISPOSITION_FIELDS = Object.freeze(["action", "prerequisites", "releaseGates", "route"]);
const OUTPUT_ARTIFACT_FIELDS = Object.freeze(["format", "kind", "schema"]);
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;
const RESERVED_SLOT_PREFIX = "@wakeflow-classifier-slot[";
const MAX_CATALOG_ARRAY_ENTRIES = 20_000;
const MAX_CATALOG_BYTES = 4 * 1024 * 1024;
const MAX_PRESERVED_REVIEW_AFTER_DAYS = 36_500;
const MAX_RELATIVE_PATH_BYTES = 4 * 1024;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

const FLAT_CONFIG_FIELDS = new Set([
  "$schema",
  "activeLedgerRoot",
  "allowMissingRepos",
  "allowedRepositoryResiduePaths",
  "baseWindow",
  "configMigrationWarnings",
  "controllerWindow",
  "derived",
  "designHandoffBoard",
  "designHandoffInbox",
  "designWindow",
  "disallowedTrackedPaths",
  "dispatchWindows",
  "globalTodoPath",
  "goalStageConfirmationDir",
  "hosts",
  "interfaceLanguage",
  "internalDesignPath",
  "internalTestPath",
  "maxActiveDemands",
  "preservedRetentionDays",
  "projectLedgerRoot",
  "protectedWorkspacePrefixes",
  "realProjectWindow",
  "repoNames",
  "repositories",
  "repositoryRoles",
  "requiredDispatchWindows",
  "requirementDesignsDir",
  "runtimeMode",
  "runtimeProcessLabel",
  "runtimeProcessMatchers",
  "schemaVersion",
  "testExchangePath",
  "testWindow",
  "wakeflowRepoDir",
  "windowLedgerDirs",
  "windowLedgerRoot",
  "windows",
  "workspaceArchiveDir",
  "workspaceCurrentDir",
  "workspaceCurrentIndexPath",
  "workspaceCurrentStatusPath",
  "workspaceDocsDir",
  "workspaceIndexPath",
  "workspaceName",
  "workspaceRecordMapPath",
  "workspaceRoot",
]);
const NESTED_CONFIG_FIELDS = new Set([
  "$schema",
  "derived",
  "hosts",
  "policy",
  "repositories",
  "roles",
  "schemaVersion",
  "storage",
  "workspace",
]);
const WORKSPACE_FIELDS = new Set(["language", "name", "root", "runtimeMode", "wakeflowRepoDir"]);
const ROLE_FIELDS = new Set(["base", "controller", "design", "realProject", "test"]);
const STORAGE_FIELDS = new Set(["activeRoot", "ledgerRoot", "localRoot", "paths", "windowLedgerDirs", "windowLedgerRoot"]);
const STORAGE_PATH_FIELDS = new Set([
  "globalTodoPath",
  "goalStageConfirmationDir",
  "requirementDesignsDir",
  "testExchangePath",
  "workspaceArchiveDir",
  "workspaceCurrentDir",
  "workspaceCurrentIndexPath",
  "workspaceCurrentStatusPath",
  "workspaceDocsDir",
  "workspaceIndexPath",
  "workspaceRecordMapPath",
]);
const POLICY_FIELDS = new Set([
  "allowMissingRepos",
  "allowedRepositoryResiduePaths",
  "disallowedTrackedPaths",
  "preservedRetentionDays",
  "runtimeProcessLabel",
  "runtimeProcessMatchers",
]);
const REPOSITORY_FIELDS = new Set([
  "managedAgents",
  "maxStreams",
  "maxStreamsPerRepo",
  "mode",
  "path",
  "role",
  "stream",
  "windowName",
]);
const STREAM_FIELDS = new Set(["branch", "demandKey", "openedAt", "repo", "repoPath", "streamId"]);
const DERIVED_FIELDS = new Set(["baseHash", "from", "generatedAt", "kind", "streamWindows", "version"]);
const CODEX_HOST_FIELDS = new Set(["maxStreamsPerRepo", "modelByRole", "thinkingByRole"]);
const CLAUDE_HOST_FIELDS = new Set([
  "claudeArgs",
  "effortByRole",
  "maxStreamsPerRepo",
  "modelByRole",
  "permissionMode",
  "tmuxSession",
  "tmuxSocket",
]);
const ROLE_MAP_FIELDS = new Set(["controller", "default", "design", "product", "test"]);

let cachedCatalog = null;

// ==================== 一、catalog 与无行为输入合同 ====================

/** 分类器的稳定错误面；path 只描述逻辑合同位置，不包含 workspace 物理路径。 */
export class WakeflowLegacyClassifierError extends Error {
  constructor(code, message, { errorPath = "$", details = {} } = {}) {
    super(message);
    this.name = "WakeflowLegacyClassifierError";
    this.code = code;
    this.path = errorPath;
    this.details = deepFreeze({ ...details });
  }
}

function fail(code, errorPath, message, details = {}) {
  throw new WakeflowLegacyClassifierError(code, `${message} at ${errorPath}`, {
    errorPath,
    details,
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownData(value, key, errorPath, code) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
    fail(code, errorPath, "expected an enumerable data property");
  }
  return descriptor.value;
}

function exactObject(value, fields, errorPath, code) {
  if (!isPlainObject(value)) fail(code, errorPath, "expected a plain object");
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== "string")) {
    fail(code, errorPath, "symbol properties are not allowed");
  }
  const sorted = actual.sort(compareText);
  const expected = [...fields].sort(compareText);
  if (canonicalJson(sorted) !== canonicalJson(expected)) {
    fail(code, errorPath, "object fields do not match the closed contract", { actual: sorted, expected });
  }
  return Object.fromEntries(fields.map((field) => [field, ownData(value, field, `${errorPath}/${field}`, code)]));
}

function denseArray(value, errorPath, code) {
  if (!Array.isArray(value)) fail(code, errorPath, "expected an array");
  if (value.length > MAX_CATALOG_ARRAY_ENTRIES) {
    fail(code, errorPath, "array exceeds its bounded entry count");
  }
  const actualKeys = Reflect.ownKeys(value);
  if (
    actualKeys.some((key) => (
      typeof key !== "string"
      || (key !== "length" && (!/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length))
    ))
    || actualKeys.length !== value.length + 1
  ) {
    fail(code, errorPath, "array carries properties outside its closed dense contract");
  }
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) fail(code, `${errorPath}/${index}`, "sparse arrays are not allowed");
    result.push(ownData(value, String(index), `${errorPath}/${index}`, code));
  }
  return result;
}

function lexicalStrings(value, errorPath, { allowEmpty = true, pattern = null } = {}) {
  const entries = denseArray(value, errorPath, "wakeflow-legacy-classifier-catalog-shape").map((entry, index) => {
    if (typeof entry !== "string" || !entry || entry !== entry.trim() || (pattern && !pattern.test(entry))) {
      fail("wakeflow-legacy-classifier-catalog-shape", `${errorPath}/${index}`, "expected a supported non-empty string", { value: entry });
    }
    return entry;
  });
  if (!allowEmpty && entries.length === 0) {
    fail("wakeflow-legacy-classifier-catalog-shape", errorPath, "array must not be empty");
  }
  const sorted = [...entries].sort(compareText);
  if (canonicalJson(entries) !== canonicalJson(sorted) || new Set(entries).size !== entries.length) {
    fail("wakeflow-legacy-classifier-catalog-order", errorPath, "array must be unique and lexically sorted");
  }
  return entries;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function decodeCanonicalBase64(value, errorPath) {
  if (typeof value !== "string" || !value) {
    fail("wakeflow-legacy-classifier-catalog-shape", errorPath, "expected non-empty base64 content");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    fail("wakeflow-legacy-classifier-catalog-shape", errorPath, "content template must use canonical base64");
  }
  try {
    UTF8_DECODER.decode(bytes);
  } catch {
    fail("wakeflow-legacy-classifier-catalog-shape", errorPath, "content template must be valid UTF-8");
  }
  return bytes;
}

function canonicalRelativePath(value, errorPath, { template = false } = {}) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || value.normalize("NFC") !== value
    || CONTROL_PATTERN.test(value)
    || value.includes("\\")
    || Buffer.byteLength(value, "utf8") > MAX_RELATIVE_PATH_BYTES
  ) {
    fail("wakeflow-legacy-classifier-path", errorPath, "expected a canonical portable relative path", { value });
  }
  const withoutMarkers = template ? value.replace(SLOT_MARKER_PATTERN, "slot") : value;
  if (
    path.posix.isAbsolute(withoutMarkers)
    || path.win32.isAbsolute(withoutMarkers)
    || path.posix.normalize(withoutMarkers) !== withoutMarkers
    || withoutMarkers.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    fail("wakeflow-legacy-classifier-path", errorPath, "path escapes or is not canonical", { value });
  }
  return value;
}

function validateCatalogSlot(value, errorPath) {
  const slot = exactObject(value, SLOT_FIELDS, errorPath, "wakeflow-legacy-classifier-catalog-shape");
  if (typeof slot.id !== "string" || !/^[a-z0-9][a-z0-9._-]*$/u.test(slot.id)) {
    fail("wakeflow-legacy-classifier-catalog-shape", `${errorPath}/id`, "slot id is invalid");
  }
  if (!SLOT_TYPES.includes(slot.type)) {
    fail("wakeflow-legacy-classifier-catalog-shape", `${errorPath}/type`, "slot type is unsupported", { value: slot.type });
  }
  if (!SLOT_SENSITIVITY.includes(slot.sensitivity)) {
    fail("wakeflow-legacy-classifier-catalog-shape", `${errorPath}/sensitivity`, "slot sensitivity is unsupported", { value: slot.sensitivity });
  }
  const expected = `@wakeflow-classifier-slot[${slot.type}|${slot.sensitivity}|${slot.id}]@`;
  if (slot.marker !== expected) {
    fail("wakeflow-legacy-classifier-catalog-shape", `${errorPath}/marker`, "slot marker does not match its typed identity");
  }
  return slot;
}

function markersIn(value) {
  return [...value.matchAll(SLOT_MARKER_PATTERN)].map((match) => match[0]);
}

function validateCatalogEntry(value, index) {
  const errorPath = `$/entries/${index}`;
  const entry = exactObject(value, ENTRY_FIELDS, errorPath, "wakeflow-legacy-classifier-catalog-shape");
  if (typeof entry.entryId !== "string" || !/^legacy-template-[a-f0-9]{20}$/u.test(entry.entryId)) {
    fail("wakeflow-legacy-classifier-catalog-shape", `${errorPath}/entryId`, "entry id is invalid");
  }
  if (!SURFACE_KINDS.includes(entry.surfaceKind)) {
    fail("wakeflow-legacy-classifier-catalog-shape", `${errorPath}/surfaceKind`, "surface kind is unsupported");
  }
  canonicalRelativePath(entry.pathTemplate, `${errorPath}/pathTemplate`, { template: true });
  if (!CLASSIFIER_MODES.includes(entry.classifierMode)) {
    fail("wakeflow-legacy-classifier-catalog-shape", `${errorPath}/classifierMode`, "classifier mode is unsupported");
  }
  if (!FORMATS.includes(entry.format)) {
    fail("wakeflow-legacy-classifier-catalog-shape", `${errorPath}/format`, "format is unsupported");
  }
  const artifact = exactObject(entry.artifact, ARTIFACT_FIELDS, `${errorPath}/artifact`, "wakeflow-legacy-classifier-catalog-shape");
  if (typeof artifact.kind !== "string" || !artifact.kind || artifact.kind !== artifact.kind.trim()) {
    fail("wakeflow-legacy-classifier-catalog-shape", `${errorPath}/artifact/kind`, "artifact kind is invalid");
  }
  if (artifact.schema !== null && (typeof artifact.schema !== "string" || !artifact.schema)) {
    fail("wakeflow-legacy-classifier-catalog-shape", `${errorPath}/artifact/schema`, "artifact schema is invalid");
  }
  if (!SHA256_PATTERN.test(entry.canonicalClassifierDigest)) {
    fail("wakeflow-legacy-classifier-catalog-shape", `${errorPath}/canonicalClassifierDigest`, "canonical classifier digest is invalid");
  }
  if (!DISPOSITION_POLICIES.has(entry.dispositionPolicy)) {
    fail("wakeflow-legacy-classifier-catalog-shape", `${errorPath}/dispositionPolicy`, "disposition policy is unsupported");
  }
  const origins = lexicalStrings(entry.originCandidates, `${errorPath}/originCandidates`, { allowEmpty: false });
  const routes = lexicalStrings(entry.producerRoutes, `${errorPath}/producerRoutes`, { allowEmpty: false });
  const rawFixtureDigests = lexicalStrings(entry.rawFixtureDigests, `${errorPath}/rawFixtureDigests`, {
    allowEmpty: entry.classifierMode === "config-schema",
    pattern: SHA256_PATTERN,
  });
  const rootFamilies = lexicalStrings(entry.rootFamilies, `${errorPath}/rootFamilies`, { allowEmpty: false });
  if (rootFamilies.some((family) => !ROOT_FAMILIES.includes(family))) {
    fail("wakeflow-legacy-classifier-catalog-shape", `${errorPath}/rootFamilies`, "root family is unsupported");
  }
  const slots = denseArray(entry.slots, `${errorPath}/slots`, "wakeflow-legacy-classifier-catalog-shape")
    .map((slot, slotIndex) => validateCatalogSlot(slot, `${errorPath}/slots/${slotIndex}`));
  const slotIds = slots.map(({ id }) => id);
  if (new Set(slotIds).size !== slotIds.length || canonicalJson(slotIds) !== canonicalJson([...slotIds].sort(compareText))) {
    fail("wakeflow-legacy-classifier-catalog-order", `${errorPath}/slots`, "slots must have unique lexical ids");
  }
  let templateText = "";
  if (entry.classifierMode === "config-schema") {
    if (entry.contentTemplateBase64 !== null || rawFixtureDigests.length !== 0) {
      fail("wakeflow-legacy-classifier-catalog-shape", `${errorPath}/contentTemplateBase64`, "config schema entries cannot carry fixture content");
    }
  } else {
    const bytes = decodeCanonicalBase64(entry.contentTemplateBase64, `${errorPath}/contentTemplateBase64`);
    templateText = UTF8_DECODER.decode(bytes);
  }
  const expectedFormat = MODE_FORMATS.get(entry.classifierMode);
  if (expectedFormat !== undefined && entry.format !== expectedFormat) {
    fail("wakeflow-legacy-classifier-catalog-shape", `${errorPath}/format`, "classifier mode and format disagree");
  }
  if (entry.format === "json" && entry.classifierMode !== "config-schema") {
    let parsedTemplate;
    try {
      parsedTemplate = JSON.parse(templateText);
    } catch {
      fail("wakeflow-legacy-classifier-catalog-shape", `${errorPath}/contentTemplateBase64`, "JSON template is invalid");
    }
    if (entry.classifierMode === "claude-settings-components" && !isPlainObject(parsedTemplate)) {
      fail("wakeflow-legacy-classifier-catalog-shape", `${errorPath}/contentTemplateBase64`, "Claude settings template must be one object");
    }
  }
  if (entry.format === "jsonl") {
    try {
      const lines = templateText.trimEnd().split("\n");
      if (lines.length === 0 || lines.some((line) => !line)) throw new Error("empty-jsonl-line");
      lines.forEach((line) => JSON.parse(line));
    } catch {
      fail("wakeflow-legacy-classifier-catalog-shape", `${errorPath}/contentTemplateBase64`, "JSONL template is invalid");
    }
  }
  const usedMarkers = new Set([...markersIn(entry.pathTemplate), ...markersIn(templateText)]);
  const declaredMarkers = new Set(slots.map(({ marker }) => marker));
  if (canonicalJson([...usedMarkers].sort(compareText)) !== canonicalJson([...declaredMarkers].sort(compareText))) {
    fail("wakeflow-legacy-classifier-catalog-shape", `${errorPath}/slots`, "declared slots must exactly cover template markers");
  }
  const withoutValidMarkers = `${entry.pathTemplate}\n${templateText}`.replace(SLOT_MARKER_PATTERN, "");
  if (withoutValidMarkers.includes(RESERVED_SLOT_PREFIX)) {
    fail("wakeflow-legacy-classifier-catalog-shape", `${errorPath}/slots`, "malformed reserved slot marker is not allowed");
  }
  const normalized = {
    ...entry,
    artifact,
    originCandidates: origins,
    producerRoutes: routes,
    rawFixtureDigests,
    rootFamilies,
    slots,
  };
  const expectedClassifierDigest = canonicalJsonDigest({
    artifact: normalized.artifact,
    classifierMode: normalized.classifierMode,
    contentTemplateBase64: normalized.contentTemplateBase64,
    dispositionPolicy: normalized.dispositionPolicy,
    format: normalized.format,
    pathTemplate: normalized.pathTemplate,
    slots: normalized.slots,
    surfaceKind: normalized.surfaceKind,
  });
  if (
    normalized.canonicalClassifierDigest !== expectedClassifierDigest
    || normalized.entryId !== `legacy-template-${expectedClassifierDigest.slice(7, 27)}`
  ) {
    fail("wakeflow-legacy-classifier-catalog-digest", `${errorPath}/canonicalClassifierDigest`, "entry digest or identity does not match its semantic payload", {
      actual: normalized.canonicalClassifierDigest,
      expected: expectedClassifierDigest,
    });
  }
  return normalized;
}

/** 校验 catalog 的闭合 shape、逐 entry 语义 digest、总 digest、排序和深冻结合同。 */
export function validateWakeflowLegacyClassifierCatalog(value) {
  const catalog = exactObject(value, CATALOG_FIELDS, "$", "wakeflow-legacy-classifier-catalog-shape");
  if (catalog.artifactKind !== WAKEFLOW_LEGACY_CLASSIFIER_CATALOG_KIND) {
    fail("wakeflow-legacy-classifier-catalog-shape", "$/artifactKind", "catalog kind is unsupported");
  }
  if (catalog.schemaVersion !== WAKEFLOW_LEGACY_CLASSIFIER_CATALOG_VERSION) {
    fail("wakeflow-legacy-classifier-catalog-shape", "$/schemaVersion", "catalog version is unsupported");
  }
  if (!SHA256_PATTERN.test(catalog.catalogDigest)) {
    fail("wakeflow-legacy-classifier-catalog-shape", "$/catalogDigest", "catalog digest is invalid");
  }
  const coverage = exactObject(catalog.coverage, COVERAGE_FIELDS, "$/coverage", "wakeflow-legacy-classifier-catalog-shape");
  for (const field of COVERAGE_FIELDS) {
    if (!Number.isSafeInteger(coverage[field]) || coverage[field] < 0) {
      fail("wakeflow-legacy-classifier-catalog-shape", `$/coverage/${field}`, "coverage value must be a non-negative safe integer");
    }
  }
  const entries = denseArray(catalog.entries, "$/entries", "wakeflow-legacy-classifier-catalog-shape")
    .map(validateCatalogEntry);
  if (coverage.templateCount !== entries.length) {
    fail("wakeflow-legacy-classifier-catalog-coverage", "$/coverage/templateCount", "template count does not match entries");
  }
  const entryIds = entries.map(({ entryId }) => entryId);
  if (new Set(entryIds).size !== entryIds.length || canonicalJson(entryIds) !== canonicalJson([...entryIds].sort(compareText))) {
    fail("wakeflow-legacy-classifier-catalog-order", "$/entries", "entries must have unique lexical ids");
  }
  const normalized = {
    artifactKind: catalog.artifactKind,
    catalogDigest: catalog.catalogDigest,
    coverage,
    entries,
    schemaVersion: catalog.schemaVersion,
  };
  const expectedDigest = canonicalJsonDigest({
    artifactKind: normalized.artifactKind,
    coverage: normalized.coverage,
    entries: normalized.entries,
    schemaVersion: normalized.schemaVersion,
  });
  if (expectedDigest !== normalized.catalogDigest) {
    fail("wakeflow-legacy-classifier-catalog-digest", "$/catalogDigest", "catalog digest does not match its canonical payload", {
      actual: normalized.catalogDigest,
      expected: expectedDigest,
    });
  }
  return deepFreeze(normalized);
}

function catalogStatIdentity(stat) {
  return [
    stat.dev,
    stat.ino,
    stat.mode,
    stat.nlink,
    stat.size,
    stat.mtimeNs,
    stat.ctimeNs,
  ].join(":");
}

function readPackagedCatalogBytes() {
  let descriptor = null;
  try {
    descriptor = fs.openSync(
      CATALOG_FILE,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    );
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) {
      fail("wakeflow-legacy-classifier-catalog-file", "$/catalog", "packaged classifier catalog must be one regular file");
    }
    if (before.size > BigInt(MAX_CATALOG_BYTES)) {
      fail("wakeflow-legacy-classifier-catalog-limit", "$/catalog", "packaged classifier catalog exceeds its byte bound", {
        actual: before.size.toString(),
        limit: MAX_CATALOG_BYTES,
      });
    }
    const expectedBytes = Number(before.size);
    const captured = Buffer.alloc(expectedBytes + 1);
    let offset = 0;
    while (offset < captured.length) {
      const count = fs.readSync(descriptor, captured, offset, captured.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (
      offset !== expectedBytes
      || catalogStatIdentity(before) !== catalogStatIdentity(after)
    ) {
      fail("wakeflow-legacy-classifier-catalog-stale", "$/catalog", "packaged classifier catalog changed during its bounded read");
    }
    return captured.subarray(0, expectedBytes);
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

/** 读取并缓存随插件发行的 classifier catalog；只接受稳定、regular、no-follow、4 MiB 内的 exact bytes。 */
export function readWakeflowLegacyClassifierCatalog() {
  if (cachedCatalog) return cachedCatalog;
  let parsed;
  try {
    parsed = JSON.parse(UTF8_DECODER.decode(readPackagedCatalogBytes()));
  } catch (error) {
    fail("wakeflow-legacy-classifier-catalog-read", "$/catalog", "packaged classifier catalog is missing or invalid", {
      causeCode: error?.code ?? "invalid-json",
    });
  }
  cachedCatalog = validateWakeflowLegacyClassifierCatalog(parsed);
  return cachedCatalog;
}

function validateInput(input) {
  const value = exactObject(input, INPUT_FIELDS, "$", "wakeflow-legacy-classifier-input-shape");
  if (!SURFACE_KINDS.includes(value.surfaceKind)) {
    fail("wakeflow-legacy-classifier-input", "$/surfaceKind", "surface kind is unsupported", { value: value.surfaceKind });
  }
  if (!OWNERSHIP_KINDS.includes(value.ownership)) {
    fail("wakeflow-legacy-classifier-input", "$/ownership", "ownership is unsupported", { value: value.ownership });
  }
  if (![true, false, "unknown"].includes(value.gitIgnoreRoot)) {
    fail("wakeflow-legacy-classifier-input", "$/gitIgnoreRoot", "gitIgnoreRoot must be true, false, or unknown");
  }
  canonicalRelativePath(value.relativePath, "$/relativePath");
  let bytes;
  if (typeof value.sourceBytes === "string") {
    const byteLength = Buffer.byteLength(value.sourceBytes, "utf8");
    if (byteLength > MAX_SOURCE_BYTES) {
      fail("wakeflow-legacy-classifier-input", "$/sourceBytes", "source exceeds classifier byte bound", {
        actual: byteLength,
        limit: MAX_SOURCE_BYTES,
      });
    }
    bytes = Buffer.from(value.sourceBytes, "utf8");
  } else if (Buffer.isBuffer(value.sourceBytes) || value.sourceBytes instanceof Uint8Array) {
    bytes = Buffer.from(value.sourceBytes);
  } else {
    fail("wakeflow-legacy-classifier-input", "$/sourceBytes", "sourceBytes must be a string or byte array");
  }
  if (bytes.length > MAX_SOURCE_BYTES) {
    fail("wakeflow-legacy-classifier-input", "$/sourceBytes", "source exceeds classifier byte bound", {
      actual: bytes.length,
      limit: MAX_SOURCE_BYTES,
    });
  }
  return { ...value, sourceBytes: bytes };
}

function outputArtifact(kind = "unknown", schema = null, format = "text") {
  return exactObject({ kind, schema, format }, OUTPUT_ARTIFACT_FIELDS, "$/artifact", "wakeflow-legacy-classifier-output");
}

function disposition(action, route, prerequisites = [], releaseGates = []) {
  return deepFreeze(exactObject({ action, route, prerequisites, releaseGates }, DISPOSITION_FIELDS, "$/defaultDisposition", "wakeflow-legacy-classifier-output"));
}

function manualDisposition(route = "manual-owner-choice") {
  return disposition("manual", route, [], []);
}

function unknownResult({ input, rawDigest, blockerCodes, format = "text", origins = [], routes = [] }) {
  return deepFreeze({
    artifact: outputArtifact("unknown", null, format),
    blockerCodes: [...new Set(blockerCodes)].sort(compareText),
    canonicalClassifierDigest: null,
    components: [],
    confidence: "unknown",
    defaultDisposition: manualDisposition(),
    lifecycleConclusion: "unresolved",
    originCandidates: [...new Set(origins)].sort(compareText),
    producerRoutes: [...new Set(routes)].sort(compareText),
    rawDigest,
    source: {
      bytes: input.sourceBytes.length,
      relativePath: input.relativePath,
      surfaceKind: input.surfaceKind,
    },
    typedSlots: [],
  });
}

function inferFormat(relativePath) {
  if (relativePath.endsWith(".json")) return "json";
  if (relativePath.endsWith(".jsonl")) return "jsonl";
  if (relativePath.endsWith(".md")) return "markdown";
  if (relativePath.endsWith(".mjs")) return "javascript";
  if (path.posix.basename(relativePath) === ".gitignore") return "gitignore";
  return "text";
}

// ==================== 二、typed template 与隐私槽匹配 ====================

function regexEscape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function validatorPattern(type) {
  switch (type) {
    case "absolute-path":
      return "(?:@wakeflow-(?:fixture|scenario)-[^\\r\\n\"]+|(?:/|[A-Za-z]:[\\\\/])[^\\r\\n\"]+)";
    case "iso-time":
      return "(?:@wakeflow-(?:fixture|scenario)-[^\\r\\n\"]+|[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{3})?Z)";
    case "digest":
      return "(?:@wakeflow-(?:fixture|scenario)-[^\\r\\n\"]+|(?:sha256:)?[a-f0-9]{64})";
    case "process-id":
      return "(?:@wakeflow-(?:fixture|scenario)-[^\\r\\n\"]+|[1-9][0-9]*)";
    case "window-name":
    case "workspace-name":
    case "repository-name":
      return "[^/\\\\\\r\\n\"]+";
    case "relative-path":
      return "[^\\r\\n\"]+";
    case "artifact-id":
    case "host-handle":
    case "secret-token":
      return "[^\\s/\\\\\"]+";
    default:
      return "[^\\r\\n\"]+";
  }
}

function fixtureSlotToken(value) {
  return /^@wakeflow-(?:fixture|scenario)-[A-Za-z0-9._/-]+$/u.test(value);
}

function canonicalAbsolutePath(value) {
  if (path.posix.isAbsolute(value)) return path.posix.normalize(value) === value;
  if (!path.win32.isAbsolute(value)) return false;
  return path.win32.normalize(value).replaceAll("\\", "/") === value.replaceAll("\\", "/");
}

function validTimestamp(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/u.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
}

function validSlotCapture(slot, value) {
  if (
    typeof value !== "string"
    || !value
    || value.normalize("NFC") !== value
    || CONTROL_PATTERN.test(value)
    || Buffer.byteLength(value, "utf8") > MAX_RELATIVE_PATH_BYTES
  ) return false;
  if (fixtureSlotToken(value)) return true;
  switch (slot.type) {
    case "absolute-path":
      return canonicalAbsolutePath(value);
    case "iso-time":
      return validTimestamp(value);
    case "digest":
      return /^(?:sha256:)?[a-f0-9]{64}$/u.test(value);
    case "process-id":
      return /^[1-9][0-9]*$/u.test(value) && Number.isSafeInteger(Number(value));
    case "relative-path":
      return !path.posix.isAbsolute(value)
        && !path.win32.isAbsolute(value)
        && !value.includes("\\")
        && path.posix.normalize(value) === value
        && value.split("/").every((segment) => segment && segment !== "." && segment !== "..");
    case "window-name":
    case "workspace-name":
    case "repository-name":
      return value === value.trim() && !value.includes("/") && !value.includes("\\");
    case "artifact-id":
    case "host-handle":
    case "secret-token":
      return !/[\s/\\"]/u.test(value);
    default:
      return false;
  }
}

function compileTemplateExpression(template, slots) {
  const slotByMarker = new Map(slots.map((slot) => [slot.marker, slot]));
  const seen = new Map();
  let expression = "^";
  let cursor = 0;
  for (const match of template.matchAll(SLOT_MARKER_PATTERN)) {
    expression += regexEscape(template.slice(cursor, match.index));
    const marker = match[0];
    const slot = slotByMarker.get(marker);
    if (!slot) return null;
    if (seen.has(marker)) {
      expression += `\\k<${seen.get(marker)}>`;
    } else {
      const group = `s${seen.size}`;
      seen.set(marker, group);
      expression += `(?<${group}>${validatorPattern(slot.type)})`;
    }
    cursor = match.index + marker.length;
  }
  expression += regexEscape(template.slice(cursor));
  expression += "$";
  return { expression: new RegExp(expression, "u"), groups: [...seen.entries()] };
}

function mergeSlotCapture(captures, marker, value) {
  const current = captures.get(marker);
  if (current !== undefined && current !== value) return false;
  captures.set(marker, value);
  return true;
}

function matchStringTemplate(template, actual, slots, captures) {
  if (typeof actual !== "string" && typeof actual !== "number") return false;
  if (!template.includes("@wakeflow-classifier-slot[")) return actual === template;
  const compiled = compileTemplateExpression(template, slots);
  if (!compiled) return false;
  const match = compiled.expression.exec(String(actual));
  if (!match) return false;
  const slotsByMarker = new Map(slots.map((slot) => [slot.marker, slot]));
  for (const [marker, group] of compiled.groups) {
    const captured = match.groups[group];
    if (!validSlotCapture(slotsByMarker.get(marker), captured)) return false;
    if (!mergeSlotCapture(captures, marker, captured)) return false;
  }
  return true;
}

function matchJsonTemplate(template, actual, slots, captures) {
  if (typeof template === "string") return matchStringTemplate(template, actual, slots, captures);
  if (template === null || typeof template !== "object") return Object.is(template, actual);
  if (Array.isArray(template)) {
    if (!Array.isArray(actual) || actual.length !== template.length) return false;
    return template.every((item, index) => matchJsonTemplate(item, actual[index], slots, captures));
  }
  if (!isPlainObject(actual)) return false;
  const templateKeys = Object.keys(template).sort(compareText);
  const actualKeys = Object.keys(actual).sort(compareText);
  if (canonicalJson(templateKeys) !== canonicalJson(actualKeys)) return false;
  return templateKeys.every((key) => matchJsonTemplate(template[key], actual[key], slots, captures));
}

function templateText(entry) {
  return UTF8_DECODER.decode(Buffer.from(entry.contentTemplateBase64, "base64"));
}

function matchEntryPath(entry, relativePath) {
  const captures = new Map();
  if (!matchStringTemplate(entry.pathTemplate, relativePath, entry.slots, captures)) return null;
  return captures;
}

function matchWholeEntry(entry, text, pathCaptures) {
  const captures = new Map(pathCaptures);
  const template = templateText(entry);
  try {
    if (entry.format === "json") {
      return matchJsonTemplate(JSON.parse(template), JSON.parse(text), entry.slots, captures) ? captures : null;
    }
    if (entry.format === "jsonl") {
      const expected = template.trimEnd().split("\n").map((line) => JSON.parse(line));
      const actual = text.trimEnd().split("\n").map((line) => JSON.parse(line));
      return matchJsonTemplate(expected, actual, entry.slots, captures) ? captures : null;
    }
  } catch {
    return null;
  }
  return matchStringTemplate(template, text, entry.slots, captures) ? captures : null;
}

function slotOutput(slots, captures) {
  return slots
    .filter(({ marker }) => captures.has(marker))
    .map((slot) => ({
      id: slot.id,
      sensitivity: slot.sensitivity,
      type: slot.type,
      valueDigest: sha256(Buffer.from(captures.get(slot.marker), "utf8")),
    }))
    .sort((left, right) => compareText(left.id, right.id));
}

function union(values) {
  return [...new Set(values.flat())].sort(compareText);
}

function allOldRoot(entries, relativePath) {
  return relativePath.startsWith(".workspace-active/")
    || relativePath.startsWith(".workspace-local/")
    || (entries.length > 0 && entries.every((entry) => entry.rootFamilies.every((family) => family === "old-root-flat")));
}

// ==================== 三、D39 disposition 与 strict legacy config ====================

// disposition 只是后续 plan 的候选路线；这里不证明 owner、引用、target 或 release gate 已满足。
function resolveDisposition(policy, input, { oldRoot = false } = {}) {
  if (oldRoot || policy === "old-root") {
    return {
      blockerCodes: ["legacy-old-root-unsupported"],
      disposition: manualDisposition(),
    };
  }
  switch (policy) {
    case "tracked-config":
      return { blockerCodes: [], disposition: disposition("transform", "schema-map", ["config-source-set-correlation"], ["v3-config-readback", "legacy-reader-detached"]) };
    case "local-derived-config":
      return { blockerCodes: [], disposition: disposition("remove", "remove-exact", ["legacy-owner-drain", "local-overlay-reader-detached"], ["exact-source-cas"]) };
    case "mixed-memory":
      return { blockerCodes: [], disposition: disposition("transform", "managed-merge", ["component-owner-validation"], ["managed-component-readback"]) };
    case "mixed-claude-settings":
      return { blockerCodes: [], disposition: disposition("transform", "managed-merge", ["claude-settings-owner-validation"], ["settings-readback", "managed-reference-closure"]) };
    case "mixed-gitignore":
      if (input.gitIgnoreRoot === "unknown") {
        return { blockerCodes: ["legacy-git-root-classification-required"], disposition: manualDisposition() };
      }
      return input.gitIgnoreRoot
        ? { blockerCodes: [], disposition: disposition("transform", "managed-merge", ["git-ignore-root-validation"], ["ignore-readback"]) }
        : { blockerCodes: [], disposition: disposition("remove", "remove-exact", ["component-owner-validation"], ["exact-source-cas"]) };
    case "support-scaffold":
      if (input.ownership === "wakeflow-managed") {
        return { blockerCodes: [], disposition: disposition("remove", "remove-exact", ["target-support-capability-ready"], ["exact-source-cas", "legacy-reference-closure"]) };
      }
      if (input.ownership === "owner-managed") {
        return { blockerCodes: [], disposition: disposition("keep", "external-owner-handoff", ["legacy-runtime-reference-closure"], []) };
      }
      return { blockerCodes: ["legacy-support-ownership-required"], disposition: manualDisposition() };
    case "support-memory":
      if (input.ownership === "wakeflow-managed" || input.ownership === "managed-block") {
        return { blockerCodes: [], disposition: disposition("transform", "managed-merge", ["component-owner-validation"], ["managed-component-readback"]) };
      }
      return { blockerCodes: ["legacy-support-memory-owner-required"], disposition: manualDisposition() };
    case "active-derived":
    case "ledger-derived":
      return { blockerCodes: [], disposition: disposition("transform", "rebuild-derived", ["target-authority-committed"], ["projection-readback"]) };
    case "active-todo":
      return { blockerCodes: [], disposition: disposition("transform", "schema-map", ["todo-row-validation"], ["typed-todo-readback", "legacy-reference-closure"]) };
    case "active-test-exchange":
      return { blockerCodes: [], disposition: disposition("remove", "remove-exact", ["test-content-classification"], ["test-record-closure", "exact-source-cas"]) };
    case "active-demand":
      return { blockerCodes: ["legacy-domain-correlation-required"], disposition: disposition("transform", "archive-wrap", ["legacy-owner-drain", "domain-chain-correlation"], ["archive-wrapper-published", "legacy-reference-closure"]) };
    case "pending-merge":
      return { blockerCodes: ["legacy-owner-drain-required"], disposition: disposition("transform", "schema-map", ["legacy-owner-drain", "branch-resource-correlation"], ["typed-workspace-record-readback", "legacy-reference-closure"]) };
    case "legacy-starter":
    case "local-readme":
      return { blockerCodes: [], disposition: disposition("remove", "remove-exact", ["replacement-orientation-ready"], ["exact-source-cas", "legacy-reference-closure"]) };
    case "transport-chain":
      return { blockerCodes: ["legacy-domain-correlation-required"], disposition: disposition("transform", "archive-wrap", ["legacy-owner-drain", "domain-chain-correlation"], ["archive-wrapper-published", "transport-reference-closure"]) };
    case "local-result":
      return { blockerCodes: ["legacy-domain-correlation-required"], disposition: disposition("transform", "schema-map", ["legacy-owner-drain", "result-authority-correlation"], ["state-root-result-readback", "result-reference-closure"]) };
    case "lease":
    case "keep-live":
      return { blockerCodes: ["legacy-owner-drain-required"], disposition: disposition("remove", "remove-exact", ["legacy-owner-drain", "process-identity-proof"], ["exact-source-cas", "resource-reference-closure"]) };
    case "next-work-cache":
    case "stop-marker":
      return { blockerCodes: [], disposition: disposition("remove", "remove-exact", ["legacy-writer-retired"], ["exact-source-cas", "legacy-reference-closure"]) };
    case "worktree":
      return { blockerCodes: ["legacy-worktree-owner-required"], disposition: manualDisposition() };
    case "preservation":
      return { blockerCodes: ["legacy-domain-correlation-required"], disposition: disposition("transform", "audit-preserve", ["inactive-source-proof", "preservation-manifest-validation"], ["strict-preservation-published", "exact-source-cas"]) };
    case "pod-reservation":
      return { blockerCodes: ["legacy-domain-correlation-required"], disposition: disposition("remove", "remove-exact", ["pod-resource-correlation", "legacy-writer-retired"], ["canonical-state-closure", "resource-reference-closure", "exact-source-cas"]) };
    case "pod-aggregate":
      return { blockerCodes: ["legacy-domain-correlation-required"], disposition: disposition("transform", "archive-wrap", ["legacy-owner-drain", "pod-source-set-correlation"], ["archive-wrapper-published", "pod-reference-closure"]) };
    case "thread-registry":
      return { blockerCodes: ["legacy-host-decommission-required"], disposition: disposition("remove", "remove-exact", ["host-decommission", "routing-reference-closure"], ["exact-source-cas"]) };
    case "window-config":
      return { blockerCodes: ["legacy-host-decommission-required"], disposition: disposition("remove", "remove-exact", ["host-decommission", "window-runtime-projector-ready"], ["window-runtime-readback", "exact-source-cas"]) };
    case "claude-window-host":
      return { blockerCodes: ["legacy-host-decommission-required", "legacy-domain-correlation-required"], disposition: manualDisposition("manual-host-proof") };
    case "statusline-asset":
      return { blockerCodes: [], disposition: disposition("transform", "rebuild-derived", ["managed-settings-reference-plan"], ["new-asset-readback", "legacy-reference-closure"]) };
    case "claude-runtime":
      return { blockerCodes: ["legacy-host-decommission-required"], disposition: disposition("remove", "remove-exact", ["host-decommission", "process-identity-proof"], ["exact-source-cas", "host-reference-closure"]) };
    default:
      return { blockerCodes: ["legacy-disposition-policy-unknown"], disposition: manualDisposition() };
  }
}

function strictKeys(value, allowed, errorPath, issues) {
  if (!isPlainObject(value)) {
    issues.push({ code: "legacy-config-invalid-type", path: errorPath });
    return false;
  }
  const unknown = Object.keys(value).filter((key) => !allowed.has(key)).sort(compareText);
  if (unknown.length > 0) issues.push({ code: "legacy-config-unknown-field", path: errorPath, fields: unknown });
  return unknown.length === 0;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function stringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function validateRoleMap(value, errorPath, issues) {
  if (!strictKeys(value, ROLE_MAP_FIELDS, errorPath, issues)) return;
  for (const [key, item] of Object.entries(value)) {
    if (!nonEmptyString(item)) issues.push({ code: "legacy-config-invalid-type", path: `${errorPath}/${key}` });
  }
}

function validateHosts(value, errorPath, issues) {
  if (!strictKeys(value, new Set(["claude-code", "codex"]), errorPath, issues)) return;
  for (const [host, hostValue] of Object.entries(value)) {
    const allowed = host === "codex" ? CODEX_HOST_FIELDS : CLAUDE_HOST_FIELDS;
    if (!strictKeys(hostValue, allowed, `${errorPath}/${host}`, issues)) continue;
    for (const [key, item] of Object.entries(hostValue)) {
      if (["modelByRole", "thinkingByRole", "effortByRole"].includes(key)) {
        validateRoleMap(item, `${errorPath}/${host}/${key}`, issues);
      } else if (key === "claudeArgs") {
        if (!stringArray(item)) issues.push({ code: "legacy-config-invalid-type", path: `${errorPath}/${host}/${key}` });
      } else if (key === "maxStreamsPerRepo") {
        if (!Number.isSafeInteger(item) || item <= 0) issues.push({ code: "legacy-config-invalid-type", path: `${errorPath}/${host}/${key}` });
      } else if (!nonEmptyString(item)) {
        issues.push({ code: "legacy-config-invalid-type", path: `${errorPath}/${host}/${key}` });
      }
    }
  }
}

function validateRepositories(value, errorPath, issues, { allowStream }) {
  if (!Array.isArray(value)) {
    issues.push({ code: "legacy-config-invalid-type", path: errorPath });
    return;
  }
  value.forEach((repository, index) => {
    const at = `${errorPath}/${index}`;
    if (!strictKeys(repository, REPOSITORY_FIELDS, at, issues)) return;
    if (!nonEmptyString(repository.windowName) || !nonEmptyString(repository.path)) {
      issues.push({ code: "legacy-config-invalid-type", path: at });
    }
    if (repository.role !== undefined && typeof repository.role !== "string") issues.push({ code: "legacy-config-invalid-type", path: `${at}/role` });
    if (repository.mode !== undefined && !["internal", "external"].includes(repository.mode)) issues.push({ code: "legacy-config-invalid-type", path: `${at}/mode` });
    if (repository.managedAgents !== undefined && typeof repository.managedAgents !== "boolean") issues.push({ code: "legacy-config-invalid-type", path: `${at}/managedAgents` });
    for (const field of ["maxStreams", "maxStreamsPerRepo"]) {
      if (repository[field] !== undefined && (!Number.isSafeInteger(repository[field]) || repository[field] <= 0)) {
        issues.push({ code: "legacy-config-invalid-type", path: `${at}/${field}` });
      }
    }
    if (repository.stream !== undefined) {
      if (!allowStream || !strictKeys(repository.stream, STREAM_FIELDS, `${at}/stream`, issues)) {
        if (!allowStream) issues.push({ code: "legacy-config-stream-outside-overlay", path: `${at}/stream` });
      } else {
        for (const [key, item] of Object.entries(repository.stream)) {
          if (
            !nonEmptyString(item)
            || (key === "openedAt" && !fixtureSlotToken(item) && !validTimestamp(item))
          ) issues.push({ code: "legacy-config-invalid-type", path: `${at}/stream/${key}` });
        }
      }
    }
  });
}

function validateDerived(value, errorPath, issues) {
  if (!strictKeys(value, DERIVED_FIELDS, errorPath, issues)) return false;
  if (value.kind !== "WakeflowLocalConfigOverlay" || value.version !== 1) {
    issues.push({ code: "legacy-local-config-unmanaged", path: errorPath });
  }
  if (!nonEmptyString(value.from) || typeof value.baseHash !== "string" || !/^[a-f0-9]{64}$/u.test(value.baseHash)) {
    issues.push({ code: "legacy-config-invalid-type", path: errorPath });
  }
  if (
    !nonEmptyString(value.generatedAt)
    || (!fixtureSlotToken(value.generatedAt) && !validTimestamp(value.generatedAt))
    || !stringArray(value.streamWindows)
  ) {
    issues.push({ code: "legacy-config-invalid-type", path: errorPath });
  }
  return issues.length === 0;
}

function validateNestedConfig(value, issues, { local }) {
  strictKeys(value, NESTED_CONFIG_FIELDS, "$", issues);
  if (value.$schema !== undefined && !nonEmptyString(value.$schema)) {
    issues.push({ code: "legacy-config-invalid-type", path: "$/$schema" });
  }
  for (const field of ["workspace", "roles", "storage", "repositories", "hosts"]) {
    if (value[field] === undefined) issues.push({ code: "legacy-config-missing-field", path: `$/ ${field}`.replace("/ ", "/") });
  }
  if (value.schemaVersion !== 2) issues.push({ code: "legacy-config-invalid-type", path: "$/schemaVersion" });
  if (strictKeys(value.workspace, WORKSPACE_FIELDS, "$/workspace", issues)) {
    for (const field of ["name", "language", "runtimeMode", "root", "wakeflowRepoDir"]) {
      if (!nonEmptyString(value.workspace[field]) && !(field === "wakeflowRepoDir" && value.workspace[field] === "")) {
        issues.push({ code: "legacy-config-invalid-type", path: `$/workspace/${field}` });
      }
    }
    if (!["auto", "en", "zh"].includes(value.workspace.language)) issues.push({ code: "legacy-config-invalid-type", path: "$/workspace/language" });
    if (!["plugin", "repository"].includes(value.workspace.runtimeMode)) issues.push({ code: "legacy-config-invalid-type", path: "$/workspace/runtimeMode" });
  }
  if (strictKeys(value.roles, ROLE_FIELDS, "$/roles", issues)) {
    for (const field of ["controller", "design", "test"]) if (!nonEmptyString(value.roles[field])) issues.push({ code: "legacy-config-invalid-type", path: `$/roles/${field}` });
    for (const field of ["base", "realProject"]) {
      if (value.roles[field] !== undefined && typeof value.roles[field] !== "string") {
        issues.push({ code: "legacy-config-invalid-type", path: `$/roles/${field}` });
      }
    }
  }
  if (strictKeys(value.storage, STORAGE_FIELDS, "$/storage", issues)) {
    if (!nonEmptyString(value.storage.activeRoot) || value.storage.localRoot !== ".wakeflow-local" || !nonEmptyString(value.storage.ledgerRoot)) {
      issues.push({ code: "legacy-config-invalid-type", path: "$/storage" });
    }
    if (value.storage.windowLedgerRoot !== undefined && !nonEmptyString(value.storage.windowLedgerRoot)) {
      issues.push({ code: "legacy-config-invalid-type", path: "$/storage/windowLedgerRoot" });
    }
    if (value.storage.paths !== undefined) {
      if (strictKeys(value.storage.paths, STORAGE_PATH_FIELDS, "$/storage/paths", issues)) {
        for (const [key, item] of Object.entries(value.storage.paths)) if (!nonEmptyString(item)) issues.push({ code: "legacy-config-invalid-type", path: `$/storage/paths/${key}` });
      }
    }
    if (value.storage.windowLedgerDirs !== undefined) {
      if (!isPlainObject(value.storage.windowLedgerDirs) || Object.values(value.storage.windowLedgerDirs).some((item) => !nonEmptyString(item))) {
        issues.push({ code: "legacy-config-invalid-type", path: "$/storage/windowLedgerDirs" });
      }
    }
  }
  if (value.policy !== undefined && strictKeys(value.policy, POLICY_FIELDS, "$/policy", issues)) {
    for (const field of ["disallowedTrackedPaths", "allowedRepositoryResiduePaths", "runtimeProcessMatchers"]) {
      if (value.policy[field] !== undefined && !stringArray(value.policy[field])) issues.push({ code: "legacy-config-invalid-type", path: `$/policy/${field}` });
    }
    if (value.policy.allowMissingRepos !== undefined && typeof value.policy.allowMissingRepos !== "boolean") issues.push({ code: "legacy-config-invalid-type", path: "$/policy/allowMissingRepos" });
    if (
      value.policy.preservedRetentionDays !== undefined
      && (
        !Number.isSafeInteger(value.policy.preservedRetentionDays)
        || value.policy.preservedRetentionDays < 1
        || value.policy.preservedRetentionDays > MAX_PRESERVED_REVIEW_AFTER_DAYS
      )
    ) issues.push({ code: "legacy-config-invalid-type", path: "$/policy/preservedRetentionDays" });
    if (value.policy.runtimeProcessLabel !== undefined && typeof value.policy.runtimeProcessLabel !== "string") issues.push({ code: "legacy-config-invalid-type", path: "$/policy/runtimeProcessLabel" });
  }
  validateHosts(value.hosts, "$/hosts", issues);
  const derivedValid = value.derived === undefined ? false : validateDerived(value.derived, "$/derived", issues);
  validateRepositories(value.repositories, "$/repositories", issues, { allowStream: local && derivedValid });
  if (local && value.derived === undefined) issues.push({ code: "legacy-local-config-unmanaged", path: "$/derived" });
  if (!local && value.derived !== undefined) issues.push({ code: "legacy-config-derived-in-durable", path: "$/derived" });
}

function validateFlatConfig(value, issues, { local }) {
  strictKeys(value, FLAT_CONFIG_FIELDS, "$", issues);
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1) issues.push({ code: "legacy-config-invalid-type", path: "$/schemaVersion" });
  for (const field of [
    "$schema",
    "activeLedgerRoot",
    "controllerWindow",
    "designHandoffBoard",
    "designHandoffInbox",
    "designWindow",
    "globalTodoPath",
    "goalStageConfirmationDir",
    "internalDesignPath",
    "internalTestPath",
    "projectLedgerRoot",
    "requirementDesignsDir",
    "testExchangePath",
    "testWindow",
    "windowLedgerRoot",
    "workspaceArchiveDir",
    "workspaceCurrentDir",
    "workspaceCurrentIndexPath",
    "workspaceCurrentStatusPath",
    "workspaceDocsDir",
    "workspaceIndexPath",
    "workspaceName",
    "workspaceRecordMapPath",
    "workspaceRoot",
  ]) {
    if (value[field] !== undefined && !nonEmptyString(value[field])) issues.push({ code: "legacy-config-invalid-type", path: `$/${field}` });
  }
  for (const field of ["baseWindow", "realProjectWindow", "runtimeProcessLabel", "wakeflowRepoDir"]) {
    if (value[field] !== undefined && typeof value[field] !== "string") issues.push({ code: "legacy-config-invalid-type", path: `$/${field}` });
  }
  if (value.interfaceLanguage !== undefined && !["auto", "en", "zh"].includes(value.interfaceLanguage)) issues.push({ code: "legacy-config-invalid-type", path: "$/interfaceLanguage" });
  if (value.runtimeMode !== undefined && !["plugin", "repository"].includes(value.runtimeMode)) issues.push({ code: "legacy-config-invalid-type", path: "$/runtimeMode" });
  for (const field of ["configMigrationWarnings", "dispatchWindows", "requiredDispatchWindows", "repoNames", "protectedWorkspacePrefixes", "disallowedTrackedPaths", "allowedRepositoryResiduePaths", "runtimeProcessMatchers", "windows"]) {
    if (value[field] !== undefined && !stringArray(value[field])) issues.push({ code: "legacy-config-invalid-type", path: `$/${field}` });
  }
  if (value.allowMissingRepos !== undefined && typeof value.allowMissingRepos !== "boolean") {
    issues.push({ code: "legacy-config-invalid-type", path: "$/allowMissingRepos" });
  }
  if (value.maxActiveDemands !== undefined && (!Number.isSafeInteger(value.maxActiveDemands) || value.maxActiveDemands < 1)) {
    issues.push({ code: "legacy-config-invalid-type", path: "$/maxActiveDemands" });
  }
  if (
    value.preservedRetentionDays !== undefined
    && (
      !Number.isSafeInteger(value.preservedRetentionDays)
      || value.preservedRetentionDays < 1
      || value.preservedRetentionDays > MAX_PRESERVED_REVIEW_AFTER_DAYS
    )
  ) issues.push({ code: "legacy-config-invalid-type", path: "$/preservedRetentionDays" });
  if (value.windowLedgerDirs !== undefined && (!isPlainObject(value.windowLedgerDirs) || Object.values(value.windowLedgerDirs).some((item) => !nonEmptyString(item)))) {
    issues.push({ code: "legacy-config-invalid-type", path: "$/windowLedgerDirs" });
  }
  if (value.repositoryRoles !== undefined && (!isPlainObject(value.repositoryRoles) || Object.values(value.repositoryRoles).some((item) => typeof item !== "string"))) {
    issues.push({ code: "legacy-config-invalid-type", path: "$/repositoryRoles" });
  }
  validateHosts(value.hosts ?? {}, "$/hosts", issues);
  const derivedValid = value.derived === undefined ? false : validateDerived(value.derived, "$/derived", issues);
  validateRepositories(value.repositories ?? [], "$/repositories", issues, { allowStream: local && derivedValid });
  if (local && value.derived === undefined) issues.push({ code: "legacy-local-config-unmanaged", path: "$/derived" });
  if (!local && value.derived !== undefined) issues.push({ code: "legacy-config-derived-in-durable", path: "$/derived" });
}

function configRootFamily(value) {
  const active = value.schemaVersion === 2 ? value.storage?.activeRoot : value.activeLedgerRoot;
  if (typeof active === "string" && active.startsWith(".workspace-active")) return "old-root-flat";
  if (value.schemaVersion === 2) return "current-root-v2";
  return null;
}

function configSlotDescriptor(item, at) {
  if (typeof item !== "string" || !item) return null;
  const segments = at.split("/").filter(Boolean);
  const leaf = segments.at(-1);
  const field = /^[0-9]+$/u.test(leaf) ? segments.at(-2) : leaf;
  const parent = segments.at(-2);
  let type = null;
  if (/(?:At|Time)$/u.test(field)) type = "iso-time";
  else if (/(?:hash|digest)$/iu.test(field)) type = "digest";
  else if (
    /(?:path|root|dir|file)$/iu.test(field)
    || field === "from"
    || parent === "windowLedgerDirs"
    || field === "protectedWorkspacePrefixes"
  ) type = item.startsWith("/") ? "absolute-path" : "relative-path";
  else if (at.endsWith("/workspace/name") || field === "workspaceName") type = "workspace-name";
  else if (
    /(?:window|controller|design|test|base|realProject)$/iu.test(field)
    || field === "windowName"
    || ["dispatchWindows", "requiredDispatchWindows", "streamWindows", "windows"].includes(field)
    || parent === "roles"
  ) type = "window-name";
  else if (field === "repoNames" || /repositoryName$/iu.test(field)) type = "repository-name";
  else if (/(?:Id|Key|branch|repo)$/u.test(field)) type = "artifact-id";
  if (!type) return null;
  return {
    id: `config${at.replaceAll("/", ".")}`,
    sensitivity: type === "absolute-path" ? "local" : "portable",
    type,
  };
}

function configCanonicalShape(value) {
  function walk(item, at) {
    if (Array.isArray(item)) return item.map((child, index) => walk(child, `${at}/${index}`));
    if (isPlainObject(item)) {
      return Object.fromEntries(
        Object.entries(item)
          .sort(([left], [right]) => compareText(left, right))
          .map(([key, child]) => [key, walk(child, `${at}/${key}`)]),
      );
    }
    const slot = configSlotDescriptor(item, at);
    return slot ? `@wakeflow-config-slot[${slot.type}|${slot.id}]@` : item;
  }
  return walk(value, "$" );
}

function configSlots(value) {
  const results = [];
  function walk(item, at) {
    if (Array.isArray(item)) return item.forEach((child, index) => walk(child, `${at}/${index}`));
    if (isPlainObject(item)) return Object.entries(item).sort(([left], [right]) => compareText(left, right)).forEach(([key, child]) => walk(child, `${at}/${key}`));
    const slot = configSlotDescriptor(item, at);
    if (!slot) return;
    results.push({ ...slot, valueDigest: sha256(Buffer.from(item)) });
  }
  walk(value, "$");
  return results.sort((left, right) => compareText(left.id, right.id));
}

// 配置按 closed field/type shape 分类；字段间拓扑与source-set一致性继续归T04/T05。
function classifyConfig({ input, text, rawDigest, entries }) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return unknownResult({ input, rawDigest, blockerCodes: ["legacy-source-invalid-json"], format: "json", origins: union(entries.map((entry) => entry.originCandidates)), routes: union(entries.map((entry) => entry.producerRoutes)) });
  }
  if (!isPlainObject(value)) {
    return unknownResult({ input, rawDigest, blockerCodes: ["legacy-config-invalid-type"], format: "json" });
  }
  if (typeof value.schemaVersion === "number" && value.schemaVersion > 2) {
    return unknownResult({ input, rawDigest, blockerCodes: ["legacy-config-future-schema"], format: "json" });
  }
  const local = /^\.wakeflow-local\/(?:wakeflow|workspace)\.config\.json$/u.test(input.relativePath);
  const family = value.schemaVersion === 2 ? "nested-v2" : "flat-v1";
  const issues = [];
  if (family === "nested-v2") validateNestedConfig(value, issues, { local });
  else validateFlatConfig(value, issues, { local });
  if (issues.length > 0) {
    return unknownResult({
      input,
      rawDigest,
      blockerCodes: issues.map(({ code }) => code),
      format: "json",
      origins: union(entries.map((entry) => entry.originCandidates)),
      routes: union(entries.map((entry) => entry.producerRoutes)),
    });
  }
  const rootFamily = configRootFamily(value);
  const matching = entries.filter((entry) => entry.artifact.schema === family)
    .filter((entry) => rootFamily === null || entry.rootFamilies.includes(rootFamily));
  const selected = matching.length > 0 ? matching : entries.filter((entry) => entry.artifact.schema === family);
  if (selected.length === 0) {
    return unknownResult({ input, rawDigest, blockerCodes: ["legacy-config-origin-unsupported"], format: "json" });
  }
  const canonicalDigests = union(selected.map((entry) => [entry.canonicalClassifierDigest]));
  const oldRoot = rootFamily === "old-root-flat";
  const policy = local ? "local-derived-config" : "tracked-config";
  const resolved = resolveDisposition(policy, input, { oldRoot });
  return deepFreeze({
    artifact: outputArtifact(family === "nested-v2" ? "wakeflow-config-v2" : "wakeflow-config-flat-v1", family, "json"),
    blockerCodes: resolved.blockerCodes,
    canonicalClassifierDigest: canonicalJsonDigest({
      catalogDigests: canonicalDigests,
      family,
      local,
      shape: configCanonicalShape(value),
    }),
    components: [],
    confidence: "typed-known",
    defaultDisposition: resolved.disposition,
    lifecycleConclusion: "unresolved",
    originCandidates: union(selected.map((entry) => entry.originCandidates)),
    producerRoutes: union(selected.map((entry) => entry.producerRoutes)),
    rawDigest,
    source: { bytes: input.sourceBytes.length, relativePath: input.relativePath, surfaceKind: input.surfaceKind },
    typedSlots: configSlots(value),
  });
}

function markerBounds(text) {
  for (const [selector, start, end] of [
    ["root-agents", "<!-- wakeflow:root-agents:start -->", "<!-- wakeflow:root-agents:end -->"],
    ["scope", "<!-- wakeflow:scope:start -->", "<!-- wakeflow:scope:end -->"],
  ]) {
    const starts = text.split(start).length - 1;
    const ends = text.split(end).length - 1;
    if (starts === 0 && ends === 0) continue;
    if (starts !== 1 || ends !== 1) return { conflict: true, selector };
    const startAt = text.indexOf(start);
    const endAt = text.indexOf(end);
    if (endAt <= startAt) return { conflict: true, selector };
    return { conflict: false, selector, startAt, endAt: endAt + end.length };
  }
  return null;
}

function componentRecord({ action, canonicalClassifierDigest, componentKind, rawBytes, route, selector }) {
  return deepFreeze({
    action,
    canonicalClassifierDigest,
    componentKind,
    rawDigest: sha256(rawBytes),
    route,
    selector,
  });
}

// ==================== 四、mixed-owned 组件切分 ====================

// 只切出一个exact Wakeflow marker/whole page；marker外原始bytes始终归user remainder。
function classifyMemory({ input, text, rawDigest, entries }) {
  const bounds = markerBounds(text);
  if (bounds?.conflict) {
    return unknownResult({ input, rawDigest, blockerCodes: ["legacy-managed-marker-conflict"], format: "markdown", origins: union(entries.map((entry) => entry.originCandidates)), routes: union(entries.map((entry) => entry.producerRoutes)) });
  }
  const markerEntries = entries.filter((entry) => entry.classifierMode === "memory-marker");
  const wholeEntries = entries.filter((entry) => entry.classifierMode === "memory-whole");
  const candidateText = bounds ? text.slice(bounds.startAt, bounds.endAt) : text;
  const candidates = bounds ? markerEntries : wholeEntries;
  const matches = [];
  for (const entry of candidates) {
    const pathCaptures = matchEntryPath(entry, input.relativePath);
    if (!pathCaptures) continue;
    const captures = matchWholeEntry(entry, candidateText, pathCaptures);
    if (captures) matches.push({ captures, entry });
  }
  if (matches.length === 0) {
    return unknownResult({ input, rawDigest, blockerCodes: ["legacy-source-modified"], format: "markdown", origins: union(entries.map((entry) => entry.originCandidates)), routes: union(entries.map((entry) => entry.producerRoutes)) });
  }
  const digests = union(matches.map(({ entry }) => [entry.canonicalClassifierDigest]));
  if (digests.length > 1) {
    return unknownResult({ input, rawDigest, blockerCodes: ["legacy-classifier-ambiguous"], format: "markdown", origins: union(matches.map(({ entry }) => entry.originCandidates)), routes: union(matches.map(({ entry }) => entry.producerRoutes)) });
  }
  const selected = matches[0];
  const remainder = bounds ? Buffer.from(`${text.slice(0, bounds.startAt)}${text.slice(bounds.endAt)}`) : Buffer.alloc(0);
  if (bounds && /<!--\s*wakeflow:/iu.test(remainder.toString("utf8"))) {
    return unknownResult({
      input,
      rawDigest,
      blockerCodes: ["legacy-managed-marker-conflict"],
      format: "markdown",
      origins: union(matches.map(({ entry }) => entry.originCandidates)),
      routes: union(matches.map(({ entry }) => entry.producerRoutes)),
    });
  }
  const components = [componentRecord({
    action: "transform",
    canonicalClassifierDigest: digests[0],
    componentKind: "wakeflow-memory-block",
    rawBytes: Buffer.from(candidateText),
    route: "managed-merge",
    selector: bounds?.selector ?? "whole-file-generated-memory",
  })];
  if (remainder.length > 0) components.push(componentRecord({
    action: "keep",
    canonicalClassifierDigest: null,
    componentKind: "user-remainder",
    rawBytes: remainder,
    route: "keep",
    selector: "outside-managed-component",
  }));
  const resolved = resolveDisposition(selected.entry.dispositionPolicy, input);
  return deepFreeze({
    artifact: outputArtifact(selected.entry.artifact.kind, selected.entry.artifact.schema, selected.entry.format),
    blockerCodes: resolved.blockerCodes,
    canonicalClassifierDigest: digests[0],
    components,
    confidence: "component-known",
    defaultDisposition: resolved.disposition,
    lifecycleConclusion: "unresolved",
    originCandidates: union(matches.map(({ entry }) => entry.originCandidates)),
    producerRoutes: union(matches.map(({ entry }) => entry.producerRoutes)),
    rawDigest,
    source: { bytes: input.sourceBytes.length, relativePath: input.relativePath, surfaceKind: input.surfaceKind },
    typedSlots: slotOutput(selected.entry.slots, selected.captures),
  });
}

// 同一文件只允许一个唯一known生成序列；第二段known/custom Wakeflow-like规则均fail closed。
function classifyGitignore({ input, text, rawDigest, entries }) {
  if (/^!.*(?:\.wakeflow-|\.workspace-)/mu.test(text)) {
    return unknownResult({ input, rawDigest, blockerCodes: ["legacy-ignore-rule-conflict"], format: "gitignore", origins: union(entries.map((entry) => entry.originCandidates)), routes: union(entries.map((entry) => entry.producerRoutes)) });
  }
  const matches = [];
  for (const entry of entries) {
    const pathCaptures = matchEntryPath(entry, input.relativePath);
    if (!pathCaptures) continue;
    const template = templateText(entry);
    const index = text.indexOf(template);
    if (index < 0) continue;
    if (text.indexOf(template, index + template.length) >= 0) {
      return unknownResult({
        input,
        rawDigest,
        blockerCodes: ["legacy-ignore-component-conflict"],
        format: "gitignore",
        origins: union(entries.map((candidate) => candidate.originCandidates)),
        routes: union(entries.map((candidate) => candidate.producerRoutes)),
      });
    }
    matches.push({ entry, index, template });
  }
  if (matches.length === 0) {
    return unknownResult({ input, rawDigest, blockerCodes: ["legacy-source-modified"], format: "gitignore", origins: union(entries.map((entry) => entry.originCandidates)), routes: union(entries.map((entry) => entry.producerRoutes)) });
  }
  const matchedRanges = new Set(matches.map(({ index, template }) => `${index}:${index + template.length}`));
  if (matchedRanges.size > 1) {
    return unknownResult({
      input,
      rawDigest,
      blockerCodes: ["legacy-ignore-component-conflict"],
      format: "gitignore",
      origins: union(matches.map(({ entry }) => entry.originCandidates)),
      routes: union(matches.map(({ entry }) => entry.producerRoutes)),
    });
  }
  const exact = matches.find(({ entry }) => entry.rawFixtureDigests.includes(rawDigest));
  const selected = exact ?? matches.sort((left, right) => right.template.length - left.template.length)[0];
  const remainder = Buffer.from(`${text.slice(0, selected.index)}${text.slice(selected.index + selected.template.length)}`);
  const hasWakeflowLikeRemainder = remainder.toString("utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .some((line) => /(?:^|\/)\.(?:wakeflow|workspace)-/iu.test(line.replace(/^!+/u, "")));
  if (hasWakeflowLikeRemainder) {
    return unknownResult({
      input,
      rawDigest,
      blockerCodes: ["legacy-ignore-component-conflict"],
      format: "gitignore",
      origins: union(matches.map(({ entry }) => entry.originCandidates)),
      routes: union(matches.map(({ entry }) => entry.producerRoutes)),
    });
  }
  const components = [componentRecord({
    action: input.gitIgnoreRoot === false ? "remove" : "transform",
    canonicalClassifierDigest: selected.entry.canonicalClassifierDigest,
    componentKind: "wakeflow-ignore-entries",
    rawBytes: Buffer.from(selected.template),
    route: input.gitIgnoreRoot === false ? "remove-exact" : "managed-merge",
    selector: "exact-generated-entry-sequence",
  })];
  if (remainder.length > 0) components.push(componentRecord({
    action: "keep",
    canonicalClassifierDigest: null,
    componentKind: "user-remainder",
    rawBytes: remainder,
    route: "keep",
    selector: "outside-managed-component",
  }));
  const resolved = resolveDisposition(selected.entry.dispositionPolicy, input);
  return deepFreeze({
    artifact: outputArtifact(selected.entry.artifact.kind, selected.entry.artifact.schema, selected.entry.format),
    blockerCodes: resolved.blockerCodes,
    canonicalClassifierDigest: selected.entry.canonicalClassifierDigest,
    components,
    confidence: "component-known",
    defaultDisposition: resolved.disposition,
    lifecycleConclusion: "unresolved",
    originCandidates: union(matches.map(({ entry }) => entry.originCandidates)),
    producerRoutes: union(matches.map(({ entry }) => entry.producerRoutes)),
    rawDigest,
    source: { bytes: input.sourceBytes.length, relativePath: input.relativePath, surfaceKind: input.surfaceKind },
    typedSlots: [],
  });
}

function settingsTemplates(entries) {
  return entries.map((entry) => ({ entry, value: JSON.parse(templateText(entry)) }));
}

function cloneJsonValue(value) {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneJsonValue(child)]));
  }
  return value;
}

function removePermissionField(remainder, field) {
  if (!isPlainObject(remainder.permissions)) return;
  delete remainder.permissions[field];
  if (Object.keys(remainder.permissions).length === 0) delete remainder.permissions;
}

function replacePermissionArray(remainder, field, values) {
  if (!isPlainObject(remainder.permissions)) return;
  if (values.length === 0) removePermissionField(remainder, field);
  else remainder.permissions[field] = values;
}

function appendSettingsRemainder(components, remainder) {
  if (Object.keys(remainder).length === 0) return;
  components.push(componentRecord({
    action: "keep",
    canonicalClassifierDigest: null,
    componentKind: "user-remainder",
    rawBytes: Buffer.from(canonicalJson(remainder)),
    route: "keep",
    selector: "outside-managed-components",
  }));
}

function settingsSlotOutput(matches) {
  const byEvidence = new Map();
  for (const { captures, entry } of matches) {
    for (const slot of slotOutput(entry.slots, captures)) {
      const key = `${slot.type}:${slot.sensitivity}:${slot.valueDigest}`;
      byEvidence.set(key, slot);
    }
  }
  return [...byEvidence.values()]
    .map((slot) => ({
      ...slot,
      id: `settings-${slot.type}-${slot.sensitivity}-${slot.valueDigest.slice(7, 19)}`,
    }))
    .sort((left, right) => compareText(left.id, right.id));
}

function settingsConflict({ input, rawDigest, entries }) {
  return unknownResult({
    input,
    rawDigest,
    blockerCodes: ["legacy-settings-component-conflict"],
    format: "json",
    origins: union(entries.map((entry) => entry.originCandidates)),
    routes: union(entries.map((entry) => entry.producerRoutes)),
  });
}

function statusLineMatches(statusLine, templates) {
  const matches = [];
  for (const { entry, value: template } of templates) {
    if (template.statusLine === undefined) continue;
    const captures = new Map();
    if (matchJsonTemplate(template.statusLine, statusLine, entry.slots, captures)) {
      matches.push({ captures, entry });
    }
  }
  return matches;
}

// 逐JSON key/array entry切分portable allow、旧grant/statusLine与真正的user remainder，绝不整文件认领。
function classifyClaudeSettings({ input, text, rawDigest, entries, allSettingsEntries }) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return unknownResult({ input, rawDigest, blockerCodes: ["legacy-source-invalid-json"], format: "json", origins: union(entries.map((entry) => entry.originCandidates)), routes: union(entries.map((entry) => entry.producerRoutes)) });
  }
  if (!isPlainObject(value)) return unknownResult({ input, rawDigest, blockerCodes: ["legacy-settings-invalid-shape"], format: "json" });
  const templates = settingsTemplates(entries);
  const allTemplates = settingsTemplates(allSettingsEntries);
  const components = [];
  const matchedEntries = [];
  const matchedSlotSources = [];
  const remainder = cloneJsonValue(value);
  if (input.relativePath.endsWith("settings.json")) {
    const knownAllow = new Map();
    for (const { entry, value: template } of templates) {
      for (const permission of template.permissions?.allow ?? []) {
        const rows = knownAllow.get(permission) ?? [];
        rows.push(entry);
        knownAllow.set(permission, rows);
      }
    }
    if (value.permissions !== undefined && !isPlainObject(value.permissions)) {
      return unknownResult({ input, rawDigest, blockerCodes: ["legacy-settings-invalid-shape"], format: "json" });
    }
    const actualAllow = value.permissions?.allow;
    if (actualAllow !== undefined && !stringArray(actualAllow)) {
      return unknownResult({ input, rawDigest, blockerCodes: ["legacy-settings-invalid-shape"], format: "json" });
    }
    const permissionCounts = new Map();
    for (const permission of actualAllow ?? []) {
      permissionCounts.set(permission, (permissionCounts.get(permission) ?? 0) + 1);
    }
    if ([...permissionCounts].some(([permission, count]) => knownAllow.has(permission) && count > 1)) {
      return settingsConflict({ input, rawDigest, entries });
    }
    const managedPermissions = new Set();
    for (const permission of actualAllow ?? []) {
      const owners = knownAllow.get(permission);
      if (owners) {
        matchedEntries.push(...owners);
        managedPermissions.add(permission);
        components.push(componentRecord({
          action: "transform",
          canonicalClassifierDigest: canonicalJsonDigest({ kind: "claude-permission-entry", permission }),
          componentKind: "claude-permission-entry",
          rawBytes: Buffer.from(permission),
          route: "managed-merge",
          selector: `permissions.allow:${sha256(Buffer.from(permission))}`,
        }));
      } else if (/wakeflow|Bash\((?:node|git|tmux) \*\)/iu.test(permission)) {
        return unknownResult({ input, rawDigest, blockerCodes: ["legacy-settings-component-conflict"], format: "json", origins: union(entries.map((entry) => entry.originCandidates)), routes: union(entries.map((entry) => entry.producerRoutes)) });
      }
    }
    if (managedPermissions.size > 0) {
      replacePermissionArray(
        remainder,
        "allow",
        (remainder.permissions?.allow ?? []).filter((permission) => !managedPermissions.has(permission)),
      );
    }

    const additionalDirectories = value.permissions?.additionalDirectories;
    if (
      additionalDirectories !== undefined
      && (!Array.isArray(additionalDirectories) || additionalDirectories.some((entry) => typeof entry !== "string"))
    ) {
      return unknownResult({ input, rawDigest, blockerCodes: ["legacy-settings-invalid-shape"], format: "json" });
    }
    const portableTemplates = allTemplates.filter(({ entry }) => entry.pathTemplate.endsWith("settings.json"));
    const additionalPatterns = portableTemplates.flatMap(({ entry, value: template }) => (
      (template.permissions?.additionalDirectories ?? []).map((pattern) => ({ entry, pattern }))
    ));
    const emptyAdditionalEntries = portableTemplates
      .filter(({ value: template }) => Array.isArray(template.permissions?.additionalDirectories) && template.permissions.additionalDirectories.length === 0)
      .map(({ entry }) => entry);
    const completeManagedPermissionSet = knownAllow.size > 0
      && [...knownAllow.keys()].every((permission) => permissionCounts.get(permission) === 1);
    const keptAdditionalDirectories = [];
    const managedAdditionalSelectors = new Set();
    for (const additionalDirectory of additionalDirectories ?? []) {
      const matches = [];
      for (const { entry, pattern } of additionalPatterns) {
        const captures = new Map();
        if (matchJsonTemplate(pattern, additionalDirectory, entry.slots, captures)) {
          matches.push({ captures, entry });
        }
      }
      if (matches.length === 0) {
        keptAdditionalDirectories.push(additionalDirectory);
        continue;
      }
      if (!completeManagedPermissionSet) return settingsConflict({ input, rawDigest, entries });
      const selector = `permissions.additionalDirectories:${sha256(Buffer.from(canonicalJson(additionalDirectory)))}`;
      if (managedAdditionalSelectors.has(selector)) return settingsConflict({ input, rawDigest, entries });
      managedAdditionalSelectors.add(selector);
      matchedEntries.push(...matches.map(({ entry }) => entry));
      matchedSlotSources.push(...matches);
      components.push(componentRecord({
        action: "remove",
        canonicalClassifierDigest: canonicalJsonDigest({ kind: "claude-additional-directory-entry", patterns: union(matches.map(({ entry }) => [entry.canonicalClassifierDigest])) }),
        componentKind: "claude-additional-directory-entry",
        rawBytes: Buffer.from(canonicalJson(additionalDirectory)),
        route: "managed-merge",
        selector,
      }));
    }
    if (additionalDirectories?.length === 0 && emptyAdditionalEntries.length > 0) {
      if (!completeManagedPermissionSet) return settingsConflict({ input, rawDigest, entries });
      matchedEntries.push(...emptyAdditionalEntries);
      components.push(componentRecord({
        action: "remove",
        canonicalClassifierDigest: canonicalJsonDigest({ kind: "claude-additional-directories-empty" }),
        componentKind: "claude-additional-directories",
        rawBytes: Buffer.from("[]"),
        route: "managed-merge",
        selector: "permissions.additionalDirectories",
      }));
    }
    if (additionalDirectories !== undefined && (managedAdditionalSelectors.size > 0 || additionalDirectories.length === 0)) {
      replacePermissionArray(remainder, "additionalDirectories", keptAdditionalDirectories);
    }

    if (value.statusLine !== undefined) {
      const portableStatusMatches = statusLineMatches(
        value.statusLine,
        allTemplates.filter(({ entry }) => entry.pathTemplate.endsWith("settings.local.json")),
      );
      if (portableStatusMatches.length > 0) {
        matchedEntries.push(...portableStatusMatches.map(({ entry }) => entry));
        matchedSlotSources.push(...portableStatusMatches);
        components.push(componentRecord({
          action: "remove",
          canonicalClassifierDigest: canonicalJsonDigest({
            kind: "claude-portable-statusline-signature",
            signatures: union(portableStatusMatches.map(({ entry }) => [entry.canonicalClassifierDigest])),
          }),
          componentKind: "claude-portable-statusline-signature",
          rawBytes: Buffer.from(canonicalJson(value.statusLine)),
          route: "managed-merge",
          selector: "statusLine",
        }));
        delete remainder.statusLine;
      } else if (/wakeflow-statusline|\.wakeflow-local/iu.test(canonicalJson(value.statusLine))) {
        return settingsConflict({ input, rawDigest, entries });
      }
    }
    if (components.length === 0) {
      return unknownResult({ input, rawDigest, blockerCodes: ["legacy-settings-component-unknown"], format: "json", origins: union(entries.map((entry) => entry.originCandidates)), routes: union(entries.map((entry) => entry.producerRoutes)) });
    }
  } else {
    if (value.statusLine === undefined) {
      return unknownResult({ input, rawDigest, blockerCodes: ["legacy-settings-component-unknown"], format: "json", origins: union(entries.map((entry) => entry.originCandidates)), routes: union(entries.map((entry) => entry.producerRoutes)) });
    }
    const statusMatches = statusLineMatches(value.statusLine, templates);
    if (statusMatches.length === 0) {
      const serialized = canonicalJson(value.statusLine);
      if (/wakeflow-statusline|\.wakeflow-local/iu.test(serialized)) {
        return unknownResult({ input, rawDigest, blockerCodes: ["legacy-settings-component-conflict"], format: "json", origins: union(entries.map((entry) => entry.originCandidates)), routes: union(entries.map((entry) => entry.producerRoutes)) });
      }
      return deepFreeze({
        artifact: outputArtifact("claude-settings-local", null, "json"),
        blockerCodes: [],
        canonicalClassifierDigest: null,
        components: [componentRecord({ action: "keep", canonicalClassifierDigest: null, componentKind: "user-remainder", rawBytes: input.sourceBytes, route: "keep", selector: "custom-unmanaged-statusline" })],
        confidence: "component-known",
        defaultDisposition: disposition("keep", "keep", [], []),
        lifecycleConclusion: "unresolved",
        originCandidates: [],
        producerRoutes: [],
        rawDigest,
        source: { bytes: input.sourceBytes.length, relativePath: input.relativePath, surfaceKind: input.surfaceKind },
        typedSlots: [],
      });
    }
    const exactStatusMatches = statusMatches.filter(({ entry }) => entry.rawFixtureDigests.includes(rawDigest));
    const eligibleStatusMatches = exactStatusMatches.length > 0 ? exactStatusMatches : statusMatches;
    matchedEntries.push(...eligibleStatusMatches.map(({ entry }) => entry));
    matchedSlotSources.push(...eligibleStatusMatches);
    components.push(componentRecord({
      action: "transform",
      canonicalClassifierDigest: canonicalJsonDigest({
        kind: "claude-statusline-signature",
        signatures: union(eligibleStatusMatches.map(({ entry }) => [entry.canonicalClassifierDigest])),
      }),
      componentKind: "claude-statusline-signature",
      rawBytes: Buffer.from(canonicalJson(value.statusLine)),
      route: "managed-merge",
      selector: "statusLine",
    }));
    delete remainder.statusLine;
  }
  appendSettingsRemainder(components, remainder);
  const sortedComponents = [...components].sort((left, right) => compareText(left.selector, right.selector));
  if (new Set(sortedComponents.map(({ selector }) => selector)).size !== sortedComponents.length) {
    return settingsConflict({ input, rawDigest, entries });
  }
  const selected = matchedEntries[0] ?? entries[0];
  const resolved = resolveDisposition("mixed-claude-settings", input);
  return deepFreeze({
    artifact: outputArtifact(input.relativePath.endsWith("settings.local.json") ? "claude-settings-local" : "claude-settings", selected.artifact.schema, "json"),
    blockerCodes: resolved.blockerCodes,
    canonicalClassifierDigest: canonicalJsonDigest({ componentDigests: sortedComponents.filter(({ canonicalClassifierDigest }) => canonicalClassifierDigest).map(({ canonicalClassifierDigest }) => canonicalClassifierDigest).sort(compareText) }),
    components: sortedComponents,
    confidence: "component-known",
    defaultDisposition: resolved.disposition,
    lifecycleConclusion: "unresolved",
    originCandidates: union(matchedEntries.map((entry) => entry.originCandidates)),
    producerRoutes: union(matchedEntries.map((entry) => entry.producerRoutes)),
    rawDigest,
    source: { bytes: input.sourceBytes.length, relativePath: input.relativePath, surfaceKind: input.surfaceKind },
    typedSlots: settingsSlotOutput(matchedSlotSources),
  });
}

// whole-file只接受exact或声明slot后的完整模板，不对相似kind/filename做宽松识别。
function classifyWhole({ input, text, rawDigest, entries }) {
  const matches = [];
  for (const entry of entries) {
    const pathCaptures = matchEntryPath(entry, input.relativePath);
    if (!pathCaptures) continue;
    const captures = matchWholeEntry(entry, text, pathCaptures);
    if (captures) matches.push({ captures, entry });
  }
  if (matches.length === 0) {
    return unknownResult({ input, rawDigest, blockerCodes: ["legacy-source-modified"], format: inferFormat(input.relativePath), origins: union(entries.map((entry) => entry.originCandidates)), routes: union(entries.map((entry) => entry.producerRoutes)) });
  }
  const exact = matches.filter(({ entry }) => entry.rawFixtureDigests.includes(rawDigest));
  const eligible = exact.length > 0 ? exact : matches;
  const digests = union(eligible.map(({ entry }) => [entry.canonicalClassifierDigest]));
  if (digests.length !== 1) {
    return unknownResult({ input, rawDigest, blockerCodes: ["legacy-classifier-ambiguous"], format: eligible[0].entry.format, origins: union(eligible.map(({ entry }) => entry.originCandidates)), routes: union(eligible.map(({ entry }) => entry.producerRoutes)) });
  }
  const selected = eligible[0];
  const oldRoot = allOldRoot(eligible.map(({ entry }) => entry), input.relativePath);
  const resolved = resolveDisposition(selected.entry.dispositionPolicy, input, { oldRoot });
  return deepFreeze({
    artifact: outputArtifact(selected.entry.artifact.kind, selected.entry.artifact.schema, selected.entry.format),
    blockerCodes: resolved.blockerCodes,
    canonicalClassifierDigest: digests[0],
    components: [],
    confidence: exact.length > 0 ? "exact-known" : "typed-known",
    defaultDisposition: resolved.disposition,
    lifecycleConclusion: "unresolved",
    originCandidates: union(eligible.map(({ entry }) => entry.originCandidates)),
    producerRoutes: union(eligible.map(({ entry }) => entry.producerRoutes)),
    rawDigest,
    source: { bytes: input.sourceBytes.length, relativePath: input.relativePath, surfaceKind: input.surfaceKind },
    typedSlots: slotOutput(selected.entry.slots, selected.captures),
  });
}

// ==================== 五、公开单源分类入口 ====================

/**
 * 对调用方已经冻结读取的一个legacy source做纯分类。
 * 返回值可供inventory记录事实，但不能单独证明lifecycle终止或授权迁移/删除。
 */
export function classifyWakeflowLegacySource(input) {
  const normalized = validateInput(input);
  const rawDigest = sha256(normalized.sourceBytes);
  let text;
  try {
    text = UTF8_DECODER.decode(normalized.sourceBytes);
  } catch {
    return unknownResult({
      input: normalized,
      rawDigest,
      blockerCodes: ["legacy-source-invalid-utf8"],
      format: inferFormat(normalized.relativePath),
    });
  }
  const catalog = readWakeflowLegacyClassifierCatalog();
  const entries = catalog.entries
    .filter((entry) => entry.surfaceKind === normalized.surfaceKind)
    .filter((entry) => matchEntryPath(entry, normalized.relativePath));
  if (entries.length === 0) {
    return unknownResult({
      input: normalized,
      rawDigest,
      blockerCodes: ["legacy-source-unknown"],
      format: inferFormat(normalized.relativePath),
    });
  }
  const configEntries = entries.filter((entry) => entry.classifierMode === "config-schema");
  if (configEntries.length > 0) return classifyConfig({ input: normalized, text, rawDigest, entries: configEntries });
  const memoryEntries = entries.filter((entry) => entry.classifierMode === "memory-marker" || entry.classifierMode === "memory-whole");
  if (memoryEntries.length > 0) return classifyMemory({ input: normalized, text, rawDigest, entries: memoryEntries });
  const ignoreEntries = entries.filter((entry) => entry.classifierMode === "gitignore-components");
  if (ignoreEntries.length > 0) return classifyGitignore({ input: normalized, text, rawDigest, entries: ignoreEntries });
  const settingsEntries = entries.filter((entry) => entry.classifierMode === "claude-settings-components");
  if (settingsEntries.length > 0) {
    return classifyClaudeSettings({
      input: normalized,
      text,
      rawDigest,
      entries: settingsEntries,
      allSettingsEntries: catalog.entries.filter((entry) => (
        entry.classifierMode === "claude-settings-components"
        && entry.surfaceKind === normalized.surfaceKind
      )),
    });
  }
  return classifyWhole({ input: normalized, text, rawDigest, entries: entries.filter((entry) => entry.classifierMode === "whole-file") });
}
