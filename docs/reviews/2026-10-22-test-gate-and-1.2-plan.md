# 测试门的构成分析与清理优化设计；1.2 版本的底层设计与计划

> 状态：`proposed`（等用户确认第 4 节的批次顺序；第 3 节的裁决已按 2026-10-22 用户意见"全部按照推荐"落为设计前提）
> 基线提交：`3fcc3246`（`main`；`v1.1.2` 打在 f96222ac；完整门 run-2t0hxo 18 分钟，gate-log §13.204）
> 建立日期：2026-10-22
> 上位文档：[开发文档系统](../README.md)、[测试开发标准](../standards/testing-standard.md)、[问题登记](../references/open-items.md)、[旧版复审与 1.1.1 计划](./2026-10-20-legacy-gap-review-and-1.1.1-plan.md)
> 范围：第 1–2 节只量了门、读了测试与夹具，没有改代码（两次实验在仓库外的临时目录跑，见 §1.3）；第 3 节由七路只读调研各自回报实现事实（文件与行号），本文按原实现归纳设计，没有改代码、没有跑门。

## 1. 测试门里到底有什么

### 1.1 构成

`npm test` 的静态阶段（typecheck、架构、Biome、knip、`schema:check`、`build:check`）合计约 16 秒，其余全部是 `test:typescript`：315 个文件、1528 个用例、约 8.3 万行测试源码、27 个夹具与 12 个共享支持模块。按行为分级（标准 §2）与实测（run-2t0hxo，分道负载）：

| 级 | 文件 | 用例 | 耗时之和 | 主要目录与占比 |
| --- | --- | --- | --- | --- |
| 0 纯逻辑 | 85 | 353 | 6 秒 | 各层 `decide`/`contract`/词汇/Schema 形状；几乎不花时间 |
| 1–2 一次性文件系统（无子进程） | 148 | 681 | 1663 秒 | `foundation/filesystem` 30、`governance/demand` 16、`governance/evidence` 8、`governance/ledger` 8、`governance/review` 7；最重的五个文件在 `capabilities/*` |
| 2 带子进程（git、替身 CLI） | 30 | 214 | 1029 秒 | `capabilities/workspace` 7、`hosts/claude-code` 3、`workspace/maintenance` 3 |
| 3 公共工具 | 13 | 98 | 1315 秒 | `entrypoints` 11 个文件 125 秒；两条场景链 1190 秒（每宿主 25 个场景顺序跑） |
| 4 维护者工具 | 30 | 128 | 1150 秒 | `tooling/lab` 6 个文件 943 秒（82%），其余 24 个文件 207 秒 |
| 5 制品与发布 | 9 | 54 | 23 秒 | `artifacts` 6、`codegen` 2、`release` 1 |

三套"端到端"：**场景链**（3 级，仓库内经组合根与内存 Transport 调公共工具，25 个场景顺序推进一个一次性工作区，两宿主各一条）；**lab 矩阵**（4 级，`tests/tooling/lab/workflow-{codex,claude-code}.test.ts`，各 3 个实验，每个实验在仓库外启动**已构建制品**的 `mcp/server.mjs`，用合成 hook 跑完 single-product / dual-product / worktree 的业务链并封存清理，单实验约 100 秒）；**制品冒烟**（`smoke:artifacts`，不在门里：把制品搬到仓库外，列工具、fresh、reconcile、status/verify、pod 预览、一条 hook）。前两套在业务逻辑上重叠（都走发布→认领→规划→投递→证据→回传→评审→归档），lab 独有的是"已构建制品 + stdio 传输 + lab 自己的清理所有权"。

### 1.2 最重的文件与它们重的原因

| 文件 | 用例 | 门内 | 单用例均值 | 重的原因 |
| --- | --- | --- | --- | --- |
| `scenarios/…-claude-code` / `…-codex` | 25 / 25 | 601 / 589 秒 | 24 秒 | 每个场景经公共工具产生几百次耐久写入；组合根不暴露耐久性，生产 `fsync` 全额付 |
| `tooling/lab/workflow-claude-code` / `-codex` | 3 / 3 | 329 / 315 秒 | 105 秒 | 真实制品 + 子进程 + 生产 fsync；与链同跑时比单独跑慢约 50% |
| `capabilities/result-review/service` | 13 | 303 秒 | 23 秒 | 每个用例跑完整条导入/回调/决定链；夹具用了 `DISPOSABLE_ROOT_OPTIONS`，但服务内部经组合调用的部分仍 fsync |
| `capabilities/observation/service` | 21 | 164 秒 | 8 秒 | 每个用例经维护入口 fresh-initialize 一个工作区（维护不接受耐久性选项） |
| `kernel/hook-observations` | 16 | 144 秒 | — | 三个上万条目真实目录树用例占 128 秒，其余 13 个用例 16 秒 |
| `tooling/lab/workflow` / `sealing` | 5 / 3 | 134 / 101 秒 | — | 真实实验与墙钟等待 |
| `capabilities/result-review/mixed-failure-remediation` | 4 | 127 秒 | 32 秒 | 四组混合失败各跑一条完整测试链 |
| `capabilities/demand/service` / `delivery/service` | 6 / 7 | 121 / 116 秒 | 20 / 17 秒 | 中断-恢复用例各自重放整条日志 |

