# 逐图核验台账

2026-10-03 工作树，版本输入1.1.0-rc.5：共有 **100张实际Mermaid图**，分布于71份含图文档。每行按当前maps中的accTitle列出一张图；静态导入、调用、状态与恢复保持各自语义。图的列举不证明渲染或源码验证通过。

结构/符号/测试锚点/来源指纹由图谱检查器核验；[当前浏览器渲染回执](../plans/evidence/current-mermaid-render.json)须匹配每张图的最新源码摘要才有效。旧日期的测试或FigJam记录不能自动证明本轮更新通过。

| 文档 | 图号与中文标题 | 视图 / 深度 | 来源状态 |
| --- | --- | --- | --- |
| [00-agentic-diagram-standard.md](./00-agentic-diagram-standard.md) | 1 · 流程图生成与人工审阅边界 | standard / — | 绘图规范 |
| [01-overall-architecture/README.md](./01-overall-architecture/README.md) | 1 · 当前六层架构与职责边界 | architecture / L4 | 工作树快照 |
| [01-overall-architecture/file-dependencies.md](./01-overall-architecture/file-dependencies.md) | 1 · 公共 MCP 装配的直接导入 | file-dependency / L3 | 工作树快照 |
| [01-overall-architecture/file-dependencies.md](./01-overall-architecture/file-dependencies.md) | 2 · 任务切片向下依赖的精选关系 | file-dependency / L3 | 工作树快照 |
| [01-overall-architecture/runtime-call-flow.md](./01-overall-architecture/runtime-call-flow.md) | 1 · 公共调用的三种形状与共同边界 | call-flow / L4 | 工作树快照 |
| [02-foundation/README.md](./02-foundation/README.md) | 1 · Foundation 物理保证的组合边界 | architecture / L5 | 工作树快照 |
| [02-foundation/admission-races-and-recovery.md](./02-foundation/admission-races-and-recovery.md) | 1 · 独占准入重观测正常竞争并保护未知残留 | recovery / L5 | 工作树快照 |
| [02-foundation/admission-races-and-recovery.md](./02-foundation/admission-races-and-recovery.md) | 2 · 准入许可的交接与异常释放边界 | recovery / L5 | 工作树快照 |
| [02-foundation/file-dependencies.md](./02-foundation/file-dependencies.md) | 1 · 稳定读取依赖 | file-dependency / L3 | 工作树快照 |
| [02-foundation/file-dependencies.md](./02-foundation/file-dependencies.md) | 2 · 文件原子发布依赖 | file-dependency / L3 | 工作树快照 |
| [02-foundation/file-publication-and-recovery.md](./02-foundation/file-publication-and-recovery.md) | 1 · 文件原子发布的两条提交路径 | recovery / L5 | 工作树快照 |
| [02-foundation/file-publication-and-recovery.md](./02-foundation/file-publication-and-recovery.md) | 2 · 暂存恢复必须证明范围与owner | recovery / L5 | 工作树快照 |
| [02-foundation/read-write-admission.md](./02-foundation/read-write-admission.md) | 1 · 共享与独占许可的准入顺序 | call-flow / L5 | 工作树快照 |
| [02-foundation/read-write-admission.md](./02-foundation/read-write-admission.md) | 2 · 锁 owner 的失活证据与精确退休 | call-flow / L5 | 工作树快照 |
| [02-foundation/runtime-call-flow.md](./02-foundation/runtime-call-flow.md) | 1 · 稳定文件读取的真实验证顺序 | call-flow / L5 | 工作树快照 |
| [02-foundation/tree-publication-and-recovery.md](./02-foundation/tree-publication-and-recovery.md) | 1 · 目录候选从计划到发布的实际调用 | recovery / L5 | 工作树快照 |
| [02-foundation/tree-publication-and-recovery.md](./02-foundation/tree-publication-and-recovery.md) | 2 · 加载树身份到迁移发布的分责 | recovery / L5 | 工作树快照 |
| [03-configuration-workspace/README.md](./03-configuration-workspace/README.md) | 1 · 工作区从维护请求到持久配置的责任分层 | architecture / L4 | 工作树快照 |
| [03-configuration-workspace/file-dependencies.md](./03-configuration-workspace/file-dependencies.md) | 1 · 工作区维护的直接导入边界 | file-dependency / L4 | 工作树快照 |
| [03-configuration-workspace/operation-scope-and-config-baseline.md](./03-configuration-workspace/operation-scope-and-config-baseline.md) | 1 · 工作区维护等待在途写者并在恢复前阻止新写者 | call-flow / L4 | 工作树快照 |
| [03-configuration-workspace/operation-scope-and-config-baseline.md](./03-configuration-workspace/operation-scope-and-config-baseline.md) | 2 · 窗口投影从当前配置和绑定锁内生成 | call-flow / L4 | 工作树快照 |
| [03-configuration-workspace/runtime-call-flow.md](./03-configuration-workspace/runtime-call-flow.md) | 1 · 维护公共入口按当前问题选择单轮工作 | call-flow / L4 | 工作树快照 |
| [03-configuration-workspace/runtime-call-flow.md](./03-configuration-workspace/runtime-call-flow.md) | 2 · 静态维护的检查点与前向恢复 | call-flow / L4 | 工作树快照 |
| [03-configuration-workspace/runtime-call-flow.md](./03-configuration-workspace/runtime-call-flow.md) | 3 · 配置条件替换按源事实与目标事实分支 | call-flow / L4 | 工作树快照 |
| [04-governance-event-sourcing/README.md](./04-governance-event-sourcing/README.md) | 1 · 首次创建的权威边界 | authority / L4 | 工作树快照 |
| [04-governance-event-sourcing/file-dependencies.md](./04-governance-event-sourcing/file-dependencies.md) | 1 · Demand 的精选直接导入 | file-dependency / L4 | 工作树快照 |
| [04-governance-event-sourcing/runtime-call-flow.md](./04-governance-event-sourcing/runtime-call-flow.md) | 1 · 追加命令的幂等与提交点 | call-flow / L4 | 工作树快照 |
| [04-governance-event-sourcing/runtime-call-flow.md](./04-governance-event-sourcing/runtime-call-flow.md) | 2 · 共享工作区作用域覆盖上下文与收尾 | call-flow / L4 | 工作树快照 |
| [04-governance-event-sourcing/state-and-recovery.md](./04-governance-event-sourcing/state-and-recovery.md) | 1 · 候选恢复先独占准入，再按当前摘要与发布锁结算 | recovery / L4 | 工作树快照 |
| [05-tasking-slice/README.md](./05-tasking-slice/README.md) | 1 · 实现任务和测试任务分别冻结什么 | vertical-slice / L4 | 工作树快照 |
| [05-tasking-slice/file-dependencies.md](./05-tasking-slice/file-dependencies.md) | 1 · 规划切片的精选直接导入 | file-dependency / L4 | 工作树快照 |
| [05-tasking-slice/runtime-call-flow.md](./05-tasking-slice/runtime-call-flow.md) | 1 · 规划请求的幂等优先调用 | call-flow / L4 | 工作树快照 |
| [06-implementation-delivery-review/README.md](./06-implementation-delivery-review/README.md) | 1 · 准备投递到记录宿主结局 | vertical-slice / L4 | 工作树快照 |
| [06-implementation-delivery-review/file-dependencies.md](./06-implementation-delivery-review/file-dependencies.md) | 1 · 投递切片的精选直接导入 | file-dependency / L4 | 工作树快照 |
| [06-implementation-delivery-review/runtime-call-flow.md](./06-implementation-delivery-review/runtime-call-flow.md) | 1 · 记录投递结局的优先级 | call-flow / L4 | 工作树快照 |
| [06-implementation-delivery-review/state-and-recovery.md](./06-implementation-delivery-review/state-and-recovery.md) | 1 · 拒绝发送后的有界恢复 | recovery / L4 | 工作树快照 |
| [07-review-rework-completion/README.md](./07-review-rework-completion/README.md) | 1 · 结果成为评审输入的真实边界 | vertical-slice / L4 | 工作树快照 |
| [07-review-rework-completion/callback-trust-and-review.md](./07-review-rework-completion/callback-trust-and-review.md) | 1 · 回调展示中的不可信数据边界 | vertical-slice / L5 | 工作树快照 |
| [07-review-rework-completion/callback-trust-and-review.md](./07-review-rework-completion/callback-trust-and-review.md) | 2 · 回调状态的派生优先级 | vertical-slice / L5 | 工作树快照 |
| [07-review-rework-completion/callback-trust-and-review.md](./07-review-rework-completion/callback-trust-and-review.md) | 3 · 只读评审检查的入口与停止点 | vertical-slice / L5 | 工作树快照 |
| [07-review-rework-completion/file-dependencies.md](./07-review-rework-completion/file-dependencies.md) | 1 · 评审与归档的精选直接导入 | file-dependency / L4 | 工作树快照 |
| [07-review-rework-completion/runtime-call-flow.md](./07-review-rework-completion/runtime-call-flow.md) | 1 · 同一结果的评审与恢复路径 | call-flow / L4 | 工作树快照 |
| [07-review-rework-completion/state-and-recovery.md](./07-review-rework-completion/state-and-recovery.md) | 1 · 终态事务的前向恢复 | recovery / L4 | 工作树快照 |
| [08-real-environment-testing/README.md](./08-real-environment-testing/README.md) | 1 · 冻结测试合同到独立评审 | vertical-slice / L4 | 工作树快照 |
| [08-real-environment-testing/file-dependencies.md](./08-real-environment-testing/file-dependencies.md) | 1 · 测试合同的精选直接导入 | file-dependency / L4 | 工作树快照 |
| [08-real-environment-testing/runtime-call-flow.md](./08-real-environment-testing/runtime-call-flow.md) | 1 · 失败分类决定允许动作 | call-flow / L4 | 工作树快照 |
| [09-public-mcp-host-seams/README.md](./09-public-mcp-host-seams/README.md) | 1 · 公共协议与两个宿主的责任边界 | architecture / L4 | 工作树快照 |
| [09-public-mcp-host-seams/file-dependencies.md](./09-public-mcp-host-seams/file-dependencies.md) | 1 · MCP 固定装配与 hook 入口的直接导入 | file-dependency / L4 | 工作树快照 |
| [09-public-mcp-host-seams/host-effect-handshake.md](./09-public-mcp-host-seams/host-effect-handshake.md) | 1 · Hook 从宿主事件到工作区观察的准入路径 | vertical-slice / L4 | 工作树快照 |
| [09-public-mcp-host-seams/host-effect-handshake.md](./09-public-mcp-host-seams/host-effect-handshake.md) | 2 · Claude 一次投递的发送与落地证据分离 | vertical-slice / L4 | 工作树快照 |
| [09-public-mcp-host-seams/host-effect-handshake.md](./09-public-mcp-host-seams/host-effect-handshake.md) | 3 · Claude 会话启动与续接的分支边界 | vertical-slice / L4 | 工作树快照 |
| [09-public-mcp-host-seams/project-chats-and-execution-roots.md](./09-public-mcp-host-seams/project-chats-and-execution-roots.md) | 1 · 固定宿主注入纯启动说明端口 | vertical-slice / L4 | 工作树快照 |
| [09-public-mcp-host-seams/project-chats-and-execution-roots.md](./09-public-mcp-host-seams/project-chats-and-execution-roots.md) | 2 · Codex角色聊天与产品检出的独立核验 | vertical-slice / L4 | 工作树快照 |
| [09-public-mcp-host-seams/runtime-call-flow.md](./09-public-mcp-host-seams/runtime-call-flow.md) | 1 · 公共 MCP 从注册到请求结果的真实调用 | call-flow / L4 | 工作树快照 |
| [10-end-to-end-business-flow/README.md](./10-end-to-end-business-flow/README.md) | 1 · 用户与四类窗口的成功主线 | vertical-slice / L4 | 工作树快照 |
| [10-end-to-end-business-flow/state-and-recovery.md](./10-end-to-end-business-flow/state-and-recovery.md) | 1 · Demand 终态与续接的持久关系 | recovery / L4 | 工作树快照 |
| [11-kernel/README.md](./11-kernel/README.md) | 1 · 公共命令的实际调用边界 | vertical-slice / L5 | 工作树快照 |
| [11-kernel/file-dependencies.md](./11-kernel/file-dependencies.md) | 1 · 内核：两种外壳与证据机制的静态依赖 | file-dependency / L3 | 工作树快照 |
| [11-kernel/hook-history.md](./11-kernel/hook-history.md) | 1 · 写入：旧记录就地重放，新记录进入分片 | recovery / L5 | 工作树快照 |
| [11-kernel/hook-history.md](./11-kernel/hook-history.md) | 2 · 读取：完整扫描与有限返回分开 | recovery / L5 | 工作树快照 |
| [11-kernel/privacy-boundary.md](./11-kernel/privacy-boundary.md) | 1 · 扫描视图与原始位置：不改写被审阅文本 | symbol-call / L5 | 工作树快照 |
| [11-kernel/privacy-boundary.md](./11-kernel/privacy-boundary.md) | 2 · 绝对路径白名单：词法包含关系与格式分支 | symbol-call / L5 | 工作树快照 |
| [11-kernel/runtime-call-flow.md](./11-kernel/runtime-call-flow.md) | 1 · 追加形状：稳定身份交给真正提交者 | call-flow / L5 | 工作树快照 |
| [11-kernel/runtime-call-flow.md](./11-kernel/runtime-call-flow.md) | 2 · 效果形状：模式准入与计划重算 | call-flow / L5 | 工作树快照 |
| [11-kernel/workspace-operation-scope.md](./11-kernel/workspace-operation-scope.md) | 1 · 普通写者先获许可，读调用与维护分别分流 | call-flow / L5 | 工作树快照 |
| [11-kernel/workspace-operation-scope.md](./11-kernel/workspace-operation-scope.md) | 2 · 嵌套调用：借用有效能力，不升格也不越根 | call-flow / L5 | 工作树快照 |
| [12-endpoint/README.md](./12-endpoint/README.md) | 1 · 一次绑定调用：身份事实、决定、提交与投影 | vertical-slice / L5 | 工作树快照 |
| [12-endpoint/execution-roots.md](./12-endpoint/execution-roots.md) | 1 · 从SessionStart到已核实的产品检出 | call-flow / L5 | 工作树快照 |
| [12-endpoint/file-dependencies.md](./12-endpoint/file-dependencies.md) | 1 · 端点：命令、决定与私有记录的静态依赖 | file-dependency / L3 | 工作树快照 |
| [12-endpoint/runtime-call-flow.md](./12-endpoint/runtime-call-flow.md) | 1 · 登记、换代、迁移的运行分支 | call-flow / L5 | 工作树快照 |
| [12-endpoint/runtime-call-flow.md](./12-endpoint/runtime-call-flow.md) | 2 · 关闭与工作声明释放分支 | call-flow / L5 | 工作树快照 |
| [13-requirement/README.md](./13-requirement/README.md) | 1 · 发布纵切：可确认内容到不可变交接物 | vertical-slice / L5 | 工作树快照 |
| [13-requirement/file-dependencies.md](./13-requirement/file-dependencies.md) | 1 · 需求包：发布、看板与Ledger的静态依赖 | file-dependency / L3 | 工作树快照 |
| [13-requirement/privacy-preview.md](./13-requirement/privacy-preview.md) | 1 · 需求文本的隐私准入与独立披露判定 | symbol-call / L5 | 工作树快照 |
| [13-requirement/runtime-call-flow.md](./13-requirement/runtime-call-flow.md) | 1 · 需求板的耐久状态转换 | recovery / L5 | 工作树快照 |
| [13-requirement/runtime-call-flow.md](./13-requirement/runtime-call-flow.md) | 2 · Ledger实际发布调用与故障停止点 | recovery / L5 | 工作树快照 |
| [13-requirement/runtime-call-flow.md](./13-requirement/runtime-call-flow.md) | 3 · recover：由真实残留决定继续或等待 | recovery / L5 | 工作树快照 |
| [14-evidence/README.md](./14-evidence/README.md) | 1 · 捕获主线：选择、零写观察、内容门、发布 | vertical-slice / L5 | 工作树快照 |
| [14-evidence/file-dependencies.md](./14-evidence/file-dependencies.md) | 1 · 证据：捕获、发布与读取的静态依赖 | file-dependency / L3 | 工作树快照 |
| [14-evidence/privacy-and-source-consistency.md](./14-evidence/privacy-and-source-consistency.md) | 1 · 内容门：可解码文本、opaque 与凭证分别判断 | symbol-call / L5 | 工作树快照 |
| [14-evidence/privacy-and-source-consistency.md](./14-evidence/privacy-and-source-consistency.md) | 2 · 捕获到应用：各阶段分别绑定来源与摘要 | symbol-call / L5 | 工作树快照 |
| [14-evidence/runtime-call-flow.md](./14-evidence/runtime-call-flow.md) | 1 · 真实发布调用：Event是不可逆边界 | recovery / L5 | 工作树快照 |
| [14-evidence/runtime-call-flow.md](./14-evidence/runtime-call-flow.md) | 2 · 恢复分支：日志、commit与物理清单 | recovery / L5 | 工作树快照 |
| [14-evidence/runtime-call-flow.md](./14-evidence/runtime-call-flow.md) | 3 · 读取深度：元数据、成员、完整树 | recovery / L5 | 工作树快照 |
| [15-pod/README.md](./15-pod/README.md) | 1 · Pod创建的真实调用链 | vertical-slice / L5 | 工作树快照 |
| [15-pod/file-dependencies.md](./15-pod/file-dependencies.md) | 1 · Pod：配置事务、执行回执与短锁的静态依赖 | file-dependency / L3 | 工作树快照 |
| [15-pod/runtime-call-flow.md](./15-pod/runtime-call-flow.md) | 1 · 执行环境状态的纯派生 | state / L5 | 工作树快照 |
| [15-pod/runtime-call-flow.md](./15-pod/runtime-call-flow.md) | 2 · 两段关闭与并发复验 | state / L5 | 工作树快照 |
| [16-observation/README.md](./16-observation/README.md) | 1 · 一次观察，多种只读输出 | vertical-slice / L5 | 工作树快照 |
| [16-observation/file-dependencies.md](./16-observation/file-dependencies.md) | 1 · Observation：读取、纯判断与独立刷新依赖 | file-dependency / L3 | 工作树快照 |
| [16-observation/projection-recovery.md](./16-observation/projection-recovery.md) | 1 · 刷新调用：先提交权威，再锁内观察和发布 | recovery / L5 | 工作树快照 |
| [16-observation/projection-recovery.md](./16-observation/projection-recovery.md) | 2 · 页面退休与崩溃恢复：不能从缺项推导删除 | recovery / L5 | 工作树快照 |
| [16-observation/runtime-call-flow.md](./16-observation/runtime-call-flow.md) | 1 · 分域读取：完整性与局部失败 | call-flow / L5 | 工作树快照 |
| [16-observation/runtime-call-flow.md](./16-observation/runtime-call-flow.md) | 2 · 制品身份分支：服务证据与未验证窗口 | call-flow / L5 | 工作树快照 |
| [16-observation/runtime-evidence.md](./16-observation/runtime-evidence.md) | 1 · 三种证据分别流向公开字段 | authority / L5 | 工作树快照 |
| [17-artifacts-and-contracts/README.md](./17-artifacts-and-contracts/README.md) | 1 · 源码按真实闭包生成双宿主插件与文件清单 | architecture / L4 | 工作树快照 |
| [17-artifacts-and-contracts/file-dependencies.md](./17-artifacts-and-contracts/file-dependencies.md) | 1 · 制品构建与检查工具的静态文件依赖 | file-dependency / L4 | 工作树快照 |
| [17-artifacts-and-contracts/installation-and-runtime-identity.md](./17-artifacts-and-contracts/installation-and-runtime-identity.md) | 1 · 安装预检拒绝同版本不同字节 | call-flow / L5 | 工作树快照 |
| [17-artifacts-and-contracts/installation-and-runtime-identity.md](./17-artifacts-and-contracts/installation-and-runtime-identity.md) | 2 · 运行进程在变更分派前检查自身制品清单 | call-flow / L5 | 工作树快照 |
| [17-artifacts-and-contracts/schema-and-validation.md](./17-artifacts-and-contracts/schema-and-validation.md) | 1 · Schema 严格准入后生成合同并独立核验漂移 | call-flow / L4 | 工作树快照 |

[逐文件审阅索引](./02-file-review-index.md) · [绘图标准](./00-agentic-diagram-standard.md) · [当前覆盖报告](../plans/review-2026-10-03-rc4/review-coverage.json)。
