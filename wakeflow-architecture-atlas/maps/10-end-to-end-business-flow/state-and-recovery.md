---
diagramId: ts-end-to-end-state-z1
viewType: state
truthKind: current-code
reviewDepth: L5
verifiedAt: 2026-09-11
baselineCommit: 7ba1f38938a7387623b0ca588d9cfd54abda5760
sourceFingerprint: sha256:135bb893fe88ffd6afa11d5a82a79d0c6b68a5b0e764cff59d19e756ee1560b5
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: manual-review
sourcePaths:
  - src/capabilities/delivery/*.ts
  - src/capabilities/delivery/service.ts
  - src/capabilities/demand/*.ts
  - src/capabilities/demand/lifecycle.ts
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
  - src/kernel/work-claims.ts
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
  - tests/capabilities/delivery/service.test.ts
  - tests/capabilities/demand/service.test.ts
  - tests/capabilities/requirement/service.test.ts
  - tests/capabilities/result-review/service.test.ts
refreshTriggers:
  - .dependency-cruiser.cjs
  - docs/decisions/0012-flow-convergence-callback-calls-testing-redesign.md
  - docs/decisions/0013-target-architecture-and-slice-plan.md
---

# 状态索引：每个 owner 保持自己的事实

以下状态分图。Demand lifecycle 不包含 archived；归档是不可变负载和活动根退休的物理结果。Review Snapshot 和 next 只作投影。

> 核验基线：`7ba1f38`；核验时实现代码均已提交，本轮图谱更新另列。开发阶段为 L1 九片已落地，observation 尚未开始。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 需求包认领状态

```mermaid
stateDiagram-v2
  accTitle: 需求包认领状态
  accDescr: 需求包认领状态；箭头区分当前代码步骤、返回事实与明确的条件。
  state "pending 待认领" as pending
  state "parked 搁置" as parked
  state "claimed 已认领" as claimed
  state "withdrawn 已撤回" as withdrawn
  state "archived 已归档" as archived
  parked --> pending: E-L1042-01 activate
  pending --> claimed: E-L1042-02 创建根后 claim
  pending --> withdrawn: E-L1042-03 withdraw 或 supersedes
  parked --> withdrawn: E-L1042-04 withdraw 或 supersedes
  claimed --> archived: E-L1042-05 complete 的看板结算
  claimed --> withdrawn: E-L1042-06 cancel 的看板结算
  archived --> claimed: E-L1042-07 同 Demand continue
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| CAS | 比较已观察的摘要/修订后提交；来源已改变则拒绝。 |
| Demand | 一个需求的不可变身份和事件流；当前执行环境由 podId 指定。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| pending | `src/kernel/requirement-board.ts` | pending 待认领 |
| parked | `src/kernel/requirement-board.ts` | parked 搁置 |
| claimed | `src/kernel/requirement-board.ts` | claimed 已认领 |
| withdrawn | `src/kernel/requirement-board.ts` | withdrawn 已撤回 |
| archived | `src/kernel/requirement-board.ts` | archived 已归档 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1042-01 | `src/kernel/requirement-board.ts#activateRequirementClaim` | `tests/capabilities/requirement/service.test.ts` | activate |
| E-L1042-02 | `src/kernel/requirement-board.ts#claimRequirementPackage` | `tests/capabilities/demand/service.test.ts` | 创建根后 claim |
| E-L1042-03 | `src/kernel/requirement-board.ts#withdrawRequirementClaim` | `tests/capabilities/requirement/service.test.ts` | withdraw 或 supersedes |
| E-L1042-04 | `src/kernel/requirement-board.ts#withdrawRequirementClaim` | `tests/capabilities/requirement/service.test.ts` | withdraw 或 supersedes |
| E-L1042-05 | `src/capabilities/demand/lifecycle.ts#settlePackage` | `tests/capabilities/demand/service.test.ts` | complete 的看板结算 |
| E-L1042-06 | `src/capabilities/demand/lifecycle.ts#settlePackage` | `tests/capabilities/demand/service.test.ts` | cancel 的看板结算 |
| E-L1042-07 | `src/kernel/requirement-board.ts#reclaimRequirementPackage` | `tests/capabilities/demand/service.test.ts` | 同 Demand continue |

## Demand lifecycle 与决定标记

```mermaid
stateDiagram-v2
  accTitle: Demand lifecycle 与决定标记
  accDescr: Demand lifecycle 与决定标记；箭头区分当前代码步骤、返回事实与明确的条件。
  state "active 活动" as active
  state "completed 完成" as completed
  state "cancelled 取消" as cancelled
  active --> active: E-L1043-01 escalate 设置 awaitingDecision
  active --> active: E-L1043-02 decision-recorded 回答指定升级
  active --> completed: E-L1043-03 满足完成门；随后封归档
  active --> cancelled: E-L1043-04 取消；随后封归档
  completed --> active: E-L1043-05 恢复归档后 demand-continued
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| Demand | 一个需求的不可变身份和事件流；当前执行环境由 podId 指定。 |
| commit | 一次不可变事件提交批；文件槽位以预期修订防止并发覆盖。 |
| projection | 根据权威重建的视图，不反向决定事实。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| active | `src/governance/demand/model/demand-aggregate-state.ts` | active 活动 |
| completed | `src/governance/demand/model/demand-aggregate-state.ts` | completed 完成 |
| cancelled | `src/governance/demand/model/demand-aggregate-state.ts` | cancelled 取消 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1043-01 | `src/governance/demand/model/demand-aggregate-state.ts#escalateDemandAggregateState` | `tests/capabilities/demand/service.test.ts` | escalate 设置 awaitingDecision |
| E-L1043-02 | `src/governance/demand/model/demand-aggregate-state.ts#recordDecisionInDemandAggregateState` | `tests/capabilities/demand/service.test.ts` | decision-recorded 回答指定升级 |
| E-L1043-03 | `src/governance/demand/model/demand-aggregate-state.ts#completeDemandAggregateState` | `tests/capabilities/demand/service.test.ts` | 满足完成门；随后封归档 |
| E-L1043-04 | `src/governance/demand/model/demand-aggregate-state.ts#cancelDemandAggregateState` | `tests/capabilities/demand/service.test.ts` | 取消；随后封归档 |
| E-L1043-05 | `src/governance/demand/model/demand-aggregate-state.ts#continueDemandAggregateState` | `tests/capabilities/demand/service.test.ts` | 恢复归档后 demand-continued |

## 实现目标的投递与评审阶段

```mermaid
stateDiagram-v2
  accTitle: 实现目标的投递与评审阶段
  accDescr: 实现目标的投递与评审阶段；箭头区分当前代码步骤、返回事实与明确的条件。
  state "planned" as planned
  state "delivery-prepared" as prepared
  state "host-effect-accepted" as acceptedEffect
  state "host-effect-indeterminate" as unknownEffect
  state "host-effect-rejected" as rejected
  state "result-reported" as reported
  state "accepted" as accepted
  state "rework-requested" as rework
  state "review-blocked" as blocked
  state "escalated" as escalated
  planned --> prepared: E-L1044-01 delivery-prepared 事件
  prepared --> acceptedEffect: E-L1044-02 落地证据 accepted
  prepared --> unknownEffect: E-L1044-03 发送处置未知
  prepared --> rejected: E-L1044-04 明确未发送
  rejected --> prepared: E-L1044-05 rearm 新代际
  acceptedEffect --> reported: E-L1044-06 匹配结果事件
  unknownEffect --> reported: E-L1044-07 结果闭合 fence 后释放声明
  reported --> accepted: E-L1044-08 Controller accept
  reported --> rework: E-L1044-09 Controller rework
  rework --> prepared: E-L1044-10 同包再投递
  reported --> blocked: E-L1044-11 外部条件 blocked
  reported --> escalated: E-L1044-12 需求或方案 escalate
  blocked --> accepted: E-L1044-13 条件消失后携 resumption 决定
  escalated --> accepted: E-L1044-14 升级已回答后携 resumption 决定
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| fence | claimId、claimDigest 与流修订构成的准入令牌。 |
| claim | 端点注意力及产品检出的工作声明，释放必须匹配当前令牌。 |
| Demand | 一个需求的不可变身份和事件流；当前执行环境由 podId 指定。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| planned | `src/governance/demand/model/demand-aggregate-state.ts` | planned |
| prepared | `src/governance/demand/model/demand-aggregate-state.ts` | delivery-prepared |
| acceptedEffect | `src/governance/demand/model/demand-aggregate-state.ts` | host-effect-accepted |
| unknownEffect | `src/governance/demand/model/demand-aggregate-state.ts` | host-effect-indeterminate |
| rejected | `src/governance/demand/model/demand-aggregate-state.ts` | host-effect-rejected |
| reported | `src/governance/demand/model/demand-aggregate-state.ts` | result-reported |
| accepted | `src/governance/demand/model/demand-aggregate-state.ts` | accepted |
| rework | `src/governance/demand/model/demand-aggregate-state.ts` | rework-requested |
| blocked | `src/governance/demand/model/demand-aggregate-state.ts` | review-blocked |
| escalated | `src/governance/demand/model/demand-aggregate-state.ts` | escalated |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1044-01 | `src/capabilities/delivery/service.ts#executePrepare` | `tests/capabilities/delivery/service.test.ts` | delivery-prepared 事件 |
| E-L1044-02 | `src/capabilities/delivery/service.ts#executeOutcome` | `tests/capabilities/delivery/service.test.ts` | 落地证据 accepted |
| E-L1044-03 | `src/capabilities/delivery/service.ts#executeOutcome` | `tests/capabilities/delivery/service.test.ts` | 发送处置未知 |
| E-L1044-04 | `src/capabilities/delivery/service.ts#executeOutcome` | `tests/capabilities/delivery/service.test.ts` | 明确未发送 |
| E-L1044-05 | `src/capabilities/delivery/service.ts#executeRearm` | `tests/capabilities/delivery/service.test.ts` | rearm 新代际 |
| E-L1044-06 | `src/capabilities/result-review/service.ts#executeImport` | `tests/capabilities/result-review/service.test.ts` | 匹配结果事件 |
| E-L1044-07 | `src/capabilities/result-review/service.ts#executeImport` | `tests/capabilities/result-review/service.test.ts` | 结果闭合 fence 后释放声明 |
| E-L1044-08 | `src/capabilities/result-review/service.ts#executeImplementationDecision` | `tests/capabilities/result-review/service.test.ts` | Controller accept |
| E-L1044-09 | `src/capabilities/result-review/service.ts#executeImplementationDecision` | `tests/capabilities/result-review/service.test.ts` | Controller rework |
| E-L1044-10 | `src/capabilities/delivery/service.ts#executePrepare` | `tests/capabilities/delivery/service.test.ts` | 同包再投递 |
| E-L1044-11 | `src/capabilities/result-review/service.ts#executeImplementationDecision` | `tests/capabilities/result-review/service.test.ts` | 外部条件 blocked |
| E-L1044-12 | `src/capabilities/result-review/service.ts#executeImplementationDecision` | `tests/capabilities/result-review/service.test.ts` | 需求或方案 escalate |
| E-L1044-13 | `src/capabilities/result-review/service.ts#executeImplementationDecision` | `tests/capabilities/result-review/service.test.ts` | 条件消失后携 resumption 决定 |
| E-L1044-14 | `src/capabilities/result-review/service.ts#executeImplementationDecision` | `tests/capabilities/result-review/service.test.ts` | 升级已回答后携 resumption 决定 |

## 声明与提交失败的恢复边界

```mermaid
sequenceDiagram
  accTitle: 声明与提交失败的恢复边界
  accDescr: 声明与提交失败的恢复边界；箭头区分当前代码步骤、返回事实与明确的条件。
  participant slice as 能力切片
  participant claim as 独立声明 owner
  participant event as 事件流
  participant result as 结果导入
  slice->>claim: E-L1045-01 取得端点与检出声明
  slice->>event: E-L1045-02 提交带 fence 的信封
  alt 结果后来到达
  result->>event: E-L1045-03 先提交 Result
  result->>claim: E-L1045-04 再按精确令牌释放
  else 发送明确失败
  slice->>event: E-L1045-05 先记录 rejected outcome
  slice->>claim: E-L1045-06 再释放，允许显式 rearm
  end
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| claim | 端点注意力及产品检出的工作声明，释放必须匹配当前令牌。 |
| fence | claimId、claimDigest 与流修订构成的准入令牌。 |
| commit | 一次不可变事件提交批；文件槽位以预期修订防止并发覆盖。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| slice | `src/capabilities/delivery/service.ts` | 能力切片 |
| claim | `src/kernel/work-claims.ts` | 独立声明 owner |
| event | `src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.ts` | 事件流 |
| result | `src/capabilities/result-review/service.ts` | 结果导入 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1045-01 | `src/kernel/work-claims.ts#takeWorkClaim` | `tests/capabilities/delivery/service.test.ts` | 取得端点与检出声明 |
| E-L1045-02 | `src/capabilities/delivery/service.ts#executePrepare` | `tests/capabilities/delivery/service.test.ts` | 提交带 fence 的信封 |
| E-L1045-03 | `src/capabilities/result-review/service.ts#executeImport` | `tests/capabilities/result-review/service.test.ts` | 先提交 Result |
| E-L1045-04 | `src/capabilities/result-review/service.ts#releaseFence` | `tests/capabilities/result-review/service.test.ts` | 再按精确令牌释放 |
| E-L1045-05 | `src/capabilities/delivery/service.ts#executeOutcome` | `tests/capabilities/delivery/service.test.ts` | 先记录 rejected outcome |
| E-L1045-06 | `src/capabilities/delivery/service.ts#releaseClaimFor` | `tests/capabilities/delivery/service.test.ts` | 再释放，允许显式 rearm |

## 守卫、恢复与验证范围

最后一张是跨 owner 时序，不是另一个状态机。实现目标图是精选阶段；superseded 谱系、测试目标阶段及 blocked/escalated 的恢复守卫分别见任务与评审专题。

涉及的测试与核验入口：

- `tests/capabilities/delivery/service.test.ts`。
- `tests/capabilities/demand/service.test.ts`。
- `tests/capabilities/requirement/service.test.ts`。
- `tests/capabilities/result-review/service.test.ts`。

## 下钻与相关视图

- [本专题总览](./README.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
