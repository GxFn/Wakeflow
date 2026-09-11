---
diagramId: ts-real-testing-runtime-x1
viewType: call-flow
truthKind: current-code
reviewDepth: L4
verifiedAt: 2026-09-11
baselineCommit: 7ba1f38938a7387623b0ca588d9cfd54abda5760
sourceFingerprint: sha256:27287a93862d882b1aab2855cce8210fb7f3761fc579ca3bcbf6222410b38b8a
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: manual-review
sourcePaths:
  - src/capabilities/delivery/*.ts
  - src/capabilities/delivery/service.ts
  - src/capabilities/result-review/*.ts
  - src/capabilities/result-review/decide.ts
  - src/capabilities/result-review/service.ts
  - src/capabilities/tasking/*.ts
  - src/capabilities/tasking/decide.ts
  - src/capabilities/tasking/service.ts
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
  - src/governance/demand/event-sourcing/demand-event-sourcing-decider.ts
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
  - src/contracts/schemas/entrypoints/wakeflow-target-task-planning-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-target-task-planning-result.schema.json
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

# 测试：规划、尝试与失败子集

测试合同和任务身份保持不可变，尝试与审阅决定保留谱系。

> 核验基线：`7ba1f38`；核验时实现代码均已提交，本轮图谱更新另列。开发阶段为 L1 九片已落地，observation 尚未开始。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 测试规划与统一投递

```mermaid
sequenceDiagram
  accTitle: 测试规划与统一投递
  accDescr: 测试规划与统一投递；箭头区分当前代码步骤、返回事实与明确的条件。
  participant controller as Controller
  participant tasking as 任务切片
  participant delivery as 投递切片
  participant test as Test Agent
  controller->>tasking: E-L1036-01 给出 testContract 和需求步骤引用
  tasking->>tasking: E-L1036-02 核对实现已接受与测试谱系
  controller->>delivery: E-L1036-03 prepare 同一 test TaskPackage
  delivery->>test: E-L1036-04 冻结步骤、attempt 与停止条件
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| testContract | 测试任务包内冻结的步骤、环境、技能、预算与停止条件。 |
| TaskPackage | 目标任务的不可变合同，内容来自已发布需求包。 |
| permit | 供 Agent 使用的投递内容与围栏；重放不是新一次发送授权。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| controller | Agent / 用户 / 外部效果或条件视图 | Controller |
| tasking | `src/capabilities/tasking/service.ts` | 任务切片 |
| delivery | `src/capabilities/delivery/service.ts` | 投递切片 |
| test | Agent / 用户 / 外部效果或条件视图 | Test Agent |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1036-01 | `src/capabilities/tasking/service.ts#buildTestPackage` | `tests/capabilities/tasking/service.test.ts` | 给出 testContract 和需求步骤引用 |
| E-L1036-02 | `src/capabilities/tasking/decide.ts#deriveTestPlanningBlockers` | `tests/capabilities/tasking/service.test.ts` | 核对实现已接受与测试谱系 |
| E-L1036-03 | `src/capabilities/delivery/service.ts#executePrepare` | `tests/capabilities/delivery/service.test.ts` | prepare 同一 test TaskPackage |
| E-L1036-04 | `src/capabilities/delivery/service.ts#renderPrompt` | `tests/capabilities/delivery/service.test.ts` | 冻结步骤、attempt 与停止条件 |

## 逐步结果、分类与重跑

```mermaid
sequenceDiagram
  accTitle: 逐步结果、分类与重跑
  accDescr: 逐步结果、分类与重跑；箭头区分当前代码步骤、返回事实与明确的条件。
  participant test as Test Agent
  participant review as 结果评审切片
  participant view as 步骤投影
  participant controller as Controller
  participant event as 决定事件
  test->>review: E-L1037-01 导入每步观察与受管证据
  review->>view: E-L1037-02 组合本次范围和已通过基线
  view->>controller: E-L1037-03 显示 verdict 与允许决定
  controller->>event: E-L1037-04 指定可重跑失败 stepIds 或分类升级
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| verdict | 从逐步 expected/observed/evidence 记录派生的测试结论。 |
| testContract | 测试任务包内冻结的步骤、环境、技能、预算与停止条件。 |
| commit | 一次不可变事件提交批；文件槽位以预期修订防止并发覆盖。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| test | Agent / 用户 / 外部效果或条件视图 | Test Agent |
| review | `src/capabilities/result-review/service.ts` | 结果评审切片 |
| view | `src/capabilities/result-review/decide.ts` | 步骤投影 |
| controller | Agent / 用户 / 外部效果或条件视图 | Controller |
| event | `src/governance/demand/event-sourcing/demand-event-sourcing-decider.ts` | 决定事件 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1037-01 | `src/capabilities/result-review/service.ts#executeImport` | `tests/capabilities/result-review/service.test.ts` | 导入每步观察与受管证据 |
| E-L1037-02 | `src/capabilities/result-review/service.ts#testUnitView` | `tests/capabilities/result-review/service.test.ts` | 组合本次范围和已通过基线 |
| E-L1037-03 | `src/capabilities/result-review/decide.ts#deriveUnionVerdict` | `tests/capabilities/result-review/service.test.ts` | 显示 verdict 与允许决定 |
| E-L1037-04 | `src/capabilities/result-review/service.ts#executeTestDecision` | `tests/capabilities/result-review/service.test.ts` | 指定可重跑失败 stepIds 或分类升级 |

## 守卫、恢复与验证范围

接受需要 completed 与目标会话的完成记录。步骤通过是证据，不能自动替代 Controller 的验收判断；预算、范围和失效基线均在下一尝试准入中核对。

涉及的测试与核验入口：

- `tests/capabilities/delivery/service.test.ts`。
- `tests/capabilities/result-review/service.test.ts`。
- `tests/capabilities/tasking/service.test.ts`。

## 下钻与相关视图

- [本专题总览](./README.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
