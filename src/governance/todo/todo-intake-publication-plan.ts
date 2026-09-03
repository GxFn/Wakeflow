import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
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
  parseTodoIntake,
  TodoIntakeError,
  type TodoIntake,
} from "./todo-intake.js";

/** Wakeflow Governance / TODO：Public Intake preview与Application共用的exact计划。 */

const TODO_INTAKE_PUBLICATION_PLAN_KIND =
  "WakeflowTodoIntakePublicationPlan" as const;
const TODO_INTAKE_PUBLICATION_PLAN_VERSION = 1 as const;

export interface TodoIntakePublicationPlan {
  readonly kind: typeof TODO_INTAKE_PUBLICATION_PLAN_KIND;
  readonly schemaVersion: typeof TODO_INTAKE_PUBLICATION_PLAN_VERSION;
  readonly configDigest: Sha256Digest;
  readonly expectedCollectionDigest: Sha256Digest;
  readonly targetIntake: Readonly<TodoIntake>;
}

export type TodoIntakePublicationPlanErrorReason =
  | "input"
  | "json"
  | "digest"
  | "intake";

const ERROR_MESSAGES = {
  input: "TODO intake publication plan input is invalid.",
  json: "TODO intake publication plan is not passive JSON data.",
  digest: "TODO intake publication plan contains an invalid digest.",
  intake: "TODO intake publication plan contains an invalid target Intake.",
} as const satisfies Readonly<Record<
  TodoIntakePublicationPlanErrorReason,
  string
>>;

/** exact Intake计划不能形成关闭、规范领域事实时的稳定错误。 */
export class TodoIntakePublicationPlanError extends Error {
  override readonly name = "TodoIntakePublicationPlanError";
  readonly code = "wakeflow-todo-intake-publication-plan" as const;
  readonly reason: TodoIntakePublicationPlanErrorReason;
  readonly path: string;

  constructor(reason: TodoIntakePublicationPlanErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const PLAN_FIELDS = Object.freeze([
  "configDigest",
  "expectedCollectionDigest",
  "kind",
  "schemaVersion",
  "targetIntake",
] as const);

function fail(
  reason: TodoIntakePublicationPlanErrorReason,
  path: string,
): never {
  throw new TodoIntakePublicationPlanError(reason, path);
}

function parseDigest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", path);
    throw error;
  }
}

function normalize(value: unknown): Readonly<TodoIntakePublicationPlan> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$plan");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$plan");
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== PLAN_FIELDS.length
    || keys.some((key, index) => key !== PLAN_FIELDS[index])
    || record.kind !== TODO_INTAKE_PUBLICATION_PLAN_KIND
    || record.schemaVersion !== TODO_INTAKE_PUBLICATION_PLAN_VERSION
  ) {
    fail("input", "$plan");
  }
  let targetIntake: Readonly<TodoIntake>;
  try {
    targetIntake = parseTodoIntake(record.targetIntake);
  } catch (error: unknown) {
    if (error instanceof TodoIntakeError) fail("intake", "$/targetIntake");
    throw error;
  }
  return Object.freeze({
    kind: TODO_INTAKE_PUBLICATION_PLAN_KIND,
    schemaVersion: TODO_INTAKE_PUBLICATION_PLAN_VERSION,
    configDigest: parseDigest(record.configDigest, "$/configDigest"),
    expectedCollectionDigest: parseDigest(
      record.expectedCollectionDigest,
      "$/expectedCollectionDigest",
    ),
    targetIntake,
  });
}

/** 从Planning已关闭的事实创建一份规范exact计划。 */
export function createTodoIntakePublicationPlan(
  value: Readonly<{
    readonly configDigest: Sha256Digest;
    readonly expectedCollectionDigest: Sha256Digest;
    readonly targetIntake: Readonly<TodoIntake>;
  }>,
): Readonly<TodoIntakePublicationPlan> {
  return normalize({
    kind: TODO_INTAKE_PUBLICATION_PLAN_KIND,
    schemaVersion: TODO_INTAKE_PUBLICATION_PLAN_VERSION,
    ...value,
  });
}

/** 把任意JSON值解析为规范化、递归冻结的exact计划。 */
export function parseTodoIntakePublicationPlan(
  value: unknown,
): Readonly<TodoIntakePublicationPlan> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$plan");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    throw error;
  }
  return normalize(json);
}

/** 计算exact计划的Canonical JSON语义摘要。 */
export function computeTodoIntakePublicationPlanDigest(
  value: unknown,
): Sha256Digest {
  return computeCanonicalJsonSha256Digest(
    parseTodoIntakePublicationPlan(value),
  );
}
