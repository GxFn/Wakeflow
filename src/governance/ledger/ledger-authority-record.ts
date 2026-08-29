import type {
  WakeflowConfirmationRecord as ConfirmationRecordWire,
} from "../../contracts/generated/governance/ledger/confirmation-record.generated.js";
import {
  WAKEFLOW_CONFIRMATION_RECORD_SCHEMA,
} from "../../contracts/generated/governance/ledger/confirmation-record.generated.js";
import type {
  WakeflowRequirementRecord as RequirementRecordWire,
} from "../../contracts/generated/governance/ledger/requirement-record.generated.js";
import {
  WAKEFLOW_REQUIREMENT_RECORD_SCHEMA,
} from "../../contracts/generated/governance/ledger/requirement-record.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
import {
  computeCanonicalJsonSha256Digest,
} from "../../foundation/crypto/canonical-json-sha256.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  DeterministicJsonDocumentError,
  parseDeterministicJsonDocument,
  renderDeterministicJsonDocument,
} from "../../foundation/data/deterministic-json-document.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  splitPortableResourcePath,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import {
  createRuntimeJsonSchemaValidator,
} from "../../foundation/schema/runtime-json-schema.js";
import {
  parseUtcInstant,
  UtcInstantError,
  type UtcInstant,
} from "../../foundation/time/utc-instant.js";
import {
  readUtcWallClock,
  UtcWallClockError,
  type UtcWallClock,
} from "../../foundation/time/wall-clock.js";

/**
 * Wakeflow Governance / Ledger：Requirement 与 Confirmation 的不可变权威记录。
 *
 * 这两类记录是 Demand 事件溯源发布流程的上游事实，不是 Demand 事件或可变快照。
 * 记录只声明 Wakeflow 的写入时间 `recordedAt`，不虚构已经认证的人类操作者身份。
 * `status=confirmed` 和 Requirement 到 Demand 的反向索引已经删除：记录存在本身
 * 就表示确认事实，Demand 关系由下游 Authority 引用派生。
 *
 * 本模块只负责 JSON 编解码、类型化标识、文档成员关系和语义摘要。成员字节、
 * 不可变发布、重新加载和引用解析由 `LedgerAuthorityStore` 负责。
 */

const REQUIREMENT_RECORD_ARTIFACT_KIND =
  "wakeflow-requirement-record" as const;
const CONFIRMATION_RECORD_ARTIFACT_KIND =
  "wakeflow-confirmation-record" as const;
const LEDGER_AUTHORITY_RECORD_SCHEMA_VERSION = 1 as const;

export type RequirementDocumentRole =
  RequirementRecordWire["documents"][number]["role"];
export type ConfirmationDocumentRole =
  ConfirmationRecordWire["documents"][number]["role"];
export type LedgerAuthorityDocumentRole =
  | RequirementDocumentRole
  | ConfirmationDocumentRole;

export interface LedgerAuthorityDocument<
  Role extends LedgerAuthorityDocumentRole = LedgerAuthorityDocumentRole,
> {
  readonly role: Role;
  readonly path: PortableResourcePath;
  readonly mediaType: string;
  readonly digest: Sha256Digest;
}

export interface RequirementRecord {
  readonly artifactKind: typeof REQUIREMENT_RECORD_ARTIFACT_KIND;
  readonly schemaVersion: typeof LEDGER_AUTHORITY_RECORD_SCHEMA_VERSION;
  readonly requirementId: WakeflowDurableId<"requirement">;
  readonly programId: WakeflowDurableId<"program">;
  readonly recordedAt: UtcInstant;
  readonly title: string;
  readonly documents: readonly [
    Readonly<LedgerAuthorityDocument<RequirementDocumentRole>>,
    ...Readonly<LedgerAuthorityDocument<RequirementDocumentRole>>[],
  ];
}

export interface ConfirmationRecord {
  readonly artifactKind: typeof CONFIRMATION_RECORD_ARTIFACT_KIND;
  readonly schemaVersion: typeof LEDGER_AUTHORITY_RECORD_SCHEMA_VERSION;
  readonly confirmationId: WakeflowDurableId<"confirmation">;
  readonly programId: WakeflowDurableId<"program">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly recordedAt: UtcInstant;
  readonly title: string;
  readonly documents: readonly [
    Readonly<LedgerAuthorityDocument<ConfirmationDocumentRole>>,
    ...Readonly<LedgerAuthorityDocument<ConfirmationDocumentRole>>[],
  ];
}

