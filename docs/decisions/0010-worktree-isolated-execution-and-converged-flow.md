# ADR-0010 Pod 隔离执行与流程收敛

> 状态：`accepted`
> 落地记录：2026-09-10 L1 pod 切片 9 落地 D1 到 D7：配置 `pods[]` 与窗口 `podId`（main 为 primary）、`wakeflow_pod`（create 与两段 close 走配置事务，recover 对账回执）、worktree 回执经握手准入、Demand 身份 `podId` 与一 pod 一 Demand、投递与回调按 pod、结果导入的分支规则、`pod-worktree` 证据根、归档 worktree 成员；状态与已接受未合并分支的投影随观察切片；gate-log §13.91、§13.92
> 提出日期：2026-09-04
> 裁决日期：2026-09-04。用户先确认"git worktree 完全隔离的一组独立会话来进行任务，完全不影响主线"，随后给出完整模型："初始化建立的整套环境默认是 main；开发者要求开启 pod 时，新建一套 Design、Test、Controller 与仓库窗口，记录为 pod，配套宿主新建的 worktree 分支"，并统一确认下列五项：main 作为 `primary` 的 pod 纳入同一模型；一个 pod 同一时刻只推进一个 Demand；worktree 归产品窗口所有并用宿主原生能力创建；取消 Design 跨 pod 交接；只有 main 的 Controller 创建和关闭 pod
> 基线提交：`c0098e2`
> 取代：本文首版的 D1 到 D3 按任务粒度设计 worktree，已由用户的 pod 模型取代；D4 到 D6 保留并重编号
> 相关：[ADR-0009](./0009-execution-endpoint-and-host-effect-handshake.md)、[ADR-0006](./0006-legacy-capability-retention.md)、[archive/wakeflow-host-managed-complete-pod-requirement-design-2026-07-31.md](../archive/wakeflow-host-managed-complete-pod-requirement-design-2026-07-31.md)、[能力卡 2](../requirements/capabilities/02-window-model.md)、[能力卡 4](../requirements/capabilities/04-demand-lifecycle.md)、[能力卡 5](../requirements/capabilities/05-task-planning.md)、[能力卡 6](../requirements/capabilities/06-delivery-and-host-effects.md)、[能力卡 8](../requirements/capabilities/08-evidence-and-archive.md)

## 背景

旧实现区分 `executionPlacement.main | isolated`：main 在产品仓库主检出上执行并用 `main:<repositoryId>` 声明互斥，isolated 走 11 段的 Pod 状态机、三套记录与 Design 跨 Pod 交接谱系，服务约 7,000 行。2026-07-31 的需求文档已经给出正确的骨架："主线是默认执行面；Pod 是用户明确要求后才创建的并发执行面；所有 Pod 角色都是宿主独立创建的真实会话；每个有仓库责任的 Pod 窗口用宿主创建的独立 worktree；Wakeflow 只规划、登记和验真"。膨胀来自骨架之上的状态机与谱系，不来自骨架本身。

ADR-0006 曾把 Pod 简化为"由 Confirmation 授权的隔离执行位置"；本文首版又把 worktree 推到任务粒度。用户在 2026-09-04 明确了自己的模型，两者都被取代。

## 研究复核

| 来源 | 结论 | 影响 |
| --- | --- | --- |
| Anthropic《Building effective agents》 | 从最简单的方案开始；orchestrator-workers 适合多文件编码；evaluator-optimizer 适合有清晰评估标准的迭代；在检查点暂停等人 | 每个 pod 是一套完整的 orchestrator-workers 加评审循环；pod 之间不通信，只共享板 |
| Anthropic sub-agents 与 Claude Code worktrees 文档 | 上下文隔离提高可靠性；`--worktree <name>` 建在 `.claude/worktrees/<name>`，分支 `worktree-<name>`，运行期间锁定，退出且无改动即自动清理，resume 回到原 worktree，`.worktreeinclude` 复制忽略文件 | 一个 pod 的 Controller、Design、Test 各自独立上下文；Claude 侧产品窗口的 worktree 由 `--worktree` 建立，pod 关闭必须先于会话退出 |
| Codex worktrees 文档 | 每个 Worktree 线程在 `$CODEX_HOME/worktrees` 建 detached HEAD 的受管 worktree，完成后"Create branch here"或"Hand off"，默认保留 15 个，归档聊天即删 | Codex 侧产品窗口就是一个 Worktree 线程；结果导入前必须已建分支；pod 关闭必须先于线程归档 |
| git-worktree 文档 | 一个分支同时只能被一个 worktree 检出；`list --porcelain` 给出 path、HEAD、branch、detached、locked、prunable | 回执字段直接取自 porcelain；"一 pod 一仓一 worktree 一分支"与 git 约束一致 |
| Temporal 持久执行与人工审批 | 状态由事件重放得到；人的决定作为信号持久等待 | Demand 事件流不变；pod 不是第二条事件流 |
| Oskar Dudycz《Saga and Process Manager》 | 除非工作流真的复杂，避免 Process Manager | pod 只有四个状态，没有状态机服务 |
| Kurrent《Snapshots》 | 优先缩短流的生命周期 | 一 pod 一 Demand，Demand 归档即封流，pod 随之关闭 |
| DORA 主干开发 | 分支寿命短，活动分支少，每天合并 | pod 应短命；状态投影列出"已接受未合并"的分支，Wakeflow 不代合并 |
| 并行编码 agent 实践（Augment、Simon Willison） | 一任务一 worktree 已是默认基线；并行只用于真正独立的工作；合并前看 diff | 并发度由开发者按独立性决定，Wakeflow 不设上限也不自动开 pod |

