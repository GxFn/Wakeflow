# 能力组 7：结果与评审

> 状态：`confirmed`，Q1 到 Q5 于 2026-09-04 按建议裁决，记录见文末"确认记录"
> 建立日期：2026-09-04
> 旧实现基线：`core/`、`plugins/*` 于 `c0098e2`
> 上位文档：[ADR-0007](../../decisions/0007-rebuild-mandate-and-bottom-up-flow.md)、[ADR-0010](../../decisions/0010-worktree-isolated-execution-and-converged-flow.md)、[能力卡 5](./05-task-planning.md)、[能力卡 6](./06-delivery-and-host-effects.md)
> 说明：本组是评审循环，即 Anthropic 所称的 evaluator-optimizer 模式。Wakeflow 只做结构闭合，真伪与验收永远是 Controller 的判断。

## 7.1 目标结果记录

**场景**：目标窗口或 Test 窗口完成一次投递后，把结果作为不可变记录导入 Demand；记录只陈述做了什么、证据在哪里、映射到哪些验收锚点或测试步骤，不声明被接受。

**旧实现**：

- 路径 `target-results/<targetTaskId>/<targetResultId>.json` 由 id 派生。字段：demand 四元组、`createdAt` 等于事件时间、`targetResultId`、`targetTaskId`、`taskPackage{id, ref, digest}`、`assignment{windowId, repositoryId?}`、`observedState{revision, eventId, eventDigest}`、`transport{group, envelope}`、`outcome ∈ completed | blocked | needs-review`、`summary`、`repositoryChanges[]{repositoryId, disposition ∈ committed | left-uncommitted | no-changes, commits}`、`evidenceLocators[]{kind, ref, digest}`、`verification[]`、`risks[]`、`craftMapping[]`、可选 `supersedes`。**没有** deliveryId、变更文件列表、blockers、requestedControllerDecision。`wakeflow-demand-artifact-records.mjs:48-49`、`:679-813`。
- 由目标窗口自己调用 `wakeflow_record_target_result operation=import` 写入；内容完全由 Agent 撰写，Wakeflow 只查形状与谱系。`wakeflow-target/SKILL.md:96-107`。
- 导入校验：Demand 非终态；四元组与摘要；group 与 envelope 在传输记录中且 target 是成员；任务未 cancelled 或 superseded；包、分配、窗口、仓库在工件、状态、packet 三处一致；run 尾必须是 accepted 或 ambiguous 且恰有一个结算事件；评审必须 idle；`completed` 才检查 `requiredKinds` 覆盖、每个验收锚点一条映射、Test 的每个计划步骤恰好一次且有序；仓库处置与 `commitExpectation` 一致。`wakeflow-result-review-orchestration.mjs:344-487`、`wakeflow-demand-artifact-service.mjs:1134-1478`。
- 选择由编排决定：`current` 或 `historical`，关系 `exact-replay | late-envelope | first-current | same-envelope-correction | new-envelope-round`；`current` 让任务进入 `review-ready`，`outcome: blocked` 让任务进入 `blocked`；结果状态词汇只有 `current | historical`。`:604-632`、`wakeflow-demand-core-records.mjs:172`。
- 证据定位符只做可移植路径形状检查，**从不打开、从不核摘要、从不限定根**。`wakeflow-demand-artifact-records.mjs:229-251`。
- 导入后释放该投递的租约。

**不变量**：身份是记录的规范 JSON 摘要；同 id 不同字节或不同事件意图即冲突；每个已提交结果必须在状态清单里且反之亦然。

**宿主差异**：无。

**现 TS 状态**：`wakeflow_import_target_result` 公开，事件 `result.target-result-recorded`；结果记录随 Demand 事件流。（切片 7 落地：导入解析并核验证据定位符、扫描报告文本、签发回调许可；见文末落地记录。2026-09-10 pod 切片 9：worktree pod 的实现结果 `repositoryChange.branch` 为空即 `precondition-failed/worktree-branch-required`，回调许可指向 pod 的 Controller。）

**实现判断**：按 ADR-0010，结果记录增加 `branch` 与 `commit`，`repositoryChanges` 的 disposition 保留；结果导入必须引用宿主 Stop hook 记录（ADR-0009 调整一）；`supersedes` 与两种关系词汇保留。

**待确认**：

