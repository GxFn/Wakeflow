import type {
  WakeflowDemandIdentity as DemandIdentityWire,
} from "../../../contracts/generated/governance/demand/demand-identity.generated.js";
import {
  WAKEFLOW_DEMAND_IDENTITY_SCHEMA,
} from "../../../contracts/generated/governance/demand/demand-identity.generated.js";
import { WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA } from "../../../contracts/generated/governance/ledger/ledger-authority-member-reference.generated.js";
import { WAKEFLOW_TODO_INTAKE_LINEAGE_SCHEMA } from "../../../contracts/generated/governance/todo/todo-intake-lineage.generated.js";
import { WAKEFLOW_TODO_ITEM_ID_SCHEMA } from "../../../contracts/generated/governance/todo/todo-item-id.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../../contracts/generated/foundation/utc-instant.generated.js";
import {
  computeCanonicalJsonSha256Digest,
} from "../../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../../foundation/crypto/sha256.js";
import {
  DeterministicJsonDocumentError,
  parseDeterministicJsonDocument,
  renderDeterministicJsonDocument,
} from "../../../foundation/data/deterministic-json-document.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../../foundation/data/json-value.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../../foundation/data/passive-own-data.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../../foundation/identity/wakeflow-durable-id.js";
import {
  createRuntimeJsonSchemaValidator,
} from "../../../foundation/schema/runtime-json-schema.js";
import {
  parseUtcInstant,
  UtcInstantError,
  type UtcInstant,
} from "../../../foundation/time/utc-instant.js";
import {
  readUtcWallClock,
  UtcWallClockError,
  type UtcWallClock,
} from "../../../foundation/time/wall-clock.js";
import {
  parseLedgerAuthorityMemberReference,
  type LedgerAuthorityMemberReference,
} from "../../ledger/ledger-authority-store.js";
import {
  parseTodoIntakeLineageReference,
  TodoIntakeLineageError,
  type TodoIntakeLineageReference,
} from "../../todo/todo-intake-lineage.js";

/**
 * Wakeflow Governance / Demand Model：Event Sourced Aggregate 的不可变 Identity。
 *
 * Identity 固定 Demand 的目标、类型、TODO intake lineage 与 execution placement；
 * 它不是 event、snapshot 或 mutable state。所有正常 Demand 必须在 publication 时与
 * mandatory Authority 一起创建，之后不能被 Event Sourcing Store 替换。
 */

export const DEMAND_IDENTITY_ARTIFACT_KIND =
  "wakeflow-demand-identity" as const;
export const DEMAND_IDENTITY_SCHEMA_VERSION = 1 as const;

export type DemandType = "requirement" | "bug" | "supplement" | "research";

export type DemandExecutionPlacement =
  | Readonly<{ readonly mode: "main" }>
  | Readonly<{
      readonly mode: "isolated";
      readonly authorizationRef: Readonly<LedgerAuthorityMemberReference>;
    }>;

export interface DemandIdentity {
  readonly artifactKind: typeof DEMAND_IDENTITY_ARTIFACT_KIND;
  readonly schemaVersion: typeof DEMAND_IDENTITY_SCHEMA_VERSION;
  readonly programId: WakeflowDurableId<"program">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly createdAt: UtcInstant;
  readonly title: string;
  readonly goal: string;
  readonly completionDefinition: string;
  readonly demandType: DemandType;
  readonly source: Readonly<TodoIntakeLineageReference>;
  readonly executionPlacement: DemandExecutionPlacement;
}

export interface CreateDemandIdentityOptions {
  readonly clock?: UtcWallClock;
}

export type DemandIdentityErrorReason =
  | "input"
  | "json"
  | "schema"
  | "identifier"
  | "time"
  | "text"
  | "source"
  | "placement"
  | "representation";

const ERROR_MESSAGES = {
  "input": "Demand identity input is invalid.",
  "json": "Demand identity is not passive JSON data.",
  "schema": "Demand identity does not satisfy its portable Schema.",
  "identifier": "Demand identity contains an invalid typed identity.",
  "time": "Demand identity contains an invalid creation time.",
  "text": "Demand identity contains non-canonical text.",
  "source": "Demand identity TODO lineage is invalid.",
  "placement": "Demand identity execution placement is invalid.",
  "representation": "Demand identity bytes are not its deterministic domain representation.",
} as const satisfies Readonly<Record<DemandIdentityErrorReason, string>>;

export class DemandIdentityError extends Error {
  override readonly name = "DemandIdentityError";
  readonly code = "wakeflow-demand-identity" as const;
  readonly reason: DemandIdentityErrorReason;
  readonly path: string;

