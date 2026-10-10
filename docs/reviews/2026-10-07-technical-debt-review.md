# Wakeflow 技术债务深挖与处置方案

> 状态：`in-progress`（批次 0 已执行并提交，见 gate-log §13.165；批次 1 已执行，见 §13.166；批次 2 起与第 9 节的裁决项待用户确认）
> 基线提交：`71755086`（main，领先本地 origin/main 3 个提交）
> 建立日期：2026-10-07
> 上位文档：[开发文档系统](../README.md)、[问题登记](../references/open-items.md)、[开发工具规划](./2026-10-03-development-and-operations-tooling-plan.md)
> 范围：只读审计，没有改代码、没有跑门；本页的数字来自六路并行审读（登记 A–D、E–I、J–O 与裁决项各一路；代码级、测试与验证、文档/过程/制品各一路），关键结论由主会话抽查复核。grep 得到的计数是近似值，AST 与严格 lint 得到的计数是精确值。

## 1. 总体判断

债务不少，但不散：它集中在五个簇里，而且大部分在登记里已经有名字，缺的是"按当前代码核实状态"和"排成能执行的顺序"。本页把 134 项登记逐条对照今天的代码重判，把已经关闭但登记仍写"开放"或状态过期的条目找出来，再把真正开放的债按风险乘以范围排序。

五个簇：

| 簇 | 一句话 | 规模 |
| --- | --- | --- |
| A 质量门的盲区 | 78% 的运行时代码不受 Biome 规则、格式与 knip 检查；一条架构规则从不生效；错误体系停在迁移中途 | 105,031 行豁免；233 个被隐藏的复杂度错误；189 个旧错误类；2,144 行无调用者的恢复模块 |
| B 运行时正确性残留 | 已修的多，剩下的是"看不见的状态"：宿主窗口被阻塞、文本变更把旧工作区锁死、新用户环境不对时无提示 | A7、C5、A5/A6、B13、B7、B8 等约 25 条 |
| C 安全与诊断边界 | 没有威胁模型 ADR；产品窗口能改写 Controller 的助手；失败只剩两个固定词，没有事故记录 | F1/F2/F4/F5/F7，G1–G10 |
| D 测试与验证 | 15 个文件占门时 66%；二十场景是一条会级联跳过的链；14 份 git 夹具抄本；43 个模块没有直接测试 | 3,396 秒测量总时长；3,913 行场景文件 |
| E 文档、过程与制品 | 开发日志成了裁决库；登记的代码引用 62% 已漂移；技能预算量在源文件而不是发货字节；tools/list 比目标大 54% | 4,531 行日志；291 条引用；92.7 KB |

两点先说清楚：第一，登记里标"开放"的 88 条中至少 36 条已经在 §13.133–§13.164 关闭，本页第 7 节给出更正清单；第二，最贵的三项（错误体系收敛、Biome 豁免解除、能力切片吸收旧域）是同一件事的三个面，必须按目录分期做，不能一次拉起。

## 2. 量化基线

