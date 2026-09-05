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
 * Wakeflow Governance / Ledger：需求包的不可变权威记录（ADR-0011 D1 D3 D4）。
 *
 * 一份需求包是 `requirements/<requirementId>/` 下的一条 Ledger 记录：`record.json`
 * 加成员 `requirement.md`、`landing.md` 与可选 `attachments/<name>`。记录头部携带
 * demandType、优先级、来源窗口、测试决策、任务计划评审方、supersedes 链、确认点 1
 * 的摘要与章节锚点表。记录只声明 Wakeflow 的写入时间 `recordedAt`，不虚构已经
 * 认证的人类操作者身份；记录存在本身就表示需求包已发布。
 *
 * 本模块只负责 JSON 编解码、类型化标识、成员与章节的结构关系和语义摘要。章节必需
 * 表、标题别名、隐私扫描与 requirementId 的内容派生由 requirement 切片在发布时
 * 校验；成员字节、不可变发布、重新加载和引用解析由 `LedgerAuthorityStore` 负责。
 */

const REQUIREMENT_RECORD_ARTIFACT_KIND =
  "wakeflow-requirement-record" as const;
const LEDGER_AUTHORITY_RECORD_SCHEMA_VERSION = 1 as const;
const REQUIREMENT_DOCUMENT_PATH = "requirement.md";
const LANDING_DOCUMENT_PATH = "landing.md";
const ATTACHMENTS_DIRECTORY = "attachments";

export type RequirementDocumentRole =
  RequirementRecordWire["documents"][number]["role"];
export type RequirementDemandType = RequirementRecordWire["demandType"];
export type RequirementPriority = RequirementRecordWire["priority"];
export type RequirementTestingMode =
  RequirementRecordWire["testingDecision"]["mode"];
export type RequirementTaskPlanReview = RequirementRecordWire["taskPlanReview"];

export interface LedgerAuthorityDocument {
  readonly role: RequirementDocumentRole;
  readonly path: PortableResourcePath;
  readonly mediaType: string;
  readonly digest: Sha256Digest;
}

export interface RequirementTestingDecision {
  readonly mode: RequirementTestingMode;
  readonly summary: string;
}

/** 确认点 1 的持久摘要：用户确认的时刻与被确认章节的正文摘要。 */
export interface RequirementConfirmationPoint {
  readonly confirmedAt: UtcInstant;
  readonly sectionDigest: Sha256Digest;
}

/** 成员文档中的一个 H2 章节；锚点供任务包按“记录摘要加章节锚点”引用。 */
export interface RequirementSection {
  readonly path: PortableResourcePath;
  readonly anchor: string;
  readonly heading: string;
  readonly line: number;
  readonly bodyDigest: Sha256Digest;
}

export interface RequirementRecord {
  readonly artifactKind: typeof REQUIREMENT_RECORD_ARTIFACT_KIND;
  readonly schemaVersion: typeof LEDGER_AUTHORITY_RECORD_SCHEMA_VERSION;
  readonly requirementId: WakeflowDurableId<"requirement">;
  readonly programId: WakeflowDurableId<"program">;
  readonly recordedAt: UtcInstant;
  readonly title: string;
  readonly demandType: RequirementDemandType;
  readonly priority: RequirementPriority;
  readonly originWindowId: WakeflowDurableId<"window">;
  readonly testingDecision: Readonly<RequirementTestingDecision>;
  readonly taskPlanReview: RequirementTaskPlanReview;
  readonly supersedes: WakeflowDurableId<"requirement"> | null;
  /** 发布时的搁置触发条件；有值即以 parked 上板，recover 据此重建看板状态。 */
  readonly parked: Readonly<{ readonly trigger: string }> | null;
  readonly confirmation: Readonly<RequirementConfirmationPoint>;
  readonly documents: readonly Readonly<LedgerAuthorityDocument>[];
  readonly sections: readonly Readonly<RequirementSection>[];
}

/** Ledger 权威记录只剩需求包一种；别名保留给按家族读取的消费方。 */
export type LedgerAuthorityRecord = RequirementRecord;

type RequirementRecordDraftFields = Omit<
  RequirementRecord,
  "artifactKind" | "schemaVersion" | "recordedAt"
>;

/**
 * 创建输入：省略协议头与写入时间。标识字段接受 `<kind>_<uuid>` 文本外形，由
 * 编解码器解析并授予品牌；已解析的类型化标识原样通过。
 */
export interface CreateRequirementRecordInput extends Omit<
  RequirementRecordDraftFields,
  "requirementId" | "programId" | "originWindowId" | "supersedes"
