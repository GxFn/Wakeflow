# Claude 桌面端 Wakeflow 适配方案（设计提案，2026-10-29）

状态：accepted（用户 2026-10-30 对第 11 节四个决定点按推荐裁定；ADR 随 K1 的首个提交落下，再按第 10 节分批）。前置：[调研文档](./2026-10-29-claude-desktop-window-transport-research.md)与现场 L17（§13.220）。

## 0. 目标与非目标

本方案是[双传输规划](./2026-10-30-claude-host-dual-transport-plan.md)的桌面分册：tmux 传输继续作为一等传输维护，两者的原则、对等矩阵、维护规则与批次顺序以规划为准，本文只写桌面侧的设计。

目标：Wakeflow 的 Claude 宿主在桌面 app 的 Code 标签里完整运行——每个窗口是一个桌面会话、在侧栏里可见、投递与回调走宿主原生消息、落地仍只由 hook 记录证明，用户不再需要 tmux。

非目标：不改状态权威、证据与追加式历史；不做 tmux 与桌面逐窗口混搭；不依赖 `start_session` 这类受服务端开关控制的工具；不把桌面 app 的会话工具当作状态来源；不新增宿主 id。

## 1. L17 证实的事实与它们对设计的约束

| 事实（2026-10-29，桌面 4.29.0 / Claude Code 2.1.309，CLI 2.1.303） | 约束 |
| --- | --- |
| `claude --bg "<prompt>" --name … --permission-mode auto --add-dir …` 在产品仓库根起会话，一回合约 10 秒到 done；`claude stop <id>`；伪终端里 `claude --desktop --resume <id>` 打印 Opening session 并退出 0，会话进侧栏，桌面 id 恒为 `local_<同一 uuid>` | 三步开窗是可行的基线；prompt 必须放在变长参数（`--add-dir`、`--allowedTools`）之前 |
| 从未对话的会话 `--desktop --resume` 报 No session found | 首回合必须真的跑一轮（启动提示），与 tmux 助手的 resume-never-conversed 同源 |
| `--bg` 忽略 `--session-id`（"--bg manages the session id"） | 会话 id 由宿主分配、从 `--bg` 输出或 `claude agents --json` 读回；launch intent 的 `sessionIdPolicy` 需要新值 |
| `--desktop --resume` 不能在重定向输出下运行 | 助手用 `script -q /dev/null` 包一层伪终端 |
| 桌面接手后会话的 permissionMode 变为 default（`--bg` 的 auto 不跨过） | 模式一致性必须另行保证（第 3.4 节） |
| hook 在桌面会话里照常触发；但 user-prompt-submit、stop 等记录只写给已登记的会话（D2） | 登记前只能看到 session-start；设计不变 |
| 两条投递路线（桌面 `send_message`、跨会话 `SendMessage`）到 hook 的 `prompt` 都只有原始正文，记录的 promptDigest 等于 permit 的 digest；会话记录里的 "Another Claude session sent a message" 与 `<cross-session-message>` 只是渲染 | 落地规则与 unwrap 都不用改 |
| 向忙碌的桌面会话发消息得到 queued，在其回合结束后自动开新回合送达；空闲时 delivered | 回调能自动唤醒空闲或忙碌的 Controller；投递到忙碌窗口按现有 landing-silence 处理 |
| 登记合同拒绝没有 tmux 坐标的观察（`tmux-coordinates-required`） | 绑定 Schema 与宿主准入要加桌面定位子分支 |
| `claude --bg --worktree <name>` 让 agent view 的作业持有检出，`claude stop` 提示 `claude rm` 会删除 worktree；桌面 `get_session` 报 `worktreePath/worktreeName`，归档"默认清理其 worktree" | pod 窗口绝不用 `--worktree`，绝不 `claude rm`，pod 打开期间绝不归档其窗口 |
| 以检出目录为 cwd 直接 `--bg`：桌面只报 `branch` 与 `originCwd`，没有 `worktreePath` | pod 窗口的开法：cwd = Wakeflow 自己的检出 |
| `claude agents --json` 把桌面会话列为 interactive，带 status/cwd/name/sessionId/pid | 窗口存活观察的来源，不需要桌面工具 |

## 2. 总体形态：一个宿主、两种传输

