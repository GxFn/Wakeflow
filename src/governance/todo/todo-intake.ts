import type {
  WakeflowTodoIntake as TodoIntakeWire,
} from "../../contracts/generated/governance/todo/todo-intake.generated.js";
import { WAKEFLOW_TODO_INTAKE_SCHEMA } from "../../contracts/generated/governance/todo/todo-intake.generated.js";
import { WAKEFLOW_TODO_ITEM_ID_SCHEMA } from "../../contracts/generated/governance/todo/todo-item-id.generated.js";
import { WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA } from "../../contracts/generated/governance/ledger/ledger-authority-member-reference.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  parseDeterministicJsonDocument,
  renderDeterministicJsonDocument,
  DeterministicJsonDocumentError,
} from "../../foundation/data/deterministic-json-document.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import {
  parseDenseArray,
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import {
  parseUtcInstant,
  UtcInstantError,
  type UtcInstant,
} from "../../foundation/time/utc-instant.js";
import {
  readUtcWallClock,
  UtcWallClockError,
  type UtcWallClock,
} from "../../foundation/time/wall-clock.js";
import {
  parseLedgerAuthorityMemberReference,
} from "../ledger/ledger-authority-reader.js";
import {
  LedgerAuthorityStoreError,
  type LedgerAuthorityMemberReference,
} from "../ledger/ledger-authority-store-contract.js";
import {
  parseTodoItemId,
  TodoItemIdError,
  type TodoItemId,
} from "./todo-item-id.js";

/**
 * Wakeflow Governance / TODO：创建后不可变的 Demand 前调度接收权威。
 *
 * Intake 绑定 Program、来源窗口和 Controller 窗口、初始就绪条件、调度策略以及完整的
 * 不可变 Ledger 成员引用。`summary` 仅用于队列观察，不替代 Ledger 或 Demand 的目标；
 * 当前状态、Demand 挂载、修订与归档回执均属于 `TodoState`，Intake 不拥有生命周期转换。
 */

const TODO_INTAKE_ARTIFACT_KIND = "wakeflow-todo-intake" as const;
const TODO_INTAKE_SCHEMA_VERSION = 1 as const;

export type TodoDemandType = "requirement" | "bug" | "supplement" | "research";
export type TodoPriority = "P0" | "P1" | "P2" | "P3";
export type TodoTestingDecisionMode =
  | "controller-only"
  | "real-environment"
  | "not-applicable";

export type TodoReadiness =
  | Readonly<{ readonly status: "ready" }>
  | Readonly<{ readonly status: "parked"; readonly trigger: string }>;

export interface TodoTestingDecision {
  readonly mode: TodoTestingDecisionMode;
  readonly summary: string;
  readonly environmentMemberRef: PortableResourcePath | null;
}

export interface TodoIntake {
  readonly artifactKind: typeof TODO_INTAKE_ARTIFACT_KIND;
  readonly schemaVersion: typeof TODO_INTAKE_SCHEMA_VERSION;
  readonly programId: WakeflowDurableId<"program">;
  readonly todoId: TodoItemId;
  readonly createdAt: UtcInstant;
  readonly demandType: TodoDemandType;
  readonly priority: TodoPriority;
  readonly originWindowId: WakeflowDurableId<"window">;
  readonly controllerWindowId: WakeflowDurableId<"window">;
  readonly summary: string;
  readonly intakeRationale: string;
  readonly readiness: Readonly<TodoReadiness>;
  readonly autoClaim: boolean;
  readonly testingDecision: Readonly<TodoTestingDecision>;
  readonly authorityRefs: readonly [
    Readonly<LedgerAuthorityMemberReference>,
    ...Readonly<LedgerAuthorityMemberReference>[],
  ];
}

export interface CreateTodoIntakeOptions {
  readonly clock?: UtcWallClock;
}

export type TodoIntakeErrorReason =
  | "input"
  | "json"
  | "schema"
  | "identifier"
  | "time"
  | "text"
  | "readiness"
  | "testing-decision"
  | "authority"
  | "representation";

