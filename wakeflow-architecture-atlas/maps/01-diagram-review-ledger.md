---
diagramId: ts-atlas-review-ledger
viewType: evidence
truthKind: current-code
reviewDepth: L5
verifiedAt: 2026-09-18
baselineCommit: 1480271ecc8a6c17bb9042321644402bd6cbda56
sourceFingerprint: sha256:f13057c9d2dfb915aab6bc9c9020e75bcd43d0b080686cb27d52ccb10c05171d
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: manual-review
sourcePaths:
  - src/**/*.ts
  - tests/**/*.ts
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

# 当前图谱核验台账

> 核验：2026-09-18；代码基线 `1480271ecc8a6c17bb9042321644402bd6cbda56`。本轮在九片重绘之上补第十片 observation，并按该提交订正受影响的旧图。旧图号、旧证据和过期审查仍可在 Git 与 plans/evidence 中追溯。

| 开发范围 | 当前状态 | 图谱处理 |
| --- | --- | --- |
| L0 共用机制与六层依赖 | 已建立，物理收敛仍有余项 | 当前机制图保留实际文件，未伪装为最终目录 |
| L1 workspace / endpoint / requirement / demand / tasking / delivery / result-review / evidence / pod | 九片已落地 | 当前实现图与符号/Schema/测试核对 |
| L1 observation | 已落地 | 只读 status / verify、活动投影与 Claude 状态栏按当前实现成图 |
| L2 场景联合、skills/commands 重写、双宿主真实投递 | 未开始 | 一次性场景不冒充真实宿主端到端验证 |
| L3 新制品构建、E4 旧树切换 | 未开始 | 候选仍 releaseEligible:false，旧 0.9.6 插件仍是独立制品 |

## 本轮范围

