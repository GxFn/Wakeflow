# 2026-10-03 Demand、投递与评审增量复核

本轮只修改架构图谱。以 `source-baseline.json` 相对上次已核验字节的变化为准，重新审阅 **13 个手写生产文件，共 14,321 行**；未变化文件继承上轮语义记录，并复核本次涉及的调用方、消费者和关键断言。生产代码、测试、Schema、插件制品保持只读。提交基线仍为 `d8fafff33919c728e3a9b91ec04aa50ec5e07f0c`，当前事实包含未提交实现。

[逐文件记录](./demand-delivery-files.json) 保存 SHA、分支、效果、消费者、真实测试锚点和变化结论。大文件使用 SWC 去除类型与注释后的完整运行时函数体辅助阅读，没有省略分支；新增类型接口、原始差异和证据定位另按 TypeScript 原文核对。符号关联和已读断言不等于全部测试文件逐行审阅，也不代替本轮测试运行。

## 三项旧发现的闭环

| 旧编号 | 当前实现 | 生产者与消费者 | 已读的回归证据 |
| --- | --- | --- | --- |
| DD-F01 混合失败修复授权冲突 | 已修复。仅 product-defect fail 可进入新授权，且映射必须覆盖该类全部失败；其他 fail 保留在原报告。 | `src/capabilities/result-review/decide.ts#escalateBlockers` 限定集合；`src/capabilities/result-review/service.ts#remediationAuthorization` 同样筛选；授权 codec 保持集合一致约束；仓储按持久决定的映射核对原报告。 | `tests/capabilities/result-review/mixed-failure-remediation.test.ts#executeTestReviewDecisionRequest`：flaky、harness-defect、missing-evidence、environment 四种组合；检查授权只含产品步骤、原失败保留及同键回放。 |
| DD-F02 research 无 document 无法取消 | 已修复。cancel 豁免 research-evidence；complete 仍要求研究成果。 | `src/capabilities/demand/decide.ts#gateBlockers` 加入取消豁免；`src/capabilities/demand/lifecycle.ts#planTerminal` 仍保存实际 fail 门并走原归档事务。 | `tests/governance/demand/demand-research-completion.test.ts#executeDemandCancellationRequest`：complete blocked、cancel ready且verify仍fail、归档withdrawn、删活动根、recover相同摘要。 |
| DD-F03 awaitingDecision 取消归约失败 | 已修复。cancel 先移除活动等待，再验证 cancelled；不记录用户回答。 | `src/governance/demand/model/demand-aggregate-state.ts#cancelDemandAggregateState` 结束等待；事件历史和归档仍由原生命周期事务保存。 | `tests/governance/demand/demand-aggregate-state.test.ts#cancelDemandAggregateState` 核目标摘要保留与重复取消拒绝；`tests/capabilities/demand/service.test.ts#executeDemandCancellationRequest` 核追加前/终态后中断恢复、旧提交字节、升级记录与空decisionRecords。 |

DD-F01 的 flaky 回归继续走公共切片：生成修复投递 → 导入实现结果 → 接受修复 → 规划新 retest → 再次 flaky 导致 accept 拒绝 → 对剩余失败进行 rerun → test-accepted → completion preview ready。新 retest 的 initial 尝试仍跑全合同，失败不能当作旧 pass 基线。其他三种混合分类覆盖授权及原报告保留，不冒称每种分类都完成同样的后续环境流程。

授权 wire 仍是 v1。仓储 `DemandEventSourcingRepository.auditTargetResultHistoryOfCommits` 以**持久决定实际映射的步骤集合**筛选原报告 fail，而不是重新把所有 fail 都加入授权。这样新的窄集合闭合；旧 v1 中已明确映射全失败的合法授权仍按其原决定审计。这是读取兼容，不是允许新公共请求绕过产品分类门。

