<div align="center">

# Wakeflow for Claude Code

面向多窗口 agent 工作的无人值守控制循环。

[English](README.md) | [简体中文](README.zh-CN.md)

Wakeflow 把一个本地 Claude Code 工作区变成有纪律的控制系统：一个总控窗口、
多个聚焦的仓库窗口、明确的 state root、轻量 delivery envelope，以及基于证据的验收。

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
- **聚焦的子窗口**：每个仓库窗口只在配置好的责任边界内工作。
- **轻量投递**：delivery prompt 只负责用一个小 envelope 唤醒正确窗口；state root 和 skills 保存任务细节。
- **先证据，后验收**：target backfill 是输入，不是结论；总控仍然要检查原始证据。
- **本地优先运行时**：真实 session id 只存在本地 thread registry；window config 是派生视图，active state 不进入源码。

Wakeflow 不是换了名字的命令启动器。它是一个可复用的工作流能力，用来让多窗口
agent 工作保持可读、有边界、可恢复。

## 架构

Wakeflow 由三层协同构成:看得见的窗口舰队、推动工作的闭环、以及重启不丢的磁盘布局。

### 第一层 —— 舰队(你看到的)

一个 tmux 会话承载全部工作。每个窗口都是常驻的交互式 Claude Code 会话,
绑定唯一职责;状态栏一眼看清谁在干什么:

```text
[alembic]  1:Design   >> 2:Controller   3:RepoA  +  4:RepoB   5:Test   6:zsh
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
| Test | 仓库自己做不了的真实场景验证 | `xhigh` |

每个窗格底部的 statusline 实时显示服务模型与窗口身份(`Fable 5 . RepoA`),
纯文本无图标。窗口跨重启存活:同一会话恢复,完整上下文不丢。

### 第二层 —— 闭环(工作如何流动)

工作以需求(demand)组织:一个需求 = 一个目标 = 磁盘上一个 state root。
每个需求走同一条闭环:

```text
 1 init       总控创建需求 state root                       (未认领)
 2 claim      第一个驱动命令把它绑定到一个平台              (codex | claude)
 3 add task   任务包写明目标窗口与边界
 4 dispatch   写信封 -> 窗口上锁 -> prompt 粘贴进窗格
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
  workspace.config.json          窗口、角色、模型/力度钉子          入库
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

- 脚本与 MCP 工具负责创建、校验、记录机器数据;它们不验收、不扩权、不替产品做决定。
- 目标窗口只执行被派发的任务包并回报证据。
- 总控是唯一的验收权威。
- 产品决定属于用户。`bypassPermissions` 永不默认开启:只有用户显式同意后才写进
  `workspace.config.json`,这条被记录的同意才是无人值守启动对话框的授权来源。

### 双宿主共存

同一工作区可同时运行 Codex 版与 Claude Code 版:需求在领取时绑定平台
(每个驱动命令机器强制校验),跨宿主共享的窗口锁串行化投递,
归属只能通过显式且留痕的 `adopt-demand-host` 转移。

## 安装 Wakeflow

> 平台支持:macOS 优先。tmux 舰队、`brew` 预检、当前终端开标签(iTerm2)
> 每天在 macOS 上真实使用;tmux 核心理论上可在 Linux 运行但尚未验证,
> 终端开标签在不支持的平台会优雅降级为打印 `tmux attach` 命令。


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
| MCP server | `.mcp.json` 启动 `node ${CLAUDE_PLUGIN_ROOT}/mcp/server.cjs`，无 `node_modules` 依赖的 standalone server。 |
| Skills | `wakeflow-controller`、`wakeflow-target`、`wakeflow-governance` 操作手册。 |
| Slash commands | `/wakeflow:init`、`/wakeflow:check`、`/wakeflow:windows`、`/wakeflow:status`、`/wakeflow:dispatch`、`/wakeflow:review`、`/wakeflow:unattended`。 |
| Host transport helper | `scripts/lib/wakeflow-claude-host.mjs`，提供 `preflight`、`ensure-server`、`launch-window`、`retitle`、`send`、`readback`、`release-lock`、`wait-results`、`attach-window` 命令。 |

helper 依赖 tmux。初始化会先运行 `preflight`：缺少 tmux 时，在获得用户一次明确
同意后用 `brew install tmux` 安装，遇到临时 bottle 错误会重试一次。

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

