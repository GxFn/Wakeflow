import { types } from "node:util";

import {
  WAKEFLOW_TARGET_RESULT_IMPORT_RESULT_SCHEMA,
  type WakeflowTargetResultImportResultV1 as ImportResultWire,
} from "../../contracts/generated/entrypoints/wakeflow-target-result-import-result.generated.js";
import {
  canonicalizeJson,
  encodeCanonicalJson,
} from "../../foundation/data/canonical-json.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import {
  WAKEFLOW_WORKSPACE_HOST_IDS,
  type WakeflowWorkspaceHostId,
} from "../../workspace/workspace-host-resource-profile.js";
import { computeDemandEventStreamCommitDigest } from "../demand/event-sourcing/demand-event-stream-commit.js";
import type { TargetResultImportOptions } from "./target-result-import-input.js";
import {
  TargetResultImportService,
  TargetResultImportServiceError,
} from "./target-result-import-service.js";
import {
  implementationTargetResultReportContentDigest,
  type ImplementationTargetResultReport,
} from "./implementation-target-result-report.js";
import {
  testTargetResultReportContentDigest,
  type TestTargetResultReport,
} from "./test-target-result-report.js";
import {
  targetResultIdForAction,
  targetResultRecordedCommitIdFromResult,
  targetResultRecordedEventIdFromResult,
} from "./target-result.js";
import {
  parseTargetResultImportPublicRequest,
  TargetResultImportPublicContractError,
  WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
} from "./target-result-import-public-contract.js";

/**
 * Wakeflow Governance / Result：固定当前Host的TargetResult Import公共投影边界。
 *
 * Coordinator只接收Target作者的Report，完整TargetResult与Event身份由内部owner恢复。
 * 它不检查Report真实性、不执行Controller审查，也不把Agent outcome提升为acceptance。
 */

export type TargetResultImportPublicResult = Readonly<ImportResultWire>;

export interface TargetResultImportPublicHostFacade {
  readonly hostId: WakeflowWorkspaceHostId;
}

export interface TargetResultImportPublicCoordinatorOptions {
  readonly resultImport?: TargetResultImportOptions;
}

type ClaimAuthority = TargetResultImportServiceError["claimAuthority"];
type EventAuthority = TargetResultImportServiceError["eventAuthority"];

export type TargetResultImportPublicCoordinatorErrorReason =
  "host" | "root" | "privacy" | "result-import" | "output";

const ERROR_MESSAGES = {
  host: "TargetResult Import public host composition is invalid.",
  root: "TargetResult Import public workspace root is invalid.",
  privacy:
    "TargetResult Import Agent Report contains the canonical workspace root.",
  "result-import": "TargetResult Import public operation failed.",
  output: "TargetResult Import public result violated its boundary.",
} as const satisfies Readonly<
  Record<TargetResultImportPublicCoordinatorErrorReason, string>
>;

/** 公共Result Import编排失败时保留Result Event与Claim双权威状态。 */
export class TargetResultImportPublicCoordinatorError extends Error {
  override readonly name = "TargetResultImportPublicCoordinatorError";
  readonly code = "wakeflow-target-result-import-public-coordinator" as const;
  readonly reason: TargetResultImportPublicCoordinatorErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly eventAuthority: EventAuthority;
  readonly claimAuthority: ClaimAuthority;

  constructor(
    reason: TargetResultImportPublicCoordinatorErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
    eventAuthority: EventAuthority = "unchanged",
    claimAuthority: ClaimAuthority = "unknown",
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.causeCode = causeCode;
    this.causeReason = causeReason;
    this.eventAuthority = eventAuthority;
    this.claimAuthority = claimAuthority;
  }
}

const TARGET_RESULT_IMPORT_PUBLIC_MAXIMUM_RESULT_BYTES = 4 * 1024 * 1024;
const validateResult = createRuntimeJsonSchemaValidator<ImportResultWire>(
  WAKEFLOW_TARGET_RESULT_IMPORT_RESULT_SCHEMA,
);

function ownString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined &&
    Object.hasOwn(descriptor, "value") &&
    typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

