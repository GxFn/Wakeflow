# Wakeflow 下一阶段开发方向与落地方案（并行开发 · 意图对齐 · 并发地基）

> 生成于 2026-07-02，基线 v0.6.3（commit 570f8d8）。本方案合并两个输入：
> ① `docs/wakeflow-architecture-deep-dive-2026-07-02.md`（架构深读，含薄弱点评估）；
> ② `AlembicWorkspace/Design/docs/current/wakeflow-parallel-dev-intent-drift-2026-06-26.md`（并行开发 + 意图漂移 + 验收即产出，修订稿，一直封存等待 Fable 5 就位）。
> 模型前提现已满足：控制器可运行 Fable 5（`hosts.claude-code.modelByRole` / `effortByRole` 已支持按角色钉模型与推理力度）。本文把两者收敛为一个可执行的分阶段方案；`file:line` 引用对应 v0.6.3。

---

## 0. 战略定位：三条主线，一个顺序

| 主线 | 来源 | 为什么是现在 |
| --- | --- | --- |
| **S1 并发地基**（新增） | 架构深读·批判性评估 #1 | 并行开发会把"state.json 无写锁"从理论风险变成必然事故：多 stream 下控制器会在一个回合内并行发起多个状态写调用 |
| **S2 并行开发 F3**（刚需） | 需求设计 P1 | 用户逐字痛点："Codex 能并行化一个任务，Claude Code 连一个需求都并不了"。stream=独立窗口方案已经对抗式复核收窄，真新代码只剩三件 |
| **S3 意图对齐 F1+F2**（低风险） | 需求设计 P2（2026-07-02 再收窄） | 意图并排 + 需求审视提醒：让 Design 设想与总控派发意图在正确的时刻出现在同一屏，对齐与否由 Agent 当场确认；Fable 5 控制器的判断力是该方案成立的前提 |

顺序论证：**S1 必须先行或与 S2 同波**——F3 的完成定义要求"两条 stream 并行执行、各自结果回收"，而 Claude Code 控制器天然可能在一个回合内并行调用 `wakeflow_add_task` × 2 或 add_task + decide；这两个调用都是 state.json 的读-改-写（`wakeflow-state.mjs:796-801`），无互斥则丢更新（双双读到 revision N、各写 N+1）。今天靠"单控制器回合串行"的约定兜底；多 stream 后这个约定不再成立。S3 与 S2 文件域不相交，可并行或随后。

**为什么等 Fable 5**（记录动机，避免日后误读）：
1. 多 stream 并行的控制器认知负载——同时追踪 N 条 stream 的任务/锁/回执而不混线，需要强控制器；
2. 意图对齐的判断权整体交给 Agent（并排提醒而非分数/机械门），前提是控制器有足够判断力；
3. 无人值守纪律（不轮询、不越权、池耗尽即停）对模型服从性要求高。
这三点都指向控制器模型，而不是运行时代码——所以运行时改动一直冻结到现在。

---

## 1. PD 拍板建议（拍定后即为本方案的约束）

