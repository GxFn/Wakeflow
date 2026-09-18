# 架构决策记录索引

> 状态：`active`
> 建立日期：2026-09-03
> 上位文档：[docs/README.md](../README.md)

每个影响阶段边界、已确认约束、公共合同形状、层边界或旧能力取舍的决定，都在本目录留一份编号记录。记录的目的不是审批流程，而是让后来的维护者能回答"为什么是这样"。

## 1. 流程

1. 起草者按 [0000-template.md](./0000-template.md) 新建 `NNNN-主题.md`，状态 `proposed`，写明背景、选项、建议和后果。
2. 用户裁决后，状态改为 `accepted` 或 `rejected`，记录裁决日期。`accepted` 的决定回写到开发计划的约束表或阶段表，并在相关标准中落地。
3. 决定被新决定取代时，旧记录状态改为 `superseded`，头部指向新记录；不删除旧记录。
4. 进度日志只引用 ADR 编号，不重复其内容。

## 2. 状态词汇

| 状态 | 含义 |
| --- | --- |
| `proposed` | 已成文，等待用户裁决 |
| `accepted` | 用户已确认，进入执行 |
| `rejected` | 用户否决，保留理由 |
| `superseded` | 已被后续记录取代 |

## 3. 索引

| 编号 | 主题 | 状态 | 日期 | 影响 |
| --- | --- | --- | --- | --- |
| [0001](./0001-documentation-system.md) | 开发文档系统与权威顺序 | `accepted` | 2026-09-03 | `docs/` 结构、`CLAUDE.md` 与 `AGENTS.md` 的文档条款 |
| [0002](./0002-public-tool-surface.md) | 公共工具面：31 名称兼容还是重切后的新面 | `accepted` | 2026-09-03 | 计划约束 TSD-03 修订、E3 对比面改为能力映射矩阵 |
| [0003](./0003-host-effect-layer-ownership.md) | 宿主效果层归属：TS 内建还是交给 agent | `accepted`，同日修订为选项 D | 2026-09-03 | TSD-12：Agent 执行宿主写效果，Wakeflow 内建内容与验证；不建进程端口 |
| [0004](./0004-mcp-tool-catalog-size.md) | MCP 工具目录体积策略 | `accepted` | 2026-09-03 | 新增 TSD-13；Schema 组织、apply 请求形状、codegen 在 P1 落地 |
| [0005](./0005-demand-event-stream-read-path.md) | Demand 事件流读路径与快照策略 | `accepted` | 2026-09-03 | 新增 TSD-14；事件溯源仓储、authority context 在 P2 落地 |
| [0006](./0006-legacy-capability-retention.md) | 旧能力取舍：Pod、legacy 迁移、view、verify、窗口替换与租约 | `accepted` | 2026-09-03 | 新增 TSD-15；E3 对比范围与 L1 工作量 |
| [0007](./0007-rebuild-mandate-and-bottom-up-flow.md) | 架构重建授权、Agent 与 Wakeflow 职责边界、自底向上流程、债务删除守门、测试轻量 | `accepted` | 2026-09-03 | ADR-0003 修订；plan §8.1 分层、§11、§12 |
| [0008](./0008-discard-legacy-and-new-version-series.md) | 丢弃历史版本、新版本序列、E3 改为能力覆盖与场景验收、旧门退出 `npm test`、配置从 v1 起版 | `accepted` | 2026-09-03 | TSD-03 与 TSD-11 改写，新增 TSD-16；plan §9 整节；`package.json` 与 `CLAUDE.md`、`AGENTS.md` 验证条款 |
| [0009](./0009-execution-endpoint-and-host-effect-handshake.md) | 执行端点与宿主效果握手的统一模型：Wakeflow 定位、窗口管理三层拆分、工作声明与围栏令牌、宿主 hook 证据通道 | `accepted`，两处调整于同日确认 | 2026-09-04 | L1 切片顺序；宿主 profile 增加证据策略与 hook 声明；信封与结果 schema 增加围栏令牌；E4 产物新增 hooks |
| [0010](./0010-worktree-isolated-execution-and-converged-flow.md) | Pod 隔离执行与流程收敛：main 是 `primary` 的 pod、一 pod 一时一 Demand、worktree 归产品窗口并由宿主原生能力创建、合并在 Wakeflow 之外、只有 main 开关 pod、一条直线的流程 | `accepted`，首版任务粒度的 D1 到 D3 被用户的 pod 模型取代；未决三项于 2026-09-18 关闭（gate-log §13.92 D6、§13.94 D2） | 2026-09-04 | 配置 `pods[]`、Demand 身份 `podId`、窗口绑定、投递目标、结果 schema、状态投影、TSD-15、L1 切片 |
| [0011](./0011-requirement-package-as-single-handoff.md) | 需求包作为唯一交接物：取消确认记录与 TODO 摄入、两份文档加必需章节、两个确认点、一个总控一次一个 Demand、同窗口多任务沿用任务包 | `accepted` | 2026-09-04 | 能力卡 3、4、5；`publish_confirmation` 与 `intake_todo` 删除；能力映射矩阵；场景 `card-04` 重塑 |
| [0012](./0012-flow-convergence-callback-calls-testing-redesign.md) | 流程收敛：回传固定效果、三种调用形状、完成即归档、测试记录对比与失败分类、删除 redesign 改为 escalate | `accepted` | 2026-09-04 | 能力卡 4、5、6、7；能力映射矩阵；总览 F5 到 F9（已回写） |
| [0013](./0013-target-architecture-and-slice-plan.md) | 目标架构六层、切片解剖、三种调用形状的内核实现、单一错误模型、foundation 收敛、20 个公共工具、L1 切片顺序 | `accepted` | 2026-09-04 | 计划 §8.1 L0 与 L1、§11；能力映射矩阵 §1.1 新工具清单；dependency-cruiser 规则 |

## 4. 已在其他文档中确认、尚未转为 ADR 的决定

以下决定在建立本目录之前已经由用户确认并写入现行文档。它们继续以原文档为权威，不补写 ADR；后续若被修改，再以新 ADR 记录。

| 决定 | 权威位置 |
| --- | --- |
| TSD-01 到 TSD-11 开发约束 | [plan/typescript-reimplementation-plan.md §3](../plan/typescript-reimplementation-plan.md) |
| 资源处理归一标准 RH-1 到 RH-6 | [standards/resource-handling-standard.md](../standards/resource-handling-standard.md) |
| Demand 是唯一的事件溯源聚合；不保留 JSONL、双 authority、stream lock | [plan §13 E2 行](../plan/typescript-reimplementation-plan.md) 与 [progress/consolidation-gate-log.md §13](../progress/consolidation-gate-log.md) |
| 独占锁不自动打破失效锁，残留由 owner 显式退休 | `src/foundation/filesystem/rooted-exclusive-file-lock.ts` 头注释 |
| foundation 禁止无 consumer 横向扩张 | [progress/consolidation-gate-log.md §6、§13.4](../progress/consolidation-gate-log.md) |
| 公共入口按四组拆分，保留单一组合根 | [progress/consolidation-gate-log.md §13.64](../progress/consolidation-gate-log.md) |
