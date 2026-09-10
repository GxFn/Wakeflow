# ADR-0012 流程收敛：回传、调用形状、完成留痕、测试记录对比、重设计边界

> 状态：`accepted`
> 裁决日期：2026-09-04，用户接受 D1 到 D5；能力卡 4 到 7、能力映射矩阵与总览的回写在随后的定位讨论之后执行
> 提出日期：2026-09-04
> 基线提交：`c0098e2`
> 分析：[reviews/2026-09-04-flow-optimization-analysis.md](../reviews/2026-09-04-flow-optimization-analysis.md)（旧代码事实、业界对照、问题与设计细节都在那里，本文只记决定）
> 相关：[ADR-0009](./0009-execution-endpoint-and-host-effect-handshake.md)、[ADR-0011](./0011-requirement-package-as-single-handoff.md)、能力卡 [4](../requirements/capabilities/04-demand-lifecycle.md)、[5](../requirements/capabilities/05-task-planning.md)、[6](../requirements/capabilities/06-delivery-and-host-effects.md)、[7](../requirements/capabilities/07-results-and-review.md)

## 背景

用户对流程提出四个议题并补充一点：回传是基本一环而非可选；调用节奏值得优化但要以旧代码与业界实践为据；留痕是重点，小 bug 要快而记录不减；测试应当是记录与对比，并区分可直接修的问题与需要开发者决策的方案；旧的重设计逻辑越界。

## 决定

### D1 回传是固定效果 `wake-controller`

- `import_target_result` 一次调用返回回调内容与一次性发送许可；目标 Agent 送进 Controller 窗口。旧的 review_pack、controller-preview、apply、pre-send 删除。
- 回调正文由 Wakeflow 渲染：demandId、pod、任务、结论与摘要、分支与提交、摘要、下一步工具名、"传输证据"声明。
- Controller 窗口的 `UserPromptSubmit` 记录证明落地；Controller 的第一次评审读取把回调记为 acknowledged。
- ambiguous：hook 到达即转 accepted；静默超过阈值（默认 10 分钟）列入"未被接收的结果"，可重发，同信封新代际，上限 3。
- `returnPolicy` 默认 `per-target`。

### D2 三种调用形状

- 读：一次调用。追加：一次调用，请求带 `idempotencyKey` 与 `expectedStreamRevision`，服务端保存首次结果，同键重放原样返回，同键不同参数报错。效果：preview 加 apply（`planRef` 加 `planDigest`），只用于宿主效果、不可逆或需用户确认的步骤。
- 每个变更结果带 `next{frontier, owner, suggestedTool, blockers}`。
- 投递两次调用（`prepare_delivery` 含许可，`record_delivery_outcome` 或 hook 自动）；评审两次；`wakeflow_status` 带 demandId 即附路由；追加型结果默认 `concise`。

### D3 完成即归档，一个动作三份记录

- `complete_demand` 的 preview 内嵌 verify 门与归档前置；apply 一个事务写终态事件、封归档包、删活动根、置需求包 archived；verify 报告作为归档成员保存。取消同理。清理并入 pod 关闭或维护对账。
- `bug` 需求包三段：当前错误行为、期望正确行为、必须不变的行为。

### D4 测试是记录与对比

- 测试合同并入 test 任务包 `testContract`：步骤 `{stepId, given, when, then}` 来自需求包验收标准、环境规格引用、允许技能、尝试预算、停止条件。独立测试卡与 `plan_test_card` 删除。
- 测试结果逐步记录 `{stepId, expected, observed, evidence, verdict}`，整体 `verdict` 由步骤派生；通过步骤的 observed 成为 approved 基线，后续尝试并列对比。
- 失败步骤必带 `classification ∈ product-defect | harness-defect | environment | flaky | missing-evidence | out-of-scope | needs-decision`、`likelyOwner`、`recommendedAction`；机器路由见分析第 4 节。
- 再跑只跑失败子集；`blocked` 决定让任务 `blocked`，只有 rework 与授权返工重开尝试。
- 测试决定：`accept | request-another-attempt | escalate`。

### D5 重设计边界

