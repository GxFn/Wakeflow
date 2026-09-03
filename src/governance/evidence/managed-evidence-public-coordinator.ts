import {
  WAKEFLOW_MANAGED_EVIDENCE_PUBLICATION_RESULT_SCHEMA,
  type WakeflowManagedEvidencePublicationResultV1 as ManagedEvidencePublicResultWire,
} from "../../contracts/generated/entrypoints/wakeflow-managed-evidence-publication-result.generated.js";
import { encodeCanonicalJson } from "../../foundation/data/canonical-json.js";
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
  ManagedEvidencePublicationApplicationService,
  ManagedEvidencePublicationApplicationServiceError,
  type ManagedEvidencePublicationApplicationOptions,
  type ManagedEvidencePublicationCompletionResult,
  type ManagedEvidencePublicationEffectAuthority,
  type ManagedEvidencePublicationRetirementResult,
} from "./managed-evidence-publication-application-service.js";
import {
  ManagedEvidencePublicationPlanningService,
  ManagedEvidencePublicationPlanningServiceError,
  type ManagedEvidencePublicationPlanningOptions,
} from "./managed-evidence-publication-planning-service.js";
import {
  computeManagedEvidencePublicationTransactionDigest,
  parseManagedEvidencePublicationTransaction,
  ManagedEvidencePublicationTransactionError,
} from "./managed-evidence-publication-transaction.js";
import {
  parseManagedEvidencePublicRequest,
  ManagedEvidencePublicContractError,
  WAKEFLOW_MANAGED_EVIDENCE_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_MANAGED_EVIDENCE_PUBLIC_TOOL_NAME,
} from "./managed-evidence-public-contract.js";

/**
 * Wakeflow Governance / Evidence：公共根作用域、模式路由与metadata-only结果边界。
 *
 * Preview委托零写Planning并返回包含调用方逻辑source ref的完整确认计划；Apply/Recover
 * 委托Application且只保留typed ID、摘要与Event/Commit/Aggregate游标，不返回Manifest
 * 正文、source ref、Config/window身份、物理路径、节点、payload bytes或内部capability。
 * 按需Reader仍是内部能力。
 */

export type ManagedEvidencePublicResult =
  Readonly<ManagedEvidencePublicResultWire>;

export interface ManagedEvidencePublicCoordinatorOptions {
  readonly preview?: ManagedEvidencePublicationPlanningOptions;
  readonly apply?: ManagedEvidencePublicationApplicationOptions;
  readonly recover?: ManagedEvidencePublicationApplicationOptions;
}

export type ManagedEvidencePublicCoordinatorErrorReason =
  | "root"
  | "privacy"
  | "preview"
  | "apply"
  | "recover"
  | "output";

const ERROR_MESSAGES = {
  root: "Managed Evidence public workspace root is invalid.",
  privacy: "Managed Evidence public content contains private root text.",
  preview: "Managed Evidence public preview failed.",
  apply: "Managed Evidence public apply failed.",
  recover: "Managed Evidence public recovery failed.",
  output: "Managed Evidence public result violated its boundary.",
} as const satisfies Readonly<
  Record<ManagedEvidencePublicCoordinatorErrorReason, string>
>;

export class ManagedEvidencePublicCoordinatorError extends Error {
  override readonly name = "ManagedEvidencePublicCoordinatorError";
  readonly code = "wakeflow-managed-evidence-public-coordinator" as const;
  readonly reason: ManagedEvidencePublicCoordinatorErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly publicationAuthority: ManagedEvidencePublicationEffectAuthority;

  constructor(
    reason: ManagedEvidencePublicCoordinatorErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
    publicationAuthority: ManagedEvidencePublicationEffectAuthority = "unknown",
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.causeCode = causeCode;
    this.causeReason = causeReason;
    this.publicationAuthority = publicationAuthority;
  }
}

const MANAGED_EVIDENCE_PUBLIC_MAXIMUM_RESULT_BYTES = 4 * 1024 * 1024;
const validateResult =
  createRuntimeJsonSchemaValidator<ManagedEvidencePublicResultWire>(
    WAKEFLOW_MANAGED_EVIDENCE_PUBLICATION_RESULT_SCHEMA,
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
  reason: ManagedEvidencePublicCoordinatorErrorReason,
  cause?: unknown,
  publicationAuthority: ManagedEvidencePublicationEffectAuthority = "unknown",
): never {
  throw new ManagedEvidencePublicCoordinatorError(
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
  publicationAuthority: ManagedEvidencePublicationEffectAuthority,
): ManagedEvidencePublicResult {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$result");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) {
      fail("output", error, publicationAuthority);
    }
    throw error;
  }
  const validated = validateResult(json);
  if (
    encodeCanonicalJson(json, "$result").byteLength >
      MANAGED_EVIDENCE_PUBLIC_MAXIMUM_RESULT_BYTES ||
    containsPrivateText(json, privateValues) ||
    !validated.ok
  ) {
    fail("output", undefined, publicationAuthority);
  }
  return json as unknown as ManagedEvidencePublicResult;
}

