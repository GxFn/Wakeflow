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
import type {
  ControllerImplementationReviewDecisionType,
  ControllerImplementationReviewJudgment,
} from "./controller-implementation-review-decision.js";
import type { ControllerIndependentReviewCheck } from "./controller-review-decision-contract.js";

/** Controller Implementation Review Decision Service的严格请求与可注入选项。 */

export interface ControllerImplementationReviewDecisionRequest extends ControllerImplementationReviewJudgment {
  readonly demandId: WakeflowDurableId<"demand">;
  readonly targetResultId: WakeflowDurableId<"target-result">;
  readonly snapshotDigest: Sha256Digest;
  readonly reviewUnitDigest: Sha256Digest;
}

export interface ControllerImplementationReviewDecisionOptions {
  readonly clock?: UtcWallClock;
  readonly uuidFactory?: UuidV4Factory;
  readonly signal?: AbortSignal;
}

export interface ParsedControllerImplementationReviewDecisionOptions {
  readonly clock: UtcWallClock | undefined;
  readonly uuidFactory: UuidV4Factory | undefined;
  readonly signal: AbortSignal | undefined;
}

export type ControllerImplementationReviewDecisionInputErrorReason =
  "input" | "identity" | "digest" | "judgment" | "aborted";

const ERROR_MESSAGES = {
  input: "Controller Implementation Review Decision input is invalid.",
  identity:
    "Controller Implementation Review Decision input contains an invalid identity.",
  digest:
    "Controller Implementation Review Decision input contains an invalid Review digest.",
  judgment:
    "Controller Implementation Review Decision judgment is inconsistent.",
  aborted: "Controller Implementation Review Decision input was aborted.",
} as const satisfies Readonly<
  Record<ControllerImplementationReviewDecisionInputErrorReason, string>
>;

export class ControllerImplementationReviewDecisionInputError extends Error {
  override readonly name = "ControllerImplementationReviewDecisionInputError";
  readonly code =
    "wakeflow-controller-implementation-review-decision-input" as const;
  readonly reason: ControllerImplementationReviewDecisionInputErrorReason;

  constructor(reason: ControllerImplementationReviewDecisionInputErrorReason) {
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
  "implementationQuality",
  "requirementAlignment",
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

function fail(
  reason: ControllerImplementationReviewDecisionInputErrorReason,
): never {
  throw new ControllerImplementationReviewDecisionInputError(reason);
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

function parseDecision(
  value: unknown,
): ControllerImplementationReviewDecisionType {
  if (
    value !== "accept" &&
    value !== "blocked" &&
    value !== "redesign" &&
    value !== "rework"
  ) {
    fail("judgment");
  }
  return value;
}

function assertJudgmentRelation(
  judgment: Readonly<ControllerImplementationReviewJudgment>,
): void {
  const { decision, assessment, independentChecks, blockingReasons } = judgment;
  if (
    (decision === "accept" &&
      (assessment.requirementAlignment !== "aligned" ||
        assessment.implementationQuality !== "satisfactory" ||
        independentChecks.some((check) => check.outcome !== "passed") ||
        blockingReasons.length !== 0)) ||
    (decision === "rework" &&
      (assessment.requirementAlignment !== "aligned" ||
        assessment.implementationQuality !== "defective" ||
        !independentChecks.some((check) => check.outcome === "failed") ||
        blockingReasons.length !== 0)) ||
    (decision === "redesign" &&
      (assessment.requirementAlignment !== "mismatch" ||
        !independentChecks.some(
          (check) =>
            check.outcome === "failed" || check.outcome === "inconclusive",
        ) ||
        blockingReasons.length !== 0)) ||
    (decision === "blocked" &&
      (blockingReasons.length === 0 ||
        (assessment.requirementAlignment === "aligned" &&
          assessment.implementationQuality === "satisfactory")))
  ) {
    fail("judgment");
  }
}

function parseJudgment(
  record: Readonly<Record<string, unknown>>,
): Readonly<ControllerImplementationReviewJudgment> {
  const assessment = exactRecord(
    record.assessment,
    ASSESSMENT_FIELDS,
    "$/assessment",
  );
  if (
    assessment.requirementAlignment !== "aligned" &&
    assessment.requirementAlignment !== "mismatch" &&
    assessment.requirementAlignment !== "unresolved"
  ) {
    fail("judgment");
  }
  if (
    assessment.implementationQuality !== "satisfactory" &&
    assessment.implementationQuality !== "defective" &&
    assessment.implementationQuality !== "unverified"
  ) {
    fail("judgment");
  }
  const judgment = Object.freeze({
    decision: parseDecision(record.decision),
    assessment: Object.freeze({
      requirementAlignment: assessment.requirementAlignment,
      implementationQuality: assessment.implementationQuality,
    }),
    independentChecks: parseChecks(record.independentChecks),
    rationale: text(record.rationale),
    blockingReasons: parseTextList(record.blockingReasons, "$/blockingReasons"),
    residualRisks: parseTextList(record.residualRisks, "$/residualRisks"),
  });
  assertJudgmentRelation(judgment);
  return judgment;
}

export function parseControllerImplementationReviewDecisionRequest(
  value: unknown,
): Readonly<ControllerImplementationReviewDecisionRequest> {
  const record = exactRecord(value, REQUEST_FIELDS, "$request");
  return Object.freeze({
    demandId: id(record.demandId, "demand"),
    targetResultId: id(record.targetResultId, "target-result"),
    snapshotDigest: digest(record.snapshotDigest),
    reviewUnitDigest: digest(record.reviewUnitDigest),
    ...parseJudgment(record),
  });
}

export function parseControllerImplementationReviewDecisionOptions(
  value: unknown,
): Readonly<ParsedControllerImplementationReviewDecisionOptions> {
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
