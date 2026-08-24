# Wakeflow TypeScript 单一源码、双宿主制品与轻量测试需求

> 创建日期：2026-08-24
> 当前状态：`requirement-draft / direction-confirmed / implementation-not-started`
> 适用范围：Wakeflow 仓库内全部手写 Node.js 运行时代码、构建工具、测试代码、Schema 派生代码，以及 Codex / Claude Code 两份可安装插件制品
> 行为基线：[初始化生成文件需求 D1-D41](./wakeflow-initialization-generated-files-requirement-2026-08-05.md#req-decision-register)、[D38 全局职责闭环](./wakeflow-initialization-generated-files-requirement-2026-08-05.md#req-d38-global-contract)、[初始化 v3 当前实现](./wakeflow-initialization-v3-development-plan-2026-08-06.md#dev-progress)
> 架构关联：[D9 source ownership](./wakeflow-initialization-generated-files-requirement-2026-08-05.md#req-d09-source-ownership)、[全局基础服务需求](./wakeflow-foundation-services-requirement-2026-08-11.md#foundation-document-role)、[基础服务实施分界](./wakeflow-foundation-services-requirement-2026-08-11.md#foundation-review-implementation-separation)
> 授权边界：本文只冻结目标需求，不授权修改生产源码、迁移真实工作区、commit、版本更新、tag、push、publish 或插件缓存刷新；后续必须另建开发实施文档并获得确认后才能开始转换

<a id="ts-document-role"></a>
## 1. 文档职责

本文回答的不是“怎样把若干 `.mjs` 改名为 `.mts`”，而是：

> Wakeflow 如何把 TypeScript 建立为唯一手写可执行源码，在不削弱当前完整 v3 需求的前提下，确定性生成 Codex 与 Claude Code 两份可直接安装的 JavaScript 制品，并把现有高重复、长反馈的测试体系收敛为职责清晰的轻量证据体系。

本文同时冻结四个相互依赖的目标：

1. **源码权威**：全部手写 Node.js 代码只在 TypeScript 源中维护。
2. **制品边界**：两个插件目录继续作为可直接安装、可提交、可发布的 JavaScript 制品，但不再承担手写源码职责。
3. **合同生成**：JSON Schema、TypeScript 类型和运行时 validator 形成单向、可复现的生成链，不再由多套手工定义维持一致。
4. **测试轻量化**：每个不变量只由最低且正确的一层负责证明；编译器、生成器、共享领域测试、宿主契约和制品 smoke 不重复证明同一件事。

本文不是新的 Wakeflow 功能需求，也不重新讨论 D1-D41。当前 v3 已实现的配置、初始化、active state、ledger、transport、window、Pod、host、observability、维护事务和 migration 合同，都是 TS 转换必须保留的产品行为基线。

<a id="ts-background"></a>
## 2. 背景与当前事实

### 2.1 当前源码与制品结构

截至 2026-08-24，仓库的可执行实现以 JavaScript 为主：

| 范围 | 当前事实 | 当前职责 |
| --- | ---: | --- |
| `core/` | `93` 个 `.mjs`、`1` 个 `.cjs` | 双宿主共享源码权威 |
| `tools/` | `9` 个 `.mjs` | 同步、验证和发布维护工具 |
| `test/` | `173` 个 `.mjs`，其中顶层 `116` 个 `*.test.mjs` | 回归测试及历史 fixture 模块 |
| Codex 插件 | `99` 个 `.mjs`、`1` 个 `.cjs` | 共享副本、Codex 接缝和可安装制品 |
| Claude Code 插件 | `105` 个 `.mjs`、`1` 个 `.cjs` | 共享副本、Claude 接缝和可安装制品 |

当前 `core/` 通过 `tools/sync-core.mjs`复制到两个插件目录。这个机制已经保证 shared-core parity，但存在三个长期问题：

- 手写源码没有编译期类型边界，身份、Schema 数据、host profile 和领域 record 主要依赖运行时检查与约定；
- host-specific JavaScript 仍直接维护在可发布插件目录中，源码和制品的物理职责没有完全分开；
- 大量测试同时读取 `core/`、两个生成副本和源码文本，机械一致性与领域行为混在同一测试层。

两个插件目录不能简单改为临时、不提交的 build output：Codex 通过仓库内 `plugins/codex-wakeflow/` 稀疏安装，Claude marketplace 也把 `plugins/claude-code-wakeflow/` 作为插件源。因此目标必须是“**提交生成制品，但不手写生成制品**”。

### 2.2 当前测试基线

对顶层 `test/*.test.mjs` 的静态统计与实跑基线如下：

| 指标 | 2026-08-24 基线 |
| --- | ---: |
| 顶层测试文件 | `116` |
| 测试代码行 | `89,694` |
| 显式 `test(...)` 调用 | `1,624` |
| 文本中包含 `core/` 路径的测试文件 | `100` |
| 涉及 Codex 制品 | `61` |
| 涉及 Claude Code 制品 | `59` |
| 同时涉及两份制品 | `50` |
| 直接调用 `spawn/exec/fork` 家族的测试文件 | `40` |
| `node --test --test-reporter=dot test/*.test.mjs` 实耗时 | `386.01s` |

文件、行数和调用数以仓库当前 `test/*.test.mjs` glob 为口径；`test/` 内 `173` 个 `.mjs` 的总数另包含历史 origin 中冻结的脚本 fixture。路径与进程指标是静态检索信号，不等于 `100` 或 `40` 个文件都应合并或删除。

这些数字只说明当前反馈成本，不直接判定具体测试是否应该删除。尤其是并发、锁、TOCTOU、崩溃恢复、原子写入、权限隔离和宿主 effect 测试，执行慢可能源于真实语义，不能仅按耗时裁剪。

当前仓库级 `npm test` 还会串行执行 shared-core check、双宿主 validator 和双宿主 smoke，因此日常完整反馈时间高于上述 `386.01s` 测试基线。轻量化必须改变证据结构，而不是只换一个更快的 test runner。

<a id="ts-confirmed-direction"></a>
## 3. 已确认方向

以下方向已经确认，后续实施文档不得重新退回“继续手写 JS”的方案：

1. Wakeflow 的手写 Node.js 代码彻底转为 TypeScript。
2. TypeScript 是唯一代码源码；生成的 `.mjs` / `.cjs` 不是第二套源码。
3. Codex 与 Claude Code 继续各自拥有一份完整、可直接安装的 JavaScript 插件制品。
4. 当前完整 v3 需求是转换基线，不因测试减量而缩减产品合同。
5. 不把现有测试一对一翻译成 TypeScript；转换期间同时重建轻量测试职责。
6. 优先采用成熟、标准、可独立验证的工具链，不自研 TypeScript 编译器、Schema 类型生成器、test runner 或 bundler。
7. `AlembicWorkspace` 不参与开发或验证；真实初始化验证只使用用户指定的可丢弃 `WakeWorkspace`。

<a id="ts-goals"></a>
## 4. 目标

1. 形成清晰的 `shared core → host adapter → generated artifact` 单向依赖。
2. 让错误的身份类型、可选字段、host capability、Schema record 和未处理 `unknown` 尽可能在编译期失败。
3. 保持当前 Node 20 运行时、ESM 主体和 MCP `.cjs` 入口的物理兼容性。
4. 由一个确定性构建入口一次生成两份插件制品，并能只读检查工作树是否与生成结果一致。
5. 将 JSON Schema 继续保留为跨宿主、跨语言的 portable wire contract，同时自动派生 TypeScript 结构类型，并为有真实运行时 consumer 的边界生成 Ajv standalone validator。
6. 把 shared behavior 只测试一次，把 Codex / Claude 差异收敛到参数化 host contract 和少量 host-only 测试。
7. 让日常反馈环适合每次修改运行，把完整 packaging、双 smoke、migration fixture 和真实 workspace 验证留在相应集成门。
8. 删除依赖旧 API、旧源码布局、旧 alias、已退役 normal fallback 或重复生成副本的测试，但必须先证明对应不变量已有新的证据 owner。
9. 在切换完成后，仓库中不存在需要人工同步的生产 JavaScript。

<a id="ts-non-goals"></a>
## 5. 非目标

- 不借 TS 转换重新设计已经确认的 v3 产品功能、authority 或状态机。
- 不借类型建设提前实施尚处于 G1-G3 的全局基础服务候选。
- 不把所有纯函数强制改成 class，也不创建万能 `WakeflowManager`、service locator 或全局 workspace registry。
- 不把 JSON Schema 重写为某个 TypeScript validation DSL；外部 wire contract 仍以 JSON Schema 为权威。
- 不默认打包整个项目，不通过 bundling 隐藏领域依赖或宿主边界。
- 不要求 Markdown、JSON、JSONL、SVG、模板资源或必要的 shell launcher 改写成 TypeScript。
- 不重写用于迁移来源证明的历史 JavaScript fixture；它们属于冻结证据，不属于当前生产源码。
- 不用测试文件数或断言数作为质量 KPI，也不为达到数字目标合并语义不同的测试。
- 不把 release consistency、真实 host session 或 `WakeWorkspace` 验收伪装成普通单元测试。

<a id="ts-source-authority"></a>
## 6. 目标源码权威与目录职责

### 6.1 目标结构

以下结构是后续实施文档应展开的基线；具体文件迁移清单必须在开发前由真实 import graph 核验：

```text
core/                              # host-neutral TypeScript 与共享静态合同
  **/*.mts                         # ESM 共享源码
  mcp/server.cts                   # 唯一需要 CJS 输出的共享入口
  schemas/**/*.schema.json         # portable wire contract 权威

hosts/
  codex/                           # Codex-only TS、profile、手写静态资产与 overlay 清单
  claude-code/                     # Claude-only TS、profile、手写静态资产与 overlay 清单

tools/                             # TypeScript 构建、校验、发布维护源码
test/                              # TypeScript 测试、builder 与当前 fixture

.build/                            # ignored 临时编译与装配目录
plugins/
  codex-wakeflow/                  # committed generated artifact
  claude-code-wakeflow/            # committed generated artifact
```

目标结构中的职责是：

- `core/` 只拥有共享协议、领域实现和 host port，不包含 Codex / Claude 值判断或开发期假 profile；
- `hosts/<host>/` 是宿主特有可执行源码、入口 Skill/memory/command 等手写静态资产及 overlay 清单的唯一权威，不能继续把可编辑 host source 放进 `plugins/`；
- `plugins/<host>/` 只包含生成的 JavaScript、Schema、Skills、commands、模板、manifest 和宿主静态资源；
- `.build/` 可随时删除，绝不成为发布输入权威；
- 当前根 `AGENTS.md` 中“`core/` + `sync-core`”规则在正式 cutover 前继续有效，只有新构建链验收并原子切换后才能同步更新。

### 6.2 “彻底 TypeScript”的精确定义

转换完成后：

- 所有人工维护的 Node.js runtime、CLI、MCP、build、validate、smoke helper 和测试均使用 `.mts` 或 `.cts`；
- `.mts` 确定性生成 `.mjs`，`.cts` 确定性生成 `.cjs`；
- 源码 import 使用 Node 运行时可识别的显式 `.mjs` / `.cjs` specifier，由 TypeScript 解析回对应源文件；
- 生产运行不依赖 `ts-node`、`tsx`、TypeScript loader 或本机源码目录；
- 除冻结 fixture 和明确登记的第三方原样资源外，源码区新增 `.mjs` / `.cjs` 必须失败；
- 生成文件头或制品 manifest 必须能指出生成入口，但不得包含本机绝对路径、线程标识或私有环境信息。

<a id="ts-d9-refinement"></a>
### 6.3 对 D9 物理源码位置的定向细化

[D9 source ownership](./wakeflow-initialization-generated-files-requirement-2026-08-05.md#req-d09-source-ownership)确认的三层模型继续成立：共享语义只有一个 canonical source，宿主接缝拥有真实 Codex / Claude 差异，installed artifact 是只读运输物。

D9 当时的目标结构仍把 controller/target/governance 入口和 host profile/adapter 的**可编辑宿主源码**放在 `plugins/<host>/`。本文为了实现“整个插件目录均可重建”，只对这一项物理位置做后续细化：

```text
D9 当时：plugins/<host>/host-specific source + generated shared copies
本文目标：hosts/<host>/host-specific TypeScript source
          plugins/<host>/fully generated install artifact
```

该细化不把两个宿主合并，也不把 host values 放入 `core/`。它只是让 `plugins/<host>/` 从“部分源码、部分生成物”收敛为单一职责的生成制品。本文确认并实施后，必须同步回写 D9 的目标目录示意、根 `AGENTS.md` 和开发规则；原子切换前仍按 D9 与当前仓库规则维护现状。

<a id="ts-toolchain"></a>
## 7. TypeScript 工具链与代码规则

### 7.1 成熟工具链基线

| 职责 | 目标方案 | 不采用的默认方案 |
| --- | --- | --- |
| 编译与类型检查 | 官方 `typescript` / `tsc` | 自研 transpiler、Babel-only 转译 |
| 多子项目构建 | TypeScript project references + `tsc -b` | 手工按目录拼接编译命令 |
| Schema runtime validator | 现有 Ajv 8 的 standalone code generation | 在生产制品中重复解释全部 Schema |
| Schema → TS 结构类型 | 成熟生成器 + Wakeflow 薄 `$id` catalog resolver | 手写第二份 interface、Wakeflow 自研生成器 |
| 测试执行 | Node 20 内置 `node:test`，执行已编译测试 | 为换语法默认引入新的 test framework |
| 制品装配 | 编译后的 TypeScript build tool | shell copy pipeline、运行时 TS loader |

依赖版本必须精确锁定在 lockfile 中。`@types/node` 必须与 Wakeflow 的最低受支持 Node 20 主版本匹配，不跟随开发机上更高 Node 主版本漂移。正式实施前应重新核验当时稳定的 TypeScript 与 Schema 生成器版本，并用小型 spike 证明 `.mts` / `.cts`、URN `$ref`、Ajv standalone 和双 package layout 均可工作。

工程选择以官方说明为核验入口：[TypeScript Node module modes](https://www.typescriptlang.org/tsconfig/module.html)、[Project References / build mode](https://www.typescriptlang.org/docs/handbook/project-references)、[`erasableSyntaxOnly`](https://www.typescriptlang.org/tsconfig/erasableSyntaxOnly.html)与[Ajv standalone code](https://ajv.js.org/standalone.html)。文档链接是工具行为依据，不替代 Wakeflow 自己的需求与实跑证据。

### 7.2 TypeScript project references

至少分离以下编译边界：

1. `core`：共享领域与协议，只能依赖 Node 标准库和明确批准的 shared dependencies；
2. `hosts-codex`、`hosts-claude`：依赖 `core` 公开 port，不允许反向依赖；
3. `tools`：构建和仓库维护代码，不进入生产 artifact runtime；
4. `test`：依赖公开源码合同、host adapter contract 和测试 builder，不成为生产依赖。

根构建使用 `tsc -b --stopOnBuildErrors`。每个被其他项目引用的项目必须启用 `composite` 和 `declaration`，其 `.d.ts` 与 `.tsbuildinfo` 只写入 `.build/`。任一项目类型检查失败时，不得继续装配或覆盖已提交插件制品。

### 7.3 编译规则

目标 `tsconfig` 至少开启：

```json
{
  "compilerOptions": {
    "module": "Node20",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "useUnknownInCatchVariables": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "noEmitOnError": true
  }
}
```

`Node20` 模式随文件扩展名和最近 `package.json` 的 `type` 决定 ESM / CommonJS emit，并带入对应的现代 Node resolution 行为；正式 spike 必须用 `tsc --showConfig` 固化最终有效配置。不得为了通过编译退回 extensionless import、隐式 CommonJS interop 或 bundler-only resolution。

代码默认禁止：

- `any`、`@ts-ignore` 和无说明的双重类型断言；
- TypeScript `enum`、`namespace`、decorator 和 parameter property；
- 把外部 JSON、文件、MCP 参数或 host 返回值直接断言成领域类型；
- 用宽泛 `string` 代替已经有稳定语义的 ID、digest、ref、operation 或状态集合；
- 通过 barrel export 隐藏跨领域依赖或形成循环引用。

确有第三方 interop 需要例外时，只能在最窄 adapter 边界使用，必须附原因、运行时验证和 focused test，不能把不安全类型扩散到领域层。

### 7.4 类型与实现风格

- 外部输入先是 `unknown`，经过 Schema 或显式 parser 后才能进入领域类型。
- `workspaceId`、`windowId`、`demandId`、`podId`、digest 和 artifact ref 等稳定标识使用 branded type 或等价 opaque type，阻止相同底层字符串误传。
- 状态 record 与公共输入默认 `readonly`；需要更新时返回新值或进入明确 mutation owner。
- 纯解析、排序、摘要、映射、状态归约和判定继续使用纯函数。
- 只有确实拥有资源、事务、生命周期、可替换 adapter 或一组稳定依赖的对象才使用 class。
- class 不得成为第二状态权威；磁盘 authority、journal、lease 和 evidence 的所有权仍以当前 v3 合同为准。
- host-neutral 层只依赖 port/interface；Codex / Claude 的 locator、activation、send、close 和 evidence 语义由各自 adapter 实现。

这与[全局基础服务候选](./wakeflow-foundation-services-requirement-2026-08-11.md#foundation-candidate-register)的关系是：TS 可以表达已经确认的边界，但不自动证明某个重复 helper 应下沉。基础服务仍需独立完成 G1 语义交叉审查。

<a id="ts-schema-codegen"></a>
## 8. Schema、类型与 validator 单向生成

### 8.1 权威关系

当前 `core/` 有 `61` 个 JSON Schema。它们继续作为文件、MCP、transport 和宿主之间的 portable wire contract。目标生成关系固定为：

```text
JSON Schema 2020-12
  ├─> generated TypeScript structural types
  ├─> build-time complete validator catalog
  ├─> runtime-reachable Ajv standalone validators
  └─> copied JSON Schema in both plugin artifacts
```

全部 Schema 都必须进入 build-time catalog、完成引用解析并可被 Ajv 编译。只有已经登记真实 runtime consumer 的 wire boundary 才把 standalone validator 装入插件；纯文档、历史 fixture、release contract 或只在构建期使用的 Schema 不因“全量生成”自动增加生产代码。领域行为类型可以在 TypeScript 中手写，但不得手写一份与 wire Schema 字段重复且需要人工同步的结构接口。生成类型只表达结构；跨字段语义、plain-object/prototype 限制、authority、冻结语义、稳定错误码和状态转换仍由领域 owner 负责。

### 8.2 Wakeflow Schema catalog

现有 Schema 使用 `urn:wakeflow:*` `$id` 与跨文件 URN `$ref`。本轮预研中，直接把单个 Schema 交给成熟 Schema-to-TypeScript CLI 无法解析内部 URN；仓库当前约有 `52` 个 Wakeflow URN `$id` 和 `25` 处跨文件 URN `$ref`。

因此需要一个很薄的 Wakeflow Schema catalog：

1. 扫描全部 Schema，建立 `$id → repository-relative path` 唯一映射；
2. 对 duplicate `$id`、未知 `$ref`、越界路径和循环装载 fail closed；
3. 把完整 catalog 交给成熟类型生成器与 Ajv，而不是自己实现 Schema 语义；
4. 生成来源、目标文件和 digest manifest，供 build check 使用。

catalog 是构建解析层，不是运行时 registry，也不能演变成第二配置或 Schema authority。

预研把当前全部 Schema 直接交给 Ajv standalone 时，产生约 `3.38 MB` 的未优化生成代码，并报告 `322` 项 strict 诊断（`173 strictTypes`、`148 strictRequired`、`1 strictTuple`）。这证明“所有 Schema 可编译”和“所有 validator 都应发布”是两件事：前者是强制构建门，后者必须由真实 runtime consumer 与制品闭包决定。

### 8.3 生成验收

- 全部 `$id` 和 `$ref` 可解析；
- 相同输入两次生成 byte-for-byte 一致；
- Ajv strict warning 必须在切换前逐项修正或形成有边界的兼容说明，不能静默忽略；
- 生成类型和 validator 不可人工修改；
- 每个 Schema 明确标记为 `runtime` 或 `build-only`；`runtime` 必须指向真实 consumer，`build-only` 不进入生产 validator bundle；
- 生产制品不需要 TypeScript 或 Schema type generator；
- validator 的稳定错误映射仍由当前领域/公共工具 owner 负责，不直接向外泄漏 Ajv 内部对象；
- Schema 行为变更必须同时有正向、负向和 producer/consumer focused test，不能只依赖生成成功。

<a id="ts-dual-artifact"></a>
## 9. 双宿主制品构建

### 9.1 构建数据流

目标构建按以下顺序执行：

```text
typecheck all projects
  → compile shared core once
  → compile Codex and Claude adapters
  → generate Schema types, complete build-time catalog and runtime-reachable validators
  → assemble Codex artifact from closed manifest
  → assemble Claude artifact from closed manifest
  → run artifact validators
  → compare generated output with committed plugins/*
```

共享 core 只能编译一次，然后被两个 artifact 装配消费；不能为了生成两份插件而分别运行两套会产生差异的 shared 编译。

### 9.2 闭合装配清单

每个宿主都需要显式、可审查的 artifact manifest，至少声明：

- shared compiled files；
- host-specific compiled files；
- 全部 portable Schema 与 runtime-reachable generated validators；
- Skills、commands、模板和静态资源；
- package、plugin manifest 与 marketplace 相关输入；
- 允许的重命名，例如 `server.cts → server.cjs`；
- 该宿主禁止出现的另一宿主文件。

装配必须使用 closed allowlist。源目录中多出的未知文件不能被“顺手复制”，制品目录中不再由 manifest 生成的旧文件必须在临时装配结果中缺失，并由 diff 明确暴露。

### 9.3 原子生成与只读检查

- `build` 先写入独立临时目录，所有 compile/codegen/validate 通过后再更新目标制品；
- `build:check` 在临时目录重建并与已提交 artifact 比较，不修改工作树；
- 生成失败不得留下半份 Codex 或半份 Claude 制品；
- artifact diff 必须能区分 shared change、host overlay change、Schema 生成变化和静态资产变化；
- 插件目录不得包含 `.ts`、`.mts`、`.cts`、测试源码、构建缓存、绝对 source path 或未登记文件；
- `tools/sync-core.mjs` 在原子切换后退役，由新的双制品 build/check 替代；退役前当前 `sync:core` / `check:core` 规则继续有效。

### 9.4 构建工具自身

构建编排也必须用 TypeScript 手写。允许的启动链是先用 `tsc` 编译 `tools/`，再由 Node 执行 `.build/tools/...mjs`；不保留一份人工维护的 JavaScript bootstrap，也不要求安装宿主在运行期加载 TypeScript。

默认不对全部 Wakeflow runtime bundling。若某个生成 validator 或极小 leaf tool 需要把 build-time library 结果内联，必须保持错误定位、license 和 artifact validator 可审查；source map 若生成，只能留在 `.build/` 或经过路径净化后显式进入 manifest，不得泄漏本机源码路径。bundling 不能借机把 host adapter 与 shared core 打成不可分辨的单文件。

Ajv 的“standalone”表示 Schema 编译发生在 build time，并不天然保证生成文件零运行时依赖；官方生成结果通常仍引用 Ajv runtime helper。实施 spike 必须在“声明精确的 Ajv runtime dependency”和“只 bundle generated validator leaf”之间做实证选择，不能仅凭 standalone 名称宣称插件已自包含。

<a id="ts-lightweight-tests"></a>
## 10. 轻量测试体系

### 10.1 轻量化的定义

“轻量”不是少写断言，而是减少重复执行、重复 fixture、重复进程和对私有实现的绑定：

> 一个不变量只在最低、最稳定、最接近其 owner 的层被完整证明；上层只证明接线和本层独有差异。

测试规模不以文件数或断言数验收。验收关注：同一失败是否被多层重复模拟、日常反馈是否足够快、需求不变量是否有唯一可定位的证据 owner，以及改实现细节时是否会触发无关大面积测试重写。

### 10.2 五个证据层

| 层 | 负责证明 | 不再负责 |
| --- | --- | --- |
| 编译与静态规则 | import/export、类型可赋值性、可选字段、穷尽分支、源码/制品禁区 | 领域运行时行为 |
| Schema/codegen | `$id/$ref`闭合、wire shape、validator生成、确定性 | authority、状态转换、host effect |
| Shared core tests | 领域不变量、状态转换、并发、恢复、redaction、原子写入 | 再对两份插件复制执行相同行为矩阵 |
| Host adapter contract | 两宿主对同一 port 的共同合同及各自真实差异 | shared core 内部算法 |
| Artifact/integration | manifest、入口可加载、31-tool public surface、关键端到端接线、packaging | 重跑全部 core edge cases |

迁移 fixture 与 `WakeWorkspace` 不被塞进每次日常测试：前者属于支持窗口和 migration gate，后者属于明确的真实工作区验收。

### 10.3 现有测试的处置规则

转换前必须给每个现有顶层测试文件登记需求锚点和以下一种处置，不允许无说明删除：

- `keep-core`：保留为共享领域行为测试并转为 TS；
- `merge-contract`：Codex / Claude 重复合同合并成一个参数化 adapter suite；
- `replace-by-compiler`：import/export、类型 shape、非法组合由 typecheck 或 type fixture 证明；
- `replace-by-codegen`：shared copy parity、Schema/type/validator 一致性由生成 manifest 和 build check 证明；
- `keep-host-only`：只保留真实宿主差异；
- `keep-integration`：只保留最小可安装制品路径和端到端接线；
- `keep-migration-fixture`：仅保留 D40 明确支持的 origin 与不可恢复失败证据；
- `delete-retired`：旧 alias、旧 normal fallback、已删除路径、源码文本布局或不可达历史行为。

“由编译器/生成器替代”必须指向具体失败门，不能只写“TS 已覆盖”。“删除退役测试”必须指向已确认退役需求或 migration support boundary，不能由开发者单方面判断产品行为过时。

### 10.4 必须保留的高价值行为证据

下列内容不能因为测试慢或实现改为 TS 而降级：

- stable ID、typed ref、digest 与错误 workspace/window/demand 交叉使用；
- state authority、event append、projection 重建和 evidence authority 分离；
- lock、lease、TOCTOU、并发写入和 owner mismatch；
- 原子写入、事务 journal、崩溃恢复、idempotent rerun 和 preserved evidence；
- transport producer/consumer、target result、receipt 和 retention；
- Pod intent/state/receipt、host binding 与 Test access；
- secret/private handle redaction、tracked/ignored 边界和绝对路径泄漏；
- Codex / Claude send、close、activation、locator、coverage unknown 和 manual-host-gate 差异；
- D40 supported legacy origin 的 classifier、preview、apply、rollback/recovery 与 provenance；
- 两份可安装插件的 manifest、入口、31-tool surface 和发布文件闭包。

这些测试应尽量在其领域 owner 层使用内存或临时目录执行。只有真实依赖 Node process boundary、signal、lock contention、MCP stdio 或 package loading 的场景才启动子进程。

### 10.5 测试代码组织

- 测试也用 TypeScript 手写并由 `tsc` 编译，Node 只运行生成的测试 JavaScript。
- 建立少量 typed fixture builder，默认生成最小合法 record；测试只覆盖与当前不变量相关的字段。
- 状态和宿主共同合同使用 table-driven suite，避免复制两份几乎相同的文件。
- golden/snapshot 只用于稳定、可审查的小型 canonical output；大型目录树使用 manifest/digest 和精确关键字段断言。
- source-text 检查只保留无法由 compiler、linter 或 artifact manifest 表达的仓库规则。
- 不把测试 helper 变成拥有业务默认值的第二套领域工厂；合法默认值必须来自真实 builder 或明确的测试 fixture contract。
- focused test 失败应直接显示需求 identity、输入差异和稳定错误码，避免只能从巨型 snapshot 判断。

### 10.6 日常、集成与发布门

切换后的 npm scripts 至少区分：

| 门 | 内容 | 使用时机 |
| --- | --- | --- |
| focused | 当前 owner 的 typecheck + exact test files | 编辑过程中反复运行 |
| fast check | 全量 typecheck、Schema/build determinism、shared core、双 host contract | 每个正常代码切片完成前 |
| repository test | fast check、双 artifact validator、双 smoke、migration/current integration | 声明仓库候选完成前 |
| workspace acceptance | 在可丢弃 `WakeWorkspace` fresh initialize、删除后重建、reconfigure/reconcile | 初始化/维护行为切换阶段 |
| release integrity | package/version/tag/remote/clean-tree 等现有 release check | 仅另行授权的发布流程 |

日常 `fast check` 必须只包含能够稳定、高频运行的编译、生成确定性、shared core 与双 host contract，不把双 smoke、完整 migration fixture、重复 `npm pack` 或真实 workspace 操作塞回日常环。实施时应在同一开发机记录切换前后实耗时，证明它确实适合每个正常代码切片运行；不以任意秒数取代证据范围判断，也不允许通过跳过 shared core、任一 host contract 或 Schema/build check 制造“快速”。

仓库级门仍须覆盖当前完整需求，但必须通过去重比当前 `386.01s` 的 Node 测试基线显著缩短；开发实施文档在完成逐文件处置登记后记录预计收益和剩余真实慢路径，不在本需求中用任意 test 数量、秒数或统一超时掩盖真实慢测试。

当前根 `AGENTS.md` 要求 release-ready 前运行 `npm test`。在 TS 构建正式切换前，现有 `npm test` 命令和验证职责保持不变；新脚本只有在文档、CI/规则和两个 artifact 同步原子更新后才成为新权威。

<a id="ts-current-requirement-coverage"></a>
## 11. 当前完整需求如何进入新测试体系

TS 转换不得把“大量现有测试”当作需求本身。需求权威仍在 D1-D41 和当前实施完成证据中，测试只提供可执行证明。后续测试处置至少覆盖以下入口：

| 当前合同域 | 需求入口 | 新证据 owner |
| --- | --- | --- |
| config、identity、layout | [D13](./wakeflow-initialization-generated-files-requirement-2026-08-05.md#req-d13-config-v3)、[D14](./wakeflow-initialization-generated-files-requirement-2026-08-05.md#req-d14-local-layout)、[D20](./wakeflow-initialization-generated-files-requirement-2026-08-05.md#req-d20-local-stable-ids) | Schema/codegen + core domain |
| active、demand、ledger | [D35-D37](./wakeflow-initialization-generated-files-requirement-2026-08-05.md#req-d35-active-global)、[D5/D15](./wakeflow-initialization-generated-files-requirement-2026-08-05.md#req-d05-ledger) | core state/authority tests |
| transport、window runtime | [D17](./wakeflow-initialization-generated-files-requirement-2026-08-05.md#req-d17-transport-retention)、[D21](./wakeflow-initialization-generated-files-requirement-2026-08-05.md#req-d21-transport-contract)、[D22](./wakeflow-initialization-generated-files-requirement-2026-08-05.md#req-d22-window-identity-runtime) | core contract + host adapter |
| Pod 与宿主操作 | [D23](./wakeflow-initialization-generated-files-requirement-2026-08-05.md#req-d23-claude-window-host)、[D24-D28](./wakeflow-initialization-generated-files-requirement-2026-08-05.md#req-d24-pod-model)、[D29-D31](./wakeflow-initialization-generated-files-requirement-2026-08-05.md#req-d29-keep-live)、[I3](./wakeflow-initialization-generated-files-requirement-2026-08-05.md#req-i3-confirmed) | core Pod + per-host contract |
| maintenance、observability | [D10](./wakeflow-initialization-generated-files-requirement-2026-08-05.md#req-d10-reset-reconcile)、[D12](./wakeflow-initialization-generated-files-requirement-2026-08-05.md#req-d12-observability)、[D34](./wakeflow-initialization-generated-files-requirement-2026-08-05.md#req-d34-local-lifecycle) | core transaction + minimal artifact integration |
| 全局 producer/consumer | [D38](./wakeflow-initialization-generated-files-requirement-2026-08-05.md#req-d38-producer-consumer) | typed ports + owner tests + artifact smoke |
| migration 与 legacy 退役 | [D39/D40](./wakeflow-initialization-generated-files-requirement-2026-08-05.md#req-d40-origin-fixtures)、[D19](./wakeflow-initialization-generated-files-requirement-2026-08-05.md#req-d19-legacy-retirement) | bounded migration fixture gate |
| 开发与真实环境 | [D41](./wakeflow-initialization-generated-files-requirement-2026-08-05.md#req-d41-dev-boundaries) | repository self-test + `WakeWorkspace` acceptance |

如果现有测试行为与这些需求锚点冲突，以已确认需求和当前实现完成记录为判断入口；不得因为旧测试存在而复活已退役行为，也不得因为 TS 类型更方便而弱化运行时外部输入校验。

<a id="ts-cutover"></a>
## 12. 转换与切换原则

### 12.1 不长期维护双源码

开发可以按领域切片转换，但每个已接受切片必须同时完成：

1. JavaScript 源迁移为 TypeScript；
2. import/consumer 转向唯一 TS 源；
3. 制品由构建链生成；
4. 对应测试完成 keep/merge/replace/delete 处置；
5. 旧手写 JavaScript 从源码权威中移除；
6. focused 和当前阶段门通过。

不得为了“兼容迁移”长期保留 JS wrapper、TS wrapper 和两套测试。确有阶段性 bootstrap 时，必须在同一开发计划中有明确删除任务，且不进入最终源码闭包。

### 12.2 功能变化隔离

TS 转换暴露出的真实 bug 可以修复，但必须满足当前 review 一贯边界：

- 先证明与当前需求/代码事实冲突；
- 小型局部 bug 可在对应切片修复并增加 focused test；
- 涉及 authority、公共 API、host seam、迁移支持或多个领域 consumer 的变化，必须返回需求讨论，不能伪装成“类型修复”；
- 基础服务抽取仍按 G1-G4 单独推进，不与机械转换混成不可 review 的大改。

### 12.3 建议实施波次

后续开发文档应至少拆为以下波次，并为每波先做真实代码核验：

1. **T0 基线与处置登记**：冻结 import graph、Schema catalog、artifact file manifest、测试需求归属和当前耗时。
2. **T1 编译/生成骨架**：建立 project references、工具编译、Schema resolver、临时 artifact assembler 和只读 diff；尚不替换正式制品。
3. **T2 shared core 转换**：按低层 primitive → domain owner → orchestration 转为 TS，保持 host port 清晰。
4. **T3 host source 转换**：把两个插件目录内的手写宿主代码移到 `hosts/`，运行参数化 adapter contract。
5. **T4 测试职责重建**：与 T2/T3 同步转换高价值测试，删除已被 compiler/codegen/build check 替代的重复证据。
6. **T5 双制品原子切换**：用新 build 生成两个 plugin，退役 `sync-core` 和全部手写 production JS。
7. **T6 仓库与真实环境验收**：双 validate、双 smoke、完整 requirement gate、packaging 检查和 `WakeWorkspace` 重建验证。

这些波次是顺序边界，不是授权。正式实施文档必须把每个波次细化为文件级 producer/consumer、测试处置和退出证据。

<a id="ts-environment-boundary"></a>
## 13. 环境与安全边界

- Wakeflow 源码只在当前 Wakeflow 仓库修改。
- `AlembicWorkspace` 继续完全退出开发输入以及写入、初始化、迁移、删除和验证执行范围；不得修改其内容，也不依赖其当前状态完成本需求。
- 真实功能验证只使用用户明确指定的可丢弃 `WakeWorkspace`；允许反复删除 Wakeflow 配置并重新初始化。
- 仓库自动测试必须使用临时目录或 self-contained fixture，不硬编码 `WakeWorkspace` 绝对路径。
- fixture、生成 manifest、错误输出和文档不得写入真实 thread/session ID、token、socket、PID、用户名或机器私有绝对路径。
- build/check 不得修改插件缓存；缓存刷新、真实宿主加载和发布是独立授权动作。
- 提交生成制品是未来源码策略的一部分，但本文不授权 commit。

<a id="ts-acceptance"></a>
## 14. 最终验收标准

### 14.1 源码闭包

- 全部手写 Node.js 生产、工具和测试代码为 `.mts` / `.cts`；
- 源码范围没有未登记的手写 `.mjs` / `.cjs`；
- 冻结 migration fixture 与静态第三方资源有精确 allowlist；
- shared core 不包含 ad hoc host 判断，host code 不再手写在 `plugins/`；
- `tsc -b --stopOnBuildErrors` 在 clean checkout 通过，无未批准 `any` / ignore escape。

### 14.2 Schema 与制品

- `61` 个现有 Schema 及后续新增 Schema 全部进入唯一 catalog，`$id/$ref` 闭合；
- 类型与完整 build-time validator catalog 可重复生成，生成目录无人工修改；
- 只有标记为 `runtime` 且能指向真实 consumer 的 standalone validator 进入插件，`build-only` Schema 不产生发布代码；
- 两份 artifact 从同一 shared compile 与各自 closed overlay 生成；
- 连续两次生成无 diff，`build:check` 对陈旧、额外和人工修改制品均 fail closed；
- Codex / Claude validators、smoke、31-tool public surface 和 package file closure 全部通过；
- 安装后的插件不依赖 TypeScript、源码目录或开发依赖。

### 14.3 行为与测试

- D1-D41 当前完整合同均有明确且唯一的主要证据 owner；
- 每个原顶层测试文件都有 keep/merge/replace/delete 处置和需求锚点；
- 删除测试前已有 compiler、Schema、core、host 或 artifact 层的替代证据；
- 高价值并发、恢复、authority、redaction、host fence 和 migration 测试没有因轻量化丢失；
- shared behavior 不再分别对 `core/`、Codex copy 和 Claude copy 执行完整行为矩阵；
- `fast check` 的内容边界符合 §10.6，并有同机切换前后实测记录证明可作为每个正常代码切片的高频反馈；
- repository test 相对 `386.01s` 的旧 Node 测试基线有明确、可复核的缩短，同时双 validator、双 smoke 和当前 requirement coverage 仍为绿色；
- `WakeWorkspace` fresh initialize、删除配置后重建、reconfigure/reconcile 和 immediate rerun 验收通过。

### 14.4 文档与规则原子切换

- 根 `AGENTS.md`、README、package scripts、validator 说明和发布文档统一指向 TS 源与新 artifact build；
- 当前 `sync-core` 规则与工具在同一切换中退役，不留下相互矛盾的生成入口；
- 基础服务需求文档只登记真实 TS 转换发现，不把未确认抽象写成已实现；
- `git diff --check` 与最终仓库门通过；任何未运行的真实 host session 明确报告，不能由 smoke 冒充。

<a id="ts-decisions"></a>
## 15. 决定状态

### 15.1 已确认

- `TSD-01`：彻底使用 TypeScript 手写 Wakeflow Node.js 代码。
- `TSD-02`：Codex / Claude Code 两份 JavaScript 插件继续作为 committed generated artifacts。
- `TSD-03`：当前完整 v3 需求是行为基线，不做缩减版 TS 重写。
- `TSD-04`：测试在转换时同步轻量化，不做现有测试一对一搬运。
- `TSD-05`：JSON Schema 保留 portable contract 权威，类型和 validator 由其生成。
- `TSD-06`：日常证据与集成/发布证据分层，但 release-ready 仍需完整仓库门。
- `TSD-07`：`AlembicWorkspace` 排除，`WakeWorkspace` 是指定的可丢弃真实验证环境。
- `TSD-08`：D9 的共享/宿主/制品三层语义不变，但宿主可执行源码从 `plugins/<host>/` 移到 `hosts/<host>/`，使两个插件目录成为完整生成制品。

### 15.2 开发文档前必须用 spike 固化

- 选定并精确锁定 TypeScript、`@types/node` 和 Schema-to-TypeScript generator 版本；
- 核验 `Node20` module 配置与 `.mts` / `.cts` import/output 细节；
- 冻结 `hosts/` 内代码、profile、静态 overlay 和 manifest 的最终目录；
- 生成全部 Schema 后处置 Ajv strict warning，证明无合同漂移；
- 完成 116 个顶层测试文件的需求归属与处置登记，并据此记录新测试结构、预期去重收益和相对旧基线的实测结果；
- 证明临时装配、双 artifact 原子更新和 committed diff 在当前 Git 工作流中可审查。

这些项目是对具体工具行为的实证固化，不重新开放本文件已经确认的 TS 单一源码、双制品和轻量测试方向。

<a id="ts-foundation-relation"></a>
## 16. 与全局基础服务需求的关系

TS 构建与轻量测试体系是 Wakeflow 后续基础服务实施的工程底座，但两者不能混为一个无边界重构：

1. 本文先统一代码语言、模块边界、生成权威和测试证据结构。
2. [基础服务需求](./wakeflow-foundation-services-requirement-2026-08-11.md#foundation-admission)继续决定哪些能力应下沉、扩展、复用或保留在领域内。
3. TS 转换过程中发现的重复，只登记事实；除非已有 G2 决定，不直接抽成公共 service。
4. 已确认基础服务未来实施时，直接使用本文建立的 typed port、project reference、fixture builder 和 fast check，不再新增另一套构建/测试框架。
5. 若某个基础服务拆分是让领域模块可安全类型化的硬前置，必须单独说明因果、consumer 和最小边界，并由用户确认实施顺序。

因此推荐顺序是：先确认并实施本文件的构建/类型/测试底座，再按独立 G2/G3 方案推进基础服务迁移；可以在同一长期开发周期连续执行，但不能把两个需求的设计决定混在同一个不可审查提交中。

<a id="ts-completion"></a>
## 17. 本需求讨论完成定义

本需求进入 `confirmed` 前，应由用户确认：

1. “彻底 TS”是否接受本文对非代码资源和冻结 fixture 的例外定义；
2. 两份插件目录继续提交生成产物，而不是安装时临时编译；
3. JSON Schema 继续作为 wire contract 权威；
4. TS 底座与基础服务 G2/G3 分开设计、连续实施的顺序；
5. 下一步新建独立开发实施文档，而不是直接批量改写源码。

确认后，开发实施文档必须逐波次写清：真实代码核验、文件级 source/consumer、构建输入输出、测试处置、focused 命令、阶段门、失败恢复和 `WakeWorkspace` 验收。本文保持需求权威，不承担进度流水账。

<a id="ts-change-log"></a>
## 18. 更新记录

- 2026-08-24：建立首版需求；记录当前 JS/双制品/测试基线，确认 TypeScript 单一手写源码、JSON Schema 单向生成、双宿主 committed artifact 和按证据 owner 轻量化测试的目标结构。
