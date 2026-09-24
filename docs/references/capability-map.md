# 能力映射矩阵

> 状态：`active`
> 建立日期：2026-09-04
> 基线提交：`c0098e2`
> 上位文档：[plan §8.1 P0、§9](../plan/typescript-reimplementation-plan.md)、[ADR-0002](../decisions/0002-public-tool-surface.md)、[ADR-0006](../decisions/0006-legacy-capability-retention.md)、[ADR-0008](../decisions/0008-discard-legacy-and-new-version-series.md)、[ADR-0010](../decisions/0010-worktree-isolated-execution-and-converged-flow.md)
> 说明：本矩阵是 E3 能力覆盖的判定对象。它把旧 JavaScript 公共面的 31 项工具、初始化需求锚点 D1 到 D41 与 I3、两宿主差异逐行对应到新 TypeScript 的工具或内部 owner，并给出判定。判定词汇：`重切` 指能力保留、公共形状按单一 owner 重切；`缺席` 指能力保留但新实现尚未落地，列出落地层；`放弃` 指有意不实现，附理由与 ADR。旧实现不是对比基线，只是能力与需求证据（TSD-03）。

## 1. 旧公共工具 31 项

| # | 旧工具 | 能力组 | 新工具或内部 owner | 判定 | 落地层与备注 |
| --- | --- | --- | --- | --- | --- |
| 1 | `wakeflow_status` | 9 | `wakeflow_status`（带 demandId 即附路由或归档回执） | 重切 | 2026-09-18 L1 observation 切片 10（gate-log §13.94、§13.96）：治理层一次观察多域，每域独立隔离失败；pod 段、待认领摘要、已接受未合并列表、`policy` 生效值、去重排序上限 64 的 `nextActions`；`wakeflow_inspect_demand_route` 并入；hostOperations 删除（ADR-0012 D2）；场景 `card-09/status-and-verify` |
| 2 | `wakeflow_maintain_workspace` | 1 | `wakeflow_maintain_workspace` | 重切 | 已实现 fresh、reconfigure、reconcile 三动作；config 增加 `pods[]` 与窗口 `podId`（2026-09-10 pod 切片 9，fresh 生成 `main`，reconfigure 拒改 `pods`）；TSD-16 从 v1 起版已做（2026-09-19，gate-log §13.102）；managed-block 仓库与 external-owned 支撑面的托管块（对齐台账 G1）2026-09-21 落地（gate-log §13.106） |
| 3 | `wakeflow_replace_windows` | 2 | 窗口替换并入 `wakeflow_register_window_binding` 的替换操作 | 重切 | 已实现：`replace` 以旧绑定摘要 CAS 换代并退役旧声明（L1 endpoint 切片 2，ADR-0009）；场景 `card-02/window-replace`（本行判定于 2026-09-18 补记） |
| 4 | `wakeflow_register_window` | 2 | `wakeflow_register_window_binding` | 重切 | 已实现；窗口在配置里带 `podId`，worktree pod 的产品窗口握手带 worktree 回执（2026-09-10 pod 切片 9，gate-log §13.92） |
| 5 | `wakeflow_create_demand` | 4 | `wakeflow_create_demand` | 重切 | 已实现（demand 切片，确定性计划）；身份记 `podId`（缺省 primary），同 pod 已有活动 Demand 时 `pod-busy`（2026-09-10 pod 切片 9） |
| 6 | `wakeflow_add_task` | 5 | `wakeflow_plan_target_task` | 重切 | 已实现（tasking 切片）：追加型一次调用；锚点 `requirementRef` 指向需求包验收标准；谱系 `replacement`（旧目标 `superseded`）与 `continuation`；`taskPlanReview: user` 须回显 `planReview`；可选 `sectionAnchors`；字段集按能力卡 5 Q1 保持 |
| 7 | `wakeflow_prepare_delivery` | 6 | `prepare_delivery` 一次调用（含许可；实现与测试共用） | 已落地 | 2026-09-10 L1 delivery 切片 6a：`wakeflow_prepare_delivery` 合并旧三工具，prompt 为 Wakeflow 骨架加 Controller 三段（ADR-0012 D2；gate-log §13.84） |
| 8 | `wakeflow_record_delivery` | 6 | `record_delivery_outcome`（hook 记录惰性核对）、`rearm_delivery` | 已落地 | 2026-09-10：处置由 `user-prompt-submit` 记录或 Codex 发送返回派生；indeterminate 再调用重查；rearm 上限 3（gate-log §13.84） |
| 9 | `wakeflow_record_target_result` | 7 | `wakeflow_import_target_result` | 已落地 | 2026-09-10 L1 result-review 切片 7：定位符只解析同 Demand 受管证据记录并核摘要，报告文本隐私扫描，`branch` 与 `commit` 进结果记录，导入即签发 `wake-controller` 回调许可（gate-log §13.88） |
| 10 | `wakeflow_review_pack` | 7 | `wakeflow_inspect_target_result_review` | 已落地 | 2026-09-10：只读投影附回调状态、完成证据、`allowedDecisions`、逐步表与 approved 基线；回调内容由 `import_target_result` 返回（ADR-0012 D1；gate-log §13.88） |
| 11 | `wakeflow_reduce_results` | 7 | 并入评审 inspection 与评审 preview 的结果谱系 | 已落地 | 2026-09-10：`allowedDecisions` 由检查投影按分类路由派生，不再有独立归约写入；strict result-trace 并入评审 preview（能力卡 9 Q5） |
| 12 | `wakeflow_decide_review` | 7 | `wakeflow_record_implementation_review_decision`（`accept \| rework \| blocked \| escalate`）、`wakeflow_record_test_review_decision`（`accept \| request-another-attempt \| blocked \| escalate`） | 已落地 | 2026-09-10：`redesign` 删除；blocked 与 escalated 之后以带 `resumption` 的新决定回到同一结果；`resume_target_result_review` 与 `authorize_product_defect_remediation` 并入 escalate 路由（ADR-0012 D4 D5；gate-log §13.88）；2026-09-24：rework 记录时须至少一条 `failed` 独立检查——failed 检查就是返工投递交给目标的整改项，全 passed 的 rework 在记录时即拒（`rework-checks`），不再等到投递投影才拒（§13.119）；D6（§13.120）：rework 的 `implementationQuality` 不再限定 `defective`——satisfactory / unverified / defective 由 Controller 判断，accept 仍只接受 satisfactory；D7（§13.121）：accept 也接受 `needs-review` 结果，前提是决定的 `anchorEvidence` 把每个验收锚点绑到本 Demand 已登记的托管证据（blocker `anchor-evidence`），controller-only 需求包回到一轮 |
| 13 | `wakeflow_complete_demand` | 4 | `wakeflow_complete_demand`（完成即归档） | 重切 | 已实现（demand 切片）：preview 内嵌八道 verify 门与归档前置，apply 一个事务含归档、需求包 archived、活动根删除（ADR-0012 D3） |
| 14 | `wakeflow_continue_demand` | 4 | `wakeflow_continue_demand`（continue 与 record-decision） | 重切 | 已实现（demand 切片）：从归档重开、需求包回到 claimed、路由先要求新任务包；与 `plan_target_task` 分开（能力卡 4 Q3） |
| 15 | `wakeflow_record_evidence` | 8 | `wakeflow_record_evidence` | 已落地 | 2026-09-10 L1 evidence 切片 8：内核 `PublicationTransaction`（apply 重算计划、身份由内容派生、同内容 `already-recorded`）；来源 `managed-path \| observation \| link \| commit`，kind 闭集，隐私白名单加 `controller-confirmed`；`pod-worktree` 根随 pod 切片进表（gate-log §13.90） |
| 16 | `wakeflow_recover_state_transition` | 4 | 无 | 放弃 | ADR-0002：通用 recover 放弃，每个 preview/apply 工具自带 recover |
| 17 | `wakeflow_release_window_lock` | 2 | 工作声明释放 | 已落地 | endpoint 切片的 release-claim 加 delivery 切片的内核声明 `kernel/work-claims.ts`（ADR-0009；gate-log §13.84） |
| 18 | `wakeflow_view` | 9 | 无 | 放弃 | ADR-0006：通用读取违反脱敏边界；config 事实归 `wakeflow_status`，storage 归 `wakeflow_verify`，result-trace 并入评审 preview |
| 19 | `wakeflow_storage_preserve` | 8 | 无 | 放弃 | 能力卡 8 Q6：归档封存、清理删除，不再有第三种保留状态 |
| 20 | `wakeflow_archive` | 8 | 并入 `wakeflow_complete_demand` 与 `wakeflow_cancel_demand` | 重切 | 已实现（demand 切片）：归档包在 `<ledger>/archives/`，前置含无未释放工作声明，verify 报告入归档包（ADR-0012 D3） |
| 21 | `wakeflow_intake_test_card` | 5 | test 任务包的 `testContract`（`plan_target_task`） | 重切 | 已落地（2026-09-10 delivery 切片 6b）：独立测试卡与 `plan_test_card` 删除，测试合同随 test 任务包由 `plan_target_task` 追加，环境、窗口与实现基线由 Wakeflow 派生（ADR-0012 D4；gate-log §13.86） |
| 22 | `wakeflow_deliver` | 6 | 无；宿主执行由 Agent 按 skills 完成 | 放弃 | TSD-12：内容由 `prepare_delivery` 许可提供，执行证据由 `record_delivery_outcome` 按 hook 记录准入（2026-09-10 落地） |
| 23 | `wakeflow_next_work` | 3 | 待认领需求包查询 `wakeflow_inspect_board`（ADR-0011，2026-09-04 L1 requirement 落地） | 重切 | `inspect_todo` 已删除，看板查询列出需求包认领状态 |
| 24 | `wakeflow_claim_next` | 3 | 认领并入 `wakeflow_create_demand(requirementId)` | 重切 | 认领即创建；一个总控一次一个（ADR-0011） |
| 25 | `wakeflow_cancel_demand` | 4 | `wakeflow_cancel_demand` | 重切 | 已实现（demand 切片）：需求包置 `withdrawn`，释放本 Demand 的工作声明，有待评审结果时拒绝（能力卡 4 Q4） |
| 26 | `wakeflow_pod_open` | 2、4 | `wakeflow_pod` | 已落地 | 2026-09-10 L1 pod 切片 9：`intent.kind: create` 一次配置事务派生窗口集与 worktree 意图，状态由回执派生（gate-log §13.92） |
| 27 | `wakeflow_pod_record` | 2、4 | `wakeflow_pod` 加 `wakeflow_register_window_binding` | 已落地 | worktree 回执经 `register` / `replace` 的 `observation.worktree` 准入并写 `hosts/<host>/pods/<podId>/worktrees/`，无独立记录事件家族 |
| 28 | `wakeflow_pod_bind` | 2 | `wakeflow_register_window_binding` | 已落地 | pod 窗口就是配置里带 `podId` 的窗口，握手同一工具；`next` 只列同 pod 未登记窗口 |
| 29 | `wakeflow_pod_plan` | 2、4 | `wakeflow_pod` | 已落地 | create preview 给出窗口集与 worktree 意图，`inspect` 给出宿主执行说明与 Test 附加目录；design-request 与 test-access 放弃 |
| 30 | `wakeflow_prune_runtime` | 8 | 并入 pod 关闭 | 已落地 | close 第二段要求检出已由 Agent 处置，Wakeflow 只删自己的回执目录；对账只报告（观察切片） |
| 31 | `wakeflow_verify` | 9 | `wakeflow_verify` | 重切 | 2026-09-18 L1 observation 切片 10：工作区 14 门按名字排序（含 host-hook-channel、pod-execution-location、host-settings-assets、active-projection，2026-09-21 补回 window-runtime-projection，gate-log §13.111），`ok` 要求全部 pass，`unavailable` 与 `fail` 分开计数；带 demandId 复用 demand 切片的门；场景 `card-09/status-and-verify` |

