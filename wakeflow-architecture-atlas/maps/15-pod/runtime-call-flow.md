---
diagramId: ts-pod-runtime-call-flow
viewType: call-flow
truthKind: current-code
reviewDepth: L4
verifiedAt: 2026-09-11
baselineCommit: 7ba1f38938a7387623b0ca588d9cfd54abda5760
sourceFingerprint: sha256:c4936035bf41ad806c09fe01fd403101220d4ebf9d740607c658f15ab3c6da30
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: manual-review
sourcePaths:
  - src/capabilities/endpoint/*.ts
  - src/capabilities/endpoint/service.ts
  - src/capabilities/pod/*.ts
  - src/capabilities/pod/decide.ts
  - src/capabilities/pod/service.ts
  - src/configuration/*.ts
  - src/configuration/wakeflow-config-authority-replacement.ts
  - src/contracts/generated/configuration/*.ts
  - src/contracts/generated/entrypoints/*.ts
  - src/contracts/generated/foundation/*.ts
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
  - src/kernel/pod-worktree-receipts.ts
  - src/workspace/*.ts
  - src/workspace/active/*.ts
  - src/workspace/window-runtime/*.ts
schemaPaths:
  - src/contracts/schemas/configuration/wakeflow-config-v3.schema.json
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

# Pod：创建、就绪与两段关闭

状态是派生结果，创建配置不代表实际窗口已经可用。

> 核验基线：`7ba1f38`；核验时实现代码均已提交，本轮图谱更新另列。开发阶段为 L1 九片已落地，observation 尚未开始。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 创建与 worktree 登记

```mermaid
sequenceDiagram
  accTitle: 创建与 worktree 登记
  accDescr: 创建与 worktree 登记；箭头区分当前代码步骤、返回事实与明确的条件。
  participant controller as main Controller / Agent
  participant pod as Pod 切片
  participant config as Config CAS
  participant endpoint as 端点切片
  participant receipt as worktree 回执
  controller->>pod: E-L1065-01 create preview/name/idempotencyKey
  controller->>pod: E-L1065-02 同意图与摘要 apply
  pod->>config: E-L1065-03 追加完整窗口组和 worktree 意图
  controller->>endpoint: E-L1065-04 宿主创建后登记会话和 porcelain
  endpoint->>receipt: E-L1065-05 非主检出、common-dir、双向 gitdir 与 HEAD 核对
  pod-->>controller: E-L1065-06 由当前事实派生 creating / ready
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| Pod | 完整窗口组与每仓执行位置；main 是 primary Pod。 |
| CAS | 比较已观察的摘要/修订后提交；来源已改变则拒绝。 |
| hook | 宿主回交的会话/提示提交/完成观察记录，保存在宿主本地根。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| controller | Agent / 用户 / 外部效果或条件视图 | main Controller / Agent |
| pod | `src/capabilities/pod/service.ts` | Pod 切片 |
| config | `src/configuration/wakeflow-config-authority-replacement.ts` | Config CAS |
| endpoint | `src/capabilities/endpoint/service.ts` | 端点切片 |
| receipt | `src/kernel/pod-worktree-receipts.ts` | worktree 回执 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1065-01 | `src/capabilities/pod/service.ts#planCreate` | `tests/capabilities/pod/service.test.ts` | create preview/name/idempotencyKey |
| E-L1065-02 | `src/capabilities/pod/service.ts#executePodRequest` | `tests/capabilities/pod/service.test.ts` | 同意图与摘要 apply |
| E-L1065-03 | `src/capabilities/pod/service.ts#applyCreate` | `tests/capabilities/pod/service.test.ts` | 追加完整窗口组和 worktree 意图 |
| E-L1065-04 | `src/capabilities/endpoint/service.ts#executeWindowBindingRequest` | `tests/capabilities/pod/service.test.ts` | 宿主创建后登记会话和 porcelain |
| E-L1065-05 | `src/kernel/pod-worktree-receipts.ts#admitPodWorktreeObservation` | `tests/capabilities/pod/service.test.ts` | 非主检出、common-dir、双向 gitdir 与 HEAD 核对 |
| E-L1065-06 | `src/capabilities/pod/decide.ts#derivePodState` | `tests/capabilities/pod/service.test.ts` | 由当前事实派生 creating / ready |

## 归档后两段关闭

```mermaid
sequenceDiagram
  accTitle: 归档后两段关闭
  accDescr: 归档后两段关闭；箭头区分当前代码步骤、返回事实与明确的条件。
  participant controller as main Controller / Agent
  participant pod as Pod 切片
  participant config as 配置权威
  participant host as 宿主会话与检出
  participant endpoint as 绑定和回执
  controller->>pod: E-L1066-01 close：已无活动 Demand，提交分支处置
  pod->>config: E-L1066-02 第一段保存 closing
  controller->>host: E-L1066-03 由宿主关闭会话并处置检出
  controller->>endpoint: E-L1066-04 显式退役绑定
  controller->>pod: E-L1066-05 同 close 意图再次 preview/apply
  pod->>config: E-L1066-06 绑定与检出均消失后移除 Pod
  pod->>endpoint: E-L1066-07 只退休 Wakeflow 自己的回执
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| Pod | 完整窗口组与每仓执行位置；main 是 primary Pod。 |
| CAS | 比较已观察的摘要/修订后提交；来源已改变则拒绝。 |
| host | Codex 或 Claude Code；真实会话动作由 Agent 调用宿主完成。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| controller | Agent / 用户 / 外部效果或条件视图 | main Controller / Agent |
| pod | `src/capabilities/pod/service.ts` | Pod 切片 |
| config | `src/configuration/wakeflow-config-authority-replacement.ts` | 配置权威 |
| host | Agent / 用户 / 外部效果或条件视图 | 宿主会话与检出 |
| endpoint | `src/capabilities/endpoint/service.ts` | 绑定和回执 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1066-01 | `src/capabilities/pod/decide.ts#deriveCloseRequestBlockers` | `tests/capabilities/pod/service.test.ts` | close：已无活动 Demand，提交分支处置 |
| E-L1066-02 | `src/capabilities/pod/service.ts#applyCloseRequest` | `tests/capabilities/pod/service.test.ts` | 第一段保存 closing |
| E-L1066-03 | `src/capabilities/pod/service.ts#planClose` | `tests/capabilities/pod/service.test.ts` | 由宿主关闭会话并处置检出 |
| E-L1066-04 | `src/capabilities/endpoint/service.ts#applyDecommission` | `tests/capabilities/pod/service.test.ts` | 显式退役绑定 |
| E-L1066-05 | `src/capabilities/pod/service.ts#executePodRequest` | `tests/capabilities/pod/service.test.ts` | 同 close 意图再次 preview/apply |
| E-L1066-06 | `src/capabilities/pod/service.ts#applyCloseComplete` | `tests/capabilities/pod/service.test.ts` | 绑定与检出均消失后移除 Pod |
| E-L1066-07 | `src/kernel/pod-worktree-receipts.ts#retirePodReceipts` | `tests/capabilities/pod/service.test.ts` | 只退休 Wakeflow 自己的回执 |

## 守卫、恢复与验证范围

primary 不可关闭。有活动 Demand、未交代分支、剩余绑定或仍存在检出时阻塞。recover 只对账过期或孤儿回执；全局 Pod 状态视图和残留报告仍待 observation。

涉及的测试与核验入口：

- `tests/capabilities/pod/service.test.ts`。

## 下钻与相关视图

- [本专题总览](./README.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
