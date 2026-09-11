---
diagramId: ts-overall-change-impact-d0
viewType: evidence
truthKind: current-code
reviewDepth: L5
verifiedAt: 2026-09-11
baselineCommit: 7ba1f38938a7387623b0ca588d9cfd54abda5760
sourceFingerprint: sha256:35e9321cb9361de8f1f5d5872796d2ab3722a68d4b81a8d5fe88927b187f5e79
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: manual-review
sourcePaths:
  - src/**/*.ts
  - tooling/architecture/check-dependencies.ts
schemaPaths:
  - src/contracts/schemas/**/*.schema.json
testPaths:
  - tests/entrypoints/wakeflow-public-mcp-catalog.test.ts
  - tests/scenarios/wakeflow-scenario-acceptance.test.ts
refreshTriggers:
  - .dependency-cruiser.cjs
  - docs/decisions/0012-flow-convergence-callback-calls-testing-redesign.md
  - docs/decisions/0013-target-architecture-and-slice-plan.md
---

# 核验快照与提交影响

本页把实现覆盖、代码验证与尚未运行的宿主/发布验证分开。

| 开发范围 | 当前状态 | 图谱处理 |
| --- | --- | --- |
| L0 共用机制与六层依赖 | 已建立，物理收敛仍有余项 | 当前机制图保留实际文件，未伪装为最终目录 |
| L1 workspace / endpoint / requirement / demand / tasking / delivery / result-review / evidence / pod | 九片已落地 | 当前实现图与符号/Schema/测试核对 |
| L1 observation | 未开始 | 只列全局 status、verify、活动投影和状态栏的停止边界 |
| L2 场景联合、skills/commands 重写、双宿主真实投递 | 未开始 | 一次性场景不冒充真实宿主端到端验证 |
| L3 新制品构建、E4 旧树切换 | 未开始 | 候选仍 releaseEligible:false，旧 0.9.6 插件仍是独立制品 |

## D0：当前变更影响

比较范围为上轮图谱审查提交 `ec341d4` 到本次 `7ba1f38`，这里是固定提交差异，不是实时工作树。

## 工作树路径分布

| 分类 | 路径数 | 影响范围 |
| --- | --- | --- |
| 运行时源码 | 116 | 该类在比较提交间新增、修改或删除的路径 |
| Schema 与生成合同 | 120 | 该类在比较提交间新增、修改或删除的路径 |
| 测试 | 107 | 该类在比较提交间新增、修改或删除的路径 |
| 工具 | 0 | 该类在比较提交间新增、修改或删除的路径 |
| 文档 | 12 | 该类在比较提交间新增、修改或删除的路径 |

## 最近关闭证据与活跃快照

| 范围 | 核验入口 | 结果 | 解释 |
| --- | --- | --- | --- |
| TypeScript | 根 npm test | 851 项通过 | typecheck、架构、lint、格式、knip、测试、Schema 均通过 |
| 一次性工作区 | scenario acceptance | 16 场景通过 | 全部通过公共 MCP，含 Git worktree fixture |
| 公共面 | catalog | 19 个工具 | status/verify 尚未登记，inspect_demand_route 暂保留 |
| Schema | schema check | 93 份一致 | 生成合同漂移检查通过 |
| 架构 | dependency rules | 640 模块通过 | 根架构门，10 个生产根 |
| 真实宿主 | L2 | 未运行 | 不把 fixture hook 写入当作宿主实跑 |
| 新制品 | L3/E4 | 未运行 | candidate releaseEligible:false |

## 当前风险

- observation 尚未接通；内嵌完成 verify 不等于全局校验工具。
- 配置仍 v3、Foundation 物理收敛与工具目录预算仍是剩余项。
- 回调 acknowledged 从已有决定派生；只读 inspect 不追加事件。
- Pod 关闭只清理 Wakeflow 自有回执，检出目录的处置属于宿主/Agent。
- 当前图谱来源指纹只记录已核验快照，不承诺实时跟随代码修改。


> 核验基线：`7ba1f38`；核验时实现代码均已提交，本轮图谱更新另列。开发阶段为 L1 九片已落地，observation 尚未开始。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 守卫、恢复与验证范围

度量结果见 `plans/evidence/l1-nine-slices-facts.json`。构建图谱和代码测试不是 Controller 的产品验收。

涉及的测试与核验入口：

- `tests/entrypoints/wakeflow-public-mcp-catalog.test.ts`。
- `tests/scenarios/wakeflow-scenario-acceptance.test.ts`。

## 下钻与相关视图

- [本专题总览](./README.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
