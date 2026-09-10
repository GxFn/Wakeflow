# 能力组 5：任务规划

> 状态：`confirmed`，Q1 到 Q6 于 2026-09-04 按建议裁决，记录见文末"确认记录"；pod 作用域按 [ADR-0010](../../decisions/0010-worktree-isolated-execution-and-converged-flow.md)
> 建立日期：2026-09-04
> 旧实现基线：`core/`、`plugins/*` 于 `c0098e2`
> 上位文档：[docs/plan/typescript-reimplementation-plan.md §8.1 P0](../../plan/typescript-reimplementation-plan.md)、[ADR-0007](../../decisions/0007-rebuild-mandate-and-bottom-up-flow.md)
> 说明：本组是"Controller 把一个目标拆成可派发的任务"这一步。投递、结果、评审在后续组。

## 5.1 任务包与目标任务

**场景**：Controller 为一个 Demand 规划一个目标任务，产出一份不可变的任务包，指定由哪个窗口、在哪个仓库、做哪类工作、以什么边界和验收锚点完成。

**旧实现**：

- 任务包 `task-packages/<taskPackageId>.json`，只创建不修改，规范 JSON 加换行，0600。封闭字段：demand 与 authority 四元组绑定、`createdAt` 必须等于事件时间、`taskPackageId`、`targetTaskId`、`windowId`、`repositoryId`（非 test 必有）、`workType ∈ documentation | implementation | research | test`、`objective`、`confirmedContext[]`、`requirementRefs[]`（至少一个 `goal` 角色，非 evidence 必须带锚点）、`boundaries{inScope, outOfScope, forbidden}`、`completionExpectations[]`、`dependsOnTargetTaskIds[]`、`commitExpectation`（非 test 必有）、`acceptanceAnchors[]`（implementation 至少一个，test 必须空）、`reviewInputContract{requiredKinds, requiredAcceptanceAnchorIds}`、可选 `designIntent`、`testCard`（test 必有）、`continuation` 或 `replacesTargetTask`（二者互斥）。`wakeflow-demand-artifact-records.mjs:520-680`。
- **没有** title、scope、constraints、status、evidenceContract、prompt 文本。状态只在 `wakeflow-state.json`。
- 目标任务与任务包永久 1:1；返工重派同一任务同一包；同仓库再来一个包只能是 replacement（旧任务与包变 superseded）或 continuation（谱系头已 accepted 且 closed）。任务不可改派窗口或仓库。`wakeflow-demand-core-records.mjs:2032-2095`、`wakeflow-demand-artifact-service.mjs:812-872`。
- `targetTasks[].lifecycleStatus ∈ planned | dispatched | waiting-result | review-ready | needs-rework | accepted | blocked | cancelled | superseded`；包与卡 `active | closed | superseded`。`:161-173`。
- 角色门：product 窗口接受除 test 外的工作类型且仓库必须等于窗口根仓库；test 窗口只接受 test 且无仓库；controller 与 design 一律拒绝。`wakeflow-demand-artifact-service.mjs:285-322`。
- 真正的并发规则是**每 Demand 每仓库一条活动谱系**：同仓库已有任何目标任务，新包必须是 replacement 或 continuation。窗口互斥只是 product 窗口与仓库 1:1 的派生结果。Test 包没有仓库，整段规则被跳过，并发 Test 任务在代码上不受限。`:900-925`。
- 依赖任务必须在**创建时**已 accepted；implementation 需要已冻结权威且 Demand 不是 research。`:726-748`、`:637-651`。
- 规划时不检查窗口绑定与租约，只查配置拓扑；这些在投递准备时才检查。

**不变量**：工件绑定 demand 与 authority 摘要；CAS 两次检查，锁内再查；同 id 同字节同事件意图为幂等重放，否则冲突。

