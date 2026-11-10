import { CLAUDE_CODE_DESKTOP_ASSET_COMMAND } from "./claude-code-desktop-asset.js";
import { CLAUDE_CODE_TMUX_ASSET_COMMAND } from "./claude-code-tmux-asset.js";

/**
 * Wakeflow Host / Claude Code：agent 面文本的宿主取值表（gate-log §13.99 D3、D9）。
 *
 * 本模块是纯数据加确定性渲染，与 `claude-code-hook-fragment.ts` 同一模式：文本只有一份源
 * （`assets/agent-text/`，仓库相对，不出现任何宿主名），宿主差异写成十二个封闭占位符，取值
 * 住在这里。制品构建器动态 import 本模块，对源目录里的每份 Markdown 做一次封闭替换后写进
 * 候选制品——源里出现未登记的占位符，或表里有没被任何源文件用到的取值，构建即失败。
 *
 * 语言（D6）：技能与命令只发英文，README 双语且与英文共用同一套占位符，所以取值分
 * `en` 与可选 `zh` 两面。`zh` 只给被中文源文件用到的键（`commandSurface`、`hostTrustSteps`、
 * `pluginUpdateSteps`）；`instructionFile` 这类与语言无关的取值不带 `zh`，由构建器按"取值必须有
 * 用户"逐面核对。
 *
 * 渲染只替换不解析：替换用函数式 replacer，取值里的 `$` 不会被当成替换模式；一次遍历不
 * 回扫已替换的文本，所以取值里即便出现 `{{...}}` 也不会被二次展开。字节只由本表决定，不
 * 含版本号或构建标识，两次构建因此字节一致。
 *
 * 两种窗口传输（ADR-0025，双传输规划原则 1）：tmux 与桌面会话是 `claude-code` 宿主并列一等的两种
 * 传输，每工作区选一种。凡触及窗口层的取值都用并列的两段分别写 tmux 与桌面，只描述环境差异，不说
 * 任一方是旧方式、预览或推荐；tmux 段在前只因为它是配置缺省值。本模块只导入两份助手的命令常量
 * （与权限规则同源）；取值是给人读的文本，没有运行时依赖，也不看对端宿主。
 */

/** 十二个封闭占位符（§13.188 加 firstRunHandover；D3，§13.118 加 windowBootstrap，重发守卫与窗口续接后加 resendGuard、windowResume，C9 加 pluginUpdateSteps，I4 加 hostEffectRule）；源目录里出现表外的占位符即构建失败。 */
export type ClaudeCodeAgentTextPlaceholderKey =
  | "instructionFile"
  | "windowLaunch"
  | "windowBootstrap"
  | "deliveryAction"
  | "worktreeLaunch"
  | "commandSurface"
  | "hostTrustSteps"
  | "windowResume"
  | "resendGuard"
  | "pluginUpdateSteps"
  | "hostEffectRule"
  | "firstRunHandover";

/** 渲染语言：`zh` 只用于 `README.zh-CN.md`，其余源文件一律 `en`（D6）。 */
export type ClaudeCodeAgentTextLanguage = "en" | "zh";

export interface ClaudeCodeAgentTextPlaceholderValue {
  readonly en: string;
  /** 只给被中文源文件用到的键；多余的 `zh` 面没有用户，构建器拒绝。 */
  readonly zh?: string;
}

/** 命令面是 Claude 独有（D2）：四个命令随本候选发出。 */
export const CLAUDE_CODE_AGENT_TEXT_COMMANDS_INCLUDED = true;

const INSTRUCTION_FILE = "CLAUDE.md";

/** 两份助手的调用前缀：从工作区根用 node 调用，各与自己的权限规则同一字符串（§13.117 D4、D5；ADR-0025 D4）。 */
const TMUX_HELPER: string = CLAUDE_CODE_TMUX_ASSET_COMMAND;
const DESKTOP_HELPER: string = CLAUDE_CODE_DESKTOP_ASSET_COMMAND;

/** C16：助手调用的唯一形态；技能第 1 步（经 `{{hostEffectRule}}`）与参考里的 launch 说明（经 WINDOW_LAUNCH）共用这一句（I4，§13.178）。 */
const ONE_CALL_RULE =
  "Make every helper call its own Bash command with literal arguments - no shell loop, " +
  "variable or chain of helper calls: only such a plain call matches the helper's allow rule, " +
  "and anything else stops at a permission prompt the user has to answer.";

/**
 * 技能第 1 步的宿主句（I4）：先说助手是传输中立的——工作区发布哪一份就跑哪一份，`launch` 打印登记
 * 用的观察——再接 C16 的单次调用规则。传输的分步在两份参考里，不在技能正文。
 */
const HOST_EFFECT_RULE =
  "The published helper does the host steps - `tmux.mjs` under the tmux transport, " +
  "`desktop.mjs` under desktop sessions - and its `launch` prints the observation you " +
  `register. ${ONE_CALL_RULE}`;

/**
 * 开窗（ADR-0025 D7）：共同部分（管道喂意图、单次调用、`--allowedTools` 与信任对话框只列 Wakeflow 的规则、
 * 不认识的拒绝原样转述）之后，tmux 与桌面各一段。tmux 段压缩自 §13.134 的原文（mark/panes/close、
 * resume 加 relocate、locator-live、resume-exited、--wait）；桌面段只写三步开窗的结果形状与桌面工具的
 * 对应动作，分步、拒绝码与给用户的话在 `references/desktop-transport.md`。
 */
