# DesignWindow 与 ControlWorkspace 能力对齐检查

状态：长期规则

本文件用于确认 `DesignWindow` 的文档和配置能完整承接 `ControlWorkspace` 的需求设计前置能力。它不是执行计划，也不替代总控规则。

## 角色边界

| 总控能力 | DesignWindow 对应产物 | 必须保留的边界 |
| --- | --- | --- |
| 识别用户目标和最终完成定义 | `original-plan`、`requirement-design`、`workspace-handoff` | 只定义目标，不宣布实现完成。 |
| 原始计划确认 | `original-plan` 的确认问题和用户确认状态 | 用户确认前不写执行阶段、不建议发送窗口。 |
| 完整功能闭环设计 | `requirement-design` 的用户场景、输入、输出、状态变化、生产方、消费方、失败路径 | 不接受空接口、空 adapter、只改类型的设计。 |
| 真实代码事实和调研缺口 | `requirement-design` 的代码事实与调研缺口，或 `workspace-handoff` 的调研请求 | 证据不足时写缺口，不编造调用链。 |
| 仓库覆盖判断 | `original-plan` 初步影响、`requirement-design` 仓库边界、`workspace-handoff` 建议覆盖 | 只能建议覆盖，不直接派发实现窗口。 |
| TODO / Backlog 账本 | `requirement-design` 和 `workspace-handoff` 的 TODO / Backlog | 设计期 TODO 不替代 workspace 全局 TODO，需总控接收后归口。 |
| bug / TODO / 调研 / 决策即时回传 | `workspace-signal` | Signal 可随时交回总控，但不能直接改 workspace 当前状态。 |
| 阶段顺序 | `requirement-design` 和 `workspace-handoff` 的阶段候选 | 候选不是 task package；最终阶段顺序由总控确认。 |
| 测试交接 | `requirement-design` 的验证策略和 `workspace-handoff` 的验证需求 | 不直接创建 `TestWindow` 测试 card / 任务包，不跑真实项目测试；总控接收后再决定是否用 `control-intake.mjs test-card`。 |
| 当前主线保护 | `workspace-handoff` 的当前主线关系 | 不打断当前主线；是否提升为主线由总控决定。 |

## Signal 必填检查

- 类型已经标注：`bug` / `todo` / `research` / `decision` / `current-mainline-risk` / `requirement-candidate`。
- 是否建议打断当前主线已经说明。
- 证据状态已经说明：用户描述、截图、代码证据、测试证据、待调研。
- 推荐归口是建议，不是派发。
- 下一步建议是给总控评审，不是执行窗口提示词。

## Handoff 必填检查

- 用户目标和最终完成定义已经写清。
- 当前主线关系已经标注。
- 原始计划确认状态明确；未确认时不能建议执行。
- 需求设计状态明确；没有完整闭环时不能建议目标阶段确认。
- 已知代码事实与待调研问题分开记录。
- 仓库覆盖是建议，不是派发。
- 阶段顺序是候选，不是 task package。
- TODO / Backlog 已记录设计中发现的风险、偏好、验证缺口和后续拆分点。
- 验证需求只说明需要证明什么、为什么需要真实场景、成功 / 失败 / 不能推出什么；不得替总控创建测试 card 或指定发送线程。
- 任何删减、降级、延期、兼容保留、职责边界变化都列为待确认。
- 如果处于 `detached-design-mode`，必须提醒总控导入后重新校验当前状态。
