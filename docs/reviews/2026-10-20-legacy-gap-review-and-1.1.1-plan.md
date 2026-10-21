# 旧版逐文件复审：功能遗漏、细节差异与 1.1.1 补齐计划

> 状态：`accepted`（2026-10-20 用户按建议裁决 R1–R9；按第 8 节的批次执行，进度见第 10 节）
> 基线提交：`389de909`（`main`；`v1.1.0` 打在 `f4ac5576`）
> 建立日期：2026-10-20
> 上位文档：[开发文档系统](../README.md)、[旧版对齐台账](../references/legacy-alignment-ledger.md)、[能力映射矩阵](../references/capability-map.md)、[问题登记](../references/open-items.md)、[技术债务深挖](./2026-10-07-technical-debt-review.md)、ADR-0021
> 参考对象：仓库旁只读快照 `Wakeflow-legacy-reference/`（`git archive 629e79c5`，删旧树前的最后一个提交）；也可用 `git show 629e79c5:<path>` 读取。旧文件路径一律相对快照根，新文件路径相对本仓库根。
> 范围：没有改代码、没有跑门。五路并行审读各自读完整文件后回报（宿主效果 35 项、投递与评审 28 项、Demand/证据/归档、维护/配置/校验、技能与文本），主线另行核对了活动监视、状态投影、助手与技能文本，并对进入计划的每一条在当前代码里复核了出处。

## 1. 总体判断

前两轮对齐（台账 §1–§3：117 个模块、约 420 个导出函数）证明的是"每段旧逻辑在新版里有 owner"。这一轮按行为与设计细节再读一遍，结论是：**旧版没有整块功能被遗漏，但有六类细节在重切时丢了**，其中三类是用户在现场直接感受得到的。

| 类 | 一句话 | 代表项 | 现场印证 |
| --- | --- | --- | --- |
| A 现场可观察性 | 旧版在 tmux 里给每个窗口一个活动 glyph，给每个 Wakeflow 面一条状态行，有 fleet 诊断；新版只剩 `wakeflow_status` 里的文字 | T24、T3、M2 | 用户："太多窗口会难以观察"（§13.186 为此加了 per-pod 会话）；工作区 8 的 Design 窗口状态行只有模型名 |
| B 投递与 Demand 的守卫 | 旧版在计划、认领、rearm 时都要求"没有待决评审"，退役目标会释放租约，提示词带全部边界；新版各丢一条 | D1、D2、D8、D27、D7 | 刹车（§13.131 `demandReworkEscalationThreshold`）的文字承诺"等用户决定"，工具并不拦 |
| C 技能的工艺深度 | 旧 target-craft 的七条实践、rework 回应协议、test 的自证据复查、design 的澄清/选项/切片方法在新版压缩成"诚实的顺序" | S 组（待第 7 节） | 工作区 7 的 ts-1 重跑、Core 窗口把临时文件写进根目录（§13.188 四条 Agent 侧引导就是这类） |
| D 助手健壮性 | 旧 transport 每个 tmux 子进程都有超时并强制 UTF-8 locale；新助手 `run()` 无超时，不设 locale | T11、T10 | 未现场触发；`deliver`/`resume` 的屏幕判定依赖 `❯ … ─` 字符 |
| E 用户文件的归属守卫 | 旧版把用户自定义的 statusLine 留着并报 `custom-statusline`；新版无条件覆盖 | T31 / M1 | 未现场触发（测试工作区没有自定义状态行） |
| F 死掉的布局声明 | 宿主画像与资源目录仍声明 keep-live、activity-monitor、temp/prompts、`operations/window-locators`，真正在用的 `identity/window-locators` 没声明 | T12/T21/T25 = J5 | 每个工作区都带四个空目录 |

另有一组**设计层问题**不适合当补丁做，列在第 9 节由用户裁决：目标间依赖（D3）、按包要求证据种类（D4）、评审前的结果更正（D5）、翻转仓库的 `instructionManagement`（M4）、按 selection 摘要派生 id 的跨工作区碰撞（M5）、keep-live 与 unattended 的去向。

**明确不恢复**（都有 ADR 或能力卡裁决，这轮复核后维持）：后台活动轮询进程（卡 10 Q3）、keep-live 守护进程（卡 10 Q1）、unattended 与激活范围（卡 10 Q2）、显式迁移与 legacy 分类（ADR-0008）、storage 视图与 preserve（ADR-0006）、全局 TODO 表（ADR-0011）、派发组与评审候选（ADR-0012）、通用 recover（ADR-0002）、窗口排列 `arrange`（卡 02 Q8；旧版按 UUID 排序，对观察没有帮助）、23 命令的宿主门面与随制品发货的 validate/smoke。

## 2. 量化基线

| 指标 | 旧快照（629e79c5） | 当前（389de909） |
| --- | --- | --- |
| 共享运行时 | `core/scripts/lib` 86 个模块，约 130k 行；入口 5 个（validate 6,626、bootstrap 927、smoke 499、cli 249、setup 228） | `src/` 365 文件、128,349 行（foundation 20,369 / contracts 793 / kernel 8,291 / capabilities 20,502 / governance 41,595 / configuration 3,018 / workspace 25,269 / hosts 6,511 / entrypoints 2,001） |
| Claude 宿主 | 12 个 `wakeflow-claude-*.mjs`，约 11,400 行；门面 23 个命令 | `src/hosts/claude-code` 19 文件；tmux 助手资产 1,938 行（10 个子命令） |
| Codex 宿主 | 6 个 `wakeflow-codex-*.mjs` | `src/hosts/codex` 8 文件 |
| 公共工具 | 31 | 20 |
| 技能与命令 | 4 份技能 + 14 份参考/资产，7 个命令，CLAUDE.md 422 行，README 661/541 行 | 4 份技能 + 6 份参考，4 个命令，README 157/121 行 |
| 校验 | `verifyWakeflowWorkspaceV3` 15 门 + `validate.mjs` 51 项静态检查 | `wakeflow_verify` 15 门 + `build:check`/tests/artifacts 开发侧检查 |

