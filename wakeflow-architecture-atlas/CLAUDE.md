# Wakeflow Architecture Atlas — Claude Code 入口

在本目录工作前，先读取仓库根 `../CLAUDE.md`、`../AGENTS.md`，再读取本目录
[`AGENTS.md`](./AGENTS.md)。根规则继续适用，本目录 `AGENTS.md` 是图谱工作的局部规则正典；
本文件只补充 Claude Code 宿主注意事项，不复制整套规则。

## Claude Code 注意事项

- 将图谱维护视为只读 Wakeflow 实现的文档任务。除非用户明确扩大范围，否则只修改本目录。
- 不因终端、tmux、session 或子任务显示“完成”就把能力标为已实现；必须核对当前工作树、
  Schema、测试与差异。
- 图谱不需要创建、接管或记录 Claude Code session/tmux transport；不得把 session ID、pane、
  raw handle 或本机缓存路径写入文档。
- Mermaid/Markdown 是正典，HTML 阅读器和 Figma 是派生阅读面。视觉优化不得改变未经证实的
  业务语义或掩盖进行中、未实现和历史状态。
- 修改完成后，在本目录运行 `npm run check`，再从仓库根运行 `git diff --check` 并检查实际差异。

若请求转为 Wakeflow 运行时代码、Claude 插件制品、宿主适配或发布维护，停止使用本目录的
图谱专属边界，回到仓库根 `CLAUDE.md` / `AGENTS.md` 对应流程。
