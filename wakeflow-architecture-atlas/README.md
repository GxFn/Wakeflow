# Wakeflow Architecture Atlas（架构与代码图谱）

本目录是一个独立、只读Wakeflow源码的流程图子项目。它把可审阅Markdown/Mermaid、交互阅读器和
结构验收收敛在同一package中，不拥有Wakeflow运行状态，也不进入插件制品或根发布门。

## 目录

```text
wakeflow-architecture-atlas/
├── AGENTS.md            AI维护图谱时的局部权威、证据与隔离规则
├── CLAUDE.md            Claude Code入口，仅补充宿主注意事项
├── maps/                 33份审阅文档与43张Mermaid图的正典
├── src/                  本地阅读器与文件依赖交互视图
├── scripts/              只读结构、链接、指纹与路径检查
├── package.json          独立依赖和命令
└── vite.config.ts        仅允许读取本目录与maps，输出到根.build
```

## 使用

```text
cd wakeflow-architecture-atlas
npm install
npm run dev
npm run check:structure
npm run check
```

## 与Wakeflow主开发的边界

- 不属于根npm workspace，根`npm install`、`npm test`和release脚本不会执行本项目。
- 不被根TypeScript project references、dependency-cruiser或插件core同步读取。
- 读取`src/`、`tests/`和Schema只用于生成审阅证据；检查脚本不写这些目录。
- 唯一构建输出是被忽略的`.build/wakeflow-architecture-atlas/`，可随时删除重建。
- Markdown和来源指纹不是第二状态权威；源码变化后必须显式运行`npm run check`并刷新文档。

`npm run check:structure`会机器验证这些隔离条件：根`package.json`没有workspace或script引用、根
TypeScript/dependency-cruiser配置没有接入、本地依赖与构建输出均被忽略。它还验证33份文档、43张图、
30份来源指纹、Markdown链接、750条边证据和图中186条可解析TypeScript直接导入。来源漂移只有在文档
明确标为`stale`时通过结构门，并会列入`staleFingerprints`；`npm run check:current`与`npm run check`仍要求
全部来源指纹当前。

## AI交互规则

- 仓库根`AGENTS.md`/`CLAUDE.md`继续拥有源码维护、安全与发布规则。
- 本目录[`AGENTS.md`](./AGENTS.md)只收窄图谱任务的事实优先级、编辑约束和隔离边界，是
  Codex及其他支持`AGENTS.md`智能体的局部入口。
- 本目录[`CLAUDE.md`](./CLAUDE.md)要求Claude Code先读取局部`AGENTS.md`，仅保留宿主差异，
  避免两份完整规则随时间产生漂移。
- 详细绘图方法仍由[`maps/00-agentic-diagram-standard.md`](./maps/00-agentic-diagram-standard.md)
  负责，使用命令留在本README；规则文件不重复维护操作手册。

图集内容与维护规则见[maps/README.md](./maps/README.md)。
