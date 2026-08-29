# Wakeflow 旧 JavaScript 产品全场景闭包审查

> 日期：2026-08-28
> 状态：`draft / read-only-audit-complete / implementation-paused`
> 范围：旧 JavaScript 产品、当前 TypeScript 进度与二者之间的能力差异
> 非权威声明：本文记录代码事实、审查判断与候选顺序，不创建 TODO、TaskPackage、发布或迁移授权。

## 1. 结论先行

旧 Wakeflow 不能被当成一套单一、长期稳定且已经完整生产验证的实现。
审查必须同时使用两个源码时期：

1. `70d79d7`：2026-08-24 大重构之前的渐进迭代版；它更能证明真实用户场景、旧工作流和长期叠加形成的需求。
2. `12503b6`：当前旧 JavaScript v3 的主要来源；它更能证明后期严格合同、恢复反例和候选领域边界，但绝大部分代码在一次超大提交中落地，不能单独证明真实生产成熟度。

新 TypeScript 版应当：

- 保留两个时期共同证明的产品场景和业务不变量；
- 吸收 v3 中经真实 consumer 证明有效的严格合同；
- 删除旧版手写 MCP、子进程 dispatcher、Wakeflow 自行宿主 effect、无 producer 候选和为旧迁移固定的兼容形态；
- 不按旧模块、Schema、工具内部步骤或文件数量进行机械迁移；
- 在进入下一项实现前，先重新基线化 Demand/Tasking/Delivery 的业务模型。

## 2. 审查方法与证据层级

本轮按以下闭包审查：

```text
用户场景
→ 公共 MCP/CLI 入口
→ 领域 owner
→ authority 与持久记录
→ mutation / recovery
→ Agent 或宿主 effect
→ downstream consumer
→ focused test / smoke / validator / package
```

证据优先级：

1. 当前生产源码的真实 import、export 和调用路径；
2. 直接父版本源码与 Git 演进；
3. Schema、测试和 disposable smoke；
4. 安装后的 AGENTS/Skills/README；
5. 需求与开发文档；
6. 文件名、注释中的未来描述和没有 caller 的候选 API。

旧 JavaScript 只提供功能与失败场景事实，不支配 TypeScript 技术选择。

## 3. 两个旧源码时期

| 事实 | 渐进迭代版 `70d79d7` | 当前旧 JS v3 `12503b6` 之后 |
| --- | ---: | ---: |
| `core/scripts/lib` 模块 | 43 | 86 |
| `core/scripts/lib` 行数 | 15,958 | 116,624 |
| `core/schemas` | 9 | 61 |
| 根测试文件 | 64 | 116 |
| 公共 MCP 工具 | 31 | 31 |
| 共享 core 模块图 | 未重新生成 | 93 modules / 546 dependencies |
| 正常 MCP 可达闭包 | 旧脚本 dispatcher 路径 | 84 modules |
| Codex host-only | 轻量 adapter/profile | 6 files / 2,251 lines |
| Claude host-only | 轻量 facade/profile | 12 files / 13,039 lines |

`12503b6 feat: finalize Wakeflow v3 initialization` 的 core runtime 差异约为
160,800 行新增、39,045 行删除；完整提交连同历史 fixture 约新增 1,353,265 行。
该提交没有 release tag。当前旧 v3 拥有大量严格测试，但缺少与其规模相称的长期演进历史和完整公共业务 smoke。

因此：

- 渐进版用于回答“Wakeflow 实际解决什么问题”；
- 当前 v3 用于回答“后来发现了哪些一致性、恢复与隐私反例”；
- 新 TS 重新决定“最小正确模型是什么”。

## 4. 产品总场景

### 4.1 主流程

```text
S0 Intake
→ S1 Design
→ S2 Demand + TaskPackage
→ S3 Delivery + Agent host effect + TargetResult
→ S4 Review / Rework / Redesign
→ S5 optional Test
→ S6 Complete / Cancel / Archive / Retention
```

Workspace Maintenance、Window Identity、Observability、Preservation、Pod 与 Migration 是跨阶段能力，不是第二条业务状态机。

### 4.2 场景闭包矩阵

