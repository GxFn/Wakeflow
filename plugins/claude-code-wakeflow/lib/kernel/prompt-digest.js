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
/** 摘要所覆盖的文本：去除首尾空白、全角 `＠` 折回 `@`；空或超过上限为 null。 */
function digestedPromptText(prompt) {
    const text = prompt.trim().replace(HOST_FOLDED_AT_SIGN, "@");
    return text.length === 0 || text.length > DELIVERY_PROMPT_MAXIMUM_CHARACTERS ? null : text;
}
/** 去除首尾空白、全角 `＠` 折回 `@` 后的 UTF-8 字节的 SHA-256；空或超过上限为 null。 */
export function computePromptDigest(prompt) {
    const text = digestedPromptText(prompt);
    return text === null ? null : computeSha256Digest(encodeUtf8(text, "$prompt"), "$prompt");
}
/**
 * 摘要所覆盖文本的字符数（UTF-16 码元，与上限同一量纲）；空或超过上限为 null。它进 hook 记录
 * （ADR-0027 决定 2）：摘要对不上时，字符数相同说明是字符被替换，不同说明文本被增删。
 */
export function countPromptCharacters(prompt) {
    return digestedPromptText(prompt)?.length ?? null;
}
/**
 * 许可身份行（ADR-0027 决定 1）：投递与回调 prompt 的最后一行 `- permitId: <target-delivery 标识>`。
 * 按行精确匹配（先去掉行两端的空白），所以夹在一行中间的标识——例如单行 JSON 字面量里的不可信
 * 文本——不算；宿主把整段文本包进外壳或在前后加字都不影响它，把文本截断则它不在了。
 */
export const PROMPT_PERMIT_ID_LINE = /^- permitId: (target-delivery_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;
/** 一条 prompt 记录至多保留的许可标识数：正常是 1，上限只为记录有界。 */
export const PROMPT_PERMIT_IDS_MAXIMUM = 4;
/** 渲染一条许可身份行；投递与回调的 prompt 渲染器把它放在最后一行。 */
export function renderPromptPermitIdLine(permitId) {
    const line = `- permitId: ${permitId}`;
    if (!PROMPT_PERMIT_ID_LINE.test(line))
        throw new TypeError("permitId is not a target-delivery id");
    return line;
}
/** 按出现顺序抽出 prompt 里的许可标识，去重，至多 `PROMPT_PERMIT_IDS_MAXIMUM` 个。 */
export function extractPromptPermitIds(prompt) {
    const found = [];
    for (const line of prompt.split("\n")) {
        const match = PROMPT_PERMIT_ID_LINE.exec(line.trim());
        const id = match?.[1];
        if (id === undefined || found.includes(id))
            continue;
        found.push(id);
        if (found.length === PROMPT_PERMIT_IDS_MAXIMUM)
            break;
    }
    return Object.freeze(found);
}
/**
 * 在候选记录里找出这条许可的落地记录（ADR-0027 决定 3）：先找摘要相符的（文本完整），没有再找带着
 * 许可标识的（文本被宿主改动）。候选由调用方按会话与签发时间筛好；返回记录与匹配方式，没有即 null。
 */
export function findPromptLanding(records, permit) {
    const intact = records.find((record) => record.promptDigest === permit.promptDigest);
    if (intact !== undefined)
        return Object.freeze({ record: intact, match: "digest" });
    const altered = records.find((record) => record.promptPermitIds?.includes(permit.permitId));
    return altered === undefined
        ? null
        : Object.freeze({ record: altered, match: "identity" });
}
/** 一个值是不是许可标识的文法（hook 记录的 `promptPermitIds` 逐项核对）。 */
export function isPromptPermitId(value) {
    return typeof value === "string" && PROMPT_PERMIT_ID_LINE.test(`- permitId: ${value}`);
}
