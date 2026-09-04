# 流程优化分析：回传、调用形状、完成留痕、测试记录对比、重设计边界

> 状态：`proposed`，评估建议，待用户裁决；裁决后以 [ADR-0012](../decisions/0012-flow-convergence-callback-calls-testing-redesign.md) 落地
> 建立日期：2026-09-04
> 基线：旧 JavaScript 实现于 `c0098e2`，三次只读深读（回传闭环、总控调用节奏、测试与重设计）；业界资料见文末来源
> 上位文档：[功能与场景总览](../requirements/wakeflow-functions-and-scenarios.md)、能力卡 [6](../requirements/capabilities/06-delivery-and-host-effects.md)、[7](../requirements/capabilities/07-results-and-review.md)、[ADR-0009](../decisions/0009-execution-endpoint-and-host-effect-handshake.md)、[ADR-0011](../decisions/0011-requirement-package-as-single-handoff.md)

## 0. 更正与范围

用户指出"Controller 的唤醒靠人"是误判：旧流程里子窗口完成任务后回调总控是基本一环。深读证实：目标窗口导入结果后，自己执行 `review_pack`、`prepare_delivery controller-preview | apply | pre-send`，再由宿主把一行回调粘进 Controller 窗口。我在能力卡 6 Q5 把它建议为"可选、默认关闭"是错的，本文第 1 节改正。

用户的要求：多读旧代码、联网对照业界，再优化设计；Wakeflow 的重点是留痕，小 bug 也要快但记录不能少；测试应当是记录与对比，并区分"可直接修的明显问题"与"需要开发者决策的方案"；旧的重设计逻辑存在越界。本文按这五点分析。

## 1. 回传闭环

### 旧实现事实

- 目标侧五步、宿主一步：`record_target_result import` 释放租约；`review_pack group` 得 `callbackUnits`；`prepare_delivery controller-preview`（`deliveryId` 由 Agent 自造）；`controller-apply` 只发布信封；`controller-pre-send` 复验绑定与快照；Claude 宿主 facade 在 Controller 窗口互斥锁内 `load-buffer`、`paste-buffer`、`send-keys Enter`，一次 `capture-pane` 回读，随后写 attempt-1 的 run。`wakeflow-result-review-orchestration.mjs:758`、`:993`、`:2010`、`:2121`、`:2267`；`wakeflow-claude-transport.mjs:1033-1100`。
- 回调正文是一行定长文本：组 id、目标任务 id、`resultSetDigest`、`reviewSnapshotDigest`，加"本回调只是传输证据"。**不含** demandId、工作区根、结论摘要、下一步。`:1862-1870`。技能文档里写的多行模板含 stateRoot、blockedTargets、remainingTargets，代码从未生成。
- `returnPolicy` 由 Controller 在 target-preview 里必填：`group-ready` 一组一回调，`per-target` 一目标一回调。`wakeflow-delivery-orchestration.mjs:400`、`:76`。
- 代码上没有任何门依赖回调：完成不检查、评审不检查；唯一影响是未发送的回调信封阻塞 prune。回调是技能规定的必经步骤，不是机器规定的。
- 没有轮询、没有 hook、没有 watcher；活动监视只翻 pane 图标；keep-live 无调用方；`automationRequested` 无任何分支读取。
- Codex 侧只有文档：无 transport、无 facade、宿主 profile 无 `transportHostFile`。
- 失败面：`paste-buffer` 失败记 `ambiguous` 却被当成"已发送"去重，不能重发也不能 rearm，Controller 可能从未被唤醒；Controller 窗口被替换后旧信封永久 stale 且阻塞 prune；`return-rearm-required` 没有实现。

### 业界对照