| PD | 建议决议 | 理由 |
| --- | --- | --- |
| **PD-1 并行范围** | **接受收窄**：P1 只做"一个需求内同 repo 多 stream"；放松单活跃 demand 另立未来需求 | 与用户逐字诉求一致；单活跃 demand 是全系统假定（`wakeflow-active-demands.mjs:46-50`、`wakeflow-next-work.mjs:267-270`、`wakeflow-demand-sequence.mjs:96-102`），爆炸半径最大 |
| **PD-2 stream 窗口注册落点** | **运行时派生覆盖层 `.wakeflow-local/workspace.config.json`**（= 基础 config + 活动 stream 条目的完整派生副本，由 stream-open/close 重生成） | 本轮测绘核实：core 侧**所有**配置解析已优先读该路径——`workspaceConfigPath`（`wakeflow-config.mjs:79-84`）与 `readWorkspaceConfig`（`wakeflow-window-runtime.mjs:42-50`）。即证据解析（`wakeflow-state.mjs:381-393`）、窗口 dispatch 配置、setup 状态**零 core 改动**就能看到 stream 窗口。唯一要补的是 claude-host 侧约 10 处直接读 tracked config 的调用点（`:127,:142,:157,:170,:599,:935,:1166,:1188,:1257`）换成"覆盖层优先"helper——纯 host-local 改动 |
| **PD-3 streamId 落点** | 已解决（留记录）：落 `wakeflow-state.schema.json:55` 开放 `targetTasks[]` items，零 schema 改动 | 需求文档已接地核实 |
| **PD-4 worktree 回收时机** | **三层**：① stream 全部任务被 accept 后由控制器显式 `stream-close`；② `archive-demand` 前强制 GC 检查（有存活 stream 则拒绝归档，提示先 close）；③ dirty worktree（未提交改动）拒删，须 `--force` | 防 stale 堆积（今天无 worktree GC）+ 防误删未提交工作；归档门与现有"归档是硬闸门"哲学一致 |
| **PD-5 漂移门 vs advisory** | **决议升级：相似度分数整体移除**。机制 = 两句意图并排 + 条件化提醒，最终确认归 Agent；"gate 化"议题随分数移除而消解（没有分数就没有门槛） | 原需求文档自己已断言"低相似 ≠ 漂移、未 calibrate 前近乎无用"——顺着这个怀疑走到底就是删掉分数；且脚本算分暗含"脚本在判断"，与 Wakeflow 信任模型（脚本只记录，判断归 Agent）相抵触 |
| **PD-6 LLM-judge slice** | **不做，整体砍掉** | 它是"裁判"野心唯一回潮口；等到了 Fable 5 控制器，Agent 直读两句意图的判断力已覆盖其价值，slice 失去存在理由 |
| **PD-7 stream 间依赖 / 合并回主线** | **不在本轮**；作为 Phase 3 候选独立需求（dependency-gate + merge 流程）。P1 内的运营答案：合并是 stream-close 前的人工/后续任务动作，`--delete-branch` 对未合并分支拒绝 | 本轮只并行独立 stream；依赖门牵出 producer/consumer 排序与合并策略，是另一个完整需求 |
| **PD-8 波次评审 vs 流式评审**（2026-07-02 新增） | **P1 采用波次模型**：波内并行执行，波尾统一 reduce + decide（零 reducer 改动）；按 stream 的 scoped reduce 登记为 Phase 3 E-1 | `reduce-results` 的全量语义（任一开放任务缺结果即不出候选，`wakeflow-state.mjs:1153-1166`）是既有设计；为 P1 改 reducer 违反 additive-only 红线，且波次模型已满足"并行化一个需求"的逐字诉求 |

---

## 2. 分阶段落地

### Phase 0 —— 并发地基（规模 S）——✅ 已于 2026-07-02 落地（与 Phase 1 合并为 0.7.0 一次发布）

**唯一目标**：state root 的读-改-写获得进程级互斥，为多 stream 扫清前提。

**W0-a：per-state-root 写锁**
- 新增 `core/scripts/lib/wakeflow-state-lock.mjs`（约 80 行）：`writeFileSync(<file>, {pid, createdAt}, {flag:"wx"})` 原子取锁；忙等退避重试（上限 ~2s）；stale 判定（锁龄 > 30s 视为死锁残留，stderr 告警后夺锁）；`finally` 释放。底层实现为通用 `withFileLock(file, fn)`，`withStateRootLock(stateRoot, fn)` 是其 state-root 特化——Phase 1 的 dispatch-group 组文件写复用同一原语（W1-b）。
- 接入 `wakeflow-state.mjs` 全部**状态写**命令：`add-task-package`、`reduce-results`、`decide-review`、`complete-demand`、`adopt-demand-host`、`archive-demand`。要点：**state 的 readJson 移进锁内**（读-改-写整体原子），当前各命令在锁外读会留下窗口。`import-target-result` 不改 state（`wakeflow-state.mjs:1068` revision 不变），只写独立结果文件，无需锁——加一条测试钉住这个事实即可。
- 语义零变化、schema 零触碰、additive-only。**落地改进**：锁文件位于 state root **旁**（`<root>.state-lock`）而非 root 内——归档 staging 复制、P1-0 脱敏扫描、`rmSync` 对它天然不可见，无需任何排除清单。**范围补充**：`wakeflow-render-progress` 的写段（同样重写 wakeflow-state.json，`wakeflow-render-progress.mjs:383` 起）纳入同一把锁，其既有"重读 + revision 比对"守卫从"检测到竞态即失败"升级为"竞态不可能发生"。

**W0-b：并发回归测试**
- 新增 `test/wakeflow-state-concurrency.test.mjs`：并发 spawn 两个 `add-task-package --write`，断言两个 package 都在、revision 严格递增无丢失；并发 `import-target-result` × 2 断言两结果文件共存、各自锁释放正确。

**完成定义（可证伪，已验证）**：争锁超时用例直接证明互斥生效（新鲜外部锁令命令 fail-closed 且不删他人锁）；4 路并行 add 全部落地、revision 严格连续 1→5；并行 import 不 bump revision；stale 锁被告警夺回；`npm test` 全绿（含双 edition 字节平价与双 smoke）；版本随 Phase 1 一并 bump 至 0.7.0。

