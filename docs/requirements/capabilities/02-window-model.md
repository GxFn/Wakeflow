# 能力组 2：窗口模型

> 状态：`confirmed`，Q1 到 Q8 于 2026-09-04 全部按建议裁决，记录见文末"确认记录"；本组的统一模型见 [ADR-0009](../../decisions/0009-execution-endpoint-and-host-effect-handshake.md)
> 建立日期：2026-09-03
> 旧实现基线：`core/`、`plugins/*` 于 `c0098e2`
> 上位文档：[docs/plan/typescript-reimplementation-plan.md §8.1 P0](../../plan/typescript-reimplementation-plan.md)、[ADR-0003 修订](../../decisions/0003-host-effect-layer-ownership.md)、[ADR-0007](../../decisions/0007-rebuild-mandate-and-bottom-up-flow.md)
> 边界：按 TSD-12，创建窗口、关闭窗口、tmux 操作、开线程由 Agent 执行；Wakeflow 提供意图内容并验证 Agent 交回的证据。本组每张卡都按这个边界标出"Agent 执行"与"Wakeflow 验证"。

## 2.1 窗口角色、拓扑与启动意图

**场景**：一个程序有一个 Controller 窗口、一个 Design 窗口、一个 Test 窗口，以及每个产品仓库至少一个 Product 窗口。配置里的窗口是逻辑身份，不是某个 thread 或 pane。初始化后 Wakeflow 给出每个窗口的启动意图，Agent 据此创建真实窗口并登记。

**旧实现**：

- 角色闭集 `controller | design | test | product`；`topology.windows` 至少 4 个，controller、design、test 各恰好一个，每个仓库至少一个 product。`wakeflow-config-v3.mjs:38`、`:369`、`:442-461`。
- 根引用按角色判别：controller 指向 program，design 与 test 指向 support-surface 且 capability 必须等于角色，product 指向 repository。`:316-338`、`:411-425`。
- `windowId` 为 `window_<uuidv4>`，与 program、repository、surface 共用一个唯一索引；`displayName` 只做展示，Claude 用它作 tmux 窗口名，从不作为身份。`:384-404`、`wakeflow-claude-lifecycle.mjs:626`。
- 窗口增删只能通过 reconfigure 的完整模型；removed 与 role-reassigned 需要 7 个 owner 证明。`wakeflow-reconfigure.mjs:169-184`、`:248-253`。
- `launchIntents` 只由 fresh-initialize 产生，不落盘，每窗口含 `windowId`、`role`、`displayTitle`、`root{kind, rootId, configuredPath}`、`host{hostId, profileDigest}`、`create{effect: create-window, hostTool}`、`registration{operation: register-window-binding, handleSource: host-create-result}`，全部 `authorityEligible: false`。`wakeflow-fresh-initialize.mjs:540-573`。

**不变量**：预览不是宿主授权；意图不是持久状态；角色与根引用由配置单一拥有。

**宿主差异**：`hostTool` 在 Codex 为 `create_thread`，在 Claude 为旧 CLI 的 `launch-window`，新边界下改为 tmux 加 `claude` 命令行的内容说明。Codex 的 `hosts.codex.launch` 偏好被配置接受但旧代码从不读取。

**现 TS 状态**：`wakeflow-window-launch-intent.ts` 与 `wakeflow-window-runtime-desired-topology.ts` 已有；角色与基数规则在配置 codec 中按 pod 分组保留（2026-09-10 pod 切片 9：每个窗口带 `podId`，每 pod controller、design、test 各一，primary 每仓库至少一个 product，worktree pod 恰好一个；启动意图带 `podId`、`podName`、`podPlacement`，worktree pod 的产品窗口意图带 `worktree{repositoryId, suggestedName, basePolicy}`，Test 窗口意图带 `attachedWorktrees[]`）。