- 实现决定：`accept | rework | blocked | escalate`，删除 `redesign`。
- `escalate` 是类型化事件，Demand 进入 `awaiting-decision`；字段：问题、需求章节引用、证据、备选方案与影响、建议；渲染给用户。
- 回流两条路：用户直接回答记 `decision-recorded` 事件；或 Design 发布补充需求包，Controller 认领后规划替换包。
- 每个验收锚点必须引用需求包验收标准的一条；Controller 不能发明锚点。
- 同一任务第三次 rework 自动 escalate，阈值进配置，默认 3。

## 后果

- 能力卡 4：状态词汇增加 `awaiting-decision`；Q1 的 blocked 出路改为 escalate 与 decision-recorded。
- 能力卡 5：测试卡一节由 `testContract` 取代；任务包锚点增加 `requirementRef`。
- 能力卡 6：Q5 改为必经、默认开启；6.4 按 D1 重写。
- 能力卡 7：结果 schema 增加逐步记录与分类；决定词汇按 D4、D5；`resume_target_result_review` 与 `authorize_product_defect_remediation` 并入 escalate 的路由。
- 能力映射矩阵：`review_pack`、`reduce_results`、`intake_test_card`、`decide_review` 行更新；`plan_test_card`、`prepare_test_delivery`（并入 prepare_delivery）列入删除重写。
- 功能与场景总览：F7、F8、F6.3、F6.4、F5.3、F9.2 同步。
- L1 切片顺序：先做追加型调用形状与 `next` 投影，再做回传效果，再做测试合同。

## 未决问题

- ambiguous 静默阈值与重发上限的具体数值。
- `escalate` 备选方案上限与渲染格式。
- approved 基线的存放位置：Demand 根下按 stepId 的不可变记录，还是归档时才固化。

## 落地记录

- 2026-09-04 L1 demand 切片：D3 完成即归档与取消同一事务落地（`wakeflow_complete_demand`、`wakeflow_cancel_demand`，归档包在 `<ledger>/archives/`，verify 报告入归档包）；D5 的 `lifecycle.demand-escalated`、`lifecycle.decision-recorded` 事件、`awaiting-decision` 路由判定与第三次 rework 刹车落地，用户回答经 `wakeflow_continue_demand{action: record-decision}`；阈值暂为常量 3，进配置留给观察切片。记录见 [consolidation-gate-log §13.79、§13.80](../progress/consolidation-gate-log.md)。
- 2026-09-09 L1 tasking 切片：D5 的验收锚点 `requirementRef{recordDigest, sectionAnchor, itemId}` 落地，指向需求包 `requirement.md` 验收标准节的一条列表项，Wakeflow 校验记录摘要、节与序号；`plan_target_task` 保持 D2 的追加形状；D4 的 `testContract` 与测试卡删除按 gate-log §13.81 D1 并入 delivery 切片。记录见 [consolidation-gate-log §13.81、§13.82](../progress/consolidation-gate-log.md)。
- 2026-09-10 L1 delivery 切片 6a：D1 的投递链落地为三个追加工具 `wakeflow_prepare_delivery`、`wakeflow_record_delivery_outcome`、`wakeflow_rearm_delivery`（实现与 test 共用；`wake-controller` 回调按 gate-log §13.83 D4 随 result-review 切片）；D2 的调用形状落地：请求只带 Controller 三段 `authored{goal, focus, boundary}`，prompt 骨架由 Wakeflow 渲染，处置由 `user-prompt-submit` 记录派生，ambiguous 以再次调用惰性重查、静默阈值 10 分钟与 rearm 上限 3 先作常量；D4 的 `testContract` 与测试卡删除落 6b。记录见 [consolidation-gate-log §13.83、§13.84](../progress/consolidation-gate-log.md)。
- 2026-09-10 L1 delivery 切片 6b：D4 的测试合同并入 test 任务包 `testContract{question, objectBoundary, steps{stepId, given, when, then, requirementRef}, environment, allowedSkills, setupPolicy, maxAttempts, stopConditions}` 落地，`stepId`、环境成员与实现基线由 Wakeflow 派生，缺陷修复后的复测以 `lineage: retest` 表达并消费聚合的 `pendingTestRetest`；独立测试卡、`plan_test_card` 与 `testing.test-card-created` 事件删除；失败子集重跑 `stepIds` 推迟到 result-review 切片。记录见 [consolidation-gate-log §13.85、§13.86](../progress/consolidation-gate-log.md)。
