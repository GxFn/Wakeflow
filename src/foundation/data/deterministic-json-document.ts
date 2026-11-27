import { type Fail, failWith, ModuleError } from "../error/module-error.js";
import {
  hasPassiveJsonSerializationEnvironment,
  type JsonValue,
  JsonValueError,
  type JsonValueErrorReason,
  parseJsonValue,
} from "./json-value.js";

/**
 * Wakeflow Foundation / Data：确定性格式化 JSON 文档表示。
 *
 * 本模块把领域 owner 已按约定键顺序构造的 JSON 数据树渲染为使用 2 个空格缩进、
 * 只含 LF 换行符且末尾恰好保留一个 LF 的文本。反向解析会拒绝重复键，以及空白、
 * 缩进、换行符或数字表示发生漂移。输入先转换为 `JsonValue` 快照；进入原生
 * serializer 前还会验证数组原型环境，因此不会执行访问器、`toJSON` 或代理陷阱。
 *
 * 对象字段的领域顺序不属于本层。本层沿用 ECMAScript 自有键顺序：数组索引键按
 * 数值升序，其他字符串键按创建顺序；解析器只能证明文本对于当前键顺序具有唯一
 * 表示。Config、TODO、Demand 等职责所有者必须先把数据重建为各自的规范化模型，
 * 再比较磁盘文本与模型渲染结果。RFC 8785 Canonical JSON 继续独立负责语义摘要。
 */

export type DeterministicJsonDocumentErrorReason =
  | "input"
  | "json-syntax"
  | "non-deterministic"
  | "render-failure"
  | JsonValueErrorReason;

/** 确定性格式化 JSON 准入或渲染失败时返回的稳定、脱敏错误。 */
export class DeterministicJsonDocumentError extends ModuleError<DeterministicJsonDocumentErrorReason> {
  static override readonly code = "wakeflow-deterministic-json-document";
}

const fail: Fail<DeterministicJsonDocumentErrorReason> = failWith(DeterministicJsonDocumentError);

function assertNoInheritedArrayToJson(path: string): void {
  if (!hasPassiveJsonSerializationEnvironment()) fail("render-failure", path);
}

function normalizePath(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "$document";
}

function admitJsonValue(value: unknown, path: string): JsonValue {
  try {
    return parseJsonValue(value, path);
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail(error.reason, error.path);
    throw error;
  }
}

function renderAdmitted(value: JsonValue, path: string): string {
  assertNoInheritedArrayToJson(path);
  let rendered: string | undefined;
  try {
    rendered = JSON.stringify(value, null, 2);
  } catch {
    fail("render-failure", path);
  }
  if (typeof rendered !== "string") fail("render-failure", path);
  return `${rendered}\n`;
}

/**
 * 将任意无副作用 JSON 数据值渲染为确定性格式化文本。
 *
 * 调用方如果要求特定领域字段顺序，必须先传入按该顺序重建的模型。本函数不会根据
 * 字典序、Schema 的 `properties` 或历史输入顺序替调用方决定领域表示；最终键顺序
 * 仍遵循 ECMAScript 的自有键枚举规则。
 */
export function renderDeterministicJsonDocument(value: unknown, errorPath?: string): string {
  const path = normalizePath(errorPath);
  return renderAdmitted(admitJsonValue(value, path), path);
}

/**
 * 解析并验证确定性格式化 JSON 文本。
 *
 * 成功结果是与输入容器解除引用关系、递归冻结的 `JsonValue`。重复键会在重新渲染
 * 时消失，因此与其他表示漂移一样被拒绝；本函数不执行自动格式化或兼容修复。
 */
export function parseDeterministicJsonDocument(text: unknown, errorPath?: string): JsonValue {
  const path = normalizePath(errorPath);
  if (typeof text !== "string") fail("input", path);
  let decoded: unknown;
  try {
    decoded = JSON.parse(text) as unknown;
  } catch {
    fail("json-syntax", path);
  }
  const value = admitJsonValue(decoded, path);
  if (renderAdmitted(value, path) !== text) fail("non-deterministic", path);
  return value;
}