**实现判断**：启动意图升级为新边界下的正式 Agent 指令内容，含每宿主的执行说明与参数，Claude 为 tmux 与 `claude` 命令行，Codex 为 `create_thread` 与 `set_thread_title` 及 model、effort 参数；意图仍不落盘，由 route 或 inspect 按需重算。

**待确认**：

- Q1 四种角色与基数规则原样保留？建议保留。
- Q2 Codex 的 `launch.modelByRole` 与 `reasoningEffortByRole` 保留，并作为 `create_thread` 的内容参数交给 Agent？建议保留，让配置项真正被消费。

## 2.2 窗口登记与绑定

**场景**：Agent 创建真实窗口后，把宿主句柄交给 Wakeflow 登记为该逻辑窗口的绑定。绑定是宿主本地私有事实，原始句柄绝不出现在公共输出或 tracked 文件里。

**旧实现**：

- `wakeflow_register_window` 只有 `register` 一个操作，请求为 `{windowId, handle{kind, value}, acquireTimeoutMs?}`。`wakeflow-window-binding-service.mjs:246-259`。
- 绑定记录 `.wakeflow-local/runtime/hosts/<host>/identity/window-bindings/<windowId>.json`，0600 单链接，字段 `programId`、`hostId`、`windowId`、`bindingId`、`handle{kind ≤64, value ≤512}`、`registeredAt`、可选 `hostVerifiedAt`。`wakeflow-window-binding-records.mjs:443-449`。
- 语义：无绑定则创建；同窗口同句柄幂等 `replayed`；不同句柄失败 `replace-required`，绝不静默覆盖。`:1234-1256`。
- 校验：句柄 kind 必须等于宿主 profile 的 kind，值去空白、无控制字符、不在占位符表、匹配 UUID 形状；windowId 必须在配置拓扑中；bindingId 与句柄跨窗口唯一；整个变更在运行时互斥门内。`:222-239`、`:886-937`、`:1204-1213`。
- 证据：除形状、占位符、唯一性外，这个工具不证明窗口真实存在。真实性证明只存在于 Claude 进程内路径，即 tmux 返回坐标后再登记并物化定位器。`wakeflow-claude-lifecycle.mjs:622-649`。
- 输出脱敏：公共结果丢弃 `handle`，运行时扫描编码结果中是否含提交的句柄值，含则拒绝。`wakeflow-public-v3-runtime.mjs:464-466`。

**不变量**：绑定从不原地修改，替换铸造新 `bindingId` 且 `registeredAt` 严格递增；每次变更后重扫并要求"目标窗口恰如预期改变，其余窗口逐字节不变"，否则升级为 recovery-required。

**宿主差异**：占位符表 Claude 比 Codex 多三项；Codex 句柄只有 thread id；Claude 句柄是 session id，tmux 坐标在定位器里。

**现 TS 状态**：`wakeflow_register_window_binding` 一个工具五种 `operation`（inspect、register、replace、decommission、release-claim），切片 `src/capabilities/endpoint/`（2026-09-04 L1 endpoint）。register 请求为 `{root, operation, windowId, observation{handle{kind, value}, launchIntentDigest, observedAt, tmux?}}`；准入要求同一 `sessionId`、同一窗口配置根的 `session-start` hook 观察记录（`src/kernel/hook-observations.ts`，`.wakeflow-local/runtime/hosts/<host>/observations/hooks/`），Claude 还要求 tmux 四元组；同句柄重放 `replayed`，异句柄 `precondition-failed/handle-conflict`，意图漂移 `launch-intent-drift`；结果只带 `bindingId`、`bindingDigest`、`registeredAt`、`launchIntentDigest` 与投影回执，原始句柄留在 0600 绑定文件；变更在绑定登记表互斥门内，登记后重发 registered 投影；旧的 `WakeflowAgentHostWindowCreationObservation` 包装与 `-registration`、`-public-coordinator` 模块已删除。2026-09-10 pod 切片 9：worktree pod 的产品窗口 `register` 与 `replace` 必须带 `observation.worktree{porcelain, commonDir}`（`git worktree list --porcelain` 与 `git rev-parse --git-common-dir` 原文），会话 `session-start` 的 cwd 按 porcelain 里的检出匹配，Wakeflow 用 `.git` 指针文件与 admin 目录核对后在同一互斥门内写回执 `hosts/<host>/pods/<podId>/worktrees/<repositoryId>.json`（0600），结果只回 `worktree{head, branch, detached, locked}`；`next` 只把同 pod 的未登记窗口列为阻塞（gate-log §13.92）。

