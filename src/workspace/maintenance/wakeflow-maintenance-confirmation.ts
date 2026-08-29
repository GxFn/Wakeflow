import {
  createWakeflowConfigV3DocumentValue,
} from "../../configuration/wakeflow-config-v3-document.js";
import {
  computeWakeflowConfigV3Digest,
  type WakeflowConfigV3Model,
} from "../../configuration/wakeflow-config-v3.js";
import {
  computeCanonicalJsonSha256Digest,
} from "../../foundation/crypto/canonical-json-sha256.js";
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
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import type {
  WakeflowWorkspaceHostResourceProfile,
} from "../workspace-host-resource-profile.js";
import {
  createWakeflowWorkspaceStaticResourceMatrix,
} from "../wakeflow-workspace-static-resource-matrix.js";
import {
  compileWakeflowWindowLaunchIntents,
  type WakeflowWindowLaunchIntentSet,
} from "../window-runtime/wakeflow-window-launch-intent.js";
import {
  parseWakeflowMaintenanceExecutionPlan,
  WakeflowMaintenanceExecutionPlanError,
  type WakeflowMaintenanceExecutionPlan,
} from "./wakeflow-maintenance-execution-plan.js";
import {
  parseWakeflowStaticMaterializationPreviewRequest,
  WakeflowStaticMaterializationPreviewError,
  type WakeflowStaticMaterializationAction,
  type WakeflowStaticMaterializationPreviewRequest,
} from "./wakeflow-static-materialization-preview-contract.js";

/**
 * Wakeflow Workspace / Maintenance：preview交给用户审查、apply原样回传的确认envelope。
 *
 * Confirmation绑定规范化execution request、完整聚合plan及Fresh launch intent set；它不
 * 保存workspace绝对路径、AbortSignal或raw host handle。Digest只证明同一份被动数据，
 * 不替代apply时的重新推导、filesystem gate或领域owner校验。Recover只读私有intent，
 * 不消费本envelope。
 */

export interface WakeflowMaintenanceConfirmationRequest {
  readonly action: WakeflowStaticMaterializationAction;
  readonly desiredConfig: WakeflowConfigV3Model | null;
  readonly currentHostProfile:
    Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly hostProfiles: readonly [
    Readonly<WakeflowWorkspaceHostResourceProfile>,
    Readonly<WakeflowWorkspaceHostResourceProfile>,
  ];
}

export interface WakeflowMaintenanceConfirmation {
  readonly kind: "WakeflowMaintenanceConfirmation";
  readonly schemaVersion: 1;
  readonly executionBoundary: "confirmed-preview";
  readonly action: WakeflowStaticMaterializationAction;
  readonly executionRequest: Readonly<WakeflowMaintenanceConfirmationRequest>;
  readonly executionPlan: Readonly<WakeflowMaintenanceExecutionPlan>;
  readonly launchIntentSet: Readonly<WakeflowWindowLaunchIntentSet> | null;
  readonly confirmationDigest: Sha256Digest;
}

export type WakeflowMaintenanceConfirmationErrorReason =
  | "input"
  | "request"
  | "plan"
  | "launch-intent"
  | "relation"
  | "digest";

const ERROR_MESSAGES = {
  input: "Wakeflow maintenance confirmation input is invalid.",
  request: "Wakeflow maintenance confirmation execution request is invalid.",
  plan: "Wakeflow maintenance confirmation execution plan is invalid.",
  "launch-intent": "Wakeflow maintenance confirmation launch intents are invalid.",
  relation: "Wakeflow maintenance confirmation fields are inconsistent.",
  digest: "Wakeflow maintenance confirmation digest is invalid.",
} as const satisfies Readonly<Record<
  WakeflowMaintenanceConfirmationErrorReason,
  string
>>;

/** Maintenance confirmation 准入失败的稳定、脱敏错误。 */
export class WakeflowMaintenanceConfirmationError extends Error {
  override readonly name = "WakeflowMaintenanceConfirmationError";
  readonly code = "wakeflow-maintenance-confirmation" as const;
  readonly reason: WakeflowMaintenanceConfirmationErrorReason;
  readonly path: string;

  constructor(reason: WakeflowMaintenanceConfirmationErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(
  reason: WakeflowMaintenanceConfirmationErrorReason,
  path: string,
): never {
  throw new WakeflowMaintenanceConfirmationError(reason, path);
}

function parseRequest(
  value: unknown,
): Readonly<WakeflowMaintenanceConfirmationRequest> {
  let parsed;
  try {
    parsed = parseWakeflowStaticMaterializationPreviewRequest(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowStaticMaterializationPreviewError) {
      fail("request", error.path);
    }
    throw error;
  }
  if (parsed.signal !== undefined || parsed.hostProfiles.length !== 2) {
    fail("request", "$confirmation.executionRequest");
  }
  const hostProfiles = Object.freeze([...parsed.hostProfiles]) as readonly [
    Readonly<WakeflowWorkspaceHostResourceProfile>,
    Readonly<WakeflowWorkspaceHostResourceProfile>,
  ];
  return Object.freeze({
    action: parsed.action,
    desiredConfig: parsed.desiredConfig,
    currentHostProfile: parsed.currentHostProfile,
    hostProfiles,
  });
}

function parsePlan(value: unknown): Readonly<WakeflowMaintenanceExecutionPlan> {
  try {
    return parseWakeflowMaintenanceExecutionPlan(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceExecutionPlanError) {
      fail("plan", error.path);
    }
    throw error;
  }
}

function requestRepresentation(
  request: Readonly<WakeflowMaintenanceConfirmationRequest>,
): JsonValue {
  return parseJsonValue({
    action: request.action,
    desiredConfig: request.desiredConfig === null
      ? null
      : createWakeflowConfigV3DocumentValue(request.desiredConfig),
    currentHostProfile: request.currentHostProfile,
    hostProfiles: request.hostProfiles,
  }, "$confirmation.executionRequest");
}

function expectedLaunchIntents(
  request: Readonly<WakeflowMaintenanceConfirmationRequest>,
): Readonly<WakeflowWindowLaunchIntentSet> | null {
  if (request.action !== "fresh-initialize") return null;
  if (request.desiredConfig === null) fail("relation", "$confirmation");
  return compileWakeflowWindowLaunchIntents(
    request.desiredConfig,
    request.currentHostProfile,
  );
}

function basis(
  action: WakeflowStaticMaterializationAction,
  request: Readonly<WakeflowMaintenanceConfirmationRequest>,
  plan: Readonly<WakeflowMaintenanceExecutionPlan>,
  launchIntentSet: Readonly<WakeflowWindowLaunchIntentSet> | null,
): JsonValue {
  return parseJsonValue({
    kind: "WakeflowMaintenanceConfirmation",
    schemaVersion: 1,
    executionBoundary: "confirmed-preview",
    action,
    executionRequest: requestRepresentation(request),
    executionPlan: plan,
    launchIntentSet,
  }, "$confirmation");
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return computeCanonicalJsonSha256Digest(left)
      === computeCanonicalJsonSha256Digest(right);
  } catch {
    fail("launch-intent", "$confirmation.launchIntentSet");
  }
}

/** 把任意JSON值重验为ready且关系闭合的confirmation。 */
export function parseWakeflowMaintenanceConfirmation(
  value: unknown,
): Readonly<WakeflowMaintenanceConfirmation> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$confirmation");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("input", error.path);
    throw error;
  }
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(json, "$confirmation");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", error.path);
    throw error;
  }
  if (
    Object.keys(record).sort().join("\u0000")
      !== "action\u0000confirmationDigest\u0000executionBoundary\u0000executionPlan\u0000executionRequest\u0000kind\u0000launchIntentSet\u0000schemaVersion"
    || record.kind !== "WakeflowMaintenanceConfirmation"
    || record.schemaVersion !== 1
    || record.executionBoundary !== "confirmed-preview"
  ) {
    fail("input", "$confirmation");
  }
  const request = parseRequest(record.executionRequest);
  const plan = parsePlan(record.executionPlan);
  const launchIntentSet = expectedLaunchIntents(request);
  const expectedDesiredConfigDigest = request.desiredConfig === null
    ? null
    : computeWakeflowConfigV3Digest(request.desiredConfig);
  if (
    record.action !== request.action
    || plan.status !== "ready"
    || plan.sharedPreview.action !== request.action
    || plan.hostId !== request.currentHostProfile.hostId
    || plan.sharedPreview.matrixDigest
      !== createWakeflowWorkspaceStaticResourceMatrix(
        request.currentHostProfile,
      ).matrixDigest
    || (
      expectedDesiredConfigDigest !== null
      && plan.sharedPreview.desiredConfigDigest
        !== expectedDesiredConfigDigest
    )
    || !sameJson(record.launchIntentSet, launchIntentSet)
  ) {
    fail("relation", "$confirmation");
  }
  let confirmationDigest: Sha256Digest;
  try {
    confirmationDigest = parseSha256Digest(
      record.confirmationDigest,
      "$confirmation.confirmationDigest",
    );
  } catch (error: unknown) {
    if (error instanceof Sha256Error) {
      fail("digest", "$confirmation.confirmationDigest");
    }
    throw error;
  }
  const expectedDigest = computeCanonicalJsonSha256Digest(
    basis(request.action, request, plan, launchIntentSet),
  );
  if (confirmationDigest !== expectedDigest) {
    fail("digest", "$confirmation.confirmationDigest");
  }
  return Object.freeze({
    kind: "WakeflowMaintenanceConfirmation",
    schemaVersion: 1,
    executionBoundary: "confirmed-preview",
    action: request.action,
    executionRequest: request,
    executionPlan: plan,
    launchIntentSet,
    confirmationDigest,
  });
}

/** 从ready plan与其exact request创建可公开审查的confirmation。 */
export function createWakeflowMaintenanceConfirmation(
  planValue: unknown,
  requestValue: WakeflowStaticMaterializationPreviewRequest,
): Readonly<WakeflowMaintenanceConfirmation> {
  const request = parseRequest(requestValue);
  const plan = parsePlan(planValue);
  const launchIntentSet = expectedLaunchIntents(request);
  const confirmationBasis = basis(
    request.action,
    request,
    plan,
    launchIntentSet,
  );
  return parseWakeflowMaintenanceConfirmation({
    ...(confirmationBasis as Record<string, JsonValue>),
    confirmationDigest:
      computeCanonicalJsonSha256Digest(confirmationBasis),
  });
}
