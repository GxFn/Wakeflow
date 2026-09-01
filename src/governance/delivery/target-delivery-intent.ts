import {
  WAKEFLOW_PRESENTATION_LANGUAGES,
  type WakeflowPresentationLanguage,
} from "../../configuration/wakeflow-config-v3.js";
import type { WakeflowTargetDeliveryIntent as TargetDeliveryIntentWire } from "../../contracts/generated/governance/delivery/target-delivery-intent.generated.js";
import { WAKEFLOW_TARGET_DELIVERY_INTENT_SCHEMA } from "../../contracts/generated/governance/delivery/target-delivery-intent.generated.js";
import { WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA } from "../../contracts/generated/governance/ledger/ledger-authority-member-reference.generated.js";
import { WAKEFLOW_TASK_PACKAGE_SCHEMA } from "../../contracts/generated/governance/tasking/task-package.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
import { WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA } from "../../contracts/generated/workspace/window-host-binding.generated.js";
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
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import {
  parseDenseArray,
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import {
  parseUtcInstant,
  UtcInstantError,
  type UtcInstant,
} from "../../foundation/time/utc-instant.js";
import {
  readUtcWallClock,
  UtcWallClockError,
  type UtcWallClock,
} from "../../foundation/time/wall-clock.js";
import type { WakeflowWorkspaceHostId } from "../../workspace/workspace-host-resource-profile.js";
import { WAKEFLOW_WORKSPACE_HOST_IDS } from "../../workspace/workspace-host-resource-profile.js";
import {
  parseWakeflowWindowHostBindingId,
  WakeflowWindowHostBindingIdError,
  type WakeflowWindowHostBindingId,
} from "../../workspace/window-runtime/wakeflow-window-host-binding-id.js";
import { demandFinalRootRef } from "../demand/publication/demand-publication-paths.js";
import {
  computeTaskPackageDigest,
  parseTaskPackage,
  TaskPackageError,
  type TaskPackage,
} from "../tasking/task-package.js";
import {
  taskPackageProjectionRef,
  TaskPackageProjectionPathError,
} from "../tasking/task-package-projection-paths.js";

/**
 * Wakeflow Governance / Delivery：一个Target Task执行尝试的不可变发送准备意图。
 *
 * Intent冻结TaskPackage入口、当前Binding代际与可移植prompt核心，但不取得
 * WindowWorkClaim、不包含raw handle或absolute root，也不执行或记录宿主发送。返工尝试
 * 额外绑定上一次Decision/Result及有界修正摘要；完整任务
 * 上下文继续由 TaskPackage 拥有；后续目标投递宿主动作才把同一 workspace root 瞬时加入真实
 * 宿主prompt。Intent不会复制旧Dispatch Group、Packet或Envelope的多层字段。
 */

export interface TargetDeliveryIntent {
  readonly kind: "WakeflowTargetDeliveryIntent";
  readonly schemaVersion: 1;
  readonly targetDeliveryId: WakeflowDurableId<"target-delivery">;
  readonly programId: WakeflowDurableId<"program">;
  readonly configDigest: Sha256Digest;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly target: Readonly<{
    readonly targetTaskId: WakeflowDurableId<"target-task">;
    readonly taskPackageId: WakeflowDurableId<"task-package">;
    readonly taskPackageRef: PortableResourcePath;
    readonly taskPackageDigest: Sha256Digest;
  }>;
  readonly route: Readonly<{
    readonly hostId: WakeflowWorkspaceHostId;
    readonly windowId: WakeflowDurableId<"window">;
    readonly bindingId: WakeflowWindowHostBindingId;
  }>;
  readonly language: WakeflowPresentationLanguage;
  readonly portablePrompt: string;
  /** 仅后续返工尝试存在；初次投递必须省略该字段。 */
  readonly rework?: Readonly<TargetDeliveryReworkContext>;
  /** 仅Test产品缺陷修复存在；与`rework`互斥。 */
  readonly productDefectRemediation?: Readonly<TargetDeliveryProductDefectRemediationContext>;
  readonly preparedAt: UtcInstant;
  readonly intentDigest: Sha256Digest;
}

export interface TargetDeliveryRequiredCorrection {
  readonly checkId: string;
  readonly outcome: "failed" | "inconclusive";
  readonly methodSummary: string;
  readonly observationSummary: string;
}

/**
 * 后续投递需要的最小返工上下文。
 *
 * 完整Decision与TargetResult继续留在Demand事件历史中；本投影只携带精确来源身份和
 * 有界执行摘要，避免把整个Review记录复制进投递消息。
 */
export interface TargetDeliveryReworkContext {
  readonly decision: Readonly<{
    readonly targetReviewDecisionId: WakeflowDurableId<"target-review-decision">;
    readonly decisionDigest: Sha256Digest;
  }>;
  readonly previousResult: Readonly<{
    readonly targetResultId: WakeflowDurableId<"target-result">;
    readonly resultDigest: Sha256Digest;
  }>;
  readonly rationaleSummary: string;
  readonly requiredCorrections: readonly [
    Readonly<TargetDeliveryRequiredCorrection>,
    ...Readonly<TargetDeliveryRequiredCorrection>[],
  ];
}

export interface ProjectTargetDeliveryReworkContextInput {
  readonly decision: TargetDeliveryReworkContext["decision"];
  readonly previousResult: TargetDeliveryReworkContext["previousResult"];
  readonly rationale: string;
  readonly requiredCorrections: readonly Readonly<{
    readonly checkId: string;
    readonly outcome: TargetDeliveryRequiredCorrection["outcome"];
    readonly method: string;
    readonly observation: string;
  }>[];
}

export interface TargetDeliveryProductDefectRemediationContext {
  readonly authorization: Readonly<{
    readonly productDefectRemediationId: WakeflowDurableId<"product-defect-remediation">;
    readonly authorizationDigest: Sha256Digest;
  }>;
  readonly testReviewDecision: Readonly<{
    readonly targetReviewDecisionId: WakeflowDurableId<"target-review-decision">;
    readonly decisionDigest: Sha256Digest;
  }>;
  readonly previousResult: Readonly<{
    readonly targetResultId: WakeflowDurableId<"target-result">;
    readonly resultDigest: Sha256Digest;
  }>;
  readonly authorizationRationaleSummary: string;
  readonly correctionObjectiveSummary: string;
  readonly requiredCorrections: readonly [
    Readonly<TargetDeliveryRequiredCorrection & { readonly outcome: "failed" }>,
    ...Readonly<
      TargetDeliveryRequiredCorrection & {
        readonly outcome: "failed";
      }
    >[],
  ];
}

export interface ProjectTargetDeliveryProductDefectRemediationContextInput {
  readonly authorization: TargetDeliveryProductDefectRemediationContext["authorization"];
  readonly testReviewDecision: TargetDeliveryProductDefectRemediationContext["testReviewDecision"];
  readonly previousResult: TargetDeliveryProductDefectRemediationContext["previousResult"];
  readonly authorizationRationale: string;
  readonly correctionObjective: string;
  readonly requiredCorrections: readonly Readonly<{
    readonly checkId: string;
    readonly outcome: "failed";
    readonly method: string;
    readonly observation: string;
  }>[];
}

export type TargetDeliveryPurpose =
  "initial" | "implementation-review-rework" | "product-defect-remediation";

export interface CreateTargetDeliveryIntentInput {
  readonly targetDeliveryId: WakeflowDurableId<"target-delivery">;
  readonly taskPackage: TaskPackage;
  readonly hostId: WakeflowWorkspaceHostId;
  readonly bindingId: WakeflowWindowHostBindingId;
  readonly language: WakeflowPresentationLanguage;
  readonly rework?: Readonly<TargetDeliveryReworkContext>;
  readonly productDefectRemediation?: Readonly<TargetDeliveryProductDefectRemediationContext>;
}

export interface CreateTargetDeliveryIntentOptions {
  readonly clock?: UtcWallClock;
}

export type TargetDeliveryIntentErrorReason =
  | "json"
  | "schema"
  | "identifier"
  | "digest"
  | "path"
  | "host"
  | "language"
  | "prompt"
  | "rework"
  | "product-defect-remediation"
  | "time"
  | "task-package"
  | "relation";

const ERROR_MESSAGES = {
  json: "Target Delivery Intent is not passive JSON data.",
  schema: "Target Delivery Intent does not satisfy its portable Schema.",
  identifier: "Target Delivery Intent contains an invalid typed identity.",
  digest: "Target Delivery Intent contains an invalid or inconsistent digest.",
  path: "Target Delivery Intent contains an invalid TaskPackage reference.",
  host: "Target Delivery Intent contains an unsupported host.",
  language:
    "Target Delivery Intent contains an unsupported presentation language.",
  prompt:
    "Target Delivery Intent portable prompt is invalid or not derived from its TaskPackage.",
  rework: "Target Delivery Intent rework context is invalid or inconsistent.",
  "product-defect-remediation":
    "Target Delivery Intent product-defect remediation context is invalid or inconsistent.",
  time: "Target Delivery Intent contains an invalid preparation time.",
  "task-package": "Target Delivery Intent source TaskPackage is invalid.",
  relation: "Target Delivery Intent does not match its TaskPackage or route.",
} as const satisfies Readonly<Record<TargetDeliveryIntentErrorReason, string>>;

/** Target Delivery Intent 准入、创建或来源闭合失败时的稳定错误。 */
export class TargetDeliveryIntentError extends Error {
  override readonly name = "TargetDeliveryIntentError";
  readonly code = "wakeflow-target-delivery-intent" as const;
  readonly reason: TargetDeliveryIntentErrorReason;
  readonly path: string;

  constructor(reason: TargetDeliveryIntentErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const MAXIMUM_PROMPT_BYTES = 64 * 1024;
const MAXIMUM_PROMPT_OBJECTIVE_CODE_POINTS = 2_048;
const MAXIMUM_REWORK_RATIONALE_CODE_POINTS = 1_024;
const MAXIMUM_REWORK_METHOD_CODE_POINTS = 128;
const MAXIMUM_REWORK_OBSERVATION_CODE_POINTS = 256;
const REWORK_CHECK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const CONTROL_EXCEPT_LF_PATTERN =
  /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;
const HOST_IDS = new Set<string>(WAKEFLOW_WORKSPACE_HOST_IDS);
const LANGUAGES = new Set<string>(WAKEFLOW_PRESENTATION_LANGUAGES);
const validateWire = createRuntimeJsonSchemaValidator<TargetDeliveryIntentWire>(
  WAKEFLOW_TARGET_DELIVERY_INTENT_SCHEMA,
  [
    WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_TASK_PACKAGE_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
    WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA,
  ],
);

function fail(reason: TargetDeliveryIntentErrorReason, path: string): never {
  throw new TargetDeliveryIntentError(reason, path);
}

function parseId<
  Kind extends
    | "program"
    | "demand"
    | "target-delivery"
    | "target-task"
    | "task-package"
    | "target-result"
    | "target-review-decision"
    | "product-defect-remediation"
    | "window",
>(value: unknown, kind: Kind, path: string): WakeflowDurableId<Kind> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path);
    throw error;
  }
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
    if (error instanceof PassiveOwnDataError) fail("rework", path);
    throw error;
  }
  const keys = Object.keys(record).sort();
  const expected = [...fields].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    fail("rework", path);
  }
  return record;
}

