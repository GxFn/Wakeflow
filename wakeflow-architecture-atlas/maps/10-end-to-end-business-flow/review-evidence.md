# 审阅发现与当前修复状态

2026-10-03，最终来源为 **1.1.0-rc.5 候选**；审阅目录保留起始 rc.4 名称。本轮图谱审查发现的问题交由开发线程修复，再读取实际差异、消费者、正式回归和独立后态探针确认。生产实现由另一个线程维护，原始失败证据不改写。

## 本轮发现并复核闭合的四项问题

| 编号 | 当前状态与实际变化 | 保留条件 | 证据入口 |
| --- | --- | --- | --- |
| PF-01（分支记录 RC4-PRIV-02） | 已修复：先识别 UUID 候选，再只放行完整已知前缀；未知下划线、连字符或伪已知前缀不再自动逃过检测 | 不匹配任意字母数字复合串中的所有 UUID 子串；扫描不是任意秘密的完备证明 | `tests/kernel/privacy-scan.test.ts#scanPrivacy`；[隐私前后态记录](../../plans/review-2026-10-03-rc4/privacy-evidence.md) |
| PF-02（分支记录 RC4-PRIV-01） | 已修复：文档和发布评估独立携带 privacyHit，公共摘要不再依赖最多64项展示诊断；标题、正文、头部隐私均参与披露决定 | 诊断仍有上限，缺隐私诊断条目不能推论允许披露；干净饱和列表仍可给出有用摘要 | `tests/capabilities/requirement/service.test.ts#executeRequirementPublicationRequest`；[独立预览探针](../../plans/review-2026-10-03-rc4/privacy-evidence-probe-after-fix.json) |
| CF-01 | 已修复：读写许可取得即在 latch body 内登记，短锁结算失败仍清理已有许可；两种模式和排空阶段可同进程重入 | 未知替换者保护不放宽；cleanup 自身失败可覆盖首错，不能承诺所有故障后目录必空 | `tests/foundation/filesystem/rooted-read-write-scope.test.ts#withRootedReadWriteScope`；[5场景后态探针](../../plans/review-2026-10-03-rc4/concurrency-release-probe-after-fix.json) |
| CB-01（分支记录 CB-F01） | 已修复：回调提交列表使用 algorithm:value，保留 SHA-1/SHA-256 与两种语言中的身份 | 原持久化结果不变；回调摘要与引用格式不授予接受、越过守卫或用户批准 | `tests/capabilities/result-review/prompt.test.ts#renderWakeControllerPrompt`；[回调后态探针](../../plans/review-2026-10-03-rc4/callback-probes-after-fix.json) |

完整分支见[隐私披露](../13-requirement/privacy-preview.md)、[竞争与失败结算](../02-foundation/admission-races-and-recovery.md)、[回调与评审](../07-review-rework-completion/callback-trust-and-review.md)。正式测试定位、独立探针和根门运行是三种证据；源 SHA 与原记录闭合不能替代所有分支执行。

## 前轮已核验并保留的三项 DD 修复

以下问题在 rc.3 轮已核验。本轮根据相同字节继承及相关调用链复核保留结论，不把旧探针和旧根门数字重记为本轮运行。

| 编号 | 当前状态 | 实际修复与仍保留的条件 | 回归证据 |
| --- | --- | --- | --- |
| DD-F01 | 已修复：混合失败授权集合一致 | 公共准入与授权生产者都只收全部 product-defect fail；仓储按持久决定的映射集合核原报告。其他分类仍 fail，不能作 pass 基线。 | `tests/capabilities/result-review/mixed-failure-remediation.test.ts#executeTestReviewDecisionRequest`：4种混合分类、幂等；flaky再走修复→retest→rerun→接受。 |
| DD-F02 | 已修复：无成果 research 可取消 | cancel 豁免 research-evidence，但 complete 仍阻断；verify fail 原样保留在取消归档。 | `tests/governance/demand/demand-research-completion.test.ts#executeDemandCancellationRequest`：ready、withdrawn、删根、recover相同摘要。 |
| DD-F03 | 已修复：等待决定时可取消 | cancel 移除活动等待，升级事件仍保留，不伪造用户回答；其余取消门不放宽。 | `tests/governance/demand/demand-aggregate-state.test.ts#cancelDemandAggregateState`；`tests/capabilities/demand/service.test.ts#executeDemandCancellationRequest`：追加前与终态后中断恢复及旧字节保持。 |

