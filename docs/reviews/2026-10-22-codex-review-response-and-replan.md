# Codex 审阅 35 项的核实、根因归类与后续开发修复计划（2026-10-22）

状态：proposed（等用户确认第 5 节）。

## 0. 来源、方法与边界

- 来源：用户用 Codex 对 Wakeflow 做的只读审阅（`unified-review.md`，本机 `~/.codex/visualizations/` 下，不进仓库）。35 项发现：33 项有动态反例、2 项静态文本对照；范围是快照 `98c65c81` 加当时未提交的批 B 字节，批 C 的完整 diff 也已审阅。审阅自己跑的第 2 级门就是 §13.210 采信的 run-3dzJwB（1533/1533，15.5 分钟）。
- 方法：本会话在当前 HEAD（`c304f106`，批 B+C 已提交）上分四组做**只读静态核实**——并发与锁、终态耐久与截断、双宿主与宿主助手、评审流与维护工具；按报告的触发/观察在当前代码里重新追真实路径，没有重跑复现脚本、没有运行构建或测试。
- 结论：**35 项全部成立**。两处保留：H3 在屏幕桩上成立、真实 Claude Code 输入框的多行渲染未验；R-REC-03 的"单条深度"成立、"整树累计容量"只部分成立（单条上限已经等于整树上限，累计未在准入时可见）。报告给的定位行号在当前文件里全部有效（`delivery/service.ts` 只多出批 C 的 `dependsOn` 块，位于声明路径之后）。
- 边界：本文只改文档；不改源码、Schema、制品。所有修法都按 CLAUDE.md 的变更纪律写——最小一致修复，修在拥有该边界的层，不新增状态机、审批层、兼容分支或策略字段。

## 1. 核实总表

"触发"栏按单人开发者本机 8 个窗口、一个工作区只初始化一个宿主的日常用法估计；双宿主只在实验室与测试工作区出现。批次见第 4 节。

