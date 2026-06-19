<div align="center">

# Wakeflow

面向多窗口 agent 工作的无人值守控制循环。

[English](README.md) | [简体中文](README.zh-CN.md)

Wakeflow 把一个本地 Codex 或 Claude Code 工作区变成有纪律的控制系统：
一个总控窗口、多个聚焦的仓库窗口、明确的 state root、轻量 direct-thread
或 direct-session 投递，以及基于证据的验收。

</div>

---

- [为什么需要 Wakeflow](#为什么需要-wakeflow)
- [架构](#架构)
- [安装 Wakeflow](#安装-wakeflow)
- [初始化工作区](#初始化工作区)
- [Wakeflow 会创建什么](#wakeflow-会创建什么)
- [自动化语义](#自动化语义)
- [MCP 能力面](#mcp-能力面)
- [运行时与账本边界](#运行时与账本边界)
- [双宿主工作区](#双宿主工作区)
- [Marketplace 发布](#marketplace-发布)
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
- **轻量投递**：direct-thread prompt 只负责唤醒正确窗口；state root 和 skills 保存任务细节。
- **先证据，后验收**：target backfill 是输入，不是结论；总控仍然要检查原始证据。
- **本地优先运行时**：真实 thread id 只存在本地 thread registry；window config 是派生视图，active state 不进入源码。

Wakeflow 不是换了名字的命令启动器。它是一个可复用的工作流能力，用来让多窗口
agent 工作保持可读、有边界、可恢复。

## 架构

Wakeflow 由三层共同工作：你能看到的窗口舰队、推进工作的闭环，以及重启后仍能恢复的
磁盘布局。Codex 与 Claude Code 两个版本运行同一份共享 core；差异只在传输层
（Codex host thread tools 对比 tmux send helper）。

### 第 1 层 - 窗口舰队（你看到的东西）

每个 Wakeflow 窗口都是长期存在、绑定单一责任的 agent session。Claude Code
版本把窗口舰队放在一个 tmux session 里，并带有实时状态徽标；Codex 版本使用
host threads。

| 窗口 | 角色 | 默认推理强度（Claude Code） |
| --- | --- | --- |
| Controller | 拥有目标、投递、证据审查和验收 | `max` |
| Design | 澄清需求、重设非 bug 结果偏差方案、准备 handoff | `xhigh` |
| Repo windows | 只在一个仓库边界内实现 | `xhigh` |
| Test | 执行仓库无法自测的真实场景验证 | `xhigh` |

### 第 2 层 - 闭环（工作如何推进）

工作被组织成 demand：一个 demand = 一个目标 = 磁盘上的一个 state root。每个
demand 都经过同一个闭环：

```text
 1 init       总控创建 demand state root                  (未认领)
 2 claim      第一个驱动命令把它绑定到一个平台             (codex | claude)
 3 add task   任务包命名目标窗口和范围
 4 dispatch   envelope 写入 -> 窗口加锁 -> prompt 投递
 5 work       目标窗口在自己的仓库边界内执行
 6 result     TargetResultEnvelope 携带 evidence refs 落地 -> 解锁
 7 review     总控读取原始证据，再 accept / rework / block
 8 complete   所有任务 accepted 且没有 blockers 后才完成
```

两条规则保证闭环可靠：**Prompt 负责唤醒，state 负责指令**（投递 prompt 只命名
窗口、task id 和 state root；任务定义存在 state root 和 skills 里），以及
**backfill 是输入，不是验收**（总控先审查原始证据再做决策；blocked decision
在新证据到达后始终可恢复）。

### 第 3 层 - 地面事实（磁盘上的内容）

```text
<workspace>/
  workspace.config.json          窗口、角色、每宿主配置              committed
  AGENTS.md / CLAUDE.md          每宿主总控 gate                    committed
  wakeflow-ledger/               长期设计、记录、归档               committed
  .wakeflow-active/             demand state roots（第 2 层）       local
  .wakeflow-local/wakeflow-delivery/                                local
    dispatch-packets/  delivery-envelopes/  delivery-runs/    transport records
    target-results/                                           evidence envelopes
    locks/                       每窗口一个 in-flight delivery，跨宿主
    hosts/codex/                 codex thread registry（宿主内）
    hosts/claude-code/           claude session registry + tmux bindings
```

经验规则：**业务真相是宿主中立并共享的；传输句柄按宿主隔离，且永远不离开
`.wakeflow-local/`。**

### 谁决定什么（信任模型）

脚本和 MCP 工具创建、验证、记录机器数据；它们不会验收工作、扩大范围，或决定产品行为。
目标窗口只执行被投递的任务包。总控是唯一验收权威，用户拥有产品决策。

### 双宿主共存

同一个工作区可以并行运行两个版本：demand 在 claim 时绑定到一个平台（每个驱动命令都会
机器校验），共享的每窗口 lock 会跨宿主串行化投递，所有权只通过显式且可审计的
`adopt-demand-host` 转移。

## 安装 Wakeflow

Wakeflow 采用和 Lark Remote 一样的双层 marketplace 结构：仓库根目录是开发工作区，
真正可安装的插件 artifact 位于 `plugins/` 之下。本仓库从一份共享 core 构建两个宿主版本：

| 宿主 | Artifact | 目录 |
| --- | --- | --- |
| Codex | `plugins/codex-wakeflow/` | `.agents/plugins/marketplace.json` |
| Claude Code | `plugins/claude-code-wakeflow/` | `.claude-plugin/marketplace.json` |

在 Claude Code 内安装 Claude Code 版本：

```text
/plugin marketplace add GxFn/Wakeflow
/plugin install wakeflow@gxfn
```

Claude Code 版本只使用 tmux 常驻终端模型：每个 Wakeflow 窗口（包括总控）都是
常驻 tmux 的交互式 `claude` 会话，位于名为 `wakeflow` 的 tmux server session
内；Wakeflow thread id 就是该窗口的 Claude Code session id（跨 resume 保持稳定）。
完整指南见 [plugins/claude-code-wakeflow/README.zh-CN.md](plugins/claude-code-wakeflow/README.zh-CN.md)。

安装公开 Codex 插件 artifact：

```bash
npx codex-marketplace add GxFn/Wakeflow/plugins/codex-wakeflow --plugin
```

如果已经有匹配 tag，可以固定版本安装：

```bash
npx codex-marketplace add https://github.com/GxFn/Wakeflow/tree/v0.5.6/plugins/codex-wakeflow --plugin
```

如果 Codex 对话框把 source、ref 和 sparse path 分开填写，请使用仓库 URL、目标 ref，
并把 sparse path 填成 `plugins/codex-wakeflow`。

本地开发时，可以把当前 checkout 注册成本地 marketplace：

```toml
[marketplaces.gxfn]
source_type = "local"
source = "/absolute/path/to/Wakeflow"

[plugins."wakeflow@gxfn"]
enabled = true

[plugins."wakeflow@gxfn".mcp_servers.wakeflow]
default_tools_approval_mode = "approve"
```

Wakeflow 不要求额外的聚合 marketplace 仓库。单独的 catalog 可以用于品牌展示，
但不是主要安装或发布路径。

## 初始化工作区

Wakeflow 作为 Codex 或 Claude Code 插件安装。目标工作区不需要包含 Wakeflow
源码。推荐的目标形态是：

```text
MyWorkspace/
  AGENTS.md 或 CLAUDE.md
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

1. Codex 调用 `wakeflow_initialize_workspace`，`apply: false`。
2. Wakeflow 返回目录事实和 `agentSelectionProtocol`。
3. Codex 根据目录事实和用户上下文判断工作区是 clean 还是 messy。
4. 对 clean 工作区，Codex 再次调用工具，并显式传入目标 work windows 的 `repositories` 映射。
5. 对 messy 工作区，Codex 先问用户哪些目录是受管窗口，不能直接广泛导入 discovered 目录。
6. 对首次初始化的工作区，用户确认后，Codex 调用
   `wakeflow_initialize_workspace`，`apply: true`。
7. Codex 创建返回的线程，将每个线程标题重设为 `displayTitle`，并把真实 thread id
   只写入 Wakeflow 本地注册命令。thread registry 是唯一 thread-id 权威；
   window config 是由它派生的视图。

已经初始化过的工作区里，`wakeflow_initialize_workspace` 不是通用“刷新”按钮。
只有用户明确要求“重置初始化”时才能写入；apply 调用必须设置
`resetInitialization: true`，显式传入 `repositories`，重新确认 Design/Test 模式，
并且不能使用 `useDiscovered`。窗口上下文过重或过期时，使用替换窗口命令。

三个高层入口的职责要分清：

| 需求 | 命令 | 职责 |
| --- | --- | --- |
| 首次 setup | `wakeflow_initialize_workspace` | 发现、确认、写入 workspace config/docs/support surfaces，并返回完整 launch plan。 |
| 明确重置 setup | `wakeflow_initialize_workspace` + `resetInitialization: true` | 重新确认工作目录，清理被移除窗口的受管 cards/runtime，并重写 setup surfaces。 |
| 替换单个上下文过重/过期窗口 | `wakeflow_replace_window` | 只返回一个 replacement launch entry 和本地注册命令，不刷新 workspace docs。 |
| 替换多个上下文过重/过期窗口 | `wakeflow_replace_windows` | 只返回指定窗口的 replacement entries 和本地注册命令，不改无关窗口。 |

Claude Code 版本使用同样的 preview/apply 合约。返回的 launch plan 由 tmux host
helper 实体化，而不是用 Codex `create_thread`：每个窗口都会作为交互式 `claude`
session 启动，并把返回的 Claude Code session id 注册为 Wakeflow thread id。

Design 和 Test 默认创建为新的支持 surface。`<Product>Design` 或 `<Product>Test`
这类相似目录只被当作目录事实，除非用户明确把它们映射成 Design/Test。

Wakeflow 支持本地化初始化。中文工作区传 `language: "zh"`，英文工作区传
`language: "en"`，没有明显偏好时传 `language: "auto"`。生成的线程标题会把窗口名放在最前面，
方便在窄侧边栏里识别仓库。新的 state-root progress 文档和后续 Unified Status
渲染也会使用所选界面语言。

总控和子窗口可以使用 Codex 或 Claude Code subagent 加速有边界的代码搜索、日志分诊、
测试定位和证据汇总。Subagent 输出只是证据或建议；总控 review、投递、状态写入
和仓库边界仍归拥有该任务的 Wakeflow 窗口。

## Wakeflow 会创建什么

初始化只写入已确认边界所需的 surface：

| Surface | 用途 |
| --- | --- |
| `AGENTS.md` | 父级总控 gate 和长期边界规则。 |
| 子窗口 `AGENTS.md` access cards | 每个窗口的责任和读取路径。 |
| `workspace.config.json` | 受管窗口、仓库路径、角色和默认语言。 |
| `.wakeflow-active/` | active state roots、当前索引、progress docs、TODO 投影、intake 和 test cards。 |
| `.wakeflow-local/` | thread registry、direct-thread runtime、本地 overrides 和派生 window config。 |
| `wakeflow-ledger/` | 长期项目协作记录和归档。 |
| `Design/` | 未映射外部 Design 仓库时创建的内部需求设计工作区。 |
| `Test/` | 未映射外部 Test 仓库时创建的内部测试协作工作区。 |

Wakeflow 也会同步 `.gitignore`，只把 `.wakeflow-active/` 和 `.wakeflow-local/`
作为本地运行时目录忽略。它不会把产品仓库、Design/Test、ledger、`.DS_Store`
或其他本地杂项加入 `.gitignore`。

## 自动化语义

Wakeflow 自动化是 direct-thread 投递加显式结果返回。

核心规则：

- 真实 thread id 只存在宿主独立的本地 thread registry：
  `.wakeflow-local/wakeflow-delivery/hosts/<host>/thread-registry/`
  （`codex` 或 `claude-code`）。
- Window config 从 `workspace.config.json` 和 thread-registry presence 派生，不是第二份 thread-id 权威。
- Delivery prompts 保持轻量、可读。
- Host 通过自己的传输边界发送 prompt：Codex 使用 thread tools，Claude Code 使用
  tmux host helper。Wakeflow 记录发送和 readback 证据。
- `group-ready` 会等待预期 target results，再允许 controller return。
- `per-target` 可以每个 target 唤醒一次 controller，同时保留 group snapshot。
- 一次真实发送被记录为 `sent` 且有 readback 证据后，总控本轮停止，不在同一轮 sleep 或 poll。
- Keep-live 只是运行时辅助，不是任务逻辑、传输权威或验收证据。
- Demand 创建是宿主中立的：`wakeflow_init_demand` 写入
  `controllerHost: null`，所以 Codex 和 Claude Code 都可以创建或导入需求材料，
  但不会因此抢占控制权。
- 第一个真正驱动需求的命令会把 demand 绑定到当前平台，写入
  `controllerHost: "codex"` 或 `controllerHost: "claude-code"`。
- demand 归属于某个宿主后，另一个宿主的 controller 写操作和投递准备会 fail-closed；
  只有显式 `--adopt-host` 才能转移控制权。
- `wakeflow_status` 会在 `dualHost.demandOwnership` 暴露 active demand 的宿主归属，
  让混合宿主总控在行动前先看清归属。

自动化会在最终完成、硬 gate、用户停止、没有 eligible work、缺失证据、blocked state、
或任何需要总控/用户判断的条件下停止。

## MCP 能力面

Wakeflow 只把稳定的外层工作流合约暴露成 MCP tools。运行时脚本仍然是内部实现和测试 surface；
脚本存在不等于它就是公共工具。目标窗口 closeout 与总控投递使用同一套 direct-thread 模型：
准备 envelope、用 host thread tool 发送 prompt、记录 delivery run。

主要工具组：

| 需求 | MCP tools |
| --- | --- |
| 设置和工作区发现 | `wakeflow_initialize_workspace` |
| 职责窗口替换 | `wakeflow_replace_window`, `wakeflow_replace_windows` |
| Demand 和任务状态 | `wakeflow_status`, `wakeflow_init_demand`, `wakeflow_add_task`, `wakeflow_next_work` |
| 投递和返回 | `wakeflow_prepare_delivery`, `wakeflow_record_delivery` |
| 结果和 review | `wakeflow_record_target_result`, `wakeflow_review_pack`, `wakeflow_reduce_results`, `wakeflow_decide_review`, `wakeflow_complete_demand` |
| Design 和 Test intake | `wakeflow_intake_design_handoff`, `wakeflow_intake_test_card` |
| 归档、维护和验证 | `wakeflow_archive_todo`, `wakeflow_archive_workspace_docs`, `wakeflow_verify`, `wakeflow_trace_spine` |

公共 MCP tools 面向外层 agent 工作流。target closeout 被故意拆开：
记录 target result、审查 readiness、在策略允许时准备 controller-return envelope、
通过当前归属宿主的 transport 发送，再记录 delivery evidence。不要把这些步骤合并成一个 target-window MCP tool。
总控 review 也保持拆分：review pack、result reduction 和显式 decision 分别处理；
result reduction 只创建 review candidate，不是验收。内部步骤（例如 archive summary
refresh internals、keep-live state、script backend execution）留在 Wakeflow
JS/runtime scripts 和 skills 内。公共 archive MCP tools 只包装总控批准的 TODO
或 workspace document archive flows；它们不做验收决策，也不发送 host messages。

Wakeflow 为每个公共 tool 声明 MCP annotations：只读工具标记为 read-only，写工具
标记为本地、非破坏性、闭世界。Codex approval policy 仍由用户自己的 Codex 配置控制。
可信本地 Wakeflow 安装对应的 Codex server policy 是：

```toml
[plugins."wakeflow@gxfn".mcp_servers.wakeflow]
default_tools_approval_mode = "approve"
```

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

Wakeflow 源仓库只跟踪可复用能力。产品代码、项目特定 active state、真实 thread id
和派生本地运行时 artifacts 都不应进入 Wakeflow 源码。

## 双宿主工作区

同一个工作区可以同时运行 Codex 和 Claude Code 两个 Wakeflow 版本。共享业务状态
保持宿主中立：`.wakeflow-active/`、`wakeflow-ledger/`，以及
`.wakeflow-local/wakeflow-delivery/` 下的共享投递 spine（`dispatch-packets/`、
`dispatch-groups/`、`delivery-envelopes/`、`delivery-runs/`、`target-results/`
和共享 `locks/`）。

宿主独立的运行时按宿主分开：

- `.wakeflow-local/wakeflow-delivery/hosts/codex/{thread-registry,window-config,keep-live}/`
- `.wakeflow-local/wakeflow-delivery/hosts/claude-code/{thread-registry,window-config,window-host,keep-live}/`

`AGENTS.md`（Codex）与 `CLAUDE.md`（Claude Code）可以在工作区根目录和子目录根
共存。每个 demand 仍然只有一个 controller host：创建中立，第一次驱动命令认领，
非归属宿主 fail-closed，`--adopt-host` 是显式转移机制。

## Marketplace 发布

Wakeflow 被打包成双宿主插件源仓库。公开 source of truth 是：

```text
https://github.com/GxFn/Wakeflow.git
```

仓库为不同宿主分别携带 catalog：

- `.agents/plugins/marketplace.json` 把 Codex 插件条目指向
  `./plugins/codex-wakeflow`。
- `.claude-plugin/marketplace.json` 把 Claude Code 插件条目指向
  `./plugins/claude-code-wakeflow`。

发布 Wakeflow 意味着给仓库打 tag，并向目标宿主提交正确的嵌套插件 artifact，
不是提交开发工作区根目录。

发布 release tag 前：

1. 在本仓库运行 `npm test`。
2. 在可用时运行对应宿主的 plugin manifest validator。
3. 确认 `plugins/codex-wakeflow/.codex-plugin/plugin.json` starter prompts 不超过 3 条。
4. 确认两个宿主 catalog 都只指向各自的嵌套插件 artifact。
5. 确认 runtime scripts 和 installed skills 没有项目特定默认 controller 名、产品 overlay、
   本地路径或私有 thread id。
6. 给目标宿主 marketplace 应安装的精确 commit 打 tag。

## 开发本仓库

本仓库用于开发 Wakeflow 插件本身。

```sh
npm run sync:core    # 把 core/ 同步进两个插件 artifact
npm run check:core   # artifact 偏离 core/ 时报错
npm run validate     # codex artifact 校验
npm run validate:claude
npm run smoke        # codex artifact 冒烟
npm run smoke:claude
npm run test:wakeflow
npm test             # check:core + 双 validate + 双 smoke + 全部测试
```

共享 core 规则：宿主中立的 runtime 文件放在 `core/`，由 `tools/sync-core.mjs`
同步进两个 artifact；只在 `core/` 里编辑它们，不要改 artifact 里的副本。宿主特定
文件（host profile、host artifact checks、host send adapter、manifest、README、
memory 文件模板、skills、template bundle）只存在于各自 artifact 内。
`npm run check:core` 负责保证副本不漂移。

完整的双版本架构、代码逻辑、本地存储（共享业务状态与宿主独立运行时的划分）与状态流转，
见 [docs/wakeflow-dual-edition-architecture-and-state-flow.md](docs/wakeflow-dual-edition-architecture-and-state-flow.md)。

常见源码区域：

| Path | 用途 |
| --- | --- |
| `core/` | 宿主中立 runtime 的唯一事实源，同步进两个 artifact。 |
| `tools/sync-core.mjs` | core 同步与漂移检查（`--check`）。 |
| `plugins/codex-wakeflow/.codex-plugin/plugin.json` | Codex 插件 manifest 和 MCP wiring。 |
| `plugins/claude-code-wakeflow/.claude-plugin/plugin.json` | Claude Code 插件 manifest 和 MCP wiring。 |
| `plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-profile.mjs` | Claude Code host profile（tmux 窗口模型、CLAUDE.md、session 词汇）。 |
| `plugins/codex-wakeflow/mcp/server.cjs` | 无 `node_modules` 依赖的 standalone MCP server entrypoint。 |
| `plugins/codex-wakeflow/scripts/` | 随插件发布的 setup、state、delivery、intake、archive、validation 和 CLI runtime。 |
| `plugins/codex-wakeflow/skills/` | 随插件发布的 controller、target、governance 和 validation 操作手册。 |
| `plugins/codex-wakeflow/templates/wakeflow-template-bundle.json` | 已安装工作区 starter documents 和 support surfaces 的 bundle，用于控制 marketplace scan 文件数。 |
| `plugins/codex-wakeflow/assets/` | Marketplace 和插件展示资源。 |
| `test/` | 开发期回归测试，不进入 marketplace 扫描面。 |
| `docs/` | 开发期规划和架构文档，不进入插件 artifact。 |

详细命令说明在 [scripts/README.md](plugins/codex-wakeflow/scripts/README.md)。顶层 README 解释系统模型；
script README 是操作者手册。

## 设计原则

1. **判断必须可见**：脚本输出、状态行、target backfill 是证据，不是验收。
2. **一个需求，一个 state root**：JSON state 和 Markdown progress surface 绑定到同一个 demand。
3. **Prompt 负责唤醒，state 负责指令**：prompt 应轻量；任务细节属于 state roots、task packages 和 installed skills。
4. **仓库边界很重要**：每个窗口拥有自己的源码、测试、提交和证据。
5. **自动化移动工作，不转移权威**：direct-thread delivery 只能证明 prompt 已发送，不能证明结果完成。
6. **本地运行时留在本地**：真实 thread id 只留在本地 thread registry，active runtime state 不进入 tracked docs。
7. **默认创建新的支持窗口**：Design 和 Test 默认作为清晰的 Wakeflow support surfaces 创建，除非用户明确映射既有目录。

Wakeflow 的目标是让无人值守的多窗口工作可以安全恢复、容易审查，并且难以伪造完成。
