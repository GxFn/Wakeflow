# TypeScript 架构图谱差异核对与流程图更新计划

> 状态：建议方案；本轮完成审查、证据留存与过期标识，尚未重绘业务图。
> 日期：2026-09-04（America/Los_Angeles）
> 代码基线：`0ac416e0b0defb5d94c2a9793ee70f54a231894f`，L1 requirement 已提交。
> 工作树观察：2026-09-05T03:08:44Z；Demand 切片正在修改 Schema 与事件合同，未视为完整实现。
> 范围：仅 `wakeflow-architecture-atlas/`。Wakeflow 代码、Schema、测试和开发计划是只读依据。

## 1. 结论与更新策略

图谱需要按业务能力重新组织并逐图核验。仅替换文件名、工具数量或来源摘要，无法修正已经变化的调用形状、权威来源和恢复路径。

建议先恢复“当前”的可信含义，再更新已经稳定的实现图，随后建立与当前图分开的目标设计视图。正在开发的 Demand 归档、取消、继续和升级能力，在生产者、消费者、公共接线及测试闭合前，只登记进行中边界。旧图中的有效机制继续复核复用，避免把 44 张图全部无差别重画。

本计划的完成对象是图谱。它不批准新的 Wakeflow 产品行为，不替代现行开发计划，不改变 L0/L1/L2/L3 的开发顺序，也不要求源代码迁就图形。

### 机器检查快照

| 项目 | 本轮实测 | 含义 |
| --- | ---: | --- |
| maps 文档 | 33 | 本轮修改前的库存 |
| Mermaid 图 | 44 | 逐图库存见配套登记表 |
| 带来源指纹的文档 | 30 | 30 份全部漂移，且都仍标 `current-code` |
| 标为当前的元数据页 | 31 | 另含没有来源指纹的旧逐图审阅台账 |
| 已删除源码的图内引用 | 11 处 | 检查器可识别的文件名引用；不是全部失效符号数量 |
| 可解析的直接导入检查 | 225 | 本轮这些关系未报错；另有 94 条被跳过，不能算验证通过 |
| 找到证据编号的边 | 897 | 只证明附近出现编号，不证明调用、状态转换或测试结论成立 |
| 当前已注册公共工具 | 21 | 从当前登记表及三个切片登记项核对；与旧图的 23 工具不同 |
| 已提交 / 观察工作树的 Schema | 106 / 114 | 后者含 Demand 切片未提交增量；数字碰巧与旧图相同也不表示合同相同 |

原始结果：[刷新前检查](./evidence/atlas-check-before.json)、[逐文档与逐图快照](./evidence/atlas-audit-snapshot.json)。快照保存旧指纹、当时内容摘要、图块摘要、边编号和工作树路径；不保存源码正文或私有运行时数据。

### 事实使用规则

| 对象 | 本轮采用的依据 | 图中处理 |
| --- | --- | --- |
| 已接通实现 | 生产源码、实际公共登记、消费者与测试 | 当前实现图；标核验基线 |
| 未提交改造 | 当次工作树差异及已存在代码 | 进行中；写明已出现的合同和缺失接线 |
| 已确认目标 | accepted ADR、已确认能力卡、现行计划的约束 | 单独的目标设计图；边引用决策，不冒充函数调用 |
| 尚未裁定的实现判断 | 进度日志记录的判断与残余问题 | 待实现所有者定案的接缝；不补画为确定流程 |
| 旧图与旧 JS | 固定提交的历史证据 | 仅用于解释取舍和比较 |

“图谱阅读深度 L0–L5”和“开发计划 L0–L3”不是同一维度。界面与新图统一写成“阅读深度”及“开发阶段”，避免混淆。

## 2. 具体不一致与处理决定

定位以“仓库相对路径 + 符号 / 图号”为主。已删除文件保留为文字证据，不制造失效 Markdown 链接。

