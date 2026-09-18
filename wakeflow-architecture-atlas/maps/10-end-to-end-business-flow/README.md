---
diagramId: ts-end-to-end-business-z0
viewType: vertical-slice
truthKind: current-code
reviewDepth: L2
verifiedAt: 2026-09-18
baselineCommit: 1480271ecc8a6c17bb9042321644402bd6cbda56
sourceFingerprint: sha256:4f9f009c93cbb8318167cbcb1a1e238daaaa7276ca8f987d97849195e85540df
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: manual-review
sourcePaths:
  - src/capabilities/delivery/*.ts
  - src/capabilities/delivery/service.ts
  - src/capabilities/demand/*.ts
  - src/capabilities/demand/lifecycle.ts
  - src/capabilities/demand/service.ts
  - src/capabilities/endpoint/*.ts
  - src/capabilities/evidence/*.ts
  - src/capabilities/pod/*.ts
  - src/capabilities/pod/service.ts
  - src/capabilities/requirement/*.ts
  - src/capabilities/requirement/service.ts
  - src/capabilities/result-review/*.ts
  - src/capabilities/result-review/service.ts
  - src/capabilities/tasking/*.ts
  - src/capabilities/tasking/service.ts
  - src/capabilities/workspace/*.ts
  - src/capabilities/workspace/maintain-workspace.ts
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
  - src/entrypoints/*.ts
  - src/entrypoints/wakeflow-public-mcp-catalog.ts
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
  - src/governance/review/*.ts
  - src/governance/tasking/*.ts
  - src/governance/testing/*.ts
  - src/kernel/*.ts
  - src/kernel/event-stream/*.ts
  - src/workspace/*.ts
  - src/workspace/host-runtime/*.ts
  - src/workspace/maintenance/*.ts
  - src/workspace/managed-integration/*.ts
  - src/workspace/support/*.ts
  - src/workspace/window-runtime/*.ts
schemaPaths:
  - src/contracts/schemas/configuration/wakeflow-config-v3.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-board-inspection-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-board-inspection-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-cancellation-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-cancellation-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-completion-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-completion-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-continuation-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-continuation-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-publication-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-publication-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-implementation-review-decision-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-implementation-review-decision-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-maintenance-public-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-maintenance-public-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-pod-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-pod-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-prepare-delivery-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-prepare-delivery-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-rearm-delivery-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-rearm-delivery-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-record-delivery-outcome-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-record-delivery-outcome-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-record-evidence-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-record-evidence-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-requirement-publication-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-requirement-publication-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-target-result-import-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-target-result-import-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-target-result-review-inspection-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-target-result-review-inspection-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-target-task-planning-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-target-task-planning-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-test-review-decision-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-test-review-decision-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-window-host-binding-registration-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-window-host-binding-registration-result.schema.json
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
  - src/contracts/schemas/workspace/maintenance-execution-intent.schema.json
  - src/contracts/schemas/workspace/maintenance-journal.schema.json
  - src/contracts/schemas/workspace/window-host-binding.schema.json
  - src/contracts/schemas/workspace/window-runtime-unregistered-projection.schema.json
testPaths:
  - tests/entrypoints/wakeflow-public-mcp-catalog.test.ts
  - tests/scenarios/wakeflow-scenario-acceptance.test.ts
refreshTriggers:
  - .dependency-cruiser.cjs
  - docs/decisions/0012-flow-convergence-callback-calls-testing-redesign.md
  - docs/decisions/0013-target-architecture-and-slice-plan.md
---

# 业务主线：需求包到归档和 Pod 关闭

本图表达跨角色的工作顺序，各个耐久对象的状态在下钻页分开。主线现已覆盖完成归档、继续和 Pod；全局观察、L2 双宿主真实投递和 L3/E4 切换仍是后续工作。

> 核验基线：`1480271`（L1 observation 第十片已落地，20 个公共工具、18 个一次性场景）。工作树另有并行未提交改动（宿主 hook 通道等），本图不描绘；来源指纹按当前工作树计算。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 九个已落地切片的业务接力

```mermaid
flowchart TB
  accTitle: 九个已落地切片的业务接力
  accDescr: 九个已落地切片的业务接力；箭头区分当前代码步骤、返回事实与明确的条件。
  workspace["初始化与端点登记"]
  design["Design 需求包和用户确认"]
  claim["Controller 认领并创建 Demand"]
  task["任务包与测试合同"]
  delivery["准备许可与 Agent 发送"]
  result["结果、证据和固定回调"]
  review["Controller 独立评审"]
  testing["按需测试与失败分类"]
  archive["完成 / 取消即归档"]
  pod["按需 Pod 两段关闭"]
  stop["后续：L2、L3/E4"]
  workspace -->|"E-L1041-01 具备 Design 工作面"| design
  design -->|"E-L1041-02 不可变记录与 pending 看板"| claim
  claim -->|"E-L1041-03 按 Pod 限定一个活动 Demand"| task
  task -->|"E-L1041-04 单次追加与准备许可"| delivery
  delivery -->|"E-L1041-05 观察后接受匹配结果"| result
  result -->|"E-L1041-06 回调和只读评审单元"| review
  review -->|"E-L1041-07 真实环境决策时执行冻结步骤"| testing
  testing -->|"E-L1041-08 所需测试接受后再完成"| archive
  review -->|"E-L1041-09 controller-only 的完成门"| archive
  archive -->|"E-L1041-10 分支处置、退役绑定、宿主处理检出"| pod
  pod -->|"E-L1041-11 保留后续阶段边界"| stop
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| Demand | 一个需求的不可变身份和事件流；当前执行环境由 podId 指定。 |
| TaskPackage | 目标任务的不可变合同，内容来自已发布需求包。 |
| Pod | 完整窗口组与每仓执行位置；main 是 primary Pod。 |
| 回调 | 结果导入返回的 wake-controller 传输内容；送达不等于接受结果。 |
| verdict | 从逐步 expected/observed/evidence 记录派生的测试结论。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| workspace | `src/capabilities/workspace/maintain-workspace.ts` | 初始化与端点登记 |
| design | `src/capabilities/requirement/service.ts` | Design 需求包和用户确认 |
| claim | `src/capabilities/demand/service.ts` | Controller 认领并创建 Demand |
| task | `src/capabilities/tasking/service.ts` | 任务包与测试合同 |
| delivery | `src/capabilities/delivery/service.ts` | 准备许可与 Agent 发送 |
| result | `src/capabilities/result-review/service.ts` | 结果、证据和固定回调 |
| review | `src/capabilities/result-review/service.ts` | Controller 独立评审 |
| testing | `src/capabilities/result-review/service.ts` | 按需测试与失败分类 |
| archive | `src/capabilities/demand/lifecycle.ts` | 完成 / 取消即归档 |
| pod | `src/capabilities/pod/service.ts` | 按需 Pod 两段关闭 |
| stop | `src/entrypoints/wakeflow-public-mcp-catalog.ts` | 后续：L2、L3/E4 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1041-01 | `src/capabilities/workspace/maintain-workspace.ts` | `tests/scenarios/wakeflow-scenario-acceptance.test.ts` | 具备 Design 工作面 |
| E-L1041-02 | `src/capabilities/requirement/service.ts#applyPublish` | `tests/scenarios/wakeflow-scenario-acceptance.test.ts` | 不可变记录与 pending 看板 |
| E-L1041-03 | `src/capabilities/demand/service.ts#planCreate` | `tests/scenarios/wakeflow-scenario-acceptance.test.ts` | 按 Pod 限定一个活动 Demand |
| E-L1041-04 | `src/capabilities/delivery/service.ts#executePrepare` | `tests/scenarios/wakeflow-scenario-acceptance.test.ts` | 单次追加与准备许可 |
| E-L1041-05 | `src/capabilities/result-review/service.ts#executeImport` | `tests/scenarios/wakeflow-scenario-acceptance.test.ts` | 观察后接受匹配结果 |
| E-L1041-06 | `src/capabilities/result-review/service.ts#inspectReview` | `tests/scenarios/wakeflow-scenario-acceptance.test.ts` | 回调和只读评审单元 |
| E-L1041-07 | `src/capabilities/tasking/service.ts#buildTestPackage` | `tests/scenarios/wakeflow-scenario-acceptance.test.ts` | 真实环境决策时执行冻结步骤 |
| E-L1041-08 | `src/capabilities/demand/lifecycle.ts#planTerminal` | `tests/scenarios/wakeflow-scenario-acceptance.test.ts` | 所需测试接受后再完成 |
| E-L1041-09 | `src/capabilities/demand/lifecycle.ts#planTerminal` | `tests/scenarios/wakeflow-scenario-acceptance.test.ts` | controller-only 的完成门 |
| E-L1041-10 | `src/capabilities/pod/service.ts#planClose` | `tests/scenarios/wakeflow-scenario-acceptance.test.ts` | 分支处置、退役绑定、宿主处理检出 |
| E-L1041-11 | `src/entrypoints/wakeflow-public-mcp-catalog.ts` | `tests/entrypoints/wakeflow-public-mcp-catalog.test.ts` | 保留后续阶段边界 |

## 守卫、恢复与验证范围

返工、escalate/record-decision、continue 是旁路，不改变每次验收的责任。代码校验引用和谱系；最终行为真伪仍由 Controller 独立检查。16 个一次性工作区场景包含真实 Git worktree fixture，但不代表真实 Codex/Claude 会话端到端已验证。

涉及的测试与核验入口：

- `tests/entrypoints/wakeflow-public-mcp-catalog.test.ts`。
- `tests/scenarios/wakeflow-scenario-acceptance.test.ts`。

## 下钻与相关视图

- [按 owner 分开的状态与恢复](./state-and-recovery.md)
- [场景与验证矩阵](./review-evidence.md)
- [只读观察与核验](../16-observation/README.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
