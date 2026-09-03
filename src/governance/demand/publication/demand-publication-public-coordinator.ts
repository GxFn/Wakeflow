import {
  WAKEFLOW_DEMAND_PUBLICATION_RESULT_SCHEMA,
  type WakeflowDemandPublicationResultV1 as DemandPublicationPublicResultWire,
} from "../../../contracts/generated/entrypoints/wakeflow-demand-publication-result.generated.js";
import { encodeCanonicalJson } from "../../../foundation/data/canonical-json.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../../foundation/data/json-value.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../../foundation/filesystem/rooted-directory.js";
import { createRuntimeJsonSchemaValidator } from "../../../foundation/schema/runtime-json-schema.js";
import { computeDemandEventStreamCommitDigest } from "../event-sourcing/demand-event-stream-commit.js";
import {
  DemandEventSourcingPublicationApplicationService,
  DemandEventSourcingPublicationApplicationServiceError,
  type DemandEventSourcingPublicationApplicationOptions,
} from "./demand-event-sourcing-publication-application-service.js";
import {
  DemandEventSourcingPublicationPlanningService,
  DemandEventSourcingPublicationPlanningServiceError,
  type DemandEventSourcingPublicationPreviewOptions,
} from "./demand-event-sourcing-publication-planning-service.js";
import type {
  DemandEventSourcingPublicationEffectAuthority,
  DemandEventSourcingPublicationResult,
} from "./demand-event-sourcing-publication-service.js";
import {
  parseDemandPublicationPublicRequest,
  DemandPublicationPublicContractError,
  WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME,
} from "./demand-publication-public-contract.js";

/**
 * Wakeflow Governance / Demand Publication：公共根作用域、模式路由和结果脱敏边界。
 *
 * Coordinator不解释Authority选择、不构造Identity/Event，也不执行宿主效果。Preview委托
 * Planning Service；Apply/Recover委托Application Service；成功后只投影revision 1和TODO
 * claim的稳定回执，完整Aggregate、Authority内容、物理节点和机器路径不会进入公共结果。
 */

export type DemandPublicationPublicResult =
  Readonly<DemandPublicationPublicResultWire>;

export interface DemandPublicationPublicCoordinatorOptions {
  readonly preview?: DemandEventSourcingPublicationPreviewOptions;
  readonly apply?: DemandEventSourcingPublicationApplicationOptions;
  readonly recover?: DemandEventSourcingPublicationApplicationOptions;
}

export type DemandPublicationPublicCoordinatorErrorReason =
  "root" | "privacy" | "preview" | "apply" | "recover" | "output";

const ERROR_MESSAGES = {
  root: "Demand Publication public workspace root is invalid.",
  privacy: "Demand Publication public content contains private root text.",
  preview: "Demand Publication public preview failed.",
  apply: "Demand Publication public apply failed.",
  recover: "Demand Publication public recovery failed.",
  output: "Demand Publication public result violated its boundary.",
} as const satisfies Readonly<
  Record<DemandPublicationPublicCoordinatorErrorReason, string>
>;

export class DemandPublicationPublicCoordinatorError extends Error {
  override readonly name = "DemandPublicationPublicCoordinatorError";
  readonly code = "wakeflow-demand-publication-public-coordinator" as const;
  readonly reason: DemandPublicationPublicCoordinatorErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly publicationAuthority: DemandEventSourcingPublicationEffectAuthority;

  constructor(
    reason: DemandPublicationPublicCoordinatorErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
    publicationAuthority: DemandEventSourcingPublicationEffectAuthority = "unknown",
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.causeCode = causeCode;
    this.causeReason = causeReason;
    this.publicationAuthority = publicationAuthority;
  }
}

const DEMAND_PUBLICATION_PUBLIC_MAXIMUM_RESULT_BYTES = 32 * 1024 * 1024;
const validateResult =
  createRuntimeJsonSchemaValidator<DemandPublicationPublicResultWire>(
    WAKEFLOW_DEMAND_PUBLICATION_RESULT_SCHEMA,
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
  reason: DemandPublicationPublicCoordinatorErrorReason,
  cause?: unknown,
  publicationAuthority: DemandEventSourcingPublicationEffectAuthority = "unknown",
): never {
  throw new DemandPublicationPublicCoordinatorError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
    publicationAuthority,
  );
}

function containsPrivateText(
  value: unknown,
  privateValues: ReadonlySet<string>,
): boolean {
  if (typeof value === "string") {
    return [...privateValues].some((privateValue) =>
      value.includes(privateValue),
    );
  }
  if (value === null || typeof value !== "object") return false;
  return Object.values(value as Readonly<Record<string, unknown>>).some(
    (entry) => containsPrivateText(entry, privateValues),
  );
}

function publicResult(
  value: unknown,
  privateValues: ReadonlySet<string>,
  publicationAuthority: DemandEventSourcingPublicationEffectAuthority,
): DemandPublicationPublicResult {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$result");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) {
      fail("output", error, publicationAuthority);
    }
    throw error;
  }
  if (
    encodeCanonicalJson(json, "$result").byteLength >
      DEMAND_PUBLICATION_PUBLIC_MAXIMUM_RESULT_BYTES ||
    containsPrivateText(json, privateValues) ||
    !validateResult(json).ok
  ) {
    fail("output", undefined, publicationAuthority);
  }
  return json as unknown as DemandPublicationPublicResult;
}