审读覆盖：宿主效果一路读完 12 个旧模块与 22 个新文件；投递评审一路读完 9 个旧模块、13 份旧 schema 与 60 余个新文件；维护一路读完维护、配置、布局、托管内容、宿主资产与 validate/smoke/setup；Demand 与技能两路见各自小节。

## 3. 宿主效果（Claude Code：tmux 生命周期、定位器、传输、活动、设置）

旧侧 `plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-{lifecycle,locator,transport,activity,settings,pod-host,decommission,host,activation-scope}.mjs` 与 `core/scripts/lib/wakeflow-{keep-live-*,host-activation-*}.mjs`；新侧 `src/hosts/claude-code/*`、`src/workspace/window-runtime/*`、`src/entrypoints/wakeflow-hook-observer.ts`、`src/capabilities/endpoint/pane-classification.ts`。35 项里 ported/recut 22、different-by-design 6、dropped-by-decision 7，下面只列有差异或要动的。判定词：ported / partial / missing / dropped（有裁决）/ by-design。

| id | 旧行为（出处） | 现状（出处） | 判定 | 建议 |
| --- | --- | --- | --- | --- |
| T24 | 活动监视把 `@wakeflow_state=running` 写到窗口选项，闲置时恢复旧值（`wakeflow-claude-activity.mjs:1690-1707`）；v3 代码里没有任何 `window-status-format`，glyph 的消费方只在归档文档里 | 无；`grep wakeflow_state src assets` 为空。每窗口状态（`attention`、`runtime stale`、`launchIntent drifted`）只在 `wakeflow_status` 文字里 | dropped（卡 10 Q3，用 hook 取代） | **按 hook 事件重做**，不轮询：见第 8 节批 1 与第 9 节 R1 |
| T23 | "运行中" = 抓屏匹配 `esc to interrupt` 或 pane 摘要较上一轮变化（`:1847-1860`），1.5 s 轮询 | `BUSY_PATTERNS`（助手 `:168-174`）只在 deliver / resume --in-place / nudge 时点判一次 | partial（by-design） | 同 T24：状态来源改为 hook 记录 |
| T3 | `retitle-window` 把漂移的窗口名收敛回 `displayName`（`lifecycle.mjs:746-790`）；卡 02 Q8 裁决"保留 retitle、放弃 arrange" | 助手没有 `rename-window`（0 处）；标题只在开窗时冻结 | missing | `mark` 时若 `#{window_name}` ≠ 意图的窗口名就 `rename-window`（S） |
| T31 / M1 | statusLine 只在本地设置没有自定义命令时写；用户自定义的报 `custom/unmanaged` 留着；写前用 `git check-ignore` 证明 `settings.local.json` 被忽略（`settings.mjs:713-922`） | `renderTarget` 无条件替换 `statusLine` 键（`claude-code-statusline-settings-operation.ts:205-221`）；忽略状态由工作区 `.gitignore` 托管块保证，不再单独证明 | by-design 但有回归 | 非 Wakeflow 的 `statusLine.command`（无 `--wakeflow-statusline-v1`）时不写、报 `statusline-custom` 诊断（S） |
| M2 | 本地设置写到程序根与每个 wakeflow-managed 支撑面（Design、Test 窗口也有状态行） | 只在工作区根计划一次（`claude-code-maintenance-capability.ts:128`）；工作区 8 的 Design 窗口状态行只有 "Opus 5.5" | partial | 对 wakeflow-managed 支撑面各写一份 `settings.local.json`（S） |
| T11 | 每个 tmux 子进程有超时（transport 5 s、lifecycle 10 s）与 1 MiB 缓冲 | `run()` 用 `spawnSync` 不设 `timeout`（助手 `:475-485`） | missing | 加 10 s 超时，超时映射为拒绝并带 `boundedDetail`（S） |
| T10 | `LC_ALL ?? LANG` 不含 utf-8 时强制 `en_US.UTF-8`（`transport.mjs:515-533`） | `hostEnvironment()` 删 `TMUX*`、过滤 `CLAUDE*`、传 `PATH`，不设 locale | partial | 同旧版补 locale 兜底：屏幕判定依赖 `❯`、`…`、`─`（S） |
| T12/T21/T25 | 定位器在 `operations/window-locators`，提示临时文件在 `operations/temp/prompts`，keep-live 在 `operations/keep-live` | 定位器实际在 `identity/window-locators`（`locator-store.ts:41-102`）；画像仍 `keepLive/activityMonitor/temporaryPrompts: true`，目录表仍声明四个无人使用的目录，真目录没声明 | dropped 但有残留 = open-items J5 | 目录表只声明真目录、导出一个常量供 store 与助手共用；reconcile 对旧空目录只报告（M） |
| T14 | 每窗口操作互斥锁（launch/resume/replace/close/retitle/arrange/send/readback/reconcile） | 无；靠工作声明（一个窗口一条，无 TTL）与绑定存储锁 | dropped（D23/D30） | 不恢复：一个 pod 一个 Controller |
| T28 | 关闭后最多 8 次 `list-panes` 复探，只有"杀成功且缺席"才 machine-verified | 杀前后各读一次 pane 清单；只有恰好一个 pane 同时对上坐标与五个标识才杀 | recut | 不动（kill-window 同步） |
| T7/T17/T18/T19 | 启动等 6 s 轮询 pane；回读一次；粘贴不看屏幕；幂等靠传输阶段 | 等 hook 记录（默认 20 s）；回读看首行或 `[Pasted text #N +M lines]`；粘贴前拒 `target-not-at-prompt`；`already-landed` 幂等 | by-design（更强） | 不动 |
| T25 | keep-live（caffeinate）四类记录与服务，没有生产调用方 | 无 | dropped（卡 10 Q1） | 不恢复代码；在首次交接卡加一句"长跑前自己保持机器不睡眠"（S，文本） |
| T26/T27 | `/wakeflow:unattended`、激活范围门（旧版观察适配器从未发货，门永远 forbidden） | 无；`permissionMode` 走 reconfigure，默认 `auto` | dropped（卡 10 Q2） | 不恢复；见第 9 节 R6 |

