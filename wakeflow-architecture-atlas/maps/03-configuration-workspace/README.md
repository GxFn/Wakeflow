---
diagramId: ts-configuration-workspace-w0
viewType: architecture
truthKind: current-code
reviewDepth: L0
verifiedAt: 2026-09-18
baselineCommit: 1480271ecc8a6c17bb9042321644402bd6cbda56
sourceFingerprint: sha256:d7cb8c1ffe0a53bcf4ba7cad9f60f2feed5b596e91309bc94419898e5bc75d09
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: manual-review
sourcePaths:
  - src/capabilities/endpoint/*.ts
  - src/capabilities/endpoint/service.ts
  - src/capabilities/workspace/*.ts
  - src/capabilities/workspace/maintain-workspace.ts
  - src/configuration/*.ts
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
  - src/contracts/schemas/entrypoints/wakeflow-window-host-binding-registration-request.schema.json
  - src/contracts/schemas/entrypoints/wakeflow-window-host-binding-registration-result.schema.json
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
  - src/contracts/schemas/workspace/window-host-binding.schema.json
  - src/contracts/schemas/workspace/window-runtime-registered-projection.schema.json
  - src/contracts/schemas/workspace/window-runtime-unregistered-projection.schema.json
testPaths:
  - tests/capabilities/workspace/maintain-workspace.test.ts
refreshTriggers:
  - .dependency-cruiser.cjs
  - docs/decisions/0012-flow-convergence-callback-calls-testing-redesign.md
  - docs/decisions/0013-target-architecture-and-slice-plan.md
---

# 工作区：配置、维护事务与静态资源

初始化产生 primary Pod、逻辑窗口和托管资源；创建真实宿主会话是随后由 Agent 执行的动作。配置仍由严格 v3 codec 校验。

> 核验基线：`1480271`（L1 observation 第十片已落地，20 个公共工具、18 个一次性场景）。工作树另有并行未提交改动（宿主 hook 通道等），本图不描绘；来源指纹按当前工作树计算。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 工作区维护的权威与生成物

```mermaid
flowchart TB
  accTitle: 工作区维护的权威与生成物
  accDescr: 工作区维护的权威与生成物；箭头区分当前代码步骤、返回事实与明确的条件。
  selection["用户选择"]
  config["Config v3 与 pods[]"]
  preview["零写维护预览"]
  txn["维护 intent / journal"]
  resources["静态资源及托管块"]
  launch["窗口启动意图"]
  selection -->|"E-L1009-01 确定性编译身份"| config
  config -->|"E-L1009-02 矩阵与宿主 profile 推导"| preview
  preview -->|"E-L1009-03 同请求摘要 apply"| txn
  txn -->|"E-L1009-04 分步发布并记录 checkpoint"| resources
  resources -->|"E-L1009-05 返回意图，等待宿主动作"| launch
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| Pod | 完整窗口组与每仓执行位置；main 是 primary Pod。 |
| host | Codex 或 Claude Code；真实会话动作由 Agent 调用宿主完成。 |
| CAS | 比较已观察的摘要/修订后提交；来源已改变则拒绝。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| selection | `src/configuration/wakeflow-fresh-config-selection.ts` | 用户选择 |
| config | `src/configuration/wakeflow-config-v3.ts` | Config v3 与 pods[] |
| preview | `src/capabilities/workspace/maintain-workspace.ts` | 零写维护预览 |
| txn | `src/workspace/maintenance/wakeflow-maintenance-execution-transaction.ts` | 维护 intent / journal |
| resources | `src/workspace/maintenance/wakeflow-static-materialization-preview.ts` | 静态资源及托管块 |
| launch | `src/capabilities/endpoint/service.ts` | 窗口启动意图 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1009-01 | `src/configuration/wakeflow-fresh-config-selection.ts` | `tests/capabilities/workspace/maintain-workspace.test.ts` | 确定性编译身份 |
| E-L1009-02 | `src/capabilities/workspace/maintain-workspace.ts` | `tests/capabilities/workspace/maintain-workspace.test.ts` | 矩阵与宿主 profile 推导 |
| E-L1009-03 | `src/kernel/publication-transaction.ts#runPublicationTransaction` | `tests/capabilities/workspace/maintain-workspace.test.ts` | 同请求摘要 apply |
| E-L1009-04 | `src/workspace/maintenance/wakeflow-maintenance-execution-transaction.ts` | `tests/capabilities/workspace/maintain-workspace.test.ts` | 分步发布并记录 checkpoint |
| E-L1009-05 | `src/capabilities/workspace/maintain-workspace.ts` | `tests/capabilities/workspace/maintain-workspace.test.ts` | 返回意图，等待宿主动作 |

## 守卫、恢复与验证范围

reconfigure 对 pods 的改变仍报告 unsupported，Pod 生命周期由专属工具处理。全局 status/verify、活动投影与 Claude 状态栏已随 observation 落地：维护事务仍拥有布局与静态资源，投影页面由内核渲染、由变更后刷新重写，不反向决定配置。

涉及的测试与核验入口：

- `tests/capabilities/workspace/maintain-workspace.test.ts`。

## 下钻与相关视图

- [文件直接导入](./file-dependencies.md)
- [运行调用与恢复](./runtime-call-flow.md)
- [端点握手](../12-endpoint/README.md)
- [Pod 配置与生命周期](../15-pod/README.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
