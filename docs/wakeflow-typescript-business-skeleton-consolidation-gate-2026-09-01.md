# Wakeflow TypeScript Business Skeleton Consolidation Gate

> 文档结构：第1至12节保留早期5工具节点的历史证据；当前结论以第13节为准。
> 当前状态：`technical-and-business-skeleton-verified / consolidation-decision-required`
> 日期：2026-09-01
> 前序状态：`reached / ts-development-gate-passed / user-review-required`
> 基线提交：`8e0be68 feat: add event-sourced target task planning`
> 当前分支：`main`，相对`origin/main` ahead 7
> Owner：Wakeflow Source Maintenance / Controller application review
> 上游记录：[TypeScript逐文件审阅台账](./wakeflow-typescript-file-review-ledger-2026-08-28.md)

## 1. 结论

本节点确认：新版TypeScript项目已经从Technical Skeleton推进到一条完整的内部业务骨干，并闭合首个Route驱动的Implementation Delivery
Preparation公共纵切。当前正确方向不再是扩张Foundation或继续增加内部Testing状态，而是按Controller Route逐项公开既有owner。

本节点通过的内容包括：

1. Foundation、Configuration、Workspace、TODO、Ledger与本地文件Event Sourcing继续形成单向技术底座；
2. Tasking、Implementation Delivery、Claim/Outcome/Rearm、Result、Review、Testing、Completion与产品缺陷复测形成内部Event-sourced业务链；
3. `DemandControllerRoute`把当前Event/Review事实投影为typed责任前沿，不成为第二写权威；
4. 官方MCP已有五项真实工具，其中`wakeflow_prepare_implementation_delivery`从Service、wire、Coordinator闭合到双宿主candidate；
5. 当前198份`.test.ts`从当前源码清单执行，完整838项通过；
6. Architecture、Schema/codegen、全量格式、双宿主静态闭包与官方stdio均通过。

这不是release gate。旧JS等价、正式plugin同步、validator/smoke、安装cache、版本、tag和发布均未进入本节点。

## 2. 本节点边界

### 2.1 纳入

- 当前TypeScript源码、Schema、generated contracts与测试；
- 当前大型未提交业务波次相对`8e0be68`的系统关系；
- Node 24下完整TypeScript source-manifest测试；
- dependency-cruiser边界、循环依赖与生产叶子；
- 官方MCP五工具、Codex/Claude composition与candidate artifact；
- 测试重复、陈旧断言与格式噪声；
- 当前公开能力、内部能力与明确缺口的分离。

### 2.2 明确排除

- `core/`、`plugins/`、旧`tools/`与旧`test/`的行为修改；
- `npm test`、`check:core`、正式Codex/Claude plugin validator与smoke；
- 旧JS到新TS的E3等价矩阵和E4切换；
- commit、push、tag、publish和安装cache刷新；
- Claim公共工具、Evidence、Archive、Preservation、Pod或Migration的新实现；
- 外部未跟踪目录`wakeflow-architecture-atlas/`。

## 3. 当前架构骨干

```text
JSON Schema 2020-12
  → generated structural types + frozen runtime Schema
  → strict domain codecs / immutable plans

Foundation
  passive data · canonical JSON · crypto · typed identity · time
  rooted filesystem · stable read · atomic write · lock · tree · Git observation
      ↓
Configuration / Workspace
  Config authority · resource matrix · Maintenance transaction
  TODO · Ledger · Window Binding · shared coordination layout
      ↓
Demand Event Sourcing
  append-only local commit files · snapshots · upcasters · repository audit
      ↓
Tasking → Delivery → Result → Review → Testing / Completion
      ↓
Demand Controller Route
      ↓
Public Contract / Coordinator
      ↓
Official MCP Server
      ↓
Fixed Codex / Claude composition roots and candidate artifacts
```

硬边界仍成立：

- Foundation不依赖Configuration、Workspace、Governance、Host或Entrypoint；
- Governance不导入Codex/Claude实现，不调用tmux、Git CLI、Node子进程或宿主消息API；
- Host差异只通过固定Profile与entrypoint wrapper注入；
- Agent执行真实宿主能力，Wakeflow只生成Action、接收Observation并持久化自己的authority；
- Route、Snapshot与Projection都是可重建读模型，不是写许可；
- Tooling和Tests不进入候选制品生产闭包；
- 当前依赖图没有循环。

## 4. 当前Event-sourced业务范围

当前Event registry拥有14个家族：

```text
publication.demand-published
lifecycle.demand-cancelled
lifecycle.demand-completed
tasking.target-task-planned
delivery.target-delivery-prepared
delivery.target-host-effect-claimed
delivery.target-host-effect-observed
delivery.target-host-effect-rearmed
result.target-result-recorded
review.target-result-decided
review.target-result-resumed
review.product-defect-remediation-authorized
testing.test-card-created
testing.test-delivery-prepared
```

`delivery.target-delivery-prepared`当前写版本为v3，`testing.test-card-created`为v2；旧版本通过read-time upcaster进入当前domain
projection。Aggregate只保存下一项决定需要的最小摘要，完整TaskPackage、Intent、Claim、Observation、Result、Decision、Card等继续留在Event
data或create-only投影中。

内部链已经覆盖：

```text
Target Task Planning
→ Delivery Preparation
→ WindowWorkClaim + Agent Host Action
→ Host Effect Observation
→ accepted/indeterminate Result Import OR rejected explicit Rearm
→ Controller Implementation Review
→ accept / rework / redesign / blocked+resume
→ controller-only Completion
   OR real-environment TestCard / Test Task / Test Delivery
→ Test Claim / Outcome / replacement or rerun attempt
→ Test Result / Controller Test Review
→ Completion OR product-defect remediation → product rework → new Test generation
```

真正宿主发送仍不在Wakeflow进程内。

## 5. 当前Controller与公共MCP表面

`wakeflow_inspect_demand_route`是公共只读中间层。它返回稳定排序的并行frontier与typed blocker，并让每个写owner继续重读自己的完整
authority。

当前两个候选制品精确发布五项工具：

| Tool                                       | 当前能力                                    | 写入/宿主边界                                           |
| ------------------------------------------ | ------------------------------------------- | ------------------------------------------------------- |
| `wakeflow_maintain_workspace`              | preview/apply/recover Workspace技术资源     | 可修改Wakeflow-owned资源；不执行host effect             |
| `wakeflow_register_window_binding`         | 登记Agent观察到的opaque host handle         | 私有Binding no-replace；不创建窗口                      |
| `wakeflow_plan_target_task`                | preview/apply一份Implementation TaskPackage | Event append + create-only projection；不Delivery       |
| `wakeflow_inspect_demand_route`            | 读取当前责任frontier                        | 零写、非许可、非acceptance                              |
| `wakeflow_prepare_implementation_delivery` | preview/apply不可变Delivery Intent          | 只追加Preparation Event；零Claim、零Host Action、零发送 |

当前公开链在`implementation-host-effect-claim`停止。这是诚实能力边界，不使用旧JS大工具、action switch或隐藏fallback绕过。

## 6. 规模与复杂度

| 区域                        |                       文件数 |    行数 | 结论                                |
| --------------------------- | ---------------------------: | ------: | ----------------------------------- |
| 手写`src/`（排除generated） |                          321 | 114,829 | 已进入必须consumer-driven收敛的规模 |
| Foundation                  |                           62 |  21,076 | 禁止无consumer横向扩张              |
| Configuration               |                           10 |   3,355 | 保持当前Config v3 authority         |
| Workspace                   |                           81 |  27,698 | Maintenance仍是最大技术事务面       |
| Governance                  |                          146 |  59,387 | 业务骨干主体；后续优先公开与剪枝    |
| Hosts                       |                           11 |   2,130 | 只保留固定差异                      |
| Entrypoints                 |                           10 |     969 | 五工具薄适配层                      |
| Generated contracts         |                           75 |   8,435 | Schema派生，禁止手改                |
| JSON Schema                 |                           75 |  14,015 | domain + self-contained MCP wire    |
| Test sources                | 198 `.test.ts` + 23 fixtures |  49,902 | 完整门成本需要持续观察              |

业务骨干中`controller/delivery/lifecycle/result/review/testing`合计约31K行。最大文件来自严格parser、Relation closure与Service恢复流程，
不是UI或重复manager。当前未发现TODO/FIXME、动态host registry或第二状态机，但继续增加同层状态会放大维护成本，因此R-2B保持冻结。

## 7. 测试收束与即时修正

第一次完整门结果：

```text
838 total / 835 pass / 3 fail / 0 skip
```

三项失败全部位于`wakeflow-maintenance-execution-transaction.test.ts`。实现、Preview与直接Step Executor已经包含新增的
`coordination:shared-layout`步骤；Transaction测试仍复制旧的“总计14步”和“第二步就是Active Layout”假设。

修正方式不是把14机械改成15：

- 完成回执数量改为与当前不可变Plan的`steps.length`闭合；
- effect-before-checkpoint场景按`stepId === "core:active-layout"`定位目标；
- 在目标前依次执行Plan声明的所有前置步骤，不再依赖数组位置；
- Preview测试继续精确断言15种步骤及顺序，因而新增/删除步骤仍有单一行为检测点。

相邻21项Maintenance transaction/preview/executor测试通过后，第二次完整门结果：

```text
838 pass / 0 fail / 0 cancelled / 0 skip
duration: 216.84971075s
```

本轮还把全部当前变更/新增的手写TS与JSON统一经过Prettier，排除generated、历史文档、旧JS/plugin与外部Atlas。这样后续review diff不再
混入逐文件积累的格式噪声。

全量门中最慢的是产品缺陷修复、Test Review/Delivery/Claim、Completion和Maintenance恢复等真实磁盘纵切；它们在并行负载下可达到
20–40秒。当前没有证据支持删除这些崩溃恢复与CAS测试。后续优化应共享只读fixture前缀或减少同层重复初始化，但不得降低真实恢复、
并发、Claim释放或Event authority证据。

## 8. 生产叶子审查

对`src`单独运行dependency-cruiser，共发现22个没有其他`src` dependent的文件；全部可解释且有直接测试：

### 8.1 两个candidate artifact roots

- `src/entrypoints/codex-wakeflow-mcp.ts`
- `src/entrypoints/claude-code-wakeflow-mcp.ts`

它们由artifact builder消费，不是死代码。

### 8.2 十二个待公开业务owner

- Target Claim、Outcome、Rearm三个Service；
- Demand Publication与Completion Service；
- TargetResult Import Service；
- Implementation Review、Test Review、Product Defect Remediation、Review Resume四个Service；
- TestCard Planning与Test Delivery Preparation两个Service。

这些owner共同组成已经验证的内部业务链，并被Controller Route或相邻流程明确命名。当前处置为`defer public wiring`，不得批量注册工具，也
不得因为没有production import就误删。每次只在Route抵达其frontier时重新审阅公共边界。

### 8.3 八个技术owner或Foundation候选

- Config replacement recovery；
- Loaded Artifact transfer candidate/publication；
- Maintenance orphan/prepared recovery；
- Gitignore、Program Instruction与Support Memory recovery。

它们拥有明确恢复或Artifact职责并有直接测试，但未全部进入当前candidate闭包。处置为`retain outside public closure / re-audit at first
consumer`。若Evidence/Archive仍不消费Loaded Artifact transfer，应在该阶段再次选择接入或删除，不继续扩展其表面。

## 9. 静态与候选制品证据

```text
Node: v24.19.0
TypeScript: pass
Architecture: parser=swc / 621 modules / 4461 dependencies / 0 violations
Circular dependencies: 0
Schema: 75 schemas / 207 external catalog refs
Schema digest: sha256:527e984319ea3760c077c1e28941e8bc8d920ac47befeee38dc6b3b737a0908e
Prettier changed/new TS+JSON: pass
git diff --check: pass
```

最终candidate build：

| Host        | Compiled files | External packages                                                | Manifest digest                                                           |
| ----------- | -------------: | ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Codex       |            317 | `@modelcontextprotocol/server`, `ajv`, `canonicalize`, `p-limit` | `sha256:07f80120c1a877fbb0b8358a65fac6e5b33c291f62ff36a196996d9568c12bbc` |
| Claude Code |            322 | 上述依赖 + `jsonc-parser`                                        | `sha256:126600fc8869826d323853eff9bb613b87d8990bbfa973c0c9de9f6e49294d1a` |

两份candidate均为`releaseEligible:false`，官方stdio Client列出完全相同的五工具集合。

## 10. 明确能力缺口

以下内容仍未公开或未实现，不能由内部测试数量推断为可用产品能力：

- `wakeflow_claim_target_host_effect`及后续Agent Action公共边界；
- Host Effect Outcome、Rearm、Result Import和Controller Review公共入口；
- TestCard/Test Task/Test Delivery/Test Review与Completion公共入口；
- Research Completion owner；
- redesign后的Authority supplement/replacement lineage公共流程；
- Demand create/cancel/continue的完整新TS公共生命周期；
- Evidence、BusinessArchive、Retention、Preservation、Pod和Migration；
- Controller-return transport；
- 正式plugin asset、完整旧JS功能等价、切换与发布。

## 11. 仓库状态与隔离项

- 当前`HEAD`仍为`8e0be68`，之后的业务骨干是大型未提交工作树；
- 当前有60个tracked modified文件与219个本项目untracked文件（包含本文）；
- 外部未跟踪`wakeflow-architecture-atlas/`有48个文件，不属于本checkpoint；
- `core/`、`plugins/`、旧`tools/`与旧`test/`没有本波次diff；
- 历史`wakeflow-typescript-technical-skeleton-review-gate-2026-08-28.md`存在一份预先已有的两行异常文本diff，本节点没有修改或吸收到新checkpoint；
- 没有commit、push、tag、publish、plugin sync或cache refresh。

任何后续提交前都必须先明确排除Atlas与历史Gate异常diff，不能把它们夹带进TS业务提交。

## 12. 下一决策

当前推荐下一项是对`wakeflow_claim_target_host_effect`做公共边界预审，而不是直接编码。必须先决定：

1. 一个共享工具是否同时承载Implementation与Test两种已有Claim owner变体；
2. Agent提交的当前Host Observation如何与私有Binding、logical root和Claim CAS闭合；
3. 首次committed才返回的瞬时Agent Host Action如何表达，为什么幂等重放不得再次返回Action；
4. Action中的absolute workspace root只进入本次prompt、raw handle仍不返回的公开隐私边界；
5. `claimAuthority`与`eventAuthority`双轴错误如何进入MCP envelope；
6. 工具annotations与“调用后必须由Agent执行宿主效果、最多一次readback”的停点。

该预审需要先给用户方案选择。未确认前不创建Claim Schema、Coordinator或MCP工具。

## 13. 当前技术骨干核实节点（17工具 / 901测试）

### 13.1 当前结论

本节点基于当前真实源码、99份Schema、17个MCP工具、14个Event家族、双host候选闭包与一次完整TS源清单测试重新核实。结论如下：

1. 对“已经存在的Workspace与Demand”，Route驱动执行骨干已经闭合；所有当前可执行软件owner均有Public Tool或明确Agent Host边界；
2. Route、Review Snapshot、Window Runtime projection仍只是不持久的读模型，没有出现第二写权威；
3. Event revision/state digest/CAS、typed identity和当前Binding继续拥有因果权威；墙钟只剩TODO排序与明确的Claim freshness策略；
4. 14个Event家族均有测试引用，当前11个生产叶子均可解释，没有发现孤立Review/Delivery/Test Service；
5. 新TS仍不是完整产品入口：Demand Publication Service尚未公开，无法仅使用当前17工具从零创建一份Demand；Research Completion与Implementation Redesign继续显式阻断；
6. 当前首要风险已从“缺少基础能力”转为“测试与MCP装配文件过大、Route矩阵直接覆盖不足”。继续新增工具前应先做小型维护收敛。

本结论不是release或旧JS等价结论。正式plugin资产、旧JS功能等价、切换、validator/smoke、安装cache、版本和发布均不在本节点。

### 13.2 Route→Owner→Public能力矩阵

| Route frontier | Owner | 当前执行边界 | 状态 |
| --- | --- | --- | --- |
| `implementation-task-planning` | target-task-planning | `wakeflow_plan_target_task` / implementation | closed |
| `research-completion-required` | demand-lifecycle | 无实现；Route blocker | explicit gap |
| `demand-completion-preflight` | demand-completion | `wakeflow_complete_demand` preview/apply | closed |
| `test-card-planning` | test-card-planning | `wakeflow_plan_test_card` preview/apply | closed |
| `test-task-planning` | test-task-planning | `wakeflow_plan_target_task` / test派生 | closed |
| `implementation-delivery-planning` | target-delivery-preparation | `wakeflow_prepare_implementation_delivery` | closed |
| `implementation-host-effect-claim` | target-host-effect-claim | `wakeflow_claim_target_host_effect` | closed |
| `implementation-host-effect-execution` | agent-host | Agent执行Action；随后`wakeflow_record_target_host_effect_outcome` | intentional host seam |
| `implementation-target-result-import` | target-result-import | `wakeflow_import_target_result` | closed |
| `implementation-host-effect-rearm` | target-host-effect-rearm | `wakeflow_rearm_target_host_effect` | closed |
| `implementation-result-review` | controller-implementation-review | Inspect + `wakeflow_record_controller_implementation_review_decision` | closed |
| `implementation-review-resume` | controller-target-review-resume | Inspect + `wakeflow_resume_target_result_review` | closed |
| `implementation-redesign-required` | design | 明确Design blocker；当前无同Demand公共redesign交付 | explicit gap |
| `test-delivery-planning` | test-delivery-preparation | `wakeflow_prepare_test_delivery` / initial | closed |
| `test-host-effect-claim` | target-host-effect-claim | `wakeflow_claim_target_host_effect` / test | closed |
| `test-host-effect-execution` | agent-host | Agent执行Action；随后Outcome recorder | intentional host seam |
| `test-target-result-import` | target-result-import | `wakeflow_import_target_result` / test | closed |
| `test-result-review` | controller-test-review | Inspect + `wakeflow_record_controller_test_review_decision` | closed |
| `test-delivery-rerun-planning` | test-delivery-preparation | `wakeflow_prepare_test_delivery` / rerun | closed |
| `product-defect-remediation-authorization` | controller-product-defect-remediation | `wakeflow_authorize_product_defect_remediation` | closed |
| `test-review-resume` | controller-target-review-resume | Inspect + shared Resume | closed |
| `test-delivery-replacement-planning` | test-delivery-preparation | `wakeflow_prepare_test_delivery` / rejected replacement | closed |

Cross-cutting工具另外包括：

- `wakeflow_maintain_workspace`：Workspace技术事务；
- `wakeflow_register_window_binding`：Agent观察后的私有Host identity注册；
- `wakeflow_inspect_demand_route`：零写责任前沿；
- `wakeflow_record_target_host_effect_outcome`：Agent Host frontier完成后的事实记录，不执行效果。

矩阵证明当前Route没有把未实现软件owner伪装为可执行：Research、Redesign保持blocker，真实宿主执行保持Agent seam。

### 13.3 Event与authority核实

当前Event registry仍为14个家族：

```text
publication.demand-published
lifecycle.demand-cancelled
lifecycle.demand-completed
tasking.target-task-planned
delivery.target-delivery-prepared
delivery.target-host-effect-claimed
delivery.target-host-effect-observed
delivery.target-host-effect-rearmed
result.target-result-recorded
review.target-result-decided
review.target-result-resumed
review.product-defect-remediation-authorized
testing.test-card-created
testing.test-delivery-prepared
```

所有家族在当前测试源中均有直接引用。业务因果继续由Event顺序、state digest、expected stream revision和确定性Commit identity闭合；跨authority墙钟准入已全部删除。保留的两项时间策略性质不同：

- TODO `createdAt`仅用于确定性展示排序；
- Claim observation执行明确`0..5分钟`freshness，失败只要求重新观察且保持零写。

### 13.4 Foundation与生产叶子

`src`生产依赖图当前有11个无其他生产dependent的叶子：

```text
2 candidate roots:
  entrypoints/codex-wakeflow-mcp.ts
  entrypoints/claude-code-wakeflow-mcp.ts

1尚未公开的真实业务owner:
  governance/demand/publication/demand-event-sourcing-publication-service.ts

8技术/恢复owner:
  configuration/wakeflow-config-authority-replacement-recovery.ts
  foundation/artifact/loaded-artifact-tree-transfer-candidate.ts
  foundation/artifact/loaded-artifact-tree-transfer-publication.ts
  workspace/maintenance/wakeflow-maintenance-orphan-gate-recovery.ts
  workspace/maintenance/wakeflow-prepared-maintenance-recovery.ts
  workspace/managed-integration/wakeflow-gitignore-recomposition-recovery.ts
  workspace/managed-integration/wakeflow-program-instruction-recomposition-recovery.ts
  workspace/support/wakeflow-support-memory-recovery.ts
```

没有发现应立即删除的孤立Service。Loaded Artifact transfer是此前明确确认的Evidence/Archive前置能力，当前处置为`retain frozen / re-audit at first real consumer`：不继续扩张，也不在consumer到来前增加适配层。

