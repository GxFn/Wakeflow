import { encodeCanonicalJson } from "../foundation/data/canonical-json.js";
import type { JsonValue } from "../foundation/data/json-value.js";
import { fail } from "./error.js";

/**
 * Wakeflow Kernel / Limits：全部结果与请求上限的唯一表（ADR-0013 决定 C 与节点评估 C3）。
 *
 * 每个上限以用途命名而不是以工具命名；一个工具只引用表里的名字，从不自定常量。
 * 字节上限按规范 JSON 编码后的字节数度量，字符上限按 UTF-16 码元数度量。
 */

export const WAKEFLOW_LIMITS = Object.freeze({
  /** 公共工具请求的规范 JSON 字节数。 */
  publicRequestBytes: 2 * 1024 * 1024,
  /**
   * 公共工具结果的规范 JSON 字节数。过渡值：现有效果型 preview 仍回显整份计划，
   * ADR-0004 的 planRef 在 L1 落地后降为 4 MiB。
   */
  publicResultBytes: 24 * 1024 * 1024,
  /** 效果型计划（preview 产物）的规范 JSON 字节数。 */
  planBytes: 16 * 1024 * 1024,
  /** 投递 prompt 与回调正文的字符数。 */
  promptCharacters: 65_536,
  /** 一条宿主 hook 观察记录的字节数。 */
  hookRecordBytes: 256 * 1024,
  /** 单个证据文件的字节数。 */
  evidenceFileBytes: 16 * 1024 * 1024,
  /** 一次证据记录的总字节数。 */
  evidenceTotalBytes: 32 * 1024 * 1024,
  /** 分页读取一页的最大条目数。 */
  listPageItems: 256,
} as const);

export type WakeflowLimitName = keyof typeof WAKEFLOW_LIMITS;

/** 度量一个已准入 JSON 值的规范编码字节数。 */
export function measureCanonicalBytes(value: JsonValue, path = "$"): number {
  return encodeCanonicalJson(value, path).byteLength;
}

/** 规范 JSON 字节数超过命名上限即以 `capacity-exceeded` 失败。 */
export function assertWithinByteLimit(
  value: JsonValue,
  limit: Extract<
    WakeflowLimitName,
    | "publicRequestBytes"
    | "publicResultBytes"
    | "planBytes"
    | "hookRecordBytes"
    | "evidenceFileBytes"
    | "evidenceTotalBytes"
  >,
  path = "$",
): void {
  if (measureCanonicalBytes(value, path) > WAKEFLOW_LIMITS[limit]) {
    fail("capacity-exceeded", limit.replace(/Bytes$/u, "-bytes"), path);
  }
}

/** 已编码的规范 JSON 文本超过字节上限即以 `output-boundary` 失败；用于公共边界。 */
export function assertCanonicalTextWithinLimit(
  text: string,
  limit: Extract<WakeflowLimitName, "publicRequestBytes" | "publicResultBytes">,
  path = "$",
): void {
  if (Buffer.byteLength(text, "utf8") > WAKEFLOW_LIMITS[limit]) {
    fail("output-boundary", limit.replace(/Bytes$/u, "-bytes"), path);
  }
}

/** 文本字符数超过命名上限即以 `capacity-exceeded` 失败。 */
export function assertWithinCharacterLimit(
  text: string,
  limit: Extract<WakeflowLimitName, "promptCharacters">,
  path = "$",
): void {
  if (text.length > WAKEFLOW_LIMITS[limit]) {
    fail("capacity-exceeded", "prompt-characters", path);
  }
}

/** 条目数超过命名上限即以 `capacity-exceeded` 失败。 */
export function assertWithinItemLimit(
  count: number,
  limit: Extract<WakeflowLimitName, "listPageItems">,
  path = "$",
): void {
  if (!Number.isSafeInteger(count) || count < 0) {
    fail("invalid-request", "count-not-integer", path);
  }
  if (count > WAKEFLOW_LIMITS[limit]) {
    fail("capacity-exceeded", "list-page-items", path);
  }
}