主线自查补充：旧版 `inspectClaudeWindowFleet` 的 fleet 表（membership / binding / locator / authorityEligible）在新版拆成 `wakeflow_status.windows`（身份、声明、最近 hook、attention、runtime）与助手 `panes`/`mark` 状态，内容齐全但分在两处、都不是一眼能看的；批 1 的 glyph 落地后，用户在 tmux 窗口列表里就能看到每个窗口在干什么，比恢复 fleet 表更直接。

## 4. 投递、传输、结果与评审

旧侧 `wakeflow-delivery-orchestration.mjs`（3,780）、`wakeflow-transport-*.mjs`、`wakeflow-result-review-orchestration.mjs`、`wakeflow-window-lease-*.mjs`；新侧 `src/capabilities/{delivery,result-review,endpoint}/`、`src/governance/{delivery,result,review,tasking}/`、`src/governance/demand/model/demand-aggregate-state.ts`（AGG）。28 项里 ported 12、by-design 7、dropped 4；下面是 5 条丢失的守卫与 4 条设计层问题。每条的出处都在当前代码里复核过。

| id | 旧规则（出处） | 现状（出处） | 判定 | 后果 | 建议 |
| --- | --- | --- | --- | --- | --- |
| D1 | 计划、认领、rearm 都要求 `review.status === "idle"`（`delivery-orchestration.mjs:782-790, 2881-2893, 3651-3661`） | `derivePrepareBlockers`/`deriveRearmBlockers` 只看目标 phase（`src/capabilities/delivery/decide.ts:177-206`）；AGG 的 prepare 守卫只看 `lifecycle === "active"`（`:1605-1625`）；`awaitingDecision` 只被路由（`demand-controller-route.ts:473-489`）与 test 计划（`tasking/decide.ts:322`）消费 | missing | Demand 在 `awaiting-decision`（escalate 或 rework 刹车）时仍能对 `rework-requested`/`planned` 目标准备投递与 rearm；刹车文字"requires a user decision before further delivery"没有被工具兑现 | 给 `PrepareTargetView`/`RearmTargetView` 加 `awaitingDecision`，阻塞项 `awaiting-decision`；AGG 两处守卫同样 `fail("transition", "$state/awaitingDecision")`（S） |
| D2 | 租约可由精确持有者释放；窗口持有他人租约时拒绝计划（`window-lease-service.mjs:1548-1632`） | `REPLACEABLE_PHASES` 含 `delivery-prepared`（AGG `:2702-2710`）；`supersedeTarget` 丢掉 `currentDelivery` 但声明留在盘上；替代目标的投递报 `window-claimed:<旧目标>`（`delivery/decide.ts:218-235`）；`release-claim` 只在过期（2 h）、`session-end` 或 pane 缺席时放行（`endpoint/decide.ts:210-227`） | partial | 许可已发、尚未送出就替代目标时，窗口声明被困 2 小时，`work-claims-released` 门同时挡住完成与取消 | 从 `REPLACEABLE_PHASES` 去掉 `delivery-prepared`：先记 `failed-before-send`（→ `host-effect-rejected`，声明释放）再替代；`lineage-target-in-flight` 已能给出可读原因（S；第 9 节 R3 二选一） |
| D8 | 派发包携带完整 `boundaries {inScope, outOfScope, forbidden}`、全部锚点、`completionExpectations` | 提示词只渲染 `boundaries.forbidden[0]`（`delivery/prompt.ts:429-434`），不像锚点那样有"… N more"（`:262-270`，§13.134） | partial | ≥2 条 forbidden 时其余静默丢失，目标窗口不知道要去任务包里找 | forbidden 按锚点同样的上限与"… N more"渲染（S） |
| D27 | 记录 outcome 时要求信封的绑定仍是当前绑定（`:2802-2812`） | `executeOutcome` 按 `windowId` 读当前绑定，不比对 `envelope.route.bindingId`；`executeRearm` 比对（`delivery/service.ts:2135`） | partial | 只有"强制释放声明后 replace"才可达；届时新会话落地的同一段 prompt 会把旧信封标成 accepted | outcome 与 rearm 同样拒 `binding-changed`（S） |
| D7 | `rejected-before-send` ⇒ readback `unavailable`、attempts 0、evidence 空（`transport-records.mjs:1990-2003`） | `delivery-outcome.schema.json` 的 `allOf` 只把 disposition 绑到 `claimHandling`；readback 自由 | partial | 记录可以内部矛盾：从未到达窗口的投递带 `readback: confirmed` | 加一条 if/then 或在 `outcomeDraft` 归一（S） |
| D6 | 非 accepted 的 run 必带 `error {code, message}` 与 `hostMethod/hostMode` | outcome 只有 `attempt.status` 与 `evidenceDigest` | missing | 反复 rejected/indeterminate 后事件流里没有宿主错误码 | 可选 `attempt.failure {code, summary}`（经隐私规则）；defer |
| D3 | `dependsOnTargetTaskIds` 全部 accepted 才能投递（`:846-853`） | 任务包没有依赖字段；谱系只排同仓库 | missing（无裁决记录） | 跨仓库顺序只能人工保证 | 第 9 节 R4（M） |
| D4 | 完成结果必须带 `reviewInputContract.requiredKinds` 全部种类 | 证据种类是闭合词表且必须解析到本 Demand，但没有"按包要求的种类" | missing | 零证据的 completed 结果可导入，评审者得自己发现 | 第 9 节 R4（M） |
| D5 | 同一信封轮次内可以 `supersedes` 更正报告（`demand-artifact-service.mjs:1134-1394`） | 一个声明代际至多一份结果（`target-result.ts:374-379`） | dropped（代码注释，无 ADR） | 报告里写错 commit/摘要只能走 rework（计入刹车阈值 3）或接受 | 第 9 节 R5 |

