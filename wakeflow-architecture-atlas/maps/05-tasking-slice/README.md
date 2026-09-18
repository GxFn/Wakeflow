---
diagramId: ts-tasking-vertical-t0
viewType: vertical-slice
truthKind: current-code
reviewDepth: L2
verifiedAt: 2026-09-18
baselineCommit: 1480271ecc8a6c17bb9042321644402bd6cbda56
sourceFingerprint: sha256:9343f3b49ad70ccc7edd849ce0846e9fa675fef8e405d98ea4489504f4e88117
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
  - src/governance/tasking/task-package.ts
  - src/governance/testing/*.ts
  - src/kernel/*.ts
  - src/kernel/event-stream/*.ts
  - src/workspace/*.ts
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

# 任务规划：需求锚点、谱系与测试合同

公共规划已改为一次追加。实现任务的锚点逐条指向需求包验收标准；测试任务直接携带 testContract，独立 TestCard 家族已经移除。

> 核验基线：`1480271`（L1 observation 第十片已落地，20 个公共工具、18 个一次性场景）。工作树另有并行未提交改动（宿主 hook 通道等），本图不描绘；来源指纹按当前工作树计算。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 一次追加生成任务合同

```mermaid
flowchart TB
  accTitle: 一次追加生成任务合同
  accDescr: 一次追加生成任务合同；箭头区分当前代码步骤、返回事实与明确的条件。
  request["Controller 任务草稿"]
  anchors["核对章节与验收条目"]
  lineage["检查 Pod、谱系与用户审阅门"]
  package["不可变 TaskPackage"]
  event["规划事件与聚合"]
  view["任务投影与 next"]
  request -->|"E-L1019-01 读取固定记录并切分条目"| anchors
  anchors -->|"E-L1019-02 校验 requirementRef 和 sectionAnchors"| lineage
  lineage -->|"E-L1019-03 确定性构造完整合同"| package
  package -->|"E-L1019-04 tasking.target-task-planned"| event
  event -->|"E-L1019-05 幂等物化并给出下一责任"| view
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| TaskPackage | 目标任务的不可变合同，内容来自已发布需求包。 |
| testContract | 测试任务包内冻结的步骤、环境、技能、预算与停止条件。 |
| CAS | 比较已观察的摘要/修订后提交；来源已改变则拒绝。 |
| next | 根据当前事实派生的下一责任与建议工具。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| request | `src/capabilities/tasking/service.ts` | Controller 任务草稿 |
| anchors | `src/capabilities/tasking/decide.ts` | 核对章节与验收条目 |
| lineage | `src/capabilities/tasking/decide.ts` | 检查 Pod、谱系与用户审阅门 |
| package | `src/governance/tasking/task-package.ts` | 不可变 TaskPackage |
| event | `src/governance/demand/model/demand-aggregate-state.ts` | 规划事件与聚合 |
| view | `src/governance/tasking/task-package-projection-store.ts` | 任务投影与 next |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1019-01 | `src/capabilities/tasking/service.ts#buildImplementationPackage` | `tests/capabilities/tasking/service.test.ts` | 读取固定记录并切分条目 |
| E-L1019-02 | `src/capabilities/tasking/decide.ts#deriveAnchorReferenceBlockers` | `tests/capabilities/tasking/service.test.ts` | 校验 requirementRef 和 sectionAnchors |
| E-L1019-03 | `src/capabilities/tasking/service.ts#buildPackage` | `tests/capabilities/tasking/service.test.ts` | 确定性构造完整合同 |
| E-L1019-04 | `src/capabilities/tasking/service.ts#execute` | `tests/capabilities/tasking/service.test.ts` | tasking.target-task-planned |
| E-L1019-05 | `src/capabilities/tasking/service.ts#materialize` | `tests/capabilities/tasking/service.test.ts` | 幂等物化并给出下一责任 |

## 守卫、恢复与验证范围

同一仓库的开放谱系须 replacement；只有接受的前序可 continuation。新 replacement 创建时旧目标成为 superseded。taskPlanReview:user 要求请求带确认时间；不是只保存一个未消费的元数据字段。

涉及的测试与核验入口：

- `tests/capabilities/tasking/service.test.ts`。

## 下钻与相关视图

- [文件直接导入](./file-dependencies.md)
- [运行调用与恢复](./runtime-call-flow.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
