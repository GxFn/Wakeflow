---
diagramId: ts-delivery-review-file-f6
viewType: file-dependency
truthKind: current-code
reviewDepth: L3
verifiedAt: 2026-09-01
snapshotObservedAt: 2026-09-01T06:42:28-07:00
baselineCommit: d17602ed9931a1898f713c740752c54b94bd8086
sourceFingerprint: sha256:2aa76ec90d7e2b8ceb9212e45a53ea3f0f64f2916bbd610852a9862db2ff0ae0
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Source Maintenance
generatedBy: mixed
sourcePaths:
  - src/governance/delivery/**
  - src/governance/result/**
  - src/governance/review/**
testPaths:
  - tests/governance/delivery/**
  - tests/governance/result/**
  - tests/governance/review/**
---

# 实现投递与审阅：关键文件依赖

## F6：Delivery、Result与Review骨干依赖

```mermaid
flowchart LR
  accTitle: Delivery Result与Controller Review关键文件依赖
  accDescr: Delivery Preparation Service通过Preparation Authority组合TaskPackage、私有Binding和Intent；Claim Authority复用窄Binding loader，Claim Service组合Intent、观察、WindowWorkClaim Store与Demand Repository并生成Agent Host Action；Outcome/Rearm服务记录效果事件；Result Import闭合Report和accepted effect；Review Snapshot审计事件流，Decision/Resume Service提交审阅事件，Post Acceptance Route从Authority和Snapshot选择下一阶段。

  subgraph ROOTS["Delivery准备"]
    PREP["[已实现][F-DLV-01]\ntarget-delivery-preparation-service.ts"]
    INTENT["[已实现][F-DLV-02]\ntarget-delivery-intent.ts"]
    BIND_AUTH["[已实现][F-DLV-03]\ntarget-delivery-binding-authority.ts"]
    PREP_AUTH["[已实现][F-DLV-11]\ntarget-delivery-preparation-authority.ts"]
  end
  subgraph SHARED_ENTRY["Claim与宿主效果"]
    CLAIM["[已实现][F-DLV-04]\ntarget-host-effect-claim-service.ts"]
    CLAIM_AUTH["[已实现][F-DLV-05]\ntarget-host-effect-claim-authority.ts"]
    WORKCLAIM["[已实现][F-DLV-06]\nwindow-work-claim.ts"]
    CLAIM_STORE["[已实现][F-DLV-07]\nwindow-work-claim-store.ts"]
    ACTION["[已实现][F-DLV-08]\ntarget-delivery-agent-host-action.ts"]
    OUTCOME["[已实现][F-DLV-09]\ntarget-host-effect-outcome-service.ts"]
    REARM["[已实现][F-DLV-10]\ntarget-host-effect-rearm-service.ts"]
  end
  subgraph DOMAIN["TargetResult"]
    REPORT["[已实现][F-RES-01]\nimplementation-target-result-report.ts"]
    RESULT["[已实现][F-RES-02]\ntarget-result.ts"]
    IMPORT["[已实现][F-RES-03]\ntarget-result-import-service.ts"]
  end
  subgraph HOST_ENTRY["Controller Review"]
    SNAPSHOT["[已实现][F-REV-01]\ndemand-result-review-snapshot.ts"]
    DECISION["[已实现][F-REV-02]\ncontroller-implementation-review-decision-service.ts"]
    RESUME["[已实现][F-REV-03]\ncontroller-target-review-resume-service.ts"]
    ROUTE["[已实现][F-REV-04]\ndemand-post-acceptance-route.ts"]
  end
  subgraph HOST_IMPL["相邻权威"]
    PACKAGE["[外部] TaskPackage Event"]
    REPOSITORY["[外部] Demand Repository/Command Handler"]
    BINDING["[外部] Window Binding/Agent观察"]
  end
  WIRE["[生成][F-GEN-06]\nDelivery/Result/Review 10个合同"]

  PREP -->|"E-F6-01 创建Intent"| INTENT
  PREP -->|"E-F6-02 TaskPackage来源"| PACKAGE
  PREP -->|"E-F6-03 加载准备来源"| PREP_AUTH
  PREP -->|"E-F6-04 提交prepared Event"| REPOSITORY
  INTENT -->|"E-F6-05 使用Delivery Schema"| WIRE
  CLAIM -->|"E-F6-06 Intent/Binding/观察闭合"| CLAIM_AUTH
  CLAIM -->|"E-F6-07 创建持久WorkClaim"| CLAIM_STORE
  CLAIM_STORE -->|"E-F6-08 Claim领域模型"| WORKCLAIM
  CLAIM -->|"E-F6-09 提交claimed Event"| REPOSITORY
  CLAIM -->|"E-F6-10 从Claim回执生成"| ACTION
  OUTCOME -->|"E-F6-11 读取Claim/Intent"| CLAIM_STORE
  OUTCOME -->|"E-F6-12 提交observed Event"| REPOSITORY
  REARM -->|"E-F6-13 精确rejected尾部"| REPOSITORY

  REPORT -->|"E-F6-14 Report Schema"| WIRE
  IMPORT -->|"E-F6-15 解析Agent Report"| REPORT
  IMPORT -->|"E-F6-16 创建TargetResult"| RESULT
  IMPORT -->|"E-F6-17 审计accepted来源/提交Event"| REPOSITORY
  RESULT -->|"E-F6-18 Result Schema"| WIRE

  SNAPSHOT -->|"E-F6-19 完整事件历史"| REPOSITORY
  DECISION -->|"E-F6-20 读取Review Snapshot"| SNAPSHOT
  DECISION -->|"E-F6-21 提交Decision Event"| REPOSITORY
  RESUME -->|"E-F6-22 读取blocked generation"| SNAPSHOT
  RESUME -->|"E-F6-23 提交Resume Event"| REPOSITORY
  ROUTE -->|"E-F6-24 Authority + Review Snapshot"| SNAPSHOT
  DECISION -->|"E-F6-25 Review Schema"| WIRE
  CLAIM_AUTH -->|"E-F6-26 Window观察"| BINDING
  CLAIM_AUTH -->|"E-F6-27 当前Binding加载"| BIND_AUTH
```

### 本图术语说明

| 图中术语 | 解释 |
| --- | --- |
| Binding闭合 | Intent目标窗口与当前私有Binding、Host Profile和期望逻辑根一致 |
| Claim authority | 创建WorkClaim和claimed Event前对Intent、观察、Binding、窗口占用与generation的闭合事实 |
| Implementation Report | Agent生成的实现结果输入；Wakeflow必须补齐并复验权威来源后才成为Implementation TargetResult |
| accepted来源 | 同一Intent/action/claim的host-effect-observed accepted事件 |
| blocked generation | Controller决定需要外部条件后暂停的精确Review轮次 |

## 文件与职责映射

| 文件编号 | 代表符号 | 职责 |
| --- | --- | --- |
| `F-DLV-01` | `TargetDeliveryPreparationService` | preview/apply准备Intent并提交prepared Event |
| `F-DLV-02` | `createTargetDeliveryIntent` | TaskPackage、返工投影和prompt核心的不可变Intent |
| `F-DLV-03` | `loadCurrentDeliveryWindowBinding` | Claim、Rearm与Test复用的当前私有Binding窄加载器 |
| `F-DLV-11` | Preparation Authority | 为implementation准备加载TaskPackage、Config拓扑、私有Binding与可选返工来源 |
| `F-DLV-04/05` | `TargetHostEffectClaimService`与Claim Authority | 新鲜观察、WorkClaim、claimed Event和Agent Action |
| `F-DLV-06/07` | WindowWorkClaim模型与Store | 0600当前窗口占用、exclusive create和exact release |
| `F-DLV-08` | `createTargetDeliveryAgentHostAction` | 从首次Claim Event回执生成一次性宿主动作 |
| `F-DLV-09/10` | Outcome/Rearm Services | 记录效果观察或显式重开rejected generation |
| `F-RES-01/02/03` | Report、TargetResult、Import Service | accepted来源闭合、不可变Result和Event提交 |
| `F-REV-01` | `readDemandResultReviewSnapshot` | 从Repository一次完整审计重建Review读模型 |
| `F-REV-02/03` | Implementation Decision / shared Resume Services | 提交实现审阅决定；Resume按workType恢复implementation或test blocked Event |
| `F-REV-04` | `readDemandPostAcceptanceRoute` | 从Authority和同修订Snapshot确定下一业务owner |

## F6边级证据

| 边编号 | 静态关系范围 | 核验结论 |
| --- | --- | --- |
| `E-F6-01`–`E-F6-05` | Preparation Service、Authority、Intent、TaskPackage/Repository/Schema | Preparation经专用Authority加载来源，不直接导入共享Binding loader |
| `E-F6-06`–`E-F6-13`、`E-F6-26`、`E-F6-27` | Claim/Outcome/Rearm、WorkClaim、Action与Binding | Claim Service导入并生成Action；Claim Authority复用当前Binding loader |
| `E-F6-14`–`E-F6-18` | Report、Result与Import Service | Shared Import按workType导入来源专用Report并提交统一Result Event |
| `E-F6-19`–`E-F6-25` | Snapshot、Decision/Resume、Route与Repository | 读模型可重建；Decision/Resume Event才改变权威状态 |

## 原始依赖快照

| 直接生产模块 | 当前全仓受检模块 | 当前全仓依赖 | 违规 |
| ---: | ---: | ---: | ---: |
| 69 | 723 | 5059 | 0 |

## 停止边界

- 本范围已进入`d17602e`；字段或依赖变化后必须重新核验。
- Agent Host Action是瞬时执行指令，不进入MCP公开结果或第二个持久状态机。
- Review读模型可重建；Decision/Resume Event才改变Demand事实。
