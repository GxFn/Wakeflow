# Wakeflow 架构与代码图谱

基于真实代码的职责、调用、状态与恢复图谱。`maps/` 的 Markdown/Mermaid 是内容正典；阅读器和 FigJam 是派生阅读面。

**2026-10-03 工作树快照，当前版本输入为 1.1.0-rc.5 候选**，提交基线 `d8fafff3`，包含已审阅的未提交实现。20 个公共工具分属 10 个能力切片；Config、锁和 status/verify 结果使用当前 v2 合同，不提供旧工作区格式迁移。

提交补记（2026-10-03）：上述 Wakeflow 实现及双宿主制品已分批纳入本地提交，源码系列截至 `190e1371`。以下审阅、图和截图保留核验时的工作树快照与原始基线，不改写为事后执行的验证；提交记录见仓库开发日志 §13.152。

当前覆盖 **370 个 Wakeflow 手写文件（360 个运行时、10 个工具）**：本轮 **7 个完整语义重审、363 个按相同字节继承实际选中的历史记录**。95 份 Schema、95 份生成 TS、297 个测试/fixture/support 文件另记库存与断言范围，不重复计为手写语义审阅，也不声称所有测试文件都逐行审完。

- [按问题进入图谱](./maps/README.md)
- [逐文件索引](./maps/02-file-review-index.md)与[当前覆盖报告](./plans/review-2026-10-03-rc4/review-coverage.json)
- [总体职责](./maps/01-overall-architecture/README.md)与[业务接力](./maps/10-end-to-end-business-flow/README.md)
- [当前修复与限制](./maps/10-end-to-end-business-flow/review-evidence.md)
- [验证来源与范围](./plans/review-2026-10-03-rc4/validation-provenance.md)与[最终来源快照](./plans/review-2026-10-03-rc4/source-baseline-final.json)

## 本轮更新

当前 **76 份 maps 文档、100 张 Mermaid 图、17 个专题**。本轮新增 5 页、10 张下钻图，重点解释隐私分类与披露、证据来源一致性、回调数据与评审权威、准入竞争及失败结算。既有图修正错误分支、条件和测试依据，保留未覆盖路径。

本轮转交开发线程并核验闭合了四项问题：未知前缀 UUID 漏检、诊断截断导致隐私摘要回显、短 latch 失败遗失准入许可、回调丢失 Git 提交身份。图谱线程复核实际代码、消费者和前后态探针，生产修复由另一个开发线程完成。修复前失败记录保持原样。

当前目录 `plans/review-2026-10-03-rc4/` 保留起始 rc.4 名称，最终快照和验证来源明确记录 rc.5；`review-2026-10-03/` 是前轮 rc.3，`review-2026-10-02/` 是更早历史。历史源码字节相同的语义记录可以按证据链继承，历史测试和原生宿主结论不自动变成当前通过。

本线程独立执行了三组后态探针与覆盖汇总检查。开发线程的持久门日志记录 rc.5 **1244 项测试、20 个端到端场景和双宿主 smoke 通过**；本线程已核对命令脚本与两份候选 manifest 摘要，但没有再次运行这套根门。**rc.5 原生会话未验证**；详见[验证来源](./plans/review-2026-10-03-rc4/validation-provenance.md)。100/100 本地图已在浏览器实际渲染；FigJam 17 个重点视图已完成结构、语义与截图核验，见[本轮交付](./plans/review-2026-10-03-rc4/handoff.md)。

## 阅读与维护

先看总体职责，再进入业务接力与对应模块。静态导入、真实调用、状态/恢复分别成图；每张图带中文术语和逐边代码/测试证据。“工作树快照”说明包含未提交字节，不表示某个 Demand 已接受或版本已发布。

在本目录运行：

```sh
npm run dev
npm run check
```

`check` 包含检查器回归、阅读器类型、来源/符号/直接导入/测试锚点、浏览器 Mermaid 渲染回执复验和 Vite 构建。修改图后打开本地 `scripts/mermaid-validation.html` 重新渲染；旧回执不能证明新图通过。

| 位置 | 职责 |
| --- | --- |
| maps/ | 当前图、术语、证据与逐文件入口 |
| plans/review-2026-10-03-rc4/ | 当前 rc.5 候选的起始/最终快照、语义记录、覆盖与验证来源 |
| plans/review-2026-10-03/ | rc.3 历史审阅与执行记录 |
| plans/review-2026-10-02/ | 更早基础审阅与失败证据 |
| src/ | 阅读器、搜索、缩放与证据定位 |
| scripts/ | 独立结构、来源和渲染检查 |
| plans/evidence/ | 渲染回执、截图等派生证据 |

本 package 不加入根 workspace、TypeScript references、架构检查或发布流程。构建输出为被忽略的根 `.build/wakeflow-architecture-atlas/`；图谱工作没有提交、推送、安装或刷新插件缓存。

## FigJam 派生图

[当前架构入口](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=62-1743) · [17 图合集](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=62-1739) · [回调状态下钻](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=76-2662)。

本轮 17 个重点视图包含 160 个节点、158 条边，已与当前源图逐项对照。8 个面板有本轮新截图（7 个新增或重绘、1 个总体边界说明更新）；另 9 个未变面板沿用 rc.3 已检查截图，并明确记录继承范围。详见[派生清单](./plans/review-2026-10-03-rc4/figjam-derivation.json)与[交付记录](./plans/review-2026-10-03-rc4/handoff.md)。本地 100 图仍是完整阅读面，均有[本轮浏览器渲染回执](./plans/evidence/current-mermaid-render.json)。

[rc.3 历史克隆](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=68-1739)与[10 月 2 日区域](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=42-1099)保留历史布局；两张被替代的原图移至[旧图保留区](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=76-2634)，原节点 ID 保留。旧派生清单未改写，旧渲染回执不能用作本轮通过证明。

[局部规则](./AGENTS.md) · [绘图标准](./maps/00-agentic-diagram-standard.md)。