| ID | 严重度 | 核实 | 日常触发 | 后果 | 批 |
| --- | --- | --- | --- | --- | --- |
| T4 多行 import 从影响图消失 | P2 | 成立；相对导入边约 39% 不可见 | 高（每次 `quick --changed`） | "0 测试、通过"是假信号 | F |
| T3 artifact 检查不可用时 handoff 仍绿 | P2 | 成立 | 高（另一会话持锁时） | 交接宣称 build:check 已过 | F |
| R3 Codex 文本教用户敲不存在的 slash 命令 | P2 | 成立（两处） | 高（每个 Codex 新工作区） | 用户敲命令无效 | F |
| R4 README 门数 | P3 | 成立（两边都不是十三） | 高（读 README） | 误导 | F |
| T1 构建锁回收删掉新持有者 | P2 | 成立（ts 与 mjs 同） | 低 | 两次构建重叠、门假红 | F |
| T2 owner 写失败留下无主锁 | P2 | 成立 | 低 | 带锁命令停一小时 | F |
| T5 零测试 quick 回执不能导出 | P3 | 成立 | 低 | 只改文档时导出失败 | F |
| S3 第三次 rework 的"接受"选项不可达 | P2 | 成立；技能文本与代码也不一致 | 中（三次 rework 常见） | 选接受却只能再投或取消 | G |
| S5 未报告的测试步骤无法补跑 | P2 | 成立 | 中（首步失败即停） | 预算未用完只剩 escalate | G |
| R2 结局后同键重放违反结果 Schema | P2 | 成立（rearm 同理） | 中（同键重试） | 内部错误代替回执 | G |
| R1 重放与 rearm 漏掉助手资产检查 | P2 | 成立（仅 Claude facade 有守卫） | 低 | rearm 运行非制品字节 | G |
| S6 research 归档后 next 指向被禁的 continue | P3 | 成立 | 低 | 多调一次得确定性阻塞 | G |
| S4 快照暂存残留挡住公开入口 | P2 | 成立 | 中（快照写入瞬间关窗） | 该 Demand 所有入口被拒、无清理 | H |
| R-REC-03 证据深度使 Demand 不能归档/取消 | P2 | 单条成立，累计部分成立 | 中（录入深层构建输出） | 不能完成也不能取消 | H |
| S2 取消理由按 UTF-16 截断 | P2 | 成立 | 低（≥4035 字符且边界 emoji） | 归档已封、日志残留、Demand 卡死 | H |
| R-ROOT-05 摘要按 UTF-16 截断 | P3 | 成立；另有 archive goal、active-projection 两处同类 | 低 | 预览失败；一条旧归档让 status 失败 | H |
| S1 归档后活动根删一半 recover 不可重入 | P2 | 成立（两条失败路径） | 低 | 该 Demand 永远 recover 不了 | H |
| R-REC-04 final 父目录同步失败被改判成功 | P2 | 成立 | 低（fsync 失败） | 事件说已记录，断电后目录项可能丢 | H |
| R-REC-01 租约释放失败覆盖业务结果 | P2 | 成立 | 低 | 成功的调用显示为冲突 | H |
| R-ROOT-01 合法幂等键命中原型属性 | P2 | 成立 | 极低 | 单次失败、换键即可 | H |
| R-ROOT-09 notification 记录不能转证据 | P3 | 成立（两份 Schema 漏枚举） | 中（记"窗口在等人"证据） | preview 报 unexpected | H |
| R-ROOT-03 并发 prepare 误回收在途声明 | P2 | 成立（当前代码同样） | 中（换 key 重试 prepare） | 窗口失去排他、同窗口二次投递 | I |
| H4 旧 SessionEnd 释放恢复会话的新声明 | P2 | 成立 | 中（resume 后 release-claim） | 释放活声明、同窗口二次投递 | I |
| H1 并发登记不复验跨窗口 handle | P2 | 成立 | 低 | inventory 永久不可读、全部入口失败 | I |
| H7 settings 两次读取间变化先写再报 stale | P2 | 成立 | 低 | apply 报 owner、精确恢复死循环 | I |
| R-ROOT-02 旧看板刷新覆盖新投影 | P3 | 成立 | 低 | 索引暂时陈旧、下次自愈 | I |
| R-ROOT-04 Codex 用自身摘要判 Claude 窗口 stale | P2 | 成立 | 低（双宿主） | verify 门误 fail、重启指引错 | D′ |
| H8 跨宿主关 Pod 漏对端绑定 | P2 | 成立 | 低（双宿主） | 孤儿绑定无工具可退 | D′ |
| R-REC-02 AnyHost 回执首个非空即返回 | P2 | 成立（四个消费者） | 低（双宿主） | 证据预览被拒、归档缺分支 | D′ |
| H6 Claude reconcile 被自身设置贡献阻塞 | P2 | 成立（单宿主即触发） | 中（误删 Design/Test 目录） | 维护全阻塞、只能手建目录 | D′ |
| H3 首行空、续行有草稿仍发送/重启 | P2 | 桩上成立，真实渲染待验 | 中（多行草稿） | 投递接在草稿后，或 respawn 杀掉草稿 | J |
| H2 普通 resume 缺 worktree 观察 | P2 | 成立 | 中（pane 没了的 worktree 窗口） | relocate 被拒，只能 close+launch+replace | J |
| H5 mark 加回 worktree 标题前缀 | P3 | 成立（注释与 §13.186 矛盾） | 高（每个 worktree pod 的 mark） | 仅标题 | J |
| R-ROOT-07 gitdir 读不出误标 prunable | P3 | 成立 | 极低 | 报告误导 | J |
| R-ROOT-08 清理建议改路径空白 | P2 | 成立 | 低 | 建议命令指向不存在路径 | J |

## 2. 根因归类

35 项不是 35 个独立缺陷，而是九类重复的设计偏差。每类都在仓库里已有正确的惯用法，修法是把它推广到漏掉的地方，不是发明新机制。

