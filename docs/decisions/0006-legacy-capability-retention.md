# ADR-0006 旧能力取舍：Pod、legacy 迁移、view、verify、窗口替换与租约

> 状态：`accepted`
> 提出日期：2026-09-03
> 裁决日期：2026-09-03，用户确认采用"选项与建议"表中的建议列；legacy 迁移的保留或放弃以 P0 核实结果为准
> 回写：plan §3 新增 TSD-15；§8.1 P4 范围；§9 状态与 authority 行；§14 第 4 项按放弃项做减法；legacy 工作区存在性列入 §8.1 P0 待核实事项。旧代码删除留在 E4
> 基线提交：`c0098e2`
> 相关：[reviews/2026-09-03 评估 §5](../reviews/2026-09-03-typescript-checkpoint-review.md)、[references/legacy-js-scenario-closure-audit.md](../references/legacy-js-scenario-closure-audit.md)、[archive/wakeflow-host-managed-complete-pod-requirement-design-2026-07-31.md](../archive/wakeflow-host-managed-complete-pod-requirement-design-2026-07-31.md)

## 背景

旧 JavaScript 体系中有一批能力在 TypeScript 中没有对应实现，也没有明确的放弃记录。它们的规模与现状如下，行数以旧 `core/scripts/lib/` 与插件宿主库的 `wc -l` 为口径：

| 能力 | 旧规模 | TS 现状 |
| --- | --- | --- |
| Pod 多需求并行：`pod_open`、`pod_bind`、`pod_plan`、`pod_record`，双宿主 Pod 门面 | 服务约 7,000 行，门面约 830 行 | 两处注释提到，无类型无字段 |
| legacy 到 v3 迁移：`wakeflow-bootstrap.mjs` 与 migration 系列 | bootstrap 927 行，migration 系列数千行 | 无 |
| `view` 四个读模型：config、storage、verification、result-trace | 归属 observability | 门禁日志已记为有意放弃 |
| `verify` 只读校验 | 归属 observability | 内部存在校验逻辑，无公共入口 |
| `replace_windows`、`release_window_lock`、窗口租约 2 小时 | window-lease 系列 | 只有 `register_window_binding` |
| `continue_demand`、`cancel_demand` | demand lifecycle | cancel 的命令、事件、转换全部实现但无调用方；continue 无 |
| research 需求完成、实现重设计 | demand lifecycle | Controller Route 返回 `not-implemented` blocker |
| archive、storage_preserve、prune_runtime | business-archive、preservation、transport-retention | 只有 TODO 条目归档；artifact 传输 foundation 冻结待用 |

开发计划 §14 完成定义第 4 项要求 D1 到 D41 全部通过对比，其中包含 Pod 与迁移相关条目。

## 问题

每一项是保留、简化还是放弃。不裁决，E3 对比范围与 P4 工作量都无法估算。

## 选项与建议

| 能力 | 选项 | 建议 |
| --- | --- | --- |
| Pod | 保留完整；简化为"隔离执行位置"授权；放弃 | 简化。Demand identity 已有 `executionPlacement.mode: isolated` 与授权引用，先让隔离位置由 Confirmation 授权落地，不重建 7,000 行 Pod 服务；完整 Pod 在有真实需求时再议 |
| legacy 迁移 | 保留；放弃 | 放弃。2026-09-03 用户确认丢弃全部历史版本（[ADR-0008](./0008-discard-legacy-and-new-version-series.md)）：不识别、不迁移，初始化遇到任何 Wakeflow 标记只拒绝并列出；E4 删除迁移模块、分类目录与语料 |
| view | 放弃 | 维持门禁日志的放弃决定，理由是通用读取违反脱敏边界 |
| verify | 保留为公共只读入口 | 新增一个只读校验工具，复用现有 inspection 与 recovery 观察，不引入通用读模型 |
| 窗口替换与租约 | 保留 | 与宿主效果层一起在 P3 实现，见 [ADR-0003](./0003-host-effect-layer-ownership.md) |
| continue 与 cancel | 保留 | cancel 接到 service 与工具；continue 按 authority supplement 实现 |
| research 完成、实现重设计 | 保留 | 已有 blocker，按 route 前沿实现 owner |
| archive、preserve、prune | 保留 | 消费冻结的 artifact 传输 foundation；Demand 完成后封流归档，见 [ADR-0005](./0005-demand-event-stream-read-path.md) |

## 后果

接受后需要修改：

- 能力映射矩阵中对应行的判断由"待决"改为"保留"或"放弃"，放弃项写明理由。
- 开发计划 §14 完成定义第 4 项中的 D 编号按放弃项做减法并记录。
- 放弃项对应的旧代码在 E4 删除；在此之前保持不动，作为对照证据。
- Pod 简化方案需要一份新的需求锚点文档，说明隔离执行位置的授权、目录与恢复语义。

## 未决问题

- 简化后的隔离执行位置是否需要独立的 evidence 根，还是复用 Demand 根。

已结项：legacy 工作区存在性不再需要核实，用户于 2026-09-03 决定丢弃全部历史版本，见 ADR-0008。
