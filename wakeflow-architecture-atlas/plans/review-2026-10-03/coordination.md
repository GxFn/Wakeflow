# Kernel、端点、需求、证据、Pod与观察：2026-10-03增量复核

本轮比较的是2026-10-02已经审阅的字节与当前工作树，不把整个 `git diff HEAD` 当成本轮增量。提交基线仍为 `d8fafff33919c728e3a9b91ec04aa50ec5e07f0c`，代码含未提交修复。归属范围内共17个变更/新增手写文件，9,577行原始TypeScript，均重读完整运行体；大文件通过SWC去类型和注释展示全部分支，相关类型合同另行读取。SHA、职责、分支、效果、真实直接消费者与测试使用点见[逐文件记录](./coordination-files.json)。未变文件沿用[前轮全量审阅](../review-2026-10-02/coordination-evidence.md)，旧记录保持原样。

## 已确认的实现变化

| 变化 | 当前事实 | 图谱入口 |
| --- | --- | --- |
| 写操作统一准入 | 公共shell先取得shared/exclusive再打开上下文，直到主体、结果准入与close完成才退出；读操作及preview不写租约 | [工作区范围](../../maps/11-kernel/workspace-operation-scope.md) |
| 维护预留持续有效 | 活动gate阻挡新writer；非active（失活或无法确认）gate或transactions任意条目要求恢复，即使进程及租约消失也不能跳过intent/journal | [工作区范围](../../maps/11-kernel/workspace-operation-scope.md) |
| 嵌套能力有界 | 同一AsyncLocalStorage链借用同根有效范围；禁止shared升exclusive、跨工作区、回调结束后复用；RootedDirectory在await前后复验 | [工作区范围](../../maps/11-kernel/workspace-operation-scope.md) |
| 投影不携旧配置跨锁 | shared包住刷新；Config快照、Ledger打开、observe/render全部在publisher锁内；维护要等在途shared退出 | [投影刷新与恢复](../../maps/16-observation/projection-recovery.md) |
| Codex项目会话根独立 | project-thread的所有角色SessionStart要求项目根；角色executionRoot另给；worktree必须独立报绝对执行根，再验证Git身份 | [端点执行根](../../maps/12-endpoint/execution-roots.md) |
| Pod配置变更独占 | Pod apply/recover均exclusive；apply内部仍有按Pod短锁和二次计划复验。跨Pod的普通Demand创建可并行，不意味着Pod配置变更可绕过workspace独占 | [Pod状态与关闭](../../maps/15-pod/runtime-call-flow.md) |
| 宿主差异交还profile/adapter | endpoint只接收renderLaunchInstructions；检出处置引导按profile.worktree.launch选择，不按hostId猜测 | [端点总览](../../maps/12-endpoint/README.md) |
| Observation结果v2 | 当前服务制品、hook观察器制品、窗口目标运行身份分开。删除窗口artifact current/stale；绑定窗口runtime为unverified | [运行身份证据](../../maps/16-observation/runtime-evidence.md) |

需求与证据公开apply/recover新增shared准入；不可变Ledger发布、看板CAS、证据Event不可逆边界和单独的领域恢复机制没有被新scope替代。两组图保留原分支，并明确加入准入层。

## 运行身份的准确判断

`src/governance/observation/workspace-observation.ts#observeHostHooks`按recordedAt、event、recordId稳定选最近记录，只将hook的 `artifactManifestDigest` 映射为 `observerManifestDigest`。它描述写观察记录的程序，不能证明绑定窗口使用的MCP进程，更不能证明宿主已加载哪份指令上下文。

`src/capabilities/observation/service.ts#windowViews`将已绑定窗口明确输出为 `runtime.status: unverified`、原因 `host-runtime-association-unavailable`。无绑定且绑定域可读为 `unregistered`；绑定域不可读为 `unverified/binding-unavailable`。`runtime-artifact`门独立比较当前服务adapter启动与磁盘摘要：不一致fail；任一摘要缺失或任一绑定窗口无实例关联证据unavailable；只有无adapter且无绑定窗口时not-applicable。窗口投影current仍只说明磁盘材料可重算一致，不说明会话读过材料。

status的nextActions删除“窗口制品过期”自动建议；verify若只有peer runtime缺证据，返回Controller负责且suggestedTool为null，不伪造可执行的修复API。若还存在可修工作区问题，维护建议处理那些门；缺manifest和服务换版仍优先交用户处理。

