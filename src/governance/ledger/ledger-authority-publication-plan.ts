import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  LEDGER_AUTHORITY_PUBLICATION_MEMBER_MEDIA_TYPE,
  LedgerAuthorityPublicationInputError,
  parseConfirmationAuthorityPublicationInput,
  parseRequirementAuthorityPublicationInput,
  type LedgerAuthorityPublicationInput,
} from "./ledger-authority-publication-input.js";
import {
  parseLedgerRecordPublicationIntent,
  LedgerRecordPublicationIntentError,
  type LedgerRecordPublicationIntent,
} from "./ledger-record-publication-intent.js";

/**
 * Wakeflow Governance / Ledger：Requirement/Confirmation发布的零写确认计划。
 *
 * Plan只增加当前Config摘要和Design surface身份；完整Record、成员描述符、目标路径与
 * tree digest均复用compact publication intent。成员正文不进入Plan，Apply必须重新稳定
 * 读取同一Design source并复验Intent中的path、size和digest。Plan摘要只证明调用方交回
 * 同一份preview，不授予写入或恢复权限。
 */

export const LEDGER_AUTHORITY_PUBLICATION_PLAN_KIND =
  "WakeflowLedgerAuthorityPublicationPlan" as const;
export const LEDGER_AUTHORITY_PUBLICATION_PLAN_VERSION = 1 as const;

export interface LedgerAuthorityPublicationPlan {
  readonly kind: typeof LEDGER_AUTHORITY_PUBLICATION_PLAN_KIND;
  readonly schemaVersion: typeof LEDGER_AUTHORITY_PUBLICATION_PLAN_VERSION;
  readonly configDigest: Sha256Digest;
  readonly designSurfaceId: LedgerAuthorityPublicationInput["designSurfaceId"];
  readonly intent: Readonly<LedgerRecordPublicationIntent>;
}

export type LedgerAuthorityPublicationPlanErrorReason =
  | "input"
  | "digest"
  | "intent"
  | "source-profile";

const ERROR_MESSAGES = {
  input: "Ledger authority publication plan input is invalid.",
  digest: "Ledger authority publication plan Config digest is invalid.",
  intent: "Ledger authority publication plan contains an invalid publication intent.",
  "source-profile":
    "Ledger authority publication plan does not satisfy the Design Markdown source profile.",
} as const satisfies Readonly<Record<
  LedgerAuthorityPublicationPlanErrorReason,
  string
>>;

/** Ledger零写计划无法关闭当前Config、source profile与发布Intent时的稳定错误。 */
export class LedgerAuthorityPublicationPlanError extends Error {
  override readonly name = "LedgerAuthorityPublicationPlanError";
  readonly code = "wakeflow-ledger-authority-publication-plan" as const;
  readonly reason: LedgerAuthorityPublicationPlanErrorReason;
  readonly path: string;

  constructor(
    reason: LedgerAuthorityPublicationPlanErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const PLAN_FIELDS = Object.freeze([
  "configDigest",
  "designSurfaceId",
  "intent",
  "kind",
  "schemaVersion",
] as const);
const DRAFT_FIELDS = Object.freeze([
  "configDigest",
  "designSurfaceId",
  "intent",
] as const);

function fail(
  reason: LedgerAuthorityPublicationPlanErrorReason,
  path: string,
): never {
  throw new LedgerAuthorityPublicationPlanError(reason, path);
}

function exactRecord(
  value: unknown,
  fields: readonly string[],
  path: string,
): Readonly<Record<string, unknown>> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", path);
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== fields.length
    || keys.some((key, index) => key !== fields[index])
  ) {
    fail("input", path);
  }
  return record;
}

function parseConfigDigest(value: unknown): Sha256Digest {
  try {
    return parseSha256Digest(value, "$/configDigest");
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", "$/configDigest");
    throw error;
  }
}

function parseIntent(value: unknown): Readonly<LedgerRecordPublicationIntent> {
  try {
    return parseLedgerRecordPublicationIntent(value);
  } catch (error: unknown) {
    if (error instanceof LedgerRecordPublicationIntentError) {
      fail("intent", "$/intent");
    }
    throw error;
  }
}

function parseSourceProfile(
  designSurfaceId: unknown,
  intent: Readonly<LedgerRecordPublicationIntent>,
): LedgerAuthorityPublicationInput["designSurfaceId"] {
  if (
    intent.record.documents.some(
      (document) =>
        document.mediaType !== LEDGER_AUTHORITY_PUBLICATION_MEMBER_MEDIA_TYPE,
    )
  ) {
    fail("source-profile", "$/intent/record/documents");
  }
  const input = {
    title: intent.record.title,
    designSurfaceId,
    documents: intent.record.documents.map(({ role, path }) => ({
      role,
      path,
    })),
  };
  try {
    return intent.record.artifactKind === "wakeflow-requirement-record"
      ? parseRequirementAuthorityPublicationInput(input).designSurfaceId
      : parseConfirmationAuthorityPublicationInput(input).designSurfaceId;
  } catch (error: unknown) {
    if (error instanceof LedgerAuthorityPublicationInputError) {
      fail(
        "source-profile",
        error.reason === "identifier"
          ? "$/designSurfaceId"
          : "$/intent/record",
      );
    }
    throw error;
  }
}

/** 重新解析并冻结一份字段集合与source profile均关闭的零写Plan。 */
export function parseLedgerAuthorityPublicationPlan(
  value: unknown,
): Readonly<LedgerAuthorityPublicationPlan> {
  const record = exactRecord(value, PLAN_FIELDS, "$plan");
  if (
    record.kind !== LEDGER_AUTHORITY_PUBLICATION_PLAN_KIND
    || record.schemaVersion !== LEDGER_AUTHORITY_PUBLICATION_PLAN_VERSION
  ) {
    fail("input", "$plan");
  }
  const intent = parseIntent(record.intent);
  return Object.freeze({
    kind: LEDGER_AUTHORITY_PUBLICATION_PLAN_KIND,
    schemaVersion: LEDGER_AUTHORITY_PUBLICATION_PLAN_VERSION,
    configDigest: parseConfigDigest(record.configDigest),
    designSurfaceId: parseSourceProfile(record.designSurfaceId, intent),
    intent,
  });
}

/** 从Planning已确认的Config、Design surface和compact Intent创建Plan。 */
export function createLedgerAuthorityPublicationPlan(
  value: unknown,
): Readonly<LedgerAuthorityPublicationPlan> {
  const record = exactRecord(value, DRAFT_FIELDS, "$draft");
  return parseLedgerAuthorityPublicationPlan({
    kind: LEDGER_AUTHORITY_PUBLICATION_PLAN_KIND,
    schemaVersion: LEDGER_AUTHORITY_PUBLICATION_PLAN_VERSION,
    configDigest: record.configDigest,
    designSurfaceId: record.designSurfaceId,
    intent: record.intent,
  });
}

/** 计算Public preview/apply使用的Canonical Plan摘要。 */
export function computeLedgerAuthorityPublicationPlanDigest(
  value: unknown,
): Sha256Digest {
  return computeCanonicalJsonSha256Digest(
    parseLedgerAuthorityPublicationPlan(value),
  );
}
