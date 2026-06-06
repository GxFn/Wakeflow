# Wakeflow Implementation Landing Plan

日期：2026-06-06
状态：implemented / 本轮落地与后续收束记录

## 用户真实目标

Wakeflow 不是一个薄插件、脚手架入口或简化版 demo。Wakeflow 的目标是把已经成熟的 `codex-control-workspace` 工作流完整产品化为可安装的 Codex 插件形态，同时保留 control workspace 的判断边界、状态根、任务包、Design/Test 支撑、direct-thread 传递、target result、controller review、归档和本地运行态规则。

一句话完成定义：

> 用户安装 Wakeflow 后，可以在任意父级 workspace 中初始化一个完整 control workspace，选择受管子仓库和窗口，安装 root / child / Design / Test 的 `AGENTS.md` 与模板；后续流程推进仍由 `AGENTS.md` 指挥 Codex 自己完成读文档、改文档、回填、总控验收和 direct-thread 投递。Wakeflow MCP 提供稳定的通用能力接口，并用成熟 JS 脚本作为本地实现后端；它不接管总控判断，也不直接操作 thread id。

2026-06-06 用户追加裁决：

- 默认窗口命名采用 B：不把 `BaseWindow / CoreWindow / AgentWindow / DashboardWindow / PluginWindow` 作为插件第一默认面，只保留 controller / Design / Test 和 discovery 生成结果；示例窗口名只作为模板或说明，不抢占真实安装。
- README / AGENTS 旧名会清理干净，但优先级低于 MCP 能力接口收束。
- Wakeflow MCP 应整合通用能力，不应只是把脚本暴露出来。正确形态是“能力接口层 + JS 脚本实现后端”：MCP 提供 workspace 初始化、需求状态根、任务包、delivery、result、review、归档、验证等通用能力；底层脚本负责落文件和校验，不成为用户主要理解面。

## 当前代码现状

当前 Wakeflow 仓库已经完成一轮从简版插件向完整 control workspace runtime 的迁移，仓库工作树在本文创建前为 clean。

已存在的主要资产：

- `AGENTS.md`：已从 control workspace 规则解包为 Wakeflow 通用总控规则，保留最高停止卡、仓库边界、自动化闭环、Design/Test 边界、skill 分层和文档账本规则。
- `README.md` / `README.zh-CN.md`：已从真实 control workspace 文档提升到根目录，当前说明 Wakeflow 的控制面、安装形态、状态根、direct-thread transport 和本地优先原则。
- `.codex-plugin/plugin.json`：已声明 Wakeflow Codex 插件元数据、skills、MCP server、品牌和能力描述。
- `bin/wakeflow-mcp.mjs`：已形成 MCP server 能力接口层，包括 workspace discovery / setup / status、需求 state root、任务包、delivery、result、review、controller return、stop-loop、Design/Test intake、归档、验证和受控 runtime fallback；typed API 不再暴露 thread id 输入面。
- `lib/control-runtime.mjs`：作为能力接口的实现后端和诊断 fallback，白名单覆盖 25 个非测试 runtime 脚本；它不是 MCP 的主要产品界面。
- `scripts/`：已迁入 control workspace 的核心脚本，包括 `control-workspace-install.mjs`、`controller-state.mjs`、`codex-automation-loop.mjs`、`control-intake.mjs`、`workspace-control.mjs`、验证和归档脚本。
- `skills/`：已保留成熟 skill，包括 `codex-automation-controller`、`codex-automation-target`、`control-workspace-governance` 和 `progressive-chain-validation`。
- `templates/`：已有 starter workspace、Design/Test 支撑模板、state-machine 模板、需求设计 / handoff / signal / test 模板。
- `schemas/`：已有 controller state machine、task package、target result、automation dispatch 等 JSON schema。
- `workspace.config.json` / `workspace.config.example.json`：默认只内置 Wakeflow / Design / Test 支撑角色；产品窗口来自 discovery / 用户选择 / local config。

当前已验证过的能力：

- 初始化环境脚本已支持 discovery-only、配置写入、root AGENTS 同步、child AGENTS 同步、Design/Test 内部面创建、本地窗口配置写入；thread registry 不应通过 MCP 写入。
- `npm test` 曾通过，覆盖 validate、smoke 和 control runtime test suite。
- MCP `tools/list` 曾能列出 `wakeflow_initialize_workspace` 等工具。

2026-06-06 本轮落地新增事实：

