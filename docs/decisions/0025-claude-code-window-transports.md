# ADR-0025 Claude Code 宿主的两种窗口传输：tmux 与桌面会话

> 状态：accepted（2026-10-30，用户裁定两种传输并列一等、长期维护；桌面侧四个决定点按推荐）
> 提出日期：2026-10-30
> 裁决日期：2026-10-30
> 基线提交：`570fe65f`
> 相关：[双传输规划](../reviews/2026-10-30-claude-host-dual-transport-plan.md)、[桌面适配方案](../reviews/2026-10-29-claude-desktop-transport-design.md)、[调研](../reviews/2026-10-29-claude-desktop-window-transport-research.md)；open-items X、Y 节；ADR-0003（宿主效果由 Agent 执行）、ADR-0009（观察器只写记录）、ADR-0023（窗口状态投影）；gate-log §13.218–§13.221

## 背景

Claude Code 宿主今天只有一种窗口传输：每个窗口是 tmux pane 里的一个 `claude` 进程，Controller 经发布到工作区私有目录的 tmux 助手开窗、读 pane、粘贴投递、关窗；登记合同要求 tmux 坐标，存活观察是 `tmux list-panes` 的行。Claude 桌面客户端的 Code 标签把会话组织成可见的侧栏树，并给会话内的 Claude 提供会话管理工具；现场 L17 证实：`claude --bg` → `claude stop` → 伪终端 `claude --desktop --resume` 能把一个会话送进侧栏，hook 在桌面会话里照常触发，桌面 `send_message` 与跨会话 `SendMessage` 到 hook 的 `prompt` 都是原始正文，向忙碌会话发消息在其回合末自动开新回合。桌面接手后权限模式回到目录记忆值，`--bg` 忽略 `--session-id`，`--worktree` 起的会话会被 app 与 agent view 当成自己的 worktree。

## 问题

1. 在不改状态权威、证据与落地规则的前提下，让 Claude 宿主在桌面客户端里完整运行。
2. tmux 传输同等维护，两者如何在一个宿主、一份制品里并存而不互相拖累。
3. 传输差异放在哪一层、由谁选择、如何让共享层不出现传输名。

## 选项

### 选项 A：第三个宿主 id `claude-desktop`

另建一份制品与宿主目录。否决：桌面 app 与终端 CLI 读同一套插件目录，两份带同名 `wakeflow_*` 工具的插件会同时加载；hook、设置规则、技能文本完全相同，复制只会制造漂移。

### 选项 B：逐窗口混搭（Controller 在桌面、窗口在 tmux）

否决为产品形态：窗口在侧栏不可见，每个宿主动作多一条路径、测试矩阵翻倍；回调方向需跨会话 socket，桌面会话工具够不到 tmux 窗口。作为用户自己的用法它今天就可行，不需要 Wakeflow 支持。

### 选项 C：一个宿主、两种传输（采用）

`claude-code` 宿主内加一条传输轴，每工作区选一种；两种传输各有自己的资源 profile、助手资产、定位子、存活观察与交接文本，共享层只按 profile 值行事。

## 决定