| 场景 | 旧产品可观察结果 | 主要旧 owner | authority/effect | 当前 TS |
| --- | --- | --- | --- | --- |
| Fresh 初始化 | 创建 strict Config、Active/Local/Ledger/Support、managed files 与 launch intents | fresh/config/local/support/ledger/managed/active/window/host settings owners | Workspace maintenance transaction；不创建真实窗口 | 技术链已完成，MCP 尚未接线 |
| Reconfigure | current→desired，按 stable ID 比较拓扑并阻断未关闭资源 | reconfigure + owner plans | 旧 v3 支持更广的拓扑差异；新 TS 首版 placement-stable | 部分完成 |
| Reconcile | 按当前 Config 修复 managed/layout/projection，不改 desired model | reconcile + owner plans | 零写 preview、exact recovery | 已完成首版 |
| Design intake | Design 交付一条完整 TODO | TODO owner | 旧版 Markdown 13 列权威 | 新 TS 改为 JSON aggregate + Markdown projection |
| Next work / claim | 只读选择，随后精确 claim | TODO + demand publication | TODO row CAS；Demand root-first publication | 新 TODO 和 Demand publication 已完成 |
| Demand publication | 创建 identity/authority/state/events/文档与可选 TODO claim | demand publication | create journal + stage + root-first rename + final read gate | 新 TS Event Sourcing publication 已完成 |
| Tasking | 创建 immutable TaskPackage 和 target task selector | artifact/state owners | package + event + state | 未实现 |
| Test boundary | 创建 TestCard，绑定已确认环境、attempt 和产品任务 gate | artifact/state owners | TestCard + event + state | 未实现 |
| Target delivery | plan→apply→claim→Agent host send→outcome→rearm | delivery + transport + lease + binding | group/packet/envelope/run；真实 host effect 在 Wakeflow 外 | 未实现 |
| TargetResult | 从 settled transport 导入严格结果并释放 exact lease | result-review + artifact/state | TargetResult + event + state；不代表接受 | 未实现 |
| Review | 只读 review pack→ReviewCandidate→Controller decision | result-review | candidate 与 decision 分离 | 未实现 |
| Continue | completed-but-not-archived Demand 追加 bug/supplement/optimization lineage | artifact/state/lifecycle | 新 package 与 continuation event | 未实现 |
| Complete / Cancel | 终态事件；Cancel 保留诚实历史 | lifecycle | event + state + lease closure | TS 只有 publish/cancel 骨干 |
| Evidence import | 捕获 bounded source，隐私扫描，发布 manifest/tree 并记录 event | evidence importer/records/tree/state | managed evidence tree + event + state | 只有通用 tree transfer Foundation |
| BusinessArchive | 终态全需求闭包、Ledger 发布、TODO 消费、脱离 current | archive/ledger/TODO/Pod/transport | archive transaction；不关闭宿主、不删 transport | 未实现 |
| Transport retention | Archive 后整 demand transport prune | retention + mutation | 独立 preview/apply/recover | 未实现 |
| Preservation | 将 exact 本地 source 放入隔离 hold，显式 release | preservation | manifest-bound private tree；绝不按年龄自动删 | 未实现 |
| Window identity | `windowId → host handle` 当前路由身份 | binding + projection | host-local private record；Agent 使用宿主能力 | 只有 unregistered projection |
| Pod | 显式授权的独立 Controller/Design/Test/product fleet | Pod records/service + Agent host effect | launch/materialization/receipt/Test access/close facts | 未实现 |
| Status/View/Verify | 一次 observation 的 config/storage/status/verification 投影 | observability | 只读 15 gates；不授权 repair | 未实现 |
| Explicit migration | 分类旧 source、映射新 ID/root、五阶段 forward recovery | bootstrap/migration owners | normal MCP 不可达 | 未实现，必须最后设计 |

## 5. 公共工具到 owner 的真实映射

当前旧 v3 的 31 项工具实际汇聚到以下 owner 家族：