其余（D9 配置漂移、D10 检出互斥、D11 租约 TTL、D12 回读必需、D13 派发组、D14 候选、D15–D17、D19–D26、D28）都是 ported 或有裁决的 by-design，不动。审读方还指出一处不对称：Controller 写的 goal/focus/boundary 只过私有值边界，不过报告文本那套凭据/路径/UUID 扫描（`delivery/service.ts:1095-1100` vs `result-review/service.ts:973-979`）——不是旧版回归，列为观察。

## 5. 维护、配置、托管内容、宿主资产与校验

旧侧 `wakeflow-{fresh-initialize,reconfigure,reconcile,maintenance-*,workspace-mutation,config-v3*,layout-descriptor,local-layout*,managed-content,rule-model,support-*,host-settings-assets-owner}.mjs` 与 `wakeflow-{setup,smoke,validate,cli,bootstrap}.mjs`；新侧 `src/{capabilities/workspace,workspace,configuration,hosts}/`、`tooling/artifacts/*`、`tests/artifacts/*`。这一路的结论是"几乎全部 ported 或 recut 且有理由"，差异在六处：

| id | 差异 | 出处 | 判定 | 建议 |
| --- | --- | --- | --- | --- |
| M1 | 见 T31：用户自定义 statusLine 被覆盖 | `claude-code-statusline-settings-operation.ts:205-221` | 回归 | 批 2 |
| M2 | Design/Test 窗口没有状态行（旧版每个 wakeflow-managed 面都写本地设置） | `claude-code-maintenance-capability.ts:128` 只对工作区根计划 | 回归（现场可见） | 批 1 |
| M3 | 制品里没有任何自检（旧版随制品发 `validate`/`smoke`）；用户侧只剩 `wakeflow_verify` | §13.101 D1 | by-design | 不动；`wf doctor` 是开发侧 |
| M4 | 没有把已有仓库在 `owner-managed` 与 `managed-block` 之间翻转的 reconfigure 路径（信封层有 `removeWakeflowManagedTextEnvelope`，没有规划者用它） | `wakeflow-static-materialization-preview.ts` 的 `reconfigureTopologyChange` | 缺口 | 与 J1/Q9（退出路径）一起裁决，第 9 节 R7 |
| M5 | 持久 id 由 selection 的规范摘要派生（`wakeflow-fresh-config-selection.ts:334-399`），selection 字节相同的两个工作区得到相同的 program/window/pod id；助手按 program+host+window 标识识别 pane | 旧版随机 UUID | 设计差异带风险 | 种子加入工作区根 realpath（apply 在同一根重算，不影响确定性）：第 9 节 R2 |
| M6 | 切换前（本仓库开发期）的 `managed-content:v1` 块用旧 component/owner id，会报 `*-envelope` 而不是 residue | 残留扫描只认 0.9.x 的 `wakeflow:scope:start` | 只影响旧开发目录 | 不动，记一句 |

校验：旧 15 门与新 15 门按名字对不上但按事实对得上（config-authority、local-layout、active/board、ledger、work-claims、pod-execution-location、window-identity/runtime 等），新版多 host-hook-channel、host-settings-assets、evidence-integrity、append-candidates-clear、runtime-artifact 五门；旧版的 repository-roots、storage-inventory 随 ADR-0006 去掉，仓库事实在 `wakeflow_status.repositories`。旧 `validate.mjs` 的 51 项静态检查里，制品闭包、marketplace、工具声明、技能包形状与链接闭合、引擎范围、schema 漂移都在 `build:check` 与 tests/artifacts 里；去掉的是汉字白名单与全角标点扫描、项目专有词扫描（`Alembic*`）、`[TODO:` 扫描——这三项由 `wf handoff` 的 private-content 与 honesty 预算覆盖一部分，项目专有词扫描没有对应物（§13.183 曾因 Alembic 字样进文档返工），列为批 2 的开发侧小项。

## 6. 技能、命令、根指令文件与 README

旧侧 `core/skills/{wakeflow-target-craft,wakeflow-test,wakeflow-design,wakeflow-governance}/**`（19 份）、旧插件的 `CLAUDE.md`（422 行）、`commands/*.md`（7 个）、`README.md`（661 行）、Codex 的 `AGENTS.md`、旧制品里的 controller/target SKILL（599/197 行）；新侧 `assets/agent-text/**`（4 份技能、6 份参考、4 个命令、两份 README）与两宿主的占位符表。83 个概念里 ported 38、different-by-design 9、intentionally-removed 14（都有 ADR：TODO 表、派发组、候选、autoClaim、unattended、designIntent、`controllerSelfChecks`、测试卡），**weaker 或 missing 22**，集中在三处：target 的工艺、Controller 的判断规则、Design 的方法。预算约束：SKILL ≤200 行 / 12 KiB（controller SKILL 已满 200 行，渲染后余 800 B）、参考 ≤400 行、命令 ≤40 行（init 已满）；诚实性门拉黑的旧词（`unattended`、`TODO row`、`dispatch group`、`review pack`、`keep-live` 等）不能回来。

