import type { WakeflowConfirmationPublicationRequestV1 as ConfirmationPublicRequestWire } from "../../contracts/generated/entrypoints/wakeflow-confirmation-publication-request.generated.js";
import { WAKEFLOW_CONFIRMATION_PUBLICATION_REQUEST_SCHEMA } from "../../contracts/generated/entrypoints/wakeflow-confirmation-publication-request.generated.js";
import type { WakeflowConfirmationPublicationResultV1 as ConfirmationPublicResultWire } from "../../contracts/generated/entrypoints/wakeflow-confirmation-publication-result.generated.js";
import type { WakeflowRequirementPublicationRequestV1 as RequirementPublicRequestWire } from "../../contracts/generated/entrypoints/wakeflow-requirement-publication-request.generated.js";
import { WAKEFLOW_REQUIREMENT_PUBLICATION_REQUEST_SCHEMA } from "../../contracts/generated/entrypoints/wakeflow-requirement-publication-request.generated.js";
import type { WakeflowRequirementPublicationResultV1 as RequirementPublicResultWire } from "../../contracts/generated/entrypoints/wakeflow-requirement-publication-result.generated.js";
import { encodeCanonicalJson } from "../../foundation/data/canonical-json.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import {
  parseLedgerAuthorityPublicationPlan,
  LedgerAuthorityPublicationPlanError,
} from "./ledger-authority-publication-plan.js";

/**
 * Wakeflow Governance / Ledger：Requirement与Confirmation公共wire请求准入。
 *
 * 两个工具共享被动JSON、Canonical容量和错误合同，但分别使用自己的Schema与返回
 * 类型。Apply/Recover在Schema后还会解析Plan并核对record family，防止结构相同的
 * 请求跨工具复用。该模块不打开Workspace、不读取source，也不调用Planning/Application。
 */

export const WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME =
  "wakeflow_publish_requirement" as const;
export const WAKEFLOW_CONFIRMATION_PUBLICATION_PUBLIC_TOOL_NAME =
  "wakeflow_publish_confirmation" as const;
export const WAKEFLOW_LEDGER_AUTHORITY_PUBLICATION_PUBLIC_SCHEMA_VERSION =
  1 as const;

/** 1 MiB compact intent之外，为Plan外壳、root与Canonical JSON结构保留固定余量。 */
const LEDGER_AUTHORITY_PUBLIC_MAXIMUM_REQUEST_BYTES = 2 * 1024 * 1024;

export type RequirementPublicationPublicPreviewRequest = Extract<
  RequirementPublicRequestWire,
  { readonly mode: "preview" }
>;
export type RequirementPublicationPublicApplyRequest = Extract<
  RequirementPublicRequestWire,
  { readonly mode: "apply" }
>;
export type RequirementPublicationPublicRecoverRequest = Extract<
  RequirementPublicRequestWire,
  { readonly mode: "recover" }
>;
export type RequirementPublicationPublicRequest =
  | Readonly<RequirementPublicationPublicPreviewRequest>
  | Readonly<RequirementPublicationPublicApplyRequest>
  | Readonly<RequirementPublicationPublicRecoverRequest>;
export type RequirementPublicationPublicResult =
  Readonly<RequirementPublicResultWire>;

export type ConfirmationPublicationPublicPreviewRequest = Extract<
  ConfirmationPublicRequestWire,
  { readonly mode: "preview" }
>;
export type ConfirmationPublicationPublicApplyRequest = Extract<
  ConfirmationPublicRequestWire,
  { readonly mode: "apply" }
>;
export type ConfirmationPublicationPublicRecoverRequest = Extract<
  ConfirmationPublicRequestWire,
  { readonly mode: "recover" }
>;
export type ConfirmationPublicationPublicRequest =
  | Readonly<ConfirmationPublicationPublicPreviewRequest>
  | Readonly<ConfirmationPublicationPublicApplyRequest>
  | Readonly<ConfirmationPublicationPublicRecoverRequest>;
