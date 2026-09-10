# 场景验收清单

> 状态：`active`
> 建立日期：2026-09-04
> 上位文档：[plan §8.1 P0、§9](../plan/typescript-reimplementation-plan.md)、[能力卡](../requirements/capabilities/)
> 运行入口：`npm run scenario:acceptance`，即聚焦运行 `tests/scenarios/wakeflow-scenario-acceptance.test.ts`；全量 `npm test` 也包含它
> 说明：场景来自能力卡的场景块。骨架在一次性工作区上经公共 MCP 工具端到端运行，不与旧实现比较磁盘状态、文件路径或错误堆栈。结论只能是四类之一：`pass` 通过、`intentionally-dropped` 有意放弃、`pending-user-decision` 待用户决定、`defect` 新实现缺陷；尚未接线的记 `not-run`，不能算通过。报告从不包含临时路径。

## 1. 已接线场景

| 场景编号 | 能力卡 | 场景 | 断言 | 当前结论 |
| --- | --- | --- | --- | --- |
| `card-01/fresh-initialize` | 01 | 一次性工作区初始化 | preview 零写且 `ready`；apply `completed`；`wakeflow.config.json` 与 `.wakeflow-active` 存在；结果不含私有路径 | pass |
| `card-03/requirement-package` | 03 | 需求包 preview 摘要、章节校验、发布即上板 | 缺用户确认时 preview `blocked` 且返回摘要；带 `confirmedAt` 后 `ready` 且零写；apply `published` 上板 `pending`，`next` 指向认领；`inspect_board` 列出 1 个 pending；ledger 记录目录存在；结果不含私有路径 | pass |
| `card-04/create-demand` | 04 | 认领需求包即创建 Demand | `create_demand(requirementId)` 返回 `claim.stateRevision` 2；看板 package 视图为 `claimed` 且指向该 Demand；Route 为 `work-available` 且前沿含实现任务规划 | pass |
| `card-02/window-handshake` | 02 | 窗口握手：启动意图、Agent 回执、绑定登记 | inspect 为 `unregistered` 且执行参数为 Codex `create_thread`；写入 `session-start` hook 记录后 register 为 `registered`；同一回执重放 `replayed`；结果与投影不含原始句柄与私有路径 | pass |
| `card-02/window-replace` | 02 | 替换窗口：新握手以 CAS 换代 | 过期绑定摘要被拒绝；replace 为 `replaced` 且绑定代际变化；磁盘绑定文件只含新句柄 | pass |
| `card-05/plan-implementation-task` | 05 | 规划实现任务与同仓库替代 | 发明的验收锚点序号（`ac-9`）被拒绝；首包追加 `committed` 且 `planned`，锚点 `requirementRef` 指向需求包验收标准 `ac-1`，`lineage: null`，`sectionAnchors` 含 `goal`；同仓库第二包以 `lineage: replacement` 追加 `committed`，结果回显被替代目标；同一替代请求重放 `idempotent` 且活动根零写；`next` 与 Route 前沿前进到投递规划；后续投递、评审与完成即归档（`card-08`）只针对替代后的目标；结果不含私有路径 | pass |
| `card-06/delivery-chain` | 06 | 一次调用准备投递并取得许可 | Route 为投递规划；`prepare_delivery` 追加 `committed`，许可动作为 `send-prompt-to-window`，prompt 不含私有路径且含 deliveryId 与声明摘要，窗口工作声明文件存在；Route 前进到宿主效果执行；同键重放 `idempotent` 且同一投递与围栏；无落地记录时 `record_delivery_outcome` 为 `indeterminate`、声明 `retain`、phase `host-effect-indeterminate`，`next.blockers` 含 `landing-evidence-missing` | pass |
| `card-06/ambiguous-resolution` | 06 | hook 记录到达后再次记录结局 | 写入目标会话的 `user-prompt-submit` 记录（`promptDigest` 等于许可 prompt 摘要）后，新键再次调用为 `accepted`、证据 `hook-record`、声明 `retain`、phase `host-effect-accepted`；`next` 与 Route 前沿为结果导入 | pass |
| `card-08/complete-and-archive` | 08 | 完成即归档 | 经公共工具结果导入（`deliveryId` 加围栏摘要，导入后声明释放）、评审接受后 Route 为 `demand-completion-preflight`；`complete_demand` preview 零写、`ready` 且八道 verify 门全 `pass`；apply `completed`，需求包 `archived`，`next` 指向 continue；活动根已删除，`<ledger>/archives/<demandId>/<修订号>/manifest.json` 存在；Route 查询返回 `archived: completed`；recover 返回 `recovered` 且同一终态事件 | pass |
| `card-04/complete-and-continue` | 04 | continue 与 cancel | `continue_demand` preview `ready`、apply `continued`，需求包回到 `claimed`，Route 为 `work-available` 且前沿为实现任务规划；`cancel_demand` preview `ready`、apply `cancelled`，需求包 `withdrawn`，活动根删除；取消后 continue 的 preview 为 `blocked` 并含 `archive-outcome:cancelled` | pass |

## 2. 待接线场景

按能力卡场景块列出，随 L1 切片闭合逐个接线。接线前记 `not-run`。

| 场景编号 | 能力卡 | 场景 | 依赖切片 |
| --- | --- | --- | --- |
| `card-01/reconfigure` | 01 | 重新配置拓扑，preview 零写，apply 只改声明差异 | maintenance reconfigure |
| `card-01/reconcile-noop` | 01 | 健康工作区 reconcile 零步 `no-op` | maintenance reconcile |
| `card-05/test-contract` | 05 | test 任务包携带测试合同，步骤来自需求包验收标准 | delivery 切片（ADR-0012 D4；gate-log §13.81 D1） |
| `card-06/wake-controller` | 06 | 回调 wake-controller 与 acknowledged | 结果与评审切片（gate-log §13.83 D4） |
| `card-07/import-and-review` | 07 | 结果导入核定位符与隐私扫描、逐步记录与分类、escalate 与 decision-recorded、approved 基线对比 | 结果与评审切片（ADR-0012 D4 D5） |
| `card-08/evidence` | 08 | 三种来源加 `pod-worktree` 与 `observation`，kind 闭集，隐私扫描收窄 | 证据切片 |
| `card-09/status-and-verify` | 09 | status 含 pod 段与 TODO 摘要；verify 门集合与 `unavailable` 计数 | 观察切片 |
| `card-09/active-projection` | 09 | 投影标记、手写不覆盖、pod 段 | 活动投影切片 |
| `card-10/pod-lifecycle` | ADR-0010 | pod 创建 preview 零写、ready 两阶段、关闭顺序 | pod 切片 |
| `card-10/release-consistency` | 10 | 五源一致、标签在 HEAD、Node 24 | L3 |

## 3. 未执行标注

无真实宿主会话时，涉及宿主效果的场景只验证到"意图签发与回执准入"，宿主动作本身标注 `not-run: host session unavailable`，不得记为通过（plan §8.1 P0 待核实事项）。
