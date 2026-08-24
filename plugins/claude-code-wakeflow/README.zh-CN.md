<div align="center">

# Wakeflow for Claude Code

面向多窗口 agent 工作的严谨控制循环——每一步留痕、每个结果可审查。

[English](README.md) | [简体中文](README.zh-CN.md)

Wakeflow 把一个本地 Claude Code 工作区变成有纪律的控制系统：每个 active demand 一条由总控负责的闭环、
多个聚焦的仓库窗口、明确的 state root、轻量 delivery envelope，以及由总控独立验证的验收。总控以闭环方式运行这套系统——规划、派发、收集审查输入、独立复验、决策、循环往复——并记录每一步，整个过程事后可审计。

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
- **先预览再投递**：总控先审阅解析后的仓库、任务简报、Skills 和最终 prompt，再用匹配计划的 `target-apply` 写入 delivery envelope，并以 `target-claim` 取得精确 lease。
- **验收锚点驱动工艺**：每个新 implementation 任务包必须携带至少一个明确的
  claim/probe/expected 锚点，子窗口编码前先映射为 RED 检查；总控仍独立复验。
- **先有审查输入，再做验收**：target backfill、日志、路径和测试摘要是输入，不是结论；Wakeflow 只检查结构和路径可定位性，总控仍要独立验证行为。
- **本地优先运行时**：raw session id 只存在 typed 宿主本地 window binding；脱敏
  window-runtime 文件只是投影，active state 不进入源码。

Wakeflow 不是换了名字的命令启动器。它是一个可复用的工作流能力，用来让多窗口
agent 工作保持可读、有边界、可恢复。

## 架构

Wakeflow 由三层协同构成:看得见的窗口舰队、推动工作的闭环、以及重启不丢的磁盘布局。

### 第一层 —— 舰队(你看到的)

基础舰队位于配置的 tmux session，每个用户明确授权的 Pod 另有独立 tmux session。每个窗口
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
| 无徽章 | 空闲，或投递安静在途（需要时由 strict status 与 typed host projection 报告机器事实） |

| 窗口 | 职责 | 默认推理力度 |
| --- | --- | --- |
| Controller(总控) | 目标、派发、独立验证、验收 | `max` |
| Design | 澄清需求、重设非 bug 结果偏差方案、准备交接 | `xhigh` |
| 仓库窗口 | 只在一个仓库内实现 | `xhigh` |
| Test | 总控验收并完成自身验证后，只探索获批真实环境边界中的隐藏 bug | `xhigh` |

每个窗格底部的 statusline 以纯文本显示实时服务模型与窗口身份。tmux 窗口不会跨机器
重启存活。fresh setup 与 replacement 只返回宿主中立 launch intent；只有 v3 Claude
activation owner 可以实体化 intent 并注册最终精确 session handle。Pod inspection 独立使用
`operation=inspect-materialization`，只观察已有精确 binding 及其记录 cwd；当前产品/主检出的
HEAD 与 dirty 状态只是观察结果，不是恢复门禁。

### 第二层 —— 闭环(工作如何流动)

工作以需求(demand)组织:一个需求 = 一个目标 = 磁盘上一个 state root。
每个需求走同一条闭环:

```text
 1 create     public create 发布 demand root 与 authority     (未认领)
 2 claim      精确 TODO claim 或显式 create 绑定 Controller   (codex | claude)
 3 add task   任务包冻结目标窗口上下文与需求锚点
 4 dispatch   预览 -> 摘要匹配 apply -> 上锁 -> 粘贴 prompt
 5 work       目标窗口在自己的仓库边界内执行
 6 result     带 typed evidence locators 的严格 TargetResult 落盘 -> 锁释放
 7 review     总控检查输入并独立复验,然后 accept / rework / redesign / blocked
 8 complete   活跃必需任务通过、替代链有效且无 blocker 时才能完结
```

这些规则保证闭环诚实:

- **无论谁创建，都只有一份 demand authority。** 只要后续需要任何 TaskPackage，
  总控就必须在首次 `wakeflow_create_demand` 发布时一并写入完整
  `demand-authority.json`；公开 v3 没有事后补 authority 的操作。无 authority 的
  demand 不能再通过公开接口获得 TaskPackage；Auto Claim 只改变 claim 时机。