| id | 旧概念（出处） | 现状 | 判定 | 建议落点 | 行数 |
| --- | --- | --- | --- | --- | --- |
| S5 | 改代码前先跑相关套件记基线，红基线要报告而不是据为己有（target-craft `:60-69`） | 无（"baseline" 在 target 文本里没有出现） | missing | `wakeflow-target/references/craft.md` | +4 |
| S6/S24 | 行为改动与缺陷先写会失败的检查，经真实入口复现、不 mock 被验证的边界、修事实丢失的第一处、留公共接缝的回归测试（`:71-100`） | craft.md 只有"诊断对着现有代码、最小一致改动、不改测试凑通过" | weaker | craft.md "Before you change code" | +6–8 |
| S2/S4/S7/S8 | 每条锚点先写出"今天失败、改后通过"的检查；多步时写有序步骤与各自的检查，压缩后重读包与计划；排序可证伪的假设、一次只动一个变量；两遍自审（先对包的原文核对规格，再按严重度看质量）（`:30-31, 46-58, 102-131`） | 分别为：无 / 只"写下边界" / 只 reproduce / "像别人写的那样重读 diff" | weaker | craft.md | +12–14 |
| S11 | 收到 rework：对着 diff 而不是记忆读 Controller 的理由；逐条回应，同意就修、不同意给证据；先当缺陷复现；不盲修让提示消失（`:154-166`） | 无：rework 投递带 "Rework basis"，target 文本没说怎么处理 | missing | craft.md 新节 "When the delivery is a rework" | +8 |
| S12/S53/S54/S64/S51 | 缺陷 vs 非缺陷错配的判断与路由（点修循环要停、交回 Design）；缺失输入按归属路由而不是猜；Controller 不写产品代码；验收决定要说清什么（目标、每条锚点的独立检查、未验证项、残余风险、下一步） | 机器有刹车（`DEMAND_REWORK_ESCALATION_THRESHOLD = 3`，每个决定返回 `reworkCount`），文本没提；`delivery-and-review.md:35` 还写着已删除的 "redesign decision"；controller SKILL `:39-41` 的措辞像是 Controller 可以编辑产品仓库 | weaker + 两处措辞错误 | `delivery-and-review.md` Step 11 | +18–22 |
| S22/S40/S41/S33/S44/S43 | 写测试步骤的方法（一个问题与对象边界、能证明该条的最低层、可观察信号、pass/fail 含义、flaky 是证据退化、"跑套件"不算步骤）；独占环境是跨 pod 串行资源；只建连接/空 API/mock/未接消费者的任务不算完成（thin implementation → 返工并点名缺的消费者）；目标发现的事只能经补充包/完成定义内的已证实 bug/授权优化成为工作 | Test 不再规划（ADR-0012 D4），但 Controller 侧没有写步骤的指引；thin-implementation 规则缺席；craft.md `:35-36` "a reviewer can turn it into its own task in a minute" 与"遗留物要有授权"矛盾 | weaker / missing | `delivery-and-review.md` Step 6 | +12–14 |
| S30/S31/S32/S35/S38 | 澄清法（用具体场景试探模糊术语、记录代码/文档矛盾、未答决定会让下游猜就 not-ready）；选项法（2–4 个真实备选同维度比较、推荐一个并说什么证据会推翻、只有接口/mock/adapter 的不算选项）；完成定义写失败路径与用户如何验证；真实环境决定要写环境引用、配置值来源、数据准备/重置、独占或共享资源、允许的操作；更正包回应 escalate 时写观察到的 vs 预期的效果 | requirement-package.md 有压缩版澄清（三条）；选项法缺席；环境规格只有一句 | weaker / missing | `wakeflow-design/references/requirement-package.md` 与 design SKILL 的 Correction | +18–20 / +2 |
| S56 | 子代理只做有界的并行查找/日志分流/摘要，输出是建议，不转移派发、验收、状态写入、仓库归属与用户确认权（根 CLAUDE.md `:54-58, 169-171`） | 任何文本里都没有 "subagent"/"helper agent" | missing | target SKILL "Bounded expectations" +2；`delivery-and-review.md` Step 10 +2（宿主中立措辞） | +4 |
| S72 | README "Security & System Impact"：本机跑什么、不联网、无遥测、宿主效果分离、权限模型（旧 README `:271-290`） | 新 README 的"What Wakeflow will not do"与 HOST_TRUST_STEPS 分散覆盖，没有"它会碰你机器上的什么"一节；本仓库 `src/` 不含任何网络 API（已核） | weaker | 两份 README 各加一节 | +10–12 ×2 |
| S48 | "先想后做"：任何动手冲动在说清安全操作与一句话下一步前都是硬停（根 CLAUDE.md `:12-16`） | status 驱动的路线取代了仪式；/next 只说"做一步就停" | by-design，但仪式缺席 | `commands/next.md`（余 18 行） | +2 |
| S14 | 分支卫生：没有 WIP/调试提交与注释残渣，提交信息说为什么（target-craft `:226-231`） | craft.md 只有"不改历史、不 force、不碰别人的树" | weaker | craft.md | +2 |
| S3 | 锚点不可测/与权威冲突/缺事实 → `needs-review`，不自造目标 | target 的停止条件没有这一条 | weaker | target SKILL 停止条件 | +1 |
| S52 | 完成前逐条对照需求设计与非目标，"任务都 done"不够 | `requirement-coverage` 门只查验收条目；非目标完成时不再读 | weaker | `delivery-and-review.md` Step 12 | +2 |

退役的五个命令（/check、/dispatch、/review、/windows、/unattended）的用户意图都有归宿：/check 并入 /status（status 矛盾时跑 verify，unavailable 报 unchecked）；/dispatch 与 /review 并入 /next 的 Step 7–11；/windows 由 status 点名未登记/attention/drifted 窗口并用自然语言走 windows 参考；/unattended 的意图由 `hosts.claude-code.launch.permissionMode` 的 reconfigure 覆盖。旧根 CLAUDE.md 的"标准派发提示词"结构已由代码渲染（`delivery/prompt.ts` 的 LABELS）取代，比手写更强。

