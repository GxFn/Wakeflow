# 目标架构、垂直切片与基础能力设计

> 状态：`proposed`，待用户裁决；裁决后以 [ADR-0013](../decisions/0013-target-architecture-and-slice-plan.md) 落地，并回写计划 §8.1 的 L0 与 L1
> 建立日期：2026-09-04
> 输入：[功能与场景总览](../requirements/wakeflow-functions-and-scenarios.md)、能力卡 1 到 10、ADR-0002 到 ADR-0012、[2026-09-03 节点评估](./2026-09-03-typescript-checkpoint-review.md)、当前 `src/` 度量
> 方法：自顶向下。先从功能需求推出架构必须满足的性质，再定形状，再定基础能力，最后按能力切片排序。业界依据见文末来源。

## 1. 从功能需求推出的架构性质

总览把 Wakeflow 定为四本账加一个接力协议：意图账（需求包）、执行账（Demand 事件流）、验收账（测试合同与逐步记录）、接力协议（任务包向下、结果与回调向上）。ADR-0009 定了三方边界：Wakeflow 只做权威与账本、内容提供、准入校验。由此架构必须满足七个性质：

| 编号 | 性质 | 来自 |
| --- | --- | --- |
| P1 | 每一条状态变化都是一次可重放的事件，状态只由重放得到 | 执行账、ADR-0005 |
| P2 | 每个进入状态的外部事实先过准入：形状、摘要、谱系、隐私、围栏令牌 | ADR-0009 握手、ADR-0012 |
| P3 | 判断逻辑是纯函数：给定状态与命令，得到事件或拒绝，不碰磁盘 | Decider；可测试性 |
| P4 | 副作用只在薄壳里：加载、决定、追加、写投影，一次命令一次加载 | TSD-14、L0 退出门 |
| P5 | 公共面小而扁平：三种调用形状，结果带 `next`，目录小于 60 KB | ADR-0004、ADR-0012 D2 |
| P6 | 宿主差异只是数据与文本：句柄种类、证据策略、hook 声明、意图模板、skills 步骤 | ADR-0009 三层拆分 |
| P7 | 任何会话都可替换：状态与投影足以让新会话接手 | 接力协议、能力卡 2 |

节点评估里的问题正好是这些性质的反面：A2 与 A4 违反 P5 与 P4；C1 到 C3 与 C10 是 P3 与 P4 没有被基础层承接；A6 是没有切片边界。

## 2. 目标形状：内核加切片

采用三种业界形状的交集：Cockburn 的端口与适配器决定"外面有什么"，Bernhardt 的函数式内核与命令式外壳决定"里面怎么分"，Bogard 的垂直切片决定"代码按什么组织"。Dudycz 的 Decider 是切片内核的具体形态。

```text
entrypoints/   MCP 组合根（每宿主一个）、hook 观察脚本入口；工具目录由切片登记表生成
hosts/         宿主 profile 纯数据：句柄种类、占位符、证据策略、hook 声明、启动与 worktree 意图模板、settings 条目；观察解析器（pane 行、porcelain、hook 记录）
capabilities/  垂直切片，每片同构：contract、decide、service、tool、projection、tests
kernel/        应用内核：事件流存储与快照、发布事务、追加命令、next 投影、隐私扫描、脱敏、结果上限、错误模型、schema 运行时、配置权威、布局描述符、hook 观察存储、工作声明与围栏、幂等键存储
contracts/     JSON Schema、生成类型、词汇表（事件、前沿、状态、分类）作为数据表
foundation/    与产品无关的原语：持久文件系统、规范 JSON、摘要、id、时间、文本
```

依赖只能向下：entrypoints → hosts、capabilities → kernel → contracts → foundation。切片之间不互相 import；共享的东西要么下沉到 kernel，要么通过事件词汇表与状态类型在 contracts 里相遇。dependency-cruiser 现有 18 条规则改为这六层的 6 条方向规则加"切片互不引用"一条。

### 2.1 端口

按 Cockburn 的建议只留四个次级端口，全部在 kernel 里定义，foundation 实现：

