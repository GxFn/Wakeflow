# 能力组 10：自动化与运维

> 状态：`confirmed`，Q1 到 Q8 于 2026-09-04 按建议裁决，记录见文末"确认记录"
> 建立日期：2026-09-04
> 旧实现基线：`core/`、`plugins/*` 于 `c0098e2`
> 上位文档：[ADR-0003](../../decisions/0003-host-effect-layer-ownership.md)（Agent 执行宿主效果）、[ADR-0006](../../decisions/0006-legacy-capability-retention.md)、[ADR-0008](../../decisions/0008-discard-legacy-and-new-version-series.md)、plan TSD-12（keep-live 与 unattended 推迟）
> 说明：本组大半在新边界下要么推迟、要么移交 Agent、要么随旧版本删除。卡片记录旧事实，是为了在删除时知道删掉了什么，而不是为了重建。

## 10.1 keep-live

**旧实现**：`wakeflow-keep-live-service.mjs` 1,770 行加 records 625 行，四种记录 `leases/<automationRunId>.json`、`process.json`、`control.json`、`manager.lock`，能力词汇 `macos-caffeinate | disabled | unavailable`；只产出宿主操作描述，不启动 caffeinate、不发信号。**没有生产调用方**：ensure、release、reconcile 只出现在校验器的导出合同里，唯一接线是布局巡检的清单读取。`wakeflow-keep-live-service.mjs:11-12`、`wakeflow-validate.mjs:1054-1060`、`wakeflow-local-layout-inspection.mjs:748`。

**现 TS 状态**：无。TSD-12 已推迟。

**实现判断**：整体删除，不保留记录与 schema。新边界下"保持宿主不休眠"是开发者对宿主的操作，与 Wakeflow 无关。

**待确认**：

- Q1 keep-live 连同记录形状与 schema 一并删除，不留"未来宿主"占位，是否同意？建议同意。

## 10.2 unattended 与激活范围

**旧实现**：

- 激活范围词汇 `per-workspace | host-wide | unknown`；证据种类 `exact-host-installation-observation | host-observation-unavailable`；unknown 原因四种。Claude 的映射：任何 user 或 managed 级安装即 host-wide；任何 session 级即 unknown；全部 project 或 local 且主题摘要等于本工作区才是 per-workspace。`wakeflow-host-activation-scope.mjs:12-30`、`wakeflow-claude-activation-scope.mjs:218-243`。
- 门：`cutover ≠ v3-ready` 一律 blocked；per-workspace 才 ready 且 `unattendedEligibility: eligible`；host-wide 与 unknown 经手工确认最多到 manual-host-gate，永不 ready。`wakeflow-host-activation-gate.mjs:325-360`。
- `/wakeflow:unattended on|off` 走 reconfigure 的 preview 与 apply，要求显式确认宿主动作可以免逐项提示；窗口重启是另外的宿主效果。`commands/unattended.md:6-27`。
- 观察适配器需要注入，制品里没有实际的 `observeInstallation`，结果永远 unavailable。`wakeflow-claude-activation-scope.mjs:268-278`。

**现 TS 状态**：无。TSD-12 已推迟。

**实现判断**：unattended 整体推迟，不进入新版本的第一序列。激活范围与门的分类是纯函数且宿主中立，但没有消费者时不保留；等 unattended 重新进入范围再从本卡重建。用户在 Claude Code 里自行授予权限，这在能力卡 1 已确认。

**待确认**：

- Q2 激活范围与门的词汇随 unattended 一起推迟，不在新版本里保留空实现，是否同意？建议同意。

## 10.3 活动监视与临时提示清扫

**旧实现**：

- Claude 活动监视：每个 tmux 服务器上下文一个目录，`process.json` 加 `manager.lock`；轮询默认 1.5 秒；一个窗口需要恰好一个元数据匹配的活 pane，其当前命令是 Claude 且能捕获；"运行中"判定是捕获文本匹配 `esc to interrupt` 或 pane 摘要较上一轮变化；把结果写成 tmux 窗口选项 `@wakeflow_state`，先保存旧值到 `@wakeflow_prev_state`，空闲时恢复；结果自称"只是诊断投影"。`wakeflow-claude-activity.mjs:48-76`、`:1690-1709`、`:1784-1864`。
- 提示临时文件：默认内存传递；路径适配器写 0600、上限 1 MiB 的 `workspace-mutation_<uuid>.txt`；清扫用本地时钟、拒绝任何 invalid、unverifiable、live 条目、只删严格过期的孤儿。`:2168-2172`、`:2385-2436`。
- 宿主命令面 23 个封闭命令含 activity-ensure、activity-inspect、activity-stop、prompt-temp-inspect、prompt-temp-sweep、activation-scope。`wakeflow-claude-host.mjs:54-77`。

