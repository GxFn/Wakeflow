# 能力组 6：派发与宿主效果

> 状态：`confirmed`，Q1 到 Q5 于 2026-09-04 按建议裁决，记录见文末"确认记录"；投递目标按 [ADR-0010](../../decisions/0010-worktree-isolated-execution-and-converged-flow.md) 为 `(podId, windowId)`
> 建立日期：2026-09-04
> 旧实现基线：`core/`、`plugins/*` 于 `c0098e2`
> 上位文档：[ADR-0009](../../decisions/0009-execution-endpoint-and-host-effect-handshake.md)、[ADR-0003 修订](../../decisions/0003-host-effect-layer-ownership.md)、[能力卡 2](./02-window-model.md)、[能力卡 5](./05-task-planning.md)
> 说明：本组是 ADR-0009 握手模型的第一个真实效果。旧实现的 Claude transport 是进程内代码，新边界下变为 skills 里的步骤；Wakeflow 只保留内容、声明、准入与状态转换。

## 6.1 投递准备与声明

**场景**：Controller 把一个或多个已规划的目标任务打包成一次派发：为每个目标生成 packet 与信封，占住目标窗口，然后签发一次性的发送许可。

**旧实现**：

- `wakeflow_prepare_delivery` 七个操作：`target-preview`、`target-apply`、`target-claim`、`target-rearm`，以及 `controller-preview`、`controller-apply`、`controller-pre-send`。preview 输入 `targets[]{targetTaskId, prompt, contextPolicy, automationRequested, restart?}`、`returnPolicy{mode}`、`createdAt`，零写；apply 发布 group、packets、envelopes（只创建），获取每窗口租约，再为每个成员提交 `target-delivery.prepared` 事件；claim 是唯一的 `prepared → send-claimed` 转换并返回许可。`wakeflow-delivery-orchestration.mjs:1170`、`:2652`、`:3105`。
- 传输记录在 `.wakeflow-local/runtime/shared/transport/demands/<demandId>/{groups, packets, envelopes, runs}/`，0700 与 0600，单条 8 MiB。DispatchGroup 冻结来源修订与成员；DispatchPacket 由任务包派生，含 `taskBriefing`、`boundaries`、`acceptanceAnchors`、`reviewInputContract`、`resultContract`、`testContract`、`prompt`；Envelope 含 `deliveryId`、group 与 packet 引用及摘要、`preparedByHostId`、`windowId`、`identityRef`、`bindingId`、`identityBindingDigest`、`prompt`（必须与 packet 逐字节相等）、`oneShot: true`、`transportPolicy{direct-thread, missingIdentity: rejected-before-send}`、`readbackPolicy{required, maxObservations: 1}`、`envelopeDigest`。`wakeflow-transport-records.mjs:174-207`。
- 阶段机 `prepared → send-claimed → accepted | rejected-before-send | ambiguous`，四种事件 `prepared`、`send-claimed`、`run-recorded`、`rearmed`；`currentDelivery` 记录 `sourceState`、group、packet、envelope、lease、phase、`sendGeneration`、`preparedBy`、`authorizedBy`、`claimedBy`、`recordedBy`、`rearmedFrom`、`latestRun`。`wakeflow-demand-core-records.mjs:175-218`、`:1244-1400`。
- 发布只创建：同 id 同字节 replayed，不同字节 conflict；runs 追加且链不分叉。

**不变量**：信封摘要覆盖除自身外的全部字段；prompt 逐字节贯穿 packet、信封、许可；一个投递只允许一次宿主效果，靠 `oneShot`、唯一的 claim 转换和"只有这个状态修订能跨越宿主效果边界"保证；多目标计划禁止任何成员已有 `currentDelivery`。

**现 TS 状态**（2026-09-10，gate-log §13.84）：`wakeflow_prepare_delivery` 一次调用取得窗口工作声明（内核 `kernel/work-claims.ts`）、追加 `delivery.delivery-prepared.v1` 信封并返回一次性许可 `permit{prompt, hostAction{effect: send-prompt-to-window, hostId, windowId, displayTitle, bindingId, handleDigest}, fence{claimId, claimDigest, streamRevision}, issuedAt}`；实现与 test 目标共用；请求只带 `authored{goal, focus, boundary}`，prompt 骨架由 Wakeflow 渲染且只含相对路径；旧的 preview、apply、claim 三段与 Agent 窗口观察前置删除。2026-09-10 pod 切片 9：投递目标是任务包分配的 pod 窗口，worktree pod 的产品窗口要求 worktree 回执存在且与当前绑定同代（`worktree-receipt-missing | worktree-receipt-stale`）；prompt 身份段写 `pod: <name> (<podId>)`，工作区根按回执路径相对计算，测试任务 prompt 列出每仓库 worktree 的相对路径；回调落到 Demand 所在 pod 的 Controller。

