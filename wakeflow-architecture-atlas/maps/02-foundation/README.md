---
diagramId: ts-foundation-capability-b0
viewType: architecture
truthKind: current-code
reviewDepth: L0
verifiedAt: 2026-09-11
baselineCommit: 7ba1f38938a7387623b0ca588d9cfd54abda5760
sourceFingerprint: sha256:fdc551b4c447ccad6291e9b9ff7bb638f7c47c39969c632718f9f8fa3883225d
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: manual-review
sourcePaths:
  - src/capabilities/demand/*.ts
  - src/capabilities/demand/archive.ts
  - src/configuration/*.ts
  - src/contracts/generated/configuration/*.ts
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
  - src/foundation/filesystem/*.ts
  - src/foundation/filesystem/durable-atomic-file-write.ts
  - src/foundation/filesystem/rooted-directory.ts
  - src/foundation/filesystem/rooted-exclusive-file-lock.ts
  - src/foundation/filesystem/stable-file-read.ts
  - src/foundation/git/*.ts
  - src/foundation/identity/*.ts
  - src/foundation/node/*.ts
  - src/foundation/numeric/*.ts
  - src/foundation/resource/*.ts
  - src/foundation/schema/*.ts
  - src/foundation/text/*.ts
  - src/foundation/time/*.ts
  - src/governance/delivery/*.ts
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
  - src/kernel/requirement-board.ts
  - src/workspace/*.ts
  - src/workspace/active/*.ts
  - src/workspace/window-runtime/*.ts
schemaPaths:
  - src/contracts/schemas/configuration/wakeflow-config-v3.schema.json
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
  - src/contracts/schemas/governance/demand/demand-aggregate-state.schema.json
  - src/contracts/schemas/governance/evidence/managed-evidence-manifest.schema.json
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
  - tests/capabilities/requirement/service.test.ts
  - tests/foundation/filesystem/durable-atomic-file-write.test.ts
refreshTriggers:
  - .dependency-cruiser.cjs
  - docs/decisions/0013-target-architecture-and-slice-plan.md
---

# Foundation：持久性与根约束

基础层只解释字节、路径、节点和持久提交，不决定需求、验收或恢复授权。

> 核验基线：`7ba1f38`；核验时实现代码均已提交，本轮图谱更新另列。开发阶段为 L1 九片已落地，observation 尚未开始。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 基础原语与业务 owner 的边界

```mermaid
flowchart TB
  accTitle: 基础原语与业务 owner 的边界
  accDescr: 基础原语与业务 owner 的边界；箭头区分当前代码步骤、返回事实与明确的条件。
  owner["业务 owner 的明确操作"]
  root["固定根与节点身份"]
  read["有界稳定读取"]
  write["创建 / 精确替换"]
  lock["独占短锁"]
  receipt["持久提交回执"]
  owner -->|"E-L1004-01 打开受约束目录"| root
  root -->|"E-L1004-02 读回节点与完整字节"| read
  owner -->|"E-L1004-03 按 owner 协调临界区"| lock
  lock -->|"E-L1004-04 创建或比较来源后替换"| write
  write -->|"E-L1004-05 同步与复验提交结果"| receipt
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| CAS | 比较已观察的摘要/修订后提交；来源已改变则拒绝。 |
| commit | 一次不可变事件提交批；文件槽位以预期修订防止并发覆盖。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| owner | `src/capabilities/demand/archive.ts#sealDemandArchive` | 业务 owner 的明确操作 |
| root | `src/foundation/filesystem/rooted-directory.ts#RootedDirectory` | 固定根与节点身份 |
| read | `src/foundation/filesystem/stable-file-read.ts` | 有界稳定读取 |
| write | `src/foundation/filesystem/durable-atomic-file-write.ts` | 创建 / 精确替换 |
| lock | `src/foundation/filesystem/rooted-exclusive-file-lock.ts` | 独占短锁 |
| receipt | `src/foundation/filesystem/durable-atomic-file-write.ts` | 持久提交回执 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1004-01 | `src/capabilities/demand/archive.ts#readDemandRootSnapshot` | `tests/capabilities/demand/service.test.ts` | 打开受约束目录 |
| E-L1004-02 | `src/foundation/filesystem/stable-file-read.ts` | `tests/foundation/filesystem/durable-atomic-file-write.test.ts` | 读回节点与完整字节 |
| E-L1004-03 | `src/kernel/requirement-board.ts` | `tests/capabilities/requirement/service.test.ts` | 按 owner 协调临界区 |
| E-L1004-04 | `src/kernel/requirement-board.ts#replaceRequirementClaimStateFile` | `tests/capabilities/requirement/service.test.ts` | 创建或比较来源后替换 |
| E-L1004-05 | `src/foundation/filesystem/durable-atomic-file-write.ts` | `tests/foundation/filesystem/durable-atomic-file-write.test.ts` | 同步与复验提交结果 |

## 守卫、恢复与验证范围

当前源码仍保留细分原语文件。创建提交用 no-replace link，替换用 rename；显式 durability 选项服务于缓存等调用方，不能据此宣称权威写入无需持久化。

涉及的测试与核验入口：

- `tests/capabilities/demand/service.test.ts`。
- `tests/capabilities/requirement/service.test.ts`。
- `tests/foundation/filesystem/durable-atomic-file-write.test.ts`。

## 下钻与相关视图

- [文件直接导入](./file-dependencies.md)
- [运行调用与恢复](./runtime-call-flow.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