Demand Publication Service是真实下一业务缺口，不是死代码；它目前只有测试消费，意味着当前MCP骨干假设Demand已经存在。

### 13.5 当前规模

| 区域 | 文件 | 行数 |
| --- | ---: | ---: |
| 手写`src/*.ts`（排除generated） | 363 | 122,565 |
| Governance | 170 | 65,581 |
| Workspace | 81 | 27,750 |
| Foundation | 62 | 21,138 |
| Entrypoints | 28 | 2,375 |
| Generated contracts | 99 | 11,814 |
| JSON Schema | 99 | 25,650 |
| `.test.ts` | 220 | 56,705 |
| Test fixtures | 22 | 2,357 |

最大生产文件：

```text
demand-aggregate-state.ts                 3,089
wakeflow-public-mcp-server.ts             1,764
demand-event-sourcing-repository.ts       1,707
demand-event-sourcing-decider.ts          1,656
target-delivery-intent.ts                 1,211
```

最大测试文件：

```text
wakeflow-public-mcp-server.test.ts        3,889
wakeflow-maintenance-execution-transaction.test.ts 1,143
mcp-wire-schema-self-contained.test.ts    1,073
test-delivery-preparation-service.test.ts             766
controller-product-defect-remediation-service.test.ts 649
```

生产大文件当前主要集中在显式领域union、codec、Event reducer与恢复流程，未发现可无证据拆分的重复manager。测试侧A1/A2已把MCP测试的位置参数、默认executor、Client/Transport生命周期和文本内容读取收敛到唯一fixture；A4又把Product Remediation纵切移回Service owner。主MCP测试仍有3,889行，但已建立共享装配边界；不再存在Test Decision文件跨owner持有Remediation全链的问题。

### 13.6 Route测试证据（A3已闭合）

`DemandControllerRoute`的22种frontier现由真实构建路径使用的三个纯descriptor resolver统一映射，并由无I/O表驱动测试直接覆盖：

```text
Demand condition：2种frontier
Implementation phase：8种frontier
Post-Acceptance stage：12种frontier
合计：22种唯一frontier kind
```

共享同一frontier的多个phase仍逐项列出；`accepted`单独证明为`null`。测试还以条件类型证明Demand condition、除`accepted`外的Implementation phase及全部ready Post-Acceptance status没有遗漏。未来扩展这些union而未补矩阵会在TypeScript阶段失败，不再依赖耗时磁盘纵切偶然发现映射漂移。

### 13.7 当前验证证据

```text
Node: v24.19.0
npm: 11.17.0
TypeScript source-manifest full gate（A1–A4完成后）：
  902 pass / 0 fail / 0 cancelled / 0 skip
  duration: 325.564075125s
Route/Post-Acceptance focused:
  14 pass / 0 fail / 0 skip
Shared MCP focused:
  39 pass / 0 fail / 0 skip
Test Decision + Product Remediation owner surface:
  7 pass / 0 fail / 0 skip
Schema: 99 / 207 external refs
Schema digest: sha256:6b61ae4c9c1c009cc40573e33c26069db58fcd8dcc8cbbc4ccc6c0ed39f26daf
Architecture: parser=swc / 710 modules / 4967 dependencies / 0 violations
```

双host候选制品仍为`releaseEligible:false`：

| Host | Files | Manifest digest |
| --- | ---: | --- |
| Codex | 419 | `sha256:f521441e24d214c7e8a820b0f3ce7cb2eed07f867c675b8ac1b24c8f1cf821d7` |
| Claude Code | 424 | `sha256:c37e56c5f14816f287c524c5de3adecc4d71e982c3b7ca712c2af8ecff4f94f6` |

### 13.8 仓库隔离

- `HEAD=8e0be68`，`main`相对`origin/main` ahead 7；
- 当前Git状态有68个tracked change与145个untracked entry；
- 外部`wakeflow-architecture-atlas/`有48个文件，继续排除；
- `core/`、`plugins/`、旧`tools/`、旧`test/`没有当前diff；
- 历史Technical Skeleton Gate已有两行异常diff，本节点仍未修改；
- 没有commit、push、tag、publish、plugin sync或cache refresh。

### 13.9 下一步待选方案

#### A. 先做测试与Route收敛（推荐）

按文件单元依次完成：

1. **已完成**：把MCP测试`connect(...)`的18个位置参数改为exact override object，保留默认executor与配置Proxy覆盖；
2. **已完成最小边界**：建立唯一MCP测试fixture，统一SDK连接、清理、fail-fast executor和文本读取；尚不复制领域样例或机械拆文件；
3. **已完成**：建立22项轻量Route frontier→owner→phase表驱动证据，重型纵切只保留恢复/CAS/真实I/O职责；
4. **已完成**：把Product Remediation完整纵切从Test Decision Service测试移回自己的owner测试文件。

方案A已经完成。测试装配、Route矩阵和owner归属均已收敛，下一业务切片可以进入Demand Publication Public。

#### B. 直接进入Demand Publication Public

把已有Publication Service公开为从TODO/Demand Authority到首个Route的入口，开始补齐“从零创建Demand”的产品链。A1–A4已先处理共享MCP装配、完整Route直接覆盖和跨owner测试归属，因此此前主要测试代价已经降低。

#### C. 转入Evidence/Archive并消费Loaded Artifact transfer

优点是首次消费冻结的Artifact transfer Foundation；代价是Demand创建、Research/Redesign和测试债务仍未解决，当前业务闭环顺序不如A→B自然。

方案A现已完成；下一步按推荐顺序进入B。Evidence/Archive在Demand生命周期入口稳定后再进入，此节点仍不建议扩张Foundation。

### 13.10 A1：MCP测试调用边界收敛

本单元只修改`tests/entrypoints/wakeflow-public-mcp-server.test.ts`的测试辅助层，没有修改生产实现、Schema或公共协议：

- 从`createWakeflowPublicMcpServer`的真实options类型推导完整executor集合与exact override类型，不复制维护17个独立函数签名；
- `connect(t, overrides)`以具名字段覆盖默认executor，30个调用点只声明该测试真正替换的能力，参数顺序不再携带隐式语义；
- 17个默认executor统一fail-fast；任何未显式声明的跨工具调用都会立即暴露，而不会被占位成功结果掩盖；
- 保留composition配置Proxy与额外字段拒绝证据；
- 文件由4,221行降至4,028行，减少193行；这只是消除机械调用成本，尚未把catalog、真实纵切和错误envelope拆成独立职责。

验证结果：

```text
Shared MCP server: 39 pass / 0 fail / 0 skip
TypeScript: pass
Architecture: pass / parser=swc / 707 modules / 4956 dependencies / 0 violations
Prettier: pass
git diff --check: pass
```

后续评估与实现见13.11；A2选择建立唯一fixture边界，没有为了缩短文件复制17份server装配或领域fixture。

### 13.11 A2：唯一MCP测试fixture边界

新增`tests/entrypoints/wakeflow-public-mcp-server.fixture.ts`，只拥有协议测试装配，不拥有任何领域结果样例或业务预期：

```text
真实Public Server options类型
→ 17个fail-fast executor默认值
→ 单能力exact override
→ 官方Client + InMemoryTransport连接
→ 自动清理或显式close
→ 唯一文本内容块读取
```

主测试中的30个单能力连接、8个真实纵切/双host连接和152个文本读取点现在复用该fixture。连接建立中途失败时fixture也会成对尝试关闭Client与Server；真实纵切继续在自己的`finally`中先关闭协议连接、再清理临时workspace；node:test单能力测试继续由`t.after`自动关闭。没有抽取领域result builder、请求样例、route判断或错误期望，因此fixture不会成为第二套行为权威。

规模变化：

```text
主MCP测试：4,028 → 3,889（-139）
新增fixture：126
两文件合计：4,015（相对A1再减少13）
相对技术核实节点4,221行：合计减少206
```

验证结果：

```text
Shared MCP server: 39 pass / 0 fail / 0 skip
TypeScript: pass
Architecture: pass / parser=swc / 708 modules / 4958 dependencies / 0 violations
Prettier: pass
git diff --check: pass
```

A2在“建立清晰helper边界”处收束，不继续做无证据的物理拆分。A3实现与验证见13.12。

### 13.12 A3：Controller Route完整责任矩阵

`demand-controller-route.ts`新增三个属于Controller Route owner的纯descriptor resolver：

```text
Demand condition → demand-scoped frontier descriptor
Implementation Target phase → target-scoped frontier descriptor | null
ready Post-Acceptance status → demand/target-scoped frontier descriptor
```

真实`routeBasis`、Implementation frontier组装和Post-Acceptance frontier组装均直接调用这些函数；它们不是测试专用导出，也没有建立第二张运行时映射表。Target引用、redesign blocker、Post-Acceptance关系复验、排序、digest和disposition仍由原Route构建流程拥有。

新增`demand-controller-route-frontier-matrix.test.ts`，以22项责任矩阵验证唯一`kind + owner + scope`，并逐项执行合并phase。矩阵具有编译期覆盖证明，运行时间约2 ms且不创建workspace；真实I/O、CAS、恢复及公共Schema继续由原纵切验证。

```text
Pure frontier matrix: 1 pass / 0 fail / 0 skip
Focused total including matrix: 14 pass / 0 fail / 0 skip
TypeScript: pass
Architecture: pass / parser=swc / 709 modules / 4959 dependencies / 0 violations
Prettier: pass
git diff --check: pass
```

当前变化为一个有界业务策略面：Route文件由652行增至703行，新矩阵测试366行；它只会在真实新增condition、phase、status或frontier时增长，不随MCP consumer数量增长。本单元没有修改Schema、Event、持久化字节、MCP工具或旧JS，也没有重跑全量源清单门。

下一步见13.13；A4已完成owner测试归位。

### 13.13 A4：Product Defect Remediation测试归位

原`controller-test-review-decision-service.test.ts`包含一条从Test缺陷Decision一路执行Remediation Authorization、产品返工Delivery、Host Effect、Result Import、Controller acceptance、新TestCard和新Test Task的完整纵切。该链的被测owner是`ControllerProductDefectRemediationService`，继续留在Test Decision文件会让生产者测试承担消费者全生命周期。

本单元新增`controller-product-defect-remediation-service.test.ts`并原样迁移该纵切；Test Decision文件只保留`accept`和`request-another-attempt`两条自身职责。新的owner测试仍复用现有Test Decision fixture作为前置生产者状态，没有为了单个consumer增加一层Remediation fixture包装。

分层证据保持独立：

```text
Authorization unit：结构、排序、digest与失败检查关系
Remediation Service vertical：Event、CAS/idempotency、Aggregate、返工与retest代际
Public Coordinator：公共请求、隐私、Route选择与错误映射
Test Decision Service：accept与another-attempt准入
```

规模变化：

```text
Test Decision Service test：854 → 222
Product Remediation Service test：新增649
两文件合计：871（净增17行，仅为独立import/常量边界）
```

```text
Test Decision + Remediation Service: 3 pass / 0 fail / 0 skip
Authorization + Public Coordinator: 4 pass / 0 fail / 0 skip
Owner surface total: 7 pass / 0 fail / 0 skip
TypeScript: pass
Architecture: pass / parser=swc / 710 modules / 4967 dependencies / 0 violations
Prettier: pass
git diff --check: pass
```

本单元没有修改生产代码、Schema、Event、持久化字节、MCP工具或旧JS。方案A至此完成；下一单元应在进入Demand Publication Public前先review已有Publication Service、Schema邻接需求与首个Route消费边界，再确定B的第一文件单元。

### 13.14 B：Demand Publication Public闭合

方案B已经按“先确认owner边界，再公开真实纵切”的顺序完成，并进入实现提交`f7c005d`。旧JS只用于确认产品场景；
新的公共合同、TypeScript分层和恢复语义由当前TS Domain、Foundation与官方MCP边界决定。

#### 调用方与owner字段分界

公共preview只接收调用方真正拥有的事实：

```text
todoId
title / goal / completionDefinition
executionPlacement
Ledger member selections: { recordId, memberPath }
```

调用方不能提供Program、Demand类型、testing决定、完整Ledger引用、摘要、TODO lineage/CAS、Demand/Event/Commit ID、
时间、路径或Event数据。`demand-event-sourcing-publication-input.ts`以关闭的被动own-data合同重新解析这些字段，
并拒绝自动trim、非NFC文本、重复成员、非Requirement/Confirmation记录和`record.json`选择。

#### 零写Planning与exact-plan Application

`DemandEventSourcingPublicationPlanningService`每次preview重新读取Config、TODO和Ledger：

- main placement由owner分配Demand/Event/Commit身份；
- isolated placement从唯一Confirmation成员派生Demand身份；
- 完整角色闭包、media type、record/member digest、TODO collection/state digest和revision 1 transaction全部由owner派生；
- preview不创建Publication目录、sidecar、Demand根、TODO claim或其他持久效果。

`DemandEventSourcingPublicationApplicationService`只接受完整transaction及其digest。它重新解析计划、复验当前
Config与Ledger根，随后把物理副作用委托既有`publishDemandFromTodo`；recover只接收Demand ID，并委托既有
`recoverDemandPublication`按sidecar前向收敛。本层没有复制stage、锁、marker、根rename或TODO claim状态机。

物理Service现在对一次exact transaction公开四类最强可证效果状态：

| authority | 含义 | 调用方行为 |
| --- | --- | --- |
| `unchanged` | 可证明没有Publication业务效果 | 可重新preview |
| `recoverable` | 存在可重读且与transaction完全一致的sidecar | 只允许显式recover |
| `current` | 完整Demand根、revision 1和TODO claim已闭合 | 进入Controller Route |
| `unknown` | 无法证明上述任一状态 | 停止，不猜测重试或成功 |

#### Public Contract、MCP与隐私边界

新增两份entrypoint Schema及生成类型、Public Contract和Public Coordinator。公共工具名为
`wakeflow_create_demand`，支持：

```text
preview(authored input) → complete plan + planDigest
apply(exact plan + planDigest) → stable current receipt
recover(demandId) → stable current receipt
```

成功回执只包含Demand、Identity/Authority/Command摘要、revision 1 Event/Commit摘要和TODO claim摘要；不返回
完整Aggregate、Authority内容、物理节点、workspace/ledger绝对路径、sidecar或锁token。错误信封保留稳定
`code/reason/causeCode/causeReason/publicationAuthority`，不回显异常消息、堆栈或私有root。

共享MCP Server与Codex/Claude Code固定composition root均注入同一个宿主中立Coordinator；公共工具数由17增至18。
该工具声明`readOnlyHint:false`、`destructiveHint:true`、`idempotentHint:true`、`openWorldHint:false`，且不执行任何
宿主效果。真实MCP测试证明pending TODO经preview/apply创建Demand后，Controller Route立即返回首个
`implementation-task-planning` frontier，重复apply返回相同结果。

#### Canonical语义比较修正

官方MCP成功结果以Canonical JSON返回，object key顺序可能与领域deterministic pretty render不同。首次真实MCP
纵切因此暴露：Publication transaction和Application输出闭合错误地把持久化渲染字节顺序当成JSON语义相等。

修正后：

- Commit一致性使用`computeDemandEventStreamCommitDigest`；
- Identity、Authority和Commit结构一致性使用Canonical JSON语义比较；
- deterministic render继续只拥有持久文件字节表示，不再承担跨wire语义等价判断。

transaction测试新增“Canonical序列化后重新解析”反例，防止后续再次把object insertion order误当业务语义。

#### 测试维护与当前证据

新的真实MCP发布链和错误隐私合同已从大型公共Server测试拆入独立
`wakeflow-demand-publication-mcp.test.ts`。公共Server主测试只保留executor配置、18工具catalog、Schema/annotations
与双host集合一致性；共享fixture的第18个默认executor继续fail-fast。这样新增能力可单独运行，不复制整套领域样例。

```text
Node: v24.19.0
npm: 11.17.0
Demand Publication完整聚焦面: 25 pass / 0 fail / 0 skip
MCP catalog / composition root: 3 pass / 0 fail / 0 skip
TypeScript: pass
Schema: 101 / 207 external refs
Schema digest: sha256:bdc85d2a15b0f522c41dde26d77d79fa1969f9ec86ccbc78a387781e4d3ee921
Architecture: parser=swc / 723 modules / 5059 dependencies / 0 violations
Candidate: Codex 433 files / Claude Code 438 files / releaseEligible=false
Prettier（手写新增文件）: pass
git diff --check: pass
```

902项完整TypeScript结果仍是Publication Public之前的提交基线；本单元没有伪称已重跑当前完整门，也没有运行
旧JS全量测试、双host plugin validator/smoke、release gate或真实宿主会话。当前实现已提交为`f7c005d`，
Atlas同步将作为独立文档提交；
Technical Skeleton Review Gate中既有两行异常diff继续排除且未修改。

Demand Publication Public至此从“真实内部owner”变为“真实公共纵切”，但没有引入自动Controller编排、宿主调用、
通用transaction manager或额外Foundation。下一核实节点应先审阅当前18工具从pending TODO到Completion的骨干闭包、
完整门与Atlas一致性，再决定进入Research/Redesign，还是以首个真实consumer启动Evidence/Archive。

### 13.15 当前技术核实节点（18工具 / 918测试）

实现提交与Atlas提交完成后，按约定运行当前完整TypeScript门。首次运行得到917 pass / 1 fail；唯一失败是
`typescript-artifact-candidates.test.ts`仍维护17工具期望数组，而两个真实候选stdio入口已经正确返回第18个
`wakeflow_create_demand`。候选builder、manifest、双host composition和生产MCP均没有缺失。

测试只做最小维护修正：导入`WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME`并加入候选stdio期望集合。
聚焦重跑两条候选测试通过，随后重新执行完整门：

```text
TypeScript: 918 pass / 0 fail / 0 cancelled / 0 skip
duration: 358.523313625s
Architecture: parser=swc / 723 modules / 5060 dependencies / 0 violations
Schema: 101 / 207 external refs
Schema digest: sha256:bdc85d2a15b0f522c41dde26d77d79fa1969f9ec86ccbc78a387781e4d3ee921
Candidate: Codex 433 files / Claude Code 438 files / releaseEligible=false
```

新增的一条architecture dependency来自候选测试对真实Publication Public Contract常量的直接import，不是生产层
新增依赖。完整门覆盖官方stdio候选入口、18工具集合、Publication真实MCP纵切、全部Foundation/Workspace/Event
Sourcing/Tasking/Delivery/Result/Review/Testing/Lifecycle测试及Schema生成一致性。

#### 18工具职责矩阵核实

| 形态 | 工具数 | 当前工具 | 共同边界 |
| --- | ---: | --- | --- |
| 只读观察 | 2 | Demand Route、Target Result Review Inspection | 零写，只返回当前责任或审阅输入 |
| preview/apply/recover | 2 | Workspace Maintenance、Demand Publication | preview零写；apply exact-plan；recover只凭私有耐久证据 |
| preview/apply | 5 | Target Task Planning、Implementation Delivery、TestCard Planning、Test Delivery、Demand Completion | owner派生完整计划；apply重新准入并提交Event/终态 |
| 单步记录/授权 | 9 | Window Binding、Claim、Outcome、Rearm、Result Import、Implementation Decision、Review Resume、Test Decision、Product Remediation | 一个owner提交一个有界事实，不自动串联后续Route |

公共链现在从pending TODO到Demand Completion具备真实入口和consumer：

```text
Maintenance / Binding
→ Demand Publication
→ Controller Route
→ Task / Delivery / Host Effect / Result / Review
→ optional Testing / Remediation / rerun
→ Demand Completion
```

MCP仍不执行宿主效果：Maintenance只返回launch intents，Claim只签发一次性Action，Agent调用Codex/Claude宿主能力，
Outcome/Result再记录Wakeflow事实。18工具没有形成第二个orchestrator、动态handler registry或隐式latest选择。

当前明确停止边界收敛为三类：

- Research Completion：Route有诚实blocker，没有完成策略owner；
- Implementation Redesign：Review Decision可表达redesign，但没有重新进入Design/规划的生产owner；
- Evidence/Archive：Loaded Artifact transfer仍只有Foundation能力，Demand完成后没有归档状态、业务manifest或恢复owner。

因此技术骨干核实节点可以关闭：不再为了“可能将来需要”继续扩张Foundation。下一阶段应先对上述三个真实业务缺口
做代码/旧场景/业界方案复核，再由用户选择首个consumer驱动切片。完整TS门通过仍不表示旧JS等价、正式plugin
validator/smoke、真实宿主会话或release gate已经通过。

此前Technical Skeleton Review Gate中误插入的两处“确认”已经恢复为提交版本，当前不再有该异常diff。

### 13.16 下一业务切片预选

对当前TS、旧JS、TencentDB-Agent-Memory和官方规范交叉后，四个候选并非并列可随意排序：

