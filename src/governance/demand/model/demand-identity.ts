import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../../contracts/generated/foundation/utc-instant.generated.js";
import type { WakeflowDemandIdentity as DemandIdentityWire } from "../../../contracts/generated/governance/demand/demand-identity.generated.js";
import { WAKEFLOW_DEMAND_IDENTITY_SCHEMA } from "../../../contracts/generated/governance/demand/demand-identity.generated.js";
import { WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA } from "../../../contracts/generated/governance/ledger/ledger-authority-member-reference.generated.js";
import { WAKEFLOW_REQUIREMENT_LINEAGE_SCHEMA } from "../../../contracts/generated/governance/ledger/requirement-lineage.generated.js";
import {
  parseWakeflowDurableIdOfKind,
  type WakeflowDurableId,
  WakeflowDurableIdError,
} from "../../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../../foundation/crypto/sha256.js";
import {
  DeterministicJsonDocumentError,
  parseDeterministicJsonDocument,
  renderDeterministicJsonDocument,
} from "../../../foundation/data/deterministic-json-document.js";
import {
  type JsonValue,
  JsonValueError,
  parseJsonValue,
} from "../../../foundation/data/json-value.js";
import { type Fail, failWith, ModuleError } from "../../../foundation/error/module-error.js";
import { createRuntimeJsonSchemaValidator } from "../../../foundation/schema/runtime-json-schema.js";
import {
  parseUtcInstant,
  type UtcInstant,
  UtcInstantError,
} from "../../../foundation/time/utc-instant.js";
import {
  readUtcWallClock,
  type UtcWallClock,
  UtcWallClockError,
} from "../../../foundation/time/wall-clock.js";
import {
  parseRequirementLineageReference,
  RequirementLineageError,
  type RequirementLineageReference,
} from "../../ledger/requirement-lineage.js";

/**
 * Wakeflow Governance / Demand Model：事件溯源聚合的不可变身份记录。
 *
 * 身份记录固定 Demand 的目标、类型、需求包谱系引用和所属 pod（ADR-0010 D3）；它不是
 * 事件、快照或可变状态。pod 的存在性由 demand 切片按当前配置校验，身份只记标识。所有正常 Demand 必须在发布时与必需的权威关系记录一起创建，之后
 * 不能被事件存储替换。
 */

const DEMAND_IDENTITY_ARTIFACT_KIND = "wakeflow-demand-identity" as const;
const DEMAND_IDENTITY_SCHEMA_VERSION = 1 as const;

export type DemandType = "requirement" | "bug" | "supplement" | "research";

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
  readonly source: Readonly<RequirementLineageReference>;
  readonly podId: WakeflowDurableId<"pod">;
}

/**
 * 创建身份的草稿。三个标识和三段文本仍是请求里的原样字符串，由 `createDemandIdentity` 的那一次
 * 解析认定（标识格式、NFC 与控制字符）；来源谱系已经是解析过的引用。
 */
export interface DemandIdentityDraft {
  readonly programId: string;
  readonly demandId: string;
  readonly title: string;
  readonly goal: string;
  readonly completionDefinition: string;
  readonly demandType: DemandType;
  readonly source: Readonly<RequirementLineageReference>;
  readonly podId: string;
}

export interface CreateDemandIdentityOptions {
  readonly clock?: UtcWallClock;
}

export type DemandIdentityErrorReason =
  | "json"
  | "schema"
  | "identifier"
  | "time"
  | "text"
  | "source"
  | "representation";

export class DemandIdentityError extends ModuleError<DemandIdentityErrorReason> {
  static override readonly code = "wakeflow-demand-identity";
}

const fail: Fail<DemandIdentityErrorReason> = failWith(DemandIdentityError);

