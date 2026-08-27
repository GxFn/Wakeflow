import type {
  WakeflowLedgerRecordPublicationIntent as LedgerRecordPublicationIntentWire,
} from "../../contracts/generated/governance/ledger/ledger-record-publication-intent.generated.js";
import {
  WAKEFLOW_LEDGER_RECORD_PUBLICATION_INTENT_SCHEMA,
} from "../../contracts/generated/governance/ledger/ledger-record-publication-intent.generated.js";
import { WAKEFLOW_DIRECTORY_TREE_CANDIDATE_PLAN_SCHEMA } from "../../contracts/generated/foundation/directory-tree-candidate-plan.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
import { WAKEFLOW_CONFIRMATION_RECORD_SCHEMA } from "../../contracts/generated/governance/ledger/confirmation-record.generated.js";
import { WAKEFLOW_REQUIREMENT_RECORD_SCHEMA } from "../../contracts/generated/governance/ledger/requirement-record.generated.js";
import { computeSha256Digest } from "../../foundation/crypto/sha256.js";
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
  parseDirectoryTreeCandidatePlan,
  DurableDirectoryTreeCandidateError,
  type DirectoryTreeCandidatePlan,
} from "../../foundation/filesystem/durable-directory-tree-candidate.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import {
  ledgerAuthorityFamily,
  ledgerAuthorityRecordId,
  ledgerAuthorityRootRef,
  ledgerRecordPublicationIntentRef,
  ledgerRecordPublicationLockRef,
  ledgerRecordPublicationStageRef,
  type LedgerAuthorityFamily,
  type LedgerAuthorityRecordId,
} from "./ledger-authority-paths.js";
import {
  parseLedgerAuthorityRecord,
  renderLedgerAuthorityRecord,
  LedgerAuthorityRecordError,
  type LedgerAuthorityRecord,
} from "./ledger-authority-record.js";
import {
  LEDGER_DURABLE_DIRECTORY_MODE,
  LEDGER_DURABLE_FILE_MODE,
} from "./ledger-authority-storage-policy.js";

/**
 * Wakeflow Governance / Ledger：不可变记录目录树的短期发布意图记录。
 *
 * 发布意图记录只保存经过验证的 Ledger 记录、目录树精确清单和派生路径，不复制成员
 * 载荷。崩溃恢复使用它判断暂存目录和最终目录的归属，并重建提交计划；只有清单闭合
 * 的暂存目录才包含可发布数据。如果暂存目录仍缺少成员字节，恢复流程必须等待原调用
 * 重试，不能根据意图记录虚构内容。
 */

export const LEDGER_RECORD_PUBLICATION_INTENT_ARTIFACT_KIND =
  "wakeflow-ledger-record-publication-intent" as const;
export const LEDGER_RECORD_PUBLICATION_INTENT_SCHEMA_VERSION = 1 as const;

export interface LedgerRecordPublicationIntent {
  readonly artifactKind: typeof LEDGER_RECORD_PUBLICATION_INTENT_ARTIFACT_KIND;
  readonly schemaVersion: typeof LEDGER_RECORD_PUBLICATION_INTENT_SCHEMA_VERSION;
  readonly family: LedgerAuthorityFamily;
  readonly recordId: LedgerAuthorityRecordId;
  readonly record: Readonly<LedgerAuthorityRecord>;
  readonly finalRootRef: ReturnType<typeof ledgerAuthorityRootRef>;
  readonly intentRef: ReturnType<typeof ledgerRecordPublicationIntentRef>;
  readonly lockRef: ReturnType<typeof ledgerRecordPublicationLockRef>;
  readonly stageRef: ReturnType<typeof ledgerRecordPublicationStageRef>;
  readonly treePlan: Readonly<DirectoryTreeCandidatePlan>;
}

export type LedgerRecordPublicationIntentErrorReason =
  | "input"
  | "json"
  | "schema"
  | "record"
  | "tree-plan"
  | "relation"
  | "representation";