const ERROR_MESSAGES = {
  input: "TODO intake input is invalid.",
  json: "TODO intake is not passive JSON data.",
  schema: "TODO intake does not satisfy its portable Schema.",
  identifier: "TODO intake contains an invalid typed identifier.",
  time: "TODO intake contains an invalid creation time.",
  text: "TODO intake contains non-canonical text.",
  readiness: "TODO intake readiness and Auto Claim policy are inconsistent.",
  "testing-decision": "TODO intake testing decision is inconsistent with its Demand type or Authority.",
  authority: "TODO intake Ledger Authority references are inconsistent.",
  representation: "TODO intake bytes are not its deterministic domain representation.",
} as const satisfies Readonly<Record<TodoIntakeErrorReason, string>>;

/** TODO Intake准入、关系或持久化表示失败时返回的稳定、脱敏错误。 */
export class TodoIntakeError extends Error {
  override readonly name = "TodoIntakeError";
  readonly code = "wakeflow-todo-intake" as const;
  readonly reason: TodoIntakeErrorReason;
  readonly path: string;

  constructor(reason: TodoIntakeErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWireIntake = createRuntimeJsonSchemaValidator<TodoIntakeWire>(
  WAKEFLOW_TODO_INTAKE_SCHEMA,
  [
    WAKEFLOW_TODO_ITEM_ID_SCHEMA,
    WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
  ],
);

const CONTROL_EXCEPT_LF_PATTERN = /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;
const DRAFT_FIELDS = Object.freeze([
  "authorityRefs",
  "autoClaim",
  "controllerWindowId",
  "demandType",
  "intakeRationale",
  "originWindowId",
  "priority",
  "programId",
  "readiness",
  "summary",
  "testingDecision",
  "todoId",
] as const);
const REQUIRED_AUTHORITY_ROLES = Object.freeze({
  requirement: Object.freeze([
    "original-plan",
    "requirement-design",
    "code-facts",
    "landing-plan",
    "non-goals",
    "user-confirmation",
  ]),
  bug: Object.freeze(["reproduction", "scope", "non-goals"]),
  supplement: Object.freeze([
    "requirement-design",
    "requirement-delta",
    "user-confirmation",
  ]),
  research: Object.freeze(["research-question", "boundaries"]),
} as const satisfies Readonly<Record<TodoDemandType, readonly string[]>>);
const DRAFT_VALIDATION_INSTANT = parseUtcInstant(
  "1970-01-01T00:00:00.000Z",
  "$draftValidationInstant",
);

function fail(reason: TodoIntakeErrorReason, path: string): never {
  throw new TodoIntakeError(reason, path);
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

function parseDurableId<K extends "program" | "window">(
  value: unknown,
  kind: K,
  path: string,
): WakeflowDurableId<K> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path);
    throw error;
  }
}

function parseCreatedAt(value: string): UtcInstant {
  try {
    return parseUtcInstant(value, "$/createdAt");
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("time", "$/createdAt");
    throw error;
  }
}

function parseEnvironmentMemberRef(
  value: string | null,
): PortableResourcePath | null {
  if (value === null) return null;
  try {
    return parsePortableResourcePath(
      value,
      "$/testingDecision/environmentMemberRef",
    );
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) {
      fail("testing-decision", "$/testingDecision/environmentMemberRef");
    }
    throw error;
  }
}

function parseReadiness(
  value: Readonly<TodoIntakeWire["readiness"]>,
): Readonly<TodoReadiness> {
  return value.status === "ready"
    ? Object.freeze({ status: "ready" as const })
    : Object.freeze({
      status: "parked" as const,
      trigger: parseCanonicalText(value.trigger, "$/readiness/trigger"),
    });
}

function parseTestingDecision(
  value: Readonly<TodoIntakeWire["testingDecision"]>,
): Readonly<TodoTestingDecision> {
  return Object.freeze({
    mode: value.mode,
    summary: parseCanonicalText(value.summary, "$/testingDecision/summary"),
    environmentMemberRef: parseEnvironmentMemberRef(
      value.environmentMemberRef,
    ),
  });
}

