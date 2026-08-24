import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
  readSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  assertBusinessArchivePortable,
} from "./wakeflow-business-archive-records.mjs";
import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import { loadWakeflowConfigV3Snapshot } from "./wakeflow-config-v3-snapshot.mjs";
import {
  parseWakeflowConfigV3,
  wakeflowConfigV3Digest,
} from "./wakeflow-config-v3.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import { validateWakeflowConfigRootPlacements } from "./wakeflow-layout-descriptor.mjs";
import {
  createLedgerMigrationArchiveRecord,
  ledgerRecordRelativeRoot,
  loadLedgerRecord,
  validateLedgerRecord,
} from "./wakeflow-ledger-records.mjs";
import {
  validateWakeflowLegacyEvidenceFact,
  validateWakeflowLegacyEvidenceSummary,
  validateWakeflowLegacyTransportSummary,
  wakeflowLegacyArchiveCanonicalBytes,
} from "./wakeflow-legacy-archive-records.mjs";
import {
  WAKEFLOW_LEGACY_ARCHIVE_IMPORT_INVENTORY_KIND,
  WAKEFLOW_LEGACY_ARCHIVE_IMPORT_INVENTORY_SCHEMA_VERSION,
  inspectWakeflowLegacyArchiveImportInventory,
  validateWakeflowLegacyArchiveImportInventory,
} from "./wakeflow-legacy-owner-drain.mjs";
import {
  inspectWakeflowMigrationInventory,
} from "./wakeflow-migration-inventory.mjs";
import {
  WAKEFLOW_LEGACY_ARCHIVE_TRANSFORM_OWNER_RESOLUTION_KIND,
  WAKEFLOW_LEGACY_ARCHIVE_TRANSFORM_OWNER_RESOLUTION_SCHEMA_VERSION,
  validateWakeflowLegacyArchiveTransformOwnerResolution,
} from "./wakeflow-migration-plan.mjs";
import {
  createMigrationSourceRetainedPreservationParticipant,
  planMigrationSourceRetainedPreservation,
} from "./wakeflow-preservation.mjs";

// 本模块是T08 legacy archive migration-only owner：它把T06已验证的legacy archive
// source-set转换为portable BusinessArchive wrapper，并把不可携带原始字节交给preservation
// owner保留。它不发现legacy owner、不选择T05动作、不删除source，也不拥有M3 journal。
// 当前production migration仍阻断archive cohort；本文件提供的是已验证但尚未接入bootstrap的owner层。

export const WAKEFLOW_LEGACY_ARCHIVE_TRANSFORM_PLAN_SCHEMA_ID =
  "urn:wakeflow:internal:migration:legacy-archive-transform-plan:v1";
export const WAKEFLOW_LEGACY_ARCHIVE_TRANSFORM_PLAN_KIND =
  "WakeflowLegacyArchiveTransformPlan";
export const WAKEFLOW_LEGACY_ARCHIVE_TRANSFORM_PLAN_SCHEMA_VERSION = 1;

const SOURCE_DESCRIPTOR_KIND = "wakeflow-legacy-demand-archive-source";
const CHECKPOINT_SCHEMA_ID =
  "urn:wakeflow:internal:migration:legacy-archive-publish-checkpoint:v1";
const RESULT_SCHEMA_ID =
  "urn:wakeflow:internal:migration:legacy-archive-publish-result:v1";
const OUTCOME_SCHEMA_ID =
  "urn:wakeflow:internal:migration:legacy-archive-publish-outcome:v1";
const EFFECT_KIND = "migration-legacy-archive-publish";
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const TOKEN_RE = /^[a-z][a-z0-9-]{0,127}$/u;
const YEAR_MONTH_RE = /^[0-9]{4}-(?:0[1-9]|1[0-2])$/u;
const TIMESTAMP_RE = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(?:\.([0-9]{1,9}))?Z$/u;
const SOURCE_KINDS = new Set(["pod-close", "pod-materialization", "pod-test-access"]);
const MAX_ARCHIVE_SOURCE_DEPTH = 128;
const MAX_ARCHIVE_SOURCE_ENTRIES = 100_000;
const MAX_ARCHIVE_SOURCE_FILES = 20_000;
const MAX_ARCHIVE_SOURCE_BYTES = 256 * 1024 * 1024;
const MAX_PRESERVED_REVIEW_AFTER_DAYS = 36_500;

export class WakeflowLegacyArchiveTransformError extends Error {
  constructor(code, message, { details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowLegacyArchiveTransformError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

// ==================== 一、领域错误、strict data与基础词汇 ====================

function fail(code, message, details = {}, cause = undefined) {
  throw new WakeflowLegacyArchiveTransformError(code, message, { details, cause });
}

function boundary(operation, label) {
  try {
    return operation();
  } catch (cause) {
    if (cause instanceof WakeflowLegacyArchiveTransformError) throw cause;
    const causeCode = typeof cause?.code === "string" && TOKEN_RE.test(cause.code)
      ? cause.code
      : "unknown";
    const code = causeCode.includes("privacy")
      ? "wakeflow-legacy-archive-transform-privacy"
      : causeCode.includes("stale") || causeCode.includes("changed") || causeCode.includes("race")
        ? "wakeflow-legacy-archive-transform-stale"
        : causeCode.includes("conflict") || causeCode.includes("stage") || causeCode.includes("recovery")
          ? "wakeflow-legacy-archive-transform-recovery"
          : "wakeflow-legacy-archive-transform-authority";
    throw new WakeflowLegacyArchiveTransformError(
      code,
      `legacy archive transform ${label} failed closed`,
      { details: { causeCode }, cause },
    );
  }
}

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactFields(value, required, optional, label) {
  if (!plainObject(value)) {
    fail("wakeflow-legacy-archive-transform-contract", `${label} must be one plain data object`);
  }
  const allowed = new Set([...required, ...optional]);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    fail("wakeflow-legacy-archive-transform-contract", `${label} cannot contain symbol fields`);
  }
  for (const key of keys) {
    if (!allowed.has(key)) {
      fail("wakeflow-legacy-archive-transform-contract", `${label} contains an unknown field`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-legacy-archive-transform-contract", `${label} fields must be enumerable data fields`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail("wakeflow-legacy-archive-transform-contract", `${label} is missing a required field`);
    }
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value) || Buffer.isBuffer(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function cloneFrozen(value) {
  try {
    return deepFreeze(JSON.parse(canonicalJson(value)));
  } catch (cause) {
    fail(
      "wakeflow-legacy-archive-transform-contract",
      "legacy archive transform values must be canonical passive data",
      {},
      cause,
    );
  }
}

function sameCanonical(left, right) {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail("wakeflow-legacy-archive-transform-contract", `${label} must be one canonical SHA-256 digest`);
  }
  return value;
}

function token(value, label) {
  if (typeof value !== "string" || !TOKEN_RE.test(value)) {
    fail("wakeflow-legacy-archive-transform-contract", `${label} must be one bounded token`);
  }
  return value;
}

function timestamp(value, label) {
  const match = typeof value === "string" ? TIMESTAMP_RE.exec(value) : null;
  if (!match) {
    fail("wakeflow-legacy-archive-transform-contract", `${label} must be one strict UTC timestamp`);
  }
  const milliseconds = Date.parse(value);
  const date = new Date(milliseconds);
  if (
    !Number.isFinite(milliseconds)
    || date.getUTCFullYear() !== Number(match[1])
    || date.getUTCMonth() + 1 !== Number(match[2])
    || date.getUTCDate() !== Number(match[3])
    || date.getUTCHours() !== Number(match[4])
    || date.getUTCMinutes() !== Number(match[5])
    || date.getUTCSeconds() !== Number(match[6])
  ) {
    fail("wakeflow-legacy-archive-transform-contract", `${label} is not one real instant`);
  }
  return value;
}

function typedId(value, type, label) {
  try {
    return assertWakeflowId(value, type, label);
  } catch {
    fail("wakeflow-legacy-archive-transform-contract", `${label} must be one typed ${type} ID`);
  }
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalLine(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function denseArray(value, label) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail("wakeflow-legacy-archive-transform-contract", `${label} must be one dense array`);
  }
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  const slots = [];
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)) {
      fail(
        "wakeflow-legacy-archive-transform-contract",
        `${label} cannot contain authority outside dense slots`,
      );
    }
    const index = Number(key);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !Number.isSafeInteger(index)
      || index >= length
      || !descriptor?.enumerable
      || !Object.hasOwn(descriptor, "value")
    ) {
      fail(
        "wakeflow-legacy-archive-transform-contract",
        `${label} slots must be enumerable data fields`,
      );
    }
    slots.push(index);
  }
  slots.sort((left, right) => left - right);
  if (
    !Number.isSafeInteger(length)
    || length < 0
    || slots.length !== length
    || slots.some((index, position) => index !== position)
  ) {
    fail("wakeflow-legacy-archive-transform-contract", `${label} must be one dense array`);
  }
  return value;
}

function assertSortedUnique(values, label, selector = (entry) => entry) {
  const keys = values.map(selector);
  const sorted = [...new Set(keys)].sort(lexicalCompare);
  if (!sameCanonical(keys, sorted)) {
    fail("wakeflow-legacy-archive-transform-order", `${label} must be unique and lexically ordered`);
  }
}

function normalizeWorkspaceRoot(value) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || !path.isAbsolute(value)
    || path.resolve(value) !== value
    || value.includes("\0")
  ) {
    fail(
      "wakeflow-legacy-archive-transform-contract",
      "workspaceRoot must be one normalized absolute path",
    );
  }
  return value;
}

// ==================== 二、用户确认的mapping与目标配置准入 ====================

function normalizeEvidenceDisposition(value, label) {
  exactFields(value, [
    "sourceKind",
    "sourceDigest",
    "rawDisposition",
    "preservationId",
  ], [], label);
  if (!SOURCE_KINDS.has(value.sourceKind)) {
    fail("wakeflow-legacy-archive-transform-contract", `${label}.sourceKind is unsupported`);
  }
  digest(value.sourceDigest, `${label}.sourceDigest`);
  if (!new Set(["preserved", "release-after-wrapper"]).has(value.rawDisposition)) {
    fail("wakeflow-legacy-archive-transform-contract", `${label}.rawDisposition is unsupported`);
  }
  if (value.rawDisposition === "preserved") {
    typedId(value.preservationId, "preservation", `${label}.preservationId`);
  } else if (value.preservationId !== null) {
    fail(
      "wakeflow-legacy-archive-transform-contract",
      `${label}.preservationId must be null for release-after-wrapper`,
    );
  }
  return cloneFrozen(value);
}

