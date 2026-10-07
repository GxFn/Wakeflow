# Wakeflow 当前架构与代码图谱

**2026-10-04 当前工作树，基线04769897加维护工具修改，版本1.1.0-rc.5。** 20个公共工具、10个能力切片；当前407个手写文件，5个本轮工具语义复核、402个按同字节原记录继承；95 Schema、95 generated、314 tests另记范围，见[逐文件索引](./02-file-review-index.md)。本轮82份文档、112张Mermaid图、17个专题。

本轮增加只读故障包页及2张图，补充明确源采集、私有封存和封闭分享投影。本机Codex main/worktree原生业务与资源回收已完成，宿主自动关联、回调hook、列表回读、Windows和远端CI仍有未验证范围；来源和执行结论见[当前验证记录](../plans/review-2026-10-04-diagnostic-bundles/validation-provenance.md)。历史rc.5运行时修复、rc.3及Oct2审阅保留原记录，不将其测试结果重命名为本轮新执行。

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

## 维护工具与历史下钻

| 需要厘清的边界 | 当前实现入口 |
| --- | --- |
| 哪些字节经过哪些门，缺证据为何不能绿色 | [维护验证回执](./17-artifacts-and-contracts/maintainer-verification.md) |
| 实验清理、新建尝试与原生证据如何分责 | [lab/live工具边界](./17-artifacts-and-contracts/lab-and-live-tools.md) |
| 新环境业务、合成宿主和worktree清理如何闭合 | [固定业务实验](./17-artifacts-and-contracts/lab-business-scenarios.md) |
| 模型如何重放，CI摘要能证明什么 | [CI与模型证据](./17-artifacts-and-contracts/ci-and-model-evidence.md) |
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

[逐图台账](./01-diagram-review-ledger.md) · [逐文件索引](./02-file-review-index.md) · [绘图标准](./00-agentic-diagram-standard.md) · [全部静态import数据](../plans/review-2026-10-04-diagnostic-bundles/import-graph.json)。

[本轮验证来源](../plans/review-2026-10-04-diagnostic-bundles/validation-provenance.md) · [当前覆盖](../plans/review-2026-10-04-diagnostic-bundles/review-coverage.json) · [历史运行时修复验证](../plans/review-2026-10-03-rc4/validation-provenance.md)。

FigJam的17视图仍为上一轮派生快照，尚未同步新增维护工具图；[旧派生清单](../plans/review-2026-10-03-rc4/figjam-derivation.json)与截图范围保持原样。全部当前本地图以[浏览器渲染回执](../plans/evidence/current-mermaid-render.json)匹配的源摘要为准。

本轮维护入口：[测试捕获与回执](./17-artifacts-and-contracts/test-capture-and-receipts.md)；16项聚焦、22项历史材料隔离重放、2 worker完整门1314项及双宿主smoke通过；首轮4 worker失败/中断保留。图谱110张图及独立检查通过。

本轮重点：[只读故障包与独立分享](./17-artifacts-and-contracts/diagnostic-bundles.md)。记录了宿主错配与权限夹具假设的修正，以及成功摘要缺少调用证据的一致性反例。
