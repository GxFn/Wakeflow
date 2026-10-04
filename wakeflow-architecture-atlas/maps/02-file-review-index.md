---
diagramId: "ts-file-review-index"
viewType: "evidence"
truthKind: "in-progress-worktree"
reviewDepth: "L5"
verifiedAt: "2026-10-03"
baselineCommit: "d8fafff33919c728e3a9b91ec04aa50ec5e07f0c"
audience: ["maintainer","reviewer"]
documentationOwner: "Wakeflow Architecture Atlas"
generatedBy: "mixed"
testEvidence: "anchored"
reviewSnapshot: "plans/review-2026-10-03-rc4"
sourcePaths: ["src/**/*.ts","tooling/**/*.ts"]
schemaPaths: ["src/contracts/schemas/**/*.json"]
testPaths: ["tests/**/*.ts"]
refreshTriggers: ["wakeflow-architecture-atlas/plans/review-2026-10-02/foundation-contracts-tooling-files.json","wakeflow-architecture-atlas/plans/review-2026-10-02/workspace-hosts-files.json","wakeflow-architecture-atlas/plans/review-2026-10-02/demand-delivery-files.json","wakeflow-architecture-atlas/plans/review-2026-10-02/coordination-evidence-files.json","wakeflow-architecture-atlas/plans/review-2026-10-02/event-core-supplement-files.json","wakeflow-architecture-atlas/plans/review-2026-10-02/result-delivery-supplement-files.json","wakeflow-architecture-atlas/plans/review-2026-10-02/tooling-supplement-files.json","wakeflow-architecture-atlas/plans/review-2026-10-03/foundation-contracts-tooling-files.json","wakeflow-architecture-atlas/plans/review-2026-10-03/hosts-workspace-files.json","wakeflow-architecture-atlas/plans/review-2026-10-03/demand-delivery-files.json","wakeflow-architecture-atlas/plans/review-2026-10-03/coordination-files.json","wakeflow-architecture-atlas/plans/review-2026-10-03-rc4/privacy-evidence-files.json","wakeflow-architecture-atlas/plans/review-2026-10-03-rc4/callback-files.json","wakeflow-architecture-atlas/plans/review-2026-10-03-rc4/concurrency-files.json","wakeflow-architecture-atlas/plans/review-2026-10-03/review-coverage.json","wakeflow-architecture-atlas/plans/review-2026-10-02/review-coverage.json","wakeflow-architecture-atlas/plans/review-2026-10-03-rc4/source-baseline.json","wakeflow-architecture-atlas/plans/review-2026-10-03-rc4/source-baseline-final.json","wakeflow-architecture-atlas/plans/review-2026-10-03-rc4/review-coverage.json","wakeflow-architecture-atlas/plans/review-2026-10-03-rc4/refresh-review-coverage.mjs","assets/release/version.json"]
sourceFingerprint: "sha256:4938a647f683d5875f355dd5c3aa9e1a565b661da5e1c71d2ce975fba53c0f9f"
---

# 逐文件审阅索引：370个手写文件与当前来源闭合

2026-10-03 工作树，当前版本输入 **1.1.0-rc.5**：**360个运行时手写文件＋10个工具文件＝370个唯一路径**。其中 **7个变更文件本轮完整语义重审，363个文件按相同字节继承rc.3实际选中的历史记录**。继承沿coverage引用递归核对原ledger路径、条目号与SHA，不是本轮再次全文审阅的声明。

本轮目录保留起始rc.4名称，最终快照记录rc.5真实版本输入。起始5个手写变更，修复期间又改变2个消费者：`src/capabilities/requirement/service.ts` 与 `src/capabilities/result-review/decide.ts`，均有本轮记录。额外交叉深读用于核实边界，不重复计入7个完整重审或全量库存。

每行职责与首项分支摘自人工台账；完整分支、效果、消费者和断言范围由原记录拥有。记录号是JSON数组从1开始的位置，代号只用于查阅来源；历史台账和修复前后证据保持原样，不以AST或文件同名生成审阅结论。

[覆盖与SHA报告](../plans/review-2026-10-03-rc4/review-coverage.json) · [可重跑汇总脚本](../plans/review-2026-10-03-rc4/refresh-review-coverage.mjs) · [静态导入库存](../plans/review-2026-10-03-rc4/import-graph.json)。

## 范围与证据层次

| 对象 | 当前数量 | 本页证明的范围 | 不主张 |
| --- | ---: | --- | --- |
| 手写运行时TypeScript | 360 | 每条当前SHA与唯一semantic记录相符 | 每个分支都已执行测试 |
| 手写工具TypeScript | 10 | 同上；单独保留构建/测试工具副作用 | 库存或构建等于发布成功 |
| 本轮完整语义复核 | 7 | 7个旧文件变化与0个新增文件有当前记录 | 仅刷指纹即复核 |
| 字节未变继承 | 363 | 当前文件、选中覆盖和原台账的SHA一致 | 本轮重新逐行审阅全部继承文件 |
| 生成TypeScript / JSON Schema | 95 / 95 | 路径、SHA与一一配对 | 全部生成文件或Schema逐行语义审查 |
| tests内TypeScript | 297 | tests/fixture/support库存及既有记录关联 | 所有测试文件全部逐行审查或真实宿主验证 |

## 测试定位与继承边界

当前复验1106条带符号的测试关联，582条仅文件关联；281个测试/fixture/support文件被台账关联。12条明确未覆盖或间接覆盖说明原样保留。所有实际符号锚点当前存在，失效锚点为0。

其中34条关联是“源码继承、测试本轮已变”；另有219条沿用前轮已标记的断言不可继承限制，二者可以重叠。合计248条关联只重新确认定位，不继承未复核的断言或执行成功。测试本轮字节未变，也不能清除前轮留下的断言限制。AST符号存在只证明可定位；执行结果由统一验证记录另列。

## 台账来源

