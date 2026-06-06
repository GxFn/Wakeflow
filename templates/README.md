# Workspace Templates

This directory stores reusable workspace-level templates for planning,
dispatch, acceptance, and documentation.

Use `.workspace-active/workspace/current/` for active Wakeflow documents and
`../workspace-ledger/` for archived or long-lived project records. Use this
directory only for stable reusable skeletons that can be copied or adapted into
future plans.

Templates should avoid task-specific status, commit hashes, local absolute
paths, secrets, or one-off decisions.

## Templates

- [test-handoff-template.md](test-handoff-template.md)：总控为 `Test` 或其它配置测试窗口创建 state-root 测试边界 card 的模板；不是派发单。
- [goal-stage-confirmation-template.md](goal-stage-confirmation-template.md)：任务级“最终目标 + 分阶段确认”模板。
- [original-plan-template.md](original-plan-template.md)：`Design` 原始计划书模板；用户确认前不承载执行阶段。
- [requirement-design-template.md](requirement-design-template.md)：需求设计文档模板。
- [workspace-signal-template.md](workspace-signal-template.md)：`Design` 给总控的轻量 bug / TODO / research / decision signal 模板。
- [workspace-handoff-template.md](workspace-handoff-template.md)：`Design` 给总控的完整需求设计 / 方案交接模板。
- [wakeflow-state-machine/](wakeflow-state-machine/)：新统一状态机需求根目录的可复用模板；安装 / 初始化脚本用它创建 ignored active state root 和唯一 `developer-progress.md`。
- [starter-workspace/](starter-workspace/)：安装时生成 `.workspace-active/workspace/` 初始活跃账本的模板。
- [window-support/](window-support/)：内部 `Design` / `Test` 支撑文件模板；外部窗口安装时也从这里同步必要文件。

实际执行文档写入 `.workspace-active/workspace/current/`；完成、归档或长期化后再收束到 `../workspace-ledger/`。模板只作为复制起点，不承载当前状态。
分阶段迁移 / 大型收口不再维护旧式长篇计划模板；先读 `skills/wakeflow-governance/references/phased-migration.md`，再用 `templates/wakeflow-state-machine/` 创建 state root 和 task package。