- **Prompt 分层提示、任务包提供上下文、Skills 执行。** 有界 prompt 携带目标、
  最高优先完成/上下文/边界提示、读取顺序、身份与追踪；任务包保存完整任务上下文，
  需求锚点保存原始背景，Skills 保存执行流程。
- **回填是输入,不是验收。** 目标窗口的自述永远不能关闭工作;总控先检查目标提交的
  commit、命令输出和报告，并独立复验相关行为后再记录决定。blocked 决定永远可恢复:新审查输入到来即
  重新开启评审。
- **替代关系必须显式。** 普通 rework 重派同一任务；主线 redesign 在 Design
  handoff 后使用精确
  `replacesTargetTask:{targetTaskId,taskPackageRef,taskPackageDigest}` 创建完整
  replacement 包，接受后旧任务
  和包变为 `superseded`。当前 Pod 只冻结一代 Design request/handoff，
  这一代的 `requestType` 可以是 `initial-design`、`supplement` 或 `redesign`；
  不同的第二代请求保持 blocked，不覆盖既有 handoff，也不回退主线 Design。

### 第三层 —— 地基(磁盘上是什么)

```text
<workspace>/
  wakeflow.config.json          窗口、角色、模型/力度钉子          入库
  CLAUDE.md(每仓库各一份)       总控门 / 访问卡                    入库
  .claude/settings.json          可移植 allow 规则、相对引用        入库
  .claude/settings.local.json    本机 statusline 命令               永不入库
  wakeflow-ledger/               长期设计、记录、归档               入库
  .wakeflow-active/current/<demandId>/                              本机
    demand/state/events/task-packages/results/review/evidence  active authority
  .wakeflow-local/                                                本机
    audit/preserved/<preservationId>/                         typed audit hold
    runtime/maintenance/transactions/                         mutation journal
    runtime/shared/{coordination,transport}/                   lease + transport
    runtime/hosts/<host>/{identity,projections,evidence,operations}/ host runtime
```

一句话原则:**业务真相宿主中立、双方共享;传输句柄宿主私有、永不离开
`.wakeflow-local/`。** 会话 id 不会出现在任何入库文件、prompt 或回填文本里。

### 谁能决定什么(信任模型)

- 脚本与 MCP 工具负责创建、校验、记录机器数据；它们不会自行选择验收、扩权或替产品做决定，
  只会持久化总控的显式决策。
- 目标窗口只执行被派发的任务包并回报审查输入。
- 总控是唯一的验收权威，必须独立验证相关行为。
- 产品决定属于用户。`bypassPermissions` 永不默认开启:只有用户显式同意后才写进
  `wakeflow.config.json`,这条被记录的同意才是无人值守启动对话框的授权来源。

### 双宿主共存

同一工作区可同时运行 Codex 版与 Claude Code 版。demand/business 权威保持宿主中立；
每次操作由精确 current binding 和 transport lineage 选择宿主，共享 typed lease 串行化
target delivery。不存在公共 demand-host 转移状态机；unknown 或 host-wide activation
coverage 保持 manual host gate。

## 安装 Wakeflow

> 平台支持：Claude 宿主 seam 以 macOS 和 tmux 为当前边界。终端 attach 只属于
> 操作者观察，绝不是 binding、delivery、close 或 recovery 权威。legacy helper
> preflight 与 socket 字段不属于 public-v3 配置或执行合约。


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
| Claude 宿主 seam | `scripts/lib/wakeflow-claude-host.mjs` 是当前 closed v3 facade；精确命令把 lifecycle、transport、settings/activity、Pod、activation-scope 与 decommission 委托给 typed owner，自身不维护第二套 registry 或 transport state。 |

## 快速开始

三步完成 strict v3 core 初始化与检查。宿主激活是独立 seam，不能用 legacy runtime 文件伪造。

1. **初始化**(每个工作区一次)——在 Claude Code 里,于工作区目录下:
   ```text
   /wakeflow:init
   ```
   预览完整显式 selection，确认精确 plan/digest 后 apply。不存在 discovery/reset alias；已有 v3 工作区使用 reconfigure/reconcile，legacy 工作区使用另行授权的 unregistered bootstrap。
2. **检查**——运行 `/wakeflow:check` 与 `/wakeflow:status`；两者都只是 strict v3 authority 的只读投影。
3. **只通过 v3 host seam 激活**——初始化返回 host-neutral `launchIntents`。逐项交给 facade 的精确 `launch-window` 命令，只注册最终 session handle；host effect 或 receipt 不可用时报告 intent 后停止，retired public-v2 命令不是 alias。