export type LedgerAuthorityRecord = RequirementRecord | ConfirmationRecord;

export interface CreateLedgerAuthorityRecordOptions {
  readonly clock?: UtcWallClock;
}

export type LedgerAuthorityRecordErrorReason =
  | "input"
  | "json"
  | "schema"
  | "identifier"
  | "time"
  | "text"
  | "document"
  | "representation";

const ERROR_MESSAGES = {
  "input": "Ledger authority record input is invalid.",
  "json": "Ledger authority record is not passive JSON data.",
  "schema": "Ledger authority record does not satisfy its portable Schema.",
  "identifier": "Ledger authority record contains an invalid typed identity.",
  "time": "Ledger authority record contains an invalid recorded time.",
  "text": "Ledger authority record contains non-canonical text.",
  "document": "Ledger authority document inventory is inconsistent.",
  "representation": "Ledger authority record bytes are not its deterministic domain representation.",
} as const satisfies Readonly<Record<
  LedgerAuthorityRecordErrorReason,
  string
>>;

/** Ledger 权威记录准入或持久化表示验证失败时返回的稳定、脱敏错误。 */
export class LedgerAuthorityRecordError extends Error {
  override readonly name = "LedgerAuthorityRecordError";
  readonly code = "wakeflow-ledger-authority-record" as const;
  readonly reason: LedgerAuthorityRecordErrorReason;
  readonly path: string;

  constructor(reason: LedgerAuthorityRecordErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const SCHEMA_DEPENDENCIES = Object.freeze([
  WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
  WAKEFLOW_SHA256_DIGEST_SCHEMA,
  WAKEFLOW_UTC_INSTANT_SCHEMA,
]);
const validateRequirementWire =
  createRuntimeJsonSchemaValidator<RequirementRecordWire>(
    WAKEFLOW_REQUIREMENT_RECORD_SCHEMA,
    SCHEMA_DEPENDENCIES,
  );
const validateConfirmationWire =
  createRuntimeJsonSchemaValidator<ConfirmationRecordWire>(
    WAKEFLOW_CONFIRMATION_RECORD_SCHEMA,
    SCHEMA_DEPENDENCIES,
  );

const CONTROL_EXCEPT_LF_PATTERN =
  /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;
const REQUIREMENT_DRAFT_FIELDS = Object.freeze([
  "documents",
  "programId",
  "requirementId",
  "title",
] as const);
const CONFIRMATION_DRAFT_FIELDS = Object.freeze([
  "confirmationId",
  "demandId",
  "documents",
  "programId",
  "title",
] as const);
const DRAFT_VALIDATION_INSTANT = parseUtcInstant(
  "1970-01-01T00:00:00.000Z",
  "$draftValidationInstant",
);

function fail(
  reason: LedgerAuthorityRecordErrorReason,
  path: string,
): never {
  throw new LedgerAuthorityRecordError(reason, path);
}

function parseCanonicalText(value: string, path: string): string {
  if (
    !value.isWellFormed()
    || value.normalize("NFC") !== value
    || CONTROL_EXCEPT_LF_PATTERN.test(value)
  ) {
    fail("text", path);
  }
  return value;
}

function parseId<Kind extends "requirement" | "confirmation" | "program" | "demand">(
  value: unknown,
  kind: Kind,
  path: string,
): WakeflowDurableId<Kind> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path);
    throw error;
  }
}

