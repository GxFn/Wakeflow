import { computeSha256Digest, type Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  type PortableResourcePath,
  parsePortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { hostRuntimeRootRef } from "../../kernel/layout.js";
import {
  CLAUDE_CODE_HELPER_BUILD_VALUES,
  renderClaudeCodeHelperAsset,
} from "./claude-code-helper-asset-template.js";
import {
  CLAUDE_CODE_DESKTOP_HELPER_TEMPLATE,
  CLAUDE_CODE_DESKTOP_HELPER_TOKENS,
} from "./generated/claude-code-desktop-helper.generated.js";

/**
 * Wakeflow Host / Claude Code：桌面会话传输的助手资产（ADR-0025 D4）。
 *
 * 与 tmux 助手同一发布机制与同一允许规则形状：装在工作区私有运行时目录里，Agent 用 `node` 调用，
 * stdout 恰好一行 JSON。发送、改名、归档由 Controller 直接用桌面会话工具完成，助手只做三步开窗、
 * 读会话清单与等待落地记录，永不 `claude rm`。Wakeflow 本身仍不 spawn 任何进程，落地仍只看 hook 记录。
 *
 * 子命令（都从工作区根以 `node .wakeflow-local/runtime/hosts/claude-code/operations/assets/desktop.mjs
 * <子命令>` 调用）：
 *
 * - `preflight`：node 与 claude 是否可用及其版本、伪终端包装 `script(1)` 是否在 PATH 上、桌面 app 是否在运行
 *   （进程表里的 `Claude.app/Contents/MacOS/Claude`）、本会话有没有自己的 session-start 记录（`sessionProven`，
 *   与 tmux 助手同义，§13.188）。
 * - `launch --window <windowId> [--wait N] [--wait-session-start N] [--force]`：stdin 是
 *   `wakeflow_register_window_binding` inspect 的结果（或其 `launchIntent`）。意图的执行种类是
 *   `claude-code-desktop`，参数里没有 `--session-id`（`--bg` 自己管会话 id，L17 E7）也没有 `--worktree`
 *   （由 app 认领的检出会被 `claude rm` 与归档删除，L17 E6）。三步（设计 §3.2）：
 *   (1) 在执行根运行 `claude --bg "<启动提示>" --name "<显示名>" <意图参数…> --allowedTools <角色的 MCP 规则>
 *   Bash(node <本助手绝对路径> *)`——prompt 紧跟 `--bg`、在一切变长参数之前（L17 E1 的教训；助手自检
 *   `prompt-position`），启动提示只要求首回合回复 ok；从 `--bg` 输出读回短 id，经 `claude agents --json --all`
 *   解析出完整会话 uuid，轮询到该行 `state` 为 done（failed / stopped 拒绝为 `launch-first-turn-failed`；超过
 *   `--wait` 秒拒绝为 `launch-first-turn-timeout` 并尽力 `claude stop`）；(2) `claude stop <短 id>`；
 *   (3) 伪终端 `script -q /dev/null claude --desktop --resume <uuid>`（`--desktop` 拒绝重定向输出），输出里
 *   没有 "Opening session" 或退出非零拒绝为 `desktop-resume-refused`，app 未运行 / 未登录为 `desktop-unavailable`；
 *   然后等该 uuid 一条新的 session-start 记录（默认 30 秒，等不到为 `desktop-session-start-missing`），打印
 *   登记用的 creation observation：`handle` 是 hook 的 session_id，`desktop.sessionId` 是桌面定位子 `local_<uuid>`。
 *   意图带 worktree（basePolicy local-head）时与 tmux 助手同样先在仓库主检出准备 `<root>/.claude/worktrees/<name>`
 *   （§13.130 H4 的同一套拒绝码），并以那条检出为 `--bg` 的 cwd；记录的 cwd 不是它时拒绝 `worktree-cwd-mismatch`，
 *   是它时把 `git worktree list --porcelain` 与 `--git-common-dir` 的原文附在 observation 里。
 *   定位器已指向一个仍在侧栏里的桌面会话时拒绝 `locator-live`（`--force` 跳过）。
 * - `trust --window <windowId> --user-agreed [--settle N]`（Q13，ADR-0025 D11）：stdin 同 launch。Claude Code 的信任
 *   不跨 Git 仓库边界继承（探针 E9），每个产品仓库要自己的信任记录；`launch` 在没有记录的目录里被拒为
 *   `not-trusted`。用户在引导会话里看过被拒目录的清单、听过信任的含义并同意之后，本子命令在该窗口的执行根里
 *   经伪终端执行裸 `claude --desktop`：桌面 app 切到该目录的新会话页并写下信任记录（当前 app 版本不再弹窗，L18），
 *   不启动会话进程、不产生 hook 记录。没有 `--user-agreed` 一律拒绝为 `consent-required`——信任一个目录是用户的
 *   决定，这个标志是 Agent 对"用户已对这份清单表示同意"的声明；pod 窗口的检出由 launch 准备，检出不在时拒绝
 *   `checkout-missing`。输出里没有 "Opening … in Claude Desktop" 或退出非零拒绝为 `trust-open-failed`。成功只说明
 *   目录已在 app 里打开：之后的 `launch` 才是证明。打开的是该窗口目录所属 Git 仓库的顶层（`trustRoot`，现场 L23）：
 *   信任记录按仓库顶层认，工作区根的一条记录覆盖 Controller、Design、Test 三个窗口；`not-trusted` 的拒绝也带
 *   `trustRoot`，Agent 按不同的 `trustRoot` 去重后只问用户一次。
 * - `sessions`：`claude agents --json` 的 interactive 行转成 `desktop-sessions` 存活观察（sessionId、
 *   status busy / idle、cwd、name、pid；最多 64 行），Wakeflow 据此分类，Agent 不判存活。
 * - `landing --window <windowId> --prompt-ref <许可的 promptRef> [--wait-landing N]`：只等待并报告绑定会话里
 *   这条许可的 user-prompt-submit 记录——摘要相符（match: digest），或带着许可标识而摘要不符（match:
 *   identity，文本被宿主改动，ADR-0027）；从不发送——发送是 Controller 的桌面 `send_message`。只给
 *   `--prompt-digest` 是旧用法，那时只按摘要查。
 *
 * 脚本从自身位置推导工作区根，从不从 cwd 推断；输出里不含绝对路径，唯一例外是 launch observation 里登记
 * 请求要求的 git worktree 原文事实，以及 `sessions` 里桌面会话自报的 cwd（登记合同允许观察携带它）。
 */

export const CLAUDE_CODE_DESKTOP_ASSET_FILE_NAME = "desktop.mjs" as const;

export const CLAUDE_CODE_DESKTOP_ASSET_REF: PortableResourcePath = parsePortableResourcePath(
  `${hostRuntimeRootRef("claude-code")}/operations/assets/${CLAUDE_CODE_DESKTOP_ASSET_FILE_NAME}`,
  "$asset",
);

/** Agent 从工作区根调用桌面助手的命令前缀；技能文本与权限规则都引用它。 */
export const CLAUDE_CODE_DESKTOP_ASSET_COMMAND = `node ${CLAUDE_CODE_DESKTOP_ASSET_REF}` as const;

/** 工作区根 `.claude/settings.json` 里精确到这一条调用的 allow 规则（与 tmux 助手规则同形）。 */
export const WAKEFLOW_CLAUDE_CODE_DESKTOP_PERMISSION_RULE =
  `Bash(${CLAUDE_CODE_DESKTOP_ASSET_COMMAND} *)` as const;

/**
 * 资产的精确字节：维护事务写入的就是这一份，verify 按它核对。
 *
 * 脚本的源文件是 `assets/desktop.mjs` 与它导入的 `assets/shared/` 片段，由 `npm run helpers:build` 装配成
 * 生成模块里的模板；这里只把模板里的构建期记号换成运行时常量的字面量。
 */
export const CLAUDE_CODE_DESKTOP_ASSET_CONTENT: string = renderClaudeCodeHelperAsset(
  CLAUDE_CODE_DESKTOP_HELPER_TEMPLATE,
  CLAUDE_CODE_DESKTOP_HELPER_TOKENS,
  {
    ...CLAUDE_CODE_HELPER_BUILD_VALUES,
    // 宿主命令的时间上限只供测试经这个环境变量缩短；两个助手各用自己的名字。
    __WAKEFLOW_COMMAND_TIMEOUT_VARIABLE__: JSON.stringify("WAKEFLOW_DESKTOP_COMMAND_TIMEOUT_MS"),
  },
);

export const CLAUDE_CODE_DESKTOP_ASSET_DIGEST: Sha256Digest = computeSha256Digest(
  encodeUtf8(CLAUDE_CODE_DESKTOP_ASSET_CONTENT, "$asset"),
  "$asset",
);
