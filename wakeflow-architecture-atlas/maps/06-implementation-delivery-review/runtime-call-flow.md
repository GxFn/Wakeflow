---
diagramId: ts-delivery-review-runtime-d1
viewType: call-flow
truthKind: current-code
reviewDepth: L4
verifiedAt: 2026-09-18
baselineCommit: 1480271ecc8a6c17bb9042321644402bd6cbda56
sourceFingerprint: sha256:42254813ec2ec3a91fec0eab12dc0d3074a1ecf3eb552f4a4fc05bcf2326d17b
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: manual-review
sourcePaths:
  - src/capabilities/delivery/*.ts
  - src/capabilities/delivery/decide.ts
  - src/capabilities/delivery/service.ts
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
  - src/kernel/work-claims.ts
  - src/workspace/*.ts
  - src/workspace/window-runtime/*.ts
schemaPaths:
  - src/contracts/schemas/configuration/wakeflow-config-v3.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-prepare-delivery-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-prepare-delivery-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-rearm-delivery-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-rearm-delivery-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-record-delivery-outcome-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-record-delivery-outcome-result.schema.json
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

# 投递：准备、落地与重发恢复

当前三个追加工具为 prepare_delivery、record_delivery_outcome、rearm_delivery。

> 核验基线：`1480271`（L1 observation 第十片已落地，20 个公共工具、18 个一次性场景）。工作树另有并行未提交改动（宿主 hook 通道等），本图不描绘；来源指纹按当前工作树计算。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 准备信封与许可

```mermaid
sequenceDiagram
  accTitle: 准备信封与许可
  accDescr: 准备信封与许可；箭头区分当前代码步骤、返回事实与明确的条件。
  participant controller as Controller
  participant slice as 投递切片
  participant claim as 工作声明
  participant event as 事件命令
  controller->>slice: E-L1026-01 任务与三段人话，加幂等键和修订
  slice->>claim: E-L1026-02 匹配绑定与 worktree 回执后占用
  slice->>slice: E-L1026-03 渲染可移植 prompt 和 fence
  slice->>event: E-L1026-04 记录完整信封
  slice-->>controller: E-L1026-05 返回许可与 next
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| permit | 供 Agent 使用的投递内容与围栏；重放不是新一次发送授权。 |
| fence | claimId、claimDigest 与流修订构成的准入令牌。 |
| claim | 端点注意力及产品检出的工作声明，释放必须匹配当前令牌。 |
| next | 根据当前事实派生的下一责任与建议工具。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| controller | Agent / 用户 / 外部效果或条件视图 | Controller |
| slice | `src/capabilities/delivery/service.ts` | 投递切片 |
| claim | `src/kernel/work-claims.ts` | 工作声明 |
| event | `src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.ts` | 事件命令 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1026-01 | `src/capabilities/delivery/service.ts#executePrepareDeliveryRequest` | `tests/capabilities/delivery/service.test.ts` | 任务与三段人话，加幂等键和修订 |
| E-L1026-02 | `src/capabilities/delivery/service.ts#takeClaim` | `tests/capabilities/delivery/service.test.ts` | 匹配绑定与 worktree 回执后占用 |
| E-L1026-03 | `src/capabilities/delivery/service.ts#renderPrompt` | `tests/capabilities/delivery/service.test.ts` | 渲染可移植 prompt 和 fence |
| E-L1026-04 | `src/capabilities/delivery/service.ts#executePrepare` | `tests/capabilities/delivery/service.test.ts` | 记录完整信封 |
| E-L1026-05 | `src/capabilities/delivery/service.ts#prepareResult` | `tests/capabilities/delivery/service.test.ts` | 返回许可与 next |

## 落地证据与不确定结果

```mermaid
sequenceDiagram
  accTitle: 落地证据与不确定结果
  accDescr: 落地证据与不确定结果；箭头区分当前代码步骤、返回事实与明确的条件。
  participant agent as Agent / 宿主
  participant slice as 投递切片
  participant hook as 宿主观察
  participant decide as 处置决定
  participant event as 事件流
  agent->>slice: E-L1027-01 回交发送尝试和回读
  slice->>hook: E-L1027-02 读取目标会话的 UserPromptSubmit
  slice->>decide: E-L1027-03 核 prompt 摘要或 Codex 发送返回
  slice->>event: E-L1027-04 追加 accepted / indeterminate / rejected
  alt 明确 rejected-before-send
  slice->>slice: E-L1027-05 提交观察后释放精确声明
  end
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| hook | 宿主回交的会话/提示提交/完成观察记录，保存在宿主本地根。 |
| claim | 端点注意力及产品检出的工作声明，释放必须匹配当前令牌。 |
| commit | 一次不可变事件提交批；文件槽位以预期修订防止并发覆盖。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| agent | Agent / 用户 / 外部效果或条件视图 | Agent / 宿主 |
| slice | `src/capabilities/delivery/service.ts` | 投递切片 |
| hook | `src/kernel/hook-observations.ts` | 宿主观察 |
| decide | `src/capabilities/delivery/decide.ts` | 处置决定 |
| event | `src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.ts` | 事件流 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1027-01 | `src/capabilities/delivery/service.ts#executeRecordDeliveryOutcomeRequest` | `tests/capabilities/delivery/service.test.ts` | 回交发送尝试和回读 |
| E-L1027-02 | `src/capabilities/delivery/service.ts#sessionRecords` | `tests/capabilities/delivery/service.test.ts` | 读取目标会话的 UserPromptSubmit |
| E-L1027-03 | `src/capabilities/delivery/decide.ts#deriveDeliveryDisposition` | `tests/capabilities/delivery/service.test.ts` | 核 prompt 摘要或 Codex 发送返回 |
| E-L1027-04 | `src/capabilities/delivery/service.ts#executeOutcome` | `tests/capabilities/delivery/service.test.ts` | 追加 accepted / indeterminate / rejected |
| E-L1027-05 | `src/capabilities/delivery/service.ts#releaseClaimFor` | `tests/capabilities/delivery/service.test.ts` | 提交观察后释放精确声明 |

## 原信封的 rearm 与回调重发

```mermaid
sequenceDiagram
  accTitle: 原信封的 rearm 与回调重发
  accDescr: 原信封的 rearm 与回调重发；箭头区分当前代码步骤、返回事实与明确的条件。
  participant controller as Controller
  participant slice as 投递切片
  participant decide as 阶段和上限检查
  participant event as 事件流
  controller->>slice: E-L1028-01 rearm 原 deliveryId
  slice->>decide: E-L1028-02 仅 rejected 代际且上限未用尽
  slice->>event: E-L1028-03 同 prompt，新代际与 fence
  opt 回调静默且尚未送达
  slice->>event: E-L1028-04 回调重发指向当前 Controller 绑定
  end
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| permit | 供 Agent 使用的投递内容与围栏；重放不是新一次发送授权。 |
| fence | claimId、claimDigest 与流修订构成的准入令牌。 |
| 回调 | 结果导入返回的 wake-controller 传输内容；送达不等于接受结果。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| controller | Agent / 用户 / 外部效果或条件视图 | Controller |
| slice | `src/capabilities/delivery/service.ts` | 投递切片 |
| decide | `src/capabilities/delivery/decide.ts` | 阶段和上限检查 |
| event | `src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.ts` | 事件流 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1028-01 | `src/capabilities/delivery/service.ts#executeRearmDeliveryRequest` | `tests/capabilities/delivery/service.test.ts` | rearm 原 deliveryId |
| E-L1028-02 | `src/capabilities/delivery/decide.ts#deriveRearmBlockers` | `tests/capabilities/delivery/service.test.ts` | 仅 rejected 代际且上限未用尽 |
| E-L1028-03 | `src/capabilities/delivery/service.ts#executeRearm` | `tests/capabilities/delivery/service.test.ts` | 同 prompt，新代际与 fence |
| E-L1028-04 | `src/capabilities/delivery/service.ts#executeCallbackReissue` | `tests/capabilities/result-review/service.test.ts` | 回调重发指向当前 Controller 绑定 |

## 守卫、恢复与验证范围

原信封最多三次 rearm，用尽后 prepare 新信封。回调重发另受落地、静默阈值及上限约束，不占用产品工作声明。

涉及的测试与核验入口：

- `tests/capabilities/delivery/service.test.ts`。
- `tests/capabilities/result-review/service.test.ts`。

## 下钻与相关视图

- [本专题总览](./README.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