| 工具组 | 工具 | Owner |
| --- | --- | --- |
| Workspace | `wakeflow_maintain_workspace` | maintenance action runtime |
| Window | `wakeflow_replace_windows`, `wakeflow_register_window`, `wakeflow_release_window_lock` | binding / lease services |
| Intake | `wakeflow_deliver`, `wakeflow_next_work`, `wakeflow_claim_next` | TODO service |
| Demand publication/task | `wakeflow_create_demand`, `wakeflow_add_task`, `wakeflow_continue_demand`, `wakeflow_intake_test_card` | publication / artifact / state services |
| Delivery | `wakeflow_prepare_delivery`, `wakeflow_record_delivery` | delivery orchestration；Controller-return 分支在 result-review |
| Result/review | `wakeflow_record_target_result`, `wakeflow_review_pack`, `wakeflow_reduce_results`, `wakeflow_decide_review` | result-review orchestration |
| Lifecycle | `wakeflow_complete_demand`, `wakeflow_cancel_demand`, `wakeflow_recover_state_transition` | lifecycle/state services |
| Evidence/archive | `wakeflow_record_evidence`, `wakeflow_archive`, `wakeflow_prune_runtime` | evidence/archive/retention owners |
| Storage | `wakeflow_storage_preserve` | preservation owner |
| Pod | `wakeflow_pod_open`, `wakeflow_pod_record`, `wakeflow_pod_bind`, `wakeflow_pod_plan` | Pod service |
| Read models | `wakeflow_status`, `wakeflow_view`, `wakeflow_verify` | observability/result trace |

Maintenance 与 Evidence 绕过普通 public-v3 route，各自拥有特殊公共组合器。这是职责差异，不应演化成三套 MCP 协议入口。

## 6. Authority 与物理存储

| 区域 | 旧 v3 authority | 关键边界 |
| --- | --- | --- |
| `wakeflow.config.json` | tracked desired model | 不含 host handle/live observation |
| `.wakeflow-active/current/` | TODO 与 active Demand business authority | Markdown 是 projection，除旧 TODO 外不应反向成为状态权威 |
| Demand root | identity、authority、state snapshot、event log、immutable artifacts、evidence | state/event/artifact 必须形成 exact closure |
| `.wakeflow-local/runtime/shared/` | lease 与 transport | 不保存 TargetResult；不决定业务接受 |
| `.wakeflow-local/runtime/hosts/<host>/` | binding、projection、host evidence/operations | 当前宿主私有；真实效果由 Agent 调用 |
| Ledger | Requirement、Confirmation、BusinessArchive | 长期可移植记录，不保存本机 handle/path |
| audit preservation | 隔离 retained bytes | normal runtime 不读取 payload 为 authority |

## 7. Demand 状态与事件逻辑

旧 v3 状态词汇：

```text
intake → planned → dispatched → waiting-results
→ review-ready → needs-rework / blocked
→ completed / cancelled → archived
```

旧 v3 持久化模型仍是：

```text
immutable artifacts
+ append-only controller events
+ mutable wakeflow-state.json snapshot
+ per-transition journal
```

这不是纯 Event Sourcing；event 与 state 同时是提交闭包。新 TS 已改为 append-commit Event Store + reducer + rebuildable snapshot，这是确认的技术重写。

当前 TS `DemandAggregateState` 把 Tasking、Delivery、Result、Testing、Review、Evidence 和 Pod 固定为空集合/null。它只支持 publication 与 cancel。进入 Tasking 前必须重新决定：

- 在未发布前直接完善 v1 state；或
- 删除没有真实事件支撑的 placeholder section；
- 不应为了已经实现 upcaster 而人为制造 v2。

## 8. TaskPackage、Delivery 与 Review 的业务不变量

### 8.1 TaskPackage

旧严格 TaskPackage 持有：

- objective、confirmed context、requirement refs；
- in/out/forbidden boundaries；
- completion expectations；
- acceptance anchors 与 review-input contract；
- stable window/repository assignment；
- dependency、replacement、continuation 与 TestCard lineage；
- commit expectation。

这些字段是产品业务语义，应从旧两个时期共同事实中剪枝，不按旧 Schema 原样复制。

### 8.2 Delivery

旧 v3 的正确时序为：

```text
plan
→ apply immutable group/packet/envelope + lease + prepared state
→ claim one send generation
→ Agent performs host effect
→ record immutable run + settlement state
→ rejected-before-send only: explicit rearm
```

`accepted`、`ambiguous`、`rejected-before-send` 是 transport 事实；它们都不是 TargetResult 或 Controller acceptance。