- Q1 证据定位符是否由 Wakeflow 在导入时解析并核摘要，限定在 pod 的 worktree 与 Demand 根内？建议在导入时核，缺失或摘要不符即拒绝，这是 TSD-12"准确性验证"的直接体现。
- Q2 结果记录是否保留隐私扫描的缺失：旧路径不做任何脱敏，原文进入不可变记录。建议导入时做与证据相同的隐私扫描。

## 7.2 评审快照与候选

**场景**：Controller 查看一个派发组的结果集合，机械地生成一个评审候选，候选只回答"哪些任务就绪、哪些阻塞、允许哪些决定"。

**旧实现**：

- `wakeflow_review_pack operation=group` 生成快照：成员状态 `pending-dispatch | pending-host-send | waiting-result | transport-review | ready | blocked | closed`，`ready` 与 `blocked` 只看 `outcome`；`results[]` 只含绑定当前 group 与 envelope 的 current 结果；`resultSetDigest` 是结果元组的摘要；快照**不装配任何证据、锚点、正文或文件**，文档里的 designIntent、objective、intentCheck 在代码里不存在。`wakeflow-result-review-orchestration.mjs:855-992`。
- `wakeflow_reduce_results operation=create` 写 `review-candidates/<id>.json`：`fromState` 等于当前尾事件、`reviewScope` 与非关闭任务集合精确相等、`results`、`resultSetDigest`、三个分区、`allowedDecisions`、`structuralGaps`。`allowedDecisions` 派生：总有 `blocked` 与 `rework`；无阻塞任务时加 `accept`；全部任务有仓库且 workType 为 implementation 时加 `redesign`。同一时间只能有一个 pending 候选。`:1145-1191`、`wakeflow-demand-artifact-records.mjs:838-907`。
- `missingTargetTaskIds` 与 `structuralGaps` 永远为空，整套"缺失任务"机制不可达。
- reduce 从不判断真伪；头注释明写"不验证结果内容真假"。

**现 TS 状态**：`wakeflow_inspect_target_result_review` 只读投影，Review Snapshot 加 post-acceptance route。

**实现判断**：快照与候选合并为一个只读投影加一次决定，不再有独立的 reduce 写入；`missingTargetTaskIds` 与 `structuralGaps` 删除；两个同名不同义的 `resultSetDigest` 合并为一个定义。

## 7.3 决定

**场景**：Controller 对候选作出唯一的验收决定；决定是事件，改变任务与 Demand 的状态，并把评审清回 idle。

**旧实现**：

- `wakeflow_decide_review operation=decide`，词汇恰为 `accept | blocked | redesign | rework`。前置：候选是 pending 的那个；创建事件是状态尾；重算语义逐字节相等；决定在 `allowedDecisions` 内；状态为 `review-ready` 且 review pending。`:1460-1541`。
- 效果：accept 让 Demand 回到 `planned`、任务 `accepted`、包与测试卡 `closed`；rework 与 redesign 让 Demand 与任务 `needs-rework`；blocked 让 Demand `blocked` 但任务 `needs-rework`。评审总是重置为 idle。`:1544-1623`。
- accept **不要求** `outcome === completed`，不要求锚点已映射，不解析证据；`needs-review` 结果也可被接受。
- `controllerSelfChecks` 不是决定的前置条件，只是测试卡的一段自由文本。
- 返工是同一任务同一包的新一轮投递；redesign 在机制上与 rework 相同，只多一个"任务有仓库且为 implementation"的门，后续靠 replacement 包完成。
- 决定事件只存 `resultSetDigest`，从不存 `reviewSnapshotDigest`。

**现 TS 状态**：决定分实现与测试两类，工具为 `wakeflow_record_implementation_review_decision` 与 `wakeflow_record_test_review_decision`；`resume_target_result_review` 与 `authorize_product_defect_remediation` 已于切片 7 删除（分别并入带 `resumption` 的再决定与 `escalate{product-defect}`）。

**实现判断**：`accept` 要求 `outcome === completed` 且全部验收锚点已映射；accept 后的 Demand 状态由剩余任务派生而不是固定 `planned`；`blocked` 决定让任务也进入 `blocked`，并按能力卡 4 Q1 允许新的评审决定解除；cancel 遇到 pending 候选时拒绝而不是静默丢弃。

**待确认**：

