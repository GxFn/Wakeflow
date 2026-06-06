# DesignWindow Operating Policy

状态：长期规则
维护窗口：DesignWindow
接收窗口：ControlWorkspace

## 目的

`DesignWindow` 将需求讨论与实现派发拆开。它给用户一个专门讨论想法、打磨需求和比较方案的窗口；`ControlWorkspace` 仍然是执行、验收、TODO 归口和归档的总控。

## 控制关系

- `ControlWorkspace` 负责最终状态、当前主线、TODO 优先级、窗口派发、测试交接、验收和归档。
- `DesignWindow` 负责探索性需求讨论和设计草案准备。
- 设计草案只有在 `ControlWorkspace` 接收、创建或连接 controller state-root、并按总控判断生成任务包后，才会变成可执行工作。
- 如果 `DesignWindow` 被单独打开且读不到总控文档，只能进入 `detached-design-mode`。

## 允许事项

- 澄清产品目标和用户场景。
- 起草原始计划书、需求设计、workspace signal 和 workspace handoff。
- 比较架构方案和取舍。
- 识别需要 `ControlWorkspace` 或源码仓库窗口补充的代码调研请求。
- 识别讨论内容是否应作为 bug 线索、TODO 候选、调研请求、用户决策或当前主线阻塞交回总控。

## 与总控需求设计能力对齐

- 原始计划书只记录用户目标、背景、范围、约束和确认问题；用户确认前，不写执行阶段、不推荐发送窗口。
- 需求设计必须包含用户场景、完整功能闭环、输入输出、状态变化、生产方、消费方、失败路径、仓库边界、验证策略和完成定义。
- 复杂需求必须显式判断是否需要代码实现依赖调研；若设计窗口没有足够代码证据，必须把调研范围、入口、调用链和待验证问题写成交接给总控的请求。
- 阶段只能作为候选方向，不能作为执行派发依据；最终阶段顺序由总控在目标阶段确认和 controller state root 中确定。
- 讨论中产生的 TODO、风险、删除候选、兼容保留、验证缺口和用户偏好，必须落到设计文档或交接草案，不能只留在聊天里。
- 任何会降低目标能力、只做框架、延期关键能力、保留兼容层或改变仓库职责边界的设计，必须标为待确认。

## 交接契约

- **Signal**：用于 bug 线索、TODO 候选、调研请求、用户决策、当前主线风险或轻量建议。使用 `templates/workspace-signal-template.md`。
- **Handoff**：用于较完整的需求设计或方案交接。使用 `templates/workspace-handoff-template.md`。
- **Handoff board**：正式需求设计完成后的清单入口。内部模式默认是 `.workspace-active/workspace/current/design-handoff-board.md`；外部 DesignWindow 默认是 `docs/current/workspace-handoff-board.md`。状态为 `ready-for-workspace` 的条目可被总控发现和校验。
- **State-root intake**：总控正式接收后，用 `control-intake.mjs design-handoff` 把 handoff board 条目和关联文档作为 `intake/*.json` 附着到 controller state-root。这个 intake 不是 TODO、不是任务包、不是实现派发。

每次交回 `ControlWorkspace` 的 handoff 草案应包含：

1. 需求标题和用户目标。
2. 设计状态。
3. 最终完成定义。
4. 已知事实和证据。
5. 开放问题和已确认决策。
6. 建议覆盖的仓库 / 窗口。
7. 建议阶段候选。
8. 验证需求。
9. 非目标和禁止捷径。

`ControlWorkspace` 接收 handoff 前仍需独立复核；handoff 和 state-root intake 都不是目标阶段确认，也不是 task package。只有总控通过 `controller-state.mjs add-task-package` 创建任务包后，才进入执行路线。
