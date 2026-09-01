---
diagramId: ts-real-testing-file-f8
viewType: file-dependency
truthKind: current-code
reviewDepth: L3
verifiedAt: 2026-09-01
snapshotObservedAt: 2026-09-01T06:42:28-07:00
baselineCommit: d17602ed9931a1898f713c740752c54b94bd8086
sourceFingerprint: sha256:7f70498f7256fe4cba57c95d0b89ad1c49297afa71d34cf3a0ed1dedef2f4604
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Source Maintenance
generatedBy: mixed
sourcePaths: [src/governance/testing/**, src/governance/tasking/**, src/governance/delivery/**, src/governance/result/**, src/governance/review/**, src/governance/lifecycle/**, src/entrypoints/**]
schemaPaths: [src/contracts/schemas/governance/testing/**, src/contracts/schemas/governance/tasking/**, src/contracts/schemas/governance/result/**, src/contracts/schemas/governance/review/**, src/contracts/schemas/governance/lifecycle/**, src/contracts/schemas/entrypoints/wakeflow-target-task-planning-request.schema.json]
testPaths: [tests/governance/testing/**, tests/governance/tasking/**, tests/governance/delivery/**, tests/governance/result/**, tests/governance/review/**, tests/governance/lifecycle/**, tests/entrypoints/**]
---

# 真实环境Testing：关键文件依赖

## F8：Testing骨干依赖

```mermaid
flowchart LR
  accTitle: TestCard Test Delivery与Dispatch关键文件依赖
  accDescr: 公共TestCard Planning创建Card事件；同一公共Task Planning工具从Card派生test Package。Test Delivery Preparation组合Card、Package、initial或rerun Attempt与Authority并创建Intent；replacement只追加当前attempt授权。共享Claim/Outcome/Result记录宿主事实，Test Review提交Decision Event；accept、another、blocked与product-defect分别进入Completion、rerun、Resume或Remediation/retest。

  subgraph ROOTS["TestCard"]
    CARD["[已实现][F-TST-01]\ntest-card.ts"]
    CARD_PLAN["[已实现][F-TST-02]\ntest-card-planning-service.ts"]
    CARD_AUTH["[已实现][F-TST-03]\ntest-card-planning-authority.ts"]
  end
  subgraph SHARED_ENTRY["Test Task"]
    TASK_PACKAGE["[已实现][F-TST-04]\ntest-task-package.ts"]
    TASK_AUTH["[已实现][F-TST-05]\ntest-task-planning-authority.ts"]
    ATTEMPT["[已实现][F-TST-06]\ntest-execution-attempt.ts"]
  end
  subgraph DOMAIN["Test Delivery"]
    PREPARE["[已实现][F-TST-07]\ntest-delivery-preparation-service.ts"]
    INTENT["[已实现][F-TST-08]\ntest-delivery-intent.ts"]
    PREP_AUTH["[已实现][F-TST-09]\ntest-delivery-preparation-authority.ts"]
  end
  subgraph HOST_ENTRY["Dispatch投影"]
    BRIEF["[已实现][F-TST-10]\ntest-dispatch-briefing.ts"]
    PACKET["[已实现][F-TST-11]\ntest-dispatch-packet.ts"]
    PROJECTION["[已实现][F-TST-12]\ntest-dispatch-projection-store.ts"]
  end
  subgraph HOST_IMPL["宿主效果"]
    CLAIM_AUTH["[已实现][F-TST-13]\ntest-host-effect-claim-authority.ts"]
    ACTION["[已实现][F-TST-14]\ntest-delivery-agent-host-action.ts"]
    CLAIM_SERVICE["[已实现][F-DLV-21]\ntarget-host-effect-claim-service.ts"]
    OUTCOME_SERVICE["[已实现][F-DLV-22]\ntarget-host-effect-outcome-service.ts"]
    RESULT_REPORT["[已实现][F-RES-11]\ntest-target-result-report.ts"]
    RESULT_IMPORT["[已实现][F-RES-12]\ntarget-result-import-service.ts"]
    TEST_DECISION["[已实现][F-REV-21]\ncontroller-test-review-decision.ts"]
    TEST_REVIEW["[已实现][F-REV-22]\ncontroller-test-review-decision-service.ts"]
    REMEDIATION["[已实现][F-REV-23]\ncontroller-product-defect-remediation-service.ts"]
    GENERATION["[已实现][F-TST-15]\ntest-card-generation-source.ts"]
    REPO["[外部] Demand Repository/Command Handler"]
  end
  WIRE["[生成][F-GEN-08]\nTesting + Test Result/Review合同"]

  CARD_PLAN -->|"E-F8-01 Authority"| CARD_AUTH
  CARD_PLAN -->|"E-F8-02 创建TestCard"| CARD
  CARD_PLAN -->|"E-F8-03 提交Card Event"| REPO
  TASK_PACKAGE -->|"E-F8-04 从Card派生"| CARD
  TASK_AUTH -->|"E-F8-05 Card Event/route"| REPO
  TASK_AUTH -->|"E-F8-06 复验Test Package"| TASK_PACKAGE
  ATTEMPT -->|"E-F8-07 setup来源"| CARD
  PREPARE -->|"E-F8-08 Delivery Authority"| PREP_AUTH
  PREPARE -->|"E-F8-09 创建Intent"| INTENT
  PREPARE -->|"E-F8-10 提交prepared Event"| REPO
  PREP_AUTH -->|"E-F8-30 initial/rerun lineage"| ATTEMPT
  INTENT -->|"E-F8-11 Card/Package/Attempt"| ATTEMPT
  PACKET -->|"E-F8-12 prepared Event来源"| INTENT
  PACKET -->|"E-F8-13 briefing"| BRIEF
  PROJECTION -->|"E-F8-14 派生Packet/Card"| PACKET
  PROJECTION -->|"E-F8-15 审计事件"| REPO
  CLAIM_AUTH -->|"E-F8-16 加载prepared Intent"| REPO
  CLAIM_AUTH -->|"E-F8-17 Dispatch来源"| PACKET
  CLAIM_SERVICE -->|"E-F8-18 首次Claim回执生成Action"| ACTION
  CLAIM_SERVICE -->|"E-F8-19 加载Test Claim Authority"| CLAIM_AUTH
  OUTCOME_SERVICE -->|"E-F8-31 提交observed Event"| REPO
  CARD -->|"E-F8-20 TestCard Schema"| WIRE
  INTENT -->|"E-F8-21 Intent Schema"| WIRE
  ATTEMPT -->|"E-F8-22 Attempt Schema"| WIRE
  PACKET -->|"E-F8-23 Packet Schema"| WIRE
  RESULT_REPORT -->|"E-F8-24 Test Report Schema"| WIRE
  RESULT_IMPORT -->|"E-F8-25 解析并闭合Report"| RESULT_REPORT
  RESULT_IMPORT -->|"E-F8-26 提交shared Result Event"| REPO
  TEST_DECISION -->|"E-F8-27 Test Review Schema"| WIRE
  TEST_REVIEW -->|"E-F8-28 复验Test Decision"| TEST_DECISION
  TEST_REVIEW -->|"E-F8-29 提交shared Decision Event"| REPO
  REMEDIATION -->|"E-F8-32 product-defect授权Event"| REPO
  CARD_AUTH -->|"E-F8-33 retest lineage"| GENERATION
```

### 本图术语说明

| 术语 | 解释 |
| --- | --- |
| Test Delivery Authority | Card、Package、Attempt、Config、窗口和替换授权的组合准入 |
| briefing | 面向目标测试窗口的有界中文/英文执行说明，不替代Card或Packet合同 |
| Card Projection | 从TestCard Event物化的目标读取文件 |
| prepared Intent | 已提交测试授权但尚未产生WorkClaim或宿主效果 |
| Test Review | Test conclusion、Evidence充分性与四类Decision；四类均有明确consumer |
| retest lineage | 新Card对旧Card、Test Decision和Remediation Authorization的精确来源 |
| rerun lineage | 新attempt对直接前驱attempt、Result与request-another-attempt Decision的精确引用链 |

## F8直接导入核验

| 边范围 | 核验结论 |
| --- | --- |
| `E-F8-01`–`E-F8-07` | Card、Test TaskPackage与Attempt的直接imports成立；公共Planning按Route消费test分支 |
| `E-F8-08`–`E-F8-15`、`E-F8-30` | Preparation直接组合Authority/Intent，Authority读取initial/rerun lineage，Projection从Event派生Packet |
| `E-F8-16`–`E-F8-19`、`E-F8-31` | 共享Claim Service导入Test Claim Authority与Action；Outcome Service提交observed Event，方向不是Action调用Service |
| `E-F8-24`–`E-F8-29` | 共享Result Import导入Test Report；Test Review Service导入Test Decision并提交shared Event |
| `E-F8-20`–`E-F8-23` | TestCard、Intent、Attempt与Dispatch Packet分别依赖自己的生成Schema合同 |
| `E-F8-32`、`E-F8-33` | Remediation与TestCard generation source | 产品返工授权后新Card闭合retest lineage |

## 原始依赖快照

| Testing生产模块 | 当前全仓受检模块 | 当前全仓依赖 | 违规 |
| ---: | ---: | ---: | ---: |
| 23 | 710 | 4967 | 0 |

## 停止边界

Testing已进入`d17602e`；rerun、real-environment Completion、blocked Resume和product-defect Remediation/retest
均有真实consumer。真实宿主效果仍由Agent执行，MCP只签发Action并记录观察。