### 命令速查表

| 命令 | 作用 | 何时用 |
| --- | --- | --- |
| `/wakeflow:init` | preview/确认/apply fresh v3 初始化 | 全新工作区 |
| `/wakeflow:windows` | 检查 typed binding 与脱敏 runtime projection | identity/runtime 定位 |
| `/wakeflow:windows <window-id> replace` | 规划一个精确替换；host effect 独立执行 | 窗口陈旧 / 上下文太重 |
| `/wakeflow:windows <window-id> decommission` | 仅在精确 close + absence 证据后执行 | 已验证 Claude 关闭 |
| `/wakeflow:status` | 需求、可领取工作、投递、窗口就绪度 | 派发前 |
| `/wakeflow:dispatch` | preview/apply/claim 后要求 fenced v3 host adapter，并记录 outcome | 向已绑定窗口派发 |
| `/wakeflow:review` | 检查 strict current result、独立验证，再创建/决定 candidate | 有结果回来了 |
| `/wakeflow:unattended on|off` | 预览 desired-model 策略变更；unknown/host-wide activation 阻止 `on` | 无人值守 ↔ 逐操作提示 |
| `/wakeflow:check` | 只读 strict v3 verification | 变更或升级后 |

## 安全与系统影响

Wakeflow 是一个强大的本地自动化插件。安装前请清楚它在你机器上做什么——没有任何隐藏:

- **运行一个本地 MCP server**（`bin/wakeflow-mcp`）：无依赖启动器选择 Node.js 20+ 后启动 `mcp/server.cjs`。server 读写工作区状态文件，自身不发任何网络请求。
- **host effect 独立**：public core 只规划并记录 typed fact，不冒充 Claude session 的 launch/paste/close；packaged v3 facade 把 effect 委托给具有精确 mutex/receipt 合约的宿主 owner。
- **权限模型**：无人值守必须显式选择，并受 activation coverage 额外约束。`unknown` 或 `host-wide` coverage 禁止无人值守激活；Wakeflow 不新增机器级全局 workspace registry。
- **本地优先、无遥测**：raw session handle/locator 只存在 host-local typed binding/operation tree，绝不进入 tracked 文件、prompt、transport 或 portable archive。

你始终掌控：脚本和 MCP 工具只创建、校验、记录机器数据；它们不会自行选择验收、扩权或替产品做决定，
只会持久化总控的显式决策。
总控是唯一验收权威，必须在 Test 开始前完成自己的功能验证，且所有活跃/开放的非 Test
target 都已 accepted；具有正典 replacement lineage 的 `superseded` 历史不属于开放目标。
Test 遵守冻结目标与获批 Test card（`controllerSelfChecks`、获批计划、
allowed skills、setup policy、attempt bound），不能自创目标、gate、环境、skill 或方法；
progressive-chain-validation 只有被显式列出时才能使用。产品决定属于你。

## 窗口模型

Claude identity 是由 stable `windowId` 索引的 typed host-local binding。
raw session handle 保持私有；公开的 window-runtime projection 是脱敏、可重建的。
语义标题、tmux pane、cwd 或 legacy thread-registry/window-host 文件都不是 identity authority。

**启动。** fresh 初始化与 replacement 只产生 host-neutral intent。facade 的
`launch-window` owner 执行物理 session effect，随后由
`wakeflow_register_window operation=register` 记录最终 handle。effect 或 receipt
无法闭合时 intent 保持 blocked；不得写 retired public-v2 文件作为替代 binding。

**投递。** target delivery 固定为
`target-preview → target-apply → target-claim → fenced host effect →
target-outcome`。共享 typed lease 由 claim 取得，不是 apply 取得。v3 adapter
必须在 validation、paste、最多一次有界 readback 全程持有 stable-window mutex。
accepted、ambiguous 或 sent-unconfirmed transport 不得重发。Controller return 使用
`controller-preview/controller-apply/controller-pre-send`，不取得 target lease，
并记录独立 outcome。

**恢复与关闭。** creation、inspection、replacement、decommission 是不同 owner
operation。Pod inspection 使用 `wakeflow_pod_open
operation=inspect-materialization`，绝不重新创建或发现 worktree。Claude 只有在
精确 close 与 absence probe 都成功后才算 machine-verifiable 关闭。

