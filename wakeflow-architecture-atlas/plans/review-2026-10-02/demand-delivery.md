# Demand、任务、投递、评审与测试：逐文件语义审阅

核验日期 2026-10-02；基线 `d8fafff33919c728e3a9b91ec04aa50ec5e07f0c`，事实来源为当前未提交工作树。仅修改图谱。没有修改运行时、测试、插件制品或安装缓存。

本组逐文件全文阅读 44 个负责文件，并交叉读取事件命令处理器；大型 service/lifecycle、TaskPackage、评审和授权文件分段阅读。清单见 [demand-delivery-files.json](./demand-delivery-files.json)，每项包含内容 SHA-256、职责、分支、效果边界、真实消费者、测试锚点和缺口。静态符号/导入检查用于验证定位，未用其替代语义阅读。

另两组已完成 [事件内核及模型 25 个文件](./event-core-supplement-files.json) 与 [结果/投递合同 12 个文件](./result-delivery-supplement-files.json) 全文补审；三份台账按路径去重后为本分区 81 个手写 TS。本组主清单仍只计自身 44 个，不把补审重复记入。生成合同与 JS 制品不计手写代码审阅数。

## 已确认的核心实现

- 创建：确定性 Demand ID → Pod 临界区 → 自包含发布意图 → stage/final 根和首提交 → 看板认领 CAS → 清 marker/sidecar。根可见与看板 claimed 是分别核验的事实。
- 任务：先查幂等键，再做需求锚点、拓扑、谱系和任务审阅准入；实施与测试分支分别冻结包。磁盘任务包来自事件投影，不是第二权威。
- 投递：prepare 取工作声明、复验绑定后签发许可；Agent 执行宿主效果；outcome 按 hook 或 host-thread 发送返回派生。查询截断/跳过记录不能单独支持未落地判断；独立宿主成功回执或 Controller 明确拒发解决可穿过这类观察异常。
- 重武装：只允许 rejected-before-send；同信封沿用 prompt，但新取围栏。结果导入显式兼容该信封历史 outcome 中的旧围栏，结果绑定当前代际。
- 评审：import 可以来自 accepted 或 indeterminate 投递；accept 要求目标报告之后的完成观察，回调落地不是验收前提。blocked/escalated 再决定必须引用当前决定与恢复依据。
- 测试：逻辑 attempt、宿主发送 generation、产品缺陷 retest 是不同关系。子集重跑覆盖全部失败步骤，未重跑步骤需历史 pass 基线；环境故障恢复后才可重跑。
- 完成：验收覆盖从冻结 requirement 文本、accepted 实现锚点或当前代际 test-accepted 步骤派生；空标准/漏标准阻塞。终态、归档、看板、声明释放、活动根删除按根外日志前向收敛。

## 审阅发现：实现中的具体缺口

### DD-F01：混合失败阻止产品缺陷修复授权

当同一份测试结果同时含 product-defect 与其他分类的 `fail`（例如 flaky）时，`src/capabilities/result-review/decide.ts#escalateBlockers` 只允许修复映射点名 product-defect 步骤；`src/capabilities/result-review/service.ts#remediationAuthorization` 却把所有 fail 步骤交给授权合同；`src/governance/review/controller-product-defect-remediation-authorization.ts#assertRelations` 要求映射覆盖每一个 fail。合法的产品缺陷映射因此在授权创建时以 relation / affectedTargets 被拒。

影响：Controller 看见允许 escalate，但按分类填写的产品修复决定不能落盘。现有纯产品缺陷纵切可用；现有测试覆盖不应被解读成混合分类可用。建议聚焦回归：product-defect + flaky/harness-defect/missing-evidence 同报告，明确仅产品缺陷的授权集合及后续其他失败如何重跑。

已执行 [只读内存复现](./demand-delivery-findings-repro.mjs) 与 [结果](./demand-delivery-findings-repro.json)：切片 blockers 为空，单一产品缺陷控制组成功，混合失败授权 relation。未宣称完整公共 MCP/宿主会话重现。

### DD-F02：无文档证据的 research Demand 无法取消

