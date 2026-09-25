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

**现 TS 状态**（2026-09-18 L1 observation 切片 10，`src/capabilities/observation/`）：`wakeflow_status{root, demandId?}` 走内核 `runCommandShell`；治理层 `observeWorkspace` 一次观察多域（活动布局、看板、活动 Demand、工作声明、每宿主绑定与 hook 通道、pod 回执、仓库指针文件、状态栏资产），每域独立隔离失败为 `unavailable` 加 issue；`overall` 取 maintenance > blocked > degraded > active > idle；`board` 只给计数与待认领行（Q2）；`pods[]` 列执行位置、活动 Demand 与 worktree 回执，closing pod 附处置引导；`repositories[]` 只读 `.git` 指针文件，不 spawn git（Q1 修订）；`unmergedAccepted[]` 列已接受实现结果中分支仍在且尖端不等于当前分支尖端的项（带 `acceptedAt` 与 `repositoryObserved`），不设阈值；`policy` 报生效常量（阈值不进配置，gate-log §13.94 D7）；`nextActions` 去重、确定性排序、上限 64；带 demandId 时附 Route 或归档回执，`wakeflow_inspect_demand_route` 删除。场景 `card-09/status-and-verify`。

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

**现 TS 状态**（2026-09-18 切片 10；2026-09-25 §13.127 增至 15 门，见本节末）：`wakeflow_verify{root, demandId?}` 公开；工作区 14 门按名字排序：config-authority、local-layout、ledger-layout、board-consistency、demand-root-audit、work-claims、append-candidates-clear、evidence-integrity、host-hook-channel、window-identity、window-runtime-projection（每个宿主对每个配置窗口的运行投影都等于当前 Config 加 Binding 的重算；同伴宿主的运行时根缺席与 hook 通道同一裁决保持沉默；2026-09-21 G6，gate-log §13.111）、pod-execution-location、host-settings-assets、active-projection；`ok` 要求全部 pass，`unavailable` 在 `summary` 里与 `fail` 分开计数（Q3）；带 demandId 时 `demand.gates` 复用 demand 切片的门（research Demand 加 `research-evidence`）；`repairsApplied` 恒 false。归档与 pod 关闭不以 verify 的 `observationDigest` 为前置（Q4 修订）。场景 `card-09/status-and-verify`。

2026-09-25 §13.127（对齐第六轮）：第 15 门 `runtime-artifact`（owner `runtime`）——MCP 服务进程启动时读到的制品 `artifact-manifest.json` 摘要要等于现在磁盘上的（否则 `server-outdated`：制品在进程脚下更新了，本窗口的服务要重连），且每个已登记窗口的绑定会话最近一次 session-start 记录里的 `artifactManifestDigest` 要等于它（否则 `windows-stale:<n>`：这些窗口在旧制品下启动，用助手 `resume` 换到当前制品）；没有 manifest 可比的运行（测试构建）记 `not-applicable` 而 pass。hook 记录新增可选键 `artifactManifestDigest`（观察脚本从自身所在制品读，旧记录读成 null）；`wakeflow_status` 顶层新增 `runtime{artifactManifestDigest, artifactOnDisk: same | changed | unknown}`，每个窗口新增 `artifact: current | stale | unknown`，`nextActions` 新增 `runtime-artifact-outdated`（owner user）与 `window-artifact-stale`（owner controller，subject 为 windowId）。现场：八个窗口在旧制品下启动时全为 `unknown`（旧记录无摘要）→ 用助手逐个 resume / launch 后全为 `current`；用改过 manifest 的制品副本起服务，八个窗口全 `stale`、门报 `windows-stale:8`；服务运行中再改 manifest，`artifactOnDisk: changed`、门报 `server-outdated,windows-stale:8`。

2026-09-25 §13.129（对齐第八轮）：工具描述改为十五个门的完整清单（此前仍写 "thirteen gates"）。被打断的维护 apply 由 local-layout 门经预览的核心布局检查报 `maintenance-protocol-<状态>`；status 顶层新增 `maintenance{status, protocol}`（idle / busy / recovery-required / conflict / absent / bootstrap-prefix，读不出为 unknown），非 idle 即 `overall: maintenance`、next 指向 `workspace-maintenance`——旧实现的 maintenance 域与 maintenance-gate 门在新实现里的落点。切片测试补旧实现 T08 的三条不变量：status 与 verify 零写（目录树逐节点比对）且同时钟下逐字节确定；配置里的 tmux 会话名与 socket 名、句柄、一次性目录根不进结果；非工作区目录是 `precondition-failed / config-authority` 且零写。冒烟对每个工具结果扫一次性目录根（旧实现 T10 的私有路径门）。

2026-09-25 §13.130（残留清理）：status 的 `unmergedAccepted` 另从仍在配置里的 worktree pod 的归档 Demand（完成与撤销）派生，条目带 `source: active | archived`，读不出的归档计入 `domains.archives`（`archives:unreadable-<n>`），扫描上限计入 `truncated.archives`，只在全作用域读；`maintenance` 新增 `residues[{name, kind, operationId, recoverable}]` 与 `residuesOmitted`，维护进行中（busy）的条目不标可恢复；verify 的 local-layout 门先做私有模式普查，按区域点名 `private-mode-drift-<n>:<区域>` / `private-mode-unsafe-<n>:<区域>`（区域是私有树里至多三段的最小覆盖，至多三个）。