function fail(
  reason: TargetResultImportPublicCoordinatorErrorReason,
  cause?: unknown,
  eventAuthority: EventAuthority = cause instanceof
  TargetResultImportServiceError
    ? cause.eventAuthority
    : "unchanged",
  claimAuthority: ClaimAuthority = cause instanceof
  TargetResultImportServiceError
    ? cause.claimAuthority
    : "unknown",
): never {
  throw new TargetResultImportPublicCoordinatorError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
    eventAuthority,
    claimAuthority,
  );
}

function assertFacade(
  value: Readonly<TargetResultImportPublicHostFacade>,
): Readonly<TargetResultImportPublicHostFacade> {
  if (
    typeof value !== "object" ||
    value === null ||
    types.isProxy(value) ||
    !Object.isFrozen(value) ||
    Object.keys(value).length !== 1
  ) {
    fail("host");
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, "hostId");
  const hostId =
    descriptor !== undefined && Object.hasOwn(descriptor, "value")
      ? descriptor.value
      : undefined;
  if (
    typeof hostId !== "string" ||
    !WAKEFLOW_WORKSPACE_HOST_IDS.some((candidate) => candidate === hostId)
  ) {
    fail("host");
  }
  return Object.freeze({ hostId: hostId as WakeflowWorkspaceHostId });
}

function containsText(value: JsonValue, text: string): boolean {
  if (typeof value === "string") {
    return value.includes(text) || value.includes(JSON.stringify(text));
  }
  if (value === null || typeof value !== "object") return false;
  return Object.values(value).some((entry) => containsText(entry, text));
}

function implementationContent(
  report: Readonly<ImplementationTargetResultReport>,
) {
  return {
    outcome: report.outcome,
    summary: report.summary,
    repositoryChange: report.repositoryChange,
    evidenceLocators: report.evidenceLocators,
    verification: report.verification,
    risks: report.risks,
    anchorEvidence: report.anchorEvidence,
  };
}

function testContent(report: Readonly<TestTargetResultReport>) {
  return {
    outcome: report.outcome,
    summary: report.summary,
    evidenceLocators: report.evidenceLocators,
    verification: report.verification,
    risks: report.risks,
    stepEvidence: report.stepEvidence,
  };
}

function projectImportResult(
  imported: Awaited<ReturnType<TargetResultImportService["import"]>>,
  request: ReturnType<typeof parseTargetResultImportPublicRequest>,
  hostId: WakeflowWorkspaceHostId,
) {
  const { claim, observation, result, commandResult } = imported;
  const event = commandResult.commit.events.find(
    (entry) =>
      entry.eventType === "result.target-result-recorded" &&
      entry.eventId === targetResultRecordedEventIdFromResult(result),
  );
  const reportMatches =
    request.report.workType === "test"
      ? result.workType === "test" &&
        testTargetResultReportContentDigest(testContent(result.report)) ===
          testTargetResultReportContentDigest(request.report.content)
      : result.workType === "implementation" &&
        implementationTargetResultReportContentDigest(
          implementationContent(result.report),
        ) ===
          implementationTargetResultReportContentDigest(request.report.content);
  if (
    event === undefined ||
    commandResult.commit.events.length !== 1 ||
    imported.claimAuthority !== "released" ||
    imported.eventAuthority !== "current" ||
    claim.route.hostId !== hostId ||
    claim.target.demandId !== request.demandId ||
    claim.claimId !== request.actionId ||
    observation.action.actionId !== request.actionId ||
    observation.observationDigest !== request.observationDigest ||
    result.targetResultId !== targetResultIdForAction(request.actionId) ||
    result.demandId !== request.demandId ||
    result.targetTaskId !== claim.target.targetTaskId ||
    result.targetDeliveryId !== claim.target.targetDeliveryId ||
    result.hostEffect.actionId !== claim.claimId ||
    result.hostEffect.claimDigest !== claim.claimDigest ||
    result.hostEffect.observationDigest !== observation.observationDigest ||
    !reportMatches ||
    (imported.status === "recorded") !==
      (imported.disposition === "committed") ||
    commandResult.commit.commitId !==
      targetResultRecordedCommitIdFromResult(result) ||
    commandResult.commit.demandId !== request.demandId ||
    commandResult.commit.commandDigest !== imported.commandDigest ||
    commandResult.commit.firstStreamRevision !== event.streamRevision ||
    commandResult.commit.lastStreamRevision !== event.streamRevision ||
    event.streamRevision !== commandResult.commit.expectedStreamRevision + 1 ||
    event.demandId !== request.demandId ||
    event.eventType !== "result.target-result-recorded" ||
    canonicalizeJson(event.data.result, "$eventResult") !==
      canonicalizeJson(result, "$result") ||
    computeDemandEventStreamCommitDigest(commandResult.commit) !==
      imported.commitDigest
  ) {
    fail("output", undefined, "current", imported.claimAuthority);
  }
  return {
    kind: "WakeflowTargetResultImportResult" as const,
    schemaVersion: WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_SCHEMA_VERSION,
    tool: WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
    status: imported.status,
    disposition: imported.disposition,
    claimAuthority: "released" as const,
    eventAuthority: "current" as const,
    result,
    event: {
      eventId: event.eventId,
      streamRevision: event.streamRevision,
    },
    commit: {
      commitId: commandResult.commit.commitId,
      commitSequence: commandResult.commit.commitSequence,
      commitDigest: imported.commitDigest,
    },
    stateDigest: event.resultingStateDigest,
  };
}