| 文档 | 视图数 | 核验重点 |
| --- | --- | --- |
| [Wakeflow：十个切片的当前架构](./01-overall-architecture/README.md) | 1 | 真实 source / symbol / Schema / consumer / test |
| [公共组合根：文件直接导入](./01-overall-architecture/file-dependencies.md) | 1 | 真实 source / symbol / Schema / consumer / test |
| [公共入口：登记表到能力执行器](./01-overall-architecture/runtime-call-flow.md) | 1 | 真实 source / symbol / Schema / consumer / test |
| [Foundation：持久性与根约束](./02-foundation/README.md) | 1 | 真实 source / symbol / Schema / consumer / test |
| [Foundation：文件直接导入](./02-foundation/file-dependencies.md) | 1 | 真实 source / symbol / Schema / consumer / test |
| [Foundation：稳定读取、提交与恢复](./02-foundation/runtime-call-flow.md) | 3 | 真实 source / symbol / Schema / consumer / test |
| [工作区：配置、维护事务与静态资源](./03-configuration-workspace/README.md) | 1 | 真实 source / symbol / Schema / consumer / test |
| [配置与维护：文件直接导入](./03-configuration-workspace/file-dependencies.md) | 1 | 真实 source / symbol / Schema / consumer / test |
| [工作区维护：预览、应用与恢复](./03-configuration-workspace/runtime-call-flow.md) | 3 | 真实 source / symbol / Schema / consumer / test |
| [Demand：不可变事实与可重建视图](./04-governance-event-sourcing/README.md) | 1 | 真实 source / symbol / Schema / consumer / test |
| [事件与聚合：文件直接导入](./04-governance-event-sourcing/file-dependencies.md) | 1 | 真实 source / symbol / Schema / consumer / test |
| [Demand：命令、检查点与首次发布](./04-governance-event-sourcing/runtime-call-flow.md) | 3 | 真实 source / symbol / Schema / consumer / test |
| [任务规划：需求锚点、谱系与测试合同](./05-tasking-slice/README.md) | 1 | 真实 source / symbol / Schema / consumer / test |
| [任务规划：文件直接导入](./05-tasking-slice/file-dependencies.md) | 1 | 真实 source / symbol / Schema / consumer / test |
| [任务规划：追加、谱系与测试派生](./05-tasking-slice/runtime-call-flow.md) | 3 | 真实 source / symbol / Schema / consumer / test |
| [投递：信封、工作声明与回交观察](./06-implementation-delivery-review/README.md) | 1 | 真实 source / symbol / Schema / consumer / test |
| [投递与结果：文件直接导入](./06-implementation-delivery-review/file-dependencies.md) | 1 | 真实 source / symbol / Schema / consumer / test |
| [投递：准备、落地与重发恢复](./06-implementation-delivery-review/runtime-call-flow.md) | 3 | 真实 source / symbol / Schema / consumer / test |
| [评审、升级与完成即归档](./07-review-rework-completion/README.md) | 1 | 真实 source / symbol / Schema / consumer / test |
| [评审和生命周期：文件直接导入](./07-review-rework-completion/file-dependencies.md) | 1 | 真实 source / symbol / Schema / consumer / test |
| [评审和生命周期：决定、归档与继续](./07-review-rework-completion/runtime-call-flow.md) | 3 | 真实 source / symbol / Schema / consumer / test |
| [测试：任务合同、逐步记录与基线对比](./08-real-environment-testing/README.md) | 1 | 真实 source / symbol / Schema / consumer / test |
| [测试合同与结果：文件直接导入](./08-real-environment-testing/file-dependencies.md) | 1 | 真实 source / symbol / Schema / consumer / test |
| [测试：规划、尝试与失败子集](./08-real-environment-testing/runtime-call-flow.md) | 2 | 真实 source / symbol / Schema / consumer / test |
| [公共 MCP 与宿主接缝](./09-public-mcp-host-seams/README.md) | 1 | 真实 source / symbol / Schema / consumer / test |
| [宿主握手：向下投递与向上回调](./09-public-mcp-host-seams/host-effect-handshake.md) | 2 | 真实 source / symbol / Schema / consumer / test |
| [业务主线：需求包到归档和 Pod 关闭](./10-end-to-end-business-flow/README.md) | 1 | 真实 source / symbol / Schema / consumer / test |
| [状态索引：每个 owner 保持自己的事实](./10-end-to-end-business-flow/state-and-recovery.md) | 4 | 真实 source / symbol / Schema / consumer / test |
| [内核：可复用的调用与准入机制](./11-kernel/README.md) | 1 | 真实 source / symbol / Schema / consumer / test |
| [内核：文件直接导入](./11-kernel/file-dependencies.md) | 1 | 真实 source / symbol / Schema / consumer / test |
| [内核：命令外壳、追加与效果](./11-kernel/runtime-call-flow.md) | 3 | 真实 source / symbol / Schema / consumer / test |
| [端点：逻辑窗口、绑定与 worktree 回执](./12-endpoint/README.md) | 1 | 真实 source / symbol / Schema / consumer / test |
| [执行端点：文件直接导入](./12-endpoint/file-dependencies.md) | 1 | 真实 source / symbol / Schema / consumer / test |
| [端点：登记、替换与恢复](./12-endpoint/runtime-call-flow.md) | 2 | 真实 source / symbol / Schema / consumer / test |
| [需求包：确认摘要、不可变记录与认领板](./13-requirement/README.md) | 1 | 真实 source / symbol / Schema / consumer / test |
| [需求包：文件直接导入](./13-requirement/file-dependencies.md) | 1 | 真实 source / symbol / Schema / consumer / test |
| [需求包：发布与看板恢复](./13-requirement/runtime-call-flow.md) | 2 | 真实 source / symbol / Schema / consumer / test |
| [受管证据：来源、捕获、发布与读取](./14-evidence/README.md) | 1 | 真实 source / symbol / Schema / consumer / test |
| [证据发布：文件直接导入](./14-evidence/file-dependencies.md) | 1 | 真实 source / symbol / Schema / consumer / test |
| [证据：捕获、发布与崩溃结算](./14-evidence/runtime-call-flow.md) | 2 | 真实 source / symbol / Schema / consumer / test |
| [Pod：完整窗口组与检出回执](./15-pod/README.md) | 1 | 真实 source / symbol / Schema / consumer / test |
| [Pod 与 worktree：文件直接导入](./15-pod/file-dependencies.md) | 1 | 真实 source / symbol / Schema / consumer / test |
| [Pod：创建、就绪与两段关闭](./15-pod/runtime-call-flow.md) | 2 | 真实 source / symbol / Schema / consumer / test |
| [Observation：一次全局观察、核验门与活动投影](./16-observation/README.md) | 1 | 真实 source / symbol / Schema / consumer / test |
| [Observation：文件直接导入](./16-observation/file-dependencies.md) | 1 | 真实 source / symbol / Schema / consumer / test |
| [Observation：status、verify 与活动投影刷新](./16-observation/runtime-call-flow.md) | 3 | 真实 source / symbol / Schema / consumer / test |
| [核验快照与提交影响](./01-overall-architecture/review-evidence.md) | 0 | 真实 source / symbol / Schema / consumer / test |
| [端到端证据：场景、机制与未执行面](./10-end-to-end-business-flow/review-evidence.md) | 0 | 真实 source / symbol / Schema / consumer / test |