| 指标 | 现值 | 来源 |
| --- | --- | --- |
| 手写运行时 `src/` | 135,159 行；foundation 65 文件 22,288 行、kernel 23/7,628、capabilities 38/20,132、governance 103/44,859、configuration 10/3,523、workspace 76/28,188、hosts 28/6,225、entrypoints 13/1,912 | wc |
| JSON Schema / 生成类型 | 95 / 95，24,811 / 22,827 行 | wc |
| 测试 | 294 个测试文件、26 个夹具、86,763 行；测量总时长 3,396 秒（2 worker 理想墙钟约 28 分钟） | test-durations.json |
| `extends Error` | src 194（其中 kernel 1 个 `WakeflowError`），tooling 12 | grep |
| `instanceof XError` / `.reason ===` / `map*Error` | 1,832 / 1,360 / 127 | grep |
| Biome 豁免 | `src/{configuration,workspace,governance,foundation,hosts}` 及对应测试目录：格式器关闭，复杂度、隐式 any、非空断言、控制字符、import type 五条规则关闭 | biome.json 末条 override |
| 豁免目录按严格配置重测 | 233 个复杂度错误（workspace 83、governance 81、foundation 53）、168 个隐式 any let、265/282 文件格式漂移 | 临时严格配置 |
| knip 忽略目录按完整配置重测 | 0 个未使用文件；128 个未使用导出 + 19 个未使用类型（workspace 45、governance 42、foundation 12） | 临时配置 |
| 超过 150 行的函数 | 27 个，最长 593、531、474、392 行 | swc AST |
| 最大文件 | demand-aggregate-state.ts 3,141 行；delivery/service.ts 2,131；result-review/service.ts 2,035；decider 1,841；tmux 助手 1,735（其中 1,630 行是一个未类型化的字符串） | wc |
| 能力层对旧域（configuration/workspace/governance）的导入 | 24 个文件 215 条，命中 100 个旧域模块 | dependency-cruiser |
| tools/list | 92,691 B（§13.140 测量）；ADR-0004 目标 60 KB；测试阈值 128 KiB | 登记 K3 |
| 技能预算 | Controller SKILL.md 源 200/200 行；发货的 Claude 版 16,347 B（12 KiB 上限的 133%）、Codex 版 12,761 B | agent-text-honesty.test.ts |
| 开发日志 | 4,531 行、164 节；`##`/`###` 混用；21 节含未入 ADR 的裁决 | gate-log |
| 登记引用 | 291 条 `file:line`：231 条精确命中，57 条只有文件名，23 条文件名歧义，181 条（62%）指向登记后改过的文件 | open-items.md |
| 图谱 | 77 份指纹 72 份过期；plans/ 22 MB 原始证据（413,833 行 JSON）入库 | check-atlas.mjs |
| 最近 30 天提交 | 76 个；运行时里改动最频繁的是 Claude 文本画像（15 次）、tmux 助手与 result-review 服务（各 14 次） | git log |

## 3. 簇 A：质量门的盲区

### 3.1 Biome 豁免覆盖 78% 的运行时

`biome.json` 最后一条 override 对五个旧域目录关闭了格式器和五条规则。按严格配置重测，这些目录里有 233 个复杂度超限（`wakeflow-static-materialization-step-executor.ts` 10 处、`-preview.ts` 7 处、`demand-aggregate-state.ts` 7 处）、168 个隐式 any `let`、11 处非空断言，265 个文件的格式与仓库其余部分不同。评论级的豁免反而很克制：28 条 `biome-ignore`（13 条是 Given/When/Then 的 `then` 字段，10 条是 shell 模板里的 `${}`），12 条 `@ts-expect-error` 全在品牌类型的反向测试里，`as never` 只出现在测试。

为什么重要：仓库对外宣称的门（lint、format、knip、复杂度）实际只覆盖 kernel、capabilities、entrypoints 与 tooling；最大、改动最频繁的状态机文件恰好都在豁免区。

方案：按目录分期解除，每个目录两步——先提交一次只有格式的 no-op（便于 review），再开规则；复杂度超限的函数先登记到按文件的允许清单（带 owner），随簇 A.5 的拆分逐个撤销。顺序 foundation（53 处，集中在 filesystem）→ hosts（11）→ configuration（5）→ workspace（83）→ governance（81）。隐式 any `let` 与 `useImportType` 是机械修改，可以与格式一起落。规模：机械部分 M，含重构 L。

### 3.2 一条从不生效的架构规则

`.dependency-cruiser.cjs` 的 `layer-domain-effects-use-foundation` 想禁止宿主中立层直接 `import "node:fs"`，但 `to.path` 写的是 `^node:fs…`，而 dependency-cruiser 把 `node:fs/promises` 解析成 `fs/promises`，且 `includeOnly: ["^(?:src|tests|tooling)/"]` 把核心模块整个排除在图外，所以规则永远不会触发。今天有 6 处直接导入越过了它的本意：`kernel/pod-worktree-receipts.ts`、`kernel/active-projection.ts`、`kernel/command-shell.ts`（`node:os`）、`capabilities/demand/archive.ts`、`capabilities/endpoint/service.ts`、`governance/observation/repository-pointer-observation.ts`。

方案：规则改为 `^(?:node:)?(?:fs(?:/promises)?|child_process|os)$` 并把核心模块纳入图（S）；6 处调用改走 foundation 的文件系统端口（M）。更正（2026-10-09 批次 0 核实）：同一文件里 `transitional-workspace-governance-composition-*` 的两条规则仍然有效——静态资源矩阵、预览与步骤执行器三个源文件仍从 governance 的 ledger/demand 目录导入 7 处，规则守的正是这些接缝；审计所称“源文件不再导入”不成立，不删除。

### 3.3 错误体系停在中途