| 端口 | 职责 | 实现 |
| --- | --- | --- |
| `DemandStreamStore` | 一条 Demand 的提交批、快照、追加候选；`append(expectedRevision)` CAS | foundation 持久文件原语 |
| `WorkspaceFiles` | 工作区根、ledger 根、本地运行时根下的受根约束读写、锁、发布事务 | 同上 |
| `HostObservations` | 只读：hook 观察记录、Agent 交回的观察 | 本地运行时目录 |
| `Clock` 与 `Ids` | 时间与 typed id | foundation |

主端口只有两个：MCP 工具，与宿主调用的 hook 观察脚本。

### 2.2 切片解剖

每个切片是一个目录，文件集固定，命名固定，新切片按模板生成：

| 文件 | 内容 | 纯度 |
| --- | --- | --- |
| `contract.ts` | 工具名、请求与结果 schema id、调用形状（读、追加、效果）、`response_format` | 数据 |
| `decide.ts` | `decide(state, command) → events | rejection`；只依赖 contracts 的类型与词汇表 | 纯函数 |
| `service.ts` | 薄壳：一次加载，调用 decide，一次追加，写切片自己的投影；效果型再加 plan 与 recover | 副作用 |
| `projection.ts` | 本切片对 `next`、status、活动投影的贡献，是状态的纯函数 | 纯函数 |
| `tool.ts` | 把 contract 与 service 登记到工具目录；无逻辑 | 胶水 |
| `decide.test.ts` | given 事件、when 命令、then 事件或拒绝；Emmett 风格 | 快 |
| `scenario.test.ts` | 经公共 MCP 在一次性工作区跑本切片的一条端到端链 | 慢，每片一条 |

Demand 只有一个聚合：`evolve(state, event)` 与事件词汇表在 `capabilities/demand/` 里，其余 Demand 作用域的切片只贡献命令、事件类型与 decide，向词汇表登记，never 守卫保证漏登即编译失败。这解决 C5。

### 2.3 三种调用形状在内核里各一份实现

| 形状 | 内核提供 | 切片只写 |
| --- | --- | --- |
| 读 | 一次观察、脱敏、上限、`response_format` | projection |
| 追加 | `AppendCommand`：解析请求、幂等键查找与保存、加载流、调用 decide、`expectedStreamRevision` CAS、追加、刷新快照、组装 `next`、错误映射 | decide 与请求 schema |
| 效果 | `PublicationTransaction`：preview 出 plan 与摘要、journal、apply 在锁内重算比对、逐步 checkpoint、recover 只向前 | plan 派生与步骤执行器 |

22 个协调器与 8,075 行的共有部分全部由这两个内核对象承担；切片里不再出现 catch 映射、assertRoot、isAbortSignal、parseOptions 的副本。这是 C1 与 C2 的解法，也是 L0 退出门"协调器行数降 40%"的来源。

### 2.4 错误模型

一个错误类型 `WakeflowError{code, reason, path, retryable}`，`code` 来自 contracts 里的封闭表；切片用 `fail(code, reason, path)`。301 个错误类与 306 张消息表删除。公共结果里的错误经同一映射，稳定错误码进 schema。

### 2.5 隐私与脱敏一套

`PrivacyScan` 一个引擎一套词汇（能力卡 8 Q1）：只拒凭证类，路径与 UUID 按工作区根与 typed 前缀白名单；证据、需求包、结果、归档共用。`Redaction` 一个策略：公共输出扫描工作区根、ledger 根、home、全部已登记句柄；上限表一份。C3 的 13 份签名归一。

### 2.6 工具目录

目录由切片登记表生成；每个工具一份请求 schema，共享 `$defs` 用 `$ref` 不内联；outputSchema 不内联（ADR-0004）；描述压到两句；效果型 apply 只带 `planRef` 加 `planDigest`。目标 `tools/list` 低于 60 KB，热启动低于 500 毫秒，校验器由 codegen 预编译并惰性加载（C10）。

## 3. L0 基础做实

L0 只做减法与承接，不加业务。对象是 foundation 与 kernel。