| 编号 / 优先级 | 图谱当前表达 | 代码或规划证据 | 更新决定 |
| --- | --- | --- | --- |
| A01 / P0 | 30 份漂移文档及旧台账仍标当前，基线主要为 `08334ab`，部分为 `d17602e` | 本轮严格检查；HEAD 已为 `0ac416e` | 本轮将 31 页标为待复核，保留旧基线、日期和指纹；重审后逐页恢复状态 |
| A02 / P0 | 01、09、10 包仍画四个静态 MCP 注册组、23 工具，并声称没有 registry | `src/entrypoints/wakeflow-public-mcp-catalog.ts#WAKEFLOW_PUBLIC_TOOL_CATALOG`、`src/kernel/tool-registry.ts#createWakeflowToolCatalog`、两宿主组合根 | 重画登记表 → SDK 注册 → executor → 切片 / 过渡 owner；说明静态工具登记表不持有业务状态 |
| A03 / P0 | 总体架构主要按 foundation/configuration/workspace/governance 组织，没有 kernel 与 capabilities 的实际职责 | `.dependency-cruiser.cjs`、`src/kernel/`、`src/capabilities/`、ADR-0013 | 当前图呈现六层约束及过渡旧目录；目标图呈现最终六层。63 个 Foundation 文件尚未物理收敛，不能画成已经只有 14 个原语文件 |
| A04 / P0 | Requirement / Confirmation → TODO Intake / Inspection → Demand；Auto Claim 被写成后续缺口 | `capabilities/requirement/service.ts#executeRequirementPublicationRequest`、`kernel/requirement-board.ts`、ADR-0011 | 改为两文档需求包 → ledger 记录 + 看板认领状态 → create_demand；删除当前链中的 confirmation、intake_todo、inspect_todo、Auto Claim |
| A05 / P0 | 05 包仍从公共 preview、exact plan、apply 进入 `TargetTaskPlanningService` | `src/capabilities/tasking/plan-target-task.ts#executeTargetTaskPlanningPublicRequest`、`kernel/append-command.ts`、`tests/capabilities/tasking/plan-target-task.test.ts` | 公共路径改为一次追加：幂等键 + 预期流修订 → 准入 → 提交 → 投影 → next。仍被 fixture 使用的旧 Service 放入测试依赖说明 |
| A06 / P0 | 03 包 Maintenance 要求 confirmation / confirmationDigest | `capabilities/workspace/maintain-workspace.ts`、`kernel/publication-transaction.ts#runPublicationTransaction`、进度 §13.72 的确认记录 | 改为同一请求 + planDigest，服务端重算；恢复用 operationId。初始化前 preview 零写，不画一个尚不存在的磁盘 planRef 存储 |
| A07 / P0 | Binding 图只说明首次注册和后续 Agent 观察，漏掉 hook、替换、退役及恢复出口 | `capabilities/endpoint/service.ts#executeWindowBindingRequest`、`decide.ts#decideEndpointCommand`、`kernel/hook-observations.ts` | 独立端点文档包；覆盖 inspect/register/replace/decommission/release-claim、SessionStart 与根匹配、Claude 定位器和证据分级 |
| A08 / P1 | 04 包快照仅由显式策略发布，缺少提交后的刷新、索引和客户端幂等键 | `demand-event-sourcing-command-handler.ts#executeDemandEventSourcingCommand`、`repository.ts#refreshCheckpoints`、`kernel/event-stream/stream-index.ts` | 补同键同摘要重放、同键异参拒绝、追加后刷新检查点；正常 load 仍零写，缓存损坏回退。不要把索引升格为事件权威 |
| A09 / P0 | E-D0-09 写“accepted 才准入 Report”；H1、Z0、Z1 把 indeterminate 画成永久停止 | `tests/governance/result/target-result-import-service.test.ts` 的“indeterminate transport可以由真实TargetResult关闭工作Claim”；结果导入与聚合准入 | 当前图补“匹配结果到达 → Result Event 提交 → 精确释放声明”。禁止自动重发仍成立；传输不确定不等于结果永远不可准入 |
| A10 / P0 | Z1 把看板、Demand、任务、Review 读模型、Test 和传输放在一张 stateDiagram 中，并画公共链不可达的 cancel | `demand-aggregate-state.ts`、看板内核、WorkClaim store、公共登记表 | Z1 改为总索引；耐久状态按 owner 分图，跨 owner 顺序用时序图。内部转换与公开入口分别标明 |
| A11 / P1 | 07/08 把当前 TestCard、redesign、Resume 等形状作为长期主线 | ADR-0012 D4/D5；当前登记仍有旧入口，Demand 事件合同正在修改 | 当前图保留真实可达路径；目标图另画 testContract、逐步 expected/observed、分类、escalate 与 decision-recorded，不提前替换当前调用边 |
| A12 / P1 | 10 包把完成后归档仅列为无 owner 的远期缺口，未表达已确定的完成即归档方向 | ADR-0012 D3；进度 §13.79；新增未提交 archive/cancel/continue Schema，catalog 尚未接入这些工具 | 标“目标已确认、Demand 切片进行中”；正式时序等待 service、事务恢复、公共入口和场景共同闭合 |
| A13 / P1 | 缺少完整窗口组 Pod、固定 wake-controller 回调及最终 status/verify 的设计导航 | ADR-0009/0010/0012/0013、能力卡 6/9/10 | 增加单独目标流程与缺口矩阵；Pod 不进入需求入口概念，回调送达不等于 Controller 接受 |
| A14 / P1 | 审阅页和台账反复把 1023 测试、114 Schema、823 模块等当当前；阅读器称 Review 控制台可用 | `review-dashboard.ts#mountReviewDashboard` 要求的三个表/标题在当前 `01-overall-architecture/review-evidence.md` 中不存在，会直接返回 false | 历史数字保留在历史核验记录；建立当前快照表和固定解析合同，缺表显示未核验，不能静默隐藏 |
| A15 / P0 | 首页状态写死，且公共调用卡还写“三个工具处理器”；Dashboard 默认把非 stale 全称当前快照，并可因没匹配到“未运行”而说审阅门闭合 | `src/main.ts#renderHome/statusLabel`、`review-dashboard.ts#snapshotLabel` 和 releaseGateOpen 逻辑 | 首页、导航、右栏共用文档状态；缺证据只显示缺证据；阅读器不派生产品验收或发布结论 |
| A16 / P1 | 检查器结果的 verified 容易被解读成图义、符号和渲染均已验证 | `scripts/check-atlas.mjs` 实际为正则、邻近编号集合和指纹；没有 Mermaid 解析/渲染、符号解析、证据行唯一性验证 | 分开报告“语法/引用/静态导入/语义人工复核/运行验证”；补真正可执行的门，未实现门显式标未执行 |
| A17 / P1 | 多包来源模式没有 kernel/capabilities；refreshTriggers 不参与指纹；3 条已删除精确 sourcePaths 被 glob 静默漏掉 | 本轮快照 unmatchedPatterns；check-atlas.mjs 的 patterns 只合并 sourcePaths/schemaPaths/testPaths | 为每包重新计算真实源闭包；精确路径无匹配报错；设计文档和维护规则纳入对应刷新输入，避免以后只改新切片却不触发刷新 |
| A18 / P2 | README 宣称唯一 FigJam 与 HTML 对应当前图谱；其记录基线仍是 `08334ab` | 本仓 README 的派生视图说明；本轮未访问在线 FigJam | 最后刷新同一派生视图。在线内容状态记未核验，不根据 README 推断在线板已更新 |