审读方的两条不确定：`landing.md` 的解析器是否容忍额外标题（S31 的选项段最稳妥作为 "Landing plan" 下的段落）；任务包里 commit 期望的现名（S14 措辞要对上）。

## 7. Demand 生命周期、需求入口、证据、归档与投影

旧侧 `wakeflow-demand-{core-records,state-service,lifecycle-orchestration,publication-service,document-builder,artifact-*}.mjs`、`wakeflow-evidence-*.mjs`、`wakeflow-business-archive-*.mjs`、`wakeflow-ledger-*.mjs`、`wakeflow-active-projector.mjs` 与 29 份旧 schema；新侧 `src/governance/{demand,lifecycle,controller,evidence,ledger,observation}/`、`src/kernel/{active-projection,requirement-board,privacy-scan}.ts`、`src/capabilities/{demand,requirement,evidence,observation}/`。22 项里 ported 7、by-design 8、dropped 2（都有裁决）；下面 5 条要做或要裁决，其余不动。

| id | 旧规则（出处） | 现状（出处） | 判定 | 后果 | 建议 |
| --- | --- | --- | --- | --- | --- |
| G12 | 证据单文件上限 16 MiB ≤ 归档单文件 64 MiB：能记录的都能归档（`wakeflow-evidence-tree.mjs:40`、`business-archive-service.mjs:108-110`） | 证据 `MANAGED_EVIDENCE_PAYLOAD_LIMITS.maxFileBytes` = 32 MiB（`managed-evidence-manifest.ts:82-90` 继承 foundation 的 32 MiB）；归档 `DEMAND_TREE_CAPACITY.maximumFileBytes` = 16 MiB、整根 256 MiB、"超出即拒绝归档，不做部分归档"（`capabilities/demand/archive.ts:81-88`） | missing（数值策略不一致，无裁决） | 记录了一个 16–32 MiB 的证据成员（或多条记录合计超过整根上限）的 Demand 既不能完成也不能取消 | 证据上限由归档容量推导（把 `DEMAND_TREE_CAPACITY` 搬到 kernel 两边共用）；证据预览对"根字节 + 负载 > 整根上限"加阻塞项（S / M） |
| G3 | 所有归档文本（含 reason）先过隐私检查才能持久化（`business-archive-records.mjs:1487-1556`） | 入口处扫描：需求标题/文档/测试摘要/parked 触发、withdraw reason、结果报告、证据负载；**不扫**：cancel `reason`、decision `text`、continuation `summary`（`capabilities/demand/lifecycle.ts` 没有任何 `scanPrivacy`）；终态预览却扫全部负载文件含 `event-sourcing/commits`，且 `payload-privacy` 不在 cancel 的跳过表里（`demand/decide.ts:174-190`） | partial | 决策或续接文本里一段凭据形状的字符串会同时挡住完成与取消，而事件流只追加不可改——Demand 永远到不了终态；取消理由带凭据则未扫就封进账本 | 在三个规划器里按 `CREDENTIAL_PRIVACY_FINDING_KINDS` 跑 `scanPrivacy`，给 `privacy:<kind>` 阻塞项（与 `requirement/service.ts:599` 同形）；顺带核对 escalate 的 issue/options/recommendation 是否已扫（S） |
| G4 | 进度页写明目标、完成定义、身份、当前状态与理由、测试模式与环境、权威引用、事件史（`demand-document-builder.mjs:378-420`、模板 `:7-33`） | `renderDemandProgress` 只有路由行、待决问题、六个计数、证据数、最后事件（`kernel/active-projection.ts:732-768`）；事实构建只取 `title/demandType/podId`（`active-projection-facts.ts:199`），`goal`、`completionDefinition`、`requirementId`、`testingDecision` 已在加载的数据里却没用 | partial（事件史按 §13.101 D9 有意不加；其余是遗漏） | 人读进度页回答不了"这个 Demand 是做什么的、怎么算完、哪个包、什么测试模式" | 事实加四个字段，`renderDemandProgress` 在计数前渲染有界块；不加 I/O（S） |
| G2 | 取消理由随板/TODO 血缘持久化 | `wakeflow_cancel_demand` 把用户理由存进事件，但撤回需求包时只写 `demand-cancelled:<demandId>`（`lifecycle.ts:784`）；`workspace-observation.ts:983` 按**相等**比较这个字面量 | partial | `wakeflow_inspect_board` 里撤回的包没有人类可读的理由 | 写 `demand-cancelled:<demandId>: <reason>`（≤4096，先过 G3 的扫描），观察侧改为前缀匹配（S） |
| G7 / G1 | 归档可读回：manifest 带 `title`、`conclusion`，`inspectDemandBusinessArchive` 返回摘要与选中结果（`business-summary.schema.json`） | `wakeflow_status{demandId}` 对已归档 Demand 只返回 `outcome, archiveRef, archivedAt, terminalEvent, manifestDigest`（`observation/service.ts:868-876`）；完成记录没有 prose 字段；归档评审快照只用于 `unmergedAccepted` | partial（ledger 索引按卡 03 §3.5 放弃；读回面缺席） | "Demand X 交付了什么"只能手读 `archives/<id>/<rev>/payload/**` | 第 9 节 R8：扩 `wakeflow_status{demandId}.archive`（标题、目标、已接受目标的分支/提交/摘要、证据数、verify 失败数），不加持久成员（M） |