> {
  readonly requirementId: `requirement_${string}`;
  readonly programId: `program_${string}`;
  readonly originWindowId: `window_${string}`;
  readonly supersedes: `requirement_${string}` | null;
}

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
  | "section"
  | "relation"
  | "representation";

const ERROR_MESSAGES = {
  "input": "Ledger authority record input is invalid.",
  "json": "Ledger authority record is not passive JSON data.",
  "schema": "Ledger authority record does not satisfy its portable Schema.",
  "identifier": "Ledger authority record contains an invalid typed identity.",
  "time": "Ledger authority record contains an invalid instant.",
  "text": "Ledger authority record contains non-canonical text.",
  "document": "Ledger authority document inventory is inconsistent.",
  "section": "Ledger authority section table is inconsistent.",
  "relation": "Ledger authority record header fields contradict each other.",
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

const validateRequirementWire =
  createRuntimeJsonSchemaValidator<RequirementRecordWire>(
    WAKEFLOW_REQUIREMENT_RECORD_SCHEMA,
    [
      WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
      WAKEFLOW_SHA256_DIGEST_SCHEMA,
      WAKEFLOW_UTC_INSTANT_SCHEMA,
    ],
  );

const CONTROL_EXCEPT_LF_PATTERN =
  /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;
const REQUIREMENT_DRAFT_FIELDS = Object.freeze([
  "confirmation",
  "demandType",
  "documents",
  "originWindowId",
  "parked",
  "priority",
  "programId",
  "requirementId",
  "sections",
  "supersedes",
  "taskPlanReview",
  "testingDecision",
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

function parseId<Kind extends "requirement" | "program" | "window">(
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

function parseInstant(value: unknown, path: string): UtcInstant {
  try {
    return parseUtcInstant(value, path);
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("time", path);
    throw error;
  }
}

function parseDigest(
  value: unknown,
  reason: LedgerAuthorityRecordErrorReason,
  path: string,
): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail(reason, path);
    throw error;
  }
}

function parseMemberPath(
  value: unknown,
  reason: LedgerAuthorityRecordErrorReason,
  path: string,
): PortableResourcePath {
  let memberPath: PortableResourcePath;
  try {
    memberPath = parsePortableResourcePath(value, path);
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) fail(reason, path);
    throw error;
  }
  if (
    memberPath.toLowerCase() === "record.json"
    || memberPath.toLowerCase().startsWith("record.json/")
  ) {
    fail(reason, path);
  }
  return memberPath;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseDocument(
  wire: RequirementRecordWire["documents"][number],
  index: number,
): Readonly<LedgerAuthorityDocument> {
  const path = `$/documents/${index}`;
  const memberPath = parseMemberPath(wire.path, "document", `${path}/path`);
  const segments = splitPortableResourcePath(memberPath);
  const roleMatchesPath = wire.role === "requirement"
    ? memberPath === REQUIREMENT_DOCUMENT_PATH
    : wire.role === "landing"
      ? memberPath === LANDING_DOCUMENT_PATH
      : segments.length === 2 && segments[0] === ATTACHMENTS_DIRECTORY;
  if (!roleMatchesPath) fail("document", `${path}/path`);
  return Object.freeze({
    role: wire.role,
    path: memberPath,
    mediaType: parseCanonicalText(wire.mediaType, `${path}/mediaType`),
    digest: parseDigest(wire.digest, "document", `${path}/digest`),
  });
}

/** 成员按路径严格升序、无大小写冲突，且恰有一份 requirement.md 与一份 landing.md。 */
function assertDocumentRelations(
  documents: readonly Readonly<LedgerAuthorityDocument>[],
): void {
  const nodesByCaseKey = new Map<
    string,
    Readonly<{ readonly path: string; readonly kind: "directory" | "file" }>
  >();
  let requirementCount = 0;
  let landingCount = 0;
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
    if (document.role === "requirement") requirementCount += 1;
    if (document.role === "landing") landingCount += 1;
  }
  if (requirementCount !== 1 || landingCount !== 1) {
    fail("document", "$/documents");
  }
}

function parseSection(
  wire: RequirementRecordWire["sections"][number],
  index: number,
): Readonly<RequirementSection> {
  const path = `$/sections/${index}`;
  if (!Number.isInteger(wire.line) || wire.line < 1) {
    fail("section", `${path}/line`);
  }
  return Object.freeze({
    path: parseMemberPath(wire.path, "section", `${path}/path`),
    anchor: parseCanonicalText(wire.anchor, `${path}/anchor`),
    heading: parseCanonicalText(wire.heading, `${path}/heading`),
    line: wire.line,
    bodyDigest: parseDigest(wire.bodyDigest, "section", `${path}/bodyDigest`),
  });
}

/** 章节只能指向成员文档，且同一文档内锚点唯一。 */
function assertSectionRelations(
  documents: readonly Readonly<LedgerAuthorityDocument>[],
  sections: readonly Readonly<RequirementSection>[],
): void {
  const documentPaths = new Set<string>(documents.map((document) => document.path));
  const seen = new Set<string>();
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    if (section === undefined) fail("section", "$/sections");
    if (!documentPaths.has(section.path)) {
      fail("section", `$/sections/${index}/path`);
    }
    const key = `${section.path}\u0000${section.anchor}`;
    if (seen.has(key)) fail("section", `$/sections/${index}/anchor`);
    seen.add(key);
  }
}