### 需要从当前图中退休的文件引用

- 四个 `wakeflow-public-mcp-{workspace,authority,execution,review}-tools.ts`。
- `codex-wakeflow-window-host-binding.ts`、`claude-code-wakeflow-window-host-binding.ts`。
- `wakeflow-maintenance-public-coordinator.ts`。
- `wakeflow-window-host-binding-registration.ts`。
- `wakeflow-window-runtime-registered-projection-publication.ts`。
- `demand-event-sourcing-publication-todo.ts`。
- `target-task-planning-public-coordinator.ts`。

它们的替代关系不能一对一改名：例如 tasking 协调器的工作已分配给切片、Command Shell、AppendCommand 和事件流 owner，必须重新核对箭头。

## 3. 新的图谱组织方式

### 3.1 当前实现与目标设计分开

建议在现有 truthKind 上增加唯一新值 `target-design`，中文为“目标设计”。这是图谱元数据的建议，不是 Wakeflow 状态机字段。本轮不先修改解析器或把规划页伪标为 current-code。

- 当前实现图：引用真实文件、符号、合同和测试，未实现处只画停止点。
- 目标设计图：放在 `maps/target-design/`，只展开已接受的业务/架构决定；未来节点引用 ADR 条款，不捏造文件与函数。每个目标步骤标记已接通、进行中、待实现，并链接当前实现图。
- 未提交实现图：冻结明确的工作树输入，注明哪些只是 Schema、哪些已有 service、哪些尚未登记。
- 历史图：固定旧提交；旧结论不进入“当前”汇总。已有旧图本轮先标 stale，完成替换后再决定是否保留历史页。

