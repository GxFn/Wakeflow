import type { WakeflowImplementationTargetResultReport as ReportWire } from "../../contracts/generated/governance/result/implementation-target-result-report.generated.js";
import { WAKEFLOW_IMPLEMENTATION_TARGET_RESULT_REPORT_SCHEMA } from "../../contracts/generated/governance/result/implementation-target-result-report.generated.js";
import { WAKEFLOW_GIT_OBJECT_ID_SCHEMA } from "../../contracts/generated/foundation/git-object-id.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
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
  type JsonObject,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  parseGitObjectId,
  GitObjectIdError,
  type GitObjectId,
} from "../../foundation/git/git-object-id.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
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
import type {
  TargetResultEvidenceLocator,
  TargetResultOutcome,
} from "./target-result-report-contract.js";

/**
 * Wakeflow Governance / Result：目标 Agent 提交的单仓库 implementation 结果陈述。
 *
 * Report只描述目标窗口声称完成了什么、留下了哪些repository状态和review输入；它不声明
 * transport、Claim、Event或Controller acceptance。Import owner会从当前Event Sourcing
 * authority补齐这些事实后再生成TargetResult。
 */

const REPORT_KIND = "WakeflowImplementationTargetResultReport" as const;
const REPORT_SCHEMA_VERSION = 1 as const;
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const CONTROL_EXCEPT_LF_PATTERN =
  /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;

export type ImplementationTargetResultRepositoryDisposition =
  "committed" | "left-uncommitted" | "no-changes";

export interface ImplementationTargetResultAnchorEvidence {
  readonly anchorId: string;
  readonly evidenceRefs: readonly Readonly<{
    readonly ref: PortableResourcePath;
    readonly digest: Sha256Digest;
  }>[];
}

export interface ImplementationTargetResultReportContent {
  readonly outcome: TargetResultOutcome;
  readonly summary: string;
  readonly repositoryChange: Readonly<{
    readonly repositoryId: WakeflowDurableId<"repository">;
    readonly disposition: ImplementationTargetResultRepositoryDisposition;
    readonly commits: readonly Readonly<GitObjectId>[];
  }>;
  readonly evidenceLocators: readonly Readonly<TargetResultEvidenceLocator>[];
  readonly verification: readonly string[];
  readonly risks: readonly string[];
  readonly anchorEvidence: readonly Readonly<ImplementationTargetResultAnchorEvidence>[];
}

export interface ImplementationTargetResultReport extends ImplementationTargetResultReportContent {
  readonly kind: typeof REPORT_KIND;
  readonly schemaVersion: typeof REPORT_SCHEMA_VERSION;
  readonly reportedAt: UtcInstant;
  readonly reportDigest: Sha256Digest;
}

export interface CreateImplementationTargetResultReportOptions {
  readonly clock?: UtcWallClock;
}

export type ImplementationTargetResultReportErrorReason =
  | "input"
  | "schema"
  | "identifier"
  | "digest"
  | "path"
  | "git-object-id"
  | "text"
  | "time"
  | "relation"
  | "representation";

const ERROR_MESSAGES = {
  input: "Implementation Target Result Report is not passive closed JSON data.",
  schema: "Implementation Target Result Report does not satisfy its Schema.",
  identifier:
    "Implementation Target Result Report contains an invalid identity.",
  digest:
    "Implementation Target Result Report contains an invalid or inconsistent digest.",
  path: "Implementation Target Result Report contains an invalid portable resource path.",
  "git-object-id":
    "Implementation Target Result Report contains an invalid Git object ID.",
  text: "Implementation Target Result Report contains invalid human text or token text.",
  time: "Implementation Target Result Report contains an invalid time.",
  relation: "Implementation Target Result Report facts are inconsistent.",
  representation:
    "Implementation Target Result Report bytes are not deterministic.",
} as const satisfies Readonly<
  Record<ImplementationTargetResultReportErrorReason, string>
>;

export class ImplementationTargetResultReportError extends Error {
  override readonly name = "ImplementationTargetResultReportError";
  readonly code = "wakeflow-implementation-target-result-report" as const;
  readonly reason: ImplementationTargetResultReportErrorReason;
  readonly path: string;

  constructor(
    reason: ImplementationTargetResultReportErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWire = createRuntimeJsonSchemaValidator<ReportWire>(
  WAKEFLOW_IMPLEMENTATION_TARGET_RESULT_REPORT_SCHEMA,
  [
    WAKEFLOW_GIT_OBJECT_ID_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
  ],
);

function fail(
  reason: ImplementationTargetResultReportErrorReason,
  path: string,
): never {
  throw new ImplementationTargetResultReportError(reason, path);
}

function jsonRecord(
  value: unknown,
  fields: readonly string[],
  path: string,
): Readonly<JsonObject> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, path);
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("input", error.path);
    throw error;
  }
  if (json === null || Array.isArray(json) || typeof json !== "object") {
    fail("input", path);
  }
  const keys = Object.keys(json).sort();
  const expected = [...fields].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    fail("input", path);
  }
  return json as JsonObject;
}