const ERROR_MESSAGES = {
  input: "Ledger record publication intent input is invalid.",
  json: "Ledger record publication intent is not passive JSON data.",
  schema: "Ledger record publication intent does not satisfy its portable Schema.",
  record: "Ledger record publication intent contains an invalid authority record.",
  "tree-plan": "Ledger record publication intent contains an invalid closed tree plan.",
  relation: "Ledger record publication intent does not describe one exact record tree.",
  representation: "Ledger record publication intent bytes are not deterministic.",
} as const satisfies Readonly<Record<
  LedgerRecordPublicationIntentErrorReason,
  string
>>;

/** Ledger 发布意图记录准入失败时返回的稳定、脱敏错误。 */
export class LedgerRecordPublicationIntentError extends Error {
  override readonly name = "LedgerRecordPublicationIntentError";
  readonly code = "wakeflow-ledger-record-publication-intent" as const;
  readonly reason: LedgerRecordPublicationIntentErrorReason;
  readonly path: string;

  constructor(
    reason: LedgerRecordPublicationIntentErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWire = createRuntimeJsonSchemaValidator<LedgerRecordPublicationIntentWire>(
  WAKEFLOW_LEDGER_RECORD_PUBLICATION_INTENT_SCHEMA,
  [
    WAKEFLOW_DIRECTORY_TREE_CANDIDATE_PLAN_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
    WAKEFLOW_CONFIRMATION_RECORD_SCHEMA,
    WAKEFLOW_REQUIREMENT_RECORD_SCHEMA,
  ],
);

function fail(
  reason: LedgerRecordPublicationIntentErrorReason,
  path: string,
): never {
  throw new LedgerRecordPublicationIntentError(reason, path);
}

function normalizeRecord(value: unknown): Readonly<LedgerAuthorityRecord> {
  try {
    return parseLedgerAuthorityRecord(value);
  } catch (error: unknown) {
    if (error instanceof LedgerAuthorityRecordError) fail("record", "$/record");
    throw error;
  }
}

function normalizeTreePlan(value: unknown): Readonly<DirectoryTreeCandidatePlan> {
  try {
    return parseDirectoryTreeCandidatePlan(value);
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryTreeCandidateError) {
      fail("tree-plan", "$/treePlan");
    }
    throw error;
  }
}

function expectedPlanFiles(record: Readonly<LedgerAuthorityRecord>) {
  const recordBytes = encodeUtf8(renderLedgerAuthorityRecord(record));
  return Object.freeze([{
    path: "record.json",
    digest: computeSha256Digest(recordBytes),
    mode: LEDGER_DURABLE_FILE_MODE,
    byteCount: recordBytes.byteLength,
  }, ...record.documents.map((document) => ({
    path: document.path,
    digest: document.digest,
    mode: LEDGER_DURABLE_FILE_MODE,
    byteCount: null,
  }))].sort((left, right) => (
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  )));
}

function assertTreePlanMatchesRecord(
  record: Readonly<LedgerAuthorityRecord>,
  plan: Readonly<DirectoryTreeCandidatePlan>,
): void {
  const expected = expectedPlanFiles(record);
  if (
    plan.directoryMode !== LEDGER_DURABLE_DIRECTORY_MODE
    || plan.files.length !== expected.length
  ) {
    fail("relation", "$/treePlan");
  }
  for (const [index, file] of plan.files.entries()) {
    const target = expected[index];
    if (
      target === undefined
      || file.path !== target.path
      || file.digest !== target.digest
      || file.mode !== target.mode
      || (target.byteCount !== null && file.byteCount !== target.byteCount)
    ) {
      fail("relation", `$/treePlan/files/${index}`);
    }
  }
}

function normalize(
  wire: Readonly<LedgerRecordPublicationIntentWire>,
): Readonly<LedgerRecordPublicationIntent> {
  const record = normalizeRecord(wire.record);
  const treePlan = normalizeTreePlan(wire.treePlan);
  assertTreePlanMatchesRecord(record, treePlan);
  const family = ledgerAuthorityFamily(record);
  const recordId = ledgerAuthorityRecordId(record);
  const finalRootRef = ledgerAuthorityRootRef(record);
  const intentRef = ledgerRecordPublicationIntentRef(record);
  const lockRef = ledgerRecordPublicationLockRef(record);
  const stageRef = ledgerRecordPublicationStageRef(record);
  if (
    wire.family !== family
    || wire.recordId !== recordId
    || wire.finalRootRef !== finalRootRef
    || wire.intentRef !== intentRef
    || wire.lockRef !== lockRef
    || wire.stageRef !== stageRef
  ) {
    fail("relation", "$intent");
  }
  return Object.freeze({
    artifactKind: LEDGER_RECORD_PUBLICATION_INTENT_ARTIFACT_KIND,
    schemaVersion: LEDGER_RECORD_PUBLICATION_INTENT_SCHEMA_VERSION,
    family,
    recordId,
    record,
    finalRootRef,
    intentRef,
    lockRef,
    stageRef,
    treePlan,
  });
}

/** 将任意 JSON 值准入为字段关系已经验证的 Ledger 发布意图记录。 */
export function parseLedgerRecordPublicationIntent(
  value: unknown,
): Readonly<LedgerRecordPublicationIntent> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$intent");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    throw error;
  }
  const result = validateWire(json);
  if (!result.ok) fail("schema", result.path);
  return normalize(result.value);
}