### 8.3 Review

正确分层：

```text
TargetResult
→ read-only group classification
→ immutable ReviewCandidate
→ Controller decision event
→ accept / rework / redesign / blocked
```

Candidate 不能替 Controller 决定；Test 也不能替 Controller 完成功能验收。

## 9. Window、Host 与 Pod 审查

### 9.1 应保留的事实

- logical `windowId` 与 current host handle 必须分离；
- binding generation/digest 防止旧 envelope/lease 误投递；
- title、cwd、repository name、tmux pane 不是身份；
- launch intent、materialization observation、creation receipt、binding 与 Pod state 是不同事实；
- `clientThreadId` 只能作为 pending recovery evidence，不能注册；
- host send/read/close 的观察不代表业务完成或不可逆资源撤销。

### 9.2 必须重写的 effect 边界

Codex Pod adapter 当前主要生成操作并解析 Agent 回执，方向正确。

Claude 旧实现存在与新用户决定冲突的代码：

- lifecycle 默认 adapter 在 Wakeflow 进程内调用 `tmux/claude`；
- transport owner 在 Wakeflow 进程内执行 tmux buffer/paste/readback；
- activity/locator 执行宿主进程探测；
- Claude Pod adapter 调用注入的 in-process create callback；
- shared Pod service 自行 `execFileSync(git ...)` 取得部分 Pod 观察。

新 TS 的统一边界固定为：

```text
Agent → Wakeflow plan/claim
Wakeflow → exact AgentHostAction
Agent → Codex/Claude/Pod host capability
Agent → Wakeflow observation/receipt
Wakeflow → validate + persist + reduce
```

Wakeflow 无权限且不得自行执行 create/send/read/close/worktree/session，也不得用 Bash/tmux wrapper 或 callback registry 隐藏执行。

## 10. Maintenance 与文件系统

旧 v3 用 6,482 行通用 Workspace Mutation Manager 组合 owner snapshots、aggregate steps、effects、recovery claims 与 terminal closure。

应保留：

- preview 零写；
- apply 前完整 rederive；
- Config 最后激活；
- intent/journal 可重启恢复；
- affected effect 前后 checkpoint；
- unknown residue fail closed；
- exact owner readback。

不应保留：

- 通用 callback/handler registry；
- 为所有领域统一 prepare/observe/commit/cleanup 形状；
- 把宿主 effect 纳入 Wakeflow transaction callback；
- 让 migration 与 normal maintenance 共用完整计划形状。

当前 TS 的专属 maintenance intent/journal、闭合 step dispatcher 和固定 host contribution 更小；未来业务跨 owner 写入仍应先由具体 consumer 证明共同语义。

## 11. Evidence、Archive、Retention 与 Preservation

旧 v3 已实现的业务语义应保留：

- Evidence 是 review input，不是真实性或接受结论；
- configured source 是 owner-neutral 观察，内部 evidence tree 才是 Wakeflow 私有 owner；
- privacy scan、content class、容量、manifest 与 relation closure；
- BusinessArchive 要求 completed/cancelled、关闭 task/Test/review、exact result/evidence/event/transport/TODO closure；
- Archive 不执行 host close，也不删除 transport；
- Transport retention 必须在 Archive 和 lease closure 后独立执行；
- Preservation 只能 exact preview/apply/recover/release，不按时间自动清理。

旧实现的物理形状和巨大交叉 validator 不应直接迁移。新 TS 已有 manifested tree transfer Foundation，应等待真实 Evidence event/state consumer 再实现领域层。

## 12. Observability 与公共视图

旧 observability 在一次 observation 中组合 config、layout、active、ledger、binding、runtime、maintenance、transport、lease、Pod、reconcile 与 Git，生成 config/storage/status/15 verification gates。

有价值的原则：

- read-only、零 repair；
- owner inventory 是来源；
- storage health 不授权删除；
- status next action 只是路由提示；
- projection 不是 authority；
- invalid/legacy/uninitialized 分开。

风险：

- 单文件理解全部 owner vocabulary；
- 新增 owner 必须同步扩大中央集合；
- 容易形成第二个业务解释器；
- Git/host probe 混入一个超大 observation。

