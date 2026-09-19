# ADR-0002 公共工具面：31 名称兼容还是重切后的新面

> 状态：`accepted`
> 提出日期：2026-09-03
> 裁决日期：2026-09-03，用户确认采用建议方案（选项 B）
> 回写：plan §3 TSD-03 修订；§7、§9、§10、§14 的 31-tool 对比面改为能力映射矩阵；能力映射矩阵列入 §8.1 P0
> 基线提交：`c0098e2`
> 相关：[plan §3 TSD-03](../plan/typescript-reimplementation-plan.md)、[plan §9 E3 对比矩阵](../plan/typescript-reimplementation-plan.md)、[progress/consolidation-gate-log.md §13.31 到 §13.32](../progress/consolidation-gate-log.md)、[reviews/2026-09-03 评估 A1](../reviews/2026-09-03-typescript-checkpoint-review.md)

## 背景

开发计划约束 TSD-03 写明"当前完整 v3 是行为基线，不借 TS 修改 authority 或 31-tool 公共面"，E3 对比矩阵要求"31-tool 名称、输入 envelope、输出与稳定错误保持兼容"。核实门日志 §13.31 到 §13.32 则按单一 owner 把旧工具重切为新工具集，并把旧 31 工具分为已公开、内部、未实现三类。

在 `c0098e2` 节点，TypeScript 公共 MCP 注册 23 个工具，与旧 31 个同名的只有 `wakeflow_maintain_workspace`、`wakeflow_create_demand`、`wakeflow_record_evidence`、`wakeflow_complete_demand` 四个。度量方式：对比旧 `core/lib/wakeflow-mcp-tools.mjs` 的 `PUBLIC_TOOL_ORDER` 与新 `src/entrypoints/wakeflow-public-mcp-*-tools.ts` 的注册名。

重切后的形状差异不只是名字：旧 `add_task` 拆为 `plan_target_task` 与 `plan_test_card`；旧 `record_delivery` 变为 claim、outcome、rearm 三步握手；旧 `review_pack` 与 `decide_review` 变为 inspect 加两个决策工具；旧 `next_work` 与 `status` 由 `inspect_demand_route` 的责任前沿投影替代。

## 问题

E3 对比面到底是"31 个名字与信封兼容"，还是"31 个能力在新面上有等价 owner"。不裁决，E3 无法定义通过标准，P0 的能力映射矩阵也无法确定列。

## 选项

### 选项 A：保持 31 名称与信封兼容

在新体系之上增加一层兼容适配，把旧信封 `{root, demandId?, operation, request}` 映射到新工具。代价：旧信封的 action switch 形状会回到新体系；两套公共面同时存在；旧工具中已被有意放弃的 `recover_state_transition` 与 `view` 也要有替代行为。

### 选项 B：废止 TSD-03 的公共面条款，以能力等价映射表替代名称兼容

修改 TSD-03 为"当前完整 v3 是行为基线，authority 语义不变；公共工具面允许按单一 owner 重切，等价性由能力映射矩阵证明"。E3 对比面改为"31 个旧能力在映射矩阵中每一行都有新 owner 或明确放弃记录"。代价：安装了旧插件并依赖旧工具名的会话在切换后需要重新学习工具；skills 与 commands 文本需要随新面重写。

### 选项 C：双面并存到 E4

新面为主，旧名作为别名注册指向同一 executor。代价：tools/list 体积进一步膨胀，见 [ADR-0004](./0004-mcp-tool-catalog-size.md)；别名无法表达形状差异，只能覆盖 4 个同名工具。

## 建议

选项 B。理由：重切已经在门禁日志中按 owner 边界完成并有 1,023 项测试支撑；旧信封的 operation switch 是旧体系被批评的集中式热点；tools/list 体积已经是问题，不能再加别名。名称兼容对使用者的价值低于工具语义清晰。

## 后果

接受后需要修改：

- [plan §3](../plan/typescript-reimplementation-plan.md) TSD-03 行改写；§9 E3 对比矩阵"公共工具面"行改为能力映射矩阵通过标准；§14 完成定义第 4 与第 9 项中的"31-tool"改为"能力映射矩阵"。
- P0 阶段建立 `docs/references/` 下的能力映射矩阵：31 个旧工具、D1 到 D41 需求锚点，到 23 个新工具与内部 owner 的映射，每行标注重切、缺席、放弃。
- skills 与 commands 文本在 L2 按新面重写，并带一道诚实性门（正向白名单、20 个工具的反向覆盖、退役词汇黑名单、技能路径闭合、命令闭合，见 gate-log §13.99 D4）；E4 只删旧树。

## 未决问题

- 是否需要在切换后的插件 README 中提供一张"旧工具名到新工具"的迁移对照，供已有用户过渡。
