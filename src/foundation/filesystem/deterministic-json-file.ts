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
 * Wakeflow Foundation / Filesystem：确定性格式化 JSON 文件读取。
 *
 * 本模块组合 `StrictTextFile` 与 `DeterministicJsonDocument`，形成统一的磁盘表示：
 * 使用 2 个空格缩进、只含 LF 换行符，并恰好保留一个末尾 LF。读取结果同时包含
 * 完整源字节摘要和 RFC 8785 语义摘要；成功值是与输入容器解除引用关系并递归冻结的
 * `JsonValue`。
 *
 * 对象字段的领域顺序不属于本层。Config、TODO、Demand 等职责所有者必须从读取值
 * 重建自己的规范模型，再比较领域渲染结果与磁盘文本。本模块不执行 Schema 校验、
 * 类型化引用校验、文件系统节点策略、写入、比较并交换（CAS）或权威事实判断，也不
 * 新增另一套文件错误类型。
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