| 来源 | 结论 |
| --- | --- |
| Anthropic《Building effective agents》 | orchestrator-workers：worker 的结果回到 orchestrator 由它综合；这是闭环的定义，不是可选项 |
| Claude Code sub-agents 文档 | 子代理结果"以完成通知的形式在之后的一轮到达"父会话；`SubagentStop` hook 在子代理完成时触发 |
| Codex hooks 与 notify | `Stop` 与 `agent-turn-complete` 携带 `turn_id`、`last_assistant_message` |
| Anthropic《Writing tools for agents》 | 工具应合并多步操作，返回高信号内容 |

### 问题

1. 目标侧五次调用只为发一行文本，且这一行不够 Controller 直接行动，它还得重读状态。
2. 回调的证据链靠一次 `capture-pane` 子串匹配，Codex 上没有实现。
3. ambiguous 静默丢失，是闭环里唯一没有出口的洞。
4. 回调作为流程必经一环，却没有任何机器记录"这条结果已被 Controller 接收"。

### 建议设计

回传是 ADR-0009 握手里的固定效果种类 `wake-controller`，不是可选项。

- **目标侧一次调用。** `import_target_result` 成功即返回回调内容与一次性发送许可：`{callbackPrompt, controllerEndpoint{podId, windowId, bindingId}, fencingToken}`。目标 Agent 按 skills 把它送进 Controller 窗口，Claude 粘贴加回车，Codex 发线程消息。旧的 review_pack、controller-preview、apply、pre-send 四步删除；信封由 Wakeflow 在导入事务内生成，`deliveryId` 由状态派生而不是 Agent 自造。
- **回调正文由 Wakeflow 渲染，够 Controller 直接行动**：demandId、pod、目标任务、结论 `outcome` 与一句摘要、分支与提交、结果与快照摘要、下一步工具名（`inspect_target_result_review`）、"本回调只是传输证据"的声明。不含绝对路径与句柄。
- **接收即确认。** Controller 窗口的 `UserPromptSubmit` hook 记录（prompt 摘要匹配）证明回调落地；Controller 随后对该 Demand 的第一次评审读取把回调记为 `acknowledged`。不再需要目标窗口单独调 `controller-outcome`。
- **ambiguous 有出口。** 发送调用结果未知时记 ambiguous；hook 记录到达即自动转 accepted；超过一个可配置的静默阈值（建议 10 分钟）后，status 与活动投影列出"未被接收的结果"，任何窗口的 Agent 或用户可再发一次，重发用同一信封加新的代际，上限 3 次。
- **Controller 窗口被替换**时，回调目标按当前绑定重算，旧信封作废而不是永久 stale。
- `returnPolicy` 保留 `per-target` 与 `group-ready` 两种，默认 `per-target`；group-ready 只在多目标派发组上可选。

### 影响

能力卡 6 Q5 改为"必经、默认开启"；能力卡 7 的结果导入返回值增加回调内容与许可；ADR-0009 效果表的"投递"行增加 `wake-controller` 变体；Codex 的回调实现是 skills 步骤加 hook 记录，不再是缺口。

## 2. 调用形状与节奏

### 旧实现事实

- 一个最小 Demand，一个实现任务加一轮返工：Controller 侧 23 次 MCP 调用，加归档与清理 27 次；另有 2 次宿主 facade 与 2 次目标侧导入。每阶段：定向 2、创建 5、每轮投递 4、每轮评审 3、完成 2、归档清理 4。
- 三种形状并存：只读一次调用；追加型一次调用（add_task、decide_review、reduce_results、import、record_delivery、register_window 等），幂等靠调用方提供的 `eventId` 与逐字节相同的记录；preview 加 apply（create、complete、cancel、archive、prune、preserve、evidence、maintain），承担三件事：不可逆动作前的人读计划、apply 在锁内重算计划并要求逐字节一致的漂移检测、recover 的恢复键。投递另有第三段 `claim`，因为它是唯一的 `prepared → send-claimed` 转换，必须紧贴宿主效果。
- **"下一步"不在任何变更结果里。** 结果信封只有 `{schemaVersion, tool, operation, result, activeProjection?}`；机器只给三个 token：status 的 `nextActions[]`、review_pack 的 `nextAction`、候选的 `allowedDecisions[]`。真正的路由是技能里的固定阶段表加一次单独的 status 调用。
- **过大的往返载荷只有一处**：投递计划的 preview 结果里带整份 `wakeflow-state.json`，prompt 出现三次，apply 时整份回显，每轮投递来回两次。`wakeflow-delivery-orchestration.mjs:1151`。
- `planDigest` 不是幂等键也不是授权令牌，是漂移检测；幂等键是 eventId 与工件 id。