**无人值守激活。** desired permission mode 记录在 strict config 中，但 apply
config 不等于 host activation。只有精确 `per-workspace` coverage 可无人值守推进；
unknown 或 host-wide coverage 保持 blocked，不新增机器级全局 workspace registry。

## Demand Pods（多需求并行）

主线是默认执行面。主线忙时普通需求和 Auto Claim 等待；必需主线身份缺失/不健康
会在 demand/TODO 写入前返回 `mainline-unavailable`，先恢复主线。Wakeflow 不会
因为第二个需求出现就自动创建 Pod。Pod 必须带用户明确授权的可审计锚点，Wakeflow
不设置数字总量或每仓上限。

- 一个 Pod 有独立的 `Controller__<pod>`、`Design__<pod>`、
  `Test__<pod>`，以及每个选中仓库一个产品会话，全部位于自己的 tmux 容器；
  需求内每仓仍一次只收一个组合包。
- core `wakeflow_pod_open operation=launch-preview/launch-apply` 冻结宿主中立的首次
  materialization operation。v3 Claude Pod adapter 只能执行 canonical pending/unbound
  operation：三个独立 control session，以及从精确仓库根以原生 `claude --worktree`
  创建的产品 session；不得嵌套 Claude `--tmux`，也不得默认 `--add-dir` 整个 workspace。
- `wakeflow_pod_record operation=record-materialization` 记录精确 launch correlation 与
  已观察宿主结果。Claude 同步返回最终 session id，没有 Codex `clientThreadId` pending
  状态，typed identity 中也不存在临时 request id。
- 只登记最终 Claude session id，再用 `wakeflow_pod_bind` 验真 pane cwd、Git
  common dir、base HEAD 与 `mainCheckout=false`。三个 control 绑定形成
  `control-ready`；Pod Design handoff 加全部产品绑定形成 `execution-ready`。
- Pod 唯一一代 Design 只在 `Controller__<pod>` 与 `Design__<pod>` 之间往返。
  先用 `wakeflow_pod_plan operation=design-request` 冻结总控请求，再用
  `wakeflow_pod_record operation=design-handoff` 记录精确
  `PodDesignHandoffEnvelope`；两步都不新建第二条全局 TODO。当前实现不持久化
  第二代 Pod Design，后续 supplement/redesign 必须作为能力 blocker 停止。
- Pod Test 派发前，先运行 `wakeflow_pod_plan operation=test-access-plan`，再用
  `wakeflow_pod_record operation=test-access-receipt` 记录独立 Test session 的精确探测结果。只有
  覆盖全部 active 产品绑定的 `validated` + `direct-multi-root` 才开放派发。若
  multi-root 不受支持则保持 blocked；没有主检出、产品窗口或未经验证的
  per-repository executor 回退实现。
- 重复 launch apply 只可实体化仍为 pending 且尚未绑定的 canonical operation；
  `operation=inspect-materialization` 只包含已绑定 operation，按记录的 actual cwd 验真或恢复精确 session，
  绝不创建缺失会话、再次传入 `--worktree` 或重绑。
- core `wakeflow_pod_plan operation=close-intent` 只生成 host-close intent。v3 adapter
  关闭精确 tmux/Claude session、执行有界 absence probe 并回报 worktree disposition；
  observation 与 receipt 分别通过
  `wakeflow_pod_record operation=close-observe/close-receipt` 记录。逻辑 binding close、
  session close 与 Claude/用户负责的物理 worktree 清理保持为不同事实。

## 跨宿主统一词汇

Wakeflow 在不同宿主版本之间保持同一套机器词汇。typed binding record、payload 字段和 CLI flag
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
  .wakeflow-local/           # ignored audit + shared/host runtime
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

1. Claude Code 构造按 `program`、`topology`、`storage`、`governance`、`hosts`
   分区的显式 selection，并用请求内 `selectionKey` 关联实体；typed ID 由 Wakeflow 分配。
2. Claude Code 调用 `wakeflow_maintain_workspace`，传入
   `action: "fresh-initialize"`、`mode: "preview"` 和闭合 selection；preview 严格只读。
3. Claude Code 审查 blockers、精确 `confirmedActionPlan`、返回的
   `confirmedActionPlanDigest` 与 `launchIntents`。legacy 或归属不明内容保持阻断。