export type ConfirmationPublicationPublicResult =
  Readonly<ConfirmationPublicResultWire>;

export type LedgerAuthorityPublicationPublicContractErrorReason =
  | "json"
  | "capacity"
  | "schema"
  | "plan";

const ERROR_MESSAGES = {
  json: "Ledger authority publication public request is not passive JSON data.",
  capacity: "Ledger authority publication public request exceeds its capacity.",
  schema: "Ledger authority publication public request does not satisfy its family Schema.",
  plan: "Ledger authority publication public request does not contain a valid Plan for its tool family.",
} as const satisfies Readonly<Record<
  LedgerAuthorityPublicationPublicContractErrorReason,
  string
>>;

/** 两类Public request不能形成有界、关闭且family一致的wire值时的稳定错误。 */
export class LedgerAuthorityPublicationPublicContractError extends Error {
  override readonly name =
    "LedgerAuthorityPublicationPublicContractError";
  readonly code =
    "wakeflow-ledger-authority-publication-public-contract" as const;
  readonly reason: LedgerAuthorityPublicationPublicContractErrorReason;
  readonly path: string;

  constructor(
    reason: LedgerAuthorityPublicationPublicContractErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateRequirementRequest =
  createRuntimeJsonSchemaValidator<RequirementPublicRequestWire>(
    WAKEFLOW_REQUIREMENT_PUBLICATION_REQUEST_SCHEMA,
  );
const validateConfirmationRequest =
  createRuntimeJsonSchemaValidator<ConfirmationPublicRequestWire>(
    WAKEFLOW_CONFIRMATION_PUBLICATION_REQUEST_SCHEMA,
  );

function fail(
  reason: LedgerAuthorityPublicationPublicContractErrorReason,
  path: string,
): never {
  throw new LedgerAuthorityPublicationPublicContractError(reason, path);
}

function parseBoundedJson(value: unknown): JsonValue {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$request");
    if (
      encodeCanonicalJson(json, "$request").byteLength
        > LEDGER_AUTHORITY_PUBLIC_MAXIMUM_REQUEST_BYTES
    ) {
      fail("capacity", "$request");
    }
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    if (error instanceof LedgerAuthorityPublicationPublicContractError) {
      throw error;
    }
    throw error;
  }
  return json;
}

function assertPlanFamily(
  request: Readonly<{
    readonly mode: "preview" | "apply" | "recover";
    readonly plan?: unknown;
  }>,
  family: "requirement" | "confirmation",
): void {
  if (request.mode === "preview") return;
  let plan;
  try {
    plan = parseLedgerAuthorityPublicationPlan(request.plan);
  } catch (error: unknown) {
    if (error instanceof LedgerAuthorityPublicationPlanError) {
      fail("plan", "$/plan");
    }
    throw error;
  }
  const actual = plan.intent.record.artifactKind ===
      "wakeflow-requirement-record"
    ? "requirement"
    : "confirmation";
  if (actual !== family) fail("plan", "$/plan/intent/record/artifactKind");
}

/** Requirement工具的MCP请求在领域路由前重新准入并冻结。 */
export function parseRequirementPublicationPublicRequest(
  value: unknown,
): RequirementPublicationPublicRequest {
  const json = parseBoundedJson(value);
  const result = validateRequirementRequest(json);
  if (!result.ok) fail("schema", result.path);
  const request = result.value as RequirementPublicationPublicRequest;
  assertPlanFamily(request, "requirement");
  return request;
}

/** Confirmation工具的MCP请求在领域路由前重新准入并冻结。 */
export function parseConfirmationPublicationPublicRequest(
  value: unknown,
): ConfirmationPublicationPublicRequest {
  const json = parseBoundedJson(value);
  const result = validateConfirmationRequest(json);
  if (!result.ok) fail("schema", result.path);
  const request = result.value as ConfirmationPublicationPublicRequest;
  assertPlanFamily(request, "confirmation");
  return request;
}
