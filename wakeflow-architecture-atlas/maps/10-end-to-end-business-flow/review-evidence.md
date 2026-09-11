---
diagramId: ts-end-to-end-evidence-z2
viewType: evidence
truthKind: current-code
reviewDepth: L5
verifiedAt: 2026-09-11
baselineCommit: 7ba1f38938a7387623b0ca588d9cfd54abda5760
sourceFingerprint: sha256:aade6492a2e7f041a2499f8f195704aebe11053c45fbf30d621cce9d3d01eb50
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: manual-review
sourcePaths:
  - src/capabilities/**
  - src/entrypoints/**
schemaPaths:
  - src/contracts/schemas/**/*.schema.json
testPaths:
  - tests/scenarios/wakeflow-scenario-acceptance.test.ts
refreshTriggers:
  - .dependency-cruiser.cjs
  - docs/decisions/0012-flow-convergence-callback-calls-testing-redesign.md
  - docs/decisions/0013-target-architecture-and-slice-plan.md
---

# 端到端证据：场景、机制与未执行面

当前 16 个场景在一次性工作区通过。场景代码包含宿主 hook fixture 与实际临时 Git worktree；真实会话仍属于 L2。

| 场景 | 当前证明 | 尚不证明 |
| --- | --- | --- |
| card-01/fresh-initialize | 当前公共 MCP 场景通过 | 真实宿主会话、最终插件发布 |
| card-02/window-handshake | 当前公共 MCP 场景通过 | 真实宿主会话、最终插件发布 |
| card-02/window-replace | 当前公共 MCP 场景通过 | 真实宿主会话、最终插件发布 |
| card-03/requirement-package | 当前公共 MCP 场景通过 | 真实宿主会话、最终插件发布 |
| card-04/create-demand | 当前公共 MCP 场景通过 | 真实宿主会话、最终插件发布 |
| card-05/plan-implementation-task | 当前公共 MCP 场景通过 | 真实宿主会话、最终插件发布 |
| card-06/delivery-chain | 当前公共 MCP 场景通过 | 真实宿主会话、最终插件发布 |
| card-06/ambiguous-resolution | 当前公共 MCP 场景通过 | 真实宿主会话、最终插件发布 |
| card-08/evidence | 当前公共 MCP 场景通过 | 真实宿主会话、最终插件发布 |
| card-07/import-and-review | 当前公共 MCP 场景通过 | 真实宿主会话、最终插件发布 |
| card-06/wake-controller | 当前公共 MCP 场景通过 | 真实宿主会话、最终插件发布 |
| card-07/escalate-and-resume | 当前公共 MCP 场景通过 | 真实宿主会话、最终插件发布 |
| card-05/test-contract | 当前公共 MCP 场景通过 | 真实宿主会话、最终插件发布 |
| card-08/complete-and-archive | 当前公共 MCP 场景通过 | 真实宿主会话、最终插件发布 |
| card-04/complete-and-continue | 当前公共 MCP 场景通过 | 真实宿主会话、最终插件发布 |
| card-10/pod-lifecycle | 当前公共 MCP 场景通过 | 真实宿主会话、最终插件发布 |


> 核验基线：`7ba1f38`；核验时实现代码均已提交，本轮图谱更新另列。开发阶段为 L1 九片已落地，observation 尚未开始。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 守卫、恢复与验证范围

单元/服务测试负责拒绝、幂等、并发及恢复分支；场景负责串接公共入口。测试数量下降不等于能力回退，旧 TestCard/协调器测试已经随新切片替换。

涉及的测试与核验入口：

- `tests/scenarios/wakeflow-scenario-acceptance.test.ts`。

## 下钻与相关视图

- [本专题总览](./README.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