const WINDOW_LAUNCH =
  "pipe the intent (the `launchIntent` that `wakeflow_register_window_binding` inspect " +
  "returns, or the maintenance result's entry for that window) into the published helper's " +
  `\`launch\`, run from the workspace root: \`${TMUX_HELPER} launch --window <windowId>\` ` +
  `under the tmux transport, \`${DESKTOP_HELPER} launch --window <windowId>\` under desktop ` +
  "sessions. The workspace's transport is `hosts.claude-code.windowTransport` (`tmux` unless " +
  "the config says `desktop`); maintenance publishes only that transport's helper and " +
  `\`wakeflow_status\` lists it under \`hostAssets\`. ${ONE_CALL_RULE} Either helper starts ` +
  "`claude` with the intent's parameters, waits for the session-start hook record of the " +
  "session it started and prints the creation observation to register verbatim. The window " +
  "starts with `--allowedTools` for its role's Wakeflow tools and the helper, in the " +
  "permission mode from step 0; the workspace root's `.claude/settings.json` carries those " +
  "two rules, Design and Test carry only their role's tools, and a product repository's " +
  "`.claude/settings.json` is never written, so a trust dialog for a Wakeflow-written root " +
  "lists only those rules. Entries it lists beyond them - `Bash(git *)`, `Bash(node *)`, " +
  "`Bash(tmux *)`, a `..` directory - are 0.9.x residue (`broad-permission`, " +
  "`additional-directories`) or the repository's own settings: accepting activates them, so " +
  "the user deletes or confirms them before you launch, never you. Under the tmux transport " +
  "the helper opens the window in the tmux session the intent names and generates the " +
  "session id itself. After each registration run `mark --window <windowId>` so the tmux " +
  "window carries the five Wakeflow options; `panes` prints the tmux-panes observation and " +
  "`close --window <windowId>` the closure evidence a decommission needs. When a registered " +
  "window's pane is gone but its session should continue (tmux restarted, pane closed by " +
  "mistake), pipe the inspect result into `resume --window <windowId>`: it starts " +
  "`claude --resume` with the bound session in a new pane and prints the observation for the " +
  "binding tool's `relocate`, which keeps the binding and records the new pane; then `mark` " +
  "again. `launch` and `resume` refuse while the located pane is still alive (`locator-live`; " +
  "a live window on an older plugin is restarted with `resume --in-place`, as the " +
  "plugin-update steps say), and report `resume-exited` / `launch-exited` when `claude` quit " +
  "before its SessionStart hook: a session that never held a conversation cannot be resumed, " +
  "so launch a fresh window instead. Both wait up to `--wait <seconds>` (default 20, at most " +
  "120) for that hook record; `hook.sessionStart: pending` with a live pane leaves startup " +
  "unproven: inspect hook execution, keep the observation, register or relocate with it once " +
  "the record exists, and pass a longer `--wait` next time. Under desktop sessions the helper " +
  "starts the session in the background with `claude --bg` (the host assigns the session id; " +
  "the intent carries no `--session-id`), lets its first turn finish, stops it and reopens it " +
  "in the desktop app's Code tab with `claude --desktop --resume`, waits for that session's " +
  "session-start record and prints the observation with `desktop.sessionId` (`local_` plus " +
  "the session id) for registration; it waits `--wait <seconds>` (default 120) for the first " +
  "turn and `--wait-session-start <seconds>` (default 30) for the record, refuses " +
  "`locator-live` while the window's recorded session is still in the sidebar and " +
  "`not-trusted` for a folder without Claude Code's trust record (the refusal's `trustRoot` is " +
  "the folder that needs it: collect the distinct ones, ask the user once, and with their " +
  "agreement run `trust --window <windowId> --user-agreed` once per `trustRoot` and `launch` " +
  "the refused windows again; a user who declines opens that folder in the desktop app or " +
  "runs `claude` there and accepts the trust dialog). After each registration set the session's permission mode " +
  'with the desktop `set_session_permission_mode` tool to `"auto"` (the app reapplies the ' +
  "folder's remembered mode when it takes the session over; the user approves its card once " +
  "per folder) and its title with the desktop `set_session_title` tool; liveness is the " +
  "desktop-sessions observation built from the desktop `list_sessions` tool, the helper's " +
  "`sessions` is only the process view; a " +
  "session is resumed by sending it a message, so relocate does not apply, and it is closed " +
  "with the desktop `archive_session` tool only on the user's authorization - never with " +
  "`claude rm`. The steps, refusal codes and what to tell the user for that transport are in " +
  "`references/desktop-transport.md`. A helper refusal this text does not explain - an " +
  "unfamiliar `reason`, or `reason: unexpected` with an `errorName` - is relayed to the user " +
  "verbatim with its `hint`, `detail` and `causeCode`; then stop: do not retry it, do not edit " +
  "files, do not read the helper's source.";