function reworkText(
  value: unknown,
  maximumCodePoints: number,
  path: string,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    !value.isWellFormed() ||
    CONTROL_EXCEPT_LF_PATTERN.test(value) ||
    Array.from(value).length > maximumCodePoints
  ) {
    fail("rework", path);
  }
  return value;
}

function reworkCheckId(value: unknown, path: string): string {
  if (typeof value !== "string" || !REWORK_CHECK_ID_PATTERN.test(value)) {
    fail("rework", path);
  }
  return value;
}

/** 严格解析一份有界返工投影，不读取完整Decision或TargetResult。 */
export function parseTargetDeliveryReworkContext(
  value: unknown,
  path = "$rework",
): Readonly<TargetDeliveryReworkContext> {
  const record = exactRecord(
    value,
    ["decision", "previousResult", "rationaleSummary", "requiredCorrections"],
    path,
  );
  const decision = exactRecord(
    record.decision,
    ["targetReviewDecisionId", "decisionDigest"],
    `${path}/decision`,
  );
  const previousResult = exactRecord(
    record.previousResult,
    ["targetResultId", "resultDigest"],
    `${path}/previousResult`,
  );
  let correctionValues: readonly unknown[];
  try {
    correctionValues = parseDenseArray(
      record.requiredCorrections,
      32,
      `${path}/requiredCorrections`,
    );
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      fail("rework", `${path}/requiredCorrections`);
    }
    throw error;
  }
  if (correctionValues.length === 0) {
    fail("rework", `${path}/requiredCorrections`);
  }
  const corrections = correctionValues.map((value, index) => {
    const correctionPath = `${path}/requiredCorrections/${index}`;
    const correction = exactRecord(
      value,
      ["checkId", "outcome", "methodSummary", "observationSummary"],
      correctionPath,
    );
    if (
      correction.outcome !== "failed" &&
      correction.outcome !== "inconclusive"
    ) {
      fail("rework", `${correctionPath}/outcome`);
    }
    return Object.freeze({
      checkId: reworkCheckId(correction.checkId, `${correctionPath}/checkId`),
      outcome: correction.outcome,
      methodSummary: reworkText(
        correction.methodSummary,
        MAXIMUM_REWORK_METHOD_CODE_POINTS,
        `${correctionPath}/methodSummary`,
      ),
      observationSummary: reworkText(
        correction.observationSummary,
        MAXIMUM_REWORK_OBSERVATION_CODE_POINTS,
        `${correctionPath}/observationSummary`,
      ),
    });
  });
  if (
    new Set(corrections.map((correction) => correction.checkId)).size !==
      corrections.length ||
    !corrections.some((correction) => correction.outcome === "failed")
  ) {
    fail("rework", `${path}/requiredCorrections`);
  }
  const first = corrections[0];
  if (first === undefined) fail("rework", `${path}/requiredCorrections`);
  const requiredCorrections: TargetDeliveryReworkContext["requiredCorrections"] =
    Object.freeze([first, ...corrections.slice(1)]);
  return Object.freeze({
    decision: Object.freeze({
      targetReviewDecisionId: parseId(
        decision.targetReviewDecisionId,
        "target-review-decision",
        `${path}/decision/targetReviewDecisionId`,
      ),
      decisionDigest: digest(
        decision.decisionDigest,
        `${path}/decision/decisionDigest`,
      ),
    }),
    previousResult: Object.freeze({
      targetResultId: parseId(
        previousResult.targetResultId,
        "target-result",
        `${path}/previousResult/targetResultId`,
      ),
      resultDigest: digest(
        previousResult.resultDigest,
        `${path}/previousResult/resultDigest`,
      ),
    }),
    rationaleSummary: reworkText(
      record.rationaleSummary,
      MAXIMUM_REWORK_RATIONALE_CODE_POINTS,
      `${path}/rationaleSummary`,
    ),
    requiredCorrections,
  });
}

