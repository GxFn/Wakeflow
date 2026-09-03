---
diagramId: ts-end-to-end-business-z0
viewType: business-flow
truthKind: current-code
reviewDepth: L2
verifiedAt: 2026-09-03
snapshotObservedAt: 2026-09-03T03:13:56-07:00
baselineCommit: 08334ab9c1d8bd923966a976fdf7989bc56ac38c
sourceFingerprint: sha256:0f4fcb7d28b9d95f8b1a35150a4ef09927e6003bb13437f3ee0a363ef9457022
audience:
  - maintainer
  - reviewer
  - newcomer
documentationOwner: Wakeflow Source Maintenance
generatedBy: manual-composition
refreshTriggers:
  - wakeflow-architecture-atlas/maps/01-overall-architecture/**
  - wakeflow-architecture-atlas/maps/02-foundation/**
  - wakeflow-architecture-atlas/maps/03-configuration-workspace/**
  - wakeflow-architecture-atlas/maps/04-governance-event-sourcing/**
  - wakeflow-architecture-atlas/maps/05-tasking-slice/**
  - wakeflow-architecture-atlas/maps/06-implementation-delivery-review/**
  - wakeflow-architecture-atlas/maps/07-review-rework-completion/**
  - wakeflow-architecture-atlas/maps/08-real-environment-testing/**
  - wakeflow-architecture-atlas/maps/09-public-mcp-host-seams/**
sourcePaths:
  - src/configuration/**
  - src/workspace/**
  - src/governance/**
  - src/entrypoints/**
schemaPaths:
  - src/contracts/schemas/**
testPaths:
  - tests/**
---

# Wakeflow端到端业务流程

> 本文是01–09文档包的组合视图，不重新解释每个文件。下层源码、Schema、Event、Authority和测试
> 才是实现事实；本文只提供从需求进入到成功完成的Review导航。
>
> 当前23个公共MCP工具覆盖Requirement/Confirmation Ledger Authority、TODO Inspection/Intake，以及TODO经Demand Publication、Evidence记录、Route、执行治理到Completion的链；
> TODO采用`todo_<UUIDv4>`与Ledger-bound不可变Intake；A4/A5已公开查询和接收，A6使Demand只读取同一Intake refs；
> `wakeflow_create_demand`公开preview、exact apply与explicit recover，但不会自动串联后续Route。
> `wakeflow_record_evidence`已公开preview/apply/recover，但只返回metadata receipt；内部按需Reader与payload bytes不公开。
> 公开链现在可从Design Ledger建立TODO并创建Demand；Auto Claim仍没有执行consumer。
>
> **[未实现]** 当前TypeScript源码没有Demand归档owner；主链在`lifecycle.demand-completed`停止。

## 当前结论

当前候选实现已经形成一条公开可调用、内部可解释的业务链：配置与Workspace初始化后，Publication从精确
`pending-claim` TODO创建Demand根，并在根发布后把该TODO CAS为claimed；Demand Planning只读取该TODO Intake的完整Ledger member refs，
Controller规划不可变TaskPackage；Delivery准备Intent并由Agent执行真实宿主效果；Result被导入事件流；
Controller对implementation决定accept/rework/redesign/blocked；接受后按策略进入真实环境Testing或成功Completion。
Testing已经闭合到Test Result、独立Controller Test Review Decision Event与四类route；Test accept进入
real-environment Completion，request-another-attempt创建rerun，Test blocked由共享Resume精确恢复；产品缺陷
进入Remediation Authorization、原产品Target返工、重新accept和新TestCard代际。这些阶段由23工具中的
真实owner公开；Server不会自动串联，Controller按Route逐步调用。

这条链的各段都采用“preview/严格计划 → apply重新准入 → Event权威 → 可重建投影”的模式，并在外部
宿主效果前插入Intent、WorkClaim和Claim Event。任何`indeterminate`效果、陈旧plan、冲突权威或不完整
恢复证据都会失败关闭。

## Z0：端到端主流程与当前停止边界

```mermaid
flowchart TB
  accTitle: Wakeflow从需求进入到实现返工条件测试和完成的端到端业务流程
  accDescr: Workspace经公开Maintenance/Binding准备，Ledger工具发布Requirement/Confirmation，TODO工具提供有界Inspection与exact Intake，wakeflow_create_demand只从该Intake Authority发布Demand。二十三个公共工具按Route完成implementation/test Planning、Delivery、Result、Review、rerun、Remediation/retest和Completion；Archive仍缺失，Agent独立执行宿主效果。

  subgraph SETUP["① 公共入口与需求发布"]
    direction LR
    ACTOR["[外部] 用户 / Controller / Agent"]
    PUBLIC["[当前公共MCP] 23工具\nWorkspace / Ledger / TODO / Demand / Evidence / Route / Tasking\nDelivery / Result / Review / Testing / Lifecycle"]
    WORKSPACE["[已实现] Config v3与Workspace就绪"]
    LEDGER["[已实现][公共] Requirement / pre-Demand Confirmation\npreview / apply / recover → member refs"]
    TODO["[已实现][公共] TODO Inspection / Intake\nAuto Claim仍无执行consumer"]
    DEMAND["[已实现][公共] Demand Publication\npreview / apply / recover → revision 1"]
    EVIDENCE["[已实现][公共] Managed Evidence\npreview / apply / recover → metadata receipt"]
    PACKAGE["[已实现][公共Planning] immutable implementation TaskPackage Event"]
  end

  subgraph DELIVERY_FLOW["② 实现投递与结果"]
    direction LR
    DELIVERY["[已实现][内部] Delivery Intent + WorkClaim + Claim Event"]
    HOST["[执行平面] Agent执行真实宿主效果"]
    OUTCOME["[已实现][事件] accepted / indeterminate / rejected"]
    RESULT["[已实现][事件] Implementation TargetResult"]
    INDETERMINATE_STOP["[已实现] indeterminate停止\n保留Claim并禁止自动重试"]
  end

  subgraph REVIEW_FLOW["③ Review 与显式恢复"]
    direction LR
    REVIEW["[已实现][事件] Implementation Review\naccept / rework / redesign / blocked"]
    REWORK["[已实现] 同一TaskPackage返工\n新Delivery generation"]
    RESUME["[已实现] blocked显式resume"]
  end

  subgraph FINISH["④ 接受后路由与完成"]
    direction LR
    ROUTE["[已实现][读模型] Post-Acceptance Route"]
    TESTING["[已实现][内部] TestCard → Test Task → Attempt\nPacket → Claim → Test Result"]
    TEST_REVIEW["[事件权威] Controller Test Review\n四类Decision Event"]
    TEST_ROUTE["[读模型] test-accepted / another-attempt\nproduct-defect / blocked"]
    TEST_RERUN["[已实现] rerun Test attempt\n直接前驱Result/Decision"]
    TEST_RESUME["[已实现] Test blocked精确Resume\n同一Result / attempt"]
    REMEDIATION["[事件权威] Product Remediation\n授权 / 产品返工 / retest lineage"]
    COMPLETE["[已实现][事件] lifecycle.demand-completed\ncontroller-only / real-environment"]
    ARCHIVE["[未实现] Demand归档owner"]
  end

  ACTOR -->|"E-Z0-01 调用当前公共工具"| PUBLIC
  PUBLIC -->|"E-Z0-02 Maintenance/Binding"| WORKSPACE
  PUBLIC -->|"E-Z0-36 publish Requirement / Confirmation"| LEDGER
  LEDGER -->|"E-Z0-37 A5 exact TODO Intake"| TODO
  PUBLIC -->|"E-Z0-38 inspect / intake TODO"| TODO
  WORKSPACE -->|"E-Z0-03 当前配置与资源边界"| TODO
  TODO -->|"E-Z0-04 pending TODO与Ledger权威"| DEMAND
  PUBLIC -->|"E-Z0-33 wakeflow_create_demand"| DEMAND
  PUBLIC -->|"E-Z0-34 wakeflow_record_evidence"| EVIDENCE
  DEMAND -->|"E-Z0-35 Event-backed Authority"| EVIDENCE
  PUBLIC -->|"E-Z0-05 Target Task Planning"| PACKAGE
  DEMAND -->|"E-Z0-06 Authority Context"| PACKAGE
  PACKAGE -->|"E-Z0-07 内部Delivery准备"| DELIVERY
  DELIVERY -->|"E-Z0-08 首次Claim回执签发Action"| HOST
  HOST -->|"E-Z0-09 回传Observation"| OUTCOME
  OUTCOME -->|"E-Z0-10 accepted"| RESULT
  OUTCOME -->|"E-Z0-11 indeterminate停止"| INDETERMINATE_STOP
  OUTCOME -->|"E-Z0-12 rejected显式rearm"| DELIVERY
  RESULT -->|"E-Z0-13 Controller审阅"| REVIEW

  REVIEW -->|"E-Z0-14 rework"| REWORK
  REWORK -->|"E-Z0-15 保持同一TaskPackage"| DELIVERY
  REVIEW -->|"E-Z0-16 blocked"| RESUME
  RESUME -->|"E-Z0-17 新Review generation"| REVIEW
  REVIEW -->|"E-Z0-18 redesign"| ACTOR
  REVIEW -->|"E-Z0-19 accept"| ROUTE

  ROUTE -->|"E-Z0-20 testing-required"| TESTING
  TESTING -->|"E-Z0-21 test-result-review-planning"| TEST_REVIEW
  TEST_REVIEW -->|"E-Z0-22 提交Decision并派生route"| TEST_ROUTE
  TEST_ROUTE -->|"E-Z0-25 accept + Test closure"| COMPLETE
  TEST_ROUTE -->|"E-Z0-26 request-another-attempt"| TEST_RERUN
  TEST_RERUN -->|"E-Z0-27 新attempt与首份授权"| TESTING
  TEST_ROUTE -->|"E-Z0-28 product-defect"| REMEDIATION
  REMEDIATION -->|"E-Z0-31 原产品Target返工"| DELIVERY
  REMEDIATION -->|"E-Z0-32 修复accept后新TestCard"| TESTING
  TEST_ROUTE -->|"E-Z0-29 blocked"| TEST_RESUME
  TEST_RESUME -->|"E-Z0-30 Resume Event后重新审阅"| TEST_REVIEW
  ROUTE -->|"E-Z0-23 completion-preflight"| COMPLETE
  COMPLETE -.->|"E-Z0-24 尚无生产owner"| ARCHIVE
```

### 本图术语说明

| 图中术语 | 解释 |
| --- | --- |
| 当前公共MCP | 已在固定Codex/Claude组合根注册、具有公开Schema和真实消费者的23个工具 |
| Demand Publication | 调用方只提交TODO ID与作者语义/位置；owner从immutable Intake派生完整Authority与计划 |
| Authority Context | 某一操作重新打开并闭合的Config、Demand、Ledger、TODO、Binding或测试事实集合 |
| Claim回执 | 首次成功提交host-effect-claimed Event的结果；只有它能签发一次性Host Action |
| generation | Delivery、宿主效果或Review的显式代际，防止返工/恢复误用旧事实 |
| completion-preflight | 所有必要目标接受、测试策略满足、TODO仍claimed且无WorkClaim的完成准入读模型 |
| Controller Test Review | 独立于implementation Review的Test conclusion/Evidence充分性判断；Event、四类route及accept/another消费者已闭合 |
| Test closure | real-environment Completion使用的TestCard、最终attempt、Result、Decision和Test窗口精确来源元组 |
| `currentTestCard` | 当前Test代际槽位；product-defect历史Target保留原Card tuple但退出该槽位 |
| 归档owner | 成功完成后移动/封存Demand资源并拥有恢复策略的生产职责；当前尚不存在 |

## Z0边级证据

| 边编号 | 实际关系 | 审阅结论 |
| --- | --- | --- |
| `E-Z0-01`–`E-Z0-03` | 23个公共工具与Workspace | 双宿主真实入口；Route决定后续owner |
| `E-Z0-36`–`E-Z0-38` | Ledger Authority → TODO Inspection/Intake | Public producer/consumer闭合；Intake保存完整refs，Inspection不选择next |
| `E-Z0-04`、`E-Z0-33` | Demand Publication | Public preview/apply/recover委托物理Service先发布Demand根，再把精确TODO CAS为claimed |
| `E-Z0-34`、`E-Z0-35` | Managed Evidence Publication | Public只接收逻辑source selection；Event/final闭合后返回metadata receipt |
| `E-Z0-05`、`E-Z0-06` | implementation/test Task Planning | 同一公共工具preview/apply；test只接受最小owner派生选择 |
| `E-Z0-07`–`E-Z0-13` | Delivery、宿主效果、Result | 公共owners记录Event；indeterminate保留Claim停止，不回到Delivery |
| `E-Z0-14`–`E-Z0-19` | Implementation Review与返工/恢复 | Inspection/Decision/Resume公开，判断仍由Controller拥有 |
| `E-Z0-20`–`E-Z0-32` | Testing、Review、rerun、Remediation与Completion | 四类Test Decision均有consumer；产品修复后形成新Test代际 |
| `E-Z0-23`、`E-Z0-24` | Completion与归档 | controller-only/real-environment Completion已实现；归档仍缺失 |

## 阶段与权威映射

| 阶段 | 当前入口 | 状态权威 | 可重建视图 | 文档下钻 |
| --- | --- | --- | --- | --- |
| Workspace准备 | 公共Maintenance/Binding | Config、Maintenance intent/journal、Binding | Active/Window投影 | [03](../03-configuration-workspace/README.md) |
| Ledger权威发布 | 公共`wakeflow_publish_requirement / wakeflow_publish_confirmation` | immutable Requirement/Confirmation record tree与compact intent | metadata-only member references | [09](../09-public-mcp-host-seams/README.md) |
| TODO接收/查询 | 公共`wakeflow_intake_todo / wakeflow_inspect_todo` | immutable Intake + revisioned State + Collection transaction | bounded summary/exact item及metadata receipt | [09](../09-public-mcp-host-seams/README.md) |
| Demand发布 | 公共`wakeflow_create_demand` + Planning/Application/物理Publication Service | Identity、Authority、revision 1、TODO lineage | Aggregate与稳定Publication回执 | [04](../04-governance-event-sourcing/README.md) |
| Evidence记录 | 公共`wakeflow_record_evidence` + Planning/Application/Settlement | Manifest Event + immutable final record | metadata receipt；内部Reader | [04](../04-governance-event-sourcing/runtime-call-flow.md) |
| Task规划 | 公共Target Task Planning，implementation/test判别请求 | `target-task-planned` Event中的TaskPackage | 0600 TaskPackage投影 | [05](../05-tasking-slice/README.md) |
| 实现投递 | 公共Delivery/Claim/Outcome工具 + Agent | Intent、WorkClaim、claim/observation Events | Agent Host Action | [06](../06-implementation-delivery-review/README.md) |
| Result/Review | 公共Import/Inspection/Decision/Resume工具 | workType TargetResult、Decision/Resume Events | Review Snapshot/Route | [06](../06-implementation-delivery-review/README.md) |
| 返工/完成 | 公共Remediation/Completion工具 | 同TaskPackage新代际、Authorization/`demand-completed` Events | Completion Plan/Route | [07](../07-review-rework-completion/README.md) |
| 真实测试 | 公共Card/Task/Delivery/Review工具 | TestCard、Intent、Claim、Result与Test Review Events | Dispatch Packet/Review input | [08](../08-real-environment-testing/README.md) |
| 宿主接缝 | MCP + Agent | 私有Binding、Event权威 | 脱敏projection/Observation | [09](../09-public-mcp-host-seams/README.md) |

## 正常路径

1. Maintenance使Config、静态资源和宿主本地布局达到可复验状态；Requirement/Confirmation工具从Design surface发布immutable Ledger Authority。
2. `wakeflow_intake_todo`从选择的Ledger成员派生完整Intake并exact apply；`wakeflow_inspect_todo`可有界观察同一Authority。
3. Controller只提交TODO ID与Demand语义；`wakeflow_create_demand`从Intake refs派生计划，创建Demand根和初始Event，再CAS精确TODO为claimed。
4. Controller preview/apply生成不可变TaskPackage Event及文件投影。
5. Delivery准备Intent，Agent窗口观察与Binding闭合后创建WorkClaim和Claim Event。
6. Agent执行一次性Host Action；Outcome Event记录真实观察。
7. accepted效果允许导入TargetResult；Controller基于完整事件流Snapshot决定。
8. rework回到同一TaskPackage的新Delivery代际；blocked等待显式Resume；redesign回到设计/规划。
9. 全部产品目标接受后，Route按testing mode进入Testing或Completion。
10. Testing完成Test Result后进入独立Test Review；accept进入Completion，another-attempt创建rerun，blocked精确Resume，
   product-defect授权原产品Target返工，修复accept后创建新TestCard代际。
11. controller-only与real-environment Completion都可提交`lifecycle.demand-completed`；TestCard和attempt历史保留。

## 当前剩余边界

- Research Completion和Implementation Redesign仍是显式blocker。
- Ledger → TODO Inspection/Intake → Demand → Route公共零到一链已通过同一MCP Server验证；Auto Claim仍无执行consumer。
- Managed Evidence记录已公开metadata-only工具；内部按需Reader与payload bytes仍不公开。
- Publication提交`f7c005d`已通过完整TypeScript门，但尚未执行真实Codex/Claude宿主效果、
  双宿主插件smoke或旧JS等价对照。
- `demand-completed`之后没有TypeScript归档生产者、合同或恢复路径。

## 核验基线

| 项目 | 读取值 |
| --- | --- |
| 下层文档 | 01–09共27份Markdown证据 |
| 来源状态 | 30份机器核验来源指纹全部为current |
| TypeScript基线 | `HEAD=08334ab`；823模块/5817依赖、10个显式生产根、114 Schema/215 refs |
| 当前聚焦门 | entrypoint 12文件/25项；Demand input反向依赖18文件/80项；0 fail / 0 skip |
| 最近完整TypeScript门 | 1023 pass / 0 fail / 0 cancelled / 0 skip；覆盖提交`08334ab` |
| 候选闭包 | Codex 496 / Claude Code 501个编译文件；scope=`typescript-public-technical-skeleton`，`releaseEligible=false` |
| 完整发布门 | 未执行；候选manifest明确`releaseEligible=false` |

## 下钻入口

- [异常、幂等与恢复路径](./state-and-recovery.md)
- [端到端证据矩阵](./review-evidence.md)
- [图集总路线](../README.md)
