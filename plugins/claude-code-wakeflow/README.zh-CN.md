<div align="center">

# Wakeflow for Claude Code

面向多窗口 agent 工作的严谨控制循环——每一步留痕、每个结果实证。

[English](README.md) | [简体中文](README.zh-CN.md)

Wakeflow 把一个本地 Claude Code 工作区变成有纪律的控制系统：每个 active demand 一条由总控负责的闭环、
多个聚焦的仓库窗口、明确的 state root、轻量 delivery envelope，以及基于证据的验收。总控以闭环方式运行这套系统——规划、派发、收集证据、审查、决策、循环往复——并记录每一步，整个过程事后可审计。

</div>

---

- [为什么需要 Wakeflow](#为什么需要-wakeflow)
- [架构](#架构)
- [安装 Wakeflow](#安装-wakeflow)
- [快速开始](#快速开始)
- [安全与系统影响](#安全与系统影响)
- [窗口模型](#窗口模型)
- [跨宿主统一词汇](#跨宿主统一词汇)
- [初始化工作区](#初始化工作区)
- [Wakeflow 会创建什么](#wakeflow-会创建什么)
- [自动化语义](#自动化语义)
- [MCP 能力面](#mcp-能力面)
- [运行时与账本边界](#运行时与账本边界)
- [双宿主工作区](#双宿主工作区)
- [开发本仓库](#开发本仓库)
- [设计原则](#设计原则)

## 为什么需要 Wakeflow

大型 agent 辅助工作很少只发生在一个仓库或一个会话里。一个目标可能需要
总控、多个产品仓库、一个 Design 窗口，以及一个真实场景 Test 窗口。没有共同的
操作模型时，工作很容易退化成零散 prompt、复制粘贴的状态表、不清晰的责任边界，
以及没有真正验收的“完成”。

Wakeflow 提供缺失的控制层：

- **总控优先判断**：父工作区负责目标、边界、投递决策、验收、TODO 路由和归档决策。
- **一个需求一个 state root**：任务包、目标结果、review candidate、决策和进度投影都绑定到同一个需求。
- **上下文完整的任务包**：每个新任务包一次性记录目标、带锚点的需求引用、边界、完成预期、依赖与仓库提交决定；派发再据此推导必须加载的执行 Skills。
- **聚焦的子窗口**：每个仓库窗口只在配置好的责任边界内工作。
- **先预览再投递**：总控先审阅解析后的仓库、任务简报、Skills 和最终 prompt，再用匹配预览摘要的 `apply=true` 写入 delivery envelope。
- **验收锚点驱动工艺**：实现任务包可携带明确的 claim/probe/expected 锚点，子窗口编码前先映射为 RED 检查；总控仍独立复验和判断证据。
- **先证据，后验收**：target backfill 是输入，不是结论；总控仍然要检查原始证据。
- **本地优先运行时**：真实 session id 只存在本地 thread registry；window config 是派生视图，active state 不进入源码。

Wakeflow 不是换了名字的命令启动器。它是一个可复用的工作流能力，用来让多窗口
agent 工作保持可读、有边界、可恢复。

## 架构

Wakeflow 由三层协同构成:看得见的窗口舰队、推动工作的闭环、以及重启不丢的磁盘布局。

### 第一层 —— 舰队(你看到的)

基础舰队位于配置的 tmux session，每个 demand pod 另有独立 tmux session。每个窗口
都是绑定唯一职责的交互式 Claude Code 会话；状态栏一眼看清谁在干什么：

```text
[wakeflow]  1:Design   >> 2:Controller   3:RepoA  +  4:RepoB   5:Test   6:zsh
            空闲      绿块=正在执行回合   空闲    结果待评审     空闲    你自己的,
                                                                      不受影响
```

| 徽章 | 含义 |
| --- | --- |
| 绿色 `>>` 色块 | 窗口此刻正在执行回合(活动监视器实时点亮) |
| 绿色 `+` | 结果已落,待总控评审 |
| 无徽章 | 空闲,或投递安静在途(舰队的常态;需要时用 `window-status` 查看机器状态) |

| 窗口 | 职责 | 默认推理力度 |
| --- | --- | --- |
| Controller(总控) | 目标、派发、证据评审、验收 | `max` |
| Design | 澄清需求、重设非 bug 结果偏差方案、准备交接 | `xhigh` |
| 仓库窗口 | 只在一个仓库内实现 | `xhigh` |
| Test | 总控验收并完成自身验证后，只探索获批真实环境边界中的隐藏 bug | `xhigh` |

每个窗格底部的 statusline 以纯文本显示实时服务模型与窗口身份。tmux 窗口不会跨机器
重启存活；`launch-all` 或 `launch-window --resume` 会根据已注册 Claude session id
重新创建窗口，再恢复对应会话。

### 第二层 —— 闭环(工作如何流动)

工作以需求(demand)组织:一个需求 = 一个目标 = 磁盘上一个 state root。
每个需求走同一条闭环:

```text
 1 init       底层 state init 创建 demand root              (未认领)
 2 claim      公共 create 或底层 root 首次驱动时绑定宿主      (codex | claude)
 3 add task   任务包冻结目标窗口上下文与需求锚点
 4 dispatch   预览 -> 摘要匹配 apply -> 上锁 -> 粘贴 prompt
 5 work       目标窗口在自己的仓库边界内执行
 6 result     带证据引用的 TargetResultEnvelope 落盘 -> 锁释放
 7 review     总控读原始证据,然后 accept / rework / blocked
 8 complete   所有任务通过验收且无阻塞时才能完结
```

两条规则保证闭环诚实:

- **Prompt 只负责唤醒,state 负责指挥。** 粘贴的 prompt 只带窗口名、任务 id、
  state root;任务定义在 state root 和已装 skill 里。丢一条 prompt 不丢任何东西。
- **回填是输入,不是验收。** 目标窗口的自述永远不能关闭工作;总控先读原始证据
  (commit、命令输出、报告)再记录决定。blocked 决定永远可恢复:新证据到来即
  重新开启评审。

### 第三层 —— 地基(磁盘上是什么)

```text
<workspace>/
  wakeflow.config.json          窗口、角色、模型/力度钉子          入库
  CLAUDE.md(每仓库各一份)       总控门 / 访问卡                    入库
  .claude/settings.json          可移植 allow 规则、相对引用        入库
  .claude/settings.local.json    本机 statusline 命令               永不入库
  wakeflow-ledger/               长期设计、记录、归档               入库
  .wakeflow-active/             需求 state root(第二层住这里)    本机
  .wakeflow-local/wakeflow-delivery/                               本机
    dispatch-packets/  delivery-envelopes/  delivery-runs/   传输记录
    target-results/                                          证据信封
    locks/                       每窗口一把在途锁,跨宿主共享
    hosts/codex/                 codex 会话注册表(宿主私有)
    hosts/claude-code/           claude 会话注册表 + tmux 绑定
```

一句话原则:**业务真相宿主中立、双方共享;传输句柄宿主私有、永不离开
`.wakeflow-local/`。** 会话 id 不会出现在任何入库文件、prompt 或回填文本里。

### 谁能决定什么(信任模型)

- 脚本与 MCP 工具负责创建、校验、记录机器数据；它们不会自行选择验收、扩权或替产品做决定，
  只会持久化总控的显式决策。
- 目标窗口只执行被派发的任务包并回报证据。
- 总控是唯一的验收权威。
- 产品决定属于用户。`bypassPermissions` 永不默认开启:只有用户显式同意后才写进
  `wakeflow.config.json`,这条被记录的同意才是无人值守启动对话框的授权来源。

### 双宿主共存

同一工作区可同时运行 Codex 版与 Claude Code 版:需求在领取时绑定平台
(每个驱动命令机器强制校验),跨宿主共享的窗口锁串行化投递,
归属只能通过显式且留痕的 `adopt-demand-host` 转移。

## 安装 Wakeflow

> 平台支持:macOS 优先。tmux 舰队与 `brew` 预检每天在 macOS 上真实使用;
> tmux 核心理论上可在 Linux 运行但尚未验证。进入舰队始终是同一条打印指令:
> 开一个新终端,运行 `tmux attach -t <session>`。


仓库根目录是开发工作区，真正可安装的 Claude Code 插件 artifact 位于
`plugins/claude-code-wakeflow/`。在 Claude Code 内安装：

```text
/plugin marketplace add GxFn/Wakeflow
/plugin install wakeflow@gxfn
```

本地开发时，把当前 checkout 作为本地 marketplace 添加：

```text
/plugin marketplace add /absolute/path/to/Wakeflow
/plugin install wakeflow@gxfn
```

插件包含四个相互配合的 surface：

| Surface | 内容 |
| --- | --- |
| MCP server | `.mcp.json` 启动 `${CLAUDE_PLUGIN_ROOT}/bin/wakeflow-mcp`；启动器选择 Node.js 20+ 后启动无 `node_modules` 依赖的 `mcp/server.cjs`。 |
| Skills | `wakeflow-controller`、`wakeflow-target`、`wakeflow-target-craft`、`wakeflow-governance` 操作手册。 |
| Slash commands | `/wakeflow:init`、`/wakeflow:check`、`/wakeflow:windows`、`/wakeflow:status`、`/wakeflow:dispatch`、`/wakeflow:review`、`/wakeflow:unattended`。 |
| Host transport helper | `scripts/lib/wakeflow-claude-host.mjs`。舰队：`preflight`、`ensure-server`、`launch-window`、`launch-all`、`replace-all`、`retitle`、`arrange-windows`、`window-status`、`check-workspace`；投递：`deliver`（主路径）、`send`、`readback`、`wait-results`、`activity-monitor`；策略：`seed-permissions`、`set-unattended`、`stamp-runtime`；跨需求：`stream-open`、`stream-close`、`stream-list`、`pod-open`、`pod-close`、`pod-list`。 |

helper 依赖 tmux。`preflight` 只报告可用性与建议安装命令；缺少 tmux 时，初始化
命令先取得一次明确用户同意，再由 Claude Code 执行 `brew install tmux`，遇到临时
bottle 错误可重试一次。

## 快速开始

从安装到舰队跑起来三步,后面附命令速查表。

1. **初始化**(每个工作区一次)——在 Claude Code 里,于工作区目录下:
   ```text
   /wakeflow:init
   ```
   预览计划、确认,Wakeflow 写入 config + 访问卡、启动全部窗口并注册。已初始化过?`init` 会有意停下——单个陈旧窗口用 `/wakeflow:windows <名> --replace`,整体重建只在显式 reset 时再跑。
2. **进入工作区**——新开一个终端窗口或 tab,`cd` 进工作区,执行(把 `<session>` 换成你的 `hosts.claude-code.tmuxSession`):
   ```text
   tmux attach -t wakeflow
   ```
3. **开始干活**——给总控窗口一个需求,或运行 `/wakeflow:dispatch`。

### 命令速查表

| 命令 | 作用 | 何时用 |
| --- | --- | --- |
| `/wakeflow:init` | 搭建工作区,再启动 + 注册全部窗口(仅首次) | 全新工作区 |
| `/wakeflow:windows` | 只读:列出每个窗口状态(注册了?存活?模式?) | "舰队现在啥状态?" |
| `/wakeflow:windows all` | 用相同 session id 恢复/重开全部配置窗口(上下文不丢) | 重启电脑后 / 升级插件后 |
| `/wakeflow:windows <名>` | 恢复单个窗口 | 某个窗口死了 |
| `/wakeflow:windows <名> --replace` | 用全新 session 重建单个窗口 | 窗口陈旧 / 上下文太重 |
| `/wakeflow:status` | 需求、可领取工作、投递、窗口就绪度 | 派发前 |
| `/wakeflow:dispatch` | 给目标窗口准备并发送一次投递 | 把活交给某窗口 |
| `/wakeflow:review` | 看目标的原始证据,记录 accept / rework / blocked | 有结果回来了 |
| `/wakeflow:unattended on|off` | 切换工作窗口的权限模式 | 无人值守 ↔ 逐操作提示 |
| `/wakeflow:check` | 体检已有工作区,收敛陈旧/缺失的面 | 升级之后 |

口诀:**`init` 装修,`windows all` 开灯,`windows` 看一眼。**

## 安全与系统影响

Wakeflow 是一个强大的本地自动化插件。安装前请清楚它在你机器上做什么——没有任何隐藏:

- **运行一个本地 MCP server**（`bin/wakeflow-mcp`）：无依赖启动器选择 Node.js 20+ 后启动 `mcp/server.cjs`。server 读写工作区状态文件，自身不发任何网络请求。
- **拉起 tmux 会话和交互式 `claude` 窗口**：基础舰队使用配置的 tmux session，每个 demand pod 使用另一 session。Wakeflow 通过自带 host helper 创建、恢复、替换、排版这些真实 `claude` CLI 会话。
- **会跑这些 shell 命令**:`node`、`tmux`、`git`、`brew`——最后这个仅在缺 tmux 时、经你一次显式同意后 `brew install tmux`。
- **权限模型——默认安全**:工作窗口默认 `acceptEdits`(Claude Code 在风险动作前仍会询问)。完全无人值守的 `bypassPermissions`(无提示)**仅显式开启**:工作区通过 `/wakeflow:unattended on` 主动启用,选择记录在 `wakeflow.config.json`,只有这条被记录的同意才让 helper 自动确认启动对话框。无人值守模式下的安全边界是仓库 worktree、`CLAUDE.md` 闸门、Wakeflow 状态机。
- **本地优先、无遥测**:真实 session/thread id 只存在 `.wakeflow-local/` 下,绝不写入受版本控制的文件、prompt,也不外发。需求、证据、账本都留在你的工作区。
- **平台**：macOS 优先（tmux；缺失 tmux 时文档安装路径使用 Homebrew）。tmux 核心理论上可在 Linux 运行但尚未验证。

你始终掌控：脚本和 MCP 工具只创建、校验、记录机器数据；它们不会自行选择验收、扩权或替产品做决定，
只会持久化总控的显式决策。
总控是唯一验收权威，必须在 Test 开始前完成自己的功能验证，且所有现存非 Test target
都已 accepted。Test 遵守冻结目标与获批 Test card（`controllerSelfChecks`、获批计划、
allowed skills、setup policy、attempt bound），不能自创目标、gate、环境、skill 或方法；
progressive-chain-validation 只有被显式列出时才能使用。产品决定属于你。

## 窗口模型

窗口传输是 Claude Code 版本的关键差异，而且 Claude Code 版本只使用终端。
每个 Wakeflow 窗口（包括总控）都是常驻 tmux 的交互式 `claude` session。默认
舰队位于名为 `wakeflow` 的 tmux server session 内；每个 demand pod（见下文）
会在旁边新增自己的 `wakeflow-<pod>` session。session 名可在
`wakeflow.config.json` 中配置：

```json
{
  "hosts": {
    "claude-code": {
      "tmuxSession": "wakeflow"
    }
  }
}
```

Wakeflow thread id 就是该窗口的 Claude Code session id，跨 resume 保持稳定。
桌面窗口不是自动化传输通道。envelope、证据和 review 合约与共享 Wakeflow
模型完全一致。

**启动。** 初始化先运行 helper 的 `preflight`（缺少 tmux 时在用户同意后安装），
再对 launch plan 中的每个窗口运行 `launch-window`：helper 创建运行
`claude --session-id` 的 tmux 窗口、粘贴 entry-sync prompt、把 `displayTitle`
设为 tmux 窗口名，并返回 session id；每个 id 只在本地 thread registry 注册一次。

**投递。** 主传输路径只有一步：`deliver --delivery-file <envelope.json>`
读取已 prepare 的 envelope、自行渲染 prompt 并解析目标窗口，强制共享的按窗口
投递锁，通过 tmux buffer 粘贴，并返回 pane readback 证据；agent 用
`wakeflow_record_delivery` 记录这次投递。（`send --window <target>
--prompt-file <file>` 仍是自定义 prompt 的底层路径。）目标窗口以同样方式向
总控窗口做 controller-return——pod 需求由 envelope 里盖章的 `controllerWindow`
把 return 路由回该 pod 自己的总控。`wait-results --group <id>` 只作为脚本化
流程里的显式同步等待，正常投递不会自动启用它。

**恢复。** tmux window 挂掉或机器重启后，已注册 session id 仍是 thread id。
用 `launch-window --resume --session-id <已注册 id> --replace` 交互式恢复同一会话；
用 `launch-all` 恢复所有已注册的基础窗口。只有交互式恢复不可用时，才使用显式
`headless-recovery` send adapter 作为最后手段；它不是正常舰队路径，且仍要求 readback 证据。

**观察。** 开一个新终端窗口/标签，运行 `tmux attach -t <session>`（默认
`wakeflow`）。这一条命令就是唯一受支持的进入方式——不提供程序化开标签或其他 attach 变体。

**无人值守权限。** 工作窗口默认 `acceptEdits`;舰队级模式记录在
`hosts.claude-code.permissionMode`，只能通过显式、留痕的决定切换
（`/wakeflow:unattended on|off` 或 helper 的 `set-unattended`）。只有这份被记录的
`bypassPermissions` 同意，才允许 helper 自动确认启动对话框。各仓库
`.claude/settings.json` 的 allowlist 与所记录的模式叠加生效。

## Demand Pods（多需求并行）

并行只存在于需求层面。同一需求内每个仓库只有一个窗口、一个组合任务包
（窗口自排序）；跨需求最多 `maxActiveDemands`（默认 2，`wakeflow.config.json`）
个需求以 pod 并行：

- 一个需求 = 一个 pod：自己的 `Controller__<pod>`、按仓库的 isolation worktree
  窗口（`<repo>__<pod>`，分支 `<sanitized-demand-key>/pod`）和自己的 `Test__<pod>`，
  全部在自己的 tmux session 里。整个 pod 共用这条需求的一套 worktree——
  每个窗口（含 Test）都在这套 worktree 里工作和验证，绝不碰主检出。
  pod 之间互不感知。
- 用 helper 开/续/关：`pod-open --demand-key <key> --repos <a,b>`（幂等——
  重跑会从 registry 恢复挂掉的窗口）、`pod-list`（唯一全局视图）、归档后
  `pod-close`。
- pod 总控自己 claim 需求（`wakeflow_create_demand` 带
  `controllerWindow: "Controller__<pod>"`），所有 controller-return 都路由回
  该 pod，而不是默认总控。
- 关闭顺序：`complete-demand` → 每个仓库窗口 `stream-close` → 归档 →
  `pod-close`。存活分支落在 `wakeflow-ledger/workspace/pending-merges.md`；
  合并回主线由人工审核、去中心化——任何总控都不合并 pod 分支。
- `maxStreamsPerRepo` 限制一个仓库上可有多少 pod 持有 isolation worktree；
  超出 `maxActiveDemands` 的 claim 会 fail-closed。

## 跨宿主统一词汇

Wakeflow 在不同宿主版本之间保持同一套机器词汇。registry、payload 字段和 CLI flag
里的 "thread id" 就是 Claude Code session id（跨 resume 保持稳定）；
没有任何字段按宿主改名。
每个窗口的规则文件是 `CLAUDE.md`，Claude Code 会在 session 启动时自动加载它，
所以每个窗口无需额外 prompt 即可读到自己的 gate 和 access card。

## 初始化工作区

Wakeflow 作为 Claude Code 插件安装。目标工作区不需要包含 Wakeflow 源码。
推荐的目标形态是：

```text
MyWorkspace/
  CLAUDE.md
  wakeflow.config.json
  .wakeflow-active/          # ignored active controller state
  .wakeflow-local/           # ignored thread registry and derived runtime
  wakeflow-ledger/            # durable project coordination records
  ProductRepo/
  CoreRepo/
  Design/                     # 默认内部需求设计 surface
  Test/                       # 默认内部测试协作 surface
```

最简单的用户 prompt：

```text
Use Wakeflow to initialize the current workspace.
Preview the plan first and wait for my confirmation before writing.
```

执行流程：

1. Claude Code 调用 `wakeflow_initialize_workspace`，`apply: false`。
2. Wakeflow 返回目录事实和 `agentSelectionProtocol`。
3. Claude Code 根据目录事实和用户上下文判断工作区是 clean 还是 messy。
4. 对 clean 工作区，Claude Code 再次调用工具，并显式传入目标 work windows 的 `repositories` 映射。
5. 对 messy 工作区，Claude Code 先问用户哪些目录是受管窗口，不能直接广泛导入 discovered 目录。
6. 对首次初始化的工作区，用户确认后，Claude Code 调用
   `wakeflow_initialize_workspace`，`apply: true`。
7. Claude Code 运行 host helper：先 `preflight`，再对返回 launch plan 中的
   每个窗口运行 `launch-window`。每次 launch 创建运行 `claude --session-id`
   的 tmux 窗口、粘贴 entry-sync prompt、把 `displayTitle` 设为 tmux 窗口名，
   并返回 session id；对每个真实 `hostLaunch.sessionId` 调用一次
   `wakeflow_register_window`。工具会更新本地 registry 和派生 window config，
   并从输出中隐藏 id。

已经初始化过的工作区里，`wakeflow_initialize_workspace` 不是通用“刷新”按钮。
只有用户明确要求“重置初始化”时才能写入；apply 调用必须设置
`resetInitialization: true`，显式传入 `repositories`，重新确认 Design/Test 模式，
并且不能使用 `useDiscovered`。窗口上下文过重或过期时，使用替换窗口命令。

三个高层入口的职责要分清：

| 需求 | 命令 | 职责 |
| --- | --- | --- |
| 首次 setup | `wakeflow_initialize_workspace` | 发现、确认、写入 workspace config/docs/support surfaces，并返回完整 launch plan。 |
| 明确重置 setup | `wakeflow_initialize_workspace` + `resetInitialization: true` | 重新确认工作目录，清理被移除窗口的受管 cards/runtime，并重写 setup surfaces。 |
| 替换单个上下文过重/过期窗口 | `wakeflow_replace_windows`（传 `window`） | 只返回一个 replacement launch entry 和 `wakeflow_register_window` 调用模板，不刷新 workspace docs。 |
| 替换多个上下文过重/过期窗口 | `wakeflow_replace_windows` | 只返回指定窗口的 replacement entries 和注册调用模板，不改无关窗口。 |

Design 和 Test 默认创建为新的支持 surface。`<Product>Design` 或 `<Product>Test`
这类相似目录只被当作目录事实，除非用户明确把它们映射成 Design/Test。

Wakeflow 支持本地化初始化。中文工作区传 `language: "zh"`，英文工作区传
`language: "en"`，没有明显偏好时传 `language: "auto"`。生成的 session 标题会把
窗口名放在最前面，方便在窄侧边栏里识别仓库。新的 state-root progress 文档和
后续的 Unified Status 渲染也使用所选界面语言。

总控和子窗口可以使用 Claude Code subagent 加速有边界的代码搜索、日志分诊、
测试定位和证据汇总。Subagent 输出只是证据或建议；总控 review、投递、状态写入
和仓库边界仍归拥有该任务的 Wakeflow 窗口。

## Wakeflow 会创建什么

初始化只写入已确认边界所需的 surface：

| Surface | 用途 |
| --- | --- |
| `CLAUDE.md` | 父级总控 gate 和长期边界规则。 |
| 子窗口 `CLAUDE.md` access cards | 每个窗口的责任和读取路径。 |
| `wakeflow.config.json` | 受管窗口、仓库路径、角色、host transport 设置（如 tmux session 名）和默认语言。 |
| `.wakeflow-active/` | active state roots、当前索引、progress docs、TODO 投影、intake 和 test cards。 |
| `.wakeflow-local/` | thread registry、投递 runtime、本地 overrides 和派生 window config。 |
| `wakeflow-ledger/` | 长期项目协作记录和归档。 |
| `Design/` | 未映射外部 Design 仓库时创建的内部需求设计工作区。 |
| `Test/` | 未映射外部 Test 仓库时创建的内部测试协作工作区。 |

Wakeflow 也会同步 `.gitignore`，只把 `.wakeflow-active/` 和 `.wakeflow-local/`
作为本地运行时目录忽略。它不会把产品仓库、Design/Test、ledger、`.DS_Store`
或其他本地杂项加入 `.gitignore`。

## 自动化语义

Wakeflow 自动化是直接 session 投递加显式结果返回。

核心规则：

- 真实 session id 只存在 `.wakeflow-local/wakeflow-delivery/hosts/claude-code/thread-registry/`。
- Window config 从 `wakeflow.config.json` 和 thread-registry presence 派生，不是第二份 session-id 权威。
- Delivery prompts 保持轻量、可读。
- 总控用 host helper 一步发送已 prepare 的 envelope
  （`deliver --delivery-file <envelope.json>`；`send --window --prompt-file`
  是自定义 prompt 的底层路径）；helper 强制共享的按窗口投递锁，通过 tmux buffer
  粘贴，并返回 pane readback 证据，由 agent 用 `wakeflow_record_delivery` 记录。
- 目标窗口通过同样的 helper send 向总控窗口 controller-return；
  `wait-results --group <id>` 只作为脚本化流程里的显式同步等待。
- `group-ready` 会等待预期 target results，再允许 controller return。
- `per-target` 可以每个 target 唤醒一次 controller，同时保留 group snapshot。
- 一次真实发送被记录为 `sent` 且有 readback 证据后，总控本轮停止，不在同一轮 sleep 或 poll。
- Keep-live 只是运行时辅助，不是任务逻辑、传输权威或验收证据。

自动化会在最终完成、硬 gate、用户停止、没有 eligible work、缺失证据、blocked state、
或任何需要总控/用户判断的条件下停止。

## MCP 能力面

Wakeflow 只把稳定的外层工作流合约暴露成 MCP tools，工具名与 Codex 版本完全一致。
运行时脚本仍然是内部实现和测试 surface；脚本存在不等于它就是公共工具。
目标窗口 closeout 与总控投递使用同一套投递模型：准备 envelope、
通过 tmux host helper 发送 prompt、记录 delivery run。

主要工具组：

| 需求 | MCP tools |
| --- | --- |
| 设置与窗口注册 | `wakeflow_initialize_workspace`, `wakeflow_replace_windows`, `wakeflow_register_window` |
| Demand 和任务状态 | `wakeflow_status`, `wakeflow_create_demand`, `wakeflow_claim_next`, `wakeflow_add_task`, `wakeflow_continue_demand`, `wakeflow_render_progress`, `wakeflow_cancel_demand` |
| 候选扫描与隔离 pod | `wakeflow_next_work`, `wakeflow_pod_open`, `wakeflow_pod_close`, `wakeflow_pod_list` |
| 投递和返回 | `wakeflow_prepare_delivery`, `wakeflow_record_delivery` |
| 结果和 review | `wakeflow_record_target_result`, `wakeflow_review_pack`, `wakeflow_reduce_results`, `wakeflow_decide_review`, `wakeflow_complete_demand` |
| Design 和 Test intake | `wakeflow_deliver`, `wakeflow_intake_test_card` |
| 归档、视图、维护和验证 | `wakeflow_archive`（target demand/todo/docs）、`wakeflow_sanitize_archive`（受限的历史归档修复）、`wakeflow_view`（task-ledger/window/focus/trace/storage）、`wakeflow_prune_runtime`、`wakeflow_verify` |
| 宿主归属与窗口锁 | `wakeflow_adopt_demand_host`、`wakeflow_release_window_lock` |

公共 MCP tools 面向外层 agent 工作流。target closeout 被故意拆开：
记录 target result、审查 readiness、在策略允许时准备 controller-return envelope、
通过 tmux host helper 发送，再记录 delivery evidence。总控 review 也保持拆分：
review pack、result reduction、显式决策；result reduction 只创建 review candidate，
不是验收。不要把这些步骤合并成一个 target-window MCP tool。归档摘要刷新内部步骤、
keep-live 状态和脚本后端执行这类内部环节留在 Wakeflow runtime scripts 和 skills 里。
公共归档 MCP tools 包装总控批准的 demand、TODO 和工作区文档归档流程。
`wakeflow_sanitize_archive` 只把已归档 demand 替换为隐私清洁副本并在本地保留原件；
两者都不做验收决策，也不发送 host 消息。

Wakeflow 为每个公共工具声明 MCP tool annotations：只读工具标记为 read-only，
写工具是 local、non-destructive、closed-world。工具审批仍由用户的 Claude Code
权限设置控制；可信的本地安装可以在 `.claude/settings.json` 中为 `wakeflow`
MCP server 配置 allowlist。

## 运行时与账本边界

Wakeflow 把源码、active runtime 和长期记录分开：

| Path | 边界 |
| --- | --- |
| `skills/` | 随插件安装的可复用操作说明。 |
| `scripts/` | 插件打包的运行时实现和验证脚本。 |
| `templates/wakeflow-template-bundle.json` | setup 时展开的 starter state、Design/Test 和 ledger skeletons bundle。 |
| `.wakeflow-active/` | 目标工作区中的当前 active work；被 Git 忽略。 |
| `.wakeflow-local/` | 机器本地 thread registry、派生 runtime views 和 local state；被 Git 忽略。 |
| `wakeflow-ledger/` | 项目特定的长期记录，不属于可复用 Wakeflow 源码。 |

Wakeflow 源仓库只跟踪可复用能力。产品代码、项目特定 active state、真实 session id
和派生本地运行时 artifacts 都不应进入 Wakeflow 源码。

## 双宿主工作区

同一个工作区可以同时运行 Codex 和 Claude Code 两个 Wakeflow 版本。共享业务
状态保持宿主中立：`.wakeflow-active/`、`wakeflow-ledger/`，以及
`.wakeflow-local/wakeflow-delivery/` 下的投递状态（`dispatch-packets/`、
`dispatch-groups/`、`delivery-envelopes/`、`delivery-runs/`、
`target-results/`），加上共享 `locks/` 目录——它跨宿主强制每个窗口同一时间
只有一个 in-flight 投递。

宿主独立的运行时按宿主分开：

- `.wakeflow-local/wakeflow-delivery/hosts/codex/{thread-registry,window-config,keep-live}/`
- `.wakeflow-local/wakeflow-delivery/hosts/claude-code/{thread-registry,window-config,window-host,keep-live}/`

`AGENTS.md`（Codex）与 `CLAUDE.md`（Claude Code）在工作区根目录和子目录根
共存，每个 demand 跨宿主只有一个总控。公共 `wakeflow_create_demand` 会认领调用宿主；
只有底层 raw state init 才以 `controllerHost: null` 开始并等待首次驱动。
非归属宿主的 controller 写操作和投递准备会 fail-closed；`--adopt-host` 是显式转移机制。
`wakeflow_status` 会在
`dualHost.demandOwnership` 暴露当前映射。

## 开发本仓库

在仓库根目录开发 Wakeflow 插件本身：

```sh
npm run validate
npm run smoke
npm run test:wakeflow
npm test
```

本插件 artifact 内的常见源码区域：

| Path | 用途 |
| --- | --- |
| `.claude-plugin/plugin.json` | 插件 metadata；`mcpServers` 指向 `.mcp.json`。 |
| `.mcp.json` | MCP server wiring（`${CLAUDE_PLUGIN_ROOT}/bin/wakeflow-mcp`）。 |
| `bin/wakeflow-mcp` | 无依赖 MCP 启动器。它先尊重 `WAKEFLOW_NODE`，再检查 `PATH` 及受支持的本地 runtime 位置，最后启动 `mcp/server.cjs`。 |
| `mcp/server.cjs` | 无 `node_modules` 依赖的 standalone MCP server entrypoint。 |
| `lib/` | MCP 工具定义、runtime helpers、进程与 trace 支持。 |
| `scripts/` | 随插件发布的 setup、state、delivery、intake、archive、validation 和 CLI runtime。 |
| `skills/` | 随插件发布的 controller、target protocol、target craft 与 governance 操作手册。 |
| `commands/` | `/wakeflow:*` slash command 定义。 |
| `templates/wakeflow-template-bundle.json` | 已安装工作区 starter documents 和 support surfaces 的 bundle，用于控制 marketplace scan 文件数。 |
| `assets/` | Marketplace 和插件展示资源。 |

仓库根 README 解释共享架构；本 README 是 Claude Code 版本手册。

## 设计原则

1. **判断必须可见**：脚本输出、状态行、target backfill 是证据，不是验收。
2. **一个需求，一个 state root**：JSON state 和 Markdown progress surface 绑定到同一个 demand。
3. **Prompt 唤醒，任务包提供上下文，Skills 负责执行工艺**：prompt 只携带本轮目标和读取顺序；任务包保存完整任务上下文，需求锚点保留原始背景，installed skills 保存执行流程。
4. **仓库边界很重要**：每个窗口拥有自己的源码、测试、提交和证据。
5. **自动化移动工作，不转移权威**：投递只能证明 prompt 已发送，不能证明结果完成。
6. **本地运行时留在本地**：真实 session id 只留在本地 thread registry，active runtime state 不进入 tracked docs。
7. **默认创建新的支持窗口**：Design 和 Test 默认作为清晰的 Wakeflow support surfaces 创建，除非用户明确映射既有目录。

Wakeflow 的目标是让多窗口 agent 工作可以安全恢复、容易审查，并且难以伪造完成。
