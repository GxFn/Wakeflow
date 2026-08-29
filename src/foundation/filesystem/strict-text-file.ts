import {
  decodeUtf8,
  Utf8Error,
} from "../text/utf8.js";
import type { PortableResourcePath } from "./portable-resource-path.js";
import type { RootedDirectory } from "./rooted-directory.js";
import {
  readStableFile,
  type StableFileReadOptions,
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

const ERROR_MESSAGES = {
  "utf8": "Strict text file must contain valid fatal UTF-8.",
  "bom": "Strict text file cannot begin with a UTF-8 BOM.",
  "line-endings": "Strict text file must use LF-only line endings.",
  "final-newline": "Strict text file must end with exactly one LF.",
  "empty": "Strict text file must contain non-empty logical content.",
  "unicode-normalization": "Strict text file source must use Unicode NFC.",
} as const satisfies Readonly<Record<StrictTextFileErrorReason, string>>;

/** 严格文本编码或固定文本形态失败时返回的稳定、脱敏错误。 */
export class StrictTextFileError extends Error {
  override readonly name = "StrictTextFileError";
  readonly code = "wakeflow-strict-text-file" as const;
  readonly reason: StrictTextFileErrorReason;
  readonly path: string;

  constructor(reason: StrictTextFileErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(reason: StrictTextFileErrorReason, path: string): never {
  throw new StrictTextFileError(reason, path);
}

function decodeStrictUtf8(bytes: Uint8Array): string {
  try {
    return decodeUtf8(bytes, "$text");
  } catch (error: unknown) {
    if (error instanceof Utf8Error) fail("utf8", "$text");
    throw error;
  }
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
  const stable = await readStableFile(root, resourcePath, options);
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