ADR-0013 D 规定全运行时一种错误类型。现状：kernel、capabilities、entrypoints 共 627 个 `fail` 调用走 `WakeflowError`；foundation、governance、workspace、configuration、hosts 共 4,573 个 `fail` 调用走 176 个本地 `fail`，对应 189 个旧错误类；22 个 governance/workspace 文件已经混用内核错误。消费侧为此付出 1,832 个 `instanceof` 守卫、1,360 个 `.reason ===` 比较和 127 个 `map*Error` 垫片，其中 `mapContextError/mapHandlerError/mapRepositoryError/mapRecordError` 四件套在 delivery、result-review、tasking 三个服务里几乎逐字相同；`mapLockError` 有 6 份、4 套词汇。边界上，`wakeflow-public-mcp-tool.ts` 的 `legacyErrorDetails` 会把任何带 `{code, reason}` 的逃逸错误原样放进公开信封，而不是闭合码表。

方案：分两层。先做边界（M）：一个内核翻译器，把旧类按表映射成闭合码，锁错误只映射一次；`legacyErrorDetails` 退役，未映射的一律 `wakeflow-unexpected` 并带事故 id（见簇 C）。再按目录收敛（L）：从 governance/demand 与 workspace/maintenance 这两个最大的守卫消费者开始，每个模块把本地 `fail` 换成内核 `fail` + 闭合码并删掉类；完成一个目录就把它从 Biome/knip 豁免里拿出来，与 3.1 同步推进。

### 3.4 无调用者的代码

`tooling/architecture/check-dependencies.ts` 的 `ADMITTED_PRODUCTION_ROOTS` 允许 16 个没有生产导入者的模块，其中 8 个既不是入口也不是宿主画像：`managed-evidence-reading-service`（457 行）、`wakeflow-prepared-maintenance-recovery`（403）、`loaded-artifact-tree-transfer-publication`（380）、`wakeflow-maintenance-orphan-gate-recovery`（223）、`wakeflow-config-authority-replacement-recovery`（222）、两个 recomposition recovery（196、192）、`wakeflow-support-memory-recovery`（71），合计 2,144 行，只有测试在调用。另有 128 个未使用导出和 19 个未使用类型（最大簇：`wakeflow-active-static-resource-catalog.ts` 7 个、`task-package.ts` 的两个解析器、五个 `*-body-authority.ts` 的 owner 常量、三个从未被抛出的错误类）。

方案：每个恢复模块二选一——接进 `wakeflow_maintain_workspace recover` 并配一个中断场景，或连同测试删除；未使用导出直接删；然后把 `knip.json` 的 `ignore` 收缩到 `.build` 与生成目录，让门守住它（M）。这一项需要 Q12 的裁决（见第 8 节）。

### 3.5 单体文件与跨层导入

五个最大的文件也是 `fail` 最密、隐藏复杂度最多的文件：`demand-aggregate-state.ts` 117 处 `fail`，`parseTargetTasks` 384 行；`demand-event-sourcing-repository.ts` 的 `auditTargetResultHistoryOfCommits` 593 行；decider 的 `parseDemandEventSourcingCommand` 531 行；`previewWakeflowStaticMaterialization` 474 行。能力层对旧域的 215 条导入让任何 `transitional-*` 规则都无法退役；最热的目标是 `workspace-host-resource-profile`、`demand-operation-authority-context`、`active-projection-refresh`、`wakeflow-config` 与 `wakeflow-config-authority-snapshot`。

方案：按 ADR-0013 的切片顺序吸收（result-review、demand、delivery 三个切片就占 118 条）；把 configuration→workspace 与 governance→workspace 的两条合同接缝（资源声明、窗口绑定身份、宿主资源画像）上移到 `src/contracts/`（M）；decider 与 repository 按命令族/事件族拆分，解析器按记录类型拆成模块，事件登记表放进 contracts（L）。登记 L1（阶段转移表写在四处）、L4（切片样板复制）、L5（单体）、L6（能力层含 53 处 tmux 字面量）属于同一条线。

## 4. 簇 B：运行时正确性残留

登记 A–D 共 50 条中，本次核实已关闭 24 条（见第 7 节）；真正开放且有风险的是下面这些，按风险排序。

