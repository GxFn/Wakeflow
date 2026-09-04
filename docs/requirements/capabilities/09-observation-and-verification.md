# 能力组 9：观察与校验

> 状态：`confirmed`，Q1 到 Q7 于 2026-09-04 按建议裁决，记录见文末"确认记录"
> 建立日期：2026-09-04
> 旧实现基线：`core/`、`plugins/*` 于 `c0098e2`
> 上位文档：[ADR-0006](../../decisions/0006-legacy-capability-retention.md)（view 放弃、verify 保留）、[ADR-0009](../../decisions/0009-execution-endpoint-and-host-effect-handshake.md)、[ADR-0010](../../decisions/0010-worktree-isolated-execution-and-converged-flow.md)
> 说明：本组是只读面。它回答"现在是什么状态、谁该做下一步、工作区是否完好"，不写入、不修复、不授权。

## 9.1 状态定向

**场景**：任何窗口在行动前问一次"现在是什么状态、下一步谁负责"，得到一份不含私有路径的定向投影。

**旧实现**：

- `wakeflow_status operation=inspect`，只读，请求体只有 `{language}`。一次 `inspectWakeflowObservabilityV3` 观察同时构建 config、storage、status、verification 四份投影，然后由带不可伪造令牌的观察对象读回。`wakeflow-public-v3-runtime.mjs:817-825`、`wakeflow-observability-v3.mjs:2413-2450`。
- 采集 11 个域，每个域用 `domainRead` 隔离失败，单域失败只变成 `unavailable` 加 issueCode：descriptor、local、active、ledger、transport、leases、pods、binding、windowRuntime、maintenance、reconcile。`:697-770`。
- 对配置声明且已被存储视图证实存在的仓库做 git 观察：`GIT_OPTIONAL_LOCKS=0`，5 秒超时，连读两次必须逐字节一致否则记 `raced`。`:1951-2052`。
- 结果 `WakeflowStatusV3`：`overall` 取 maintenance > blocked > degraded > active > idle；`domains` 含 repositories、activeDemands、windowIdentity、windowRuntime、transport、leases、pods、hostOperations、projections、maintenance、ownershipContract、verification；`nextActions[]` 每项 `{owner, capability, reason, sourceRefs, subject?}`，去重排序上限 256；`writesPerformed` 恒 false。`:2203-2378`。
- 没有 TODO 域，没有 ledger 域；Claude 的 `/wakeflow:status` 命令要求再调一次 `wakeflow_next_work`。`commands/status.md:6-9`。
- 脱敏三层：四份投影的规范 JSON 里不得出现工作区根的词法路径与 realpath；`payload-private` 存储项只留 patternDigest；MCP 层再查一次。`:2384-2393`、`:1262-1271`、`wakeflow-mcp-tools.mjs:140-142`。

**不变量**：观察不写；同一次观察喂给 status 与 verify；投影里没有私有路径、会话句柄、摘要之外的内容。

**现 TS 状态**：`wakeflow_status` 已公开；观察与投影的实现由 governance 层的 inspection 承担，域集合以 TS 为准待对照。

**实现判断**：保留"一次观察、多份投影、同一令牌"的模式；`nextActions` 的形状保留；域集合按 ADR-0010 改：`pods` 域改为列出 pod 与其执行位置，`leases` 域改为工作声明，`hostOperations` 域删除，因为 keep-live 没有生产调用方；增加 `unmergedAccepted` 列表，即已接受未合并的分支。

**待确认**：

- Q1 status 是否继续对配置仓库做 git 观察（双读一致、5 秒超时），还是把 git 事实全部交给 Agent 回执？建议保留，因为它是"主线是否干净"的唯一机器证据。
- Q2 status 是否合并 TODO 板摘要，让 `/status` 不再需要第二次调用？建议合并，只给计数与待认领行的 id 与标题。

## 9.2 严格校验

**场景**：Controller 在初始化后、维护前、归档前要一份"工作区是否完好"的严格裁决，能失败但不能修。

**旧实现**：

