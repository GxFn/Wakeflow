import type { WakeflowDemandPublicationRequestV1 as DemandPublicationPublicRequestWire } from "../../../contracts/generated/entrypoints/wakeflow-demand-publication-request.generated.js";
import { WAKEFLOW_DEMAND_PUBLICATION_REQUEST_SCHEMA } from "../../../contracts/generated/entrypoints/wakeflow-demand-publication-request.generated.js";
import { encodeCanonicalJson } from "../../../foundation/data/canonical-json.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../../foundation/schema/runtime-json-schema.js";

/** Wakeflow Governance / Demand Publication：公共preview/apply/recover wire请求合同。 */

export const WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME =
  "wakeflow_create_demand" as const;
export const WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_SCHEMA_VERSION = 1 as const;

/** 24 MiB内部transaction之外，为root、mode、digest与JSON结构保留确定性余量。 */
const DEMAND_PUBLICATION_PUBLIC_MAXIMUM_REQUEST_BYTES = 32 * 1024 * 1024;

export type DemandPublicationPublicPreviewRequest = Extract<
  DemandPublicationPublicRequestWire,
  { readonly mode: "preview" }
>;
export type DemandPublicationPublicApplyRequest = Extract<
  DemandPublicationPublicRequestWire,
  { readonly mode: "apply" }
>;
export type DemandPublicationPublicRecoverRequest = Extract<
  DemandPublicationPublicRequestWire,
  { readonly mode: "recover" }
>;
export type DemandPublicationPublicRequest =
  | Readonly<DemandPublicationPublicPreviewRequest>
  | Readonly<DemandPublicationPublicApplyRequest>
  | Readonly<DemandPublicationPublicRecoverRequest>;

export type DemandPublicationPublicContractErrorReason =
  "json" | "capacity" | "schema";

const ERROR_MESSAGES = {
  json: "Demand Publication public request is not passive JSON data.",
  capacity: "Demand Publication public request exceeds its capacity.",
  schema: "Demand Publication public request does not satisfy its Schema.",
} as const satisfies Readonly<
  Record<DemandPublicationPublicContractErrorReason, string>
>;

export class DemandPublicationPublicContractError extends Error {
  override readonly name = "DemandPublicationPublicContractError";
  readonly code = "wakeflow-demand-publication-public-contract" as const;
  readonly reason: DemandPublicationPublicContractErrorReason;
  readonly path: string;

  constructor(
    reason: DemandPublicationPublicContractErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateRequest =
  createRuntimeJsonSchemaValidator<DemandPublicationPublicRequestWire>(
    WAKEFLOW_DEMAND_PUBLICATION_REQUEST_SCHEMA,
  );

function fail(
  reason: DemandPublicationPublicContractErrorReason,
  path: string,
): never {
  throw new DemandPublicationPublicContractError(reason, path);
}

/** MCP SDK校验后仍由领域边界重新创建递归冻结的request快照。 */
export function parseDemandPublicationPublicRequest(
  value: unknown,
): DemandPublicationPublicRequest {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$request");
    if (
      encodeCanonicalJson(json, "$request").byteLength >
      DEMAND_PUBLICATION_PUBLIC_MAXIMUM_REQUEST_BYTES
    ) {
      fail("capacity", "$request");
    }
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    if (error instanceof DemandPublicationPublicContractError) throw error;
    throw error;
  }
  const result = validateRequest(json);
  if (!result.ok) fail("schema", result.path);
  return result.value as DemandPublicationPublicRequest;
}
