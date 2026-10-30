# Claude 桌面会话树作为 Wakeflow 第二种窗口传输的调研（2026-10-29）

状态：active（调研结论；现场 L17 已于 2026-10-29 执行，结果见第 9 节与 §13.220；设计提案见[适配方案](./2026-10-29-claude-desktop-transport-design.md)；本文不改任何运行时行为）。

## 0. 问题与边界

用户观察到 Claude 桌面客户端（Code 标签）现在把一个会话开出的会话嵌套在它下面，形似 Codex 应用的线程树，问：对比现在 Claude Code 宿主用的 tmux 传输，能否把 Wakeflow 的 Claude 宿主做到桌面客户端上。

本文只回答三件事：桌面客户端今天真实提供了什么（本机核实 + 官方文档 + GitHub issue），这些能力与 Wakeflow 的宿主操作如何对应，以及立项前还必须现场核实什么（L17）。边界不变：Wakeflow 不开窗口、不发 prompt，宿主传输只是 Controller 执行效果的适配层，落地仍只由 hook 观察记录证明（CLAUDE.md "Claude Code Host Boundary"）。

## 1. 事实清单

### 1.1 本机核实（2026-10-29，Claude 桌面 4.29.0，内置 Claude Code 2.1.309；终端 CLI 2.1.303）

- 本会话（桌面 Code 标签，auto 模式）拿到的会话管理工具：`list_sessions`、`get_session`、`send_message`、`list_events`、`set_session_title`、`stop_session`、`set_session_permission_mode`、`clear_session`、`archive_session`、`unarchive_session`、`delete_session`、`detach_session`、`open_session_in`、`get_window_layout`、`change_directory`、`request_directory`、`spawn_task`，以及跨会话的 `SendMessage`/`ListAgents`。**没有** `start_session`、`hand_off_to_session`、`list_start_targets`，尽管前面多个工具的说明都引用它们。
- `list_sessions` 每行给 `sessionId`（`local_<uuid>`）、`title`、`cwd`、`branch`（worktree 会话才有）、`isRunning`、`lastActivityAt`、`group`、`link`（`claude://…`）；`get_session` 另给 `permissionMode`（只对本会话与本会话开的会话报告）、`model`、`effort`、`createdAt`、`parentSessionId`。桌面 id 与 hook 看到的 Claude session_id 不是同一个 id（本会话两者不同）；而由 `claude --desktop --resume <id>` 带进桌面的 CLI 会话，桌面 id 恰是 `local_<同一个 uuid>`。
- `send_message` 的结果只分 delivered（对方回合已开始）与 queued（排在对方当前工作后面）并带 message_id；消息以"From <发送会话标题>"的用户回合落到对方。`SendMessage` 支持 `notify_when_idle`（对方下次空闲时一次性通知）。
- Code 标签设置（`get_settings`）：worktree 位置"项目内 `<repo>/.claude/worktrees`"，分支前缀 `claude`，默认权限模式 default，auto 与 bypass 均未被策略禁用。
- 插件：桌面日志显示每次开会话都把已启用插件经 stdin 交给 Claude Code（"N plugin(s) go to Claude Code over stdin"），worktree 会话另带 `--project-config-root <主检出>`。Wakeflow 插件在本会话里已加载（`wakeflow_*` 工具在列）。
- **hook 在桌面会话里触发（已证实）**：在 WakeflowTestWorkspace9 根目录经伪终端执行 `claude --desktop --resume <一个已结束的 CLI 会话 id>`，命令打印 "Opening session … in Claude Desktop" 后退出 0；4 秒后工作区 `.wakeflow-local/runtime/hosts/claude-code/observations/hooks/` 下出现一条 `session-start` 记录：`hostId: claude-code`、`sessionId` 等于那个 CLI 会话 id、`cwd` 等于工作区根、`artifactVersion: 1.2.0`、manifest 摘要等于当前制品。观察器按会话 cwd 定位工作区，对桌面会话与 tmux 会话完全同形。直接以重定向输出运行同一命令被拒绝："--desktop … can't run non-interactively (`--print`, `--sdk-url`, `--init-only`, or redirected output)"。
- 这条记录让工作区的 `runtime-artifact` 门报 `windows-stale:9`：桌面会话跑的是今天重建后的制品，9 个 tmux 窗口是重建前开的；这是 C6/C11 版本轴的正确结果，不是桌面差异。
- `claude agents --json`（CLI 侧，不需要任何桌面工具）把桌面 Code 标签会话列为 `kind: interactive`，带 `status`（busy/idle）、`cwd`、`name`、`sessionId`、`pid`；本机三个桌面会话都在列，tmux 里的 CLI 窗口不在。
- 裸 `claude --desktop`（伪终端）打印 "Opening <目录> in Claude Desktop"，桌面切到该目录的新会话页，不启动进程、不产生 hook 记录。
- `spawn_task` 只生成一张要用户点一下的卡片，启动的会话在 `<repo>/.claude/worktrees/<随机名>`、分支 `claude/<随机名>`；本仓库由它开的那个子会话（W37）就是这样的 worktree 会话，`get_session` 报 `parentSessionId`，但 `list_sessions {linked:true}` 不列它（issue 99393）。