目标设计图允许表达尚未实现的设计细节；当前实现图继续执行“未实现只画停止节点”的现行规则。标准、检查器、阅读器必须在同一批改动中支持这个区别。

### 3.2 保持已有下钻链接，补缺失职责

不按开发切片顺序整体重编号现有目录。保留 01–10 的链接和 diagramId；导航按业务阅读顺序组织，新增章节按实际内容加入。

| 文档包 | 更新后的主要责任 |
| --- | --- |
| 01 overall | 当前组合架构、实际目录/过渡层、登记表与本次变化；链接目标六层图 |
| 02 foundation | 文件系统与确定性原语；标明尚未完成的物理收敛，算法不因换架构名而重画 |
| 03 configuration-workspace | 初始化、配置、资源矩阵、维护事务；端点细节移交新章节，旧入口保留链接 |
| 04 governance-event-sourcing | Demand 单聚合、事件流、索引/快照和发布；需求包入口与 Evidence 深度细节分别下钻 |
| 05 tasking | 当前单次追加，以及以后需求章节锚点、replacement/continuation、testContract 的目标差异 |
| 06 implementation-delivery-review | 当前投递与结果准入；评审决定细节由 07 承担，减少重复维护 |
| 07 review-rework-completion | Review 判断、返工/外部阻塞、生命周期边界及正在改造的完成归档流程 |
| 08 real-environment-testing | 当前 TestCard 机制与测试证据；明确 fixture 验证和真实宿主验证的区别；链接目标测试合同 |
| 09 public-mcp-host-seams | 实际工具目录、输入输出边界、宿主数据/动作/证据分工；工具数从登记表取证 |
| 10 end-to-end-business-flow | 当前可达业务主线、各 owner 状态图索引、正反例及未接通边界 |
| 新增 11-kernel | Command Shell、AppendCommand、PublicationTransaction、next、工具登记、隐私/错误/上限、事件索引 |
| 新增 12-endpoint | 逻辑窗口、私有绑定、hook、定位器、替换/退役和工作声明恢复 |
| 新增 13-requirement | 两文档、确认摘要、不可变记录、章节锚点、看板 CAS、supersedes、认领接口 |
| 新增 14-evidence | 从 04 的 E3 移入 Evidence 的捕获/发布/恢复/读取专题；保留原图定位到新页 |
| 后续 15-pod | 仅在 Pod 真实 owner 和接线存在后创建当前实现包；此前只建目标设计页 |

新增包以“有真实 producer/consumer 且能回答独立问题”为条件，不先堆空文件。章节编号只作地址，不再代表开发阶段。

## 4. 重点流程图的设计规格

本节规定每张新主图要回答的问题、节点、分支和证据，不提前生成未经核验的生产调用图。

### B1 当前业务主线

