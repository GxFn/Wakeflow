---
diagramId: ts-endpoint-readme
viewType: authority
truthKind: current-code
reviewDepth: L4
verifiedAt: 2026-09-18
baselineCommit: 1480271ecc8a6c17bb9042321644402bd6cbda56
sourceFingerprint: sha256:bed0e6411472c4af71d894f394c49211e7d0424ed25b9b84a2dffafe9e4c15d7
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: manual-review
sourcePaths:
  - src/capabilities/endpoint/*.ts
  - src/capabilities/endpoint/decide.ts
  - src/capabilities/endpoint/service.ts
  - src/configuration/*.ts
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
  - tests/capabilities/pod/service.test.ts
refreshTriggers:
  - .dependency-cruiser.cjs
  - docs/decisions/0012-flow-convergence-callback-calls-testing-redesign.md
  - docs/decisions/0013-target-architecture-and-slice-plan.md
---

# 端点：逻辑窗口、绑定与 worktree 回执

逻辑窗口来自配置，私有 Binding 指向宿主句柄。登记以 SessionStart 与启动意图核对；worktree Pod 的产品窗口还要带物理回执。

> 核验基线：`1480271`（L1 observation 第十片已落地，20 个公共工具、18 个一次性场景）。工作树另有并行未提交改动（宿主 hook 通道等），本图不描绘；来源指纹按当前工作树计算。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 端点登记与可验证的执行位置

```mermaid
flowchart TB
  accTitle: 端点登记与可验证的执行位置
  accDescr: 端点登记与可验证的执行位置；箭头区分当前代码步骤、返回事实与明确的条件。
  intent["逻辑窗口和启动意图"]
  agent["Agent 创建宿主会话 / worktree"]
  hook["SessionStart 观察"]
  admit["句柄、根、意图和回执准入"]
  binding["私有 Binding 与定位器"]
  receipt["worktree 回执和脱敏投影"]
  intent -->|"E-L1051-01 提供宿主动作参数"| agent
  agent -->|"E-L1051-02 宿主回报会话与 cwd"| hook
  hook -->|"E-L1051-03 登记需匹配观察"| admit
  admit -->|"E-L1051-04 登记表互斥下创建或替换"| binding
  binding -->|"E-L1051-05 同代回执与投影"| receipt
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| Pod | 完整窗口组与每仓执行位置；main 是 primary Pod。 |
| hook | 宿主回交的会话/提示提交/完成观察记录，保存在宿主本地根。 |
| host | Codex 或 Claude Code；真实会话动作由 Agent 调用宿主完成。 |
| CAS | 比较已观察的摘要/修订后提交；来源已改变则拒绝。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| intent | `src/capabilities/endpoint/service.ts` | 逻辑窗口和启动意图 |
| agent | Agent / 用户 / 外部效果或条件视图 | Agent 创建宿主会话 / worktree |
| hook | `src/kernel/hook-observations.ts` | SessionStart 观察 |
| admit | `src/capabilities/endpoint/decide.ts` | 句柄、根、意图和回执准入 |
| binding | `src/capabilities/endpoint/service.ts` | 私有 Binding 与定位器 |
| receipt | `src/kernel/pod-worktree-receipts.ts` | worktree 回执和脱敏投影 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1051-01 | `src/capabilities/endpoint/service.ts#executionInstructions` | `tests/capabilities/endpoint/service.test.ts` | 提供宿主动作参数 |
| E-L1051-02 | `src/kernel/hook-observations.ts#writeHostHookObservation` | `tests/capabilities/endpoint/service.test.ts` | 宿主回报会话与 cwd |
| E-L1051-03 | `src/capabilities/endpoint/service.ts#loadHookSessions` | `tests/capabilities/endpoint/service.test.ts` | 登记需匹配观察 |
| E-L1051-04 | `src/capabilities/endpoint/service.ts#mutateBinding` | `tests/capabilities/endpoint/service.test.ts` | 登记表互斥下创建或替换 |
| E-L1051-05 | `src/kernel/pod-worktree-receipts.ts#writePodWorktreeReceipt` | `tests/capabilities/pod/service.test.ts` | 同代回执与投影 |

## 守卫、恢复与验证范围

五操作为 inspect、register、replace、decommission、release-claim。原始会话句柄与检出绝对路径只进宿主本地记录；工具返回摘要、逻辑身份与允许公开的分支事实。

涉及的测试与核验入口：

- `tests/capabilities/endpoint/service.test.ts`。
- `tests/capabilities/pod/service.test.ts`。

## 下钻与相关视图

- [文件直接导入](./file-dependencies.md)
- [运行调用与恢复](./runtime-call-flow.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
