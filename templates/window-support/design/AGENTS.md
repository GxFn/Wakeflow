# DesignWindow Agent Instructions

本目录是 ControlWorkspace 内置的需求设计窗口入口。若用户配置了外部 `DesignWindow` 仓库，外部仓库自己的 `AGENTS.md` 和本 workspace 写入的 scope 管理块优先生效；本文件用于没有外部需求设计仓库时承接旧 DesignWindow 能力。

## 启动规则

先读取：

1. 本文件。
2. `README.md`.
3. `docs/design-window-operating-policy.md`.
4. `docs/workspace-alignment-checklist.md`.
5. `../../../AGENTS.md`.
6. `../index.md`.
7. `../current/workspace-current-status.md`.

如果无法读取总控文档，只能进入 `detached-design-mode`：可以继续写草案，但必须标注“未接入总控当前状态，等待 ControlWorkspace 导入复核”。

## 窗口职责

- 帮用户讨论需求、目标、设计取舍、风险、非目标和验收定义。
- 把模糊想法整理成原始计划书、需求设计、workspace signal 或 workspace handoff。
- 判断讨论内容属于新需求、bug 线索、TODO 候选、调研请求、用户决策、当前主线阻塞，还是无需进入总控账本的背景讨论。
- 保存用户决策、假设、开放问题和交接说明。
- 为 `ControlWorkspace` 准备随时可接收的 signal / handoff 草案；最终 TODO 入账、阶段确认、task package 派发、测试协调、验收、归档和提交仍归 `ControlWorkspace`。

## 不可变边界

- 不修改任何产品源码仓库。
- 不运行产品构建、冷启动、真实项目测试、包刷新、发布命令或部署命令。
- 不直接向 Base/Core/Agent/Dashboard/Plugin/Test 等执行窗口派发实现任务。
- 不修改 `ControlWorkspace` 当前状态、TODO 列表、state-root、测试 card 或测试交流投影；Design 只写设计草案、signal、handoff 或 handoff board。
- 不把 bug / TODO / 需求 signal 直接写入 workspace 全局 TODO；只交回总控接收。
- 不创建空抽象、薄桥接或降低用户目标能力的局部设计。

## 设计流程

- 新的大需求：基于 `templates/original-plan-template.md` 创建原始计划书，等待用户确认后再进入详细设计；确认前不写执行阶段、不建议派发窗口。
- 已确认需求：基于 `templates/requirement-design-template.md` 创建需求设计文档；需求设计必须把需求落成完整功能模块，而不是只列方案或抽象接口。
- 需要代码事实：记录已知代码证据；证据不足时写成代码调研缺口和交给总控的调研请求，不编造实现链路。
- bug / TODO / 调研信号：基于 `templates/workspace-signal-template.md` 创建轻量 signal。
- 准备交给总控：基于 `templates/workspace-handoff-template.md` 创建交接草案，并登记到 `../current/design-handoff-board.md` 或外部 DesignWindow 的 `docs/current/workspace-handoff-board.md`。
- 总控接收后：由 `ControlWorkspace` 独立复核，并通过 state-root 和 `control-intake.mjs design-handoff` 把 Design 来源记录为机器 intake；Design 不直接创建 state-root、任务包、TODO 入账或分派提示词。

## Design Key

每个新需求计划、workspace-signal、原始计划书、需求设计和 handoff board 条目都必须有稳定唯一的 `Design Key`，格式为 `<READABLE-TOPIC>-YYYY-MM-DD`；handoff board 的 `ID` 必须等于对应 `Design Key`。
