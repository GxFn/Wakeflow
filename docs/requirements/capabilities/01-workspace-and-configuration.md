# 能力组 1：工作区与配置

> 状态：`confirmed`，Q1 到 Q10 已于 2026-09-03 全部裁决，记录见文末"确认记录"；Q9 与 Q10 的裁决由 [ADR-0008](../../decisions/0008-discard-legacy-and-new-version-series.md) 承载
> 建立日期：2026-09-03
> 旧实现基线：`core/`、`plugins/*` 于 `c0098e2`
> 上位文档：[docs/plan/typescript-reimplementation-plan.md §8.1 P0](../../plan/typescript-reimplementation-plan.md)、[ADR-0007](../../decisions/0007-rebuild-mandate-and-bottom-up-flow.md)
> 卡片结构：场景、旧实现、不变量与失败恢复、宿主差异、现 TS 状态、实现判断、待确认。实现判断由实施者按 ADR-0007 直接决定，供复核；待确认必须由用户回答。

## 1.1 工作区初始化 fresh-initialize

**场景**：用户在一个产品仓库旁边建立 Wakeflow 控制器工作区。Agent 在 Controller 窗口按 `/init` 收集用户对程序、仓库、Design 与 Test 支撑面、窗口、ledger 根、宿主偏好的选择，预览后由用户确认，再应用。初始化不派发任何工作，窗口的真实创建由 Agent 在之后执行并登记。

**旧实现**：

- 工具 `wakeflow_maintain_workspace`，`action: fresh-initialize`，`mode: preview | apply | recover`。preview 请求为 `{selection, language}`；apply 为 `{confirmedPlan, planDigest}`；recover 再加 `operationId`。`core/lib/wakeflow-mcp-tools.mjs:469-506`、`:635`。
- 摘要握手：apply 重算 `canonicalJsonDigest(confirmedPlan)`，再在维护门内重新规划并要求逐字节一致；摘要不是授权令牌。`wakeflow-maintenance-coordinator.mjs:259-265`、`wakeflow-maintenance-action-composition.mjs:507-531`。
- `selection` 只含用户意图与请求内 `selectionKey`，全部 typed id 由 Wakeflow 在初始化时分配。`wakeflow-fresh-initialize.mjs:250-265`。
- 产物按 `wakeflow-layout-descriptor.mjs` 声明，非 local 默认 tracked 0644/0755，`.wakeflow-local` 下 ignored-local 0600/0700，`:74-93`。只物化 `createTiming` 不是 event-only 与 reference-only 的条目，`:873-876`。

| 根 | 产物 | tracking | 归属 |
| --- | --- | --- | --- |
| 工作区根 | `wakeflow.config.json` | tracked 0644 | config-service，整文件 |
| 工作区根 | `AGENTS.md` 或 `CLAUDE.md` | tracked 0644 | instruction-renderer，描述符声明 whole-file，写入器实现 managed-block，见待确认 Q1 |
| 工作区根 | `.gitignore` 托管块 | tracked-mixed-owned | ignore-plan；条目为 `.wakeflow-active/`、`.wakeflow-local/`，Claude 另加 `.claude/settings.local.json` |
| 工作区根 | `.claude/settings.json`、`.claude/settings.local.json` | tracked-mixed-owned、ignored-mixed-owned | host-settings-plan，Claude 专有 |
| `.wakeflow-active/` | `index.md` 0600、`current/workspace-current-status.md` 0600、`current/global-todo-board.md` 0644 | ignored | 投影与 TODO 权威；Demand 目录全部 event-only，初始化不创建 |
| `.wakeflow-local/` 0700 | `runtime/maintenance/transactions`、`runtime/shared/transport/demands`、`runtime/shared/coordination/window-leases`、`audit/preserved`、`runtime/hosts/<host>/…` | ignored-local | 静态能力根；锁、journal 全部 event-only |
| ledger 根 | `requirement-designs/` 与 `index.md`、`goal-stage-confirmation/` 与 `index.md`、`workspace/workspace-record-map.md`、`workspace/archive/` 与 `index.md` | tracked 0644/0755 | durable-authority 目录加 deterministic-projection 索引 |
| 支撑面 | Wakeflow 管理的 Design 面：根目录、`<memoryFile>` 整文件、`drafts/`；Test 面：`harnesses/`、`fixtures/` | tracked | 外部拥有的支撑面只在 `instructionManagement: managed-block` 时写托管块 |
| 产品仓库 | 根为 reference-only，不创建；托管块仅在 `managed-block` 时写入 | external-owned | 仓库级 `.gitignore` 与 settings 需要显式授权，fresh 时授权列表固定为空，`wakeflow-fresh-initialize.mjs:954` |

