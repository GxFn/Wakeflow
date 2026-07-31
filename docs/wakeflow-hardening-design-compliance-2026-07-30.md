# Wakeflow 硬化设计符合性审计与全阶段实现记录

> 审计日期：2026-07-30
> 对照设计：附件《整体修复方向应该收敛成一句话》
> 核心原则：保留 Agent 的判断自由，用确定性的机器外壳保证身份、状态、证据、隔离和历史不可分叉。

## 1. 结论

审计前的 Wakeflow **不能认定为严格按完整设计实现**；截至本记录最终复核，
设计中 Stage 0–5 的机器合同已经按顺序落地，并通过源码回归与 WakeWorkspace
真实环境闭环。

最终实现不是增加审批层，而是把以下事实变为机器可验证约束：

- prompt 只承载目标、完成重点、一个优先上下文、一个关键边界和导航；
- task package 是完整执行上下文，需求文档是带 anchor 的背景权威，Skills
  是执行工艺权威；
- 新写入/派发必须是 full-context package，legacy package 只读保留；
- demand、packet、group、delivery、result、binding 和 lease 均有稳定身份，
  且 transport artifact 按 demand namespace 隔离；
- redesign 使用显式 replacement lineage，旧结果和旧 group 只能进入历史；
- pod 在创建 worktree 前预留容量，配置分 durable / derived / effective 三层；
- TargetResultEnvelope v2 对 acceptance anchor、Test plan、change/commit disposition
  做结构化映射；
- TODO 使用统一 13 列 codec、共享锁和原子归档；
- core 双宿主同步使用 managed manifest，发布前有独立一致性门禁。

真实环境最后还暴露并修复了两个此前单测未覆盖的问题：

1. 已冻结 delivery、未记录 host send、随后通过 state import 回填结果时，
   结果没有关联回 canonical packet/envelope，导致 lease 残留。现在 import
   会校验 packet digest、envelope preparation digest、demand/state/task/group
   全链，唯一匹配后释放对应 lease，绝不按窗口名宽泛释放。
2. TODO 归档索引链接曾硬编码为 `../workspace-record-map.md`。现在由
   `workspaceLedgerPaths().workspaceRecordMapPath` 计算相对路径，支持自定义
   current/ledger 布局。

## 2. 信息分层对照

### 2.1 Prompt

审计前判定：**部分符合，但压缩过度**。

正确部分：

- 一行目标；
- 前两项完成重点；
- acceptance anchor 的短 claim；
- task package 路径；
- 一个 goal 背景入口；
- required Skills；
- window/repository identity；
- return 和 trace。

偏差：

- 删除了全部 `contextSummary`，目标虽在，但子窗口缺少最重要的已确认事实；
- 删除了全部边界，子窗口必须先打开 package 才能知道最关键禁止项；
- 未列 workspace 指令和 current state root；
- 无 `role=goal` 时会把任意第一条 requirement ref 当成背景入口。

本轮修正：

- prompt 最多重复 1 条有序 `contextSummary`；
- prompt 最多重复 1 条关键边界，选择顺序为
  `forbidden → outOfScope → inScope`；
- 增加 workspace 指令、repository 指令和绝对 state-root 导航；
- 新 full-context package 必须至少包含一个 `role=goal`；
- 不恢复完整上下文、完整边界、commit policy、authority 说明或全部 requirement refs。

修正后 prompt 仍是导航层，不是第二份任务包。

该结论适用于所有新的可写/可派发路径。底层 raw CLI 仍可读取历史 package，
但创建门和 readiness 派发门不再允许 legacy no-context package 进入新执行。

### 2.2 Task package

判定：**主体符合**。

现有完整字段：

- `objective`
- 有序 `contextSummary`
- 带角色和精确 anchor 的 `requirementRefs`
- `boundaries`
- `completionExpectations`
- `dependsOnTaskIds`
- `commitExpectation`
- `acceptanceAnchors`
- `evidenceContract`
- Test 的 `testExecution`

本轮补充：

- 新 full-context package 强制至少一个 `role=goal`；
- redesign replacement 的 `replacesTargetTaskId` 纳入 package digest；
- package 与 target task 的 replacement 声明必须一致；
- replacement 必须与旧任务的 `replacedByTargetTaskId` 形成双向关系。

兼容边界已经收敛：

- 公共 MCP 与底层 CLI 的新 package 写入都要求完整 `taskContext`；
- readiness 明确拒绝 legacy package，不能通过 raw CLI 绕过；
- 历史 legacy artifact 仍可被状态/审计读取，但不会被自动补造上下文或重新派发。

### 2.3 需求背景文档

判定：**主体符合**。

