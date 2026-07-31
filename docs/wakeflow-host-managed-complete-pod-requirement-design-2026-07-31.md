# Wakeflow 宿主管理的完整 Pod 需求设计（2026-07-31）

状态：需求设计，作为后续代码实现与验收的权威输入。
范围：Codex 版、Claude Code 版、共享 core、主线/Pod 放置决策。
不包含：本文件不授权发布、提交、合并产品仓库，亦不把尚未验证的宿主能力写成已完成事实。

## 0. 结论

> **主线是默认执行面；Pod 是用户明确要求后才创建的并发执行面。**

> **所有 Pod 角色都由宿主独立创建真实会话；所有拥有 Git 仓库责任的 Pod 窗口，都由对应宿主创建并管理独立 worktree。**

> **Wakeflow 只规划、预留、路由、登记和验真，不创建、删除或接管宿主 worktree。**

> **Wakeflow 不设置 Pod 数量上限；用户明确要求 Pod 时就进入创建流程。**

违反上述任一条的实现都不属于本需求。特别禁止以下“近似实现”：

- 已有需求时自动把下一需求设为 Pod；
- Wakeflow 先执行 `git worktree add`，再让宿主线程进入该目录；
- 用提示词要求子窗口自行 `cd`，但宿主线程实际上仍绑定父项目；
- 缺少精确项目时退回 WakeWorkspace 或其他父项目；
- 只创建 Pod Controller/Test/产品窗口而继续复用全局 Design；
- 线程创建成功但尚未完成 cwd/Git 身份验真，就把 Pod 标成 ready；
- 关闭 Pod 时由 Wakeflow 直接删除宿主 worktree 或 branch。

## 1. 用户确认的产品决策

### 1.1 本轮确认

| 决策 | 正典结论 |
| --- | --- |
| 默认放置 | 优先使用既有主线窗口和主检出 |
| Pod 触发 | 只有用户明确要求“新建 Pod 并发”时才允许 |
| Pod 数量 | Wakeflow 不设置总量或每仓上限；每次用户明确授权都可创建 |
| Pod 组成 | 独立 `Controller__<pod>`、`Design__<pod>`、`Test__<pod>`、每仓产品窗口 |
| 窗口创建 | 所有上述角色均为新建的独立宿主会话，不复用主线角色窗口 |
| Git 隔离 | 每个拥有 Git 仓库责任的 Pod 产品窗口使用宿主创建的独立 worktree |
| 资源所有权 | Codex/Claude Code 宿主拥有线程、session、worktree 和宿主清理语义 |
| Wakeflow 职责 | 输出 launch intent，记录逻辑状态和宿主回执，验证身份、证据与时序 |
| 主线占用时 | 无 Pod 明确授权则等待；不得自动隔离 |
| 主线异常时 | 先修复/重建主线；不得把 Pod 当作静默降级路径 |

### 1.2 被本设计取代的旧结论

本文件取代
`docs/wakeflow-unified-multi-demand-plan-2026-07-10.md`
中的下列旧裁定：

1. “Pod 不含 Design，Design 全局唯一”；
2. “整个 Pod 的所有角色直接共用 Wakeflow 创建的一套 worktree”；
3. “只要已有 active demand，下一需求自动成为 isolated placement”；
4. “Codex 线程以 Local 模式直接绑定 Wakeflow 预先创建的 worktree cwd”；
5. “Wakeflow Pod close 负责 `git worktree remove` 和 branch 删除”；
6. “`maxActiveDemands` 或 `maxStreamsPerRepo` 限制可创建的 Pod 数量”。

历史文档继续作为演进记录，不再指导新实现。

## 2. 真实代码与宿主事实

### 2.1 当前 Wakeflow 的真实偏差

当前实现不是“宿主拥有 worktree”：

- `core/scripts/wakeflow-pod.mjs` 调用 `addStreamWorktree()`；
- `core/scripts/lib/wakeflow-stream-overlay.mjs` 直接执行
  `git worktree add/remove/prune` 与 `git branch -d/-D`；
- `wakeflow-pod.mjs` 的窗口计划先生成 Wakeflow 自己的 cwd；
- Codex host profile 要求以 Local 线程直接绑定该 cwd，但当前
  `create_thread` 高层工具没有任意 cwd 参数；
- Pod 计划只有 Controller、Test 和产品窗口，没有独立 Design；
- `wakeflow-state init` 当前以“已有 active demand”为条件自动推导
  `executionPlacement.mode=isolated`；
- Claude helper 的 Pod 路径仍复用共享 core 创建的 worktree；
- Claude 产品窗口目前会被追加整个 workspaceRoot 的访问范围，削弱 Pod 隔离。

### 2.2 Codex 当前宿主能力

当前 Codex 宿主工具允许 Agent：

- `list_projects`：读取可用于建任务的精确项目；
- `create_thread`：
  - `environment: { type: "local" }`；
  - `environment: { type: "worktree", startingState? }`；
- `set_thread_title`；
- `read_thread` / 线程等待与读回；
- `fork_thread(environment: same-directory|worktree)`；
- `set_thread_archived`；
- `handoff_thread`。

`create_thread(environment=worktree)` 由 Codex 创建并维护 worktree。
官方文档说明 Codex-managed worktree 通常是线程专属、初始可为 detached
HEAD，且 worktree 生命周期由 Codex/Handoff 管理：
[Codex Worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees.md)。

当前高层工具不能接受 Wakeflow 提供的任意已有 cwd。因此正确方向不是补一个
Wakeflow worktree 路径，而是让 Agent 调用宿主 worktree 环境，再以后验回执
登记实际 cwd。

### 2.3 Claude Code 当前宿主能力

Claude Code 官方支持：

- `claude --worktree <name>` / `claude -w <name>` 创建隔离 worktree 会话；
- 无名称时由宿主生成名称；
- `worktree.baseRef` 选择 `fresh` 或 `head`；
- `.worktreeinclude` 复制经过允许的 gitignored 文件；
- `EnterWorktree` / `ExitWorktree`；
- `WorktreeCreate` / `WorktreeRemove` hooks；
- session resume 与 worktree 关联。

参考：

