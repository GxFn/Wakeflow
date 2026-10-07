# Wakeflow 架构与代码图谱

基于真实代码的职责、调用、状态与恢复图谱。`maps/` 的 Markdown/Mermaid 是内容正典，阅读器、截图和 FigJam 是派生阅读面。

**2026-10-04 当前工作树：`04769897` 加维护工具未提交字节，插件版本 1.1.0-rc.5。** 20 个公共工具、10 个能力切片；Config、锁与 status/verify 使用当前 v2 合同，不提供旧工作区格式迁移。

当前 **407 个手写文件（360 个运行时、47 个工具）**。本轮复核两个新增、两个修改工具及同字节I/O复用边界，共五文件；其余402个按当前SHA与前轮原始semantic记录继承。95 Schema、95 generated、314个测试相关TS另记库存与断言范围，不重复计为本轮手写语义审阅。

- [按问题进入图谱](./maps/README.md)
- [逐文件索引](./maps/02-file-review-index.md)与[当前覆盖报告](./plans/review-2026-10-04-diagnostic-bundles/review-coverage.json)
- [维护验证](./maps/17-artifacts-and-contracts/maintainer-verification.md)、[lab/live边界](./maps/17-artifacts-and-contracts/lab-and-live-tools.md)、[固定业务实验](./maps/17-artifacts-and-contracts/lab-business-scenarios.md)、[CI与模型证据](./maps/17-artifacts-and-contracts/ci-and-model-evidence.md)
- [总体职责](./maps/01-overall-architecture/README.md)与[业务接力](./maps/10-end-to-end-business-flow/README.md)
- [本轮验证来源与未闭合范围](./plans/review-2026-10-04-diagnostic-bundles/validation-provenance.md)

## 本轮更新

当前包含 **82 份 maps 文档、112 张 Mermaid 图、17 个专题**。新增只读故障包页和2张图，补正维护CLI与诊断调用。精确源字节、SDK投影、诊断状态和分享完整性分别表达。

维护工具是开发辅助，不进入制品运行时闭包，不拥有Demand状态或业务验收。特别区分本地门、生成制品实验、导入观察、原生会话和远端CI；已有绑定只对账，未知尝试不自动重复，来源未验证不会因JSON自述而升格。 前轮已完成单一外层项目10聊天的原生main/worktree场景与清理，包含实现返工、harness缺陷的限定重试和原始证据保留；宿主关联、回调hook及列表回读限制仍单独记录。

旧1313项根门与双宿主smoke保持历史记录，本轮新字节另行执行完整源码门和制品验证，结果分别记在当前验证来源。本轮图谱结构与浏览器渲染结果以[当前回执](./plans/evidence/current-mermaid-render.json)和[验证来源](./plans/review-2026-10-04-diagnostic-bundles/validation-provenance.md)为准。

## 阅读与维护

先看总体职责，再进入业务接力或维护工具。每张图带中文术语、逐边代码/测试证据；文件字节匹配、符号存在和图能渲染分别是不同保证。

```sh
npm run dev
npm run check
```

在本目录执行。`check` 包含检查器回归、阅读器类型、来源/符号/直接导入/测试锚点、真实浏览器渲染回执复验和Vite构建。图改变后从本地 `scripts/mermaid-validation.html` 重新渲染，不复用旧源摘要冒充新图通过。

| 位置 | 职责 |
| --- | --- |
| maps/ | 当前图、术语、边证据和逐文件入口 |
| plans/review-2026-10-04-diagnostic-bundles/ | 本轮工具语义记录、当前库存、原始静态图和验证来源 |
| plans/review-2026-10-03-rc4/ | 上一轮rc.5运行时修复的历史审阅与证据；目录保留起始rc.4名称 |
| plans/review-2026-10-03/ 与 review-2026-10-02/ | rc.3及更早历史审阅与失败证据 |
| src/ 与 scripts/ | 阅读器及独立检查器；不拥有业务事实 |
| plans/evidence/ | 当前渲染回执与历史派生证据 |

本package不加入根workspace、TypeScript references、架构规则或发布流程。构建输出位于被忽略的根 `.build/wakeflow-architecture-atlas/`。本轮不提交、推送、安装或刷新插件缓存。

## 历史修复与 FigJam

上一轮核实的四项修复为未知前缀UUID漏检、诊断截断导致摘要回显、短latch失败遗失许可、回调丢失Git对象身份；其前后态记录见[历史交付](./plans/review-2026-10-03-rc4/handoff.md)与[验证来源](./plans/review-2026-10-03-rc4/validation-provenance.md)。这些文件保持原始基线，不改写为本轮执行。

[FigJam 17视图](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=62-1739)保留上一轮快照，[派生清单](./plans/review-2026-10-03-rc4/figjam-derivation.json)记录其160节点、158边与截图范围。新增维护工具图本轮只更新本地正典，尚未同步FigJam；旧派生结果不证明新图通过。

[局部规则](./AGENTS.md) · [绘图标准](./maps/00-agentic-diagram-standard.md)。

本轮维护入口：[测试捕获与回执](./maps/17-artifacts-and-contracts/test-capture-and-receipts.md)；16项聚焦、22项历史材料隔离重放、2 worker完整门1314项及双宿主smoke通过；首轮4 worker失败/中断保留。图谱110张图及独立检查通过。

本轮重点：[只读故障包与独立分享](./maps/17-artifacts-and-contracts/diagnostic-bundles.md)。记录了宿主错配与权限夹具假设的修正，以及成功摘要缺少调用证据的一致性反例。
