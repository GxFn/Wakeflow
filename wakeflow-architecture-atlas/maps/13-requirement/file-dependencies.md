---
diagramId: ts-requirement-file-dependencies
viewType: file-dependency
truthKind: current-code
reviewDepth: L3
verifiedAt: 2026-09-18
baselineCommit: 1480271ecc8a6c17bb9042321644402bd6cbda56
sourceFingerprint: sha256:e2ff70e8e69bab3f8454763812c1031ec82fc482f6990a8a968a5293f13cf5d9
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: mixed
sourcePaths:
  - src/capabilities/requirement/*.ts
  - src/capabilities/requirement/decide.ts
  - src/capabilities/requirement/projection.ts
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
  - src/kernel/markdown-sections.ts
  - src/kernel/privacy-scan.ts
  - src/kernel/publication-transaction.ts
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

# 需求包：文件直接导入

这是当前源码 AST 提取的审阅精选范围，只显示下表文件之间的真实直接导入。完整源码闭包可以继续沿导入下钻；此图不证明调用顺序。

> 核验基线：`1480271`（L1 observation 第十片已落地，20 个公共工具、18 个一次性场景）。工作树另有并行未提交改动（宿主 hook 通道等），本图不描绘；来源指纹按当前工作树计算。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 需求包的精选直接导入

```mermaid
flowchart TB
  accTitle: 需求包的精选直接导入
  accDescr: 需求包所列具体文件之间的直接导入，不把静态依赖解释成运行调用。
  f1["能力执行 service.ts"]
  f2["纯决定 decide.ts"]
  f3["源码模块 projection.ts"]
  f4["需求看板 requirement-board.ts"]
  f5["源码模块 ledger-authority-store.ts"]
  f6["源码模块 markdown-sections.ts"]
  f7["源码模块 publication-transaction.ts"]
  f8["源码模块 privacy-scan.ts"]
  f1 -->|"E-L1056-01 直接导入"| f2
  f1 -->|"E-L1056-02 直接导入"| f3
  f1 -->|"E-L1056-03 直接导入"| f4
  f1 -->|"E-L1056-04 直接导入"| f5
  f1 -->|"E-L1056-05 直接导入"| f7
  f2 -->|"E-L1056-06 直接导入"| f4
  f2 -->|"E-L1056-07 直接导入"| f6
  f2 -->|"E-L1056-08 直接导入"| f8
  f3 -->|"E-L1056-09 直接导入"| f4
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| AST | 源码的语法树；直接导入自动提取，运行时调用顺序另行核实。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| f1 | `src/capabilities/requirement/service.ts` | 能力执行 service.ts |
| f2 | `src/capabilities/requirement/decide.ts` | 纯决定 decide.ts |
| f3 | `src/capabilities/requirement/projection.ts` | 源码模块 projection.ts |
| f4 | `src/kernel/requirement-board.ts` | 需求看板 requirement-board.ts |
| f5 | `src/governance/ledger/ledger-authority-store.ts` | 源码模块 ledger-authority-store.ts |
| f6 | `src/kernel/markdown-sections.ts` | 源码模块 markdown-sections.ts |
| f7 | `src/kernel/publication-transaction.ts` | 源码模块 publication-transaction.ts |
| f8 | `src/kernel/privacy-scan.ts` | 源码模块 privacy-scan.ts |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1056-01 | `src/capabilities/requirement/service.ts` | `tests/capabilities/requirement/service.test.ts` | 直接导入 |
| E-L1056-02 | `src/capabilities/requirement/service.ts` | `tests/capabilities/requirement/service.test.ts` | 直接导入 |
| E-L1056-03 | `src/capabilities/requirement/service.ts` | `tests/capabilities/requirement/service.test.ts` | 直接导入 |
| E-L1056-04 | `src/capabilities/requirement/service.ts` | `tests/capabilities/requirement/service.test.ts` | 直接导入 |
| E-L1056-05 | `src/capabilities/requirement/service.ts` | `tests/capabilities/requirement/service.test.ts` | 直接导入 |
| E-L1056-06 | `src/capabilities/requirement/decide.ts` | `tests/capabilities/requirement/service.test.ts` | 直接导入 |
| E-L1056-07 | `src/capabilities/requirement/decide.ts` | `tests/capabilities/requirement/service.test.ts` | 直接导入 |
| E-L1056-08 | `src/capabilities/requirement/decide.ts` | `tests/capabilities/requirement/service.test.ts` | 直接导入 |
| E-L1056-09 | `src/capabilities/requirement/projection.ts` | `tests/capabilities/requirement/service.test.ts` | 直接导入 |

## 守卫、恢复与验证范围

文件身份采用完整仓库相对路径；同名 service.ts、decide.ts 不靠文件名猜测。生成合同仍回指 Schema 权威。

涉及的测试与核验入口：

- `tests/capabilities/requirement/service.test.ts`。

## 下钻与相关视图

- [本专题总览](./README.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
