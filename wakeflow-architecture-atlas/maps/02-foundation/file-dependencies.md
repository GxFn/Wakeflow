---
diagramId: ts-foundation-file-dependency-f2
viewType: file-dependency
truthKind: current-code
reviewDepth: L3
verifiedAt: 2026-09-11
baselineCommit: 7ba1f38938a7387623b0ca588d9cfd54abda5760
sourceFingerprint: sha256:2cebacc585ce9dceffe791b1c4b443857746790825ce9952ca6813d710b4e5ac
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: mixed
sourcePaths:
  - src/contracts/generated/foundation/*.ts
  - src/contracts/generated/governance/board/*.ts
  - src/contracts/generated/identity/*.ts
  - src/contracts/identity/*.ts
  - src/contracts/vocabulary/*.ts
  - src/foundation/crypto/*.ts
  - src/foundation/data/*.ts
  - src/foundation/filesystem/*.ts
  - src/foundation/filesystem/deterministic-json-file.ts
  - src/foundation/filesystem/durable-atomic-file-write.ts
  - src/foundation/filesystem/durable-directory-tree-publication.ts
  - src/foundation/filesystem/rooted-directory.ts
  - src/foundation/filesystem/rooted-exclusive-file-lock.ts
  - src/foundation/filesystem/stable-file-read.ts
  - src/foundation/identity/*.ts
  - src/foundation/node/*.ts
  - src/foundation/numeric/*.ts
  - src/foundation/schema/*.ts
  - src/foundation/text/*.ts
  - src/foundation/time/*.ts
  - src/kernel/*.ts
  - src/kernel/requirement-board.ts
schemaPaths:
  - src/contracts/schemas/foundation/portable-resource-path.schema.json
  - src/contracts/schemas/foundation/sha256-digest.schema.json
  - src/contracts/schemas/foundation/utc-instant.schema.json
  - src/contracts/schemas/governance/board/requirement-claim-state.schema.json
  - src/contracts/schemas/identity/wakeflow-durable-id-kind.schema.json
testPaths:
  - tests/foundation/filesystem/durable-atomic-file-write.test.ts
refreshTriggers:
  - .dependency-cruiser.cjs
  - docs/decisions/0013-target-architecture-and-slice-plan.md
---

# Foundation：文件直接导入

这是当前源码 AST 提取的审阅精选范围，只显示下表文件之间的真实直接导入。完整源码闭包可以继续沿导入下钻；此图不证明调用顺序。

> 核验基线：`7ba1f38`；核验时实现代码均已提交，本轮图谱更新另列。开发阶段为 L1 九片已落地，observation 尚未开始。本文说明实现事实，未宣称双宿主真实会话已经验证。

## Foundation的精选直接导入

```mermaid
flowchart TB
  accTitle: Foundation的精选直接导入
  accDescr: Foundation所列具体文件之间的直接导入，不把静态依赖解释成运行调用。
  f1["源码模块 rooted-directory.ts"]
  f2["源码模块 stable-file-read.ts"]
  f3["源码模块 durable-atomic-file-write.ts"]
  f4["源码模块 rooted-exclusive-file-lock.ts"]
  f5["源码模块 deterministic-json-file.ts"]
  f6["需求看板 requirement-board.ts"]
  f7["源码模块 durable-directory-tree-publication.ts"]
  f2 -->|"E-L1005-01 直接导入"| f1
  f3 -->|"E-L1005-02 直接导入"| f1
  f4 -->|"E-L1005-03 直接导入"| f1
  f4 -->|"E-L1005-04 直接导入"| f2
  f4 -->|"E-L1005-05 直接导入"| f3
  f4 -->|"E-L1005-06 直接导入"| f5
  f5 -->|"E-L1005-07 直接导入"| f1
  f5 -->|"E-L1005-08 直接导入"| f2
  f6 -->|"E-L1005-09 直接导入"| f1
  f6 -->|"E-L1005-10 直接导入"| f2
  f6 -->|"E-L1005-11 直接导入"| f3
  f6 -->|"E-L1005-12 直接导入"| f4
  f6 -->|"E-L1005-13 直接导入"| f5
  f7 -->|"E-L1005-14 直接导入"| f1
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| AST | 源码的语法树；直接导入自动提取，运行时调用顺序另行核实。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| f1 | `src/foundation/filesystem/rooted-directory.ts` | 源码模块 rooted-directory.ts |
| f2 | `src/foundation/filesystem/stable-file-read.ts` | 源码模块 stable-file-read.ts |
| f3 | `src/foundation/filesystem/durable-atomic-file-write.ts` | 源码模块 durable-atomic-file-write.ts |
| f4 | `src/foundation/filesystem/rooted-exclusive-file-lock.ts` | 源码模块 rooted-exclusive-file-lock.ts |
| f5 | `src/foundation/filesystem/deterministic-json-file.ts` | 源码模块 deterministic-json-file.ts |
| f6 | `src/kernel/requirement-board.ts` | 需求看板 requirement-board.ts |
| f7 | `src/foundation/filesystem/durable-directory-tree-publication.ts` | 源码模块 durable-directory-tree-publication.ts |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1005-01 | `src/foundation/filesystem/stable-file-read.ts` | `tests/foundation/filesystem/durable-atomic-file-write.test.ts` | 直接导入 |
| E-L1005-02 | `src/foundation/filesystem/durable-atomic-file-write.ts` | `tests/foundation/filesystem/durable-atomic-file-write.test.ts` | 直接导入 |
| E-L1005-03 | `src/foundation/filesystem/rooted-exclusive-file-lock.ts` | `tests/foundation/filesystem/durable-atomic-file-write.test.ts` | 直接导入 |
| E-L1005-04 | `src/foundation/filesystem/rooted-exclusive-file-lock.ts` | `tests/foundation/filesystem/durable-atomic-file-write.test.ts` | 直接导入 |
| E-L1005-05 | `src/foundation/filesystem/rooted-exclusive-file-lock.ts` | `tests/foundation/filesystem/durable-atomic-file-write.test.ts` | 直接导入 |
| E-L1005-06 | `src/foundation/filesystem/rooted-exclusive-file-lock.ts` | `tests/foundation/filesystem/durable-atomic-file-write.test.ts` | 直接导入 |
| E-L1005-07 | `src/foundation/filesystem/deterministic-json-file.ts` | `tests/foundation/filesystem/durable-atomic-file-write.test.ts` | 直接导入 |
| E-L1005-08 | `src/foundation/filesystem/deterministic-json-file.ts` | `tests/foundation/filesystem/durable-atomic-file-write.test.ts` | 直接导入 |
| E-L1005-09 | `src/kernel/requirement-board.ts` | `tests/foundation/filesystem/durable-atomic-file-write.test.ts` | 直接导入 |
| E-L1005-10 | `src/kernel/requirement-board.ts` | `tests/foundation/filesystem/durable-atomic-file-write.test.ts` | 直接导入 |
| E-L1005-11 | `src/kernel/requirement-board.ts` | `tests/foundation/filesystem/durable-atomic-file-write.test.ts` | 直接导入 |
| E-L1005-12 | `src/kernel/requirement-board.ts` | `tests/foundation/filesystem/durable-atomic-file-write.test.ts` | 直接导入 |
| E-L1005-13 | `src/kernel/requirement-board.ts` | `tests/foundation/filesystem/durable-atomic-file-write.test.ts` | 直接导入 |
| E-L1005-14 | `src/foundation/filesystem/durable-directory-tree-publication.ts` | `tests/foundation/filesystem/durable-atomic-file-write.test.ts` | 直接导入 |

## 守卫、恢复与验证范围

文件身份采用完整仓库相对路径；同名 service.ts、decide.ts 不靠文件名猜测。生成合同仍回指 Schema 权威。

涉及的测试与核验入口：

- `tests/foundation/filesystem/durable-atomic-file-write.test.ts`。

## 下钻与相关视图

- [本专题总览](./README.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
