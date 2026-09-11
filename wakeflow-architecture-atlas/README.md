# Wakeflow Architecture Atlas

独立的本地架构图谱，Markdown/Mermaid 是内容正典，阅读器只负责显示、搜索、缩放与证据定位。

本轮基线为 `7ba1f38`（2026-09-11 核验）：L1 九片已落地，当前 19 个公共工具、16 个一次性场景；observation、L2、L3/E4 仍是后续范围。

## 阅读和维护

- [图谱入口](./maps/README.md)
- [逐图核验台账](./maps/01-diagram-review-ledger.md)
- [本轮更新范围与验证](./plans/l1-nine-slices-refresh.md)
- [上轮差异审查计划（历史）](./plans/typescript-atlas-refresh-plan.md)

在本目录运行：

```text
npm install
npm run dev
npm run check
```

`check` 依次执行检查器回归测试、阅读器类型、结构/指纹、实际浏览器渲染回执和 Vite 构建。改图后，在本地浏览器打开 `scripts/mermaid-validation.html`：它使用锁定 Mermaid 逐图解析与渲染，并通过仅本地同源的验证端点保存固定回执。`check:diagrams` 复验每张图的源码摘要、数量、渲染版本和成功结果；旧回执或缺失回执会失败，不把未渲染的新图当作通过。

## 结构与隔离

- `maps/`：当前图、术语、源/符号映射和证据表。
- `plans/`：范围、历史审查与验证快照。
- `src/`：阅读器与依赖探索。
- `scripts/`：只读源码检查、独立测试和图形渲染验证。

本 package 不加入根 npm workspace、TypeScript references、dependency-cruiser、插件 core 同步或发布流程。构建输出在被忽略的根 `.build/wakeflow-architecture-atlas/`。图谱检查不修改 Wakeflow 源码。

## 派生视图

[当前 FigJam](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=16-489) 已同步本轮三组摘要：当前组成、九片业务主线、实现目标状态与恢复；附进度表，旧图完整保留在折叠的历史区域。29 个可编辑节点和 32 条边已逐项对照本地 Mermaid，并经过截图检查，见 [同步记录](./plans/evidence/l1-nine-slices-figjam.json)。其余细节在本地 67 图中阅读。FigJam、HTML/SVG/截图均为派生视图，不拥有运行状态。

## 权威

根规则继续适用；本目录 [AGENTS.md](./AGENTS.md) 规定局部边界，[CLAUDE.md](./CLAUDE.md) 引用该正典。具体绘图和核验方法见 [图谱标准](./maps/00-agentic-diagram-standard.md)。
