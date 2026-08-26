import { computeCanonicalJsonSha256Digest } from "../crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../crypto/sha256.js";
import {
  parseDeterministicJsonDocument,
} from "../data/deterministic-json-document.js";
import type { JsonValue } from "../data/json-value.js";
import type { ByteCount } from "../numeric/byte-count.js";
import type { FileNodeSnapshot } from "./file-node-snapshot.js";
import type { PortableResourcePath } from "./portable-resource-path.js";
import type { RootedDirectory } from "./rooted-directory.js";
import {
  readStrictTextFile,
  type StrictTextFileResult,
} from "./strict-text-file.js";

/**
 * Wakeflow Foundation / Filesystem：确定性 pretty JSON 文件读取。
 *
 * 本文件把 StrictTextFile 与 DeterministicJsonDocument 组合为统一磁盘表示：
 * 2 空格缩进、LF-only、恰好一个末尾 LF，并返回完整 bytes source digest 与 RFC 8785
 * semantic digest。成功 value 是解除别名、递归冻结的 JsonValue。
 *
 * 对象字段的领域顺序不属于本层。Config、TODO、Demand 等 owner 必须从 value 重建
 * 自己的规范模型，再把领域 renderer 与 text 比较。本文件不执行 Schema、typed ref、
 * node policy、写入、CAS 或 authority 判断，也不新增第四套文件错误类型。
 */

export interface DeterministicJsonFileOptions {
  readonly maximumBytes: ByteCount;
  readonly expectedNode?: Readonly<FileNodeSnapshot>;
  readonly signal?: AbortSignal;
}

export interface DeterministicJsonFileResult extends StrictTextFileResult {
  readonly value: JsonValue;
  readonly semanticDigest: Sha256Digest;
}

/** 稳定读取一个确定性 pretty JSON 文件并计算语义摘要。 */
export async function readDeterministicJsonFile(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  options: DeterministicJsonFileOptions,
): Promise<Readonly<DeterministicJsonFileResult>> {
  const strict = await readStrictTextFile(root, resourcePath, options);
  const value = parseDeterministicJsonDocument(strict.text, "$document");
  return Object.freeze({
    resourcePath: strict.resourcePath,
    node: strict.node,
    byteCount: strict.byteCount,
    digest: strict.digest,
    text: strict.text,
    value,
    semanticDigest: computeCanonicalJsonSha256Digest(value),
  });
}