- `wakeflow_verify operation=inspect`，与 status 共用观察。结果 `{kind: WakeflowWorkspaceV3Verification, configDigest, ok, gates[], summary{pass, fail, unavailable}, repairsApplied: false, observationDigest}`；`ok` 要求至少一个门且全部 pass；门按名字排序，每门 `{name, owner, status pass|fail|unavailable, code, evidence[{ref, digest}]}`。`wakeflow-observability-v3.mjs:1626-1777`。
- 15 个门：config-authority、local-layout、active-authority、ledger-authority、transport-authority、coordination-leases、pod-evidence、active-projection、window-identity、window-runtime-projection、maintenance-gate、owner-contract、managed-drift、repository-roots、storage-inventory。配置无效时只剩第一个门。
- reconcile 只作为只读事实被消费，verify 从不返回行动计划，计划摘要只出现在门的证据里。
- Claude `check` 命令要求"权威阻塞与诊断细节分开报告；损坏项与 legacy 项不能贡献就绪或下一步"。`commands/check.md:11-18`。
- `view operation=verification` 返回与 verify 逐字节相同的对象，两个公共入口一份投影。

**不变量**：`repairsApplied` 恒 false；`unavailable` 不是 pass，会让 `ok` 为 false；门的证据只有 ref 与摘要。

**现 TS 状态**：内部有校验逻辑，无公共入口。ADR-0006 已定：保留为公共只读入口。

**实现判断**：门集合按新边界重排：删 pod-evidence 与 managed-drift 的旧形状，coordination-leases 改为 work-claims，新增 host-hook-channel（hook 记录目录可读且最近记录自洽）与 pod-execution-location（每个活动 pod 的 worktree 回执与 `git worktree list --porcelain` 一致）；`unavailable` 与 `fail` 在 `summary` 里分开计数的做法保留。

**待确认**：

- Q3 `ok` 是否继续把 `unavailable` 当作不通过？建议是，但 `summary` 里分开报，让 Agent 能区分"坏了"与"没看到"。
- Q4 verify 是否成为归档与 pod 关闭的必经前置，即这两个 apply 要求最近一次 verify 的 `observationDigest`？建议是。

## 9.3 视图读模型

**场景**：旧实现里的 `wakeflow_view` 提供 config、storage、verification、result-trace 四个读模型。

**旧实现**：

- config 视图返回拓扑、存储、治理、宿主、运行时 profile、固定协议根，并为每个指针标注 `durable-input | fixed-protocol | host-profile-default | derived-placement`；宿主 launch 只留模型与权限字段，tmux 只留"已配置"与字段名。`:855-925`。
- storage 视图列出最多 4,096 个存储项，每项带 owner、class、期望存在性、健康、敏感度、生命周期与 owner 动作；附五条 `forbiddenConclusions`，如"存储健康不授权修复或删除"。`:1411-1585`。
- result-trace 有 `mode strict | diagnostic`：strict 取锁读权威并给 `authorityEligible: true` 与 `nextAction`；diagnostic 不取锁只给状态修订与传输投影。`wakeflow-result-review-orchestration.mjs:1015-1069`。
- 四个操作全部触发完整观察，config 视图也要付 git、传输、Pod、租约与 reconcile 的代价。

**现 TS 状态**：无。ADR-0006：view 放弃，理由是通用读取违反脱敏边界；但插件内 `check.md`、SKILL 与 README 仍在教它。

**实现判断**：维持放弃。config 事实由 `wakeflow_status` 的 `config` 段提供摘要与 valueSources；storage 事实归入 verify 的 storage-inventory 门与 status 的 `storage` 段；result-trace 的 strict 形态并入评审入口，即评审 preview 顺带返回结果谱系，diagnostic 形态删除。

**待确认**：

- Q5 result-trace 的 strict 形态并入评审 preview，是否同意？建议同意。

## 9.4 活动投影与状态栏

**场景**：开发者不调工具也能在 `.wakeflow-active/` 看到一份导航与当前状态；Claude 状态栏显示"模型 · 窗口名"。

**旧实现**：

