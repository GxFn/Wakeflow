# Requirement Design Template

状态：长期模板
维护窗口：ControlWorkspace

本模板用于 `../workspace-ledger/requirement-designs/<需求名>/requirement-design-YYYY-MM-DD.md`：必须先读取同目录中已经由用户确认的原始计划书，再按用户需求调研真实代码、功能逻辑、模块边界和跨仓库连通性，形成需求目标、实现方案和分阶段步骤。原始计划书未确认前，不应创建或激活需求设计文档。只有完成这份需求设计文档后，才进入 `.workspace-active/workspace/current/` 的任务级目标阶段确认。

需求设计文档必须把需求落成完整功能模块。不要把当前已有能力当成目标上限，也不要只设计抽象接口、空 adapter、空 provider、无调用方 glue code 或只连线不形成用户可用能力的阶段。需求不明确时，把问题写入“待确认问题”，不要进入派发。

需求设计完成后若进入 workspace 执行推进，后续默认创建 controller state root 和唯一 `developer-progress.md`，模板来自 `templates/control-state-machine/`，并遵守 `scripts/README.md` 的脚本可读格式说明。需求设计本文不直接承载窗口派发。

## 原始计划书

- 原始计划书：
- 原始计划书确认状态：`unconfirmed` / `confirmed` / `needs-confirmation` / `not-required` / `superseded`
- 原始计划书确认说明：
- 用户确认时间：
- DesignWindow 来源 signal / handoff（如有）：
- Design 接收状态：`draft` / `ready-for-workspace` / `accepted-by-workspace` / `needs-design` / `paused` / `archived` / `research` / `absorbed-by-codex-loop`
- 当前主线关系状态：`none` / `todo-candidate` / `next-mainline` / `blocks-current` / `interrupts-current` / `after-current`

## 用户需求

```text
<保留用户需求的关键原话或准确转述>
```

## 需求明确性检查

- 用户场景：
- 完整功能闭环：
- 输入：
- 输出：
- 状态 / 数据变化：
- 生产方：
- 消费方：
- 验证方式：
- 完成定义：
- 仍不明确的问题：

## 调研范围

- 必读仓库：
- 观察仓库：
- 暂不纳入仓库：
- 关键入口文件：
- 关键测试 / 脚本：

## 外部调研判断

- 是否需要联网：
- 判断理由：
- 若需要，优先来源：官方文档 / 标准规范 / 主流项目源码或文档 / 权威资料。
- 若不需要，说明原因：
- 外部结论如何约束或启发本地实现：

## 真实代码事实

按仓库记录，不写猜测：

### CoreWindow

- 已有能力：
- 关键文件：
- 缺口：

### BaseWindow

- 已有能力：
- 关键文件：
- 缺口：

### PluginWindow

- 已有能力：
- 关键文件：
- 缺口：

### DashboardWindow

- 已有能力：
- 关键文件：
- 缺口：

### AgentWindow

- 已有能力：
- 关键文件：
- 缺口：

### TestWindow / 真实项目验证

- 是否纳入：
- 理由：
- 目标项目（如有）：

## 代码实现依赖调研

对跨仓库、运行时、项目控制、发布链路、模块边界、删除清理等复杂需求，需求设计完成后必须继续补充深度代码实现依赖调研。可在本节记录摘要，并在同目录新建 `code-implementation-dependency-research-YYYY-MM-DD.md` 保存证据细节。

- 是否需要单独调研附件：
- 调研附件：
- 关键生命周期：
- 共享状态 / 持久化位置：
- producer / consumer 硬依赖：
- 不能切换 / 不能删除 / 不能提前消费的边界：
- 是否需要外部资料：

## 目标能力设计

不要把当前已有能力当成目标上限。这里按用户需求设计完整能力：

- 最终能力：
- 用户体验：
- 功能闭环：
- 模块边界：
- 数据 / 状态模型：
- API / contract：
- UI / handoff：
- 安装 / 发布 / artifact：

## 禁止的伪实现

- 抽象接口但没有真实生产方和消费方。
- 空 provider / 空 adapter / 空 service。
- 只改类型或导出，不形成可验证功能闭环。
- 只做无业务语义的代码连接。
- 只为未来可能需要而创建中间层。

## 差距分析

| 能力 | 当前状态 | 缺口 | 归属窗口 | 风险 |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

## TODO / Backlog

本节用于需求设计期的 TODO：记录用户讨论中新增的偏好、风险、候选优化、验证点、待调研问题和后续拆分输入。它不是执行派发，不能绕过代码实现依赖调研和目标阶段确认。

| ID | 状态 | 类型 | 严重度 / 优先级 | 归属 | 事项 / TODO | 影响目标 / 派发 | 依赖 / 触发 | 推荐窗口 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TODO-1 | 观察 / 阻塞 / 主线 / 可并行 | 需求 / 设计 / 风险 / 验证 / 文档 / 清理 | P0 / P1 / P2 | `Repo` |  | 是 / 否 |  | `Repo` |

## 后续拆分候选方向

这是调研后的候选方向，不等于执行派发，也不等于最终目标阶段确认。必须完成必要的代码实现依赖调研，并在 `.workspace-active/workspace/current/` 创建任务级目标阶段确认文档，经用户确认后，才能创建 controller state root 和 task package。

| 阶段 | 目标 | 生产窗口 | 消费窗口 | 完成判断 |
| --- | --- | --- | --- | --- |
| 1 |  |  |  |  |
| 2 |  |  |  |  |
| 3 |  |  |  |  |

## 待确认问题

- 需要用户确认：
- 需要后续代码验证：
- 不应提前派发：

## 进入目标阶段确认

- 建议创建的确认文档：
- 是否已经完成代码实现依赖调研：
- 建议第一波候选窗口：
- 明确不派发窗口：
