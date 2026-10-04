# 验证来源：独立探针、开发门记录与原生候选边界

2026-10-03，最终来源版本输入为 **1.1.0-rc.5 候选**。目录保留起始 `rc.4` 名称；[最终源码/测试快照](./source-baseline-final.json)与[执行证据库存](./execution-evidence-inventory.json)分开保存。以下结论以当前源码摘要、持久日志、实际探针输出和候选 manifest 字节为依据，不把其他线程的完成总结当成本线程独立运行。

## 本线程独立执行的范围

| 验证 | 已观察结果 | 范围 |
| --- | --- | --- |
| [隐私与证据后态探针](./privacy-evidence-probe-after-fix.json) | 15 组词法样例；64 项诊断饱和仍隐藏有隐私的摘要；可解码控制文本继续检查凭证 | 当前模块内存转译与一次性合成 fixture；不是登录宿主或整个需求生命周期 |
| [回调后态探针](./callback-probes-after-fix.json) | SHA-1/SHA-256 身份保真；引用边界、静默阈值、acknowledged 与 landing 分离 | 纯函数、记录构造与渲染；没有运行公共 import/inspect I/O 或发送宿主消息 |
| [并发后态探针](./concurrency-release-probe-after-fix.json) | 5 个定点故障场景通过：两种许可可清理重入、未知替换者保持、双失败错误优先级明确 | 真实文件系统的一次性目录，完成后清理；不是所有 I/O 故障组合的穷举 |
| [覆盖汇总幂等检查](./aggregation-verification.json) | 两次输出字节相同，22 份历史/探针/起始记录不变；当前 370 路径闭合 | 7 个完整语义重审、363 个同字节继承；AST 定位与库存不等于测试执行 |

三个后态探针均由图谱分支实际执行，并经主代理独立复跑。前态失败输出保留，后态输出分开存储；当前 [JSON 来源记录](./validation-provenance.json)带有脚本、回执和源码快照摘要。

## 其他开发线程的根门：读取实际日志并核对候选身份

仓库的 `docs/progress/consolidation-gate-log.md` **§13.151** 明确记录：rc.5 的 `npm test` 使用并发度 6，**1244 项通过、0 失败、0 取消、0 跳过**，含 20 个端到端场景，测试阶段 **636592 ms**。同节记录 typecheck、架构、Biome、knip、95 份 Schema 漂移、`build:check` 和双宿主 `smoke:artifacts` 通过。

已读取 `package.json` 的真实脚本链：`npm test` 进入 `check:typescript`，依次执行静态门、TypeScript 测试、Schema 与制品一致性；smoke 独立于该根门。该步骤没有再次运行根门。原始 stdout 未复制到图谱，不能把持久门记录描述为本线程独立执行的 1244 项结果。

| 候选 | 当前 manifest 原始字节摘要 | 与 §13.151 的记录 |
| --- | --- | --- |
| Codex rc.5 | `ab9d9a1e308db758ce88a02fd334b89843f995cfbb4f3b78ceeacabbc5b18735` | 精确一致 |
| Claude Code rc.5 | `fb4bf0c5eea17b6a25a233f74402cf47711b67d1ab8afe09f3b0b7d6fb203f9f` | 精确一致 |

摘要由本线程直接读取 `plugins/*-wakeflow/artifact-manifest.json` 并计算，算法与 `src/entrypoints/wakeflow-artifact-identity.ts` 的 manifest 字节身份一致；当前源/测试库存也再次与最终快照全量比对相同。manifest 身份核对把日志绑定到当前候选，但不替代独立重建每个制品或重跑全套测试。

`docs/reviews/2026-10-03-privacy-and-admission-review.md` 的后续补审节与 §13.151 还记录生成 Codex MCP 的一次性合成夹具：五类隐私预览均 blocked 且 summary=null，干净摘要保留，未知前缀阻断；生成回调代码覆盖两算法、两语言。该节没有保留完整命令行，因此本图谱只引述已记录的步骤和结果，不补造 invocation。它属于生成制品进程验证。

## 当前未验证的边界

开发日志明确 rc.5 候选尚未安装，原生运行记录仍属于 rc.4；本线程没有重新测量当前宿主进程。rc.4 的原生 MCP、合成证据工具和五窗口记录保留为历史，不能继承成 rc.5 原生验收。Windows 原生、新 Claude 登录会话、新 rc.5 原生 Pod 生命周期亦未在本轮验证。既有 `window-runtime-unverified:5` 是历史原生记录中的限制，不是本线程刚测得的 rc.5 结果。

本地 100/100 图已由 Mermaid 11.17.2 在浏览器实际渲染，[当前回执](../evidence/current-mermaid-render.json)单独保存。主代理完成 FigJam 17 视图、160 节点、158 条边的结构/语义核对；8 个面板使用本轮新截图，9 个未变面板继承 rc.3 已检截图，详见[派生清单](./figjam-derivation.json)和[最终交付](./handoff.md)。rc.3 布局另存历史克隆，原历史文件没有改写；图与截图验证仍不等于业务或原生宿主验收。发布、安装、缓存刷新与代码/制品检查各有独立授权和证据边界。

[覆盖报告](./review-coverage.json) · [逐文件索引](../../maps/02-file-review-index.md) · [当前修复与限制](../../maps/10-end-to-end-business-flow/review-evidence.md)
