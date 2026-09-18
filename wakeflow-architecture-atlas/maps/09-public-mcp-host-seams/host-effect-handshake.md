---
diagramId: ts-agent-host-handshake-h1
viewType: call-flow
truthKind: current-code
reviewDepth: L4
verifiedAt: 2026-09-18
baselineCommit: 1480271ecc8a6c17bb9042321644402bd6cbda56
sourceFingerprint: sha256:2e0e6d9de3f64a1f34986ad726c68a63de80be5c562dfd059d60ddb92e4aa36b
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: manual-review
sourcePaths:
  - src/capabilities/delivery/*.ts
  - src/capabilities/delivery/service.ts
  - src/capabilities/result-review/*.ts
  - src/capabilities/result-review/prompt.ts
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
  - src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.ts
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
  - src/kernel/hook-observations.ts
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
refreshTriggers:
  - .dependency-cruiser.cjs
  - docs/decisions/0012-flow-convergence-callback-calls-testing-redesign.md
  - docs/decisions/0013-target-architecture-and-slice-plan.md
---

# 宿主握手：向下投递与向上回调

启动、投递、回调和关闭分别有内容、动作及观察；不合并为一个后台宿主执行器。

> 核验基线：`1480271`（L1 observation 第十片已落地，20 个公共工具、18 个一次性场景）。工作树另有并行未提交改动（宿主 hook 通道等），本图不描绘；来源指纹按当前工作树计算。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 向目标窗口投递

```mermaid
sequenceDiagram
  accTitle: 向目标窗口投递
  accDescr: 向目标窗口投递；箭头区分当前代码步骤、返回事实与明确的条件。
  participant controller as Controller
  participant wf as Wakeflow 投递切片
  participant agent as 执行动作的 Agent
  participant host as 宿主窗口
  participant hook as 宿主观察
  controller->>wf: E-L1039-01 prepare 生成许可
  wf-->>agent: E-L1039-02 返回原文 prompt 和 fence
  agent->>host: E-L1039-03 调用宿主发送
  host->>hook: E-L1039-04 报告 UserPromptSubmit
  agent->>wf: E-L1039-05 record_outcome；回读只是补充观察
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| permit | 供 Agent 使用的投递内容与围栏；重放不是新一次发送授权。 |
| fence | claimId、claimDigest 与流修订构成的准入令牌。 |
| hook | 宿主回交的会话/提示提交/完成观察记录，保存在宿主本地根。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| controller | Agent / 用户 / 外部效果或条件视图 | Controller |
| wf | `src/capabilities/delivery/service.ts` | Wakeflow 投递切片 |
| agent | Agent / 用户 / 外部效果或条件视图 | 执行动作的 Agent |
| host | Agent / 用户 / 外部效果或条件视图 | 宿主窗口 |
| hook | `src/kernel/hook-observations.ts` | 宿主观察 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1039-01 | `src/capabilities/delivery/service.ts#executePrepareDeliveryRequest` | `tests/capabilities/delivery/service.test.ts` | prepare 生成许可 |
| E-L1039-02 | `src/capabilities/delivery/service.ts#prepareResult` | `tests/capabilities/delivery/service.test.ts` | 返回原文 prompt 和 fence |
| E-L1039-03 | `src/capabilities/delivery/service.ts#permitBody` | `tests/capabilities/delivery/service.test.ts` | 调用宿主发送 |
| E-L1039-04 | `src/kernel/hook-observations.ts#writeHostHookObservation` | `tests/capabilities/delivery/service.test.ts` | 报告 UserPromptSubmit |
| E-L1039-05 | `src/capabilities/delivery/service.ts#executeRecordDeliveryOutcomeRequest` | `tests/capabilities/delivery/service.test.ts` | record_outcome；回读只是补充观察 |

## 固定回调唤醒所在 Pod 的 Controller

```mermaid
sequenceDiagram
  accTitle: 固定回调唤醒所在 Pod 的 Controller
  accDescr: 固定回调唤醒所在 Pod 的 Controller；箭头区分当前代码步骤、返回事实与明确的条件。
  participant target as 目标 Agent
  participant review as 结果评审切片
  participant event as 结果与回调记录
  participant controller as 所在 Pod 的 Controller
  participant inspect as 只读评审
  target->>review: E-L1040-01 导入匹配的结果和证据
  review->>event: E-L1040-02 同次记录 Result 与 Callback
  review-->>target: E-L1040-03 返回 wake-controller 回调许可
  target->>controller: E-L1040-04 Agent 发送回调原文
  controller->>inspect: E-L1040-05 查看落地状态与完成证据
  controller->>review: E-L1040-06 提交独立评审决定
  review->>event: E-L1040-07 追加 Controller 决定
  inspect-->>controller: E-L1040-08 已有决定才派生 acknowledged
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| 回调 | 结果导入返回的 wake-controller 传输内容；送达不等于接受结果。 |
| Pod | 完整窗口组与每仓执行位置；main 是 primary Pod。 |
| hook | 宿主回交的会话/提示提交/完成观察记录，保存在宿主本地根。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| target | Agent / 用户 / 外部效果或条件视图 | 目标 Agent |
| review | `src/capabilities/result-review/service.ts` | 结果评审切片 |
| event | `src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.ts` | 结果与回调记录 |
| controller | Agent / 用户 / 外部效果或条件视图 | 所在 Pod 的 Controller |
| inspect | `src/capabilities/result-review/service.ts` | 只读评审 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1040-01 | `src/capabilities/result-review/service.ts#executeImport` | `tests/capabilities/result-review/service.test.ts` | 导入匹配的结果和证据 |
| E-L1040-02 | `src/capabilities/result-review/service.ts#executeImport` | `tests/capabilities/result-review/service.test.ts` | 同次记录 Result 与 Callback |
| E-L1040-03 | `src/capabilities/result-review/service.ts#importResult` | `tests/capabilities/result-review/service.test.ts` | 返回 wake-controller 回调许可 |
| E-L1040-04 | `src/capabilities/result-review/prompt.ts` | `tests/capabilities/result-review/service.test.ts` | Agent 发送回调原文 |
| E-L1040-05 | `src/capabilities/result-review/service.ts#inspectReview` | `tests/capabilities/result-review/service.test.ts` | 查看落地状态与完成证据 |
| E-L1040-06 | `src/capabilities/result-review/service.ts#executeImplementationDecision` | `tests/capabilities/result-review/service.test.ts` | 提交独立评审决定 |
| E-L1040-07 | `src/capabilities/result-review/service.ts#executeImplementationDecision` | `tests/capabilities/result-review/service.test.ts` | 追加 Controller 决定 |
| E-L1040-08 | `src/capabilities/result-review/service.ts#inspectReview` | `tests/capabilities/result-review/service.test.ts` | 已有决定才派生 acknowledged |

## 守卫、恢复与验证范围

inspect 始终只读。acknowledged 由已有决定派生，不是第一次查询偷偷写事件。回调重发经 rearm_delivery，静默与代际上限仍有效；旧绑定变化须重新对照当前 Controller。

涉及的测试与核验入口：

- `tests/capabilities/delivery/service.test.ts`。
- `tests/capabilities/result-review/service.test.ts`。

## 下钻与相关视图

- [本专题总览](./README.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
