# ADR-0003 宿主效果层归属：TS 内建还是交给 agent

> 状态：`accepted`
> 提出日期：2026-09-03
> 裁决日期：2026-09-03，首次裁决采用选项 A；同日经用户澄清边界后修订为选项 D，见文末"修订"
> 回写：plan §3 TSD-12 按选项 D 改写；§8.1 派发能力进入 L1 与 L2；§14 第 13 项改写；未决问题列入 §8.1 P0 待核实事项。不建 foundation 进程端口，不改 `.dependency-cruiser.cjs` 进程规则
> 基线提交：`c0098e2`
> 相关：[reviews/2026-09-03 评估 A3 与 §5](../reviews/2026-09-03-typescript-checkpoint-review.md)、[progress/consolidation-gate-log.md §13.2 host-effect execution seam](../progress/consolidation-gate-log.md)、`.dependency-cruiser.cjs` 规则 `domain-process-effects-use-foundation`

## 背景

旧 Claude Code 宿主拥有 tmux transport 1,244 行、activity 2,627 行、locator 2,030 行、lifecycle 1,101 行、settings 2,662 行、keep-live 1,770 行、23 个子命令的宿主 CLI，以及 Pod 宿主门面。旧 Codex 宿主有 Pod 门面、activation scope、decommission 与 migration effect。度量方式：`wc -l plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-*.mjs`。

TypeScript 的 `src/hosts/` 有 11 个文件 2,130 行。Codex 与 Claude Code 的 profile 各为 8 个布尔或记录开关，`compileWakeflowHostCapabilityLayoutAuthority` 把它们编译成最多 9 个空目录声明。Claude Code 另有 settings 写入，只维护 `permissions.allow` 的 3 条字面量。`src/` 中唯一的 `node:child_process` 引用在 `foundation/git/git-ignore-observation.ts`，架构规则禁止领域层新增进程效果，foundation 没有进程或 PTY 端口。

新体系的 `claim_target_host_effect`、`record_target_host_effect_outcome`、`rearm_target_host_effect` 三步握手把执行完全交给 agent。门禁日志 §13.2 把这条缝称为"有意的 agent seam"。旧体系在这条缝上做的事是：信封摘要复核、tmux paste、回读证据、`transport-recover` 子命令、活动观察、窗口生命周期与 locator 互斥。

## 问题

宿主效果层是产品的一部分还是 agent 的自由。不裁决，P3 阶段无法确定范围，E3 无法判断"派发"场景是否等价。

## 选项

### 选项 A：TS 内建完整宿主效果层

在 foundation 增加一个封闭的进程与 PTY 端口，提供 spawn、tmux 命令、输出观察，带超时与脱敏。在 `hosts/claude-code` 实现 transport、lifecycle、locator、activity、keep-live、完整 settings 与 statusline；在 `hosts/codex` 实现 thread 工具门面与 activation scope。宿主 CLI 作为新的 entrypoints。代价：约 3 到 4 周；foundation 需要新增一个能力目录，这与"禁止无 consumer 扩张"不冲突，因为 consumer 是 hosts。

### 选项 B：完全交给 agent，保持当前 seam

宿主效果由 agent 用自己的工具执行，Wakeflow 只记录 claim 与 outcome。代价：放弃旧体系在投递上的确定性校验；活动观察、keep-live、窗口生命周期不再是产品能力；E3 对比时这些旧场景只能记为"放弃"。

### 选项 C：最小内建，分两步

第一步只内建投递与回读校验，即 Claude tmux paste 加信封摘要复核加回读证据，以及 Codex 的 thread 投递门面。第二步再决定 activity、keep-live、lifecycle 是否内建。代价：两次决策；但第一步就能让"派发一次真实任务"场景闭合。

## 建议

选项 A，按选项 C 的顺序分步实施。理由：旧场景中用户获得价值的地方正是决策链两端的宿主效果，交给 agent 意味着这些场景没有确定性证据；先做投递与回读能让对照工具尽早覆盖派发场景。

## 后果

接受后需要修改：

- foundation 新增进程与 PTY 端口目录，并在 [standards/resource-handling-standard.md](../standards/resource-handling-standard.md) 或新标准中定义进程效果的准入、超时、脱敏与证据合同。
- `.dependency-cruiser.cjs` 增加规则：只有 `src/hosts/` 与该 foundation 端口可以使用进程能力；领域层仍禁止。
- 开发计划 §13 阶段表增加 P3 宿主效果层的范围与退出门。
- 能力映射矩阵中"派发"、"活动观察"、"keep-live"、"窗口生命周期"行的 TS owner 由"缺席"改为对应模块。

## 未决问题

- Agent 交回的回读证据形状在 Codex 与 Claude 两宿主是否统一。
- 无真实宿主会话时，L2 场景验收如何标注未执行而不阻塞门。

## 修订（2026-09-03）

用户澄清职责边界：开线程、线程投递、开 worktree、创建窗口等宿主写效果由 Agent 执行；Wakeflow 保证内容提供与准确性验证。核对事实支持这一边界：旧 Codex 版 `fleet.transport = agent-tools`，没有 send adapter，Agent 用原生 thread 工具投递，Wakeflow 记录 `envelopeDigest` 并允许恰好一次有界回读观察；旧 Claude 版的 tmux paste 由 Controller Agent 通过 Bash 触发宿主 CLI 执行；当前 TS 的 claim 签发 `send-message-to-observed-target-window` 动作，outcome 只接受 Agent 交回的 attempt 与回读证据，Claude settings 只放行 `Bash(tmux *)` 等三条。

据此把接受的方案从选项 A 改为**选项 D：Agent 执行，Wakeflow 内容与验证**：

1. Wakeflow 提供精确内容与每宿主的动作说明：Codex 为 thread 消息，Claude Code 为 tmux 粘贴文本；准入 Agent 交回的 attempt 证据与一次回读证据；验证摘要、绑定与状态转换。
2. 不内建 transport 执行器；foundation 不增加进程或 PTY 端口；领域层的进程效果禁令保持不变。
3. 只读观察，包括活动观察、窗口 fleet 状态、回读抓取，同样由 Agent 观察并交回证据，Wakeflow 只做证据准入与一致性校验。
4. 不重建执行型宿主 CLI，操作步骤写入 skills；只保留只读诊断入口，与 ADR-0006 的 verify 合并。
5. keep-live 与 unattended 原为代码后台轮询 tmux，先放弃，业务场景层再议。
6. 宿主差异落在三处：内容形状、证据形状、指令文件与 skills 文本；它们是 L1 每个切片的 Codex 与 Claude 两列。

选项 A 中的 foundation 进程端口与 hosts 内建 transport 不再执行。
