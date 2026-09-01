import type { WakeflowGitObjectId as GitObjectIdWire } from "../../contracts/generated/foundation/git-object-id.generated.js";
import { WAKEFLOW_GIT_OBJECT_ID_SCHEMA } from "../../contracts/generated/foundation/git-object-id.generated.js";
import { JsonValueError, parseJsonValue } from "../data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../schema/runtime-json-schema.js";

/**
 * Wakeflow Foundation / Git：完整Git对象身份及其显式对象格式。
 *
 * Git仓库可使用SHA-1或SHA-256对象格式，因此不能用无算法标签的固定40位字符串作为长期
 * 合同。本模块只准入完整小写object ID；不执行rev解析、对象存在性、commit类型验证、
 * repository选择或Git进程调用。
 */

export type GitObjectId =
  | Readonly<{ readonly algorithm: "sha1"; readonly value: string }>
  | Readonly<{ readonly algorithm: "sha256"; readonly value: string }>;

export type GitObjectIdErrorReason = "input" | "schema";

const ERROR_MESSAGES = {
  input: "Git object ID is not passive JSON data.",
  schema: "Git object ID does not satisfy its complete object-format contract.",
} as const satisfies Readonly<Record<GitObjectIdErrorReason, string>>;

export class GitObjectIdError extends Error {
  override readonly name = "GitObjectIdError";
  readonly code = "wakeflow-git-object-id" as const;
  readonly reason: GitObjectIdErrorReason;
  readonly path: string;

  constructor(reason: GitObjectIdErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWire = createRuntimeJsonSchemaValidator<GitObjectIdWire>(
  WAKEFLOW_GIT_OBJECT_ID_SCHEMA,
);

function fail(reason: GitObjectIdErrorReason, path: string): never {
  throw new GitObjectIdError(reason, path);
}

/** 严格解析一个带算法标签的完整Git object ID。 */
export function parseGitObjectId(
  value: unknown,
  path = "$gitObjectId",
): Readonly<GitObjectId> {
  let json;
  try {
    json = parseJsonValue(value, path);
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("input", error.path);
    throw error;
  }
  const validated = validateWire(json);
  if (!validated.ok) fail("schema", validated.path);
  return Object.freeze({
    algorithm: validated.value.algorithm,
    value: validated.value.value,
  });
}

/** 比较两个已经重新准入的Git object ID。 */
export function sameGitObjectId(left: unknown, right: unknown): boolean {
  const admittedLeft = parseGitObjectId(left, "$left");
  const admittedRight = parseGitObjectId(right, "$right");
  return (
    admittedLeft.algorithm === admittedRight.algorithm &&
    admittedLeft.value === admittedRight.value
  );
}
