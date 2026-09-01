---
diagramId: ts-review-completion-file-f7
viewType: file-dependency
truthKind: current-code
reviewDepth: L3
verifiedAt: 2026-09-01
snapshotObservedAt: 2026-09-01T06:42:28-07:00
baselineCommit: d17602ed9931a1898f713c740752c54b94bd8086
sourceFingerprint: sha256:b2fb77d6e677dd47b85eb174a423068e70aa60354582822d1d4b1e5a942c79f1
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Source Maintenance
generatedBy: mixed
sourcePaths: [src/governance/review/**, src/governance/lifecycle/**, src/governance/testing/**, src/governance/result/**, src/governance/delivery/**]
testPaths: [tests/governance/review/**, tests/governance/lifecycle/**, tests/governance/testing/**, tests/governance/result/**, tests/governance/delivery/**]
---

# Review返工与Completion：关键文件依赖

## F7：Review路由与Completion骨干

```mermaid
flowchart LR
  accTitle: Review返工blocked恢复与Demand Completion关键依赖
  accDescr: Review Snapshot从Demand Repository审计历史；Implementation/Test Decision分别导入共享合同，共享Resume按workType恢复blocked。Product Defect Remediation Service从Test Decision、Route与Snapshot创建Authorization Event，Delivery Context把授权映射回原TaskPackage Intent。Completion允许当前accepted Test与历史product-defect Target并存。

  subgraph ROOTS["Review"]
    SNAPSHOT["[已实现][F-REV-11]\ndemand-result-review-snapshot.ts"]
    DECIDE["[已实现][F-REV-12]\ncontroller-implementation-review-decision-service.ts"]
    RESUME["[已实现][F-REV-13]\ncontroller-target-review-resume-service.ts"]
    ROUTE["[已实现][F-REV-14]\ndemand-post-acceptance-route.ts"]
    TEST_DECIDE["[已实现][F-REV-15]\ncontroller-test-review-decision.ts"]
    COMMON_DECISION["[已实现][F-REV-16]\ncontroller-review-decision-contract.ts"]
    TEST_SERVICE["[已实现][F-REV-17]\ncontroller-test-review-decision-service.ts"]
    IMPL_DECISION["[已实现][F-REV-18]\ncontroller-implementation-review-decision.ts"]
    REMEDIATION["[已实现][F-REV-19]\ncontroller-product-defect-remediation-authorization.ts"]
    REMEDIATION_SERVICE["[已实现][F-REV-20]\ncontroller-product-defect-remediation-service.ts"]
  end
  subgraph SHARED_ENTRY["返工"]
    REWORK["[已实现][F-DLV-11]\ntarget-delivery-rework-context.ts"]
    INTENT["[已实现][F-DLV-12]\ntarget-delivery-intent.ts"]
    REMEDIATION_CONTEXT["[已实现][F-DLV-13]\ntarget-delivery-product-defect-remediation-context.ts"]
  end
  subgraph DOMAIN["Completion"]
    COMPLETION["[已实现][F-LIF-01]\ndemand-completion.ts"]
    PLAN["[已实现][F-LIF-02]\ndemand-completion-plan.ts"]
    AUTH["[已实现][F-LIF-03]\ndemand-completion-authority.ts"]
    SERVICE["[已实现][F-LIF-04]\ndemand-completion-service.ts"]
  end
  subgraph HOST_IMPL["相邻权威"]
    REPO["[外部] Demand Repository/Command Handler"]
    TODO["[外部] TODO Authority"]
    CLAIMS["[外部] WindowWorkClaim Store"]
    PACKAGE["[外部] immutable TaskPackage"]
  end
  WIRE["[生成][F-GEN-07]\nCompletion与Review生成合同"]

  SNAPSHOT -->|"E-F7-01 审计历史"| REPO
  DECIDE -->|"E-F7-02 当前Snapshot"| SNAPSHOT
  DECIDE -->|"E-F7-03 提交Decision"| REPO
  DECIDE -->|"E-F7-19 Implementation判断合同"| IMPL_DECISION
  IMPL_DECISION -->|"E-F7-25 共享审阅值合同"| COMMON_DECISION
  REMEDIATION -->|"E-F7-26 精确Test Decision来源"| TEST_DECIDE
  REMEDIATION -->|"E-F7-27 Authorization Schema"| WIRE
  REMEDIATION_SERVICE -->|"E-F7-28 创建Authorization"| REMEDIATION
  REMEDIATION_SERVICE -->|"E-F7-29 当前Route/Snapshot"| ROUTE
  REMEDIATION_SERVICE -->|"E-F7-30 提交Authorization Event"| REPO
  REMEDIATION_CONTEXT -->|"E-F7-31 解析Authorization"| REMEDIATION
  REMEDIATION_CONTEXT -->|"E-F7-32 投影Intent上下文"| INTENT
  TEST_DECIDE -->|"E-F7-20 Test判断矩阵"| COMMON_DECISION
  TEST_DECIDE -->|"E-F7-21 Test Review Schema"| WIRE
  TEST_SERVICE -->|"E-F7-22 Test判断合同"| TEST_DECIDE
  TEST_SERVICE -->|"E-F7-23 提交shared Decision Event"| REPO
  ROUTE -->|"E-F7-24 四类Test Review route"| SNAPSHOT
  RESUME -->|"E-F7-04 blocked Snapshot"| SNAPSHOT
  RESUME -->|"E-F7-05 提交Resume"| REPO
  ROUTE -->|"E-F7-06 Authority/历史"| SNAPSHOT
  REWORK -->|"E-F7-07 解析Implementation决定"| IMPL_DECISION
  INTENT -->|"E-F7-08 同一TaskPackage"| PACKAGE
  REWORK -->|"E-F7-09 复用Intent投影owner"| INTENT
  AUTH -->|"E-F7-10 completion route"| ROUTE
  AUTH -->|"E-F7-11 claimed TODO"| TODO
  AUTH -->|"E-F7-12 无当前Claims"| CLAIMS
  SERVICE -->|"E-F7-13 加载组合Authority"| AUTH
  SERVICE -->|"E-F7-14 创建Completion"| COMPLETION
  SERVICE -->|"E-F7-15 创建exact plan"| PLAN
  SERVICE -->|"E-F7-16 提交completed Event"| REPO
  COMPLETION -->|"E-F7-17 Completion Schema"| WIRE
  PLAN -->|"E-F7-18 完整Completion"| COMPLETION
```

### 本图术语说明

| 术语 | 解释 |
| --- | --- |
| Rework Context | 从完整Review文字确定性压缩的有界投递输入，不复制Decision权威 |
| completion route | Post-Acceptance Route明确允许进入成功终态的来源投影 |
| Completion Plan | 绑定Authority、Completion、expected revision、commitId和eventId的preview产物 |
| 无当前Claims | 与Demand相关的窗口不存在未释放WorkClaim |

## 文件职责

| 范围 | 关键职责 |
| --- | --- |
| Review Snapshot/Decision/Resume | implementation/test完整历史读模型、来源专用决定Event与共享精确blocked恢复Event |
| Test Review | Test conclusion、Evidence充分性、shared Decision Event和四类route；四类均有明确consumer或终态 |
| Remediation Authorization/Service | 精确绑定Test Decision、失败检查和产品baseline，提交Event并重开原产品Target |
| Remediation Delivery Context | 从Authorization投影原TaskPackage边界内的修复目标和required corrections |
| Post-Acceptance Route | testing/completion/blocked的确定性下一owner选择 |
| Rework Context/Intent | 同一TaskPackage的新投递generation |
| Completion Authority | Route、Controller、TODO和Claims组合准入 |
| Completion Service | preview/apply、幂等Commit和eventAuthority |

## F7直接导入核验

- `controller-implementation-review-decision-service.ts`直接导入来源专用Decision模型；共享值合同由
  `controller-implementation-review-decision.ts`和`controller-test-review-decision.ts`分别导入。
- `target-delivery-rework-context.ts`直接导入Implementation Decision、TargetResult及
  `target-delivery-intent.ts`中的投影函数；它不导入Review Snapshot，完整历史由Preparation Authority先加载。
- Completion只从Route投影`testingMode`进入Lifecycle；完整real-environment Test closure继续由Review拥有，
  避免Lifecycle反向取得Review内部类型并形成循环。
- Repository/Route以`currentTestCard`选择当前Test Target，历史`test-product-defect` Target继续保留原Card tuple。
- `controller-product-defect-remediation-service.ts`从当前Route/Snapshot/History创建Authorization并提交Event；
  `target-delivery-product-defect-remediation-context.ts`再把授权投影为同一TaskPackage的Delivery输入。

## F7边级证据

| 边编号 | 静态关系范围 | 核验结论 |
| --- | --- | --- |
| `E-F7-01`–`E-F7-09` | Implementation Snapshot/Decision/Resume、Rework Context与Intent | Rework Context导入Decision/Result和Intent投影owner，不导入Snapshot |
| `E-F7-10`–`E-F7-18` | Completion Authority/Service/Plan/合同 | Route、TODO与Claim准入后只提交一个completed Event |
| `E-F7-19`–`E-F7-27` | 来源Decision、共享合同、Test Service/Route与Remediation Authorization | 来源专用判断和授权合同闭合 |
| `E-F7-28`–`E-F7-32` | Remediation Service、Repository与Delivery Context | Authorization Event重开原Target并进入同Package返工Intent |

## 停止边界

Review/Lifecycle/Remediation已提交。当前停止边界是Research Completion、Implementation Redesign以及
Demand完成后的Evidence/Archive owner。
