import {
  WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_REQUEST_SCHEMA,
  type WakeflowTargetResultReviewResumeRequestV1 as ResumeRequestWire,
} from "../../contracts/generated/entrypoints/wakeflow-target-result-review-resume-request.generated.js";
import { encodeCanonicalJson } from "../../foundation/data/canonical-json.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import {
  parseControllerTargetReviewResumeRequest,
  ControllerTargetReviewResumeInputError,
  type ControllerTargetReviewResumeRequest,
} from "./controller-target-review-resume-input.js";

/** Wakeflow Governance / Review：公共TargetResult Review Resume请求合同。 */

export const WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_PUBLIC_TOOL_NAME =
  "wakeflow_resume_target_result_review" as const;
export const WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_PUBLIC_SCHEMA_VERSION =
  1 as const;

const TARGET_RESULT_REVIEW_RESUME_PUBLIC_MAXIMUM_REQUEST_BYTES = 64 * 1024;

export interface TargetResultReviewResumePublicRequest extends ControllerTargetReviewResumeRequest {
  readonly root: string;
}

export type TargetResultReviewResumePublicContractErrorReason =
  "json" | "capacity" | "schema" | "input";

const ERROR_MESSAGES = {
  json: "Target Result Review Resume request is not passive JSON data.",
  capacity: "Target Result Review Resume request exceeds its capacity.",
  schema: "Target Result Review Resume request does not satisfy its Schema.",
  input: "Target Result Review Resume request is not canonical domain input.",
} as const satisfies Readonly<
  Record<TargetResultReviewResumePublicContractErrorReason, string>
>;

/** 公共Resume请求准入失败时返回稳定、脱敏错误。 */
export class TargetResultReviewResumePublicContractError extends Error {
  override readonly name = "TargetResultReviewResumePublicContractError";
  readonly code =
    "wakeflow-target-result-review-resume-public-contract" as const;
  readonly reason: TargetResultReviewResumePublicContractErrorReason;
  readonly path: string;

  constructor(
    reason: TargetResultReviewResumePublicContractErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateRequest = createRuntimeJsonSchemaValidator<ResumeRequestWire>(
  WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_REQUEST_SCHEMA,
);

function fail(
  reason: TargetResultReviewResumePublicContractErrorReason,
  path: string,
): never {
  throw new TargetResultReviewResumePublicContractError(reason, path);
}

/** 重新建立有容量约束并通过内部Resume selector codec的公共请求快照。 */
export function parseTargetResultReviewResumePublicRequest(
  value: unknown,
): Readonly<TargetResultReviewResumePublicRequest> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$request");
    if (
      encodeCanonicalJson(json, "$request").byteLength >
      TARGET_RESULT_REVIEW_RESUME_PUBLIC_MAXIMUM_REQUEST_BYTES
    ) {
      fail("capacity", "$request");
    }
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    if (error instanceof TargetResultReviewResumePublicContractError) {
      throw error;
    }
    throw error;
  }
  const validated = validateRequest(json);
  if (!validated.ok) fail("schema", validated.path);
  let request: Readonly<ControllerTargetReviewResumeRequest>;
  try {
    request = parseControllerTargetReviewResumeRequest({
      demandId: validated.value.demandId,
      targetTaskId: validated.value.targetTaskId,
      expectedBlockedState: validated.value.expectedBlockedState,
      resolutionSummary: validated.value.resolutionSummary,
    });
  } catch (error: unknown) {
    if (error instanceof ControllerTargetReviewResumeInputError) {
      fail("input", "$request");
    }
    throw error;
  }
  return Object.freeze({ root: validated.value.root, ...request });
}