- `node scripts/validate-repo.mjs` 通过，验证插件 manifest、MCP 入口、核心脚本、模板、skills 和 assets 存在。
- `node scripts/smoke.mjs` 通过，证明 state root、task package、delivery envelope、target result import、reduce review、`workspace-control` 基础链路和 MCP `tools/list` / `tools/call` smoke 可运行。
- `node scripts/wakeflow-control.mjs list` 当前列出 25 个白名单 runtime 脚本。
- `node scripts/check-script-docs.mjs --json` 通过；`scripts/README.md` 已补齐 `smoke.mjs` / `validate-repo.mjs` / `wakeflow-control.mjs`，`validate-repo.mjs` 不再直接 `process.exit()`。
- README / README.zh-CN 第一视线已改为 Wakeflow，安装形态使用 `Wakeflow/`。
- Wakeflow `AGENTS.md` 已改为 Wakeflow Agent Instructions，并写清默认安装只内置 Wakeflow / Design / Test，产品窗口来自 discovery / 用户选择。
- 模板、skills、schema 中面向用户的旧固定窗口名已清理为 Wakeflow / Design / Test / configured product window；代码中仅保留显式旧名兼容分支。
- `npm test` 通过：validate、smoke、93 个 control tests 全部通过。

## `codex-control-workspace` 能力对齐检查

本节记录 2026-06-06 对 `codex-control-workspace` 与 Wakeflow 的文件级和 MCP 暴露级检查结论。

### 可以完整插件化

结论：`codex-control-workspace` 的完整能力可以通过 Wakeflow 插件形态承载。原因是它的核心能力本来就是本地文件、JS 脚本、模板、schema、skills 和 ignored runtime state；这些能力不依赖一个必须常驻的后端服务，也不要求 MCP 承担流程控制。

Wakeflow 插件化后的职责是：

- 带上完整 control workspace 文件资产。
- 安装时让 Codex 读取 Wakeflow `AGENTS.md` 和 skills。
- 通过 MCP 暴露不含 thread id 操作的通用能力接口，并复用本地 JS 脚本作为实现后端。
- 让 Codex 按 `AGENTS.md` 调用这些工具、改文档、投递信封、回填和验收。

### 已完整迁移的资产

文件级检查结果：

- `schemas/`：Wakeflow 与 `codex-control-workspace` 完全一致。
- `templates/`：主体模板已完整迁移；差异只出现在 README 和 testing AGENTS 的 Wakeflow skill 路径替换。
- `scripts/`：核心 control workspace 脚本均已迁入 Wakeflow；差异主要是 Wakeflow 名称 / 路径替换，以及 Wakeflow 新增的一键 `initialize` 和插件验证脚本。
- `AGENTS.md`：已解包为 Wakeflow 通用总控规则，保留停止卡、自动化闭环、Design/Test、skill 分层和文档账本规则。
- `README.md` / `README.zh-CN.md`：已提升到根目录，说明 control workspace 的插件化形态。
- `.codex-plugin/plugin.json` / `.mcp.json` / `bin/wakeflow-mcp.mjs` / `lib/control-runtime.mjs`：插件包装与 MCP server 已存在。

### 合理差异

以下差异是插件化所需，不代表能力缺失：

- 默认名称从 `ControlWorkspace` / `codex-control-workspace` 改为 `Wakeflow`。
- skill 路径从 `skills/dev/<skill>` 扁平为 `skills/<skill>`，适配 Codex 插件的 skill 暴露方式。
- AGENTS 管理块 marker 从 `codex-control-workspace:*` 改为 `wakeflow:*`，避免安装后与旧仓库管理块混淆。
- Wakeflow 增加 `.codex-plugin`、`.mcp.json`、assets、`validate-repo.mjs`、`smoke.mjs`、`wakeflow-control.mjs`。
- `control-workspace-install.mjs` 在 Wakeflow 中增强了 `initialize`，这属于安装体验补齐，不削弱原能力。

### 本轮已关闭的缺口

本轮已把 MCP 暴露从脚本包装推进到能力接口层，并删除 typed MCP API 中的 thread id 相关输入。`lib/control-runtime.mjs` runtime fallback 白名单覆盖 25 个非 test JS 脚本：

- `append-progress-log`
- `archive-global-todo-board`
- `archive-workspace-docs`
- `check-repository-residue`
- `check-runtime-residue`
- `check-script-docs`
- `check-workspace-boundary`
- `check-workspace-current-layout`
- `collect-repo-status`
- `compact-workspace-index`
- `generate-archive-topic-summaries`
- `import-design-handoffs`
- `next-control-work`
- `render-progress-doc`
- `smoke`
- `validate-repo`
- `verify-control-center`
- `verify-workspace-docs`
- `wakeflow-control`
- `workspace-control`

