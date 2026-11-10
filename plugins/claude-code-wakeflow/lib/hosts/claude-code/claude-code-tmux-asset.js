import { computeSha256Digest } from "../../foundation/crypto/sha256.js";
import { parsePortableResourcePath, } from "../../foundation/filesystem/portable-resource-path.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { hostRuntimeRootRef } from "../../kernel/layout.js";
import { CLAUDE_CODE_HELPER_BUILD_VALUES, renderClaudeCodeHelperAsset, } from "./claude-code-helper-asset-template.js";
import { CLAUDE_CODE_TMUX_HELPER_TEMPLATE, CLAUDE_CODE_TMUX_HELPER_TOKENS, } from "./generated/claude-code-tmux-helper.generated.js";
/**
 * Wakeflow Host / Claude Code：tmux 助手资产（gate-log §13.117 D4）。
 *
 * 资产是一段 Agent 用 `node` 调用的脚本，装在 Wakeflow 自己的私有运行时目录里，与状态栏资产同一
 * 发布机制（字节精确、0600、verify 核对）。它把旧项目进程内 tmux 适配器的精确序列搬到 Agent
 * 手里：开会话或窗口、冻结标题、写五个 Wakeflow 窗口选项、启动 `claude`、读回 pane 清单、
 * 粘贴并回车一次再回读一次、关闭窗口。它只输出现有 MCP 工具已经要求的观察 JSON；
 * Wakeflow 本身仍不 spawn 任何进程，落地判定仍只看 hook 记录。
 *
 * 子命令（都从工作区根以 `node .wakeflow-local/runtime/hosts/claude-code/operations/assets/tmux.mjs
 * <子命令>` 调用，stdout 恰好一行 JSON）：
 *
 * - `preflight`：node、tmux 与 claude 是否可用及其版本、配置的会话是否已存在、当前是否在 tmux 里、本会话有没有
 *   自己的 session-start 记录（`sessionProven`：没有的会话是工作区建立之前启动的引导会话，只能引导，不能登记自己，§13.188）。
 * - `launch --window <windowId>`：stdin 是 `wakeflow_register_window_binding` inspect 的结果
 *   （或其 `launchIntent`；意图里的 `role` 决定 MCP 许可规则，缺省时取结果顶层的 `role`）。窗口开在意图
 *   `execution.tmux.sessionName` 指定的会话里（primary pod 是配置的会话，worktree pod 各有 `<配置名>-<pod>`，
 *   §13.186），会话不存在就新建并在结果里给出 `attach`。生成 session id，按启动意图开窗口并启动 `claude`，等目标会话的
 *   `session-start` hook 记录，打印登记用的 creation observation。launch 与 resume 都在意图参数之后加
 *   `--allowedTools`：Wakeflow MCP 规则与按助手绝对路径的 `Bash(node <path> *)`（路径只进启动命令）。意图带 `local-head` 的 worktree
 *   意图且参数里有 `--worktree <name>` 时（§13.130 H4），先在意图根（仓库主检出）准备检出：
 *   `<root>/.claude/worktrees/<name>` 不存在就 `git worktree add -b worktree-<name> <path> HEAD`
 *   （分支已存在而检出不存在时拒绝为 `worktree-branch-exists`，由 Controller 询问用户），存在就复用
 *   （`claude --worktree` 对已有检出只加锁），并保证仓库的
 *   `.git/info/exclude` 有 `.claude/worktrees/` 一行；结果里 `worktreePrepared` 说明做了什么。
 *   收养（§13.134）：窗口没有定位器、却已有一个带本窗口三个标识（program、host、window）的活 pane 时
 *   不再开第二个——恰好一个且在跑 claude，就从那个 claude 进程的 argv（`--session-id` 或 `--resume`）
 *   取会话 id，有它的 session-start 记录作证才把它原样交给登记（`adopted: true`、`created: "adopted"`，
 *   不开窗口、不动 tmux）；没有记录拒绝为 `adopt-unproven`，跑的不是 claude 为 `window-present-not-claude`，
 *   多于一个为 `window-ambiguous`；已死的 pane 与已带 binding / locator 标识（登记过）的 pane 不算。
 * - `resume --window <windowId> [--wait N] [--force] [--in-place]`：stdin 同 launch；用绑定里的私有会话 id 以
 *   `claude --resume` 在新 pane 里续同一会话，等到新的 session-start 记录后打印 relocate 用的
 *   observation；意图参数带 `--worktree` 时与 launch 同样按那条记录的 cwd 读 worktree 事实附在 observation
 *   里（等不到记录时 `worktreeObservation: "pending"`），relocate 对 worktree pod 产品窗口的准入才拿得到它
 *   （open-items W2）；定位器的 pane 还活着时拒绝为 `locator-live`（`--force` 跳过），提示改用 `--in-place`。
 *   launch 对活着的 pane 同样拒绝。
 *   `--in-place`（§13.134）：在定位器那个 pane 里用 `tmux respawn-pane -k` 以同一会话、同一意图参数重启，
 *   坐标、定位器、绑定与窗口选项（标识、冻结的标题）都不变，之后不用 relocate 也不用 mark。pane 按
 *   deliver 的同一套核对定位；会话在保留期内没有任何 user-prompt-submit 记录（从未有过对话，claude 不会
 *   --resume 它）时不动窗口、拒绝为 `resume-never-conversed`；且必须已闲置：输入框可见且为空、整屏没有工作中标记，否则拒绝为
 *   `window-busy`（observed 为 working、menu-cursor、input-box-unseen 或 input-not-empty；`--force` 不跳过）。
 *   助手就跑在这个 pane 里（`TMUX_PANE` 相同，即 Controller 重启自己）时不截屏：`CLAUDE_CODE_SESSION_ID`
 *   必须等于绑定的会话（否则 `self-mismatch`），然后交给一个脱离的子进程两秒后 respawn、立即返回
 *   `scheduled`；重启后的会话以一句固定 prompt 开头，让它先 verify 再接着做。
 *   deliver 在粘贴前查目标会话的落地记录：同一段 prompt 已落地就拒绝为 `already-landed` 并
 *   带上那条记录（宿主中断后的重发拿到证据而不是第二次投递），`--force` 才照发。
 *   launch 与 resume 等不到 hook 记录时再看新 pane：已消失或已死就报 `resume-exited` / `launch-exited`
 *   （claude 拒绝 --resume 一个从未有过对话的会话时就是这样退出的），只有活着才是 `pending`。
 * - `self`：Controller 给自己的窗口出同一份 observation（`TMUX_PANE` 与
 *   `CLAUDE_CODE_SESSION_ID` 来自 Claude Code 交给 shell 的环境）；本会话没有 session-start 记录时先拒绝
 *   `hook-evidence-missing`，不在 pane 上写标识（否则随后的 launch 会把引导会话当成待收养的窗口，§13.188）。
 * - `mark --window <windowId> | --all`：登记后把 binding 与 locator 标识写到窗口选项上；pane 行要按会话、
 *   窗口、pane 三项与定位器一致（tmux 重启后编号会被复用），已带别的窗口标识的 pane 报 `pane-occupied` 不覆盖。
 *   同时给该窗口单独设 `window-status-format` 与 `window-status-current-format`（窗口名后跟 hook 观察器写下的
 *   状态字形：working 绿 +、attention 红 ?，idle 不显示；ADR-0023 调整一），给窗口所在会话幂等重设状态栏的
 *   `status-right`（只留时钟）与 `status-left-length`（I15，从不 -g），并在窗口名偏离该窗口的 tmux 窗口名
 *   （配置的显示名；worktree pod 按 launch 的同一规则去掉 `<pod 名> · ` 前缀，§13.186、open-items W28）时
 *   `rename-window` 收敛回去（结果里 `renamed: true`）。
 * - `panes`：`tmux list-panes -a` 转成 `tmux-panes` 观察。
 * - `deliver --window <windowId> [--handle-digest <sha256>] [--prompt-ref <permit.promptRef>
 *   --prompt-digest <permit.promptDigest>] [--wait-landing <seconds>]`：带 `--prompt-ref` 时从工作区根下
 *   Wakeflow 落盘的许可文件读 prompt 并核对摘要（不符为 `prompt-digest-mismatch`，K6），否则 stdin 是
 *   许可里的 prompt；先核对 pane（与定位器相关的 pane 恰好一个、活着、跑的是 claude、标识与坐标都对），
 *   粘贴前截屏一次：尾部看不到输入框（权限、信任对话框或选择菜单）就拒绝为 failed-before-send 的
 *   `target-not-at-prompt`（`--force` 不跳过），截屏失败为 `capture-failed`；
 *   粘贴、回车一次、回读一次，再等目标会话里这条许可的 user-prompt-submit hook 记录（默认 3 秒；摘要相符为
 *   landing.match digest，带着许可标识而摘要不符为 identity——文本被宿主改动，ADR-0027），打印
 *   `wakeflow_record_delivery_outcome` 的 attempt、readback 与 landing。回读（§13.130 H1）看两种
 *   屏幕证据：prompt 首行子串，或 Claude Code 把粘贴折叠成的 `[Pasted text #N +M lines]` 指示且
 *   M 与 prompt 行数一致；都看不到才是 pending。回读只是屏幕摘要，落地仍只看 hook 记录。
 * - `nudge --window <windowId> [--text <phrase>]`（§13.130 H3）：被 "API Error: Connection lost
 *   mid-response" 切断的一轮不会自己续上；按 deliver 的同一套 pane 核对定位后截屏一次，只在屏幕尾部
 *   有 `API Error` 行且它是输入框上方最后一条对话行（之后没有回复、已渲染的用户消息或其他输出）、
 *   没有工作中标记（"esc to interrupt"、"running … hooks"、2.1.283 的 "… (23s · …" 计时行）且输入框为空时才粘贴一句
 *   （默认 "Continue."）并回车一次，打印 status（nudged / not-needed / busy / pane-missing）、
 *   匹配到的错误行与截屏摘要；一次调用最多推一次，看不到错误行绝不推。
 * - `close --window <windowId>`：关闭前后各读一次 pane 清单，打印 decommission 的 closure；只有恰好
 *   一个 pane 同时对上定位器坐标与本窗口标识时才杀窗口，否则不杀并报 closeResult `unknown`。
 * - `teardown [--force]`：引导要重来时杀掉配置的 tmux 会话；有任何登记窗口时拒绝，除非 --force。
 *
 * 脚本从自身位置推导工作区根，从不从 cwd 推断；输出里不含绝对路径，唯一例外是 launch observation
 * 里登记请求要求的 git worktree 原文事实（`git worktree list --porcelain` 与 `--git-common-dir`），
 * 收养的 launch 也一样。
 */
