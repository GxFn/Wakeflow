/**
 * Demand 托管证据的可移植记录与只读物理边界。
 *
 * 能力导航：
 * - manifest合同：validateEvidenceSource、validateEvidencePayload、validateEvidenceManifest。
 * - identity与写入意图：evidenceIdentity、validateEvidenceWriteIntent。
 * - strict read：loadManagedEvidenceByRef、loadManagedEvidencePortableMembers。
 * - capability诊断：inspectManagedEvidenceInventory。
 *
 * 本文件只证明记录形状、canonical identity和既有证据树的物理完整性；来源扫描与
 * stage/publish effect归evidence-tree，state/event事务归demand-state-service，内容真实性和
 * Controller验收仍不由文件存在或digest自动决定。
 */
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

import { sha256Bytes } from "./wakeflow-atomic-write.mjs";
import { canonicalJson, canonicalJsonBytes, canonicalJsonDigest } from "./wakeflow-canonical-json.mjs";
import { inspectEvidenceFinalWrite } from "./wakeflow-evidence-tree.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";

export const WAKEFLOW_EVIDENCE_SCHEMA_VERSION = 1;
export const WAKEFLOW_EVIDENCE_ARTIFACT_KIND = "wakeflow-evidence";
export const WAKEFLOW_EVIDENCE_MAX_MANIFEST_BYTES = 1024 * 1024;
export const WAKEFLOW_EVIDENCE_MAX_RELATIONS = 256;
export const WAKEFLOW_EVIDENCE_CONTENT_CLASSES = Object.freeze([
  "application/pdf",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
]);

const CONTENT_CLASS_SET = new Set(WAKEFLOW_EVIDENCE_CONTENT_CLASSES);
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const TIMESTAMP_RE = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(?:\.[0-9]{1,9})?Z$/u;
const GIT_OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const TOKEN_CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/u;
const PRIVATE_METADATA_RE = /(?:^|\/)(?:Users|home|var|tmp|private|opt|etc|usr|Volumes)(?:\/|$)|(?:^|[\s/])~(?:\/|$)|[A-Za-z]:(?:[\\/]|$)/iu;
const CREDENTIAL_METADATA_RE = /(?:sk-(?:proj-)?[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{12,}|(?:token|password|passwd|secret|api[_-]?key|access[_-]?key)[:=][^/\s]+)/iu;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/giu;
const TYPED_UUID_PREFIX_RE = /(?:archive|binding|confirmation|delivery-envelope|delivery-group|delivery-packet|delivery-run|demand|evidence|pod|pod-design-handoff|pod-design-request|program|repository|review-candidate|surface|task-package|target-result|target-task|test-card|window)_$/u;
const SENSITIVITY_SET = new Set(["internal", "public"]);
const SOURCE_TYPES = new Set(["file", "tree"]);
const ARTIFACT_RELATIONS = Object.freeze({
  "wakeflow-review-candidate": Object.freeze({
    idType: "review-candidate",
    ref(id) {
      return `review-candidates/${id}.json`;
    },
  }),
  "wakeflow-target-result": Object.freeze({
    idType: "target-result",
    ref(id, relationPath) {
      const match = relationPath.match(/^target-results\/(target-task_[^/]+)\/([^/]+)\.json$/u);
      if (!match || match[2] !== id) return null;
      assertTypedId(match[1], "target-task", "$/relations/ref");
      return relationPath;
    },
  }),
  "wakeflow-task-package": Object.freeze({
    idType: "task-package",
    ref(id) {
      return `task-packages/${id}.json`;
    },
  }),
  "wakeflow-test-card": Object.freeze({
    idType: "test-card",
    ref(id) {
      return `test-cards/${id}.json`;
    },
  }),
});

// ==================== 一、错误、无行为输入与基础标量 ====================

export class WakeflowEvidenceRecordError extends Error {
  constructor(code, message, { path: errorPath = "$", details = {}, cause } = {}) {
    super(message);
    this.name = "WakeflowEvidenceRecordError";
    this.code = code;
    this.path = errorPath;
    this.details = Object.freeze({
      ...details,
      ...(cause?.code ? { causeCode: cause.code } : {}),
    });
  }
}

function fail(code, errorPath, message, details = {}, cause = undefined) {
  throw new WakeflowEvidenceRecordError(code, `${message} at ${errorPath}`, {
    path: errorPath,
    details,
    cause,
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

// 公开record边界先复制为canonical纯数据，拒绝accessor、隐藏字段、symbol和循环引用。
function canonicalDataSnapshot(value, errorPath = "$") {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (cause) {
    fail(
      "wakeflow-evidence-data",
      errorPath,
      "evidence input must be canonical plain data without accessors, symbols, hidden fields, or cycles",
      { causeCode: cause?.code ?? null },
      cause,
    );
  }
}

function frozenClone(value) {
  return deepFreeze(JSON.parse(canonicalJson(value)));
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertPlainObject(value, errorPath) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("wakeflow-evidence-type", errorPath, "evidence value must be a plain object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("wakeflow-evidence-type", errorPath, "evidence value must be a plain object");
  }
  return value;
}

function assertExactKeys(value, required, optional, errorPath) {
  assertPlainObject(value, errorPath);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail("wakeflow-evidence-unknown-field", `${errorPath}/${key}`, `unknown evidence field ${key}`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail("wakeflow-evidence-required-field", `${errorPath}/${key}`, `missing required evidence field ${key}`);
    }
  }
}

function assertTypedId(value, type, errorPath) {
  try {
    return assertWakeflowId(value, type, errorPath);
  } catch (cause) {
    fail("wakeflow-evidence-id", errorPath, `expected one typed ${type} ID`, {}, cause);
  }
}

function assertDigest(value, errorPath) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail("wakeflow-evidence-digest", errorPath, "digest must be sha256:<64 lowercase hex>");
  }
  return value;
}

function assertToken(value, errorPath) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || TOKEN_CONTROL_RE.test(value)
    || Buffer.byteLength(value, "utf8") > 128
  ) {
    fail("wakeflow-evidence-token", errorPath, "token must be non-empty, trimmed, control-free, and at most 128 UTF-8 bytes");
  }
  return value;
}