这些脚本现在作为能力接口后端和诊断 fallback 存在；Wakeflow MCP 的主完成定义不是“列出 25 个脚本”，而是让 Codex 调用稳定的 workspace / demand / task / delivery / result / review / archive / verify 能力。

已修复的 thread typed API 缺口：

- `wakeflow_initialize_workspace` schema 已移除 `threads` 字段。
- `wakeflow_prepare_delivery` schema 已移除 `requireThread` 字段。
- thread id 登记、目标线程是否可投递和真实 host thread 投递留给 Codex host / 本地受控流程处理。底层 JS 脚本可以保留成熟本地运行态能力，但 MCP 便利 API 不提供 thread registry 字段、专用工具或文档路线。

已修复的验证层缺口：

- `check-script-docs` 已通过，脚本文档索引与新增插件脚本对齐。
- `smoke.mjs` 已增加 MCP server smoke，覆盖 `initialize`、`tools/list`、核心 `tools/call` 和 thread 字段边界。
- `wakeflow-control.mjs list` 与 MCP runtime 白名单已对齐，当前暴露 25 个非测试 runtime 脚本。

文档产品化缺口：

- README 和中文 README 已改为 Wakeflow 第一视线，保留来源于成熟 control workspace 工作流的说明。
- `AGENTS.md` 已保留硬规则，并明确 Wakeflow 是插件化 control workspace 能力仓库；默认只设 controller / Design / Test，产品窗口来自 discovery / 用户选择 / 本地配置。

## 当前问题与边界

当前问题不是“有没有代码”，而是 Wakeflow 还缺一份清晰的完整落地路线，把现有 control workspace 能力如何被插件安装、如何由 `AGENTS.md` 指挥 Codex 使用、以及 MCP 如何整合通用能力并调用 JS 后端讲清楚，并据此收束后续实现。

必须纠正的风险：

- 不能再做薄入口、演示入口、空 adapter 或只包装脚本的接口。
- 不能把成熟 skills 隐藏起来，也不能新建一组没有真实工作流消费方的浅 skill。
- 不能把 MCP 设计成新的流程大脑、调度器或总控工作流替代层。流程推进控制已经交给 `AGENTS.md` 和 Codex 自身；MCP 负责提供通用能力接口，接口内部复用 JS 脚本完成本地文件、状态根、信封和校验操作。
- 不能把真实 thread id 写入 tracked 文档、提示词或回填正文；Wakeflow MCP 也不直接接收、传递或写入 thread id。真实 thread id 只应由 Codex host / 本地受控流程写入 `.workspace-local/`。
- 不能让 MCP 工具替代总控判断。review / status / result 只是脚本输出和证据入口，最终 accept / rework / blocked 必须由 Codex 按 `AGENTS.md` 做显式总控裁决。
- 不能做真实 host thread send 的伪实现。Wakeflow JS 可以准备 envelope 和记录 host send/readback 证据；真实发送由 Codex host 线程能力完成。

## 产品形态

Wakeflow 应同时具备两层形态：

1. **Control workspace runtime**
   - 保留 `codex-control-workspace` 的完整文件结构能力：脚本、模板、skills、schema、AGENTS、state root、local runtime。
   - 可以作为一个普通仓库与用户产品子仓库并列安装。

2. **Codex plugin adapter**
   - 通过 `.codex-plugin/plugin.json` 安装。
   - 暴露 Wakeflow MCP 工具和 skills。
   - MCP 工具调用本地 control runtime JS 脚本，不直接执行 host send、不跳过 `AGENTS.md` 和 Codex 的总控判断。

因此，Wakeflow 不是“为了插件重新设计一套流程”，而是把 control workspace 工作流变成插件可安装、skills 可读取、JS 脚本可由 MCP 调用、Codex 窗口可按 `AGENTS.md` 推进的完整形态。

## 目标用户流程

### 1. 初始化工作区

目标：让用户在父级 workspace 中建立完整 Wakeflow 控制面。

流程：

