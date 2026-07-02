# Wakeflow 架构深度解读（设计模式与权衡评估）

> 生成于 2026-07-02，基线 v0.6.3（commit 570f8d8）；同日修订至 **v0.7.7**（并发地基 / 意图对齐 / 跨需求并行 / 需求舱 / 全仓审计加固落地后）。以代码为准。本文是对 Wakeflow 真实源码的独立深读分析——聚焦"这个架构为什么长成这样"与"付出了什么代价"，与 `wakeflow-dual-edition-architecture-and-state-flow.md`（系统参考文档）互补，不替代它。文件引用采用 `path:line` 形式，行号对应 v0.6.3。

---

## 1. 定位：它到底是什么

Wakeflow 不是一个"工作流工具"，而是一个针对 **"LLM 是不可信执行体"** 这一前提设计的分布式控制平面。它把分布式系统工程的整套武器——事件溯源、乐观并发、幂等键、租约锁、fail-closed、审计日志——移植到多窗口 agent 编排上，把每个 Claude/Codex 会话当作一个"会幻觉的节点"来设计协议。README 最后一句话是全部设计的题眼：*"make multi-window agent work safe to resume, easy to inspect, and hard to fake"*——尤其是 **hard to fake**。

## 2. 宏观结构：三平面 × 三层磁盘

系统可切成三个正交平面：

| 平面 | 载体 | 职责 |
| --- | --- | --- |
| **判断平面** | skills（markdown）+ CLAUDE.md / AGENTS.md 门禁 | 验收标准、停止条件、调度决策——留给 LLM 和人 |
| **契约平面** | `core/` 状态机脚本 + JSON 工件 + MCP | 状态转移合法性、证据门、幂等、审计——确定性代码 |
| **传输平面** | host profile + send adapter + tmux helper / Codex thread 工具 | 把提示词送进窗口，回收 readback 证据 |

磁盘同样分三层，规则是：**业务真相 host-neutral 且共享，传输句柄 host-scoped 且永不离开 `.wakeflow-local/`**：

- `workspace.config.json` + `wakeflow-ledger/` —— 提交入库（配置与耐久记录）
- `.wakeflow-active/<demand>/` —— 本地活动态（每需求一个 state root）
- `.wakeflow-local/wakeflow-delivery/` —— 传输运行时；`hosts/codex/` 与 `hosts/claude-code/` 各持有自己的 thread-registry，而 `locks/`、`dispatch-packets/`、`target-results/` 等投递主干两宿主共享

## 3. 核心闭环：一条 demand 的一生

```
next-work(容量仪表盘) → create_demand/claim_next(容量门 + 消费 TODO 行 + 盖章 controllerWindow)
  → add-task-package(可带 designIntent) → prepare-dispatch(作者化 objective)
  → DeliveryEnvelope 写盘 + 窗口锁 → 宿主发送 + readback → record-delivery-run
  → 目标窗口执行 → TargetResultEnvelope(锁释放) → [controller-return 唤醒控制器]
  → reduce-results → TransitionCandidate → decide-review(accept/rework/redesign/blocked)
  → complete-demand(全部 accepted + 零 blocker + 有证据) → archive(脱敏后入 ledger)
```

每一跳都物化为一个带 `kind`、`version`、`wakeflowTrace` 的 JSON 工件，构成一条可用 `wakeflow_view scope=trace` 回放的**证据脊椎**（`core/lib/wakeflow-trace.mjs` 统一了跨工件关联字段）。这是"hard to fake"的物质基础：任何声称都能顺着 stateRef → packet → envelope → run → result 摸到原始证据。

## 4. 核心设计模式

### 4.1 LLM-native 契约设计（最具原创性的部分）

工具输出本身被当作"给 LLM 的提示词"来工程化：