### 1.2 官方文档（code.claude.com，2026-10-29 读取）

- 桌面会话：每个会话有自己的历史与项目文件夹；"Worktree 默认关闭，Claude 直接在项目文件夹里工作"；开启后 worktree 在 `<project-root>/.claude/worktrees/`，分支加前缀；"+ 添加文件夹"进来的目录直接工作、无 worktree。
- 由建议卡片启动的任务"在侧栏列在当前会话下面"（嵌套）；"Start all" 每个任务各开一个会话；都要用户点击。
- 跨会话（桌面）：Claude 可列出、读取并给其他本地/SSH/WSL 会话发消息（默认看最近 20 个，不含云会话与终端 CLI 会话），可重命名与归档（归档在 Manual 模式下有确认卡）；接收方忙时"保留消息，当前工作结束后再读"；`crossSessionInbound: refuse` 丢弃。
- 跨会话消息（通用页）：同机经每会话 socket 投递，不经 Anthropic 服务器；接收方在工具调用之间读消息（与桌面页"工作结束后再读"的说法冲突，两页都原文引用，未调和）；无显式设置时按双方权限模式分类决定：会提示的接收方（auto、acceptEdits、dontAsk 都算"会提示"）直接送达，只有发送方自报 bypass 时才扣住待批；bypass 的接收方反之。桌面 app 与 VS Code 扩展"不能显示审批对话框"。单条约一百万字符上限，队列最多 50 条。
- 配置共享："桌面与 CLI 读同一套配置文件"：hooks、技能、`settings.json` 的权限规则都对桌面会话生效；`claude_desktop_config.json` 里的 MCP 只进桌面会话；worktree 会话的 hook 从主检出根运行、`CLAUDE_PROJECT_DIR` 指向主检出、hook 输入的 `cwd` 是 worktree。找不到 `node` 时要重启桌面 app 重载 PATH。
- CLI：`--desktop` "在当前目录打开桌面 app 并退出，不在终端开会话"，加 `--continue`/`--resume <id>` 打开已有会话，"不接受 prompt 与其他参数，因为由 app 自己启动会话"（2.1.285+，订阅登录）；`--bg "<prompt>"` 后台开会话并立刻打印 id（可配 `--name`、`--permission-mode`、`--add-dir`、`--session-id`），`claude stop <id>`，`claude agents --json` 是"从 Claude Code 之外读会话状态的受支持方式"。深链 `claude://code/new?q=…` 只预填 prompt，"绝不替你发送"，且只有 SSH 参数、没有本地目录参数。

### 1.3 GitHub issue（anthropics/claude-code，2026-10-29 读取）

- `start_session` / `hand_off_to_session` / `list_start_targets` 在桌面构建里存在，但由**服务端开关**控制：有的账号 10 月 8–14 日有过然后消失（"Its MCP server 'ccd_session' is connected but does not offer this tool here"），有的调用返回 "Starting sessions is not enabled here"（#100913 及评论）。
- 开关打开时的行为（#104101、#105099、#103978、#104683、#104676、#102625、#103260）：`initiation: user_asked | own_initiative`（后者只提议卡片）；自 Claude Code 2.1.304 起每次都弹 "Allow Claude to start the session? Deny / Allow once"，bypass、`permissions.allow`、PreToolUse hook 都压不掉；自动回合（定时、他会话消息、父会话交办）里拒绝调用（"Start sessions only on the user's own words to you here"）；子会话默认建 worktree（大仓库上曾卡在建 worktree 后 300 秒超时）；子会话每结束一个回合就把摘要加末尾 400 字送回父会话并开一个父回合（无开关），父会话因此被标成"需要输入"；模型会自发级联开会话（一天 46 个）。
- `send_message` 对忙碌的桌面会话只在其整个回合结束后才送达，不在下一个工具调用（#95086、#103260，与通用页说法相反）；对定时任务/远程派发的"无人值守"会话拒绝投递，且曾误判普通会话（#90912）。
- `spawn_task` 卡片必须点击，会话不进 `linked` 列表（#99393），手机端看不到（#101882）；无人值守的批量开会话是长期未满足的请求（#89783）。
- 一条零点击的原生绕行（#100913 评论，macOS/Windows 均报可用）：`claude --bg --name "<标题>" --model … "<首条 prompt>"` → `claude stop <id>` → 从真实终端 `claude --desktop --resume <id>` → 会话进入桌面侧栏，再向它发真正的 prompt。本机核实了后两步（见 1.1）。