function assertApplyPlan(
  planValue: unknown,
  planDigest: string,
  demandId: string,
): void {
  try {
    const plan = parseManagedEvidencePublicationTransaction(planValue);
    if (
      plan.manifest.demandId !== demandId ||
      computeManagedEvidencePublicationTransactionDigest(plan) !== planDigest
    ) {
      fail("apply", undefined, "unchanged");
    }
  } catch (error: unknown) {
    if (error instanceof ManagedEvidencePublicationTransactionError) {
      fail("apply", error, "unchanged");
    }
    throw error;
  }
}

function publicationReceipt(
  completed: Readonly<ManagedEvidencePublicationCompletionResult>,
) {
  const transaction = completed.transaction;
  const manifest = transaction.manifest;
  const commit = completed.commit;
  const event = commit.events[0];
  const selector = completed.loaded.aggregate.state.managedEvidence?.find(
    (candidate) => candidate.evidenceId === manifest.evidenceId,
  );
  const record = completed.loaded.inventory.managedEvidence.records.find(
    (candidate) => candidate.evidenceId === manifest.evidenceId,
  );
  if (
    completed.disposition !== "completed" ||
    completed.transactionDigest !==
      computeManagedEvidencePublicationTransactionDigest(transaction) ||
    transaction.demandEventSourcingAppend.commandDigest !==
      commit.commandDigest ||
    commit.commitId !== transaction.demandEventSourcingAppend.commitId ||
    commit.expectedStreamRevision !==
      transaction.demandEventSourcingAppend.expectedStreamRevision ||
    commit.events.length !== 1 ||
    event === undefined ||
    event.eventId !== transaction.demandEventSourcingAppend.eventId ||
    event.eventType !== "evidence.managed-evidence-recorded" ||
    event.streamRevision !== commit.lastStreamRevision ||
    selector?.manifestDigest !== manifest.manifestDigest ||
    selector.payloadArtifactDigest !== manifest.payload.artifactDigest ||
    record?.manifestDigest !== manifest.manifestDigest ||
    record.payloadArtifactDigest !== manifest.payload.artifactDigest ||
    record.recordTreePlanDigest !== transaction.recordTreePlanDigest ||
    record.payloadVerification !== "deferred" ||
    completed.loaded.identity.demandId !== manifest.demandId ||
    completed.loaded.identity.programId !== manifest.programId
  ) {
    fail("output", undefined, "current");
  }
  return Object.freeze({
    demandId: manifest.demandId,
    evidenceId: manifest.evidenceId,
    transactionDigest: completed.transactionDigest,
    manifestDigest: manifest.manifestDigest,
    payloadArtifactDigest: manifest.payload.artifactDigest,
    recordTreePlanDigest: transaction.recordTreePlanDigest,
    commandDigest: commit.commandDigest,
    event: Object.freeze({
      eventId: event.eventId,
      streamRevision: event.streamRevision,
    }),
    commit: Object.freeze({
      commitId: commit.commitId,
      commitSequence: commit.commitSequence,
      commitDigest: computeDemandEventStreamCommitDigest(commit),
    }),
    aggregate: Object.freeze({
      streamRevision: completed.loaded.aggregate.streamRevision,
      stateDigest: completed.loaded.aggregate.stateDigest,
    }),
  });
}

function retirementReceipt(
  retired: Readonly<ManagedEvidencePublicationRetirementResult>,
) {
  const manifest = retired.transaction.manifest;
  if (
    retired.disposition !== "retired-stale" ||
    retired.transactionDigest !==
      computeManagedEvidencePublicationTransactionDigest(retired.transaction) ||
    retired.loaded.identity.demandId !== manifest.demandId ||
    retired.loaded.aggregate.state.managedEvidence?.some(
      (candidate) => candidate.evidenceId === manifest.evidenceId,
    ) === true
  ) {
    fail("output", undefined, "unchanged");
  }
  return Object.freeze({
    demandId: manifest.demandId,
    evidenceId: manifest.evidenceId,
    transactionDigest: retired.transactionDigest,
    manifestDigest: manifest.manifestDigest,
    payloadArtifactDigest: manifest.payload.artifactDigest,
  });
}

function initialPublicationAuthority(
  mode: "preview" | "apply" | "recover",
): ManagedEvidencePublicationEffectAuthority {
  return mode === "preview" ? "unchanged" : "unknown";
}