- **`forbiddenConclusions`（反结论护栏）**：几乎每个工件与输出都携带一组"禁止推出的结论"，如 `target-result-is-controller-acceptance`、`prepared-dispatch-is-host-send`（`core/scripts/wakeflow-state.mjs:1008`）。传统系统防数据损坏，这里防**读取方（LLM）的过度推断**——不是访问控制，而是"解释权控制"。
- **`agentNext`（下一步注入）**：每条 CLI 输出都带一句给调用方 agent 的行动指引，措辞直指 LLM 常见失败模式——`record-delivery-run` 成功后返回 *"end this dispatch turn... Do not poll, sleep, or run review-results just to wait"*（`core/scripts/wakeflow-delivery.mjs:175`）。
- **`allowedActions`**：状态快照显式列出当前合法动作，把状态机的可达转移翻译成 LLM 可直接消费的动作菜单。
- **提示词极简主义**：`formatTargetPrompt`（`core/scripts/lib/wakeflow-window-runtime.mjs:79-104`）生成的唤醒提示只有 5 个变量：窗口、任务 id、state root、组、skill 路径。任务详情全部留在 state root——"prompts wake, state instructs" 就是这 20 行代码。
- **上下文经济学**：`--compact` 模式的注释直接记录了生产观测——*"embedding them in every payload was the controller's single biggest context burner (60-70KB per dispatch)"*（`core/scripts/lib/wakeflow-dispatch-commands.mjs:495-497`）。工件写盘，载荷只回传路径与提示词。
- **宿主怪癖适配**：`HOST_VISIBLE_PRIORITY_TOOLS` 把闭环关键工具排到 MCP 工具列表前缀，因为某些 Codex 宿主只向模型暴露工具列表前缀（`core/lib/wakeflow-mcp-tools.mjs:533-549`）。
- **双语分层**：人读的句子跟随 demand 的 `interfaceLanguage`，机器键（currentWindow/taskId/stateRoot）契约性固定英文（`core/scripts/lib/wakeflow-window-runtime.mjs:87-91`）。

### 4.2 事件溯源变体 + 崩溃写序纪律

每个 state root 是"快照 + 追加日志 + 投影"：`wakeflow-state.json`（权威快照，单调 `revision`）、`controller-events.jsonl`（O_APPEND 追加，含 `from/to/reason/evidenceRefs/allowedWrites`）、`projection.json` + `developer-progress.md`（衍生视图，变更后标 `stale`，由 render-progress 重刷）。

写序纪律（F41）：**先写次级工件和事件，最后翻转 state.json**——崩溃最多留一条无害多余事件，绝不出现"revision 无事件"的审计空洞（`core/scripts/wakeflow-state.mjs:1267-1276`）。归档用 staging 目录 + `renameSync` 整体提交，失败回滚且活动态不动（`core/scripts/wakeflow-state.mjs:1932-1949`）。

### 4.3 乐观并发：revision 钉住一切

`reduce-results` 产出的 TransitionCandidate 携带 `fromRevision`，`decide-review` 校验不匹配即拒绝（`core/scripts/wakeflow-state.mjs:1330-1332`）；dispatch packet/envelope 钉住 `stateRef.stateRevision`，同 id 不同 revision 的重备直接失败（`core/scripts/lib/wakeflow-dispatch-commands.mjs:439-457`）。宿主所有权转移 bump revision，**自动作废旧宿主的全部候选**——一个机制同时解决"过期决策"和"跨宿主脑裂"。

### 4.4 幂等即数据（idempotency-as-data）

`core/scripts/lib/wakeflow-idempotency.mjs`：每个工件**自带幂等契约**——`key`（stateRoot+package+task+revision+group 派生）、`duplicateBehavior: "return-existing-if-equivalent"`、`safeRetry`/`unsafeRetry` 说明。内容等价用剥离易变字段（`generatedAt`）后的稳定 JSON 比较。重发投递必须换 `deliveryRunId`；`prune-runtime` GC 用 `pruneWouldBreakReplay` 保护重试链，且 **target-results 作为证据永不删除**。工件不仅可重放，还随身携带"如何安全重试我"的说明书。

### 4.5 端口与适配器：interpolate, don't branch