### 3.1 foundation 收敛

现状 63 文件，其中 filesystem 36 个。目标按职责合并为 14 个原语，名字即合同：

| 保留或合并后 | 承接的现有文件 | 说明 |
| --- | --- | --- |
| `rooted-directory` | rooted-directory、rooted-exact-resource-handle、rooted-resource-parent-handle | 根约束句柄 |
| `stable-read` | stable-file-read、stable-directory-read、stable-resource-tree-read、file-node-snapshot、file-byte-range | 三次 stat 一致的读 |
| `durable-write` | durable-atomic-file-write 系列 5 个、durable-regular-file-link、durable-regular-file-settlement、durable-resource-rename、exact-regular-file-unlink | 同目录 stage、rename、fsync 文件与父目录 |
| `durable-tree` | durable-directory-materialization、durable-directory-tree-candidate 系列 3 个、durable-directory-tree-publication、directory-tree-candidate 系列 2 个、absolute-directory 系列 2 个 | 树的一次 rename 发布与退休 |
| `bounded-scan` | bounded-directory-tree-scan | 有界遍历 |
| `exclusive-lock` | rooted-exclusive-file-lock | 不自动打破 |
| `json-file` | deterministic-json-file、create-only-deterministic-json-resource、whole-file-content-transition、strict-text-file | 规范 JSON 文件的创建与 CAS 替换 |
| `file-copy` | durable-file-candidate、durable-file-copy-candidate 系列 2 个 | 归档与证据用 |
| `artifact-tree` | artifact 目录 4 个 | 树身份、传输计划与发布 |
| `canonical` | data 4 个、crypto 3 个 | 规范 JSON、sha256、被动数据 |
| `ids` | identity、git-object-id | typed id 与 git oid |
| `time` | time 5 个 | 保持 |
| `schema-runtime` | schema 1 个 | 改为加载 codegen 预编译校验器 |
| `text` 与 `errors` | text 2 个、node-system-error、numeric | 保持 |

`event-sourcing/event-sourcing-version-evolution` 上移到 kernel 的事件流存储。`git` 目录的 ignore 观察归 workspace 切片。合并的判据只有一个：两个文件是否总是被同一调用方一起使用。

### 3.2 kernel 新建

| 模块 | 职责 | 取代 |
| --- | --- | --- |
| `demand-stream` | 提交批追加、快照刷新、默认快照加尾部读、audit 全量读为显式模式、commitId 单一来源（命令内容派生） | 19 处全量重放、5 次读、双重 evolve（A4、C4、C7） |
| `append-command` | 2.3 的追加形状 | 协调器样板 |
| `publication-transaction` | 2.3 的效果形状 | 维护事务与各 preview/apply 的重复 |
| `idempotency-store` | 幂等键到首次结果的保存与比对，24 小时清理 | 新 |
| `next-projection` | 从状态派生 `{frontier, owner, suggestedTool, blockers}`，一张表 | 22 个前沿的分散逻辑 |
| `privacy-scan`、`redaction`、`limits` | 2.5 | 13 份签名、8 种上限 |
| `error` | 2.4 | 301 类 |
| `config-authority` | 配置读取、快照、事务替换；schema `urn:wakeflow:config:v1` | 现有 configuration 目录 |
| `layout` | 布局描述符：根、目录、模式、tracked 与 ignored | 现有 workspace 描述符 |
| `hook-observations` | 观察记录的写入格式与读取；按会话 id、cwd、事件、prompt 摘要索引 | 新 |
| `work-claim` | 工作声明、围栏令牌、四元组释放、恢复门 | 现有 delivery 下的声明存储 |
| `receipts` | `git worktree list --porcelain`、pane 行、线程句柄的解析与校验 | 新 |
| `tool-registry` | 切片登记表、目录生成、`response_format` | 现有 entrypoints 组合根 |

### 3.3 L0 退出门