function assertSafePortableMetadata(value, errorPath, { rejectPrivatePath = false } = {}) {
  if (
    CREDENTIAL_METADATA_RE.test(value)
    || (rejectPrivatePath && PRIVATE_METADATA_RE.test(value))
  ) {
    fail("wakeflow-evidence-privacy", errorPath, "portable evidence metadata contains a rejected private-path or credential pattern");
  }
  for (const match of value.matchAll(UUID_RE)) {
    const prefix = value.slice(Math.max(0, match.index - 64), match.index);
    if (!TYPED_UUID_PREFIX_RE.test(prefix)) {
      fail("wakeflow-evidence-privacy", errorPath, "portable evidence metadata contains an untyped UUID-like host handle");
    }
  }
  return value;
}

function assertTimestamp(value, errorPath) {
  const match = typeof value === "string" ? value.match(TIMESTAMP_RE) : null;
  if (!match) fail("wakeflow-evidence-timestamp", errorPath, "timestamp must be a UTC RFC3339 value");
  const [, year, month, day, hour, minute, second] = match;
  const parsed = new Date(0);
  parsed.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  parsed.setUTCHours(Number(hour), Number(minute), Number(second), 0);
  if (
    parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() !== Number(month) - 1
    || parsed.getUTCDate() !== Number(day)
    || parsed.getUTCHours() !== Number(hour)
    || parsed.getUTCMinutes() !== Number(minute)
    || parsed.getUTCSeconds() !== Number(second)
  ) {
    fail("wakeflow-evidence-timestamp", errorPath, "timestamp must name a real UTC instant");
  }
  return value;
}