原始失败复现保留在 [2026-10-02 记录](../review-2026-10-02/demand-delivery-findings-repro.json)，仅证明当时工作树的缺陷。不能重用那份失败输出宣称当前版本仍失败，也不能将三个修复扩展为“没有其他缺陷”。

## 共享作用域、取消和并发

- `runAppendCommand` 固定进入 workspace shared scope。Tasking、Delivery、Result-review 的公开追加入口现在把 `signal` 传给 command shell；准入发生在业务上下文读取前，范围包含领域执行、next、输出边界和上下文关闭。
- Demand 创建/终态/继续的 `runPublicationTransaction` 声明 `mutationScope=shared`；preview 为 read。共享 scope 保持配置/维护边界，Pod 短锁、事件追加锁、修订检查和看板 CAS 仍分别负责自身竞争。
- review inspect 显式为 read，不获取写入租约。read 不是 foundation 读写锁的 shared 模式，二者不能混称。
- workspace scope 校验当前协议、维护门与未结算维护事务；嵌套只能借用相同根且不能从 shared 提升为 exclusive，也不能在回调结束后逃逸使用。
- 结果 import 的 `releaseFence` 在事件已提交或幂等回放后不再传原请求 signal；它只清理仍匹配的声明。其他下一步观察或日志收尾仍可能失败，需要同键回放或专用 recover；不作跨资源回滚承诺。

工作区层的对应证据是 `tests/kernel/workspace-operation-scope.test.ts#withWorkspaceOperationScope`、`tests/capabilities/workspace/operation-scope.test.ts#refreshActiveProjection` 与 `tests/kernel/publication-transaction.test.ts#runPublicationTransaction`。共享边界包含维护等待、未完成维护保留与禁止提升/跨根/逃逸；并非每个能力切片和每个取消点都已单独覆盖。

## 项目聊天与投递执行路径

`sendReturnProvesLanding` 的 Profile 判别更新为 `project-thread`，保持 Codex 成功发送回执可证明落地的语义。它没有将 “project-thread 已创建” 自动视为 “业务结果已接受”。Claude 仍使用目标会话 hook 观察证明落地。

`renderPrompt` 优先使用已绑定的 `worktreePath`，否则使用配置的窗口 placement，并输出相对 workspace 的 `executionRootFromWorkspace`。阅读顺序、需求成员和工作区规则仍从执行根反向解析；prompt 明示显式 command workdir，聊天初始 cwd 可以不同。`tests/capabilities/delivery/prompt.test.ts#renderDeliveryPortablePrompt` 覆盖普通目录和 worktree 的中英文提示；它不证明真实聊天创建或 shell 自动切目录。

投递与评审读取当前绑定 session 的事件、摘要和时间；hook 的 artifactManifestDigest 属于观察器生产者，不成为目标 MCP 运行身份。公共 Observation v2 另行报告 observerManifestDigest 和未验证的目标 runtime，见宿主/观察专题；本报告没有将该元数据用于放宽落地或接受守卫。

## 图谱变更与验证边界

已更新 04–08 的 18 份图文和 10 的状态页，另更新当前发现台账：共享准入新增独立调用图；任务规划入口补 scope；投递说明 project-thread 与执行根；评审明确 read/shared 与提交后声明释放；取消停止分支改为已实现路径；测试说明授权集合与保留失败。静态导入、运行调用、状态/恢复仍分开表达。

本代理未重编译、重建制品或运行完整生产测试，避免与主代理统一验证冲突。本轮执行结果由主代理汇总；本报告的“已修复”依据实际源码生产者/消费者及新增回归断言，不依据另一个线程自述。临时 fixture 与受控 I/O 中断不能冒充真实登录宿主、真实产品环境或所有边界的进程崩溃证明。

[创建与事件](../../maps/04-governance-event-sourcing/README.md) · [投递与执行目录](../../maps/06-implementation-delivery-review/README.md) · [取消与归档](../../maps/07-review-rework-completion/state-and-recovery.md) · [混合失败闭环](../../maps/08-real-environment-testing/runtime-call-flow.md)。
