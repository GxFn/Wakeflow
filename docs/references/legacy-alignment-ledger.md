# 旧版本功能与代码逻辑对齐台账

> 状态：`active`
> 建立日期：2026-09-20
> 上位文档：[plan §9、§14](../plan/typescript-reimplementation-plan.md)、[能力映射矩阵](./capability-map.md)、gate-log §13.105
> 参考对象：仓库旁只读副本 `Wakeflow-legacy-reference/`（`git archive 629e79c5`，删除旧树前的最后一个提交）；也可用 `git show 629e79c5:<path>` 读取
> 说明：能力映射矩阵按 31 项旧工具与 D1–D41 锚点判定；本台账按**旧模块**逐个核对代码逻辑是否在新 TypeScript 里有 owner。判定词汇：`covered` 逻辑保留、形状基本一致；`recut` 逻辑保留、按新边界重切（列出新 owner）；`dropped` 有意放弃（指向 ADR 或能力卡）；`gap` 新实现缺少旧逻辑（列处置，修完改 `covered`/`recut`）；`pending` 尚未核对。旧实现不是行为基线（TSD-03），台账只找逻辑遗漏，不要求磁盘布局或错误形状等价。

## 1. 判定统计

2026-09-20 首轮核对完（117 行）：

- covered：7
- recut：73
- dropped：37
- gap：0
- pending：0

首轮唯一的 `gap` G1（仓库与 external-owned 支撑面的托管块，B 组 `wakeflow-managed-content.mjs` 与 `wakeflow-rule-model.mjs`）已于 2026-09-21 修在代码里并加回归（gate-log §13.106），两行改判 `recut`。

第二轮（导出函数级，§3）B 组核出并修完三处首轮漏判的 gap：G2 支撑面 scaffold 目录、G3 支撑面 `.gitignore` 托管块、G4 对账自动修复范围（gate-log §13.107）。C 组核出 G5（reconcile 重建缺失或过期的窗口运行投影，已修，gate-log §13.108）与 G6（`wakeflow_status`/`wakeflow_verify` 不报窗口运行投影新鲜度；观察域归 F 组，留到 F 组一并处置）。模块级判定不变；函数级 gap 计 1（G6）。D 组（Demand、结果、评审与证据，gate-log §13.109）逐函数核对无 gap：Pod Design 制品与 dispatch group 按 ADR-0010 / ADR-0012 放弃，完成时的 lease 删除改为 `work-claims-released` 门加 Controller 显式释放，其余分支都有 owner。E 组（投递、窗口、租约与宿主激活，gate-log §13.110）逐函数核对无 gap：投递五阶段压成 prepare / outcome / rearm 加回调重发，transport 四类记录变成事件流事件，修剪并入归档事务，租约变成工作声明，keep-live 与宿主激活按能力卡 10 继续 dropped。F 组（Pod、观察与公共运行时，gate-log §13.111）修完 G6：`wakeflow_status` 逐窗口报运行投影新鲜度、`wakeflow_verify` 补回 window-runtime-projection 门，函数级 gap 归零；pod 的物化事件链、Design 交接、Test access 与 preservation 按 ADR-0010 / 矩阵行 29 / 能力卡 8 Q6 继续 dropped。A、G、H、I、J、K 组（gate-log §13.112）逐函数核对无 gap：基础原语按根作用域句柄与异步锁重切，迁移整组 dropped（ADR-0008），公共 MCP 层的输出脱敏与工具 annotations 都有 owner、六个 git spawn 按能力卡 9 Q1 放弃，宿主专属模块的宿主效果按 TSD-12 交给 Agent、观察与证据留在端点与 hook 记录，技能文本按 §13.99 D1 压缩。**第二轮到此完成：117 行、约 420 个导出函数全部核对，函数级 gap 为零（G1–G6 六处已修在代码里）。**

## 2. 逐模块台账

### A 基础原语与锁

| 旧模块 | 行数 | 旧职责 | 新 owner | 判定 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `wakeflow-atomic-write.mjs` | 966 | 单文件原子发布：同目录私有 stage、commit 前重验、predecessor 精确旧 inode、mixed-owned 前置判定 | `foundation/filesystem/durable-atomic-file-write.ts`、`durable-atomic-file-stage-*.ts`、`durable-file-candidate.ts`、`whole-file-content-transition.ts`、`file-node-snapshot.ts` | recut | stage→rename、期望节点 CAS 与 fsync 都在；新增可选持久化级别（§13.100） |
| `wakeflow-canonical-json.mjs` | 119 | 规范 JSON 字节与 sha256 摘要 | `foundation/data/canonical-json.ts`、`foundation/crypto/canonical-json-sha256.ts` | covered |  |
| `wakeflow-fs-safety.mjs` | 266 | 路径词法包含、逐层拒绝 symlink 的未来文件目标检查 | `foundation/filesystem/rooted-directory.ts`（根围栏、no-follow）、`rooted-resource-parent-handle.ts`、`rooted-exact-resource-handle.ts`、`portable-resource-path.ts` | recut | 从"路径函数"改成"根作用域句柄"，每次写都在根内 |
| `wakeflow-identifiers.mjs` | 283 | typed id 生成、解析、索引与引用断言 | `contracts/identity/wakeflow-durable-id.ts`、`foundation/identity/uuid-v4.ts`、`kernel/ids.ts` | covered |  |
| `wakeflow-process-identity.mjs` | 306 | 锁记录的进程身份：PID 生命周期、可执行文件、argv、父进程比对 | `foundation/filesystem/rooted-exclusive-file-lock.ts`（记录 pid+线程+token，`process.kill(pid,0)` 判活，euid 核对） | recut | 不再比对 argv 与父进程：PID 复用只会让锁显得仍活跃（`owner-active`，不偷锁），方向是保守的 |
| `wakeflow-state-lock.mjs` | 483 | O_EXCL 短命 owner 记录的同步进程锁，live/stale/unsafe 判定 | `foundation/filesystem/rooted-exclusive-file-lock.ts`（异步、超时、inactive owner 退役） | recut | 旧锁只能同步临界区；新锁跨 Promise 持有并带获取超时 |
| `wakeflow-artifact-tree-identity.mjs` | 659 | 已加载制品树的可移植身份清单与扫描器 | `foundation/artifact/loaded-artifact-tree-{identity,transfer-plan,transfer-candidate,transfer-publication}.ts` | covered |  |
| `wakeflow-active-identity-lock.mjs` | 36 | 串行化 `.wakeflow-active/current` 下 Demand 身份的发布与归档脱离 | 需求看板认领 CAS（`kernel/requirement-board.ts`）加每个 Demand 根的 `PublicationTransaction` stage→rename；归档脱离在 `wakeflow_complete_demand` 事务内 | recut | 没有全局身份锁：一个总控一次一个 Demand（ADR-0011）由看板行 CAS 保证 |
| `wakeflow-active-projection-lock.mjs` | 41 | 工作区级活动投影写锁 | `kernel/active-projection.ts`（投影锁、获取超时、逐文件 CAS） | covered |  |

### B 配置、布局与维护

| 旧模块 | 行数 | 旧职责 | 新 owner | 判定 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `wakeflow-config-v3.mjs` | 824 | v3 配置解析、跨字段约束、深冻结模型、序列化与摘要 | `configuration/wakeflow-config.ts`、`wakeflow-config-document.ts` | recut | 从 v1 起版（§13.102）；`explain` 视图并入 `wakeflow_status.config` |
| `wakeflow-config-v3-owner.mjs` | 1630 | fresh 配置 owner 计划、校验与发布 | `configuration/wakeflow-fresh-config-selection.ts`、`wakeflow-config-authority-publication.ts`、`wakeflow-config-authority-replacement*.ts` | recut |  |
| `wakeflow-config-v3-snapshot.mjs` | 307 | 一次操作范围内的配置权威快照 | `configuration/wakeflow-config-authority-snapshot.ts` | covered |  |
| `wakeflow-config-v3-transition-authority.mjs` | 332 | 配置转换证明：strict、legacy migration、fresh hard-link pair | fresh 与 reconfigure 的转换在 `wakeflow-config-authority-publication.ts` 与 `wakeflow-config-authority-replacement-contract.ts`；migration 分支放弃 | dropped | ADR-0008 决定 1：不识别、不迁移任何历史布局 |
| `wakeflow-layout-descriptor.mjs` | 1073 | 把配置与宿主能力编译为期望布局目录 | `workspace/wakeflow-workspace-static-resource-matrix.ts`、`workspace-resource-declaration.ts`、`configuration/wakeflow-config-resource-catalog.ts`、`wakeflow-config-root-placement.ts` | recut |  |
| `wakeflow-local-layout.mjs` | 519 | `.wakeflow-local` 结构分区计划 | 静态资源矩阵加 `kernel/layout.ts` | recut |  |
| `wakeflow-local-layout-inspection.mjs` | 1720 | `.wakeflow-local` 足迹检查：legacy、unknown、aging、preserved 分类 | `wakeflow_verify` 的布局门（`host-settings-assets`、`pod-execution-location` 等）与 reconcile 只报告 | dropped | storage 视图与 preserve 放弃（ADR-0006、能力卡 8 Q6）；legacy 分类放弃（ADR-0008） |
| `wakeflow-local-layout-realization.mjs` | 1111 | 本地布局的 M3 物化参与者与存储投影 | `workspace/maintenance/wakeflow-static-materialization-preview.ts` 与维护执行 | recut |  |
| `wakeflow-fresh-initialize.mjs` | 1253 | fresh 初始化的期望模型、本地资格与主干计划（含迁移物化分支） | `capabilities/workspace/maintain-workspace.ts`、`workspace/maintenance/*` | recut | 迁移分支放弃（ADR-0008）；发现 Wakeflow 标记只拒绝并列出 |
| `wakeflow-reconcile.mjs` | 779 | 对账主干计划 | 同上，`action: reconcile` | covered | 场景 `card-01/reconcile-noop` |
| `wakeflow-reconfigure.mjs` | 890 | 拓扑差异与重配置主干计划 | 同上，`action: reconfigure` 加 `wakeflow-config-authority-replacement-contract.ts` | covered | `pods[]` 与 `storage.ledgerRoot` 改动被拒（能力卡 1、场景 `card-01/reconfigure`） |
| `wakeflow-maintenance-action-composition.mjs` | 705 | 维护动作组合 | `workspace/maintenance/wakeflow-maintenance-execution-plan.ts`、`wakeflow-host-maintenance-contribution.ts` | recut |  |
| `wakeflow-maintenance-action-runtime.mjs` | 809 | 维护动作运行时 | `workspace/maintenance/wakeflow-maintenance-execution-transaction.ts`、宿主 `*-maintenance-execution.ts` | recut |  |
| `wakeflow-maintenance-coordinator.mjs` | 398 | 维护协调器：锁、journal、preview/apply/recover | `wakeflow-maintenance-execution-transaction.ts`、`wakeflow-maintenance-gate-journal-store.ts`、`wakeflow-maintenance-journal.ts` | recut | 22 个协调器压成一条事务（ADR-0013） |
| `wakeflow-maintenance-plan.mjs` | 1250 | 维护计划形状与摘要 | `wakeflow-maintenance-execution-intent.ts`（`planDigest`） | recut |  |
| `wakeflow-managed-content.mjs` | 2362 | `.gitignore` 与程序/仓库/Design/Test 记忆文件的 owner：托管块、整文件、用户改动即 blocked | 工作区根 `AGENTS.md`/`CLAUDE.md` 托管块与 `.gitignore`：`workspace/managed-integration/*`；Wakeflow 管理的支撑面整文件记忆：`workspace/support/wakeflow-support-memory-authority.ts`；managed-block 仓库与 external-owned managed-block 支撑面的托管块：`workspace/managed-integration/wakeflow-external-instruction-{body-authority,inspection,recomposition}.ts`，预览与执行器的 `recompose-external-instruction` 步骤 | recut | 曾为 **G1**（2026-09-20 首轮）：这两类托管块在新代码里只进了配置，没有写入器或对账消费者。2026-09-21 修复（gate-log §13.106）：同一托管块机制（envelope、current→desired 转换、CAS 替换、用户改动即 blocked），正文只引用 primary pod 的持久窗口，所以 pod 生命周期不会让用户仓库里的受管文件变脏；旧版的仓库级 `.gitignore` 与 settings 授权（fresh 授权列表固定为空）仍按能力卡 1 §1 表第 30 行不实现；旧版 `remove-managed-block`（政策改回 owner-managed 时删块）不需要，因为 reconfigure 拒绝任何 topology 变化 |
| `wakeflow-support-materialization.mjs` | 393 | Wakeflow 管理的支撑面目录与记忆文件物化 | 静态资源矩阵加 `wakeflow-support-memory-authority.ts` | recut |  |
| `wakeflow-support-surface-owner.mjs` | 852 | 支撑面 owner | `workspace/support/wakeflow-managed-support-resource-catalog.ts` | recut | external-owned 面的托管块由 `workspace/managed-integration/wakeflow-external-instruction-*` 处理（原 G1，2026-09-21 落地） |
| `wakeflow-tracked-materialization.mjs` | 901 | 已确认步骤到目录/staged 文件的物化适配器与恢复 | `foundation/filesystem/durable-directory-materialization.ts`、`durable-directory-tree-{candidate,publication,candidate-retirement}.ts` | recut |  |
| `wakeflow-workspace-mutation.mjs` | 6482 | 唯一 M3 工作区事务 | `workspace/maintenance/wakeflow-maintenance-execution-transaction.ts`（journal 先于步骤、锁不自动打破、同 operationId 只向前） | recut |  |
| `wakeflow-host-settings-assets-owner.mjs` | 642 | Claude settings 与资产 owner | `hosts/claude-code/claude-code-portable-settings-*.ts`、`claude-code-statusline-*.ts` | recut | 只写 MCP 允许规则与 statusLine 一键（能力卡 1 F1.6、§13.94 D6） |
| `wakeflow-host-profile.mjs` | 74 | 开发态 Codex 宿主画像 | 无 | dropped | TSD-12：宿主 profile 只在 `src/hosts/<host>/`，没有开发态假画像 |
| `wakeflow-host-capability.mjs` | 324 | 宿主能力的共享窄视图 | `hosts/*/wakeflow-workspace-host-resource-profile.ts`、`*-window-host-identity-profile.ts`，经宿主 facade 消费 | recut |  |
| `wakeflow-rule-model.mjs` | 524 | 渲染程序/仓库/支撑角色记忆候选文本 | 程序记忆：`wakeflow-program-instruction-body-authority.ts`；支撑角色记忆：`wakeflow-support-memory-authority.ts`；仓库记忆与 external-owned 支撑面记忆：`wakeflow-external-instruction-body-authority.ts` | recut | 原并入 G1；2026-09-21 落地。仓库正文保留旧版结构（稳定身份、持久职责窗口、精确分配规则、仓库边界、安全边界），不再列 active index/status 与 ledger record map 路径（新实现没有这些投影） |
| `wakeflow-template-renderer.mjs` | 413 | 安装资产 bundle 加载与模板替换（Demand 进度页） | 投影模板是代码：`kernel/active-projection.ts` | dropped | §13.101 D1：不再发出 `templates/` |

### C 活动投影、账本、TODO 与归档