**现 TS 状态**（2026-09-09，tasking 切片，[gate-log §13.81、§13.82](../../progress/consolidation-gate-log.md)）：`wakeflow_plan_target_task` 是追加型一次调用（`idempotencyKey` 加 `expectedStreamRevision`，结果带 `next`），切片在 `src/capabilities/tasking/`，事件 `tasking.target-task-planned`，任务包为不可变 JSON 加事件。任务包 v2：每个验收锚点带 `requirementRef{recordDigest, sectionAnchor, itemId}`，指向需求包 `requirement.md` 验收标准节（`acceptance-criteria`）的一条顶层列表项 `ac-<n>`，Wakeflow 校验记录摘要、节与序号，Controller 不能发明锚点；`lineage` 为 `replacement`、`continuation` 或 `null`：replacement 在创建时让旧目标进入终态 `superseded`（路由、完成与仓库独占不再计入，只有 planned、delivery-prepared、host-effect-rejected、rework-requested、product-defect-rework-requested、redesign-requested、review-blocked 可被替代），continuation 要求谱系头已 accepted，同仓库同时只有一个未接受且未被替代的实现目标；需求包 `taskPlanReview: user` 时请求必须回显 `planReview{confirmedAt}` 并记入任务包，否则以 `precondition-failed/task-plan-review-required` 拒绝；`selectedAuthorityRefs` 保持 Ledger 成员引用，另可带 `sectionAnchors[]`（须是记录 `sections` 里的锚点）。test 类型任务包自 2026-09-10（delivery 切片 6b，[gate-log §13.86](../../progress/consolidation-gate-log.md)）经同一工具追加：Controller 撰写 `testContract`（问题、对象边界、逐步 given/when/then 且每步 `requirementRef` 指向一条验收标准、允许技能路径、设置策略、尝试预算、停止条件）与其余任务包正文，Wakeflow 派生 `stepId`（`ts-<n>`）、test 角色窗口、环境成员（需求包唯一 landing 成员）与 `implementationBaselines`（全部已接受实现目标），谱系为 `null` 或 `{kind: retest}`（消费缺陷修复授权留下的 `pendingTestRetest`）；测试卡家族与 `plan_test_card` 删除。

**实现判断**：字段名沿用 v3 的 `reviewInputContract` 与 `craftMapping`，不回到 v2 的 `evidenceContract`；规划时不要求窗口已有绑定，投递准备时才要求；replacement 与 continuation 保持互斥。

**待确认**：

- Q1 任务包字段集保持 v3 的 `objective + boundaries + completionExpectations + acceptanceAnchors + reviewInputContract`，不增加 title、scope、constraints？建议保持。
- Q2 `replacesTargetTask` 在**创建时**让旧任务与旧包 superseded（代码），还是在新任务 accepted 时（文档）？建议创建时。

## 5.2 测试卡、测试任务与尝试

**场景**：测试决策为 real-environment 的 Demand，Controller 先冻结一张测试卡，规定测试目标、批准的计划、允许的方法、尝试预算与边界门；之后 Test 窗口的任务包绑定这张卡；每次投递是一次尝试。

**旧实现**：

- 测试卡 `test-cards/<testCardId>.json`，字段：demand 与 authority 绑定、`testCardId`、`targetTaskId`（先于任何包预留）、`windowId` 必须是 test 角色窗口、`strategySource{ref, digest}` 必须是冻结权威的一个成员、`observedState{revision, eventId, eventDigest}` 必须等于当前尾事件、`executionContract{requirementGoal, approvedPlan, allowedSkills, setupPolicy ∈ fresh-once | fresh-per-attempt | reuse-existing, maxAttempts 1..10, restartConditions, changeControl}`、`boundaryGate{question, objectBoundary, controllerSelfChecks, realScenarioConditions, successMeans, failureMeans, cannotConclude, stopConditions}`、`evidenceRequired[]`、`allowedOperations[]`、`forbiddenOperations[]`。`changeControl` 的四个 `testMayChange*` 必须为 false，`route` 必须是 `return-blocked-to-controller`。`wakeflow-demand-artifact-records.mjs:907-1015`。
- 只有 `testDecision.mode = real-environment` 允许建卡；controller-only 不建卡不派 Test；research 必须 not-applicable。`wakeflow-demand-artifact-service.mjs:1048-1054`。
- 词汇：测试卡是冻结合同；Test 任务是绑定卡的 Test 任务包创建出的目标任务；尝试是 `testAttempts[]`，序号从 1 连续，最多 10，模式 `initial | resume | restart`，后续尝试必须指向前一尝试与其结果，restart 需要条件与原因。`wakeflow-demand-core-records.mjs:1045-1236`。
- `ADMITTED_TEST_OPTIONAL_SKILLS` 是空集合，任何非空 `allowedSkills` 都被拒绝，测试技能里的方法路由表实际不可达。`wakeflow-demand-artifact-service.mjs:50`。
- 建卡的状态门比任务包宽松：terminal 与 review pending 之外都允许。`:1039`。
- "Test 双代际"在旧体系**未实现**：Test 发现产品缺陷后无法在同一 Demand 里重开已 accepted 的仓库谱系，文档把它记为能力缺口。`stage-route-map.md:140-143`。

**现 TS 状态**（2026-09-10，delivery 切片 6b，[gate-log §13.86](../../progress/consolidation-gate-log.md)）：测试卡、`plan_test_card` 与 `governance/testing` 的卡家族已删除；测试合同随 test 任务包由 `plan_target_task` 追加（见上文任务包一节的现 TS 状态）；执行尝试以 `contract{taskPackageId, taskPackageDigest}` 绑定包，序号上限为合同 `maxAttempts`；同一 Demand 同时只有一个未终结 test 目标，缺陷代际停在 `test-product-defect`，`authorize_product_defect_remediation` 的来源改为 `testTaskPackage` 并从包取实现基线，复测包以 `lineage: retest` 消费授权留下的 `pendingTestRetest`；`record_controller_test_review_decision` 的尝试容量读包内 `maxAttempts`；失败子集重跑（`stepIds`）推迟到 result-review 切片；isolated 的测试规划仍有 blocker。

