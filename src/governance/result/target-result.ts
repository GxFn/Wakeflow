import type { WakeflowTargetResult as ResultWire } from "../../contracts/generated/governance/result/target-result.generated.js";
import { WAKEFLOW_TARGET_RESULT_SCHEMA } from "../../contracts/generated/governance/result/target-result.generated.js";
import { WAKEFLOW_IMPLEMENTATION_TARGET_RESULT_REPORT_SCHEMA } from "../../contracts/generated/governance/result/implementation-target-result-report.generated.js";
import { WAKEFLOW_GIT_OBJECT_ID_SCHEMA } from "../../contracts/generated/foundation/git-object-id.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
import { WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA } from "../../contracts/generated/governance/ledger/ledger-authority-member-reference.generated.js";
import { WAKEFLOW_TASK_PACKAGE_SCHEMA } from "../../contracts/generated/governance/tasking/task-package.generated.js";
import { WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA } from "../../contracts/generated/workspace/window-host-binding.generated.js";
import { WAKEFLOW_TEST_TARGET_RESULT_REPORT_SCHEMA } from "../../contracts/generated/governance/result/test-target-result-report.generated.js";
import {
  createWakeflowDurableId,
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
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
  type JsonValue,
} from "../../foundation/data/json-value.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import { parseUuidV4 } from "../../foundation/identity/uuid-v4.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import {
  parseUtcInstant,
  UtcInstantError,
  type UtcInstant,
} from "../../foundation/time/utc-instant.js";
import {
  targetDeliveryHostEffectObservationEventId,
  type TargetDeliveryHostEffectObservation,
} from "../delivery/target-delivery-host-effect-observation.js";
import {
  parseWindowWorkClaim,
  parseWindowWorkClaimId,
  WindowWorkClaimError,
  type WindowWorkClaim,
  type WindowWorkClaimId,
} from "../delivery/window-work-claim.js";
import {
  parseImplementationTargetResultReport,
  ImplementationTargetResultReportError,
  type ImplementationTargetResultReport,
} from "./implementation-target-result-report.js";
import {
  parseTestTargetResultReport,
  TestTargetResultReportError,
  type TestTargetResultReport,
} from "./test-target-result-report.js";
import type { TargetResultOutcome } from "./target-result-report-contract.js";

/**
 * Wakeflow Governance / Result：由Wakeflow authority补齐的不可变TargetResult。
 *
 * TargetResult将Agent Report与当前TaskPackage、assignment和Host Effect Event闭合。结构完整只
 * 表示可进入Controller review，不表示结果真实、任务已接受或Demand已完成。
 */

const RESULT_KIND = "WakeflowTargetResult" as const;
const RESULT_SCHEMA_VERSION = 1 as const;
const CLAIM_ID_PREFIX = "window_work_claim_";
const EVENT_ID_PREFIX = "demand-event_";
const COMMIT_ID_PREFIX = "demand-event-commit_";

interface TargetResultBase {
  readonly kind: typeof RESULT_KIND;
  readonly schemaVersion: typeof RESULT_SCHEMA_VERSION;
  readonly workType: "implementation" | "test";
  readonly targetResultId: WakeflowDurableId<"target-result">;
  readonly programId: WakeflowDurableId<"program">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly targetDeliveryId: WakeflowDurableId<"target-delivery">;
  readonly taskPackage: Readonly<{
    readonly taskPackageId: WakeflowDurableId<"task-package">;
    readonly ref: PortableResourcePath;
    readonly digest: Sha256Digest;
  }>;
  readonly hostEffect: Readonly<{
    readonly actionId: WindowWorkClaimId;
    readonly claimDigest: Sha256Digest;
    readonly claimEventId: WakeflowDurableId<"demand-event">;
    readonly claimCommitId: WakeflowDurableId<"demand-event-commit">;
    readonly observationDigest: Sha256Digest;
    readonly disposition: "accepted" | "indeterminate";
    readonly readbackStatus: TargetDeliveryHostEffectObservation["readback"]["status"];
    readonly observedEventId: WakeflowDurableId<"demand-event">;
    readonly observedAt: UtcInstant;
  }>;
  readonly resultDigest: Sha256Digest;
}