## 决定

### D1 pod 是唯一的执行环境抽象，main 是 `placement: primary` 的 pod

配置里只有一个名词 `pod`。每个 pod 有：`podId`、`placement ∈ {primary, worktree}`、一套逻辑窗口（controller、design、test 各一，每个仓库一个 product）、每个仓库的执行位置。main 由初始化建立，`placement: primary`，执行位置是各仓库的主检出；其余 pod 由开发者明确要求后创建，`placement: worktree`，执行位置是各仓库的一个 worktree 加新分支。工具身份从窗口绑定派生，绑定携带 `podId` 与角色。旧 `executionPlacement.main | isolated` 与 `main:<repositoryId>` 声明删除。

### D2 pod 的窗口集固定，产品窗口是成员而不是按任务创建

产品窗口每仓库一个，是 pod 的固定成员；任务在 pod 内复用它们。能力卡 2 的基数规则"controller、design、test 各恰好一个，每仓库至少一个 product"在 pod 作用域内保持。本文首版的"产品窗口按任务创建"否决。

### D3 一个 pod 同一时刻只推进一个 Demand

并发度等于活动 pod 的数量。Demand 身份记 `podId`；同一 pod 上已有活动 Demand 时创建新 Demand 被拒绝，提示开启 pod。旧实现"主线占用时无 Pod 授权则等待"的规则由此统一到 main 与 pod。

### D4 worktree 归产品窗口所有，由宿主原生能力创建，回执用 git 事实

创建 worktree 是 ADR-0009 握手的一种效果，附着在产品窗口的启动意图上：Wakeflow 给出仓库、基线提交、建议名称 `wakeflow-<podId>` 与宿主动作，即 Claude 的 `claude --worktree <name>` 或 Codex 的 Worktree 线程；Agent 执行；回执为 `git worktree list --porcelain` 的 path、HEAD、branch 或 detached、locked，加 `git rev-parse --git-common-dir`。Wakeflow 校验 cwd 不是主检出、common-dir 指向配置仓库、HEAD 与分支自洽，然后把它登记为该产品窗口的工作树资源。Codex 的 detached HEAD 在结果导入前必须已建分支。Test 窗口不建 worktree，从回执取路径以附加目录方式读。worktree 的生命周期与产品会话绑定，因此 pod 关闭必须先于会话退出或线程归档；移除 worktree 只观察，从不删除。

### D5 合并回主线在 Wakeflow 之外

结果记录带分支名与提交 sha；Controller 接受的是"这个分支上的这个提交满足验收锚点"；合并是开发者的显式动作。状态投影列出每个 pod 的"已接受未合并"分支。

### D6 pod 生命周期四个状态，只有 main 的 Controller 创建与关闭，记录在配置

- 状态 `creating → ready → closing → closed`。ready 需要全部窗口握手回执与产品窗口的 worktree 回执通过校验；closing 需要该 pod 的活动 Demand 已归档或取消、分支已合并或明确放弃并记录；closed 需要会话关闭回执与 worktree 处置观察。
- 只有 main 的 Controller 调用 `wakeflow_pod`，操作 `preview | apply | close | recover`；创建计划给出每个窗口的启动意图与每仓库的 worktree 意图。旧 `pod_open`、`pod_bind`、`pod_plan` 三动作、`pod_record` 四事件合并为此一个工具。
- pod 记录写在 `wakeflow.config.json` 的 `pods[]`，创建与关闭走配置事务；回执文件放本地运行时目录；不建第二条事件流。
- 不做 Design 跨 pod 交接：pod 的 Controller 从共享 TODO 板认领需求记录，pod 的 Design 从同一份需求记录出发做补充或重设计；main 与 pod 之间没有父子关系。
- 不设 pod 数量上限，不自动开 pod。

### D7 流程收敛为一条直线

```text
需求记录 → TODO → Demand(pod) → 任务包 → 投递 → 结果 → 评审 → 完成 → 归档 → [pod 关闭]
```

- 每一步对应 Controller 的一个工具调用，宿主效果由 Agent 按 skills 执行并交回证据。
- 返工是同一任务的新投递；继续是同一 Demand 的新任务；补充需求是新 Demand；并发是新 pod。
- 取消把 TODO 行置 `withdrawn`，pod 进入 closing。
- 完成要求全部任务 accepted 且评审 idle；封流归档带 worktree 来源成员；pod 关闭是归档之后的宿主效果。
- 机器侧状态由事件重放派生；Route 只回答"下一责任是谁"。

