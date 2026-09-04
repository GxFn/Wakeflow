# ADR-0004 MCP 工具目录体积策略

> 状态：`accepted`
> 提出日期：2026-09-03
> 裁决日期：2026-09-03，用户确认采用建议方案（选项 A，目标总载荷低于 60 KB）
> 回写：plan §3 新增 TSD-13；§8.1 P1 退出门；§9 Schema 行；§14 新增第 14 项；plan 落盘保留与清理 owner 列入 §8.1 P0 待核实事项。codegen、Schema 与协调器改动在 P1 执行
> 基线提交：`c0098e2`
> 落地记录：2026-09-04 L0.5 落地第 1 项（结果 Schema 不进 `tools/list`）与第 3 项（描述压到两句），第 2 项在 `wakeflow_maintain_workspace` 以"同一请求加 `planDigest`、服务端重算"落地；`tools/list` 从 319,252 字节降到 119,825 字节，剩余体积在请求 Schema，60 KB 目标待 L1 各切片收敛合同后复测（进度日志 13.73）
> 相关：[reviews/2026-09-03 评估 A2](../reviews/2026-09-03-typescript-checkpoint-review.md)、[plan §3 TSD-05](../plan/typescript-reimplementation-plan.md)、`src/contracts/schemas/entrypoints/`、`tooling/codegen/schema-types.ts`

## 背景

对编译后的 Codex 组合根发送 `tools/list`，响应为 329,652 字节，约 94,000 token；旧 JS 的 31 个工具为 39,782 字节，约 11,000 token。度量方式：对 `.build/src/entrypoints/codex-wakeflow-mcp.js` 走原始 stdio JSON-RPC，按 3.5 字节每 token 折算。

单个工具定义最大 30,678 字节（`wakeflow_plan_test_card`），最小 4,558 字节（`wakeflow_register_window_binding`）。原因有三：每份 request 与 result schema 都把 215 个跨文件 `$ref` 内联成自包含 `$defs`；apply 请求携带完整 plan 对象，实例嵌套深度 5 到 8 层；description 长度 245 到 901 字符。

外部参照：Microsoft Research 的工具空间干扰研究指出超过 20 个工具时性能显著下降，扁平化参数使准确率提升 47%；Anthropic 的工具设计指南建议少量面向工作流的工具与可控的响应长度；MCP 2025-11-25 规范要求 inputSchema 必须有效，outputSchema 是可选项。Codex 目前没有延迟加载工具定义的机制。

## 问题

在保持 JSON Schema 为 wire 权威（TSD-05）的前提下，如何把 tools/list 压回旧版量级。

## 选项

### 选项 A：三项并行

1. outputSchema 去内联：共享 `$defs` 只在服务端校验时使用，tools/list 中的 outputSchema 只保留顶层结构或省略。
2. apply 请求改为 `planRef` 加 `planDigest`：preview 把 plan 写入 Demand 根下的 transaction 目录，apply 只提交引用与摘要，服务端重取并重新推导。
3. description 压缩到一句工作流描述，边界说明移到 server instructions 或 skills。

### 选项 B：分组与按需暴露

按 Workspace、Authority、Execution、Review 四组提供四个 MCP server 入口，或提供一个 catalog 工具按需返回定义。代价：宿主配置复杂化；Codex 与 Claude Code 的插件 manifest 各需多个 server 条目。

### 选项 C：只压 description 与 outputSchema，保留整 plan 的 apply

代价最小，但 apply 请求仍保留深层嵌套，输入侧体积只降一半左右。

## 建议

选项 A。目标是总载荷低于 60 KB。`planRef` 加摘要与现有"摘要不是授权令牌，apply 重新推导"的纪律一致，并把 preview 产物变成可恢复的 transaction artifact，这与资源处理标准的 RH-5 相符。

## 后果

接受后需要修改：

- `tooling/codegen/schema-types.ts` 增加"公开投影"输出：为 tools/list 生成精简 schema，保留完整 schema 用于服务端校验；`tests/codegen/mcp-wire-schema-self-contained.test.ts` 相应调整断言。
- 每个 apply 请求 schema 的 `applyRequest` 分支改为 `planRef` 与 `planDigest`；对应 coordinator 增加 plan 重取与摘要复核。
- `wakeflow-public-mcp-*-tools.ts` 的 description 重写；catalog 测试增加总字节上限断言。
- 开发计划 §8 或新标准中记录公共工具定义的体积预算。

## 未决问题

- Claude Code 已支持延迟加载工具定义，是否仍需为其做同样压缩。建议做，因为两宿主同 schema 是当前的核实事实。
- plan 落盘后的保留与清理策略由谁拥有。
