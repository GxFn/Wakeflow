---
diagramId: ts-review-completion-runtime-l1
viewType: call-flow
truthKind: current-code
reviewDepth: L4
verifiedAt: 2026-09-11
baselineCommit: 7ba1f38938a7387623b0ca588d9cfd54abda5760
sourceFingerprint: sha256:8ee0e887c7d808ba77d0b7b73fc8a0d66a5ffeeade39e03372611fc355ae7fca
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: manual-review
sourcePaths:
  - src/capabilities/demand/*.ts
  - src/capabilities/demand/archive.ts
  - src/capabilities/demand/lifecycle.ts
  - src/capabilities/demand/verify.ts
  - src/capabilities/result-review/*.ts
  - src/capabilities/result-review/service.ts
  - src/configuration/*.ts
  - src/contracts/generated/configuration/*.ts
  - src/contracts/generated/entrypoints/*.ts
  - src/contracts/generated/foundation/*.ts
  - src/contracts/generated/governance/archive/*.ts
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
  - src/governance/controller/*.ts
  - src/governance/delivery/*.ts
  - src/governance/demand/*.ts
  - src/governance/demand/event-sourcing/*.ts
  - src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.ts
  - src/governance/demand/event-sourcing/demand-event-sourcing-decider.ts
  - src/governance/demand/model/*.ts
  - src/governance/demand/model/demand-aggregate-state.ts
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
  - src/kernel/requirement-board.ts
  - src/workspace/*.ts
  - src/workspace/active/*.ts
  - src/workspace/window-runtime/*.ts
schemaPaths:
  - src/contracts/schemas/configuration/wakeflow-config-v3.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-cancellation-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-cancellation-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-completion-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-completion-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-continuation-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-continuation-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-controller-route-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-controller-route-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-publication-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-publication-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-implementation-review-decision-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-implementation-review-decision-result.schema.json
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
  - src/contracts/schemas/governance/archive/demand-archive-manifest.schema.json
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
  - tests/capabilities/demand/service.test.ts
  - tests/capabilities/result-review/service.test.ts
refreshTriggers:
  - .dependency-cruiser.cjs
  - docs/decisions/0012-flow-convergence-callback-calls-testing-redesign.md
  - docs/decisions/0013-target-architecture-and-slice-plan.md
---

# 评审和生命周期：决定、归档与继续

调用图将外部判断、事件变更和物理归档分开。

> 核验基线：`7ba1f38`；核验时实现代码均已提交，本轮图谱更新另列。开发阶段为 L1 九片已落地，observation 尚未开始。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 决定和升级后的返回

```mermaid
sequenceDiagram
  accTitle: 决定和升级后的返回
  accDescr: 决定和升级后的返回；箭头区分当前代码步骤、返回事实与明确的条件。
  participant controller as Controller
  participant slice as 结果评审切片
  participant event as 决定与升级事件
  participant user as 用户
  participant life as Demand 生命周期
  controller->>slice: E-L1031-01 提交 snapshotDigest 与 reviewUnitDigest
  slice->>event: E-L1031-02 校验决定、完成观察和 resumption
  alt 需求或方案需要用户决定
  event->>user: E-L1031-03 持久化 awaitingDecision
  user->>life: E-L1031-04 continue_demand 的 record-decision
  life->>event: E-L1031-05 回答指定升级事件
  end
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| Demand | 一个需求的不可变身份和事件流；当前执行环境由 podId 指定。 |
| hook | 宿主回交的会话/提示提交/完成观察记录，保存在宿主本地根。 |
| CAS | 比较已观察的摘要/修订后提交；来源已改变则拒绝。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| controller | Agent / 用户 / 外部效果或条件视图 | Controller |
| slice | `src/capabilities/result-review/service.ts` | 结果评审切片 |
| event | `src/governance/demand/event-sourcing/demand-event-sourcing-decider.ts` | 决定与升级事件 |
| user | Agent / 用户 / 外部效果或条件视图 | 用户 |
| life | `src/capabilities/demand/lifecycle.ts` | Demand 生命周期 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1031-01 | `src/capabilities/result-review/service.ts#executeImplementationDecision` | `tests/capabilities/result-review/service.test.ts` | 提交 snapshotDigest 与 reviewUnitDigest |
| E-L1031-02 | `src/capabilities/result-review/service.ts#executeImplementationDecision` | `tests/capabilities/result-review/service.test.ts` | 校验决定、完成观察和 resumption |
| E-L1031-03 | `src/governance/demand/model/demand-aggregate-state.ts#escalateDemandAggregateState` | `tests/capabilities/demand/service.test.ts` | 持久化 awaitingDecision |
| E-L1031-04 | `src/capabilities/demand/lifecycle.ts#applyDecision` | `tests/capabilities/demand/service.test.ts` | continue_demand 的 record-decision |
| E-L1031-05 | `src/governance/demand/model/demand-aggregate-state.ts#recordDecisionInDemandAggregateState` | `tests/capabilities/demand/service.test.ts` | 回答指定升级事件 |

## 完成和取消的五步归档事务

```mermaid
sequenceDiagram
  accTitle: 完成和取消的五步归档事务
  accDescr: 完成和取消的五步归档事务；箭头区分当前代码步骤、返回事实与明确的条件。
  participant controller as Controller
  participant slice as 生命周期切片
  participant verify as 内嵌只读门
  participant event as Demand 事件流
  participant archive as 不可变归档包
  participant board as 看板认领状态
  participant claim as 工作声明
  participant activeRoot as 活动根
  controller->>slice: E-L1032-01 preview 后按摘要 apply
  slice->>verify: E-L1032-02 配置、审计、声明、证据和隐私门
  slice->>slice: E-L1032-03 先保存活动根外 journal
  slice->>event: E-L1032-04 一：提交 completed 或 cancelled
  slice->>archive: E-L1032-05 二：封 payload、verify 报告与 worktree 来源
  slice->>board: E-L1032-06 三：archived / withdrawn
  opt 取消事务
    slice->>claim: E-L1032-08 四：释放本 Demand 的工作声明
  end
  slice->>activeRoot: E-L1032-07 五：核对归档摘要后退休活动根
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| ledger | 长期不可变需求包与归档的存储根。 |
| commit | 一次不可变事件提交批；文件槽位以预期修订防止并发覆盖。 |
| CAS | 比较已观察的摘要/修订后提交；来源已改变则拒绝。 |
| claim | 端点注意力及产品检出的工作声明，释放必须匹配当前令牌。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| controller | Agent / 用户 / 外部效果或条件视图 | Controller |
| slice | `src/capabilities/demand/lifecycle.ts` | 生命周期切片 |
| verify | `src/capabilities/demand/verify.ts` | 内嵌只读门 |
| event | `src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.ts` | Demand 事件流 |
| archive | `src/capabilities/demand/archive.ts` | 不可变归档包 |
| board | `src/kernel/requirement-board.ts` | 看板认领状态 |
| claim | `src/kernel/work-claims.ts` | 工作声明 |
| activeRoot | `src/capabilities/demand/archive.ts#retireDemandRoot` | 活动根 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1032-01 | `src/capabilities/demand/lifecycle.ts#executeDemandCompletionRequest` | `tests/capabilities/demand/service.test.ts` | preview 后按摘要 apply |
| E-L1032-02 | `src/capabilities/demand/verify.ts#evaluateVerifyGates` | `tests/capabilities/demand/service.test.ts` | 配置、审计、声明、证据和隐私门 |
| E-L1032-03 | `src/capabilities/demand/lifecycle.ts#applyTerminal` | `tests/capabilities/demand/service.test.ts` | 先保存活动根外 journal |
| E-L1032-04 | `src/capabilities/demand/lifecycle.ts#terminalEvent` | `tests/capabilities/demand/service.test.ts` | 一：提交 completed 或 cancelled |
| E-L1032-05 | `src/capabilities/demand/lifecycle.ts#sealArchive` | `tests/capabilities/demand/service.test.ts` | 二：封 payload、verify 报告与 worktree 来源 |
| E-L1032-06 | `src/capabilities/demand/lifecycle.ts#settlePackage` | `tests/capabilities/demand/service.test.ts` | 三：archived / withdrawn |
| E-L1032-08 | `src/capabilities/demand/lifecycle.ts#releaseClaims` | `tests/capabilities/demand/service.test.ts` | 四：取消时释放本 Demand 的工作声明 |
| E-L1032-07 | `src/capabilities/demand/archive.ts#retireDemandRoot` | `tests/capabilities/demand/service.test.ts` | 五：核对归档摘要后退休活动根 |

## 从归档继续同一 Demand

```mermaid
sequenceDiagram
  accTitle: 从归档继续同一 Demand
  accDescr: 从归档继续同一 Demand；箭头区分当前代码步骤、返回事实与明确的条件。
  participant controller as Controller
  participant slice as 生命周期切片
  participant archive as 已完成的归档
  participant event as 恢复的活动事件流
  participant board as 看板认领状态
  controller->>slice: E-L1033-01 continue，核对所在 Pod 空闲
  slice->>archive: E-L1033-02 按冻结清单读回负载
  slice->>event: E-L1033-03 恢复根并追加 demand-continued
  slice->>board: E-L1033-04 同 Demand archived 回 claimed
  slice-->>controller: E-L1033-05 next 要求先规划新目标
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| Demand | 一个需求的不可变身份和事件流；当前执行环境由 podId 指定。 |
| Pod | 完整窗口组与每仓执行位置；main 是 primary Pod。 |
| snapshot | 可重建的事件聚合检查点；损坏时回退重放。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| controller | Agent / 用户 / 外部效果或条件视图 | Controller |
| slice | `src/capabilities/demand/lifecycle.ts` | 生命周期切片 |
| archive | `src/capabilities/demand/archive.ts` | 已完成的归档 |
| event | `src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.ts` | 恢复的活动事件流 |
| board | `src/kernel/requirement-board.ts` | 看板认领状态 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1033-01 | `src/capabilities/demand/lifecycle.ts#planContinue` | `tests/capabilities/demand/service.test.ts` | continue，核对所在 Pod 空闲 |
| E-L1033-02 | `src/capabilities/demand/archive.ts#readArchivePayload` | `tests/capabilities/demand/service.test.ts` | 按冻结清单读回负载 |
| E-L1033-03 | `src/capabilities/demand/lifecycle.ts#applyContinue` | `tests/capabilities/demand/service.test.ts` | 恢复根并追加 demand-continued |
| E-L1033-04 | `src/kernel/requirement-board.ts#reclaimRequirementPackage` | `tests/capabilities/demand/service.test.ts` | 同 Demand archived 回 claimed |
| E-L1033-05 | `src/capabilities/demand/lifecycle.ts#applyContinue` | `tests/capabilities/demand/service.test.ts` | next 要求先规划新目标 |

## 守卫、恢复与验证范围

取消的 Demand 不能 continue。日志只为当前事务恢复提供依据；恢复不是重新规划。归档包含已有事件历史而不包含可重建 snapshots/index/append-candidates。

涉及的测试与核验入口：

- `tests/capabilities/demand/service.test.ts`。
- `tests/capabilities/result-review/service.test.ts`。

## 下钻与相关视图

- [本专题总览](./README.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