- Q3 `accept` 是否必须 `outcome === completed`？建议必须，`needs-review` 只能 rework 或 blocked。2026-09-24 修订（gate-log §13.121 D7）：`needs-review` 结果也可 accept，前提是 Controller 在决定里用 `anchorEvidence` 把每个验收锚点绑到本 Demand 已登记的托管证据；零证据的机械接受仍不允许。
- Q4 决定是否继续分为实现与测试两类（TS 现状），还是合并为一个决定加 `workType` 字段？建议保持两类，因为测试决定要处理尝试代际。

## 7.4 测试判定与尝试

**场景**：Test 窗口按测试卡执行，交回结果；结果可能揭示产品缺陷，需要让产品任务返工并产生新的测试代际。

**旧实现**：

- 没有独立的测试判定词汇，Test 结果就是 `outcome ∈ completed | blocked | needs-review` 的目标结果；`pass`、`fail`、`cannot-conclude` 只存在于测试卡 `boundaryGate` 的自由文本里；边界门的结果没有机器字段。`wakeflow-demand-artifact-records.mjs:48`、`:953-975`。
- Test 结果只允许 `test-step` 映射，每步逐字节等于批准计划的对应步，`completed` 必须覆盖每一步恰好一次且有序。`wakeflow-demand-artifact-service.mjs:1263-1290`。
- 尝试：`testAttempts[]` 最多 10，模式 `initial | resume | restart`，后续尝试必须指向前一尝试及其结果；新尝试要求 `attempts < maxAttempts`、前一投递 accepted 或 ambiguous、任务处于 `needs-rework`，即只有 rework、redesign、blocked 的评审决定能开启下一次尝试；rejected-before-send 的信封替换不消耗尝试。`wakeflow-demand-core-records.mjs:1045-1241`、`wakeflow-delivery-orchestration.mjs:667-760`。
- Test 发现产品缺陷而产品谱系已 accepted：**没有机制**，文档记为能力缺口和停止条件。`stage-route-map.md:143-149`。

**现 TS 状态**：缺陷返工授权由 `wakeflow_record_test_review_decision` 的 `escalate{product-defect}` 在同一提交追加，产品任务返工并产生新的测试代际；测试决定单独一类。

**实现判断**：Test 结果增加机器字段 `verdict ∈ pass | fail | blocked | cannot-conclude`，与 `outcome` 并存，边界门的四种结局落成字段；尝试模式与 10 次上限保留；缺陷返工授权保留为正式能力（能力卡 5 Q5）。

**待确认**：

- Q5 Test 结果增加机器字段 `verdict`？建议增加。

## 7.5 评审状态与生命周期交互

**旧实现**：`state.review{status ∈ idle | pending, readyTargetTaskIds, blockedTargetTaskIds, missingTargetTaskIds, pendingCandidate?}`，三集合互斥，pending 当且仅当有候选；评审 pending 时结果导入与投递规划都拒绝；完成要求 idle；cancel 静默丢弃 pending 候选。`wakeflow-demand-core-records.mjs:1561-1592`、`wakeflow-demand-lifecycle-orchestration.mjs:483`。

**现 TS 状态**：评审状态由事件重放派生；post-acceptance route 投影。

**实现判断**：`missingTargetTaskIds` 删除；cancel 遇到 pending 评审拒绝。

## 旧行为疑点

1. `missingTargetTaskIds` 与 `structuralGaps` 永远为空。
2. 文档承诺的 review pack 字段 designIntent、objective、intentCheck 在代码里不存在。
3. `accept` 不要求 `completed`，零证据的结果可被机械接受。
4. `blocked` 决定让 Demand `blocked` 而任务 `needs-rework`，前向路径只剩同信封更正结果这一条窄路。
5. `accept` 总是把 Demand 设为 `planned`，即使其他目标仍在派发中。
6. 两个同名不同义的 `resultSetDigest`。
7. `trace` 操作没有错误边界，原始加载错误带路径泄漏。
8. `mode` 在 `view result-trace` 必填而在 `review_pack trace` 可选。
9. 不可评审的组仍能生成回传单元。
10. `requiredAcceptanceAnchorIds` 实际无效。
11. 决定事件里算了前后评审摘要但无人消费。
12. redesign 资格在两处用不同谓词检查。

## 新边界下的三方

