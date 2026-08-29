import {
  encodeCanonicalJson,
  CanonicalJsonError,
} from "../../foundation/data/canonical-json.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  parseWakeflowMaintenanceOperationId,
  WakeflowMaintenanceOperationIdError,
  type WakeflowMaintenanceOperationId,
} from "./wakeflow-maintenance-operation-id.js";
import {
  WAKEFLOW_STATIC_MATERIALIZATION_ACTIONS,
  type WakeflowStaticMaterializationAction,
} from "./wakeflow-static-materialization-preview-contract.js";

/**
 * Wakeflow Workspace / Maintenance：公共工具请求的闭合 JSON 合同。
 *
 * 本层只负责 mode 路由、精确字段、纯 JSON 与容量准入。它不打开 workspace、不编译
 * Config、不验证 Confirmation 关系，也不执行 mutation；这些职责由公共协调器及其
 * 既有领域 owner 承担。
 */

export const WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME =
  "wakeflow_maintain_workspace" as const;
export const WAKEFLOW_MAINTENANCE_PUBLIC_SCHEMA_VERSION = 1 as const;
export const WAKEFLOW_MAINTENANCE_PUBLIC_MAXIMUM_REQUEST_BYTES =
  4 * 1024 * 1024;

export interface WakeflowMaintenanceFreshPreviewRequest {
  readonly root: string;
  readonly action: "fresh-initialize";
  readonly mode: "preview";
  readonly request: Readonly<{ readonly selection: JsonValue }>;
}

export interface WakeflowMaintenanceReconfigurePreviewRequest {
  readonly root: string;
  readonly action: "reconfigure";
  readonly mode: "preview";
  readonly request: Readonly<{ readonly desiredConfig: JsonValue }>;
}

export interface WakeflowMaintenanceReconcilePreviewRequest {
  readonly root: string;
  readonly action: "reconcile";
  readonly mode: "preview";
  readonly request: Readonly<Record<string, never>>;
}

export type WakeflowMaintenancePublicPreviewRequest =
  | WakeflowMaintenanceFreshPreviewRequest
  | WakeflowMaintenanceReconfigurePreviewRequest
  | WakeflowMaintenanceReconcilePreviewRequest;

export interface WakeflowMaintenancePublicApplyRequest {
  readonly root: string;
  readonly mode: "apply";
  readonly confirmation: JsonValue;
  readonly confirmationDigest: Sha256Digest;
}

export interface WakeflowMaintenancePublicRecoverRequest {
  readonly root: string;
  readonly mode: "recover";
  readonly operationId: WakeflowMaintenanceOperationId;
}

export type WakeflowMaintenancePublicRequest =
  | WakeflowMaintenancePublicPreviewRequest
  | WakeflowMaintenancePublicApplyRequest
  | WakeflowMaintenancePublicRecoverRequest;

export type WakeflowMaintenancePublicContractErrorReason =
  | "input"
  | "mode"
  | "action"
  | "shape"
  | "capacity"
  | "digest"
  | "operation-id";

const ERROR_MESSAGES = {
  input: "Wakeflow public maintenance request is not passive JSON data.",
  mode: "Wakeflow public maintenance mode is invalid.",
  action: "Wakeflow public maintenance action is invalid.",
  shape: "Wakeflow public maintenance request has an invalid field set.",
  capacity: "Wakeflow public maintenance request exceeds its capacity.",
  digest: "Wakeflow public maintenance confirmation digest is invalid.",
  "operation-id": "Wakeflow public maintenance operation ID is invalid.",
} as const satisfies Readonly<Record<
  WakeflowMaintenancePublicContractErrorReason,
  string
>>;

