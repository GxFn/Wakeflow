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
- **pod** —— 在自己的 worktree 里运行的第二套完整窗口集（Claude Code 上还在自己的
  tmux 会话里），用来并行推进两件事而互不干扰。

## 第一次使用

1. 装好插件，在将要作为工作区的目录里启动你的 Agent 宿主，说"在这里初始化一个
   Wakeflow 工作区"。这个会话是引导会话：它问你几个问题（程序名、仓库、账本放
   在哪），预览计划，你点头后应用。
2. 然后它自己开好全部窗口——Controller、Design、每个产品仓库一个、Test——并在
   每个只有你能做的点上告诉你那一件事：进入这些窗口的那条命令，以及每个窗口里
   要接受的信任对话。
3. 最后给你一张交接卡：每个窗口是做什么的、怎么在窗口之间移动、以后怎么回来、
   第一步做什么——去 Design 窗口把第一个需求说清楚。然后关掉引导会话；从此
   Controller 窗口就是 Controller。

## 日常使用

1. 在 Design 窗口与 Agent 一起把需求讨论清楚。它只读地核实你的代码、写出需求
   包，并给你一页摘要。你确认后，需求包发布上板。
2. 在 Controller 窗口：认领需求包、规划任务、准备投递，并把它送进产品窗口。
3. 产品窗口执行任务、导入结果报告，并唤醒 Controller。
4. Controller 读结果与证据、作出判断，或者发回返工，或者继续往下走。
5. 全部接受后，完成与归档在一个事务里一次做完。

流程只要求你确认两次：一次是需求摘要，一次是需求包要求过目时的任务计划。没有
你确认过的需求，不会有人开始动手。拿不准时问 Controller"下一步是什么"；空闲的
工作区会回答：去 Design 窗口，提一个新需求。

## 入口

`/wakeflow:init` 初始化或修复工作区，`/wakeflow:status` 报告当前状态，`/wakeflow:next` 在活动 Demand 上推进一步，`/wakeflow:pod` 创建或关闭 pod。Claude Code 的插件命令一律带插件名前缀，`wakeflow:` 是命令名的一部分。

任何时候直接说人话都可以："在这里初始化工作区"、"现在什么状态"、"继续"、
"开一个 pod"。

## 安装

1. 为你的 Agent 宿主安装插件。
2. 确认 Agent 宿主能启动 `node`：在它启动时所用的 `PATH` 上，或由宿主自带
   （Codex 桌面应用）。插件的工具服务与观察 hook 都以 `node` 启动，找不到它时
   会静默失败。Wakeflow 需要 Node 24.19 及以上、低于 25 的版本（其他版本在任何
   代码运行之前就以 stderr 上的一行拒绝）、`git`，Claude Code 上还需要 `tmux`；
   只支持 macOS 的本地文件系统，不支持 Linux 与 Windows。Claude Code 可以是原生
   二进制，也可以是 npm 安装的 `claude` 脚本，两者都能识别。
3. 完成下面这一节的一次性宿主动作。
4. 在你想作为工作区的目录里打开 Agent，说"初始化一个 Wakeflow 工作区"。该目录
   本身必须是一个 Git 仓库（不是时 Agent 会提出替你在那里 `git init`；Wakeflow 靠
   Git 判定它维护的 `.gitignore` 块，否则会报 `gitignore-git-repository`），且不能是
   产品仓库根。

Wakeflow 会在工作区的 `CLAUDE.md` 里维护一个托管块。那个块归
Wakeflow 所有，块以外的内容都是你的。产品仓库或外部拥有的 Design/Test 支撑面
只有在配置里以 `instructionManagement: managed-block` 明确选择时，才会在它自己
的 `CLAUDE.md` 里得到同样的托管块；否则 Wakeflow 绝不写入那里。
pod 打开期间，Controller 的宿主动作还会碰每个产品仓库：为 pod 建一份关联检出
（Claude Code 上在仓库的 `.claude/worktrees/` 下，并在 `.git/info/exclude` 加一行），
位于 pod 的 `worktree-<name>` 分支上。关闭 pod 会移除检出；分支与 exclude 行留着，直到你删除。

## 工作区基线

当前文件结构是这个版本的首个支持基线。请在新工作区初始化；此前开发版的本地文件和目录结构不做升级，需要保留的历史请留在原目录。
当前格式内的正常配置变更、对账和中断恢复继续支持。

## 安装后的一次性宿主动作

第一次在工作区目录里启动 Claude Code 时，必须接受工作区信任对话。不接受时插件的 hook
与状态栏都不运行：没有会话被观察到，投递也拿不到落地证据。状态栏命令由
`wakeflow_maintain_workspace` 写进 `settings.local.json` 的托管块；那个块归 Wakeflow
所有，你自己改写 `statusLine` 会在下一次对账里被报成差异。