| 条目 | 现状（已核实） | 风险 | 方案 | 规模 |
| --- | --- | --- | --- | --- |
| A7 宿主阻塞状态不可见 | hook 只订阅 SessionStart/UserPromptSubmit/Stop/SessionEnd；没有 Notification/attention 观察 | 登录过期、用量上限、等待权限的窗口被当作已落地，Demand 等一个不会来的回传，用户不知道哪个窗口需要他 | Claude hook 片段订阅 `Notification`，观察器只记事件类型；status 的窗口视图加 `attention`；Controller 技能转述"窗口 X 需要你" | M |
| C5 托管文本准入没有历史 | 四个生产者只传当前渲染作为 `currentTargets`；rc 构建已经改过托管文本 | 下一次改 CLAUDE.md/AGENTS.md 块、.gitignore 块或支持面记忆的发布，会让每个已有工作区的 reconcile 与 local-layout 门以 `unknown-managed-body` 阻塞，出口是手删技能承诺不会覆盖的块 | 按组件的历史正文摘要表作为额外 `currentTargets`；黄金测试钉住当前摘要，改文本就必须登记旧摘要；CLAUDE.md 加规则 | M |
| A6 + A5 新用户运行时姿态 | 启动器没有 Node 版本守卫（`Error.isError` 需要 Node 24）；pane 进程检查只认 comm 为 `claude`；preflight 不比对 node 路径与引擎范围 | Node 22 在错误分类深处失败、hook 静默失败；npm 包装过的 `claude` 每次投递都是 `wrong-process` | 构建器在两个启动器顶部生成版本守卫；preflight 报告 node 路径与范围比对；进程检查接受 `ps args` 指向 Claude CLI 入口的 node 进程；README 列支持的安装形式 | S–M |
| B13 单个畸形暂存文件杀死 hook 通道 | 写前恢复扫整个目录，任一保留前缀条目形状不对就 `stage-recovery-required` | 一个坏文件让该宿主所有 hook 写入失败，落地证据全失，没有公共恢复路径 | 写前路径只对目标摘要集合之外的保留前缀条目计数报告，不失败；reconcile 列为可退役项，verify 点名 | S–M |
| B7 PID 复用 | 锁 v2 有出生证据；暂存地址与追加候选的所有者判断仍只有 kill(0) | 重启后 PID 落到活进程上，残留被判 active，恢复路径全部拒绝 | 两处所有者读取改用 `observeProcessInstance`，出生晚于文件 birthtime 的进程视为 inactive | M |
| B8 代码变更后中断的维护无法恢复 | 重派生计划摘要不符即 `plan-stale`，状态停在 recovery-required，没有出口 | 升级后遗留的维护事务永久阻塞 | 类型化的 `recovery-requires-original-artifact`（owner user）加 planDigest 守卫的放弃动作；用另一构建写的意图做回归 | M |
| B10 释放失败掩盖成功 | `withRootedExclusiveFileLock` 在 finally 释放，无 catch | 已提交的变更被报成失败，调用方盲目重试 | 释放异常降级为回执里的 `lock-residue` 警告，操作结果照常返回 | S |
| A8 worktree cwd 与准备好的检出不比对 | 登记已按 realpath 与公共目录核验，但助手 `launch` 不比较 hook 记录的 cwd 与准备路径 | 产品窗口在错误的检出上工作，基线悄悄漂移 | `launch` 在有 hook 记录时比较 realpath，不符拒绝 `worktree-cwd-mismatch` | S |
| C6/C11/C17/C18 升级与身份 | 进程只读自己根下的 manifest，兄弟版本目录不会得出 `server-outdated`；事件流不记写入者构建；`runtime-artifact-outdated` 的 owner 写死为 user；relocate 保留旧 launchIntentDigest | 版本升级后旧进程不知道自己过期；混合构建写同一流无法事后识别 | 宿主适配器只读安装目标清单比对；commit 带可选 `writerArtifactDigest`；owner 来自宿主画像；relocate 以 CAS 重写摘要 | M |
| G7 stat 失败被当作检出缺失 | `catch { return false }` 两处，pod close 据此继续 | EACCES/TCC 让活的 worktree 看起来不存在，关闭 pod 时把它孤立 | 三态 present/absent/unknown；close 预览对 unknown 阻塞 | S–M |
| E2 Codex 落地证明是 Agent 自述 | `host-send-return` 只要求 status=sent 与一个无定义的 digest；status 不显示落地依据 | 投递"落地"没有任何宿主侧证据，也看不出来 | Schema 与文本定义摘要为发送返回值的规范 JSON sha256；status/评审投影显示 `evidenceKind`；文本标明这是自述 | M |
| H3/H6/H5/H2/H10 Demand 死角 | escalate 选项文本指向不存在的"补充包认领"出口（第二个 Demand 被 `pod-busy` 拒绝）；indeterminate 投递的 `resolution` 出口代码有、文本无；research 流程无 Controller 步骤；supplement 无父链接、续接不写回归档 | 用户照文本操作走进死路，Demand 卡在 awaiting-decision 或持有的工作声明 | 先改文本（H3、H6 各 S），再补 research 小节与场景（S+M），最后做 supplement 的父链接与归档写回（M） | S–M |
| J2/J3/J4/J5 占用与退出 | managed-block 无缺省且不可逆；pod 关闭不提分支/exclude 行/空目录；设置规则无所有权记录；声明的宿主布局与真实存储不一致（`operations/window-locators` vs `identity/window-locators`，`keep-live`、`turn-complete` 等死声明） | 团队文件被写入工作区绑定文本；升级者保留宽泛规则；目录目录与代码各说各话 | J3 文本 S；J5 布局常量单一来源 M；J2 缺省 owner-managed 与可逆切换 M；J1/J4 的 detach 需要 Q9 | S–L |
| K2/K5/K6/K7/K8 运行成本 | 16 pane 上限且 `truncated` 丢失；inspect 没有摘要模式；deliver 从 stdin 吃整段 prompt；24 MiB 结果上限是过渡值；维护预览重复列步骤 | 长寿 Controller 的上下文被逐字观察和重复包体吃掉 | K7 S；K2 观察按目标窗口过滤 M；K5 `detail: summary` M；K6 `deliver --delivery <id>` M | S–M |
| I1/I2/I3/I9/I11 引导 | 空闲工作区不指向 Design 窗口；缺 tmux 无安装指引；target 与 test 技能对证据记录互相矛盾；过期技能文本无重载提示；没有"换掉消失窗口"的完整示例 | 被引导的用户在关键时刻拿不到下一步 | 全部 S 文本改动 | S |