| 旧模块 | 行数 | 旧职责 | 新 owner | 判定 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `wakeflow-active-foundation.mjs` | 1004 | `.wakeflow-active` 三个首次物化资源：活动根、current、全局 TODO | 静态资源矩阵（活动根、current）加 `kernel/requirement-board.ts`（看板取代 TODO） | recut | ADR-0011 |
| `wakeflow-active-projector.mjs` | 2430 | 活动投影：index、current status、每 Demand 页 | `kernel/active-projection.ts`、`governance/observation/active-projection-{facts,refresh}.ts` | recut | 标记、指纹、unsafe 整轮零写、pod 段（§13.94–§13.96） |
| `wakeflow-ledger-materialization.mjs` | 1127 | ledger 五个目录与四个投影的维护适配 | `governance/ledger/ledger-authority-store.ts`（initialize）、`ledger-authority-layout.ts` | recut | 四个 Markdown 索引投影放弃，见下一行 |
| `wakeflow-ledger-projector.mjs` | 845 | ledger 四个 Markdown 索引的确定性投影 | 无；看板索引 `board/index.md` 由内核重写，活动投影链接看板 | dropped | 能力卡 3 §3.5 现 TS 状态与实现判断；`docs/requirements/wakeflow-functions-and-scenarios.md` §2 投影行仍列"ledger 索引"，本轮改正 |
| `wakeflow-ledger-records.mjs` | 1964 | requirement/confirmation/archive 三类不可变记录与成员引用 | `governance/ledger/ledger-authority-record.ts`、`ledger-record-publisher.ts`、`ledger-record-publication-*.ts`、`capabilities/demand/archive.ts`（归档包）、`governance/observation/demand-archive-locator.ts` | recut | confirmation 家族取消（ADR-0011）；函数级见 §3 C 组 |
| `wakeflow-window-runtime-projector.mjs` | 2164 | 窗口运行投影的检查与维护 | `workspace/window-runtime/wakeflow-window-runtime-{registered,unregistered}-projection.ts`、`*-fresh-publication.ts`、`*-desired-topology.ts`、`*-projection-document.ts`、`*-projection-maintenance.ts`（G5） | recut | reconcile 重建 missing/stale 投影（G5，gate-log §13.108）；观察侧新鲜度报告 G6 待 F 组 |
| `wakeflow-window-runtime-records.mjs` | 797 | 窗口运行投影记录 codec | 同上加 `wakeflow-window-host-binding*.ts` | recut |  |
| `wakeflow-todo-service.mjs` | 1413 | 全局 TODO 表：13 列、claim/archive CAS、lineage | `kernel/requirement-board.ts`、`capabilities/requirement/*`（需求包看板） | dropped | ADR-0011：需求包成为唯一交接物，TODO 摄入取消；认领 CAS 保留在看板 |
| `wakeflow-todo-table.mjs` | 101 | TODO 行级 Markdown codec | 无 | dropped | 同上 |
| `wakeflow-business-archive-records.mjs` | 1556 | 归档四类记录合同与隐私准入 | `contracts/schemas/governance/archive/demand-archive-manifest.schema.json`、`capabilities/demand/decide.ts`（`payloadPrivacyBlockers`）、`kernel/privacy-scan.ts` | recut | 四类记录并成一份清单；隐私准入只拒凭证类（能力卡 8） |
| `wakeflow-business-archive-service.mjs` | 3561 | 整需求归档编排：双锁内重建终态、可恢复事务、ledger 发布、TODO 消费、tombstone 脱离 | `capabilities/demand/lifecycle.ts`（完成/取消各是一个发布事务）、`capabilities/demand/archive.ts`、`governance/demand/demand-verify-gates.ts` | recut | ADR-0012 D3；场景 `card-08/complete-and-archive` |

### D Demand、结果、评审与证据

| 旧模块 | 行数 | 旧职责 | 新 owner | 判定 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `wakeflow-demand-artifact-records.mjs` | 1723 | 六类 artifact codec（Pod Design 请求/交接、任务包、结果、评审候选、测试卡）、身份派生、精确读取、库存诊断 | 任务包 `governance/tasking/*`；结果 `governance/result/*`；评审 `governance/review/*`；库存 `governance/demand/event-sourcing/demand-event-sourcing-root-inventory.ts` | recut | Pod Design 请求/交接放弃（ADR-0010）；测试卡并入 test 任务包（ADR-0012 D4）；评审候选并入检查投影（矩阵行 11） |
| `wakeflow-demand-artifact-service.mjs` | 1658 | 任务包/测试卡/结果/评审候选的业务准入与原子提交 | `capabilities/tasking/{decide,service}.ts`（拓扑分配、谱系、依赖、锚点）、`capabilities/result-review/*` | recut |  |
| `wakeflow-demand-core-records.mjs` | 5519 | 五类核心记录 codec、状态增量约束、持锁物理读取 | `governance/demand/event-sourcing/*`（事件流、Decider、Command Handler、快照、upcaster）、`governance/demand/model/*`、`kernel/event-stream/*` | recut | ADR-0005/ADR-0013：一次写命令只读一次事件流 |
| `wakeflow-demand-document-builder.mjs` | 657 | 单需求人类可读投影（index、developer-progress） | `kernel/active-projection.ts`（每 Demand 页） | recut | 最近十条事件按 §13.101 D9 不加 |
| `wakeflow-demand-layout.mjs` | 61 | 单需求根的能力目录词汇 | `kernel/layout.ts`、`governance/demand/publication/*` | recut | isolated placement 改为 pod（ADR-0010） |
| `wakeflow-demand-lifecycle-orchestration.mjs` | 1041 | complete/cancel 终态编排：准入、原子提交、租约 effect、失败闭包 | `capabilities/demand/lifecycle.ts`、`capabilities/demand/decide.ts`、`governance/demand/demand-verify-gates.ts` | recut | 完成即归档一个事务（ADR-0012 D3）；函数级见 §3 D 组 |
| `wakeflow-demand-publication-service.mjs` | 1925 | Demand 初次发布：计划、发布、恢复 | `governance/demand/publication/demand-event-sourcing-publication-*.ts`、`capabilities/demand/service.ts` | recut | 认领即创建（ADR-0011） |
| `wakeflow-demand-state-service.mjs` | 2197 | 单根事务：journal → artifact → event → 快照 → 闭包检查 | `kernel/append-command.ts`、`kernel/publication-transaction.ts`、`governance/demand/event-sourcing/demand-file-event-store.ts`、`demand-event-stream-commit.ts` | recut |  |
| `wakeflow-target-result-authority.mjs` | 551 | 结果只读权威投影：current 选择器、双向闭包、ready/blocked/missing/closed | `governance/result/*`、`capabilities/result-review/decide.ts`（`allowedDecisions`） | recut |  |
| `wakeflow-result-review-orchestration.mjs` | 2428 | 导入结果、group/trace 视图、评审候选、决定提交、Controller 回传 | `capabilities/result-review/service.ts`（导入、检查投影、两个决定工具）、`governance/review/*`、回调 `governance/delivery` | recut | 回调随导入返回（ADR-0012 D1） |
| `wakeflow-evidence-importer.mjs` | 1061 | 受管证据 preview/apply/recover 编排 | `capabilities/evidence/*`、`governance/evidence/managed-evidence-capture-planning-service.ts`、`managed-evidence-publication-application-service.ts` | recut |  |
| `wakeflow-evidence-records.mjs` | 1171 | 证据 manifest 合同、身份、严格读取、库存诊断 | `governance/evidence/managed-evidence-manifest.ts`、`managed-evidence-record-tree-plan.ts`、`managed-evidence-event-sourcing.ts` | recut |  |
| `wakeflow-evidence-tree.mjs` | 1280 | 来源捕获（类型、容量、隐私扫描）、stage/final 树、残留恢复 | `governance/evidence/managed-evidence-publication-stage-materializer.ts`、`kernel/privacy-scan.ts` | recut | `controller-confirmed` 内容审阅（§13.90） |

### E 投递、窗口、租约与宿主激活

| 旧模块 | 行数 | 旧职责 | 新 owner | 判定 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `wakeflow-delivery-orchestration.mjs` | 3780 | 投递五阶段：plan、apply、claim、outcome、rearm | `capabilities/delivery/{decide,service}.ts`、`governance/delivery/*`、`kernel/work-claims.ts` | recut | 三段并成 `prepare_delivery` 一次调用；结局由 hook 记录派生（ADR-0012 D2、§13.84） |
| `wakeflow-transport-records.mjs` | 2319 | 四类不可变传输记录：group、packet、envelope、run | 投递信封与 run 是 Demand 事件流里的事件；packet 内容由任务包派生成 prompt 骨架 | recut | group/packet 不再是独立文件（能力卡 6、ADR-0012 D2） |
| `wakeflow-transport-retention.mjs` | 866 | 归档后的传输修剪 | 完成即归档删除活动根；pod close 删回执目录 | recut | D17 |
| `wakeflow-transport-store.mjs` | 2197 | 传输四目录树的物理 owner 与库存 | 同上 | recut |  |
| `wakeflow-window-binding-records.mjs` | 449 | 窗口绑定记录 codec | `workspace/window-runtime/wakeflow-window-host-binding*.ts` | recut |  |
| `wakeflow-window-binding-service.mjs` | 1765 | 绑定登记、替换、库存 | `capabilities/endpoint/*`、`workspace/window-runtime/wakeflow-window-host-binding-store*.ts` | recut | hook 记录为握手基础证据（ADR-0009） |
| `wakeflow-window-lease-records.mjs` | 605 | 窗口协调租约记录 | `kernel/work-claims.ts`（工作声明加围栏令牌） | recut | ADR-0009；过期只开恢复 |
| `wakeflow-window-lease-service.mjs` | 1736 | 租约获取、释放、库存 | `capabilities/endpoint`（release-claim）、`kernel/work-claims.ts` | recut |  |
| `wakeflow-keep-live-records.mjs` | 625 | keep-live 记录 | 无 | dropped | 能力卡 10 Q1、TSD-12 |
| `wakeflow-keep-live-service.mjs` | 1770 | keep-live owner | 无 | dropped | 同上 |
| `wakeflow-host-activation-gate.mjs` | 618 | 宿主激活门与切换观察 | 无 | dropped | 激活范围随 unattended 推迟（能力卡 10 Q2，I3）；切换观察随迁移放弃（ADR-0008） |
| `wakeflow-host-activation-scope.mjs` | 273 | 激活范围记录 | 无 | dropped | 同上 |
| `wakeflow-host-decommission-result.mjs` | 451 | 宿主退役结果记录 | 窗口替换/退役在 `wakeflow_register_window_binding` 的 `replace` | recut | I3：decommission 留在窗口替换 |

### F Pod、观察与公共运行时

| 旧模块 | 行数 | 旧职责 | 新 owner | 判定 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `wakeflow-pod-records.mjs` | 938 | Pod 证据 codec：scope、launch、物化、创建回执、恢复、Test access、close | `capabilities/pod/*`、`governance/pod/*`、`kernel/pod-worktree-receipts.ts` | recut | Design 交接与 test-access 放弃（ADR-0010、矩阵行 29） |
| `wakeflow-pod-service.mjs` | 7062 | Pod 物化、登记、恢复、关闭的编排 | 同上；worktree 由宿主原生能力创建，pod 四状态由回执派生 | recut | 场景 `card-10/pod-lifecycle` |
| `wakeflow-observability-v3.mjs` | 2475 | 观察：config 视图、storage 视图、status、verify | `capabilities/observation/*`、`governance/observation/*` | recut | storage 视图放弃（ADR-0006）；14 门 verify（G6 补回 window-runtime-projection，gate-log §13.111）；函数级见 §3 F 组 |
| `wakeflow-preservation.mjs` | 3151 | `.wakeflow-local/audit/preserved` 的保全计划与释放 | 无 | dropped | 能力卡 8 Q6、D33 |
| `wakeflow-public-v3-runtime.mjs` | 1060 | 公共 v3 领域处理器与变更后活动投影刷新 | `entrypoints/wakeflow-public-mcp-*.ts`、`kernel/command-shell.ts`、`governance/observation/active-projection-refresh.ts` | recut |  |
| `scripts/data/wakeflow-legacy-classifier-catalog.json` | 22698 | legacy 分类目录 | 无 | dropped | ADR-0008 |

### G 迁移与 legacy

| 旧模块 | 行数 | 旧职责 | 新 owner | 判定 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `wakeflow-migration-apply.mjs` | 1238 | 显式迁移 T08 组合层 | 无 | dropped | ADR-0008 决定 1；D19、D39、D40 |
| `wakeflow-migration-config-owner.mjs` | 916 | 迁移配置 owner | 无 | dropped | 同上 |
| `wakeflow-migration-host-decommission.mjs` | 1064 | 迁移宿主退役合同 | 无 | dropped | 同上 |
| `wakeflow-migration-inventory.mjs` | 1661 | 迁移库存 | 无 | dropped | 同上 |
| `wakeflow-migration-plan.mjs` | 2500 | 迁移计划 | 无 | dropped | 同上 |
| `wakeflow-migration-production.mjs` | 920 | 生产迁移 | 无 | dropped | 同上 |
| `wakeflow-legacy-archive-records.mjs` | 621 | legacy 归档记录 | 无 | dropped | 同上 |
| `wakeflow-legacy-archive-transform.mjs` | 2200 | legacy 归档转换 | 无 | dropped | 同上 |
| `wakeflow-legacy-classifier.mjs` | 1984 | legacy 单源分类器 | 无 | dropped | 同上 |
| `wakeflow-legacy-owner-drain.mjs` | 3420 | 迁移前业务静止证明 | 无 | dropped | 同上 |

### H 入口、MCP 与进程

| 旧模块 | 行数 | 旧职责 | 新 owner | 判定 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `scripts/wakeflow-bootstrap.mjs` | 927 | 显式迁移的 backend 组合入口 | 无 | dropped | ADR-0008 |
| `scripts/wakeflow-cli.mjs` | 249 | MCP 工具的 JSON-stdin 镜像 CLI | 无：公共面只有 MCP 工具 | dropped | ADR-0002 公共面；§13.101 D1 不发 `scripts/`；冒烟改走 MCP |
| `scripts/wakeflow-setup.mjs` | 228 | 维护的 JSON-stdin 入口 | `wakeflow_maintain_workspace` | recut | §13.101 D1：setup 就是维护工具 |
| `scripts/wakeflow-smoke.mjs` | 499 | 已发布制品的四幕冒烟 | `tooling/artifacts/smoke-plugin-artifacts.ts`（六幕，仓库外副本） | recut | 能力卡 10 Q8 |
| `scripts/wakeflow-validate.mjs` | 6626 | 已发布制品的 17 类静态校验 | `tooling/artifacts/check-plugin-artifacts.ts`、`tests/artifacts/*` | recut | 工具数量由目录派生（Q8） |
| `lib/wakeflow-mcp-tools.mjs` | 968 | 公共 MCP 工具组合层：路由、脱敏错误、维护与证据路由 | `entrypoints/wakeflow-public-mcp-{catalog,server,tool,shared-executors}.ts`、`kernel/tool-registry.ts`、`kernel/command-shell.ts` | recut | 20 个工具、Schema 自包含、`tools/list` 体积预算（TSD-13） |
| `lib/wakeflow-process.mjs` | 273 | observability 的六种只读 git 查询 | `governance/observation/repository-pointer-observation.ts`（直接读 `.git` 指针，不 spawn）、`foundation/git/*` | recut | 能力卡 9 Q1：不 spawn git |
| `mcp/server.cjs` | 345 | 手写 stdio JSON-RPC 传输与工具分派 | `entrypoints/wakeflow-mcp-stdio.ts`（官方 `@modelcontextprotocol/server`） | recut |  |
| `bin/wakeflow-mcp` | 100 | 选择 Node 20+ 的 shell 启动器 | 无：`.mcp.json` 直接 `node`，制品自带依赖闭包 | dropped | §13.101 D1、D5；引擎 Node 24 |
| `bin/wakeflow-bootstrap` | 99 | 迁移 backend 的 shell 启动器 | 无 | dropped | ADR-0008 |