/** 从已验证记录和目录树精确清单创建不含成员载荷的精简发布意图记录。 */
export function createLedgerRecordPublicationIntent(
  recordValue: unknown,
  treePlanValue: unknown,
): Readonly<LedgerRecordPublicationIntent> {
  const record = normalizeRecord(recordValue);
  const treePlan = normalizeTreePlan(treePlanValue);
  return parseLedgerRecordPublicationIntent({
    artifactKind: LEDGER_RECORD_PUBLICATION_INTENT_ARTIFACT_KIND,
    schemaVersion: LEDGER_RECORD_PUBLICATION_INTENT_SCHEMA_VERSION,
    family: ledgerAuthorityFamily(record),
    recordId: ledgerAuthorityRecordId(record),
    record,
    finalRootRef: ledgerAuthorityRootRef(record),
    intentRef: ledgerRecordPublicationIntentRef(record),
    lockRef: ledgerRecordPublicationLockRef(record),
    stageRef: ledgerRecordPublicationStageRef(record),
    treePlan,
  });
}

/** 渲染唯一的确定性格式化 JSON 表示。 */
export function renderLedgerRecordPublicationIntent(value: unknown): string {
  return renderDeterministicJsonDocument(
    parseLedgerRecordPublicationIntent(value) as unknown as JsonValue,
    "$intent",
  );
}

/** 解析磁盘中的发布意图记录，并拒绝任何持久化表示漂移。 */
export function parseLedgerRecordPublicationIntentDocument(
  text: unknown,
): Readonly<LedgerRecordPublicationIntent> {
  let json: JsonValue;
  try {
    json = parseDeterministicJsonDocument(text, "$intent");
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      fail("representation", error.path);
    }
    throw error;
  }
  const intent = parseLedgerRecordPublicationIntent(json);
  if (renderLedgerRecordPublicationIntent(intent) !== text) {
    fail("representation", "$intent");
  }
  return intent;
}

/** 比较两份已准入的意图记录是否描述同一次精确发布。 */
export function sameLedgerRecordPublicationIntent(
  leftValue: unknown,
  rightValue: unknown,
): boolean {
  return renderLedgerRecordPublicationIntent(leftValue)
    === renderLedgerRecordPublicationIntent(rightValue);
}