function summarizeReworkText(
  value: unknown,
  maximumCodePoints: number,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    !value.isWellFormed() ||
    CONTROL_EXCEPT_LF_PATTERN.test(value)
  ) {
    fail("rework", "$reworkSource");
  }
  const codePoints = Array.from(value);
  return codePoints.length <= maximumCodePoints
    ? value
    : `${codePoints.slice(0, maximumCodePoints - 1).join("")}…`;
}

/** 把完整Review文本确定性压缩成可进入投递Intent的有界执行投影。 */
export function projectTargetDeliveryReworkContext(
  input: Readonly<ProjectTargetDeliveryReworkContextInput>,
): Readonly<TargetDeliveryReworkContext> {
  return parseTargetDeliveryReworkContext({
    decision: input.decision,
    previousResult: input.previousResult,
    rationaleSummary: summarizeReworkText(
      input.rationale,
      MAXIMUM_REWORK_RATIONALE_CODE_POINTS,
    ),
    requiredCorrections: input.requiredCorrections.map((correction) => ({
      checkId: correction.checkId,
      outcome: correction.outcome,
      methodSummary: summarizeReworkText(
        correction.method,
        MAXIMUM_REWORK_METHOD_CODE_POINTS,
      ),
      observationSummary: summarizeReworkText(
        correction.observation,
        MAXIMUM_REWORK_OBSERVATION_CODE_POINTS,
      ),
    })),
  });
}