function parseRecordedAt(value: unknown): UtcInstant {
  try {
    return parseUtcInstant(value, "$/recordedAt");
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("time", "$/recordedAt");
    throw error;
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseDocument<Role extends LedgerAuthorityDocumentRole>(
  wire: Readonly<{
    role: Role;
    path: string;
    mediaType: string;
    digest: string;
  }>,
  index: number,
): Readonly<LedgerAuthorityDocument<Role>> {
  const path = `$/documents/${index}`;
  let memberPath: PortableResourcePath;
  try {
    memberPath = parsePortableResourcePath(wire.path, `${path}/path`);
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) {
      fail("document", `${path}/path`);
    }
    throw error;
  }
  if (
    memberPath.toLowerCase() === "record.json"
    || memberPath.toLowerCase().startsWith("record.json/")
  ) {
    fail("document", `${path}/path`);
  }
  let digest: Sha256Digest;
  try {
    digest = parseSha256Digest(wire.digest, `${path}/digest`);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("document", `${path}/digest`);
    throw error;
  }
  return Object.freeze({
    role: wire.role,
    path: memberPath,
    mediaType: parseCanonicalText(wire.mediaType, `${path}/mediaType`),
    digest,
  });
}

function assertDocumentRelations(
  documents: readonly Readonly<LedgerAuthorityDocument>[],
): void {
  const nodesByCaseKey = new Map<
    string,
    Readonly<{ readonly path: string; readonly kind: "directory" | "file" }>
  >();
  for (let index = 0; index < documents.length; index += 1) {
    const document = documents[index];
    if (document === undefined) fail("document", "$/documents");
    const previous = documents[index - 1];
    if (
      previous !== undefined
      && compareText(previous.path, document.path) >= 0
    ) {
      fail("document", `$/documents/${index}/path`);
    }
    const segments = splitPortableResourcePath(document.path);
    for (let depth = 1; depth <= segments.length; depth += 1) {
      const nodePath = segments.slice(0, depth).join("/");
      const kind = depth === segments.length ? "file" as const : "directory" as const;
      const caseKey = nodePath.toLowerCase();
      const existing = nodesByCaseKey.get(caseKey);
      if (
        existing !== undefined
        && (existing.path !== nodePath || existing.kind !== kind)
      ) {
        fail("document", `$/documents/${index}/path`);
      }
      if (existing === undefined) {
        nodesByCaseKey.set(caseKey, Object.freeze({ path: nodePath, kind }));
      }
    }
  }
}

function normalizeRequirement(
  wire: Readonly<RequirementRecordWire>,
): Readonly<RequirementRecord> {
  const documents = Object.freeze(wire.documents.map((document, index) => (
    parseDocument(document, index)
  ))) as RequirementRecord["documents"];
  assertDocumentRelations(documents);
  return Object.freeze({
    artifactKind: REQUIREMENT_RECORD_ARTIFACT_KIND,
    schemaVersion: LEDGER_AUTHORITY_RECORD_SCHEMA_VERSION,
    requirementId: parseId(
      wire.requirementId,
      "requirement",
      "$/requirementId",
    ),
    programId: parseId(wire.programId, "program", "$/programId"),
    recordedAt: parseRecordedAt(wire.recordedAt),
    title: parseCanonicalText(wire.title, "$/title"),
    documents,
  });
}

function normalizeConfirmation(
  wire: Readonly<ConfirmationRecordWire>,
): Readonly<ConfirmationRecord> {
  const documents = Object.freeze(wire.documents.map((document, index) => (
    parseDocument(document, index)
  ))) as ConfirmationRecord["documents"];
  assertDocumentRelations(documents);
  return Object.freeze({
    artifactKind: CONFIRMATION_RECORD_ARTIFACT_KIND,
    schemaVersion: LEDGER_AUTHORITY_RECORD_SCHEMA_VERSION,
    confirmationId: parseId(
      wire.confirmationId,
      "confirmation",
      "$/confirmationId",
    ),
    programId: parseId(wire.programId, "program", "$/programId"),
    demandId: parseId(wire.demandId, "demand", "$/demandId"),
    recordedAt: parseRecordedAt(wire.recordedAt),
    title: parseCanonicalText(wire.title, "$/title"),
    documents,
  });
}

/** 将任意 JSON 值解析为字段集合严格受限的 `Requirement` 或 `Confirmation` 判别联合。 */
export function parseLedgerAuthorityRecord(
  value: unknown,
): Readonly<LedgerAuthorityRecord> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$record");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    throw error;
  }
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(json, "$record");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("schema", "$record");
    throw error;
  }
  if (record.artifactKind === REQUIREMENT_RECORD_ARTIFACT_KIND) {
    const result = validateRequirementWire(json);
    if (!result.ok) fail("schema", result.path);
    return normalizeRequirement(result.value);
  }
  if (record.artifactKind === CONFIRMATION_RECORD_ARTIFACT_KIND) {
    const result = validateConfirmationWire(json);
    if (!result.ok) fail("schema", result.path);
    return normalizeConfirmation(result.value);
  }
  fail("schema", "$/artifactKind");
}

