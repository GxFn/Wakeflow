import { type Fail, failWith, ModuleError } from "../error/module-error.js";
import { decodeUtf8, Utf8Error } from "../text/utf8.js";
import type { PortableResourcePath } from "./portable-resource-path.js";
import type { RootedDirectory } from "./rooted-directory.js";
import {
  readStableFile,
  readStableFileOrNull,
  type StableFileReadOptions,
  type StableFileReadResult,
  type StableFileSource,
} from "./stable-file-read.js";

/**
 * Wakeflow Foundation / Filesystem：Wakeflow 自有严格 UTF-8 文本文件读取。
 *
 * 本模块组合 `StableFileRead` 与严格 UTF-8 解码，并执行固定的磁盘文本合同：不含
 * BOM、采用 NFC、只含 LF 换行符、恰好保留一个末尾 LF，并且末尾 LF 之前存在非空
 * 正文。它不提供保留、剥离或规范化等转换选项，也不解析 JSON、Markdown 或领域标记。
 *
 * 外部文本或混合所有权文本必须由后续受管文本职责所有者从稳定字节中解释，并保留
 * 非受管部分的原始表示；不能为了兼容外部格式而放宽本入口。路径、容量、预期节点、
 * 竞态、取消和节点类型错误继续使用 `StableFileReadError`。
 */

/** 一次严格文本读取结果；成功即证明固定文本 profile 全部成立。 */
export interface StrictTextFileResult extends StableFileSource {
  readonly text: string;
}

export type StrictTextFileErrorReason =
  | "utf8"
  | "bom"
  | "line-endings"
  | "final-newline"
  | "empty"
  | "unicode-normalization";

/** 严格文本编码或固定文本形态失败时返回的稳定、脱敏错误。 */
export class StrictTextFileError extends ModuleError<StrictTextFileErrorReason> {
  static override readonly code = "wakeflow-strict-text-file";
}

const fail: Fail<StrictTextFileErrorReason> = failWith(StrictTextFileError);

function decodeStrictUtf8(bytes: Uint8Array): string {
  try {
    return decodeUtf8(bytes, "$text");
  } catch (error: unknown) {
    if (error instanceof Utf8Error) fail("utf8", "$text", error);
    throw error;
  }
}

/**
 * 同一套严格文本规则用在已经在内存里的文本上（不经文件的生成文档）：非空、无 BOM、只有 LF、
 * 以换行结尾、已是 NFC。不合规则抛出与读文件相同的错误类。
 */
export function assertStrictTextContent(text: string): void {
  assertStrictText(text);
}

function assertStrictText(text: string): void {
  if (text.length === 0) fail("empty", "$text");
  if (text.startsWith("\ufeff")) fail("bom", "$text");
  if (text.includes("\r")) fail("line-endings", "$text");
  if (!text.endsWith("\n") || text.endsWith("\n\n")) {
    fail("final-newline", "$text");
  }
  if (text.length === 1) fail("empty", "$text");
  if (text.normalize("NFC") !== text) {
    fail("unicode-normalization", "$text");
  }
}

/** 稳定读取并验证一种固定的 Wakeflow 文本格式。 */
export async function readStrictTextFile(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  options: StableFileReadOptions,
): Promise<Readonly<StrictTextFileResult>> {
  return strictTextResult(await readStableFile(root, resourcePath, options));
}

/**
 * 与 `readStrictTextFile` 相同的读取，只是目标不在时返回 `null`（1.4.5）："不在"恰好是稳定读取抛出
 * `not-found` 的情形；其余失败，包括文本形态失败，照旧抛出同样的错误。
 */
export async function readStrictTextFileOrNull(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  options: StableFileReadOptions,
): Promise<Readonly<StrictTextFileResult> | null> {
  const stable = await readStableFileOrNull(root, resourcePath, options);
  return stable === null ? null : strictTextResult(stable);
}

function strictTextResult(stable: Readonly<StableFileReadResult>): Readonly<StrictTextFileResult> {
  const text = decodeStrictUtf8(stable.bytes);
  assertStrictText(text);
  return Object.freeze({
    resourcePath: stable.resourcePath,
    node: stable.node,
    byteCount: stable.byteCount,
    digest: stable.digest,
    text,
  });
}