1. 发现当前 control workspace 和同级子仓库。
2. 读取 / 生成 `workspace.config.json` 或 `.workspace-local/workspace.config.json`。
3. 让用户选择哪些仓库 / 窗口纳入 Wakeflow 管理。
4. 创建或配置 Design / Test 工作面。
5. 解包 root `AGENTS.md` 到父级 workspace。
6. 给受管子仓库同步 `AGENTS.md` 接入卡。
7. 给 Design / Test 同步各自 `AGENTS.md`、模板和文档面。
8. 按用户选择创建本地窗口配置，但不通过 MCP 接收真实 thread id。
9. 真实 thread id 由 Codex host / 本地受控流程登记到 `.workspace-local/`；MCP 不负责登记和输出 thread id。

完成定义：

- 用户能看到将被管理的窗口、仓库路径、角色、AGENTS 状态、Design/Test 形态和本地运行态位置。
- 未确认时不写文件；确认后写入边界清晰且可验证。

### 2. 需求 intake 与状态根

目标：每个真实需求进入一个 state root，而不是散落在聊天或状态文档里。Codex 仍按 `AGENTS.md` 判断何时创建、更新和验收 state root；MCP 只是让对应 JS 命令可以被工具调用。

流程：

1. 创建 demand / state root。
2. 写入目标、完成定义、阶段计划、非目标和证据要求。
3. 导入 Design handoff / signal 或测试 card。
4. 渲染 `developer-progress.md` 的统一状态块。
5. 所有后续任务包、result、review candidate、decision 都挂在同一 state root。

完成定义：

- 一个需求能通过 MCP 调用底层 JS 创建，并被脚本 / Markdown 双面读取。
- 状态根内机器 JSON 与人读 progress 不互相替代。

### 3. 任务包与窗口边界

目标：总控按 `AGENTS.md` 把需求拆成真实窗口任务包，而不是派碎片提示词；MCP 只提供“写入 / 查询任务包”的脚本能力。

流程：

1. 总控选择当前可执行窗口和任务包。
2. 任务包记录 targetWindow、targetTaskId、summary、sourceRef、验证要求和回填要求。
3. state root 明确 pending / accepted / blocked / completed target task。
4. 已完成、已阻塞、review-ready 或 terminal demand 必须 fail closed，不能继续创建派发。

完成定义：

- MCP 可以调用 JS 新增任务包，但不能自动替总控选择 product scope。
- 任务包必须服务当前需求完成定义。

### 4. Direct-thread delivery 准备与记录

目标：Wakeflow JS 准备可发送的小卡片提示词，并记录真实发送证据，但不伪装 host send。

流程：

1. 从 state root 和 task package 生成 dispatch packet。
2. 生成 delivery envelope。
3. envelope prompt 只包含轻量动态变量和 skill 指向。
4. 真实 `send_message_to_thread` 由 Codex host 能力执行，Codex 自己负责投递。
5. Wakeflow JS 记录 `record-delivery-run`：sent / blocked / failed、readback.ok、host method、证据摘要。
6. 发送完成后当前回合停止，不轮询、不 sleep 等待目标窗口。

完成定义：

- prompt 不再包含 XML / JSON 外壳或大段机器快照。
- delivery 证据能复核，但不被当成任务完成。

### 5. Target result 与 controller return

目标：目标窗口完成后返回结构化 result envelope，并可按 return policy 回到原发起总控。

流程：

1. target 窗口读取 delivery / state root / skill。
2. 只执行分配给自己的任务。
3. 生成 TargetResultEnvelope，附 evidenceRefs、verification、risks、changed repos / commits。
4. `group-ready` 等所有 expected target ready 后构建 controller return。
5. `per-target` 可逐个回跳，但必须携带 group snapshot。
6. controller return 回到 dispatch group 记录的 `controllerWindow`，不是全局默认 controller。
7. controller return 发送后同样需要 record delivery run。

完成定义：

- 多窗口等待和多个总控并行都以 dispatch group / controllerWindow / state root 隔离。
- 单个目标结果不能被误判为整组完成。

### 6. 总控 review 与显式裁决

目标：总控读取 evidence pack，独立复核后作出 accept / rework / blocked。

流程：

1. 读取 `review-pack`，定位 result、evidence refs、verification、missing evidence、delivery run 和 gates。
2. 总控独立打开原始证据，不信任 result envelope 的自然语言结论。
3. 通过 `decide-review` 写入显式裁决：accept / rework / blocked。
4. accept 才能关闭 target task 或 demand；rework 才能创建返工任务；blocked 才能进入阻塞态。
5. 自动化开启时，只在已确认目标和 TODO 内继续下一批 dispatch。

完成定义：