/** 执行公共Managed Evidence preview、exact-plan apply或Demand级recovery。 */
export async function executeManagedEvidencePublicRequest(
  value: unknown,
  options: ManagedEvidencePublicCoordinatorOptions = {},
): Promise<ManagedEvidencePublicResult> {
  const request = parseManagedEvidencePublicRequest(value);
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
  let result: ManagedEvidencePublicResult | undefined;
  let failure: unknown;
  try {
    if (request.mode === "preview") {
      if (containsPrivateText(request.selection, privateValues)) {
        fail("privacy", undefined, "unchanged");
      }
      let preview;
      try {
        preview = await new ManagedEvidencePublicationPlanningService(
          root,
        ).preview(request.demandId, request.selection, options.preview);
      } catch (error: unknown) {
        if (error instanceof ManagedEvidencePublicationPlanningServiceError) {
          fail("preview", error, "unchanged");
        }
        throw error;
      }
      result = publicResult(
        {
          kind: "WakeflowManagedEvidencePublicationPreviewResult",
          schemaVersion: WAKEFLOW_MANAGED_EVIDENCE_PUBLIC_SCHEMA_VERSION,
          tool: WAKEFLOW_MANAGED_EVIDENCE_PUBLIC_TOOL_NAME,
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
        fail("privacy", undefined, "unchanged");
      }
      assertApplyPlan(request.plan, request.planDigest, request.demandId);
      let applied;
      try {
        applied = await new ManagedEvidencePublicationApplicationService(
          root,
        ).apply(request.plan, request.planDigest, options.apply);
      } catch (error: unknown) {
        if (error instanceof ManagedEvidencePublicationApplicationServiceError) {
          publicationAuthority = error.publicationAuthority;
          fail("apply", error, publicationAuthority);
        }
        throw error;
      }
      publicationAuthority = "current";
      result = publicResult(
        {
          kind: "WakeflowManagedEvidencePublicationApplyResult",
          schemaVersion: WAKEFLOW_MANAGED_EVIDENCE_PUBLIC_SCHEMA_VERSION,
          tool: WAKEFLOW_MANAGED_EVIDENCE_PUBLIC_TOOL_NAME,
          mode: "apply",
          status: "current",
          planDigest: request.planDigest,
          publication: publicationReceipt(applied),
        },
        privateValues,
        publicationAuthority,
      );
    } else {
      let recovered;
      try {
        recovered = await new ManagedEvidencePublicationApplicationService(
          root,
        ).recover(request.demandId, options.recover);
      } catch (error: unknown) {
        if (error instanceof ManagedEvidencePublicationApplicationServiceError) {
          publicationAuthority = error.publicationAuthority;
          fail("recover", error, publicationAuthority);
        }
        throw error;
      }
      if (recovered.disposition === "completed") {
        publicationAuthority = "current";
        result = publicResult(
          {
            kind: "WakeflowManagedEvidencePublicationRecoveryResult",
            schemaVersion: WAKEFLOW_MANAGED_EVIDENCE_PUBLIC_SCHEMA_VERSION,
            tool: WAKEFLOW_MANAGED_EVIDENCE_PUBLIC_TOOL_NAME,
            mode: "recover",
            status: "current",
            publication: publicationReceipt(recovered),
          },
          privateValues,
          publicationAuthority,
        );
      } else if (recovered.disposition === "retired-stale") {
        publicationAuthority = "unchanged";
        result = publicResult(
          {
            kind: "WakeflowManagedEvidencePublicationRecoveryResult",
            schemaVersion: WAKEFLOW_MANAGED_EVIDENCE_PUBLIC_SCHEMA_VERSION,
            tool: WAKEFLOW_MANAGED_EVIDENCE_PUBLIC_TOOL_NAME,
            mode: "recover",
            status: "retired-stale",
            retirement: retirementReceipt(recovered),
          },
          privateValues,
          publicationAuthority,
        );
      } else {
        publicationAuthority = "current";
        const loaded = recovered.loaded;
        result = publicResult(
          {
            kind: "WakeflowManagedEvidencePublicationRecoveryResult",
            schemaVersion: WAKEFLOW_MANAGED_EVIDENCE_PUBLIC_SCHEMA_VERSION,
            tool: WAKEFLOW_MANAGED_EVIDENCE_PUBLIC_TOOL_NAME,
            mode: "recover",
            status: "healthy",
            health: {
              demandId: loaded.identity.demandId,
              streamRevision: loaded.aggregate.streamRevision,
              stateDigest: loaded.aggregate.stateDigest,
              managedEvidenceCount:
                loaded.aggregate.state.managedEvidence?.length ?? 0,
            },
          },
          privateValues,
          publicationAuthority,
        );
      }
    }
  } catch (error: unknown) {
    if (error instanceof ManagedEvidencePublicCoordinatorError) {
      publicationAuthority = error.publicationAuthority;
    }
    failure = error;
  }
  try {
    await root.close();
  } catch (error: unknown) {
    if (failure === undefined) {
      failure = new ManagedEvidencePublicCoordinatorError(
        "root",
        ownString(error, "code"),
        ownString(error, "reason"),
        publicationAuthority,
      );
    }
  }
  if (failure !== undefined) throw failure;
  if (result === undefined) fail("output", undefined, publicationAuthority);
  return result;
}

export { ManagedEvidencePublicContractError };