- package 保存所有 workspace-relative 引用；
- 非 evidence 引用必须包含 Markdown anchor；
- traversal、workspace 外路径和 symlink escape 均 fail-closed；
- full-context prompt 只展示 goal 入口，其他 completion/constraint/validation
  引用留在 package；legacy prompt 的回退例外已在 2.1 明确列为缺口。

归档现在在 relocate 前执行路径、隐私、symlink 和 opaque-file 检查；必要时
通过显式 `--redact` 生成 portable copy、记录原文件 hash 和 preserved original。
TODO 的 Current Mount 同步迁移到 ledger，历史 transport 不再污染 live status。

### 2.4 Skills

判定：**分层符合，redesign 文案需要同步**。

- `wakeflow-target` 负责身份、读取顺序、范围和回传；
- `wakeflow-target-craft` 负责 plan/RED/GREEN/debug/self-review；
- controller Skill 负责证据复核和 accept/rework/redesign/blocked 判断；
- Test 只能执行已确认 Test card，不创造新目标。

本轮修正文案：

- controller 构造 `boundaries` 时必须把每个列表中最重要的条目放在最前；
  prompt 只按 `forbidden → outOfScope → inScope` 选择一条关键边界；
- 普通 rework 继续重派同一个 task；
- supplemental package 不能替代原 rework task 的新结果；
- redesign 后 Design 仍走 stateless delivery；
- controller 必须创建新的产品 task，并设置
  `replacesTargetTaskId=<旧任务>`；
- 新 replacement 接受后，旧 task/package 为 `superseded`。

## 3. 本轮选定的阶段 0/1 状态权威修正

### 3.1 Redesign 显式替代谱系

审计前：

- reducer 按同一配置仓库推断“product companion”；
- 新任务即使没有声明替代关系，也能覆盖旧 redesign task；
- 接受新结果时旧任务被错误写成 `accepted`。

修正后：

1. `decide-review --decision redesign` 将旧任务停在
   `needs-rework + reviewDecision=redesign`。
2. 旧任务不能直接重新 dispatch。
3. 新产品任务必须是产品职责窗口的 full-context `implementation`
   package，并声明 `replacesTargetTaskId`。目标窗口及被替代任务的基础窗口
   都必须来自配置的 `repoNames`；Controller、Design、Test、real-project
   及其他辅助窗口显式排除。research、documentation 和 legacy package
   也不能充当实现替代。
4. 旧任务写 `replacedByTargetTaskId`。
5. 同仓但无替代边的新任务不能满足旧任务。
6. replacement 接受后：
   - 新任务为 `accepted`；
   - 旧任务及其旧 package 为 `superseded`；
   - 多级 replacement 的已替代祖先一并进入 `superseded`；
   - demand 可在所有活动任务终结后 complete。

`superseded` 是任务级终态，不是新的 demand 顶层状态。

普通 `rework` 与 `redesign` 继续保持不同语义：

- `rework` 只能重派同一 task/package；存在活动 rework route 时不能增加
  一个旁支 package 来代替原任务；
- `redesign` 先经 stateless Design 修订，再由总控创建上述显式 replacement。

旧 transport 的迟到 delivery 或 target result 只能保留审计事实，不能把
`superseded` task/package 重新写回 `sent` 或生成新的 review candidate。

### 3.2 `create-demand` 故障恢复

审计前：

- preflight 没有调用完整 requirement-ref 校验；
- 第二个 package 失败时保留半成品；
- 相同输入不能继续，不同输入也没有稳定区分；
- 输出只有宽泛 `partial: true`。

修正后：

- init 前完成所有 package shape，并对 context 和 requirement-ref 做完整校验；
  raw CLI 与 MCP 都不能创建缺少 full-context 的新 package；
- package 存储 ID 在 preflight 中按大小写折叠检查，避免不同逻辑 ID
  写入同一个文件；
- 创建稳定 `intentDigest`；
- TODO ID 是创建身份的 canonical key；显式 `demandKey` 必须与 `todoId`
  一致，不能用同一 TODO 配不同 key 绕过创建锁；
- 使用 state root 同级的 create lock 串行化同一需求的创建、恢复和补偿；
- init 前先写同级 recovery sidecar，覆盖“init 已落地、root 内 manifest
  尚未创建”的崩溃窗口；
- state root 内保存 `.wakeflow-create-demand.json`；
- 本次新建且没有任何外部进展时，失败自动删除本次 root；即使 init 已发布
  root 后子进程异常返回，也按磁盘事实执行补偿，不依赖进程内成功标志；
- 已出现 delivery/result/evidence、TODO 消费、非本意事件或任务时，保留 root 并返回
  `partialCreated: true`；
- 相同 digest 重试前重新校验 demand/state 身份、既有 package artifact、
  package artifact 的不可变 identity/status/target binding、state 中的
  target summary、依赖关系与 binding，只补确实缺失的 package；state
  package/target 的合法 `sent` 等生命周期进展不被误判为 artifact 漂移；
