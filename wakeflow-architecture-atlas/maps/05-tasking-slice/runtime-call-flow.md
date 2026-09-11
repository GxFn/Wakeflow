---
diagramId: ts-tasking-runtime-t1
viewType: call-flow
truthKind: current-code
reviewDepth: L4
verifiedAt: 2026-09-11
baselineCommit: 7ba1f38938a7387623b0ca588d9cfd54abda5760
sourceFingerprint: sha256:582e5399dca6bddf7d20dab191843db553a59c1c7a8523d186989cf8e56dc2a1
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: manual-review
sourcePaths:
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
  - src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.ts
  - src/governance/demand/model/*.ts
  - src/governance/demand/model/demand-aggregate-state.ts
  - src/governance/demand/publication/*.ts
  - src/governance/evidence/*.ts
  - src/governance/ledger/*.ts
  - src/governance/lifecycle/*.ts
  - src/governance/result/*.ts
  - src/governance/review/*.ts
  - src/governance/tasking/*.ts
  - src/governance/tasking/task-package-projection-store.ts
  - src/governance/testing/*.ts
  - src/kernel/*.ts
  - src/kernel/event-stream/*.ts
  - src/workspace/*.ts
  - src/workspace/active/*.ts
  - src/workspace/window-runtime/*.ts
schemaPaths:
  - src/contracts/schemas/configuration/wakeflow-config-v3.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-target-task-planning-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-target-task-planning-result.schema.json
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
  - tests/capabilities/tasking/service.test.ts
refreshTriggers:
  - .dependency-cruiser.cjs
  - docs/decisions/0012-flow-convergence-callback-calls-testing-redesign.md
  - docs/decisions/0013-target-architecture-and-slice-plan.md
---

# 任务规划：追加、谱系与测试派生

实现和测试共用一个公开工具；两类草稿的准入和字段所有权分开。

> 核验基线：`7ba1f38`；核验时实现代码均已提交，本轮图谱更新另列。开发阶段为 L1 九片已落地，observation 尚未开始。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 实现任务的一次追加

```mermaid
sequenceDiagram
  accTitle: 实现任务的一次追加
  accDescr: 实现任务的一次追加；箭头区分当前代码步骤、返回事实与明确的条件。
  participant controller as Controller
  participant slice as 任务切片
  participant decide as 纯准入
  participant handler as 事件命令
  participant view as 任务投影
  controller->>slice: E-L1021-01 草稿、idempotencyKey、expectedStreamRevision
  slice->>decide: E-L1021-02 章节、锚点、Pod、用户确认与谱系
  slice->>handler: E-L1021-03 追加规划事件
  slice->>view: E-L1021-04 从事件恢复同一任务包
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| TaskPackage | 目标任务的不可变合同，内容来自已发布需求包。 |
| CAS | 比较已观察的摘要/修订后提交；来源已改变则拒绝。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| controller | Agent / 用户 / 外部效果或条件视图 | Controller |
| slice | `src/capabilities/tasking/service.ts` | 任务切片 |
| decide | `src/capabilities/tasking/decide.ts` | 纯准入 |
| handler | `src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.ts` | 事件命令 |
| view | `src/governance/tasking/task-package-projection-store.ts` | 任务投影 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1021-01 | `src/capabilities/tasking/service.ts#executeTargetTaskPlanningPublicRequest` | `tests/capabilities/tasking/service.test.ts` | 草稿、idempotencyKey、expectedStreamRevision |
| E-L1021-02 | `src/capabilities/tasking/service.ts#buildImplementationPackage` | `tests/capabilities/tasking/service.test.ts` | 章节、锚点、Pod、用户确认与谱系 |
| E-L1021-03 | `src/capabilities/tasking/service.ts#execute` | `tests/capabilities/tasking/service.test.ts` | 追加规划事件 |
| E-L1021-04 | `src/capabilities/tasking/service.ts#materialize` | `tests/capabilities/tasking/service.test.ts` | 从事件恢复同一任务包 |

## 替换与继续的谱系约束

```mermaid
sequenceDiagram
  accTitle: 替换与继续的谱系约束
  accDescr: 替换与继续的谱系约束；箭头区分当前代码步骤、返回事实与明确的条件。
  participant slice as 任务切片
  participant decide as 谱系决定
  participant aggregate as Demand 聚合
  slice->>decide: E-L1022-01 检查前序摘要、阶段及同仓关系
  alt replacement
  slice->>aggregate: E-L1022-02 创建新包时旧目标 superseded
  else continuation
  slice->>aggregate: E-L1022-03 接受的前序指向新目标
  end
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| TaskPackage | 目标任务的不可变合同，内容来自已发布需求包。 |
| Demand | 一个需求的不可变身份和事件流；当前执行环境由 podId 指定。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| slice | `src/capabilities/tasking/service.ts` | 任务切片 |
| decide | `src/capabilities/tasking/decide.ts` | 谱系决定 |
| aggregate | `src/governance/demand/model/demand-aggregate-state.ts` | Demand 聚合 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1022-01 | `src/capabilities/tasking/decide.ts#deriveLineageBlockers` | `tests/capabilities/tasking/service.test.ts` | 检查前序摘要、阶段及同仓关系 |
| E-L1022-02 | `src/governance/demand/model/demand-aggregate-state.ts#planTargetTaskInDemandAggregateState` | `tests/capabilities/tasking/service.test.ts` | 创建新包时旧目标 superseded |
| E-L1022-03 | `src/governance/demand/model/demand-aggregate-state.ts#planTargetTaskInDemandAggregateState` | `tests/capabilities/tasking/service.test.ts` | 接受的前序指向新目标 |

## 测试任务的合同准入

```mermaid
sequenceDiagram
  accTitle: 测试任务的合同准入
  accDescr: 测试任务的合同准入；箭头区分当前代码步骤、返回事实与明确的条件。
  participant controller as Controller
  participant slice as 任务切片
  participant decide as 测试准入
  participant event as 任务规划事件
  controller->>slice: E-L1023-01 给出 testContract 与步骤引用
  slice->>decide: E-L1023-02 检查实现基线已接受、环境与预算
  slice->>event: E-L1023-03 冻结合同摘要及测试谱系
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| testContract | 测试任务包内冻结的步骤、环境、技能、预算与停止条件。 |
| TaskPackage | 目标任务的不可变合同，内容来自已发布需求包。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| controller | Agent / 用户 / 外部效果或条件视图 | Controller |
| slice | `src/capabilities/tasking/service.ts` | 任务切片 |
| decide | `src/capabilities/tasking/decide.ts` | 测试准入 |
| event | `src/governance/demand/model/demand-aggregate-state.ts` | 任务规划事件 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1023-01 | `src/capabilities/tasking/service.ts#buildTestPackage` | `tests/capabilities/tasking/service.test.ts` | 给出 testContract 与步骤引用 |
| E-L1023-02 | `src/capabilities/tasking/decide.ts#deriveTestPlanningBlockers` | `tests/capabilities/tasking/service.test.ts` | 检查实现基线已接受、环境与预算 |
| E-L1023-03 | `src/governance/demand/model/demand-aggregate-state.ts#planTargetTaskInDemandAggregateState` | `tests/capabilities/tasking/service.test.ts` | 冻结合同摘要及测试谱系 |

## 守卫、恢复与验证范围

同键重放先于后置领域约束检查，避免因已存在任务而误拒重试。不同请求摘要不能复用同一幂等键。

涉及的测试与核验入口：

- `tests/capabilities/tasking/service.test.ts`。

## 下钻与相关视图

- [本专题总览](./README.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