- **Agent 撰写的内容**：`outcome`、`summary`、`verification`、`risks`、证据定位符、`craftMapping`、`repositoryChanges`、事件的 `reason` 与 `decisionSummary`、测试卡的全部文本。
- **Wakeflow 的机械校验**：形状与封闭字段、路径派生、摘要身份与一事件一工件、传输谱系闭合、包与分配回显、`completed` 的覆盖检查、就绪与阻塞分区、`allowedDecisions` 派生、单一 pending、状态增量、租约释放、幂等重放与失败闭合；按 Q1 增加证据定位符的解析与摘要核验。
- **Controller 的判断**：证据是否真的证明了意图行为；四种决定选哪个；缺口是代码缺陷还是需求错配；测试判定是否关闭了环境风险；是否补包或完成。

## 确认记录（2026-09-04，按建议）

| 问题 | 裁决 | 落点 |
| --- | --- | --- |
| Q1 证据定位符 | 导入时由 Wakeflow 解析并核摘要，限定在 pod 的 worktree 与 Demand 根内；缺失或不符即拒绝 | 结果导入准入 |
| Q2 结果隐私扫描 | 导入时做与证据相同的隐私扫描（与能力卡 8 Q1 的扫描范围联动） | 结果导入准入 |
| Q3 accept 前提 | `accept` 必须 `outcome === completed`；`needs-review` 只能 rework 或 blocked（§13.121 D7 修订：`needs-review` 加 Controller 的 `anchorEvidence` 全锚点绑定也可 accept） | 评审决定命令 |
| Q4 决定分类 | 保持实现决定与测试决定两类，不合并 | 评审决定 schema |
| Q5 Test `verdict` | 增加机器字段 `verdict` | Test 结果 schema |

## 修订（2026-09-04，[ADR-0012](../../decisions/0012-flow-convergence-callback-calls-testing-redesign.md)）

| 项 | 修订后 |
| --- | --- |
| 7.1 结果记录 | Test 结果增加逐步记录 `steps[]{stepId, expected, observed, evidence{ref, digest}, verdict}`，整体 `verdict ∈ pass \| fail \| blocked \| cannot-conclude` 由步骤派生；失败步骤必带 `classification ∈ product-defect \| harness-defect \| environment \| flaky \| missing-evidence \| out-of-scope \| needs-decision`、`likelyOwner`、`recommendedAction`。通过步骤的 observed 成为该步的 approved 基线，后续尝试并列对比。导入成功返回回调内容与许可（能力卡 6 修订） |
| 7.2 评审投影 | 评审两次调用：`inspect_target_result_review` 读投影，一次决定；投影里附基线对比 |
| 7.3 实现决定 | 词汇 `accept \| rework \| blocked \| escalate`，删除 `redesign`；`rework` 只用于验收锚点内的代码缺陷；`escalate` 是类型化事件，Demand 进入 `awaiting-decision`，字段：问题、需求章节引用、证据引用、备选方案（含影响，最多 4 个）、建议，由 Wakeflow 渲染给用户。回流：用户直接回答记 `decision-recorded` 事件；或 Design 发布补充需求包，Controller 认领后规划替换包；§13.121 D7：`needs-review` 结果可凭 Controller 的 `anchorEvidence` 全锚点绑定 accept |
| 7.4 测试决定 | 词汇 `accept \| request-another-attempt（附 stepIds）\| escalate（附分类）`；`product-defect` 走授权返工（现有 `authorize_product_defect_remediation` 并入此路由），`needs-decision` 走用户决策；`blocked` 决定让任务 `blocked`，只有 rework 与授权返工重开尝试 |
| Q3 | 修订（§13.121 D7）：`accept` 接受 `completed`（报告锚点全映射）或 `needs-review` 加 Controller `anchorEvidence` 全锚点绑定；accept 的其余前提不变 |
| Q4 | 保持两类决定 |
| Q5 | `verdict` 落成逐步与整体两级 |
| 工具面 | `resume_target_result_review` 并入 escalate 的回流 |

## 落地记录（2026-09-10，L1 result-review 切片 7）

按 [gate-log §13.87](../../progress/consolidation-gate-log.md) 八项裁决（D1 到 D8，用户于 2026-09-10 确认）落地，实现与验收记录见 §13.88。