- 宿主仍是 `claude-code`。配置 `hosts.claude-code.windowTransport: "tmux" | "desktop"`，每工作区一种，fresh-initialize 时由引导会话的环境决定（会话里有 `ccd_session_mgmt` 工具即 desktop，否则 tmux），reconfigure 可切换（退役全部窗口投影，再按新传输开窗）。
- 不变：制品、hook 片段、`.claude/settings.json` 的精确允许规则、技能文本的主体、Demand 流程与十六道门。
- 随传输变化的只有六处：launch instructions 渲染器、助手资产、绑定观察的定位子分支、窗口存活观察的分类、维护的宿主资产集合、交接卡文本。

## 3. 开窗

### 3.1 助手资产 `desktop.mjs`

与 `tmux.mjs` 同一发布机制与同一允许规则形状（`Bash(node <绝对路径> *)`），子命令四个：`preflight`、`launch`、`sessions`、`landing`（K1 实现；改名、发送、归档由 Controller 直接用桌面工具，见 ADR-0025 D4）。它只是把三步 CLI 序列搬到 Agent 手里，仍只输出现有 MCP 工具要求的观察 JSON，Wakeflow 本身不 spawn 进程。

### 3.2 `launch --window <id>`（stdin 是 inspect 结果）

1. 在执行根运行 `claude --bg "<启动提示>" --name "<显示名>" --permission-mode auto --effort <配置> --add-dir … --allowedTools …`（变长参数在最后）。pod 窗口的执行根是 Wakeflow 自己建的检出，不传 `--worktree`。从输出读回会话 id。
2. 轮询 `claude agents --json` 直到该 id 的 state 为 done（启动提示的首回合只要求"读完提示、回复 ok"），然后 `claude stop <id>`。
3. 伪终端 `claude --desktop --resume <id>`，等该 id 新的 session-start 记录（source=resume）。
4. 输出 creation observation：`handle: claude-session=<id>`、`desktop: { sessionId: "local_<id>", cwd, title }`、worktree 观察（同 tmux）。

失败码：`not-trusted`（`--bg` 退出 Workspace not trusted，用户要先信任该目录）、`desktop-resume-refused`（会话仍在运行或从未对话）、`desktop-unavailable`（app 未运行或未用订阅登录）、`prompt-position`（内部：prompt 被变长参数吞掉，由助手自检）。

### 3.3 启动提示

内容与今天相同（windowId、角色技能、执行根、回传指针），只加一句：首回合只回复 ok。`--name` 给的显示名会进入 hook 的 `session_title` 字段。

### 3.4 权限模式一致性（决定点 1）

桌面接手后模式回到该目录记忆的值。候选：
- (a) Controller 调 `set_session_permission_mode(local_<id>, "auto")`：每窗一次确认卡。
- (b) 用户在每个目录的选择器里选一次 auto（按目录记忆）：一次性动作，交接卡列出。
- (c) 用户级 `permissions.defaultMode: auto`：所有会话都 auto，范围最大。

方案建议 (b)，并把模式进证据：hooks 文档核实 `permission_mode` 是通用输入字段（值 default / plan / acceptEdits / auto / dontAsk / bypassPermissions），UserPromptSubmit 示例带它、SessionStart 示例没有，所以证据来自第一条 user-prompt-submit 记录而不是登记时：观察记录加可选字段 `permissionMode`，投递落地时该记录的模式不是 auto 就在窗口上记阻塞 `permission-mode-mismatch:<windowId>`（投递本身已落地，窗口仍可工作，只是会向用户要权限），Controller 据此提醒用户按 (b) 处理一次。(a) 不自动做；(c) 由用户自己选。

## 4. 登记与定位子

- 绑定 Schema：`creationObservation` 加可选 `desktop` 分支（`sessionId` `local_…`、`cwd`、`title`），与 `tmux` 二选一；宿主准入由 `tmux-coordinates-required` 改为按传输要求对应的定位子。
- 观察类型：`tmux-panes` 旁加 `desktop-sessions`——`claude agents --json` 的行（sessionId、status、cwd、name、pid）；Wakeflow 分类 present-busy / present-idle / absent，Agent 不判存活。
- 身份不变：句柄仍是 hook 的 session_id；桌面 id 只是定位子。B 路径开出的窗口桌面 id 恒为 `local_<session_id>`（L17 三个会话一致）；UI 建的会话（引导会话、Controller 自己）两者不同，Controller 用 `get_session self` 读自己的桌面 id 作为回传指针，观察里的 `desktop.sessionId` 一律显式填写、不派生。
- 观察记录新增可选字段 `permissionMode` 与 `sessionTitle`（hook 输入自带），让模式与标题都有证据，`mark` 可以靠记录核对而不是读屏。

## 5. 投递与回调