  constructor(reason: DemandIdentityErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWire = createRuntimeJsonSchemaValidator<DemandIdentityWire>(
  WAKEFLOW_DEMAND_IDENTITY_SCHEMA,
  [
    WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
    WAKEFLOW_TODO_INTAKE_LINEAGE_SCHEMA,
    WAKEFLOW_TODO_ITEM_ID_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
  ],
);
const CONTROL_EXCEPT_LF_PATTERN =
  /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;
const DRAFT_FIELDS = Object.freeze([
  "completionDefinition",
  "demandId",
  "demandType",
  "executionPlacement",
  "goal",
  "programId",
  "source",
  "title",
] as const);

function fail(reason: DemandIdentityErrorReason, path: string): never {
  throw new DemandIdentityError(reason, path);
}

function parseCanonicalText(value: string, path: string): string {
  if (
    !value.isWellFormed()
    || value.normalize("NFC") !== value
    || CONTROL_EXCEPT_LF_PATTERN.test(value)
  ) {
    fail("text", path);
  }
  return value;
}

function parseId<Kind extends "program" | "demand">(
  value: unknown,
  kind: Kind,
  path: string,
): WakeflowDurableId<Kind> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path);
    throw error;
  }
}

function normalizeWire(
  wire: Readonly<DemandIdentityWire>,
): Readonly<DemandIdentity> {
  let source: Readonly<TodoIntakeLineageReference>;
  try {
    source = parseTodoIntakeLineageReference(wire.source);
  } catch (error: unknown) {
    if (error instanceof TodoIntakeLineageError) fail("source", "$/source");
    throw error;
  }
  let executionPlacement: DemandExecutionPlacement;
  if (wire.executionPlacement.mode === "main") {
    executionPlacement = Object.freeze({ mode: "main" });
  } else {
    try {
      executionPlacement = Object.freeze({
        mode: "isolated",
        authorizationRef: parseLedgerAuthorityMemberReference(
          wire.executionPlacement.authorizationRef,
        ),
      });
    } catch {
      fail("placement", "$/executionPlacement/authorizationRef");
    }
  }
  let createdAt: UtcInstant;
  try {
    createdAt = parseUtcInstant(wire.createdAt, "$/createdAt");
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("time", "$/createdAt");
    throw error;
  }
  return Object.freeze({
    artifactKind: DEMAND_IDENTITY_ARTIFACT_KIND,
    schemaVersion: DEMAND_IDENTITY_SCHEMA_VERSION,
    programId: parseId(wire.programId, "program", "$/programId"),
    demandId: parseId(wire.demandId, "demand", "$/demandId"),
    createdAt,
    title: parseCanonicalText(wire.title, "$/title"),
    goal: parseCanonicalText(wire.goal, "$/goal"),
    completionDefinition: parseCanonicalText(
      wire.completionDefinition,
      "$/completionDefinition",
    ),
    demandType: wire.demandType,
    source,
    executionPlacement,
  });
}

/** 解析任意内存值为 immutable Demand identity。 */
export function parseDemandIdentity(value: unknown): Readonly<DemandIdentity> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$identity");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    throw error;
  }
  const result = validateWire(json);
  if (!result.ok) fail("schema", result.path);
  return normalizeWire(result.value);
}

function readCreationTime(options: CreateDemandIdentityOptions): UtcInstant {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(options, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (Object.keys(record).some((key) => key !== "clock")) {
    fail("input", "$options");
  }
  try {
    return readUtcWallClock(record.clock as UtcWallClock | undefined);
  } catch (error: unknown) {
    if (error instanceof UtcWallClockError) fail("time", "$options/clock");
    throw error;
  }
}

/** 从不含协议头和时间的关闭 draft 创建 Demand identity。 */
export function createDemandIdentity(
  draft: unknown,
  options: CreateDemandIdentityOptions = {},
): Readonly<DemandIdentity> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(draft, "$draft");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$draft");
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== DRAFT_FIELDS.length
    || keys.some((key, index) => key !== DRAFT_FIELDS[index])
  ) {
    fail("input", "$draft");
  }
  return parseDemandIdentity({
    artifactKind: DEMAND_IDENTITY_ARTIFACT_KIND,
    schemaVersion: DEMAND_IDENTITY_SCHEMA_VERSION,
    programId: record.programId,
    demandId: record.demandId,
    createdAt: readCreationTime(options),
    title: record.title,
    goal: record.goal,
    completionDefinition: record.completionDefinition,
    demandType: record.demandType,
    source: record.source,
    executionPlacement: record.executionPlacement,
  });
}

export function renderDemandIdentity(value: unknown): string {
  return renderDeterministicJsonDocument(
    parseDemandIdentity(value) as unknown as JsonValue,
    "$identity",
  );
}

export function parseDemandIdentityDocument(
  text: unknown,
): Readonly<DemandIdentity> {
  let json: JsonValue;
  try {
    json = parseDeterministicJsonDocument(text, "$identity");
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      fail("representation", error.path);
    }
    throw error;
  }
  const identity = parseDemandIdentity(json);
  if (renderDemandIdentity(identity) !== text) {
    fail("representation", "$identity");
  }
  return identity;
}

export function computeDemandIdentityDigest(value: unknown): Sha256Digest {
  return computeCanonicalJsonSha256Digest(
    parseDemandIdentity(value) as unknown as JsonValue,
  );
}
