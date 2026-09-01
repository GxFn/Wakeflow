import {
  WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_REQUEST_SCHEMA,
  type WakeflowTargetResultReviewInspectionRequestV1 as InspectionRequestWire,
} from "../../contracts/generated/entrypoints/wakeflow-target-result-review-inspection-request.generated.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import { encodeCanonicalJson } from "../../foundation/data/canonical-json.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";

/** Wakeflow Governance / Review：共享TargetResult Review只读公共请求合同。 */

export const WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME =
  "wakeflow_inspect_target_result_review" as const;
export const WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_SCHEMA_VERSION =
  1 as const;

const TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_MAXIMUM_REQUEST_BYTES = 64 * 1024;

export interface TargetResultReviewInspectionPublicRequest {
  readonly root: string;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly targetTaskId: WakeflowDurableId<"target-task">;
}

export type TargetResultReviewInspectionPublicContractErrorReason =
  "json" | "capacity" | "schema" | "identifier";

const ERROR_MESSAGES = {
  json: "Target Result Review inspection request is not passive JSON data.",
  capacity: "Target Result Review inspection request exceeds its capacity.",
  schema:
    "Target Result Review inspection request does not satisfy its Schema.",
  identifier:
    "Target Result Review inspection request contains an invalid identity.",
} as const satisfies Readonly<
  Record<TargetResultReviewInspectionPublicContractErrorReason, string>
>;

/** 公共Review inspection请求准入失败时返回稳定、脱敏错误。 */
export class TargetResultReviewInspectionPublicContractError extends Error {
  override readonly name = "TargetResultReviewInspectionPublicContractError";
  readonly code =
    "wakeflow-target-result-review-inspection-public-contract" as const;
  readonly reason: TargetResultReviewInspectionPublicContractErrorReason;
  readonly path: string;

  constructor(
    reason: TargetResultReviewInspectionPublicContractErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateRequest = createRuntimeJsonSchemaValidator<InspectionRequestWire>(
  WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_REQUEST_SCHEMA,
);

function fail(
  reason: TargetResultReviewInspectionPublicContractErrorReason,
  path: string,
): never {
  throw new TargetResultReviewInspectionPublicContractError(reason, path);
}

/** MCP SDK校验后重新建立有容量约束、递归冻结的Review target selector。 */
export function parseTargetResultReviewInspectionPublicRequest(
  value: unknown,
): TargetResultReviewInspectionPublicRequest {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$request");
    if (
      encodeCanonicalJson(json, "$request").byteLength >
      TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_MAXIMUM_REQUEST_BYTES
    ) {
      fail("capacity", "$request");
    }
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    if (error instanceof TargetResultReviewInspectionPublicContractError) {
      throw error;
    }
    throw error;
  }
  const result = validateRequest(json);
  if (!result.ok) fail("schema", result.path);
  try {
    return Object.freeze({
      root: result.value.root,
      demandId: parseWakeflowDurableIdOfKind(
        result.value.demandId,
        "demand",
        "$/demandId",
      ),
      targetTaskId: parseWakeflowDurableIdOfKind(
        result.value.targetTaskId,
        "target-task",
        "$/targetTaskId",
      ),
    });
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) {
      fail("identifier", "$request");
    }
    throw error;
  }
}
