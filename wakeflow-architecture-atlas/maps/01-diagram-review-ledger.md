---
diagramId: ts-atlas-review-ledger
viewType: review-ledger
truthKind: current-code
reviewDepth: L5
verifiedAt: 2026-09-01
snapshotObservedAt: 2026-09-01T06:42:28-07:00
baselineCommit: d17602ed9931a1898f713c740752c54b94bd8086
audience:
  - maintainer
  - reviewer
documentationOwner: Wakeflow Source Maintenance
generatedBy: manual-review
---

# 43张流程图逐图代码审阅台账

> 本台账记录图与当前TypeScript、Schema、直接调用方和测试之间的审阅结果。它不是运行状态权威。
> 当前基线是已提交的`d17602e`；任何后续来源变化仍必须重新核验，不能只刷新摘要。

## 审阅判定

| 判定 | 含义 |
| --- | --- |
| 通过 | 图的关系类型、方向、状态和停止边界已按当前稳定来源核对 |
| 已修正 | 已发现并修正文档语义或直接依赖错误；仍需在最终源码快照刷新指纹 |
| 待收敛复核 | 来源正在变化或根门未闭合；不得签发“当前”状态 |

## 逐图结果

| 文档包 | 图 | 判定 | 本轮代码审阅结论 |
| --- | --- | --- | --- |
| 00 | 生成与人工审阅边界 | 通过 | 自动导入、人工调用、状态与测试证据仍应分面；新增直接import机器核验 |
| 01 | A0 总体架构 | 已修正 | 公共面为17工具；710模块/4967依赖、99 Schema与902测试闭合 |
| 01 | F0 MCP组合根依赖 | 已修正 | 双宿主固定组合同一17 executor集合，宿主差异仍只在固定facade |
| 01 | D0 变更影响 | 已修正 | `d17602e`提交完整治理骨干；Atlas保持独立只读子项目 |
| 01 | V0 公共MCP调用流 | 已修正 | Route先选择owner，17工具覆盖现有Demand到Completion主链 |
| 02 | B0 Foundation全景 | 已修正 | 活跃范围为10条路径；补入Runtime Schema安全`uniqueItems`与UTC纳秒投影 |
| 02 | F2 Foundation依赖 | 已修正 | `directory-tree-candidate-plan`实际导入`canonical-json-sha256`，不是直接导入`canonical-json` |
| 02 | C0 稳定读取 | 通过 | 根/路径/handle前后复验、精确有界读取与摘要顺序符合源码 |
| 02 | C1 原子替换与恢复 | 通过 | 写前stage恢复、rename提交点、fsync与最终回读顺序符合源码 |
| 02 | C2 只创建JSON | 通过 | target-exists只转为current候选，完整重读不等即冲突且绝不覆盖 |
| 03 | W0 Config/Workspace全景 | 通过 | Config、Maintenance intent/journal、Binding和投影权威保持分离 |
| 03 | F3 Config/Workspace依赖 | 通过 | 38条可解析具体导入成立；共享协调与Agent观察保持内部能力 |
| 03 | R0 Config CAS | 通过 | snapshot不是租约，替换在专属短锁内重读完整source |
| 03 | R1 Maintenance事务 | 通过 | preview零写、exact confirmation、intent/journal及operation恢复顺序成立 |
| 03 | R2 Binding注册 | 通过 | 私有Binding先提交，投影失败不回滚；Agent观察再与当前Binding闭合 |
| 04 | G0 Demand事件权威 | 已修正 | 14个Event家族与Commit权威成立；TODO顺序为先发布根、再CAS claim |
| 04 | F4 Demand依赖 | 已修正 | Upcaster直接依赖Persisted Event Envelope与codec，不直接依赖Stored Event门面 |
| 04 | E0 Command/Append | 通过 | 决策、Prepared Commit与固定sequence追加模型成立 |
| 04 | E1 Snapshot/Audit | 已修正 | load可fallback，audit从Commit 1；Aggregate使用currentTestCard并保留历史缺陷Target |
| 04 | E2 Demand Publication | 已修正 | 精确顺序为发布Demand根/revision 1后claim TODO，而非先claim后发布 |
| 05 | T0 Task Planning纵切 | 已修正 | 公共路径支持implementation和owner派生的test变体 |
| 05 | F5 Tasking依赖 | 已修正 | Test Planning Authority/Package/Card由同一Public Coordinator真实消费 |
| 05 | T1 implementation preview | 通过 | Controller提供完整implementation package内容 |
| 05 | T1B test派生分支 | 已修正 | 公共请求只提供`workType:test`，其余字段由当前TestCard派生 |
| 05 | T2 apply/投影 | 已修正 | Command Handler只执行一次；此前图中预检和执行画成两次调用 |
| 06 | D0 Delivery/Review主链 | 已修正 | Preparation、Claim/Outcome/Rearm、Result与Review均有公共owner |
| 06 | F6 Delivery/Review依赖 | 已修正 | Preparation经Preparation Authority；Claim Service导入并生成Action，原箭头方向错误 |
| 06 | D1 Claim/Action | 已修正 | Claim文件先于Event，只有首次committed回执签发Action |
| 06 | D2 Outcome/Result | 已修正 | rejected在observed Event后释放Claim；accepted在Result Event后释放；indeterminate保留 |
| 06 | D3 Implementation Review | 已修正 | Inspector、Decision、共享Resume和Route均已公开且保持Controller判断边界 |
| 07 | L0 Rework/Completion | 已修正 | 普通返工、产品缺陷返工、两种Completion与双workType Resume闭合 |
| 07 | F7 Review/Lifecycle依赖 | 已修正 | Authorization Event、Service、Delivery context与retest consumer均成立 |
| 07 | L1 rework/resume | 已修正 | Preparation Authority从完整历史加载Decision/Result后创建context，不是Controller直接调用 |
| 07 | L2 Completion | 已修正 | controller-only与real-environment均可完成；后者保留currentTestCard及历史Target lineage |
| 08 | X0 Testing纵切 | 已修正 | Card、Test Task、三种Delivery、Result、Review与product-defect retest闭合 |
| 08 | F8 Testing依赖 | 已修正 | 共享Claim Service导入Test Claim Authority与Action；此前Action→Service方向误导 |
| 08 | X1 Card/Task/Delivery | 已修正 | Test Task Planning已由公共工具按Route准入；attempt最多10次 |
| 08 | X2 Claim/Result/Review | 已修正 | 补齐Claim释放及accept→Completion、another→rerun、blocked→Resume路由 |
| 09 | H0 公共MCP/宿主平面 | 已修正 | Binding请求确实接收raw handle；原值只入0600权威，不进入输出/投影/Event/Action |
| 09 | H1 Agent效果握手 | 已修正 | Claim/Outcome/Rearm公共工具记录Wakeflow事实；Agent仍独占宿主效果执行 |
| 10 | Z0 端到端业务 | 已修正 | 现有Demand从Route到Completion公共闭合；Demand创建、Research/Redesign与Archive仍停止 |
| 10 | Z1 状态与恢复 | 已修正 | 产品缺陷授权、返工、重新accept和新Test代际均有Event/CAS证据 |

## 当前机器证据

- 具体文件节点之间已有186条直接import声明通过源码解析；65条目录、外部权威或折叠节点关系留给人工审阅。
- 43张Mermaid图均包含`accTitle`、`accDescr`和紧邻术语说明；750条边均有邻接证据映射。
- 30份来源指纹均按提交`d17602e`重新计算并由严格current门复验。
- 当前architecture为710模块、4967依赖、0违规；Schema为99份、207条external refs且生成合同一致。
- 当前TypeScript完整门为902 pass、0 fail、0 skip；候选制品仍明确`releaseEligible=false`。

## 本轮明确停止边界

- 不修改Wakeflow运行时代码来配合图谱。
- 不把测试/fixture对内部Service的直接调用描述成生产入口。
- 不把尚无Public owner的Demand Publication、Research Completion、Implementation Redesign或Archive画成可执行能力。
- 后续任何来源变化都必须重新触发严格指纹门；不得只改摘要而不复核图义。
