# 能力组 3：需求入口与 TODO 板

> 状态：`confirmed`，Q1 到 Q7 于 2026-09-04 全部按建议裁决，记录见文末"确认记录"
> 建立日期：2026-09-03
> 旧实现基线：`core/`、`plugins/*` 于 `c0098e2`
> 上位文档：[docs/plan/typescript-reimplementation-plan.md §8.1 P0](../../plan/typescript-reimplementation-plan.md)、[standards/resource-handling-standard.md RH-1](../../standards/resource-handling-standard.md)、[ADR-0008](../../decisions/0008-discard-legacy-and-new-version-series.md)
> 说明：本组有相当部分已在 TS 的 RH-1 与 A3 到 A6 纵切中重切并实现。卡片同时记录旧场景、旧实现的真实缺口与 TS 现状，问题只针对仍未裁决的产品语义。

## 3.1 Ledger 需求记录与确认记录

**场景**：Design 窗口把需求设计沉淀成可移植、不可变的记录，放进 ledger 根；用户对目标与阶段的确认也沉淀成记录；Demand 引用这些记录的成员作为权威，之后任何人都能校验引用未被篡改。

**旧实现**：

- 三个 family：`requirement`、`confirmation`、`archive`。记录文件 `record.json` 加成员文件，目录 `<ledger>/requirement-designs/<requirementId>/`、`goal-stage-confirmation/<confirmationId>/`。`wakeflow-ledger-records.mjs:38-42`、`:573-593`。
- requirement 必填 `requirementId`、`programId`、`title`、`status: confirmed`、`documents`，可选 `relatedDemandIds`；confirmation 额外必填 **`demandId`**。`:482-485`、`:523-526`。
- 成员角色：requirement 13 种，confirmation 4 种，记录层不要求任何角色，角色义务在 Demand authority 校验时才执行。`:55-76`、`:329-333`。
- 成员形状 `{role, path, mediaType, digest}`，路径可移植、不嵌套、不重复；加载时逐成员重新散列比对，记录字节必须是规范 JSON 加一个换行，目录里任何多余文件即失败。`:336-364`、`:1010-1025`、`:998-1008`。
- 创建一次即不可变：stage 加同目录 rename，同 id 不同字节即冲突；ledger 级锁 `<ledgerRoot>.ledger-lock`。`:1722-1813`、`:598-609`。
- **旧体系没有任何工具、脚本或服务创建 requirement 或 confirmation 记录。** 布局描述符里命名的 `requirement-promotion-service` 与 `confirmation-service` 不存在；`createLedgerRecord` 的唯一生产调用方是归档。Design 技能又明确禁止 Design 触碰 ledger。结论是旧体系里带 authority 的 Demand 只能靠手工在磁盘上写规范 JSON。`wakeflow-layout-descriptor.mjs:424-472`、`wakeflow-business-archive-service.mjs:3004`、`wakeflow-design/SKILL.md:88-91`。
- 成员引用 9 个字段：`family`、`recordId`、`recordRef`、`recordDigest`、`memberRef`、`memberDigest`、`role` 等，解析时重载记录并复验全部摘要。`:1842-1880`、`:1923-1963`。

**不变量**：可移植引用，无绝对路径；摘要链记录到成员到引用；ledger 目录严格闭合，任何杂散文件让整个 ledger 投影失败并使 status 与 verify 降级为 unavailable。

**宿主差异**：无。

**现 TS 状态**：`wakeflow_publish_requirement` 与 `wakeflow_publish_confirmation` 已公开，preview 输入为 `{title, designSurfaceId, documents[{role, path}]}`，apply 与 recover 走 plan 加摘要；记录 schema 增加 `recordedAt`；成员引用 schema 11 字段，含 `memberPath` 与 `mediaType`；confirmation 记录仍必填 `demandId`，由发布规划在确认时**预先分配** demandId，并预留该 Demand 的最终根与 stage 引用。

**实现判断**：记录成员文本加入与证据相同的隐私扫描；`supporting-evidence` 角色允许被 Demand 作为非必需引用；`archive` family 的 `documents` 与 `todo` 两种 archiveKind 放弃，只保留 `demand`。