1. **锁外决定，锁内写入的期望只覆盖目标对象**（H1、R-ROOT-03、R-ROOT-02、H7、T1）。登记、prepare、看板刷新、settings 发布、构建锁回收都在锁外读 inventory/聚合/列举/源文件/owner 得出决定，进入排他边界后只对目标对象（同窗口绑定、索引文件、settings 节点、事件流修订、锁目录）做 CAS，决定所依赖的其他输入不在期望里。正确惯用法已在 `replaceRequirementClaimStateFile`（`src/kernel/requirement-board.ts:489-534`）：锁内重读 → 用重读结果重算决定 → 对重读到的 node/digest 做 CAS。原则一句话：**锁外读只用于路由，锁内重读才用于决定。** 同族两条：H4 是事件集合丢了 start/end 先后；T2 是两步声明不原子。
2. **"可见"被当作"已结清"，恢复判据取自正被改动的非权威对象**（S1、S4、R-REC-04、R-REC-01）。S1 用正被删除的活动根判断能否 recover，权威（lifecycle 日志 + 已封归档）只在根完全消失时才用；R-REC-04 把目录项可见当耐久提交并退役 journal；S4 把可重建缓存里的暂存残留当权威树形错误、而回收只挂在写路径；R-REC-01 让释放失败覆盖已提交的业务结局。原则：**每一步的结论来自耐久权威——journal、sealed archive、显式 sync 结果、stage owner 状态。** 现成规则：recover 的 archive 分支、`durability-failure` 结局、B3-2 的 `isDeadWriterStage`、B10 的释放失败旁路报告。
3. **按 UTF-16 码元截断，Schema 按码点、codec 按 well-formed**（S2、R-ROOT-05，另有 `demand-archive-locator.ts:167` 与 `active-projection.ts:543` 两个同类切点；仓库里已有 6 处各自手写的码点版）。一个 `src/foundation/text/` 共享助手一次替换；派生持久字段（取消理由）在 preview/plan 阶段先算先校验，让阻塞出现在终态提交之前。
4. **上限或查找用了错误的坐标系**（R-REC-03、R-ROOT-01）。证据深度上限从树身份上限（63）推导，没换算到 Demand 树坐标（24 − 4）；索引字典带原型、用非 own 属性读取。原则：**上限由最终消费者的坐标系定义，一处声明；字典用无原型对象。**
5. **展示给用户的选项/next 不是从决定者的可达转换表派生**（S3、S5、S6）。升级选项手写、补跑集合从"已记录失败"而非"未决步骤"派生、归档 next 看结局而 continue 看类型。原则：**展示层只调用判定层的同一函数生成选项与 next，不维护第二份规则**；技能文本随判定对齐（第三次 rework 的文本"被拒改为升级"与代码"记录再升级"已经不一致）。
6. **幂等重放绕过前置，回执混入当前状态**（R1、R2）。`assertHostAssetsCurrent` 只挂新签发分支；回执的 `phase` 取当前聚合而不是签发事件。原则：**`materializedPermit`/`replayPermit` 是唯一"发出许可"边界，前置在边界前统一执行；回执内容只来自签发事件，当前状态只进 next。**
7. **单宿主假设写进共享层**（H8、R-REC-02、R-ROOT-04；H6 是 Claude 贡献与共享 reconcile 的条件不一致，单宿主即触发）。pod 关闭、回执汇总、制品比较只看本宿主/本进程。现有边界已经给出语义：观察 facade 固定携带两宿主，`observeHostBindings` 对缺席宿主根返回 observed-empty——"未初始化宿主 = 空集"已是既定规则，不需要新的状态、标记文件或策略字段。统一修法：`listPodWorktreeReceiptsAnyHost` 按 `WAKEFLOW_HOST_IDS` 合并、按仓库唯一、冲突显式失败（四个消费者同时受益）；pod facade 增 `hosts`（由两份 entrypoints 供值，共享代码不判断宿主名）；**唯一必须限同宿主的是制品摘要比较**，用 per-host 的 `ObservationHost.artifact` 表达——这也是 C6/C11 版本轴的前置约束（版本可跨宿主比，摘要只能同宿主比）。`delivery/service.ts:551` 与 `endpoint/service.ts:528` 的同宿主回执读取语义正确，不动。
8. **消费者用名字/旧表/按行正则替代 producer 记录的事实**（T3、T5、T4）。handoff 按检查名豁免 unavailable 而不是按用户显式跳过；export-ci 用硬编码阶段表而不是回执里的 selection；impacted-tests 用不跨行的正则建图，39% 的相对导入边不可见，`quick --changed` 常对真实改动报"0 测试、通过"。原则：**消费端读 producer 自己记录的输入。** 同一原则下还有本周期发现的两条：`wf timings apply` 的守卫比较 HEAD 提交而不是输入摘要（字节相同、提交指针移动就拒绝，§13.210）；lab 把 MCP SDK 的 60 秒请求超时映射成 `inspection-unavailable`，负载超时与真实不可用不可区分。
9. **宿主助手的屏幕、标题与观察边界**（H2、H3、H5、R-ROOT-07、R-ROOT-08、R-ROOT-09、R3、R4）。都是单点：resume 不观察 worktree、输入框只看首行、mark 与 launch 的标题规则不共用、gitdir 读不出被压成 absent、路径在引用前被单行化、hook 事件词汇三份 Schema 各抄一份、Codex 文本写死 slash 命令、README 手写门数。其中 H2/H3/H5 的改动必须在真实 Claude Code + tmux 上验证后再合入（H3 误判会阻塞所有投递）。

