---
diagramId: ts-overall-change-impact-d0
viewType: evidence
truthKind: current-code
reviewDepth: L5
verifiedAt: 2026-09-18
baselineCommit: 1480271ecc8a6c17bb9042321644402bd6cbda56
sourceFingerprint: sha256:3e56dcd873744605bd9b40ced392da6359d7ef9c1bd68662ad4f464e9e4926bf
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
| L1 observation | 已落地 | 只读 status / verify、活动投影与 Claude 状态栏按当前实现成图 |
| L2 场景联合、skills/commands 重写、双宿主真实投递 | 未开始 | 一次性场景不冒充真实宿主端到端验证 |
| L3 新制品构建、E4 旧树切换 | 未开始 | 候选仍 releaseEligible:false，旧 0.9.6 插件仍是独立制品 |

## D0：当前变更影响

比较范围为上轮图谱基线 `7ba1f38` 到本次 `1480271`，这里是固定提交差异，不是实时工作树；工作树另有并行未提交改动，不计入下表。

## 工作树路径分布

| 分类 | 路径数 | 影响范围 |
| --- | --- | --- |
| 运行时源码 | 80 | 该类在比较提交间新增、修改或删除的路径 |
| Schema 与生成合同 | 19 | 该类在比较提交间新增、修改或删除的路径 |
| 测试 | 36 | 该类在比较提交间新增、修改或删除的路径 |
| 工具 | 1 | 该类在比较提交间新增、修改或删除的路径 |
| 文档 | 11 | 该类在比较提交间新增、修改或删除的路径 |

## 最近关闭证据与活跃快照

| 范围 | 核验入口 | 结果 | 解释 |
| --- | --- | --- | --- |
| TypeScript | 根 npm test | 880 项（`1480271` 提交记录） | 本轮图谱未复跑根测试；数值来自该提交自述，未在此复验 |
| 一次性工作区 | scenario acceptance | 18 条场景已登记 | 场景登记表按源码清点；本轮未复跑 |
| 公共面 | catalog | 20 个工具 | 登记表清点：新增 wakeflow_status 与 wakeflow_verify，删除 wakeflow_inspect_demand_route |
| Schema | schema check | 95 份 | 按 `src/contracts/schemas` 实际文件数清点；漂移检查本轮未复跑 |
| 架构 | dependency rules | 未复跑 | 根架构门属于根 npm test，本轮未运行 |
| 真实宿主 | L2 | 未运行 | 不把 fixture hook 写入当作宿主实跑 |
| 新制品 | L3/E4 | 未运行 | candidate releaseEligible:false |

## 当前风险

- observation 已接通且只读；status/verify 不追加事件，也不代表 Controller 验收。
- 配置仍 v3、Foundation 物理收敛与工具目录预算仍是剩余项。
- 回调 acknowledged 从已有决定派生；只读 inspect 不追加事件。
- Pod 关闭只清理 Wakeflow 自有回执，检出目录的处置属于宿主/Agent。
- 当前图谱来源指纹只记录已核验快照，不承诺实时跟随代码修改；本轮指纹按含并行未提交改动的工作树计算。
- 本轮图谱核验只运行图谱自身检查，未运行根 npm test、场景套件与发布检查。


> 核验基线：`1480271`（L1 observation 第十片已落地，20 个公共工具、18 个一次性场景）。工作树另有并行未提交改动（宿主 hook 通道等），本图不描绘；来源指纹按当前工作树计算。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 守卫、恢复与验证范围

度量结果见 `plans/evidence/l1-nine-slices-facts.json`。构建图谱和代码测试不是 Controller 的产品验收。

涉及的测试与核验入口：

- `tests/entrypoints/wakeflow-public-mcp-catalog.test.ts`。
- `tests/scenarios/wakeflow-scenario-acceptance.test.ts`。

## 下钻与相关视图

- [本专题总览](./README.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