export interface ImplementationTargetResult extends TargetResultBase {
  readonly workType: "implementation";
  readonly assignment: Readonly<{
    readonly repositoryId: WakeflowDurableId<"repository">;
    readonly windowId: WakeflowDurableId<"window">;
  }>;
  readonly testExecution?: never;
  readonly report: Readonly<ImplementationTargetResultReport>;
}

export interface TestTargetResult extends TargetResultBase {
  readonly workType: "test";
  readonly assignment: Readonly<{
    readonly windowId: WakeflowDurableId<"window">;
  }>;
  readonly testExecution: Readonly<{
    readonly testAttemptId: WakeflowDurableId<"test-attempt">;
    readonly testCard: Readonly<{
      readonly testCardId: WakeflowDurableId<"test-card">;
      readonly testCardDigest: Sha256Digest;
    }>;
    readonly testDispatchPacketDigest: Sha256Digest;
  }>;
  readonly report: Readonly<TestTargetResultReport>;
}

export type TargetResult = ImplementationTargetResult | TestTargetResult;

export type TargetResultErrorReason =
  | "json"
  | "schema"
  | "identifier"
  | "digest"
  | "path"
  | "time"
  | "claim"
  | "report"
  | "relation"
  | "representation";

const ERROR_MESSAGES = {
  json: "Target Result is not passive JSON data.",
  schema: "Target Result does not satisfy its Schema.",
  identifier: "Target Result contains an invalid identity.",
  digest: "Target Result contains an invalid or inconsistent digest.",
  path: "Target Result contains an invalid portable resource path.",
  time: "Target Result contains an invalid time.",
  claim: "Target Result requires a valid WindowWorkClaim.",
  report: "Target Result requires a matching implementation or Test Report.",
  relation: "Target Result sources are inconsistent.",
  representation: "Target Result bytes are not deterministic.",
} as const satisfies Readonly<Record<TargetResultErrorReason, string>>;

export class TargetResultError extends Error {
  override readonly name = "TargetResultError";
  readonly code = "wakeflow-target-result" as const;
  readonly reason: TargetResultErrorReason;
  readonly path: string;

  constructor(reason: TargetResultErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWire = createRuntimeJsonSchemaValidator<ResultWire>(
  WAKEFLOW_TARGET_RESULT_SCHEMA,
  [
    WAKEFLOW_GIT_OBJECT_ID_SCHEMA,
    WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_IMPLEMENTATION_TARGET_RESULT_REPORT_SCHEMA,
    WAKEFLOW_TEST_TARGET_RESULT_REPORT_SCHEMA,
    WAKEFLOW_TASK_PACKAGE_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
    WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA,
  ],
);

function fail(reason: TargetResultErrorReason, path: string): never {
  throw new TargetResultError(reason, path);
}

function id<
  Kind extends
    | "target-result"
    | "program"
    | "demand"
    | "target-task"
    | "target-delivery"
    | "task-package"
    | "repository"
    | "window"
    | "test-attempt"
    | "test-card"
    | "demand-event"
    | "demand-event-commit",
>(value: unknown, kind: Kind, path: string): WakeflowDurableId<Kind> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path);
    throw error;
  }
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

function actionId(value: unknown, path: string): WindowWorkClaimId {
  try {
    return parseWindowWorkClaimId(value, path);
  } catch (error: unknown) {
    if (error instanceof WindowWorkClaimError) fail("identifier", path);
    throw error;
  }
}

export type TargetResultBasis =
  | Omit<ImplementationTargetResult, "resultDigest">
  | Omit<TestTargetResult, "resultDigest">;

function resultBasis(
  value: Readonly<TargetResultBasis>,
): Readonly<TargetResultBasis> {
  return value.workType === "test"
    ? Object.freeze({
        kind: RESULT_KIND,
        schemaVersion: RESULT_SCHEMA_VERSION,
        workType: "test" as const,
        targetResultId: value.targetResultId,
        programId: value.programId,
        demandId: value.demandId,
        targetTaskId: value.targetTaskId,
        targetDeliveryId: value.targetDeliveryId,
        taskPackage: value.taskPackage,
        assignment: value.assignment,
        hostEffect: value.hostEffect,
        testExecution: value.testExecution,
        report: value.report,
      })
    : Object.freeze({
        kind: RESULT_KIND,
        schemaVersion: RESULT_SCHEMA_VERSION,
        workType: "implementation" as const,
        targetResultId: value.targetResultId,
        programId: value.programId,
        demandId: value.demandId,
        targetTaskId: value.targetTaskId,
        targetDeliveryId: value.targetDeliveryId,
        taskPackage: value.taskPackage,
        assignment: value.assignment,
        hostEffect: value.hostEffect,
        report: value.report,
      });
}

