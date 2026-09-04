# 能力组 4：Demand 生命周期

> 状态：`confirmed`，Q1 到 Q6 于 2026-09-04 先行确认按建议裁决，记录见文末"确认记录"；4.4 隔离执行位置由 [ADR-0010](../../decisions/0010-worktree-isolated-execution-and-converged-flow.md)（已接受，pod 模型）取代
> 建立日期：2026-09-03
> 旧实现基线：`core/`、`plugins/*` 于 `c0098e2`
> 上位文档：[docs/plan/typescript-reimplementation-plan.md §8.1 P0](../../plan/typescript-reimplementation-plan.md)、[ADR-0005](../../decisions/0005-demand-event-stream-read-path.md)、[ADR-0006](../../decisions/0006-legacy-capability-retention.md)
> 说明：TS 已把 Demand 重切为唯一的事件溯源聚合，旧的 state 文件、JSONL 审计、状态锁与 `recover_state_transition` 都不再存在。卡片记录旧场景与不变量，问题只针对仍未裁决的产品语义。任务包、投递、结果、评审、证据、归档在后续组讨论，本组只到状态机的交接点。

## 4.1 Demand 状态根与身份

**场景**：一个 Demand 就是一个目标，对应磁盘上一个状态根。身份在创建时冻结，之后任何人不能改；所有执行产物都挂在这个根下。

**旧实现**：

- 根 `.wakeflow-active/current/<demandId>/`，目录 0700 文件 0600，全部 ignored；核心文件 `demand.json`（身份，永不改写）、`demand-authority.json`（一次冻结）、`wakeflow-state.json`（CAS 替换）、`controller-events.jsonl`（整文件原子替换实现的追加）、`index.md` 与 `developer-progress.md`（投影）；子目录 `task-packages/`、`target-results/`、`review-candidates/`、`test-cards/`、`evidence/`、`transactions/`，isolated 另加 `pod/`。`wakeflow-layout-descriptor.mjs:702-799`、`wakeflow-demand-layout.mjs:7-30`。
- 锁与 sidecar 放在根**旁边**而不是根内，让归档可以整体移动根、让锁令牌不进审计树：`<demandId>.create-lock`、`<demandId>.state-lock`、`<demandId>.create-intent.json`、`.wakeflow-create-stage-<demandId>/`、归档意图与 stage。`wakeflow-state-lock.mjs:54`。
- `demand.json` 封闭字段：`programId`、`demandId`、`createdAt`、`title`、`goal`、`completionDefinition`、`demandType`、`source`（TODO 谱系或 ledger 来源）、`executionPlacement`。没有 state、没有 podId、没有 selection。`wakeflow-demand-core-records.mjs:679-711`。
- `demand-authority.json`：`demandRef`、`demandDigest`、`entryMode`、`authorityRefs[]`、`testDecision`；只能冻结一次，且没有公共入口能在创建后冻结。`:752-813`、`wakeflow-demand-state-service.mjs:1871`。
- 归档过的 demandId 永远不能再发布。`wakeflow-demand-publication-service.mjs:1776-1789`。

**不变量**：demandId 是根目录名；`demand.json` 由 revision 1 事件绑定；`state.demandDigest`、`demandAuthorityDigest`、`lastEvent.eventDigest` 组成摘要链；每个核心 JSON 逐字节等于规范 JSON 加换行。

**现 TS 状态**：Demand 根含 `identity.json`、`authority.json`、`event-sourcing/{commits, snapshots, append-candidates}`；身份与权威为不可变 JSON，状态由事件重放得到；`entryMode` 已删除；隔离位置由 Confirmation 引用授权，按 ADR-0010 改为 Demand 身份记 `podId`。

**实现判断**：根旁 sidecar 的做法保留，锁与事务 stage 不进根；旧 `core/schemas/wakeflow-state-machine/` 里带 `allowedActions`、`stages`、`demandKey` 的幽灵 schema 不移植；`executionPlacement.selection` 是文档错误，只保留 `{mode, authorizationRef}`。

## 4.2 状态机与审计

**场景**：Controller 是唯一能推进 Demand 状态的人；每一步都有追加审计，崩溃后能向前恢复；任何人读到半写状态都会失败而不是读到错数据。

**旧实现**：