沿用计划 L0 行的数字并补两条：协调器总行数降 40% 以上；治理层 catch 行占比低于 5%；一次写命令只读一次事件流；100 个 commit 下 append 低于 50 毫秒；组合根热启动低于 500 毫秒；`tools/list` 低于 60 KB；lint 门为绿；foundation 文件数不高于 20；kernel 每个模块有直接测试。

## 4. L1 垂直切片

排序原则：先做后面每片都要用的机制，再按主流程直线从头到尾，最后并发与观察。每片的退出门都是"decide 测试加一条场景验收通过，且被替代的旧形状在同一提交删除"。

| 序 | 切片 | 范围 | 公共工具 | 主要事件 | 删除重写 | 依据 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | workspace | 初始化、重配置、对账、维护恢复；配置 v1 含 `pods[]`；同目录与祖先拒绝；指令托管块；Claude MCP 规则 | `maintain_workspace` | 无（配置事务） | 现有 maintenance 22 文件与 managed-integration 13 文件按内核重写 | 卡 1、ADR-0010 |
| 2 | endpoint | 启动意图、登记、替换、退役、工作声明与强制释放、hook 通道、Claude pane 分类 | `register_window_binding`（含 inspect 与 replace） | 绑定不进事件流 | window-runtime 21 文件 | 卡 2、ADR-0009 |
| 3 | requirement | 需求包 preview 摘要、章节校验、发布即上板、板查询、撤回与 supersedes | `publish_requirement`、板查询 | 无（ledger 记录加认领状态） | ledger 20、todo 24 文件；`intake_todo`、`publish_confirmation` 删除 | 卡 3、ADR-0011 |
| 4 | demand | 认领即创建、状态与词汇表、`next`、完成即归档（含 verify 门）、取消、继续、`escalate` 与 `decision-recorded`、第三次 rework 刹车 | `create_demand`、`complete_demand`、`cancel_demand`、`continue_demand`、`wakeflow_status`（带 demandId） | created、escalated、decision-recorded、completed、cancelled、archived | demand 38、lifecycle 6、controller 3 文件 | 卡 4、ADR-0012 D3 D5 |
| 5 | tasking | 实现任务包、锚点 `requirementRef`、替换与继续谱系、test 任务包的 `testContract` | `plan_target_task` | target-task-planned | tasking 9、testing 23 文件；`plan_test_card` 删除 | 卡 5、ADR-0012 D4 |
| 6 | delivery | 一次调用的准备与许可、prompt 骨架、outcome 与 hook 自动、rearm、ambiguous 出口、回调 `wake-controller` | `prepare_delivery`、`record_delivery_outcome`、`rearm_delivery` | prepared、outcome-recorded、rearmed、callback-acknowledged | delivery 31 文件；`claim_target_host_effect`、`prepare_test_delivery` 删除 | 卡 6、ADR-0012 D1 D2 |
| 7 | result-review | 导入（定位符核摘要、隐私、branch 与 commit、逐步记录与分类、返回回调）、评审投影含基线对比、两类决定 | `import_target_result`、`inspect_target_result_review`、`record_implementation_review_decision`、`record_test_review_decision` | result-recorded、decision-recorded | result 11、review 27 文件；`resume_target_result_review`、`authorize_product_defect_remediation` 并入 | 卡 7、ADR-0012 D4 D5 |
| 8 | evidence | 三种来源加 `pod-worktree` 与 `observation`、kind 闭集、隐私收窄 | `record_evidence` | evidence-recorded | evidence 21 文件 | 卡 8 |
| 9 | pod | 创建 preview 与 apply、两阶段 ready、关闭含清理、worktree 回执 | `wakeflow_pod` | 无（配置事务加回执） | 新 | ADR-0010 |
| 10 | observation | `wakeflow_status` 全域、`wakeflow_verify`、活动投影、Claude 状态栏资产 | `wakeflow_status`、`wakeflow_verify` | 无 | active 7 文件 | 卡 9 |

