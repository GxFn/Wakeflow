import {
  WAKEFLOW_DEMAND_COMPLETION_RESULT_SCHEMA,
  type WakeflowDemandCompletionResultV1 as DemandCompletionPublicResultWire,
} from "../../contracts/generated/entrypoints/wakeflow-demand-completion-result.generated.js";
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
import { computeDemandEventStreamCommitDigest } from "../demand/event-sourcing/demand-event-stream-commit.js";
import {
  parseDemandCompletionPublicRequest,
  DemandCompletionPublicContractError,
  type DemandCompletionPublicApplyRequest,
  WAKEFLOW_DEMAND_COMPLETION_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
} from "./demand-completion-public-contract.js";
import {
  DemandCompletionService,
  DemandCompletionServiceError,
  type DemandCompletionApplyOptions,
  type DemandCompletionEventAuthority,
  type DemandCompletionPreviewOptions,
} from "./demand-completion-service.js";

/**
 * Wakeflow Governance / Lifecycle：Demand Completion公共终态写入边界。
 *
 * Coordinator只执行已确认的preview/apply，不把completed解释为TODO归档、BusinessArchive、
 * 宿主关闭或资源清理。内部Service仍拥有全部Route、TODO、WorkClaim、Config与Event准入。
 */

export type DemandCompletionPublicResult =
  Readonly<DemandCompletionPublicResultWire>;

export interface DemandCompletionPublicCoordinatorOptions {
  readonly preview?: DemandCompletionPreviewOptions;
  readonly apply?: DemandCompletionApplyOptions;
}

export type DemandCompletionPublicCoordinatorErrorReason =
  "root" | "preview" | "apply" | "output";

const ERROR_MESSAGES = {
  root: "Demand Completion public workspace root is invalid.",
  preview: "Demand Completion public preview failed.",
  apply: "Demand Completion public apply failed.",
  output: "Demand Completion public result violated its boundary.",
} as const satisfies Readonly<
  Record<DemandCompletionPublicCoordinatorErrorReason, string>
>;

/** 公共Completion失败时保留稳定分类和Event authority。 */
export class DemandCompletionPublicCoordinatorError extends Error {
  override readonly name = "DemandCompletionPublicCoordinatorError";
  readonly code = "wakeflow-demand-completion-public-coordinator" as const;
  readonly reason: DemandCompletionPublicCoordinatorErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly eventAuthority: DemandCompletionEventAuthority;

  constructor(
    reason: DemandCompletionPublicCoordinatorErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
    eventAuthority: DemandCompletionEventAuthority = "unchanged",
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.causeCode = causeCode;
    this.causeReason = causeReason;
    this.eventAuthority = eventAuthority;
  }
}

const DEMAND_COMPLETION_PUBLIC_MAXIMUM_RESULT_BYTES = 24 * 1024 * 1024;
const validateResult =
  createRuntimeJsonSchemaValidator<DemandCompletionPublicResultWire>(
    WAKEFLOW_DEMAND_COMPLETION_RESULT_SCHEMA,
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
  reason: DemandCompletionPublicCoordinatorErrorReason,
  cause?: unknown,
  eventAuthority: DemandCompletionEventAuthority = cause instanceof
  DemandCompletionServiceError
    ? cause.eventAuthority
    : "unchanged",
): never {
  throw new DemandCompletionPublicCoordinatorError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
    eventAuthority,
  );
}

function containsPrivateText(value: JsonValue, privateText: string): boolean {
  if (typeof value === "string") {
    return (
      value.includes(privateText) || value.includes(JSON.stringify(privateText))
    );
  }
  if (value === null || typeof value !== "object") return false;
  return Object.values(value).some((entry) =>
    containsPrivateText(entry, privateText),
  );
}

function publicResult(
  value: unknown,
  requestRoot: string,
  canonicalRoot: string,
  eventAuthority: DemandCompletionEventAuthority,
): DemandCompletionPublicResult {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$result");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("output", error, eventAuthority);
    throw error;
  }
  const validated = validateResult(json);
  if (
    encodeCanonicalJson(json, "$result").byteLength >
      DEMAND_COMPLETION_PUBLIC_MAXIMUM_RESULT_BYTES ||
    !validated.ok ||
    (requestRoot.length > 1 && containsPrivateText(json, requestRoot)) ||
    (canonicalRoot.length > 1 && containsPrivateText(json, canonicalRoot))
  ) {
    fail("output", undefined, eventAuthority);
  }
  return json as unknown as DemandCompletionPublicResult;
}