/**
 * 插件更新后的窗口换代（§13.134 C8、C16；ADR-0025 D6）。tmux：先就地重启 Controller 自己，再逐个就地
 * 重启其他过期窗口；过期的服务算出的启动意图是旧代码的，维护也不能从它跑，所以本窗口先换代：助手排好
 * 两秒后的重启，会话带着新插件与新的 MCP 服务器自己续上，用户不必 `/mcp` 重连，也不必碰 tmux；续上后
 * verify、必要时对账装上新助手，才轮到其他窗口。窗格已经没了的续接（新窗格 + relocate）仍在 WINDOW_LAUNCH
 * 里。工作区里的助手只由维护部署：还是就地重启之前的旧助手时它以 `argument-unknown` 拒绝 `--in-place`，
 * 这一次只能先由用户 `/mcp` 重连本窗口的服务、再对账装上新助手，然后从头再来。"只能开新会话"的四步
 * （close → launch → replace → mark）从共享参考移到这里，因为它是 tmux 的分步。
 * 桌面：没有就地重启；L18（X20）证实 app 会在几个回合内自行重载过期的 MCP 服务，所以文本让 Controller 等
 * status 显示制品当前后再 verify 与对账，不重载才请用户重开 Controller 会话；没了的会话用 launch + replace
 * 换，不 relocate。
 */
const WINDOW_RESUME =
  "under the tmux transport, if this serving MCP is outdated, first tell the user in one " +
  "sentence that this window will restart in place in a few seconds and carry on by itself, " +
  `then pipe your own inspect result into \`${TMUX_HELPER} resume --window <this windowId> --in-place\` ` +
  "and end your turn. It returns at once (`self: true`, `scheduled: true`); about two seconds " +
  "later this session restarts with the updated plugin and a fresh Wakeflow server - no " +
  "`/mcp` reconnect is needed - and resumes by itself with a prompt to load this skill again " +
  "(the copy in your context predates the update), call `wakeflow_verify` and continue where " +
  "you left off. A helper installed before in-place restarts existed " +
  "refuses `--in-place` as `argument-unknown`: then ask the user to run `/mcp` in this window " +
  "and reconnect `wakeflow`, run a reconcile as in step 0, which installs the current helper, " +
  "and start this section again. If this server is already current, skip its restart. For peer " +
  "windows that verify reports as `stale` (`windows-stale:<n>`: each such session started under an older artifact), `wakeflow_status` lists one action per window: " +
  "take the `stale-window-resume` ones one at a time, each only while it sits idle at an empty prompt, and " +
  "pipe each one's inspect result into `resume --window <windowId> --in-place`, one helper " +
  "call per Bash command. The session restarts inside its own pane on the updated plugin; the " +
  "binding, coordinates and marks stay, so there is nothing to relocate or mark, and " +
  "`hook.sessionStart: pending` means startup is unproven; inspect hook execution. `window-busy` " +
  "means that window is working, shows a dialog or menu, or holds typed input, and `--force` " +
  "does not override it: go on with the next window and retry this one once its turn has " +
  "ended - a dialog, a menu or typed input waits for the user, so tell them which window it " +
  "is. `resume-exited` means the process exited before startup evidence; read the refusal's `hint` and that pane before retrying. " +
  "A `stale-window-relaunch` window (its session never conversed, so `resume` would refuse with `resume-never-conversed`) " +
  "is not probed or resumed: close the old one, launch it again, " +
  "register it with `replace` and `mark` it - four calls, one helper call per Bash command, " +
  "each printed result kept verbatim: `close --window <windowId>` (the binding stays; this is " +
  "not a decommission), `launch --window <windowId> --wait 60` with that window's current " +
  'inspect result piped in, `wakeflow_register_window_binding` with `operation: "replace"`, ' +
  "the printed `observation` and the `expectedBindingId` / `expectedBindingDigest` the inspect " +
  "returned, then `mark --window <windowId>`; never reconstruct those calls from your own " +
  "session transcript or from the plugin's source. Under desktop sessions nothing restarts in " +
  "place: an outdated server refuses writes (`runtime-artifact-outdated`), and the desktop app " +
  "reloads the MCP server on its own within a few turns, so tell the user in one sentence that " +
  "the update is being picked up, check `wakeflow_status` on your next turns until it shows " +
  "the runtime artifact current, then call `wakeflow_verify` and preview and apply reconcile; " +
  "if it has not reloaded after a few turns, ask the user to archive and unarchive this Controller session and message it: the message restarts its process on the current artifact. " +
  "Peer windows reported `stale` are `windows-refresh-pending` on a passing gate there: the " +
  "app ends an idle session's process and its next message starts it on the current artifact, " +
  "so restart none and send none a message for it; a session is " +
  "resumed by sending it a message, so nothing is relocated. A session that is gone (`absent` " +
  "in the desktop-sessions observation: archived or deleted) is replaced, not resumed: with " +
  "the user's authorization pipe its inspect result into `launch` again, register the printed " +
  "observation with `replace` and set its permission mode and title; relocate does not apply " +
  "on this transport.";

/** 重发守卫（§13.127）：tmux 助手发送前查接收窗口的落地记录；桌面的发送是 Controller 自己的工具调用，第二次发送前先用助手的 `landing` 查。 */
const RESEND_GUARD =
  "check the receiving window's landing record before any second send - the tmux helper's " +
  "`deliver` does it itself and refuses with `already-landed`, printing that landing; under " +
  "desktop sessions run the helper's `landing` first - and record or report that landing " +
  "instead of sending again (tmux `--force` is only for a prompt you have established never " +
  "reached the window).";