### Phase 1 —— F3 并行开发（版本 0.7.0，规模 M，主交付）——✅ 已于 2026-07-02 落地并通过 tmux 真机验收（W1-a/b/c 机制 + W1-d 散文与 0.7.0 bump；散文限 Claude 版——Codex 版无 stream 能力，不写虚构文档。真机验收记录：沙箱工作区 + 专用 tmux socket，两 stream 真实起窗（worktree/独立分支/覆盖层注册/会话注册），第三条触 pool-exhausted 硬阻塞；完整闭环——真实 tmux 投递落 pane 且 readback 回读提示词、record sent、目标在 worktree 分支真实提交、import 释放锁、reduce 正确解析 repo 相对证据 ref、candidate→accept；活动监视器实测在锁释放后把窗口徽标翻 done；clean close 保留未合并分支、末 stream 关闭即删覆盖层、监视器自行退出。真 claude 二进制探针：起窗、folder-trust 自动确认、入场提示投递、真实模型回复 READY、pane 回读完整 UI。Phase 2 的派发侧真机项（compact 同屏两句 + Intent check 提醒）同场验证通过）

stream = 独立窗口 `<repo>__<streamId>` + 独立 worktree + 独立分支 `<demandKey>/<streamId>`。锁/绑定/启动/group fan-out 全按 windowName 键（`wakeflow-delivery-store.mjs:152-153`、`wakeflow-state.mjs:675`、`wakeflow-delivery.mjs:306-308`），独立窗口名自动获得独立锁与独立 targetTaskId——**不改锁键、不改 id 方案、不改 sameTargetDescriptor**（需求文档对抗式复核结论，本轮测绘复认）。

**并行模式的系统语义（2026-07-02 深化——这不是实现细节，是并行模式的使用契约）**

1. **评审是波次的，执行才是并行的**。`reduce-results` 对全部开放任务是全量语义：任何一个开放任务缺结果就不出转移候选（`wakeflow-state.mjs:1153-1166`，missing → `waiting-results`、candidate=null）——这是既有设计不是缺陷，但它决定了并行模式下**快 stream 的结果无法先于慢 stream 被验收**。P1 的使用契约因此是**波次模型**：一波 = 一个 dispatch group 内并发派发的一组 stream 任务；波内并行执行，波尾统一 reduce → decide → 下一波。**不为 P1 改 reducer**（红线保持）；按 stream 的流式评审登记为 Phase 3 E-1。
2. **回执策略默认 `group-ready`**。传输扇入与波次模型天然对齐：早完成的 stream 在自检 `review_pack` 时因 missing sent results 被拒绝构建回执（`wakeflow-return-policy.mjs:44-48`），**唯一一次 controller-return 由末位完成者构建**，控制器每波只被唤醒一次。`per-target` 在全量 reduce 语义下只能"看"不能"决"，P1 不推荐。
3. **分支的归宿必须显式**。stream 产出 = `<demandKey>/<streamId>` 分支上的已验收 commits；**合并回主线不是运行时行为**（PD-7 范围外），是 stream-close 前的人工/后续任务动作。防"验收过的工作随手删没"：`--delete-branch` 用 `git branch -d`（未合并即拒绝），`--force` 才升级 `-D`。
4. **Test 窗口是波内串行资源**。Test 仍是单窗口单锁，多 stream 的真机验证任务按窗口锁自然排队；Test 成为瓶颈时先加真实 Test 窗口（配置层已支持），不发明新机制。
5. **stream 重启后按既有机制恢复**。stream 窗口就是普通注册窗口：worktree、覆盖层、thread-registry 都在盘上，`launch-all`/`replace-all` 的 resume 路径原样适用；`stream-list` 负责三方对账（注册在、worktree 亡 → broken 提示 close；worktree 在、tmux 亡 → resumable）。
6. **计数权威 = 覆盖层注册条目**。maxStreams 按覆盖层 stream 条目计数；stream-open 前三方对账一致才继续；同 repo 的 stream-open 串行执行（防 git ref 锁竞争与注册重生成互踩）。

