---
diagramId: ts-end-to-end-evidence-z2
viewType: evidence
truthKind: current-code
reviewDepth: L5
verifiedAt: 2026-09-18
baselineCommit: 1480271ecc8a6c17bb9042321644402bd6cbda56
sourceFingerprint: sha256:6abe292c8b87ab0e0e85aeda8d109f038baf057dce05b771a27ec5d25f413243
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

场景登记表当前有 18 条，全部在一次性工作区通过公共 MCP 执行。场景代码包含宿主 hook fixture 与实际临时 Git worktree；真实会话仍属于 L2。下表按 `tests/scenarios/wakeflow-scenario-acceptance.test.ts` 的登记表清点：本轮图谱未复跑场景套件，通过结果来自各自落地提交的记录。

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
| card-09/status-and-verify | 已登记，落地提交记录为通过 | 真实宿主会话、最终插件发布；本轮未复跑 |
| card-09/active-projection | 已登记，落地提交记录为通过 | 真实宿主会话、最终插件发布；本轮未复跑 |


> 核验基线：`1480271`（L1 observation 第十片已落地，20 个公共工具、18 个一次性场景）。工作树另有并行未提交改动（宿主 hook 通道等），本图不描绘；来源指纹按当前工作树计算。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 守卫、恢复与验证范围

单元/服务测试负责拒绝、幂等、并发及恢复分支；场景负责串接公共入口。测试数量变化不等于能力变化，旧 TestCard/协调器测试已经随新切片替换。本轮图谱只清点登记表，没有运行根 npm test 或场景套件。

涉及的测试与核验入口：

- `tests/scenarios/wakeflow-scenario-acceptance.test.ts`。

## 下钻与相关视图

- [本专题总览](./README.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