function projectApplyResult(
  result: Awaited<ReturnType<DemandCompletionService["apply"]>>,
  request: DemandCompletionPublicApplyRequest,
) {
  const { commandResult, plan } = result;
  const event = commandResult.commit.events.find(
    (entry) =>
      entry.eventId === plan.eventId &&
      entry.eventType === "lifecycle.demand-completed",
  );
  const committedStateMatches =
    result.disposition === "idempotent" ||
    (event !== undefined &&
      commandResult.aggregate.state.lifecycle === "completed" &&
      commandResult.aggregate.streamRevision === event.streamRevision &&
      commandResult.aggregate.stateDigest === event.resultingStateDigest);
  if (
    event === undefined ||
    !committedStateMatches ||
    result.eventAuthority !== "current" ||
    result.planDigest !== request.planDigest ||
    canonicalizeJson(plan, "$resultPlan") !==
      canonicalizeJson(request.plan, "$requestPlan") ||
    (result.status === "completed") !== (result.disposition === "committed") ||
    commandResult.commit.events.length !== 1 ||
    commandResult.commit.commitId !== plan.commitId ||
    commandResult.commit.demandId !== plan.demandId ||
    commandResult.commit.commandDigest !== result.commandDigest ||
    commandResult.commit.expectedStreamRevision !==
      plan.expectedStreamRevision ||
    commandResult.commit.firstStreamRevision !== event.streamRevision ||
    commandResult.commit.lastStreamRevision !== event.streamRevision ||
    event.streamRevision !== plan.expectedStreamRevision + 1 ||
    event.demandId !== plan.demandId ||
    event.recordedAt !== plan.completion.completedAt ||
    canonicalizeJson(event.data.completion, "$eventCompletion") !==
      canonicalizeJson(plan.completion, "$planCompletion") ||
    computeDemandEventStreamCommitDigest(commandResult.commit) !==
      result.commitDigest
  ) {
    fail("output", undefined, "current");
  }
  return {
    kind: "WakeflowDemandCompletionApplyResult" as const,
    schemaVersion: WAKEFLOW_DEMAND_COMPLETION_PUBLIC_SCHEMA_VERSION,
    tool: WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
    mode: "apply" as const,
    status: result.status,
    disposition: result.disposition,
    eventAuthority: "current" as const,
    completion: plan.completion,
    planDigest: result.planDigest,
    commandDigest: result.commandDigest,
    event: {
      eventId: event.eventId,
      streamRevision: event.streamRevision,
    },
    commit: {
      commitId: commandResult.commit.commitId,
      commitSequence: commandResult.commit.commitSequence,
      commitDigest: result.commitDigest,
    },
    stateDigest: event.resultingStateDigest,
  };
}

/** 执行公共Demand Completion preview或exact-plan apply。 */
export async function executeDemandCompletionPublicRequest(
  value: unknown,
  options: DemandCompletionPublicCoordinatorOptions = {},
): Promise<DemandCompletionPublicResult> {
  const request = parseDemandCompletionPublicRequest(value);
  let root: RootedDirectory;
  try {
    root = await RootedDirectory.open(request.root, "$request.root");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root", error);
    throw error;
  }

  let eventAuthority: DemandCompletionEventAuthority = "unchanged";
  let result: DemandCompletionPublicResult | undefined;
  let failure: unknown;
  try {
    const service = new DemandCompletionService(root);
    if (request.mode === "preview") {
      let preview;
      try {
        preview = await service.preview(
          { demandId: request.demandId },
          options.preview,
        );
      } catch (error: unknown) {
        if (error instanceof DemandCompletionServiceError) {
          fail("preview", error);
        }
        throw error;
      }
      if (
        preview.plan.demandId !== request.demandId ||
        preview.plan.completion.demandId !== request.demandId
      ) {
        fail("output");
      }
      result = publicResult(
        {
          kind: "WakeflowDemandCompletionPreviewResult",
          schemaVersion: WAKEFLOW_DEMAND_COMPLETION_PUBLIC_SCHEMA_VERSION,
          tool: WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
          mode: "preview",
          status: "ready",
          plan: preview.plan,
          planDigest: preview.planDigest,
        },
        request.root,
        root.absolutePath,
        eventAuthority,
      );
    } else {
      let applied;
      try {
        applied = await service.apply(
          request.plan,
          request.planDigest,
          options.apply,
        );
        eventAuthority = "current";
      } catch (error: unknown) {
        if (error instanceof DemandCompletionServiceError) {
          eventAuthority = error.eventAuthority;
          fail("apply", error);
        }
        throw error;
      }
      result = publicResult(
        projectApplyResult(applied, request),
        request.root,
        root.absolutePath,
        eventAuthority,
      );
    }
  } catch (error: unknown) {
    if (error instanceof DemandCompletionPublicCoordinatorError) {
      eventAuthority = error.eventAuthority;
    }
    failure = error;
  }

  try {
    await root.close();
  } catch (error: unknown) {
    if (failure === undefined) {
      failure = new DemandCompletionPublicCoordinatorError(
        "root",
        ownString(error, "code"),
        ownString(error, "reason"),
        eventAuthority,
      );
    }
  }
  if (failure !== undefined) throw failure;
  if (result === undefined) fail("output", undefined, eventAuthority);
  return result;
}

export { DemandCompletionPublicContractError };