**W1-a：stream 生命周期（claude-host 新子命令，host-local）**
- `stream-open --repo <windowName> --stream <streamId> --demand-key <key> [--base <branch>]`：
  1. 从配置解析 repo 路径；
  2. worktree 目录固定 `<workspaceRoot>/.wakeflow-local/worktrees/<slug(repo)>__<slug(streamId)>`；
  3. `git -C <repoPath> worktree add <dir> -b <demandKey>/<streamId> <base>`——**独立分支是硬约束**（git 拒绝两个 worktree 检出同一分支）；
  4. 注册 stream 窗口（W1-b）；
  5. 复用既有 `launch-window` 起 tmux `claude` 会话（cwd=worktree，窗口名 `<repo>__<streamId>`），session id 走既有 `register-thread` 入 thread-registry；
  6. 同 repo 的 stream-open 互斥（复用 W0 锁原语做 per-repo 开流锁，见系统语义 #6）。
- `stream-close --window <name> [--delete-branch] [--force]`：dirty worktree 拒删（须 `--force`）；`git worktree remove`；`--delete-branch` 用 `git branch -d`（未合并拒绝，`--force` 才 `-D`，见系统语义 #3）；注销注册（重生成覆盖层）；杀 tmux 窗口；清窗口锁。
- `stream-list`：列活动 stream + 三方对账（注册/worktree/tmux），并入 `window-status` 输出。
- git 子命令经由既有进程边界（`wakeflow-process.mjs` 白名单含 git；worktree 子命令加入允许清单）。

**W1-b：注册与解析（PD-2 落地，核心零改）**
- stream-open/close 重生成 `.wakeflow-local/workspace.config.json` = 当前 tracked config + 活动 stream 条目 `{windowName, path: <worktree相对路径>, role: "Parallel stream of <repo>", mode: "internal", managedAgents: false, stream: {repo, streamId, demandKey, branch}}`；重生成时断言 windowName 全局唯一。
- 覆盖层带派生标记 `{derived: {from: "workspace.config.json", baseHash, generatedAt}}`；**新鲜度纪律**：stream-open/close 每次从当前 base 重生成；`check-workspace` 校验 baseHash，不匹配即报"stale overlay"；最后一条 stream 关闭时删除覆盖层（回到直读 base）。
- claude-host 新增 `readWorkspaceConfigPreferLocal()` helper，替换其 9-10 处直接读 tracked config 的调用点（`wakeflow-claude-host.mjs:127,:142,:157,:170,:599,:935,:1166,:1188,:1257` 一带）——host-local，不触 core。
- **波次并发安全（落地时对抗式复核后撤销）**：原判断"组文件互踩 → group-ready 扇入错判"是**错的**——就绪扇入的 `expectedTargets` 从 **packets** 推导（`wakeflow-dispatch-group-review.mjs:45`、快照 `:122`），组文件只承载策略/controllerWindow/排序元数据且**首写生效**（`wakeflow-dispatch-commands.mjs` 写守卫 `!existingGroup`），策略冲突由 upsert 守卫先行拒绝。并行首备的竞态只影响排序外观，**无需组文件锁**；packets 各自独立文件天然并发安全。
- 收益（本轮测绘核实）：core 的 `workspaceConfigPath` 已优先读覆盖层（`wakeflow-config.mjs:79-84`），因此 **reduce 的证据解析**（`evidenceRepoRootForWindow`，`wakeflow-state.mjs:381-393`）自动把 stream 窗口的 repo 相对证据 ref 解析到 worktree——不补这条，stream 结果会在 reduce 处 false-fail（正是 cdb04b2/77d2e5c 修过的闭环断裂模式在 stream 上的重演）。

**W1-c：池上界与耗尽兜底**
- 配置：`workspace.config.json` → `hosts.claude-code.maxStreamsPerRepo`（缺省 2），可被 `repositories[].maxStreams` 覆盖。
- `stream-open` 计数活动 stream ≥ 上界时输出结构化 `pool-exhausted` 失败（block，绝不 spawn 第 N+1 个窗口），`agentNext` 指引"等某 stream 回收后重试或顺序化"——无人值守红线。
- `archive-demand` 归档门（PD-4 ②）：state root 归档前检查该 demand 的活动 stream，存活即拒绝。

