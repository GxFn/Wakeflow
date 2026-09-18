---
diagramId: ts-kernel-readme
viewType: architecture
truthKind: current-code
reviewDepth: L0
verifiedAt: 2026-09-18
baselineCommit: 1480271ecc8a6c17bb9042321644402bd6cbda56
sourceFingerprint: sha256:7170354610b306b3ea51130292331aa0d4f5726632ecaf0bf5cf8c367abb4d40
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: manual-review
sourcePaths:
  - src/capabilities/tasking/*.ts
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
  - src/governance/demand/publication/*.ts
  - src/governance/evidence/*.ts
  - src/governance/ledger/*.ts
  - src/governance/lifecycle/*.ts
  - src/governance/result/*.ts
  - src/governance/review/*.ts
  - src/governance/tasking/*.ts
  - src/governance/testing/*.ts
  - src/kernel/*.ts
  - src/kernel/append-command.ts
  - src/kernel/command-shell.ts
  - src/kernel/event-stream/*.ts
  - src/kernel/next-projection.ts
  - src/kernel/publication-transaction.ts
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
  - tests/capabilities/demand/service.test.ts
  - tests/capabilities/tasking/service.test.ts
  - tests/capabilities/workspace/maintain-workspace.test.ts
  - tests/kernel/active-projection.test.ts
  - tests/kernel/command-shell.test.ts
refreshTriggers:
  - .dependency-cruiser.cjs
  - docs/decisions/0013-target-architecture-and-slice-plan.md
---

# 内核：可复用的调用与准入机制

内核承接通用机械边界，能力切片保留业务决定。目录和 next 表不是全局业务状态机。本基线新增 active-projection：内核只负责人读投影文件的渲染与安全重写，事实由调用方提供。

> 核验基线：`1480271`（L1 observation 第十片已落地，20 个公共工具、18 个一次性场景）。工作树另有并行未提交改动（宿主 hook 通道等），本图不描绘；来源指纹按当前工作树计算。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 共同命令外壳与两种变更形状

```mermaid
flowchart TB
  accTitle: 共同命令外壳与两种变更形状
  accDescr: 共同命令外壳与两种变更形状；箭头区分当前代码步骤、返回事实与明确的条件。
  request["能力请求"]
  shell["解析、根、脱敏、上限"]
  append["追加型外壳"]
  effect["效果型外壳"]
  owner["切片自己的决定与提交"]
  next["派生结果与 next"]
  projection["人读投影文件"]
  request -->|"E-L1046-01 统一边界准入"| shell
  shell -->|"E-L1046-02 幂等键和预期修订"| append
  shell -->|"E-L1046-03 preview / apply / recover"| effect
  append -->|"E-L1046-04 执行切片指定主体"| owner
  effect -->|"E-L1046-05 比对重新推导的计划"| owner
  owner -->|"E-L1046-06 仅投影下一责任"| next
  owner -->|"E-L1046-07 提供事实后锁内安全重写"| projection
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| CAS | 比较已观察的摘要/修订后提交；来源已改变则拒绝。 |
| next | 根据当前事实派生的下一责任与建议工具。 |
| projection | 根据权威重建的视图，不反向决定事实。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| request | `src/kernel/command-shell.ts` | 能力请求 |
| shell | `src/kernel/command-shell.ts` | 解析、根、脱敏、上限 |
| append | `src/kernel/append-command.ts` | 追加型外壳 |
| effect | `src/kernel/publication-transaction.ts` | 效果型外壳 |
| owner | `src/capabilities/tasking/service.ts` | 切片自己的决定与提交 |
| next | `src/kernel/next-projection.ts` | 派生结果与 next |
| projection | `src/kernel/active-projection.ts#publishActiveProjection` | 人读投影文件 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1046-01 | `src/kernel/command-shell.ts#runCommandShell` | `tests/kernel/command-shell.test.ts` | 统一边界准入 |
| E-L1046-02 | `src/kernel/append-command.ts#runAppendCommand` | `tests/capabilities/tasking/service.test.ts` | 幂等键和预期修订 |
| E-L1046-03 | `src/kernel/publication-transaction.ts#runPublicationTransaction` | `tests/capabilities/workspace/maintain-workspace.test.ts` | preview / apply / recover |
| E-L1046-04 | `src/kernel/append-command.ts#runAppendCommand` | `tests/capabilities/tasking/service.test.ts` | 执行切片指定主体 |
| E-L1046-05 | `src/kernel/publication-transaction.ts#runPublicationTransaction` | `tests/capabilities/workspace/maintain-workspace.test.ts` | 比对重新推导的计划 |
| E-L1046-06 | `src/kernel/next-projection.ts#deriveNextProjection` | `tests/capabilities/demand/service.test.ts` | 仅投影下一责任 |
| E-L1046-07 | `src/kernel/active-projection.ts#publishActiveProjection` | `tests/kernel/active-projection.test.ts` | 提供事实后锁内安全重写 |

## 守卫、恢复与验证范围

幂等绑定进入事件流，不另设一个无消费者的 idempotency-store。PublicationTransaction 外壳不取代各领域的锁和日志；hook、work-claim、worktree receipt 分别持有自己的物理记录。active-projection 不读配置也不读事件流：事实由调用方给出，任一目标不安全时整轮零写，只有每个文件都带标记的 Demand 页目录才会退休；页面是导航，不是权威。

涉及的测试与核验入口：

- `tests/capabilities/demand/service.test.ts`。
- `tests/capabilities/tasking/service.test.ts`。
- `tests/capabilities/workspace/maintain-workspace.test.ts`。
- `tests/kernel/active-projection.test.ts`。
- `tests/kernel/command-shell.test.ts`。

## 下钻与相关视图

- [文件直接导入](./file-dependencies.md)
- [运行调用与恢复](./runtime-call-flow.md)
- [只读观察与核验](../16-observation/README.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
