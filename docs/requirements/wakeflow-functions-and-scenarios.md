# Wakeflow 功能与场景总览

> 状态：`draft`，待用户确认理解一致后转 `active`
> 建立日期：2026-09-04
> 来源：能力卡 [01](./capabilities/01-workspace-and-configuration.md) 到 [10](./capabilities/10-automation-and-operations.md) 的确认记录、[ADR-0001](../decisions/0001-documentation-system.md) 到 [ADR-0010](../decisions/0010-worktree-isolated-execution-and-converged-flow.md)、旧 JavaScript 实现的场景证据
> 用途：在架构思考、垂直切片划分与基础能力设计之前，用一份自顶向下的功能清单核对"Wakeflow 是什么、做什么、在什么场景下被谁使用"。本文不描述实现，不引入新决定；与能力卡冲突时以能力卡为准并修正本文。

## 1. 定位

Wakeflow 是安装在 Codex 或 Claude Code 里的插件。它把一个目录变成"控制器工作区"：一组固定角色的 Agent 窗口按一条固定流程推进产品仓库的开发需求。

Wakeflow 自己不运行模型，不执行任何宿主动作，不写产品仓库。它只做三件事：

| 职责 | 含义 |
| --- | --- |
| 权威与账本 | 配置、需求记录、TODO、Demand 事件流、证据、归档的唯一写者；状态只由事件重放得到 |
| 内容提供 | 给每个窗口的启动意图、任务包、投递 prompt、评审投影、下一步路由，都是 Wakeflow 渲染的精确内容 |
| 准入校验 | Agent 与宿主交回的句柄、回读、结果、证据，先过形状、摘要、谱系、隐私、围栏令牌，再进入状态 |

三方分工（ADR-0009）：

| 方 | 做什么 |
| --- | --- |
| 用户 | 提出需求，确认需求与初始化，要求开启 pod，最终决定合并与关闭 |
| Agent（各窗口里的模型会话） | 调 Wakeflow 工具取内容与状态；执行宿主动作：开窗口、开线程、建 worktree、粘贴投递、关窗口；把观察交回 |
| 宿主（Codex、Claude Code） | 运行会话；通过 hook 与 notify 报告会话开始、一轮结束、会话结束，作为第二条证据通道 |
| Wakeflow | 上表三件事 |

本地文件按通道分四类：权威（只有 Wakeflow 读写）、投影（Wakeflow 写，人与 Agent 读）、指令（Wakeflow 渲染，宿主加载）、内容（用户与 Agent 写，Wakeflow 只按摘要引用）。

## 2. 核心对象

