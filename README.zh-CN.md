<div align="center">

# Wakeflow

面向多窗口 agent 工作的严谨控制循环——每一步留痕、每个结果可审查。

[English](README.md) | [简体中文](README.zh-CN.md)

Wakeflow 把一个本地 Codex 或 Claude Code 工作区变成有纪律的控制系统：
每个 active demand 一条由总控负责的闭环、多个聚焦的仓库窗口、明确的 state root、轻量 direct-thread
或 direct-session 投递，以及由总控独立验证的验收。总控以闭环方式运行这套系统——规划、派发、收集审查输入、独立复验、决策、循环往复——并记录每一步，整个过程事后可审计。

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
**到底做了什么？目标窗口提交了什么支撑材料？总控实际复验了什么？还剩什么没做？** 没有控制层时，诚实的答案
只能是一堆零散 prompt、复制粘贴的状态表、不清晰的责任边界，和一句"看起来
完成了"——无法审计、无法续跑、无法信任。

Wakeflow 就是那个缺失的控制层——一个总控窗口驱动多个聚焦的仓库窗口，走一条
显式的、机器校验的闭环，每一步都在磁盘上留下可验证的工件：

- **总控优先判断**：父工作区负责目标、边界、投递决策、验收、TODO 路由和归档决策。
- **一个需求一个 state root**：任务包、目标结果、review candidate、决策和进度投影都绑定到同一个需求。
- **上下文完整任务包**：新任务包一次性记录目标、需求锚点、边界、完成条件、依赖和提交策略。
- **聚焦的子窗口**：每个仓库窗口只在配置好的责任边界内工作。
- **预览门控的分层提示词**：总控先检查仓库、任务摘要、Skills 和完整 prompt，
  只有匹配预览摘要的 apply 才能写入 direct-thread envelope。
- **验收锚点驱动实现**：每个新 implementation 包至少包含一个总控编写的
  claim/probe/expected 锚点；子窗口记录 RED→GREEN 映射，总控独立复验。
- **先有审查输入，再做验收**：target backfill、日志、路径和测试摘要都是输入，
  不是结论；Wakeflow 只检查结构和路径可定位性，总控仍要独立验证行为。
- **本地优先运行时**：raw thread/session handle 只存在 typed 宿主本地 window binding；
  脱敏 window-runtime 文件只是投影，active state 不进入源码。

你具体得到什么：

- **可审计** —— 每次派发、投递、结果、决策都是一个 JSON 工件，串在同一条
  trace 脊椎上；`wakeflow_view operation=result-trace` 可以回放谁在哪个状态版本上、
  提交了哪些审查输入、记录了什么决策。
- **可续跑** —— 需求从磁盘 state root 接着走。Codex thread 与 Claude Code
  conversation 通过宿主本地注册 id 重新绑定；机器重启后，需要先重新拉起 Claude
  的 tmux 窗口，再恢复原会话。对话记忆不是状态权威。
- **难以跳过审查** —— reducer 会对缺失的必需输入或不可定位的工件路径
  fail-closed，但不会认证内容真实性；"目标窗口说做完了"永远不算数，只有总控
  独立复验后才能验收。
- **并行但不静默分叉** —— 主线永远是默认执行面；只有用户明确授权才创建包含
  独立总控、Design、Test 和产品会话的 Pod。需求内部每仓仍严格一窗口一组合包。
- **构造上安全** —— typed identity、宿主 binding、lease、归档 privacy 全部
  fail-closed；raw session handle 永不离开宿主本地 binding owner。

Wakeflow 不是换了名字的命令启动器。它是一个可复用的工作流能力，用来让多窗口
agent 工作保持可读、有边界、可恢复。

## 架构

Wakeflow 由三层共同工作：你能看到的窗口舰队、推进工作的闭环，以及重启后仍能恢复的
磁盘布局。Codex 与 Claude Code 两个版本运行同一份宿主中立的 state、delivery
和 validation core；manifest、memory file、窗口生命周期与 transport 仍由各宿主实现
（Codex host thread tools 对比 fenced v3 Claude tmux adapter）。

### 第 1 层 - 窗口舰队（你看到的东西）

每个 Wakeflow 窗口都是绑定单一责任的 agent session。v3 Claude activation owner 把精确
launch intent 实体化为 tmux session，每个 demand Pod 使用独立容器；Codex 版本使用 host threads。