- 不同 digest 明确拒绝；
- package 全部落地后再消费 TODO，最后才把 manifest 标记 `complete`；
- init 后、TODO 消费后、complete manifest 后三个崩溃窗口均可按同一
  intent 恢复；complete manifest 已落地时，只有 manifest 形状、digest、
  demand key 以及 package/target 精确全集均一致，才允许只清理 recovery
  sidecar。

该实现是 create-demand 专用补偿，不引入通用事务框架。

### 3.3 Archived 不可变与 complete 门

修正后：

- state 写命令共用 archived guard；
- `adopt-demand-host`、`recover-state-transition`、`focus-doc --write`、
  `render-progress --write` 均不能修改 archived root；
- 只允许 `sanitize-archive`，以及已写入 archive intent 的严格归档收尾；
- complete 要求非空 package/task、顶层仍是 `planned`、无 blocker；
- 每个 `accepted` task 必须有显式 `reviewDecision=accept`；
- 每个 `superseded` task 必须有双向一致、无环且最终落到 accepted
  task 的 replacement lineage；
- terminal package 状态必须与成员 task 一致；
- pending controller decisions 和未结束的 review/waiting cycle 一律拒绝。

全量测试还暴露并修复了一个锁实现竞态：等待者在旧锁刚释放、下一持有者
尚未写完 lock body 时，曾可能把瞬时不可读的新锁当成 stale lock 删除。
现在“锁已消失”只触发重新竞争；不可读 stale lock 也必须在二次检查时仍然
超过 stale 阈值才允许清理。

### 3.4 Delivery 状态推进的 canonical 输入

本轮完成 Stage 1 范围内的最小修正：

- `record-delivery-run` 必须接收 transport store 推导出的 canonical
  delivery envelope 文件；
- symlink 和 workspace 内复制文件均被拒绝；
- 在 run/state 临界区内重新读取 canonical envelope；
- 等锁期间 envelope 发生变化时拒绝推进状态。

随后完成的 Stage 2 已把 packet digest、envelope preparation digest、
task-package digest、opaque binding identity 和 lease identity 串成 canonical
chain；state import 的 recovery 路径也只能用完整链唯一匹配 delivery。

## 4. 本轮新增或加强的机器验收

- 24 个不同任务并发 `record-delivery-run`：
  所有 run/event/state 更新落地，revision 精确 `+24`。
- 该 24 路并发合同在修复锁竞态后额外连续重复 10 轮通过。
- 16 个 same-key、不同 title 并发 init：恰好一个成功。
- empty demand complete 拒绝。
- archived root 的 ordinary write surfaces 全部拒绝且文件字节不变。
- accepted-looking 伪状态、孤立 superseded 标签不能绕过 complete；
  多级 `A → B → C` replacement 只有在末端真实 accepted 时才能 complete。
- 同仓无 replacement edge 不能覆盖 redesign。
- research/legacy/Design/Test package 不能充当 redesign replacement。
- 显式 replacement 完整链：
  redesign → stateless Design delivery → replacement → result → review
  → accept/supersede → complete。
- superseded 旧任务的迟到 delivery/result 不能复活旧路线。
- `create-demand` 第二个 package 故障：
  - 无外部进展自动补偿；
  - 有外部进展返回 `partialCreated`；
  - 同 intent 恢复；
  - 不同 intent 拒绝；
  - 并发同 intent 只有一个创建者；
  - init、TODO、complete-manifest 三个崩溃点均可恢复；
  - 同一 TODO 的 demand-key alias、init 已落盘但返回失败、伪造 complete
    manifest、target summary/dependency 漂移、package 漂移与大小写碰撞
    均 fail-closed。
- workspace 内 copied envelope 不能推进 delivery state。
- full-context package 缺少 goal ref 时 fail-closed。
- prompt 只展示一条 priority context 和一条 critical boundary。

## 5. Stage 2–5 最终实现

### Stage 2：Transport 身份与单飞

- CJK-safe artifact identity，逻辑 ID 不因 ASCII slug 退化而碰撞；
- packet/group/delivery 文件使用 demand namespace，同名 group/run 可跨需求共存；
- thread registry 使用 opaque binding ID，binding digest 变化会使旧 preview 失效；
- task package → packet → envelope 使用 canonical digest chain；
- lease 为 single-flight CAS，同窗口不同 delivery 不能覆盖；
- result 只能释放匹配 delivery/group/round 的 lease，旧轮迟到结果保留历史；
- 已准备但未记录 send 的恢复结果，也必须校验完整链后才能释放 lease。

### Stage 3：Target result 合同