| 对象 | 是什么 | 谁创建 | 存放 | 可变性 |
| --- | --- | --- | --- | --- |
| 工作区 | 控制器目录，含配置、活动状态、本地运行时、指令文件 | 初始化 | 用户选定目录，必须与产品仓库根不同 | 结构由描述符推导 |
| 配置 `wakeflow.config.json` | 程序身份、拓扑（仓库、支撑面、窗口、pod）、ledger 根、治理、宿主偏好 | 初始化与重配置 | 工作区根，tracked | 整文件 Wakeflow 所有；programId 与 ledgerRoot 不可变 |
| pod | 一套完整窗口集加每仓库一个执行位置；main 是 `primary` 的 pod，其余在 worktree | 初始化建 main；用户要求时建 pod | 配置 `pods[]` | 四状态 creating、ready、closing、closed |
| 逻辑窗口 | 角色 controller、design、test、product 之一加根引用；每 pod 各一个控制角色，每仓库一个 product | 配置 | 配置 | 身份是 typed id，显示名只做展示 |
| 端点绑定 | 逻辑窗口到宿主句柄（session id 或 thread id）的私有登记，Claude 另有 tmux 坐标 | Agent 开窗口后登记 | `.wakeflow-local`，从不进公共输出 | 替换铸造新绑定，不原地改 |
| 支撑面 | Design 面与 Test 面，Wakeflow 管理或外部拥有 | 初始化 | 配置指定路径 | Design 有 `drafts/`；Test 有 `harnesses/`、`fixtures/` |
| 需求包 | 唯一交接物：ledger 里不可变记录（`requirement.md`、`landing.md`、附件）加板上认领状态 | Design 发布，一次调用完成记录与上板 | 记录在 ledger 根，tracked；认领状态在 `.wakeflow-active` | 记录永不改；认领状态 pending、parked、claimed、withdrawn、archived |
| Demand | 一个目标、一条事件流、一个状态根；身份记执行环境、类型、来源需求包、权威章节 | Controller 认领需求包即创建 | `.wakeflow-active/current/<demandId>/` | 身份与权威冻结；状态由事件重放 |
| 任务包 | 一个目标任务的不可变合同：分配、目标、边界、完成期望、验收锚点、评审输入合同 | Controller 规划 | Demand 根 | 与目标任务 1:1；替换或继续才有新包 |
| 测试卡 | real-environment 测试的冻结合同：批准计划、允许技能、尝试预算、边界门 | Controller 建卡 | Demand 根 | 冻结；尝试最多 10 次 |
| 投递 | group、packet、envelope、run 四层记录加一次性发送许可 | Controller 准备与声明 | Demand 事件流 | 只创建；run 追加不分叉 |
| 工作声明 | 对端点注意力与仓库工作树的互斥声明，带围栏令牌 | 投递准备 apply 获取 | 共享协调根 | 过期只开恢复门 |
| 结果记录 | 目标或 Test 窗口交回的不可变记录：结论、分支与提交、证据定位符、锚点映射 | 目标窗口导入 | Demand 根 | 只创建；current 或 historical |
| 评审决定 | Controller 的验收事件：accept、rework、redesign、blocked；Test 另有 verdict 与尝试决定 | Controller | Demand 事件流 | 事件 |
| 证据 | 从 worktree、支撑面、链接、提交或 hook 观察固化的记录，带隐私扫描 | Controller | Demand 根 | 不可变 |
| 归档包 | Demand 全部权威、事件、工件、证据、传输摘要、TODO 谱系、worktree 来源 | Controller 归档 | ledger `workspace/archive/` | 不可变；活动根删除 |
| 投影 | `index.md`、`workspace-current-status.md`、每 Demand 进度页、ledger 索引、Claude 状态栏 | Wakeflow | 各根 | 确定性重写；手写即不覆盖 |

## 3. 主流程：一条直线

```text
[0] 初始化工作区 ──► [1] 开窗口并登记 ──► [2] 用户与 Design 讨论，Design 读代码写需求包 ──► [3] 用户确认摘要 ──► [4] 发布需求包并上板
                                                                                                              │
      ┌───────────────────────────────────────────────────────────────────────────────────────────────────────┘
      ▼
[5] Controller 认领需求包即创建 Demand ──► [6] 规划任务包 / 测试卡 ──► [7] 准备投递并声明 ──► [8] Agent 投递并交回回读
      ▲                                                                                          │
      │ 返工：同任务新投递；继续：同 Demand 新任务；补充：新 Demand；并发：新 pod                    ▼
      └──────────── [11] 评审决定 ◄── [10] 评审投影 ◄── [9] 目标窗口执行并导入结果 ◄──────────────┘
                          │
                          ▼
              [12] 完成即归档 ──► [13] pod 关闭（用户合并分支后）
```

每一步的触发者、Wakeflow 工具、Agent 动作与证据：

