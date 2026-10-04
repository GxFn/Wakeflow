# Wakeflow 当前架构与代码图谱

**2026-10-03 工作树快照，1.1.0-rc.5 候选。** 20 个公共工具、10 个能力切片；Config、锁与 status/verify 采用当前 v2 合同，不提供旧工作区格式迁移。当前 370 个手写文件中，7 个本轮完整重审、363 个按相同字节递归继承；95 Schema、95 generated、297 tests 另记范围，见[逐文件索引](./02-file-review-index.md)。当前 76 份文档包含 100 张 Mermaid 图，本轮新增 5 页、10 图。

当前审阅目录保留起始名称 `review-2026-10-03-rc4`，最终快照记录 rc.5。前轮 `review-2026-10-03`（rc.3）和 Oct2 记录属于历史，不能把它们的执行结果计入本轮。

本轮核实并转交的四项问题已修复；[当前状态与限制](./10-end-to-end-business-flow/review-evidence.md)保留前后态证据。本线程独立探针与开发线程根门分别记录：后者有持久日志及候选身份交叉核对，记录 1244 项和双宿主 smoke 通过；rc.5 原生会话仍未验证，详见[验证来源](../plans/review-2026-10-03-rc4/validation-provenance.md)。100/100 本地图已实际浏览器渲染，17 个 FigJam 重点视图完成结构/语义比对与限定范围的截图核验，见[本轮交付](../plans/review-2026-10-03-rc4/handoff.md)。

## 按问题选择入口

| 想回答的问题 | 入口 |
| --- | --- |
| 系统如何分层，谁拥有事实 | [01 总体架构](./01-overall-architecture/README.md) |
| 路径、稳定读取、原子写和恢复分别保证什么 | [02 Foundation](./02-foundation/README.md) |
| 初始化、重配置、对账和中断恢复如何运行 | [03 配置与工作区](./03-configuration-workspace/README.md) |
| Demand事件如何提交、重放、验证和恢复 | [04 事件与权威](./04-governance-event-sourcing/README.md) |
| 需求锚点、谱系、测试合同如何进入任务包 | [05 任务规划](./05-tasking-slice/README.md) |
| 发送许可、落地证据、不确定结局如何区分 | [06 投递](./06-implementation-delivery-review/README.md) |
| 接受、返工、升级、完成和取消如何分支 | [07 评审与生命周期](./07-review-rework-completion/README.md) |
| 逐步测试、重跑、产品缺陷授权如何衔接 | [08 真实环境测试合同](./08-real-environment-testing/README.md) |
| MCP、hook、Codex线程与Claude会话怎样接上 | [09 公共入口与宿主](./09-public-mcp-host-seams/README.md) |
| 用户和四类窗口怎样把需求推进到归档 | [10 跨角色业务接力](./10-end-to-end-business-flow/README.md) |
| 通用命令、声明、看板、hook与投影如何复用 | [11 Kernel](./11-kernel/README.md) |
| 逻辑窗口、私有句柄与实际检出怎样绑定 | [12 Endpoint](./12-endpoint/README.md) |
| 确认摘要、不可变需求包与认领板怎样分责 | [13 Requirement](./13-requirement/README.md) |
| 证据怎样捕获、提交、读取与证明完整 | [14 Evidence](./14-evidence/README.md) |
| Pod隔离、占用、worktree回执和关闭如何协调 | [15 Pod](./15-pod/README.md) |
| status/verify、不可用域和活动投影怎样解释 | [16 Observation](./16-observation/README.md) |
| Schema、编译闭包、制品、smoke与发布怎样区分 | [17 合同与制品工具链](./17-artifacts-and-contracts/README.md) |

## 本轮新增下钻

| 需要厘清的边界 | 当前实现入口 |
| --- | --- |
| 正常 reader 退出为何需要重观测，latch 失败如何结算许可 | [竞争与失败结算](./02-foundation/admission-races-and-recovery.md) |
| 回调如何引用不可信字段，发送、落地、完成与评审怎样分开 | [回调数据与评审边界](./07-review-rework-completion/callback-trust-and-review.md) |
| 控制字符、凭证、路径与 UUID 如何分类 | [文本隐私边界](./11-kernel/privacy-boundary.md) |
| 诊断上限为何不能决定有隐私的摘要是否可披露 | [需求预览与独立披露判定](./13-requirement/privacy-preview.md) |
| opaque 内容、人工确认、源重读和 payload 字节如何分责 | [证据隐私与来源一致性](./14-evidence/privacy-and-source-consistency.md) |

相关基础链：[读写准入](./02-foundation/read-write-admission.md) · [维护与配置](./03-configuration-workspace/operation-scope-and-config-baseline.md) · [项目聊天与执行根](./09-public-mcp-host-seams/project-chats-and-execution-roots.md) · [工作区作用域](./11-kernel/workspace-operation-scope.md) · [运行证据主体](./16-observation/runtime-evidence.md)。

## 三条阅读路线

- **理解产品**：总体架构 → 跨角色接力 → 需求/任务/投递/评审。
- **排查运行问题**：对应模块的runtime-call-flow → state/recovery下钻 → 图边证据 → 真实代码和测试。
- **维护源码**：逐文件索引 → 静态import精选 → 调用与状态图 → 来源摘要 → 本轮验证记录。

## 证据与状态含义

| 标记或证据 | 能证明 | 不能证明 |
| --- | --- | --- |
| 工作树快照 | 图以带摘要的当前未提交字节核验 | 已提交、已发布或某Demand已接受 |
| 静态导入 | 源文件确实直接引用另一模块，含仅类型引用 | 运行时一定调用、调用顺序或副作用 |
| 调用/状态图 | 真实调用点、守卫、提交和恢复分支 | 每个环境的实际执行结果 |
| tests/path#symbol | 该测试真实使用这个符号；具体断言在证据列说明 | 所有分支都已覆盖 |
| 测试/渲染回执 | 指定运行及输入范围的观察结果 | 未来来源变化仍然有效 |
| FigJam、SVG、截图 | 便于浏览和讨论的派生图 | 源码、图谱或运行状态权威 |

发现来源摘要变化时，先读实际差异并修订结论，不能仅刷新指纹。旧L1/L2/L3阶段描述保留在历史plans中，不再作为当前实现能力判断。

[逐图台账](./01-diagram-review-ledger.md) · [逐文件索引](./02-file-review-index.md) · [绘图标准](./00-agentic-diagram-standard.md) · [全部静态import数据](../plans/review-2026-10-03-rc4/import-graph.json)。

[本轮验证来源](../plans/review-2026-10-03-rc4/validation-provenance.md) · [最终快照](../plans/review-2026-10-03-rc4/source-baseline-final.json) · [FigJam 当前架构](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=62-1743) · [回调状态图](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=76-2662)。

[17 视图派生清单](../plans/review-2026-10-03-rc4/figjam-derivation.json)记录 160 节点、158 条边及视觉证据：8 面板使用本轮新截图，9 个未变面板继承 rc.3 已检截图。100 张本地源图的[浏览器渲染回执](../plans/evidence/current-mermaid-render.json)单独保存，旧报告不自动证明当前图通过。