function remediationRecord(
  value: unknown,
  fields: readonly string[],
  path: string,
): Readonly<Record<string, unknown>> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      fail("product-defect-remediation", path);
    }
    throw error;
  }
  const keys = Object.keys(record).sort();
  const expected = [...fields].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    fail("product-defect-remediation", path);
  }
  return record;
}

function remediationText(
  value: unknown,
  maximumCodePoints: number,
  path: string,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    !value.isWellFormed() ||
    value.normalize("NFC") !== value ||
    CONTROL_EXCEPT_LF_PATTERN.test(value) ||
    Array.from(value).length > maximumCodePoints
  ) {
    fail("product-defect-remediation", path);
  }
  return value;
}

function remediationCheckId(value: unknown, path: string): string {
  if (typeof value !== "string" || !REWORK_CHECK_ID_PATTERN.test(value)) {
    fail("product-defect-remediation", path);
  }
  return value;
}

/** 严格解析一份有界产品缺陷修复投影，不读取完整Authorization。 */
export function parseTargetDeliveryProductDefectRemediationContext(
  value: unknown,
  path = "$productDefectRemediation",
): Readonly<TargetDeliveryProductDefectRemediationContext> {
  const record = remediationRecord(
    value,
    [
      "authorization",
      "testReviewDecision",
      "previousResult",
      "authorizationRationaleSummary",
      "correctionObjectiveSummary",
      "requiredCorrections",
    ],
    path,
  );
  const authorization = remediationRecord(
    record.authorization,
    ["productDefectRemediationId", "authorizationDigest"],
    `${path}/authorization`,
  );
  const testReviewDecision = remediationRecord(
    record.testReviewDecision,
    ["targetReviewDecisionId", "decisionDigest"],
    `${path}/testReviewDecision`,
  );
  const previousResult = remediationRecord(
    record.previousResult,
    ["targetResultId", "resultDigest"],
    `${path}/previousResult`,
  );
  let correctionValues: readonly unknown[];
  try {
    correctionValues = parseDenseArray(
      record.requiredCorrections,
      32,
      `${path}/requiredCorrections`,
    );
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      fail("product-defect-remediation", `${path}/requiredCorrections`);
    }
    throw error;
  }
  if (correctionValues.length === 0) {
    fail("product-defect-remediation", `${path}/requiredCorrections`);
  }
  const corrections = correctionValues.map((value, index) => {
    const correctionPath = `${path}/requiredCorrections/${index}`;
    const correction = remediationRecord(
      value,
      ["checkId", "outcome", "methodSummary", "observationSummary"],
      correctionPath,
    );
    if (correction.outcome !== "failed") {
      fail("product-defect-remediation", `${correctionPath}/outcome`);
    }
    return Object.freeze({
      checkId: remediationCheckId(
        correction.checkId,
        `${correctionPath}/checkId`,
      ),
      outcome: "failed" as const,
      methodSummary: remediationText(
        correction.methodSummary,
        MAXIMUM_REWORK_METHOD_CODE_POINTS,
        `${correctionPath}/methodSummary`,
      ),
      observationSummary: remediationText(
        correction.observationSummary,
        MAXIMUM_REWORK_OBSERVATION_CODE_POINTS,
        `${correctionPath}/observationSummary`,
      ),
    });
  });
  if (
    new Set(corrections.map((correction) => correction.checkId)).size !==
    corrections.length
  ) {
    fail("product-defect-remediation", `${path}/requiredCorrections`);
  }
  const first = corrections[0];
  if (first === undefined) {
    fail("product-defect-remediation", `${path}/requiredCorrections`);
  }
  const requiredCorrections: TargetDeliveryProductDefectRemediationContext["requiredCorrections"] =
    Object.freeze([first, ...corrections.slice(1)]);
  return Object.freeze({
    authorization: Object.freeze({
      productDefectRemediationId: parseId(
        authorization.productDefectRemediationId,
        "product-defect-remediation",
        `${path}/authorization/productDefectRemediationId`,
      ),
      authorizationDigest: digest(
        authorization.authorizationDigest,
        `${path}/authorization/authorizationDigest`,
      ),
    }),
    testReviewDecision: Object.freeze({
      targetReviewDecisionId: parseId(
        testReviewDecision.targetReviewDecisionId,
        "target-review-decision",
        `${path}/testReviewDecision/targetReviewDecisionId`,
      ),
      decisionDigest: digest(
        testReviewDecision.decisionDigest,
        `${path}/testReviewDecision/decisionDigest`,
      ),
    }),
    previousResult: Object.freeze({
      targetResultId: parseId(
        previousResult.targetResultId,
        "target-result",
        `${path}/previousResult/targetResultId`,
      ),
      resultDigest: digest(
        previousResult.resultDigest,
        `${path}/previousResult/resultDigest`,
      ),
    }),
    authorizationRationaleSummary: remediationText(
      record.authorizationRationaleSummary,
      MAXIMUM_REWORK_RATIONALE_CODE_POINTS,
      `${path}/authorizationRationaleSummary`,
    ),
    correctionObjectiveSummary: remediationText(
      record.correctionObjectiveSummary,
      MAXIMUM_REWORK_RATIONALE_CODE_POINTS,
      `${path}/correctionObjectiveSummary`,
    ),
    requiredCorrections,
  });
}

