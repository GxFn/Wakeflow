import {
  WAKEFLOW_TEST_CARD_PLANNING_REQUEST_SCHEMA,
  type WakeflowTestCardPlanningRequestV1 as TestCardPlanningPublicRequestWire,
} from "../../contracts/generated/entrypoints/wakeflow-test-card-planning-request.generated.js";
import { encodeCanonicalJson } from "../../foundation/data/canonical-json.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";

/** Wakeflow Governance / Testing：公共TestCard Planning preview/apply请求合同。 */

export const WAKEFLOW_TEST_CARD_PLANNING_PUBLIC_TOOL_NAME =
  "wakeflow_plan_test_card" as const;
export const WAKEFLOW_TEST_CARD_PLANNING_PUBLIC_SCHEMA_VERSION = 1 as const;

/** Apply携带完整Demand Authority与TestCard计划，容量与Event Commit上限保留确定性余量。 */
const TEST_CARD_PLANNING_PUBLIC_MAXIMUM_REQUEST_BYTES = 24 * 1024 * 1024;

export type TestCardPlanningPublicPreviewRequest = Readonly<
  Extract<TestCardPlanningPublicRequestWire, { readonly mode: "preview" }>
>;
export type TestCardPlanningPublicApplyRequest = Readonly<
  Extract<TestCardPlanningPublicRequestWire, { readonly mode: "apply" }>
>;
export type TestCardPlanningPublicRequest =
  TestCardPlanningPublicPreviewRequest | TestCardPlanningPublicApplyRequest;

export type TestCardPlanningPublicContractErrorReason =
  "json" | "capacity" | "schema";

const ERROR_MESSAGES = {
  json: "TestCard Planning public request is not passive JSON data.",
  capacity: "TestCard Planning public request exceeds its capacity.",
  schema: "TestCard Planning public request does not satisfy its Schema.",
} as const satisfies Readonly<
  Record<TestCardPlanningPublicContractErrorReason, string>
>;

/** 公共TestCard Planning请求准入失败时返回稳定、脱敏错误。 */
export class TestCardPlanningPublicContractError extends Error {
  override readonly name = "TestCardPlanningPublicContractError";
  readonly code = "wakeflow-test-card-planning-public-contract" as const;
  readonly reason: TestCardPlanningPublicContractErrorReason;
  readonly path: string;

  constructor(reason: TestCardPlanningPublicContractErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateRequest =
  createRuntimeJsonSchemaValidator<TestCardPlanningPublicRequestWire>(
    WAKEFLOW_TEST_CARD_PLANNING_REQUEST_SCHEMA,
  );

function fail(
  reason: TestCardPlanningPublicContractErrorReason,
  path: string,
): never {
  throw new TestCardPlanningPublicContractError(reason, path);
}

/** MCP SDK校验后重新建立有容量约束、递归冻结的请求快照。 */
export function parseTestCardPlanningPublicRequest(
  value: unknown,
): TestCardPlanningPublicRequest {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$request");
    if (
      encodeCanonicalJson(json, "$request").byteLength >
      TEST_CARD_PLANNING_PUBLIC_MAXIMUM_REQUEST_BYTES
    ) {
      fail("capacity", "$request");
    }
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    if (error instanceof TestCardPlanningPublicContractError) throw error;
    throw error;
  }
  const result = validateRequest(json);
  if (!result.ok) fail("schema", result.path);
  return result.value as TestCardPlanningPublicRequest;
}