- 问题：今天 Agent 从需求到哪一步能通过公共工具真实推进？
- 形式：最多 8 名参与者的时序图，或分为“需求进入”“执行与验收”两图。
- 参与者：用户、Design、Controller、目标 Agent、Test、Wakeflow MCP、账本/事件存储、宿主。
- 需求段：Design 草稿 → preview 摘要/缺项 → 用户确认 → apply 写记录并上板 → Controller 选择 requirementId → Demand 根先发布后认领。
- 执行段：tasking 单次追加 → 当前 prepare/claim → Agent 宿主动作 → outcome → target result → Controller 独立检查与决定 → 条件 Test → 当前完成边界。
- 必须画出的旁路：确认缺失零写；plan drift；认领 CAS 冲突；发送明确失败；发送不确定但匹配结果后来到达；结果已写但声明释放失败的重试。
- 当前停止点：按冻结快照的 catalog/consumer 决定。不能因工作树有 archive Schema 就把完成画成已归档。

### B2 目标业务闭环

- 依据：ADR-0011、0012、0010；独立 `target-design` 页。
- 主线：需求包确认与发布 → 认领并创建 Demand → 任务规划 → 准备投递与许可 → Agent 投递与落地观察 → 执行/结果导入 → 固定 wake-controller 回调 → Controller 检查与决定 → 条件测试 → 完成即归档。
- Pod 开启和关闭作为执行环境旁路，由 main Controller 在用户要求下组织；合并由用户在 Wakeflow 之外处理。
- 返工保持任务合同；需求/方案问题进入 escalate 和持久决定，图上显示用户回答与补充需求包两条返回路径。
- 每个目标节点旁列当前接通程度；工具集合的最终目标为 20 项。Demand 切片计划中的临时 23 项不是最终目录，也不能仅按数量判通过。

### K1 三种公共调用形状

分三张图或三个完全独立的小图：

| 图 | 需要表达的顺序 | 必须区分 |
| --- | --- | --- |
| 读 | 输入准入 → 读取事实 → 纯投影 → 脱敏/上限 → 返回 | 读取不产生业务决定；检查失败不是自动修复 |
| 追加 | 幂等键/请求摘要 → 当前上下文与预期修订 → decide → commit CAS → 派生结果与 next | 同键重放与同键异参；业务事件已提交但投影/快照失败 |
| 效果 | preview 零写 → 用户/Controller 所需确认 → 同请求和摘要 apply → 重推导 → owner 事务 → recover | 内核外壳与实际锁/journal owner；摘要不是授权令牌；并非所有工具已迁到同一形状 |

PublicationTransaction 当前把原请求当重算依据；不能按早期 ADR 的建议画一套并不存在的通用磁盘 planRef 仓库。幂等键已由事件流保存，不新增一个虚构的 idempotency-store 服务节点。

### R1 需求包与看板

- 权威图：不可变 record/member/section digests 与可变 claim state 分开；Markdown board 是投影。
- 运行图：两段确认 preview、内容确定性 ID、发布、补看板恢复、parked 激活、withdraw、supersedes。
- 状态图只画有消费者的状态边；`archiveRequirementClaim` 纯函数存在不等于 complete 已调用它。
- `taskPlanReview: user` 已入头部，投递前清单确认是否已经消费，要在 tasking 图另行核验。
- 明列 root-first 失败残留及并发认领的恢复边界；本轮已有记录提及的孤儿 Demand 根，交 Demand 实现核实，不用图上的“原子”二字掩盖。

### H1 执行端点与宿主证据

- 窗口登记、投递、关闭分别画握手，不把它们合成一个隐含宿主执行器。
- 当前登记图覆盖 SessionStart 会话/根匹配、launchIntentDigest、句柄唯一性；替换用旧 binding 摘要 CAS，旧代际退出。
- 工作声明图区分端点注意力与工作树占用；超时只开放恢复资格，时间经过不自动删除声明。
- Claude 的 pane 分类与 Codex 观察语义分别在宿主泳道解释；关闭的 machine-verified 与 manual-host-gate 分开。
- 目标投递图把 UserPromptSubmit 的落地证据和 Stop/turn-complete 的完成证据分开；实际接线前不将 hook 准入画进当前 Result 路径。

### S1 状态与恢复

把旧 Z1 拆成有明确 owner 的视图组：

