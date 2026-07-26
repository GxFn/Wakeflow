<div align="center">

# Wakeflow

面向多窗口 agent 工作的严谨控制循环——每一步留痕、每个结果实证。

[English](README.md) | [简体中文](README.zh-CN.md)

Wakeflow 把一个本地 Codex 或 Claude Code 工作区变成有纪律的控制系统：
每个 active demand 一条由总控负责的闭环、多个聚焦的仓库窗口、明确的 state root、轻量 direct-thread
或 direct-session 投递，以及基于证据的验收。总控以闭环方式运行这套系统——规划、派发、收集证据、审查、决策、循环往复——并记录每一步，整个过程事后可审计。

</div>

---

- [为什么需要 Wakeflow](#为什么需要-wakeflow)
- [架构](#架构)
- [安装 Wakeflow](#安装-wakeflow)
- [初始化工作区](#初始化工作区)
- [跑通第一个需求](#跑通第一个需求)
- [Wakeflow 会创建什么](#wakeflow-会创建什么)
- [自动化语义](#自动化语义)
- [MCP 能力面](#mcp-能力面)
- [运行时与账本边界](#运行时与账本边界)
- [双宿主工作区](#双宿主工作区)
- [Marketplace 发布](#marketplace-发布)
- [开发本仓库](#开发本仓库)
- [设计原则](#设计原则)

## 为什么需要 Wakeflow

把一个真实的多仓库目标交给一队 agent，过几天回来问三个最要紧的问题：
**到底做了什么？什么证据能证明？还剩什么没做？** 没有控制层时，诚实的答案
只能是一堆零散 prompt、复制粘贴的状态表、不清晰的责任边界，和一句"看起来
完成了"——无法审计、无法续跑、无法信任。

Wakeflow 就是那个缺失的控制层——一个总控窗口驱动多个聚焦的仓库窗口，走一条
显式的、机器校验的闭环，每一步都在磁盘上留下可验证的工件：

- **总控优先判断**：父工作区负责目标、边界、投递决策、验收、TODO 路由和归档决策。
- **一个需求一个 state root**：任务包、目标结果、review candidate、决策和进度投影都绑定到同一个需求。
- **聚焦的子窗口**：每个仓库窗口只在配置好的责任边界内工作。
- **轻量投递**：direct-thread prompt 只负责唤醒正确窗口；state root 和 skills 保存任务细节。
- **先证据，后验收**：target backfill 是输入，不是结论；总控仍然要检查原始证据。
- **本地优先运行时**：真实 thread id 只存在本地 thread registry；window config 是派生视图，active state 不进入源码。

你具体得到什么：

- **可审计** —— 每次派发、投递、结果、决策都是一个 JSON 工件，串在同一条
  trace 脊椎上；`wakeflow_view`（scope `trace`）可以回放谁在哪个状态版本上、
  凭什么证据做了什么。
- **可续跑** —— 需求从磁盘 state root 接着走。Codex thread 与 Claude Code
  conversation 通过宿主本地注册 id 重新绑定；机器重启后，需要先重新拉起 Claude
  的 tmux 窗口，再恢复原会话。对话记忆不是状态权威。
- **难以造假** —— 验收要求 reducer 在磁盘上逐一核验的原始证据（证据引用缺失
  即 fail-closed）；"目标窗口说做完了"永远不算数，结果也永远不能自我验收。
- **并行不混乱** —— 最多 `maxActiveDemands` 个需求以隔离舱并行（各自的总控、
  worktree、Test）；需求内部每仓严格一窗口一组合包，舱分支只通过人工审核的
  台账合并回主线。
- **构造上安全** —— 归属、容量、锁、归档脱敏全部 fail-closed；真实 session id
  永不离开本地注册表。

Wakeflow 不是换了名字的命令启动器。它是一个可复用的工作流能力，用来让多窗口
agent 工作保持可读、有边界、可恢复。

## 架构

Wakeflow 由三层共同工作：你能看到的窗口舰队、推进工作的闭环，以及重启后仍能恢复的
磁盘布局。Codex 与 Claude Code 两个版本运行同一份宿主中立的 state、delivery
和 validation core；manifest、memory file、窗口生命周期与 transport 仍由各宿主实现
（Codex host thread tools 对比 tmux helper）。

### 第 1 层 - 窗口舰队（你看到的东西）

每个 Wakeflow 窗口都是绑定单一责任的 agent session。Claude Code 的基础舰队
位于配置的 tmux session，每个 demand pod 另有独立 tmux session；Codex 版本使用 host threads。

| 窗口 | 角色 | 默认推理强度（Claude Code） |
| --- | --- | --- |
| Controller | 拥有目标、投递、证据审查和验收 | `max` |
| Design | 澄清需求、重设非 bug 结果偏差方案、准备 handoff | `xhigh` |
| Repo windows | 只在一个仓库边界内实现 | `xhigh` |
| Test | 总控验收并完成自身验证后，只探索获批真实环境边界中的隐藏 bug | `xhigh` |

### 第 2 层 - 闭环（工作如何推进）

工作被组织成 demand：一个 demand = 一个目标 = 磁盘上的一个 state root。每个
demand 都经过同一个闭环：

```text
 1 init       底层 state init 创建 demand root             (未认领)
 2 claim      公共 create 或底层 root 首次驱动时绑定宿主     (codex | claude)
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
  wakeflow.config.json          窗口、角色、每宿主配置              committed
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

脚本和 MCP 工具创建、验证、记录机器数据；它们不会自行选择验收、扩大范围或决定产品行为，
只会持久化总控的显式决策。
目标窗口只执行被投递的任务包。总控是唯一验收权威，并且必须在 Test 开始前证明功能正确；
Test 不能自创目标、方法或完成标准，只探索获批环境边界。用户拥有产品决策。

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
最多 `maxActiveDemands`（默认 2）个需求可以以 **demand pod** 的方式并行：每个
pod 是独立的 tmux session，拥有自己的总控、按仓库的 isolation worktree 窗口和
自己的 Test，整个 pod 共用这条需求的一套 worktree（Test 也在 worktree 上验证，
绝不碰主检出）；超出容量的 claim 会 fail-closed，pod 分支只通过人工审核的
`pending-merges.md` 台账合并回主线。
完整指南见 [plugins/claude-code-wakeflow/README.zh-CN.md](plugins/claude-code-wakeflow/README.zh-CN.md)。

安装公开 Codex 插件 artifact：

```bash
npx codex-marketplace add GxFn/Wakeflow/plugins/codex-wakeflow --plugin
```

如果已经有匹配 tag，可以固定版本安装：

```bash
npx codex-marketplace add https://github.com/GxFn/Wakeflow/tree/v0.8.15/plugins/codex-wakeflow --plugin
```

如果 Codex 对话框把 source、ref 和 sparse path 分开填写，请使用仓库 URL、目标 ref，
并把 sparse path 填成 `plugins/codex-wakeflow`。

Codex 版本以按需求划分的线程组运行同一套 demand pod 模型：`wakeflow_pod_open`
创建这条需求的一套 worktree 并返回 windowPlan，agent 用 `create_thread` 逐条
落实（每个线程的 cwd 就是它的 worktree），完成后用 `wakeflow_pod_close` 拆除并
把存活分支记到 pending-merges 台账。共享不变量是一条需求一个总控、一个 Test、
每个选中仓库一个 worktree；窗口生命周期与拆除顺序由各宿主负责。

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

> 命名说明：`wakeflow.config.json` 是规范配置名。改名前的工作区里
> `workspace.config.json` 仍然可读（只读回退）；方便时用
> `git mv workspace.config.json wakeflow.config.json` 迁移——
> `check-workspace` 会提醒。

```text
MyWorkspace/
  AGENTS.md 或 CLAUDE.md
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
| 替换单个上下文过重/过期窗口 | `wakeflow_replace_windows`（传 `window`） | 只返回一个 replacement launch entry 和本地注册命令，不刷新 workspace docs。 |
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

## 跑通第一个需求

两个宿主跑的是同一条闭环，差别只在驱动方式。

**Claude Code（slash 命令）：**

1. `/wakeflow:init` —— 发现工作区、和你确认范围、写入配置/文档、拉起 tmux
   舰队（`tmux attach -t wakeflow` 随时旁观）。
2. 把目标交给 Design 窗口（或自己写需求）。Design 澄清后调用
   `wakeflow_deliver` —— 需求以 `pending-claim` 行落到全局 TODO 板，挂着
   设计文档链接。
3. 在总控里：`/wakeflow:status` 看板，然后认领 —— `wakeflow_claim_next`
   （可自动认领的行）或 `wakeflow_create_demand`（显式指定）。这一步初始化
   state root 并消费该行；派发前总控会和你确认计划与任务包。
4. `/wakeflow:dispatch` —— 备好 envelope、一步投递、记录 readback、结束本轮。
   目标窗口在自己的仓库边界内干活，controller-return 带着证据唤醒总控。
5. `/wakeflow:review` —— 先读结果背后的原始证据，再记录决策：
   accept / rework / blocked / redesign。
6. 重复 dispatch → review，直到所有非 Test 任务 accepted，且总控完成自己的功能验证。
   之后总控才可添加/派发已确认的 Test card；Test 必须遵守冻结目标、获批测试方案、
   `controllerSelfChecks`、allowed skills、setup policy 与 attempt bound。
   progressive-chain-validation 等 Test skill 只有被 card 显式列出时才能使用。
7. 所有必需任务 accepted 后，运行
   `wakeflow_complete_demand` + `wakeflow_archive` 把整个故事收进台账。
   demand 归档 dry-run 会报告真实 ID 与绝对路径发现；使用 `redact: true`
   提交经二次扫描的可移植副本，并在本地保留原始证据。
   若完成后、归档前发现仍属于原完成定义的已验证缺陷或已确认补充，
   `wakeflow_continue_demand` 会保留原完成记录，并在一次受控操作中追加首个 bug／补充／
   明确授权优化任务包。已归档历史不可恢复；独立后续工作新建 demand。

**Codex（自然语言）：** 同一条闭环、同一套 MCP 工具 ——
"用 Wakeflow 初始化这个工作区"、"认领下一个需求"、"派发下一个任务包"、
"评审返回的结果"、"完成并归档这个需求"。

**日常驾驶（Claude Code）：**

| 你想 | 做 |
| --- | --- |
| 进入舰队 | 开个终端，`tmux attach -t wakeflow` |
| 看全局在哪 | `/wakeflow:status` |
| 推进工作 | `/wakeflow:dispatch` |
| 评判返回的工作 | `/wakeflow:review` |
| 健康检查 / 换掉臃肿窗口 | `/wakeflow:check` · `/wakeflow:windows <名字> --replace` |
| 无人值守（留痕同意） | `/wakeflow:unattended on` |
| 并行第二个需求 | 让总控开一个需求舱（`pod-open`）——独立 session、独立总控、独立 Test |

## Wakeflow 会创建什么

初始化只写入已确认边界所需的 surface：

| Surface | 用途 |
| --- | --- |
| `AGENTS.md` | 父级总控 gate 和长期边界规则。 |
| 子窗口 `AGENTS.md` access cards | 每个窗口的责任和读取路径。 |
| `wakeflow.config.json` | 受管窗口、仓库路径、角色和默认语言。 |
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
- Window config 从 `wakeflow.config.json` 和 thread-registry presence 派生，不是第二份 thread-id 权威。
- Delivery prompts 保持轻量、可读。
- Host 通过自己的传输边界发送 prompt：Codex 使用 thread tools，Claude Code 使用
  tmux host helper。Wakeflow 记录发送和 readback 证据。
- `group-ready` 会等待预期 target results，再允许 controller return。
- `per-target` 可以每个 target 唤醒一次 controller，同时保留 group snapshot。
- 一次真实发送被记录为 `sent` 且有 readback 证据后，总控本轮停止，不在同一轮 sleep 或 poll。
- Keep-live 只是运行时辅助，不是任务逻辑、传输权威或验收证据。
- 底层 `wakeflow-state init` 是宿主中立的，写入 `controllerHost: null`。
  公共 `wakeflow_create_demand` 会立即把新 root 认领给调用宿主；独立导入的底层
  raw root 则保持未认领，直到第一次驱动命令。
- demand 归属于某个宿主后，另一个宿主的 controller 写操作和投递准备会 fail-closed；
  只有显式 `--adopt-host` 才能转移控制权。
- 最多 `maxActiveDemands`（默认 2）个需求可以同时 active；超出容量的 claim 会 fail-closed。`wakeflow_next_work` 报告 `activeDemands` 与 `demandCapacity`。
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
通过当前归属宿主的 transport 发送，再记录 delivery evidence。不要把这些步骤合并成一个 target-window MCP tool。
总控 review 也保持拆分：review pack、result reduction 和显式 decision 分别处理；
result reduction 只创建 review candidate，不是验收。内部步骤（例如 archive summary
refresh internals、keep-live state、script backend execution）留在 Wakeflow
JS/runtime scripts 和 skills 内。公共 archive MCP tools 包装总控批准的 demand、TODO
和 workspace document archive flows。`wakeflow_sanitize_archive` 只把已归档 demand
替换为隐私清洁副本并在本地保留原件；两者都不做验收决策，也不发送 host messages。

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
共存。每个 demand 仍然只有一个 controller host：公共 create 立即认领调用宿主，
底层 raw init 保持中立直到首次驱动；非归属宿主 fail-closed，`--adopt-host` 是显式转移机制。

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
见 [docs/wakeflow-dual-edition-architecture-and-state-flow.md](docs/wakeflow-dual-edition-architecture-and-state-flow.md)；
配套的设计模式深读（架构为什么长成这样、付出了什么代价）见
[docs/wakeflow-architecture-deep-dive-2026-07-02.md](docs/wakeflow-architecture-deep-dive-2026-07-02.md)。

常见源码区域：

| Path | 用途 |
| --- | --- |
| `core/` | 宿主中立 runtime 的唯一事实源，同步进两个 artifact。 |
| `tools/sync-core.mjs` | core 同步与漂移检查（`--check`）。 |
| `plugins/codex-wakeflow/.codex-plugin/plugin.json` | Codex 插件 metadata；`mcpServers` 指向 `.mcp.json`。 |
| `plugins/codex-wakeflow/.mcp.json` | Codex MCP 进程 wiring。 |
| `plugins/claude-code-wakeflow/.claude-plugin/plugin.json` | Claude Code 插件 metadata；`mcpServers` 指向 `.mcp.json`。 |
| `plugins/claude-code-wakeflow/.mcp.json` | Claude Code MCP 进程 wiring 与工作区根环境。 |
| `plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-profile.mjs` | Claude Code host profile（tmux 窗口模型、CLAUDE.md、session 词汇）。 |
| `plugins/codex-wakeflow/mcp/server.cjs` | 无 `node_modules` 依赖的 standalone MCP server entrypoint。 |
| `plugins/codex-wakeflow/scripts/` | 随插件发布的 setup、state、delivery、intake、archive、validation 和 CLI runtime。 |
| `plugins/codex-wakeflow/skills/` | 随插件发布的 controller、target protocol、target craft 与 governance 操作手册。 |
| `plugins/codex-wakeflow/templates/wakeflow-template-bundle.json` | 已安装工作区 starter documents 和 support surfaces 的 bundle，用于控制 marketplace scan 文件数。 |
| `plugins/codex-wakeflow/assets/` | Marketplace 和插件展示资源。 |
| `test/` | 开发期回归测试，不进入 marketplace 扫描面。 |
| `docs/` | 开发期规划和架构文档，不进入插件 artifact。 |

后端/源码维护命令说明在 [scripts/README.md](plugins/codex-wakeflow/scripts/README.md)。
已安装总控使用 MCP tools 与 skills，不把原始脚本当作操作入口。

## 设计原则

1. **判断必须可见**：脚本输出、状态行、target backfill 是证据，不是验收。
2. **一个需求，一个 state root**：JSON state 和 Markdown progress surface 绑定到同一个 demand。
3. **Prompt 负责唤醒，state 负责指令**：prompt 应轻量；任务细节属于 state roots、task packages 和 installed skills。
4. **仓库边界很重要**：每个窗口拥有自己的源码、测试、提交和证据。
5. **自动化移动工作，不转移权威**：direct-thread delivery 只能证明 prompt 已发送，不能证明结果完成。
6. **本地运行时留在本地**：真实 thread id 只留在本地 thread registry，active runtime state 不进入 tracked docs。
7. **默认创建新的支持窗口**：Design 和 Test 默认作为清晰的 Wakeflow support surfaces 创建，除非用户明确映射既有目录。

Wakeflow 的目标是让多窗口 agent 工作可以安全恢复、容易审查，并且难以伪造完成。