**实现判断**：按 ADR-0009，许可里增加围栏令牌，即声明摘要与事件流修订号，并进入信封与结果；`readbackPolicy.maxObservations = 1` 作为记录级常量保留；prompt 上限 65,536 字符进入记录合同；controller 系列操作按 6.4 处理。

## 6.2 宿主效果执行

**场景**：Agent 拿到许可后，把 prompt 送进目标窗口，观察一次它是否落地，交回证据。

**旧实现**：

- Claude：facade `target-delivery` 在进程内完成。预检重载配置与状态，`send-claimed` 即要求恢复；取该窗口的 `send` 互斥锁；锁内 claim 得到许可；`assertTargetPermitClosure` 复验状态、传输条目引用与摘要、信封与绑定与租约一致、`envelope.prompt === permit.prompt`，粘贴前再核 `configDigest`；物理发送是 `tmux load-buffer` 从 stdin 读 prompt，`paste-buffer -d`，`send-keys Enter`，环境剥离 `TMUX` 并强制 UTF-8；回读只做一次 `capture-pane -p`，比对 prompt 首个非空行的前 96 字符，少于 12 字符则直接 pending，证据只存摘要；粘贴与回车成功即 accepted，与回读无关；load-buffer 失败为 rejected-before-send，paste 或 Enter 失败为 ambiguous。`wakeflow-claude-transport.mjs:379-448`、`:633-724`、`:753-846`。
- 提示词临时文件路径存在但**传输不用它**，只有 facade 的 inspect 与 sweep 命令引用。
- Codex：没有 transport 模块。Controller Agent 用原生线程工具发送，最多做一次有界 `read_thread` 观察，然后调 `record_delivery target-outcome`；`hostMethod` 与 `hostMode` 是自由 token；run 里不存任何线程或消息 id；accepted 必须带一条摘要证据，否则被拒。`wakeflow-controller/SKILL.md:175-188`、`wakeflow-transport-records.mjs:1846-1852`。
- `transport-recover` 只根据持久事实决定释放或保留互斥锁，从不记录 run。

**不变量**：无原始句柄进入任何传输记录；回读证据是"摘要的摘要"；公共输出里出现工作区根即拒绝。

**宿主差异**：Claude 有 pane 级观察与互斥锁；Codex 没有观察能力，只能自述。

**现 TS 状态**（2026-09-10）：执行完全交给 Agent；落地证据是目标会话的 `user-prompt-submit` hook 记录（`promptDigest` 等于信封 prompt 摘要），Codex 另接受宿主发送调用的返回摘要；Q1、Q2 按此落地，回读只是补充观察。

**实现判断**：按 ADR-0009，Claude 的粘贴、回车、`capture-pane` 与 Codex 的线程发送都成为 skills 步骤；旧的首行子串匹配放弃；回读改为 Agent 的结构化观察声明加宿主 hook 记录引用，Wakeflow 只做摘要与一致性；prompt 临时文件路径与 inspect、sweep 命令放弃；tmux 控制模式写进 Claude skills 作为可选的更强观察手段。

**待确认**：

- Q1 回读证据改为"Agent 结构化观察声明加宿主 hook 记录引用"，放弃首行子串匹配？建议如此。
- Q2 `record_delivery` 的 accepted 是否必须引用一条宿主 hook 记录（Claude 的 Stop，Codex 的 Stop 或 `agent-turn-complete`），缺失时只能记为 ambiguous？建议必须，这是新边界下把"Agent 说"变成"宿主说"的关键。

## 6.3 结果记录、重新武装与失败

**场景**：发送后记录结果；没送出去可以用同一信封再来一次；送出去但不确定要有出路；卡住要能恢复。

**旧实现**：

