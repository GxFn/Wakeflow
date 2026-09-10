# 44 张图的更新登记

> 状态：逐图建议；不是重新验收通过记录。
> 基线和观察范围见 [主计划](./typescript-atlas-refresh-plan.md)；图号使用本轮固定库存的 D01–D44。
> 既有图的稳定身份为“文档路径 + block 序号 + accTitle”，保留在 [审查快照](./evidence/atlas-audit-snapshot.json) 中。重绘时用旧边 ID 的保留/退休/替代记录维持追溯，不能复用同一 ID 偷换关系。

“复核保留”表示机制可能仍成立，但来源漂移后必须重新阅读消费者与测试；不是本轮已签发 current。“目标差额”表示现行代码与 accepted ADR 分图表达。所有新当前图须同时更新来源模式、术语、节点映射、边证据及上下钻链接。

| 库存编号 | 旧文档 / 图块 | 原 accTitle | 处理 | 批次 | 核验重点 |
| --- | --- | --- | --- | --- | --- |
| D01 | [00-agentic-diagram-standard.md](../maps/00-agentic-diagram-standard.md) · #1 | 流程图生成与人工审阅边界 | 保留方法图，修订配套规则 | W1 | 增加目标设计与现状的区分；真实渲染、符号与证据检查不能只写成已实现。 |
| D02 | [01-overall-architecture/README.md](../maps/01-overall-architecture/README.md) · #1 | Wakeflow TypeScript总体架构与宿主边界 | 重画 | W2a | 六层约束、capabilities/kernel、过渡目录、21 项实际登记；最终 20 项在目标图。 |
| D03 | [01-overall-architecture/file-dependencies.md](../maps/01-overall-architecture/file-dependencies.md) · #1 | Wakeflow TypeScript MCP组合根关键文件导入关系 | 重新提取静态导入 | W2a | 两宿主组合根 → catalog/shared executors → registry/SDK → owner；删除四静态组及宿主包装文件。 |
| D04 | [01-overall-architecture/review-evidence.md](../maps/01-overall-architecture/review-evidence.md) · #1 | Wakeflow TypeScript治理骨干与公共组合技术Review提交影响 | 重建审查快照 | W5 | 旧 08334ab 证据保留历史含义；当前变化按源、合同、测试、图谱分类；与 Dashboard 输入合同一致。 |
| D05 | [01-overall-architecture/runtime-call-flow.md](../maps/01-overall-architecture/runtime-call-flow.md) · #1 | Wakeflow公共MCP进程启动与二十三工具调用时序 | 重画 | W2a | runWakeflowMcpStdio/createWakeflowPublicMcpServer/registerWakeflowPublicMcpCatalog；按实际三种调用形状下钻。 |
| D06 | [02-foundation/README.md](../maps/02-foundation/README.md) · #1 | Wakeflow TypeScript Foundation确定性能力与安全边界 | 复核保留，补边界 | W2a | 当前原语、durability 选择与真实消费者；新 kernel 职责不并入 filesystem。 |
| D07 | [02-foundation/file-dependencies.md](../maps/02-foundation/file-dependencies.md) · #1 | Wakeflow Foundation关键文件导入依赖 | 重新提取精选依赖 | W2a | 固定根、stable read、durable write、树与锁；目录收敛目标不冒充已移动文件。 |
| D08 | [02-foundation/runtime-call-flow.md](../maps/02-foundation/runtime-call-flow.md) · #1 | Foundation根作用域稳定文件读取 | 复核保留 | W2a | RootedDirectory/stable read 的根与节点复验；不把路径校验描述为操作系统沙箱。 |
| D09 | [02-foundation/runtime-call-flow.md](../maps/02-foundation/runtime-call-flow.md) · #2 | Foundation耐久原子文件替换与崩溃恢复 | 复核并补分支 | W2a | 创建的 link 与替换的 rename、提交前后 fsync、stage 退休；显式 durability 选项与权威写入区别。 |
| D10 | [02-foundation/runtime-call-flow.md](../maps/02-foundation/runtime-call-flow.md) · #3 | Foundation只创建确定性JSON资源幂等物化 | 复核保留 | W2a | create-only 幂等、完整字节复验、projection 重试与 source-changed；证据是否仍由当前测试承担。 |
| D11 | [03-configuration-workspace/README.md](../maps/03-configuration-workspace/README.md) · #1 | Wakeflow Configuration与Workspace权威及维护边界 | 重画接口，分出端点 | W2b | Config v3 仍是当前；维护入口采用原请求+planDigest；Board 初始化取代 TODO。 |
| D12 | [03-configuration-workspace/file-dependencies.md](../maps/03-configuration-workspace/file-dependencies.md) · #1 | Wakeflow Configuration与Workspace关键文件依赖 | 重新提取静态导入 | W2b | 加入 capabilities/workspace、kernel/publication-transaction；移除三处已删除文件，端点细节下钻 12。 |
| D13 | [03-configuration-workspace/runtime-call-flow.md](../maps/03-configuration-workspace/runtime-call-flow.md) · #1 | Wakeflow Config v3权威读取条件替换与恢复 | 复核保留，标目标差额 | W2b | 当前 Config v3 snapshot/CAS；配置 v1 与 pods[] 仅进入目标设计。 |
| D14 | [03-configuration-workspace/runtime-call-flow.md](../maps/03-configuration-workspace/runtime-call-flow.md) · #2 | Wakeflow Maintenance从零写入preview到可恢复transaction | 重画 | W2b | 删除 confirmation 交换；preview 零写、同请求摘要重算、owner gate/intent/journal/recover。 |
| D15 | [03-configuration-workspace/runtime-call-flow.md](../maps/03-configuration-workspace/runtime-call-flow.md) · #3 | Wakeflow Window Host Binding首次注册和Agent观察闭合 | 替换为端点摘要并下钻 | W2b | 新 endpoint 五操作、SessionStart、launchIntentDigest、替换代际和私有绑定投影。 |
| D16 | [04-governance-event-sourcing/README.md](../maps/04-governance-event-sourcing/README.md) · #1 | Wakeflow Demand事件权威与聚合重建 | 重画来源及缓存部分 | W2b | Requirement Record/Board → Demand；commit 是权威，snapshot/index 为缓存；删除 TODO/Confirmation/Auto Claim。 |
| D17 | [04-governance-event-sourcing/file-dependencies.md](../maps/04-governance-event-sourcing/file-dependencies.md) · #1 | Wakeflow Demand事件溯源关键文件导入关系 | 重新提取静态导入 | W2b | publication-package、kernel/requirement-board、stream-index 与真实当前调用方；新 Demand WIP 不混入已提交闭包。 |
| D18 | [04-governance-event-sourcing/runtime-call-flow.md](../maps/04-governance-event-sourcing/runtime-call-flow.md) · #1 | Demand业务Command从纯决策到文件Event Store追加 | 更新 | W2a | 客户端幂等绑定、预期修订、decide、固定槽位追加、refreshCheckpoints；与 AppendCommand 外壳联结。 |
| D19 | [04-governance-event-sourcing/runtime-call-flow.md](../maps/04-governance-event-sourcing/runtime-call-flow.md) · #2 | Demand Repository正常加载完整审计与不可变快照 | 更新 | W2a | 正常 load 零写、snapshot+tail、坏缓存回退、追加后刷新/退休快照和索引；audit 全量单列。 |
| D20 | [04-governance-event-sourcing/runtime-call-flow.md](../maps/04-governance-event-sourcing/runtime-call-flow.md) · #3 | 从公共preview到精确应用和Demand事件根前向恢复 | 重画来源，跟踪 Demand 切换 | W2b/W4 | requirementId 单源权威、根先建后看板 CAS；并发失败残留与恢复需真实证据。 |
| D21 | [04-governance-event-sourcing/runtime-call-flow.md](../maps/04-governance-event-sourcing/runtime-call-flow.md) · #4 | Managed Evidence内部可恢复发布与按需读取 | 复核后移交 Evidence 专题 | W4 | 保留 journal→stage→event→final→retire 顺序和当前读取边界；隐私/归档变化等 owning slice 后复核。 |
| D22 | [05-tasking-slice/README.md](../maps/05-tasking-slice/README.md) · #1 | 从Demand权威到不可变TaskPackage事件与投影 | 重画 | W2b | 公共工具为一次追加；任务章节锚点、任务清单用户过目及未来 testContract 消费范围分别标记。 |
| D23 | [05-tasking-slice/file-dependencies.md](../maps/05-tasking-slice/file-dependencies.md) · #1 | Target Task Planning关键文件依赖 | 重新提取静态导入 | W2b | capabilities/tasking → kernel/append-command → 事件与投影；旧 service 的 fixture 边不当生产边。 |
| D24 | [05-tasking-slice/runtime-call-flow.md](../maps/05-tasking-slice/runtime-call-flow.md) · #1 | Target Task Planning零写入preview | 退休旧公共 preview，替换为追加准入 | W2b | idempotencyKey、expectedStreamRevision、权威/拓扑与确定性 ID；保留旧文档地址。 |
| D25 | [05-tasking-slice/runtime-call-flow.md](../maps/05-tasking-slice/runtime-call-flow.md) · #2 | Target Task Planning公共test选择与owner派生 | 复核当前 test 派生分支 | W2b/W4 | 当前 TestCard 派生仍可存在；ADR-0012 testContract 作为独立目标替代，不提前套入。 |
| D26 | [05-tasking-slice/runtime-call-flow.md](../maps/05-tasking-slice/runtime-call-flow.md) · #3 | Target Task Planning apply和TaskPackage投影恢复 | 更新提交与恢复 | W2b | 同键重放、同键异参、commit CAS、TaskPackage 投影失败后重试与 next；去掉公共 apply 形状。 |
| D27 | [06-implementation-delivery-review/README.md](../maps/06-implementation-delivery-review/README.md) · #1 | 从TaskPackage到宿主效果TargetResult与Controller Review | 修正现状，分出目标形状 | W2b/W4 | accepted 与 indeterminate 均可经匹配 Result 关闭；当前 prepare/claim 与目标合并调用分别展示。 |
| D28 | [06-implementation-delivery-review/file-dependencies.md](../maps/06-implementation-delivery-review/file-dependencies.md) · #1 | Delivery Result与Controller Review关键文件依赖 | 重新提取精选依赖 | W4 | 当前 delivery/result/review consumers 与 endpoint seam；固定回调没有生产 owner 前不添加假调用。 |
| D29 | [06-implementation-delivery-review/runtime-call-flow.md](../maps/06-implementation-delivery-review/runtime-call-flow.md) · #1 | Target Delivery准备WorkClaim与一次性Agent Host Action | 复核当前握手 | W4 | Claim 与 Event 的顺序、首次 action、重放 action=null、绑定漂移；目标 prepare 合并另画。 |
| D30 | [06-implementation-delivery-review/runtime-call-flow.md](../maps/06-implementation-delivery-review/runtime-call-flow.md) · #2 | 宿主效果观察与TargetResult事件导入 | 修正分支并复核恢复 | W2b/W4 | indeterminate→匹配 Result→事件后释放；rejected→observed Event 后释放，禁止把不确定直接判失败。 |
| D31 | [06-implementation-delivery-review/runtime-call-flow.md](../maps/06-implementation-delivery-review/runtime-call-flow.md) · #3 | Controller Implementation TargetResult审阅决定与后续路由 | 更新入口与目标差额 | W4 | 独立检查与实现 Decision；redesign/resume 当前接线与 escalate 目标隔离。 |
| D32 | [07-review-rework-completion/README.md](../maps/07-review-rework-completion/README.md) · #1 | Controller Review返工blocked恢复与Demand完成 | 重画分责与目标差额 | W4 | 需求升级、外部阻塞、代码返工分开；完成只写终态的旧当前路径与归档改造分开。 |
| D33 | [07-review-rework-completion/file-dependencies.md](../maps/07-review-rework-completion/file-dependencies.md) · #1 | Review返工blocked恢复与Demand Completion关键依赖 | 冻结后重新提取 | W4 | Demand 切片正在替换 lifecycle/public owner；以实际 catalog/executor/consumer 决定文件节点。 |
| D34 | [07-review-rework-completion/runtime-call-flow.md](../maps/07-review-rework-completion/runtime-call-flow.md) · #1 | Controller Review rework和blocked恢复 | 分开当前与目标 | W4 | 当前 rework/resume 与目标 escalate/decision-recorded；三次返工刹车在决定器落地后核验。 |
| D35 | [07-review-rework-completion/runtime-call-flow.md](../maps/07-review-rework-completion/runtime-call-flow.md) · #2 | Demand成功完成preview和幂等apply | 随完成即归档闭合后重画 | W4 | verify 前置、终态事件、归档、看板状态、声明处理、活动根退休及各崩溃恢复点。 |
| D36 | [07-review-rework-completion/runtime-call-flow.md](../maps/07-review-rework-completion/runtime-call-flow.md) · #3 | Product Defect Remediation授权返工与重新测试 | 复核保留当前，再迁目标 | W4 | 当前 remediation/retest 谱系；测试分类/escalate 合并入口在 result-review 与 tasking 闭合后重画。 |
| D37 | [08-real-environment-testing/README.md](../maps/08-real-environment-testing/README.md) · #1 | 从Review路由到真实环境Test Result | 分开机制与验证状态 | W3/W4 | 当前 TestCard 链不等于真实宿主已验证；目标逐步记录/对比、批准基线与失败子集。 |
| D38 | [08-real-environment-testing/file-dependencies.md](../maps/08-real-environment-testing/file-dependencies.md) · #1 | TestCard Test Delivery与Dispatch关键文件依赖 | 重新提取当前并登记替代 | W4 | tasking 追加入口先更新；TestCard 删除需相应 testContract producer/consumer/测试齐全。 |
| D39 | [08-real-environment-testing/runtime-call-flow.md](../maps/08-real-environment-testing/runtime-call-flow.md) · #1 | TestCard规划Test TaskPackage和Test Delivery授权 | 修正 TaskPackage 调用形状 | W2b/W4 | Card preview 可保持当前，Task 规划为 append；目标统一测试合同另列。 |
| D40 | [08-real-environment-testing/runtime-call-flow.md](../maps/08-real-environment-testing/runtime-call-flow.md) · #2 | Test Dispatch Claim真实环境执行与Test Result | 补不确定结果路径，后续重切 | W2b/W4 | Claim/Result 恢复、Controller 检查；Stop 完成证据及步骤 verdict 未接通前仅在设计图。 |
| D41 | [09-public-mcp-host-seams/README.md](../maps/09-public-mcp-host-seams/README.md) · #1 | Wakeflow公共MCP控制平面与Agent宿主效果平面 | 重画 | W2a | 真实 registry 与 21 工具；删除 TODO/Confirmation；端点新能力与纯数据 profile/Agent 动作分责。 |
| D42 | [09-public-mcp-host-seams/host-effect-handshake.md](../maps/09-public-mcp-host-seams/host-effect-handshake.md) · #1 | Wakeflow Agent宿主效果提交执行观察握手 | 修正当前，另画通用目标握手 | W2b/W3 | 新增 indeterminate 的匹配结果出口；注册 hook 已接通，投递/回调 hook 目标逐项标消费状态。 |
| D43 | [10-end-to-end-business-flow/README.md](../maps/10-end-to-end-business-flow/README.md) · #1 | Wakeflow从需求进入到实现返工条件测试和完成的端到端业务流程 | 重画为当前可达主线 | W2b/W4 | 两文档需求包、看板、task append、indeterminate Result、条件 Test 和冻结时点完成边界。 |
| D44 | [10-end-to-end-business-flow/state-and-recovery.md](../maps/10-end-to-end-business-flow/state-and-recovery.md) · #1 | Wakeflow端到端业务状态与恢复分支 | 拆为 owner 状态与恢复索引 | W4 | 看板、Demand、Target、WorkClaim、Publication 分图；不画第二个全局状态机，内部 cancel 与公开入口分开。 |