**现 TS 状态**：无。

**实现判断**：活动监视删除。ADR-0009 已把宿主 hook 定为第二证据通道：Claude 的 31 个 hook 事件与 Codex 的 `notify` 给出 turn 开始与结束的精确事实，不再需要抓屏幕文本猜"运行中"。提示临时文件随投递的宿主执行一起移交 Agent：投递计划给出提示正文与摘要，Agent 自行选择粘贴方式，Wakeflow 只核对回读摘要。

**待确认**：

- Q3 活动监视删除、以 hook 观察取代，是否同意？建议同意。
- Q4 提示临时文件与清扫不再是 Wakeflow 能力，是否同意？建议同意。

## 10.4 版本与发布

**旧实现**：

- 五个版本源必须是同一显式 semver：两个插件 `package.json`、两个插件 manifest、Claude marketplace 的唯一 `wakeflow` 条目；Codex marketplace 无版本字段。`check-release-consistency.mjs:97-131`。
- `release:check` 断言：无缺失源、无版本漂移、`sync-core --check` 通过、分支 main、工作树干净、标签 `v<version>` 指向 HEAD、本地 `origin/main` 指向 HEAD 且不取网络、legacy fixtures 目录无被忽略的未跟踪文件、双工作区 `npm pack --dry-run` 满足打包合同。`:166-290`。
- 插件 manifest：Claude 不声明 skills 与 commands 靠目录发现，`mcpServers` 指向 `.mcp.json`，MCP 项禁止 cwd 与 env；Codex 声明 `skills: ./skills/`、`interface{displayName, developerName, capabilities, defaultPrompt ≤ 3 条各 ≤ 128 字, composerIcon, logo}`，MCP 项 `cwd: "."`。
- 引擎：插件 `node >= 20`，开发仓库 `>= 24.19.0 < 25`；没有门验证插件真的能在 Node 20 上运行。

**现 TS 状态**：`tooling/` 有 TS 门；双制品构建需求见 `requirements/typescript-dual-artifact-build.md`；`release:check` 沿用旧脚本。

**实现判断**：五源一致、标签在 HEAD、本地远端引用一致、干净 main 的机制保留；删除 legacy fixtures 闭合检查；打包合同改为 TS 构建产物的合同；新版本序列按 ADR-0008 从 `1.0.0` 起（待确认起点）。插件引擎下限改为与构建目标一致的单一 Node 主版本，并由冒烟在该版本上实跑。

**待确认**：

- Q5 新版本序列的起点是 `1.0.0` 还是别的号？建议 `1.0.0`。
- Q6 Codex marketplace 保持无版本字段，五源不变，是否同意？建议同意。
- Q7 插件引擎与开发仓库统一为同一 Node 主版本下限，是否同意？建议同意，取当前 24。

## 10.5 校验器与冒烟

**旧实现**：

- 校验器 17 类，从必需文件清单、核心清单合同、退役文件缺席、M7A 正常运行边界（63 条退役路径的模块图闭合）、package 字段、manifest 与 marketplace、MCP 接线、配置合同、约 30 个候选合同的导出集与常量词汇、宿主能力合同、公共 v3 边界、工作区配置、MCP 工具声明（恰好 31 个、只读集与破坏集、五个注解）、公共运行时脚本恰好 4 个、技能面、资产包，到文本面（无占位符、无旧名、非白名单文件无中文）。`wakeflow-validate.mjs:2365-2422`。
- 冒烟四幕：公共 setup 的 preview 零写且 apply 完成、产品仓库零写；目标树复核；reconcile 零步且 apply `no-op`；一次观察下 config valid、storage healthy、verify ok、status idle。临时树总被删除，清理失败把成功降为失败。`wakeflow-smoke.mjs:361-490`。
- sync-core：共享 181 文件逐字节复制，模板源生成资产包；宿主合同文件从不被写；`wakeflow-host-profile.mjs` 同名但各宿主自有。`sync-core.mjs:55-107`。

**现 TS 状态**：TS 门是 typecheck、架构规则、TS 测试、Schema 漂移；制品校验与冒烟属于 L3 制品切换。

**实现判断**：校验器按新制品重写，只保留有事实依据的类：文件清单、manifest 与 marketplace、MCP 接线、工具声明（数量来自导出而不是硬编码字面量）、技能面、文本面；候选合同导出集校验删除，因为它校验的是旧模块存在性。冒烟四幕保留并加第五幕：pod 创建 preview 零写。sync-core 随旧树删除，双制品由 TS 构建产出。

**待确认**：

- Q8 校验器不再硬编码工具数量与退役路径列表，改由导出与 schema 派生，是否同意？建议同意。