function assertInteger(value, errorPath, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail("wakeflow-evidence-integer", errorPath, `integer must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function assertPortablePath(value, errorPath, { payload = false } = {}) {
  const measuredValue = payload && typeof value === "string"
    ? (value === "payload" ? "" : value.replace(/^payload\//u, ""))
    : value;
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || value.includes("\\")
    || value.includes(":")
    || TOKEN_CONTROL_RE.test(value)
    || value.startsWith("/")
    || value.endsWith("/")
    || value.includes("//")
    || /^[A-Za-z]:/u.test(value)
    || Buffer.byteLength(measuredValue, "utf8") > 512
  ) {
    fail("wakeflow-evidence-path", errorPath, "path must be a canonical portable relative path of at most 512 UTF-8 bytes");
  }
  const segments = value.split("/");
  if (
    segments.length > (payload ? 17 : 16)
    || segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    fail("wakeflow-evidence-path", errorPath, "path cannot contain empty/dot segments or exceed 16 segments");
  }
  if (path.posix.normalize(value) !== value) {
    fail("wakeflow-evidence-path", errorPath, "path must already be normalized");
  }
  if (payload && value !== "payload" && !value.startsWith("payload/")) {
    fail("wakeflow-evidence-payload-path", errorPath, "payload member paths must stay below payload/");
  }
  return value;
}

function assertSortedUnique(values, errorPath, key = (value) => value) {
  const keys = values.map(key);
  if (new Set(keys).size !== keys.length) {
    fail("wakeflow-evidence-order", errorPath, "entries must be unique");
  }
  const sorted = [...keys].sort(lexicalCompare);
  if (keys.some((entry, index) => entry !== sorted[index])) {
    fail("wakeflow-evidence-order", errorPath, "entries must use canonical lexical order");
  }
}

function validateVerification(value, errorPath) {
  assertExactKeys(value, ["kind", "digest"], [], errorPath);
  if (value.kind !== "caller-supplied-digest") {
    fail("wakeflow-evidence-source", `${errorPath}/kind`, "locator verification kind must be caller-supplied-digest");
  }
  assertDigest(value.digest, `${errorPath}/digest`);
  return value;
}

// ==================== 二、source、payload与manifest合同 ====================

/**
 * 校验证据来源描述，只接纳configured managed path或不执行网络/Git读取的locator记录。
 * locator中的caller-supplied digest是调用方声明，不会在这里升级成Wakeflow实证。
 */
export function validateEvidenceSource(value, errorPath = "$/source") {
  value = canonicalDataSnapshot(value, errorPath);
  assertPlainObject(value, errorPath);
  if (value.kind === "managed-path") {
    assertExactKeys(value, ["kind", "root", "path", "expectedType", "expectedDigest"], [], errorPath);
    assertExactKeys(value.root, ["kind"], value.root?.kind === "repository" ? ["repositoryId"] : ["surfaceId"], `${errorPath}/root`);
    if (value.root.kind === "repository") {
      if (!Object.hasOwn(value.root, "repositoryId") || Object.keys(value.root).length !== 2) {
        fail("wakeflow-evidence-source", `${errorPath}/root`, "repository source root must contain exactly kind and repositoryId");
      }
      assertTypedId(value.root.repositoryId, "repository", `${errorPath}/root/repositoryId`);
    } else if (value.root.kind === "support-surface") {
      if (!Object.hasOwn(value.root, "surfaceId") || Object.keys(value.root).length !== 2) {
        fail("wakeflow-evidence-source", `${errorPath}/root`, "support source root must contain exactly kind and surfaceId");
      }
      assertTypedId(value.root.surfaceId, "surface", `${errorPath}/root/surfaceId`);
    } else {
      fail("wakeflow-evidence-source", `${errorPath}/root/kind`, "managed source root must be repository or support-surface");
    }
    assertSafePortableMetadata(
      assertPortablePath(value.path, `${errorPath}/path`),
      `${errorPath}/path`,
    );
    if (!SOURCE_TYPES.has(value.expectedType)) {
      fail("wakeflow-evidence-source", `${errorPath}/expectedType`, "managed source expectedType must be file or tree");
    }
    assertDigest(value.expectedDigest, `${errorPath}/expectedDigest`);
    return frozenClone(value);
  }
  if (value.kind === "https") {
    assertExactKeys(value, ["kind", "url", "verification"], [], errorPath);
    if (typeof value.url !== "string" || Buffer.byteLength(value.url, "utf8") > 2048) {
      fail("wakeflow-evidence-source", `${errorPath}/url`, "HTTPS locator must be at most 2048 UTF-8 bytes");
    }
    let locator;
    try {
      locator = new URL(value.url);
    } catch {
      fail("wakeflow-evidence-source", `${errorPath}/url`, "HTTPS locator must be a valid canonical URL");
    }
    if (
      locator.protocol !== "https:"
      || !locator.hostname
      || locator.username
      || locator.password
      || locator.search
      || locator.hash
      || locator.href !== value.url
    ) {
      fail(
        "wakeflow-evidence-source",
        `${errorPath}/url`,
        "HTTPS locator must be canonical and omit userinfo, query, and fragment",
      );
    }
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(locator.pathname);
    } catch {
      fail("wakeflow-evidence-source", `${errorPath}/url`, "HTTPS locator path must use valid percent encoding");
    }
    assertSafePortableMetadata(locator.hostname, `${errorPath}/url`, { rejectPrivatePath: true });
    assertSafePortableMetadata(decodedPath, `${errorPath}/url`, { rejectPrivatePath: true });
    validateVerification(value.verification, `${errorPath}/verification`);
    return frozenClone(value);
  }
  if (value.kind === "git-commit") {
    assertExactKeys(value, ["kind", "repositoryId", "commitOid", "verification"], [], errorPath);
    assertTypedId(value.repositoryId, "repository", `${errorPath}/repositoryId`);
    if (typeof value.commitOid !== "string" || !GIT_OID_RE.test(value.commitOid)) {
      fail("wakeflow-evidence-source", `${errorPath}/commitOid`, "Git locator must use a full lowercase SHA-1 or SHA-256 object ID");
    }
    validateVerification(value.verification, `${errorPath}/verification`);
    return frozenClone(value);
  }
  fail("wakeflow-evidence-source", `${errorPath}/kind`, "source kind must be managed-path, https, or git-commit");
}

function validatePrivacyScan(value, errorPath) {
  assertExactKeys(value, ["schemaVersion", "disposition", "findingCounts"], [], errorPath);
  if (value.schemaVersion !== 1 || value.disposition !== "passed") {
    fail("wakeflow-evidence-privacy", errorPath, "committed evidence must record privacy scan version 1 with passed disposition");
  }
  if (!Array.isArray(value.findingCounts) || value.findingCounts.length !== 0) {
    fail("wakeflow-evidence-privacy", `${errorPath}/findingCounts`, "committed evidence cannot contain reject-only privacy findings");
  }
  return value;
}

function payloadTreeProjection(value) {
  return {
    directories: value.directories
      .filter((entry) => entry !== "payload")
      .map((entry) => entry.slice("payload/".length)),
    files: value.files.map((entry) => ({
      path: entry.path.slice("payload/".length),
      bytes: entry.bytes,
      digest: entry.digest,
      contentClass: entry.contentClass,
    })),
  };
}

/**
 * 从已闭合payload inventory计算不含受管wrapper名称的可移植tree digest。
 */
export function evidencePayloadTreeDigest(value) {
  const payload = validateEvidencePayload(value);
  return canonicalJsonDigest(payloadTreeProjection(payload));
}

/**
 * 校验payload目录、成员、容量、content class与tree digest的完整闭包。
 * 本函数只验证manifest inventory，不读取实际payload文件。
 */
export function validateEvidencePayload(value, errorPath = "$/payload") {
  value = canonicalDataSnapshot(value, errorPath);
  assertExactKeys(value, ["directories", "files", "totalBytes", "treeDigest"], [], errorPath);
  if (!Array.isArray(value.directories) || value.directories.length < 1 || value.directories.length > 257) {
    fail("wakeflow-evidence-payload", `${errorPath}/directories`, "payload must list its wrapper plus at most 256 source directories");
  }
  value.directories.forEach((entry, index) => assertSafePortableMetadata(
    assertPortablePath(entry, `${errorPath}/directories/${index}`, { payload: true }),
    `${errorPath}/directories/${index}`,
  ));
  assertSortedUnique(value.directories, `${errorPath}/directories`);
  if (value.directories[0] !== "payload") {
    fail("wakeflow-evidence-payload", `${errorPath}/directories`, "payload root must be the first directory");
  }
  if (!Array.isArray(value.files) || value.files.length > 256) {
    fail("wakeflow-evidence-payload", `${errorPath}/files`, "payload can list at most 256 files");
  }
  value.files.forEach((entry, index) => {
    const memberPath = `${errorPath}/files/${index}`;
    assertExactKeys(entry, ["path", "bytes", "digest", "contentClass"], [], memberPath);
    assertSafePortableMetadata(
      assertPortablePath(entry.path, `${memberPath}/path`, { payload: true }),
      `${memberPath}/path`,
    );
    if (entry.path === "payload") {
      fail("wakeflow-evidence-payload", `${memberPath}/path`, "payload file cannot replace the payload directory");
    }
    assertInteger(entry.bytes, `${memberPath}/bytes`, { maximum: 16 * 1024 * 1024 });
    assertDigest(entry.digest, `${memberPath}/digest`);
    if (!CONTENT_CLASS_SET.has(entry.contentClass)) {
      fail("wakeflow-evidence-content", `${memberPath}/contentClass`, "payload file has an unsupported content class");
    }
  });
  assertSortedUnique(value.files, `${errorPath}/files`, (entry) => entry.path);
  const directories = new Set(value.directories);
  const files = new Set(value.files.map((entry) => entry.path));
  for (const directory of directories) {
    if (files.has(directory)) {
      fail("wakeflow-evidence-payload", errorPath, "payload path cannot be both a file and a directory");
    }
    if (directory !== "payload") {
      const parent = path.posix.dirname(directory);
      if (!directories.has(parent)) {
        fail("wakeflow-evidence-payload", `${errorPath}/directories`, "every payload directory parent must be inventoried");
      }
    }
  }
  for (const file of value.files) {
    if (!directories.has(path.posix.dirname(file.path))) {
      fail("wakeflow-evidence-payload", `${errorPath}/files`, "every payload file parent must be inventoried");
    }
  }
  const totalBytes = value.files.reduce((sum, entry) => sum + entry.bytes, 0);
  assertInteger(value.totalBytes, `${errorPath}/totalBytes`, { maximum: 32 * 1024 * 1024 });
  if (value.totalBytes !== totalBytes) {
    fail("wakeflow-evidence-payload", `${errorPath}/totalBytes`, "payload totalBytes must equal the exact file inventory sum");
  }
  assertDigest(value.treeDigest, `${errorPath}/treeDigest`);
  const calculatedTreeDigest = canonicalJsonDigest(payloadTreeProjection(value));
  if (value.treeDigest !== calculatedTreeDigest) {
    fail("wakeflow-evidence-payload", `${errorPath}/treeDigest`, "payload treeDigest must close the exact directory and file inventory");
  }
  return frozenClone(value);
}

function validateArtifactRelation(value, errorPath) {
  assertExactKeys(value, ["kind", "artifactKind", "artifactId", "ref", "digest"], [], errorPath);
  const contract = ARTIFACT_RELATIONS[value.artifactKind];
  if (!contract) {
    fail("wakeflow-evidence-relation", `${errorPath}/artifactKind`, "relation artifactKind is not an admitted T05 artifact");
  }
  assertTypedId(value.artifactId, contract.idType, `${errorPath}/artifactId`);
  assertPortablePath(value.ref, `${errorPath}/ref`);
  const expectedRef = contract.ref(value.artifactId, value.ref);
  if (expectedRef === null || expectedRef !== value.ref) {
    fail("wakeflow-evidence-relation", `${errorPath}/ref`, "relation ref must be the exact canonical artifact ref");
  }
  assertDigest(value.digest, `${errorPath}/digest`);
  return value;
}

function validateRelation(value, errorPath) {
  assertPlainObject(value, errorPath);
  if (value.kind === "artifact") return validateArtifactRelation(value, errorPath);
  if (value.kind === "controller-event") {
    assertExactKeys(value, ["kind", "eventId", "digest"], [], errorPath);
    assertSafePortableMetadata(assertToken(value.eventId, `${errorPath}/eventId`), `${errorPath}/eventId`);
    assertDigest(value.digest, `${errorPath}/digest`);
    return value;
  }
  fail("wakeflow-evidence-relation", `${errorPath}/kind`, "relation kind must be artifact or controller-event");
}

/**
 * 校验一份immutable evidence manifest及其demand、Controller、source、privacy和relation绑定。
 * 通过只表示记录合同闭合，不表示source内容真实或需求已经验收。
 */
export function validateEvidenceManifest(value) {
  value = canonicalDataSnapshot(value);
  assertExactKeys(value, [
    "schemaVersion",
    "artifactKind",
    "programId",
    "demandId",
    "demandRef",
    "demandDigest",
    "evidenceId",
    "kind",
    "capturedAt",
    "recordedBy",
    "source",
    "sensitivity",
    "privacyScan",
    "relations",
  ], ["controllerReviewedOpaque", "payload"], "$" );
  if (value.schemaVersion !== WAKEFLOW_EVIDENCE_SCHEMA_VERSION) {
    fail("wakeflow-evidence-schema", "$/schemaVersion", "evidence schemaVersion must be 1");
  }
  if (value.artifactKind !== WAKEFLOW_EVIDENCE_ARTIFACT_KIND) {
    fail("wakeflow-evidence-kind", "$/artifactKind", "artifactKind must be wakeflow-evidence");
  }
  assertTypedId(value.programId, "program", "$/programId");
  assertTypedId(value.demandId, "demand", "$/demandId");
  if (value.demandRef !== "demand.json") {
    fail("wakeflow-evidence-demand", "$/demandRef", "evidence demandRef must be demand.json");
  }
  assertDigest(value.demandDigest, "$/demandDigest");
  assertTypedId(value.evidenceId, "evidence", "$/evidenceId");
  assertSafePortableMetadata(assertToken(value.kind, "$/kind"), "$/kind");
  assertTimestamp(value.capturedAt, "$/capturedAt");
  assertExactKeys(value.recordedBy, ["windowId", "role", "configDigest"], [], "$/recordedBy");
  assertTypedId(value.recordedBy.windowId, "window", "$/recordedBy/windowId");
  if (value.recordedBy.role !== "controller") {
    fail("wakeflow-evidence-recorder", "$/recordedBy/role", "evidence recordedBy role must be controller");
  }
  assertDigest(value.recordedBy.configDigest, "$/recordedBy/configDigest");
  const source = validateEvidenceSource(value.source);
  if (!SENSITIVITY_SET.has(value.sensitivity)) {
    fail("wakeflow-evidence-sensitivity", "$/sensitivity", "sensitivity must be public or internal");
  }
  validatePrivacyScan(value.privacyScan, "$/privacyScan");
  if (Object.hasOwn(value, "controllerReviewedOpaque") && value.controllerReviewedOpaque !== true) {
    fail("wakeflow-evidence-content", "$/controllerReviewedOpaque", "controllerReviewedOpaque, when present, must be true");
  }
  if (!Array.isArray(value.relations) || value.relations.length > WAKEFLOW_EVIDENCE_MAX_RELATIONS) {
    fail("wakeflow-evidence-relation", "$/relations", "relations must be an array with at most 256 entries");
  }
  value.relations.forEach((entry, index) => validateRelation(entry, `$/relations/${index}`));
  assertSortedUnique(value.relations, "$/relations", (entry) => canonicalJson(entry));
  const hasPayload = Object.hasOwn(value, "payload");
  if ((source.kind === "managed-path") !== hasPayload) {
    fail("wakeflow-evidence-source", "$/payload", "managed source requires payload and locator-only source forbids payload");
  }
  if (source.kind !== "managed-path" && Object.hasOwn(value, "controllerReviewedOpaque")) {
    fail("wakeflow-evidence-content", "$/controllerReviewedOpaque", "locator-only evidence cannot claim opaque payload review");
  }
  if (hasPayload) {
    const payload = validateEvidencePayload(value.payload);
    const containsOpaque = payload.files.some((entry) => entry.contentClass !== "text/plain");
    if (containsOpaque && value.controllerReviewedOpaque !== true) {
      fail("wakeflow-evidence-content", "$/controllerReviewedOpaque", "binary payload requires explicit controllerReviewedOpaque=true");
    }
    if (source.expectedType === "file") {
      if (
        payload.directories.length !== 1
        || payload.directories[0] !== "payload"
        || payload.files.length !== 1
        || payload.files[0].path !== "payload/content"
        || payload.files[0].digest !== source.expectedDigest
      ) {
        fail("wakeflow-evidence-source", "$/payload", "file source payload must be exactly payload/content with the expected byte digest");
      }
    } else if (payload.treeDigest !== source.expectedDigest) {
      fail("wakeflow-evidence-source", "$/payload/treeDigest", "tree source expectedDigest must equal the exact payload tree digest");
    }
  }
  if (canonicalJsonBytes(value).length > WAKEFLOW_EVIDENCE_MAX_MANIFEST_BYTES) {
    fail(
      "wakeflow-evidence-file-limit",
      "$",
      "canonical evidence manifest exceeds the 1 MiB metadata limit",
    );
  }
  return frozenClone(value);
}

// ==================== 三、canonical identity与事务写入意图 ====================

/**
 * 返回由typed evidence ID唯一确定的state-root相对manifest ref。
 */
export function evidenceManifestRef(value) {
  const manifest = typeof value === "string"
    ? { evidenceId: assertTypedId(value, "evidence", "$evidenceId") }
    : validateEvidenceManifest(value);
  return `evidence/${manifest.evidenceId}/evidence.json`;
}

/**
 * 返回完整canonical manifest的内容摘要。
 */
export function evidenceManifestDigest(value) {
  return canonicalJsonDigest(validateEvidenceManifest(value));
}

/**
 * 序列化为磁盘唯一合法编码：canonical JSON加一个LF。
 */
export function evidenceManifestCanonicalBytes(value) {
  return Buffer.concat([
    canonicalJsonBytes(validateEvidenceManifest(value)),
    Buffer.from("\n", "utf8"),
  ]);
}

/**
 * 从manifest派生state/event/journal共同引用的immutable artifact identity。
 */
export function evidenceIdentity(value) {
  const manifest = validateEvidenceManifest(value);
  return deepFreeze({
    artifactKind: WAKEFLOW_EVIDENCE_ARTIFACT_KIND,
    artifactId: manifest.evidenceId,
    ref: evidenceManifestRef(manifest),
    digest: evidenceManifestDigest(manifest),
  });
}

/**
 * 校验目录artifact写入意图，并可选绑定同一份immutable demand identity。
 * 这里只关闭事务payload；create-only发布顺序由demand-state-service与evidence-tree执行。
 */
export function validateEvidenceWriteIntent(value, options = {}) {
  value = canonicalDataSnapshot(value);
  options = canonicalDataSnapshot(options, "$options");
  assertExactKeys(options, [], ["demand"], "$options");
  const { demand = null } = options;
  assertExactKeys(value, ["artifactKind", "artifactId", "ref", "digest", "value"], [], "$" );
  const manifest = validateEvidenceManifest(value.value);
  const identity = evidenceIdentity(manifest);
  for (const field of ["artifactKind", "artifactId", "ref", "digest"]) {
    if (value[field] !== identity[field]) {
      fail("wakeflow-evidence-write", `$/${field}`, `write ${field} must match the exact canonical evidence identity`);
    }
  }
  if (demand !== null && (
    manifest.programId !== demand.programId
    || manifest.demandId !== demand.demandId
    || manifest.demandRef !== "demand.json"
    || manifest.demandDigest !== canonicalJsonDigest(demand)
  )) {
    fail("wakeflow-evidence-demand", "$/value", "evidence must bind the exact immutable demand identity");
  }
  return frozenClone(value);
}

function pathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

// ==================== 四、私有目录与有界稳定读取 ====================

function currentEffectiveUid() {
  if (process.platform === "win32" || typeof process.geteuid !== "function") return null;
  return BigInt(process.geteuid());
}

function permissionBits(stat) {
  return Number(stat.mode & 0o777n);
}

function nodeOwnedByCurrentUser(stat) {
  const expectedUid = currentEffectiveUid();
  return expectedUid === null || stat.uid === expectedUid;
}

function sameStableNode(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.uid === right.uid
    && left.gid === right.gid
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

// 目录枚举前后复验同一current-owner私有节点，避免把路径替换后的内容当作原目录事实。
function inspectPrivateDirectory(directory, errorPath, { allowMissing = false } = {}) {
  let before;
  try {
    before = lstatSync(directory, { bigint: true });
  } catch (cause) {
    if (allowMissing && cause?.code === "ENOENT") return null;
    fail("wakeflow-evidence-directory", errorPath, "required evidence directory is missing or unreadable", {}, cause);
  }
  if (
    before.isSymbolicLink()
    || !before.isDirectory()
    || (process.platform !== "win32" && permissionBits(before) !== 0o700)
    || !nodeOwnedByCurrentUser(before)
  ) {
    fail(
      "wakeflow-evidence-directory",
      errorPath,
      "evidence directories must be current-owner real directories with mode 0700",
    );
  }
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (cause) {
    fail("wakeflow-evidence-directory", errorPath, "evidence directory is unreadable", {}, cause);
  }
  let after;
  try {
    after = lstatSync(directory, { bigint: true });
  } catch (cause) {
    fail("wakeflow-evidence-directory-race", errorPath, "evidence directory changed while reading", {}, cause);
  }
  if (
    after.isSymbolicLink()
    || !after.isDirectory()
    || !nodeOwnedByCurrentUser(after)
    || !sameStableNode(before, after)
  ) {
    fail("wakeflow-evidence-directory-race", errorPath, "evidence directory changed while reading");
  }
  return entries.sort((left, right) => lexicalCompare(left.name, right.name));
}

function inspectStateRoot(stateRoot) {
  if (typeof stateRoot !== "string" || !stateRoot.trim()) {
    fail("wakeflow-evidence-root", "$stateRoot", "stateRoot must be a non-empty path");
  }
  const root = path.resolve(stateRoot);
  inspectPrivateDirectory(root, "$stateRoot");
  let before;
  let real;
  let after;
  try {
    before = lstatSync(root, { bigint: true });
    real = realpathSync(root);
    after = lstatSync(root, { bigint: true });
  } catch (cause) {
    fail("wakeflow-evidence-root-race", "$stateRoot", "stateRoot changed while resolving", {}, cause);
  }
  if (
    before.isSymbolicLink()
    || !before.isDirectory()
    || !nodeOwnedByCurrentUser(before)
    || !sameStableNode(before, after)
  ) {
    fail("wakeflow-evidence-root-race", "$stateRoot", "stateRoot changed while resolving");
  }
  return Object.freeze({ root, real });
}

function readBoundedPrivateFile(descriptor, maximumBytes, errorPath) {
  const chunks = [];
  let total = 0;
  while (true) {
    const remaining = maximumBytes + 1 - total;
    if (remaining <= 0) {
      fail("wakeflow-evidence-file-limit", errorPath, "evidence file exceeds its fixed byte limit");
    }
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
    const bytesRead = readSync(descriptor, chunk, 0, chunk.length, null);
    if (bytesRead === 0) break;
    chunks.push(chunk.subarray(0, bytesRead));
    total += bytesRead;
  }
  if (total > maximumBytes) {
    fail("wakeflow-evidence-file-limit", errorPath, "evidence file exceeds its fixed byte limit");
  }
  return Buffer.concat(chunks, total);
}

function safeReadPrivateFile(file, errorPath, { maximumBytes = WAKEFLOW_EVIDENCE_MAX_MANIFEST_BYTES } = {}) {
  let before;
  try {
    before = lstatSync(file, { bigint: true });
  } catch (cause) {
    fail("wakeflow-evidence-file", errorPath, "evidence manifest is missing or unreadable", {}, cause);
  }
  if (
    before.isSymbolicLink()
    || !before.isFile()
    || before.nlink !== 1n
    || (process.platform !== "win32" && permissionBits(before) !== 0o600)
    || !nodeOwnedByCurrentUser(before)
    || before.size > BigInt(maximumBytes)
  ) {
    fail(
      "wakeflow-evidence-file",
      errorPath,
      "evidence files must be current-owner single-link regular files with mode 0600",
    );
  }
  let descriptor;
  try {
    descriptor = openSync(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (cause) {
    fail("wakeflow-evidence-file-race", errorPath, "evidence file changed before safe open", {}, cause);
  }
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (
      !opened.isFile()
      || opened.nlink !== 1n
      || (process.platform !== "win32" && permissionBits(opened) !== 0o600)
      || !nodeOwnedByCurrentUser(opened)
      || !sameStableNode(opened, before)
      || opened.size > BigInt(maximumBytes)
    ) {
      fail("wakeflow-evidence-file-race", errorPath, "evidence file changed while opening");
    }
    const bytes = readBoundedPrivateFile(descriptor, maximumBytes, errorPath);
    let afterDescriptor;
    let afterPath;
    try {
      afterDescriptor = fstatSync(descriptor, { bigint: true });
      afterPath = lstatSync(file, { bigint: true });
    } catch (cause) {
      fail("wakeflow-evidence-file-race", errorPath, "evidence file changed while reading", {}, cause);
    }
    if (
      afterPath.isSymbolicLink()
      || !afterPath.isFile()
      || afterPath.nlink !== 1n
      || (process.platform !== "win32" && permissionBits(afterPath) !== 0o600)
      || !nodeOwnedByCurrentUser(afterPath)
      || !sameStableNode(opened, afterDescriptor)
      || !sameStableNode(afterDescriptor, afterPath)
      || afterDescriptor.size !== BigInt(bytes.length)
    ) {
      fail("wakeflow-evidence-file-race", errorPath, "evidence file changed while reading");
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

function validateManifestRef(ref) {
  assertPortablePath(ref, "$ref");
  const match = ref.match(/^evidence\/(evidence_[^/]+)\/evidence\.json$/u);
  if (!match) fail("wakeflow-evidence-ref", "$ref", "evidence ref must be evidence/{evidenceId}/evidence.json");
  assertTypedId(match[1], "evidence", "$ref");
  return match[1];
}

function normalizeEvidenceLoadInput(input, errorPath = "$input") {
  input = canonicalDataSnapshot(input, errorPath);
  assertExactKeys(input, ["stateRoot", "ref"], [
    "digest",
    "expectedEvidenceId",
    "expectedProgramId",
    "expectedDemandId",
    "expectedDemandDigest",
  ], errorPath);
  return input;
}

// ==================== 五、strict manifest与portable member读取 ====================

/**
 * 从显式stateRoot/ref读取一份完整受管证据根，复验canonical manifest、identity、
 * demand/config期望及evidence-tree所证明的最终目录闭包。
 */
export function loadManagedEvidenceByRef(input = {}) {
  input = normalizeEvidenceLoadInput(input);
  const {
    stateRoot,
    ref,
    digest = null,
    expectedEvidenceId = null,
    expectedProgramId = null,
    expectedDemandId = null,
    expectedDemandDigest = null,
  } = input;
  const refEvidenceId = validateManifestRef(ref);
  const rootInfo = inspectStateRoot(stateRoot);
  const evidenceDirectory = path.join(rootInfo.root, "evidence");
  inspectPrivateDirectory(evidenceDirectory, "$ref/evidence");
  const artifactDirectory = path.join(evidenceDirectory, refEvidenceId);
  inspectPrivateDirectory(artifactDirectory, "$ref/root");
  if (!pathInside(rootInfo.real, realpathSync(artifactDirectory))) {
    fail("wakeflow-evidence-ref", "$ref", "evidence root resolves outside stateRoot");
  }
  const file = path.join(artifactDirectory, "evidence.json");
  const bytes = safeReadPrivateFile(file, "$ref/evidence.json");
  let raw;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (cause) {
    fail("wakeflow-evidence-json", "$ref", "evidence manifest must be valid UTF-8 JSON", {}, cause);
  }
  const manifest = validateEvidenceManifest(raw);
  const canonicalBytes = evidenceManifestCanonicalBytes(manifest);
  if (!bytes.equals(canonicalBytes)) {
    fail("wakeflow-evidence-encoding", "$ref", "evidence manifest must use canonical JSON plus one LF");
  }
  const identity = evidenceIdentity(manifest);
  if (identity.ref !== ref || identity.artifactId !== refEvidenceId) {
    fail("wakeflow-evidence-ref", "$ref", "manifest bytes require a different canonical evidence ref");
  }
  if (digest !== null) {
    assertDigest(digest, "$digest");
    if (identity.digest !== digest) {
      fail("wakeflow-evidence-digest", "$digest", "evidence manifest digest does not match exact canonical bytes");
    }
  }
  if (expectedEvidenceId !== null) {
    assertTypedId(expectedEvidenceId, "evidence", "$expectedEvidenceId");
    if (identity.artifactId !== expectedEvidenceId) {
      fail("wakeflow-evidence-id", "$expectedEvidenceId", "loaded evidence has another evidence ID");
    }
  }
  if (expectedProgramId !== null) {
    assertTypedId(expectedProgramId, "program", "$expectedProgramId");
    if (manifest.programId !== expectedProgramId) {
      fail("wakeflow-evidence-program", "$/programId", "loaded evidence belongs to another program");
    }
  }
  if (expectedDemandId !== null) {
    assertTypedId(expectedDemandId, "demand", "$expectedDemandId");
    if (manifest.demandId !== expectedDemandId) {
      fail("wakeflow-evidence-demand", "$/demandId", "loaded evidence belongs to another demand");
    }
  }
  if (expectedDemandDigest !== null) {
    assertDigest(expectedDemandDigest, "$expectedDemandDigest");
    if (manifest.demandDigest !== expectedDemandDigest) {
      fail("wakeflow-evidence-demand", "$/demandDigest", "loaded evidence binds another immutable demand digest");
    }
  }
  const write = validateEvidenceWriteIntent({ ...identity, value: manifest });
  const tree = inspectEvidenceFinalWrite({ stateRoot: rootInfo.root, write });
  return Object.freeze({
    manifest,
    record: manifest,
    identity,
    ref,
    bytes: Buffer.from(bytes),
    byteDigest: `sha256:${sha256Bytes(bytes)}`,
    tree,
  });
}

/**
 * 返回一份证据根的完整portable member bytes。
 * 首次load关闭manifest/tree，每个payload成员再按no-follow、single-link和容量上限读取，
 * 最后重放strict load关闭跨多文件采集竞态；Buffer均为调用方可独立持有的防御副本。
 */
export function loadManagedEvidencePortableMembers(options = {}) {
  options = normalizeEvidenceLoadInput(options, "$options");
  const loaded = loadManagedEvidenceByRef(options);
  const rootInfo = inspectStateRoot(options.stateRoot);
  const artifactRef = path.posix.dirname(loaded.ref);
  const artifactDirectory = path.join(rootInfo.root, ...artifactRef.split("/"));
  const members = [Object.freeze({
    ref: loaded.ref,
    bytes: Buffer.from(loaded.bytes),
    byteDigest: loaded.byteDigest,
  })];

  for (const inventory of loaded.manifest.payload?.files ?? []) {
    const memberRef = `${artifactRef}/${inventory.path}`;
    const memberFile = path.join(artifactDirectory, ...inventory.path.split("/"));
    const bytes = safeReadPrivateFile(memberFile, `$ref/${inventory.path}`, {
      maximumBytes: inventory.bytes,
    });
    const byteDigest = `sha256:${sha256Bytes(bytes)}`;
    if (bytes.length !== inventory.bytes || byteDigest !== inventory.digest) {
      fail(
        "wakeflow-evidence-tree-tamper",
        `$ref/${inventory.path}`,
        "evidence payload bytes differ from the immutable manifest inventory",
      );
    }
    members.push(Object.freeze({
      ref: memberRef,
      bytes: Buffer.from(bytes),
      byteDigest,
    }));
  }
  members.sort((left, right) => lexicalCompare(left.ref, right.ref));

  const replay = loadManagedEvidenceByRef({
    ...options,
    ref: loaded.ref,
    digest: loaded.identity.digest,
    expectedEvidenceId: loaded.identity.artifactId,
    expectedProgramId: loaded.manifest.programId,
    expectedDemandId: loaded.manifest.demandId,
    expectedDemandDigest: loaded.manifest.demandDigest,
  });
  if (!replay.bytes.equals(loaded.bytes) || canonicalJson(replay.tree) !== canonicalJson(loaded.tree)) {
    fail(
      "wakeflow-evidence-file-race",
      "$ref",
      "evidence root changed across portable member capture",
    );
  }
  return Object.freeze(members);
}

function normalizeExpectedEvidence(value, index) {
  const errorPath = `$expectedEvidence/${index}`;
  assertPlainObject(value, errorPath);
  const isStateTuple = Object.hasOwn(value, "evidenceId");
  if (isStateTuple) {
    assertExactKeys(value, ["evidenceId", "ref", "digest"], [], errorPath);
    assertTypedId(value.evidenceId, "evidence", `${errorPath}/evidenceId`);
    validateManifestRef(value.ref);
    assertDigest(value.digest, `${errorPath}/digest`);
    const expectedRef = `evidence/${value.evidenceId}/evidence.json`;
    if (value.ref !== expectedRef) {
      fail("wakeflow-evidence-ref", `${errorPath}/ref`, "expected evidence tuple must use its canonical ref");
    }
    return Object.freeze({
      artifactKind: WAKEFLOW_EVIDENCE_ARTIFACT_KIND,
      artifactId: value.evidenceId,
      ref: value.ref,
      digest: value.digest,
    });
  }
  assertExactKeys(value, ["artifactKind", "artifactId", "ref", "digest"], [], errorPath);
  if (value.artifactKind !== WAKEFLOW_EVIDENCE_ARTIFACT_KIND) {
    fail("wakeflow-evidence-kind", `${errorPath}/artifactKind`, "expected inventory artifactKind must be wakeflow-evidence");
  }
  assertTypedId(value.artifactId, "evidence", `${errorPath}/artifactId`);
  validateManifestRef(value.ref);
  assertDigest(value.digest, `${errorPath}/digest`);
  if (value.ref !== `evidence/${value.artifactId}/evidence.json`) {
    fail("wakeflow-evidence-ref", `${errorPath}/ref`, "expected evidence identity must use its canonical ref");
  }
  return frozenClone(value);
}

function inventoryIssue(ref, classification, code) {
  return Object.freeze({ ref, classification, code });
}

function opaqueInventoryChildRef(capabilityRootRef, basename) {
  const digest = sha256Bytes(Buffer.from(basename, "utf8"));
  return `${capabilityRootRef}unknown-sha256-${digest}`;
}

// ==================== 六、event期望与evidence capability诊断 ====================

/**
 * 枚举evidence capability并把每个root分类为committed、orphan、missing、incomplete或invalid。
 * 输出只包含portable ref与稳定code；inventory不会采用孤儿、修复目录或决定其业务价值。
 */
export function inspectManagedEvidenceInventory(input = {}) {
  input = canonicalDataSnapshot(input, "$input");
  assertExactKeys(input, ["stateRoot"], [
    "expectedProgramId",
    "expectedDemandId",
    "expectedDemandDigest",
    "expectedEvidence",
  ], "$input");
  const {
    stateRoot,
    expectedProgramId = null,
    expectedDemandId = null,
    expectedDemandDigest = null,
    expectedEvidence = [],
  } = input;
  const rootInfo = inspectStateRoot(stateRoot);
  if (expectedProgramId !== null) assertTypedId(expectedProgramId, "program", "$expectedProgramId");
  if (expectedDemandId !== null) assertTypedId(expectedDemandId, "demand", "$expectedDemandId");
  if (expectedDemandDigest !== null) assertDigest(expectedDemandDigest, "$expectedDemandDigest");
  if (!Array.isArray(expectedEvidence)) {
    fail("wakeflow-evidence-inventory", "$expectedEvidence", "expectedEvidence must be an array");
  }
  const expected = expectedEvidence.map(normalizeExpectedEvidence);
  assertSortedUnique(expected, "$expectedEvidence", (entry) => entry.ref);
  const expectedByRef = new Map(expected.map((entry) => [entry.ref, entry]));
  const entries = [];
  const issues = [];
  const observedRefs = new Set();
  const evidenceRoot = path.join(rootInfo.root, "evidence");
  let directoryEntries;
  try {
    directoryEntries = inspectPrivateDirectory(evidenceRoot, "$stateRoot/evidence");
  } catch {
    issues.push(inventoryIssue(
      "evidence/",
      "invalid",
      "wakeflow-evidence-inventory-capability-root-failure",
    ));
    directoryEntries = [];
  }
  for (const entry of directoryEntries) {
    if (/^\.evidence_[^/]+\.wakeflow-stage$/u.test(entry.name)) {
      issues.push(inventoryIssue(`evidence/${entry.name}`, "incomplete", "wakeflow-evidence-inventory-stage-residue"));
      continue;
    }
    let evidenceId;
    try {
      evidenceId = assertTypedId(entry.name, "evidence", "$inventoryEntry");
    } catch {
      issues.push(inventoryIssue(
        opaqueInventoryChildRef("evidence/", entry.name),
        "invalid",
        "wakeflow-evidence-inventory-unknown-entry",
      ));
      continue;
    }
    const ref = `evidence/${evidenceId}/evidence.json`;
    observedRefs.add(ref);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      issues.push(inventoryIssue(ref, "invalid", "wakeflow-evidence-inventory-root-type"));
      continue;
    }
    try {
      const loaded = loadManagedEvidenceByRef({
        stateRoot: rootInfo.root,
        ref,
        expectedProgramId,
        expectedDemandId,
        expectedDemandDigest,
      });
      const expectedIdentity = expectedByRef.get(ref) ?? null;
      if (expectedIdentity && (
        expectedIdentity.artifactId !== loaded.identity.artifactId
        || expectedIdentity.digest !== loaded.identity.digest
      )) {
        issues.push(inventoryIssue(ref, "conflict", "wakeflow-evidence-inventory-conflict"));
        continue;
      }
      entries.push(Object.freeze({
        ...loaded.identity,
        classification: expectedIdentity ? "committed" : "orphan",
      }));
      if (!expectedIdentity) {
        issues.push(inventoryIssue(ref, "orphan", "wakeflow-evidence-inventory-orphan"));
      }
    } catch (cause) {
      issues.push(inventoryIssue(ref, "invalid", cause?.code ?? "wakeflow-evidence-inventory-invalid"));
    }
  }
  for (const identity of expected) {
    if (!observedRefs.has(identity.ref)) {
      issues.push(inventoryIssue(identity.ref, "missing", "wakeflow-evidence-inventory-missing"));
    }
  }
  entries.sort((left, right) => lexicalCompare(left.ref, right.ref));
  issues.sort((left, right) => lexicalCompare(`${left.ref}\u0000${left.code}`, `${right.ref}\u0000${right.code}`));
  return Object.freeze({
    healthy: issues.length === 0,
    entries: Object.freeze(entries),
    issues: Object.freeze(issues),
    expectedCount: expected.length,
    observedCount: observedRefs.size,
  });
}
