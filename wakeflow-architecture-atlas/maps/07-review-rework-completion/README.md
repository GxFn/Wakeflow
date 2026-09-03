---
diagramId: ts-review-rework-completion-l0
viewType: vertical-slice
truthKind: current-code
reviewDepth: L2
verifiedAt: 2026-09-03
snapshotObservedAt: 2026-09-03T03:13:56-07:00
baselineCommit: 08334ab9c1d8bd923966a976fdf7989bc56ac38c
sourceFingerprint: sha256:d0ab87bef6d03e8d6b65b636ef6637a180352e236c3344b42e8c6cae256e667a
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Source Maintenance
generatedBy: mixed
sourcePaths:
  - src/governance/review/**
  - src/governance/lifecycle/**
  - src/governance/delivery/target-delivery-rework-context.ts
  - src/governance/testing/**
  - src/governance/result/**
testPaths:
  - tests/governance/review/**
  - tests/governance/lifecycle/**
  - tests/governance/testing/**
  - tests/governance/result/**
---

# Review返工、blocked恢复与Demand完成

> Completion、Review、Product Defect Remediation及相邻Delivery/Testing consumer均已进入`d17602e`。

## 当前结论

Controller决定`rework`时不创建新TaskPackage，而是把完整Review文本压缩为有界rework context，后续
Delivery Intent仍引用同一不可变TaskPackage并开启新attempt/generation。`redesign`返回设计/规划owner；
`blocked`不允许直接提交下一决定，必须先用精确blocked Decision提交Resume Event。

只有post-acceptance route判定所有必要产品目标已接受、测试策略满足、TODO仍精确claimed且不存在参与窗口
WindowWorkClaim时，Completion Service才可preview/apply`lifecycle.demand-completed`事件。当前代码已实现：
Test Review `accept`形成带精确Test closure的`completion-preflight`；`request-another-attempt`由Test Delivery
Preparation消费并追加新attempt；real-environment Completion保留TestCard和完整attempt lineage。产品缺陷
Decision由Remediation Service绑定失败检查与原TaskPackage baseline，追加Authorization Event并把精确产品Target
推进到`product-defect-rework-requested`；修复接受后进入新TestCard代际。Test blocked由共享Resume Service精确
恢复，不消耗attempt或创建Delivery。

## L0：Review后续与成功终态

```mermaid
flowchart TB
  accTitle: Controller Review返工blocked恢复与Demand完成
  accDescr: Implementation Review支持rework/redesign/blocked/accept。Test Review accept进入Completion，another创建rerun，blocked由共享Resume恢复；product-defect退出currentTestCard并保留历史Target，Remediation Service追加授权Event、重开原产品Target并在修复接受后创建新TestCard代际。Completion保留当前accepted Test和历史product-defect lineage。

  subgraph REVIEW["① Review 决策入口"]
    direction LR
    SNAPSHOT["[读模型] Review Snapshot"]
    DECISION["[事件权威] Controller Decision"]
  end

  subgraph RETURN_ROUTES["② 返回与暂停分支"]
    direction LR
    REWORK["[已实现] 有界Rework Context\n同一TaskPackage"]
    REDELIVER["[已实现] 新Delivery attempt/generation"]
    REDESIGN["[路由] Design/Planning owner"]
    BLOCKED["[事件权威] blocked generation"]
    RESUME["[事件权威] 精确Resume"]
  end

  subgraph ACCEPTED_ROUTE["③ Accept 后路由"]
    direction LR
    ROUTE["[读模型] Post-Acceptance Route"]
    TESTING["[路由] Testing owner"]
    TEST_RESULT["[事件权威] Test TargetResult"]
    TEST_REVIEW["[事件权威] Controller Test Review\n独立四类Decision Event"]
    TEST_ROUTE["[读模型] accepted / another-attempt\nproduct-defect / blocked"]
    RERUN["[已实现] another-attempt消费\nrerun Test Delivery + 新attempt"]
    REMEDIATION["[事件权威] 产品缺陷Remediation Authorization\n原TaskPackage产品返工"]
    TEST_RESUME["[已实现] 精确Test Resume\n同一Result / attempt"]
    PREFLIGHT["[读模型] completion-preflight"]
  end

  subgraph COMPLETION["④ Demand 完成事务"]
    direction LR
    SOURCES["[权威闭合] Config + Demand + TODO + WorkClaims"]
    PLAN["[已实现] immutable Completion Plan"]
    COMPLETE["[事件权威] lifecycle.demand-completed"]
  end

  SNAPSHOT -->|"E-L0-01 决定"| DECISION
  DECISION -->|"E-L0-02 rework"| REWORK
  REWORK -->|"E-L0-03 同一TaskPackage"| REDELIVER
  DECISION -->|"E-L0-04 redesign"| REDESIGN
  DECISION -->|"E-L0-05 blocked"| BLOCKED
  BLOCKED -->|"E-L0-06 显式恢复"| RESUME
  RESUME -->|"E-L0-07 新generation"| SNAPSHOT
  DECISION -->|"E-L0-08 accept"| ROUTE
  ROUTE -->|"E-L0-09 需要测试"| TESTING
  TESTING -->|"E-L0-10 记录Test Result"| TEST_RESULT
  TEST_RESULT -->|"E-L0-11 生成审阅输入"| TEST_REVIEW
  TEST_REVIEW -->|"E-L0-12 提交Decision并派生route"| TEST_ROUTE
  TEST_ROUTE -->|"E-L0-18 accept + 精确Test closure"| PREFLIGHT
  TEST_ROUTE -->|"E-L0-19 request-another-attempt"| RERUN
  RERUN -->|"E-L0-20 追加新attempt与首份授权"| TESTING
  TEST_ROUTE -->|"E-L0-21 escalate-product-defect"| REMEDIATION
  REMEDIATION -->|"E-L0-24 原产品Target返工"| REDELIVER
  TEST_ROUTE -->|"E-L0-22 blocked"| TEST_RESUME
  TEST_RESUME -->|"E-L0-23 Resume Event后重新审阅"| TEST_REVIEW
  ROUTE -->|"E-L0-13 尚有阻塞"| SNAPSHOT
  ROUTE -->|"E-L0-14 可完成"| PREFLIGHT
  PREFLIGHT -->|"E-L0-15 加载当前事实"| SOURCES
  SOURCES -->|"E-L0-16 创建exact plan"| PLAN
  PLAN -->|"E-L0-17 apply"| COMPLETE
```

### 本图术语说明

| 图中术语 | 解释 |
| --- | --- |
| 同一TaskPackage返工 | 保持原目标边界与Acceptance Anchors，只增加Review要求和新Delivery generation |
| redesign | 当前TaskPackage边界本身需要改变，因此回到设计/Planning而非直接投递 |
| blocked generation | 缺外部条件的精确Review轮次；Resume只能引用这次Decision |
| completion-preflight | route确认测试策略、所有目标状态和Demand Authority允许进入成功终态 |
| Controller Test Review | 使用`satisfied / defect-observed / inconclusive`结论与四类Test Decision Event，不复用implementation rework语义 |
| Test closure | TestCard、Test target/TaskPackage、最终attempt、TargetResult、Decision和Test窗口的精确只读来源元组 |
| rerun attempt | 同一TestCard/TaskPackage下的新`TestExecutionAttempt`，引用直接前驱Result与Review Decision |
| `currentTestCard` | Aggregate当前可规划/执行的Test合同槽位；product-defect历史Target保留自身Card tuple但退出当前槽位 |
| Remediation Authorization | 绑定Test Decision、Route digest、失败检查和既有产品TaskPackage baseline的不可变Event事实 |
| exact claimed TODO | TODO项仍以相同demandId/lineage处于claimed状态，未被并发改变 |
| 当前WorkClaim | 任一窗口仍持有当前业务占用时，Demand不能完成 |

## 成功完成前置条件

- Demand仍为`active`，并且当前stream revision与plan一致。
- Post-Acceptance Route为`completion-preflight`，不是testing或blocked。
- Demand Authority、Controller window和Config摘要仍与preview一致。
- TODO仍精确claimed到该Demand。
- 所有accepted Target满足testing mode；不存在未处理result/review。
- real-environment模式下`currentTestCard`必须精确匹配唯一`test-accepted`当前Target，route携带其Test closure；
  可同时保留零个或多个历史`test-product-defect` Target。Completion保留全部Card/attempt lineage，不新增第二套Card关闭状态。
- 所有相关WindowWorkClaim已精确释放。

## L0边级证据

| 边编号 | 实际关系 | 当前结论 |
| --- | --- | --- |
| `E-L0-01`–`E-L0-08` | Implementation Decision/Resume Event与Delivery rework source | rework保持TaskPackage，blocked必须精确resume |
| `E-L0-09`–`E-L0-12` | real-environment Test纵切与独立Test Review Event | 内部Service/Event已实现，尚无公共编排入口 |
| `E-L0-18` | Test accept route | 现在真实产生带Test closure的`completion-preflight` |
| `E-L0-19`、`E-L0-20` | another-attempt route与Test Delivery Preparation | 真实追加rerun attempt和首份Delivery authorization |
| `E-L0-21`、`E-L0-24` | product defect route与Remediation | 旧Card/Target保留；Authorization Event重开原产品Target，修复accept后进入新Card代际 |
| `E-L0-22`、`E-L0-23` | Test blocked route | 共享Resume Service精确复验workType/Decision/Result并回到新Test Review generation |
| `E-L0-13`–`E-L0-17` | Completion Authority/Plan/Service | controller-only与real-environment均可完成；TODO与相关Claims必须闭合 |

## 核验快照

| 项目 | 读取值 |
| --- | --- |
| Lifecycle源码 | 4个模块，已提交 |
| 当前架构门 | 823模块、5817依赖、10个显式生产根、0违规；最近完整门1023项 |
| Schema | 全仓114份、215 refs；Review 4份、Lifecycle 1份 |
| Lifecycle测试 | 2个正式测试、1个fixture |
| 来源指纹 | `d0ab87bef6d03e8d6b65b636ef6637a180352e236c3344b42e8c6cae256e667a` |

## 下钻入口

- [Review/Completion关键文件依赖](./file-dependencies.md)
- [返工、Resume与Completion调用流](./runtime-call-flow.md)
