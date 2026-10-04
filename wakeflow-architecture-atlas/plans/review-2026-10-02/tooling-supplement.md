# 构建、Schema、测试与发布工具补审

2026-10-02，9 个手写 TypeScript、4,666 行，全部完成逐文件语义阅读。[逐文件记录](./tooling-supplement-files.json) 含当前SHA、真实分支/副作用、直接工具消费者和测试关联。此补审只读源码，没有执行构建、测试、smoke或release门。

### 给制品架构图的真实主链

| 阶段 | 真实 producer / consumer | 要显示的约束 |
| --- | --- | --- |
| Schema目录 | `tooling/codegen/schema-types.ts`：loadSchemaCatalog → generateSchemaModule | 严格JSON无重复键、唯一$id、外部ref只准目录闭包；Ajv2020 strict验证；不联网解析。 |
| 生成合同 | 同文件 generateOnce / buildSchemaTypes | JSON Schema → `.generated.ts`；四类特殊词汇/正则有专用生成，其余json-schema-to-typescript；runtime schema由JSON.parse恢复并递归冻结。 |
| 漂移检查 | 同文件 checkSchemaTypes | `.build`下独立生成两遍、摘要/数量/ref边一致后再比committed generated；不能把自动生成TS当手写语义审阅重复计数。 |
| 编译 | `package.json` 的 build:artifacts / build:check scripts | 先 `tsc -b tooling/tsconfig.json src/entrypoints/tsconfig.json`，再从 `.build/src` 启动制品装配；构建器本身不编译TS。 |
| JS运行时闭包 | `tooling/artifacts/build-plugin-artifacts.ts`：candidateClosure → compiledModuleClosure | 每宿主 MCP入口与共享hook入口分别展开静态/字面动态import；拒非字面动态import；只接受编译JS。 |
| 宿主隔离 | 同文件 assertSharedClosure / compiledFileScope | hook闭包不许任何hosts模块；MCP只准对端两份纯身份/资源profile，其余对端执行模块拒绝。 |
| 构建时宿主数据 | 同文件 importCompiledHostModule / hooksJsonBytes / mcpConfigurationBytes / agentTextFiles | hook片段、MCP启动配置、九占位符值表由宿主模块提供；它们是构建时输入，不都进入运行时闭包。 |
| 出厂文本 | assets/agent-text → 两个host render | 未登记占位符/无消费者值/遗留占位符拒绝；Claude包含commands，Codex跳过commands；语言依文件后缀。 |
| npm依赖 | `tooling/artifacts/plugin-dependency-closure.ts`：resolveRuntimeDependencyClosure → collectVendoredFiles | 按lock v3取dependencies、peerDependencies与已锁optional；实际安装版本必须相等；拒dev/link/nested；不靠宿主npm install。 |
| payload与manifest | build文件 assembleCandidate | lib、两launcher、hooks/MCP/插件/package元数据、文本、LICENSE、brand与vendored node_modules；每文件路径/字节/sha/mode/scope列入manifest。 |
| 输出替换 | build文件 replaceOutputAtomically | 全部host在stage装完后输出改名到backup、stage改名为输出；rename失败尽力恢复backup，成功后删除backup。输出只能plugins或.build严格后代。 |
| committed校验 | `tooling/artifacts/check-plugin-artifacts.ts`：verifyArtifactAgainstManifest → checkWakeflowPluginArtifacts | 先核自身文件集合/字节/模式，再与新候选manifest字节相等；两marketplace条目结构一致。 |

Schema build 的输出替换与制品输出替换不同：Schema generateOnce 是先删除旧output再rename stage，没有制品那样的backup恢复路径。图不能把两者合写成同一个“原子回滚”保证。两种开发工具也都不等于Foundation业务持久事务的fsync承诺。

### 验证与发布不是同一条完成证明

`package.json` 的 npm test 串行门为 typecheck → architecture → lint → format:check → knip → 当前TypeScript tests → schema:check → build:check。smoke:artifacts 独立于 npm test。smoke:candidate 的 `.manual.ts` 故意不被 `.test.ts` 枚举器收集。