- **运行一个本地 MCP server**(`node mcp/server.cjs`):独立、无依赖的 Node 进程,读写工作区状态文件,自身不发任何网络请求。
- **拉起 tmux 会话和交互式 `claude` 窗口**:总控和每个工作窗口都是真实的 `claude` CLI 会话,住在一个 tmux session 里。Wakeflow 通过自带的 host helper 创建、恢复、替换、排版它们。
- **会跑这些 shell 命令**:`node`、`tmux`、`git`、`brew`——最后这个仅在缺 tmux 时、经你一次显式同意后 `brew install tmux`。
- **权限模型——默认安全**:工作窗口默认 `acceptEdits`(Claude Code 在风险动作前仍会询问)。完全无人值守的 `bypassPermissions`(无提示)**仅显式开启**:工作区通过 `/wakeflow:unattended on` 主动启用,选择记录在 `workspace.config.json`,只有这条被记录的同意才让 helper 自动确认启动对话框。无人值守模式下的安全边界是仓库 worktree、`CLAUDE.md` 闸门、Wakeflow 状态机。
- **本地优先、无遥测**:真实 session/thread id 只存在 `.wakeflow-local/` 下,绝不写入受版本控制的文件、prompt,也不外发。需求、证据、账本都留在你的工作区。
- **平台**:macOS 优先(tmux + `brew` + iTerm2)。tmux 核心理论上可在 Linux 运行但尚未验证。

你始终掌控:脚本和 MCP 工具只创建、校验、记录机器数据——不验收、不扩权、不替产品做决定。总控是唯一验收权威,产品决定属于你。

## 窗口模型

窗口传输是 Claude Code 版本的关键差异，而且 Claude Code 版本只使用终端。
每个 Wakeflow 窗口（包括总控）都是常驻 tmux 的交互式 `claude` session，
所有窗口位于同一个 tmux server session 内，默认名为 `wakeflow`。
session 名可在 `workspace.config.json` 中配置：

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

**投递。** 总控把 envelope prompt 写入临时文件，然后运行
`send --window <target> --prompt-file <file>`。helper 强制共享的按窗口投递锁，
通过 tmux buffer 粘贴 prompt，并返回 pane readback 证据；agent 用
`wakeflow_record_delivery` 记录这次投递。目标窗口以同样方式向总控窗口做
controller-return。`wait-results --group <id>` 只作为脚本化流程里的显式同步等待，
正常投递不会自动启用它。

**恢复。** tmux 窗口挂掉时，已注册的 session id 仍然是 thread id：先运行
`launch-window --resume --session-id <已注册 id> --replace` 交互式复活同一会话（订阅额度不变）。`claude -p --resume` 仅作最后手段：2026-06-15 起 `claude -p` 走独立的 Agent SDK 额度按 API 价计费。如确需 headless，再用该 id 运行
`launch-window --replace`。

**观察。** 用 `tmux attach -t wakeflow` 附着整个 server，用 helper 的
`attach-window --open-terminal` 在 macOS Terminal 打开单个窗口，或用 iTerm2
的 `tmux -CC` 原生集成。

**无人值守权限。** 无人值守的权限行为仍由用户决定。请在每个仓库的
`.claude/settings.json` 中配置按仓库的 allowlist，或在清楚后果的前提下为可信
session 在启动时选择显式 permission mode。Wakeflow 永远不替用户做这个选择：
这是按仓库的主动决策，不是默认值。

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
  workspace.config.json
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
   并返回 session id；每个真实 session id 只传一次给 Wakeflow 本地注册命令。
   thread registry 是唯一 session-id 权威；window config 是由它派生的视图。

已经初始化过的工作区里，`wakeflow_initialize_workspace` 不是通用“刷新”按钮。
只有用户明确要求“重置初始化”时才能写入；apply 调用必须设置
`resetInitialization: true`，显式传入 `repositories`，重新确认 Design/Test 模式，
并且不能使用 `useDiscovered`。窗口上下文过重或过期时，使用替换窗口命令。

三个高层入口的职责要分清：