- 10 个状态：`intake、planned、dispatched、waiting-results、review-ready、needs-rework、blocked、cancelled、completed、archived`。每个状态的唯一产生者：intake 只在 revision 1；planned 由任务包创建或评审 accept；dispatched 由投递准备；waiting-results 由投递结果；review-ready 由评审候选；needs-rework 由评审 rework 或 redesign；blocked 只由评审 blocked；completed 与 cancelled 只由生命周期事件；archived 只由归档事务。`wakeflow-demand-core-records.mjs:59-70`。
- 终态集合不一致：事件 codec 用 `{completed, cancelled}`，三个服务用 `{archived, cancelled, completed}`，导致 archived 靠另一条守卫拦住。`:232`、`wakeflow-demand-lifecycle-orchestration.mjs:50`。
- 五个互斥的提交缝：通用、投递、评审、生命周期、Pod，外加工件与证据；通用缝遇到像别人命令的事件即失败。一个事件最多带一种转换负载。`wakeflow-demand-state-service.mjs:215-270`、`:1542-1770`。
- CAS：`expectedPrevious {revision, stateDigest}` 加整个 previousState 规范 JSON 相等；事件 JSONL 每条 revision 恰好加一，`from` 等于前一条 `to`，尾事件与状态快照逐字段一致。`wakeflow-demand-core-records.mjs:2541-2548`、`:3010-3098`。
- `blocked` 只有 cancel 一条出路：进入 blocked 时评审被清成 idle，而 decide_review 又要求有 pending 候选。`wakeflow-result-review-orchestration.mjs:1546-1556`。
- `recover_state_transition` 通用操作只能接受空请求；带 `expectedArtifactKind` 必失败。`wakeflow-demand-state-service.mjs:2018-2023`。

**现 TS 状态**：状态由 15 种事件重放，Controller Route 投影 22 种责任前沿；`lifecycle.demand-cancelled` 与 `demand-completed` 事件存在，cancel 无调用方；`recover_state_transition` 与通用状态锁已按 ADR-0006 放弃，每个工具自带 recover。

**实现判断**：终态集合统一为 `{completed, cancelled, archived}`；只有 Controller 提交事件的规则通过事件 owner 字段保持；旧的 10 个粗粒度状态不再作为存储字段，只作为从聚合派生的人读投影。

**待确认**：

- Q1 `blocked` 是否需要 cancel 之外的出路：允许 Controller 用新的评审决定解除 blocked 回到 needs-rework 或 planned？建议允许。
- Q2 旧的 10 个粗粒度状态名是否保留为人读投影的词汇？建议保留词汇，但只由聚合派生，不存储。

## 4.3 创建、继续、取消、完成

**场景**：Controller 从 TODO 创建 Demand；执行结束后完成；中途放弃则取消；已完成的 Demand 可以在同一目标上继续一个后续任务包。

**旧实现**：

- create：请求 `{demand, authority | null, initialTransition, language, expectedTodoRow}`；apply 顺序为 sidecar 意图、stage 整树、rename 进位、提交 TODO 认领、删 sidecar、删根内 journal；根先于 TODO 认领是硬不变量，反向即 `publication-order` 错误；结果状态 `published | recovered | already-published | no-pending-transaction`。`wakeflow-demand-publication-service.mjs:1717-1812`。
- continue：与 `add_task` 同一个处理器；靠"状态是 completed 当且仅当任务包带 continuation"这个双条件区分，continuation 种类 `optimization | requirement-supplement | verified-bug`，必须绑定一个已 accepted 且已 closed 的前序任务包，同仓库同工作类型同窗口；状态从 completed 回到 planned，completed 事件保留在历史。权威不变。`wakeflow-demand-artifact-service.mjs:611-643`、`:832-905`。
- cancel：任何非终态可取消；结果与证据逐字节保留；未终结的目标任务变 cancelled，活动任务包与测试卡变 closed；评审清成 idle；释放该 Demand 的全部协调租约；**不触碰 TODO 行**。`wakeflow-demand-lifecycle-orchestration.mjs:440-453`、`:787-811`。
- complete：评审 idle、零租约、每个目标任务 accepted 或 superseded 且 accepted 的选中一个 current 非 blocked 结果、任务包与测试卡全部 closed 或 superseded；只有 research 允许零目标完成；完成事件 `changedArtifacts: []`；不做 TODO 归档、不写工件、不关 Pod、不做业务归档。`:390-437`。
- 生命周期失败闭合：同一锁下判定"什么都没写"或"事件已提交则向前完成租约释放"，否则 recovery-required；首次 apply 重建整份计划比对，漂移即 stale-plan。`:816-893`。