### 1.3 两个实验

- **fsync 的单价。** 仓库外临时目录，3000 次"暂存写 + 文件 fsync + 原子改名 + 父目录 fsync"：25.8 秒；去掉两次 fsync：0.48 秒。本机一次耐久写约 8.6 毫秒，无 fsync 约 0.16 毫秒（两次重复一致）。
- **链里 fsync 占多少。** 单独跑 Codex 场景链（生产 fsync）：25/25，**319 秒**。用 `NODE_OPTIONS=--import` 预载一个把 `FileHandle.sync()` 换成计数空操作的模块（只在实验里，不进仓库）再单独跑：**289 秒**，链进程里 8858 次 sync 调用——单独跑时 fsync 只占约 10%。但门里同一文件要 589 秒（与另一条链和两个 lab 实验同跑），旧的 2 worker 门里两条链互跑是 668/662 秒（耗时表）：两个 fsync 密集的进程同跑，每个都慢一倍，吞吐没有增加。fsync 在本机是一条**被串行化的共享资源**（磁盘刷写排队），单进程的开销小，多进程同跑时互相排队才是 phase 1 的墙。链证明的是业务行为，不是崩溃耐久。

### 1.4 发现

- **F1 并发下的 fsync 排队是 1–3 级耗时的第一来源。** 单独跑一个文件 fsync 只占一成，但门里 4–8 个进程同时 fsync 时每个都慢一到两倍（§1.3），其余道 302 个文件在 6 worker 下 2825 秒之和也是这样被放大的。`RootedDirectory` 早有 `durability: "none"`（只跳过 fsync 系统调用，暂存、原子改名、权限位、CAS、错误分类全保留），`tests/support/prepared-workspace.ts` 把它定为一次性工作区的原则（plan §11），21 个测试与夹具文件已用；但场景链、`entrypoints`、多数 `capabilities` 与 `workspace/maintenance` 测试没用——组合根与维护入口没有这个选项，测试也不该为此改生产缺省。
- **F2 lab 矩阵与链重叠，却在最贵的位置。** 6 个实验 644 秒都在隔离道（2 worker），与链一起决定了 phase 1 的 600 秒；它独有的价值是"装到别处的制品能跑完业务"，这正是 `smoke:artifacts` 的定义，而 smoke 现在只做五幕。
- **F3 级别从文件名看不出来。** `hook-observations`（13 快 + 3 慢）、`operation-scope`（一个 55 秒用例）、`claude-code-tmux-asset`（29 个用例里 1 个脱离重启）、`test-recording`、`test-schedule-order` 都是混合文件；标签在用例里，`--focused` 跑文件时慢用例一起来。
- **F4 五个 2 级文件超出 90 秒预算**（§1.2）。原因是 F1 加"一个用例一条完整链"；`observation/service` 还每用例 fresh-initialize。
- **F5 命名与头注释不统一。** 用例名 147 个文件中文、139 个英文、25 个混用；232 个文件没有文件头注释说明覆盖的切片效果与出处。
- **F6 门证明的边界写在三处而没有一处总表。** `CLAUDE.md` 说级别，`maintainer-tools` 说命令，`load-sensitive.ts` 说标签——没有一份说"哪一级测什么、放哪、依赖什么、改了什么补什么"。本次补上 [测试开发标准](../standards/testing-standard.md)，Claude Code 与 Codex 从同一份 `CLAUDE.md`/`AGENTS.md` 的 Verification 一节指向它。

## 2. 清理与优化设计

### 2.1 设计

