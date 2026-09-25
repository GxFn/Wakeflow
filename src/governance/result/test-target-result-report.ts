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
import { isEvidenceKind } from "../../contracts/vocabulary/evidence-kinds.js";
import {
  isTestFailureClassification,
  isTestFailureOwner,
  isTestStepVerdict,
  type TestFailureClassification,
  type TestFailureOwner,
  type TestStepVerdict,
} from "../../contracts/vocabulary/test-step-vocabulary.js";
import type {
  TargetResultEvidenceLocator,
  TargetResultOutcome,
} from "./target-result-report-contract.js";

/**
 * Wakeflow Governance / Result：Test Agent提交的逐步执行结果陈述。
 *
 * Report按测试合同逐步记录 observed、证据、verdict 与失败分类（ADR-0012 D4）；整体
 * verdict 由步骤派生。它不解释Evidence真假，不声明product repository change、测试通过、
 * Controller acceptance或Demand completion。TaskPackage（含测试合同）、attempt、Claim和
 * Observation的闭合由TargetResult owner负责。
 */

const REPORT_KIND = "WakeflowTestTargetResultReport" as const;
const REPORT_SCHEMA_VERSION = 1 as const;
const CONTROL_EXCEPT_LF_PATTERN =
  /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;
const MAXIMUM_EVIDENCE_LOCATORS = 64;
const MAXIMUM_CONTRACT_STEPS = 20;
const STEP_ID_PATTERN = /^ts-[1-9][0-9]?$/u;

export interface TestTargetResultStepFailure {
  readonly classification: TestFailureClassification;
  readonly likelyOwner: TestFailureOwner;
  readonly recommendedAction: string;
}

/** 一步的记录：观察到什么、证据在哪里、判定如何；非 pass 必带失败分类。 */
export interface TestTargetResultStep {
  readonly stepId: string;
  readonly observed: string;
  readonly evidence: Readonly<{
    readonly ref: PortableResourcePath;
    readonly digest: Sha256Digest;
  }>;
  readonly verdict: TestStepVerdict;
  readonly failure?: Readonly<TestTargetResultStepFailure>;
}

export interface TestTargetResultReportContent {
  readonly outcome: TargetResultOutcome;
  readonly summary: string;
  readonly evidenceLocators: readonly Readonly<TargetResultEvidenceLocator>[];
  readonly verification: readonly string[];
  readonly risks: readonly string[];
  readonly steps: readonly Readonly<TestTargetResultStep>[];
}

export interface TestTargetResultReport extends TestTargetResultReportContent {
  readonly kind: typeof REPORT_KIND;
  readonly schemaVersion: typeof REPORT_SCHEMA_VERSION;
  /** 由步骤派生：含 fail 即 fail，否则含 blocked 即 blocked，否则含 cannot-conclude 即 cannot-conclude，否则 pass；无步骤为 cannot-conclude。 */
  readonly verdict: TestStepVerdict;
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
    Array.from(value).length > 8192 ||
    !value.isWellFormed() ||
    value.normalize("NFC") !== value ||
    value.trim() !== value ||
    CONTROL_EXCEPT_LF_PATTERN.test(value)
  ) {
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
    if (!isEvidenceKind(record.kind)) fail("text", `${path}/kind`);
    return Object.freeze({
      kind: record.kind,
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

/** 整体判定只从步骤派生；调用方不能自行宣称。 */
export function deriveTestVerdict(
  steps: readonly Readonly<{ readonly verdict: TestStepVerdict }>[],
): TestStepVerdict {
  if (steps.length === 0) return "cannot-conclude";
  if (steps.some((step) => step.verdict === "fail")) return "fail";
  if (steps.some((step) => step.verdict === "blocked")) return "blocked";
  if (steps.some((step) => step.verdict === "cannot-conclude")) return "cannot-conclude";
  return "pass";
}

function stepFailure(value: unknown, path: string): Readonly<TestTargetResultStepFailure> {
  const record = exactRecord(
    value,
    ["classification", "likelyOwner", "recommendedAction"],
    path,
  );
  if (!isTestFailureClassification(record.classification)) {
    fail("input", `${path}/classification`);
  }
  if (!isTestFailureOwner(record.likelyOwner)) fail("input", `${path}/likelyOwner`);
  return Object.freeze({
    classification: record.classification,
    likelyOwner: record.likelyOwner,
    recommendedAction: humanText(record.recommendedAction, `${path}/recommendedAction`),
  });
}

function parseSteps(
  value: unknown,
  locators: readonly Readonly<TargetResultEvidenceLocator>[],
): readonly Readonly<TestTargetResultStep>[] {
  if (!Array.isArray(value) || value.length > MAXIMUM_CONTRACT_STEPS) {
    fail("input", "$/steps");
  }
  const locatorTuples = new Set(
    locators.map((entry) => `${entry.ref}\0${entry.digest}`),
  );
  const steps = value.map((entry, index) => {
    const path = `$/steps/${index}`;
    const hasFailure =
      typeof entry === "object" && entry !== null && Object.hasOwn(entry, "failure");
    const record = exactRecord(
      entry,
      hasFailure
        ? ["evidence", "failure", "observed", "stepId", "verdict"]
        : ["evidence", "observed", "stepId", "verdict"],
      path,
    );
    if (typeof record.stepId !== "string" || !STEP_ID_PATTERN.test(record.stepId)) {
      fail("input", `${path}/stepId`);
    }
    if (!isTestStepVerdict(record.verdict)) fail("input", `${path}/verdict`);
    if ((record.verdict === "pass") === hasFailure) fail("relation", `${path}/failure`);
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
      stepId: record.stepId,
      observed: humanText(record.observed, `${path}/observed`),
      evidence: admittedEvidence,
      verdict: record.verdict,
      ...(hasFailure ? { failure: stepFailure(record.failure, `${path}/failure`) } : {}),
    });
  });
  if (new Set(steps.map((entry) => entry.stepId)).size !== steps.length) {
    fail("relation", "$/steps");
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
      "steps",
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
  const steps = parseSteps(record.steps, locators);
  // completed 至少一步；blocked 不能同时含 fail（失败不是阻断）。覆盖范围由 TargetResult owner 对照合同核对。
  if (
    (record.outcome === "completed" && steps.length === 0) ||
    (record.outcome === "blocked" && steps.some((step) => step.verdict === "fail"))
  ) {
    fail("relation", "$/steps");
  }
  return Object.freeze({
    outcome: record.outcome,
    summary: humanText(record.summary, "$/summary"),
    evidenceLocators: locators,
    verification: textList(record.verification, "$/verification"),
    risks: textList(record.risks, "$/risks"),
    steps,
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
    steps: value.steps,
    verdict: value.verdict,
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
    steps: wire.steps,
  });
  if (wire.verdict !== deriveTestVerdict(content.steps)) fail("relation", "$/verdict");
  const basis = reportBasis({
    kind: REPORT_KIND,
    schemaVersion: REPORT_SCHEMA_VERSION,
    ...content,
    verdict: wire.verdict,
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
    reportedAt = readUtcWallClock(options.clock);
  } catch (error: unknown) {
    if (error instanceof UtcWallClockError) fail("time", "$clock");
    throw error;
  }
  const basis = reportBasis({
    kind: REPORT_KIND,
    schemaVersion: REPORT_SCHEMA_VERSION,
    ...content,
    verdict: deriveTestVerdict(content.steps),
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
