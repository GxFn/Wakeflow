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

/** Controller产品缺陷修复Service的严格请求；baseline与Event位置由owner派生。 */

export interface ControllerProductDefectRemediationTargetRequest {
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly failedCheckIds: readonly [string, ...string[]];
  readonly correctionObjective: string;
}

export interface ControllerProductDefectRemediationRequest {
  readonly demandId: WakeflowDurableId<"demand">;
  readonly testReviewDecisionId: WakeflowDurableId<"target-review-decision">;
  readonly postAcceptanceRouteDigest: Sha256Digest;
  readonly affectedTargets: readonly [
    Readonly<ControllerProductDefectRemediationTargetRequest>,
    ...Readonly<ControllerProductDefectRemediationTargetRequest>[],
  ];
  readonly authorizationRationale: string;
}

export interface ControllerProductDefectRemediationOptions {
  readonly clock?: UtcWallClock;
  readonly uuidFactory?: UuidV4Factory;
  readonly signal?: AbortSignal;
}

export interface ParsedControllerProductDefectRemediationOptions {
  readonly clock: UtcWallClock | undefined;
  readonly uuidFactory: UuidV4Factory | undefined;
  readonly signal: AbortSignal | undefined;
}

export type ControllerProductDefectRemediationInputErrorReason =
  "input" | "identity" | "digest" | "text" | "relation" | "aborted";

const ERROR_MESSAGES = {
  input: "Controller Product Defect Remediation input is invalid.",
  identity:
    "Controller Product Defect Remediation input contains an invalid identity.",
  digest:
    "Controller Product Defect Remediation input contains an invalid route digest.",
  text: "Controller Product Defect Remediation input contains invalid text.",
  relation:
    "Controller Product Defect Remediation target mappings are inconsistent.",
  aborted: "Controller Product Defect Remediation input was aborted.",
} as const satisfies Readonly<
  Record<ControllerProductDefectRemediationInputErrorReason, string>
>;

export class ControllerProductDefectRemediationInputError extends Error {
  override readonly name = "ControllerProductDefectRemediationInputError";
  readonly code =
    "wakeflow-controller-product-defect-remediation-input" as const;
  readonly reason: ControllerProductDefectRemediationInputErrorReason;

  constructor(reason: ControllerProductDefectRemediationInputErrorReason) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
  }
}

const REQUEST_FIELDS = Object.freeze([
  "affectedTargets",
  "authorizationRationale",
  "demandId",
  "postAcceptanceRouteDigest",
  "testReviewDecisionId",
] as const);
const TARGET_FIELDS = Object.freeze([
  "correctionObjective",
  "failedCheckIds",
  "targetTaskId",
] as const);
const OPTION_FIELDS = Object.freeze([
  "clock",
  "signal",
  "uuidFactory",
] as const);
const CHECK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const CONTROL_EXCEPT_LF_PATTERN =
  /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;

function fail(
  reason: ControllerProductDefectRemediationInputErrorReason,
): never {
  throw new ControllerProductDefectRemediationInputError(reason);
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

function id<Kind extends "demand" | "target-task" | "target-review-decision">(
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
    fail("text");
  }
  return value;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function failedCheckIds(
  value: unknown,
  path: string,
): readonly [string, ...string[]] {
  let values: readonly unknown[];
  try {
    values = parseDenseArray(value, 32, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input");
    throw error;
  }
  const admitted = values
    .map((entry) => {
      if (typeof entry !== "string" || !CHECK_ID_PATTERN.test(entry)) {
        fail("text");
      }
      return entry;
    })
    .sort(compareText);
  const first = admitted[0];
  if (first === undefined || new Set(admitted).size !== admitted.length) {
    fail("relation");
  }
  return Object.freeze([first, ...admitted.slice(1)]);
}

function affectedTargets(
  value: unknown,
): readonly [
  Readonly<ControllerProductDefectRemediationTargetRequest>,
  ...Readonly<ControllerProductDefectRemediationTargetRequest>[],
] {
  let values: readonly unknown[];
  try {
    values = parseDenseArray(value, 10000, "$/affectedTargets");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input");
    throw error;
  }
  const targets = values
    .map((value, index) => {
      const record = exactRecord(
        value,
        TARGET_FIELDS,
        `$/affectedTargets/${index}`,
      );
      return Object.freeze({
        targetTaskId: id(record.targetTaskId, "target-task"),
        failedCheckIds: failedCheckIds(
          record.failedCheckIds,
          `$/affectedTargets/${index}/failedCheckIds`,
        ),
        correctionObjective: text(record.correctionObjective),
      });
    })
    .sort((left, right) => compareText(left.targetTaskId, right.targetTaskId));
  const first = targets[0];
  if (
    first === undefined ||
    targets.some(
      (target, index) =>
        index > 0 && targets[index - 1]!.targetTaskId === target.targetTaskId,
    )
  ) {
    fail("relation");
  }
  return Object.freeze([first, ...targets.slice(1)]);
}

export function parseControllerProductDefectRemediationRequest(
  value: unknown,
): Readonly<ControllerProductDefectRemediationRequest> {
  const record = exactRecord(value, REQUEST_FIELDS, "$request");
  return Object.freeze({
    demandId: id(record.demandId, "demand"),
    testReviewDecisionId: id(
      record.testReviewDecisionId,
      "target-review-decision",
    ),
    postAcceptanceRouteDigest: digest(record.postAcceptanceRouteDigest),
    affectedTargets: affectedTargets(record.affectedTargets),
    authorizationRationale: text(record.authorizationRationale),
  });
}

export function parseControllerProductDefectRemediationOptions(
  value: unknown,
): Readonly<ParsedControllerProductDefectRemediationOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input");
    throw error;
  }
  if (
    Object.keys(record).some(
      (key) => !OPTION_FIELDS.includes(key as (typeof OPTION_FIELDS)[number]),
    )
  ) {
    fail("input");
  }
  const signal = record.signal;
  if (
    signal !== undefined &&
    (typeof signal !== "object" ||
      signal === null ||
      types.isProxy(signal) ||
      !(signal instanceof AbortSignal))
  ) {
    fail("input");
  }
  if (signal?.aborted) fail("aborted");
  if (record.clock !== undefined && typeof record.clock !== "function") {
    fail("input");
  }
  if (
    record.uuidFactory !== undefined &&
    typeof record.uuidFactory !== "function"
  ) {
    fail("input");
  }
  return Object.freeze({
    clock: record.clock as UtcWallClock | undefined,
    uuidFactory: record.uuidFactory as UuidV4Factory | undefined,
    signal: signal as AbortSignal | undefined,
  });
}
