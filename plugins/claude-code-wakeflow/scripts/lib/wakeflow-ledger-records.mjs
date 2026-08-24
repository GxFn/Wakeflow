/**
 * Wakeflow durable ledger 的记录合同与不可变物理存储 owner。
 *
 * 本文件闭合 requirement、confirmation、archive 三类 portable record，严格读取其
 * manifest/member 树，并用 ledger 级锁和确定性 stage 发布 create-once authority；
 * 同时提供可移植 member reference。它不生成 Markdown 索引、不决定何时归档，
 * 也不负责初始化五个静态 ledger 目录。
 *
 * 阅读地图：记录语义从 validateLedgerRecord 开始；严格物理读取从 loadLedgerRecord
 * 开始；不可变发布从 createLedgerRecord 开始；跨领域只读引用从
 * createLedgerMemberReference/resolveLedgerMemberReference 开始。
 */
import {
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { canonicalJson, canonicalJsonDigest } from "./wakeflow-canonical-json.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import { sha256Bytes } from "./wakeflow-atomic-write.mjs";
import { withFileLock } from "./wakeflow-state-lock.mjs";
import {
  validateWakeflowLegacyEvidenceSummaries,
} from "./wakeflow-legacy-archive-records.mjs";

export const WAKEFLOW_LEDGER_FAMILIES = Object.freeze([
  "requirement",
  "confirmation",
  "archive",
]);

export const WAKEFLOW_LEDGER_RECORD_SCHEMA_VERSION = 1;
export const WAKEFLOW_LEDGER_MEMBER_REF_SCHEMA_VERSION = 1;

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const MEDIA_TYPE_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u;
const YEAR_MONTH_RE = /^[0-9]{4}-(?:0[1-9]|1[0-2])$/u;
const UNSAFE_HUMAN_TEXT_CONTROL_RE = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const ARCHIVE_INDEX_STAGE_RE = /^\.index\.md\.wakeflow-stage-(?:0|[1-9][0-9]*)-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const LEDGER_DIRECTORY_MODE = 0o755;
const LEDGER_FILE_MODE = 0o644;
const MAX_LEDGER_FILE_BYTES = 256 * 1024 * 1024;
const REQUIREMENT_ROLES = new Set([
  "original-plan",
  "requirement-design",
  "code-facts",
  "landing-plan",
  "non-goals",
  "user-confirmation",
  "reproduction",
  "scope",
  "requirement-delta",
  "research-question",
  "boundaries",
  "test-environment",
  "supporting-evidence",
]);
const CONFIRMATION_ROLES = new Set([
  "goal-stage-decision",
  "user-confirmation",
  "requirement-delta",
  "supporting-evidence",
]);
const ARCHIVE_ROLES = new Set(["payload", "summary", "todo-history", "transport-summary"]);
const ARCHIVE_KINDS = new Set(["demand", "documents", "todo"]);

const FAMILY_CONTRACTS = Object.freeze({
  requirement: Object.freeze({
    artifactKind: "wakeflow-requirement-record",
    idField: "requirementId",
    idType: "requirement",
    recordFile: "record.json",
    memberField: "documents",
    domain: "requirement-designs",
  }),
  confirmation: Object.freeze({
    artifactKind: "wakeflow-confirmation-record",
    idField: "confirmationId",
    idType: "confirmation",
    recordFile: "record.json",
    memberField: "documents",
    domain: "goal-stage-confirmation",
  }),
  archive: Object.freeze({
    artifactKind: "wakeflow-archive-manifest",
    idField: "archiveId",
    idType: "archive",
    recordFile: "archive-manifest.json",
    memberField: "members",
    domain: "workspace/archive",
  }),
});

const FAMILY_BY_ARTIFACT = new Map(
  Object.entries(FAMILY_CONTRACTS).map(([family, contract]) => [contract.artifactKind, family]),
);

// ==================== 一、便携记录合同与规范化身份 ====================

/**
 * ledger 记录层的稳定领域错误；path 指向 portable 合同位置，details 不携带成员字节。
 */
export class WakeflowLedgerRecordError extends Error {
  constructor(code, message, { path: errorPath = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowLedgerRecordError";
    this.code = code;
    this.path = errorPath;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, errorPath, message, details = {}, cause = undefined) {
  throw new WakeflowLedgerRecordError(code, `${message} at ${errorPath}`, {
    path: errorPath,
    details,
    cause,
  });
}

function canonicalRecordSnapshot(value, errorPath = "$") {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (cause) {
    fail(
      "wakeflow-ledger-record-type",
      errorPath,
      "ledger record must be canonical passive data",
      {},
      cause,
    );
  }
}

function passiveDataObject(value, { allowed, required = allowed, label, code = "wakeflow-ledger-input" }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(code, label, `${label} must be one passive plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(code, label, `${label} must be one passive plain object`);
  }
  const result = {};
  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    if (typeof key !== "string" || !allowed.includes(key)) {
      fail(code, label, `${label} has an invalid field set`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(code, `${label}/${String(key)}`, `${label} fields must be enumerable data properties`);
    }
    result[key] = descriptor.value;
  }
  for (const key of required) {
    if (!Object.hasOwn(result, key)) fail(code, `${label}/${key}`, `${label} is missing ${key}`);
  }
  return result;
}

function passiveDenseArray(value, errorPath, code = "wakeflow-ledger-input") {
  if (!Array.isArray(value)) fail(code, errorPath, `${errorPath} must be one passive dense array`);
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  const entries = [];
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)) {
      fail(code, errorPath, `${errorPath} cannot contain authority outside dense slots`);
    }
    const index = Number(key);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !Number.isSafeInteger(index)
      || index >= length
      || !descriptor?.enumerable
      || !Object.hasOwn(descriptor, "value")
    ) {
      fail(code, `${errorPath}/${key}`, `${errorPath} slots must be enumerable data properties`);
    }
    entries.push([index, descriptor.value]);
  }
  entries.sort((left, right) => left[0] - right[0]);
  if (
    !Number.isSafeInteger(length)
    || length < 0
    || entries.length !== length
    || entries.some(([index], position) => index !== position)
  ) fail(code, errorPath, `${errorPath} must be one passive dense array`);
  return entries.map(([, entry]) => entry);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalClone(value) {
  return JSON.parse(canonicalJson(value));
}

function assertPlainObject(value, errorPath) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("wakeflow-ledger-record-type", errorPath, "ledger value must be an object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("wakeflow-ledger-record-type", errorPath, "ledger value must be a plain object");
  }
  return value;
}

function assertExactKeys(value, required, optional, errorPath) {
  assertPlainObject(value, errorPath);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail("wakeflow-ledger-unknown-field", `${errorPath}/${key}`, `unknown ledger field ${key}`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail("wakeflow-ledger-required-field", `${errorPath}/${key}`, `missing required ledger field ${key}`);
    }
  }
}

function assertTrimmedString(value, errorPath) {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    fail("wakeflow-ledger-string", errorPath, "ledger string must be non-empty and already trimmed");
  }
  return value;
}

function assertHumanText(value, errorPath) {
  assertTrimmedString(value, errorPath);
  if (UNSAFE_HUMAN_TEXT_CONTROL_RE.test(value)) {
    fail(
      "wakeflow-ledger-string",
      errorPath,
      "ledger human text may contain line breaks but no other control characters",
    );
  }
  return value;
}

function assertSingleLineToken(value, errorPath) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    fail(
      "wakeflow-ledger-archive-source",
      errorPath,
      "archive source token must be non-empty, single-line, control-free, and already trimmed",
    );
  }
  return value;
}

function assertDigest(value, errorPath) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail("wakeflow-ledger-digest", errorPath, "ledger digest must be sha256:<64 lowercase hex>");
  }
  return value;
}

function assertLedgerFileCapacity(bytes, errorPath, label) {
  if (bytes.length > MAX_LEDGER_FILE_BYTES) {
    fail(
      "wakeflow-ledger-size",
      errorPath,
      `${label} exceeds the supported ledger file capacity`,
      { maximumBytes: MAX_LEDGER_FILE_BYTES },
    );
  }
  return bytes;
}

function assertPortableMemberPath(value, errorPath) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || value.includes("\\")
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
    || value.startsWith("/")
    || value.endsWith("/")
    || value.includes("//")
    || /^[A-Za-z]:/u.test(value)
  ) {
    fail("wakeflow-ledger-member-path", errorPath, "ledger member path must be a portable relative file path");
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    fail("wakeflow-ledger-member-path", errorPath, "ledger member path cannot contain dot segments");
  }
  if (path.posix.normalize(value) !== value) {
    fail("wakeflow-ledger-member-path", errorPath, "ledger member path must already be normalized");
  }
  return value;
}

function assertSortedUnique(values, errorPath, code) {
  const sorted = [...new Set(values)].sort();
  if (sorted.length !== values.length || sorted.some((value, index) => value !== values[index])) {
    fail(code, errorPath, "ledger lineage list must be unique and lexically sorted");
  }
}

function validateMembers(value, { family, field, roles }) {
  const errorPath = `$/${field}`;
  if (!Array.isArray(value) || value.length === 0) {
    fail("wakeflow-ledger-members", errorPath, `${field} must be a non-empty array`);
  }
  const normalized = value.map((member, index) => {
    const memberPath = `${errorPath}/${index}`;
    assertExactKeys(member, ["role", "path", "mediaType", "digest"], [], memberPath);
    if (!roles.has(member.role)) {
      fail("wakeflow-ledger-member-role", `${memberPath}/role`, `unsupported ${family} member role ${String(member.role)}`);
    }
    const portablePath = assertPortableMemberPath(member.path, `${memberPath}/path`);
    if (portablePath === "record.json" || portablePath === "archive-manifest.json") {
      fail("wakeflow-ledger-member-path", `${memberPath}/path`, "member path cannot replace the record manifest");
    }
    if (typeof member.mediaType !== "string" || !MEDIA_TYPE_RE.test(member.mediaType)) {
      fail("wakeflow-ledger-media-type", `${memberPath}/mediaType`, "member mediaType must be a lowercase type/subtype");
    }
    return {
      role: member.role,
      path: portablePath,
      mediaType: member.mediaType,
      digest: assertDigest(member.digest, `${memberPath}/digest`),
    };
  });
  const paths = normalized.map((member) => member.path);
  if (new Set(paths).size !== paths.length) {
    fail("wakeflow-ledger-member-duplicate", errorPath, "ledger member paths must be unique");
  }
  for (let left = 0; left < paths.length; left += 1) {
    for (let right = left + 1; right < paths.length; right += 1) {
      if (paths[left].startsWith(`${paths[right]}/`) || paths[right].startsWith(`${paths[left]}/`)) {
        fail("wakeflow-ledger-member-path", errorPath, "ledger member file paths cannot contain one another");
      }
    }
  }
  return normalized;
}

function validatePortableLineages(value, errorPath) {
  if (!Array.isArray(value) || value.length === 0) {
    fail("wakeflow-ledger-archive-source", errorPath, "archive document lineage must be non-empty");
  }
  const normalized = value.map((entry, index) => {
    const entryPath = `${errorPath}/${index}`;
    assertExactKeys(entry, ["ref", "digest"], [], entryPath);
    return {
      ref: assertPortableMemberPath(entry.ref, `${entryPath}/ref`),
      digest: assertDigest(entry.digest, `${entryPath}/digest`),
    };
  });
  assertSortedUnique(normalized.map((entry) => entry.ref), errorPath, "wakeflow-ledger-archive-source");
  return normalized;
}

function validateTodoLineages(value, errorPath) {
  if (!Array.isArray(value) || value.length === 0) {
    fail("wakeflow-ledger-archive-source", errorPath, "archive TODO lineage must be non-empty");
  }
  const normalized = value.map((entry, index) => {
    const entryPath = `${errorPath}/${index}`;
    assertExactKeys(entry, ["todoId", "digest"], [], entryPath);
    return {
      todoId: assertSingleLineToken(entry.todoId, `${entryPath}/todoId`),
      digest: assertDigest(entry.digest, `${entryPath}/digest`),
    };
  });
  assertSortedUnique(normalized.map((entry) => entry.todoId), errorPath, "wakeflow-ledger-archive-source");
  return normalized;
}

function validateArchiveSource(value, archiveKind, members) {
  assertPlainObject(value, "$/source");
  if (value.kind !== archiveKind) {
    fail("wakeflow-ledger-archive-source", "$/source/kind", `archive source kind must equal archiveKind ${archiveKind}`);
  }
  if (archiveKind === "demand") {
    assertExactKeys(value, ["kind", "demandId", "demandRef", "demandDigest"], [], "$/source");
    assertWakeflowId(value.demandId, "demand", "$/source/demandId");
    const demandRef = assertPortableMemberPath(value.demandRef, "$/source/demandRef");
    const demandDigest = assertDigest(value.demandDigest, "$/source/demandDigest");
    const referenced = members.find((member) => member.path === demandRef);
    if (!referenced || referenced.digest !== demandDigest) {
      fail(
        "wakeflow-ledger-archive-source",
        "$/source/demandRef",
        "demand archive source must identify an exact archived member and matching digest",
      );
    }
    return { kind: "demand", demandId: value.demandId, demandRef, demandDigest };
  }
  if (archiveKind === "documents") {
    assertExactKeys(value, ["kind", "documents"], [], "$/source");
    return { kind: "documents", documents: validatePortableLineages(value.documents, "$/source/documents") };
  }
  assertExactKeys(value, ["kind", "todoRows"], [], "$/source");
  return { kind: "todo", todoRows: validateTodoLineages(value.todoRows, "$/source/todoRows") };
}

function validateTransport(value, { archiveKind, members }) {
  if (archiveKind !== "demand") {
    assertExactKeys(value, ["status", "memberRefs"], [], "$/transport");
    if (value.status !== "unsupported" || !Array.isArray(value.memberRefs) || value.memberRefs.length !== 0) {
      fail(
        "wakeflow-ledger-transport",
        "$/transport",
        "documents and TODO archives must keep transport unsupported with no member refs",
      );
    }
    return { status: "unsupported", memberRefs: [] };
  }
  assertExactKeys(value, ["status", "inventoryDigest", "memberRefs"], [], "$/transport");
  if (value.status !== "archived" || !Array.isArray(value.memberRefs) || value.memberRefs.length !== 1) {
    fail(
      "wakeflow-ledger-transport",
      "$/transport",
      "demand archive transport must name one portable archived summary member",
    );
  }
  const inventoryDigest = assertDigest(value.inventoryDigest, "$/transport/inventoryDigest");
  const memberRef = value.memberRefs[0];
  assertExactKeys(memberRef, ["ref", "digest"], [], "$/transport/memberRefs/0");
  if (memberRef.ref !== "transport-summary.json") {
    fail(
      "wakeflow-ledger-transport",
      "$/transport/memberRefs/0/ref",
      "demand archive transport member must be transport-summary.json",
    );
  }
  const digest = assertDigest(memberRef.digest, "$/transport/memberRefs/0/digest");
  const declared = members.find((member) => member.path === memberRef.ref);
  if (!declared || declared.role !== "transport-summary" || declared.digest !== digest) {
    fail(
      "wakeflow-ledger-transport",
      "$/transport/memberRefs/0",
      "demand archive transport declaration must match its exact manifest member",
    );
  }
  return { status: "archived", inventoryDigest, memberRefs: [{ ref: memberRef.ref, digest }] };
}

/**
 * 把不受信任 JSON 数据闭合为三类 ledger record 之一，并验证成员、source、transport
 * 与 typed ID 的跨字段关系；此入口不接触磁盘，也不证明引用的成员文件已经存在。
 */
export function validateLedgerRecord(value) {
  value = canonicalRecordSnapshot(value);
  assertPlainObject(value, "$");
  const family = FAMILY_BY_ARTIFACT.get(value.artifactKind);
  if (!family) {
    fail("wakeflow-ledger-artifact-kind", "$/artifactKind", `unsupported ledger artifact kind ${String(value.artifactKind)}`);
  }
  const contract = FAMILY_CONTRACTS[family];
  const required = family === "requirement"
    ? ["schemaVersion", "artifactKind", "requirementId", "programId", "title", "status", "documents"]
    : family === "confirmation"
      ? ["schemaVersion", "artifactKind", "confirmationId", "programId", "demandId", "title", "status", "documents"]
      : [
          "schemaVersion",
          "artifactKind",
          "archiveId",
          "programId",
          "archiveKind",
          "yearMonth",
          "title",
          "conclusion",
          "source",
          "transport",
          "members",
        ];
  const optional = family === "requirement"
    ? ["relatedDemandIds"]
    : family === "archive"
      ? ["legacyEvidenceSummaries"]
      : [];
  assertExactKeys(value, required, optional, "$");
  if (value.schemaVersion !== WAKEFLOW_LEDGER_RECORD_SCHEMA_VERSION) {
    fail("wakeflow-ledger-schema-version", "$/schemaVersion", `ledger schemaVersion must be ${WAKEFLOW_LEDGER_RECORD_SCHEMA_VERSION}`);
  }
  assertWakeflowId(value[contract.idField], contract.idType, `$/${contract.idField}`);
  assertWakeflowId(value.programId, "program", "$/programId");
  assertHumanText(value.title, "$/title");

  let members;
  if (family === "requirement") {
    if (value.status !== "confirmed") fail("wakeflow-ledger-status", "$/status", "requirement status must be confirmed");
    if (value.relatedDemandIds !== undefined) {
      if (!Array.isArray(value.relatedDemandIds)) {
        fail("wakeflow-ledger-related-demands", "$/relatedDemandIds", "relatedDemandIds must be an array");
      }
      value.relatedDemandIds.forEach((id, index) => assertWakeflowId(id, "demand", `$/relatedDemandIds/${index}`));
      assertSortedUnique(value.relatedDemandIds, "$/relatedDemandIds", "wakeflow-ledger-related-demands");
    }
    members = validateMembers(value.documents, { family, field: "documents", roles: REQUIREMENT_ROLES });
  } else if (family === "confirmation") {
    assertWakeflowId(value.demandId, "demand", "$/demandId");
    if (value.status !== "confirmed") fail("wakeflow-ledger-status", "$/status", "confirmation status must be confirmed");
    members = validateMembers(value.documents, { family, field: "documents", roles: CONFIRMATION_ROLES });
  } else {
    if (!ARCHIVE_KINDS.has(value.archiveKind)) {
      fail("wakeflow-ledger-archive-kind", "$/archiveKind", `unsupported archiveKind ${String(value.archiveKind)}`);
    }
    if (typeof value.yearMonth !== "string" || !YEAR_MONTH_RE.test(value.yearMonth)) {
      fail("wakeflow-ledger-year-month", "$/yearMonth", "archive yearMonth must be YYYY-MM");
    }
    assertHumanText(value.conclusion, "$/conclusion");
    members = validateMembers(value.members, { family, field: "members", roles: ARCHIVE_ROLES });
    validateArchiveSource(value.source, value.archiveKind, members);
    validateTransport(value.transport, { archiveKind: value.archiveKind, members });
    if (value.legacyEvidenceSummaries !== undefined) {
      if (value.archiveKind !== "demand") {
        fail(
          "wakeflow-ledger-legacy-evidence",
          "$/legacyEvidenceSummaries",
          "only a demand archive may carry migration-only legacy evidence summaries",
        );
      }
      try {
        validateWakeflowLegacyEvidenceSummaries(value.legacyEvidenceSummaries);
      } catch (cause) {
        fail(
          "wakeflow-ledger-legacy-evidence",
          "$/legacyEvidenceSummaries",
          "legacy evidence summaries do not satisfy the migration archive contract",
          {},
          cause,
        );
      }
    }
  }

  const record = canonicalClone(value);
  return deepFreeze({
    family,
    record,
    recordId: record[contract.idField],
    contract,
    members: record[contract.memberField],
  });
}

/**
 * 只从已重新验证的 record 身份推导 canonical 相对根，不能由调用方自报 family 改写路径。
 */
export function ledgerRecordRelativeRoot(recordOrValidation) {
  const familyDescriptor = recordOrValidation && typeof recordOrValidation === "object"
    ? Object.getOwnPropertyDescriptor(recordOrValidation, "family")
    : null;
  const recordDescriptor = recordOrValidation && typeof recordOrValidation === "object"
    ? Object.getOwnPropertyDescriptor(recordOrValidation, "record")
    : null;
  const validation = familyDescriptor?.enumerable
    && Object.hasOwn(familyDescriptor, "value")
    && recordDescriptor?.enumerable
    && Object.hasOwn(recordDescriptor, "value")
    ? validateLedgerRecord(recordDescriptor.value)
    : validateLedgerRecord(recordOrValidation);
  if (familyDescriptor && familyDescriptor.value !== validation.family) {
    fail("wakeflow-ledger-family", "$family", "ledger validation family differs from its record");
  }
  const { family, record, recordId, contract } = validation;
  return family === "archive"
    ? path.posix.join(contract.domain, record.yearMonth, recordId)
    : path.posix.join(contract.domain, recordId);
}

/**
 * 推导 ledger 外侧的短时互斥锁路径；该锁只串行本机物理读取/发布，不是 durable authority。
 */
export function ledgerMutationLockPath(ledgerRoot) {
  if (typeof ledgerRoot !== "string" || !ledgerRoot.trim()) {
    fail("wakeflow-ledger-root", "$ledgerRoot", "ledgerRoot must be a non-empty path string");
  }
  let resolved = path.resolve(ledgerRoot);
  try {
    resolved = realpathSync(resolved);
  } catch {
    // The owning operation validates the durable ledger root before locking.
  }
  return path.join(path.dirname(resolved), `${path.basename(resolved)}.ledger-lock`);
}

// ==================== 二、严格物理读取与 authority inventory ====================

function inspectLedgerRoot(ledgerRoot) {
  if (typeof ledgerRoot !== "string" || !ledgerRoot.trim()) {
    fail("wakeflow-ledger-root", "$ledgerRoot", "ledgerRoot must be a non-empty path string");
  }
  const lexical = path.resolve(ledgerRoot);
  let stat;
  try {
    stat = lstatSync(lexical);
  } catch (cause) {
    fail("wakeflow-ledger-root", "$ledgerRoot", "ledgerRoot must already exist", { ledgerRoot: lexical }, cause);
  }
  if (stat.isSymbolicLink()) fail("wakeflow-ledger-symlink", "$ledgerRoot", "ledgerRoot cannot be a symlink");
  if (!stat.isDirectory()) fail("wakeflow-ledger-root", "$ledgerRoot", "ledgerRoot must be a directory");
  assertCurrentOwner(stat, "$ledgerRoot", "ledgerRoot");
  return { lexical, real: realpathSync(lexical) };
}

function lstatIfPresent(candidate) {
  try {
    return lstatSync(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function assertPathBelowLedger(rootInfo, candidate, errorPath, { directory = null } = {}) {
  const lexical = path.resolve(candidate);
  const relative = path.relative(rootInfo.lexical, lexical);
  if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    fail("wakeflow-ledger-path", errorPath, "ledger path must stay below ledgerRoot", { candidate: lexical });
  }
  let current = rootInfo.lexical;
  const segments = relative.split(path.sep);
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const stat = lstatIfPresent(current);
    if (!stat) break;
    if (stat.isSymbolicLink()) fail("wakeflow-ledger-symlink", errorPath, `ledger path cannot contain symlink ${current}`);
    if (index < segments.length - 1 || directory === true) {
      // 静态容器的精确 0755 由 materialization/projector 检查；record owner 这里只要求
      // ancestor 是当前用户拥有的真实目录，允许更严格的既有容器权限继续承载 immutable record。
      assertLedgerDirectoryStat(stat, errorPath, "ledger authority ancestor", { checkMode: false });
    }
  }
  const stat = lstatIfPresent(lexical);
  if (directory === true && (!stat || !stat.isDirectory())) {
    fail("wakeflow-ledger-path-type", errorPath, "ledger record root must be an existing directory");
  }
  const existing = stat ? realpathSync(lexical) : realpathSync(nearestExistingAncestor(lexical));
  const realRelative = path.relative(rootInfo.real, existing);
  if (path.isAbsolute(realRelative) || realRelative === ".." || realRelative.startsWith(`..${path.sep}`)) {
    fail("wakeflow-ledger-path", errorPath, "ledger path resolves outside ledgerRoot");
  }
  return lexical;
}

function nearestExistingAncestor(candidate) {
  let current = path.resolve(candidate);
  for (;;) {
    if (lstatIfPresent(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}

function statMode(stat) {
  return Number(stat.mode & (typeof stat.mode === "bigint" ? 0o777n : 0o777));
}

function statHasSingleLink(stat) {
  return stat.nlink === (typeof stat.nlink === "bigint" ? 1n : 1);
}

function assertCurrentOwner(stat, errorPath, label) {
  if (typeof process.geteuid !== "function") return;
  const expected = typeof stat.uid === "bigint" ? BigInt(process.geteuid()) : process.geteuid();
  if (stat.uid !== expected) {
    fail("wakeflow-ledger-owner", errorPath, `${label} must belong to the current effective user`);
  }
}

function assertLedgerDirectoryStat(stat, errorPath, label, { checkMode = true } = {}) {
  if (stat.isSymbolicLink()) fail("wakeflow-ledger-symlink", errorPath, `${label} cannot be a symlink`);
  if (!stat.isDirectory()) fail("wakeflow-ledger-path-type", errorPath, `${label} must be a directory`);
  assertCurrentOwner(stat, errorPath, label);
  if (checkMode && process.platform !== "win32" && statMode(stat) !== LEDGER_DIRECTORY_MODE) {
    fail(
      "wakeflow-ledger-mode",
      errorPath,
      `${label} must use mode 0755`,
      { mode: statMode(stat) },
    );
  }
}

function assertLedgerFileStat(stat, errorPath, label) {
  if (stat.isSymbolicLink()) fail("wakeflow-ledger-symlink", errorPath, `${label} cannot be a symlink`);
  if (!stat.isFile()) fail("wakeflow-ledger-path-type", errorPath, `${label} must be a regular file`);
  assertCurrentOwner(stat, errorPath, label);
  if (!statHasSingleLink(stat)) {
    fail("wakeflow-ledger-hardlink", errorPath, `${label} must have exactly one filesystem link`);
  }
  if (process.platform !== "win32" && statMode(stat) !== LEDGER_FILE_MODE) {
    fail(
      "wakeflow-ledger-mode",
      errorPath,
      `${label} must use mode 0644`,
      { mode: statMode(stat) },
    );
  }
}

function sameFileSnapshot(left, right) {
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

// 枚举期间复验目录的纳秒身份，防止把并发替换或增删后的混合树当作一次快照。
function listTreeStrict(root, errorPrefix = "$root") {
  const files = [];
  const directories = [];
  const visit = (directory, prefix = "") => {
    const before = lstatSync(directory, { bigint: true });
    assertLedgerDirectoryStat(
      before,
      prefix ? `${errorPrefix}/${prefix}` : errorPrefix,
      prefix ? "ledger record directory" : "ledger record root",
    );
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => lexicalCompare(a.name, b.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stat = lstatSync(absolute, { bigint: true });
      if (stat.isSymbolicLink()) fail("wakeflow-ledger-symlink", `${errorPrefix}/${relative}`, "ledger record cannot contain symlinks");
      if (stat.isDirectory()) {
        assertLedgerDirectoryStat(stat, `${errorPrefix}/${relative}`, "ledger record directory");
        directories.push(relative);
        visit(absolute, relative);
      } else if (stat.isFile()) {
        files.push(relative);
      } else {
        fail("wakeflow-ledger-entry-type", `${errorPrefix}/${relative}`, "ledger record may contain only directories and regular files");
      }
    }
    const after = lstatSync(directory, { bigint: true });
    if (!sameFileSnapshot(before, after)) {
      fail(
        "wakeflow-ledger-path-race",
        prefix ? `${errorPrefix}/${prefix}` : errorPrefix,
        "ledger record directory changed while its inventory was being enumerated",
      );
    }
  };
  visit(root);
  return { files, directories };
}

// 在容量上限内通过 no-follow descriptor 捕获精确字节，并复验 owner、link 和纳秒身份。
function readRegularFileNoFollow(file, errorPath, label) {
  let before;
  try {
    before = lstatSync(file, { bigint: true });
  } catch (cause) {
    fail("wakeflow-ledger-path-type", errorPath, `${label} must be an existing regular file`, { file }, cause);
  }
  assertLedgerFileStat(before, errorPath, label);

  let descriptor;
  try {
    descriptor = openSync(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (cause) {
    if (cause?.code === "ELOOP") fail("wakeflow-ledger-symlink", errorPath, `${label} cannot be a symlink`, { file }, cause);
    fail("wakeflow-ledger-path-race", errorPath, `${label} changed before it could be opened safely`, { file }, cause);
  }
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    assertLedgerFileStat(opened, errorPath, label);
    if (!sameFileSnapshot(before, opened)) {
      fail("wakeflow-ledger-path-race", errorPath, `${label} changed while it was being opened`, { file });
    }
    if (opened.size > BigInt(MAX_LEDGER_FILE_BYTES)) {
      fail(
        "wakeflow-ledger-size",
        errorPath,
        `${label} exceeds the supported ledger file capacity`,
        { maximumBytes: MAX_LEDGER_FILE_BYTES },
      );
    }
    const expectedSize = Number(opened.size);
    const captured = Buffer.alloc(expectedSize + 1);
    let offset = 0;
    while (offset < captured.length) {
      const count = readSync(descriptor, captured, offset, captured.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    if (offset !== expectedSize) {
      fail("wakeflow-ledger-path-race", errorPath, `${label} changed size while it was being read`, { file });
    }
    const content = captured.subarray(0, expectedSize);
    let after;
    try {
      after = lstatSync(file, { bigint: true });
    } catch (cause) {
      fail("wakeflow-ledger-path-race", errorPath, `${label} changed while it was being read`, { file }, cause);
    }
    assertLedgerFileStat(after, errorPath, label);
    if (!sameFileSnapshot(opened, after)) {
      fail("wakeflow-ledger-path-race", errorPath, `${label} changed while it was being read`, { file });
    }
    return content;
  } finally {
    closeSync(descriptor);
  }
}

function hardenCreatedLedgerDirectory(candidate, errorPath, label) {
  let before;
  try {
    before = lstatSync(candidate);
  } catch (cause) {
    fail("wakeflow-ledger-stage", errorPath, `${label} disappeared before mode hardening`, { candidate }, cause);
  }
  assertLedgerDirectoryStat(before, errorPath, label, { checkMode: false });
  let descriptor;
  try {
    descriptor = openSync(
      candidate,
      fsConstants.O_RDONLY
        | (fsConstants.O_DIRECTORY ?? 0)
        | (fsConstants.O_NOFOLLOW ?? 0),
    );
  } catch (cause) {
    fail("wakeflow-ledger-stage", errorPath, `cannot open newly created ${label} safely`, { candidate }, cause);
  }
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isDirectory() || opened.dev !== before.dev || opened.ino !== before.ino) {
      fail("wakeflow-ledger-stage", errorPath, `${label} changed while opening`, { candidate });
    }
    if (process.platform !== "win32") fchmodSync(descriptor, LEDGER_DIRECTORY_MODE);
    assertLedgerDirectoryStat(fstatSync(descriptor), errorPath, label);
  } finally {
    closeSync(descriptor);
  }
  let after;
  try {
    after = lstatSync(candidate);
  } catch (cause) {
    fail("wakeflow-ledger-stage", errorPath, `${label} disappeared while applying mode`, { candidate }, cause);
  }
  assertLedgerDirectoryStat(after, errorPath, label);
  if (after.dev !== before.dev || after.ino !== before.ino) {
    fail("wakeflow-ledger-stage", errorPath, `${label} changed while applying mode`, { candidate });
  }
  return Object.freeze({ dev: after.dev, ino: after.ino });
}

function createLedgerDirectory(candidate, errorPath, label) {
  try {
    mkdirSync(candidate, { mode: LEDGER_DIRECTORY_MODE });
  } catch (cause) {
    fail("wakeflow-ledger-stage", errorPath, `cannot create ${label}`, { candidate }, cause);
  }
  return hardenCreatedLedgerDirectory(candidate, errorPath, label);
}

function createLedgerFile(candidate, content, errorPath, label) {
  let descriptor;
  try {
    descriptor = openSync(
      candidate,
      fsConstants.O_WRONLY
        | fsConstants.O_CREAT
        | fsConstants.O_EXCL
        | (fsConstants.O_NOFOLLOW ?? 0),
      LEDGER_FILE_MODE,
    );
  } catch (cause) {
    fail("wakeflow-ledger-stage", errorPath, `cannot create ${label}`, { candidate }, cause);
  }
  let opened;
  try {
    if (process.platform !== "win32") fchmodSync(descriptor, LEDGER_FILE_MODE);
    writeFileSync(descriptor, content);
    opened = fstatSync(descriptor);
    assertLedgerFileStat(opened, errorPath, label);
  } catch (cause) {
    if (cause instanceof WakeflowLedgerRecordError) throw cause;
    fail("wakeflow-ledger-stage", errorPath, `cannot write ${label}`, { candidate }, cause);
  } finally {
    closeSync(descriptor);
  }
  let after;
  try {
    after = lstatSync(candidate);
  } catch (cause) {
    fail("wakeflow-ledger-stage", errorPath, `${label} disappeared after creation`, { candidate }, cause);
  }
  assertLedgerFileStat(after, errorPath, label);
  if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size) {
    fail("wakeflow-ledger-stage", errorPath, `${label} changed after creation`, { candidate });
  }
}

function parseCanonicalRecord(file) {
  let content;
  let value;
  try {
    content = readRegularFileNoFollow(file, "$record", "ledger record manifest").toString("utf8");
    value = JSON.parse(content);
  } catch (cause) {
    if (cause instanceof WakeflowLedgerRecordError) throw cause;
    fail("wakeflow-ledger-record-json", "$record", "ledger record must be valid JSON", { file }, cause);
  }
  let canonical;
  try {
    canonical = `${canonicalJson(value)}\n`;
  } catch (cause) {
    fail("wakeflow-ledger-record-json", "$record", "ledger record must be canonical JSON data", { file }, cause);
  }
  if (content !== canonical) {
    fail("wakeflow-ledger-record-encoding", "$record", "ledger record bytes must use canonical JSON plus one newline", { file });
  }
  return value;
}

function inferRecordFile(root, expectedFamily) {
  if (expectedFamily) return FAMILY_CONTRACTS[expectedFamily]?.recordFile;
  const record = lstatIfPresent(path.join(root, "record.json"));
  const archive = lstatIfPresent(path.join(root, "archive-manifest.json"));
  if (record && archive) fail("wakeflow-ledger-record-file", "$root", "ledger root cannot contain two record manifests");
  if (archive) return "archive-manifest.json";
  if (record) return "record.json";
  fail("wakeflow-ledger-record-file", "$root", "ledger root is missing its record manifest");
}

function loadLedgerRecordInternal({
  ledgerRoot,
  root,
  expectedFamily = null,
  expectedProgramId = null,
  enforceCanonicalLocation = true,
} = {}) {
  if (expectedFamily !== null && !WAKEFLOW_LEDGER_FAMILIES.includes(expectedFamily)) {
    fail("wakeflow-ledger-family", "$expectedFamily", `unsupported ledger family ${String(expectedFamily)}`);
  }
  const rootInfo = inspectLedgerRoot(ledgerRoot);
  const recordRoot = assertPathBelowLedger(rootInfo, root, "$root", { directory: true });
  const tree = listTreeStrict(recordRoot);
  const recordFile = inferRecordFile(recordRoot, expectedFamily);
  const value = parseCanonicalRecord(path.join(recordRoot, recordFile));
  const validation = validateLedgerRecord(value);
  if (expectedFamily && validation.family !== expectedFamily) {
    fail("wakeflow-ledger-family", "$/artifactKind", `ledger record family ${validation.family} does not match ${expectedFamily}`);
  }
  if (validation.contract.recordFile !== recordFile) {
    fail("wakeflow-ledger-record-file", "$record", `${validation.family} record must use ${validation.contract.recordFile}`);
  }
  if (expectedProgramId !== null) {
    assertWakeflowId(expectedProgramId, "program", "$expectedProgramId");
    if (validation.record.programId !== expectedProgramId) {
      fail("wakeflow-ledger-program", "$/programId", `ledger record belongs to ${validation.record.programId}, not ${expectedProgramId}`);
    }
  }
  const relativeRoot = ledgerRecordRelativeRoot(validation);
  if (enforceCanonicalLocation && path.resolve(rootInfo.lexical, ...relativeRoot.split("/")) !== recordRoot) {
    fail("wakeflow-ledger-record-location", "$root", `ledger record must live at ${relativeRoot}`);
  }

  const expectedFiles = new Set([recordFile, ...validation.members.map((member) => member.path)]);
  const expectedDirectories = new Set(
    validation.members.flatMap((member) => {
      const segments = member.path.split("/").slice(0, -1);
      return segments.map((_segment, index) => segments.slice(0, index + 1).join("/"));
    }),
  );
  for (const file of tree.files) {
    if (!expectedFiles.has(file)) fail("wakeflow-ledger-unknown-entry", `$root/${file}`, `unknown ledger record file ${file}`);
  }
  for (const file of expectedFiles) {
    if (!tree.files.includes(file)) fail("wakeflow-ledger-member-missing", `$root/${file}`, `missing ledger record file ${file}`);
  }
  for (const directory of tree.directories) {
    if (!expectedDirectories.has(directory)) {
      fail("wakeflow-ledger-unknown-entry", `$root/${directory}`, `unknown ledger record directory ${directory}`);
    }
  }

  const members = validation.members.map((member) => {
    const absolute = path.join(recordRoot, ...member.path.split("/"));
    const digest = `sha256:${sha256Bytes(readRegularFileNoFollow(
      absolute,
      `$root/${member.path}`,
      "ledger member",
    ))}`;
    if (digest !== member.digest) {
      fail(
        "wakeflow-ledger-member-digest",
        `$root/${member.path}`,
        `ledger member digest ${digest} does not match manifest ${member.digest}`,
      );
    }
    return { ...member, absolutePath: absolute };
  });
  return deepFreeze({
    family: validation.family,
    record: validation.record,
    recordId: validation.recordId,
    recordDigest: canonicalJsonDigest(validation.record),
    recordFile,
    root: recordRoot,
    relativeRoot,
    members,
  });
}

/**
 * 从一个 canonical ledger 根严格加载 record 与全部成员，拒绝未知 residue、路径别名、
 * mode/owner/link 漂移和读取竞态；返回的 absolutePath 只供进程内 owner 继续取字节。
 */
export function loadLedgerRecord(options = {}) {
  const values = passiveDataObject(options, {
    allowed: ["ledgerRoot", "root", "expectedFamily", "expectedProgramId", "enforceCanonicalLocation"],
    required: ["ledgerRoot", "root"],
    label: "$options",
  });
  return loadLedgerRecordInternal(values);
}

function assertLookupWakeflowId(value, type, errorPath) {
  try {
    assertWakeflowId(value, type, errorPath);
  } catch (cause) {
    fail("wakeflow-ledger-reference", errorPath, `archive lookup requires a typed ${type} ID`, {}, cause);
  }
}

/**
 * 在 ledger 锁内扫描完整 archive authority，按 demand/可选 archive 双身份定位唯一记录；
 * 索引投影是否陈旧不参与资格判断，冲突或未知 inventory 一律失败关闭。
 */
export function findDemandArchiveRecord(input = {}) {
  const values = passiveDataObject(input, {
    allowed: ["ledgerRoot", "expectedProgramId", "demandId", "archiveId"],
    required: ["ledgerRoot", "expectedProgramId", "demandId"],
    label: "$options",
  });
  const {
    ledgerRoot,
    expectedProgramId,
    demandId,
    archiveId = null,
  } = values;
  const rootInfo = inspectLedgerRoot(ledgerRoot);
  assertLookupWakeflowId(expectedProgramId, "program", "$expectedProgramId");
  assertLookupWakeflowId(demandId, "demand", "$demandId");
  if (archiveId !== null) assertLookupWakeflowId(archiveId, "archive", "$archiveId");
  return withFileLock(ledgerMutationLockPath(rootInfo.lexical), () => {
    const records = scanArchiveInventoryStrict({ rootInfo, expectedProgramId });
    const demandRecord = records.find(({ record }) => (
      record.archiveKind === "demand" && record.source.demandId === demandId
    )) ?? null;
    if (archiveId !== null) {
      const idRecord = records.find(({ recordId }) => recordId === archiveId) ?? null;
      if (
        idRecord
        && (idRecord.record.archiveKind !== "demand" || idRecord.record.source.demandId !== demandId)
      ) {
        fail(
          "wakeflow-ledger-record-conflict",
          "$archiveId",
          `archive ${archiveId} does not belong to demand ${demandId}`,
          { archiveId, demandId },
        );
      }
      if (demandRecord && demandRecord.recordId !== archiveId) {
        fail(
          "wakeflow-ledger-record-conflict",
          "$archiveId",
          `demand ${demandId} is already archived by ${demandRecord.recordId}`,
          { archiveId, demandId, existingArchiveId: demandRecord.recordId },
        );
      }
      if (!idRecord) return null;
    }
    if (!demandRecord) return null;
    return deepFreeze({
      record: demandRecord.record,
      recordId: demandRecord.recordId,
      recordDigest: demandRecord.recordDigest,
      relativeRoot: demandRecord.relativeRoot,
      members: demandRecord.members.map(({ role, path: memberPath, mediaType, digest }) => ({
        role,
        path: memberPath,
        mediaType,
        digest,
      })),
    });
  });
}

/**
 * 先重建完整 record 闭包，再读取一个 manifest 已声明成员并复核摘要；不会按裸路径旁路加载。
 */
export function loadLedgerMemberBytes(input = {}) {
  const values = passiveDataObject(input, {
    allowed: [
      "memberPath",
      "ledgerRoot",
      "root",
      "expectedFamily",
      "expectedProgramId",
      "enforceCanonicalLocation",
    ],
    required: ["memberPath", "ledgerRoot", "root"],
    label: "$options",
  });
  const { memberPath, ...options } = values;
  assertPortableMemberPath(memberPath, "$memberPath");
  const loaded = loadLedgerRecordInternal(options);
  const member = loaded.members.find((entry) => entry.path === memberPath);
  if (!member) {
    fail(
      "wakeflow-ledger-member-missing",
      "$memberPath",
      `ledger member ${memberPath} is not declared by the exact record`,
    );
  }
  const bytes = readRegularFileNoFollow(member.absolutePath, `$root/${member.path}`, "ledger member");
  const digest = `sha256:${sha256Bytes(bytes)}`;
  if (digest !== member.digest) {
    fail(
      "wakeflow-ledger-member-digest",
      `$root/${member.path}`,
      `ledger member digest ${digest} does not match manifest ${member.digest}`,
    );
  }
  return Object.freeze({
    loaded,
    member,
    bytes: Buffer.from(bytes),
  });
}

// ==================== 三、确定性 stage 与 create-once 发布 ====================

function normalizeMemberContents(value, members) {
  let entries;
  if (value instanceof Map && Object.getPrototypeOf(value) === Map.prototype) {
    if (Reflect.ownKeys(value).length !== 0) {
      fail("wakeflow-ledger-member-content", "$memberContents", "memberContents Map cannot carry extra authority");
    }
    entries = [...Map.prototype.entries.call(value)];
  } else if (value && typeof value === "object" && !Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail("wakeflow-ledger-member-content", "$memberContents", "memberContents must be a passive plain object or Map");
    }
    entries = Reflect.ownKeys(value).map((key) => {
      if (typeof key !== "string") {
        fail("wakeflow-ledger-member-content", "$memberContents", "memberContents cannot contain symbol keys");
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
        fail(
          "wakeflow-ledger-member-content",
          `$memberContents/${key}`,
          "memberContents fields must be enumerable data properties",
        );
      }
      return [key, descriptor.value];
    });
  } else fail("wakeflow-ledger-member-content", "$memberContents", "memberContents must be an object or Map");
  const contents = new Map();
  for (const [memberPath, content] of entries) {
    assertPortableMemberPath(memberPath, `$memberContents/${memberPath}`);
    if (contents.has(memberPath)) fail("wakeflow-ledger-member-duplicate", `$memberContents/${memberPath}`, "duplicate member content path");
    if (!(typeof content === "string" || Buffer.isBuffer(content) || content instanceof Uint8Array)) {
      fail("wakeflow-ledger-member-content", `$memberContents/${memberPath}`, "member content must be string or bytes");
    }
    contents.set(memberPath, assertLedgerFileCapacity(
      Buffer.from(content),
      `$memberContents/${memberPath}`,
      "ledger member",
    ));
  }
  const expected = new Set(members.map((member) => member.path));
  for (const memberPath of contents.keys()) {
    if (!expected.has(memberPath)) fail("wakeflow-ledger-unknown-entry", `$memberContents/${memberPath}`, "content has no manifest member");
  }
  for (const member of members) {
    const content = contents.get(member.path);
    if (!content) fail("wakeflow-ledger-member-missing", `$memberContents/${member.path}`, "manifest member content is missing");
    const digest = `sha256:${sha256Bytes(content)}`;
    if (digest !== member.digest) {
      fail(
        "wakeflow-ledger-member-digest",
        `$memberContents/${member.path}`,
        `member content digest ${digest} does not match manifest ${member.digest}`,
      );
    }
  }
  return contents;
}

function deterministicStageName(recordId) {
  return `.${recordId}.wakeflow-stage`;
}

function isLedgerStageName(name) {
  return typeof name === "string" && name.startsWith(".") && name.includes(".wakeflow-stage");
}

function sortedDirectoryEntries(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => lexicalCompare(left.name, right.name));
}

function scanArchiveInventoryStrict({
  rootInfo,
  expectedProgramId,
  allowedStage = null,
  allowedLegacyRoots = null,
}) {
  const archiveRoot = path.join(rootInfo.lexical, "workspace", "archive");
  assertPathBelowLedger(rootInfo, archiveRoot, "$archiveRoot", { directory: true });
  const records = [];
  const recordOwners = new Map();
  const demandOwners = new Map();
  const observedLegacyRoots = new Set();

  for (const monthEntry of sortedDirectoryEntries(archiveRoot)) {
    const monthPath = path.join(archiveRoot, monthEntry.name);
    const monthErrorPath = `$archiveRoot/${monthEntry.name}`;
    if (monthEntry.name === "index.md" || ARCHIVE_INDEX_STAGE_RE.test(monthEntry.name)) {
      // The exact projection target and its atomic stage are never archive
      // authority. Lookup and mutation remain available while either is stale.
      continue;
    }
    const monthStat = lstatSync(monthPath);
    if (monthStat.isSymbolicLink()) {
      fail("wakeflow-ledger-symlink", monthErrorPath, "archive month cannot be a symlink");
    }
    if (!monthStat.isDirectory() || !YEAR_MONTH_RE.test(monthEntry.name)) {
      fail("wakeflow-ledger-unknown-entry", monthErrorPath, "archive inventory contains an unknown month entry");
    }
    assertLedgerDirectoryStat(monthStat, monthErrorPath, "archive month");
    const archiveEntries = sortedDirectoryEntries(monthPath);
    if (archiveEntries.length === 0) {
      if (allowedStage !== null && monthEntry.name === allowedStage.yearMonth) continue;
      fail("wakeflow-ledger-unknown-entry", monthErrorPath, "empty archive month is orphan residue");
    }
    for (const archiveEntry of archiveEntries) {
      const archivePath = path.join(monthPath, archiveEntry.name);
      const archiveErrorPath = `${monthErrorPath}/${archiveEntry.name}`;
      const archiveStat = lstatSync(archivePath);
      const isExpectedStage = allowedStage !== null
        && monthEntry.name === allowedStage.yearMonth
        && archiveEntry.name === allowedStage.name;
      if (isExpectedStage) {
        assertLedgerDirectoryStat(archiveStat, archiveErrorPath, "deterministic ledger stage");
        continue;
      }
      if (isLedgerStageName(archiveEntry.name)) {
        fail(
          "wakeflow-ledger-stage",
          archiveErrorPath,
          "unowned ledger stage blocks archive mutation and requires explicit inspection",
        );
      }
      if (archiveStat.isSymbolicLink()) {
        fail("wakeflow-ledger-symlink", archiveErrorPath, "archive record root cannot be a symlink");
      }
      if (!archiveStat.isDirectory()) {
        fail("wakeflow-ledger-unknown-entry", archiveErrorPath, "archive month contains an unknown entry");
      }
      if (allowedLegacyRoots?.has(path.resolve(archivePath))) {
        observedLegacyRoots.add(path.resolve(archivePath));
        continue;
      }
      try {
        assertWakeflowId(archiveEntry.name, "archive", archiveErrorPath);
      } catch (cause) {
        fail("wakeflow-ledger-unknown-entry", archiveErrorPath, "archive record root must use a typed archive ID", {}, cause);
      }
      const loaded = loadLedgerRecordInternal({
        ledgerRoot: rootInfo.lexical,
        root: archivePath,
        expectedFamily: "archive",
        expectedProgramId,
      });
      const previousRecord = recordOwners.get(loaded.recordId);
      if (previousRecord && previousRecord.relativeRoot !== loaded.relativeRoot) {
        fail(
          "wakeflow-ledger-record-conflict",
          "$archiveRoot",
          `archive ID ${loaded.recordId} exists at more than one canonical archive root`,
          { archiveId: loaded.recordId },
        );
      }
      recordOwners.set(loaded.recordId, loaded);
      records.push(loaded);
      if (loaded.record.archiveKind !== "demand") continue;
      const demandId = loaded.record.source.demandId;
      const previous = demandOwners.get(demandId);
      if (previous && previous.relativeRoot !== loaded.relativeRoot) {
        fail(
          "wakeflow-ledger-record-conflict",
          "$archiveRoot",
          `demand ${demandId} already has more than one immutable archive record`,
          { demandId, archiveIds: [previous.recordId, loaded.recordId].sort() },
        );
      }
      demandOwners.set(demandId, loaded);
    }
  }

  if (
    allowedLegacyRoots !== null
    && (
      observedLegacyRoots.size !== allowedLegacyRoots.size
      || [...allowedLegacyRoots].some((entry) => !observedLegacyRoots.has(entry))
    )
  ) {
    fail(
      "wakeflow-ledger-record-conflict",
      "$archiveRoot",
      "migration legacy archive allowlist differs from the exact ledger inventory",
    );
  }

  return Object.freeze(records);
}

function inspectArchiveInventoryForCreate({ rootInfo, validation, allowedLegacyRoots = null }) {
  if (validation.family !== "archive") return;
  const records = scanArchiveInventoryStrict({
    rootInfo,
    expectedProgramId: validation.record.programId,
    allowedStage: {
      yearMonth: validation.record.yearMonth,
      name: deterministicStageName(validation.recordId),
    },
    allowedLegacyRoots,
  });
  const relativeRoot = ledgerRecordRelativeRoot(validation);
  const existingIdentity = records.find(({ recordId }) => recordId === validation.recordId);
  if (existingIdentity && existingIdentity.relativeRoot !== relativeRoot) {
    fail(
      "wakeflow-ledger-record-conflict",
      "$/archiveId",
      `archive ${validation.recordId} already exists at ${existingIdentity.relativeRoot}`,
      {
        archiveId: validation.recordId,
        existingRelativeRoot: existingIdentity.relativeRoot,
        requestedRelativeRoot: relativeRoot,
      },
    );
  }

  if (validation.record.archiveKind === "demand") {
    const existing = records.find(({ record }) => (
      record.archiveKind === "demand"
      && record.source.demandId === validation.record.source.demandId
    ));
    if (existing && existing.recordId !== validation.recordId) {
      fail(
        "wakeflow-ledger-record-conflict",
        "$/source/demandId",
        `demand ${validation.record.source.demandId} is already archived by ${existing.recordId}`,
        {
          demandId: validation.record.source.demandId,
          existingArchiveId: existing.recordId,
          requestedArchiveId: validation.recordId,
        },
      );
    }
  }
}

function assertNoForeignStages(parent, expectedStageName) {
  for (const entry of sortedDirectoryEntries(parent)) {
    if (entry.name === expectedStageName || !isLedgerStageName(entry.name)) continue;
    fail(
      "wakeflow-ledger-stage",
      `$stage/${entry.name}`,
      "unowned ledger stage blocks mutation and requires explicit inspection",
    );
  }
}

function expectedMemberDirectories(members) {
  return new Set(members.flatMap((member) => {
    const segments = member.path.split("/").slice(0, -1);
    return segments.map((_segment, index) => segments.slice(0, index + 1).join("/"));
  }));
}

// 已存在 stage 只有在 manifest 意图和全部已写成员都匹配时才允许前向补全。
function inspectDeterministicStage({ rootInfo, stage, validation, recordDigest }) {
  const stageStat = lstatIfPresent(stage);
  if (!stageStat) return { exists: false, manifestPresent: false };
  if (stageStat.isSymbolicLink()) {
    fail("wakeflow-ledger-symlink", "$stage", "deterministic ledger stage cannot be a symlink", { stage });
  }
  if (!stageStat.isDirectory()) {
    fail("wakeflow-ledger-stage", "$stage", "deterministic ledger stage must be a directory", { stage });
  }
  assertPathBelowLedger(rootInfo, stage, "$stage", { directory: true });
  const tree = listTreeStrict(stage, "$stage");
  const manifestPresent = tree.files.includes(validation.contract.recordFile);
  if (!manifestPresent) {
    if (tree.files.length !== 0 || tree.directories.length !== 0) {
      fail(
        "wakeflow-ledger-stage",
        "$stage",
        "ledger stage contains bytes before its immutable manifest intent",
        { stage },
      );
    }
    return { exists: true, manifestPresent: false };
  }

  const stagedRecord = parseCanonicalRecord(path.join(stage, validation.contract.recordFile));
  const stagedValidation = validateLedgerRecord(stagedRecord);
  if (
    stagedValidation.family !== validation.family
    || stagedValidation.recordId !== validation.recordId
    || canonicalJsonDigest(stagedValidation.record) !== recordDigest
  ) {
    fail(
      "wakeflow-ledger-stage",
      "$stage",
      `deterministic stage does not belong to exact record ${validation.recordId}`,
      { stage, recordId: validation.recordId },
    );
  }

  const expectedFiles = new Set([
    validation.contract.recordFile,
    ...validation.members.map((member) => member.path),
  ]);
  const expectedDirectories = expectedMemberDirectories(validation.members);
  for (const file of tree.files) {
    if (!expectedFiles.has(file)) {
      fail("wakeflow-ledger-unknown-entry", `$stage/${file}`, `unknown deterministic stage file ${file}`);
    }
  }
  for (const directory of tree.directories) {
    if (!expectedDirectories.has(directory)) {
      fail("wakeflow-ledger-unknown-entry", `$stage/${directory}`, `unknown deterministic stage directory ${directory}`);
    }
  }
  for (const member of validation.members) {
    if (!tree.files.includes(member.path)) continue;
    const digest = `sha256:${sha256Bytes(readRegularFileNoFollow(
      path.join(stage, ...member.path.split("/")),
      `$stage/${member.path}`,
      "staged ledger member",
    ))}`;
    if (digest !== member.digest) {
      fail(
        "wakeflow-ledger-member-digest",
        `$stage/${member.path}`,
        `staged member digest ${digest} does not match manifest ${member.digest}`,
      );
    }
  }
  return { exists: true, manifestPresent: true };
}

function ensureStageMemberParent(stage, memberPath) {
  let current = stage;
  for (const segment of memberPath.split("/").slice(0, -1)) {
    current = path.join(current, segment);
    let stat = lstatIfPresent(current);
    if (!stat) {
      createLedgerDirectory(current, `$stage/${memberPath}`, "staged member directory");
      stat = lstatIfPresent(current);
    }
    if (!stat) fail("wakeflow-ledger-stage", `$stage/${memberPath}`, "staged member directory disappeared");
    assertLedgerDirectoryStat(stat, `$stage/${memberPath}`, "staged member directory");
  }
}

function materializeExactStage({ rootInfo, stage, validation, recordDigest, recordBytes, contents }) {
  let inspection = inspectDeterministicStage({ rootInfo, stage, validation, recordDigest });
  if (!inspection.exists) {
    createLedgerDirectory(stage, "$stage", "deterministic ledger stage");
    inspection = inspectDeterministicStage({ rootInfo, stage, validation, recordDigest });
  }
  if (!inspection.manifestPresent) {
    createLedgerFile(
      path.join(stage, validation.contract.recordFile),
      recordBytes,
      "$stage",
      "immutable stage manifest intent",
    );
    inspectDeterministicStage({ rootInfo, stage, validation, recordDigest });
  }

  for (const member of [...validation.members].sort((left, right) => lexicalCompare(left.path, right.path))) {
    const target = path.join(stage, ...member.path.split("/"));
    const existing = lstatIfPresent(target);
    if (existing) {
      if (existing.isSymbolicLink()) {
        fail("wakeflow-ledger-symlink", `$stage/${member.path}`, "staged ledger member cannot be a symlink");
      }
      if (!existing.isFile()) {
        fail("wakeflow-ledger-stage", `$stage/${member.path}`, "staged ledger member must be a regular file");
      }
      const digest = `sha256:${sha256Bytes(readRegularFileNoFollow(
        target,
        `$stage/${member.path}`,
        "staged ledger member",
      ))}`;
      if (digest !== member.digest) {
        fail(
          "wakeflow-ledger-member-digest",
          `$stage/${member.path}`,
          `staged member digest ${digest} does not match manifest ${member.digest}`,
        );
      }
      continue;
    }
    ensureStageMemberParent(stage, member.path);
    createLedgerFile(
      target,
      contents.get(member.path),
      `$stage/${member.path}`,
      "staged ledger member",
    );
  }

  return loadLedgerRecordInternal({
    ledgerRoot: rootInfo.lexical,
    root: stage,
    expectedFamily: validation.family,
    expectedProgramId: validation.record.programId,
    enforceCanonicalLocation: false,
  });
}

function ensureArchiveMonth(rootInfo, yearMonth) {
  const archiveRoot = path.join(rootInfo.lexical, "workspace", "archive");
  assertPathBelowLedger(rootInfo, archiveRoot, "$archiveRoot", { directory: true });
  const month = path.join(archiveRoot, yearMonth);
  let existing = lstatIfPresent(month);
  let created = false;
  let createdIdentity = null;
  if (!existing) {
    try {
      mkdirSync(month, { mode: LEDGER_DIRECTORY_MODE });
      created = true;
    } catch (cause) {
      if (cause?.code !== "EEXIST") {
        fail("wakeflow-ledger-stage", "$archiveRoot", `cannot create archive month ${yearMonth}`, {}, cause);
      }
    }
    if (created) {
      createdIdentity = hardenCreatedLedgerDirectory(month, "$archiveRoot", `archive month ${yearMonth}`);
    }
    existing = lstatIfPresent(month);
  }
  assertPathBelowLedger(rootInfo, month, "$archiveRoot", { directory: true });
  if (!existing) fail("wakeflow-ledger-stage", "$archiveRoot", `archive month ${yearMonth} disappeared`);
  assertLedgerDirectoryStat(existing, "$archiveRoot", `archive month ${yearMonth}`);
  return { path: month, created, createdIdentity };
}

function assertExistingDomainParent(rootInfo, validation) {
  if (validation.family === "archive") return ensureArchiveMonth(rootInfo, validation.record.yearMonth);
  const parent = path.join(rootInfo.lexical, ...validation.contract.domain.split("/"));
  const resolved = assertPathBelowLedger(rootInfo, parent, "$domainRoot", { directory: true });
  return {
    path: resolved,
    created: false,
    createdIdentity: null,
  };
}

function cleanupCreatedArchiveMonth(parentState) {
  if (!parentState.created || !parentState.createdIdentity) return;
  const matchesCreatedDirectory = (stat) => stat
    && !stat.isSymbolicLink()
    && stat.isDirectory()
    && stat.dev === parentState.createdIdentity.dev
    && stat.ino === parentState.createdIdentity.ino;
  const before = lstatIfPresent(parentState.path);
  if (!matchesCreatedDirectory(before)) return;
  if (process.platform !== "win32" && (before.mode & 0o777) !== LEDGER_DIRECTORY_MODE) return;
  let entries;
  try {
    entries = readdirSync(parentState.path);
  } catch {
    return;
  }
  if (entries.length !== 0) return;
  const after = lstatIfPresent(parentState.path);
  if (!matchesCreatedDirectory(after)) return;
  if (process.platform !== "win32" && (after.mode & 0o777) !== LEDGER_DIRECTORY_MODE) return;
  try {
    rmdirSync(parentState.path);
  } catch {
    // Any concurrent replacement or population is unowned and must survive.
  }
}

function exactExistingResult({ ledgerRoot, destination, validation, recordDigest }) {
  const existing = lstatIfPresent(destination);
  if (!existing) return null;
  if (existing.isSymbolicLink()) fail("wakeflow-ledger-symlink", "$recordRoot", "record destination cannot be a symlink");
  if (!existing.isDirectory()) fail("wakeflow-ledger-record-conflict", "$recordRoot", "record destination is not a directory");
  const loaded = loadLedgerRecordInternal({
    ledgerRoot,
    root: destination,
    expectedFamily: validation.family,
    expectedProgramId: validation.record.programId,
  });
  if (loaded.recordDigest !== recordDigest) {
    fail("wakeflow-ledger-record-conflict", "$recordRoot", `immutable record ${validation.recordId} already exists with different bytes`);
  }
  return deepFreeze({
    created: false,
    family: loaded.family,
    recordId: loaded.recordId,
    recordDigest: loaded.recordDigest,
    root: loaded.root,
    relativeRoot: loaded.relativeRoot,
  });
}

function assertExpectedProgram(validation, expectedProgramId) {
  try {
    assertWakeflowId(expectedProgramId, "program", "$expectedProgramId");
  } catch (cause) {
    fail(
      "wakeflow-ledger-program",
      "$expectedProgramId",
      "createLedgerRecord requires the owning program's typed ID",
      {},
      cause,
    );
  }
  if (validation.record.programId !== expectedProgramId) {
    fail(
      "wakeflow-ledger-program",
      "$/programId",
      `ledger record belongs to ${validation.record.programId}, not ${expectedProgramId}`,
    );
  }
}

function normalizeMigrationLegacyArchiveRoots(rootInfo, value) {
  const candidates = passiveDenseArray(
    value,
    "$legacyArchiveRoots",
    "wakeflow-ledger-record-conflict",
  );
  const archiveRoot = path.join(rootInfo.lexical, "workspace", "archive");
  const roots = new Set();
  for (const [index, candidate] of candidates.entries()) {
    if (
      typeof candidate !== "string"
      || !path.isAbsolute(candidate)
      || path.resolve(candidate) !== candidate
    ) {
      fail(
        "wakeflow-ledger-record-conflict",
        `$legacyArchiveRoots/${index}`,
        "migration legacy archive root must be one normalized absolute path",
      );
    }
    const relative = path.relative(archiveRoot, candidate).split(path.sep);
    if (
      relative.length !== 2
      || !YEAR_MONTH_RE.test(relative[0])
      || !relative[1]
      || relative[1] === "."
      || relative[1] === ".."
    ) {
      fail(
        "wakeflow-ledger-record-conflict",
        `$legacyArchiveRoots/${index}`,
        "migration legacy archive root is outside one canonical archive month",
      );
    }
    if (roots.has(candidate)) {
      fail(
        "wakeflow-ledger-record-conflict",
        "$legacyArchiveRoots",
        "migration legacy archive roots must be unique",
      );
    }
    roots.add(candidate);
  }
  return roots;
}

// 在唯一 ledger 锁内完成 inventory 重验、stage 补全和同父 rename 发布。
function createLedgerRecordInternal({
  ledgerRoot,
  expectedProgramId,
  record,
  memberContents,
  legacyArchiveRoots = null,
} = {}) {
  const rootInfo = inspectLedgerRoot(ledgerRoot);
  const validation = validateLedgerRecord(record);
  assertExpectedProgram(validation, expectedProgramId);
  const recordBytes = assertLedgerFileCapacity(
    Buffer.from(`${canonicalJson(validation.record)}\n`, "utf8"),
    "$record",
    "ledger record manifest",
  );
  const contents = normalizeMemberContents(memberContents, validation.members);
  const allowedLegacyRoots = legacyArchiveRoots === null
    ? null
    : normalizeMigrationLegacyArchiveRoots(rootInfo, legacyArchiveRoots);
  const relativeRoot = ledgerRecordRelativeRoot(validation);
  const destination = path.join(rootInfo.lexical, ...relativeRoot.split("/"));
  const recordDigest = canonicalJsonDigest(validation.record);
  return withFileLock(ledgerMutationLockPath(rootInfo.lexical), () => {
    inspectArchiveInventoryForCreate({ rootInfo, validation, allowedLegacyRoots });
    const parentState = assertExistingDomainParent(rootInfo, validation);
    const stageName = deterministicStageName(validation.recordId);
    const stage = path.join(parentState.path, stageName);
    let published = false;
    try {
      assertNoForeignStages(parentState.path, stageName);
      const stageInspection = inspectDeterministicStage({
        rootInfo,
        stage,
        validation,
        recordDigest,
      });
      const existing = exactExistingResult({
        ledgerRoot: rootInfo.lexical,
        destination,
        validation,
        recordDigest,
      });
      if (existing) {
        if (stageInspection.exists) {
          fail(
            "wakeflow-ledger-stage",
            "$stage",
            "deterministic stage coexists with committed authority and requires explicit inspection",
            { stage, recordId: validation.recordId },
          );
        }
        return existing;
      }
      materializeExactStage({
        rootInfo,
        stage,
        validation,
        recordDigest,
        recordBytes,
        contents,
      });
      try {
        renameSync(stage, destination);
        published = true;
      } catch (cause) {
        const raced = exactExistingResult({ ledgerRoot: rootInfo.lexical, destination, validation, recordDigest });
        if (raced) {
          fail(
            "wakeflow-ledger-stage",
            "$stage",
            "exact stage and committed authority coexist after a publish race; preserving the stage",
            { stage, recordId: validation.recordId },
            cause,
          );
        }
        fail("wakeflow-ledger-record-conflict", "$recordRoot", `cannot publish immutable record ${validation.recordId}`, {}, cause);
      }
      return deepFreeze({
        created: true,
        family: validation.family,
        recordId: validation.recordId,
        recordDigest,
        root: destination,
        relativeRoot,
      });
    } finally {
      if (parentState.created && !published && !lstatIfPresent(stage)) {
        cleanupCreatedArchiveMonth(parentState);
      }
    }
  });
}

/**
 * 创建或幂等读取一条普通不可变 ledger authority；任何其他 stage 或同身份异字节均保留并阻断。
 */
export function createLedgerRecord(input = {}) {
  const values = passiveDataObject(input, {
    allowed: ["ledgerRoot", "expectedProgramId", "record", "memberContents"],
    label: "$options",
  });
  return createLedgerRecordInternal(values);
}

/**
 * 仅供显式迁移 owner 使用：除普通发布合同外，允许调用方已经验证的精确 legacy archive 根共存。
 */
export function createLedgerMigrationArchiveRecord(input = {}) {
  const values = passiveDataObject(input, {
    allowed: ["ledgerRoot", "expectedProgramId", "record", "memberContents", "legacyArchiveRoots"],
    label: "$options",
  });
  return createLedgerRecordInternal(values);
}

// ==================== 四、可移植成员引用 ====================

/**
 * 从严格 loaded record 生成不含绝对路径的成员引用；引用只钉住身份与摘要，不复制成员内容。
 */
export function createLedgerMemberReference(loadedRecord, memberPath) {
  const loaded = passiveDataObject(loadedRecord, {
    allowed: [
      "family",
      "record",
      "recordId",
      "recordDigest",
      "recordFile",
      "root",
      "relativeRoot",
      "members",
    ],
    label: "$loadedRecord",
    code: "wakeflow-ledger-reference",
  });
  if (!WAKEFLOW_LEDGER_FAMILIES.includes(loaded.family)) {
    fail("wakeflow-ledger-reference", "$loadedRecord", "member reference requires a loaded ledger record");
  }
  const normalizedPath = assertPortableMemberPath(memberPath, "$memberPath");
  const members = passiveDenseArray(loaded.members, "$loadedRecord/members", "wakeflow-ledger-reference")
    .map((entry, index) => passiveDataObject(entry, {
      allowed: ["role", "path", "mediaType", "digest", "absolutePath"],
      label: `$loadedRecord/members/${index}`,
      code: "wakeflow-ledger-reference",
    }));
  const member = members.find((entry) => entry.path === normalizedPath);
  if (!member) fail("wakeflow-ledger-reference", "$memberPath", `record has no member ${normalizedPath}`);
  return deepFreeze({
    schemaVersion: WAKEFLOW_LEDGER_MEMBER_REF_SCHEMA_VERSION,
    artifactKind: "wakeflow-ledger-member-ref",
    family: loaded.family,
    recordId: loaded.recordId,
    recordRef: path.posix.join(loaded.relativeRoot, loaded.recordFile),
    recordDigest: loaded.recordDigest,
    memberRef: path.posix.join(loaded.relativeRoot, member.path),
    memberDigest: member.digest,
    role: member.role,
  });
}

function validateMemberReference(reference) {
  reference = canonicalRecordSnapshot(reference, "$reference");
  assertExactKeys(reference, [
    "schemaVersion",
    "artifactKind",
    "family",
    "recordId",
    "recordRef",
    "recordDigest",
    "memberRef",
    "memberDigest",
    "role",
  ], [], "$reference");
  if (
    reference.schemaVersion !== WAKEFLOW_LEDGER_MEMBER_REF_SCHEMA_VERSION
    || reference.artifactKind !== "wakeflow-ledger-member-ref"
  ) {
    fail("wakeflow-ledger-reference", "$reference", "unsupported ledger member reference contract");
  }
  const contract = FAMILY_CONTRACTS[reference.family];
  if (!contract) fail("wakeflow-ledger-reference", "$reference/family", `unsupported reference family ${String(reference.family)}`);
  assertWakeflowId(reference.recordId, contract.idType, "$reference/recordId");
  for (const [field, value] of [["recordRef", reference.recordRef], ["memberRef", reference.memberRef]]) {
    try {
      assertPortableMemberPath(value, `$reference/${field}`);
    } catch (error) {
      if (error instanceof WakeflowLedgerRecordError && error.code === "wakeflow-ledger-member-path") {
        fail("wakeflow-ledger-reference-path", `$reference/${field}`, `${field} must be a portable ledger path`);
      }
      throw error;
    }
  }
  assertDigest(reference.recordDigest, "$reference/recordDigest");
  assertDigest(reference.memberDigest, "$reference/memberDigest");
  assertTrimmedString(reference.role, "$reference/role");
  return contract;
}

/**
 * 重新加载 immutable authority 并同时复核 record/member 摘要、family 和 role 后解析引用。
 */
export function resolveLedgerMemberReference(input = {}) {
  const values = passiveDataObject(input, {
    allowed: ["ledgerRoot", "reference", "expectedFamily", "expectedRole", "expectedProgramId"],
    required: ["ledgerRoot", "reference"],
    label: "$options",
  });
  const {
    ledgerRoot,
    expectedFamily = null,
    expectedRole = null,
    expectedProgramId = null,
  } = values;
  const reference = canonicalRecordSnapshot(values.reference, "$reference");
  const contract = validateMemberReference(reference);
  if (expectedFamily !== null && reference.family !== expectedFamily) {
    fail("wakeflow-ledger-reference-family", "$reference/family", `reference family must be ${expectedFamily}`);
  }
  if (expectedRole !== null && reference.role !== expectedRole) {
    fail("wakeflow-ledger-reference-role", "$reference/role", `reference role must be ${expectedRole}`);
  }
  if (path.posix.basename(reference.recordRef) !== contract.recordFile) {
    fail("wakeflow-ledger-reference-path", "$reference/recordRef", `recordRef must end in ${contract.recordFile}`);
  }
  const relativeRoot = path.posix.dirname(reference.recordRef);
  const loaded = loadLedgerRecord({
    ledgerRoot,
    root: path.join(path.resolve(ledgerRoot), ...relativeRoot.split("/")),
    expectedFamily: reference.family,
    expectedProgramId,
  });
  if (loaded.recordId !== reference.recordId || loaded.recordDigest !== reference.recordDigest) {
    fail("wakeflow-ledger-reference-digest", "$reference/recordDigest", "reference does not match the immutable ledger record");
  }
  const member = loaded.members.find((entry) => (
    path.posix.join(loaded.relativeRoot, entry.path) === reference.memberRef
  ));
  if (!member) fail("wakeflow-ledger-reference-path", "$reference/memberRef", "memberRef is not declared by the ledger record");
  if (member.digest !== reference.memberDigest || member.role !== reference.role) {
    fail("wakeflow-ledger-reference-digest", "$reference/memberDigest", "reference does not match the immutable ledger member");
  }
  return deepFreeze({ record: loaded, member });
}
