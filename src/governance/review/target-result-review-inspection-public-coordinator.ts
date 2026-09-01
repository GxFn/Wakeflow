import {
  WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_RESULT_SCHEMA,
  type WakeflowTargetResultReviewInspectionResultV1 as InspectionResultWire,
} from "../../contracts/generated/entrypoints/wakeflow-target-result-review-inspection-result.generated.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
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
import {
  assertDemandOperationConfigCurrent,
  closeDemandOperationAuthorityContext,
  openDemandOperationAuthorityContext,
  DemandOperationAuthorityContextError,
  type DemandOperationAuthorityContext,
} from "../demand/demand-operation-authority-context.js";
import {
  readDemandResultReviewSnapshot,
  DemandResultReviewSnapshotError,
  type DemandTargetReviewHistoryEntry,
} from "./demand-result-review-snapshot.js";
import {
  parseTargetResultReviewInspectionPublicRequest,
  TargetResultReviewInspectionPublicContractError,
  WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
} from "./target-result-review-inspection-public-contract.js";

/**
 * Wakeflow Governance / Review：共享TargetResult Review公共只读投影。
 *
 * Coordinator返回当前reported unit或等待外部解决的blocked unit及精确Snapshot基线。
 * 它不运行独立检查、不生成allowed decisions，也不创建Controller acceptance、Resume
 * 或任何持久ReviewCandidate。
 */

export type TargetResultReviewInspectionPublicResult =
  Readonly<InspectionResultWire>;

export type TargetResultReviewInspectionPublicCoordinatorErrorReason =
  "root" | "inspection" | "privacy" | "output";

const ERROR_MESSAGES = {
  root: "Target Result Review inspection workspace root is invalid.",
  inspection: "Target Result Review inspection failed.",
  privacy: "Target Result Review context contains a private workspace value.",
  output: "Target Result Review inspection result violated its boundary.",
} as const satisfies Readonly<
  Record<TargetResultReviewInspectionPublicCoordinatorErrorReason, string>
>;

export class TargetResultReviewInspectionPublicCoordinatorError extends Error {
  override readonly name = "TargetResultReviewInspectionPublicCoordinatorError";
  readonly code =
    "wakeflow-target-result-review-inspection-public-coordinator" as const;
  readonly reason: TargetResultReviewInspectionPublicCoordinatorErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;

  constructor(
    reason: TargetResultReviewInspectionPublicCoordinatorErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.causeCode = causeCode;
    this.causeReason = causeReason;
  }
}

const TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_MAXIMUM_RESULT_BYTES =
  32 * 1024 * 1024;
const validateResult = createRuntimeJsonSchemaValidator<InspectionResultWire>(
  WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_RESULT_SCHEMA,
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
  reason: TargetResultReviewInspectionPublicCoordinatorErrorReason,
  cause?: unknown,
): never {
  throw new TargetResultReviewInspectionPublicCoordinatorError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
  );
}

type ReviewDecision = Extract<
  DemandTargetReviewHistoryEntry,
  { readonly kind: "decision" }
>["decision"];

function reviewDecisionSummary(decision: Readonly<ReviewDecision>) {
  return decision.kind === "WakeflowControllerImplementationReviewDecision"
    ? {
        workType: "implementation" as const,
        targetReviewDecisionId: decision.targetReviewDecisionId,
        decisionDigest: decision.decisionDigest,
        decision: decision.decision,
        assessment: decision.assessment,
        independentChecks: decision.independentChecks,
        rationale: decision.rationale,
        blockingReasons: decision.blockingReasons,
        residualRisks: decision.residualRisks,
        decidedAt: decision.decidedAt,
      }
    : {
        workType: "test" as const,
        targetReviewDecisionId: decision.targetReviewDecisionId,
        decisionDigest: decision.decisionDigest,
        decision: decision.decision,
        assessment: decision.assessment,
        independentChecks: decision.independentChecks,
        rationale: decision.rationale,
        blockingReasons: decision.blockingReasons,
        residualRisks: decision.residualRisks,
        decidedAt: decision.decidedAt,
      };
}