- TargetResultEnvelope v2 统一 state 和 transport 入口；
- implementation/research/documentation/test 按 work type 生成明确 mapping；
- acceptance anchor 逐项要求 `anchorId/red/green/ref`；
- Test 逐 approved plan index 要求 `test-step` mapping；
- completed 结果统一要求 summary/evidence/verification 及
  `changedRepos/commits/commitDisposition` 合同；
- review pack 同步检查 commit expectation、craft evidence gap 和 result mapping；
- legacy result 被结构化标识，不能伪装成 v2 完整证据。

### Stage 4：Workspace / Pod / 路径

- pod open 在 worktree/branch/overlay 前写 reservation，失败可恢复或清理；
- active-demand capacity 同时计算 current root 和 preparing reservation；
- projection 区分 `preparing`、`degraded`、active/terminal，不把 unreadable
  authority 当普通 blocked；
- durable config、derived overlay、effective config 三层分离；
- storage、archive-docs、archive-demand 对 `..`、realpath、symlink、opaque
  content 和外部路径统一 fail-closed；
- archive manifest 记录 hash、redaction、preserved original 和 TODO ledger mount。

### Stage 5：TODO / 同步 / 发布

- 所有 TODO 读写统一使用 13 列 schema 与 codec；
- literal `|` 编码为 `\|`，换行规范化为 `<br>`，反斜杠可 round-trip；
- 10/12 列旧 board 在下一次写入时迁移，不丢数据；
- deliver、consume、archive 共用 board lock，归档原子写且按 TODO ID 幂等；
- active board 和月归档 header/divider 均为精确 13 列；
- archive 的 workspace-record-map 链接由配置计算，不再硬编码目录层级；
- `sync-core` 使用 managed manifest 检出并移除 stale core-owned 文件，
  同时保留 host-owned 文件；
- 独立 release check 校验五处版本、main/clean/tag/remote、双插件 pack。

## 6. 剩余边界与后续

没有发现仍阻断设计主链路的已知代码缺口。保留以下非阻断边界：

- 本次真实测试没有新建 Codex 用户任务或实际发送线程消息；这是为了不擅自
  创建用户可见任务。真实 direct-thread send/readback 已由此前多窗口测试和
  当前 524 项回归覆盖，本轮验证的是其下游机器状态、worktree 和恢复路径。
- Claude Code 未做账号登录态交互测试；宿主 profile、tmux helper、stream、
  validate 和 smoke 均通过，不能把这些结果表述为账号可登录。
- strict release check 当前会正确拒绝：工作树未提交、`v0.8.18` 未指向 HEAD、
  `origin/main` 未指向 HEAD。本轮未获授权提交、打 tag、推送或发布。
- WakeWorkspace 归档中保留了 redacted portable copy 和
  `.wakeflow-local/preserved` 原始审计副本；这是显式 `--redact` 语义，不是
  活动 demand 或运行时污染。

后续变更继续遵循：先写失败合同，再改最小生产逻辑；不能靠扩大 prompt、
增加审批或补写说明替代机器约束。

## 7. 最终验证结果

源码与双宿主：

- `node tools/sync-core.mjs --check`：86 个共享文件一致；
- 双插件 validate：各 34 个 required file、25 个 runtime script、4 个 Skill；
- 双插件 smoke：各 31 个 MCP tool；
- 完整 `npm test`：524/524 通过，0 fail；
- `git diff --check`：通过；
- 非 strict release consistency：版本 0.8.18 与双 pack 通过；仅报告预期的
  dirty/tag/remote 警告。

WakeWorkspace 真实闭环：

- 两个 demand 同时占用 AlembicCore 与 AlembicPlugin；
- 4 个真实 Git worktree 分属不同 branch，创建前后均无产品改动；
- 两个 reservation 均从 `prepared` 进入 `consumed`；
- 两个完整 task package、两个 demand-namespaced packet/group/envelope
  独立生成；
- target result → reduce → controller accept → complete → pod close → redact
  archive → TODO monthly archive 全链通过；
- 同一逻辑 candidate 时间 ID 在两个 demand 下共存，未发生跨需求碰撞；
- 首轮发现 prepared-result lease 残留后，新增修复与回归；第二条真实恢复需求
  返回 `deliveryEnvelopeFound=true`、`resolution=controller-return-required`、
  `lockReleased=true`，pod 无 `--force` 关闭；
- TODO 归档硬编码链接修正后，`verify-workspace-docs --all-workspace` 通过；
- 最终 runtime 为 `idle / healthy`，active demand=0、pod=0、fresh lock=0；
- `wakeflow-verify --with-runtime`、layout、全 workspace docs 全部通过；
- 未发现 `.workspace-local`。

这些证据支持“完整五阶段机器外壳已实现并通过当前测试范围”，不等同于对
未来所有宿主版本、账号状态或未知故障作绝对保证。
