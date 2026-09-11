---
diagramId: ts-governance-demand-runtime-e0
viewType: call-flow
truthKind: current-code
reviewDepth: L4
verifiedAt: 2026-09-11
baselineCommit: 7ba1f38938a7387623b0ca588d9cfd54abda5760
sourceFingerprint: sha256:7a598195c4622f5d7a4c4263c305280307b6005de8bde8f4d0bc5a7cc5bc1f76
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: manual-review
sourcePaths:
  - src/capabilities/demand/*.ts
  - src/capabilities/demand/service.ts
  - src/capabilities/tasking/*.ts
  - src/capabilities/tasking/service.ts
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
  - src/governance/demand/event-sourcing/demand-event-sourcing-repository.ts
  - src/governance/demand/event-sourcing/demand-file-event-snapshot-store.ts
  - src/governance/demand/event-sourcing/demand-file-event-store.ts
  - src/governance/demand/model/*.ts
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
  - src/contracts/schemas/entrypoints/wakeflow-target-task-planning-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-target-task-planning-result.schema.json
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
  - tests/capabilities/tasking/service.test.ts
  - tests/governance/demand/demand-event-sourcing-command-handler.test.ts
refreshTriggers:
  - .dependency-cruiser.cjs
  - docs/decisions/0012-flow-convergence-callback-calls-testing-redesign.md
  - docs/decisions/0013-target-architecture-and-slice-plan.md
---

# Demand：命令、检查点与首次发布

事件流保留持久化事实，内核及切片提供追加型和效果型调用形状。

> 核验基线：`7ba1f38`；核验时实现代码均已提交，本轮图谱更新另列。开发阶段为 L1 九片已落地，observation 尚未开始。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 追加命令的幂等与 CAS

```mermaid
sequenceDiagram
  accTitle: 追加命令的幂等与 CAS
  accDescr: 追加命令的幂等与 CAS；箭头区分当前代码步骤、返回事实与明确的条件。
  participant slice as 能力切片
  participant handler as 命令处理器
  participant repo as 事件仓储
  participant decider as 纯决定器
  participant store as 提交存储
  slice->>handler: E-L1016-01 命令、幂等键和 expected revision
  handler->>repo: E-L1016-02 先查幂等绑定，再加载一次聚合
  handler->>decider: E-L1016-03 产生单个或多个事件
  handler->>store: E-L1016-04 固定 commitSequence 槽位追加
  handler->>repo: E-L1016-05 成功后刷新检查点
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| CAS | 比较已观察的摘要/修订后提交；来源已改变则拒绝。 |
| commit | 一次不可变事件提交批；文件槽位以预期修订防止并发覆盖。 |
| snapshot | 可重建的事件聚合检查点；损坏时回退重放。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| slice | `src/capabilities/tasking/service.ts` | 能力切片 |
| handler | `src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.ts#executeDemandEventSourcingCommand` | 命令处理器 |
| repo | `src/governance/demand/event-sourcing/demand-event-sourcing-repository.ts` | 事件仓储 |
| decider | `src/governance/demand/event-sourcing/demand-event-sourcing-decider.ts` | 纯决定器 |
| store | `src/governance/demand/event-sourcing/demand-file-event-store.ts` | 提交存储 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1016-01 | `src/capabilities/tasking/service.ts#execute` | `tests/capabilities/tasking/service.test.ts` | 命令、幂等键和 expected revision |
| E-L1016-02 | `src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.ts#executeDemandEventSourcingCommand` | `tests/governance/demand/demand-event-sourcing-command-handler.test.ts` | 先查幂等绑定，再加载一次聚合 |
| E-L1016-03 | `src/governance/demand/event-sourcing/demand-event-sourcing-decider.ts#decideDemandEventSourcingCommand` | `tests/governance/demand/demand-event-sourcing-command-handler.test.ts` | 产生单个或多个事件 |
| E-L1016-04 | `src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.ts#executeDemandEventSourcingCommand` | `tests/governance/demand/demand-event-sourcing-command-handler.test.ts` | 固定 commitSequence 槽位追加 |
| E-L1016-05 | `src/governance/demand/event-sourcing/demand-event-sourcing-repository.ts#DemandEventSourcingRepository.refreshCheckpoints` | `tests/governance/demand/demand-event-sourcing-command-handler.test.ts` | 成功后刷新检查点 |

## 快照加尾部和完整审计

```mermaid
sequenceDiagram
  accTitle: 快照加尾部和完整审计
  accDescr: 快照加尾部和完整审计；箭头区分当前代码步骤、返回事实与明确的条件。
  participant reader as 调用者
  participant repo as 事件仓储
  participant snapshot as 快照存储
  participant store as 不可变提交
  reader->>repo: E-L1017-01 普通 load
  repo->>snapshot: E-L1017-02 选最新有效检查点
  repo->>store: E-L1017-03 读锚定提交与 tail
  alt 无有效缓存或显式 audit
  repo->>store: E-L1017-04 从提交一完整复验
  end
  repo-->>reader: E-L1017-05 返回聚合与缓存状态，读过程零写
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| snapshot | 可重建的事件聚合检查点；损坏时回退重放。 |
| commit | 一次不可变事件提交批；文件槽位以预期修订防止并发覆盖。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| reader | Agent / 用户 / 外部效果或条件视图 | 调用者 |
| repo | `src/governance/demand/event-sourcing/demand-event-sourcing-repository.ts` | 事件仓储 |
| snapshot | `src/governance/demand/event-sourcing/demand-file-event-snapshot-store.ts` | 快照存储 |
| store | `src/governance/demand/event-sourcing/demand-file-event-store.ts` | 不可变提交 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1017-01 | `src/governance/demand/event-sourcing/demand-event-sourcing-repository.ts#DemandEventSourcingRepository.load` | `tests/governance/demand/demand-event-sourcing-command-handler.test.ts` | 普通 load |
| E-L1017-02 | `src/governance/demand/event-sourcing/demand-event-sourcing-repository.ts#DemandEventSourcingRepository.load` | `tests/governance/demand/demand-event-sourcing-command-handler.test.ts` | 选最新有效检查点 |
| E-L1017-03 | `src/governance/demand/event-sourcing/demand-event-sourcing-repository.ts#DemandEventSourcingRepository.load` | `tests/governance/demand/demand-event-sourcing-command-handler.test.ts` | 读锚定提交与 tail |
| E-L1017-04 | `src/governance/demand/event-sourcing/demand-event-sourcing-repository.ts#DemandEventSourcingRepository.audit` | `tests/governance/demand/demand-event-sourcing-command-handler.test.ts` | 从提交一完整复验 |
| E-L1017-05 | `src/governance/demand/event-sourcing/demand-event-sourcing-repository.ts#DemandEventSourcingRepository.load` | `tests/governance/demand/demand-event-sourcing-command-handler.test.ts` | 返回聚合与缓存状态，读过程零写 |

## 根先发布后认领需求包

```mermaid
sequenceDiagram
  accTitle: 根先发布后认领需求包
  accDescr: 根先发布后认领需求包；箭头区分当前代码步骤、返回事实与明确的条件。
  participant agent as Controller
  participant slice as Demand 切片
  participant publication as 发布 owner
  participant board as 看板 CAS
  agent->>slice: E-L1018-01 preview requirementId 与可选 podId
  slice-->>agent: E-L1018-02 确定性计划摘要与阻塞项
  agent->>slice: E-L1018-03 同请求 apply
  slice->>publication: E-L1018-04 sidecar、stage、身份与首个提交
  publication->>board: E-L1018-05 按预期摘要 claim，同 Demand 可重放
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| Demand | 一个需求的不可变身份和事件流；当前执行环境由 podId 指定。 |
| Pod | 完整窗口组与每仓执行位置；main 是 primary Pod。 |
| CAS | 比较已观察的摘要/修订后提交；来源已改变则拒绝。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| agent | Agent / 用户 / 外部效果或条件视图 | Controller |
| slice | `src/capabilities/demand/service.ts` | Demand 切片 |
| publication | `src/governance/demand/publication/demand-event-sourcing-publication-service.ts` | 发布 owner |
| board | `src/kernel/requirement-board.ts` | 看板 CAS |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1018-01 | `src/capabilities/demand/service.ts#executeDemandCreationRequest` | `tests/capabilities/demand/service.test.ts` | preview requirementId 与可选 podId |
| E-L1018-02 | `src/capabilities/demand/service.ts#planCreate` | `tests/capabilities/demand/service.test.ts` | 确定性计划摘要与阻塞项 |
| E-L1018-03 | `src/capabilities/demand/service.ts#executeDemandCreationRequest` | `tests/capabilities/demand/service.test.ts` | 同请求 apply |
| E-L1018-04 | `src/governance/demand/publication/demand-event-sourcing-publication-service.ts#publishDemandFromPackage` | `tests/capabilities/demand/service.test.ts` | sidecar、stage、身份与首个提交 |
| E-L1018-05 | `src/governance/demand/publication/demand-event-sourcing-publication-package.ts#claimPackageForDemandPublication` | `tests/capabilities/demand/service.test.ts` | 按预期摘要 claim，同 Demand 可重放 |

## 守卫、恢复与验证范围

只画当前已有的恢复 owner。跨资源失败必须由原 sidecar 或日志前向结算；看板不是事件流的替代物。

涉及的测试与核验入口：

- `tests/capabilities/demand/service.test.ts`。
- `tests/capabilities/tasking/service.test.ts`。
- `tests/governance/demand/demand-event-sourcing-command-handler.test.ts`。

## 下钻与相关视图

- [本专题总览](./README.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