### 业界对照

| 来源 | 结论 |
| --- | --- |
| Anthropic《Writing tools for agents》 | 合并多步操作到一个工具；只返回高信号信息；用 `response_format` 让 Agent 选择精简或详细；错误要可行动 |
| Stripe 幂等请求 | 客户端生成幂等键，服务端保存首次结果并原样返回，参数不同即报错；GET 不需要键 |
| Terraform plan/apply | 只对有外部副作用或不可逆的变更保留"先看计划再执行" |
| ToolGate（ADR-0009 已引） | 前置条件门控调用，后置条件决定结果能否提交 |

### 问题

1. 内部追加型操作也走两次调用时，preview 只是把输入原样回显一遍，付出的是 Controller 的上下文。
2. 每次变更后要单独调路由，路由本应随变更结果一起回来。
3. 投递的三段与整份状态回显是最大的上下文消耗。

### 建议设计：三种形状，一个规则

| 形状 | 适用 | 调用 | 幂等与安全 |
| --- | --- | --- | --- |
| 读 | 定向、评审投影、板查询、校验 | 1 次 | 无副作用 |
| 追加 | 规划任务、评审决定、导入结果、记录证据、登记绑定、记录投递结果 | 1 次 | 请求带 `idempotencyKey`（Agent 生成）与 `expectedStreamRevision`；服务端在锁内做 CAS，保存首次结果，同键重放原样返回，同键不同参数报错 |
| 效果 | 初始化与重配置、发布需求包（用户确认）、投递准备（宿主效果）、pod 创建与关闭、完成即归档 | preview 加 apply，apply 用 `planRef` 加 `planDigest`（ADR-0004） | 计划在锁内重算比对；recover 用同一计划 |

规则：只有"有宿主效果、不可逆、或需要用户确认"的步骤才有 preview。

- **每个变更结果带 `next`**：`{frontier, owner, suggestedTool, blockers[]}`，与 `inspect_demand_route` 同源。Controller 不再在每次变更后单独调路由；路由工具保留给"从头定向"。
- **投递收成两次调用**：`prepare_delivery` 一次完成 group、packet、envelope、工作声明与一次性许可，返回许可与 prompt 一份，不回显状态；`record_delivery_outcome` 一次记录，或由 hook 记录自动完成。三段变两段的代价是许可在准备时签发，靠围栏令牌与 `expectedStateDigest` 防止状态漂移，这正是 ADR-0009 的设计。
- **评审收成两次调用**：`inspect_target_result_review` 读投影，`record_*_review_decision` 一次决定。旧的 reduce 写入已并入投影（能力卡 7）。
- **定向收成一个工具**：`wakeflow_status` 不带 demandId 给工作区定向与待认领摘要，带 demandId 附该 Demand 的路由。
- **`response_format`**：追加型结果默认 `concise`，只回 id、修订、摘要与 `next`；需要时 `detailed`。

同一最小 Demand 的调用数：创建 1、规划 1、投递 2、评审 2、返工一轮 4、完成即归档 2，共 12 次，对比旧的 27 次；往返载荷里不再有整份状态与重复 prompt。

## 3. 完成、归档、清理与留痕

用户的立场：留痕是重点，机器调用本身不是损耗；目标是小 bug 也能快速处理并留下完整记录。本节据此修正我此前"合并三步"的建议：合并的是 Controller 的动作，不是记录。

### 旧实现事实