- **D1 一次性耐久性进 2–3 级。** 新支持模块 `tests/support/disposable-durability.ts`：`useDisposableDurability()` 在**测试进程内**包装 `RootedDirectory.open`，省略 `durability` 时按 `none` 打开，显式 `fsync` 仍生效。链文件、`entrypoints`、`capabilities/*`、`workspace/*`、`hosts/*` 的测试在文件顶部调用一次；Foundation 的崩溃语义测试不调用并在用例名里写明 fsync。不改 `src/` 一个字节，制品不变，不需要 bump；标准 §4 已写明这条纪律。预计：链在门里 600 → 约 300 秒（单独跑的 289 秒是下限），其余道的 fsync 排队消失、之和显著下降；lab 实验跑的是生产制品仍 fsync，但竞争者少了也会快（旧门里只有一个竞争者时是 218/200 秒）。
- **D2 lab 矩阵改归制品冒烟。** `tests/tooling/lab/workflow-{codex,claude-code}.test.ts` 的 3×2 矩阵缩成门里每宿主一个 `single-product` 实验（约 100 秒，保住"制品 + stdio + 合成 hook"这条路），`dual-product` 与 `worktree` 四个实验进 `smoke:artifacts`（第 1 级触及制品时必跑；CI 的 `artifact` 作业照跑）。门的隔离道从 1170 秒之和降到约 700 秒；冒烟从约 1 分钟增到约 4–5 分钟，只在制品真变时付。lab 的行为测试（inventory、lab、sealing、workflow）留在门里。
- **D3 级别可见。** 新后缀 `.load.test.ts`：整个文件都带 `loadSensitive` 标签的文件用它（lab 矩阵、sealing、rooted-read-write-scope、permission-mode）；混合文件拆成两个（`hook-observations.load.test.ts` 收 3 个大目录用例，`operation-scope.load.test.ts` 收 55 秒的在途投影用例，tmux 脱离重启、运行器取消与分道回归各自拆出）。运行器仍按导入闭包识别隔离道，后缀是给人和 `--focused` 看的；`wf test levels`（D6）检查后缀与标签一致。
- **D4 重文件瘦身。** D1 之后再量；仍超 90 秒的按合同拆文件让 LPT 并行（`result-review/service` 拆成导入与回调、实现评审、测试评审三份），`observation/service` 改用 `createPreparedWorkspaceStore` 的基线复制而不是每用例 fresh-initialize。只拆文件不改断言。
- **D5 命名与头注释。** 按标准 §3：新文件一种语言、必有头注释；现有文件改到时补，不做整仓改写（避免 232 个文件的无意义 diff）。
- **D6 `wf test levels`。** 新只读子命令：按静态事实（导入 `node:fs` 写接口、`node:child_process`、MCP 客户端、`tests/support` 模块、`loadSensitive` 闭包）与最近回执把每个文件归级，输出每级的文件/用例/秒数、超预算文件、混合文件（带标签用例数 / 总数）、`.load` 后缀与标签不一致的文件、缺头注释的新文件；`wf handoff` 加一项信息性的 `test-levels`（只报告，不阻塞）。实现在 `tooling/testing/test-levels.ts`，复用 `impacted-tests.ts` 的导入图。
- **D7 道的再平衡。** D1、D2 落地后重新量三条道：若隔离道明显短于链，其余道改为等隔离道结束后用**全预算**（链结束时空出的 worker 不再闲置）；若链明显短于隔离道，评估隔离道并发 3。不预先定，按新耗时表定。

### 2.2 预期

| 阶段 | 链（每条） | 隔离道之和 / 2 worker | 其余道之和 / 6 worker | 整门墙钟 |
| --- | --- | --- | --- | --- |
| 今天（§13.204） | 600 秒 | 1170 / 585 秒 | 2825 / 470 秒 | 18 分钟 |
| D1 | 约 300 秒 | 约 1100 / 550 秒（lab 不受益） | 约 1800 / 300 秒 | 约 14 分钟 |
| D1 + D2 | 约 300 秒 | 约 700 / 350 秒 | 约 1800 / 300 秒 | 约 11 分钟 |
| + D4、D7 | 约 300 秒 | 约 350 秒 | 约 1800 / 8 worker 225 秒 | 约 10 分钟 |

数字是按 §1.2 的实测与 §1.3 的实验外推（排队效应消失的幅度只有实测才知道），每一批落地后以回执为准、更新本表。

### 2.3 批次

| 批 | 内容 | 级别 | 验收 |
| --- | --- | --- | --- |
| T1 | D1 耐久性支持与接入；D3 后缀与拆分；D6 `wf test levels`；标准 §4/§5 的措辞随实现对齐 | 2（`tooling/testing` 与 `tests/scenarios` 改动） | 完整门全绿；整门墙钟与 2.2 表对照；耗时表刷新 |
| T2 | D2 lab 矩阵归冒烟：`smoke:artifacts` 加四个实验，门里留两宿主 `single-product`；CLAUDE.md/AGENTS.md、maintainer-tools、`verify.yml` 的 artifact 作业预算核对 | 2 | 完整门 + `smoke:artifacts` 全绿；CI 两个作业的时长在预算内 |
| T3 | D4 重文件拆分与基线复制；D7 道再平衡 | 2 | 完整门全绿；无文件超 90 秒（链与 `.load` 文件除外） |