`src/governance/demand/demand-verify-gates.ts#researchEvidenceGate` 对 research 无条件加入 research-evidence 门；`src/capabilities/demand/decide.ts#gateBlockers` 在 cancel 只跳过 work-claims-released、requirement-coverage。因此未产出 document 的 research 会被取消门阻塞。这与公共取消合同“任何非终态 Demand”不一致。

已执行纯分支复现，输入是 researchEvidenceGate 实际产生的失败门；未执行完整文件系统取消调用。现有 research 测试覆盖完成所需文档门，没有无文档取消断言。建议新增该负例，并确定取消是否应跳过 research 成果门。

### DD-F03：待答升级的取消预检与聚合归约矛盾

事件内核补审确认：`src/governance/demand/model/demand-aggregate-state.ts#cancelDemandAggregateState` 保留 awaitingDecision 只改 lifecycle；同文件 parseAwaitingDecision 只允许 active。公共取消链的 deriveTerminalBlockers 不阻等待决定、cancellationCommand 不清它，因此其他门满足时可能 preview ready，但 apply 写日志后命令归约失败。纯聚合 initial→plan→escalate→cancel 已复现 relation / awaitingDecision，完整命令和输出在 [事件内核补审简报](./event-core-supplement.md)；未将该结果夸大为完整公共 I/O 复现。图中明确保留停止旁路。

### DD-L01：不可把自动化测试扩大成完整现场保证

事件追加 candidate / linked 的真实进程死亡恢复已有专项覆盖。生命周期测试主要覆盖日志后中断与幂等恢复，未证明每一物理边界均经进程死亡测试。宿主发送仍由 Agent 执行；本组未运行真实登录态宿主会话或产品环境测试。

## 图文交付

重建 04–08 的总览、直接导入、实际调用共 15 页；新增 Demand候选恢复、投递重武装、终态归档三个细图页；重建 10/state-and-recovery，共 19 页 / 19 张图。每张图有中文无障碍说明、紧邻术语、稳定边编号与代码/测试证据；文件导入与执行调用分开；单图最多 9 个节点，完整规则和失败边界在图下表格展开。

直接导入图是精选范围，不是全量 import 闭包。旧开发阶段叙述已移除，当前代码与未提交来源明确标注。新缺口在对应页面保留，不能把图的成功主线扩展为所有混合输入均成功。

## Schema、生成链与测试核验方法

- 读取公共 contract.ts 的请求/结果 Schema 装配与错误映射，交叉核对 Schema 的判别字段、required/allOf、step/attempt 范围、取消与归档合同。Schema 是 wire 权威，业务跨记录关系由领域编解码器和服务继续验证。
- 生成链为 `src/contracts/schemas` → `tooling/codegen/schema-types.ts` → `src/contracts/generated`，根 `schema:check` 检查漂移。没有把生成文件作为手写语义审阅计数，也未手改其字节。
- 完整阅读新增验收覆盖与 runtime recovery 测试，定向阅读 Pod 并发、任务、投递、评审、research 完成及决定合同测试的相关分支与 fixture。测试锚点以真实导入/调用符号定位；间接覆盖明确写出公共入口，不以同名测试文件推断覆盖。
- 本组未并发运行根 npm test，由主代理统一执行。本组最终结构检查 19 页 / 19 图错误为 0、指纹漂移为 0；所管路径 git diff --check 通过。全局其余模块仍在并行编辑，最终全局检查与图形渲染由主代理统一归档。

## 交付前语义来源复核

19页逐页复核正文、节点、边、术语与恢复陈述，补齐119项按页计数的精确来源引用；不是119个新增源码文件，也不是扩大到全目录的依赖闭包。记录见 [来源核对表](./demand-delivery-source-audit.json)。静态导入页改为只声明AST结构证据，不再用同名纵切测试暗示每条import已执行。另纠正readback为状态与证据摘要、命中幂等仍读取当前聚合的表述；测试纯分类边改锚定纯决定用例，并明确其公共I/O覆盖限制。

### 并行源码晚变更复核

delivery/service.ts 在首轮台账后新增 observedOutcomeDecision。已复读新增函数、executeOutcome接线、isWakeflowError导入，以及service测试中坏hook通道的Controller解决和独立host回执两项修改，修订06总览/调用页与本文件结论后更新内容指纹。原有2085行与新增替换区域合并覆盖当前全文；本轮未修改该运行时代码。