**W1-d：散文与真机验收**
- skills 双写（sync-core 不覆盖散文）：`wakeflow-controller` 增"stream 调度：一 stream 一任务、按 windowName 派发、**波次纪律（一波一组、group-ready 回执、波尾统一 reduce+decide）**、池耗尽即停"；`wakeflow-governance` 增 stream 生命周期/分支命名/合并归宿/回收纪律；`wakeflow-target` 增一句"stream 窗口只在自己的 worktree/分支内工作，不碰主检出"；CLAUDE.md/AGENTS.md 补 stream 边界一条。
- **真机验收**（= 需求文档 F3 可证伪定义 + 本轮补强项）：沙箱 repo 起两条 stream 各派一任务 → 两 worktree 各在 `<demandKey>/<streamA|B>` 分支、两 tmux 窗口并行、两把锁文件键不同、`state.targetTasks[]` 两条不互覆盖、各自结果回收只释放自己的锁；**补强**：① stream 窗口用 repo 相对路径记录证据 ref，`reduce-results` 正确解析不 false-fail（cdb04b2/77d2e5c 断裂模式的 stream 版回归）；② 波次语义钉住——仅一条结果在场时 reduce 报 `waiting-results` 且无候选，双结果在场时一次 reduce 出候选、一次 decide 收波；③ group-ready 扇入——早完成 stream 不产生 controller-return，唯一回执由末位完成者构建；④ 并行 prepare 同组后 `expectedTargets` 两条俱在（组文件锁生效）；⑤ 第三条 stream 触 `maxStreams` 见 block；⑥ `stream-close --delete-branch` 对未合并分支拒绝；⑦ `stream-close` 清干净 worktree 与注册，覆盖层在最后一条 stream 关闭后消失。

**明确不做（红线重申）**：复合锁键 / streamId 穿线进锁推导 / 新 targetTaskId 方案 / 改 `sameTargetDescriptor` / **改 reducer 全量语义（波次模型内解决，流式评审见 Phase 3 E-1）** / 放松单活跃 demand / stream 间依赖与合并回主线 / 把 worktree 隔离重新解读为多分支搜索。

### Phase 2 —— F1+F2 意图对齐（版本 0.7.1，规模 S）——✅ 已于 2026-07-02 落地（npm test 291/291；落地微调：review 提醒落在独立的 `intentCheck` 附加字段而非 nextAction——nextAction 是机器令牌，追加散文会破坏消费者；state-root 包的 objective/designIntent 从 packets 按 stateRef 索引取得，未派发任务回落 task summary 并标注来源）

> **设计要义（2026-07-02 按用户方向对原 F1 的再收窄）**：原需求的词法相似度基线**整体移除**。理由有三：
> ① 原需求文档自己已断言"低相似 ≠ 漂移、未 calibrate 前近乎无用"——顺着这个怀疑走到底，就该删掉分数，而不是保留一个没人该信的数字；
> ② 让脚本算分暗含"脚本在判断"，与 Wakeflow 信任模型（脚本只创建/校验/记录，判断归 Agent 与人）相抵触；
> ③ **双向弹性是常态**——Design 的 designIntent 是实现设想不是合同，总控的派发是当下最优安排不是转写；偏离常常是适配而非错误，任何数值门槛都会把正当弹性错报成漂移。
>
> 一句话机制：**把无意识漂移变成有意识确认**。运行时只负责让两句意图（Design 的 `designIntent`、总控的 `objective`）在两个判断时刻出现在 Agent 的同一屏；对齐与否由 Agent 当场确认；怀疑漂移时的唯一规定动作是**需求审视**（回读 Original Plan / Requirement Design）；需求本身要改，走**既有** `redesign` 裁决。零分数、零门禁、零新裁决、零新确认字段。

**两个判断时刻（机制的全部内容）**

1. **派发时（自检）**：designIntent 在场时，`prepare-dispatch` 输出（含 compact）同屏回显 `designIntent` + `objective`，`agentNext` 追加一句："对照 Design 设想确认此次安排是有意一致或有意调整；有意调整应体现在 objective 措辞里。"总控作者 objective 的那一刻就是确认时刻——objective 本身已入 packet、入幂等 hash、可 trace，**它就是确认记录**，无需新增字段。
2. **验收时（对照）**：review pack 每个可评审条目并排给出 `designIntent`（在场才出现）/ `objective` / 结果摘要三元组；当任一任务带 designIntent，pack 的 nextAction 追加一句："若交付偏离设想且派发时未声明有意调整，先做需求审视；需求要改走 redesign。"`decide-review` 的 reason（既有必填、入事件）**就是验收侧确认记录**。