双发行版共享 `core/`（字节级同步），唯一例外是 `wakeflow-host-profile.mjs`——每插件持有自己的版本，`tools/sync-core.mjs` 刻意不同步它。核心规则：**核心代码可插值 hostProfile 的值，但不允许 `if (hostId === ...)` 分支**（`grep 'hostId ==='` 在 core/ 零命中）。宿主差异压缩进四个接缝：身份词汇（kinds/memoryFile）、传输工具名、启动计划（effort/model by role）、注册表布局。Codex 用原生 thread 工具，Claude Code 用约 2600 行的 tmux helper（launch-window/deliver/send/readback/activity-monitor，外加 stream-open/close/list 与 pod-open/close/list 两组跨需求命令），核心状态机对此完全无感。`npm run check:core` + 五处版本号平价测试（`test/wakeflow-version-parity.test.mjs`）把架构约束变成 CI 门禁。

### 4.6 薄 MCP façade：单一实现，双重接口

MCP 层（`core/lib/wakeflow-mcp-tools.mjs`）不含业务逻辑，每个 handler 把 JSON 参数机械翻译成 CLI argv（`apply: true` → `--write`），经 `core/lib/wakeflow-runtime.mjs` 的**脚本白名单**以子进程执行，解析 stdout 最后一个 JSON。三重收益：CLI 是唯一实现（测试直接打 CLI）；进程隔离（脚本崩溃不倒 MCP server）；执行边界收窄（`core/lib/wakeflow-process.mjs` 只放行 node/git/ps/caffeinate，禁 shell 禁 eval）。`core/mcp/server.cjs` 是**零依赖手写 JSON-RPC**，兼容行分隔与 Content-Length 双帧——为无 `node_modules` 的市场分发环境开箱即用。子进程结果包三层元信封：`wakeflowRuntimeStatus`（processOk/parsedOk/semanticOk）、`wakeflowError`（分类学错误码 + category + `retryable`）、`wakeflowHealth`（traffic/errors/saturation）。

### 4.7 Saga 式投递 + 跨宿主租约锁

窗口锁在 envelope 构建时取得（覆盖 build→send→record 全程），TTL 7200 秒，结果落盘时按 deliveryId 匹配释放（`core/scripts/wakeflow-state.mjs:1024-1032`）。语义分级：**他宿主的新鲜锁 → fail-closed 拒绝；本宿主锁 → 仅警告**（同宿主的 sent-state 守卫已防重发）（`core/scripts/lib/wakeflow-dispatch-commands.mjs:215-222`）。锁文件损坏时 `release-window-lock` 仍能恢复性删除。controller-return 路由拒绝猜测——回程链为 显式 flag > state root 盖章的 `controllerWindow`（pod 需求）> workspace 配置，三者皆无则 fail-closed，配合 `group-ready`/`per-target` 回执策略与重复回执拒绝。`deliver` 按 envelope 的 `kind` 识别 ControllerReturnEnvelope：回程送达总控窗口不占目标窗口投递锁；tmux 粘贴互斥则是独立的按窗口 `paste-<window>.lock`。

### 4.8 信任模型：权力的物理分离

- **脚本永不判断**：所有脚本只创建、校验、记录；`import-target-result` 不改 state（revision 不变），评审就绪是读取时计算的。
- **控制器是唯一验收权威**，且验收有证据门：`reduce-results` 对路径形状的 evidenceRefs 逐个 `existsSync`（按 state root → 产出窗口的 repo → workspace 三级解析），缺失即硬失败并给修复指引（`core/scripts/wakeflow-state.mjs:1128-1148`）；`complete-demand` 要求全部 accepted + 零 blocker + 至少一条证据。
- **accept 越过 blocked 结果必须显式 `--accept-blocked`**（`core/scripts/wakeflow-state.mjs:1333-1337`）。
- **目标窗口无状态权**：不能 claim、不能 finish、不能 target-to-target 链式派发，只能回 TargetResultEnvelope。
- **Design 只有一个写入口**：`wakeflow_deliver` 对全局 TODO 板 append-only，`autoClaim` 一次性写死且 requirement 类型必须挂原始计划+需求设计链接才可无人值守认领。
- **活跃需求容量门**：init 在 workspace 级 `.capacity-lock` 临界区内扫描未归档 state root，超出 `maxActiveDemands`（默认 2，设 1 即回到严格单活跃）即拒绝；`next-work` 把"自己已有未归档 state root"的 TODO 行标记为 lifecycle-blocked，防止重复建需求。