| 步 | 触发 | Wakeflow | Agent 动作 | 证据与状态 |
| --- | --- | --- | --- | --- |
| 0 | 用户在 Controller 说"初始化" | `maintain_workspace` fresh preview 出计划与启动意图；apply 生成配置、协议根、ledger、支撑面、指令托管块 | 收集用户选择；确认后 apply | 配置存在；main pod 记录 |
| 1 | 初始化后 | 启动意图：角色、根、命令行或线程参数 | Claude 用 tmux 起 `claude`；Codex 开线程；登记句柄 | SessionStart hook 记录加句柄一致；绑定登记 |
| 2 | 用户与 Design 讨论需求 | 草稿模板在 skills 里 | Design 只读地核实产品代码，在 `drafts/` 写 `requirement.md` 与 `landing.md` | 无状态变化 |
| 3 | 需求成文 | `publish_requirement` preview：章节齐全、隐私、摘要，返回一页摘要 | Design 把摘要给用户，用户确认（确认点 1） | 无状态变化 |
| 4 | 用户确认 | `publish_requirement` apply：写 ledger 记录并上板 | Design 调用 | 需求包 pending |
| 5 | Controller 巡板或用户说"开始下一个" | 板查询、`create_demand(requirementId)`：根先建后认领，总控已有活动 Demand 则拒绝 | Controller 调用 | Demand 事件流 revision 1；需求包 claimed |
| 6 | Route 指向规划 | `plan_target_task`、`plan_test_card`：角色门、每仓库一条活动谱系、依赖已 accepted | Controller 撰写目标、边界、锚点；需求包标 `taskPlanReview: user` 时把任务清单交用户过目（确认点 2） | 任务包与测试卡；任务 planned |
| 7 | 任务已规划 | `prepare_delivery` 一次调用：生成 packet、信封、prompt 骨架，获取工作声明，签发一次性许可与围栏令牌 | Controller 写三段人话 | 投递 send-claimed |
| 8 | 许可在手 | `record_delivery_outcome` 准入回读，或由 hook 记录自动完成 | Claude 粘贴加回车再 capture 一次；Codex 发线程消息，可有界轮询读取 | accepted 的落地证据是目标会话的 UserPromptSubmit hook 记录（prompt 摘要匹配）或 Codex 发送调用的成功返回；回读失败不降级；只有发送调用明确失败才 rejected-before-send；完成证据 Stop 或 turn-complete 在结果导入时要求 |
| 9 | 目标窗口收到 prompt | `import_target_result`：谱系闭合、锚点覆盖、证据定位符解析核摘要、隐私扫描、围栏令牌 | 目标窗口按 target 与 craft 技能执行，在 worktree 或主检出内完成，导入结果，再把 Wakeflow 生成的回调送进 Controller 窗口 | 结果 current；任务 review-ready；声明释放；回调落地由 Controller 会话的 UserPromptSubmit 记录证明 |
| 10 | 回调到达 | `inspect_target_result_review` 只读投影：就绪、阻塞、允许的决定、结果谱系、测试步骤的期望与实际并列基线 | Controller 读证据；第一次读取即确认回调 | 回调 acknowledged |
| 11 | Controller 判断 | 实现决定 `accept \| rework \| blocked \| escalate`；测试决定 `accept \| request-another-attempt \| escalate`；accept 要求 completed 且锚点全映射；escalate 让 Demand 进入 awaiting-decision | Controller 调用；escalate 时把 Wakeflow 渲染的问题与备选方案交给用户 | 任务 accepted、needs-rework、blocked，或 Demand awaiting-decision |
| 12 | 全部任务 accepted | `complete_demand` 完成即归档：preview 内嵌 verify 门与归档前置；apply 一个事务写终态事件、封归档包、删活动根、置需求包 archived | Controller 调用 | Demand completed 且归档；事件流封流 |
| 13 | 用户合并分支 | `wakeflow_pod close`：Demand 已归档、分支已合并或明确放弃；清理 worktree 检出并入此步 | Agent 关会话，交回 porcelain 与 SessionEnd | pod closed |

分支：

- 返工：评审 rework 后，同一任务同一包的新投递（步 7 到 11 重复）。
- 重设计：评审 redesign 后，同仓库用替换包（旧任务与包 superseded）。
- 继续：已完成的 Demand 上用 continuation 谱系新增任务，状态回到规划。
- 补充需求：新 Demand，类型 supplement。
- 取消：任何非终态；结果与证据保留；需求包 withdrawn。
- 并发：一个总控一次只推进一个 Demand；用户要求"开启 pod"时，main 的 Controller 创建一套完整的并行开发环境，其 Controller 从共享板认领自己的需求。

## 4. 功能清单

### F1 工作区建立与维护（能力卡 1）

| 功能 | 场景 | 关键规则 |
| --- | --- | --- |
| F1.1 初始化 | 用户在产品仓库旁建控制器工作区 | preview 零写；typed id 由 Wakeflow 分配；目标目录有任何 Wakeflow 标记、祖先有配置、与产品仓库同目录，一律拒绝；不迁移旧版本 |
| F1.2 重配置 | 改显示名、语言、宿主偏好、治理策略，增仓库或窗口 | preview 给阻塞项与依赖矩阵；programId 与 ledgerRoot 不可变；删窗口、删仓库、删支撑面需 owner 证明 |
| F1.3 对账 | 怀疑托管文件、投影、目录模式漂移 | 只修 Wakeflow 拥有的静态目录、托管块、投影、Claude settings 与状态栏；不改配置、不登记窗口、不删孤儿目录 |
| F1.4 维护事务与恢复 | apply 途中崩溃 | journal 先于步骤；锁不自动打破；同计划同 operationId 只向前结算，否则明确要求人工 |
| F1.5 指令文件 | 工作区根的 `AGENTS.md` 或 `CLAUDE.md` | 不存在则新建，存在则追加托管块；支撑面记忆文件整文件 Wakeflow 所有；产品仓库只在 managed-block 授权时写托管块 |
| F1.6 Claude 权限与资产 | Claude Code 工作区 | 只写 MCP 允许规则；tmux 权限由用户自行授予；状态栏资产由 Agent 按计划安装，Wakeflow 校验字节与模式 |

