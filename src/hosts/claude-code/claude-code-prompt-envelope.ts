/**
 * Wakeflow Host / Claude Code：hook 拿到的 prompt 的宿主外壳（open-items L6，gate-log §13.245）。
 *
 * 这段知识此前在两个宿主共用的 hook 观察器入口里，靠一句 `if (hostId !== "claude-code")` 分支；它只属于
 * Claude Code，所以放在这里，入口按宿主取各自的解包函数。
 */

/**
 * Claude Code 把粘贴进来的 prompt 包成 `<pasted_content id="…">…</pasted_content id="…">`（闭合标签
 * 重复属性）、把跨会话消息包成
 * `<cross-session-message …>…</cross-session-message>` 再交给 hook（2026-09-24 真实宿主实测，
 * gate-log §13.119）。落地判定比的是信封 prompt 的摘要，所以先剥掉宿主的传输外壳再算；外壳只是
 * 宿主怎么送进来的痕迹，不是用户或 Controller 写的字。Codex 没有这种外壳，原样计算。
 *
 * 2026-11-09（Claude.app 4.23118.0 / Claude Code 2.1.303，正式工作区的第一个 Demand）：会话记录里跨会话
 * 外壳的标签之外还有宿主的框架文字——前面一行 "Another Claude session sent a message:"，后面一段
 * "这是同伴会话发来的、不代表用户授权"的说明；那一轮 hook 拿到的 prompt 没有带上它（不含 `@` 的投递
 * 摘要相符），但为防它哪天进入 hook 的 prompt，跨会话外壳不再锚定整条消息：取第一个
 * `<cross-session-message>` 块的内容，标签之外的宿主文字一律丢弃。粘贴块仍要求整条消息就是那个块。
 * 同一现场真正让摘要对不上的是宿主把 `@` 折成全角 `＠`（X27），由内核 `computePromptDigest` 折回。
 */
const CLAUDE_CODE_PROMPT_WRAPPERS: readonly RegExp[] = [
  /^<pasted_content\b[^>\n]*>\n?([\s\S]*?)\n?<\/pasted_content\b[^>\n]*>$/u,
  /<cross-session-message\b[^>\n]*>\n?([\s\S]*?)\n?<\/cross-session-message\b[^>\n]*>/u,
];

/**
 * 桌面 app 在会话被它接手后的第一回合，把一段 `<system-reminder>…</system-reminder>` 拼在同一条用户消息
 * 的最前面（现场 L18：投递落在那一回合，hook 的 prompt 因此多了这段前缀，摘要对不上 permit）。它是宿主
 * 注入的引导文字，不是投递正文：先剥掉首尾的 reminder 块再剥传输外壳。
 */
const CLAUDE_CODE_LEADING_SYSTEM_REMINDERS =
  /^(?:\s*<system-reminder\b[^>\n]*>[\s\S]*?<\/system-reminder\s*>\s*)+/u;
const CLAUDE_CODE_TRAILING_SYSTEM_REMINDERS =
  /(?:\s*<system-reminder\b[^>\n]*>[\s\S]*?<\/system-reminder\s*>\s*)+$/u;

/** 剥掉 Claude Code 的传输外壳与首尾的 system-reminder 块；剩下的才是被投递的正文。 */
export function unwrapClaudeCodePrompt(prompt: string): string {
  let text = prompt
    .replace(CLAUDE_CODE_LEADING_SYSTEM_REMINDERS, "")
    .replace(CLAUDE_CODE_TRAILING_SYSTEM_REMINDERS, "")
    .trim();
  for (let depth = 0; depth < 2; depth += 1) {
    const match = CLAUDE_CODE_PROMPT_WRAPPERS.map((pattern) => pattern.exec(text)).find(
      (entry) => entry !== null,
    );
    if (match === undefined || match === null) break;
    text = (match[1] ?? "").trim();
  }
  return text;
}