- **D1 传输轴与选择点。** 配置 `hosts.claude-code.windowTransport: "tmux" | "desktop"`，缺省 tmux；fresh-initialize 的选择同形并由引导会话按环境提议（会话里有桌面会话工具即 desktop）。Claude 宿主提供一张传输表 `{ tmux: profile, desktop: profile }`，共享层的一个纯函数按配置值选出当前 profile，在每个能力切片准入门面时调用一次；准入之后的代码只读选出的 profile。`grep windowTransport` 在 `src/hosts/`、`src/configuration/`、选择函数与 Schema 之外不得命中。
- **D2 资源 profile 形状。** 启动模板加第三种 `desktop-session`（controllerEffort、defaultEffort、permissionMode，无 sessionName）；定位子提供者由启动模板推导（tmux-session → tmux，desktop-session → desktop，project-thread → none）；`surfaces.tmuxAsset` 改为传输中立的 `surfaces.helperAsset { fileName }`，目录与 verify 的资源声明随之中立化；desktop profile 的 `statuslineAsset` 为 null、`runtimeRefresh` 为 `user-app-restart`（裁定 2）、`runtimeStaleness` 不变。
- **D3 登记合同。** `creationObservation` 加可选 `desktop { sessionId }`（`local_` 前缀的桌面会话 id），与 `tmux` 按传输二选一：tmux 缺坐标报 `tmux-coordinates-required`，desktop 缺会话 id 报 `desktop-session-required`，带了另一种报 `locator-kind-mismatch`。存活观察加 `desktop-sessions`（`claude agents --json` 的会话行），分类为 present-busy / present-idle / absent，Agent 不判存活。定位器记录 `provider` 加 `desktop`。启动意图的执行种类加 `claude-code-desktop`，`sessionIdPolicy` 加 `host-assigned`。
- **D4 助手资产 `desktop.mjs`。** 与 tmux 助手同一发布机制与允许规则形状，子命令 `preflight`、`launch`、`sessions`、`landing`。`launch` 的三步：`claude --bg "<启动提示>" --name … --permission-mode … --effort … --add-dir … --allowedTools …`（prompt 在变长参数之前，不传 `--session-id`，pod 窗口以 Wakeflow 的检出为 cwd、绝不 `--worktree`），轮询 `claude agents --json` 到首回合 done 后 `claude stop`，伪终端 `claude --desktop --resume <id>`，等新的 session-start 记录，输出登记观察。`sessions` 输出存活观察；`landing` 只等待并报告目标会话的 user-prompt-submit 记录。发送、改名、归档由 Controller 直接用桌面工具（`send_message`、`set_session_title`、`archive_session`）完成，Wakeflow 不发 prompt 的边界不变。助手永不 `claude rm`。
- **D5 投递、回调与落地。** 投递的 `attempt.sendReturn` 是 `send_message` 的返回值；落地仍只认目标会话 user-prompt-submit 记录的 promptDigest 等于 permit（L17 证实无需改 unwrap）。回调是目标窗口 `SendMessage` 到 Controller 的桌面 id（Controller 用 `get_session self` 读自己的 id 放进回传指针）。权限模式一致性按裁定 1：用户按目录选一次 auto，模式证据在 K2 进观察记录。
- **D6 维护与校验。** 维护按选出的 profile 发布助手与状态行：tmux 发布 `tmux.mjs` + 状态行条目，desktop 只发布 `desktop.mjs`；便携设置规则按助手文件名生成；`host-settings-assets` 与 `status.hostAssets` 的期望同源。detach 的删除步骤对应。
- **D7 文本。** 技能静态文本只写"按工具返回的 launch instructions 分步做"，分步由渲染器按传输给出；Controller 窗口参考压缩 tmux 细节腾出篇幅；桌面专属步骤放新的参考文件；README 与交接卡并列描述两种传输，不表达优劣（规划原则 1）。
- **D8 验证对等。** 场景链以桌面驱动再跑一遍（26 卡），组件测试按传输分文件；lab 无法无头起桌面 app，以录制观察补，差距登记 X9；每次 tag 前两种传输各做一次窗口生命周期现场。
- **D9 不做。** 不依赖 `start_session`（服务端开关、必弹确认、自动回合不可用、子会话唤父）；K1 不做 reconfigure 切换传输、pod 侧栏分组、换代自动化与观察记录新字段，这些归 K2（规划第 4 节）。

## 后果

- 既有 tmux 工作区行为不变：缺省 tmux、profile 迁入传输表不改字节以外的语义，由 L19 回归核对。
- 登记 Schema、配置 Schema、维护公共请求 Schema 变化，schema:build 与第 2 级门。
- 共享层新增一个选择点与一个中立命名（helperAsset），其余传输知识全部在 `src/hosts/claude-code/`。
- 桌面传输的前提写进交接卡：订阅登录、每个目录一次信任与选 auto、桌面 app 在运行。

## 验证

K1 的第 2 级门；`claude-code-desktop-asset.test.ts` 以假 `claude` 与假 `script` 走通三步与失败码；场景链桌面驱动 26/26；L18 真实桌面 Controller 从认领到归档；L19 tmux 回归。
