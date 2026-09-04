# ADR-0005 Demand 事件流读路径与快照策略

> 状态：`accepted`
> 提出日期：2026-09-03
> 裁决日期：2026-09-03，用户确认采用建议方案（选项 A 立即执行，选项 C 随 Archive 能力落地）
> 回写：plan §3 新增 TSD-14；§8.1 P2 范围与退出门；硬墙与快照刷新失败语义列入 §8.1 P0 待核实事项；资源处理标准的 derived-checkpoint 说明补充刷新时机。代码改动在 P2 执行
> 基线提交：`c0098e2`
> 相关：[reviews/2026-09-03 评估 A4 与 C4](../reviews/2026-09-03-typescript-checkpoint-review.md)、`src/governance/demand/event-sourcing/`、`src/governance/demand/demand-operation-authority-context.ts`

## 背景

以下事实在 `c0098e2` 上通过读码与 grep 核实：

- `repository.publishSnapshot` 在生产代码中只有一个调用点，位于 `demand-event-sourcing-publication-stage.ts`，即首次发布后的 commit #1。此后没有任何路径刷新快照。
- `openDemandOperationAuthorityContext` 固定 `audit: true`，走 `repository.audit()` 从 commit 1 全量重放；19 个文件使用它。`openDemandReadAuthorityContext` 走快照加尾部，只有 2 个文件使用。
- 一次 `TargetTaskPlanningService.apply` 读 5 遍完整事件流：`findCommitById` 两次、authority context 的 audit、command handler 的 `load`、append 前的 `assertDemandFileEventAppendAdmission`。
- 一次 append 约 600 加 50N 次系统调用、6 次 fsync、约 2N 次 canonical 渲染和 N 次 SHA-256，N 为已有 commit 数。事件存储本身不加独占锁，跨进程互斥依赖固定槽位 `commits/NNNN.json` 上 `link(2)` 的 EEXIST。
- 每次聚合转换对整个状态至少做 4 次 `parseDemandAggregateState`，每次含 6 份子 schema 的运行时校验；`prepareDemandEventStreamCommit` 把同一 commit evolve 两遍。
- 上限 `DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMITS = 10_000`，达到后 `fail("capacity")`，该 Demand 永久不可写。

全量 TS 测试门 1,023 项墙钟 6 分 07 秒，78 项单个超过 10 秒，最慢 48 秒，集中在治理纵切。

外部参照：Kurrent 关于快照的指南建议把快照当作战术优化并优先缩短流的生命周期；Oskar Dudycz 的幂等命令处理建议用可预测的命令标识让重试自然命中。

## 问题

读路径的 O(n) 是否可以接受；快照是缓存还是应当被删除；流的生命周期如何结束。

## 选项

### 选项 A：快照刷新、默认读上下文、单次加载

每次 apply 成功后刷新快照为可重建缓存；operation 上下文默认走快照加尾部，`audit: true` 只保留给 verify 类入口；一次命令内加载一次并把结果传给后续步骤。同时把聚合转换的解析收敛到边界一次，commit 准备不再双重 evolve。

### 选项 B：保持全量 audit，降低单次成本

不引入快照刷新，改为减少每次读取的复验与渲染次数。代价：仍是 O(n)，只是常数变小。

### 选项 C：封流归档

Demand 完成后把事件流封存到归档树，活动区只保留终态投影。这缩短了流的生命周期，与快照策略互补。它依赖 Archive 能力，而该能力尚未实现。

## 建议

选项 A 立即执行，选项 C 随 Archive 能力一起在后续阶段落地。目标：一次写命令只读一次事件流；100 个 commit 下 append 低于 50 毫秒；治理测试墙钟下降一半。

## 后果

接受后需要修改：

- `demand-event-sourcing-repository.ts` 的 `load` 与 `publishSnapshot` 调用点；`demand-operation-authority-context.ts` 的默认 audit 值及其 19 个调用方。
- 各 service 的 apply 路径改为单次加载复用；`demand-event-stream-commit.ts` 去掉双重 evolve。
- `demand-file-event-store.ts` 的进程内追加队列改为进程级并写明 worker thread 语义。
- `demand-file-event-store-reader.ts` 补直接测试，覆盖 admission、identity conflict 与 capacity。
- commitId 统一由命令内容派生，删除 6 份 `uuidFrom` 复制并修正 eventId 与 commitId 的前缀交换。
- 开发计划 §13 E2 行记录快照策略；[standards/resource-handling-standard.md](../standards/resource-handling-standard.md) 的 derived-checkpoint 角色说明补充刷新时机。

## 未决问题

- 10,000 commit 的硬墙是保留还是改为触发封流归档。
- 快照刷新失败是否阻塞 apply 成功；建议不阻塞，因为快照是可重建缓存。