## 2. 与 Wakeflow 宿主操作的对应

| Wakeflow 操作 | 今天：Claude Code（tmux） | 今天：Codex | 桌面候选 | 证据 | 缺口 |
| --- | --- | --- | --- | --- | --- |
| 开窗 | 助手 `launch` 在 tmux pane 起 `claude --add-dir …` | `list_projects` + `create_thread` | A：`start_session`（开关）；B：`claude --bg` 在执行根起会话 + `claude stop` + 伪终端里 `claude --desktop --resume`；C：裸 `claude --desktop` 切到目录后由用户按回车 | 1.1、1.3 | A 未对本账号开放且必弹确认；B 的 `--bg` 与 `--desktop --resume` 组合未在本机连起来试过；C 需用户输入 prompt |
| 登记 | 句柄 `claude-session` + tmux 坐标 | 句柄 `codex-thread` | 句柄仍是 Claude session_id，定位子改为桌面 id `local_…`（B 路径下恰为同一 uuid） | 1.1 | 绑定 Schema 要加桌面定位分支 |
| inspect | 助手 `panes` 读五个窗口选项 | 线程存在性 | `get_session`/`list_sessions`（isRunning、cwd、branch）或 CLI 侧 `claude agents --json`（status、pid） | 1.1 | 无 |
| 投递 | 助手 `deliver` 送 pane 再回读 | 线程工具发送 | `send_message`，返回值作 `attempt.sendReturn`，落地仍看目标的 `user-prompt-submit` 记录 | 1.1、1.2 | 消息外包一层 "From …"，fence 是否原样进 hook 记录待核 |
| 回调 | 产品窗口 send-keys 到 Controller pane | 线程工具 | 产品窗口 `send_message` 给 Controller | 1.2 | Controller 忙时只在回合末送达（设计上回调到达时 Controller 应已停在"投递已发送"） |
| mark | tmux 窗口名 | `set_thread_title` | `set_session_title` | 1.1 | 用户改过标题时弹确认 |
| resume / relocate / replace | 助手 `resume`（exited 会话不能续）、relocate 换 pane | 不适用 / replace | 桌面会话是持久对象：发消息即续；relocate 不适用；只有归档或删除后才 replace | 1.2 | 无 |
| close | 助手 `close` | 归档线程 | `archive_session`（需用户授权） | 1.2 | 无 |
| pod | 每 pod 一个 tmux 会话，检出在 `<repo>/.claude/worktrees/wakeflow-<pod>` | create_thread 的 worktree 环境 | 会话 cwd 指向 Wakeflow 自己的检出（B 路径可以；A 路径自建随机名 worktree，不合） | 1.1、1.3 | 侧栏分组（`ccd_sidebar`）可作 pod 分组 |
| 状态行 / `@wakeflow_state` | 状态行 + tmux 窗口选项 | 无 | 无落点，只有标题 | 1.2 | attention 语义只能靠标题 |
| 信任与权限 | 每目录信任对话、`.claude/settings.json` 精确规则 | `/hooks` 信任 | 同一套 `settings.json` 生效；权限模式按目录记忆；`set_session_permission_mode` 提权弹卡 | 1.2 | 无新增 |

## 3. 三条开窗路径

