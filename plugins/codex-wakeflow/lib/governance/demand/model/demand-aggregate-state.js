/**
 * Wakeflow Governance / Demand Model：领域事件归约器生成的纯聚合状态。
 *
 * 本状态不保存事件流修订号、事件尾部、身份/权威关系摘要或更新时间；这些事实
 * 属于事件溯源的持久化封装或快照。`authorityDigest` 让纯 Decider 能验证新任务绑定
 * publication 时冻结的 Authority；`targetTasks` 只保存调度前真正需要的最小摘要，
 * 完整 TaskPackage、Delivery Envelope、Delivery Outcome、Delivery Rearm、TargetResult
 * 与 Controller Review Decision 仍属于事件数据；状态只保存当前 Delivery（含围栏与
 * 结局摘要）、Result（含 wake-controller 回调的当前代际）和 Review 的最小摘要，工作声明
 * 本身在内核的共享协调根。测试合同在 test 任务包里；已经
 * 观察到产品缺陷的旧Test Target继续作为历史代际保留自己的attempt、Result与
 * Decision。`managedEvidence`只在首个Evidence Event后出现，且只保存Manifest与payload
 * 的精确selector；完整Manifest仍由Event拥有。`pendingTestRetest`只记录产品缺陷修复后
 * 尚待创建的一代复测，不复制完整Authorization或事件历史。Pod归属记录在Demand身份
 * （identity.podId）里，不在聚合状态里。
 *
 * 聚合按关注点分在六个模块里（open-items L5，gate-log §13.255）：形状与错误（model）、准入与归一（wire）、
 * 投递（delivery）、结果（result）、评审（review）、Demand 自己的转移（lifecycle）。依赖只有一个方向——
 * model ← wire ← 其余四个。本文件只转出别处在用的公开名字，引用方的路径不变；只在聚合内部用的类型留在
 * 各自的模块里，各模块之间共用的内部函数也不从这里出去。
 */
export { prepareDeliveryInDemandAggregateState, rearmDeliveryInDemandAggregateState, recordDeliveryOutcomeInDemandAggregateState, } from "./demand-aggregate-state-delivery.js";
export { cancelDemandAggregateState, completeDemandAggregateState, continueDemandAggregateState, escalateDemandAggregateState, historicalTestTargetIdsAtContinuation, planTargetTaskInDemandAggregateState, REPLACEABLE_PHASES, recordDecisionInDemandAggregateState, recordManagedEvidenceInDemandAggregateState, } from "./demand-aggregate-state-lifecycle.js";
export { currentTestTargetsOf, DemandAggregateStateError } from "./demand-aggregate-state-model.js";
export { recordTargetResultInDemandAggregateState, reissueCallbackInDemandAggregateState, } from "./demand-aggregate-state-result.js";
export { authorizeProductDefectRemediationInDemandAggregateState, decideTargetResultReviewInDemandAggregateState, } from "./demand-aggregate-state-review.js";
export { computeDemandAggregateStateDigest, createInitialDemandAggregateState, parseDemandAggregateState, } from "./demand-aggregate-state-wire.js";
