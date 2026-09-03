import {
  parseWakeflowDurableId,
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
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
import type {
  TodoDemandType,
  TodoPriority,
  TodoReadiness,
  TodoTestingDecisionMode,
} from "./todo-intake.js";

/**
 * Wakeflow Governance / TODO：公共Intake preview的author-owned输入边界。
 *
 * 调用方只描述排队语义、来源窗口、初始就绪策略、测试决定并选择Ledger成员。Program、
 * Controller窗口、完整Ledger refs、TODO ID、时间、摘要和Collection CAS均由Planning派生。
 */

export type TodoIntakePublicationAuthorityRecordId =
  | WakeflowDurableId<"requirement">
  | WakeflowDurableId<"confirmation">;

export interface TodoIntakePublicationAuthorityMemberSelection {
  readonly recordId: TodoIntakePublicationAuthorityRecordId;
  readonly memberPath: PortableResourcePath;
}

export interface TodoIntakePublicationTestingDecision {
  readonly mode: TodoTestingDecisionMode;
  readonly summary: string;
}

export interface TodoIntakePublicationInput {
  readonly demandType: TodoDemandType;
  readonly priority: TodoPriority;
  readonly originWindowId: WakeflowDurableId<"window">;
  readonly summary: string;
  readonly intakeRationale: string;
  readonly readiness: Readonly<TodoReadiness>;
  readonly autoClaim: boolean;
  readonly testingDecision: Readonly<TodoIntakePublicationTestingDecision>;
  readonly authorityMembers: readonly [
    Readonly<TodoIntakePublicationAuthorityMemberSelection>,
    ...Readonly<TodoIntakePublicationAuthorityMemberSelection>[],
  ];
}

export type TodoIntakePublicationInputErrorReason =
  | "input"
  | "identifier"
  | "text"
  | "readiness"
  | "testing-decision"
  | "authority-selection";

const ERROR_MESSAGES = {
  input: "TODO intake publication input is invalid.",
  identifier: "TODO intake publication input contains an invalid typed identifier.",
  text: "TODO intake publication input contains non-canonical text.",
  readiness: "TODO intake publication readiness and Auto Claim are inconsistent.",
  "testing-decision": "TODO intake publication testing decision is inconsistent.",
  "authority-selection": "TODO intake publication Ledger member selection is invalid.",
} as const satisfies Readonly<Record<
  TodoIntakePublicationInputErrorReason,
  string
>>;

/** author-owned Intake输入不能形成关闭、被动且一致的数据时的稳定错误。 */
export class TodoIntakePublicationInputError extends Error {
  override readonly name = "TodoIntakePublicationInputError";
  readonly code = "wakeflow-todo-intake-publication-input" as const;
  readonly reason: TodoIntakePublicationInputErrorReason;
  readonly path: string;

  constructor(reason: TodoIntakePublicationInputErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const INPUT_FIELDS = Object.freeze([
  "authorityMembers",
  "autoClaim",
  "demandType",
  "intakeRationale",
  "originWindowId",
  "priority",
  "readiness",
  "summary",
  "testingDecision",
] as const);
const MEMBER_FIELDS = Object.freeze(["memberPath", "recordId"] as const);
const READY_FIELDS = Object.freeze(["status"] as const);
const PARKED_FIELDS = Object.freeze(["status", "trigger"] as const);
const TESTING_FIELDS = Object.freeze(["mode", "summary"] as const);
const MAXIMUM_AUTHORITY_MEMBERS = 32;
const CONTROL_EXCEPT_LF_PATTERN =
  /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;

function fail(
  reason: TodoIntakePublicationInputErrorReason,
  path: string,
): never {
  throw new TodoIntakePublicationInputError(reason, path);
}

function exactRecord(
  value: unknown,
  fields: readonly string[],
  path: string,
  reason: TodoIntakePublicationInputErrorReason,
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
    keys.length !== fields.length
    || keys.some((key, index) => key !== fields[index])
  ) {
    fail(reason, path);
  }
  return record;
}

function canonicalText(
  value: unknown,
  maximumCodePoints: number,
  path: string,
): string {
  if (
    typeof value !== "string"
    || !value.isWellFormed()
    || value.normalize("NFC") !== value
    || CONTROL_EXCEPT_LF_PATTERN.test(value)
    || !/^(?!\s)[\s\S]*\S$/u.test(value)
    || Array.from(value).length > maximumCodePoints
  ) {
    fail("text", path);
  }
  return value;
}

function parseOriginWindowId(value: unknown): WakeflowDurableId<"window"> {
  try {
    return parseWakeflowDurableIdOfKind(
      value,
      "window",
      "$/originWindowId",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) {
      fail("identifier", "$/originWindowId");
    }
    throw error;
  }
}

function parseReadiness(value: unknown): Readonly<TodoReadiness> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$/readiness");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      fail("readiness", "$/readiness");
    }
    throw error;
  }
  if (record.status === "ready") {
    exactRecord(record, READY_FIELDS, "$/readiness", "readiness");
    return Object.freeze({ status: "ready" as const });
  }
  if (record.status !== "parked") {
    fail("readiness", "$/readiness/status");
  }
  exactRecord(record, PARKED_FIELDS, "$/readiness", "readiness");
  return Object.freeze({
    status: "parked" as const,
    trigger: canonicalText(record.trigger, 4096, "$/readiness/trigger"),
  });
}