| 需求 | 命令 | 职责 |
| --- | --- | --- |
| 首次 setup | `wakeflow_initialize_workspace` | 发现、确认、写入 workspace config/docs/support surfaces，并返回完整 launch plan。 |
| 明确重置 setup | `wakeflow_initialize_workspace` + `resetInitialization: true` | 重新确认工作目录，清理被移除窗口的受管 cards/runtime，并重写 setup surfaces。 |
| 替换单个上下文过重/过期窗口 | `wakeflow_replace_windows`（传 `window`） | 只返回一个 replacement launch entry 和本地注册命令，不刷新 workspace docs。 |
| 替换多个上下文过重/过期窗口 | `wakeflow_replace_windows` | 只返回指定窗口的 replacement entries 和本地注册命令，不改无关窗口。 |

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
| `workspace.config.json` | 受管窗口、仓库路径、角色、host transport 设置（如 tmux session 名）和默认语言。 |
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
- Window config 从 `workspace.config.json` 和 thread-registry presence 派生，不是第二份 session-id 权威。
- Delivery prompts 保持轻量、可读。
- 总控把 envelope prompt 写入临时文件，由 host helper
  `send --window <target> --prompt-file <file>` 发送；helper 强制共享的按窗口
  投递锁，通过 tmux buffer 粘贴，并返回 pane readback 证据，由 agent 用
  `wakeflow_record_delivery` 记录。
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
| 设置和工作区发现 | `wakeflow_initialize_workspace` |
| 职责窗口替换 | `wakeflow_replace_windows`（单个传 `window`，多个传 `windows`） |
| Demand 和任务状态 | `wakeflow_status`, `wakeflow_init_demand`, `wakeflow_add_task`, `wakeflow_next_work` |
| 投递和返回 | `wakeflow_prepare_delivery`, `wakeflow_record_delivery` |
| 结果和 review | `wakeflow_record_target_result`, `wakeflow_review_pack`, `wakeflow_reduce_results`, `wakeflow_decide_review`, `wakeflow_complete_demand` |
| Design 和 Test intake | `wakeflow_intake_design_handoff`, `wakeflow_intake_test_card` |
| 归档、维护和验证 | `wakeflow_archive`（target demand/todo/docs）、`wakeflow_prune_runtime`、`wakeflow_verify`、`wakeflow_view`（scope trace） |

公共 MCP tools 面向外层 agent 工作流。target closeout 被故意拆开：
记录 target result、审查 readiness、在策略允许时准备 controller-return envelope、
通过 tmux host helper 发送，再记录 delivery evidence。总控 review 也保持拆分：
review pack、result reduction、显式决策；result reduction 只创建 review candidate，
不是验收。不要把这些步骤合并成一个 target-window MCP tool。归档摘要刷新内部步骤、
keep-live 状态和脚本后端执行这类内部环节留在 Wakeflow runtime scripts 和 skills 里。
公共归档 MCP tools 只包装总控批准的 TODO 或工作区文档归档流程；
它们不做验收决策，也不发送 host 消息。

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
共存，每个 demand 跨宿主只有一个总控。Demand 创建是宿主中立的
（`controllerHost: null`）；第一个真正驱动命令会把所有权认领为 `codex`
或 `claude-code`；非归属宿主的 controller 写操作和投递准备会 fail-closed；
`--adopt-host` 是显式转移机制。`wakeflow_status` 会在
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
| `.claude-plugin/plugin.json` | 插件 manifest 与 MCP server 引用。 |
| `.mcp.json` | MCP server wiring（`node ${CLAUDE_PLUGIN_ROOT}/mcp/server.cjs`）。 |
| `mcp/server.cjs` | 无 `node_modules` 依赖的 standalone MCP server entrypoint。 |
| `lib/` | MCP 工具定义、runtime helpers、进程与 trace 支持。 |
| `scripts/` | 随插件发布的 setup、state、delivery、intake、archive、validation 和 CLI runtime。 |
| `skills/` | 随插件发布的 controller、target 和 governance 操作手册。 |
| `commands/` | `/wakeflow:*` slash command 定义。 |
| `templates/wakeflow-template-bundle.json` | 已安装工作区 starter documents 和 support surfaces 的 bundle，用于控制 marketplace scan 文件数。 |
| `assets/` | Marketplace 和插件展示资源。 |

仓库根 README 解释共享架构；本 README 是 Claude Code 版本手册。

## 设计原则

1. **判断必须可见**：脚本输出、状态行、target backfill 是证据，不是验收。
2. **一个需求，一个 state root**：JSON state 和 Markdown progress surface 绑定到同一个 demand。
3. **Prompt 负责唤醒，state 负责指令**：prompt 应轻量；任务细节属于 state roots、task packages 和 installed skills。
4. **仓库边界很重要**：每个窗口拥有自己的源码、测试、提交和证据。
5. **自动化移动工作，不转移权威**：投递只能证明 prompt 已发送，不能证明结果完成。
6. **本地运行时留在本地**：真实 session id 只留在本地 thread registry，active runtime state 不进入 tracked docs。
7. **默认创建新的支持窗口**：Design 和 Test 默认作为清晰的 Wakeflow support surfaces 创建，除非用户明确映射既有目录。

Wakeflow 的目标是让无人值守的多窗口工作可以安全恢复、容易审查，并且难以伪造完成。
