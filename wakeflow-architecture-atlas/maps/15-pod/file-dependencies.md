---
diagramId: ts-pod-file-dependencies
viewType: file-dependency
truthKind: current-code
reviewDepth: L3
verifiedAt: 2026-09-11
baselineCommit: 7ba1f38938a7387623b0ca588d9cfd54abda5760
sourceFingerprint: sha256:c4936035bf41ad806c09fe01fd403101220d4ebf9d740607c658f15ab3c6da30
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: mixed
sourcePaths:
  - src/capabilities/endpoint/*.ts
  - src/capabilities/endpoint/service.ts
  - src/capabilities/pod/*.ts
  - src/capabilities/pod/decide.ts
  - src/capabilities/pod/service.ts
  - src/configuration/*.ts
  - src/configuration/wakeflow-config-authority-replacement.ts
  - src/configuration/wakeflow-config-authority-snapshot.ts
  - src/configuration/wakeflow-config-v3.ts
  - src/contracts/generated/configuration/*.ts
  - src/contracts/generated/entrypoints/*.ts
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
  - src/governance/demand/model/*.ts
  - src/governance/demand/publication/*.ts
  - src/governance/evidence/*.ts
  - src/governance/ledger/*.ts
  - src/governance/lifecycle/*.ts
  - src/governance/result/*.ts
  - src/governance/review/*.ts
  - src/governance/tasking/*.ts
  - src/governance/testing/*.ts
  - src/kernel/*.ts
  - src/kernel/event-stream/*.ts
  - src/kernel/layout.ts
  - src/kernel/pod-worktree-receipts.ts
  - src/kernel/work-claims.ts
  - src/workspace/*.ts
  - src/workspace/active/*.ts
  - src/workspace/window-runtime/*.ts
schemaPaths:
  - src/contracts/schemas/configuration/wakeflow-config-v3.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-pod-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-pod-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-window-host-binding-registration-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-window-host-binding-registration-result.schema.json
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
  - src/contracts/schemas/workspace/window-runtime-registered-projection.schema.json
  - src/contracts/schemas/workspace/window-runtime-unregistered-projection.schema.json
testPaths:
  - tests/capabilities/pod/service.test.ts
refreshTriggers:
  - .dependency-cruiser.cjs
  - docs/decisions/0012-flow-convergence-callback-calls-testing-redesign.md
  - docs/decisions/0013-target-architecture-and-slice-plan.md
---

# Pod 与 worktree：文件直接导入

这是当前源码 AST 提取的审阅精选范围，只显示下表文件之间的真实直接导入。完整源码闭包可以继续沿导入下钻；此图不证明调用顺序。

> 核验基线：`7ba1f38`；核验时实现代码均已提交，本轮图谱更新另列。开发阶段为 L1 九片已落地，observation 尚未开始。本文说明实现事实，未宣称双宿主真实会话已经验证。

## Pod 与 worktree的精选直接导入

```mermaid
flowchart TB
  accTitle: Pod 与 worktree的精选直接导入
  accDescr: Pod 与 worktree所列具体文件之间的直接导入，不把静态依赖解释成运行调用。
  f1["能力执行 service.ts"]
  f2["纯决定 decide.ts"]
  f3["能力执行 service.ts"]
  f4["源码模块 pod-worktree-receipts.ts"]
  f5["源码模块 wakeflow-config-v3.ts"]
  f6["源码模块 wakeflow-config-authority-snapshot.ts"]
  f7["源码模块 wakeflow-config-authority-replacement.ts"]
  f8["工作声明 work-claims.ts"]
  f9["源码模块 layout.ts"]
  f1 -->|"E-L1064-01 直接导入"| f2
  f1 -->|"E-L1064-02 直接导入"| f4
  f1 -->|"E-L1064-03 直接导入"| f5
  f1 -->|"E-L1064-04 直接导入"| f6
  f1 -->|"E-L1064-05 直接导入"| f7
  f2 -->|"E-L1064-06 直接导入"| f5
  f3 -->|"E-L1064-07 直接导入"| f4
  f3 -->|"E-L1064-08 直接导入"| f5
  f3 -->|"E-L1064-09 直接导入"| f6
  f3 -->|"E-L1064-10 直接导入"| f8
  f3 -->|"E-L1064-11 直接导入"| f9
  f4 -->|"E-L1064-12 直接导入"| f9
  f6 -->|"E-L1064-13 直接导入"| f5
  f7 -->|"E-L1064-14 直接导入"| f6
  f8 -->|"E-L1064-15 直接导入"| f9
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| AST | 源码的语法树；直接导入自动提取，运行时调用顺序另行核实。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| f1 | `src/capabilities/pod/service.ts` | 能力执行 service.ts |
| f2 | `src/capabilities/pod/decide.ts` | 纯决定 decide.ts |
| f3 | `src/capabilities/endpoint/service.ts` | 能力执行 service.ts |
| f4 | `src/kernel/pod-worktree-receipts.ts` | 源码模块 pod-worktree-receipts.ts |
| f5 | `src/configuration/wakeflow-config-v3.ts` | 源码模块 wakeflow-config-v3.ts |
| f6 | `src/configuration/wakeflow-config-authority-snapshot.ts` | 源码模块 wakeflow-config-authority-snapshot.ts |
| f7 | `src/configuration/wakeflow-config-authority-replacement.ts` | 源码模块 wakeflow-config-authority-replacement.ts |
| f8 | `src/kernel/work-claims.ts` | 工作声明 work-claims.ts |
| f9 | `src/kernel/layout.ts` | 源码模块 layout.ts |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1064-01 | `src/capabilities/pod/service.ts` | `tests/capabilities/pod/service.test.ts` | 直接导入 |
| E-L1064-02 | `src/capabilities/pod/service.ts` | `tests/capabilities/pod/service.test.ts` | 直接导入 |
| E-L1064-03 | `src/capabilities/pod/service.ts` | `tests/capabilities/pod/service.test.ts` | 直接导入 |
| E-L1064-04 | `src/capabilities/pod/service.ts` | `tests/capabilities/pod/service.test.ts` | 直接导入 |
| E-L1064-05 | `src/capabilities/pod/service.ts` | `tests/capabilities/pod/service.test.ts` | 直接导入 |
| E-L1064-06 | `src/capabilities/pod/decide.ts` | `tests/capabilities/pod/service.test.ts` | 直接导入 |
| E-L1064-07 | `src/capabilities/endpoint/service.ts` | `tests/capabilities/pod/service.test.ts` | 直接导入 |
| E-L1064-08 | `src/capabilities/endpoint/service.ts` | `tests/capabilities/pod/service.test.ts` | 直接导入 |
| E-L1064-09 | `src/capabilities/endpoint/service.ts` | `tests/capabilities/pod/service.test.ts` | 直接导入 |
| E-L1064-10 | `src/capabilities/endpoint/service.ts` | `tests/capabilities/pod/service.test.ts` | 直接导入 |
| E-L1064-11 | `src/capabilities/endpoint/service.ts` | `tests/capabilities/pod/service.test.ts` | 直接导入 |
| E-L1064-12 | `src/kernel/pod-worktree-receipts.ts` | `tests/capabilities/pod/service.test.ts` | 直接导入 |
| E-L1064-13 | `src/configuration/wakeflow-config-authority-snapshot.ts` | `tests/capabilities/pod/service.test.ts` | 直接导入 |
| E-L1064-14 | `src/configuration/wakeflow-config-authority-replacement.ts` | `tests/capabilities/pod/service.test.ts` | 直接导入 |
| E-L1064-15 | `src/kernel/work-claims.ts` | `tests/capabilities/pod/service.test.ts` | 直接导入 |

## 守卫、恢复与验证范围

文件身份采用完整仓库相对路径；同名 service.ts、decide.ts 不靠文件名猜测。生成合同仍回指 Schema 权威。

涉及的测试与核验入口：

- `tests/capabilities/pod/service.test.ts`。

## 下钻与相关视图

- [本专题总览](./README.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
