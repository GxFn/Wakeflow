---
diagramId: ts-end-to-end-evidence-z2
viewType: evidence-matrix
truthKind: current-code
reviewDepth: L5
verifiedAt: 2026-09-01
snapshotObservedAt: 2026-09-01T20:05:05-07:00
baselineCommit: f7c005d73c11e29f284dbde1d7117193376c0ef6
sourceFingerprint: sha256:bd928c541d8217ea70f2b43faf5a2e38b208bba1efb588a724cfa5055c34d486
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Source Maintenance
generatedBy: manual-composition
sourcePaths: [src/**]
testPaths: [tests/**]
---

# 端到端Review证据矩阵

## 审阅结论

下层文档已经覆盖从Foundation、pending TODO、Demand Publication到Completion的TypeScript候选链及当前
18个公共MCP工具。当前Architecture与101份Schema通过，Publication 25项和MCP注册/双宿主3项通过；
902项完整TypeScript门属于Publication之前的基线。双宿主插件smoke、真实宿主效果、旧JS等价对照与
release gate未运行，因此图可用于当前代码Review，不能声明插件发布就绪。

## 阶段证据矩阵

| 主图边 | 业务阶段 | 权威/生产者 | 关键测试面 | 下钻证据 | 当前判断 |
| --- | --- | --- | --- | --- | --- |
| `E-Z0-01`–`03` | 公共入口与Workspace准备 | 固定MCP root、Maintenance/Binding owner | entrypoint、Maintenance、Binding测试 | [01](../01-overall-architecture/runtime-call-flow.md)、[03](../03-configuration-workspace/runtime-call-flow.md) | 18工具双宿主集合一致 |
| `E-Z0-04`、`E-Z0-33` | TODO到Demand发布 | Planning/Application、Publication sidecar、TODO/Ledger、revision 1 | Input/Planning/Application/Service/Public/MCP | [04](../04-governance-event-sourcing/runtime-call-flow.md) | Public preview/apply/recover与首个Route闭合 |
| `E-Z0-05`–`06` | TaskPackage规划 | Planning Service、Demand Event | TaskPackage、Planning、Projection Store | [05](../05-tasking-slice/README.md) | implementation/test共用公共Planning |
| `E-Z0-07`–`12` | Delivery与宿主效果 | Intent、WorkClaim、Claim/Observation Events | preparation、claim、outcome、rearm | [06](../06-implementation-delivery-review/runtime-call-flow.md) | 公共owner记录事实；Agent执行效果 |
| `E-Z0-13`–`19` | Result与Controller Review | TargetResult、Decision/Resume Events | result import、decision/resume、snapshot | [06](../06-implementation-delivery-review/README.md) | Inspector/Decision/Resume公开 |
| `E-Z0-14`–`17` | 返工/blocked恢复 | Rework Context、blocked Decision、Resume Event | review event sourcing、resume、redelivery | [07](../07-review-rework-completion/runtime-call-flow.md) | 同Package返工和双workType Resume闭合 |
| `E-Z0-20`–`22`、`E-Z0-25`–`32` | 条件真实测试与产品修复 | Card、Attempt、Result、Test Decision、Remediation Events | Testing/Result/Review/Remediation测试 | [08](../08-real-environment-testing/README.md) | 四类Test Decision均有consumer；修复后新Test代际 |
| `E-Z0-23`、`E-Z0-25` | Demand成功完成 | Completion Plan与completed Event | controller-only及real-environment Completion测试 | [07](../07-review-rework-completion/README.md) | 两种testing mode均保留精确历史后完成 |
| `E-Z0-24` | 归档 | 无 | 无 | 主图停止边界 | 未实现 |

## 跨层合同核对

| 合同 | 创建者 | 消费者 | 不变量 |
| --- | --- | --- | --- |
| Config v3 | Fresh编译/Config权威 | Workspace、Tasking、Window Runtime、Lifecycle | 当前摘要在apply时重新复验 |
| Demand Publication plan | Planning Service | Application与物理Publication Service | author-owned输入与owner派生字段分离；plan digest、Config/Ledger和最终回执重新闭合 |
| TaskPackage | Tasking Planning | Delivery、Testing、目标窗口 | 不可变；返工保持同一合同 |
| Delivery/Test Intent | Preparation Service/Event | Claim、Dispatch、Result来源闭合 | 提交前无宿主效果；generation追加 |
| WindowWorkClaim | Claim Service/Store | Outcome、Completion Authority | 不自动过期；exact release |
| TargetResult | shared Result Import/Event | workType对应Review Snapshot/Decision | implementation/test各自Report与lineage闭合 |
| Implementation Review Decision/Resume | Controller Services/Event | Rework、Route、Completion | snapshot generation精确匹配 |
| Test Review Decision | 独立Test Review Service/Event | accept→Completion、another→rerun、blocked→shared Resume、product-defect→Remediation/retest | 不复用implementation rework/redesign词汇 |
| Remediation Authorization | Product Remediation Service/Event | Delivery Context、Aggregate、TestCard generation source | 只绑定既有产品TaskPackage和失败检查 |
| currentTestCard / 历史Test Target | Aggregate Event reducer | Route、Repository、Completion | 当前Card唯一；历史Target仅允许`test-product-defect`并保留原Card tuple |
| Completion | Lifecycle Service/Event | 当前无归档消费者 | 支持controller-only/real-environment，后者保留TestCard与attempt lineage |

## 已运行与未运行

| 验证 | 本图集工作结果 |
| --- | --- |
| 文档阅读器TypeScript与生产构建 | 通过 |
| 图集依赖安全审计 | 0漏洞 |
| Markdown差异检查 | `git diff --check`通过 |
| 根TypeScript | 当前Publication聚焦25项与MCP注册/双宿主3项通过；完整902项结果属于此前基线 |
| Schema检查 | 101 Schema、207 external refs，生成合同一致 |
| dependency-cruiser | 723模块、5059依赖、0违规 |
| 图集完整门 | TypeScript、30份严格current指纹与Vite/Mermaid生产构建通过；错误为0 |
| 根`check:typescript` | 已运行并通过 |
| Codex/Claude validator与smoke | 未运行 |
| 真实Agent宿主效果 | 未运行 |
| release一致性门 | 未运行；工作树非clean且无本轮发布请求 |

## Review停止条件

- 任何下层活动源码继续变化后，10包组合指纹立即过期。
- Demand Publication提交`f7c005d`尚未通过当前完整TypeScript门；聚焦证据不能冒充release gate。
- Research Completion与Implementation Redesign仍必须保持显式blocker。
- 归档缺口必须保持显式，不得用`demand-completed`冒充已归档。