T1 与 T2 可以合成一个阶段、一道门；T3 等新耗时表。D5 没有批次，随每次改动执行。

## 3. 1.2 的底层设计

裁决（用户 2026-10-22，"全部按照推荐"）：M4/J1 做窄版退出路径；R5 取"`result-reported` 阶段一次 `supersedes` 导入"；连续 `/next` 允许，但每次投递与每个决定仍各停一次；R4 按建议；G11、K4、C6/C11 不需裁决。各项先补能力卡或 ADR，再按一阶段一门推进（第 4 节）。

### 3.1 R4：任务包的 `dependsOn` 与 `requiredEvidenceKinds`

**现状。** 任务包 Schema 封闭（`task-package.schema.json:9`），`allOf` 按 `workType` 规定每个字段必有或禁有（`:116-177`），`createTaskPackage` 只接受精确的键集合 `DRAFT_FIELDS`/`TEST_DRAFT_FIELDS`（`task-package.ts:258-296, 723-777`），包摘要是解析后包的规范 JSON SHA-256（`:803-804`）。规划服务从 `demandId + idempotencyKey` 派生 id（`tasking/service.ts:298-309`），包进 `tasking.plan-target-task` 命令的事件数据并由投影存储物化；聚合只复制 `targetTaskId/taskPackageId/taskPackageDigest/repositoryId/windowId/commitExpectation/acceptanceAnchorIds/phase`（`demand-aggregate-state.ts:2874-2884`，Schema 封闭）。测试任务规划已要求全部实现目标 `accepted`（`tasking/decide.ts:261-271`）。投递准备阻塞项的顺序是 `awaiting-decision` → `target-phase:<phase>` → `rearm-available:<gen>`（`delivery/decide.ts:179-194`），服务在 `:1073-1079` 以 `rejectWith(blockers, "$request.targetTaskId")` 拒绝。证据种类是封闭词汇 `hook-observation|transcript|test-output|diff|document|link|commit`（`evidence-kinds.ts:9-17`）；完成门 `requirement-coverage` 已经**从已规划事件重读冻结的包**（`demand-acceptance-coverage.ts:50-53`），`research-evidence` 只对 research 要求 ≥1 `document`，取消时跳过（`demand/decide.ts:195-200`）。目录预算 102 KiB，§13.201 只剩 42 字节。

**设计。**
- 实现任务包新增可选 `dependsOn: targetTaskId[]`（≤32、唯一、不含自身、每个都是**本 Demand 已规划的实现目标**——只能依赖已存在的目标，所以无环是构造保证）；测试包不加（规划时已要求全部接受）。`createTaskPackage` 的键检查从"精确等于"改为"必有 ⊆ 键 ⊆ 允许"，Schema 的实现分支加该字段为可选。
- 投递准备新增阻塞 `dependency-pending:<targetTaskId>`，排在 `awaiting-decision` 之后、`target-phase` 之前；依赖目标的阶段取聚合 `targetTasks[].phase === "accepted"`；`dependsOn` 本身在准备时从已规划事件重读（与 coverage 同一做法），聚合状态形状不变。
- 两种包都可选 `requiredEvidenceKinds: EvidenceKind[]`（≤7、唯一）。完成新增第 16 道门 `required-evidence`：取所有已规划包的并集，与聚合 `managedEvidence[].kind` 比对，缺一报 `missing:<kind>`；取消时跳过（与 `research-evidence` 同列）。`wakeflow_verify` 的描述与 decide 测试钉的"fifteen gates"同步改"sixteen"。
- 技能：`delivery-and-review.md` Step 6 写"多仓库先后顺序用 `dependsOn`，不再靠 prose"，Step 12 写 `required-evidence`；Design 的 `requirement-package.md` 允许在 landing 里给"顺序提示"，由 Controller 落成 `dependsOn`。
- 预算：规划请求 Schema 两处增长，先量 `measureWakeflowToolCatalogBytes`，超出就删描述重复文本，不动 102 KiB 的上限。

**改动面。** `task-package.schema.json`、规划请求 Schema、生成合同（`schema:build`）；`task-package.ts`、`tasking/service.ts`、`tasking/decide.ts`（依赖合法性）；`delivery/decide.ts`、`delivery/service.ts`；`demand-verify-gates.ts`、`demand/decide.ts`；观察的门列表与 `wakeflow_verify` 描述；技能两处、能力卡 05/06/08 补充；测试：`task-package.test.ts:88-97` 现在**钉死拒绝 `dependsOnTargetTaskIds`**——改为接受 `dependsOn` 并拒绝旧名；`codegen/mcp-wire-schema-self-contained.test.ts:199-215` 的字段清单；`tasking/decide`、`delivery/decide:188-247`（阻塞顺序）、新门、链里加一个双目标依赖场景、目录预算。**级别 2。**