| 窗口 | 角色 | 默认推理强度（Claude Code） |
| --- | --- | --- |
| Controller | 拥有目标、投递、独立验证和验收 | `max` |
| Design | 澄清需求、重设非 bug 结果偏差方案、准备 handoff | `xhigh` |
| Repo windows | 只在一个仓库边界内实现 | `xhigh` |
| Test | 总控验收并完成自身验证后，只探索获批真实环境边界中的隐藏 bug | `xhigh` |

### 第 2 层 - 闭环（工作如何推进）

工作被组织成 demand：一个 demand = 一个目标 = 磁盘上的一个 state root。每个
demand 都经过同一个闭环：

```text
 1 intake     可选 Design delivery 追加一条精确 pending TODO 行
 2 publish    create-demand 发布 revision-1 root 和精确初始 authority；
              存在关联 TODO 时在同一事务中原子认领该行
 3 add task   任务包命名目标窗口和范围
 4 dispatch   preview -> digest 匹配 apply -> claim -> fenced host effect
 5 work       目标窗口在自己的仓库边界内执行
 6 result     一份 strict TargetResult 携带目标声明的审查材料引用落地 -> 解锁
 7 review     总控检查目标回传并独立验证，再 accept / rework / block
 8 complete   活跃必需任务 accepted、替代链有效且没有 blocker 后才完成
```

`wakeflow_claim_next operation=claim` 只是独立 TODO 行 CAS；它不会初始化 demand，
也不能安全地先于 root-first demand publication owner 执行。正常 v3 创建必须由
`wakeflow_create_demand` 在一个可恢复操作中同时发布 root 并认领精确关联行。

两条规则保证闭环可靠：**Prompt 分层提示、任务包提供完整上下文、Skills 定义工艺**
（有界 prompt 携带目标、最高优先完成/上下文/边界提示、读取顺序、身份和追踪信息；
任务包保存完整上下文，需求文档保存原始背景，Skills 保存执行流程），以及
**backfill 是输入，不是验收**（总控先检查目标窗口提交的原始材料，并独立复验相关
行为后再做决策；blocked decision 在新审查输入到达后始终可恢复）。

### 第 3 层 - 地面事实（磁盘上的内容）

```text
<workspace>/
  wakeflow.config.json          窗口、角色、每宿主配置              committed
  AGENTS.md / CLAUDE.md          每宿主总控 gate                    committed
  wakeflow-ledger/               长期设计、记录、归档               committed
  .wakeflow-active/current/<demandId>/                              local
    demand/state/events/task-packages/results/review/evidence  active authority
  .wakeflow-local/                                                local
    audit/preserved/<preservationId>/                         typed audit hold
    runtime/maintenance/transactions/                         mutation journal
    runtime/shared/coordination/window-leases/                跨宿主 lease
    runtime/shared/transport/demands/<demandId>/               group/packet/envelope/run
    runtime/hosts/<host>/identity/window-bindings/             私有 host handle
    runtime/hosts/<host>/projections/window-runtime/           脱敏投影
    runtime/hosts/<host>/{evidence,operations}/                Pod/keep-live 宿主事实
```

经验规则：**业务真相是宿主中立并共享的；传输句柄按宿主隔离，且永远不离开
`.wakeflow-local/`。**

### 谁决定什么（信任模型）

脚本和 MCP 工具创建、验证、记录机器数据；它们不会自行选择验收、扩大范围或决定产品行为，
只会持久化总控的显式决策。
目标窗口只执行被投递的任务包。总控是唯一验收权威，并且必须在 Test 开始前独立验证功能正确；
Test 不能自创目标、方法或完成标准，只探索获批环境边界。用户拥有产品决策。

### 双宿主共存

同一个工作区可以并行运行两个版本。demand/business 权威保持宿主中立；每次操作由
精确 current window binding 与 transport lineage 选择宿主，共享 typed window lease
跨宿主串行化 target delivery。不存在公共 demand-host 转移状态机。activation coverage
为 unknown 或 host-wide 时禁止无人值守激活，也不创建全局 workspace registry。

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

