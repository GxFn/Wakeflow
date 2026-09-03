import type { WakeflowManagedEvidencePublicationRequestV1 as ManagedEvidencePublicRequestWire } from "../../contracts/generated/entrypoints/wakeflow-managed-evidence-publication-request.generated.js";
import { WAKEFLOW_MANAGED_EVIDENCE_PUBLICATION_REQUEST_SCHEMA } from "../../contracts/generated/entrypoints/wakeflow-managed-evidence-publication-request.generated.js";
import { encodeCanonicalJson } from "../../foundation/data/canonical-json.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";

/** Wakeflow Governance / Evidence：公共preview/apply/recover wire请求合同。 */

export const WAKEFLOW_MANAGED_EVIDENCE_PUBLIC_TOOL_NAME =
  "wakeflow_record_evidence" as const;
export const WAKEFLOW_MANAGED_EVIDENCE_PUBLIC_SCHEMA_VERSION = 1 as const;

/** 2 MiB Transaction之外为root、mode、digest与JSON结构保留确定性余量。 */
const MANAGED_EVIDENCE_PUBLIC_MAXIMUM_REQUEST_BYTES = 4 * 1024 * 1024;

export type ManagedEvidencePublicPreviewRequest = Extract<
  ManagedEvidencePublicRequestWire,
  { readonly mode: "preview" }
>;
export type ManagedEvidencePublicApplyRequest = Extract<
  ManagedEvidencePublicRequestWire,
  { readonly mode: "apply" }
>;
export type ManagedEvidencePublicRecoverRequest = Extract<
  ManagedEvidencePublicRequestWire,
  { readonly mode: "recover" }
>;
export type ManagedEvidencePublicRequest =
  | Readonly<ManagedEvidencePublicPreviewRequest>
  | Readonly<ManagedEvidencePublicApplyRequest>
  | Readonly<ManagedEvidencePublicRecoverRequest>;

export type ManagedEvidencePublicContractErrorReason =
  | "json"
  | "capacity"
  | "schema";

const ERROR_MESSAGES = {
  json: "Managed Evidence public request is not passive JSON data.",
  capacity: "Managed Evidence public request exceeds its capacity.",
  schema: "Managed Evidence public request does not satisfy its Schema.",
} as const satisfies Readonly<
  Record<ManagedEvidencePublicContractErrorReason, string>
>;

export class ManagedEvidencePublicContractError extends Error {
  override readonly name = "ManagedEvidencePublicContractError";
  readonly code = "wakeflow-managed-evidence-public-contract" as const;
  readonly reason: ManagedEvidencePublicContractErrorReason;
  readonly path: string;

  constructor(reason: ManagedEvidencePublicContractErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateRequest =
  createRuntimeJsonSchemaValidator<ManagedEvidencePublicRequestWire>(
    WAKEFLOW_MANAGED_EVIDENCE_PUBLICATION_REQUEST_SCHEMA,
  );

function fail(
  reason: ManagedEvidencePublicContractErrorReason,
  path: string,
): never {
  throw new ManagedEvidencePublicContractError(reason, path);
}

/** MCP SDK校验后仍由领域边界重新创建递归冻结的request快照。 */
export function parseManagedEvidencePublicRequest(
  value: unknown,
): ManagedEvidencePublicRequest {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$request");
    if (
      encodeCanonicalJson(json, "$request").byteLength >
      MANAGED_EVIDENCE_PUBLIC_MAXIMUM_REQUEST_BYTES
    ) {
      fail("capacity", "$request");
    }
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    if (error instanceof ManagedEvidencePublicContractError) throw error;
    throw error;
  }
  const result = validateRequest(json);
  if (!result.ok) fail("schema", result.path);
  return result.value as ManagedEvidencePublicRequest;
}
