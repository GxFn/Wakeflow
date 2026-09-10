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
import { deriveDurableId } from "../../kernel/ids.js";
import { derivedIdFromWorkClaim } from "../../kernel/work-claims.js";
import type { DeliveryReadbackStatus } from "../delivery/delivery-outcome.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import {
  parseUtcInstant,
  UtcInstantError,
  type UtcInstant,
} from "../../foundation/time/utc-instant.js";
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

export interface TargetResultDeliveryBinding {
  readonly generation: number;
  readonly fence: Readonly<{
    readonly claimId: WakeflowDurableId<"work-claim">;
    readonly claimDigest: Sha256Digest;
  }>;
  readonly outcomeDigest: Sha256Digest;
  readonly disposition: "accepted" | "indeterminate";
  readonly readbackStatus: DeliveryReadbackStatus;
  readonly observedAt: UtcInstant;
}

interface TargetResultBase {
  readonly kind: typeof RESULT_KIND;
  readonly schemaVersion: typeof RESULT_SCHEMA_VERSION;
  readonly workType: "implementation" | "test";
  readonly targetResultId: WakeflowDurableId<"target-result">;
  readonly programId: WakeflowDurableId<"program">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly deliveryId: WakeflowDurableId<"target-delivery">;
  readonly taskPackage: Readonly<{
    readonly taskPackageId: WakeflowDurableId<"task-package">;
    readonly ref: PortableResourcePath;
    readonly digest: Sha256Digest;
  }>;
  /** 结果绑定的投递代际与围栏：导入必须带回信封里的同一令牌。 */
  readonly delivery: Readonly<TargetResultDeliveryBinding>;
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
    readonly ordinal: number;
    /** 本次尝试的范围：null 为全部合同步骤，重跑可只跑失败子集（ADR-0012 D4）。 */
    readonly stepIds: readonly string[] | null;
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
  claim: "Target Result requires a valid delivery fence claim.",
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
    | "work-claim",
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
        deliveryId: value.deliveryId,
        taskPackage: value.taskPackage,
        assignment: value.assignment,
        delivery: value.delivery,
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
        deliveryId: value.deliveryId,
        taskPackage: value.taskPackage,
        assignment: value.assignment,
        delivery: value.delivery,
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
    deliveryId: id(wire.deliveryId, "target-delivery", "$/deliveryId"),
    taskPackage: Object.freeze({
      taskPackageId: id(
        wire.taskPackage.taskPackageId,
        "task-package",
        "$/taskPackage/taskPackageId",
      ),
      ref: resourcePath(wire.taskPackage.ref, "$/taskPackage/ref"),
      digest: digest(wire.taskPackage.digest, "$/taskPackage/digest"),
    }),
    delivery: Object.freeze({
      generation: wire.delivery.generation,
      fence: Object.freeze({
        claimId: id(wire.delivery.fence.claimId, "work-claim", "$/delivery/fence/claimId"),
        claimDigest: digest(wire.delivery.fence.claimDigest, "$/delivery/fence/claimDigest"),
      }),
      outcomeDigest: digest(wire.delivery.outcomeDigest, "$/delivery/outcomeDigest"),
      disposition: wire.delivery.disposition,
      readbackStatus: wire.delivery.readbackStatus,
      observedAt: instant(wire.delivery.observedAt, "$/delivery/observedAt"),
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
        ordinal: wire.testExecution.ordinal,
        stepIds:
          wire.testExecution.stepIds === null
            ? null
            : Object.freeze([...wire.testExecution.stepIds]),
      }),
      report,
    });
  }
  if (targetResultIdForClaim(basis.delivery.fence.claimId) !== basis.targetResultId) {
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

/** 结果身份由围栏声明的 UUID 派生：一个声明代际至多一份结果。 */
export function targetResultIdForClaim(
  claimId: WakeflowDurableId<"work-claim">,
): WakeflowDurableId<"target-result"> {
  return derivedIdFromWorkClaim("target-result", claimId);
}

/** 结果事件与提交的身份由同一声明派生，重放自然命中同一提交。 */
export function targetResultRecordedEventIdFromResult(
  resultValue: unknown,
): WakeflowDurableId<"demand-event"> {
  const result = parseTargetResult(resultValue);
  return deriveDurableId("demand-event", "target-result", result.delivery.fence.claimId);
}

export function targetResultRecordedCommitIdFromResult(
  resultValue: unknown,
): WakeflowDurableId<"demand-event-commit"> {
  const result = parseTargetResult(resultValue);
  return deriveDurableId("demand-event-commit", "target-result", result.delivery.fence.claimId);
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