function summarizeRemediationText(
  value: unknown,
  maximumCodePoints: number,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    !value.isWellFormed() ||
    value.normalize("NFC") !== value ||
    CONTROL_EXCEPT_LF_PATTERN.test(value)
  ) {
    fail("product-defect-remediation", "$remediationSource");
  }
  const codePoints = Array.from(value);
  return codePoints.length <= maximumCodePoints
    ? value
    : `${codePoints.slice(0, maximumCodePoints - 1).join("")}…`;
}

/** 把完整Authorization文本确定性压缩成Target执行所需的有界投影。 */
export function projectTargetDeliveryProductDefectRemediationContext(
  input: Readonly<ProjectTargetDeliveryProductDefectRemediationContextInput>,
): Readonly<TargetDeliveryProductDefectRemediationContext> {
  return parseTargetDeliveryProductDefectRemediationContext({
    authorization: input.authorization,
    testReviewDecision: input.testReviewDecision,
    previousResult: input.previousResult,
    authorizationRationaleSummary: summarizeRemediationText(
      input.authorizationRationale,
      MAXIMUM_REWORK_RATIONALE_CODE_POINTS,
    ),
    correctionObjectiveSummary: summarizeRemediationText(
      input.correctionObjective,
      MAXIMUM_REWORK_RATIONALE_CODE_POINTS,
    ),
    requiredCorrections: input.requiredCorrections.map((correction) => ({
      checkId: correction.checkId,
      outcome: "failed",
      methodSummary: summarizeRemediationText(
        correction.method,
        MAXIMUM_REWORK_METHOD_CODE_POINTS,
      ),
      observationSummary: summarizeRemediationText(
        correction.observation,
        MAXIMUM_REWORK_OBSERVATION_CODE_POINTS,
      ),
    })),
  });
}

function digest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", path);
    throw error;
  }
}

function packageRef(
  demandId: WakeflowDurableId<"demand">,
  taskPackageId: WakeflowDurableId<"task-package">,
): PortableResourcePath {
  try {
    return parsePortableResourcePath(
      `${demandFinalRootRef(demandId)}/${taskPackageProjectionRef(taskPackageId)}`,
    );
  } catch (error: unknown) {
    if (
      error instanceof PortableResourcePathError ||
      error instanceof TaskPackageProjectionPathError
    ) {
      fail("path", "$/target/taskPackageRef");
    }
    throw error;
  }
}