## 不在图块库存里的三个入口文档

| 文档 | 更新安排 |
| --- | --- |
| maps/README.md | 本轮加入过期提示；W5 重建当前覆盖矩阵与阅读顺序，历史叙事移出首页主阅读区 |
| maps/01-diagram-review-ledger.md | 本轮标 stale；W5 按每图的文件、符号、测试、未执行项重建，不沿用旧“通过”记录 |
| 10-end-to-end-business-flow/review-evidence.md | W5 将旧全量测试和候选制品计数绑定历史基线；当前证据按场景、机理测试、宿主实跑分别记载 |

00 标准中的方法图已经计入 D01。上述三个入口合计为无图文档，所以库存总计仍为 33 份文档、44 图。

## 每图交付回执

| 字段 | 要求 |
| --- | --- |
| 身份与问题 | 保留/替代的旧图身份；新图只回答的一个问题 |
| 事实类型 | 当前代码、进行中工作树、目标设计、历史；不得混作同一条调用链 |
| 来源 | 相对路径、owner/符号、快照提交与内容指纹；目标边使用 ADR 条款 |
| 变化 | 哪些节点/边保留、退休、新增；为什么 |
| 覆盖 | 正例、拒绝例、并发或恢复例，以及未运行的宿主边界 |
| 阅读验证 | 语法渲染、术语、状态文字、默认视口、缩放、证据定位及上下钻 |
| 结论 | 可恢复 current、继续 in-progress、或保留 stale；不能只给“脚本通过” |