新 TS 应按 owner read model 组合，不复制 2,475 行全知 aggregator。

## 13. Migration

旧 migration 具有 classifier→inventory→plan→owner drain→host decommission→five-phase apply→production composition 的完整候选链，并通过独立 bootstrap 与 normal runtime 隔离。

但审查确认：

- `wakeflow-legacy-archive-transform.mjs` 被 validator/package 强制保留，却没有 bootstrap/production producer；
- 多个 migration host effect 仍依赖 Wakeflow 内部 adapter/callback；
- 目标 TS 格式尚未完成，当前迁移计划不可能稳定；
- 旧 classifier catalog 与 origin fixtures 主要是历史证据，不是新 normal runtime 依赖。

结论：Migration 保持最后实施。先完成新 TS authority，再基于真实旧版本与用户选择设计一次性 bootstrap；不迁移当前五阶段 callback graph。

## 14. 无真实 production consumer 或应剪枝的表面

| 表面 | 当前事实 | TypeScript 处置 |
| --- | --- | --- |
| Keep-live writer API | service 有 ensure/start/stop/reconcile，但 normal MCP/host 没有 producer；只被 layout inspection 读取 | 删除候选；有真实自动化 consumer 再设计 |
| Legacy archive transform | 有 2,200 行 owner/participant，但没有 bootstrap/production caller | 不迁移；历史 fixture 留给未来 migration 研究 |
| `wakeflow-state-machine/*` Schema | 当前 v3 normal domain 使用 `wakeflow-demand-*`；旧 Schema 主要被 validator/fixture 固定 | 不进入新 normal runtime |
| Exact-export validator monolith | 6,417 行 validator 固定文件、导出与候选存在 | 改用 compiler/architecture/schema/package/focused integration gates |
| 手写 MCP server | 自行维护协议、版本、framing、tool dispatch | 删除；使用官方 `@modelcontextprotocol/server` v2 stdio |
| 旧 runtime subprocess dispatcher | MCP→Node script→argv/JSON/stdout | 删除；官方 MCP handler 直接调用 typed owner |
| Mutable controller host adoption | 渐进版存在，v3 已删除 | 保持删除；Agent/host 不成为业务 state owner |
| Wakeflow-internal Claude host effect | 生命周期/transport/activity/Pod callback 内执行 | 删除执行；保留 plan/observation semantics |

## 15. 测试与成熟度判断

当前旧树有 116 个根测试文件、至少 1,624 个静态 `test()` 声明；历史全门曾报告 1,821 个结果。测试对 accessor、symlink、hard-link、TOCTOU、crash prefix、recovery、capacity 和 privacy 的覆盖很强。

但存在以下边界：

- smoke 主要覆盖 fresh/reconcile/observability，不覆盖完整 S0→S6；
- 普通 public handler 测试覆盖 create-demand/TODO/evidence 等片段，没有一个 31-tool 真实完整业务闭环；
- 大量测试与 validator 证明候选文件存在和 exact export，不证明真实 producer/consumer；
- Claude host effect 测试证明旧 in-process tmux 实现自洽，但该执行模型已被用户否决；
- 当前 v3 大量代码在一个大提交中落地，测试通过不能替代实际演进与宿主运行证据。

新 TS 测试策略继续保持：

1. 单文件合同测试；
2. owner invariant/recovery 测试；
3. named consumer 垂直测试；
4. 每个公共工具家族至少一条官方 MCP stdio 集成；
5. 最终增加一条无真实 host effect 的 S0→S6 Agent-mediated scenario；
6. 真实 Codex/Claude host 测试单独授权。

## 16. 当前 TS 对照与处置