### I Claude Code 独有

| 旧模块 | 行数 | 旧职责 | 新 owner | 判定 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `claude: wakeflow-claude-activation-scope.mjs` | 331 | Claude 激活范围观察 | 无 | dropped | 能力卡 10 Q2，I3 |
| `claude: wakeflow-claude-activity.mjs` | 2627 | tmux 活动监视与安全 prompt 临时文件 | 无；宿主 hook 观察取代 | dropped | 能力卡 10 Q3、Q4，ADR-0009 |
| `claude: wakeflow-claude-decommission.mjs` | 662 | Claude 窗口退役计划与执行 | `wakeflow_register_window_binding` 的 `replace`；宿主关闭动作由 Agent 执行 | recut | TSD-12 |
| `claude: wakeflow-claude-host.mjs` | 357 | Claude 宿主命令路由（target-delivery、controller-return） | 无；宿主动作由 Agent 按技能执行 | dropped | TSD-12 |
| `claude: wakeflow-claude-lifecycle.mjs` | 1101 | tmux 窗口启动、恢复、改标题、排列 | 启动意图内容 `workspace/window-runtime/wakeflow-window-launch-intent.ts` 加 Claude 身份 profile；执行由 Agent | recut | TSD-12；技能文本 `{{windowLaunch}}` |
| `claude: wakeflow-claude-locator.mjs` | 2030 | tmux 坐标 locator 与逐窗口宿主操作互斥 | 坐标随绑定由 Agent 观察交回；互斥语义在工作声明 `kernel/work-claims.ts` | recut | D23、D30 |
| `claude: wakeflow-claude-migration-decommission.mjs` | 806 | 迁移退役 | 无 | dropped | ADR-0008 |
| `claude: wakeflow-claude-migration-effect.mjs` | 659 | 迁移宿主效果 | 无 | dropped | ADR-0008 |
| `claude: wakeflow-claude-pod-host.mjs` | 410 | Claude pod 会话物化适配 | `capabilities/pod/*`；`claude --worktree` 由 Agent 执行 | recut | ADR-0010 |
| `claude: wakeflow-claude-settings.mjs` | 2662 | settings.json 允许规则与 statusline 资产 owner | `hosts/claude-code/claude-code-portable-settings-*.ts`、`claude-code-statusline-*.ts` | recut | 只写 MCP 允许规则与 statusLine 一键（能力卡 1 F1.6） |
| `claude: wakeflow-claude-transport.mjs` | 1244 | 粘贴与回读的宿主 effect owner | 无；Agent 粘贴，落地由 hook 记录证明（`record_delivery_outcome`） | dropped | TSD-12、ADR-0009 |
| `claude: wakeflow-host-artifact-checks.mjs` | 150 | Claude 发布产物校验接缝 | `tooling/artifacts/check-plugin-artifacts.ts` | recut |  |

### J Codex 独有

| 旧模块 | 行数 | 旧职责 | 新 owner | 判定 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `codex: wakeflow-codex-activation-scope.mjs` | 143 | Codex 激活范围观察 | 无 | dropped | 能力卡 10 Q2，I3 |
| `codex: wakeflow-codex-decommission.mjs` | 247 | Codex 窗口退役 | `wakeflow_register_window_binding` 的 `replace` | recut | TSD-12 |
| `codex: wakeflow-codex-migration-decommission.mjs` | 676 | 迁移退役 | 无 | dropped | ADR-0008 |
| `codex: wakeflow-codex-migration-effect.mjs` | 626 | 迁移宿主效果 | 无 | dropped | ADR-0008 |
| `codex: wakeflow-codex-pod-host.mjs` | 421 | Codex pod 线程物化适配 | `capabilities/pod/*`；线程由 Agent 创建 | recut | ADR-0010 |
| `codex: wakeflow-host-artifact-checks.mjs` | 138 | Codex 发布产物校验接缝 | `tooling/artifacts/check-plugin-artifacts.ts` | recut |  |

### K 技能与模板文本

| 旧模块 | 行数 | 旧职责 | 新 owner | 判定 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `skills/` |  | 旧技能文本（design、governance、target-craft、test 等） | `assets/agent-text/`：四份技能、六份 references、四个命令 | recut | §13.99 D1；诚实性门 `tests/artifacts/agent-text-honesty.test.ts` |
| `template-sources/` |  | Demand 进度页模板源 | 投影模板是代码 | dropped | §13.101 D1 |


## 3. 第二轮：导出函数级核对

> 2026-09-21 起按用户裁决（gate-log §13.107 D1–D4）逐模块核对**导出函数**：粒度到函数、先核仍在运行时路径上的组、错误形状/磁盘布局/消息文本差异不算 gap（TSD-03）、每个模块组一批提交。判定词汇同 §1；`gap` 修完改判并记处置。

### B 配置、布局与维护（2026-09-21，gate-log §13.107）

| 旧模块 | 导出函数 | 行为分支 | 新 owner | 判定 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `wakeflow-config-v3.mjs` | `parseWakeflowConfigV3` | 封闭字段集、typed id、引用与基数、residue 去重与 childOnly、tmux 名称长度与控制字符、socket 名词法、regex 编译、role map 键 | `configuration/wakeflow-config.ts` 加 JSON Schema | recut | `interfaceLanguage: auto` 放弃（`presentation.language`）；`pods[]` 新增 |
| 同上 | `readWakeflowConfigV3` | 便利文件读取 | 无 | dropped | 快照是唯一读取路径 |
| 同上 | `serializeWakeflowConfigV3`、`wakeflowConfigV3Digest` | 固定字段顺序两空格缩进、规范 JSON 摘要 | `wakeflow-config-document.ts`、`computeWakeflowConfigDigest` | covered |  |
| 同上 | `buildWakeflowConfigV3Indexes` | by-id 索引、角色单例、`resolveWindowRoot`、`hostPreferences`、`ledgerPlacement` | `buildWakeflowConfigIndexes`（加 pod 作用域）；窗口根解析在 `wakeflow-window-launch-intent.ts`；宿主偏好由 `capabilities/endpoint/service.ts` 的执行说明直接读 `hosts`；ledger 放置由 root placement 报告 | recut |  |
| 同上 | `explainWakeflowConfigV3` | 诊断视图 | `wakeflow_status.config`（programId、displayName、language、configDigest、pods/windows/repositories 计数） | recut | `fixedProtocolRoots` 与 source 标注放弃 |
| 同上 | 配置词汇 | `governance.audit.preservedReviewAfterDays`、`governance.validation.runtimeResidue`、`repositories[].validation.residueExceptions` | schema 与解析器保留，两个实现里都没有行为消费者（旧消费者 preservation/legacy transform 已放弃；runtimeResidue 旧实现亦无消费者；residueExceptions 旧只做计数） | covered | 非 gap；是否删词汇留待用户裁决 |
| `wakeflow-config-v3-snapshot.mjs` | `loadWakeflowConfigV3Snapshot` | 稳定 no-follow 读取、单链接、1 MiB、UTF-8/JSON/严格解析、placement、源摘要与语义摘要、ledger 绝对根 | `wakeflow-config-authority-snapshot.ts`（另加 0644 与 euid 政策） | covered |  |
| `wakeflow-config-v3-owner.mjs` | `inspect/plan/validate` fresh、`createWakeflowConfigV3OwnerMutationParticipant` | absent-only、0644、1 MiB、canonical bytes、stage 命名空间分类（prepared/committed/existing/unsafe）、hard-link 不覆盖发布、terminal closure 逐字节核对 | `wakeflow-config-authority-publication.ts`（不替换创建 + 读回）；预览 `fresh-config-present`；prepared/committed 残留由 foundation 原子写自恢复，未知残留 `stage-recovery-required` | recut |  |
| 同上 | `inspect/plan/validate` reconfigure、`createWakeflowConfigV3ReconfigureMutationParticipant` | current/ready-update 判定、predecessor hard link + rename、source identity 指纹、恢复态准入、program 身份不变 | `wakeflow-config-authority-replacement.ts`（锁内 CAS、幂等 current、`program-identity`、读回）、`-recovery.ts`（非活动锁退役、stage 归属核对） | recut | predecessor 链接放弃：journal 前向恢复替代 |
| `wakeflow-layout-descriptor.mjs` | `createWakeflowLayoutDescriptor` | 静态表面全集（工作区、active、local、shared、宿主运行时、ledger、支撑面、仓库） | 静态资源矩阵、各 resource catalog、host capability layout authority；逐项核对见 gate-log §13.107 | recut | 本轮补 **G2**（支撑面 `drafts/`、`harnesses/`、`fixtures/`）与 **G3**（支撑面 `.gitignore` 托管块）；`audit/preserved`、`temp`/`activity` 目录按宿主 profile 开关；仓库 `.gitignore`/settings 授权按能力卡 1 不实现 |
| 同上 | `wakeflowLayoutEntry`、`eventOnlyWakeflowLayoutEntries`、`freshWakeflowLayoutEntries` | 查询 | 直接在矩阵上过滤 | dropped |  |
| 同上 | `validateWakeflowLayoutPlacements`、`validateWakeflowConfigRootPlacements` | 词法重叠、realpath 重叠、逐段 symlink 拒绝、缺失根保留 | `wakeflow-config-root-placement.ts` | covered |  |
| `wakeflow-local-layout.mjs` | `planWakeflowLocalLayout` | `.wakeflow-local` 静态分区 | 矩阵加 `kernel/layout.ts` | recut |  |
| `wakeflow-local-layout-realization.mjs` | `planWakeflowLocalLayoutRealization`、participant | fresh 创建；reconcile 静态目录缺失/模式漂移修复 | 本轮 **G4**：`inspectWakeflowHostCapabilityLayout` + `ensureWakeflowHostCapabilityLayout`（只看声明目录，不枚举运行内容）；共享协调布局 ensure 已有 | recut | 维护协议根缺失仍阻塞（gate 依赖）；模式漂移只报告（`*-conflict`） |
| 同上 | `projectWakeflowLocalLayoutStorage`、`verifyWakeflowLocalLayoutInspection` | storage 视图 | 无 | dropped | ADR-0006 |
| `wakeflow-fresh-initialize.mjs` | `createWakeflowFreshDesiredModel` | selection → config | `wakeflow-fresh-config-selection.ts`（ID 由 selection 摘要派生） | recut |  |
| 同上 | `inspectWakeflowFreshLocalEligibility` | 十种 local footprint 分类 | core layout `freshCompatible` + `fresh-local-not-bootstrap-prefix` 等 | recut | 分类粒度放弃，都阻塞 |
| 同上 | `planWakeflowFreshInitializeBackbone` | fresh 主干 | 预览 fresh 分支（17 步） | recut |  |
| 同上 | `planWakeflowMigrationMaterializationBackbone` | 迁移 | 无 | dropped | ADR-0008 |
| `wakeflow-reconcile.mjs` | `planWakeflowReconcileBackbone` | 自动修复：local 静态目录、支撑面目录、ledger 目录与索引、`.gitignore` 与记忆托管块、active 布局与 TODO 板、投影、窗口投影、Claude settings；只报告：窗口投影 unsafe/unavailable、配置非 current、托管块手改 | 本轮 **G4** 后：活动布局与看板、ledger 根与容器、宿主 capability 目录、支撑面根与 scaffold、支撑面与工作区 `.gitignore`、程序/外部指令、支撑面记忆、共享协调布局；Claude settings/statusline 由宿主 contribution；只报告：`window-runtime-missing`、`*-conflict`、`*-envelope`、`maintenance-protocol-*` | recut | 窗口投影 stale/missing 的显式报告未接线，留给 F 组 |
| `wakeflow-reconfigure.mjs` | `diffWakeflowConfigV3Topology` | 拓扑差异 | 预览 `sameSemanticSection`：topology/storage/hosts/pods 任一变化即 `reconfigure-layout-change-unsupported` | recut | 旧版允许支撑面移动等；新版按能力卡 1 全部拒绝 |
| 同上 | `planWakeflowReconfigureBackbone` | reconfigure 主干 | 预览 reconfigure 分支 + 权威替换 | recut | `ledger-root-requires-explicit-migration` 放弃 |
| `wakeflow-maintenance-action-composition.mjs` | `validate/createWakeflowConfirmedActionPlan`、`assertWakeflowMaintenanceLocalTransitionScope`、participant | 确认计划摘要、锁内范围复验、组合 participant | 执行 intent `planDigest`、gate 重验、执行事务 | recut |  |
| `wakeflow-maintenance-action-runtime.mjs` | `create/loadWakeflowMaintenanceActionHandlers` | 动态 handler 装载、bundle/language | 步骤执行器闭合分派 + 宿主 capability | recut | 模板 bundle 放弃（§13.101 D1） |
| `wakeflow-maintenance-coordinator.mjs` | `validateWakeflowMaintenanceRequest`、`createWakeflowMaintenanceCoordinator` | action/mode/planDigest/上限校验、preview/apply/recover | `capabilities/workspace/maintain-workspace.ts` | recut |  |
| `wakeflow-maintenance-plan.mjs` | `create/validate/digest/isApplicable` | 计划形状、排序、blocker、preserved/deferred/authorization | 执行计划与 intent（排序、blockerCodes、planDigest） | recut | preserved/deferred/authorization 段放弃 |
| `wakeflow-managed-content.mjs` | `planWakeflowManagedContent` | 程序记忆托管块、仓库记忆托管块、支撑面记忆整文件/托管块、程序 ignore、支撑面 ignore、仓库 ignore（授权）、用户改动即 blocked、`remove-managed-block` | 程序指令、外部指令（G1）、支撑面记忆、工作区 `.gitignore`、支撑面 `.gitignore`（**G3** 本轮） | recut | 仓库 ignore 授权列表固定为空；`remove-managed-block` 不需要（reconfigure 拒绝 topology 变化） |
| 同上 | `validate/project/participant` | 计划校验与投影 | 预览步骤与执行器 | recut |  |
| `wakeflow-support-materialization.mjs` | `planWakeflowSupportMaterialization` | 整文件记忆、`drafts/`/`harnesses/`/`fixtures/` ensure、external managed-block 组件 | support catalog（含 scaffold，**G2**）、support memory authority、外部指令（G1） | recut |  |
| `wakeflow-support-surface-owner.mjs` | `plan/validate/project/participant` | 根 fresh 严格不存在、reconcile 目录修复、mode drift/unsafe 报告 | catalog + `inspectWakeflowManagedSupportRoot`/`materializeWakeflowManagedSupportRoot` + 预览步骤 | recut |  |
| `wakeflow-tracked-materialization.mjs` | `createWakeflowTrackedMaterializationParticipant` | stage→commit→cleanup 与恢复 | foundation durable directory/atomic file 物化 | recut |  |
| `wakeflow-workspace-mutation.mjs` | `inspectWakeflowMaintenancePersistenceBudget` | journal 字节预算预检 | 无独立预检：预览合同 256 步上限与原子写入字节上限隐含 | dropped |  |
| 同上 | `assertWakeflowMutationContext`、`inspectWakeflowWorkspaceMutation`、`withWakeflowRuntimeMutation`、`runWakeflowMaintenanceMutation`、`recoverWakeflowWorkspaceMutation` | gate、journal、恢复代际 | maintenance gate、journal store、执行事务、`mode: recover` | recut | ADR-0013 |
| `wakeflow-host-settings-assets-owner.mjs` | `loadWakeflowHostSettingsAssetsAdapter` | 动态 adapter 装载 | 无 | dropped | 宿主 capability 编译期固定 |
| 同上 | `planWakeflowHostSettingsAssetsOwner`、participant | portable settings 多根、statusline 资产、local settings、仓库授权 | `hosts/claude-code/claude-code-maintenance-capability.ts` contribution 与 executor | recut | 仓库根 settings 授权不实现 |
| `wakeflow-host-capability.mjs` | `normalizeWakeflowHostCapabilities`、`normalizeWakeflowHostCapabilityProfile` | 能力窄视图 | `workspace-host-resource-profile.ts` 与两份宿主 profile | recut |  |
| `wakeflow-rule-model.mjs` | 三个 render | 程序/仓库/支撑角色记忆正文 | 程序指令、外部指令（仓库与外部支撑面）、支撑面记忆 | recut | G1 |