**不变量与失败恢复**：

- 根必须是已规范化的绝对路径、真实目录、无符号链接、属主为当前 euid，事务期间 realpath 不变。`wakeflow-mcp-tools.mjs:103-113`。
- 所有配置根之间不得重叠，先做词法检查再做 realpath 检查。`wakeflow-layout-descriptor.mjs:880-1030`。
- 已存在 `.wakeflow-active` 即拒绝；`.wakeflow-local` 下只允许维护事务残留。`wakeflow-fresh-initialize.mjs:620-636`。
- 托管块或整文件中有用户修改即 blocked，绝不覆盖。`wakeflow-managed-content.mjs:88-113`。
- 输出含绝对根路径即拒绝，三层独立扫描。`wakeflow-mcp-tools.mjs:230-233`。
- 没有祖先目录扫描，嵌套工作区只在根重叠时被间接拦住。
- 新实现的拒绝规则（ADR-0010 Q11）：工作区根与任何产品仓库根是同一目录即拒绝。
- 新实现的拒绝规则（ADR-0008）：目标根内存在任何 Wakeflow 标记，即 `wakeflow.config.json`、`workspace.config.json`、`.wakeflow-active`、`.wakeflow-local`、`.workspace-active`、`.workspace-local`、`wakeflow-ledger` 或宿主运行目录，一律拒绝并列出发现项，不识别家族、不迁移；祖先目录含 `wakeflow.config.json` 同样拒绝。

**宿主差异**：

| 项 | Codex | Claude Code |
| --- | --- | --- |
| 指令文件 | `AGENTS.md` | `CLAUDE.md` |
| 宿主运行目录 | `runtime/hosts/codex/`：window-bindings、window-runtime 投影、pods（worktree 回执，2026-09-10 pod 切片 9 取代 evidence/pods）、keep-live | `runtime/hosts/claude-code/`：以上加 window-locators、assets/statusline.mjs、activity-monitor、temp/prompts |
| settings | 不适用 | `permissions.allow` 写 4 条：`mcp__plugin_wakeflow_wakeflow`、`Bash(node *)`、`Bash(tmux *)`、`Bash(git *)`；`settings.local.json` 只写 statusLine 命令；`.claude/` 目录 0700 |
| statusline | 不适用 | 安装 `statusline.mjs` 0600，命令带 base64url 编码的根路径；规划前做一次有界 smoke 并检查敏感内容 |
| 激活范围 | 永远 `unknown`，无人值守 `forbidden`，Codex 没有安装覆盖范围 API | 按 settings 来源分 per-workspace、host-wide、unknown |
| 窗口创建 | `create_thread`，Agent 原生工具 | `wakeflow-claude-host launch-window`，旧为 CLI，新边界下由 Agent 执行 tmux |