function publicationReceipt(
  publication: Readonly<DemandEventSourcingPublicationResult>,
) {
  const commit = publication.loaded.firstCommit;
  const event = commit.events[0];
  const todo = publication.todo.item;
  if (
    publication.publicationAuthority !== "current" ||
    commit.commitSequence !== 1 ||
    commit.expectedStreamRevision !== 0 ||
    commit.firstStreamRevision !== 1 ||
    commit.lastStreamRevision !== 1 ||
    commit.events.length !== 1 ||
    event === undefined ||
    event.eventType !== "publication.demand-published" ||
    event.streamRevision !== 1 ||
    todo.state.status !== "claimed" ||
    todo.state.revision !== 2 ||
    todo.state.mount === null ||
    todo.state.mount.demandId !== publication.demandId ||
    todo.state.mount.identityDigest !== publication.loaded.identityDigest
  ) {
    fail("output", undefined, "current");
  }
  return Object.freeze({
    publicationAuthority: "current" as const,
    demandId: publication.demandId,
    identityDigest: publication.loaded.identityDigest,
    authorityDigest: publication.loaded.authorityDigest,
    commandDigest: commit.commandDigest,
    event: Object.freeze({
      eventId: event.eventId,
      streamRevision: 1 as const,
    }),
    commit: Object.freeze({
      commitId: commit.commitId,
      commitSequence: 1 as const,
      commitDigest: computeDemandEventStreamCommitDigest(commit),
    }),
    stateDigest: event.resultingStateDigest,
    todoClaim: Object.freeze({
      todoId: todo.todoId,
      intakeDigest: todo.intakeDigest,
      stateRevision: 2 as const,
      stateDigest: todo.stateDigest,
    }),
  });
}

function initialPublicationAuthority(
  mode: "preview" | "apply" | "recover",
): DemandEventSourcingPublicationEffectAuthority {
  return mode === "preview" ? "unchanged" : "unknown";
}

/** 执行公共Demand Publication preview、exact-plan apply或sidecar recovery。 */
export async function executeDemandPublicationPublicRequest(
  value: unknown,
  options: DemandPublicationPublicCoordinatorOptions = {},
): Promise<DemandPublicationPublicResult> {
  const request = parseDemandPublicationPublicRequest(value);
  let publicationAuthority = initialPublicationAuthority(request.mode);
  let root: RootedDirectory;
  try {
    root = await RootedDirectory.open(request.root, "$request.root");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      fail("root", error, publicationAuthority);
    }
    throw error;
  }
  const privateValues = new Set(
    [request.root, root.absolutePath].filter((entry) => entry.length > 1),
  );
  let result: DemandPublicationPublicResult | undefined;
  let failure: unknown;
  try {
    if (request.mode === "preview") {
      if (
        containsPrivateText(request.demand, privateValues)
      ) {
        fail("privacy", undefined, "unchanged");
      }
      let preview;
      try {
        preview = await new DemandEventSourcingPublicationPlanningService(
          root,
        ).preview(
          {
            todoId: request.todoId,
            demand: request.demand,
          },
          options.preview,
        );
      } catch (error: unknown) {
        if (
          error instanceof DemandEventSourcingPublicationPlanningServiceError
        ) {
          fail("preview", error, "unchanged");
        }
        throw error;
      }
      result = publicResult(
        {
          kind: "WakeflowDemandPublicationPreviewResult",
          schemaVersion: WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_SCHEMA_VERSION,
          tool: WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME,
          mode: "preview",
          status: "ready",
          plan: preview.plan,
          planDigest: preview.planDigest,
        },
        privateValues,
        publicationAuthority,
      );
    } else if (request.mode === "apply") {
      if (containsPrivateText(request.plan, privateValues)) {
        fail("privacy", undefined, publicationAuthority);
      }
      let applied;
      try {
        applied = await new DemandEventSourcingPublicationApplicationService(
          root,
        ).apply(request.plan, request.planDigest, options.apply);
      } catch (error: unknown) {
        if (
          error instanceof DemandEventSourcingPublicationApplicationServiceError
        ) {
          publicationAuthority = error.publicationAuthority;
          fail("apply", error, publicationAuthority);
        }
        throw error;
      }
      publicationAuthority = "current";
      result = publicResult(
        {
          kind: "WakeflowDemandPublicationApplyResult",
          schemaVersion: WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_SCHEMA_VERSION,
          tool: WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME,
          mode: "apply",
          status: "current",
          planDigest: applied.planDigest,
          publication: publicationReceipt(applied.publication),
        },
        privateValues,
        publicationAuthority,
      );
    } else {
      let recovered;
      try {
        recovered = await new DemandEventSourcingPublicationApplicationService(
          root,
        ).recover(request.demandId, options.recover);
      } catch (error: unknown) {
        if (
          error instanceof DemandEventSourcingPublicationApplicationServiceError
        ) {
          publicationAuthority = error.publicationAuthority;
          fail("recover", error, publicationAuthority);
        }
        throw error;
      }
      publicationAuthority = "current";
      result = publicResult(
        {
          kind: "WakeflowDemandPublicationRecoveryResult",
          schemaVersion: WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_SCHEMA_VERSION,
          tool: WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME,
          mode: "recover",
          status: "current",
          publication: publicationReceipt(recovered.publication),
        },
        privateValues,
        publicationAuthority,
      );
    }
  } catch (error: unknown) {
    if (error instanceof DemandPublicationPublicCoordinatorError) {
      publicationAuthority = error.publicationAuthority;
    }
    failure = error;
  }
  try {
    await root.close();
  } catch (error: unknown) {
    if (failure === undefined) {
      failure = new DemandPublicationPublicCoordinatorError(
        "root",
        ownString(error, "code"),
        ownString(error, "reason"),
        publicationAuthority,
      );
    }
  }
  if (failure !== undefined) throw failure;
  if (result === undefined) {
    fail("output", undefined, publicationAuthority);
  }
  return result;
}

export { DemandPublicationPublicContractError };