### C 活动投影、账本、TODO 与归档（2026-09-21，gate-log §13.108）

| 旧模块 | 导出函数 | 行为分支 | 新 owner | 判定 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `wakeflow-active-foundation.mjs` | `planWakeflowActiveFoundation`、`validate`、`project` | 活动根、current、全局 TODO 板三资源的 current / create-managed / blocked 与 aggregate 投影 | 静态资源矩阵（活动根与 current 由 `materialize-active-layout`），看板由 `initialize-requirement-board`；reconcile 缺失修复见 G4 | recut | TODO 板放弃（ADR-0011） |
| 同上 | `inspectWakeflowFreshTodoTransitionAuthority` | fresh 事务里 TODO 权威的 absent / strict / committed-pair 阶段 | 无；看板初始化用 foundation 原子写自恢复 | dropped |  |
| 同上 | `createWakeflowActiveFoundationMutationParticipant` | ready plan 绑定 action/config 重建私有字节，提交交 tracked materialization | 执行器 `executeActiveLayout`、`executeRequirementBoardInitialization` 与 journal 恢复 | recut |  |
| `wakeflow-active-projector.mjs` | `planWakeflowActiveProjectionMaintenance`、`validate`、`project`、participant | 维护聚合里投影文件集合的 create / update / current；confirmed operation 逐项覆盖；missing、unsafe 不接受 | fresh：`publish-fresh-active-workspace-projection`（`wakeflow-active-fresh-projection.ts`）；之后每个维护 apply 与九个 capability 的变更事务收尾 `afterMutationRefresh` 重算（`governance/observation/active-projection-refresh.ts`） | recut |  |
| 同上 | `inspectWakeflowActiveProjection` | 零写入，三诊断轴（sourceHealth / storageHealth / projectionStatus），来源损坏只返回脱敏轴 | `observeProjectionTargets` + `projectionFreshness`（`wakeflow_status.projection`，verify 门 `active-projection`） | covered |  |
| 同上 | `rebuildWakeflowActiveProjection` | 只重建已证明 managed 的目标，authority 与未知字节不动，unsafe 零写 | `kernel/active-projection.ts`（unsafe 整轮零写，§13.94–§13.96）；旧公共 runtime 在每个公共操作后调用 rebuild 的位置对应 `afterMutationRefresh` 的消费者 | covered |  |
| `wakeflow-ledger-materialization.mjs` | `planWakeflowLedgerMaterialization`、`validate`、`project`、participant | 五目录 current / create-managed / resolve-conflict；四个 Markdown 投影 update-managed（重建） | `governance/ledger/ledger-authority-layout.ts` + `ledger-authority-store.ts` initialize；fresh `materialize-ledger-layout`；reconcile 缺失容器或整根重建（G4 D6），mode 漂移 `ledger-layout-conflict` 只报告 | recut | Markdown 投影放弃，见下一行 |
| `wakeflow-ledger-projector.mjs` | `buildEmptyLedgerProjection`、`inspectLedgerProjectionSource`、`buildLedgerProjection`、`writeLedgerProjection` | 四个 ledger Markdown 索引的确定性投影 | 无；看板索引 `board/index.md` 由内核 `renderRequirementBoardIndex` / `publishRequirementBoardIndex` / `refreshRequirementBoardIndex` 重写 | dropped | 能力卡 3 §3.5 |
| 同上 | `commitLedgerRecordAndProject` | 记录提交后重投影 | `ledger-record-publisher.ts` 发布 + 需求发布/终态收尾 `refreshBoardIndexQuietly` | recut |  |
| `wakeflow-ledger-records.mjs` | `validateLedgerRecord` | 三家族闭合、成员 / source / transport / typed ID 跨字段关系 | contracts JSON Schema：需求记录与 `demand-archive-manifest` | recut | confirmation 家族取消 |
| 同上 | `ledgerRecordRelativeRoot` | 由已验证身份推导相对根，不接受自报 family | `ledger-authority-paths.ts`（需求记录）、`demandArchiveRef` / `demandArchivesRootRef`（归档包） | covered |  |
| 同上 | `ledgerMutationLockPath` | ledger 外侧短时互斥，串行本机物理发布 | `ledgerRecordPublicationLockRef`（`transactions/<recordId>.lock`，`withRootedExclusiveFileLock`）；归档包不加锁，靠候选目录 rename 的 `destination-exists` 竞态判定 | recut |  |
| 同上 | `loadLedgerRecord` | 严格加载：未知 residue、路径别名、mode / owner / link 漂移、读取竞态 | `ledger-authority-reader.ts`（记录）；`readArchiveManifest` / `readArchivePayload`（归档：清单加负载逐文件摘要复核） | recut |  |
| 同上 | `findDemandArchiveRecord` | 锁内扫描完整 archive authority，按 demand（可选 archiveId）定位唯一记录，冲突失败关闭 | `findLatestDemandArchive`（`capabilities/demand/archive.ts`）、`locateLatestDemandArchive`（观察）：归档包按 stream revision 命名取最新；同 Demand 多个归档包是合法历史（continue 后再次完成），不再是冲突 | recut |  |
| 同上 | `loadLedgerMemberBytes` | 先闭包再取一个成员并复核摘要 | `readArchivePayload` | covered |  |
| 同上 | `createLedgerRecord` | 创建或幂等读取；异 stage 或同身份异字节阻断 | `ledger-record-publisher.ts`（意图 / 存储 / 恢复三段；同字节幂等、异字节 conflict）；归档 `sealDemandArchive`（同负载摘要 `current`，异负载 `archive-conflict`） | covered |  |
| 同上 | `createLedgerMigrationArchiveRecord` | 迁移 owner 的 legacy archive 根共存 | 无 | dropped | G 组迁移放弃 |
| 同上 | `createLedgerMemberReference`、`resolveLedgerMemberReference` | 无绝对路径的成员引用；解析时复核 record / member 摘要、family、role | 需求记录引用 `recordRef` + `recordDigest`（claim state、Demand 身份、归档清单 `package`）；归档成员没有独立引用，清单 `manifestDigest` 钉住整包 | recut |  |
| `wakeflow-window-runtime-projector.mjs` | `inspectWindowRuntimeProjections` | 从落盘 config 与宿主 binding authority 只读盘点 current / stale / missing / unsafe | `planWakeflowWindowRuntimeProjectionMaintenance`（只读，产出操作与 blocker）+ `inspectWakeflowWindowRuntimeProjectionDocument`（G5） | recut |  |
| 同上 | `inspectWindowRuntimeProjectionsForLayout` | 维护候选模型（fresh / reconfigure / reconcile）与观察的 layout 视角盘点；旧 `wakeflow_status` / `wakeflow_verify` 的 `window-runtime` 域（health、`window-runtime-projection-not-current`）由它供数 | 维护：fresh `publish-unregistered-window-runtime`，reconcile G5；观察：`wakeflow_status` 只报 binding 身份，`wakeflow_verify` 没有 window-runtime 门 | gap | **G6**：观察域归 F 组，留到 F 组处置 |
| 同上 | `planWindowRuntimeProjectionMaintenance`、`validate`、`project`、participant | portable 计划（不含 workspaceRoot）、confirmed 覆盖、aggregate 投影 | fresh：`wakeflow-window-runtime-fresh-publication.ts`；reconcile：宿主 capability 操作 `window-runtime-projection:<windowId>`（sourceDigest / targetDigest 钉住，执行时重算不符即 `plan` 失败） | recut |  |
| 同上 | `rebuildWindowRuntimeProjections` | 运行时事务里把 missing / stale 收敛到当前派生结果；unsafe 原样；部分提交后 source 变化只在可证明安全时释放 | 登记 / 换代 / 退役后 `publishProjectionDocument`（endpoint service）；reconcile G5（本轮修）；source 竞态由维护 gate 的 config 摘要与操作 targetDigest 拒绝 | recut | 本轮 G5 前 reconcile 不重建 |
| `wakeflow-window-runtime-records.mjs` | `createWindowRuntimeProjection`、`validateWindowRuntimeProjection` | 域字段闭合、kind / schemaVersion、projectionDigest 覆盖自身以外 | `wakeflow-window-runtime-{registered,unregistered}-projection.ts`（`compile*ProjectionEntry`，projectionDigest 同法） | covered |  |
| 同上 | `windowRuntimeProjectionCanonicalBytes`、`windowRuntimeProjectionDigest` | canonical JSON 加 LF、字节 CAS | `documentDigest`（文档字节）与 `projectionDigest` | covered |  |
| 同上 | `windowRuntimeProjectionRef` | 只接受协议宿主目录名加 typed windowId | `wakeflow-window-runtime-paths.ts`（resourceRef 由宿主 profile 派生） | covered |  |
| `wakeflow-todo-service.mjs` | `createTodoBoardIfAbsent`、`inspectTodoBoard`、`renderTodoBoard`、`scanTodoBoard` | 唯一空板、锁内读取、13 列 codec | `materializeRequirementBoardRoot`、`listRequirementClaimStates`、`renderRequirementBoardIndex` / `publish` / `refresh`（索引是派生投影，不是权威） | recut | ADR-0011 |
| 同上 | `appendTodoRow` | 摄入 pending / parked 行 | `capabilities/requirement/*` 发布需求包即上板（`createRequirementClaimState` pending / parked） | recut |  |
| 同上 | `planTodoClaim`、`inspectTodoClaim`、`claimTodoRow` | 以 intake 快照 first-commit CAS 挂载到一个 Demand | `claimRequirementPackage` + `replaceRequirementClaimStateFile`（revision / previousStateDigest CAS）；Demand create 的 `deriveCreationBlockers` | recut |  |
| 同上 | `inspectTodoClaimForRecovery`、`recoverTodoRowClaim` | 跨资源恢复 seam | Demand create 发布事务的 journal 恢复 | recut |  |
| 同上 | `inspectTodoArchiveLineage` | 从 claimed 行逆推 intake lineage | claim state 链（`previousStateDigest`）与归档清单 `package.recordRef` / `recordDigest` | recut |  |
| 同上 | `archiveTodoRow`、`recoverTodoRowArchive` | 归档回执后删除行、前向恢复 | `archiveRequirementClaim`（`settlePackage`，已到位即 current）；取消走 `withdrawRequirementClaim` | recut |  |
| `wakeflow-todo-table.mjs` | `parseMarkdownRow`、`formatTodoRow` | TODO 行级 Markdown codec | 无（看板索引只渲染不回读） | dropped |  |
| `wakeflow-business-archive-records.mjs` | `validateBusinessArchiveSummary`、`TransportSummary`、`TodoHistory`、`Plan`、`Transaction` | 四类记录闭合、跨记录身份、terminalAdmission / archiveTransition | `demand-archive-manifest.schema.json`（terminalEvent、package、verify、payload、worktree、manifestDigest）；transport 汇总与 TODO 历史不再是独立记录：投递回执随负载整树归档，需求包 lineage 在清单 `package` | recut |  |
| 同上 | `businessArchiveCanonicalBytes`、`businessArchiveDigest`、`businessArchiveByteDigest` | canonical 字节与摘要 | `renderJson` + `computeCanonicalJsonSha256Digest`（`manifestDigest`、payload `treeDigest`） | covered |  |
| 同上 | `assertBusinessArchivePortable` | 拒绝式隐私准入：凭证、裸 UUID、绝对路径；结构字段豁免 | `payloadPrivacyBlockers`（`capabilities/demand/decide.ts`）：只拒凭证类（`CREDENTIAL_PRIVACY_FINDING_KINDS`），路径与标识由负载自带（能力卡 8）；verify 门 `payload-privacy` | recut |  |
| `wakeflow-business-archive-service.mjs` | `planDemandBusinessArchive` | 双锁内零写入重建终态闭包：artifact / evidence 元组、test card 权威、生命周期事件链、pod 归档门、transport 交叉闭包 | `planTerminal`（`capabilities/demand/lifecycle.ts`）：后验收路线 `completion-preflight`、`evaluateVerifyGates`（config-authority、ledger-layout、demand-root-audit、board-claim、work-claims-released、append-candidates-clear、evidence-integrity、payload-privacy、research-evidence）、包 claim、`archive-conflict`；一 pod 一 Demand 在 `deriveCreationBlockers` / `deriveContinueBlockers` | recut |  |
| 同上 | `commitDemandBusinessArchive` | 终态 CAS 加归档身份提交：持久化事务、ledger 发布、TODO 消费、sidecar / tombstone 脱离 current | `applyTerminal`：journal → 终态事件（`expectedStreamRevision` / `expectedStateDigest`）→ `sealDemandArchive`（候选整树 rename，同负载 `current`）→ `settlePackage` → `releaseClaims`（取消）→ `retireDemandRoot`（负载摘要相等才删）→ 删 journal → 刷新看板索引 | recut | tombstone 前缀放弃：活动根在归档后直接退役 |
| 同上 | `recoverDemandBusinessArchive` | 不接受新决定，按已持久化事务或 authority 前向收敛 | `recoverTerminal`：有 journal 重放；无 journal 而归档已在即 recovered；活动根仍在而无 journal 报 `journal-absent` | covered |  |
| 同上 | `inspectDemandBusinessArchive` | 只读加载 exact authority 并复验业务、transport 与定位投影 | `wakeflow_status` / `wakeflow_verify` 带 demandId：`locateLatestDemandArchive` 的归档回执（outcome、archiveRef、terminalEvent、manifestDigest） | recut | 旧 transport retention 对它的消费在 E 组核 |

### D Demand、结果、评审与证据（2026-09-21，gate-log §13.109）

