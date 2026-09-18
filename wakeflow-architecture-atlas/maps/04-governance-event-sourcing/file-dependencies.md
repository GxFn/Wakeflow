---
diagramId: ts-governance-demand-file-f4
viewType: file-dependency
truthKind: current-code
reviewDepth: L3
verifiedAt: 2026-09-18
baselineCommit: 1480271ecc8a6c17bb9042321644402bd6cbda56
sourceFingerprint: sha256:a6b63f38be8bf915cc2ad9a974b6028d3d8d69c2274cde5b4f3f66deeb26343d
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: mixed
sourcePaths:
  - src/configuration/*.ts
  - src/contracts/generated/configuration/*.ts
  - src/contracts/generated/foundation/*.ts
  - src/contracts/generated/governance/board/*.ts
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
  - src/governance/delivery/*.ts
  - src/governance/demand/*.ts
  - src/governance/demand/event-sourcing/*.ts
  - src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.ts
  - src/governance/demand/event-sourcing/demand-event-sourcing-decider.ts
  - src/governance/demand/event-sourcing/demand-event-sourcing-repository.ts
  - src/governance/demand/event-sourcing/demand-event-stream-commit.ts
  - src/governance/demand/event-sourcing/demand-file-event-snapshot-store.ts
  - src/governance/demand/event-sourcing/demand-file-event-store.ts
  - src/governance/demand/model/*.ts
  - src/governance/demand/model/demand-aggregate-state.ts
  - src/governance/demand/publication/*.ts
  - src/governance/demand/publication/demand-event-sourcing-publication-package.ts
  - src/governance/demand/publication/demand-event-sourcing-publication-service.ts
  - src/governance/evidence/*.ts
  - src/governance/ledger/*.ts
  - src/governance/lifecycle/*.ts
  - src/governance/result/*.ts
  - src/governance/review/*.ts
  - src/governance/tasking/*.ts
  - src/governance/testing/*.ts
  - src/kernel/*.ts
  - src/kernel/event-stream/*.ts
  - src/kernel/event-stream/stream-index.ts
  - src/workspace/*.ts
  - src/workspace/window-runtime/*.ts
schemaPaths:
  - src/contracts/schemas/configuration/wakeflow-config-v3.schema.json
  - src/contracts/schemas/foundation/directory-tree-candidate-plan.schema.json
  - src/contracts/schemas/foundation/git-object-id.schema.json
  - src/contracts/schemas/foundation/loaded-artifact-tree-manifest.schema.json
  - src/contracts/schemas/foundation/portable-resource-path.schema.json
  - src/contracts/schemas/foundation/sha256-digest.schema.json
  - src/contracts/schemas/foundation/utc-instant.schema.json
  - src/contracts/schemas/governance/board/requirement-claim-state.schema.json
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
  - src/contracts/schemas/governance/demand/demand-event-sourcing-publication-transaction.schema.json
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
  - tests/governance/demand/demand-event-sourcing-command-handler.test.ts
refreshTriggers:
  - .dependency-cruiser.cjs
  - docs/decisions/0012-flow-convergence-callback-calls-testing-redesign.md
  - docs/decisions/0013-target-architecture-and-slice-plan.md
---

# 事件与聚合：文件直接导入

这是当前源码 AST 提取的审阅精选范围，只显示下表文件之间的真实直接导入。完整源码闭包可以继续沿导入下钻；此图不证明调用顺序。

> 核验基线：`1480271`（L1 observation 第十片已落地，20 个公共工具、18 个一次性场景）。工作树另有并行未提交改动（宿主 hook 通道等），本图不描绘；来源指纹按当前工作树计算。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 事件与聚合的精选直接导入

```mermaid
flowchart TB
  accTitle: 事件与聚合的精选直接导入
  accDescr: 事件与聚合所列具体文件之间的直接导入，不把静态依赖解释成运行调用。
  f1["命令处理 demand-event-sourcing-command-handler.ts"]
  f2["事件仓储 demand-event-sourcing-repository.ts"]
  f3["源码模块 demand-event-sourcing-decider.ts"]
  f4["源码模块 demand-aggregate-state.ts"]
  f5["源码模块 demand-event-stream-commit.ts"]
  f6["源码模块 demand-file-event-store.ts"]
  f7["源码模块 demand-file-event-snapshot-store.ts"]
  f8["源码模块 stream-index.ts"]
  f9["源码模块 demand-event-sourcing-publication-service.ts"]
  f10["源码模块 demand-event-sourcing-publication-package.ts"]
  f1 -->|"E-L1015-01 直接导入"| f2
  f1 -->|"E-L1015-02 直接导入"| f3
  f1 -->|"E-L1015-03 直接导入"| f5
  f1 -->|"E-L1015-04 直接导入"| f6
  f2 -->|"E-L1015-05 直接导入"| f4
  f2 -->|"E-L1015-06 直接导入"| f5
  f2 -->|"E-L1015-07 直接导入"| f6
  f2 -->|"E-L1015-08 直接导入"| f7
  f3 -->|"E-L1015-09 直接导入"| f4
  f5 -->|"E-L1015-10 直接导入"| f3
  f5 -->|"E-L1015-11 直接导入"| f4
  f6 -->|"E-L1015-12 直接导入"| f5
  f6 -->|"E-L1015-13 直接导入"| f8
  f7 -->|"E-L1015-14 直接导入"| f6
  f9 -->|"E-L1015-15 直接导入"| f10
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| AST | 源码的语法树；直接导入自动提取，运行时调用顺序另行核实。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| f1 | `src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.ts` | 命令处理 demand-event-sourcing-command-handler.ts |
| f2 | `src/governance/demand/event-sourcing/demand-event-sourcing-repository.ts` | 事件仓储 demand-event-sourcing-repository.ts |
| f3 | `src/governance/demand/event-sourcing/demand-event-sourcing-decider.ts` | 源码模块 demand-event-sourcing-decider.ts |
| f4 | `src/governance/demand/model/demand-aggregate-state.ts` | 源码模块 demand-aggregate-state.ts |
| f5 | `src/governance/demand/event-sourcing/demand-event-stream-commit.ts` | 源码模块 demand-event-stream-commit.ts |
| f6 | `src/governance/demand/event-sourcing/demand-file-event-store.ts` | 源码模块 demand-file-event-store.ts |
| f7 | `src/governance/demand/event-sourcing/demand-file-event-snapshot-store.ts` | 源码模块 demand-file-event-snapshot-store.ts |
| f8 | `src/kernel/event-stream/stream-index.ts` | 源码模块 stream-index.ts |
| f9 | `src/governance/demand/publication/demand-event-sourcing-publication-service.ts` | 源码模块 demand-event-sourcing-publication-service.ts |
| f10 | `src/governance/demand/publication/demand-event-sourcing-publication-package.ts` | 源码模块 demand-event-sourcing-publication-package.ts |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1015-01 | `src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.ts` | `tests/governance/demand/demand-event-sourcing-command-handler.test.ts` | 直接导入 |
| E-L1015-02 | `src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.ts` | `tests/governance/demand/demand-event-sourcing-command-handler.test.ts` | 直接导入 |
| E-L1015-03 | `src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.ts` | `tests/governance/demand/demand-event-sourcing-command-handler.test.ts` | 直接导入 |
| E-L1015-04 | `src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.ts` | `tests/governance/demand/demand-event-sourcing-command-handler.test.ts` | 直接导入 |
| E-L1015-05 | `src/governance/demand/event-sourcing/demand-event-sourcing-repository.ts` | `tests/governance/demand/demand-event-sourcing-command-handler.test.ts` | 直接导入 |
| E-L1015-06 | `src/governance/demand/event-sourcing/demand-event-sourcing-repository.ts` | `tests/governance/demand/demand-event-sourcing-command-handler.test.ts` | 直接导入 |
| E-L1015-07 | `src/governance/demand/event-sourcing/demand-event-sourcing-repository.ts` | `tests/governance/demand/demand-event-sourcing-command-handler.test.ts` | 直接导入 |
| E-L1015-08 | `src/governance/demand/event-sourcing/demand-event-sourcing-repository.ts` | `tests/governance/demand/demand-event-sourcing-command-handler.test.ts` | 直接导入 |
| E-L1015-09 | `src/governance/demand/event-sourcing/demand-event-sourcing-decider.ts` | `tests/governance/demand/demand-event-sourcing-command-handler.test.ts` | 直接导入 |
| E-L1015-10 | `src/governance/demand/event-sourcing/demand-event-stream-commit.ts` | `tests/governance/demand/demand-event-sourcing-command-handler.test.ts` | 直接导入 |
| E-L1015-11 | `src/governance/demand/event-sourcing/demand-event-stream-commit.ts` | `tests/governance/demand/demand-event-sourcing-command-handler.test.ts` | 直接导入 |
| E-L1015-12 | `src/governance/demand/event-sourcing/demand-file-event-store.ts` | `tests/governance/demand/demand-event-sourcing-command-handler.test.ts` | 直接导入 |
| E-L1015-13 | `src/governance/demand/event-sourcing/demand-file-event-store.ts` | `tests/governance/demand/demand-event-sourcing-command-handler.test.ts` | 直接导入 |
| E-L1015-14 | `src/governance/demand/event-sourcing/demand-file-event-snapshot-store.ts` | `tests/governance/demand/demand-event-sourcing-command-handler.test.ts` | 直接导入 |
| E-L1015-15 | `src/governance/demand/publication/demand-event-sourcing-publication-service.ts` | `tests/governance/demand/demand-event-sourcing-command-handler.test.ts` | 直接导入 |

## 守卫、恢复与验证范围

文件身份采用完整仓库相对路径；同名 service.ts、decide.ts 不靠文件名猜测。生成合同仍回指 Schema 权威。

涉及的测试与核验入口：

- `tests/governance/demand/demand-event-sourcing-command-handler.test.ts`。

## 下钻与相关视图

- [本专题总览](./README.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