### F2 窗口与执行端点（能力卡 2，ADR-0009）

| 功能 | 场景 | 关键规则 |
| --- | --- | --- |
| F2.1 启动意图 | 初始化后、替换时、pod 创建时 | 内容含角色、根、Claude 的 tmux 与 `claude` 参数（permissionMode、effort、model）或 Codex 的线程参数；不落盘，按需重算 |
| F2.2 登记 | Agent 开好窗口后 | 句柄形状、占位符、唯一性；绑定 launchIntentDigest；Claude 附 tmux 四元组；两宿主以 SessionStart hook 记录为基础证据；登记刷新运行投影 |
| F2.3 活性与定位 | 派发、回读、关闭前 | Claude：Agent 交回 pane 行与窗口选项，Wakeflow 按固定顺序分类，只有 live 可派发；Codex：Agent 可有界轮询读取线程作观察，读取失败或超时只记 unobserved、不判定端点不可用，派发不因此阻塞（乐观策略，用户经验：网络卡顿会误判失败） |
| F2.4 替换与退役 | 窗口崩溃或换窗口 | 两步：inspect 出启动意图，Agent 建新窗口，replace 消费新句柄并 CAS 旧绑定；退役分 machine-verified、manual-host-gate、blocked；有工作声明时拒绝 |
| F2.5 工作声明 | 一次投递占一个 product 或 test 窗口 | 互斥端点注意力与仓库工作树；围栏令牌进入信封与结果；2 小时只作恢复门；过期或持有者消失时，Agent 提供观察、Controller 确认后强制释放 |
| F2.6 改名 | displayName 变化 | 给出改名指令；不再有排列窗口 |

### F3 pod 并发（ADR-0010）

| 功能 | 场景 | 关键规则 |
| --- | --- | --- |
| F3.1 创建 | 用户对 main 的 Controller 说"开启 pod 并发做另一件事" | `wakeflow_pod preview` 给每个窗口的启动意图与每仓库的 worktree 意图；Agent 执行；只有 main 的 Controller 可调用 |
| F3.2 就绪 | 所有窗口与 worktree 回执交回 | 每个窗口握手通过；产品窗口的 worktree 回执用 `git worktree list --porcelain` 校验非主检出、common-dir 指向配置仓库、HEAD 与分支自洽；Test 窗口以附加目录读 worktree |
| F3.3 使用 | pod 的 Controller 认领需求 | 与 main 完全同型；每个总控一次只推进一个 Demand；Demand 身份记执行环境；pod 之间只共享板、配置、ledger |
| F3.4 关闭 | Demand 归档、分支合并或明确放弃 | 顺序固定：归档、合并在 Wakeflow 之外、Agent 关会话并交回回执、pod closed；关闭必须先于会话归档，因为宿主会随会话删 worktree |
| F3.5 约束 | 全程 | 不设数量上限；不自动开 pod；不做 Design 跨 pod 交接；worktree 从不由 Wakeflow 删除 |

### F4 需求入口（能力卡 3，ADR-0011）