- 投影文件：`index.md`、`current/workspace-current-status.md`（标记 `wakeflow:active-projection:v1:sha256:<64hex>`）、`current/<demandId>/index.md` 与 `developer-progress.md`（标记 `wakeflow:demand-projection:v1:sha256:<64hex>`）；模式 0600；上限 8 MiB。`wakeflow-active-projector.mjs:80-98`。
- 刷新指纹绑定投影器版本、语言、配置摘要、模板资产、authority 源摘要与每个 Demand 的 demand、authority、state、事件历史、文档、结果摘要；有意忽略 mtime、TODO 内容与本地运行时。`:1120-1178`。
- 目标文件分类 current、missing、stale、unsafe；unsafe 含符号链接、非文件、硬链接数不为 1、不可读、没有标记即手写；任一 unsafe 整轮零写。重建在投影锁内，前后 planSignature 不一致返回 `source-stale`；逐文件 CAS 写。`:1240-1298`、`:1482+`。
- 触发矩阵 `ACTIVE_SOURCE_MUTATIONS`：TODO、窗口身份与运行时、传输、租约、保留与纯 Pod 观察都不触发写。`wakeflow-public-v3-runtime.mjs:203-220`。
- Claude 状态栏资产装在 `.wakeflow-local/runtime/hosts/claude-code/operations/assets/statusline.mjs`，0600；命令行以 base64url 传工作区根，从不从 cwd 推断；stdin 是 Claude 的 statusline JSON，上限 256 KiB，取 session_id 与模型名；读 `wakeflow.config.json` 与窗口绑定目录找 `claude-session` 句柄匹配的窗口；打印恰好一行 `<model> · <label>`。冒烟要求 stderr 为空、单行、无控制字符、不含工作区根。`wakeflow-claude-settings.mjs:85-253`、`:633-690`。

**不变量**：手写文件永不被覆盖；投影只是导航，机器记录才是权威；状态栏输出不含路径、句柄与摘要。

**现 TS 状态**：活动投影未实现；状态栏资产未实现。

**实现判断**：投影文件与标记规则保留，按 ADR-0010 在 workspace-current-status 里增加 pod 段（每个 pod 的执行位置、活动 Demand、已接受未合并分支）；触发矩阵保留，增加 pod 创建与关闭。状态栏资产保留，label 改为 `<pod> · <window>`，main 省略 pod 前缀；它是 Claude 宿主制品，由 Agent 按初始化计划安装，Wakeflow 只校验字节与模式。

**待确认**：

- Q6 状态栏 label 改为带 pod 前缀，是否同意？建议同意。
- Q7 `developer-progress.md` 是否保留为每 Demand 一份，内容按能力卡 4 的确认渲染状态、进度与最近事件？建议保留。

## 旧行为疑点

1. verification 在 view 与 verify 两处公开，逐字节相同。
2. 四份投影每次全算，config 视图也付全部观察代价。
3. `unavailable` 在顶层与 `fail` 不可区分，只能看门的 code。
4. 存储项超过 4,096 截断即 `blocked`，体积问题被当成健康裁决。
5. local-layout 门只对 `host-settings-assets-owner` 有一条硬编码豁免。
6. `hostOperations` 域按前缀折叠 keep-live 与宿主事件，keep-live 一半永远为空。
7. 状态栏绕过绑定服务直接读绑定目录，绑定 schema 变化时静默退化为 cwd 名。
8. view 已记为放弃但制品仍在教。

## 确认记录（2026-09-04，按建议）

| 问题 | 裁决 | 落点 |
| --- | --- | --- |
| Q1 status 的 git 观察 | 保留：对配置仓库双读一致、`GIT_OPTIONAL_LOCKS=0`、5 秒超时 | status 观察 |
| Q2 status 合并 TODO 摘要 | 合并，只给计数与待认领行的 id 与标题 | status 投影 |
| Q3 verify 的 ok | `unavailable` 算不通过，`summary` 里与 `fail` 分开计数 | verify 投影 |
| Q4 verify 作为前置 | 归档 apply 与 pod 关闭要求最近一次 verify 的 `observationDigest` | 归档与 pod 准入 |
| Q5 result-trace 与 view | strict 形态并入评审 preview，diagnostic 删除；config 事实归 status，storage 事实归 verify | 评审 preview、status、verify |
| Q6 状态栏 label | `<pod> · <window>`，main 省略前缀 | Claude 状态栏资产 |
| Q7 developer-progress.md | 保留为每 Demand 一份，按能力卡 4 Q6 渲染 | 活动投影 |
