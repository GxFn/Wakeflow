import type { WakeflowTestTargetResultReport as ReportWire } from "../../contracts/generated/governance/result/test-target-result-report.generated.js";
import { WAKEFLOW_TEST_TARGET_RESULT_REPORT_SCHEMA } from "../../contracts/generated/governance/result/test-target-result-report.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
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
 * Wakeflow Governance / Result：Test Agent提交的逐步执行结果陈述。
 *
 * Report只映射Controller批准的plan步骤与外部Evidence Artifact；它不解释Evidence真假，
 * 不声明product repository change、测试通过、Controller acceptance或Demand completion。
 * TaskPackage、TestCard、attempt、Claim和Observation的闭合由TargetResult owner负责。
 */

const REPORT_KIND = "WakeflowTestTargetResultReport" as const;
const REPORT_SCHEMA_VERSION = 1 as const;
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const CONTROL_EXCEPT_LF_PATTERN =
  /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;
const MAXIMUM_EVIDENCE_LOCATORS = 64;
const MAXIMUM_PLAN_STEPS = 32;

export interface TestTargetResultStepEvidence {
  readonly planIndex: number;
  readonly step: string;
  readonly evidence: Readonly<{
    readonly ref: PortableResourcePath;
    readonly digest: Sha256Digest;
  }>;
}

export interface TestTargetResultReportContent {
  readonly outcome: TargetResultOutcome;
  readonly summary: string;
  readonly evidenceLocators: readonly Readonly<TargetResultEvidenceLocator>[];
  readonly verification: readonly string[];
  readonly risks: readonly string[];
  readonly stepEvidence: readonly Readonly<TestTargetResultStepEvidence>[];
}

export interface TestTargetResultReport extends TestTargetResultReportContent {
  readonly kind: typeof REPORT_KIND;
  readonly schemaVersion: typeof REPORT_SCHEMA_VERSION;
  readonly reportedAt: UtcInstant;
  readonly reportDigest: Sha256Digest;
}

export interface CreateTestTargetResultReportOptions {
  readonly clock?: UtcWallClock;
}

export type TestTargetResultReportErrorReason =
  | "input"
  | "schema"
  | "digest"
  | "path"
  | "text"
  | "time"
  | "relation"
  | "representation";

const ERROR_MESSAGES = {
  input: "Test Target Result Report is not passive closed JSON data.",
  schema: "Test Target Result Report does not satisfy its Schema.",
  digest:
    "Test Target Result Report contains an invalid or inconsistent digest.",
  path: "Test Target Result Report contains an invalid portable resource path.",
  text: "Test Target Result Report contains invalid human text or token text.",
  time: "Test Target Result Report contains an invalid time.",
  relation: "Test Target Result Report facts are inconsistent.",
  representation: "Test Target Result Report bytes are not deterministic.",
} as const satisfies Readonly<
  Record<TestTargetResultReportErrorReason, string>
>;

/** Test Report输入、关系或确定性表示失败时的稳定错误。 */
export class TestTargetResultReportError extends Error {
  override readonly name = "TestTargetResultReportError";
  readonly code = "wakeflow-test-target-result-report" as const;
  readonly reason: TestTargetResultReportErrorReason;
  readonly path: string;

