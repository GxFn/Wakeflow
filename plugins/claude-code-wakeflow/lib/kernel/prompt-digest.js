import { computeSha256Digest } from "../foundation/crypto/sha256.js";
import { encodeUtf8 } from "../foundation/text/utf8.js";
/**
 * Wakeflow Kernel：投递 prompt 的摘要规则（gate-log §13.97 D3）。
 *
 * 一条规则、两个消费者：投递信封与回调许可用它给出 `promptDigest`，宿主 hook 观察脚本用它
 * 给 `UserPromptSubmit` 的 `prompt` 算同一摘要，落地判定就是两者相等。规则是去除首尾空白、把全角
 * `＠`（U+FF20）折回 `@` 之后的 UTF-8 字节的 SHA-256；空或超过上限时这里给 null（观察脚本照写记录、
 * 摘要为 null），信封侧把 null 当作错误。住在内核是为了让观察脚本的闭包不进治理层。
 *
 * 折回 `＠`：Claude 桌面 app 把跨会话消息里的每个 `@` 折成全角以阻止 @ 提及（2026-11-09 正式工作区
 * 首个 Demand，Claude.app 4.23118.0，X27）；两侧都先折再算，宿主折不折都相等，真写了 `＠` 的文本也
 * 不受影响。
 */
const HOST_FOLDED_AT_SIGN = /\uff20/gu;
/** 投递 prompt 的字符上限：能力卡 6 的 65,536 进记录合同；渲染与摘要共用同一个上界。 */
export const DELIVERY_PROMPT_MAXIMUM_CHARACTERS = 65_536;
/** 去除首尾空白、全角 `＠` 折回 `@` 后的 UTF-8 字节的 SHA-256；空或超过上限为 null。 */
export function computePromptDigest(prompt) {
    const trimmed = prompt.trim().replace(HOST_FOLDED_AT_SIGN, "@");
    if (trimmed.length === 0 || trimmed.length > DELIVERY_PROMPT_MAXIMUM_CHARACTERS)
        return null;
    return computeSha256Digest(encodeUtf8(trimmed, "$prompt"), "$prompt");
}