**现 TS 状态**：`wakeflow_maintain_workspace` 三个 action 与 preview、apply、recover 齐全；apply 为同一 `action` 与 `request` 加 `planDigest`，服务端重算计划并比对摘要，漂移以 `precondition-failed/plan-drift` 拒绝（2026-09-04 L0.4 试点，切片 `src/capabilities/workspace/maintain-workspace.ts`；ADR-0004 的 `planRef` 在初始化场景退化为原请求本身，因为初始化前没有可写的 Wakeflow 根，preview 必须零写）；结果带 `plan`、`planDigest` 与 `next`；fresh selection 的 ID 分配改为由 selection 摘要确定性派生，apply 重发同一 selection 才能重算出同一摘要；`selection` 领域合同在 `src/configuration/wakeflow-fresh-config-selection.ts`；物化步骤十五种：local-protocol、shared-coordination、active-layout、requirement-board、fresh 活动投影、ledger、窗口运行时、host-capability、support-root（含 Design `drafts/`、Test `harnesses/` 与 `fixtures/` scaffold，2026-09-21）、工作区 `.gitignore`、支撑面 `.gitignore`（各宿主本机设置路径，2026-09-21）、程序指令、外部指令、支撑面记忆、config；宿主 profile 编译为空目录声明；Claude settings 写入把三条 Bash 规则标为 `WAKEFLOW_LEGACY_BROAD_BASH_PERMISSION_RULES`，只保留 MCP 规则；statusline 资产只声明文件名，没有写入；根指令文件采用 managed-block；`instructionManagement: managed-block` 的产品仓库与 external-owned managed-block 支撑面在各自根的宿主指令文件里得到同一机制的托管块（`workspace/managed-integration/wakeflow-external-instruction-*`，物化步骤 `recompose-external-instruction`，2026-09-21，gate-log §13.106）；没有 setup、cli、bootstrap 入口；工作区根必须本身是 Git 仓库（托管 `.gitignore` 块靠 Git 判定），否则 preview 报 `gitignore-git-repository`——2026-09-21 在真实工作区 `WakeflowTestWorkspace` 上首次初始化时暴露，之前统一报成 `gitignore-git`（gate-log §13.115）。

**实现判断**：

- 统一预览与应用的字段名，旧版 preview 返回 `confirmedActionPlan` 而 apply 要 `confirmedPlan`，新版按 ADR-0004 统一为 `planRef` 加 `planDigest`。
- 支撑面记忆文件保持整文件 Wakeflow 所有，与旧实现一致。
- 空常量 `MISSING_FRESH_OWNERS`、死函数 `stripRef` 不复制。
- `.wakeflow-active` 全树 ignored，文件模式统一为 0600、目录 0700，不再区分 TODO 板 0644。

**待确认**：

- Q1 工作区根的 `AGENTS.md` 或 `CLAUDE.md`：整文件 Wakeflow 所有，还是用户文件内的托管块？建议托管块，因为用户通常有自己的内容；支撑面保持整文件。
- Q2 fresh-initialize 是否增加祖先目录扫描，发现上级已有 `wakeflow.config.json` 即拒绝？建议增加。
- Q3 Claude Code 的 `permissions.allow`：新边界下 Agent 自己执行 tmux，是否仍由 Wakeflow 写入 `Bash(tmux *)` 等三条宽泛规则，还是只写 MCP 规则、把 tmux 权限交给用户在 Claude Code 里自行授予？建议只写 MCP 规则，skills 提示用户授予 tmux。
- Q4 statusline 资产：它是唯一在宿主进程内运行的 Wakeflow 代码，属于只读展示。保留还是放弃？建议保留，列入 L1 后期切片。

## 1.2 配置权威 wakeflow.config.json v3

**场景**：配置是程序身份、拓扑、存储位置、治理策略与宿主偏好的唯一持久来源。用户通过初始化和重配置改变它，不手工编辑。

**旧实现**：