| 功能 | 场景 | 关键规则 |
| --- | --- | --- |
| F4.1 讨论与读码 | 用户与 Design 讨论需求 | Design 只读地核实产品代码；在 `drafts/` 写 `requirement.md`（是什么、为什么）与 `landing.md`（代码事实、落地方案、测试决策）；草稿永远不是权威 |
| F4.2 确认点 1 | 需求成文 | preview 返回一页摘要：目标、完成定义、非目标、测试决策、范围；用户确认后才 apply；确认内容写进 requirement.md 的用户确认节 |
| F4.3 发布需求包 | 用户确认后 | Design 调用一次：ledger 不可变记录加板上 pending；章节按 demandType 必需表校验；隐私扫描；记录摘要链 |
| F4.4 板查询 | Controller 巡板或空闲 | 列出待认领需求包，按优先级排序；route 在空闲时提示待认领数量；板损坏对 status 与 verify 可见 |
| F4.5 认领即创建 | Controller 开始一个需求 | `create_demand(requirementId)`；一个总控一次一个；不领取一组；无自动认领 |
| F4.6 需求类型 | 发布时 | requirement、bug、supplement、research 四种，各有必需章节；research 的测试决策必须 not-applicable |
| F4.7 变更与撤回 | 需求变了 | 记录不可变：撤回为 withdrawn，重发带 `supersedes` 的新需求包；执行中的目标变更走补充需求 |

### F5 Demand 生命周期（能力卡 4）

| 功能 | 场景 | 关键规则 |
| --- | --- | --- |
| F5.1 创建与认领 | Controller 认领一个需求包 | 根先建后认领；权威从需求包单源收敛，引用为记录摘要加章节锚点；总控已有活动 Demand 则拒绝 |
| F5.2 状态与路由 | 每次变更后 | 状态只由事件重放；每个变更结果带 `next`；`wakeflow_status` 带 demandId 即附路由；粗粒度状态名只作人读投影，含 `awaiting-decision` |
| F5.3 完成即归档 | 全部任务 accepted | 评审 idle、无未释放声明、包全部 closed 或 superseded、verify 门通过；一个事务写终态事件、归档包、删活动根；verify 报告入归档包；只有 research 允许零任务完成 |
| F5.4 继续 | 已完成的 Demand 上做后续 | 必须带 continuation 谱系（optimization、requirement-supplement、verified-bug）；只在 completed 上可用 |
| F5.5 取消 | 中途放弃 | 任何非终态；结果与证据保留；活动包与卡 closed；声明释放；需求包 withdrawn；有 pending 评审时拒绝 |
| F5.6 投影 | 人读 | 每 Demand `index.md` 与 `developer-progress.md`（状态、任务与结果进度、最近事件、六个计数） |

### F6 任务规划（能力卡 5）

| 功能 | 场景 | 关键规则 |
| --- | --- | --- |
| F6.1 实现任务包 | Controller 把一个 Demand 拆成多个任务 | 分配 product 窗口与仓库；字段 objective、confirmedContext（引用 landing.md 章节）、需求包章节引用、boundaries、completionExpectations、commitExpectation、acceptanceAnchors、reviewInputContract；同一窗口的多个任务按谱系串行，不同窗口并行；依赖任务创建时已 accepted |
| F6.2 替换与继续谱系 | 同仓库再规划 | 替换在创建时让旧任务与包 superseded；继续要求谱系头已 accepted 且 closed；二者互斥 |
| F6.3 测试合同 | 测试决策为 real-environment | test 任务包携带 `testContract`：步骤 given、when、then 来自需求包验收标准，环境规格，允许技能，尝试预算 1 到 10，停止条件 |
| F6.4 测试任务与尝试 | Test 窗口执行 | 同一合同同时一个活动 Test 任务；尝试可只跑失败步骤子集；尝试模式 initial、resume、restart |
| F6.5 派发 prompt | 任务包变成文字 | Wakeflow 渲染骨架：身份块含 demandId、阅读顺序、必需技能、交回指针、派发记录；Controller 写目标、完成焦点、边界三段；整段带摘要进信封；上限 65,536 字符 |

### F7 投递与宿主效果（能力卡 6）

