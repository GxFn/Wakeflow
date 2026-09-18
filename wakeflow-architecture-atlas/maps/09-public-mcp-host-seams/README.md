---
diagramId: ts-public-mcp-host-h0
viewType: architecture
truthKind: current-code
reviewDepth: L0
verifiedAt: 2026-09-18
baselineCommit: 1480271ecc8a6c17bb9042321644402bd6cbda56
sourceFingerprint: sha256:abd4b68b2fd77663f42afe208628541a3a43feec64052490f25439f37e83ac3e
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: manual-review
sourcePaths:
  - src/capabilities/delivery/*.ts
  - src/capabilities/delivery/service.ts
  - src/capabilities/demand/*.ts
  - src/capabilities/endpoint/*.ts
  - src/capabilities/evidence/*.ts
  - src/capabilities/observation/*.ts
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
  - src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.ts
  - src/governance/demand/event-sourcing/demand-event-sourcing-repository.ts
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
  - src/kernel/*.ts
  - src/kernel/event-stream/*.ts
  - src/kernel/hook-observations.ts
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
  - src/contracts/schemas/workspace/window-runtime-unregistered-projection.schema.json
testPaths:
  - tests/capabilities/delivery/service.test.ts
  - tests/capabilities/endpoint/service.test.ts
  - tests/capabilities/observation/service.test.ts
  - tests/capabilities/result-review/service.test.ts
  - tests/entrypoints/wakeflow-public-mcp-catalog.test.ts
  - tests/governance/demand/demand-event-sourcing-command-handler.test.ts
  - tests/hosts/claude-code/claude-code-statusline-asset.test.ts
refreshTriggers:
  - .dependency-cruiser.cjs
  - docs/decisions/0012-flow-convergence-callback-calls-testing-redesign.md
  - docs/decisions/0013-target-architecture-and-slice-plan.md
---

# 公共 MCP 与宿主接缝

当前公开 20 个工具，由一个静态登记表绑定到双宿主组合根。其中 status 与 verify 只读。宿主差异主要是画像、动作内容、观察形状、维护操作与指令；实际创建会话、发送和 worktree 处置由 Agent 执行。

> 核验基线：`1480271`（L1 observation 第十片已落地，20 个公共工具、18 个一次性场景）。工作树另有并行未提交改动（宿主 hook 通道等），本图不描绘；来源指纹按当前工作树计算。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 内容与状态通道的分工

```mermaid
flowchart TB
  accTitle: 内容与状态通道的分工
  accDescr: 内容与状态通道的分工；箭头区分当前代码步骤、返回事实与明确的条件。
  agent["Agent 的工作流调用"]
  mcp["20 工具的公共边界"]
  caps["能力及领域 owner"]
  local["本地权威与派生视图"]
  permit["精确意图和许可"]
  host["宿主效果"]
  hook["宿主观察回交"]
  read["只读 status 与 verify"]
  agent -->|"E-L1038-01 调用对应能力"| mcp
  mcp -->|"E-L1038-02 固定 executor 分派"| caps
  caps -->|"E-L1038-03 准入后提交当前事实"| local
  caps -->|"E-L1038-04 生成内容和 fenced permit"| permit
  permit -->|"E-L1038-05 Agent 执行动作"| host
  host -->|"E-L1038-06 宿主报告而非业务验收"| hook
  hook -->|"E-L1038-07 由能力读取和核对观察"| caps
  caps -->|"E-L1038-08 只读工具按登记表观察同一批事实"| read
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| host | Codex 或 Claude Code；真实会话动作由 Agent 调用宿主完成。 |
| permit | 供 Agent 使用的投递内容与围栏；重放不是新一次发送授权。 |
| hook | 宿主回交的会话/提示提交/完成观察记录，保存在宿主本地根。 |
| fence | claimId、claimDigest 与流修订构成的准入令牌。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| agent | Agent / 用户 / 外部效果或条件视图 | Agent 的工作流调用 |
| mcp | `src/entrypoints/wakeflow-public-mcp-catalog.ts` | 20 工具的公共边界 |
| caps | `src/entrypoints/wakeflow-public-mcp-shared-executors.ts` | 能力及领域 owner |
| local | `src/governance/demand/event-sourcing/demand-event-sourcing-repository.ts` | 本地权威与派生视图 |
| permit | `src/capabilities/delivery/service.ts` | 精确意图和许可 |
| host | Agent / 用户 / 外部效果或条件视图 | 宿主效果 |
| hook | `src/kernel/hook-observations.ts` | 宿主观察回交 |
| read | `src/capabilities/observation/contract.ts#VERIFY_TOOL_REGISTRATION` | 只读 status 与 verify |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1038-01 | `src/entrypoints/wakeflow-public-mcp-tool.ts#registerWakeflowPublicMcpCatalog` | `tests/entrypoints/wakeflow-public-mcp-catalog.test.ts` | 调用对应能力 |
| E-L1038-02 | `src/entrypoints/wakeflow-public-mcp-server.ts#createWakeflowPublicMcpServer` | `tests/entrypoints/wakeflow-public-mcp-catalog.test.ts` | 固定 executor 分派 |
| E-L1038-03 | `src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.ts#executeDemandEventSourcingCommand` | `tests/governance/demand/demand-event-sourcing-command-handler.test.ts` | 准入后提交当前事实 |
| E-L1038-04 | `src/capabilities/delivery/service.ts#permitBody` | `tests/capabilities/delivery/service.test.ts` | 生成内容和 fenced permit |
| E-L1038-05 | `src/capabilities/delivery/service.ts#permitBody` | `tests/capabilities/delivery/service.test.ts` | Agent 执行动作 |
| E-L1038-06 | `src/kernel/hook-observations.ts#writeHostHookObservation` | `tests/capabilities/endpoint/service.test.ts` | 宿主报告而非业务验收 |
| E-L1038-07 | `src/capabilities/result-review/service.ts#loadReviewEvidence` | `tests/capabilities/result-review/service.test.ts` | 由能力读取和核对观察 |
| E-L1038-08 | `src/capabilities/observation/service.ts#executeVerifyRequest` | `tests/capabilities/observation/service.test.ts` | 只读工具按登记表观察同一批事实 |

## 宿主专属的维护操作

Claude Code 多出两个状态栏维护操作：`claude-statusline-asset:install` 写入 0600 的状态栏资产，`claude-statusline-settings:install` 只改 `.claude/settings.local.json` 的单个键并保留其它键，设置读不出时该项贡献被阻塞。Codex 侧没有对应资产。两者都由维护事务执行，不属于公共工具目录。

## 守卫、恢复与验证范围

`wakeflow_status` 与 `wakeflow_verify` 已登记，二者只读：不追加事件、不改配置、不创建会话，也不代表 Controller 验收；旧的 `wakeflow_inspect_demand_route` 随 status 带 demandId 的 Route 段删除。候选制品仍 releaseEligible:false；当前工具/场景通过不是最终插件发布。

涉及的测试与核验入口：

- `tests/capabilities/delivery/service.test.ts`。
- `tests/capabilities/endpoint/service.test.ts`。
- `tests/capabilities/result-review/service.test.ts`。
- `tests/capabilities/observation/service.test.ts`。
- `tests/entrypoints/wakeflow-public-mcp-catalog.test.ts`。
- `tests/governance/demand/demand-event-sourcing-command-handler.test.ts`。

## 下钻与相关视图

- [发送与回调时序](./host-effect-handshake.md)
- [执行环境](../15-pod/README.md)
- [只读观察与核验](../16-observation/README.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
