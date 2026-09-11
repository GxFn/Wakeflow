---
diagramId: ts-configuration-workspace-file-f3
viewType: file-dependency
truthKind: current-code
reviewDepth: L3
verifiedAt: 2026-09-11
baselineCommit: 7ba1f38938a7387623b0ca588d9cfd54abda5760
sourceFingerprint: sha256:b92b670b6eb19244447c7f4cc68c3bba7b2d53fd9402bd9a1f26a73a6eacfcf7
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: mixed
sourcePaths:
  - src/capabilities/workspace/*.ts
  - src/capabilities/workspace/maintain-workspace.ts
  - src/configuration/*.ts
  - src/configuration/wakeflow-config-authority-snapshot.ts
  - src/configuration/wakeflow-config-v3.ts
  - src/configuration/wakeflow-fresh-config-selection.ts
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
  - src/workspace/maintenance/wakeflow-static-materialization-preview.ts
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

# 配置与维护：文件直接导入

这是当前源码 AST 提取的审阅精选范围，只显示下表文件之间的真实直接导入。完整源码闭包可以继续沿导入下钻；此图不证明调用顺序。

> 核验基线：`7ba1f38`；核验时实现代码均已提交，本轮图谱更新另列。开发阶段为 L1 九片已落地，observation 尚未开始。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 配置与维护的精选直接导入

```mermaid
flowchart TB
  accTitle: 配置与维护的精选直接导入
  accDescr: 配置与维护所列具体文件之间的直接导入，不把静态依赖解释成运行调用。
  f1["源码模块 maintain-workspace.ts"]
  f2["源码模块 publication-transaction.ts"]
  f3["源码模块 wakeflow-static-materialization-preview.ts"]
  f4["源码模块 wakeflow-maintenance-execution-transaction.ts"]
  f5["源码模块 wakeflow-config-authority-snapshot.ts"]
  f6["源码模块 wakeflow-config-v3.ts"]
  f7["源码模块 wakeflow-fresh-config-selection.ts"]
  f1 -->|"E-L1010-01 直接导入"| f2
  f1 -->|"E-L1010-02 直接导入"| f4
  f1 -->|"E-L1010-03 直接导入"| f6
  f1 -->|"E-L1010-04 直接导入"| f7
  f3 -->|"E-L1010-05 直接导入"| f5
  f3 -->|"E-L1010-06 直接导入"| f6
  f4 -->|"E-L1010-07 直接导入"| f5
  f4 -->|"E-L1010-08 直接导入"| f6
  f5 -->|"E-L1010-09 直接导入"| f6
  f7 -->|"E-L1010-10 直接导入"| f6
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| AST | 源码的语法树；直接导入自动提取，运行时调用顺序另行核实。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| f1 | `src/capabilities/workspace/maintain-workspace.ts` | 源码模块 maintain-workspace.ts |
| f2 | `src/kernel/publication-transaction.ts` | 源码模块 publication-transaction.ts |
| f3 | `src/workspace/maintenance/wakeflow-static-materialization-preview.ts` | 源码模块 wakeflow-static-materialization-preview.ts |
| f4 | `src/workspace/maintenance/wakeflow-maintenance-execution-transaction.ts` | 源码模块 wakeflow-maintenance-execution-transaction.ts |
| f5 | `src/configuration/wakeflow-config-authority-snapshot.ts` | 源码模块 wakeflow-config-authority-snapshot.ts |
| f6 | `src/configuration/wakeflow-config-v3.ts` | 源码模块 wakeflow-config-v3.ts |
| f7 | `src/configuration/wakeflow-fresh-config-selection.ts` | 源码模块 wakeflow-fresh-config-selection.ts |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1010-01 | `src/capabilities/workspace/maintain-workspace.ts` | `tests/capabilities/workspace/maintain-workspace.test.ts` | 直接导入 |
| E-L1010-02 | `src/capabilities/workspace/maintain-workspace.ts` | `tests/capabilities/workspace/maintain-workspace.test.ts` | 直接导入 |
| E-L1010-03 | `src/capabilities/workspace/maintain-workspace.ts` | `tests/capabilities/workspace/maintain-workspace.test.ts` | 直接导入 |
| E-L1010-04 | `src/capabilities/workspace/maintain-workspace.ts` | `tests/capabilities/workspace/maintain-workspace.test.ts` | 直接导入 |
| E-L1010-05 | `src/workspace/maintenance/wakeflow-static-materialization-preview.ts` | `tests/capabilities/workspace/maintain-workspace.test.ts` | 直接导入 |
| E-L1010-06 | `src/workspace/maintenance/wakeflow-static-materialization-preview.ts` | `tests/capabilities/workspace/maintain-workspace.test.ts` | 直接导入 |
| E-L1010-07 | `src/workspace/maintenance/wakeflow-maintenance-execution-transaction.ts` | `tests/capabilities/workspace/maintain-workspace.test.ts` | 直接导入 |
| E-L1010-08 | `src/workspace/maintenance/wakeflow-maintenance-execution-transaction.ts` | `tests/capabilities/workspace/maintain-workspace.test.ts` | 直接导入 |
| E-L1010-09 | `src/configuration/wakeflow-config-authority-snapshot.ts` | `tests/capabilities/workspace/maintain-workspace.test.ts` | 直接导入 |
| E-L1010-10 | `src/configuration/wakeflow-fresh-config-selection.ts` | `tests/capabilities/workspace/maintain-workspace.test.ts` | 直接导入 |

## 守卫、恢复与验证范围

文件身份采用完整仓库相对路径；同名 service.ts、decide.ts 不靠文件名猜测。生成合同仍回指 Schema 权威。

涉及的测试与核验入口：

- `tests/capabilities/workspace/maintain-workspace.test.ts`。

## 下钻与相关视图

- [本专题总览](./README.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
