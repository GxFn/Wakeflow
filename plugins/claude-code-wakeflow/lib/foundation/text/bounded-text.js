/**
 * Wakeflow Foundation / Text：按码点截断。
 *
 * 持久字段与公开结果的长度上限按码点计（JSON Schema `maxLength`），公开结果 codec 又要求字符串
 * well-formed；按 UTF-16 码元 `slice` 会在 emoji 等代理对中间切开，留下 lone surrogate，让一份本来
 * 合法的输入在终态提交之后才被拒绝（Codex 审阅 S2、R-ROOT-05）。这里是仓库里唯一的截断实现：
 * 结果不超过 `maximumCodePoints` 个码点，超出时以省略号结尾（省略号自己占的码点计入上限），
 * 从不切开代理对，输入 well-formed 则输出 well-formed。
 */
export function truncateToCodePoints(text, maximumCodePoints, options = {}) {
    if (!Number.isSafeInteger(maximumCodePoints) || maximumCodePoints < 0)
        throw new RangeError("The code point maximum must be a non-negative safe integer.");
    const codePoints = Array.from(text);
    if (codePoints.length <= maximumCodePoints)
        return text;
    const ellipsis = Array.from(options.ellipsis ?? "…");
    const kept = Math.max(0, maximumCodePoints - ellipsis.length);
    return `${codePoints.slice(0, kept).join("")}${ellipsis.slice(0, maximumCodePoints).join("")}`;
}
