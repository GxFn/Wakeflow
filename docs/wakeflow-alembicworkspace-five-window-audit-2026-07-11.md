# Wakeflow 在 AlembicWorkspace 的五窗口真实审计记录与问题分析（2026-07-11）

> 文档性质：真实环境使用记录、事故分析与修复建议。
>
> 现场快照：2026-07-11 08:09 CST。
>
> 结论状态：事故分析与 Wakeflow 源码修复完成；原 demand 仍待其真实总控处理，尚未完成、裁决或归档。

**事实、建议、决策必须分离。本文记录的目标仓产品发现仍是 target evidence，未经 Wakeflow 总控接受，不得当成已裁决缺陷或实施授权。**

## 1. 执行摘要

本次真实使用从 `Design 需求窗口` 发起，目标是在 AlembicWorkspace 中对 Alembic、AlembicCore、AlembicAgent、AlembicDashboard、AlembicPlugin 五个仓库进行只读深度审计。系统成功创建一个 demand、生成五个任务包、完成五次真实线程投递和 readback，并收到了部分结构化结果；但它没有形成一个健康的 Wakeflow 闭环。

截至现场快照：

- 权威 demand 状态为 `dispatched`，revision 12。
- 五个 delivery 均记录为 `sent` 且 `readbackOk=true`。
- Alembic 与 AlembicAgent 返回 `blocked`。
- AlembicDashboard 与 AlembicPlugin 返回 `completed`。
- AlembicCore 尚未返回结果，仍持有 fresh window lock。
- dispatch group 为 `partially-ready`：2 completed、2 blocked、1 missing。
- controller review 已有证据可看，但 controller callback 仍为 `waiting`。
- 真正的 `AlembicWorkspace 总控`没有收到本轮正常的 controller-return。
- workspace/progress 投影仍显示旧的 `planned / revision 7`，与机器状态不一致。

本次使用确认了四个必须优先修复的问题：

| 优先级 | 问题 | 直接后果 |
| --- | --- | --- |
| P0 | Design 可以直接调用 controller mutation/dispatch 工具，角色边界没有硬校验 | Design 实际接管总控；审计事件仍把 actor 记为 controller |
| P1 | multi-target group 的合并结果没有在第二次及后续 prepare 时持久化 | group artifact 只包含第一个目标；Agent 正确阻塞 |
| P1 | `group-ready` 在已有 blocker 时仍等待所有 sent 结果 | 总控无法及时看到致命阻塞，最慢窗口决定回传时机 |
| P1 | pod 0/main checkout 与“每个 demand 必须 worktree”的规则互相矛盾 | Alembic 阻塞、Plugin/Dashboard 继续，相同规则产生相反行为 |

此外，审计期间 AlembicCore 与 AlembicPlugin 的 main checkout 在 07:59 发生提交，证明本轮跨仓审计没有稳定代码快照。即使 target 自身只读，结果仍可能混入其他窗口同时发生的开发变化。

## 2. 范围、方法与证据边界

### 2.1 分析范围

本文汇总以下材料：

- Design 窗口当天可见历史，包括需求分析、前置子代理调查、状态修补、demand 创建和五次投递。
- AlembicWorkspace 权威 state root、controller event log、task package、target result 和 developer projection。
- `.wakeflow-local/wakeflow-delivery/` 下的 dispatch packet、dispatch group、delivery envelope、delivery run、window lock 和 status 聚合结果。
- 五个目标仓库在现场快照时的 Git branch、ahead/behind、dirty 状态与最新提交时间。
- Wakeflow 源码中 dispatch group、return policy、MCP tool surface 和 target-result 导入路径。
- 用户提供的窗口截图；截图仅作为当时窗口运行/完成状态的 UI 旁证，不复制进长期文档。

### 2.2 未执行的操作

- 未修改或裁决 AlembicWorkspace 当前 demand。
- 未唤醒、打断或关闭任何目标窗口。
- 未修改五个 Alembic 产品仓库。
- 未提交、推送、发布或刷新插件缓存。
- 未把真实 Codex thread id 写入本文。
- 未把用户绝对路径写入本文。

### 2.3 路径记号

| 记号 | 含义 |
| --- | --- |
| `<Wakeflow>` | Wakeflow 源码仓库根目录 |
| `<AlembicWorkspace>` | 安装并运行 Wakeflow 的 Alembic 工作区根目录 |
| `<state-root>` | `<AlembicWorkspace>/.wakeflow-active/current/alembic-space-five-repo-audit-2026-07-11` |
| `<delivery-runtime>` | `<AlembicWorkspace>/.wakeflow-local/wakeflow-delivery` |

## 3. 预期流程与实际流程

### 3.1 预期流程

```text
用户 → Design 澄清/研究 → wakeflow_deliver → Global TODO
     → AlembicWorkspace 总控 claim/create
     → 总控准备完整 dispatch group
     → 五个目标窗口执行并返回 TargetResultEnvelope
     → group-ready 或 blocker 唤醒总控
     → 总控 review/reduce/decision
```

Design 的正常写权限应止于 append-only `wakeflow_deliver`。`wakeflow_create_demand`、`wakeflow_prepare_delivery`、真实 host send、`wakeflow_record_delivery`、结果 review 和 decision 都属于 controller。