完成、归档、清理是三个工具六次调用，中间留下"已完成未归档"的中间态；verify 是另一个只读工具。归档前置检查终态、评审 idle、包与卡关闭；不查租约。

### 建议设计

- **一个动作，三份记录。** `complete_demand` 的 preview 内嵌 verify 门与归档前置，apply 在一个事务里写终态事件、封归档包、删活动根、置需求包 archived；verify 报告作为归档包的一个成员保存下来，比旧实现多留一份痕。取消同理。清理并入 pod 关闭或维护对账，不占 Controller 的一步。
- **小 bug 的快速路径，记录不减**：需求类型 `bug` 的需求包按 Kiro 的 bugfix 三段写：当前错误行为、期望正确行为、必须保持不变的行为；一个任务包；一次投递；一次评审；完成即归档。人的动作只有一次确认；机器留下需求包、任务包、投递、结果、决定、归档六类记录。
- 旧实现"归档不查租约"的缺口按能力卡 8 Q5 补上。

## 4. 测试：记录对比与两类问题

### 旧实现事实

- Test 窗口只能记一份普通目标结果：`outcome ∈ completed | blocked | needs-review`，`craftMapping` 只记"哪份证据对应批准计划的哪一步"。**没有期望与实际的对照结构**，`expected` 字段只存在于实现任务的验收锚点里，Test 包被禁止定义锚点。`wakeflow-demand-artifact-records.mjs:606-613`、`wakeflow-demand-artifact-service.mjs:1267-1272`。
- pass、fail、cannot-conclude 只是测试卡上 `boundaryGate` 的三段文字，从未落成字段；通过与失败都记为 `completed`。
- 尝试预算 1 到 10 是机器规则；"再来一次"是 `rework` 决定加新投递；`blocked` 决定把任务置为 `needs-rework`，与 rework 无法区分，静默重开尝试路线。
- 分诊词汇只在技能文本里：product defect、harness defect、environment、flaky、missing evidence、out of scope、needs owner decision。没有一个是字段。`wakeflow-test/references/debugging-triage.md:41-50`。
- 产品缺陷升级在旧代码没有机器路径，Demand 既不能完成也不能修，只剩取消；TS 已补 `authorize_product_defect_remediation`。
- "需要用户决定"在代码里零命中，只存在于技能标签与阶段表的升级车道二。
- `allowedSkills` 是空集合，四份测试方法参考永远不可授权。

### 业界对照

| 来源 | 结论 |
| --- | --- |
| Gherkin Given/When/Then | Then 一步的实现必须用断言比较实际与期望；步骤写可观察结果不写实现 |
| Approval Tests | 记录实际输出为 received，与 approved 基线比对，差异由人批准后成为新基线；适合复杂输出 |
| Kiro bugfix specs | 分析段记录当前错误行为、期望正确行为、必须不变的行为；验证证明"能复现、已修复、无回归" |
| Anthropic evaluator-optimizer | 评估者给出结构化反馈，优化者修正；需要清晰的评估标准 |

### 建议设计

**一、测试合同并入 test 类型的任务包**，不再有独立的测试卡与 `plan_test_card`。合同段 `testContract` 内容：来自需求包验收标准的测试步骤，每步 `{stepId, given, when, then}`；环境规格引用；允许的方法技能（按插件内实际存在的技能名）；尝试预算；停止条件。冻结语义不变：任务包本来就是不可变的。

**二、测试结果是逐步的记录与对比**：

```text
steps[]: { stepId, expected（来自 then）, observed（实际看到的）, evidence{ref, digest}, verdict: pass | fail | blocked | cannot-conclude }
verdict: pass | fail | blocked | cannot-conclude   （整体，由步骤派生：任一 fail 即 fail）
```

Wakeflow 校验的是结构：每一步都有记录、observed 非空、证据定位符可解析且摘要相符、整体判定与步骤一致。真伪仍由 Controller 判断。**通过的步骤的 observed 成为该步的 approved 基线**：后续尝试再跑同一步时，Wakeflow 把新的 observed 与基线并列给 Controller，差异由人批准或判为回归。这就是"记录对比"。

