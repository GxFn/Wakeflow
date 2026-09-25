# Wakeflow TypeScript Business Skeleton Consolidation Gate

> 原路径：`docs/wakeflow-typescript-business-skeleton-consolidation-gate-2026-09-01.md`，2026-09-03 迁入开发文档系统；目录职责与权威顺序见 [docs/README.md](../README.md)。

> 文档结构：第1至12节保留早期5工具节点的历史证据；当前结论以第13节为准。
> 当前状态：`technical-and-business-skeleton-verified / consolidation-decision-required`
> 日期：2026-09-01
> 前序状态：`reached / ts-development-gate-passed / user-review-required`
> 基线提交：`8e0be68 feat: add event-sourced target task planning`
> 当前分支：`main`，相对`origin/main` ahead 7
> Owner：Wakeflow Source Maintenance / Controller application review
> 上游记录：[TypeScript逐文件审阅台账](./file-review-ledger.md)

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

### 13.65 2026-09-03 节点：文档系统建立与 ADR-0002 到 ADR-0006 接受

本节只记录已发生的事实，不做新的决策。

- 以 `c0098e2` 为基线完成节点评估，记录于 [docs/reviews/2026-09-03-typescript-checkpoint-review.md](../reviews/2026-09-03-typescript-checkpoint-review.md)。评估度量：手写 `src` 413 文件 142,665 行；`tools/list` 实测 329,652 字节；MCP 组合根热启动约 1.9 秒；全量 TS 门 1,023 项通过、墙钟 6 分 07 秒。
- 按 [ADR-0001](../decisions/0001-documentation-system.md) 建立开发文档系统。本文迁入 `docs/progress/`，职责改为进度记录；开发计划迁入 `docs/plan/` 并成为唯一的阶段与约束权威。
- 用户确认 [ADR-0002](../decisions/0002-public-tool-surface.md) 到 [ADR-0006](../decisions/0006-legacy-capability-retention.md) 采用建议方案。开发计划新增 TSD-12 到 TSD-15，TSD-03 修订，新增 §8.1 执行顺序 P0 到 P5。
- 下一步进入 P0：建立能力映射矩阵与等价对照工具，不新增业务能力。P0 待核实事项见开发计划 §8.1。
- 本节点未运行：双插件 validator 与 smoke、旧 JS 全量门、真实宿主会话。

### 13.66 2026-09-04 节点：P0 能力卡确认、ADR-0009 与 ADR-0010 接受、场景验收骨架

本节只记录已发生的事实，不做新的决策。

- 基线仍为 `c0098e2`，全部改动未提交。
- 能力卡第 1 到 10 组按"每轮一组、先读旧代码出卡"的流程全部确认，确认记录附在各卡文末。第 8 到 10 组的旧代码事实由三次只读提取得到，卡内引用 `core/` 与 `plugins/` 的 file:line。
- 用户确认 [ADR-0009](../decisions/0009-execution-endpoint-and-host-effect-handshake.md)（两处调整待复核）与 [ADR-0010](../decisions/0010-worktree-isolated-execution-and-converged-flow.md)。ADR-0010 首版的任务粒度 worktree 被用户的 pod 模型取代并改写；回写到 plan TSD-15、L1 切片、§9 状态行、决策索引与能力卡 3、4、7、8。
- 建立 [references/capability-map.md](../references/capability-map.md) 与 [references/scenario-acceptance.md](../references/scenario-acceptance.md)。
- 场景验收骨架 `tests/scenarios/wakeflow-scenario-acceptance.fixture.ts` 与 `.test.ts`：经 Codex 组合根的公共 MCP 工具在一次性工作区顺序运行 `card-01/fresh-initialize`、`card-04/create-demand`、`card-05/plan-implementation-task`，三个场景 pass，单测墙钟约 8.3 秒；`package.json` 新增 `scenario:acceptance`。
- 运行过的门：`npm run typecheck`、`npm run check:architecture`（825 模块、5,828 依赖、ok）、聚焦场景测试；全量 `npm test` 通过，1,024 项测试 0 失败，含新增的场景验收测试，墙钟约 6 分 16 秒（`node --test` 报告的 duration_ms 375,936）；文档链接检查 814 条无失效；`git diff --check` 通过。
- 本节点未运行：双插件 validator 与 smoke、旧 JS 全量门、真实宿主会话。

### 13.67 2026-09-04 节点：P0 结束，ADR-0011 到 ADR-0013 接受

本节只记录已发生的事实，不做新的决策。

- 用户于本日先后接受 [ADR-0011](../decisions/0011-requirement-package-as-single-handoff.md)（需求包唯一交接物）、[ADR-0012](../decisions/0012-flow-convergence-callback-calls-testing-redesign.md)（回传固定效果、三种调用形状、完成即归档、测试记录对比、escalate 取代 redesign）、[ADR-0013](../decisions/0013-target-architecture-and-slice-plan.md)（六层目标架构、切片解剖、kernel、foundation 收敛、20 个公共工具、L1 十个切片）。
- 两份评估随之落为接受：[reviews/2026-09-04-flow-optimization-analysis.md](../reviews/2026-09-04-flow-optimization-analysis.md)、[reviews/2026-09-04-architecture-and-slice-design.md](../reviews/2026-09-04-architecture-and-slice-design.md)。三次旧代码只读深读（回传闭环、总控调用节奏、测试与重设计）的事实记录在前者。
- 回写：能力卡 3 到 7 追加修订节；总览 [requirements/wakeflow-functions-and-scenarios.md](../requirements/wakeflow-functions-and-scenarios.md) 建立并同步；能力映射矩阵新增 §1.1；计划 §8.1 L0 与 L1、§11、§15 改写。
- 全部改动仍未提交；本节点未运行代码门（本节只改文档）。

### 13.68 L0 执行计划（2026-09-04 起）

按 [ADR-0013](../decisions/0013-target-architecture-and-slice-plan.md) 执行，每步以 `npm test` 为绿结束并在本日志追加事实。目录采用新名 `src/kernel/` 与 `src/capabilities/`，与旧 `workspace/`、`governance/` 并存到 L1 各切片迁完为止。

| 步 | 内容 | 删除对象 | 验证 |
| --- | --- | --- | --- |
| L0.1 | `kernel/error`（单一错误类型与封闭错误码表）、`kernel/limits`、`kernel/redaction`、`kernel/privacy-scan`（一套引擎一套词汇，能力卡 8 Q1） | 13 份 `containsPrivateText` 签名与 8 种上限在被消费处逐个替换 | 每模块直接测试 |
| L0.2 | foundation 收敛到 14 个原语，import 路径 codemod | filesystem 36 文件合并为 8；artifact、data、crypto、identity 按分析 §3.1 合并 | typecheck、全量测试、foundation 文件数不高于 20 |
| L0.3 | `kernel/demand-stream`：快照刷新、默认快照加尾部、一次命令一次加载、commitId 由命令内容派生、追加队列进程级 | event-sourcing 21 文件重写为 kernel 模块；19 处全量重放改为读上下文 | reader 直接测试；100 commit 下 append 低于 50 毫秒；一次写命令只读一次事件流 |
| L0.4 | `kernel/append-command`、`kernel/publication-transaction`、`kernel/next-projection`、`kernel/idempotency-store`；试点迁移 `plan_target_task`（追加形状）与 `maintain_workspace`（效果形状） | 两个试点的协调器、input、authority、plan 样板；其余 20 个协调器随 L1 各切片删除 | 试点的 decide 测试与场景验收；协调器行数度量 |
| L0.5 | `kernel/tool-registry`、codegen 预编译校验器惰性加载、单一组合根按登记表生成目录、`response_format` | 四个静态注册组、24 个同构宿主入口文件 | 热启动低于 500 毫秒；`tools/list` 度量（60 KB 门在 L1 合同收敛后复测） |
| L0.6 | dependency-cruiser 六层方向规则加切片隔离、Biome 或 ESLint、Prettier、knip、复杂度上限 | 旧的 18 条规则 | lint 门为绿；L0 退出门逐项度量并记录 |

`kernel/config-authority`、`layout`、`hook-observations`、`work-claim`、`receipts` 随 L1 的 workspace、endpoint 切片建立，不在 L0 单独做。

### 13.69 L0.1 完成与 L0 顺序调整（2026-09-04）

- 新建 `src/kernel/`：`error`（`WakeflowError` 加封闭错误码表 `src/contracts/vocabulary/wakeflow-error-code.ts`，12 个码）、`limits`（8 个命名上限，`publicResultBytes` 过渡为 24 MiB，ADR-0004 planRef 落地后降为 4 MiB）、`redaction`（一份私有值边界扫描，替代 13 份签名的目标实现）、`privacy-scan`（一套引擎五类命中，路径与 UUID 按白名单）。`tests/kernel/` 四份直接测试。
- 生产消费者：MCP 公共边界 `src/entrypoints/wakeflow-public-mcp-tool.ts` 用 `WakeflowError` 生成错误信封、按 `publicResultBytes` 限制结果、以进程级边界拒绝含用户 home 路径的结果。`privacy-scan` 暂列入架构门的库入口表，L1 首个切片接入后删除。
- 接线：`src/tsconfig.runtime.json` 纳入 `contracts/vocabulary`、`kernel`、`capabilities`；dependency-cruiser 新增 `kernel-depends-only-on-foundation-and-contracts` 与 `capabilities-do-not-import-each-other` 两条，域规则表纳入 kernel 与 capabilities。
- 门：typecheck 通过；聚焦测试 17 项通过；架构门 834 模块 ok；全量 `npm test` 见下一节补记。
- 顺序调整：L0.2 foundation 物理收敛推迟到 L0.3 与 L0.4 之后。理由：合并判据是"是否总被同一调用方一起使用"，只有 kernel 的真实消费者建立后才知道哪些原语会被合并、哪些会因无消费者被删除；先合并会在 L1 重写消费者时再动一次。foundation 内部的按模块错误类在旧消费者迁完前保留，由 kernel 在外壳边界统一映射为 `WakeflowError`；错误类型的最终下沉在 L1 末尾一次完成。

### 13.70 L0.3 事件流读路径与检查点（2026-09-04）

按 ADR-0005 与 ADR-0013 落地，全部改动未提交。

- 新建 `src/kernel/event-stream/stream-index.ts`：事件流身份索引作为可删除、可重建的派生检查点，按提交序号以不可替换文件发布在 `event-sourcing/index/`，记录 commitId、eventId、按类型的提交序号、每个提交的摘要与总字节数；索引损坏或落后即回退全量读取并重建。`tests/kernel/stream-index.test.ts` 三份直接测试。
- 事件存储：追加准入在索引恰好落后一个提交时只读前序提交文件做 O(1) 检查，否则读完整前缀并重建索引；提交成功后推进索引、退休保留窗口外的索引文件（保留 2，每 16 次清扫兜底）；候选文件写入改为只同步内容、目录项持久性由 link 后的目标结算负责；link 后的候选退休不再同步。
- 仓储：`refreshCheckpoints` 在每次追加后发布快照并退休旧快照；`findCommitById` 与 8 个 typed finder 改为索引定位加只读命中提交，聚合改由快照加尾部得到；尾部读取按序号逐文件探测，不再枚举整个提交目录。命令处理器提交成功后刷新快照，结果增加 `checkpoint`。`openDemandOperationAuthorityContext` 默认走快照加尾部，新增 `openDemandAuditAuthorityContext` 供校验入口。
- foundation：`createFileAtomically` 与 `unlinkRegularFileExactly` 增加 `durability: fsync | none`，`createFileCandidateDurably` 增加 `durability: fsync | content-only`；`derived-checkpoint` 合同允许 `exact-retire`。权威事实的写路径不变。
- 资源目录与根清单登记 `event-sourcing/index/`，目录名表改为 append-candidates、commits、index、snapshots。
- 度量（同机、无并发负载，`node --cpu-prof` 与相位计时）：100 个提交下每次追加命令的相位均值为加载 14 毫秒、决策加准备 10 毫秒、追加 54 毫秒、快照刷新 21 毫秒；改动前追加约 250 毫秒且随提交数增长；本机单次 fsync 约 4.4 到 5.7 毫秒，追加路径现在只剩 2 次 fsync，其余为 foundation 每步多次 stat 与复验的协议开销和 passive-own-data 逐字段复制的 CPU 开销。ADR-0005 的"100 个 commit 下 append 低于 50 毫秒"门尚差约 4 毫秒，剩余开销归入 L0.2 的 foundation 收敛。
- 门：typecheck 通过；聚焦测试 81 项通过；架构门 836 模块 ok；全量 `npm test` 通过，1,024 项测试 0 失败。

### 13.71 L0.4 试点：追加型调用形状与 `plan_target_task`（2026-09-04）

- 提交记录增加可选 `idempotency{key, requestDigest}`（schema 与 codec）；索引记录键到序号；仓储 `findCommitByIdempotencyKey`；命令处理器接受 `idempotency` 选项，同键同摘要返回首次结果，同键异摘要以 `idempotency-conflict` 拒绝。
- 新建 `src/kernel/ids.ts`（确定性 UUID v4 派生，取代六份 `uuidFrom`）、`src/kernel/next-projection.ts`（前沿到责任方与建议工具的数据表）、`src/kernel/append-command.ts`（追加型调用形状的唯一外壳：请求解析、上限、隐私、根、上下文、幂等键派生 commitId、追加、投影、`next`、脱敏、关闭）。
- 试点切片 `src/capabilities/tasking/plan-target-task.ts`：`wakeflow_plan_target_task` 改为单次调用 `{root, demandId, idempotencyKey, expectedStreamRevision, taskPackage}`，结果带 `next`；请求与结果 schema 重写为单一形状，未引用的 `$defs` 删除（请求 14 个，结果 16 个）。旧的 `target-task-planning-public-coordinator.ts` 及其测试删除；`TargetTaskPlanningService` 与 plan 模块暂留，供其他切片的测试 fixture 使用，随 L1 tasking 切片删除。
- 隐私扫描与请求摘要不含 `root`；`WakeflowError.path` 允许 `/` 以兼容既有 `$/field` 路径。
- 测试：`tests/capabilities/tasking/plan-target-task.test.ts` 覆盖过期修订、提交、同键重放、同键异请求、请求含私有路径、非法键六种结局；场景验收 `card-05` 改为单次调用并断言重放零写。
- 门：typecheck 通过；架构门 839 模块 ok；全量 `npm test` 首轮 3 处失败（wire Schema 镜像测试、两个评审服务的并发/恢复用例），修复与后续见 13.72。

### 13.72 L0.4 收尾：效果型调用形状、`maintain_workspace` 试点与并发缺陷（2026-09-04）

- L0.4a 全量门的三处失败：(1) wire Schema 镜像测试改为"携带或引用 Foundation 镜像即须一致，允许本地 description/title"，并按单次追加形状重写规划请求与结果的断言；(2) 仓储 `load` 对快照目录读取失败先重读一次，仍失败则退回完整重放并报告 `snapshotStatus: "invalid"`——并发检查点刷新曾让评审决定与恢复服务以 `stream` 失败；残留暂存文件不再拒绝加载，`recoverPublicationStages` 保留为显式恢复；(3) 旧 tasking service 的并发 apply 暴露两处一直存在、此前被上游失败掩盖的并发缺陷：目录物化的胜者在他人写入子项后以 `commit-uncertain` 失败（终检改为只比较目录身份、类型、权限位与属主），投影的败者在胜者退休 stage 前观察到双链接或链接数变化（`resource-changed` 改判为 `recovery-required`，`materialize` 对败者有界重读 1 到 256 毫秒）。6 进程各 6 轮的争用复现从 5/36 失败降到 0/36。
- 新建 `src/kernel/command-shell.ts`（三种形状共用外壳：解析、上限、去根摘要与隐私、根、边界、上下文、结果脱敏、关闭）与 `src/kernel/publication-transaction.ts`（preview、apply、recover；apply 重算计划比对 `planDigest`，漂移 `precondition-failed/plan-drift`，阻塞 `plan-blocked`）；`append-command.ts` 只保留追加特有部分。
- `wakeflow_maintain_workspace` 迁到 `src/capabilities/workspace/maintain-workspace.ts`：apply 请求为同一 `action` 与 `request` 加 `planDigest`；结果去掉 `confirmation` 与 `confirmationDigest`，加 `plan`、`planDigest`、`next`。ADR-0004 的 `planRef` 在初始化场景退化为原请求本身：初始化前没有可写的 Wakeflow 根，preview 必须零写，且维护事务本就在门内重新推导计划。删除 `wakeflow-maintenance-public-coordinator.ts`、`wakeflow-maintenance-public-contract.ts`、`wakeflow-maintenance-confirmation.ts` 及其测试；请求 Schema 为 7 个封闭变体，结果 Schema 带 `next`。
- `next` 约定：preview 就绪 → `workspace-maintenance-apply`（owner user，建议本工具）；阻塞 → `workspace-maintenance-blocked` 带 blockers；apply 或 recover 带启动意图 → `window-launch`（owner user，建议 `wakeflow_register_window_binding`）；其余无前沿。
- 不再做 `kernel/idempotency-store`：追加形状的幂等键已进入事件流索引，效果形状靠事务 intent 与 journal。apply 成功后用旧摘要重放得到 `plan-drift`（重算的计划已变），中断事务走 `recover`。
- 测试：`tests/capabilities/workspace/maintain-workspace.test.ts`（零写、漂移拒绝、提交、旧摘要、reconcile no-op、缺摘要、非法操作标识、私有路径、无效根）；入口测试、窗口绑定测试、场景 `card-01`、错误信封测试同步到新形状。
- 重算比对暴露一处非确定性：`compileWakeflowFreshConfigSelection` 默认用随机 UUID 分配 program、repository、surface、window 的 ID，同一 selection 两次编译得到不同 Config，preview 与 apply 的计划摘要永远不等。改为无注入 factory 时由 selection 规范摘要、种类与 selection key 确定性派生（Foundation 新增 `deriveUuidV4`，`kernel/ids` 改为其门面；注入 factory 的路径与碰撞检查保留）。后果：同一 selection 在任何工作区得到同一组 ID，pod 或第二套窗口须用不同 selection 或命名空间；apply 必须重发与 preview 完全相同的请求。
- 并发投影败者的重读预算从 31 毫秒放宽到 511 毫秒（6 进程争用下 31 毫秒仍有 2/36 用尽预算）。
- 协调器行数度量（L0.4 退出项）：删除的两个试点协调器与其合同、确认模块合计 1,465 行（tasking 公共协调器 365，maintenance 协调器 525、合同 276、确认 299）；新增内核外壳 445 行（`command-shell` 164、`append-command` 118、`publication-transaction` 163）为全部 20 个工具共用，两个切片 993 行（tasking 467、workspace 526）各自只含请求解析、错误映射、领域调用、`next` 与结果组装。
- 门：typecheck 通过；架构门 838 模块 ok；全量 `npm test` 通过（1,031 测试，Schema 漂移检查 ok）。L0.4 两个试点到此结束。
- L0 余项：L0.5（工具登记表、预编译校验器惰性加载、单一组合根、`tools/list` 与热启动度量）、L0.6（六层方向规则补全、lint 与格式、knip、复杂度上限、L0 退出门逐项度量）、推迟的 L0.2（foundation 收敛，待内核消费者齐全后做）。旧 `TargetTaskPlanningService` 与 plan 模块仍供其他切片的 fixture 使用，随 L1 tasking 切片删除。
- 确认记录（2026-09-04）：用户按建议确认两项设计决定——`maintain_workspace` 的 `planRef` 以原请求重算实现、fresh selection 的 ID 确定性派生；残余风险选 `details` 方案：`WakeflowError` 增加可选 `details`（封闭的短标识键值，至多 8 项），维护事务错误经它公开 `operationId`，MCP 错误信封原样携带；ADR-0013 决定 D 同步；加入 `details` 后全量 `npm test` 再次通过（1,032 测试）。用户同时授权提交代码并进入 L0.5。

### 13.73 L0.5：工具登记表、单一组合根与冷启动（2026-09-04）

- 基线度量（`.build` 上对 Codex 组合根做 `tools/list`，导入加创建计时，三次取整）：冷启动 2,221 到 2,424 毫秒，其中导入 2,194 毫秒、创建 server 320 毫秒；`tools/list` 319,252 字节，约 91,000 token，其中请求 Schema 103,643、结果 Schema 195,774、描述 13,779 字节。原因：87 个合同模块在装载时各自编译一份 Ajv；SDK 的 `fromJsonSchema` 对 46 份 Schema 逐个预编译（317 毫秒）；结果 Schema 内联进目录。
- 新建 `src/kernel/tool-registry.ts`：登记表为纯数据（名字、切片、调用形状、executor 绑定名、标题、不超过 640 字节的描述、请求与结果 Schema、注解），`createWakeflowToolCatalog` 准入唯一性、Schema 身份词干一致与注解同形状的一致；`publicToolDefinition` 只投影请求 Schema；`measureWakeflowToolCatalogBytes` 给体积门用。
- 新建 `src/entrypoints/wakeflow-public-mcp-catalog.ts`（23 条登记与 executor 接口）、`wakeflow-public-mcp-shared-executors.ts`（15 个与宿主无关的 executor）；`wakeflow-public-mcp-tool.ts` 改为按登记表注册、惰性编译的请求校验提供者（`WAKEFLOW_JSON_SCHEMA_VALIDATOR`，与服务端解析共用同一套 Ajv 规则）与旧领域错误的结构投影；`wakeflow-public-mcp-server.ts` 成为唯一组合根，配置准入由登记表派生（330 行降到 96 行）。两个宿主组合根各自内联宿主 facade。删除四个静态注册组（1,485 行）与 24 个同构宿主入口文件；`src/entrypoints` 从 34 个文件降到 10 个，架构门模块数 838 降到 816。
- `createRuntimeJsonSchemaValidator` 改为惰性编译：Schema 形状与 `$id` 目录在创建时准入，Ajv 实例与编译推迟到第一次校验，未被调用的校验器永远不编译。
- ADR-0004 选项 A 落地情况：第 1 项结果 Schema 不进 `tools/list`（保留在登记表供服务端校验，目录测试改为断言登记表里的结果 Schema 身份）；第 3 项描述压到两句并保留目录测试锁定的边界短语；第 2 项已在 `maintain_workspace` 落地，其余效果工具随 L1 切片。
- 结果度量：冷启动 324 到 329 毫秒（导入 320、创建 6），低于 500 毫秒门；`tools/list` 119,825 字节，约 34,000 token；请求 Schema 103,643 字节未变，描述 10,752 字节。60 KB 目标要靠 L1 各切片收敛请求 Schema，目录测试先以 128 KB 为过渡预算锁住不回退。
- 不做与推迟：codegen 预编译校验器不做——惰性编译后剩余冷启动是 816 个模块的装载时间（导入 320 毫秒中 SDK 61 毫秒），不再是编译；`response_format` 推迟到 L1 有厚结果的读切片，追加型结果本就只含身份、修订、摘要与 `next`；`kernel/idempotency-store` 已在 13.72 说明不需要。
- 测试：`tests/kernel/tool-registry.test.ts`（准入规则）、`tests/entrypoints/wakeflow-public-mcp-catalog-binding.test.ts`（取代注册组绑定测试：23 个工具按登记表绑定到同名 executor，注册配置不含 outputSchema）；目录测试改为结果 Schema 不上线、体积预算、配置错误原因收敛为 `executor` 加 `field`；运行时 Schema 测试改为编译失败在第一次校验报出。
- 门：typecheck 通过；架构门 816 模块 ok；全量 `npm test` 通过（1,033 测试，Schema 漂移检查 ok）。L0.5 到此结束，余 L0.6 与推迟的 L0.2。

### 13.74 L0.6：六层方向规则、lint 门与 L0 退出门度量（2026-09-04）

- dependency-cruiser 重写为三节共 18 条：通用 6 条（循环、不可解析、未声明依赖、dev 依赖、运行时不反向依赖测试与旧树、新测试不 import 旧 JS）；六层方向 8 条（foundation 只依赖 foundation；contracts 只依赖 foundation 与 contracts；kernel 只依赖 foundation 与 contracts；切片互不引用；宿主中立运行时不导入 hosts；任何更低层不导入 entrypoints；宿主互不引用；宿主中立运行时的文件系统与进程效果只经 foundation）；过渡 4 条守住旧树内部接缝（configuration 对 workspace、workspace 与 governance 的组合缝、governance 对 workspace 的合同缝），随 L1 删除旧树时一并删除。原 12 条旧规则由这两节取代。
- lint 与格式：Biome 2.5.12 一套工具。格式统一为两空格、双引号、尾随逗号、100 列，只对新树（kernel、capabilities、entrypoints、contracts、tooling 与对应测试）启用，一次性重排 118 个文件；旧树格式不动、随 L1 删除。lint 用推荐规则集，认知复杂度上限新树 15、tooling 30、测试 45；旧树关闭复杂度、隐式 any let、正则控制字符、非空断言与 import type 四类噪声规则。首轮基线 781 错误（其中旧树隐式 any let 339、复杂度 318、正则控制字符 110）；新树的 27 处逐一修掉：`parseStreamIndex`、`findPrivateText`、命令外壳与效果外壳按职责拆函数，两处切片的 `switch`+`fail` 改为查表（Biome 不做类型推断，把 `never` 返回当作贯穿），`matchAll` 取代赋值表达式循环，显式类型取代隐式 `let`。收尾 0 错误、3 处旧树警告。
- 未使用代码：knip 6.34.0，入口为两个组合根、四个 tooling 脚本与全部测试；旧树目录先忽略、随 L1 逐目录纳入。新树清出 7 个未使用导出与 10 个只在文件内使用的导出类型（全部改为模块内私有），删除 `openDemandAuditAuthorityContext`、`createDemandEventStreamIndexResourceDeclaration` 与全量前缀版 `assertDemandFileEventAppendAdmission` 三个 L0.3 遗留的无消费者函数。
- `npm test` 现为：typecheck、架构门、lint、格式检查、knip、TypeScript 测试、Schema 漂移检查；新增脚本 `lint`、`lint:fix`、`format`、`format:check`、`check:unused`。
- 内核直接测试补齐：`ids`、`next-projection`、`command-shell`、`append-command`、`publication-transaction` 各一份（假规格驱动，不触碰领域代码）；至此内核 11 个模块每个都有直接测试。
- L0 退出门逐项度量：

| 退出门 | 度量 | 结论 | 未满足时的 owner |
| --- | --- | --- | --- |
| 协调器总行数降 40% 以上 | 基线 22 个 8,075 行 → 20 个 7,185 行（降 11%） | 未满足 | L1 各切片删除自己的协调器 |
| 治理层 catch 行占比低于 5% | `src/governance` 84,925 行中含 `catch` 的 1,522 行，1.8% | 满足 | — |
| 一次写命令只读一次事件流 | 命令处理器一次加载（快照加尾部）；幂等键查询只读索引；不再全量重放 | 满足 | — |
| 100 个 commit 下 append 低于 50 毫秒 | 60 commit 均值 56.9 毫秒（fsync 4.5 毫秒一次） | 未满足 | 推迟的 L0.2：foundation 协议 fsync 次数 |
| 组合根热启动低于 500 毫秒 | 324 到 329 毫秒 | 满足 | — |
| `tools/list` 低于 60 KB | 119,825 字节，过渡预算 128 KB 已锁 | 未满足 | L1 各切片收敛请求 Schema |
| lint 门为绿 | Biome lint 0 错误、格式检查通过、knip 无发现 | 满足 | — |
| foundation 文件数不高于 20 | 63 | 未满足 | 推迟的 L0.2 |
| kernel 每个模块有直接测试 | 11 个模块 11 份直接测试 | 满足 | — |

- 门：全量 `npm test`（含新加的 lint、格式、knip 三道）通过：typecheck，架构门 821 模块 ok，Biome 0 错误，格式检查通过，knip 无发现，1,044 测试通过，Schema 漂移检查 ok。L0.6 到此结束；L0 余下推迟的 L0.2（foundation 收敛）与三项未满足的退出门按表中 owner 进入 L1 与 L0.2。

### 13.75 L1 endpoint 切片：设计定案（2026-09-04）

依据能力卡 2（Q1 到 Q8 已裁决）、ADR-0009 与 ADR-0013 §4 第 2 行。用户于 2026-09-04 授权进入本切片；以下是设计权范围内的定案，多选项处已按能力卡与 ADR 的裁决落地，不再另开问题。

- 公共工具一个：`wakeflow_register_window_binding`，请求以 `operation` 判别：`inspect`（读：启动意图重算、绑定与工作声明状态、`next`）、`register`（登记）、`replace`（两步替换的第二步：消费新句柄并对旧绑定 CAS）、`decommission`（退役：三段关闭观察加可选 `session-end` 记录，判定 machine-verified、manual-host-gate、blocked）、`release-claim`（工作声明强制释放：`expectedClaimDigest` 加证据）。旧工具 register_window、replace_windows、release_window_lock 由此吸收；Schema 词干 `window-host-binding-registration` 保留，内容重写。
- 证据准入：登记与替换都要求一条宿主 hook `session-start` 观察记录，其会话标识等于句柄值、`cwd` 等于该窗口配置根的绝对路径；Claude 另要求 tmux 四元组（socketName 可空、sessionName、windowId、paneId），落为定位器记录；Codex 只要线程标识。退役的机器验证等级：Claude 关前活、关闭结果 closed、关后缺席加 `session-end` 记录为 machine-verified；Codex 归档只到 manual-host-gate；有工作声明或证据自相矛盾为 blocked 并拒绝。强制释放只在声明超过 2 小时、或持有会话有 `session-end` 记录、或 Claude pane 观察为 pane-dead/missing 时接受。
- hook 观察记录进内核：`src/kernel/hook-observations.ts` 定义记录（hostId、event ∈ session-start | user-prompt-submit | stop | session-end | turn-complete、sessionId、cwd、recordedAt、turnId、promptDigest、lastAssistantMessageDigest、transcriptRef；只存摘要不存正文）、存放位置 `.wakeflow-local/runtime/hosts/<host>/observations/hooks/`（0700/0600）、确定性 recordId 与有界读取；L3 的 hook 脚本与测试都用同一写入函数。
- 绑定不进事件流：绑定登记表仍是工作区级私有权威文件；工作声明强制释放只删除声明文件并留下观察回执，Demand 侧由 delivery 切片的 rearm 对账；围栏令牌在结果准入侧生效（ADR-0009 §3）。
- Claude pane 分类器按旧版顺序原样移植为纯函数（binding-mismatch、host-context-drift、missing、duplicate、coordinate-mismatch、pane-window-mismatch、pane-dead、process-mismatch、metadata-mismatch、live），输入改为 Agent 交回的 `list-panes` 行与窗口选项；只有 live 可派发。
- 切片文件：`contract.ts`、`decide.ts`（纯决定与 given-when-then 测试）、`service.ts`（内核命令外壳上的薄壳；绑定不走 Demand 追加形状）、`projection.ts`、`tool.ts`（登记表条目由切片导出，目录只汇总）；场景验收新增 `card-02/register-window-binding`。删除对象：`wakeflow-window-host-binding-public-coordinator`、`-public-contract`、`-registration`、`-registration-authority`、`wakeflow-agent-host-window-observation`（含 authority）及其测试；store、投影、启动意图模块随后续步骤吸收。

### 13.76 L1 endpoint 切片：实现与验收（2026-09-04）

按 13.75 定案落地，切片目录 `src/capabilities/endpoint/`（`contract.ts`、`decide.ts`、`pane-classification.ts`、`locator-store.ts`、`projection.ts`、`service.ts`），内核新增 `hook-observations.ts` 与 `layout.ts`，词汇新增 `contracts/vocabulary/wakeflow-host-id.ts`。

- 合同：`wakeflow_register_window_binding` 请求 Schema 重写为五路 `oneOf`（inspect、register、replace、decommission、release-claim），结果 Schema 为 `WakeflowWindowBindingInspection | WakeflowWindowBindingMutation`；登记表条目由切片导出（`WINDOW_BINDING_TOOL_REGISTRATION`，形状 append、注解 destructive），目录只汇总；描述 634 字节，在 640 上限内。工作区切片的 `next.suggestedTool` 改为字面量，切片之间不再互相 import。
- 决定与证据：`decideEndpointCommand` 是纯函数，13 种拒绝理由各有测试；register 与 replace 要求 `session-start` hook 记录的会话等于句柄值、`cwd` 等于窗口配置根（字面比较再按 realpath 比较，宿主 hook 报告的符号链接路径也能匹配）；Claude 缺 tmux 坐标为 `invalid-request/tmux-coordinates-required`；decommission 的 `machine-verified` 只在 tmux 关前活、关闭 closed、关后缺席加 `session-end` 记录时给出，其余 `manual-host-gate`，矛盾为 `closure-blocked`；release-claim 的恢复门为固定 2 小时（`WORK_CLAIM_RECOVERY_WINDOW_MILLISECONDS`），不自动清理，释放只删声明文件并写 `observations/claim-releases/<claimId>.json` 回执。
- 效果：五种操作都走 `runCommandShell`；register、replace、decommission 在旧绑定 store 的互斥门内执行，进门后重比绑定摘要，漂移为 `concurrency-conflict/binding-changed`；replace 用 `replaceFileAtomically` 带期望节点，decommission 用 `unlinkRegularFileExactly` 带期望节点；定位器与投影随后刷新（投影由旧编译器算文档、切片只落盘）。声明根尚未建立时视为无声明，不是布局故障。
- 删除：`wakeflow-window-host-binding-public-coordinator`、`-public-contract`、`-registration`、`-registration-authority`、`wakeflow-window-runtime-registered-projection-publication` 与旧入口测试；`wakeflow-agent-host-window-observation`（含 authority）仍被 delivery 与 testing 的 host-effect claim 使用，留给投递切片删除。delivery 与 testing 的两个 fixture 改为经端点切片登记（先写 `session-start` 记录）。
- 验收：`tests/capabilities/endpoint/decide.test.ts` 5 项、`service.test.ts` 3 项（Codex 登记与重放、Codex 替换退役与声明强制释放、Claude tmux 定位器与机器核实退役；声明用真实 store 建立并经持有、过期、释放三态）、`tests/kernel/hook-observations.test.ts` 2 项；场景 `card-02/window-handshake` 与 `card-02/window-replace` 接线并通过（场景报告 pass=5）。修掉两处测试侧 `RootedDirectory` 未 close 的句柄泄漏（Node 的 DEP0137 警告）。
- 度量：协调器 20 个 7,185 行 → 19 个 6,867 行（对基线 8,075 降 15%，退出门 40% 仍未满足）；`tools/list` 119,825 → 125,158 字节，增量全在五路请求 Schema（压缩后 6,657 字节，旧单操作 1,659 字节），仍在 128 KB 过渡预算内，60 KB 目标继续由后续切片收敛；架构门 827 模块 ok。
- 未做与残余：每窗口操作互斥锁未实现（跨调用占用由 delivery 的工作声明表达）；retitle 与 arrange 指令未提供；L3 的 hook 脚本尚未接入写入函数；没有真实宿主会话，Claude 路径的 tmux 观察只在测试里由 fixture 交回，标注 not-run: host session unavailable。
- 门：全量 `npm test` 通过：typecheck，架构门 827 模块 ok，Biome 0 错误（3 处旧树警告不变），格式检查通过，knip 无发现，1,053 测试通过，Schema 漂移检查 ok。本切片未提交，等待用户决定。

### 13.77 L1 requirement 切片：设计定案（2026-09-04）

用户于 2026-09-04 提交 L1 endpoint（`d7a2b13`）后授权我选片并开启 ultra。按 ADR-0013 G 序选 requirement（第 3 片；demand 与 tasking 依赖它）。先以一个理解工作流（六个并行读者：ledger、todo、Demand 消费方、旧 JS 事实、测试、合同，加一个完整性批评者）盘点被替代物，再定案如下。多选项处已按 ADR-0011、能力卡 3 与 ADR-0013 裁决落地；本节记录的判断供复核，检查点时可推翻。

- 范围与工具：切片 `src/capabilities/requirement/`。公共工具两个：`wakeflow_publish_requirement`（效果型，`action ∈ publish | activate | withdraw`，preview、apply、recover）与新的读工具 `wakeflow_inspect_board`（`view ∈ list | package`，列表按优先级、发布时间、标识排序，`limit` 有界，不做分页令牌）。删除 `wakeflow_publish_confirmation`、`wakeflow_intake_todo`、`wakeflow_inspect_todo`，目录从 23 个工具变为 21 个。
- 需求包记录：仍是 ledger 记录 `requirements/<requirementId>/`，`record.json` 加成员 `requirement.md`、`landing.md`、可选 `attachments/<name>`（只收文本媒体类型）；记录头部带 `demandType`、`priority`、`originWindowId`、`testingDecision{mode, summary}`、`taskPlanReview ∈ controller | user`、`supersedes`、`confirmation{confirmedAt, sectionDigest}` 与 `sections[{path, anchor, heading, line, bodyDigest}]`。成员角色收敛为 `requirement | landing | attachment`；confirmation family 整体删除。`requirementId` 由内容确定性派生（程序、设计面、成员摘要、头部），同内容重发为 `current`，改内容即新包，用 `supersedes` 连链；`recordedAt` 在 apply 时取钟，不进计划摘要。
- 章节校验：只认 H2；章节键为语言无关的锚点（goal、completion-definition、non-goals、acceptance-criteria、user-confirmation、code-facts、landing-plan、testing-decision、reproduction、scope、requirement-delta、research-question、boundaries、known-facts、method、fix-plan），中英文标题别名表在合同里；按 ADR-0011 D3 的四类必需表在 preview 报缺；未识别的 H2 以旧 archive 的 `normalizedMarkdownAnchor` 规则给锚点。锚点进记录，供任务包按"记录摘要加章节锚点"引用（能力卡 5）。
- 确认点 1 的形状：preview 总返回一页摘要（目标、完成定义、非目标、测试决策、范围）；请求不带 `confirmation{confirmedAt}` 或 requirement.md 缺用户确认节时 preview 为 `blocked`（`user-confirmation-missing`），Agent 让用户确认后写入确认节并带 `confirmedAt` 再 preview 得 `ready`，同一请求 apply。
- 认领状态：净新持久化 `.wakeflow-active/current/board/<requirementId>.json`（0700/0600），状态 `pending | parked | claimed | withdrawn | archived`，修订链 `revision` 加 `previousStateDigest`，每次变更为带期望节点的整文件替换（CAS），不设集合锁与日志；人读投影 `board/index.md` 确定性重写并由活动索引链接。状态转移是纯函数，存放在内核 `src/kernel/requirement-board.ts`：requirement 切片写 pending/parked/withdrawn，demand 侧的 create、complete、cancel 分别写 claimed、archived、withdrawn；这样 demand 成为切片后也不必跨切片引用。
- 隐私：requirement.md、landing.md、附件与标题都走内核 `privacy-scan`，不允许绝对路径与裸 UUID（tracked 记录不含私有值）；内核 privacy-scan 由此第一次有生产消费者，从架构门的孤根表移除。
- 旧 ledger 模块：保留摘要链模块（record、reader、store、store-contract、storage、intent、publisher、layout、paths、storage-policy、resource-catalog）并改造（去 confirmation、新记录形状与角色），删除 8 个协调器与计划模块（public-contract、public-coordinator、application-service、planning-service、plan、input、source、payload-materializer）；`LedgerAuthorityStore` 仍是 Demand、tasking、testing、evidence、review 的读取面，随后续切片收缩。todo 24 文件与其 Schema 全部删除。
- Demand 侧最小适配（同一提交，避免中间态不可编译）：`wakeflow_create_demand` 请求 `todoId` 改为 `requirementId`；权威从需求包单源收敛，`REQUIRED_ROLES` 改为四类都要求 `requirement` 与 `landing`；`DemandIdentity.source` 改为需求包谱系 `{requirementId, recordRef, recordDigest}`；apply 仍"根先建、后认领"，认领改为看板 CAS；D7 的"总控已有活动 Demand 即拒绝"以看板 `claimed` 且对应 Demand 未终态判定；`executionPlacement.isolated` 因 confirmation 授权消失而暂不可达（pod 切片按 ADR-0010 接管）；完成记录的 `todoSource` 改为 `packageSource`。
- 工作区耦合：fresh 物化把 todo 集合初始化改为看板目录与空索引（引用放在内核 layout），ledger 布局去掉 `confirmations/`，静态资源目录与计数随之变化；durable id 种类退役 `confirmation` 与 `todo`。
- 验收：`decide.test.ts`（章节校验、摘要、状态转移）、`service.test.ts`（发布两段 preview、apply、重放、supersedes、withdraw、看板查询、隐私拒绝）、内核 `requirement-board` 与 `markdown-sections` 直接测试；场景 `card-03/requirement-package` 接线，`card-04/create-demand` 按需求包重塑；被替代测试同提交删除或改写。

### 13.78 L1 requirement 切片：实现与验收（2026-09-04）

按 13.77 定案落地。实现分两段：内核与合同由我写；三个被替代的旧区域（ledger 改造、todo 删除加工作区改指、Demand 侧最小适配）以一个三代理工作流并行改写，各自只碰自己的目录，再由我集成。

- 合同：新 Schema `governance/ledger/requirement-record`（重写）、`governance/ledger/requirement-lineage`、`governance/board/requirement-claim-state`、wire `requirement-publication`（重写，四路 oneOf：publish、activate、withdraw、recover）与 `board-inspection`（新）；`demand-identity.source` 改为需求包谱系，发布事务与完成记录改为 `requirementId`、`expectedClaimStateDigest`、`packageSource`；成员引用 family 只剩 `requirement`，角色 `requirement | landing | attachment`；confirmation-record、todo 五份 Schema 与三对 wire Schema 删除；durable id 种类退役 `confirmation` 与 `todo`。合同数 118 → 106。
- 内核：`requirement-board.ts`（认领状态编解码、五个纯转移、独占创建与带期望的 CAS 替换、有界列出、看板索引确定性重写）、`markdown-sections.ts`（H2 切章，围栏内标题不算，锚点规则逐字沿用旧归档服务）、`layout.ts` 增看板路径、`next-projection` 增 `requirement-confirmation` 与 `requirement-claim`；词汇 `contracts/vocabulary/requirement-sections.ts`（16 个锚点、中英文别名、四类必需表、摘要章节表）。
- 切片 `src/capabilities/requirement/`：`decide.ts` 纯分析（章节、缺章、摘要、用户确认摘要、隐私阻塞、内容派生标识、认领转移阻塞）；`service.ts` 在 `runPublicationTransaction` 上实现 publish（两段 preview、apply 幂等、recover 由记录补看板、supersedes 自动撤回旧包）与 activate、withdraw，在 `runCommandShell` 上实现看板查询；`projection.ts` 排序过滤计数与 `next`。工具描述 480 与 300 字节。
- 旧区域：ledger 删 8 个协调器与计划模块，保留并改造 12 个摘要链模块（记录成员上限 32 → 18）；todo 24 文件与 17 份测试删除；工作区 fresh 物化改为看板目录与空索引（步骤 `active:requirement-board`），静态资源计数 43/51 → 39/47；Demand 发布改为看板认领（根先建后 CAS 认领，`active-demand-exists` 拒绝第二个活动 Demand），身份来源为需求包谱系，完成记录带 `packageSource`；测试卡的环境权威改为 landing 成员（决定器关系随之改）；`tasking/task-package.ts` 的模块级草稿引用改为 `requirement` 角色。
- 入口：目录改为 21 个工具（删 publish_confirmation、intake_todo、inspect_todo，增 inspect_board），executor `inspectBoard`；内核 `privacy-scan` 由本切片首次消费，从架构门孤根表移除。
- 验收：内核 `markdown-sections` 2 项、`requirement-board` 2 项；切片 `decide.test.ts` 4 项、`service.test.ts` 4 项（两段 preview、apply、同内容 current、plan-drift、看板 list 与 package、recover、缺章与隐私与类型阻塞、未知窗口与设计面、parked 激活、CAS 漂移、supersedes 撤回、withdraw；parked 激活后经 `create_demand` 认领得修订 3 的回执，再认领第二个包被 `active-demand-exists` 拒绝）；场景 `card-03/requirement-package` 接线通过，`card-04/create-demand` 按需求包重塑通过（场景报告 pass=6）；旧入口测试 4 份删除。集成时修掉三处代理遗漏：`task-package` 模块级引用的旧角色、决定器要求 `environmentMemberRef` 等于测试卡环境成员、旧编译产物残留。
- 度量：协调器 19 个 6,867 行 → 16 个 5,957 行（对基线 8,075 降 26%）；`tools/list` 125,158 → 114,783 字节（21 工具）；架构门 771 模块。
- 对抗评审（ultra）：四个视角找缺陷、每条两名怀疑者复核。采纳并修掉：认领状态 CAS 改为每包互斥锁内重读再替换（两个认领者恰有一个成功），锁放 `board/locks/`，列出时忽略锁目录与原子写残留；记录字节由请求完全决定（`recordedAt` 取确认时间，`confirmedAt` 与 parked 触发条件进入标识派生），崩溃后重放与 recover 得到同一份记录，parked 触发条件写进记录头部供 recover 重建；隐私命中时 preview 不回显任何章节正文，测试决策摘要、搁置触发条件与撤回理由也过隐私扫描，阻塞项上限 64，URL 路由与站内链接不算私有路径；preview 先把记录过一遍编解码器，写不进去的记录在 preview 报 `record-invalid:<reason>`；内核隐私扫描的行列定位改为线性；D7 的活动 Demand 检查在 apply 再查一次；parked 激活后的认领回执允许修订大于 2；看板索引重写相撞时重列重写；工具与 Schema 描述去掉 TODO 措辞；场景零写断言改在 preview 之前取快照。未采纳（记为残余）：并发认领失败方留下的孤儿 Demand 根（旧 root-first 设计，demand 切片处理）；完成与取消尚不把需求包置 archived/withdrawn（demand 切片）；supersedes 目标在 preview 后被认领时新包照常发布且不撤回旧包（结果里的 `superseded` 回执给出其状态）。
- 门：全量 `npm test` 通过：typecheck，架构门 771 模块 ok，Biome 0 错误（3 处旧树警告不变），格式检查通过，knip 无发现，945 测试通过（删除的 todo、ledger 协调器与旧入口测试使总数从 1,053 降到 945），Schema 漂移检查 ok。本切片未提交，等待用户决定。

### 13.79 L1 demand 切片：设计定案（2026-09-04）

用户于 2026-09-04 提交 L1 requirement（`0ac416e`）后指示进入 demand 切片，并撤回 ultra（本切片起单代理、最高精力）。依据能力卡 4（Q1 到 Q6 已裁决）、能力卡 8 的归档段、ADR-0012 D3 与 D5、ADR-0013 §4 第 4 行。以下是设计权范围内的定案；多选项处按上述裁决落地，一处判断（continue 语义）记为可在检查点推翻。

- 范围与工具：切片 `src/capabilities/demand/`，公共工具五个。`wakeflow_create_demand`（效果型，移入切片，改走内核 `runPublicationTransaction`：preview、apply 带 `planDigest`、recover 带 `operationId` 即 demandId）；`wakeflow_inspect_demand_route`（读，移入切片，结果加 `next`；活动根已删除的 Demand 返回 `archived` 分支：终态、归档引用与 continue 提示）；`wakeflow_complete_demand`（效果型，完成即归档）；`wakeflow_cancel_demand`（效果型，新增，取消即归档并撤回需求包）；`wakeflow_continue_demand`（效果型，新增，`action ∈ continue | record-decision`）。目录 21 → 23 个工具。
- 确定性计划：create 的 `demandId` 由 `requirementId` 与看板认领状态摘要派生，事件与提交标识由 demandId 与用途派生，身份与权威在 apply 取钟后创建；计划只含来源摘要，两个 preview 同一认领状态得同一计划，apply 重算比对 `planDigest`，漂移为 `precondition-failed/plan-drift`。complete、cancel、continue 的计划同样不含时间：完成记录的 `completedAt`、归档的 `archivedAt`、事件的 `recordedAt` 都在 apply 取钟。
- 完成即归档（ADR-0012 D3）：complete 的 preview 内嵌 verify 门（配置权威、Ledger 布局、Demand 根审计、看板认领、窗口工作声明、追加候选清空、证据完整性、归档负载隐私）与归档前置，任一不通过即 `blocked` 并列出阻塞项；apply 一个事务五步、每步幂等：写终态事件 → 封归档包 → 需求包置 `archived` → （取消时）释放本 Demand 的窗口工作声明 → 按精确清单退休活动根。步骤日志写在 `.wakeflow-active/current/lifecycle/<demandId>.json`（0600），recover 按日志向前重放，全部完成后删除日志。取消同理，终态事件为 `lifecycle.demand-cancelled`，需求包置 `withdrawn`，有待评审结果时拒绝（F5.5）。
- 归档包：`<ledger>/archives/<demandId>/<终态事件流修订号>/`，成员 `manifest.json`（种类、Demand 与需求包谱系、终态事件回执、verify 摘要、负载树摘要与计数、归档时间）、`verify-report.json`、`payload/**`（Demand 根去掉可重建的 `event-sourcing/snapshots`、`index`、`append-candidates`）。归档为 tracked 记录（0755/0644），隐私门只拒绝凭证类命中（能力卡 8 实现判断）。Ledger 布局新增 `archives` 容器，fresh 物化随之多一条声明。
- continue 语义（判断，可推翻）：只对已完成（归档）的 Demand 开放，从归档负载把活动根原样恢复，追加 `lifecycle.demand-continued{continuation{kind ∈ optimization | requirement-supplement | verified-bug, summary, archiveRef, archiveManifestDigest}}`，聚合回到 `active` 并标记"需要新规划"，路由前沿回到实现任务规划直到新任务包规划完成；需求包由 `archived` 回到 `claimed`（内核新增 `reclaimRequirementPackage`，只允许同一 Demand）。备选是以谱系新建一个 Demand，放弃的理由是能力卡 4 Q3 要求 continue 保留同一 Demand 的历史与身份。取消的 Demand 不能 continue。
- 升级与决定（ADR-0012 D5）：新增事件 `lifecycle.demand-escalated`（问题、需求章节引用、证据引用、备选方案与影响、建议、来源 ∈ rework-brake | review-decision）与 `lifecycle.decision-recorded`（升级事件标识、决定文本、所选方案）；聚合加 `awaitingDecision`，路由新增判定 `awaiting-decision`（前沿 `decision-required`，owner 用户）。同一任务第三次 rework 由决定器自动附带升级事件（一次提交两个事件；阈值先为常量 3，进配置留作残余）。用户回答经 `continue_demand{action: record-decision}` 记录；Design 补充需求包的回流走 requirement 切片。
- 事件溯源核心保留（仓储、决定器、聚合、编解码、快照）；删除发布协调器四件（public-contract、public-coordinator、planning-service、application-service）与 input 模块、生命周期六件（completion-plan、completion-service、public-contract、public-coordinator 与其测试）、控制器公共合同与协调器；`demand-completion.ts`（完成记录）与 `demand-completion-authority.ts`（组合准入）改造后由切片消费；`assertNoActiveDemand` 移到 `demand-active-guard.ts`。
- 验收：`decide.test.ts`（阻塞项派生、归档负载筛选、决定器刹车与三个事件的演进）、`service.test.ts`（create 两段与重放、complete 门与一个事务、cancel 释放声明并撤回包、continue 恢复根并回到 claimed、record-decision、recover）；场景 `card-04/complete-and-continue` 与 `card-08/complete-and-archive` 接线：前者走 cancel 路径并让 complete 的阻塞在 preview 可见，后者经公共工具把 Demand 推到 accepted 再完成即归档；若卡 6、7 的工具链在场景骨架内不可达，退回服务驱动的 fixture 并如实标注。

### 13.80 L1 demand 切片：实现与验收（2026-09-04）

按 13.79 定案落地，单代理实现（用户已撤回 ultra）。切片目录 `src/capabilities/demand/`：`contract.ts`（五个工具的合同与登记表条目）、`decide.ts`（纯决定）、`verify.ts`（内嵌 verify 门）、`archive.ts`（归档包与活动根的物理操作）、`context.ts`（共用上下文与 `next`）、`service.ts`（create 与 route 查询）、`lifecycle.ts`（complete、cancel、continue、record-decision）。

- 合同：新增 Schema `governance/demand/demand-escalated-event-data-v1`、`decision-recorded-event-data-v1`、`demand-continued-event-data-v1`、`governance/archive/demand-archive-manifest`；聚合状态 Schema 加 `awaitingDecision`、`continuation` 与目标级 `reworkCount`；wire Schema `demand-publication` 重写（create 请求不再回显计划，apply 只带 `planDigest`，recover 带 demandId）、`demand-completion` 重写、新增 `demand-cancellation` 与 `demand-continuation`、`demand-controller-route-result` 加 `archived` 分支与 `next`。合同数 106 → 114。目录 21 → 23 个工具，五个描述 306 到 445 字节。
- 事件溯源核心：三个生命周期事件进事件模块（数据按 Schema 严格准入）、版本编解码与决定器；决定器一次提交可带多个事件，第三次 rework（阈值常量 3）在同一提交附带 `lifecycle.demand-escalated`；聚合新增 `escalateDemandAggregateState`、`recordDecisionInDemandAggregateState`、`continueDemandAggregateState`，评审 rework 计数进 `reworkCount`（从未 rework 的目标不写入，既有 state digest 不变），完成拒绝未回答的升级与未规划的续接；仓库独占规则收窄为"同一仓库只能有一个未接受的实现目标"，续接后允许与已接受的历史目标共用仓库。路由新增 `awaiting-decision` 判定（前沿 `decision-required`，owner 用户）与续接后先要求实现任务规划。
- 内核与 Ledger：`layout.ts` 新增生命周期日志目录 `.wakeflow-active/current/lifecycle/` 与归档路径 `archives/<demandId>/<修订号>`；`requirement-board.ts` 新增 `reclaimRequirementPackage`（archived → claimed，只允许同一 Demand）；`next-projection` 新增 `decision-required` 与 `demand-continuation`，`awaiting-decision` 判定保留建议工具；Ledger 新增 `archives` 容器（布局三容器，fresh 物化声明 39/47 → 40/48）。
- 切片行为：create 的计划由需求包与看板认领状态确定性派生（demandId、事件与提交标识不含随机与时间），apply 取钟后创建身份与权威并交给既有发布服务；complete 与 cancel 共用五步事务（终态事件 → 封归档 → 需求包 archived/withdrawn → 取消释放工作声明 → 删活动根），每步幂等，步骤日志在活动根之外，recover 按日志重放，无日志而归档已在则返回归档回执；verify 门八道（配置权威、Ledger 布局、根审计、看板认领、工作声明、追加候选、证据完整性、负载隐私），报告随归档包保存，观察摘要进计划；归档负载排除 `event-sourcing/snapshots`、`index`、`append-candidates`，tracked 0755/0644，隐私门只拒凭证类；活动根删除只在负载摘要等于已封归档时执行，是仓库唯一的递归删除点；continue 从归档负载恢复活动根并补齐可重建目录，追加 `demand-continued`，需求包回到 claimed；record-decision 单步追加；route 查询对已归档 Demand 返回归档回执与 continue 提示。
- 删除：`demand-publication-public-contract`、`-public-coordinator`、`demand-event-sourcing-publication-planning-service`、`-application-service`、`-input`；`demand-completion-plan`、`-service`、`-authority`、`-public-contract`、`-public-coordinator`；`demand-controller-route-public-contract`、`-public-coordinator`；对应 9 份旧测试。`assertNoActiveDemand` 移到 `demand-active-guard.ts`，发布服务改捕 `WakeflowError`。旧 route 协调器的九处测试消费改为切片查询（`tests/capabilities/demand/route.fixture.ts`）；证据 fixture 改经切片创建 Demand，其固定 demandId 改为派生值并加漂移守卫。
- 验收：`tests/capabilities/demand/decide.test.ts` 5 项（标识派生、负载筛选与凭证扫描、阻塞项派生、第三次 rework 刹车与决定回答、续接转移）；`service.test.ts` 2 项（升级阻塞完成 → 记录决定 → 完成即归档零写 preview、plan-drift 拒绝、归档成员、需求包 archived、活动根与日志清理、archived 路由、recover → continue 重开并规划新任务 → cancel 撤回需求包并再归档 → 取消后 continue 被拒；未接受目标阻塞完成，取消释放窗口工作声明）；MCP 生命周期测试改为完成即归档并 recover；场景 `card-08/complete-and-archive`（经公共工具投递准备、认领、回执、结果导入、评审接受后完成即归档）与 `card-04/complete-and-continue` 接线通过，场景报告 pass=8。
- 度量：协调器 16 个 5,957 行 → 13 个 5,023 行（对基线 8,075 降 38%）；`tools/list` 114,783 → 113,012 字节（23 工具）；架构门 769 模块。
- 残余：rework 阈值仍是常量（ADR-0012 要求进配置）；real-environment 模式的 Demand 续接后规划新实现目标仍被"存在测试目标即拒绝"的聚合规则挡住；归档候选残留（`archives/<demandId>/.candidate-*`）与失败中途的生命周期日志由维护对账清理，尚未实现；worktree 来源成员留空给 pod 切片；verify 门是内嵌最小集，观察切片再扩为独立 `wakeflow_verify`；`record-decision` 没有步骤日志，recover 只服务 continue；`lifecycle.ts` 1,382 行偏大，后续切片可把日志与归档步骤下沉。
- 门：全量 `npm test` 通过：typecheck，架构门 769 模块 ok，Biome 0 错误（3 处旧树警告不变），格式检查通过，knip 无发现，926 测试通过（删除的发布、完成与路由协调器测试让总数从 945 降到 926），Schema 漂移检查 ok。本切片未提交，等待用户决定。

### 13.81 L1 tasking 切片：设计定案（2026-09-09）

demand 切片已提交（`82b83ea`）。按 ADR-0013 G 序，下一片是 tasking（第 5 片）。依据能力卡 5（Q1 到 Q6 确认记录与 ADR-0012 修订表）、ADR-0011 补充（`selectedAuthorityMemberRefs` 改为记录摘要加章节锚点；`taskPlanReview: user` 时任务清单先交用户过目）、ADR-0012 D4 与 D5，以及 L0.3 试点切片 `src/capabilities/tasking/plan-target-task.ts`。四处多选项列在末尾；用户于 2026-09-09 裁决『四个决定按建议』并授权进入本切片。

- 范围与工具：切片 `src/capabilities/tasking/`，公共工具仍只有 `wakeflow_plan_target_task`（追加型一次调用，`idempotencyKey` 加 `expectedStreamRevision`，结果带 `next`），登记表条目移入切片 `contract.ts`；试点的 `plan-target-task.ts` 拆为 `contract.ts`、`decide.ts`（锚点引用校验、谱系规则、审阅门，纯函数）、`service.ts`、`projection.ts`。
- 任务包 v2（改造 `governance/tasking/task-package.ts` 与 Schema，事件 `tasking.target-task-planned` 升到 v2）：
  - 验收锚点增加 `requirementRef{recordDigest, sectionAnchor, itemId}`（ADR-0012 D5）：指向需求包 `requirement.md` 验收标准节（锚点 `acceptance-criteria`）的一条列表项；内核 `markdown-sections` 增列表项切分，`itemId` 取该节内顶层列表项序号 `ac-<n>`，记录不可变且摘要钉住内容；引用的记录摘要不等于 Demand 谱系、节不存在或序号越界即拒绝，Controller 不能发明锚点。
  - 谱系 `lineage: {kind: "replacement", replacesTargetTaskId} | {kind: "continuation", continuesTargetTaskId} | null`（能力卡 5 Q2）：replacement 在创建时让旧目标进入新的终态 phase `superseded`（路由、完成与仓库独占都不再计入）；continuation 要求谱系头已 accepted；同仓库规则定为"同一仓库同时只有一个未接受且未被替代的实现目标"。
  - `taskPlanReview: user` 的需求包：追加请求必须带 `planReview{confirmedAt}`，摘要写进任务包；缺失时以 `precondition-failed/task-plan-review-required` 拒绝，结果 `next` 指向用户；不新增状态、工具或投影。
  - `selectedAuthorityRefs` 保持 Ledger 成员引用，增加可选 `sectionAnchors[]`（须在记录 `sections` 里），`confirmedContext` 保持自由文本。
  - test 类型任务包在本切片不动（仍绑定测试卡）。
- 删除：`target-task-planning-service.ts`、`-plan.ts`、`-authority.ts`、`-input.ts`、`-public-contract.ts`（约 1,565 行）及其测试；八处仍用 `TargetTaskPlanningService` 的 fixture（controller、delivery、review、testing）改经切片执行器规划；`task-package.ts`、`task-package-projection-store.ts`、`-paths.ts` 保留改造。
- 验收：`tests/capabilities/tasking/decide.test.ts`（锚点引用四种拒绝、谱系互斥与 superseded、审阅门）、`service.test.ts`（真实需求包锚点、replacement 让旧目标 superseded 且路由只剩新目标、`continue_demand` 之后的 continuation、`taskPlanReview: user` 的拒绝与通过）；场景 `card-05/plan-implementation-task` 扩展为带 `requirementRef` 的锚点与审阅门；`card-05/test-contract` 的归属按 D1。
- 裁决（2026-09-09，按建议）：
  - D1 测试合同归属。A：tasking 一并落 `testContract`，删除测试卡家族与 `plan_test_card`，改写 14 个消费者（聚合、决定器、路由、测试投递、dispatch packet、结果、评审、声明），约 9,100 行测试域代码受波及。B（建议）：tasking 只做实现任务包 v2 与谱系；`testContract`、测试卡删除与 `plan_test_card` 删除并入 delivery 切片，那里本来要按能力卡 6 重写 `prepare_delivery`、dispatch packet 与 test delivery，删卡代价最小；`card-05/test-contract` 场景随之挂到 delivery 切片。
  - D2 `selectedAuthorityRefs` 形状。建议保持成员引用加可选章节锚点；备选是改成 `{recordDigest, sectionAnchor}` 二元组，会波及投递 briefing、评审快照与证据的成员引用。
  - D3 `taskPlanReview: user` 的门。建议请求回显 `planReview.confirmedAt` 并记入任务包，与需求确认点同形；备选是新增"待审阅"状态与确认工具。
  - D4 replacement 的旧目标。建议新增 `superseded` phase；备选是从聚合删除旧目标，但评审快照与历史结果引用会断。

### 13.82 L1 tasking 切片：实现与验收（2026-09-09）

按 13.81 定案与四项裁决落地，单代理实现。切片目录 `src/capabilities/tasking/`：`contract.ts`（工具合同与登记表条目）、`decide.ts`（验收标准切分、锚点引用、章节锚点、审阅门、谱系期望与拓扑阻塞，纯函数）、`service.ts`（`runAppendCommand` 上的规划执行器，实现与 test 两类包共用一个入口）。试点的 `plan-target-task.ts` 与 `projection.ts` 设想合并进 `service.ts`，投影仍由既有 `task-package-projection-store` 写出。

- 合同：`governance/tasking/task-package` 升为 v2 形状（Schema 版本号不变，字段只增）：验收锚点必带 `requirementRef{recordDigest, sectionAnchor, itemId}`；实现包必带 `lineage`（`replacement | continuation | null`）、`planReview`（`controller` 或 `user + confirmedAt`）与 `sectionAnchors[]`，test 包禁止这三项。wire Schema `target-task-planning-request` 同步（实现包草稿加 `lineage`、`sectionAnchors` 与锚点 `requirementRef`，请求级可选 `planReview{confirmedAt}`），`-result` 回显 `lineage`；`target-result-review-inspection-result` 的任务包镜像补齐同样字段；聚合状态 Schema 加终态 phase `superseded` 与 `supersededByTargetTaskId`（completed 终态允许 superseded 目标并存）；`demand-controller-route-result` 的 phase 枚举同步。合同数 114 不变；目录仍 23 个工具，`wakeflow_plan_target_task` 描述 634 字节（上限 640）。
- 内核：`markdown-sections` 新增 `parseMarkdownListItems`（顶层 `-`/`*`/`+`/`1.` 列表项，围栏内不切，缩进续行并入，序号 `ac-<n>`）。需求包 `requirement.md` 经 Ledger 成员引用与记录摘要双重钉住后读入，锚点引用逐条对照：记录摘要不等于 Demand 谱系记 `anchor-record-drift`，节不是 `acceptance-criteria` 记 `anchor-section`，序号越界记 `anchor-item-unknown`，`sectionAnchors` 不在记录 `sections` 记 `section-anchor-unknown`，全部以 `precondition-failed` 拒绝并在 `details.blockers` 列全。
- 谱系与聚合：`planTargetTaskInDemandAggregateState` 按同仓库状态裁决——已有未接受且未被替代的目标时新包必须是它的 replacement 且旧目标处于可替代 phase（planned、delivery-prepared、host-effect-rejected、rework-requested、product-defect-rework-requested、redesign-requested、review-blocked），旧目标改写为 `superseded` 并记 `supersededByTargetTaskId`；只剩已接受目标时必须是其中之一的 continuation；仓库尚无目标时不得声明谱系。superseded 目标在路由（解析器返回空、开放目标集合排除）、评审后路由、完成转换与终态校验、测试卡基线与 test 包规划里一律不计入；demand 切片临时放宽的『续接后与已接受目标共用仓库』改由 continuation 谱系正式承担。审阅门：需求包 `taskPlanReview: user` 而请求缺 `planReview` 记 `task-plan-review-required`，非 user 却带 `planReview` 记 `task-plan-review-not-requested`。
- 删除：`target-task-planning-service.ts`（758 行）、`-plan.ts`（202）、`-authority.ts`（228）、`-input.ts`（329）、`-public-contract.ts`（48）、试点 `capabilities/tasking/plan-target-task.ts`（456）与三份旧测试（409 行），共 2,430 行；架构门的过渡准入项随之删除（生产根 11 → 10）。controller、delivery、review、testing 的八处 fixture 改经切片执行器规划（`planFixtureTargetTask`、`planFixtureTestTask`）。
- 验收：`tests/capabilities/tasking/decide.test.ts` 4 项（验收标准切分与围栏、锚点引用四类阻塞、谱系期望三态与可替代 phase、审阅门）；`service.test.ts` 4 项（真实需求包锚点提交与 `next`、发明锚点与漂移摘要拒绝、同仓库第二包必须 replacement 且旧目标 `superseded`、`taskPlanReview: user` 的拒绝与通过）；聚合测试新增 replacement 转换（无谱系拒绝、被替代目标不可再替代、superseded-only 不能 completed）；`test-task-planning-service.test.ts` 改写为 3 项围绕切片；`capabilities/demand/service.test.ts` 的续接后规划改为 continuation 谱系；场景 `card-05/plan-implementation-task` 扩为『发明锚点拒绝 → 首包提交 → 同仓库 replacement → 重放幂等 → 路由』，其后 `card-08` 的投递、评审与完成即归档在存在 superseded 目标的状态上通过，场景报告 pass=8。
- 度量：协调器 13 个 5,023 行不变（tasking 本无协调器）；`tools/list` 113,012 → 113,956 字节（23 工具）；架构门 769 → 765 模块；测试 926 → 928。
- 残余：test 类型包与 `plan_test_card` 未动，`testContract` 与测试卡删除按 D1 落 delivery 切片；`planReview.confirmedAt` 只记录不核实；`sectionAnchors` 只校验存在，不进投递 briefing（能力卡 6）；review inspection 的任务包镜像仍是手写副本，四处 wire Schema 靠 codegen 镜像测试防漂移；`service.ts` 646 行里 test 包分支约 200 行，随 delivery 切片一并删除；rework 阈值仍是常量。
- 门：全量 `npm test` 通过：typecheck，架构门 765 模块 ok，Biome 0 错误（3 处旧树警告不变），格式检查通过，knip 无发现，928 测试通过，Schema 漂移检查 ok。本切片未提交，等待用户决定。

### 13.83 L1 delivery 切片：设计定案（2026-09-09）

tasking 切片已提交（`0cf1962`）。按 ADR-0013 G 序，下一片是 delivery（第 6 片）。依据能力卡 6（Q1 到 Q5 裁决与两次修订）、能力卡 5 §5.3 Q6（prompt 骨架）、ADR-0009（五步握手、围栏令牌、hook 证据通道）、ADR-0010（投递目标 `(podId, windowId)`）、ADR-0012 D1（`wake-controller`）、D2（调用形状）、D4（`testContract`）与 13.81 D1（`testContract`、测试卡与 `plan_test_card` 删除并入本片）。现状核对：`src/governance/delivery/` 31 文件 10,987 行（4 个协调器 1,680 行），`src/governance/testing/` 23 文件 9,126 行（2 个协调器 783 行），`workspace/window-runtime` 的 Agent 窗口观察 2 文件 540 行（endpoint 切片留给本片删除），对应测试 39 文件 7,907 行；公共工具 23 个，其中投递相关 6 个（`prepare_implementation_delivery`、`prepare_test_delivery`、`claim_target_host_effect`、`record_target_host_effect_outcome`、`rearm_target_host_effect`、`plan_test_card`）；聚合投递事件 4 种（prepared、claimed、observed、rearmed）加测试卡事件。七处多选项列在末尾。

- 分两步提交。6a 投递链：`prepare_delivery`（含工作声明与许可）、`record_delivery_outcome`（hook 自动落地、ambiguous 出口）、`rearm_delivery`（上限 3），实现与 test 两类任务共用，test 分支暂以现有测试卡与尝试为合同来源；删除 delivery 31 文件、test delivery 与 dispatch 家族、Agent 窗口观察，工具 23 → 20，协调器 13 → 8。6b 测试合同：test 任务包 `testContract`、`plan_target_task` test 分支重写、测试卡家族与 `plan_test_card` 删除、聚合 test 状态改绑合同，工具 20 → 19，协调器 8 → 7。两步各过全量门与场景验收，各自提交。
- `wakeflow_prepare_delivery`（追加，`idempotencyKey` 加 `expectedStreamRevision`）：请求 `{root, demandId, targetTaskId, authored{goal, focus[≤2], boundary}, language?}`。Wakeflow 依次：目标 phase 必须是 planned、host-effect-rejected（rearm 用尽后）、rework-requested 或 product-defect-rework-requested；由任务包分配解析窗口，绑定必须 current（`bindingId` 加绑定摘要），Claude 另要求定位器记录；在共享协调根取得窗口工作声明（跨 Demand 排他，被占用即 `precondition-failed/window-claimed`，过期声明在 `next.blockers` 指向 release-claim）；确定性渲染 prompt 骨架并算信封摘要；追加 `delivery.delivery-prepared.v1`（投递身份、目标路由、任务包引用、prompt 全文与摘要、围栏 `{claimId, claimDigest, streamRevision}`、代际 1、返工或缺陷修复上下文、preparedAt）。旧的三段（preview、apply、claim）与 Agent 窗口观察前置合并为这一次调用；派发前的活性观察改为 skills 步骤，unobserved 不阻塞派发（能力卡 6 修订）。结果只带 `{status, delivery{deliveryId, envelopeDigest, generation}, permit{prompt, hostAction{effect: send-prompt-to-window, hostId, windowId, displayTitle, bindingId, handleDigest, locator?}, fence, issuedAt}, event, next}`，不回显状态；原始句柄仍不离开绑定文件，Agent 以 `handleDigest` 与定位器坐标核对自己观察到的会话。phase `planned → delivery-prepared`，`host-effect-claimed` 与 `target-host-effect-claimed` 事件删除。
- prompt 骨架（能力卡 5 Q6）：一行头 `Continue current window task: <displayTitle>/<targetTaskId>`、目标（authored goal）、完成焦点（≤2）、优先上下文（`confirmedContext[0]`）、关键边界（authored boundary 加包内 forbidden 首条）、验收锚点（≤4，`anchorId` 加 claim）、阅读顺序（任务包投影、需求记录 `sectionAnchors` 章节、工作区指令文件、仓库指令文件、状态根）、必需技能（宿主 profile 数据：implementation 为 target 加 target-craft，test 为 target 加 test）、身份块（demandId、podId、windowId、repositoryId、bindingId）、交回指针（`wakeflow_import_target_result` 带 deliveryId 与围栏）、派发记录（deliveryId、代际、claimDigest、streamRevision）。返工加"返工"节（评审决定的必要修正摘要，沿用现有 rework context）；test 加"测试合同"节（6a 取自测试卡：approvedPlan、允许技能、环境指令、尝试序号、停止条件；6b 取自 `testContract`）。语言 en 或 zh-Hans，上限 65,536 字符（现 32,768），全文进事件并被信封摘要覆盖。
- `wakeflow_record_delivery_outcome`（追加）：请求 `{root, demandId, deliveryId, fence{claimDigest}, attempt{status: sent | failed-before-send | unknown, evidenceDigest?}, readback?{status, evidenceDigest?}, resolution?, observedAt}`。准入派生处置：`accepted` 当且仅当存在目标会话的 `user-prompt-submit` hook 记录（sessionId 等于绑定私有句柄值，`promptDigest` 等于信封 prompt 摘要，`recordedAt ≥ issuedAt`），Codex 另接受 `sent` 加宿主发送调用成功返回的摘要；`rejected-before-send` 只用于 `failed-before-send`（发送调用本身失败且未触碰目标会话），立即释放声明；其余为 `indeterminate`，保留声明。回读只是补充观察，缺失或超时不降级。ambiguous 出口：再次调用（新幂等键）重查 hook 记录，匹配即转 accepted；静默超过阈值（常量 10 分钟）时 `next` 转给 Controller 并列出 `landing-evidence-missing`；显式解决 `resolution{disposition: accepted | rejected-before-send, hookRecordId?, rationale}` 只在 indeterminate 下允许，accepted 解决必须引用该会话 issuedAt 之后的一条 hook 记录。事件 `delivery.delivery-outcome-recorded.v1` 记处置、证据种类（hook-record、host-send-return、agent-declaration、controller-resolution）、记录标识与摘要、声明处置；围栏不符即 `precondition-failed/fence-mismatch`。
- `wakeflow_rearm_delivery`（追加）：只允许当前处置为 rejected-before-send（含解决为 rejected）的投递；同信封同 prompt，代际加一，重新取得全新声明并重发许可；同一信封最多 3 次（常量 `DELIVERY_REARM_LIMIT`），超过即 `precondition-failed/rearm-limit`，`next` 指向重新准备新信封。事件 `delivery.delivery-rearmed.v1`。
- 工作声明下沉内核 `kernel/work-claims.ts`：`{claimId, windowId, holder{demandId, targetTaskId, deliveryId, generation}, claimedAt, claimDigest}`，路径与共享协调根不变；消费者为 delivery（取得、释放）、endpoint（release-claim 强制释放）、demand（取消释放、完成 verify 门）。替换 `window-work-claim` 四文件 1,072 行。
- 聚合与事件：`currentDelivery` 改为 `{deliveryId, envelopeDigest, generation, fence, hostId, bindingId, outcome?{disposition, evidenceKind, observedAt}, targetResult?, reviewDecision?}`；phase 词汇删 `host-effect-claimed` 与 `test-host-effect-claimed`，其余保留；旧四种投递事件与测试投递变体删除，无历史流需要升版（ADR-0008 新版本系）。result import（结果导入要求投递 accepted 且围栏一致）、评审快照、缺陷返工、路由与 `next` 投影按新形状改接；`next` 词汇删 `implementation-host-effect-claim` 与 `test-host-effect-claim`。
- 回调 `wake-controller`：信封种类在事件里保留 `kind: target | callback` 判别，但生产者是 `import_target_result`（ADR-0012 D1），本片不实现回调渲染、回调 outcome 与 `callback-acknowledged`，随 result-review 切片落地（见 D4）。
- pod：绑定记录尚无 `podId`，投递目标本片仍是 `windowId` 加绑定代际；`podId` 进身份块与信封、产品窗口 worktree 回执门留给 pod 切片。
- 删除（6a）：`governance/delivery` 全部 31 文件（工作声明改写进内核）；`governance/testing` 的 `test-delivery-*`、`test-dispatch-*`、`test-host-effect-claim-authority`、`test-delivery-agent-host-action`（约 5,600 行）；`workspace/window-runtime/wakeflow-agent-host-window-observation(-authority)`；10 份投递 wire Schema 换为 6 份（三工具的请求与结果）；`tests/governance/delivery/*` 与 `tests/governance/testing/test-delivery-*` 换为 `tests/capabilities/delivery/`。（6b）：`test-card*`、`test-card-planning-*`、`test-card-generation-source`、`test-task-package`、`test-task-planning-authority`（约 3,200 行）、`plan_test_card` 及其 Schema 与测试；聚合 `currentTestCard`、`pendingTestRetest`、`testAttempts` 改绑 `testContract` 摘要，result 与 review 的测试卡引用改为任务包引用（逐步记录、verdict 与分类留给 result-review 切片）。
- 验收：`tests/capabilities/delivery/decide.test.ts`（骨架确定性与上限、两宿主处置派生、围栏不符、rearm 上限、ambiguous 解决规则）、`service.test.ts`（准备取得声明并返回许可、第二个 Demand 被声明阻塞、`user-prompt-submit` 记录落地、Codex 发送返回落地、indeterminate → 记录到达 → accepted、rejected → rearm 三次 → 上限、重放幂等）；场景 `card-06/delivery-chain`（`card-08` 的投递链改经新工具与 hook 记录）与 `card-06/ambiguous-resolution`；6b 场景 `card-05/test-contract`。
- 度量目标：协调器 13 → 8 → 7（5,023 → 约 2,600 行）；`tools/list` 随 5 份大 Schema 删除明显下降；架构门模块数下降约 60。
- 裁决（2026-09-09，用户确认『确认 继续』，七项均按建议）：
  - D1 提交粒度。建议分 6a、6b 两步各自过门提交；备选一次提交全部。
  - D2 落地证据来源。建议按能力卡 6 修订：Claude 只认 `user-prompt-submit` 记录，Codex 另认宿主发送调用成功返回；备选两宿主都只认 hook 记录。
  - D3 hook 自动落地的触发方式。建议惰性：`record_delivery_outcome` 与后续 `import_target_result` 在准入时重查 hook 记录，路由与状态只读报告 `awaiting-landing`，不新增后台扫描；备选由 L3 的 hook 脚本直接调用 MCP 写入。
  - D4 `wake-controller` 归属。建议本片只保留信封种类判别，回调渲染、outcome 与 acknowledged 随 result-review 切片一起实现（生产者在 `import_target_result`，本片实现会留下不可达代码且无场景）；备选本片先实现机制加临时内部生产者。
  - D5 prompt 形状。建议请求只带 `authored{goal, focus, boundary}`，其余由 Wakeflow 渲染并摘要（能力卡 5 Q6）；备选沿用 Controller 自由文本整段 prompt。
  - D6 工作声明落点。建议下沉 `kernel/work-claims.ts`；备选留在 `governance/delivery` 作共享层。
  - D7 阈值。建议静默阈值 10 分钟与 rearm 上限 3 先作常量（ADR-0012 未决数值），进配置留给观察切片；备选本片即进 `wakeflow.config.json`。

### 13.84 L1 delivery 切片 6a：投递链实现与验收（2026-09-10）

按 13.83 定案与七项裁决落地 6a，单代理实现。切片目录 `src/capabilities/delivery/`：`contract.ts`（三条登记表条目与合同）、`decide.ts`（处置派生、静默阈值、准备与 rearm 的 phase 阻塞、声明占用判定，纯函数）、`prompt.ts`（可移植 prompt 骨架的确定性渲染）、`service.ts`（`runAppendCommand` 上的三个执行器：准备、结局、rearm）。工作声明下沉 `src/kernel/work-claims.ts`（D6）。投递记录留在 `governance/delivery/`：`delivery-envelope.ts`（信封，含返工与缺陷修复上下文）、`delivery-outcome.ts`、`delivery-rearm.ts`（`DELIVERY_REARM_LIMIT = 3`）。

- 合同：新增 `governance/delivery/{delivery-envelope, delivery-outcome, delivery-rearm}` 三份记录 Schema 与 `demand/delivery-{prepared, outcome-recorded, rearmed}-event-data-v1` 三份事件数据 Schema；聚合状态 `currentDelivery` 改为 `{deliveryId, envelopeDigest, promptDigest, generation, hostId, bindingId, fence{claimId, claimDigest, streamRevision}, outcome?, targetResult?, reviewDecision?}`，phase 词汇删 `host-effect-claimed` 与 `test-host-effect-claimed`，test 目标的 `testAttempts` 记 `{attempt, delivery{deliveryId, envelopeDigest, preparedAt}}`；durable id 种类加 `work-claim`。wire Schema 10 份投递合同换为 6 份（`prepare-delivery`、`record-delivery-outcome`、`rearm-delivery` 的请求与结果）；`target-result-import-request` 改为 `{demandId, deliveryId, claimDigest, report}`，结果的 `hostEffect` 换为 `delivery{generation, fence, outcomeDigest, disposition, readbackStatus, observedAt}`；review 决定与缺陷修复授权的 `testDispatchPacketDigest` 删除；路由与 `next` 词汇删 claim 前沿，加 `test-delivery-rearm-planning → test-host-effect-rearm`。合同数 114 → 102。
- `wakeflow_prepare_delivery`：请求 `{root, demandId, idempotencyKey, expectedStreamRevision, targetTaskId, authored{goal, focus[1..2], boundary}, language?}`（D5）。执行顺序：同键重放先行；观察修订核对（过期即 `concurrency-conflict/stream-revision`，不取声明）；目标 phase 阻塞（`target-phase:<phase>`；rejected 但 rearm 未用尽记 `rearm-available:<generation>`）；任务包与当前绑定（宿主不符 `binding-host`，缺绑定 `binding-missing`）；窗口工作声明（他 Demand 或他目标持有即 `precondition-failed/window-claimed`，同目标的孤儿声明回收）；返工与缺陷修复上下文从结果历史派生；test 目标的初次或重跑尝试从测试卡派生（6a 过渡）；渲染骨架并追加 `delivery.delivery-prepared.v1`；追加失败即释放本次新建的声明。结果 `permit{prompt, hostAction{effect: send-prompt-to-window, hostId, windowId, displayTitle, bindingId, handleDigest}, fence{claimId, claimDigest, streamRevision}, issuedAt}`，句柄只以摘要出现；`locator` 与 `podId` 未进许可（分别留给 result-review 与 pod 切片）。
- prompt 骨架（能力卡 5 Q6）：头行、目标、完成焦点、优先上下文、关键边界、验收锚点（≤4）、测试合同（test，取自测试卡）、返工或缺陷修复依据、阅读顺序（任务包投影、需求章节、工作区与仓库指令文件、状态根，全部相对窗口根）、必需技能、身份块（podId 暂为 `primary`）、交回指针、派发记录；en 与 zh-Hans 两套标签；可移植上限 60,000 字符（记录上限 65,536）。命令壳的私有文本检查要求 prompt 不含工作区绝对路径，骨架据此改为相对路径。
- `wakeflow_record_delivery_outcome`：处置由证据派生（D2）：目标会话在 `preparedAt` 之后、`promptDigest` 相符的 `user-prompt-submit` hook 记录 → `accepted/hook-record`；`failed-before-send` → `rejected-before-send/agent-declaration` 并释放声明；Codex 的 `sent` 加 `evidenceDigest` → `accepted/host-send-return`；其余 `indeterminate/agent-declaration` 并保留声明，结果 `next.blockers` 列 `landing-evidence-missing`。indeterminate 之后再次调用（新键）即惰性重查（D3）：记录到达即 accepted；仍无证据不追加事件而以 `precondition-failed/landing-evidence-missing` 拒绝，静默超过 10 分钟（D7 常量）时 details 另列 `landing-silence-exceeded`，由 Controller 决断；显式解决 `resolution{disposition, hookRecordId?, rationale}` 只在 indeterminate 允许（否则 `resolution-phase`），accepted 解决必须引用该会话的一条真实记录（否则 `resolution-evidence-missing`）。围栏不符 `fence-mismatch`；accepted 之后再记 `target-phase`。
- `wakeflow_rearm_delivery`：只接受当前代际 rejected-before-send 的投递（否则 `target-phase`）；绑定未变，取新声明，代际加一，同信封同 prompt 重发许可；同一信封三次之后 `rearm-limit`，此时 `prepare_delivery` 允许换新信封（phase host-effect-rejected 且 generation 4）。
- 结果导入与评审改接：`target-result` 记 `deliveryId` 与 `delivery` 绑定，事件与提交身份由声明派生（`deriveDurableId(..., "target-result", claimId)`）；导入准入核对宿主、围栏摘要与结局（rejected 不可导入），结果事件之后经内核释放声明；评审快照、缺陷返工、评审后路由按新形状读取。endpoint 的 release-claim、demand 的取消释放与完成 verify 门改用内核声明。
- 删除：`governance/delivery` 26 文件（协调器 4 个 1,680 行在内）、`governance/testing` 的 `test-delivery-*`、`test-dispatch-*`、`test-host-effect-claim-authority`、`test-delivery-agent-host-action`、`workspace/window-runtime` 的 Agent 窗口观察两文件、10 份旧投递 wire Schema 与生成物、旧投递事件与聚合的 claim 状态；`foundation/filesystem/create-only-deterministic-json-resource`（仅旧声明存储使用）随之删除。`src` 与 `tests` 合计删除 39,388 行、新增 3,524 行。
- 验收：`tests/capabilities/delivery/decide.test.ts` 7 项（hook 记录、发送前失败、indeterminate、Codex 发送返回、解决规则与优先级、静默阈值、phase 阻塞、声明占用与回收、技能路径）；`service.test.ts` 4 项（准备取得声明并返回可移植许可、重放幂等、异请求、过期修订、非法 phase；围栏不符、indeterminate 保留声明、静默超时拒绝并列出阻塞、落地后 accepted、显式解决缺证据；Codex 发送返回、rejected 释放声明、rearm 三次到上限后重新准备、rearm 重放；Controller 显式解决为 rejected 后可 rearm）。工作区夹具 `tests/governance/delivery/delivery-workspace.fixture.ts`（实现链：规划 → 绑定 → 准备 → hook 落地 → accepted）与 `test-delivery-workspace.fixture.ts`（测试链）取代旧的 preparation 与 claim 夹具，评审、结果、路由、生命周期、MCP 生命周期与场景测试改经切片执行器；聚合、决策器、升级器、命令处理器测试改用 `delivery-records.fixture.ts` 的信封、声明、结局与 rearm 记录。场景新增 `card-06/delivery-chain`（准备与许可、重放幂等、无落地证据的 indeterminate 保留声明）与 `card-06/ambiguous-resolution`（hook 记录到达后再次记录即 accepted，路由到结果导入），`card-08` 的投递链改经新工具，场景报告 pass=10。
- 度量：公共工具 23 → 21；`tools/list` 113,956 → 95,265 字节；协调器 13 个 5,023 行 → 8 个 2,892 行；架构门 765 → 690 模块（生产根 10 不变）；测试 928 → 864；投递切片 2,290 行加内核声明 417 行，投递记录 1,695 行。
- 残余：test 分支的测试合同仍取自测试卡，`testContract`、测试卡家族与 `plan_test_card` 删除按 D1 落 6b；`wake-controller` 回调按 D4 随 result-review 切片；`podId` 与 Claude 定位器坐标未进许可；静默阈值与 rearm 上限是常量；Claude 宿主的 `user-prompt-submit` 记录由 L3 hook 脚本写入，本片只验证记录通道（真实宿主会话未运行，按 CLAUDE.md 记为未验证）。
- 门：全量 `npm test` 通过：typecheck，架构门 690 模块 ok，Biome 0 错误（3 处旧树警告不变），格式检查通过，knip 无发现，864 测试通过，Schema 漂移检查 ok；两制品 `tools/list` 探针各 21 工具 95,265 字节；`git diff --check` 干净。本切片未提交，等待用户决定。

### 13.85 L1 delivery 切片 6b：测试合同设计定案（2026-09-10）

6a 已提交（`d5213e1`）。按 13.83 D1，6b 把测试合同并入 test 任务包并删除测试卡家族与 `wakeflow_plan_test_card`（ADR-0012 D4；能力卡 5 修订表 5.2、Q3、Q4、Q5、尝试）。现状核对：`src/governance/testing/` 11 文件 3,603 行（测试卡记录 768、卡规划服务 799、卡规划协调器 333、卡规划权威 355、卡规划计划 235、生成来源 153、投影路径 107、卡合同 89、test 任务包 169、test 规划权威 225、执行尝试 370），对应测试 6 文件 1,052 行；测试卡记录含 15 个 Controller 撰写字段与 8 个派生字段；聚合以 `currentTestCard`、`pendingTestRetest{previousTestCard, productDefectRemediation}`、`testAttempts` 承载测试状态；评审后路由 `real-environment-test-planning`（建卡）与 `test-task-planning`（绑卡建包）两步；评审的尝试容量、缺陷修复授权的 `source.testCard` 与基线、结果的 `testExecution.testCard`、执行尝试的 `testCard` 元组、投递信封的 `testCard` 元组与 prompt 测试合同节都引用测试卡。公共工具 21 个，协调器 8 个。七处多选项列在末尾。

- `testContract`（test 任务包字段，实现包禁止）：`{question, objectBoundary, steps[1..20]{stepId, given, when, then, requirementRef{recordDigest, sectionAnchor, itemId}}, environment: LedgerAuthorityMemberReference, allowedSkills[], setupPolicy: fresh-once | fresh-per-attempt | reuse-existing, maxAttempts 1..10, stopConditions[1..8]}`。Controller 只写 `question`、`objectBoundary`、每步的 `given/when/then` 与所引用的验收标准项、`allowedSkills`、`setupPolicy`、`maxAttempts`、`stopConditions`；`stepId` 由 Wakeflow 按顺序编为 `ts-<n>`，`requirementRef` 复用 tasking 切片的锚点校验（记录摘要、`acceptance-criteria` 节、序号），每条验收标准项至多被一步引用，一步只引用一条；`environment` 由 Demand 权威的 `testingDecision.environmentMemberRef`（需求包 landing 成员）派生，Controller 不得提供。测试卡的 `controllerSelfChecks`、`realScenarioConditions`、`successMeans`、`failureMeans`、`cannotConclude`、`evidenceRequired`、`allowedOperations`、`forbiddenOperations` 不再是独立字段：成功与失败的含义进入每步 `then`，允许与禁止操作进入任务包 `boundaries`，证据要求进入 `completionExpectations`，自检与真实场景条件进入 `confirmedContext`。冻结语义由任务包不可变性承担（能力卡 5 修订）。
- test 任务包其余字段：与实现包同样由 Controller 撰写 `objective`、`confirmedContext`、`boundaries`、`completionExpectations`；`assignment.windowId` 由配置的 test 角色窗口派生；`selectedAuthorityRefs` 由需求包记录摘要加 `sectionAnchors` 解析（与实现包同一机制）并自动并入 `environment`；`implementationBaselines[1..]{targetTaskId, taskPackageId, taskPackageDigest, repositoryId, windowId, targetResultId, resultDigest, targetReviewDecisionId, decisionDigest}` 由 Wakeflow 从当前已接受且未被替代的实现目标派生（原测试卡字段迁入包）；`acceptanceAnchors` 仍为空数组；`lineage` 为 `null`（首轮）或 `{kind: retest, retestsTargetTaskId, productDefectRemediationId, authorizationDigest}`（缺陷修复后的新代际，能力卡 5 Q5）。任务包 Schema 版本号不变，字段只增删 test 分支。
- 规划准入（并入 tasking 切片 `decide.ts` 与 `service.ts` 的 test 分支，`test-task-planning-authority` 删除）：Demand 测试决定必须是 real-environment（否则 `testing-mode`）；执行位置 main（isolated 仍 `placement-not-implemented`）；评审后路由必须处于 `test-task-planning`（原 `real-environment-test-planning` 合并进来，路由的 `nextStage` 直接携带 `testEnvironmentAuthority`、`implementationBaselines` 与可选 `retest` 来源）；基线窗口无工作声明（内核 `inspectWorkClaim`）；同一时间只允许一个未终结的 test 目标（能力卡 5 Q4）；retest 谱系必须引用聚合 `pendingTestRetest` 记录的上一 test 目标与授权摘要，首轮谱系在存在 `pendingTestRetest` 时被拒。
- 聚合与事件：删 `currentTestCard` 与 `createTestCardInDemandAggregateState`、事件 `testing.test-card-created` 与生成来源；`pendingTestRetest` 改为 `{previousTestTarget{targetTaskId, taskPackageId, taskPackageDigest}, productDefectRemediation{productDefectRemediationId, authorizationDigest}}`，由缺陷修复授权写入、由 retest 谱系的 test 包规划清除；test 目标状态的 `testCard` 摘要换为包引用（`taskPackageId`、`taskPackageDigest` 已在目标摘要里，无需新字段）；`testAttempts` 上限改为包内 `maxAttempts`。无历史流需要升版（ADR-0008 新版本系）。
- 执行尝试：`TestExecutionAttempt.testCard` 元组换为 `contract{taskPackageId, taskPackageDigest}`；`environmentSetup` 仍由 `setupPolicy` 派生；`initial | rerun` 与 rerun 来源不变。能力卡 5 修订"一次尝试可指定 `stepIds` 只跑失败子集"推迟到 result-review 切片（失败子集来自逐步记录，本片没有逐步分类）。
- 投递、结果与评审改接：信封删 `testCard` 元组（`target.taskPackageDigest` 已钉住合同），prompt 测试合同节改从包渲染（问题、对象边界、逐步 given/when/then、环境成员引用、允许技能、环境指令、尝试序号、停止条件）；test 结果的 `testExecution.testCard` 删除，报告 `stepEvidence` 由 `{planIndex, step, evidence}` 改为 `{stepId, evidence{ref, digest}}`，`completed` 要求覆盖全部 `stepId`；test 评审决定的 `testExecution.testCard` 删除、尝试容量改读包的 `maxAttempts`；缺陷修复授权的 `source.testCard` 换为 `source.testTaskPackage{taskPackageId, taskPackageDigest}`，`affectedTargets[].baseline` 的类型移到任务包模块；评审快照、评审后路由与 Controller 路由删 `test-card-planning` 前沿。`plan_test_card` 及其 2 份 wire Schema、协调器与合同删除；`plan_target_task` 请求 Schema 的 `testTaskPackageRequest` 从 `{workType}` 扩为上述撰写字段，结果回显 `lineage` 与 `testContract` 摘要（步数、预算、环境成员引用）。
- 删除：`governance/testing` 除 `test-execution-attempt.ts` 外全部 10 文件（3,233 行）；Schema `test-card`、`test-card-generation-source`、`test-card-created-event-data`、`wakeflow-test-card-planning-request/result`；聚合 `test-cards-root` 投影声明；仓储 `testCards` 历史与 `findTestCardCreatedEvent`；`tests/governance/testing` 全部改写为 `tests/capabilities/tasking/` 的 test 包用例与一份 `accepted-real-environment` 工作区夹具。
- 验收：`tests/capabilities/tasking/decide.test.ts` 增 test 合同判定（步骤锚点引用与重复、预算与停止条件边界、技能路径形状、活动 test 目标唯一、retest 谱系与 `pendingTestRetest` 的匹配）；`service.test.ts` 增 test 包提交（真实需求包验收标准派生步骤、环境成员派生、基线派生、同键重放、controller-only 拒绝、retest 谱系）；评审、缺陷修复、结果与路由测试改经新夹具；场景 `card-05/test-contract`：主链需求包改为 real-environment，接受后规划 test 包（步骤来自 AC-1、AC-2）、经 `card-06` 工具链投递与落地、导入逐步证据、test 评审 accept、路由到 `completion-preflight` 且 `testingClosure` 为 real-environment，随后 `card-08` 完成即归档的 verify 门覆盖测试闭合；controller-only 的完成继续由 demand 切片与 MCP 生命周期测试覆盖。
- 度量目标：公共工具 21 → 20；协调器 8 → 7；`governance/testing` 3,603 → 约 370 行；合同 102 → 约 97；架构门模块约 690 → 675。
- 裁决（待用户确认）：
  - D1 合同字段集。建议按 ADR-0012 D4 收窄为问题、对象边界、逐步 given/when/then、环境引用、允许技能、设置策略、尝试预算、停止条件，其余八个测试卡列表并入包的既有字段；备选把 15 个撰写字段整体搬进 `testContract`。
  - D2 基线与环境的来源。建议由 Wakeflow 从已接受目标与 Demand 权威派生进包，Controller 不提供；备选由 Controller 在请求里回显并由 Wakeflow 核对。
  - D3 retest 代际的表达。建议 test 包 `lineage{kind: retest}` 加聚合 `pendingTestRetest` 标记（授权写入、规划清除）；备选不留标记，规划时从事件历史推导上一 test 目标与授权。
  - D4 失败子集重跑（`stepIds`）。建议推迟到 result-review 切片，与逐步记录一起落地；备选本片让 `prepare_delivery` 请求为 test 目标带 `stepIds`。
  - D5 `allowedSkills` 约束。建议 L1 只校验可移植技能路径形状（`skills/<name>/SKILL.md`）与去重，存在性由 L3 制品校验器负责；备选在 L1 固定一份技能常量表。
  - D6 场景策略。建议把场景主链的需求包改为 real-environment，让接受 → test 包 → 投递 → 导入 → test 评审 → 完成即归档全部经公共工具走通，controller-only 的完成由单元与 MCP 生命周期测试覆盖；备选保持主链 controller-only，另开第二个一次性工作区单独跑测试链。
  - D7 报告逐步证据的键。建议改为 `stepId` 并要求 `completed` 覆盖全部步骤；备选保留 `planIndex` 加步骤原文。
  - 裁决（2026-09-10，用户确认『确认 继续』，七项均按建议）。

### 13.86 L1 delivery 切片 6b：测试合同实现与验收（2026-09-10）

按 13.85 七项裁决落地 6b，单代理实现：测试合同并入 test 任务包，测试卡家族与 `wakeflow_plan_test_card` 删除。

- 合同：`governance/tasking/task-package` test 分支新增 `testContract{question, objectBoundary, steps[1..20]{stepId: ts-<n>, given, when, then, requirementRef}, environment: LedgerAuthorityMemberReference, allowedSkills[≤8], setupPolicy, maxAttempts 1..10, stopConditions[1..8]}`、`implementationBaselines[1..32]` 与 `lineage: null | {kind: retest, retestsTargetTaskId, productDefectRemediationId, authorizationDigest}`（D1、D2、D3）；`test-execution-attempt` 的 `testCard` 元组换为 `contract{taskPackageId, taskPackageDigest}`；投递信封 test 分支只带 `attempt`；结果与 test 评审决定的 `testExecution` 只剩 `testAttemptId`；报告 `stepEvidence{stepId, evidence{ref, digest}}`（D7）；缺陷修复授权 `source.testTaskPackage{taskPackageId, taskPackageDigest}`，`affectedTargets[].baseline` 类型移到任务包模块；聚合删 `currentTestCard`，`pendingTestRetest` 改为 `{previousTestTarget{targetTaskId, taskPackageId, taskPackageDigest}, testReviewDecision, productDefectRemediation}`；durable id 种类删 `test-card`；事件 `testing.test-card-created` 与生成来源删除，无历史流需要升版。wire：`plan_target_task` 请求的 `testTaskPackageRequest` 从 `{workType}` 扩为 `{workType, objective, confirmedContext, selectedAuthorityMemberRefs, boundaries, completionExpectations, testContract（无 stepId 与 environment）, lineage: null | {kind: retest, retestsTargetTaskId}}`，结果回显 `lineage` 与 `testContract{stepCount, maxAttempts, environmentMemberRef}`；评审检查结果的 `reviewTaskPackage` 镜像同步；Controller 路由结果删 `test-card-planning` 前沿，`isolated-test-planning-not-implemented` 的 owner 改 `test-task-planning`；`plan_test_card` 两份 wire Schema 删除。Schema 102 → 96。
- 规划（`capabilities/tasking`）：`decide.ts` 新增 `deriveTestStepReferenceBlockers`（每步 `requirementRef` 复用锚点校验：`step-record-drift`、`step-section`、`step-item-unknown`）、`deriveTestPlanningBlockers`（`testing-mode`、`demand-lifecycle`、`awaiting-decision`、`implementation-targets-missing`、`implementation-target-not-accepted`、`test-target-open`、`lineage-retest-required`、`lineage-retest-target`、`test-retest-not-authorized`、`lineage-unexpected`）与 `deriveImplementationBaselines`（从聚合已接受目标派生）；`service.ts` test 分支：窗口取配置的 test 角色窗口，环境取需求包唯一 landing 成员（`resolveDemandTestEnvironmentAuthority`，由评审后路由模块导出），`stepId` 顺序编号，retest 谱系的授权身份从 `pendingTestRetest` 补齐；`rejectWith` 改为逐条 `blocker`、`blocker2`… details（至多八条，原 `blockers` 逗号串违反 details 值形状）。`allowedSkills` 只校验路径形状与去重（D5）。工具描述压到 640 字节上限内。
- 聚合与路由：`planTargetTaskInDemandAggregateState` test 分支要求谱系闭合 `pendingTestRetest`（首轮要求无 test 目标且无待消费复测）、全部现存实现目标已接受且与包内基线逐字段一致，并清除 `pendingTestRetest`；状态不变量改为"未终结 test 目标至多一个，且只能站在全部已接受的实现基线上"，缺陷代际之后的产品返工不受此限；完成转换的 real-environment 闭合是无待消费复测、恰一个未终结 test 目标且 `test-accepted`。评审后路由：`real-environment-test-planning` 并入 `test-task-planning{testEnvironmentAuthority, retest: DemandPendingTestRetest | null}`；无未终结 test 目标时，待消费复测或首个合同交给 test 规划，否则最新缺陷代际（评审快照里未被 retest 谱系引用的那一个）为 `test-product-defect-escalated`；`reviewedTest`、`testDelivery`、`openTestStage` 三个纯函数替代原内联分支。仓储审计：retest 谱系的 test 包必须引用已存在授权、授权早于包、被引用目标处于 `test-product-defect`、每份授权至多被消费一次；`pendingTestRetest` 与唯一未消费授权逐字段核对。
- 投递、结果与评审改接：prompt 测试合同节改从包渲染（问题、对象边界、`attempt n of m`、环境成员引用、环境指令、逐步 given/when/then、允许技能、停止条件）；`createTestTargetResult` 不再带测试卡，报告的 `stepId` 必须属于合同且不重复，`completed` 覆盖全部步骤；test 评审容量读包内 `maxAttempts`；缺陷修复服务从事件历史里的 test 包取基线并核对包摘要；结果导入权威不再读测试卡事件。
- 删除：`governance/testing` 10 文件（3,240 行）、`tests/governance/testing` 6 文件（1,052 行）、5 份 Schema 与生成物、聚合 `test-cards-root` 投影声明、仓储 `testCards` 历史与 `findTestCardCreatedEvent`、`plan_test_card` 执行器与登记。`src`、`tests` 与生成物合计删除 9,620 行、新增 2,926 行。
- 验收：`tests/capabilities/tasking/decide.test.ts` 增 2 项（步骤引用三处阻塞；规划准入、基线派生与拓扑门）；`service.test.ts` 增 2 项（发明的步骤条目、无待消费复测的 retest 谱系、提交与 `stepId` 编号、环境与窗口派生、基线派生、同键重放、第二个未终结 test 目标；controller-only 拒绝）；新夹具 `tests/governance/tasking/test-task-planning.fixture.ts`（已接受的 real-environment Demand 加合同请求）取代测试卡夹具，测试链修订从 7/8 回到 6/7；缺陷修复服务测试改走 retest 谱系（首轮谱系被拒、错误授权身份在聚合被拒、retest 包消费 `pendingTestRetest` 并携带返工后的新基线）；路由、Controller 路由与矩阵（20 → 19 行）、结果、报告、评审、公共 Schema、镜像、目录、清单、状态版本与 `next` 投影测试改写；场景主链需求包改 real-environment，新增 `card-05/test-contract`（D6）：接受后路由 `test-task-planning`，test 窗口握手，发明的步骤引用与第二个未终结 test 目标被拒，规划 `committed` 且窗口为 test 窗口、两步、环境成员为 landing、`next` 为 `test-delivery-planning`，prompt 含 `ts-1`，落地后 `accepted`，逐步证据导入 `recorded`，test 评审 accept 后路由 `demand-completion-preflight`，`card-08` 随后在 real-environment 闭合下完成即归档。
- 度量：公共工具 21 → 20（两制品 `tools/list` 各 20 工具 82,403 字节，原 95,265）；协调器 8 → 7（2,560 行）；`governance/testing` 3,603 → 363 行；Schema 102 → 96；架构门 690 → 669 模块（生产根 10 不变）；测试 864 → 855；tasking 切片 `decide.ts` 330 行、`service.ts` 738 行；聚合 2,840 行；评审后路由 761 行。
- 残余：`stepIds` 失败子集重跑推迟到 result-review 切片（D4）；`allowedSkills` 存在性由 L3 校验；isolated 的测试规划仍是 blocker；能力卡 5 修订表"Q4 同一 `testContract` 同时只有一个活动 Test 任务"落为"同一 Demand 同时只有一个未终结 test 目标"（缺陷代际为历史，复测为新目标）；Given/When/Then 的 `then` 字段在六处以 `biome-ignore` 豁免 `noThenProperty`；Claude 宿主真实会话未运行（按 CLAUDE.md 记为未验证）。
- 门：全量 `npm test` 通过：typecheck，架构门 669 模块 ok，Biome 0 错误（3 处旧树警告不变），格式检查通过，knip 无发现，855 测试通过，Schema 漂移检查 ok；`git diff --check` 干净。本切片未提交，等待用户决定。

### 13.87 L1 result-review 切片 7：结果导入、回调、评审投影与两类决定设计定案（2026-09-10）

6b 已提交（`ff38f1e`）。按 ADR-0013 G 顺序进入第 7 片 result-review（分析 §4 第 7 行；能力卡 7 修订；ADR-0012 D1、D4、D5）。现状核对：`src/governance/result/` 11 文件与 `src/governance/review/` 27 文件共 12,870 行（协调器 6 个 2,560 行：导入、评审检查、恢复、实现决定、测试决定、缺陷修复授权），对应测试 32 文件 6,484 行；公共工具 6 个（`import_target_result`、`inspect_target_result_review`、`resume_target_result_review`、`record_controller_implementation_review_decision`、`record_controller_test_review_decision`、`authorize_product_defect_remediation`），wire Schema 12 份；事件 `result.target-result-recorded`、`review.target-result-decided`、`review.target-result-resumed`、`review.product-defect-remediation-authorized`。实现决定词汇 `accept | blocked | redesign | rework`（phase `accepted | review-blocked | redesign-requested | rework-requested`），测试决定 `accept | request-another-attempt | escalate-product-defect | blocked`；第三次 rework 刹车已在决定器同一提交附带 `lifecycle.demand-escalated{source: rework-brake}`，升级事件数据已有 `source: review-decision{targetTaskId, targetReviewDecisionId, decisionDigest}` 变体与 `options[≤8]`；用户回答经 `continue_demand{action: record-decision}` 记 `lifecycle.decision-recorded` 并清除 `awaitingDecision`，目标 phase 不变。证据定位符 `{kind: token, ref, digest}` 只查形状与去重，从不打开文件；报告正文不做隐私扫描；回调 `wake-controller` 没有生产者（6a D4）；hook 记录种类含 `stop` 与 `turn-complete` 但尚未被结果或评审消费；受管证据记录在 Demand 根 `artifacts/managed-evidence/<evidenceId>/{manifest.json, payload/**}`；内核已有 `privacy-scan`（凭证类拒绝，路径与 typed id 按白名单）与 `redaction`。八处多选项列在末尾。

- 切片形状：`src/capabilities/result-review/{contract, decide, prompt, service}.ts`，工具 4 个：`wakeflow_import_target_result`（追加，目标侧）、`wakeflow_inspect_target_result_review`（读）、`wakeflow_record_implementation_review_decision`、`wakeflow_record_test_review_decision`（追加，Controller 侧；D8 改名）；`resume_target_result_review` 与 `authorize_product_defect_remediation` 删除（分析 §4）。记录类型留在 `governance/result`（结果与两类报告）与 `governance/review`（两类决定、缺陷修复授权、评审快照、评审后路由）；6 个协调器、输入模块与公共合同模块全部删除，公共工具 20 → 18，协调器 7 → 1。
- 导入（能力卡 7 Q1、Q2；ADR-0010）：请求形状不变 `{root, demandId, idempotencyKey, expectedStreamRevision, deliveryId, claimDigest, report}`（改为 `runAppendCommand`，同键重放）。准入新增三道：证据定位符解析（D3）、隐私扫描（内核 `scanPrivacy` 扫 `summary`、`verification`、`risks`、锚点与步骤的自由文本，命中即 `precondition-failed/privacy`，details 列规则名）、实现报告 `repositoryChange` 增加 `branch`（`null` 表示主检出；pod 切片后为 worktree 分支）。结果事件数据增加 `evidenceResolution[]{ref, digest, evidenceId, bytes}` 收据与 `callback` 段（D1）。完成证据（Stop/turn-complete）不在导入时要求（D2）。
- 回调 `wake-controller`（ADR-0012 D1；D1）：导入成功即在结果事件里记 `callback{callbackId, controllerWindowId, bindingId, bindingDigest, promptDigest, generation: 1, issuedAt}`，结果回传 `callback{permit{prompt, hostAction{effect: send-prompt-to-window, windowId, bindingId}, generation, issuedAt}}`；prompt 由 `prompt.ts` 渲染：demandId、podId（暂 `primary`）、目标任务与包摘要、`outcome` 与一句摘要、分支与提交、结果摘要与流修订、下一步工具名 `wakeflow_inspect_target_result_review`、"本回调只是传输证据"声明；不含路径与句柄。不取工作声明（Controller 窗口同时接收多目标回调）。落地由 Controller 会话在 `issuedAt` 之后、`promptDigest` 相符的 `user-prompt-submit` 记录证明，由读侧惰性派生（路由、检查投影、status）：`callback.status ∈ pending | landed | silent | acknowledged`，`silent` 为 `issuedAt` 后 10 分钟无记录（复用 `DELIVERY_LANDING_SILENCE_MILLISECONDS`），此时路由 `next.blockers` 列 `callback-silent`、建议工具 `wakeflow_rearm_delivery`；`rearm_delivery{deliveryId: callbackId}` 增加回调分支：不取声明、按当前 Controller 绑定重算目标（绑定已换即旧代际作废）、代际加一、上限 3，追加 `result.callback-reissued`；`acknowledged` = Controller 对该结果记录决定时由 Wakeflow 把落地记录写进决定事件 `callbackLanding{recordId, landedAt}`（无记录时为 `null` 并列 `callback-unlanded` 残余风险，不阻塞决定）。不要求目标 Agent 为回调调用 `record_delivery_outcome`。
- 评审检查投影 `inspect_target_result_review`（能力卡 7 §7.2）：在现有 `reviewUnit` 上增加 `callback{status, generation, landedRecordId?}`、`targetCompletion{status: confirmed | pending, recordId?, observedAt?}`（目标会话在结果 `reportedAt` 之后的 `stop | turn-complete` 记录；D2）、`allowedDecisions[]`（按 D7 规则派生，只回答"允许哪些决定"，不做判断）、test 单元的逐步表 `steps[]{stepId, given, when, expected(then), observed, evidence, verdict, failure?, baseline?{attemptOrdinal, targetTaskId, observed, evidence}}`（D6）与 `attemptScope{stepIds}`；`priorReviewHistory` 保留；blocked 或 escalated 单元附 `resumption` 所需的前决定与 `decision-recorded` 事件引用。只读，不记事件。
- 实现决定（ADR-0012 D5）：词汇 `accept | rework | blocked | escalate`，`redesign` 与 phase `redesign-requested` 删除（路由前沿 `implementation-redesign-required` 与 blocker `implementation-redesign-not-implemented` 删除）；`accept` 要求 `outcome === completed`、锚点全映射（现有）、`targetCompletion === confirmed`（D2）；`rework` 只用于验收锚点内的代码缺陷，第三次刹车不变；`blocked` 只用于外部条件，phase `review-blocked`；`escalate` 携带 `escalation{issue, requirementRefs[≤16], evidence[≤16], options[≤4]{option, impact}, recommendation}`（ADR-0012 D5 上限 4，Schema 的 8 收紧），同一提交附带 `lifecycle.demand-escalated{source: review-decision}`，目标 phase `escalated`（可被替代，能力卡 5 谱系表增加此 phase）。blocked 与 escalated 的出路（D4）：在同一结果上记录新决定，请求带 `resumption{previousDecisionId, basis: condition-cleared | decision-recorded{escalationEventId}, summary}`；escalated 要求升级已被 `decision-recorded` 回答（否则 `precondition-failed/awaiting-decision`），条件解除由 Controller 陈述；`review.target-result-resumed` 事件与 `resume` 记录删除；路由前沿 `implementation-review-resume | test-review-resume` 改为 `implementation-review-blocked | test-review-blocked`（owner controller，blocker `external-condition`），escalated 期间由 Demand 的 `awaiting-decision` 前沿（owner user）覆盖。
- 测试结果（ADR-0012 D4；能力卡 7 修订 7.1）：报告 `stepEvidence` 改为 `steps[]{stepId, observed, evidence{ref, digest}, verdict ∈ pass | fail | blocked | cannot-conclude, failure?{classification ∈ product-defect | harness-defect | environment | flaky | missing-evidence | out-of-scope | needs-decision, likelyOwner ∈ implementation | test | environment | user, recommendedAction}}`，`failure` 当且仅当 `verdict !== pass`；`expected` 不进报告，投影从合同 `then` 取；整体 `verdict` 由 Wakeflow 派生（含 fail 即 fail，否则含 blocked 即 blocked，否则含 cannot-conclude 即 cannot-conclude，否则 pass）并写进结果；`outcome` 保留为交付陈述，一致性：`completed` 要求覆盖本次尝试范围内每个 stepId 恰一次，`blocked` 要求至少一步 blocked 且无 fail。尝试范围（能力卡 5 修订"只跑失败子集"，6b D4 推迟项）：`request-another-attempt{stepIds}` 写进决定，重跑尝试 `rerunSource.stepIds` 记范围，报告只覆盖范围内步骤，范围外步骤沿用基线（D6），整体判定按并集派生。approved 基线（D6）：读侧从历史派生，不新增工件。
- 测试决定（ADR-0012 D4）：词汇 `accept | request-another-attempt{stepIds} | blocked | escalate{classification ∈ product-defect | needs-decision}`；`escalate-product-defect` 并入 `escalate`。分类到决定的机器规则（D7）：`accept` 要求整体 pass 且 `targetCompletion` confirmed；`request-another-attempt` 要求范围内每个失败步骤的分类 ∈ `harness-defect | flaky | missing-evidence` 且容量未满，同一步连续两次 `flaky` 拒绝（`flaky-repeat:<stepId>`，须 `escalate{needs-decision}`）；`blocked` 要求失败步骤分类为 `environment`（或报告整体 blocked）；`escalate{product-defect}` 要求存在 `product-defect` 步骤并携带 `remediation{affectedTargets[≤32]{targetTaskId, failedStepIds, correctionObjective}, authorizationRationale}`，同一提交附带 `review.product-defect-remediation-authorized`（授权记录由 Wakeflow 从决定与基线派生，`failedChecks` 改为失败步骤引用，`source.testTaskPackage` 不变），目标 phase `test-product-defect`、产品目标 `product-defect-rework-requested`，6b 的 retest 谱系不变；`escalate{needs-decision}` 携带 `escalation{…}` 附带 `lifecycle.demand-escalated`，phase `test-escalated`；`out-of-scope` 失败不阻塞 `escalate{needs-decision}` 但阻塞 `accept`。`authorize_product_defect_remediation` 工具、协调器、输入与 2 份 wire Schema 删除。
- 证据定位符（D3）：`kind` 收为闭集词汇表 `contracts/vocabulary/evidence-kinds`（`test-output | diff | document | transcript | commit`；slice 8 扩展 `hook-observation | link` 与 `pod-worktree` 根）；`ref` 必须是同 Demand 受管证据记录内的可移植路径 `artifacts/managed-evidence/<evidenceId>/payload/<path>` 或其 `manifest.json`，导入时读文件核 sha256（大小上限按 foundation 读取原语，超限即拒绝），缺失或不符即 `precondition-failed/evidence-unresolved`（details 列前两条 ref 的序号）；解析器表驱动，slice 8 只加根与种类。
- 事件与聚合：`result.target-result-recorded` 数据增加 `callback` 与 `evidenceResolution`；`review.target-result-decided` 数据按新决定形状（含 `resumption`、`callbackLanding`、`targetCompletion`）；`result.callback-reissued` 新增；`review.target-result-resumed` 删除；实现 phase 增 `escalated` 删 `redesign-requested`，test phase 增 `test-escalated`；无历史流需要升版（ADR-0008 新版本系，直接改 v1）。
- 删除：`governance/result` 的导入权威、输入、公共合同、协调器、服务（约 1,540 行）与 `governance/review` 的六个协调器、五个输入、五个公共合同、恢复记录与服务、缺陷修复服务（约 5,200 行），保留并改写记录与投影模块；测试 32 文件改为切片 `decide.test.ts`、`service.test.ts` 与记录测试。目标：result 加 review 12,870 → 约 6,000 行；测试 6,484 → 约 3,500 行；公共工具 18；协调器 1；wire Schema 12 → 8；`tools/list` 82,403 → 约 75,000 字节。
- 验收：`decide.test.ts`（整体 verdict 派生、失败分类与决定准入、连续 flaky、accept 前提、resumption 基础、回调状态派生、定位符解析规则、隐私拒绝）；`service.test.ts`（导入：定位符缺失与摘要不符被拒、隐私命中被拒、成功导入返回回调许可且重放同许可、回调静默与 reissue 上限；检查：allowedDecisions 与逐步基线；实现决定：accept 缺完成证据被拒、rework 计数与刹车、blocked 后带 resumption 再决定、escalate 附升级并在 decision-recorded 后再决定；测试决定：request-another-attempt 子集与容量、escalate product-defect 一次提交两事件、needs-decision 升级）；场景：主链 `card-08` 前的导入改为先经 `record_managed_evidence` 记录证据再引用，新增 `card-07/import-and-review`（定位符核摘要、隐私拒绝、回调许可与 Controller 落地、检查投影的 allowedDecisions 与 acknowledged、escalate 与 decision-recorded 回流后 accept）与 `card-06/wake-controller`（静默 → reissue → 落地）。
- 裁决（待用户确认）：
  - D1 回调机制。建议回调记录进结果事件、许可随导入返回、落地由读侧从 Controller 会话记录派生、`rearm_delivery` 重发、决定事件记 acknowledged，不取声明、不要求结局调用；备选把回调建成带声明与结局调用的完整投递信封。
  - D2 完成证据时机。建议在评审读取与决定时核对目标会话的 Stop/turn-complete 记录，`accept` 必须具备；备选在导入时要求（目标 Agent 在同一轮里自导入时该记录尚不存在，只能改为两轮协议）。
  - D3 证据定位符解析范围。建议本片只解析同 Demand 受管证据记录内的路径并核摘要，kind 收为闭集词汇表，slice 8 扩根与种类；备选本片沿用形状检查，解析整体推迟到 slice 8。
  - D4 blocked 与 escalated 的出路。建议在同一结果上记录带 `resumption` 的新决定，删除 resume 工具与事件；备选保留 resume 作为隐式第二事件由决定命令附带。
  - D5 测试 escalate 与缺陷修复授权合并。建议 `escalate{product-defect}` 一次调用同一提交附带授权事件，删除授权工具；备选保留独立授权调用。
  - D6 approved 基线来源。建议读侧从同目标尝试链与 retest 链（`then` 文本相同的步骤）派生，不新增工件；备选在 Demand 根写 `approved-baselines` 不可变记录。
  - D7 分类到决定的机器规则。建议按分析 §4 路由表落成决定准入并在检查投影给出 `allowedDecisions`；备选只记录分类，不限制决定。
  - D8 决定工具改名。建议按分析 §4 改为 `wakeflow_record_implementation_review_decision` 与 `wakeflow_record_test_review_decision`；备选保留 `record_controller_*`。
  - 裁决（2026-09-10，用户确认『确认 继续』，八项均按建议）。

### 13.88 L1 result-review 切片 7：结果导入、回调、评审投影与两类决定实现与验收（2026-09-10）

按 13.87 八项裁决落地切片 7，单代理实现：结果导入、wake-controller 回调、评审检查投影与两类决定收进 `src/capabilities/result-review/{contract, decide, prompt, service}.ts`，旧导入与评审的六个协调器、恢复与授权工具删除。

- 合同与记录：`controller-review-decision-contract` 的升级、resumption、回调落地与完成证据词汇改为共享解析器，测试升级线形状 `{classification, remediation?, userDecision?}`（D5、D7）；`controller-product-defect-remediation-authorization` 重写为从决定派生：`failedSteps[]{stepId, observed}`、`affectedTargets[]{baseline, failedStepIds, correctionObjective}`、`source` 去掉 `postAcceptanceRouteDigest`，关系检查改为 `routeSource.streamRevision = reviewed + 1`、快照摘要相等、失败步骤映射覆盖且不越界；新增 `governance/result/target-result-callback.ts`（代际上限 4、静默 10 分钟、回调记录 `{callbackId, controllerWindowId, bindingId, bindingDigest, portablePrompt, promptDigest, generation, issuedAt}`、重发记录、证据解析收据与 `deriveTargetResultCallbackStatus`，D1）；测试报告 `steps[]{stepId, observed, evidence, verdict, failure?}` 与派生整体 `verdict`（`verdict` 不进公开导入请求）；实现报告 `repositoryChange.branch`；证据定位符 `kind` 闭集词汇表 `contracts/vocabulary/evidence-locator-kinds`（D3）。事件：`result.target-result-recorded{result, callback, evidenceResolution}`，新增 `result.callback-reissued`，`review.target-result-resumed` 删除；提交边界不再从声明或决定派生 commitId（ADR-0013 决定 C），决定仍绑定审查时的流位置。聚合：结果摘要带 `callback`，实现 phase 增 `escalated` 删 `redesign-requested`，test phase 增 `test-escalated`，`reissueCallbackInDemandAggregateState`（只在结果已回报阶段、代际加一、prompt 摘要不变）、`assertResumptionAdmitted`（condition-cleared ⇔ 前决定 blocked，decision-recorded ⇔ 前决定 escalate 且升级已回答）、`productDefectRemediation.failedStepIds`；决定器命令 `result.record-target-result{result, callback, evidenceResolution}`、`result.reissue-callback`、`review.decide-target-result{decision, authorization?}`（product-defect 升级当且仅当携带授权），`decideReview` 在决定事件之后按序附带授权事件、评审升级（`lifecycle.demand-escalated{source: review-decision}`）或第三次 rework 刹车；仓储审计核对回调代际链、resumption 链（同目标同结果、只续一次、依据与前决定一致）、升级 phase ⇔ 分类、授权的失败步骤与 `remediation.affectedTargets`。评审快照历史条目 `{sourceEvent, decision}`；评审后路由阶段 `test-review-escalated`；Controller 路由前沿 `implementation-review-blocked | test-review-blocked`（owner controller，blocker `external-condition`），escalated 由 `awaiting-decision`（前沿 `decision-required`，owner user）覆盖，resume 与 redesign 前沿删除；`next` 投影表同步。delivery 切片改接：重跑尝试从决定记录读 `stepIds`，缺陷修复上下文 `requiredCorrections[]{stepId, observedSummary}` 进 prompt；`rearm_delivery` 增回调分支（不取声明、按当前 Controller 绑定重算目标、`callback-<status>` 与 `callback-limit:<n>` 阻塞、`rearm.kind: callback`、`permit.fence: null`、`delivery.workType: callback`、`envelopeDigest = resultDigest`）。Schema 96 → 91（删 12 份导入与评审 wire 加 3 份记录，增两类决定请求与结果、`callback-reissued-event-data-v1`、两份词汇表）。
- 切片：`contract.ts` 237 行（四个工具登记，描述 595 / 453 / 496 / 544 字节）；`decide.ts` 590 行（`planEvidenceLocator` 表驱动、`collectEvidenceReferences`、`derivePrivacyRules`、`deriveTargetCompletion`、`deriveCallbackLanding`、`deriveResumptionBlockers`、两类 `allowedDecisions` 与决定阻塞项、`deriveStepViews` 与 `deriveUnionVerdict`，D2 D3 D6 D7）；`prompt.ts` 157 行（en / zh-Hans 回调 prompt：身份、结果摘要、`wakeflow_inspect_target_result_review`、"本回调只是传输证据"，上限 20,000 字符）；`service.ts` 1,902 行（导入：阶段、宿主与围栏检查 → 隐私扫描 → 定位符解析并读受管证据核摘要 → 结果与回调记录 → 追加 → 释放声明，同键重放核请求摘要；检查投影：`reviewUnit{status, callback, targetCompletion, allowedDecisions, currentDecision, resumptionBasis, testSteps, attemptScope}`，升级未回答时 `allowedDecisions` 为空；两类决定：快照与评审单元摘要过期即拒，resumption 阻塞项，分类路由阻塞项，product-defect 在同一提交附带授权，授权身份从决定派生）。入口：目录 20 → 18 工具，两宿主组合根绑定四个执行器，`record_controller_*`、`resume_target_result_review`、`authorize_product_defect_remediation` 删除（D8）。
- 删除：`src` 45 文件（导入权威、输入、公共合同、协调器与服务；六个评审协调器、输入、公共合同、恢复记录与服务、缺陷修复服务、决定服务与事件 owner；12 份 wire Schema 及生成物）、`tests` 18 文件，另删无引用的 `tests/capabilities/demand/route.fixture.ts`；`governance/result` 加 `governance/review` 12,870 → 5,911 行，其测试 6,484 → 4,420 行（含新切片测试）；已跟踪文件 12,779 行新增、18,617 行删除，另有 8,454 行新文件。
- 验收：`tests/capabilities/result-review/decide.test.ts` 6 项（定位符解析、隐私规则、完成证据与回调落地及状态、实现允许集合与 resumption 阻塞、逐步视图与基线、测试分类路由）；`service.test.ts` 6 项（导入重放与二次导入、回调 pending → 三次静默重发 → `callback-limit`；落地后 `callback-landed`、`snapshot-stale` 与 `review-unit-stale`、blocked 后三种错误 resumption 与 condition-cleared 再决定并重放；rework 后再投递与再导入保留历史、第二结果的完成证据独立、escalate 附升级且未回答时 `awaiting-decision`；测试全通过只允许 accept 与 escalate、needs-decision 升级、`record-decision` 后带 resumption 的 accept；flaky 子集重跑 `rerunSource.stepIds`、范围外步骤基线、容量与范围阻塞；product-defect 一次提交两事件、实现目标 `product-defect-rework-requested` 与 `failedStepIds`）；记录测试、决定器、聚合、升版、快照、路由、矩阵（19 → 17 行）、目录、镜像、生命周期与规划测试改写；场景新增 `card-07/import-and-review`、`card-06/wake-controller`、`card-07/escalate-and-resume`，`card-05/test-contract` 改为受管证据逐步记录、Stop 记录与改名后的测试决定，14 场景全部 pass；夹具：Controller 窗口登记、受管证据登记、再投递的落地时刻与尝试序号幂等键、请求线格式的判断字段。
- 验收中修正的实现：检查投影在升级未被回答时把 `allowedDecisions` 置空（原只按分类路由派生，与决定命令的 `awaiting-decision` 拒绝不一致）；缺陷修复授权的 UUID 改为从决定派生（原与决定共用同一 uuid 工厂，确定性工厂下两事件同 id 被提交边界拒绝）；`rearm_delivery` 结果 `permit.fence` 可空、`delivery.workType` 增 `callback`（与 prepare 的 wire 有意分叉，镜像测试改为逐字段对照）。
- 度量：公共工具 20 → 18（`tools/list` 82,403 → 83,149 字节，高于 13.87 估计的 75,000：两类决定请求把升级、修复映射与 resumption 内联，`record_test_review_decision` 8,591、`import_target_result` 8,532、`record_implementation_review_decision` 7,031 字节）；协调器 7 → 1；Schema 96 → 91；架构门 669 → 630 模块（生产根 10 不变）；测试 855 → 839（文件 203）；`governance/result` 加 `review` 5,911 行；切片 2,886 行。
- 残余：`service.ts` 1,902 行，导入、投影与决定三段可再拆；`podId` 固定 `primary` 直到 pod 切片；回调静默重发不进场景（需注入时钟），由切片服务测试覆盖；`tools/list` 预算在 L1 收敛后复测；Biome 3 处旧树警告不变（两处 `__proto__` 断言与 `rooted-exclusive-file-lock` 的未用 catch 绑定）；Claude 宿主真实会话未运行（按 CLAUDE.md 记为未验证）。
- 门：全量 `npm test` 通过：typecheck，架构门 630 模块 ok，Biome 0 错误（3 处旧树警告），格式检查通过，knip 无发现，839 测试通过，Schema 漂移检查 ok；`git diff --check` 干净。本切片未提交，等待用户决定。

### 13.89 L1 evidence 切片 8：受管证据的来源、种类、隐私与效果型外壳设计定案（2026-09-10）

切片 7 已提交（`b899182`）。按 ADR-0013 G 顺序进入第 8 片 evidence（分析 §4 第 8 行"三种来源加 `pod-worktree` 与 `observation`、kind 闭集、隐私收窄"；能力卡 8 §8.1，Q1 到 Q3 已于 2026-09-04 裁决；ADR-0010）。现状核对：`src/governance/evidence/` 21 文件 9,287 行（捕获规划 743、发布事务 482 加 journal store 529 加结算 544、应用服务 852、stage 与 payload 物化 652 加 525、记录发布 486、清单 546、记录集合清单 637、读取器 725 加读取服务 457、公共协调器 452、规划服务 223、公共合同 96 等），对应测试 16 文件 4,268 行；公共工具 1 个 `wakeflow_record_evidence`（效果型 preview / apply / recover，登记内联在目录里，是目录中最后一个未进切片的工具）；wire Schema 2 份，记录 Schema 2 份（Manifest、发布事务）；事件 `evidence.managed-evidence-recorded{manifest}`，聚合摘要 `managedEvidence[]{evidenceId, manifestDigest, payloadArtifactDigest}`。来源只有 `repository | support-surface` 逻辑根下的 `file | tree` 字节复制；`evidenceType` 是自由 token；`sensitivity ∈ internal | public` 只校验不改变行为（能力卡 8 疑点 4）；`opaqueContentPolicy` 只管含控制字符的字节；文本负载不做任何隐私扫描，协调器只查请求与结果 JSON 里是否出现工作区根路径；preview 把完整发布事务（含整棵 tree manifest）回显给调用方，apply 要求原样回传 `plan` 加 `planDigest`（请求上限 4 MiB），与内核 `PublicationTransaction`"apply 从不信任客户端回显的计划"的形状相反；Evidence、Event、Commit 身份由 uuid 工厂随机分配，同一内容再记一次得到第二份记录；recover 以 `demandId` 定位 Demand 根内唯一的 journal，三种结局 completed / retired-stale / healthy。发布机制（journal → stage → Event → final rename → journal retire，Event 前可退休、Event 后只前向完成）由 L0 建成且被 result-review（`loadManagedEvidenceRecord`、`readManagedEvidencePayloadMember`）与归档根清单消费，保留不重写。内核 `privacy-scan` 已被需求包、结果导入与归档负载消费，词汇一套。`pods[]` 配置尚不存在（pod 切片）。裁决列在末尾。

- 切片形状（D1）：`src/capabilities/evidence/{contract, decide, service}.ts`，工具仍为 `wakeflow_record_evidence`，改走内核 `runPublicationTransaction`：preview `{root, mode, demandId, selection}` 零写返回 `{status: ready | blocked, blockers[], planDigest, plan}`（`plan` 是摘要投影：evidenceId、kind、source、payload 摘要与成员数、contentReview，不再回显整棵 tree manifest）；apply `{root, mode, demandId, selection, planDigest}` 在当前工作区状态上重算计划，摘要不同即 `precondition-failed/plan-drift`，相同才执行；recover `{root, mode, demandId}`（`operationId` 即 demandId，Demand 根内唯一 journal）。计划摘要只覆盖与时间无关的内容：demandId、kind、source、payload artifact digest 与 tree manifest、contentReview、configDigest、demandAuthorityDigest；`capturedAt` 在 apply 时取钟，CAS 预期修订在 apply 时取当前聚合（preview 与 apply 之间的其他事件不再让计划失效，源字节变化才是漂移）。身份改为派生：`evidenceId = deriveDurableId("evidence", "managed-evidence", demandId, sourceKey, payloadArtifactDigest)`，Event 与 Commit 身份由 evidenceId 派生；同一内容再次 apply 得到 `already-recorded`（记录与事件都已存在且清单相等），不同字节得到另一份记录。结果：apply `{disposition: recorded | already-recorded, publication{evidenceId, kind, manifestDigest, payloadArtifactDigest, event, commit, stateDigest}, next}`；recover `{disposition: recovered | retired | healthy, …}`；`next` 按当前 Controller 路由投影。删除公共协调器、公共合同与规划服务（身份分配并入切片，捕获规划、发布事务、journal store、结算、物化、发布、清单、读取器保留为治理记录机制）；wire Schema 改名 `wakeflow-record-evidence-{request, result}`；协调器 1 → 0。
- 来源与种类（D2，能力卡 8 Q2 Q3）：`selection{kind, source, contentReview}`。`kind` 闭集词汇表 `contracts/vocabulary/evidence-kinds`（`hook-observation | transcript | test-output | diff | document | link | commit`）取代自由 `evidenceType`，与结果定位符共用同一张表（`evidence-locator-kinds` 并入）。来源四种：`managed-path{root: repository | support-surface, path, resourceType: file | tree}`（现有，复制字节）；`observation{hostId, recordId}`（宿主 hook 观察记录，Wakeflow 读 `.wakeflow-local` 里的记录、算记录摘要，Manifest 只写脱敏投影 `{event, recordedAt, turnId, promptDigest, lastAssistantMessageDigest, transcript: present | absent, recordDigest}`，`sessionId` 与 `cwd` 永不进入，不复制负载）；`link{url}`（只接受 https，可选调用方摘要，定位符不取内容）；`commit{repositoryId, commitOid}`（仓库须在配置里，foundation 无进程端口，不核对对象存在，定位符不取内容）。kind 与来源的关系：`hook-observation` ⇔ observation；`transcript` ⇔ observation 且 `transcript: present`（Q3：按定位符加记录摘要引用）；`link` ⇔ link；`commit` ⇔ commit；`test-output | diff | document` ⇔ managed-path。引用类来源的记录树与复制类相同（`manifest.json` 加空 `payload/`，空树摘要），清单、读取器、发布与归档根清单不需要分支。`pod-worktree` 根随 pod 切片一起进表（`pods[]` 尚不存在，解析器表驱动只加根）。
- 隐私与内容审阅（D3，能力卡 8 Q1）：managed-path 来源的文本成员在 preview 与 apply 都经内核 `scanPrivacy` 扫描，策略 `allowedPathRoots` 为工作区根、ledger 根与配置的全部仓库与支撑面真实路径，`allowedIdPrefixes` 为 typed id 前缀；凭证类命中（`private-key | provider-credential | credential-assignment`）永远阻塞 `privacy:<kind>:<ref>:<line>`；`unlisted-absolute-path` 与 `bare-uuid` 命中和含控制字符的 opaque 成员一样，只在 `contentReview: controller-confirmed` 下通过，否则阻塞（`opaque-content:<ref>`、`privacy:<kind>:<ref>:<line>`，至多列 16 条）。Manifest `contentReview{disposition: not-required | controller-confirmed, opaqueFileRefs[], privacyFindings[]{ref, line, kind}}` 记下 Controller 确认过的内容，归档时同一引擎只再查凭证类（现状不变），三处一套引擎一套词汇。`sensitivity` 从选择与 Manifest 删除；`opaqueContentPolicy` 并入 `contentReview`；无 `privacyScan`、`findings`、`blockers` 恒空槽位。
- 事件、聚合与消费者：事件类型不变，Manifest v1 直接改（kind、source 四变体、contentReview、去 sensitivity，ADR-0008 新版本系）；聚合摘要 `managedEvidence[]` 增加 `kind`；结果导入的定位符解析（切片 7 D3 表驱动）增加一致性：定位符 `kind` 必须等于所引记录的 `kind`，引用类记录只能以 `manifest.json` 被引用（D5）；`payload/<member>` 只对复制类记录有效。
- 归档与清理边界（D4）：8.2 的 Q4、Q5 已在 demand 切片落地（活动根删除；verify 门 `work-claims-released`），本片不改归档内容；8.4 清理与 `prune_runtime` 按能力映射第 30 行并入 pod 关闭与维护对账，随 pod 切片；8.3 保留按 Q6 不实现。
- 场景（D6）：新增 `card-08/evidence`，排在 `card-06/ambiguous-resolution` 之后、`card-07/import-and-review` 之前，Controller 在同一次性工作区上：记录产品仓库文件（后续 card-07 引用它，card-07 不再自己登记）、支撑面目录树、产品会话的 `user-prompt-submit` 记录（observation，结果不含句柄与路径）、一条 https 链接与一个提交引用；含 `token = …` 的文本被拒并列出规则与行号；含控制字符的成员在 `reject` 下阻塞、`controller-confirmed` 下通过且 Manifest 记下引用；preview 零写；同一内容再次 apply 为 `already-recorded`；源字节变化后 apply 为 `plan-drift`；recover 为 `healthy`；结果不含私有路径。
- 验收：`tests/capabilities/evidence/decide.test.ts`（kind 与来源关系、身份派生、计划摘要不含时间、隐私阻塞分类与确认覆盖、observation 投影脱敏、`link` 只接受 https）；`service.test.ts`（四种来源各一份记录并可被读取服务读回；同内容重放 `already-recorded`；源漂移 `plan-drift`；凭证阻塞不可确认；journal 中断后 recover 前向完成与 Event 前退休沿用应用服务测试）；结果导入测试增加 kind 不一致与引用类记录的 `payload/` 引用被拒；`managed-evidence-public-coordinator.test.ts` 删除，机制测试按 Manifest 改写；场景 `card-08/evidence` 接线，`card-07` 改为消费它登记的证据。
- 目标度量：公共工具 18 不变（目录内联登记 0）；协调器 1 → 0；`governance/evidence` 9,287 → 约 8,600 行；wire Schema 91 → 91（两份改名重写）；`tools/list` 约 83,000 字节；场景 14 → 15。
- 裁决（待用户确认）：
  - D1 效果型外壳与身份。建议改走内核 `PublicationTransaction`：apply 重算计划、摘要只覆盖内容、Evidence/Event/Commit 身份从内容派生、同内容 `already-recorded`；备选保留现状（preview 回显整份事务，apply 原样回传，随机身份，同内容重复记录）只换公共面。
  - D2 引用类来源。建议本片补齐 `observation`、`link`、`commit` 三种引用类来源并让 kind 与来源绑定；备选只加 `observation`，`link` 与 `commit` 推迟到观察切片。
  - D3 文本负载隐私策略。建议白名单根（工作区、ledger、配置根）加 `controller-confirmed` 覆盖非凭证类命中，凭证类永不可确认；备选与归档相同只拒凭证类，不报路径与 UUID。
  - D4 清理归属。建议 8.4 清理随 pod 切片（pod 关闭加维护对账），本片不做；备选本片先做"归档后传输残留"的单步清理。
  - D5 定位符一致性。建议结果导入核对定位符 kind 与记录 kind 相等且引用类记录只能引用 Manifest；备选沿用切片 7 只核路径与摘要。
  - D6 `card-08/evidence` 的位置。建议放在 card-07 之前并让 card-07 消费它登记的证据；备选放在 card-08 归档之前独立登记，card-07 保持自己登记。

### 13.90 L1 evidence 切片 8：受管证据实现与验收（2026-09-10）

按 13.89 六项裁决落地切片 8，单代理实现：`wakeflow_record_evidence` 改走内核 `PublicationTransaction`，四种来源与闭集种类，隐私白名单与内容审阅，公共协调器删除。

- 合同：词汇表 `contracts/vocabulary/evidence-kinds`（`hook-observation | transcript | test-output | diff | document | link | commit`）取代 `evidence-locator-kinds`，两类报告与三份结果 wire Schema 的定位符种类枚举同步扩为七种；Manifest v1 直接改：`kind`、`source` 四变体（`managed-path{root, path, resourceType}`、`observation{hostId, recordId, event, recordedAt, turnId, promptDigest, lastAssistantMessageDigest, transcript, recordDigest}`、`link{url, digest}`、`commit{repositoryId, commitOid}`）、`contentReview{disposition, opaqueFileRefs, privacyFindings[≤64]{ref, line, kind ∈ unlisted-absolute-path | bare-uuid}}`，`sensitivity` 删除，目录树之外的来源都规范化为单一 `content` 成员；聚合摘要 `managedEvidence[].kind`；wire Schema 改名 `wakeflow-record-evidence-{request, result}`：请求 `{root, mode: preview | apply, demandId, selection{kind, source, contentReview: reject | controller-confirmed}, planDigest?}` 与 `{root, mode: recover, demandId}`，结果 `WakeflowRecordEvidencePreview{status, blockers, planDigest, plan{evidenceId, kind, source, payload{artifactDigest, fileCount, totalBytes}, contentReview{disposition, opaqueFileCount, privacyFindingCount}, recorded}, next}` 与 `WakeflowRecordEvidenceMutation{mode: apply | recover, disposition: recorded | already-recorded | recovered | retired | healthy, publication{evidenceId, kind, manifestDigest, payloadArtifactDigest, event, stateDigest} | null, next}`。Schema 91 不变（两份改名重写）。
- 治理机制：`managed-evidence-source-selection` 重写为选择解析（四种来源、种类与来源绑定表、`https` 校验、来源键）加 Manifest 来源投影解析；新增 `managed-evidence-source-projection`（引用类来源的 `payload/content` 是确定性投影文档，stage 物化与恢复由 Manifest 重建，不再读外部来源）；捕获规划返回 `ready{plan, review, existing} | blocked{blockers, review}`：managed-path 文本成员经内核 `scanPrivacy`（白名单：工作区根、ledger 根、配置根真实路径），凭证类命中永远阻塞 `privacy:<kind>:<ref>:<line>`，opaque 与非凭证类命中在 `reject` 下阻塞、确认后进入 Manifest；observation 读本工作区 hook 记录（内核新增 `readHostHookObservationRecord`）只保留脱敏投影，`transcript` 种类要求记录带 transcript；link 只扫 URL；commit 只核仓库在配置内；Evidence 身份 `deriveDurableId("evidence", "managed-evidence", demandId, 来源键, artifactDigest)`；阻塞时不读钟。应用服务、stage 与 payload 物化接受 `null` 来源根并为引用类来源写投影字节；配置根解析只接受 managed-path。删除：公共协调器（452 行）、公共合同（96）、规划服务（223）；21 文件 9,287 → 19 文件 9,112 行。
- 切片 `src/capabilities/evidence/{contract 81, decide 120, service 513}`：`runPublicationTransaction`，apply 重算计划并按内容摘要（不含 `capturedAt` 与 CAS 预期）比对，Event 与 Commit 身份从 Evidence 身份派生，`existing` 命中即 `already-recorded`（回放聚合摘要与派生 Commit 的收据，不写任何东西）；recover 映射 completed / retired-stale / healthy；`next` 来自当前 Controller 路由；私有值含 ledger 根与配置根；规划错误经固定表映射为 `invalid-request/selection`、`precondition-failed/{config-authority, demand-authority, source-root, source-missing, source-type, source-changed, capacity, kind}`。目录登记从切片导入，executor 改名 `recordEvidence`；协调器 1 → 0。
- 结果导入（D5）：定位符 `kind` 随引用进入解析，与所引记录的 `kind` 不一致即 `precondition-failed/evidence-kind-mismatch`（details `blocker: evidence-kind-mismatch:<序号>`）；引用类记录的 `payload/content` 是投影文本，可被引用，13.89 D5"只能引用 Manifest"一句按此收窄。
- 内核：`hook-observations` 导出 `HOST_HOOK_EVENTS` 与 `readHostHookObservationRecord`（按记录标识读一条记录并返回字节摘要）。附带修正：`result-review/decide.ts` 去重键里的原始 NUL 字节改为 `\u0000` 转义（此前文件被 `file` 判为二进制，grep 失效）。
- 验收：`tests/capabilities/evidence/decide.test.ts` 5 项（计划摘要不含时间、身份派生、投影与 next、内容阻塞项、来源键）；`service.test.ts` 3 项（preview 零写与 apply、already-recorded、plan-drift、recover healthy；opaque 与凭证阻塞及确认、apply 阻塞计划 `plan-blocked`；observation / link / commit 记录与读回、transcript 种类拒绝、非 https 拒绝）；捕获规划测试重写 5 项（含白名单路径与观察投影脱敏）；来源选择测试重写 5 项；Manifest 测试增 1 项；机制测试（应用服务、读取、清单、树计划、stage、事件溯源、夹具）按新 Manifest 改写；公共协调器测试与 MCP 证据测试删除；目录、制品与生命周期测试改名或改接切片；场景新增 `card-08/evidence`（D6，排在 card-07 之前，card-07 消费其登记的证据并增加种类不一致被拒），场景 14 → 15 全部通过。
- 度量：公共工具 18；协调器 0；`governance/evidence` 9,287 → 9,112 行，切片 714 行；对应测试 4,268 → 4,707 行；wire Schema 91；`tools/list` 83,149 → 85,016 字节；变更 64 文件 +2,304/−2,646 加新增 2,310 行，删除 10 文件。
- 残余：`pod-worktree` 根随 pod 切片进表（`pods[]` 尚不存在）；8.4 清理随 pod 切片；`link` 的调用方摘要不核对，`commit` 不核对对象存在（foundation 无进程端口）；观察记录以裸 UUID 为标识，引用投影因此不做 UUID 扫描，只扫链接 URL；Claude 宿主真实会话未运行（按 CLAUDE.md 记为未验证）。
- 门：全量 `npm test` 通过：typecheck，架构门 631 模块 ok（生产根 10 不变），Biome 0 错误（3 处旧树警告不变），格式检查通过，knip 无发现，844 测试通过（839 → 844），Schema 漂移检查 ok（91）；`git diff --check` 干净。本切片未提交，等待用户决定。

### 13.91 L1 pod 切片 9：pod 记录、pod 作用域窗口、worktree 回执与关闭顺序设计定案（2026-09-10）

切片 8 已落地（13.90，未提交）。按 ADR-0013 G 顺序进入第 9 片 pod（分析 §4 第 9 行"创建 preview 与 apply、两阶段 ready、关闭含清理、worktree 回执"；ADR-0010 D1 到 D7；能力卡 1 Q11 Q12、卡 2 基数规则、卡 6 投递目标、卡 7 `branch`、卡 8 Q7、卡 9 Q6）。现状核对：`wakeflow.config.json` 没有 `pods[]`，`topology.windows` 是唯一的窗口声明，codec 只校验"controller、design、test 各恰好一个，每仓库至少一个 product"一次；配置替换走 `replaceWakeflowConfigAuthority`（短锁、CAS 到快照的 `configDigest` 与源节点、回读核对），reconfigure 对 topology、storage、hosts 任何差异报 `reconfigure-layout-change-unsupported`；`configDigest` 只在 preview 到 apply 之间复验（`assertDemandOperationConfigCurrent` 报 `stale-config`），不冻结进 Demand 权威，所以配置增删 pod 不会让活动 Demand 失效。Demand 身份仍有 `executionPlacement{mode: main | isolated, authorizationRef}`，创建只写 `main` 并对非 main 报 `placement:<mode>`；`assertNoActiveDemand` 按 ADR-0011 D7 全局只允许一个活动 Demand；Route 对 isolated 的测试规划报 `isolated-test-planning-not-implemented`。投递与回调把 pod 写死为 `primary`（`delivery/service.ts`、`result-review/service.ts` 的 `CALLBACK_POD_ID`）；任务包 `assignment{repositoryId, windowId}` 用 `windowById`、测试任务用 `indexes.testWindow`、回调用 `indexes.controllerWindow`，都是全局唯一而非 pod 作用域；归档清单 `worktree` 恒 `null`；证据来源根只有 `repository | support-surface`；宿主资源 profile 的 `podEvidence` 表面在 `hosts/<host>/evidence/pods` 声明一个没有写入者的目录；窗口绑定与启动意图没有 `podId`，`register` 的 hook 证据按窗口配置根匹配 `session-start` 的 cwd，没有 worktree 回执；结果报告 `repositoryChange.branch` 允许 `null`；foundation 只有 `git check-ignore` 一个 spawn 端口，没有 worktree 观察。旧 JS 的 `wakeflow-pod-records`（938 行，11 段状态机、四类记录）与两宿主 pod host 模块不移植（ADR-0010 D6）。裁决列在末尾。

- 记录与窗口（D1、D2）：配置增加 `pods[]`，每项 `{podId, name, placement: primary | worktree, lifecycle: open | closing, createdAt, worktrees[]{repositoryId, windowId, suggestedName}, closing: {requestedAt, branches[]{repositoryId, branch | null, disposition: merged | abandoned}} | null}`；`podId` 是新的持久标识类别 `pod`，`name` 为 `^[a-z][a-z0-9-]{0,31}$` 且在存活 pod 内唯一，main 由 fresh-initialize 生成为 `{name: main, placement: primary}`。窗口仍全部列在 `topology.windows`，每个窗口增加必填 `podId`；基数规则改为按 pod 分组校验：每个 pod 的 controller、design、test 各恰好一个，primary 的每仓库至少一个 product（能力映射 D11 保留），worktree pod 的每仓库恰好一个 product（ADR-0010 D2）。pod 窗口的身份从 pod 派生：`windowId = deriveDurableId("window", "pod-window", podId, role, rootId)`，显示名 `<name> · <主窗口显示名>`（能力卡 9 Q6 的标签形式，main 不加前缀）。配置索引增加 `podById`、`podIdByWindowId`、每 pod 的 `controllerWindow / designWindow / testWindow / productWindows / windowsByRepositoryId`，原来的全局四个角色索引改为 primary pod 的别名；tasking、result-review、delivery 的窗口解析全部改为按 Demand 的 pod 取。reconfigure 增加阻塞 `reconfigure-pods-change-unsupported`，pods 只能由 `wakeflow_pod` 改；reconcile 沿用当前模型。状态不落盘：`creating | ready | closing | closed` 由 `lifecycle` 加回执派生（open 且全部窗口已绑定、产品窗口 worktree 回执有效即 ready，否则 creating；closing 且全部窗口已退役、worktree 已处置即可 closed）。
- 工具外壳（D3）：`wakeflow_pod`，效果型，走内核 `runPublicationTransaction`。请求 `{root, mode: preview | apply, intent, planDigest?}`，`intent` 为 `{kind: create, name, idempotencyKey}` 或 `{kind: close, podId, branches[]{repositoryId, disposition: merged | abandoned}}`；`{root, mode: recover, podId}`。ADR-0010 D6 的 `close` 成为 `intent.kind: close`，与 create 共用零写 preview 与计划摘要 CAS。create 计划：`podId = deriveDurableId("pod", "create-pod", programId, idempotencyKey)`，窗口集与 worktree 意图按 D2 派生，阻塞 `name-taken`、`name-reserved:main`、`repository-unavailable:<id>`；apply 是一次配置事务（在快照的 `configDigest` 上 CAS 追加 pod 与窗口），同键重放为 `already-created`，不写别的东西。close 计划两段：pod 为 primary 报 `pod-primary`；第一段（open → closing）要求该 pod 没有活动 Demand（`demand-active:<demandId>`）、每个已登记 worktree 都在请求里有分支处置（`branch-disposition-missing:<repositoryId>`、`branch-disposition-unknown:<repositoryId>`），apply 把 `lifecycle` 改为 closing 并记下处置；第二段（closing → closed）要求全部窗口绑定已退役（`window-bound:<windowId>`）、每个 worktree 的检出目录已不存在（`worktree-present:<repositoryId>`），apply 从配置删除 pod 与其窗口并删除该 pod 的回执目录；`next` 在第一段之后指向 `wakeflow_register_window_binding decommission`，检出仍在时指向宿主处置。recover 只做回执对账：重算状态，退休与文件系统或绑定登记表不一致的回执文件，或清除已不在配置中的 pod 的孤儿回执目录，结局 `healthy | retired`。调用方身份不在线上（与其他工具一致），"只有 main 的 Controller 调用"是 skills 文本规则，pod 的 Controller 启动意图里写明不开启 pod。结果 `WakeflowPodPreview{status, blockers, planDigest, plan{kind, pod{podId, name, placement, state}, windows[]{windowId, role, displayTitle}, worktrees[]{repositoryId, windowId, suggestedName}}, next}` 与 `WakeflowPodMutation{mode, disposition: created | already-created | closing | closed | healthy | retired, pod{podId, name, state} | null, next}`，不含路径与句柄。
- 就绪与回执（D4）：pod 窗口的握手仍走 `wakeflow_register_window_binding`；controller、design、test 窗口的 `session-start` cwd 按主根与支撑面匹配，不变。worktree pod 的产品窗口 `register` 与 `replace` 的 `observation` 必填 `worktree{porcelain, commonDir}`，即 Agent 在会话 cwd 里运行 `git worktree list --porcelain` 与 `git rev-parse --git-common-dir` 的原文（缺失报 `invalid-request/worktree-receipt-required`）。Wakeflow 解析 porcelain（`worktree`、`HEAD`、`branch | detached`、`locked`、`prunable`、`bare` 行），取 path 的 realpath 等于该会话 `session-start` cwd 的那一条（会话与 worktree 由此绑定），校验：path 不是配置仓库根；`commonDir` 的 realpath 等于配置仓库根下 `.git`；`<path>/.git` 是内容为 `gitdir: <admin>` 的文件且 `<admin>` 在 `<common>/worktrees/` 下、`<admin>/gitdir` 指回 `<path>/.git`、`<admin>/HEAD` 与回执的 HEAD 或分支一致（`precondition-failed/worktree-receipt:<原因>`）。不 spawn git。回执写 `.wakeflow-local/runtime/hosts/<host>/pods/<podId>/worktrees/<repositoryId>.json`（0700/0600，字段 podId、windowId、repositoryId、bindingId、path、head、branch | null、locked、observedAt、receiptDigest），与绑定同一互斥门内写入，replace 换代，decommission 保留到 pod 关闭；结果只回 `worktree{head, branch, detached}`。资源 profile 的 `podEvidence` 改为 `podReceipts`（目录 `pods/`），旧 `evidence/pods` 声明删除。启动意图增加 `podId`，worktree pod 的产品窗口意图带 `worktree{repositoryId, suggestedName: wakeflow-<name>, basePolicy: local-head}`，Test 窗口意图带 `attachedWorktrees[]{repositoryId}`；`inspect` 的执行说明按宿主 profile 的 worktree 模板给出：Claude 为在仓库根运行 `claude --worktree wakeflow-<name>`（宿主建分支 `worktree-wakeflow-<name>`、目录 `.claude/worktrees/wakeflow-<name>`），Test 窗口对已有回执的 worktree 追加 `--add-dir <相对工作区根的路径>`；Codex 为 `create_thread` 的 worktree 环境（detached HEAD，说明在第一次结果导入前必须 `git switch -c`），Test 窗口在说明里列相对路径。不给基线提交 sha，只给 `local-head` 策略。
- Demand 与下游（D5）：Demand 身份 `executionPlacement` 与权威的 placement 证明删除，改为 `podId`（身份 Schema v1 直接改，ADR-0008 新版本系）；`create_demand` 请求增加可选 `podId`，缺省为 primary；阻塞 `pod-unknown:<podId>`、`pod-closing:<podId>`、`pod-busy:<demandId>`（同 pod 已有活动 Demand，取代全局 `active-demand-exists`，ADR-0011 D7 的"总控只能有一个活动 Demand"由此收窄为"一 pod 一 Demand"）；创建不要求 pod 已 ready。任务包的实现分配必须是该 pod 该仓库的产品窗口（`assignment-window-pod-mismatch`），测试分配取该 pod 的 test 窗口；Route 删除 `isolated-test-planning-not-implemented`。投递准备对 worktree pod 的产品窗口要求 worktree 回执存在且与当前绑定同代（`precondition-failed/worktree-receipt-missing`），可移植 prompt 的身份段写 `pod: <name> (<podId>)`，`workspaceRootFromWindow` 按回执路径相对工作区根计算；测试任务 prompt 的阅读顺序列出每仓库 worktree 的相对路径。回调落到该 pod 的 Controller 窗口。结果导入对 worktree pod 要求 `repositoryChange.branch` 非空（`precondition-failed/worktree-branch-required`，ADR-0010 D4 的 Codex detached 规则），不与回执交叉核对。证据来源根增加 `pod-worktree{podId, repositoryId}`（按当前宿主的回执路径解析，隐私白名单加入回执路径）。归档清单 `worktree` 改为 `{podId, name, placement, repositories[]{repositoryId, suggestedName, branch | null, head}} | null`（primary 为 null，数据来自配置记录与回执，不含路径）。
- 清理归属（D6，能力卡 8 Q7、ADR-0012 D3）：Wakeflow 从不删除 worktree（ADR-0010 D4）。8.4 的清理并入 pod 关闭第二段：检出仍在时 `close` 阻塞并让 Agent 以宿主手段处置（退出会话时删除或 `git worktree remove`），处置后再 `close` 才 closed；关闭时删除的只有 Wakeflow 自己的回执文件。维护对账对 pod 只报告不删除（能力卡 1 Q7），报告内容随观察切片的 `pod-execution-location` 门。ADR-0010 未决三项：多仓库工作区一律为每个仓库建 worktree（D2 固定窗口集，不做子集隔离）；Codex 的 15 个受管 worktree 上限只进 skills 文本，机器侧不观察；已接受未合并分支的提醒阈值随观察切片。
- 场景（D7）：新增 `card-10/pod-lifecycle`，排在 `card-04/complete-and-continue` 之后：create preview 零写；apply 后配置含 pod 与四个派生窗口；同键重放 `already-created`；重名 `name-taken`；pod 的 controller、design、test 窗口握手；产品窗口无 worktree 回执被拒；在夹具仓库真实 `git worktree add`（测试代替宿主）后携 porcelain 回执登记，pod ready；同一 pod 第二个 Demand `pod-busy`；实现任务分配到 pod 产品窗口，投递 prompt 含 pod 名与相对路径且不含绝对路径；`branch: null` 的结果导入 `worktree-branch-required`；close preview `demand-active`；取消 Demand 归档后 close 进入 closing；再 close 报 `window-bound` 与 `worktree-present`；四窗口退役、`git worktree remove` 后 close 为 closed，配置不再含该 pod，回执目录已删；全程结果不含私有路径。
- 验收：`tests/capabilities/pod/decide.test.ts`（窗口集与身份派生、状态派生、create 与 close 两段阻塞、porcelain 解析）；`service.test.ts`（preview 零写、apply 配置事务与重放、closing 与 closed、recover 退休孤儿回执、reconfigure 拒改 pods）；endpoint 测试增加 worktree 回执校验（主检出、common-dir 不符、指针不一致、路径与 cwd 不符）；demand 测试改为 `pod-busy` 与 `podId` 身份；tasking、delivery、result-review、evidence、archive 各加 pod 分支一项；配置 codec 测试增加分组基数；场景 `card-10/pod-lifecycle` 接线。
- 目标度量：公共工具 18 → 19；持久标识类别 18 → 19（`pod`）；wire Schema 91 → 93（pod 请求与结果新增；config、identity、binding 请求与结果、archive manifest、launch intent 相关 Schema 直接改）；场景 15 → 16；`tools/list` 约 90,000 字节。
- 裁决（待用户确认）：
  - D1 pod 窗口的存放位置。建议窗口仍全部列在 `topology.windows` 并增加 `podId`，`pods[]` 只存 pod 记录，基数按 pod 分组校验；备选每个 pod 记录自带 `windows[]`，编译器逐 pod 展开（消费者改动更大，索引双份）。
  - D2 pod 身份与命名。建议 `podId` 由 `idempotencyKey` 派生、`name` 为存活期唯一的短 slug、窗口身份从 pod 派生；备选 uuid 工厂随机分配且不设 name（worktree 与标签只能用长 id）。
  - D3 `close` 的位置与 `recover` 的含义。建议 close 成为 preview / apply 下的 `intent.kind`，两段都零写预览、摘要 CAS；recover 只做回执对账；备选按 ADR-0010 字面给 `close` 独立模式且无预览，recover 不提供。
  - D4 worktree 回执的形态与校验。建议 Agent 交回 porcelain 与 common-dir 原文，Wakeflow 解析后用 `.git` 文件与 admin 目录的双向指针核对，不 spawn git，回执作为 `register` / `replace` 观察的一部分；备选 Wakeflow 自己 spawn `git worktree list --porcelain`（foundation 增加进程端口，测试需真实 git）。
  - D5 创建 Demand 时的 pod 门槛。建议只要求 pod 处于 open（未 closing），worktree 回执在投递准备时才要求；备选创建即要求 pod ready。
  - D6 closed 的严格性与清理。建议 closed 要求检出已不存在，处置由 Agent 以宿主手段完成，Wakeflow 只删自己的回执；备选允许 `retained` 检出进入 closed 并把删除留给维护对账（与能力卡 1 Q7"对账不删除"冲突）。
  - D7 Test 窗口的附加目录。建议不设登记顺序约束，Claude 的 `--add-dir` 只对 inspect 时已有回执的 worktree 生成，路径在测试任务 prompt 里以相对工作区根给出；备选要求产品窗口先于 Test 窗口登记（`pod-order`）。

### 13.92 L1 pod 切片 9：pod 记录、pod 作用域窗口、worktree 回执与关闭顺序实现与验收（2026-09-10）

按 13.91 七项裁决落地切片 9，单代理实现：配置 `pods[]` 与窗口 `podId`、`wakeflow_pod` 效果型工具、握手里的 worktree 回执、Demand 身份 `podId` 与一 pod 一 Demand、下游六处 pod 作用域改造、场景 `card-10/pod-lifecycle`。

- 配置（D1、D2）：Schema `wakeflow-config-v3` 增加 `pods[]{podId, name, placement: primary | worktree, lifecycle: open | closing, worktrees[]{repositoryId, windowId, suggestedName}, closing: {requestedAt, branches[]{repositoryId, branch | null, disposition: merged | abandoned}} | null}`（恰好一个 primary），四种窗口增加必填 `podId`；13.91 记录形状里的 `createdAt` 不记（fresh 编译没有时钟，配置记录不带时间）。codec 按 pod 分组校验基数（每 pod controller、design、test 各一；primary 每仓库至少一个 product，worktree 每仓库恰好一个且每个产品窗口恰好一条 worktree 意图；closing 与 lifecycle 一致；primary 不带 worktree 与 closing），索引增加 `podById`、`podIdByWindowId`、`podScopes`、`primaryPod`，原四个角色索引改为 primary 的别名。fresh-initialize 生成 `main`（第 9 个 UUID），文档渲染增加 `podId` 与 `pods`；reconfigure 对 `pods` 差异报 `reconfigure-pods-change-unsupported`。持久标识类别增加 `pod`。窗口身份从 pod 派生 `deriveDurableId("window", "pod-window", podId, role, rootId)`，显示名 `<name> · <模板显示名>`；`podId = deriveDurableId("pod", "create-pod", programId, idempotencyKey)`，同键改名报 `name-mismatch`。
- 工具（D3）：`src/capabilities/pod/{contract 76, decide 292, service 799}`，`wakeflow_pod` 走内核 `runPublicationTransaction`：请求 `{root, mode: preview | apply, intent: {kind: create, name, idempotencyKey} | {kind: close, podId, branches[]}, planDigest?}` 与 `{root, mode: recover, podId}`。create apply 在 preview 快照上 CAS 替换 `wakeflow.config.json`（追加 pod 与四个派生窗口），同键重放 `already-created`；close 两段同一意图：open 时校验 `pod-primary`、`demand-active:<demandId>`、`branch-disposition-missing | unknown:<repositoryId>` 后进入 closing（记下回执里的分支与处置），closing 时校验 `window-bound:<windowId>`、`worktree-present:<repositoryId>` 后从配置删除 pod 与其窗口并删除本宿主该 pod 的回执目录；recover 退休与当前绑定不同代或检出已不存在的回执，配置里没有的 pod 只清孤儿目录（`healthy | retired`）。状态 `creating | ready | closing | closed` 由配置记录加绑定登记表、回执与检出存在性派生；结果 `WakeflowPodPreview{status, blockers, planDigest, plan{kind, pod, windows[]{windowId, role, displayTitle, bound}, worktrees[]{repositoryId, windowId, suggestedName, receipt: absent | present | checkout-missing}}, next}` 与 `WakeflowPodMutation{mode, disposition: created | already-created | closing | closed | healthy | retired, pod | null, windows, worktrees, retiredReceipts, next}`；`next` 前沿 `pod-create-apply`、`pod-window-registration`、`pod-close-apply`、`pod-window-decommission`、`pod-worktree-disposal` 进内核表。目录登记从切片导入，两个组合根以宿主 facade 绑定 `managePod`。
- 回执与握手（D4）：内核新增 `pod-worktree-receipts`（767 行）：porcelain 解析（`worktree | HEAD | branch | detached | bare | locked | prunable` 行，未知行与相对路径拒绝）、准入（common dir 等于配置仓库根下 `.git` 的 realpath，会话 cwd 等于一个非主检出的 realpath，`<path>/.git` 指向 `<common>/worktrees/<name>`，admin `gitdir` 指回，admin `HEAD` 与分支或提交一致；失败 `precondition-failed/worktree-receipt`，details `check` 报出哪一项）、回执记录（`hosts/<host>/pods/<podId>/worktrees/<repositoryId>.json`，0700/0600，字段含 realpath、head、branch、locked、bindingId、observedAt、receiptDigest）与读写退休。布局增加 `hostPodReceiptsRootRef`、`podReceiptRootRef`、`podWorktreeReceiptRef`；资源 profile 的 `podEvidence` 改为 `podReceipts`（目录 `pods/`，旧 `evidence/pods` 声明删除），并增加 `surfaces.worktree{launch: claude-worktree-flag | codex-worktree-thread, attachedDirectories: add-dir-flag | prompt-path}`。端点：worktree pod 的产品窗口 `register` 与 `replace` 必须带 `observation.worktree{porcelain, commonDir}`（决定层 `invalid-request/worktree-receipt-required`），会话证据按 porcelain 列出的检出（加主检出，让准入报 `main-checkout`）匹配 `session-start` 的 cwd，回执在绑定互斥门内写入，同句柄重放补写；结果增加 `worktree{head, branch, detached, locked} | null`；`inspect` 的 `launchIntent` 增加 `podId`、`podName`、`podPlacement`、`worktree`、`attachedWorktrees`，执行说明按 profile 模板给出 Claude `claude --worktree wakeflow-<name>`（宿主分支 `worktree-wakeflow-<name>`）与 Test 窗口对已有回执的 `--add-dir <workspace root>/<相对路径>`、Codex `environment: worktree` 与"第一次导入前 `git switch -c`"说明；`next` 只把同 pod 的未登记窗口列为阻塞。启动意图增加 `podId`、`podName`、`podPlacement`、`worktree{repositoryId, suggestedName, basePolicy: local-head}`、`attachedWorktrees[]`。
- Demand 与下游（D5）：身份 Schema v1 直接改为 `podId`（`executionPlacement` 与权威的 placement 证明删除，`DemandAuthorityError` 去 `placement`）；`create_demand` 请求增加可选 `podId`（缺省 primary），阻塞 `pod-unknown:<podId>`、`pod-closing:<podId>`、`pod-busy:<demandId>`；治理守卫 `assertNoActiveDemand(root, signal, excluding, podId)` 读身份的 `podId`，发布服务 apply 再查一次并映射 conflict；continue 的 `otherActiveDemandId` 同样按 pod。Route 删除 `isolated-test-planning-not-implemented`（结果 Schema 的两条条件简化为 blocked 不带 `postAcceptanceRouteDigest`）。tasking：实现分配的窗口必须属于 Demand 的 pod（`assignment-window-pod-mismatch:<podId>`），测试任务取 pod 的 test 窗口。delivery：worktree pod 的产品窗口要求回执存在且与当前绑定同代（`worktree-receipt-missing | worktree-receipt-stale`），prompt 身份段 `pod: <name> (<podId>)`，`workspaceRootFromWindow` 按回执路径相对工作区根计算，测试任务 prompt 增加"pod worktrees to read"段列出每仓库相对本窗口根的路径。result-review：回调落到 Demand 所在 pod 的 Controller，prompt 写 pod 名；worktree pod 的实现结果 `repositoryChange.branch` 为空即 `precondition-failed/worktree-branch-required`。evidence：来源根增加 `pod-worktree{podId, repositoryId}`（三份 Schema），按配置 worktree 意图与回执路径打开，Demand 所在 pod 的回执路径进入隐私白名单。归档清单增加 `podId` 与 `worktree{podId, name, placement, repositories[]{repositoryId, suggestedName, branch, head}} | null`，`controllerWindowId` 取 pod 的 Controller。
- 清理（D6）：closed 要求检出已不存在，处置由 Agent 以宿主手段完成，Wakeflow 只删自己的回执目录；对账不删除，留给观察切片报告。
- 场景（D7）：`card-10/pod-lifecycle` 接线（16 场景全部通过）：create preview 零写、apply 后配置 2 pod 8 窗口、同键 `already-created`、重名 `name-taken`；pod controller、design、test 握手，产品窗口无 worktree 观察被拒，真实 `git worktree add` 后携 porcelain 登记，`recover` 回 ready；第二个包在同 pod `pod-busy`、primary 仍 ready；分配 primary 产品窗口被拒 `assignment-window-pod-mismatch`；投递 prompt 含 `feature-pod (<podId>)` 与 `../Workspace/` 且无绝对路径；`pod-worktree` 根登记证据；`branch: null` 导入 `worktree-branch-required`，带分支导入回调落到 pod Controller；rework 决定后取消 Demand，close 两段到 closed，配置回到 1 pod 4 窗口，回执目录消失。
- 验收：`tests/kernel/pod-worktree-receipts.test.ts` 3 项（porcelain 解析、准入六种拒绝、回执存储）；`tests/capabilities/pod/decide.test.ts` 4 项；`service.test.ts` 2 项（create 全流程；握手到 ready、两段关闭到 closed、未知 pod）；端点 decide 夹具与 tasking decide 增加 pod 分支；demand decide 改 `pod-busy` 与 pod 阻塞；requirement 服务测试改 `pod-busy`；身份与权威测试删 isolated；Route 测试删 isolated；配置、fresh、快照、目录、布局、矩阵测试按 `pods[]` 与 `podReceipts` 更新；目录与制品测试按 19 工具更新。
- 度量：公共工具 18 → 19；持久标识类别 18 → 19；wire Schema 91 → 93；场景 15 → 16；测试 844 → 851；架构门 631 → 640 模块；新增代码：pod 切片 1,167 行、内核回执 767 行；工作树相对 `b899182` 已跟踪部分 151 文件 +5,222/−3,320，另有 15 个新增未跟踪条目（均含切片 8 未提交部分）。
- 过程记录：场景测试文件曾被一次正则改写误伤（跨行替换），按 HEAD 版本加会话记录里切片 8 的三段编辑脚本重放、再叠加本片改动重建，16 场景全部通过后才继续；教训是对大文件只做锚定精确的替换。
- 残余：Wakeflow 不 spawn git，回执核对只用指针文件；status 的 pod 段、`pod-execution-location` 门与已接受未合并分支列表随观察切片；Codex 的 15 个受管 worktree 上限不观察；回执按宿主目录存放，无宿主身份的消费者取第一个有回执的宿主；`wakeflow_pod` 不核对调用方身份（与其他工具一致，skills 文本规则）；Claude 宿主真实会话未运行（按 CLAUDE.md 记为未验证）。
- 门：全量 `npm test` 通过：typecheck，架构门 640 模块 ok（生产根 10 不变），Biome 0 错误（3 处旧树警告不变），格式检查通过，knip 无发现，851 测试通过，Schema 漂移检查 ok（93）；`git diff --check` 干净。本切片未提交，等待用户决定。

### 13.93 L1 走读 §8.1 档落地：十二项小改动与六份回归（2026-09-17）

按 `docs/reviews/2026-09-11-l1-source-walkthrough-findings.md` §8.1 的排序，把"小改动、明确收益"一档作为独立一批落地，不混入切片 10。十三项里十二项完成；第 13 项（§7 给 `pod-worktree-disposal` 前沿加建议命令）留给切片 10 设计，因为 `NextProjection` 没有自由文本槽，加字段要改 Schema。所有改动都是锚定精确替换（每处断言命中次数），没有正则批改。

- 3.1 + 3.2（声明释放）：内核 `work-claims` 新增 `releaseWorkClaimIfHeld(root, windowId, fence)`，返回 `released | absent | foreign`，不抛错。delivery 的 `releaseClaimFor` 与 result-review 的 `releaseFence` 都改为调用它：delivery 的释放从"仅 committed 分支"改为首次与重放路径共用（追加已提交而释放未完成的裂缝由重放补做）；result-review 删除 `precondition-failed/claim-foreign` 硬失败——结果事件已经提交，清理找不到目标不能否定它，也不动别人的声明。
- 3.4（中止被吞）：`DemandEventSourcingRepository.refreshCheckpoints` 退休快照的失败里 `aborted` 照常上抛；`capabilities/demand/verify.ts` 的 `guarded` 对 `aborted` 上抛而不是记成 `unavailable`。
- 3.10（`pod-busy:unknown`）：`assertNoActiveDemand` 先收窄 `claimed && claim !== null`，`details.demandId` 总在；`activeDemandOnPod` 删掉 `?? "unknown"`，缺 details 原样上抛。
- 3.5（复测基线连接键）：`PriorTestResultView.expectedByStepId`（then 文本）改为 `itemIdByStepId`（`requirementRef.itemId`），`deriveStepViews` 按需求验收条目匹配前代步骤，`testResultView` 同步。
- 3.6（显式解决的证据）：`decideOutcome` 的 `resolutionRecordFound` 复用 `user-prompt-submit` 过滤后的 `landing` 数组，Controller 引用的 `hookRecordId` 只认落地记录，与自动判定同一标准。
- 2.1（常量归位）：`MAXIMUM_WORK_CLAIM_GENERATION` 从内核导出，`DELIVERY_REARM_LIMIT = MAXIMUM_WORK_CLAIM_GENERATION - 1`；`CREDENTIAL_PRIVACY_FINDING_KINDS` 进 `kernel/privacy-scan`，证据捕获规划与 demand decide 共用；`REPLACEABLE_PHASES` 从聚合状态导出，tasking decide 删本地副本。
- 2.2（穷尽性）：`evolveDemandEventSourcingState` 尾部显式判 `lifecycle.demand-cancelled` 后落到 `unhandledEvent(event: never)`；`assertEventCommitBoundary` 改为 `eventCommitBoundaryRevision` 的穷尽 switch（4 类绑定、11 类显式 `null`、`default` 走 `never`）；`DEMAND_EVENT_SOURCING_EVENT_TYPES` 以 `satisfies readonly DemandUncommittedEvent["eventType"][]` 绑定归约器的事件联合。
- F6：tasking、delivery、result-review 三处丢弃返回值的 `computeDemandEventSourcingCommandDigest(command)` 删除，导入随之清理。
- 4.3（角色唯一性）：`assertIdentityRelations` 按角色计数，必需角色恰好一个成员（原来只查存在）。
- 4.6：`lastTestAttempt(lineage)` 替换聚合状态里仅有的两个 `.at(-1)!`。
- 4.5（索引刷新移出失败路径）：`applyTerminal` 顺序改为 `retireDemandRoot → deleteJournal → refreshBoardIndexQuietly`，后者只吞 `board-index-contended`；`requirement/service.ts` 的三处刷新同样改为静默版本。
- F1 / H3（`skipped` 语义）：`listObservationCandidates` 改返回 `unrecognized`（文件名不合法的条目数），`skipped = unrecognized + 读不出的候选`，被 `event / since / sessionId` 过滤掉的记录不再计入；接口注释按此改写。
- H1 / H2（注释与上限）：`delivery-envelope` 模块头、`DELIVERY_PROMPT_MAXIMUM_CHARACTERS` 与 `computeDeliveryPromptDigest` 注释删去"最终 prompt 由可移植 prompt 加工作区根派生"的两阶段说法；`prompt.ts` 的 `MAXIMUM_PORTABLE_CHARACTERS = 60_000` 删除，渲染改用 `DELIVERY_PROMPT_MAXIMUM_CHARACTERS`（65,536）；`archive.ts` 的"唯一的递归删除点"改为"唯一一处递归删除用户内容"。
- 验收：新增 `tests/kernel/work-claims.test.ts` 2 项（条件释放的三种处置与重复释放；rearm 上限由代际上限派生）；`hook-observations.test.ts` 对过滤读取断言 `skipped` 不变；`demand-identity-authority.test.ts` 加同角色两个成员被拒；`delivery/service.test.ts` 加"同会话 stop 记录（带相同 prompt 摘要）不能作为显式解决证据"；`result-review/service.test.ts` 在再导入前把窗口声明换成更高代际的外来声明，导入仍提交且外来声明不被动；`result-review/decide.test.ts` 改为按条目号匹配（合同步骤各引用不同条目，复测合同 `ts-7` 引用上一代 `ts-3` 的条目 `ac-3`）。
- 度量：测试 851 → 853；公共工具 19、Schema 93 不变；架构门 640 → 641 模块（新增的测试模块进图，生产根 10 不变）；工作树相对 `5341306`：`src/` 25 文件 +230/−142，已跟踪测试 5 文件 +80/−8，新增测试 72 行；文档：走读记录加 §10 处理记录、README 行状态更新、本节。
- 门：全量 `npm test` 通过：typecheck，架构门 641 模块 ok（生产根 10 不变），Biome 0 错误（3 处旧树警告不变），格式检查通过，knip 无发现，853 测试通过（16 场景全部通过），Schema 漂移检查 ok（93）；`git diff --check` 干净。
- 残余：§8.1 第 13 项随切片 10；§8.2 / §8.3 未动，待裁决；Claude 宿主真实会话未运行（按 CLAUDE.md 记为未验证）。本批未提交，等待用户决定。
- 提交：`779a40e`（2026-09-17，用户"提交"）。

### 13.94 L1 observation 切片 10：`wakeflow_status`、`wakeflow_verify`、活动投影与状态栏设计定案（2026-09-17，用户 09-18"确认 继续"）

L1 最后一片。依据 ADR-0013 G 序第 10 行（范围：`wakeflow_status` 全域、`wakeflow_verify`、活动投影、Claude 状态栏资产；删除 active 7 文件）、能力卡 9（Q1 到 Q7 已于 09-04 确认）、能力映射矩阵三行"缺席"（`wakeflow_status`、`wakeflow_verify`、活动投影）加状态栏行，以及 13.83 D7、13.91/13.92 的残余（status 的 pod 段、`pod-execution-location` 门、已接受未合并分支、阈值进配置、`pod-worktree-disposal` 引导、对账只报告）。本节先定案，用户确认后按 13.92 的方式单代理实现。

**范围与删除。** 新增两个读工具，删除 `wakeflow_inspect_demand_route`（并入 `wakeflow_status{demandId}`），公共工具 19 → 20，与 ADR-0013 F 的清单一致。被替代物：`src/workspace/active/` 8 文件 1,910 行（fresh 投影权威、inspection、publication、layout 物化、看板初始化）由内核 `active-projection` 加切片投影取代，同一提交删除；demand 切片的路由工具（合同常量、两份 Schema、executor、`inspectDemandRoute` 绑定、目录与场景测试的调用）删除。

**切片形状。** `src/capabilities/observation/{contract, decide, service, projection}`；读模型下沉治理层 `src/governance/observation/`（`workspace-observation` 一次观察多域、`repository-pointer-observation` 仓库指针文件事实、`active-projection-model` 投影模型），因为投影刷新要被六个变更切片调用而切片互不引用；文件格式、标记、指纹、CAS 与零写规则进内核 `src/kernel/active-projection.ts`；Claude 状态栏资产字节与摘要进 `src/hosts/claude-code/claude-code-statusline-asset.ts`。两个工具走内核 `runCommandShell`，`privateValues` 与其他读工具一致。

- D1 `wakeflow_status` 形状。建议请求 `{root, demandId?}`，结果 `WakeflowStatus{observedAt, overall: maintenance | blocked | degraded | active | idle, config{programId, configDigest, language, valueSources 摘要}, board{counts, pending[]{requirementId, title}}（卡 9 Q2）, demands[]{demandId, demandType, podId, disposition, frontier, blockers 计数, streamRevision}, windows[]{windowId, podId, role, identity: registered | unregistered, bindingGeneration, claim: free | held{demandId, deliveryId, generation}, lastObservation{event, recordedAt} | null}, claims[], pods[]{podId, name, placement, state, activeDemandId, worktrees[]{repositoryId, receipt: absent | present | checkout-missing}}, repositories[]{repositoryId, head, branch | detached, worktrees[]{name, prunable}}, hooks{perHost{records, skipped}}, unmergedAccepted[]{demandId, targetTaskId, repositoryId, branch, commit, acceptedAt}, policy{生效阈值}, route: 当前 Route 或归档回执 | null（带 demandId 时即原 `inspect_demand_route` 的结果）, next, nextActions[]{owner, tool | null, reason, subject | null}}`。每个域独立读取，失败只让该域 `unavailable` 并带 issueCode（旧模式保留）；`nextActions` 去重、确定性排序、上限 64，顺序为维护 > 未登记的活动 pod 窗口 > 活动 Demand 前沿（primary 先）> 待认领需求包 > 空；不带 demandId 时 `next` 取 `nextActions` 头项映射到内核前沿表，带 demandId 时 `next` 来自 Route。`overall`：配置或布局读不到即 `maintenance`；任一活动 Demand blocked 或 awaiting-decision、或 closing pod 有阻塞即 `blocked`；任一域 `unavailable`、hook 通道 `skipped > 0`、孤儿声明即 `degraded`；有活动 Demand 即 `active`；否则 `idle`。不带 `language`：结果是数据，语言只影响投影 Markdown（取配置 `presentation.language`）。备选：按域拆成多个读工具——违反 ADR-0004 与卡 9"一次观察、多份投影"。
- D2 仓库事实不 spawn git（修订卡 9 Q1）。卡 9 Q1 于 09-04 裁决"保留 git 观察：双读一致、`GIT_OPTIONAL_LOCKS=0`、5 秒超时"；13.91 D4 于 09-10 裁决 Wakeflow 不 spawn git，回执核对只用指针文件。两者冲突，建议以后者为准并把修订记进卡 9 确认记录：status 的 `repositories[]` 只读 `.git/HEAD`、`refs/heads/*`、`packed-refs` 与 `.git/worktrees/<name>/{gitdir, HEAD}`，报告 HEAD、当前分支、登记的 worktree 与 prunable（gitdir 指向的检出已不存在）；工作树是否干净不观察（`cleanliness: unobserved`），Wakeflow 没有任何判定依赖它——导入带分支与提交，pod 关闭带处置。`unmergedAccepted` 相应定义为"已接受的实现结果中分支引用仍存在于仓库且分支尖端不等于主分支尖端"（无对象图不能判祖先，文档写明），全部列出不设阈值（ADR-0010 未决项"提醒阈值"就此关闭：不提醒，只列出）。备选：按卡 9 Q1 原样保留 spawn git——需要 foundation 增加进程端口，MCP 进程依赖 git 二进制，且与 13.91 D4 矛盾；留作 L2 若真需要"脏工作树"事实再开。
- D3 `wakeflow_verify` 门集合。建议请求 `{root, demandId?}`，结果 `{observedAt, configDigest, ok, summary{pass, fail, unavailable}, gates[]{name, owner, status: pass | fail | unavailable, code, evidence[]{ref, digest}}, demand: {demandId, gates[], observationDigest} | null, repairsApplied: false, observationDigest, next}`；`ok` 要求至少一门且全部 pass，`unavailable` 算不通过但分开计数（卡 9 Q3）。工作区级 13 门，按名字排序：`config-authority`、`local-layout`（静态资源矩阵：目录 0700、文件 0600、无符号链接）、`ledger-layout`、`board-consistency`（认领状态文件全部可解析、索引摘要等于重渲染、claimed 指向存在的 Demand 根或归档）、`demand-root-audit`（每个活动 Demand 全量审计 stateDigest）、`work-claims`（每份声明引用同代绑定与活动 Demand 的在飞投递，否则 `orphan:<windowId>`）、`append-candidates-clear`（无残留候选目录与非活动 Demand 的生命周期日志）、`evidence-integrity`、`host-hook-channel`（每个宿主的观察目录存在、模式正确、`skipped === 0`）、`window-identity`（绑定记录可解析且 windowId、podId、role 与配置一致；未登记不是损坏，pass 并在 code 报计数）、`pod-execution-location`（ready 的 worktree pod 每个仓库有回执且 `.git` 指针双向一致，缺检出即 fail；closing 的 pod 检出仍在为 pass 并在 code 报出；primary pod 的仓库根 `.git` 必须是目录）、`host-settings-assets`（Claude：settings 托管块与状态栏资产字节摘要及 0600；Codex：pass，code `not-applicable`）、`active-projection`（标记有效且指纹为当前；stale 或 missing 为 fail，手写文件 pass 并 code `handwritten`）。带 demandId 时 `demand.gates` 复用 demand 切片现有的 `evaluateVerifyGates` 八门（不改名，不与工作区门合并）。卡 9 Q4"归档 apply 与 pod 关闭要求最近一次 verify 的 observationDigest"已由完成即归档内嵌八门实现（13.8x），pod 关闭不再另加前置，修订记进卡 9。备选：verify 只做工作区门、Demand 门另开工具——多一个工具且违反 F 清单。
- D4 一次观察两份投影。治理层 `observeWorkspace(root, snapshot, now)` 返回一份不可变观察记录（各域独立隔离失败），status、verify 与投影模型都从它派生，`observationDigest` 是观察记录的规范 JSON 摘要；两次调用各自观察，不设跨调用令牌（旧令牌只为读回防伪，新形状里投影在同一调用内生成）。
- D5 活动投影。文件与标记规则照卡 9：`.wakeflow-active/index.md`、`current/workspace-current-status.md`（标记 `wakeflow:active-projection:v1:sha256:<64hex>`）、`current/<demandId>/index.md` 与 `developer-progress.md`（标记 `wakeflow:demand-projection:v1:sha256:<64hex>`），0600，单文件上限 8 MiB。指纹绑定投影器版本、语言、配置摘要、每个活动 Demand 的 stateDigest 与 reviewSnapshotDigest、pod 集合；有意忽略 mtime、看板内容与本地运行时。目标分类 current、missing、stale、unsafe（符号链接、非普通文件、硬链接数不为 1、不可读、无标记即手写）；任一 unsafe 整轮零写并在 status 报 `projection: unsafe`；重建在投影短锁内，逐文件 CAS。`workspace-current-status.md` 增加 pod 段（每个 pod 的执行位置、活动 Demand、已接受但分支仍在的列表）；`developer-progress.md` 每 Demand 一份（卡 9 Q7、卡 4 Q6：当前状态、任务与结果进度六个计数、最近十条事件）。触发：Demand 事件提交（create、plan、prepare、outcome、rearm、import、两类决定、evidence、complete、cancel、continue）与 pod create/close 之后由各切片调用治理层 `refreshActiveProjectionQuietly(root)`（只吞投影锁争用，与看板索引同一模式）；窗口登记、hook 记录、工作声明、需求看板变更不触发（看板有自己的索引）。fresh-initialize 改为用内核渲染器写"空工作区"模型的两份工作区文件；maintenance 对账对投影只报告 stale/missing/unsafe，不重算模型（重算是 status 之外任何变更的副作用，对账的 `next` 指向 `wakeflow_verify`）。备选：投影由 `wakeflow_status` 顺带写——违反"观察不写"。
- D6 Claude 状态栏资产。资产由 TS 生成精确字节（`claude-code-statusline-asset.ts` 导出内容与摘要），maintenance 的 Claude 宿主步骤按资源 profile 的 `statuslineAsset.fileName` 安装到 `runtime/hosts/claude-code/operations/assets/statusline.mjs`（0600）并写 settings 的 statusLine 命令（`node -- <asset> --wakeflow-statusline-v1 --workspace-root-base64 <根>`，根不从 cwd 推断）；脚本读 stdin 的 statusline JSON（上限 256 KiB，取 `session_id` 与模型名），读 `wakeflow.config.json` 的 `pods[]` 与 `topology.windows`，在绑定目录里找 `claude-session` 句柄等于 `session_id` 的窗口，打印恰好一行：main 为 `<model> · <window>`，其他 pod 为 `<model> · <pod> · <window>`（卡 9 Q6），找不到时只打印模型名；不含路径、句柄、摘要，stderr 为空。Wakeflow 只校验字节与模式（verify 的 `host-settings-assets` 门），不 spawn node 做 smoke（与 D2 同一原则）；资产脚本的行为由仓库测试用 node 直接执行夹具验证。
- D7 阈值先不进配置。13.83 D7 把静默阈值与 rearm 上限留给本片进配置；建议本片不加配置项：rearm 上限已由内核声明代际派生（13.93），静默 10 分钟、回调静默 10 分钟、回调代际上限 4、第三次 rework 刹车、声明恢复窗口 2 小时都还没有用户要求可调；但 status 要报生效值且不能跨切片导入常量，所以把 `DELIVERY_LANDING_SILENCE_MILLISECONDS` 从 delivery 切片下沉到 `governance/delivery/delivery-outcome.ts`，与 `TARGET_RESULT_CALLBACK_*`、`DEMAND_REWORK_ESCALATION_THRESHOLD`、`WORK_CLAIM_RECOVERY_WINDOW_MILLISECONDS` 一起由治理层一张 `policy` 表导出，status 的 `policy` 段原样报告。配置化记进 ADR-0012 未决项，L2 视场景需要再开。备选：本片加 `policy{}` 段进 `wakeflow-config-v3`（额外 Schema、codec、reconfigure 差异与测试）。
- D8 research Demand 的完成路径。现状：零实现目标的 research Demand 路由为 `blocked` 加 `research-completion-not-implemented`，是全系统最后一个 not-implemented（L2 门要求清零）。建议本片实现而不是删除类型：research 的完成物是受管证据——路由在存在至少一条本 Demand 的 `document` 类证据时给 `work-available`、前沿 `research-completion-required` 改为 owner controller、建议工具 `wakeflow_complete_demand`；没有证据时 `blocked` 加 `research-evidence-missing`；完成决定器对 research 允许零目标，preflight 加一门 `research-evidence`（≥ 1 条 document 证据）；归档清单照常。改动落在 demand 切片与路由（约 60 行加测试），与本片同一提交，因为它由观察切片的"不再有 not-implemented"退出条件驱动。备选：删除 `research` 类型（身份 Schema 与四处词汇表变更，且卡 4 已确认保留）。
- D9 hook 观察脚本提前到 L2 起点。ADR-0009 把 `hooks/hooks.json`、Codex `notify` 配置与观察脚本列为 L3/E4 产物，但 L2 退出门要求两宿主各完成一次真实投递并交回 hook 证据，没有脚本无法达成。建议把脚本作为 entrypoint（`src/entrypoints/wakeflow-hook-observer.ts`，写 `session-start | user-prompt-submit | stop | session-end` 四类记录，`recordedAt` 由脚本本地时钟提供并记进 ADR-0009 未决项"重试幂等边界"）连同两宿主的 hook 配置片段提前到 L2 第一项，L3 只负责打包；plan §8.1 的 L2 行相应改写。本片不做。备选：把 L2 门降为"场景联合不要求真实宿主"——推迟了唯一能证明证据通道成立的验证。
- D10 其余残余。`pod-worktree-disposal` 引导：不改 `NextProjection`，pod 关闭的 preview 与 close 结果在 `worktrees[]` 每项加 `disposal{suggested, alternative}` 文本（来自宿主 profile 的 worktree 模板：`git worktree remove <相对路径>` 与"退出宿主会话后由宿主清理"），status 的 pod 段对 closing pod 同样给出；对账对 pod 不再单独报告，`pod-execution-location` 门是唯一出口；`inspect_demand_route` 的调用方只有目录与场景测试（`src/` 内无 prompt 引用），全部改为 `wakeflow_status{demandId}`；矩阵三行"缺席"改"重切"并写场景编号；ADR-0010 未决三项全部关闭。

**场景。** `card-09/status-and-verify`：在 `card-10/pod-lifecycle` 之后的工作区上（两个 pod、活动 Demand、worktree 回执）调用 status：`overall` 为 `active`，pod 段两项且执行位置正确，`board.counts` 与 `inspect_board` 一致，`windows[]` 含已登记与未登记，`claims[]` 与声明文件一致，`repositories[]` 报 HEAD 与登记的 worktree，带 demandId 的 `route` 与删除前的路由结果逐字段相同，`policy` 报生效值，结果不含私有路径与句柄；verify：13 门全 pass、`ok: true`、`summary{13, 0, 0}`；向观察目录放一个非法文件名后 `host-hook-channel` 为 fail 且 `ok: false`、`summary.fail: 1`；删除文件后恢复。`card-09/active-projection`：一次 Demand 变更后四类投影文件存在、标记有效、指纹与 status 一致；去掉一份文件的标记（模拟手写）后再触发变更，整轮零写、status 报 `projection: unsafe`、verify 的 `active-projection` 门 pass 且 code `handwritten`；恢复标记后重建为 current；`workspace-current-status.md` 含 pod 段。两条接线后场景 16 → 18。

**验收。** `tests/kernel/active-projection.test.ts`（标记与指纹、四类目标分类、unsafe 整轮零写、CAS 与锁）；`tests/governance/observation/repository-pointer-observation.test.ts`（真实 `git init` 加 `git worktree add` 夹具：HEAD、分支、packed-refs、prunable）；`workspace-observation.test.ts`（域隔离失败）；`tests/capabilities/observation/decide.test.ts`（overall 与 nextActions 排序、verify 汇总与 ok、投影模型）与 `service.test.ts`（两个工具的读路径、带与不带 demandId、归档 Demand、脱敏）；`tests/hosts/claude-code/statusline-asset.test.ts`（以 node 执行资产：main 与非 main 标签、未匹配会话、超大 stdin、stderr 为空）；demand 切片增加 research 完成路径测试；目录与制品测试按 20 工具更新。

**度量目标。** 公共工具 20；wire Schema 93 − 2 + 4 = 95（status 与 verify 各请求与结果，域形状进 `$defs`）；场景 18；新增约 3,500 行，删除约 2,300 行（`workspace/active` 1,910 加路由工具）；`tools/list` 仍低于 60 KB。

**待用户确认的项。** D2（修订卡 9 Q1：不 spawn git）、D3（Q4 修订：pod 关闭不加 verify 前置）、D7（阈值不进配置）、D8（research 实现而非删除）、D9（hook 脚本提前到 L2 起点）是与既有裁决或计划相抵的五项；D1、D4、D5、D6、D10 是按能力卡落地的形状选择。回复"确认 继续"即按建议列执行；对某项另有选择则指出编号。

### 13.95 L1 observation 切片 10：实现中断点与并行计划（2026-09-18）

按 13.94 十项裁决单代理实现，进行到"代码主体写完、typecheck 通过、测试一次未跑"时会话进程退出（后台全量门被遗弃，日志尾部是进程被杀时的挂起 Promise 报错，不是真实失败）。本节记录中断点的精确状态、已知偏差与后续并行计划，供 ultra 模式的并行代理接手。工作树相对 `779a40e` 全部未提交，约 92 个条目。

- 已落地（按裁决编号）：
  - D1 / D4：`src/governance/observation/workspace-observation.ts`（一次观察多域：活动布局、看板、活动 Demand、工作声明、每宿主绑定与 hook 通道、pod 回执、仓库指针、状态栏资产、投影目标；`projection` 与 `full` 两种作用域；每域独立隔离失败并带 issue，中止一律上抛；`deriveOverallStatus`、`orphanWorkClaims`）；`src/capabilities/observation/{contract, decide, service}.ts`（`wakeflow_status` 与 `wakeflow_verify` 走内核 `runCommandShell`，打开上下文即完成观察，`privateValues` 含句柄、hook 会话与 worktree 路径；`nextActions` 排序、去重、上限 64；投影段并入 service，没有单独的 `projection.ts`）；Schema `wakeflow-status-{request, result}`、`wakeflow-verify-{request, result}` 四份，生成类型已重建。
  - D2：`src/governance/observation/repository-pointer-observation.ts`（只读 `.git/HEAD`、`refs/heads/**`、`packed-refs`、`.git/worktrees/<name>/{gitdir, HEAD}`；打开失败或 HEAD 读不出即整仓 `unavailable` 带 issue，单个指针读不出只让对应项为 null）。
  - D3：`src/governance/demand/demand-verify-gates.ts`（demand 切片的门下沉治理层，`payloadBlockers: null` 时不设 `payload-privacy` 门，research Demand 加 `research-evidence` 门；`capabilities/demand/{verify, decide}.ts` 改为再导出）；`observation/decide.ts` 的 `deriveWorkspaceGates` 十三门按名字排序、`summarizeGates`（`ok` 要求全 pass，`unavailable` 分开计数）、`verifyNext`。
  - D5：`src/kernel/active-projection.ts`（两级容器检查与物化；事实 → 工作区索引、当前状态、每 Demand 索引与进度页的渲染；标记与指纹；四类目标分类；任一 unsafe 整轮零写；投影锁内逐文件 CAS；不活动 Demand 的页面目录只在每个成员带标记时退休）；`src/governance/observation/{active-projection-facts, active-projection-refresh}.ts`（观察 → 事实；`refreshActiveProjectionQuietly` 只吞 `io-failure`；`afterMutationRefresh` 包装）；十一处变更执行器接入（create、complete/cancel、continue/record-decision、plan、prepare/outcome/rearm、import、两类决定、evidence、pod、maintenance apply）；`src/workspace/{wakeflow-active-static-resource-catalog, wakeflow-active-fresh-projection}.ts` 取代 `src/workspace/active/` 8 文件（已删除，含其 3 份测试）；内核 `layout.ts` 增加活动根、两份工作区投影、投影锁与每 Demand 页面目录的引用——页面放 `.wakeflow-active/projections/<demandId>/`，不进 Demand 根（根是带负载摘要的权威树）；`requirement-board.ts` 导出空索引与初始化权威摘要；维护 preview 只在 fresh 规划投影步骤，reconfigure / reconcile 改为 apply 之后刷新。
  - D6：`src/hosts/claude-code/claude-code-statusline-asset.ts`（脚本精确字节与摘要，`node -- <asset> --wakeflow-statusline-v1 --workspace-root-base64 <根>` 命令渲染）与 `claude-code-statusline-asset-operation.ts`（维护操作 `statusline-asset`：零写计划，缺失创建、漂移 CAS 替换，0600）接进 Claude 维护 capability 的闭合分派。
  - D7：`src/governance/observation/observation-policy.ts` 一张表；`DELIVERY_LANDING_SILENCE_MILLISECONDS` 下沉 `governance/delivery/delivery-outcome.ts`，`WORK_CLAIM_RECOVERY_WINDOW_MILLISECONDS` 下沉内核 `work-claims`，原位置改为再导出。
  - D8：`demand-completion` 的 `testingMode` 增加 `not-applicable`（Schema 同步）；post-acceptance 路由新增 `researchStage`（无 `document` 类证据 → `not-ready / research-evidence-missing`，有 → `completion-preflight{mode: not-applicable}`）；Controller 路由的 research 分支改为 `work-available` 或 `blocked + research-evidence-missing`（`research-completion-not-implemented` 删除，全系统不再有 not-implemented blocker）；聚合完成对 `not-applicable` 允许零实现目标；内核前沿表 `research-completion-required` 改为 controller 加 `wakeflow_complete_demand`。
  - D10：`src/governance/pod/{pod-state, worktree-disposal}.ts`（状态派生从 pod 切片下沉，处置引导），pod 结果 `worktrees[].disposal` 字段（Schema 同步），status 的 pod 段同样给出；`wakeflow_inspect_demand_route` 从合同、服务、目录、共享 executor、两个组合根与 server instructions 删除，两份 Schema 删除，8 份测试改调 `wakeflow_status{demandId}`；目录测试计数 19 → 20；`.dependency-cruiser.cjs` 删除 governance → workspace/active 的过渡接缝。
- 已核实：`tsc -b`（src 与 tests）通过；Biome 格式已对改动文件应用；lint 剩 2 处认知复杂度超限（`observation/decide.ts` 的 `podsGate`、`observation/service.ts` 的 `windowViews`）。
- 未核实：测试一次都没跑（两次启动都被工具审查超时挡下）；knip、Schema 漂移检查、`git diff --check` 未跑；切片自己的测试与 card-09 两条场景未写。
- 已知偏差（相对 13.94；接手者要么补齐，要么记成裁决修订）：
  1. D1：`windows[]` 报 `bindingId` 而非 `bindingGeneration`；`unmergedAccepted[]` 没有 `acceptedAt`；`config` 段只有计数，没有 `valueSources` 摘要。
  2. D2：`unmergedAccepted` 只实现"分支引用仍在"，没有比较"分支尖端不等于主分支尖端"（仓库观察里已有各分支尖端，可补）。
  3. D3：`local-layout` 门只检查 `.wakeflow-local` 与 `runtime` 两级 0700 加活动布局，没有走静态资源矩阵；`window-identity` 门只报登记计数，记录与配置的一致性依赖绑定清单读取本身的准入（读不出即 `unobserved`）；`pod-execution-location` 门不再复核 `.git` 指针双向一致（登记时已核过），只看回执与检出是否存在。
  4. D5：`developer-progress.md` 只有六个计数与最近事件标识，没有"最近十条事件"；对账不再报告投影状态，只留 verify 的 `active-projection` 门。
  5. D6：维护只安装资产字节；`settings.local.json` 的 `statusLine` 条目仍由 Agent 按计划安装（13.94 写的是由维护写入），要定。
  6. 每次变更后的投影刷新是一次 `projection` 作用域的观察（加载每个活动 Demand 根、评审快照与路由），有可感知的时间成本；失败策略只吞 `io-failure`，夹具里若配置缺 ledger 放置会以 `precondition-failed` 让变更失败，回归跑起来才知道。
- 预计要改的既有测试：Claude 维护执行（宿主操作 3 → 4）、维护 preview 的 reconcile 期望、内核前沿表的 research 责任方、post-acceptance 路由与前沿矩阵的 research 分支、pod 服务结果的 `disposal`、聚合完成对 research，可能还有维护事务与静态矩阵里的摘要断言。

**并行计划（ultra 模式，共用同一工作树，不用 worktree）。** 代理不隔离，靠两条纪律避免冲突：文件所有权互斥（每个代理只改自己名下的路径，越界发现问题只报告不改），以及编译与测试互斥（`.build/` 是共享的增量构建目录，两个 `tsc -b` 同时写会互相破坏；所有编译、测试、门命令都经过一把 `mkdir` 原子锁串行执行，锁脚本放在会话临时目录，路径随任务下发）。不需要检查点提交。分三段，并行代理不超过三个，避免 09-04 那次二十余个代理耗尽额度的重演：

1. 串行（先做）：回归收平。跑 `npm run test:typescript`，修上表列出的既有测试与投影刷新的失败策略，清 2 处 lint，达到既有 853 测试全绿。这一段决定其他人赖以立足的基线，不并行。
2. 并行三份：
   - A 观察切片验收。写 `tests/kernel/active-projection.test.ts`、`tests/governance/observation/{repository-pointer-observation, workspace-observation}.test.ts`、`tests/capabilities/observation/{decide, service}.test.ts`；顺带补偏差 1、2、3。只允许改 `src/kernel/active-projection.ts`、`src/governance/observation/**`、`src/capabilities/observation/**` 与上述测试。
   - B 宿主资产与 research。写 `tests/hosts/claude-code/claude-code-statusline-asset.test.ts`（以 node 执行资产：main 与非 main 标签、未匹配会话、超大 stdin、stderr 为空；操作的创建 → 当前 → 漂移 → 替换）与 `tests/governance/demand/demand-research-completion.test.ts`（路由、聚合完成、verify 门）；定偏差 5。只允许改 `src/hosts/claude-code/*statusline*`、`src/governance/lifecycle/demand-completion.ts`、`src/governance/review/demand-post-acceptance-route.ts`、`src/governance/controller/demand-controller-route.ts` 与上述测试。
   - C 场景与文档。把 `card-09/status-and-verify` 与 `card-09/active-projection` 接进场景骨架（只允许改 `tests/scenarios/**`）；更新 `docs/references/scenario-acceptance.md`（18 场景）、`docs/references/capability-map.md`（四行"缺席"改"重切"并写场景编号）、能力卡 9 的"现 TS 状态"与确认记录修订（Q1、Q4）、plan §13 与 README §3 的陈旧行、ADR-0010 未决三项关闭。
3. 串行（最后）：合并三份改动后跑全量 `npm test` 与 `git diff --check`，补 §13.96 实现记录的度量与门，等待用户"提交"。

### 13.96 L1 observation 切片 10：实现记录与门（2026-09-18）

按 13.94 十项裁决落地，经 13.95 的三段计划完成：串行回归收平（841 测试全绿）→ ultra 模式三个共用工作树的代理并行写验收（观察测试、状态栏与 research 测试、card-09 两条场景），每个代理各配一个只读的怀疑审阅者 → 串行合并与全量门。三个审阅者都给了 `approved: false`，其指出的问题在合并段逐条处理，记在下面的"裁决修订"里；未被证实的意见不采纳。L1 十片至此全部闭合：公共工具恰为 20 个，Controller Route 不再返回任何 not-implemented blocker。

**落地（按裁决编号，只记与 13.94 或 13.95 不同之处）。**

- D1：`windows[]` 报 `bindingId`（绑定库按登记代际给出标识，没有单独的代际计数器）；`config` 段只有计数，没有 `valueSources`（视图特性随 `wakeflow_view` 放弃，ADR-0006）；`unmergedAccepted[]` 带 `acceptedAt`（评审决定的 `decidedAt`）与 `repositoryObserved`。
- D2：已合并判定落为"分支尖端等于仓库当前所在分支的尖端"，仓库正检出在该分支上或处于分离头时不判定、条目保留；分支已删除不列；仓库指针未观察时保留并标 `repositoryObserved: false`（审阅者指出原实现拿 HEAD 尖端做代理会把正检出的分支误判为已合并，已改）。
- D3：`local-layout` 门比裁决宽：它走整份 reconcile 零写预览（`previewWakeflowStaticMaterialization`，当前宿主加两宿主 profile），任何待对账步骤（含 gitignore、程序指令、支持记忆的重组）都让门 fail，code 为 blocker 与 `step:<kind>`；预览抛错为 unavailable。这是有意的修订：门的意义是"工作区与当前声明一致"，而不只是目录模式。`window-identity` 只报登记计数，记录与配置的一致性由绑定清单读取的准入承担。`pod-execution-location` 不复核 `.git` 指针双向一致（登记时已核过）；primary 的 `main-checkout` 只在 `.git` 缺失或是 worktree 指针时 fail，仓库其他读不出为 unavailable（审阅者指出原实现把一切不可用都记成 main-checkout）。`append-candidates-clear` 在日志目录读不出时 unavailable（`journals:unreadable`），不再吞成 pass。`active-projection` 门的 code 形状是 `handwritten[,blocked:<n>]`（手写目标之外因整轮零写而 stale 的目标数）。`host-settings-assets` 门对资产字节与本地设置条目各投一票，code `<host>:<status>` 与 `<host>:settings-<status>`。
- D5：指纹与 `workspace-current-status.md` 都不含 `overall` 与看板计数（审阅者指出二者违反"指纹忽略看板内容与本地运行时"，且看板变更不触发刷新会让投影永久 stale）；页面导航到看板索引即可。投影事实一律按 projection 作用域派生：宿主域（绑定、hook 通道、资产、仓库指针）与由绑定派生的 pod 状态是本地运行时，status 与变更后的刷新因此算出同一份指纹。每 Demand 页面目录在 `.wakeflow-active/projections/<demandId>/`，不进 Demand 根。`developer-progress.md` 渲染六个进度计数与最近事件标识，"最近十条事件"待 L2 场景需要再加。对账不再报告投影，verify 的门是唯一出口。写测试时发现并修正：未物化的宿主运行时根（另一制品的宿主）曾让该宿主的绑定域 `unavailable`，连带每个窗口 `unobserved`、`overall: degraded` 与投影永久 stale，现在给出空绑定集；`recovering` 发布对父目录尚不存在的目标跳过阶段结算。
- D6：按裁决落为两条维护操作，而不是 13.95 偏差 5 的"由 Agent 安装"（那条路径没有任何生产者会把命令交给 Agent）：`claude-statusline-asset:install` 安装并校验资产字节（0600、摘要）；新增 `claude-statusline-settings:install` 把 `statusLine` 命令写进 `.claude/settings.local.json`，只改这一键、其他键与顺序原位保留、0600；命令带 base64url 的工作区根，所以只能进忽略的私有本地文件，不能进可提交的 `settings.json`；负载不含根，命令在执行时从根重新派生，目标摘要绑定最终字节；文件不是 JSON 对象时不猜，贡献 `blocked` 加 `claude-settings-local-unreadable`。Claude 宿主操作 4 → 5，按标识排序资产与设置排在三条 portable settings 之后。观察 facade 的 `statuslineAsset` 增加 `settings{path, key, expectedEntry(root)}`，由组合根提供。
- D8：13.95 记为已落地的"聚合完成允许零目标"只改了转换里的守卫，另有三处仍拒绝 research 完成，本段补齐：决定器解析不再限定 authority 的测试模式为 controller-only 或 real-environment（一致性由 `completion.testingMode === authority.testingDecision.mode` 保证，authority 已把 not-applicable 绑定到 research）；聚合状态 Schema 的 completed 分支不再要求 `targetTasks` 至少一项；解析层关系规则不再要求至少一个存活实现目标，目标数量由完成转换按测试模式把关（controller-only / real-environment 仍要求至少一个已接受目标）。路由的 `testing-not-applicable` 死枚举值删除。research Demand 带未接受实现目标的分支保留：路由与聚合完成对"每个未被替代的实现目标都已接受"的要求一致，该状态只在治理层可达（tasking 切片拒绝给 research 规划实现包），测试也在治理层。
- D10：能力映射矩阵除三行观察与状态栏行外，`wakeflow_replace_windows` 一行也从"缺席"改"重切"（endpoint 切片 2 早已落地，场景 `card-02/window-replace`，本次补记）；统计改为重切或已落地 27、缺席 0、放弃 4。

**验收。** 新增测试 39 项：`tests/kernel/active-projection.test.ts` 7（两级容器、渲染与指纹、发布 CAS、手写零写、不安全目标、退休、投影锁）、`tests/governance/observation/repository-pointer-observation.test.ts` 3（真实 git 夹具、不可用原因、不 spawn git）、`workspace-observation.test.ts` 4（各域 observed、域隔离、中止上抛、孤儿声明与 overall）、`tests/capabilities/observation/decide.test.ts` 7（nextActions 顺序与上限、十三门各自 pass / fail / unavailable、pod 执行位置、投影门、汇总与 next）、`service.test.ts` 5（status 全域与脱敏、带 demandId 与归档、verify 十三门与 hook 通道、unmergedAccepted 四种仓库状态）、`tests/hosts/claude-code/claude-code-statusline-asset.test.ts` 5（以 node 执行资产的标签与退化输入、绑定目录字面量等于内核布局、两条维护操作）、`tests/governance/demand/demand-research-completion.test.ts` 8（路由、控制器路由与内核投影、聚合完成三例、verify 门、经公共 executor 的完成即归档）。改写：Claude 维护执行与入口（宿主操作 5）、聚合状态两条 completed 断言、场景骨架。场景 `card-09/status-and-verify` 与 `card-09/active-projection` 接线，18 场景全部 pass（断言见 scenario-acceptance.md）。

**门。** `npm test` 全绿：typecheck、架构规则（658 模块、10 生产根、无环）、Biome lint 与 format、knip、TypeScript 测试 880 项、Schema 漂移检查（95 份）；`git diff --check` 干净；改动文件不含本地绝对路径与会话标识。Claude 宿主真实会话未运行（按 CLAUDE.md 记为未验证）。

**度量。** 公共工具 19 → 20；wire Schema 93 → 95；场景 16 → 18；测试 851 → 880；架构门 640 → 658 模块；相对 `779a40e`：已跟踪文件 81 个 +1,519 / −4,425，删除 15 个文件 3,749 行（`src/workspace/active/` 8 文件与其 3 份测试、路由工具两份 Schema 与两份生成类型），新增未跟踪 34 个条目 12,246 行（源码 8,725、测试 3,521）。

**过程。** ultra 模式按 13.95 的纪律执行：三个构建代理共用一个工作树、文件所有权互斥、所有编译与测试经 `mkdir` 锁串行；三个怀疑审阅者只读。有效发现：D5 指纹绑定 overall 与看板、D2 的 HEAD 代理、`strayJournals` 吞错、`primaryCheckouts` 混淆、research 完成的三处残余、场景把偏差断言成 pass、一处同义反复断言、Markdown 行格式耦合。教训两条：`check:architecture` 也会 `tsc -b tooling`，必须与其他构建命令一样经锁串行（本段一次未经锁运行与测试构建并发，结果经重跑核实无误）；代理各自的临时 tsconfig 只能用于诊断，最终计数必须来自仓库自己的 runner。

**残余。** 内核投影锁争用测试要等满 10 秒获取超时（约 12 秒）；research 完成夹具每例 4 到 10 秒；L2 的"治理测试墙钟低于 3 分钟"退出门要在场景联合时复核。D9 的 hook 观察脚本与两宿主 hook 配置片段是 L2 第一项（plan §8.1 已改）。`developer-progress.md` 的最近十条事件、`config.valueSources`、阈值配置化都留 L2 视场景再开。

### 13.97 L2 第 1 项：hook 观察脚本与两宿主 hook 配置片段设计定案（2026-09-18，经三名怀疑审阅者攻击后修订）

L2 的第一项（13.94 D9，plan §8.1 L2 行）。依据 ADR-0009 调整一（宿主 hook 作为第二条证据通道）、其两条未决项（记录保留与清理；`recordedAt` 与重试幂等边界）、内核 `src/kernel/hook-observations.ts` 现有的记录合同，以及 2026-09-18 从两宿主官方文档重新核对的 hook 事实。初稿经三名只读审阅者从宿主事实、内核与架构一致性、可测性与隐私三个角度攻击，被证实的意见已并入（cwd 随 `cd` 移动、异步 hook 会被取消、提示摘要函数住在治理层、placement 语法无上限、外部检出找不到根、按数量修剪会丢证据并与读取竞态、死通道不可见、失败路径未测、real-host 项不全）；未被证实的不采纳。本节先定案，用户确认后按 13.96 的方式实现。

**核对到的宿主事实（决定形状的部分）。** 两宿主都有生命周期 hook，事件名一致：`SessionStart`、`UserPromptSubmit`、`Stop`、`SessionEnd`；每个 command hook 从 stdin 收到一个 JSON 对象，公共字段 `session_id`、`cwd`、`transcript_path`、`hook_event_name`；`UserPromptSubmit` 带 `prompt`，`Stop` 带 `last_assistant_message`，Codex 的回合事件带 `turn_id`，Claude 自 v2.1.196 起带 `prompt_id`（首次输入前缺席）。插件都能自带 `hooks/hooks.json`（Claude `${CLAUDE_PLUGIN_ROOT}`，Codex `${PLUGIN_ROOT}` 并兼容 `CLAUDE_PLUGIN_ROOT`），格式相同，四个事件都允许插件注册。hook 在会话**当前目录**运行，`cwd` 随 Agent 的 `cd` 移动，不钉在窗口根；Claude 另给 `CLAUDE_PROJECT_DIR`（会话启动的项目根，进 worktree 也不变）。退出码：两宿主的 `UserPromptSubmit` 与 `Stop` 以退出码 2 阻断（前者吞掉提示，后者不让它停），`SessionStart` 与 `SessionEnd` 的退出码不能阻断（Codex 的 `SessionStart(compact)` 仍可用 JSON `continue: false` 结束回合，本脚本不产生任何 stdout，所以无关）；Claude 把 `SessionStart` 与 `UserPromptSubmit` 的纯文本 stdout 注入上下文，Codex 的 `Stop` 视纯文本 stdout 为非法。被打断的回合不触发 `Stop`（Claude 的 API 错误触发 `StopFailure`，Codex 另有 `Interrupt`）。`SessionEnd` 在 Claude 共用 1.5 秒预算且插件 hook 的 `timeout` 不能抬高它，在 Codex 默认 1 秒、上限 3 秒、永远同步；Codex 的 `SessionEnd` 只在归档、删除、正常退出或空闲 30 分钟后触发，切换会话不触发。两宿主的 command hook 都支持 `async: true`（不能阻断，结果延到下一回合），但 Codex 在会话结束时取消未完成的后台 hook 并丢弃输出，每会话最多 8 个并发；Claude 在 `-p` 模式收尾时杀掉仍在运行的异步 hook。Codex 的插件 hook 必须由用户在 `/hooks` 里按定义哈希审阅信任后才运行，定义字节一变就要重新信任；`notify` 只能写在用户级 `~/.codex/config.toml`，插件不能自带。Codex hook 的 `session_id` 是会话树根的标识，只对 `create_thread` 直接创建的根线程等于线程标识，分叉线程沿用根的。Claude 的 `--worktree` 会话结束时若检出干净会自动删除检出与分支。旧 JavaScript 制品从未发过任何 hook。

**范围。** 一个宿主可执行的观察脚本（entrypoint）、两宿主的 hook 配置片段（制品级静态文件）、内核写入器与读取器的硬化（毫秒精度、按龄保留、消失文件不计 skipped、目录上限）、提示摘要规则下沉内核、配置 placement 语法收紧、制品构建器的第二个 launcher 与 hooks 文件、验证门的死通道提示、验收测试。不做：真实宿主会话（由用户在两宿主各跑一次，记未验证直到跑过）、L3 其余打包产物、`notify`。

**切片形状。** `src/entrypoints/wakeflow-hook-observer.ts`（进程入口与纯函数入口）；`src/hosts/claude-code/claude-code-hook-fragment.ts` 与 `src/hosts/codex/codex-hook-fragment.ts`（纯数据加确定性渲染与摘要，登记为显式生产根）；内核 `hook-observations.ts` 增加精度校验、按龄修剪与消失容忍，新增 `src/kernel/prompt-digest.ts`；`tooling/artifacts/build-typescript-artifact-candidates.ts` 增加 launcher 与 hooks 文件；三张准入清单（entrypoints tsconfig、knip entry、架构门 `ADMITTED_PRODUCTION_ROOTS`）登记新入口与两份片段。

- D1 脚本形态。建议做成编译的 entrypoint 而不是状态栏那样的字符串资产：导出 `runWakeflowHookObserver({argv, env, stdin, stdout, stderr, clock})`（纯函数入口，测试与场景在进程内调用）与 `main()`；制品 launcher `hooks/observe.mjs`（`#!/usr/bin/env node`，在 try/catch 里动态 `import("../lib/entrypoints/wakeflow-hook-observer.js")` 并调 `main()`，`process.exitCode = 0`，登记 `uncaughtException` 与 `unhandledRejection` 守卫，任何失败只打一行固定代码——静态 import 的失败会打出带绝对路径的堆栈并以 1 退出，被 Claude 显示给用户）；写入只用内核 `writeHostHookObservation`（13.75"hook 脚本与测试都用同一写入函数"）；闭包限于 foundation 与 kernel（`hook-observations`、`layout`、`prompt-digest`），配置只结构化读取 `topology.repositories[].path` 与 `topology.supportSurfaces[].path` 两个数组（与状态栏资产同一做法，不加载配置校验器——`parseWakeflowConfigV3` 在模块加载时编译 Ajv，每次 hook 都要付这份代价），不进 configuration、governance、capabilities 与任一 hosts 目录。argv 固定 `--wakeflow-hook-observer-v1 --host <codex | claude-code>`：缺标记或宿主不识别即退出 0 不写；`--host` 只供给写进记录的 `hostId`，字段映射在两宿主间完全同形（D3），共享代码里没有按宿主分支。备选：字符串资产按工作区安装——hook 配置是插件级的、命令里带不了工作区根，且脚本要么复制内核写入器，要么失去"同一写入函数"。
- D2 工作区根的定位（本片最硬的一条）。hook 配置是插件级静态文件，命令里没有工作区根（与状态栏不同）；`cwd` 是会话当前目录，会随 `cd` 移到窗口根的子目录；产品窗口的根是兄弟仓库（配置 `topology.repositories[].path` 形如 `../ProductA`）；worktree pod 的产品窗口在宿主自选的检出路径，可能在任何卷上。建议按**声明拓扑查找加包含匹配**：(a) 锚点集合 = `cwd`（`cwd` 已不存在时改用 `CLAUDE_PROJECT_DIR`，Claude 在会话结束删除干净的 worktree 后仍会触发 `SessionEnd`）；从 `cwd` 向上找到最近的 `.git`，若它是文件（`gitdir: <主仓库>/.git/worktrees/<name>`，只读指针文件，不 spawn git），主仓库根也进锚点集合。(b) 候选根 = 每个锚点及其至多 8 级祖先里含 `wakeflow.config.json` 的目录，加上每个祖先的直接子目录里含 `wakeflow.config.json` 的目录（每目录至多列 1,024 项、只看真实目录、不跟随符号链接）。(c) 每个候选按它自己的配置核对：`realpath(cwd)` 等于或位于根、某个支持面、某个仓库的 realpath 之下，或位于主仓库为声明仓库的 worktree 检出之下；核对通过的每个工作区写一条记录，一个都不通过即退出 0 不写——插件启用后 hook 对机器上每个会话都触发，非 Wakeflow 会话必须静默且便宜（至多 8 次 readdir 加每个子目录一次 stat，不加载任何校验器）。(d) 扇出只对 `session-start`：`user-prompt-submit`、`stop`、`session-end` 只写进绑定目录（`hosts/<host>/identity/window-bindings/*.json`，结构化读取，与状态栏同一做法）里已有该 `session_id` 句柄的工作区，避免一个仓库被两个工作区声明时把 A 的会话标识与工作目录写进 B 的私有存储；登记发生在 `session-start` 之后、投递之前，所以后三类事件时绑定已在。(e) 语法收紧：`repositories[].path` 与 `supportSurfaces[].path` 至多一个前导 `..`（Schema 与解析器同步，带回归测试）——(b) 的"祖先或祖先的直接子目录"只在这个前提下成立；两级 `..` 会让工作区成为祖先的孙目录而永远找不到。这不是"从 cwd 推断根"：配置自己声明了 cwd 与根的关系，查找只是找出声明者。登记时的准入不变：端点仍要求 `session-start` 的 `cwd` 等于窗口根（realpath 相等），会话启动时的 cwd 就是启动目录，与包含匹配不冲突。备选 A：用宿主插件数据目录（`CLAUDE_PLUGIN_DATA` / `PLUGIN_DATA`）维护工作区登记表——引入机器本地可变状态与过期条目，且开发态检出没有该目录；备选 B：Claude 经启动命令注入环境变量——Codex 的 `create_thread` 没有逐线程环境，两宿主分叉。
- D3 事件与字段映射。两宿主同名、同形：`SessionStart`（全部 `source`，含 resume、compact，重复的 session-start 无害）→ `session-start`；`UserPromptSubmit` → `user-prompt-submit`，`promptDigest = computePromptDigest(prompt)`（内核 `prompt-digest.ts`：trim 后 UTF-8 sha256，空或超过 65,536 字符时为 null，记录照写；`governance/delivery/delivery-envelope.ts` 的 `computeDeliveryPromptDigest` 改为调用它并在 null 时照旧抛错，投递侧字节不变）；`Stop` → `stop`，`lastAssistantMessageDigest` 为 `last_assistant_message` 字符串的 UTF-8 sha256（缺席为 null）；`SessionEnd` → `session-end`。公共：`sessionId = session_id`（Claude 会话 uuid 即绑定句柄；Codex 的 `session_id` 是会话树根标识，只对 `create_thread` 直接创建的根线程等于登记的线程句柄——分叉线程不是 Wakeflow 的窗口，真实宿主要核的第一项就是这个相等）；`cwd` 原样；`turnId = turn_id ?? prompt_id`（宿主无关地读，缺席为 null）；`transcriptRef = transcript_path`（字符串则记，私有记录允许绝对路径）；`recordedAt` 由脚本本地时钟给出 ISO 毫秒形（ADR-0009 未决项"重试幂等边界"就此关闭：宿主不重试 hook，同一处理器被插件与用户设置各注册一次时会得到两条时间不同的记录，消费者取首条匹配，无害）。未知 `hook_event_name` 退出 0 不写。记录的语义边界写进模块注释与卡 2：被打断或 API 失败的回合没有 `stop` 记录，消费者本就把缺席当 pending；Codex 的 `session-end` 最迟滞后 30 分钟，不是活性信号。`turn-complete` 留在词汇表：它是 Codex `notify` 的映射，插件发不了 `notify`，本片不产生；删除会改评审决定事件数据的 Schema，不值。
- D4 失败与输出策略。永远退出 0；stdout 永远为空；stderr 只在异常时打一行固定代码 `wakeflow-hook-observer: <code>`（`stdin-invalid`、`stdin-too-large`、`write-failed` 等闭集），不含路径、句柄与提示正文（Claude 退出 0 时 stderr 只进调试日志）；stdin 上限 4 MiB（投递提示本身不超过 65,536 字符），超限、非 JSON、缺字段都退出 0 不写；某个候选的配置读不出只跳过该候选；一个工作区写失败不影响其他工作区；目标墙钟 200 毫秒内（不加载 Ajv 是前提）。
- D5 同步与异步。`SessionStart` 同步、timeout 5 秒（登记紧随其后，且 Claude 首次响应本就等它）；`UserPromptSubmit` 用 `async: true`（只观察不控制，不给机器上每个会话的每次提示加 node 启动延迟；消费者本就惰性重查——13.83 D3；用户提交后立即关窗的竞态可忽略，投递本身也会失败）；`Stop` **同步**、timeout 5 秒——它是结果接受的完成证据（13.87 D2），而异步 hook 在会话结束时会被 Codex 取消、被 Claude 的 `-p` 收尾杀掉，"回合结束随即归档或关窗"是真实路径，脚本本身在 200 毫秒内结束，同步代价可忽略；`SessionEnd` 同步、两宿主都设 timeout 3（Claude 的插件 hook 抬不高 1.5 秒预算，靠脚本快）。备选：全异步——最后一条 `stop` 不保证落地。
- D6 两宿主配置片段。制品根的静态 `hooks/hooks.json`，由构建器从宿主数据模块渲染：Claude 用 exec 形式 `{"type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/observe.mjs", "--wakeflow-hook-observer-v1", "--host", "claude-code"]}`（不经 shell，占位符在 args 里同样展开）；Codex 用命令串 `node "${PLUGIN_ROOT}/hooks/observe.mjs" --wakeflow-hook-observer-v1 --host codex`（Codex 只有命令串形式）；四个事件都不设 matcher；Codex 用默认位置，不改插件清单。渲染结果必须跨版本字节稳定（只含占位符，不含版本号或构建标识）：Codex 的信任按定义哈希记录，字节一变四个 hook 就被跳过直到重新信任。`node` 在 PATH 上是与 `.mcp.json` 同一假设。宿主差异只进 `src/hosts/<host>/<host>-hook-fragment.ts`（TSD-12），不给资源 profile 加 `hooks` surface——精确字段解析器与静态矩阵摘要联动，现有工作区对账会报差异。Codex 的信任门（用户在 `/hooks` 审阅）与 Claude 的工作区信任对话是宿主侧动作，写进 L3 的 README 与 skills，本片只在记录里注明。
- D7 内核硬化与保留策略（ADR-0009 未决项"保留与清理"就此关闭；这是 Wakeflow 第一条自动 unlink 路径，记在案）。(a) `createHostHookObservation` 要求 `recordedAt` 恰好 3 位小数秒——文件名模式要求 9 位数字，其他精度的记录写得进去却永远读不出、只计入 `skipped`，把工作区拖成 degraded。(b) 只按龄修剪、不设数量上限：写入器在成功写入后 unlink 同一宿主目录里早于 30 天（`HOST_HOOK_RETENTION_MILLISECONDS`）的记录文件；只动符合记录命名的文件，无法识别的条目留给 verify 的门；修剪路径的目录列举上限 65,536，让超限后仍能恢复；修剪失败吞掉（记录已写成）。按数量修剪被否决：它让证据集合取决于机器整体活动而不是本工作区的历史，且与读取器竞态。(c) 读取器把"列举后读取时已不存在"当作消失而不是 `skipped`（异步 hook 与 status 并发时不再有伪失败）；hooks 目录的列举上限从 4,096 提到 16,384（每回合两条记录，30 天内活跃工作区会越过 4,096）。(d) 端点的 `session-start` / `session-end` 读取改用 `limit: 16384`（观察域已是上限读取），让保留策略而不是读取上限决定可见集合——现在 256 条之后的新会话对登记不可见。(e) status 的 `policy` 段加保留天数。损失边界（写进 D3 的语义边界）：任何消费者都只在有界窗口内读记录——登记与换代读新句柄当下的 `session-start`，退役读当前绑定的 `session-end`，投递静默 10 分钟后 rearm，结果接受取 `reportedAt` 之后的**首条** `stop`，所以 30 天未评审的结果只需目标窗口再跑一轮就重新有完成证据；事后再以被修剪的记录登记受管证据会被 `source` 拒绝，已登记的不受影响。备选：不保留——数周后通道整体失效；或由 `wakeflow_maintain_workspace reconcile` 清理——能力卡 1 Q7 定了对账只报告不删除。
- D8 制品构建器。候选定义从单一 `entrypoint` 改为 `launchers[]`：`mcp/server.mjs`（原样）与 `hooks/observe.mjs`；闭包取两个根的并集（按路径去重，`writeExclusive` 只写一次）；`hooks/hooks.json` 由构建器在运行时动态 `import(pathToFileURL(<compiledRoot>/hosts/<host>/<host>-hook-fragment.js))` 取片段渲染（tooling 对编译产物没有静态类型边，架构门看不见也不需要看见）；两份片段模块登记为显式生产根（只有 tooling 消费）；清单增加 `runtimeEntrypoints[]` 与 hooks 文件条目（`runtimeEntrypoint` 保留指向 MCP）；隔离规则不变，观察脚本闭包必须全是 shared 范围（断言）。制品测试对每个候选 spawn `hooks/observe.mjs`，喂该宿主的 `SessionStart` payload 到临时工作区，断言记录落地、stdout 空、stderr 空；再喂一个观察目录被文件顶替的工作区，断言退出 0、stdout 空、stderr 恰好一行固定代码且不含路径。
- D9 验收。`tests/entrypoints/wakeflow-hook-observer.test.ts`：进程内 `runWakeflowHookObserver` 覆盖逻辑，spawn 编译后的入口覆盖进程合同；两宿主 × 四事件的 payload；窗口位置：根、支持面、兄弟仓库、仓库的子目录（`cd` 之后）、嵌套在仓库里的检出（`<repo>/.claude/worktrees/<name>`，真实 `git worktree add`）、仓库之外的检出（经 `gitdir` 指针找回主仓库）、检出的子目录；`cwd` 已删除时经 `CLAUDE_PROJECT_DIR` 落地 `session-end`；扇出：`session-start` 写进两个声明同一仓库的工作区，`user-prompt-submit` 只写进持有该句柄绑定的那个；非 Wakeflow 的 cwd 不写；非法 JSON、超限 stdin、缺标记、未知宿主、未知事件都退出 0、stdout 空、无写入；写失败（观察目录被文件顶替）退出 0、stdout 空、stderr 恰好一行固定代码且不含 [根、cwd、句柄、提示、transcript 路径]；`promptDigest` 等于 `computeDeliveryPromptDigest`（同一内核函数）；写出的记录能被 `readHostHookObservations` 读回且 `skipped: 0`。内核测试：毫秒精度拒绝、按龄修剪、修剪与读取并发时 `skipped: 0`、超过 16,384 条时修剪仍能恢复。配置测试：两级 `..` 的 placement 被拒。场景骨架：两个代宿主写记录的辅助函数（`recordSessionStart`、`recordSessionEvent`）改为用 Codex payload 调用 `runWakeflowHookObserver`，worktree 窗口的提示与结束事件以 `state.pod.checkout` 为 cwd，18 个场景因此顺带证明 Codex 映射端到端；不新增场景编号。真实宿主（用户把候选制品作为本地插件装进两宿主各跑一次，Codex 先在 `/hooks` 信任）要核的八项：Codex hook 的 `session_id` 等于登记的线程句柄；`SessionStart` 的 `cwd` 等于窗口根（`--worktree` 会话等于检出路径）；目标会话 `cd` 到子目录后 `UserPromptSubmit` 与 `Stop` 仍落地；`prompt` 经 trim 后与投递渲染逐字相等；异步的 `UserPromptSubmit` 在 `record_delivery_outcome` 之前落地；`Stop` 之后立即归档或关窗时 `stop` 记录仍在；`--worktree` 会话结束、检出被自动删除时 `session-end` 仍落地；插件更新后 `/hooks` 里没有待审阅的 Wakeflow hook。跑过之前记"已实现、宿主未验证"。
- D10 文档与门。ADR-0009 未决两项关闭并加落地记录；plan §8.1 L2 行的**退出门**列加入"两宿主各完成一次真实投递并交回 hook 证据"（原文只在"主要工作"列），第一项标为"已实现、宿主未验证"而不是完成；能力映射矩阵 §3 宿主差异的 hook 行改为已落地；verify 的 `host-hook-channel` 门在目录缺席或零记录时仍 pass 但 code 报 `absent` / `records:0`（与 `window-identity` 报未登记计数同一模式），让"hook 从未触发"（Codex 未信任、`node` 不在 PATH、cwd 匹配失败）在 verify 里可见，而不是只在登记时以 `hook-evidence-missing` 暴露；gate-log 13.98 实现记录。

**度量目标。** 新增约 1,500 行（入口约 450、片段约 150、构建器约 180、内核约 200、配置约 20、测试约 500）；测试 880 → 约 900；制品各多两个文件 `hooks/hooks.json`、`hooks/observe.mjs`；`tools/list` 不变。

**待用户确认的项。** D2（声明拓扑查找加包含匹配，placement 至多一个前导 `..`，后三类事件只写进持有绑定的工作区）、D5（提示异步，回合结束同步）、D7（只按龄保留 30 天、目录上限 16,384、第一条自动 unlink 路径）、D6（不给资源 profile 加 surface）、D3 里保留 `turn-complete` 五项是取舍；D1、D4、D8、D9、D10 是按既有边界落地的形状选择。回复"确认 继续"即按建议列执行；对某项另有选择则指出编号。

### 13.98 L2 第 1 项：hook 观察脚本落地，并把两轮怀疑审阅的 19 条缺陷收口（2026-09-18）

按 13.97 十项裁决实现，同时用空出来的并发对刚提交的 L1 observation 切片（`1480271`）做了一次对抗式复审。两件事在同一工作树里并行推进：四个实现桶按 13.97 落地，五条只读审阅视角从不同角度攻击切片 10 与本片，每条发现再由一个裁决者逐条反驳。共 24 条发现，裁决为真 19 条并全部收口，3 条被驳回（维护路径没有可传入的 AbortSignal、research 带未接受目标的状态在能力层不可达、`__proto__` 键在上游解析时已被丢弃），1 条是文档缺口（见"裁决修订"D4），1 条由本节记录为已知残余。

**落地（按 13.97 的裁决编号，只记与裁决不同或裁决未写之处）。**

- D1：入口按合同落地 `runWakeflowHookObserver`（纯函数，不碰 `process.*`、不写 stdout、不抛）与 `main()`。守卫只在一处登记：`main()` 里的 `registerProcessGuards()` 幂等，制品 launcher 在成功交接前撤掉自己的守卫，所以一次进程级故障只打一行。裁决原文说 launcher 自己登记守卫，改为这个分工是因为两边都登记会打两行。
- D2：按声明拓扑查找加包含匹配落地。与裁决不同的两点：锚点自身的直接子目录不再单独列举（工作区不可能包含自己的锚点，锚点本身仍查 `wakeflow.config.json`），目录列举超过上限时保留已收集的名字而不是整份丢弃——后者会让一个大父目录下的工作区永久隐形且无痕迹。配置读取额外要求 `kind` 与 `schemaVersion` 与状态栏资产一致。
- D3：字段映射按裁决落地，并且可选字段越界时降级为 null 而不是丢掉整条记录（`turn_id` 带空格、`transcript_path` 超长都不该让一次投递失去落地证据）。
- D4：stderr 词表比裁决的闭集宽两个进程级码（`internal`、`launcher`），已单独导出并写进注释，L3 的 README 与 verify 门文本按这一份词表写。
- D5、D6：按裁决落地。片段渲染字节跨版本稳定，构建器写出前用片段自己导出的摘要复核，不一致以稳定错误码 `wakeflow-artifact-hook-fragment-digest` 失败。
- D7：(a) 到 (e) 全部落地，并加两条裁决未写的收窄：修剪只在 `created` 之后跑（`current` 什么都没落地，没有必要每次 hook 都列举目录），修剪截止时间取 `min(目录里其它记录的最新时刻, 本次记录时刻)`——否则一次时钟跑偏到未来的写入会把 30 天的损失边界一次性越过。`records:0` 的门码实际形状是 `records-0`，与既有的 `skipped-<n>` 同一风格。
- D8：按裁决落地。`hooks/observe.mjs` 的清单范围标为 `entrypoint`（它是第二个 launcher），`hooks/hooks.json` 标为 `metadata`。
- D9、D10：按裁决落地。场景骨架的三个代宿主写记录处全部改为调用观察脚本，18 条场景全过。

**裁决修订（审阅证实后改的既有决定）。**

- §13.94 D4 `observationDigest`：裁决说它是观察记录的规范 JSON 摘要，实现是十三门结果的摘要，两者不等价——门结果相同而工作区已经变化时摘要不变。本次不改实现（没有消费者把它当作"同一份观察"的凭据），改裁决措辞：它是**门结果**的摘要，Demand 段的同名字段同理。要恢复裁决原意需要给观察记录定一份稳定投影，留 L2。
- §13.94 D5 投影指纹的"本地运行时"清单漏了 worktree 检出是否存在。它是工作区之外的一次 `stat`，没有任何 Wakeflow 变更控制它，外部 `git worktree remove` 会让投影永久 stale 且没有变更能修复。现在它在投影作用域里被归一，投影只认回执有没有；`wakeflow_status` 仍报实时的 present / checkout-missing。
- §13.94 D5 的退休规则"不在事实里的 Demand 页面目录"改为需要正面证据：观察域与其中每个 Demand 都读得出才允许退休，否则一个页面目录都不删。原规则把"这一轮读不出"当成"已不活动"，一次 EACCES 或越过列举上限就会删光活动 Demand 的页面。
- §13.94 D5 的静默刷新"只吞 io-failure"改为"吞掉已归类的 Wakeflow 失败，`unexpected`、中止与非 Wakeflow 错误上抛"。原规则让 `precondition-failed`（例如 ledger 根一时不在）否定一次已经提交的事件；新规则保留 `unexpected` 上抛，编程错误不会被静默。
- §13.94 D3 `pod-execution-location` 门：`creating` 的 worktree pod 缺回执改为 pass 加 `pending-registration`，fail 留给 `ready` 与 `closing`。裁决本就把回执要求限定在 ready，而原实现让刚创建的 pod 报 fail 并把下一步指向维护——维护修不了它，登记才能。
- §13.97 D2 的列举上限语义：超限保留已收集的名字，不整份丢弃（理由同 D1 段）。

**审阅收口的十九条。** 观察能力十条：截断收尾串 `+<n>` 不在 wire 的 `code` 字符集里，门一多码就让整次 `wakeflow_verify` 变成错误信封；分支名按 git 的 ref 文法收，`release/2.0+hotfix` 这类合法分支不再让整次 `wakeflow_status` 被拒；活动投影门的证据只收两份工作区页，32 个以上活动 Demand 不再越过证据上限；域读不出时的空列表不再被当成事实（五个门改报 unavailable，看板的交叉核对跳过）；活动但读不出的 Demand 在两个工具里都不再被报成"不存在"；status 增加 `domains` 段报出四个域各自的状态与 issue；pods 域读不出时不再把所有未登记窗口当成活动 pod 的登记动作；七个有 wire 上限的数组全部确定性排序后截断并在 `truncated` 各自报出略去条数；verify 加读阶段的中止收敛为 `io-failure/aborted`。内核与治理六条：修剪截止时间的钳制；归档清单读取补齐错误映射；处置引导清控制字符并在 512 字符处截断；退休需要正面证据；检出存在性移出投影作用域；静默刷新的吞吐范围。宿主三条：状态栏资产读不出改为维护贡献的 blocker 而不是让整个预览崩掉；`settings.local.json` 有文件但没有 statusLine 键时报 `missing` 而不是 `unreadable`（正常的未安装状态曾被报成通道不可用）；资产模块里"由 Agent 安装 settings 条目"的过时注释改为指向真正的维护操作。

**验收。** 新增测试文件 7 个：`tests/entrypoints/wakeflow-hook-observer.test.ts`（13）、`tests/kernel/prompt-digest.test.ts`（2）、`tests/hosts/{codex,claude-code}/*-hook-fragment.test.ts`（各 5）、`tests/governance/observation/{active-projection-facts,demand-archive-locator}.test.ts`（3、4）、`tests/governance/pod/worktree-disposal.test.ts`（4）。改写与扩充：内核 hook 记录（7）、配置 placement（8）、观察 decide（11）与 service（12）、Claude 维护执行（5）、制品候选（5）、场景骨架（18 条场景全过，99 秒）。

**门。** `npm test` 全绿：typecheck、架构规则（669 模块、13 生产根、无环）、Biome lint 与 format、knip、TypeScript 测试 {TESTS} 项、Schema 漂移检查（95 份）；`git diff --check` 干净；改动文件不含本地绝对路径与会话标识。**真实宿主会话未运行**：13.97 D9 的八项要用户把候选制品装进两宿主各跑一次（Codex 需先在 `/hooks` 信任），跑过之前本片记"已实现、宿主未验证"，plan §8.1 的 L2 退出门已按此改写。

**架构图谱。** 同一轮把 `wakeflow-architecture-atlas` 从 `7ba1f38` 刷到 `1480271`：新增 `maps/16-observation/` 三页（结构、文件依赖、三张运行时序列图），订正 01、09、11、15 四组图与账本。审阅发现测试列有五个锚点在 `tests/` 里根本不存在，而图谱自己的校验器从不交叉检查测试列——锚点已订正，校验器补上了测试列交叉检查（新专题三页开启严格模式，47 处测试符号被真正校验）。已知缺口：全图谱 495 行证据里仍有 450 行只写测试文件名不写符号，严格模式是逐文档开启的。图谱的 `npm run check` 目前退出码 1，唯一原因是并行任务持续改动 `src/` 与 `tests/` 让 49 份来源指纹漂移，本轮不刷新摘要绕过门。

**测试墙钟。** L2 退出门要求治理测试墙钟低于 3 分钟，实测 280 秒，已按夹具与运行器实测出成本模型：最慢的 `tests/capabilities/result-review/service.test.ts` 单文件 178 秒就已超门；fsync 在本机是 4.6 毫秒一次、整条原子写 9.2 毫秒，一次重夹具构建 81 到 176 次 fsync。可回收约 160 秒的有序计划：运行器按时长倒序调度并显式设并发（约 90 秒）、快照层三处热点（23 秒）、共享预置工作区按需复制（16.5 秒，plan §11 本就这么要求）、治理夹具选 `none` 持久化（20.6 秒）、Ajv 校验器跨用例复用（8.4 秒）、投影锁超时可注入（1.3 秒）。本片不动，留作 L2 的独立一项。

**度量。** 新增未跟踪文件 11 个（源码 4、测试 7）；相对 `1480271` 已跟踪改动 51 个文件（不含图谱），图谱 60 个文件；wire Schema 仍 95 份；公共工具仍 20 个（观察脚本是 entrypoint，不是 MCP 工具）；架构门 658 → 669 模块、10 → 13 生产根（入口一个、两份宿主片段各一个）。

**过程。** 并发上限由用户于本日解除，纪律不变：共用一个工作树、文件所有权互斥、所有编译与测试经一把 `mkdir` 锁串行。本轮同时跑到 10 个代理。两次工作流因代理停滞被中止，原因都是单次命令太长（一个内核测试写 16,384 条过期记录，修剪要做同样多次精确 unlink，单文件 112 秒；场景文件 3,300 行被整读）。锁脚本因此改为有界等待并周期性打印进度，超时以 75 退出让调用方重试；任务文本也改为"每次命令控制在 90 秒内、不整读大文件"。教训：审阅者的 `approved: false` 必须逐条核对再决定，本轮 24 条里有 3 条经核对不成立；代理报告的计数要以仓库自己的 runner 为准。

**残余。** 时钟持续跑偏的宿主仍按它自己的时间线修剪（钳制只挡住单次未来写入）；`readHostHookObservationsInterleaved` 是为并发不变量留的内核测试缝，没有生产调用方；图谱来源指纹与 495 行证据的符号覆盖；测试墙钟计划；真实宿主八项核对。

### 13.99 L2 第 2 项：skills 与 commands 文本按新公共面重写（设计定案）

L2 的第二项（plan §8.1 L2 行"skills 与 commands 文本随场景重写"）。依据 [ADR-0002](../decisions/0002-public-tool-surface.md)（公共工具面按单一 owner 重切，后果表写明"旧 skills 与 commands 文本在 E4 制品阶段随新面重写"）、[ADR-0006](../decisions/0006-legacy-capability-retention.md)（`view` 维持放弃、legacy 迁移放弃、窗口租约与 `replace_windows` 重切）、[ADR-0013](../decisions/0013-target-architecture-and-slice-plan.md)（六层与 20 个公共工具）、TSD-12（宿主差异只进 hosts profile 数据与 skills 文本）、[需求总览 §3 主流程](../requirements/wakeflow-functions-and-scenarios.md)与[场景验收清单](../references/scenario-acceptance.md)的 18 条已接线场景，以及 13.94 D6 与 13.97 D6、D10 留给 README 与 skills 的两个宿主信任步骤。本节先定案，用户确认后按 13.98 的方式实现。

**核对到的现状（决定形状的部分）。** 旧文本面共三处：两份制品各 30 份技能 Markdown（`plugins/codex-wakeflow/skills/` 4,267 行、`plugins/claude-code-wakeflow/skills/` 4,334 行，两树 11 份文件已分叉，分叉内容全是几句宿主差异）、7 个 Claude 命令（`plugins/claude-code-wakeflow/commands/` 共 201 行）、四份 README（2,221 行）。技能是六份：`wakeflow-controller`（583 行）、`wakeflow-design`（108）、`wakeflow-governance`（176）、`wakeflow-target`（184）、`wakeflow-target-craft`（271）、`wakeflow-test`（152），另有 `references/` 与 `assets/` 若干（最大一份 667 行）。这三处点名的 `wakeflow_*` 工具记号各自都是 31 个，且是同一个集合；其中只有 9 个在今天的目录里存在（`maintain_workspace`、`create_demand`、`complete_demand`、`cancel_demand`、`continue_demand`、`prepare_delivery`、`record_evidence`、`status`、`verify`），另外 22 个已随旧体系消失（`wakeflow_view` 按 ADR-0006 放弃却仍被 `commands/check.md` 教；`wakeflow_deliver` 按 TSD-12 放弃；`wakeflow_pod_open/bind/plan/record` 四件被 `wakeflow_pod` 一件取代；`wakeflow_next_work`、`wakeflow_claim_next`、`wakeflow_add_task`、`wakeflow_review_pack`、`wakeflow_decide_review`、`wakeflow_record_target_result`、`wakeflow_reduce_results`、`wakeflow_intake_test_card`、`wakeflow_archive`、`wakeflow_storage_preserve`、`wakeflow_prune_runtime`、`wakeflow_replace_windows`、`wakeflow_release_window_lock`、`wakeflow_register_window`、`wakeflow_record_delivery`、`wakeflow_recover_state_transition` 等）。反向缺口更大：20 个在册工具里有 11 个在任何文本里都没有被教过（`register_window_binding`、`publish_requirement`、`inspect_board`、`plan_target_task`、`record_delivery_outcome`、`rearm_delivery`、`import_target_result`、`inspect_target_result_review`、`record_implementation_review_decision`、`record_test_review_decision`、`pod`）。代码已经点名技能路径：`src/capabilities/delivery/decide.ts` 的 `DELIVERY_REQUIRED_SKILLS` 把 `skills/wakeflow-target/SKILL.md` 与 `skills/wakeflow-target-craft/SKILL.md` 写进投递 prompt，技能改名即改这条常量。README 两份都没有 Codex 的 `/hooks` 信任步骤与 Claude 的工作区信任对话。

**范围。** 一份 agent 面文本源（四个技能、其 references、四个 Claude 命令、两语言 README）、每宿主一份文本取值模块、制品构建器的渲染与清单条目、一份诚实性检查测试、`DELIVERY_REQUIRED_SKILLS` 随技能集合收缩的一行改动、三处文档回写。不做：删除旧制品树（属于 L3 原子切换）、真实宿主会话验证（13.97 D9 的八项仍未验证）、模板与宿主记忆文件（L3 打包）、任何公共工具形状变更。

**形状。** 源目录 `assets/agent-text/`（仓库相对，纯 Markdown，不出现宿主名）；取值 `src/hosts/<host>/<host>-agent-text-profile.ts`（纯数据加确定性渲染，与 `<host>-hook-fragment.ts` 同一模式，登记为显式生产根，只有 tooling 消费）；渲染在 `tooling/artifacts/build-typescript-artifact-candidates.ts`；检查在 `tests/artifacts/`。共享代码里没有一处按宿主分支。

- D1 技能按窗口角色切成四份，深度内容下沉 `references/`。建议保留 `wakeflow-controller`、`wakeflow-design`、`wakeflow-target`、`wakeflow-test` 四个目录，每份 `SKILL.md` 只写立即目标、边界期望、阅读顺序、身份与返回指针；`wakeflow-governance` 的工作区初始化与维护步骤并入 controller（主流程第 0、1 步就发生在 Controller 窗口），其余章节（`AGENTS.md` 分层、TODO 收口、脚本流水线、阶段路由图）随旧体系一起放弃；`wakeflow-target-craft` 的方法内容降级为 `skills/wakeflow-target/references/craft.md`，按需加载。理由：Wakeflow 只登记四种窗口角色（`controller | design | test | product`，见 `src/contracts/generated/workspace/window-runtime-*-projection.generated.ts`），技能集合与角色集合一一对应，投递 prompt 的"必需技能"才是工种的函数而不是一张要人维护的表；`DELIVERY_REQUIRED_SKILLS` 相应改为按工种取：implementation 从两条路径（target 加 target-craft）缩到一条（target），test 仍是两条（target 加 test，因为测试窗口要先懂目标任务的交付形状再读测试合同）。技能名沿用 `wakeflow-target` 而不是改成角色词 `product`：工具面的对象词本来就是 target（`plan_target_task`、`import_target_result`、`inspect_target_result_review`），技能里用一句话点明"product 窗口执行 target 任务"即可，改名反而要动上面那条常量与全部 prompt 逐字断言。备选：按十张能力卡各出一份技能——Agent 不按能力挑技能，一次投递要列四五条必需技能，且十份文件是十处工具名漂移点。
- D2 命令面维持 Claude 独有，从 7 个减到 4 个，且不得承载技能没有的步骤。建议 `/wakeflow-init`、`/wakeflow-status`、`/wakeflow-next`、`/wakeflow-pod` 四个：它们对应用户真正开口的四句（"初始化"、"看看状态"、"继续下一步"、"开或关 pod"）。删除 `dispatch`、`review`、`windows`（都是 Controller 经 `next` 到达的循环中段，不是用户开口的第一句，技能里已有完整步骤）、`unattended`（TSD-12 已放弃 unattended 与 keep-live，重写等于把放弃项复活）、`check`（并入 `/wakeflow-status`；它现在教的 `wakeflow_view` 已按 ADR-0006 放弃）。不给 Codex 造等价命令面：Codex 插件不发 slash 命令（能力映射矩阵 §3 第 10 行），两宿主的共享形状是技能文本。硬约束：命令正文只能是"一句意图加第一次工具调用加指向某技能某一节的指针"，命令里出现的每个工具名必须同时出现在它所指的技能里（D4 e），否则 Codex 侧会丢步骤。备选：完全不发命令——Claude 用户失去唯一显式入口，且工作区还不存在时 `/wakeflow-init` 是唯一能被发现的入口。
- D3 文本只有一份源，宿主差异用封闭占位符表。建议 `assets/agent-text/` 下放 `skills/<name>/SKILL.md`、`skills/<name>/references/*.md`、`commands/<name>.md`、`README.md`、`README.zh-CN.md`，源文件里不出现任何宿主名与宿主专有词；宿主差异写成封闭占位符（`{{instructionFile}}`、`{{windowLaunch}}`、`{{deliveryAction}}`、`{{worktreeLaunch}}`、`{{commandSurface}}`、`{{hostTrustSteps}}`），取值放在每宿主的文本 profile 模块；构建器把整棵源目录渲染进每个候选，`commands/` 只进 Claude 候选。渲染是一次封闭替换：源里出现未登记的占位符，或某宿主的取值表里有没被任何源文件用到的键，构建即失败。理由：今天两份技能树已经因为几句宿主差异分叉了 11 份文件，而 TSD-12 要求宿主差异只进 hosts profile 数据与 skills 文本——占位符表正好把"数据"与"文本"缝在宿主边界上。备选 A：两套 Markdown 各维护一份（今天的状态，已经漂移）；备选 B：文本编成 TS 字符串常量放进 `src/hosts/`（像状态栏资产）——技能是给人和 Agent 读的 Markdown，进 TS 后审阅与 diff 都退化，且共享文本本就不该住在宿主目录；备选 C：放 `tooling/artifacts/agent-text/`——它是出厂内容不是构建工具，放 tooling 会让"产品文本"与"构建脚本"共用一个所有权边界。
- D4 诚实性检查（五条，都是仓库自己的测试，不是审阅意见）。(a) 正向白名单：源目录里所有 `wakeflow_[a-z_]+` 记号必须出现在 `WAKEFLOW_PUBLIC_TOOL_CATALOG.tools` 的名字集合里；按最长记号匹配，`wakeflow_pod_open` 不会被 `wakeflow_pod` 放行，`wakeflow_register_window` 不会被 `wakeflow_register_window_binding` 放行。(b) 反向覆盖：20 个公共工具每一个至少被一份 `SKILL.md` 或其 references 正文点名，今天那 11 个无人教的工具就此清零。(c) 退役词汇黑名单：白名单只看 `wakeflow_*` 记号，旧的操作词与旧对象名不匹配它，所以另立一张退役词表（`operation=group`、`operation=target-preview`、`dispatch group`、`review pack`、`TODO row`、`window lease`、`next work`、`keep-live`、`unattended`），出现即失败。黑名单只收已经消失的工具名、对象名与操作词：仍在册的操作词一律不进表——`inspect` 是 `wakeflow_register_window_binding` 与 `wakeflow_pod` 今天的操作，把它列进去会与 (b) 的"每个工具都要被教到"直接相撞，两条检查同时写成测试就无法一起通过。(d) 技能路径闭合：代码里点名的技能路径（`DELIVERY_REQUIRED_SKILLS`）必须在源目录里存在，源目录里的每个技能必须被"工种到技能"表或 Controller/Design 入口表引用到，不留孤儿。(e) 命令闭合：每个命令正文里的工具名必须同时出现在它所指的技能里。理由：文本是唯一没有编译器的公共面，工具一改名它就静默说谎，今天 31 个记号里 22 个说谎就是证据；这五条把说谎变成红灯。备选：靠评审读一遍——不可重复，且 ADR-0002 决定重切工具面时就已经预见了这次重写，工具面在 L2 还会继续动。
- D5 主流程步骤的唯一归属。建议四份技能合起来恰好覆盖需求总览 §3 主流程的 0 到 13 步，每步一个 owner：controller 归 0、1、5、6、7、8、10、11、12、13；design 归 2、3、4；target 归 9（实现）；test 归 9（测试）。检查写成测试里的"步到工具"表（表取自 §3 那张表），断言每步的 owner 技能点名该步的工具，且步集合的并集是 0 到 13、除第 9 步外两两不相交。理由：旧 controller 技能 583 行里同时讲派发、评审、pod、存储卫生与停止条件，没有任何机制能证明它覆盖了主流程；覆盖写成表，流程一变表就红。备选：在 `SKILL.md` frontmatter 里加 `wakeflow-steps` 字段让测试直接读——两宿主的 frontmatter 只承诺 `name` 与 `description`，加字段有被宿主拒绝的风险。
- D6 语言：技能与命令只发英文，README 保持双语。建议 `SKILL.md`、`references/*.md`、`commands/*.md` 各只有英文一份；README 保持 `README.md` 与 `README.zh-CN.md` 两份，共用同一套占位符。理由：两宿主都没有"按语言选技能"的机制，发两份会两份都被发现、两份都被加载，诚实性检查也要跑两遍；面向用户的工作区生成文本（`src/workspace/support/wakeflow-support-memory-authority.ts` 的支撑面记忆、活动投影、投递 prompt）已经有 `presentation.language` 开关，不受本项影响。备选：技能也双语——见上。
- D7 体积与优先级预算。建议每份 `SKILL.md` 不超过 200 行且不超过 12 KB，`description` frontmatter 不超过 1,024 字符（Claude 的上限，Codex 无上限但取同一值以免分叉），每份 `references/*.md` 不超过 400 行，命令正文不超过 40 行；技能不复述任何工具的 Schema 与拒绝码——边界归工具描述与 server instructions（ADR-0004），技能只讲顺序、身份、以及工具做不到的人类动作。上限写成断言。理由：仓库规则要求 prompts 分优先级且轻，任务包持有完整任务上下文，需求锚点持有背景；旧 controller 技能 583 行里大半是 Schema 复述与已放弃能力。备选：不设上限——今天的 4,267 行就是不设上限的结果。
- D8 README 的宿主一次性动作节。建议 README 新增一节"安装后的一次性宿主动作"，正文由 `{{hostTrustSteps}}` 从宿主文本 profile 取：Codex 一侧——用户必须在 `/hooks` 里按定义哈希审阅并信任 Wakeflow 的四个 hook，信任前四个 hook 全部被跳过，插件更新后若 hook 定义字节变化需要重新信任，正常情况下更新后 `/hooks` 里不应出现待审阅的 Wakeflow 条目（13.97 D6、D9 第八项）；Claude 一侧——首次在工作区目录启动时必须接受工作区信任对话，否则插件 hook 与状态栏都不运行，状态栏命令由 `wakeflow_maintain_workspace` 写进 `settings.local.json` 的托管块，用户自行改写 statusLine 会在对账里报差异（13.94 D6）。两宿主共同项：`node` 必须在 PATH 上（与 `.mcp.json` 同一假设）；`wakeflow_verify` 的 `host-hook-channel` 门报 `absent` 或 `records-0` 时（码的实际形状是 `records-0`，与既有的 `skipped-<n>` 同一风格），第一排查项就是这两个信任动作（13.97 D10）。理由：13.97 D6 明确把这两步留给 README 与 skills，本项就是那个 owner；它们是"投递看起来成功却拿不到 hook 证据"的唯一根因，不写进 README 用户无从自查。备选：只写进技能——装插件时读 README 的是用户，读技能的是 Agent。
- D9 制品构建器与准入。建议候选定义增加 `agentTextRoot`（仓库相对路径）与每宿主的文本 profile 模块；构建器像 13.97 D8 取 hook 片段那样动态 `import` 编译后的文本 profile，渲染后逐文件 `writeExclusive`；清单增加 `agentText[]` 条目（制品内路径与字节摘要）；两次构建字节一致（取值表是纯数据，渲染不含版本号与构建标识）。两份文本 profile 模块登记进架构门的 `ADMITTED_PRODUCTION_ROOTS` 与 knip entry；`assets/agent-text/` 是非 TS 资产，不进 tsconfig、不进架构图，由制品测试与诚实性测试守。理由：与 hook 片段同一条缝，不新开机制。备选：把文本当普通静态文件直接复制进候选而不走取值表——占位符就失去了唯一替换点，宿主差异会重新散进 Markdown，正是 D3 要消除的分叉来源。
- D10 删除与文档回写。建议旧 `plugins/*/skills/`、`plugins/claude-code-wakeflow/commands/` 与四份旧 README 属于旧 JavaScript 制品，按 §8.1 的分层规则留到 L3 原子切换时随 `core/`、`tools/`、`test/` 一次删除，本项不动它们，新文本在 `assets/agent-text/` 里另起。回写：能力映射矩阵 §3 第 10 行"7 个 slash 命令随场景重写"改为"4 个命令，且命令不承载技能之外的步骤"；plan §8.1 L2 行的"skills 与 commands 文本随场景重写"在本项落地后标为已实现；ADR-0002 后果表"旧 skills 与 commands 文本在 E4 制品阶段随新面重写"改为"文本在 L2 重写并带诚实性门，E4 只删旧树"。理由：旧树是旧 JavaScript 制品的一部分，单独删它会让旧体系在 L3 之前就处于半可用状态，而 §8.1 的分层规则要求整体原子切换；新文本另起一根，两套文本在 L2 到 L3 之间并存不冲突（构建器只读新根）。备选：本项就地覆盖旧目录——旧制品仍是 `test:legacy` 的不变量来源，覆盖会让旧门失去它自己的文本。

**验收。** `tests/artifacts/agent-text-honesty.test.ts` 一份文件覆盖 D4 的五条、D5 的步到工具表与 D7 的体积上限；用例形如"文本点名的每个工具都在公共目录里"、"公共目录的每个工具都至少被一份技能教到"、"退役词汇不出现在任何源文件里"、"代码点名的技能路径存在且没有孤儿技能"、"命令不引入技能之外的工具"、"主流程每一步的 owner 技能点名该步的工具"、"每份 SKILL.md 在行数与字节上限内"；纯文件读取，无夹具、无网络、无编译，目标墙钟低于 1 秒（L2 退出门要求治理测试墙钟低于 3 分钟，本项不得吃掉预算）。`tests/artifacts/typescript-artifact-candidates.test.ts` 追加：渲染结果里不残留 `{{`、`commands/` 只出现在 Claude 候选、Codex 候选的共享文本里不出现 `CLAUDE.md` 而 Claude 候选里不出现 `AGENTS.md`、两次构建字节一致、清单 `agentText[]` 摘要稳定。投递侧现有测试断言 `DELIVERY_REQUIRED_SKILLS` 收缩后 prompt 的必需技能节逐字稳定。场景不新增编号：18 条场景不读技能文本，D4(b) 的反向覆盖由目录常量而不是场景保证。

**度量目标。** 文本源从两制品各 30 份 Markdown（8,601 行）加 7 个命令（201 行）加四份 README（2,221 行）收成一份源目录：4 份 `SKILL.md`（合计不超过 800 行）、约 6 份 references（不超过 1,600 行）、4 份命令（不超过 160 行）、2 份 README；渲染后每个制品各得一份，不再有分叉文件。文本点名的 `wakeflow_*` 记号从 31 个（其中 22 个已不存在）变成恰好 20 个且全部在册，无人教的工具从 11 个变成 0 个。新增约 2,600 行 Markdown 与约 300 行 TS（两份文本 profile 与构建器改动），新增 1 份测试文件约 12 条用例、制品测试追加约 5 条，总测试数以仓库 runner 为准。架构门生产根 13 → 15；`tools/list` 不变（技能不是工具）；每个候选制品增加约 60 KB 文本。

**待用户确认的项。** D1（六个技能并成四个，`wakeflow-governance` 的多数章节放弃、`wakeflow-target-craft` 降级为 references，`DELIVERY_REQUIRED_SKILLS` 每工种只剩一条路径）、D2（命令 7 → 4 并删掉 `unattended`、`dispatch`、`review`、`windows`、`check`，与能力映射矩阵 §3 第 10 行"7 个 slash 命令随场景重写"相抵）、D3（文本源落在 `src/` 之外的新根 `assets/agent-text/`，并新增两份宿主文本 profile 生产根；ADR-0013 的六层只覆盖 TS 模块，不覆盖非 TS 出厂资产）、D4(b)（强制 20 个工具每个都有文本教，等于给文本定了下限）、D6（技能与命令只发英文，与工作区生成文本的双语开关不对称）五项是取舍或与既有裁决相抵；D8（13.97 D6 原文把两个宿主信任步骤留给"L3 的 README 与 skills"，本项把它们提前到 L2 并指定 README 为 owner）与 D10（要改写一份已接受 ADR 的后果条目）是把既有决定的时点或文字挪动了的两项，也请一并裁决；D5、D7、D9 是按既有边界落地的形状选择。用户于 2026-09-18 回复"确认 继续"，按建议列全部执行；同批确认的还有两项：墙钟按"可选持久化级别"做（给持久写一个显式的持久化级别，一次性测试工作区不再付 fsync），以及对测试总工作量做优化剪枝。

## 13.100 L2 第二项：可选持久化级别的落地、测试总工作量剪枝与墙钟实测（2026-09-18）

**做了什么。** 三轮并行实现把 §13.99 同批确认的两件事落到代码里。

- 可选持久化级别。`RootedDirectory.open` 收一个 `{ durability: "fsync" | "none" }`，级别记在根上，写路径按根上的级别决定是否 fsync。它与 `clock` 同类：只能由进程内调用方注入，公共请求、信封与线格式里都没有、也不会有这个字段。三种调用形状各多一个可选的尾参 `CommandShellExecutionOptions`，九个能力片（tasking、delivery、endpoint、evidence、observation、pod、requirement、result-review、demand）的执行选项各多一个可选字段，切片用 `commandShellExecutionOptions(options.durability)` 把它收窄后交给外壳。
- 派生根继承。同一次调用里从工作区根派生出来的根一律随来源根：Demand 操作根、Demand 发布根（stage 与 final）、权威上下文的 ledger 根、Demand 片的 ledger 根、观察片与活动投影刷新的 ledger 根。这条不变量现在有直接回归（`Demand 操作根继承来源工作区根的持久化级别`，两侧各断言一次），注入边界也有直接回归（缺省 `fsync`、请求里的同名字段不起作用、任何公共工具的请求 Schema 里都没有 `durability`）。
- 测试剪枝。共享预置工作区基线扩到 requirement、pod、workspace-observation 三处，`tests/support/prepared-workspace.ts` 的 `assertRelocatable` 保证基线字节里不含它自己的根路径（运行期泄露仍由各测试原有的断言看住）。一次性夹具通过 `DISPOSABLE_ROOT_OPTIONS` 采用 `none`。五个被改文件合计 134.1 秒降到 95.1 秒（−29.1%），对照文件同段时间只动 −0.6%。

**墙钟的账。** 本机 8 个逻辑核，`node --test` 每个文件一个子进程。

| 度量 | 值 |
| --- | --- |
| 全量 TS 门，旧调度表（`npm test` 里 runner 自报 `duration_ms`） | 209.3 秒，963 项全过 |
| 全量 TS 门，刷新调度表后（同一命令，本片最终态） | 191.2 秒，966 项全过 |
| 逐文件计时（同一棵树，8 路池，每文件一个进程） | 墙钟 189.0 秒，逐文件求和 1,355 秒，打包率 90% |
| 完美打包下限（1,355 / 8） | 169 秒 |
| 关键路径 | `tests/scenarios/wakeflow-scenario-acceptance.test.ts` 单文件 189.0 秒，独占跑 82.5 秒 |

关键路径就是墙钟本身：场景验收是一条二十个场景、同一个一次性工作区上的顺序链，写在一个文件里，`node --test` 只能给它一个进程，它从 0 秒开始一直跑到最后一秒。它独占 82.5 秒，八路并发下被拉长到 189 秒。链内没有单点热点，最贵的六个场景合计 53 秒，其余十四个每个不到 5 秒。

**两项否定性实测。** 都是把编译产物临时改掉跑一遍、跑完还原，仓库源码未改。

- 把外壳的缺省级别强制成 `none`（等于所有测试调用都注入 `none`）：全量门 209.3 → 195.0 秒，只有 −6.8%。所以"把 170 处执行器调用点逐个加上 `durability`"买不到退出门，代价却是 170 处改动加一档削弱的 fsync 覆盖，本片不做。
- 场景验收单文件在 `none` 下 82.5 → 73.2 秒（−11%）。场景链走的是真实 Codex 组合根，注入缝在组合根之外；为它开一个测试专用旋钮等于把测试开关放进生产组合根，本片拒绝。

**结论：L2 的"治理测试墙钟低于 3 分钟"退出门本片未达，差 11 秒（191.2 对 180），需要用户裁决。** 不是剪枝没做够：下限已经是 169 秒，而关键路径的那一个文件就要 189 秒；刷新调度表已经把 runner 自己浪费的 18 秒收回，剩下的差额全在那一条链上。在场景链保持"一个文件、一条顺序链"的前提下，180 秒不可达。三个选项：(a) 把场景链按工作区检查点切成 3 到 4 个可并行文件，关键路径降到 50 到 65 秒，墙钟随下限走（新工作，且验收证据从"一条链"变成"几条接力链"）；(b) 按测试数从 844 涨到 963 重新裁这条门的数值；(c) 保留 180 秒并把本项记为未达。

**其余处置。** 本轮三个并行桶的评审提出的应修项已修：投递必需技能收缩后 `tests/capabilities/delivery/decide.test.ts` 的断言同步（此项曾让门变红）；`docs/requirements/wakeflow-functions-and-scenarios.md` §2 与 §3 里残留的退役对象词"测试卡"改为"测试合同（由测试任务包携带）"；`demand-operation-authority-context.ts` 的注释不再宣称一条全工作区不变量，改为这条缝自己成立的陈述；`tests/support/prepared-workspace.ts` 里两个字面 NUL 分隔符改成 `\u0000` 转义，文件不再是二进制。`tooling/testing/test-durations.json` 按本次逐文件实测整表刷新（旧表是并发争用下的 1,617 秒旧数，把最慢文件排错了位）。

## 13.101 L2 收口后的推进计划：功能补齐、L3 制品完整化与 E4 原子切换（2026-09-19）

**目标。** 用户 2026-09-18 晚定下的方向：以"新 TS 版本完整实现功能与代码逻辑、准备好新旧切换、清理旧代码"为目标，按阶段一步一个脚印推进，不遗漏功能与代码逻辑；本轮不用 ultracode，单人推进。本节先盘点现状与仍然开放的功能项，再给阶段计划与需要裁决的项。

**现状盘点（代码与文档实测）。**

- 公共面：20 个公共工具、95 份 wire Schema，Controller Route 无 not-implemented blocker；能力映射矩阵 31 项旧工具重切或已落地 27、放弃 4、缺席 0，D1–D41 与 I3 逐行有判定；十张能力卡全部 `confirmed`。
- 场景验收：20 个场景一条链全部 `pass`；待接线只剩 `card-10/release-consistency`（L3）。
- 全量 TS 门：966 项全过，runner 墙钟 191.2 秒（§13.100）。
- 候选制品（`.build/artifacts/<host>/`）已有：`lib/` 编译闭包（Claude 430 文件、Codex 418 文件）、`mcp/server.mjs`、`hooks/observe.mjs` 与 `hooks/hooks.json`、`skills/`、Claude 的 `commands/`、双语 README、`.mcp.json`、`package.json`（`0.0.0-technical-skeleton`、`private`）、`artifact-manifest.json`（`releaseEligible: false`）。**还没有**：插件 manifest（`.codex-plugin/plugin.json`、`.claude-plugin/plugin.json`）、LICENSE、品牌 SVG、运行时依赖闭包、真实版本号、`releaseEligible` 的真实路径。
- 运行时依赖闭包实测：`@modelcontextprotocol/server` 2.0.0 → `@modelcontextprotocol/core` → `zod`；`ajv` → `fast-deep-equal`、`fast-uri`、`json-schema-traverse`、`require-from-string`；`p-limit` → `yocto-queue`；`canonicalize`、`jsonc-parser`。12 个包，整包 17.2 MB；去掉 `.d.ts`、source map、Markdown、`src/`、测试目录后约 5.3 MB。候选制品今天能在仓库内跑，只因为 Node 从 `.build/` 向上找到了仓库根的 `node_modules/`——装到宿主缓存目录后会立刻找不到依赖。这是 L3 必须解决的第一件事。
- 旧体系待删：`core/` 186 文件 165K 行、`tools/` 9 文件、`test/` 7,260 文件 829K 行（含 48 MB fixture 语料）、两个插件里的 `scripts/`（100/106 文件、150K/161K 行）、`lib/`、`schemas/`、`templates/`、`bin/`、`wakeflow.config*.json`、插件根 `AGENTS.md`/`CLAUDE.md`；根 `package.json` 的 `workspaces` 与 `sync:core`、`check:core`、`validate*`、`smoke*`、`mcp*`、`test:wakeflow`、`test:legacy` 脚本；`knip.json` 的 `test/**` 忽略；根 README（描述旧安装与旧工具面）。

**功能完整性清单（仍然开放、不得遗漏的项）。** 逐项给出处置，"放弃"都指向既有裁决。

| # | 项 | 来源 | 处置 |
| --- | --- | --- | --- |
| F1 | TSD-16 配置从 v1 起版未做：`WAKEFLOW_CONFIG_V3_VERSION = 3`，`$id` 仍指向 `https://raw.githubusercontent.com/GxFn/Wakeflow/main/core/schemas/wakeflow-config.schema.json`（E4 删 `core/` 后失效），代码 92 个文件带 `V3` 字样 | ADR-0008 决定 5；能力映射矩阵行 2、D13 | **B1 做**：`$id` 改 `urn:wakeflow:config:v1`、`schemaVersion: 1`、`kind` 保持 `WakeflowConfig`；符号去掉版本后缀（`WakeflowConfig`、`parseWakeflowConfig`、`wakeflow-config.ts`），文件版本只由 `schemaVersion` 表达 |
| F2 | `card-10/release-consistency`：五源一致、标签在 HEAD、Node 24 | 场景清单 §2；能力卡 10 Q5–Q7 | **C 做**：`release:check` 重写为 `tooling/release/`，场景以 tooling 测试形式接线（它不经 MCP） |
| F3 | 制品校验器与冒烟 | 能力卡 10 Q8、矩阵 §2 | **C 做**：TS 校验器（文件清单闭合、manifest 与 marketplace、MCP 接线、工具数量由导出派生、技能面、文本面、hooks 摘要、无绝对路径）与冒烟五幕（fresh preview 零写与 apply、目标树复核、reconcile no-op、一次观察 status/verify、pod create preview 零写），冒烟从**仓库外的临时副本**启动制品以证明依赖闭包 |
| F4 | 两宿主各完成一次真实投递并交回 hook 证据；Claude 状态栏真实会话 | L2 退出门；§13.97 D9 八项 | 只有用户能做；记 `已实现、宿主未验证` 直到跑过（plan §14 第 12、13 项允许明确报告未执行） |
| F5 | `developer-progress.md` 最近十条事件 | 能力卡 9 Q7"待 L2 场景需要再加" | 场景没有需要它；**裁决 D9**：默认不加 |
| F6 | `config.valueSources`、阈值配置化 | §13.94 D7 | 观察切片已裁决不进配置；关闭 |
| F7 | ADR-0009 开放项：Codex 线程创建工具名核对；tmux 控制模式是否写进 Claude skills | ADR-0009 | 前者已在 endpoint 切片核对（场景断言 `create_thread`）；后者已写进技能文本（"可选强观察"）；D 阶段回写 ADR 关闭 |
| F8 | ADR-0013 开放项：目录名；`idempotency-store` 位置 | ADR-0013 | 目录名已由实现固定（kernel、capabilities、governance、workspace 并存）；幂等由追加命令的请求键落地，没有独立 store；D 阶段回写关闭 |
| F9 | ADR-0008 开放项：插件名与 marketplace 条目是否沿用；版本起点 | ADR-0008 | **裁决 D3、D4**：沿用 `wakeflow` 与两份 marketplace；起点 `1.0.0`（能力卡 10 Q5 已建议） |
| F10 | 治理测试墙钟 191.2 秒对 180 秒门 | §13.100 | **裁决 D10** |

**阶段计划。** 每阶段一个退出门，一次提交。用户 2026-09-19 授权"开发各个阶段时，你可以视情况提交代码"，提交由实施者在退出门通过后自行执行；推送、打标签、发布与缓存刷新仍各自需要明确授权。

| 阶段 | 内容 | 退出门 |
| --- | --- | --- |
| A L2 收口 | 提交 §13.96–§13.100 的未提交工作（79 个路径）；D10 定墙钟门 | `npm test` 绿、`git diff --check` 干净 |
| B 功能补齐 | B1 TSD-16 配置 v1（F1）；B2 按 D9 决定是否加最近十条事件 | 全量门绿；场景 20 项 pass；矩阵行 2、D13 改"已做" |
| C L3 制品完整化 | C1 构建器补齐：manifest、LICENSE、品牌 SVG、依赖闭包（D5）、真实 `package.json`、版本源、`releaseEligible` 真实路径、两次构建逐字节一致；C2 TS 校验器与冒烟（F3）、`build:check`；C3 `release:check` TS 重写与 `card-10` 接线（F2）；C4 制品测试扩展 | 候选制品在仓库外临时副本上通过冒烟五幕；`build:check` 对候选连跑两次一致；全量门绿 |
| D E4 原子切换 | D1 用构建器重生成两个 committed 制品（覆盖式替换旧内容）；D2 删除 `core/`、`tools/`、`test/`、插件旧内容、根脚本、`workspaces`、knip 忽略；D3 根 README/AGENTS.md/CLAUDE.md 与 `docs/README.md` 改写为新权威；D4 五源版本 `1.0.0`；D5 回写 plan §8.1/§13/§14、矩阵 §2、场景清单、ADR-0008/0009/0013 开放项 | `npm test` 绿；`build:check` 一致；`release:check` 除标签外全过；`git diff --check` 干净；一次提交 |
| E 只有用户能做 | `WakeWorkspace` 真实初始化、删除重建、reconfigure/reconcile；两宿主真实投递与 hook 证据；打标签、发布、缓存刷新 | plan §14 第 10、12、13、15 项 |

**需要裁决的项（按建议列执行即回复"确认 继续"）。**

- D1 制品组成（闭合清单）。保留：`.codex-plugin/plugin.json` 或 `.claude-plugin/plugin.json`、`.mcp.json`、`package.json`、`artifact-manifest.json`、LICENSE、`README.md`、`README.zh-CN.md`、`assets/wakeflow-logo.svg` 与 `wakeflow-mark.svg`（源移到仓库 `assets/brand/`，两宿主同一份）、`lib/`、`mcp/`、`hooks/`、`skills/`、Claude 的 `commands/`、`node_modules/`（见 D5）。不再发出：`bin/`（shell 启动器；`.mcp.json` 已直接用 `node`）、`scripts/`、旧 `lib/`、`schemas/`（wire Schema 已编进 `lib/`）、`templates/`（投影模板是代码）、`wakeflow.config*.json`、插件根 `AGENTS.md`/`CLAUDE.md`（宿主不加载插件根记忆文件；信任步骤与入口说明由 README 承担，§13.99 D8）。与 plan §8.1 L3 行列出的"templates、宿主记忆、setup 与 validate 与 smoke 脚本"相抵：这三类在新制品里没有消费者，setup 就是 `wakeflow_maintain_workspace`，validate 与 smoke 是仓库门（tooling）而不是制品内容。
- D2 `plugins/<host>/` 变为纯生成物：构建器直接写 committed 目录，`build:check` 以临时重建对比 committed 字节；任何手工编辑都会在门上被拒。旧制品树在 D 阶段一次删除（ADR-0008 决定 4）。
- D3 插件名沿用 `wakeflow`；两份 marketplace 条目沿用，描述与关键字改写（去掉 `unattended`）；Codex manifest 保留 `interface` 段（`defaultPrompt` 按新工具面改写）。
- D4 版本序列起点 `1.0.0`，五源同时改；Codex marketplace 保持无版本；插件 `engines` 与仓库统一 `>=24.19.0 <25`。
- D5 运行时依赖闭包随制品提交：构建器按根 `package-lock.json` 的精确版本把 12 个包复制进 `<制品>/node_modules/`，剪掉 `.d.ts`、source map、Markdown、`src/`、测试目录（每制品约 5.3 MB，两份约 10.6 MB），清单记录每个文件摘要，两次构建逐字节一致。不用 bundler（需求文档 §5 非目标"不通过 bundling 隐藏领域依赖或宿主边界"），不要求用户装完插件再跑 `npm install`（两个宿主都不会替插件跑安装脚本）。备选：整包复制（每份 17 MB）——多出的全是类型与文档，没有运行时消费者。
- D6 `artifact-manifest.json` 随制品发出并成为校验器的闭合依据：`releaseEligible` 在版本属于新序列、依赖闭包完整、hooks 摘要相符、文本占位符闭合、两次构建一致时才为 true；校验器拒绝 committed 制品与清单不一致或存在清单外文件。
- D7 校验器与冒烟放在 `tooling/artifacts/`，入口 `npm run build:check`（临时重建对比 committed）、`npm run smoke:artifacts`（仓库外临时副本启动）；`release:check` 放在 `tooling/release/`，仍要求 main、干净树、标签在 HEAD、本地 `origin/main` 同一提交，另加 Node 24 引擎核对；`test:legacy` 及其五个子脚本随旧树删除。
- D8 配置 v1 的符号命名去掉版本后缀（F1）。备选：改成 `V1` 后缀——下次 bump 又要全仓改名。
- D9 `developer-progress.md` 不加"最近十条事件"（F5）；需要时随场景再开。
- D10 墙钟门改为两条：场景验收单文件独占跑低于 90 秒，全量 TS 门低于 210 秒（§13.100 选项 b）。备选 (a) 切场景链、(c) 保留 180 秒记未达。
- D11 根 README 按新制品全文改写（安装、初始化、第一个 Demand、工具面、信任步骤、仓库开发），双语；`docs/README.md` 权威顺序第 1 行去掉"旧基线 `core/`、`test/`"。
- D12 提交节奏：A、B、C、D 各一次提交，退出门通过即提交（用户 2026-09-19 授权）；D 阶段的删除与重生成在同一提交（plan §10.1 第 4–6 项）。

用户于 2026-09-19 回复"确认 继续"，D1 到 D12 按建议列全部执行。

## 13.102 B1：配置从 v1 起版（TSD-16，ADR-0008 决定 5）（2026-09-19）

**做了什么。** 配置文件的身份改为新序列：Schema `$id` 与文档 `$schema` 常量都是 `urn:wakeflow:config:v1`，`schemaVersion` 为 `1`，`kind` 保持 `WakeflowConfig`；`maintenance-execution-intent.schema.json` 对配置 Schema 的 `$ref` 随之改为 URN。旧值指向 `https://raw.githubusercontent.com/GxFn/Wakeflow/main/core/schemas/wakeflow-config.schema.json`，E4 删除 `core/` 后它就是一个死链接。代码按 §13.101 D8 去掉版本后缀：模块 `wakeflow-config.ts`、`wakeflow-config-document.ts`、`wakeflow-config.schema.json`、`wakeflow-config.generated.ts` 与三份测试文件改名，符号 `WakeflowConfig*`、`parseWakeflowConfig`、`createMinimalWakeflowConfig`、`WAKEFLOW_CONFIG_SCHEMA`、`WAKEFLOW_CONFIG_SCHEMA_ID`、`WAKEFLOW_CONFIG_SCHEMA_VERSION`、`WAKEFLOW_CONFIG_KIND`；注释与消息里的 "v3 配置" 措辞一并去掉，文件的版本只由 `schemaVersion` 表达。生成目录由 `schema:build` 重生成（95 份 Schema、132 条外部引用边）。

**两个不加载校验器的轻读者。** 第一次全量门红了 13 项，全部指向同一处：hook 观察脚本按声明拓扑定位工作区时（§13.97 D2）和 Claude 状态栏资产脚本读配置时，各自把 `schemaVersion !== 3` 写成了字面量，改名脚本按符号替换够不到它们。处置是给身份一个唯一权威：`src/contracts/vocabulary/wakeflow-config-identity.ts` 持有 `WAKEFLOW_CONFIG_KIND`、`WAKEFLOW_CONFIG_SCHEMA_VERSION`、`WAKEFLOW_CONFIG_SCHEMA_ID`，配置模块转发；观察脚本的闭包只许到 kernel（D1 的回归只看入口的直接 import），所以由 `kernel/layout.ts` 转发前两个；状态栏资产在模块加载时把它们插进脚本文本，字节仍然确定。以后再 bump 版本，这两个读者跟着常量走。

**不变的部分。** 配置的字段集、拓扑、存储、治理与宿主段一个字节没动；fresh-initialize 与 reconfigure 仍是仅有的两个生产入口；TS 之前的任何工作区仍然只会被拒绝并列出标记（ADR-0008 决定 1）。

**验证。** 96 个文件改动、行数 +1,349/−1,350；`typecheck`、`check:architecture`（677 模块）、`schema:check`、Biome lint 与 format、knip 干净；配置切片聚焦测试 14/14，其中两处钉死的旧值（最小配置的规范摘要与文件字节数 2,661 → 2,590、文件摘要）按新身份更新；hook 观察、状态栏、制品与场景验收聚焦 25/25。能力映射矩阵行 2 与 D13 的"TSD-16 从 v1 起版未做"改为已做。全量 `npm test` 966/966，提交 `595878b1`。

## 13.103 C：L3 制品完整化——构建器、依赖闭包、校验器、冒烟与发布门（2026-09-20）

**做了什么。** 按 §13.101 D1–D7 把"技术骨干候选"构建器变成插件制品构建器，并补上切换前必须有的三道门。

- 构建器 `tooling/artifacts/build-plugin-artifacts.ts`（替换 `build-typescript-artifact-candidates.ts`）。每个制品现在有：`lib/` 编译闭包、两个 launcher、`hooks/hooks.json`、`.mcp.json`、插件清单（`.codex-plugin/plugin.json` 或 `.claude-plugin/plugin.json`）、真实 `package.json`（不再 `private`，运行时依赖按锁文件精确版本声明，引擎 `>=24.19.0 <25`）、`LICENSE`（根文件逐字节）、`assets/wakeflow-{logo,mark}.svg`（源在 `assets/brand/`）、`skills/`、Claude 的 `commands/`、双语 README，以及 `node_modules/` 运行时依赖闭包。版本只有一个输入 `assets/release/version.json`（`1.0.0`），盖进 `package.json`、插件清单与 MCP launcher 交给组合根的版本号。清单改为 `WakeflowPluginArtifactManifest`：`version`、`releaseEligible`（版本属于新序列且本次构建的每道核对都通过）、`dependencies[]`（名字、精确版本、锁文件 SRI 完整性、依赖名）、每个文件的字节数、sha256、模式与范围（新增 `license`、`brand`、`dependency` 三个范围）。输出根两个：`.build/` 之下的候选，或恰好 `plugins/`（`--committed`，E4 切换时用）。不再读旧 `plugins/*/package.json` 作为参考——那是循环输入。
- 依赖闭包 `tooling/artifacts/plugin-dependency-closure.ts`（D5）。从编译闭包记下的直接外部包出发，沿根 `package-lock.json`（v3）逐级取 `dependencies`、`peerDependencies` 与已装的 `optionalDependencies`，每级核对锁版本等于 `node_modules/` 实装版本；锁里标为 `dev`、`link`（工作区符号链接）或嵌套安装的包一律失败，闭包上限 64 个包。文件按扩展名剪掉 `.ts`/`.mts`/`.cts`/`.map`/`.md`/`.markdown` 与隐藏文件，其余原样复制，模式一律 0644。实测：Claude 制品 12 个包，Codex 11 个——`jsonc-parser` 只被 Claude 的可移植设置模块引用，闭包按真实 import 求得而不是照抄根 `package.json`。
- 元数据 `tooling/artifacts/plugin-metadata.ts`（D3、D4）。插件名沿用 `wakeflow`；Codex 清单声明 `skills`、`mcpServers` 与 `interface`（`defaultPrompt` 三条按新工具面改写），Claude 清单只声明 `mcpServers`（技能、命令与 hook 靠目录发现）；描述与关键字去掉 `unattended`；两份 marketplace 条目的期望形状也在这里，供校验器与发布门核对。
- 校验器 `tooling/artifacts/check-plugin-artifacts.ts`，入口 `npm run build:check`（D2、D6、D7）。临时重建到 `.build/artifacts-check/`，先按 committed 制品自己的清单核对每个文件的字节、摘要与模式且不得有清单外文件，再核对 committed 清单与新清单字节相等，最后核对两份 marketplace 的 `wakeflow` 条目与元数据结构相等（键序无关）。错误码 `wakeflow-artifact-check-{drift,extra,missing,marketplace,…}`。
- 冒烟 `tooling/artifacts/smoke-plugin-artifacts.ts`，入口 `npm run smoke:artifacts`（能力卡 10 Q8 的五幕加一幕）。制品搬到仓库之外的临时目录再启动——Node 从那里向上找不到仓库根的 `node_modules/`，闭包不自足就起不来。六幕：列出的工具恰好是制品自己的公共目录（不硬编码数量）；fresh-initialize preview 零写、apply `completed`；reconcile preview 零步、apply `no-op`，两者零写；`wakeflow_status` 有总体状态、`wakeflow_verify` 全部通过；pod create preview `ready` 且零写；`hooks/observe.mjs` 落一条 SessionStart 记录。临时树总被删除，清理失败把成功降为失败。
- 发布门 `tooling/release/check-release-consistency.ts`，入口 `npm run release:check`（能力卡 10 Q5–Q7）。五个版本源等于版本输入、主版本号不低于 1、两个插件与仓库根引擎相同且本次运行的 Node 在范围内、两份清单 `releaseEligible`；Git 门按标志逐项：main、干净树、标签 `v<version>` 指向 HEAD、本地 `origin/main` 与 HEAD 同一提交。`card-10/release-consistency` 由此以 tooling 测试接线（`tests/release/check-release-consistency.test.ts`：一次性 Git 仓库里全部门通过一次，再逐道门制造不一致断言九个错误码）；待接线场景清零。

**测试。** `tests/artifacts/plugin-artifacts.test.ts`（6 条：两次构建逐字节一致与清单闭合、制品搬到仓库外后两个入口经官方 stdio Client 发布 20 个工具、hook launcher 三种结局、片段摘要、闭包守卫、依赖闭包的传递求解与三种拒绝）、`plugin-artifact-check.test.ts`（3 条：一致通过；改字节/多文件/缺文件/marketplace 落后四种拒绝；结构相等的边界）、`plugin-artifact-smoke.test.ts`（1 条，对候选跑整条冒烟）、`tests/release/check-release-consistency.test.ts`（3 条）。

**没做的与残余。** `plugins/` 仍是旧制品，两份 marketplace 仍写 `0.9.6`，`build:check` 因此还不能进 `npm test`——这三件是 D 阶段同一提交的事。`tools/check-release-consistency.mjs` 只是不再被 `package.json` 引用，文件随 `tools/` 在 D 阶段删除。

**knip 从 12 分钟回到 3 秒。** 全量门这轮在 `check:unused` 上卡了 12 分 5 秒，`knip --performance` 把 99% 记在 `findAndParseGitignores`：它爬整棵树收集每一份 `.gitignore`，`test/fixtures/` 里有 291 份历史工作区的忽略文件，其中每一条否定模式都让它把累计的几千条模式重新编译成一个 picomatch 匹配器，代价随文件数平方增长；根 `.gitignore` 挡不住这次爬取，因为 `plugins/*` 两个工作区都在 `ignoreWorkspaces` 里，爬取没有可剪枝的"相关目录"。处置：`check:unused` 改为 `knip --no-progress --no-gitignore`，`knip.json` 的 `ignore` 显式加上 `.build/**`（否则 `package.json` 脚本里指向 `.build/` 的编译产物会被当作入口分析）。分析对象本来就由 `project` 与 `entry` 显式给出，不依赖 `.gitignore`。D 阶段删掉 `test/` 后这份开销本身也就没了。全量门 974/974，提交 `629e79c5`。

## 13.104 D：E4 原子切换——`plugins/` 重生成、旧体系删除、版本 1.0.0（2026-09-20）

**做了什么。** plan §10.1 的八项在一次提交里完成（第 8 项的打标签除外）。

- 制品：`npm run build:artifacts:committed` 把两个插件从源码重生成到 `plugins/`，整目录 stage-then-rename 替换旧内容。Codex 893 个文件、Claude 918 个，各约 10 MB，其中运行时依赖闭包 `node_modules/` 各 11 与 12 个包。根 `.gitignore` 的 `node_modules/` 原本会把这两份闭包整个忽略——`git check-ignore` 证实——加了两条否定规则 `!/plugins/<host>/node_modules/` 之后依赖文件才进得了提交。切换提交 `a8d0b4bb` 之后核对 `git ls-files` 与磁盘文件数（736 对 893、761 对 918）又抓到第二层：根 `.gitignore` 的 `dist/` 把 `ajv/dist/`、`@modelcontextprotocol/*/dist/` 这些运行时目录也忽略了；`dist/`、`coverage/`、`.build/` 改为只锚定仓库根（`/dist/` 等），紧跟一个修正提交把 314 个文件补进去。教训写进校验器的下一项残余：`build:check` 对比的是工作树，抓不到"没进 Git"，应加一道"清单里的每个路径都被 Git 跟踪"的核对。
- 删除：`core/`（186 文件）、`tools/`（9 文件，含 `sync-core.mjs` 与旧 `check-release-consistency.mjs`）、`test/`（7,260 文件，含 48 MB 历史 fixture 语料）、旧制品的全部内容（`scripts/`、`lib/`、`schemas/`、`templates/`、`bin/`、`wakeflow.config*.json`、插件根 `AGENTS.md`/`CLAUDE.md`），共 7,862 个路径；根 `package.json` 去掉 npm `workspaces` 与 `sync:core`、`check:core`、`validate*`、`smoke*`、`mcp*`、`test:wakeflow`、`test:legacy`，`npm install` 后 `package-lock.json` 少了两条工作区链接；`knip.json` 不再忽略 `test/**` 与两个工作区。
- 门：`check:typescript` 末尾加 `build:check`，任何对 `plugins/` 的手改或改源码不重建都在门上红。Claude marketplace 条目按元数据重写为 `1.0.0`（Codex 条目本来就相符）。
- 文档：根 `README.md` 与 `README.zh-CN.md` 按新制品全文改写（安装、一次性宿主动作、初始化产物、二十个工具、两宿主差异、仓库开发、发布）；`AGENTS.md` 与 `CLAUDE.md` 把 `core/`、`sync-core` 规则换成"生成物、唯一版本输入、`build:check`"规则；plan §5.1、§8.1 L3 行、§11 门表、§13 四行、§14 状态段、§15；`docs/README.md` 权威行与现行文档行；能力映射矩阵 sync-core 行；ADR-0008、ADR-0009、ADR-0013 的未决问题关闭；双制品需求文档标 `implemented`。
- 测试：依赖闭包的拒绝路径改在一次性合成锁文件上核对（`plugin-dependency-closure.test.ts`：未安装、开发依赖、工作区链接、版本漂移、嵌套安装、文件剪裁），因为真实锁文件里不再有工作区链接；`plugin-artifacts` 与 `plugin-artifact-check` 每个文件只构建一次而不是每条用例各建一次。

**验证。**

| 门 | 结果 |
| --- | --- |
| `npm test`（含 `build:check`） | 978/978，runner 265.5 秒，整条门 274 秒；committed 与重建逐字节一致（Codex 892 / Claude 917 个清单文件），两份 marketplace 条目 ok |
| `npm run smoke:artifacts`（committed 制品搬到仓库外） | 两宿主六幕全过：工具 20、fresh `completed`、reconcile `no-op`、status `idle`、verify ok、pod 预览 `ready`、hook `landed`；16 秒 |
| `release:check`（不带 Git 标志） | 五源 `1.0.0` 一致、引擎 `>=24.19.0 <25`、两份清单 `releaseEligible`；带 `--require-main` 时分支 `main`；带 `--require-clean` 在提交前如实报 `wakeflow-release-dirty`（顺手修了一处：`git status` 输出超过 spawnSync 默认 1 MB 缓冲时被误报为 Git 失败，缓冲上限改为 64 MB） |
| `git diff --check`、绝对路径与临时路径泄露扫描 | 干净 |

**墙钟（§13.101 D10 的第二条未达）。** 切换后安静机器上逐文件计时：8 路池墙钟 231 秒，逐文件求和 1,690 秒，完美打包下限 211 秒；关键路径仍是场景验收单文件（231 秒，独占跑约 82 秒）。D10 定的"全量 TS 门低于 210 秒"这条没有达到：门里的 runner 265.5 秒。多出来的工作有两块：新制品测试本身约 59 秒（冒烟 42.8、制品 8.4、校验 3.0、发布门 3.5、闭包 0.2），以及它们制造的磁盘争用让重文件普遍慢了一到两成（result-review 150 → 182 秒、maintenance-execution 126 → 147 秒）。两个可选处置，留给用户：(a) 把 `plugin-artifact-smoke.test.ts` 移出 `npm test`——committed 冒烟已由 `smoke:artifacts` 在交付前独立跑，门里的这条是对候选的重复——预计少 40 到 60 秒；(b) 把 D10 的第二个数按 978 项重裁到 270 秒。本片不擅自动门，也不擅自减测试。

**未做，按 plan §14 第 12 项明确报告。** 第 10 项（真实 `WakeWorkspace` 初始化、删除重建、reconfigure/reconcile）、第 13 项（两宿主各一次真实投递并交回 hook 证据）、Claude 状态栏与两宿主 hook 的真实会话核对；打标签 `v1.0.0`、推送、发布、插件缓存刷新。冒烟在仓库外一次性目录里完成的初始化、对账、观察与 hook 落地不是用户授权的真实工作区，不冒充第 10 项。

**残余。** `check:unused` 的 `--no-gitignore` 在 `test/` 删除后已不再必要，保留它是因为分析对象本来就显式；`tooling/testing/test-durations.json` 的多数条目仍是 §13.100 的实测，新文件按本次实测补入；旧 `docs/archive/` 与 `file-review-ledger.md` 里对 `core/`、`tools/`、`test/` 的引用是历史证据，不改。

## 13.105 切换后：墙钟处置 (a)、旧版本参考副本与功能对齐审计的开始（2026-09-20）

**用户裁决。** 2026-09-20 回复"确认 继续，按 (a) 把冒烟测试移出 npm test"，并要求：把 Wakeflow 项目复制一份本地副本，继续推进直到新 TS 版本完全功能、删除全部旧项目文件，后续对齐功能与代码时到那份旧版本副本里找代码逻辑。

**(a) 落地。** `tests/artifacts/plugin-artifact-smoke.test.ts` 改名为 `plugin-artifact-smoke.manual.ts`：runner 只收 `.test.ts`，所以它不再进 `npm test`；新入口 `npm run smoke:candidate`（对一次新鲜的候选构建跑同一条冒烟，21 秒），committed 冒烟仍是交付前必跑的 `smoke:artifacts`。knip 入口加 `tests/**/*.manual.ts`，调度表去掉该条，plan §11 门表与根 `AGENTS.md`/`CLAUDE.md` 的验证条款同步。

**旧版本参考副本。** 以 `git archive 629e79c5`（删除旧树之前的最后一个提交，仍含 `core/` 185 文件、`tools/`、`test/` 7,260 文件与两份旧制品）导出到仓库旁的 `Wakeflow-legacy-reference/`，加一份 `LEGACY-REFERENCE.md` 说明它是只读参考，不是工作区、不是构建输入、不受任何仓库跟踪；绝对路径只记在本机记忆里，不进仓库。

**功能对齐审计（下一阶段）。** 能力映射矩阵是按 31 项旧工具与 D1–D41 锚点判定的；用户要求的是代码逻辑层面的对齐，粒度要到旧模块。审计对象：旧 `core/scripts/lib/` 86 个模块、5 个入口脚本、`core/lib/` 2 个、`core/mcp/server.cjs`、Claude 独有 12 个与 Codex 独有 6 个宿主模块、19 份旧技能文本。每个模块一行：旧职责（按它的能力导航注释与导出）、新 owner（`src/` 路径）、判定（`covered`、`recut`、`dropped`（指向 ADR 或能力卡）、`gap`）、gap 的处置。台账放在 `docs/references/legacy-alignment-ledger.md`；每发现一个 gap 就修在代码里并加回归，按模块组分批提交。

## 13.106 对齐台账 G1：managed-block 仓库与 external-owned 支撑面的托管块（2026-09-21）

**缺口。** 对齐台账（§13.105）首轮唯一的 `gap`：配置里 `repositories[].instructionManagement: managed-block` 与 external-owned 支撑面的 `instructionManagement: managed-block` 只进了 fresh selection 与 config document，没有写入器、没有对账消费者（`wakeflow-managed-support-resource-catalog.ts` 的注释说"由独立 consumer 处理"，但那个 consumer 不存在）。能力卡 1 §1 表第 29–30 行与需求 F1.5 都要求 managed-block 时写托管块。旧实现把仓库记忆与外部支撑面记忆当作 `managed-block` 组件，与程序记忆走同一套托管内容机制（参考副本 `core/scripts/lib/wakeflow-managed-content.mjs` `semanticMemorySpecs`，`wakeflow-rule-model.mjs` `renderRepositoryMemoryCandidate` 与 `renderSupportRoleMemoryCandidate` 的 external 分支）。

**实现。** 三个新模块加一个步骤种类，全部沿用程序指令的托管块机制（envelope、current→desired 转换、原子创建或 CAS 替换、读回闭合）：

- `src/workspace/managed-integration/wakeflow-external-instruction-body-authority.ts`：target 是 `repository` 或 `support-surface`；`listWakeflowExternalInstructionTargets` 按 Config 呈现顺序列出 managed-block 仓库与 external-owned managed-block 支撑面，owner-managed 与 wakeflow-managed 的根不产生 target；EN 与 zh-Hans 正文各两种（仓库：稳定身份、持久职责窗口、精确分配规则、仓库边界、安全边界；支撑面：稳定身份、权威边界、Design/Test 职责、支撑面边界、安全边界，角色段与 Wakeflow 管理面的整文件记忆相同）；envelope component `repository-instruction` / `support-instruction`，owner `host-instruction-integration`；摘要基础是程序 ID、targetKey、hostId、指令文件名、语言、windowIds 与正文摘要。
- `wakeflow-external-instruction-inspection.ts`：在调用方按 placement 打开的外部根里读当前宿主的指令文件；源文件必须是当前 euid 拥有的单链接普通文件，权限位不限（文件归外部所有者）；current Config 里该 target 不是 managed-block 时没有前序渲染，等价于 fresh 的空 current；错误分类与程序指令一致（`source`、`source-policy`、`source-capacity`、`envelope`、`unknown-managed-body`、`target-capacity`、`aborted`）。
- `wakeflow-external-instruction-recomposition.ts`：目标不存在时以 0644 原子创建、只含托管块；存在时以完整 StableFileSource 做 CAS 替换并保留所有者原有权限位；提交后重新检查并核对节点、摘要、权限与 envelope。
- 预览：每个 target 一步 `integration:external-instruction:<id>`（kind `recompose-external-instruction`，targetKey `repository:<id>` / `support-surface:<id>`），rank 11，排在 `recompose-program-instruction`（10）之后、`publish-support-memory`（12）与 `publish-config`（13）之前；blocker `external-instruction-<inspection reason>`、`-placement-unavailable`、`-root-missing`、`-root-unavailable`、`-root-close-failure`。执行器：按 targetKey 在 desired Config 里找 target、重算 authority 并与 `targetDigest` 比对、按 placement 打开外部根（继承工作区根的 durability）、重组、回执 `current` 或 `updated`。

**决定。**

- D1 正文只引用 primary pod 的持久窗口。worktree pod 的产品窗口随 pod 生命周期出现和消失；如果列进正文，用户仓库里被 Git 跟踪的 `AGENTS.md`/`CLAUDE.md` 会随每次 pod 创建与关闭变脏并要求用户提交。摘要基础不含 Config 摘要，pod 记录的变化不触发重组；正文用一句话说明其他 pod 的窗口在各自 worktree 里遵循同样的规则。回归 `pod records outside the primary pod do not change the repository instruction authority`。
- D2 外部根没有宿主专属短锁，也没有恢复 owner。外部根不在静态资源矩阵里，托管块的写入只在维护事务内发生，并发写入由 CAS 以 `conflict` 拒绝；未知暂存残留报 `recovery-required`（残余，见下）。
- D3 managed-block 仓库的根必须已存在，否则 blocker `external-instruction-root-missing`；owner-managed 仓库照旧只是引用，不要求存在（能力测试第二例）。
- D4 受管区域内的手改一律不覆盖：envelope 摘要失配按 `envelope` 拒绝（blocker `external-instruction-envelope`），自洽但不是任何已准入渲染的正文按 `unknown-managed-body` 拒绝。
- D5 不实现旧版 `remove-managed-block`：reconfigure 拒绝任何 topology 变化（`reconfigure-layout-change-unsupported`），政策无法从 managed-block 改回 owner-managed，所以没有需要删块的路径；仓库级 `.gitignore` 与 settings 授权按能力卡 1 §1 表第 30 行（fresh 授权列表固定为空）仍不实现。

**回归。** 新增 12 个测试，聚焦运行 12/12：正文权威 6（target 枚举与键、EN 仓库正文与摘要基础、pod 不变性、外部支撑面 Design 正文、zh-Hans、拒绝矩阵）；检查与重组 4（不存在即新建再 current、追加到所有者文本并保留 0664、准入的语言替换与手改/未知正文的拒绝、symlink/目录/外部 target/取消/支撑面新建）；能力级 2（`tests/capabilities/workspace/maintain-workspace-external-instruction.test.ts`：fresh preview 恰两步且顺序正确、外部根零写；apply 追加与新建、外部面无 scaffold；reconcile 零步与 `no-op`；删掉外部面文件后 reconcile 恰一步并原样重建；手改 `blocked`；仓库根缺失 `blocked`）。场景清单 §2 加 `card-01/external-managed-blocks`。

**门。** `npm run build:artifacts:committed` 3.5 s，两份制品各多 3 个编译文件、README 与 Controller 技能参考同步。`npm run smoke:artifacts` 两宿主七幕全部通过，17 s。首轮 `npm test` 在负载 16–18 的机器上跑了 633 s：984 通过、4 个测试撞 runner 的 60/120 s 超时被 cancelled、1 个锁测试 `timeout`（endpoint、observation、requirement 三个服务测试与 `rooted-exclusive-file-lock`），都不在本次改动的路径上；这四个文件单独重跑 26/26 通过（38 s）。全量门重跑（同一台机器，浏览器等其他负载仍在）：989/989 通过、0 cancelled，含 `build:check`，315.7 s 墙钟（§13.101 D10 (a) 之后的基线 265.5 s；差额来自机器上的外部负载，runner 自身仍是 8 核上 7 个 worker）。

**文档写回。** 对齐台账（gap 0、recut 73，三行改判并记处置）、能力卡 1 现 TS 状态、能力映射矩阵行 2、场景清单 §2、agent-text README（EN/zh）与 Controller 技能的工作区参考（托管块的仓库与外部面选择入口）、支撑资源目录的注释改为指向真实 consumer。

**残余。** 外部根的暂存残留没有恢复 owner（程序指令的恢复 owner 也尚未接线到公共 recover，两者一起处理）；真实 WakeWorkspace 上的托管块写入未执行（用户项）。

## 13.107 第二轮对齐 B 组：导出函数级核对与三处修复（2026-09-21）

**用户裁决。** 2026-09-21 回复"确认 继续"，采纳第二轮对齐的四条建议：D1 按旧模块的导出函数核对；D2 先核仍在运行时路径上的组（配置/布局/维护 → 治理 → 观察 → 宿主 → 技能文本）；D3 错误形状、磁盘布局与消息文本差异不算 gap，只有缺失的行为分支才算（TSD-03）；D4 每个模块组一批提交、一节 gate-log。

**核对结论（B 组 25 个模块，逐导出函数表在对齐台账 §3）。** 无 gap 的部分：配置解析器全部校验分支（字段集、typed id、引用与基数、residue 去重、tmux 名称、socket 词法、regex 编译）由 JSON Schema 与 `wakeflow-config.ts` 承担；快照、首次发布、锁内替换与恢复覆盖旧 owner 的 absent-only、0644、1 MiB、canonical bytes、program 身份不变与读回闭合（predecessor hard link 由 journal 前向恢复替代）；宿主启动偏好（`modelByRole`、`reasoningEffortByRole`、Claude `permissionMode` 与 tmux 名）在 `capabilities/endpoint/service.ts` 的执行说明里被消费；布局描述符的静态表面逐项对应到矩阵与各 catalog。三条配置词汇（`governance.audit.preservedReviewAfterDays`、`governance.validation.runtimeResidue`、`repositories[].validation.residueExceptions`）在两个实现里都没有行为消费者，记为"保留词汇、无行为"，是否删除留待用户裁决。

**三处首轮漏判的 gap。**

- G2 支撑面 scaffold 目录。旧 `wakeflow-support-materialization.mjs` 为 Design 面 ensure `drafts/`、为 Test 面 ensure `harnesses/` 与 `fixtures/`；能力卡 1 §1 产物表、能力卡 3 Q7、需求表与 Design 技能都要求它们，而新目录只声明根与记忆文件，场景测试自己 `mkdir drafts` 掩盖了缺失。修复：`wakeflow-managed-support-resource-catalog.ts` 为每个 wakeflow-managed 面加 scaffold 声明（0755，tracked），`materializeWakeflowManagedSupportRoot` 在根下 ensure 它们并在回执报 `scaffold[]`，新增只读 `inspectWakeflowManagedSupportRoot`（absent / current / incomplete / conflict）。
- G3 支撑面 `.gitignore` 托管块。旧 `ignoreSpecs` 为每个 Wakeflow 管理的支撑面写一个只含宿主本机设置路径（Claude `.claude/settings.local.json`）的托管块；工作区根 `.gitignore` 的规则是根锚定的，覆盖不到支撑面子目录，而新实现会把 portable settings 写进支撑面，宿主随后生成的本机设置文件会变成未跟踪噪音。修复：`wakeflow-support-gitignore-body-authority.ts`（从完整宿主画像集合取本机设置路径，没有则为 null）与通用的 `wakeflow-managed-block-file.ts`（任意根里一个文件的托管块检查与 CAS 重组：单链接、当前用户拥有、权限位不限；新建 0644、替换保留权限位、读回闭合），步骤种类 `recompose-support-gitignore`（rank 10，在工作区 `.gitignore` 之后、程序指令之前）。
- G4 对账自动修复范围。旧 reconcile 自动修复 `.wakeflow-local` 静态目录、支撑面目录、ledger 目录、active 布局与 TODO 板等（能力卡 1 §1.4），新预览对这些一律 blocker（`active-layout-unavailable`、`ledger-root-missing`、`support-root-missing`），宿主 capability 目录甚至不检查。首轮台账把 `wakeflow-reconcile.mjs` 判成 covered 是按场景 `reconcile-noop` 判的，函数级才看见修复分支缺失。修复：非 fresh 动作下活动布局 absent/incomplete 出 `materialize-active-layout`（core inspection 新增 `incomplete` 状态且不算 issue）、看板目录缺失出 `initialize-requirement-board`、ledger 根或固定容器缺失出 `materialize-ledger-layout`、宿主 capability 目录缺失出 `materialize-host-capability-layout`（新增 `inspectWakeflowHostCapabilityLayout` 与 `ensureWakeflowHostCapabilityLayout`）、支撑面根或 scaffold 缺失出 `materialize-support-root`；执行器对非 fresh 动作放开严格不存在要求。只报告不修复：宿主运行时根缺失 `window-runtime-missing`（能力卡 1 §1.4 实现判断：投影不由对账重建）、节点政策冲突 `*-conflict`、托管块手改、维护协议根异常（gate 自身依赖它）。

**决定。**

- D5 检查与 ensure 只看声明的目录本身、不枚举运行内容：第一版 `inspectWakeflowHostCapabilityLayout` 复用了 fresh 恢复的整树核对，场景 `card-09/status-and-verify` 立刻把带租约文件与 pod 回执的活工作区判成 `host-capability-layout-conflict`；改为逐声明 `optionalDirectory` 与 `materializeDirectoryPath` 后场景恢复 20/20。
- D6 整个 ledger 根缺失时 reconcile 重建空的三个容器（旧行为），不阻塞；`card-01/reconfigure` 的 `storage.ledgerRoot` 改动因此只剩 `reconfigure-layout-change-unsupported` 一个 blocker（场景与场景清单同步）。
- D7 `wakeflow-managed-block-file.ts` 是新的通用托管块文件 owner；§13.106 的外部指令 inspection/recomposition 仍保留专用实现，合并到通用 owner 留作后续整理项，不在本批做。
- D8 窗口投影 stale/missing 的显式报告（能力卡 1 §1.4 实现判断）未接线，留到 F 组核对投影模块时一起做。

**回归。** 新增或改写：支撑目录与根物化测试（scaffold 声明顺序、创建/补齐/冲突、Test 面两目录）、宿主 capability 检查与 ensure（活内容不算冲突、缺失补齐不动兄弟、文件占位冲突、前置缺失）、支撑面 `.gitignore` 权威与通用托管块文件（新建 0644、追加保留 0664、current、手改 envelope、未知正文、取消）、预览（reconcile 修复步骤顺序与 `window-runtime-missing`、fresh 十七步）、执行器（十七回执）、核心布局 `incomplete`、能力级 `maintain-workspace-reconcile-repair.test.ts`（fresh 产物齐全 → 删七类 → 七步修复 → 再次零步 no-op → 手改与文件占位只报告；ledger 整根重建；宿主运行时根缺失只报告）。场景 20/20（`card-09` 在 D5 之后通过）。场景清单 §2 加 `card-01/reconcile-repair`。

**门。** `npm run build:artifacts:committed` 后 `npm test` 994/994（含 `build:check`），377.0 s 墙钟（浏览器等外部负载仍在，load 14–20；§13.106 为 315.7 s）；`npm run smoke:artifacts` 两宿主七幕全过；`git diff --check` 干净。首轮中 `card-09/status-and-verify` 因 D5 前的整树核对判 `host-capability-layout-conflict` 失败，修正后场景 20/20。

**文档写回。** 对齐台账 §1 第二轮小结与 §3 B 组函数级表；能力卡 1 §1.1 物化步骤十五种与 §1.4 对账修复/报告集；场景清单；Controller 技能工作区参考的 reconcile 条目；制品重建。

**残余。** 三条无消费者的配置词汇待裁决；外部指令模块与通用托管块文件 owner 的合并；窗口投影 stale/missing 报告（F 组）；维护协议根缺失时 reconcile 仍阻塞。

## 13.108 第二轮对齐 C 组：活动投影、账本、TODO 与归档的函数级核对与 G5（2026-09-21）

**核对结论（C 组 11 个模块，逐导出函数表在对齐台账 §3）。** 无 gap 的部分：活动投影的零写入检查与重建（三诊断轴归 `observeProjectionTargets` 与 `projectionFreshness`，unsafe 整轮零写归内核；旧公共 runtime 每个公共操作后的 rebuild 对应 `afterMutationRefresh` 在维护 apply 与九个 capability 收尾的调用）；ledger 记录的严格加载、幂等发布、异字节 conflict、成员引用与发布锁（归档包不加锁，靠候选目录 rename 的 `destination-exists` 判竞态）；归档服务的四个入口（plan → `planTerminal` 九门加隐私加包 claim 加 `archive-conflict`；commit → `applyTerminal` 的 journal → 终态事件 → 封包 → 结包 → 释放声明 → 退役活动根；recover → journal 重放或按已在归档收敛；inspect → status/verify 带 demandId 的归档回执）；TODO 服务的认领 CAS、归档消费与恢复 seam 在看板 claim state 链上逐条对应，TODO 摄入、行级 codec、ledger 四个 Markdown 索引、迁移归档共存按 ADR-0011 与首轮判定继续 dropped。台账 §2 三行 owner 引用改正：仓库里没有 `governance/archive/*` 与 `governance/demand/lifecycle/*` 目录，归档 owner 是 `capabilities/demand/archive.ts`、`demand-archive-manifest.schema.json` 与 `capabilities/demand/decide.ts`。

**G5 reconcile 重建窗口运行投影。** 旧 `rebuildWindowRuntimeProjections` 在运行时事务里把 missing/stale 的窗口运行投影收敛到当前派生结果、unsafe 原样保留；旧 reconcile 经 `inspectWindowRuntimeProjectionsForLayout` 盘点后把重建放进维护计划。新实现只在登记/换代/退役后重写该窗口的投影，reconcile 对已登记窗口的缺失或过期投影既不修也不报（§13.107 D8 记为"留 F 组"）。修复：新增 `workspace/window-runtime/wakeflow-window-runtime-projection-document.ts`（单个投影文档的只读检查 current / stale / missing / unsafe 与 0600 发布，`publishProjectionDocument` 改为委托它）与 `wakeflow-window-runtime-projection-maintenance.ts`（从 config、宿主资源 profile 与 binding 清单重算每个窗口的期望投影，缺失或过期出一条 `window-runtime-projection:<windowId>` 宿主操作，sourceDigest 与 targetDigest 钉住，执行时重算不符即 `plan` 失败；读不出的投影出 blocker `window-runtime-projection-unsafe`；binding 清单读不出出 `window-runtime-projection-unavailable`；fresh 与宿主运行时根缺失时贡献为空）。两宿主接线：Claude 的维护 capability 把投影操作并入贡献并在 portable settings 之前分派；Codex 新增第一个宿主 capability `codex-maintenance`（`hosts/codex/codex-maintenance-capability.ts`），fresh 时贡献为空，`codex-maintenance-execution.ts` 把它交给共享预览、执行与恢复。

**决定。**

- D1 投影按旧行为自动修复，不按能力卡 1 §1.4 原"实现判断"只报告：投影是从 config 与 binding 权威确定性重算的派生数据，重建不会掩盖任何用户内容；读不出（unsafe）仍只报告。能力卡 1 §1.4 现 TS 状态同步。
- D2 重建走宿主 maintenance capability 端口而不是共享静态预览：窗口宿主身份 profile（`codexWindowHostIdentityProfile` / `claudeCodeWindowHostIdentityProfile`）住在 `hosts/<host>/`，共享层不能推断宿主；共享逻辑放在 `workspace/window-runtime/`，两宿主各自只做接线。Codex 因此第一次有了自己的 capability，`codex-maintenance-execution.test.ts` 的 fresh 断言从"无宿主贡献"改为"空贡献"。
- D3 G6：旧 `wakeflow_status` / `wakeflow_verify` 有 `window-runtime` 域（health 与 `window-runtime-projection-not-current`），新观察只报 binding 身份、没有 window-runtime 门。它是观察模块的分支，按 D2 顺序留到 F 组（观察）一并处置，台账 §3 记 `gap`，模块级判定不变。
- D4 §13.107 D7 的通用托管块文件 owner 合并（外部指令 inspection/recomposition）继续延后，本批不做。

**回归。** 新增 `tests/workspace/window-runtime/wakeflow-window-runtime-projection-maintenance.test.ts`（缺失与过期修复、unsafe 只报告、fresh 空贡献）；`maintain-workspace-reconcile-repair.test.ts` 新增"登记一个窗口后删掉或改坏其 registered 投影，reconcile 恰一条 `window-runtime-projection` 宿主操作并逐字节复原，投影读不出只报 `host:codex:codex-maintenance:window-runtime-projection-unsafe`"；`codex-maintenance-execution.test.ts` 改为断言空 Codex 贡献。相关焦点集（endpoint service、Claude 维护执行、静态预览与执行器、Codex 维护执行、对账修复、投影维护）21/21。

**门。** `npm run build:artifacts:committed` 后 `npm test` 996/996（含 `build:check`），`test:typescript` 347.6 s；`npm run smoke:artifacts` 两宿主七幕全过（17 s）；`git diff --check` 干净。lint 只有 `rooted-exclusive-file-lock.ts:724` 一条既有 warning（本批未改该文件，自 0d9d2a57 起存在），不阻门。

**文档写回。** 对齐台账 §1 第二轮小结、§2 三行 owner 改正与 C 组两行备注、§3 C 组函数级表；能力卡 1 §1.4 窗口投影修复/报告集；场景清单 `card-01/reconcile-repair` 行；Controller 技能工作区参考的 reconcile 条目；制品重建。

**残余。** G6（观察侧窗口投影新鲜度）待 F 组；三条无消费者的配置词汇待裁决；外部指令模块与通用托管块文件 owner 的合并；维护协议根缺失时 reconcile 仍阻塞。

## 13.109 第二轮对齐 D 组：Demand、结果、评审与证据的函数级核对（2026-09-21）

**核对结论（D 组 13 个模块、约 90 个导出函数，逐函数表在对齐台账 §3）。** 没有新的 gap。分域小结：

- 制品 codec 与服务：六类旧制品里任务包、结果、测试合同各有 owner（`governance/tasking`、`governance/result`、测试合同并入 test 任务包与后验收路线的测试环境 authority）；Pod Design 请求 / 交付按 ADR-0010 放弃；ReviewCandidate 不再是制品，决定针对从历史重建的评审快照。写入意图、按 ref 读取、六类库存分别落在发布 / 证据事务、任务包投影 store 与证据记录 reader、根库存与 verify 门 `demand-root-audit`。
- 核心记录与单根事务：五类核心记录对应身份、authority、聚合状态、事件（含版本 codec 与 upcaster）与 append candidate；`validateDemandCoreStack` 的跨记录闭合由仓库加载（快照还原加事件重放加 `stateDigest`）承担；旧 journal → 制品 → 事件 → 快照 → 闭包检查的固定次序压成 `kernel/append-command.ts` 加事件流 commit，闭包检查改到 verify 门；owner 专用的提交 / 恢复缝对应聚合状态的各转换函数；Pod 转换放弃；`freezeDemandAuthority` 随发布 stage 一起写（认领即创建）。
- 生命周期与发布：complete / cancel 的准入、原子提交、恢复在 C 组已核；本组补核旧"终态提交后删除 exact lease"分支——新实现取消时释放本 Demand 的窗口工作声明，完成时要求 verify 门 `work-claims-released` 先过（结果导入提交后即 `releaseWorkClaimIfHeld`，残留由 endpoint `release-claim` 处理），判 recut。初次发布的固定锁序、幂等确认与无 journal 零写入恢复对应 `publishDemandFromPackage` 与 `recoverDemandPublication`。
- 结果评审：导入后释放投递声明保留；dispatch group、候选制品与 Controller-return transport 按 ADR-0012 重切为按目标评审与随导入签发的回调（回调记录、代际上限、静默窗、落地证据、重发），投递侧分支留 E 组核。
- 证据：三个旧模块的来源捕获、隐私拒绝、stage / final 树、残留拒绝、exact replay、恢复 authority、成员严格读取与库存分类在 `governance/evidence/*` 十九个模块里逐项对应，来源种类是超集（managed-path、observation、link、commit）。

**决定。**

- D1 完成不再自动删 lease：门加显式释放比旧的隐式删除更保守（一个仍被持有的工作声明说明有投递尚未收口），不算缺失分支。
- D2 dispatch group、ReviewCandidate 制品、Controller-return transport 三者是同一条旧链路的三个形状，新实现的按目标回调覆盖同一业务分支（导入 → 通知 Controller → 决定），不单列 gap。
- D3 本批只有文档：台账 §1 小结、§2 生命周期行 owner 改正（仓库里没有 `governance/demand/lifecycle/*`）、§3 D 组表。没有代码或制品改动，不重跑 `npm test` 与 smoke，只跑 `git diff --check`。

**门。** `git diff --check` 干净；`npm test` 与 smoke 沿用 §13.108（996/996，两宿主七幕全过），本批无代码改动。

**残余。** 同 §13.108：G6（观察侧窗口投影新鲜度，F 组）；三条无消费者的配置词汇待裁决；外部指令模块与通用托管块文件 owner 的合并；维护协议根缺失时 reconcile 仍阻塞。下一组 E（投递、窗口、租约与宿主激活）。

## 13.110 第二轮对齐 E 组：投递、窗口、租约与宿主激活的函数级核对（2026-09-21）

**核对结论（E 组 13 个模块、约 100 个导出函数，逐函数表在对齐台账 §3）。** 没有新的 gap。分域小结：

- 投递：旧五阶段（plan → apply → claim → outcome → rearm）对应 `prepare_delivery`（阻塞项派生、信封由任务包派生、工作声明独占创建即围栏、prepared 事件、失败回滚声明、按客户端幂等键重放许可）、`record_delivery_outcome`（处置由目标会话 hook 记录 / Codex 发送返回 / Controller 解决派生，只有 rejected-before-send 释放声明，静默超阈值把 next 转给 Controller）与 `rearm_delivery`（同信封新代际，上限由声明代际上限派生）。没有独立的零写入 plan 预览：prepare 本身幂等，判 recut 不判 gap。
- transport 记录与 store：group / packet 不再存在（一次投递一个目标，任务包是合同来源）；envelope 与 run 成为 Demand 事件流里的事件（append candidate → commit），run 链的连续性由事件顺序与声明代际承担；strict inventory 与 layout 诊断由事件流读取与根库存承担；修剪并入完成 / 取消事务的 `retireDemandRoot` 与 pod close 的回执清理。
- 窗口绑定与租约：记录 codec、inventory、注册 / 替换 / 退役、租约获取 / 释放逐条对应 `wakeflow-window-host-binding*.ts`、端点服务与 `kernel/work-claims.ts`；Pod owner 的窄缝改为同一端点工具带 pod 准入；宿主退役结果记录并入端点 decommission 的 closure 证据与 liveness 分类；私有 handle 不进公共结果（只带 handleDigest）。
- keep-live 两模块与宿主激活两模块维持首轮 dropped（能力卡 10 Q1 / Q2、TSD-12、ADR-0008），函数级没有需要保留的分支。

**决定。**

- D1 投递 prepare 不补零写入预览：prepare 的写入（信封事件 + 声明）按客户端幂等键重放，重复调用不产生第二次宿主效果；一个只读 plan 的价值只剩"看阻塞项"，而阻塞项在 prepare 被拒时逐条返回。若用户希望有预览，加在 `prepare_delivery` 上是一个小改动，留待裁决。
- D2 修剪不恢复为独立操作：旧 retention 的 eligible / blocked / source-absent 三分支在新实现里没有对象（归档时活动根已删，pod 回执随 close 删），D17 维持。
- D3 本批只有文档：台账 §1 小结与 §3 E 组表；没有代码或制品改动，不重跑 `npm test` 与 smoke，只跑 `git diff --check`。

**门。** `git diff --check` 干净；`npm test` 与 smoke 沿用 §13.108。

**残余。** 同 §13.109，另加 D1 的预览裁决项。下一组 F（Pod、观察与公共运行时），其中含 G6。

## 13.111 第二轮对齐 F 组：Pod、观察与公共运行时的函数级核对与 G6（2026-09-21）

**核对结论（F 组 6 个模块、约 55 个导出函数，逐函数表在对齐台账 §3）。** 一处 gap（G6，C 组核出、本组修）；其余：pod 记录与服务的窗口物化链、Design 交接、Test access、close intent / receipt 分别重切为配置 `pods[]` 加 worktree 回执、端点登记与退役证据、两段关闭（ADR-0010），Test access 与 Design 交接放弃（矩阵行 29）；观察的一次采集多域与 status / verify 投影对应 `observeWorkspace` 与 `assembleStatus` / `assembleVerify`；旧 verify 十七门映射为十四门（合并 owner-contract / layout-manager / managed-drift 进 local-layout，active-authority / transport-authority 进 demand-stream 两门，repository-roots / repository-owner 进 pod-execution-location，coordination-leases 改 work-claims；config-service、maintenance-gate、storage-inventory 放弃）；preservation 与 legacy 分类目录维持 dropped；公共 runtime 的 29 个处理器对应 20 个工具（能力映射矩阵）加 `afterMutationRefresh`。

**G6 观察侧窗口运行投影新鲜度。** 旧 `wakeflow_status` 有 `windowRuntime` 域（health、projectionStatus），旧 `wakeflow_verify` 有 `window-runtime-projection` 门（`window-runtime-projection-not-current`），都由 `inspectWindowRuntimeProjectionsForLayout` 供数；新实现的观察只报 binding 身份。修复：`wakeflow-window-runtime-projection-maintenance.ts` 抽出零写入的 `inspectWakeflowWindowRuntimeProjectionSet`（与 G5 对账共用同一份重算与判定；尚无 Binding 目录的宿主只有未登记投影，不算 inventory 读不出），`workspace-observation.ts` 为每个宿主加 `projections` 域，`wakeflow_status.windows[].projection` 逐窗口报各宿主里最差的一份（current / stale / missing / unsafe / unavailable），`domains.windowRuntime` 报域可用性，缺失或过期把 next 指向维护（reconcile 重建，G5），`wakeflow_verify` 补回 `window-runtime-projection` 门（owner `window-runtime`，code `<host>:<windowId>:<status>`，宿主读不出 `<host>:<issue>`）。status 结果 Schema 加 `windows[].projection` 与 `domains.windowRuntime`（`npm run schema:build`）。

**决定。**

- D1 同伴宿主的运行时根缺席保持沉默：Codex 初始化的工作区没有 Claude 的运行时根（hook 通道 §13.97 D10 已按同一事实裁决），所以只有当前宿主的根缺席算 `runtime-missing` 读不出；同伴宿主记 `runtime: absent`、观察为空。第一版把它算成 unavailable，`status` 的 overall 变 degraded、verify 十四门不再全过，场景与服务测试立刻暴露。
- D2 门的聚合沿用既有规则：fail 压过 unavailable（一个宿主有过期窗口、另一个读不出时报 fail 并把两者都写进 code）。
- D3 unsafe（读不出或不是确定性 JSON 的投影）只报告：status 报 unsafe、verify fail，但 next 不指向维护，因为 reconcile 修不了它（G5 D1）。
- D4 `deriveOverallStatus` 把任一宿主的投影域不可用算作 degraded，与其他域一致；stale / missing 不影响 overall，由 verify 与 next 承担。
- D5 pod 的配置事务收尾收敛本宿主的窗口投影：每份投影的 `sourceFingerprints.desiredTopologyDigest` 覆盖整个期望拓扑，pod 创建 / 关闭增减窗口后其余窗口的投影全部过期，G6 的门一接上，场景 `card-09` 的 next 就从 `pod-window-registration` 变成了 `workspace-maintenance`。修复：`refreshWakeflowWindowRuntimeProjections`（缺失或过期即重发布，unsafe 原样，根未发布不写）在 pod create / close-request / close-complete 的 `replaceConfig` 之后调用，失败只由 verify 报出、中止仍上抛（与活动投影刷新同一裁决）。不改投影指纹：那是 ADR 级的合同变更。被关闭 pod 的窗口投影文件留在磁盘上不再被观察（不枚举投影目录），记为残余。
- D6 依赖规则 `transitional-governance-uses-only-workspace-contract-seams` 拒绝观察直接取维护模块：把重算与逐窗口比对抽成只读缝 `wakeflow-window-runtime-projection-inspection.ts`（列入 `GOVERNANCE_WORKSPACE_CONTRACT_TARGETS`，与 binding store 同级），维护模块只剩 plan / execute / refresh；错误类随之改名 `WakeflowWindowRuntimeProjectionError`（两宿主 capability 与测试同步）。

**回归。** `decide.test.ts`：十四门全 pass、新门的 pass / fail / unavailable 与 code 组合；`service.test.ts`：十四门；场景 `card-09` 门清单加一；`maintain-workspace-reconcile-repair.test.ts` 的投影用例在每一步加观察断言（健康 current / pass / next 不指维护 → 缺失 missing / fail 点名 / next 指维护 → 修复后 current / pass → 过期同 → unsafe / fail / next 不指维护）；`active-projection-facts.test.ts` 的观察 fixture 加 `projections`；`pod/service.test.ts` 的 create 用例断言八个窗口的投影在配置事务后全部 current（D5）；场景 `card-09` 的三处汇总 13 → 14。

**门。** `npm run build:artifacts:committed` 后 `npm test` 997/997（含 `build:check`），`test:typescript` 319.3 s、整门 330 s；`npm run smoke:artifacts` 两宿主七幕全过（19 s）；`git diff --check` 干净。三轮：第一轮架构检查拒绝观察取维护模块（D6）；第二轮 `card-09` 的 next 变成 `workspace-maintenance`（D5 的根因，pod 创建后其余窗口投影过期）；第三轮只剩场景里钉死的 13 门计数，改 14 后全绿。lint 仍只有 `rooted-exclusive-file-lock.ts:724` 一条既有 warning。

**文档写回。** 能力卡 9 §现 TS 状态与实现判断（十四门、status 字段）；能力卡 1 §1.4 观察侧一句；能力映射矩阵行 31；场景清单 `card-09` 行；Controller 技能工作区参考（status 的窗口投影新鲜度、verify 点名与 reconcile 重建）；对齐台账 §1、§2 观察行、§3 F 组表；制品重建。

**残余。** 三条无消费者的配置词汇待裁决；外部指令模块与通用托管块文件 owner 的合并；维护协议根缺失时 reconcile 仍阻塞；§13.110 D1 的投递预览裁决项。函数级 gap 归零；剩余组 A（基础原语，首轮多为 covered）、G（迁移，dropped）、H（入口与 MCP）、I / J（宿主）、K（技能文本）。

## 13.112 第二轮对齐收尾：A、G、H、I、J、K 组的函数级核对（2026-09-21）

**核对结论（六组 46 个模块 / 文件，逐函数表在对齐台账 §3）。** 没有新的 gap；第二轮至此把 117 行、约 420 个导出函数全部核完，函数级 gap 归零（G1–G6 已修）。分组小结：

- A 基础原语：原子写（stage、digest 期望、重验）、canonical JSON、typed id、制品树身份、投影锁逐条对应；路径安全从"路径函数"改为根作用域句柄；进程身份只保留 pid / 线程 / token 与 `process.kill(pid, 0)`，argv 与父进程比对维持 dropped（方向保守）；state 锁改为异步带超时的独占文件锁与各发布锁。
- G 迁移：十个模块全部 dropped（ADR-0008 决定 1），fresh 发现 Wakeflow 标记只拒绝并列出。
- H 入口与 MCP：输出脱敏（`command-shell.ts` 的 output-boundary / privacy-violation）、31 → 20 的工具路由、fresh / reconfigure / reconcile 的独立权限面、证据路由、工具 annotations（`tool-registry.ts` 校验 openWorldHint 恒 false、只读工具三项一致）都有 owner；手写 JSON-RPC 换官方 SDK；validate 的 17 类静态校验拆到 `check-plugin-artifacts.ts`、`tests/artifacts/*`、dependency-cruiser、knip 与 Biome；smoke 四幕变七幕；六个只读 git spawn 里 HEAD / 分支改为直接读 `.git`，工作树脏状态、upstream、ahead / behind 按能力卡 9 Q1 放弃。
- I / J 宿主专属：locator 记录与 pane 分类（同一判定顺序）、settings 保守合并与 statusline 资产、退役证据、pod 会话物化各有 owner；活动监视、prompt 临时文件、transport 粘贴 / 回读、窗口标题与排列、宿主命令路由按 TSD-12 与 ADR-0009 交给 Agent 与 hook 记录；激活范围与迁移维持 dropped。
- K 技能文本：Controller / Design / Target / Test 四份技能与六份参考承接旧文本的程序内容（澄清 / 选项 / 切片压进需求包分节，七项实践压进 craft，调试分类 / 风险 / 回归 / 自审压进测试执行）；治理技能与进度页模板 dropped（§13.99 D1、§13.101 D1）。

**决定。**

- D1 `probeWakeflowProcessSubject` 维持 dropped：可执行文件 / argv / 父进程比对只会让"锁仍活跃"的判断更激进，Wakeflow 的锁只允许保守错误。
- D2 六个 git 查询里放弃的三项（脏状态、upstream、ahead / behind）不回补：能力卡 9 Q1 禁止观察 spawn git；直接解析 `.git` 拿不到工作树脏状态与 ahead / behind，upstream 只值得在需要时作为读 `.git/config` 的独立议题提出。
- D3 本批只有文档：台账 §1 收尾小结与 §3 六组表；无代码或制品改动，不重跑 `npm test` 与 smoke，只跑 `git diff --check`。

**门。** `git diff --check` 干净；`npm test` 与 smoke 沿用 §13.111（997/997，两宿主七幕全过）。

**残余（第二轮结束时的全集）。** 三条无消费者的配置词汇（`governance.audit.preservedReviewAfterDays`、`governance.validation.runtimeResidue`、`repositories[].validation.residueExceptions`）待裁决；外部指令 inspection / recomposition 与通用托管块文件 owner 的合并；维护协议根缺失时 reconcile 仍阻塞；§13.110 D1 的投递 prepare 预览裁决项；被关闭 pod 的窗口投影文件留在磁盘（§13.111 D5）；用户侧待做：真实 `WakeWorkspace` 初始化 / 删除重建 / reconfigure / reconcile、每宿主一次真实投递并取回 hook 证据、真实 Claude 会话的状态栏、`git push`、tag `v1.0.0`、发布与本地缓存刷新（plan §14 第 12 项）。

## 13.113 配置词汇裁决：删除三条无消费者的治理与残留字段（2026-09-21）

**用户裁决。** 2026-09-21 回复"确认 继续"，采纳 §13.112 之后提出的三条建议：D1 删除 `governance.audit.preservedReviewAfterDays`、`governance.validation.runtimeResidue`、`repositories[].validation.residueExceptions`；D2 `wakeflow_prepare_delivery` 不加 preview 模式，维持按客户端幂等键重放；D3 三项内部整理做成一批（外部指令模块并入通用托管块文件 owner、维护协议根缺失时 reconcile 不再阻塞、被关闭 pod 的窗口投影文件退役），记 §13.114。本节只做 D1，D2 无代码。

**改动。** Schema `wakeflow-config.schema.json`：`governance` 改为保留的空对象（`additionalProperties: false`、无属性），`repository` 去掉 `validation`，连同只有它们引用的定义一起删除（`auditGovernance`、`validationGovernance`、`runtimeResidue`、`runtimeMatcher`、`substringRuntimeMatcher`、`regexRuntimeMatcher`、`regexPattern`、`repositoryValidation`、`residueException`、`repositoryChildPath`），`npm run schema:build` 重生成类型；解析器去掉残留路径的 placement 校验与去重；文档渲染器 `governance` 固定渲染 `{}`、仓库表示去掉 `validation`。带旧字段的配置读取时按未知字段拒绝（Schema 封闭字段集），没有 upcaster（ADR-0008）：现存工作区只能重新初始化，目前只有测试与冒烟工作区受影响，真实 `WakeWorkspace` 尚未初始化过新版。

**决定。**

- D1 `governance` 不整体删除：它是顶层必填字段，删掉会改变每份配置文档与所有钉死的配置摘要；保留为空对象既是最小改动，也是将来治理词汇的扩展点。
- D2 三条词汇的旧消费者（preservation、legacy transform、residue 计数）全部已随 ADR-0006 / ADR-0008 放弃，删除不损失任何行为分支；对齐台账 §3 B 组该行由 covered 改 dropped。

**回归。** `wakeflow-config.test.ts`：Schema 用例改为"带治理词汇或仓库 validation 即未知字段"，去掉 regex 编译与残留去重两个用例；`wakeflow-config-document.test.ts`：去掉两类字段，改断言 `"governance": {}` 与仓库描述照常渲染；配置焦点集 15/15。

**门。** `npm run build:artifacts:committed` 后 `npm test` 997/997（含 `build:check`），`test:typescript` 313.9 s、整门 324 s；`npm run smoke:artifacts` 两宿主七幕全过（20 s）；`git diff --check` 干净。

**文档写回。** 能力卡 1 §1.2 现 TS 状态（schema 路径与词汇删除）、能力卡 8 现 TS 状态、对齐台账 §3 B 组行、本节。

## 13.114 内部整理一批：外部指令并入通用托管块 owner、对账重建 `.wakeflow-local`、退役关闭 pod 的投影（2026-09-21）

**用户裁决。** §13.113 记录的 D3：三项内部整理做成一批。

**D1 外部指令模块并入通用托管块文件 owner。** `wakeflow-external-instruction-inspection.ts` 与 `-recomposition.ts` 曾各自实现稳定读取、双读复验、current→desired 转换、原子创建 / CAS 替换与读回闭合，与 §13.107 G3 的通用 `wakeflow-managed-block-file.ts` 重复。现在两者只做领域部分——请求准入、从 current / desired Config 推导两份正文权威、把结果套回外部指令的合同——机械部分交给通用 owner（2 MiB 上限、新建 0644、替换保留权限位）。错误词汇按调用方钉死的形状映射（只读：同名；重组：读取类统一 `source-invalid`、容量统一 `capacity`），预览的 `external-instruction-<reason>` blocker 与场景 `card-01/external-managed-blocks` 不变。重组模块 380 行降到 250 行，只读模块去掉全部 I/O。

**D2 对账重建 `.wakeflow-local`。** 旧 reconcile 自动修复 `.wakeflow-local` 静态目录（§13.107 G4 只补了 capability 目录，宿主运行时根与维护协议根仍只报告）。现在：

- 维护协议根缺失（`absent`）或只剩空前缀（`bootstrap-prefix`）：预览为非 fresh 动作也出 `materialize-local-protocol` 步骤；维护 gate 加 `bootstrap: "fresh" | "repair"` 选项，事务按动作传入——repair 模式接受协议根缺失而其他 Wakeflow 目录仍在（fresh-compatible 不再是前提），busy / recovery-required / conflict 两种模式都拒绝；物理创建仍由 gate 引导，步骤只核对结果。
- 宿主运行时根缺失（`prerequisite-missing`）：预览为非 fresh 动作出 `publish-unregistered-window-runtime` 步骤，`materialize-host-capability-layout` 依赖它。执行器在非 fresh 时不再走 fresh 发布（它要求 inventory 为空），改调 `ensureWakeflowWindowRuntimeSkeleton`：幂等补齐 fresh 同一组六个 0700 目录，只发布缺失的未登记投影，已有投影一律不动。仍有 Binding 的窗口由宿主 capability 的逐窗口操作在同一事务里重建 registered 投影：`planWakeflowWindowRuntimeProjectionMaintenance` 在运行时根缺失时按 `projectionRootRequired: false` 重算期望，只为已登记窗口出操作。
- 整个 `.wakeflow-local` 被删也是同一条路：协议根、共享协调目录、运行时骨架与 capability 目录在一次对账里全部重建，第二次预览零步。

**D3 退役关闭 pod 的投影文件。** pod close-complete 把窗口移出配置后，本宿主按被移除的 windowId 精确删除投影文件（`retireWakeflowWindowRuntimeProjections`，`unlinkRegularFileExactly` 钉住节点，不枚举投影目录）；与 §13.111 D5 的刷新同一裁决：失败不让配置事务失败，中止上抛。同伴宿主根里的同名文件留给该宿主的 close 路径（它没有跑过）——记为残余。

**回归。** 外部指令三份测试原样通过（错误词汇、disposition、权限位）；`maintain-workspace-reconcile-repair.test.ts` 第三个用例改写：ledger 根 → 宿主运行时根（骨架 + capability 两步、投影全数复原、keep-live 目录在）→ 维护协议根（只剩协议一步）→ 整个 `.wakeflow-local`（协议、骨架、capability 齐出）各自重建后零步；静态预览测试的运行时根缺失用例从 blocker 改为步骤（骨架排在 capability 之前，dependsOn 指向它）；`pod/service.test.ts` 生命周期用例断言关闭后四个窗口投影文件消失、primary 的四个仍在。焦点集 47/47。

**门。** `npm run build:artifacts:committed` 后 `npm test` 997/997（含 `build:check`），`test:typescript` 299.0 s、整门 313 s；`npm run smoke:artifacts` 两宿主七幕全过（19 s）；`git diff --check` 第一遍抓到 Biome 整理导入时把两个 `requirement-board` 导入合并成带尾随空白的一行（执行器第 55 行），手工拆回两行后干净，制品重建后 `build:check` 仍过。

**文档写回。** 能力卡 1 §1.4 现 TS 状态（对账修复集与只报告集）；场景清单 `card-01/reconcile-repair` 行；Controller 技能工作区参考的 reconcile 条目；对齐台账 §3 B 组 reconcile 行与 F 组 pod 关闭行；制品重建。

**残余。** 同伴宿主根里被关闭 pod 的投影文件；部分缺失（只删 identity 或 projections 子目录）走同一骨架路径但未单独测试；用户侧待做项不变（真实 WakeWorkspace、真实投递、Claude 状态栏、push / tag / 发布 / 缓存）。

## 13.115 真实工作区验证：`WakeflowTestWorkspace` 两宿主七幕加对账修复与重配置；工作区根须是 Git 仓库（2026-09-21）

**用户环境。** 用户新建 `WakeflowTestWorkspace`（与 `Wakeflow` 仓库同级）作为一次性验证环境：根目录里是五个产品仓库副本（Alembic、AlembicAgent、AlembicCore、AlembicDashboard、AlembicPlugin，各自是干净的 Git 仓库，`main`），根本身不是 Git 仓库，没有任何 Wakeflow 标记。验证用一个临时驱动脚本（会话 scratchpad，不进仓库）把 committed 制品复制到仓库外，按 smoke 同一方式经 stdio 起 MCP 服务并逐工具调用；selection 为五个 owner-managed 仓库（各一个 product 窗口）、Design / Test 两个 wakeflow-managed 面、`Ledger`、`zh-Hans`。

**过程与结果。**

1. fresh preview（Codex）在未 `git init` 的根上零写，唯一 blocker `gitignore-git`：Wakeflow 靠 Git 自己判定托管 `.gitignore` 块，根不是仓库时 Git 以 128 退出。这条前提在 README、init 命令与 Controller 技能里都没写，blocker 也分不清"不是仓库"与"Git 失败"。在根上 `git init` 后继续。
2. fresh preview 就绪：17 步、8 条启动意图，零写；apply 完成，根下出现 `.gitignore`、`.wakeflow-active`、`.wakeflow-local`、`AGENTS.md`、`Design/`（含 `drafts/`）、`Ledger/`（三容器）、`Test/`（含 `harnesses/`、`fixtures/`）、`wakeflow.config.json`；五个产品仓库无任何改动（owner-managed）。
3. reconcile preview 零步、apply `no-op`。`wakeflow_status`：overall `idle`，8 窗口 unregistered 且投影 current，1 primary pod creating，5 仓库 observed 各带 HEAD 与分支，next 指向窗口登记；`wakeflow_verify` 14/14（`host-hook-channel` 报 `codex:absent` 直到 hook 记录落地）。
4. `wakeflow_pod` create preview 就绪：8 窗口、5 条 worktree 意图，零写。Codex hook observer 以 SessionStart 载荷落一条记录，随后 verify 14/14 无 code。
5. 删掉整个 `.wakeflow-local` 后 reconcile preview 出四步（协议根、共享协调目录、宿主运行时骨架、capability 目录），apply 完成，再预览零步——§13.114 D2 在真实目录上成立。
6. Claude Code 制品对同一工作区 reconcile：骨架与 capability 目录、`CLAUDE.md` 托管块、两个支撑面记忆、三份 portable settings、statusline 资产与本地设置条目共十步，apply 完成；Claude 视角 status / verify 14/14（`host-settings-assets=pass`），Claude hook observer 落地一条记录。
7. reconfigure（改 displayName）：preview 四步（程序指令、两份支撑面记忆、config），apply 完成，status 显示新名字、8 个投影仍 current、verify 14/14；随后 reconcile 零步。

未执行、留给用户：真实宿主会话（开窗口、登记、投递取回 hook 证据、Claude 状态栏显示）。

**决定。**

- D1 工作区根必须是 Git 仓库是前提而不是缺陷：托管 `.gitignore` 块只有在 Git 仓库里才有意义。补三处文本（README 两语、init 命令、Controller 技能工作区参考）让 Agent 在预览前说清并让用户 `git init`。
- D2 `.gitignore` 检查在读源文件前先看根下 `.git`（目录或 worktree / submodule 的文件）是否存在，缺席报新原因 `git-repository`，预览 blocker 为 `gitignore-git-repository`；重组 owner 把它与 `git` 一样映射为 `observation-failure`。不改 Git 失败的其他分类。
- D3 驱动脚本不进仓库：它只是 smoke 的临时变体，smoke 已覆盖同一路径；真实目录验证的证据记在本节。

**回归。** `wakeflow-gitignore-inspection.test.ts` 的"non Git root"改断言 `git-repository`；静态预览测试新增"非 Git 根 fresh preview 只报 `gitignore-git-repository` 且零写"；焦点集 45/45。

**门。** `npm run build:artifacts:committed` 后 `npm test` 998/998（含 `build:check`），`test:typescript` 406.7 s、整门 421 s（机器负载比上一轮高）；`npm run smoke:artifacts` 两宿主七幕全过（21 s）；`git diff --check` 干净。

**文档写回。** README 两语第 4 步、init 命令、Controller 技能工作区参考 Step 0、能力卡 1 §1.1 现 TS 状态、plan 环境边界；制品重建。

## 13.116 reconfigure 接受宿主启动偏好：`hosts` 不是布局；联合真实宿主测试前的准备（2026-09-24）

**背景。** 用户要在 `WakeflowTestWorkspace` 上与 Claude 一起做真实宿主测试，且窗口要跑 Opus 模型。设 Opus 的正规途径是把 `hosts["claude-code"].launch.modelByRole.default` 写进配置，对已初始化的工作区只能走 reconfigure。用 Claude Code 制品（§13.115 提交后的重建副本）对该工作区做 reconfigure preview，被三个 blocker 挡住：`reconfigure-layout-change-unsupported`、`program-instruction-unknown-managed-body`、`support-memory-unadmitted-source`。

**诊断。**

1. 预览把 `hosts` 与 topology、storage 一起当作布局比较，任何 hosts 改动都报 layout-change。能力卡 1 §1.3 记录旧实现"自由可改：显示元数据、语言、governance、hosts、新增实体"，对账账本第 226 行把整段拒绝标为 recut，但没有任何裁决把 hosts 列为不可变；托管正文与窗口投影（`sourceFingerprints` 只含拓扑与根观察）都不依赖 hosts。这是对齐遗漏，不是设计。
2. 工作区根的 `CLAUDE.md`、`Design/CLAUDE.md`、`Test/CLAUDE.md` 仍写着旧显示名 "Wakeflow Test Workspace"：§13.115 第 7 步的 displayName reconfigure 是用 Codex 制品做的，它只重写自己的三份 `AGENTS.md`。Claude 视角的检查只准入当前配置的渲染（`currentTargets = [render(current)]`），一代之前的 Wakeflow 渲染被当作 `unknown-managed-body` / `unadmitted-source` 报为 blocker，而 blocker 归 user，Claude 侧自己修不了。同一工作区交替使用两个宿主时，任一宿主的 reconfigure 都会把对方宿主的三份文件留在上一代并让对方卡死。

**决定。**

- D1 `hosts` 移出布局比较：reconfigure 只把 topology 与 storage 视为布局，`pods[]` 仍走 `reconfigure-pods-change-unsupported`。hosts 只改配置一步，不重写任何托管正文或投影，下一次启动意图即带上。Controller 技能工作区参考 Step 0 补写 reconfigure 的可改项，并在 fresh 的第 1 步说明模型 / effort / 权限模式落在 selection 的 `hosts.<host>.launch.*` 里——此前技能文本从未提到 hosts，Agent 无从把用户的模型要求写进配置。
- D2 对方宿主文件的时效（待用户裁决）：建议任一宿主的维护事务在对方宿主的指令与记忆文件存在时一并保持其为当前渲染，缺席时保持缺席（与 §13.97 D10、§13.111 D1 对等宿主运行时根的规则同形）。本节不实现。
- D3 测试工作区重置（待用户确认）：为让联合测试单宿主、干净起步，删除根下 Wakeflow 生成的条目，保留空 `.git` 与五个仓库副本，由用户在 Controller 里用 `/wakeflow-init` 走真实的 fresh 流程。本节不执行。

**回归。** 静态预览测试在 placement-stable reconfigure 用例里新增"只改 hosts 的 reconfigure 就绪且计划恰为 `publish-config` 一步"；场景 `card-01/reconfigure` 的声明差异加上 `hosts.codex.launch.modelByRole.default`，五段逐字节不变而 hosts 等于声明值，`card-02/window-handshake` 断言产品窗口启动意图的 `execution.model` 等于该值。焦点集 7/7（含 20 场景）。

**门。** `npm run build:artifacts:committed` 后 `npm test` 998/998（`test:typescript` 331.8 s，整门约 345 s），`npm run smoke:artifacts` 两宿主七幕全过（19 s），`git diff --check` 干净。

**文档写回。** 能力卡 1 §1.3 现 TS 状态、对账账本第 226 行、scenario-acceptance 的 card-01/reconfigure 行、Controller 技能工作区参考；两份制品重建（预览编译文件、技能参考、清单）。

**未执行。** 真实宿主会话（安装插件、开窗口、登记、投递取回 hook 证据、Claude 状态栏）由用户在联合测试中操作；本机没有 `codex` CLI，Codex 侧真实会话仍未验证。

## 13.117 tmux 助手资产与精确权限规则：Claude 宿主的 tmux 操作回到插件手里（2026-09-24）

**背景。** 用户授权设置插件权限与使用 tmux，并要求"用 plugin 来处理 tmux 的设置相关"。旧项目（`plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-lifecycle.mjs`、`-transport.mjs`、`-activity.mjs`）把 tmux 完全放在进程内；TSD-12 与 ADR-0009（2026-09-10）把执行移交 Agent 之后，技能文本只用文字描述 tmux 步骤，五个窗口选项、坐标格式、UUID 生成与 Controller 自身的登记都靠 Agent 手工完成。本节按用户对 D4-A 与 D5 的确认落地，同时执行 D3（重置测试工作区）；D2（对方宿主文件的时效）按用户确认留到联合测试之后。插件已按授权从本仓库 marketplace（`gxfn`）以用户范围安装。

**决定与落地。**

- D4 tmux 助手资产：`src/hosts/claude-code/claude-code-tmux-asset.ts` 以状态栏资产同一机制发布 `.wakeflow-local/runtime/hosts/claude-code/operations/assets/tmux.mjs`（0600，维护操作 `claude-tmux-asset:install`，owner `claude-code-tmux-asset`）。子命令 `preflight`、`launch`、`self`、`mark`、`panes`、`deliver`、`close`，序列原样取自旧 lifecycle 与 transport：has-session → new-session / new-window（`-d -n -c -P -F`）、automatic-rename off、五个 `@wakeflow_*` 窗口选项、list-panes -a 十字段、load-buffer → paste-buffer -d -p → send-keys Enter → 一次 capture-pane、kill-window；输出只有现有 MCP 工具已经要求的观察 JSON，不含绝对路径（worktree 观察按合同原样携带 porcelain 除外）。根从资产自身位置推导，不从 cwd 推断。spawn tmux 前剥离 `TMUX*` 与 `CLAUDE*` 环境变量——否则从 Controller 的 Bash 里首次启动的 tmux 服务器会把 `CLAUDECODE=1` 等交给每个新会话；`new-*` 以 `-e PATH=` 把当前 PATH 交给新窗口。`launch` 等目标会话的 `session-start` hook 记录（默认 20 s，`--wait` 可调），worktree 窗口据记录里的 cwd 读 `git worktree list --porcelain` 与 `rev-parse --git-common-dir`。`self` 用 Claude Code 交给 shell 的 `TMUX_PANE` 与 `CLAUDE_CODE_SESSION_ID`（本次在 Bash 工具环境里实测两者都在）让 Controller 登记自己的窗口，配置 socket 与当前 socket 不符即拒绝。`deliver` 先按定位器与许可的 `handleDigest` 核对 pane：缺席、pane-dead、元数据不符、load-buffer 失败都是 failed-before-send，粘贴或回车失败是 unknown；回读按首行 12–96 字符判 confirmed / pending，capture 失败为 unavailable。`claude-code-host-asset-operation.ts` 是从状态栏资产操作抽出的通用操作（只读计划、单文件 CAS、0600、affected 恢复），两份资产各只剩一个描述符。
- D5 权限：`claudeCodePortableSettingsRulesFor(rootKind)`——工作区根 `.claude/settings.json` 写 `mcp__plugin_wakeflow_wakeflow` 与 `Bash(node .wakeflow-local/runtime/hosts/claude-code/operations/assets/tmux.mjs *)` 两条，支撑面仍只有 MCP 一条；transition 按规则集去重、只追加缺的一条，宽泛规则照旧拒绝。取代能力卡 1 Q3 "只写 MCP 规则"的那一半。
- 观察：`host-settings-assets` 门把 tmux 助手当作状态栏资产的伴随资产核对（`ObservationHost.statuslineAsset.companions`，状态栏先判，伴随资产按声明顺序第一份不 current 的决定整票），问题以 `claude-code:tmux.mjs:<status>` 报出。
- 文本：Claude 宿主的 `windowLaunch`、`deliveryAction` 占位符改为调用助手（launch / self / mark / panes / close，deliver 带 `--handle-digest`）；README 一次性宿主动作补"在 tmux 会话 `wakeflow` 里启动 Controller"与权限规则说明。
- D3 已执行：`WakeflowTestWorkspace` 根下 Wakeflow 生成的十项条目已删，保留空 `.git` 与五个仓库副本（五个仓库 `git status` 皆干净）。

**过程中的发现。** 首次 `npm run typecheck` 时新文件尚未列入 `src/hosts/claude-code/tsconfig.json` 的显式 `files`，tsc 从 entrypoints 项目把它们当源文件编译并把 `.js` / `.d.ts` / `.js.map` 吐进了 `src/`；架构检查因此把两个新模块报成 unadmitted production roots（导入解析到了旁边的 `.js`）。删除杂散文件后检查通过；显式 `files` 列表是新宿主模块的必经登记。另：定位器实际写在 `identity/window-locators/`，而资源目录声明与能力卡 2 §2.3 的表写 `operations/window-locators/`，助手按实际位置读；两处不一致留作残余。

**回归。** 新增 `claude-code-tmux-asset.test.ts`（tmux、claude、git 全是记录 argv 的桩：资产字节与操作、preflight、launch 的 new-session / new-window 与 worktree 观察、入参拒绝、self 与三种拒绝、panes / mark / close、deliver 的成功、pending、unavailable 与全部发送前拒绝、根不可解析）与 `claude-code-portable-settings-rules.test.ts`；维护执行、入口、composition、decide 测试按六条宿主操作与伴随资产更新。焦点集 139/139。

**门。** `npm run build:artifacts:committed` 后 `npm test` 1009/1009（新增 11；`test:typescript` 341.8 s，整门约 354 s），`npm run smoke:artifacts` 两宿主七幕全过（20 s），`git diff --check` 干净。

**文档写回。** 能力卡 1 §1.1 宿主差异与现 TS 状态、Q3 记录；能力卡 2 §2.6、能力卡 6 §6.2、能力卡 9 §9.4 现 TS 状态；对账账本 lifecycle 与 transport 两行改 recut；capability-map 三行；README 两语（占位符）与 Controller 技能；制品重建。

**未执行。** 真实 tmux 上的助手（开窗口、登记、投递、状态栏）留给联合测试；插件缓存刷新与联合测试在本节提交之后进行。

## 13.118 用户是被引导者：Controller 自己把 tmux 建起来（2026-09-24）

**背景。** 用户否决了 §13.117 之后我给出的联合测试步骤——那里让用户自己 `tmux new-session` 再在里面开 Controller。用户的模型是：在工作区里运行 `claude`，执行插件命令，其余由插件引导："你应该把 wakeflow 的用户当做被引导者，而不是让我来执行 tmux 命令"。这是对流程与文本的裁决，记为长期规则：用户自己做的只有启动 `claude` 与执行插件命令，其余宿主动作由 Controller 执行，只能由用户做的事（attach、信任对话、确认）由 Controller 当场告知。

**决定与落地。**

- D1 第七个占位符 `windowBootstrap`（两宿主各一份取值，Controller 技能 SKILL.md 第 1 步与工作区参考各用一次）。Claude 取值：先 `preflight` 看 `insideTmux`；在 tmux 里就用 `self` 登记自己；不在时本会话只做引导者且不登记自己——把 Controller 窗口自己的意图也 `launch`（助手新建 tmux 会话并在里面起一个新的 Controller），其余窗口以 `--wait 0` 全部 launch，把助手打印的 `attach` 命令原样交给用户、请其在每个窗口接受信任对话并回话，之后再逐个登记、`mark --all`，最后告诉用户到 tmux 里的 Controller 继续并关掉本会话。Codex 取值：Controller 就是当前线程，先登记自己。`windowLaunch` 里关于 `self` 的句子移入 `windowBootstrap`。
- D2 助手 `preflight` 的 `session` 与新建会话时的 `launch` 输出都带 `attach`（`tmux [-L socket] attach -t <session>`）：Agent 只转述，不自己拼命令。
- D3 README 两语：一次性宿主动作改为"你不需要自己配置 tmux……"；"四种窗口角色"与"主流程"第 1 步改为窗口由 Controller 里的 Agent 替用户启动、轮到用户的事当场告知。

**回归。** tmux 助手测试的 preflight 与 launch 用例断言 `attach`；制品构建对七个占位符的"未登记 / 未使用"检查通过，两份制品都渲染了新取值且没有残留占位符。焦点集 61/61（hosts/claude-code 与 artifacts）。

**门。** `npm run build:artifacts:committed` 后 `npm test` 1009/1009（`test:typescript` 340.3 s，整门约 351 s），`npm run smoke:artifacts` 两宿主七幕全过（18 s），`git diff --check` 干净。

**未执行。** 真实 tmux 上的引导流程（bootstrap、attach、信任对话、登记、投递）留给用户在 `WakeflowTestWorkspace` 里的联合测试；用户的动作只有在工作区里运行 `claude` 与 `/wakeflow-init`。

## 13.119 联合真实宿主测试：Claude 的投递外壳、命令命名空间、回调传输与 rework 准入（2026-09-24）

**背景。** §13.118 之后用户在 `WakeflowTestWorkspace` 里执行 `claude --model opus` 与 `/wakeflow-init`，接受了八个窗口的信任对话，然后授权我通过 tmux 直接驱动各窗口做端到端验证，并要求"对比旧的项目功能实现和代码，选取有价值和验证过的功能和代码"。本节记录 Controller（Opus 5.5）引导下的一轮完整需求闭环里证实的事实、发现的问题与修法。三次提交：`97854859`（助手在真实宿主上活下来）、`1f387a36`（观察脚本剥壳、命令改名、回调传输）与本节的提交（闭合标签属性、rework 准入）。

**真实宿主上证实的事实。**

- 引导流程按 §13.118 走通：fresh init 以 Opus 为默认模型、精确规则 `Bash(node .wakeflow-local/runtime/hosts/claude-code/operations/assets/tmux.mjs *)` 写入程序根 settings；助手 `launch` 把八个窗口开进 tmux 会话 `wakeflow`；信任对话接受后每个窗口都有 session-start hook 记录；八个窗口经 MCP 登记，`wakeflow_verify` 14/14；Controller 自己通过助手 `close`/`launch` 加 `register_window_binding replace` 换代重启，`mark --all` 后状态栏显示 `Opus 5.5 · Controller`。
- 主流程走通：Design 发布需求包 → Controller 认领 Demand、规划任务、准备投递、用助手粘贴进 AlembicPlugin 窗口 → 目标窗口新建 31 字节文件并导入结果 → 回调进 Controller 窗口 → Controller 登记两条受管证据（document 与 test-output）、决定、换代规划、再投递 → 目标以 `completed` 再导入并引用锚点证据 → 回调 → 评审、验收、complete。每一步的事件流修订号、结果与回调记录都在 `.wakeflow-active` 与 hook 观察记录里可对。
- Claude Code 的宿主事实：本地目录 marketplace 下 hook 从安装缓存 `~/.claude/plugins/cache/<marketplace>/wakeflow/<version>/` 运行，不是仓库工作树——制品变了必须刷新缓存（uninstall + install，`installed_plugins.json` 记录安装时的 `gitCommitSha`）；插件命令只能以 `/wakeflow:<command>` 解析，裸 `/wakeflow-next` 是 Unknown command；hook 载荷的 `cwd` 会随目标会话 Bash 工具里的 `cd` 漂移（一条落地记录的 cwd 是 `.wakeflow-local/.../identity`），观察脚本按祖先目录定位工作区所以不受影响；tmux 3.6 会把 `list-panes`/`display-message` 输出里的制表符替换成 `_`；`pane_current_command` 是版本号（`2.1.281`），不是 `claude`。

**发现与修法。**

1. **粘贴外壳。** 助手 `deliver` 用 bracketed paste 送进去的 prompt，Claude Code 交给 UserPromptSubmit hook 时包成 `<pasted_content id="976a">…</pasted_content id="976a">`——闭合标签重复属性；跨会话消息包成 `<cross-session-message from=… from-name=… from-mode=…>…</cross-session-message>`。第一轮投递的 hook 摘要因此与信封不符，`record_delivery_outcome` 记为 `indeterminate`、回调 `pending`。修法（`1f387a36` + 本提交）：观察脚本 `unwrapHostPrompt` 只对 claude-code 剥去这两种传输外壳（至多两层，先 trim）再算共享摘要，Codex 原样计算；回归用真实闭合形式与无属性闭合形式各断言一次。事后核对：落地 prompt 原文摘要 `sha256:7a7efa44…` = hook 记录摘要，剥壳后 `sha256:950492…` = 信封 `promptDigest`；回调原文 `sha256:adff3e…` = 记录，剥壳后 `sha256:4e4857…` = 许可里 prompt 的摘要。本轮的记录仍由旧观察脚本写出（缓存刷新在回调之后），所以这一轮的投递与回调在事件流里保持 `indeterminate`/`unlanded`，验收不依赖它们；刷新后的缓存对之后的记录生效。
2. **命令命名空间。** 四个命令文件改名为 `init.md`、`status.md`、`next.md`、`pod.md`，安装后是 `/wakeflow:init`、`/wakeflow:status`、`/wakeflow:next`、`/wakeflow:pod`；技能、README 与 `commandSurface` 取值同步。更正 `1f387a36` 提交说明里"沿用旧插件命名"的说法：旧插件的命令是 `init`、`status`、`check`、`dispatch`、`review`、`unattended`、`windows`，与现在一致的只有 `init` 与 `status`；`next` 与 `pod` 对应现在的命令面。
3. **回调传输。** 第一轮目标窗口用 SendMessage 送回调（跨会话消息不落地成 prompt 提交），还去读 Wakeflow 源码才知道 `completed` 需要每个锚点绑定受管证据。目标与测试技能现在写明：回调只能经 `{{deliveryAction}}`（Claude 是助手 `deliver --handle-digest`，产品窗口在助手路径前加 `--add-dir` 给的工作区根），其它传输一律不算送达；`completed` 的证据规则直接写在技能里。第二轮目标用助手送回调（`attempt.status=sent`），Controller 收到的是 `<pasted_content>`。
4. **rework 准入的死路。** Controller 登记证据后为了让目标以 `completed` 重报，记录了一条 `rework` 决定，五条独立检查全部 `passed`；决定被接受（修订 8），但 `prepare_delivery` 永远 `record-relation`——返工投递投影要求至少一条 `failed` 检查作为整改项（`target-delivery-rework-context.ts`）。两条规则分住两处，决定一旦记录不可更改。修法：`deriveImplementationDecisionBlockers` 接受请求里的独立检查，`rework` 没有 `failed` 检查时在记录时即拒（`precondition-failed`/`rework-checks`，blocker `rework-checks:no-failed`）；允许集推导不带检查，所以评审单元仍列出 rework；工具描述与 Controller 技能第 11 步写明"failed 的检查就是目标收到的整改项"，并给出 needs-review 结果的处理顺序（先登记证据，再以说明报告缺口的 failed 检查要求 `completed` 重报）。存量记录的解析不变：追加历史必须继续可重放，投递投影仍是后备。现场走的是内建出路：换代规划（lineage replacement，修订 9）→ 投递（10）→ 记录结果（11）→ 目标 `completed` 导入（12）→ 回调 → 验收。
5. **乐观并发如预期。** Controller 在目标导入之后再显式 `record_delivery_outcome` 被 `stream-revision` 冲突拒绝——Demand 已被目标的导入推进，这是设计内的行为，不改。
6. **助手在真实宿主上的修补**（`97854859`）：字段分隔符改为可打印的 `~|~`；session-start 记录按记录里的 `sessionId` 匹配而不是文件名；窗格进程经 `ps` 进程表解析出 `claude`；新增 `teardown`；`resolvePlacement` 允许仓库位于根旁边。

**门。** `npm run build:artifacts:committed` 后 `npm test` 全链通过（typecheck、架构规则、Biome、knip、`test:typescript` 1011/1011、schema 漂移、build:check 两份制品与 marketplace 均 ok；整门 362 s，测试套件单跑 311.5 s），`npm run smoke:artifacts` 两宿主七幕全过（hookObserver landed、verify ok），`git diff --check` 干净。焦点集：result-review decide/service 与 governance review 16/16，hook observer 14/14。安装缓存已从本制品刷新（uninstall + install）。

**现场结果。** Controller 以换代任务包走完闭环：`target-task_4a129f93…` 替换 `target-task_f97c43a8…`（修订 9）、投递 `target-delivery_32b75460…`（10）、结果记录 `indeterminate`（11，旧观察脚本）、目标 `completed` 导入 `target-result_92033883…` 且四个锚点都引用证据 A/B（12）、回调经助手送达（记录里仍 `pending`，同因）、accept 决定 `target-review-decision_d9cfc495…`（13）、严格校验工作区 14/14 与 Demand 7/7、complete 预览 8/8 无阻塞后应用（14）。外部核对：`ledger/archives/demand_57056df4…/0000000014` 存在（含校验报告共 24 个文件、120,457 字节），`wakeflow_status` 为 idle、board archived 1、八个窗口 registered/current，`wakeflow_verify` 14/14；AlembicPlugin 里 `docs/wakeflow-smoke.md` 仍是唯一未跟踪改动，HEAD `7b2c53a` 未动。Controller 独立诊断出与我相同的两个原因（闭合标签带 `id`、hook 跑的是安装缓存）。

**待裁决与残留。** D2（跨宿主指令/记忆文件的时效）留待用户裁决；rework 只能标 `implementationQuality: defective`，"产品改动没问题、只是报告要重做"没有专门词汇（本轮不改，记为 D6 待裁决）；locator 文件实际在 `identity/window-locators/`，目录与卡片 2 写的是 `operations/window-locators/`；owner 管理的产品仓库没有助手的 allow 规则，产品窗口调助手要么 bypassPermissions 要么弹一次确认；`<pasted_content>` 外壳可能让谨慎的会话犹豫。Codex 宿主本轮未做真实会话测试（未执行）。

## 13.120 D2 对等宿主文件随本宿主事务保持当前、D6 rework 的质量词汇放开；八窗口重启后的第二轮联合测试（2026-09-24）

**背景。** §13.119 之后用户裁决："重启八个窗口再跑一遍，D2 和 D6 按你推荐的来"。D2 是 §13.116 留下的对等宿主指令/记忆文件时效问题，D6 是 §13.119 记下的 rework 只能标 `implementationQuality: defective` 的词汇问题。两项按当时的建议落地，然后在 `WakeflowTestWorkspace` 里把八个窗口全部重启（新 MCP 服务器、新技能与命令名生效）再走一遍完整闭环。

**D2 决定与落地：任一宿主的维护事务在对方宿主的文件已存在时一并保持其为当前渲染，缺席时保持缺席。** 制品固定携带两份宿主资源 profile（§13.94 D1），程序指令块、外部指令块与支撑面记忆的正文只依赖 Config 与 profile，所以跨宿主渲染不需要对方的任何运行时。静态预览（`wakeflow-static-materialization-preview.ts`）在三处各加一个对等宿主循环：程序指令、每个外部指令 target、每个受管支撑面的记忆；只在 `transition.sourceAuthority === "admitted-current"`（文件存在且正文是准入的当前渲染）且需要重组/重发时规划步骤，缺席、未受管（用户自己的 `CLAUDE.md` 没有 Wakeflow 块）或已是目标渲染时不动。步骤 id 带 `:<hostId>` 后缀（`integration:program-instruction:claude-code`、`integration:external-instruction:<targetId>:<hostId>`、`support-memory:<surfaceId>:<hostId>`），当前宿主的 id 与 targetKey 不变，计划摘要不受影响。执行器按 targetKey 点名的宿主从 `request.hostProfiles` 取 profile（程序指令 targetKey 就是 hostId；记忆 targetKey 的后缀；外部指令的 targetKey 对当前宿主仍是 target 键，对等宿主以 `:<hostId>` 结尾），三处执行不再假定当前宿主。对方文件正文未知时的阻塞码与本宿主同形但带 `peer-` 前缀（`peer-program-instruction-*`、`peer-external-instruction-*`、`peer-support-memory-*`），修法相同。第一版把"存在"判成 `currentAuthority !== null`——那是"当前 Config 算出的权威"而非文件事实，预览为缺席的对方文件也规划了步骤，三个既有用例立刻暴露；改为看 transition 的来源权威后通过。

**D6 决定与落地：rework 的 `implementationQuality` 不再限定 `defective`。** 决定 Schema `allOf` 里 rework 分支只保留 `requirementAlignment: aligned`、无阻塞原因、无升级；`satisfactory`（改动没问题、只是报告要重做）、`unverified`（无法核实）、`defective`（改动本身有错）由 Controller 判断；accept 仍只接受 `satisfactory` 且全部检查 passed。这是放宽而不是收紧，存量记录全部仍合法。工具描述与 Controller 技能第 11 步写明词汇；能力映射第 12 行记 D6。

**回归。** 维护事务测试新增"对等宿主文件已存在时随本宿主 reconfigure 保持当前渲染，缺席时保持缺席"：Codex fresh → Codex 只改语言的 reconfigure 不为缺席的 Claude 文件规划步骤 → Claude 以 reconcile 加入（只写自己的三份文件）→ Codex reconfigure 计划里恰有 Claude 的三个带后缀步骤，执行后 `CLAUDE.md`、`AGENTS.md` 与两份支撑面记忆都是 zh-Hans 渲染 → Claude 随后的 reconcile 无事可做。决定测试对 rework 断言三种质量都能创建。焦点集 29/29（维护预览/执行器/事务、决定、外部指令能力）。

**门。** D2/D6 提交（`69d11716`）：`npm run build:artifacts:committed` 后 `npm test` 全链通过（`test:typescript` 1012/1012，整门 336 s），`npm run smoke:artifacts` 两宿主全过，`git diff --check` 干净；中间一次门失败是我把评审决定工具的描述写到 814 字节、超过目录 640 字节上限，七个测试文件在装载时被 `tool-catalog-registration` 拒掉，压到 634 字节后通过。本节的第二个提交（摘要上限与技能时序说明）：`npm test` 1012/1012（整门 364 s），smoke 两宿主全过，`git diff --check` 干净；焦点集：投递能力与 Demand 聚合 15/15。两次提交后安装缓存都已刷新（uninstall + install）。

**第二轮现场。** 八个窗口全部经助手 close → launch → `register_window_binding replace` → `mark --all` 重启（每个窗口 session-start hook 均 observed，无需再接受信任对话），状态 idle、八窗口 registered/current、verify 14/14。然后按用户视角走：Design 窗口收到一句话需求，发布 `requirement_56159822…`（AlembicPlugin 新增 28 字节的 `docs/wakeflow-smoke-round2.md`，五条验收标准，其中第 5 条由 Design 自己补上）；Controller 窗口输入 `/wakeflow:next` 认领成 `demand_b9f2fc11…`（命令只推进一步，随后一句"一直走到 complete"让它跑完）。中途一次 Anthropic API 服务端中断（Server error mid-response）打断了 Controller 的只读准备，事件流仍在修订 1，重发"继续"即恢复。闭环：规划 `target-task_b7b88971…` → 投递 `target-delivery_b096512a…`，记录 **accepted**（目标会话 hook 记录 `f7c55669…` 的摘要 `42125d37…` 与许可相符——这是 §13.119 修复后第一次在真实宿主上由 hook 证据判定落地）→ 目标以 `needs-review` 导入 `target-result_d9619a67…`（尚无托管证据）并经助手回调，评审单元显示回调 landed、完成记录 confirmed → Controller 登记证据 A（新文件）、B（探针输出）、C（第一轮文件）→ rework 决定 `target-review-decision_9e1355e1…`，`implementationQuality: satisfactory`、唯一 failed 检查是报告缺证据引用（D6 在真实宿主上落地）→ 返工投递 `target-delivery_ebaf4c1b…` 记录 **accepted**（hook 记录 `ed4c35af…`）→ 目标以 `completed` 导入 `target-result_b7adfc02…`，五个锚点引用 A/B/C → 回调 landed → accept 决定 `target-review-decision_19f03751…` → 严格校验工作区 14/14、Demand 7/7 → complete 预览 8/8、应用（修订 14），归档 `ledger/archives/demand_b9f2fc11…/0000000014`。外部核对：归档目录存在（25 个文件含校验报告），`wakeflow_status` idle、board archived 2、无声明，`wakeflow_verify` 14/14；AlembicPlugin HEAD 仍是 `7b2c53a`，只多两个未跟踪文件，新文件 28 字节。两次投递与两次回调都由目标会话自己的 prompt 提交记录判定，readback 两次都是 pending——设计本意如此。

**残留。** D7（待裁决）：`controller-only` 的需求包在现行规则下总要两轮——目标第一次只能 `needs-review`（尚无托管证据可引用），Controller 登记证据后必须发一次只改报告的 rework 才能拿到 `completed` 再 accept。建议：允许 Controller 在证据已登记且自己的独立检查覆盖全部锚点时，对 `needs-review` 结果直接 accept（accept 的机器规则从"outcome 必须 completed"改为"completed，或 needs-review 且每个锚点都绑定了 Controller 登记的证据"），把默认路径压回一轮；不改的话，技能文本至少要写明这两轮是预期的。本节顺手修了两处现场发现：返工投递 prompt 里的整改项摘要上限 128/256 个码点把第一条证据 ref 截在半路（目标只好去 Demand 根读完整决定），方法/观察摘要上限提到 512/1024（Schema 与 envelope 同步，存量记录仍合法）；回调先于目标会话的 stop 记录约 9 秒到达，Controller 第一次读评审单元时完成记录还是 pending，技能第 10 步写明这是时序、稍后再读。其余残留：Controller 的探针文件留在 `Test/evidence/demand_*/`；hook 记录的 `cwd` 随目标会话 Bash 的 `cd` 漂移（§13.119 已记）；Codex 宿主仍未做真实会话测试（未执行）。

## 13.121 D7：needs-review 结果凭 Controller 的锚点→证据绑定直接 accept（2026-09-24）

**背景。** §13.120 第二轮暴露的结构性问题：`controller-only` 的需求包在旧规则下总要两轮——目标第一次只能 `needs-review`（尚无托管证据可引用），Controller 登记证据后还得发一次只改报告的 rework 才能拿到 `completed` 再 accept。用户裁决"D7 按你推荐的来"。能力卡 7 的 Q3 原裁决是"accept 必须 `outcome === completed`，needs-review 只能 rework 或 blocked"，旧 JavaScript 实现则是零证据也可机械接受；本节取中间：accept 也接受 `needs-review` 结果，但依据必须是 Controller 自己记录在决定里的锚点→托管证据绑定，零证据的机械接受仍不允许。

**决定与落地。**

- 决定记录新增 `anchorEvidence`（`{anchorId, evidenceIds[]}[] | null`，默认 null）。Schema 的 accept 分支把 `reviewed.targetResultOutcome` 放宽为 `completed | needs-review`，并新增条件：accept 且 needs-review 时 `anchorEvidence` 非空；解析层的关系规则：绑定只属于 accept，needs-review 的 accept 没有绑定就拒（`relation`/`$/anchorEvidence`）。摘要依据只在绑定非 null 时纳入该字段，存量决定的摘要与重放不变。
- 机器阻塞（`deriveImplementationDecisionBlockers`）：视图新增任务包的验收锚点 id 与本 Demand 已登记的托管证据 id；accept 在 needs-review 上逐锚点核对——`anchor-evidence:no-managed-evidence`（Demand 还没有证据，允许集也不列 accept）、`anchor-evidence:missing`（记录时没给绑定）、`anchor-evidence:uncovered:<anchorId>`、`anchor-evidence:unknown-anchor:<anchorId>`、`anchor-evidence:unknown-evidence:<evidenceId>`；`blocked` 结果仍是 `outcome:blocked`。允许集推导（评审单元的 `allowedDecisions`）只看证据是否存在，绑定在记录时核对。
- MCP 请求 `wakeflow_record_implementation_review_decision` 新增可选 `anchorEvidence`；切片把它交给决定创建，记录时未给即 null（缺失）。工具描述重写在 640 字节内（622 字节）。
- 技能文本：Controller 第 11 步写明 accept 的两种依据与 needs-review 的处理——登记证据、自己逐锚点核对、带 `anchorEvidence` 直接 accept，rework 只用于改动本身要修；目标技能第 5 步写明 needs-review 导入是正常结局。能力卡 7 的 Q3 行与 7.3 行、能力映射第 12 行记 D7 修订。

**回归。** 决定测试：needs-review 的 accept 无绑定即拒、有绑定创建、rework 带绑定拒；决定测试与 decide 测试覆盖五类 blocker 与允许集；切片测试：导入一份 needs-review 报告（锚点引用为空）后，评审单元把 accept 列入允许集，无绑定与绑错锚点的 accept 被 `anchor-evidence` 拒，覆盖全部锚点的 accept 提交并让目标进入 `accepted`。焦点集 22/22（决定、decide、切片、MCP 目录两份）。

**门。** `npm run build:artifacts:committed` 后 `npm test` 全链通过（`test:typescript` 1013/1013，整门 651 s——机器被第三方进程占满时的时长，先前同一套件 325–364 s），`npm run smoke:artifacts` 两宿主全过，`git diff --check` 干净。此前四次整门各因一处失败中止：评审决定工具描述超 640 字节（压到 622）、构建产物里一处尾随空格（参数列表内的注释移出）、格式检查（`biome format --write`）、以及两次计时敏感用例超时（见残留）。焦点集：决定、decide、切片、MCP 目录两份 22/22，codegen 镜像 1/1，锁 7/7。

**第三轮现场（D7 在真实宿主上走通）。** 只重启 Controller 窗口（助手 close → launch → replace，新会话装载了带 D7 的工作树制品），Design 发布 `requirement_f65ead47…`（28 字节的 `docs/wakeflow-smoke-round3.md`，六条验收标准），Controller `/wakeflow:next` 认领成 `demand_3a204abc…` 后一句话跑完：规划 `target-task_fe7197c9…`（六个锚点）→ 投递 `target-delivery_af058ee1…` 记录 accepted（目标 hook 记录 `0d8aa4bb…`）→ 目标 `needs-review` 导入 `target-result_90232bd2…`（报告锚点引用为空，符合约定）→ 回调 landed（`f4a6fabb…`），完成记录 confirmed → Controller 登记四条证据（三个文件与探针输出）→ 登记前评审单元的允许集只有 rework / blocked / escalate，登记后出现 accept → accept 决定 `target-review-decision_c01c4764…`，`anchorEvidence` 六个锚点各绑 1–2 条证据，返工 0 次 → 严格校验工作区 14/14、Demand 7/7 → complete 8/8 门通过，归档修订 11。外部核对：归档 `ledger/archives/demand_3a204abc…/0000000011`（24 个文件）里第 10 号提交的决定确实带着六条 `anchorEvidence`，第 5 号提交是 needs-review 的导入；`wakeflow_status` idle、board archived 3、无声明，`wakeflow_verify` 14/14；AlembicPlugin HEAD 仍 `7b2c53a`，三个冒烟文件都是未跟踪。与第二轮相比少了一整轮返工投递。

**勘误。** §13.119 与 §13.120 写"hook 从安装缓存运行、制品变了必须刷新缓存"，本节按进程表核实：八个窗口和本会话的 MCP 服务器都运行在 marketplace 的源目录（本仓库 `plugins/claude-code-wakeflow/mcp/server.mjs`），`${CLAUDE_PLUGIN_ROOT}` 对本地目录 marketplace 解析到源目录本身，安装缓存只是 `claude plugin` 的安装记录；hook 用同一占位符，当时两份代码一致、无法从摘要区分，应当同样来自源目录。结论不变：制品重建后 hook 立即生效，MCP 服务器与技能要重启窗口；刷新缓存无害但不是必要条件。

**残留。** 整门在机器繁忙时（第三方进程 `yyb_mac` 长时间占 160% CPU）连续三次各有一个计时敏感用例超时——锁串行用例（默认 2 s 等待，本节改为显式 30 s，断言的是串行与残留清理）、端点 register/decommission 用例（单跑 31 s，整套并行时超过 60 s 上限，未改）——单跑均通过；这是负载问题不是回归，但说明整门的计时余量在繁忙机器上偏紧。其余：Controller 的探针文件继续留在 `Test/evidence/`；Codex 宿主仍未做真实会话测试（未执行）。

## 13.122 逐模块对齐第一轮：投递与落地——旧实现的已验证行为对照与两处移植（2026-09-24）

**背景。** 用户设定下一阶段："逐个文件 review 本地旧项目代码和模块，在新 TS 项目里逐个 review 对齐模块和功能逻辑，学习理解旧项目的已经成熟的方案与实现，然后进行多轮次的完善优化新 TS 项目，并多轮次的验证真实测试"，并指定从"投递与落地"开始。参考副本 `Wakeflow-legacy-reference` 核实为 `629e79c5`（E4 切换提交 `a8d0b4bb` 的父提交）的逐字节导出，无更新的分支或标签，版本正确。本轮的对照单位是旧实现的**测试名**——那是旧项目里已被验证的行为清单——对应的模块：`wakeflow-delivery-orchestration.mjs`（3780 行）、`wakeflow-transport-{records,store,retention}.mjs`、`wakeflow-window-lease-{records,service}.mjs`、Claude 宿主的 `wakeflow-claude-transport.mjs` 与 `wakeflow-claude-locator.mjs`，以及它们的七个测试文件。

**行为对照。** 状态：同形 = 新实现以不同结构实现同一可观察行为；放弃 = 有裁决依据的有意放弃；移植 = 本轮补上。

| 旧实现已验证的行为（测试名摘要） | 新实现 | 状态 |
|---|---|---|
| plan → apply → claim → outcome → rearm 五段链；planDigest 不授权发送 | `prepare_delivery` 一次追加即取声明并签发许可（fence + handleDigest）；`record_delivery_outcome`；`rearm_delivery` | 同形 |
| 竞争的 pre-send claim 只有一人得到 send permit | 工作声明独占创建，同字节重放 current，他人持有即阻塞 | 同形 |
| 过期 apply 在发布传输记录或租约前拒绝并释放门 | `expectedStreamRevision` 乐观并发，冲突不写 | 同形 |
| 只有 rejected-before-send 释放租约，accepted / ambiguous 保留租约等结果闭包 | `deliveryClaimHandling`：只有 rejected-before-send 释放；indeterminate 保留、不重发 | 同形 |
| readback 只观察一次、只存摘要、不轮询推断完成 | 助手一次 `capture-pane`，只存摘要 | 同形 |
| 粘贴不确定只记一次 ambiguous、保留租约、从不重发；区分 load 失败与 Enter 不确定 | `attempt.status` 三值：failed-before-send（load 前）、unknown（paste / Enter 失败）、sent；处置由证据派生 | 同形 |
| 发送前拒绝：死 pane、非 claude 进程、重复匹配的 pane、定位器代际漂移、缺少 live 元数据 | 原助手只查坐标精确匹配与元数据；缺"非 claude 进程"、"重复 pane"、"坐标过期"三项 | **移植** |
| 一个 delivery 只能持一把目标租约；过期租约不按时间清理，直到精确释放 | 声明代际上限是内核常量；孤儿声明按绑定事实回收，不看时间 | 同形 |
| Controller return 与目标投递同一物理围栏；rejected return 记 rearm 权威 | 回调许可同一助手 `deliver`；`rearm_delivery` 覆盖回调静默 | 同形 |
| Test attempt 由 TestCard 策略派生；Test rearm 保持同一逻辑尝试；多目标 group 的替换保留未发送成员 | 测试尝试代际与 `request-another-attempt`；投递按目标而非 group（ADR-0002 重切） | 同形 / 有依据的重切 |
| 传输四类不可变记录（group / packet / envelope / run）、run lineage 连续不可分叉、store 的 0700 / 0600 / no-follow 严格库存 | Demand 事件流事件 + 声明代际；`demand-root-audit` 门 | 同形（结构不同） |
| 归档门控的整需求传输修剪，无时间启发式 | complete 事务内 `retireDemandRoot` | 同形 |
| journal 恢复：run-first / lease-first / claim journal 前向恢复 | 单事务追加命令，无中间 journal | 放弃（事件流模型无此状态） |
| keep-live（caffeinate）与活动监视器 | 无；宿主 hook 观察取代 | 放弃（能力卡 10 Q1/Q3，ADR-0009） |

**移植一：助手 `deliver` 的送前 pane authority。** 与定位器按坐标或标识相关的 pane 必须恰好一个（多于一个 `duplicate-pane`）、活着（`pane-dead`）、标识对（`metadata-mismatch`）、坐标对（`locator-stale`，提示重新登记）、跑的是 claude（`wrong-process`，带观察到的进程名），任一不满足都是 `failed-before-send`，不碰缓冲区。进程名沿用 §13.119 的进程表解析（原生安装的 claude 二进制名是版本号）。

**移植二：落地观察进助手。** `deliver` 在回车后等目标会话的 `user-prompt-submit` hook 记录（`--wait-landing`，默认 3 秒，0 关闭），摘要按内核规则（去首尾空白后 UTF-8 的 SHA-256，观察脚本已剥掉粘贴外壳），输出新增 `landing: observed{recordId, recordedAt} | pending{promptDigest} | unavailable`。这不是新的判定源——`record_delivery_outcome` 仍自己读记录——而是把 Controller 前三轮手工做的"查目标会话的 prompt 提交记录"收进助手。顺带核实了一个宿主事实：Claude Code 对**中途排队**的 prompt 也在回车时就触发 UserPromptSubmit hook（第三轮里排在 `/wakeflow:next` 之后的那条消息 5 秒后就有记录，摘要相符），所以"目标窗口忙"不影响落地证据；Controller 技能第 8 步据此写明 `landing` 的读法与"pending 通常意味着窗口不对或已死"。旧实现的活动监视器不是为此设计的，本轮不引入忙碌门控。

**回归。** 助手测试的 deliver 用例新增：重复 pane、非 claude 进程（观察值 `zsh`）、坐标过期各拒一次且不碰 tmux 缓冲区；`--wait-landing 0` 得 pending，写入目标会话的 prompt 提交记录后得 observed（recordId 与 recordedAt 原样返回），`--wait-landing 999` 拒。制品文本（`deliveryAction` 取值）与 Controller 技能第 8 步同步。焦点集 23/23（助手、制品诚实性、制品布局）。

**门。** `npm run build:artifacts:committed` 后 `npm test` 全链通过（`test:typescript` 1013/1013，整门 384 s），`npm run smoke:artifacts` 两宿主全过，`git diff --check` 干净；提交 `66d6697e`。

**第四轮现场。** 先用新制品 reconcile 测试工作区（计划恰为一步 `asset:claude-code:tmux`，助手摘要 `32f4dbcd…`），只重启 Controller 窗口，Design 发布 `requirement`（28 字节的 `docs/wakeflow-smoke-round4.md`，七条验收标准），Controller `/wakeflow:next` 认领成 `demand_44a2bab7…` 后一句话跑完：规划 `target-task_5ca723b0…`（七个锚点）→ 投递经助手，助手输出第一次带 `landing`——`attempt: sent`、`readback: pending`、`landing: observed`（记录 `ca06c334…`，23:11:26Z）；`record_delivery_outcome` 自己查到同一条记录判 accepted，`hookRecordId` 相同 → 目标 `needs-review` 导入 → 回调经助手送进 Controller，目标会话里的助手输出同样 `landing: observed`（`533c1829…`），评审单元的回调落地记录一致 → 登记证据 → 带 `anchorEvidence` 的 accept（D7 第二次现场）→ 严格校验 14/14 → complete 归档修订 12。外部核对：归档 `0000000012` 27 个文件，第 4 号提交的投递结果 `accepted` 且 attempt 摘要与助手输出一致；`wakeflow_status` idle、board archived 4、无声明，`wakeflow_verify` 14/14；AlembicPlugin HEAD 仍 `7b2c53a`，四个冒烟文件都是未跟踪。前三轮目标会话里的 deliver 输出都没有 `landing`，本轮是第一次；两次回读仍是 pending（Claude Code 的 TUI 不回显粘贴原文），落地一律由 hook 记录证明。

**残留。** 回读在 Claude Code 上从未 confirmed（首行子串永远看不到），它现在只是"屏幕摘要"这一条证据，是否改成识别 TUI 的粘贴指示或干脆只保留摘要，留到窗口与宿主那一轮；隐私扫描把探针转录里的两个裸 UUID（hook 记录 id）拦下（`privacy:bare-uuid`），Controller 删掉后重登记——按设计工作，但技能文本可以提醒"证据文件里不要写 hook 记录 id"；旧实现的多目标 group 替换、journal 前向恢复与 keep-live 三项按既有裁决不移植；Codex 宿主仍未做真实会话测试（未执行）。

## 13.123 逐模块对齐第二轮：评审与证据——旧实现的已验证行为对照，一处技能文本补充，一次故意的失败路径现场（2026-09-24）

**背景。** 第二轮按计划对照旧实现的评审、结果权威、证据与归档：`wakeflow-result-review-orchestration.mjs`（2428 行）、`wakeflow-target-result-authority.mjs`、`wakeflow-evidence-{importer,records,tree}.mjs`、`wakeflow-business-archive-{records,service}.mjs`，以及它们的九个测试文件（含 `evidence-mcp-surface`、`result-contract-invariants`、`pod-evidence`）。对照单位仍是旧测试名。新实现这一带在 §13.87–§13.90、§13.107、ADR-0012 已按函数级账本重切，本轮逐条核对可观察行为。

**行为对照。**

| 旧实现已验证的行为（测试名摘要） | 新实现 | 状态 |
|---|---|---|
| 导入已结算的 current 结果，最后释放精确租约，重放不加修订 | `import_target_result`：围栏 `claimDigest` 核对、导入即释放工作声明、幂等重放 | 同形 |
| Test attempt 结果只能经精确 TestCard 授权导入 | 测试结果按任务包的 `testContract` 与 attempt 代际导入 | 同形 |
| 创建精确 group 候选，Controller 验收作为独立评审事件提交 | 无候选制品：决定带评审单元摘要（`reviewUnitDigest`）与快照摘要，两个决定工具各一事件 | 有依据的重切（账本 338） |
| rework 信封是新一轮；禁止跨轮 supersede；迟到结果留作历史 | rework → 新投递代际；另一把声明的围栏或 rejected 结局不能产生 TargetResult；历史决定进 `priorReviewHistory` | 同形 |
| 多目标 redesign 决定与逐个替换包 | `redesign` 删除（ADR-0012），替换包走 `lineage: replacement` | 有依据的重切 |
| group-ready 唤醒 Controller，不假装 group 评审完成 | 按目标回调，group 概念放弃 | 有依据的重切 |
| Controller 回传：脱敏计划、一次不可变 run、rejected 停在 explicit-rearm-required、绑定替换后作废未发送信封 | 回调许可随导入返回；`rearm_delivery` 的回调重发按当前绑定重签（`executeCallbackReissue`）；旧绑定的许可被助手 `handle-mismatch` 拒 | 同形 |
| TargetResult 权威：current 选择器、双向闭包、ready / blocked / missing / closed | `demand-result-review-snapshot.ts` + 评审单元 | 同形 |
| 证据 preview 零写、完整可移植计划；apply 精确重放幂等；两进程一记录 | 捕获规划零写 + `planDigest`；发布事务 absent-only 创建；同内容再 apply 为 already-recorded | 同形 |
| preview 拥有身份，一个证据 ID 不能被不同计划重绑 | 身份由内容派生（来源键 + 负载摘要），不同负载得到不同身份 | 同形（更强：同内容同身份） |
| 来源区分 file / tree / HTTPS / Git locator | managed-path / observation / link / commit 四种来源；HTTPS 成为 `link`，Git 成为 `commit`，都是引用投影 | 有依据的重切 |
| 根、中间、叶子符号链接、硬链接、特殊文件失败关闭 | 来源根与树成员：符号链接 `symlink`、特殊节点 `special-node` 失败关闭；硬链接不单独拒绝，改由两次树身份计算的 `source-changed` 漂移检测覆盖，发布阶段再核摘要 | 同形（链接政策换成漂移检测） |
| 内容白名单、不透明审阅、隐私命中、固定上限拒绝且不泄露值 | 内容阻塞项：凭证永远阻塞，opaque 与非凭证命中在 reject 下阻塞、`controller-confirmed` 可确认；上限 256 文件 / 16 MiB 单文件 / 深度 16 与旧值同源 | 同形 |
| 关系（≤ 256 条到 Demand 事件的引用） | 无独立关系记录：决定的 `anchorEvidence`（§13.121）与报告的锚点引用承担 | 有依据的重切 |
| 恢复：journal / stage / root / event / state 前向完成，不回填缺失的 final root | 发布事务：journal、stage、Event、final 与健康闭包；Event 已提交后不重读 source，CAS 过期退休 partial stage | 同形 |
| 篡改、孤儿根、重复身份阻断后续变更 | Root inventory 分类 journal / stage / final，健康权威要求 final 与 Event selector 一致 | 同形 |
| 归档：TODO 行精确 CAS 删除；cancelled 可归档未取得目标的 Test card，completed 不可；隐私拒凭证、私有路径、裸 UUID，准入 typed ID | 完成 / 取消各是一个发布事务；完成要求实现目标全部 accepted（research 零目标除外）；归档负载隐私只拒凭证类，路径与 UUID 按白名单 | 同形 |
| 归档恢复的各阶段边界收敛 | 单事务发布 + `recover` | 有依据的重切 |

本轮没有发现需要移植的运行时行为。第四轮现场里隐私扫描把探针转录中的裸 UUID（hook 记录 id）拦下、Controller 删掉后重登记，是按设计工作；顺手在 Controller 的证据参考里加一句：裸 UUID 是可确认的非凭证命中，但更干净的做法是不要把 hook 记录 id、会话 id 写进要登记的文件，引用 typed id。

**回归。** 只有技能文本改动；制品重建后 `agent-text-honesty`、`plugin-artifacts` 通过。

**门。** `npm run build:artifacts:committed` 后 `npm test` 全链通过（`test:typescript` 1013/1013，整门 302 s），`npm run smoke:artifacts` 两宿主全过，`git diff --check` 干净；提交 `7d19bdc8`。

**第五轮现场（故意的失败路径）。** 为了让评审的非主路径也在真实宿主上跑一遍，第五轮是一次故意的失败路径：Design 按我的要求发布一份在当前仓库状态下自相矛盾的需求包（文件必须放进"已存在的" `docs/archive/`，同时禁止新建任何目录，而该目录并不存在；Design 如实把"目录不存在"写进了代码事实，并在落地方案里写了前置条件不成立就停下报告）。Controller `/wakeflow:next` 认领成 `demand_c59491c9…`、规划（任务包写明前置条件不成立时不建目录、以 blocked / no-changes 导入并照常回调）、投递 accepted（hook 记录 `7f23e79b…`，助手 `landing: observed`）→ 目标以 `blocked` 导入 `target-result_fd4a693b…`（`no-changes`），回调 landed，完成记录 confirmed → Controller 只读核对（目录确实不存在、全仓库没有新文件或新目录、基线四行未变）并把探针输出登记为证据 `evidence_eacb00fd…` → 记 **escalate**（`target-review-decision_baf2e28e…`，升级事件 `demand-event_212a0114…`，修订 7），Demand 进入 `decision-required`、owner 为 user、blocker `awaiting-decision`；Controller 给出四个选项并建议取消。我选 1：`wakeflow_continue_demand` 的 record-decision 把选项原文与我的话记入（修订 9）→ `wakeflow_cancel_demand` 预览 8 门全过（含 work-claims-released 与 payload-privacy）→ 应用为 `cancelled`（修订 10），归档 `archives/demand_c59491c9…/0000000010`（14 个文件，89,461 字节），需求包 `withdrawn`。外部核对：无活动 Demand、board archived 4 / withdrawn 1、无声明，`wakeflow_verify` 14/14，AlembicPlugin 未出现 `docs/archive/`，仍只有前四轮的四个未跟踪文件。至此评审的 accept、rework（satisfactory）、escalate + 用户决定、cancel 四条路径都在真实宿主上走过；blocked 决定与 continue_demand 重开尚未现场跑。

**残留。** blocked 决定（带 resumption 的再决定）与 `continue_demand` 重开已完成的 Demand 两条路径只有切片测试，没有现场；证据的 `link` / `commit` / `observation` 三种引用来源与 `controller-confirmed` 内容审阅同样只有测试；旧实现的证据"关系"记录（≤ 256 条）按现行设计不移植；Codex 宿主仍未做真实会话测试（未执行）。

## 13.124 逐模块对齐第三轮：工作区维护与对账——对照、一处护栏移植、两项待裁决（2026-09-24）

**背景。** 第三轮对照旧实现的初始化、对账、重配置、维护事务、本地布局、受管内容、支撑面与配置权威：`wakeflow-{fresh-initialize,reconcile,reconfigure}.mjs`、`wakeflow-maintenance-{plan,coordinator,action-composition,action-runtime}.mjs`、`wakeflow-local-layout{,-inspection,-realization}.mjs`、`wakeflow-managed-content.mjs`、`wakeflow-support-{materialization,surface-owner}.mjs`、`wakeflow-tracked-materialization.mjs`、`wakeflow-workspace-mutation.mjs`（6482 行）、`wakeflow-config-v3*.mjs`、`wakeflow-state-lock.mjs`，以及 `bootstrap` / `setup` / `validate` 入口，共二十余个测试文件、约两百条旧测试名。新实现这一带是 §13.94–§13.116 的重切主体，逐条核对可观察行为。

**行为对照。**

| 旧实现已验证的行为（测试名摘要） | 新实现 | 状态 |
|---|---|---|
| reconcile 推导精确当前配置、preview 零写、reconcile 输入封闭不接受 desired config | 同 | 同形 |
| reconcile 规划缺失目录并补齐 | 对账自动修复集（活动布局、看板、ledger 根与容器、宿主 capability 目录、支撑面根与 scaffold、`.gitignore` 托管块、指令托管块、记忆文件、协议根、运行时根，§13.107 / §13.114） | 同形 |
| reconcile 只做"安全的 mode 修复"：owner 有 rwx 且 group/other 无写权限的目录收敛到 0700，同 inode fchmod 后双重重验；不安全的 mode 只报告 | 新实现所有静态声明都是 `observe-without-change`，mode 漂移一律 `*-conflict` 只报告 | **差异，记为 D8** |
| 派生投影漂移由 owner 修复；不安全的派生投影阻塞所有写入 | 窗口运行投影缺失或过期重算，读不出的只报告并继续（§13.108） | 同形（更宽） |
| 另一宿主首次进入只物化自己的宿主面 | 对等宿主加入只写自己的文件（§13.120 D2 用例） | 同形 |
| reconfigure：稳定 ID 拓扑差异（unchanged / metadata / add / remove / root / role）；host 偏好变化不算拓扑删除；移除的窗口由生命周期 owner 阻塞；只删精确过时的仓库托管块 | 新实现只接受位置稳定的 reconfigure：`topology` / `storage` / `pods` 改动报 `*-change-unsupported`；hosts、语言、显示元数据可改（§13.116 D1） | **差异，记为 D9** |
| 配置 owner 拒绝过期身份、链接、符号链接、无关残留；prepare / commit / cleanup 崩溃边界恢复 | 配置权威替换：exact source、专属锁、stage 恢复 | 同形 |
| 同模型 reconfigure 审计受管内容，当前即零步 | 同 | 同形 |
| fresh 拒绝当前或过时的 Wakeflow 受管足迹 | fresh 阻塞既有受管支撑面根与 ledger 根 | 同形 |
| 维护事务：journal 先于步骤、锁不自动打破、oversized 计划在门前拒绝、跨进程互斥、owner 效果先耐久检查点、恢复只从耐久记录续 | 维护 gate + journal store + intent + recovery 用例同形 | 同形 |
| 受管内容：托管块手改即 blocked、重复 / 孤儿 / 倒置标记失败关闭、用户自己的 ignore 规则保留而矛盾规则阻塞、owner-managed 面零写 | 同 | 同形 |
| 支撑面：两宿主与各种所有权组合、owner-managed 面无隐藏记忆 | 同 | 同形 |
| 配置快照：符号链接与多链接文件失败关闭、读前读后 stat 比对、超限与非 v3 区分 | 同 | 同形 |
| 文件锁：私有锁字节、悬空符号链接不无限重试、消失的持有者重试、过期只在 unlink 后报告、超大持有者记录不解析 | `rooted-exclusive-file-lock`：pid 活性、超时、inactive owner 退役、4 KiB 记录上限 | 同形 |
| validate：插件面校验（MCP 配置、注解矩阵、技能 frontmatter、符号链接、包元数据、schema 面） | `build:check`、`release:check`、制品测试与目录测试 | 有依据的重切 |
| bootstrap 拒绝包含已装载制品的工作区根、拒绝与制品重叠的配置根 | 无 | **移植** |
| 迁移分支、preservation 保全、host activation | 无 | 放弃（ADR-0008，能力卡 8 Q6、10 Q2） |

**移植：工作区不得与已装载制品重叠。** 两个维护入口在装载时从自身位置推导制品根（`lib/entrypoints/<x>.js` 的上两级，realpath；测试构建里是 `.build`）交给单宿主 facade（`artifactRoot`）。切片在规划前检查：工作区根包含制品或位于制品之内 → `workspace-root-overlaps-artifact`；fresh / reconfigure 的配置根（仓库、支撑面、`ledgerRoot`）与制品重叠 → `configured-root-overlaps-artifact`；任一命中预览即 blocked，不调宿主预览、不写任何东西。这是旧 bootstrap 的两条护栏，防的是把插件仓库自己初始化成工作区（受管文件写进插件目录）或把插件目录当产品仓库。回归：切片测试覆盖"制品在根内"、"根在制品内"（上级目录同时包含 `../ProductA` 与 `Ledger`，两条阻塞都在）、"配置根就是制品"、无关根与未知根不阻塞、reconcile 只查根。

**待裁决。**

- D8 安全 mode 修复。旧实现的对账会把私有目录（0700）上"owner 有 rwx 且 group/other 无写权限"的 mode 漂移收敛回 0700（同 inode fchmod、双重重验），不安全的 mode 只报告；新实现十几处 `permissionBits !== 0o700` 一律报冲突，工作区一旦被 `chmod -R` 过就只能手工修。建议移植，但它横跨约十个检查点与物化器，建议单独一轮：在 foundation 的目录物化器加一个 `converge-safe-mode` 策略，各私有目录声明启用，各检查把"安全漂移"从 conflict 里分出来计划成既有的 `materialize-*` 步。
- D9 改拓扑的 reconfigure。旧实现支持增删仓库与窗口（移除的窗口须先退役，过时的仓库托管块被删）；新实现把 `topology` / `storage` / `pods` 改动整体拒绝。真实工作区里"往运行中的工作区加一个产品仓库"是常见需求。建议分两步：先做**新增**（仓库与窗口：登记后即可投递），删除仍阻塞到退役完成；也单独一轮。

**回归。** 切片测试新增一条五段用例（制品在根内、根在制品内、配置根就是制品、无关根与未知根、reconcile 只查根）；维护入口测试与对账修复、外部指令用例照旧。焦点集 11/11。

**门。** `npm run build:artifacts:committed` 后 `npm test` 全链通过（`test:typescript` 1014/1014，整门 281 s），`npm run smoke:artifacts` 两宿主全过，`git diff --check` 干净。

**现场。** 用仓库里的制品本身（`plugins/claude-code-wakeflow/mcp/server.mjs`）对两个根各做一次只读 reconcile 预览：以 Wakeflow 仓库根为工作区——正是这条护栏要防的场景——返回 `blocked`、阻塞项 `workspace-root-overlaps-artifact`，仓库工作树没有任何新文件；以 `WakeflowTestWorkspace` 为工作区返回 `ready`、零步，八个窗口与既有归档不受影响。这一轮没有再跑 Demand 闭环：改动只在维护入口的前置检查，不经过投递与评审。

**残留。** D8 与 D9 待用户裁决（各建议单独一轮）；`wakeflow_verify` 门与 reconcile 阻塞码都只给代码不给路径，用户看到 `*-conflict` 时不知道是哪个节点——随 D8 一起处理；Codex 宿主仍未做真实会话测试（未执行）。

## 13.125 逐模块对齐第四轮：窗口与宿主——对照、两处移植（resume / relocate；活 pane 守卫与退出探测）（2026-09-25）

**背景。** 第四轮对照旧实现的窗口绑定与运行投影、宿主 profile 与能力合同、Claude 宿主的生命周期 / 定位器 / settings / 退役、Codex 宿主模块、进程边界与制品校验：`wakeflow-window-{binding-records,binding-service,runtime-projector,runtime-records}.mjs`、`wakeflow-host-{profile,capability}.mjs`、`wakeflow-process-identity.mjs`、Claude 的 `wakeflow-claude-{lifecycle,locator,settings,decommission,host}.mjs`、Codex 的 `wakeflow-codex-*.mjs`，以及十三个测试文件。

**行为对照。**

| 旧实现已验证的行为（测试名摘要） | 新实现 | 状态 |
|---|---|---|
| 绑定记录敏感、宿主 profile 拥有句柄种类、稳定 windowId 决定 ref；register 创建一次、同句柄重放字节稳定 | `wakeflow-window-host-binding*`：私有 0600 记录，同句柄 `replayed`，异句柄 `handle-conflict` | 同形 |
| 普通登记不能替换或夹带写权限；替换与退役要求 bindingId + 摘要 CAS | `replace` / `decommission` 都带 `expectedBindingId` 与 `expectedBindingDigest` | 同形 |
| 活跃租约阻塞绑定替换与退役 | `claim-held` 阻塞 replace 与 decommission | 同形 |
| 重复句柄、遗留双权威失败关闭；不安全的库存零写；孤儿身份只库存不选为权威 | 句柄跨窗口唯一（`handleOwners`）；不安全记录只报告 | 同形 |
| 运行投影：每个耐久窗口一次重建、字节确定；根观察在身份登记之后才开始；绑定创建或替换只让派生字节过期，从不暴露句柄；同一仓库的窗口共享一次根观察 | registered / unregistered 投影 + 投影维护（缺失或过期重算，读不出只报告） | 同形 |
| Claude 生命周期：identity-first 启动、从不返回原始句柄；mutex 后配置漂移在物理创建前拒绝；不安全的 tmux 配置在宿主效果前拒绝 | 助手 `launch` 用 inspect 的启动意图（含 intentDigest），句柄只进私有绑定文件；register 核对 `launchIntentDigest` | 同形 |
| **resume 消费精确私有句柄、保留绑定、创建新的定位器代际；resume 拒绝仍活着的定位器** | 无：pane 没了只能 close + launch + replace（新会话，丢上下文） | **移植** |
| 定位器：观察核对 socket、session、window、pane、进程与 live 元数据；身份替换让旧定位器作废 | 定位器随 register / replace 重写；deliver 的 pane authority（§13.122） | 同形 |
| 退役：Claude 精确关闭只在有界缺席后机器核实并保留身份与定位器；still-present 关闭阻塞；Codex 归档是人工门 | `decommission`：Claude 凭 pane 缺席与 session-end 证据机器核实，Codex 走人工宿主门 | 同形 |
| settings：可移植合并保留用户键与顺序、只收敛受管条目；自定义状态栏保留、冲突阻塞；本地 settings 要有真实的 ignore 证据；授权按 repositoryId 精确 | portable settings transition / rules / statusline 操作同形；规则只在程序根（§13.117 D5） | 同形 |
| 宿主能力合同：核心不含 Codex-versus-Claude 分支；capability 只描述适用性 | 宿主差异只在 `src/hosts/<host>/` 与 profile 数据（TSD-12） | 同形 |
| 进程边界：只允许六种只读 git 观察与固定 ps 查询，无 shell | 观察层从不 spawn（hook 入口闭包只到 kernel）；spawn 只在 gitignore 观察与 tmux 助手 | 同形 |
| 制品校验：marketplace 源绑定制品根；MCP 布线拒绝继承的工作区根环境默认值 | 制品测试与 §13.124 的制品重叠护栏；`root` 逐请求传入 | 同形 |
| 激活范围、迁移退役、runtime-meta | 无 | 放弃（能力卡 10 Q2、ADR-0008） |

**移植一：`relocate` 与助手 `resume`。** 旧实现的 `resumeClaudeWindow` 让一个 pane 已死的窗口在新 pane 里用同一个 Claude 会话续跑：绑定不变、只换定位器代际。新实现原来只有 close + launch + replace 一条路——新会话、丢掉上下文。现在：绑定端点新增第六种操作 `relocate`（请求形状同 replace；准入同 register 的意图摘要、tmux 坐标、hook 证据；句柄必须等于当前绑定的句柄，否则 `handle-changed`；只有 tmux 定位器的宿主可用，否则 `locator-provider`；持有的工作声明不阻塞——同一会话继续它的工作；结果 `relocated`，绑定与其摘要原样，定位器文件换成新坐标与新 locatorId，投影刷新）。Claude 助手新增 `resume --window <id> [--wait N] [--force]`：stdin 同 launch 的 inspect 结果，从绑定文件取私有会话 id，把启动参数里的 `--session-id <占位符>` 换成 `--resume <会话 id>`（模型、权限、`--add-dir` 照旧），在配置的 tmux 会话里开新 pane，等这个会话**新的** session-start 记录（Claude Code 对 `--resume` 也触发 SessionStart；"新"按记录文件名集合的差判定），打印 relocate 用的 observation。

**移植二：活 pane 守卫与退出探测。** `launch` 与 `resume` 在定位器指向的 pane 还活着时拒绝（`locator-live`，带坐标与提示；`--force` 跳过）——旧实现 resume 的同一守卫，防的是给同一个逻辑窗口开出第二个物理窗口。现场又暴露一条旧实现没有覆盖的路径：Claude Code 拒绝 `--resume` 一个从未有过对话的会话（"No conversation found with session ID"），进程直接退出，tmux 随之关掉窗口；第一版 `resume` 只报 `hook.sessionStart: pending`，Controller 若照着 relocate 就把绑定指向一个不存在的 pane（现场就发生了：relocate `relocated`、随后 `mark` 报 `pane-missing`）。现在 `launch` 与 `resume` 等不到 hook 记录时再核对新 pane：已消失或已死就拒绝为 `launch-exited` / `resume-exited`（带坐标、`pane: absent | dead` 与提示），只有 pane 活着才是 `pending`；两条命令共用同一个开窗口函数。

**回归。** 决定测试新增 relocate 六段（接受、持有声明不阻塞、句柄变了、Codex 宿主、CAS 漂移、缺坐标、无绑定）；切片测试新增 Claude relocate（绑定 id 与摘要不变、定位器换坐标与代际、异句柄拒）；助手测试新增 resume 与活 pane 守卫（launch / resume 各拒一次，pane 死后 resume 的 tmux 命令含 `--resume <id>` 且不含 `--session-id`，观察到新的 session-start，无绑定的窗口 `binding-missing`，hook 待定但 pane 活着仍是 `pending`，pane 消失 `resume-exited: absent`、pane 已死 `launch-exited: dead`）；MCP 目录测试要求描述里保留"never creates, inspects, or closes host windows"，描述压到恰好 640 字节。焦点集 25/25，退出探测补上后助手、维护执行与技能文本焦点集 23/23。Controller 技能与 `windowLaunch` 取值写明 resume → relocate → mark 的顺序。

**门。** `npm test` 全绿：typecheck、architecture、Biome lint（714 文件）与 format（245 文件）、knip、TypeScript 测试 1017/1017（含二十个端到端场景）、schema 漂移检查、`build:check` 与已提交制品一致；`npm run smoke:artifacts` 通过；`git diff --check` 干净。

**现场。** 仍是 WakeflowTestWorkspace 的八个窗口：用仓库制品的副本经 stdio 调 MCP，直接调工作区里的助手资产。先 reconcile 把重建的助手部署进去（预览只有 `asset:claude-code:tmux` 一步，apply completed）。AlembicPlugin（会话已有 47 轮对话）：定位器的 pane 还活着时 `resume` 拒 `locator-live`（坐标 %15）；`close` 后 `resume --wait 40` 在新 pane %22 里观察到这个会话新的 session-start（`hook.sessionStart: observed`），`relocate` 回 `relocated` 且 bindingId 不变，`mark` 成功，inspect 的定位器换成新坐标；新 pane 的屏幕上是这个会话上一轮的回答（关于 docs/archive 的追问），上下文确实续上了；status idle，verify 14/14。AlembicDashboard（刚 replace 出来、从未有过对话的新会话）：退出探测补上之前的那一版助手把 resume 报成 `pending`，relocate 通过，随后 `mark` 报 `pane-missing`——窗口 @19 已随 claude 退出被 tmux 关掉；在调试窗口里用 `WAKEFLOW_DEBUG_EXIT=1` 复现，claude 打印 "No conversation found with session ID"。补上探测并 reconcile 之后，同一场景 `resume` 拒 `resume-exited`（`pane: absent`，带提示），随后 close + launch + replace + mark 修复（新 pane %24，hook observed）。终态八个 pane 全活、都带 Wakeflow 窗口选项，board 不变（归档 4、撤回 1），verify 14/14。

**残留。** D8 与 D9 仍待用户裁决。Claude Code 不能 resume 一个从未有过对话的会话，这是宿主行为：Wakeflow 只探测并提示改走 launch + replace；pane 已被 tmux 关掉时助手拿不到 claude 的退出输出，退出原因只能由提示推断（`remain-on-exit` 打开的会话里 pane 会留下、报 `dead`）。`resume` 在 pane 活着但 hook 记录迟到时仍报 `pending`，relocate 的准入照样要这条记录，所以 Controller 只能稍后再 relocate，不能凭 pending 登记。Codex 宿主没有 resume 路径（它的窗口由用户自己开），Codex 真实会话测试仍未执行。旧实现的激活范围、迁移退役与 runtime-meta 仍是放弃项。
