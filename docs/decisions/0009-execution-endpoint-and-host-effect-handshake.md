# ADR-0009 执行端点与宿主效果握手的统一模型

> 状态：`accepted`。用户于 2026-09-04 先行确认四点；同日确认"研究复核后的调整"两项（宿主 hook 作为第二条证据通道；Codex 证据策略上调），按建议采纳
> 提出日期：2026-09-04
> 基线提交：`c0098e2`
> 相关：[ADR-0003 修订](./0003-host-effect-layer-ownership.md)、[ADR-0007](./0007-rebuild-mandate-and-bottom-up-flow.md)、[能力卡 2](../requirements/capabilities/02-window-model.md)、[能力卡 4](../requirements/capabilities/04-demand-lifecycle.md)、[能力卡 5](../requirements/capabilities/05-task-planning.md)
> 落地记录：2026-09-04 L1 endpoint 切片落地 `wakeflow_register_window_binding`（inspect、register、replace、decommission、release-claim），hook 观察记录进内核 `src/kernel/hook-observations.ts`，Claude 定位器与 pane 分类器进 `src/capabilities/endpoint/`；执行参数使用 Codex `create_thread` 与 `set_thread_title`、Claude `claude --session-id`；场景 `card-02/window-handshake` 与 `card-02/window-replace` 通过（进度日志 13.76）
> 落地记录：2026-09-10 L1 delivery 切片 6a 落地五步握手中的准备、许可与结局三步：`wakeflow_prepare_delivery` 取得窗口工作声明（内核 `src/kernel/work-claims.ts`）并返回带围栏令牌的一次性许可，`wakeflow_record_delivery_outcome` 以目标会话的 `user-prompt-submit` hook 记录（Codex 另认发送返回）证明落地，`wakeflow_rearm_delivery` 同信封换代际；场景 `card-06/delivery-chain` 与 `card-06/ambiguous-resolution` 通过（进度日志 13.83、13.84）

## 背景

能力卡 2 的讨论提出四个问题：Codex 与 Claude Code 能否用同一抽象模型；租约管什么；窗口管理能否下沉为宿主能力、约定或使用方式；窗口、worktree、投递能否统一设计。这些问题的根是 Wakeflow 的定位。

核对事实：TS 的窗口工作声明已在跨 Demand 的共享协调根下，每条声明绑定 Demand、任务、投递、绑定与一次宿主观察摘要；宿主效果目前只有一种 `send-message-to-observed-target-window`；旧 Codex 版没有 send adapter 而 Claude 版把 tmux 生命周期写进了进程内代码。

## 定位

Wakeflow 是嵌在宿主里的治理账本、内容提供者与证据校验器。它不运行模型，不替代宿主，不执行宿主写效果。三方之间只有三条通道，本地文件按通道分四类：

| 文件类 | 写者 | 读者 |
| --- | --- | --- |
| 权威 | 只有 Wakeflow 代码 | 只有 Wakeflow 代码 |
| 投影 | 只有 Wakeflow 代码 | 人与 Agent |
| 指令 | Wakeflow 渲染 | 宿主加载，Agent 遵循 |
| 内容 | 用户与 Agent | Wakeflow 只按摘要引用 |

MCP 工具是状态通道，指令文件与 skills 是程序通道，Agent 与宿主交回的观察是证据通道。

## 决定

### 1. 执行端点

一个执行端点由三部分组成：逻辑窗口角色与根、不透明宿主句柄、Agent 或宿主交回的观察证据。两宿主共用同一模型；差异只落在三处数据与一处程序：句柄种类与证据形状、投递内容形状、指令文本，以及 skills 里的执行步骤。每宿主有一张证据策略表，规定登记、投递、关闭各需要什么证据、能达到哪个验证等级。

### 2. 窗口管理的三层拆分

| 层 | 内容 | 落点 |
| --- | --- | --- |
| 权威 | 角色与拓扑、绑定登记表、工作声明、证据准入与分类、投影 | Wakeflow 代码，宿主中立 |
| 宿主数据 | 句柄种类、占位符表、登记所需证据形状、投递内容形状、指令文件名、settings 条目、证据策略、hook 声明 | 宿主 profile，纯数据 |
| 宿主程序 | 怎么建窗口、怎么观察、怎么投递、怎么关闭、怎么建 worktree | skills 与 commands 文本，Agent 执行 |

### 3. 工作声明

租约定义为"对执行端点注意力与工作树的工作声明"。它同时互斥两种资源：端点的注意力，一次只有一个投递；产品仓库的工作树，一次只有一个任务。时间只作恢复门阈值，不自动释放。正确性不依赖时间，而依赖围栏令牌：声明摘要与事件流修订号进入投递信封，交回的结果必须带回同一令牌，事件流在准入时拒绝过期令牌。

### 4. 宿主效果握手

窗口、worktree、投递、关闭共用一个五步握手：Wakeflow 出意图内容，Agent 做动作，Agent 或宿主交回观察，Wakeflow 准入，事件流状态转换。效果种类是数据：