| 候选 | 当前TS事实 | 直接进入的主要问题 | 建议 |
| --- | --- | --- | --- |
| A. Managed Evidence Import | Loaded Artifact tree identity/plan/candidate/publication已闭合，但零生产consumer | 需要新增Evidence manifest、Event、Aggregate归约和Public owner | **推荐首选** |
| B. Research Completion | Route和blocker已存在；Research被Implementation Tasking明确排除 | 直接完成会复刻旧JS“零artifact research捷径”，没有研究结论/evidence closure | Evidence之后 |
| C. Implementation Redesign | Decision/Event/Route已能进入`redesign-requested` | 缺Design generation、Authority supplement和replacement TaskPackage owner | 独立后续切片 |
| D. Business Archive | Completion终态已存在；旧JS有3561行跨owner归档编排 | 依赖Evidence、Artifact、TODO、Ledger、transport和current detach完整闭包 | 最后实施，不与A合并 |

RFC 8493把可靠内容包区分为“完整”与“校验有效”，并要求manifest逐一列出payload路径和checksum；in-toto
Statement以不可变subject digest绑定predicate类型；SLSA把provenance定义为说明artifact在何处、何时、如何产生的
可验证信息。这些模式支持Wakeflow先建立“opaque payload + complete digest manifest + domain metadata”的Evidence
owner，而不是把source路径或ZIP本身当权威。

Microsoft Event Sourcing官方模式继续支持现有Redesign判断：历史Event不可改写，重新设计必须追加新的业务意图/Event，
再创建有精确前驱的replacement generation；不能覆盖原TaskPackage或修改旧Decision。

TencentDB-Agent-Memory的`agents/asset-import.ts`是面向Memory Hub的集中式递归扫描/上传CLI，Skill export返回base64 ZIP；
它没有Wakeflow所需的根作用域manifest、跨资源Event authority和本地前向恢复，因此只能参考client/port分层与显式版本字段，
不能直接作为Evidence/Archive存储模型。

若选择A，第一版建议只支持Config中已知repository/support-surface下的本地`file | tree`，不同时接受旧JS的
`https | git-commit` locator-only记录。locator是外部引用声明，不是Wakeflow捕获并验证的managed evidence；把两者继续放在
同一manifest会混淆“调用方声明digest”和“Wakeflow实际读取字节”。A内部仍按单文件节奏从Evidence Manifest合同开始，
之后才接入tree capture、Event Sourcing Application/Public和第19个MCP工具。

### 13.17 Managed Evidence Manifest首文件单元

用户确认A后，第一单元只建立managed local evidence的持久记录合同，没有提前实现capture、Event、Application或MCP。

新增：

```text
src/contracts/schemas/governance/evidence/managed-evidence-manifest.schema.json
src/governance/evidence/managed-evidence-manifest.ts
tests/governance/evidence/managed-evidence-manifest.test.ts
```

Manifest包含：

- typed `evidenceId / programId / demandId`与immutable Demand Authority digest；
- owner生成的`capturedAt`及`recordedBy.windowId/configDigest`；
- Config逻辑根中的`repository | support-surface`、portable path和`file | tree`来源；
- Foundation Loaded Artifact tree manifest及其独立artifact digest；
- `internal | public` sensitivity；
- opaque文件子集和`not-required | controller-confirmed`复核事实；
- 除自身digest外全部字段的Canonical JSON manifest digest。

当前Durable ID词汇此前故意把`evidence`列为retired，因为没有真实producer/consumer。本单元成为首个真实producer后，
将`evidence`加入唯一`wakeflow-durable-id-kind.schema.json`并删除对应负例；没有恢复delivery、pod、preservation等
仍无当前producer的旧kind。Loaded Artifact tree Schema只增加runtime export元数据，供Evidence codec复用同一Schema，
没有复制其file/ref/digest规则。

关键关系：

- payload artifact digest必须等于完整Loaded Artifact tree manifest的Canonical JSON SHA-256；
- file来源规范化为单一`content`文件，tree保留相对文件清单；
- opaque refs必须按portable ref排序且全部属于payload manifest；
- opaque列表为空当且仅当review为`not-required`；
- Manifest自身摘要、确定性文件表示、1 MiB metadata容量和被动JSON准入均由唯一codec闭合。

`contentReview`不声称执行secret/privacy扫描；它只记录opaque文件是否需要并取得Controller明确复核。
`evidenceType`是审阅/检索标签，消费者不得把未知值解释为权限、充分性或验收策略。外部HTTPS/Git locator、
payload字节、Evidence relations、Event位置和Controller acceptance均明确排除。

```text
Focused: 12 pass / 0 fail / 0 skip
Candidate artifact focused: 2 pass / 0 fail / 0 skip
TypeScript: pass
Schema: 102 / 211 external refs
Schema digest: sha256:84440a2c2d44a798153505f0dd07c035eee4c0a0b3e35ac279de7cadb55ec1da
Architecture: parser=swc / 726 modules / 5082 dependencies / 0 violations
```

下一文件单元应审阅并实现“author-owned本地source selector + 零写capture Planning”边界；不得让Manifest codec读取文件，
也不得让Foundation解释repository/support-surface业务归属。

### 13.18 Managed Evidence Source Selection与零写Capture Planning

第二单元新增：

```text
src/governance/evidence/managed-evidence-source-selection.ts
src/governance/evidence/managed-evidence-capture-planning-service.ts
tests/governance/evidence/managed-evidence-source-selection.test.ts
tests/governance/evidence/managed-evidence-capture-planning-service.{fixture,test}.ts
```

调用方选择只包含：

```text
evidenceType
source.root: repository | support-surface typed ID
source.path: PortableResourcePath
source.resourceType: file | tree
sensitivity: internal | public
opaqueContentPolicy: reject | controller-confirmed
```

绝对路径、expected digest、Evidence ID、时间、Config/Demand摘要、Controller window和payload manifest全部由Planning派生。
选择器拒绝HTTPS/Git locator、额外expectedDigest、`.git`、`.wakeflow-active`和`.wakeflow-local`根段，以及accessor/Proxy。

Planning Service持有已打开Workspace root，每次preview：

1. 完整打开当前Config、Ledger和audit后的Demand Root Authority；
2. 只准入active Demand，并从Config indexes/placements解析逻辑source root；
3. file使用Stable File Read并规范化为单一`content` tree manifest；
4. tree执行稳定Loaded Artifact identity、四并发有界内容读取分类、再次稳定identity；
5. UTF-8失败或含非文本控制字符的文件进入opaque refs；`reject`策略在ID/时间分配前失败；
6. 长时间读取后重新复验Config与Demand Event Stream CAS基线；
7. 分配Evidence ID和capture time，创建Manifest与包含Config/stream/state/last-event基线的capture plan digest。

并发分类使用`Promise.allSettled`等待所有已启动读取完成后才关闭tree root，避免首个失败导致其他读取与root close竞态。
全部文件读取、目录identity、容量、symlink和source drift仍由Foundation拥有；Governance只解释Config root、opaque策略和Manifest。

```text
Evidence focused: 12 pass / 0 fail / 0 skip
TypeScript: pass
Schema: 102 / 211 external refs
Schema digest: sha256:84440a2c2d44a798153505f0dd07c035eee4c0a0b3e35ac279de7cadb55ec1da
Architecture: parser=swc / 731 modules / 5115 dependencies / 0 violations
```

当前capture plan是内部零写子计划，不含Event/Commit ID、stage路径或公共wire Schema；下一单元必须先设计
Evidence Event/Aggregate语义与资源目录，再决定完整Publication/Application事务，不能直接把capture plan注册为MCP。

### 13.19 Managed Evidence Event Sourcing与Aggregate最小selector

第三单元把已捕获Manifest接入现有Demand Event Sourcing骨干，没有新建Evidence专用事件存储或第二状态机。

新增事件合同：

```text
evidence.managed-evidence-recorded.v1
data.manifest: complete ManagedEvidenceManifest
```

完整Manifest进入append-only Event，使source provenance、content review和payload tree identity可从Commit历史独立重建；
同一事件只在Aggregate中投影：

```text
evidenceId
manifestDigest
payloadArtifactDigest
```

Aggregate不复制source、sensitivity、opaque refs、tree files或recordedBy。`managedEvidence`只在首个Evidence Event后出现，
旧Demand和首个Event之前的状态仍保持字段absent，因而既有Event的`resultingStateDigest`不发生漂移。状态模型继续为v1；
新增事件家族本身会改变版本兼容摘要，使旧Snapshot安全回退到完整Commit重放。

Decider新增内部`evidence.record-managed-evidence.v1` Command。准入要求Manifest属于当前active Demand、绑定当前
Demand Authority且Evidence ID未出现；Event的`recordedAt`等于Manifest的`capturedAt`。Reducer按Evidence ID排序并拒绝
重复、错误Authority、终态写入和非规范Aggregate顺序。Command不接受调用方回填state digest或其他CAS字段；完整
Publication Application将使用capture plan已有的Demand expectation约束Command Handler追加。

```text
Managed Evidence Event focused: 4 pass / 0 fail / 0 skip
Affected Demand/Evidence focused: 13 pass / 0 fail / 0 skip
Evidence full focused + Candidate: 18 pass / 0 fail / 0 skip
TypeScript: pass
Schema: 103 / 212 external refs
Schema digest: sha256:b2ff63a2d86b528bb728deaa0e31bcd8a0d5cc2daffb8d2f5973e29e0d534d8b
Architecture: parser=swc / 733 modules / 5132 dependencies / 0 violations
```

真实Commit测试已经证明该Event以v1编码、追加到publication前缀并从前一Aggregate精确重放。当前仍没有Evidence
资源目录、payload/Manifest物理发布、跨资源恢复sidecar、完整Application或第19个MCP工具。下一单元应先审阅资源
目录和Publication事务边界，特别是零写capture plan之后如何重新取得并证明同一payload字节；不能把Manifest Event
已经存在误写成payload已经耐久发布。

### 13.20 Managed Evidence资源路径与所有权目录

第四单元先关闭资源地址和机械处理角色，没有直接实现Application。新增：

```text
src/governance/evidence/managed-evidence-resource-paths.ts
src/governance/evidence/managed-evidence-resource-catalog.ts
tests/governance/evidence/managed-evidence-resource-paths-and-catalog.test.ts
```

最终布局固定为：

```text
artifacts/managed-evidence/<evidenceId>/
├── manifest.json
└── payload/**

artifacts/managed-evidence/.<evidenceId>.wakeflow-stage
transactions/managed-evidence-publication.json
```

`managed-evidence`明确区别于未来只声明外部locator的Evidence Reference。final与stage都由typed Evidence ID形成可逆映射；
Demand级journal使用固定单槽，不允许同一Demand同时形成两个跨资源Evidence恢复意图。journal声明ID同样只由Demand决定，
避免不同Evidence为同一路径生成不同资源身份。

资源目录将三类责任分开：

- `artifacts/managed-evidence`只是0700可选目录容器；
- `<evidenceId>` final root是`manifested-tree + tree-publish-or-move + manifest-closure`；
- journal是0600单链接`transaction-artifact`，只允许`exclusive-create + exact-retire`；
- stage属于具体journal，不作为长期资源实例注册，也不能被调用方当成Evidence事实。

`internal | public` sensitivity不改变active Demand副本的runtime-private/ignored属性；它不是版本控制或外发权限。

#### 事务顺序审阅