/**
 * Controller 自己怎么进容器：用户是被引导者，从不自己配置 tmux 或桌面会话（§13.118）。tmux：引导会话
 * 登记前就被关掉时，tmux 里的 Controller 用 `launch` 收编仍在运行的窗口再登记（§13.134 I6），不在 tmux
 * 里 teardown；收编被拒时按助手的 hint 引导用户。桌面：引导会话跑在桌面 app 里，同样永不是 Controller；
 * `launch` 自己等到 session-start 才返回，所以每个窗口一返回就登记；没有收编；apply 后引导会话的分类器可能
 * 拒绝助手（X18），改由新开的会话继续开窗；`not-trusted` 不打断这一轮——把被拒的目录收齐、只问用户一次，
 * 同意后用助手的 `trust --user-agreed` 逐个打开再 launch，不同意则由用户自己打开（Q13，ADR-0025 D11）；每窗
 * 登记后由 Controller 切 auto（X4），全部登记后归入程序名分组。
 */
const WINDOW_BOOTSTRAP =
  "run the published helper's `preflight` - " +
  `\`${TMUX_HELPER} preflight\` under the tmux transport, \`${DESKTOP_HELPER} preflight\` under ` +
  "desktop sessions - and read its result. Under the tmux transport read `sessionProven` and " +
  "`insideTmux`. `sessionProven: true` means this session's own session-start record exists: " +
  "it is the tmux Controller window, so register it with `self` (pipe your own window's inspect " +
  "result in). `sessionProven: false` or `null` means this session started before the " +
  "workspace's hooks existed - every first run, inside tmux or not: it only bootstraps and must " +
  "never register itself or mark its pane. `launch` the Controller window's own intent so a " +
  "fresh Controller starts inside the configured tmux session, launch every other window with " +
  "`--wait 0` (its result says `hook.sessionStart: pending` only because it did not wait; the " +
  "record usually lands within seconds), give the user the exact command the helper printed - " +
  "`attach` when they are outside tmux, `switch` when this session already runs inside it - " +
  "and register each window from the observation you kept, in launch order, without waiting " +
  "for the user. A registration refused `hook-evidence-missing` means that window has not " +
  "started: it is still showing its trust dialog (a directory the user has not trusted yet, or " +
  "a repository with its own settings) or is still starting. A trusted directory shows no " +
  "dialog, so never send the user to look for one: name the windows that are waiting, ask them " +
  "to accept the dialog where one is shown (`Ctrl-b n` moves to the next window) and to keep " +
  "this session open until you have registered the windows, and register those windows again " +
  "when they say so; then run `mark --all` once every window is registered, show the handover " +
  "card from `references/first-run.md`, and tell the user to continue in the tmux Controller " +
  "and close this session with `/exit`. A window that a setup session started but never " +
  "registered (it was closed too early) is still running: `launch` it as below and the helper " +
  "adopts it instead of opening a second one (`adopted: true`); register that observation as " +
  "usual. If adoption is refused (`adopt-unproven`, `window-ambiguous`, " +
  "`window-present-not-claude`), never open a second window and never `teardown` from inside " +
  "tmux: tell the user which window it is and what the refusal's `hint` asks of them - exit " +
  "`claude` there with `/exit` (in all but one of the windows, for `window-ambiguous`), or " +
  "close a window that runs something else with `Ctrl-b &` and then `y` - and `launch` again " +
  "once they have. An unproven window that still shows its trust dialog only needs that dialog " +
  "accepted. The user never sets tmux up by hand: you do it and tell them the one thing to run " +
  "or press. If a bootstrap has to be redone before any window was registered, `teardown` " +
  "kills that tmux session; with registered windows it refuses unless `--force`. Under desktop " +
  "sessions `preflight` reports `desktop.appRunning` (when false, ask the user to start the " +
  "Claude desktop app, sign in with their subscription and say when it is up, then run it " +
  "again; `launch` refuses `desktop-unavailable` until then), `script.available` (the " +
  "pseudo-terminal wrapper; `script-unavailable` otherwise) and the same `sessionProven`: a " +
  "setup session running in the app is unproven and likewise never the Controller. Right " +
  "after the fresh-initialize apply its permission classifier may refuse the helper, because " +
  "the allow rules were written after it started: never try to work around a classifier " +
  "refusal - start a new session in the workspace root (with `start_session` when the host " +
  "offers it, otherwise ask the user to open one) that initializes Wakeflow there and " +
  "continues the window launches. `launch` the Controller window's intent first, then every " +
  "other window, one helper call each: `launch` waits for the session-start record itself and " +
  "each session appears in the app's sidebar when it returns, so register each window from the " +
  "observation you kept as soon as its call returns, then set its permission mode with the " +
  'desktop `set_session_permission_mode` tool to `"auto"` (the user approves the card once per ' +
  "folder) and its title with the desktop `set_session_title` tool. `not-trusted` means Claude " +
  "Code has no trust record for that window's `trustRoot` - the workspace root, whose record " +
  "covers the surfaces inside it, or a product repository; opening a folder in the desktop app " +
  "does not always write it, so the root can be among them. Do not stop there: launch the " +
  "remaining windows, then name every distinct `trustRoot` to the user in one question and say " +
  "that Claude Code will load that folder's own settings and hooks once it is trusted. After " +
  "their yes run `trust --window <windowId> --user-agreed` once per `trustRoot` - it opens that " +
  "folder in the desktop app, which records the trust - and `launch` the refused windows again; a user who would rather do it themselves " +
  "opens each folder in the desktop app (a new session there) or runs `claude` in a terminal " +
  "there and accepts the trust dialog. Never pass `--user-agreed` without their word. There is no adoption on " +
  "this transport: a window that was launched but never registered is archived with the " +
  "user's authorization and launched again. When every window is registered, file the sessions " +
  "into one sidebar group named after the program with the desktop `create_group` and " +
  "`move_sessions` tools, show the handover card from `references/first-run.md` and tell the " +
  "user to continue in the Controller session in the sidebar and to archive this one. The " +
  "three-step launch, the other subcommands and the refusal codes are in " +
  "`references/desktop-transport.md`.";