export function parseTargetResult(value: unknown): Readonly<TargetResult> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$result");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    throw error;
  }
  const validated = validateWire(json);
  if (!validated.ok) fail("schema", validated.path);
  const wire = validated.value;
  const common = {
    kind: RESULT_KIND,
    schemaVersion: RESULT_SCHEMA_VERSION,
    workType: wire.workType,
    targetResultId: id(
      wire.targetResultId,
      "target-result",
      "$/targetResultId",
    ),
    programId: id(wire.programId, "program", "$/programId"),
    demandId: id(wire.demandId, "demand", "$/demandId"),
    targetTaskId: id(wire.targetTaskId, "target-task", "$/targetTaskId"),
    targetDeliveryId: id(
      wire.targetDeliveryId,
      "target-delivery",
      "$/targetDeliveryId",
    ),
    taskPackage: Object.freeze({
      taskPackageId: id(
        wire.taskPackage.taskPackageId,
        "task-package",
        "$/taskPackage/taskPackageId",
      ),
      ref: resourcePath(wire.taskPackage.ref, "$/taskPackage/ref"),
      digest: digest(wire.taskPackage.digest, "$/taskPackage/digest"),
    }),
    hostEffect: Object.freeze({
      actionId: actionId(wire.hostEffect.actionId, "$/hostEffect/actionId"),
      claimDigest: digest(
        wire.hostEffect.claimDigest,
        "$/hostEffect/claimDigest",
      ),
      claimEventId: id(
        wire.hostEffect.claimEventId,
        "demand-event",
        "$/hostEffect/claimEventId",
      ),
      claimCommitId: id(
        wire.hostEffect.claimCommitId,
        "demand-event-commit",
        "$/hostEffect/claimCommitId",
      ),
      observationDigest: digest(
        wire.hostEffect.observationDigest,
        "$/hostEffect/observationDigest",
      ),
      disposition: wire.hostEffect.disposition,
      readbackStatus: wire.hostEffect.readbackStatus,
      observedEventId: id(
        wire.hostEffect.observedEventId,
        "demand-event",
        "$/hostEffect/observedEventId",
      ),
      observedAt: instant(
        wire.hostEffect.observedAt,
        "$/hostEffect/observedAt",
      ),
    }),
  } as const;
  let basis: Readonly<TargetResultBasis>;
  if (wire.workType === "implementation") {
    let report: Readonly<ImplementationTargetResultReport>;
    try {
      report = parseImplementationTargetResultReport(wire.report);
    } catch (error: unknown) {
      if (error instanceof ImplementationTargetResultReportError) {
        fail("report", "$/report");
      }
      throw error;
    }
    if (!("repositoryId" in wire.assignment)) {
      fail("schema", "$/assignment/repositoryId");
    }
    basis = resultBasis({
      ...common,
      workType: "implementation",
      assignment: Object.freeze({
        repositoryId: id(
          wire.assignment.repositoryId,
          "repository",
          "$/assignment/repositoryId",
        ),
        windowId: id(
          wire.assignment.windowId,
          "window",
          "$/assignment/windowId",
        ),
      }),
      report,
    });
  } else {
    let report: Readonly<TestTargetResultReport>;
    try {
      report = parseTestTargetResultReport(wire.report);
    } catch (error: unknown) {
      if (error instanceof TestTargetResultReportError) {
        fail("report", "$/report");
      }
      throw error;
    }
    if (wire.testExecution === undefined) {
      fail("schema", "$/testExecution");
    }
    basis = resultBasis({
      ...common,
      workType: "test",
      assignment: Object.freeze({
        windowId: id(
          wire.assignment.windowId,
          "window",
          "$/assignment/windowId",
        ),
      }),
      testExecution: Object.freeze({
        testAttemptId: id(
          wire.testExecution.testAttemptId,
          "test-attempt",
          "$/testExecution/testAttemptId",
        ),
        testCard: Object.freeze({
          testCardId: id(
            wire.testExecution.testCard.testCardId,
            "test-card",
            "$/testExecution/testCard/testCardId",
          ),
          testCardDigest: digest(
            wire.testExecution.testCard.testCardDigest,
            "$/testExecution/testCard/testCardDigest",
          ),
        }),
        testDispatchPacketDigest: digest(
          wire.testExecution.testDispatchPacketDigest,
          "$/testExecution/testDispatchPacketDigest",
        ),
      }),
      report,
    });
  }
  if (
    targetResultIdForAction(basis.hostEffect.actionId) !==
      basis.targetResultId ||
    targetDeliveryHostEffectObservationEventId(basis.hostEffect.actionId) !==
      basis.hostEffect.observedEventId
  ) {
    fail("relation", "$result");
  }
  // reportedAt 是Report来源时钟给出的审计事实；Result与Host Effect的因果关系
  // 由exact identity、Observation摘要、Event引用和Aggregate CAS闭合，不由墙钟排序推断。
  const resultDigest = digest(wire.resultDigest, "$/resultDigest");
  if (computeCanonicalJsonSha256Digest(basis) !== resultDigest) {
    fail("digest", "$/resultDigest");
  }
  return Object.freeze({ ...basis, resultDigest });
}

