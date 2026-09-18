---
diagramId: ts-kernel-runtime-call-flow
viewType: call-flow
truthKind: current-code
reviewDepth: L4
verifiedAt: 2026-09-18
baselineCommit: 1480271ecc8a6c17bb9042321644402bd6cbda56
sourceFingerprint: sha256:80add864c3d274df8a6b7049840b04ed17fbe3c22cc63c12b8e4eb7ae596ce15
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
  - src/foundation/filesystem/rooted-directory.ts
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
  - src/kernel/append-command.ts
  - src/kernel/command-shell.ts
  - src/kernel/event-stream/*.ts
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
  - tests/capabilities/tasking/service.test.ts
  - tests/capabilities/workspace/maintain-workspace.test.ts
  - tests/kernel/command-shell.test.ts
refreshTriggers:
  - .dependency-cruiser.cjs
  - docs/decisions/0013-target-architecture-and-slice-plan.md
---

# 内核：命令外壳、追加与效果

三个小图分别说明共有边界、追加特有参数与效果计划重算。

> 核验基线：`1480271`（L1 observation 第十片已落地，20 个公共工具、18 个一次性场景）。工作树另有并行未提交改动（宿主 hook 通道等），本图不描绘；来源指纹按当前工作树计算。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 共有命令外壳

```mermaid
sequenceDiagram
  accTitle: 共有命令外壳
  accDescr: 共有命令外壳；箭头区分当前代码步骤、返回事实与明确的条件。
  participant slice as 切片规格
  participant shell as Command Shell
  participant root as RootedDirectory
  participant body as 切片主体
  slice->>shell: E-L1048-01 parseRequest 与 open / close
  shell->>root: E-L1048-02 固定真实根并设置私有边界
  shell->>body: E-L1048-03 调用已准入的主体
  shell-->>slice: E-L1048-04 脱敏、限制结果并关闭上下文
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| CAS | 比较已观察的摘要/修订后提交；来源已改变则拒绝。 |
| projection | 根据权威重建的视图，不反向决定事实。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| slice | Agent / 用户 / 外部效果或条件视图 | 切片规格 |
| shell | `src/kernel/command-shell.ts` | Command Shell |
| root | `src/foundation/filesystem/rooted-directory.ts` | RootedDirectory |
| body | Agent / 用户 / 外部效果或条件视图 | 切片主体 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1048-01 | `src/kernel/command-shell.ts#runCommandShell` | `tests/kernel/command-shell.test.ts` | parseRequest 与 open / close |
| E-L1048-02 | `src/kernel/command-shell.ts#runCommandShell` | `tests/kernel/command-shell.test.ts` | 固定真实根并设置私有边界 |
| E-L1048-03 | `src/kernel/command-shell.ts#runCommandShell` | `tests/kernel/command-shell.test.ts` | 调用已准入的主体 |
| E-L1048-04 | `src/kernel/command-shell.ts#runCommandShell` | `tests/kernel/command-shell.test.ts` | 脱敏、限制结果并关闭上下文 |

## 追加外壳的身份绑定

```mermaid
sequenceDiagram
  accTitle: 追加外壳的身份绑定
  accDescr: 追加外壳的身份绑定；箭头区分当前代码步骤、返回事实与明确的条件。
  participant caller as 调用者
  participant append as AppendCommand
  participant slice as 切片 execute
  participant event as 命令处理器
  caller->>append: E-L1049-01 idempotencyKey 与预期修订
  append->>slice: E-L1049-02 派生 commitId 与 requestDigest
  slice->>event: E-L1049-03 决定和事件提交
  slice-->>caller: E-L1049-04 commit 回执与 next
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| commit | 一次不可变事件提交批；文件槽位以预期修订防止并发覆盖。 |
| CAS | 比较已观察的摘要/修订后提交；来源已改变则拒绝。 |
| next | 根据当前事实派生的下一责任与建议工具。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| caller | Agent / 用户 / 外部效果或条件视图 | 调用者 |
| append | `src/kernel/append-command.ts` | AppendCommand |
| slice | `src/capabilities/tasking/service.ts` | 切片 execute |
| event | `src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.ts` | 命令处理器 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1049-01 | `src/kernel/append-command.ts#runAppendCommand` | `tests/capabilities/tasking/service.test.ts` | idempotencyKey 与预期修订 |
| E-L1049-02 | `src/kernel/append-command.ts#runAppendCommand` | `tests/capabilities/tasking/service.test.ts` | 派生 commitId 与 requestDigest |
| E-L1049-03 | `src/capabilities/tasking/service.ts#execute` | `tests/capabilities/tasking/service.test.ts` | 决定和事件提交 |
| E-L1049-04 | `src/capabilities/tasking/service.ts#assembleResult` | `tests/capabilities/tasking/service.test.ts` | commit 回执与 next |

## 效果外壳的计划重算

```mermaid
sequenceDiagram
  accTitle: 效果外壳的计划重算
  accDescr: 效果外壳的计划重算；箭头区分当前代码步骤、返回事实与明确的条件。
  participant caller as 调用者
  participant effect as PublicationTransaction
  participant plan as 切片 plan
  participant apply as 切片 apply / recover
  caller->>effect: E-L1050-01 preview
  effect->>plan: E-L1050-02 零写推导并返回摘要
  caller->>effect: E-L1050-03 apply 同请求和摘要
  effect->>plan: E-L1050-04 再次推导并拒绝漂移
  effect->>apply: E-L1050-05 交给实际事务 owner
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| CAS | 比较已观察的摘要/修订后提交；来源已改变则拒绝。 |
| next | 根据当前事实派生的下一责任与建议工具。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| caller | Agent / 用户 / 外部效果或条件视图 | 调用者 |
| effect | `src/kernel/publication-transaction.ts` | PublicationTransaction |
| plan | Agent / 用户 / 外部效果或条件视图 | 切片 plan |
| apply | Agent / 用户 / 外部效果或条件视图 | 切片 apply / recover |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1050-01 | `src/kernel/publication-transaction.ts#runPublicationTransaction` | `tests/capabilities/workspace/maintain-workspace.test.ts` | preview |
| E-L1050-02 | `src/kernel/publication-transaction.ts#runPhase` | `tests/capabilities/workspace/maintain-workspace.test.ts` | 零写推导并返回摘要 |
| E-L1050-03 | `src/kernel/publication-transaction.ts#runPublicationTransaction` | `tests/capabilities/workspace/maintain-workspace.test.ts` | apply 同请求和摘要 |
| E-L1050-04 | `src/kernel/publication-transaction.ts#runPhase` | `tests/capabilities/workspace/maintain-workspace.test.ts` | 再次推导并拒绝漂移 |
| E-L1050-05 | `src/kernel/publication-transaction.ts#runPhase` | `tests/capabilities/workspace/maintain-workspace.test.ts` | 交给实际事务 owner |

## 守卫、恢复与验证范围

效果计划摘要不是授权令牌。恢复只能消费原事务标识与其记录，不能在恢复时任意换目标。

涉及的测试与核验入口：

- `tests/capabilities/tasking/service.test.ts`。
- `tests/capabilities/workspace/maintain-workspace.test.ts`。
- `tests/kernel/command-shell.test.ts`。

## 下钻与相关视图

- [本专题总览](./README.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
