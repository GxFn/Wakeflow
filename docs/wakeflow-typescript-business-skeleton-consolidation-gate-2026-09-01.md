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
