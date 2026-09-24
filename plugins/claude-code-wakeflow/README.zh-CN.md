# Wakeflow

Wakeflow 把"我想做这个"变成一条可追溯的工作线：需求包、Demand、任务包、投递、
结果、评审，以及几个月后仍然读得懂的归档。

它完全在本地、封闭世界内运行。Wakeflow 持有状态、证据与历史；Agent 持有判断，
并在你的机器上执行全部效果。Wakeflow 从不开窗口、不发送 prompt、也不改动你的
产品仓库。

## 你会得到什么

- **一个工作区** —— 与产品仓库分开的控制器目录，存放配置、活动状态与持久
  ledger。
- **四种窗口角色** —— controller、design、test，以及每个仓库一个 product 窗口。
  窗口由 Controller 里的 Agent 替你启动，Wakeflow 只记录哪个是哪个。
- **四份技能** —— `wakeflow-controller`、`wakeflow-design`、`wakeflow-target`、
  `wakeflow-test`。每个窗口加载自己角色那一份。
- **pod** —— 在自己的 worktree 里运行的第二套完整窗口集，用来并行推进两件事而
  互不干扰。

## 主流程

1. 在 Controller 窗口说"初始化工作区"，Agent 会按启动意图开好其他窗口并登记
   它们；轮到你做的事（接管 tmux、接受信任对话）它会当场告诉你。
2. 在 Design 窗口与 Agent 一起把需求讨论清楚。它只读地核实你的代码、写出需求
   包，并给你一页摘要。你确认后，需求包发布上板。
3. 回到 Controller 窗口：认领需求包、规划任务、准备投递，并把它送进产品窗口。
4. 产品窗口执行任务、导入结果报告，并唤醒 Controller。
5. Controller 读结果与证据、作出判断，或者发回返工，或者继续往下走。
6. 全部接受后，完成与归档在一个事务里一次做完。

流程只要求你确认两次：一次是需求摘要，一次是需求包要求过目时的任务计划。没有
你确认过的需求，不会有人开始动手。

## 入口

`/wakeflow-init` 初始化或修复工作区，`/wakeflow-status` 报告当前状态，`/wakeflow-next` 在活动 Demand 上推进一步，`/wakeflow-pod` 创建或关闭 pod。

任何时候直接说人话都可以："在这里初始化工作区"、"现在什么状态"、"继续"、
"开一个 pod"。

## 安装

1. 为你的 Agent 宿主安装插件。
2. 确认 `node` 在 `PATH` 上。插件的工具服务与观察 hook 都以 `node` 启动，找不到
   它时会静默失败。
3. 完成下面这一节的一次性宿主动作。
4. 在你想作为工作区的目录里打开 Agent，说"初始化一个 Wakeflow 工作区"。该目录
   本身必须是一个 Git 仓库（先在那里 `git init`；Wakeflow 靠 Git 判定它维护的
   `.gitignore` 块，否则会报 `gitignore-git-repository`），且不能是产品仓库根。

Wakeflow 会在工作区的 `CLAUDE.md` 里维护一个托管块。那个块归
Wakeflow 所有，块以外的内容都是你的。产品仓库或外部拥有的 Design/Test 支撑面
只有在配置里以 `instructionManagement: managed-block` 明确选择时，才会在它自己
的 `CLAUDE.md` 里得到同样的托管块；否则 Wakeflow 绝不写入那里。

## 安装后的一次性宿主动作

第一次在工作区目录里启动 Claude Code 时，必须接受工作区信任对话。不接受时插件的 hook
与状态栏都不运行：没有会话被观察到，投递也拿不到落地证据。状态栏命令由
`wakeflow_maintain_workspace` 写进 `settings.local.json` 的托管块；那个块归 Wakeflow
所有，你自己改写 `statusLine` 会在下一次对账里被报成差异。

你不需要自己配置 tmux。在工作区目录里运行 `claude`，执行 `/wakeflow-init`：Controller 会通过
维护装到 `.wakeflow-local/runtime/hosts/claude-code/operations/assets/tmux.mjs` 的助手自己
建 tmux 会话、开全部窗口，窗口开好后告诉你要执行的那一条 `tmux attach` 命令、要接受哪些信任
对话；投递 prompt 也走同一个助手。维护还会往工作区根的 `.claude/settings.json` 写一条只放行
这个助手的 allow 规则，助手因此不弹权限；不会写 `Bash(tmux *)` 之类更宽的规则。

两个宿主共同的部分，以及"东西静默缺失"的常见原因：

- `node` 必须在 Agent 宿主启动时所用的 `PATH` 上 —— 这与工具服务配置的假设是同
  一条。
- 当 `wakeflow_verify` 的 `host-hook-channel` 门报 `absent` 或 `records-0` 时，
  第一排查项就是上面那些动作。这道门是 Wakeflow 判断"窗口确实收到了发给它的东
  西"的依据；没有观察记录，投递看起来发出去了却拿不到证据，Wakeflow 会正确地拒
  绝把它算作 accepted。

## 怎么确认它在工作

问一下状态就行。`wakeflow_status` 一次读遍所有域并给出下一步动作；
`wakeflow_verify` 是严格读，每道门只有通过、失败或不可用三种结果。不可用与失败
分开计数是有意的："没能检查"永远不会被报成"没问题"。

## Wakeflow 不会做的事

- 代你接受工作。接受是 Controller Agent 自己措辞记录的决定，且对着你能复读的证
  据作出。
- 在没有落地观察记录的情况下，把一次发送报成已投递。
- 覆盖你手写过的投影文件。
- 修改已发布的需求记录。更正是新的需求包，不是编辑。
- 把凭据、私有句柄或本机绝对路径放进公共结果。