const validateWire = createRuntimeJsonSchemaValidator<DemandIdentityWire>(
  WAKEFLOW_DEMAND_IDENTITY_SCHEMA,
  [
    WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
    WAKEFLOW_REQUIREMENT_LINEAGE_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
  ],
);
// biome-ignore lint/suspicious/noControlCharactersInRegex: the pattern exists to reject control characters in record text
const CONTROL_EXCEPT_LF_PATTERN = /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;
const DRAFT_VALIDATION_INSTANT = parseUtcInstant(
  "1970-01-01T00:00:00.000Z",
  "$draftValidationInstant",
);

function parseCanonicalText(value: string, path: string): string {
  if (
    !value.isWellFormed() ||
    value.normalize("NFC") !== value ||
    CONTROL_EXCEPT_LF_PATTERN.test(value)
  ) {
    fail("text", path);
  }
  return value;
}

function parseId<Kind extends "program" | "demand" | "pod">(
  value: unknown,
  kind: Kind,
  path: string,
): WakeflowDurableId<Kind> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path, error);
    throw error;
  }
}

function normalizeWire(wire: Readonly<DemandIdentityWire>): Readonly<DemandIdentity> {
  let source: Readonly<RequirementLineageReference>;
  try {
    source = parseRequirementLineageReference(wire.source);
  } catch (error: unknown) {
    if (error instanceof RequirementLineageError) fail("source", "$/source", error);
    throw error;
  }
  let createdAt: UtcInstant;
  try {
    createdAt = parseUtcInstant(wire.createdAt, "$/createdAt");
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("time", "$/createdAt", error);
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
    completionDefinition: parseCanonicalText(wire.completionDefinition, "$/completionDefinition"),
    demandType: wire.demandType,
    source,
    podId: parseId(wire.podId, "pod", "$/podId"),
  });
}

/** 把任意内存值解析为不可变 `DemandIdentity`。 */
export function parseDemandIdentity(value: unknown): Readonly<DemandIdentity> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$identity");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path, error);
    throw error;
  }
  const result = validateWire(json);
  if (!result.ok) fail("schema", result.path);
  return normalizeWire(result.value);
}

function readCreationTime(options: CreateDemandIdentityOptions): UtcInstant {
  try {
    return readUtcWallClock(options.clock);
  } catch (error: unknown) {
    if (error instanceof UtcWallClockError) fail("time", "$options/clock", error);
    throw error;
  }
}

/** 从不含协议头和时间的草稿创建 `DemandIdentity`；草稿在读时钟之前经过一次完整解析。 */
export function createDemandIdentity(
  draft: Readonly<DemandIdentityDraft>,
  options: CreateDemandIdentityOptions = {},
): Readonly<DemandIdentity> {
  const admitted = parseDemandIdentity({
    artifactKind: DEMAND_IDENTITY_ARTIFACT_KIND,
    schemaVersion: DEMAND_IDENTITY_SCHEMA_VERSION,
    programId: draft.programId,
    demandId: draft.demandId,
    createdAt: DRAFT_VALIDATION_INSTANT,
    title: draft.title,
    goal: draft.goal,
    completionDefinition: draft.completionDefinition,
    demandType: draft.demandType,
    source: draft.source,
    podId: draft.podId,
  });
  return Object.freeze({
    ...admitted,
    createdAt: readCreationTime(options),
  });
}

export function renderDemandIdentity(identity: Readonly<DemandIdentity>): string {
  return renderDeterministicJsonDocument(identity, "$identity");
}

export function parseDemandIdentityDocument(text: unknown): Readonly<DemandIdentity> {
  let json: JsonValue;
  try {
    json = parseDeterministicJsonDocument(text, "$identity");
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      fail("representation", error.path, error);
    }
    throw error;
  }
  const identity = parseDemandIdentity(json);
  if (renderDemandIdentity(identity) !== text) {
    fail("representation", "$identity");
  }
  return identity;
}

export function computeDemandIdentityDigest(identity: Readonly<DemandIdentity>): Sha256Digest {
  return computeCanonicalJsonSha256Digest(identity);
}
