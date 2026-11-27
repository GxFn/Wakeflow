import type { WakeflowGitObjectId as GitObjectIdWire } from "../../contracts/generated/foundation/git-object-id.generated.js";
import { WAKEFLOW_GIT_OBJECT_ID_SCHEMA } from "../../contracts/generated/foundation/git-object-id.generated.js";
import { JsonValueError, parseJsonValue } from "../data/json-value.js";
import { type Fail, failWith, ModuleError } from "../error/module-error.js";
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

export class GitObjectIdError extends ModuleError<GitObjectIdErrorReason> {
  static override readonly code = "wakeflow-git-object-id";
}

const validateWire = createRuntimeJsonSchemaValidator<GitObjectIdWire>(
  WAKEFLOW_GIT_OBJECT_ID_SCHEMA,
);

const fail: Fail<GitObjectIdErrorReason> = failWith(GitObjectIdError);

/** 严格解析一个带算法标签的完整Git object ID。 */
export function parseGitObjectId(value: unknown, path = "$gitObjectId"): Readonly<GitObjectId> {
  let json: ReturnType<typeof parseJsonValue>;
  try {
    json = parseJsonValue(value, path);
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("input", error.path, error);
    throw error;
  }
  const validated = validateWire(json);
  if (!validated.ok) fail("schema", validated.path);
  return Object.freeze({
    algorithm: validated.value.algorithm,
    value: validated.value.value,
  });
}