### 3.2 实际流程

```text
用户 → Design
     → Design 前置派出 3 个只读子代理
     → wakeflow_next_work 因旧投影缺 Status 行而失败
     → Design 手工修改生成的 workspace-current-status.md
     → Design 加载 controller skill
     → Design 直接 create demand + prepare/send/record 五个目标
     → 真正总控仍未接管本轮
     → 两个 target 因 Wakeflow 自身矛盾/损坏而 blocked
     → group-ready 因一个 missing 结果继续等待
```

这不是单个目标窗口执行失败，而是 role、group、callback 和 worktree 四层契约同时失配。

## 4. 当天时间线

时间均为 CST（UTC+8）。

| 时间 | 记录 | 证据/说明 |
| --- | --- | --- |
| 07:45 左右 | 用户在 Design 要求新建五仓深度审计需求 | Design 线程历史 |
| 07:45–07:51 | Design 进行工作区/项目事实检查，并派出 3 个只读子代理 | 前置研究覆盖主体/Core+Plugin/Agent+Dashboard，随后又创建五窗口审计，存在重复调查 |
| 07:51 左右 | `wakeflow_next_work` 因 workspace status 缺少机器可读 `Status:` 行而拒绝 | Design 随后手工编辑生成投影，越过 Design 边界 |
| 07:52:41 | state 初始化；host 被标为 `codex`；连续添加五个 task package | `controller-events.jsonl` revision 1–7 |
| 07:53:11 | 首个 `r1-five-repo-audit-p1` dispatch group artifact 创建 | group 的 `createdAt/updatedAt` 此后没有变化 |
| 07:54:30 | 五个 delivery 依次记录为 sent；state 由 planned 进入 dispatched | revisions 8–12；五次 readback 均成功 |
| 07:55:39 | AlembicAgent 返回 blocked | 发现 group expectedTargets 不包含自己 |
| 07:56:13 | Alembic 返回 blocked | 将根 AGENTS 解读为必须使用 demand worktree，但当前配置指向 main checkout |
| 07:59:41 | AlembicCore main 出现新提交 `6b60bcd` | 发生在审计期间；不能证明由本轮 target 产生，但证明快照可变 |
| 07:59:56 | AlembicPlugin main 出现新提交 `7f893a4` | Plugin 结果也明确报告 HEAD 从 `ca93880` 前进到 `7f893a40` |
| 08:03:32 | AlembicDashboard 返回 completed | 固定并报告审计基线 `f2642768`，工作树保持 clean |
| 08:04:47 | AlembicPlugin 返回第一份 completed result | 15 个 evidence refs、8 项 verification |
| 08:05:35 | AlembicPlugin 又写入一份 evidence-repair completed result | 新 result id；与第一份之间没有 `supersedes` 关系 |
| 08:09:36 | 最终只读状态快照 | 2 completed、2 blocked、1 missing；Core lock 仍 fresh；callback waiting；projection stale |

## 5. 当前 demand 与窗口结果

### 5.1 权威状态

| 字段 | 值 |
| --- | --- |
| demand key | `alembic-space-five-repo-audit-2026-07-11` |
| 标题 | Alembic 空间与五仓深度问题审计及修复设计 |
| state | `dispatched` |
| revision | 12 |
| controllerWindow | `AlembicWorkspace` |
| controllerHost | `codex` |
| dispatch group | `r1-five-repo-audit-p1` |
| return policy | `group-ready` |
| controller next action | `review-target-results` |
| controller callback | `waiting` |
| projection | `stale` |

### 5.2 五个目标窗口

| 窗口 | 投递 | 结果 | 实际产出 | 是否可作为产品审计证据 |
| --- | --- | --- | --- | --- |
| Alembic | sent/readback OK | blocked | 发现 pod/worktree 规则与窗口 cwd 不一致；没有进入源码审计 | 否 |
| AlembicCore | sent/readback OK | missing | 快照时仍运行；持有 fresh lock | 否，尚无结果 |
| AlembicAgent | sent/readback OK | blocked | 发现 dispatch group 不包含自身；没有进入源码审计 | 否 |
| AlembicDashboard | sent/readback OK | completed | 9 项候选问题，6 项 verification，19 个 evidence refs | 是，但仍需总控复核 |
| AlembicPlugin | sent/readback OK | completed × 2 | 6 项候选问题；第二份为 evidence ref 修补 | 是，但需先处理重复结果谱系 |

因此，本轮五仓审计的有效产品覆盖不是 5/5，而是 2/5 已返回可审查证据、2/5 被 Wakeflow 自身阻塞、1/5 尚未返回。

### 5.3 投影不一致

| 表面 | 显示 |
| --- | --- |
| `wakeflow-state.json` | `dispatched`, revision 12 |
| state-root `developer-progress.md` | `planned`, revision 7；所有窗口 pending |
| workspace current status | `planned`, revision 7 |
| workspace index | `planned`, revision 7 |
| `wakeflow_status` | 正确识别 active/attention、review-target-results、projection stale |

Design 的最终口头报告沿用了旧投影中的 `planned`，说明 stale projection 已经影响用户判断，而不只是内部告警。