**W2-a：字段贯通（core，additive）**
- `add-task-package` 增 `--design-intent` → `taskPackage.designIntent`（开放 schema `task-package.schema.json:17`，零改动）；MCP `wakeflow_add_task` 与 `wakeflow_create_demand` 的 `taskPackages[]` 透传（Design 交付材料可作者）。
- MCP `wakeflow_prepare_delivery` 增 `objective` 参数转发 `--objective`（CLI 侧 `wakeflow-dispatch-commands.mjs:415` 已支持，只缺 MCP 转发 `wakeflow-mcp-tools.mjs:694-713`）。作者化仍可选——不作者时回落 summary，两句趋同、并排自然无信息，这本身就是正确行为而非缺陷。
- prepare 把 `packet.designIntent` 从任务包带上 packet（一个字段；不入 `dispatchPacketComparable`，重放安全，`wakeflow-idempotency.mjs:49-69`）。`objective` 在 comparable 内 → **authored objective 须在首次 prepare 给出**，同 revision 换 objective 触既有守卫（`:443-445`）——特性而非缺陷："改意图 = 新 revision"。
- **明确不做**：相似度库、intentDrift 块、verdict 字段、intent-drift.jsonl、gates 新字段——全部不建。

**W2-b：两个判断时刻的落点（两个 builder 同步）**
- prepare 输出 compact 与完整分支（`wakeflow-dispatch-commands.mjs:498-512` 一带）designIntent 在场时回显两句 + agentNext 提醒；缺省时零痕迹。
- state-root 验收 pack（`wakeflow-review-commands.mjs:388-422`）与 delivery/group pack（`wakeflow-review-pack.mjs:57-76`、`wakeflow-review-commands.mjs:87-105`）条目并排 `objective`（来源：packet，回落 targetTask.summary 并标注来源）+ `designIntent`（缺省即整字段省略，不产 null 占位噪音）；条件化 nextAction 提醒行。
- 测试钉死：门禁对象（`controllerReviewReady` / `totalControlVerdictRequired` 等）逐字段不因 designIntent 在/缺而变化；`decide_review` 白名单与语义零改动。

**W2-c：散文（双 edition）与真机验收**
- controller skill 新增「意图对齐」小节（约 6 行）：双向弹性原则、两个判断时刻、"提醒不是门"、需求审视路径、redesign 是既有逃生门。Design 指引一句：designIntent 是一句实现设想，可缺省，**不是验收标准**。
- **真机验收**（可证伪）：designIntent 在场的真实派发 → prepare compact 同屏两句 + 提醒行；review pack 条目并排三元组、nextAction 有条件提醒；designIntent 缺省 → 全链路零痕迹（无提醒、无占位字段）；门禁/裁决逐字段零变化；trace 可回放确认链 designIntent（任务包）→ objective（packet）→ decision reason（事件）。

### Phase 3 —— 地基加固与规模化（观察触发，不在本轮承诺）

本节把两类来源统一登记为后续阶段计划：**E 系 = 本轮 F3/F2 深化中显式推迟的演进项**；**H 系 = 架构深读（`wakeflow-architecture-deep-dive-2026-07-02.md` §6）发现的现存薄弱点**。每项带触发条件——触发前不做（守"更少"），触发后按本方案同样的 wave 纪律立项。

| # | 候选 | 来源 | 触发条件 |
| --- | --- | --- | --- |
| E-1 | 按 stream 的流式评审：`reduce-results --scope <taskIds>` 产出子集候选。裁决侧已天然支持子集（候选自带 `targetTaskIds`，`decide-review` 只动候选域，`wakeflow-state.mjs:1346-1377`）；缺的是 reduce 侧 scope 参数 + `review.*` 字段的子集语义 | PD-8 | 波次长尾等待（快 stream 等慢 stream 才能收波）成为真实主要痛点 |
| E-2 | 多活跃 demand 放松（原 C4，PD-1 移出）——触 `wakeflow-active-demands.mjs:46-50`、`wakeflow-next-work.mjs:267-270`、`wakeflow-demand-sequence.mjs:96-102` 三处硬门 + 归档/索引/TODO rollup 的单需求全面假定，爆炸半径最大 | PD-1 | 需求内多 stream 用满后仍有跨需求并行诉求 |
| E-3 | stream 依赖门 / 分支合并回主线流程化（dependency-gate + merge 流程） | PD-7 | "B 需 A 的 commit"或波尾合并冲突高频出现 |
| H-1 | 窗口锁续租：活动监视器对 pane 忙碌的窗口续 TTL（今天固定 7200s——超 2 小时的长任务锁过期后，同窗可被再次派发，两任务在同一 pane 排队混流） | 深读 §4.7 引申（本轮新发现） | 出现一次真实的"长任务锁过期后误派" |
| H-2 | schema 最小运行时校验：手写断言器（守零依赖 §0-2）接入 state root 读入口与 `wakeflow-validate` | 深读 §6-2 | schema 与代码的漂移真实发生一次 |
| H-3 | LLM 契约 lint：测试断言每个状态写命令的输出都携带 `agentNext` + `forbiddenConclusions`（软护栏的**存在性**由硬测试保证） | 深读 §6-3 | 随任意 Phase 搭车，成本约一个测试文件 |
| H-4 | readback 强化：pane 抓屏升级为结构化回执（如目标窗口首个动作写 ack 工件）；在此之前 pane 抓屏 + 窗口锁 + 活动监视已够用 | 深读 §6-4 | 无人值守规模化后出现静默丢投递 |
| H-5 | `wakeflow-setup.mjs`（2604 行）拆分 + 各脚本手写 argv 解析（hasFlag/getValue/valuesFor 三件套 × N 份）统一进共享 lib | 深读 §6-6 | 机会性重构，搭任何触碰 setup 的需求便车 |
| H-6 | 协议人体工学：波次批量 prepare 的输出聚合。**不**合并 prepare/send/record 三步——步骤分离是证据模型本身，README 明令不得折叠 | 深读 §6-5 | 每波 stream 数 ≥3 后控制器上下文压力再评估 |

