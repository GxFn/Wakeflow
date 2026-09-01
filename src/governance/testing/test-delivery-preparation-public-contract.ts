import {
  WAKEFLOW_TEST_DELIVERY_PREPARATION_REQUEST_SCHEMA,
  type WakeflowTestDeliveryPreparationRequestV1 as TestDeliveryPreparationPublicRequestWire,
} from "../../contracts/generated/entrypoints/wakeflow-test-delivery-preparation-request.generated.js";
import { encodeCanonicalJson } from "../../foundation/data/canonical-json.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";

/** Wakeflow Governance / Testing：公共Test Delivery Preparation preview/apply请求合同。 */

export const WAKEFLOW_TEST_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME =
  "wakeflow_prepare_test_delivery" as const;
export const WAKEFLOW_TEST_DELIVERY_PREPARATION_PUBLIC_SCHEMA_VERSION =
  1 as const;

/** Apply携带完整Test Delivery Intent和lineage，容量与Event Commit上限保留确定性余量。 */
const TEST_DELIVERY_PREPARATION_PUBLIC_MAXIMUM_REQUEST_BYTES = 24 * 1024 * 1024;

export type TestDeliveryPreparationPublicPreviewRequest = Readonly<
  Extract<
    TestDeliveryPreparationPublicRequestWire,
    { readonly mode: "preview" }
  >
>;
export type TestDeliveryPreparationPublicApplyRequest = Readonly<
  Extract<TestDeliveryPreparationPublicRequestWire, { readonly mode: "apply" }>
>;
export type TestDeliveryPreparationPublicRequest =
  | TestDeliveryPreparationPublicPreviewRequest
  | TestDeliveryPreparationPublicApplyRequest;

export type TestDeliveryPreparationPublicContractErrorReason =
  "json" | "capacity" | "schema";

const ERROR_MESSAGES = {
  json: "Test Delivery Preparation public request is not passive JSON data.",
  capacity: "Test Delivery Preparation public request exceeds its capacity.",
  schema:
    "Test Delivery Preparation public request does not satisfy its Schema.",
} as const satisfies Readonly<
  Record<TestDeliveryPreparationPublicContractErrorReason, string>
>;

/** 公共Test Delivery Preparation请求准入失败时返回稳定、脱敏错误。 */
export class TestDeliveryPreparationPublicContractError extends Error {
  override readonly name = "TestDeliveryPreparationPublicContractError";
  readonly code = "wakeflow-test-delivery-preparation-public-contract" as const;
  readonly reason: TestDeliveryPreparationPublicContractErrorReason;
  readonly path: string;

  constructor(
    reason: TestDeliveryPreparationPublicContractErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateRequest =
  createRuntimeJsonSchemaValidator<TestDeliveryPreparationPublicRequestWire>(
    WAKEFLOW_TEST_DELIVERY_PREPARATION_REQUEST_SCHEMA,
  );

function fail(
  reason: TestDeliveryPreparationPublicContractErrorReason,
  path: string,
): never {
  throw new TestDeliveryPreparationPublicContractError(reason, path);
}

/** MCP SDK校验后重新建立有容量约束、递归冻结的请求快照。 */
export function parseTestDeliveryPreparationPublicRequest(
  value: unknown,
): TestDeliveryPreparationPublicRequest {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$request");
    if (
      encodeCanonicalJson(json, "$request").byteLength >
      TEST_DELIVERY_PREPARATION_PUBLIC_MAXIMUM_REQUEST_BYTES
    ) {
      fail("capacity", "$request");
    }
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    if (error instanceof TestDeliveryPreparationPublicContractError) {
      throw error;
    }
    throw error;
  }
  const result = validateRequest(json);
  if (!result.ok) fail("schema", result.path);
  return result.value as TestDeliveryPreparationPublicRequest;
}