function normalizeArchiveMapping(value, index) {
  const label = `archiveMappings/${index}`;
  exactFields(value, [
    "archiveImportId",
    "demandId",
    "archiveId",
    "yearMonth",
    "rawPayloadDisposition",
    "rawPayloadPreservationId",
    "evidenceDispositions",
  ], [], label);
  digest(value.archiveImportId, `${label}.archiveImportId`);
  typedId(value.demandId, "demand", `${label}.demandId`);
  typedId(value.archiveId, "archive", `${label}.archiveId`);
  if (typeof value.yearMonth !== "string" || !YEAR_MONTH_RE.test(value.yearMonth)) {
    fail("wakeflow-legacy-archive-transform-contract", `${label}.yearMonth must be YYYY-MM`);
  }
  if (!new Set(["portable", "preserved"]).has(value.rawPayloadDisposition)) {
    fail("wakeflow-legacy-archive-transform-contract", `${label}.rawPayloadDisposition is invalid`);
  }
  if (value.rawPayloadDisposition === "preserved") {
    typedId(
      value.rawPayloadPreservationId,
      "preservation",
      `${label}.rawPayloadPreservationId`,
    );
  } else if (value.rawPayloadPreservationId !== null) {
    fail(
      "wakeflow-legacy-archive-transform-contract",
      `${label}.rawPayloadPreservationId must be null for portable payload`,
    );
  }
  const evidenceDispositions = denseArray(
    value.evidenceDispositions,
    `${label}.evidenceDispositions`,
  ).map((entry, dispositionIndex) => normalizeEvidenceDisposition(
    entry,
    `${label}.evidenceDispositions/${dispositionIndex}`,
  ));
  assertSortedUnique(
    evidenceDispositions,
    `${label}.evidenceDispositions`,
    (entry) => `${entry.sourceKind}\0${entry.sourceDigest}`,
  );
  return deepFreeze({ ...value, evidenceDispositions });
}

function normalizePreservationMapping(value, index) {
  const label = `preservationMappings/${index}`;
  exactFields(value, ["sourceId", "preservationId", "reasonCode"], [], label);
  digest(value.sourceId, `${label}.sourceId`);
  typedId(value.preservationId, "preservation", `${label}.preservationId`);
  token(value.reasonCode, `${label}.reasonCode`);
  return cloneFrozen(value);
}

function normalizeRequest(value) {
  exactFields(value, [
    "migrationId",
    "createdAt",
    "archiveMappings",
    "preservationMappings",
  ], [], "legacy archive transform request");
  const migrationId = token(value.migrationId, "migrationId");
  const createdAt = timestamp(value.createdAt, "createdAt");
  const archiveMappings = denseArray(value.archiveMappings, "archiveMappings")
    .map(normalizeArchiveMapping);
  const preservationMappings = denseArray(value.preservationMappings, "preservationMappings")
    .map(normalizePreservationMapping);
  assertSortedUnique(archiveMappings, "archiveMappings", (entry) => entry.archiveImportId);
  assertSortedUnique(preservationMappings, "preservationMappings", (entry) => entry.sourceId);
  if (new Set(archiveMappings.map((entry) => entry.archiveId)).size !== archiveMappings.length) {
    fail("wakeflow-legacy-archive-transform-contract", "archive mappings reuse one archive ID");
  }
  if (new Set(archiveMappings.map((entry) => entry.demandId)).size !== archiveMappings.length) {
    fail("wakeflow-legacy-archive-transform-contract", "archive mappings reuse one demand ID");
  }
  if (
    new Set(preservationMappings.map((entry) => entry.preservationId)).size
    !== preservationMappings.length
  ) {
    fail("wakeflow-legacy-archive-transform-contract", "preservation mappings reuse one preservation ID");
  }
  return deepFreeze({ migrationId, createdAt, archiveMappings, preservationMappings });
}

function normalizePlanInput(input) {
  exactFields(input, [
    "workspaceRoot",
    "expectedProgramId",
    "legacyOwnerArtifact",
    "desiredModel",
    "migrationId",
    "createdAt",
    "archiveMappings",
    "preservationMappings",
  ], [], "legacy archive transform plan input");
  const workspaceRoot = normalizeWorkspaceRoot(input.workspaceRoot);
  const expectedProgramId = typedId(
    input.expectedProgramId,
    "program",
    "expectedProgramId",
  );
  let desiredModel;
  try {
    desiredModel = parseWakeflowConfigV3(input.desiredModel);
    validateWakeflowConfigRootPlacements({ workspaceRoot, model: desiredModel });
  } catch (cause) {
    fail(
      "wakeflow-legacy-archive-transform-contract",
      "desiredModel must be one valid v3 target for this workspace",
      {},
      cause,
    );
  }
  if (desiredModel.program.programId !== expectedProgramId) {
    fail(
      "wakeflow-legacy-archive-transform-contract",
      "desiredModel belongs to another program",
    );
  }
  const preservedReviewAfterDays = desiredModel.governance?.audit?.preservedReviewAfterDays;
  if (
    !Number.isSafeInteger(preservedReviewAfterDays)
    || preservedReviewAfterDays < 1
    || preservedReviewAfterDays > MAX_PRESERVED_REVIEW_AFTER_DAYS
  ) {
    fail(
      "wakeflow-legacy-archive-transform-contract",
      "desiredModel has no valid preservation review policy",
    );
  }
  return Object.freeze({
    workspaceRoot,
    expectedProgramId,
    legacyOwnerArtifact: input.legacyOwnerArtifact,
    target: deepFreeze({
      programId: expectedProgramId,
      configDigest: wakeflowConfigV3Digest(desiredModel),
      ledgerRootRef: desiredModel.storage.ledgerRoot,
      preservedReviewAfterDays,
    }),
    request: normalizeRequest({
      migrationId: input.migrationId,
      createdAt: input.createdAt,
      archiveMappings: input.archiveMappings,
      preservationMappings: input.preservationMappings,
    }),
  });
}

function sourceById(inventory, sourceId, label) {
  const matches = inventory.sources.filter((source) => source.sourceId === sourceId);
  if (matches.length !== 1) {
    fail("wakeflow-legacy-archive-transform-source", `${label} is not one exact migration source`);
  }
  return matches[0];
}

// ==================== 三、T06 source authority的稳定有界物理复查 ====================

function portableSourceRefDigest(source, label) {
  if (typeof source?.path !== "string" || source.path.length < 1) {
    fail("wakeflow-legacy-archive-transform-source", `${label} has no portable source ref`);
  }
  return sha256(Buffer.from(source.path, "utf8"));
}

function portableSourceRef(value, label) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.startsWith("/")
    || value.includes("\\")
    || path.posix.normalize(value) !== value
    || value.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    fail("wakeflow-legacy-archive-transform-source", `${label} has no portable source ref`);
  }
  return value;
}

function assertPortableSourcePath(workspaceRoot, source, label) {
  const sourceRef = portableSourceRef(source.path, label);
  const absolute = path.resolve(workspaceRoot, ...sourceRef.split("/"));
  if (absolute === workspaceRoot || !absolute.startsWith(`${workspaceRoot}${path.sep}`)) {
    fail("wakeflow-legacy-archive-transform-source", `${label} escapes the workspace`);
  }
  return absolute;
}

function archiveSourceMemberId({ archiveSourceId, sourceRefDigest, digest: memberDigest, mode, size }) {
  return canonicalJsonDigest({
    archiveSourceId,
    sourceRefDigest,
    digest: memberDigest,
    mode,
    size,
  });
}

function modeString(stat) {
  return `0${Number(stat.mode & 0o777n).toString(8).padStart(3, "0")}`;
}

function safeNodeSize(stat, label) {
  if (stat.size < 0n || stat.size > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail("wakeflow-legacy-archive-transform-source", `${label} size is outside the safe range`);
  }
  return Number(stat.size);
}

function sameNodeSnapshot(left, right) {
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

// archive root自身由tree scanner复验；这里另外固定workspace到root父目录的ancestor链，
// 防止T04观察后用symlink或另一个目录替换中间路径。
function captureArchiveAncestorSnapshots(workspaceRoot, archiveRoot) {
  const segments = path.relative(workspaceRoot, archiveRoot).split(path.sep);
  segments.pop();
  const snapshots = [];
  let current = workspaceRoot;
  for (const segment of [null, ...segments]) {
    if (segment !== null) current = path.join(current, segment);
    const stat = lstatSync(current, { bigint: true });
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail("wakeflow-legacy-archive-transform-source", "legacy archive ancestor identity is unsafe");
    }
    snapshots.push({ file: current, stat });
  }
  return snapshots;
}

function assertArchiveAncestorsStable(snapshots) {
  for (const snapshot of snapshots) {
    const current = lstatSync(snapshot.file, { bigint: true });
    if (
      current.isSymbolicLink()
      || !current.isDirectory()
      || !sameNodeSnapshot(snapshot.stat, current)
    ) {
      fail("wakeflow-legacy-archive-transform-stale", "legacy archive ancestor changed while reading");
    }
  }
}