### 4.9 刹车与人因工程

`decide-review` 的四值决策编码了精细的失败升级论：rework 是产品代码缺陷（同窗口重派，`reworkCount++`）；**redesign 是"非 bug 的结果失配"——停止点修，路由回 Design 重新设计**（`redesignCount++`）；`reworkCount >= 2` 点亮 `recurringProblem`，skills 层规定此时必须换根因假设或转 redesign。`core/scripts/lib/wakeflow-review-scope.mjs` 开头注释解释了 blocked 的可恢复性设计——否则"add-task 拒绝、reduce 无任务、complete 拒绝，demand 永久卡死无出路"。

### 4.10 秘密卫生（P1-0 脱敏体系）

真实 thread/session id 只存在于 `.wakeflow-local/` 注册表：注册时拒绝占位符、信封输出一律 `threadIdRedacted: true`、`archive-demand` 用宿主声明的 `idShape` 正则全树扫描，命中则拒绝归档；`--redact` 生成净化副本入 ledger 而**原件保留在 gitignored 活动层供人工审计**。另有细节：`assertWorkspaceRootResolved` 检查解析出的根目录是否带插件清单，防止把 demand 状态写进插件缓存目录（`core/scripts/wakeflow-state.mjs:128-142`）。

### 4.11 意图对齐：并排提醒，不算分不设门（F1+F2）

需求侧意图与执行侧意图在三个时点**并排呈现**，最终判断完全归 Agent（用户裁定：机制零分数、零门禁）：

- Design 的 `designIntent` 一句话随任务包持久化，穿过 dispatch packet（放在幂等比较字段之外，不会因补写意图而触发重备失败）；
- 总控在 prepare 时作者化 `--objective`（"我在安排什么"），派发输出给出两句意图的紧凑回显 + 一条 "Intent check" `agentNext`；
- `review_pack` 每条目携带 designIntent / objective / result 三元组 + 附加式 `intentCheck` 提醒——真实漂移的出路是 `redesign` 路由回 Design，而不是点修循环。

### 4.12 跨需求并行：隔离 worktree + 需求舱（E-2 + E-6）

并行**只存在于需求层**（用户裁定：需求内每仓一窗口一组合任务包，窗口自排序，绝无同窗双派）：

- **隔离 worktree 窗口** `<repo>__<id>`（分支 `<demandKey>/<id>`）只服务跨需求隔离：后来的需求碰到已被占用的仓库时在自己的 worktree 里工作。注册只落在**派生 overlay** `.wakeflow-local/workspace.config.json`（tracked 配置的再生成副本 + stream 条目 + `derived{baseHash}` 标记；手工维护的 overlay 会让 stream 操作 fail-closed）。core 的解析器天然偏好该路径——零核心改动完成解析。
- **需求舱（demand pod）**：一需求一舱——自己的 `Controller__<pod>`、按仓库隔离窗口、自己的 `Test__<pod>`，整舱住在独立 tmux session `wakeflow-<pod>`；舱间互不感知。`pod-open` 幂等续开（registered+dead 只补 launch+register，Controller/Test 经 register-thread 注册、重开走 `--resume` 续同一会话）。关闭顺序 complete → stream-close → archive → pod-close；存活分支登记 `pending-merges.md`，**合并回主线人工审核、去中心化——任何总控不合并舱分支**。
- 容量由 `maxActiveDemands` 限舱数、`maxStreamsPerRepo` 限单仓库舱数；`archive-demand` 在隔离窗口未关时拒绝归档。
- tmux session 目标全部走 `=` 精确匹配前缀——`wakeflow` 与 `wakeflow-<pod>` 的前缀碰撞在真机上实测危险（H1）。

### 4.13 并发地基：从"约定"到"机制"（Phase 0）

v0.6.3 时的最大批评（§6.1）已被消除：`wakeflow-state-lock.mjs` 提供 O_EXCL 令牌锁（sibling `<root>.state-lock`，2s 获取超时，30s 陈旧判定 + 活 PID 4× 宽限 + 不可读锁按 mtime 老化 + EPERM 视为存活 + realpath 归一），全部六个变更型 state 命令包进 `withLockedStateRoot`；全局 TODO 板的读-改-写包进 board lock；容量扫描+首写包进 workspace capacity lock；tmux 粘贴按窗口互斥。跨宿主所有权门禁之上，同宿主并发写有了硬防护。

