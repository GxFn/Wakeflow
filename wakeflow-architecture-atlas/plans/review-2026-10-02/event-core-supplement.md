# Event Sourcing 与 Demand Model 补审

2026-10-02，基线 `d8fafff33919c728e3a9b91ec04aa50ec5e07f0c` 加当前工作树。新增完成25个手写TypeScript文件、15,172行全文语义审阅；大文件按连续区间阅读。与最初81文件合计106个不重复手写文件。逐项记录见 [event-core-supplement-files.json](./event-core-supplement-files.json)。补审只写本报告和台账，04/07等模块图由其原审阅者维护。

## 已核实的核心边界

| 机制 | 真实实现 | 不能扩大的结论 |
| --- | --- | --- |
| 版本 | 15个事件家族当前/支持版本全为v1，状态模型v1；version compatibility digest绑定支持矩阵 | 注册表存在不意味着已有v2迁移；upcast不重写磁盘或历史state digest |
| 命令 | 14类命令；parse→幂等检查→load→decide→prepare→append→checkpoint | decide无I/O、时钟、流序号分配；不能把公共preview当append能力 |
| Commit | 每批1至64事件，物理commitSequence与逻辑revision分开；各事件resultingStateDigest逐步复验 | 单命令不一定只生成一事件；review和升级/修复授权可同批原子提交 |
| Prepared capability | prepare签发进程内WeakSet对象，携带旧state/event摘要预期；plan不签发 | JSON拷贝、磁盘commit或恢复意图不能直接获得append权限 |
| 文件追加 | 同进程按canonical Demand root队列；跨进程/线程仍由exclusive link处理 | 不是全局进程锁；不把内存队列当状态权威 |
| 候选恢复 | 只接受所有owner均inactive；candidate-only安全退休；已link双链接先结算目标持久性后删候选 | active/unknown owner保留；已提交目标不回滚 |
| 读取 | load最新可用snapshot+tail；snapshot目录最多重读2次后fallback；audit从commit1全重放 | 正常load不验证已被snapshot覆盖的所有历史字节；聚焦测试明确展示这一差别 |
| Root Authority | 根清单→Identity→Authority→Ledger成员→聚合→首published事件→证据selector→复读清单 | metadata inventory不等于完整payload内容验证 |
| 记录选择器 | 状态只存当前Task/Delivery/Result/Review最小摘要；完整载荷在事件 | 不得从状态摘要虚构完整任务或证据 |
| 历史test代际 | continue决定把当时test IDs写入事件；currentTestTargetsOf排除这一边界；旧事件缺字段保持旧行为 | 不能在upcast中依据当前规则重算历史并改变旧digest |
| 结果与重试 | outcome允许prepared首次或indeterminate再判，不能重复indeterminate；rearm只接rejected-before-send且新围栏；callback重发只在未评审结果阶段 | 宿主接受、结果报告和Controller接受是不同状态 |
| Authority | 四种Demand都requirement/landing各一，同一不可变包；research iff not-applicable；environmentMemberRef恒null | landing仍是测试环境权威角色常量；Pod不是另一个Ledger environment成员 |

## DD-F03：等待决定时取消在归约器失败

**确认缺口。** `src/capabilities/demand/decide.ts#lifecycleBlockers`只在complete时把awaitingDecision列为阻塞，cancel不阻塞；`src/capabilities/demand/lifecycle.ts#planTerminal`因此可生成取消ready计划。取消提交进入 `src/governance/demand/model/demand-aggregate-state.ts#cancelDemandAggregateState` 后，只把lifecycle改为cancelled并保留awaitingDecision；同文件 `parseAwaitingDecision` 明确拒绝非active生命周期携带该字段，导致取消失败。

这与第三次rework升级提供的“取消Demand”选项冲突。并行主线审阅者已复核公共cancel链不先清除awaitingDecision，并将停止点加入终态图。未修改运行时、Schema或测试。

复现使用当前根构建产物和现有无I/O TaskPackage fixture；仅创建内存状态，不创建或删除工作区。命令从仓库根运行：

```javascript
import {
  createInitialDemandAggregateState,
  planTargetTaskInDemandAggregateState,
  escalateDemandAggregateState,
  cancelDemandAggregateState,
} from './.build/src/governance/demand/model/demand-aggregate-state.js';
import {createTaskPackageFixture} from './.build/tests/governance/tasking/task-package.fixture.js';

const pkg = createTaskPackageFixture();
const planned = planTargetTaskInDemandAggregateState(
  createInitialDemandAggregateState(pkg.demandId, pkg.demandAuthorityDigest),
  pkg,
);
const awaiting = escalateDemandAggregateState(planned, {
  issue: 'Synthetic review cancellation probe',
  source: {
    kind: 'rework-brake',
    targetTaskId: pkg.targetTaskId,
    reworkCount: 3,
  },
}, 'demand-event_99999999-9999-4999-8999-999999999999');
cancelDemandAggregateState(awaiting);
```

实际捕获结果：

```json
{"cancelAccepted":false,"name":"DemandAggregateStateError","reason":"relation","path":"$/awaitingDecision"}
```

此内存探针证明归约器矛盾；它没有冒充真实窗口测试。公开调用的后续影响由主线审阅者依据已读取消计划/提交链交叉确认。

## 测试与Schema核验方法

补读了命令处理器幂等/并发拒绝断言、repository的snapshot+tail与完整audit差异、快照损坏fallback、file event store的link前取消断言，以及aggregate continuation历史边界断言。其余测试关系由实际import/符号使用定位，并保留在台账，不声称每个测试全文或每个分支均已执行。

持久合同按当前codec与所导入的源Schema关系核对：Commit序号和事件边界、Stored Event封装、Snapshot版本摘要、Aggregate字段、Identity/Authority与需求谱系。Schema生成链仍由根schema:build/schema:check拥有；generated文件不计入25个手写语义审阅。

全量npm test、图谱浏览器渲染与全局check由主审统一执行。补审没有修改任何源码或发布制品，没有新增后台任务，也没有声称真实宿主会话已验证。