[Node.js 24文件系统文档](https://nodejs.org/download/release/v24.15.0/docs/api/fs.html)明确Promise文件操作本身不提供同步或
线程安全，多项修改必须由调用方协调；`FileHandle.sync()`只提供单文件flush能力。[SQLite Atomic Commit](https://www.sqlite.org/atomiccommit.html)
说明可靠事务必须先把完整journal刷新到非易失存储，再修改目标，并依据journal状态恢复部分完成；Wakeflow不采用SQLite，
但吸收“write-ahead intent + durable prepared bytes + explicit recovery”原则。[Microsoft Event Sourcing](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)
继续要求Event Store作为append-only系统记录，并由乐观并发拒绝陈旧append。

因此后续Application推荐：

```text
重新准入Config / Demand / source
→ exclusive-create并同步完整journal
→ 把payload与最后写入的manifest.json物化为完整耐久stage
→ 按preview revision乐观追加Managed Evidence Event
→ Event committed后只从stage整体rename到final并复验
→ final与Event闭合后exact-retire journal
```

Event append是不可逆业务点；journal退休是Demand根重新成为healthy的可见闭合点。Event前冲突只能精确退休当前journal拥有的
未发布stage；Event后恢复禁止重新读取可能已经变化的source，只能从journal绑定的耐久stage前向完成final。

当前Foundation已支持tree source重验、耐久copy、closed candidate检查与同根rename。file来源因为Manifest规范化为
`payload/content`，Application应直接组合`copyFileToCandidateDurably`，不放宽Loaded Artifact transfer的“完整source tree”
合同。尚缺的是Event前对已闭合私有candidate tree的精确退休能力，以及Root Inventory的Evidence transaction phase；
这两项应在Application前补齐。给所有Demand命令增加全局跨进程锁会扩大耦合和stale-lock恢复面，当前不推荐。

TencentDB-Agent-Memory的asset importer仍只提供扫盘、HTTP上传和checkpoint去重；其checkpoint不是flush后的本地跨资源journal，
不能替代上述事务边界。旧Wakeflow JS的`evidence/<id>`与hidden stage证明场景真实，但新TS采用`artifacts/managed-evidence`
和独立资源角色，不继承旧状态机。

```text
Paths/Catalog focused: 4 pass / 0 fail / 0 skip
Evidence full focused + Candidate: 22 pass / 0 fail / 0 skip
TypeScript: pass
Schema: 103 / 212 external refs
Architecture: parser=swc / 736 modules / 5144 dependencies / 0 violations
```

当前路径和声明不创建任何目录或文件，Root Inventory也尚未接纳该可选容器。下一单元应先建立Evidence record tree plan与
事务期Inventory/精确stage退休前置能力，再写journal/Application；不得让普通healthy load忽略未完成journal。

### 13.21 Managed Evidence完整Record Tree Plan与容量闭包

第五单元新增：

```text
src/governance/evidence/managed-evidence-record-tree-plan.ts
tests/governance/evidence/managed-evidence-record-tree-plan.test.ts
```

该纯计划把完整Manifest确定性文件表示和payload描述符组合成一个Foundation `DirectoryTreeCandidatePlan`：

```text
manifest.json                         0600
payload/<non-executable ref>          0600
payload/<executable ref>              0700
all directories                       0700
```

计划包含Evidence ID、完整Manifest、Manifest文档字节摘要、固定stage/final路径、整棵record directory plan与plan digest。
它不携带payload字节、不读取source、不创建stage，也不拥有“payload先写、manifest最后写”的事务执行顺序；后者仍属于
Application materializer。

#### 容量闭包修正

审阅发现Loaded Artifact payload原本可以吃满Foundation目录树的全部硬上限，但final record还必须加入一个
`manifest.json`文件和`payload/`前缀。若不预留，合法Manifest会成为无法形成record tree plan的不可发布输入。

因此新增唯一`MANAGED_EVIDENCE_PAYLOAD_LIMITS`：

| 维度 | Foundation hard limit | Managed Evidence payload |
| --- | ---: | ---: |
| depth | 64 | 63 |
| entries | 8192 | 8190 |
| files | 4096 | 4095 |
| ref UTF-8 bytes | 1024 | 1016 |
| total bytes | 256 MiB | 255 MiB |
| single file bytes | 32 MiB | 32 MiB |

Manifest codec和Capture Planning现在复用同一预算；Schema的opaque refs同步收紧为4095。Manifest的1 MiB容量改为包含
deterministic document末尾LF，确保`payload total + manifest.json bytes <= 256 MiB`。超出Managed预算但仍处于通用
Loaded Artifact上限的tree会在分配/发布前以`capacity`稳定拒绝。

Record plan把`manifest.json`自身SHA-256与Manifest业务`manifestDigest`保持为两个明确摘要：前者证明物理文件字节，
后者证明除自身摘要字段外的业务basis。整树`treeDigest`又独立证明最终record路径、字节、mode和目录闭包，三者不能互换。

```text
Record Tree Plan focused: 3 pass / 0 fail / 0 skip
Evidence full focused + Candidate: 25 pass / 0 fail / 0 skip
TypeScript: pass
Schema: 103 / 212 external refs
Schema digest: sha256:cc5185f54f77b1ab2804cdba21e9c64c3d233a31b711062f5f1ec1cf8cc3f618
Architecture: parser=swc / 738 modules / 5164 dependencies / 0 violations
```

当前仍没有stage materializer、candidate retirement、transaction-phase Inventory或Application。下一Foundation相邻单元应先
审阅并实现“只退休当前owner已证明闭合的未发布candidate tree”能力；它只用于Event前的冲突/取消，不得删除final、未知树或
Event后stage。随后再把Managed Evidence容器与journal/stage/final状态加入Demand Root Inventory。

### 13.22 Foundation封闭Candidate Tree精确退休

新增：

```text
src/foundation/filesystem/durable-directory-tree-candidate-retirement.ts
tests/foundation/filesystem/durable-directory-tree-candidate-retirement.test.ts
```

Foundation没有增加`rm -r`或任意路径删除入口，而是分成两个严格入口：

1. `retireDirectoryTreeCandidateDurably(...)`只接受完整、冻结并再次复验的`DirectoryTreeCandidateResult`；
2. `settleDirectoryTreeCandidateRetirement(...)`只供领域journal恢复，接受同一candidate路径和原始directory plan，允许当前树
   已经是该计划的安全子集。

退休算法：

```text
stable progress inspection
→ 捕获目录inode identity
→ 逐文件stable digest / bytes / mode / single-link复验
→ 第二次同root snapshot progress inspection
→ reverse files exact unlink + inode/parent fsync
→ deepest-first exact empty-directory rmdir + parent fsync
→ exact candidate root rmdir
→ 证明candidate路径absent
```

恢复入口把缺失计划成员解释为已经退休的前缀，但任何未知节点、符号链接、内容/mode/link漂移、目录替换或非空目录都会停止；
它不会删除计划外新增内容。首次入口如果在完整复验后发现candidate已经消失，会报`source-changed`，不会把未知外部删除声明为
本次成功。恢复入口对根已缺失只返回`absent`观察，不伪造retirement receipt。

Abort在每个成员提交点前复验；若已经完成部分unlink/rmdir后失败，领域journal仍保留，后续使用settle入口继续同一计划。
Foundation不认识Evidence stage/final，也不判断Event状态；只有上层事务owner能授权何时调用恢复入口。这保持“机械安全能力”与
“Event前允许退休、Event后只前向发布”的业务规则分离。

```text
Candidate Retirement focused: 7 pass / 0 fail / 0 skip
Affected Foundation focused: 19 pass / 0 fail / 0 skip
TypeScript: pass
Schema: 103 / 212 external refs
Schema digest: sha256:cc5185f54f77b1ab2804cdba21e9c64c3d233a31b711062f5f1ec1cf8cc3f618
Architecture: parser=swc / 740 modules / 5182 dependencies / 0 violations
```

下一单元可以进入Demand Root Inventory：healthy phase允许可选`artifacts/managed-evidence`且只含完整final IDs；
managed-evidence-publication phase必须闭合固定journal、同ID stage/final/Event位置组合，并让普通healthy load在journal存在时失败。
Inventory只观察分类，不执行退休、恢复或Event追加。

### 13.23 Managed Evidence Foundation完整TypeScript核实节点

在进入Publication Transaction与Demand Root Inventory前，对当前全部TS实现重新执行完整门：

```text
npm run check:typescript

TypeScript tests: 948 pass / 0 fail / 0 cancelled / 0 skip
Duration: 375310.104208 ms
Architecture: parser=swc / 740 modules / 5182 dependencies / 0 violations
Schema: 103 / 212 external refs
Schema digest: sha256:cc5185f54f77b1ab2804cdba21e9c64c3d233a31b711062f5f1ec1cf8cc3f618
```

本次完整门覆盖此前918项基线及新增的Managed Evidence Manifest/Capture/Event/Aggregate/Resource/Record Plan、容量预留、
Candidate Retirement和Candidate Artifact闭包。没有使用聚焦测试替代完整门，也没有运行旧JS等价测试、插件validator/smoke、
release gate、push或缓存刷新。

当前工作树是一个可独立提交的基础检查点：Managed Evidence已经具备零写capture到Event/资源计划的全部纯骨干，并补足Event前
stage退休机制；尚未创建journal、stage/final或公共工具。下一步应先提交TS与Atlas两个独立检查点，再从持久Publication
Transaction合同开始，避免中央Root Inventory/Application变化继续扩大同一diff。

### 13.24 Managed Evidence Publication Transaction合同

本单元没有直接进入物理Application，而是先关闭journal中真正需要耐久保存的不可变恢复意图。审阅现有代码时发现，若
Publication codec直接从`managed-evidence-capture-planning-service.ts`导入plan类型与常量，纯合同层会反向加载Config、
RootedDirectory、Ledger和`p-limit`等I/O依赖。因此新增`managed-evidence-capture-plan.ts`，把零写plan的字段准入、关系重建和
摘要计算从Planning Service中提取出来；Service仍独占实际Config/Demand/source读取。

持久Transaction采用以下关闭结构：

```text
wakeflow-managed-evidence-publication-transaction v1
├── capturePlanDigest
├── manifest
├── recordTreePlanDigest
└── demandEventSourcingAppend
    ├── expectedStreamRevision
    ├── expectedStateDigest
    ├── expectedLastEventId
    ├── expectedLastEventDigest
    ├── eventId
    ├── commandDigest
    └── commitId
```

Transaction不保存`prepared/executing/committed`等可变phase。Manifest只出现一次；Demand/Evidence ID、Config digest、
stage/final路径、完整record tree plan与`evidence.record-managed-evidence`Command均由codec确定性重建。这样既保留恢复所需的
完整source/payload事实，又不继承旧JS plan中Manifest、Event、next state、transaction和路径多份复制的问题。

三项摘要各自承担不同边界：

| 摘要 | 关闭内容 | 后续用途 |
| --- | --- | --- |
| `capturePlanDigest` | Config摘要＋Event Stream预期＋Manifest | 证明apply收到的是同一份零写preview |
| `recordTreePlanDigest` | Manifest文档＋payload路径/mode/bytes/digest＋stage/final | 复验stage materialization与发布 |
| `commandDigest` | exact Managed Evidence Event Sourcing Command | 与Event Store commit执行幂等匹配 |

`expectedStreamRevision`最大值收紧为`Number.MAX_SAFE_INTEGER - 1`，为本次Event追加保留一个合法修订号。新的纯factory、parser、
deterministic document codec和digest函数会分别重建capture plan、record tree与Command，拒绝任一摘要、Event ID或字段集合漂移。
它不会签发内存`PreparedDemandEventStreamCommit` capability；Application必须在真实当前Aggregate上重新执行Decider/prepare。

[Node.js 24文件系统文档](https://nodejs.org/docs/latest-v24.x/api/fs.html)仍明确Promise文件操作本身不提供同步或线程安全；
[SQLite Atomic Commit](https://www.sqlite.org/atomiccommit.html)要求恢复journal在修改目标前完整flush；
[Microsoft Event Sourcing](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)要求append-only Event Store以
乐观并发拒绝过期写入。因而当前合同继续支持`durable immutable intent → durable stage → optimistic Event append →
forward finalization → exact journal retirement`，没有引入全Demand锁或伪数据库事务。

```text
Managed Evidence adjacent focused: 15 pass / 0 fail / 0 skip
TypeScript: pass
Schema: 104 / 214 external refs
Schema digest: sha256:2ded2c05dcc81a8808a92a818f8584c308ab276c916a4cf33c7419cca73d7851
Architecture: parser=swc / 744 modules / 5215 dependencies / 0 violations
```

本单元仍未创建journal文件、stage/final或Event。下一审阅单元进入Demand Root Inventory：先让healthy读取接纳可选且关闭的
`artifacts/managed-evidence` final集合，并为`managed-evidence-publication`增加只读事务分类；Inventory不得执行source重读、
candidate退休、Event追加或前向发布。

### 13.25 Managed Evidence Record Set与Demand Root健康闭包

直接把`managed-evidence`加入Root Inventory允许名称会产生错误的健康语义：任意目录只要名字像`evidence_<uuid>`，即使
Manifest损坏、payload漂移、属于其他Demand或没有对应Event，也会被普通Root Authority接受。因此本单元新增
`managed-evidence-record-set-inventory.ts`，并同时接入Demand Root Inventory与Root Authority；没有采用只放宽白名单的短路径。

每份final record执行：

```text
稳定关闭record根的manifest.json + payload/顶层
→ 按expected node读取manifest.json
→ 解析完整Managed Evidence Manifest
→ 复验目录名与evidenceId
→ 重建ManagedEvidenceRecordTreePlan
→ 返回最小record selector/provenance摘要
```

record-set枚举使用固定4并发，保持输入顺序并在最终再次读取容器；容量与Aggregate `managedEvidence`上限一致，为10,000份final，
事务期额外允许一个stage。普通healthy Demand加载不会重新SHA-256扫描全部历史payload，返回值明确标记
`payloadVerification: deferred`；未来Evidence reader在实际读取一份记录时负责该份payload的完整或定向复验。这样避免每条
业务命令随历史Evidence总字节数线性退化。Root Authority现有`audit: true`只表示Event Stream从Commit 1完整重放，不会被
悄悄扩展成全部Evidence payload内容审计。

Root Inventory phase从含糊的`publication`收敛为三个明确值：

| phase | transaction目录 | Managed Evidence物理集合 |
| --- | --- | --- |
| `healthy` | 必须为空 | 可选容器；只允许完整final records，不允许stage |
| `demand-publication` | 只允许`publication.json` | Fresh Demand根不得提前出现Managed Evidence容器 |
| `managed-evidence-publication` | 只允许`managed-evidence-publication.json` | journal-only、同ID partial/complete stage或同ID完整final四种可恢复分类 |

事务Inventory从固定journal解析exact transaction；当前stage必须是transaction record plan的安全子集，当前final会按完整
record plan复验全部payload字节，stage/final共存、foreign stage、未知成员和摘要/mode漂移均失败关闭。Inventory只返回
`absent / stage-incomplete / stage-complete / final`观察，不执行任何恢复动作，也不判断Event是否已提交。

普通Root Authority在重放Aggregate后，进一步要求final集合与`managedEvidence` selector逐项一致，并同时闭合Program ID、
Demand ID和immutable Demand Authority digest。真实测试先放置完整final但不追加Event，Authority以`closure`拒绝；随后通过
现有Command Handler追加Managed Evidence Event，完整audit加载才通过；把物理Manifest替换为另一Program的合法Manifest也会再次
以`closure`拒绝。这证明物理目录不能替代Event Sourcing权威，同时说明healthy必须读取Manifest而不能只比较目录ID。

```text
Adjacent focused: 21 pass / 0 fail / 0 skip
TypeScript: pass
Schema: 104 / 214 external refs
Schema digest: sha256:2ded2c05dcc81a8808a92a818f8584c308ab276c916a4cf33c7419cca73d7851
Architecture: parser=swc / 746 modules / 5253 dependencies / 0 violations
Candidate build: Codex 445 files / Claude Code 450 files / releaseEligible=false
```

当前仍没有创建、读取和精确退休journal的领域store，也没有stage materializer、按需Evidence reader或Publication Application。下一单元应先实现
Managed Evidence transaction store，使固定0600单槽journal具有`exclusive-create → stable read → exact-retire`生命周期；随后才
进入payload/Manifest stage物化。

### 13.26 Managed Evidence Publication Transaction Store

新增`managed-evidence-publication-transaction-store.ts`，成为固定
`transactions/managed-evidence-publication.json`的唯一领域生命周期owner。它没有复用Demand首次发布或Ledger的“ensure exact”
策略：普通apply遇到任何现存journal，即使字节完全相同，也返回`transaction-exists`并要求显式恢复，避免正常入口暗中接管一次
未完成事务。

Store合同：

```text
create：完整解析Transaction
     → Catalog准入exclusive-create
     → 0600 atomic create + file/parent durability
     → committed后忽略取消并稳定readback

load：固定路径inspect
   → 0600 / single-link / current-user
   → bounded deterministic JSON read
   → Transaction完整关系重建
   → 签发进程内Stored capability

retire：只接受Store签发capability
     → Catalog准入exact-retire
     → 按原node再次稳定读取exact文档
     → digest/text/node全部一致
     → exact durable unlink
```

`retire`不接收裸路径、Transaction或调用方自造node；structured clone不能取得退休权限。文档替换、mode/link漂移、缺失或
unlink提交不确定均不伪造成功。成功后原capability失效。Store仍不决定何时退休：Event前取消与Event后前向完成由未来
Application依据Transaction、Root Inventory与Commit Store授权。

Record Set Inventory改为调用Store的统一`load`入口，不再维护第二套journal文件解析、容量与节点策略。测试共享的纯Fixture也
从Transaction/Inventory/Store三份重复构造中提取，正式测试文件由298/379行分别降到194/346行，新Store测试保持217行。

```text
Adjacent focused: 24 pass / 0 fail / 0 skip
TypeScript: pass
Schema: 104 / 214 external refs
Schema digest: sha256:2ded2c05dcc81a8808a92a818f8584c308ab276c916a4cf33c7419cca73d7851
Architecture: parser=swc / 749 modules / 5275 dependencies / 0 violations
Candidate build: Codex 447 files / Claude Code 452 files / releaseEligible=false
```

下一单元进入stage materializer，但只实现“从Transaction Manifest所指source重验并物化同一record plan”的物理能力；Event
append、stage→final、失败前退休和journal退休仍不在同一文件提前组合。

### 13.27 Managed Evidence Payload与Stage Materializer

Stage物化拆为两个紧密相邻owner，避免把source类型分支、journal恢复与Manifest提交顺序堆入一个近900行文件：

| 文件 | 唯一职责 |
| --- | --- |
| `managed-evidence-publication-payload-materializer.ts` | file/tree source稳定复验与`payload/**`耐久复制 |
| `managed-evidence-publication-stage-materializer.ts` | exact journal、容器/stage进度、Manifest-last与完整stage readback |

Materializer要求未来Application先按Config打开正确source root；自身不会重读Config或猜测repository/support路径。执行顺序：

```text
解析Transaction并load exact journal
→ Catalog准入并物化可选managed-evidence容器
→ 创建或接纳同ID stage root
→ 精确恢复manifest target的Foundation atomic-file residue
→ 检查完整record plan进度
→ complete：不读取source，直接重用
→ partial且Manifest已出现：拒绝
→ partial且payload已完整：不读取已变化source，直接继续
→ 其他partial：按Manifest重验并复制source
→ journal node/text/digest仍相同
→ 最后atomic-create manifest.json
→ 忽略提交后取消，完整stage + journal readback
```

file来源只执行一份bounded stable streaming copy到`payload/content`。tree来源打开选择路径的exact子根，并复用Loaded Artifact
transfer：复制前后各计算一次完整tree identity，missing目录/文件按计划补齐，普通文件0600、Manifest声明的executable文件0700。
任何source新增/缺失/摘要漂移、foreign stage成员、错误mode或Manifest提前出现都会失败关闭；安全partial payload保留供同journal重试。

`manifest.json`仍是complete-stage marker，使用Foundation atomic create并处理其精确target残留。若Manifest已经提交，后续
candidate/journal readback不再接受Abort遮蔽；无法证明完整结果则报告`recovery-required`。模块仍不追加Event、不rename final、
不退休stage或journal。

```text
Adjacent focused: 29 pass / 0 fail / 0 skip
TypeScript: pass
Schema: 104 / 214 external refs
Schema digest: sha256:2ded2c05dcc81a8808a92a818f8584c308ab276c916a4cf33c7419cca73d7851
Architecture: parser=swc / 752 modules / 5320 dependencies / 0 violations
Candidate build: Codex 447 files / Claude Code 452 files / releaseEligible=false
```

双宿主候选文件数没有增长，因为Stage Materializer尚无Public/Application生产入口；Architecture仍扫描并验证其内部依赖。下一单元
应建立`managed-evidence-publication-record-publisher.ts`，只负责“完整stage→不存在final”的同根耐久rename与exact readback；
Event-before-final的业务顺序仍留给Application。

### 13.28 Managed Evidence Final Record Publisher

新增`managed-evidence-publication-record-publisher.ts`，只拥有完整stage到immutable final record的同根耐久发布。相邻重构把
“journal仍是同一Transaction/同一node”的复验下沉为Transaction Store的
`requireCurrentManagedEvidencePublicationTransaction(...)`，Stage与Publisher不再各自复制digest/text/node比较。

Publisher状态矩阵：

| stage | final | 处理 |
| --- | --- | --- |
| absent | absent | `stage-missing` |
| incomplete/conflicting | absent | `stage-conflict` |
| complete | absent | Catalog准入→preinspect→durable rename→final exact readback |
| absent | exact complete | `current`幂等成功 |
| present | present | 冲突；不删除任一资源 |
| absent | conflicting final | `final-conflict` |

rename前重新加载exact journal；成功后忽略取消，再次验证final完整tree与同一journal。Foundation报告destination appeared、source changed、
durability/commit uncertain时，Publisher会观察stage/final：只有“stage absent + exact final”可识别为同一并发winner并返回`current`，
其他组合保留错误或报告`commit-uncertain`。journal始终保留，供Application完成Event/final闭包后退休。

Node没有`renameat2(RENAME_NOREPLACE)`；Foundation rename的目标absent是协作式前置条件。这里固定单槽exact journal作为Wakeflow
协作边界，并对同一Transaction并发winner做幂等结算；不声称能够阻止同一OS用户的非协作外部写入者。

Publisher不检查Event是否提交，这是有意的物理/业务分层；当前没有生产Application caller，只有测试可以直接调用。未来
Application必须固定执行`complete stage → optimistic Event append → final publisher → closure → journal retire`。

```text
Adjacent focused: 32 pass / 0 fail / 0 skip
TypeScript: pass
Schema: 104 / 214 external refs
Schema digest: sha256:2ded2c05dcc81a8808a92a818f8584c308ab276c916a4cf33c7419cca73d7851
Architecture: parser=swc / 754 modules / 5340 dependencies / 0 violations
Candidate build: Codex 447 files / Claude Code 452 files / releaseEligible=false
```

下一阶段不应立刻注册MCP，而应先审阅并实现内部Application/Recovery orchestration：统一Config/Demand/source复验、Event前冲突退休、
Event幂等追加、final前向完成、Root Authority closure与journal-last退休。

### 13.29 Managed Evidence Publication Application与Recovery

本单元补齐内部资源Application，但继续不注册公共工具。普通Demand Root Authority仍只接纳无journal健康根；新增事务期专用加载入口，
在复用完整Identity/Authority/Ledger/Event审计的同时，只允许以下恢复组合：Event前`absent / stage-incomplete / stage-complete`、Event后
`stage-complete / final`。`final before Event`及`Event selector before complete stage`均以closure失败关闭。Commit归属继续由Application
按`commitId + commandDigest + expected revision + exact Event/Manifest`单独证明，Root物理形态不能代替Event Store事实。

实现按不可逆边界拆为：

```text
managed-evidence-publication-application-service
├── 当前Config/Demand/source准入
├── journal创建与stage物化
└── Apply/Recovery路线选择

managed-evidence-publication-transaction-settlement
├── Event append / Commit recovery lookup
├── Event后final前向完成
├── Event前stale candidate退休
└── transaction closure → journal retire → healthy closure
```

Planning与Application共用新的`managed-evidence-configured-source-root.ts`，只把Manifest逻辑repository/support root闭合到当前Config
placement与real path。正常顺序是`journal → complete stage → Event → final → journal retire`；Recovery在Event存在后绝不重读source或
回滚Event；Demand CAS过期，或仍需source的partial/absent stage遇到Config过期时，才退休safe candidate。完整stage不因后续Config/source
变化倒退。journal已经退休的重复Recovery返回重新审计后的`healthy`，
覆盖末端提交成功但调用方未收到结果的情形。

官方依据继续采用SQLite durable journal顺序、Microsoft Event Sourcing乐观并发和Node 24单资源文件原语边界。没有新增全Demand锁、
可变phase或伪多资源原子API。4项真实Application测试覆盖正常Apply、Event前/后崩溃前向恢复、Event前CAS冲突退休和末端健康重试；
Managed Evidence聚焦集合共44项通过。TypeScript、104 Schema/214 refs、758模块/5388依赖架构检查均通过；双宿主候选仍为
447/452且`releaseEligible=false`。下一阶段仍须先审阅按需Evidence reader与Public边界，不能从内部Application推断第19个MCP工具已存在。

### 13.30 Managed Evidence按需Reader

按需Reader已经作为内部consumer落地，但没有直接复制旧JS“每次把整份Evidence全部读入内存”的方式。物理
`managed-evidence-record-reader.ts`签发一份Manifest/top-level capability，并区分：

```text
Manifest metadata only → deferred
one complete payload member → member
exact complete record tree → complete
```

成员读取先核对Manifest descriptor的portable ref、bytes、SHA-256和executable/private mode，并要求调用方提供明确`maximumBytes`；完整验证才
遍历整树。Manifest v1没有分块摘要，因此没有加入不可独立认证的byte range语义。通用父子路径连接下沉为
`joinPortableResourcePath(...)`，candidate join继续保留兼容名称但只委托通用能力。

`managed-evidence-reading-service.ts`先加载Event-backed Demand Authority，再把指定record交给物理Reader；Record Set Inventory也复用同一
metadata loader，删除重复Manifest/顶层验证。只读上下文使用Snapshot + tail，mutation上下文继续完整audit。真实tree负例证明：未请求成员
漂移不会强迫单成员读取扫描全树，但完整验证和该成员自身读取都会发现漂移。

本单元聚焦55项通过（Managed Evidence 46 + Portable Resource Path 9）；TypeScript、104 Schema/214 refs、761模块/5420依赖均通过。
双宿主候选变为448/453且仍`releaseEligible=false`：物理Reader因Inventory成为制品依赖，但Reading Service尚无Public入口。下一步应先设计
Public读取/记录边界的暴露范围、bytes上限与敏感信息策略，不能直接把内部`Uint8Array`结果映射到MCP。

### 13.31 Managed Evidence Public与第19个MCP工具

用户确认先公开记录而不公开原始读取后，`wakeflow_record_evidence`以`preview / apply / recover`进入共享官方MCP Server。Preview只接收
Demand ID与逻辑source selection，并返回完整确认Transaction；新Publication Planning Service在capture成功后分配Event/Commit ID。Apply要求
root、Demand ID与exact plan/digest，并在任何副作用前交叉检查Demand ID；Recover只接收root与Demand ID。

Apply/Recover结果严格metadata-only：Evidence/Demand ID、Transaction/Manifest/payload/record-plan/Command摘要及Event/Commit/Aggregate游标。
Manifest正文、source ref、Config/window、机器路径、节点、bytes与内部Reader均不公开。Recover结果区分`current / retired-stale / healthy`，避免把
“没有journal”冒充某次Evidence提交成功。

Application错误新增publication authority，MCP信封可稳定报告`recoverable`而不泄露root/source。共享Server与Codex/Claude composition roots注册
相同第19工具；annotations为non-destructive、idempotent、closed-world且无host effect。两份新Schema使总数变为106，digest为
`sha256:1340ac3fd131aaeaacd6befa947a9e380222df8e4ce3efc9be285f8b0cbe4c57`。

Public聚焦47项、TypeScript、768模块/5469依赖架构门和双候选stdio均通过；候选闭包为465/470且`releaseEligible=false`。这只是TS候选公共纵切，
没有执行插件validate/smoke、release gate、publish或缓存刷新。

### 13.32 十九工具与Managed Evidence技术核实节点

本节点重新读取当前TS Public Server、Route、Event Decider、Evidence Application/Reader、旧JS 31工具组合层、当前测试装配和Atlas，
并复核MCP 2025-11-25 Tool合同与Microsoft Event Sourcing指导。旧JS只用于恢复产品场景，不作为TS分层或工具粒度权威。

#### 当前十九工具不是旧31工具的子集

当前TS按单一owner重新拆成六组：

| 分组 | 数量 | 当前公共能力 |
| --- | ---: | --- |
| Workspace | 2 | Maintenance、Window Binding registration |
| Demand入口/路由/终结 | 3 | Demand Publication、Controller Route、Completion |
| Managed Evidence | 1 | 本地file/tree记录的preview/apply/recover |
| Task/Test/Delivery Planning | 4 | Target Task、TestCard、Implementation Delivery、Test Delivery |
| Agent宿主效果握手 | 3 | Claim、Outcome、Rearm；Wakeflow不执行宿主效果 |
| Result/Review | 6 | Result Import、Inspection、Resume、Implementation/Test Decision、Product Defect Remediation |

调用形态为3个`preview/apply/recover`、5个`preview/apply`、2个只读观察和9个单步记录/授权。共享能力只在真实相同
状态机处复用：Target Task Planning同时接纳implementation/test，Claim/Outcome与Review Inspection/Resume服务两种workType；没有
动态handler registry、第二Route表或按宿主分叉的业务owner。

MCP官方合同把annotations定义为提示而非权限。当前实现仍由闭合Schema、领域parser、当前Authority与exact plan/digest决定准入；
`structuredContent`和文本JSON同时返回，`outputSchema`由官方SDK与领域边界双重验证，符合
[MCP Tools 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)。

Demand继续是唯一采用Event Sourcing的业务聚合：不可变Event Stream是写权威，Snapshot/Route/Inventory都是可重建读模型；固定
`expectedStreamRevision`执行乐观并发。Managed Evidence跨文件发布使用耐久journal前向结算，但没有把journal伪装成第二Event Store。
这与[Microsoft Event Sourcing](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)关于append-only、聚合重放、
投影和乐观并发的边界一致，也没有把Event Sourcing扩张到Config、Binding或所有本地文件。

#### Evidence纵切的完成与停止边界

当前`wakeflow_record_evidence`只捕获Config声明的repository/support-surface内本地file/tree。旧JS同名工具还混合HTTPS、Git commit和
任意artifact/event relations；这些来源的信任、验证与生命周期不同，不能重新塞入当前本地文件Manifest。未来若有真实consumer，应分别
设计External Evidence Reference或Evidence Relation命令，不扩大Managed Evidence本地记录合同。

Evidence写入纵切已经闭合：零写Planning、exact Transaction、journal、stage、Event、final、journal-last退休、健康Root、按需内部Reader及
metadata-only Public。读取内容仍未公开，Route也不把Evidence伪装成必经阶段；因此当前完成的是“记录能力”，不是跨窗口Evidence消费产品。

#### 当前真正的零到一入口缺口

Fresh Maintenance会创建严格空TODO authority。`wakeflow_create_demand`只能从现有`pending-claim` TODO生成计划并在根发布后CAS claim，
但当前TS没有TODO append/intake或inspection公共工具。因此Atlas所说的端到端链准确边界是“从既有pending TODO到Completion”，不是
“从用户输入或空Workspace到Completion”。这比Archive、Pod或泛化View更靠前，是下一项真实consumer缺口。

旧JS剩余能力需要分三类处理，不能按名称逐个翻译：

1. **应作为后续真实纵切重新设计**：TODO intake/inspection、Window replacement/decommission、Continuation/Cancellation、Archive/Retention、Pod。
2. **需要真实consumer再决定**：External Evidence Reference/relations、Evidence读取公共面、Controller return。
3. **不应默认恢复为通用工具**：generic state-transition recovery、generic view、手工release lock；新TS优先使用owner-specific recovery、明确读模型和自动claim结算。

#### 测试成本重新评估

`wakeflow-public-mcp-server.test.ts`当前3966行、39项。虽然唯一fixture边界仍成立，Evidence新增时为了验证catalog/config/双宿主集合，
聚焦集合被迫执行整份共享文件；本次47项运行约52秒。当前runner按测试源文件选择，不能只选该文件中的catalog测试。这已经构成此前
“无证据不物理拆分”条件的变化。

推荐先做一个有界测试维护单元：把Public Server的composition配置、十九工具catalog/Schema/annotations和双宿主工具集合迁到独立
`wakeflow-public-mcp-catalog.test.ts`，继续复用唯一连接fixture；真实业务纵切和错误信封留在现有文件，不创建生产registry或复制领域样例。
以后新增Public工具只需运行其owner MCP测试与catalog测试，不再默认执行全部生命周期纵切。相比给runner增加依赖测试名称文本的
`--test-name-pattern`，物理owner边界更稳定、可审阅。

#### 推荐顺序

```text
TC-1 Public MCP catalog测试归位
→ TC-2 重新核验测试清单与十九工具边界
→ 下一真实业务：TODO Intake + Inspection（不新增独立Claim owner）
→ 再按真实consumer选择Evidence Reading、Lifecycle或Archive
```

本节点不建议立即扩张Foundation，也不建议一次补齐旧版31工具。当前验证基线仍为Public聚焦47项、TypeScript通过、106 Schema/214 refs、
768模块/5469依赖、Atlas全current、候选465/470且`releaseEligible=false`；完整TypeScript、双插件validate/smoke和真实宿主会话仍未运行。

### 13.33 TC-1：Public MCP catalog测试归位

新增`tests/entrypoints/wakeflow-public-mcp-catalog.test.ts`，迁移且收紧三项横切证据：

1. 十九个具名executor及额外配置字段的组合根拒绝；
2. 十九工具完整名称、request/result Schema ID、四项MCP annotations、自包含Schema和关键描述片段；
3. Codex/Claude Code固定composition roots的工具集合一致性。

新文件所有executor默认失败，不拥有领域成功样例，也不调用任何业务owner。原
`wakeflow-public-mcp-server.test.ts`保留36项真实Planning/Delivery/Result/Review/Completion纵切、SDK准入和稳定错误信封，测试总数仍为39，
没有用“拆文件”删除行为证据。原catalog只抽查9个工具的部分annotations；新矩阵逐项复验全部19个工具。

规模变化：

```text
共享业务/错误测试：3966 → 3485行；39 → 36项
新增catalog测试：355行；3项
合计：3966 → 3840行（-126）；39项保持不变
```

验证结果：

```text
Catalog focused: 3 pass / 0 fail / 0 skip（约2.3秒）
Shared business/error: 36 pass / 0 fail / 0 skip（约50秒）
Evidence daily focused: 11 pass / 0 fail / 0 skip（约18.5秒）
TypeScript: pass
Schema: 106 / 214 external refs
Architecture: parser=swc / 769 modules / 5481 dependencies / 0 violations
git diff --check: pass
```

Evidence日常门由原先必须带上整份共享39项的47项集合，收敛为owner MCP 2项、Coordinator 4项、catalog 3项和candidate 2项；
完整共享业务/错误文件仍在本单元单独通过。下一步先做TC-2清单复核，确认没有测试名称、文档或Atlas仍把catalog归给业务文件，
再进入TODO Intake + Inspection设计，不直接编码TODO Public。

### 13.34 TC-2：测试清单与十九工具边界复核

TC-2确认三项横切测试标题只存在于`wakeflow-public-mcp-catalog.test.ts`；原共享业务文件不再导入
`createWakeflowPublicMcpServer`配置错误、Claude composition root或Managed Evidence catalog常量。当前正式`.test.ts`源为242个，
其中Public MCP catalog 3项、共享业务/错误36项。

完整catalog矩阵与Server options的executor字段集合在运行时互相比较，并额外检查无重复项；未来增加executor而忘记配置负例时，测试会在
进入逐项Proxy检查前失败。该矩阵不是第二个生产registry，只是读取组合根公开合同的测试期望。

Atlas已同步测试归位、769模块/5481依赖和Public分层门，全部30份来源指纹保持current。复核图义时修正了H0图中遗留的
`registerTool × 18`为真实`× 19`，没有修改生产Server。Atlas 33份文档、44张图、247条直接导入声明和882条证据边通过完整检查与构建。

TC-1/TC-2至此关闭。下一单元进入TODO Intake + Inspection的需求与旧逻辑审阅，只确定Authority、输入最小化、写入/查询边界和首文件顺序；
在设计确认前不注册第20个工具。

### 13.35 TODO Intake + Inspection公共化前设计复核

本轮读取当前15个TODO生产模块、5份领域Schema、10个聚焦测试文件、Demand Publication真实consumer、旧JS
`wakeflow_deliver / wakeflow_next_work / wakeflow_claim_next`、当前安装规则、TencentDB-Agent-Memory的Route/Service/Store与串行队列实现，
并核对CQRS、稳定分页和幂等请求实践。没有修改运行时代码。

#### 已经足够的技术内核

当前TODO Foundation/Domain不需要重做锁或事务：

- immutable Intake与revisioned State分离；State只保留`pending-claim / parked / claimed / archived`；
- JSON item authority为唯一事实，Markdown Board只是可重建投影；
- Collection Authority执行有界树扫描、0600/0700/单链接/owner/稳定节点复验；
- Collection Service拥有append/claim/archive、集合级短锁、可选collection CAS和稳定错误；
- Transaction Storage使用immutable journal、stage、exact source expectation、投影发布和前向恢复；
- Demand Publication已把TODO claim作为root-first跨资源事务的最后一步，不能再公开第二个`claim_next` owner。

TencentDB-Agent-Memory采用薄Route、Service/Store分层以及per-asset进程内`SerialQueue`，说明公共入口不应直接承载存储细节；但其队列只防
单进程同key并发，Wakeflow需要跨进程和崩溃恢复，现有文件锁 + journal + CAS更符合本地权威场景，不应换成内存队列或SQLite。

#### 公共化前必须重新决定的旧设计

1. `TodoItemId`注释明确为了旧公开入口保留人工可读字符串，不进入`WakeflowDurableId`。这与“新TS不承担过渡兼容”和现有typed identity
   体系冲突；腾讯短ID依靠数据库唯一约束重试，而Wakeflow已有UUIDv4 typed ID能力。
2. `TodoIntake.documents`只保存`label + portable path + anchor`，没有Ledger record/member identity与digest；Demand Publication又让调用方
   重新选择`authorityMembers`。TODO来源与最终Demand Authority之间不存在机器绑定。
3. TS只有内部`LedgerAuthorityStore.publish`，没有公共Ledger Record producer。即使现在公开TODO append，空Workspace仍无法通过公共面生成
   Demand Publication所需的immutable Requirement/Confirmation记录。
4. `affectsRetestOrDispatch`只进入Board；`autoClaim`在当前TS没有自动领取consumer；`parked`可创建但没有unpark transition。这些字段若直接
   进入公共合同，会把旧表格占位固化为已实现产品能力。
5. `ownerWindowId / recommendedWindowId / dependency / priority`目前也主要进入投影，但未来Inspection是合理consumer；公共Planning仍必须用
   当前Config验证窗口存在，不能把typed字符串格式当作当前拓扑关系。

#### 标准化公共边界

[Microsoft CQRS](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs)允许读写模型共享同一存储，但要求Command和Query分别建模；
这正好保持MCP `readOnlyHint`准确。因此Inspection与Intake不合并成一个`wakeflow_manage_todo`工具。

TODO集合上限为65,536，Inspection不能直接返回完整Authority。列表查询应从第一版就有上限和续页；
[Google AIP-158](https://google.aip.dev/158)要求有界page size、opaque continuation且后续筛选条件保持不变，
[Kubernetes API列表语义](https://kubernetes.io/docs/reference/using-api/api-concepts)进一步用resource version绑定一致快照。
Wakeflow可用collection digest绑定filter与最后排序位置，集合变化时返回stale并要求重新开始；cursor不承担授权。

Intake写入应采用`preview / apply / recover`：preview分配owner-derived ID/time并冻结当前Config、Ledger Authority与Collection digest；apply只消费
exact plan/digest；同计划重复apply复验现存Intake/State并返回current；journal后失败报告recoverable。该语义与
[Stripe幂等请求](https://docs.stripe.com/api/idempotent_requests)“同一key只能重放相同参数”的原则一致，但权威仍由Wakeflow自身CAS/journal证明。

#### 待选路线

**A. 先修正合同再公共化（推荐）**

```text
A1 将TODO纳入typed durable identity（owner在preview分配todo_<uuid>）
→ A2 用完整Ledger Authority Member References替换无摘要documents，并剪除无consumer字段
→ A3 补齐Requirement/Confirmation Ledger Publication公共纵切
→ A4 单独实现有界wakeflow_inspect_todo
→ A5 实现wakeflow_intake_todo preview/apply/recover
→ A6 Demand Publication从TODO Intake派生Authority，不再让调用方重新选择无绑定成员
```

每一步仍按1～2个紧邻文件审阅，不一次重写整个TODO系统。`ownerWindowId`、priority、dependency、testing decision等字段是否保留，按
Inspection与Demand的真实消费逐项决定；`parked`/`autoClaim`只有在同轮加入真实状态转换/调度consumer时才公开。

**B. 只先公开Inspection**

复用当前Collection Authority做只读、有界查询，暂不公开Intake。改动小且不会写错数据，但Inspection会先固化可能随后删除的人工ID、
documents和占位字段，存在返工。

**C. 直接包装当前Service（不推荐）**

最快得到`inspect + append`，但保留旧人工ID、路径式documents、无消费字段和Ledger断链；它只能让测试fixture中的预置Ledger工作，不能闭合
真实空Workspace，也会把兼容决定升级为新TS公共协议。

不建议把Ledger Publication与TODO append合并成一个跨根“Work Intake”大事务：它会把两个owner、两类恢复和两种生命周期绑成新Saga，
与当前显式Agent分步调用和避免通用orchestrator的方向相反。

### 13.36 A1：TODO typed durable identity

用户确认路线A后，TODO身份从旧人工字符串一次性迁移为`todo_<lowercase UUIDv4>`，不保留双格式parser、兼容alias或迁移分支。
`wakeflow-durable-id-kind.schema.json`新增已有真实Intake/State/Transaction/Demand consumer的`todo` kind；
`todo-item-id.ts`改为`WakeflowDurableId<"todo">`的领域窄facade，只映射通用词法错误，不维护第二份正则或品牌。

专属`todo-item-id.schema.json`继续作为TODO、Demand Publication和Completion多个wire合同共享的Schema，但pattern与通用durable ID完全一致。
四份entrypoint自包含Schema镜像同步更新；所有生成文件由codegen重建，没有手改生成产物。

物理条目目录继续使用`item-<SHA-256(todoId)>`：这不再是为了允许冒号，而是保持固定长度、不直接披露业务身份并继续执行存储键碰撞检查。
所有TODO/Demand/Tasking测试身份迁移为合法typed ID；并发与容量测试使用确定性合法UUID序列。更长ID使8 MiB Board Projection的精确边界
从“254项仍可写”变为“253项仍可写、第254项拒绝”，容量上限没有放宽。

```text
A1 focused closure: 92 pass / 0 fail / 0 skip
TypeScript: pass
Schema: 106 / 214 external refs
Schema digest: sha256:02e84c3ce2b12a437efdb8520c34ac73c39d3804d602c4a08b93b46709a17663
Architecture: parser=swc / 769 modules / 5482 dependencies / 0 violations
Candidate build: Codex 465 / Claude Code 470 / releaseEligible=false
```

A1不分配ID；owner-derived UUID将在未来Intake Planning preview中生成。下一单元A2审阅并修改Intake Authority字段：用Ledger Member References
替换path-only documents，并逐项决定`parked / autoClaim / affectsRetestOrDispatch / ownerWindow / recommendedWindow / dependency`的保留或删除。
在A2确认前不实现Ledger Public、Inspection或第20个工具。

### 13.37 A2：TODO Intake Authority字段与pre-demand生命周期待确认

本轮对照当前TS consumer、旧Design handoff/Auto Claim规则、TODO Backlog规则及成熟任务系统后，确认A2不能只机械替换`documents`。
现有字段同时混合来源事实、调度提示、派生Config身份和未完成状态能力；若原样公开会形成第二套Goal权威和永久不可恢复的parked条目。

#### 推荐Intake字段

| 当前字段 | 推荐处理 | 新语义/来源 |
| --- | --- | --- |
| `todoId` | 保留typed语义，未来由Planning分配 | `todo_<UUIDv4>`；调用方不提供 |
| `createdAt` | 保留，owner派生 | Preview读取一次UTC clock |
| — | 新增`programId` | 从当前Config派生，绑定Workspace程序身份 |
| `initialStatus + dependency` | 合并为discriminated `readiness` | `{status:"ready"}`或`{status:"parked", trigger}`；关闭非法组合 |
| `type` | 改名`demandType` | 继续成为Demand Identity的类型来源 |
| `priority` | 保留 | Inspection/Controller调度输入，不自动替Controller选择 |
| `ownerWindowId` | 改名`originWindowId` | 调用方选择、Planning验证为当前Config窗口；表示来源，不冒充调用认证 |
| `recommendedWindowId` | 改为owner派生`controllerWindowId` | 当前Config唯一Controller；调用方不能改写 |
| `goal` | 改名`summary` | 只作排队摘要；用户Goal权威仍在Ledger/Demand，不形成第二Goal |
| — | 新增`intakeRationale` | 说明为何进入TODO而不是现有Demand/风险记录 |
| `affectsRetestOrDispatch` | 删除 | 一个boolean混合两种语义且无领域consumer；未来应由typed关系表达 |
| `autoClaim` | 保留 | 已确认的无人值守选择策略；只改变claim时机，不授予设计/发布/验收权限 |
| `testingDecision` | 保留并补`environmentMemberRef` | `real-environment`必须精确绑定authorityRefs中的唯一环境member；其他模式为null |
| `documents` | 替换为`authorityRefs` | 1～32个完整immutable Ledger Member References，含record/member identity、role、media type与digests |

Public Planning未来仍只接收最小Ledger member selectors，读取Ledger Store后派生完整`authorityRefs`。A2先让TodoIntake保存并解析完整引用；
Demand Publication的当前caller selection随后必须与Intake references精确相等，A6再删除重复输入。这样可逐步闭合而不建立兼容分支。

#### `parked`不能继续只有表示能力

旧产品允许`parked`表示已确认的依赖等待，并要求`Auto Claim: no`；当前TS却只有创建parked，没有activate、withdraw或archive路径。成熟系统把
暂停与恢复作为成对转换，例如[Kubernetes Job suspend/resume](https://kubernetes.io/docs/concepts/workloads/controllers/job/)；任务系统也区分
“完成”和“不再计划”，例如[GitHub issue close reason](https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/filtering-projects)。

如果保留parked，推荐补齐pre-demand状态机：

```text
ready intake  → pending-claim ─→ claimed ─→ archived
parked intake → parked ─activate→ pending-claim
pending-claim / parked ─withdraw→ withdrawn
```

`withdrawn`只表示未形成Demand的TODO被明确撤回，保存reason/revision/digest/time；claimed以后必须走Demand Cancellation或BusinessArchive，不能
withdraw。`activate`和`withdraw`都复用现有Collection lock、CAS、TodoTransaction与恢复存储，不引入Event Sourcing。

#### 待确认范围

**A2-F（推荐）：完整pre-demand调度模型**

- 采用上述字段矩阵；
- 保留ready/parked与Auto Claim；
- 同轮设计并依次实现`activate`、`withdraw`纯状态/Transaction/Service能力；
- Public Intake/Inspection仍在后续单元，不在A2直接注册工具。

**A2-M：最小ready-only模型**

- Intake只允许ready，删除parked/trigger；
- 保留Auto Claim；
- 不实现activate/withdraw，未准备好或不再计划的候选不进入TODO；
- 代码更少，但不再承载旧产品的显式依赖等待/backlog能力。

不推荐保留当前`initialStatus + dependency`而继续没有转换入口：它既不是完整队列，也不是严格ready-only intake。

### 13.38 A2-F1：不可变 TODO Intake 合同与直接消费者

A2-F 按文件级顺序先关闭 Intake，不提前实现状态转换或公共工具。`TodoIntake` v1 已一次性采用新 TS 合同，不保留旧字段兼容分支：

- 新增 `programId / originWindowId / controllerWindowId / intakeRationale`；`type` 改为 `demandType`，`goal` 改为只用于排队观察的 `summary`；
- `initialStatus + dependency` 合并为 `ready | parked` 判别联合 `readiness`，并强制 parked 不能开启 `autoClaim`；
- 删除无领域消费者的 `affectsRetestOrDispatch`，以 1～32 个完整 `LedgerAuthorityMemberReference` 替换 path-only `documents`；
- 按 Demand 类型强制最小 Authority role 闭包，草稿入口排序引用，磁盘入口拒绝非规范顺序、重复 member ref 和缺失角色；
- `real-environment` 精确绑定唯一 `test-environment` member，research 只允许 `not-applicable`，其他 Demand 类型拒绝该模式；
- Schema 只关闭可移植结构，codec 关闭类型化身份、规范 Unicode、引用与字段关系；Config 中 Program/Window 当前性和 Ledger 物理存在性仍由未来 Planning 复验。

`TodoState` 的 revision 1 现在从 `readiness` 派生 `pending-claim / parked`；`TodoTransaction` 的 append 关系同步更新，并补齐嵌套 Intake 新增 Ledger member schema 后的运行时 Schema 依赖目录。Markdown Board 改为显示 Demand 类型、来源/Controller 窗口、摘要、接收理由、trigger、测试决定和带角色的 Authority member 链接，不再展示旧 Goal、推荐窗口或 path-only documents。

Demand Publication 与 Tasking 真实 fixture 已调整为先发布 Ledger record，再由 `published.loaded` 生成带 record/member digest 的引用，最后创建 TODO；同一引用集合继续进入 Demand Authority，避免测试以占位路径掩盖断链。8 MiB Board 上限保持不变，新行宽下 248 条最大摘要记录仍合法，第 249 条在 journal 创建前被拒绝。

```text
A2-F1 focused: 83 pass / 0 fail / 0 skip
  TODO owner: 52
  Demand Publication + Tasking direct consumers: 31
TypeScript: pass
Schema: 106 / 215 external refs
Schema digest: sha256:46bda0f309a6242e74340e8b9aef19f025a7a1ad577a75131f3992cf645f3012
Architecture: parser=swc / 770 modules / 5499 dependencies / 0 violations
Candidates: Codex 465 / Claude Code 470 / releaseEligible=false
```

A2-F1 尚未增加 `activate / withdraw / withdrawn`，也没有注册 TODO Intake/Inspection 公共 MCP；当前 parked 仍只能创建、不能恢复。下一审阅单元 A2-F2 才修改 `TodoState`、`TodoTransaction` 与 Collection Service 的前置 Demand 转换，并继续复用现有锁、CAS、journal 和恢复存储。

### 13.39 A2-F2a：TODO State 的 activate/withdraw 纯状态语义

本单元只审阅并修改 `todo-state.schema.json`、`todo-state.ts` 与对应聚焦测试，尚未授权任何新的磁盘 mutation：

- `TodoStatus` 新增 `withdrawn`；该状态只终止尚未形成 Demand 的 `pending-claim / parked` 条目；
- `withdrawal={reason, withdrawnAt}` 与 `updatedAt`、revision、previous state digest共同形成撤回终态证明；reason执行长度、首尾空白、well-formed Unicode、NFC和控制字符校验；
- `activateTodoState(...)` 只允许 `parked → pending-claim`，复用不可变Intake中的原始trigger，不另建长期activation receipt；
- `withdrawTodoState(...)` 只允许 `pending-claim|parked → withdrawn`；claimed/withdrawn/archived均不能撤回，claimed以后继续属于Demand lifecycle或Business Archive；
- `claimTodoState(...)` 与 `archiveTodoState(...)` 显式保持`withdrawal=null`；状态载荷、最低revision、mount、withdrawal和archive关系全部失败关闭；
- 所有转换先验证状态、输入、revision和摘要，再读取wall clock；本模块仍为无I/O纯函数，不增加Event Store。

```text
State focused: 11 pass / 0 fail / 0 skip
Intake + State + Transaction + Collection projection regression: 29 pass
TypeScript: pass
Schema: 106 / 215 external refs
Schema digest: sha256:9883d700ab8b7317221f16c6cdd5a3bc590a2ff35c900dbc078ad8efcca4fa2b
Architecture: parser=swc / 770 modules / 5499 dependencies / 0 violations
git diff --check: pass
```

该步骤只是A2-F2的状态骨干，尚未完成耐久能力。代码审阅发现`TodoCollectionSnapshot.activeItemCount`和Board目前只排除`archived`，因此会把合法`withdrawn`误当成活动条目；Transaction也尚无activate/withdraw operation，Service/Recovery更没有写入入口。下一审阅单元应先修正`todo-collection.ts + todo-board-projection.ts`的终态消费，再进入Transaction/Service，不能提前把纯状态函数写成已可用产品能力。

### 13.40 A2-F2b：TODO 活动集合与 Board 终态语义

`todo-collection.ts`现在拥有唯一的`isTodoCollectionStatusActive(...)`调度分类，`todo-board-projection.ts`直接复用，不再分别维护终态判断：

```text
活动调度：pending-claim / parked / claimed
终态保留：withdrawn / archived
```

终态条目不会从JSON Authority或`collectionDigest`删除，`itemCount`继续包含它们；它们只从`activeItemCount`和活动Markdown Board中排除。因此withdraw保留可审计事实但不会重新进入调度，archive也维持原有行为。Board仍是单向可重建投影，不能反向驱动任何转换。

聚焦测试新增五状态分类矩阵，并在同一集合中验证withdrawn/archived均保留不同权威摘要、活动数为0且Board不泄漏终态行。完整TODO聚焦面56项通过；Schema 106/215、Architecture 770/5499/0违规及`git diff --check`继续通过。

A2-F2仍未闭合：纯State转换已有正确读模型，但没有可恢复写入者。下一审阅单元进入`todo-transaction.schema.json + todo-transaction.ts`，增加activate/withdraw operation及exact source/target关系；在Transaction完成前不修改Service或注册公共工具。

### 13.41 A2-F2c：TODO Transaction操作矩阵

`todo-transaction.schema.json`与`todo-transaction.ts`现在统一承载五种恢复操作：

| operation | target State | targetIntake | expected State |
| --- | --- | --- | --- |
| append | Intake Readiness派生的revision 1 | 完整Intake | null |
| activate | pending-claim | null | exact digest必需 |
| withdraw | withdrawn | null | exact digest必需 |
| claim | claimed | null | exact digest必需 |
| archive | archived | null | exact digest必需 |

四种State mutation共享同一CAS信封：expected collection/intake/state digests、完整target State、target State/Collection digests和createdAt。Codec要求`targetState.previousStateDigest === expectedStateDigest`、target时间等于transaction时间、目标集合摘要不同，并按operation关闭目标status。它不保存可变phase，也不把完整旧State复制进journal。

源状态是否合法仍由创建transaction时持有完整前序State的Collection owner校验：Journal只需要exact digest在崩溃恢复时区分source、target与conflict。当前通用Transaction Storage的类型面已经接受新operation，但尚未运行activate/withdraw物理替换与恢复测试，也没有Service producer；因此本单元仍不是可调用的耐久mutation。

Transaction聚焦5项、完整TODO聚焦57项通过；Schema 106/215，digest
`sha256:822fadf056de707784c6440ca1a04d438cb3bd3aff62f5b78704a43817760b2b`；Architecture 770模块/5499依赖/0违规，`git diff --check`通过。

下一单元应审阅`todo-collection-transaction-storage.ts`的`buildTransaction / ensureStateTarget / recovery`，用完整expected State关闭source→target单步关系，并做activate/withdraw真实磁盘与崩溃重放测试；随后Service才可暴露领域入口。

### 13.42 A2-F2d：TODO Transaction Storage真实写入与恢复

`todo-collection-transaction-storage.ts`现在在任何容量计算、journal或stage写入前，用完整Intake/source/target关闭状态变更：

- activate只接受parked source；
- withdraw只接受pending-claim或parked source；
- claim只接受pending-claim source；
- archive只接受claimed source；
- source、target与Intake必须是同一todoId；
- target revision必须严格等于source revision + 1；
- target previous digest必须等于完整source State的Canonical摘要。

非法source状态、revision跳跃或身份关系以`transition`失败，并通过空临时根证明不会创建任何文件。合法activate/withdraw继续复用既有state exact-source atomic replace、同一collection journal、Board deterministic rewrite和journal-last retirement；没有第二套存储路径。

真实磁盘测试覆盖两种正常提交，以及“State已替换、Board目标被symlink阻断”的崩溃点。失败时journal保留；显式Recovery识别当前State已是exact target，不重写Authority，只修复Board并退休journal。withdrawn条目继续保留在Authority/digest中，但Recovery后的活动数量与Board均排除它。

Storage聚焦4项、完整TODO聚焦60项通过；Schema 106/215，digest
`sha256:822fadf056de707784c6440ca1a04d438cb3bd3aff62f5b78704a43817760b2b`；Architecture 770模块/5502依赖/0违规，`git diff --check`通过。

A2-F2现在只缺Service领域入口。下一单元审阅`todo-collection-service.ts`及其测试，增加严格activate/withdraw输入、集合与item CAS、clock/error映射和Recovery结果；Public仍后置。

### 13.43 A2-F2e：TODO Collection Service与A2内部闭合

`todo-collection-service.ts`现在提供两个新的内部领域入口：

| 入口 | 调用方输入 | owner派生 |
| --- | --- | --- |
| `activateTodoItem` | todoId、intakeDigest、stateDigest | target revision/digest/status、时间、transaction与projection |
| `withdrawTodoItem` | todoId、intakeDigest、stateDigest、reason | withdrawn载荷、时间、target摘要、transaction与projection |

两者复用现有collection短锁、可选expected collection CAS、item Intake/State双摘要CAS、State纯转换、Transaction Storage和通用Recovery。调用方不能提供目标State、operation journal、revision或时间。局部`expectedItemForMutation(...)`同时收敛claim/archive重复的not-found与CAS逻辑，没有增加Manager或第二写owner。

Service错误保持稳定：状态不允许映射为`transition`；stale item/collection映射为`cas-mismatch`；withdraw reason与closed input错误映射为`input`；State/Intake已包装的clock错误统一映射到`$options/clock`，并删除原先不可达的`UtcWallClockError`分支。无效reason或clock不会创建journal或改变Authority。

真实Service测试覆盖正常activate/withdraw、stale摘要、重复activate、withdrawn后禁止claim、终态Board语义，以及State已提交但Board失败后的两类显式Recovery。Service 14项、完整TODO 62项通过；Schema 106/215，digest
`sha256:822fadf056de707784c6440ca1a04d438cb3bd3aff62f5b78704a43817760b2b`；Architecture 770/5502/0违规；候选Codex 465、Claude Code 470且`releaseEligible=false`；Atlas与`git diff --check`通过。

A2-F2至此完成“内部手动pre-demand生命周期”：ready/parked创建、activate、withdraw、claim和archive均有唯一State/Transaction/Storage/Service路径。它仍没有Public Intake/Inspection/activate/withdraw工具，也没有Auto Claim scheduler；`autoClaim`只保存策略，未来consumer必须服从mainline availability与Controller authority，不能在本单元悄悄自动执行。进入A3前应先做一次A2范围复核，再决定Ledger Publication Public的首文件。

### 13.44 A2整体核实结论

本节点重新读取TODO 15个生产模块、5份手写Schema、10个聚焦测试文件、Demand Publication/Lifecycle直接consumer与公共工具catalog。核实发现并修复一项真实Authority缺陷：State codec单独看不到Intake，原Collection只核对todoId，因而可能接受“ready Intake + parked revision 1”或revision跳跃等形式合法但不可达的配对。

`todo-collection.ts`现在按不可变Intake Readiness关闭精确revision矩阵：

| 初始Readiness | pending-claim | parked | claimed | withdrawn | archived |
| --- | ---: | ---: | ---: | ---: | ---: |
| ready | 1 | 不可达 | 2 | 2 | 3 |
| parked | 2 | 1 | 3 | 2 | 4 |

违反矩阵以`item-lineage`失败，物理Authority加载、Transaction目标集合和Board渲染都会共同消费该门。测试同时覆盖两个不可达负例，以及parked→activate→claim→archive完整1/2/3/4正向链。

#### A2已闭合

- typed `todo_<UUIDv4>` identity，无旧格式兼容；
- Ledger-bound immutable Intake、角色闭包与测试环境关系；
- ready/parked/activate/withdraw/claim/archive可达状态与精确revision；
- withdrawn/archived终态保留Authority但退出活动计数/Board；
- 五操作journal、完整source→target、atomic replace、CAS、锁、崩溃Recovery；
- 单一Collection Service写owner及稳定错误映射。

#### 明确后续，不是A2漏洞

- `programId`和窗口当前拓扑、Ledger引用物理/current关系：由未来Intake Planning基于Config/Ledger复验；
- `priority / summary / intakeRationale / originWindow / controllerWindow`：当前Board消费，未来Inspection/Planning继续消费；
- `autoClaim`：当前只有持久策略与Board，没有scheduler；未来必须先证明idle healthy mainline和Controller authority；
- Demand Publication仍由caller重复提交Ledger selectors，尚未精确等同`intake.authorityRefs`：留给A6；
- Public Ledger/TODO producer、Inspection和pre-demand mutation工具均不存在，19工具catalog未变化。

最终验证为TODO 63项 + Demand Publication/Tasking 31项，共94项通过；Schema 106/215、digest
`sha256:822fadf056de707784c6440ca1a04d438cb3bd3aff62f5b78704a43817760b2b`；Architecture 770/5502/0违规；候选465/470且`releaseEligible=false`；Atlas与`git diff --check`通过。未运行完整TypeScript清单、插件validate/smoke或release gate。

A2可以关闭。原路线A3仍成立：Ledger Publication Public是空Workspace创建合法TODO的前置producer。下一步先审阅Ledger Record/Store、公共Planning/Application惯例和Requirement/Confirmation最小author-owned输入，再向用户提交首文件方案，不直接编码。

### 13.45 A3 Ledger Publication Public设计审阅

本轮读取Ledger 12个生产模块、4份Schema、5个聚焦测试文件，交叉核对Demand/TODO/Tasking/Evidence消费者、旧JS Ledger/TODO公共面、本机TencentDB-Agent-Memory的Route→Service→Store实现，以及MCP/AIP/OCI官方规范。没有修改运行时代码。

#### 现有内核已经足够

当前Ledger不需要重写Store：Requirement/Confirmation Record已关闭typed ID、Program/Demand关系、角色、路径排序/碰撞、media type、digest和确定文档；Publisher执行per-record lock、compact intent、完整candidate tree、same-filesystem directory publish、readback、intent-last retirement和幂等复用；Recovery能从完整stage前向提交，partial stage明确返回`recovery-input-required`。长期记录为0755/0644，事务资源为0700/0600。

缺口只在公共纵切：author-owned输入、Config/Design source Planning、exact public plan、Application错误authority、wire Schema/Coordinator/MCP接线。旧JS没有独立Ledger producer，`wakeflow_deliver`直接追加path-only TODO，不能作为新TS方案。

TencentDB-Agent-Memory采用每类资源独立Route和Schema准入，再委托共享MetadataService/Store；这支持“公共名称按业务类别清晰、内部物理能力共享”的方向。但其数据库写入/ACL/补偿语义不适用于Wakeflow本地immutable tree，不能照搬SQLite或把跨owner失败伪装为原子事务。

[MCP 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/schema)要求tool输入/输出以JSON Schema表达；annotations只是提示，不能替代服务端确定性校验。[MCP tool annotations说明](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/)建议本地追加型、可重试工具使用`destructiveHint=false / idempotentHint=true / openWorldHint=false`，但实际安全仍由Store证明。[AIP-155](https://google.aip.dev/155)把稳定request identity用于重试去重；Wakeflow由preview生成完整plan/record ID并在apply重放同一plan，承担同类职责。[OCI Descriptor](https://specs.opencontainers.org/image-spec/descriptor/?v=v1.1.0)要求消费者核对media type、digest与size，适合Public plan保存成员描述符而不复制正文。

#### 推荐方案A3-S：两个公共工具，共享内部pipeline

```text
wakeflow_publish_requirement
wakeflow_publish_confirmation
```

两个工具都采用`preview / apply / recover`，共享Ledger source selection、plan codec、Planning/Application Service和现有Store；不复制物理事务。分开公共名称的理由是业务语义不同：Requirement是S1设计权威，Confirmation预分配一个未来isolated Demand身份；后者preview同时分配`confirmationId + demandId`，调用方不能自造。现有Demand Publication随后从Confirmation引用派生该Demand ID。

Public preview只接收：

- Requirement/Confirmation title；
- 一个明确的`designSurfaceId`；
- 1～32个`{role, path}`成员选择。

Planning验证surface在当前Config中存在、capability为design且placement current；每个path必须是该surface内的strict UTF-8/NFC/LF Markdown普通文件。成员`path`同时成为Ledger member path，`mediaType`固定由owner派生为`text/markdown`。第一版不接受inline正文、多source root、repository raw file、绝对路径、caller digest/size/ID/time或任意media type。

Preview稳定读取全部文件后才分配ID/time，返回不含正文bytes的完整plan：Config digest、surface/member selectors、size/digest descriptors、Record、compact publication intent/tree plan和planDigest。Apply重新打开当前Config/source，逐成员复验size/digest后调用Store；exact plan重试幂等。若崩溃留下incomplete stage且源文件不再是原字节，Recover必须诚实返回`input-required`，不能从digest虚构内容；调用方保留Design源直到publication current。

Apply/Recover成功只返回record ID/ref/digest与完整member references，不返回源物理路径或正文。A3不建立Ledger Markdown projection、列表cache、通用文件上传器，也不与TODO Intake合并为跨根Saga。

#### 其他候选

- **A3-U：一个`wakeflow_publish_ledger_record`判别联合工具。** 工具更少，但Requirement与Confirmation的语义、ID分配和恢复提示混在一个名字中；与用户要求的业务类别清晰及Tencent的资源Route风格不如A3-S。
- **A3-I：inline Markdown正文。** 实现短，但把最多16MiB内容复制进MCP request/preview，增加隐私、上下文和重试成本，也失去Design source稳定观察；不推荐。
- **A3-M：每个成员任意repository/support source。** 最灵活但过早引入跨根选择、混合信任和映射语义；Design可先把确认文档写入Design surface，真实consumer出现后再扩。

#### 首文件顺序

用户确认A3-S后，第一审阅单元为`src/governance/ledger/ledger-authority-publication-input.ts`及聚焦测试。它只定义Requirement/Confirmation author-owned判别联合、designSurfaceId、family-specific role/path选择、排序/唯一性与停止边界；不读取Config/files、不分配ID、不生成plan。随后依次进入Plan codec→Planning→Application/Recovery→两套Public wire/Coordinator→MCP接线。

### 13.46 A3-S1 Ledger Authority Publication Input

新增`ledger-authority-publication-input.ts`，但没有把family重新暴露给两个独立公共工具。文件提供两个专用入口：

- `parseRequirementAuthorityPublicationInput(...)`；
- `parseConfirmationAuthorityPublicationInput(...)`。

两者接收相同的最小author-owned字段`title / designSurfaceId / documents[{role,path}]`，由parser固定注入`family`。因此未来`wakeflow_publish_requirement`调用方不能提交confirmation family，反之亦然；Public Coordinator也不需要信任重复判别字段。

文档选择执行：1～32项上限、family-specific role、`.md`后缀、portable relative path、拒绝`.git/.wakeflow-active/.wakeflow-local`、根`record.json`、反斜杠/遍历、精确重复、case碰撞和file/directory prefix碰撞，并按path排序后递归冻结。Role允许表使用`Record<Role,true>`穷尽映射，未来Record Schema联合新增role时TypeScript会要求同步，而不是Set静默漏项。

title执行well-formed Unicode、NFC、首尾非空白、控制字符和8192 code points限制；designSurfaceId只做typed surface词法，Config capability/placement仍属于Planning。输入明确拒绝family、program/record/demand ID、time、digest、size、mediaType和inline content；固定media type常量为`text/markdown`。

新文件聚焦5项、Ledger完整6文件22项通过；Schema仍106/215，Architecture变为772模块/5508依赖/0违规；候选仍465/470且`releaseEligible=false`，`git diff --check`通过。下一单元进入`ledger-authority-publication-plan.ts`：定义Config/source descriptors、Record/Intent与planDigest关系，不执行I/O。

### 13.47 A3-S2 Ledger Authority Publication Plan

新增`ledger-authority-publication-plan.ts`。Plan没有再保存一份member descriptors：现有compact `LedgerRecordPublicationIntent`已经包含完整Record、每个member的path/digest/media type、tree plan中的size/mode/digest，以及final/intent/lock/stage refs。新Plan只增加：

```text
kind + schemaVersion
configDigest
designSurfaceId
intent
```

成员正文仍不进入Plan。`computeLedgerAuthorityPublicationPlanDigest(...)`对完整规范化Plan计算Canonical JSON摘要；Plan对象自身不内嵌摘要，Public preview未来返回`plan + planDigest`，避免自引用。

Plan parser不信任Planning构造物：先严格解析Config digest和compact Intent，再从Intent Record重建A3-S1输入，重新执行family role、Design surface typed ID、`.md` path、排序/collision和title profile；并强制所有member media type为owner固定的`text/markdown`。因此伪造Plan不能把`text/plain`、`.git`路径、非法surface或跨family role带入Apply。

Requirement与Confirmation使用同一Plan；Confirmation Record内owner-derived future Demand ID原样保留。Plan只证明preview一致，不证明Config仍current、Design surface placement有效、source bytes未漂移或已获得写权限，这些属于Planning/Application。

新增Plan测试5项，完整Ledger 7文件27项通过；Schema仍106/215，Architecture774模块/5520依赖/0违规；候选465/470且`releaseEligible=false`，`git diff --check`通过。下一单元进入零写Planning Service：读取Config、验证Design surface、strict-read成员、最后分配ID/time并创建Record/Intent/Plan。

### 13.48 A3-S3 Ledger Authority Publication零写Planning

本单元新增两个相邻生产职责，没有建立通用File Manager或配置根注册表：

- `ledger-authority-publication-source.ts`只负责把当前Config唯一Design窗口绑定的support surface解析为稳定根，4路有界读取1～32份strict UTF-8/NFC/LF Markdown，并签发`path / node / byteCount / digest`观察；
- `ledger-authority-publication-planning-service.ts`负责Config current、Ledger固定布局、ID/time分配、Record/compact Intent/tree plan、目标占用检查及`plan + planDigest`。

Requirement与Confirmation使用两个独立preview方法，调用方仍不能提交family。Requirement只分配`requirementId`；Confirmation恰好分配`confirmationId + future demandId`，并在Workspace中检查该Demand最终根及Publication stage/transaction/lock均未被占用。两类记录都从Config派生`programId`，从稳定source派生media type、size与digest，从owner clock派生唯一`recordedAt`。

多文件读取没有伪装成文件系统事务。Node 24明确说明Promise文件系统操作本身不提供跨操作同步，因此本实现先逐文件用既有no-follow FileHandle内核完成稳定读取，再在ID分配后重新打开Design根，按原节点、size和digest进行第二遍流式复验；任何成员漂移都在读取clock之前以`source-changed`停止。[Node.js v24 fs文档](https://nodejs.org/docs/latest-v24.x/api/fs.html)同时说明FileHandle封装真实文件描述符且必须显式关闭，本实现所有成功/失败路径均显式关闭Design与Ledger根。

Plan只携带内容描述符，不复制Markdown正文；这沿用[OCI Content Descriptor](https://github.com/opencontainers/image-spec/blob/main/descriptor.md)的media type、原始字节size和digest关系。Application仍必须重新读取并同时验证size/digest，Planning成功不授予写入权限。

实现顺序刻意让可预见失败尽量早发生：输入/Config/source profile/容量/Ledger layout先用固定验证身份和时间关闭，不消费注入Factory或Clock；随后分配真实ID、检查Ledger及future Demand占用；二次source与Config复验成功后才读取一次clock。Preview不创建Ledger intent/stage/final目录，也不创建`.wakeflow-active`。

真实临时目录测试5项覆盖Requirement/Confirmation owner字段、无正文Plan与零写、错误surface/缺失文件/CRLF在ID分配前失败、UUID分配期间改写Markdown被第二遍复验捕获、Ledger目标占用和Confirmation重复UUID。完整Ledger 8文件32项通过；Schema仍106/215且digest不变，Architecture为777模块/5562依赖/0违规，`git diff --check`通过。未运行完整TypeScript、插件smoke或release gate。

下一单元进入A3-S4 Application前的材料化边界审阅：需要决定是先建立“按Plan重读并返回exact member bytes”的无写Payload Materializer，还是直接把该职责嵌入Application。优先选择能让source drift、input-required和Store调用保持单一写owner的最小方案，不提前接Public/MCP。

### 13.49 A3-S4 Ledger Authority Publication Payload Materializer

按确认的独立方案新增`ledger-authority-publication-payload-materializer.ts`，并扩展相邻Source模块的内存payload入口。Materializer是函数而非class：它不持有跨调用状态，只在一次操作中接收Workspace `RootedDirectory`和exact Plan，返回现有`LedgerAuthorityStore.publish(...)`可直接消费的有序`{path, bytes}`成员。

执行顺序固定为：

```text
严格解析Plan与options
→ 重新读取Config并核对configDigest/programId
→ 从Plan Record重建family-specific Design source选择
→ 第一遍strict-read形成node/size/digest观察
→ 与Record digest及tree-plan size/digest逐成员核对
→ 第二遍按原节点strict-read并取得exact bytes
→ 对返回bytes再次核对size/digest
→ 重新读取Config确认未漂移
→ 返回内存payload
```

Source模块没有要求Foundation返回raw bytes；Strict Text已经拒绝BOM、非法UTF-8、CRLF、非NFC和非唯一末尾LF，因此可把验证后的文本重新编码为唯一UTF-8字节，并再次核对原稳定读取的byte count和SHA-256。第二遍读取带`expectedNode`，既是多文件二次复验，也是字节取得点。返回数组和成员对象冻结，`Uint8Array`是每次调用新建的调用方副本；调用方即使修改，后续Store仍会独立重算Record声明摘要。

本模块不打开Ledger根，不检查或创建intent/stage/final，不选择Apply/Recover，也不缓存正文。`source-changed`、stale Config、malformed Plan和pre-aborted均在任何Ledger写入前失败。Application下一步只需验证public plan digest、打开Ledger/检查Publication authority，然后把Materializer结果交给Store；无需再拥有一份文件读取实现。

测试环境初始化已从Planning测试提取为`ledger-authority-publication.fixture.ts`，供Planning、Payload及后续Application/Recovery共享，减少Config/Design/Ledger夹具复制。新增Materializer 6项（1个父测试+5个子测试），完整Ledger 9个测试文件38项通过；Schema仍106/215且digest不变，Architecture为780模块/5580依赖/0违规，Atlas与`git diff --check`随后同步核验。未运行完整TypeScript、插件smoke或release gate。

下一单元进入A3-S5 Application/Recovery编排设计。首要问题不再是如何读取bytes，而是现有Store的`publish / recoverRecordPublication`两条路径如何与exact Plan、Config current及partial stage的`recovery-input-required`组合成一个无重复状态机的领域Service。

### 13.50 A3-S5a Ledger Store exact-intent Recovery

Application设计审阅发现：若只在Application外层读取`transactions/<recordId>.intent.json`再调用原Store恢复，会在检查与锁之间留下竞态，也无法正确处理intent文件自身的durable atomic stage。为避免把恢复状态判断复制到Application，本单元先在既有Store owner内部增加exact入口，尚未创建Application Service。

`ledger-record-publication-recovery.ts`把原恢复过程收敛为一个共享私有函数：

- 旧`recoverLedgerAuthorityRecordPublication(root, recordId, signal)`保留，继续服务只凭Ledger自身证据的内部维护恢复；
- 新`recoverExactLedgerAuthorityRecordPublication(root, expectedIntent, signal)`先严格解析expected intent，从中派生family/record ID，再进入同一恢复过程；
- target-scoped atomic intent stage恢复后、取得逐记录锁前，持久intent必须与expected逐字段相同；
- 取得锁并重新读取后，再次同时核对首次观察和expected，随后才允许检查stage/final并前向提交；
- complete stage、partial stage `recovery-input-required`、post-rename intent retirement和锁恢复继续使用原实现，没有新增phase、journal或第二状态机。

`LedgerAuthorityStore`只新增薄门面`recoverExactRecordPublication(expectedIntent, options)`，继续使用原`LedgerAuthorityStoreOptions`与结果合同。后续Application不需要导入私有storage函数，也不能在Store外自行解释intent/stage/final组合。

Store测试把complete-stage和partial-stage路径切换到exact入口，并新增“同record ID、不同Record内容”的冲突测试：调用后原intent与完整stage仍存在，final与lock均不存在，证明差异在逐记录锁及发布前关闭。旧按ID入口仍由missing-intent和post-rename路径覆盖。

完整Ledger 39项通过；Schema仍106/215且digest不变，Architecture保持780模块/5580依赖/0违规，`git diff --check`通过。A3-S5a只是Store能力加固，不是Application或Public producer。下一单元A3-S5b可以只新增Application Service与测试：Apply组合Payload Materializer→Store.publish，Recover组合exact Plan/digest→Store exact recovery，并统一错误authority。

### 13.51 A3-S5b Ledger Authority Publication Application Service

新增`ledger-authority-publication-application-service.ts`，成为Plan确认之后唯一的Ledger Publication领域编排owner。它没有复制Store状态机：

- `apply(plan, planDigest)`先严格重算Canonical摘要，再通过A3-S4 Materializer取得exact source bytes；
- 重新读取当前Config、核对Program/config digest并打开current Ledger placement；
- 先调用A3-S5a exact Recovery观察是否已有同一intent：complete stage/final直接前向完成，partial stage标记为recoverable并随后用payload调用原`Store.publish`补齐；
- exact intent与final均不存在时，先严格读取final确认不是幂等current；Confirmation首次写入还要复验future Demand根、stage、transaction与lock均未占用；
- `recover(plan, planDigest)`不读取Design source，只允许exact complete stage/post-rename final前向完成；partial stage返回`input-required`，调用方必须保留原Plan并重新`apply`提供字节；
- intent已退休但final完整时，严格Reader验证整个目录树、Record及每个member的size/digest后返回`current`；无操作返回`not-found`，无intent的孤立stage/lock/final竞态返回`recovery-required`。

成功结果区分`published / recovered / current`，返回内部loaded record和由Reader事实创建的完整member references；Public层后续只投影稳定record/member receipt，不暴露节点或物理路径。失败错误携带`publicationAuthority`：`unchanged / recoverable / current / unknown`，避免把取消、partial stage、已提交final或孤立residue混成同一种“重试失败”。

写入边界尤其保持两点：Apply只有在payload、Config和Ledger布局都关闭后才进入Store；一旦exact intent已存在，前向恢复优先于future Demand首次占用门，防止已开始事务被后续观察倒退阻断。Config digest若与Plan不同则保守停止，因为当前Plan不保存旧Ledger placement，Application不能猜测迁移前根。

真实测试7项（1个父测试+6个子测试）覆盖首次发布/幂等current、Confirmation future Demand冲突、删除Design source后的complete-stage Recover、partial-stage input-required→Apply补齐、错误digest/stale Config零写，以及absent与orphan residue分类。完整Ledger 46项通过；Schema仍106/215且digest不变，Architecture为782模块/5606依赖/0违规，`git diff --check`通过。未运行完整TypeScript、插件smoke或release gate。

A3内部纵切现在已经具有Input→Plan→Planning→Payload→Application/Recovery→Store。下一单元进入A3-S6公共合同设计：分别为Requirement与Confirmation定义preview/apply/recover wire Schema和metadata-only receipt，再建立共享Coordinator；仍先不接MCP注册。

### 13.52 A3-S6a Requirement Publication Public Schema

新增两份Schema正典及其生成合同：

- `wakeflow-requirement-publication-request.schema.json`；
- `wakeflow-requirement-publication-result.schema.json`。

Request是preview/apply/recover判别联合。Preview只允许`root / mode / title / designSurfaceId / documents[{role,path}]`，不接收family、Requirement/Program ID、time、media type、digest、size、bytes或Ledger路径。Role只允许Requirement联合，path必须同时满足portable path与Markdown外形；大小写保留根、前缀碰撞和Unicode NFC仍由A3-S1领域parser作最终关闭。Apply与Recover都必须交回exact `plan + planDigest`；Recover不允许只提交Requirement ID。

Result保持对象根和三模式判别联合。Preview返回完整Plan/digest供确认；Apply/Recover只返回metadata receipt：`publicationAuthority=current`、disposition、Requirement ID、record ref/digest和1～32份完整Requirement member references。Member reference在wire内自包含，并收窄`family=requirement`、Requirement roles及`mediaType=text/markdown`，不直接复用允许Confirmation的宽领域Schema。Loaded record、source node/bytes、absolute path、stage、lock和恢复capability均不能出现在结果中。

模式关系进一步关闭：Apply receipt允许`published / recovered / current`；Recover只允许`recovered / current`，Schema拒绝“不可能的Recover首次published”。Recover成功也带planDigest，因为该Application明确按exact Plan恢复。

[MCP 2025-11-25 Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)要求input参数符合`inputSchema`，定义`outputSchema`时structured result应满足它；[2026-07-28规范候选说明](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/)虽然允许完整JSON Schema 2020-12组合与引用，也明确实现不应自动解引用外部URI。因此Wakeflow继续发布无外部`urn:`引用的自包含工具Schema。

真实Schema测试使用当前Planning/Application生成preview、published和current recovery结果，并覆盖family/ID/inline content/Confirmation role/保留路径拒绝、Recover缺Plan/digest、wrong family/media type、内部loaded泄漏和不可能disposition。通用MCP wire测试已把新request/result加入SHA-256词法镜像清单。

Schema总数增至108，external refs保持215，digest为`sha256:4824467bf57ac7095794d7e53d9534ec783715000bf324edd352d70abbf16d66`；完整Ledger 47项通过，Architecture为785模块/5612依赖/0违规，`git diff --check`通过。尚无Public parser、Coordinator或MCP注册。下一单元A3-S6b按同一原则实现Confirmation request/result Schema，并额外公开owner-derived future Demand ID。

### 13.53 A3-S6b Confirmation Publication Public Schema

新增Confirmation专用request/result Schema及生成合同。它没有把Requirement/Confirmation重新合并为带`family`的通用工具：公共名称、role联合、record ID和receipt继续按业务类别分开，内部才共享A3-S1～S5b pipeline。

Preview request与Requirement拥有相同字段层级，但只接受`goal-stage-decision / user-confirmation / requirement-delta / supporting-evidence`四类Confirmation Markdown选择。`confirmationId`与`demandId`均为additional property，调用方不能提交；Planning在preview中分配二者。Apply/Recover仍必须交回exact Plan/digest。

Preview result的完整Plan包含owner-derived future Demand ID，供调用方确认。Apply/Recover metadata receipt明确返回`confirmationId + demandId + recordRef/digest + Confirmation member references`；member reference固定`family=confirmation`、Confirmation roles和`text/markdown`。Demand ID使用领域名称`demandId`而非另造`futureDemandId`别名，其“未来”语义由Confirmation record生命周期表达。

Recover result沿用A3-S6a关系，只允许`recovered/current`，不允许`published`。结果不暴露Workspace/Design/Ledger物理路径、loaded record、source bytes/node、stage、lock或恢复capability。

真实Schema测试覆盖Preview拒绝caller-supplied family/Confirmation/Demand ID、Requirement role和inline bytes；验证Plan中的future Demand进入receipt；并拒绝缺失demandId、错误family/role及Recover=`published`。通用自包含wire测试已纳入两份新Schema及SHA-256词法镜像。

Schema总数增至110，external refs仍为215，digest为`sha256:34f6646e49bf84e2f6fcce96ab3da1d7b411f72a2202393752bed64bd3df0b71`；完整Ledger 48项通过，Architecture为788模块/5618依赖/0违规，`git diff --check`通过。A3两类wire Schema至此完成，但仍不是公共能力。下一单元A3-S7a应实现共享Public Contract：两个工具名、两套request parser、容量和递归冻结准入，不接Coordinator或MCP。

### 13.54 A3-S7a Ledger Authority Publication Public Contract

新增单一`ledger-authority-public-contract.ts`，共享两个工具真正相同的wire基础，同时保留两套独立类型和parser：

- `WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME = wakeflow_publish_requirement`；
- `WAKEFLOW_CONFIRMATION_PUBLICATION_PUBLIC_TOOL_NAME = wakeflow_publish_confirmation`；
- `parseRequirementPublicationPublicRequest(...)`；
- `parseConfirmationPublicationPublicRequest(...)`。

共同边界为被动JSON准入、递归冻结、RFC 8785 Canonical byte容量和稳定`json/capacity/schema/plan`错误。最大请求为2 MiB：现有compact Intent硬上限1 MiB，余量只服务Plan外壳、root、digest与JSON结构，不为inline payload预留空间。Accessor/Proxy、循环、非JSON值和超限值在任何领域调用前停止。

两个Schema的Apply/Recover顶层形状相同，Plan又刻意是开放object，由领域Plan parser关闭。若Contract只做Schema校验，Requirement Plan可以被提交给Confirmation工具。因此每个parser在Schema后纯内存调用`parseLedgerAuthorityPublicationPlan(...)`并核对Record artifact family；malformed Plan和cross-family Plan都以`plan`失败。Preview无需Plan，继续由各family Schema限制role与owner字段。

Contract只导出生成的request/result类型别名，不解析成功result、不打开Workspace、不读取Design/Ledger，也不调用Planning/Application。Plan digest相等性仍由Application复算；Contract family准入不是写入授权。

聚焦测试5项（1个父测试+4个子测试）验证稳定工具名、双Preview递归冻结、Apply/Recover正向准入与双向cross-family拒绝、schema/plan/capacity分类及getter零执行。完整Ledger 53项通过；Schema保持110/215及digest不变，Architecture为790模块/5629依赖/0违规，`git diff --check`通过。

下一单元A3-S7b进入共享Public Coordinator：分别暴露Requirement/Confirmation executor，路由preview/apply/recover，打开/关闭Workspace根，调用Planning/Application并投影符合两套result Schema的metadata receipt；仍不接MCP Server。

### 13.55 A3-S7b Ledger Authority Publication Public Coordinator

新增`ledger-authority-public-coordinator.ts`，导出两个独立、尚未注册MCP的executor：

- `executeRequirementPublicationPublicRequest(...)`；
- `executeConfirmationPublicationPublicRequest(...)`。

两者先使用A3-S7a各自parser，因此cross-family Plan在任何RootedDirectory打开前失败。进入Coordinator后共享Workspace根生命周期、私有根文本集合、模式路由、Planning/Application错误映射和result Schema回读；family只用于选择专用Planning方法、工具名、result kind/schema及receipt形状。

Preview检查title/documents不包含请求root或规范物理root文本，调用对应Planning并返回`ready + plan + planDigest`。Apply/Recover检查Plan隐私后只调用A3-S5b Application，继承其`unchanged/recoverable/current/unknown`效果权威。Coordinator不访问Store、不解释stage/lock或source，也不分配ID/time。

成功receipt再次关闭内部结果关系：Application operation必须等于请求mode；`current`与`wroteAuthority=false`一致，`published/recovered`与true一致；Recover不能published；record family、record ID/ref/digest及每个member reference的family、record、path、digest、role/media必须等于loaded事实。Requirement receipt只返回Requirement metadata；Confirmation额外返回owner-derived Demand ID。最终结果递归转为JSON、限制2 MiB、扫描私有根文本并通过对应output Schema，不直接序列化loaded对象。

Coordinator聚焦测试4项（1个父测试+3个子测试）完成双family真实preview/apply/recover，验证source drift映射为`apply/unchanged`、cross-family Plan在无效root之前失败、privacy/root错误保持unchanged，以及结果不含Workspace root、loaded或inode。完整Ledger 57项通过；Schema保持110/215及digest不变，Architecture为792模块/5640依赖/0违规，`git diff --check`通过。

A3现在只缺真实MCP组合与注册。下一单元必须先审阅Public Server options和Codex/Claude固定组合根的三文件耦合：若无法保持1～2文件编译闭合，应把它作为一个不可拆的注册单元明确处理，而不是引入可选executor或临时兼容分支。

### 13.56 A3-S8 Ledger Authority Publication MCP注册与双宿主接线

`wakeflow-public-mcp-server.ts`现在把Requirement与Confirmation作为两个独立、必填的公共executor：

- `publishRequirement`固定服务`wakeflow_publish_requirement`；
- `publishConfirmation`固定服务`wakeflow_publish_confirmation`；
- Server options继续执行closed shape、函数类型和Proxy拒绝，没有optional executor、缺能力降级或宿主条件分支；
- 两个工具分别发布自包含request/result Schema，成功返回Canonical文本与同事实`structuredContent`，已知失败返回不带stack/root的`isError`信封；
- 两者均声明`readOnlyHint=false / destructiveHint=false / idempotentHint=true / openWorldHint=false`，准确表达本地不可变记录的追加式、exact-plan重放语义。

[MCP 2025-11-25 Schema](https://modelcontextprotocol.io/specification/2025-11-25/schema)明确`outputSchema`约束`structuredContent`，并把annotations定义为客户端提示而非执行安全边界；[官方TypeScript SDK Server文档](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md)要求工具级错误以`isError=true`返回，便于模型观察与修正。因此Wakeflow继续由SDK执行wire前置校验，同时由Public Contract、Coordinator和Application重复关闭family、容量、根、source及效果权威，不依赖annotations授权写入。

Requirement工具的Apply重读并验证Design源字节；Recover不读取Design源，只使用exact Plan和持久intent/stage/final，partial stage缺字节时返回`input-required`。Confirmation遵循同一物理合同，但preview由owner同时分配Confirmation ID和未来isolated Demand ID；发布成功不等于创建Demand、TODO或执行Design。

Codex与Claude Code组合根同时注入同一对host-neutral Coordinator，没有新增宿主适配器。独立MCP测试用真实Codex Requirement完成`preview → apply → recover(current)`，再用真实Claude Confirmation完成`preview → apply`；另验证`recoverable`错误效果权威及root脱敏。Catalog逐项检查21个工具的名称、Schema、annotations、描述和双宿主集合，并遍历全部21个required executor的Proxy拒绝。

本单元聚焦Ledger与MCP共62项通过；Schema保持110/215及digest `sha256:34f6646e49bf84e2f6fcce96ab3da1d7b411f72a2202393752bed64bd3df0b71`；Architecture为793模块/5655依赖/0违规；候选构建为Codex 477、Claude Code 482，`releaseEligible=false`。A3至此完成真实空Workspace所需的Requirement/Confirmation Ledger producer公共纵切。

下一节点回到已确认路线A4，但先做`wakeflow_inspect_todo`只读查询的设计复核：重新检查当前Collection Authority、排序/filter/page cursor和公共最小披露，再确定首个1～2文件单元，不直接从内部TODO对象生成无界列表工具。

### 13.57 A4 TODO Inspection Public设计复核

本轮只做设计复核，没有修改运行时代码。读取了当前TODO 16个生产模块、5份领域Schema、11个测试/fixture，重点核对`todo-collection / todo-collection-authority / todo-collection-service / todo-board-projection / todo-intake / todo-state`；同时复查旧JS `wakeflow_next_work`、Design handoff和Controller候选扫描，阅读本机TencentDB-Agent-Memory的pagination、v3 router、MetadataService及SQLite/Mongo Store list实现，并联网核对MCP、AIP-158和Kubernetes一致分页规范。

#### 当前TS事实与不能直接包装的内部入口

当前JSON权威已经足够：每个TODO由不可变`intake.json`和唯一当前`state.json`组成；Collection按`createdAt ASC + todoId ASC`形成确定顺序和`collectionDigest`，最多65,536项。Authority reader有界扫描完整items tree，以16并发稳定读取两类0600文件，执行前后完整tree identity复验，并在`transactions/`非空时返回`recovery-required`。Markdown Board只是可重建投影，缺失/stale/unsafe不改变JSON Authority。

现有`inspectTodoItems(...)`不能成为公共结果。它返回完整`TodoCollectionAuthoritySnapshot`，其中包含每个文件的resource path、inode/node snapshot、byte count、物理digest，以及整份Board预期正文和projection source；这些是内部稳定读取与恢复证据，不是业务查询字段。直接序列化还会一次返回最多65,536份完整Intake/State，违反上下文与wire容量边界。

旧JS `wakeflow_next_work`在writer lock内读取整份8 MiB Markdown Board，返回所有rows和board digest；Design主要把digest交给后续append CAS，Controller自行选择候选。它没有分页/filter，也不真正选择“next”。新TS的A5 Intake将由owner读取当前集合并生成exact plan，不需要A4继续为写入暴露整板digest，因此公共名称应采用`wakeflow_inspect_todo`，明确它只观察、不选择、不领取。

TencentDB-Agent-Memory值得保留的是`Schema → Router → Service → Store`分层、list/get分离、默认20/最大100及统一分页信封。其list使用`limit + offset + total`并由SQLite/Mongo排序查询，适合数据库；但没有把一次list的snapshot version绑定后续页面，`ORDER BY created_at`也没有稳定tie-breaker。Wakeflow是会发生文件CAS更新的本地集合，不能直接照搬offset语义。

#### 标准化方案A：一致快照的list + exact item（推荐）

只注册一个只读工具`wakeflow_inspect_todo`，request使用两个关闭view：

```text
{ root, view: "list", filter?, pageSize?, pageToken? }
{ root, view: "item", todoId }
```

`list`的第一版filter只包含真实消费维度：`statuses[] / priorities[] / demandTypes[] / autoClaim / originWindowId`；缺省表示不过滤，不暗中替Controller判定“eligible”。集合顺序固定复用`createdAt ASC + todoId ASC`，不按priority重排，也不增加用户可选sort。`pageSize`可选，缺省或0使用20、最大100；大于100收窄为100，负数/非整数拒绝。后续页允许改变pageSize，其他filter必须与首请求相同。

返回list summary只含选择与进一步检查所需事实：TODO ID、创建/更新时间、当前status/revision、Demand type、priority、summary、当前parked trigger、origin/controller窗口、Auto Claim、testing mode、挂载Demand ID，以及Intake/State digest。它不返回完整Authority refs、intake rationale、withdraw/archive详情或物理来源。`item`按精确TODO ID返回完整业务Intake和脱敏State：保留Ledger member references与业务终态事实，但从mount移除`stateRootRef/identityDigest`，不返回文件node、绝对路径、Board正文、projection诊断、lock或transaction。

[AIP-158](https://google.aip.dev/158)要求list从第一版就分页、page token为URL-safe opaque值、后续请求除pageSize外保持其他参数一致；[Kubernetes API list](https://kubernetes.io/docs/reference/using-api/api-concepts/)进一步用固定resourceVersion与continue position保证多页来自同一snapshot。Wakeflow对应使用versioned opaque binary page token，内部绑定`collectionDigest + normalized filter digest + next offset`：

- 当前`collectionDigest`与token不同时返回稳定`stale-page-token`，要求从第一页重新开始；
- filter不同时返回`page-token-mismatch`；
- token只表示继续位置，不是授权、CAS或mutation capability；
- 不引入server-side session、token数据库、HMAC secret或过期调度；二进制布局属于内部实现，不进入公共文档合同。

结果返回`collectionDigest / itemCount / activeItemCount / totalMatched / items / nextPageToken`。空`nextPageToken`是唯一末页信号。公共Coordinator仍重新解析request/result、限制Canonical byte容量、扫描私有root文本并通过output Schema；MCP annotation固定`readOnlyHint=true / openWorldHint=false`。[MCP 2025-11-25 Schema](https://modelcontextprotocol.io/specification/2025-11-25/schema)把output Schema用于structured result，并明确annotation只是提示，因此只读安全仍由Authority与领域投影证明。

第一版每次list仍读取一次完整严格Authority再在内存filter/page。AIP-158明确初始小集合采用内存分页是合理实现；它限制wire/context但不伪称减少底层I/O。当前不新增`todo-index.json`、SQLite、缓存、后台watch或第二份集合Authority。只有真实profiling证明全量稳定扫描成为瓶颈时，才单独设计由TODO mutation transaction同步维护的索引；不能让Markdown Board反向成为查询权威。

#### 其他候选

- **方案B：只做summary list。** 文件更少，但Controller选择后无法通过同一公共能力读取完整Authority、终态原因和Ledger refs；A5/A6很快会需要exact item，届时必须扩Schema或再增加工具。
- **方案C：直接返回内部snapshot或旧式offset整板。** 实现最快，但泄漏物理证据、响应无界且跨页不一致；Tencent的数据库offset也不解决Wakeflow文件集合的snapshot漂移，不采用。
- **方案D：先建持久JSON查询索引。** 读性能更好，但会扩展所有五类mutation、Recovery与projection事务，在没有规模证据时属于过度设计，不采用。

推荐方案A。确认后首文件为`src/governance/todo/todo-inspection-query.ts`及单一聚焦测试：只实现纯内存request normalization、summary/detail投影、filter、顺序和opaque page-token一致性，不打开Workspace、不读取Config/files、不注册MCP。下一单元才把它接到严格Collection Authority；分页能力暂不下沉Foundation，因为当前只有一个真实consumer。

### 13.58 A4-S1 TODO Inspection Query

新增`todo-inspection-query.ts`，它只消费已经通过`createTodoCollectionSnapshot`/Collection Authority关闭的领域快照。文件没有导入Filesystem、Config、Workspace、MCP或Store，也没有class、缓存、session和索引；所有行为由纯函数与冻结结果表达。

`parseTodoInspectionQuery(...)`关闭两个view：

- `list`允许可选`statuses / priorities / demandTypes / autoClaim / originWindowId` filter、pageSize与pageToken；枚举数组拒绝空值和重复项，再按领域固定顺序规范化；
- pageSize缺省或0为20，大于100收窄为100，负数、非整数和显式undefined拒绝；
- `item`只允许typed TODO ID；两个view均拒绝额外字段、Proxy、accessor、Symbol和非被动容器。

List复用Collection既有`createdAt ASC + todoId ASC`顺序，不重新按priority排序。Summary返回ID、时间、status/revision、Demand type、priority、窗口、summary、当前parked trigger、Auto Claim、testing mode、挂载Demand ID及Intake/State digest；不返回Authority refs或内部物理信息。Item返回完整不可变Intake及脱敏State：保留Ledger member refs、withdrawal和缩减后的archive事实，但mount只投影Demand ID，不暴露`stateRootRef / identityDigest`。

page token使用Node原生Buffer生成固定长度、版本化二进制payload，再编码为canonical base64url；内部含magic/version、完整collection digest、normalized query digest、next offset及16-byte SHA-256 checksum。它不包含root或业务正文，不需要第三方库/server-side状态/HMAC secret；checksum只拒绝损坏或任意修改，不把token升级为签名或授权。相同filter集合在数组顺序不同、pageSize改变时仍连续；filter变化返回`page-token-mismatch`，Collection digest变化返回`stale-page-token`，非法编码/校验/offset返回`page-token`。

聚焦4项通过，覆盖三维filter与origin/Auto Claim、pageSize变化后的连续分页、query/snapshot绑定与token篡改、完整item脱敏、not-found、枚举/容量/typed ID/closed shape及getter零执行。Architecture为795模块/5669依赖/0违规；Schema保持110/215及digest `sha256:34f6646e49bf84e2f6fcce96ab3da1d7b411f72a2202393752bed64bd3df0b71`；候选仍为Codex477/Claude482，因为纯Query尚未被入口闭包消费。

实现复核后删除原本可能增加的`todo-inspection-service.ts`计划：现有`todo-collection-service.ts#inspectTodoItems`已经是严格Authority I/O owner，再加一层只会转发。下一单元应直接建立`wakeflow-todo-inspection-request/result`两份自包含Schema；随后Public Contract/Coordinator组合`RootedDirectory → inspectTodoItems → executeTodoInspectionQuery`，不创建第二个读取Service。

### 13.59 A4-S2～S5 TODO Inspection Public闭环

新增两份自包含entrypoint Schema、Public Contract和Public Coordinator。Request以`list/item`判别联合关闭root、filter、pageSize/token与typed TODO ID；Result分别关闭最多100项summary页和单项完整业务Intake/脱敏State。Schema明确拒绝`eligible / next / sort`、物理root、stateRootRef、mount identity digest、Board/projection、lock和transaction。

Contract执行128 KiB被动JSON容量、Schema后二次领域parser及规范filter；Coordinator直接组合既有`inspectTodoItems`与纯Query，没有新增转发Service。它完整打开/关闭RootedDirectory，扫描request root/规范root私值，限制结果8 MiB并以result Schema回读。Collection transaction未退休、token query不匹配、stale snapshot、not-found和Authority错误均保留稳定cause code/reason；查询不取得writer lock，也不修复projection。

`wakeflow_inspect_todo`作为第22个required executor同时进入Public Server和Codex/Claude组合根，annotations为`readOnly=true / destructive=false / idempotent=true / openWorld=false`。工具说明明确结果不选择eligible/next、不claim、不创建TODO/Demand。A4聚焦Query4 + Schema2 + Coordinator4 + MCP2 + catalog3，共15项通过。

### 13.60 A5 TODO Intake Public完整纵切

A5没有包装旧append参数，而是建立author/owner分界：Public preview只接收Demand type、priority、origin window、summary、intake rationale、readiness、Auto Claim、testing mode/summary及1～32个`{recordId,memberPath}`选择。调用方不能提交Program、Controller、TODO ID、createdAt、完整refs、environment ref、digest、Collection CAS或初始State。

内部纵切为：

```text
authored input
→ current Config + strict Collection + immutable Ledger
→ owner派生Program/Controller/full refs/environment/TODO ID/time
→ exact Plan(configDigest + expectedCollectionDigest + targetIntake)
→ Application复验Config/Ledger/current Collection
→ 既有appendTodoItem / recoverTodoItemTransaction
→ metadata-only receipt
```

Planning先用固定草稿ID/time关闭role、testing和readiness关系，重新读取Config与Collection后才消费UUID/clock；origin window必须存在于current Config，Controller由唯一索引派生。Application不创建第二journal/lock/stage/projection writer；首次append、exact current重试、stale Collection、Ledger/Config漂移和projection失败后的recoverable journal均走现有Collection Service。写入前再次读取Config，写入成功后再复验；若此时Config漂移，错误的`publicationAuthority=current`诚实保留已提交效果。

Public request采用preview/apply/recover，Apply/Recover都必须重放exact Plan/digest。成功只返回TODO ID、初始status与Intake/State/Collection digest；不返回完整Intake或物理恢复对象。`wakeflow_intake_todo`成为第23个双宿主required工具，明确不创建Demand、不执行Auto Claim或宿主效果。A5内部/Public/MCP及catalog相邻11项通过；完整TODO领域现为79项通过。

### 13.61 A6 Demand Publication Authority单源收敛

`wakeflow_create_demand` preview已删除caller `authorityMembers`。公共request现在只含TODO ID与authored Demand text/execution placement；传入旧字段会被Schema/领域closed-shape同时拒绝。

Planning从选定pending TODO的immutable `intake.authorityRefs`取得唯一完整成员集，按record/member逐项重读Ledger并比较完整Canonical ref；Demand Authority不再存在“TODO refs一组、caller selectors另一组”的双输入。Main placement直接使用该集合。Isolated placement仍允许调用方指出一个Confirmation authorization member，但Planning只在TODO已绑定refs中解析它；未绑定或不同Demand的Confirmation失败后不分配ID/time。

受影响Demand Publication 24项全部通过，并新增断言证明plan Authority refs逐项等于TODO Intake refs。公共端到端测试通过同一Codex MCP Server执行：

```text
publish Requirement Ledger Authority
→ intake TODO
→ inspect exact TODO
→ create Demand（无authorityMembers）
→ inspect Demand Route
```

Route最终为`work-available / implementation-task-planning`，所有中间结果均不含Workspace root，最终序列也不出现旧`authorityMembers`字段。

### 13.62 A4→A6公共零到一技术核实点

当前核实事实：

- Public MCP为23个required、双宿主同名同Schema工具；候选stdio Client实测一致；
- TODO完整领域79项通过；A4/A5/A6及相邻Public核实矩阵48项通过；Candidate/Schema/零到一入口专项7项通过；
- Schema 114份、215 external refs，digest `sha256:6759f10e8583f43725518a9f239894bbf990089c87e908f559bb17ec3403af5e`；
- Architecture 815模块、5803依赖、0违规；
- Candidate闭包Codex490 / Claude495，`releaseEligible=false`，manifest分别为`sha256:98ed5f74baec692220b35c4227ebff4e610ea368a1d119308ee30ec932971163`与`sha256:637f4b4daefcd26b3386fde0e79680deff7898b485c229e9ee8e84afe95a21d0`；
- 没有新增SQLite、查询索引、通用pagination Foundation、TODO第二状态机或跨Ledger/TODO Saga。

核实测试从一份已建立Config/Ledger/Active静态根的v3 Workspace fixture开始；Workspace Maintenance的fresh public纵切已有独立测试，本测试没有重复执行宿主窗口创建。它证明“技术骨干准备完成后，Requirement/Confirmation → TODO → Demand → Route”全部可由新TS公共工具完成，不证明插件release、真实宿主窗口或旧JS等价。

到此应暂停真实业务继续扩张，先对A4～A6和此前Foundation/骨干做统一Review；后续方向需基于这次核实点重新排序，而不是自动继续旧路线。

### 13.63 技术层与骨干统一Review

本轮以提交`cfc61f4`为代码基线，重新读取Foundation、Configuration、Workspace、Governance、双宿主入口、114份Schema、候选装配、架构规则和当前测试源。旧JS仍只作为功能需求证据，不参与TS技术路线选择。

外部标准复核确认当前主技术选择成立：官方MCP TypeScript SDK v2已经是稳定发布线，Wakeflow继续使用`@modelcontextprotocol/server`的标准Server、stdio、input/output Schema和structured content；TypeScript solution config + composite project references的使用方式符合官方建议。Node文件系统Promise API不提供跨操作同步且FileHandle应显式关闭，当前Rooted Filesystem、专属锁、CAS和durability owner仍有必要。[MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)、[TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references)、[Node.js File System](https://nodejs.org/api/fs.html)

统一Review落地了五项确定修正：

1. `npm audit --omit=dev`发现AJV传递依赖`fast-uri@3.1.5`处于高危公告范围；lockfile最小升级为`3.1.7`，没有改变AJV或Schema API，复核后生产依赖漏洞为0。
2. Public MCP server instructions此前逐工具重复23份description，既扩大初始化上下文，也形成第二套易漂移手册。依据MCP官方“server instructions只表达跨能力关系、不要重复工具说明”的建议，现收敛为五条：closed-world/no host effect、exact preview/apply、exact recovery、Demand变更后重查Route，以及Inspection/TargetResult不授予权限；catalog测试限制UTF-8不超过1024字节。[MCP Server Instructions](https://blog.modelcontextprotocol.io/posts/2025-11-03-using-server-instructions/)
3. 文件级依赖没有循环，但目录层存在`configuration → workspace`与`workspace ↔ governance`组合缝。它们主要来自资源声明、Active初始化、静态物化、宿主Profile和Window身份合同；不值得为目录纯洁度大搬迁。架构门现以错误级白名单关闭允许的source/target，未来新增跨层边必须显式审阅。
4. 测试引用此前会让“只有测试consumer的生产模块”看似可达。架构检查器现要求这类模块属于10个明确源码根：两个宿主进程入口、已审定运维Recovery入口、Loaded Artifact publication和内部Evidence Reader；新增孤立模块或陈旧准入都会失败。候选manifest的过期scope同时从`maintenance-and-window-identity-technical-skeleton`修正为`typescript-public-technical-skeleton`。
5. 首次完整门暴露16项Evidence失败：A6已删除Demand preview的`authorityMembers`，Evidence共用fixture仍提交旧字段，而此前手选聚焦矩阵没有包含这个跨领域consumer。删除旧字段后，共用authored-demand fixture改为`const`泛型保留真实字面类型，Evidence fixture使用`satisfies DemandEventSourcingPublicationPreviewRequest`，后续废弃字段会在TypeScript构建时失败。以Demand input为根的dependency-cruiser反向可达集合选出18个测试文件、80项测试并全部通过；第二次完整门1052项全部通过。

当前技术结论：

- Foundation没有新增万能Manager、全局registry或第二状态机；host-neutral领域仍不得绕过Filesystem/Process Foundation，也不得导入具体宿主实现。
- 23个公共工具、114份Schema、Ledger→TODO→Demand→Route纵切和后续治理骨干彼此闭合；候选仍是不可发布技术制品，不代表旧插件已切换。
- 目前主要风险不是缺少新的底层能力，而是两个集中式维护热点：`wakeflow-public-mcp-server.ts`为2253行，`wakeflow-public-mcp-server.test.ts`为3485行；`demand-aggregate-state.ts`虽为3189行，但仍是单一Event Sourcing Aggregate owner，不能只按行数拆散权威。
- TypeScript runtime暂不盲目拆成Foundation/Workspace/Governance多个project reference：现有组合缝需要先以真实owner边界收敛；当前dependency-cruiser显式规则已提供更直接的方向约束。

当前验证：Architecture 815模块/5805依赖/10个显式生产根/0违规；完整TypeScript 1052 pass；Schema 114份/215 refs，digest保持`sha256:6759f10e8583f43725518a9f239894bbf990089c87e908f559bb17ec3403af5e`；候选Codex 490 / Claude Code 495，manifest分别为`sha256:592c27e902c4a1385fe3f45069f432e18c08964cd80889e9e53d8cc799269a57`与`sha256:37fc7181b8c43a16b34ed54270353613efdf4f42e8dc4c90f8723c5586b06574`；`npm audit --omit=dev`为0。

下一步不继续增加业务能力。推荐先做一个有边界的“公共入口与测试解耦”技术单元：按Workspace/Pre-Demand/Delivery-Review-Testing分组提取注册与错误适配，保留单一Public Server组合根；同时把3485行MCP测试按owner拆分，只保留一条跨域端到端链。是否进入该单元应在本统一Review核实点由用户确认。

### 13.64 公共入口与测试解耦

用户确认后按统一Review建议完成该技术单元，没有新增或修改业务状态机、Schema、工具名称、description、annotations、输入输出或宿主效果边界。

生产入口从一份2253行文件收敛为：

```text
wakeflow-public-mcp-server.ts                 58行：唯一composition root
wakeflow-public-mcp-server-configuration.ts 330行：Server身份与23 executor准入
wakeflow-public-mcp-workspace-tools.ts       153行：Maintenance / Binding
wakeflow-public-mcp-authority-tools.ts       462行：Ledger / TODO / Demand / Evidence / Route
wakeflow-public-mcp-execution-tools.ts       521行：Task / Delivery / Host Effect / Result
wakeflow-public-mcp-review-tools.ts          399行：Review / Remediation / Completion
wakeflow-public-mcp-tool.ts                  145行：Canonical成功结果与脱敏错误信封
```

四组是源码固定的立即注册函数，不保存可变registry、不按请求选择owner，也不形成第二路由器。Public Server严格准入options后按固定顺序调用四组；各组拥有自己的generated request/result Schema、工具description/annotations、executor字段和领域错误mapper。共享helper只调用官方`McpServer.registerTool`，把成功结果投影为同一Canonical text + structuredContent，或把本组已知错误映射成稳定信封；未知异常统一降为`wakeflow-unexpected`且不回显message/stack。

测试面删除3485行聚合文件，改为：

- `wakeflow-public-mcp-lifecycle.test.ts`：529行，只保留一条真实Claim → Outcome → TargetResult → Review → Completion跨域链；
- `wakeflow-public-mcp-error-envelope.test.ts`：222行，覆盖Workspace、Authority、Execution、Review四组错误字段与未知异常脱敏；
- `wakeflow-public-mcp-registration-groups.test.ts`：172行，以哨兵请求逐一证明23个工具handler绑定同名executor；
- 既有catalog继续拥有23工具名称、Schema ID、自包含Schema、description关键边界、annotations与双宿主集合；
- Ledger、TODO、Demand、Evidence、Maintenance和Binding仍由各自入口测试拥有；所有业务状态转换、恢复和负例继续由领域Public/Service测试拥有。

因此entrypoint测试总行数从5525降为2828；入口聚焦门从54项/约66秒收敛为25项/本次19.2秒。全仓测试从1052项降为1023项，最终完整门本次约5分27秒；墙钟会受并发文件事务和机器负载影响，主要成本仍来自真实治理纵切，不把一次运行差值全部归因于删除适配重复。

使用Git `HEAD=cfc61f4`在一次性临时目录编译拆分前基线，与当前工作树通过官方内存Client逐工具比较完整`tools/list`；23项name/title/description/input Schema/output Schema/annotations完全一致。Server instructions从基线9487 bytes变为613 bytes属于上一统一Review已经确认的独立修正，不是本拆分造成的协议漂移。

最终验证：Architecture 823模块/5817依赖/10个显式生产根/0违规；TypeScript 1023 pass；Schema 114/215及digest不变；候选Codex 496 / Claude Code 501，manifest分别为`sha256:b860f0d3d1d3b7dca9ad338899c2d2ba0be89055f8ae28bdee547bf5ec22c944`与`sha256:a9182c0385aa634cb4564b3cb1921877ef6b4e370607eda706103db86b07ea99`，仍为`releaseEligible=false`。

本单元到此关闭。`demand-aggregate-state.ts`仍是单一Event Sourcing Aggregate owner，没有因行数被机械拆分；下一步应回到核实点讨论业务顺序，而不是继续创建技术抽象。