- 顶层 8 个必填字段，`additionalProperties: false`：`$schema`、`kind: WakeflowConfig`、`schemaVersion: 3`、`program`、`topology`、`storage`、`governance`、`hosts`。`core/schemas/wakeflow-config.schema.json`。
- `program`：`programId`、`displayName`、`description?`、`interfaceLanguage: auto | en | zh`。
- `topology.repositories[]` 至少 1：`repositoryId`、`path`、`displayName`、`instructionManagement: owner-managed | managed-block`、`validation.residueExceptions[]`。
- `topology.supportSurfaces[]` 恰好一个 design 一个 test：`surfaceId`、`capability`、`path`、`ownership: wakeflow-managed | external-owned`，external-owned 时必须给 `instructionManagement`。
- `topology.windows[]` 至少 4：恰好一个 controller、一个 design、一个 test，每个仓库至少一个 product 窗口；`root` 为判别联合：program、support-surface、repository。
- `storage.ledgerRoot` 是唯一可配置的持久根；`.wakeflow-active` 与 `.wakeflow-local` 是代码常量。
- `governance.audit.preservedReviewAfterDays?`、`governance.validation.runtimeResidue?`；没有 testing-mode 字段。
- `hosts.codex.launch{modelByRole, reasoningEffortByRole}`、`hosts.claude-code.launch{同上, permissionMode: acceptEdits | bypassPermissions}`、`hosts.claude-code.tmux{sessionName, socketName}`；缺省表示继承宿主默认，不表示禁用。
- 序列化固定为两空格 pretty JSON 加换行；`sourceDigest` 是字节摘要，`configDigest` 是规范化语义摘要。`wakeflow-config-v3.mjs:696-703`。
- 读取要求属主为 euid、模式 0644、单链接、不超过 1 MiB、前中后三次 stat 一致。`wakeflow-config-v3-transition-authority.mjs:184-218`。

**不变量与失败恢复**：整文件 Wakeflow 所有；`programId` 与三个常量字段不可变；`$id` 指向 `core/schemas/` 下的 GitHub raw 地址。

**宿主差异**：只体现在 `hosts` 两个键；键顺序固定 codex 先 claude-code 后。

**现 TS 状态**：schema 位于 `src/contracts/schemas/configuration/wakeflow-config.schema.json`，结构差异：`program.interfaceLanguage` 改为 `presentation.language: en | zh-Hans`，没有 `auto`，没有迁移；2026-09-21 起 `governance` 是保留的空对象——`governance.audit.preservedReviewAfterDays`、`governance.validation.runtimeResidue` 与 `repositories[].validation.residueExceptions` 三条词汇在新旧实现里都没有行为消费者，按用户裁决连同只有它们引用的定义一起删除（gate-log §13.113）；带这些字段的旧配置读取时按未知字段拒绝，只能重新初始化；`$id` 仍指向 `core/schemas/`；权威快照与替换已实现并加锁；快照读取器与过渡权威的严格度已统一。

**实现判断**：按 TSD-16，schema `$id` 为 `urn:wakeflow:config:v1`，`schemaVersion` 从 1 起，代码去掉 `v3` 字样；不写任何旧版本读取器或 upcaster；配置读取严格度统一为属主、0644、规范字节；`sourceDigest` 与 `configDigest` 两个摘要保留；物理产物不进配置，永远由当前运行版本按描述符重新推导。

**待确认**：

- Q5 呈现语言：是否保留 `auto`，值域用 `en | zh-Hans` 还是旧的 `en | zh`？建议 `auto | en | zh-Hans`，并在 L1 加显式 upcaster 迁移旧值。

## 1.3 重配置 reconfigure

**场景**：用户想改显示名、语言、宿主偏好、治理策略，或增加仓库与窗口。改动先预览，看到阻塞项与依赖矩阵，再确认应用。

**旧实现**：

- 输入 `desiredModel` 完整模型加 `language`、`authorizedRepositoryIds`。`wakeflow-reconfigure.mjs:515-521`。
- 不可变：`programId`，两处独立拒绝。`:193-198`、`wakeflow-config-v3-owner.mjs:1259-1268`。
- 名义可改实则永远阻塞：`storage.ledgerRoot` 一改就产生 `ledger-root-requires-explicit-migration`，没有任何 owner 能满足它。`:243-245`、`:551-560`。
- 自由可改：显示元数据、语言、governance、hosts、新增实体。
- 需 owner 证明才可改：窗口删除或改角色需要 7 个 owner 证明；仓库删除或改根、支撑面删除或改根各需对应 owner 证明；未证明则 `status: blocked`，`confirmedActionPlan` 为 null，无法应用。`:236-275`。
- 应用副作用：重写配置，重渲染支撑面、ledger 布局与投影、托管块、active 投影、窗口运行投影、Claude settings 与资产。`:526-671`。