统计（2026-09-18，L1 十片闭合）：重切或已落地 27，缺席 0，放弃 4。放弃项各有 ADR 或能力卡确认记录。

## 1.1 新公共工具清单（ADR-0013）

| 新工具 | 形状 | 吸收的旧工具 | 切片 |
| --- | --- | --- | --- |
| `wakeflow_maintain_workspace` | 效果 | maintain_workspace | workspace |
| `wakeflow_register_window_binding` | 追加（含 inspect 与 replace） | register_window、replace_windows、release_window_lock | endpoint |
| `wakeflow_publish_requirement` | 效果 | deliver（TODO 追加）、intake_todo（TS） | requirement |
| `wakeflow_inspect_board` | 读 | next_work、inspect_todo（TS） | requirement |
| `wakeflow_create_demand` | 效果 | create_demand、claim_next | demand |
| `wakeflow_complete_demand` | 效果（完成即归档） | complete_demand、archive、verify 前置 | demand |
| `wakeflow_cancel_demand` | 效果 | cancel_demand | demand |
| `wakeflow_continue_demand` | 追加 | continue_demand | demand |
| `wakeflow_plan_target_task` | 追加 | add_task、intake_test_card、plan_test_card（TS） | tasking |
| `wakeflow_prepare_delivery` | 追加（含许可） | prepare_delivery 三段、prepare_implementation_delivery 与 prepare_test_delivery 与 claim_target_host_effect（TS） | delivery（已落地 2026-09-10） |
| `wakeflow_record_delivery_outcome` | 追加（hook 记录惰性核对） | record_delivery target-outcome、record_target_host_effect_outcome（TS） | delivery（已落地 2026-09-10） |
| `wakeflow_rearm_delivery` | 追加 | record_delivery target-rearm、rearm_target_host_effect（TS） | delivery（已落地 2026-09-10） |
| `wakeflow_import_target_result` | 追加（返回回调与许可） | record_target_result、review_pack 与 controller 回传四步 | result-review（已落地 2026-09-10） |
| `wakeflow_inspect_target_result_review` | 读 | review_pack、reduce_results | result-review（已落地 2026-09-10） |
| `wakeflow_record_implementation_review_decision` | 追加 | decide_review、resume_target_result_review（TS） | result-review（已落地 2026-09-10） |
| `wakeflow_record_test_review_decision` | 追加 | decide_review、authorize_product_defect_remediation（TS） | result-review（已落地 2026-09-10） |
| `wakeflow_record_evidence` | 效果 | record_evidence | evidence（已落地 2026-09-10） |
| `wakeflow_pod` | 效果 | pod_open、pod_record、pod_bind、pod_plan、prune_runtime | pod（已落地 2026-09-10） |
| `wakeflow_status` | 读（带 demandId 附路由） | status、view config、inspect_demand_route（TS） | observation |
| `wakeflow_verify` | 读 | verify、view storage 与 verification | observation |

