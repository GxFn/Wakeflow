# Wakeflow TypeScript 全新项目能力重构开发计划

> 创建日期：2026-08-25
> 当前状态：`engineering-foundation-in-progress / capability-model-pending / implementation-paused`
> 需求权威：[TypeScript 单一源码、双宿主制品与轻量测试需求](./wakeflow-typescript-dual-artifact-build-requirement-2026-08-24.md#ts-document-role)
> 产品行为基线：[初始化生成文件需求 D1-D41](./wakeflow-initialization-generated-files-requirement-2026-08-05.md#req-decision-register)、[D38 全局职责闭环](./wakeflow-initialization-generated-files-requirement-2026-08-05.md#req-d38-global-contract)、[初始化 v3 当前实现](./wakeflow-initialization-v3-development-plan-2026-08-06.md#dev-progress)
> 基础服务边界：[全局基础服务需求](./wakeflow-foundation-services-requirement-2026-08-11.md#foundation-document-role)、[review 与实施分界](./wakeflow-foundation-services-requirement-2026-08-11.md#foundation-review-implementation-separation)
> 环境边界：源码只修改 Wakeflow 仓库；真实初始化验收只使用用户指定的可丢弃 `WakeWorkspace`；`AlembicWorkspace` 完全排除
> 授权边界：本文是开发上下文和阶段门，不因创建本文自动授权真实工作区操作、commit、version、tag、push、publish 或插件缓存刷新

<a id="ts-dev-document-role"></a>
## 1. 文档职责与最终目标

本文把已确认的 TypeScript 方向约束为一个**全新项目的能力重构过程**。它不是旧 JavaScript 文件到新 TypeScript 文件的迁移清单，也不把旧目录结构当作新架构输入。

最终目标是：

> 在 `src/`、`tooling/`、`tests/` 中按 Wakeflow 的功能能力与依赖层级重新实现完整产品；开发期间保持当前 JavaScript 实现、旧测试和双插件制品不变且可运行；新项目全部完成后，通过整体新旧对比证明功能完整性，再原子切换源码与制品权威并清理旧体系。

本文负责：

1. 固化工程底座、能力设计、能力实现、整体对比和最终切换的阶段边界；
2. 为每个阶段写明真实代码核验、实现输入、证据、退出标准和停止条件；
3. 约束旧基线与新项目的物理隔离，防止逐文件复制、兼容 wrapper 或中途制品切换；
4. 指向需求锚点，确保重构不凭文件名或旧测试形状重新发明产品合同；
5. 记录已验证事实和开发进度，不把尚未确认的能力划分写成既定架构。

<a id="ts-dev-strategy-correction"></a>
## 2. 已确认的策略修正

2026-08-25 确认以下开发策略，并废止此前的逐文件迁移路线：

- 旧 `core/`、`tools/`、`test/` 和当前两个插件制品在新 TS 项目完成前保持原状；
- 新实现按功能区块和能力层级组织，不按旧文件名、旧目录或旧测试文件逐项搬迁；
- 开发过程中不为单个能力切换正式 artifact owner，也不删除“看起来已经替代”的旧文件；
- 不建立旧文件复制清单、`legacy-copy` source manifest 或 shadow-copy artifact builder；
- 旧代码用于事实核验、行为对照和最终完整性检查，不成为新项目的运行时依赖；
- 全部新能力闭环后，先执行整体对比，再把制品切换与旧体系删除作为单独阶段处理。

因此，旧实现不是待逐项消费的迁移队列，而是一份稳定、可执行的参照物。文件数量和路径映射只可作为调查证据，不能成为架构或进度单位。

<a id="ts-dev-confirmed-constraints"></a>
## 3. 不再重新打开的约束

| 编号 | 已确认约束 | 开发含义 |
| --- | --- | --- |
| `TSD-01` | 全部手写 Node.js 代码最终使用 TypeScript | 生产、工具、测试均进入新体系；非代码资产和精确 allowlist fixture 除外 |
| `TSD-02` | 两个插件是 committed generated artifacts | 最终可直接安装，但不能继续承担手写源码职责 |
| `TSD-03` | 当前完整 v3 是行为基线 | 不做缩减版重写，不借 TS 修改 authority 或 31-tool 公共面 |
| `TSD-04` | 测试同步轻量化 | 不一对一翻译旧测试；按能力不变量确定新的 evidence owner |
| `TSD-05` | JSON Schema 是 wire contract 权威 | TypeScript 类型和必要的运行时 validator 单向派生 |
| `TSD-07` | 仅 `WakeWorkspace` 可作真实初始化环境 | `AlembicWorkspace` 不读、不写、不扫描、不初始化 |
| `TSD-09` | 最低运行时升级为 Node 24 LTS | 不保留 Node 20 fallback；根和双插件最终同步升级 |
| `TSD-10` | 完全新建源码体系 | 使用 `src/`、`tooling/`、`tests/`，不在旧目录原地改后缀 |
| `TSD-11` | 完整旧基线保留到新项目完成 | 不逐文件迁移、切换或删除；最终统一对比、切换和清理 |

基础服务 G1-G4 仍是独立需求。将代码放入新目录不自动批准新的 class、service、registry、DI container 或公共抽象；review 中发现的候选继续登记，待统一设计后实施。

<a id="ts-dev-reading-order"></a>
## 4. 每个能力阶段的真实代码阅读顺序

能力设计和实现开始前，按以下顺序读取：

1. 本文的当前阶段目标与退出门；
2. [TS 需求的已确认方向](./wakeflow-typescript-dual-artifact-build-requirement-2026-08-24.md#ts-confirmed-direction)；
3. 对应 D1-D41 需求锚点与[当前需求覆盖入口](./wakeflow-typescript-dual-artifact-build-requirement-2026-08-24.md#ts-current-requirement-coverage)；
4. 该能力在当前旧源码中的全部 producer、consumer、Schema、状态写入、入口和 host effect；
5. Codex / Claude Code 当前制品的真实差异和旧测试中的有效不变量；
6. 本阶段开始时的 Git 状态、工具链和可复现测试基线。

旧文件名只能帮助定位，不证明职责。状态 authority、evidence authority、host effect 和 agent judgment 必须分别确认。调查结果进入能力上下文或覆盖矩阵，不形成逐文件迁移台账。

<a id="ts-dev-old-new-boundary"></a>
## 5. 旧基线与新项目的物理边界

### 5.1 旧基线

在最终切换前：

- `core/` 继续是当前共享源码权威；
- `tools/` 与 `test/` 继续执行现有维护和回归职责；
- `plugins/codex-wakeflow/` 与 `plugins/claude-code-wakeflow/` 继续是当前正式制品；
- 根 `AGENTS.md` 的 `core/`、`sync-core`、双 validator、双 smoke 和 `npm test` 规则继续有效；
- 对旧基线的行为修复只有在用户另行要求时进行，不能夹带到 TS 重构中。

### 5.2 新项目

新项目只在以下边界内实现：

```text
src/                 # 新产品源码；按确认后的能力模型组织
tooling/             # 新构建、codegen、validation、release 源码
tests/               # 新测试；按能力与证据 owner 组织
.build/               # ignored 编译、生成和临时验证输出
tsconfig*.json        # project references 与共享编译约束
```

新项目必须满足：

- 不 import `core/`、旧 `tools/` 或插件内旧可执行代码；
- 不复制旧文件后只做语法或类型润色；
- 不用 wrapper 把旧实现包装成“新能力”；
- 不写入正式 `plugins/*`，直到整体切换阶段；
- 可以在独立临时输出中做差异测试，但临时输出不取得正式制品权威。

<a id="ts-dev-engineering-foundation"></a>
## 6. E0：新项目工程底座

### 6.1 目标

建立不依赖旧实现的 TypeScript 编译、Schema 类型派生和新测试执行底座。底座只证明工程工具可用，不决定领域能力架构。

### 6.2 保留内容

- Node `24.19.0`、npm `11.17.0` 与 `engine-strict` 开发声明；
- 精确锁定的 TypeScript、`@types/node@24`、Ajv 和 Schema-to-TypeScript generator；
- 根 solution 与 runtime、双 host、entrypoints、tooling、tests project references；
- `.build/` 隔离输出；
- Schema 类型生成/漂移检查的最小工具和 focused test；
- 现有 `npm test` 前增加新底座自检，但不改变旧测试和双宿主门的职责。

### 6.3 明确不属于底座

- 旧文件到新文件的路径映射；
- 旧源码复制型 artifact source manifest；
- shadow-copy artifact assembler；
- 按旧测试文件建立的迁移/删除台账；
- 任何正式插件制品切换或旧目录删除。

### 6.4 退出标准

- 新 project references 可在 Node 24 下干净编译；
- Schema 类型生成连续运行确定，漂移检查 fail closed；
- focused tooling test 通过；
- 当前 `core/`、`tools/`、`test/` 与 `plugins/*` 无行为改动；
- 根旧仓库门仍能运行，且新增底座不会篡改正式 artifact。

<a id="ts-dev-capability-design"></a>
## 7. E1：能力地图与能力等级设计

### 7.1 当前状态

本阶段尚未确认，后续开发在此暂停。下一轮讨论需要先回答“Wakeflow 由哪些能力区块组成、每个区块提供什么等级的能力、依赖哪些低层合同”，然后才能继续写领域代码。

### 7.2 每个能力区块必须形成的上下文

| 内容 | 要求 |
| --- | --- |
| capability identity | 使用稳定、面向职责的标识，不沿用旧文件名 |
| responsibility | 明确拥有的状态、判断、转换或 effect；同时写清不拥有的职责 |
| requirement anchors | 指向 D1-D41、I3、D38 等真实产品合同 |
| inputs/outputs | 公共数据、命令、事件、receipt、projection 与稳定错误 |
| authority boundary | 区分状态 authority、证据 authority、host effect 和 agent judgment |
| dependency level | 说明依赖的低层能力与允许的上层 consumer，禁止循环或根 barrel 隐藏 |
| host seam | 明确 host-neutral contract 与 Codex/Claude 差异 |
| runtime validation | 外部输入、Schema、跨字段不变量和 TypeScript 类型各自负责什么 |
| evidence owner | compiler、codegen、domain、host、artifact、migration 或 workspace |
| old baseline probes | 为最终差异检查保留的旧入口、观察值和高风险测试，不是迁移文件清单 |

### 7.3 退出标准

- 能力区块覆盖当前全部产品职责而无明显重复 authority；
- 能力等级和依赖方向得到用户确认；
- D1-D41 与 31-tool 公共表面都能映射到能力 owner；
- host-specific 能力没有被布尔 host switch 塞入共享层；
- 基础服务候选与当前领域实现边界明确；
- 形成后续能力实现阶段的顺序，但不以旧文件顺序排序。

<a id="ts-dev-capability-implementation"></a>
## 8. E2：按能力重新实现

能力模型确认后，每个能力区块使用同一协议：

1. **核验事实**：阅读相关旧实现、全部真实 consumer、Schema、host seam 和高价值旧测试；
2. **冻结合同**：记录需求锚点、authority、输入输出、稳定错误和不可改变行为；
3. **独立实现**：只在新项目写 TypeScript，不 import、复制或包装旧实现；
4. **建立新证据**：只为真实运行时不变量写测试；类型和生成确定性由 compiler/codegen 负责；
5. **能力内验收**：运行 focused typecheck/test、host contract 和必要的故障/恢复场景；
6. **旧基线对照**：用稳定外部观察值检查候选行为，但不要求内部结构、文件路径或错误堆栈相同；
7. **登记完成**：更新能力覆盖矩阵和差异说明，不修改正式 artifact，也不删除旧文件。

发现以下情况时停止当前能力实现并返回讨论：

- 产品合同、authority 或 host seam 存在真实歧义；
- 需要新增跨领域公共服务、全局 registry 或状态机；
- 新旧差异无法判定是旧 bug、需求变化还是新实现缺陷；
- 只有依赖旧模块或复制旧实现才能继续；
- 新证据无法覆盖旧基线中的高价值并发、恢复、权限或隔离不变量。

<a id="ts-dev-comparison"></a>
## 9. E3：整体新旧完整性对比

全部能力完成后，统一建立并执行对比矩阵：

| 对比面 | 必须证明的内容 |
| --- | --- |
| 需求覆盖 | D1-D41、D38、I3 等合同均有新能力和新证据 owner |
| 公共工具面 | 31-tool 名称、输入 envelope、输出与稳定错误保持兼容 |
| Schema | `$id/$ref` 闭合，portable wire contract 无意外漂移 |
| 状态与 authority | config、active、ledger、transport、window、Pod、archive、migration 等不变量保持 |
| 双宿主 | 共享行为一致，Codex/Claude 的 locator、send、close、activation、coverage 等真实差异保留 |
| 失败与恢复 | lock、atomic write、TOCTOU、journal、preview/apply/recover、idempotent rerun 保持 |
| 安全与隔离 | path/symlink fence、redaction、tracked/ignored、host-private 信息边界保持 |
| 制品 | 两份候选 artifact 可独立构建、验证、smoke，且不依赖旧源码或 TS runtime loader |
| 测试 | 新 evidence owner 覆盖旧测试中的有效不变量，同时移除重复证据 |
| 真实环境 | 经授权后在可丢弃 `WakeWorkspace` fresh initialize、删除重建、reconfigure/reconcile |

对比结论必须区分：等价、预期结构差异、已确认旧 bug 修复、待用户决定差异和新实现缺陷。没有明确分类的差异不能进入最终切换。

<a id="ts-dev-cutover"></a>
## 10. E4：整体制品切换与旧体系清理

本阶段必须在 E3 全部通过后单独执行，不与普通能力实现混合。

### 10.1 切换任务

1. 建立只接受新 TS 编译输出、Schema 派生输出和明确静态资产的 closed artifact manifest；
2. 在临时目录生成 Codex 与 Claude Code 完整制品，检查 missing、extra、conflict、cross-host contamination；
3. 连续两次生成 byte-for-byte 一致，并通过双 validator、双 smoke、31-tool 和 package closure；
4. 原子更新两个 committed artifact；
5. 同步更新根 `AGENTS.md`、package scripts、README 和发布规则，使 `src/` 与新 build 成为唯一权威；
6. 删除旧 `core/`、旧 `tools/`、旧 `test/` 和 `sync-core` 路径，仅保留受支持且有 allowlist 的冻结 fixture；
7. 运行最终仓库门、`git diff --check` 和经授权的 `WakeWorkspace` 验收。

### 10.2 失败恢复

- 候选 artifact 构建失败：正式插件保持旧制品，不写入半份结果；
- 任一对比面未闭合：旧体系完整保留，不开始删除；
- 原子切换后的仓库门失败：修复新体系或恢复完整旧制品集合，不能混合两套正式 owner；
- 未获得 workspace/cache/release 授权：只完成仓库内可验证部分并明确报告，不扩大操作范围。

<a id="ts-dev-test-strategy"></a>
## 11. 轻量测试实施原则

- 不按 116 个旧顶层测试建立一对一迁移或删除计划；
- 旧测试完整保留并可运行到 E3，作为回归探针与历史不变量来源；
- 新测试按能力与 evidence owner 组织，不按旧源码路径组织；
- compiler 证明类型依赖、可穷尽分支和项目边界；
- codegen 证明 Schema 解析、派生确定性和漂移；
- domain test 证明状态转换、authority、失败与恢复；
- host contract 证明共享端口，host-only test 证明真实宿主差异；
- artifact test 只证明入口、文件闭包、安装形态和宿主接线；
- workspace test 只在明确授权的可丢弃环境证明真实初始化与维护；
- 删除旧测试前，必须先完成能力覆盖矩阵和新旧整体对比，而不是凭新测试数量判断等价。

目标反馈门：

| 门 | 职责 |
| --- | --- |
| `typecheck` | project references、strict flags、source boundary |
| `test:focus` | 当前能力的 exact compiled tests |
| `check:fast` | 全量 typecheck、Schema/codegen、shared domain、双 host contract |
| `build:check` | 最终阶段的双 artifact 临时重建与 committed diff |
| `npm test` | fast、双 validator、双 smoke、current migration/integration |
| `test:workspace` | 明确授权的 `WakeWorkspace` 初始化/维护验收 |
| `release:check` | 版本/tag/remote/clean-tree/package closure；仅发布流程使用 |

<a id="ts-dev-safety"></a>
## 12. 环境、安全与变更纪律

- 只修改 Wakeflow 源仓库，不修改 `AlembicWorkspace`；
- `WakeWorkspace` 仅在用户授权的验收阶段使用，可反复删除 Wakeflow 配置后重建；
- fixture、生成清单、错误输出和文档不得包含真实 token、thread/session ID、socket、PID 或机器私有路径；
- 不写插件缓存，不把当前安装态冒充新制品验证；
- 不提交、推送、发版或刷新缓存，除非用户分别明确授权；
- 保留已有及无关工作树修改；不使用 destructive Git 操作恢复；
- 共享旧代码在最终切换前仍按 `core/` + `sync-core` 规则维护，新项目不得让旧规则提前失效。

<a id="ts-dev-progress"></a>
## 13. 当前进度

| 阶段 | 状态 | 当前事实 |
| --- | --- | --- |
| E0 工程底座 | `in-progress / uncommitted` | Node 24 声明、TS project references、独立目录骨架和 Schema 类型生成最小能力已建立；待清理后复验 |
| E1 能力地图与等级 | `discussion-pending` | 尚未确认；不得开始领域实现 |
| E2 能力重新实现 | `paused` | 未开始 |
| E3 整体新旧对比 | `pending` | 旧实现和旧测试保持完整基线 |
| E4 制品切换与清理 | `pending` | 未授权、未开始 |

已验证的旧基线事实：在 Node 24.19.0 下，当前权威 runner 为 `1,821` 个测试（`1,820` 通过、`1` 跳过）；该结果证明旧体系可作为后续整体对照基线，不等于新 TS 项目已覆盖这些行为。

<a id="ts-dev-final-acceptance"></a>
## 14. 最终完成定义

本开发计划完成时必须同时满足：

1. Node 24 是根 package、双插件、类型、开发和验证的唯一最低基线；
2. `src/`、`tooling/`、`tests/` 是唯一手写代码体系；
3. 新实现按确认的能力区块和依赖层级组织，不是旧文件结构的 TypeScript 镜像；
4. D1-D41、31-tool、Schema、双宿主、失败恢复与隔离合同全部通过新旧整体对比；
5. 新测试按证据 owner 覆盖有效不变量，旧测试代码在对比通过后统一删除；
6. 旧 `core/`、旧 `tools/`、旧 `test/` 已删除，没有 `legacy/` 或 wrapper 代码副本；
7. 仅 D40 仍支持、digest/provenance 闭合的历史 fixture 保留；
8. 两份插件由同一 shared compile 和各自 host overlay 确定性生成，每个产物路径只有一个新 owner；
9. 双 validator、双 smoke、31-tool、package closure、完整仓库门通过；
10. `WakeWorkspace` 可 fresh initialize、删除后重建、reconfigure/reconcile；
11. `AlembicWorkspace` 零读取、零写入、零验证依赖；
12. 未执行的真实 host/session/release 操作明确报告，不由 smoke 或文档冒充。

<a id="ts-dev-change-log"></a>
## 15. 更新记录

- 2026-08-25：创建开发计划，确认 Node 24、全新 `src/`/`tooling/`/`tests/`、TypeScript 单一手写源码、双宿主生成制品与轻量证据目标。
- 2026-08-25：修正为能力重构路线。旧源码、旧测试和旧制品作为完整可执行基线保留至新项目全部完成；废止逐文件迁移登记、`legacy-copy` source manifest、shadow-copy 装配、中途 artifact 切换和同批删除方案；E1 能力地图与能力等级确认前暂停领域实现。
