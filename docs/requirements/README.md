# 需求锚点索引

> 状态：`active`
> 建立日期：2026-09-03
> 上位文档：[docs/README.md](../README.md)

需求锚点是产品能力的原始依据。开发计划、决策记录和进度日志引用锚点编号，例如 D1 到 D41 或 I3，而不重复其内容。本索引列出现行需求文档，以及已归档但仍被引用的锚点文档。

## 1. 现行需求

| 文档 | 范围 | 状态 |
| --- | --- | --- |
| [wakeflow-functions-and-scenarios.md](./wakeflow-functions-and-scenarios.md) | 自顶向下的功能与场景总览：定位、核心对象、主流程、F1 到 F11、宿主差异、明确不做、理解核对清单 | `draft`，待确认 |
| [capabilities/](./capabilities/) | 能力卡第 1 到 10 组，逐项确认记录 | `confirmed` |
| [typescript-dual-artifact-build.md](./typescript-dual-artifact-build.md) | 单一 TypeScript 源码、双宿主生成制品、轻量测试；十项已确认方向与目标结构词汇 | `requirement-confirmed` |

## 2. 归档中仍被引用的锚点

这些文档描述的是 JavaScript v3 时期的实现，但其中的需求裁定仍是 TypeScript 重构必须证明等价的依据。它们保留在 `archive/`，只作证据，不再修改。

| 文档 | 锚点 | 引用它的现行文档 |
| --- | --- | --- |
| [archive/wakeflow-initialization-generated-files-requirement-2026-08-05.md](../archive/wakeflow-initialization-generated-files-requirement-2026-08-05.md) | D1 到 D41 初始化生成物、目录归属、tracked 与 ignored 边界 | [plan §9 E3 对比矩阵](../plan/typescript-reimplementation-plan.md)、[typescript-dual-artifact-build.md](./typescript-dual-artifact-build.md) |
| [archive/wakeflow-initialization-v3-development-plan-2026-08-06.md](../archive/wakeflow-initialization-v3-development-plan-2026-08-06.md) | M1A 到 M7A 的实现与验收记录，I4 deferred | [typescript-dual-artifact-build.md](./typescript-dual-artifact-build.md) |
| [archive/wakeflow-host-managed-complete-pod-requirement-design-2026-07-31.md](../archive/wakeflow-host-managed-complete-pod-requirement-design-2026-07-31.md) | Pod 状态、宿主归属、验收权威 | [ADR-0006](../decisions/0006-legacy-capability-retention.md) |
| [archive/wakeflow-local-information-authority-refactor-requirement-2026-08-04.md](../archive/wakeflow-local-information-authority-refactor-requirement-2026-08-04.md) | 本地信息归属、配置、状态与运行时权威 | [standards/resource-handling-standard.md](../standards/resource-handling-standard.md) 的历史来源 |
| [archive/wakeflow-foundation-services-requirement-2026-08-11.md](../archive/wakeflow-foundation-services-requirement-2026-08-11.md) | BFS-01 到 BFS-11 候选登记、G0 审阅结论、中文注释标准 | [plan §13 E1 行](../plan/typescript-reimplementation-plan.md)；候选登记已被开发计划重新映射 |

## 3. 引用规则

- 引用锚点时写编号加文档链接，例如"D17，见 archive 初始化需求"。
- 锚点的裁定发生变化时，不修改归档文档，而是写一份新的 ADR 记录变化，并在本索引的对应行加注。
- 新需求文档放在本目录，头部按 [standards/documentation-standard.md](../standards/documentation-standard.md) 编写。

## 4. 平台与版本边界

- 不支持 Windows。运行时依赖 POSIX 的 `O_NOFOLLOW`、`O_DIRECTORY` 与 euid，制品与 README 明确声明。（能力卡 1 Q8）
- 新 TS 是全新版本序列，配置 schema 从 v1 起版，不识别、不迁移、不兼容任何历史版本的布局或配置；TS 之前的工作区一律重新初始化。（[ADR-0008](../decisions/0008-discard-legacy-and-new-version-series.md)）