**实现判断**：门集合按新边界重排：删 pod-evidence 与 managed-drift 的旧形状，coordination-leases 改为 work-claims，新增 host-hook-channel（hook 记录目录可读且最近记录自洽）与 pod-execution-location（每个活动 pod 的 worktree 回执与 `git worktree list --porcelain` 一致）；`unavailable` 与 `fail` 在 `summary` 里分开计数的做法保留。旧 verify 的同名门 window-runtime-projection 在第二轮对齐时补回（G6）：`wakeflow_status.windows[].projection` 逐窗口报新鲜度（各宿主里最差的一份：current / stale / missing / unsafe / unavailable），`domains.windowRuntime` 报域可用性，缺失或过期把 `next` 指向维护（reconcile 重建，G5），unsafe 只报告。

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
- 2026-09-24 §13.117 D4：同目录另装 tmux 助手资产 `tmux.mjs`（0600，`claude-tmux-asset:install`），子命令 preflight / launch / self / mark / panes / deliver / close，从自身位置推导工作区根；`host-settings-assets` 门把它作为状态栏资产的伴随资产核对，字节、模式或缺席问题以 `claude-code:tmux.mjs:<status>` 报出。

**不变量**：手写文件永不被覆盖；投影只是导航，机器记录才是权威；状态栏输出不含路径、句柄与摘要。

**现 TS 状态**（2026-09-18 切片 10）：活动投影由内核 `src/kernel/active-projection.ts`（文件格式、标记、指纹、四类目标分类、unsafe 整轮零写、投影锁内逐文件 CAS）与治理层 `observation/{active-projection-facts, active-projection-refresh}` 实现；每 Demand 页面在 `.wakeflow-active/projections/<demandId>/{index.md, developer-progress.md}`，不进 Demand 根；`workspace-current-status.md` 含 pod 段；Demand 变更、pod 创建与关闭、维护 apply 之后由各切片经 `afterMutationRefresh` 刷新，只吞 io-failure；`developer-progress.md` 渲染六个进度计数与最近事件标识。状态栏资产 `src/hosts/claude-code/claude-code-statusline-asset.ts` 给出精确字节与摘要，维护操作 `claude-statusline-asset:install` 装到 `runtime/hosts/claude-code/operations/assets/statusline.mjs`（0600）；维护操作 `claude-statusline-settings:install` 把 `statusLine` 命令写进 `.claude/settings.local.json`（只改这一键，0600）。场景 `card-09/active-projection`；资产由 `tests/hosts/claude-code/claude-code-statusline-asset.test.ts` 以 node 执行验收。 2026-09-25 §13.129：投影事实多一个 `demandCoverage`（complete / incomplete / unobserved）——这一轮有活动 Demand 读不出时，两份工作区页在 Demand 列表前加一条"可能缺项"的提示并进工作区指纹，不再把读不出的 Demand 悄悄丢掉而看起来像 idle（旧实现 T09 的"读不出不得投影成 idle"）；fresh 初始化那条路记 unobserved，与 complete 同字节。

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

## 修订（2026-09-18，[gate-log §13.94](../../progress/consolidation-gate-log.md)）

| 项 | 修订后 |
| --- | --- |
| Q1 status 的 git 观察 | Wakeflow 不 spawn git（与 gate-log §13.91 D4 一致）：`repositories[]` 只读 `.git/HEAD`、`refs/heads/**`、`packed-refs` 与 `.git/worktrees/<name>/{gitdir, HEAD}`，报告 HEAD、当前分支、登记的 worktree 与 prunable；工作树是否干净不观察，Wakeflow 没有判定依赖它。`unmergedAccepted[]` 定义为已接受实现结果中分支引用仍在仓库、且尖端不等于仓库当前所在分支尖端的项（正检出在该分支上或分离头时不判已合并；仓库未观察时保留并标 `repositoryObserved: false`），全部列出不设阈值，ADR-0010 未决项"提醒阈值"就此关闭 |
| Q4 verify 作为前置 | 归档不另设前置：完成即归档在 preview 内嵌 demand 切片的 verify 门；pod 关闭不要求最近一次 verify 的 `observationDigest`，`pod-execution-location` 门是对账的唯一出口 |
| Q6 状态栏资产的安装 | 按 D6 落地为两条维护操作：`claude-statusline-asset:install` 安装并校验资产字节（0600、摘要），`claude-statusline-settings:install` 把 `statusLine` 命令写进 `.claude/settings.local.json`（只改这一键，其他键原位保留，0600；命令带 base64url 的根，所以只能进忽略的私有本地文件，不进可提交的 `settings.json`）；文件不是 JSON 对象时不猜，贡献 blocked（`claude-settings-local-unreadable`）；verify 的 `host-settings-assets` 门对资产与设置条目各投一票；2026-09-24 起同一票还核对伴随资产 `tmux.mjs`（`claude-tmux-asset:install`，§13.117 D4） |
| Q7 developer-progress.md | 首版渲染当前状态、六个进度计数与最近事件标识；"最近十条事件"待 L2 场景需要再加 |
| 阈值配置化（gate-log §13.83 D7 遗留） | 本片不进配置：静默 10 分钟、回调代际上限 4、第三次 rework 刹车、声明恢复窗口 2 小时由治理层一张 `policy` 表导出并在 status 原样报告；配置化记入 ADR-0012 未决项 |