## 5. 工程纪律

测试钉住的是**架构不变量**而非实现细节（35 个测试文件 / 306 用例）：状态枚举三处平价、五处版本号一致、MCP 白名单与调用方交叉核对、宿主所有权 fail-closed、脱敏可用性、"result 导入不改 state"、过期候选拒绝；0.7.x 新增并发回归（双进程真竞争）、stream/pod 生命周期（headless）、多活跃容量与回程路由链、意图对齐持久化、以及禁词契约 lint（"parallel stream" 等语义漂移词进不了代码与散文）。git 历史呈现编号化需求追踪（F41、RA1-RA7、P1-0、W0-*、Phase 1a→4），代码注释直接引用编号——设计文档、提交、代码三方可互相索引。组合风格统一为**工厂函数 + 显式 ctx 依赖注入**（`core/scripts/wakeflow-delivery.mjs` 是拼装 8 个工厂的组合根），零类、零框架、零运行时依赖；高层编排脚本（demand-sequence）以**子进程**组合低层脚本，让 CLI 契约成为内部 API 边界。

## 6. 批判性评估：代价与薄弱点

1. ~~并发模型依赖约定而非机制~~ **已于 0.6.4（Phase 0）解决**：state root 文件锁 + board/capacity/paste 锁族（见 §4.13），并发回归测试双进程真竞争验证。残余风险：锁是建议性文件锁，绕过 CLI 直接改 JSON 的进程不受约束（与"脚本是唯一写入口"的纪律互为表里）。
2. **JSON Schema 只是文档**。七个 schema 无运行时校验器（无 Ajv），靠手写检查 + 测试钉住。省了依赖，但 schema 与代码的漂移只能靠测试覆盖面兜住。
3. **`forbiddenConclusions` 是软约束**。对 LLM 是提示不是强制——真正的强制在状态机守卫里。二者是纵深防御关系，但护栏第一层可以被无视。
4. **readback 证据强度有限**。tmux 版发送确认是 pane 抓屏（同行数 before/after 对照 + promptEchoed 检测，仅在"字节级不变且无回显"时告警——O-2 加固后误报已收窄），证明"提示词贴进去了"，不证明会话真正开始处理；活动监视器刻意只做观察者。这是设计上的诚实（automation "proves that a prompt was sent, not that the result is complete"），仍是链路里最脆的一环。
5. **协议步骤多**。一次派发 prepare→deliver→record 三步，一次回执又三步。compact 模式、`wakeflow_create_demand`/`wakeflow_claim_next` 聚合工具（一次替代四调用）与 `deliver --delivery-file`（一步替代临时文件+send 仪式）在持续对抗此问题，但"每步都要证据"的哲学决定了它不可能太顺滑——审计性与流畅性的直接交换。
6. **规模热点**：`wakeflow-setup.mjs` 2604 行单文件；每个脚本重复一套手写 argv 解析（hasFlag/getValue/valuesFor）。
7. ~~单活动 demand 串行化~~ **已于 0.7.5-0.7.6 演进为容量模型 + 需求舱**（§4.12）：跨需求并行由 `maxActiveDemands` 界定，"一个 state root 讲完一个故事"的可审计性按舱保留。新的真实代价转移到：舱分支的人工合并队列（pending-merges）与共享 Test 环境的跨舱串行资源管理。

## 7. 总结

Wakeflow 最值得借鉴的不是任何单个模式，而是一个完整的立场转换：**把 LLM 编排当作分布式系统问题来做，把每个模型会话当作一个不可信节点，把"防幻觉"从提示词工程升级为协议工程**。判断权（skills/人）、契约权（状态机/证据门）、传输权（宿主适配器）三权分立；每个动作物化为可追溯工件；每个工件自带幂等契约和反结论护栏；每处失败 fail-closed 且给出恢复路径。它的全部复杂度都在为四个字服务：**难以造假**。