**实现判断**：`hostVerifiedAt` 删除；登记必须绑定 `launchIntentDigest`，防止登记与意图脱节；登记成功即刷新该窗口的运行投影，修正旧文档与代码的矛盾。

**待确认**：

- Q3 Claude 登记是否必须附带 tmux 坐标观察（socket、session、window、pane 四项）才能登记，Codex 只需 thread id？建议是，这是新边界下 Wakeflow 能拿到的最强证据。

## 2.3 宿主句柄与定位

**场景**：Wakeflow 在派发、回读、关闭前需要知道某个逻辑窗口当前对应的真实宿主端点是否还活着、是否被替换。Claude 通过 tmux 观察，Codex 没有可观察的活性。

**旧实现**：

| 项 | Codex | Claude Code |
| --- | --- | --- |
| 句柄 kind | `codex-thread` | `claude-session` |
| 值形状 | 宽松 UUID | 宽松 UUID，但 launch 时用严格 v4 生成 |
| 获取方式 | Agent 调 `create_thread` 得到 threadId | 旧 CLI 自己生成 UUID 传给 `claude --session-id` |
| 后续验证 | 无，`locator` 不适用 | 定位器加 pane 探测 |
| 定位器文件 | 无 | `operations/window-locators/<windowId>.json` 加 `.lock`，字段 `locatorId`、`provider: tmux`、`tmux{socketName, sessionName, windowId "@N", paneId "%N"}` |
| 关闭证明 | `set_thread_archived`，永远人工门 | `kill-window` 加有界缺席探测，可机器验证 |

- 定位器观察状态按顺序判定：binding-mismatch、host-context-drift、missing、duplicate、coordinate-mismatch、pane-window-mismatch、pane-dead、process-mismatch、metadata-mismatch、live；只有 live 是 `authorityEligible`。事实来自 `tmux list-panes -a -F` 十个字段，含写入窗口选项的 program、host、window、binding、locator 五个 id。`wakeflow-claude-locator.mjs:480-532`、`wakeflow-claude-lifecycle.mjs:992-1069`。
- 每窗口操作互斥锁 `<windowId>.lock`，记录 operationId、kind、subject 摘要、期望的 binding 与 locator、owner 进程身份；已存在时按 owner 存活分为 busy、recovery-required、lock-unverifiable。操作种类 launch、resume、replace、close、retitle、arrange、send、readback、reconcile。`:1542-1602`。

**不变量**：观察不明确时保留互斥锁，只有显式 `safe-to-release` 才释放；原始 session、window、pane、thread id 只存在于 `.wakeflow-local`。

**现 TS 状态**：定位器记录 `src/capabilities/endpoint/locator-store.ts`，位于 `.wakeflow-local/runtime/hosts/claude-code/identity/window-locators/<windowId>.json`（0700/0600），随 register 与 replace 重写、随 decommission 删除；分类器 `pane-classification.ts` 按旧顺序原样移植为纯函数，输入为 Agent 交回的 pane 观察行；Codex 的 `locator` 标为 `not-applicable`。每窗口操作互斥锁未实现：变更只在登记表互斥门内串行，跨调用的操作占用留给 delivery 切片的工作声明。