4. 用户确认后，Claude Code 使用相同 root/action、`mode: "apply"`、精确确认计划和返回 digest 再次调用。
5. facade 的 `launch-window` owner 只可执行这些精确保留的 `launchIntents`，保持 raw
   session handle 私有，并用 `wakeflow_register_window operation=register` 注册最终
   handle、刷新脱敏 runtime projection。精确 effect 或 receipt 不可用时，activation
   保持 pending 并停止；不得写 retired public-v2 文件作为替代 runtime fact。unknown
   或 host-wide activation coverage 同样保持 manual host gate。

已初始化的 v3 工作区不能通过重跑 fresh setup 来刷新。完整 desired model 的有意变更用
`reconfigure`，按当前 v3 权威恢复受管 bytes/projections 用 `reconcile`；两者都必须
preview 后再 apply。过期宿主 binding 使用窗口替换。legacy migration 仅进入精确
artifact 未注册的 `bin/wakeflow-bootstrap`，不进入普通 MCP/CLI。

三个高层入口的职责要分清：

| 需求 | 命令 | 职责 |
| --- | --- | --- |
| 首次 setup | `wakeflow_maintain_workspace`，action `fresh-initialize` | preview 显式 selection，再原子应用精确确认的 owner plan。 |
| 有意修改模型 | `wakeflow_maintain_workspace`，action `reconfigure` | preview 完整 desired v3 model，只应用已审查差异。 |
| 按当前权威修复 | `wakeflow_maintain_workspace`，action `reconcile` | 不改变 desired model，只重建受管 bytes/projections。 |
| 替换单个上下文过重/过期窗口 | `wakeflow_replace_windows`（传 `window`） | 只返回一个 replacement launch entry 和 `wakeflow_register_window` 调用模板，不刷新 workspace docs。 |
| 替换多个上下文过重/过期窗口 | `wakeflow_replace_windows` | 只返回指定窗口的 replacement entries 和注册调用模板，不改无关窗口。 |

Design 和 Test 默认创建为新的支持 surface。`<Product>Design` 或 `<Product>Test`
这类相似目录只被当作目录事实，除非用户明确把它们映射成 Design/Test。

Wakeflow 支持本地化初始化。中文工作区传 `language: "zh"`，英文工作区传
`language: "en"`，没有明显偏好时传 `language: "auto"`。生成的 session 标题会把
窗口名放在最前面，方便在窄侧边栏里识别仓库。新建及重新生成的 demand-progress
投影也使用所选界面语言。

总控和子窗口可以使用 Claude Code subagent 加速有边界的代码搜索、日志分诊、
测试定位和输入汇总。Subagent 输出只是审查输入或建议；总控独立验证、投递、状态写入
和仓库边界仍归拥有该任务的 Wakeflow 窗口。

## Wakeflow 会创建什么

初始化只写入已确认边界所需的 surface：

| Surface | 用途 |
| --- | --- |
| `CLAUDE.md` | 父级总控 gate 和长期边界规则。 |
| 子窗口 `CLAUDE.md` access cards | 每个窗口的责任和读取路径。 |
| `wakeflow.config.json` | typed program identity，以及 topology、storage、governance、host policy。 |
| `.wakeflow-active/` | 当前 demand/business 权威、immutable artifacts/events、TODO 权威和进度投影。 |
| `.wakeflow-local/` | typed audit hold，加共享/宿主 runtime：binding、lease、transport、Pod evidence、keep-live、projection、mutation journal。 |
| `wakeflow-ledger/` | 持久 program index 与可移植完整需求 BusinessArchive。 |
| `Design/` | 未映射外部 Design 仓库时创建的内部需求设计工作区。 |
| `Test/` | 未映射外部 Test 仓库时创建的内部测试协作工作区。 |

Wakeflow 也会同步 `.gitignore`，只把 `.wakeflow-active/` 和 `.wakeflow-local/`
作为本地运行时目录忽略。它不会把产品仓库、Design/Test、ledger、`.DS_Store`
或其他本地杂项加入 `.gitignore`。

## 自动化语义

Wakeflow 自动化是直接 session 投递加显式结果返回。

核心规则：