| 功能 | 场景 | 关键规则 |
| --- | --- | --- |
| F7.1 准备与许可 | 一个或多个已规划任务打包派发 | 一次调用创建 group、packet、envelope，获取工作声明，签发一次性许可；许可含 prompt、绑定、声明摘要、状态摘要、围栏令牌；一次投递一次宿主效果；prompt 逐字节贯穿 |
| F7.2 调用形状 | 全流程 | 读一次；追加一次（幂等键加流修订 CAS）；效果 preview 加 apply，只用于宿主效果、不可逆或需用户确认；每个变更结果带 `next` |
| F7.3 执行与回读 | Agent 发送 | Claude 粘贴加回车再 capture 一次；Codex 发线程消息后可有界轮询读取；回读是结构化观察声明加 hook 记录引用；回读失败或超时不构成失败判定 |
| F7.4 结果记录 | 发送后 | accepted 的证据是 UserPromptSubmit hook 记录（两宿主都有，Codex 另可用发送调用的成功返回）；rejected-before-send 只用于发送调用本身明确失败，立即释放声明；ambiguous 只用于发送结果未知，保留声明，匹配的 UserPromptSubmit 记录到达后自动转 accepted；完成证据 Stop 或 agent-turn-complete 在结果导入时要求 |
| F7.5 重新武装 | 没送出去 | 同信封换新声明代际；每信封最多 3 次 |
| F7.6 ambiguous 解决 | 送没送出去不确定 | Agent 提交 hook 记录与观察，Controller 确认后判为 accepted 或 rejected-before-send |
| F7.7 Controller 回传 | 目标完成后唤醒 Controller | 流程的固定一环：目标窗口导入结果后把 Wakeflow 生成的回调送进 Controller 窗口；形状与证据按 ADR-0012 D1 |

### F8 结果与评审（能力卡 7）

| 功能 | 场景 | 关键规则 |
| --- | --- | --- |
| F8.1 结果导入 | 目标或 Test 窗口完成 | 目标窗口自己调用；谱系闭合；completed 必须覆盖 requiredKinds 与每个锚点；证据定位符限定在 pod worktree 与 Demand 根内并核摘要；隐私扫描；记录 branch 与 commit；围栏令牌 |
| F8.2 评审投影 | Controller 看结果集 | 只读：成员状态、就绪与阻塞分区、允许的决定、结果谱系、测试步骤的期望与实际并列 approved 基线；不装配证据正文；不判真伪 |
| F8.3 实现决定 | Controller 验收 | `accept \| rework \| blocked \| escalate`；accept 要求 outcome completed 且锚点全映射；rework 只用于锚点内代码缺陷；同一任务第三次 rework 自动 escalate |
| F8.4 测试决定 | Test 结果 | 逐步 `{{expected, observed, evidence, verdict}}` 与整体 verdict；失败步骤必带分类 `product-defect \| harness-defect \| environment \| flaky \| missing-evidence \| out-of-scope \| needs-decision`；决定 `accept \| request-another-attempt \| escalate` |
| F8.5 升级与决策 | 需求或方案层面的问题 | `escalate` 事件带问题、需求引用、证据、备选方案，Demand 进入 awaiting-decision；用户直接回答记 `decision-recorded`，或 Design 发布补充需求包；`product-defect` 走授权有界返工与新的 Test 代际 |
| F8.6 评审状态 | 全程 | 同一时间一个 pending 评审；pending 时拒绝结果导入与规划；cancel 遇 pending 拒绝 |

### F9 证据、归档与清理（能力卡 8）

| 功能 | 场景 | 关键规则 |
| --- | --- | --- |
| F9.1 记录证据 | Controller 固化评审输入 | 来源：托管路径（仓库、支撑面、pod worktree）、https、git-commit、hook 观察；kind 闭集；隐私扫描只拒凭证类；transcript 按定位符引用 |
| F9.2 归档 | 完成或取消的一部分 | 与完成同一事务；封包含权威、事件、工件、证据、传输摘要、需求包谱系、worktree 来源、verify 报告；活动根删除；需求包 archived |
| F9.3 清理 | pod 关闭或维护对账时 | 删传输残留与已关闭 pod 的 worktree 检出；门：已归档、摘要匹配、无活动声明、hook 证明会话结束；永不动 ledger、证据、需求包、journal |

### F10 观察与校验（能力卡 9）

| 功能 | 场景 | 关键规则 |
| --- | --- | --- |
| F10.1 状态定向 | 任何窗口行动前 | 一个工具：不带 demandId 给工作区定向与待认领摘要，带 demandId 附该 Demand 的路由；域含仓库 git 事实、活动 Demand、窗口身份、传输、工作声明、pod、未被接收的结果、已接受未合并分支；`nextActions` 只路由不执行；三层脱敏 |
| F10.2 严格校验 | 初始化后、维护前、归档前、pod 关闭前 | 门集合含配置、布局、权威、ledger、传输、声明、hook 通道、pod 执行位置、投影、维护门、存储；unavailable 算不通过但分开计数；`repairsApplied` 恒假 |
| F10.3 活动投影 | 人读 | `index.md`、`workspace-current-status.md`（含 pod 段）、每 Demand 进度页；标记加摘要 CAS；手写即整轮零写 |
| F10.4 Claude 状态栏 | 状态栏一行 | `<pod> · <window>`，main 省略前缀；不含路径与句柄 |