**实现判断**：新边界下分类器的输入改为 Agent 交回的 `list-panes` 行与窗口选项，分类逻辑与状态词汇原样保留，输出不可伪造的裁定；定位器记录保留；互斥锁保留但 owner 从进程身份改为 Agent 会话中的操作 id 加 Controller 绑定；Codex 没有对等物，`locator` 继续标记不适用。

## 2.4 替换与退役

**场景**：窗口被用户关掉、崩溃或需要换一个新窗口时，Controller 需要让新窗口接管同一个逻辑 windowId；退役则是解除绑定。两者都不由 Wakeflow 执行宿主关闭。

**旧实现**：

- `wakeflow_replace_windows` 有 `inspect | replace | decommission`，声明"从不执行宿主创建或关闭"。`wakeflow-mcp-tools.mjs:715-721`。
- `replace` 请求必须带**已经创建好的新句柄**加 `expectedBindingId` 与 `expectedBindingDigest`，只返回新绑定，不返回任何启动意图。`wakeflow-window-binding-service.mjs:261-282`。文档与 commands 却写成"返回宿主中立意图再登记"，代码里没有这条路径；Claude 的 `launch-window` 在已有绑定时直接拒绝，`resume-window` 复用旧句柄，定位器虽有 replace 种类但没有命令发出。
- 存在租约文件即阻塞 replace 与 decommission，租约不可读也阻塞。`:948-975`。
- `decommission` 只 unlink 绑定文件，rename、fsync、unlink 每步带 fd 证明。`:1089-1162`。
- Claude 的 `decommission-plan | execute | recover`：close 互斥锁下解析端点、一次 `kill-window`、最多 8 次缺席探测；`missing` 加 close 成功才是 `machine-verified`；观察不在预期集合内则抛 recovery-required 并保留互斥锁；recover 即使证明缺席也只给 `released-without-machine-proof`。`wakeflow-claude-decommission.mjs:466-662`。
- Codex 退役只有计划与观察，`archived` 也只是 `manual-host-gate`，理由是归档不是终止证明。`wakeflow-codex-decommission.mjs:204-247`。
- 从不自动做的事：宿主创建与关闭、路由撤销、定位器删除、worktree 清理、有租约时替换。

**现 TS 状态**：两步替换已落地：`inspect` 返回该窗口的启动意图与执行参数，`replace` 消费新句柄并对旧绑定做 `expectedBindingId` 加 `expectedBindingDigest` 的 CAS，新绑定铸造新 `bindingId` 且 `registeredAt` 严格递增，定位器随之换代；`decommission` 以关前、关闭结果、关后三段观察加可选 `session-end` 记录判定 `machine-verified | manual-host-gate`，矛盾或失败为 `precondition-failed/closure-blocked`，退役后定位器一并删除并重发 unregistered 投影；持有工作声明时替换与退役都以 `claim-held` 拒绝；`release-claim` 只在声明超过 2 小时、持有会话已 `session-end`、或 Claude pane 为 pane-dead/missing 时接受，只删声明文件并在 `observations/claim-releases/` 留下回执。

**实现判断**：替换采用两步形状，`inspect` 返回该窗口的启动意图作为内容，Agent 创建新窗口后调用 replace 消费新句柄并对旧绑定做 CAS；退役后定位器一并删除，修正旧代码从不删除的缺口；退役的机器验证等级词汇 `machine-verified | manual-host-gate | blocked` 保留，但证明材料改为 Agent 交回的关闭前活、关闭结果、关闭后缺席三段观察。

**待确认**：

- Q4 替换两步形状是否接受？建议接受。

## 2.5 窗口租约与运行投影

**场景**：一次投递占用一个 product 或 test 窗口，期间其他投递不能进入同一窗口，也不能替换或退役它；投递结束后释放。状态工具需要知道每个窗口是否登记、根是否可达、是否可派发。

**旧实现**：

