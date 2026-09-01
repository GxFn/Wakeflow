import {
  WAKEFLOW_DEMAND_COMPLETION_REQUEST_SCHEMA,
  type WakeflowDemandCompletionRequestV1 as DemandCompletionPublicRequestWire,
} from "../../contracts/generated/entrypoints/wakeflow-demand-completion-request.generated.js";
import { encodeCanonicalJson } from "../../foundation/data/canonical-json.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";

/** Wakeflow Governance / Lifecycle：公共Demand Completion preview/apply请求合同。 */

export const WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME =
  "wakeflow_complete_demand" as const;
export const WAKEFLOW_DEMAND_COMPLETION_PUBLIC_SCHEMA_VERSION = 1 as const;

/** Apply携带完整冻结Authority；容量与Demand Event Commit的16 MiB上限保留确定性余量。 */
const DEMAND_COMPLETION_PUBLIC_MAXIMUM_REQUEST_BYTES = 24 * 1024 * 1024;

export type DemandCompletionPublicPreviewRequest = Readonly<
  Extract<DemandCompletionPublicRequestWire, { readonly mode: "preview" }>
>;
export type DemandCompletionPublicApplyRequest = Readonly<
  Extract<DemandCompletionPublicRequestWire, { readonly mode: "apply" }>
>;
export type DemandCompletionPublicRequest =
  DemandCompletionPublicPreviewRequest | DemandCompletionPublicApplyRequest;

export type DemandCompletionPublicContractErrorReason =
  "json" | "capacity" | "schema";

const ERROR_MESSAGES = {
  json: "Demand Completion public request is not passive JSON data.",
  capacity: "Demand Completion public request exceeds its capacity.",
  schema: "Demand Completion public request does not satisfy its Schema.",
} as const satisfies Readonly<
  Record<DemandCompletionPublicContractErrorReason, string>
>;

/** 公共Completion请求准入失败时返回稳定、脱敏错误。 */
export class DemandCompletionPublicContractError extends Error {
  override readonly name = "DemandCompletionPublicContractError";
  readonly code = "wakeflow-demand-completion-public-contract" as const;
  readonly reason: DemandCompletionPublicContractErrorReason;
  readonly path: string;

  constructor(reason: DemandCompletionPublicContractErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateRequest =
  createRuntimeJsonSchemaValidator<DemandCompletionPublicRequestWire>(
    WAKEFLOW_DEMAND_COMPLETION_REQUEST_SCHEMA,
  );

function fail(
  reason: DemandCompletionPublicContractErrorReason,
  path: string,
): never {
  throw new DemandCompletionPublicContractError(reason, path);
}

/** MCP SDK校验后重新建立有容量约束、递归冻结的请求快照。 */
export function parseDemandCompletionPublicRequest(
  value: unknown,
): DemandCompletionPublicRequest {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$request");
    if (
      encodeCanonicalJson(json, "$request").byteLength >
      DEMAND_COMPLETION_PUBLIC_MAXIMUM_REQUEST_BYTES
    ) {
      fail("capacity", "$request");
    }
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    if (error instanceof DemandCompletionPublicContractError) throw error;
    throw error;
  }
  const result = validateRequest(json);
  if (!result.ok) fail("schema", result.path);
  return result.value as DemandCompletionPublicRequest;
}