function portablePromptFor(
  taskPackage: Readonly<TaskPackage>,
  language: WakeflowPresentationLanguage,
  rework: Readonly<TargetDeliveryReworkContext> | undefined,
  productDefectRemediation:
    Readonly<TargetDeliveryProductDefectRemediationContext> | undefined,
): string {
  if (rework !== undefined && productDefectRemediation !== undefined) {
    fail("relation", "$executionSources");
  }
  const ref = packageRef(taskPackage.demandId, taskPackage.taskPackageId);
  const objectiveCodePoints = Array.from(taskPackage.objective);
  const objective =
    objectiveCodePoints.length > MAXIMUM_PROMPT_OBJECTIVE_CODE_POINTS
      ? `${objectiveCodePoints
          .slice(0, MAXIMUM_PROMPT_OBJECTIVE_CODE_POINTS)
          .join("")}…`
      : taskPackage.objective;
  const initialPrompt =
    language === "zh-Hans"
      ? [
          "Wakeflow 目标任务",
          "",
          "目标：",
          objective,
          "",
          "TaskPackage：",
          ref,
          "",
          "执行合同：",
          "- 修改仓库前，先完整阅读不可变 TaskPackage。",
          "- 只执行其中已确认的范围与边界。",
          "- 为 Controller 审查保留可验证证据；投递成功不等于验收。",
        ]
      : [
          "Wakeflow Target Task",
          "",
          "Objective:",
          objective,
          "",
          "TaskPackage:",
          ref,
          "",
          "Execution contract:",
          "- Read the complete immutable TaskPackage before changing the repository.",
          "- Execute only its confirmed scope and boundaries.",
          "- Preserve verifiable evidence for Controller review; delivery is not acceptance.",
        ];
  const reworkPrompt =
    rework === undefined
      ? []
      : language === "zh-Hans"
        ? [
            "",
            "返工依据（继续执行同一 TaskPackage）：",
            `- Controller Decision：${rework.decision.targetReviewDecisionId} / ${rework.decision.decisionDigest}`,
            `- 上一次 TargetResult：${rework.previousResult.targetResultId} / ${rework.previousResult.resultDigest}`,
            `- Controller 说明：${rework.rationaleSummary}`,
            "",
            "必须修正的独立检查：",
            ...rework.requiredCorrections.flatMap((correction) => [
              `- [${correction.outcome}] ${correction.checkId}`,
              `  检查方法：${correction.methodSummary}`,
              `  已观察事实：${correction.observationSummary}`,
            ]),
          ]
        : [
            "",
            "Rework basis (continue the same TaskPackage):",
            `- Controller Decision: ${rework.decision.targetReviewDecisionId} / ${rework.decision.decisionDigest}`,
            `- Previous TargetResult: ${rework.previousResult.targetResultId} / ${rework.previousResult.resultDigest}`,
            `- Controller rationale: ${rework.rationaleSummary}`,
            "",
            "Required independent-check corrections:",
            ...rework.requiredCorrections.flatMap((correction) => [
              `- [${correction.outcome}] ${correction.checkId}`,
              `  Check method: ${correction.methodSummary}`,
              `  Observed fact: ${correction.observationSummary}`,
            ]),
          ];
  const remediationPrompt =
    productDefectRemediation === undefined
      ? []
      : language === "zh-Hans"
        ? [
            "",
            "产品缺陷修复依据（继续执行同一 TaskPackage）：",
            `- Remediation Authorization：${productDefectRemediation.authorization.productDefectRemediationId} / ${productDefectRemediation.authorization.authorizationDigest}`,
            `- Test Review Decision：${productDefectRemediation.testReviewDecision.targetReviewDecisionId} / ${productDefectRemediation.testReviewDecision.decisionDigest}`,
            `- 上一次产品 TargetResult：${productDefectRemediation.previousResult.targetResultId} / ${productDefectRemediation.previousResult.resultDigest}`,
            `- Controller 授权说明：${productDefectRemediation.authorizationRationaleSummary}`,
            `- 当前产品修复目标：${productDefectRemediation.correctionObjectiveSummary}`,
            "",
            "必须修正的产品缺陷检查：",
            ...productDefectRemediation.requiredCorrections.flatMap(
              (correction) => [
                `- [failed] ${correction.checkId}`,
                `  检查方法：${correction.methodSummary}`,
                `  已观察事实：${correction.observationSummary}`,
              ],
            ),
          ]
        : [
            "",
            "Product-defect remediation basis (continue the same TaskPackage):",
            `- Remediation Authorization: ${productDefectRemediation.authorization.productDefectRemediationId} / ${productDefectRemediation.authorization.authorizationDigest}`,
            `- Test Review Decision: ${productDefectRemediation.testReviewDecision.targetReviewDecisionId} / ${productDefectRemediation.testReviewDecision.decisionDigest}`,
            `- Previous product TargetResult: ${productDefectRemediation.previousResult.targetResultId} / ${productDefectRemediation.previousResult.resultDigest}`,
            `- Controller authorization: ${productDefectRemediation.authorizationRationaleSummary}`,
            `- Product correction objective: ${productDefectRemediation.correctionObjectiveSummary}`,
            "",
            "Required product-defect corrections:",
            ...productDefectRemediation.requiredCorrections.flatMap(
              (correction) => [
                `- [failed] ${correction.checkId}`,
                `  Check method: ${correction.methodSummary}`,
                `  Observed fact: ${correction.observationSummary}`,
              ],
            ),
          ];
  const portablePrompt = [
    ...initialPrompt,
    ...reworkPrompt,
    ...remediationPrompt,
  ].join("\n");
  if (
    encodeUtf8(portablePrompt, "$portablePrompt").byteLength >
    MAXIMUM_PROMPT_BYTES
  ) {
    fail("prompt", "$/portablePrompt");
  }
  return portablePrompt;
}