- MCP 可以暴露 review-pack 和 decide-review 对应 JS 能力，但它们只是工具调用；是否 review、如何裁决由 Codex 按 `AGENTS.md` 决定。
- reduce / review-pack 不是 acceptance verdict。

### 7. 归档与长期账本

目标：完成后把短期运行态收束到可读长期记录，不污染通用仓库。

流程：

1. 检查 TODO 是否关闭或转入 backlog。
2. 检查 product repo 提交 / 验证证据。
3. 停止对应 loop / keep-live。
4. 归档 progress、decision、dispatch 摘要和证据索引。
5. 长期账本写入 workspace ledger；本地 thread id、local runtime 不归档。

完成定义：

- 活跃状态清空，长期记录可追溯。
- 通用 Wakeflow 仓库不承载用户项目私有状态。

## MCP 职责定位

MCP 的职责不是重新设计 Wakeflow 流程，也不是承载总控策略。当前流程推进控制已经交给 `AGENTS.md`：Codex 会自己读取状态、改文档、回填、复核证据、发送自动化信封和调用对应脚本。

因此，Wakeflow MCP 的正确职责是：

- 整合 control workspace 的通用能力，并以稳定 MCP 工具表达：workspace setup、AGENTS 安装、Design/Test 支撑面、state root、task package、delivery envelope、delivery evidence、target result、review candidate、decision、archive、verify。
- 把 `scripts/*.mjs` 作为这些能力接口的实现后端；MCP 工具面不应要求用户理解每个脚本和子命令。
- 保留受控 runtime fallback，用于诊断、过渡和少数低频维护命令，避免任意 shell。
- 对写入型脚本保留 dry-run / explicit write 语义。
- typed 便利工具不接收、不传递、不输出真实 thread id；MCP 不提供 thread registry 专用工具或字段。
- 返回结构化能力结果、写入文件、状态变化、证据路径、脚本后端摘要和 nextAction，便于 Codex 按 `AGENTS.md` 继续判断。
- 不做流程推进控制，不替代 `AGENTS.md`，不替代 Codex 自己写文档 / 回填 / 投递 / 验收。
- 不执行真实 host thread send，只让 Codex 在需要时调用 host thread tool。

MCP 工具可以分为两层：

1. **能力接口层**
   - 以 Wakeflow 用户和 Codex 总控动作建模，例如初始化 workspace、创建 demand、追加任务包、准备 delivery、记录 delivery、导入 result、生成 review pack、写入 decision、归档、验证。
   - 这是 Wakeflow MCP 的主产品面，必须完整、稳定、清晰。

2. **脚本后端 / fallback 层**
   - 能力接口内部调用 `control-workspace-install`、`controller-state`、`codex-automation-loop`、`control-intake`、`workspace-control` 等 JS。
   - `wakeflow_control_runtime` 可保留为诊断和未整合能力的过渡口，但不能成为主要使用方式。

### 真实落地原则

后续代码实现必须遵守以下原则：

- 先设计并实现能力接口矩阵，而不是先追求脚本枚举完整。
- `wakeflow_control_runtime` 只能作为 fallback；脚本白名单完整性是能力不丢失的保障，不是主完成定义。
- 不为每个脚本子命令硬造 MCP 工具；只为真实工作流动作暴露能力接口。
- 不在 MCP 中解析当前计划 Markdown 来做决策；Codex 自己按 `AGENTS.md` 读取和判断。
- 不在 MCP 中实现队列、等待、轮询、自动派发、自动验收或自动归档策略。
- 不把 `review-pack`、`reduce-results`、`status` 等脚本输出包装成“已通过”。
- 不把本地绝对路径、thread id、token 或私有运行态写入 tracked 文档；MCP typed API 不提供 thread id 输入面。
- 所有写入动作仍由 JS 脚本自己的 `--write` / `--apply` / dry-run 语义控制。

## MCP 能力接口目标分层

### A. Workspace Setup Capability

应保留或补齐：

- 以能力接口表达 discover workspace、select repositories、configure workspace、install root AGENTS、sync child AGENTS、create internal Design/Test、inspect access profiles。
- 后端可调用 `control-workspace-install.mjs discover / initialize / sync-root-agents / write-agents / sync-templates / access-profiles`。
- MCP 初始化只创建 workspace / AGENTS / Design / Test / 本地窗口配置；真实 thread id 登记不走 MCP typed 初始化 API。
- 默认窗口命名按用户裁决 B：不把 `BaseWindow / CoreWindow / AgentWindow / DashboardWindow / PluginWindow` 作为第一默认面；真实仓库窗口来自 discovery / 用户选择。