**不变量与失败恢复**：过渡权威要求 `sourceModel.programId === desiredModel.programId`，配置缺失或非 v3 直接失败，没有 legacy 回退。

**宿主差异**：Claude settings adapter 不可用时整体阻塞 `reconfigure-host-settings-owner-unavailable`。

**现 TS 状态**：reconfigure preview 接受 `desiredConfig`，权威替换在锁内以完整 StableFileSource 为前置。

**实现判断**：owner 证明矩阵保留为阻塞机制，但把 window-runtime 投影错误从空 catch 改为显式报告；`ledgerRoot` 的处理按 Q6 定。

**待确认**：

- Q6 `storage.ledgerRoot` 初始化后是否明确为不可变？建议不可变，reconfigure 直接拒绝，需要移动时走归档后重建。

## 1.4 对账 reconcile 与只读校验

**场景**：Agent 或用户怀疑托管文件、投影、目录模式漂移，先用只读校验看结论，再决定是否对账修复。对账不改配置、不登记窗口、不迁移。

**旧实现**：

- reconcile 没有 `desiredModel`，从磁盘重读配置；声明范围 `configMutationAllowed: false`。`wakeflow-reconcile.mjs:741-748`。
- 自动修复：`.wakeflow-local` 静态目录缺失或模式漂移、支撑面目录、ledger 目录与四个索引投影、`.gitignore` 与记忆文件托管块、active 布局与 TODO 板、两个 active 投影、窗口运行投影、Claude settings 与 statusline。
- 只报告不修复：窗口运行投影 unsafe 或 unavailable；配置非 current；托管块有用户改动；ignore 规则冲突。
- 不删除任何孤儿目录：`remove-empty-static-dir` 是死词汇，没有 owner 发出。`wakeflow-maintenance-plan.mjs:82`。
- 只读入口：`wakeflow_verify operation=inspect` 给严格结论，`wakeflow_view operation=config | storage | verification` 给细节，`wakeflow_status` 是另一个实时投影；Claude `/check` 只调这些，明确禁止触发修复。

**不变量与失败恢复**：同 1.1；窗口投影 stale 与 missing 既不阻塞也不报告，是旧行为疑点。

**宿主差异**：Claude 多出 settings 与 statusline 的对账。

**现 TS 状态**：reconcile preview 存在；只读 verify 与 view 没有公共入口，ADR-0006 已决定 verify 保留、view 放弃；6 个恢复 owner 中只有 maintenance 自身可达。2026-09-21（gate-log §13.107）起自动修复集与旧实现对齐：活动布局与需求看板、ledger 根与固定容器、当前宿主 capability 目录、支撑面根与 scaffold、支撑面与工作区 `.gitignore` 托管块、程序与外部指令托管块、支撑面记忆、共享协调布局；只报告不修复：节点政策冲突（`*-conflict`）、托管块手改（`*-envelope` / `*-unknown-managed-body`）、维护协议根 busy / recovery-required / conflict（`maintenance-protocol-*`）。宿主运行时根、维护协议根乃至整个 `.wakeflow-local` 缺失自 2026-09-21 起由对账重建（gate-log §13.114 D2）：协议根由维护 gate 以 repair 模式引导后 `materialize-local-protocol` 核对；宿主运行时根由 `publish-unregistered-window-runtime` 补目录骨架与缺失的未登记投影，`materialize-host-capability-layout` 依赖它，仍有 Binding 的窗口由宿主 capability 的逐窗口操作在同一事务里重建 registered 投影。窗口运行投影（gate-log §13.108）：缺失或过期（合法 JSON 但不是当前 Config 与 Binding 的渲染）由当前宿主的维护 capability 重算并重建（`window-runtime-projection` 操作，两宿主共用 `workspace/window-runtime/wakeflow-window-runtime-projection-maintenance.ts`），读不出的投影只报告 `host:<host>:<capability>:window-runtime-projection-unsafe`——这把上面"实现判断"里 stale/missing 只报告的写法改回了旧实现的自动修复，因为投影是可从权威确定性重算的派生数据。观察侧（G6，gate-log §13.111）：`wakeflow_status.windows[].projection` 逐窗口报新鲜度、`domains.windowRuntime` 报域可用性、verify 门 `window-runtime-projection` 逐窗口点名，缺失或过期把 next 指向维护。