## 3. 设计优化点

逐项修复之外，下面九条是这次审阅暴露出来、值得一次做对的设计点；它们分别落在第 4 节的批次里。

1. **锁内决定的惯用法成为规则。** 把第 2 节第 1 类的原则写进能力卡 06（投递）与 02（窗口登记）的执行顺序，并让 I 批的每个修复都带一条确定性交错测试（仓库已有 `holdLockInChildProcess`、`inspectExistingResource` 钩子），不再接受"先决定后加锁"的新代码。
2. **`boundedText` 进 foundation/text。** 按码点截断、不切代理对、可带省略号；替换 4 个 UTF-16 切点和 6 处复制件，新增 foundation 测试钉住"结果长度不超原值、永不产生 lone surrogate"。
3. **发出许可只有一个边界。** `materializedPermit` 前统一执行资产守卫；回执 `phase` 由签发事件推导。顺带给 `delivery/service.test.ts` 补第一条 host-asset 用例（目前为零）。
4. **选项与 next 由判定层派生。** `deriveImplementationDecisionBlockers` 加 `rework-brake:<n>`，第三次 rework 由 Controller 记 `escalate{needs-decision}`，目标落 `escalated`，回答后 accept 经既有 resumption 可达；S5 把"从未观察且无基线"的步骤并入可点名集合；S6 的归档 next 读 claim 类型。技能文本三处随之对齐。
5. **双宿主事实统一读取。** 第 2 节第 7 类的三步；per-host 制品身份先于 C6/C11 落地，C6/C11 的比较规则改为"版本跨宿主可比，摘要同宿主才比"。
6. **消费端读 producer 的事实。** T4 的导入图改为剥注释后的词法扫描（至少允许 import/export 与 from 之间跨行），并给 `impacted-tests.test.ts` 加多行、`export … from`、`import type` 夹具；T3 只在 `--no-artifacts` 时豁免；T5 依回执 selection 判完整；`wf timings apply` 只比输入摘要与 dirty 标记；lab 把 SDK 超时分类为 `inspection-timeout`。
7. **门对外部负载的余量。** §13.210 测得重用例在安静机器上已用掉预算的 40–60%，任何 2.5 倍的外部放慢都会取消它们；D4（拆 `result-review/service`、`observation/service` 等重文件）同时是对外部负载的余量，并入 G 批（正好动 result-review 的测试）。
8. **目录预算的结构性措施。** hook 事件词汇在三份 Schema 里各抄一份，R-ROOT-09 顺带抽成共享定义三处 `$ref`；同法处理其他重复枚举，为 C6/C11 的新字段腾出空间（现余 1,452 字节）。
9. **容量的单一来源。** 证据的深度、文件数、字节数全部从 `WAKEFLOW_DEMAND_TREE_CAPACITY` 换算（深度减去 `artifacts/managed-evidence/<id>/payload` 四层），准入时用同一容量读当前 Demand 树 + 计划 payload 给出累计阻塞。

## 4. 批次与顺序

每批一个阶段、一道门（用户 2026-10-20 的裁决）；级别按 CLAUDE.md：`tooling/testing`、`src/foundation`、`src/kernel`、`src/contracts` 或场景链有改动即第 2 级。顺序的依据：先恢复验证本身的可信（F），再修日常流程里最常撞到的（G），再修会把 Demand 卡死的（H），再修并发（I），再做双宿主与版本轴（D′），现场依赖的助手改动单独一批（J），退出路径仍最后（E）。