当前状态：

- `wakeflow_initialize_workspace` 保留为一站式初始化能力。
- 已补 `wakeflow_discover_workspace`、`wakeflow_access_profiles`、`wakeflow_sync_agents` 等更清晰的 setup 能力，避免让初始化承担所有场景。

### B. Demand / State Root Capability

应保留或补齐：

- 能力接口覆盖 create demand、read demand status、append progress log、render progress、complete demand。
- 后端可调用 `controller-state.mjs init / add-task-package / import-target-result / reduce-results / decide-review / complete-demand`、`render-progress-doc.mjs`、`append-progress-log.mjs`。

当前状态：

- 已有 `wakeflow_init_demand` 和 `wakeflow_add_task` 便利别名。
- 需要确认底层 `controller-state` 全命令是否都能通过 MCP 调用，而不是重新设计一套 demand workflow。

### C. Intake Capability

应补齐：

- 能力接口覆盖 import Design handoff、attach Test card、list intake attachments、validate intake boundary。
- 后端可调用 `control-intake.mjs` 和 `import-design-handoffs.mjs`。

当前状态：

- 底层有 `control-intake.mjs`，MCP 只需要暴露它或提供轻量别名，不需要新流程。

### D. Dispatch / Transport Capability

应保留或补齐：

- 能力接口覆盖 prepare delivery、record delivery evidence、build controller return、stop loop、keep-live state、review group readiness。
- 后端可调用 `codex-automation-loop.mjs prepare-dispatch-from-state / build-delivery / record-delivery-run / build-controller-return / start-keep-live / stop-keep-live / keep-live-state / submit-result / review-results / review-pack / stop-loop`。

当前状态：

- 已有 prepare / record 便利别名。
- 通用白名单运行器已可调用部分脚本；需要确认 `codex-automation-loop` 所有必要子命令都能通过 MCP 传参调用。

### E. Result / Review / Decision Capability

应保留或补齐：

- 能力接口覆盖 submit target result、build review pack、write controller decision、mark rework / blocked / accepted。
- 这些不是 MCP 自己的判断接口，而是结构化证据和裁决记录工具。
- Codex 按 `AGENTS.md` 决定何时调用，调用后仍由 Codex 解释证据。

当前状态：

- 已有 submit result 和 reduce review 便利别名。
- 是否增加 `review-pack` / `decide-review` 便利别名，只是减少 Codex 拼参数；不是新增流程控制。

### F. Governance / Verify Capability

应保留或补齐：

- 能力接口覆盖 status、verify、check docs、check boundary、check residue、archive、compact index、next work scan。
- 后端可调用 `workspace-control.mjs`、`verify-control-center.mjs`、`check-script-docs.mjs`、`check-workspace-boundary.mjs` 等 JS。

当前状态：

- 已有 status / full verify / generic runtime。
- 后续重点是白名单完整性、输出解析和错误可读性，而不是新增复杂治理接口。

## 分阶段落地计划

### Phase 0：锁定现状与方案

目标：先把本文作为 Wakeflow 后续实现依据，避免继续边想边改。

动作：

- 新建本文档。
- 标记当前已实现、缺口和非目标。
- 后续代码改动必须能映射到本文的某个阶段和完成定义。

验收：

- 文档能解释 Wakeflow 为什么不是薄插件。
- 文档能解释 MCP 为什么是通用能力接口而不是 workflow controller；同时说明能力接口、JS 后端和 fallback runtime 的边界。

### Phase 1：MCP 能力接口矩阵与命名收束

目标：确定 Wakeflow MCP 的主能力接口，而不是按脚本文件名暴露命令。脚本白名单只作为后端覆盖表和 fallback。

动作：

- 建立能力接口矩阵：workspace setup、AGENTS install、Design/Test setup、demand state root、task package、delivery、delivery evidence、target result、review pack、controller decision、archive、verify、status。
- 为每个能力写清输入、输出、写入文件、失败条件、是否 dry-run、对应后端脚本。
- 保留 `wakeflow_control_runtime` 作为 fallback，并在 `lib/control-runtime.mjs` 中补齐需要的后端脚本白名单。
- typed 能力接口不出现 thread id 字段；fallback 不新增 thread registry 语义，也不在文档中把 thread registry 作为 MCP 使用路线。
- 给写入型能力明确 dry-run / apply 语义；后端脚本保持原生命令语义。