function parseTestingDecision(
  value: unknown,
): Readonly<TodoIntakePublicationTestingDecision> {
  const record = exactRecord(
    value,
    TESTING_FIELDS,
    "$/testingDecision",
    "testing-decision",
  );
  if (
    record.mode !== "controller-only"
    && record.mode !== "real-environment"
    && record.mode !== "not-applicable"
  ) {
    fail("testing-decision", "$/testingDecision/mode");
  }
  return Object.freeze({
    mode: record.mode,
    summary: canonicalText(
      record.summary,
      4096,
      "$/testingDecision/summary",
    ),
  });
}

function parseRecordId(
  value: unknown,
  path: string,
): TodoIntakePublicationAuthorityRecordId {
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

function parseMember(
  value: unknown,
  path: string,
): Readonly<TodoIntakePublicationAuthorityMemberSelection> {
  const record = exactRecord(
    value,
    MEMBER_FIELDS,
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
    memberPath.toLowerCase() === "record.json"
    || memberPath.toLowerCase().startsWith("record.json/")
  ) {
    fail("authority-selection", `${path}/memberPath`);
  }
  return Object.freeze({
    recordId: parseRecordId(record.recordId, `${path}/recordId`),
    memberPath,
  });
}

function memberKey(
  value: Readonly<TodoIntakePublicationAuthorityMemberSelection>,
): string {
  return `${value.recordId}\u0000${value.memberPath}`;
}

function parseMembers(
  value: unknown,
): TodoIntakePublicationInput["authorityMembers"] {
  let entries: readonly unknown[];
  try {
    entries = parseDenseArray(
      value,
      MAXIMUM_AUTHORITY_MEMBERS,
      "$/authorityMembers",
    );
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      fail("authority-selection", "$/authorityMembers");
    }
    throw error;
  }
  if (entries.length === 0) {
    fail("authority-selection", "$/authorityMembers");
  }
  const members = entries.map((entry, index) =>
    parseMember(entry, `$/authorityMembers/${index}`));
  members.sort((left, right) => {
    const leftKey = memberKey(left);
    const rightKey = memberKey(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  for (let index = 1; index < members.length; index += 1) {
    if (memberKey(members[index - 1]!) === memberKey(members[index]!)) {
      fail("authority-selection", `$/authorityMembers/${index}`);
    }
  }
  const first = members[0];
  if (first === undefined) fail("authority-selection", "$/authorityMembers");
  return Object.freeze([first, ...members.slice(1)]);
}

/** 解析并递归冻结一次零副作用TODO Intake预览输入。 */
export function parseTodoIntakePublicationInput(
  value: unknown,
): Readonly<TodoIntakePublicationInput> {
  const record = exactRecord(value, INPUT_FIELDS, "$request", "input");
  if (
    record.demandType !== "requirement"
    && record.demandType !== "bug"
    && record.demandType !== "supplement"
    && record.demandType !== "research"
  ) {
    fail("input", "$/demandType");
  }
  if (
    record.priority !== "P0"
    && record.priority !== "P1"
    && record.priority !== "P2"
    && record.priority !== "P3"
  ) {
    fail("input", "$/priority");
  }
  if (typeof record.autoClaim !== "boolean") {
    fail("readiness", "$/autoClaim");
  }
  const readiness = parseReadiness(record.readiness);
  if (readiness.status === "parked" && record.autoClaim) {
    fail("readiness", "$/autoClaim");
  }
  const testingDecision = parseTestingDecision(record.testingDecision);
  if (
    record.demandType === "research"
      ? testingDecision.mode !== "not-applicable"
      : testingDecision.mode === "not-applicable"
  ) {
    fail("testing-decision", "$/testingDecision/mode");
  }
  return Object.freeze({
    demandType: record.demandType,
    priority: record.priority,
    originWindowId: parseOriginWindowId(record.originWindowId),
    summary: canonicalText(record.summary, 8192, "$/summary"),
    intakeRationale: canonicalText(
      record.intakeRationale,
      8192,
      "$/intakeRationale",
    ),
    readiness,
    autoClaim: record.autoClaim,
    testingDecision,
    authorityMembers: parseMembers(record.authorityMembers),
  });
}