[rc.3 历史生产链与断言复核](../../plans/review-2026-10-03/demand-delivery.md) · [旧工作树的历史失败输出](../../plans/review-2026-10-02/demand-delivery-findings-repro.json)。测试断言已读不等于本轮运行通过；运行结果由统一验证记录另列。

## 其他不能过度承诺的能力边界

| 边界 | 当前实际实现 |
| --- | --- |
| Claude支撑面根缺失 | 共享层能提出物化计划，但Claude portable-settings的support-root-missing blocker可能使整个reconcile受阻；源码已核对，未独立运行复现。 |
| 工作声明释放 | 到期、session-end、端点缺席是“或”关系；不会自动按TTL在后台释放。 |
| 不完整hook查询 | 不能据此证明没有落地；最新投递代码可利用独立Codex发送回执，或Controller显式未落地判断；accepted resolution仍须真实hook。 |
| hook来源与运行身份 | Observation v2 的 lastObservation.observerManifestDigest 只识别 hook 生产者；绑定窗口 runtime 仍为 unverified，runtime-artifact 门据此 unavailable。本服务磁盘制品换版仍是 fail，不能用 hook 摘要证明目标进程已更新。 |
| hook历史兼容 | 分片和平铺均读；旧v1记录缺artifactManifestDigest时规范解析为null，幂等返回原位置并保留原字节。 |
| 提交后取消 | 物理原语、业务结算与投影各有边界；某些后续步骤仍传signal，可能需要同键回放或日志恢复。 |
| status / verify | Config/Ledger入口失败仍可整体拒绝；后续域才逐域降级；pass可带未注册、过渡态等code，不等于全环境ready。 |
| 分支合并观察 | 没有完整Git对象图，当前只是尖端相等的有限判断；不能冒充祖先合并或工作树清洁检查。 |
| 受管证据 | manifest库存检查、单成员完整读取、完整payload verify是不同证据等级；引用型link/commit不会自动抓取外部内容或验Git对象。 |
| Pod recover | 当前 apply/recover 接入工作区 exclusive 作用域，并保留内部 Pod 短锁；具体恢复仍按操作回执与意图结算，不能解释成任意残留修复。 |
| 宿主兼容与发布 | 本线程独立探针、开发线程生成制品/smoke和原生登录会话分别记录。日志中的原生证据仍为rc.4，当前rc.5候选未安装；图谱没有发布或刷新缓存。 |

[rc.3 协调/证据/观察历史详审](../../plans/review-2026-10-03/coordination.md) · [rc.3 工作区与宿主历史详审](../../plans/review-2026-10-03/hosts-workspace.md) · [验证层次](../17-artifacts-and-contracts/schema-and-validation.md)。

## 验证如何阅读

当前 370 个手写文件由7个本轮完整重审和363个同字节继承组成；95 Schema、95 generated、297 tests 单独计数，见[逐文件索引](../02-file-review-index.md)。额外交叉深读不重复计为完整全库重审。

本线程运行并独立复跑三组后态探针；开发线程的持久门日志另记录 rc.5 的1244项测试、20个E2E和双宿主smoke通过，当前两份候选manifest字节摘要已交叉核对。[验证来源](../../plans/review-2026-10-03-rc4/validation-provenance.md)清楚标注哪些是本线程执行、哪些由他线程日志支持。rc.5原生会话尚未验证，rc.4现场记录不能替代它。

本轮100/100本地图已完成[浏览器真实渲染](../../plans/evidence/current-mermaid-render.json)；FigJam 17视图、160节点、158边已对照当前源图，8面板采用新截图、9未变面板沿用rc.3已检截图，来源详见[派生清单](../../plans/review-2026-10-03-rc4/figjam-derivation.json)和[交付记录](../../plans/review-2026-10-03-rc4/handoff.md)。可直接查看[当前架构](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=62-1743)或[回调状态图](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=76-2662)。rc.3与Oct2的审阅、失败输出和执行记录保留为历史，继承范围明确限定，不从旧通过状态推定新分支已执行。

[业务主线](./README.md) · [状态与恢复](./state-and-recovery.md) · [当前覆盖](../../plans/review-2026-10-03-rc4/review-coverage.json)。