其余：G5 完成覆盖（新版比旧版严，ADR-0014）、G6 证据字节在完成时不重哈希（defer，M）、G9 取消不改写阶段（by-design）、G10 撤回的包不能再认领且没有提示（defer，S：预览给 `package-withdrawn:<id>`）、G11 看板索引缺测试模式与 parked 触发两列（defer，S）、G13 证据来源与隐私（新版更强）、G15–G22 ported/by-design。审读方的一条不确定留给批 3 核对：escalate 文本是否在追加事件前扫描。

## 8. 1.1.1 补齐批次

每批的完成条件同技术债务复审第 8 节：按 `impact report` 的级别过门、`wf handoff` 绿、gate-log 一节、登记更新；影响制品的批次重建并 smoke。**批 0 必须最先做**：`v1.1.0` 已打，`plugins/` 的任何字节变化前先 bump（ADR-0021 规则 2，`wf handoff` 的 `version-bytes` 强制）。

| 批 | 内容 | 来源 | 级别 | 前提 |
| --- | --- | --- | --- | --- |
| 0 版本与登记 | `npm run wf -- release bump --version 1.1.1 --apply`、重建制品、提交；open-items 新开一节登记本页的 id | — | 1 | 用户裁决第 9 节 R1–R3（其余可后补） |
| 1 现场可观察性 | (a) hook 驱动的 `@wakeflow_state`：观察器在**已绑定**会话且环境里有 `TMUX_PANE` 时，按事件写 `working`（user-prompt-submit）/ `idle`（stop）/ `attention`（notification）/ 清除（session-end）；`mark` 给每个受管窗口单独设 `window-status-format` 与 `window-status-current-format`（`#{?@wakeflow_state,[#{@wakeflow_state}],}`，从不 `-g`）；`close`/`teardown` 顺带清理；windows 参考与交接卡各一句。不回来的：轮询进程、抓屏判定、`@wakeflow_prev_state` 的保存恢复。(b) Design/Test 支撑面各写一份 `settings.local.json` 的 statusLine（M2）。(c) `mark` 时窗口名与意图不符就 `rename-window`（T3，卡 02 Q8 的保留项）。(d) 交接卡加一句"长跑前自己保持机器不睡眠"（T25） | T24/T23、M2、T3、T25 | 2 | R1 |
| 2 助手健壮性与归属守卫 | `run()` 加 10 s 超时并映射为拒绝（T11）；`hostEnvironment()` 的 UTF-8 locale 兜底（T10）；非 Wakeflow 的 `statusLine.command` 不覆盖、报 `statusline-custom`（T31/M1）；honesty 门加"制品文本不含项目专有词"（M5 校验小项） | T11、T10、T31、M5 | 1 | — |
| 3 投递与 Demand 守卫 | D1 `awaiting-decision` 阻塞 prepare 与 rearm（decide + AGG 两处）；D2 按 R3；D8 forbidden 全列加"… N more"；D27 outcome 比对 `bindingId`；D7 outcome 的 readback/disposition 交叉规则；G3 三处文本的凭据扫描（并核对 escalate 文本）；G2 撤回理由带用户文字、观察侧改前缀匹配；G12 证据上限由归档容量推导；G4 进度页四个事实 | D1、D2、D8、D27、D7、G3、G2、G12、G4 | 2 | R3 |
| 4 技能与文本补深 | target：craft.md "Before you change code"（S2/S4/S5/S6/S7/S8，+28–32 行）、"When the delivery is a rework"（S11，+8）、分支卫生（S14，+2）、SKILL 停止条件加不可测锚点（S3，+1）；controller：`delivery-and-review.md` Step 11 的缺陷 vs 错配判断、输入路由、"不写产品代码"、决定理由清单、刹车说明（S12/S53/S54/S64/S51，+18–22）与第 35 行的 "redesign" 改词，Step 6 的测试步骤写法、独占环境、thin implementation、遗留物授权（S22/S40/S41/S33/S44/S43，+12–14），Step 12 完成前重读非目标（S52，+2）；design：`requirement-package.md` 的澄清、选项、失败路径、环境规格、更正包（S30/S31/S32/S35，+18–20）与 SKILL 的 Correction 触发（S38，+2）；helper agent 边界（S56，target SKILL +2、Step 10 +2）；`commands/next.md` 的先想后做（S48，+2）；两份 README 的"它会碰你机器上的什么"（S72，+10–12 ×2；本仓库 `src/` 无网络 API，已核）；craft.md `:35-36` 改词 | S 组 | 2 | 预算：controller SKILL 已满 200 行，S64 的两行要先腾（Step 1 或 Step 13 各压一行） |
| 5 布局声明清理 | 资源目录只声明真实目录（`identity/window-locators`，由一个导出常量供 store 与助手共用），去掉 keep-live / activity-monitor / temp/prompts / `operations/window-locators` 的声明与画像标志；reconcile 对现存工作区的旧空目录只报告不删 | T12/T21/T25 = J5 | 2 | — |
| 6 读侧补齐（1.1.1 之后） | G7/G1 归档读回；G6 完成路径上的证据重哈希；G10 撤回提示；G11 看板两列；D6 失败事实；M4/J1 退出路径 | G7、G1、G6、G10、G11、D6、M4 | 2 | R4–R8 |

建议顺序：0 → 2 → 3 → 1 → 4 → 5；批 2 与 3 是纯守卫，先做能让后面的现场核对站在更稳的地上；批 1 需要 R1 的裁决且要一次现场核对（新工作区首次引导 + 一次投递，看窗口列表里的状态变化）；批 4 只改文本但走完整门（agent-text 归完整门）。六批加起来约三到四个中等批次，预计两到三天。

## 9. 需要裁决的事项

