# ADR-0011 需求包作为唯一交接物

> 状态：`accepted`
> 提出日期：2026-09-04
> 裁决日期：2026-09-04。用户指出需求入口不顺畅，并确认：取消确认记录与 TODO 摄入，需求包成为唯一交接物；两份文档加必需章节取代六个角色文件；任务清单默认由 Controller 自主。用户同时纠正两点：pod 不进入需求入口的词汇，pod 只是用户要求开启的一套并行开发环境；同一子窗口接受多个任务沿用任务包逻辑
> 基线提交：`c0098e2`
> 相关：[能力卡 3](../requirements/capabilities/03-requirement-entry-and-todo.md)、[能力卡 4](../requirements/capabilities/04-demand-lifecycle.md)、[能力卡 5](../requirements/capabilities/05-task-planning.md)、[ADR-0010](./0010-worktree-isolated-execution-and-converged-flow.md)、[功能与场景总览](../requirements/wakeflow-functions-and-scenarios.md)

## 背景

开工前有三件交接物叠在一起：ledger 需求记录、TODO 摄入行、确认记录，然后才是 Demand。它们来自旧版本不同时期：需求记录是权威载体，TODO 行是认领队列，确认记录为隔离执行位置授权。ADR-0010 之后确认记录的授权用途消失，并发由 pod 承担，"总控领取一组任务"的前提也不成立。用户的原始设计是"TODO 列多个任务，总控领取一组"，实际经验是总控在自动化执行中一次只处理一项才可控。

## 研究复核

| 来源 | 结论 | 影响 |
| --- | --- | --- |
| GitHub Spec Kit | specify 写 what 与 why，plan 写 how，tasks 由工具生成，人的检查点在任务生成后；需求不写技术栈 | 需求包分成"需求"与"落地"两份文档；任务由 Controller 拆 |
| Amazon Kiro specs | requirements.md、design.md、tasks.md 三件；按阶段推进；任务按依赖分波执行 | 同上；任务依赖已在任务包的 `dependsOnTargetTaskIds` |
| Anthropic《Building effective agents》 | 明确任务用固定工作流，一次一个；在检查点暂停等人 | 一个总控一次一个 Demand；两个确认点 |

## 决定

### D1 需求包是唯一交接物

需求包 = ledger 里一条不可变记录（`requirement.md`、`landing.md`、可选附件）加板上一行认领状态。`publish_requirement` 一次调用完成记录写入与上板；板是"已发布未认领需求包"的投影加认领状态，状态词汇 `pending | parked | claimed | withdrawn | archived`。

### D2 取消确认记录与 TODO 摄入

ledger 的 confirmation family 删除；`publish_confirmation` 与 `intake_todo` 删除；`inspect_todo` 改为列出待认领需求包的只读查询（名称在 L1 定）。执行中途的目标变更走补充需求，即带 `supersedes` 的新需求包。

### D3 两份文档加必需章节

| demandType | requirement.md 必需章节 | landing.md 必需章节 |
| --- | --- | --- |
| requirement | 目标、完成定义、非目标、验收标准、用户确认 | 已核实的代码事实、落地方案与影响范围、测试决策 |
| bug | 复现、范围、非目标、用户确认 | 代码事实、修复方案、测试决策 |
| supplement | 需求增量、完成定义、用户确认 | 代码事实、落地方案、测试决策 |
| research | 研究问题、边界、用户确认 | 已知事实、方法 |

章节缺失在 preview 报出。Demand 权威与任务包引用改为"记录摘要加章节锚点"；记录不可变，所以够用。intake 字段（类型、优先级、测试决策、来源窗口）进入记录的头部元数据。

### D4 两个确认点

- 确认点 1：发布前 preview 给用户一页摘要（目标、完成定义、非目标、测试决策、范围），用户确认后 apply；确认内容与时间写进 requirement.md 的用户确认节，发布计划带其摘要。
- 确认点 2：任务包清单默认由 Controller 自主；需求包头部可标 `taskPlanReview: user`，此时 Controller 在投递前把任务清单交用户过目。

### D5 一个总控一次只推进一个 Demand

取消"领取一组"与 `autoClaim`。板按优先级排序供 Controller 挑选；Controller 空闲时 route 提示待认领数量。并行由用户要求开启 pod（ADR-0010），pod 是一套完整的并行开发环境，不进入需求入口的词汇；Demand 身份仍记执行环境以定位 worktree 与投递目标。

### D6 同一子窗口的多个任务沿用任务包逻辑

一个 Demand 由 Controller 拆成多个任务包：同一产品窗口的多个任务按谱系串行，即继续或替换（能力卡 5）；不同窗口的任务用派发组并行。不引入需求级的任务组。

### D7 认领即创建

`create_demand(requirementId)`：根先建后认领，权威从需求包单源收敛；总控已有活动 Demand 时拒绝。

## 后果

- 能力卡 3：Q1 改为"Design 调 `publish_requirement`，无确认记录"；Q2 作废；Q4 状态词汇保留但主体改为需求包；3.1 到 3.3 的角色文件表由 D3 取代。
- 能力卡 4：创建输入改为 `{requirementId, demand}`。
- 能力卡 5：任务包 `selectedAuthorityMemberRefs` 改为记录摘要加章节锚点；`confirmedContext` 引用 landing.md 章节。
- 能力映射矩阵：`wakeflow_next_work` 与 `wakeflow_claim_next` 行改指向板查询与 `create_demand`；TS 现有 `intake_todo`、`publish_confirmation` 在 L1 删除重写。
- 场景验收：`card-04/create-demand` 在 L1 按需求包重塑；现有骨架按当前 TS 代码运行到重塑为止。
- 功能与场景总览 §2、§3、§4 F4、§7 同步。

## 来源

- GitHub Spec Kit. https://github.com/github/spec-kit
- Kiro Specs. https://kiro.dev/docs/specs/
- Anthropic, Building effective agents. https://www.anthropic.com/engineering/building-effective-agents