## 10.6 宿主中断与制品更新（2026-09-25，§13.127）

**场景**：Agent 的一轮被宿主切断（Claude Code 的 "API Error: Connection lost mid-response"，会话重启，pane 消失），或插件在运行中的窗口脚下更新。第六轮联合运行里两次连接中断分别落在 Design 的 apply 与 Controller 的评审决定上，Controller 又在完成前撞上自己的服务进程早于制品更新。

**规避方案**：Wakeflow 不试图阻止宿主中断，而是让每个效果在中断后可判定、可重放、不可重复：

| 效果 | 盲目重试会怎样 | 规则 |
|---|---|---|
| `publish_requirement` apply | 同内容同 `planDigest` 回 `current`，不会有第二条记录 | 先看板，再用同一 planDigest 重放 |
| activate / withdraw | 成功后再做即 `claim-state-drift` | drift 即已发生，inspect 后不再做 |
| `create_demand` apply | 同意图回 current；第二个活动 Demand 被拒 | status 看 Demand 是否已在 |
| `plan_target_task`、评审决定、`prepare_delivery` | 同 idempotencyKey 回同一记录 / 同一许可与围栏 | 用同一 key 重放；`expectedStreamRevision` 漂移就重读 |
| 助手 `deliver` | **Wakeflow 唯一不能替你重放的效果**：再发即第二次投递 | 助手先查落地记录，已落地拒 `already-landed` 并交回记录；用它登记结果 |
| `record_delivery_outcome` | 围栏绑定；证据后到时用新 key 再记 | 见能力卡 6 |
| `import_target_result` | 结果 id 由声明围栏派生，重放回同一结果 | status 看导入是否已落 |
| `record_evidence` | 内容派生 id，回 already-recorded | 同一 selection 再 apply 即可 |
| `complete_demand` / `cancel_demand` | 同 planDigest；已归档的 Demand 重新 preview 即见 | status 看 archive 回执 |
| pane 消失、会话仍在 | 无 | 助手 `resume` + `relocate`（§13.125）；从未有过对话的会话 `resume-exited` → launch + replace |
| 登录过期（"Login expired · Please run /login"，§13.128） | 无：该轮停住，任何重放都发不出去 | 只有用户能 `/login`；登录成功后 Claude Code 自动续上被切断的那一轮，续上后仍先看再做；Controller 技能的中断一节写明 |
| 插件更新后旧窗口继续跑 | 旧代码、旧 hook；verify 报资产 drift，reconcile 建议会用旧代码把资产改回去 | `runtime-artifact` 门与 status 的 `windows[].artifact` / `runtime.artifactOnDisk` 指名道姓；其他窗口 Controller 用助手 resume，本窗口由用户重连服务（Claude Code `/mcp`）或 resume 会话 |

技能文本：四份技能各写一段"After an interruption"（先看再做，同 key / digest 重放，宿主发送先查落地），Controller 参考多一节"After a plugin update"。

## 旧行为疑点

1. keep-live 约 2,400 行无调用方。
2. M6 门只存在于一条注释。
3. unattended 命令描述的观察适配器没有实际实现。
4. "运行中"判定是英文界面字符串匹配，内存状态随进程丢失。
5. 31 工具数与 63 退役路径在两处硬编码。
6. `release:check` 不取网络，本地远端引用过期也能通过。
7. Codex marketplace 无版本，五源在两宿主间不对称。
8. 插件引擎 `>= 20` 与开发仓库 `>= 24.19.0` 不一致且无门验证。

## 确认记录（2026-09-04，按建议）

| 问题 | 裁决 | 落点 |
| --- | --- | --- |
| Q1 keep-live | 整体删除，含记录形状与 schema，不留占位 | E4 删除清单 |
| Q2 激活范围与门 | 随 unattended 推迟，不保留空实现 | E4 删除清单，能力卡本节为重建依据 |
| Q3 活动监视 | 删除，以宿主 hook 观察取代 | ADR-0009 hook 通道 |
| Q4 提示临时文件与清扫 | 不再是 Wakeflow 能力；Agent 自行选择粘贴方式，Wakeflow 只核回读摘要 | skills 步骤 |
| Q5 版本序列起点 | `1.0.0` | 五个版本源 |
| Q6 Codex marketplace 版本 | 保持无版本，五源不变 | `release:check` |
| Q7 Node 下限 | 插件引擎与开发仓库统一为 24，冒烟在该版本实跑 | 两个插件 `package.json`、根 `package.json`、冒烟 |
| Q8 校验器 | 工具数量与退役路径由导出与 schema 派生；候选合同导出集校验删除 | L3 制品校验器 |