| 事项 | 为什么现在要定 | 建议 |
| --- | --- | --- |
| R1 hook 观察器是否可以写一个 tmux 窗口选项 | ADR-0009 调整一把观察脚本定义为"只写记录"；`@wakeflow_state` 是 UI 投影（同状态行资产），不是状态权威，但它是 Wakeflow 进程发出的宿主效果 | 同意，以 ADR-0009 的补充条款记录（或 ADR-0023）：只在已绑定会话、只写自己命名空间的选项、失败静默、不影响记录写入。备选：助手 `glyphs` 子命令由 Controller 在 status/deliver/回调后刷新——不改 ADR，但只在 Controller 动作时更新 |
| R2 fresh id 的种子是否加入工作区根 realpath | 现在 selection 字节相同的两个工作区得到相同的 program/window/pod id，助手按这些标识认 pane（M5）；apply 在同一根重算，不影响确定性；pin 了派生 id 的测试夹具要更新 | 同意；只影响新建工作区 |
| R3 D2 的修法 | 替代"已发许可未送出"的目标会困住窗口声明 2 小时 | 从 `REPLACEABLE_PHASES` 去掉 `delivery-prepared`：先记 `failed-before-send` 再替代；备选是替代时自动释放声明（多一条状态转换） |
| R4 D3/D4：目标间依赖、按包要求证据种类 | 旧版有、新版无裁决记录；多仓库顺序现在靠 Controller 手工 | 1.1.1 不做；记为 1.2 候选（任务包两个可选字段加各一条阻塞项） |
| R5 D5：评审前更正报告 | 报告里写错 commit/摘要只能走 rework（计入刹车） | 1.1.1 不做；候选设计：`result-reported` 阶段允许一次 `supersedes` 导入，或 rework 不计数的"更正"标志 |
| R6 keep-live 与 unattended | 两者都有裁决放弃；现场需要的是"机器别睡"与"少几次人工往返"（H8/Q10） | 维持放弃；keep-live 只留一句文本（批 1d）；连续 `/next` 在 1.1.1 之后按 H8 另议 |
| R7 M4 翻转 `instructionManagement` 与退出路径 | 与 J1/J2/Q9 同一件事 | 并入 Q9 的裁决，不进 1.1.1 |
| R8 归档读回的形状（G7/G1） | 改 `wakeflow_status{demandId}.archive` 的结果 schema | 1.1.1 之后；先定读回字段再做 |
| R9 1.1.1 的范围 | 六批是否都进 1.1.1 | 建议 0–5 进 1.1.1，6 进 1.1.2；批 1 做完需要一次新工作区的现场核对 |

**裁决（2026-10-20，用户：按建议）**：R1 采纳选项 A，记为 [ADR-0023](../decisions/0023-hook-driven-window-activity-marks.md)；R2 采纳（种子加工作区根 realpath，只影响新建工作区，pin 了派生 id 的夹具随批 3 更新）；R3 采纳去掉 `delivery-prepared`；R4、R5 推到 1.2；R6 维持放弃，keep-live 只留一句文本，连续 `/next` 在 1.1.1 之后按 H8 另议；R7 并入 Q9；R8 放到 1.1.2、先定字段；R9 批 0–5 进 1.1.1，批 6 进 1.1.2。

## 10. 跟踪

| 批 | 状态 | gate-log | 登记 |
| --- | --- | --- | --- |
| 0 | 已执行（d5141058、68b1f1dd） | §13.195 | P1–P7 |
| 1 | 已执行（§13.198；现场 L11 待做） | §13.198 | T24、M2、T3、T25 |
| 2 | 已执行（§13.196） | §13.196 | T11、T10、T31、M5 |
| 3 | 已执行（§13.197） | §13.197 | D1、D2、D8、D27、D7、G3、G2、G12、G4、M5（R2） |
| 4 | 已执行（§13.198） | §13.198 | S 组 |
| 5 | 已执行（§13.198；旧空目录不报告） | §13.198 | J5 |
| 6 | 1.1.2 | — | G7、G1、G6、G10、G11、D6、M4 |

## 11. 后续版本计划

| 版本 | 内容 | 前提与验收 |
| --- | --- | --- |
| 1.1.1 | 第 8 节批 0–5：bump 与登记；助手守卫（超时、locale、statusLine 归属）；投递与 Demand 守卫（D1/D2/D8/D27/D7、G2/G3/G4/G12）与 R2 的 id 种子；可观察性（ADR-0023 的活动标记、支撑面状态行、retitle、保持唤醒一句）；技能与文本补深；布局声明清理 J5 | 每批按 `impact report` 的级别过门；最后一轮现场核对 L11：新建工作区首次引导 + 一次投递，看窗口列表里的标记与 Design/Test 的状态行；然后 tag `v1.1.1`、`release:check`、缓存刷新（各需授权） |
| 1.1.2 | 批 6 读侧补齐：G7/G1 归档读回（先定 `wakeflow_status{demandId}.archive` 的字段：标题、目标、已接受目标的分支/提交/摘要、证据数、verify 失败数）、G6 完成路径上的证据重哈希、G10 撤回包的再认领提示、G11 看板索引的测试模式与 parked 触发列、D6 失败发送的宿主错误事实；M4 翻转 `instructionManagement` 与退出路径随 Q9 一起 | R8 的字段裁决；一轮现场：归档一个 Demand 后读回、撤回后再认领 |
| 1.2 | R4：任务包可选 `dependsOn` 与 `requiredEvidenceKinds` 各一条阻塞项（D3/D4）；R5：评审前更正（`result-reported` 阶段一次 `supersedes` 导入，或不计刹车的更正标志，D5）；H8/Q10：在两个确认点之间连续推进的 `/next`；K4 按角色的工具子集（Codex）；C6/C11 升级语义 | 1.1.x 现场稳定；每项先写能力卡补充或 ADR |

规则不变：每个版本先 bump 再改 `plugins/` 字节（ADR-0021 规则 2），一个版本一轮新工作区的现场核对，tag 打在最后一个制品提交上，`release:check` 在 tag 之后真跑。