### 3.2 R5：评审前一次 `supersedes` 导入

**现状。** 单次导入被四处同时钉住：服务阶段门（`result-reported` 的目标再导入报 `target-phase:result-reported`，`result-review/service.ts:966-968`）、聚合转换（要求 `host-effect-accepted|indeterminate` 且 `targetResultId` 未用过，`demand-aggregate-state.ts:2034, 2051`）、身份派生（`targetResultId`、事件 id、提交 id 都从围栏 `claimId` 派生，"一个声明代际至多一个结果"，`target-result.ts:374-394`）、流审计（同一 `targetResultId` 或 `claimId` 出现两次即整条流失败，`demand-event-sourcing-repository.ts:511-520`）。回调 id 从 `targetResultId` 派生、代际从 1 起、上限 4（`target-result-callback.ts:42-44, 224-229`）；决定要求 `reviewed.*` 与当前结果一致、阶段在 `result-reported|review-blocked|escalated`（`:2250-2260`），接受/返工后没有再入口，所以"决定一经记录不可更改"是结构性的。归档读回的 `foldResultEvent` 已是"同目标最后一次导入为准"（`demand-archive-locator.ts:267-278`）。技能里唯一的更正路径是返工（`delivery-and-review.md:231-252`，报告写错时 `implementationQuality: satisfactory`），而返工计入刹车（阈值 3）。

**设计。**
- 导入请求新增可选 `supersedes: targetResultId`。允许条件（服务与聚合同时判）：目标阶段恰为 `result-reported`，`supersedes` 等于 `currentDelivery.targetResult.targetResultId`，当前投递尚无决定，且本投递还没有被取代过（**一次**）。`review-blocked`/`escalated` 已经有决定，拒绝 `supersede-after-decision`。
- 身份：`targetResultIdForClaim(claimId, sequence)`，`sequence` 1 是今天的派生（旧流 id 不变），2 是取代；事件 id、提交 id 同理；流审计放宽为"同一 `claimId` 至多两个结果且序号不同"。回调按新结果 id 重新签发（代际 1），旧回调记录保留；提示词里是新结果的身份。
- 聚合：`currentDelivery.targetResult` 换成新结果，`supersededTargetResultIds: [旧 id]` 入状态（状态 Schema 加可选数组；没有取代的流形状不变），`reworkCount` 不动，不发任何升级事件。评审快照把被取代的结果作为 `priorReviewHistory` 之前的一条 `superseded` 记录；`inspect` 的 `reviewUnit` 加 `supersededResults[]`。
- 对旧结果 id 的决定自然失败（`result-unknown`），Controller 重新 `inspect` 即可——不需要"已检视"信号。实现与测试目标都适用。
- 技能：target/test SKILL 的"导入后"一段加"报告有误且 Controller 尚未决定时，以 `supersedes` 再导入一次；决定之后只有返工"；Controller 写"被取代的报告不计返工"。
- 预算：导入请求与检视结果都增长，与 3.1 一起量。

**改动面。** 三个公共 Schema + 事件数据 Schema + 聚合状态 Schema；`target-result.ts`、`target-result-callback.ts`、聚合 `:1953-2086`、审计 `:511-520, 630-645`、快照 `:340-445`、决策器 `:1172-1195`、`result-review/service.ts` 导入路径；两份技能与 Controller 参考；能力卡 07 补充。测试：`result-review/service.test.ts:150-187`（新 key 现在期望 `target-phase`——改为 `supersedes` 缺席时仍如此、带 `supersedes` 时成功）、取代后再取代拒绝、决定后取代拒绝、重放幂等、审计、快照、归档读回、链里 card-07 加一个"更正后接受"场景、目录预算。**级别 2。**

### 3.3 连续 `/wakeflow:next`（H8/Q10）

**现状。** "做一步就停"只写在 `commands/next.md:20-22`，技能里没有；`wakeflow_status.next` 由 `deriveNextActions`/`deriveNextProjection` 给出 owner 与建议工具（`observation/decide.ts:110-194`，`kernel/next-projection.ts:29-156`），每个前沿的 owner 已经定了：投递落地后 owner 变成 `target`（阶段表 `wakeflow-target-phases.ts:133-137`），Controller 只能结束回合等回调提示落到自己的窗口；用户点在技能里是明确的六处（工作区 apply、挑包、包要求的方案评审、升级回答、外部条件、complete/cancel/continue 的预览读给用户）。没有任何代码阻止 Controller 在 `record_delivery_outcome` 之后继续。代码里没有钉"and stop"措辞的测试。

