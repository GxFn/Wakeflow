import {
  WAKEFLOW_TARGET_RESULT_IMPORT_REQUEST_SCHEMA,
  type WakeflowTargetResultImportRequestV1 as ImportRequestWire,
} from "../../contracts/generated/entrypoints/wakeflow-target-result-import-request.generated.js";
import { encodeCanonicalJson } from "../../foundation/data/canonical-json.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";

/** Wakeflow Governance / Result：TargetResult Import公共请求合同。 */

export const WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME =
  "wakeflow_import_target_result" as const;
export const WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_SCHEMA_VERSION = 1 as const;

const TARGET_RESULT_IMPORT_PUBLIC_MAXIMUM_REQUEST_BYTES = 2 * 1024 * 1024;

export type TargetResultImportPublicRequest = Readonly<ImportRequestWire>;

export type TargetResultImportPublicContractErrorReason =
  "json" | "capacity" | "schema" | "privacy";

const ERROR_MESSAGES = {
  json: "TargetResult Import public request is not passive JSON data.",
  capacity: "TargetResult Import public request exceeds its capacity.",
  schema: "TargetResult Import public request does not satisfy its Schema.",
  privacy:
    "TargetResult Import Agent Report contains the private workspace root.",
} as const satisfies Readonly<
  Record<TargetResultImportPublicContractErrorReason, string>
>;

/** 公共Result Import请求准入失败时返回稳定、脱敏错误。 */
export class TargetResultImportPublicContractError extends Error {
  override readonly name = "TargetResultImportPublicContractError";
  readonly code = "wakeflow-target-result-import-public-contract" as const;
  readonly reason: TargetResultImportPublicContractErrorReason;
  readonly path: string;

  constructor(
    reason: TargetResultImportPublicContractErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateRequest = createRuntimeJsonSchemaValidator<ImportRequestWire>(
  WAKEFLOW_TARGET_RESULT_IMPORT_REQUEST_SCHEMA,
);

function fail(
  reason: TargetResultImportPublicContractErrorReason,
  path: string,
): never {
  throw new TargetResultImportPublicContractError(reason, path);
}

function containsText(value: JsonValue, text: string): boolean {
  if (typeof value === "string") {
    return value.includes(text) || value.includes(JSON.stringify(text));
  }
  if (value === null || typeof value !== "object") return false;
  return Object.values(value).some((entry) => containsText(entry, text));
}

/** MCP SDK校验后重新建立有容量与workspace-root隐私约束的冻结Report请求。 */
export function parseTargetResultImportPublicRequest(
  value: unknown,
): TargetResultImportPublicRequest {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$request");
    if (
      encodeCanonicalJson(json, "$request").byteLength >
      TARGET_RESULT_IMPORT_PUBLIC_MAXIMUM_REQUEST_BYTES
    ) {
      fail("capacity", "$request");
    }
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    if (error instanceof TargetResultImportPublicContractError) throw error;
    throw error;
  }
  const validated = validateRequest(json);
  if (!validated.ok) fail("schema", validated.path);
  const request = validated.value;
  if (
    request.root.length > 1 &&
    containsText(request.report.content as unknown as JsonValue, request.root)
  ) {
    fail("privacy", "$/report/content");
  }
  return request;
}