| 能力 | 当前 TS | 审查后处置 |
| --- | --- | --- |
| Foundation Data/Crypto/Identity/Time | 完成 | 保留，按 consumer 补缺口 |
| Rooted Filesystem/atomic/tree/Git | 完成较多 | 保留；禁止继续水平扩张 |
| Config v3 | 完成 | 保留；reconfigure move/decommission 后置 |
| TODO | append/claim/archive + JSON authority/projection | 保留新模型，不迁移旧 Markdown authority |
| Ledger Requirement/Confirmation | 完成 | 保留；BusinessArchive 后续扩展 |
| Demand Event Store | publication/cancel、snapshot、upcaster；Aggregate已收敛为identity+lifecycle | 保留技术方向；Tasking进入时重新决定state-model version |
| Maintenance | public preview/apply/recover + dual host composition + official MCP | 保留；不扩展为空工具dispatcher |
| Active | Fresh workspace 两投影 | 保留；per-Demand 等真实事件 |
| Managed content/support/Claude settings | 完成 | 保留；settings 是文件 owner，不是 host effect |
| Window launch/unregistered projection | 完成 | 保留；已由最小Window Host Binding registration消费 |
| TaskPackage/TestCard | 无 | 下一业务阶段 |
| Binding/Lease/Transport | Binding create/registered projection已完成；Lease/Transport无 | Binding仅服务Maintenance launch intent；Lease/Transport仍与Agent-mediated Delivery垂直实现 |
| TargetResult/Review/Lifecycle complete | 无 | Delivery 后实现 |
| Evidence/Archive/Retention | 只有通用 tree Foundation | Event/state consumer 后实现 |
| Pod | 无 | mainline Delivery 稳定后实现 |
| Observability | 无 | owner read models 稳定后组合 |
| MCP server | 官方SDK当前发布Maintenance与Window Host Binding两个真实工具 | 保留；后续只随真实owner扩展，不创建占位工具 |
| Migration/Cutover | 无 | 全功能完成后最后实施 |

## 17. 技术骨干闭合与强制核实节点

用户决定在真实业务实现前先完成技术层与骨干，并在
**技术骨干核实节点（Technical Skeleton Review Gate）** 强制暂停。

> 2026-08-28执行状态：§17.1四项均已完成，Gate已经到达并停止。最新实现、规模、
> authority、双制品、测试成本与defer清单见
> [TypeScript Technical Skeleton Review Gate](./wakeflow-typescript-technical-skeleton-review-gate-2026-08-28.md)。
> 本节后续候选不构成继续实施授权。

### 17.1 核实节点前允许实施的范围

1. **Official MCP + Single-source Dual Artifact Spine**
   先以已完成的Maintenance作为真实consumer，安装并使用官方`@modelcontextprotocol/server` v2 stdio能力，再从同一手写TS/Schema生成Codex与Claude两份最小可安装制品。固定host composition、版本来源、package inventory与无反向旧JS依赖；不创建31项占位工具，不自行实现协议/framing。

2. **Demand Core Skeleton Rebaseline**
   在已验证的运行/制品脊柱中删除或重构没有真实事件支撑的空 placeholder section；只保留identity、authority、publication、cancel、Event Store、snapshot与version evolution，不创建TaskPackage/Delivery等业务事实。

3. **Window Runtime Identity Skeleton**
   通过已建立的官方MCP/双制品入口闭合Agent host-create result→最小WindowHostBinding registration→registered/redacted projection。只服务已经存在的Maintenance launch intent；不实现Lease、Transport、send或Pod。

4. **Technical Verification And Test Cleanup**
   闭合typecheck、architecture、Schema/codegen、focused owner tests、Maintenance recovery smoke、official MCP stdio integration、双制品parity与package dry-run；删除陈旧/重复测试fixture，不运行或复制旧JS整套作为日常门。

### 17.2 核实节点明确排除的真实业务

- TaskPackage、target task与Tasking event；
- Window Lease、Dispatch Group/Packet/Envelope与Delivery Run；
- TargetResult、ReviewCandidate、Controller decision、complete/continue；
- TestCard、attempt与真实环境Test业务；
- Evidence event/state、BusinessArchive、Retention、Preservation业务；
- Pod state/evidence/lifecycle；
- 完整status/view/verify业务投影；
- Migration、旧制品切换与release。

### 17.3 到达节点时必须统一回顾的证据

1. TS模块/依赖/Schema/测试/LOC规模及变化趋势；
2. 每个生产模块的首个真实consumer，零consumer模块必须删除或显式defer；
3. Foundation→Configuration→Workspace→Host→Governance骨干依赖图；
4. Config、TODO、Ledger、Demand skeleton与Window identity的authority地图；
5. Codex/Claude双制品diff与Agent宿主效果边界；
6. 公共MCP实际工具清单、输入/输出Schema与错误/隐私边界；
7. 并发、CAS、crash recovery、durability与容量矩阵；
8. 旧两时期场景对照和全部未实现业务清单；
9. 测试维护成本、慢测试来源、重复fixture和完整门耗时；
10. 保留、重写、剪枝、删除、defer五类处置台账。

