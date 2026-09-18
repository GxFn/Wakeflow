---
diagramId: ts-overall-architecture-a0
viewType: architecture
truthKind: current-code
reviewDepth: L0
verifiedAt: 2026-09-18
baselineCommit: 1480271ecc8a6c17bb9042321644402bd6cbda56
sourceFingerprint: sha256:ca09c7462c870390f5522ef8a7b16c4936a5f85edc5490a98955b69dd3fc4caf
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: manual-review
sourcePaths:
  - src/capabilities/delivery/*.ts
  - src/capabilities/demand/*.ts
  - src/capabilities/demand/service.ts
  - src/capabilities/endpoint/*.ts
  - src/capabilities/evidence/*.ts
  - src/capabilities/observation/*.ts
  - src/capabilities/pod/*.ts
  - src/capabilities/requirement/*.ts
  - src/capabilities/result-review/*.ts
  - src/capabilities/tasking/*.ts
  - src/capabilities/tasking/service.ts
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
  - src/entrypoints/codex-wakeflow-mcp.ts
  - src/entrypoints/wakeflow-public-mcp-catalog.ts
  - src/entrypoints/wakeflow-public-mcp-server.ts
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
  - src/governance/demand/event-sourcing/demand-event-sourcing-repository.ts
  - src/governance/demand/model/*.ts
  - src/governance/demand/publication/*.ts
  - src/governance/evidence/*.ts
  - src/governance/ledger/*.ts
  - src/governance/lifecycle/*.ts
  - src/governance/observation/*.ts
  - src/governance/pod/*.ts
  - src/governance/result/*.ts
  - src/governance/review/*.ts
  - src/governance/tasking/*.ts
  - src/governance/tasking/task-package.ts
  - src/governance/testing/*.ts
  - src/hosts/claude-code/*.ts
  - src/hosts/codex/*.ts
  - src/kernel/*.ts
  - src/kernel/command-shell.ts
  - src/kernel/event-stream/*.ts
  - src/kernel/requirement-board.ts
  - src/kernel/work-claims.ts
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
  - tests/capabilities/demand/service.test.ts
  - tests/capabilities/observation/service.test.ts
  - tests/capabilities/tasking/service.test.ts
  - tests/entrypoints/wakeflow-public-mcp-catalog.test.ts
  - tests/kernel/command-shell.test.ts
  - tooling/architecture/check-dependencies.ts
refreshTriggers:
  - .dependency-cruiser.cjs
  - docs/decisions/0012-flow-convergence-callback-calls-testing-redesign.md
  - docs/decisions/0013-target-architecture-and-slice-plan.md
---

# Wakeflow：十个切片的当前架构

Wakeflow 提供权威账本、精确内容和证据准入。observation 是第十片，只读派生视图。用户与 Agent 拥有需求与执行判断，宿主拥有会话动作。六层依赖约束已经生效；configuration、workspace、governance 中仍存在被新切片消费的实现，不能把目录尚未收敛解释为另一个控制器。

> 核验基线：`1480271`（L1 observation 第十片已落地，20 个公共工具、18 个一次性场景）。工作树另有并行未提交改动（宿主 hook 通道等），本图不描绘；来源指纹按当前工作树计算。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 六层职责与当前过渡实现

```mermaid
flowchart TB
  accTitle: 六层职责与当前过渡实现
  accDescr: 六层职责与当前过渡实现；箭头区分当前代码步骤、返回事实与明确的条件。
  entry["公共 MCP 组合根"]
  hosts["固定宿主数据与装配"]
  caps["十个能力切片"]
  kernel["内核：调用、声明、观察与投影"]
  contracts["Schema 与词汇"]
  foundation["确定性数据与持久 I/O"]
  legacy["过渡领域实现"]
  observation["只读观察与核验"]
  entry -->|"E-L1001-01 注入宿主 facade"| hosts
  entry -->|"E-L1001-02 绑定真实 executor"| caps
  caps -->|"E-L1001-03 调用共用外壳"| kernel
  caps -->|"E-L1001-04 复用事件、账本及维护 owner"| legacy
  kernel -->|"E-L1001-05 消费合同与词汇"| contracts
  kernel -->|"E-L1001-06 受根约束的物理能力"| foundation
  caps -->|"E-L1001-07 只读观察与核验两个工具"| observation
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| host | Codex 或 Claude Code；真实会话动作由 Agent 调用宿主完成。 |
| Demand | 一个需求的不可变身份和事件流；当前执行环境由 podId 指定。 |
| projection | 根据权威重建的视图，不反向决定事实。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| entry | `src/entrypoints/wakeflow-public-mcp-server.ts#createWakeflowPublicMcpServer` | 公共 MCP 组合根 |
| hosts | `src/entrypoints/codex-wakeflow-mcp.ts#createCodexWakeflowMcpServer` | 固定宿主数据与装配 |
| caps | `src/entrypoints/wakeflow-public-mcp-catalog.ts#WAKEFLOW_PUBLIC_TOOL_CATALOG` | 十个能力切片 |
| kernel | `src/kernel/command-shell.ts#runCommandShell` | 内核：调用、声明、观察与投影 |
| contracts | `src/governance/tasking/task-package.ts#TaskPackage` | Schema 与词汇 |
| foundation | `src/foundation/filesystem/rooted-directory.ts#RootedDirectory` | 确定性数据与持久 I/O |
| legacy | `src/governance/demand/event-sourcing/demand-event-sourcing-repository.ts#DemandEventSourcingRepository` | 过渡领域实现 |
| observation | `src/capabilities/observation/service.ts#executeStatusRequest` | 只读观察与核验 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1001-01 | `src/entrypoints/codex-wakeflow-mcp.ts#createCodexWakeflowMcpServer` | `tests/entrypoints/wakeflow-public-mcp-catalog.test.ts` | 注入宿主 facade |
| E-L1001-02 | `src/entrypoints/wakeflow-public-mcp-server.ts#createWakeflowPublicMcpServer` | `tests/entrypoints/wakeflow-public-mcp-catalog.test.ts` | 绑定真实 executor |
| E-L1001-03 | `src/capabilities/tasking/service.ts#executeTargetTaskPlanningPublicRequest` | `tests/capabilities/tasking/service.test.ts` | 调用共用外壳 |
| E-L1001-04 | `src/capabilities/demand/service.ts#executeDemandCreationRequest` | `tests/capabilities/demand/service.test.ts` | 复用事件、账本及维护 owner |
| E-L1001-05 | `src/kernel/requirement-board.ts` | `tests/kernel/command-shell.test.ts` | 消费合同与词汇 |
| E-L1001-06 | `src/kernel/work-claims.ts` | `tests/kernel/command-shell.test.ts` | 受根约束的物理能力 |
| E-L1001-07 | `src/capabilities/observation/service.ts#executeStatusRequest` | `tests/capabilities/observation/service.test.ts` | 只读观察与核验两个工具 |

## 守卫、恢复与验证范围

当前公共目录为 20 项，配置仍为 v3 且已包含 pods[]。observation 只读，不新增业务权威；十片场景验证不等于 L2 的两宿主真实投递，也不等于 L3 可安装新制品。Foundation 物理收敛与目录体积仍按现行计划继续。

涉及的测试与核验入口：

- `tests/capabilities/demand/service.test.ts`。
- `tests/capabilities/observation/service.test.ts`。
- `tests/capabilities/tasking/service.test.ts`。
- `tests/entrypoints/wakeflow-public-mcp-catalog.test.ts`。
- `tests/kernel/command-shell.test.ts`。
- `tooling/architecture/check-dependencies.ts`。

## 下钻与相关视图

- [文件直接导入](./file-dependencies.md)
- [运行调用与恢复](./runtime-call-flow.md)
- [业务主线](../10-end-to-end-business-flow/README.md)
- [内核](../11-kernel/README.md)
- [只读观察与核验](../16-observation/README.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