## 2. 旧内部能力（非公共工具）

| 旧能力 | 能力组 | 新 owner | 判定 | 依据 |
| --- | --- | --- | --- | --- |
| 活动投影 `index.md`、`workspace-current-status.md`、每 Demand `index.md` 与 `developer-progress.md` | 9 | 内核 `active-projection` 加治理层 `observation/active-projection-{facts, refresh}` | 重切 | 2026-09-18 切片 10：标记、指纹、四类目标分类、unsafe 整轮零写、投影锁内逐文件 CAS；每 Demand 页面在 `.wakeflow-active/projections/<demandId>/`；pod 段；Demand 变更、pod 创建与关闭、维护 apply 之后刷新；场景 `card-09/active-projection` |
| Claude 状态栏资产 | 9 | `hosts/claude-code/claude-code-statusline-asset.ts` 精确字节与摘要；维护操作 `claude-statusline-asset:install` 安装 0600 资产、`claude-statusline-settings:install` 把 statusLine 命令写进 `.claude/settings.local.json`（只改一键，0600） | 重切 | 2026-09-18 切片 10：label `<model> · <pod> · <window>`，main 省略 pod（能力卡 9 Q6）；资产由仓库测试以 node 执行验收，Claude 宿主真实会话未验证；2026-09-24 §13.117：同机制多一份 tmux 助手资产 `claude-code-tmux-asset.ts`（`claude-tmux-asset:install`，通用 `claude-code-host-asset-operation.ts`），工作区根 `settings.json` 多一条只放行该助手的 allow 规则 |
| Claude 活动监视 | 10 | 无；宿主 hook 观察取代 | 放弃 | 能力卡 10 Q3、ADR-0009 |
| 提示临时文件与清扫 | 10 | 无；Agent 自行选择粘贴方式 | 放弃 | 能力卡 10 Q4 |
| keep-live | 10 | 无 | 放弃 | 能力卡 10 Q1、TSD-12 |
| unattended、激活范围与门 | 10 | 无；推迟 | 放弃（推迟） | 能力卡 10 Q2、TSD-12 |
| legacy 识别与迁移、bootstrap | 1 | 无；初始化遇到任何 Wakeflow 标记只拒绝并列出 | 放弃 | ADR-0008 |
| 窗口租约 2 小时 | 2 | 工作声明加围栏令牌，过期只开恢复 | 重切 | ADR-0009 |
| 隔离执行位置授权 | 4 | pod 模型 | 重切 | ADR-0010 |
| sync-core 双制品同步 | 10 | `tooling/artifacts/build-plugin-artifacts.ts` 从一次共享编译产出双制品，`plugins/` 是纯生成物 | 已落地 | 2026-09-20 E4（gate-log §13.104）：`core/`、`tools/sync-core.mjs` 与 `check:core` 删除；requirements/typescript-dual-artifact-build.md |
| 校验器 17 类、冒烟四幕 | 10 | `tooling/artifacts/check-plugin-artifacts.ts`（`build:check`：临时重建逐字节对比 committed 制品、清单闭合、marketplace 条目）与 `tooling/artifacts/smoke-plugin-artifacts.ts`（`smoke:artifacts`：制品搬到仓库外跑五幕加 hook 一幕） | 已落地 | 2026-09-20 L3（gate-log §13.103）：工具数量来自制品自己的公共目录，不硬编码；候选合同导出集校验按能力卡 10 Q8 删除 |
| 五源版本一致与 `release:check` | 10 | `tooling/release/check-release-consistency.ts`，版本唯一输入 `assets/release/version.json`，起点 `1.0.0` | 已落地 | 2026-09-20 L3：五源、新序列、Node 24 引擎实跑核对、清单可发布、main、干净树、标签在 HEAD、本地 origin/main 同步；场景 `card-10/release-consistency` 以 tooling 测试接线 |