**设计。** 不加状态、不改工具：
- `next.md` 的第三段改为：从 `status` 开始，连续执行 **owner 是 Controller** 的步骤，每步之前重新读 `status`、宣布这一步；到以下任一点停下并汇报——owner 变了（投递落地后 owner 是 target；需求认领前是 Design/用户）、刚记录了一个评审决定（用户裁决：每个决定一停）、刚执行了一次投递发送并记录结局（每次投递一停）、技能里的用户确认点、任何阻塞需要用户决定。命令体现在 26 行，上限 40。
- 技能 SKILL 第 10/11 步各加半句"记录决定后结束回合；下一次 `/next` 从 status 继续"，总行数保持 200（压缩别处一行）；`delivery-and-review.md` 的"回调落地"一段加"回调落地的那一轮可以从检视一直做到决定"。
- 取舍写进命令文本：连续执行省掉的是 plan→prepare→send 与 inspect→decide 之间的人工往返与 status 调用（H8 的度量：11 次 `/next`、27 次 status）；保留的两停是用户仍能在每次投递与每个决定后介入。
- 测试：`agent-text-live-guidance.test.ts` 加钉子（命令文本含"owner"与两处停点短语；不含 `unattended`，黑名单已在）。**级别 1**（agent-text 经资源边选中制品测试）+ 重建 + smoke；一次现场 L13（一个 Demand 从认领到接受，数 `/next` 与 status 的次数）。

### 3.4 G11：看板索引两列与陈旧索引的重投影

**现状。** 索引由 `renderRequirementBoardIndex(states)` 从认领状态渲染（`kernel/requirement-board.ts:573-594`），列 `Priority | Status | Requirement | Title | Type | Published | Demand`，静态标记 `board-projection:v1`；只在看板变更时重写（`requirement/service.ts:756`、`demand/lifecycle.ts:349`、发布包 `:126`），维护只在看板根缺席时发布空索引。`observeBoard` 用当前渲染器重算期望摘要（`workspace-observation.ts:348-375`），`board-consistency` 门据此报 `index-stale`（`observation/decide.ts:477-507`）——所以改渲染器就让每个现存工作区的门变红，而 `afterMutationRefresh` 只刷活动投影（`active-projection-refresh.ts:157-171`），reconcile 没有"陈旧即重写"。`parked.trigger` 在认领状态 Schema 里（封闭、18 个必有键）；`testingDecision.mode` 只在账本记录里（`requirement-record.schema.json:56-67`），不在认领状态。

**设计。**
- 认领状态加可选 `testingMode`（枚举同 `testingDecision.mode`）：新认领写入，旧状态文件没有则渲染 `—`；渲染器仍是认领状态的纯函数，不去读账本。
- 列：`Testing`（三值或 `—`）与 `Parked`（触发词截到 40 个码点加 `…`，经 `escapeCell`）；标记升为 `board-projection:v2`。
- 陈旧重写：`maintain-workspace.ts:838` 的 apply 收尾（含零步 no-op 的 reconcile）在刷活动投影之后调用已有的 `refreshRequirementBoardIndex`（CAS、4 次重试、安静失败留给 verify）——现存工作区升级后第一次 reconcile 即恢复一致；在此之前 `index-stale` 的 `next` 指向 `workspace-maintenance`（核对 `verifyNext` 的映射，缺则补）。不做管理文本式的历史表：索引不是用户可编辑的托管正文，重写就是正确动作。
- 空索引摘要随渲染器改变，fresh 计划摘要随之变（未被测试钉死，回执会不同）。
- 测试：`requirement-board.test.ts`（两列、截断、无 `testingMode` 的旧状态）、`workspace-observation.test.ts:175`、`observation/decide.test.ts` 的 `index-stale`、`maintain-workspace` 的 no-op reconcile 重写陈旧索引、`requirement/service.test.ts:222,493`、能力卡 03 补充。**级别 2**（kernel + Schema）。

### 3.5 K4：Codex 按角色裁剪工具集——结论是宿主侧暂不可行

**现状。** 角色词汇 `wakeflow-role-tool-access.ts:8-36`（design 3 个工具、product 2、test 3、controller 全部）只被 Claude 宿主消费：`--allowedTools` 与 settings 的 MCP 允许规则（`claude-code-mcp-permission-rules.ts:16-23`、`tmux-asset.ts:1106-1113`）。服务端一律注册全部 20 个工具（`wakeflow-public-mcp-server.ts:45-73`、`wakeflow-public-mcp-tool.ts:247-287`），组合根唯一的运行期输入是 `serverVersion`，启动器 `server.mjs:37-39` 不读 argv/env。Codex 的 `.mcp.json` 是**插件级**一条服务器（`codex-process-launch-profile.ts:10-19`），窗口是项目上的 `create_thread`，不能带 cwd/env/参数（`codex-window-launch-instructions.ts:46-47`），请求里只有 `root` 没有角色；仓库与文档里没有任何 `config.toml`/`enabled_tools` 的接口。§13.140 量过：全目录 92,681 字节，Design 子集 10,035，Product/Test 子集 16,878。

