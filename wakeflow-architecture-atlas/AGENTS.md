# Wakeflow Architecture Atlas 智能体规则

本目录是 Wakeflow 源码仓库内的独立文档与可视化子项目。仓库根目录的
`AGENTS.md` 仍然适用；本文件只收窄图谱工作的局部边界，不改变 Wakeflow
源码维护、发布或宿主制品规则。

## 工作范围

- 常规图谱任务只修改本目录。`src/`、`tests/`、JSON Schema 和审阅台账是只读证据，
  不是为了方便画图而顺手修改的对象。
- 用户若明确要求同时修改 Wakeflow 实现，应先退出图谱专属范围，并按根目录规则处理
  源码、生产者、消费者、Schema 和测试。
- `maps/**/*.md` 中的 Markdown 与 Mermaid 是图谱内容正典；`src/` 中的阅读器只负责
  展示和交互，不拥有业务事实。
- Figma、截图、导出的 SVG/PNG/PDF 和 HTML 构建结果都是派生阅读面，不得反向成为
  图谱或 Wakeflow 状态权威。

## 事实与证据优先级

判断“当前已经实现什么”时，按以下顺序核验：

1. 当前工作树中的生产 TypeScript、JSON Schema 和聚焦测试；
2. 当前审阅台账中已闭合单元及其可复验记录；
3. 活跃开发任务的设计与进度背景；
4. 旧 JavaScript、历史任务和旧版流程图。

任务或智能体自述完成不能代替源码、差异和测试证据。图谱只表达经核验的实现事实、
进行中边界和未实现停止点，不拥有需求状态、Controller 决策或运行时状态。

## 编辑要求

- 新建或大改文档前，先读本目录 `README.md`、`maps/README.md`、
  `maps/00-agentic-diagram-standard.md`，再读该图涉及的真实源码、Schema、调用方、
  消费者和测试。
- 面向读者的标题、节点、边标签、结论和图后说明使用中文；代码标识保持原拼写并解释。
- 每张 Mermaid 图必须有中文 `accTitle`、`accDescr`，并紧邻“本图术语说明”。
- 文件导入、运行时调用、耐久状态转换和智能体自主决策必须分图表达，不能用一类连线混写。
- 使用稳定节点 ID、数字化证据边 ID 和仓库相对路径，使审阅者能够从图回到文件、符号与测试。
- 只画真实存在的生产者和消费者；目标设计、进行中实现、未实现边界与历史参考必须显式区分。
- 来源指纹不一致时，先重读实际差异并修正结论、图、证据表和状态；禁止只刷新摘要值来让检查通过。
- 不提交本机绝对路径、私有任务/线程/会话 ID、宿主句柄、token、secret 或机器缓存路径。
- 不手工编辑 `node_modules/` 或仓库根 `.build/wakeflow-architecture-atlas/` 中的派生产物。

## 隔离边界

- 本 package 不加入根 npm workspace，也不接入根 npm scripts、TypeScript project references、
  dependency-cruiser、插件 core 同步、smoke 或 release 流程。
- 图谱检查可以只读仓库源码并报告漂移，但不得写入图谱目录之外。
- 不得为了图谱通过而放宽 Wakeflow 根校验、修改运行时行为或伪造来源证据。

## 验证与交付

在本目录运行：

```text
npm run check
```

交付前还应从仓库根运行 `git diff --check`，检查实际差异，并说明：更新了哪些图、依据哪些
源码/Schema/测试、是否存在指纹漂移或未验证边界，以及工作树中哪些改动与本任务无关。