**三、失败步骤必须分类，分类是字段**：

| classification | 含义 | 机器路由 |
| --- | --- | --- |
| `product-defect` | 明显的代码缺陷，在已确认的验收标准内 | Controller 可授权有界返工（现有 `authorize_product_defect_remediation`），实现窗口修，再跑失败步骤 |
| `harness-defect` | 测试自己的夹具或脚本问题 | Test 任务再来一次，不动产品 |
| `environment` | 环境或配置问题 | Test 任务 blocked，附外部条件 |
| `flaky` | 非确定性 | 记录，再跑一次，连续两次 flaky 升级为 needs-decision |
| `missing-evidence` | 观测不到 | Test 任务再来一次并补观测手段 |
| `out-of-scope` | 不在验收标准内 | 记录，不路由 |
| `needs-decision` | 期望本身有歧义或方案要开发者选 | 见第 5 节：升级给用户，不由 Controller 自决 |

每条失败步骤带 `classification`、`likelyOwner`、`recommendedAction` 三个字段；分类由 Test 窗口给出、Controller 复核。

**四、再跑只跑失败子集。** 一次尝试可以指定 `stepIds`；尝试预算不变，1 到 10。`blocked` 决定把任务置为 `blocked` 而不是 `needs-rework`，只有 `rework` 与授权返工能重开尝试。

**五、测试决定收成三个**：`accept`、`request-another-attempt`（附 stepIds）、`escalate`（附分类；product-defect 走授权返工，needs-decision 走用户决策）。旧的 `escalate-product-defect` 是 `escalate` 的一种。

## 5. 重设计边界

### 旧实现事实

- `redesign` 决定的机器效果与 `rework`、`blocked` 完全相同：任务置 `needs-rework`，只是事件类型不同；不创建任何后续工件。`wakeflow-result-review-orchestration.mjs:1555-1617`。
- 之后的替换包只要求"最近一条决定是 redesign"，**不要求 Design 产物、不要求需求增量、不要求用户确认**。`wakeflow-demand-artifact-service.mjs:808-825`。
- 任务包的 `objective`、`boundaries`、`completionExpectations`、`acceptanceAnchors` 全是不绑定 ledger 的自由文本。替换包必须复用旧的需求文档，却可以写全新的目标与全新的验收锚点。这正是 Controller 单独一轮就能重新解释需求的缝，唯一的守卫是一句技能文本"不要从实现残留里发明锚点"。
- 替换在创建时就 supersede 旧任务并把 Demand 拉回 planned，与文档"接受时"不一致；"暂停实现搅动"没有机器停留时间。
- Test 包不能 redesign；Pod 的 `requestType: redesign | supplement` 结构性不可达；"需要用户决定"没有机器钩子；v2 的返工计数器已删，"第三次点修刹车"靠 Agent 自己数事件。
- 用户确认在机器上只出现一次：需求与补充类型的 `user-confirmation` 成员角色。

### 业界对照

| 来源 | 结论 |
| --- | --- |
| GitHub Spec Kit | 需求只写 what 与 why；`converge` 对照代码与规格报告偏差并追加剩余工作，不改写规格；人的检查点在任务生成后 |
| Kiro best practices | 规格变更走正式的 spec 会话与 Refine/Sync，不在任务执行中临时改；标准流程在需求、设计、任务之间有审阅门 |
| OpenAI《A practical guide to building agents》 | 触发人工介入的两类条件：超过失败阈值（如重试次数），高风险或不可逆动作 |
| Anthropic《Building effective agents》 | 在检查点暂停等人；工具接口要防错 |

### 问题

Controller 拥有"重新解释需求"的机器能力却没有机器约束。业界一致把"规格变更"放在人的检查点后面，Agent 只报告偏差。

### 建议设计

