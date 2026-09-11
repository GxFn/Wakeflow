# 能力组 8：证据、归档、保留与清理

> 状态：`confirmed`，Q1 到 Q7 于 2026-09-04 按建议裁决，记录见文末"确认记录"
> 建立日期：2026-09-04
> 旧实现基线：`core/`、`plugins/*` 于 `c0098e2`
> 上位文档：[ADR-0009](../../decisions/0009-execution-endpoint-and-host-effect-handshake.md)、[ADR-0010](../../decisions/0010-worktree-isolated-execution-and-converged-flow.md)、[standards/resource-handling-standard.md RH-5](../../standards/resource-handling-standard.md)
> 说明：本组是流程直线的末端。归档让一条 Demand 事件流封存到 ledger，是 ADR-0005 与 ADR-0010 所说"封流归档"的落点。

## 8.1 受管证据

**场景**：Controller 把一份评审输入固化为 Demand 根下不可变的证据记录：可以是仓库或支撑面里的文件或目录树，可以是一个 https 链接或一个 git 提交；每份证据带隐私扫描，绝不带原始句柄或私有路径。

**旧实现**：

- `wakeflow_record_evidence` 三段式，preview 输入 `{kind, source, relations?, sensitivity?, controllerReviewedOpaque?}`，apply 用 `{plan, planDigest}`，recover 只需 `demandId`。Controller 身份与状态根由运行时派生，调用方不能指定。`wakeflow-mcp-tools.mjs:307-341`。
- 三种来源：`managed-path{root{repository | support-surface}, path, expectedType file | tree, expectedDigest}` 复制字节；`https{url, verification{caller-supplied-digest}}` 与 `git-commit{repositoryId, commitOid, verification}` 只做定位符不取内容。没有内联文本，没有任意绝对路径。`wakeflow-evidence-records.mjs:295-370`。
- 记录 `evidence/<id>/evidence.json` 加 `payload/**`，同父目录 stage 一次 rename 发布；文件来源固定为 `payload/content`；树摘要按去掉 `payload/` 包装后的投影计算，空目录参与摘要。`wakeflow-evidence-tree.mjs:384-408`、`:755-765`。
- 上限：256 文件、256 目录、单文件 16 MiB、总量 32 MiB、深度 16、路径 512 字节、清单 1 MiB、关系 256。`:40-47`。
- 隐私扫描只拒绝不脱敏，五类：私钥头、厂商凭证前缀、凭证赋值、私有绝对路径（任何以 `/`、`C:\`、`~/` 开头的路径）、无 typed 前缀的裸 UUID；命中即失败；记录里的 `privacyScan` 只可能是 `passed` 加空计数。`:427-471`、`:616-618`。
- `controllerReviewedOpaque` 只管非 `text/plain` 内容：pdf 与四种图片需要 true，未知或含 NUL 的字节一律拒绝。`sensitivity ∈ public | internal` 三处校验但不改变任何行为。
- 关系：指向本 Demand 的任务包、目标结果、评审候选、测试卡，或一个 controller 事件，全部按摘要核对。
- 计划冻结 evidenceId、时间、配置摘要、状态修订与摘要、来源快照、清单、下一事件与状态；apply 在锁内重算整份计划要求逐字节相等；精确重放返回 `already-recorded`。事件 `evidence.recorded`，状态不变只加修订。`wakeflow-evidence-importer.mjs:600-951`。

**不变量**：最终根只创建一次；stage 与最终根不可共存；负载字节与清单逐项复验含内容类别。

**现 TS 状态**：`wakeflow_record_evidence` 已公开，Managed Evidence 有清单、捕获规划、发布事务、结算、读取器共 21 个文件；隐私扫描沿用。（切片 8 落地：改走内核效果型外壳，四种来源与闭集种类，文本负载经内核隐私扫描；见文末落地记录。）

**实现判断**：按 ADR-0010，来源根增加 `pod-worktree{podId, repositoryId}`，让 pod worktree 里的文件可作证据；宿主 hook 观察记录作为新的定位符来源 `observation{observationId, digest}` 不复制负载；`sensitivity` 删除；`privacyScan` 常量槽位删除；`findings` 与 `blockers` 两个恒空字段删除；两套隐私引擎合并为一套并在导入与归档使用同一词汇。

**待确认**：

- Q1 隐私扫描对文本证据是否从"任何根路径与裸 UUID 一律拒绝"改为"只拒绝凭证类，路径与 UUID 按工作区根与已知 typed 前缀白名单判断"？建议改，否则 worktree 里的普通文本会大面积误拒。
- Q2 证据 `kind` 是否改为闭集，例如 `hook-observation | transcript | test-output | diff | document | link | commit`？建议改为闭集并允许扩展。
- Q3 会话 transcript 是否允许作为证据：按定位符加摘要引用，不复制负载？建议允许。

## 8.2 业务归档

**场景**：Demand 完成或取消后，把它的全部权威、事件、工件、证据、传输摘要和 TODO 谱系封成一个可移植的归档包放进 ledger，活动根随之删除；这是一条事件流的终点。

**旧实现**：

- `wakeflow_archive` 四个操作 `preview | apply | inspect | recover`；输入 `archiveId`、`archivedAt`、`archiveEventId`、`archiveReason`、`conclusion`、`expectedPrevious`；没有任何 redact 选项。`wakeflow-business-archive-service.mjs:79-96`。
- 前置：状态 completed 或 cancelled 且 CAS 精确；恰好一个终态事件；评审 idle 且集合为空；全部包与卡 closed 或 superseded，任务 accepted、cancelled 或 superseded，accepted 的有一个非阻塞 current 结果；Pod 已关闭；没有既有归档和残留；**不检查租约**，那是 prune 的门。`:846-973`。
- 内容：`payload/` 下 demand、authority、**归档态的** state、含 `demand.archived` 事件的事件日志、全部工件、全部证据清单与负载字节；`todo-history.json`；`transport-summary.json` 只有 id 与摘要；`business-summary.json`；清单是 ledger 记录 `wakeflow-archive-manifest`，`archiveKind: demand`，落在 `<ledger>/workspace/archive/<yearMonth>/<archiveId>/`。`:1378-1592`。
- 来源树闭合：活动根必须恰好包含预期文件与能力目录，多一个文件即拒绝。
- 隐私准入：对 demand、authority、state、events、工件、证据清单、计划与不透明负载做只拒绝的扫描，禁止根为工作区根、ledger 根与 home；结构字段豁免；命中只报计数与散列引用。传输句柄从不进入归档，因为传输摘要只是投影。`:1656-1673`。
- 活动根处置：写 sidecar 意图，rename 为 tombstone，逐文件按摘要删除，最后删目录与 sidecar；活动根**被删除**，归档态只存在于归档包内。`:3315-3347`。
- TODO 行：CAS 精确匹配 claimed 行后从板上删除，谱系保存在 `todo-history.json`。
- 恢复四种合法前缀：活动根在则推进；tombstone 加 sidecar 加 ledger 归档则从 tombstone 完成；sidecar 加 ledger 则从 sidecar 完成；只有 ledger 则返回投影；其余组合全部失败。重复 apply 收敛到同一归档。`:3440-3480`。
- 明确不做：不关宿主、不删 worktree、不删传输记录。

**现 TS 状态**（2026-09-04 L1 demand 切片）：完成与取消都封归档包 `<ledger>/archives/<demandId>/<终态事件流修订号>/`，成员 `manifest.json`（谱系、终态事件回执、verify 摘要、负载树摘要）、`verify-report.json` 与 `payload/**`（Demand 根去掉可重建的 snapshots、index、append-candidates），tracked 0755/0644；隐私门只拒绝凭证类命中；活动根在负载摘要与归档一致后删除；worktree 来源成员留空位给 pod 切片。`loaded-artifact-tree-transfer-*` 未被消费，归档用 `directory-tree-candidate` 整树发布。

**实现判断**：归档内容形状保留，增加 worktree 来源成员，即 worktree 引用、基线提交、最终树摘要，取代"来源树必须精确匹配"；不整体归档 worktree 内容，只归档摘要与显式记录的证据；`archiveKind` 只保留 `demand`；活动根删除的做法保留；归档时检查该 Demand 的窗口工作声明已全部释放并把未释放的暴露给操作者。

**待确认**：

- Q4 归档继续**删除**活动根而不是留一个归档态存根？建议删除，与"封流"一致。
- Q5 归档是否把"该 Demand 无未释放工作声明"列为前置，而不是留给 prune？建议列为前置，因为 ADR-0010 下 pod 随 Demand 归档进入关闭。

## 8.3 审计保留

**场景**：把一棵不活跃的本地残留树封存起来供日后审阅，到期只获得"可审阅"资格，释放必须显式决定。

**旧实现**：

- `wakeflow_storage_preserve` 五个操作 `inspect | preview | preview-release | apply | recover`，无 demandId。记录在 `.wakeflow-local/audit/preserved/<preservationId>/{preservation.json, payload/**}`，字段含 producer、来源、原因、负载树摘要、`retention{reviewAfter, requiresExplicitRelease: true}`、links。`wakeflow-preservation.mjs:335-421`。
- 可保留对象只有五个 legacy 残留根下的 `storageClass: legacy` 树；`archive-demand` 与 `sanitize-archive` 两个 producer 永远阻塞；传输链、活动运行目录、证据都不可保留。释放只对手工 legacy 保留开放。`:83-89`、`:1743-1772`、`:1965-1984`。
- `preservedReviewAfterDays` 1 到 36500，只决定审阅资格，从不授权删除；释放还要 `explicit-release`。
- `manager.lock` 单行记录，O_EXCL 创建；不匹配即失败。

**现 TS 状态**：没有保留能力。

**实现判断**：按 ADR-0008 丢弃历史版本后，五个 legacy 根不存在，旧保留工具的可保留集合为空。保留能力改为通用的"封存一棵不活跃树"，对象限定为 Demand 归档后的运行时残留与 worktree 检出，审阅资格与显式释放的语义保留。

**待确认**：

- Q6 保留能力按上述改为通用工具，还是与归档合并、整体放弃独立的 preserve？建议合并进归档与清理：归档负责封存，清理负责删除，中间不再有第三种"保留"状态。

## 8.4 运行时清理

**场景**：Demand 归档后，把它留在宿主本地的传输记录与执行残留删掉，只删已经被归档摘要覆盖且没有活动引用的东西。

**旧实现**：

- `wakeflow_prune_runtime` 三段式，只删一个目录 `.wakeflow-local/runtime/shared/transport/demands/<demandId>`，单步 `release-archived-transport-demand`。阻塞项：无归档、传输清单与归档摘要不一致、活动租约、run 状态 ambiguous 或 rejected 或未确认、待发的回传、组成员孤儿或未终结。从不删归档、状态根、证据、TODO、租约、锁、保留条目、空目录、stage 残留。`wakeflow-transport-retention.mjs:29`、`:553-640`。
- 名字承诺过大：诊断出的 `archived-current-residue` 与证据 stage 残留都没有自动清理者。

**现 TS 状态**：没有清理能力。

**实现判断**：清理范围扩展为归档后的运行时残留加已关闭 pod 的 worktree 检出，门保持"已归档、摘要已记录、无活动声明与会话"，只删检出不删 git 对象；永不触碰 ledger、证据、TODO、维护 journal、窗口绑定。

**待确认**：

- Q7 清理是否扩展到"已关闭 pod 的 worktree 检出"？建议扩展，但只在 pod 已 closed 且 hook 记录证明会话已结束后。

## 旧行为疑点

1. `archiveKind` 的 `documents` 与 `todo` 不可达。
2. 保留实际只能处理 legacy 残留，v3 工作区上 preview 永远阻塞。
3. 释放单向锁定给手工 legacy 保留，迁移与归档保留没有公共释放路径。
4. `sensitivity` 与 `privacyScan` 是无变化的槽位。
5. 证据 `kind` 没有词汇。
6. 隐私扫描对普通路径与裸 UUID 过宽。
7. 证据与归档两套隐私引擎词汇不同，通过导入的证据可能在归档时被拒且无法修复。
8. 清理的一个分支把"归档摘要说缺失"误报为摘要不一致。
9. 证据 apply 结果里的 `findings` 与 `blockers` 恒空。
10. 归档不查租约而清理查，归档后租约未释放不会被暴露。
11. 清理只删一个目录，名字承诺过大。

## 确认记录（2026-09-04，按建议）

| 问题 | 裁决 | 落点 |
| --- | --- | --- |
| Q1 隐私扫描范围 | 只拒绝凭证类；路径与 UUID 按工作区根与已知 typed 前缀白名单判断；证据、结果、归档共用一套引擎与词汇 | 隐私扫描模块 |
| Q2 证据 kind | 闭集并允许扩展：`hook-observation \| transcript \| test-output \| diff \| document \| link \| commit` | 证据 schema |
| Q3 transcript 作证据 | 允许，按定位符加摘要引用，不复制负载 | 证据来源 `observation` 与定位符 |
| Q4 归档后活动根 | 继续删除，不留存根 | 归档 apply |
| Q5 归档前置 | 增加"该 Demand 无未释放工作声明"，未释放的暴露给操作者 | 归档 preview 阻塞项 |
| Q6 保留工具 | 不保留独立 preserve；归档封存，清理删除 | 工具面 |
| Q7 清理范围 | 扩展到已关闭 pod 的 worktree 检出；只在 pod closed 且 hook 记录证明会话结束后删检出，不删 git 对象 | 清理 preview 阻塞项 |

## 落地记录（2026-09-10，L1 evidence 切片 8）

按 [gate-log §13.89](../../progress/consolidation-gate-log.md) 六项裁决（D1 到 D6，用户于 2026-09-10 确认）落地，实现与验收记录见 §13.90。

| 节 | 落地 |
| --- | --- |
| 8.1 受管证据 | `wakeflow_record_evidence` 改走内核 `PublicationTransaction`：preview `{root, demandId, selection}` 零写返回计划投影与 `planDigest`，apply 用同一选择重算计划、内容摘要相符才执行，recover 凭 demandId 完成中断的发布。Evidence、Event、Commit 身份从 Demand、来源键与负载摘要派生，同一内容再次 apply 为 `already-recorded`。来源四种：`managed-path`（配置根下文件或目录树，复制字节）、`observation`（本工作区 hook 记录的脱敏投影，不含会话句柄与工作目录）、`link`（https，调用方可给摘要，不抓取）、`commit`（配置内仓库的对象 id，不读 git）；引用类来源的 `payload/content` 是来源投影文档。Q2：`kind` 闭集 `hook-observation \| transcript \| test-output \| diff \| document \| link \| commit` 与来源绑定，与结果定位符共用一张表。Q3：`transcript` 只引用带 transcript 的 hook 记录。Q1：文本成员经内核 `scanPrivacy`，白名单为工作区根、ledger 根与配置根；凭证类命中永远阻塞，opaque 成员与非凭证类命中只在 `contentReview: controller-confirmed` 下进入 Manifest 的 `contentReview.privacyFindings`。`sensitivity`、`privacyScan` 与恒空槽位不存在。`pod-worktree{podId, repositoryId}` 根已于 2026-09-10（pod 切片 9）进表：按配置的 worktree 意图与宿主回执路径打开，Demand 所在 pod 的回执路径进入隐私白名单 |
| 8.2 业务归档 | demand 切片已落地（Q4 删除活动根；Q5 verify 门 `work-claims-released`）；本片不改归档内容，归档负载的隐私门仍只拒凭证类 |
| 8.3 审计保留 | 按 Q6 不实现 |
| 8.4 运行时清理 | 2026-09-10 pod 切片 9：并入 `wakeflow_pod` 关闭第二段，检出仍在时 `worktree-present:<repositoryId>` 阻塞并由 Agent 以宿主手段处置，closed 时 Wakeflow 只删自己的回执目录；Q7 的"删检出"由此变为"处置后才 closed"，对账只报告（观察切片）。归档清单增加 `podId` 与 `worktree{podId, name, placement, repositories[]{repositoryId, suggestedName, branch, head}} \| null` |
| 工具面 | 公共工具 18 不变；公共协调器删除（0 个）；wire Schema 改名 `wakeflow-record-evidence-{request, result}` |