function uuidFrom(value: string, prefix: string) {
  return parseUuidV4(value.slice(prefix.length));
}

export function targetResultIdForAction(
  actionIdValue: unknown,
): WakeflowDurableId<"target-result"> {
  const admitted = actionId(actionIdValue, "$actionId");
  return createWakeflowDurableId(
    "target-result",
    uuidFrom(admitted, CLAIM_ID_PREFIX),
  );
}

export function targetResultRecordedEventId(
  claimValue: unknown,
): WakeflowDurableId<"demand-event"> {
  let claim: Readonly<WindowWorkClaim>;
  try {
    claim = parseWindowWorkClaim(claimValue);
  } catch (error: unknown) {
    if (error instanceof WindowWorkClaimError) fail("claim", "$claim");
    throw error;
  }
  return createWakeflowDurableId(
    "demand-event",
    uuidFrom(claim.claimTransition.commitId, COMMIT_ID_PREFIX),
  );
}

export function targetResultRecordedEventIdFromResult(
  resultValue: unknown,
): WakeflowDurableId<"demand-event"> {
  const result = parseTargetResult(resultValue);
  return createWakeflowDurableId(
    "demand-event",
    uuidFrom(result.hostEffect.claimCommitId, COMMIT_ID_PREFIX),
  );
}

export function targetResultRecordedCommitId(
  claimValue: unknown,
): WakeflowDurableId<"demand-event-commit"> {
  let claim: Readonly<WindowWorkClaim>;
  try {
    claim = parseWindowWorkClaim(claimValue);
  } catch (error: unknown) {
    if (error instanceof WindowWorkClaimError) fail("claim", "$claim");
    throw error;
  }
  return createWakeflowDurableId(
    "demand-event-commit",
    uuidFrom(claim.claimTransition.eventId, EVENT_ID_PREFIX),
  );
}

export function targetResultRecordedCommitIdFromResult(
  resultValue: unknown,
): WakeflowDurableId<"demand-event-commit"> {
  const result = parseTargetResult(resultValue);
  return createWakeflowDurableId(
    "demand-event-commit",
    uuidFrom(result.hostEffect.claimEventId, EVENT_ID_PREFIX),
  );
}

export function renderTargetResult(value: unknown): string {
  return renderDeterministicJsonDocument(parseTargetResult(value), "$result");
}

export function parseTargetResultDocument(
  textValue: unknown,
): Readonly<TargetResult> {
  let json: JsonValue;
  try {
    json = parseDeterministicJsonDocument(textValue, "$result");
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      fail("representation", "$result");
    }
    throw error;
  }
  const result = parseTargetResult(json);
  if (renderTargetResult(result) !== textValue) {
    fail("representation", "$result");
  }
  return result;
}

export function targetResultOutcome(value: unknown): TargetResultOutcome {
  return parseTargetResult(value).report.outcome;
}