## 后果

- 能力卡 1：`wakeflow.config.json` 增加 `pods[]`，初始化生成 `main`；初始化要求工作区根与产品仓库根不是同一目录，同目录一律拒绝，否则产品 worktree 会带着 Controller 规则文件（用户于 2026-09-04 确认，记入能力卡 1 补充确认 Q11）。
- 能力卡 2：窗口绑定携带 `podId`；基数规则按 pod 作用域；`register` 的对象增加 pod 作用域窗口。
- 能力卡 3 与 4：`executionPlacement` 与隔离授权引用从 Demand 身份删除，改记 `podId`；Confirmation 不再为隔离位置授权；能力卡 4 的 4.4 由本文取代。
- 能力卡 5：每 Demand 每仓库一条活动谱系保持；任务包 `repositoryId` 指向 pod 内的产品窗口。
- 能力卡 6：投递目标是 `(podId, windowId)`；投递准备时校验产品窗口的 worktree 回执已登记。
- 能力卡 7：结果记录 schema 增加 `branch` 与 `commit`。
- 能力卡 8：证据来源根增加 `pod-worktree{podId, repositoryId}`；归档增加 worktree 来源成员；清理可扩展到已关闭 pod 的 worktree 检出。
- 能力卡 9：状态投影增加 pod 段与"已接受未合并"列表；verify 增加 pod-execution-location 门。
- 宿主 profile 增加产品窗口的 worktree 意图模板与 Test 附加目录意图。
- 计划：TSD-15 中"由 Confirmation 授权的隔离执行位置"改为本文的 pod 模型；L1 切片增加"pod 创建与关闭"。

## 补充（2026-09-25，§13.128）

第一个真实 pod 在 Claude Code 上拉起后核实了 D4 的宿主事实：`claude --worktree <name>` 把检出建在 `<仓库>/.claude/worktrees/<name>`、分支 `worktree-<name>`；仓库有远端时它从远端默认分支（origin/HEAD）建，不是本地 HEAD；若该路径上已有同名检出则复用（会话只加锁）。因此 `basePolicy: local-head` 的做法是先用 `git worktree add` 从本地 HEAD 在那条路径建好，再以 `--worktree <name>` 启动。这个版本的 Claude Code 不会把 `.claude/worktrees/` 写进仓库的排除规则，主检出会多出一行未跟踪目录；Controller 在每个仓库的 `.git/info/exclude` 加一行即可，不改被跟踪文件。Test 窗口的 `--add-dir` 来自产品窗口登记写的回执，所以 Test 窗口最后起。关闭时核实的另一件事：Claude Code 会给它使用的检出加锁，窗口退役后锁仍在，status 建议的 `git worktree remove` 会因锁失败，要先 `git worktree unlock`；建议命令不变（Wakeflow 不观察关闭时的锁状态），Controller 参考的关闭步骤写明这一步。

## 未决问题

三项已在 L1 关闭：

- 多仓库工作区一律为每个仓库建 worktree，不做子集隔离（pod 切片 9 固定窗口集，gate-log §13.92）。
- Codex 的 15 个受管 worktree 上限只进 skills 文本，机器侧不观察（gate-log §13.92）。
- 已接受未合并分支不设提醒阈值：`wakeflow_status` 的 `unmergedAccepted[]` 全部列出，定义为已接受实现结果中分支引用仍在仓库、且尖端不等于仓库当前所在分支尖端的项（没有对象图不判祖先；正检出在该分支上或分离头时不判已合并；仓库指针未观察时保留并标 `repositoryObserved: false`），observation 切片 10，gate-log §13.94 D2、§13.96。

## 来源

- Anthropic, Building effective agents. https://www.anthropic.com/engineering/building-effective-agents
- Claude Code, Run parallel sessions with worktrees. https://code.claude.com/docs/en/worktrees
- Claude Code, Sub-agents. https://code.claude.com/docs/en/sub-agents
- Codex, Worktrees. https://learn.chatgpt.com/docs/environments/git-worktrees
- git-worktree documentation. https://git-scm.com/docs/git-worktree
- Temporal, Human-in-the-loop approvals. https://temporal.io/blog/human-in-the-loop-approvals
- Oskar Dudycz, Saga and Process Manager. https://event-driven.io/en/saga_process_manager_distributed_transactions/
- Kurrent, Snapshots in Event Sourcing. https://kurrentdb.kurrent.io/blog/snapshots-in-event-sourcing
- DORA, Trunk-based development. https://dora.dev/capabilities/trunk-based-development/
- Augment Code, How to Use Git Worktrees for Parallel AI Agent Execution. https://www.augmentcode.com/guides/git-worktrees-parallel-ai-agent-execution
- Simon Willison, Embracing the parallel coding agent lifestyle. https://simonw.substack.com/p/embracing-the-parallel-coding-agent