- **A. `start_session`**：语义最贴合（嵌套树、父子关系），但本账号没有、服务端开关、每次确认、自动回合里不能用、默认建随机名 worktree、子会话回合末必唤父会话（Controller 会被每个窗口的每个回合唤醒并重发整段上下文）。在 Anthropic 给出 `notify_parent`/免确认设置之前，不能作为 Wakeflow 的基线。
- **B. 原生 CLI 组合**：`claude --bg` 在正确的 cwd 用正确的 `--add-dir`、`--permission-mode auto`、`--name` 起会话（打印 id），`claude stop <id>`，再在伪终端里 `claude --desktop --resume <id>`。不依赖任何开关，会话进侧栏、hook 照常、桌面 id 可预测（`local_<id>`）。代价：三步、需要伪终端（Controller 在桌面里的 Bash 无 TTY，可用 `script` 包一层）、第一条 prompt 由 `--bg` 带入（可作启动提示）。这是目前唯一零点击且可预测的路径，L17 要先把它连起来跑通。
- **C. 用户参与**：裸 `claude --desktop` 把桌面切到目标目录，用户在新会话页按回车（或粘贴 Controller 给的启动提示）。与 Codex 文本里"创建工具不可用时用 UI 直接确认"同类，可作 B 失败时的退路。

## 4. 风险与未知

1. B 路径的 `--bg` → `stop` → `--desktop --resume` 三步在同一台机器上是否稳定把会话交给桌面（本机只验了后两步）；`stop` 后再 resume 会不会改 session id（本机 resume 保持了 id）。
2. `send_message` 外包的 "From …" 标签是否改变 hook 记录里的 prompt 正文，fence 能否按今天的规则匹配。
3. Controller 自己在桌面里时，它的 Bash 没有 TTY：`script -q` 包装 `claude --desktop` 在桌面会话的 Bash 里是否可用。
4. 桌面会话忙时消息只在回合末送达；Wakeflow 的两个方向（投递、回调）设计上都落在对方空闲时，但 Design/Test 窗口被用户占用时的投递要有明确的 queued 处理。
5. `set_session_title` 对用户改过的标题弹确认；`archive_session` 在 Manual 模式弹确认——都是可接受的"只有你能做的那一步"，但文本要写明。
6. 桌面 app 的会话工具是应用内部接口，随版本变动（10 月内已有工具被开关撤回、确认卡新增）；传输层必须可替换，状态权威不能沾它。
7. 静态技能文本按宿主在构建时渲染，不能按传输切换；开窗与投递的分步必须放进工具返回的 launch instructions，Controller 窗口参考现在卡在 400 行预算。
8. 两份 Claude Code 并存：桌面内置 2.1.309 自动更新，终端 CLI 2.1.303；B 路径的 `--bg` 用的是 PATH 上的 CLI，`--desktop --resume` 后由桌面内置版本接管。版本轴只认 Wakeflow 制品版本，不受影响，但行为差异要在 L17 记录。

## 5. 现场 L17 方案（立项前必做）

在一个可丢弃工作区（WakeflowTestWorkspace 系列）上，不改代码，只用现有工具与 CLI：

1. 用户在一个全新的桌面会话里让 Claude 列出它的工具，确认 `start_session` 是否出现（决定 A 路径是否可选）。
2. 我在 Controller 位置（桌面会话或终端均可）跑 B 路径：在产品仓库根 `claude --bg --name "<窗口名>" --permission-mode auto --add-dir <工作区根> "<启动提示>"`，`claude stop`，伪终端 `claude --desktop --resume`；核对侧栏出现该会话、`list_sessions` 给出 `local_<id>`、`.wakeflow-local` 里有 `session-start`。
3. 用 `send_message` 向它投一条带 fence 的 prompt，核对 `user-prompt-submit` 记录与 fence；再让它用 `send_message` 回调 Controller，核对 Controller 侧记录。
4. 对一个 Wakeflow pod 检出（`<repo>/.claude/worktrees/wakeflow-<pod>`）重复第 2 步，核对 hook 记录的 cwd 与 `CLAUDE_PROJECT_DIR`。
5. 记录每一步的确认卡、耗时与失败码，写进 gate-log。

通过标准：第 2–4 步都拿到与 tmux 传输同形的 hook 记录；投递与回调各一次成功且有 fence 匹配；没有一步需要用户点卡片。

## 6. 设计草图（L17 通过后再立项）

- 一个宿主、两种传输：`claude-code` 宿主的配置加 `windowTransport: "tmux" | "desktop"`（每工作区一种，init 时按引导会话所处环境选）。制品、hook、设置、技能都不变。
- 绑定 Schema：`tmux` 定位子旁加 `desktop` 分支（`local_<id>`，桌面 cwd 快照）；观察类型加 `desktop-sessions`（`claude agents --json` 或 `list_sessions` 的行）。
- launch instructions 渲染器按传输给出分步命令（B 路径三步或 A 路径一步），文本只说"照工具返回的步骤做"。
- tmux 资产、状态行在 desktop 传输下不发布；`@wakeflow_state` 投影在无 `$TMUX` 时本就静默。
- 规模与批 E 相当，两道门：传输核心（开窗、登记、投递、回调、关窗、场景链）一道，pod 与侧栏分组、标题一道。ADR 先行。