**实现判断**：测试卡的宽松状态门保留，但不允许在 blocked 下建卡；`observedState` 绑定当前尾事件的做法改为绑定事件流 revision 与状态摘要，与事件溯源一致。

**待确认**：

- Q3 `allowedSkills` 是否改为允许命名测试方法技能，由插件内实际存在的 skills 列表约束？建议允许。
- Q4 "每 Demand 每仓库一条活动谱系"是否延伸到 Test：同一张卡同时只有一个活动 Test 任务，不同卡可并发？建议如此。
- Q5 TS 已实现的"产品缺陷返工授权后产生新 Test 代际"确认为正式能力？建议确认。

## 5.3 派发 prompt 与简报

**场景**：任务包变成一段发给目标窗口的文字。文字要让目标窗口知道自己是谁、读什么、用哪些技能、怎么交回，并且不能带来任何授权。

**旧实现**：

- prompt 是 **Controller Agent 写的自由文本**，代码只校验去空白、无控制字符、不超过 65,536 字符，原样复制进 packet 与信封；没有 prompt 模板。`wakeflow-delivery-orchestration.mjs:178-185`、`:344-386`。
- 代码保证的是 `taskBriefing`：`workType`、`confirmedContext`、`completionExpectations`、`requiredSkills`（Test 为 target 加 test，其余为 target 加 target-craft，硬编码）、`commitExpectation`；packet 另带 `boundaries`、`acceptanceAnchors`、`designIntent`、`reviewInputContract`、`resultContract`、Test 的 `testContract`，加任务包摘要与 packet 摘要。prompt 只通过 packet 与信封摘要间接绑定。`:546-580`。
- 文档合同规定的 prompt 章节：一行头 `Continue current window task: <window>/<taskId>`、目标、不超过两条完成焦点、一条优先上下文、一条带标签的关键边界、不超过四个验收锚点、按序阅读清单（任务包、需求文档章节、工作区指令文件、仓库指令文件、状态根）、必需技能、身份块（当前责任窗口、唯一工作仓库）、RED 映射指令、交回要求、派发记录块。身份块里**没有 demandId**。`wakeflow-delivery.md:29-76`。
- 交回指针是 MCP 调用 `wakeflow_record_target_result operation=import`，明确禁止写本地结果文件；目标窗口还可调用 review_pack、prepare_delivery 的 controller 系列、record_delivery 的 controller-outcome。`wakeflow-target/SKILL.md:96-137`。
- 禁止：XML 或 JSON 包装、目标到目标的下一跳投递、结果里出现原始句柄或绝对路径；长度限制只在文档里。

**现 TS 状态**（2026-09-10，gate-log §13.84）：prompt 骨架由 delivery 切片的 `src/capabilities/delivery/prompt.ts` 从任务包与 Controller 三段 `authored{goal, focus, boundary}` 确定性渲染（Q6 落地），全文与摘要进投递信封；packet 家族删除，`sectionAnchors` 进入阅读顺序。

**实现判断**：按 TSD-12"Wakeflow 提供内容"，prompt 应由 Wakeflow 从 packet 确定性渲染骨架，即身份块含 demandId、阅读顺序、必需技能、交回指针、派发记录，Controller 只写目标、完成焦点、边界三段人话；整段 prompt 带摘要进入信封。

**待确认**：

- Q6 prompt 改为"Wakeflow 渲染骨架加 Controller 撰写三段"并带摘要，还是保持 Controller 自由文本？建议前者。

## 5.4 目标与测试技能的义务

**场景**：目标窗口收到 prompt 后按技能执行；Test 窗口按测试卡执行；两者都通过同一个结果导入工具交回。

**旧实现**：

- `wakeflow-target` 与 `wakeflow-controller` 只存在于两个插件树且**两宿主内容不同**；`wakeflow-target-craft`、`wakeflow-test`、`wakeflow-design`、`wakeflow-governance` 在 core 与插件逐字节一致。
- 目标义务：确认 typed 身份与谱系，到达不等于授权；读任务包、需求引用、列出的技能；只在一个仓库内执行；产出可评审输入；用 MCP 导入结果；可选做 Controller 回传。`wakeflow-target/SKILL.md:69-137`。
- 手艺七条：计划、基线、RED 到 GREEN 加缺陷修复硬门、系统调试、两段自审、YAGNI、完成前验证；硬规则是每个验收锚点先有 RED 探针再实现。`wakeflow-target-craft/SKILL.md:24-152`。
- 证据合同真名：包侧 `reviewInputContract`，结果侧 `evidenceLocators[]{kind, ref, digest}` 与 `craftMapping[]`（`acceptance-anchor` 或 `test-step` 两种）；证据种类词汇只是推荐表，明确不做机器拥有的分类；reduce 时只做结构校验，真伪由 Controller 判断。`wakeflow-demand-artifact-records.mjs:722-798`。
- Test 义务：入口门（所有非 Test 目标已 accepted 且自检已记录，或显式诊断）、只读产品源码、方法只能在 `allowedSkills` 内、证据恰为 `{kind, ref, digest}` 加 test-step 映射。`wakeflow-test/SKILL.md:27-144`。

