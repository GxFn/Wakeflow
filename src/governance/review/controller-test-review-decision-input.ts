import { types } from "node:util";

import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  parseDenseArray,
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import type { UuidV4Factory } from "../../foundation/identity/uuid-v4.js";
import type { UtcWallClock } from "../../foundation/time/wall-clock.js";
import {
  assertControllerTestReviewJudgment,
  ControllerTestReviewDecisionError,
  type ControllerTestReviewDecisionType,
  type ControllerTestReviewJudgment,
} from "./controller-test-review-decision.js";
/*
 * Judgment的词法准入在本文件完成；decision/assessment/check关系由Decision模块
 * 唯一拥有，避免Service Input与持久Decision在演进时形成两套矩阵。
 */
import type { ControllerIndependentReviewCheck } from "./controller-review-decision-contract.js";

/** Controller Test Review Decision Service的严格请求与可注入选项。 */

export interface ControllerTestReviewDecisionRequest extends ControllerTestReviewJudgment {
  readonly demandId: WakeflowDurableId<"demand">;
  readonly targetResultId: WakeflowDurableId<"target-result">;
  readonly snapshotDigest: Sha256Digest;
  readonly reviewUnitDigest: Sha256Digest;
}

export interface ControllerTestReviewDecisionOptions {
  readonly clock?: UtcWallClock;
  readonly uuidFactory?: UuidV4Factory;
  readonly signal?: AbortSignal;
}

export interface ParsedControllerTestReviewDecisionOptions {
  readonly clock: UtcWallClock | undefined;
  readonly uuidFactory: UuidV4Factory | undefined;
  readonly signal: AbortSignal | undefined;
}

export type ControllerTestReviewDecisionInputErrorReason =
  "input" | "identity" | "digest" | "judgment" | "aborted";

const ERROR_MESSAGES = {
  input: "Controller Test Review Decision input is invalid.",
  identity:
    "Controller Test Review Decision input contains an invalid identity.",
  digest:
    "Controller Test Review Decision input contains an invalid Review digest.",
  judgment: "Controller Test Review Decision judgment is inconsistent.",
  aborted: "Controller Test Review Decision input was aborted.",
} as const satisfies Readonly<
  Record<ControllerTestReviewDecisionInputErrorReason, string>
>;

export class ControllerTestReviewDecisionInputError extends Error {
  override readonly name = "ControllerTestReviewDecisionInputError";
  readonly code = "wakeflow-controller-test-review-decision-input" as const;
  readonly reason: ControllerTestReviewDecisionInputErrorReason;

  constructor(reason: ControllerTestReviewDecisionInputErrorReason) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
  }
}

const REQUEST_FIELDS = Object.freeze([
  "assessment",
  "blockingReasons",
  "decision",
  "demandId",
  "independentChecks",
  "rationale",
  "residualRisks",
  "reviewUnitDigest",
  "snapshotDigest",
  "targetResultId",
] as const);
const ASSESSMENT_FIELDS = Object.freeze([
  "conclusion",
  "evidenceSufficiency",
] as const);
const CHECK_FIELDS = Object.freeze([
  "checkId",
  "method",
  "observation",
  "outcome",
] as const);
const CHECK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const CONTROL_EXCEPT_LF_PATTERN =
  /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;

function fail(reason: ControllerTestReviewDecisionInputErrorReason): never {
  throw new ControllerTestReviewDecisionInputError(reason);
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
    if (error instanceof PassiveOwnDataError) fail("input");
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== fields.length ||
    keys.some((key, index) => key !== fields[index])
  ) {
    fail("input");
  }
  return record;
}

function id<Kind extends "demand" | "target-result">(
  value: unknown,
  kind: Kind,
): WakeflowDurableId<Kind> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identity");
    throw error;
  }
}

function digest(value: unknown): Sha256Digest {
  try {
    return parseSha256Digest(value);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest");
    throw error;
  }
}

function text(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 8192 ||
    !value.isWellFormed() ||
    value.normalize("NFC") !== value ||
    value.trim() !== value ||
    CONTROL_EXCEPT_LF_PATTERN.test(value)
  ) {
    fail("judgment");
  }
  return value;
}

function token(value: unknown): string {
  if (typeof value !== "string" || !CHECK_ID_PATTERN.test(value)) {
    fail("judgment");
  }
  return value;
}