- [Claude Code Worktrees](https://code.claude.com/docs/en/worktrees)
- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-usage)
- [Claude Code Sessions](https://code.claude.com/docs/en/sessions)

因此 Claude helper 应调用 Claude 的 worktree 能力，而不是让共享 core
执行 Git。

## 3. 目标与非目标

### 3.1 目标

1. 主线可用时，普通需求稳定复用主线职责窗口。
2. 未经用户明确授权，不产生 Pod state root、Pod session、worktree 或
   Pod 注册。
3. 用户明确要求 Pod 后，创建一整套独立职责会话。
4. Codex 和 Claude Code 都由宿主创建产品 worktree。
5. Wakeflow 能在异步、部分成功、重启和重试场景下稳定恢复。
6. 任何错误项目、父项目、主检出或跨 Pod cwd 都在首次执行前被拒绝。
7. Pod redesign 留在 `Design__<pod>`，不返回主线 Design。
8. Pod Test 只接收该 Pod 已验真的候选环境，不访问其他 Pod 或主检出。
9. 业务状态保持宿主中立；真实 thread/session id 与绝对 cwd 只在宿主本地运行时。
10. 用户明确授权的 Pod 不受 Wakeflow 数字容量上限阻止。

### 3.2 非目标

- 不让 Wakeflow 自己成为 Git worktree manager。
- 不自动合并 Pod 产出。
- 不用 Pod 修复主线窗口缺失、上下文过重或项目配置错误。
- 不保留 `maxActiveDemands` 或 `maxStreamsPerRepo` 作为新 Pod 的 admission gate。
- 不承诺宿主和机器资源无限；真实宿主创建失败应原样进入 retryable/blocked，
  但 Wakeflow 不预先设置人工数字上限。
- 不强迫没有 Git 责任根的 Controller/Design/Test 创建无意义 worktree。
- 不保证“归档线程”等于“宿主立即物理删除 worktree”。
- 不把 Test 变成功能正确性的负责人。

## 4. 正典拓扑

### 4.1 主线

```text
Mainline
  Controller
  Design
  Test
  RepoA
  RepoB
  ...
```

主线窗口是工作空间初始化时创建的长期职责窗口。只要主线健康且没有另一个
`mode=main` 的未归档需求，新需求默认放在主线。

### 4.2 完整 Pod

```text
Pod <demandKey>
  Controller__<pod>
  Design__<pod>
  Test__<pod>
  RepoA__<pod>
  RepoB__<pod>
  ...
```

独立性的含义分两层：

| 层 | 要求 |
| --- | --- |
| 会话隔离 | 每个逻辑角色都是新建的独立 Codex thread 或 Claude session |
| 代码隔离 | 每个产品仓库窗口使用对应宿主新建的独立 worktree |

Controller、Design、Test 使用独立会话和该 Pod 的 canonical state root；
它们不强制创建父工作空间 worktree，否则 `.wakeflow-active`、本地注册和
状态投影可能被复制成多份权威。

### 4.3 Pod 内职责

- `Controller__<pod>`：唯一验收和派发权威，只操作本 Pod state root。
- `Design__<pod>`：初始需求设计、同需求补充设计和 redesign；不派发、不验收。
- `Test__<pod>`：S4 总控验收后执行已确认环境测试；不修代码、不扩写目标。
- `<Repo>__<pod>`：只拥有一个仓库和一个宿主 worktree；同需求内仍是一仓
  一窗口一组合任务包。

主线窗口与 Pod 窗口互不替代。Pod 关闭前，主线角色不得接管 Pod 的
Design/Test/acceptance。

## 5. 主线优先与 Pod 显式授权

### 5.1 “主线可用”的机器定义

主线可用必须同时满足：

1. workspace config 存在；
2. 主线 Controller/Design/Test 和本需求所需产品窗口已注册或可按既有
   replacement 流程恢复；
3. 没有未归档需求占用 `executionPlacement.mode=main`；
4. 主线项目身份可精确解析；
5. 没有阻止新需求进入主线的未决恢复状态。

主线窗口缺失或不健康时返回 `mainline-unavailable`，下一步是恢复主线，
不是自动创建 Pod。

### 5.2 放置决策表

| 主线状态 | 用户明确要求 Pod | 结果 |
| --- | --- | --- |
| 可用且空闲 | 否 | `main` |
| 可用但正被需求占用 | 否 | 等待，禁止新建 demand |
| 不健康/缺失 | 否 | 阻塞并恢复主线 |
| 任意 | 是 | 创建 `pod` provisioning |
| Pod 正在运行但主线空闲 | 否 | 仍优先 `main` |

### 5.3 显式授权合同

新 demand 的放置必须来自显式输入，而不是推导：

```json
{
  "executionPlacement": {
    "mode": "main",
    "podId": null,
    "selection": "mainline-default",
    "authorizationRef": null
  }
}
```

或：

```json
{
  "executionPlacement": {
    "mode": "isolated",
    "podId": "<stable-pod-id>",
    "selection": "explicit-user-pod",
    "authorizationRef": "<requirement-or-controller-event#anchor>"
  }
}
```

硬规则：

- `capacity.active.length > 0` 不再产生 isolated placement；
- `controllerWindow` 包含 `__` 不构成 Pod 授权；
- `maxActiveDemands`、`maxStreamsPerRepo` 不再参与新 Pod 决策，也不能阻止
  显式 Pod；
- `activeDemands` 可以继续作为观测列表，但不计算 `max`、`atCapacity` 或
  `capacity-blocked`；
- Auto Claim 只允许进入空闲主线，永远不自动创建 Pod；
- `wakeflow_pod_open apply=true` 必须找到同 demand 的
  `selection=explicit-user-pod`；
- `authorizationRef` 只保存可审计锚点，不复制聊天全文或私人内容。

## 6. 生命周期与时序

### 6.1 主线需求

```text
S0 intake
  -> S1 mainline Design
  -> create demand(mode=main)
  -> mainline Controller/产品窗口/Test
  -> complete
  -> archive
```

主线需求不调用 Pod 工具。

### 6.2 从 S0 明确要求 Pod

```text
用户明确 Pod
  -> 创建最小 state root(
       state=intake,
       placement=isolated,
       podProvisioning.phase=creating-control
     )
  -> 生成 Pod control launch plan
  -> Agent 调宿主创建 Controller/Design/Test
  -> 三个 control receipt 验真，进入 control-ready
  -> Design__pod 完成 S1
  -> 冻结仓库覆盖和 landing plan
  -> Agent 调宿主创建每仓产品 worktree 会话
  -> 产品 receipt 验真，进入 execution-ready
  -> Controller__pod 进入 S2-S6
```

先创建最小 state root 是为了让完整 Pod 从 Design 起就有唯一状态权威。
`podProvisioning.phase` 是同一 demand state root 内的宿主资源子阶段，不是
第二套状态权威，也不是新增的顶层 demand state。`control-ready` 只允许 S1
Design；只有 Design exit gate 与全部产品绑定同时满足，phase 才能进入
`execution-ready`，顶层 demand state 才从 `intake` 进入 `planned` 并允许产品
派发。

如果用户在 S0 已经确认了精确仓库覆盖，可以在同一轮宿主 materialize 中创建
产品窗口；但仍须分别达到 control-ready 和 execution-ready，不能因为产品线程
先启动就跳过 Design exit gate。

### 6.3 已完成 Design 后才明确要求 Pod

1. 原 Design 文档和用户确认 ledger 保持不变；
2. 创建 isolated state root，并引用原始 anchors；
3. 创建完整 Pod，包括 `Design__<pod>`；
4. `Design__<pod>` 读取已冻结设计，不重新发明需求；
5. 后续补充设计/redesign 只由 `Design__<pod>` 处理。

### 6.4 宿主创建的两阶段协议

#### Phase A：plan/reserve

Wakeflow：

- 检查显式授权、需求身份和仓库覆盖；
- 写入 host-neutral `state=intake` 与 `podProvisioning.phase`；
- 生成 logical window plan；
- 不创建 branch、worktree、thread/session；
- 不写动态 repo overlay。

#### Phase B：materialize/bind

Agent：

1. 调用宿主查找精确项目；
2. 调用宿主创建独立会话/worktree；
3. 等待异步创建完成；
4. 获取真实 thread/session handle；
5. 获取宿主实际 cwd 和 Git 身份；
6. 调用 Wakeflow bind 工具；
7. 全部必需绑定通过后才发布 `pod.ready`。

## 7. 宿主中立合同

### 7.1 Launch intent

每个窗口计划至少包含：

```json
{
  "demandKey": "...",
  "podId": "...",
  "windowName": "RepoA__pod",
  "role": "product",
  "repositoryWindow": "RepoA",
  "repositoryRoot": "<local exact root>",
  "host": "codex|claude-code",
  "environmentIntent": "host-worktree|host-local",
  "startingStatePolicy": "default|working-tree|fresh|head",
  "displayTitle": "...",
  "createPrompt": "...",
  "launchCorrelationId": "..."
}
```

`repositoryRoot` 是宿主本地输入，不进入 tracked docs。计划不得含推导的
worktree cwd 或虚构 branch。

### 7.2 Provisioning receipt

宿主创建完成后回传：

```json
{
  "launchCorrelationId": "...",
  "windowName": "...",
  "host": "...",
  "handleRegistered": true,
  "actualCwd": "...",
  "gitTopLevel": "...",
  "gitCommonDir": "...",
  "head": "...",
  "branch": null,
  "detached": true,
  "mainCheckout": false,
  "createdAt": "..."
}
```

真实 handle 仍只写 host-scoped registry，不得出现在 receipt、工具输出、
tracked docs 或归档。

### 7.3 Binding 验真

产品窗口绑定必须验证：

- `actualCwd` 存在且 realpath 稳定；
- `gitTopLevel === actualCwd` 或命中宿主允许的工作根；
- Git common dir 对应配置中的目标仓库；
- actual cwd 不是主检出；
- window/repository/demand/pod/host 一致；
- 同一 `(host, demand, repo)` 不存在第二个活动产品绑定；
- thread/session handle 是最终真实 handle，不是异步 client id；
- 初始 HEAD 符合 launch intent 的 starting-state policy。

Controller/Design/Test 验证：

- 是不同真实会话；
- 绑定同一 Pod state root；
- 不读取或写入其他 Pod state root；
- 不把本地 handle 或路径写入任务文档。

### 7.4 本地存储

建议新增：

```text
.wakeflow-local/wakeflow-delivery/hosts/<host>/
  thread-registry/
  window-config/
  pod-bindings/<pod-id>/<window>.json
  pod-operations/<launch-correlation-id>.json
```

- registry 继续只保存 logical window、真实 handle、bindingId 和时间；
- cwd/Git/宿主操作事实进入 `pod-bindings`；
- tracked state 只保存逻辑窗口状态与宿主无关事件；
- 不再用一份跨宿主动态 config overlay 充当 Pod cwd 权威。

### 7.5 Pod provisioning 子阶段

```text
reserved
  -> creating-control
  -> control-ready
  -> designing
  -> creating-products
  -> execution-ready
```

失败状态：

```text
creating-* -> retryable
creating-* -> blocked
creating-* -> cancelling -> closed
```

这些值只属于 `podProvisioning.phase`。顶层 `state.state` 继续使用既有
`intake/planned/dispatched/...` 状态集合；不得把 `designing`、
`creating-control` 等宿主资源阶段加入顶层 reducer 状态。

重试必须复用 `launchCorrelationId` 并先发现已有宿主操作/线程，禁止盲目再次
`create_thread` 或 `claude --worktree`。

Codex 恢复不得依赖 `list_threads.query`，因为宿主版本可能不暴露该参数。
固定基线是有界 `list_threads(limit=50)`，在返回任务的 `preview` 中精确匹配
`Wakeflow launch correlation: <launchCorrelationId>` 标记；宿主明确支持
`query` 时只能把它当作缩小结果集的优化。只有唯一匹配的最终 `threadId`
允许写入 `finalized`；零个匹配继续等待/阻塞，多个匹配直接阻塞，二者都不能
再次调用 create。

### 7.6 Pod Design request/handoff

Pod Design 不调用全局 `wakeflow_deliver`，也不向全局 TODO 新建同需求工作。

正确回路：

```text
Controller__pod
  -> wakeflow_pod_prepare_design_request
  -> host send to Design__pod
  -> Design__pod returns PodDesignHandoffEnvelope
  -> wakeflow_pod_record_design_handoff
  -> controller validates Design exit gate
  -> create/update task packages
```

`PodDesignRequest` 至少携带：

- demand/pod identity；
- 原始目标和权威 requirement anchors；
- 请求类型：initial-design、supplement 或 redesign；
- 当前代码事实证据入口；
- 被暂停的 target/review identity（redesign 时）；
- 明确非目标和需要用户裁决的问题。

`PodDesignHandoffEnvelope` 至少携带：

- 对原始目标的保持声明；
- 真实代码事实与证据 refs；
- 用户确认结果；
- per-window landing plan；
- designIntent；
- Test decision/environment spec；
- redesign replacement lineage（如适用）。

Design 只返回 envelope，不直接修改 controller state。Controller 通过专用
record 工具把 handoff 写入 state root 并推进状态。这个回路不是 target
result，也不参与产品 acceptance 计数。

## 8. Codex 宿主实现要求

### 8.1 精确项目选择

Agent 必须：

1. 调用 `list_projects`；
2. 以规范化 repository root 精确匹配 saved project；
3. 找不到时返回 `project-not-registered`；
4. 禁止使用 WakeWorkspace 父项目代替产品项目；
5. 禁止退回 `environment=local` 运行产品 Pod 窗口。

### 8.2 创建规则

| 角色 | Codex 创建方式 |
| --- | --- |
| Controller__pod | 新建独立 control-project local thread |
| Design__pod | 新建独立 Design/control-project local thread |
| Test__pod | 新建独立 Test/control-project local thread |
| Repo__pod | 精确 repo project + `environment.type=worktree` |

宿主若返回异步 `clientThreadId`，必须先按 launch correlation 写入
materialization journal，再等待/搜索同一次创建的最终 `threadId`；临时 id
只保留摘要，绝不能进入 registry，也不能触发盲目重建。最终 task 完成
entry-sync 读回后才登记。

### 8.3 起点一致性

Pod 产品 worktree 默认从已确认的主线 clean HEAD 创建，而不是从未验证的远端
默认分支或主检出未提交状态创建。

每个 launch intent 固定：

- `expectedBaseHead`；
- `basePolicy=local-head`；
- base repository/branch identity。

Codex 通过 `startingState` 选择对应现有 branch/ref，创建后必须验证实际初始
HEAD。主检出有未提交改动时，默认阻止 Pod；只有用户明确选择且两个宿主都能
给出等价快照证据时，才允许 working-tree snapshot。

### 8.4 Entry sync

产品窗口首次 turn 只做身份回执：

1. `pwd`；
2. `git rev-parse --show-toplevel`；
3. `git rev-parse --git-common-dir`；
4. `git rev-parse HEAD`；
5. branch/detached；
6. 声明 logical window、repo、pod；
7. 等待正式 task package。

身份回执不是产品任务结果，不得先写代码。

### 8.5 关闭

Wakeflow 生成 host close plan，Agent 调用 Codex archive/Handoff 能力。
Wakeflow 只有在宿主确认线程已归档/移交后才撤销逻辑绑定。

不得声称 `set_thread_archived` 已物理删除 worktree；物理 GC 属于 Codex。

## 9. Claude Code 宿主实现要求

### 9.1 创建规则

Claude helper 从目标主仓根目录调用宿主：

```text
claude --worktree <host-safe-name>
```

helper 可以用既有 tmux 承载窗口，但 tmux 只是会话容器，不拥有 Git 生命周期；
在这种模式下不得再传 Claude 自带的 `--tmux`，避免嵌套 tmux 和错误 pane 归属。

| 角色 | Claude 创建方式 |
| --- | --- |
| Controller__pod | Pod tmux session 中独立 Claude session |
| Design__pod | Pod tmux session 中独立 Claude session |
| Test__pod | Pod tmux session 中独立 Claude session |
| Repo__pod | 从精确 repo root 以 `claude --worktree` 启动独立 session |

Claude 默认可能从 `origin/HEAD` 创建 worktree，而不是当前本地主线 HEAD。
Pod 默认必须使用 `worktree.baseRef=head` 或等价宿主配置，并在 receipt 中验证
实际 HEAD 等于 launch intent 的 `expectedBaseHead`。不一致时阻止 bind。

### 9.2 回执

启动后 helper 从实际 pane/session 获取：

- pane current path；
- Claude session id；
- Git top-level/common-dir/HEAD/branch；
- worktree 是否为主检出；
- tmux session/window 身份。

先写 host binding，再通过 Wakeflow bind 发布逻辑 ready。

### 9.3 恢复

- 已绑定窗口从 receipt 的实际 cwd 恢复 session；
- 恢复使用 `--resume`，不得再次传 `--worktree`；
- 缺 receipt 时先侦测已有宿主 session/worktree；
- 无法唯一对应时 fail-closed，不新建第二套。

### 9.4 访问范围

Pod 产品窗口不得无条件 `--add-dir <workspaceRoot>`。

允许范围只能包括：

- 当前产品 worktree；
- 当前 demand state root 的必要只读/证据路径；
- task package 明确列出的少量依赖路径。

Controller/Design/Test 也只能获得当前 Pod state root 和本 Pod 已绑定
worktree 的必要访问，不得默认获得其他 Pod worktree。

### 9.5 关闭

Claude Code 对有修改的 worktree 可能要求保留/删除选择；非交互模式也不会保证
自动清理。因此：

- helper 先请求 session 正常结束；
- 有改动/commit 时保留宿主 worktree，记录 integration disposition；
- 只有宿主确认已删除时才标记 `host-worktree-removed`；
- Wakeflow 不执行 `git worktree remove` 补救；
- tmux window/session 关闭与 worktree 物理清理分开记录。

## 10. Design、Test 与 worktree 的关系

### 10.1 Design

Pod Design 是独立需求角色，不是产品代码 owner。它读取真实代码时使用：

- 已绑定产品 worktree 的只读路径；或
- 由 Controller 发起的有界只读调查证据。

Design 不在产品 worktree 中写代码。

### 10.2 Test

`Test__<pod>` 必须是独立宿主会话，但不能假设当前宿主天然允许一个线程访问
多个别的线程的 worktree。

当前实现只开放一条可验证路径：

1. `wakeflow_pod_prepare_test_access` 生成绑定集合对应的宿主本地探测计划；
2. 独立 `Test__<pod>` 对全部产品 worktree 做 direct-multi-root 读取与 Git
   身份探测；
3. `wakeflow_pod_record_test_access` 只有在全部 active binding 都匹配时记录
   `validated + direct-multi-root` 并开放 Test 派发；
4. 宿主不支持或探测失败时记录 blocked，禁止回到主检出或让产品窗口冒充
   独立 Test。

per-repo executor 仍是可能的未来宿主能力，但本阶段未实现、未验证，也不构成
fallback。

这个能力必须通过真实宿主测试确认，不能仅靠提示词宣称。

## 11. 失败恢复

| 中断点 | 恢复规则 |
| --- | --- |
| state root 已建、无窗口 | 重跑 plan；不重复创建 state root |
| host create 已提交、无最终 handle | 以 correlation id 等待/发现，不重复 create |
| 最终 handle 已有、未 bind | 读取 entry-sync 回执后补 bind |
| 部分窗口 ready | 只创建缺失窗口 |
| 身份验真失败 | 保留证据、标 blocked；不得改 cwd 或降级主线 |
| Controller/Design/Test 缺一 | Pod 不 ready |
| 产品窗口创建失败 | Pod 不 dispatch；可取消并由宿主清理已建窗口 |
| 宿主重启 | 从 registry + pod-binding 恢复，不推导路径 |
| close 部分成功 | 逐窗口记录 host-close receipt，幂等续关 |

## 12. 状态与历史迁移

1. 新需求执行本设计。
2. 已存在且由旧逻辑创建的 isolated demand 不自动改写历史。
3. 旧 Pod 可按 legacy read/close 路径完成，但不得创建新的 Wakeflow-owned
   worktree。
4. WakeWorkspace 是可破坏测试环境，可清理旧 Pod 后重新验证。
5. 非测试工作区的旧 worktree/branch 必须保留并提示用户处理，不能自动迁移或删除。
6. `stream-overlay` 中直接 Git 创建/删除函数从新 Pod 主路径移除；仅在明确的
   legacy recovery 中保留，且不得由普通 `pod_open` 调用。

## 13. 实现前测试迁移裁定

**旧产品裁定测试不得继续充当新实现的验收权威。违反这条规则，就是在用测试
恢复已经被用户否决的产品行为。**

本节是代码实现前的 Phase 0。测试只分四类：

| 分类 | 处理 |
| --- | --- |
| DELETE | 测试唯一目的就是固定已废弃行为；删除，不改成宽松断言 |
| REWRITE | 场景或安全不变量仍有价值，但输入、时序或预期必须按新正典重写 |
| KEEP | 与 Pod 放置、宿主 worktree 所有权和数量上限无关，必须保持全绿 |
| ADD | 新需求没有现成覆盖，先写成准确 RED 测试 |

不得用 `.skip`、`.todo`、放宽正则、预建 Wakeflow worktree 或伪造宿主成功来
绕过迁移。DELETE 必须与替代测试在同一开发阶段落地，不能先永久丢失安全覆盖。

### 13.1 整文件裁定

| 文件 | 当前固定的旧行为 | 裁定 |
| --- | --- | --- |
| `test/wakeflow-claude-stream.test.mjs` | `stream-open/close` 由 Wakeflow 创建、删除 Git worktree/branch；derived overlay 是 cwd 权威；pool cap 拒绝 Pod | **DELETE** 正典文件；由 `wakeflow-claude-pod-host.test.mjs` 替代。确需保留的旧版本 read/close 只能进入明确命名的 legacy recovery suite，普通 `pod_open` 不得调用 |
| `test/wakeflow-pod.test.mjs` | shared Wakeflow worktree set、Pod 无 Design、core 直接 Git、close 物理删除、按目录收养 orphan | **整体 REWRITE** 为宿主中立 plan/bind/ready/close 合同；只有 MCP runtime allow-list 测试可原样保留 |
| `test/wakeflow-multi-demand.test.mjs` | 第二需求自动 isolated、第三需求 capacity failure、archive 释放数字槽位 | **整体 REWRITE** 为主线默认、无授权等待、显式 Pod、无限数字 admission 和跨 demand 状态隔离 |
| `test/wakeflow-parallel-vocabulary-lint.test.mjs` | 强制 `ONE worktree set`、旧全局 Design 和容量叙述 | **整体 REWRITE**，固定“mainline default / explicit Pod / full Pod roles / host-created product worktree / no numeric cap” |

### 13.2 `wakeflow-pod.test.mjs` 逐项迁移

| 当前测试 | 裁定 | 新预期 |
| --- | --- | --- |
| `codex pod open prepares the shared worktree set...` | REWRITE | `pod open` 只写 canonical provisioning 和 launch intent；零 worktree、branch、derived overlay；计划包含 Controller、Design、Test 和每仓产品窗口 |
| `pod open consumes persisted placement...` | REWRITE | main 拒绝；isolated 但缺 `selection=explicit-user-pod` 或 `authorizationRef` 也拒绝 |
| `the pool caps demands per repo` | REWRITE | 同一 Pod/repo 只允许一个产品绑定；任意数量显式 Pod 可使用同一 repo，intersection 只提示 |
| `multi-repo pod capacity...` | DELETE/REPLACE | 不再测试容量拒绝；改测多仓 plan 原子生成、非法 repo 时零 host operation/binding |
| `state init consumes a prepared pod reservation...` | REWRITE | 时序反转：先创建 `state=intake` canonical root，再 plan/materialize/bind |
| `repairs a stale derived overlay...` | DELETE | 新 Pod 不使用动态 repo overlay；普通路径必须证明不会创建该文件 |
| `pod close ... dirty worktrees ... pending merges` | REWRITE | close 只生成 host close plan；不检查或删除 Git；逐窗口 host-close receipt 后才解除逻辑绑定 |
| `claude edition defers transport...neutral-only` | REWRITE | Claude intent 使用 native `--worktree`；删除 `neutral-only` 旧补丁语义 |
| `every MCP handler script is on the runtime allow-list` | KEEP | 保留 |
| `register-thread accepts pod-shaped windows...` | REWRITE | 不能仅凭 `__` 名称注册；必须命中 launch correlation、角色和 Pod；加入 `Design__pod` |
| `prepared pod is resumed...` | REWRITE | correlation + binding receipt 恢复；已创建窗口不得再次 materialize |
| `pod close accepts a cancelled demand...` | REWRITE | cancelled 可生成 close plan，但 Wakeflow 不物理删除 worktree |
| `adopts a crash-orphaned worktree...` | DELETE | 新路径禁止按目录/branch 名猜测和收养；如保留，只能作为显式 legacy recovery |

### 13.3 散落测试裁定

| 文件 / 当前测试 | 裁定 |
| --- | --- |
| `test/wakeflow-state.test.mjs` — `maxActiveDemands=1` 拒绝第二需求 | REWRITE：第二普通需求因 `mainline-busy` 等待且零 state；遗留 cap 不参与；带显式授权的 Pod 成功 |
| `test/wakeflow-state.test.mjs` — 全局 stateless redesign | REWRITE：主线行为继续保留；Pod redesign 使用 `PodDesignRequest → PodDesignHandoffEnvelope → controller record` |
| `test/wakeflow-state-schema.test.mjs` | KEEP 顶层 state enum；`designing/creating-*` 仍不得加入顶层。ADD `podProvisioning.phase` schema、双版 parity 和合法 transition 覆盖 |
| `test/wakeflow-next-work.test.mjs` — capacity warning | REWRITE：候选可见但为 `waiting-mainline`，不可 Auto Claim；只报告 active facts，不再有 `demandCapacity.max/atCapacity` |
| `test/wakeflow-workspace-invariants.test.mjs` — configured-current capacity 两例 | REWRITE：保留 custom current 解析；普通第二需求等待，显式 Pod 可创建 |
| 同文件 — main checkout occupancy / pod state lookup | REWRITE：显式授权和 state root 从 configured current 解析；`pod_open` 只出 host plan，零 `.wakeflow-local/worktrees` |
| 同文件 — symlink root blocks capacity | REWRITE：仍 fail-closed，但原因是 unsafe/unreadable authority，不是容量 |
| 同文件 — init staging ignored by capacity | REWRITE：保留 staging 不进入 active observation/projection；删除 `atCapacity` |
| 同文件 — Pod reservation projection | REWRITE：投影 canonical `podProvisioning` + host operations；损坏 authority 仍 degraded |
| 同文件 — one demand identity/two roots | KEEP，删除无关 cap fixture |
| `test/wakeflow-config-name.test.mjs` — legacy/canonical config precedence | REWRITE：用 workspace identity/path 等稳定字段验证；旧 cap 只产生迁移提示且不进入 canonical config |
| 同文件 — legacy `stream-open` 创建 overlay | DELETE 该耦合；配置名迁移不得通过创建 worktree 来证明 |
| 同文件 — effective derived stream overlay | REWRITE：Pod binding 不再是 config overlay；保留显式 config 与手写 local 文件的安全边界 |
| `test/wakeflow-setup.test.mjs` — preserve derived stream overlay | REWRITE：configure 不破坏 host-scoped pod bindings/operations；不再保护旧 repo overlay |
| 同文件 — Codex local thread binds Wakeflow worktree cwd | REWRITE：主线初始化使用 saved project local；Pod 产品窗口另走宿主 worktree materializer |
| `test/wakeflow-state-invariants.test.mjs` — same-key init uses `capacity-lock` barrier | KEEP 不变量、REWRITE harness：使用 demand identity/provisioning lock；16 路同 key 仍只有一个权威 root |
| `test/wakeflow-result-contract-invariants.test.mjs` — 两 demand fixture | KEEP namespace 隔离；删除 `maxActiveDemands`，以显式 placement 建立第二 demand |
| `test/wakeflow-archive-demand.test.mjs` — cancelled root “holds capacity” | KEEP 行为，仅把说明改为“未归档 authority 仍占用其 lifecycle/placement” |
| `test/claude-host-surface.test.mjs` — host launch spec | REWRITE Pod product 输入为 repositoryRoot、expectedBaseHead、correlation 和 `host-worktree`；不得含推导 cwd；tmux 容器不得嵌套 `--tmux` |
| `test/claude-host-helper.test.mjs` — Pod launch/replace/permissions | REWRITE：首次 product argv 有一次 `--worktree`，resume 只有 `--resume`，不默认 `--add-dir workspaceRoot`，加入 Pod Design role |
| `test/wakeflow-parallel-vocabulary-lint.test.mjs` | ADD 负向检查：规范性表面不得再宣称 shared Wakeflow worktree、automatic isolated placement 或数字 Pod cap |

### 13.4 必须原样保留的稳定不变量

下列测试不是旧容量设计，不能为了新实现方便而删除：

- `test/wakeflow-host-ownership.test.mjs`：controller host ownership 与显式
  adoption；
- `test/wakeflow-state-concurrency.test.mjs`：state-root read/modify/write 锁；
- `test/wakeflow-demand-create.test.mjs`：完整输入预检、同 intent 并发、
  crash compensation、恢复和 identity drift；
- `test/wakeflow-delivery-atomicity.test.mjs`、delivery store/boundary tests：
  transport 与 state root 隔离；
- `test/wakeflow-result-contract-invariants.test.mjs`：result/group/history
  不跨 demand 合并；
- `test/wakeflow-intent-alignment.test.mjs`：`designIntent` 仍是 advisory；
- archive、redaction、filesystem safety、symlink、path containment、sync-core、
  plugin layout 和双版 version parity 测试。

这些测试可以调整 fixture 以删除旧 cap 字段，但不能削弱原不变量。

### 13.5 最小新增测试集合

为避免再次扩张成大量重复文件，只新增三套并整体重写一套：

1. `test/wakeflow-placement-policy.test.mjs`
   - 普通需求在空闲主线进入 `mainline-default`；
   - 主线忙时普通/Auto Claim 需求等待，零 state/host/worktree；
   - 只有显式 authorization 进入 Pod；
   - 活跃 Pod 不改变空闲主线默认；
   - legacy cap 为 0/1 时，三个以上显式 Pod 和多个同仓 Pod 仍可
     provisioning；
   - controller 后缀不能伪造授权。
2. 重写后的 `test/wakeflow-pod.test.mjs`
   - 完整 Controller/Design/Test/product launch plan；
   - `podProvisioning.phase` 时序；
   - plan 阶段零 Git、零宿主资源；
   - receipt 身份验真和原子 bind；
   - partial creation 重试只补缺失窗口；
   - 缺任一 control role 不 ready；
   - Pod Design request/handoff；
   - logical close 与 host cleanup 分离。
3. `test/wakeflow-codex-pod-host.test.mjs`
   - control roles 为不同 local threads；
   - product 使用精确 project + `environment.type=worktree`；
   - 找不到项目时不回退父项目/local；
   - client id 不可 bind，最终 thread id 才可登记；
   - expectedBaseHead、actual cwd/common-dir/main-checkout 验真；
   - archive/Handoff 不等于物理 worktree 已删除。
4. `test/wakeflow-claude-pod-host.test.mjs`
   - 产品首次启动使用 Claude native `--worktree`；
   - 不嵌套 `--tmux`，不默认添加 workspaceRoot；
   - `baseRef=head` 与 actual HEAD receipt；
   - resume 不再次传 `--worktree`；
   - helper 重跑不创建第二套 session/worktree；
   - session close 与 worktree removal receipt 分离。

现有 `host-ownership`、`delivery`、`task-context`、`sync-core` 测试只增加少量
Pod 场景，不再另拆重复测试文件。

| 既有测试文件 | 只增加的 Pod 场景 |
| --- | --- |
| `test/wakeflow-host-ownership.test.mjs` | provisioning 时固定 `controllerHost`；另一宿主不可同时 materialize；已有 binding 后不可无条件 adopt |
| `test/wakeflow-delivery.test.mjs` | `execution-ready` 前禁止产品 dispatch；registry 只接受最终 handle；cwd/Git 事实只来自 binding |
| `test/wakeflow-task-context.test.mjs` | 任务 prompt 使用已验真 binding，不从静态 config/窗口后缀推导 cwd，也不泄漏其他 Pod 路径 |
| `test/sync-core.test.mjs` | host-neutral provisioning/binding 合同双插件同步；Codex/Claude host adapter 仍保持宿主专属，不被 sync 覆盖 |

根测试命令使用 `test/*.test.mjs` 动态 glob，删除/新增测试文件不需要维护一份
测试名单。若同时删除旧 runtime 脚本，则必须更新 core manifest、双插件
`wakeflow-core-manifest.json`、runtime allow-list、MCP handler 引用和
`scripts/README.md`；不能把同步失败误判成新行为测试失败。

### 13.6 RED 基线门禁

测试迁移和实现必须按以下顺序：

1. 在一个测试变更中删除/重写旧裁定测试，并加入新设计测试；
2. 先运行受影响的聚焦测试，记录准确的预期 RED 名单和失败原因；
3. 只允许新需求尚未实现导致的 RED；KEEP 集合和无关测试必须继续全绿；
4. 若新测试在未改实现前已经通过，先确认它是否真的穿过真实入口，禁止把
   “没有执行到目标代码”当作 RED/GREEN；
5. 然后才修改 core、Codex materializer 和 Claude materializer；
6. 每个阶段结束都运行新测试、KEEP 聚焦集、`sync-core --check`；
7. 最后才运行全量 test、validate、smoke 与 WakeWorkspace 真实宿主验证。

开发中修改测试必须能指向本节某一条需求变化。不得因为实现困难而把新断言改回
旧行为，也不得让 Node stub 代替 Codex/Claude 宿主真实验收。

## 14. 代码落地阶段

### Phase 1：放置授权

代码范围：

- `core/scripts/wakeflow-state.mjs`
- `core/scripts/wakeflow-demand-sequence.mjs`
- `core/scripts/wakeflow-next-work.mjs`
- `core/scripts/lib/wakeflow-active-demands.mjs`
- `core/scripts/lib/wakeflow-config.mjs`
- `core/lib/wakeflow-mcp-tools.mjs`
- 双插件 `wakeflow.config.example.json`
- placement、legacy config 与并发初始化测试

实现：

- 删除 `capacity.active.length > 0 => isolated`；
- 删除 `maxActiveDemands` 的 claim/init fail-closed；
- 删除新 Pod 路径中的 `maxStreamsPerRepo` pool-exhausted；
- `activeDemands` 只报告当前事实，不再输出或计算人工容量；
- 旧配置字段只作兼容读取并给出迁移提示，最终从示例、README、skills 和
  schema/config normalize 中移除；
- 增加显式 main/pod selection 与 authorizationRef；
- Auto Claim 只走空闲主线；
- mainline busy 时返回 waiting，不创建 state；
- 显式 Pod 创建 `state=intake` 且
  `podProvisioning.phase=creating-control` 的 canonical state root。

验收：

- 第二需求没有 Pod 授权时零 state root、零 host operation、零 worktree；
- 用户连续明确授权多个 Pod 时，Wakeflow 不因数量或同仓 Pod 数拒绝；
- 并发创建仍通过 demand identity、reservation 和 provisioning lock 防止
  同一 Pod 重复创建。

### Phase 2：宿主中立 Pod lifecycle

代码范围：

- `core/scripts/wakeflow-pod.mjs`
- `core/scripts/lib/wakeflow-pod-reservations.mjs`
- `core/scripts/lib/wakeflow-stream-overlay.mjs`
- `core/schemas/wakeflow-state-machine/wakeflow-state.schema.json`
- host-scoped binding/config runtime

实现：

- `pod_open` 变为 plan/provision；
- 新增原子 bind；
- 从新路径移除所有 Git 创建/删除；
- 完整窗口计划加入 Design；
- 新增 PodDesignRequest/Handoff record 路径；
- `pod_list` 基于逻辑 state + host binding；
- `pod_close` 输出 host close plan。

验收：shared core 中新 Pod 主路径不执行任何 `git worktree`/branch 写操作。

### Phase 3：Codex materializer

实现：

- launch plan 输出精确 project match + worktree environment；
- Agent 调 `list_projects/create_thread/set_thread_title`；
- 异步 handle 恢复；
- entry-sync identity receipt；
- archive/Handoff close receipt。

验收：两个 Codex Pod 对同一 repo 并行时，主检出不变、线程与 worktree
互不相同、重启后绑定仍准确。

### Phase 4：Claude Code materializer

实现：

- helper 改用 `claude --worktree`；
- pane cwd/Git/session receipt；
- resume 不重复创建；
- 移除 Pod 产品窗口的全 workspace `--add-dir`；
- tmux close 与 worktree cleanup 分离。

验收：两个 Claude Pod 对同一 repo 并行，均由 Claude 创建 worktree，
主检出不变，任一 helper 重跑不增加第三个 worktree。

### Phase 5：完整 Pod 角色与文档

实现：

- `Design__<pod>` role recognition、prompt、registry、list、close；
- redesign 留在 Pod；
- Test direct-multi-root access probe；unsupported 时保持 blocked，不做 fallback；
- 双插件同步；
- README、AGENTS、skills、stage route、架构文档更新；
- 旧多需求计划标注 superseded。

## 15. 验收标准

### 15.1 主线优先

- 首个普通需求进入 `main`。
- 主线空闲但已有其他 Pod 时，普通需求仍进入 `main`。
- 主线忙时第二普通需求保持等待。
- Auto Claim 不会创建 Pod。
- 伪造 `Controller__x` 不会授权 Pod。
- 遗留配置中的 `maxActiveDemands` 不会阻止显式 Pod，也不会开启 Pod。

### 15.2 显式 Pod

- 用户明确 Pod 就进入 `state=intake` +
  `podProvisioning.phase=creating-control`；Wakeflow 不做数量 admission。
- 多个显式 Pod 可以使用同一产品仓库，各自由宿主创建独立 worktree。
- 遗留配置中的 `maxStreamsPerRepo` 不会阻止新的宿主管理 Pod。
- 创建完整 Controller/Design/Test/产品窗口集合。
- 每个逻辑窗口对应不同真实宿主会话。
- 每个产品窗口由宿主创建 worktree。
- control-ready 之前不能 Design，execution-ready 之前不能产品派发。
- Pod Design handoff 不产生全局 TODO，也不返回主线 Design。
- 没有任何产品窗口落在主检出或父 WakeWorkspace。
- Pod 缺少任一必需窗口时不可 dispatch。
- Pod Test 必须有覆盖全部 active 产品绑定的 validated
  direct-multi-root 回执；unsupported 不回退主检出、产品窗口或未经验证的
  per-repo executor。

### 15.3 Codex

- 精确 repo project 匹配失败时 fail-closed。
- 产品线程实际 environment 是 worktree。
- clientThreadId 不会进入 registry。
- entry-sync 与 controller readback 一致。
- worktree 初始 HEAD 与 launch intent 的 expectedBaseHead 一致。
- archive 后 Wakeflow 不声称物理 worktree 已删除。

### 15.4 Claude Code

- 真实启动命令包含宿主 `--worktree`。
- shared core 不创建该 worktree。
- resume 不再次 `--worktree`。
- pane cwd 与绑定回执一致。
- Claude worktree 初始 HEAD 与预期主线 HEAD 一致。
- 产品窗口没有整个 workspaceRoot 的默认访问权。
- worktree 保留/删除取决于 Claude 宿主结果。

### 15.5 隔离与恢复

- Pod A 无法读取/写入 Pod B state root 和 worktree。
- Pod redesign 只返回 `Design__A`。
- 部分创建重跑只补缺失窗口。
- 宿主重启后不通过路径命名猜测身份。
- 任意 binding 冲突保持 blocked，不覆盖旧绑定。
- tracked docs、归档和工具输出均不泄露真实 handle。

## 16. 风险与可信度

| 项目 | 当前可信度 | 风险 | 处理 |
| --- | --- | --- | --- |
| Codex 产品线程由宿主创建 worktree | 高 | 异步 handle/readback | 两阶段 bind |
| Claude `--worktree` 创建隔离会话 | 高 | trust/baseRef/退出清理 | preflight + receipt |
| 主线默认、显式 Pod | 高 | 旧自动 placement 兼容 | 新写入严格、旧状态只读兼容 |
| 移除 Wakeflow 数字 Pod 上限 | 高 | 真实宿主资源耗尽 | 宿主失败如实 retryable/blocked，不恢复人工上限 |
| 完整 Pod 加入 Design | 高 | 旧 redesign 路由依赖全局 Design | pod role/routing 全链更新 |
| 单一 Test 直接访问多 repo worktree | 中 | Codex/权限根能力不统一 | 已实现 direct-multi-root access probe；unsupported 保持 blocked。per-repo executor 尚未实现，不作为 fallback |
| 宿主归档即物理删除 worktree | 低，不得假设 | 丢失/残留误报 | 分离 logical close 与 host cleanup |
| 双宿主同一 demand 同时创建 | 不允许 | 重复资源和分叉 | controllerHost + provisioning lock |

## 17. 实现完成定义

只有同时满足以下条件，才能声称本需求完成：

1. 新 Pod 主路径不含 Wakeflow 直接 Git worktree 写操作；
2. Codex 与 Claude Code 都通过各自宿主能力真实创建产品 worktree；
3. Pod 拥有独立 Controller、Design、Test 和产品窗口；
4. 默认主线，只有用户明确授权才可能出现 Pod；
5. `maxActiveDemands`、`maxStreamsPerRepo` 不再限制 Pod 创建，且旧字段不再
   影响新放置；
6. partial creation、重启、resume、close 均有真实回执与幂等测试；
7. 双版聚焦测试、全量测试、validate、smoke、sync-core 全通过；
8. WakeWorkspace 完成主线 + 至少三个显式 Pod 的真实并行测试；
9. 测试证明主检出未被 Pod 写入，且未授权第二需求没有创建任何 Pod 资源；
10. Pod Test 只有在 direct-multi-root access probe 覆盖全部 active 产品绑定后
    才能派发；unsupported 时保持 blocked；
11. README、AGENTS、skills 与真实代码保持一致；
12. 未经用户另行要求，不提交、不推送、不发布。