/** 从完整TaskPackage、可选返工投影和用户语言确定性渲染轻量prompt核心。 */
export function renderTargetDeliveryPortablePrompt(
  taskPackageValue: unknown,
  languageValue: unknown,
  reworkValue?: unknown,
  productDefectRemediationValue?: unknown,
): string {
  let taskPackage: Readonly<TaskPackage>;
  try {
    taskPackage = parseTaskPackage(taskPackageValue);
  } catch (error: unknown) {
    if (error instanceof TaskPackageError) fail("task-package", "$taskPackage");
    throw error;
  }
  if (typeof languageValue !== "string" || !LANGUAGES.has(languageValue)) {
    fail("language", "$language");
  }
  const rework =
    reworkValue === undefined
      ? undefined
      : parseTargetDeliveryReworkContext(reworkValue);
  const productDefectRemediation =
    productDefectRemediationValue === undefined
      ? undefined
      : parseTargetDeliveryProductDefectRemediationContext(
          productDefectRemediationValue,
        );
  return portablePromptFor(
    taskPackage,
    languageValue as WakeflowPresentationLanguage,
    rework,
    productDefectRemediation,
  );
}

function intentBasis(
  value: Omit<TargetDeliveryIntent, "intentDigest">,
): Omit<TargetDeliveryIntent, "intentDigest"> {
  return {
    kind: "WakeflowTargetDeliveryIntent",
    schemaVersion: 1,
    targetDeliveryId: value.targetDeliveryId,
    programId: value.programId,
    configDigest: value.configDigest,
    demandId: value.demandId,
    target: value.target,
    route: value.route,
    language: value.language,
    portablePrompt: value.portablePrompt,
    ...(value.rework === undefined ? {} : { rework: value.rework }),
    ...(value.productDefectRemediation === undefined
      ? {}
      : { productDefectRemediation: value.productDefectRemediation }),
    preparedAt: value.preparedAt,
  };
}

/** 严格解析并复验self-excluding digest的Target Delivery Intent。 */
export function parseTargetDeliveryIntent(
  value: unknown,
): Readonly<TargetDeliveryIntent> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$intent");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    throw error;
  }
  const validated = validateWire(json);
  if (!validated.ok) fail("schema", validated.path);
  const wire = validated.value;
  const targetDeliveryId = parseId(
    wire.targetDeliveryId,
    "target-delivery",
    "$/targetDeliveryId",
  );
  const demandId = parseId(wire.demandId, "demand", "$/demandId");
  const taskPackageId = parseId(
    wire.target.taskPackageId,
    "task-package",
    "$/target/taskPackageId",
  );
  let taskPackageRef: PortableResourcePath;
  try {
    taskPackageRef = parsePortableResourcePath(wire.target.taskPackageRef);
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) {
      fail("path", "$/target/taskPackageRef");
    }
    throw error;
  }
  if (taskPackageRef !== packageRef(demandId, taskPackageId)) {
    fail("relation", "$/target/taskPackageRef");
  }
  if (!HOST_IDS.has(wire.route.hostId)) fail("host", "$/route/hostId");
  if (!LANGUAGES.has(wire.language)) fail("language", "$/language");
  if (
    encodeUtf8(wire.portablePrompt, "$/portablePrompt").byteLength >
    MAXIMUM_PROMPT_BYTES
  ) {
    fail("prompt", "$/portablePrompt");
  }
  let bindingId: WakeflowWindowHostBindingId;
  try {
    bindingId = parseWakeflowWindowHostBindingId(
      wire.route.bindingId,
      "$/route/bindingId",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowHostBindingIdError) {
      fail("identifier", "$/route/bindingId");
    }
    throw error;
  }
  let preparedAt: UtcInstant;
  try {
    preparedAt = parseUtcInstant(wire.preparedAt, "$/preparedAt");
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("time", "$/preparedAt");
    throw error;
  }
  const rework =
    wire.rework === undefined
      ? undefined
      : parseTargetDeliveryReworkContext(wire.rework, "$/rework");
  const productDefectRemediation =
    wire.productDefectRemediation === undefined
      ? undefined
      : parseTargetDeliveryProductDefectRemediationContext(
          wire.productDefectRemediation,
          "$/productDefectRemediation",
        );
  if (rework !== undefined && productDefectRemediation !== undefined) {
    fail("relation", "$executionSources");
  }
  const basis = intentBasis({
    kind: "WakeflowTargetDeliveryIntent",
    schemaVersion: 1,
    targetDeliveryId,
    programId: parseId(wire.programId, "program", "$/programId"),
    configDigest: digest(wire.configDigest, "$/configDigest"),
    demandId,
    target: Object.freeze({
      targetTaskId: parseId(
        wire.target.targetTaskId,
        "target-task",
        "$/target/targetTaskId",
      ),
      taskPackageId,
      taskPackageRef,
      taskPackageDigest: digest(
        wire.target.taskPackageDigest,
        "$/target/taskPackageDigest",
      ),
    }),
    route: Object.freeze({
      hostId: wire.route.hostId,
      windowId: parseId(wire.route.windowId, "window", "$/route/windowId"),
      bindingId,
    }),
    language: wire.language,
    portablePrompt: wire.portablePrompt,
    ...(rework === undefined ? {} : { rework }),
    ...(productDefectRemediation === undefined
      ? {}
      : { productDefectRemediation }),
    preparedAt,
  });
  const intentDigest = digest(wire.intentDigest, "$/intentDigest");
  if (computeCanonicalJsonSha256Digest(basis) !== intentDigest) {
    fail("digest", "$/intentDigest");
  }
  return Object.freeze({ ...basis, intentDigest });
}