function exactDraft(
  value: unknown,
  fields: readonly string[],
): Readonly<Record<string, unknown>> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$draft");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$draft");
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== fields.length
    || keys.some((key, index) => key !== fields[index])
  ) {
    fail("input", "$draft");
  }
  return record;
}

function recordTime(options: CreateLedgerAuthorityRecordOptions): UtcInstant {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(options, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (Object.keys(record).some((key) => key !== "clock")) {
    fail("input", "$options");
  }
  try {
    return readUtcWallClock(record.clock as UtcWallClock | undefined);
  } catch (error: unknown) {
    if (error instanceof UtcWallClockError) fail("time", "$options/clock");
    throw error;
  }
}

/** 从不含协议头和写入时间的纯数据草稿创建 `Requirement` 权威记录。 */
export function createRequirementRecord(
  draft: unknown,
  options: CreateLedgerAuthorityRecordOptions = {},
): Readonly<RequirementRecord> {
  const record = exactDraft(draft, REQUIREMENT_DRAFT_FIELDS);
  const admitted = parseLedgerAuthorityRecord({
    artifactKind: REQUIREMENT_RECORD_ARTIFACT_KIND,
    schemaVersion: LEDGER_AUTHORITY_RECORD_SCHEMA_VERSION,
    requirementId: record.requirementId,
    programId: record.programId,
    recordedAt: DRAFT_VALIDATION_INSTANT,
    title: record.title,
    documents: record.documents,
  });
  if (admitted.artifactKind !== REQUIREMENT_RECORD_ARTIFACT_KIND) {
    fail("schema", "$/artifactKind");
  }
  return Object.freeze({ ...admitted, recordedAt: recordTime(options) });
}

/** 从不含协议头和写入时间的纯数据草稿创建 `Confirmation` 权威记录。 */
export function createConfirmationRecord(
  draft: unknown,
  options: CreateLedgerAuthorityRecordOptions = {},
): Readonly<ConfirmationRecord> {
  const record = exactDraft(draft, CONFIRMATION_DRAFT_FIELDS);
  const admitted = parseLedgerAuthorityRecord({
    artifactKind: CONFIRMATION_RECORD_ARTIFACT_KIND,
    schemaVersion: LEDGER_AUTHORITY_RECORD_SCHEMA_VERSION,
    confirmationId: record.confirmationId,
    programId: record.programId,
    demandId: record.demandId,
    recordedAt: DRAFT_VALIDATION_INSTANT,
    title: record.title,
    documents: record.documents,
  });
  if (admitted.artifactKind !== CONFIRMATION_RECORD_ARTIFACT_KIND) {
    fail("schema", "$/artifactKind");
  }
  return Object.freeze({ ...admitted, recordedAt: recordTime(options) });
}

/** 按唯一字段顺序渲染确定性格式化 JSON 文档。 */
export function renderLedgerAuthorityRecord(value: unknown): string {
  return renderDeterministicJsonDocument(
    parseLedgerAuthorityRecord(value),
    "$record",
  );
}

/** 解析磁盘文档，并拒绝格式化方式或领域字段顺序发生漂移。 */
export function parseLedgerAuthorityRecordDocument(
  text: unknown,
): Readonly<LedgerAuthorityRecord> {
  let json: JsonValue;
  try {
    json = parseDeterministicJsonDocument(text, "$record");
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      fail("representation", error.path);
    }
    throw error;
  }
  const record = parseLedgerAuthorityRecord(json);
  if (renderLedgerAuthorityRecord(record) !== text) {
    fail("representation", "$record");
  }
  return record;
}

/** 计算与 JSON 字段顺序无关的 Ledger 权威记录语义摘要。 */
export function computeLedgerAuthorityRecordDigest(
  value: unknown,
): Sha256Digest {
  return computeCanonicalJsonSha256Digest(
    parseLedgerAuthorityRecord(value),
  );
}