- 租约 `.wakeflow-local/runtime/shared/coordination/window-leases/<windowId>.json`，每窗口最多一份；字段含 `leaseId`、`demandId`、`targetTaskId`、`groupId` 与 `groupRef`、`deliveryId` 与 `envelopeRef` 与 `envelopeDigest`、`identityRef` 与 `bindingId`、可选 `repositoryId` 加 `checkoutResourceKey = main:<repositoryId>`、`acquiredAt`、`expiresAt`、自摘要。**没有 holder，没有进程身份**。`wakeflow-window-lease-records.mjs:21-42`。
- 只有 product 与 test 窗口可持有；product 同时声明 `main:<repositoryId>` 跨窗口互斥；`deliveryId` 全局唯一。`wakeflow-window-lease-service.mjs:1285-1358`。
- 由 `prepare_delivery target-apply` 获取，`target-rearm` 再获取，`target-claim` 只校验。README 写"由 claim 获取"，与代码矛盾。`wakeflow-delivery-orchestration.mjs:1789-1796`。
- 时长固定 2 小时不可配置；过期只打开恢复门，不清理，不覆盖；在过期租约上再获取失败 `expired-recovery-required`。`:1207-1218`、`:1456-1468`。
- 释放是四元组 `leaseId + deliveryId + bindingId + leaseDigest` 比较后删除，并复验当前绑定仍与租约一致。`:290-320`。
- 持有者进程死亡无人检测；没有公共工具能强制清除；租约文件存在又阻塞替换与退役，形成永久死锁。
- 运行投影 `hosts/<host>/projections/window-runtime/<windowId>.json`：`role`、`rootRef`、`resolvedRoot{unobserved | available | missing}`、`identity{unregistered | valid}`、`dispatchEligibility`（design 恒不可派发）、`preflightStatus`、`blockingReasons ⊆ {identity-unregistered, root-unavailable}`、`hostAvailability` 恒为 `unobserved`、来源指纹、摘要。只由 fresh-initialize、reconfigure、reconcile 写，登记不刷新。状态 `missing | unsafe | stale | current`。`wakeflow-window-runtime-records.mjs:26-50`、`:868-991`。
- `wakeflow_status` 为每窗口投影 `identityStatus`、`runtimeProjectionStatus`，未登记窗口生成 `register-window` 下一步，持有租约生成 `inspect-or-release-window-lease`。

**现 TS 状态**：租约已重切为 delivery 下的窗口工作声明，目录 0700 文件 0600，随 Demand 事件流；运行投影有 registered 与 unregistered 两种发布。

**实现判断**：窗口工作声明保留"只有 product 与 test 可持有、product 声明仓库主检出互斥、四元组 CAS 释放"三条；获取时机保持代码语义即投递准备的 apply，修正文档；`hostAvailability` 从投影删除，运行活性只来自 Agent 观察证据；投影在登记、替换、退役、投递准备与释放时都刷新。

**待确认**：

- Q5 租约时长保持固定 2 小时且不可配置？建议 v1 保持固定。
- Q6 过期或持有者已消失的租约，是否提供显式的公共恢复操作：需要 Agent 提供该窗口的观察证据，并由 Controller 确认后强制释放？建议提供，不自动过期清理。

## 2.6 宿主生命周期指令

**场景**：Claude 侧创建、恢复、改名、排列窗口；Codex 侧创建线程与设标题。新边界下这些全部由 Agent 执行，Wakeflow 只提供参数内容并验证结果。

**旧实现**：