| 旧模块 | 导出函数 | 行为分支 | 新 owner | 判定 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `wakeflow-demand-artifact-records.mjs` | `validatePodDesignRequestArtifact`、`validatePodDesignHandoffArtifact` | Pod service 设计请求 / 交付的闭合 | 无 | dropped | ADR-0010：pod 是执行环境，没有设计请求 / 交付制品 |
| 同上 | `validateTaskPackageArtifact` | Controller 发给 Target / Test 任务的完整执行合同 | `governance/tasking/task-package.ts`（`parseTaskPackage`、`createTaskPackage`、文档渲染 / 解析、摘要） | recut |  |
| 同上 | `validateTargetResultArtifact` | 结果证据、repository disposition（committed 须带 commits，其余禁带）、craft mapping（acceptance-anchor / test-step） | `governance/result/implementation-target-result-report.ts`（committed / left-uncommitted / no-changes 与 commits 一致性）、`test-target-result-report.ts`（逐步记录与 requirementRef）、`target-result.ts` | recut | craft mapping 改为报告里的验收锚点与测试步骤引用（能力卡 7） |
| 同上 | `validateReviewCandidateArtifact` | 评审输入快照的结果集合、scope 分区、可声明决定集合 | `governance/review/demand-result-review-snapshot.ts`（从历史重建）+ `capabilities/result-review/decide.ts` 的 `derive*AllowedDecisions` | recut | 候选不再是制品：决定针对当前快照 |
| 同上 | `validateTestCardArtifact` | 冻结的真实环境 Test 合同（strategySource、observedState、executionContract、boundaryGate、evidenceRequired、allowed / forbiddenOperations） | test 任务包（`task-package.ts` 测试合同步骤）+ `demand-post-acceptance-route.ts`（`resolveDemandTestEnvironmentAuthority`，controller-only / real-environment closure）+ `demand-authority.ts`（`TEST_ENVIRONMENT_AUTHORITY_ROLE`） | recut |  |
| 同上 | `validateDemandArtifactRecord`、`demandArtifactRef`、`demandArtifactDigest`、`demandArtifactCanonicalBytes`、`demandArtifactIdentity`、`demandArtifactContractForKind` | 六类 codec 分派、ref / digest / canonical 字节 / identity 元组 | 各制品模块自带 `parse* / render* / compute*Digest`；路径在 `demand-event-sourcing-paths.ts`、`task-package-projection-paths.ts`、`managed-evidence-resource-paths.ts` | covered |  |
| 同上 | `validateDemandArtifactWriteIntent` | 事务 writer 的 metadata 与 identity 闭合 | `demand-event-sourcing-publication-transaction.ts`、`managed-evidence-publication-transaction.ts`、事件流 append candidate | recut |  |
| 同上 | `loadDemandArtifactByRef` | 按 ref 读取并复验 identity 期望 | `TaskPackageProjectionStore`、`managed-evidence-record-reader.ts`（`loadManagedEvidenceRecord`）、`ledger-authority-reader.ts` | recut |  |
| 同上 | `inspectDemandArtifactInventory` | 六类 capability roots 的稳定脱敏分类 | `demand-event-sourcing-root-inventory.ts`、`managed-evidence-record-set-inventory.ts`；verify 门 `demand-root-audit` | recut |  |
| `wakeflow-demand-artifact-service.mjs` | `validateDemandTaskAssignmentAgainstTopology` | window / repository 分配与配置快照核对 | `capabilities/tasking/decide.ts` `deriveTopologyBlockers`（只派给本 pod 的 product 窗口，窗口根仓库等于任务仓库） | covered |  |
| 同上 | `createTaskPackageArtifact` | 新任务合同并在同一事务登记 active package 与 planned target task | `capabilities/tasking/service.ts`：`planTargetTask` 命令经 `kernel/append-command.ts` 追加，随后 `TaskPackageProjectionStore.materialize` 派生任务包投影；谱系（替代 / 续接）、锚点、用户过目确认由 decide 判 | recut |  |
| 同上 | `createTestCardArtifact` | 未占用 targetTaskId 的真实环境 Test 合同 | 同上，测试侧：`deriveTestPlanningBlockers`（至多一个未终结 test 目标、谱系对上待消费复测、缺陷代际未授权不开新合同）、`deriveTestStepReferenceBlockers`、`deriveImplementationBaselines` | recut |  |
| 同上 | `recordTargetResultArtifact` | 记录 current / historical 结果并重验 state / package / craft / lineage | `executeTargetResultImportRequest` + `recordTargetResultInDemandAggregateState`（fence `claimDigest` 核对，`fence-mismatch`） | recut |  |
| 同上 | `createReviewCandidateArtifact` | 冻结当前已选结果与 eligible scope 为唯一 pending 候选 | `readDemandResultReviewSnapshot`（快照摘要随决定提交） | recut |  |
| 同上 | `inventoryDemandArtifacts` | state-root 锁内以事件为期望来源诊断六类制品 | `inspectDemandEventSourcingRootInventory` | recut |  |
| `wakeflow-demand-core-records.mjs` | `validateDemandRecord` | 不可变身份；有 ledgerRoot 时解析来源与隔离授权 | `demand-identity.ts`（source = 需求记录 ref + digest、podId） | recut | 隔离授权放弃（ADR-0010 pod） |
| 同上 | `validateDemandAuthorityRecord` | 冻结需求 authority 只引用 ledger 成员 | `demand-authority.ts`（`createDemandAuthority` / `admitDemandAuthority`，测试环境角色） | covered |  |
| 同上 | `validateDemandStateRecord` | 状态快照及 artifact / review / delivery / Test / Pod 交叉闭包 | `demand-aggregate-state.ts`（`parseDemandAggregateState`，目标任务 phase 机、当前投递 fence、评审升级、证据）+ `demand-event-sourcing-snapshot.ts` | recut | Pod 段放弃 |
| 同上 | `validateControllerEventRecord` | append-only 事件与各 transition owner 字段合同 | `demand-event-sourcing-event.ts`（`parseDemandUncommittedEvent`）、`-stored-event.ts`、`-persisted-event-envelope.ts`、版本 codec 与 upcaster | recut |  |
| 同上 | `validateDemandCoreStack` | demand、authority、state 与完整事件链闭合为权威快照 | `DemandEventSourcingRepository` 加载：快照还原 + `evolveDemandEventSourcingState` 重放 + 版本兼容摘要 + `stateDigest` | recut |  |
| 同上 | `demandDeliverySummaryDigest`、`demandTestLineageDigest` | 状态内子域摘要 | 聚合 `stateDigest` 与 `expectedStateDigest` CAS 覆盖整个状态 | recut |  |
| 同上 | `validateStateTransitionRecord` | journal intent：CAS 前态、event、next state、至多一个 immutable write 同修订 | `demand-event-stream-commit.ts`（`planDemandEventStreamCommit` / `prepareDemandEventStreamCommit` / `applyDemandEventStreamCommit`，append candidate）+ `kernel/append-command.ts` | recut |  |
| 同上 | `validateDemandCoreRecord`、`demandCoreRecordDigest`、`demandCoreCanonicalBytes`、`demandCorePaths` | 五类 codec 分派与固定路径 | 各记录模块 + `demand-event-sourcing-paths.ts` | covered |  |
| 同上 | `loadDemandCoreRecords`、`loadDemandCoreRecordsWhileLocked` | state-root 锁内严格读取完整 core stack | `loadDemandEventSourcingRootAuthority` + repository（发布锁 `demandPublicationLockRef`；一次写命令只读一次事件流，ADR-0013） | recut |  |
| 同上 | `loadDemandArchiveRecoveryRecordsWhileLocked` | 归档恢复读取（transactions/archive.json） | 终态 journal（`readJournal`，C 组） | recut |  |
| 同上 | `loadDemandCoreRecoveryRecordsWhileLocked` | state-transition 恢复读取：允许 journal 指定的中间边界 | `demand-file-event-store.ts` append candidate 恢复、`loadDemandEventSourcingRootAuthorityDuringManagedEvidencePublication` | recut |  |
| `wakeflow-demand-document-builder.mjs` | `selectWakeflowStateSelectedArtifacts` | 只投影 active / current / pending 制品引用 | `kernel/active-projection.ts` Demand 页事实（待评审结果数、受管证据数、已接受结果的分支 / 提交、评审快照摘要） | recut |  |
| 同上 | `buildWakeflowDemandDocuments` | index + developer-progress 两份确定性文档与摘要 | `renderDemandIndex` + `renderDemandProgress`（每 Demand 两份），指纹 | covered | 最近十条事件按 §13.101 D9 不加 |
| `wakeflow-demand-layout.mjs` | `wakeflowDemandCapabilityRoots` | main / isolated placement 的叶子目录清单 | `demand-event-sourcing-paths.ts`、`kernel/layout.ts` | recut | isolated 放弃（pod） |
| `wakeflow-demand-lifecycle-orchestration.mjs` | `planDemandLifecycleTransition` | complete 要求结果与 review 闭合（"idle review authority"）、cancel 只终结可变生命周期；每次读 strict config、current demand、TargetResult 闭包与全量 lease | `planTerminal`（C 组表）：后验收路线、九门、待评审目标阻塞取消（F5.5）、`archive-conflict` | covered |  |
| 同上 | `applyDemandLifecycleTransitionPlan` | state-root 锁内提交唯一 event / state 对；终态提交后删除该 Demand 的 exact state-selected lease；失败闭包区分未写入基线与已授权 effect | `applyTerminal`：终态事件 + 封包 + 结包；取消释放本 Demand 的窗口工作声明，完成要求 verify 门 `work-claims-released` 先过（结果导入已释放投递声明，残留由 endpoint `release-claim` 处理）；失败由发布事务 journal 前向恢复 | recut | 完成不再自动删 lease：改为门加 Controller 显式释放 |
| 同上 | `recoverDemandLifecycleTransition` | 只恢复与 confirmed plan 相同的 journal / effect 前缀 | `recoverTerminal` | covered |  |
| `wakeflow-demand-publication-service.mjs` | `planInitialDemandPublication` | 零写入、绑定初始 tree 与 TODO lineage 的发布计划 | `capabilities/demand/service.ts` 预览：`deriveCreationBlockers`（包 pending、记录属本程序、pod 存在且 open、一 pod 一 Demand）、`deriveDemandCreationIds` | recut |  |
| 同上 | `publishInitialDemandPublication` | create → identity → TODO 固定锁序；幂等确认同一健康 root | `publishDemandFromPackage`：`claimPackageForDemandPublication`（看板 CAS）→ stage 物化 → `publishDemandStage` rename → 最终标记；同包重放 `exactClaimedPackage` 幂等 | recut |  |
| 同上 | `recoverInitialDemandPublication` | 显式恢复已登记 create 事务；无 journal 零写入 | `recoverDemandPublication`（`recoverPublicationTransactionStages`） | covered |  |
| `wakeflow-demand-state-service.mjs` | `commitDemandStateTransition`、`commitDemandArtifactTransition`、`commitDemandEvidenceTransition` | journal → immutable artifact / evidence → event → snapshot → closure check → journal cleanup | `kernel/append-command.ts` + `DemandEventSourcingRepository`（append candidate → commit → snapshot）；任务包投影随后派生；证据走 `ManagedEvidencePublicationApplicationService`（stage → 记录发布 → 事件 → 事务结算） | recut | 闭包检查改为 verify 门 `demand-root-audit` / `evidence-integrity` |
| 同上 | `loadDemandCoreRecordsWithArtifactClosure`（含 WhileLocked） | 读取并核对磁盘上全部已提交 artifact / evidence 闭包 | `inspectDemandEventSourcingRootInventory` + `verifyManagedEvidenceRecord`（verify 门） | recut |  |
| 同上 | `commitDemandDeliveryTransitionWhileLocked`、`recoverDemandDeliveryTransitionWhileLocked` | delivery owner 持锁提交 / 恢复缝 | `prepareDeliveryInDemandAggregateState` / `recordDeliveryOutcome…` / `rearmDelivery…` 经同一 append command | recut | 投递侧分支在 E 组核 |
| 同上 | `commitDemandReviewDecisionWhileLocked`、`recoverDemandReviewDecisionWhileLocked` | 只接受 exact reviewDecision event | `decideTargetResultReviewInDemandAggregateState` + `authorizeProductDefectRemediation…`（decider `review-decision` 命令，`rework-brake` 阈值） | recut |  |
| 同上 | `commitDemandLifecycleTransitionWhileLocked`、`recoverDemandLifecycleTransitionWhileLocked` | complete / cancel 原子落盘 | `terminalEvent`（C 组） | covered |  |
| 同上 | `commitDemandPodTransitionWhileLocked`、`recoverDemandPodTransitionWhileLocked` | Pod owner 提交（可附 Pod Design 制品） | 无 | dropped | ADR-0010 |
| 同上 | `freezeDemandAuthority` | create-once 冻结 demand-authority.json，精确重放只接受原始 intent | 发布 stage 内随身份一起写入（`createDemandAuthority`），不再是独立转换 | recut | 认领即创建（ADR-0011） |
| 同上 | `recoverDemandStateTransition` | 通用 / 证据恢复入口，专用 owner journal 被拒 | evidence service recover、事件流 append candidate 自恢复 | recut |  |
| `wakeflow-target-result-authority.mjs` | `buildTargetResultAuthoritySnapshotFromLoaded`、`loadTargetResultAuthoritySnapshot` | current 选择器、双向闭包、ready / blocked / missing / closed | `demand-result-review-snapshot.ts`（`buildDemandResultReviewSnapshotFromHistory` / `readDemandResultReviewSnapshot`）+ `demand-post-acceptance-route.ts`（下一阶段 owner）+ `deriveImplementationAllowedDecisions` / `deriveTestAllowedDecisions` | recut |  |
| `wakeflow-result-review-orchestration.mjs` | `recordTargetResultFromTransport` | 导入已有严格 transport 证据的结果；状态提交后释放 delivery lease | `executeTargetResultImportRequest`：fence `claimDigest` 核对、报告解析与隐私规则、完成证据（Stop / turn-complete）、`recordTargetResultInDemandAggregateState`，提交后 `releaseWorkClaimIfHeld`；随导入签发 wake-controller 回调许可（ADR-0012 D1） | recut |  |
| 同上 | `inspectDispatchGroupReview`、`inspectDemandResultReviewTrace` | dispatch group 的审查快照与整 Demand 轨迹（diagnostic 无 authority） | `executeTargetResultReviewInspectionRequest`（回调与完成证据状态、允许的决定、逐步视图 `deriveStepViews`、并集判定 `deriveUnionVerdict`） | recut | dispatch group 放弃：投递与评审按目标 |
| 同上 | `createDispatchGroupReviewCandidate` | 冻结不可变 ReviewCandidate | 无制品；决定带评审快照摘要 | recut |  |
| 同上 | `decideDispatchGroupReviewCandidate` | Controller 独立决定；不创建 rework / redesign 后续任务 | `executeImplementationReviewDecisionRequest` / `executeTestReviewDecisionRequest`（accept / rework / product-defect / escalate；`deriveResumptionBlockers`：blocked 或 escalated 后的再决定须带 resumption；升级或缺陷修复授权同一提交） | recut |  |
| 同上 | `planControllerReturnDelivery`、`applyControllerReturnDeliveryPlan`、`inspectControllerReturnPreSend`、`recordControllerReturnOutcome` | Controller-return transport：可重算计划、gate 内发布 envelope、发送前复核、记录发送结果（accepted 不等于业务接受） | 回调随导入签发（`target-result-callback.ts`：回调记录、代际上限、静默窗、`deriveTargetResultCallbackStatus`），投递工具以 `kind: "callback"` 发送并记录结果（`callbackPermitBody`、`recordDeliveryOutcome…`），落地由 Controller 会话 `user-prompt-submit` 记录证明（`deriveCallbackLanding`），`reissueCallback…` 重发 | recut | 投递侧分支在 E 组核 |
| `wakeflow-evidence-importer.mjs` | `planManagedEvidenceImport` | 零写入预览：程序生成 identity / time、source / config / state 快照、完整事务计划与 planDigest | `ManagedEvidenceCapturePlanningService`（来源选择、`deriveManagedEvidenceContentBlockers`、隐私政策、`deriveManagedEvidenceId`）+ `managed-evidence-capture-plan.ts` | covered |  |
| 同上 | `applyManagedEvidenceImport` | 经唯一 state journal 发布 evidence、event、next state；exact replay 返回 already-recorded | `ManagedEvidencePublicationApplicationService`（stage → payload → 记录发布 → 事件 → 事务结算）；`executeRecordEvidenceRequest` 的 `recorded` / `already-recorded` | covered |  |
| 同上 | `recoverManagedEvidenceImport` | 恢复 exact journal；已发布 final root 是恢复 authority，缺失不从 source 补写 | `completeManagedEvidencePublicationTransaction` / `retireStaleManagedEvidencePublicationTransaction`（`recovered` / `retired` / `healthy`） | covered |  |
| `wakeflow-evidence-records.mjs` | `validateEvidenceSource` | configured managed path 或不读网络 / Git 的 locator 记录；caller digest 不升级为实证 | `managed-evidence-source-selection.ts`（repository / support-surface / pod-worktree 的 managed-path、observation、link、commit） | recut | 来源种类是超集 |
| 同上 | `evidencePayloadTreeDigest`、`validateEvidencePayload`、`validateEvidenceManifest` | payload 清单、容量、content class、tree digest；manifest 的 demand / Controller / source / privacy / relation 绑定 | `managed-evidence-manifest.ts`（`MANAGED_EVIDENCE_PAYLOAD_LIMITS`、`MANAGED_EVIDENCE_PRIVACY_FINDING_LIMIT`、relation 上限） | covered |  |
| 同上 | `evidenceManifestRef`、`evidenceManifestDigest`、`evidenceManifestCanonicalBytes`、`evidenceIdentity`、`validateEvidenceWriteIntent` | 路径、摘要、canonical 字节、identity、写入意图 | `managed-evidence-resource-paths.ts`、`managed-evidence-publication-transaction.ts`（`deriveManagedEvidencePublicationEventSourcingCommand`、`…RecordTreePlan`） | covered |  |
| 同上 | `loadManagedEvidenceByRef`、`loadManagedEvidencePortableMembers` | 复验 manifest / identity / 目录闭包；成员 no-follow、单链接、容量上限、重放 strict load 关闭竞态 | `managed-evidence-record-reader.ts`（`loadManagedEvidenceRecord`、`readManagedEvidencePayloadMember`、`verifyManagedEvidenceRecord`）、`ManagedEvidenceReadingService` | covered |  |
| 同上 | `inspectManagedEvidenceInventory` | committed / orphan / missing / incomplete / invalid 分类，不采用孤儿 | `inspectManagedEvidenceRecordSetInventory`（absent、stage-incomplete、stage-complete、source-changed、tree-shape、root-scope、node-policy、expectation-changed） | recut |  |
| `wakeflow-evidence-tree.mjs` | `inspectConfiguredEvidenceSource` | 从 configured repository / support root 捕获 file / tree：类型、容量、内容、reject-only 隐私扫描 | `openConfiguredManagedEvidenceSourceRoot` + 捕获规划服务（`scanPrivacy`、content blockers、`controller-confirmed` 内容审阅 §13.90） | covered |  |
| 同上 | `evidenceStagePath`、`evidenceRootPath` | intent 唯一的同父 stage / final 路径 | `managedEvidencePublicationStageRef`、`managedEvidenceRecordRootRef` | covered |  |
| 同上 | `inspectEvidenceStage`、`assertNoEvidenceStageResidue` | stage 缺失 / 部分 / 完整，拒绝与 final 并存；其他 intent 的残留拒绝 | `managed-evidence-record-set-inventory.ts`（stage-incomplete / stage-complete）、`retireStaleManagedEvidencePublicationTransaction` | recut |  |
| 同上 | `materializeEvidenceStage`、`publishEvidenceStage` | 重捕获 exact source 前向完成 partial stage，manifest 最后写；complete 且无残留的 stage rename 为 create-once final root 并复验 | `materializeManagedEvidencePublicationStage`、`materializeManagedEvidencePublicationPayload`、`publishManagedEvidencePublicationRecord` | covered |  |
| 同上 | `inspectEvidenceFinalWrite` | 严格关闭已发布 root 的目录、manifest、payload 字节与 content class | `verifyManagedEvidenceRecord` | covered |  |