## 5. 簇 C：安全边界与诊断性

安全：没有威胁模型 ADR（F7，Q5 未裁决）；每个非根放置的窗口都拿到 `--add-dir <工作区根>` 且缺省 `auto` 模式，助手就在工作区里，运行时不自检摘要（F1）；没有调用者身份，Design/Test 根也拿到通配 MCP 允许规则，§13.140 已从产品 cwd 复现 accept+complete（F2）；旧 scope 块与宽泛 Bash 规则从不检测（F4）；hook 记录无认证（F5）。已关闭：F3（回传标为不可信数据）、F6（凭证规则，残留 JWT）、F8（ANSI）、F10（按设计）。

诊断：没有事故记录与 id（G1），errno 从不暴露（G3），技能没有"不透明失败怎么办"的规则（G4），128 个拒绝原因在文本里零命中（G5），助手丢掉 tmux/git 的 stderr（G6），观察器失败不落盘（G8），没有"绝不 unexpected"的损坏输入矩阵（G9），MCP 启动器没有进程守卫（G10），评审拒绝丢掉内层路径（G13）。

方案（不等 Q5 就能做的部分）：G3 + G4 + G6 + G10 各 S，G1 事故记录 M，G8 S–M，G9 矩阵 M，G13 S；F1 的助手自检摘要（M，不改权限面）；F2 第一步按角色收窄允许规则（S）；F4 只读的遗留残留观察进 status/verify（M）；F6 补 JWT（S）。需要 Q5 的：`--add-dir` 收窄、角色令牌、hook 记录链式摘要、工具子集（K4）。F7 的 ADR 本身是 S，而且是 F1/F2/F5 的前提，应该先写。

## 6. 簇 D 与簇 E：测试、验证、文档、制品

### 6.1 测试与验证

