import { encodeCanonicalJson } from "../data/canonical-json.js";
import {
  computeSha256Digest,
  type Sha256Digest,
} from "./sha256.js";

/**
 * Wakeflow Foundation / Crypto：Canonical JSON 与 SHA-256 的纯组合层。
 *
 * 本模块只把 RFC 8785 UTF-8 字节交给已经验证的 SHA-256 基础函数。输入准入、
 * Canonical JSON 序列化、字节编码、摘要计算和错误合同仍分别归原模块负责；这里不
 * 增加第三种错误、不添加换行或领域分隔符，也不解释摘要的业务含义。
 */

/** 对任意输入计算 Canonical JSON UTF-8 字节的 `sha256:<hex>` 摘要。 */
export function computeCanonicalJsonSha256Digest(
  value: unknown,
  errorPath?: string,
): Sha256Digest {
  return computeSha256Digest(
    encodeCanonicalJson(value, errorPath),
    errorPath,
  );
}
