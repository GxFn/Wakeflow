---
diagramId: ts-governance-demand-event-sourcing-g0
viewType: architecture
truthKind: in-progress-worktree
reviewDepth: L1
verifiedAt: 2026-09-01
snapshotObservedAt: 2026-09-01T21:36:39-07:00
baselineCommit: f7c005d73c11e29f284dbde1d7117193376c0ef6
sourceFingerprint: sha256:efe7cf13486c357f87dc2ebde3c1857b1386ed5613a8b42a2845a699bf2ca318
audience:
  - maintainer
  - reviewer
documentationOwner: Wakeflow Source Maintenance
generatedBy: mixed
refreshTriggers:
  - src/governance/demand/**
  - src/governance/evidence/managed-evidence-manifest.ts
  - src/contracts/schemas/governance/demand/**
  - src/contracts/generated/governance/demand/**
  - tests/governance/demand/**
sourcePaths:
  - src/governance/demand/**
  - src/governance/evidence/managed-evidence-manifest.ts
  - src/contracts/generated/entrypoints/wakeflow-demand-publication-*.generated.ts
schemaPaths:
  - src/contracts/schemas/governance/demand/**
  - src/contracts/schemas/governance/evidence/managed-evidence-manifest.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-publication-*.schema.json
testPaths:
  - tests/governance/demand/**
  - tests/governance/evidence/managed-evidence-event-sourcing.test.ts
  - tests/entrypoints/wakeflow-demand-publication-mcp.test.ts
---

# Governance：Demand事件权威与聚合

> 本文绑定Demand Publication实现提交`f7c005d`及当前未提交的Managed Evidence Event Sourcing增量。当前有
> 38个Demand生产模块、25份Demand领域Schema/生成合同、1份相邻Evidence Manifest合同及2份Publication公共合同。

## 当前结论

Demand业务事实由不可变Commit/Event流拥有；`DemandAggregateState`是按顺序归约事件得到的当前选择器，
不是第二份权威。正常Repository读取优先尝试不可变快照并重放tail；快照无效时从Commit 1完整重放，
但不会在读取过程中修复或创建快照。`audit`始终从Commit 1验证摘要链、事件转换和每一步结果状态。

业务命令先在内存中完成准入、纯决策和状态演进，再签发完整Prepared Commit；文件Event Store只接受
该能力，在固定sequence槽位用候选硬链接提交，并以`commitId + commandDigest + expectedRevision`支持
幂等重试和冲突拒绝。

`wakeflow_create_demand`把首次发布分成三层：Planning只读Config、TODO与Ledger并派生完整transaction；
Application复验plan digest和当前权威后调用既有物理Publication Service；Public Coordinator只拥有根作用域、
模式路由、结果脱敏与Schema闭合。失败结果通过`unchanged / recoverable / current / unknown`说明当前最强可证状态，
不会把未知副作用解释成安全重试。

当前工作树新增第15个事件家族`evidence.managed-evidence-recorded.v1`：Event保存完整Manifest，Aggregate只投影
`evidenceId + manifestDigest + payloadArtifactDigest`。该纯Command/Event/Reducer已通过真实两Commit重放，
但尚无资源Publication/Application生产调用方，因此不能解释为Evidence内容已经耐久发布。

## 核验快照

| 项目 | 读取值 |
| --- | --- |
| 分支/提交 | `main`；`HEAD=f7c005d` |
| Demand生产源码 | 38 个模块：event-sourcing 21、publication 12、model 3、根级 2 |
| 当前全仓架构门 | 740个模块、5182条依赖、0违规 |
| 测试 | 19个Demand测试 + 1个Evidence Event测试；相邻回归13项与Candidate 2项通过 |
| Demand合同 | 25个领域Schema/生成合同 + 1个Evidence Manifest合同 + 2个Publication entrypoint合同 |
| 提交状态 | Publication Public已提交；Managed Evidence Event/Aggregate及Atlas同步待提交 |
| 来源指纹 | `37ba9fd4c166827ab2da0d969297c0ff0eae2e9a39498bf0ef89084b12e1ab89` |

## G0：Demand事件权威全景

```mermaid
flowchart TB
  accTitle: Wakeflow Demand事件权威与聚合重建
  accDescr: 跨资源Publication事务先准入pending-claim TODO和Ledger，创建Demand根、Identity、Authority和修订1事件，发布根后再把同一TODO CAS为claimed；重试可识别精确已claimed来源。后续命令由Command Handler加载Repository聚合、纯Decider产生事件、Prepared Commit绑定预期修订和命令摘要，再由文件Event Store追加。Repository可从不可变Snapshot加tail或Commit 1完整重放；聚合状态和各消费者投影均可重建。

  subgraph PUBLICATION_FLOW["① Demand 根发布"]
    direction LR
    TODO["[外部权威] pending-claim TODO\n同transaction重试可已claimed"]
    LEDGER["[外部权威] Ledger关系记录"]
    PUBLIC_API["[当前公共] wakeflow_create_demand\npreview / apply / recover"]
    PLANNING["[已实现] Publication Planning\n零写owner派生计划"]
    APPLICATION["[已实现] Publication Application\nexact plan与当前权威复验"]
    PUBLICATION["[已实现] Demand跨资源Publication\nsidecar → Demand根 → TODO完成"]
    ID_AUTH["[已实现] Demand Identity + Authority"]
  end

  subgraph COMMAND_FLOW["② Command 决策与只追加事务"]
    direction LR
    COMMAND["[输入] 业务Command\ncommitId + expectedRevision"]
    HANDLER["[已实现] Command Handler"]
    REPOSITORY["[已实现] Repository\nload / audit / history query"]
    DECIDER["[已实现] 纯Decider与状态演进"]
    COMMIT["[已实现] Prepared Commit\ncommandDigest + event range + result state"]
    STORE["[已实现] 文件Event Store\n固定sequence硬链接追加"]
  end

  subgraph REBUILD_FLOW["③ 重建、审计与消费"]
    direction LR
    SNAPSHOT["[已实现] 不可变Snapshot Store"]
    AGGREGATE["[已实现] DemandAggregateState\nimplementation / test判别阶段"]
    CONSUMERS["[消费者] Tasking / Delivery / Result / Review\nLifecycle / Testing"]
  end

  PUBLIC_API -->|"E-G0-18 preview"| PLANNING
  TODO -->|"E-G0-19 只读当前前序"| PLANNING
  LEDGER -->|"E-G0-20 解析成员选择"| PLANNING
  PLANNING -.->|"完整plan + digest"| PUBLIC_API
  PUBLIC_API -->|"E-G0-21 exact apply / recover"| APPLICATION
  APPLICATION -->|"E-G0-22 委托物理事务"| PUBLICATION
  TODO -->|"E-G0-01 CAS准入"| PUBLICATION
  LEDGER -->|"E-G0-02 关系权威准入"| PUBLICATION
  PUBLICATION -->|"E-G0-03 创建Identity/Authority"| ID_AUTH
  PUBLICATION -->|"E-G0-04 发布revision 1"| STORE

  COMMAND -->|"E-G0-05 执行"| HANDLER
  HANDLER -->|"E-G0-06 加载当前聚合"| REPOSITORY
  SNAPSHOT -->|"E-G0-07 snapshot + tail"| REPOSITORY
  STORE -->|"E-G0-08 Commit流"| REPOSITORY
  REPOSITORY -->|"E-G0-09 当前状态"| HANDLER
  HANDLER -->|"E-G0-10 纯业务决策"| DECIDER
  DECIDER -->|"E-G0-11 未提交事件 + 新状态"| COMMIT
  COMMIT -->|"E-G0-12 append capability"| STORE
  STORE -->|"E-G0-13 committed/idempotent"| HANDLER

  STORE -->|"E-G0-14 按序重放"| AGGREGATE
  SNAPSHOT -->|"E-G0-15 锚定游标/状态"| AGGREGATE
  AGGREGATE -->|"E-G0-16 当前selector"| CONSUMERS
  REPOSITORY -->|"E-G0-17 审计历史来源"| CONSUMERS
```

### 本图术语说明

| 图中术语 | 解释 |
| --- | --- |
| Demand Identity | 不可变Demand身份、创建来源与初始修订事实 |
| Demand Authority | Identity摘要、角色、测试模式、Ledger引用与位置关系的强制权威 |
| Command | 请求某一业务转换的严格输入；本身不是“已发生”事实 |
| Decider | 只读取当前state和command、返回未提交事件的纯函数，不执行I/O |
| Prepared Commit | 已在内存中完成事件应用、摘要链和预期源前缀验证的追加能力 |
| Commit | 一次原子追加的不可变记录，可包含一个或多个连续事件 |
| `commandDigest` | 由Event Sourcing层自己计算的命令幂等摘要，调用方不能自行声明 |
| Publication plan | Planning从当前Config、TODO、Ledger、Identity分配与时间派生的完整自包含transaction；调用方不能补写内部字段 |
| Publication authority | 一次发布失败后对exact transaction效果的最强证明：`unchanged / recoverable / current / unknown` |
| Snapshot | 锚定指定Commit、state digest和版本兼容摘要的不可变加速记录 |
| tail | Snapshot锚点之后仍需重放的Commit序列 |
| selector | 从完整历史确定性重建的当前状态视图，不拥有独立修改接口 |

## G0边级证据

| 边编号 | 代码证据 | 核验结论 |
| --- | --- | --- |
| `E-G0-01`–`E-G0-04` | Publication Service/Stage/TODO与revision 1 Command | Publication先发布Demand根和初始Event，再把精确TODO CAS为claimed |
| `E-G0-05`–`E-G0-13` | Command Handler、Repository、Decider、Prepared Commit与File Store | 纯决策先于append；固定sequence槽位提供并发/幂等收敛 |
| `E-G0-14`–`E-G0-17` | Aggregate/Repository/Snapshot与历史查询 | 当前状态和消费者读模型均由不可变Commit流重建，Snapshot只加速 |
| `E-G0-18`–`E-G0-22` | Public Coordinator、Planning/Application与物理Publication Service | preview零写；apply复验精确计划；recover只凭sidecar证据；公共层不复制物理状态机 |

## 事件与聚合覆盖

当前事件联合覆盖15个家族：Demand发布/取消/完成、Managed Evidence记录、Target Task规划、Test Card创建、Target/Test
Delivery准备、宿主效果claim/observe/rearm、TargetResult记录、Controller review决定/恢复，以及产品缺陷
remediation授权。

`DemandAggregateState`跟踪：

- Demand生命周期：`active / cancelled / completed`；
- Target Task阶段：planned、delivery prepared、host effect、result reported、accepted/rework/redesign/blocked；
- `currentTestCard`当前槽位、各Test Target自己的Card tuple、Test Delivery authorization/attempt lineage、
  Dispatch Packet来源与宿主效果状态；历史Test Target只允许保留`test-product-defect`代际；
- workType Result、Implementation Review generation和Test Review阶段；
- `managedEvidence`只在首个Evidence Event后出现，并仅保存Evidence ID与Manifest/payload双摘要；
- Test Review的`test-accepted / another-attempt / product-defect / blocked`类型已进入共享Decision Event；
  another-attempt进入rerun，test-accepted进入Completion，blocked进入共享Resume，product-defect进入
  Remediation Authorization、原Implementation Target返工和`pendingTestRetest`新代际。

每个状态转换都由对应事件归约函数拥有；跨实体ID、摘要、generation和前序阶段不匹配时失败关闭。

## 状态权威边界

| 事实 | 权威 | 派生/加速 | 失败时行为 |
| --- | --- | --- | --- |
| 已发生业务事实 | Commit/Event文件 | Aggregate、历史查询结果 | 任一摘要/序列/转换不一致则stream invalid |
| 当前Demand状态 | 从Commit 1或Snapshot+tail重放 | `DemandAggregateState` | 不能直接写state文件修改事实 |
| 快照 | 不可变Snapshot文件 | 正常load加速 | 无效快照被跳过；不在读取中自动修复 |
| 命令幂等 | Commit中的commitId/commandDigest/expectedRevision | Command Handler结果 | 同ID不同命令为idempotency conflict |
| 发布进度 | Workspace同级publication transaction sidecar | Demand根和TODO状态 | 只允许前向恢复，不删除已发布Demand倒退 |

## 当前边界

- Demand聚合只由15个Event家族演进，公共调用方不能直接写Event或state；
- Command Handler、Repository、Root Authority/Inventory、Snapshot与File Store拥有加载、追加与恢复；
- Delivery/Result/Review/Lifecycle/Testing owner只提交自己的严格Command；
- Demand Publication已通过`wakeflow_create_demand`公开；公共成功结果只返回稳定回执，完整Aggregate、Authority内容与机器路径保持内部。
- Managed Evidence内部Command/Event/Reducer已存在，但没有资源Application或公共工具；Event可重放不等于payload已保存。

## 验证证据

| 证据 | 当前结果 | 能证明什么 |
| --- | --- | --- |
| 当前全仓architecture | 740模块、5182依赖、0违规 | 当前扫描无循环、未解析依赖或架构违规 |
| 当前Schema门 | 103 Schema/212 refs | Managed Evidence payload预算为final Manifest/前缀预留容量，生成输出一致 |
| Publication聚焦测试 | 25项领域/公共/MCP测试通过 | 覆盖输入、Planning、Application、物理事务、回执、真实Route与恢复authority |
| Managed Evidence Event | 4项新测试、13项相邻回归、Candidate 2项通过 | 覆盖完整Manifest Event、最小selector、版本codec、真实Commit重放及候选可达闭包 |
| 最近完整TypeScript门 | 948 pass / 0 fail / 0 cancelled / 0 skip | 已覆盖当前Evidence Event与Foundation增量 |
| 来源指纹 | 当前路径集合 | 本文绑定提交`f7c005d`的Demand内容 |

## 下钻入口

- [Demand事件溯源关键文件依赖](./file-dependencies.md)
- [Command、Append、Load与Publication恢复流程](./runtime-call-flow.md)
- [返回Configuration/Workspace](../03-configuration-workspace/README.md)