- 二十场景是一个 `test()`，3,913 行，一个工作区顺序推进，35 处"必须先跑 X"，首个失败后其余全部 not-run（D8），只有 Codex 组合（D2），夹具把仓库放在工作区旁边而真实布局是嵌套（D3），评审分支（rework、product-defect、blocked→resume、rejected-before-send、bug、research）没有端到端（D4）。方案：阶段构建器把新工作区快进到各前置条件，一场景一个 `test()`，按宿主参数化，加嵌套仓库变体（L）。
- 37 个文件自己起 git，14 份 git 助手抄本，只有 2 个文件隔离了全局/系统 git 配置（D10）；`write(root, relative, text)` 抄了 6 份、假 CLI 写了 6 份、148 个文件各自 mkdtemp。方案：`tests/support/{temp-root,git-fixture,write-tree,fake-cli}.ts` 并迁移（M）。
- 15 个文件占测量时长 66%，`tests/tooling/lab/workflow.test.ts` 一个就 655 秒；耗时表落后 HEAD 7 个提交，15 个新文件未测量，其中 `flaky.test.ts` 两个 60 秒用例与 `mcp/call.test.ts` 真实起制品并不便宜。方案：lab 的宿主×场景矩阵拆文件、240 秒用例只进 gate 档；每次绿门后 `wf timings apply`；`wf handoff` 加"耗时表覆盖当前清单"检查（S–M）。
- 86 个显式 `timeout` 分布在 38 个文件，13 个文件有真实 sleep，0 个用 `mock.timers`，负载敏感的用例没有标签（§13.153、§13.161 的偶发超时都来自它们）。方案：latch/lock 等待注入时钟，给负载敏感用例打标签并写明推荐并发（M）。
- 43 个模块没有直接测试也没有被任何测试导入（governance 20 个共 4,642 行：ledger 的发布存储/读取器/发布者/恢复、事件溯源发布存储/暂存、证据负载物化器），7,000 行的事件溯源核心没有镜像测试，只经 46 个模块间接到达。方案：先给 ledger 与发布存储补镜像测试，再给 decider/aggregate 补 reducer 级测试（M–L）。
- 验证分裂：smoke 只在 CI 的 artifact 档跑，handoff/图谱/release:check 只在本地，两边都不跑 Windows；唯一的模型测试固定种子 200 次、反例不进事件记录。方案：`wf verify artifact` 并入 handoff，CI 加 handoff 与图谱检查，决定是否加 Windows 作业；CI 轮换种子并记入回执，反例持久化（M）。

### 6.2 文档与过程

- 开发日志 4,531 行、164 节，`###`/`##` 混用（13.100–13.141 是 `##`），§13.99 一节 1,105 行；101 行含"裁决"，21 节的裁决没有 ADR（auto 权限模式、用户为被引导方、配置词汇删除、D7 接受规则、中断规则等）；docs/README 的 gate-log 单元格变成了第二份进度日志。方案：标题归一；给未入 ADR 的裁决补 ADR 并扩展 decisions/README §4；docs/README 只留"最新节点 §13.N + 日期"；本页第 9 节的 `wf handoff` 检查防止"待填/未提交"过期（M）。
- 登记引用：291 条 `file:line` 里 62% 指向登记后改过的文件，23 条文件名歧义，2 条文件已不存在；file-review-ledger.md 19,049 行、一次提交、仍标 active。方案：引用改为 `path#symbol` 或错误码，`wf handoff` 加解析检查；每条登记记关闭提交；台账归档为 superseded（M）。
- AGENTS.md 与 CLAUDE.md 有 100 行字节相同、其余已漂移，三处说"六个占位符"（实际九个）；decisions/README 的表被一个空行切成两张；plan §14 仍说 tools/list 目标已满足。全部 S。
- 技能预算量在源文件：Controller SKILL.md 源 200/200 行，发货的 Claude 版 16,347 B 已超 12 KiB 上限 33%、Codex 版超 4%；`{{windowBootstrap}}`/`{{windowLaunch}}` 整段内联在 SKILL.md。方案：诚实性测试改量渲染后的每宿主字节；bootstrap/launch 正文移进参考文件；压短 `windowResume`/`windowLaunch`（M）。
- 跨宿主文本泄漏：共享源里 15 行点名 Claude Code/tmux 或 Codex，结果 10 行 Claude/tmux 文本发进 Codex 制品、3 行 Codex 文本发进 Claude 制品；路线图阶段 6 的"Codex 产物无 Claude 词汇"门没有实现。方案：这 15 行改成占位符或宿主条件块，加渲染后制品的词汇断言（S–M）。
- tools/list 92,691 B 对 60 KB 目标（154%），测试阈值 128 KiB 且注释停在"L1 后复测"（Q12）；图谱 72/77 指纹过期，22 MB 原始 JSON 证据入库，每批都写"未刷新"。方案见第 8 节的 Q12 与图谱策略。