- raw session id 只存在 `.wakeflow-local/runtime/hosts/claude-code/identity/window-bindings/` 的 typed record。
- `projections/window-runtime/` 是脱敏派生视图，不是 identity、handle 或 topology 权威。
- Delivery prompts 保持轻量、可读。
- target delivery 固定为
  `target-preview → target-apply → target-claim → fenced host effect →
  target-outcome`。apply 只写 immutable transport；claim 才在物理 effect 前取得共享的
  exact-window lease。v3 Claude transport owner 在重验、paste 与至多一次有界 readback 全程持有
  stable-window mutex；随后由 agent 用
  `wakeflow_record_delivery operation=target-outcome` 记录观察，recorder 本身不是 effect fence。
- controller return 使用 `controller-preview`、`controller-apply`、
  `controller-pre-send`、fenced host effect 与 `operation=controller-outcome`，不取得 target
  work lease，也不存在 polling 或同步 wait 兼容路由。
- `group-ready` 会等待预期 target results，再允许 controller return。
- `per-target` 可以每个 target 唤醒一次 controller，同时保留 group snapshot。
- adapter 只做一次有界 pane readback。只有 `confirmed` 才证明目标窗口已收到；
  `pending` / `unavailable` 记录为 `sent-unconfirmed`，本轮停止且不再次读取或自动重发。
- Keep-live 只是运行时辅助，不是任务逻辑、传输权威或验收证据。

自动化会在最终完成、硬 gate、用户停止、没有 eligible work、缺失审查输入、blocked state、
或任何需要总控/用户判断的条件下停止。

## MCP 能力面

Wakeflow 只把稳定的外层工作流合约暴露成 MCP tools，工具名与 Codex 版本完全一致。
运行时脚本仍然是内部实现和测试 surface；脚本存在不等于它就是公共工具。
目标窗口 closeout 与总控投递使用同一套投递模型：准备精确 envelope、执行 fenced v3
host effect、记录 delivery run。

主要工具组：

| 需求 | MCP tools |
| --- | --- |
| 工作区维护与窗口身份 | `wakeflow_maintain_workspace`, `wakeflow_replace_windows`, `wakeflow_register_window` |
| Demand 和任务状态 | `wakeflow_status`, `wakeflow_create_demand`, `wakeflow_claim_next`, `wakeflow_add_task`, `wakeflow_continue_demand`, `wakeflow_recover_state_transition`, `wakeflow_cancel_demand` |
| 候选扫描与显式 Pod 生命周期 | `wakeflow_next_work`, `wakeflow_pod_open`, `wakeflow_pod_bind`, `wakeflow_pod_plan`（design-request、test-access-plan/inspect、close-intent/inspect）、`wakeflow_pod_record`（record-materialization、design-handoff、test-access-observe/receipt、close-observe/receipt） |
| 投递和返回 | `wakeflow_prepare_delivery`, `wakeflow_record_delivery` |
| 结果和 review | `wakeflow_record_target_result`, `wakeflow_review_pack`, `wakeflow_reduce_results`, `wakeflow_decide_review`, `wakeflow_complete_demand` |
| Design 和 Test intake | `wakeflow_deliver`, `wakeflow_intake_test_card` |
| 证据、归档、视图、存储与验证 | `wakeflow_record_evidence`、`wakeflow_archive`、`wakeflow_view`、`wakeflow_storage_preserve`、`wakeflow_prune_runtime`、`wakeflow_verify` |
| 精确释放 target lease | `wakeflow_release_window_lock` |

公共 MCP tools 面向外层 agent 工作流。target closeout 被故意拆开：
记录 target result、审查 readiness、在策略允许时准备 controller-return envelope、
执行 fenced v3 host effect，再记录 delivery facts。总控 review 也保持拆分：
review pack、result reduction、显式决策；result reduction 只创建 review candidate，
不是验收。不要把这些步骤合并成一个 target-window MCP tool。内部 keep-live 与 backend
execution 留在 Wakeflow runtime owner 和 skills 内。`wakeflow_archive` 只接受
`preview/apply/inspect/recover`：在 lifecycle、Pod close、transport、privacy 门禁闭合后，
生成一份可移植的完整需求 `BusinessArchive`。旧 TODO/docs/sanitize 子路由不是 v3
兼容别名。`wakeflow_storage_preserve` 独立负责 typed 机器本地 audit hold，使用
inspect/preview/apply/recover；保留字节永不成为业务状态权威。这些工具都不做验收决策，
也不发送 host 消息。