| 效果 | Wakeflow 内容 | Agent 动作 | 证据 | 准入 |
| --- | --- | --- | --- | --- |
| 创建窗口 | 启动意图：角色、根、命令行、标题 | tmux 加 `claude`，或 `create_thread` | 句柄，宿主 SessionStart hook 记录，Claude 另有 tmux 坐标 | 形状、占位符、唯一性、hook 记录与句柄一致、绑定登记 |
| 创建工作树 | 工作树意图：仓库、基线、路径 | `claude --worktree` 或 `git worktree add` | `git worktree list --porcelain` 输出 | 非主检出、HEAD 与分支自洽、登记为端点工作树资源 |
| 投递 | 信封与 prompt、围栏令牌 | 粘贴或发线程消息 | 尝试证据、一次回读（Claude capture，Codex 有界轮询，失败不降级）、宿主 UserPromptSubmit hook 记录证明落地；Stop 或 turn-complete 记录在结果导入时证明完成 | 摘要复核、令牌复核、声明绑定、结果转换 |
| 关闭窗口 | 关闭意图 | `kill-window` 或归档线程 | 关前活、关闭结果、关后缺席、宿主 SessionEnd hook 记录 | 分级为机器验证、人工门、阻塞 |
| 移除工作树 | 只观察 | 用户自行 | 处置观察 | 只记录，从不删除 |

意图先于动作持久化，动作可重复，观察按声明与尝试 id 幂等准入。

## 研究复核

| 来源 | 结论 | 对模型的影响 |
| --- | --- | --- |
| Kleppmann《How to do distributed locking》 | 租约过期本身不安全，进程暂停与时钟漂移会让过期后的写入到达；被保护资源必须拒绝低于已见最大值的围栏令牌 | 采纳围栏令牌：声明摘要与修订号进入信封并随结果回流，事件流拒绝过期令牌；窗口本身无法拒绝，所以只能在准入侧围栏。这与旧实现的信封摘要复核一致 |
| Gray 与 Cheriton《Leases》1989 | 租约是有期限的授予，服务器等到过期或释放才做冲突动作；短租约减少故障延迟但增加续租开销 | 保持"过期只开恢复门"，2 小时作为恢复阈值而非清理；正确性由围栏保证，租约只是效率机制 |
| microservices.io 事务性 outbox 与幂等消费者 | 双写问题靠"意图与业务状态同一事务写入，中继至少一次投递，消费者按消息 id 幂等" | 意图记录先于动作提交；Agent 动作允许重复；观察准入按声明与尝试 id 幂等。TS 的 commitId 幂等重放已具备 |
| ToolGate，arXiv 2601.04688 | 把工具执行形式化为 Hoare 合同：前置条件门控调用，后置条件决定结果能否提交进符号状态 | 握手的"准入"就是后置条件校验，"声明"就是前置条件；状态只通过校验过的效果演进，与事件流作为唯一状态源一致 |
| 对象能力模型与《Tracking Capabilities for Safer Agents》，arXiv 2603.00991 | 权限来自不可伪造的引用；能力应被静态追踪与衰减 | 不透明句柄与声明摘要是能力令牌；句柄从不离开绑定记录；声明只能由持有者用四元组释放 |
| MCP 2025-11-25 Tasks | 实验性，call-now fetch-later，`input_required` 状态 | 不采用；握手由 Agent 驱动，不需要服务端长任务。列为未来观察项 |
| Claude Code hooks 参考 | 31 个事件，每个 hook 收到 `session_id`、`cwd`、`transcript_path`、`permission_mode`；`Stop` 带 `last_assistant_message`；插件可在 `hooks/hooks.json` 注册；`WorktreeCreate` 与 `WorktreeRemove` 可替换 worktree 逻辑 | 见调整一 |
| Codex hooks 与 `notify` | 事件含 `SessionStart`、`Stop`、`SessionEnd`、`SubagentStart`、`SubagentStop`，payload 含 `session_id`、`cwd`、`transcript_path`、`turn_id`；`notify` 的 `agent-turn-complete` 带 `thread-id`、`turn-id`、`cwd`、`last-assistant-message` | 见调整一 |
| Claude Code CLI 与 worktrees | `--session-id` 必须是 UUID；`--worktree <name>` 建在 `.claude/worktrees/<name>`，分支 `worktree-<name>`，基线由 `worktree.baseRef` 决定；运行期间持有 `git worktree lock`；不变更的 worktree 自动清理 | 工作树意图直接给出 `--worktree` 名称或 `git worktree add` 参数；回执采用 `git worktree list --porcelain` 的字段 |
| Codex subagents | 线程在同一会话内，`agents.max_concurrent_threads_per_session` 限并发；文档不暴露线程创建工具名 | Codex 的创建窗口动作仍按旧实现用 `create_thread` 与 `set_thread_title`，作为宿主数据保留，L1 切片时以当时的 Codex 版本核对 |
| git worktree 文档 | 一个分支同时只能被一个 worktree 检出；`lock` 防止 prune 与移动；`list --porcelain` 给出 path、HEAD、branch、detached、locked、prunable | 工作声明对仓库工作树的互斥与 git 自身的"一分支一 worktree"互补；回执字段直接取自 porcelain 输出 |
| tmux 控制模式 | `-C` 文本协议，`%output`、`%window-close` 等通知，`refresh-client -B` 订阅 | 作为 Agent 侧可选的更强观察手段写进 skills，不进入 Wakeflow 代码 |