你不需要自己配置 tmux。在工作区目录里运行 `claude`，执行 `/wakeflow:init`：Controller 会通过
维护装到 `.wakeflow-local/runtime/hosts/claude-code/operations/assets/tmux.mjs` 的助手自己
建 tmux 会话、开全部窗口，窗口开好后告诉你要执行的那一条 `tmux attach` 命令（worktree pod 各有
自己的会话 `<会话名>-<pod 名>` 和各自的 attach 命令）、要接受哪些信任
对话；投递 prompt 也走同一个助手。维护还会往工作区根的 `.claude/settings.json` 写只放行这个
助手和 Wakeflow MCP 工具的 allow 规则；助手启动或恢复的每个窗口也带着这两项放行启动，所以产品
窗口和测试窗口同样不会为它们弹权限。不会写 `Bash(tmux *)` 之类更宽的规则。因此 Wakeflow 写过的根，
其信任对话框只会列出这几条；对话框里若出现 `Bash(git *)`、`Bash(node *)`、`Bash(tmux *)` 或 `..` 目录，
那是 0.9.x 的残留或仓库自己的设置——接受就会生效，先删掉或确认再接受。

助手启动的每个窗口缺省以 Claude Code 的 `auto` 权限模式运行：常规操作由 Claude Code 自己审，
不再逐条问你。窗口第一次仍可能问你一个一次性的问题（例如是否允许读取工作目录之外的文件），
Controller 会告诉你是哪个窗口在问。你的账号没有 auto 模式时，让 Controller 经维护把
`hosts.claude-code.launch.permissionMode` 设为 `acceptEdits`；之后窗口执行命令时会弹权限确认。

两个宿主共同的部分，以及"东西静默缺失"的常见原因：

- `node` 必须能被 Agent 宿主找到 —— 在它启动时所用的 `PATH` 上，或作为宿主
  自带的运行时 —— 这与工具服务配置的假设是同一条。
- 当 `wakeflow_verify` 的 `host-hook-channel` 门报 `absent` 或 `records-0` 时，
  第一排查项就是上面那些动作。这道门是 Wakeflow 判断"窗口确实收到了发给它的东
  西"的依据；没有观察记录，投递看起来发出去了却拿不到证据，Wakeflow 会正确地拒
  绝把它算作 accepted。

## 更新

更新是两步宿主动作加一次 Wakeflow 读取。先用 `/plugin marketplace update gxfn`（shell 里是
`claude plugin marketplace update gxfn`）刷新 marketplace 目录，再更新插件：会话里打开 `/plugin`，
在 Installed 下选中 Wakeflow 点 Update now；shell 里是 `claude plugin update wakeflow@gxfn`。
Claude Code 只在插件清单的版本号变化时替换已安装的副本，Wakeflow 每次发布都会改它。正在运行的
会话在 `/reload-plugins` 或新会话之前仍用旧的 hook 与 MCP server，所以 Controller 的
`wakeflow_status` 会对自己的 server 报 `runtime-artifact-outdated`、对在旧制品下启动的同伴窗口报
`windows-stale:<n>`；Controller 按技能的 "After a plugin update" 一节用 tmux 助手自己刷新它们。
没有窗口再是 stale 之后，`wakeflow_verify` 的 `runtime-artifact` 门重新通过；`unverified` 不是失败。

在受支持的工作区基线内，更新不需要迁移工作区；更新后的 `wakeflow_status` 会点名剩下要做的事
（过期的 server、stale 的窗口、`reconcile` 可修复的宿主资产）。由 Wakeflow 0.9.x 初始化的工作区
不同：这个版本会拒绝它（`fresh-legacy-residue-present`），`wakeflow_status` 在 `legacyResidue`
里列出残留——指令文件里的 `<!-- wakeflow:scope:start -->` 块、`.claude/settings*.json` 里宽泛的
`Bash(node *)`、`Bash(tmux *)`、`Bash(git *)` 规则与 `..` 附加目录、`workspace.config.json`、
`.workspace-active`、`.wakeflow-publish` 根标记、`.wakeflow-stage*`、`.wakeflow-maintenance-*`、
`.wakeflow-create-stage-*` 目录，以及 `wakeflow-ledger` 目录。手工归档或删除后重新初始化；
0.9.x 的 Demand 历史不迁移。0.9.x 工作区用过的产品仓库带着同样的 `.claude/settings.json` 规则与
scope 块；`wakeflow_status` 按仓库根列出它们，往那里开窗口之前先删掉。

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
