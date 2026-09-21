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

第二轮（导出函数级，§3）B 组核出并修完三处首轮漏判的 gap：G2 支撑面 scaffold 目录、G3 支撑面 `.gitignore` 托管块、G4 对账自动修复范围（gate-log §13.107）。C 组核出 G5（reconcile 重建缺失或过期的窗口运行投影，已修，gate-log §13.108）与 G6（`wakeflow_status`/`wakeflow_verify` 不报窗口运行投影新鲜度；观察域归 F 组，留到 F 组一并处置）。模块级判定不变；函数级 gap 计 1（G6）。

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
| `wakeflow-demand-lifecycle-orchestration.mjs` | 1041 | complete/cancel 终态编排：准入、原子提交、租约 effect、失败闭包 | `capabilities/demand/lifecycle.ts`、`governance/demand/lifecycle/*` | recut | 完成即归档一个事务（ADR-0012 D3） |
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
| `wakeflow-observability-v3.mjs` | 2475 | 观察：config 视图、storage 视图、status、verify | `capabilities/observation/*`、`governance/observation/*` | recut | storage 视图放弃（ADR-0006）；13 门 verify |
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
