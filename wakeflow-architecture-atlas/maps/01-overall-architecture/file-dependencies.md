---
diagramId: ts-overall-entrypoint-file-dependency-f0
viewType: file-dependency
truthKind: current-code
reviewDepth: L3
verifiedAt: 2026-09-18
baselineCommit: 1480271ecc8a6c17bb9042321644402bd6cbda56
sourceFingerprint: sha256:62e707571237234a6706d2e299c2bf4442d104964d0c481a3f2716d6f787418f
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: mixed
sourcePaths:
  - src/capabilities/delivery/*.ts
  - src/capabilities/delivery/service.ts
  - src/capabilities/demand/*.ts
  - src/capabilities/demand/service.ts
  - src/capabilities/endpoint/*.ts
  - src/capabilities/evidence/*.ts
  - src/capabilities/pod/*.ts
  - src/capabilities/requirement/*.ts
  - src/capabilities/result-review/*.ts
  - src/capabilities/result-review/service.ts
  - src/capabilities/tasking/*.ts
  - src/capabilities/workspace/*.ts
  - src/configuration/*.ts
  - src/contracts/generated/configuration/*.ts
  - src/contracts/generated/entrypoints/*.ts
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
  - src/entrypoints/*.ts
  - src/entrypoints/claude-code-wakeflow-mcp.ts
  - src/entrypoints/codex-wakeflow-mcp.ts
  - src/entrypoints/wakeflow-public-mcp-catalog.ts
  - src/entrypoints/wakeflow-public-mcp-server.ts
  - src/entrypoints/wakeflow-public-mcp-shared-executors.ts
  - src/entrypoints/wakeflow-public-mcp-tool.ts
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
  - src/hosts/claude-code/*.ts
  - src/hosts/codex/*.ts
  - src/kernel/*.ts
  - src/kernel/event-stream/*.ts
  - src/kernel/tool-registry.ts
  - src/workspace/*.ts
  - src/workspace/host-runtime/*.ts
  - src/workspace/maintenance/*.ts
  - src/workspace/managed-integration/*.ts
  - src/workspace/support/*.ts
  - src/workspace/window-runtime/*.ts
schemaPaths:
  - src/contracts/schemas/configuration/wakeflow-config-v3.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-board-inspection-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-board-inspection-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-cancellation-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-cancellation-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-completion-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-completion-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-continuation-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-continuation-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-publication-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-demand-publication-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-implementation-review-decision-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-implementation-review-decision-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-maintenance-public-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-maintenance-public-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-pod-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-pod-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-prepare-delivery-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-prepare-delivery-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-rearm-delivery-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-rearm-delivery-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-record-delivery-outcome-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-record-delivery-outcome-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-record-evidence-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-record-evidence-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-requirement-publication-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-requirement-publication-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-target-result-import-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-target-result-import-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-target-result-review-inspection-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-target-result-review-inspection-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-target-task-planning-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-target-task-planning-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-test-review-decision-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-test-review-decision-result.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-window-host-binding-registration-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-window-host-binding-registration-result.schema.json
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
  - src/contracts/schemas/governance/demand/demand-event-sourcing-publication-transaction.schema.json
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
  - src/contracts/schemas/workspace/maintenance-execution-intent.schema.json
  - src/contracts/schemas/workspace/maintenance-journal.schema.json
  - src/contracts/schemas/workspace/window-host-binding.schema.json
  - src/contracts/schemas/workspace/window-runtime-registered-projection.schema.json
  - src/contracts/schemas/workspace/window-runtime-unregistered-projection.schema.json
testPaths:
  - tests/entrypoints/wakeflow-public-mcp-catalog.test.ts
refreshTriggers:
  - .dependency-cruiser.cjs
  - docs/decisions/0012-flow-convergence-callback-calls-testing-redesign.md
  - docs/decisions/0013-target-architecture-and-slice-plan.md
---

# 公共组合根：文件直接导入

这是当前源码 AST 提取的审阅精选范围，只显示下表文件之间的真实直接导入。完整源码闭包可以继续沿导入下钻；此图不证明调用顺序。

> 核验基线：`1480271`（L1 observation 第十片已落地，20 个公共工具、18 个一次性场景）。工作树另有并行未提交改动（宿主 hook 通道等），本图不描绘；来源指纹按当前工作树计算。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 公共组合根的精选直接导入

```mermaid
flowchart TB
  accTitle: 公共组合根的精选直接导入
  accDescr: 公共组合根所列具体文件之间的直接导入，不把静态依赖解释成运行调用。
  f1["源码模块 codex-wakeflow-mcp.ts"]
  f2["源码模块 claude-code-wakeflow-mcp.ts"]
  f3["共享组合根 wakeflow-public-mcp-server.ts"]
  f4["公共登记表 wakeflow-public-mcp-catalog.ts"]
  f5["源码模块 wakeflow-public-mcp-shared-executors.ts"]
  f6["源码模块 wakeflow-public-mcp-tool.ts"]
  f7["源码模块 tool-registry.ts"]
  f8["能力执行 service.ts"]
  f9["能力执行 service.ts"]
  f10["能力执行 service.ts"]
  f1 -->|"E-L1002-01 直接导入"| f3
  f1 -->|"E-L1002-02 直接导入"| f5
  f1 -->|"E-L1002-03 直接导入"| f9
  f1 -->|"E-L1002-04 直接导入"| f10
  f2 -->|"E-L1002-05 直接导入"| f3
  f2 -->|"E-L1002-06 直接导入"| f5
  f2 -->|"E-L1002-07 直接导入"| f9
  f2 -->|"E-L1002-08 直接导入"| f10
  f3 -->|"E-L1002-09 直接导入"| f4
  f3 -->|"E-L1002-10 直接导入"| f6
  f4 -->|"E-L1002-11 直接导入"| f6
  f4 -->|"E-L1002-12 直接导入"| f7
  f5 -->|"E-L1002-13 直接导入"| f4
  f5 -->|"E-L1002-14 直接导入"| f8
  f6 -->|"E-L1002-15 直接导入"| f7
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| AST | 源码的语法树；直接导入自动提取，运行时调用顺序另行核实。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| f1 | `src/entrypoints/codex-wakeflow-mcp.ts` | 源码模块 codex-wakeflow-mcp.ts |
| f2 | `src/entrypoints/claude-code-wakeflow-mcp.ts` | 源码模块 claude-code-wakeflow-mcp.ts |
| f3 | `src/entrypoints/wakeflow-public-mcp-server.ts` | 共享组合根 wakeflow-public-mcp-server.ts |
| f4 | `src/entrypoints/wakeflow-public-mcp-catalog.ts` | 公共登记表 wakeflow-public-mcp-catalog.ts |
| f5 | `src/entrypoints/wakeflow-public-mcp-shared-executors.ts` | 源码模块 wakeflow-public-mcp-shared-executors.ts |
| f6 | `src/entrypoints/wakeflow-public-mcp-tool.ts` | 源码模块 wakeflow-public-mcp-tool.ts |
| f7 | `src/kernel/tool-registry.ts` | 源码模块 tool-registry.ts |
| f8 | `src/capabilities/demand/service.ts` | 能力执行 service.ts |
| f9 | `src/capabilities/delivery/service.ts` | 能力执行 service.ts |
| f10 | `src/capabilities/result-review/service.ts` | 能力执行 service.ts |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1002-01 | `src/entrypoints/codex-wakeflow-mcp.ts` | `tests/entrypoints/wakeflow-public-mcp-catalog.test.ts` | 直接导入 |
| E-L1002-02 | `src/entrypoints/codex-wakeflow-mcp.ts` | `tests/entrypoints/wakeflow-public-mcp-catalog.test.ts` | 直接导入 |
| E-L1002-03 | `src/entrypoints/codex-wakeflow-mcp.ts` | `tests/entrypoints/wakeflow-public-mcp-catalog.test.ts` | 直接导入 |
| E-L1002-04 | `src/entrypoints/codex-wakeflow-mcp.ts` | `tests/entrypoints/wakeflow-public-mcp-catalog.test.ts` | 直接导入 |
| E-L1002-05 | `src/entrypoints/claude-code-wakeflow-mcp.ts` | `tests/entrypoints/wakeflow-public-mcp-catalog.test.ts` | 直接导入 |
| E-L1002-06 | `src/entrypoints/claude-code-wakeflow-mcp.ts` | `tests/entrypoints/wakeflow-public-mcp-catalog.test.ts` | 直接导入 |
| E-L1002-07 | `src/entrypoints/claude-code-wakeflow-mcp.ts` | `tests/entrypoints/wakeflow-public-mcp-catalog.test.ts` | 直接导入 |
| E-L1002-08 | `src/entrypoints/claude-code-wakeflow-mcp.ts` | `tests/entrypoints/wakeflow-public-mcp-catalog.test.ts` | 直接导入 |
| E-L1002-09 | `src/entrypoints/wakeflow-public-mcp-server.ts` | `tests/entrypoints/wakeflow-public-mcp-catalog.test.ts` | 直接导入 |
| E-L1002-10 | `src/entrypoints/wakeflow-public-mcp-server.ts` | `tests/entrypoints/wakeflow-public-mcp-catalog.test.ts` | 直接导入 |
| E-L1002-11 | `src/entrypoints/wakeflow-public-mcp-catalog.ts` | `tests/entrypoints/wakeflow-public-mcp-catalog.test.ts` | 直接导入 |
| E-L1002-12 | `src/entrypoints/wakeflow-public-mcp-catalog.ts` | `tests/entrypoints/wakeflow-public-mcp-catalog.test.ts` | 直接导入 |
| E-L1002-13 | `src/entrypoints/wakeflow-public-mcp-shared-executors.ts` | `tests/entrypoints/wakeflow-public-mcp-catalog.test.ts` | 直接导入 |
| E-L1002-14 | `src/entrypoints/wakeflow-public-mcp-shared-executors.ts` | `tests/entrypoints/wakeflow-public-mcp-catalog.test.ts` | 直接导入 |
| E-L1002-15 | `src/entrypoints/wakeflow-public-mcp-tool.ts` | `tests/entrypoints/wakeflow-public-mcp-catalog.test.ts` | 直接导入 |

## 守卫、恢复与验证范围

文件身份采用完整仓库相对路径；同名 service.ts、decide.ts 不靠文件名猜测。生成合同仍回指 Schema 权威。

涉及的测试与核验入口：

- `tests/entrypoints/wakeflow-public-mcp-catalog.test.ts`。

## 下钻与相关视图

- [本专题总览](./README.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
