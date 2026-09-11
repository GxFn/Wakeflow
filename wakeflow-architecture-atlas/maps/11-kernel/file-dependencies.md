---
diagramId: ts-kernel-file-dependencies
viewType: file-dependency
truthKind: current-code
reviewDepth: L3
verifiedAt: 2026-09-11
baselineCommit: 7ba1f38938a7387623b0ca588d9cfd54abda5760
sourceFingerprint: sha256:c0b6084d9893fc38dce520a6577f57feb5af2e7e7a5e68012af48448b00ce59e
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
  - src/foundation/filesystem/rooted-directory.ts
  - src/foundation/identity/*.ts
  - src/foundation/node/*.ts
  - src/foundation/numeric/*.ts
  - src/foundation/schema/*.ts
  - src/foundation/text/*.ts
  - src/foundation/time/*.ts
  - src/kernel/*.ts
  - src/kernel/append-command.ts
  - src/kernel/command-shell.ts
  - src/kernel/hook-observations.ts
  - src/kernel/next-projection.ts
  - src/kernel/pod-worktree-receipts.ts
  - src/kernel/publication-transaction.ts
  - src/kernel/requirement-board.ts
  - src/kernel/tool-registry.ts
  - src/kernel/work-claims.ts
schemaPaths:
  - src/contracts/schemas/foundation/portable-resource-path.schema.json
  - src/contracts/schemas/foundation/sha256-digest.schema.json
  - src/contracts/schemas/foundation/utc-instant.schema.json
  - src/contracts/schemas/governance/board/requirement-claim-state.schema.json
  - src/contracts/schemas/identity/wakeflow-durable-id-kind.schema.json
testPaths:
  - tests/kernel/command-shell.test.ts
refreshTriggers:
  - .dependency-cruiser.cjs
  - docs/decisions/0013-target-architecture-and-slice-plan.md
---

# 内核：文件直接导入

这是当前源码 AST 提取的审阅精选范围，只显示下表文件之间的真实直接导入。完整源码闭包可以继续沿导入下钻；此图不证明调用顺序。

> 核验基线：`7ba1f38`；核验时实现代码均已提交，本轮图谱更新另列。开发阶段为 L1 九片已落地，observation 尚未开始。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 内核的精选直接导入

```mermaid
flowchart TB
  accTitle: 内核的精选直接导入
  accDescr: 内核所列具体文件之间的直接导入，不把静态依赖解释成运行调用。
  f1["命令外壳 command-shell.ts"]
  f2["源码模块 append-command.ts"]
  f3["源码模块 publication-transaction.ts"]
  f4["源码模块 next-projection.ts"]
  f5["源码模块 tool-registry.ts"]
  f6["工作声明 work-claims.ts"]
  f7["宿主观察 hook-observations.ts"]
  f8["需求看板 requirement-board.ts"]
  f9["源码模块 pod-worktree-receipts.ts"]
  f10["源码模块 rooted-directory.ts"]
  f1 -->|"E-L1047-01 直接导入"| f10
  f2 -->|"E-L1047-02 直接导入"| f1
  f2 -->|"E-L1047-03 直接导入"| f4
  f2 -->|"E-L1047-04 直接导入"| f10
  f3 -->|"E-L1047-05 直接导入"| f1
  f3 -->|"E-L1047-06 直接导入"| f4
  f3 -->|"E-L1047-07 直接导入"| f10
  f6 -->|"E-L1047-08 直接导入"| f10
  f7 -->|"E-L1047-09 直接导入"| f10
  f8 -->|"E-L1047-10 直接导入"| f10
  f9 -->|"E-L1047-11 直接导入"| f10
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| AST | 源码的语法树；直接导入自动提取，运行时调用顺序另行核实。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| f1 | `src/kernel/command-shell.ts` | 命令外壳 command-shell.ts |
| f2 | `src/kernel/append-command.ts` | 源码模块 append-command.ts |
| f3 | `src/kernel/publication-transaction.ts` | 源码模块 publication-transaction.ts |
| f4 | `src/kernel/next-projection.ts` | 源码模块 next-projection.ts |
| f5 | `src/kernel/tool-registry.ts` | 源码模块 tool-registry.ts |
| f6 | `src/kernel/work-claims.ts` | 工作声明 work-claims.ts |
| f7 | `src/kernel/hook-observations.ts` | 宿主观察 hook-observations.ts |
| f8 | `src/kernel/requirement-board.ts` | 需求看板 requirement-board.ts |
| f9 | `src/kernel/pod-worktree-receipts.ts` | 源码模块 pod-worktree-receipts.ts |
| f10 | `src/foundation/filesystem/rooted-directory.ts` | 源码模块 rooted-directory.ts |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1047-01 | `src/kernel/command-shell.ts` | `tests/kernel/command-shell.test.ts` | 直接导入 |
| E-L1047-02 | `src/kernel/append-command.ts` | `tests/kernel/command-shell.test.ts` | 直接导入 |
| E-L1047-03 | `src/kernel/append-command.ts` | `tests/kernel/command-shell.test.ts` | 直接导入 |
| E-L1047-04 | `src/kernel/append-command.ts` | `tests/kernel/command-shell.test.ts` | 直接导入 |
| E-L1047-05 | `src/kernel/publication-transaction.ts` | `tests/kernel/command-shell.test.ts` | 直接导入 |
| E-L1047-06 | `src/kernel/publication-transaction.ts` | `tests/kernel/command-shell.test.ts` | 直接导入 |
| E-L1047-07 | `src/kernel/publication-transaction.ts` | `tests/kernel/command-shell.test.ts` | 直接导入 |
| E-L1047-08 | `src/kernel/work-claims.ts` | `tests/kernel/command-shell.test.ts` | 直接导入 |
| E-L1047-09 | `src/kernel/hook-observations.ts` | `tests/kernel/command-shell.test.ts` | 直接导入 |
| E-L1047-10 | `src/kernel/requirement-board.ts` | `tests/kernel/command-shell.test.ts` | 直接导入 |
| E-L1047-11 | `src/kernel/pod-worktree-receipts.ts` | `tests/kernel/command-shell.test.ts` | 直接导入 |

## 守卫、恢复与验证范围

文件身份采用完整仓库相对路径；同名 service.ts、decide.ts 不靠文件名猜测。生成合同仍回指 Schema 权威。

涉及的测试与核验入口：

- `tests/kernel/command-shell.test.ts`。

## 下钻与相关视图

- [本专题总览](./README.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
