# ADR-0001 开发文档系统与权威顺序

> 状态：`accepted`
> 提出日期：2026-09-03
> 裁决日期：2026-09-03，用户要求整理文档系统并新建开发文档体系
> 基线提交：`c0098e2`
> 相关：[docs/README.md](../README.md)、[standards/documentation-standard.md](../standards/documentation-standard.md)

## 背景

在 `c0098e2` 节点，`docs/` 目录平铺 22 份文档，跨越 2026 年 6 月到 9 月的三个时期：JavaScript v3 开发期、基础服务审阅期、TypeScript 重构期。其中三份文档对"当前阶段与下一步"给出不同答案：

- [开发计划](../plan/typescript-reimplementation-plan.md) 以 31 工具为 E3 对比面，约束 TSD-03 要求不修改 31 工具公共面。
- 基础服务需求文档（现归档）的 11 个 BFS 候选仍标为 `g1-pending`，并规定确认前不得创建代码骨架，而 TypeScript foundation 已经实现了其中五个。
- 核实门日志 §13.32 写 19 个工具，代码在该节点已注册 23 个。

同时，2026-09-03 的节点评估指出，文档漂移使得"下一步该做什么"无法从文档中直接读出。

## 问题

需要一个明确的权威顺序和目录职责，使任何维护者能在一分钟内找到现行约束、已做决定和最新进度，并且知道哪些文档只是历史证据。

## 决定

1. 建立 `docs/README.md` 作为文档系统入口，定义九级权威顺序：代码与 Schema、仓库维护规则、开发计划、决策记录、需求锚点与标准、进度日志、评估与建议、参考与证据、历史归档。
2. 按职责分目录：`plan/`、`decisions/`、`requirements/`、`standards/`、`progress/`、`reviews/`、`references/`、`archive/`。目录表达类型，文件名表达主题。
3. 现行的六份 TypeScript 时期文档迁入对应目录并改为主题命名，正文头部记录原路径。
4. 十六份已完成或已被取代的文档移入 `archive/`，保留原文件名和正文，由 `archive/README.md` 登记角色、日期、取代关系和是否仍被引用。
5. 新增 `decisions/` 与 ADR 模板；影响约束、合同、层边界或旧能力取舍的决定先写 `proposed`，用户确认后 `accepted` 并回写开发计划。
6. 新增 `standards/documentation-standard.md` 规定头部、语言、证据、链接和归档写法。
7. 根目录 `CLAUDE.md` 与 `AGENTS.md` 中"`docs/` 下的历史计划只是证据"一句改为指向 `docs/README.md` 的权威顺序与 `docs/archive/` 的证据定位。
8. 开发计划保持唯一的阶段与约束权威；核实门日志保持进度记录职责，不再在其中做决策；基础服务需求文档标记为已被开发计划取代并归档。

## 后果

- 更新了指向被移动文档的外部引用：根 `README.md` 与 `README.zh-CN.md` 两处、`core/skills/wakeflow-governance/references/design-test-skill-realization-source-map.md` 一处并同步到两个插件、图谱子项目 `review-evidence.md` 的刷新触发器一处。
- 归档文档之间的相对链接保持有效；归档文档指向现行文档的链接已改写。
- 后续每个核实节点在 `progress/` 追加，每个待裁决事项在 `decisions/` 建档。ADR-0002 到 ADR-0006 是本节点评估提出的六项待裁决决定。
- 本决定不改变任何运行时行为、Schema、测试或插件制品内容。

## 未决问题

- `wakeflow-architecture-atlas/` 保持独立子项目还是并入 `docs/`，待图谱维护者决定；本决定不移动它。