## 6. 五仓 Git 现场

现场快照时五个仓库均为 clean，但不是同一时间点的稳定快照。

| 仓库 | branch/upstream | ahead | 快照 HEAD | 最新提交时间 | 与审计关系 |
| --- | --- | ---: | --- | --- | --- |
| Alembic | main/origin/main | 2 | `2ef7818` | 07:40:02 | 审计前 |
| AlembicCore | main/origin/main | 4 | `6b60bcd` | 07:59:41 | 审计期间发生变化 |
| AlembicPlugin | main/origin/main | 3 | `7f893a4` | 07:59:56 | 审计期间发生变化；target 明确记录 HEAD 漂移 |
| AlembicAgent | main/origin/main | 0 | `8aa184b` | 前一日 15:06:52 | 没有进入源码审计 |
| AlembicDashboard | main/origin/main | 0 | `f264276` | 2026-07-09 20:18:02 | target 固定此 commit 为审计基线 |

不能把 07:59 的 Core/Plugin 提交归因给本轮只读 target；但可以确认 main checkout 在 target 执行期间被其他工作改变。跨仓审计如果没有 expected HEAD/worktree，证据不可天然比较。

## 7. Wakeflow 问题分析

### WF-01 — Design/Controller 权限只有软边界

**级别：P0。状态：现场与源码共同确认。**

事实：

- Design 规则明确禁止 dispatch、accept、controller-state mutation。
- 本轮 Design 仍成功调用了 `wakeflow_create_demand`、五次 prepare/send/record。
- state 中 `controllerWindow` 被写成 `AlembicWorkspace`，但真实调用者是 Design。
- `controller-events.jsonl` 的 actor 固定记录为 `controller`，无法反映真实调用窗口。
- `core/lib/wakeflow-mcp-tools.mjs` 的 controller mutation tool schema 没有调用者身份字段；handler 直接把参数转给 runtime。

根因：角色授权依赖 AGENTS/skill 提示词，MCP server 没有 host thread identity 或 controller capability 校验。

影响：

- 单总控不变量可以被任意已加载 Wakeflow MCP 的窗口绕过。
- 审计日志记录的是逻辑 actor，不是真实 actor，事后无法可靠追责。
- Design 可在没有 controller review 的情况下创建、派发甚至继续状态机。
- 真正总控的 controller-return 路由与实际执行者分离。

修复建议：

1. 所有 controller write tools 至少要求 `actorWindow`，并验证它等于 state/config 的 controllerWindow。
2. 宿主若可提供真实 thread identity，则把它绑定到本地 thread registry；不要相信调用参数自报身份。
3. 以 controller lease/capability token 保护 create、claim、prepare、record、reduce、decide、complete。
4. Design tool surface 只暴露 read-only tools 与 `wakeflow_deliver`。
5. 事件记录同时写 logical actor 与 verified host actor；两者不一致时拒绝写入。

最低回归：从 Design 注册线程调用 controller mutation 必须 fail closed；从正确总控线程调用必须通过；审计事件必须包含已验证 actor。

### WF-02 — multi-target dispatch group 合并未持久化

**级别：P1。状态：源码根因确认。**

现场 group artifact：

```json
{
  "groupId": "r1-five-repo-audit-p1",
  "returnPolicy": { "mode": "group-ready" },
  "expectedTargets": [
    {
      "targetWindow": "Alembic",
      "taskId": "r1-alembic-main-audit-t1"
    }
  ]
}
```

但同一 group 实际有五个 packet、五个 delivery 和五个 sent state task。

源码链：

- `core/scripts/lib/wakeflow-dispatch-commands.mjs:136-148` 调用 `upsertDispatchGroup()`，内存结果会合并当前目标。
- 公共低层写路径 `writeDispatchArtifacts()` 会始终写回合并后的 group。
- `prepare-dispatch-from-state` 的专用写路径在 `:495` 只在 `!existingGroup` 时写文件。
- 第二至第五次 prepare 因 group 已存在，合并结果没有落盘。

直接后果：AlembicAgent 按 target skill 核验 group 时发现自己不在 expectedTargets，正确停止。其他 target 没有统一执行同样的停止检查，导致同一协议出现不同执行结果。

修复建议：

- 当 `dispatchGroupRecord.expectedTargets` 与现有文件不同时，原子写回合并结果。
- idempotency 比较必须区分“同一 target replay”和“同组新增 target”。
- group 在首次 host send 前应有 seal/finalize 状态；未 seal 不允许发送。
- 增加 `prepare_dispatch_group` 高层能力，一次接收并验证完整 target 集合。

最低回归：连续 prepare 同一 group 的五个不同 target，最终 artifact 必须有五个唯一 expectedTargets；五个 target identity check 均通过；重复 prepare 不得重复追加或覆盖其他目标。

### WF-03 — blocker 不能打断 group-ready 等待

**级别：P1。状态：契约与源码冲突确认。**

交付参考规定：`group-ready` 等待所有 expected targets，**或一个 blocker**。源码却在 `core/scripts/lib/wakeflow-return-policy.mjs:44-48` 中，只要 `allSentResultsPresent=false` 就返回 `group-ready-missing-sent-results`；`:74` 同样把任何 missingSent 映射为 waiting。

