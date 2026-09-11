---
diagramId: ts-delivery-review-file-f6
viewType: file-dependency
truthKind: current-code
reviewDepth: L3
verifiedAt: 2026-09-11
baselineCommit: 7ba1f38938a7387623b0ca588d9cfd54abda5760
sourceFingerprint: sha256:1ca679a1a40092d0cdbf13fea094a52290fef411397485cbd266cc2689eb0e53
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: mixed
sourcePaths:
  - src/capabilities/delivery/*.ts
  - src/capabilities/delivery/decide.ts
  - src/capabilities/delivery/prompt.ts
  - src/capabilities/delivery/service.ts
  - src/capabilities/result-review/*.ts
  - src/capabilities/result-review/service.ts
  - src/configuration/*.ts
  - src/contracts/generated/configuration/*.ts
  - src/contracts/generated/entrypoints/*.ts
  - src/contracts/generated/foundation/*.ts
  - src/contracts/generated/governance/delivery/*.ts
  - src/contracts/generated/governance/demand/*.ts
  - src/contracts/generated/governance/evidence/*.ts
  - src/contracts/generated/governance/ledger/*.ts
  - src/contracts/generated/governance/lifecycle/*.ts
  - src/contracts/generated/governance/result/*.ts
  - src/contracts/generated/governance/review/*.ts
  - src/contracts/generated/governance/tasking/*.ts
  - src/contracts/generated/governance/testing/*.ts
  - src/contracts/generated/identity/*.ts
  - src/contracts/generated/workspace/*.ts
  - src/contracts/identity/*.ts
  - src/contracts/vocabulary/*.ts
  - src/foundation/artifact/*.ts
  - src/foundation/crypto/*.ts
  - src/foundation/data/*.ts
  - src/foundation/event-sourcing/*.ts
  - src/foundation/filesystem/*.ts
  - src/foundation/git/*.ts
  - src/foundation/identity/*.ts
  - src/foundation/node/*.ts
  - src/foundation/numeric/*.ts
  - src/foundation/resource/*.ts
  - src/foundation/schema/*.ts
  - src/foundation/text/*.ts
  - src/foundation/time/*.ts
  - src/governance/controller/*.ts
  - src/governance/delivery/*.ts
  - src/governance/delivery/delivery-envelope.ts
  - src/governance/delivery/delivery-outcome.ts
  - src/governance/delivery/delivery-rearm.ts
  - src/governance/demand/*.ts
  - src/governance/demand/event-sourcing/*.ts
  - src/governance/demand/model/*.ts
  - src/governance/demand/publication/*.ts
  - src/governance/evidence/*.ts
  - src/governance/ledger/*.ts
  - src/governance/lifecycle/*.ts
  - src/governance/result/*.ts
  - src/governance/result/target-result-callback.ts
  - src/governance/review/*.ts
  - src/governance/tasking/*.ts
  - src/governance/testing/*.ts
  - src/kernel/*.ts
  - src/kernel/event-stream/*.ts
  - src/kernel/hook-observations.ts
  - src/kernel/work-claims.ts
  - src/workspace/*.ts
  - src/workspace/active/*.ts
  - src/workspace/window-runtime/*.ts
schemaPaths:
  - src/contracts/schemas/configuration/wakeflow-config-v3.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-implementation-review-decision-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-implementation-review-decision-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-prepare-delivery-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-prepare-delivery-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-rearm-delivery-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-rearm-delivery-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-record-delivery-outcome-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-record-delivery-outcome-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-target-result-import-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-target-result-import-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-target-result-review-inspection-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-target-result-review-inspection-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-test-review-decision-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-test-review-decision-result.schema.json
  - src/contracts/schemas/foundation/directory-tree-candidate-plan.schema.json
  - src/contracts/schemas/foundation/git-object-id.schema.json
  - src/contracts/schemas/foundation/loaded-artifact-tree-manifest.schema.json
  - src/contracts/schemas/foundation/portable-resource-path.schema.json
  - src/contracts/schemas/foundation/sha256-digest.schema.json
  - src/contracts/schemas/foundation/utc-instant.schema.json
  - src/contracts/schemas/governance/delivery/delivery-envelope.schema.json
  - src/contracts/schemas/governance/delivery/delivery-outcome.schema.json
  - src/contracts/schemas/governance/delivery/delivery-rearm.schema.json
  - src/contracts/schemas/governance/demand/callback-reissued-event-data-v1.schema.json
  - src/contracts/schemas/governance/demand/controller-target-review-decided-event-data-v1.schema.json
  - src/contracts/schemas/governance/demand/decision-recorded-event-data-v1.schema.json
  - src/contracts/schemas/governance/demand/delivery-outcome-recorded-event-data-v1.schema.json
  - src/contracts/schemas/governance/demand/delivery-prepared-event-data-v1.schema.json
  - src/contracts/schemas/governance/demand/delivery-rearmed-event-data-v1.schema.json
  - src/contracts/schemas/governance/demand/demand-aggregate-state.schema.json
  - src/contracts/schemas/governance/demand/demand-authority.schema.json
  - src/contracts/schemas/governance/demand/demand-cancelled-event-data-v1.schema.json
  - src/contracts/schemas/governance/demand/demand-completed-event-data-v1.schema.json
  - src/contracts/schemas/governance/demand/demand-continued-event-data-v1.schema.json
  - src/contracts/schemas/governance/demand/demand-escalated-event-data-v1.schema.json
  - src/contracts/schemas/governance/demand/demand-event-sourcing-snapshot.schema.json
  - src/contracts/schemas/governance/demand/demand-event-sourcing-stored-event.schema.json
  - src/contracts/schemas/governance/demand/demand-event-stream-commit.schema.json
  - src/contracts/schemas/governance/demand/demand-identity.schema.json
  - src/contracts/schemas/governance/demand/demand-published-event-data-v1.schema.json
  - src/contracts/schemas/governance/demand/managed-evidence-recorded-event-data-v1.schema.json
  - src/contracts/schemas/governance/demand/product-defect-remediation-authorized-event-data-v1.schema.json
  - src/contracts/schemas/governance/demand/target-result-recorded-event-data-v1.schema.json
  - src/contracts/schemas/governance/demand/target-task-planned-event-data-v1.schema.json
  - src/contracts/schemas/governance/evidence/managed-evidence-manifest.schema.json
  - src/contracts/schemas/governance/evidence/managed-evidence-publication-transaction.schema.json
  - src/contracts/schemas/governance/ledger/ledger-authority-member-reference.schema.json
  - src/contracts/schemas/governance/ledger/ledger-record-publication-intent.schema.json
  - src/contracts/schemas/governance/ledger/requirement-lineage.schema.json
  - src/contracts/schemas/governance/ledger/requirement-record.schema.json
  - src/contracts/schemas/governance/lifecycle/demand-completion.schema.json
  - src/contracts/schemas/governance/result/implementation-target-result-report.schema.json
  - src/contracts/schemas/governance/result/target-result.schema.json
  - src/contracts/schemas/governance/result/test-target-result-report.schema.json
  - src/contracts/schemas/governance/review/controller-implementation-review-decision.schema.json
  - src/contracts/schemas/governance/review/controller-product-defect-remediation-authorization.schema.json
  - src/contracts/schemas/governance/review/controller-test-review-decision.schema.json
  - src/contracts/schemas/governance/tasking/task-package.schema.json
  - src/contracts/schemas/governance/testing/test-execution-attempt.schema.json
  - src/contracts/schemas/identity/wakeflow-durable-id-kind.schema.json
  - src/contracts/schemas/workspace/window-host-binding.schema.json
testPaths:
  - tests/capabilities/delivery/service.test.ts
refreshTriggers:
  - .dependency-cruiser.cjs
  - docs/decisions/0012-flow-convergence-callback-calls-testing-redesign.md
  - docs/decisions/0013-target-architecture-and-slice-plan.md
---

# 投递与结果：文件直接导入

这是当前源码 AST 提取的审阅精选范围，只显示下表文件之间的真实直接导入。完整源码闭包可以继续沿导入下钻；此图不证明调用顺序。

> 核验基线：`7ba1f38`；核验时实现代码均已提交，本轮图谱更新另列。开发阶段为 L1 九片已落地，observation 尚未开始。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 投递与结果的精选直接导入

```mermaid
flowchart TB
  accTitle: 投递与结果的精选直接导入
  accDescr: 投递与结果所列具体文件之间的直接导入，不把静态依赖解释成运行调用。
  f1["能力执行 service.ts"]
  f2["纯决定 decide.ts"]
  f3["源码模块 prompt.ts"]
  f4["源码模块 delivery-envelope.ts"]
  f5["源码模块 delivery-outcome.ts"]
  f6["源码模块 delivery-rearm.ts"]
  f7["工作声明 work-claims.ts"]
  f8["宿主观察 hook-observations.ts"]
  f9["能力执行 service.ts"]
  f10["源码模块 target-result-callback.ts"]
  f1 -->|"E-L1025-01 直接导入"| f2
  f1 -->|"E-L1025-02 直接导入"| f3
  f1 -->|"E-L1025-03 直接导入"| f4
  f1 -->|"E-L1025-04 直接导入"| f5
  f1 -->|"E-L1025-05 直接导入"| f6
  f1 -->|"E-L1025-06 直接导入"| f7
  f1 -->|"E-L1025-07 直接导入"| f8
  f1 -->|"E-L1025-08 直接导入"| f10
  f2 -->|"E-L1025-09 直接导入"| f5
  f2 -->|"E-L1025-10 直接导入"| f6
  f3 -->|"E-L1025-11 直接导入"| f2
  f3 -->|"E-L1025-12 直接导入"| f4
  f5 -->|"E-L1025-13 直接导入"| f4
  f6 -->|"E-L1025-14 直接导入"| f4
  f9 -->|"E-L1025-15 直接导入"| f4
  f9 -->|"E-L1025-16 直接导入"| f7
  f9 -->|"E-L1025-17 直接导入"| f8
  f9 -->|"E-L1025-18 直接导入"| f10
  f10 -->|"E-L1025-19 直接导入"| f4
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| AST | 源码的语法树；直接导入自动提取，运行时调用顺序另行核实。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| f1 | `src/capabilities/delivery/service.ts` | 能力执行 service.ts |
| f2 | `src/capabilities/delivery/decide.ts` | 纯决定 decide.ts |
| f3 | `src/capabilities/delivery/prompt.ts` | 源码模块 prompt.ts |
| f4 | `src/governance/delivery/delivery-envelope.ts` | 源码模块 delivery-envelope.ts |
| f5 | `src/governance/delivery/delivery-outcome.ts` | 源码模块 delivery-outcome.ts |
| f6 | `src/governance/delivery/delivery-rearm.ts` | 源码模块 delivery-rearm.ts |
| f7 | `src/kernel/work-claims.ts` | 工作声明 work-claims.ts |
| f8 | `src/kernel/hook-observations.ts` | 宿主观察 hook-observations.ts |
| f9 | `src/capabilities/result-review/service.ts` | 能力执行 service.ts |
| f10 | `src/governance/result/target-result-callback.ts` | 源码模块 target-result-callback.ts |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1025-01 | `src/capabilities/delivery/service.ts` | `tests/capabilities/delivery/service.test.ts` | 直接导入 |
| E-L1025-02 | `src/capabilities/delivery/service.ts` | `tests/capabilities/delivery/service.test.ts` | 直接导入 |
| E-L1025-03 | `src/capabilities/delivery/service.ts` | `tests/capabilities/delivery/service.test.ts` | 直接导入 |
| E-L1025-04 | `src/capabilities/delivery/service.ts` | `tests/capabilities/delivery/service.test.ts` | 直接导入 |
| E-L1025-05 | `src/capabilities/delivery/service.ts` | `tests/capabilities/delivery/service.test.ts` | 直接导入 |
| E-L1025-06 | `src/capabilities/delivery/service.ts` | `tests/capabilities/delivery/service.test.ts` | 直接导入 |
| E-L1025-07 | `src/capabilities/delivery/service.ts` | `tests/capabilities/delivery/service.test.ts` | 直接导入 |
| E-L1025-08 | `src/capabilities/delivery/service.ts` | `tests/capabilities/delivery/service.test.ts` | 直接导入 |
| E-L1025-09 | `src/capabilities/delivery/decide.ts` | `tests/capabilities/delivery/service.test.ts` | 直接导入 |
| E-L1025-10 | `src/capabilities/delivery/decide.ts` | `tests/capabilities/delivery/service.test.ts` | 直接导入 |
| E-L1025-11 | `src/capabilities/delivery/prompt.ts` | `tests/capabilities/delivery/service.test.ts` | 直接导入 |
| E-L1025-12 | `src/capabilities/delivery/prompt.ts` | `tests/capabilities/delivery/service.test.ts` | 直接导入 |
| E-L1025-13 | `src/governance/delivery/delivery-outcome.ts` | `tests/capabilities/delivery/service.test.ts` | 直接导入 |
| E-L1025-14 | `src/governance/delivery/delivery-rearm.ts` | `tests/capabilities/delivery/service.test.ts` | 直接导入 |
| E-L1025-15 | `src/capabilities/result-review/service.ts` | `tests/capabilities/delivery/service.test.ts` | 直接导入 |
| E-L1025-16 | `src/capabilities/result-review/service.ts` | `tests/capabilities/delivery/service.test.ts` | 直接导入 |
| E-L1025-17 | `src/capabilities/result-review/service.ts` | `tests/capabilities/delivery/service.test.ts` | 直接导入 |
| E-L1025-18 | `src/capabilities/result-review/service.ts` | `tests/capabilities/delivery/service.test.ts` | 直接导入 |
| E-L1025-19 | `src/governance/result/target-result-callback.ts` | `tests/capabilities/delivery/service.test.ts` | 直接导入 |

## 守卫、恢复与验证范围

文件身份采用完整仓库相对路径；同名 service.ts、decide.ts 不靠文件名猜测。生成合同仍回指 Schema 权威。

涉及的测试与核验入口：

- `tests/capabilities/delivery/service.test.ts`。

## 下钻与相关视图

- [本专题总览](./README.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