- `preflight` 探测 `tmux -V` 与 `claude --version`。`launch-window` 要求无绑定无定位器，自生成 session UUID，`has-session` 决定 `new-window` 还是 `new-session`，`-n <displayName> -c <cwd>`，然后 `set-option automatic-rename off`；`claude` 命令行为 `--session-id | --resume`、`--add-dir`（cwd 不等于工作区根时）、`--permission-mode`、可选 `--effort`、可选 `--model`；子进程环境剥离 `TMUX` 与 `TMUX_PANE`。`wakeflow-claude-lifecycle.mjs:596-656`、`:958-970`、`:1035-1055`。
- 配置映射：`hosts.claude-code.tmux{socketName ?? null, sessionName ?? "wakeflow"}`；`permissionMode ?? acceptEdits`；effort 按角色回退到 default 再回退到宿主 profile 默认，controller 为 max，其余 xhigh；model 按角色回退到 default，没有则不传。`:269-287`。
- `resume-window` 要求定位器缺失或 pane-dead，复用旧句柄发新定位器代际；`retitle-window` 用 `rename-window`；`arrange-windows` 按 windowId 排序对每个窗口取互斥锁再 `move-window`。`:659-853`。
- Codex 没有生命周期模块，Agent 自己 `create_thread` 再 `set_thread_title`。

**现 TS 状态**：`inspect` 结果的 `launchIntent.execution` 给出执行参数：Claude 为 tmux socket、session、窗口名与 cwd、`claude` 命令行（`--session-id` 由 Agent 生成 UUID v4、`--permission-mode` 默认 acceptEdits、`--effort` 按角色回退再回退 controller max 其余 xhigh、可选 `--model`、cwd 不是工作区根时 `--add-dir`）；Codex 为 `create_thread` 的标题、cwd、model、effort 与后续 `set_thread_title`。Wakeflow 不 spawn 进程；retitle 与 arrange 未提供。2026-09-10 pod 切片 9：执行说明按宿主 profile 的 `surfaces.worktree` 模板给 worktree pod 的产品窗口加 Claude `--worktree wakeflow-<name>`（宿主分支 `worktree-wakeflow-<name>`）或 Codex `environment: worktree`（detached，第一次导入前 `git switch -c`），Test 窗口对已有回执的 worktree 加 `--add-dir`（Claude）或列相对路径（Codex）。2026-09-24 §13.117 D4：Claude 的执行由维护发布到 `.wakeflow-local/runtime/hosts/claude-code/operations/assets/tmux.mjs` 的助手承担——`launch` 读 inspect 的 `launchIntent`，生成 session id，`has-session` 决定 `new-session -d` 或 `new-window -d`，`-n <displayTitle> -c <root> -P -F` 启动 `claude`，`automatic-rename off`，写 `@wakeflow_program_id/host_id/window_id`，等 `session-start` hook 记录后打印 register 用的 observation；`self` 用 `TMUX_PANE` 与 `CLAUDE_CODE_SESSION_ID` 给 Controller 自己出 observation；`mark` 登记后从定位器补写 binding 与 locator 选项；`panes` 出 `tmux-panes` 观察；`close` 出 decommission 的 closure。Wakeflow 仍不 spawn 进程，助手是 Agent 调用的宿主资产。

**实现判断**：以上全部变为启动意图与操作意图里的"执行说明"内容，Wakeflow 不再 spawn 任何进程；`preflight` 变为 skills 里的自检步骤；`resume` 变为"同一逻辑窗口、新观察证据"的重新登记路径；session id 由 Agent 生成，Wakeflow 只验形状、占位符与唯一性。

**待确认**：

- Q7 Claude 的 `permissionMode` 是否保留 `acceptEdits | bypassPermissions` 两个值？建议保留，默认 acceptEdits。
- Q8 `retitle` 与 `arrange` 是否保留为 Agent 指令内容？建议保留 retitle（displayName 变化时给出改名指令），放弃 arrange。

## 旧行为疑点