**一、Controller 的决定词汇删掉 `redesign`。** 实现决定：`accept | rework | blocked | escalate`。`rework` 只用于验收锚点内的代码缺陷；`blocked` 用于外部条件；`escalate` 用于"需求或方案层面的问题"。

**二、`escalate` 是一个类型化事件，Demand 进入 `awaiting-decision`。** 事件字段：问题陈述、涉及的需求章节引用、Controller 收集的证据引用、备选方案（最多 4 个，含各自影响）、建议。这个事件由 Wakeflow 渲染成一段给用户看的文字；用户在 Controller 会话里回答，或转给 Design。`awaiting-decision` 下拒绝规划与投递。

**三、决策的回流只有两条路**：小决定，用户直接回答，Controller 记录 `decision-recorded` 事件，原文进事件，任务回到 planned 或 rework；大决定，Design 发布补充需求包（带 `supersedes` 与用户确认），Controller 认领后规划替换包。两条路都留下用户的话。

**四、验收锚点必须引用需求包。** 每个 `acceptanceAnchor` 带 `requirementRef{recordDigest, sectionAnchor, itemId}` 指向需求包验收标准的一条；Wakeflow 校验引用存在。Controller 不能发明锚点，只能从需求包里选。替换包的锚点同样受此约束，所以没有补充需求包就写不出新范围。

**五、机器刹车。** 同一任务第三次 `rework` 触发自动 `escalate`，与 OpenAI 的失败阈值一致；阈值进配置 `governance`，默认 3。

**六、supersede 时机**保持能力卡 5 Q2 的"创建时"，因为替换包的前提已经改为"补充需求包已发布"，不再有静默替换的问题。

## 6. 汇总：建议的决定

| 编号 | 决定 | 取代 |
| --- | --- | --- |
| D1 | 回传是固定效果 `wake-controller`：导入结果一次调用返回回调内容与许可；接收即确认；ambiguous 有阈值出口与重发上限 | 能力卡 6 Q5 |
| D2 | 三种调用形状：读、追加（幂等键加 CAS）、效果（preview 加 apply）；每个变更结果带 `next`；投递两次、评审两次、定向一个工具、`response_format` | ADR-0004 补充 |
| D3 | 完成即归档：一个动作三份记录，verify 报告入归档包；bug 需求包三段式快速路径 | 能力卡 4、8、9 的完成与归档条目 |
| D4 | 测试合同并入 test 任务包；逐步记录对比与 approved 基线；失败分类字段与机器路由；只跑失败子集；测试决定三个 | 能力卡 5 的测试卡、能力卡 7 Q4 Q5 |
| D5 | 删除 `redesign`；`escalate` 事件与 `awaiting-decision` 状态；验收锚点必须引用需求包；第三次返工自动升级 | 能力卡 7 Q3 Q4、能力卡 4 Q1 |

## 来源

- Anthropic, Building effective agents. https://www.anthropic.com/engineering/building-effective-agents
- Anthropic, Writing tools for agents. https://www.anthropic.com/engineering/writing-tools-for-agents
- Claude Code, Sub-agents. https://code.claude.com/docs/en/sub-agents
- Claude Code, Hooks reference. https://code.claude.com/docs/en/hooks
- Codex, Hooks. https://learn.chatgpt.com/docs/hooks
- Stripe, Idempotent requests. https://docs.stripe.com/api/idempotent_requests
- HashiCorp, Terraform plan and apply. https://developer.hashicorp.com/terraform/cli/commands/plan
- Cucumber, Gherkin reference. https://cucumber.io/docs/gherkin/reference/
- Approval Tests. https://approvaltests.com/
- Kiro, Bugfix specs. https://kiro.dev/docs/specs/bugfix-specs/
- Kiro, Specs best practices. https://kiro.dev/docs/specs/best-practices/
- GitHub Spec Kit. https://github.com/github/spec-kit
- OpenAI, A practical guide to building agents. https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf
