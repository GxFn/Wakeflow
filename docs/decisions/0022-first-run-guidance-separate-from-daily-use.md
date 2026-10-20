# ADR-0022 首次引导与日常使用分开设计

> 状态：accepted（2026-10-19）
> 来源：现场 L1 的 F-L1-7 与 open-items I1、I2、I5；用户裁决"教学要详细，日常使用要避免冗余"
> 相关：ADR-0017（窗口运行身份）、§13.134（I6 引导会话）、gate-log §13.188

## 背景

第一轮现场（§13.181–§13.183）里，首次初始化的体验有四处断点：引导会话（工作区建立之前启动的那次 `claude`）
在 apply 之后试图用 `self` 登记自己，被拒 `hook-evidence-missing`；接着为 Controller 开窗又被拒
`adopt-unproven`，因为 `self` 已经把引导会话的 pane 标成了 Controller 窗口；用户只能手工 `/exit` 再重启
（F-L1-7）。初始化完成后没有人把用户引到 Design 窗口，空闲工作区的 `status.next` 为空（I1）；在已有 tmux
会话里启动时窗口开到别的会话去（I2）；Controller 自采的核对文件没有指定位置（I5）。同时，每次都读的
`SKILL.md` 和 windows 参考承担了所有教学文字，日常使用时成了冗余。

根因只有一个：Claude Code 的 hook 在会话启动时定型，工作区建立之前启动的会话永远不会写出自己的
session-start 记录，所以它永远证明不了自己。既然如此，它就不该尝试成为 Controller。

## 决定

1. **引导会话只引导，从不成为 Controller。** 判据是助手 `preflight` 的 `sessionProven`（本会话有没有自己的
   session-start 记录），不是 `insideTmux`。`sessionProven: false|null` 的会话：收集选择、预览、应用，然后用
   助手把 Controller 窗口开进配置的 tmux 会话，再开其余窗口，交给用户一条命令（在 tmux 外是 `attach`，已在
   tmux 内是 `switch`）和要接受的信任对话，登记、打标、出交接卡，最后让用户关掉引导会话。`self` 在没有
   session-start 记录时先拒绝、不在 pane 上写标识；收养候选永远排除助手自己所在的 pane。
2. **教学与日常分开。** 教学只在新工作区发生一次：Controller 的 `references/first-run.md`（问答脚本、引导、
   交接卡、每个窗口是做什么的）和两份 README 的"第一次使用"一节；交接卡的宿主细节（tmux 会话、attach/switch、
   按键）只在第十二个占位符 `firstRunHandover` 里，Codex 用自己的措辞。日常使用只读 `SKILL.md` 与
   `wakeflow_status`：空闲工作区的 `next` 是 `requirement-authoring`（owner `user`），Controller 用一句话把用户
   指到 Design 窗口，不重复教学；README 的"日常使用"只列主流程与"问 Controller 下一步"。
3. **给 Agent 的引导补齐四条事实。** 目标窗口的临时文件只能放在检出的忽略路径或系统临时目录；测试窗口以逐条
   列出用例的方式运行套件；任务包要写明检出自己满足不了的环境前置（兄弟仓库的构建产物等）与由谁提供；
   Controller 的核对文件放在 Test 面的 `controller-checks/<demandId>/`。pod 文本写明相对路径 `file:` 依赖在
   worktree 里解析不到。

## 后果

- 首次初始化不再需要手工重启；引导会话在 tmux 内外走同一条路。
- `status.next` 永不为空：空闲时指向 Design 窗口。
- 教学文字离开每次必读的路径；`SKILL.md` 仍在 200 行内，windows 参考仍在 400 行内。
- 代价：第十二个占位符；首次引导多读一份 100 行的参考（只读一次）。