**现 TS 状态**：skills 文本未随新工具面重写，属于 L2 场景层工作。

**实现判断**：宿主差异只保留在指令文件名、工具名与执行步骤，两宿主的 target 与 controller 技能合并为一份主体加宿主片段；证据种类继续不做机器分类。

## 旧行为疑点

1. `add_task` 与 `continue_demand` 同一处理器，见能力组 4。
2. `ADMITTED_TEST_OPTIONAL_SKILLS` 为空，测试方法路由表不可达。
3. implementation 的"未冻结权威"分支不可达，前面已无条件检查。
4. 文档说 accepted 时 supersede，代码在创建时。
5. 测试卡与任务包的状态门不对称且无说明。
6. 并发 Test 任务在代码上无上限。
7. `core/schemas/wakeflow-state-machine/` 的 v2 任务包 schema 仍被 validator 要求存在，但形状与 v3 矛盾。
8. 依赖任务"派发前 accepted"的文档与"创建时 accepted"的代码不一致。
9. `validateArtifactTuple` 对 target-result 提前返回不查 ref。
10. 幂等重放扫描全部事件；continuation 路径重读全部任务包文件。
11. 事件 `command` 与 `type` 是自由 token，不是枚举。

## 确认记录（2026-09-04，按建议）

| 问题 | 裁决 | 落点 |
| --- | --- | --- |
| Q1 任务包字段集 | 保持 `objective + boundaries + completionExpectations + acceptanceAnchors + reviewInputContract`，不加 title、scope、constraints | 任务包 schema |
| Q2 `replacesTargetTask` 时机 | 创建新任务时旧任务与旧包即 superseded；旧文档的"accepted 时"作废 | 任务规划命令与事件 |
| Q3 测试卡 `allowedSkills` | 允许命名测试方法技能，由插件内实际存在的 skills 列表约束 | 测试卡 schema 与校验 |
| Q4 Test 活动谱系 | 同一张测试卡同时只有一个活动 Test 任务，不同卡可并发；在 pod 作用域内生效 | 测试规划命令 |
| Q5 缺陷返工新代际 | TS 已实现的"产品缺陷返工授权后产生新 Test 代际"确认为正式能力 | 保持现状，补场景验收 |
| Q6 投递 prompt | Wakeflow 渲染骨架加 Controller 撰写三段并带摘要 | 投递准备（能力卡 6） |

补充（2026-09-04，ADR-0011）：用户确认"同一子窗口接受多个任务沿用任务包逻辑"：一个 Demand 拆成多个任务包，同一窗口按谱系串行，不同窗口用派发组并行；不引入需求级任务组。`selectedAuthorityMemberRefs` 改为需求包记录摘要加章节锚点；`confirmedContext` 引用 `landing.md` 章节；需求包标 `taskPlanReview: user` 时任务清单在投递前交用户过目。

## 修订（2026-09-04，[ADR-0012](../../decisions/0012-flow-convergence-callback-calls-testing-redesign.md)）

| 项 | 修订后 |
| --- | --- |
| 5.2 测试卡 | 独立测试卡与 `plan_test_card` 删除。test 类型任务包携带 `testContract`：步骤 `{stepId, given, when, then}` 来自需求包验收标准、环境规格引用、允许的方法技能（限插件内实际存在）、尝试预算 1 到 10、停止条件。冻结语义由任务包的不可变性承担 |
| Q3 allowedSkills | 保留裁决，字段位于 `testContract` |
| Q4 活动谱系 | 同一 `testContract` 同时只有一个活动 Test 任务 |
| Q5 缺陷返工 | 保留为正式能力，但入口改为测试决定 `escalate` 的 `product-defect` 路由（能力卡 7 修订） |
| 尝试 | 一次尝试可指定 `stepIds` 只跑失败子集；预算不变 |
| 验收锚点 | 每个 `acceptanceAnchor` 增加 `requirementRef{recordDigest, sectionAnchor, itemId}` 指向需求包验收标准的一条，Wakeflow 校验引用存在；Controller 不能发明锚点 |
| 调用形状 | `plan_target_task` 是追加型一次调用：`idempotencyKey` 加 `expectedStreamRevision`，结果带 `next` |