## 3. 宿主差异

| 能力组 | Codex | Claude Code | 共享形状 |
| --- | --- | --- | --- |
| 2 窗口握手 | Agent 用 Codex 线程能力开线程，回执为线程 id 与 cwd | Agent 调用 Wakeflow 发布的 tmux 助手开窗口并启动 `claude`，助手打印会话 id 与 pane 坐标的 observation（§13.117 D4） | 端点、工作声明、围栏令牌、回执准入 |
| 6 投递执行与 hook 证据通道 | 线程发送；hook 片段 `src/hosts/codex/codex-hook-fragment.ts` 渲染命令串加 `${PLUGIN_ROOT}`，用户在 `/hooks` 按定义哈希信任后生效；`notify` 插件发不了 | 粘贴与回车，控制模式为可选强观察；hook 片段 `src/hosts/claude-code/claude-code-hook-fragment.ts` 渲染 exec 形式加 `${CLAUDE_PLUGIN_ROOT}` | 信封、outcome、回读摘要、ambiguous 解决；hook 通道**已落地**：观察脚本 `src/entrypoints/wakeflow-hook-observer.ts` 把两宿主同名的四个事件写成同形记录，制品的 `hooks/observe.mjs` 与 `hooks/hooks.json` 由构建器渲染（2026-09-18 gate-log §13.97，已实现、宿主未验证） |
| ADR-0010 worktree | Worktree 线程，detached HEAD，结果导入前需建分支，默认保留 15 个 | `claude --worktree <name>`，分支 `worktree-<name>`，退出无改动自动清理 | porcelain 回执、pod 四状态、关闭先于会话归档 |
| 9 状态栏 | 无 | statusline 与 tmux 助手两份资产、`settings.local.json` | 无 |
| 10 命令面 | 无 slash 命令 | 4 个命令（`/wakeflow:init`、`/wakeflow:status`、`/wakeflow:next`、`/wakeflow:pod`；Claude Code 的插件命令一律带插件名前缀，2026-09-24 联合测试确认裸名 `/wakeflow-next` 不可解析，§13.119），且命令不承载技能之外的步骤 | skills 文本 |
| 10 制品 | manifest 含 `interface` 与 `skills` 路径，marketplace 无版本 | manifest 靠目录发现，MCP 项禁止 cwd 与 env，marketplace 有版本 | 五源版本一致 |

