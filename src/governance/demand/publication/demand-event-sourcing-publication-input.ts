import {
  parseWakeflowDurableId,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../../contracts/identity/wakeflow-durable-id.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../../foundation/data/passive-own-data.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  type PortableResourcePath,
} from "../../../foundation/filesystem/portable-resource-path.js";
import {
  parseTodoItemId,
  TodoItemIdError,
  type TodoItemId,
} from "../../todo/todo-item-id.js";

/**
 * Wakeflow Governance / Demand Event Sourcing Publication：公共预览进入领域前的输入边界。
 *
 * 调用方只编写Demand的人类语义、选择TODO前序，并明确执行位置。完整Ledger成员集合只
 * 来自immutable TODO Intake；Program、Demand类型、测试决定、TODO lineage/CAS、摘要、时间和持久身份均由后续
 * Publication owner从当前权威派生。本模块不读取文件、不分配身份，也不创建发布事务。
 */

export type DemandEventSourcingPublicationAuthorityRecordId =
  WakeflowDurableId<"requirement"> | WakeflowDurableId<"confirmation">;

/** 指定一份Ledger不可变记录中的成员；role、摘要和media type不由调用方重复提交。 */
export interface DemandEventSourcingPublicationAuthorityMemberSelection {
  readonly recordId: DemandEventSourcingPublicationAuthorityRecordId;
  readonly memberPath: PortableResourcePath;
}

export type DemandEventSourcingPublicationExecutionPlacementSelection =
  | Readonly<{ readonly mode: "main" }>
  | Readonly<{
      readonly mode: "isolated";
      readonly authorizationMember: Readonly<DemandEventSourcingPublicationAuthorityMemberSelection>;
    }>;

/** 只包含调用方拥有的Demand Identity人类语义和位置选择。 */
export interface DemandEventSourcingPublicationAuthoredDemand {
  readonly title: string;
  readonly goal: string;
  readonly completionDefinition: string;
  readonly executionPlacement: DemandEventSourcingPublicationExecutionPlacementSelection;
}

export interface DemandEventSourcingPublicationPreviewRequest {
  readonly todoId: TodoItemId;
  readonly demand: Readonly<DemandEventSourcingPublicationAuthoredDemand>;
}

export type DemandEventSourcingPublicationInputErrorReason =
  "input" | "todo" | "identity" | "authority-selection" | "placement";

const ERROR_MESSAGES = {
  input: "Demand Event Sourcing publication input is invalid.",
  todo: "Demand Event Sourcing publication input contains an invalid TODO identity.",
  identity: "Demand Event Sourcing publication authored identity is invalid.",
  "authority-selection":
    "Demand Event Sourcing publication authority member selection is invalid.",
  placement:
    "Demand Event Sourcing publication execution placement selection is invalid.",
} as const satisfies Readonly<
  Record<DemandEventSourcingPublicationInputErrorReason, string>
>;

/** Publication预览输入无法建立关闭、被动且一致的调用方意图时返回的稳定错误。 */
export class DemandEventSourcingPublicationInputError extends Error {
  override readonly name = "DemandEventSourcingPublicationInputError";
  readonly code = "wakeflow-demand-event-sourcing-publication-input" as const;
  readonly reason: DemandEventSourcingPublicationInputErrorReason;
  readonly path: string;

  constructor(
    reason: DemandEventSourcingPublicationInputErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const REQUEST_FIELDS = Object.freeze([
  "demand",
  "todoId",
] as const);
const AUTHORED_DEMAND_FIELDS = Object.freeze([
  "completionDefinition",
  "executionPlacement",
  "goal",
  "title",
] as const);
const AUTHORITY_MEMBER_FIELDS = Object.freeze([
  "memberPath",
  "recordId",
] as const);
const MAIN_PLACEMENT_FIELDS = Object.freeze(["mode"] as const);
const ISOLATED_PLACEMENT_FIELDS = Object.freeze([
  "authorizationMember",
  "mode",
] as const);
const MAXIMUM_IDENTITY_TEXT_LENGTH = 16_384;
const CONTROL_EXCEPT_LF_PATTERN =
  /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;

function fail(
  reason: DemandEventSourcingPublicationInputErrorReason,
  path: string,
): never {
  throw new DemandEventSourcingPublicationInputError(reason, path);
}

function exactRecord(
  value: unknown,
  fields: readonly string[],
  path: string,
  reason: DemandEventSourcingPublicationInputErrorReason,
): Readonly<Record<string, unknown>> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail(reason, path);
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== fields.length ||
    keys.some((key, index) => key !== fields[index])
  ) {
    fail(reason, path);
  }
  return record;
}