**现 TS 状态**：`create_demand` 从 `{todoId, demand}` 创建，权威从 intake 单源收敛；`complete_demand` 公开；cancel 路径完整但不可达；continue 不存在；research 完成与实现重设计有 blocker。

**实现判断**：create 的"根先于认领"顺序与四种结果状态保留；cancel 与 continue 在 L1 补公共入口；stale-plan 检测保留。

**待确认**：

- Q3 `plan_target_task` 与 continue 是否成为真正不同的操作：continue 必须带 continuation 谱系且只在 completed 上可用，`plan_target_task` 在 completed 上拒绝？同时保留"supplement 类型的新 Demand"作为另一条路。建议如此。
- Q4 cancel 时关联的 TODO 行如何处置：改为 `withdrawn`（终态，需要时重新 intake），还是退回 `pending-claim` 可再认领？建议 `withdrawn` 并记录原因。

## 4.4 隔离执行位置

**场景**：一个 Demand 需要在不影响主检出的情况下执行，或需要独立的一组窗口。旧体系叫 Pod，TSD-15 已裁定简化为"由 Confirmation 授权的隔离执行位置"。

**旧实现**：

- `executionPlacement: {mode: isolated, authorizationRef}`，授权角色只能是 `goal-stage-decision` 或 `user-confirmation`；状态里可带 `pod` 对象，其 `placementAuthorizationDigest` 必须等于授权引用摘要。`wakeflow-demand-core-records.mjs:651-676`、`:4177-4190`。
- 物理含义：控制角色各自独立宿主会话；每个产品仓库一个 git worktree，创建回执记录 `gitTopLevel === actualCwd` 且 `mainCheckout === false`；Wakeflow 用 git 命令核实 worktree；关闭时只观察 worktree 处置，从不删除。`wakeflow-pod-records.mjs:337-364`、`:432-461`、`:762-834`。
- Pod 状态机 11 个阶段，窗口状态 4 种，四个工具 17 个操作；Pod 事件从不改变 Demand 业务状态；Pod 证据根在 `.wakeflow-local/runtime/hosts/<host>/evidence/pods/<podId>`。`:257-269`、`:1861-1972`。
- 宿主效果：创建会话、`claude --worktree`、关闭会话、删除 worktree、探测 pane 的 cwd 与 git 事实，核心只做计划与记录。

**现 TS 状态**：Demand identity 有 `executionPlacement.mode: isolated` 与授权引用；没有 Pod 状态、工具或证据根；isolated 的测试规划有 blocker。

**实现判断**：由 ADR-0010 取代。pod 是唯一的执行环境抽象，main 是 `primary` 的 pod；Demand 身份记 `podId`，`executionPlacement` 与隔离授权引用删除；一个 pod 同一时刻只推进一个 Demand；worktree 归 pod 的产品窗口，由宿主原生能力创建，Wakeflow 只签发意图并准入 git 事实回执；不重建 11 阶段 Pod 状态机；pod 记录在配置的 `pods[]`，证据放在 Demand 根下而不是宿主目录。

**待确认**：

- Q5 隔离位置的物理模型确认为"每个产品仓库一个 git worktree，加同一 tmux 容器内一组独立会话"，不是独立克隆也不是独立工作区根？建议确认。

## 4.5 Demand 投影

**场景**：人读的 `index.md` 与 `developer-progress.md` 反映当前状态与产物，随每次变更刷新，任何人不得手改。

**旧实现**：

- `index.md`：标题、投影标记、来源行、核心记录链接、当前工件（只列 active 任务包、current 结果、active 测试卡、pending 评审候选、全部证据）、能力根、恢复说明。`wakeflow-demand-document-builder.mjs:524-561`。
- `developer-progress.md`：由资产模板 `progress.demand.{en, zh-CN}` 渲染，渲染**全部事件历史**，不渲染任务与结果进度；语言 zh 用 zh-CN 模板。`:594-630`。
- 刷新触发集合 17 个工具操作，在 owner 成功后运行，失败只降级为回执；`interfaceLanguage: auto` 时除 create 外无法解析语言，投影延迟。`wakeflow-public-v3-runtime.mjs:205-223`、`:762-770`。
- 活动投影 `workspace-current-status.md` 每 Demand 列状态、修订、权威是否冻结、位置、分配；计算了六个进度计数但不渲染。`wakeflow-active-projector.mjs:786-806`、`:1077-1107`。