| 批 | 内容 | 级别 | 现场 |
| --- | --- | --- | --- |
| F 验证可信与文本 | T4 导入图、T3 handoff、T5 export-ci、T1/T2 构建锁（ts 与 mjs 同步）、`timings apply` 守卫改比摘要、lab 超时分类、R4 两份 README、R3 Codex 交接文本与共享 SKILL.md:125 改宿主中性（制品重建） | 2 | — |
| G 评审与决定流 | S3（修法 B）、S5、S6、R2、R1；D4 拆重测试文件同批 | 2 | — |
| H 终态耐久与截断 | S2 + R-ROOT-05 的 `boundedText`（含 archive-locator、active-projection）、S4、S1、R-REC-04、R-REC-01、R-REC-03（深度换算 + 累计阻塞）、R-ROOT-01、R-ROOT-09（含共享 hook-event 定义，`schema:build`） | 2 | — |
| I 锁内决定 | R-ROOT-03、H4、H1、H7、R-ROOT-02（看板级锁） | 2 | — |
| D′ 双宿主与版本轴 | R-ROOT-04（per-host 制品身份，前置）、R-REC-02、H8、H6，然后原批 D 的 C6/C11 | 2 | L13（连续 `/next`）一并在缓存刷新后做 |
| J Claude 助手 | 先现场 L15：真实 Claude Code 2.1.x 多行草稿渲染（决定 H3 的判空规则）；再 H3、H2、H5、R-ROOT-07、R-ROOT-08 | 1（hosts）+ 现场 L16 | L15 前置、L16 验收 |
| E 退出路径 | 原批 E 不变（ADR 先行，`wakeflow.detached.json`） | 2 | L14 |

说明：

- 1.2.0 已 bump、未打 tag，F–E 全部落在 1.2.0 里；tag 打在最后一个制品提交之后，`release:check` 在 tag 之后真跑。
- F 批最小但最先：T4 修好之前，每个后续批次的第 0/1 级选择都不可信；R3/R4 是零风险文本，顺带。
- G 与 H 都动 `result-review`/`demand` 一带，但 G 是决定规则、H 是耐久与恢复，分两门可以让回归定位清楚；若要省一门，G+H 可合。
- I 批每项都带确定性交错测试；R-ROOT-03 的 prepare 顺序重排要核对重放路径（R2 修好后再做，所以排在 G 之后）。
- D′ 吸收原批 D；C6/C11 的设计（1.2 计划 §3.6）按第 3 节第 5 条修订比较规则。
- J 批之前不要改 H3 的判空：误判会阻塞所有投递。L15 只需用户开一个真实产品窗口打两行草稿、我读屏幕。

## 5. 需要用户确认的点

1. **S3 的修法。** 建议 B：第三次 rework 不再"记录 rework 再升级"，改为阻塞 `rework-brake:3`，Controller 记 `escalate{needs-decision}`，用户回答后 accept 可达，技能文本"被拒改为升级"因此变成事实。备选 A：只把"接受"从升级选项里去掉（最小，但用户选不了接受）。
2. **顺序 F → G → H → I → D′ → J → E** 是否接受；G 与 H 是否合成一门。
3. **H3 先现场再改**：需要你在一个真实产品窗口打两行草稿，让我读屏幕（L15），之后才动判空规则。
4. **门的采信规则。** §13.210 采信了另一会话在同一字节上跑出的绿门。是否把"同一输入摘要上的绿回执即阶段门，不论谁发起"写进 CLAUDE.md 的验证节；不写则下次仍重跑。

## 6. 跟踪

| 批 | 状态 | gate-log | 登记 |
| --- | --- | --- | --- |
| F | 已执行（§13.211；门 run-BU2RXe 1545/1545） | §13.211 | W18、W24–W27、W33、W35 |
| G | 已执行（§13.212；门 run-bn8pHT 1548/1548；D4 第一步同批） | §13.212 | W16、W17、W21、W23、W34、D9 |
| H | 待执行 | — | W 节 |
| I | 待执行 | — | W 节 |
| D′ | 待执行（吸收 V6） | — | W 节、V6 |
| J | 待执行（L15 前置） | — | W 节 |
| E | 待执行 | — | V7 |

35 项在 [open-items](../references/open-items.md) 的 W 节逐项登记（W1–W35，带 Codex 报告的原 ID）；完成一批即在该批的 gate-log 节里逐项记"修法、测试、现场"，并把 W 节的状态改为已修。