function normalizeRequirement(
  wire: Readonly<RequirementRecordWire>,
): Readonly<RequirementRecord> {
  const requirementId = parseId(
    wire.requirementId,
    "requirement",
    "$/requirementId",
  );
  const supersedes = wire.supersedes === null
    ? null
    : parseId(wire.supersedes, "requirement", "$/supersedes");
  if (supersedes === requirementId) fail("relation", "$/supersedes");
  if (
    (wire.demandType === "research")
    !== (wire.testingDecision.mode === "not-applicable")
  ) {
    fail("relation", "$/testingDecision/mode");
  }
  const documents = Object.freeze(wire.documents.map((document, index) => (
    parseDocument(document, index)
  )));
  assertDocumentRelations(documents);
  const sections = Object.freeze(wire.sections.map((section, index) => (
    parseSection(section, index)
  )));
  assertSectionRelations(documents, sections);
  return Object.freeze({
    artifactKind: REQUIREMENT_RECORD_ARTIFACT_KIND,
    schemaVersion: LEDGER_AUTHORITY_RECORD_SCHEMA_VERSION,
    requirementId,
    programId: parseId(wire.programId, "program", "$/programId"),
    recordedAt: parseInstant(wire.recordedAt, "$/recordedAt"),
    title: parseCanonicalText(wire.title, "$/title"),
    demandType: wire.demandType,
    priority: wire.priority,
    originWindowId: parseId(wire.originWindowId, "window", "$/originWindowId"),
    testingDecision: Object.freeze({
      mode: wire.testingDecision.mode,
      summary: parseCanonicalText(
        wire.testingDecision.summary,
        "$/testingDecision/summary",
      ),
    }),
    taskPlanReview: wire.taskPlanReview,
    supersedes,
    parked: wire.parked === null
      ? null
      : Object.freeze({
        trigger: parseCanonicalText(wire.parked.trigger, "$/parked/trigger"),
      }),
    confirmation: Object.freeze({
      confirmedAt: parseInstant(
        wire.confirmation.confirmedAt,
        "$/confirmation/confirmedAt",
      ),
      sectionDigest: parseDigest(
        wire.confirmation.sectionDigest,
        "schema",
        "$/confirmation/sectionDigest",
      ),
    }),
    documents,
    sections,
  });
}

/** 将任意 JSON 值解析为字段集合严格受限、关系已闭合的需求包记录。 */
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
  if (record.artifactKind !== REQUIREMENT_RECORD_ARTIFACT_KIND) {
    fail("schema", "$/artifactKind");
  }
  const result = validateRequirementWire(json);
  if (!result.ok) fail("schema", result.path);
  return normalizeRequirement(result.value);
}

function exactDraft(value: unknown): Readonly<Record<string, unknown>> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$draft");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$draft");
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== REQUIREMENT_DRAFT_FIELDS.length
    || keys.some((key, index) => key !== REQUIREMENT_DRAFT_FIELDS[index])
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

/**
 * 从不含协议头和写入时间的草稿创建需求包记录。
 *
 * 草稿的全部结构关系先以占位时间闭合，再读取墙上时钟；关系失败时不触碰时钟。
 */
export function createRequirementRecord(
  input: CreateRequirementRecordInput,
  options: CreateLedgerAuthorityRecordOptions = {},
): Readonly<RequirementRecord> {
  const draft = exactDraft(input);
  const admitted = parseLedgerAuthorityRecord({
    artifactKind: REQUIREMENT_RECORD_ARTIFACT_KIND,
    schemaVersion: LEDGER_AUTHORITY_RECORD_SCHEMA_VERSION,
    requirementId: draft.requirementId,
    programId: draft.programId,
    recordedAt: DRAFT_VALIDATION_INSTANT,
    title: draft.title,
    demandType: draft.demandType,
    priority: draft.priority,
    originWindowId: draft.originWindowId,
    testingDecision: draft.testingDecision,
    taskPlanReview: draft.taskPlanReview,
    supersedes: draft.supersedes,
    parked: draft.parked,
    confirmation: draft.confirmation,
    documents: draft.documents,
    sections: draft.sections,
  });
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
