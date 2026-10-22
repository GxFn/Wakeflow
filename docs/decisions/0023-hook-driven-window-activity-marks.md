# ADR-0023 hook 驱动的窗口活动标记：tmux 窗口选项作为 UI 投影

> 状态：accepted（2026-10-20）
> 来源：[旧版逐文件复审](../reviews/2026-10-20-legacy-gap-review-and-1.1.1-plan.md) T24/T23 与裁决 R1；现场观察"太多窗口会难以观察"（§13.186）
> 相关：ADR-0003（宿主效果由 Agent 执行）、ADR-0009 调整一（hook 观察脚本只写记录）、能力卡 10 §10.3（活动监视删除，以 hook 取代）、TSD-12

## 背景

旧版的 Claude 活动监视是一个脱离进程：每 1.5 秒抓一次每个窗口的屏幕，按"`esc to interrupt` 或屏幕摘要变化"判定运行中，
把 `@wakeflow_state=running` 写到 tmux 窗口选项，闲置时恢复旧值（`wakeflow-claude-activity.mjs:1690-1707`、
`:1847-1860`）。能力卡 10 Q3 把它删除，理由是 ADR-0009 已经让宿主 hook 给出回合开始与结束的精确事实，不必再抓屏猜。
但 glyph 的另一半价值——用户在 tmux 窗口列表里一眼看到每个窗口在干什么——没有被任何东西接过去：现在每个窗口的状态
（`attention`、`runtime stale`、`launchIntent drifted`）只在 `wakeflow_status` 的文字里。现场一个工作区有 8 个窗口，
每个 worktree pod 再加 8 个；用户在 §13.186 之前明确说过"太多窗口会难以观察"。

## 问题

ADR-0009 调整一把观察脚本定义为"只写记录"，ADR-0003 把宿主写效果全部交给 Agent。要在 tmux 里显示窗口状态，
就得有人写一个窗口选项；观察器已经在每个 hook 事件上知道该写什么，但写它是 Wakeflow 进程发出的宿主效果。
要么给观察器开一个有界的例外，要么让 Controller 在动作时刷新（状态会陈旧），要么让 tmux 轮询（又回到轮询）。

## 选项

### 选项 A：观察器按事件写 `@wakeflow_state`

事件驱动，零轮询，每个事件一个短命的 tmux 客户端；需要本 ADR 作为"只写记录"的例外。

### 选项 B：助手 `glyphs` 子命令，由 Controller 在 status / deliver / 回调后运行

不改任何裁决，但状态只在 Controller 动作时更新，两次动作之间是陈旧的，正是用户看不见的那段时间。

### 选项 C：tmux `window-status-format` 里用 `#()` 调助手

tmux 按 `status-interval` 轮询助手，助手读最新 hook 记录。是轮询，只是换了个轮询者，违背卡 10 Q3 的精神。

## 决定（R1，选项 A，附约束）

1. **只投影已绑定的会话**：与记录路由同一条规则——该工作区的绑定目录持有这个 session id 才写；引导会话与
   未登记的窗口不写。
2. **只在 tmux 里**：hook 进程环境里同时有 `TMUX` 与 `TMUX_PANE` 才写；socket 路径取自 `TMUX` 的第一段，
   目标是该 pane 所在的窗口（`set-option -w -t <pane>`）。
3. **只写自己命名空间的一个选项**，词表封闭：`working`（user-prompt-submit）、`idle`（stop；notification 的
   `idle_prompt`；已绑定会话的 session-start）、`attention`（notification 的 `permission_prompt`）、清除
   （session-end，`-u`）。其他 notification 类型不写。永不 `-g`，永不写格式选项。
4. **格式由助手设**：每个受管窗口的 `window-status-format` 与 `window-status-current-format` 由 Agent 运行的
   助手 `mark` 单独设置（`#{?@wakeflow_state, [#{@wakeflow_state}],}`），从不进全局选项；窗口关闭即随窗口消失。
   这一步仍是 Agent 执行的宿主效果（TSD-12）。
5. **只是 UI 投影**：与状态行资产同类——不是状态权威，Wakeflow 从不读回它，落地与验收永不看它；写失败静默，
   永不影响记录写入；有界（超时 ≤ 1 秒，不重试）。
6. **不回来的**：轮询进程、`process.json`/`manager.lock`/服务器上下文目录、抓屏判定、`@wakeflow_prev_state`
   的保存与恢复（hook 事件是权威，不需要恢复旧值）。

## 后果

- `src/entrypoints/wakeflow-hook-observer.ts`：对已绑定会话写完记录后投影状态；投影器带可注入的 spawner，
  测试用桩。闭包仍限于 foundation 与 kernel 加 `node:child_process`。
- 助手 `mark`：设每窗口格式；`close`/`teardown` 不需要改。
- 文本：windows 参考加一段"窗口列表里的 `[working]`/`[idle]`/`[attention]` 是什么、不是什么"；首次交接卡加一行。
- 能力卡 10 §10.3 的"现 TS 状态"与能力映射矩阵"活动观察"行改为本 ADR。
- ADR-0009 调整一加一句指向本 ADR："记录之外唯一允许的宿主写效果"。
- 测试：观察器单元（spawner 桩、六种事件、未绑定不写、无 TMUX 不写、失败静默）、助手桩测试（mark 的两条格式）、
  live-guidance 钉文本。
- 现场核对：一个新工作区的首次引导加一次投递，看窗口列表里的标记变化（1.1.1 的 L11）。

## 未决问题

无（用户 2026-10-20 裁决）。

## 调整一（2026-10-21，1.1.2：open-items I15 与 I14）

现场 L11 后用户指出 tmux 底部状态栏拥挤（八个窗口名、`[idle]` 标记与默认 `status-right` 的主机名、时钟，175 列下第 8 个窗口被截）。决定 3 与 4 调整为：

- 标记只用字形，idle 不显示：`working` 显示绿色 `●`，`attention` 显示红色粗体 `?`；不用 `!`（tmux 的 bell 标志）与 `*`（当前窗口标志）。格式仍由助手 `mark` 按窗口单独设。
- 助手同时只写 Wakeflow 自己建的会话的 `status-right`（`%H:%M`）、`status-right-length`（6）与 `status-left-length`（24）：`new-session` 时设一次，`mark` 时幂等重设；从不 `-g`，用户的全局 tmux.conf 不碰。
- `idle_prompt` 通知不再让 `wakeflow_status.windows[].attention` 报 `needed`（它只是空闲一分钟的通知，与本 ADR 把它映射成 `idle` 一致）；`needed` 只对权限提示、登录、用量一类的通知。