**实现判断**：stale 与 missing 的窗口投影作为 blocker 显式报告；host-settings-assets 因上游阻塞未评估时报 `not-evaluated` 而不是 `missing`；verify 作为独立只读工具复用对账的检测部分但零写。

**待确认**：

- Q7 对账是否可以删除空的孤儿静态目录？建议不删除，只报告，删除留给用户。

## 1.5 维护事务、锁与恢复

**场景**：任何维护动作在应用途中崩溃后，工作区不能处于半写状态；Agent 或用户能用同一个计划与 `operationId` 把事务向前结算，或明确得知需要人工处理。

**旧实现**：

- 维护门 `.wakeflow-local/runtime/maintenance.lock`，0600 单链接，O_EXCL 暂存后硬链接发布；默认等待 5 秒，超时 `wakeflow-mutation-busy`；没有 stale 自动打破。`wakeflow-workspace-mutation.mjs:60-67`、`:1998-2035`。
- 另有通用状态锁 `wakeflow-state-lock.mjs`：2 秒等待、30 秒 stale、持有者进程已死才打破、临界区必须同步。两套锁语义不同。
- 事务记录 `runtime/maintenance/transactions/{operationId}.json`，字段含 plan、planDigest、checkpoint、steps 状态、terminalClosure；恢复 claim 与 checkpoint stage 为兄弟文件。`:3215-3245`。
- 步骤执行：观察、准备、checkpoint prepared、观察、提交、checkpoint committed，每个边界后重新观察物理状态。`:3541-3700`。
- 崩溃语义：checkpoint 为 0 时删 journal 释放门并重抛原错误；有稳定 checkpoint 时标记 relinquished、释放门、抛 `wakeflow-mutation-recovery-required` 带 `operationId`；relinquish 失败则保留门。
- recover：计划必须与 journal 逐字节一致，禁止 replan；接管协议写 claim、复验所有前序工件 inode 与字节、删旧门、取 recovery-cleanup 门；只向前结算；发现非本操作残留、多份 journal、前任仍存活等情况拒绝为 `wakeflow-mutation-manual-recovery`。`:6008-6482`。

**不变量与失败恢复**：journal 先于任何步骤写入；terminal closure 与 planDigest 绑定；publisher stage 是唯一无条件清扫的残留类。

**宿主差异**：无。

**现 TS 状态**：gate、intent、journal、recovery 已实现，journal 为单记录 CAS 文档而非追加；foundation 独占锁不自动打破，与维护门一致；config、gitignore、program-instruction、support-memory、orphan-gate、prepared-transaction 六个恢复 owner 不在发布闭包，只有 `maintain_workspace mode=recover` 可达。

**实现判断**：统一为一种锁语义，即不自动打破、显式恢复；6 个恢复 owner 通过 `maintain_workspace mode=recover` 或只读 verify 的建议路径对 Agent 可达；journal store 与 intent store 合并重复代码。

**待确认**：

- Q8 平台边界：旧实现只接受 darwin 与 linux，TS foundation 同样依赖 O_NOFOLLOW 与 euid。是否明确"不支持 Windows"写入需求与 README？建议明确。
- Q9 legacy 迁移入口 `wakeflow-bootstrap` 的 `explicit-migration`：现在是否还有使用 v2 或 legacy 布局的真实工作区？如果没有，按 ADR-0006 放弃迁移路径并在 E4 删除。

## 旧行为疑点

以下不预设新实现复制：

