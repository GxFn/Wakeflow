---
diagramId: ts-atlas-review-ledger
viewType: evidence
truthKind: current-code
reviewDepth: L5
verifiedAt: 2026-09-11
baselineCommit: 7ba1f38938a7387623b0ca588d9cfd54abda5760
sourceFingerprint: sha256:42976c9d21e30a92c355fefaa9b3addd903270606f3a2b61982e2304bae521a5
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

> 核验：2026-09-11；代码基线 `7ba1f38938a7387623b0ca588d9cfd54abda5760`。本次重绘覆盖 L1 九片。旧图号、旧证据和过期审查仍可在 Git 与 plans/evidence 中追溯。

| 开发范围 | 当前状态 | 图谱处理 |
| --- | --- | --- |
| L0 共用机制与六层依赖 | 已建立，物理收敛仍有余项 | 当前机制图保留实际文件，未伪装为最终目录 |
| L1 workspace / endpoint / requirement / demand / tasking / delivery / result-review / evidence / pod | 九片已落地 | 当前实现图与符号/Schema/测试核对 |
| L1 observation | 未开始 | 只列全局 status、verify、活动投影和状态栏的停止边界 |
| L2 场景联合、skills/commands 重写、双宿主真实投递 | 未开始 | 一次性场景不冒充真实宿主端到端验证 |
| L3 新制品构建、E4 旧树切换 | 未开始 | 候选仍 releaseEligible:false，旧 0.9.6 插件仍是独立制品 |

## 本轮范围

| 文档 | 视图数 | 核验重点 |
| --- | --- | --- |
| [Wakeflow：九个切片的当前架构](./01-overall-architecture/README.md) | 1 | 真实 source / symbol / Schema / consumer / test |
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
| [核验快照与提交影响](./01-overall-architecture/review-evidence.md) | 0 | 真实 source / symbol / Schema / consumer / test |
| [端到端证据：场景、机制与未执行面](./10-end-to-end-business-flow/review-evidence.md) | 0 | 真实 source / symbol / Schema / consumer / test |

## 旧图替代原则

上轮 44 图中的方法图保留；其余按原文档地址重绘或移交专题。旧 E- 编号随关系退休，本轮采用独立 E-L1 编号；新编号不能被解释为旧边已自动复核。原证据快照与逐图计划保留在 plans，历史审查不再作为当前实现入口。

## 核验结果与停止边界

- 根 npm test：851 通过，0 失败；公共场景 16 通过；Schema 93 份一致；架构门通过。
- 本地结构门检查实际路径、AST 直接导入、符号存在、邻接唯一边证据和来源指纹；调用语义由本文所指的逐图源码核对承担。
- 67 张 Mermaid 已在应用内浏览器实际渲染；暗/浅色、下钻、依赖图全屏和证据定位已检查。回执按源码摘要复验，不由 Vite build 推断。
- observation、L2 真实宿主、L3/E4、在线 FigJam 不属于已完成实现。
- 旧 23 工具、TODO/Confirmation 入口、四注册组、独立 TestCard/Resume/授权工具、独立完成后归档缺口已从当前图中移除。

[总索引](./README.md) · [本轮范围与验证](../plans/l1-nine-slices-refresh.md)


> 核验基线：`7ba1f38`；核验时实现代码均已提交，本轮图谱更新另列。开发阶段为 L1 九片已落地，observation 尚未开始。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 守卫、恢复与验证范围

图谱验收不替代运行时或发布验收。

涉及的测试与核验入口：

- `tests/entrypoints/wakeflow-public-mcp-catalog.test.ts`。
- `tests/scenarios/wakeflow-scenario-acceptance.test.ts`。

## 下钻与相关视图

- [图谱总索引](./README.md)
- [图谱子项目](../README.md)
- [本轮范围](../plans/l1-nine-slices-refresh.md)