function referenceKey(
  reference: Readonly<LedgerAuthorityMemberReference>,
): string {
  return reference.memberRef;
}

function parseAuthorityReference(
  value: unknown,
  path: string,
): Readonly<LedgerAuthorityMemberReference> {
  try {
    return parseLedgerAuthorityMemberReference(value);
  } catch (error: unknown) {
    if (error instanceof LedgerAuthorityStoreError) fail("authority", path);
    throw error;
  }
}

function freezeCanonicalAuthorityRefs(
  parsed: readonly Readonly<LedgerAuthorityMemberReference>[],
): TodoIntake["authorityRefs"] {
  const first = parsed[0];
  if (first === undefined) fail("authority", "$/authorityRefs");
  const refs: [
    Readonly<LedgerAuthorityMemberReference>,
    ...Readonly<LedgerAuthorityMemberReference>[],
  ] = [first];
  refs.push(...parsed.slice(1));
  for (let index = 1; index < refs.length; index += 1) {
    const previous = refs[index - 1];
    const current = refs[index];
    if (
      previous === undefined
      || current === undefined
      || referenceKey(previous) >= referenceKey(current)
    ) {
      fail("authority", `$/authorityRefs/${index}`);
    }
  }
  return Object.freeze(refs);
}

function parseAuthorityRefs(
  values: readonly TodoIntakeWire["authorityRefs"][number][],
): TodoIntake["authorityRefs"] {
  return freezeCanonicalAuthorityRefs(values.map((value, index) =>
    parseAuthorityReference(value, `$/authorityRefs/${index}`)));
}

function parseDraftAuthorityRefs(value: unknown): TodoIntake["authorityRefs"] {
  let values: readonly unknown[];
  try {
    values = parseDenseArray(value, 32, "$/authorityRefs");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$/authorityRefs");
    throw error;
  }
  const parsed = values.map((entry, index) =>
    parseAuthorityReference(entry, `$/authorityRefs/${index}`));
  return freezeCanonicalAuthorityRefs(
    parsed.sort((left, right) => {
      const leftKey = referenceKey(left);
      const rightKey = referenceKey(right);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    }),
  );
}

function assertRelations(intake: Readonly<TodoIntake>): void {
  if (intake.readiness.status === "parked" && intake.autoClaim) {
    fail("readiness", "$/autoClaim");
  }
  if (
    intake.demandType === "research"
      ? intake.testingDecision.mode !== "not-applicable"
      : intake.testingDecision.mode === "not-applicable"
  ) {
    fail("testing-decision", "$/testingDecision/mode");
  }
  const roles = new Set<string>(
    intake.authorityRefs.map((reference) => reference.role),
  );
  for (const role of REQUIRED_AUTHORITY_ROLES[intake.demandType]) {
    if (!roles.has(role)) fail("authority", "$/authorityRefs");
  }
  const environmentRefs = intake.authorityRefs.filter(
    (reference) => reference.role === "test-environment",
  );
  if (intake.testingDecision.mode === "real-environment") {
    if (
      intake.testingDecision.environmentMemberRef === null
      || environmentRefs.length !== 1
      || environmentRefs[0]?.memberRef
        !== intake.testingDecision.environmentMemberRef
    ) {
      fail("testing-decision", "$/testingDecision/environmentMemberRef");
    }
  } else if (intake.testingDecision.environmentMemberRef !== null) {
    fail("testing-decision", "$/testingDecision/environmentMemberRef");
  }
}