## 7. 建议

可以做，而且 B 路径不依赖任何开关，今天就能现场验证；A 路径等开关与 `notify_parent` 之类的控制出现后再切换。下一步是 L17，不是写代码。

## 8. L17 结果（2026-10-29 补）

在 WakeflowTestWorkspace9 上，不改代码，只用现有工具与 CLI（桌面 4.29.0 内置 Claude Code 2.1.309，终端 CLI 2.1.303）：

- **E1 三步开窗（B 路径）通过。** 产品仓库根 `claude --bg "<prompt>" --name "L17 Alembic" --permission-mode auto --add-dir <工作区根>`：10 秒 done；`claude stop`；伪终端 `claude --desktop --resume <id>`：Opening session、退出 0，侧栏出现会话，桌面 id `local_<同一 uuid>`，hook 写出两条 session-start（bg 启动与桌面接手）。第一次失败的教训：prompt 跟在变长的 `--add-dir` 后面会被当成目录，会话空闲起步；从未对话的会话 `--desktop --resume` 报 No session found。
- **E2 fence 匹配通过。** 把该桌面会话登记为 Alembic 窗口后（用窗口原有的 tmux 坐标做 replace，因为没有 tmux 坐标的观察被拒 `tmux-coordinates-required`），桌面 `send_message` 与跨会话 `SendMessage` 各投一条：两条 user-prompt-submit 记录的 promptDigest 都等于原始正文的 digest；会话记录里看到的 "Another Claude session sent a message:" 前缀、`<cross-session-message …>` 元素与末尾说明只是渲染，hook 的 `prompt` 是原文。现有 unwrap 与落地规则都不用改。
- **E3 回调通过。** 让该产品会话用 `SendMessage` 发回本会话：本会话正忙，得到 queued，"回合结束后送达并开新回合"。
- **E4 权限模式不跨过桌面。** 该会话自报 `permissionMode=default`（`--bg` 给的是 auto）、模型是桌面默认 Opus 5.5。
- **E6 pod 检出。** `claude --bg --worktree wakeflow-live16`（仓库根）在既有 pod 检出里跑、进桌面、hook 记录 cwd 为检出路径；但 `claude stop` 提示 "worktree retained … run claude rm to remove worktree"，桌面 `get_session` 报 `worktreePath/worktreeName`——app 把 Wakeflow 的检出当成自己的。
- **E7 `--bg` 忽略 `--session-id`。** 警告 "--bg manages the session id"。
- **E8 以检出为 cwd 直接 `--bg`。** 通过；桌面只报 `branch` 与 `originCwd`，不报 `worktreePath`。
- **未做。** E5 换代（归档/取消归档）需用户明确同意归档具体会话；第 1 步（新会话里确认 `start_session`）需用户自己做。

副作用：侧栏多了 L17 Alembic、L17 pod Alembic、L17 pod cwd 与一个无标题的 workspace9 会话；agent view 留有四个 done 的后台作业（其中 62e6867e 持有 pod 检出，**不要** `claude rm` 它）；workspace 9 的 Alembic 窗口绑定经两次 replace 回到原来的 tmux 会话句柄；本机 tmux 服务器已不在运行，9 个 tmux 窗口本就已退出。

## 9. 来源

- https://code.claude.com/docs/en/desktop
- https://code.claude.com/docs/en/worktrees
- https://code.claude.com/docs/en/agent-view
- https://code.claude.com/docs/en/cross-session-messaging
- https://code.claude.com/docs/en/cli-reference
- https://github.com/anthropics/claude-code/issues/100913
- https://github.com/anthropics/claude-code/issues/105647
- https://github.com/anthropics/claude-code/issues/104101
- https://github.com/anthropics/claude-code/issues/105099
- https://github.com/anthropics/claude-code/issues/104683
- https://github.com/anthropics/claude-code/issues/104676
- https://github.com/anthropics/claude-code/issues/103978
- https://github.com/anthropics/claude-code/issues/103260
- https://github.com/anthropics/claude-code/issues/102625
- https://github.com/anthropics/claude-code/issues/95086
- https://github.com/anthropics/claude-code/issues/99393
- https://github.com/anthropics/claude-code/issues/90912
- https://github.com/anthropics/claude-code/issues/89783