function parseIdentityText(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAXIMUM_IDENTITY_TEXT_LENGTH ||
    !value.isWellFormed() ||
    value.normalize("NFC") !== value ||
    value.trim() !== value ||
    CONTROL_EXCEPT_LF_PATTERN.test(value)
  ) {
    fail("identity", path);
  }
  return value;
}

function parseAuthorityRecordId(
  value: unknown,
  path: string,
): DemandEventSourcingPublicationAuthorityRecordId {
  let parsed;
  try {
    parsed = parseWakeflowDurableId(value, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) {
      fail("authority-selection", path);
    }
    throw error;
  }
  if (parsed.kind !== "requirement" && parsed.kind !== "confirmation") {
    fail("authority-selection", path);
  }
  return parsed.value;
}

function parseAuthorityMember(
  value: unknown,
  path: string,
): Readonly<DemandEventSourcingPublicationAuthorityMemberSelection> {
  const record = exactRecord(
    value,
    AUTHORITY_MEMBER_FIELDS,
    path,
    "authority-selection",
  );
  let memberPath: PortableResourcePath;
  try {
    memberPath = parsePortableResourcePath(
      record.memberPath,
      `${path}/memberPath`,
    );
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) {
      fail("authority-selection", `${path}/memberPath`);
    }
    throw error;
  }
  if (
    memberPath.toLowerCase() === "record.json" ||
    memberPath.toLowerCase().startsWith("record.json/")
  ) {
    fail("authority-selection", `${path}/memberPath`);
  }
  return Object.freeze({
    recordId: parseAuthorityRecordId(record.recordId, `${path}/recordId`),
    memberPath,
  });
}

function parseExecutionPlacement(
  value: unknown,
): DemandEventSourcingPublicationExecutionPlacementSelection {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$/demand/executionPlacement");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      fail("placement", "$/demand/executionPlacement");
    }
    throw error;
  }
  if (record.mode === "main") {
    exactRecord(
      record,
      MAIN_PLACEMENT_FIELDS,
      "$/demand/executionPlacement",
      "placement",
    );
    return Object.freeze({ mode: "main" as const });
  }
  if (record.mode !== "isolated") {
    fail("placement", "$/demand/executionPlacement/mode");
  }
  exactRecord(
    record,
    ISOLATED_PLACEMENT_FIELDS,
    "$/demand/executionPlacement",
    "placement",
  );
  const authorizationMember = parseAuthorityMember(
    record.authorizationMember,
    "$/demand/executionPlacement/authorizationMember",
  );
  if (
    !authorizationMember.recordId.startsWith("confirmation_")
  ) {
    fail("placement", "$/demand/executionPlacement/authorizationMember");
  }
  return Object.freeze({
    mode: "isolated" as const,
    authorizationMember,
  });
}

function parseAuthoredDemand(
  value: unknown,
): Readonly<DemandEventSourcingPublicationAuthoredDemand> {
  const record = exactRecord(
    value,
    AUTHORED_DEMAND_FIELDS,
    "$/demand",
    "identity",
  );
  return Object.freeze({
    title: parseIdentityText(record.title, "$/demand/title"),
    goal: parseIdentityText(record.goal, "$/demand/goal"),
    completionDefinition: parseIdentityText(
      record.completionDefinition,
      "$/demand/completionDefinition",
    ),
    executionPlacement: parseExecutionPlacement(record.executionPlacement),
  });
}

/** 解析并递归冻结一次零文件副作用的Demand Publication预览请求。 */
export function parseDemandEventSourcingPublicationPreviewRequest(
  value: unknown,
): Readonly<DemandEventSourcingPublicationPreviewRequest> {
  const record = exactRecord(value, REQUEST_FIELDS, "$request", "input");
  let todoId: TodoItemId;
  try {
    todoId = parseTodoItemId(record.todoId, "$/todoId");
  } catch (error: unknown) {
    if (error instanceof TodoItemIdError) fail("todo", "$/todoId");
    throw error;
  }
  return Object.freeze({
    todoId,
    demand: parseAuthoredDemand(record.demand),
  });
}