## 4. 需求锚点 D1 到 D41 与 I3

锚点原文见 [archive/wakeflow-initialization-generated-files-requirement-2026-08-05.md](../archive/wakeflow-initialization-generated-files-requirement-2026-08-05.md)。判定词汇：`保留` 指锚点在新体系继续成立；`重切` 指目标成立但形状改变；`放弃` 指随旧版本或旧能力一起放弃。

| 锚点 | 主题 | 新 owner 或能力卡 | 判定 | 备注 |
| --- | --- | --- | --- | --- |
| D1 | 一次性完整初始化与文件存在合法性 | 能力卡 1，maintenance fresh | 保留 | 场景 `card-01/fresh-initialize` |
| D2 | active 空状态文件 | 能力卡 9 活动投影 | 保留 | 根 index、workspace status、TODO 三表面 |
| D3 | local orientation README | 无 | 放弃 | 旧版已移除；新版本不生成 README |
| D4 | 未注册 window-config 与 window-runtime | 能力卡 2 | 重切 | 改为端点握手与绑定投影（ADR-0009） |
| D5 | ledger 预建深度与记录职责 | 能力卡 3 | 重切 | confirmation family 取消，requirement 记录改为需求包（ADR-0011） |
| D6、D7、D8 | Design 与 Test 内置与外部工作面 | 能力卡 1 | 保留 | wakeflow-managed 与 external 两种 ownership |
| D9 | 共享模板、Skill 与宿主生成物的 source ownership | 能力卡 10 | 重切 | TS 构建器产出，sync-core 删除 |
| D10 | reset 与 reconcile 职责 | 能力卡 1 | 保留 | maintenance reconcile 已实现 |
| D11 | 多窗口共享同一产品仓库 | 能力卡 2 | 保留 | 在 pod 作用域内（primary 每仓库至少一个，worktree pod 恰好一个；已落地 2026-09-10） |
| D12 | 离线定向、配置解释、存储视图、运行状态 | 能力卡 9 | 重切 | view 放弃，status 与 verify 承接 |
| D13 | config 分区与字段 | 能力卡 1 | 重切 | 增加 `pods[]` 与窗口 `podId`（已落地 2026-09-10）；TSD-16 从 v1 起版已做（2026-09-19，gate-log §13.102） |
| D14 | local 语义分区 | 能力卡 1 | 保留 | `runtime/shared`、`runtime/hosts/<host>`；`audit` 随 preserve 放弃缩减 |
| D15 | TargetResult 单一正典 | 能力卡 7 | 保留 | 状态根是唯一结果正典 |
| D16 | host identity 单一权威 | 能力卡 2 | 保留 | 绑定唯一持有真实句柄 |
| D17 | transport retention | 能力卡 8 | 保留 | archive 门成立后整链 prune |
| D18 | Pod host evidence retention | 能力卡 8 | 重切 | pod 记录在 config，证据在 Demand 根，回执在 `hosts/<host>/pods/`（已落地 2026-09-10） |
| D19 | compatibility lane | 无 | 放弃 | ADR-0008 |
| D20 | local runtime stable IDs | 能力卡 2 | 保留 | typed durable id |
| D21 | shared transport 四类职责 | 能力卡 6 | 重切 | group、packet、envelope、run 形状保留，执行移交 Agent |
| D22 | window identity 与 runtime projection | 能力卡 2 | 保留 | 初始化不写绑定，投递全链校验 bindingId |
| D23 | Claude window-host 混合文件 | 能力卡 2、6 | 重切 | locator 由 Agent 观察交回，不由 Wakeflow 维护 |
| D24 到 D28 | 双宿主 Pod 模型、manifest、operation、binding、test-access | ADR-0010 | 重切 | pod 四状态由回执派生、config 记录、无四类文件、无 Design 交接（已落地 2026-09-10，gate-log §13.92） |
| D29 | keep-live 记录与锁 | 无 | 放弃 | 能力卡 10 Q1 |
| D30 | Claude window-locators | 能力卡 2、6 | 重切 | 互斥语义留在工作声明，坐标由 Agent 观察 |
| D31 | Claude assets、activity-monitor、temp | 能力卡 9、10 | 重切 | statusline 保留为资产；monitor 与 temp 放弃 |
| D32 | runtime-meta | 无 | 放弃 | 旧版已退役 |
| D33 | preserved audit | 无 | 放弃 | 能力卡 8 Q6 |
| D34 | local initialize、reset、reconcile、storage 横向合同 | 能力卡 1 | 保留 | 统一 maintenance gate 与 journal |
| D35 | 顶层入口与 current 全局文件 | 能力卡 9 | 保留 | 活动投影 |
| D36、D37 | demand state root 核心文件与能力目录 | 能力卡 4 | 保留 | 形状按 TS 事件溯源根 |
| D38 | 全局职责闭环、目标生成树、迁移依赖 | 能力卡 1 | 重切 | 目标生成树保留；迁移依赖放弃 |
| D39、D40 | legacy 处置矩阵与 fixture 合同 | 无 | 放弃 | ADR-0008 |
| D41 | 开发阶段环境、权限与执行顺序 | 根 `CLAUDE.md`、`AGENTS.md` | 保留 | 仓库维护规则 |
| I3 | host decommission 与 activation scope | 能力卡 2、10 | 重切 | decommission 留在窗口替换；activation scope 随 unattended 推迟 |

## 5. 维护规则

- 每个 L1 切片闭合时，把对应行的 `缺席` 改为 `重切` 并写明场景编号。
- 新增公共工具时先在本矩阵登记来源能力与判定，再改 schema。
- E4 删除旧代码前，本矩阵不得有 `待决` 行；`放弃` 行必须能指向 ADR 或能力卡确认记录。