// 先以descriptor确认节点与剩余copy budget，再按已确认size读取并探测第size+1字节；
// 这样增长中的单文件也不能在拒绝前触发无界readFileSync分配。
function readExactArchiveFile(file, relativeRef, archiveSourceId, remainingBytes) {
  const before = lstatSync(file, { bigint: true });
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n) {
    fail("wakeflow-legacy-archive-transform-source", "legacy archive member identity is unsafe");
  }
  let descriptor;
  try {
    descriptor = openSync(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || !sameNodeSnapshot(before, opened)) {
      fail("wakeflow-legacy-archive-transform-source", "legacy archive member changed while opening");
    }
    const expectedSize = safeNodeSize(opened, "legacy archive member");
    if (expectedSize > remainingBytes) {
      fail("wakeflow-legacy-archive-transform-source", "legacy archive source exceeds its bounded copy budget");
    }
    const bytes = Buffer.allocUnsafe(expectedSize);
    let consumed = 0;
    while (consumed < expectedSize) {
      const count = readSync(descriptor, bytes, consumed, expectedSize - consumed, consumed);
      if (count === 0) break;
      consumed += count;
    }
    const overflowProbe = Buffer.allocUnsafe(1);
    const overflowBytes = readSync(descriptor, overflowProbe, 0, 1, expectedSize);
    const afterDescriptor = fstatSync(descriptor, { bigint: true });
    const after = lstatSync(file, { bigint: true });
    if (
      consumed !== expectedSize
      || overflowBytes !== 0
      || after.isSymbolicLink()
      || !after.isFile()
      || after.nlink !== 1n
      || !sameNodeSnapshot(opened, afterDescriptor)
      || !sameNodeSnapshot(afterDescriptor, after)
    ) {
      fail("wakeflow-legacy-archive-transform-stale", "legacy archive member changed while reading");
    }
    const memberDigest = sha256(bytes);
    const sourceRefDigest = sha256(Buffer.from(relativeRef, "utf8"));
    const mode = modeString(opened);
    return {
      sourceMemberId: archiveSourceMemberId({
        archiveSourceId,
        sourceRefDigest,
        digest: memberDigest,
        mode,
        size: expectedSize,
      }),
      sourceRefDigest,
      digest: memberDigest,
      mode,
      size: expectedSize,
      bytes,
    };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function inspectArchiveSourceMembers(
  workspaceRoot,
  root,
  forbiddenRoots,
  archiveSourceId = root.sourceId,
) {
  if (!Array.isArray(forbiddenRoots)) {
    fail("wakeflow-legacy-archive-transform-contract", "archive privacy roots are invalid");
  }
  const archiveRoot = assertPortableSourcePath(workspaceRoot, root, "legacy archive root");
  const ancestorSnapshots = captureArchiveAncestorSnapshots(workspaceRoot, archiveRoot);
  const files = [];
  let totalBytes = 0;
  let entryCount = 1;
  function walk(directory, relativeDirectory, depth) {
    const before = lstatSync(directory, { bigint: true });
    if (before.isSymbolicLink() || !before.isDirectory()) {
      fail("wakeflow-legacy-archive-transform-source", "legacy archive directory identity is unsafe");
    }
    if (depth >= MAX_ARCHIVE_SOURCE_DEPTH) {
      fail("wakeflow-legacy-archive-transform-source", "legacy archive source exceeds its depth budget");
    }
    let descriptor;
    let directoryHandle;
    try {
      descriptor = openSync(
        directory,
        fsConstants.O_RDONLY
          | (fsConstants.O_DIRECTORY ?? 0)
          | (fsConstants.O_NOFOLLOW ?? 0),
      );
      const opened = fstatSync(descriptor, { bigint: true });
      if (!opened.isDirectory() || !sameNodeSnapshot(before, opened)) {
        fail("wakeflow-legacy-archive-transform-stale", "legacy archive directory changed while opening");
      }
      directoryHandle = opendirSync(directory, { encoding: "utf8" });
      const names = [];
      while (true) {
        const entry = directoryHandle.readSync();
        if (entry === null) break;
        entryCount += 1;
        if (entryCount > MAX_ARCHIVE_SOURCE_ENTRIES) {
          fail("wakeflow-legacy-archive-transform-source", "legacy archive source exceeds its entry budget");
        }
        names.push(entry.name);
      }
      directoryHandle.closeSync();
      directoryHandle = undefined;
      names.sort(lexicalCompare);
      const children = [];
      for (const name of names) {
        const file = path.join(directory, name);
        const relativeRef = relativeDirectory ? `${relativeDirectory}/${name}` : name;
        const stat = lstatSync(file, { bigint: true });
        if (stat.isSymbolicLink()) {
          fail("wakeflow-legacy-archive-transform-source", "legacy archive tree contains a symlink");
        }
        if (stat.isDirectory()) {
          const child = walk(file, relativeRef, depth + 1);
          children.push({
            digest: child.digest,
            nameDigest: sha256(Buffer.from(name, "utf8")),
            size: child.size,
            type: "directory",
          });
          continue;
        }
        if (!stat.isFile()) {
          fail("wakeflow-legacy-archive-transform-source", "legacy archive tree contains a special entry");
        }
        if (files.length >= MAX_ARCHIVE_SOURCE_FILES) {
          fail("wakeflow-legacy-archive-transform-source", "legacy archive source exceeds its file budget");
        }
        const inspected = readExactArchiveFile(
          file,
          relativeRef,
          archiveSourceId,
          MAX_ARCHIVE_SOURCE_BYTES - totalBytes,
        );
        totalBytes += inspected.size;
        files.push(inspected);
        children.push({
          digest: inspected.digest,
          nameDigest: sha256(Buffer.from(name, "utf8")),
          size: inspected.size,
          type: "file",
        });
      }
      const afterDescriptor = fstatSync(descriptor, { bigint: true });
      const after = lstatSync(directory, { bigint: true });
      if (
        after.isSymbolicLink()
        || !after.isDirectory()
        || !sameNodeSnapshot(opened, afterDescriptor)
        || !sameNodeSnapshot(afterDescriptor, after)
      ) {
        fail("wakeflow-legacy-archive-transform-stale", "legacy archive directory changed while reading");
      }
      return {
        digest: canonicalJsonDigest({ children, truncated: false, type: "directory" }),
        size: safeNodeSize(after, "legacy archive directory"),
      };
    } finally {
      try {
        directoryHandle?.closeSync();
      } catch {
        // 失败路径保留原始领域错误；close不改变已经取得的authority证据。
      }
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }
  const tree = walk(archiveRoot, "", 0);
  if (files.length === 0) {
    fail("wakeflow-legacy-archive-transform-source", "legacy archive source contains no files");
  }
  files.sort((left, right) => lexicalCompare(left.sourceMemberId, right.sourceMemberId));
  if (new Set(files.map((entry) => entry.sourceMemberId)).size !== files.length) {
    fail("wakeflow-legacy-archive-transform-source", "legacy archive source member identity is ambiguous");
  }
  let portableOrdinal = 0;
  const classifiedFiles = files.map((entry) => {
    let portable = true;
    try {
      assertBusinessArchivePortable({
        values: [],
        opaqueMembers: [{ ref: "payload/legacy/member-candidate.bin", bytes: entry.bytes }],
        forbiddenRoots,
      });
    } catch (cause) {
      if (cause?.code !== "wakeflow-business-archive-privacy") throw cause;
      portable = false;
    }
    const memberRef = portable
      ? `payload/legacy/member-${String(portableOrdinal++).padStart(5, "0")}.bin`
      : null;
    return {
      ...entry,
      memberRef,
      portableDisposition: portable ? "portable-member" : "source-retained",
    };
  });
  assertArchiveAncestorsStable(ancestorSnapshots);
  return Object.freeze({ files: classifiedFiles, treeDigest: tree.digest });
}

// ==================== 四、portable source descriptor合同 ====================

function validateSourceDescriptor(value) {
  const descriptor = cloneFrozen(value);
  exactFields(descriptor, [
    "schemaVersion",
    "artifactKind",
    "programId",
    "demandId",
    "migrationId",
    "archiveImportId",
    "legacyOwnerArtifactDigest",
    "migrationInventoryDigest",
    "ownerDrainAssessmentDigest",
    "source",
    "rawPayload",
    "members",
  ], [], "legacy archive source descriptor");
  if (descriptor.schemaVersion !== 1 || descriptor.artifactKind !== SOURCE_DESCRIPTOR_KIND) {
    fail("wakeflow-legacy-archive-transform-descriptor", "legacy archive descriptor identity is invalid");
  }
  typedId(descriptor.programId, "program", "descriptor.programId");
  typedId(descriptor.demandId, "demand", "descriptor.demandId");
  token(descriptor.migrationId, "descriptor.migrationId");
  for (const field of [
    "archiveImportId",
    "legacyOwnerArtifactDigest",
    "migrationInventoryDigest",
    "ownerDrainAssessmentDigest",
  ]) digest(descriptor[field], `descriptor.${field}`);
  exactFields(descriptor.source, [
    "archiveEvidenceDigest",
    "archiveSourceId",
    "archiveTreeDigest",
    "eventsDigest",
    "manifestDigest",
    "resultDigests",
    "stateDigest",
  ], [], "descriptor.source");
  for (const field of [
    "archiveEvidenceDigest",
    "archiveSourceId",
    "archiveTreeDigest",
    "eventsDigest",
    "manifestDigest",
    "stateDigest",
  ]) digest(descriptor.source[field], `descriptor.source.${field}`);
  denseArray(descriptor.source.resultDigests, "descriptor.source.resultDigests")
    .forEach((entry, index) => digest(entry, `descriptor.source.resultDigests/${index}`));
  assertSortedUnique(descriptor.source.resultDigests, "descriptor.source.resultDigests");
  exactFields(descriptor.rawPayload, [
    "disposition",
    "portableMemberCount",
    "retainedMemberCount",
    "preservation",
  ], [], "descriptor.rawPayload");
  if (!new Set(["portable", "preserved"]).has(descriptor.rawPayload.disposition)) {
    fail("wakeflow-legacy-archive-transform-descriptor", "raw payload disposition is invalid");
  }
  for (const field of ["portableMemberCount", "retainedMemberCount"]) {
    if (!Number.isSafeInteger(descriptor.rawPayload[field]) || descriptor.rawPayload[field] < 0) {
      fail("wakeflow-legacy-archive-transform-descriptor", "raw payload member count is invalid");
    }
  }
  if (descriptor.rawPayload.disposition === "preserved") {
    exactFields(descriptor.rawPayload.preservation, [
      "preservationId",
      "payloadTreeDigest",
      "retentionClass",
    ], [], "descriptor.rawPayload.preservation");
    typedId(
      descriptor.rawPayload.preservation.preservationId,
      "preservation",
      "descriptor.rawPayload.preservation.preservationId",
    );
    exactFields(descriptor.rawPayload.preservation.payloadTreeDigest, [
      "algorithm",
      "value",
      "entries",
    ], [], "descriptor.rawPayload.preservation.payloadTreeDigest");
    if (
      descriptor.rawPayload.preservation.payloadTreeDigest.algorithm !== "sha256"
      || !Number.isSafeInteger(descriptor.rawPayload.preservation.payloadTreeDigest.entries)
      || descriptor.rawPayload.preservation.payloadTreeDigest.entries < 1
      || descriptor.rawPayload.preservation.retentionClass !== "reviewable-local-audit"
    ) {
      fail("wakeflow-legacy-archive-transform-descriptor", "raw payload preservation tuple is invalid");
    }
    digest(
      descriptor.rawPayload.preservation.payloadTreeDigest.value,
      "descriptor.rawPayload.preservation.payloadTreeDigest.value",
    );
  } else if (descriptor.rawPayload.preservation !== null) {
    fail("wakeflow-legacy-archive-transform-descriptor", "portable raw payload cannot name a preservation");
  }
  denseArray(descriptor.members, "descriptor.members");
  for (const [index, member] of descriptor.members.entries()) {
    exactFields(member, [
      "memberRef",
      "sourceMemberId",
      "sourceRefDigest",
      "digest",
      "mode",
      "size",
      "portableDisposition",
    ], [], `descriptor.members/${index}`);
    if (!new Set(["portable-member", "source-retained"]).has(member.portableDisposition)) {
      fail("wakeflow-legacy-archive-transform-descriptor", "descriptor member disposition is invalid");
    }
    if (
      (member.portableDisposition === "portable-member"
        && (typeof member.memberRef !== "string"
          || !/^payload\/legacy\/member-[0-9]{5}\.bin$/u.test(member.memberRef)))
      || (member.portableDisposition === "source-retained" && member.memberRef !== null)
    ) {
      fail("wakeflow-legacy-archive-transform-descriptor", "descriptor member ref differs from disposition");
    }
    digest(member.sourceMemberId, `descriptor.members/${index}.sourceMemberId`);
    digest(member.sourceRefDigest, `descriptor.members/${index}.sourceRefDigest`);
    digest(member.digest, `descriptor.members/${index}.digest`);
    if (typeof member.mode !== "string" || !/^0[0-7]{3}$/u.test(member.mode)) {
      fail("wakeflow-legacy-archive-transform-descriptor", "descriptor member mode is invalid");
    }
    if (!Number.isSafeInteger(member.size) || member.size < 0) {
      fail("wakeflow-legacy-archive-transform-descriptor", "descriptor member size is invalid");
    }
    if (member.sourceMemberId !== archiveSourceMemberId({
      archiveSourceId: descriptor.source.archiveSourceId,
      sourceRefDigest: member.sourceRefDigest,
      digest: member.digest,
      mode: member.mode,
      size: member.size,
    })) {
      fail("wakeflow-legacy-archive-transform-descriptor", "descriptor member identity differs");
    }
  }
  assertSortedUnique(descriptor.members, "descriptor.members", (entry) => entry.sourceMemberId);
  const portableCount = descriptor.members.filter(
    (entry) => entry.portableDisposition === "portable-member",
  ).length;
  if (
    descriptor.rawPayload.portableMemberCount !== portableCount
    || descriptor.rawPayload.retainedMemberCount !== descriptor.members.length - portableCount
  ) {
    fail("wakeflow-legacy-archive-transform-descriptor", "raw payload counts differ from members");
  }
  return descriptor;
}

// ==================== 五、evidence、transport与ledger wrapper构造 ====================

function sourceDescriptorBytes(value) {
  return canonicalLine(validateSourceDescriptor(value));
}

function preservationTuple(hold) {
  const manifest = hold.plan.payload.manifest;
  return {
    preservationId: manifest.preservationId,
    payloadTreeDigest: manifest.payload.treeDigest,
    retentionClass: manifest.retention.class,
  };
}

function buildEvidenceSummaries(facts, dispositions, holdsById) {
  const factKeys = facts.map((entry) => `${entry.sourceKind}\0${entry.sourceDigest}`);
  const dispositionKeys = dispositions.map((entry) => `${entry.sourceKind}\0${entry.sourceDigest}`);
  if (!sameCanonical(factKeys, dispositionKeys)) {
    fail(
      "wakeflow-legacy-archive-transform-mapping",
      "legacy evidence dispositions do not exactly cover the strict import facts",
    );
  }
  return facts.map((fact, index) => {
    validateWakeflowLegacyEvidenceFact(fact);
    const disposition = dispositions[index];
    const hold = disposition.rawDisposition === "preserved"
      ? holdsById.get(disposition.preservationId)
      : null;
    if (disposition.rawDisposition === "preserved" && !hold) {
      fail(
        "wakeflow-legacy-archive-transform-mapping",
        "preserved legacy evidence has no exact migration hold",
      );
    }
    return validateWakeflowLegacyEvidenceSummary({
      ...fact,
      rawDisposition: disposition.rawDisposition,
      ...(hold ? { preservation: preservationTuple(hold) } : {}),
    });
  });
}

function archiveStep(archiveId, intentDigest) {
  return Object.freeze({
    stepId: `publish-legacy-archive-${archiveId.slice("archive_".length)}`,
    ordinal: 0,
    stepKind: "owner-effect",
    effectKind: EFFECT_KIND,
    intentDigest,
    checkpointSchemaId: CHECKPOINT_SCHEMA_ID,
    resultSchemaId: RESULT_SCHEMA_ID,
    outcomeSchemaId: OUTCOME_SCHEMA_ID,
  });
}

function buildArchivePublish({
  normalized,
  importInventory,
  migrationInventory,
  archiveImport,
  mapping,
  holdsById,
  forbiddenRoots,
}) {
  const root = sourceById(
    migrationInventory,
    archiveImport.archive.archiveSourceId,
    "legacy archive root",
  );
  if (
    root.type !== "directory"
    || root.digest !== archiveImport.archive.archiveTreeDigest
    || root.path === null
  ) {
    fail("wakeflow-legacy-archive-transform-source", "legacy archive root does not match T06 authority");
  }
  const inspectedSource = inspectArchiveSourceMembers(
    normalized.workspaceRoot,
    root,
    forbiddenRoots,
  );
  if (inspectedSource.treeDigest !== archiveImport.archive.archiveTreeDigest) {
    fail("wakeflow-legacy-archive-transform-source", "legacy archive tree differs from T06 authority");
  }
  const files = inspectedSource.files;
  const retainedMemberCount = files.filter(
    (entry) => entry.portableDisposition === "source-retained",
  ).length;
  const rawHold = mapping.rawPayloadDisposition === "preserved"
    ? holdsById.get(mapping.rawPayloadPreservationId)
    : null;
  if (
    (retainedMemberCount > 0 && mapping.rawPayloadDisposition !== "preserved")
    || (mapping.rawPayloadDisposition === "preserved"
      && (!rawHold || rawHold.sourceId !== root.sourceId))
  ) {
    fail(
      "wakeflow-legacy-archive-transform-privacy",
      "non-portable legacy archive bytes require one exact source-retained hold",
    );
  }
  const requiredDigests = [
    archiveImport.archive.eventsDigest,
    archiveImport.archive.manifestDigest,
    archiveImport.archive.stateDigest,
    ...archiveImport.archive.resultDigests,
  ];
  const fileDigests = new Set(files.map((entry) => entry.digest));
  if (requiredDigests.some((entry) => !fileDigests.has(entry))) {
    fail("wakeflow-legacy-archive-transform-source", "legacy archive files do not cover T06 record lineage");
  }
  const sourceMembers = files.map(({ bytes: _bytes, ...source }) => source);
  const descriptor = validateSourceDescriptor({
    schemaVersion: 1,
    artifactKind: SOURCE_DESCRIPTOR_KIND,
    programId: normalized.expectedProgramId,
    demandId: mapping.demandId,
    migrationId: normalized.request.migrationId,
    archiveImportId: archiveImport.archiveImportId,
    legacyOwnerArtifactDigest: importInventory.legacyOwnerArtifactDigest,
    migrationInventoryDigest: importInventory.migrationInventoryDigest,
    ownerDrainAssessmentDigest: importInventory.ownerDrainAssessmentDigest,
    source: archiveImport.archive,
    rawPayload: {
      disposition: mapping.rawPayloadDisposition,
      portableMemberCount: files.length - retainedMemberCount,
      retainedMemberCount,
      preservation: rawHold ? preservationTuple(rawHold) : null,
    },
    members: sourceMembers,
  });
  const descriptorBytes = sourceDescriptorBytes(descriptor);
  const transportSummary = validateWakeflowLegacyTransportSummary({
    schemaVersion: 1,
    artifactKind: "wakeflow-legacy-archive-transport-summary",
    programId: normalized.expectedProgramId,
    demandId: mapping.demandId,
    sourceStatus: archiveImport.transport.sourceStatus,
    ownerDrainAssessmentDigest: importInventory.ownerDrainAssessmentDigest,
    sourceDigest: archiveImport.transport.sourceDigest,
    inventoryDigest: archiveImport.transport.inventoryDigest,
    currentResultDigests: archiveImport.transport.currentResultDigests,
    envelopeDigests: archiveImport.transport.envelopeDigests,
    groupDigests: archiveImport.transport.groupDigests,
    historicalResultDigests: archiveImport.transport.historicalResultDigests,
    packetDigests: archiveImport.transport.packetDigests,
    runDigests: archiveImport.transport.runDigests,
  });
  const transportBytes = wakeflowLegacyArchiveCanonicalBytes(transportSummary);
  const evidenceSummaries = buildEvidenceSummaries(
    archiveImport.legacyEvidenceFacts,
    mapping.evidenceDispositions,
    holdsById,
  );
  const members = [
    {
      role: "payload",
      path: "payload/legacy-source.json",
      mediaType: "application/json",
      digest: sha256(descriptorBytes),
    },
    ...sourceMembers
      .filter((member) => member.portableDisposition === "portable-member")
      .map((member) => ({
      role: "payload",
      path: member.memberRef,
      mediaType: "application/octet-stream",
      digest: member.digest,
      })),
    {
      role: "transport-summary",
      path: "transport-summary.json",
      mediaType: "application/json",
      digest: sha256(transportBytes),
    },
  ].sort((left, right) => lexicalCompare(left.path, right.path));
  const record = validateLedgerRecord({
    schemaVersion: 1,
    artifactKind: "wakeflow-archive-manifest",
    archiveId: mapping.archiveId,
    programId: normalized.expectedProgramId,
    archiveKind: "demand",
    yearMonth: mapping.yearMonth,
    title: "Legacy demand archive migration",
    conclusion: "Verified legacy authority was wrapped without restoring active authority.",
    source: {
      kind: "demand",
      demandId: mapping.demandId,
      demandRef: "payload/legacy-source.json",
      demandDigest: sha256(descriptorBytes),
    },
    transport: {
      status: "archived",
      inventoryDigest: transportSummary.inventoryDigest,
      memberRefs: [{ ref: "transport-summary.json", digest: sha256(transportBytes) }],
    },
    members,
    ...(evidenceSummaries.length === 0 ? {} : { legacyEvidenceSummaries: evidenceSummaries }),
  }).record;
  const opaqueMembers = files
    .filter((source) => source.portableDisposition === "portable-member")
    .map((source) => ({
    ref: source.memberRef,
    bytes: source.bytes,
    }));
  for (const [label, value] of [
    ["source descriptor", descriptor],
    ["transport summary", transportSummary],
    ["legacy evidence summaries", evidenceSummaries],
    ["archive manifest", record],
  ]) {
    try {
      assertBusinessArchivePortable({ values: [value], forbiddenRoots });
    } catch (cause) {
      fail(
        "wakeflow-legacy-archive-transform-privacy",
        `${label} is not portable`,
        {},
        cause,
      );
    }
  }
  assertBusinessArchivePortable({ values: [], opaqueMembers, forbiddenRoots });
  const recordDigest = canonicalJsonDigest(record);
  const memberSetDigest = canonicalJsonDigest(record.members);
  const sourceRefDigest = portableSourceRefDigest(root, "legacy archive root");
  const intentDigest = canonicalJsonDigest({
    archiveImportId: archiveImport.archiveImportId,
    archiveTreeDigest: archiveImport.archive.archiveTreeDigest,
    descriptorDigest: canonicalJsonDigest(descriptor),
    memberSetDigest,
    recordDigest,
    sourceRefDigest,
  });
  return deepFreeze({
    archiveImportId: archiveImport.archiveImportId,
    demandId: mapping.demandId,
    archiveId: mapping.archiveId,
    sourceRef: root.path,
    sourceRefDigest,
    sourceAuthority: archiveImport,
    descriptor,
    descriptorDigest: canonicalJsonDigest(descriptor),
    transportSummary,
    transportSummaryDigest: canonicalJsonDigest(transportSummary),
    sourceMembers,
    memberSetDigest,
    record,
    recordDigest,
    step: archiveStep(mapping.archiveId, intentDigest),
  });
}

// ==================== 六、T04/T06事实到confirmed owner plan ====================

// 规划期重新读取T06 import inventory和T04 migration inventory，要求两者摘要相同，
// 再构造preservation hold与archive publish步骤；全程不写workspace。
function derivePlan(normalized) {
  const importInventory = inspectWakeflowLegacyArchiveImportInventory({
    workspaceRoot: normalized.workspaceRoot,
    legacyOwnerArtifact: normalized.legacyOwnerArtifact,
  });
  const migrationInventory = inspectWakeflowMigrationInventory({
    workspaceRoot: normalized.workspaceRoot,
  });
  if (migrationInventory.inventoryDigest !== importInventory.migrationInventoryDigest) {
    fail("wakeflow-legacy-archive-transform-stale", "T04 and T06 migration inventories differ");
  }
  const importIds = importInventory.demands.map((entry) => entry.archiveImportId);
  const mappingIds = normalized.request.archiveMappings.map((entry) => entry.archiveImportId);
  if (!sameCanonical(importIds, mappingIds)) {
    fail(
      "wakeflow-legacy-archive-transform-mapping",
      "archive mappings do not exactly cover the strict T06 import inventory",
    );
  }
  const archiveRootsById = new Map(importInventory.demands.map((entry) => [
    entry.archive.archiveSourceId,
    entry,
  ]));
  const holds = normalized.request.preservationMappings.map((mapping) => {
    const source = sourceById(migrationInventory, mapping.sourceId, "migration preservation source");
    if (
      source.type !== "directory"
      || (
        source.resource?.kind !== "preservation"
        && !archiveRootsById.has(source.sourceId)
      )
      || source.path === null
    ) {
      fail(
        "wakeflow-legacy-archive-transform-mapping",
        "migration preservation mapping is not one exact preservation root",
      );
    }
    const planned = planMigrationSourceRetainedPreservation({
      workspaceRoot: normalized.workspaceRoot,
      expectedProgramId: normalized.expectedProgramId,
      preservationId: mapping.preservationId,
      sourceRef: source.path,
      migrationId: normalized.request.migrationId,
      reasonCode: mapping.reasonCode,
      createdAt: normalized.request.createdAt,
      migrationAuthority: {
        configDigest: normalized.target.configDigest,
        preservedReviewAfterDays: normalized.target.preservedReviewAfterDays,
      },
    });
    if (planned.plan.payload.disposition !== "eligible") {
      fail(
        "wakeflow-legacy-archive-transform-mapping",
        "migration preservation source is not eligible for an exact retained hold",
      );
    }
    return deepFreeze({
      sourceId: mapping.sourceId,
      sourceRefDigest: portableSourceRefDigest(source, "migration preservation source"),
      sourceDigest: source.digest,
      plan: planned.plan,
      planDigest: planned.planDigest,
    });
  });
  const holdsById = new Map(holds.map((entry) => [entry.plan.payload.preservationId, entry]));
  const referencedHolds = new Set(normalized.request.archiveMappings.flatMap((mapping) => (
    mapping.evidenceDispositions
      .filter((entry) => entry.rawDisposition === "preserved")
      .map((entry) => entry.preservationId)
  )));
  for (const preservationId of referencedHolds) {
    if (!holdsById.has(preservationId)) {
      fail(
        "wakeflow-legacy-archive-transform-mapping",
        "evidence disposition references an unknown migration hold",
      );
    }
  }
  const targetLedgerRoot = path.resolve(
    normalized.workspaceRoot,
    normalized.target.ledgerRootRef,
  );
  const forbiddenRoots = [normalized.workspaceRoot, targetLedgerRoot, os.homedir()];
  const importsById = new Map(importInventory.demands.map((entry) => [entry.archiveImportId, entry]));
  const archives = normalized.request.archiveMappings.map((mapping) => buildArchivePublish({
    normalized,
    importInventory,
    migrationInventory,
    archiveImport: importsById.get(mapping.archiveImportId),
    mapping,
    holdsById,
    forbiddenRoots,
  }));
  const closingInventory = inspectWakeflowMigrationInventory({
    workspaceRoot: normalized.workspaceRoot,
  });
  if (closingInventory.inventoryDigest !== migrationInventory.inventoryDigest) {
    fail(
      "wakeflow-legacy-archive-transform-stale",
      "migration inventory changed while archive bytes were inspected",
    );
  }
  const steps = [
    ...holds.map((entry) => entry.plan.payload.steps[0]),
    ...archives.map((entry) => entry.step),
  ].map((step, ordinal) => ({ ...step, ordinal }));
  const payload = {
    kind: WAKEFLOW_LEGACY_ARCHIVE_TRANSFORM_PLAN_KIND,
    schemaVersion: WAKEFLOW_LEGACY_ARCHIVE_TRANSFORM_PLAN_SCHEMA_VERSION,
    status: "ready",
    programId: normalized.expectedProgramId,
    configDigest: normalized.target.configDigest,
    ledgerRootRef: normalized.target.ledgerRootRef,
    preservedReviewAfterDays: normalized.target.preservedReviewAfterDays,
    request: normalized.request,
    legacyOwnerArtifactDigest: importInventory.legacyOwnerArtifactDigest,
    migrationInventoryDigest: importInventory.migrationInventoryDigest,
    ownerDrainAssessmentDigest: importInventory.ownerDrainAssessmentDigest,
    archiveImportInventoryDigest: importInventory.inventoryDigest,
    holds,
    archives,
    steps,
  };
  return validateWakeflowLegacyArchiveTransformPlan({
    schemaId: WAKEFLOW_LEGACY_ARCHIVE_TRANSFORM_PLAN_SCHEMA_ID,
    payload,
  });
}

function validateHold(value, index) {
  exactFields(value, [
    "sourceId",
    "sourceRefDigest",
    "sourceDigest",
    "plan",
    "planDigest",
  ], [], `holds/${index}`);
  digest(value.sourceId, `holds/${index}.sourceId`);
  digest(value.sourceRefDigest, `holds/${index}.sourceRefDigest`);
  digest(value.sourceDigest, `holds/${index}.sourceDigest`);
  digest(value.planDigest, `holds/${index}.planDigest`);
  if (
    canonicalJsonDigest(value.plan) !== value.planDigest
    || value.plan?.schemaId !== "urn:wakeflow:internal:maintenance:local-preservation-plan:v1"
    || value.plan?.payload?.operation !== "migration-hold"
    || value.plan?.payload?.disposition !== "eligible"
    || !Array.isArray(value.plan?.payload?.steps)
    || value.plan.payload.steps.length !== 1
  ) {
    fail("wakeflow-legacy-archive-transform-plan", "migration hold snapshot is invalid");
  }
  const sourceRef = portableSourceRef(
    value.plan.payload.manifest?.source?.relativePath,
    `holds/${index}.plan source ref`,
  );
  if (sha256(Buffer.from(sourceRef, "utf8")) !== value.sourceRefDigest) {
    fail("wakeflow-legacy-archive-transform-plan", "migration hold source ref digest differs");
  }
}

function validateArchivePublish(value, index) {
  const label = `archives/${index}`;
  exactFields(value, [
    "archiveImportId",
    "demandId",
    "archiveId",
    "sourceRef",
    "sourceRefDigest",
    "sourceAuthority",
    "descriptor",
    "descriptorDigest",
    "transportSummary",
    "transportSummaryDigest",
    "sourceMembers",
    "memberSetDigest",
    "record",
    "recordDigest",
    "step",
  ], [], label);
  digest(value.archiveImportId, `${label}.archiveImportId`);
  typedId(value.demandId, "demand", `${label}.demandId`);
  typedId(value.archiveId, "archive", `${label}.archiveId`);
  digest(value.sourceRefDigest, `${label}.sourceRefDigest`);
  if (
    sha256(Buffer.from(portableSourceRef(value.sourceRef, `${label}.sourceRef`), "utf8"))
    !== value.sourceRefDigest
  ) {
    fail("wakeflow-legacy-archive-transform-plan", "archive source ref digest differs");
  }
  const descriptor = validateSourceDescriptor(value.descriptor);
  if (canonicalJsonDigest(descriptor) !== digest(value.descriptorDigest, `${label}.descriptorDigest`)) {
    fail("wakeflow-legacy-archive-transform-plan", "descriptor digest differs");
  }
  const transport = validateWakeflowLegacyTransportSummary(value.transportSummary);
  if (
    canonicalJsonDigest(transport)
    !== digest(value.transportSummaryDigest, `${label}.transportSummaryDigest`)
  ) {
    fail("wakeflow-legacy-archive-transform-plan", "transport summary digest differs");
  }
  const record = validateLedgerRecord(value.record).record;
  if (
    record.archiveId !== value.archiveId
    || record.source.demandId !== value.demandId
    || canonicalJsonDigest(record) !== digest(value.recordDigest, `${label}.recordDigest`)
    || canonicalJsonDigest(record.members) !== digest(value.memberSetDigest, `${label}.memberSetDigest`)
  ) {
    fail("wakeflow-legacy-archive-transform-plan", "ledger record identity differs");
  }
  denseArray(value.sourceMembers, `${label}.sourceMembers`);
  for (const [memberIndex, member] of value.sourceMembers.entries()) {
    exactFields(member, [
      "memberRef",
      "sourceMemberId",
      "sourceRefDigest",
      "digest",
      "mode",
      "size",
      "portableDisposition",
    ], [], `${label}.sourceMembers/${memberIndex}`);
    digest(member.sourceMemberId, `${label}.sourceMembers/${memberIndex}.sourceMemberId`);
    digest(member.sourceRefDigest, `${label}.sourceMembers/${memberIndex}.sourceRefDigest`);
    digest(member.digest, `${label}.sourceMembers/${memberIndex}.digest`);
    if (typeof member.mode !== "string" || !/^0[0-7]{3}$/u.test(member.mode)) {
      fail("wakeflow-legacy-archive-transform-plan", "source member mode is invalid");
    }
    if (!Number.isSafeInteger(member.size) || member.size < 0) {
      fail("wakeflow-legacy-archive-transform-plan", "source member size is invalid");
    }
    if (!new Set(["portable-member", "source-retained"]).has(member.portableDisposition)) {
      fail("wakeflow-legacy-archive-transform-plan", "source member disposition is invalid");
    }
    if (!sameCanonical(member, descriptor.members[memberIndex])) {
      fail("wakeflow-legacy-archive-transform-plan", "source member differs from descriptor");
    }
    const declared = member.memberRef === null
      ? null
      : record.members.find((entry) => entry.path === member.memberRef);
    if (
      (member.portableDisposition === "portable-member"
        && (!declared || declared.digest !== member.digest || declared.role !== "payload"))
      || (member.portableDisposition === "source-retained" && declared !== null)
    ) {
      fail("wakeflow-legacy-archive-transform-plan", "source member differs from ledger manifest");
    }
  }
  assertSortedUnique(value.sourceMembers, `${label}.sourceMembers`, (entry) => entry.sourceMemberId);
  const sourceAuthority = validateWakeflowLegacyArchiveImportInventory({
    artifactKind: WAKEFLOW_LEGACY_ARCHIVE_IMPORT_INVENTORY_KIND,
    schemaVersion: WAKEFLOW_LEGACY_ARCHIVE_IMPORT_INVENTORY_SCHEMA_VERSION,
    legacyOwnerArtifactDigest: descriptor.legacyOwnerArtifactDigest,
    migrationInventoryDigest: descriptor.migrationInventoryDigest,
    ownerDrainAssessmentDigest: descriptor.ownerDrainAssessmentDigest,
    demands: [value.sourceAuthority],
    inventoryDigest: canonicalJsonDigest({
      artifactKind: WAKEFLOW_LEGACY_ARCHIVE_IMPORT_INVENTORY_KIND,
      demands: [value.sourceAuthority],
      legacyOwnerArtifactDigest: descriptor.legacyOwnerArtifactDigest,
      migrationInventoryDigest: descriptor.migrationInventoryDigest,
      ownerDrainAssessmentDigest: descriptor.ownerDrainAssessmentDigest,
      schemaVersion: WAKEFLOW_LEGACY_ARCHIVE_IMPORT_INVENTORY_SCHEMA_VERSION,
    }),
  }).demands[0];
  const expectedTransportSummary = validateWakeflowLegacyTransportSummary({
    schemaVersion: 1,
    artifactKind: "wakeflow-legacy-archive-transport-summary",
    programId: descriptor.programId,
    demandId: descriptor.demandId,
    sourceStatus: sourceAuthority.transport.sourceStatus,
    ownerDrainAssessmentDigest: descriptor.ownerDrainAssessmentDigest,
    sourceDigest: sourceAuthority.transport.sourceDigest,
    inventoryDigest: sourceAuthority.transport.inventoryDigest,
    currentResultDigests: sourceAuthority.transport.currentResultDigests,
    envelopeDigests: sourceAuthority.transport.envelopeDigests,
    groupDigests: sourceAuthority.transport.groupDigests,
    historicalResultDigests: sourceAuthority.transport.historicalResultDigests,
    packetDigests: sourceAuthority.transport.packetDigests,
    runDigests: sourceAuthority.transport.runDigests,
  });
  const descriptorBytes = sourceDescriptorBytes(descriptor);
  const transportBytes = wakeflowLegacyArchiveCanonicalBytes(transport);
  if (
    sourceAuthority.archiveImportId !== value.archiveImportId
    || descriptor.archiveImportId !== value.archiveImportId
    || descriptor.demandId !== value.demandId
    || descriptor.programId !== record.programId
    || !sameCanonical(descriptor.source, sourceAuthority.archive)
    || !sameCanonical(transport, expectedTransportSummary)
    || record.source.demandRef !== "payload/legacy-source.json"
    || record.source.demandDigest !== sha256(descriptorBytes)
    || record.transport.inventoryDigest !== transport.inventoryDigest
    || !sameCanonical(record.transport.memberRefs, [{
      ref: "transport-summary.json",
      digest: sha256(transportBytes),
    }])
  ) {
    fail("wakeflow-legacy-archive-transform-plan", "archive source authority differs");
  }
  exactFields(value.step, [
    "stepId",
    "ordinal",
    "stepKind",
    "effectKind",
    "intentDigest",
    "checkpointSchemaId",
    "resultSchemaId",
    "outcomeSchemaId",
  ], [], `${label}.step`);
  const expectedStep = archiveStep(value.archiveId, canonicalJsonDigest({
    archiveImportId: value.archiveImportId,
    archiveTreeDigest: sourceAuthority.archive.archiveTreeDigest,
    descriptorDigest: value.descriptorDigest,
    memberSetDigest: value.memberSetDigest,
    recordDigest: value.recordDigest,
    sourceRefDigest: value.sourceRefDigest,
  }));
  if (!sameCanonical(value.step, expectedStep)) {
    fail("wakeflow-legacy-archive-transform-plan", "archive owner-effect step differs");
  }
}

// 校验完整confirmed plan及其跨层摘要、mapping、owner snapshot和step闭包；
// 返回的是无行为深冻结副本，不重新扫描workspace。
export function validateWakeflowLegacyArchiveTransformPlan(value) {
  const plan = cloneFrozen(value);
  exactFields(plan, ["schemaId", "payload"], [], "legacy archive transform plan");
  if (plan.schemaId !== WAKEFLOW_LEGACY_ARCHIVE_TRANSFORM_PLAN_SCHEMA_ID) {
    fail("wakeflow-legacy-archive-transform-plan", "legacy archive transform schema ID is invalid");
  }
  exactFields(plan.payload, [
    "kind",
    "schemaVersion",
    "status",
    "programId",
    "configDigest",
    "ledgerRootRef",
    "preservedReviewAfterDays",
    "request",
    "legacyOwnerArtifactDigest",
    "migrationInventoryDigest",
    "ownerDrainAssessmentDigest",
    "archiveImportInventoryDigest",
    "holds",
    "archives",
    "steps",
  ], [], "legacy archive transform payload");
  if (
    plan.payload.kind !== WAKEFLOW_LEGACY_ARCHIVE_TRANSFORM_PLAN_KIND
    || plan.payload.schemaVersion !== WAKEFLOW_LEGACY_ARCHIVE_TRANSFORM_PLAN_SCHEMA_VERSION
    || plan.payload.status !== "ready"
  ) {
    fail("wakeflow-legacy-archive-transform-plan", "legacy archive transform identity is invalid");
  }
  typedId(plan.payload.programId, "program", "plan.programId");
  for (const field of [
    "configDigest",
    "legacyOwnerArtifactDigest",
    "migrationInventoryDigest",
    "ownerDrainAssessmentDigest",
    "archiveImportInventoryDigest",
  ]) digest(plan.payload[field], `plan.${field}`);
  if (typeof plan.payload.ledgerRootRef !== "string" || !plan.payload.ledgerRootRef) {
    fail("wakeflow-legacy-archive-transform-plan", "ledgerRootRef is invalid");
  }
  if (
    !Number.isSafeInteger(plan.payload.preservedReviewAfterDays)
    || plan.payload.preservedReviewAfterDays < 1
    || plan.payload.preservedReviewAfterDays > MAX_PRESERVED_REVIEW_AFTER_DAYS
  ) {
    fail("wakeflow-legacy-archive-transform-plan", "preservedReviewAfterDays is invalid");
  }
  const request = normalizeRequest(plan.payload.request);
  if (!sameCanonical(request, plan.payload.request)) {
    fail("wakeflow-legacy-archive-transform-plan", "transform request is not canonical");
  }
  denseArray(plan.payload.holds, "holds").forEach(validateHold);
  denseArray(plan.payload.archives, "archives").forEach(validateArchivePublish);
  assertSortedUnique(plan.payload.holds, "holds", (entry) => entry.sourceId);
  assertSortedUnique(plan.payload.archives, "archives", (entry) => entry.archiveImportId);
  const holdMappings = new Map(request.preservationMappings.map((entry) => [entry.sourceId, entry]));
  const holdsById = new Map(plan.payload.holds.map((entry) => [
    entry.plan.payload.preservationId,
    entry,
  ]));
  if (!sameCanonical(
    request.preservationMappings.map((entry) => entry.sourceId),
    plan.payload.holds.map((entry) => entry.sourceId),
  )) {
    fail("wakeflow-legacy-archive-transform-plan", "preservation mappings differ from hold snapshots");
  }
  for (const hold of plan.payload.holds) {
    const mapping = holdMappings.get(hold.sourceId);
    const manifest = hold.plan.payload.manifest;
    if (
      !mapping
      || hold.plan.payload.programId !== plan.payload.programId
      || hold.plan.payload.preservationId !== mapping.preservationId
      || manifest.createdAt !== request.createdAt
      || manifest.reason.code !== mapping.reasonCode
      || manifest.links.migrationId !== request.migrationId
    ) {
      fail("wakeflow-legacy-archive-transform-plan", "migration hold differs from its request mapping");
    }
  }
  if (!sameCanonical(
    request.archiveMappings.map((entry) => entry.archiveImportId),
    plan.payload.archives.map((entry) => entry.archiveImportId),
  )) {
    fail("wakeflow-legacy-archive-transform-plan", "archive mappings differ from publish snapshots");
  }
  const referencedPreservations = new Set();
  for (const [index, archive] of plan.payload.archives.entries()) {
    const mapping = request.archiveMappings[index];
    const rawHold = mapping.rawPayloadDisposition === "preserved"
      ? holdsById.get(mapping.rawPayloadPreservationId)
      : null;
    if (rawHold) referencedPreservations.add(mapping.rawPayloadPreservationId);
    for (const disposition of mapping.evidenceDispositions) {
      if (disposition.rawDisposition === "preserved") {
        referencedPreservations.add(disposition.preservationId);
      }
    }
    const expectedEvidence = buildEvidenceSummaries(
      archive.sourceAuthority.legacyEvidenceFacts,
      mapping.evidenceDispositions,
      holdsById,
    );
    const actualEvidence = archive.record.legacyEvidenceSummaries ?? [];
    if (
      archive.demandId !== mapping.demandId
      || archive.archiveId !== mapping.archiveId
      || archive.record.yearMonth !== mapping.yearMonth
      || archive.descriptor.migrationId !== request.migrationId
      || archive.descriptor.rawPayload.disposition !== mapping.rawPayloadDisposition
      || !sameCanonical(actualEvidence, expectedEvidence)
      || (mapping.rawPayloadDisposition === "portable"
        && archive.descriptor.rawPayload.preservation !== null)
      || (mapping.rawPayloadDisposition === "preserved" && (
        !rawHold
        || rawHold.sourceId !== archive.sourceAuthority.archive.archiveSourceId
        || !sameCanonical(archive.descriptor.rawPayload.preservation, preservationTuple(rawHold))
      ))
    ) {
      fail("wakeflow-legacy-archive-transform-plan", "archive publish differs from its request mapping");
    }
  }
  if (!sameCanonical(
    [...referencedPreservations].sort(lexicalCompare),
    [...holdsById.keys()].sort(lexicalCompare),
  )) {
    fail("wakeflow-legacy-archive-transform-plan", "migration holds are not exactly referenced");
  }
  const importPayload = {
    artifactKind: WAKEFLOW_LEGACY_ARCHIVE_IMPORT_INVENTORY_KIND,
    demands: plan.payload.archives.map((entry) => entry.sourceAuthority),
    legacyOwnerArtifactDigest: plan.payload.legacyOwnerArtifactDigest,
    migrationInventoryDigest: plan.payload.migrationInventoryDigest,
    ownerDrainAssessmentDigest: plan.payload.ownerDrainAssessmentDigest,
    schemaVersion: WAKEFLOW_LEGACY_ARCHIVE_IMPORT_INVENTORY_SCHEMA_VERSION,
  };
  const importInventory = validateWakeflowLegacyArchiveImportInventory({
    ...importPayload,
    inventoryDigest: canonicalJsonDigest(importPayload),
  });
  if (importInventory.inventoryDigest !== plan.payload.archiveImportInventoryDigest) {
    fail("wakeflow-legacy-archive-transform-plan", "archive import inventory digest differs");
  }
  const expectedSteps = [
    ...plan.payload.holds.map((entry) => entry.plan.payload.steps[0]),
    ...plan.payload.archives.map((entry) => entry.step),
  ].map((step, ordinal) => ({ ...step, ordinal }));
  if (!sameCanonical(plan.payload.steps, expectedSteps)) {
    fail("wakeflow-legacy-archive-transform-plan", "aggregate phase steps differ from owner snapshots");
  }
  return plan;
}

export function wakeflowLegacyArchiveTransformPlanDigest(value) {
  return canonicalJsonDigest(validateWakeflowLegacyArchiveTransformPlan(value));
}

// 把已确认owner plan压缩为T05可关联的portable resolution；不授予apply资格。
export function createWakeflowLegacyArchiveTransformOwnerResolution(value = {}) {
  return boundary(() => {
    exactFields(value, ["plan"], [], "legacy archive transform owner resolution input");
    const plan = validateWakeflowLegacyArchiveTransformPlan(value.plan);
    const unsigned = {
      kind: WAKEFLOW_LEGACY_ARCHIVE_TRANSFORM_OWNER_RESOLUTION_KIND,
      schemaVersion: WAKEFLOW_LEGACY_ARCHIVE_TRANSFORM_OWNER_RESOLUTION_SCHEMA_VERSION,
      ownerId: "migration-archive-transform",
      ownerPlanSchemaId: plan.schemaId,
      ownerPlanDigest: canonicalJsonDigest(plan),
      programId: plan.payload.programId,
      configDigest: plan.payload.configDigest,
      ledgerRootRef: plan.payload.ledgerRootRef,
      legacyOwnerArtifactDigest: plan.payload.legacyOwnerArtifactDigest,
      migrationInventoryDigest: plan.payload.migrationInventoryDigest,
      ownerDrainAssessmentDigest: plan.payload.ownerDrainAssessmentDigest,
      archiveImportInventoryDigest: plan.payload.archiveImportInventoryDigest,
      archives: plan.payload.archives.map((archive) => ({
        archiveImportId: archive.archiveImportId,
        archiveSourceId: archive.sourceAuthority.archive.archiveSourceId,
        archiveTreeDigest: archive.sourceAuthority.archive.archiveTreeDigest,
      })),
      coveredSourceIds: [...new Set(plan.payload.archives.flatMap(
        (archive) => archive.sourceAuthority.sourceIds,
      ))].sort(lexicalCompare),
      holds: plan.payload.holds.map((hold) => ({
        sourceId: hold.sourceId,
        sourceDigest: hold.sourceDigest,
        preservationId: hold.plan.payload.preservationId,
        holdPlanDigest: hold.planDigest,
      })),
    };
    return validateWakeflowLegacyArchiveTransformOwnerResolution({
      ...unsigned,
      resolutionDigest: canonicalJsonDigest(unsigned),
    });
  }, "owner resolution");
}

// 公开纯规划入口：消费exact legacy artifact、desired v3目标及用户确认mapping，
// 产出零写、可重算的plan和planDigest。
export function planWakeflowLegacyArchiveTransform(input = {}) {
  return boundary(() => {
    const normalized = normalizePlanInput(input);
    const plan = derivePlan(normalized);
    return deepFreeze({ plan, planDigest: canonicalJsonDigest(plan) });
  }, "planning");
}

// ==================== 七、M3 owner-effect记录与当前authority复查 ====================

function ownerRecord(schemaId, payload) {
  const exactPayload = cloneFrozen(payload);
  return deepFreeze({
    schemaId,
    payload: exactPayload,
    recordDigest: canonicalJsonDigest({ schemaId, payload: exactPayload }),
  });
}

function validateOwnerRecord(record, schemaId, required, label) {
  exactFields(record, ["schemaId", "payload", "recordDigest"], [], label);
  if (record.schemaId !== schemaId) {
    fail("wakeflow-legacy-archive-transform-record", `${label} schema differs`);
  }
  exactFields(record.payload, required, [], `${label}.payload`);
  if (
    record.recordDigest
    !== canonicalJsonDigest({ schemaId: record.schemaId, payload: record.payload })
  ) {
    fail("wakeflow-legacy-archive-transform-record", `${label} digest differs`);
  }
  return record;
}

function effectBase(planDigest, archive) {
  return {
    transformPlanDigest: planDigest,
    archiveImportId: archive.archiveImportId,
    archiveId: archive.archiveId,
    demandId: archive.demandId,
    recordDigest: archive.recordDigest,
    memberSetDigest: archive.memberSetDigest,
    sourceTreeDigest: archive.sourceAuthority.archive.archiveTreeDigest,
  };
}

function validateCheckpoint(record, base) {
  validateOwnerRecord(record, CHECKPOINT_SCHEMA_ID, [
    "kind",
    "schemaVersion",
    ...Object.keys(base),
    "status",
  ], "legacy archive publish checkpoint");
  const { kind, schemaVersion, status, ...actualBase } = record.payload;
  if (
    kind !== "WakeflowLegacyArchivePublishCheckpoint"
    || schemaVersion !== 1
    || status !== "ready"
    || !sameCanonical(actualBase, base)
  ) {
    fail("wakeflow-legacy-archive-transform-record", "legacy archive checkpoint semantics differ");
  }
  return record;
}

function validateResult(record, base) {
  validateOwnerRecord(record, RESULT_SCHEMA_ID, [
    "kind",
    "schemaVersion",
    ...Object.keys(base),
    "mode",
    "status",
  ], "legacy archive publish result");
  const { kind, schemaVersion, mode, status, ...actualBase } = record.payload;
  if (
    kind !== "WakeflowLegacyArchivePublishResult"
    || schemaVersion !== 1
    || !new Set(["publish", "recovery"]).has(mode)
    || status !== "published"
    || !sameCanonical(actualBase, base)
  ) {
    fail("wakeflow-legacy-archive-transform-record", "legacy archive result semantics differ");
  }
  return record;
}

function validateOutcome(record, base, checkpoint, result) {
  validateCheckpoint(checkpoint, base);
  const exactResult = validateResult(result, base);
  validateOwnerRecord(record, OUTCOME_SCHEMA_ID, [
    "kind",
    "schemaVersion",
    ...Object.keys(base),
    "resultMode",
    "status",
  ], "legacy archive publish outcome");
  const { kind, schemaVersion, resultMode, status, ...actualBase } = record.payload;
  if (
    kind !== "WakeflowLegacyArchivePublishOutcome"
    || schemaVersion !== 1
    || resultMode !== exactResult.payload.mode
    || status !== "published"
    || !sameCanonical(actualBase, base)
  ) {
    fail("wakeflow-legacy-archive-transform-record", "legacy archive outcome semantics differ");
  }
  return record;
}

function matchingTargetSnapshot(normalized, plan) {
  const snapshot = loadWakeflowConfigV3Snapshot({ workspaceRoot: normalized.workspaceRoot });
  if (
    snapshot.model.program.programId !== plan.payload.programId
    || snapshot.configDigest !== plan.payload.configDigest
    || snapshot.model.storage.ledgerRoot !== plan.payload.ledgerRootRef
  ) {
    fail("wakeflow-legacy-archive-transform-stale", "config authority changed after confirmation");
  }
  return snapshot;
}

function maybeMatchingTargetSnapshot(normalized, plan) {
  try {
    return matchingTargetSnapshot(normalized, plan);
  } catch (cause) {
    if (cause?.code === "wakeflow-config-v3-snapshot-config") return null;
    throw cause;
  }
}

function currentPostTargetAuthority(normalized, plan) {
  const snapshot = matchingTargetSnapshot(normalized, plan);
  const archiveFiles = new Map();
  for (const archive of plan.payload.archives) {
    const inspectedSource = inspectArchiveSourceMembers(
      normalized.workspaceRoot,
      { path: archive.sourceRef },
      [normalized.workspaceRoot, snapshot.ledgerRoot, os.homedir()],
      archive.sourceAuthority.archive.archiveSourceId,
    );
    const currentMembers = inspectedSource.files.map(({ bytes: _bytes, ...entry }) => entry);
    if (
      inspectedSource.treeDigest !== archive.sourceAuthority.archive.archiveTreeDigest
      || !sameCanonical(currentMembers, archive.sourceMembers)
    ) {
      fail("wakeflow-legacy-archive-transform-stale", "legacy archive source members changed");
    }
    archiveFiles.set(archive.archiveImportId, inspectedSource.files);
  }
  const legacyArchiveRoots = plan.payload.archives.map((archive) => {
    return assertPortableSourcePath(
      normalized.workspaceRoot,
      { path: archive.sourceRef },
      "legacy archive root",
    );
  }).sort(lexicalCompare);
  return Object.freeze({ snapshot, legacyArchiveRoots, archiveFiles });
}

function archiveMemberContents(normalized, plan, archive, authority) {
  const contents = new Map();
  const descriptorBytes = sourceDescriptorBytes(archive.descriptor);
  const transportBytes = wakeflowLegacyArchiveCanonicalBytes(archive.transportSummary);
  contents.set("payload/legacy-source.json", descriptorBytes);
  const opaqueMembers = [];
  const currentFiles = authority.archiveFiles.get(archive.archiveImportId);
  if (!currentFiles || currentFiles.length !== archive.sourceMembers.length) {
    fail("wakeflow-legacy-archive-transform-stale", "legacy archive source member set changed");
  }
  for (const [index, member] of archive.sourceMembers.entries()) {
    const current = currentFiles[index];
    const { bytes, ...currentMember } = current;
    if (!sameCanonical(currentMember, member) || sha256(bytes) !== member.digest) {
      fail("wakeflow-legacy-archive-transform-stale", "legacy archive member digest changed");
    }
    if (member.portableDisposition === "portable-member") {
      contents.set(member.memberRef, bytes);
      opaqueMembers.push({ ref: member.memberRef, bytes });
    }
  }
  contents.set("transport-summary.json", transportBytes);
  assertBusinessArchivePortable({
    values: [archive.descriptor, archive.transportSummary, archive.record],
    opaqueMembers,
    forbiddenRoots: [normalized.workspaceRoot, authority.snapshot.ledgerRoot, os.homedir()],
  });
  for (const member of archive.record.members) {
    const bytes = contents.get(member.path);
    if (!bytes || sha256(bytes) !== member.digest) {
      fail("wakeflow-legacy-archive-transform-stale", "ledger member bytes differ from confirmation");
    }
  }
  return contents;
}

function exactArchiveRecord(snapshot, archive) {
  const relativeRoot = ledgerRecordRelativeRoot(validateLedgerRecord(archive.record));
  let loaded;
  try {
    loaded = loadLedgerRecord({
    ledgerRoot: snapshot.ledgerRoot,
      root: path.join(snapshot.ledgerRoot, ...relativeRoot.split("/")),
      expectedFamily: "archive",
    expectedProgramId: archive.record.programId,
    });
  } catch (cause) {
    if (cause?.code === "ENOENT") return null;
    if (cause?.code === "wakeflow-ledger-path") return null;
    throw cause;
  }
  const members = loaded.members.map((entry) => ({
    role: entry.role,
    path: entry.path,
    mediaType: entry.mediaType,
    digest: entry.digest,
  }));
  if (
    loaded.recordDigest !== archive.recordDigest
    || !sameCanonical(loaded.record, archive.record)
    || !sameCanonical(members, archive.record.members)
  ) {
    fail("wakeflow-legacy-archive-transform-recovery", "existing archive differs from confirmation");
  }
  return loaded;
}

function publishArchive(normalized, plan, archive, mode) {
  const authority = currentPostTargetAuthority(normalized, plan);
  const memberContents = archiveMemberContents(normalized, plan, archive, authority);
  createLedgerMigrationArchiveRecord({
    ledgerRoot: authority.snapshot.ledgerRoot,
    expectedProgramId: plan.payload.programId,
    record: archive.record,
    memberContents,
    legacyArchiveRoots: authority.legacyArchiveRoots,
  });
  const loaded = exactArchiveRecord(authority.snapshot, archive);
  if (!loaded) {
    fail("wakeflow-legacy-archive-transform-recovery", "ledger archive was not published");
  }
  return ownerRecord(RESULT_SCHEMA_ID, {
    kind: "WakeflowLegacyArchivePublishResult",
    schemaVersion: 1,
    ...effectBase(canonicalJsonDigest(plan), archive),
    mode,
    status: "published",
  });
}

function callbackIdentity(args, plan, step, label) {
  if (!plainObject(args) || !sameCanonical(args.plan, plan) || !sameCanonical(args.step, step)) {
    fail("wakeflow-legacy-archive-transform-callback", `${label} received another plan or step`);
  }
}

// ==================== 八、apply/recovery participant组合 ====================

// participant把preservation owner的audit-publish步骤和本owner的archive publish effect
// 适配给唯一M3 manager。每个effect前重读source与target config；recovery只重放同一confirmed
// wrapper，不选择新mapping、不删除legacy source，也不把archive存在推断为迁移整体完成。
export function createWakeflowLegacyArchiveTransformParticipant(input = {}) {
  return boundary(() => {
    exactFields(input, [
      "workspaceRoot",
      "expectedProgramId",
      "legacyOwnerArtifact",
      "admission",
      "confirmedPlan",
    ], [], "legacy archive transform participant input");
    const participantInput = Object.freeze({
      workspaceRoot: normalizeWorkspaceRoot(input.workspaceRoot),
      expectedProgramId: typedId(input.expectedProgramId, "program", "expectedProgramId"),
      legacyOwnerArtifact: input.legacyOwnerArtifact,
      admission: input.admission,
    });
    if (!new Set(["apply", "recovery"]).has(participantInput.admission)) {
      fail("wakeflow-legacy-archive-transform-contract", "participant admission must be apply or recovery");
    }
    const confirmed = validateWakeflowLegacyArchiveTransformPlan(input.confirmedPlan);
    if (confirmed.payload.programId !== participantInput.expectedProgramId) {
      fail("wakeflow-legacy-archive-transform-plan", "participant program differs from confirmation");
    }
    const normalized = Object.freeze({
      ...participantInput,
      target: deepFreeze({
        programId: confirmed.payload.programId,
        configDigest: confirmed.payload.configDigest,
        ledgerRootRef: confirmed.payload.ledgerRootRef,
        preservedReviewAfterDays: confirmed.payload.preservedReviewAfterDays,
      }),
    });
    const planDigest = canonicalJsonDigest(confirmed);
    const holdParticipants = new Map(confirmed.payload.holds.map((hold) => [
      hold.plan.payload.steps[0].stepId,
      {
        hold,
        participant: createMigrationSourceRetainedPreservationParticipant({
          workspaceRoot: normalized.workspaceRoot,
          expectedProgramId: normalized.expectedProgramId,
          admission: normalized.admission,
          confirmedPlan: hold.plan,
        }),
      },
    ]));
    const archivesByStep = new Map(
      confirmed.payload.archives.map((archive) => [archive.step.stepId, archive]),
    );
    const stepHandlers = {};
    for (const step of confirmed.payload.steps) {
      const holdEntry = holdParticipants.get(step.stepId);
      if (holdEntry) {
        const nestedStep = holdEntry.hold.plan.payload.steps[0];
        const handler = holdEntry.participant.stepHandlers[nestedStep.stepId];
        const map = (args) => ({ ...args, plan: holdEntry.hold.plan, step: nestedStep });
        stepHandlers[step.stepId] = Object.freeze({
          prepare: async (args) => handler.prepare(map(args)),
          observe: async (args) => handler.observe(map(args)),
          commit: async (args) => handler.commit(map(args)),
          cleanup: async (args) => handler.cleanup(map(args)),
        });
        continue;
      }
      const archive = archivesByStep.get(step.stepId);
      if (!archive) {
        fail("wakeflow-legacy-archive-transform-plan", "aggregate step has no archive owner");
      }
      const base = effectBase(planDigest, archive);
      stepHandlers[step.stepId] = Object.freeze({
        async prepareEffect(args) {
          callbackIdentity(args, confirmed, step, "prepareEffect");
          currentPostTargetAuthority(normalized, confirmed);
          return ownerRecord(CHECKPOINT_SCHEMA_ID, {
            kind: "WakeflowLegacyArchivePublishCheckpoint",
            schemaVersion: 1,
            ...base,
            status: "ready",
          });
        },
        async performEffect(args) {
          callbackIdentity(args, confirmed, step, "performEffect");
          validateCheckpoint(args.checkpoint, base);
          return publishArchive(normalized, confirmed, archive, "publish");
        },
        async recoverEffect(args) {
          callbackIdentity(args, confirmed, step, "recoverEffect");
          validateCheckpoint(args.checkpoint, base);
          return publishArchive(normalized, confirmed, archive, "recovery");
        },
        async observeEffect(args) {
          callbackIdentity(args, confirmed, step, "observeEffect");
          validateCheckpoint(args.checkpoint, base);
          const result = validateResult(args.result, base);
          const authority = currentPostTargetAuthority(normalized, confirmed);
          if (!exactArchiveRecord(authority.snapshot, archive)) {
            fail("wakeflow-legacy-archive-transform-recovery", "published archive is not observable");
          }
          return ownerRecord(OUTCOME_SCHEMA_ID, {
            kind: "WakeflowLegacyArchivePublishOutcome",
            schemaVersion: 1,
            ...base,
            resultMode: result.payload.mode,
            status: "published",
          });
        },
        async validateEffectCheckpoint({ record }) {
          validateCheckpoint(record, base);
          return { valid: true };
        },
        async validateEffectResult({ record }) {
          validateResult(record, base);
          return { valid: true };
        },
        async validateEffectOutcome({ checkpoint, result, record }) {
          validateOutcome(record, base, checkpoint, result);
          return { valid: true };
        },
        async assertEffectOutcome({ checkpoint, result, outcome }) {
          validateOutcome(outcome, base, checkpoint, result);
          return { admitted: true };
        },
      });
    }
    return deepFreeze({
      validatePlan({ plan }) {
        const candidate = validateWakeflowLegacyArchiveTransformPlan(plan);
        if (!sameCanonical(candidate, confirmed)) {
          fail("wakeflow-legacy-archive-transform-stale", "mutation manager received another transform plan");
        }
        return { valid: true };
      },
      deriveCurrentPlan({ context = null } = {}) {
        if (maybeMatchingTargetSnapshot(normalized, confirmed)) {
          currentPostTargetAuthority(normalized, confirmed);
          for (const { participant } of holdParticipants.values()) {
            participant.deriveCurrentPlan({ context });
          }
          return confirmed;
        }
        const current = derivePlan({
          ...normalized,
          request: confirmed.payload.request,
        });
        if (!sameCanonical(current, confirmed)) {
          fail("wakeflow-legacy-archive-transform-stale", "archive transform plan changed after confirmation");
        }
        return confirmed;
      },
      async deriveTerminalClosure({ context, plan, planDigest: receivedDigest, effectRecords }) {
        if (
          !context
          || receivedDigest !== planDigest
          || !sameCanonical(plan, confirmed)
          || !Array.isArray(effectRecords)
        ) {
          fail("wakeflow-legacy-archive-transform-closure", "terminal closure received another plan");
        }
        const authority = currentPostTargetAuthority(normalized, confirmed);
        const archiveRecords = new Map();
        for (const record of effectRecords) {
          if (!plainObject(record) || !archivesByStep.has(record.stepId)) continue;
          if (archiveRecords.has(record.stepId)) {
            fail("wakeflow-legacy-archive-transform-closure", "archive effect record is duplicated");
          }
          archiveRecords.set(record.stepId, record);
        }
        const selectedEffects = [];
        for (const archive of confirmed.payload.archives) {
          const effect = archiveRecords.get(archive.step.stepId);
          if (
            !effect
            || effect.effectKind !== archive.step.effectKind
            || effect.intentDigest !== archive.step.intentDigest
          ) {
            fail("wakeflow-legacy-archive-transform-closure", "archive effect record is incomplete");
          }
          const base = effectBase(planDigest, archive);
          validateOutcome(effect.outcome, base, effect.checkpoint, effect.result);
          if (!exactArchiveRecord(authority.snapshot, archive)) {
            fail("wakeflow-legacy-archive-transform-closure", "ledger archive is absent at terminal closure");
          }
          selectedEffects.push(effect);
        }
        const holdClosures = [];
        for (const { hold, participant } of holdParticipants.values()) {
          holdClosures.push(await participant.deriveTerminalClosure({
            context,
            plan: hold.plan,
            planDigest: hold.planDigest,
          }));
        }
        return {
          planDigest,
          closureDigests: [{
            name: "legacy-archive-transform",
            digest: canonicalJsonDigest({
              archiveImportInventoryDigest: confirmed.payload.archiveImportInventoryDigest,
              holds: holdClosures,
              effects: selectedEffects,
              sources: confirmed.payload.archives.map((archive) => ({
                archiveImportId: archive.archiveImportId,
                archiveTreeDigest: archive.sourceAuthority.archive.archiveTreeDigest,
                recordDigest: archive.recordDigest,
              })),
            }),
          }],
        };
      },
      stepHandlers: Object.freeze(stepHandlers),
    });
  }, "participant creation");
}