已消解、不再列入的项：漂移 gate 化（随 PD-5 决议升级——分数已移除，无门可设）；RA3 的写序/锁释放/spawn 错误处理（核实已于 0.5.x-0.6.x 落地：`wakeflow-state.mjs:1267-1276` F41 写序、`:1024-1031` 共享锁释放、`wakeflow-runtime.mjs:139-169` SIGKILL 升级与 spawn error 兜底）；并发写竞态（Phase 0）；组文件锁（对抗式复核证伪撤销）。

**2026-07-02 真机验收后的观察项增补**（实现与验收过程新暴露；带 ⚡ 的五项 = O-wave——观察性/加固小波，**✅ 已于当日落地（0.7.2，npm test 295/295；O-2 另经真 tmux 冒烟验证 promptEchoed 无误报）**）：

| # | 候选 | 来源 | 触发/建议 |
| --- | --- | --- | --- |
| H-7 ⚡ | 监视器进程作用域防护：`window-status`/`check-workspace` 显示 monitor pid+root 归属；文档写明清理须按 `--root` 过滤 | 真机验收事故：宽 pgrep 误杀了另一工作区的生产监视器（纯可视化组件，已原样恢复） | 建议立即搭车 |
| O-2 ⚡ | `deliver` readback 自动断言：envelope.prompt 首行不在 paneTail 时输出 warning（不 fail） | 真机验证 pane 抓屏可靠，残余间隙 = "落 pane ≠ 模型开始处理"；比完整 ack 工件便宜一个量级 | 建议立即搭车 |
| H-8 ⚡ | `set-unattended --write` 后若派生覆盖层存在则同步重生成（复用 `regenerateOverlay`） | stream 存活期间改 tracked config → 覆盖层立即 stale，下次 stream 操作才刷新 | 建议立即搭车 |
| H-10 ⚡ | 写锁 stale-break 前加 `process.kill(pid,0)` 存活检查，活进程加倍耐心 | Phase 0 自查：30s 固定阈值 vs archive 大 state root 的合法长持锁 | 建议立即搭车 |
| （H-3 ⚡） | LLM 契约 lint（原 H-3，价值上升：Phase 2 引入条件化 agentNext 覆盖，覆盖点将增多） | 深读 §6-3 | 并入 O-wave |
| H-9 | 全局 TODO 板的单写者假定：markdown 读-改-写无锁，靠"Design 唯一追加、控制器唯一消费"纪律 | 本轮复盘 | 丢一行 TODO 时触发；对策现成（`withFileLock` 复用到板文件） |
| H-11 | review-pack 的 packet 扫描随传输历史线性增长（`prune-runtime` 不清 packets 的既有累积叠加） | Phase 2 实现自查 | 长寿工作区 review-pack 变慢时触发；方向 = prune 扩展到 fully-accepted 组的 packets（原 P1-3 案） |

真机验收带来的权重修正：H-1（锁续租）↑——并行 stream 使长任务更常见；H-4（完整 ack）↓——pane 抓屏实测可靠，O-2 覆盖大半残余间隙；E-1 维持——波尾等待是否成真痛点待真实多任务波数据。

---

## 3. 推进机制与工程纪律

**每个 wave 的固定回路**（不区分谁实施）：
1. 实现（core 改动只写 `core/`，散文按 edition 双写）；
2. `npm test`（= check:core 字节平价 + 双 edition validate + 双 smoke + 全部脚本测试）；
3. 新增测试随 wave 落地（先能失败、后转绿）；
4. 版本 bump 五处一致（两 plugin.json + 两 package.json + marketplace.json，`test/wakeflow-version-parity.test.mjs` 钉住）；
5. 真机验收按各 Phase 的可证伪定义执行并留证据。

