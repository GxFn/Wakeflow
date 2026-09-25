import type { JsonArray, JsonObject, JsonValue } from "../foundation/data/json-value.js";
import { fail } from "./error.js";

/**
 * Wakeflow Kernel / Redaction：公共输出的私有值边界（ADR-0013 决定 C，节点评估 C3）。
 *
 * 边界由一组"绝不能出现在公共输出里的字符串"构成：工作区根的词法路径与 realpath、
 * ledger 根、宿主运行时根、用户 home、全部已登记的宿主句柄值。扫描是纯函数，只看
 * 已准入的 JSON 值；命中只报告结构路径，从不回显命中的文本。
 */

const MINIMUM_PRIVATE_VALUE_LENGTH = 2;

export interface RedactionBoundary {
  readonly privateValues: ReadonlySet<string>;
}

/** 建立边界；短于两个字符的值被忽略，避免把 `/` 这样的值当作私有。 */
export function createRedactionBoundary(values: Iterable<string>): RedactionBoundary {
  const admitted = new Set<string>();
  for (const value of values) {
    if (typeof value === "string" && value.length >= MINIMUM_PRIVATE_VALUE_LENGTH) {
      admitted.add(value);
    }
  }
  return Object.freeze({ privateValues: admitted });
}

export function mergeRedactionBoundaries(
  ...boundaries: readonly RedactionBoundary[]
): RedactionBoundary {
  return createRedactionBoundary(boundaries.flatMap((boundary) => [...boundary.privateValues]));
}

function isJsonArray(value: JsonArray | JsonObject): value is JsonArray {
  return Array.isArray(value);
}

function findPrivateString(
  value: string,
  boundary: RedactionBoundary,
  path: string,
): string | null {
  for (const privateValue of boundary.privateValues) {
    if (value.includes(privateValue)) return path;
  }
  return null;
}

function findPrivateInArray(
  value: JsonArray,
  boundary: RedactionBoundary,
  path: string,
): string | null {
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (entry === undefined) continue;
    const hit = findPrivateText(entry, boundary, `${path}[${index}]`);
    if (hit !== null) return hit;
  }
  return null;
}

function findPrivateInObject(
  record: JsonObject,
  boundary: RedactionBoundary,
  path: string,
): string | null {
  for (const key of Object.keys(record)) {
    // 键本身含私有文本时只报告所在对象的路径，否则错误路径会回显私有值。
    const keyHit = findPrivateString(key, boundary, path);
    if (keyHit !== null) return keyHit;
    const entry = record[key];
    if (entry === undefined) continue;
    const hit = findPrivateText(entry, boundary, `${path}.${key}`);
    if (hit !== null) return hit;
  }
  return null;
}

function findPrivateText(
  value: JsonValue,
  boundary: RedactionBoundary,
  path: string,
): string | null {
  if (typeof value === "string") return findPrivateString(value, boundary, path);
  if (value === null || typeof value !== "object") return null;
  return isJsonArray(value)
    ? findPrivateInArray(value, boundary, path)
    : findPrivateInObject(value, boundary, path);
}

/** 返回第一个含私有值的结构路径，没有则返回 null。 */
export function locatePrivateText(
  value: JsonValue,
  boundary: RedactionBoundary,
  path = "$",
): string | null {
  return findPrivateText(value, boundary, path);
}

export function containsPrivateText(value: JsonValue, boundary: RedactionBoundary): boolean {
  return findPrivateText(value, boundary, "$") !== null;
}

/** 公共输出含私有值即以 `output-boundary` 失败，路径指向命中的结构位置。 */
export function assertPublicJson(value: JsonValue, boundary: RedactionBoundary, path = "$"): void {
  const hit = findPrivateText(value, boundary, path);
  if (hit !== null) {
    fail("output-boundary", "private-value", sanitizePath(hit));
  }
}

/** 请求里出现私有值即以 `privacy-violation` 失败。 */
export function assertRequestFreeOfPrivateText(
  value: JsonValue,
  boundary: RedactionBoundary,
  path = "$",
): void {
  const hit = findPrivateText(value, boundary, path);
  if (hit !== null) {
    fail("privacy-violation", "private-value", sanitizePath(hit));
  }
}

/** 结构路径里的对象键可能含任意字符；只保留 `WakeflowError.path` 允许的字符集。 */
function sanitizePath(path: string): string {
  const sanitized = path.replace(/[^A-Za-z0-9_.[\]$-]/gu, "_");
  return sanitized.length > 256 ? sanitized.slice(0, 256) : sanitized;
}