## 研究复核后的调整

**调整一：增加宿主 hook 作为第二条证据通道。** 两宿主都提供由宿主进程调用的生命周期 hook，payload 含会话或线程 id、cwd 与最后一条助手消息。Wakeflow 插件可以在 `hooks/hooks.json` 与 Codex 的 `hooks.json` 或 `notify` 里注册一段 Wakeflow 自带的 Node 脚本，把 `SessionStart`、`Stop`、`SessionEnd` 事件写成观察记录到 `.wakeflow-local/runtime/hosts/<host>/observations/`。这不违反 TSD-12：脚本由宿主调用，不是 Wakeflow 的 MCP 进程 spawn 任何东西，也不是写效果。收益是三点：登记时 hook 记录的 `session_id` 或 `thread-id` 与 `cwd` 直接证明窗口真实且根匹配；投递后 `Stop` 或 `agent-turn-complete` 证明目标窗口确实完成了一轮，回读证据从"Agent 说"变成"宿主说"；关闭时 `SessionEnd` 提供缺席证据。这使 Codex 的证据策略从"形状加 Agent 声明"提升到"宿主证明"，两宿主的不对称只剩活性探测与关闭的机器证明。

**调整二：Codex 证据策略相应上调。** 第四点原文"Codex 的证据策略允许弱于 Claude"改为"两宿主都以 hook 记录为登记与投递的基础证据；Claude 额外有 tmux 坐标与活性探测；关闭在 Codex 仍是人工门"。

## 后果

- 能力卡 2 按建议确认；卡 4 的隔离位置与卡 6 的派发在实现判断里收敛到本模型；旧 Pod 的 11 阶段状态机不再需要。
- L1 的切片顺序改为：先做"执行端点登记与工作声明"和"宿主效果握手"两个共享机制，再让创建窗口、创建工作树、投递、关闭四种效果各自成为薄切片；每宿主的证据策略表与 hook 声明作为宿主 profile 数据。
- 插件制品在 E4 需要产出 `hooks/hooks.json`（Claude）与 Codex 的 hook 或 `notify` 配置，以及一段观察脚本；这是 L3 的产物清单新增项。2026-09-18 调整（gate-log §13.94 D9）：观察脚本作为 entrypoint `src/entrypoints/wakeflow-hook-observer.ts`（写 `session-start | user-prompt-submit | stop | session-end` 四类记录）连同两宿主的 hook 配置片段提前到 L2 第一项，否则 L2 的"两宿主各完成一次真实投递并交回 hook 证据"退出门无法达成；L3 只负责打包。
- 围栏令牌进入信封与结果 schema，事件流在结果准入时校验。

## 未决问题

- Codex 当前版本的线程创建与标题工具名，L1 切片时核对。
- hook 观察记录的保留与清理策略。
- hook 观察记录的 `recordedAt` 由脚本本地时钟提供；同一宿主事件重复触发时的重试幂等边界，L2 起点随观察脚本定。
- 是否把 tmux 控制模式写进 Claude 的 skills 作为推荐观察方式。

## 来源

- Martin Kleppmann, How to do distributed locking. https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html
- Gray and Cheriton, Leases: An Efficient Fault-Tolerant Mechanism for Distributed File Cache Consistency, SOSP 1989. https://dl.acm.org/doi/10.1145/74851.74870
- Chris Richardson, Transactional outbox and Idempotent consumer. https://microservices.io/patterns/data/transactional-outbox.html
- ToolGate: Contract-Grounded and Verified Tool Execution for LLMs. https://arxiv.org/abs/2601.04688
- Tracking Capabilities for Safer Agents. https://arxiv.org/abs/2603.00991
- Object-capability model. https://en.wikipedia.org/wiki/Object-capability_model
- MCP Specification 2025-11-25, Tasks. https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks
- Claude Code Hooks reference. https://code.claude.com/docs/en/hooks
- Claude Code CLI reference. https://code.claude.com/docs/en/cli-reference
- Claude Code Worktrees. https://code.claude.com/docs/en/worktrees
- Claude Code Subagents. https://code.claude.com/docs/en/sub-agents
- Codex Hooks. https://learn.chatgpt.com/docs/hooks
- Codex Advanced Configuration, notify. https://learn.chatgpt.com/docs/config-file/config-advanced
- Codex Subagents. https://learn.chatgpt.com/docs/agent-configuration/subagents
- git-worktree documentation. https://git-scm.com/docs/git-worktree
- tmux Control Mode. https://github.com/tmux/tmux/wiki/Control-Mode