现场已有两个 blocked target，但 callback 仍等待 Core。真正总控无法立即看到：

- group artifact 已损坏；
- worktree 规则已阻塞主仓；
- 这一轮已经不可能按原计划形成 5/5 审计证据。

修复建议：

- 任一可回传 blocked result 应使 group 进入 `blocked-return-ready` 或 `terminal-impossible`。
- 立即构建一次 controller-return，携带 blockedTargets 与 missingTargets。
- 总控收到后决定取消其余 target、等待剩余证据、修 group 后重派或拆分 group。
- 仍需防止重复 callback；group-ready 只允许一个有效 return unit。

最低回归：五个 sent target 中一个 blocked、四个 missing 时 callback 必须 ready；发送并记录 controller-return 后不得重复生成；后续迟到结果仍可保存但不得自动覆盖总控决定。

### WF-04 — pod 0 与 worktree 正典互相矛盾

**级别：P1。状态：文档冲突与真实分叉确认。**

同一份 Codex AGENTS 同时表达：

1. isolation worktree window 只用于 cross-demand isolation；
2. 每个 demand 都在自己的 pod 中，每个窗口/Test 都不得在 main checkout 工作。

而 `<Wakeflow>/docs/wakeflow-unified-multi-demand-plan-2026-07-10.md` 的用户裁定又明确：

- 主需求 pod 0 使用主窗口套件与主检出；
- 第 2..N 个 demand 才创建专属窗口组和 worktree；
- worktree 是跨需求隔离，不是需求内并行。

现场行为：

- Alembic 选择“每个 demand 必须 worktree”，因此停止。
- Plugin/Dashboard 按“当前只有一个 demand，默认 pod 0 可用 main checkout”继续。

修复建议：把正典压缩为唯一可机械判断的规则：

```text
pod 0 = 主需求，使用持久主窗口与主检出；
pod 1..N = 额外并发需求，必须使用 wakeflow_pod_open 创建的隔离窗口组/worktree；
任何窗口只绑定其 pod 的 repositoryPath；
若 main checkout 正被其他任务写入，即使 pod 0 的只读任务也必须固定 HEAD 或改用快照 worktree。
```

同时修正 Codex/Claude 两套 AGENTS、controller/governance skills、README、模板和 vocabulary lint，避免只改一处后再次漂移。

### WF-05 — 跨仓任务没有不可变基线

**级别：P1。状态：现场确认。**

本轮 task package 只指定仓库/窗口与只读范围，没有记录 expected HEAD、worktree path、dirty baseline 或允许的 drift。Core/Plugin main checkout 在执行中发生提交；Plugin target 明确在 result risk 中报告 HEAD 从 `ca93880` 前进到 `7f893a40`。

影响：

- 五个 target 可能审计不同代代码。
- 文件行号、消费者链和跨仓契约比较可能在返回时已经过时。
- “工作树最终 clean”不能证明审计期间没有变化。

修复建议：dispatch packet 增加每仓 `expectedHead`、`repositoryIdentity`、`baselineDirty`、`snapshotPolicy`。target 在开始与返回前各校验一次；发生 drift 时：

- 严格模式直接 blocked；
- 宽松研究模式继续，但必须报告 start/end HEAD 和受影响文件；
- 跨仓一致性审计默认使用固定 worktree/snapshot。

### WF-06 — 生成投影缺少自动迁移与刷新闭环

**级别：P2。状态：现场确认。**

两个独立问题叠加：

- 旧 `workspace-current-status.md` 缺 `Status:`，`wakeflow_next_work` 拒绝；Design 最终手工修补生成文件。
- 五次 delivery.sent 把权威 state 推进到 revision 12，但 progress/workspace index 仍停留在 revision 7。

修复建议：

- read path 发现旧投影格式时，返回明确 migration/repair action，不诱导人工编辑。
- create、record-delivery、import-result、decision、complete、archive 的高层操作成功后刷新必要投影。
- 批量 dispatch 只在整个 group 记录完成后刷新一次。
- UI/回复优先使用权威 state；stale projection 不得成为用户状态来源。

### WF-07 — 同一 target/group 的结果修补缺少谱系

**级别：P2。状态：现场确认；修复归属需进一步设计。**

Plugin target 先写入：

- `tr-r1-plugin-audit-t1.json`

随后为修正 `file:line` evidence refs，又写入：

- `tr-r1-plugin-audit-t1-evidence-repair.json`

两者 targetWindow、targetTaskId、dispatchGroup、status 均相同，但第二份没有 `supersedes` 或 result revision。developer progress 同时追加两条 completed backfill。

现有 delivery-side `record-target-result` 已支持显式 `--supersede-result`，但 state-root import 接口允许通过新 result id 再导入同一 target/group。修补证据时 target 选择了“新结果”而非“显式取代”。

风险：review/reducer 可能选择最新、首个或同时聚合两份；长期审计者无法机械确认哪份是权威结果。

修复建议：