### F11 制品与发布（能力卡 10）

| 功能 | 场景 | 关键规则 |
| --- | --- | --- |
| F11.1 双制品 | 发布插件 | 单一 TS 源码构建 Codex 与 Claude 两份制品：manifest、MCP 接线、skills、commands（Claude）、hooks 与 notify 配置、观察脚本、指令记忆、README |
| F11.2 版本 | 发布 | 五源一致，起点 `1.0.0`，标签在 HEAD，干净 main；Node 24 |
| F11.3 校验与冒烟 | 发布前 | 校验器由导出与 schema 派生；冒烟五幕：初始化零写与 apply、目标树、对账 no-op、观察健康、pod 创建 preview 零写 |

## 5. 宿主差异（只在数据与 skills 步骤里）

| 项 | Codex | Claude Code |
| --- | --- | --- |
| 指令文件 | `AGENTS.md` | `CLAUDE.md` |
| 开窗口 | 线程能力，句柄 thread id | tmux 加 `claude`，句柄 session id，另有 tmux 坐标 |
| 活性 | 有界轮询读取线程，乐观：读取失败不判失败 | pane 观察分类 |
| 投递 | 线程消息，发送调用成功返回即落地证据；可轮询读取 | 粘贴加回车，capture 一次；控制模式可选 |
| hook 证据 | hooks（含 UserPromptSubmit 带 prompt 与 turn_id、Stop、SessionStart、SessionEnd）与 `notify agent-turn-complete` | 31 个 hook 事件（UserPromptSubmit、Stop、SessionStart、SessionEnd 等） |
| worktree | Worktree 线程，detached HEAD，导入前建分支，默认保留 15 | `claude --worktree`，分支 `worktree-<name>`，退出无改动自动清理 |
| 关闭证明 | 人工门 | 可机器验证 |
| 权限与资产 | 无 | MCP 允许规则、状态栏、`settings.local.json` |
| 命令面 | 无 | slash 命令 |
| marketplace | 无版本字段 | 有版本 |

## 6. 明确不做

- 不运行模型，不 spawn 进程，不开 PTY，不执行 tmux、git、线程操作。
- 不写产品仓库；产品仓库的托管块只在显式授权时写。
- 不合并分支，不删 worktree，不关宿主会话。
- 不自动开 pod，不自动过期清理工作声明，不自动打破锁。
- 不识别或迁移任何旧版本工作区。
- 不做 keep-live、unattended、活动监视、提示临时文件。
- 不判断结果真伪；真伪与验收永远是 Controller 的判断。
- 不在公共输出、tracked 文件、投影里放绝对路径、句柄、凭证。

## 7. 理解核对清单

以下是我对使用方式的理解，请逐条确认或纠正：

1. 用户日常只和两个窗口对话：与 Design 讨论需求，与 Controller 下达"认领、开 pod、归档"等指令；Product 与 Test 窗口由 Controller 通过投递驱动，用户一般不直接操作。
2. Controller 是 Agent，评审决定由它自主作出；用户可以随时介入 Controller 会话改变决定，但 Wakeflow 不区分"人的决定"与"Controller 的决定"。
3. Test 窗口只在 Demand 的测试决策为 real-environment 时参与；controller-only 的 Demand 由 Controller 自己核对目标窗口的证据。
4. 目标窗口在 main 的主检出上直接改代码；在 pod 里在该 pod 的 worktree 上改代码。提交与否由任务包的 commitExpectation 规定，合并永远由用户做。
5. 一个总控一次只推进一个 Demand，一个 Demand 内由任务包承载多个任务；想并行就让用户开一套 pod；pod 用完即关。
6. 结果由目标窗口自己导入，Controller 不代填；Controller 只读评审投影与证据后作决定。
7. 需求包由 Design 发布，是开工前唯一的交接物，进入 ledger 且与产品仓库无关；用户的确认发生在发布前的摘要上。
8. 归档是每个 Demand 的必经终点，归档后活动根消失，历史只在 ledger 里。
9. 双宿主共享全部权威与内容形状；差异只体现在句柄种类、证据形状、指令文本与 skills 步骤。
