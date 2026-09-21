<div align="center">

# Wakeflow

面向多窗口 Agent 工作的纪律化控制回路——每一步可追溯，每个结果可复审。

[English](README.md) | [简体中文](README.zh-CN.md)

</div>

---

Wakeflow 把"我想做这个"变成一条可追溯的工作线：需求包、Demand、任务包、投递、结果、评审，以及几个月后仍然读得懂的归档。

它是本地的、封闭的。Wakeflow 持有状态、证据与历史；你的 Agent 持有判断，并在你的机器上执行每一个动作。Wakeflow 不开窗口、不发提示、不改你的产品仓库。

它以一个插件、两个宿主版本（Codex 与 Claude Code）发布，由同一份 TypeScript 源码构建。

- [你得到什么](#你得到什么)
- [一件工作怎么流转](#一件工作怎么流转)
- [安装](#安装)
- [初始化工作区](#初始化工作区)
- [工具面](#工具面)
- [两个宿主，一套模型](#两个宿主一套模型)
- [在本仓库开发](#在本仓库开发)
- [发布](#发布)
- [设计原则](#设计原则)

## 你得到什么

- **一个工作区**——与产品仓库分开的控制器目录，放配置、活动状态与持久账本。
- **四种窗口角色**——controller、design、test，以及每个仓库一个 product 窗口。每个都是你启动的 Agent 窗口，Wakeflow 记下谁是谁。
- **四份技能**——`wakeflow-controller`、`wakeflow-design`、`wakeflow-target`、`wakeflow-test`，每个窗口按角色加载自己的那份。
- **二十个 MCP 工具**——每次状态变更要么是 preview 再 apply，要么是带幂等键的追加；读工具从不写。
- **Pod**——第二套完整窗口集在自己的 worktree 里工作，两件事并行而不相撞。
- **能复读的证据**——投递由宿主自己的 hook 观察证明，结果是不可变记录，每次接受、返工或升级都是 Controller 用自己的话写下的决定。

## 一件工作怎么流转

1. 在 Controller 窗口里让 Agent 初始化工作区，按它的要求启动窗口，让它登记。
2. 在 Design 窗口里和 Agent 一起把需求说清楚。它只读地看你的代码，起草需求包，给你一页摘要。你确认，它就上板。
3. 在 Controller 窗口里，Agent 认领需求包、规划任务、准备投递、发到某个产品窗口。
4. 产品窗口做事、导入报告、唤醒 Controller。
5. Controller 读结果与证据，做决定：返工或继续。需求要求真实环境测试时，Test 窗口按测试合同执行，Controller 同样复审。
6. 全部接受后，Demand 在一个事务里完成并归档。

你会被问两次：一次是需求摘要，一次是任务计划（当需求包要求时）。没有你确认过的需求，什么都不会被做。

## 安装

运行 Agent 宿主的机器需要：

- Node.js 24（`>=24.19.0 <25`），且在宿主启动时的 `PATH` 上。工具服务器与观察 hook 都以 `node` 启动，找不到它会静默失败。
- `git`。
- Claude Code 版另需 `tmux`：窗口群住在 tmux 窗口里。

仓库根是开发工作区；可安装的插件是 `plugins/` 下两个生成出来的目录：

| 宿主 | 制品 | 目录 |
| --- | --- | --- |
| Codex | `plugins/codex-wakeflow/` | `.agents/plugins/marketplace.json` |
| Claude Code | `plugins/claude-code-wakeflow/` | `.claude-plugin/marketplace.json` |

Claude Code，在 Claude Code 里：

```text
/plugin marketplace add GxFn/Wakeflow
/plugin install wakeflow@gxfn
```

Codex：

```bash
npx codex-marketplace add GxFn/Wakeflow/plugins/codex-wakeflow --plugin
```

本地开发时，把这份检出注册为你自己的 marketplace：

```toml
[marketplaces.gxfn]
source_type = "local"
source = "/absolute/path/to/Wakeflow"

[plugins."wakeflow@gxfn"]
enabled = true
```

每个制品自带运行时依赖闭包（`node_modules/`），放好即可运行，不需要再安装什么。

### 安装后的一次性宿主动作

**Codex。** 在 `/hooks` 里按定义哈希审阅并信任 Wakeflow 的四个 hook。信任之前四个 hook 全部被跳过：没有会话被观察到，窗口无法登记，投递也拿不到落地证据。插件更新后若 hook 定义字节发生变化，Codex 会要求重新信任。

**Claude Code。** 第一次在工作区目录里启动 Claude Code 时，必须接受工作区信任对话。不接受时插件的 hook 与状态栏都不运行。状态栏命令由 `wakeflow_maintain_workspace` 写进 `.claude/settings.local.json` 的托管块，那个块归 Wakeflow 所有。

当 `wakeflow_verify` 把 `host-hook-channel` 门报成 `absent` 或 `records-0`，先查上面这两步。这道门就是 Wakeflow 判断"窗口真的收到了"的依据。

## 初始化工作区

在你想作为工作区的目录里打开 Agent——它不能是产品仓库的根——说"初始化一个 Wakeflow 工作区"。Agent 先预览计划、请你确认选择，再应用。出现的东西：

| 路径 | 归属 | 用途 |
| --- | --- | --- |
| `wakeflow.config.json` | Wakeflow，tracked | 程序身份、拓扑（仓库、支持面、窗口、pod）、ledger 根、治理、宿主偏好。只有 `fresh-initialize` 与 `reconfigure` 写它。 |
| `.wakeflow-active/` | Wakeflow，ignored | 活动状态：`index.md`、`current/workspace-current-status.md`、每个 Demand 的根与进度投影、需求看板。 |
| `.wakeflow-local/` | Wakeflow，ignored | 宿主私有运行时：窗口绑定（真实会话或线程标识只住在这里）、hook 观察记录、pod 回执、维护日志。 |
| `../wakeflow-ledger/`（可配置） | Wakeflow，tracked | 需求包记录与 Demand 归档。 |
| `Design/`、`Test/` | Wakeflow 管理或外部拥有 | Design 与 Test 窗口工作的支持面。 |
| `AGENTS.md` / `CLAUDE.md` | 你的，含一个托管块 | Wakeflow 只在工作区指令文件里维护一个托管块；块外全是你的。 |

对账（`wakeflow_maintain_workspace` 的 `reconcile`）修复 Wakeflow 拥有的文件并报告漂移；它不改配置、不登记窗口、不删任何它不拥有的东西。

## 工具面

二十个公共 MCP 工具。效果工具先 `preview` 再按预览的计划摘要 `apply`；追加工具带幂等键，重放干净；读工具从不写。

| 领域 | 工具 |
| --- | --- |
| 工作区 | `wakeflow_maintain_workspace`——fresh-initialize、reconfigure、reconcile |
| 窗口 | `wakeflow_register_window_binding`——查看启动意图、登记握手、替换窗口、释放工作声明 |
| 需求 | `wakeflow_publish_requirement`——预览摘要、发布上板；`wakeflow_inspect_board` |
| Demand | `wakeflow_create_demand`（认领即创建）、`wakeflow_complete_demand`（完成即归档，一个事务）、`wakeflow_cancel_demand`、`wakeflow_continue_demand`（续接已归档的 Demand，或记录用户对升级的回答） |
| 任务与投递 | `wakeflow_plan_target_task`（实现包与测试包）、`wakeflow_prepare_delivery`（一次调用：信封、prompt、工作声明与发送许可）、`wakeflow_record_delivery_outcome`、`wakeflow_rearm_delivery` |
| 结果与评审 | `wakeflow_import_target_result`、`wakeflow_inspect_target_result_review`、`wakeflow_record_implementation_review_decision`、`wakeflow_record_test_review_decision` |
| 证据 | `wakeflow_record_evidence`——受管路径、hook 观察、链接、提交 |
| Pod | `wakeflow_pod`——创建、查看、恢复、关闭 |
| 观察 | `wakeflow_status`（一次观察所有域并给出下一步）、`wakeflow_verify`（十三道门：通过、失败或不可用） |

"不可用"与"失败"故意分开计数："没能检查"永远不会被报成"没问题"。

## 两个宿主，一套模型

状态根、账本、工具、技能与证据形状在两个宿主上完全相同。差异只是宿主自己的事实：

| | Codex | Claude Code |
| --- | --- | --- |
| 一个窗口是 | 根在窗口目录的 Codex 线程 | 一个运行 `claude` 的 tmux 窗口 |
| 投递是 | 向目标线程发送一次 | 粘贴到目标 pane 并回车一次，再捕获一次 |
| 落地证据 | 线程发送的返回，或目标会话的 `UserPromptSubmit` hook 记录 | 目标会话的 `UserPromptSubmit` hook 记录 |
| Hook | `hooks/hooks.json`，在 `/hooks` 里信任一次 | `hooks/hooks.json`，工作区信任后运行 |
| Pod 的 worktree | `git worktree add`，导入结果前先建分支 | `git worktree add` 或 `claude --worktree <name>` |
| 额外 | — | 四个 slash 命令、一条状态栏 |

## 在本仓库开发

所有手写代码都是 `src/`、`tooling/`、`tests/` 下的 TypeScript；`plugins/` 是生成物，从不手改。

| 路径 | 用途 |
| --- | --- |
| `src/` | 运行时，六层：`foundation` → `contracts` → `kernel` → `capabilities` / `governance` / `configuration` / `workspace` → `hosts` → `entrypoints`，依赖方向由架构门强制。 |
| `src/contracts/schemas/` | 可移植的 JSON Schema；`src/contracts/generated/` 由它派生并做漂移检查。 |
| `src/hosts/<host>/` | 一切 Codex 或 Claude 特有的东西：profile、hook 片段、agent 面文本取值表、维护执行。 |
| `assets/agent-text/` | 两个制品里技能、命令与 README 的唯一来源；宿主差异是六个占位符，由各宿主的 profile 填值。 |
| `assets/brand/`、`assets/release/version.json` | 品牌资产与唯一的发布版本输入。 |
| `tooling/` | 构建、codegen、架构、测试与发布工具。 |
| `tests/` | 单元、能力、宿主、制品与场景测试；`tests/scenarios/` 在一次性工作区里经公共工具跑二十个端到端场景。 |
| `plugins/` | 两个生成的插件制品。重建它们，不要编辑它们。 |
| `docs/` | 开发文档系统，从 `docs/README.md` 开始。 |

```sh
npm test                       # typecheck、架构规则、lint、format、knip、测试、Schema 漂移、制品校验
npm run scenario:acceptance    # 只跑二十个端到端场景
npm run build:artifacts        # 把两个制品构建到 .build/artifacts（候选）
npm run build:artifacts:committed  # 从源码重建 plugins/
npm run build:check            # 重建并与 plugins/ 逐字节对比
npm run smoke:artifacts        # 把 plugins/* 搬到仓库外跑冒烟
npm run release:check          # 提交后的严格发布门
```

在本仓库工作的 Agent 遵守根目录 `AGENTS.md` 与 `CLAUDE.md` 里的维护规则。

## 发布

1. 在 `assets/release/version.json` 与 `.claude-plugin/marketplace.json` 的 `wakeflow` 条目里设版本。
2. `npm run build:artifacts:committed`，然后 `npm test`（含 `build:check`）与 `npm run smoke:artifacts`。
3. 提交、推到 `main`、打标签 `v<version>`。
4. `npm run release:check`——五个版本源一致、工作树干净、标签在 `HEAD`、本地 `origin/main` 在 `HEAD`，且门本身跑在 Node 24 上。

## 设计原则

1. **判断保持可见**：工具输出、状态行与目标报告是评审输入，不是接受。
2. **一个 Demand，一个状态根**：事件、包、结果、决定与投影都挂在同一个 Demand 上。
3. **提示简短、包承载上下文、技能负责执行**：投递提示只带目标、重点与边界；任务包拥有上下文；技能拥有步骤。
4. **仓库边界要紧**：每个窗口拥有自己的源码、测试、提交与报告。
5. **自动化搬运工作，不搬运权威**：发送由观察记录证明，结果只在 Controller 说完成时才完成。
6. **本地运行时留在本地**：真实会话与线程标识只住在宿主私有运行时目录，从不进入公共结果。
7. **没有"静默地没问题"**：检查不了就报不可用，手改过的投影不覆盖，已带 Wakeflow 标记的目录只拒绝不迁移。