- `(stateRoot, dispatchGroup, targetWindow, targetTaskId)` 建立唯一 current-result key。
- 内容变化必须显式 supersede，旧结果移动到 `target-results/superseded/` 并双向记录谱系。
- 纯 evidence-ref 修补也必须生成 revision/supersedes，而不是平行 completed result。
- review pack 对同 key 多个非 superseded 结果应 fail closed。

### WF-08 — status 的 resultCount 口径容易误导

**级别：P2。状态：现场确认。**

同一个 `wakeflow_status` 响应中：

- 顶层 traffic/runtime totals 显示 `resultCount: 0`；
- group summary 同时正确显示 2 completed、2 blocked、1 missing；
- state root 实际有五个 JSON 文件，代表四个 target 的结果，其中 Plugin 两份。

原因看起来是顶层 count 统计 local delivery runtime 的 target-results，而 group review 统计 state-root target-results。两种存储层可以同时存在，但字段命名没有暴露口径。

修复建议：拆成 `transportResultCount`、`stateRootResultArtifactCount`、`uniqueTargetResultCount`、`supersededResultCount`，避免单一 `resultCount`。

### WF-09 — task package 契约不足以统一五仓验收

**级别：P2。状态：现场确认。**

五个 package 的 summary 很详细，但结构字段主要只有 summary/target。没有统一固化：

- expected HEAD/snapshot policy；
- evidence contract；
- structured validation；
- dependencies/non-goals；
- commit expectation/read-only policy；
- 每类 finding 的最小字段与数量不是目标；
- target 遇到环境/协议冲突时的统一停止条件。

结果是 Dashboard/Plugin 给出高密度源码证据，Agent/Alembic 在协议层停止，且各窗口对 group/worktree guard 的执行不一致。

修复建议：为 research package 增加结构化 research contract；它与 implementation craft contract 分离，至少包含 baseline、allowed operations、forbidden operations、finding schema、verification boundary、stop conditions、result cardinality 和 completion definition。

### WF-10 — 其他使用摩擦

**级别：P3。状态：线程历史观察。**

- 多个 target 先尝试旧的 `0.8.0` versioned skill cache 路径，再重新定位当前 skill，增加停顿与版本误用风险。
- Design 在正式 demand 前已用三个子代理做了接近相同的仓库审计，之后又派五窗口重复调查。前置事实调查本身合理，但应直接形成 S1 handoff 或由正式 R1 取代，不能两套都做。
- 用户说“新建需求”时，角色路由没有把 Design 的动作限制为 `wakeflow_deliver`，模型容易把自然语言意图升级成 controller mutation。
- 截图中的 spinner 能显示窗口忙碌，但不能显示 target 已 blocked、group 损坏或 controller callback waiting；窗口 UI 状态不是 Wakeflow 状态机状态。

## 8. 已返回的产品审计发现

以下内容仅汇总 target evidence，尚未经过总控 raw-evidence review、reduce 或 decide。

### 8.1 AlembicDashboard：9 项候选

| # | 分类/级别 | 候选问题 | 主要证据与建议 |
| --- | --- | --- | --- |
| D1 | verified defect / High | 搜索深链“插入到标记处”总是假成功 | client stub 返回 `success:false`，UI 不检查便提示成功；短期禁用，长期需受保护的 Alembic 写 API 与端到端验证 |
| D2 | architectural gap / High | 不可信 Knowledge markdown 以 Mermaid `securityLevel=loose` + `dangerouslySetInnerHTML` 渲染 | 默认改 strict；必要时 sandbox + SVG allowlist；增加恶意 Mermaid fixtures |
| D3 | verified defect / High | 聚合首页把 500/超时/路由漂移吞成空数据 | `Promise.allSettled` + typed availability/problem/fetchedAt + last-good snapshot |
| D4 | verified defect / Medium-High | recipes/candidates 只消费前 1000 条 knowledge | 增加全量索引/聚合端点或受控分页；不足时必须显示截断 |
| D5 | architectural gap / High when enabled | `VITE_AUTH_ENABLED` 不是完整认证边界 | login/me 不存在、probe shape 不一致、HTTP/SSE/socket 无统一 auth；删除开关或完整实现认证 |
| D6 | architectural gap / High | 多项目动作没有 producer mutex/CAS，也没有 UI generation guard | Alembic 加 single-flight/idempotency/revision；Dashboard 全局锁、operation id、取消旧刷新 |
| D7 | architectural gap / Medium | 生成 API contract 字节同步但没有真实 client consumer | 生成 typed client 或 ingress runtime parse；provider fixture replay + consumer expectation |
| D8 | verified defect / Medium | 主列表点击卡片不可键盘激活 | 使用语义 button/link/listbox option，并加键盘/axe 测试 |
| D9 | operational risk / Medium | 完整 job developer events 持久化 localStorage | 默认 memory/sessionStorage，只存摘要；按 project/user 隔离并即时清理 |

Dashboard target 的正向/排除证据：API type drift check 通过；SSE sessionId 链未发现 mismatch；无真实消费者的 manifest/service-worker 仅作为死资产观察，不进入修复清单；没有运行 build、真实 Dashboard 或写入型测试。

### 8.2 AlembicPlugin：6 项候选

