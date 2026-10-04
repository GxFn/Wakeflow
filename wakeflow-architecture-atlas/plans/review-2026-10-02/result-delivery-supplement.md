# Result / Delivery 合同补审

2026-10-02，按当前工作树补审 12 个手写 TS（3,905 行），覆盖 `src/governance/result/` 与 `src/governance/delivery/` 全集。记录见 [逐文件数组](./result-delivery-supplement-files.json)。只写本图谱记录；没有修改运行时或执行根测试。

### 可直接进入流程图的事实

| 事实 | 实现定位 | 测试锚点 |
| --- | --- | --- |
| 三种 outcome 与声明处置 | `src/governance/delivery/delivery-outcome.ts#deliveryClaimHandling`：仅 rejected-before-send 为 release-authorized；accepted、indeterminate 均 retain。 | `tests/capabilities/delivery/service.test.ts#recordFixtureDeliveryOutcome` |
| 结局证据限制由 Schema 守卫 | `src/contracts/schemas/governance/delivery/delivery-outcome.schema.json`：accepted 仅 hook-record / host-send-return / controller-resolution；indeterminate 仅 agent-declaration；hook 需 recordId，Controller resolution 需 rationale。 | 间接覆盖：`tests/capabilities/delivery/service.test.ts#recordFixtureDeliveryOutcome` 经 create/parseOutcome。 |
| 同信封最多三次 rearm | `src/governance/delivery/delivery-rearm.ts#DELIVERY_REARM_LIMIT` = kernel MAXIMUM_WORK_CLAIM_GENERATION − 1 = 3；generation 最高4，必须 previous+1 且新 claimId 不同。 | `tests/kernel/work-claims.test.ts#MAXIMUM_WORK_CLAIM_GENERATION` |
| 信封冻结 prompt、binding 与 fence | `src/governance/delivery/delivery-envelope.ts#parseDeliveryEnvelope` 重算 prompt/envelopeDigest；`assertDeliveryEnvelopeMatchesTaskPackage` 核对task/package/config/window和精确投影ref。 | 间接覆盖：`tests/governance/result/target-result.test.ts#createImplementationTargetResult` 经构造器核对信封与任务包。 |
| 两种实现纠错上下文互斥 | 信封 implementation 允许 rework 或 productDefectRemediation 二选一；test 必须带 attempt。 | 未覆盖：本补审未确认互斥字段的独立负例，现有信封专测主要核对 prompt 摘要。 |
| completed 实现报告须覆盖全部 acceptance anchor | `src/governance/result/implementation-target-result.ts#createImplementationTargetResult` 检查repository、anchors与commitExpectation；blocked/needs-review可以部分覆盖。 | `tests/governance/result/target-result.test.ts#createImplementationTargetResult` |
| test 整体 verdict 由逐步事实派生 | `src/governance/result/test-target-result-report.ts#deriveTestVerdict` 顺序 fail > blocked > cannot-conclude > pass；空steps为cannot-conclude。 | `tests/governance/result/test-target-result-report.test.ts#deriveTestVerdict` |
| 每步证据和failure是强关系 | 非pass必须failure，pass不能failure；step evidence的ref/digest必须在locators中；completed不可空、blocked不能含fail。 | `tests/governance/result/test-target-result-report.test.ts#createTestTargetResultReport` |
| Test completed 覆盖本attempt全部scope | `src/governance/result/test-target-result.ts#createTestTargetResult`：initial用合同所有step；rerun仅用attempt.rerunSource.stepIds；结果不得夹带scope外步骤。 | `tests/governance/result/test-target-result.test.ts#createTestTargetResult` |
| 结果与事件身份稳定 | `src/governance/result/target-result.ts#targetResultIdForClaim` 复用claim UUID；event/commit ID按claimId确定派生。 | `tests/governance/result/target-result.test.ts#targetResultRecordedCommitIdFromResult` |
| Callback重新签发最多4代 | `src/governance/result/target-result-callback.ts#parseTargetResultCallbackReissue` 要求previous+1；初始record固定generation1。 | 未覆盖：本补审未确认直接 reissue parser 负例；上层重签发服务由能力主审核验。 |
| Callback状态优先级 | `deriveTargetResultCallbackStatus` 先 acknowledged，再看同promptDigest且recordedAt>=issuedAt的landing，再以严格大于silence阈值判断silent/pending。常量阈值10分钟。 | `tests/capabilities/result-review/decide.test.ts#deriveTargetResultCallbackStatus` |

### 不能归给 codec 的保证

这12个文件均不执行宿主发送、不追加业务事件、不释放声明、不访问真实证据文件。Outcome Schema 限制证据类型组合，但不验证 hook 是否存在；rearm parser 验证代际与新旧围栏的形式关系，但不证明引用的 rejectedOutcome 是当前事实；callback状态函数消费调用方提供的landingRecords，不自行筛选宿主session目录。

`parseTargetResult` 的单文档结构/摘要准入与 `createImplementationTargetResult` / `createTestTargetResult` 的跨来源匹配不是同一层。后者才把真实 taskPackage、envelope、delivery、report闭合。`assertDeliveryBindingFollowsEnvelope` 只对generation1要求claim与原信封一致；更高代际必须由上层按当前rearm事件/claim事实复核，不能把这个函数画成完成全历史验证。

结果报告的 completed、测试verdict pass、投递accepted 均不等于 Controller acceptance。治理review owner决定允许哪些评审动作，这组仅提供合同输入。

### 核验方法

完整读取12文件全部运行语句；纯类型 `target-result-report-contract.ts` 原文核对。重点读取 delivery-outcome/rearm Schema 的条件约束，核对 work-claim generation常量。人工核对 TargetResult构造正负例、TestReport证据/failure/空结果断言和callback状态优先级断言。JSON中tests数组是AST直接import关联索引，不声称每个列出的测试文件均全文审阅或本轮已执行。
