import { computeSha256Digest, type Sha256Digest } from "../foundation/crypto/sha256.js";
import { encodeUtf8 } from "../foundation/text/utf8.js";

/**
 * Wakeflow Kernel：投递 prompt 的摘要规则（gate-log §13.97 D3）。
 *
 * 一条规则、两个消费者：投递信封与回调许可用它给出 `promptDigest`，宿主 hook 观察脚本用它
 * 给 `UserPromptSubmit` 的 `prompt` 算同一摘要，落地判定就是两者相等。规则是去除首尾空白后
 * 的 UTF-8 字节的 SHA-256；空或超过上限时这里给 null（观察脚本照写记录、摘要为 null），
 * 信封侧把 null 当作错误。住在内核是为了让观察脚本的闭包不进治理层。
 */

/** 投递 prompt 的字符上限：能力卡 6 的 65,536 进记录合同；渲染与摘要共用同一个上界。 */
export const DELIVERY_PROMPT_MAXIMUM_CHARACTERS = 65_536;

/** 去除首尾空白后的 UTF-8 字节的 SHA-256；空或超过上限为 null。 */
export function computePromptDigest(prompt: string): Sha256Digest | null {
  const trimmed = prompt.trim();
  if (trimmed.length === 0 || trimmed.length > DELIVERY_PROMPT_MAXIMUM_CHARACTERS) return null;
  return computeSha256Digest(encodeUtf8(trimmed, "$prompt"), "$prompt");
}