/**
 * 首次交接卡（§13.188）：首次初始化结束时 Controller 给用户的那一张卡，教学一次，日常不再重复。
 * 宿主细节只在这里，按传输各一张：tmux 卡给会话名、attach/switch 与按键；桌面卡给侧栏里的会话与
 * app 自己的标记；两卡共用长跑、第一步与 `/wakeflow:status` 的收尾。
 */
const FIRST_RUN_HANDOVER =
  "show one card and nothing else, for the transport this workspace uses. Under the tmux " +
  "transport: the tmux session name and the one command to get there (the helper's `attach` " +
  "when the user is outside tmux, its `switch` when they are already inside); the windows in " +
  "that session, one line each - `Controller` (where they give instructions and ask what is " +
  "next), `Design` (where a requirement is written with the agent), one window per product " +
  "repository (where that repository's work happens; it waits for a delivery from the " +
  "Controller and is never given tasks by hand), `Test` (where the test contract runs); how to " +
  "move - `Ctrl-b n` next window, `Ctrl-b p` previous, `Ctrl-b s` to pick a session, `Ctrl-b d` " +
  "to detach while everything keeps running; how to read the window list - a green `+` after a " +
  "window name means it is working, a red `?` means it is waiting for you, nothing means idle; " +
  "the hooks write them, a hint and never evidence; how to come back later - the same `attach` " +
  "command, the sessions outlive the terminal. Under desktop sessions: the sessions in the " +
  "desktop app's sidebar, filed in one group named after the program (a worktree pod gets its " +
  "own group, `<program> · <pod>`), one line each with the same four roles in the same words, and which " +
  "of them is the Controller (this setup session is not it and is archived after the card); " +
  "how to move - click a session in the sidebar; how to read the sidebar - the app's own " +
  "markers say when a session is working, has unread output or waits for you, no Wakeflow mark " +
  "is added; how to come back later - open the desktop app's Code tab, the sessions are kept " +
  "there. On either transport: long runs - keep the machine awake yourself, Wakeflow runs no " +
  "background process; what to do first - switch to the Design window and describe the first " +
  "requirement in plain words, come back to the Controller when Design says the package is " +
  'published; `/wakeflow:status` in the Controller answers "what is next" from then on.';

/**
 * 投递的宿主效果（ADR-0025 D5），tmux 与桌面各一段：tmux 由助手 `deliver` 读许可文件、核对 pane、粘贴并
 * 等落地记录；桌面由 Controller 自己用桌面 `send_message` 发送、返回值原样作 `attempt.sendReturn`，再用
 * 助手 `landing` 等落地记录。两边落地都只认目标会话的 user-prompt-submit 记录。本取值同时进 Target 与
 * Test 技能（回调的发送），所以回调的去向（Controller 的桌面 id、从产品窗口调助手的路径前缀）也在这里。
 */
const DELIVERY_ACTION =
  "run the helper from the workspace root (from a product or surface window, prefix its path " +
  "with the `--add-dir` workspace root). Under the tmux transport: " +
  `\`${TMUX_HELPER} deliver --window <windowId> --handle-digest <the permit's handleDigest> ` +
  "--prompt-ref <the permit's promptRef> --prompt-digest <the permit's promptDigest>`. " +
  "It reads the prompt from the permit file - never retype, pipe or " +
  "reconstruct it, never read `.wakeflow-active` event files yourself - refuses " +
  "`prompt-digest-mismatch` when the file does not match and, before sending, " +
  "`target-not-at-prompt` when the pane shows a dialog or menu instead of its input box, or " +
  "that box holds typed text (nothing was sent: the user answers or clears it in that window, " +
  "then you send the same permit again; never send keys there yourself), otherwise pastes the prompt, presses Return once, " +
  "waits a few seconds for the target session's prompt-submit record and prints the " +
  "`attempt`, `readback` and `landing` to record verbatim; `readback` is screen text only, " +
  "landing is proven by the hook record alone. Under desktop sessions send the `promptRef` " +
  "file's text, unchanged and once, with the desktop `send_message` tool to the window's " +
  "desktop id (the `desktop.sessionId` its `launch` printed; a callback goes with " +
  "`SendMessage` to the Controller's desktop id that the delivery prompt names), keep the " +
  'tool\'s return unchanged as `attempt.sendReturn` (`status: "sent"`, or ' +
  '`"failed-before-send"` when nothing was sent), then, before recording the outcome, run ' +
  `\`${DESKTOP_HELPER} landing --window <windowId> --prompt-ref <the permit's promptRef>\` ` +
  "(`--wait-landing <seconds>` after `queued`): only the target's `user-prompt-submit` " +
  "record proves landing.";

/**
 * worktree pod 的窗口（§13.130 H4、§13.186；ADR-0025 D4）：检出由助手 `launch` 从 `local-head` 意图准备，
 * 两种传输同一套准备与拒绝；不同的只是容器（tmux 自己的会话 / 侧栏里的会话）与会话怎样进入检出
 * （tmux 用 `claude --worktree`；桌面以检出为 cwd，绝不 `--worktree`，否则 app 把检出当成自己的 worktree）。
 */