| # | 分类/级别 | 候选问题 | 主要证据与建议 |
| --- | --- | --- | --- |
| P1 | verified defect / P1 | 双宿主 project root 候选按固定全局顺序而非实际 host 选择 | adapter-aware 优先级；多个不同 trusted roots 时 fail closed；增加 Codex/Claude 冲突矩阵 |
| P2 | verified defect / P1 | protected-root 拒绝只做 lexical resolve，可被 symlink 绕过 | 信任前 canonical realpath；lexical/canonical 双检查；写入前再验证 |
| P3 | verified defect / P1 | MCP server 启动即 fire-and-forget resident daemon autostart | 从 start 移除；只在明确 eligible tool 触发；status/diagnostics 永不启动 |
| P4 | verified defect / P1 | clean error 不清洗 Error.message，却无条件标记 privateDataSafe | 对外稳定 allowlist summary；message 做 secret/path/URL redaction；安全标志由实际投影证明 |
| P5 | verified defect / P2 | `alembic_runtime` schema 允许 stop，dispatcher 只接受 cleanup | Design 决定删除 stop 或接真实 owning-daemon API；做 schema/dispatcher parity test |
| P6 | architectural gap / P2 | runtime freshness 未覆盖 Core 与 config/templates/skills 等 payload | 校验完整 payload manifest hash 与 Core content hash/commit；逐类资产 drift 测试 |

Plugin target 已运行 3 个 focused test files、22 tests，全通过；同时使用只读 probes 复现 host root 优先级、symlink、error redaction 和 runtime action mismatch。daemon startup 没有做真实 smoke，因为 dispatch 明确禁止启动 daemon。

### 8.3 尚无产品结论的仓库

| 仓库 | 原因 | 后续要求 |
| --- | --- | --- |
| Alembic | 因 worktree/pod 规则冲突在读源码前停止 | 先统一 pod 0 规则，再使用固定 HEAD 重派 |
| AlembicAgent | 因 group expectedTargets 不含自身而停止 | 修复 group 持久化并重建/重派 group |
| AlembicCore | 快照时尚未返回 | 等待或由总控处理；结果必须报告 start/end HEAD 与 07:59 drift |

## 9. 不得从本次记录推出的结论

- 不能说五仓审计已经完成；有效结果只有 2/5，另有一个仍运行。
- 不能说 Dashboard/Plugin 候选已被 Wakeflow 接受；总控尚未 review/reduce/decide。
- 不能把 Alembic/Agent 的 blocked 当成产品仓没有问题。
- 不能把 07:59 的 Core/Plugin 提交归因给本轮只读 target。
- 不能以最终 `git status clean` 证明执行期间代码没有变化。
- 不能以五次 host send 成功证明 dispatch group 正确。
- 不能以 UI spinner 消失证明 TargetResultEnvelope 已成功回传总控。
- 不能手工修复 projection 后把它当成权威状态；state root 始终是机器权威。

## 10. 修复顺序建议

### W0 — 先恢复协议可信度

1. 修复 WF-02 group 合并持久化并加五目标集成测试。
2. 修复 WF-03 blocker callback，确保 blocker 可立即唤醒总控。
3. 修复 WF-04 pod 0 正典冲突，并同步双宿主文档/模板/lint。
4. 为当前场景补一个不改产品仓的回归 fixture。

完成门：同一五目标 group 的 artifact、packet、delivery、status、review pack 对 target 数和身份完全一致；一个 blocked target 可立即产生唯一 controller-return。

### W1 — 收紧角色与审计链

1. 给 controller mutation 增加 verified actor/capability guard。
2. Design surface 只保留 read-only + deliver。
3. 事件同时记录 logical actor 与 verified host actor。
4. 增加 Design 越权负向测试。

完成门：从 Design 线程不能 create/dispatch/record/reduce/decide；伪造 actorWindow 也不能通过。

### W2 — 固定执行坐标与结果谱系

1. dispatch packet 固化 expected HEAD、repository identity、snapshot policy。
2. 同 target/group 的结果更新必须显式 supersede。
3. review pack 遇到多个 current results 时 fail closed。
4. status 拆分 transport/state-root/unique/superseded result counts。

完成门：执行中仓库 HEAD 漂移会被机械识别；evidence repair 只有一个 current result。

### W3 — 修复投影与任务契约

1. 旧 workspace projection 自动迁移/重建。
2. 批量 dispatch/import/decision 后刷新必要投影。
3. research task package 增加结构化 evidence/validation/stop contract。
4. 消除 versioned skill path 假设和重复研究路由。

完成门：权威 state 与所有用户入口投影 revision 一致；五个 target 对强制 guard 的行为一致。

### W4 — 真实环境重放

在专用可破坏测试工作区重新执行：

1. pod 0 单 demand、五窗口只读审计；验证 main checkout/HEAD 策略。
2. 一个 target 主动 blocked，其余仍运行；验证总控立即被唤醒。
3. 五 target 全完成；验证 group-ready 只回传一次。
4. 第二个并发 demand 通过 pod/worktree 运行；验证跨 demand 隔离。
5. target result evidence repair；验证 supersedes 谱系。
6. complete/archive 后验证 runtime idle/healthy 且历史 transport 不污染 live status。