fallback 后端脚本覆盖目标：

- `append-progress-log`
- `archive-global-todo-board`
- `archive-workspace-docs`
- `check-repository-residue`
- `check-runtime-residue`
- `check-script-docs`
- `check-workspace-boundary`
- `check-workspace-current-layout`
- `codex-automation-loop`
- `collect-repo-status`
- `compact-workspace-index`
- `control-intake`
- `control-workspace-install`
- `controller-state`
- `demand-sequence`
- `generate-archive-topic-summaries`
- `import-design-handoffs`
- `next-control-work`
- `render-progress-doc`
- `smoke`
- `validate-repo`
- `verify-control-center`
- `verify-workspace-docs`
- `wakeflow-control`
- `workspace-control`

验收：

- MCP 主工具以能力命名，而不是以脚本命名。
- 每个主能力都有明确输入、输出、写入面、失败条件和后端脚本。
- fallback 白名单覆盖 Setup、Demand、Intake、Dispatch、Result、Review、Governance 所需 JS。
- MCP API 不建模 thread id 参数，因此返回内容不会泄露真实 thread id。
- 能力接口不创造总控决策语义，只提供本地状态和证据操作。

### Phase 2：MCP thread id 非接口化边界

目标：让 MCP 能力接口不提供 thread id 参数、不提供 thread registry 工具面。thread id 属于 Codex host / 本地受控流程，不属于 Wakeflow MCP API。

动作：

- 从 `wakeflow_initialize_workspace` input schema 移除 `threads` 字段。
- 从 initialization handler 移除 `threadArgs(args.threads)`。
- 从 `wakeflow_prepare_delivery` typed schema 移除 `requireThread` 字段；底层脚本的 `--require-thread` 保留为本地 CLI / host-controlled 路线，不作为 MCP 便利参数。
- 删除 MCP server 内只服务 typed `threads` 字段的 `threadArgs()` helper。
- 不为 `register-thread`、`--thread`、`--thread-id` 或其它 thread registry 写入路线创建 MCP 便利工具。
- `wakeflow_control_runtime` 只作为 fallback；文档和工具说明不把 thread registry 路线列为 MCP 使用方式。
- 保留脚本名称、参数 key 和非敏感路径，便于总控复核。
- 增加测试：`tools/list` 中不存在 thread id / registry 专用工具，`wakeflow_initialize_workspace` schema 中不存在 `threads` 字段，`wakeflow_prepare_delivery` schema 中不存在 `requireThread` 字段。

验收：

- MCP 主 API 不接收真实 thread id，也不提供 thread registry 工具面。
- `.workspace-local/` 的 thread registry 仍可由非 MCP 的 Codex host / 本地受控流程维护。
- 不建模 thread id 不影响 Codex 判断脚本是否成功、写了哪些文件、下一步是什么。

### Phase 3：初始化工作区闭环

目标：把安装脚本通过 MCP 做到真实可用。

动作：

- 确认 `control-workspace-install.mjs` 的 discover / initialize / sync-agents 路线都能通过 MCP 调用；thread registry 路线不作为 MCP 初始化能力。
- 确认 internal Design / Test 与 external Design / Test 两种路径。
- 确认 MCP 初始化不接收 thread id，不写 thread registry。
- 增加 MCP 层测试：dry-run 不写、apply 写入；初始化 schema 不包含 thread id 相关参数。

验收：

- 用户能通过 MCP 完成从空父目录到可用 Wakeflow workspace 的初始化。
- 未确认时不写入父目录或子仓库。

### Phase 4：需求状态根与任务包

目标：把 demand -> task package -> progress 的 JS 命令完整暴露给 MCP。

动作：

- 确认 `controller-state` / `render-progress-doc` / `append-progress-log` 均可通过 MCP 调用。
- 让 task package 的输入包含 sourceRef、目标窗口、验证要求、回填要求。
- 检查 terminal / review-ready / blocked 状态下新增任务 fail closed。

验收：

- MCP 可以调用对应 JS 来创建 demand、加任务、读取状态、渲染 progress。
- 状态根与 Markdown 投影一致。

### Phase 5：Direct-thread delivery 与 controller return

目标：把多窗口与多总控并行自动化所需 transport JS 能力完整暴露给 MCP。

动作：

- 确认 `codex-automation-loop` 的 controller-return、stop-loop、keep-live 命令可通过 MCP 调用。
- 确认 delivery prompt 是轻量小卡片。
- 确认 record delivery run 强制 sent + readback evidence。