1. 需求包认领状态，owner 为看板内核及获准调用它的能力。
2. Demand 生命周期与等待决定，owner 为 Demand 事件聚合；未提交字段单列。
3. Target Task 的规划、投递、结果和评审阶段，owner 为同一 Demand 聚合的任务部分。
4. WindowWorkClaim 的创建、持有、精确释放与显式恢复，说明与事件提交的关系。
5. Publication / 生命周期归档事务的 journal、提交点、回执、残留和前向恢复时序。

跨 owner 的顺序在时序图里联结；Review Snapshot 和 Markdown 不成为耐久状态节点。每个失败点写清“未提交”“已提交但投影滞后”“需要恢复”“需要用户决定”，禁止全部汇成一个 blocked 菱形。

### T1 测试与验收

- 当前图保留实际 TestCard/attempt/结果消费链，去掉“测试链通过即真实环境已验证”的暗示。
- 目标图由 testContract 给出步骤与预算；结果逐步并列 expected、observed、evidence、verdict，后续尝试对比 approved 基线。
- 失败分类和 owner 路由从 ADR-0012/能力卡 7 引用；Test 不决定新的产品目标，不修改产品代码。
- Controller 的独立检查、测试结果输入和最终接受分开；完成门需要的状态与证据逐项显示。

## 5. 必须先明确的设计接缝

这些是跨文档的语义接缝，图谱不拥有裁决权，也不因此阻塞本轮已稳定部分的更新。

| 接缝 | 已有材料 | 绘图处理 |
| --- | --- | --- |
| 回调 acknowledged 的写入归属 | ADR-0012 同时要求 inspect 是读、第一次评审读取确认回调 | 目标图标记待 owning slice 明确写入触发与记录 owner；当前只读图不暗中画追加事件 |
| 完成封流与同 Demand continue | 能力卡保留 continuation；§13.79 提出从归档恢复活动根，并注明判断可推翻 | 目标图保留“从已归档完成需求继续”的业务接口；复制、恢复、重新认领及事件序列待已实现事务核验后下钻 |
| worktree 清理责任 | ADR-0010 要求宿主原生生命周期；能力卡 8 提到清理已关闭 pod 的检出 | 本图保持 Wakeflow 意图/证据与宿主物理动作分离；不能画 Wakeflow 自行 git remove。具体清理入口由产品 owner 定案 |
| 全局观察与局部完成 preflight | 最终有 status/verify，当前 Demand 设计先内嵌一组 verify 门 | 区分内部 preflight 与已公开 verify 工具，不能用相同节点冒充同一能力 |
| 工具数与阶段 | 当前 21；Demand 设计预计临时 23；ADR-0013 最终 20 | 每个数字绑定来源与阶段；仅在 L1 全部闭合后验最终 20 项合同 |

另有上游文档漂移：docs 总索引仍写进度 §13.64、三个场景；计划 §13 的部分概述仍是早期检查点。图谱引用已接受约束和实际实现，不把这些概述机械复制为当前进度。修正上游文档由 Wakeflow 主开发维护，本任务不写入它们。

## 6. 按依赖执行的更新批次

批次编号仅表示本次图谱更新，不对应产品开发阶段。

