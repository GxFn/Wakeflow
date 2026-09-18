---
diagramId: ts-governance-demand-event-sourcing-g0
viewType: authority
truthKind: current-code
reviewDepth: L4
verifiedAt: 2026-09-18
baselineCommit: 1480271ecc8a6c17bb9042321644402bd6cbda56
sourceFingerprint: sha256:0803764b676da434eaa9f201f87d1e847821a21bc9bfda381e2c610601da4a32
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: manual-review
sourcePaths:
  - src/capabilities/demand/*.ts
  - src/capabilities/demand/service.ts
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
  - src/governance/controller/demand-controller-route.ts
  - src/governance/delivery/*.ts
  - src/governance/demand/*.ts
  - src/governance/demand/event-sourcing/*.ts
  - src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.ts
  - src/governance/demand/event-sourcing/demand-event-sourcing-decider.ts
  - src/governance/demand/event-sourcing/demand-event-sourcing-repository.ts
  - src/governance/demand/event-sourcing/demand-event-stream-commit.ts
  - src/governance/demand/model/*.ts
  - src/governance/demand/model/demand-aggregate-state.ts
  - src/governance/demand/publication/*.ts
  - src/governance/demand/publication/demand-event-sourcing-publication-service.ts
  - src/governance/evidence/*.ts
  - src/governance/ledger/*.ts
  - src/governance/ledger/ledger-authority-store.ts
  - src/governance/lifecycle/*.ts
  - src/governance/result/*.ts
  - src/governance/review/*.ts
  - src/governance/review/demand-result-review-snapshot.ts
  - src/governance/tasking/*.ts
  - src/governance/testing/*.ts
  - src/kernel/*.ts
  - src/kernel/event-stream/*.ts
  - src/kernel/requirement-board.ts
  - src/workspace/*.ts
  - src/workspace/window-runtime/*.ts
schemaPaths:
  - src/contracts/schemas/configuration/wakeflow-config-v3.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-cancellation-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-cancellation-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-completion-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-completion-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-continuation-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-continuation-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-publication-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-publication-result.schema.json
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
  - tests/governance/demand/demand-event-sourcing-command-handler.test.ts
refreshTriggers:
  - .dependency-cruiser.cjs
  - docs/decisions/0012-flow-convergence-callback-calls-testing-redesign.md
  - docs/decisions/0013-target-architecture-and-slice-plan.md
---

# Demand：不可变事实与可重建视图

需求包是单一来源，Demand 身份含 podId。事件流拥有执行状态；查询、检查点和阅读投影不创建第二份业务状态。

> 核验基线：`1480271`（L1 observation 第十片已落地，20 个公共工具、18 个一次性场景）。工作树另有并行未提交改动（宿主 hook 通道等），本图不描绘；来源指纹按当前工作树计算。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 从需求包到 Demand 事件与视图

```mermaid
flowchart TB
  accTitle: 从需求包到 Demand 事件与视图
  accDescr: 从需求包到 Demand 事件与视图；箭头区分当前代码步骤、返回事实与明确的条件。
  record["不可变需求包"]
  board["看板认领状态"]
  create["Demand 创建"]
  commit["不可变提交批"]
  aggregate["事件聚合"]
  cache["snapshot 与 index"]
  views["Route 与 Review 视图"]
  record -->|"E-L1014-01 读取记录摘要和章节权威"| create
  board -->|"E-L1014-02 pending 与 Pod 占用准入"| create
  create -->|"E-L1014-03 先发布根和首个事件再认领"| commit
  commit -->|"E-L1014-04 重放事件转换"| aggregate
  aggregate -->|"E-L1014-05 追加成功后刷新检查点"| cache
  aggregate -->|"E-L1014-06 派生下一责任与评审输入"| views
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| Demand | 一个需求的不可变身份和事件流；当前执行环境由 podId 指定。 |
| commit | 一次不可变事件提交批；文件槽位以预期修订防止并发覆盖。 |
| snapshot | 可重建的事件聚合检查点；损坏时回退重放。 |
| projection | 根据权威重建的视图，不反向决定事实。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| record | `src/governance/ledger/ledger-authority-store.ts` | 不可变需求包 |
| board | `src/kernel/requirement-board.ts` | 看板认领状态 |
| create | `src/capabilities/demand/service.ts` | Demand 创建 |
| commit | `src/governance/demand/event-sourcing/demand-event-stream-commit.ts` | 不可变提交批 |
| aggregate | `src/governance/demand/model/demand-aggregate-state.ts` | 事件聚合 |
| cache | `src/governance/demand/event-sourcing/demand-event-sourcing-repository.ts` | snapshot 与 index |
| views | `src/governance/review/demand-result-review-snapshot.ts` | Route 与 Review 视图 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1014-01 | `src/capabilities/demand/service.ts#executeDemandCreationRequest` | `tests/capabilities/demand/service.test.ts` | 读取记录摘要和章节权威 |
| E-L1014-02 | `src/capabilities/demand/service.ts#executeDemandCreationRequest` | `tests/capabilities/demand/service.test.ts` | pending 与 Pod 占用准入 |
| E-L1014-03 | `src/governance/demand/publication/demand-event-sourcing-publication-service.ts#publishDemandFromPackage` | `tests/capabilities/demand/service.test.ts` | 先发布根和首个事件再认领 |
| E-L1014-04 | `src/governance/demand/event-sourcing/demand-event-sourcing-decider.ts#evolveDemandEventSourcingState` | `tests/governance/demand/demand-event-sourcing-command-handler.test.ts` | 重放事件转换 |
| E-L1014-05 | `src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.ts#executeDemandEventSourcingCommand` | `tests/governance/demand/demand-event-sourcing-command-handler.test.ts` | 追加成功后刷新检查点 |
| E-L1014-06 | `src/governance/controller/demand-controller-route.ts#buildDemandControllerRoute` | `tests/capabilities/demand/service.test.ts` | 派生下一责任与评审输入 |

## 守卫、恢复与验证范围

Snapshot 和索引保留的是派生缓存。读取遇到坏缓存可回退完整重放；权威提交链损坏仍应失败。完成和取消已经连接归档，详见生命周期专题。

涉及的测试与核验入口：

- `tests/capabilities/demand/service.test.ts`。
- `tests/governance/demand/demand-event-sourcing-command-handler.test.ts`。

## 下钻与相关视图

- [文件直接导入](./file-dependencies.md)
- [运行调用与恢复](./runtime-call-flow.md)
- [需求包与看板](../13-requirement/README.md)
- [完成、归档与继续](../07-review-rework-completion/runtime-call-flow.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