所有 routed v3 tools 都使用同一闭合 envelope：`root`、可选 typed `demandId`、
精确 `operation` 和 operation-specific `request`。workspace/state/config/ledger path
由程序派生，调用方不能覆盖。host effect 归 closed v3 Claude facade 所路由的 typed
owner；retired public-v2 命令既不是 MCP alias，也不是 v3 effect seam。

Wakeflow 为每个公共工具声明 MCP tool annotations：read-only/open-world 提示与公共
边界一致，`destructiveHint` 按工具可能执行的最强 operation 声明（maintenance、
replacement、release、archive、preservation、Pod decommission 与 prune 都可能具有
破坏性）。annotations 只是客户端提示，不授予写权限。工具审批仍由用户的 Claude Code
权限设置控制；可信的本地安装可以在 `.claude/settings.json` 中为 `wakeflow`
MCP server 配置 allowlist。

## 运行时与账本边界

Wakeflow 把源码、active runtime 和长期记录分开：

| Path | 边界 |
| --- | --- |
| `skills/` | 随插件安装的可复用操作说明。 |
| `scripts/` | 插件打包的运行时实现和验证脚本。 |
| `templates/wakeflow-asset-bundle.json` | `core/template-sources/` 中 2 份 canonical 本地化 demand-progress asset 的生成运输物。 |
| `.wakeflow-active/` | 目标工作区中的当前 active work；被 Git 忽略。 |
| `.wakeflow-local/` | 机器本地 audit preservation，以及共享/宿主 runtime 权威与投影：binding、lease、transport、Pod evidence、keep-live state、maintenance journal；被 Git 忽略。 |
| `wakeflow-ledger/` | 项目特定的长期记录，不属于可复用 Wakeflow 源码。 |

Wakeflow 源仓库只跟踪可复用能力。产品代码、项目特定 active state、真实 session id
和派生本地运行时 artifacts 都不应进入 Wakeflow 源码。

## 双宿主工作区

同一个工作区可以同时运行 Codex 和 Claude Code 两个 Wakeflow 版本。共享业务状态位于
`.wakeflow-active/` 与 `wakeflow-ledger/`；共享 coordination/transport 位于
`.wakeflow-local/runtime/shared/{coordination,transport}/`。共享 typed lease 保证跨宿主
target effect 不重叠。

宿主独立的运行时按宿主分开：

- `.wakeflow-local/runtime/hosts/codex/{identity,projections,evidence,operations}/`
- `.wakeflow-local/runtime/hosts/claude-code/{identity,projections,evidence,operations}/`

`AGENTS.md`（Codex）与 `CLAUDE.md`（Claude Code）在工作区和子目录根共存。
每个物理操作使用精确 current binding 与严格 transport ancestry；共享 lease 阻止
跨宿主 target 重叠，不存在 demand-host adoption alias。

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
| `../../core/template-sources/` | 两项本地化 demand-progress 投影资产的 canonical authoring source。 |
| `templates/wakeflow-asset-bundle.json` | 确定性生成的安装运输物，不可手工编辑。 |
| `assets/` | Marketplace 和插件展示资源。 |

仓库根 README 解释共享架构；本 README 是 Claude Code 版本手册。

## 设计原则

1. **判断必须可见**：脚本输出、状态行、target backfill 是审查输入，不是验收。
2. **一个需求，一个 state root**：JSON state 和 Markdown progress surface 绑定到同一个 demand。
3. **Prompt 分层提示，任务包提供上下文，Skills 负责执行工艺**：prompt 携带有界
   优先信息、本轮目标和读取顺序；任务包保存完整任务上下文，需求锚点保留原始背景。
4. **仓库边界很重要**：每个窗口拥有自己的源码、测试、提交和审查输入。
5. **自动化移动工作，不转移权威**：投递只能证明 prompt 已发送，不能证明结果完成。
6. **本地运行时留在本地**：raw session id 只留在宿主本地 typed binding，active runtime state 不进入 tracked docs。
7. **默认创建新的支持窗口**：Design 和 Test 默认作为清晰的 Wakeflow support surfaces 创建，除非用户明确映射既有目录。

Wakeflow 的目标是让多窗口 agent 工作可以安全恢复、容易审查，并且难以跳过总控的独立验证。