| 批次 | 输入条件 | 具体交付 | 退出条件 |
| --- | --- | --- | --- |
| W0 证据与过期标识 | 本轮快照 | 审查报告、44 图登记、原始检查；30 漂移页及旧台账标 stale；README 明示旧图不可作当前操作依据 | 不改旧指纹/核验日期，不改变原图；改动仅在 atlas |
| W1 绘图与核验合同 | W0 | 标准、checker、阅读器共同支持 target-design；状态标签统一；声明哪些检查真正执行；补精确路径和缺覆盖诊断 | 未知/历史/进行中不显示当前；坏路径、坏符号、无证据边及 Mermaid 错误各有有效失败用例 |
| W2a 入口与内核 | 稳定 catalog、kernel 和架构规则 | 01/09 重画；新增 11-kernel；02 验证保留稳定原语 | 实际 executor 及直接导入一致；无四静态组与虚构 store |
| W2b 工作区、端点、需求包 | W2a，endpoint/requirement 已提交 | 03/04 的入口段更新；新增 12/13；05 改追加型调用；06/10 修 indeterminate 分支 | 两段确认、CAS、hook 登记、任务追加与结果释放对应真实测试；sourcePaths 覆盖新切片 |
| W3 目标设计视图 | W1，accepted ADR 与能力卡 | 目标六层、目标业务闭环、回调、测试合同、Pod 与观察；目标/现状差额表 | 每条目标边可指向已接受决定；未决接缝明确；不冒充生产调用证据 |
| W4 生命周期与后续切片跟进 | 相应代码/公共入口/测试闭合，独立于 W3 | 按 Demand → tasking → delivery → result-review → evidence → pod → observation 更新当前图，完成 S1 分图及 14/15 专题 | WIP 不自动晋升；每批移除已被替代的当前流程，并保留旧地址导向 |
| W5 集成与视觉验收 | 当前图和目标图内容分别稳定 | 更新 maps 索引、逐图台账、README、首页、Review 控制台；完整渲染和阅读验证 | 严格 current 门无漂移；全部图语法/术语/证据合格；阅读器状态和内容一致 |
| W6 派生视图 | W5，并具备外部写入授权 | 从 maps 刷新现有唯一 FigJam 与需要的导出；不新建平行事实源 | 对照同一快照核对三张摘要视图；记录未验证的在线范围 |

依赖顺序：W0 → W1 → W2a → W2b；W3 在 W1 后可准备；W4 随产品切片推进；W5 汇合各已完成范围；W6 最后。不得为了画完最终闭环而等待所有产品能力实现，已确认目标可以先在独立设计视图交付。

每批至少检查一条成功链、一条拒绝链和一条适用的恢复链。与该图无关的重复测试无需重跑；测试记录必须写明它验证了哪一层。

## 7. 检查器与阅读器的具体更新要求

### 检查器

1. 采用 atlas 自己声明的 SWC 解析依赖，与根仓库现用版本对齐；读取源码但不导入根构建输出。本地 TypeScript 7.0.2 实测没有 createSourceFile API，不能把旧 compiler API 方案直接写成可执行计划。
2. F0 以完整仓库相对路径为节点身份；basename 只展示。service.ts/contract.ts/decide.ts 的同名文件不能静默落入 skipped。
3. 静态 import 和符号存在分别检查；运行时是否调用、调用顺序和授权含义仍需人工核实。不能用 AST import 结果自动签发 F1 语义结论。
4. 精确 sourcePaths 不存在必须失败；glob 的允许空范围需显式解释。重新登记 kernel、capabilities、entrypoints、相关 Schema/测试与已接受设计文档的刷新依赖。
5. 每个图块独立匹配术语表、唯一边 ID、唯一证据行；未编号的非装饰边也必须报告。分组范围写法不能吞掉证据缺口。
6. 使用锁定 Mermaid 版本执行解析与实际渲染；当前 typecheck/build 不证明 Mermaid 44 图能渲染。
7. 用逐图登记中的问题覆盖验收，退休图有替代去向即可；文档数≥33、图数≥42 不再承担覆盖质量证明。
8. 输出分项状态：通过、失败、未执行、人工待核验；旧 verified 字段不再将“编号出现”表述为语义通过。
9. 核验前后复查输入摘要，若主开发在过程中修改相关文件，整个受影响快照标 stale，不能拼接两次读取结果签发 current。

### 阅读器

- 首页卡、导航和右栏读取同一 truthKind；显示 target-design；未知类型不默认当前。
- Review 控制台的来源表与页面建立明确解析合同；标题或表缺失时给出提示，不能静默消失。
- 显示核验快照日期、代码基线、工作树范围、实际检查与未执行项；不把历史数值伪装成实时 Git 或运行状态。
- 发布就绪、业务验收不由“未发现未运行字样”推断；仅展示来源明确记录的结论与适用范围。
- 深链保持稳定；迁出旧章节的图有替代链接。节点全文搜索支持 kernel、capabilities、Requirement、Endpoint 和新的工具名。

## 8. 验收与本轮结果

### 后续逐图验收