核实节点完成后必须结束当前实施阶段。不得在同一连续执行中自动进入业务文件；由用户统一review并重新选择业务顺序。

### 17.4 节点之后的未授权候选

以下只用于说明依赖，不构成当前计划：

```text
TaskPackage / Tasking
→ Agent-mediated Binding generation / Lease / Delivery
→ TargetResult / Review / Completion
→ Test Contract
→ Evidence / BusinessArchive
→ Owner read models / full public MCP
→ Pod
→ Migration / Cutover
```

## 18. 已冻结的用户决定

- 旧 JavaScript 只作功能逻辑参考，不决定 TypeScript 技术实现。
- 不新增 Owner–Resource Capability 中间路由层。
- 新 TypeScript MCP 使用官方稳定 `@modelcontextprotocol/server` 与 stdio transport，不维护协议 framing。
- Codex、Claude、Pod 的真实宿主能力全部由 Agent 调用；Wakeflow 只 plan/claim/validate/record。
- 先完成技术底座与骨干，在Technical Skeleton Review Gate强制暂停；未经用户统一review，不进入真实业务实现。
- 继续保持单文件讨论与聚焦测试；本次审查期间不实现下一 TS 文件。

## 19. 主要源码入口

### 当前旧 v3

- [`core/lib/wakeflow-mcp-tools.mjs`](../core/lib/wakeflow-mcp-tools.mjs)
- [`core/scripts/lib/wakeflow-public-v3-runtime.mjs`](../core/scripts/lib/wakeflow-public-v3-runtime.mjs)
- [`core/scripts/lib/wakeflow-workspace-mutation.mjs`](../core/scripts/lib/wakeflow-workspace-mutation.mjs)
- [`core/scripts/lib/wakeflow-demand-core-records.mjs`](../core/scripts/lib/wakeflow-demand-core-records.mjs)
- [`core/scripts/lib/wakeflow-demand-state-service.mjs`](../core/scripts/lib/wakeflow-demand-state-service.mjs)
- [`core/scripts/lib/wakeflow-demand-artifact-service.mjs`](../core/scripts/lib/wakeflow-demand-artifact-service.mjs)
- [`core/scripts/lib/wakeflow-delivery-orchestration.mjs`](../core/scripts/lib/wakeflow-delivery-orchestration.mjs)
- [`core/scripts/lib/wakeflow-result-review-orchestration.mjs`](../core/scripts/lib/wakeflow-result-review-orchestration.mjs)
- [`core/scripts/lib/wakeflow-evidence-importer.mjs`](../core/scripts/lib/wakeflow-evidence-importer.mjs)
- [`core/scripts/lib/wakeflow-business-archive-service.mjs`](../core/scripts/lib/wakeflow-business-archive-service.mjs)
- [`core/scripts/lib/wakeflow-pod-service.mjs`](../core/scripts/lib/wakeflow-pod-service.mjs)
- [`core/scripts/lib/wakeflow-observability-v3.mjs`](../core/scripts/lib/wakeflow-observability-v3.mjs)

### 宿主

- [`plugins/codex-wakeflow/scripts/lib/wakeflow-codex-pod-host.mjs`](../plugins/codex-wakeflow/scripts/lib/wakeflow-codex-pod-host.mjs)
- [`plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-lifecycle.mjs`](../plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-lifecycle.mjs)
- [`plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-transport.mjs`](../plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-transport.mjs)
- [`plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-pod-host.mjs`](../plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-pod-host.mjs)

### 当前 TS

- [`src/governance/demand/`](../src/governance/demand/)
- [`src/governance/todo/`](../src/governance/todo/)
- [`src/governance/ledger/`](../src/governance/ledger/)
- [`src/workspace/maintenance/`](../src/workspace/maintenance/)
- [`src/workspace/window-runtime/`](../src/workspace/window-runtime/)
- [`src/entrypoints/`](../src/entrypoints/)