### E 投递、窗口、租约与宿主激活（2026-09-21，gate-log §13.110）

| 旧模块 | 导出函数 | 行为分支 | 新 owner | 判定 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `wakeflow-delivery-orchestration.mjs` | `planTargetDelivery` | 联合 demand、artifact、binding、lease、transport authority 的零写入可重算计划；planDigest 不授权发送 | `capabilities/delivery/decide.ts`（`derivePrepareBlockers`：可投递 phase、rearm 未用尽先 rearm；`deriveClaimBlocker`）+ `executePrepare` 的 `prepareSources`（路线、任务包、worktree、返工 / 缺陷修复上下文）；没有独立 preview，prepare 按客户端幂等键重放 `replayPermit` | recut | ADR-0012 D2：plan / apply / claim 并成一次 `prepare_delivery` |
| 同上 | `applyTargetDeliveryPlan` | 先发布 immutable group / packet / envelope，再取 exact lease，最后逐成员提交 prepared state | `createDeliveryEnvelope`（任务包派生 prompt 骨架与 `computeDeliveryPromptDigest`）、`takeWorkClaim`（独占创建，同字节重放 current，占用报持有者）、`prepareDeliveryInDemandAggregateState` 经同一 append command；失败 `releaseQuietly` 回滚声明 | recut | group / packet 不再是独立文件；一次投递一个目标 |
| 同上 | `claimTargetDelivery` | 原子 claim 当前代际，签发一次性 send permit，竞争只一人得 | 工作声明即围栏：permit 带 `fence`（claimId / claimDigest）与 `hostAction`（只带 `handleDigest`，不带原始 handle） | recut |  |
| 同上 | `recordTargetDeliveryOutcome` | 记录 immutable run 与 readback，再提交 settlement；只有 rejected-before-send 释放 lease，accepted / ambiguous 保留 lease 等结果闭包 | `executeRecordDeliveryOutcomeRequest`：处置由证据派生（目标会话 `user-prompt-submit`、Codex 发送返回、Controller 解决 indeterminate；`delivery-outcome.ts`），`deliveryClaimHandling` 只在 rejected-before-send 释放；indeterminate 静默超阈值把 `next` 转给 Controller（`landingSilenceExceeded`） | recut | readback 改为补充观察，缺失不降级 |
| 同上 | `rearmTargetDelivery` | 证明 exact rejected 尾链后复用原 envelope、换发 lease、递增 send generation；不新增 Test attempt | `executeRearmDeliveryRequest` + `delivery-rearm.ts`（`DELIVERY_REARM_LIMIT` 由声明代际上限派生）、`deriveRearmBlockers` | covered |  |
| `wakeflow-transport-records.mjs` | `create/validate DispatchGroupRecord`、`dispatchGroup*`、`create/validate DispatchPacketRecord`、`dispatchPacket*`、`validateDispatchPacketAgainstGroup` | 一个轮次的完整成员与 Controller return policy；每目标的任务 / 边界 / 审查输入 / 结果合同；packet 属于 group 成员 | 无独立记录：投递按目标，任务包（`governance/tasking`）就是合同来源，回调随导入签发 | recut | ADR-0012 D2 |
| 同上 | `createTargetDeliveryEnvelopeRecord`、`createControllerReturnEnvelopeRecord`、`validateDeliveryEnvelopeRecord`、`deliveryEnvelope*`、`validateTargetDeliveryEnvelopeAgainstSources`、`validateControllerReturnEnvelopeAgainstGroup` | one-shot 发送意图与 binding 快照；与 group / packet 的 lineage 一致；Controller-return 指向 Controller 窗口 | `delivery-envelope.ts`（`parseDeliveryEnvelope` / `createDeliveryEnvelope`、`assertDeliveryEnvelopeMatchesTaskPackage`、返工与缺陷修复上下文投影）是事件流里的事件；结果侧 `assertDeliveryBindingFollowsEnvelope`；Controller-return 变成回调许可（`target-result-callback.ts`） | recut |  |
| 同上 | `createDeliveryRunRecord`、`validateDeliveryRunRecord`、`deliveryRun*`、`validateDeliveryRunAgainstSources`、`validateDeliveryRunChain` | 一次宿主 attempt、readback、record-time lease 元组、连续 lineage；同 envelope 的 run 无 gap / fork / 重复 ordinal | 处置事件（`createDeliveryOutcome`）+ 声明代际（`generation`）+ 事件流顺序；rearm 事件承接代际 | recut |  |
| `wakeflow-transport-retention.mjs` | `planTransportDemandPrune`、`applyTransportDemandPrunePlan`、`recoverTransportDemandPrune` | 归档门控的整需求 transport 释放：eligible / blocked / source-absent，统一 gate 内唯一 release 步骤，只恢复已开始的 eligible release | 完成 / 取消事务内 `retireDemandRoot`（负载摘要等于归档才删）；pod close `retirePodReceipts`；没有单独的修剪操作 | recut | D17：归档即释放 |
| `wakeflow-transport-store.mjs` | `inspectTransportDemandAuthority`、`inspectTransportDemandForLayout` | 0700 / 0600、no-follow、single-link 读取；group → packet → envelope → run 完整或可前向完成图的 strict inventory；layout 有界诊断 | 事件流读取（`demand-file-event-store-reader.ts`）+ `inspectDemandEventSourcingRootInventory`；verify 门 `demand-root-audit` | recut |  |
| 同上 | `publish*Admitted`、`appendDeliveryRunAdmitted`、公开 wrapper `publishDispatchGroup` / `publishDispatchPacket` / `publishDeliveryEnvelope` / `appendDeliveryRun` | gate 内 create-once / append-only 发布 | `kernel/append-command.ts`（append candidate → commit） | recut |  |
| 同上 | `createTransportDemandReleaseParticipant` | archive-gated 的 demand 根 rename / cleanup 参与者 | `retireDemandRoot` | recut |  |
| `wakeflow-window-binding-records.mjs` | `assertWindowBindingId`、`generateWindowBindingId`、`validateWindowBindingRecord`、`createWindowBindingRecord`、`windowBindingCanonicalBytes`、`windowBindingDigest`、`windowBindingRef` | 随机代际 ID、完整记录 codec、canonical 字节、portable 摘要、ref 只由宿主目录与 windowId 决定 | `wakeflow-window-host-binding.ts`（parse / create / render / document）、`wakeflow-window-host-binding-id.ts`、`wakeflow-window-host-binding-resource-catalog.ts` | covered |  |
| `wakeflow-window-binding-service.mjs` | `inspectWindowBindingInventory`、`…ForLayout`、`…ForProtocolHost` | 当前宿主 / 指定 profile / 按协议宿主的脱敏 inventory，不探测真实窗口 | `inspectWakeflowWindowHostBindingInventory`（按宿主 authority）；`wakeflow_status.windows`（identity registered / unregistered / unobserved）与 verify 门 `window-identity` 跨宿主读 | covered |  |
| 同上 | `withCurrentWindowBindingHandle` | 宿主 adapter 在 exact CAS 后短暂借用私有 handle，回调后再核验；返回值不得带出 raw handle | 端点 `readBindingSource` / `admitHandle`；公共结果只带 `handleDigest` 与 bindingId | recut |  |
| 同上 | `registerWindowBinding` | config 授权的持久窗口首个 binding；同 handle 重放幂等；异 handle 须 replace | `applyRegister` + `decideEndpointCommand`（需 `session-start` hook 记录按窗口根匹配；Claude 需 tmux 坐标并写定位器） | covered | 场景与 endpoint 测试 |
| 同上 | `registerPreauthorizedWindowBindingWithinMutation`、`decommissionPreauthorizedWindowBindingWithinMutation` | Pod owner 已持 T02 时的窄注册 / 清理缝 | 同一端点工具带 pod 准入：pod 内 product 窗口在 worktree 存在且被观察前拒绝登记（`admitWorktree` / `recordWorktree`）；pod close 先退役窗口再删回执 | recut |  |
| 同上 | `replaceWindowBinding` | 旧 bindingId + digest 与 lease-absent CAS 切换到新 handle 与新代际 | `applyReplace`（binding 摘要 CAS；声明持有即拒绝并可强制释放） | covered |  |
| 同上 | `decommissionWindowBinding` | 旧 bindingId + digest 与 lease-absent CAS 移除 binding，不关闭宿主窗口 | `applyDecommission`：pre-close / close-result / post-close 证据，`classifyLiveness`（Claude 凭 pane 与 `session-end` 机器核实，Codex 走人工门） | recut | 旧退役结果记录并入，见下 |
| `wakeflow-window-lease-records.mjs` | `assertWindowCoordinationLeaseId`、`generateWindowCoordinationLeaseId`、`createWindowCoordinationLeaseRecord`、`validateWindowCoordinationLeaseRecord`、`windowCoordinationLease*`、`sameWindowCoordinationLeaseOwner`、`windowCoordinationLeaseRef` | 随机 lease 代际、记录 codec、同 owner 幂等识别、每窗口至多一个 lease | `kernel/work-claims.ts`（`createWorkClaim`、`deriveWorkClaimId` 由 Demand 与客户端幂等键派生、`derivedIdFromWorkClaim`、`parseWorkClaim`；每窗口一份声明） | recut | ADR-0009 |
| `wakeflow-window-lease-service.mjs` | `inspectWindowCoordinationLeaseInventory`、`…ForLayout` | 跨宿主脱敏 inventory；不做超时清理 | `inspectWorkClaim`（零写入）；`wakeflow_status.windows.claim` 与 verify 门 `work-claims` | covered |  |
| 同上 | `acquireWindowCoordinationLease`、`acquireWindowCoordinationLeaseAdmitted` | runtime gate 内为完整 tuple 创建或幂等重放 lease | `takeWorkClaim`（独占创建，同字节 current，占用 `window-claimed` 列持有者）；`deriveClaimBlocker`（同目标孤儿声明可回收） | covered |  |
| 同上 | `releaseWindowCoordinationLease`、`releaseWindowCoordinationLeaseAdmitted` | 按 lease / delivery / binding / digest 四元组 compare-and-delete exact holder | `releaseWorkClaim`（缺失 `claim-absent`、异声明 `claim-drift`）、`releaseWorkClaimIfHeld`；过期只开恢复门（`WORK_CLAIM_RECOVERY_WINDOW_MILLISECONDS`，endpoint `release-claim`） | covered |  |
| `wakeflow-keep-live-records.mjs`、`wakeflow-keep-live-service.mjs` | 全部（租约 / 进程代 / 控制请求记录，ensure / start-outcome / release / stop-outcome / reconcile / rollback） | caffeinate 保持唤醒 | 无 | dropped | 能力卡 10 Q1、TSD-12 |
| `wakeflow-host-activation-gate.mjs`、`wakeflow-host-activation-scope.mjs` | 全部（激活主体摘要、cutover 观察、激活门评估、激活报告与范围记录） | 宿主激活门与切换观察 | 无 | dropped | 激活范围随 unattended 推迟（能力卡 10 Q2）；切换观察随迁移放弃（ADR-0008） |
| `wakeflow-host-decommission-result.mjs` | `validateHostDecommissionResult`、`createHostDecommissionResult`、`hostDecommissionResult*`、`hostDecommissionResultToPodCloseObservation` | 宿主非对称退役语义闭包（proof 字段结构，不升级为 routing revocation）；包装成 Pod close observation，不推断 worktree | 端点 decommission 的 closure 证据与 `classifyLiveness`；pod close 的窗口退役经同一端点工具，回执由 `retirePodReceipts` 清理 | recut | I3 |