- `target-outcome` 追加不可变 run（`attemptOrdinal`、`previousRun`、`hostMethod`、`hostMode`、`transportStatus`、`readback{status, attempts ≤ 1, evidence}`、`observedLease`、`error`），提交 `run-recorded` 事件；accepted 让任务进入 `waiting-result`、Demand 进入 `dispatched` 或 `waiting-results`；rejected-before-send 立即释放租约；ambiguous 保留租约。`wakeflow-delivery-orchestration.mjs:3211-3350`。
- `target-rearm` 只接受 `rejected-before-send`：同信封同 packet 同 group，只换租约代际与 `sendGeneration`，必须是新租约，前一 run 必须是链尾且 readback 为 unavailable；不消耗 Test 尝试；**次数无上限**。`:3648-3730`。
- `ambiguous` 没有自己的出路：不能 rearm，新信封要等任务进入 `needs-rework`，而这需要真实结果加评审 rework；否则只能 `record_target_result import` 或手工 `release_window_lock`。
- 投递的状态 journal 只能由投递编排自己的失败闭合恢复，通用 `recover_state_transition` 明确拒绝接管。
- 目标窗口在投递中被替换：绑定不再 current 时预检失败，`send-claimed` 的投递既不能重发也不能 rearm，只能手工记 outcome 或释放租约。

**现 TS 状态**（2026-09-10）：`wakeflow_record_delivery_outcome` 按证据派生 accepted、rejected-before-send、indeterminate（`delivery.delivery-outcome-recorded.v1`），rejected 立即释放声明、indeterminate 保留；ambiguous 出口是同工具再次调用（惰性重查 hook 记录）、静默 10 分钟后以 `landing-evidence-missing` 加 `landing-silence-exceeded` 交 Controller、显式 `resolution` 只在 indeterminate 允许（Q3）；`wakeflow_rearm_delivery` 同信封换新声明与代际，上限 3（Q4，`DELIVERY_REARM_LIMIT`）。

**实现判断**：rejected-before-send 立即释放、ambiguous 保留的语义保留；投递 journal 的恢复继续由投递自己拥有，与 ADR-0006 放弃通用 recover 一致；outcome 的准入增加围栏令牌校验，过期令牌的结果拒绝。

**待确认**：

- Q3 `ambiguous` 是否增加显式解决操作：Agent 提交该窗口的宿主 hook 记录与观察，Controller 确认后判定为 accepted 或 rejected-before-send？建议增加。
- Q4 `rearm` 是否设上限：建议每个信封最多 3 次，超过必须换新信封。

## 6.4 Controller 回传

**场景**：目标窗口完成后，把"我做完了"送回 Controller 窗口，让 Controller 被唤醒。

**旧实现**：

- 反向通道 `controller-preview | apply | pre-send` 与 `controller-outcome`；内容由代码生成：group id、目标任务 id、`resultSetDigest`、`reviewSnapshotDigest` 与"本回调只是传输证据"的声明；发到 Controller 窗口的绑定；不占目标租约；每个结果集只允许一次逻辑回传，`return-rearm-required` 状态存在但没有任何回传 rearm 实现。`wakeflow-result-review-orchestration.mjs:1862-1941`、`:2305-2345`。
- 是否必须由 group 的 `returnPolicy.mode` 决定，`group-ready` 或 `per-target`；不是结果导入或评审的前置条件。

**现 TS 状态**（2026-09-10）：仍没有回传操作；`wake-controller` 的生产者是 `import_target_result`，按 gate-log §13.83 D4 随 result-review 切片落地。

**实现判断**：在 ADR-0009 的握手里，回传是一种效果种类"唤醒 Controller"，内容由 Wakeflow 生成，Agent 执行，宿主 hook 提供证据。

**待确认**：

- Q5 回传是否保留为可选效果种类：目标窗口的 Stop hook 已能证明完成，回传只解决"唤醒 Controller 窗口"这一件事。建议保留为可选，默认关闭。

## 6.5 keep-live

**旧实现**：keep-live 是 macOS 的睡眠抑制描述，不是传输。它在互斥门内维护租约、进程代际与控制请求三元组并返回宿主操作描述，从不轮询 tmux、不重发、不是心跳；记录在 `hosts/<host>/operations/keep-live/`。两份 README 明确它不是任务逻辑、传输权威或验收证据。`wakeflow-keep-live-service.mjs:1-12`。

**裁决**：ADR-0007 已定先放弃，场景层再议。

## 旧行为疑点

1. `withClaudePromptTransfer` 与提示词临时文件路径在生产中无调用方，却有两个 facade 命令。
2. 回读的首行子串匹配很弱：少于 12 字符直接 pending，只看可见区域，紧接回车无等待。
3. `paste-buffer` 失败被归为 ambiguous，而目标不存在时其实从未触碰 pane，却永久阻断 rearm。
4. `ambiguous` 没有自己的前向路径。
5. `assertSettledDeliveryRunTail` 有不可达分支。
6. 回传的 rearm 状态存在但没有实现。
7. `record_delivery` 不验证发送者，Codex 上没有任何其他围栏。
8. `record_delivery` 标注为幂等且非破坏，但它追加 run 并可能释放租约。
9. tmux 的 spawn 错误、非零退出与超时被压成一个 `ok: false`。
10. 多目标计划禁止任何成员已有 `currentDelivery`，部分失败的组只能逐个重规划。

