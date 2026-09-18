---
diagramId: ts-pod-readme
viewType: authority
truthKind: current-code
reviewDepth: L4
verifiedAt: 2026-09-18
baselineCommit: 1480271ecc8a6c17bb9042321644402bd6cbda56
sourceFingerprint: sha256:d81faece48674685bc940b80cfc1f82c86f6c31a202d47505ea7609a8f8988ed
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: manual-review
sourcePaths:
  - src/capabilities/demand/*.ts
  - src/capabilities/demand/service.ts
  - src/capabilities/endpoint/*.ts
  - src/capabilities/endpoint/service.ts
  - src/capabilities/pod/*.ts
  - src/capabilities/pod/decide.ts
  - src/capabilities/pod/service.ts
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
  - src/governance/demand/model/*.ts
  - src/governance/demand/publication/*.ts
  - src/governance/evidence/*.ts
  - src/governance/ledger/*.ts
  - src/governance/lifecycle/*.ts
  - src/governance/pod/*.ts
  - src/governance/result/*.ts
  - src/governance/review/*.ts
  - src/governance/tasking/*.ts
  - src/governance/testing/*.ts
  - src/kernel/*.ts
  - src/kernel/event-stream/*.ts
  - src/kernel/pod-worktree-receipts.ts
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
  - src/contracts/schemas/workspace/window-runtime-registered-projection.schema.json
  - src/contracts/schemas/workspace/window-runtime-unregistered-projection.schema.json
testPaths:
  - tests/capabilities/pod/service.test.ts
refreshTriggers:
  - .dependency-cruiser.cjs
  - docs/decisions/0012-flow-convergence-callback-calls-testing-redesign.md
  - docs/decisions/0013-target-architecture-and-slice-plan.md
---

# Pod：完整窗口组与检出回执

main 是 primary Pod；用户要求并发时创建 worktree Pod。配置保存 open/closing，creating/ready/closing/closed 是配置、绑定和检出事实的派生状态，派生函数自本基线起住在治理层 `src/governance/pod/pod-state.ts`。

> 核验基线：`1480271`（L1 observation 第十片已落地，20 个公共工具、18 个一次性场景）。工作树另有并行未提交改动（宿主 hook 通道等），本图不描绘；来源指纹按当前工作树计算。本文说明实现事实，未宣称双宿主真实会话已经验证。

## Pod 配置和端点事实形成执行环境

```mermaid
flowchart TB
  accTitle: Pod 配置和端点事实形成执行环境
  accDescr: Pod 配置和端点事实形成执行环境；箭头区分当前代码步骤、返回事实与明确的条件。
  intent["用户请求与 Pod 意图"]
  config["Config 追加 Pod 和窗口"]
  host["Agent 创建会话与 worktree"]
  binding["同 Pod 的端点绑定"]
  receipt["Git 指针核对后的回执"]
  ready["ready 派生视图"]
  demand["本 Pod 一个活动 Demand"]
  intent -->|"E-L1063-01 同意图摘要 CAS"| config
  config -->|"E-L1063-02 输出启动意图"| host
  host -->|"E-L1063-03 各角色登记 SessionStart"| binding
  binding -->|"E-L1063-04 产品窗口登记检出与绑定代际"| receipt
  receipt -->|"E-L1063-05 窗口齐全且回执及检出当前"| ready
  config -->|"E-L1063-06 按 podId 检查作用域与活动 Demand"| demand
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| Pod | 完整窗口组与每仓执行位置；main 是 primary Pod。 |
| host | Codex 或 Claude Code；真实会话动作由 Agent 调用宿主完成。 |
| CAS | 比较已观察的摘要/修订后提交；来源已改变则拒绝。 |
| projection | 根据权威重建的视图，不反向决定事实。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| intent | `src/capabilities/pod/service.ts` | 用户请求与 Pod 意图 |
| config | `src/capabilities/pod/service.ts` | Config 追加 Pod 和窗口 |
| host | Agent / 用户 / 外部效果或条件视图 | Agent 创建会话与 worktree |
| binding | `src/capabilities/endpoint/service.ts` | 同 Pod 的端点绑定 |
| receipt | `src/kernel/pod-worktree-receipts.ts` | Git 指针核对后的回执 |
| ready | `src/governance/pod/pod-state.ts#derivePodState` | ready 派生视图 |
| demand | `src/capabilities/demand/service.ts` | 本 Pod 一个活动 Demand |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1063-01 | `src/capabilities/pod/service.ts#applyCreate` | `tests/capabilities/pod/service.test.ts` | 同意图摘要 CAS |
| E-L1063-02 | `src/capabilities/pod/service.ts#currentViews` | `tests/capabilities/pod/service.test.ts` | 输出启动意图 |
| E-L1063-03 | `src/capabilities/endpoint/service.ts` | `tests/capabilities/pod/service.test.ts` | 各角色登记 SessionStart |
| E-L1063-04 | `src/kernel/pod-worktree-receipts.ts#admitPodWorktreeObservation` | `tests/capabilities/pod/service.test.ts` | 产品窗口登记检出与绑定代际 |
| E-L1063-05 | `src/governance/pod/pod-state.ts#derivePodState` | `tests/capabilities/pod/service.test.ts` | 窗口齐全且回执及检出当前 |
| E-L1063-06 | `src/capabilities/demand/service.ts#planCreate` | `tests/capabilities/pod/service.test.ts` | 按 podId 检查作用域与活动 Demand |

## 守卫、恢复与验证范围

ready 是派生视图，create_demand 当前只检查 Pod 存在、open 与不忙，不以 ready 作机器门。Pod 角色约定由 Agent/skills 执行；公共工具目前不认证调用者就是 main Controller。Wakeflow 不运行 git、不合并分支、不删除宿主检出；回执核对使用 .git 指针与已交回观察。

本基线起，Pod 结果附带 worktree 处置建议：它是给 Agent 与用户读的文本建议（`src/governance/pod/worktree-disposal.ts#worktreeDisposalGuidance`），Wakeflow 自己既不执行也不据此判定关闭完成；实际删除检出仍由宿主或用户完成。全局 Pod 状态与残留报告现在由 observation 的 `wakeflow_status` 读取，见下方下钻。

涉及的测试与核验入口：

- `tests/capabilities/pod/service.test.ts`。

## 下钻与相关视图

- [文件直接导入](./file-dependencies.md)
- [运行调用与恢复](./runtime-call-flow.md)
- [只读观察与核验](../16-observation/README.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