/** 为所有消费者提供唯一的Target Delivery执行来源分类。 */
export function targetDeliveryPurpose(value: unknown): TargetDeliveryPurpose {
  const intent = parseTargetDeliveryIntent(value);
  return intent.rework !== undefined
    ? "implementation-review-rework"
    : intent.productDefectRemediation !== undefined
      ? "product-defect-remediation"
      : "initial";
}

/** 使用当前时钟创建一份完整、确定性且尚未产生宿主效果的Intent。 */
export function createTargetDeliveryIntent(
  input: Readonly<CreateTargetDeliveryIntentInput>,
  options: CreateTargetDeliveryIntentOptions = {},
): Readonly<TargetDeliveryIntent> {
  let taskPackage: Readonly<TaskPackage>;
  try {
    taskPackage = parseTaskPackage(input.taskPackage);
  } catch (error: unknown) {
    if (error instanceof TaskPackageError) fail("task-package", "$taskPackage");
    throw error;
  }
  if (taskPackage.workType !== "implementation") {
    fail("task-package", "$taskPackage");
  }
  let preparedAt: UtcInstant;
  try {
    preparedAt =
      options.clock === undefined
        ? readUtcWallClock()
        : readUtcWallClock(options.clock);
  } catch (error: unknown) {
    if (error instanceof UtcWallClockError) fail("time", "$clock");
    throw error;
  }
  const rework =
    input.rework === undefined
      ? undefined
      : parseTargetDeliveryReworkContext(input.rework);
  const productDefectRemediation =
    input.productDefectRemediation === undefined
      ? undefined
      : parseTargetDeliveryProductDefectRemediationContext(
          input.productDefectRemediation,
        );
  if (rework !== undefined && productDefectRemediation !== undefined) {
    fail("relation", "$executionSources");
  }
  const basis = intentBasis({
    kind: "WakeflowTargetDeliveryIntent",
    schemaVersion: 1,
    targetDeliveryId: parseId(
      input.targetDeliveryId,
      "target-delivery",
      "$targetDeliveryId",
    ),
    programId: taskPackage.programId,
    configDigest: taskPackage.configDigest,
    demandId: taskPackage.demandId,
    target: Object.freeze({
      targetTaskId: taskPackage.targetTaskId,
      taskPackageId: taskPackage.taskPackageId,
      taskPackageRef: packageRef(
        taskPackage.demandId,
        taskPackage.taskPackageId,
      ),
      taskPackageDigest: computeTaskPackageDigest(taskPackage),
    }),
    route: Object.freeze({
      hostId: input.hostId,
      windowId: taskPackage.assignment.windowId,
      bindingId: input.bindingId,
    }),
    language: input.language,
    portablePrompt: renderTargetDeliveryPortablePrompt(
      taskPackage,
      input.language,
      rework,
      productDefectRemediation,
    ),
    ...(rework === undefined ? {} : { rework }),
    ...(productDefectRemediation === undefined
      ? {}
      : { productDefectRemediation }),
    preparedAt,
  });
  const intent = parseTargetDeliveryIntent({
    ...basis,
    intentDigest: computeCanonicalJsonSha256Digest(basis),
  });
  assertTargetDeliveryIntentMatchesTaskPackage(intent, taskPackage);
  return intent;
}

/** 复验Intent只引用并准确渲染同一份不可变TaskPackage。 */
export function assertTargetDeliveryIntentMatchesTaskPackage(
  intentValue: unknown,
  taskPackageValue: unknown,
): void {
  const intent = parseTargetDeliveryIntent(intentValue);
  let taskPackage: Readonly<TaskPackage>;
  try {
    taskPackage = parseTaskPackage(taskPackageValue);
  } catch (error: unknown) {
    if (error instanceof TaskPackageError) fail("task-package", "$taskPackage");
    throw error;
  }
  if (taskPackage.workType !== "implementation") {
    fail("task-package", "$taskPackage");
  }
  if (
    intent.programId !== taskPackage.programId ||
    intent.configDigest !== taskPackage.configDigest ||
    intent.demandId !== taskPackage.demandId ||
    intent.target.targetTaskId !== taskPackage.targetTaskId ||
    intent.target.taskPackageId !== taskPackage.taskPackageId ||
    intent.target.taskPackageDigest !== computeTaskPackageDigest(taskPackage) ||
    intent.route.windowId !== taskPackage.assignment.windowId ||
    intent.portablePrompt !==
      portablePromptFor(
        taskPackage,
        intent.language,
        intent.rework,
        intent.productDefectRemediation,
      )
  ) {
    fail("relation", "$sources");
  }
  // preparedAt只保存审计观察；TaskPackage来源、当前phase与Event顺序由digest和append CAS证明。
}

/** 计算已准入Target Delivery Intent的Canonical JSON摘要。 */
export function computeTargetDeliveryIntentDigest(
  value: unknown,
): Sha256Digest {
  return parseTargetDeliveryIntent(value).intentDigest;
}