const WORKTREE_LAUNCH =
  "a worktree pod's windows open as their own set: under the tmux transport in a tmux session " +
  "named `<configured session>-<pod name>` (the launch intents carry it as " +
  "`execution.tmux.sessionName`; the first `launch` into that session creates it and prints the " +
  "`attach` command to give the user, and retiring the pod's last window removes the session), " +
  "under desktop sessions as further sessions in the app's sidebar, titled with the display " +
  "name the intent carries. The helper's `launch` prepares the worktree from a `local-head` " +
  "worktree intent before it starts the product window: it creates " +
  "`<repository>/.claude/worktrees/<name>` from the repository's local HEAD on branch " +
  "`worktree-<name>`, reuses the checkout only when this repository's worktree list has it, " +
  "and adds `.claude/worktrees/` to the repository's `.git/info/exclude`; its result says " +
  "`worktreePrepared: created` or `reused`. Under the tmux transport the window then starts " +
  "with `claude --worktree <name>`, which only locks that existing checkout; under desktop " +
  "sessions it starts with the checkout as its working directory and never with `--worktree` " +
  "- the app would claim such a checkout as its own worktree, and archiving the session or " +
  "`claude rm` would delete it. The helper refuses without writing when the placement is not " +
  "the repository top level (`worktree-root-not-toplevel`), when `worktree-<name>` exists " +
  "without its checkout (`worktree-branch-exists`: ask the user whether to delete or rename it) " +
  "or when another directory holds the path (`worktree-path-occupied`). A launch that fails " +
  "after the checkout was prepared still reports `worktreePrepared` and `worktreeBranch`, so " +
  "tell the user that checkout was left behind. Once the session has started, `launch` " +
  "compares its hook-recorded working directory with the prepared checkout and refuses " +
  "`worktree-cwd-mismatch` when the session is not working in it; have the user close that " +
  "window, then launch again. Do not start such a window with a bare `claude --worktree`: " +
  "without an existing checkout Claude Code creates it from the remote default branch, not " +
  "from the local HEAD.";

const COMMAND_SURFACE_EN =
  "`/wakeflow:init` sets up or repairs the workspace, `/wakeflow:status` reports where " +
  "it stands, `/wakeflow:next` takes the next step on the active Demand, and " +
  "`/wakeflow:pod` creates or closes a pod. Claude Code always namespaces plugin commands, so " +
  "the `wakeflow:` prefix is part of the name.";

const COMMAND_SURFACE_ZH =
  "`/wakeflow:init` 初始化或修复工作区，`/wakeflow:status` 报告当前状态，" +
  "`/wakeflow:next` 在活动 Demand 上推进一步，`/wakeflow:pod` 创建或关闭 pod。" +
  "Claude Code 的插件命令一律带插件名前缀，`wakeflow:` 是命令名的一部分。";

/**
 * README 的一次性宿主动作；窗口缺省以 auto 权限模式启动（用户裁决 Q4，§13.134）。两种传输并列
 * （ADR-0025）：tmux 的状态行、attach 命令与每窗的信任对话；桌面的订阅登录、app 在运行、每个目录
 * 的信任记录由用户写（X19：打开目录或运行 `claude`，Controller 从不替用户信任），切 auto 的确认卡每目录一次（X4）。
 */
const HOST_TRUST_STEPS_EN = [
  "The first time you start Claude Code in the workspace directory, accept the",
  "workspace trust dialog. Without it neither the plugin's hooks nor the status line",
  "run, so no session is observed and no delivery can be shown to have landed.",
  "Under the tmux transport `wakeflow_maintain_workspace` writes the status line command",
  "into `settings.local.json` at the workspace root and at the Design and Test surfaces; that",
  "entry belongs to Wakeflow and is kept current. A `statusLine` you configured yourself (one",
  "without Wakeflow's marker) is left alone and shows as `custom` in `wakeflow_status`; that",
  "window then has no Wakeflow label. Under desktop sessions no status line is written: the",
  "app's sidebar carries its own markers.",
  "",
  "You never set the window transport up by hand. Start `claude` in the workspace directory -",
  "in a terminal or in the desktop app's Code tab - and run `/wakeflow:init`: the setup session",
  "proposes the transport its surroundings support (desktop sessions when it runs in the",
  "desktop app and has the app's session tools, tmux otherwise), you may choose the other one,",
  "and the choice is written as `hosts.claude-code.windowTransport` - one transport per",
  "workspace. Under the tmux transport the Controller creates the tmux session and every",
  "window itself through the helper maintenance installs at",
  "`.wakeflow-local/runtime/hosts/claude-code/operations/assets/tmux.mjs`, tells you the exact",
  "`tmux attach` command once the windows are up (a worktree pod gets its own session,",
  "`<session>-<pod name>`, with its own attach command), and which trust dialogs to accept; it",
  "delivers prompts through the same helper. Under desktop sessions the Controller opens every",
  "window as a session in the app's sidebar through the helper installed as `desktop.mjs` in",
  "the same place and delivers prompts with the app's own session messaging; what only you do:",
  "sign in to the desktop app with your Claude subscription, keep the app open while Wakeflow",
  "works, decide once about the folders Claude Code does not trust yet - the workspace root,",
  "whose trust also covers the Design and Test surfaces inside it, and each product repository:",
  "the setup session lists them, says",
  "what trusting them means and, with your agreement, opens each in the desktop app, which",
  "records the trust without a further dialog on the current app version; if you would rather",
  "do it yourself, open each folder in the app or run `claude` in a terminal there and accept",
  "the dialog; nothing is trusted without your word - and approve the one card per folder the app may show when the Controller switches a",
  "window there to the `auto` permission mode (the folder remembers it). Maintenance also",
  "writes precise allow rules for the published helper and the Wakeflow MCP tools into the",
  "workspace root's `.claude/settings.json`, and every window the helper launches is started",
  "with those two tools allowed, so product and test windows do not stop at a permission prompt for them",
  "either; nothing broader such as `Bash(tmux *)` is written. A trust dialog for a root Wakeflow",
  "wrote therefore lists only those rules; `Bash(git *)`, `Bash(node *)`, `Bash(tmux *)` or a",
  "`..` directory in that list is 0.9.x residue or the repository's own settings: delete or",
  "review it before accepting, because accepting activates it.",
  "",
  "By default every window the helper launches runs in Claude Code's `auto` permission mode:",
  "Claude Code reviews routine actions itself instead of asking you. A window may still ask",
  "you a one-time question the first time, for example whether to allow reads outside its",
  "working directories; the Controller tells you which window is asking. If your account has",
  "no auto mode, ask the Controller to set `hosts.claude-code.launch.permissionMode` to",
  "`acceptEdits` through maintenance; the windows then stop for a permission prompt on",
  "commands.",
].join("\n");