### 6.3 发布与版本

五个版本源一致为 1.1.0-rc.5，但最高 tag 是 v0.9.4，没有任何 v1.x tag；`release:check` 从未带 Git 标志通过过，也不在 CI 里；main 上已经有两套不同字节用同一个 rc.5；没有"制品字节变了就必须改版本"的门（C1）；vendored 闭包丢了 jsonc-parser 的 LICENSE.md 并带进了 `.github`（C14），依赖字节没有按锁文件完整性核验（C15）；marketplace 的 `metadata.version` 1.0.0 是第六个版本字符串却不在规则内（C13）；没有用户的"更新"章节（C9）。Q1（Codex 定位）、Q2（渠道与版本模型）、Q11（平台范围）都还没有裁决，而 rc.N 已经是事实做法。

方案：Q2 以 ADR 裁决；在 rc 提交上打 tag 并完整跑一次 `release:check`；CI 加 tag 触发的作业；`wf verify artifact`/handoff 加字节对版本的检查；修 C13/C14，C15 在构建器里按锁文件核验（M 合计）。

### 6.4 宿主不对称

Claude 宿主层 18 文件 5,595 行（助手、状态行、四份可移植设置）；Codex 8 文件 578 行。Claude 独有：tmux 助手的 launch/resume/in-place/deliver 回读与落地证明、重定位、状态行、缓存刷新、`windows-stale` 信号；Codex 侧投递是一句 138 字符的"用线程工具发一次"，落地靠 Agent 自述（E2），过期检测实际只有 Claude 有（B14）。这不全是债——Codex 没有这些宿主面——但 E2 与 B14 两处是功能差距，Codex 的"实验性/范围"标注（E1/Q1）与 hook 载荷夹具缺失是文档与测试差距。

## 7. 登记状态更正

核实为已关闭但登记仍写"开放/部分"的条目（更正登记时逐条引用关闭所在的 §13 节）：A1、A2、A4、A9、A10、B1（残留：`appendCandidateCount` 恒为 0 使 verify 的 `candidates:N` 分支不可达，S）、B2、B4、B5、B6、B12、C4、C8（文本）、C10、C12、C16、E5、F3、F6（残留 JWT）、F8、F10、G11（大部分）、G12、H1、H4、H9、I6、I7、I8、I10、N1–N3、O1–O5、M1（作为登记本身）。

需要改写而不是关闭的：C1、C2、C7（围绕 rc.5 与 ADR-0018 重写）、C12 文本（CI 已存在但缺 tag 门）、D9 文本（耗时表已不是 2026-09-18 的版本）、J3 与 M4（部分修复）。

事实上已定但未记录的裁决：Q2（rc.N 已在用）、Q7（continue_demand 的三种 kind）、Q10（pod 全仓库、`/next` 单步）。

## 8. 处置批次

每批的完成条件都是：完整门绿、`wf handoff` 绿、gate-log 一节、登记更新；影响制品的批次重建并 smoke。批次之间有依赖的用箭头标出。