**结论与设计。** 在 Codex 插件模型下，一个窗口能看到哪些工具由插件级 `.mcp.json` 决定，没有按窗口选择服务器或工具的通道；服务端按请求过滤也无济于事（`tools/list` 在任何请求之前）。按角色给子集的前提是宿主提供"按项目/线程启用 MCP 服务器"或"工具白名单"，当前没有。因此 1.2 不实现 K4 的服务端裁剪，改做两件确定有效的事：(a) **描述减肥**（K3）：三个最大的工具描述（`record_test_review_decision` 8.6 KB、`import_target_result` 8.5 KB、`record_implementation_review_decision` 7.0 KB）把重复的枚举解释移到技能参考，目标是目录回到 95 KiB 以内，给 3.1/3.2 的 Schema 增长留出余量；(b) 在 open-items K4 写下宿主前提与一句"Codex 提供按项目启用 MCP 时再做"，并把 Claude 的 `--allowedTools` 子集继续作为角色边界。**级别 1**（描述文本进制品）。

### 3.6 C6/C11：真正的版本升级与"谁写的"

**现状。** 制品身份是进程启动时自己根下 `artifact-manifest.json` 的摘要（`wakeflow-artifact-identity.ts:19-66`），`readCurrentManifestDigest` 重读**同一个根**，所以同路径覆盖能发现、新版本目录（缓存按版本分目录，`cache-refresh.ts:29-31`）发现不了：旧进程永远 `same`。窗口的 hook 记录带观察器自己根的摘要（`wakeflow-hook-observer.ts:981-987`），比对基准是 Controller 自己的磁盘摘要（`observation/service.ts:458-460`）——升级后新开的窗口反而被标 `stale`，方向错了（C6）。所有持久记录只有 `schemaVersion`，没有任何"由哪个构建写入"的字段（C11）；维护的资产漂移比对的是"运行中构建的字节"，旧进程 reconcile 会把旧资产写回去。

**设计。**
- 身份加第二轴：`resolveWakeflowArtifactIdentity` 同时读 manifest 的 `version`；hook 记录新增可选 `artifactVersion`（旧记录缺席按 null）。
- 比较规则（`observation/decide.ts:50-67, 720-741`）：取所有会话中**最新 session-start 的最高版本** `newest`；若 `newest > server.version` → `runtime.artifactOnDisk: superseded`，门 `runtime-artifact` 报 `server-outdated:<newest>`，窗口不标 stale；若某窗口的版本 `< server.version` → 该窗口 `stale`；版本相等再比摘要（今天的规则）。`next` 的 owner 沿用 profile 的 `runtimeRefresh`（Claude 原地重启 Controller，Codex 用户重启应用）。
- 维护守卫：`maintain-workspace` 在 preview 时调用 `assertUnchanged` 的同一身份并比对 `newest`：旧进程的 apply 被 `runtime-artifact-outdated` 阻塞，不再把旧资产写回。
- C11 的最小闭环：Demand 事件流的提交记录加可选 `writer: {version, manifestDigest}`（不进事件数据摘要，旧流缺席），维护意图与日志同样；`wakeflow_verify` 新增门 `artifact-older-than-stream`：任一提交的 `writer.version` 高于运行版本即 fail。更大的"全部记录带写者"不做——有了 C6 的拒绝，这条门足以回答"是不是旧进程在写新流"。
- 测试：decide 的方向矩阵（新服务器/旧窗口、旧服务器/新窗口、同版本不同摘要、缺席）、hook 记录的旧格式读回、维护被阻塞、流提交写者与新门；状态 Schema 的 `artifactOnDisk` 枚举加 `superseded`。Codex 的安装目录布局仍未在仓库里确认，记为现场核对项。**级别 2。**

### 3.7 M4/J1：窄版退出路径 `detach-repository` 与 `detach-workspace`