| 代号 | 原记录数 | 本次选用数 | 复核日期与范围 | 原始记录 |
| --- | ---: | ---: | --- | --- |
| FC02 | 70 | 68 | 2026-10-02 · 基础能力与手写合同 | [foundation-contracts-tooling-files.json](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| WH02 | 122 | 102 | 2026-10-02 · 配置、工作区、宿主与入口 | [workspace-hosts-files.json](../plans/review-2026-10-02/workspace-hosts-files.json) |
| DD02 | 44 | 32 | 2026-10-02 · Demand与任务投递评审主线 | [demand-delivery-files.json](../plans/review-2026-10-02/demand-delivery-files.json) |
| CE02 | 81 | 62 | 2026-10-02 · 协调、需求、证据与观察 | [coordination-evidence-files.json](../plans/review-2026-10-02/coordination-evidence-files.json) |
| EC02 | 25 | 23 | 2026-10-02 · 事件核心与聚合模型补审 | [event-core-supplement-files.json](../plans/review-2026-10-02/event-core-supplement-files.json) |
| RD02 | 12 | 12 | 2026-10-02 · 投递结果合同补审 | [result-delivery-supplement-files.json](../plans/review-2026-10-02/result-delivery-supplement-files.json) |
| TL02 | 9 | 9 | 2026-10-02 · 工具链补审 | [tooling-supplement-files.json](../plans/review-2026-10-02/tooling-supplement-files.json) |
| FC03 | 5 | 4 | 2026-10-03 · 基础边界、当前配置协议与工具 | [foundation-contracts-tooling-files.json](../plans/review-2026-10-03/foundation-contracts-tooling-files.json) |
| WH03 | 23 | 23 | 2026-10-03 · 工作区、宿主、入口与文本 | [hosts-workspace-files.json](../plans/review-2026-10-03/hosts-workspace-files.json) |
| DD03 | 13 | 12 | 2026-10-03 · Demand、任务、投递与评审 | [demand-delivery-files.json](../plans/review-2026-10-03/demand-delivery-files.json) |
| CE03 | 17 | 16 | 2026-10-03 · Kernel、协调与观察 | [coordination-files.json](../plans/review-2026-10-03/coordination-files.json) |
| PR05 | 4 | 4 | 2026-10-03 · 隐私分类、需求消费者与证据准入 | [privacy-evidence-files.json](../plans/review-2026-10-03-rc4/privacy-evidence-files.json) |
| CB05 | 2 | 2 | 2026-10-03 · 回调提示与提交身份消费者 | [callback-files.json](../plans/review-2026-10-03-rc4/callback-files.json) |
| RW05 | 1 | 1 | 2026-10-03 · 并发准入、观察竞争与许可交接 | [concurrency-files.json](../plans/review-2026-10-03-rc4/concurrency-files.json) |

历史2轮覆盖及其原始台账保持原样；本轮逐路径优先使用7条当前记录，其余363条追溯到真实选中记录，最长继承2级coverage引用。覆盖检查无重复、缺项、越界、非semantic或摘要漂移。Schema生成门仍由 `tooling/codegen/schema-types.ts` 拥有，本汇总不执行或替代 `schema:check`。

## Foundation：物理与通用原语

### src/foundation/artifact（4）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `loaded-artifact-tree-identity.ts` | 可加载树的可移植内容身份；稳定树读取后拒symlink/特殊节点；文件清单排序、路径碰撞与总量核验；执行位布尔进入manifest；JCS摘要 | 字节未变继承 | [FC02 · 8](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `loaded-artifact-tree-transfer-candidate.ts` | 可恢复的加载树复制；前后复验源artifactDigest；候选已存在先闭合检查；仅补缺目录/文件；完成检查候选 | 字节未变继承 | [FC02 · 9](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `loaded-artifact-tree-transfer-plan.ts` | 可加载树到候选的迁移计划；manifest复验→mode语义→directoryPlan/copies→artifactDigest/planDigest；重建验证每项对应关系 | 字节未变继承 | [FC02 · 10](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `loaded-artifact-tree-transfer-publication.ts` | 加载树候选发布与幂等最终读回；目的已存在且候选残留则拒绝；无残留且最终树匹配返回current；否则验证候选并同设备发布 | 字节未变继承 | [FC02 · 11](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |

### src/foundation/crypto（3）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `canonical-json-sha256.ts` | 规范JSON字节与摘要组合；先JCS与UTF8，再hash，不附换行或领域前缀 | 字节未变继承 | [FC02 · 12](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `sha256-hasher.ts` | 增量hash生命周期；active→finalized或failed；溢出/底层失败禁止复用；结果含精确字节数 | 字节未变继承 | [FC02 · 13](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `sha256.ts` | 精确字节视图SHA256与词法准入；仅Uint8Array，拒绝隐式字符串编码，严格小写64hex | 字节未变继承 | [FC02 · 14](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |

### src/foundation/data（4）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `canonical-json.ts` | JCS规范JSON；被动JSON准入→检查继承toJSON→canonicalize→UTF8；统一失败映射 | 字节未变继承 | [FC02 · 15](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `deterministic-json-document.ts` | 精确pretty JSON文档；两空格与终止换行；parse后重渲染要求字节文本一致，拒绝其他表示 | 字节未变继承 | [FC02 · 16](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `json-value.ts` | 递归冻结被动JSON；深度128、循环、非有限数、负零、孤立代理项拒绝；序列化环境检查继承toJSON | 字节未变继承 | [FC02 · 17](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `passive-own-data.ts` | 无行为自有属性读取；Proxy先拒绝；拒绝访问器、symbol、稀疏数组与额外属性；pick只读取选中键 | 字节未变继承 | [FC02 · 18](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |

### src/foundation/event-sourcing（1）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `event-sourcing-version-evolution.ts` | 逐版本内存演进注册表；版本codec唯一，必须逐版本+1且链完整；每步输入输出重新JSON准入与codec校验 | 字节未变继承 | [FC02 · 19](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |

### src/foundation/filesystem（37）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `absolute-directory-materialization.ts` | 绝对路径到受根约束目录创建；present必须规范拼写；missing必须非文件系统根的安全祖先；完成后重读身份 | 字节未变继承 | [FC02 · 20](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `absolute-directory-placement.ts` | 绝对目录放置观察；逐祖先lstat拒symlink/非目录；present与missing区分，记录最近真实祖先与规范拼写 | 字节未变继承 | [FC02 · 21](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `bounded-directory-tree-scan.ts` | 有界目录树节点扫描；DFS全局条目与深度预算；子目录用父次观察expectedNode；symlink叶只记录不跟随 | 字节未变继承 | [FC02 · 22](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `deterministic-json-file.ts` | 稳定严格文本到精确JSON；stable read→strict text→pretty格式重渲染等值；保持source节点和hash | 字节未变继承 | [FC02 · 23](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `directory-tree-candidate-inspection.ts` | 闭合计划的完整或部分候选检查；未知节点、额外文件、错mode、多硬链接、hash漂移拒绝；只有缺项可incomplete；部分恢复还比较原字节 | 字节未变继承 | [FC02 · 24](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `directory-tree-candidate-plan.ts` | 目录候选闭合计划；排序唯一文件→推导父目录→大小写/文件目录冲突检查→容量→treeDigest；解析重建全部派生值 | 字节未变继承 | [FC02 · 25](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `durable-atomic-file-stage-address.ts` | 可恢复暂存地址及owner观察；操作/目标摘要/输入摘要/模式/PID/thread/token自描述；跨线程或进程权限不明为unknown | 字节未变继承 | [FC02 · 26](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `durable-atomic-file-stage-io.ts` | 独占暂存创建、准备与精确清理；O_EXCL创建最多4次；write精确循环→chmod→sync→逐字节复验；busy历史扫描可继续新建，未知stage阻断 | 字节未变继承 | [FC02 · 27](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `durable-atomic-file-stage-recovery.ts` | 声明目标内的stage恢复；active/unknown保留；inactive单链接退役、双链接先验证目标摘要并补fsync；ForTargets拒其他目标，MatchingTargets忽略安全外部stage | 字节未变继承 | [FC02 · 28](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `durable-atomic-file-target-io.ts` | 目标父目录与期望版本复验；replace重读node、size、digest；提交后核验链接数、身份、权限和精确字节 | 字节未变继承 | [FC02 · 29](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `durable-atomic-file-write-contract.ts` | 原子文件写入合同；mode闭集、expected精确四字段、64MiB上限；输入字节复制并拒SharedArrayBuffer | 字节未变继承 | [FC02 · 30](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `durable-atomic-file-write.ts` | 新建与替换的分阶段持久发布；create以link拒覆盖，replace以rename替换；提交前检查signal，提交后继续校验与fsync；未提交清自有stage，已提交不回滚 | 字节未变继承 | [FC02 · 31](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `durable-directory-materialization.ts` | 逐段目录持久物化；非递归独占mkdir→0700临时模式→目标mode→节点与父目录同步；已存在仅观察，EEXIST复验后可复用 | 字节未变继承 | [FC02 · 32](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `durable-directory-tree-candidate-retirement.ts` | 封闭候选的精确退休与续做；完整入口先证明完整；恢复入口允许已缺失；先捕获剩余成员，再倒序unlink文件、深度优先rmdir目录和根 | 字节未变继承 | [FC02 · 33](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `durable-directory-tree-candidate.ts` | 目录候选创建与补齐；新建根→目录→文件→全树复验；settle先证明现有成员字节一致，只补缺项 | 字节未变继承 | [FC02 · 34](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `durable-directory-tree-publication.ts` | 完整候选的同设备目录发布；发布前重验plan/root→rename→发布后无取消复验最终树；失败分source/destination/cross-device/uncertain | 字节未变继承 | [FC02 · 35](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `durable-file-candidate.ts` | 显式候选文件创建；O_EXCL不覆盖；内存字节副本≤64MiB；逐字节复验；content-only仅省父目录同步；失败精确清理 | 字节未变继承 | [FC02 · 36](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `durable-file-copy-candidate-contract.ts` | 跨根复制候选的输入合同；期望size/hash必填，node可选；mode、maximumBytes、signal严格准入 | 字节未变继承 | [FC02 · 37](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `durable-file-copy-candidate.ts` | 有界流式复制至独占候选；源no-follow→512KiB分块复制/hash→EOF→源快照复验→候选重读hash/mode/sync；失败仅删除自身精确候选 | 字节未变继承 | [FC02 · 38](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `durable-regular-file-link.ts` | 不覆盖的普通文件硬链接；同设备、源精确快照、目标缺失；提交后linkCount+1及双路径同inode；同步后再证实 | 字节未变继承 | [FC02 · 39](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `durable-regular-file-settlement.ts` | 补足既有普通文件耐久性；预期节点不变→同步文件→同步父目录→全快照复验；取消仅同步前 | 字节未变继承 | [FC02 · 40](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `durable-resource-rename.ts` | 同设备文件/目录重命名；拒同路径/目录放入自身；目标两次缺失观察→rename→源缺失与目的身份复验；ctime允许变化 | 字节未变继承 | [FC02 · 41](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `exact-regular-file-unlink.ts` | 预期节点的精确unlink与结算；先固定源句柄与全快照；unlink后linkCount减1；absent与replacement-allowed分开，允许后继锁但不能是旧inode | 字节未变继承 | [FC02 · 42](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `file-byte-range.ts` | 安全文件字节范围；offset/length非负安全整数；endExclusive加法前防溢出 | 字节未变继承 | [FC02 · 43](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `file-node-snapshot.ts` | 物理节点快照；区分dev+ino身份与包含模式/大小/mtime/ctime的全快照；严格重准入 | 字节未变继承 | [FC02 · 44](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `portable-resource-path.ts` | 根相对可移植路径；原文必须well-formed NFC且满足Schema；不规范化非法输入 | 字节未变继承 | [FC02 · 45](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `private-mode-convergence.ts` | 私有节点安全权限漂移收敛；当前模式直接current；仅同owner、保留owner权限、无组外写且无特殊位可chmod至0700/0600；unsafe阻断 | 字节未变继承 | [FC02 · 46](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `rooted-directory.ts` | 真实目录作用域；根realpath与句柄身份复验；祖先拒绝symlink；文件叶全快照，目录叶比较身份 | 字节未变继承 | [FC02 · 47](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `rooted-exact-resource-handle.ts` | 精确预期节点句柄；要求冻结expectedNode；no-follow打开；全快照用于路径复验、身份用于打开句柄观察 | 字节未变继承 | [FC02 · 48](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `rooted-exclusive-file-lock.ts` | 签发当前v2独占文件锁与幂等lease，稳定观察owner并显式退休残留；严格v2字段；ownerBirth/registryId/token | 字节未变继承 | [FC03 · 1](../plans/review-2026-10-03/foundation-contracts-tooling-files.json) |
| `rooted-read-write-scope.ts` | 在私有准入目录以短 latch 协调共享许可登记、独占关闭与 reader 排空；只拥有物理许可，不解释领域恢复意图；mode/operation 与 options 被动输入检查；获取预算默认 30000 毫秒，合法 1..300000，signal 和 beforeEnter 拒绝代理对象 | 本轮语义复核 | [RW05 · 1](../plans/review-2026-10-03-rc4/concurrency-files.json) |
| `rooted-resource-parent-handle.ts` | 固定父目录句柄；打开前后身份比较；inspectTarget返回叶快照/null；sync前后重新复验父目录 | 字节未变继承 | [FC02 · 50](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `stable-directory-read.ts` | 稳定目录整读与分页；两轮枚举+页内lstat+句柄与路径全快照；最多8并发；分页保留page+lookahead且调用者连续页钉住expectedNode | 字节未变继承 | [FC02 · 51](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `stable-file-read.ts` | 稳定有界文件读取；初始路径→no-follow句柄→分块hash→EOF增长探针→句柄与路径全快照复验；取消和close失败分类 | 字节未变继承 | [FC02 · 52](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `stable-resource-tree-read.ts` | 前后全树复验的内容观察；扫描→总量预算→最多8并发文件digest→再次扫描对比全部节点；普通文件以外的叶保留在entries | 字节未变继承 | [FC02 · 53](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `strict-text-file.ts` | 稳定文件上的严格文本合同；fatalUTF8、无BOM、LF-only、恰一个末尾换行、非空、NFC | 字节未变继承 | [FC02 · 54](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `whole-file-content-transition.ts` | 整文件受管内容转换计划；absent→create、等desired→current、属于最多8个admittedCurrent→replace，其他拒绝 | 字节未变继承 | [FC02 · 55](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |

### src/foundation/git（3）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `git-ignore-candidate-observation.ts` | 隔离候选.gitignore语义验证；2MiB输入预算；临时worktree写候选，复用真实仓库Git语义；最后确认临时根身份再清理 | 字节未变继承 | [FC02 · 56](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `git-ignore-observation.ts` | 真实Git ignore语义观察；清除GIT_环境并禁全局/系统exclude；shell:false；NUL四元组、路径顺序、退出码全核对；5秒/1MiB等预算 | 字节未变继承 | [FC02 · 57](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `git-object-id.ts` | 带算法标签的完整Git对象ID；Schema准入sha1或sha256，比较前复验；不做对象存在性与commit类型验证 | 字节未变继承 | [FC02 · 58](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |

### src/foundation/identity（1）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `uuid-v4.ts` | 随机、解析与确定性UUID格式；随机源一次调用并复验；派生拼接拒绝NUL后hash、设置版本和variant位 | 字节未变继承 | [FC02 · 59](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |

### src/foundation/node（2）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `node-system-error.ts` | 安全提取Node系统错误码；拒绝Proxy、非Error、继承/accessor code及ERR_；失败返回undefined | 字节未变继承 | [FC02 · 60](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `process-instance.ts` | 读取进程存活和OS出生证据，为锁owner提供保守身份判断；kill(pid,0)的ESRCH确定inactive，其他错误保留unknown | 字节未变继承 | [FC03 · 3](../plans/review-2026-10-03/foundation-contracts-tooling-files.json) |

### src/foundation/numeric（1）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `byte-count.ts` | 非负安全整数字节数；bigint范围检查后转换，加法前检验溢出 | 字节未变继承 | [FC02 · 61](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |

### src/foundation/resource（1）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `resource-processing-contract.ts` | 资源角色、变更配方与恢复策略合同；八类角色各有闭集；目录容器不继承子孙授权；recipe固定顺序且非空，admit再次验证角色策略 | 字节未变继承 | [FC02 · 62](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |

### src/foundation/schema（1）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `runtime-json-schema.ts` | 严格延迟编译JSON Schema；封闭依赖ID、strict Ajv2020、首次验证才编译；uniqueItems按被动JSON比较 | 字节未变继承 | [FC02 · 63](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |

### src/foundation/text（2）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `markdown-json-string-literal.ts` | Markdown内联JSON数据字面量；要求well-formed NFC；转义反引号、表格、HTML和双向控制字符 | 字节未变继承 | [FC02 · 64](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `utf8.ts` | 严格UTF8字节与文本边界；fatal解码且保留BOM；编码拒绝孤立代理项；视图偏移不丢失 | 字节未变继承 | [FC02 · 65](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |

### src/foundation/time（5）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `monotonic-clock.ts` | 进程内单调时钟；一次读取非负bigint；单次读数不证明跨次递增 | 字节未变继承 | [FC02 · 66](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `monotonic-deadline.ts` | 单调截止时间；到期包含等号；剩余时间下限0；不额外读取时间 | 字节未变继承 | [FC02 · 67](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `monotonic-duration.ts` | 单调纳秒时长；逆序拒绝；非负整数毫秒无损转换 | 字节未变继承 | [FC02 · 68](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `utc-instant.ts` | UTC文本与纳秒比较；词法+真实公历复验；保留原始0至9位小数表示 | 字节未变继承 | [FC02 · 69](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `wall-clock.ts` | 可持久化UTC当前时间；注入一次并复验；允许系统回拨，不制造单调性 | 字节未变继承 | [FC02 · 70](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |

## Contracts：手写合同与词汇

### src/contracts/identity（1）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `wakeflow-durable-id.ts` | 持久身份的kind与UUID品牌；未知kind、多个分隔符、非法UUID和kind不匹配分别拒绝；不验证实体存在 | 字节未变继承 | [FC02 · 1](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |

### src/contracts/vocabulary（6）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `evidence-kinds.ts` | 七类证据闭集；字符串集成员准入；引用型与复制字节型语义由消费者处理 | 字节未变继承 | [FC02 · 2](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `requirement-sections.ts` | 四类需求的章节、别名和摘要词汇；NFKC、小写、空白折叠；不识别返回null；验收标准已进入确认摘要 | 字节未变继承 | [FC02 · 3](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `test-step-vocabulary.ts` | 逐步判定、失败分类和责任词汇；可重跑仅harness-defect、flaky、missing-evidence；其他出口由治理层决定 | 字节未变继承 | [FC02 · 4](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `wakeflow-config-identity.ts` | 配置身份三元组的单一共享常量；urn:wakeflow:config:v2 | 字节未变继承 | [FC03 · 4](../plans/review-2026-10-03/foundation-contracts-tooling-files.json) |
| `wakeflow-error-code.ts` | 公共失败类别闭集；保留并发、幂等、恢复、边界等独立错误码，细节使用reason/path | 字节未变继承 | [FC02 · 6](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |
| `wakeflow-host-id.ts` | 两个宿主标识；codex与claude-code闭集，无动态别名 | 字节未变继承 | [FC02 · 7](../plans/review-2026-10-02/foundation-contracts-tooling-files.json) |

## Kernel：公共调用与工作区协调

### src/kernel（22）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `active-projection.ts` | 活动布局与人读页面渲染发布；current/missing/stale/unsafe分类；任一unsafe零写；锁内render/CAS；完整活动集合才退休标记页面；inactive锁恢复 | 字节未变继承 | [CE02 · 60](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `append-command.ts` | 追加型外壳稳定身份与修订准入；所有追加统一 scope shared；幂等键及非负安全整数修订在领域上下文前准入 | 字节未变继承 | [CE03 · 3](../plans/review-2026-10-03/coordination-files.json) |
| `command-shell.ts` | 公共请求与结果边界，按切片范围包住上下文生命周期；请求 JSON、容量、Schema、去 root 摘要先处理；打开 rooted 根后做形状 admit 与私有值扫描 | 字节未变继承 | [CE03 · 2](../plans/review-2026-10-03/coordination-files.json) |
| `error.ts` | 封闭公开错误字段与原始cause隔离；短reason/结构path/details准入；failWithBlockers截取8项并清理自由文本；陌生错误unexpected | 字节未变继承 | [CE02 · 63](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `hook-observation-directory.ts` | hook平铺及日期分片目录访问；2048项分页稳定快照；只进入合法UTC日/两位前缀0700目录；sinceDay/recordId剪枝 | 字节未变继承 | [CE02 · 65](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `hook-observations.ts` | 私有hook事实的确定性写入和完整读取；旧平铺重试原地；持久v1严格解析后规范事实比较，旧可选artifactManifestDigest缺省null；新日期/前缀分片；query limit显式complete；扫描8项一批；created后4096检查预算按龄修剪 | 字节未变继承 | [CE02 · 66](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `ids.ts` | 命名空间与输入派生稳定typed ID；幂等键1至128字符；commit身份只从Demand+幂等键派生 | 字节未变继承 | [CE02 · 67](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `layout.ts` | 工作区与宿主私有运行时、板项、生命周期日志、投影路径；统一导出 operation-admission、maintenance.lock、maintenance/transactions 三个协调位置 | 字节未变继承 | [CE03 · 5](../plans/review-2026-10-03/coordination-files.json) |
| `limits.ts` | 公共请求结果与prompt分页容量；请求2MiB、结果24MiB、prompt65536字符、列表256项；越界分别capacity/output-boundary | 字节未变继承 | [CE02 · 69](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `markdown-sections.ts` | H2切章与顶层列表解析；忽略围栏；高级标题结束、低级归正文；顶层列表生成ordinal；续行并入 | 字节未变继承 | [CE02 · 70](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `next-projection.ts` | 路由事实到下一责任建议；terminal/无frontier归none；awaiting-decision归user；blocked不建议tool；未知前沿默认controller | 字节未变继承 | [CE02 · 71](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `pod-mutation-lock.ts` | 按pod隔离短变更临界区；仅退休已证明inactive锁；10秒等待；aborted与可重试并发冲突分类 | 字节未变继承 | [CE02 · 72](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `pod-worktree-receipts.ts` | 执行检出的 Git 结构准入及宿主私有回执存取；parseGitWorktreePorcelain 限 64Ki 字符/256 条；entry 拒绝 branch+detached、非 bare 缺 HEAD 等 | 字节未变继承 | [CE03 · 6](../plans/review-2026-10-03/coordination-files.json) |
| `privacy-scan.ts` | 共享词法隐私扫描：凭证类别、绝对路径和UUID候选、CSI去装饰视图、原文位置与opaque标记。；分别采集private-key、供应商凭证、assignment、Authorization和URL-userinfo；后3类归入credential-assignment，不依赖路径白名单。 | 本轮语义复核 | [PR05 · 1](../plans/review-2026-10-03-rc4/privacy-evidence-files.json) |
| `prompt-digest.ts` | 投递与hook共用prompt摘要；trim后空或超过65536字符返回null，否则UTF8 SHA256 | 字节未变继承 | [CE02 · 75](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `publication-transaction.ts` | preview/apply/recover 三形状计划与范围编排；preview 强制 read；apply/recover 使用 owner 声明的 mutationScope shared/exclusive/maintenance | 字节未变继承 | [CE03 · 4](../plans/review-2026-10-03/coordination-files.json) |
| `redaction.ts` | 公共JSON私有值边界；字符串和值/键递归扫描；短于2字符不纳入；错误path清洗 | 字节未变继承 | [CE02 · 77](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `requirement-acceptance.ts` | 发布规划完成共用验收语法；首个已知验收H2的顶层列表形成ac-1等；段落表格或缺节为空 | 字节未变继承 | [CE02 · 78](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `requirement-board.ts` | 需求认领状态与人读索引；pending/parked/claimed/withdrawn/archived转移；revision+previousDigest；每需求锁内重读CAS；索引争用4轮 | 字节未变继承 | [CE02 · 79](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `tool-registry.ts` | 公共工具目录结构准入；名字/executor/schema stem唯一、形状注解一致；公开目录省略resultSchema | 字节未变继承 | [CE02 · 80](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `work-claims.ts` | 窗口排他工作声明与围栏；同digest重放current；不同holder冲突；精确释放；IfHeld缺失/易主不否定已提交事件；generation1..4 | 字节未变继承 | [CE02 · 81](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `workspace-operation-scope.ts` | 工作区跨进程读写准入和同调用链借用能力；普通 writer 要求 WakeflowConfig/schemaVersion 当前协议以及既有 operation-admission 目录；旧协议返回 writer-protocol-unsupported，无静默迁移 | 字节未变继承 | [CE03 · 1](../plans/review-2026-10-03/coordination-files.json) |

### src/kernel/event-stream（1）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `stream-index.ts` | 事件身份与类型索引检查点；连续提交摘要/修订/ID准入；byType与events精确一致；坏或旧索引回退；同序号不可替换 | 字节未变继承 | [CE02 · 64](../plans/review-2026-10-02/coordination-evidence-files.json) |

## Configuration：配置权威

### src/configuration（10）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `wakeflow-config-authority-publication.ts` | 仅限首次创建Config权威；目标存在拒绝 | 字节未变继承 | [WH02 · 2](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-config-authority-replacement-contract.ts` | 替换与恢复共享的目标、精确源预期和错误合同；程序身份不可变 | 字节未变继承 | [WH02 · 3](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-config-authority-replacement-recovery.ts` | 非活动配置锁残留的显式恢复；目标或expected仍成立 | 字节未变继承 | [WH02 · 4](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-config-authority-replacement.ts` | 配置短锁内精确替换；已为目标则current | 字节未变继承 | [WH02 · 5](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-config-authority-snapshot.ts` | 读取稳定规范配置字节并组合位置、索引和摘要；0644单链接当前用户 | 字节未变继承 | [WH02 · 6](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-config-document.ts` | 唯一确定性配置字段顺序和文本表示；role/root与support ownership分支 | 字节未变继承 | [WH02 · 7](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-config-resource-catalog.ts` | 配置文件与配置短锁的静态资源声明；权威tracked 0644 | 字节未变继承 | [WH02 · 8](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-config-root-placement.ts` | 编译并验证配置的物理根位置；词法case-fold重叠 | 字节未变继承 | [WH02 · 9](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-config.ts` | 配置v2的被动JSON、Schema、placement、跨实体拓扑准入与冻结索引；先Schema后placement/topology | 字节未变继承 | [WH03 · 2](../plans/review-2026-10-03/hosts-workspace-files.json) |
| `wakeflow-fresh-config-selection.ts` | 用户selection到完整配置的纯编译；selectionKey闭合集 | 字节未变继承 | [WH02 · 11](../plans/review-2026-10-02/workspace-hosts-files.json) |

## Workspace：物化与运行窗口

### src/workspace（11）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `wakeflow-active-fresh-projection.ts` | 首次初始化的Active人读投影适配；从配置program/pod/repository名称生成fresh facts | 字节未变继承 | [WH02 · 95](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-active-static-resource-catalog.ts` | Active根、current、workspace投影、锁和board声明；权威布局摘要只含目录 | 字节未变继承 | [WH02 · 96](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-shared-coordination-layout.ts` | shared coordination和work-claims根物化；inspect missing/partial/current | 字节未变继承 | [WH02 · 97](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-workspace-static-resource-matrix.ts` | 合并共享与当前host目录并计算摘要；声明ID冲突 | 字节未变继承 | [WH02 · 98](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-workspace-static-resource-operation-context.ts` | 静态声明与recipe的纯准入上下文；expectedMatrixDigest一致 | 字节未变继承 | [WH02 · 99](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `workspace-host-resource-catalog.ts` | 按profile启用宿主资源声明；身份/投影基础目录 | 字节未变继承 | [WH02 · 117](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `workspace-host-resource-profile.ts` | 宿主中立资源profile封闭准入；project-thread或tmux-session | 字节未变继承 | [WH03 · 23](../plans/review-2026-10-03/hosts-workspace-files.json) |
| `workspace-host-runtime-paths.ts` | host runtime identity/projections的路径编译；profile先准入 | 字节未变继承 | [WH02 · 119](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `workspace-host-runtime-resource-catalog.ts` | 共享hosts根的静态目录声明；host-neutral 0700 ignored runtime-private | 字节未变继承 | [WH02 · 120](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `workspace-resource-declaration.ts` | 资源身份、逻辑根、所有权与处理recipe合同；字段闭合 | 字节未变继承 | [WH02 · 121](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `workspace-shared-runtime-resource-catalog.ts` | shared runtime和coordination目录声明；host-neutral 0700 | 字节未变继承 | [WH02 · 122](../plans/review-2026-10-02/workspace-hosts-files.json) |

### src/workspace/host-runtime（2）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `wakeflow-host-capability-layout-authority.ts` | 从profile选取启用capability目录并计算authorityDigest；所有选中声明必须directory-container | 字节未变继承 | [WH02 · 48](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-host-capability-layout-materialization.ts` | 宿主能力目录首次物化及ensure修复；prerequisite缺失 | 字节未变继承 | [WH02 · 49](../plans/review-2026-10-02/workspace-hosts-files.json) |

### src/workspace/maintenance（20）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `wakeflow-host-maintenance-capability.ts` | 宿主维护能力依赖反转端口；固定host/capability身份 | 字节未变继承 | [WH02 · 50](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-host-maintenance-contribution.ts` | 宿主操作序列、payload与摘要合同；128操作/128blocker | 字节未变继承 | [WH02 · 51](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-maintenance-execution-intent-store.ts` | 私有不可变intent持久发布与退休；2MiB | 字节未变继承 | [WH02 · 52](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-maintenance-execution-intent.ts` | 冻结可重建执行计划的恢复输入；两个profile | 字节未变继承 | [WH02 · 53](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-maintenance-execution-plan.ts` | 共享步骤与宿主贡献合并排序；非config共享在前 | 字节未变继承 | [WH02 · 54](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-maintenance-execution-preview.ts` | 零写聚合共享预览与单宿主贡献；当前配置摘要复验 | 字节未变继承 | [WH02 · 55](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-maintenance-execution-transaction.ts` | 维护执行与operationId恢复总协调；门内外重算 | 字节未变继承 | [WH02 · 56](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-maintenance-gate.ts` | 维护短锁、bootstrap与独占工作区作用域的关联门；fresh/repair布局准入 | 字节未变继承 | [WH03 · 17](../plans/review-2026-10-03/hosts-workspace-files.json) |
| `wakeflow-maintenance-journal-store.ts` | prepared发布、successor CAS与日志退休；64KiB | 字节未变继承 | [WH02 · 58](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-maintenance-journal.ts` | prepared/executing/terminal状态合同；begin标affected | 字节未变继承 | [WH02 · 59](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-maintenance-operation-id.ts` | 维护操作ID与intent/journal引用；UUIDv4 | 字节未变继承 | [WH02 · 60](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-maintenance-orphan-gate-recovery.ts` | 没有事务资源的孤门显式退休；inactive且operation匹配 | 字节未变继承 | [WH02 · 61](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-maintenance-public-host-facade.ts` | 公共维护切片固定单宿主接口；host/profiles/artifactRoot与preview/apply/recover | 字节未变继承 | [WH02 · 62](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-maintenance-resource-catalog.ts` | 本地维护根、runtime、transactions与gate声明；0700目录与0600 gate | 字节未变继承 | [WH02 · 63](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-prepared-maintenance-recovery.ts` | 仅取消未执行的prepared事务；checkpoint0/affectednull | 字节未变继承 | [WH02 · 64](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-private-mode-census.ts` | 私有Active/Local树的模式普查与保守收敛；100k条/24层 | 字节未变继承 | [WH02 · 65](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-static-materialization-preview-contract.ts` | 三动作与15种静态step的闭合合同；reconcile无desired | 字节未变继承 | [WH02 · 66](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-static-materialization-preview.ts` | 按配置与现场零写生成共享修复步骤；fresh全owned缺席 | 字节未变继承 | [WH02 · 67](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-static-materialization-step-executor.ts` | 持活动gate按15种step分派真实owner；plan/current/desired摘要 | 字节未变继承 | [WH02 · 68](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-workspace-core-layout-inspection.ts` | Active与私有维护协议的稳定只读分类和摘要；absent/bootstrap-prefix/idle/busy/recovery-required/conflict | 字节未变继承 | [WH03 · 18](../plans/review-2026-10-03/hosts-workspace-files.json) |

### src/workspace/managed-integration（18）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `wakeflow-external-instruction-body-authority.ts` | 选择managed-block仓库/外部支撑面并生成职责文本；owner-managed排除 | 字节未变继承 | [WH02 · 70](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-external-instruction-inspection.ts` | 外部指令target与配置摘要准入；desired必须含target | 字节未变继承 | [WH02 · 71](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-external-instruction-recomposition.ts` | 外部指令owner适配通用managed-block CAS；禁止request内signal | 字节未变继承 | [WH02 · 72](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-gitignore-body-authority.ts` | 两宿主完整profile集导出忽略规则；私有根覆盖后代 | 字节未变继承 | [WH02 · 73](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-gitignore-inspection.ts` | 检查实际.gitignore和候选Git忽略语义；必须Git工作区 | 字节未变继承 | [WH02 · 74](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-gitignore-recomposition-contract.ts` | gitignore重组参数、矩阵和锁合同；完整profiles匹配matrix | 字节未变继承 | [WH02 · 75](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-gitignore-recomposition-recovery.ts` | 仅相关非活动gitignore重组残留恢复；旧锁inactive | 字节未变继承 | [WH02 · 76](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-gitignore-recomposition.ts` | 工作区gitignore短锁内重组；已满足零写 | 字节未变继承 | [WH02 · 77](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-managed-block-file.ts` | 外部根受管块的稳定读取与原子CAS；当前用户单链接 | 字节未变继承 | [WH02 · 78](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-managed-integration-resource-catalog.ts` | 工作区.gitignore与重组锁声明；tracked0644文件 | 字节未变继承 | [WH02 · 79](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-managed-text-authority-transition.ts` | 旧/新已知正文到受管块的纯转换；desired current | 字节未变继承 | [WH02 · 80](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-managed-text-envelope.ts` | UTF8受管块边界、摘要与块外字节协议；恰好begin/end两marker | 字节未变继承 | [WH02 · 81](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-program-instruction-body-authority.ts` | 配置primary Controller与host的双语指令正文；转义显示字段 | 字节未变继承 | [WH02 · 82](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-program-instruction-inspection.ts` | program指令的矩阵/配置/源准入；current/desired同program | 字节未变继承 | [WH02 · 83](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-program-instruction-recomposition-contract.ts` | program指令重组与宿主专属锁合同；复用inspection请求 | 字节未变继承 | [WH02 · 84](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-program-instruction-recomposition-recovery.ts` | program指令锁与stage显式恢复；inactive锁 | 字节未变继承 | [WH02 · 85](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-program-instruction-recomposition.ts` | program指令短锁内原子重组；current零写 | 字节未变继承 | [WH02 · 86](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-support-gitignore-body-authority.ts` | 受管支撑面忽略宿主local settings规则；所有host localPath合集 | 字节未变继承 | [WH02 · 87](../plans/review-2026-10-02/workspace-hosts-files.json) |

### src/workspace/support（7）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `wakeflow-managed-support-resource-catalog.ts` | managed支撑面根/scaffold/整文件指令声明；外部支撑面排除 | 字节未变继承 | [WH02 · 88](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-managed-support-root-materialization.ts` | managed支撑面根与scaffold检查/补齐；absent/current/incomplete/conflict | 字节未变继承 | [WH02 · 89](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-support-memory-authority.ts` | managed支撑面整文件双语职责记忆；Design/Test角色 | 字节未变继承 | [WH02 · 90](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-support-memory-inspection.ts` | 整文件记忆来源与目标已知渲染准入；supportRoot必须匹配配置realpath | 字节未变继承 | [WH02 · 91](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-support-memory-publication-contract.ts` | 整文件publication的请求/options合同；复用inspection准入 | 字节未变继承 | [WH02 · 92](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-support-memory-publication.ts` | 整文件记忆原子发布和回读；current零写 | 字节未变继承 | [WH02 · 93](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-support-memory-recovery.ts` | 整文件记忆相关stages恢复后重试；限定目标instructionFile | 字节未变继承 | [WH02 · 94](../plans/review-2026-10-02/workspace-hosts-files.json) |

### src/workspace/window-runtime（18）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `wakeflow-window-host-binding-id.ts` | 底层window_binding ID准入与分配；UUIDv4和固定前缀 | 字节未变继承 | [WH02 · 100](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-window-host-binding-resource-catalog.ts` | 配置窗口的底层binding资源目录；只有profile windowIdentity启用 | 字节未变继承 | [WH02 · 101](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-window-host-binding-store-authority.ts` | 绑定store的配置/profile/路径准入；resource/identity host一致 | 字节未变继承 | [WH02 · 102](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-window-host-binding-store.ts` | 绑定专属锁、完整inventory与0600创建owner；锁前/锁内重新加载可调用authority | 字节未变继承 | [WH03 · 19](../plans/review-2026-10-03/hosts-workspace-files.json) |
| `wakeflow-window-host-binding.ts` | 底层binding wire与确定性文本合同；typed IDs/host profile/opaque handle/time | 字节未变继承 | [WH02 · 104](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-window-host-identity-profile.ts` | 宿主opaque handle的通用词法准入；host闭集 | 字节未变继承 | [WH02 · 105](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-window-launch-instructions.ts` | 共享启动说明renderer类型端口；输入为配置/逻辑意图/宿主profile/已登记检出相对路径 | 字节未变继承 | [WH03 · 20](../plans/review-2026-10-03/hosts-workspace-files.json) |
| `wakeflow-window-launch-intent.ts` | 配置窗口启动意图集；worktree产品local-head | 字节未变继承 | [WH02 · 106](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-window-runtime-desired-topology.ts` | 配置到静态窗口根拓扑；role/root匹配 | 字节未变继承 | [WH02 · 107](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-window-runtime-fresh-authority.ts` | 首次窗口运行时目录与unregistered投影集合；必须支持windowIdentity | 字节未变继承 | [WH02 · 108](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-window-runtime-fresh-publication.ts` | 首次发布窗口运行时精确目录前缀；fresh根缺席 | 字节未变继承 | [WH02 · 109](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-window-runtime-paths.ts` | 窗口绑定/锁/投影路径函数；typed window ID和host profile准入 | 字节未变继承 | [WH02 · 110](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-window-runtime-projection-document.ts` | 单窗口派生投影读取与发布；missing/current/stale/unsafe | 字节未变继承 | [WH02 · 111](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-window-runtime-projection-inspection.ts` | 配置与binding派生窗口期望投影的只读观察；runtime缺失/库存不可用/逐窗口current-stale-missing-unsafe | 字节未变继承 | [WH03 · 21](../plans/review-2026-10-03/hosts-workspace-files.json) |
| `wakeflow-window-runtime-projection-maintenance.ts` | 窗口投影规划、刷新、骨架创建、精确退休与维护执行；refresh shared后重读配置 | 字节未变继承 | [WH03 · 22](../plans/review-2026-10-03/hosts-workspace-files.json) |
| `wakeflow-window-runtime-registered-projection.ts` | 配置投影与binding合成registered文档；身份必须一致 | 字节未变继承 | [WH02 · 114](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-window-runtime-resource-catalog.ts` | 静态窗口投影资源声明；每条projection目录与window一一 | 字节未变继承 | [WH02 · 115](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-window-runtime-unregistered-projection.ts` | 未登记投影的完整合同及文档集合；role/逻辑root/placement | 字节未变继承 | [WH02 · 116](../plans/review-2026-10-02/workspace-hosts-files.json) |

## Governance：领域事实与规则

### src/governance/controller（1）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `demand-controller-route.ts` | 组合当前责任前沿与阻塞；terminal优先 | 字节未变继承 | [DD02 · 19](../plans/review-2026-10-02/demand-delivery-files.json) |

### src/governance/delivery（5）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `delivery-envelope.ts` | 冻结投递信封、route/fence/prompt与taskPackage关联；被动JSON+Schema | 字节未变继承 | [RD02 · 1](../plans/review-2026-10-02/result-delivery-supplement-files.json) |
| `delivery-outcome.ts` | 投递代际结局与claimHandling合同；rejected-before-send释放授权 | 字节未变继承 | [RD02 · 2](../plans/review-2026-10-02/result-delivery-supplement-files.json) |
| `delivery-rearm.ts` | 同一delivery的新代际围栏合同；prev+1 | 字节未变继承 | [RD02 · 3](../plans/review-2026-10-02/result-delivery-supplement-files.json) |
| `target-delivery-product-defect-remediation-context.ts` | 从产品缺陷授权及受影响实现结果构造纠错上下文；前结果必须implementation且匹配affected baseline | 字节未变继承 | [RD02 · 5](../plans/review-2026-10-02/result-delivery-supplement-files.json) |
| `target-delivery-rework-context.ts` | 从真实Controller rework决定及前结果裁剪上下文；program/demand/task/package/result全引用一致 | 字节未变继承 | [RD02 · 4](../plans/review-2026-10-02/result-delivery-supplement-files.json) |

### src/governance/demand（5）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `demand-acceptance-coverage.ts` | 从原始验收标准与accepted事件派生覆盖；复验需求record/member摘要 | 字节未变继承 | [DD02 · 20](../plans/review-2026-10-02/demand-delivery-files.json) |
| `demand-operation-authority-context.ts` | 安全打开Config/Ledger/Demand及重新复验Config；私有目录权限+节点身份 | 字节未变继承 | [DD02 · 21](../plans/review-2026-10-02/demand-delivery-files.json) |
| `demand-resource-catalog.ts` | Demand长期资源及操作recipe声明；静态发布目录 | 字节未变继承 | [DD02 · 22](../plans/review-2026-10-02/demand-delivery-files.json) |
| `demand-runtime-recovery.ts` | 维护入口的Demand候选恢复计划与应用；拥有者非inactive阻塞 | 字节未变继承 | [DD02 · 23](../plans/review-2026-10-02/demand-delivery-files.json) |
| `demand-verify-gates.ts` | 完成取消与公开verify复用的只读门；异常转unavailable但aborted上抛 | 字节未变继承 | [DD02 · 24](../plans/review-2026-10-02/demand-delivery-files.json) |

### src/governance/demand/event-sourcing（21）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `demand-event-sourcing-aggregate.ts` | 当前聚合与尾部证明合同；Demand、revision、尾event、结果state digest一致；tail event/state版本受支持 | 字节未变继承 | [EC02 · 10](../plans/review-2026-10-02/event-core-supplement-files.json) |
| `demand-event-sourcing-command-handler.ts` | load→decide→prepare→append→checkpoint；先客户端key/requestDigest重放；修订过期再按commitId复验；流瞬态最多3次重读；checkpoint失败标stale | 字节未变继承 | [EC02 · 11](../plans/review-2026-10-02/event-core-supplement-files.json) |
| `demand-event-sourcing-decider.ts` | 十四命令到十五事件的纯决策与归约路由；publish仅null；review同批附escalation或product-defect授权；第三次rework附刹车；continue事件冻结历史test IDs | 字节未变继承 | [EC02 · 21](../plans/review-2026-10-02/event-core-supplement-files.json) |
| `demand-event-sourcing-event-version-codec.ts` | 十五事件家族的版本注册表；所有当前/支持版本为1、steps为空；Schema复验payload后领域event准入 | 字节未变继承 | [EC02 · 8](../plans/review-2026-10-02/event-core-supplement-files.json) |
| `demand-event-sourcing-event.ts` | 十五未提交领域事件联合；精确字段集与payload codecs；要求身份/记录时间/派生eventId/callbackId闭合；continue history可选保持旧字节 | 字节未变继承 | [EC02 · 9](../plans/review-2026-10-02/event-core-supplement-files.json) |
| `demand-event-sourcing-paths.ts` | commits/snapshots/index/candidate路径；16位序号；候选含commitId和pid/thread/token；词法往返须canonical | 字节未变继承 | [EC02 · 4](../plans/review-2026-10-02/event-core-supplement-files.json) |
| `demand-event-sourcing-persisted-event-envelope.ts` | 跨版本稳定路由封装；Schema/typedID/time/revision/digest；未知type/version在此层可保留，payload暂不解释 | 字节未变继承 | [EC02 · 6](../plans/review-2026-10-02/event-core-supplement-files.json) |
| `demand-event-sourcing-repository.ts` | 事件流加载、全量历史审计、定位与checkpoint协调；load优先可信快照加尾流；坏快照回退全流，audit始终重放全部提交 | 字节未变继承 | [DD03 · 11](../plans/review-2026-10-03/demand-delivery-files.json) |
| `demand-event-sourcing-root-authority.ts` | Identity/Authority/Ledger/事件/证据组合闭包；inventory前后稳定；首Commit唯一published；普通load可snapshot-tail；audit显式；事务期只放行同journal stage/final | 字节未变继承 | [EC02 · 20](../plans/review-2026-10-02/event-core-supplement-files.json) |
| `demand-event-sourcing-root-inventory.ts` | Demand允许资源的排他清单；根5项、event树4项；healthy候选/事务空；publication各仅单指定journal；证据元数据/当前事务整树；拒未知项 | 字节未变继承 | [EC02 · 19](../plans/review-2026-10-02/event-core-supplement-files.json) |
| `demand-event-sourcing-snapshot.ts` | 版本兼容快照合同；绑定commit边界、tail event和state；restore复验anchor commit；compatibility变化拒绝使用 | 字节未变继承 | [EC02 · 16](../plans/review-2026-10-02/event-core-supplement-files.json) |
| `demand-event-sourcing-state-version.ts` | 状态模型版本独立准入；只支持v1；正整数未知版本在supported断言拒绝 | 字节未变继承 | [EC02 · 1](../plans/review-2026-10-02/event-core-supplement-files.json) |
| `demand-event-sourcing-stored-event.ts` | 稳定持久封装门面与最新事件写入器；当前event+resulting state+revision→envelope；完整文档表示严格往返 | 字节未变继承 | [EC02 · 5](../plans/review-2026-10-02/event-core-supplement-files.json) |
| `demand-event-sourcing-upcaster.ts` | 类型版本路由到当前领域事件；先envelope再注册表codec/evolve；未知类型或版本在reducer前拒绝 | 字节未变继承 | [EC02 · 7](../plans/review-2026-10-02/event-core-supplement-files.json) |
| `demand-event-sourcing-version-compatibility.ts` | 事件及状态支持矩阵摘要；family当前/支持版本改变使snapshot不兼容并回退 | 字节未变继承 | [EC02 · 2](../plans/review-2026-10-02/event-core-supplement-files.json) |
| `demand-event-stream-commit.ts` | 多Event原子Commit及进程内预备能力；64事件上限；序号/修订/hash链；每事件upcast+evolve+result digest；特定event绑定提交边界；WeakSet签发prepared | 字节未变继承 | [EC02 · 12](../plans/review-2026-10-02/event-core-supplement-files.json) |
| `demand-event-stream-position.ts` | 逻辑修订与物理槽位品牌；持久位置都正安全整数；0只属于append预期空流 | 字节未变继承 | [EC02 · 3](../plans/review-2026-10-02/event-core-supplement-files.json) |
| `demand-file-event-snapshot-store.ts` | 快照文件读写与stage恢复；坏内容返回invalid；未知资源/模式拒绝；按seq no-replace；现有异字节conflict；显式stage恢复 | 字节未变继承 | [EC02 · 17](../plans/review-2026-10-02/event-core-supplement-files.json) |
| `demand-file-event-store-contract.ts` | 文件事件存储容量和稳定错误；10000commit，单16MiB，总64MiB；目录0700/文件0600与当前owner，常态单链接 | 字节未变继承 | [EC02 · 13](../plans/review-2026-10-02/event-core-supplement-files.json) |
| `demand-file-event-store-reader.ts` | 稳定全流/尾部/按位读；全流前后目录快照、连续名/ID/hash链；尾部从anchor逐位到首缺席；private与archived节点政策区分 | 字节未变继承 | [EC02 · 14](../plans/review-2026-10-02/event-core-supplement-files.json) |
| `demand-file-event-store.ts` | 候选到不可替换权威槽位追加及恢复；同进程canonical-root队列；跨进程exclusive link；索引准入O1或全前缀；target存在同字节幂等；inactive候选安全清理 | 字节未变继承 | [EC02 · 15](../plans/review-2026-10-02/event-core-supplement-files.json) |

### src/governance/demand/model（4）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `demand-aggregate-state.ts` | Demand纯聚合解析及任务/投递/结果/评审/生命周期状态转换；每步转换重新Schema及关系准入；任务/投递/结果/决定身份与摘要必须闭合 | 字节未变继承 | [DD03 · 12](../plans/review-2026-10-03/demand-delivery-files.json) |
| `demand-authority.ts` | 身份与需求成员角色的强制权威关系；同一个record、requirement/landing各一；research iff not-applicable；environmentMemberRef恒null；resolve成员及program | 字节未变继承 | [EC02 · 24](../plans/review-2026-10-02/event-core-supplement-files.json) |
| `demand-identity.ts` | Demand不可变身份；program/demand/pod/需求谱系及目标文本严格准入；草稿先校验再读clock | 字节未变继承 | [EC02 · 22](../plans/review-2026-10-02/event-core-supplement-files.json) |
| `requirement-lineage.ts` | 需求包记录谱系引用；typed requirementId+固定recordRef+recordDigest关系；不指向可变看板 | 字节未变继承 | [EC02 · 23](../plans/review-2026-10-02/event-core-supplement-files.json) |

### src/governance/demand/publication（8）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `demand-active-guard.ts` | Pod活动与持久意图占用守卫；先发布sidecar/生命周期日志 | 字节未变继承 | [DD02 · 25](../plans/review-2026-10-02/demand-delivery-files.json) |
| `demand-event-sourcing-publication-contract.ts` | 发布公共结果、状态和错误词汇；current/recoverable/unchanged/unknown | 字节未变继承 | [DD02 · 26](../plans/review-2026-10-02/demand-delivery-files.json) |
| `demand-event-sourcing-publication-package.ts` | 需求包claim精确前序与CAS；pending摘要必须相同 | 字节未变继承 | [DD02 · 27](../plans/review-2026-10-02/demand-delivery-files.json) |
| `demand-event-sourcing-publication-service.ts` | 跨资源发布顺序和流程锁；先authority+pending准入 | 字节未变继承 | [DD02 · 28](../plans/review-2026-10-02/demand-delivery-files.json) |
| `demand-event-sourcing-publication-stage.ts` | 暂存根构建、整体发布与闭包加载；按精确内容写identity/authority/marker | 字节未变继承 | [DD02 · 29](../plans/review-2026-10-02/demand-delivery-files.json) |
| `demand-event-sourcing-publication-storage.ts` | 发布文件私有节点与精确写入边界；节点mode/owner/links | 字节未变继承 | [DD02 · 30](../plans/review-2026-10-02/demand-delivery-files.json) |
| `demand-event-sourcing-publication-transaction.ts` | 自包含不可变发布恢复合同；字段集合严格 | 字节未变继承 | [DD02 · 31](../plans/review-2026-10-02/demand-delivery-files.json) |
| `demand-publication-paths.ts` | 发布目录与Demand根的路径词汇；ID品牌校验 | 字节未变继承 | [DD02 · 32](../plans/review-2026-10-02/demand-delivery-files.json) |

### src/governance/evidence（19）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `managed-evidence-capture-plan.ts` | 零写捕获计划合同；configDigest与recordedBy一致；expectedDemand四项与完整Manifest封摘要 | 字节未变继承 | [CE02 · 20](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `managed-evidence-capture-planning-service.ts` | 四类证据来源的零写捕获规划、内容审阅门、身份派生与权威复验。；解析非proxy options/AbortSignal/clock、typed Demand ID、选择closed shape和kind-source配对；预取消立即失败，错误按稳定类别映射。 | 本轮语义复核 | [PR05 · 3](../plans/review-2026-10-03-rc4/privacy-evidence-files.json) |
| `managed-evidence-configured-source-root.ts` | 逻辑根到当前配置物理根；repository/surface须present且realpath一致；pod-worktree须配置意图+回执 | 字节未变继承 | [CE02 · 22](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `managed-evidence-manifest.ts` | 证据不可变来源内容合同；Schema+typedID+payload digest+单content映射+contentReview子集排序；预留Manifest容量 | 字节未变继承 | [CE02 · 23](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `managed-evidence-publication-application-service.ts` | 证据发布与恢复总编排；journal→stage→Event→final；Event存在前向；Event前CAS过期安全退休；complete stage不重读source/config关系 | 字节未变继承 | [CE02 · 24](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `managed-evidence-publication-payload-materializer.ts` | 按来源物化payload；file流复制、tree双向identity、reference从Manifest重建；按缺失成员补 | 字节未变继承 | [CE02 · 25](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `managed-evidence-publication-record-publisher.ts` | 完整stage同根发布final；需exact journal；final存在且stage无才current；冲突/提交不确定复验winner | 字节未变继承 | [CE02 · 26](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `managed-evidence-publication-stage-materializer.ts` | journal约束的完整stage物化；complete重用；partial只在Manifest缺失时补；payload闭合后Manifest-last；提交后readback | 字节未变继承 | [CE02 · 27](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `managed-evidence-publication-transaction-settlement.ts` | Event不可逆边界与journal-last结算；提交精确命令；证明commit→final→事务闭合→retire journal→健康闭合；stale退休需Event与selector均缺 | 字节未变继承 | [CE02 · 28](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `managed-evidence-publication-transaction-store.ts` | Demand唯一journal存储；absent-only create；exact load；WeakSet读回能力才能retire；提交后忽略取消完成readback | 字节未变继承 | [CE02 · 29](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `managed-evidence-publication-transaction.ts` | 跨资源不可变恢复合同；capture/record计划摘要+完整Manifest+Event CAS四项/ID；无可变phase | 字节未变继承 | [CE02 · 30](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `managed-evidence-reading-service.ts` | Event权威之上的证据读取；健康Demand+selector/inventory与record精确闭合，再metadata/member/complete | 字节未变继承 | [CE02 · 31](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `managed-evidence-record-reader.ts` | 单记录元数据、单成员、整树三级读取；top-level必须manifest+payload；WeakSet能力；member全文件length/hash/mode；verify整树 | 字节未变继承 | [CE02 · 32](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `managed-evidence-record-set-inventory.ts` | 记录集合稳定结构清点；healthy只接完整final元数据；事务仅一个匹配stage/final；前后目录快照一致 | 字节未变继承 | [CE02 · 33](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `managed-evidence-record-tree-plan.ts` | Manifest+payload精确整树计划；Manifest文档hash与业务digest区分；0700目录/可执行文件、0600普通文件 | 字节未变继承 | [CE02 · 34](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `managed-evidence-resource-catalog.ts` | 证据资源声明；容器materialize；final manifested-tree；journal exclusive-create/exact-retire | 字节未变继承 | [CE02 · 35](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `managed-evidence-resource-paths.ts` | Evidence final/stage及Demand唯一journal路径；typedID双向词法准入；final与stage分开 | 字节未变继承 | [CE02 · 36](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `managed-evidence-source-projection.ts` | 引用来源的确定性payload；observation/link/commit投影为payload/content | 字节未变继承 | [CE02 · 37](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `managed-evidence-source-selection.ts` | 逻辑来源与kind关系准入；managed-path拒绝保留顶层目录；observation私有记录投影；https无userinfo；commit OID；transcript需present | 字节未变继承 | [CE02 · 38](../plans/review-2026-10-02/coordination-evidence-files.json) |

### src/governance/ledger（12）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `ledger-authority-layout.ts` | Ledger固定三容器布局；requirements/archives0755、transactions0700；absent/incomplete/conflict/current | 字节未变继承 | [CE02 · 39](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `ledger-authority-paths.ts` | 需求包、intent、lock、stage路径；仅requirement家族；typedID与成员路径词法派生 | 字节未变继承 | [CE02 · 40](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `ledger-authority-reader.ts` | 完整目录闭合与成员引用；稳定树所有节点/库存/digest；ref record/member语义绑定；具体成员复读 | 字节未变继承 | [CE02 · 41](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `ledger-authority-record.ts` | 不可变需求record codec；主文档恰各一、路径排序大小写无冲突、章节唯一且属于成员；research与not-applicable对等 | 字节未变继承 | [CE02 · 42](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `ledger-authority-storage-policy.ts` | Ledger权限与容量；durable0755/0644、private0700/0600；成员4MiB/树16MiB/18文档 | 字节未变继承 | [CE02 · 43](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `ledger-authority-store-contract.ts` | Ledger加载/引用/错误合同；passive options仅signal；节点模式单链接校验 | 字节未变继承 | [CE02 · 44](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `ledger-authority-store.ts` | Ledger根作用域公共门面；initialize/load/publish/recover/resolve；批量同record只load一次、32引用8并发 | 字节未变继承 | [CE02 · 45](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `ledger-record-publication-intent.ts` | 精简不可变发布意图；record+treePlan+派生paths一致；成员正文不入intent | 字节未变继承 | [CE02 · 46](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `ledger-record-publication-recovery.ts` | 发布前向恢复；锁前后exact intent；final在则结算；stage完整才publish；partial/absent需原输入 | 字节未变继承 | [CE02 · 47](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `ledger-record-publication-storage.ts` | 逐记录物理协调与读回；inactive锁可退休；journal/stage模式验证；exact tree publish和intent精确retire | 字节未变继承 | [CE02 · 48](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `ledger-record-publisher.ts` | 逐需求包正常发布；锁内exact intent；既有final严格复用；无归属stage拒绝；intent→stage→publish→读回→retire | 字节未变继承 | [CE02 · 49](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `ledger-resource-catalog.ts` | Ledger资源与允许操作声明；静态三容器、record树/成员immutable、intent/lock私有 | 字节未变继承 | [CE02 · 50](../plans/review-2026-10-02/coordination-evidence-files.json) |

### src/governance/lifecycle（1）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `demand-completion.ts` | 成功终态的不可变载荷；仅completion-preflight | 字节未变继承 | [DD02 · 33](../plans/review-2026-10-02/demand-delivery-files.json) |

### src/governance/observation（7）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `active-projection-facts.ts` | 观察到人读事实及已接受分支；投影剔除瞬时宿主/检出/仓库/归档；缺读Demand写coverage且禁止退休；完整branch集才推断缺席 | 字节未变继承 | [CE02 · 51](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `active-projection-refresh.ts` | 业务提交后的可重建活动页面刷新；refresh 进入/借用 workspace shared，再取得 publisher 锁，锁内才读配置并打开 Ledger，再 observe/render/publish | 字节未变继承 | [CE03 · 13](../plans/review-2026-10-03/coordination-files.json) |
| `archived-demand-observation.ts` | 仍存worktree Pod的归档评审补读；候选新到旧；清单1024、snapshot64双预算；primary不占snapshot；unreadable与skipped分开 | 字节未变继承 | [CE02 · 53](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `demand-archive-locator.ts` | 最近归档小回执定位；按10位修订最大目录；局部校验outcome/time/event/digest/pod | 字节未变继承 | [CE02 · 54](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `observation-policy.ts` | 生效阈值汇总；直接引用各owner阈值、无自有默认分支 | 字节未变继承 | [CE02 · 55](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `repository-pointer-observation.ts` | Git指针只读观察；HEAD/loose/packed/worktree pointers；loose优先；branch读取不全标issue；主检出.git必须目录 | 字节未变继承 | [CE02 · 56](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `workspace-observation.ts` | 工作区各域隔离读取与总体朝向派生；projection/full 读取范围独立；read reason 环境错误变 unavailable，aborted 和无 reason 错误继续上抛 | 字节未变继承 | [CE03 · 14](../plans/review-2026-10-03/coordination-files.json) |

### src/governance/pod（2）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `pod-state.ts` | Pod执行环境状态派生；open全部绑定+回执同代+检出在→ready，否则creating；closing全清→closed | 字节未变继承 | [CE02 · 58](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `worktree-disposal.ts` | 关闭 Pod 遗留检出的有界处置建议；按 profile 的 claude-worktree-flag/git-worktree 选择替代文字；不再以宿主 id 分支 | 字节未变继承 | [CE03 · 12](../plans/review-2026-10-03/coordination-files.json) |

### src/governance/result（7）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `implementation-target-result-report.ts` | 实现窗口报告content/时间/摘要与确定文档合同；completed/blocked/needs-review | 字节未变继承 | [RD02 · 6](../plans/review-2026-10-02/result-delivery-supplement-files.json) |
| `implementation-target-result.ts` | 闭合实现task/envelope/delivery/report；accepted或indeterminate | 字节未变继承 | [RD02 · 7](../plans/review-2026-10-02/result-delivery-supplement-files.json) |
| `target-result-callback.ts` | 结果callback首次/重发/证据解析及派生状态；初代1 | 字节未变继承 | [RD02 · 12](../plans/review-2026-10-02/result-delivery-supplement-files.json) |
| `target-result-report-contract.ts` | 两类报告共用outcome与evidence locator类型；completed只代表目标合同完成 | 字节未变继承 | [RD02 · 8](../plans/review-2026-10-02/result-delivery-supplement-files.json) |
| `target-result.ts` | TargetResult联合合同与稳定ID/事件/commit派生；workType区分assignment/testExecution | 字节未变继承 | [RD02 · 9](../plans/review-2026-10-02/result-delivery-supplement-files.json) |
| `test-target-result-report.ts` | 逐步测试报告及整体verdict纯派生；fail>blocked>cannot-conclude>pass | 字节未变继承 | [RD02 · 10](../plans/review-2026-10-02/result-delivery-supplement-files.json) |
| `test-target-result.ts` | 闭合测试任务合同、attempt和报告scope；test envelope+attempt匹配 | 字节未变继承 | [RD02 · 11](../plans/review-2026-10-02/result-delivery-supplement-files.json) |

### src/governance/review（7）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `controller-implementation-review-decision.ts` | 实现决定严格编解码与自排除摘要；accept要求完成且aligned/satisfactory无阻塞 | 字节未变继承 | [DD02 · 34](../plans/review-2026-10-02/demand-delivery-files.json) |
| `controller-product-defect-remediation-authorization.ts` | 产品修复授权v1的规范构建、关系校验与摘要；从精确product-defect决定与accepted基线生成existing-task-packages-only授权 | 字节未变继承 | [DD03 · 13](../plans/review-2026-10-03/demand-delivery-files.json) |
| `controller-review-decision-contract.ts` | 共享独立检查、升级与恢复词汇；文本NFC/长度 | 字节未变继承 | [DD02 · 36](../plans/review-2026-10-02/demand-delivery-files.json) |
| `controller-review-decision.ts` | 两类持久决定联合解析；kind分发implementation/test | 字节未变继承 | [DD02 · 37](../plans/review-2026-10-02/demand-delivery-files.json) |
| `controller-test-review-decision.ts` | 测试决定严格合同与一致性；accept全passed/satisfied/sufficient | 字节未变继承 | [DD02 · 38](../plans/review-2026-10-02/demand-delivery-files.json) |
| `demand-post-acceptance-route.ts` | 实现接受后测试或完成的下一责任；先终态 | 字节未变继承 | [DD02 · 39](../plans/review-2026-10-02/demand-delivery-files.json) |
| `demand-result-review-snapshot.ts` | 从完整事件历史重建当前评审输入；awaiting/reported/decided | 字节未变继承 | [DD02 · 40](../plans/review-2026-10-02/demand-delivery-files.json) |

### src/governance/tasking（3）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `task-package-projection-paths.ts` | TaskPackage ID到投影路径的严格映射；只准UUIDv4品牌与精确json文件名 | 字节未变继承 | [DD02 · 41](../plans/review-2026-10-02/demand-delivery-files.json) |
| `task-package-projection-store.ts` | 从规划事件重建不可覆盖的任务投影；事件不存在无写 | 字节未变继承 | [DD02 · 42](../plans/review-2026-10-02/demand-delivery-files.json) |
| `task-package.ts` | 实施与测试冻结合同的严格编解码；判别workType | 字节未变继承 | [DD02 · 43](../plans/review-2026-10-02/demand-delivery-files.json) |

### src/governance/testing（1）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `test-execution-attempt.ts` | 真实测试逻辑attempt合同；initial=1 | 字节未变继承 | [DD02 · 44](../plans/review-2026-10-02/demand-delivery-files.json) |

## Capabilities：公共纵切

### src/capabilities/delivery（4）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `contract.ts` | 公共工具Schema准入与工具登记；请求先passive JSON再Schema | 字节未变继承 | [DD02 · 1](../plans/review-2026-10-02/demand-delivery-files.json) |
| `decide.ts` | 投递处置、准备和重武装的纯决定；显式resolution优先且只接受indeterminate；accepted仍须目标hook记录 | 字节未变继承 | [DD03 · 1](../plans/review-2026-10-03/demand-delivery-files.json) |
| `prompt.ts` | 从冻结任务和路由渲染可移植投递文本；输出明确的executionRootFromWorkspace并要求显式命令workdir，聊天初始cwd可以不同 | 字节未变继承 | [DD03 · 2](../plans/review-2026-10-03/demand-delivery-files.json) |
| `service.ts` | 投递准备、结局与重武装的公共效果切片；所有append入口向command shell传signal；共享scope先于上下文打开 | 字节未变继承 | [DD03 · 3](../plans/review-2026-10-03/demand-delivery-files.json) |

### src/capabilities/demand（7）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `archive.ts` | 归档包与活动根的物理读写；普通文件目录与容量边界 | 字节未变继承 | [DD02 · 5](../plans/review-2026-10-02/demand-delivery-files.json) |
| `context.ts` | Demand工具共用Config/Ledger/活动根上下文；根不存在允许归档路径 | 字节未变继承 | [DD02 · 6](../plans/review-2026-10-02/demand-delivery-files.json) |
| `contract.ts` | 创建、完成、取消与继续四个公共工具的Schema边界及目录说明；passive JSON后按请求Schema准入 | 字节未变继承 | [DD03 · 4](../plans/review-2026-10-03/demand-delivery-files.json) |
| `decide.ts` | Demand创建/终态/续接的纯准入与确定身份；完成要求active、无等待、completion-preflight及全部verify门 | 字节未变继承 | [DD03 · 5](../plans/review-2026-10-03/demand-delivery-files.json) |
| `lifecycle.ts` | 完成/取消五步归档、继续和记录回答的日志事务owner；preview只读重算plan，apply核digest；apply/recover进入workspace shared scope | 字节未变继承 | [DD03 · 6](../plans/review-2026-10-03/demand-delivery-files.json) |
| `service.ts` | 从pending需求包创建Demand与发布恢复；preview以claim摘要派生Demand身份，核原记录、开放Pod及占用 | 字节未变继承 | [DD03 · 7](../plans/review-2026-10-03/demand-delivery-files.json) |
| `verify.ts` | 兼容重导出治理层verify门；所有门由同一governance owner实现 | 字节未变继承 | [DD02 · 11](../plans/review-2026-10-02/demand-delivery-files.json) |

### src/capabilities/endpoint（6）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `contract.ts` | 绑定工具六操作请求结果合同；inspect/register/replace/relocate/decommission/release-claim经生成Schema准入 | 字节未变继承 | [CE02 · 1](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `decide.ts` | 端点六操作中的五类变更纯准入；共同准入要求意图摘要、宿主 locator 坐标、worktree 观察、符合启动根规则的 session-start 与 handle 唯一性 | 字节未变继承 | [CE03 · 7](../plans/review-2026-10-03/coordination-files.json) |
| `locator-store.ts` | tmux四元组与绑定代际私有存储；locatorId从坐标和绑定派生；create或CAS replace；精确退役；损坏稳定错误 | 字节未变继承 | [CE02 · 3](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `pane-classification.ts` | tmux观察固定优先级分类；binding/socket→缺席/重复→坐标/窗口→dead/process/metadata→live | 字节未变继承 | [CE02 · 4](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `projection.ts` | 窗口投影写入门面与next；未注册→用户登记；已持过期claim→controller恢复；其余pod窗口继续登记 | 字节未变继承 | [CE02 · 5](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `service.ts` | 绑定、定位器、执行回执、claim 恢复与公开启动说明；inspect 为 read，五类变更为 shared，Config/拓扑/启动意图在 scope 内加载；launch instructions 由 host facade 注入 | 字节未变继承 | [CE03 · 8](../plans/review-2026-10-03/coordination-files.json) |

### src/capabilities/evidence（3）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `contract.ts` | 受管证据效果工具wire合同；preview/apply/recover；七kind按四source闭合 | 字节未变继承 | [CE02 · 7](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `decide.ts` | 证据公开plan摘要和Event身份；摘要排除capturedAt/CAS；ID从evidence派生；summary不回显完整tree | 字节未变继承 | [CE02 · 8](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `service.ts` | 受管证据公开 preview/apply/recover 编排；preview read；apply/recover shared；recover 用 demandId 作 operationId，由证据 owner 定位日志 | 字节未变继承 | [CE03 · 9](../plans/review-2026-10-03/coordination-files.json) |

### src/capabilities/observation（3）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `contract.ts` | status/verify 请求与结果 Schema 准入及工具目录；请求继续 V1；状态和核验结果升级 V2，公共 schemaVersion=2 | 字节未变继承 | [CE03 · 15](../plans/review-2026-10-03/coordination-files.json) |
| `decide.ts` | 只读观察的十五门、下一责任和限量规则；runtime-artifact 将 server evidence 和 unverifiedWindows 分开；已知启动/磁盘摘要不同 fail，有缺失或绑定 runtime 无关联证据 unavailable，无 adapter 且无 peer 才 pass/not-applicable | 字节未变继承 | [CE03 · 16](../plans/review-2026-10-03/coordination-files.json) |
| `service.ts` | 一次分域观察生成 status V2 与严格 verify V2；两个入口显式 scope read，Config/Ledger 打不开仍整调用拒绝；每次各观察一轮，verify 附加复验不写 | 字节未变继承 | [CE03 · 17](../plans/review-2026-10-03/coordination-files.json) |

### src/capabilities/pod（3）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `contract.ts` | Pod效果工具wire合同；preview/apply/recover，create与两段close | 字节未变继承 | [CE02 · 13](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `decide.ts` | Pod身份模板与两段关闭纯规则；ID按program/key；main保留；关闭需无活动Demand+分支处置；第二段无绑定无检出 | 字节未变继承 | [CE02 · 14](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `service.ts` | Pod 配置效果编排、两段关闭及私有回执恢复；preview read，apply/recover workspace exclusive，在打开 Config 上下文前取得；内部 apply 仍按 Pod 短锁复验 Config 与 plan | 字节未变继承 | [CE03 · 11](../plans/review-2026-10-03/coordination-files.json) |

### src/capabilities/requirement（4）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `contract.ts` | 需求发布与看板读取wire合同；publish/activate/withdraw三模式；list/package只读 | 字节未变继承 | [CE02 · 16](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `decide.ts` | 需求包纯分析：章节与验收、确认摘要、需求隐私语境、发布阻塞、确定性身份和认领迁移条件。；privacyBlockers扫描后只对路径命中调用isSystemAbsolutePath；普通站内路由被豁免，显式URI/盘符/UNC/HOME或规范化系统路径保留；每段最多32项，仅输出标签/行/类别。 | 本轮语义复核 | [PR05 · 2](../plans/review-2026-10-03-rc4/privacy-evidence-files.json) |
| `projection.ts` | 看板排序计数与下一责任；P0..P3→发布时间→ID；过滤分页；确认/待apply/待claim优先级 | 字节未变继承 | [CE02 · 18](../plans/review-2026-10-02/coordination-evidence-files.json) |
| `service.ts` | 需求发布/activate/withdraw/recover及看板查询的公共编排，连接纯评估、Ledger不可变内容、认领CAS和公共结果边界。；openContext读取当前Config，要求Ledger placement存在且打开的真实根等于快照；关闭Ledger句柄，由命令壳持有工作区根。 | 本轮语义复核 | [PR05 · 4](../plans/review-2026-10-03-rc4/privacy-evidence-files.json) |

### src/capabilities/result-review（4）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `contract.ts` | 公共工具Schema准入与工具登记；请求先passive JSON再Schema | 字节未变继承 | [DD02 · 12](../plans/review-2026-10-02/demand-delivery-files.json) |
| `decide.ts` | 结果导入与评审的无 I/O 决策集合：受管证据定位、报告隐私、会话观察派生、允许动作/恢复守卫、测试步骤基线与 callback 展示摘要。；planEvidenceLocator 只识别 managed-evidence 下合法 evidence ID 与 manifest/payload 非空成员；真正 portable path 与受管归属复验由 service 完成。 | 本轮语义复核 | [CB05 · 2](../plans/review-2026-10-03-rc4/callback-files.json) |
| `prompt.ts` | 把已准入的任务/结果事实确定性渲染为中英文 wake-controller 导航消息，将目标报告自由文本作为引用数据展示，并保留读取评审单元所需身份。；language 选择 en / zh-Hans 固定标签；authority 提醒位于数据字段之前。 | 本轮语义复核 | [CB05 · 1](../plans/review-2026-10-03-rc4/callback-files.json) |
| `service.ts` | 导入结果、读取评审、记录实现/测试决定；import先幂等，再核围栏/phase/workType/证据；结果事件提交后无请求signal释放claim | 字节未变继承 | [DD03 · 9](../plans/review-2026-10-03/demand-delivery-files.json) |

### src/capabilities/tasking（3）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `contract.ts` | 公共工具Schema准入与工具登记；请求先passive JSON再Schema | 字节未变继承 | [DD02 · 16](../plans/review-2026-10-02/demand-delivery-files.json) |
| `decide.ts` | 任务锚点、谱系、拓扑与测试准入纯决定；同仓replacement/continuation | 字节未变继承 | [DD02 · 17](../plans/review-2026-10-02/demand-delivery-files.json) |
| `service.ts` | 冻结实现/测试TaskPackage并追加事件和物化投影；先读幂等键，同键同摘要重放并补投影 | 字节未变继承 | [DD03 · 10](../plans/review-2026-10-03/demand-delivery-files.json) |

### src/capabilities/workspace（1）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `maintain-workspace.ts` | 公共维护切片：严格请求、优先修复分支、摘要复算与 next；reconcile：权限模式收敛先于 Demand 候选恢复，静态物化最后 | 字节未变继承 | [WH03 · 1](../plans/review-2026-10-03/hosts-workspace-files.json) |

## Hosts：宿主差异

### src/hosts/claude-code（18）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `claude-code-agent-text-profile.ts` | 九个Claude agent文本占位符与单遍封闭渲染；窗口首次启动/收养/新pane续接/原地续接 | 字节未变继承 | [WH03 · 11](../plans/review-2026-10-03/hosts-workspace-files.json) |
| `claude-code-hook-fragment.ts` | Claude四事件hook参数数组和摘要；同步/异步/超时固定 | 字节未变继承 | [WH02 · 25](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `claude-code-host-asset-operation.ts` | Claude整文件资产的计划与原子发布；同摘要同0600 current | 字节未变继承 | [WH02 · 26](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `claude-code-maintenance-capability.ts` | Claude五类维护操作的闭合分派；portable settings/状态栏资产/tmux资产/statusLine键/窗口投影 | 字节未变继承 | [WH02 · 27](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `claude-code-maintenance-execution.ts` | 固定Claude capability的preview/apply/recover；能力在本文件注入 | 字节未变继承 | [WH02 · 28](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `claude-code-mcp-configuration.ts` | Claude MCP启动配置纯数据；node加CLAUDE_PLUGIN_ROOT server.mjs | 字节未变继承 | [WH02 · 29](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `claude-code-portable-settings-composition.ts` | 为program与managed支撑面计划permissions.allow；外部根排除 | 字节未变继承 | [WH02 · 30](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `claude-code-portable-settings-operation-executor.ts` | 复验单个portable settings操作并执行；authority/config/root/operationDigest一致 | 字节未变继承 | [WH02 · 31](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `claude-code-portable-settings-publication.ts` | 单根portable settings的检查、CAS和stage恢复；.claude目录0700/0755 | 字节未变继承 | [WH02 · 32](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `claude-code-portable-settings-transition.ts` | 保留其他JSON的permissions.allow纯转换；拒绝语法/重复键/非数组/旧宽泛Bash | 字节未变继承 | [WH02 · 33](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `claude-code-statusline-asset-operation.ts` | 状态栏资产描述符与共享资产owner薄适配；固定statusline-asset kind/owner/id/摘要 | 字节未变继承 | [WH02 · 34](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `claude-code-statusline-asset.ts` | 状态栏脚本字节与显式根命令；stdin有界 | 字节未变继承 | [WH02 · 35](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `claude-code-statusline-settings-operation.ts` | 本机settings.local.json的statusLine单键计划/CAS；当前键与0600零写 | 字节未变继承 | [WH02 · 36](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `claude-code-tmux-asset-operation.ts` | tmux助手资产描述符与共享资产owner薄适配；固定tmux-asset kind/owner/id | 字节未变继承 | [WH02 · 37](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `claude-code-tmux-asset.ts` | Agent显式执行的Claude/tmux/Git助手脚本与固定摘要；启动/收养/续接/送前守卫/投递/诊断推动/标记/关闭 | 字节未变继承 | [WH03 · 12](../plans/review-2026-10-03/hosts-workspace-files.json) |
| `claude-code-window-host-identity-profile.ts` | Claude opaque session handle画像；长度1024 | 字节未变继承 | [WH02 · 39](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `claude-code-window-launch-instructions.ts` | Claude启动CLI与tmux纯说明渲染器；worktree意图加--worktree | 字节未变继承 | [WH03 · 13](../plans/review-2026-10-03/hosts-workspace-files.json) |
| `wakeflow-workspace-host-resource-profile.ts` | Claude资源面与tmux launch默认值；settings/资产/locator/keepLive/activityMonitor | 字节未变继承 | [WH02 · 40](../plans/review-2026-10-02/workspace-hosts-files.json) |

### src/hosts/codex（8）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `codex-agent-text-profile.ts` | 九个Codex文本占位符与项目聊天执行约束；按规范外层项目+host解析，project/local创建 | 字节未变继承 | [WH03 · 14](../plans/review-2026-10-03/hosts-workspace-files.json) |
| `codex-hook-fragment.ts` | Codex四种hook定义及确定字节摘要；SessionStart同步5s | 字节未变继承 | [WH02 · 42](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `codex-maintenance-capability.ts` | Codex唯一窗口投影维护贡献；fresh无贡献 | 字节未变继承 | [WH02 · 43](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `codex-maintenance-execution.ts` | 固定Codex capability的维护组合；preview/apply/recover三入口，不接受外部注入其他host | 字节未变继承 | [WH02 · 44](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `codex-process-launch-profile.ts` | Codex Node shell word与MCP启动配置；优先CODEX_MCP_NODE_PATH | 字节未变继承 | [WH02 · 45](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `codex-window-host-identity-profile.ts` | Codex opaque thread handle准入画像；长度1024 | 字节未变继承 | [WH02 · 46](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `codex-window-launch-instructions.ts` | Codex项目聊天与产品执行根的纯说明渲染器；所有角色project/local | 字节未变继承 | [WH03 · 15](../plans/review-2026-10-03/hosts-workspace-files.json) |
| `wakeflow-workspace-host-resource-profile.ts` | Codex资源与启动模板纯数据；windowIdentity/podReceipts有效，locator/settings/tmux禁用 | 字节未变继承 | [WH03 · 16](../plans/review-2026-10-03/hosts-workspace-files.json) |

## Entrypoints：进程与公共装配

### src/entrypoints（12）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `claude-code-wakeflow-maintenance.ts` | Claude维护公共端口装配；固定Claude维护能力与artifactRoot | 字节未变继承 | [WH02 · 12](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `claude-code-wakeflow-mcp.ts` | Claude公共MCP固定组合根；当前Claude执行facade | 字节未变继承 | [WH03 · 3](../plans/review-2026-10-03/hosts-workspace-files.json) |
| `codex-wakeflow-maintenance.ts` | Codex维护公共端口装配；模块装载固定artifactRoot与两个profiles | 字节未变继承 | [WH02 · 14](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `codex-wakeflow-mcp.ts` | Codex公共MCP固定组合根；Codex执行facade | 字节未变继承 | [WH03 · 4](../plans/review-2026-10-03/hosts-workspace-files.json) |
| `wakeflow-artifact-identity.ts` | 从入口realpath固定当前进程的制品根与启动manifest摘要；生成根或已有manifest必须可读且未变 | 字节未变继承 | [WH03 · 5](../plans/review-2026-10-03/hosts-workspace-files.json) |
| `wakeflow-hook-observer.ts` | 宿主hook的有界定位、载荷降级与观察发布；当前版本配置才匹配 | 字节未变继承 | [WH03 · 6](../plans/review-2026-10-03/hosts-workspace-files.json) |
| `wakeflow-mcp-stdio.ts` | 官方stdio的进程关闭边界；SIGINT/SIGTERM/SIGHUP共用closePromise | 字节未变继承 | [WH02 · 18](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-public-mcp-catalog.ts` | 20个公共工具及executor字段的唯一目录；维护preview/apply/recover | 字节未变继承 | [WH03 · 7](../plans/review-2026-10-03/hosts-workspace-files.json) |
| `wakeflow-public-mcp-server-configuration.ts` | 封闭组合根选项与完整executor集合准入；允许可选beforeMutation且必须非Proxy函数 | 字节未变继承 | [WH03 · 8](../plans/review-2026-10-03/hosts-workspace-files.json) |
| `wakeflow-public-mcp-server.ts` | 官方MCP服务根与目录装配；先准入选项，再登记目录 | 字节未变继承 | [WH03 · 9](../plans/review-2026-10-03/hosts-workspace-files.json) |
| `wakeflow-public-mcp-shared-executors.ts` | 固定八个宿主中立executor；demand四项/requirement两项/tasking/evidence | 字节未变继承 | [WH02 · 22](../plans/review-2026-10-02/workspace-hosts-files.json) |
| `wakeflow-public-mcp-tool.ts` | MCP请求准入、写前守卫和公开结果边界；readonly或mode preview或operation inspect跳过guard | 字节未变继承 | [WH03 · 10](../plans/review-2026-10-03/hosts-workspace-files.json) |

## Tooling：源码工具链

### tooling/architecture（1）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `check-dependencies.ts` | 执行dependency-cruiser并检查非零扫描与显式生产根；SWC parser必须实际生效 | 字节未变继承 | [TL02 · 1](../plans/review-2026-10-02/tooling-supplement-files.json) |

### tooling/artifacts（6）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `build-plugin-artifacts.ts` | 从已编译闭包确定性构建双宿主插件；两launcher闭包 | 字节未变继承 | [TL02 · 2](../plans/review-2026-10-02/tooling-supplement-files.json) |
| `check-plugin-artifacts.ts` | committed制品自清单与新构建逐字节一致检查；清单外/缺文件/链接/模式/摘要漂移拒绝 | 字节未变继承 | [TL02 · 3](../plans/review-2026-10-02/tooling-supplement-files.json) |
| `inspect-local-installation.ts` | 对完整制品和版本目录做只读安装预检；候选完整核验，再校验host和版本格式 | 字节未变继承 | [FC03 · 5](../plans/review-2026-10-03/foundation-contracts-tooling-files.json) |
| `plugin-dependency-closure.ts` | 按lockv3展开真实运行依赖并准备vendored文件；deps/peers/已锁optional | 字节未变继承 | [TL02 · 4](../plans/review-2026-10-02/tooling-supplement-files.json) |
| `plugin-metadata.ts` | 唯一版本输入和宿主manifest/package/marketplace模板；semver | 字节未变继承 | [TL02 · 5](../plans/review-2026-10-02/tooling-supplement-files.json) |
| `smoke-plugin-artifacts.ts` | repo外一次性目录真实stdio制品smoke；catalog闭合 | 字节未变继承 | [TL02 · 6](../plans/review-2026-10-02/tooling-supplement-files.json) |

### tooling/codegen（1）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `schema-types.ts` | 严格Schema目录生成TS类型与runtime合同；拒重复JSON键/id/外ref | 字节未变继承 | [TL02 · 7](../plans/review-2026-10-02/tooling-supplement-files.json) |

### tooling/release（1）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `check-release-consistency.ts` | 发布后版本/制品/Node/Git一致性只读门；五源匹配唯一输入 | 字节未变继承 | [TL02 · 8](../plans/review-2026-10-02/tooling-supplement-files.json) |

### tooling/testing（1）

| 文件 | 职责与首项分支 | 本轮依据 | 记录源 |
| --- | --- | --- | --- |
| `run-typescript-tests.ts` | 当前测试源清单到编译文件的精确映射、耗时排程与有界文件并发预算；只收当前.test.ts；拒越界/重复/symlink/缺compiled | 字节未变继承 | [TL02 · 9](../plans/review-2026-10-02/tooling-supplement-files.json) |

[图谱入口](./README.md) · [逐图台账](./01-diagram-review-ledger.md) · [最终来源快照](../plans/review-2026-10-03-rc4/source-baseline-final.json) · [保留的起始快照](../plans/review-2026-10-03-rc4/source-baseline.json)。
