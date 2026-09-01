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
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import type { UtcWallClock } from "../../foundation/time/wall-clock.js";
import {
  parseWindowWorkClaimId,
  WindowWorkClaimError,
  type WindowWorkClaimId,
} from "../delivery/window-work-claim.js";
import {
  parseImplementationTargetResultReportContent,
  ImplementationTargetResultReportError,
  type ImplementationTargetResultReportContent,
} from "./implementation-target-result-report.js";
import {
  parseTestTargetResultReportContent,
  TestTargetResultReportError,
  type TestTargetResultReportContent,
} from "./test-target-result-report.js";

/** TargetResult Import的严格业务请求与可注入选项。 */

export type TargetResultImportAgentReport =
  | Readonly<{
      readonly workType: "implementation";
      readonly content: Readonly<ImplementationTargetResultReportContent>;
    }>
  | Readonly<{
      readonly workType: "test";
      readonly content: Readonly<TestTargetResultReportContent>;
    }>;

export interface TargetResultImportRequest {
  readonly demandId: WakeflowDurableId<"demand">;
  readonly actionId: WindowWorkClaimId;
  readonly observationDigest: Sha256Digest;
  readonly report: TargetResultImportAgentReport;
}

export interface TargetResultImportOptions {
  readonly clock?: UtcWallClock;
  readonly signal?: AbortSignal;
}

export interface ParsedTargetResultImportOptions {
  readonly clock: UtcWallClock | undefined;
  readonly signal: AbortSignal | undefined;
}

export type TargetResultImportInputErrorReason =
  "input" | "identity" | "digest" | "report" | "aborted";

const ERROR_MESSAGES = {
  input: "TargetResult Import input is invalid.",
  identity: "TargetResult Import contains an invalid identity.",
  digest: "TargetResult Import contains an invalid digest.",
  report: "TargetResult Import contains an invalid Agent report.",
  aborted: "TargetResult Import input was aborted.",
} as const satisfies Readonly<
  Record<TargetResultImportInputErrorReason, string>
>;

export class TargetResultImportInputError extends Error {
  override readonly name = "TargetResultImportInputError";
  readonly code = "wakeflow-target-result-import-input" as const;
  readonly reason: TargetResultImportInputErrorReason;

  constructor(reason: TargetResultImportInputErrorReason) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
  }
}

function fail(reason: TargetResultImportInputErrorReason): never {
  throw new TargetResultImportInputError(reason);
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  try {
    return parsePlainRecord(value ?? {}, "$input");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input");
    throw error;
  }
}

function demandId(value: unknown): WakeflowDurableId<"demand"> {
  try {
    return parseWakeflowDurableIdOfKind(value, "demand");
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identity");
    throw error;
  }
}

export function parseTargetResultImportRequest(
  value: unknown,
): Readonly<TargetResultImportRequest> {
  const parsed = record(value);
  const expected = ["actionId", "demandId", "observationDigest", "report"];
  const keys = Object.keys(parsed).sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    fail("input");
  }
  let actionId: WindowWorkClaimId;
  try {
    actionId = parseWindowWorkClaimId(parsed.actionId);
  } catch (error: unknown) {
    if (error instanceof WindowWorkClaimError) fail("identity");
    throw error;
  }
  const reportRecord = record(parsed.report);
  const reportKeys = Object.keys(reportRecord).sort();
  if (
    reportKeys.length !== 2 ||
    reportKeys[0] !== "content" ||
    reportKeys[1] !== "workType" ||
    (reportRecord.workType !== "implementation" &&
      reportRecord.workType !== "test")
  ) {
    fail("input");
  }
  let report: TargetResultImportAgentReport;
  try {
    report =
      reportRecord.workType === "test"
        ? Object.freeze({
            workType: "test" as const,
            content: parseTestTargetResultReportContent(reportRecord.content),
          })
        : Object.freeze({
            workType: "implementation" as const,
            content: parseImplementationTargetResultReportContent(
              reportRecord.content,
            ),
          });
  } catch (error: unknown) {
    if (
      error instanceof ImplementationTargetResultReportError ||
      error instanceof TestTargetResultReportError
    ) {
      fail("report");
    }
    throw error;
  }
  let observationDigest: Sha256Digest;
  try {
    observationDigest = parseSha256Digest(
      parsed.observationDigest,
      "$/observationDigest",
    );
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest");
    throw error;
  }
  return Object.freeze({
    demandId: demandId(parsed.demandId),
    actionId,
    observationDigest,
    report,
  });
}

export function parseTargetResultImportOptions(
  value: unknown,
): Readonly<ParsedTargetResultImportOptions> {
  const parsed = record(value);
  if (
    Object.keys(parsed).some((key) => key !== "clock" && key !== "signal") ||
    (parsed.clock !== undefined &&
      (typeof parsed.clock !== "function" || types.isProxy(parsed.clock))) ||
    (parsed.signal !== undefined &&
      (typeof parsed.signal !== "object" ||
        parsed.signal === null ||
        types.isProxy(parsed.signal) ||
        !(parsed.signal instanceof AbortSignal)))
  ) {
    fail("input");
  }
  const signal = parsed.signal as AbortSignal | undefined;
  if (signal?.aborted === true) fail("aborted");
  return Object.freeze({
    clock: parsed.clock as UtcWallClock | undefined,
    signal,
  });
}
