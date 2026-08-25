import { encodeCanonicalJson } from "../data/canonical-json.js";
import {
  computeSha256Digest,
  computeSha256Hex,
  type Sha256Digest,
  type Sha256Hex,
} from "./sha256.js";

/**
 * Wakeflow Foundation / Crypto：canonical JSON 与 SHA-256 的纯组合层。
 *
 * 本文件只把 RFC 8785 UTF-8 字节交给已确认的 SHA-256 primitive。输入准入、
 * canonical 序列化、字节编码、摘要计算和错误合同仍分别归原模块所有；这里不
 * 增加第三种错误、不添加换行或领域分隔符，也不解释摘要的业务含义。
 */

/** 对任意输入计算 canonical JSON UTF-8 字节的完整 SHA-256 hex。 */
export function computeCanonicalJsonSha256Hex(
  value: unknown,
  errorPath?: string,
): Sha256Hex {
  return computeSha256Hex(
    encodeCanonicalJson(value, errorPath),
    errorPath,
  );
}

/** 对任意输入计算 canonical JSON UTF-8 字节的 `sha256:<hex>` 摘要。 */
export function computeCanonicalJsonSha256Digest(
  value: unknown,
  errorPath?: string,
): Sha256Digest {
  return computeSha256Digest(
    encodeCanonicalJson(value, errorPath),
    errorPath,
  );
}
