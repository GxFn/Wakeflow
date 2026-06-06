# <需求标题> Workspace 交接

日期：YYYY-MM-DD
状态：草案
Design Key：<READABLE-TOPIC-YYYY-MM-DD>
来源窗口：DesignWindow
接收窗口：ControlWorkspace

## 摘要

简要说明 `ControlWorkspace` 需要评审什么。

## 交接类型

标记一项：

- requirement-design
- design-decision
- research-result
- bug-with-design-impact
- todo-package-candidate
- current-mainline-risk

## 用户已确认目标

...

## 最终完成定义

...

## 当前设计状态

- 用户确认状态：`unconfirmed` / `confirmed` / `needs-confirmation` / `not-required` / `superseded`
- 用户确认说明：
- Handoff 状态：`draft` / `ready-for-workspace` / `accepted-by-workspace` / `needs-design` / `paused` / `archived` / `research` / `absorbed-by-codex-loop`
- 主线关系状态：`none` / `todo-candidate` / `next-mainline` / `blocks-current` / `interrupts-current` / `after-current`
- 优先级枚举：`P0` / `P1` / `P2` / `P3`
- 原始计划确认状态：
- 需求设计状态：
- 代码事实状态：
- 是否需要总控继续代码实现依赖调研：
- 是否处于 detached-design-mode：
- 与 ControlWorkspace 当前主线关系：

## 建议下一步

选择一项：

- 接收为当前主线 bug / 返修候选。
- 加入 TODO。
- 在 ControlWorkspace 启动原始计划确认。
- 启动需求设计 / 代码调研。
- 创建目标阶段确认。
- 创建 controller state root / task package。
- 暂停，等待用户确认。

说明：本建议只给 `ControlWorkspace` 评审，不是执行窗口提示词。

## 功能闭环摘要

- 用户场景：
- 输入：
- 输出：
- 状态变化：
- 生产方：
- 消费方：
- 失败路径：

## 建议仓库覆盖

| 窗口 | 建议状态 | 建议职责 | 依赖 / 阻塞 |
| --- | --- | --- | --- |
| BaseWindow | 参与 / 观察 / 无任务 / 待调研 |  |  |
| CoreWindow | 参与 / 观察 / 无任务 / 待调研 |  |  |
| AgentWindow | 参与 / 观察 / 无任务 / 待调研 |  |  |
| DashboardWindow | 参与 / 观察 / 无任务 / 待调研 |  |  |
| PluginWindow | 参与 / 观察 / 无任务 / 待调研 |  |  |
| DesignWindow | 设计完成 / 继续调研 / 无任务 |  |  |
| TestWindow | 参与 / 观察 / 无任务 / 待调研 |  |  |
| RealTestProject | 观察 / 受保护 / 无任务 |  |  |

## 证据与链接

- 原始计划：
- 需求设计：
- 代码调研 / 待调研：
- 用户决策：
- TODO / Backlog：

## 风险

- ...

## 非目标与禁止捷径

- ...

## 建议阶段候选

| 阶段 | 目标 | 上游 / 下游 | 完成判断 |
| --- | --- | --- | --- |
| 1 |  |  |  |

阶段候选仅供总控评审，不是 task package 派发依据。

## 给 ControlWorkspace 的开放问题

1. ...

## 交接前自检

- 已对照 `docs/workspace-alignment-checklist.md` 或外部 DesignWindow 的同名文件：
- 本 handoff 没有包含可复制实现窗口提示词：
- 阶段仍为候选，未写成 task package：
- TODO / Backlog 已列入证据与链接：
- 如有删减、降级、延期、兼容保留或边界变化，已列为待确认：
