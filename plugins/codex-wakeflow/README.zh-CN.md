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

本宿主不发 slash 命令。直接说人话即可，已加载的技能会把它路由到对应工具。

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

Wakeflow 会在工作区的 `AGENTS.md` 里维护一个托管块。那个块归
Wakeflow 所有，块以外的内容都是你的。产品仓库或外部拥有的 Design/Test 支撑面
只有在配置里以 `instructionManagement: managed-block` 明确选择时，才会在它自己
的 `AGENTS.md` 里得到同样的托管块；否则 Wakeflow 绝不写入那里。
pod 打开期间，Controller 的宿主动作还会碰每个产品仓库：为 pod 建一份关联检出
（Claude Code 上在仓库的 `.claude/worktrees/` 下，并在 `.git/info/exclude` 加一行），
位于 pod 的 `worktree-<name>` 分支上。关闭 pod 会移除检出；分支与 exclude 行留着，直到你删除。

## 工作区基线

当前文件结构是这个版本的首个支持基线。请在新工作区初始化；此前开发版的本地文件和目录结构不做升级，需要保留的历史请留在原目录。
当前格式内的正常配置变更、对账和中断恢复继续支持。

## 安装后的一次性宿主动作

Codex 版目前是预览版：原生项目创建入口尚未在真实 Codex 会话里跑通，遇到情况请如实报告，不要假设它能用。
Codex 桌面应用使用宿主自带的 Node。CLI 未提供宿主运行时时，需要 PATH 中有 Node 24。
在 `/hooks` 里按定义哈希审阅并信任 Wakeflow 的四个 hook。信任之前四个 hook 全部被
跳过：没有会话被观察到，窗口无法登记，投递也拿不到落地证据。插件更新改变了 hook 定义
字节时（1.1.0 这次就改了），Codex 会要求重新信任这四个 hook：更新后打开一次 `/hooks`，
里面没有 Wakeflow 的待审阅条目，说明这次更新没有动 hook。

两个宿主共同的部分，以及"东西静默缺失"的常见原因：

- `node` 必须能被 Agent 宿主找到 —— 在它启动时所用的 `PATH` 上，或作为宿主
  自带的运行时 —— 这与工具服务配置的假设是同一条。
- 当 `wakeflow_verify` 的 `host-hook-channel` 门报 `absent` 或 `records-0` 时，
  第一排查项就是上面那些动作。这道门是 Wakeflow 判断"窗口确实收到了发给它的东
  西"的依据；没有观察记录，投递看起来发出去了却拿不到证据，Wakeflow 会正确地拒
  绝把它算作 accepted。

## 更新

Codex 没有文档化的插件更新命令（2026-10-14 核对）：`codex plugin marketplace upgrade <marketplace>`
刷新 Git marketplace 的目录，安装用的 `codex-marketplace` 助手只文档化了 `add` 与 `remove`。先刷新，
再执行你安装时用的那条 `add` 命令，然后重启 Codex 应用——只有重启应用才会重载 Wakeflow 的 MCP
server，续接聊天不会——再续接原有聊天。打开一次 `/hooks`：改变了 hook 定义字节的更新会要求你重新
信任四个 hook。续接后的 Controller 聊天里 `wakeflow_status` 不应再报 `runtime-artifact-outdated`；
Codex 上的同伴窗口保持 `unverified`，这不是失败。

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

## 它会碰你机器上的什么

- 完全在你的机器上运行：一个走 stdio 的工具服务与观察 hook，都由 Agent 宿主以
  `node` 启动。不联网、不发遥测、不需要账号。
- 在工作区内写 `wakeflow.config.json`、`.wakeflow-active/`、`.wakeflow-local/`（运行时
  状态、hook 记录与它发布的宿主资产）、你选的账本目录、它管理的 Design 与 Test
  支撑面，以及 `AGENTS.md` 和 `.gitignore` 里的托管块。
- 宿主设置（有这种设置的宿主，即 Claude Code）：在工作区根与受管的 Design、Test
  面的 `.claude/settings.json` 里只放行它自己的工具与助手的精确规则，在同样三处的
  `.claude/settings.local.json` 里写状态行条目。不写更宽的规则，也不写进产品仓库。
- 产品仓库由 Design 只读，只有产品窗口按投递的任务改动它；托管块只出现在明确选择
  的仓库里；pod 会添加"安装"一节说明的关联检出。
- 窗口、会话与 prompt 是宿主效果，由 Controller 里的 Agent 经宿主执行、以它自己的
  命令可见；Wakeflow 的进程从不执行任何一个。

## 停用 Wakeflow

退出是一个维护意图，不是手工清理：告诉 Controller，它先预览计划、给你看每一条阻塞，
你确认后才应用。不要手删 Wakeflow 的文件——托管块按精确正文准入，手改只会被报成漂移。

- **"把仓库 X 从 Wakeflow 分离出去"**：删除该仓库 `AGENTS.md` 里 Wakeflow 的
  托管块（只删正文确系 Wakeflow 写出的块），退役它的窗口投影，发布去掉该仓库及其产品
  窗口的配置。
- **"在这里停用 Wakeflow"**：对每个仓库与窗口做同样的事，删除工作区 `.gitignore` 与 `AGENTS.md` 里的
  Wakeflow 块，在有宿主设置的宿主（Claude Code）上从工作区根与受管的 Design、Test 面的
  `.claude/settings.json` 删除 Wakeflow 的允许规则、从 `.claude/settings.local.json`
  删除 Wakeflow 自己的那条 `statusLine`（你自己的规则与状态栏保留），最后把
  `wakeflow.config.json` 改名为 `wakeflow.detached.json`。

pod 打开或 Demand 活动时两者都拒绝：先关闭 pod 或完成 Demand。正文无法证明是 Wakeflow
写出的块、读不出的设置文件，只报告、不碰。

不碰、并在结果的 `leftBehind` 里列出：`.wakeflow-active/`、`.wakeflow-local/`、账本、
Design 与 Test 支撑面目录、worktree 检出、分支，以及插件自己的 hooks。它们归你保留、
归档或删除。

之后这个目录是一个已分离的工作区：问状态会回答 `detached` 且无事可做，严格校验不失败，
维护在这里拒绝运行。`wakeflow.detached.json` 是有意留下的证据，说明这里曾是 Wakeflow
工作区；要在这个目录重新使用 Wakeflow，先自己把这个文件移出目录，再像第一次那样初始化。

## Wakeflow 不会做的事

- 代你接受工作。接受是 Controller Agent 自己措辞记录的决定，且对着你能复读的证
  据作出。
- 在没有落地观察记录的情况下，把一次发送报成已投递。
- 覆盖你手写过的投影文件。
- 修改已发布的需求记录。更正是新的需求包，不是编辑。
- 把凭据、私有句柄或本机绝对路径放进公共结果。