**Dogfood 路径（推荐）**：Phase 0 体量小、且是其余一切的前提，直接实施；Phase 1 起走 Wakeflow 自身闭环——本 roadmap 经 Design 以 `wakeflow_deliver` 交付（designKey 建议 `wakeflow-parallel-dev-2026-07`，requirement 类型挂本文件 + intent-drift 需求文档为 Original Plan / Requirement Design），控制器 `wakeflow_create_demand` 认领，按 wave 派发到 Wakeflow 仓窗口，证据验收。**Phase 1 的交付过程本身就是 F3 之前最后一次单 stream 模式的全链路回归，Phase 2 的交付过程则应直接跑在 Phase 1 产出的多 stream 模式上——交付即验收。**

**模型配置基线**：workspace config 建议钉 `hosts.claude-code.modelByRole.controller = "claude-fable-5"`（effortByRole 维持 controller=max、其余 xhigh 的既有画像默认）；Codex 侧不变（F3 为 Claude Code 侧刚需，Codex 线程并行已可用，`wakeflow-host-profile.mjs:122` 的"no worktree"策略保留）。

---

## 4. 风险清单（含对策）

| 风险 | 对策 |
| --- | --- |
| 覆盖层 stale（base config 改动后 stream 覆盖层遮蔽新值） | baseHash 派生标记 + open/close 每次重生成 + check-workspace 校验 + 末 stream 关闭即删（W1-b） |
| worktree 内子窗口 scope-block 的相对坐标失准（worktree 深度 ≠ 原 repo 深度） | 不依赖 scope-block 相对坐标：投递提示携带 workspace 相对 stateRoot，launch 用 `--add-dir <workspace>`；列为已知外观性缺陷，不做坐标重写 |
| 并发写竞态（Phase 0 未先行就上多 stream） | 硬排序：Phase 0 是 Phase 1 的前置门，W1 任何 wave 不得先于 W0-a 合入 |
| 每 stream = 完整 claude 进程 + worktree + 模型花费；monitor 轮询成本随窗口数线性 | `maxStreamsPerRepo` 缺省 2 + pool-exhausted 硬 block（W1-c）；大 fleet 前先观测 monitor 开销（`wakeflow-claude-host.mjs:452-548`） |
| authored objective 与幂等 hash 的交互（同 revision 换 objective 被守卫拒绝） | 特性化：首次 prepare 即作者化；文档与 skills 写明"改意图 = 新 revision（重新 add/decide 路径）" |
| 提醒疲劳（模板化提醒被 Agent 习惯性忽略） | 提醒严格条件化：仅 designIntent 在场才出现、一句话、不带分数不带占位；designIntent 缺省时全链路零痕迹（W2-b） |
| 双 edition 散文漂移（skills 不被 sync-core 同步） | 每 wave 的 DoD 含"两 edition 散文核对"一项；host 词只在 L3 |
| worktree 残留堆积 | 三层回收（PD-4）+ 归档硬门 + `stream-list` 三方对账可见性 |
| 双宿主并存时 Codex 侧经 host-neutral 覆盖层看见 stream 窗口 | 双重既有兜底，不新增机制：demand 归属门（claude-code 持有则 codex 驱动命令 fail-closed）+ codex 侧无该窗口 thread 注册（require-thread / 发送即失败） |
| 波次模型的隐性约束被误用（波中途 reduce 得 `waiting-results`、波中途 add-task 被 `waiting-results` 态拒绝） | skills 波次纪律写明"波尾才 reduce"；真机验收 ② 把该语义钉为并行契约的一部分而非意外 |

---

## 5. 一页总览

```
Phase 0  0.6.4  并发地基     state-root 写锁 + 并发回归        S    前置门
Phase 1  0.7.0  并行开发 F3  stream 生命周期/注册解析/池上界    M    刚需主交付（W1-a..d）
Phase 2  0.7.1  意图对齐 F1+F2  两句意图并排 + 需求审视提醒（零分数零门禁） S  可与 Phase 1 并行
Phase 3  —      加固+规模化（观察触发）  E系: 流式评审/多活跃demand/stream依赖 · H系: 锁续租/schema校验/契约lint/readback/setup拆分/批量人体工学  不承诺
```

红线一句话版：additive-only；不改锁键/id/裁决语义；意图对齐只并排提醒、不算分不设门、最终确认归 Agent；池耗尽即停；host 词不进 core；散文双写；每 wave 全测试绿 + 真机验收留证。