## 旧图替代原则

上轮 44 图中的方法图保留；其余按原文档地址重绘或移交专题。旧 E- 编号随关系退休，九片重绘采用独立 E-L1 编号；新编号不能被解释为旧边已自动复核。本轮 observation 续用同一序列：`E-L1067`（专题总览）、`E-L1068`（文件导入）、`E-L1069`–`E-L1071`（三条调用链）；受基线影响的旧边只订正定位，不换关系含义：`E-L1001-07` 由“目录尚无 status 与 verify”改为只读工具已登记，`E-L1038` 增加第 8 条只读边，`E-L1046` 增加第 7 条投影边，`E-L1030-16`/`-17` 随 verify 门移入治理层重新指向。原证据快照与逐图计划保留在 plans，历史审查不再作为当前实现入口。

## 核验结果与停止边界

- 公共目录 20 个工具、Schema 95 份、场景登记 18 条，均按当前源码清点；根 npm test 与场景套件本轮未复跑，`1480271` 自述的 880 项测试未在此复验。
- 本地结构门检查实际路径、AST 直接导入、符号存在、邻接唯一边证据和来源指纹；调用语义由本文所指的逐图源码核对承担。
- 来源指纹按当前工作树计算，而工作树含并行未提交改动（宿主 hook 通道等）；这些改动不在任何图内，图只描绘 `1480271` 已提交的实现。
- L2 真实宿主、L3/E4、在线 FigJam 不属于已完成实现；Claude 状态栏只核对了生成与安装代码，未在真实会话中观察。
- 旧 23 工具、TODO/Confirmation 入口、四注册组、独立 TestCard/Resume/授权工具、独立完成后归档缺口已从当前图中移除；`wakeflow_inspect_demand_route` 随本基线删除，不再出现在当前图中。

[总索引](./README.md) · [本轮范围与验证](../plans/l1-observation-refresh.md) · [上轮九片记录](../plans/l1-nine-slices-refresh.md)


> 核验基线：`1480271`（L1 observation 第十片已落地，20 个公共工具、18 个一次性场景）。工作树另有并行未提交改动（宿主 hook 通道等），本图不描绘；来源指纹按当前工作树计算。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 守卫、恢复与验证范围

图谱验收不替代运行时或发布验收。

涉及的测试与核验入口：

- `tests/entrypoints/wakeflow-public-mcp-catalog.test.ts`。
- `tests/scenarios/wakeflow-scenario-acceptance.test.ts`。

## 下钻与相关视图

- [图谱总索引](./README.md)
- [图谱子项目](../README.md)
- [本轮范围](../plans/l1-observation-refresh.md)