function decisionSummary(
  entry: Extract<DemandTargetReviewHistoryEntry, { readonly kind: "decision" }>,
) {
  return {
    kind: "decision" as const,
    sourceEvent: entry.sourceEvent,
    decision: reviewDecisionSummary(entry.decision),
  };
}

function historySummary(entry: Readonly<DemandTargetReviewHistoryEntry>) {
  if (entry.kind === "decision") return decisionSummary(entry);
  return {
    kind: "resume" as const,
    sourceEvent: entry.sourceEvent,
    resume: {
      targetReviewResumeId: entry.resume.targetReviewResumeId,
      resumeDigest: entry.resume.resumeDigest,
      blockedDecision: entry.resume.blockedDecision,
      blockedSource: entry.resume.blockedSource,
      resolutionSummary: entry.resume.resolutionSummary,
      resumedAt: entry.resume.resumedAt,
    },
  };
}

function containsPrivateText(
  value: JsonValue,
  privateValues: ReadonlySet<string>,
): boolean {
  if (typeof value === "string") {
    for (const privateValue of privateValues) {
      if (
        privateValue.length > 1 &&
        (value.includes(privateValue) ||
          value.includes(JSON.stringify(privateValue)))
      ) {
        return true;
      }
    }
    return false;
  }
  if (value === null || typeof value !== "object") return false;
  return Object.values(value).some((entry) =>
    containsPrivateText(entry, privateValues),
  );
}

function privateValues(
  requestRoot: string,
  workspaceRoot: RootedDirectory,
  context: Readonly<DemandOperationAuthorityContext>,
): ReadonlySet<string> {
  return new Set([
    requestRoot,
    workspaceRoot.absolutePath,
    context.config.ledgerRoot,
    context.demandRoot.absolutePath,
    context.ledgerRoot.absolutePath,
  ]);
}

function publicResult(
  value: unknown,
  values: ReadonlySet<string>,
): TargetResultReviewInspectionPublicResult {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$result");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("output", error);
    throw error;
  }
  const validated = validateResult(json);
  if (
    encodeCanonicalJson(json, "$result").byteLength >
      TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_MAXIMUM_RESULT_BYTES ||
    !validated.ok
  ) {
    fail("output");
  }
  if (containsPrivateText(json, values)) fail("privacy");
  return json as unknown as TargetResultReviewInspectionPublicResult;
}

function mapInspectionError(error: unknown): never {
  if (
    error instanceof DemandOperationAuthorityContextError ||
    error instanceof DemandResultReviewSnapshotError
  ) {
    fail("inspection", error);
  }
  throw error;
}