function text(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 8192 ||
    !value.isWellFormed() ||
    value.normalize("NFC") !== value ||
    value.trim() !== value ||
    CONTROL_EXCEPT_LF_PATTERN.test(value)
  ) {
    fail("text", path);
  }
  return value;
}

function token(value: unknown, path: string): string {
  if (typeof value !== "string" || !TOKEN_PATTERN.test(value)) {
    fail("text", path);
  }
  return value;
}

function repositoryId(
  value: unknown,
  path: string,
): WakeflowDurableId<"repository"> {
  try {
    return parseWakeflowDurableIdOfKind(value, "repository", path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path);
    throw error;
  }
}

function digest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", path);
    throw error;
  }
}

function resourcePath(value: unknown, path: string): PortableResourcePath {
  try {
    return parsePortableResourcePath(value, path);
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) fail("path", path);
    throw error;
  }
}

function gitObjectId(value: unknown, path: string): Readonly<GitObjectId> {
  try {
    return parseGitObjectId(value, path);
  } catch (error: unknown) {
    if (error instanceof GitObjectIdError) fail("git-object-id", path);
    throw error;
  }
}

function instant(value: unknown, path: string): UtcInstant {
  try {
    return parseUtcInstant(value, path);
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("time", path);
    throw error;
  }
}

function stringArray(
  value: unknown,
  path: string,
  maximumItems = 64,
): readonly string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    fail("input", path);
  }
  const result = value.map((entry, index) => text(entry, `${path}/${index}`));
  if (new Set(result).size !== result.length) fail("relation", path);
  return Object.freeze(result);
}

/** 准入不含时钟和摘要的Agent业务陈述，并返回独立冻结快照。 */
export function parseImplementationTargetResultReportContent(
  value: unknown,
): Readonly<ImplementationTargetResultReportContent> {
  const record = jsonRecord(
    value,
    [
      "anchorEvidence",
      "evidenceLocators",
      "outcome",
      "repositoryChange",
      "risks",
      "summary",
      "verification",
    ],
    "$content",
  );
  if (
    record.outcome !== "completed" &&
    record.outcome !== "blocked" &&
    record.outcome !== "needs-review"
  ) {
    fail("input", "$/outcome");
  }
  const repository = jsonRecord(
    record.repositoryChange,
    ["commits", "disposition", "repositoryId"],
    "$/repositoryChange",
  );
  if (
    repository.disposition !== "committed" &&
    repository.disposition !== "left-uncommitted" &&
    repository.disposition !== "no-changes"
  ) {
    fail("input", "$/repositoryChange/disposition");
  }
  if (!Array.isArray(repository.commits) || repository.commits.length > 64) {
    fail("input", "$/repositoryChange/commits");
  }
  const commits = repository.commits.map((entry, index) =>
    gitObjectId(entry, `$/repositoryChange/commits/${index}`),
  );
  const commitKeys = commits.map(
    (entry) => `${entry.algorithm}:${entry.value}`,
  );
  if (
    new Set(commitKeys).size !== commitKeys.length ||
    (repository.disposition === "committed") !== commits.length > 0
  ) {
    fail("relation", "$/repositoryChange/commits");
  }
  if (
    !Array.isArray(record.evidenceLocators) ||
    record.evidenceLocators.length > 64
  ) {
    fail("input", "$/evidenceLocators");
  }
  const locators = record.evidenceLocators.map((entry, index) => {
    const path = `$/evidenceLocators/${index}`;
    const locator = jsonRecord(entry, ["digest", "kind", "ref"], path);
    return Object.freeze({
      kind: token(locator.kind, `${path}/kind`),
      ref: resourcePath(locator.ref, `${path}/ref`),
      digest: digest(locator.digest, `${path}/digest`),
    });
  });
  const locatorKeys = locators.map(
    (entry) => `${entry.kind}\0${entry.ref}\0${entry.digest}`,
  );
  if (new Set(locatorKeys).size !== locatorKeys.length) {
    fail("relation", "$/evidenceLocators");
  }
  if (
    !Array.isArray(record.anchorEvidence) ||
    record.anchorEvidence.length > 32
  ) {
    fail("input", "$/anchorEvidence");
  }
  const locatorRefs = new Set(
    locators.map((entry) => `${entry.ref}\0${entry.digest}`),
  );
  const anchorIds = new Set<string>();
  const anchorEvidence = record.anchorEvidence.map((entry, index) => {
    const path = `$/anchorEvidence/${index}`;
    const anchor = jsonRecord(entry, ["anchorId", "evidenceRefs"], path);
    const anchorId = token(anchor.anchorId, `${path}/anchorId`);
    if (anchorIds.has(anchorId)) fail("relation", `${path}/anchorId`);
    anchorIds.add(anchorId);
    if (
      !Array.isArray(anchor.evidenceRefs) ||
      anchor.evidenceRefs.length === 0 ||
      anchor.evidenceRefs.length > 32
    ) {
      fail("input", `${path}/evidenceRefs`);
    }
    const references = anchor.evidenceRefs.map((referenceValue, refIndex) => {
      const refPath = `${path}/evidenceRefs/${refIndex}`;
      const reference = jsonRecord(referenceValue, ["digest", "ref"], refPath);
      const admitted = Object.freeze({
        ref: resourcePath(reference.ref, `${refPath}/ref`),
        digest: digest(reference.digest, `${refPath}/digest`),
      });
      if (!locatorRefs.has(`${admitted.ref}\0${admitted.digest}`)) {
        fail("relation", refPath);
      }
      return admitted;
    });
    const referenceKeys = references.map(
      (reference) => `${reference.ref}\0${reference.digest}`,
    );
    if (new Set(referenceKeys).size !== referenceKeys.length) {
      fail("relation", `${path}/evidenceRefs`);
    }
    return Object.freeze({
      anchorId,
      evidenceRefs: Object.freeze(references),
    });
  });
  return Object.freeze({
    outcome: record.outcome,
    summary: text(record.summary, "$/summary"),
    repositoryChange: Object.freeze({
      repositoryId: repositoryId(
        repository.repositoryId,
        "$/repositoryChange/repositoryId",
      ),
      disposition: repository.disposition,
      commits: Object.freeze(commits),
    }),
    evidenceLocators: Object.freeze(locators),
    verification: stringArray(record.verification, "$/verification"),
    risks: stringArray(record.risks, "$/risks"),
    anchorEvidence: Object.freeze(anchorEvidence),
  });
}

