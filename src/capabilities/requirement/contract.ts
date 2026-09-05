import {
  WAKEFLOW_BOARD_INSPECTION_REQUEST_SCHEMA,
  type WakeflowBoardInspectionRequestV1,
} from "../../contracts/generated/entrypoints/wakeflow-board-inspection-request.generated.js";
import {
  WAKEFLOW_BOARD_INSPECTION_RESULT_SCHEMA,
  type WakeflowBoardInspectionResultV1,
} from "../../contracts/generated/entrypoints/wakeflow-board-inspection-result.generated.js";
import {
  WAKEFLOW_REQUIREMENT_PUBLICATION_REQUEST_SCHEMA,
  type WakeflowRequirementPublicationRequestV1,
} from "../../contracts/generated/entrypoints/wakeflow-requirement-publication-request.generated.js";
import {
  WAKEFLOW_REQUIREMENT_PUBLICATION_RESULT_SCHEMA,
  type WakeflowRequirementPublicationResultV1,
} from "../../contracts/generated/entrypoints/wakeflow-requirement-publication-result.generated.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import { fail } from "../../kernel/error.js";
import type { WakeflowToolRegistration } from "../../kernel/tool-registry.js";

/**
 * Wakeflow Capabilities / Requirement：需求包的公共合同（能力卡 3，ADR-0011）。
 *
 * 两个工具：`wakeflow_publish_requirement`（效果型：publish、activate、withdraw；
 * preview、apply、recover）与 `wakeflow_inspect_board`（读：list、package）。
 */

export const WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME =
  "wakeflow_publish_requirement" as const;
export const WAKEFLOW_BOARD_INSPECTION_PUBLIC_TOOL_NAME = "wakeflow_inspect_board" as const;
export const WAKEFLOW_REQUIREMENT_PUBLIC_SCHEMA_VERSION = 1 as const;

export type RequirementPublicationRequest = Readonly<WakeflowRequirementPublicationRequestV1>;
export type RequirementPublicationResult = Readonly<WakeflowRequirementPublicationResultV1>;
export type BoardInspectionRequest = Readonly<WakeflowBoardInspectionRequestV1>;
export type BoardInspectionResult = Readonly<WakeflowBoardInspectionResultV1>;

const validatePublicationRequest =
  createRuntimeJsonSchemaValidator<WakeflowRequirementPublicationRequestV1>(
    WAKEFLOW_REQUIREMENT_PUBLICATION_REQUEST_SCHEMA,
  );
const validatePublicationResult =
  createRuntimeJsonSchemaValidator<WakeflowRequirementPublicationResultV1>(
    WAKEFLOW_REQUIREMENT_PUBLICATION_RESULT_SCHEMA,
  );
const validateBoardRequest = createRuntimeJsonSchemaValidator<WakeflowBoardInspectionRequestV1>(
  WAKEFLOW_BOARD_INSPECTION_REQUEST_SCHEMA,
);
const validateBoardResult = createRuntimeJsonSchemaValidator<WakeflowBoardInspectionResultV1>(
  WAKEFLOW_BOARD_INSPECTION_RESULT_SCHEMA,
);

function requestJson(value: unknown): JsonValue {
  try {
    return parseJsonValue(value, "$request");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("invalid-request", "not-json", error.path);
    throw error;
  }
}

export function parseRequirementPublicationRequest(value: unknown): RequirementPublicationRequest {
  const result = validatePublicationRequest(requestJson(value));
  if (!result.ok) fail("invalid-request", "schema", `$request${result.path.slice(1)}`);
  return result.value;
}

export function admitRequirementPublicationResult(value: unknown): RequirementPublicationResult {
  const result = validatePublicationResult(parseJsonValue(value, "$result"));
  if (!result.ok) fail("output-boundary", "result-schema", `$result${result.path.slice(1)}`);
  return result.value;
}

export function parseBoardInspectionRequest(value: unknown): BoardInspectionRequest {
  const result = validateBoardRequest(requestJson(value));
  if (!result.ok) fail("invalid-request", "schema", `$request${result.path.slice(1)}`);
  return result.value;
}

export function admitBoardInspectionResult(value: unknown): BoardInspectionResult {
  const result = validateBoardResult(parseJsonValue(value, "$result"));
  if (!result.ok) fail("output-boundary", "result-schema", `$result${result.path.slice(1)}`);
  return result.value;
}

/** 本切片在公共工具登记表里的两个条目；目录只汇总。 */
export const REQUIREMENT_PUBLICATION_TOOL_REGISTRATION = Object.freeze({
  name: WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME,
  slice: "requirement",
  shape: "effect",
  executor: "publishRequirement",
  title: "Publish Wakeflow Requirement Package",
  description:
    "Publish one requirement package as the single handoff: preview reads requirement.md, landing.md, and text attachments from the Design surface, checks the required sections for the demand type, scans privacy, and returns the one-page summary the user confirms (confirmation point 1); apply writes the immutable ledger record and puts a pending or parked row on the board in one call; activate and withdraw move a package on the board with CAS. Wakeflow never creates a Demand here.",
  requestSchema: WAKEFLOW_REQUIREMENT_PUBLICATION_REQUEST_SCHEMA,
  resultSchema: WAKEFLOW_REQUIREMENT_PUBLICATION_RESULT_SCHEMA,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const) satisfies Readonly<WakeflowToolRegistration>;

export const BOARD_INSPECTION_TOOL_REGISTRATION = Object.freeze({
  name: WAKEFLOW_BOARD_INSPECTION_PUBLIC_TOOL_NAME,
  slice: "requirement",
  shape: "read",
  executor: "inspectBoard",
  title: "Inspect Wakeflow Requirement Board",
  description:
    "Read the requirement board: list returns published packages sorted by priority, publish time, and id with their claim status and counts per status; package returns one package's claim state plus its record header, member digests, and section anchors for planning references. Reads only; never claims.",
  requestSchema: WAKEFLOW_BOARD_INSPECTION_REQUEST_SCHEMA,
  resultSchema: WAKEFLOW_BOARD_INSPECTION_RESULT_SCHEMA,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const) satisfies Readonly<WakeflowToolRegistration>;