Claude Code 版本使用 tmux 常驻交互式 `claude` session；Wakeflow thread id 是精确
绑定的 Claude Code session id。主线仍是默认执行面。只有用户明确要求 Pod 时，core
才冻结宿主中立 materialization operation；v3 Claude Pod adapter 只能执行这些精确
operation，包括原生 `claude --worktree` 产品 session，并返回 typed observation/receipt。
当前 facade 或其精确 owner 不可用时保持 blocked，retired public-v2 命令不是替代路径。Pod Test 只有在全部已绑定
产品 worktree 的 direct-multi-root 访问通过验真后才可派发。
`wakeflow_pod_open operation=launch-preview/launch-apply` 保留首次创建的严格 base 门禁；
只读 `operation=inspect-materialization` 后续仅观察不可变 binding 与精确 session/cwd，
不重跑创建门禁。Wakeflow 不设置数字 Pod 上限。
完整指南见 [plugins/claude-code-wakeflow/README.zh-CN.md](plugins/claude-code-wakeflow/README.zh-CN.md)。

安装公开 Codex 插件 artifact：

```bash
npx codex-marketplace add GxFn/Wakeflow/plugins/codex-wakeflow --plugin
```

如果已经有匹配 tag，可以固定版本安装：

```bash
npx codex-marketplace add https://github.com/GxFn/Wakeflow/tree/v0.9.6/plugins/codex-wakeflow --plugin
```

如果 Codex 对话框把 source、ref 和 sparse path 分开填写，请使用仓库 URL、目标 ref，
并把 sparse path 填成 `plugins/codex-wakeflow`。

Codex 版本把普通工作留在初始化得到的主线舰队。对用户明确授权的 Pod，
`wakeflow_pod_open` 只输出宿主中立计划：Codex 新建三个独立的本地
Controller/Design/Test 线程，并从每个精确 saved repository project 新建一个
`environment.type=worktree` 产品线程。异步创建按 launch correlation 写入
Wakeflow journal；临时 `clientThreadId` 只用于搜索/恢复，绝不能进入最终 typed
binding。Wakeflow 验真 cwd/Git 回执，并要求 Pod Test 派发前已有通过验真的
direct-multi-root 回执。物理 worktree 生命周期归 Codex；归档 Codex thread 不是不可逆
撤销的机器证明，因此 Pod close 保持 `manual-host-gate`，不能生成机器验证 close receipt，
也不授权自动 Pod archive 或 transport prune。
主线不可用时返回 `mainline-unavailable` 并先恢复主线，不静默改走 Pod。
`wakeflow_pod_open operation=inspect-materialization` 只是已绑定 Pod 的只读身份与当前状态检查，绝不
创建或重绑 thread/worktree。

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

> `wakeflow.config.json` 是普通 public-v3 唯一配置权威。legacy 名称/schema 只由用户
> 明确调用的未注册 migration bootstrap 接受；普通 MCP/CLI 不做 fallback。