const HOST_TRUST_STEPS_ZH = [
  "第一次在工作区目录里启动 Claude Code 时，必须接受工作区信任对话。不接受时插件的 hook",
  "与状态栏都不运行：没有会话被观察到，投递也拿不到落地证据。tmux 传输下状态栏命令由",
  "`wakeflow_maintain_workspace` 写进工作区根与 Design、Test 面的 `settings.local.json`；那一项归",
  "Wakeflow 所有并保持最新。你自己配置的 `statusLine`（没有 Wakeflow 标记的）不会被覆盖，在",
  "`wakeflow_status` 里显示为 `custom`，那个窗口就没有 Wakeflow 的标签。桌面会话传输下不写状态栏：",
  "app 的侧栏自带标记。",
  "",
  "你不需要自己配置窗口传输。在工作区目录里运行 `claude`——在终端里，或在桌面 app 的 Code 标签里——",
  "执行 `/wakeflow:init`：引导会话按自己所处的环境提议传输（在桌面 app 里、带着 app 的会话工具",
  "时是桌面会话，否则是 tmux），你可以选另一种，选择写进 `hosts.claude-code.windowTransport`，",
  "每个工作区一种。tmux 传输下 Controller",
  "会通过维护装到 `.wakeflow-local/runtime/hosts/claude-code/operations/assets/tmux.mjs` 的助手自己",
  "建 tmux 会话、开全部窗口，窗口开好后告诉你要执行的那一条 `tmux attach` 命令（worktree pod 各有",
  "自己的会话 `<会话名>-<pod 名>` 和各自的 attach 命令）、要接受哪些信任对话；投递 prompt 也走同一个",
  "助手。桌面会话传输下 Controller 通过装在同一位置的 `desktop.mjs` 把每个窗口作为一个会话开进 app 的",
  "侧栏，用 app 自己的会话消息投递 prompt；只有你能做的事：用 Claude 订阅登录桌面 app，Wakeflow 工作",
  "期间让 app 开着；对 Claude Code 还不信任的目录只需决定一次——工作区根（它的信任同时覆盖工作区内的",
  "Design、Test 面）与每个产品仓库：引导会话把它们列出来、说明信任意味着什么，",
  "你同意后由它在桌面 app 里逐个打开，app 随即记下信任（当前版本不再弹窗）；想自己来也可以：在 app 里",
  "打开该目录或在终端里到该目录运行 `claude`，接受信任对话。没有你的同意，不会信任任何目录。",
  "Controller 把窗口切到 `auto` 权限模式时，app 可能每个目录弹一次确认卡，确认一次",
  "即可（目录会记住）。维护还会往工作区根的 `.claude/settings.json` 写只放行所发布助手和",
  "Wakeflow MCP 工具的 allow 规则；助手启动的每个窗口也带着这两项放行启动，所以产品窗口和测试窗口",
  "同样不会为它们弹权限。不会写 `Bash(tmux *)` 之类更宽的规则。因此 Wakeflow 写过的根，",
  "其信任对话框只会列出这几条；对话框里若出现 `Bash(git *)`、`Bash(node *)`、`Bash(tmux *)` 或 `..` 目录，",
  "那是 0.9.x 的残留或仓库自己的设置——接受就会生效，先删掉或确认再接受。",
  "",
  "助手启动的每个窗口缺省以 Claude Code 的 `auto` 权限模式运行：常规操作由 Claude Code 自己审，",
  "不再逐条问你。窗口第一次仍可能问你一个一次性的问题（例如是否允许读取工作目录之外的文件），",
  "Controller 会告诉你是哪个窗口在问。你的账号没有 auto 模式时，让 Controller 经维护把",
  "`hosts.claude-code.launch.permissionMode` 设为 `acceptEdits`；之后窗口执行命令时会弹权限确认。",
].join("\n");