## Pod与会话证据

`sessionRootMatcher`首先依据profile的project-thread能力处理：项目根hook可证明会话归属，不能隐式挑选产品检出。`admitWorktree`因此要求项目聊天的worktree观察带绝对 `executionRoot`；其他宿主使用已匹配的session cwd，并拒绝额外executionRoot。随后 `admitPodWorktreeObservation`核对非主检出、commonDir归属、.git/admin双向指针和HEAD关系；同宿主另一Pod已登记同路径则拒绝。

该机制不验证Git祖先图、工作区清洁或持续cwd。分支HEAD按引用文本检查，detached按OID检查。后续 `worktreeCheckoutPresent`只检查目录与.git文件存在。回执不会因Codex聊天归档而自动证明检出已删；实际Git检出处置仍由操作者完成，Wakeflow只退休自身记录。

## 协议与仍有的边界

- 当前配置协议为v2。writer遇旧协议返回 `writer-protocol-unsupported`；维护预览对旧配置阻塞，不静默升级。与hook v1旧记录可选字段重放是两个不同合同，不能混为“全系统兼容”。
- read/preview无writer租约；一次分域观察不是跨目录原子快照。Config或Ledger入口打开失败仍整体拒绝，不能宣称任何失败都能局部降级。
- workspace scope只保护正确进入它的调用链。公共入口覆盖不能证明所有被直接调用的内部owner已自动持scope；各owner的CAS、精确unlink和事务回读仍需独立成立。
- recoverPod仍只做回执对账，虽然新增外层exclusive，但没有变成Config事务恢复器，也不调用afterMutationRefresh。业务与投影恢复不可画成一个总状态机。
- `afterMutationRefresh`只保证mutate已成功返回时投影取消不否定该结果；公共工具之后的next/回读仍可失败，不扩大成全工具提交后永不报错。
- 真实宿主目标MCP实例/指令上下文关联仍没有生产者；unverified是诚实保留的缺口，不是已修复成可验证，也不是证明窗口过期。

本范围未新增经独立复现的产品缺陷；上面限制按真实代码标注，不擅自修改生产实现。

## 图谱更新与验证责任

更新11–16模块的20份现有图文，新增workspace-operation-scope、execution-roots、runtime-evidence三页；修正Observation旧artifactStateOf/staleArtifactWindowIds边、Config/Ledger在投影锁外的旧说明、Pod跨范围并发说明。每图继续使用中文accTitle/accDescr、相邻术语、数字证据边与真实源码/测试锚点。指纹在内容修正并核对来源后重算。

已静态核对聚焦测试中的真实断言与符号：

- `tests/kernel/workspace-operation-scope.test.ts#withWorkspaceOperationScope`：升格、跨根、回调结束后逃逸借用、intent残留保留。
- `tests/capabilities/workspace/operation-scope.test.ts#executeCodexWakeflowMaintenance`：维护等待在途投影、旧协议拒绝、被打断维护保留writer预留直到公开recover。
- `tests/capabilities/endpoint/service.test.ts#executeWindowBindingRequest`：所有项目角色在同一程序根启动，角色子目录hook拒绝。
- `tests/capabilities/pod/service.test.ts#executeWindowBindingRequest`：project-root hook不能省略executionRoot、相对根拒绝、主检出拒绝、Git检出登记与竞争占用。
- `tests/kernel/pod-worktree-receipts.test.ts#admitPodWorktreeObservation`：真实临时Git仓库的common-dir、双向指针、HEAD与detached关系。
- `tests/capabilities/observation/service.test.ts#executeStatusRequest`与 `tests/capabilities/observation/service.test.ts#executeVerifyRequest`：观察器摘要同版/异版均不将窗口标current或stale，服务换版独立诊断。
- `tests/capabilities/observation/decide.test.ts#deriveWorkspaceGates`与 `tests/capabilities/observation/decide.test.ts#verifyNext`：服务和peer事实分别判定，十五门与公共描述同步。

本子任务没有运行根npm test、编译或制品构建，避免与主线验证相互干扰；运行结果由本轮汇总验证记录说明。存在间接覆盖或缺独立用例的边在图表中明示，不能把一个AST锚点当作测试已通过。