### F Pod、观察与公共运行时（2026-09-21，gate-log §13.111）

| 旧模块 | 导出函数 | 行为分支 | 新 owner | 判定 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `wakeflow-pod-records.mjs` | `createPodScopeRecord`、`createPodLaunchIntentRecord`、`createPodMaterializationEventRecord`、`createPodCreationReceiptRecord`、`createPodResumeObservationRecord` | 窗口物化链的不可变事实：scope、launch、物化事件、创建回执、恢复观察 | 配置 `pods[]`（scope、窗口集、worktree 意图）+ `kernel/pod-worktree-receipts.ts`（唯一保留的 pod 证据：`createPodWorktreeReceipt` / `writePodWorktreeReceipt` / `readPodWorktreeReceipt`，`parseGitWorktreePorcelain`、`admitPodWorktreeObservation`） | recut | 物化事件链放弃：登记即证据（ADR-0010） |
| 同上 | `createPodTestAccessPlanRecord`、`createPodTestAccessReceiptRecord`、`podTestAccessBindingSetDigest` | Test 直连探测的计划与结果 | 无 | dropped | 矩阵行 29 |
| 同上 | `createPodCloseIntentRecord`、`createPodCloseReceiptRecord` | 关闭授权与机器观察 | 配置 pod `lifecycle: closing` 加每个 worktree 的分支处置（`deriveCloseRequestBlockers`）；窗口退役证据在端点 decommission | recut |  |
| 同上 | `validatePodRecord`、`podRecordCanonicalBytes`、`podRecordDigest`、`podRecordRef` | 按 kind 分派 codec、canonical 字节、摘要、ref | worktree 回执 codec 与 `listPodReceiptDirectories` / `candidateWorktreePaths` | recut |  |
| `wakeflow-pod-service.mjs` | `inspectPodEvidenceInventory`、`inspectPodEvidenceInventoryForLayout` | 当前宿主 Pod 证据的有界诊断 | `observePods`（state 由回执与绑定派生 `derivePodState`，回执 present / checkout-missing）；`wakeflow_status.pods`、verify 门 `pod-execution-location` | recut |  |
| 同上 | `inspectPodWindowMaterialization`、`planPodWindowMaterialization`、`recordPodMaterializationEvent`、`recordPodCreationReceipt` | 单窗口物化闭包：launch intent → 物化事件 → 创建回执 + binding + Pod 成员状态 | 启动意图由配置派生（`wakeflow-window-launch-intent.ts`）；登记经端点工具凭 `session-start` hook 记录，pod 内 product 窗口登记时核对并写 worktree 回执（`admitWorktree` / `recordWorktree`） | recut |  |
| 同上 | `planPodLaunchInitialization`、`applyPodLaunchInitializationPlan` | 冻结 Controller / Design / Test 三控制窗口的 scope、launch intents 与首个 state transition；create-only 证据先于 state；精确 replay 与 journal 恢复 | `wakeflow_pod` create 的 preview / apply：`derivePodId`（程序加客户端幂等键）、`derivePodWindows`、`derivePodWorktrees`、`deriveCreateBlockers`（名称不是 main、存活 pod 内唯一），一个配置事务登记 pod、窗口集与 worktree 意图；同键重放 `already-created`；recover | recut | 配置事务收尾收敛本宿主的窗口运行投影（§13.111 D5） |
| 同上 | `recordPodDesignRequestArtifact`、`recordPodDesignHandoffArtifact`、`planPodProductLaunchAppend`、`applyPodProductLaunchAppendPlan` | Design 请求 / 交接后追加 Product launch intents 与 Pod 成员 | 无：product 窗口从创建起就在 pod 窗口集里 | dropped | ADR-0010 |
| 同上 | `recordPodTestAccessPlan`、`observePodTestAccessPlan`、`recordPodTestAccessReceipt`、`inspectPodTestAccess` | Test 直连访问计划、有界探测、granted / blocked 回执 | 无 | dropped | 矩阵行 29 |
| 同上 | `recordPodCloseIntent`、`observePodCloseIntent`、`recordPodCloseReceipt`、`inspectPodClose`、`inspectPodCloseFromLoadedWhileLocked`、`decommissionClosedPodWindowBinding` | 关闭 effect fence、宿主关闭观察校验、机器可验证或 not-found 回执、整 Pod archive eligibility、只在 receipt 确认后退役 binding | close 两段：`deriveCloseRequestBlockers`（primary 不可关、pod 无活动 Demand、每个已登记 worktree 有分支处置）→ `closing`；窗口退役经端点 decommission（pre-close / close-result / post-close 证据，Claude 机器核实、Codex 人工门）；检出由 Agent 以宿主手段处置；`deriveCloseCompleteBlockers`（绑定全退役、检出全不在）→ `closed` 并 `retirePodReceipts`；`podMutationNext` 给顺序；Demand 侧 `deriveContinueBlockers` / `activeDemandOnPod` 一 pod 一 Demand | recut |  |
| `wakeflow-observability-v3.mjs` | `inspectWakeflowObservabilityV3` | 一次采集约十一个域（descriptor、local、active、ledger、transport、leases、pods、binding、windowRuntime、maintenance、reconcile）、一次校验、一次签发 | `observeWorkspace`（layout、board、demands、claims、每宿主 bindings / hooks / projections / assets、pods、repositories）+ `observeProjectionTargets`；域独立隔离失败 | recut | 本轮 G6 加 `projections` 域 |
| 同上 | `projectWakeflowConfigView` | config 诊断视图 | `wakeflow_status.config` | recut |  |
| 同上 | `projectWakeflowStorageView` | authority / lifecycle / sensitivity / health 的存储职责分类 | 无 | dropped | ADR-0006 |
| 同上 | `projectWakeflowStatus` | 域 health、transport frontier、next actions 路由回 owner、pods 与 leases 汇总、`windowRuntime.projectionStatus` | `assembleStatus`：overall（`deriveOverallStatus`）、board、demands（route 与 next）、windows（identity / claim / lastObservation / **projection**）、claims、pods、repositories、hooks、unmergedAccepted、domains（含 **windowRuntime**）、projection、next / nextActions（`deriveNextActions`：维护 > 未登记窗口 > Demand 前沿 > 待认领包） | recut | **G6**：窗口投影新鲜度本轮补回 |
| 同上 | `verifyWakeflowWorkspaceV3` | 十七门：config-authority、config-service、local-layout、active-authority、ledger-authority、transport-authority、coordination-leases、active-projection、window-identity、window-runtime-projection、maintenance-gate、owner-contract、managed-drift、repository-roots、repository-owner、storage-inventory、layout-manager | 十四门（`deriveWorkspaceGates`）：config-authority、local-layout（并入 owner-contract / layout-manager / managed-drift：对账预览 ready 且无步骤）、ledger-layout、board-consistency、demand-root-audit 与 append-candidates-clear（取代 active-authority / transport-authority：事件流与 append candidate）、evidence-integrity、work-claims（取代 coordination-leases）、host-hook-channel、window-identity、**window-runtime-projection**（G6）、pod-execution-location（并入 repository-roots / repository-owner：primary 主检出与 worktree 回执）、host-settings-assets、active-projection；config-service、maintenance-gate（维护锁由维护事务自查）、storage-inventory（ADR-0006）放弃 | recut | G6 修 |
| `wakeflow-preservation.mjs` | 全部（manifest 校验、inventory、`planLocalPreservation`、迁移源保全、release、apply、recover） | `.wakeflow-local/audit/preserved` 的保全与释放 | 无（`wakeflow_storage_preserve` 放弃） | dropped | 能力卡 8 Q6、D33 |
| `wakeflow-public-v3-runtime.mjs` | `createWakeflowPublicV3DomainHandlers` | 29 个公共处理器（`wakeflow_add_task` … `wakeflow_view`） | `entrypoints/{codex,claude-code}-wakeflow-mcp.ts` 的 20 个工具 + `kernel/command-shell.ts`；逐工具映射在能力映射矩阵 31 行 | recut |  |
| 同上 | `refreshWakeflowActiveProjectionAfterPublicMutation` | 每个公共变更后刷新活动投影，降级为 receipt | `afterMutationRefresh`（`governance/observation/active-projection-refresh.ts`，静默吞非 io 失败） | covered |  |
| `scripts/data/wakeflow-legacy-classifier-catalog.json` | 数据 | legacy 分类目录 | 无 | dropped | ADR-0008 |

### A 基础原语与锁（2026-09-21，gate-log §13.112）

| 旧模块 | 导出函数 | 行为分支 | 新 owner | 判定 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `wakeflow-atomic-write.mjs` | `atomicWriteFile` | 同目录 exclusive stage、absent 或 exact digest 期望、inode 级前任、staging 前 / guard 后 / rename 前重验；不 fsync、不建父目录、不合并 mixed-owned | `foundation/filesystem/durable-atomic-file-write.ts`、`durable-atomic-file-stage-*.ts`、`durable-file-candidate.ts`、`whole-file-content-transition.ts`（节点 CAS）、`file-node-snapshot.ts`；durability 级别可选（§13.100） | recut | predecessor inode 改为节点快照期望 |
| 同上 | `sha256Bytes` | 字节摘要 | `foundation/crypto/sha256.ts` | covered |  |
| `wakeflow-canonical-json.mjs` | `canonicalJson`、`canonicalJsonBytes`、`canonicalJsonDigestHex`、`canonicalJsonDigest` | 规范 JSON、同源 UTF-8 字节、摘要 | `foundation/data/canonical-json.ts`、`foundation/crypto/canonical-json-sha256.ts` | covered |  |
| `wakeflow-fs-safety.mjs` | `pathIsInside`、`inspectFutureFileInside` | 词法包含；未来文件目标的词法 / 物理根、最近 existing ancestor、缺失段、目标类型，不跟 symlink、不写 | `rooted-directory.ts`（根围栏、no-follow）、`rooted-resource-parent-handle.ts`、`rooted-exact-resource-handle.ts`、`portable-resource-path.ts` | recut | 路径函数改为根作用域句柄 |
| `wakeflow-identifiers.mjs` | `generateWakeflowId`、`parseWakeflowId`、`assertWakeflowId`、`createWakeflowIdIndex`、`assertWakeflowRef` | 注入 UUID v4 源、词法拆解、封闭索引与引用校验 | `contracts/identity/wakeflow-durable-id.ts`、`foundation/identity/uuid-v4.ts`、`kernel/ids.ts`、`buildWakeflowConfigIndexes` | covered |  |
| `wakeflow-process-identity.mjs` | `inspectWakeflowProcessSnapshot`、`captureWakeflowProcessIdentity`、`probeWakeflowProcessIdentity` | 正 PID 平台快照；当前进程生命周期身份；同生命周期 / 已消失或复用 / 无法验证三类结论 | `rooted-exclusive-file-lock.ts`（pid + 线程 + token，`process.kill(pid, 0)` 判活，euid 核对） | recut |  |
| 同上 | `probeWakeflowProcessSubject` | 生命周期相同后继续核对可执行文件、argv、父进程 | 无 | dropped | 首轮备注：PID 复用只会让锁显得仍活跃，方向保守 |
| `wakeflow-state-lock.mjs` | `stateRootLockFile`、`withStateRootLock`、`withFileLock` | 锁在 state root 旁；O_EXCL 同步临界区；不建父目录 | `rooted-exclusive-file-lock.ts`（异步、超时、inactive owner 退役）+ `demandPublicationLockRef`、`ledgerRecordPublicationLockRef` 等发布锁 | recut |  |
| `wakeflow-artifact-tree-identity.mjs` | `validateWakeflowArtifactTreeManifest`、`inspectWakeflowArtifactTree` | 冻结 manifest；两遍有界扫描与 canonical digest | `foundation/artifact/loaded-artifact-tree-{identity,transfer-plan,transfer-candidate,transfer-publication}.ts` | covered |  |
| `wakeflow-active-identity-lock.mjs` | `withWakeflowActiveIdentityLock` | 串行化 Demand 身份的发布与归档脱离；固定锁序 projector → identity → state-root | 看板认领 CAS（`kernel/requirement-board.ts`）+ 每个 Demand 根的发布事务；归档脱离在完成事务内 | recut | 没有全局身份锁（ADR-0011） |
| `wakeflow-active-projection-lock.mjs` | `withWakeflowActiveProjectionLock` | 工作区级投影写锁 | `kernel/active-projection.ts`（投影锁、获取超时、逐文件 CAS） | covered |  |

### G 迁移与 legacy（2026-09-21，gate-log §13.112）

| 旧模块 | 导出函数 | 行为分支 | 新 owner | 判定 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `wakeflow-migration-apply.mjs`、`wakeflow-migration-config-owner.mjs`、`wakeflow-migration-host-decommission.mjs`、`wakeflow-migration-inventory.mjs`、`wakeflow-migration-plan.mjs`、`wakeflow-migration-production.mjs` | 全部导出 | 显式迁移的组合、配置 owner、宿主退役合同、库存、计划、生产迁移 | 无 | dropped | ADR-0008 决定 1：不识别、不迁移任何历史布局；发现 Wakeflow 标记只拒绝并列出（B 组 `wakeflow-fresh-initialize.mjs` 行） |
| `wakeflow-legacy-archive-records.mjs`、`wakeflow-legacy-archive-transform.mjs`、`wakeflow-legacy-classifier.mjs`、`wakeflow-legacy-owner-drain.mjs` | 全部导出 | legacy 归档记录与转换、单源分类器、迁移前业务静止证明 | 无 | dropped | 同上 |

### H 入口、MCP 与进程（2026-09-21，gate-log §13.112）