| 节 | 落地 |
| --- | --- |
| 7.1 结果记录 | `wakeflow_import_target_result{root, demandId, idempotencyKey, expectedStreamRevision, deliveryId, claimDigest, report}` 追加型一次调用，同键重放。Q1：证据定位符只接受同 Demand 受管证据记录内的 `artifacts/managed-evidence/<evidenceId>/manifest.json` 或 `payload/<member>`，导入时读文件核 sha256，缺失或不符即 `precondition-failed/evidence-unresolved`；`kind` 闭集 `test-output \| diff \| document \| transcript \| commit`。Q2：`summary`、`verification`、`risks`、锚点与步骤自由文本经内核隐私扫描，命中即 `precondition-failed/privacy:<规则>`。实现报告 `repositoryChange` 带 `branch`（`null` 为主检出）与 `commits`。结果事件记 `evidenceResolution[]` 收据与回调段；导入成功返回 `callback{callbackId, permit{prompt, hostAction, generation, issuedAt}}`，prompt 由 Wakeflow 渲染且不含路径与句柄；导入释放窗口工作声明 |
| 7.2 评审投影 | `wakeflow_inspect_target_result_review` 只读：`reviewUnit{status ∈ reported \| review-blocked \| escalated, callback{status ∈ pending \| landed \| silent \| acknowledged, generation, issuedAt, landedRecordId}, targetCompletion{status ∈ pending \| confirmed, recordId, event, observedAt}, allowedDecisions, currentDecision, resumptionBasis, priorReviewHistory, testSteps[]{stepId, given, when, expected, observed, evidence, verdict, failure, baseline}, attemptScope{ordinal, stepIds}}`。完成证据是目标会话在结果 `reportedAt` 之后的 `stop \| turn-complete` 记录（D2）；升级未被用户回答时 `allowedDecisions` 为空 |
| 7.3 实现决定 | `wakeflow_record_implementation_review_decision`：`accept \| rework \| blocked \| escalate`；`accept` 要求 `outcome === completed`、锚点全映射且完成证据 `confirmed`（Q3）；`escalate{issue, requirementRefs, evidence, options[≤4], recommendation}` 同一提交附带 `lifecycle.demand-escalated{source: review-decision}`，Demand 进入 `awaiting-decision`；blocked 与 escalated 之后在同一结果上记录带 `resumption{previousDecisionId, basis: condition-cleared \| decision-recorded{escalationEventId}, summary}` 的新决定（D4）；决定事件记 `callbackLanding` 与 `targetCompletion`；第三次 rework 刹车不变 |
| 7.4 测试判定与尝试 | Test 报告 `steps[]{stepId, observed, evidence, verdict, failure?{classification, likelyOwner, recommendedAction}}`，整体 `verdict` 由 Wakeflow 派生（Q5）；`wakeflow_record_test_review_decision`：`accept \| request-another-attempt{stepIds} \| blocked \| escalate{classification}`；分类到决定的机器规则（D7）：`request-another-attempt` 只接受 `harness-defect \| flaky \| missing-evidence` 失败步骤且容量未满、同一步连续两次 `flaky` 拒绝；`blocked` 要求 `environment` 或整体 blocked；`escalate{product-defect}` 携带 `remediation{affectedTargets{targetTaskId, failedStepIds, correctionObjective}, authorizationRationale}` 并在同一提交追加 `review.product-defect-remediation-authorized`（D5），产品目标 `product-defect-rework-requested`、6b 的 retest 谱系不变；`escalate{needs-decision}` 附带 Demand 升级事件；重跑尝试 `rerunSource.stepIds` 只覆盖失败子集，范围外步骤沿用同目标尝试链或 retest 链里 `then` 相同步骤的通过基线（D6），整体判定按并集派生 |
| 7.5 评审状态 | 评审状态由事件重放派生；`missingTargetTaskIds` 与候选写入不存在；Controller 路由前沿 `implementation-result-review \| implementation-review-blocked \| test-result-review \| test-review-blocked`，escalated 期间由 `awaiting-decision`（前沿 `decision-required`，owner user）覆盖；回调静默时 `wakeflow_rearm_delivery{deliveryId: callbackId}` 重发（上限 3，不取声明） |
| 工具面 | 公共工具 20 → 18：`resume_target_result_review`、`authorize_product_defect_remediation` 删除，`record_controller_*` 改名（D8）；旧 6 个协调器删除 |
