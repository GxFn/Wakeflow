---
diagramId: ts-configuration-workspace-runtime-r0
viewType: call-flow
truthKind: current-code
reviewDepth: L4
verifiedAt: 2026-09-11
baselineCommit: 7ba1f38938a7387623b0ca588d9cfd54abda5760
sourceFingerprint: sha256:b92b670b6eb19244447c7f4cc68c3bba7b2d53fd9402bd9a1f26a73a6eacfcf7
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: manual-review
sourcePaths:
  - src/capabilities/workspace/*.ts
  - src/capabilities/workspace/maintain-workspace.ts
  - src/configuration/*.ts
  - src/configuration/wakeflow-config-authority-replacement.ts
  - src/configuration/wakeflow-config-authority-snapshot.ts
  - src/configuration/wakeflow-config-v3.ts
  - src/contracts/generated/configuration/*.ts
  - src/contracts/generated/entrypoints/*.ts
  - src/contracts/generated/foundation/*.ts
  - src/contracts/generated/governance/board/*.ts
  - src/contracts/generated/governance/ledger/*.ts
  - src/contracts/generated/identity/*.ts
  - src/contracts/generated/workspace/*.ts
  - src/contracts/identity/*.ts
  - src/contracts/vocabulary/*.ts
  - src/foundation/crypto/*.ts
  - src/foundation/data/*.ts
  - src/foundation/filesystem/*.ts
  - src/foundation/filesystem/rooted-exclusive-file-lock.ts
  - src/foundation/git/*.ts
  - src/foundation/identity/*.ts
  - src/foundation/node/*.ts
  - src/foundation/numeric/*.ts
  - src/foundation/resource/*.ts
  - src/foundation/schema/*.ts
  - src/foundation/text/*.ts
  - src/foundation/time/*.ts
  - src/governance/demand/*.ts
  - src/governance/demand/event-sourcing/*.ts
  - src/governance/demand/publication/*.ts
  - src/governance/ledger/*.ts
  - src/governance/tasking/*.ts
  - src/kernel/*.ts
  - src/kernel/event-stream/*.ts
  - src/kernel/publication-transaction.ts
  - src/workspace/*.ts
  - src/workspace/active/*.ts
  - src/workspace/host-runtime/*.ts
  - src/workspace/maintenance/*.ts
  - src/workspace/maintenance/wakeflow-maintenance-execution-transaction.ts
  - src/workspace/managed-integration/*.ts
  - src/workspace/support/*.ts
  - src/workspace/window-runtime/*.ts
schemaPaths:
  - src/contracts/schemas/configuration/wakeflow-config-v3.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-maintenance-public-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-maintenance-public-result.schema.json
  - src/contracts/schemas/foundation/directory-tree-candidate-plan.schema.json
  - src/contracts/schemas/foundation/portable-resource-path.schema.json
  - src/contracts/schemas/foundation/sha256-digest.schema.json
  - src/contracts/schemas/foundation/utc-instant.schema.json
  - src/contracts/schemas/governance/board/requirement-claim-state.schema.json
  - src/contracts/schemas/governance/ledger/ledger-authority-member-reference.schema.json
  - src/contracts/schemas/governance/ledger/ledger-record-publication-intent.schema.json
  - src/contracts/schemas/governance/ledger/requirement-record.schema.json
  - src/contracts/schemas/identity/wakeflow-durable-id-kind.schema.json
  - src/contracts/schemas/workspace/maintenance-execution-intent.schema.json
  - src/contracts/schemas/workspace/maintenance-journal.schema.json
  - src/contracts/schemas/workspace/window-runtime-unregistered-projection.schema.json
testPaths:
  - tests/capabilities/workspace/maintain-workspace.test.ts
refreshTriggers:
  - .dependency-cruiser.cjs
  - docs/decisions/0012-flow-convergence-callback-calls-testing-redesign.md
  - docs/decisions/0013-target-architecture-and-slice-plan.md
---

# 工作区维护：预览、应用与恢复

维护工具采用同一请求加 planDigest，服务端重新推导计划；已经移除公共 confirmation 交换形状。

> 核验基线：`7ba1f38`；核验时实现代码均已提交，本轮图谱更新另列。开发阶段为 L1 九片已落地，observation 尚未开始。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 配置权威读取与 CAS

```mermaid
sequenceDiagram
  accTitle: 配置权威读取与 CAS
  accDescr: 配置权威读取与 CAS；箭头区分当前代码步骤、返回事实与明确的条件。
  participant reader as 配置快照
  participant codec as 严格 v3 codec
  participant replace as 配置替换 owner
  participant lock as 短锁
  reader->>codec: E-L1011-01 解析确定性字节和拓扑关系
  replace->>lock: E-L1011-02 锁内重读原配置
  replace->>codec: E-L1011-03 验证目标模型及不可变约束
  replace->>replace: E-L1011-04 精确 source 替换或幂等返回
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| CAS | 比较已观察的摘要/修订后提交；来源已改变则拒绝。 |
| Pod | 完整窗口组与每仓执行位置；main 是 primary Pod。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| reader | `src/configuration/wakeflow-config-authority-snapshot.ts` | 配置快照 |
| codec | `src/configuration/wakeflow-config-v3.ts` | 严格 v3 codec |
| replace | `src/configuration/wakeflow-config-authority-replacement.ts` | 配置替换 owner |
| lock | `src/foundation/filesystem/rooted-exclusive-file-lock.ts` | 短锁 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1011-01 | `src/configuration/wakeflow-config-authority-snapshot.ts` | `tests/capabilities/workspace/maintain-workspace.test.ts` | 解析确定性字节和拓扑关系 |
| E-L1011-02 | `src/configuration/wakeflow-config-authority-replacement.ts` | `tests/capabilities/workspace/maintain-workspace.test.ts` | 锁内重读原配置 |
| E-L1011-03 | `src/configuration/wakeflow-config-authority-replacement.ts` | `tests/capabilities/workspace/maintain-workspace.test.ts` | 验证目标模型及不可变约束 |
| E-L1011-04 | `src/configuration/wakeflow-config-authority-replacement.ts` | `tests/capabilities/workspace/maintain-workspace.test.ts` | 精确 source 替换或幂等返回 |

## 维护的 preview 和 apply

```mermaid
sequenceDiagram
  accTitle: 维护的 preview 和 apply
  accDescr: 维护的 preview 和 apply；箭头区分当前代码步骤、返回事实与明确的条件。
  participant agent as 操作者
  participant slice as 工作区切片
  participant shell as 效果外壳
  participant txn as 维护事务
  agent->>slice: E-L1012-01 preview 原始选择
  slice-->>agent: E-L1012-02 计划摘要与启动意图，零写
  agent->>slice: E-L1012-03 确认后同请求加 planDigest
  slice->>shell: E-L1012-04 重推导并拒绝 plan drift
  shell->>txn: E-L1012-05 执行已重算计划
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| CAS | 比较已观察的摘要/修订后提交；来源已改变则拒绝。 |
| next | 根据当前事实派生的下一责任与建议工具。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| agent | Agent / 用户 / 外部效果或条件视图 | 操作者 |
| slice | `src/capabilities/workspace/maintain-workspace.ts` | 工作区切片 |
| shell | `src/kernel/publication-transaction.ts#runPublicationTransaction` | 效果外壳 |
| txn | `src/workspace/maintenance/wakeflow-maintenance-execution-transaction.ts` | 维护事务 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1012-01 | `src/capabilities/workspace/maintain-workspace.ts` | `tests/capabilities/workspace/maintain-workspace.test.ts` | preview 原始选择 |
| E-L1012-02 | `src/capabilities/workspace/maintain-workspace.ts` | `tests/capabilities/workspace/maintain-workspace.test.ts` | 计划摘要与启动意图，零写 |
| E-L1012-03 | `src/capabilities/workspace/maintain-workspace.ts` | `tests/capabilities/workspace/maintain-workspace.test.ts` | 确认后同请求加 planDigest |
| E-L1012-04 | `src/kernel/publication-transaction.ts#runPublicationTransaction` | `tests/capabilities/workspace/maintain-workspace.test.ts` | 重推导并拒绝 plan drift |
| E-L1012-05 | `src/workspace/maintenance/wakeflow-maintenance-execution-transaction.ts#executeWakeflowMaintenanceExecutionTransaction` | `tests/capabilities/workspace/maintain-workspace.test.ts` | 执行已重算计划 |

## 维护中断的前向恢复

```mermaid
sequenceDiagram
  accTitle: 维护中断的前向恢复
  accDescr: 维护中断的前向恢复；箭头区分当前代码步骤、返回事实与明确的条件。
  participant agent as 操作者
  participant slice as 工作区切片
  participant recover as 恢复 owner
  participant facts as intent / journal 与物理事实
  agent->>slice: E-L1013-01 recover 指定 operationId
  slice->>recover: E-L1013-02 消费原操作记录
  recover->>facts: E-L1013-03 复验已提交前缀与残留
  recover-->>slice: E-L1013-04 只结算原事务，返回 next
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| CAS | 比较已观察的摘要/修订后提交；来源已改变则拒绝。 |
| next | 根据当前事实派生的下一责任与建议工具。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| agent | Agent / 用户 / 外部效果或条件视图 | 操作者 |
| slice | `src/capabilities/workspace/maintain-workspace.ts` | 工作区切片 |
| recover | `src/workspace/maintenance/wakeflow-maintenance-execution-transaction.ts` | 恢复 owner |
| facts | `src/workspace/maintenance/wakeflow-maintenance-execution-transaction.ts` | intent / journal 与物理事实 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1013-01 | `src/capabilities/workspace/maintain-workspace.ts` | `tests/capabilities/workspace/maintain-workspace.test.ts` | recover 指定 operationId |
| E-L1013-02 | `src/workspace/maintenance/wakeflow-maintenance-execution-transaction.ts#recoverWakeflowMaintenanceExecutionTransaction` | `tests/capabilities/workspace/maintain-workspace.test.ts` | 消费原操作记录 |
| E-L1013-03 | `src/workspace/maintenance/wakeflow-maintenance-execution-transaction.ts` | `tests/capabilities/workspace/maintain-workspace.test.ts` | 复验已提交前缀与残留 |
| E-L1013-04 | `src/workspace/maintenance/wakeflow-maintenance-execution-transaction.ts` | `tests/capabilities/workspace/maintain-workspace.test.ts` | 只结算原事务，返回 next |

## 守卫、恢复与验证范围

preview 不为了保存 planRef 而写文件。托管块含用户改动或源摘要改变时拒绝覆盖。宿主启动、测试与归档不属于初始化的隐含动作。

涉及的测试与核验入口：

- `tests/capabilities/workspace/maintain-workspace.test.ts`。

## 下钻与相关视图

- [本专题总览](./README.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
