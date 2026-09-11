# Wakeflow 架构与代码图谱

> 核验基线 `7ba1f38`，2026-09-11。当前九个能力切片已落地，19 个公共工具、16 个一次性场景；observation、L2 与 L3/E4 为后续范围。

| 开发范围 | 当前状态 | 图谱处理 |
| --- | --- | --- |
| L0 共用机制与六层依赖 | 已建立，物理收敛仍有余项 | 当前机制图保留实际文件，未伪装为最终目录 |
| L1 workspace / endpoint / requirement / demand / tasking / delivery / result-review / evidence / pod | 九片已落地 | 当前实现图与符号/Schema/测试核对 |
| L1 observation | 未开始 | 只列全局 status、verify、活动投影和状态栏的停止边界 |
| L2 场景联合、skills/commands 重写、双宿主真实投递 | 未开始 | 一次性场景不冒充真实宿主端到端验证 |
| L3 新制品构建、E4 旧树切换 | 未开始 | 候选仍 releaseEligible:false，旧 0.9.6 插件仍是独立制品 |

## 按问题下钻

| 入口 | 回答的问题 |
| --- | --- |
| [Wakeflow：九个切片的当前架构](./01-overall-architecture/README.md) | 六层职责与当前过渡实现 |
| [Foundation：持久性与根约束](./02-foundation/README.md) | 基础原语与业务 owner 的边界 |
| [工作区：配置、维护事务与静态资源](./03-configuration-workspace/README.md) | 工作区维护的权威与生成物 |
| [Demand：不可变事实与可重建视图](./04-governance-event-sourcing/README.md) | 从需求包到 Demand 事件与视图 |
| [任务规划：需求锚点、谱系与测试合同](./05-tasking-slice/README.md) | 一次追加生成任务合同 |
| [投递：信封、工作声明与回交观察](./06-implementation-delivery-review/README.md) | 当前投递与目标结果的接力 |
| [评审、升级与完成即归档](./07-review-rework-completion/README.md) | 评审决定与下一责任 |
| [测试：任务合同、逐步记录与基线对比](./08-real-environment-testing/README.md) | 测试合同到 Controller 决定 |
| [公共 MCP 与宿主接缝](./09-public-mcp-host-seams/README.md) | 内容与状态通道的分工 |
| [业务主线：需求包到归档和 Pod 关闭](./10-end-to-end-business-flow/README.md) | 九个已落地切片的业务接力 |
| [内核：可复用的调用与准入机制](./11-kernel/README.md) | 共同命令外壳与两种变更形状 |
| [端点：逻辑窗口、绑定与 worktree 回执](./12-endpoint/README.md) | 端点登记与可验证的执行位置 |
| [需求包：确认摘要、不可变记录与认领板](./13-requirement/README.md) | 需求内容、确认与认领的不同事实 |
| [受管证据：来源、捕获、发布与读取](./14-evidence/README.md) | 受管证据从选择到结果消费 |
| [Pod：完整窗口组与检出回执](./15-pod/README.md) | Pod 配置和端点事实形成执行环境 |

## 事实与阅读方式

先看业务总览，再进入能力的文件依赖、符号调用和恢复图。导入是静态关系，调用顺序需核对使用点；状态按 owner 分图，Agent 决定不画成机器强制转换。

- `[当前]`：代码、合同、实际消费者和验证入口已对照，指纹匹配核验范围。
- `[待复核]`：来源变化后保留原快照，不能继续当作当前操作依据。
- `[进行中]`：有明确未提交实现边界；当前本轮代码基线没有这类页面。
- `[目标设计]`：明确的设计依据，不能当成生产调用链；本轮未展开 observation 内部设计。
- `[历史]`：旧提交的说明，不能进入当前能力统计。

每张图均有本图术语说明、节点/符号定位和独立边证据表。文件依赖为 AST 精选图，完整路径写在节点表；同名 service.ts 通过完整路径区分。

## 核验与后续

[当前逐图台账](./01-diagram-review-ledger.md) · [绘图标准](./00-agentic-diagram-standard.md) · [本轮范围和验证](../plans/l1-nine-slices-refresh.md)

Schema 仍为 wire 权威；配置仍 v3 且已包含 Pod，最终切换不在本轮。全局 status/verify、完整活动投影与状态栏待 observation；skills/commands 重写与双宿主真实投递待 L2；可安装新制品与旧树删除待 L3/E4。