/** 返回一个当前reported或review-blocked TargetResult的完整只读Review Context。 */
export async function executeTargetResultReviewInspectionPublicRequest(
  value: unknown,
): Promise<TargetResultReviewInspectionPublicResult> {
  const request = parseTargetResultReviewInspectionPublicRequest(value);
  let workspaceRoot: RootedDirectory;
  try {
    workspaceRoot = await RootedDirectory.open(request.root, "$request.root");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root", error);
    throw error;
  }

  let context: Readonly<DemandOperationAuthorityContext> | undefined;
  let result: TargetResultReviewInspectionPublicResult | undefined;
  let failure: unknown;
  try {
    try {
      context = await openDemandOperationAuthorityContext(
        workspaceRoot,
        request.demandId,
        undefined,
      );
      const snapshot = await readDemandResultReviewSnapshot(context.demandRoot);
      const target = snapshot.targets.find(
        (entry) => entry.targetTaskId === request.targetTaskId,
      );
      const blocked =
        target?.status === "review-decided" &&
        target.reviewDecision.decision === "blocked" &&
        ((target.taskPackage.workType === "implementation" &&
          target.phase === "review-blocked" &&
          target.reviewDecision.kind ===
            "WakeflowControllerImplementationReviewDecision") ||
          (target.taskPackage.workType === "test" &&
            target.phase === "test-review-blocked" &&
            target.reviewDecision.kind ===
              "WakeflowControllerTestReviewDecision"));
      if (
        snapshot.demand.demandId !== request.demandId ||
        snapshot.demand.lifecycle !== "active" ||
        (target?.status !== "reported" && !blocked) ||
        target === undefined ||
        target.taskPackage.targetTaskId !== target.targetTaskId ||
        target.targetResult.targetTaskId !== target.targetTaskId ||
        target.taskPackage.taskPackageId !==
          target.targetResult.taskPackage.taskPackageId ||
        target.taskPackage.workType !== target.targetResult.workType ||
        target.outcome !== target.targetResult.report.outcome
      ) {
        fail("inspection");
      }
      const { snapshotDigest, ...snapshotBasis } = snapshot;
      const reviewUnitBasis = {
        status: "reported" as const,
        targetTaskId: target.targetTaskId,
        outcome: target.outcome,
        taskPackageSourceEvent: target.taskPackageSourceEvent,
        taskPackage: target.taskPackage,
        targetResultSourceEvent: target.targetResultSourceEvent,
        targetResult: target.targetResult,
        priorReviewHistory: target.priorReviewHistory,
      };
      if (
        computeCanonicalJsonSha256Digest(snapshotBasis) !== snapshotDigest ||
        computeCanonicalJsonSha256Digest(reviewUnitBasis) !==
          target.reviewUnitDigest
      ) {
        fail("inspection");
      }
      await assertDemandOperationConfigCurrent(
        workspaceRoot,
        context.config,
        undefined,
      );
      const commonReviewUnit = {
        workType: target.taskPackage.workType,
        targetTaskId: target.targetTaskId,
        outcome: target.outcome,
        taskPackageSourceEvent: target.taskPackageSourceEvent,
        taskPackage: target.taskPackage,
        targetResultSourceEvent: target.targetResultSourceEvent,
        targetResult: target.targetResult,
        priorReviewHistory: target.priorReviewHistory.map(historySummary),
        reviewUnitDigest: target.reviewUnitDigest,
      };
      result = publicResult(
        {
          kind: "WakeflowTargetResultReviewInspectionResult" as const,
          schemaVersion:
            WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_SCHEMA_VERSION,
          tool: WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
          status: "current" as const,
          demand: snapshot.demand,
          eventStream: snapshot.eventStream,
          snapshotDigest,
          reviewUnit:
            target.status === "reported"
              ? {
                  status: "reported" as const,
                  ...commonReviewUnit,
                }
              : {
                  status: "review-blocked" as const,
                  ...commonReviewUnit,
                  currentBlockedDecision: {
                    sourceEvent: target.reviewDecisionSourceEvent,
                    decision: reviewDecisionSummary(target.reviewDecision),
                  },
                },
        },
        privateValues(request.root, workspaceRoot, context),
      );
    } catch (error: unknown) {
      mapInspectionError(error);
    }
  } catch (error: unknown) {
    failure = error;
  }

  if (context !== undefined) {
    try {
      await closeDemandOperationAuthorityContext(context);
    } catch (error: unknown) {
      if (failure === undefined) {
        failure =
          error instanceof DemandOperationAuthorityContextError
            ? new TargetResultReviewInspectionPublicCoordinatorError(
                "inspection",
                error.code,
                error.reason,
              )
            : error;
      }
    }
  }
  try {
    await workspaceRoot.close();
  } catch (error: unknown) {
    if (failure === undefined) {
      failure = new TargetResultReviewInspectionPublicCoordinatorError(
        "root",
        ownString(error, "code"),
        ownString(error, "reason"),
      );
    }
  }

  if (failure !== undefined) throw failure;
  if (result === undefined) fail("output");
  return result;
}

export { TargetResultReviewInspectionPublicContractError };
