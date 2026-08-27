import type {
  DocumentReference as TodoDocumentReferenceWire,
  WakeflowTodoIntake as TodoIntakeWire,
} from "../../contracts/generated/governance/todo/todo-intake.generated.js";
import { WAKEFLOW_TODO_INTAKE_SCHEMA } from "../../contracts/generated/governance/todo/todo-intake.generated.js";
import { WAKEFLOW_TODO_ITEM_ID_SCHEMA } from "../../contracts/generated/governance/todo/todo-item-id.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
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
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../foundation/identity/wakeflow-durable-id.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import {
  parseUtcInstant,
  UtcInstantError,
  type UtcInstant,
} from "../../foundation/time/utc-instant.js";
import {
  readUtcWallClock,
  type UtcWallClock,
} from "../../foundation/time/wall-clock.js";
import {
  parseTodoItemId,
  TodoItemIdError,
  type TodoItemId,
} from "./todo-item-id.js";

/**
 * Wakeflow Governance / TODO：创建后不可变的 TODO Intake 权威记录编解码器。
 *
 * 接收记录保存来源意图、职责、测试决定和文档引用；当前状态、Demand 挂载、修订号和
 * 归档回执明确属于 `TodoState`。Schema 限制可移植结构，本模块补充类型化窗口 ID、
 * Unicode、测试模式与类型关系、文档唯一性、固定字段顺序、确定性格式化字节和
 * Canonical JSON 语义摘要。
 */

export const TODO_INTAKE_ARTIFACT_KIND = "wakeflow-todo-intake" as const;
export const TODO_INTAKE_SCHEMA_VERSION = 1 as const;

export type TodoIntakeInitialStatus = "pending-claim" | "parked";
export type TodoIntakeType = "requirement" | "bug" | "supplement" | "research";
export type TodoIntakePriority = "P0" | "P1" | "P2" | "P3";
export type TodoTestingDecisionMode =
  | "controller-only"
  | "real-environment"
  | "not-applicable";

export interface TodoDocumentReference {
  readonly label: string;
  readonly ref: PortableResourcePath;
  readonly anchor: string | null;
}

export interface TodoTestingDecision {
  readonly mode: TodoTestingDecisionMode;
  readonly summary: string;
}

export interface TodoIntake {
  readonly artifactKind: typeof TODO_INTAKE_ARTIFACT_KIND;
  readonly schemaVersion: typeof TODO_INTAKE_SCHEMA_VERSION;
  readonly todoId: TodoItemId;
  readonly createdAt: UtcInstant;
  readonly initialStatus: TodoIntakeInitialStatus;
  readonly type: TodoIntakeType;
  readonly priority: TodoIntakePriority;
  readonly ownerWindowId: WakeflowDurableId<"window">;
  readonly goal: string;
  readonly affectsRetestOrDispatch: boolean;
  readonly dependency: string | null;
  readonly recommendedWindowId: WakeflowDurableId<"window">;
  readonly autoClaim: boolean;
  readonly testingDecision: Readonly<TodoTestingDecision>;
  readonly documents: readonly [
    Readonly<TodoDocumentReference>,
    ...Readonly<TodoDocumentReference>[],
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
  | "testing-decision"
  | "documents"
  | "representation";

const ERROR_MESSAGES = {
  "input": "TODO intake input is invalid.",
  "json": "TODO intake is not passive JSON data.",
  "schema": "TODO intake does not satisfy its portable Schema.",
  "identifier": "TODO intake contains an invalid typed identifier.",
  "time": "TODO intake contains an invalid creation time.",
  "text": "TODO intake contains non-canonical text.",
  "testing-decision": "TODO intake testing decision is inconsistent with its type.",
  "documents": "TODO intake document references are inconsistent.",
  "representation": "TODO intake bytes are not its deterministic domain representation.",
} as const satisfies Readonly<Record<TodoIntakeErrorReason, string>>;

/** TODO Intake 准入、关系或持久化表示验证失败时返回的稳定、脱敏错误。 */
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
    WAKEFLOW_UTC_INSTANT_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
  ],
);

const CONTROL_EXCEPT_LF_PATTERN = /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;
const DRAFT_FIELDS = Object.freeze([
  "affectsRetestOrDispatch",
  "autoClaim",
  "dependency",
  "documents",
  "goal",
  "initialStatus",
  "ownerWindowId",
  "priority",
  "recommendedWindowId",
  "testingDecision",
  "todoId",
  "type",
] as const);

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