**现状。** 维护请求是封闭 `oneOf`（fresh-initialize / reconfigure / reconcile 各 preview|apply，加 recover），动作词汇与 15 种步骤种类都是封闭清单（`wakeflow-static-materialization-preview-contract.ts:36-60`）；reconfigure 拒绝一切删改（`reconfigure-repository-removal-unsupported` 等六个码，`preview.ts:200-265`）。Wakeflow 写到控制工作区之外的只有三类：产品仓库的外部指令块（仅 `managed-block`，`external-instruction-body-authority.ts:41-44`）、Claude 的允许规则（程序根与托管支撑面，`portable-settings-composition.ts:229-241`；退役规则已能精确删除，`transition.ts:63-70`）、`statusLine`（有所有权判定，`statusline-settings-operation.ts:308-316`）。"已知渲染"的判定已有（`authority-transition.ts:164-206`，不匹配即 `unknown-managed-body`），`removeWakeflowManagedTextEnvelope` 已写好却没有生产调用者（`envelope.ts:489-514`）；pod 关闭的"先退役投影再删"是现成模板（`pod/service.ts:610-635`）。Wakeflow 从不删 worktree、分支（`worktree-disposal.ts:4-7`）。

**设计。**
- 两个新动作，各有 preview/apply：`detach-repository {repositoryId}` 与 `detach-workspace {}`。新步骤种类：`remove-external-instruction`（目标正文等于期望渲染或某条已登记历史渲染才删，否则阻塞 `detach-unknown-managed-body:<target>`——另一个工作区的块也是未知，不碰）、`remove-portable-settings-rules`（Claude：删除 Wakeflow 当前与退役规则的精确条目）、`remove-statusline-entry`（仅所有权判定为 Wakeflow 的）、`retire-window-projections`（pod 模板）、`publish-config`（detach-repository：删去该仓库及其 primary-pod 窗口）。
- 前提阻塞：`detach-pod-open:<podId>`（含该仓库的 worktree pod 未关闭）、`detach-demand-active:<demandId>`（活动 Demand 有该仓库的目标）；detach-workspace 要求没有活动 Demand、没有打开的 pod。
- detach-workspace 的终态：`wakeflow.config.json` **改名**为 `wakeflow.detached.json`（不删，留证据），`.wakeflow-active`/`.wakeflow-local`/账本/支撑面/worktree/分支/插件级 hooks 一律不碰并在结果 `leftBehind[]` 列出；此后 status/verify 报 `detached`，reconcile 拒绝，fresh-initialize 要求用户先移走 detached 文件。
- 文本：README 加"停用 Wakeflow"一节（两条意图、会删什么、不会碰什么），`commands/init.md` 一句指向，Controller 的 `workspace-and-windows.md` 把"删除被拒绝"改为"删除走 detach"。
- 测试：两个动作的 preview 零写/apply/recover、每个阻塞、已知渲染与未知正文、detached 之后的 status/verify/reconcile/fresh、Claude 规则与 statusLine 的精确删除、链末尾加"detach-workspace"场景；能力卡 01/02 补充，ADR 一篇（退出路径的边界）。**级别 2。**

## 4. 1.2 批次与顺序

| 批 | 内容 | 级别 | 前提 |
| --- | --- | --- | --- |
| 0 | `npm run wf -- release bump --version 1.2.0 --apply`、重建、登记（open-items 新节 + 本页 id）；T1/T2 的门先于本批跑完（门更快，后面每批都受益） | 1 | 第 2 节 T1/T2 完成 |
| A | 3.3 连续 `/next`（文本）+ 3.5 描述减肥（K3）；现场 L13 | 1 | — |
| B | 3.4 G11 两列与重投影 | 2 | — |
| C | 3.1 R4 + 3.2 R5（同批管理目录预算与链场景） | 2 | A 的减肥先腾出预算 |
| D | 3.6 C6/C11 | 2 | — |
| E | 3.7 detach（ADR 先行） | 2 | 用户确认 detach-workspace 的终态（改名 vs 删除） |

建议顺序 0 → A → B → C → D → E；一批一门，B 与 D 可合成一门。tag 打在最后一个制品提交，`release:check` 在 tag 之后真跑，一版一轮新工作区现场核对（L13 在 A 后，L14 在 E 后）。

## 5. 需要用户确认的两点

1. **T2 的取舍**：lab 的 dual-product / worktree 四个实验从门移到 `smoke:artifacts`——门不再每次证明"制品跑完双产品与 worktree 业务"，改为制品变化时（第 1 级）与 CI 的 artifact 作业证明。建议接受。
2. **detach-workspace 的终态**：配置改名为 `wakeflow.detached.json`（建议）还是删除。

## 6. 跟踪

| 项 | 状态 | gate-log | 登记 |
| --- | --- | --- | --- |
| 标准 | `docs/standards/testing-standard.md` 已建 | §13.205 | D9 |
| T1–T3 | 待执行 | — | D9 |
| 1.2 批 0–E | 待执行 | — | open-items 1.2 节（批 0 新开） |