/** 公共 Maintenance 请求准入失败的稳定、脱敏错误。 */
export class WakeflowMaintenancePublicContractError extends Error {
  override readonly name = "WakeflowMaintenancePublicContractError";
  readonly code = "wakeflow-maintenance-public-contract" as const;
  readonly reason: WakeflowMaintenancePublicContractErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowMaintenancePublicContractErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(
  reason: WakeflowMaintenancePublicContractErrorReason,
  path: string,
): never {
  throw new WakeflowMaintenancePublicContractError(reason, path);
}

function record(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  try {
    return parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("shape", error.path);
    throw error;
  }
}

function assertExactFields(
  value: Readonly<Record<string, unknown>>,
  fields: readonly string[],
  path: string,
): void {
  if (Object.keys(value).sort().join("\u0000") !== [...fields].sort().join("\u0000")) {
    fail("shape", path);
  }
}

function parsePreviewRequest(
  outer: Readonly<Record<string, unknown>>,
  root: string,
): Readonly<WakeflowMaintenancePublicPreviewRequest> {
  assertExactFields(outer, ["action", "mode", "request", "root"], "$request");
  if (
    typeof outer.action !== "string"
    || !WAKEFLOW_STATIC_MATERIALIZATION_ACTIONS.includes(
      outer.action as WakeflowStaticMaterializationAction,
    )
  ) {
    fail("action", "$request.action");
  }
  const action = outer.action as WakeflowStaticMaterializationAction;
  const payload = record(outer.request, "$request.request");
  if (action === "fresh-initialize") {
    assertExactFields(payload, ["selection"], "$request.request");
    return Object.freeze({
      root,
      action,
      mode: "preview",
      request: Object.freeze({
        selection: payload.selection as JsonValue,
      }),
    });
  }
  if (action === "reconfigure") {
    assertExactFields(payload, ["desiredConfig"], "$request.request");
    return Object.freeze({
      root,
      action,
      mode: "preview",
      request: Object.freeze({
        desiredConfig: payload.desiredConfig as JsonValue,
      }),
    });
  }
  assertExactFields(payload, [], "$request.request");
  return Object.freeze({
    root,
    action,
    mode: "preview",
    request: Object.freeze({}),
  });
}

/** 把任意输入解析为 preview/apply/recover 三种精确公共请求之一。 */
export function parseWakeflowMaintenancePublicRequest(
  value: unknown,
): Readonly<WakeflowMaintenancePublicRequest> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$request");
    if (
      encodeCanonicalJson(json, "$request").byteLength
        > WAKEFLOW_MAINTENANCE_PUBLIC_MAXIMUM_REQUEST_BYTES
    ) {
      fail("capacity", "$request");
    }
  } catch (error: unknown) {
    if (
      error instanceof JsonValueError
      || error instanceof CanonicalJsonError
    ) {
      fail("input", error.path);
    }
    throw error;
  }
  const outer = record(json, "$request");
  if (typeof outer.root !== "string") fail("shape", "$request.root");
  if (
    outer.mode !== "preview"
    && outer.mode !== "apply"
    && outer.mode !== "recover"
  ) {
    fail("mode", "$request.mode");
  }
  if (outer.mode === "preview") {
    return parsePreviewRequest(outer, outer.root);
  }
  if (outer.mode === "apply") {
    assertExactFields(
      outer,
      ["confirmation", "confirmationDigest", "mode", "root"],
      "$request",
    );
    let confirmationDigest: Sha256Digest;
    try {
      confirmationDigest = parseSha256Digest(
        outer.confirmationDigest,
        "$request.confirmationDigest",
      );
    } catch (error: unknown) {
      if (error instanceof Sha256Error) fail("digest", error.path);
      throw error;
    }
    return Object.freeze({
      root: outer.root,
      mode: "apply",
      confirmation: outer.confirmation as JsonValue,
      confirmationDigest,
    });
  }
  assertExactFields(outer, ["mode", "operationId", "root"], "$request");
  let operationId: WakeflowMaintenanceOperationId;
  try {
    operationId = parseWakeflowMaintenanceOperationId(
      outer.operationId,
      "$request.operationId",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenanceOperationIdError) {
      fail("operation-id", error.path);
    }
    throw error;
  }
  return Object.freeze({
    root: outer.root,
    mode: "recover",
    operationId,
  });
}
