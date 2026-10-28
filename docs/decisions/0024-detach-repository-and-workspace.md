# ADR-0024 退出路径：`detach-repository` 与 `detach-workspace`

> 状态：accepted（2026-10-26，用户按[测试门与 1.2 计划](../reviews/2026-10-22-test-gate-and-1.2-plan.md) §3.7、§5 与[Codex 审阅修复计划](../reviews/2026-10-22-codex-review-response-and-replan.md) §4 批 E 裁定："全部按照建议"）
> 提出日期：2026-10-26
> 裁决日期：2026-10-26
> 基线提交：`0b606c08`
> 相关：open-items Q9、J1、M4、V7；能力卡 01、02；ADR-0003（宿主效果由 Agent 执行）、ADR-0009（观察器只写记录）；gate-log §13.217

## 背景

维护请求是封闭的 `oneOf`（fresh-initialize / reconfigure / reconcile 各 preview|apply，加 recover），动作词汇与十五种步骤种类都是封闭清单；reconfigure 拒绝一切删改（`reconfigure-repository-removal-unsupported` 等六个码）。Wakeflow 写到控制工作区之外的只有三类：产品仓库的外部指令块与仓库 `.gitignore` 块（都是按精确正文准入的受管文本）、Claude 的允许规则（程序根与托管支撑面，退役规则已能精确删除）、Claude 的 `statusLine`（只对所有权判定为 Wakeflow 的那一条）。进得去、出不来：用户删一个仓库或停用整个工作区只能手工清理，而手工清理会撞上受管文本的精确准入与门。

## 问题

退出路径要删什么、在什么条件下删、删不掉时怎么说、终态是什么，以及它如何与既有的 preview/apply/recover 事务、受管文本历史、Demand 与 pod 的占用关系共用边界而不新建一套状态机。

## 选项

### 选项 A：在 reconfigure 里放开删除

把"删除仓库/窗口"当作配置变更的一种。问题：reconfigure 的语义是"配置文法允许的拓扑变更"，而删除牵动工作区之外的三类写入与占用检查，混在一起会让每次 reconfigure 都背上退出路径的阻塞与步骤。

### 选项 B：两个新动作，各有 preview/apply，走同一事务（建议）

`detach-repository {repositoryId}` 与 `detach-workspace {}`，复用静态物化 preview 的步骤表、执行计划的"共享步在前、宿主步依赖前一共享步"顺序、同一份 journal 与 recover。新增步骤种类只覆盖"删"，每一步都按既有的精确准入判断能不能删。

### 选项 C：只写一份"停用 Wakeflow"手册

不实现，README 列出所有写入位置让用户手删。问题：受管文本的精确准入会让手删后的 verify 变红，而且用户在 Codex 与 Claude 两边要分别记住删哪些。

## 建议

选项 B，合同如下（名字是闭合词汇，实现与测试逐字使用）。

**请求（公开维护请求 Schema，封闭 `oneOf` 加两支）**：`detachPreviewRequest { root, mode: "preview", action: "detach-repository" | "detach-workspace", request: { repositoryId? } }` 与 `detachApplyRequest { …, mode: "apply", planDigest }`；`detach-repository` 要求 `repositoryId`，`detach-workspace` 不接受它（在代码里准入，Schema 保持两支以省目录预算）。`WAKEFLOW_STATIC_MATERIALIZATION_ACTIONS` 加这两个动作。