function reportBasis(
  value: Omit<ImplementationTargetResultReport, "reportDigest">,
): Omit<ImplementationTargetResultReport, "reportDigest"> {
  return {
    kind: REPORT_KIND,
    schemaVersion: REPORT_SCHEMA_VERSION,
    outcome: value.outcome,
    summary: value.summary,
    repositoryChange: value.repositoryChange,
    evidenceLocators: value.evidenceLocators,
    verification: value.verification,
    risks: value.risks,
    anchorEvidence: value.anchorEvidence,
    reportedAt: value.reportedAt,
  };
}

export function parseImplementationTargetResultReport(
  value: unknown,
): Readonly<ImplementationTargetResultReport> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$report");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("input", error.path);
    throw error;
  }
  const validated = validateWire(json);
  if (!validated.ok) fail("schema", validated.path);
  const wire = validated.value;
  const content = parseImplementationTargetResultReportContent({
    outcome: wire.outcome,
    summary: wire.summary,
    repositoryChange: wire.repositoryChange,
    evidenceLocators: wire.evidenceLocators,
    verification: wire.verification,
    risks: wire.risks,
    anchorEvidence: wire.anchorEvidence,
  });
  const basis = reportBasis({
    kind: REPORT_KIND,
    schemaVersion: REPORT_SCHEMA_VERSION,
    ...content,
    reportedAt: instant(wire.reportedAt, "$/reportedAt"),
  });
  const reportDigest = digest(wire.reportDigest, "$/reportDigest");
  if (computeCanonicalJsonSha256Digest(basis) !== reportDigest) {
    fail("digest", "$/reportDigest");
  }
  return Object.freeze({ ...basis, reportDigest });
}

export function createImplementationTargetResultReport(
  contentValue: unknown,
  options: CreateImplementationTargetResultReportOptions = {},
): Readonly<ImplementationTargetResultReport> {
  const content = parseImplementationTargetResultReportContent(contentValue);
  let reportedAt: UtcInstant;
  try {
    reportedAt =
      options.clock === undefined
        ? readUtcWallClock()
        : readUtcWallClock(options.clock);
  } catch (error: unknown) {
    if (error instanceof UtcWallClockError) fail("time", "$clock");
    throw error;
  }
  const basis = reportBasis({
    kind: REPORT_KIND,
    schemaVersion: REPORT_SCHEMA_VERSION,
    ...content,
    reportedAt,
  });
  return parseImplementationTargetResultReport({
    ...basis,
    reportDigest: computeCanonicalJsonSha256Digest(basis),
  });
}

export function implementationTargetResultReportContentDigest(
  value: unknown,
): Sha256Digest {
  return computeCanonicalJsonSha256Digest(
    parseImplementationTargetResultReportContent(value),
  );
}

export function renderImplementationTargetResultReport(value: unknown): string {
  return renderDeterministicJsonDocument(
    parseImplementationTargetResultReport(value),
    "$report",
  );
}

export function parseImplementationTargetResultReportDocument(
  textValue: unknown,
): Readonly<ImplementationTargetResultReport> {
  let json: JsonValue;
  try {
    json = parseDeterministicJsonDocument(textValue, "$report");
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      fail("representation", "$report");
    }
    throw error;
  }
  const report = parseImplementationTargetResultReport(json);
  if (renderImplementationTargetResultReport(report) !== textValue) {
    fail("representation", "$report");
  }
  return report;
}