/** 更新后的换代按传输并列（ADR-0025 D6、裁定 2）：tmux 由 Controller 经助手就地重启；桌面由 app 自行重载服务（X20），不重载时重开会话。 */
const PLUGIN_UPDATE_STEPS_EN = [
  "Updating is two host actions and one Wakeflow read. Refresh the marketplace catalog",
  "with `/plugin marketplace update gxfn` (from a shell: `claude plugin marketplace update",
  "gxfn`), then update the plugin: in a session open `/plugin`, pick Wakeflow under",
  "Installed and choose Update now; from a shell, `claude plugin update wakeflow@gxfn`.",
  "Claude Code replaces the installed copy only when the plugin's manifest version",
  "changed, and every Wakeflow release changes it. Running sessions keep the old hooks and",
  "MCP server until `/reload-plugins` or a new session, so the Controller's",
  "`wakeflow_status` then reports `runtime-artifact-outdated` for its own server and",
  "`windows-stale:<n>` for peer windows started under the previous artifact. Under the tmux",
  'transport the Controller refreshes them itself through the tmux helper (its skill section "After a',
  "plugin update\"); under desktop sessions the desktop app reloads each session's Wakeflow",
  "server on its own within a few turns - if the Controller's does not, archive and unarchive it and",
  "message it, which restarts its process on the current artifact -",
  "and the Controller then verifies and reconciles. Expect `wakeflow_verify` to pass",
  "`runtime-artifact` again once no window is stale; `unverified` is not a failure.",
].join("\n");

const PLUGIN_UPDATE_STEPS_ZH = [
  "更新是两步宿主动作加一次 Wakeflow 读取。先用 `/plugin marketplace update gxfn`（shell 里是",
  "`claude plugin marketplace update gxfn`）刷新 marketplace 目录，再更新插件：会话里打开 `/plugin`，",
  "在 Installed 下选中 Wakeflow 点 Update now；shell 里是 `claude plugin update wakeflow@gxfn`。",
  "Claude Code 只在插件清单的版本号变化时替换已安装的副本，Wakeflow 每次发布都会改它。正在运行的",
  "会话在 `/reload-plugins` 或新会话之前仍用旧的 hook 与 MCP server，所以 Controller 的",
  "`wakeflow_status` 会对自己的 server 报 `runtime-artifact-outdated`、对在旧制品下启动的同伴窗口报",
  '`windows-stale:<n>`。tmux 传输下 Controller 按技能的 "After a plugin update" 一节用 tmux 助手自己',
  "刷新它们；桌面会话传输下桌面 app 会在几个回合内自行重载各会话的 Wakeflow 服务——Controller 的",
  "服务没有重载时，归档再取消归档并发一条消息即可令其以当前制品重起——然后 Controller 校验并对账。没有窗口再是 stale 之后，",
  "`wakeflow_verify` 的 `runtime-artifact` 门重新通过；`unverified` 不是失败。",
].join("\n");

/** 十二个占位符的 Claude Code 取值；键序与 D3 列出的顺序一致，新增的排在最后。 */
export const CLAUDE_CODE_AGENT_TEXT_PLACEHOLDERS: Readonly<
  Record<ClaudeCodeAgentTextPlaceholderKey, Readonly<ClaudeCodeAgentTextPlaceholderValue>>
> = Object.freeze({
  instructionFile: Object.freeze({ en: INSTRUCTION_FILE }),
  windowLaunch: Object.freeze({ en: WINDOW_LAUNCH }),
  windowBootstrap: Object.freeze({ en: WINDOW_BOOTSTRAP }),
  deliveryAction: Object.freeze({ en: DELIVERY_ACTION }),
  worktreeLaunch: Object.freeze({ en: WORKTREE_LAUNCH }),
  commandSurface: Object.freeze({ en: COMMAND_SURFACE_EN, zh: COMMAND_SURFACE_ZH }),
  hostTrustSteps: Object.freeze({ en: HOST_TRUST_STEPS_EN, zh: HOST_TRUST_STEPS_ZH }),
  windowResume: Object.freeze({ en: WINDOW_RESUME }),
  resendGuard: Object.freeze({ en: RESEND_GUARD }),
  pluginUpdateSteps: Object.freeze({ en: PLUGIN_UPDATE_STEPS_EN, zh: PLUGIN_UPDATE_STEPS_ZH }),
  hostEffectRule: Object.freeze({ en: HOST_EFFECT_RULE }),
  firstRunHandover: Object.freeze({ en: FIRST_RUN_HANDOVER }),
});

/** 未登记占位符的稳定错误码；构建器的预检先于它触发，本抛出是最后一道防线。 */
export const CLAUDE_CODE_AGENT_TEXT_UNKNOWN_PLACEHOLDER_CODE =
  "wakeflow-agent-text-unknown-placeholder";

function claudeCodeAgentTextValue(key: string, language: ClaudeCodeAgentTextLanguage): string {
  const value = (
    CLAUDE_CODE_AGENT_TEXT_PLACEHOLDERS as Readonly<
      Record<string, Readonly<ClaudeCodeAgentTextPlaceholderValue> | undefined>
    >
  )[key];
  if (value === undefined) {
    throw new Error(`${CLAUDE_CODE_AGENT_TEXT_UNKNOWN_PLACEHOLDER_CODE}: ${key}`);
  }
  return language === "zh" ? (value.zh ?? value.en) : value.en;
}

/** 一次封闭替换：遍历一遍源文本，替换结果不再被回扫。 */
export function renderClaudeCodeAgentText(
  source: string,
  language: ClaudeCodeAgentTextLanguage,
): string {
  return source.replace(/\{\{([A-Za-z]+)\}\}/gu, (_match: string, key: string): string =>
    claudeCodeAgentTextValue(key, language),
  );
}
