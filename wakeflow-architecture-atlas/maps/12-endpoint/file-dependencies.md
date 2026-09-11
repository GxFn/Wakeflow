---
diagramId: ts-endpoint-file-dependencies
viewType: file-dependency
truthKind: current-code
reviewDepth: L3
verifiedAt: 2026-09-11
baselineCommit: 7ba1f38938a7387623b0ca588d9cfd54abda5760
sourceFingerprint: sha256:3cf11b05220319e87acaa80e4c830364d032d9596bad62c1d53733a0790745e7
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: mixed
sourcePaths:
  - src/capabilities/endpoint/*.ts
  - src/capabilities/endpoint/decide.ts
  - src/capabilities/endpoint/locator-store.ts
  - src/capabilities/endpoint/pane-classification.ts
  - src/capabilities/endpoint/service.ts
  - src/configuration/*.ts
  - src/configuration/wakeflow-config-authority-snapshot.ts
  - src/contracts/generated/configuration/*.ts
  - src/contracts/generated/entrypoints/*.ts
  - src/contracts/generated/foundation/*.ts
  - src/contracts/generated/identity/*.ts
  - src/contracts/generated/workspace/*.ts
  - src/contracts/identity/*.ts
  - src/contracts/vocabulary/*.ts
  - src/foundation/crypto/*.ts
  - src/foundation/data/*.ts
  - src/foundation/filesystem/*.ts
  - src/foundation/identity/*.ts
  - src/foundation/node/*.ts
  - src/foundation/numeric/*.ts
  - src/foundation/schema/*.ts
  - src/foundation/text/*.ts
  - src/foundation/time/*.ts
  - src/kernel/*.ts
  - src/kernel/hook-observations.ts
  - src/kernel/pod-worktree-receipts.ts
  - src/kernel/work-claims.ts
  - src/workspace/*.ts
  - src/workspace/window-runtime/*.ts
schemaPaths:
  - src/contracts/schemas/configuration/wakeflow-config-v3.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-window-host-binding-registration-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-window-host-binding-registration-result.schema.json
  - src/contracts/schemas/foundation/portable-resource-path.schema.json
  - src/contracts/schemas/foundation/sha256-digest.schema.json
  - src/contracts/schemas/foundation/utc-instant.schema.json
  - src/contracts/schemas/identity/wakeflow-durable-id-kind.schema.json
  - src/contracts/schemas/workspace/window-host-binding.schema.json
  - src/contracts/schemas/workspace/window-runtime-registered-projection.schema.json
  - src/contracts/schemas/workspace/window-runtime-unregistered-projection.schema.json
testPaths:
  - tests/capabilities/endpoint/service.test.ts
refreshTriggers:
  - .dependency-cruiser.cjs
  - docs/decisions/0012-flow-convergence-callback-calls-testing-redesign.md
  - docs/decisions/0013-target-architecture-and-slice-plan.md
---

# 执行端点：文件直接导入

这是当前源码 AST 提取的审阅精选范围，只显示下表文件之间的真实直接导入。完整源码闭包可以继续沿导入下钻；此图不证明调用顺序。

> 核验基线：`7ba1f38`；核验时实现代码均已提交，本轮图谱更新另列。开发阶段为 L1 九片已落地，observation 尚未开始。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 执行端点的精选直接导入

```mermaid
flowchart TB
  accTitle: 执行端点的精选直接导入
  accDescr: 执行端点所列具体文件之间的直接导入，不把静态依赖解释成运行调用。
  f1["能力执行 service.ts"]
  f2["纯决定 decide.ts"]
  f3["源码模块 pane-classification.ts"]
  f4["源码模块 locator-store.ts"]
  f5["宿主观察 hook-observations.ts"]
  f6["工作声明 work-claims.ts"]
  f7["源码模块 pod-worktree-receipts.ts"]
  f8["源码模块 wakeflow-config-authority-snapshot.ts"]
  f1 -->|"E-L1052-01 直接导入"| f2
  f1 -->|"E-L1052-02 直接导入"| f3
  f1 -->|"E-L1052-03 直接导入"| f4
  f1 -->|"E-L1052-04 直接导入"| f5
  f1 -->|"E-L1052-05 直接导入"| f6
  f1 -->|"E-L1052-06 直接导入"| f7
  f1 -->|"E-L1052-07 直接导入"| f8
  f2 -->|"E-L1052-08 直接导入"| f3
  f4 -->|"E-L1052-09 直接导入"| f3
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| AST | 源码的语法树；直接导入自动提取，运行时调用顺序另行核实。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| f1 | `src/capabilities/endpoint/service.ts` | 能力执行 service.ts |
| f2 | `src/capabilities/endpoint/decide.ts` | 纯决定 decide.ts |
| f3 | `src/capabilities/endpoint/pane-classification.ts` | 源码模块 pane-classification.ts |
| f4 | `src/capabilities/endpoint/locator-store.ts` | 源码模块 locator-store.ts |
| f5 | `src/kernel/hook-observations.ts` | 宿主观察 hook-observations.ts |
| f6 | `src/kernel/work-claims.ts` | 工作声明 work-claims.ts |
| f7 | `src/kernel/pod-worktree-receipts.ts` | 源码模块 pod-worktree-receipts.ts |
| f8 | `src/configuration/wakeflow-config-authority-snapshot.ts` | 源码模块 wakeflow-config-authority-snapshot.ts |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1052-01 | `src/capabilities/endpoint/service.ts` | `tests/capabilities/endpoint/service.test.ts` | 直接导入 |
| E-L1052-02 | `src/capabilities/endpoint/service.ts` | `tests/capabilities/endpoint/service.test.ts` | 直接导入 |
| E-L1052-03 | `src/capabilities/endpoint/service.ts` | `tests/capabilities/endpoint/service.test.ts` | 直接导入 |
| E-L1052-04 | `src/capabilities/endpoint/service.ts` | `tests/capabilities/endpoint/service.test.ts` | 直接导入 |
| E-L1052-05 | `src/capabilities/endpoint/service.ts` | `tests/capabilities/endpoint/service.test.ts` | 直接导入 |
| E-L1052-06 | `src/capabilities/endpoint/service.ts` | `tests/capabilities/endpoint/service.test.ts` | 直接导入 |
| E-L1052-07 | `src/capabilities/endpoint/service.ts` | `tests/capabilities/endpoint/service.test.ts` | 直接导入 |
| E-L1052-08 | `src/capabilities/endpoint/decide.ts` | `tests/capabilities/endpoint/service.test.ts` | 直接导入 |
| E-L1052-09 | `src/capabilities/endpoint/locator-store.ts` | `tests/capabilities/endpoint/service.test.ts` | 直接导入 |

## 守卫、恢复与验证范围

文件身份采用完整仓库相对路径；同名 service.ts、decide.ts 不靠文件名猜测。生成合同仍回指 Schema 权威。

涉及的测试与核验入口：

- `tests/capabilities/endpoint/service.test.ts`。

## 下钻与相关视图

- [本专题总览](./README.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