**现 TS 状态**：未见 Demand 级 Markdown 投影实现，待 L1 核对。

**实现判断**：投影按 derived-projection 角色确定性重写；语言只来自 `presentation.language`，不再有 auto 分支；模板从制品 bundle 移入 skills 或代码内常量。

**待确认**：

- Q6 `developer-progress.md` 渲染什么：保持全部事件历史，还是改为当前状态加任务与结果进度加最近事件？建议后者，并把六个进度计数渲染出来。

## 旧行为疑点

1. `core/schemas/wakeflow-state-machine/` 的 schema 描述的是另一套记录，运行时不接受。
2. 文档要求 `executionPlacement.selection = explicit-user-pod`，codec 只接受 `{mode, authorizationRef}`。
3. `add_task` 与 `continue_demand` 是同一处理器，工具身份是装饰。
4. `freezeDemandAuthority` 没有公共调用方。
5. 终态集合两处不一致。
6. `intake` 在 revision 1 之后不可达；只有零工件的 research 能从 intake 直接完成。
7. `blocked` 只有 cancel 一条出路。
8. 通用 recover 接受一个永远无法满足的 `expectedArtifactKind`。
9. cancel 不触碰 TODO 行。
10. 六个进度计数算了不渲染。
11. 投递阶段机集中在 demand-core codec 而不是投递模块。

## 确认记录（2026-09-04，先行确认）

| 问题 | 裁决 | 落点 |
| --- | --- | --- |
| Q1 blocked 出路 | 允许 Controller 用新的评审决定解除 blocked，回到 needs-rework 或 planned | 评审决定事件 |
| Q2 粗粒度状态名 | 保留词汇作为人读投影，只由聚合派生，不存储 | 投影 |
| Q3 continue 与 plan_target_task | 分开：continue 必须带 continuation 谱系且只在 completed 上可用；plan_target_task 在 completed 上拒绝；supplement 类型的新 Demand 保留 | 任务规划事件 |
| Q4 cancel 时 TODO 行 | 改为 `withdrawn` 并记录原因 | 取消事件与 TODO state |
| Q5 隔离位置物理模型 | 确认为每个产品仓库一个 git worktree 加一组独立会话；用户进一步给出 pod 模型并于 09-04 确认五项，见 ADR-0010 | ADR-0010 |
| Q6 developer-progress.md | 改为当前状态加任务与结果进度加最近事件，渲染六个进度计数 | 投影 |

补充（2026-09-04，ADR-0011）：创建输入改为 `{requirementId, demand}`，权威从需求包单源收敛，引用为记录摘要加章节锚点；总控已有活动 Demand 时拒绝创建。

## 修订（2026-09-04，[ADR-0012](../../decisions/0012-flow-convergence-callback-calls-testing-redesign.md)）

| 项 | 修订后 |
| --- | --- |
| 状态词汇 | 人读投影增加 `awaiting-decision`：Controller 记 `escalate` 事件后进入，`decision-recorded` 事件或补充需求包认领后退出；该状态下拒绝规划与投递 |
| Q1 blocked 出路 | `blocked` 只用于外部条件；需求或方案层面的问题走 `escalate`，不再靠新的评审决定解除 |
| 完成 | 完成即归档：`complete_demand` 的 preview 内嵌 verify 门与归档前置，apply 在一个事务里写终态事件、封归档包、删活动根、置需求包 archived；verify 报告作为归档成员保存。取消同理。旧的独立 archive 步骤与"已完成未归档"中间态取消 |
| 机器刹车 | 同一任务第三次 `rework` 自动 `escalate`，阈值进 `governance`，默认 3 |
| 调用形状 | 创建、继续、取消为效果或追加型调用；每个变更结果带 `next{frontier, owner, suggestedTool, blockers}`，`inspect_demand_route` 只保留给从头定向，`wakeflow_status` 带 demandId 即附路由 |
