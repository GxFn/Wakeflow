---
diagramId: ts-requirement-runtime-call-flow
viewType: call-flow
truthKind: current-code
reviewDepth: L4
verifiedAt: 2026-09-18
baselineCommit: 1480271ecc8a6c17bb9042321644402bd6cbda56
sourceFingerprint: sha256:e2ff70e8e69bab3f8454763812c1031ec82fc482f6990a8a968a5293f13cf5d9
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: manual-review
sourcePaths:
  - src/capabilities/requirement/*.ts
  - src/capabilities/requirement/decide.ts
  - src/capabilities/requirement/service.ts
  - src/configuration/*.ts
  - src/contracts/generated/configuration/*.ts
  - src/contracts/generated/entrypoints/*.ts
  - src/contracts/generated/foundation/*.ts
  - src/contracts/generated/governance/board/*.ts
  - src/contracts/generated/governance/ledger/*.ts
  - src/contracts/generated/identity/*.ts
  - src/contracts/identity/*.ts
  - src/contracts/vocabulary/*.ts
  - src/foundation/crypto/*.ts
  - src/foundation/data/*.ts
  - src/foundation/filesystem/*.ts
  - src/foundation/identity/*.ts
  - src/foundation/node/*.ts
  - src/foundation/numeric/*.ts
  - src/foundation/resource/*.ts
  - src/foundation/schema/*.ts
  - src/foundation/text/*.ts
  - src/foundation/time/*.ts
  - src/governance/ledger/*.ts
  - src/governance/ledger/ledger-authority-store.ts
  - src/kernel/*.ts
  - src/kernel/requirement-board.ts
  - src/workspace/*.ts
schemaPaths:
  - src/contracts/schemas/configuration/wakeflow-config-v3.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-board-inspection-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-board-inspection-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-requirement-publication-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-requirement-publication-result.schema.json
  - src/contracts/schemas/foundation/directory-tree-candidate-plan.schema.json
  - src/contracts/schemas/foundation/portable-resource-path.schema.json
  - src/contracts/schemas/foundation/sha256-digest.schema.json
  - src/contracts/schemas/foundation/utc-instant.schema.json
  - src/contracts/schemas/governance/board/requirement-claim-state.schema.json
  - src/contracts/schemas/governance/ledger/ledger-authority-member-reference.schema.json
  - src/contracts/schemas/governance/ledger/ledger-record-publication-intent.schema.json
  - src/contracts/schemas/governance/ledger/requirement-record.schema.json
  - src/contracts/schemas/identity/wakeflow-durable-id-kind.schema.json
testPaths:
  - tests/capabilities/requirement/service.test.ts
refreshTriggers:
  - .dependency-cruiser.cjs
  - docs/decisions/0012-flow-convergence-callback-calls-testing-redesign.md
  - docs/decisions/0013-target-architecture-and-slice-plan.md
---

# 需求包：发布与看板恢复

发布、激活、撤回同属需求包入口；认领属于 Demand 创建。

> 核验基线：`1480271`（L1 observation 第十片已落地，20 个公共工具、18 个一次性场景）。工作树另有并行未提交改动（宿主 hook 通道等），本图不描绘；来源指纹按当前工作树计算。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 发布前确认和发布后上板

```mermaid
sequenceDiagram
  accTitle: 发布前确认和发布后上板
  accDescr: 发布前确认和发布后上板；箭头区分当前代码步骤、返回事实与明确的条件。
  participant design as Design
  participant slice as 需求包切片
  participant user as 用户
  participant ledger as 不可变 ledger
  participant board as 认领状态
  design->>slice: E-L1057-01 第一次 preview 读取草稿
  slice->>user: E-L1057-02 摘要和确认缺项；零写
  design->>slice: E-L1057-03 确认节和时间齐全后再 preview/apply
  slice->>ledger: E-L1057-04 固定成员摘要并发布记录
  slice->>board: E-L1057-05 建立 pending 或 parked
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| ledger | 长期不可变需求包与归档的存储根。 |
| CAS | 比较已观察的摘要/修订后提交；来源已改变则拒绝。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| design | Agent / 用户 / 外部效果或条件视图 | Design |
| slice | `src/capabilities/requirement/service.ts` | 需求包切片 |
| user | Agent / 用户 / 外部效果或条件视图 | 用户 |
| ledger | `src/governance/ledger/ledger-authority-store.ts` | 不可变 ledger |
| board | `src/kernel/requirement-board.ts` | 认领状态 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1057-01 | `src/capabilities/requirement/service.ts#planPublish` | `tests/capabilities/requirement/service.test.ts` | 第一次 preview 读取草稿 |
| E-L1057-02 | `src/capabilities/requirement/decide.ts#derivePublishBlockers` | `tests/capabilities/requirement/service.test.ts` | 摘要和确认缺项；零写 |
| E-L1057-03 | `src/capabilities/requirement/service.ts#executeRequirementPublicationRequest` | `tests/capabilities/requirement/service.test.ts` | 确认节和时间齐全后再 preview/apply |
| E-L1057-04 | `src/capabilities/requirement/service.ts#ensureRecord` | `tests/capabilities/requirement/service.test.ts` | 固定成员摘要并发布记录 |
| E-L1057-05 | `src/capabilities/requirement/service.ts#ensureClaimState` | `tests/capabilities/requirement/service.test.ts` | 建立 pending 或 parked |

## 重放、恢复与撤回

```mermaid
sequenceDiagram
  accTitle: 重放、恢复与撤回
  accDescr: 重放、恢复与撤回；箭头区分当前代码步骤、返回事实与明确的条件。
  participant agent as Agent
  participant slice as 需求包切片
  participant record as 已发布记录
  participant board as 看板
  agent->>slice: E-L1058-01 同内容 apply 或 recover requirementId
  slice->>record: E-L1058-02 用不可变记录复原发布事实
  slice->>board: E-L1058-03 补缺失认领行和索引
  opt activate / withdraw / supersedes
  slice->>board: E-L1058-04 带预期状态摘要的精确转移
  end
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| CAS | 比较已观察的摘要/修订后提交；来源已改变则拒绝。 |
| projection | 根据权威重建的视图，不反向决定事实。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| agent | Agent / 用户 / 外部效果或条件视图 | Agent |
| slice | `src/capabilities/requirement/service.ts` | 需求包切片 |
| record | `src/governance/ledger/ledger-authority-store.ts` | 已发布记录 |
| board | `src/kernel/requirement-board.ts` | 看板 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1058-01 | `src/capabilities/requirement/service.ts#recoverPublish` | `tests/capabilities/requirement/service.test.ts` | 同内容 apply 或 recover requirementId |
| E-L1058-02 | `src/capabilities/requirement/service.ts#recoverPublish` | `tests/capabilities/requirement/service.test.ts` | 用不可变记录复原发布事实 |
| E-L1058-03 | `src/capabilities/requirement/service.ts#ensureClaimState` | `tests/capabilities/requirement/service.test.ts` | 补缺失认领行和索引 |
| E-L1058-04 | `src/kernel/requirement-board.ts#replaceRequirementClaimStateFile` | `tests/capabilities/requirement/service.test.ts` | 带预期状态摘要的精确转移 |

## 守卫、恢复与验证范围

supersedes 的旧包若已被认领，不假定它已被撤回。凭证命中永远阻塞；隐私失败不回显命中的文档正文。

涉及的测试与核验入口：

- `tests/capabilities/requirement/service.test.ts`。

## 下钻与相关视图

- [本专题总览](./README.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