**待确认**：

- Q1 谁调用发布工具：Design 窗口 Agent 调用 `publish_requirement`，Controller 调用 `publish_confirmation`？旧规则禁止 Design 触碰 ledger，但旧体系根本没有写入器；新体系由工具校验并写入，Design 直接调用是安全的。建议如此分工。
- Q2 confirmation 是否继续绑定 demandId：旧与现 TS 都要求，TS 用"确认时预分配 demandId"绕开先后问题。建议改为绑定 `requirementId` 与 `todoId`，Demand 创建后引用 confirmation，去掉预分配。
- Q3 记录成员文本是否加入隐私扫描？建议加入。

## 3.2 TODO 板

**场景**：Design 完成一项需求并得到用户确认后，向全局 TODO 板投递一行；Controller 巡视板子，认领一行并创建 Demand；Demand 归档时行进入历史。板子是需求进入执行前的唯一入口与认领权威。

**旧实现**：

- 权威是 Markdown 文件 `.wakeflow-active/current/global-todo-board.md`，8 MiB 上限，13 列固定顺序：ID、Status、Type、Priority、Owner、Item / Goal、Affects Retest / Dispatch、Dependency / Trigger、Recommended Window、Current Mount、Auto Claim、Testing Decision、Documents。单元格编码 `|`、`\`、换行；整板必须逐字节规范，否则整板不可读。`wakeflow-todo-service.mjs:85-99`、`wakeflow-todo-table.mjs:7-42`。
- ID 是调用方选的不透明串，不是 typed id；Status 词汇 7 个但只有 `pending-claim`、`parked`、`claimed` 有产生路径，归档直接删行；`Documents` 只是 Markdown 链接，追加时不解析目标、不绑摘要、不校验角色。`:43-62`、`:211-248`、`:1246-1252`、`:1339-1343`。
- 追加只走 `wakeflow_deliver`，认领由 `create_demand` 在状态根发布后提交，`claim_next` 的公共 claim 操作会把行写成 claimed 而没有真实 Demand 根，随后被 `publication-order` 拒绝，行被卡死。`wakeflow-demand-publication-service.mjs:586-632`、`:1695-1749`。
- 板锁 `global-todo-board.md.lock`；物理准入要求 0644、单链接、属主、三次 stat 一致；缺板从不当作空队列。`:546-636`、`:592`。
- `next_work` 只是加锁读板，不选行、不排序、不看窗口。`observability` 完全不知道 TODO，板损坏对 status 与 verify 不可见。

**不变量**：认领是行级 CAS；归档保留行的前后字节作为 `todo-history` 成员；归档谱系反推必须还原出 intake 行摘要。

**宿主差异**：无。

**现 TS 状态**：RH-1 已重切为 JSON intake 与 state 权威加 Markdown 投影，typed `todo_<uuidv4>`；`wakeflow_intake_todo` 输入为结构化 `{demandType, priority, originWindowId, summary, intakeRationale, readiness, autoClaim, testingDecision, authorityMembers[{recordId, memberPath}]}`，成员在接收时机器解析并绑定摘要；状态 `pending-claim | parked | claimed | withdrawn | archived` 带修订矩阵；`wakeflow_inspect_todo` 提供查询、过滤与分页；认领并入 `create_demand`，`next_work` 由 `inspect_demand_route` 与 `inspect_todo` 替代；集合锁、事务存储与 dead-owner 恢复已实现。

**实现判断**：旧的 `claim_next`、`deliver`、`next_work` 三个公共工具不再出现；`expectedBoardDigest` 不再是可选项，集合级 CAS 由 TS 的 collection digest 承担；旧 13 列压缩为结构化字段后，Markdown 投影只保留人读需要的列。

**待确认**：

- Q4 TODO 状态词汇按 TS 现状 `pending-claim | parked | claimed | withdrawn | archived` 定案，旧的 `blocked`、`observing`、`completed`、`cancelled` 放弃？建议放弃。

## 3.3 Demand 类型与入口权威

**场景**：Controller 从一行 TODO 创建 Demand 时，Demand 的类型决定它必须引用哪些 ledger 成员，以及测试决策的形态。

**旧实现**：

| demandType | 必需角色 |
| --- | --- |
| requirement | original-plan、requirement-design、code-facts、landing-plan、non-goals、user-confirmation |
| bug | reproduction、scope、non-goals |
| supplement | requirement-design、requirement-delta、user-confirmation |
| research | research-question、boundaries |

- 引用只允许 requirement 与 confirmation 两个 family，角色必须合法于该 family，引用唯一且按 `family、recordRef、memberRef、role` 词法排序。`wakeflow-demand-core-records.mjs:94-113`、`:551-616`。
- `testDecision {mode, summary, environmentSpecRef?}`：`real-environment` 必须引用唯一的 `test-environment` 成员；research 必须 `not-applicable`，非 research 不得 `not-applicable`。`:713-749`。
- `executionPlacement` 为 `main` 或 `isolated` 加授权引用，授权角色只能是 `goal-stage-decision` 或 `user-confirmation`。`:651-676`。
- `entryMode ∈ {design-delivery, controller-inline, pod-design}`；`authority` 可为 null，此时 Demand 永远没有权威。`:72-76`。

**现 TS 状态**：`wakeflow_create_demand` preview 输入为 `{todoId, demand}`，权威从 TODO intake 的 `authorityMembers` 单源收敛（A6），不再由调用方另传 `authorityMembers`；四种类型与测试决策词汇保留；`entryMode` 已删除，隔离位置由 Confirmation 引用授权，按 ADR-0010 改为 Demand 身份记 `podId`，同一 pod 已有活动 Demand 时创建被拒绝。

**实现判断**：角色要求表原样保留；`authority: null` 的 Demand 不再允许，intake 必须携带满足类型要求的成员；`entryMode` 不恢复。

**待确认**：

- Q5 四种 demandType 与上表的必需角色原样保留，含 research 必须 `not-applicable`？建议保留。
- Q6 `supporting-evidence` 角色允许作为 Demand 的非必需引用？旧只写不读。建议允许。

## 3.4 Design 窗口产物

**场景**：Design 窗口在支撑面里写草稿，经用户确认后发布为 ledger 记录并投递 TODO；草稿本身永远不是权威。

**旧实现**：

- 草稿目录 `<DesignSurface>/drafts/`，初始化时创建；两个模板资产 `original-plan.md`、`requirement-design.md`，带"非权威草稿"横幅；需求设计草稿章节含问题、目标与完成定义、非目标、参与者与故事、已核实的代码与文档事实、拟议行为、结果缺口与重设计触发、测试决策、验收标准、风险。`wakeflow-design/SKILL.md:59-93`、`references/requirement-design.md:44-56`。
- 投递前需要用户对目标、范围、非目标、完成证据、落地意图、测试决策、剩余决定的显式确认，再对提交本身单独确认；就绪状态六种。`references/design-handoff.md:39-58`。
- 草稿到 ledger 记录的"提升"在旧体系不存在。

**现 TS 状态**：`publish_requirement` 以 `designSurfaceId` 加 `documents[{role, path}]` 从支撑面路径发布记录，即草稿提升已由工具实现。

**实现判断**：模板资产改为 skills 内的内容，不再作为制品里的模板 bundle；`drafts/` 目录保留。

**待确认**：

- Q7 Design 支撑面的 `drafts/` 目录与两份草稿模板保留，模板移入 skills？建议如此。

## 3.5 Ledger 与活动投影

**场景**：人读的索引与状态页由权威确定性生成，任何人不得手改。

**旧实现**：四个 ledger 投影 `requirement-designs/index.md`、`goal-stage-confirmation/index.md`、`workspace/workspace-record-map.md`、`workspace/archive/index.md`，带 `<!-- wakeflow:ledger-projection:v1:… -->` 标记，按 recordId 排序，转义与单尾换行确定；部分失败时权威已提交而投影记为 stale。活动投影 `.wakeflow-active/index.md` 与 `current/workspace-current-status.md` 只链接 TODO 板，不列行。`wakeflow-ledger-projector.mjs:33-38`、`:759-845`、`wakeflow-active-projector.mjs:1039-1108`。

**现 TS 状态**：ledger 记录发布带投影；TODO 有单向 Markdown 投影；活动投影有 fresh 权威与发布。

**实现判断**：投影语义按资源处理标准的 derived-projection 角色，`deterministic-rewrite`，不引入新问题。

## 旧行为疑点

1. 没有任何写入器创建 requirement 与 confirmation 记录，权威 Demand 只能手工造记录。
2. controller 技能说引用是 Markdown 锚点，代码要求 9 字段引用对象。
3. `claim_next claim` 会把行卡死。
4. `deliver` 的 `expectedBoardDigest` 可选，技能要求的 CAS 未强制。
5. 四个板状态无产生路径。
6. `createTodoBoardIfAbsent` 无生产调用方。
7. `archiveKind` 的 `documents` 与 `todo` 不可达。
8. `supporting-evidence` 只写不读。
9. confirmation 要求 demandId 先于 Demand 存在。
10. `<br>` 编码不对称。
11. observability 完全不知道 TODO。
12. 人读文本允许 `\r` 进入表格。
13. `TODO_BOARD_REF` 常量在三处重复声明。

## 确认记录（2026-09-04）

| 问题 | 裁决 | 落点 |
| --- | --- | --- |
| Q1 发布工具调用方 | Design 窗口 Agent 调 `publish_requirement`，Controller 调 `publish_confirmation`；工具校验并写入，Design 不再被禁止触碰 ledger | skills 文本；工具 description |
| Q2 confirmation 绑定 | 改为绑定 `requirementId` 与 `todoId`，Demand 创建后引用 confirmation；去掉 TS 现有的"确认时预分配 demandId" | confirmation 记录 schema；ledger 发布规划；create_demand |
| Q3 隐私扫描 | requirement 与 confirmation 成员文本加入与证据相同的隐私扫描 | ledger 发布准入 |
| Q4 TODO 状态词汇 | 定案为 `pending-claim \| parked \| claimed \| withdrawn \| archived`；旧的 blocked、observing、completed、cancelled 放弃 | TODO state |
| Q5 demandType 与角色表 | 原样保留，含 research 必须 `not-applicable` | Demand authority 校验 |
| Q6 supporting-evidence | 允许作为 Demand 的非必需引用 | 授权角色集合 |
| Q7 Design 草稿 | `drafts/` 目录保留，两份草稿模板移入 skills | 支撑面物化；skills |

本组实现判断按卡片各节执行；旧的 `claim_next`、`deliver`、`next_work` 不再出现，`expectedBoardDigest` 由集合摘要 CAS 承担，archiveKind 只保留 `demand`。

## 修订（2026-09-04，[ADR-0011](../../decisions/0011-requirement-package-as-single-handoff.md)）

用户指出需求入口不顺畅，裁决如下，覆盖本卡先前的确认：

| 项 | 修订后 |
| --- | --- |
| Q1 发布调用方 | Design 调 `publish_requirement`，一次调用完成 ledger 记录与上板；`publish_confirmation` 删除 |
| Q2 确认记录 | confirmation family 整体取消；用户确认发生在发布前的摘要（确认点 1），写进 `requirement.md` 的用户确认节 |
| Q4 状态词汇 | 保留 `pending \| parked \| claimed \| withdrawn \| archived`，主体从 TODO 行改为需求包认领状态；`intake_todo` 删除 |
| Q5 角色表 | 六个角色文件改为 `requirement.md` 与 `landing.md` 加按 demandType 的必需章节表（ADR-0011 D3） |
| 认领 | 一个总控一次一个；取消领取一组与 `autoClaim`；板按优先级排序 |
| 词汇 | pod 不进入需求入口；并行是用户要求开启的一套开发环境（ADR-0010） |