function parseTextList(value: unknown, path: string): readonly string[] {
  let values: readonly unknown[];
  try {
    values = parseDenseArray(value, 32, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input");
    throw error;
  }
  const admitted = values.map(text);
  if (new Set(admitted).size !== admitted.length) fail("judgment");
  return Object.freeze(admitted);
}

function parseChecks(
  value: unknown,
): readonly [
  Readonly<ControllerIndependentReviewCheck>,
  ...Readonly<ControllerIndependentReviewCheck>[],
] {
  let values: readonly unknown[];
  try {
    values = parseDenseArray(value, 32, "$/independentChecks");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input");
    throw error;
  }
  if (values.length === 0) fail("judgment");
  const checks = values.map((value, index) => {
    const record = exactRecord(
      value,
      CHECK_FIELDS,
      `$/independentChecks/${index}`,
    );
    if (
      record.outcome !== "passed" &&
      record.outcome !== "failed" &&
      record.outcome !== "inconclusive"
    ) {
      fail("judgment");
    }
    return Object.freeze({
      checkId: token(record.checkId),
      method: text(record.method),
      outcome: record.outcome,
      observation: text(record.observation),
    });
  });
  if (new Set(checks.map((check) => check.checkId)).size !== checks.length) {
    fail("judgment");
  }
  const first = checks[0];
  if (first === undefined) fail("judgment");
  return Object.freeze([first, ...checks.slice(1)]);
}

function parseDecision(value: unknown): ControllerTestReviewDecisionType {
  if (
    value !== "accept" &&
    value !== "request-another-attempt" &&
    value !== "escalate-product-defect" &&
    value !== "blocked"
  ) {
    fail("judgment");
  }
  return value;
}

function parseJudgment(
  record: Readonly<Record<string, unknown>>,
): Readonly<ControllerTestReviewJudgment> {
  const assessment = exactRecord(
    record.assessment,
    ASSESSMENT_FIELDS,
    "$/assessment",
  );
  if (
    assessment.conclusion !== "satisfied" &&
    assessment.conclusion !== "defect-observed" &&
    assessment.conclusion !== "inconclusive"
  ) {
    fail("judgment");
  }
  if (
    assessment.evidenceSufficiency !== "sufficient" &&
    assessment.evidenceSufficiency !== "insufficient"
  ) {
    fail("judgment");
  }
  const judgment = Object.freeze({
    decision: parseDecision(record.decision),
    assessment: Object.freeze({
      conclusion: assessment.conclusion,
      evidenceSufficiency: assessment.evidenceSufficiency,
    }),
    independentChecks: parseChecks(record.independentChecks),
    rationale: text(record.rationale),
    blockingReasons: parseTextList(record.blockingReasons, "$/blockingReasons"),
    residualRisks: parseTextList(record.residualRisks, "$/residualRisks"),
  });
  try {
    assertControllerTestReviewJudgment(judgment);
  } catch (error: unknown) {
    if (error instanceof ControllerTestReviewDecisionError) fail("judgment");
    throw error;
  }
  return judgment;
}

export function parseControllerTestReviewDecisionRequest(
  value: unknown,
): Readonly<ControllerTestReviewDecisionRequest> {
  const record = exactRecord(value, REQUEST_FIELDS, "$request");
  return Object.freeze({
    demandId: id(record.demandId, "demand"),
    targetResultId: id(record.targetResultId, "target-result"),
    snapshotDigest: digest(record.snapshotDigest),
    reviewUnitDigest: digest(record.reviewUnitDigest),
    ...parseJudgment(record),
  });
}

export function parseControllerTestReviewDecisionOptions(
  value: unknown,
): Readonly<ParsedControllerTestReviewDecisionOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value ?? {}, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input");
    throw error;
  }
  if (
    Object.keys(record).some(
      (key) => key !== "clock" && key !== "signal" && key !== "uuidFactory",
    ) ||
    (record.clock !== undefined &&
      (typeof record.clock !== "function" || types.isProxy(record.clock))) ||
    (record.uuidFactory !== undefined &&
      (typeof record.uuidFactory !== "function" ||
        types.isProxy(record.uuidFactory))) ||
    (record.signal !== undefined &&
      (typeof record.signal !== "object" ||
        record.signal === null ||
        types.isProxy(record.signal) ||
        !(record.signal instanceof AbortSignal)))
  ) {
    fail("input");
  }
  const signal = record.signal as AbortSignal | undefined;
  if (signal?.aborted === true) fail("aborted");
  return Object.freeze({
    clock: record.clock as UtcWallClock | undefined,
    uuidFactory: record.uuidFactory as UuidV4Factory | undefined,
    signal,
  });
}