- `deliver --window <id> --prompt-ref … --prompt-digest …`：助手不发消息，只做幂等核对与等待；发送本身由 Controller 用 `send_message(local_<id>, prompt)` 完成（Wakeflow 不发 prompt 的边界不变），返回值（delivered 或 queued、message_id）原样作 `attempt.sendReturn`；落地仍等目标的 user-prompt-submit 记录，digest 相等（L17 证实无需改 unwrap）。queued 时沿用 landing-silence 规则。
- 回调：目标窗口 `SendMessage` 到 `local_<controller>`；Controller 忙时排队、回合结束自动开新回合——回调因此自动唤醒 Controller，`/wakeflow:next` 的"回调到达即继续"不再依赖用户。
- 前提：双方权限模式同类（第 3.4 节），否则消息被扣住等用户批准。
- 失败码：`send-refused`（Not sent）、`window-archived`、`send-held`（模式不一致）。

## 6. 窗口生命周期

- inspect：读 `desktop-sessions` 观察；exited 这一类消失；absent 表示会话被归档或删除。
- resume：不需要，发消息即续；relocate 不适用（同 Codex）；replace：absent 后重新 launch。
- 制品更新后的换代（决定点 2）：候选 `archive_session` + `unarchive_session`（归档停进程、取消归档后下一回合重起），需先现场验证；验证前文本写"重启桌面 app 后 reconcile"。
- close：`archive_session`，只在用户授权退役时；pod 打开期间不归档 pod 窗口；`claude rm` 永不用于 Wakeflow 的会话。

## 7. pod 与侧栏

- pod 检出仍由 Wakeflow 建与收（`git worktree add -b worktree-<pod>`，受管 `.git/info/exclude`），窗口 cwd 指向检出。
- 侧栏分组是投影：primary pod 一组 `<程序名>`，每个 worktree pod 一组 `<程序名> · <pod>`（`create_group` / `move_sessions`）；分组丢失不影响状态，reconcile 可重建。

## 8. 状态投影与用户面

- desktop 传输下不发布状态行资产与 tmux 资产；`@wakeflow_state` 本就在无 `$TMUX` 时静默。attention 语义由侧栏原生"运行中 / 未读 / 需要输入"承担，窗口标题仍由 mark 维护。
- 首跑交接卡：侧栏里的分组与会话名；用户唯一要做的两件事——信任每个产品目录、在该目录选一次 auto；订阅登录是前提。

## 9. 维护与校验

- 维护：desktop 下的宿主资产集合 = `desktop.mjs` + 便携设置规则（加 `Bash(node <desktop.mjs> *)`），不含 tmux 资产与 statusLine；detach 的删除步骤对应调整。
- verify：`host-hook-channel`、`runtime-artifact` 不变；`window-runtime` 按传输读观察；模式不一致进 `window-runtime` 的失败码而不是新门。
- 文本：静态技能文本只说"按工具返回的分步做"，分步由渲染器按传输给出；Controller 窗口参考现在卡在 400 行，要先把 tmux 段压缩出空间。

## 10. 批次与门

- K1 传输核心：ADR、配置轴、Schema 分支与准入、`desktop.mjs`、launch 渲染器、观察分类、投递与回调文本、维护资产集合、场景链一张 desktop 卡。第 2 级门。
- K2 生命周期与投影：观察记录的 permissionMode / sessionTitle、pod 分组、换代路径（验证后）、交接卡、detach 对应。第 2 级门。
- L18：真实桌面 Controller 从认领到归档走一遍。

## 11. 决定点与裁定

用户 2026-10-30 按推荐裁定：

1. 权限模式一致性取 (b)：用户在每个窗口目录的选择器里选一次 auto，交接卡列出；模式证据来自第一条 user-prompt-submit 记录（第 3.4 节），不自动调 `set_session_permission_mode`。
2. 换代路径：K1 的文本以"重启桌面 app 后 reconcile"为准；K2 开头先在可丢弃工作区验证归档 + 取消归档是否重起进程并换代，验证通过再改文本与助手。
3. 接受 `--bg` 首回合"只回 ok"的额外一回合（几秒、极少 token），它是 `--desktop --resume` 的前提。
4. 允许已有 tmux 工作区经 reconfigure 切到 desktop：退役全部窗口投影后按新传输开窗；K1 只支持 fresh-initialize 时选择传输，切换放 K2。

K1 开始前的三项核对（不阻塞 ADR）：`set_session_title` 对 `--name` 标题是否弹确认；`claude agents --json` 在桌面 app 未运行时的行为（preflight 的 `desktop-unavailable` 判据）；Controller 窗口参考压缩 tmux 段腾出的行数是否够放 desktop 分步。
