---
diagramId: ts-real-testing-x0
viewType: vertical-slice
truthKind: current-code
reviewDepth: L2
verifiedAt: 2026-09-18
baselineCommit: 1480271ecc8a6c17bb9042321644402bd6cbda56
sourceFingerprint: sha256:0d8a547181fedfbcd359bc4674d04ed1b31079e0a757bbd976027c4fd9f4eb36
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: manual-review
sourcePaths:
  - src/capabilities/delivery/*.ts
  - src/capabilities/delivery/service.ts
  - src/capabilities/result-review/*.ts
  - src/capabilities/result-review/decide.ts
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
  - src/governance/demand/*.ts
  - src/governance/demand/event-sourcing/*.ts
  - src/governance/demand/model/*.ts
  - src/governance/demand/publication/*.ts
  - src/governance/evidence/*.ts
  - src/governance/ledger/*.ts
  - src/governance/lifecycle/*.ts
  - src/governance/result/*.ts
  - src/governance/result/test-target-result-report.ts
  - src/governance/review/*.ts
  - src/governance/tasking/*.ts
  - src/governance/tasking/task-package.ts
  - src/governance/testing/*.ts
  - src/kernel/*.ts
  - src/kernel/event-stream/*.ts
  - src/workspace/*.ts
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
  - tests/capabilities/result-review/service.test.ts
  - tests/capabilities/tasking/service.test.ts
refreshTriggers:
  - .dependency-cruiser.cjs
  - docs/decisions/0012-flow-convergence-callback-calls-testing-redesign.md
  - docs/decisions/0013-target-architecture-and-slice-plan.md
---

# 测试：任务合同、逐步记录与基线对比

testContract 已替代独立 TestCard。Test 执行冻结步骤并记录观察，Controller 决定接受、重跑、阻塞或升级；真实宿主实跑仍未纳入本轮声明。

> 核验基线：`1480271`（L1 observation 第十片已落地，20 个公共工具、18 个一次性场景）。工作树另有并行未提交改动（宿主 hook 通道等），本图不描绘；来源指纹按当前工作树计算。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 测试合同到 Controller 决定

```mermaid
flowchart TB
  accTitle: 测试合同到 Controller 决定
  accDescr: 测试合同到 Controller 决定；箭头区分当前代码步骤、返回事实与明确的条件。
  contract["任务包内 testContract"]
  delivery["统一投递和尝试"]
  test["Test 按冻结步骤执行"]
  report["逐步 expected / observed / evidence"]
  view["步骤基线、范围和派生 verdict"]
  decision["Controller 测试决定"]
  contract -->|"E-L1034-01 引用合同摘要和 accepted 实现基线"| delivery
  delivery -->|"E-L1034-02 给出步骤、环境与预算"| test
  test -->|"E-L1034-03 提交结果记录"| report
  report -->|"E-L1034-04 派生整体结论并对比先前通过步骤"| view
  view -->|"E-L1034-05 按失败分类和预算限制允许决定"| decision
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| testContract | 测试任务包内冻结的步骤、环境、技能、预算与停止条件。 |
| verdict | 从逐步 expected/observed/evidence 记录派生的测试结论。 |
| TaskPackage | 目标任务的不可变合同，内容来自已发布需求包。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| contract | `src/governance/tasking/task-package.ts` | 任务包内 testContract |
| delivery | `src/capabilities/delivery/service.ts` | 统一投递和尝试 |
| test | Agent / 用户 / 外部效果或条件视图 | Test 按冻结步骤执行 |
| report | `src/governance/result/test-target-result-report.ts` | 逐步 expected / observed / evidence |
| view | `src/capabilities/result-review/decide.ts` | 步骤基线、范围和派生 verdict |
| decision | `src/capabilities/result-review/service.ts` | Controller 测试决定 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1034-01 | `src/capabilities/delivery/service.ts#testAttemptFor` | `tests/capabilities/delivery/service.test.ts` | 引用合同摘要和 accepted 实现基线 |
| E-L1034-02 | `src/capabilities/delivery/service.ts#testContractSection` | `tests/capabilities/delivery/service.test.ts` | 给出步骤、环境与预算 |
| E-L1034-03 | `src/capabilities/result-review/service.ts#executeImport` | `tests/capabilities/result-review/service.test.ts` | 提交结果记录 |
| E-L1034-04 | `src/capabilities/result-review/decide.ts#deriveStepViews` | `tests/capabilities/result-review/service.test.ts` | 派生整体结论并对比先前通过步骤 |
| E-L1034-05 | `src/capabilities/result-review/service.ts#executeTestDecision` | `tests/capabilities/result-review/service.test.ts` | 按失败分类和预算限制允许决定 |

## 守卫、恢复与验证范围

environment 失败进入 blocked；harness-defect、flaky、missing-evidence 可在预算内跑失败子集；product-defect 的升级在同一提交附带产品返工授权；needs-decision 交用户。

涉及的测试与核验入口：

- `tests/capabilities/delivery/service.test.ts`。
- `tests/capabilities/result-review/service.test.ts`。
- `tests/capabilities/tasking/service.test.ts`。

## 下钻与相关视图

- [文件直接导入](./file-dependencies.md)
- [运行调用与恢复](./runtime-call-flow.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