1. 根指令文件的归属在描述符与写入器之间矛盾，见 Q1。
2. README 声称 `.gitignore` 只加两个目录，代码在 Claude 侧还加 `.claude/settings.local.json`。
3. `remove-empty-static-dir` 死词汇，见 Q7。
4. `MISSING_FRESH_OWNERS` 永远为空，且上游阻塞导致 host-settings owner 未规划时被误报为 missing，测试还固化了这一行为。
5. 窗口运行投影的规划错误被空 catch 吞掉。
6. reconcile 对 stale 与 missing 投影既不阻塞也不报告。
7. preview 与 apply 的字段名不对称。
8. bootstrap 输出冒用 `wakeflow_maintain_workspace` 工具名。
9. `ledgerRoot` 名义可改实则永远阻塞，见 Q6。
10. 配置快照读取器与过渡权威严格度不一致。
11. `.wakeflow-active` 文件模式不一致。
12. Codex 激活范围永远 unknown，无人值守在 Codex 上结构性不可达。
13. 两个插件的模板 bundle 逐字节相同，只含两个 demand progress 模板。

## 确认记录（2026-09-03）

| 问题 | 裁决 | 落点 |
| --- | --- | --- |
| Q1 根指令文件 | 用户确认：工作区根不存在该文件时新建，存在时追加 Wakeflow 规则。实现为托管块；新建文件的内容即托管块本身 | 1.1 产物表；L1 managed-integration 切片 |
| Q2 嵌套守卫 | 实施者判断：fresh-initialize 扫描祖先目录，发现上级 `wakeflow.config.json` 即拒绝 | 1.1 不变量 |
| Q3 Claude 权限 | 用户确认：拒绝宽泛规则，只写 MCP 规则 `mcp__plugin_wakeflow_wakeflow`；tmux 权限由用户在 Claude Code 内自行授予，skills 文本提示 | 1.1 宿主差异；hosts/claude-code settings |
| Q4 statusline | 用户确认：保留，列入 L1 后期切片 | 1.1 宿主差异 |
| Q5 呈现语言 | 用户确认：`en \| zh-Hans`，不保留 `auto`。旧值处理与 Q10 联动 | 1.2 |
| Q6 ledgerRoot | 用户确认：初始化后不可变，reconfigure 直接拒绝 | 1.3 |
| Q7 孤儿目录 | 用户确认：对账不删除，只报告 | 1.4 |
| Q8 平台 | 用户确认：明确不支持 Windows，写入需求与 README | 1.5；requirements/README |
| Q9 legacy 迁移 | 用户确认丢弃全部历史版本：不识别、不迁移，初始化遇到任何 Wakeflow 标记只拒绝并列出；E4 删除迁移模块、分类目录与 48 MB 语料 | ADR-0008；1.1 不变量 |
| Q10 配置生成方式 | 用户确认：配置只由 fresh-initialize 与 reconfigure 产生，schema 由新 TS 自定且从 v1 起版，不兼容旧文件；物理产物永远由当前运行版本重新推导；任何 TS 之前的工作区一律重新初始化 | ADR-0008；TSD-16；1.2 |

## 补充确认（2026-09-04）

| 问题 | 裁决 | 落点 |
| --- | --- | --- |
| Q11 工作区根与产品仓库根 | 必须是不同目录；同目录一律拒绝初始化，理由是产品 worktree 会带着 Controller 规则文件（ADR-0010 后果） | 1.1 不变量；fresh-initialize 拒绝规则 |
| Q12 pods 拓扑 | `wakeflow.config.json` 增加 `pods[]`，初始化生成 `placement: primary` 的 `main`；pod 创建与关闭走配置事务（ADR-0010 D1、D6）。已落地 2026-09-10（pod 切片 9）：`pods[]{podId, name, placement, lifecycle: open \| closing, worktrees[], closing}`，每个窗口带 `podId`，codec 按 pod 分组校验基数，reconfigure 对 `pods` 差异报 `reconfigure-pods-change-unsupported`；gate-log §13.92 | 1.2；config schema |