```text
MyWorkspace/
  AGENTS.md 或 CLAUDE.md
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

1. Codex 构造一份显式 selection，按 `program`、`topology`、`storage`、
   `governance`、`hosts` 分区。repository、support-surface、window 使用请求内
   `selectionKey` 关联，持久 typed ID 由 Wakeflow 分配。
2. Codex 调用 `wakeflow_maintain_workspace`，传入
   `action: "fresh-initialize"`、`mode: "preview"` 和这份闭合 selection；preview
   严格只读。
3. Codex 审查 blockers、精确 `confirmedActionPlan`、返回的
   `confirmedActionPlanDigest` 与 `launchIntents`。legacy 或归属不明内容保持阻断，
   不做宽泛目录导入。
4. 用户确认写入边界后，Codex 使用相同 root/action、`mode: "apply"`、精确确认计划
   与返回 digest 再次调用。
5. apply 成功后，Codex 只执行对应 preview 保留的 launch intents，把标题重设为
   `displayTitle`，并为每个真实 thread id 调用一次 `wakeflow_register_window`。
   raw host handle 保持私有；宿主本地 binding 是身份权威，window runtime 文件是投影。

已初始化的 v3 工作区不能通过重跑 fresh setup 来“刷新”。完整 desired model 的有意变更
使用 `action: "reconfigure"`；从当前 v3 权威恢复受管 bytes/projections 使用
`action: "reconcile"`；两者都必须 preview 后再 apply。过期宿主 binding 使用
`wakeflow_replace_windows`。legacy migration 不进入普通 MCP/CLI，只有用户明确请求时，
才使用精确 artifact 中未注册的 `bin/wakeflow-bootstrap` preview/apply/recover 协议。

三个高层入口的职责要分清：

| 需求 | 命令 | 职责 |
| --- | --- | --- |
| 首次 setup | `wakeflow_maintain_workspace`，action `fresh-initialize` | preview 一份显式 selection，再原子应用精确确认的 owner plan。 |
| 有意修改模型 | `wakeflow_maintain_workspace`，action `reconfigure` | preview 完整 desired v3 model，只应用已审查差异。 |
| 按当前权威修复 | `wakeflow_maintain_workspace`，action `reconcile` | 不改变 desired model，只重建受管 bytes/projections。 |
| 替换单个上下文过重/过期窗口 | `wakeflow_replace_windows`（传 `window`） | 只返回一个 replacement launch entry 和本地注册命令，不刷新 workspace docs。 |
| 替换多个上下文过重/过期窗口 | `wakeflow_replace_windows` | 只返回指定窗口的 replacement entries 和本地注册命令，不改无关窗口。 |

Claude Code 版本使用同样的 preview/apply 合约。返回的 `launchIntents` 保持宿主中立，
直到 v3 Claude activation owner 实体化并注册每个最终 session id。owner 不可用时停止
activation；legacy helper 不能创建替代 binding 或 transport fact。

Design 和 Test 默认创建为新的支持 surface。`<Product>Design` 或 `<Product>Test`
这类相似目录只被当作目录事实，除非用户明确把它们映射成 Design/Test。

Wakeflow 支持本地化初始化。中文工作区传 `language: "zh"`，英文工作区传
`language: "en"`，没有明显偏好时传 `language: "auto"`。生成的线程标题会把窗口名放在最前面，
方便在窄侧边栏里识别仓库。新建和重建的 demand-progress 投影也使用所选界面语言。

总控和子窗口可以使用 Codex 或 Claude Code subagent 加速有边界的代码搜索、日志分诊、
测试定位和输入汇总。Subagent 输出只是审查输入或建议；总控独立验证、投递、状态写入
和仓库边界仍归拥有该任务的 Wakeflow 窗口。

## 跑通第一个需求

两个宿主跑的是同一条闭环，差别只在驱动方式。

**Claude Code（slash 命令）：**

1. `/wakeflow:init` —— 构造显式 selection，预览精确 fresh-initialize plan，等待确认后
   apply。宿主中立 launch intent 只通过 v3 Claude seam 激活；seam 不可用或 activation
   coverage 为 unknown/host-wide 时报告 blocker，不写 legacy runtime fact。
2. 把目标交给 Design 窗口（或自己写需求）。Design 澄清后调用
   `wakeflow_deliver` —— 需求以 `pending-claim` 行落到全局 TODO 板。append 只校验
   精确行与 board CAS，不解析 `Documents`，也不创建 demand authority。
3. 在总控里：`/wakeflow:status` 检查看板，解析提交的引用，然后调用
   `wakeflow_create_demand` preview/apply。只要后续需要任何 TaskPackage，完整 authority
   就必须随这次首次发布写入，因为 public v3 无法事后补充。TODO-backed publication
   会在同一可恢复的 root-first 操作内认领精确行；`Auto Claim` 只控制无人值守选择时机，
   独立的 `wakeflow_claim_next` 行变换不是 demand initializer。
4. `/wakeflow:dispatch` —— preview/apply immutable transport，通过 `target-claim` 取得
   exact lease，执行 fenced host effect，记录 transport 与独立 readback 后结束本轮。
   目标窗口在自己的仓库边界内干活，controller-return 带着结果材料唤醒总控。
   如果 send 已被接受但 readback 为 pending/unavailable，则记录为
   `sent-unconfirmed` 并立即停止；它不是 send 失败，更不授权重复读取或发送。
5. `/wakeflow:review` —— 检查目标窗口回传的材料，独立验证相关行为，再记录决策：
   accept / rework / blocked / redesign。
   普通 rework 使用同一任务和新的 dispatch group。主线 redesign 在 Design 返回后
   创建带 `replacesTargetTaskId` 的完整 replacement 包；接受 replacement 后旧任务
   明确变为 `superseded`。当前 Pod 只冻结一代 Design request/handoff；
   这一代的 `requestType` 可以是 `initial-design`、`supplement` 或 `redesign`。
   不同的第二代请求保持 blocked，不覆盖既有 handoff，也不回退主线 Design。
6. 重复 dispatch → review，直到所有活跃必需非 Test 任务 accepted（或具有有效
   superseded lineage），且总控完成自己的功能验证。
   之后总控才可添加/派发已确认的 Test card；Test 必须遵守冻结目标、获批测试方案、
   `controllerSelfChecks`、allowed skills、setup policy 与 attempt bound。
   progressive-chain-validation 等 Test skill 只有被 card 显式列出时才能使用。
   如果 Test 在所属产品 lineage 已 accepted 后证明真实产品缺陷，应保存复现与可审查
   材料并停止为 remediation capability blocker：当前 public v3 无法在 completion 前重开
   该 accepted lineage，也无法创建同 demand 产品修复。
7. 所有必需任务 accepted 后，依次使用
   `wakeflow_complete_demand operation=preview/apply` 与
   `wakeflow_archive operation=preview/apply`；只有 lifecycle、Pod close、transport、
   privacy 门禁闭合后才生成一份 portable whole-demand `BusinessArchive`。机器本地
   preserved bytes 是独立 audit hold，永不成为 archive authority。
   若完成后、归档前发现仍属于原完成定义的已验证缺陷或已确认补充，
   `wakeflow_continue_demand` 会保留原完成记录，并在一次受控操作中追加首个 bug／补充／
   明确授权优化任务包。已归档历史不可恢复；独立后续工作新建 demand。

**Codex（自然语言）：** 同一条闭环、同一套 MCP 工具 ——
"用 Wakeflow 初始化这个工作区"、"认领下一个需求"、"派发下一个任务包"、
"评审返回的结果"、"完成并归档这个需求"。

**日常驾驶（Claude Code）：**

| 你想 | 做 |
| --- | --- |
| 检查 Claude 窗口 | `/wakeflow:windows`；terminal/tmux 视图只是操作者观察，不是 identity authority |
| 看全局在哪 | `/wakeflow:status` |
| 推进工作 | `/wakeflow:dispatch` |
| 评判返回的工作 | `/wakeflow:review` |
| 健康检查 / 换掉臃肿窗口 | `/wakeflow:check` · `/wakeflow:windows <名字> --replace` |
| 无人值守（留痕同意） | `/wakeflow:unattended on` |
| 明确要求某需求并行 | 让总控开一个 Pod——独立总控、Design、Test，以及宿主创建的产品 worktree |

## Wakeflow 会创建什么

初始化只写入已确认边界所需的 surface：

| Surface | 用途 |
| --- | --- |
| `AGENTS.md` | 父级总控 gate 和长期边界规则。 |
| 子窗口 `AGENTS.md` access cards | 每个窗口的责任和读取路径。 |
| `wakeflow.config.json` | typed program identity，以及 topology、storage、governance、host policy。 |
| `.wakeflow-active/` | 当前 demand/business 权威、immutable artifacts/events、TODO 权威与进度投影。 |
| `.wakeflow-local/` | typed audit hold，加共享/宿主 runtime：binding、lease、transport、Pod evidence、keep-live、projection、mutation journal。 |
| `wakeflow-ledger/` | 持久 program index 与可移植完整需求 BusinessArchive。 |
| `Design/` | 未映射外部 Design 仓库时创建的内部需求设计工作区。 |
| `Test/` | 未映射外部 Test 仓库时创建的内部测试协作工作区。 |

Wakeflow 也会同步 `.gitignore`，只把 `.wakeflow-active/` 和 `.wakeflow-local/`
作为本地运行时目录忽略。它不会把产品仓库、Design/Test、ledger、`.DS_Store`
或其他本地杂项加入 `.gitignore`。

## 自动化语义

Wakeflow 自动化是 direct-thread 投递加显式结果返回。

核心规则：

- raw thread/session handle 只存在
  `.wakeflow-local/runtime/hosts/<host>/identity/window-bindings/` 的 typed record。
- 同一 host 下 `projections/window-runtime/` 是脱敏派生视图，不是 identity、handle 或 topology 权威。
- Delivery prompts 保持轻量、可读。
- Host 通过 fenced transport boundary 发送 prompt：Codex 使用 thread tools，Claude
  Code 使用 v3 stable-window tmux adapter。Wakeflow 记录发送与 readback 证据；legacy
  helper 不能生成 v3 transport authority。
- transport 已接受才是发送完成事实。readback 是独立的 `confirmed` / `pending` /
  `unavailable` 观察，不授权重发；匹配的 target result 会正常释放目标工作租约。
  发送失败恢复中，只有证明“发送前拒绝”才可释放精确匹配的 delivery lease，结果
  不明确时保留 lease 交给 Agent 判断。
- `group-ready` 会等待预期 target results，再允许 controller return。
- `per-target` 可以每个 target 唤醒一次 controller，同时保留 group snapshot。
- 只有 confirmed readback 证明目标可达；accepted transport 加 pending/unavailable readback
  记录为 `sent-unconfirmed`，本轮停止且不 poll 或自动重发。
- Keep-live 只是运行时辅助，不是任务逻辑、传输权威或验收证据。
- Demand/business 权威保持宿主中立。宿主选择来自精确 current binding 和严格
  group/packet/envelope chain；调用方不能 adopt demand 或覆盖内部路径。
- 共享 typed window lease 跨宿主串行化 target effect；历史 envelope/result 不能释放 successor lease。
- active demand 数量只用于观测，不设置数字 admission，也不会自动选择 Pod。普通需求
  和 Auto Claim 在主线忙时等待；只有用户明确授权才创建 Pod。
- 无人值守宿主激活只允许 known workspace-only coverage；unknown 或 host-wide coverage
  保持 manual host gate，Wakeflow 不创建全局 workspace registry。

自动化会在最终完成、硬 gate、用户停止、没有 eligible work、缺失审查输入、blocked state、
或任何需要总控/用户判断的条件下停止。

## MCP 能力面

Wakeflow 只把稳定的外层工作流合约暴露成 MCP tools。运行时脚本仍然是内部实现和测试 surface；
脚本存在不等于它就是公共工具。目标窗口 closeout 与总控投递使用同一套 direct-thread 模型：
准备 envelope、用 host thread tool 发送 prompt、记录 delivery run。

主要工具组：

| 需求 | MCP tools |
| --- | --- |
| 工作区维护与窗口身份 | `wakeflow_maintain_workspace`, `wakeflow_replace_windows`, `wakeflow_register_window` |
| Demand 和任务状态 | `wakeflow_status`, `wakeflow_create_demand`, 独立 TODO CAS `wakeflow_claim_next`, `wakeflow_add_task`, `wakeflow_continue_demand`, `wakeflow_recover_state_transition`, `wakeflow_cancel_demand` |
| 候选扫描与显式 Pod 生命周期 | `wakeflow_next_work`, `wakeflow_pod_open`, `wakeflow_pod_bind`, `wakeflow_pod_plan`（design-request/test-access/close）、`wakeflow_pod_record`（materialization/design-handoff/test-access/close-receipt） |
| 投递和返回 | `wakeflow_prepare_delivery`, `wakeflow_record_delivery` |
| 结果和 review | `wakeflow_record_target_result`, `wakeflow_review_pack`, `wakeflow_reduce_results`, `wakeflow_decide_review`, `wakeflow_complete_demand` |
| Design 和 Test intake | `wakeflow_deliver`, `wakeflow_intake_test_card` |
| 证据、归档、视图、存储与验证 | `wakeflow_record_evidence`、`wakeflow_archive`、`wakeflow_view`、`wakeflow_storage_preserve`、`wakeflow_prune_runtime`、`wakeflow_verify` |
| 精确释放 target lease | `wakeflow_release_window_lock` |

公共 MCP tools 面向外层 agent 工作流。target closeout 被故意拆开：
记录 target result、审查 readiness、在策略允许时准备 controller-return envelope、
通过当前归属宿主的 transport 发送，再记录 delivery facts。不要把这些步骤合并成一个 target-window MCP tool。
总控 review 也保持拆分：review pack、result reduction 和显式 decision 分别处理；
result reduction 只创建 review candidate，不是验收。内部 keep-live 与 backend
execution 留在 Wakeflow runtime owner 和 skills 内。`wakeflow_archive` 只接受
`preview/apply/inspect/recover`：在 lifecycle、Pod close、transport、privacy 门禁闭合后，
生成一份可移植的完整需求 `BusinessArchive`。旧 TODO/docs/sanitize 子路由不是 v3
兼容别名。`wakeflow_storage_preserve` 独立负责 typed 机器本地 audit hold，使用
inspect/preview/apply/recover；保留字节永不成为业务状态权威。这些工具都不做验收决策，
也不发送 host messages。

Wakeflow 为每个公共 tool 声明 MCP annotations：只读工具标记为 read-only；全部工具
都是 closed-world 且声明幂等。`destructiveHint` 按工具可执行的最强 operation 声明，
因此 workspace maintenance、window replacement、精确 lease release、本地 preservation、
archive、Pod binding 与 runtime prune 都正确标为 destructive-capable。annotation 只是客户端
提示，不授予写权限。Codex approval policy 仍由用户自己的 Codex 配置控制。
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
| `templates/wakeflow-asset-bundle.json` | `core/template-sources/` 中两项本地化 demand-progress 投影资产的生成运输物。 |
| `.wakeflow-active/` | 目标工作区中的当前 active work；被 Git 忽略。 |
| `.wakeflow-local/` | 机器本地 audit preservation，以及共享/宿主 runtime 权威与投影：binding、lease、transport、Pod evidence、keep-live state、maintenance journal；被 Git 忽略。 |
| `wakeflow-ledger/` | 项目特定的长期记录，不属于可复用 Wakeflow 源码。 |

Wakeflow 源仓库只跟踪可复用能力。产品代码、项目特定 active state、真实 thread id
和派生本地运行时 artifacts 都不应进入 Wakeflow 源码。

## 双宿主工作区

同一个工作区可以同时运行 Codex 和 Claude Code 两个 Wakeflow 版本。共享业务状态
在 `.wakeflow-active/` 与 `wakeflow-ledger/` 中保持宿主中立；共享 runtime coordination
与 transport 位于 `.wakeflow-local/runtime/shared/{coordination,transport}/`。

宿主独立的运行时按宿主分开：

- `.wakeflow-local/runtime/hosts/codex/{identity,projections,evidence,operations}/`
- `.wakeflow-local/runtime/hosts/claude-code/{identity,projections,evidence,operations}/`

`AGENTS.md`（Codex）与 `CLAUDE.md`（Claude Code）可以在工作区根目录和子目录根
共存。每个物理操作使用精确 current host binding 与严格 transport ancestry；共享 lease
阻止跨宿主 target 重叠，不存在 demand-host adoption alias。

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

当前 Pod 行为与验收权威见
[docs/wakeflow-host-managed-complete-pod-requirement-design-2026-07-31.md](docs/wakeflow-host-managed-complete-pod-requirement-design-2026-07-31.md)；
非 Pod 硬化演进记录见
[docs/wakeflow-hardening-design-compliance-2026-07-30.md](docs/wakeflow-hardening-design-compliance-2026-07-30.md)。
双版本架构流和 deep-dive 是保留的 v0.7.x 历史快照，不代表当前命令、工具数量、
提示词结构或 Pod 归属。

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
| `core/template-sources/` | 两项本地化 demand-progress 投影资产的 canonical authoring source。 |
| `plugins/codex-wakeflow/templates/wakeflow-asset-bundle.json` | 确定性生成的安装运输物，不可手工编辑。 |
| `plugins/codex-wakeflow/assets/` | Marketplace 和插件展示资源。 |
| `test/` | 开发期回归测试，不进入 marketplace 扫描面。 |
| `docs/` | 开发期规划和架构文档，不进入插件 artifact。 |

后端/源码维护命令说明在 [scripts/README.md](plugins/codex-wakeflow/scripts/README.md)。
已安装总控使用 MCP tools 与 skills，不把原始脚本当作操作入口。

## 设计原则

1. **判断必须可见**：脚本输出、状态行、target backfill 是审查输入，不是验收。
2. **一个需求，一个 state root**：JSON state 和 Markdown progress surface 绑定到同一个 demand。
3. **Prompt 分层提示、任务包提供上下文、Skills 执行**：prompt 只带有界优先信息、
   当前目标和读取顺序；完整任务上下文属于 task package，原始背景属于需求锚点。
4. **仓库边界很重要**：每个窗口拥有自己的源码、测试、提交和审查输入。
5. **自动化移动工作，不转移权威**：direct-thread delivery 只能证明 prompt 已发送，不能证明结果完成。
6. **本地运行时留在本地**：raw thread id 只留在宿主本地 typed binding，active runtime state 不进入 tracked docs。
7. **默认创建新的支持窗口**：Design 和 Test 默认作为清晰的 Wakeflow support surfaces 创建，除非用户明确映射既有目录。

Wakeflow 的目标是让多窗口 agent 工作可以安全恢复、容易审查，并且难以跳过总控的独立验证。