| 旧模块 | 导出函数 | 行为分支 | 新 owner | 判定 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `lib/wakeflow-mcp-tools.mjs` | `WakeflowPublicMcpError`、`exactKeys`、`portableResult` | 公共合同闭合与输出脱敏：私有路径、句柄、会话不进公共结果 | `kernel/command-shell.ts`（`output-boundary`、`privacy-violation` 失败）与各 capability 的 `admit*Result` | covered |  |
| 同上 | `domainHandlers`、`domainHandler`、`PUBLIC_TOOL_ORDER`、`tools`、`handlers` | 31 个公共工具的路由与注册顺序 | `wakeflow-public-mcp-catalog.ts`（20 个工具、Schema 自包含）、`registerWakeflowPublicMcpCatalog`、`kernel/tool-registry.ts`；`tools/list` 体积预算（TSD-13）；逐工具映射在能力映射矩阵 | recut |  |
| 同上 | `maintenanceCoordinator`、`runMaintenance` | fresh / reconfigure / reconcile 各自独立的权限面 | `wakeflow_maintain_workspace` 的 `action` 加宿主 `*-wakeflow-maintenance.ts` | recut |  |
| 同上 | `evidenceRuntimeContext`、`normalizeEvidenceRequest`、`runEvidence`、`refreshEvidenceActiveProjection` | 按 Demand 派生 Controller 上下文的证据路由；变更后刷新活动投影 | `capabilities/evidence/service.ts`（Controller 准入来自 Demand authority）、`afterMutationRefresh` | recut |  |
| 同上 | `writeAnnotations`、`routedTool` | title、readOnlyHint / destructiveHint / idempotentHint、`openWorldHint: false` | `kernel/tool-registry.ts`（annotations 校验：`openWorldHint` 必须 false，只读工具须 readOnly 且非破坏且幂等） | covered | title 由工具名承担 |
| `lib/wakeflow-process.mjs` | `prepareWakeflowCommand`、`runSync` | 六个只读 git 查询：is-inside-work-tree、show-toplevel、verify HEAD、status porcelain、upstream、ahead / behind | `governance/observation/repository-pointer-observation.ts`（直接读 `.git`：HEAD、当前分支、分支引用）、`foundation/git/*`（ignore 观察、object id）；worktree 的 porcelain 由 Agent 观察交回 | recut | 工作树脏状态、upstream、ahead / behind 放弃（能力卡 9 Q1：不 spawn git） |
| `mcp/server.cjs` | `main`、`handleMessage`、`negotiateProtocolVersion`、`callTool`、`toolContent`、`publicToolError`、`toolError`、`LineJsonRpcTransport` | 协议协商、只调用注册表自己的工具、公共错误边界、行与 Content-Length framing | 官方 `@modelcontextprotocol/server` stdio（`wakeflow-mcp-stdio.ts`、`wakeflow-public-mcp-server.ts`、`-server-configuration.ts`）；错误边界在 `command-shell.ts` | recut |  |
| `scripts/wakeflow-setup.mjs` | `parseWakeflowSetupArgv`、`parseWakeflowSetupRequest`、`runWakeflowSetup`、`runWakeflowSetupStdin` | 维护的 JSON-stdin 入口 | `entrypoints/{codex,claude-code}-wakeflow-maintenance.ts`（进程内）+ MCP 工具 | recut | §13.101 D1 |
| `scripts/wakeflow-smoke.mjs` | 四幕（`snapshotTree`、`runSetup`、`assertTargetTree`、observability 15 门） | 已发布制品的一次性端到端探针 | `tooling/artifacts/smoke-plugin-artifacts.ts` 七幕（tools = 20、fresh、reconcile no-op、status idle、verify ok、pod create preview、hook observer landed），仓库外副本 | recut | 能力卡 10 Q8 |
| `scripts/wakeflow-validate.mjs` | 17 类静态校验 | 宿主接缝、产物清单、领域合同（schema identity、exact exports、常量词汇、依赖方向）、公共表面（31 工具、四个脚本、退役入口缺席）、Skill 资源与文本边界、中文只在注释的白名单、依赖防火墙 | `tooling/artifacts/check-plugin-artifacts.ts`（manifest 逐文件摘要、marketplace）、`tests/artifacts/*`（plugin-artifacts、agent-text-honesty、plugin-dependency-closure、plugin-artifact-check）、`check:architecture`（dependency-cruiser）、knip、Biome | recut | 中文白名单放弃：技能文本英文，双语只在 README |
| `scripts/wakeflow-cli.mjs`、`scripts/wakeflow-bootstrap.mjs`、`bin/wakeflow-mcp`、`bin/wakeflow-bootstrap` | 全部导出 | JSON-stdin 镜像 CLI、迁移 backend、shell 启动器 | 无 | dropped | ADR-0002、§13.101 D1 / D5、ADR-0008 |

### I Claude Code 独有（2026-09-21，gate-log §13.112）

| 旧模块 | 导出函数 | 行为分支 | 新 owner | 判定 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `wakeflow-claude-activation-scope.mjs` | `inspectClaudeHostActivationScope` | 激活范围观察 | 无 | dropped | 能力卡 10 Q2 |
| `wakeflow-claude-activity.mjs` | `deriveClaudeActivityServerContext`、`inspectClaudeActivity`、`ensureClaudeActivityMonitor`、`stopClaudeActivityMonitor`、`runClaudeActivityMonitorCycle`、`inspectClaudeActivityForLayout` | tmux 活动监视代际、pane 观察与 glyph 叠加 | 无：宿主 hook 观察（`session-start` / `user-prompt-submit` / `stop` / `session-end`）取代活动监视 | dropped | 能力卡 10 Q3 / Q4、ADR-0009 |
| 同上 | `withClaudePromptTransfer`、`inspectClaudePromptTemp`、`sweepClaudePromptTemp` | prompt 默认走内存，path-only 适配器才建 0600 短命文件；脱敏计数；过期 orphan 清理 | 无：许可正文由 Agent 按技能文本贴进窗口（`{{windowLaunch}}` / 投递参考），Wakeflow 不建临时文件 | dropped | TSD-12 |
| `wakeflow-claude-decommission.mjs` | `validateClaudeWindowDecommissionPlan`、`planClaudeWindowDecommission`、`executeClaudeWindowDecommission`、`recoverClaudeWindowDecommission` | 从 binding 与 locator 生成不可变 close 计划；operation-fence / acknowledgement 顺序 | 端点 `decommission`（pre-close / close-result / post-close 证据，`classifyTmuxPanes` 与 `session-end` 机器核实）；宿主关闭动作由 Agent 执行 | recut | TSD-12 |
| `wakeflow-claude-host.mjs` | `routeClaudeHostCommand` | target-delivery / controller-return 宿主命令路由 | 无 | dropped | TSD-12：宿主动作由 Agent 按技能执行 |
| `wakeflow-claude-lifecycle.mjs` | `inspectClaudeHostPreflight`、`launchClaudeWindow`、`resumeClaudeWindow` | tmux / claude 可用性；按 config 的 root、标题、启动偏好创建窗口；resume 复用 session handle 发布新 locator | 启动意图（`wakeflow-window-launch-intent.ts`：root、tmux 名、model / effort / permissionMode）由 Agent 执行；resume = 端点 `replace` | recut | TSD-12 |
| 同上 | `retitleClaudeWindow`、`arrangeClaudeWindows`、`inspectClaudeWindowFleet` | 标题收敛、窗口排列、fleet 诊断 | 无（标题在启动意图里；排列是宿主动作）；fleet 诊断由 `wakeflow_status.windows` 与 inspect 承担 | dropped | TSD-12 |
| `wakeflow-claude-locator.mjs` | `generateClaudeWindowLocatorId`、`validateClaudeWindowLocatorRecord`、`createClaudeWindowLocatorRecord`、`claudeWindowLocator*`、`claudeWindowLocatorRef` | locator 记录 codec、最小 tmux 坐标 | 端点登记时写定位器（`refreshLocator`），坐标随绑定由 Agent 观察交回 | recut | D23、D30 |
| 同上 | `inspectClaudeWindowLocatorObservation`、`inspectClaudeWindowLocatorInventory`、`…ForLayout` | pane 事实收敛为 live / missing / drift；脱敏库存 | `capabilities/endpoint/pane-classification.ts`（同一判定顺序，只有 live 可派发）；status 窗口段 | covered |  |
| 同上 | `withClaudeWindowOperationMutex`、`resolveClaudeWindowOperationEndpoint`、`commitClaudeWindowLocator`、`removeClaudeWindowLocator`、`recoverClaudeWindowOperationMutex` | 逐窗口宿主操作互斥、send / readback 前唯一 live pane、locator CAS 提交 / 删除、锁恢复 | 互斥语义在工作声明（`kernel/work-claims.ts`，围栏 claimDigest）；locator 随 register / replace / decommission 更新；过期声明只开恢复门 | recut |  |
| `wakeflow-claude-migration-decommission.mjs`、`wakeflow-claude-migration-effect.mjs` | 全部导出 | 迁移退役与宿主效果 | 无 | dropped | ADR-0008 |
| `wakeflow-claude-pod-host.mjs` | `planClaudePodMaterializationOperation`、`normalizeClaudePodCreationObservation`、`executeClaudePodMaterialization` | search-before-create Claude session 与 cwd 规范化 | `capabilities/pod/*`（配置事务）；`claude --worktree` 由 Agent 执行，登记时核对 worktree | recut | ADR-0010 |
| `wakeflow-claude-settings.mjs` | `planClaudeSettingsAssets`、`validateClaudeSettingsAssetsPlan`、`inspectClaudeSettingsAssets`、`planClaudeSettingsAssetsMaintenance`、`validateClaudeSettingsAssetsMaintenancePlan`、`createClaudeSettingsAssetsMutationParticipant` | 各配置根 `.claude/settings*.json` 语义观察、保守合并（只补 Wakeflow allow rules 与 managed statusline，保留用户键）、维护计划与 participant、仓库根写入需显式授权 | `hosts/claude-code/claude-code-portable-settings-{composition,transition,publication,operation-executor}.ts`（MCP 允许规则、清理旧的宽 Bash 规则、多根、CAS）、`claude-code-maintenance-capability.ts` 贡献 | recut | 仓库根 settings 授权不实现（能力卡 1 §1 表第 30 行） |
| 同上 | `claudeStatuslineAssetRef`、`claudeStatuslineAssetContent`、`claudeStatuslineCommand`、`inspectClaudeStatuslineAssetRuntime` | statusline 资产的 ref、字节、机器本地命令；以模板或安装字节执行 smoke（只输出模型与窗口标签） | `claude-code-statusline-asset.ts`（内容、摘要、命令）、`claude-code-statusline-{asset,settings}-operation.ts`（本地设置 0600 条目）；运行证明留给真实会话 | recut | 用户侧：真实 Claude 会话的状态栏 |
| `wakeflow-claude-transport.mjs` | `executeClaudeTargetDelivery`、`executeClaudeControllerReturn`、`recoverClaudeTransportOperation` | 重建发送 authority、mutex 内唯一 live pane、stdin 加载 tmux buffer、一次 paste + Enter + readback、结果交 shared owner、失败时按 durable 事实释放 mutex | 无：Agent 贴入，落地由目标会话 hook 记录证明（`record_delivery_outcome`），一次性由许可重放与声明代际保证 | dropped | TSD-12、ADR-0009 |
| `wakeflow-host-artifact-checks.mjs`（claude） | `createHostArtifactChecks` | Claude manifest、仓库级 marketplace、命令目录、`${CLAUDE_PLUGIN_ROOT}` 启动语义 | `tooling/artifacts/check-plugin-artifacts.ts`（宿主中立的 manifest 与 marketplace 校验）+ `tests/artifacts/plugin-artifacts.test.ts` | recut |  |

### J Codex 独有（2026-09-21，gate-log §13.112）

| 旧模块 | 导出函数 | 行为分支 | 新 owner | 判定 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `wakeflow-codex-activation-scope.mjs` | `inspectCodexHostActivationScope` | 激活范围观察 | 无 | dropped | 能力卡 10 Q2 |
| `wakeflow-codex-decommission.mjs` | `validateCodexWindowDecommissionPlan`、`planCodexWindowDecommission`、`recordCodexWindowDecommissionObservation` | 固定 Codex 能力声明：archive 不是机器可验证的 close；记录人工观察 | 端点 `decommission` 的 Codex 人工门（`codex-thread` closure 只记录，不升级为机器证明） | recut | TSD-12 |
| `wakeflow-codex-migration-decommission.mjs`、`wakeflow-codex-migration-effect.mjs` | 全部导出 | 迁移退役与宿主效果 | 无 | dropped | ADR-0008 |
| `wakeflow-codex-pod-host.mjs` | `exactCodexRecoveryThread`、`exactCodexProject`、`codexPodMaterializationOperation`、`codexPodCreationObservation` | 以 correlation marker 在 task 快照里恢复线程；创建只落唯一 saved project；final / pending 观察 | `capabilities/pod/*`；线程由 Agent 创建，登记凭 `session-start` hook 记录与 worktree 观察 | recut | ADR-0010 |
| `wakeflow-host-artifact-checks.mjs`（codex） | `createHostArtifactChecks` | Codex manifest、仓库级 marketplace、MCP 启动路径 | `tooling/artifacts/check-plugin-artifacts.ts` + `tests/artifacts/*` | recut |  |

### K 技能与模板文本（2026-09-21，gate-log §13.112）

| 旧文件 | 内容 | 新 owner | 判定 | 备注 |
| --- | --- | --- | --- | --- |
| `plugins/claude-code-wakeflow/skills/wakeflow-controller/SKILL.md`（599 行） | Controller：Demand 创建权限、回传 prompt 形状、dispatch、评审、验收决定格式、group policy、一仓一窗 | `assets/agent-text/skills/wakeflow-controller/SKILL.md` + `references/{workspace-and-windows,delivery-and-review,evidence}.md` | recut | §13.99 D1：prompt 轻量、技能拥有程序；诚实性门校验工具名 |
| `core/skills/wakeflow-design/SKILL.md` + `references/{clarification,option-planning,work-slicing,requirement-design,design-handoff}.md` + `assets/{original-plan,requirement-design}.md` | 澄清、选项规划、切片、需求设计、交接的方法与模板 | `skills/wakeflow-design/SKILL.md`（对着真实代码起草 → 预览与用户确认 → 发布）+ `references/requirement-package.md`（包即整份交接、分节内容、确认点 1、隐私） | recut | 需求包取代 Design 交接制品（ADR-0011）；方法压进分节要求 |
| `core/skills/wakeflow-target-craft/SKILL.md`（七项实践） | 计划、基线、测试先行、系统化调试、自审、证据、返回 | `skills/wakeflow-target/SKILL.md` + `references/craft.md`（顺序、边界、worktree、证据、验收锚点、报告、伪进展） | recut |  |
| `core/skills/wakeflow-test/SKILL.md` + `references/{debugging-triage,regression-advisory,risk-strategy,self-evidence-review}.md` | Iron laws、入口门、方法路由、mutation 边界、exact 结果证据 | `skills/wakeflow-test/SKILL.md` + `references/test-execution.md`（冻结合同、逐步执行、失败分类、尝试与停止、证据、报告） | recut | 风险策略与回归建议并入测试合同（Controller 冻结） |
| `plugins/claude-code-wakeflow/skills/wakeflow-governance/**` | 旧插件仓库的维护规则与参考（架构、投递、ledger、路线图、迁移、写作风格） | 本仓库 `CLAUDE.md`、`docs/`（需求、ADR、参考） | dropped | §13.99 D1：治理文本不进制品 |
| `core/template-sources/**` | Demand 进度页模板（en / zh-CN） | `kernel/active-projection.ts` 的渲染代码（双语文案表） | dropped | §13.101 D1 |
| 四个命令 `commands/wakeflow-{init,next,pod,status}.md`、`README.md` / `README.zh-CN.md` | 新增 | `assets/agent-text/commands/*`、README | — | 首轮已计 |