function parseWindowId(
  value: string,
  path: string,
): WakeflowDurableId<"window"> {
  try {
    return parseWakeflowDurableIdOfKind(value, "window", path);
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

function parseTestingDecision(
  wire: Readonly<TodoIntakeWire>,
): Readonly<TodoTestingDecision> {
  const decision = Object.freeze({
    mode: wire.testingDecision.mode,
    summary: parseCanonicalText(
      wire.testingDecision.summary,
      "$/testingDecision/summary",
    ),
  });
  if (
    (wire.type === "research" && decision.mode !== "not-applicable")
    || (wire.type !== "research" && decision.mode === "not-applicable")
  ) {
    fail("testing-decision", "$/testingDecision/mode");
  }
  return decision;
}

function parseDocuments(
  values: readonly TodoDocumentReferenceWire[],
): TodoIntake["documents"] {
  const documents: Readonly<TodoDocumentReference>[] = [];
  const labels = new Set<string>();
  const targets = new Set<string>();
  for (const [index, value] of values.entries()) {
    const path = `$/documents/${index}`;
    const label = parseCanonicalText(value.label, `${path}/label`);
    let ref: PortableResourcePath;
    try {
      ref = parsePortableResourcePath(value.ref, `${path}/ref`);
    } catch (error: unknown) {
      if (error instanceof PortableResourcePathError) {
        fail("documents", `${path}/ref`);
      }
      throw error;
    }
    const anchor = value.anchor === null
      ? null
      : parseCanonicalText(value.anchor, `${path}/anchor`);
    const target = `${ref}#${anchor ?? ""}`;
    if (labels.has(label) || targets.has(target)) {
      fail("documents", path);
    }
    labels.add(label);
    targets.add(target);
    documents.push(Object.freeze({ label, ref, anchor }));
  }
  if (documents.length === 0) fail("documents", "$/documents");
  return Object.freeze(documents) as TodoIntake["documents"];
}

function normalizeWire(wire: Readonly<TodoIntakeWire>): Readonly<TodoIntake> {
  let todoId: TodoItemId;
  try {
    todoId = parseTodoItemId(wire.todoId, "$/todoId");
  } catch (error: unknown) {
    if (error instanceof TodoItemIdError) fail("identifier", "$/todoId");
    throw error;
  }
  return Object.freeze({
    artifactKind: TODO_INTAKE_ARTIFACT_KIND,
    schemaVersion: TODO_INTAKE_SCHEMA_VERSION,
    todoId,
    createdAt: parseCreatedAt(wire.createdAt),
    initialStatus: wire.initialStatus,
    type: wire.type,
    priority: wire.priority,
    ownerWindowId: parseWindowId(wire.ownerWindowId, "$/ownerWindowId"),
    goal: parseCanonicalText(wire.goal, "$/goal"),
    affectsRetestOrDispatch: wire.affectsRetestOrDispatch,
    dependency: wire.dependency === null
      ? null
      : parseCanonicalText(wire.dependency, "$/dependency"),
    recommendedWindowId: parseWindowId(
      wire.recommendedWindowId,
      "$/recommendedWindowId",
    ),
    autoClaim: wire.autoClaim,
    testingDecision: parseTestingDecision(wire),
    documents: parseDocuments(wire.documents),
  });
}

/** 解析任意内存值为不可变 TODO intake 领域模型。 */
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
  return parseTodoIntake({
    artifactKind: TODO_INTAKE_ARTIFACT_KIND,
    schemaVersion: TODO_INTAKE_SCHEMA_VERSION,
    todoId: record.todoId,
    createdAt: readUtcWallClock(clock),
    initialStatus: record.initialStatus,
    type: record.type,
    priority: record.priority,
    ownerWindowId: record.ownerWindowId,
    goal: record.goal,
    affectsRetestOrDispatch: record.affectsRetestOrDispatch,
    dependency: record.dependency,
    recommendedWindowId: record.recommendedWindowId,
    autoClaim: record.autoClaim,
    testingDecision: record.testingDecision,
    documents: record.documents,
  });
}

/** 渲染具有唯一字段顺序的确定性美化 JSON 字节。 */
export function renderTodoIntake(intake: unknown): string {
  return renderDeterministicJsonDocument(parseTodoIntake(intake), "$intake");
}

/** 解析磁盘文档，并拒绝领域字段顺序或格式化表示发生漂移。 */
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
  return computeCanonicalJsonSha256Digest(
    parseTodoIntake(intake) as unknown as JsonValue,
  );
}