1. 文档说登记刷新运行投影，代码不刷新；`rebuildWindowRuntimeProjections` 无生产调用方。
2. README 说租约由 claim 获取，代码在 apply 获取。
3. 文档说 replace 返回意图，代码要求已创建的新句柄；Claude 侧没有任何 replace 执行路径。
4. 退役计划声明"确认后删除定位器"，没有代码删除，定位器会累积。
5. `hostVerifiedAt` 从未被写入。
6. 过期租约没有任何出口，是永久死锁。
7. fleet 检查结果硬编码 `authorityEligible: false`，与每窗口同名字段自相矛盾。
8. `hostDirName` 与 `hostId` 永远相等，多一层无意义的间接。
9. Codex 的 launch 偏好被配置接受但无人读取。
10. 跨宿主读取时伪造 `handleKind: null` 的 profile，绕过了句柄 kind 检查。
11. 句柄借用的 catch 块两个分支都只是重抛。
12. `register` 不检查租约，replace 与 decommission 检查，非对称且无说明。
13. launch 用严格 v4 生成 session id，绑定却接受任意宽松 UUID。

## 确认记录（2026-09-04）

| 问题 | 裁决 | 落点 |
| --- | --- | --- |
| Q1 角色与基数 | 保留四种角色与"恰好一个 controller、design、test，每仓库至少一个 product" | 配置 codec |
| Q2 Codex launch 偏好 | 保留 `modelByRole` 与 `reasoningEffortByRole`，作为 `create_thread` 的内容参数交给 Agent | 启动意图内容；宿主 profile |
| Q3 Claude 登记证据 | Claude 登记必须附带 tmux 四元组观察，Codex 只需 thread id；按 ADR-0009 调整一，两宿主另以宿主 hook 的 SessionStart 记录为基础证据 | 登记准入；证据策略表 |
| Q4 替换形状 | 两步：`inspect` 出启动意图，Agent 创建新窗口，replace 消费新句柄并对旧绑定 CAS | 宿主效果握手的"创建窗口"效果 |
| Q5 租约时长 | v1 固定 2 小时不可配置，只作恢复门阈值 | 工作声明 |
| Q6 过期租约出口 | 提供显式公共恢复操作：Agent 提供该窗口观察证据，Controller 确认后强制释放；不自动过期清理 | 工作声明恢复入口 |
| Q7 permissionMode | 保留 `acceptEdits \| bypassPermissions`，默认 acceptEdits | 配置 schema；启动意图 |
| Q8 retitle 与 arrange | 保留 retitle 作为 displayName 变化时的改名指令；放弃 arrange | 宿主程序层（skills） |

2026-09-04 用户纠正：Codex 的活性并非"不适用"，Agent 可有界轮询读取线程作观察，但网络卡顿会误判失败，采用乐观策略：读取失败只记 unobserved，不阻塞派发；详见能力卡 6 的修订节。

本组的实现判断全部并入 ADR-0009 的三层拆分与握手模型：定位器分类器保留但输入改为 Agent 交回的 pane 行；互斥锁 owner 改为操作 id 加 Controller 绑定；投影在登记、替换、退役、投递准备与释放时刷新；`hostVerifiedAt`、`hostAvailability`、`hostDirName` 删除。

## 修订（2026-09-18，[gate-log §13.97](../../progress/consolidation-gate-log.md) D3）

| 项 | 修订后 |
| --- | --- |
| Q3 宿主 hook 记录的语义边界 | 记录由观察脚本 `src/entrypoints/wakeflow-hook-observer.ts` 写入，两宿主同名同形，但它证明的是"发生过"而不是"现在如何"，四条边界随之成立：被打断或 API 失败的回合不触发 `Stop`，所以没有 `stop` 记录只等于本轮未完成，消费者照旧把缺席当 pending，不得读成失败；Codex 的 `SessionEnd` 只在归档、删除、正常退出或空闲 30 分钟后触发，`session-end` 最迟滞后 30 分钟，只作退役的缺席证据，不是活性信号；hook 在会话**当前目录**运行，`cwd` 随 Agent 的 `cd` 移动而不钉在窗口根，所以登记准入仍以 `session-start` 的 `cwd` 等于窗口根为准，后续事件的 `cwd` 只是事实不是判据；同一处理器被插件与用户设置各注册一次会得到两条时间不同的记录，重复无害，消费者取首条匹配 |