## 确认记录（2026-09-04，按建议）

| 问题 | 裁决 | 落点 |
| --- | --- | --- |
| Q1 回读证据形状 | Agent 的结构化观察声明加宿主 hook 记录引用；放弃首行子串匹配 | 投递记录 schema、skills 步骤 |
| Q2 accepted 硬条件 | `record_delivery` 记为 accepted 必须引用一条宿主 hook 记录（Claude Stop、Codex Stop 或 `agent-turn-complete`）；缺失只能 ambiguous | 投递准入 |
| Q3 ambiguous 出路 | 增加显式解决操作：Agent 提交 hook 记录与观察，Controller 确认后判定 accepted 或 rejected-before-send | 投递命令与事件 |
| Q4 rearm 上限 | 同一信封最多 3 次，超过必须换新信封 | 投递准入常量 |
| Q5 Controller 回传 | 保留为可选效果种类"唤醒 Controller"，默认关闭 | 宿主 profile 与投递计划 |

## 修订（2026-09-04，用户纠正）

用户指出 Codex 并非没有观察能力：Agent 可以轮询读取线程判断投递是否落地，但网络卡顿会造成误判失败，按经验应乐观相信。据此修订 Q1 与 Q2 的证据规则，并按两宿主官方 hook 文档复核（Codex hooks 有 `UserPromptSubmit{prompt, turn_id}`、`Stop{turn_id, last_assistant_message}`；Claude Code hooks 有 `UserPromptSubmit` 与 `Stop`，均带 `session_id`、`cwd`）：

| 项 | 修订后 |
| --- | --- |
| 落地证据（accepted） | 目标会话的 `UserPromptSubmit` hook 记录，prompt 摘要与信封一致；Codex 另可用宿主发送调用的成功返回作为落地证据 |
| 回读 | Claude capture 一次；Codex 有界轮询读取；两者都是补充观察，读取失败或超时不降级、不判失败 |
| rejected-before-send | 只用于发送调用本身明确失败且未触碰目标会话 |
| ambiguous | 只用于发送结果未知；匹配的 `UserPromptSubmit` 记录到达后自动转 accepted，无需 Controller 裁定；Q3 的显式解决只在 hook 始终未到时使用 |
| 完成证据 | `Stop` 或 `agent-turn-complete` 记录不是投递 accepted 的条件，而是结果导入的前置（能力卡 7） |
| Codex 活性 | 派发前的活性观察为有界轮询读取线程，unobserved 不阻塞派发 |
| Q5 回传 | 用户纠正：子窗口完成后回调总控是旧流程的基本一环，不是可选项。改为必经、默认开启；具体形状按 [ADR-0012](../../decisions/0012-flow-convergence-callback-calls-testing-redesign.md) D1 裁决 |

## 修订（2026-09-04，[ADR-0012](../../decisions/0012-flow-convergence-callback-calls-testing-redesign.md)）

| 项 | 修订后 |
| --- | --- |
| 6.1 投递准备 | `prepare_delivery` 一次调用完成 group、packet、envelope、工作声明与一次性许可，返回许可与 prompt 一份，不回显状态；实现与测试投递共用同一工具，按任务 workType 分支；旧的 target-preview、target-apply、target-claim 三段与 `prepare_test_delivery` 合并 |
| 6.3 结果记录 | `record_delivery_outcome` 一次调用，或由 `UserPromptSubmit` hook 记录自动完成；ambiguous 出口按本卡上一修订 |
| 6.4 Controller 回传 | 固定效果 `wake-controller`：`import_target_result` 一次调用返回回调内容与许可，目标 Agent 送进 Controller 窗口；回调正文由 Wakeflow 渲染，含 demandId、pod、任务、结论与摘要、分支与提交、摘要、下一步工具名、"传输证据"声明；Controller 会话的 `UserPromptSubmit` 记录证明落地，Controller 第一次评审读取把回调记为 acknowledged；ambiguous 静默超阈值（默认 10 分钟）列入"未被接收的结果"，可重发，同信封新代际，上限 3；Controller 窗口被替换时回调目标按当前绑定重算，旧信封作废。旧的 review_pack、controller-preview、apply、pre-send、controller-outcome 删除 |
| returnPolicy | 默认 `per-target`；`group-ready` 只在多目标派发组上可选 |
| Q5 | 由上一修订与本节取代：必经、默认开启 |