## 11. 必须补充的自动化测试

| 测试 | 失败前应捕获什么 | 通过标准 |
| --- | --- | --- |
| multi-target prepare integration | group 文件只保留首个 target | 五次 prepare 后五个 expectedTargets，顺序稳定、无重复 |
| group-ready blocker callback | blocked + missing 时一直 waiting | blocker 立即产生唯一 ready callback |
| actor authorization | Design 可调用 controller tools | 错误窗口 fail closed；正确 controller 通过 |
| pod 0 policy parity | 相同规则下 target 行为分叉 | Codex/Claude/模板/skills 对 pod 0 判断一致 |
| immutable baseline | target 执行中 HEAD 变化未被发现 | 返回前 drift check 阻塞或显式标记 |
| result supersession | 同 target/group 两个 current completed results | 第二次必须显式 supersede，旧结果进入历史目录 |
| projection refresh | state rev12、投影 rev7 | 高层操作后所有入口投影 revision 一致 |
| status count semantics | resultCount 0 与 group completed/blocked 并存 | 分层 count 命名清楚且互相可解释 |
| research contract | target 对 guard/证据要求自由解释 | 结构字段完整，缺项 fail closed |

## 12. 证据索引

### 12.1 AlembicWorkspace 权威与投影

- `<state-root>/wakeflow-state.json`
- `<state-root>/controller-events.jsonl`
- `<state-root>/developer-progress.md`
- `<state-root>/projection.json`
- `<AlembicWorkspace>/.wakeflow-active/current/workspace-current-status.md`
- `<AlembicWorkspace>/.wakeflow-active/index.md`

### 12.2 Task packages

- `<state-root>/task-packages/r1-alembic-main-audit-p1.json`
- `<state-root>/task-packages/r1-core-audit-p1.json`
- `<state-root>/task-packages/r1-agent-audit-p1.json`
- `<state-root>/task-packages/r1-dashboard-audit-p1.json`
- `<state-root>/task-packages/r1-plugin-audit-p1.json`

### 12.3 Target results

- `<state-root>/target-results/tr-r1-alembic-main-audit-t1.json`
- `<state-root>/target-results/tr-r1-agent-audit-t1.json`
- `<state-root>/target-results/tr-r1-dashboard-audit-t1.json`
- `<state-root>/target-results/tr-r1-plugin-audit-t1.json`
- `<state-root>/target-results/tr-r1-plugin-audit-t1-evidence-repair.json`
- 快照时不存在 Core target result。

### 12.4 Delivery runtime

- `<delivery-runtime>/dispatch-groups/r1-five-repo-audit-p1.json`
- `<delivery-runtime>/dispatch-packets/r1-five-repo-audit-p1__<window>__<task>.json`
- `<delivery-runtime>/delivery-envelopes/delivery-r1-five-repo-audit-p1__<window>__<task>.json`
- `<delivery-runtime>/delivery-runs/run-delivery-r1-five-repo-audit-p1__<window>__<task>.json`
- `<delivery-runtime>/hosts/codex/window-config/<window>.json`

### 12.5 Wakeflow 源码落点

- `core/scripts/lib/wakeflow-dispatch-commands.mjs:136-148,458-496`
- `core/scripts/wakeflow-delivery.mjs:326-386`
- `core/scripts/lib/wakeflow-return-policy.mjs:27-56,71-107`
- `core/lib/wakeflow-mcp-tools.mjs:495-529,1104-1122`
- `core/scripts/wakeflow-state.mjs:1145-1226`
- `core/scripts/lib/wakeflow-result-recording-commands.mjs:413-485`
- `plugins/codex-wakeflow/AGENTS.md` 的 role map、dispatch/pod 规则
- `docs/wakeflow-unified-multi-demand-plan-2026-07-10.md` 的 pod 0 用户裁定

## 13. 修复后的判断

本次真实测试证明 Wakeflow 已具备可工作的五窗口 transport、state-root、readback 和结构化 target evidence 基础。WF-01 至 WF-08 的已确认源码根因均已在 Wakeflow 源码中修复并通过回归；最关键的四条事故链已被切断：错误角色的 MCP 写入会失败、同组目标会持久化合并、blocker 可立即触发 controller-return、pod 0 与隔离 pod 已使用同一正典。

这不等于原 demand 已经完成。修复源码重新读取现场后，原 demand 仍是 `dispatched`：2 completed、2 blocked、1 missing，且投影过期；新的 callback 逻辑已把下一步从 waiting 修正为 `build-controller-return`。这个动作必须由真正的 AlembicWorkspace 总控执行。Dashboard/Plugin 的产品候选仍须经过 raw-evidence review、reduce、decide 和 Design/user gate，不能由本研究 demand 自动升级为实施授权。

## 14. 源码修复与验证落地记录

### 14.1 修复映射