| 批次 | 内容 | 规模 | 前提 |
| --- | --- | --- | --- |
| 0 卫生（已执行，§13.165） | 第 7 节的登记更正；AGENTS/README 占位符数、decisions 表、plan §14、D9 文本；gate-log 标题归一；`.gitattributes` 标记 `plugins/**` 为生成；`wf handoff` 新增"待填/未提交"过期检查、耗时表覆盖检查、CLAUDE/AGENTS 逐节一致检查；K7、K1、I3、J3、H3、H6、I9、I11 文本；F6 JWT；G3、G4、G6；C13、C14。架构允许项经核实仍有效，未删 | S | 无 |
| 1 架构规则与边界（已执行，§13.166） | 3.2 的规则修正与 6 处导入改端口；错误边界翻译器与 `legacyErrorDetails` 退役；G1 事故记录 + G10 进程守卫 + G8 观察器失败落盘；`tests/support` 四个共享夹具并迁移 git 调用方（运行器统一注入隔离 git 环境） | M | 无 |
| 2 新用户与现场可见性 | A6/A5 运行时守卫；A7 Notification 观察；B13 hook 目录暂存分类；B10；A8；G7 三态；C5 托管文本历史（发布前必须） | M | 无 |
| 3 安全最小集 | F7 威胁模型 ADR（先写）；F1 助手自检摘要；F2 按角色收窄允许规则；F4 遗留残留观察；E2 Codex 摘要定义与 status 投影 | M | F7 先于其余 |
| 4 发布基线 | Q2 ADR；tag + `release:check` 真跑一次；CI tag 作业与字节→版本门；C15 锁文件核验；C9 更新章节；C6/C11 升级身份 | M | Q1/Q2/Q11 裁决 |
| 5 测试体系 | 场景链拆分与宿主参数化；lab 矩阵拆文件；负载敏感标签与时钟注入；governance 镜像测试；模型测试反例持久化与 CI 种子轮换；CI 加 handoff/图谱 | M–L | 批 1 的共享夹具 |
| 6 质量门解除 | 按目录解除 Biome 豁免（foundation→hosts→configuration→workspace→governance）；恢复模块接线或删除；knip 收缩到全 src；未使用导出清理 | L（每目录 S–M） | Q12；与批 7 交错 |
| 7 架构收敛 | 错误体系按目录收敛；三个切片吸收旧域导入；合同接缝上移 contracts；decider/aggregate/预览拆分；共享切片上下文；阶段转移表；tmux 助手改真实模块；能力层去 tmux 字面量 | L | 批 6 同步 |
| 8 产品缺口 | J1 detach 与 J2 缺省（Q9）；H2/H10 supplement 血缘；H5 research 流程；K4 角色子集（Q5）；K5 摘要模式；K6 按 id 投递；H7/H8（Q10）；E1 标注；I4 技能瘦身与渲染字节预算 | M–L | 对应裁决 |

建议的开工顺序：0 → 1 → 2 → 3 → 4，然后 5 与 6/7 交错推进，8 按裁决逐条进入。前四批加起来是三到四个中等批次的量，能在不触碰架构的情况下把"新用户第一次用就撞上"与"发布后无法回退"两类风险压下去。

## 9. 需要裁决的事项

| 事项 | 为什么现在要定 | 建议 |
| --- | --- | --- |
| Q2 渠道与版本模型 | rc.N 已经在用但没有规则；没有 tag 门；main 两套字节同一版本 | 接受 rc.N；"plugins/ 字节变了必须 bump"进门；tag 在 rc 提交上打 |
| Q5 威胁模型范围 | F1/F2/F5/K4 都卡在它上面 | 先写 ADR 定义三类对手与可接受残留，再按批 3 做不依赖裁决的控制 |
| Q12 架构目标重定基线还是排期 | tools/list、foundation 文件数、8 个无调用者模块都悬着 | tools/list 按宿主/角色重定预算并把测试阈值收到现值 +10%；foundation 目标按当前目录结构改写；恢复模块逐个裁 |
| Q9 退出路径与 managed-block 缺省 | J1/J2/J4 全部阻塞 | 先改缺省为 owner-managed（可逆），detach 作为批 8 第一项 |
| Q1/Q11 Codex 定位与平台范围 | README 与 marketplace 没有任何范围声明 | 标 preview；平台 macOS/Linux 本地文件系统；Windows 明确未支持 |
| Q10 部分 pod、连续 `/next`、会话轮换 | K1 文本与 pod 复用都等它 | 先写会话轮换指引（不依赖裁决），pod 子集与连续执行后议 |
| Biome 豁免解除的投入 | 233 个隐藏复杂度错误不是一个开关能解决 | 批准"按目录、先格式后规则、允许清单带 owner"的方式 |
| 图谱策略 | 每批都"未刷新"，22 MB 原始证据在库里 | 刷新节奏绑定发布候选而不是批次；原始证据移出 Git 或裁剪旧轮次 |

## 10. 跟踪指标

每个批次结束时更新下面的数字，写进对应 gate-log 节：旧错误类数（189）、Biome 豁免行数占比（78%）、严格配置下的复杂度错误数（233）、未使用导出数（128）、能力层对旧域的导入条数（215）、无调用者模块行数（2,144）、tools/list 字节（92,691）、门测试阶段秒数（1,194）、过期图谱指纹（72/77）、登记引用漂移比例（62%）、发货技能字节对上限的比例（133%）。指标只有在对应批次真的改动时才会动，任何一次"顺手优化"都应该能在这张表上看到。批次 0 只动文档、工具与边界，这些指标按设计不变；它改变的是登记的准确度（36 处状态更正）与交接检查的覆盖面（五项 → 七项）。