验收：

- `group-ready` 可等待所有目标结果后构建一次 controller return。
- 多个 dispatch group 可并行，不会串 controllerWindow。
- 已 sent/readback 后当前回合停止，不引导轮询。

### Phase 6：Review pack 与总控裁决

目标：确保 MCP 能调用 review / decision 相关 JS，但不接管验收判断。

动作：

- 确认 `review-pack`、`decide-review`、`complete-demand` 可通过 MCP 调用。
- 明确 review-pack 不是验收结论。
- MCP 输出提示总控必须拉原始证据。

验收：

- completed target result 只能进入 review-ready，不能自动完成。
- 总控显式 accept 后 target task / demand 才能关闭。
- rework / blocked 路线可形成后续动作边界。

### Phase 7：Design / Test intake JS

目标：让需求设计和真实测试交接成为 state root 的附件，不再散落。

动作：

- 确认 `control-intake.mjs` 对 Design handoff / Test card 的命令可通过 MCP 调用。
- 输出当前 intake 附件、待 review 项和 nextAction。
- 保留 Design / Test 的职责边界。

验收：

- Design 只提供候选和 handoff，不直接变成产品事实。
- Test 只承接真实场景边界，不替代总控自测。

### Phase 8：文档、验证、插件包装

目标：收束用户可读文档和插件质量。

动作：

- README / README.zh-CN 第一视线改为 Wakeflow，安装形态使用 `Wakeflow/`，同时说明它来源于成熟 control workspace 工作流。
- AGENTS.md 第一视线改为 Wakeflow control workspace instructions；保留停止卡和硬规则，默认不再出现固定产品窗口示例，真实安装以 `workspace.config.json` / 初始化选择为准。
- README 保持亮点和架构，不堆脚本手册。
- `scripts/README.md` 保持脚本细节索引。
- MCP 文档写清：工具是通用能力接口，后端复用 JS 脚本；流程控制在 `AGENTS.md`。
- 已增加 MCP server smoke：`initialize`、`tools/list`、核心 `tools/call`。
- 已跑 `npm test`、MCP node check、repo validation。
- 已修复 `check-script-docs` 失败项：补 `smoke.mjs` / `validate-repo.mjs` / `wakeflow-control.mjs` 索引，去掉 `validate-repo.mjs` 的直接 `process.exit()`。

验收：

- 用户从 README 能理解 Wakeflow 的价值、安装形态和基本架构。
- MCP 层和脚本层都有测试。
- 插件 manifest、skills、templates、scripts 一致。

## 非目标

- 不在 Wakeflow MCP 内实现真实 Codex host thread send。
- 不在 Wakeflow MCP 内登记、读取、传递或写入真实 thread id。
- 不创建新的任务调度 daemon 或外部后台服务来替代 Codex 窗口。
- 不把每个脚本参数直接变成 MCP 产品面；允许通过受控 fallback runtime 传递 JS 原生命令参数。
- 不把用户项目的 `.workspace-active/`、`.workspace-local/`、thread id 或私有证据提交进 Wakeflow 仓库。
- 不迁移或重写产品仓库实现。
- 不用静态 mock、空 provider 或薄 adapter 冒充完整功能。

## 立即下一步

完成本文后，下一步应从 Phase 1 开始：

1. 先在 `bin/wakeflow-mcp.mjs` 中整理主能力接口矩阵，避免继续以脚本枚举为产品面。
2. 移除 MCP typed API 的 thread id 输入面：初始化入口不再提供 `threads` 字段，prepare delivery 不再提供 `requireThread` 字段，文档和工具说明不把 thread registry 路线作为 MCP 使用方式。
3. 更新 fallback 后端白名单，覆盖能力接口需要的非 test JS；`wakeflow_control_runtime` 保留为诊断 / 过渡口，不作为主使用方式。
4. 补齐能力接口：setup/discover、status/verify、demand、task、delivery、record delivery、submit result、review pack、decision、archive/next-work。
5. 修复脚本文档验证失败项，确保新增插件脚本进入 `scripts/README.md`。
6. 为 MCP server 增加真实 `tools/list` / `tools/call` smoke，断言主工具是能力接口、schema 不包含 thread id 参数。
7. 产品化 README / README.zh-CN / AGENTS 第一视线，去掉会让安装用户误解的旧仓库名残留；该项优先级低于 MCP 能力接口。
8. 跑完整验证后再提交。

任何代码改动都必须能对应到本文的阶段、用户流程和完成定义。