- 每张图只回答一种关系问题：导入、调用、状态、恢复或设计。
- 每条 current 调用边有真实 producer、consumer、符号使用点；状态边由 event/decider/reducer 和测试互证。
- 目标边有 ADR/能力卡依据；进行中边界包含未闭合项。
- 每图有中文 accTitle/accDescr、紧邻术语说明与边证据表。
- 超过 15 节点 / 20 边的主图提供分区或下钻；时序参与者不超过 8 或明确分组。
- 浏览器检查默认阅读、全图、缩放、深浅主题、证据定位和下钻链接；不能用 Vite build 代替视觉检查。
- 图谱通过不表示 Wakeflow 发布、真实宿主投递、线上 FigJam 或产品验收通过。

### 本轮实施范围

本轮只保存本计划、逐图安排与审查快照，修正过期状态和入口说明。Mermaid 图正文、旧来源指纹、旧核验日期均保留；未修改 Wakeflow 源码、Schema、测试、开发计划、插件或在线 FigJam。

| 检查 | 本轮结果 | 说明 |
| --- | --- | --- |
| Atlas typecheck | 通过 | `npm run check` 中先执行并成功 |
| Atlas build | 通过 | 单独运行构建；保留原有 chunk 大小警告，不将构建当作 Mermaid 渲染验收 |
| 严格 `npm run check` | 未通过 | 30 份指纹仍旧，11 处删除文件引用仍在；本轮有意保留原图待后续重绘，没有刷新摘要绕过门 |
| `npm run check:structure` | 未通过 | 31 页已降级待复核；结构门剩余 11 处删除文件引用，不再有“漂移但标当前”错误 |
| 计划与元数据专项核验 | 通过 | 44 图正文摘要未变，31 页旧基线/日期/指纹保留，44 行更新登记无遗漏，74 个文档链接有效 |
| 根仓库 `npm test` | 未通过 | 在 typecheck 阶段失败，涉及并行开发中的 Demand 合同、archive/verify helper 及旧消费者；未运行后续根测试，不修本任务范围外源码 |
| `git diff --check` | 通过 | 图谱修改与新增文件另做尾空白检查 |
| 浏览器全图视觉 / 真实宿主 / 在线 FigJam | 未执行 | 本轮未重绘图形、未改阅读器、未操作宿主或在线图板 |

完整结果见 [验证摘要](./evidence/validation-summary.json)、[严格检查后快照](./evidence/atlas-check-after.json)、[结构检查后快照](./evidence/atlas-structure-after.json)、[图正文与计划核验](./evidence/plan-validation.json)。原始刷新前结果保留。

**观察边界补记：** 主开发在本轮审查后继续推进，验证时已经出现 `src/capabilities/demand/archive.ts` 和 `verify.ts` 等未提交 helper。本报告的库存数字绑定开头的固定观察时点；helper 文件出现不代表生命周期公共接线和恢复测试已经闭合。后续 W4 必须重新冻结源码与工作树范围。

## 9. 依据入口

- [图谱局部规则](../AGENTS.md)、[绘图标准](../maps/00-agentic-diagram-standard.md)。
- [开发计划](../../docs/plan/typescript-reimplementation-plan.md)。
- [ADR-0004 工具目录](../../docs/decisions/0004-mcp-tool-catalog-size.md)、[ADR-0005 快照](../../docs/decisions/0005-demand-event-stream-read-path.md)。
- [ADR-0009 端点握手](../../docs/decisions/0009-execution-endpoint-and-host-effect-handshake.md)、[ADR-0010 Pod](../../docs/decisions/0010-worktree-isolated-execution-and-converged-flow.md)。
- [ADR-0011 需求包](../../docs/decisions/0011-requirement-package-as-single-handoff.md)、[ADR-0012 流程收敛](../../docs/decisions/0012-flow-convergence-callback-calls-testing-redesign.md)、[ADR-0013 架构](../../docs/decisions/0013-target-architecture-and-slice-plan.md)。
- [能力映射矩阵](../../docs/references/capability-map.md)、[场景清单](../../docs/references/scenario-acceptance.md)、[进度记录](../../docs/progress/consolidation-gate-log.md)。
- [44 图更新登记](./diagram-refresh-register.md)。