公共工具收敛为 20 个：maintain_workspace、register_window_binding、publish_requirement、板查询、create_demand、complete_demand、cancel_demand、continue_demand、plan_target_task、prepare_delivery、record_delivery_outcome、rearm_delivery、import_target_result、inspect_target_result_review、两个决定、record_evidence、wakeflow_pod、wakeflow_status、wakeflow_verify。以现有 23 个为基线：删 8（publish_confirmation、intake_todo、inspect_demand_route 并入 status、plan_test_card、prepare_test_delivery、claim_target_host_effect、resume_target_result_review、authorize_product_defect_remediation），改名 4，新增 5（cancel、continue、pod、status、verify）。

## 5. L2 与 L3 的接口

L2 场景联合：以总览第 3 节的 14 步为清单，把十个切片的场景串成一条从初始化到 pod 关闭的完整验收，skills 与 commands 文本随之重写；两宿主各完成一次真实投递与回调。L3 制品：构建器产出 manifest、MCP 接线、skills、commands、hooks 与 notify 配置、观察脚本、指令记忆、README、marketplace；版本从 `1.0.0` 起。

## 6. 测试策略

按函数式内核的结论倒置：decide 测试多而快，壳的测试少而真。

| 层 | 形式 | 数量目标 |
| --- | --- | --- |
| foundation 与 kernel | 直接单元测试，含并发准入 | 每模块一份 |
| 切片 decide | given-when-then 表驱动 | 每片一份，覆盖全部命令与拒绝 |
| 切片场景 | 现有场景验收骨架，一片一条 | 10 条 |
| 端到端 | L2 的 14 步一条 | 1 条 |
| 制品 | 双 validator 与冒烟五幕 | L3 |

现有 263 份测试、10 个独立工作区 fixture、6 分钟墙钟改为：一个共享的一次性工作区 fixture，治理测试墙钟低于 3 分钟，重复的 catch 映射测试删除。

## 7. 与现有 TS 的关系

保留并承接：foundation 的持久化语义与 TOCTOU 纪律、事件溯源的提交批与 CAS、配置 codec 的严格度、ledger 记录的摘要链、需求包与 Demand 的根先建后认领、隐私扫描的规则集。删除重写：22 个协调器、301 个错误类、13 份脱敏签名、window-runtime 与 managed-integration 的重复三件套、test-card 系列、confirmation family、intake_todo、claim 与 prepare 的三段。切换方式不变：每片完成即删被替代物，E4 原子切换删除旧 JS。

## 8. 需要裁决的项

| 编号 | 决定 | 备选 |
| --- | --- | --- |
| A | 六层形状 foundation、contracts、kernel、capabilities、hosts、entrypoints，切片互不引用 | 保持现有七目录只做内部整理 |
| B | 切片解剖固定七文件，Demand 单聚合加事件词汇表登记 | 每片自定结构 |
| C | 三种调用形状由内核各一份实现，协调器删除 | 保留协调器只提取公共函数 |
| D | 一个错误类型加封闭错误码表 | 保留错误类层级 |
| E | foundation 收敛到 14 个原语 | 只删无消费者的文件 |
| F | 公共工具 20 个的清单 | 保留 23 个只改语义 |
| G | 切片顺序 workspace、endpoint、requirement、demand、tasking、delivery、result-review、evidence、pod、observation | 先 delivery 后 workspace |

建议全部取第一列。

## 来源

- Alistair Cockburn, Hexagonal architecture. https://alistair.cockburn.us/hexagonal-architecture/
- Gary Bernhardt, Functional core, imperative shell. https://www.destroyallsoftware.com/screencasts/catalog/functional-core-imperative-shell
- Jimmy Bogard, Vertical slice architecture. https://www.jimmybogard.com/vertical-slice-architecture/
- Oskar Dudycz, Emmett projections and testing. https://event-driven.io/en/emmett_projections_testing/
- Anthropic, Writing tools for agents. https://www.anthropic.com/engineering/writing-tools-for-agents
- Stripe, Idempotent requests. https://docs.stripe.com/api/idempotent_requests
- ToolGate. https://arxiv.org/abs/2601.04688
- Ajv standalone validation code. https://ajv.js.org/standalone.html
- dependency-cruiser. https://github.com/sverweij/dependency-cruiser