function publicResult(
  value: unknown,
  requestRoot: string,
  canonicalRoot: string,
): TargetResultImportPublicResult {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$result");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) {
      fail("output", error, "current", "released");
    }
    throw error;
  }
  const validated = validateResult(json);
  if (
    encodeCanonicalJson(json, "$result").byteLength >
      TARGET_RESULT_IMPORT_PUBLIC_MAXIMUM_RESULT_BYTES ||
    !validated.ok ||
    (requestRoot.length > 1 && containsText(json, requestRoot)) ||
    (canonicalRoot.length > 1 && containsText(json, canonicalRoot))
  ) {
    fail("output", undefined, "current", "released");
  }
  return json as unknown as TargetResultImportPublicResult;
}

/** 导入一份Target作者Report并返回严格TargetResult；本函数不执行Controller审查。 */
export async function executeTargetResultImportPublicRequest(
  facadeValue: Readonly<TargetResultImportPublicHostFacade>,
  value: unknown,
  options: TargetResultImportPublicCoordinatorOptions = {},
): Promise<TargetResultImportPublicResult> {
  const facade = assertFacade(facadeValue);
  const request = parseTargetResultImportPublicRequest(value);
  let root: RootedDirectory;
  try {
    root = await RootedDirectory.open(request.root, "$request.root");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root", error);
    throw error;
  }

  let eventAuthority: EventAuthority = "unchanged";
  let claimAuthority: ClaimAuthority = "unknown";
  let result: TargetResultImportPublicResult | undefined;
  let failure: unknown;
  try {
    if (
      root.absolutePath.length > 1 &&
      containsText(request.report.content as JsonValue, root.absolutePath)
    ) {
      fail("privacy");
    }
    let imported;
    try {
      imported = await new TargetResultImportService(
        root,
        facade.hostId,
      ).import(
        {
          demandId: request.demandId,
          actionId: request.actionId,
          observationDigest: request.observationDigest,
          report: request.report,
        },
        options.resultImport,
      );
      eventAuthority = "current";
      claimAuthority = "released";
    } catch (error: unknown) {
      if (error instanceof TargetResultImportServiceError) {
        fail(error.reason === "host" ? "host" : "result-import", error);
      }
      throw error;
    }
    result = publicResult(
      projectImportResult(imported, request, facade.hostId),
      request.root,
      root.absolutePath,
    );
  } catch (error: unknown) {
    if (error instanceof TargetResultImportPublicCoordinatorError) {
      eventAuthority = error.eventAuthority;
      claimAuthority = error.claimAuthority;
    }
    failure = error;
  }

  try {
    await root.close();
  } catch (error: unknown) {
    if (failure === undefined) {
      failure = new TargetResultImportPublicCoordinatorError(
        "root",
        ownString(error, "code"),
        ownString(error, "reason"),
        eventAuthority,
        claimAuthority,
      );
    }
  }
  if (failure !== undefined) throw failure;
  if (result === undefined) {
    fail("output", undefined, eventAuthority, claimAuthority);
  }
  return result;
}

export { TargetResultImportPublicContractError };