**步骤种类（闭合清单新增五种）**：
- `remove-managed-block`：删除一个受管文本块——产品仓库的外部指令块；detach-workspace 另加工作区根 `.gitignore` 块与工作区自己的程序指令块（`CLAUDE.md`/`AGENTS.md`；`targetKey` 区分。实现核对：仓库级 `.gitignore` 托管块不存在，`.gitignore` 块只在工作区根）。只有当前正文等于期望渲染或某条已登记的历史渲染（`WAKEFLOW_EXTERNAL_INSTRUCTION_BODY_HISTORY` 等）才删；块删掉后文件为空则删文件，否则保留其余内容；正文未知即阻塞 `detach-unknown-managed-body:<targetKey>`（另一个工作区的块同样未知，不碰）。
- `retire-window-projections`：退役被分离仓库的窗口投影（detach-workspace 为全部窗口），复用 pod 关闭的投影退役。
- `remove-portable-settings-rules`（仅 Claude，宿主步）：在程序根与托管支撑面精确删除 Wakeflow 当前与退役的允许规则条目；文件里没有 Wakeflow 规则即 current；文件读不出或不是 JSON 即阻塞 `detach-settings-unreadable:<root>`。
- `remove-statusline-entry`（仅 Claude，宿主步）：只删所有权判定为 Wakeflow 的那一条 `statusLine`；用户自己的不碰。
- `retire-config`（仅 detach-workspace 的终态步）：把 `wakeflow.config.json` 改名为 `wakeflow.detached.json`（不删，留证据）。
`detach-repository` 以既有 `publish-config` 发布去掉该仓库及其 primary-pod 窗口的配置；Codex 没有宿主步。

**前提阻塞**（实现另有 `detach-repository-unknown`、`detach-repository-last`、`detach-demands-unavailable`，请求体缺/多 `repositoryId` 为 invalid-request）：`detach-pod-open:<podId>`（含该仓库的 worktree pod 未关闭；detach-workspace 对任何打开的 pod）、`detach-demand-active:<demandId>`（活动 Demand 有该仓库的目标；detach-workspace 对任何活动 Demand）。阻塞让 preview 为 blocked、`planDigest` 为 null，apply 重算同路得 `plan-blocked`。

**不碰并列出**：`.wakeflow-active`、`.wakeflow-local`、账本、支撑面目录、worktree 检出、分支、插件级 hooks 一律不碰；detach-workspace 的结果带 `leftBehind: string[]`（`.wakeflow-active`、`.wakeflow-local`、`ledger-root:<相对路径>`、`support-surface:<相对路径>`、`worktree-checkouts`、`branches`、`plugin-hooks`），README 的"停用 Wakeflow"一节同样列出。

**终态之后**：`wakeflow.config.json` 不在而 `wakeflow.detached.json` 在时，`wakeflow_status` 以该文件为只读来源报 `overall: "detached"`、`next` 无 owner；`wakeflow_verify` 不失败、同样报 detached；reconcile 与 reconfigure 的 preview 阻塞 `workspace-detached`；fresh-initialize 的 preview 阻塞 `detached-file-present`（用户先把 detached 文件移走）。

**文本**：根 README 与制品 README 加"停用 Wakeflow"一节（两条意图、会删什么、不会碰什么），`commands/init.md` 一句指向，Controller 的 `workspace-and-windows.md` 把"删除被拒绝"改为"删除走 detach"（该文件在 400 行预算上，需压缩他处）。

**测试**：两个动作的 preview 零写 / apply / recover、每个阻塞、已知渲染与未知正文、detached 之后的 status / verify / reconcile / fresh、Claude 规则与 statusLine 的精确删除、链末尾加 `card-11/detach-workspace`（场景数 25 → 26，CLAUDE.md 与标准同步）；能力卡 01、02 补充。

## 后果

- 退出路径与进入路径共用事务、journal、recover 与受管文本准入；没有第二套状态机。
- 受管文本只在"正文可证明是 Wakeflow 写的"时删除——历史渲染表是删除的授权来源，所以改渲染器时登记旧渲染的纪律（CLAUDE.md）同时保护退出路径。
- `wakeflow.detached.json` 是有意留下的证据：它让 status/verify 能说"这里曾是 Wakeflow 工作区"而不是报配置缺失；重新启用要用户显式移走它。
- 公开目录预算：两支请求与 `leftBehind` 约 600 字节，当前余 1,086；若不够，先压维护请求 Schema 里的长说明。

## 未决问题

- 分离后 worktree 检出与分支的清理是否要给一条建议命令（现只列出，不建议）。
- Codex 安装目录布局仍未在仓库里确认（V6 的现场核对项），detach 对 Codex 只做共享步。
