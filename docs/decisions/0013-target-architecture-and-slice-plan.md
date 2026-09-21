# ADR-0013 目标架构、切片解剖与 L1 切片顺序

> 状态：`accepted`
> 裁决日期：2026-09-04，用户按建议接受 A 到 G
> 提出日期：2026-09-04
> 基线提交：`c0098e2`
> 分析：[reviews/2026-09-04-architecture-and-slice-design.md](../reviews/2026-09-04-architecture-and-slice-design.md)
> 相关：[ADR-0004](./0004-mcp-tool-catalog-size.md)、[ADR-0005](./0005-demand-event-stream-read-path.md)、[ADR-0007](./0007-rebuild-mandate-and-bottom-up-flow.md)、[ADR-0009](./0009-execution-endpoint-and-host-effect-handshake.md)、[ADR-0012](./0012-flow-convergence-callback-calls-testing-redesign.md)

## 背景

P0 结束，能力卡与总览已确认。进入 L0 与 L1 前需要固定代码形状，否则每个切片会重复节点评估里的样板密度。

## 决定

- A 六层：foundation、contracts、kernel、capabilities、hosts、entrypoints；依赖只向下；切片互不引用；dependency-cruiser 规则改为六条方向规则加一条切片隔离。
- B 切片解剖固定：contract、decide、service、projection、tool、decide.test、scenario.test；Demand 单聚合，事件与前沿词汇表在 contracts 作为数据表，never 守卫。
- C 三种调用形状由内核各一份实现：读、`AppendCommand`（幂等键加 CAS 加 `next`）、`PublicationTransaction`（preview、apply、recover）；22 个协调器删除。
- D 一个错误类型 `WakeflowError{code, reason, path, retryable, details?}` 加封闭错误码表；301 个错误类删除。`details` 是可选的少量短标识（键 camelCase 不超过 32 字符，值限于 `[A-Za-z0-9_.:-]` 不超过 128 字符，至多 8 项），用于恢复所需的 operationId 一类句柄，写不进路径与自由文本（2026-09-04 用户选定，见进度日志 13.72）。
- E foundation 收敛到 14 个原语；kernel 新建 13 个模块（清单见分析第 3 节）。
- F 公共工具 20 个（清单见分析第 4 节）：现有 23 个删 8、改名 4、新增 5。
- G L1 切片顺序：workspace、endpoint、requirement、demand、tasking、delivery、result-review、evidence、pod、observation；每片退出门为 decide 测试加一条场景验收通过并删除被替代物。

## 后果

- 计划 §8.1：L0 行的对象与退出门按分析第 3.3 节改写；L1 行改为十个切片的顺序与退出门；§11 测试规则按分析第 6 节。
- 能力映射矩阵：新工具列按 16 个工具重写。
- 现有 TS：保留 foundation 持久化语义、事件溯源提交批与 CAS、配置 codec、ledger 摘要链、隐私规则集；其余按切片逐个删除重写。

## 未决问题

两项已由实现固定（2026-09-20 记录，gate-log §13.101 F8）：`kernel/` 与 `capabilities/` 是新目录，`governance/`、`workspace/`、`configuration/` 保留为既有领域的目录，六层方向由架构门强制；幂等由追加命令的请求键与既有事件流承担，没有独立的 `idempotency-store`。