function normalizeWire(wire: Readonly<TodoIntakeWire>): Readonly<TodoIntake> {
  let todoId: TodoItemId;
  try {
    todoId = parseTodoItemId(wire.todoId, "$/todoId");
  } catch (error: unknown) {
    if (error instanceof TodoItemIdError) fail("identifier", "$/todoId");
    throw error;
  }
  const intake = Object.freeze({
    artifactKind: TODO_INTAKE_ARTIFACT_KIND,
    schemaVersion: TODO_INTAKE_SCHEMA_VERSION,
    programId: parseDurableId(wire.programId, "program", "$/programId"),
    todoId,
    createdAt: parseCreatedAt(wire.createdAt),
    demandType: wire.demandType,
    priority: wire.priority,
    originWindowId: parseDurableId(
      wire.originWindowId,
      "window",
      "$/originWindowId",
    ),
    controllerWindowId: parseDurableId(
      wire.controllerWindowId,
      "window",
      "$/controllerWindowId",
    ),
    summary: parseCanonicalText(wire.summary, "$/summary"),
    intakeRationale: parseCanonicalText(
      wire.intakeRationale,
      "$/intakeRationale",
    ),
    readiness: parseReadiness(wire.readiness),
    autoClaim: wire.autoClaim,
    testingDecision: parseTestingDecision(wire.testingDecision),
    authorityRefs: parseAuthorityRefs(wire.authorityRefs),
  });
  assertRelations(intake);
  return intake;
}

/** 将任意内存值解析为不可变的 TODO Intake 领域模型。 */
export function parseTodoIntake(value: unknown): Readonly<TodoIntake> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$intake");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    throw error;
  }
  const result = validateWireIntake(json);
  if (!result.ok) fail("schema", result.path);
  return normalizeWire(result.value);
}

/** 从不含时间和协议头的纯数据草稿创建规范化接收记录。 */
export function createTodoIntake(
  draft: unknown,
  options: CreateTodoIntakeOptions = {},
): Readonly<TodoIntake> {
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
  let optionRecord: Readonly<Record<string, unknown>>;
  try {
    optionRecord = parsePlainRecord(options, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (Object.keys(optionRecord).some((key) => key !== "clock")) {
    fail("input", "$options");
  }
  const clock = optionRecord.clock as UtcWallClock | undefined;
  const admitted = parseTodoIntake({
    artifactKind: TODO_INTAKE_ARTIFACT_KIND,
    schemaVersion: TODO_INTAKE_SCHEMA_VERSION,
    programId: record.programId,
    todoId: record.todoId,
    createdAt: DRAFT_VALIDATION_INSTANT,
    demandType: record.demandType,
    priority: record.priority,
    originWindowId: record.originWindowId,
    controllerWindowId: record.controllerWindowId,
    summary: record.summary,
    intakeRationale: record.intakeRationale,
    readiness: record.readiness,
    autoClaim: record.autoClaim,
    testingDecision: record.testingDecision,
    authorityRefs: parseDraftAuthorityRefs(record.authorityRefs),
  });
  let createdAt: UtcInstant;
  try {
    createdAt = readUtcWallClock(clock);
  } catch (error: unknown) {
    if (error instanceof UtcWallClockError) fail("time", "$options.clock");
    throw error;
  }
  return Object.freeze({ ...admitted, createdAt });
}

/** 渲染具有唯一字段顺序的确定性美化JSON字节。 */
export function renderTodoIntake(intake: unknown): string {
  return renderDeterministicJsonDocument(parseTodoIntake(intake), "$intake");
}

/** 解析磁盘文档，并拒绝领域字段顺序或格式化表示漂移。 */
export function parseTodoIntakeDocument(text: unknown): Readonly<TodoIntake> {
  let json: JsonValue;
  try {
    json = parseDeterministicJsonDocument(text, "$intake");
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      fail("representation", error.path);
    }
    throw error;
  }
  const intake = parseTodoIntake(json);
  if (renderTodoIntake(intake) !== text) fail("representation", "$intake");
  return intake;
}

/** 计算 Intake 的 Canonical JSON 语义摘要，不绑定格式化字节。 */
export function computeTodoIntakeDigest(intake: unknown): Sha256Digest {
  return computeCanonicalJsonSha256Digest(parseTodoIntake(intake));
}