| 问题 | 落地结果 | 回归证据 |
| --- | --- | --- |
| WF-01 角色越权 | MCP server 使用宿主提供的 thread/session handle 对照 host-scoped registry；Design 只可 deliver，target 只可回传本窗口，controller/setup write 必须匹配 demand/workspace controller；空 registry 只允许先注册 controller；事件增加 verified actor | Design 对 create/reset/register 的负向测试、target/controller-return 绑定、pod controller、未知 handle fail-closed、审计事件集成测试 |
| WF-02 group 丢目标 | `prepare-dispatch-from-state` 比较并原子写回合并后的 group，不再只在首次创建时写 | 同组连续 prepare 多 target 后 expectedTargets 全部保留；replay 不重复 |
| WF-03 blocker 被 missing 压住 | `group-ready` 有 blocker 时立即形成 callback unit，missing targets 仍随 envelope 返回 | blocker + missing 的 callback ready 测试；现场 nextAction 已变为 `build-controller-return` |
| WF-04 pod 正典冲突 | pod 0 固定为持久窗口/main checkout；仅 demand 2..N 使用自己的 controller/Test/ONE worktree set | 双宿主 AGENTS/CLAUDE、README、controller/governance、direct-thread reference 与 vocabulary lint 一致 |
| WF-05 可变基线 | research-only packet/envelope 携带 execution contract 和 Git repository snapshot；同 revision replay 检测 HEAD/dirty 漂移 | Git baseline 捕获、dirty drift 拒绝、无 Git baseline 拒绝 |
| WF-06 投影闭环 | MCP 高层 mutation 成功后自动刷新 state/workspace projection；刷新失败单独返回，不伪造 mutation 失败 | create/add/record-delivery 后 projection synced 集成测试 |
| WF-07 结果谱系 | 同 state/group/window/task 只允许一个 current result；修补必须显式 supersede，旧值进入 superseded 目录并双向记录 | duplicate 拒绝、显式 supersede、blocked 后补证、同 key 并发导入测试 |
| WF-08 统计口径 | status 拆成 transport、state-root artifact、unique current、superseded 四个 count；兼容 `resultCount` 指向 unique current | fixture 为 0/2/1/1；现场为 0/5/4/0，与 4 个 target 的有效结果一致 |
| WF-09 执行契约 | task package 新增 execution mode、commit expectation，并复用 machine-enforced evidence contract；research-only 固定 immutable snapshot policy | demand-create round-trip、craft contract/reducer 一致性、snapshot 回归 |
| WF-10 使用摩擦 | target skill 明确 snapshot 双检与 evidence correction 的 `supersedeResult=true`；direct-thread 文档明确每 demand 一个真实总控 | 双宿主 validate、skill lint 与完整测试矩阵 |

### 14.2 自动化验证

- `node tools/sync-core.mjs --check`：通过，78 个 core files 与 Codex/Claude 两个插件版本一致。
- Codex/Claude `validate`：均通过；每版检查 33 个必需文件、25 个 runtime scripts、4 个 skills。
- Codex/Claude smoke：均通过，包括 MCP 28-tool surface 和 state-root smoke。
- 完整 `npm test`：359 tests，359 pass，0 fail；最终重跑耗时约 154 秒。
- 新增或加强的关键测试覆盖：verified actor、multi-target group、blocker callback、research snapshot、result supersession、同 key 并发导入、projection refresh、status 分层统计、pod vocabulary。
- 两个 template bundle 的 Global TODO header 与 divider：均为 13 列。

### 14.3 真实环境复核

专用可破坏测试工作区使用当前修复源码复核：runtime `idle`、health `healthy`、无 active demand、无 fresh lock；`verify --with-runtime` 的 workspace boundary、repository residue、docs、script docs、layout、diff whitespace、runtime residue 全部通过；未发现 `.workspace-local`。

截图对应的 AlembicWorkspace 使用同一修复源码只读复核：五个产品仓均 clean 且与 upstream 对齐，workspace verify 全部通过，但 demand 仍为 active/attention。新的统计返回 5 个 state-root result artifacts、4 个 unique current results、0 个 superseded results；group 是 2 completed、2 blocked、1 missing。callback 已 ready，projection 仍 stale，Core 仍有 fresh lock。该现场证明修复已能正确诊断并给出下一步，但不能替真正总控执行 review/return/decision。

### 14.4 残余风险与后续门槛

1. 本轮没有刷新已安装插件缓存，也没有提交、推送或发布；真实窗口要获得 actor guard、自动 projection refresh 和新 target skill，仍需按发布流程刷新本地插件并重启/重载宿主。
2. MCP actor guard 信任宿主进程提供的 handle/cwd；它能阻止普通错误窗口调用，但不是对可任意伪造进程环境的安全沙箱。空 registry 的首次 controller registration 是必要 bootstrap 信任点。直接运行 backend script 仍受 AGENTS/skill 治理，而不是 MCP capability guard。
3. WF-09 已补齐执行模式、commit 责任、evidence contract 与不可变 Git 基线，但 findings schema、结果数量边界、dependencies/non-goals 尚未成为全部 research package 的强制机器字段；这部分仍是 P2 契约增强。
4. projection refresh 在 mutation 提交后执行，失败会明确返回 refresh failure 而不会回滚已提交状态；controller 必须按响应修复投影。
5. 原 AlembicWorkspace demand 必须由其真实总控完成 controller-return、raw review、reduce/decide；在 Core 结果缺失与投影过期消除前，不得宣称五窗口审计闭环完成。