  constructor(reason: TestTargetResultReportErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWire = createRuntimeJsonSchemaValidator<ReportWire>(
  WAKEFLOW_TEST_TARGET_RESULT_REPORT_SCHEMA,
  [
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
  ],
);

function fail(reason: TestTargetResultReportErrorReason, path: string): never {
  throw new TestTargetResultReportError(reason, path);
}

function exactRecord(
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

function humanText(value: unknown, path: string): string {
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

function instant(value: unknown, path: string): UtcInstant {
  try {
    return parseUtcInstant(value, path);
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("time", path);
    throw error;
  }
}

function textList(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value) || value.length > 64) fail("input", path);
  const values = value.map((entry, index) =>
    humanText(entry, `${path}/${index}`),
  );
  if (new Set(values).size !== values.length) fail("relation", path);
  return Object.freeze(values);
}

function evidenceLocators(
  value: unknown,
): readonly Readonly<TargetResultEvidenceLocator>[] {
  if (!Array.isArray(value) || value.length > MAXIMUM_EVIDENCE_LOCATORS) {
    fail("input", "$/evidenceLocators");
  }
  const locators = value.map((entry, index) => {
    const path = `$/evidenceLocators/${index}`;
    const record = exactRecord(entry, ["digest", "kind", "ref"], path);
    return Object.freeze({
      kind: token(record.kind, `${path}/kind`),
      ref: resourcePath(record.ref, `${path}/ref`),
      digest: digest(record.digest, `${path}/digest`),
    });
  });
  const refs = locators.map((entry) => entry.ref);
  if (new Set(refs).size !== refs.length) {
    fail("relation", "$/evidenceLocators");
  }
  return Object.freeze(locators);
}

function stepEvidence(
  value: unknown,
  locators: readonly Readonly<TargetResultEvidenceLocator>[],
): readonly Readonly<TestTargetResultStepEvidence>[] {
  if (!Array.isArray(value) || value.length > MAXIMUM_PLAN_STEPS) {
    fail("input", "$/stepEvidence");
  }
  const locatorTuples = new Set(
    locators.map((entry) => `${entry.ref}\0${entry.digest}`),
  );
  const steps = value.map((entry, index) => {
    const path = `$/stepEvidence/${index}`;
    const record = exactRecord(entry, ["evidence", "planIndex", "step"], path);
    if (
      !Number.isSafeInteger(record.planIndex) ||
      (record.planIndex as number) < 0 ||
      (record.planIndex as number) >= MAXIMUM_PLAN_STEPS
    ) {
      fail("input", `${path}/planIndex`);
    }
    const evidence = exactRecord(
      record.evidence,
      ["digest", "ref"],
      `${path}/evidence`,
    );
    const admittedEvidence = Object.freeze({
      ref: resourcePath(evidence.ref, `${path}/evidence/ref`),
      digest: digest(evidence.digest, `${path}/evidence/digest`),
    });
    if (
      !locatorTuples.has(`${admittedEvidence.ref}\0${admittedEvidence.digest}`)
    ) {
      fail("relation", `${path}/evidence`);
    }
    return Object.freeze({
      planIndex: record.planIndex as number,
      step: humanText(record.step, `${path}/step`),
      evidence: admittedEvidence,
    });
  });
  if (
    steps.some(
      (entry, index) =>
        index > 0 && entry.planIndex <= steps[index - 1]!.planIndex,
    )
  ) {
    fail("relation", "$/stepEvidence");
  }
  return Object.freeze(steps);
}

/** 准入不含时钟和摘要的Test Agent业务陈述。 */
export function parseTestTargetResultReportContent(
  value: unknown,
): Readonly<TestTargetResultReportContent> {
  const record = exactRecord(
    value,
    [
      "evidenceLocators",
      "outcome",
      "risks",
      "stepEvidence",
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
  const locators = evidenceLocators(record.evidenceLocators);
  const steps = stepEvidence(record.stepEvidence, locators);
  if (record.outcome === "completed" && steps.length === 0) {
    fail("relation", "$/stepEvidence");
  }
  return Object.freeze({
    outcome: record.outcome,
    summary: humanText(record.summary, "$/summary"),
    evidenceLocators: locators,
    verification: textList(record.verification, "$/verification"),
    risks: textList(record.risks, "$/risks"),
    stepEvidence: steps,
  });
}

function reportBasis(
  value: Omit<TestTargetResultReport, "reportDigest">,
): Omit<TestTargetResultReport, "reportDigest"> {
  return {
    kind: REPORT_KIND,
    schemaVersion: REPORT_SCHEMA_VERSION,
    outcome: value.outcome,
    summary: value.summary,
    evidenceLocators: value.evidenceLocators,
    verification: value.verification,
    risks: value.risks,
    stepEvidence: value.stepEvidence,
    reportedAt: value.reportedAt,
  };
}

/** 严格解析并复验self-excluding digest的Test Report。 */
export function parseTestTargetResultReport(
  value: unknown,
): Readonly<TestTargetResultReport> {
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
  const content = parseTestTargetResultReportContent({
    outcome: wire.outcome,
    summary: wire.summary,
    evidenceLocators: wire.evidenceLocators,
    verification: wire.verification,
    risks: wire.risks,
    stepEvidence: wire.stepEvidence,
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

/** 使用当前时钟创建一份Test Agent执行结果陈述。 */
export function createTestTargetResultReport(
  contentValue: unknown,
  options: CreateTestTargetResultReportOptions = {},
): Readonly<TestTargetResultReport> {
  const content = parseTestTargetResultReportContent(contentValue);
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
  return parseTestTargetResultReport({
    ...basis,
    reportDigest: computeCanonicalJsonSha256Digest(basis),
  });
}

export function testTargetResultReportContentDigest(
  value: unknown,
): Sha256Digest {
  return computeCanonicalJsonSha256Digest(
    parseTestTargetResultReportContent(value),
  );
}

export function renderTestTargetResultReport(value: unknown): string {
  return renderDeterministicJsonDocument(
    parseTestTargetResultReport(value),
    "$report",
  );
}

export function parseTestTargetResultReportDocument(
  textValue: unknown,
): Readonly<TestTargetResultReport> {
  let json: JsonValue;
  try {
    json = parseDeterministicJsonDocument(textValue, "$report");
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      fail("representation", "$report");
    }
    throw error;
  }
  const report = parseTestTargetResultReport(json);
  if (renderTestTargetResultReport(report) !== textValue) {
    fail("representation", "$report");
  }
  return report;
}