`tooling/testing/run-typescript-tests.ts` 的 compiledTypeScriptTests 从当前源 `.test.ts` 映射 `.build/tests/*.js`，从不glob编译输出；已删除源的旧输出不会“补充”测试覆盖。排程只是提示：未知耗时先跑，其余按耗时降序；文件worker默认取availableParallelism；晚变更加入 `tooling/testing/run-typescript-tests.ts#resolveTestConcurrency`，允许通过WAKEFLOW_TEST_CONCURRENCY降低这一预算。未设置或空字符串使用默认值，显式值只能是1到可用并行度之间的规范十进制安全整数；不改变选中文件、每个测试内部并发或超时。非法并发值和非法耗时表均失败，而不是静默略过测试。

`tooling/architecture/check-dependencies.ts` 除架构规则外还要求SWC、非零模块/依赖数、零warning/error/violation，以及无src消费者的生产根与显式allowlist精确一致。动态加载的host文本/配置等必须在这个例外边界被承认；“只有测试引用”不能自动算运行时主线。

`tooling/artifacts/smoke-plugin-artifacts.ts` 将每宿主完整制品复制到仓库外临时目录，创建一次性Git工作区，经真实官方stdio Client检查catalog、fresh preview/apply、reconcile no-op、status/verify、pod create preview以及真实Node hook launcher落地；最后清理tmp。它不依赖登录账户，也没有创建真实Codex线程或Claude会话，所以不能代替真实宿主端到端。

`tooling/release/check-release-consistency.ts` 检查唯一版本输入与五源一致、Node精确范围、releaseEligible、payload全Git跟踪；root release:check脚本显式要求main、clean、匹配tag在HEAD、本地origin/main在HEAD。该工具不fetch，因此最后一项是本地远端跟踪引用事实。库函数的这些Git门是选项，不能用缺省库调用冒充完整root release:check。

**releaseEligible 的实际含义很窄：版本主号 >= 1。** 构建器写true并不意味着测试、smoke、Git、tag、push或发布成功，制品身份也不包含发布流程完成证明。

### 人工核对的测试证据

- `tests/codegen/schema-types.test.ts#buildSchemaTypes`、`tests/codegen/schema-types.test.ts#checkSchemaTypes`：输出集合、词汇/正则/runtime schema、无机器路径、双次生成及committed漂移。
- `tests/artifacts/plugin-artifacts.test.ts#buildWakeflowPluginArtifacts`：双次构建一致、精确文件清单/模式/元数据/依赖；另有repo外stdio与hook launcher检查。
- `tests/artifacts/plugin-artifact-check.test.ts#verifyArtifactAgainstManifest`：人为修改字节、额外文件、缺文件分别拒绝，恢复后再次通过。
- `tests/artifacts/plugin-dependency-closure.test.ts#resolveRuntimeDependencyClosure`：展开deps/peer并拒dev/link/版本漂移等；`collectVendoredFiles`核对裁剪规则。
- `tests/tooling/testing/run-typescript-tests.test.ts#compiledTypeScriptTests`：focused有效源、重复/越界/symlink拒绝、旧compiled文件不执行；新增 `tests/tooling/testing/run-typescript-tests.test.ts#resolveTestConcurrency` 核对缺省/空值、1与4、零/负数/小数/指数/空白/超预算/非安全数拒绝，以及非法maximum。
- `tests/release/check-release-consistency.test.ts#checkWakeflowReleaseConsistency`：全部Git门正例以及版本/Node/manifest/main/clean/tag/local-origin独立反例。
- `tests/artifacts/plugin-artifact-smoke.manual.ts#smokeWakeflowPluginArtifacts`：人工触发的candidate smoke完整返回断言。

这些是源码与断言核对，不是本补审运行结果。测试关联数组中的其他锚点仍仅是直接import索引，主协调者统一记录实际执行验证。

### 晚变更复核：文件并发预算

本轮结束前源码独立新增 resolveTestConcurrency。已全文复读runner并对照新增测试：run仍先用compiledTypeScriptTests选定同一组文件，再将环境覆盖准入为 --test-concurrency；唯一行为变化是允许减少并发文件worker。maximum的合法性先于缺省分支校验，覆盖值不会自动截断或钳制，非法即抛错。两张图的静态import/Schema生成连线无需变化，验证说明及指纹已同步。

需要追加的最小执行验证是 focused 运行 `tests/tooling/testing/run-typescript-tests.test.ts` 与 `tests/tooling/testing/test-schedule-order.test.ts`，同时保留既有源清单、旧输出拒绝及排程集合不变断言。本补审没有启动全量测试。若要专门验证环境到子进程argv的命令行接线，可用WAKEFLOW_TEST_CONCURRENCY=1再运行同一focused集合；现新增单元测试直接验证纯函数，未拦截spawn argv。