export const CLAUDE_CODE_TMUX_ASSET_FILE_NAME = "tmux.mjs";
export const CLAUDE_CODE_TMUX_ASSET_REF = parsePortableResourcePath(`${hostRuntimeRootRef("claude-code")}/operations/assets/${CLAUDE_CODE_TMUX_ASSET_FILE_NAME}`, "$asset");
/** Agent 从工作区根调用助手的命令前缀；技能文本与权限规则都引用它。 */
export const CLAUDE_CODE_TMUX_ASSET_COMMAND = `node ${CLAUDE_CODE_TMUX_ASSET_REF}`;
/**
 * 工作区根 `.claude/settings.json` 里精确到这一条调用的 allow 规则（§13.117 D5）：
 * 只放行助手本身，不恢复旧项目的 `Bash(tmux *)` 与 `Bash(node *)`。
 */
export const WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE = `Bash(${CLAUDE_CODE_TMUX_ASSET_COMMAND} *)`;
/**
 * 资产的精确字节：维护事务写入的就是这一份，verify 按它核对。
 *
 * 脚本的源文件是 `assets/tmux.mjs` 与它导入的 `assets/shared/` 片段，由 `npm run helpers:build` 装配成
 * 生成模块里的模板；这里只把模板里的构建期记号换成运行时常量的字面量。
 */
export const CLAUDE_CODE_TMUX_ASSET_CONTENT = renderClaudeCodeHelperAsset(CLAUDE_CODE_TMUX_HELPER_TEMPLATE, CLAUDE_CODE_TMUX_HELPER_TOKENS, {
    ...CLAUDE_CODE_HELPER_BUILD_VALUES,
    // 宿主命令的时间上限只供测试经这个环境变量缩短；两个助手各用自己的名字。
    __WAKEFLOW_COMMAND_TIMEOUT_VARIABLE__: JSON.stringify("WAKEFLOW_TMUX_COMMAND_TIMEOUT_MS"),
});
export const CLAUDE_CODE_TMUX_ASSET_DIGEST = computeSha256Digest(encodeUtf8(CLAUDE_CODE_TMUX_ASSET_CONTENT, "$asset"), "$asset");
