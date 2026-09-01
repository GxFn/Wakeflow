# Wakeflow TypeScript 逐文件审阅台账

> 创建日期：2026-08-28
> 基线提交：`df0eece feat: establish TypeScript technical skeleton`
> 当前状态：`active / file-review-mode / implementation-by-confirmation`
> 当前单元：`Review Resume public vertical slice implemented / verified`
> 上位核实：[TypeScript Technical Skeleton Review Gate](./wakeflow-typescript-technical-skeleton-review-gate-2026-08-28.md)

## 1. 台账职责

本文只记录新版 TypeScript 项目的逐文件审阅事实、建议、用户决定、修改证据和系统级收束结论。它不是需求 authority、任务队列、发布清单或兼容承诺。

后续审阅遵守以下固定规则：

1. 每个单元只指定一至两个手写文件为主要审阅目标。
2. 可以只读更多 consumer、测试、旧 JS、需求文档、TencentDB-Agent-Memory 和外部标准，但不得借机扩大修改范围。
3. 先审阅、后讨论；涉及架构、职责、字段、依赖或行为变化时，用户确认后才能修改。
4. 优先删除冗余分支、无 consumer 表面和重复测试，不以抽象层、class、manager 或配置选项掩盖重复。
5. 标准敏感边界及时查阅官方规范、官方文档和成熟仓库源码；不为每个普通函数进行仪式化搜索。
6. 旧 JS 只提供功能场景、真实 consumer、失败反例与迁移事实，不决定新 TS 的文件结构和技术方案。
7. 单元修改默认只运行精确 focused tests；一个系统完成时再执行 subsystem、architecture、Schema/codegen 和必要集成门。
8. 每个系统节点必须从架构视角复核 owner、authority、producer/consumer、effect、恢复、零 consumer、复杂度和测试成本。

## 2. 审阅结论词汇

| 结论 | 含义 |
| --- | --- |
| `accept` | 职责和实现合理，不修改 |
| `simplify` | 行为正确，但存在可删除的局部复杂度 |
| `fix` | 存在违反当前合同的错误 |
| `split` | 一个文件混合了多个独立 owner |
| `merge` | 多个文件重复拥有同一不变量 |
| `delete` | 无真实 consumer、无保留价值或已被替代 |
| `defer` | 候选有价值，但当前没有足够 consumer/决策证据 |
| `research` | 标准或成熟方案证据不足，不能决定 |

## 3. 系统审阅顺序

```text
Foundation Data
→ Text / Crypto
→ Identity / Time / Numeric / Schema
→ Rooted Filesystem / Atomic / Lock / Tree
→ Artifact / Git / Resource Processing
→ Configuration
→ Workspace Catalog / Matrix / Operation Context
→ Managed Integration / Maintenance
→ TODO / Ledger
→ Demand Event Sourcing
→ Window Runtime Identity / Hosts
→ MCP / Entrypoints / Artifacts / Tooling
```

顺序只冻结系统依赖方向；每个系统内部仍根据风险、扇入和真实 consumer 调整相邻文件组合。

## 4. 审阅索引

| ID | 系统 | 主要文件 | 状态 | 当前建议 |
| --- | --- | --- | --- | --- |
| `FND-DATA-001` | Foundation / Data | `passive-own-data.ts`、`json-value.ts` | implemented / verified | 保留两层设计；采用标准 Unicode well-formed 检查 |
| `FND-DATA-002` | Foundation / Data | `canonical-json.ts`、`deterministic-json-document.ts` | implemented / verified | 保留两种表示与成熟依赖；序列化阶段已闭合无行为边界 |
| `FND-TEXT-001` | Foundation / Text | `utf8.ts`、`base64url.ts` | implemented / verified | 接受 UTF-8；零 consumer 的 base64url 候选已删除 |
| `FND-TEXT-002` | Foundation / Text | `markdown-json-string-literal.ts` | implemented / verified | 保留单一 renderer；GFM pipe 与 Unicode bidi control 边界已闭合 |
| `FND-CRYPTO-001` | Foundation / Crypto | `sha256.ts`、`canonical-json-sha256.ts` | implemented / verified | 保留两层摘要能力；两个零 consumer export 已收窄 |
| `FND-CRYPTO-002` | Foundation / Crypto | `sha256-hasher.ts` | implemented / verified | 保留三态增量 hasher；两个零 consumer 观察面已删除 |
| `FND-IDENTITY-001` | Foundation / Identity | `uuid-v4.ts`、`wakeflow-durable-id.ts` | implemented / verified | 接受生产实现；概率型与重复 Schema 测试已清理 |
| `FND-IDENTITY-002` | Contracts / Identity | `wakeflow-durable-id.ts`、`wakeflow-durable-id-kind.schema.json` | implemented / verified | 业务身份移出 Foundation；active enum 收敛为 10 项 |
| `FND-TIME-001` | Foundation / Time | `utc-instant.ts`、`wall-clock.ts` | implemented / verified | 保留 UTC/clock 设计；两个零 consumer export 已删除 |
| `FND-TIME-002` | Foundation / Time | `monotonic-duration.ts`、`monotonic-clock.ts` | implemented / verified | 保留完整 duration algebra；默认 system source 已私有化 |
| `FND-TIME-003` | Foundation / Time | `monotonic-deadline.ts` | accepted / verified | 接受纯 deadline algebra，不引入 scheduler 或 clock object |
| `FND-NUMERIC-001` | Foundation / Numeric | `byte-count.ts` | implemented / verified | 保留安全整数准入与 checked addition；零 consumer subtraction 已删除 |
| `FND-SCHEMA-001` | Foundation / Schema | `runtime-json-schema.ts` | accepted / verified | 接受隔离本地 Ajv catalog；4 项 direct test 已与声明对齐 |
| `FND-SCHEMA-002` | Tooling / Schema | `schema-types.ts`、`schema-types.test.ts` | implemented / verified | 单一准入快照生成；拒绝重复键；code-unit 排序；安全 runtime Schema 发射 |
| `FND-NODE-001` | Foundation / Node | `node-system-error.ts` | implemented / verified | 已切换 Node 24 `Error.isError()`；只保留 code snapshot API |
| `FND-FS-001` | Foundation / Filesystem | `portable-resource-path.ts`、`file-node-snapshot.ts` | implemented / verified | 接受 path/node 分层；已删除不可达 segment 分支与无效 split 分配 |
| `FND-FS-002` | Foundation / Filesystem | `rooted-directory.ts` | implemented / verified | 保留 handle-backed root class；已收窄零 consumer getters 并修正漂移分类 |
| `FND-FS-003` | Foundation / Filesystem | `rooted-resource-parent-handle.ts` | implemented / verified | 保留 parent descriptor class；已收窄 getters/snapshot 并修正 parent drift 映射 |
| `FND-FS-004` | Foundation / Filesystem | `rooted-exact-resource-handle.ts` | implemented / verified | 保留 exact inode class；已删除零 consumer getters 并修正 alias 映射 |
| `FND-FS-005` | Foundation / Filesystem | `stable-file-read.ts` | implemented / verified | 保留 positioned stable read 内核；已闭合 alias 与 Buffer allocation 错误 |
| `FND-FS-006` | Foundation / Filesystem | `strict-text-file.ts` | implemented | 保留严格 UTF-8 文本 profile；读取 options 唯一归 StableFileRead |
| `FND-FS-007` | Foundation / Filesystem | `deterministic-json-file.ts` | implemented | 保留 lean JSON 文件组合；已删除重复 options 与无条件 raw semantic digest |
| `FND-FS-008` | Foundation / Filesystem | `stable-directory-read.ts` | implemented | 保留双重稳定枚举；已闭合 drift、raw UTF-8 名称与大目录闭包成本 |
| `FND-FS-009` | Foundation / Filesystem | `bounded-directory-tree-scan.ts` | implemented | 保留 complete-or-error tree scan；已修复 expectation alias/替换分类并剪枝 |
| `FND-FS-010` | Foundation / Filesystem | `stable-resource-tree-read.ts` | implemented / verified | 保留 scan→digest→rescan；删除重复总量证明并修正 runtime capacity 分类 |
| `FND-FS-011` | Foundation / Filesystem | `file-byte-range.ts` | implemented / verified | 保留 Managed Text 半开区间核心；已删除 range-reader-only parser/bounds |
| `FND-FS-012` | Foundation / Filesystem | `stable-file-range-read.ts` | deleted / verified | INF-3 后仍为零生产 consumer；源码与 8-case test 已删除 |
| `FND-FS-013` | Foundation / Filesystem | `whole-file-content-transition.ts` | implemented / verified | 保留 whole-owned known-current gate；结果收敛为五个真实消费字段 |
| `FND-FS-014` | Foundation / Filesystem | `durable-atomic-file-stage-address.ts` | implemented / verified | stage format 固定 v1；无行为 filename 准入；test-only ref 移出生产 API |
| `FND-FS-015` | Foundation / Filesystem | `durable-atomic-file-write-contract.ts` | implemented / verified | 保留 expectation/result/error vocabulary；输入 snapshot闭合 Shared/capacity边界 |
| `FND-FS-016` | Foundation / Filesystem | `exact-regular-file-unlink.ts` | implemented / verified | 保留 exact unlink+settlement；null 不再冒充 absent；receipt 去重 link counts |
| `FND-FS-017` | Foundation / Filesystem | `durable-regular-file-settlement.ts` | implemented / verified | 保留 file+parent durability补全；零 consumer result 删除，API 收敛为 void |
| `FND-FS-018` | Foundation / Filesystem | `durable-atomic-file-stage-recovery.ts` | implemented / verified | 保留三种恢复 scope；target lookup降为线性；零 consumer aliases删除 |
| `FND-FS-019` | Foundation / Filesystem | `durable-atomic-file-stage-io.ts` | implemented / verified | 保留 exclusive/write/chmod/fsync/verify 生命周期；闭合 allocation与unlink证明 |
| `FND-FS-020` | Foundation / Filesystem | `durable-atomic-file-target-io.ts` | implemented / verified | 保留 parent/expectation/commit观察；修正 runtime capacity与full snapshot复验 |
| `FND-FS-021` | Foundation / Filesystem | `durable-atomic-file-write.ts` | implemented / verified | 保留 link-create/rename-replace facade；byte verify切换native Buffer compare |
| `FND-FS-022` | Foundation / Filesystem | `rooted-exclusive-file-lock.ts` | implemented / verified | 保留local O_EXCL lock+explicit recovery；移除wall-clock并闭合 options/owner边界 |
| `FND-FS-023` | Foundation / Filesystem | `absolute-directory-placement.ts` | implemented / verified | 保留绝对目录只读准入；present观察改由handle-backed root固定同一节点 |
| `FND-FS-024` | Foundation / Filesystem | `absolute-directory-materialization.ts` | implemented / verified | 保留confirmed绝对位置逐级创建；ancestor搜索降为线性并收窄零consumer类型 |
| `FND-FS-025` | Foundation / Filesystem | `durable-directory-materialization.ts` | implemented / verified | 保留mkdir/chmod/fsync创建内核；删除重复解析、slice分配和零consumer结果类型 |
| `FND-FS-026` | Foundation / Filesystem | `directory-tree-candidate-plan.ts`、`directory-tree-candidate-inspection.ts` | implemented / verified | v1硬上限＋owner收紧；线性闭包、case collision与inspection集合已闭合 |
| `FND-FS-027` | Foundation / Filesystem | `durable-file-candidate.ts` | implemented / verified | 保留具名非权威candidate；对齐64 MiB、安全snapshot、短读与exact cleanup |
| `FND-FS-028` | Foundation / Filesystem | `durable-directory-tree-candidate.ts` | implemented / verified | 保留plan/effect/inspection facade；目录闭包改为逐项exact create并细分冲突 |
| `FND-FS-029` | Foundation / Filesystem | `durable-resource-rename.ts` | implemented / verified | 保留locked cooperative rename；路径先准入、close定位精确并删除重复commit状态 |
| `FND-FS-030` | Foundation / Filesystem | `durable-directory-tree-publication.ts` | implemented / verified | 保留preinspect→rename→postinspect；提交后忽略取消并统一不确定语义 |
| `FND-FS-031` | Foundation / Filesystem | `durable-file-copy-candidate-contract.ts`、`durable-file-copy-candidate.ts` | implemented / verified | 保留caller-bounded streaming copy；闭合allocation/stat/parent与exact cleanup |
| `FND-FS-032` | Foundation / Filesystem | `durable-regular-file-link.ts` | implemented / verified | 保留hard-link no-replace commit；路径/提交后/close语义对齐并精简receipt |
| `FND-ART-001` | Foundation / Artifact | `loaded-artifact-tree-identity.ts` | implemented / verified | 保留file-set v1 identity；补derived-entry、directory collision与空目录明示 |
| `FND-ART-002` | Foundation / Artifact | `loaded-artifact-tree-transfer-plan.ts` | implemented / verified | 保留manifest→copy/tree纯计划；补candidate可遍历mode不变量并收窄类型 |
| `FND-ART-003` | Foundation / Artifact | `loaded-artifact-tree-transfer-candidate.ts` | implemented / verified | 保留source→partial candidate编排；missing dirs exact create并先处理取消 |
| `FND-ART-004` | Foundation / Artifact | `loaded-artifact-tree-transfer-publication.ts` | implemented / verified | 保留current/publish恢复；复用exact tree proof删除重复全树hash/read |
| `FND-GIT-001` | Foundation / Git | `git-ignore-observation.ts`、`git-ignore-candidate-observation.ts` | implemented / verified | 保留官方check-ignore协议；闭合process预算、candidate snapshot与临时根清理 |
| `FND-RES-001` | Foundation / Resource | `resource-processing-contract.ts` | accepted / verified | 保留显式role/recipe/recovery联合；不恢复Owner–Capability Binding或通用dispatcher |
| `FND-ES-001` | Foundation / Event Sourcing | `event-sourcing-version-evolution.ts` | implemented / verified | 保留逐版本read-time upcast；区分step/codec失败并统一稳定路径 |
| `CFG-001` | Configuration | `wakeflow-config-v3.ts`、`wakeflow-config-v3-document.ts` | implemented / verified | 保留Schema→domain→deterministic document；补placement词法与线性indexes |
| `CFG-002` | Configuration + Foundation FS amendment | `wakeflow-config-root-placement.ts`、`absolute-directory-placement.ts` | implemented / verified | missing绑定最近规范祖先；case-fold overlap改为索引＋祖先遍历 |
| `CFG-003` | Configuration | `wakeflow-config-authority-snapshot.ts` | implemented / verified | 绑定strict bytes/model/placements；统一current-user single-link exact 0644策略 |
| `CFG-004` | Configuration | `wakeflow-config-authority-publication.ts` | implemented / verified | 保留absent atomic create＋Snapshot readback；提交后忽略取消并精简receipt |
| `CFG-005` | Configuration | `wakeflow-config-authority-replacement-contract.ts`、`wakeflow-config-authority-replacement.ts` | implemented / verified | 保留lock内CAS replace；提交后忽略取消并移除Publication常量依赖 |
| `CFG-006` | Configuration | `wakeflow-config-authority-replacement-recovery.ts` | implemented / verified | 保留dead-owner显式恢复；直接返回正常replacement receipt并精简surface |
| `CFG-007` | Configuration | `wakeflow-fresh-config-selection.ts`、`wakeflow-config-resource-catalog.ts` | implemented / verified | Fresh先完整snapshot/validate再分配ID；Catalog保持两项真实资源 |
| `WS-DECL-001` | Workspace / Resource Declaration | `workspace-resource-declaration.ts` | accepted / verified | 保留family/root/tracking/node/processing静态联合；零effect与零router |
| `WS-CAT-001` | Workspace / Host Profile-Catalog | `workspace-host-resource-profile.ts`、`workspace-host-resource-catalog.ts` | accepted / verified | host差异只来自严格Profile；共享Catalog零hostId分支、零动态实例 |
| `WS-MATRIX-001` | Workspace / Static Matrix-Operation Context | `wakeflow-workspace-static-resource-matrix.ts`、`wakeflow-workspace-static-resource-operation-context.ts` | implemented / verified | 闭合portable placement拓扑；一次声明＋一项recipe，无router/effect |
| `MI-001` | Workspace / Managed Integration | `wakeflow-managed-text-envelope.ts`、`wakeflow-managed-text-authority-transition.ts` | implemented / verified | 保留byte-exact mixed ownership；删除整文件临时复制与零consumer转换字段 |
| `MI-002` | Workspace / Managed Integration | `wakeflow-gitignore-body-authority.ts` | implemented / verified | 保留双宿主private rule并集；tree按目录pattern处理，Git负责最终语义 |
| `MI-003` | Workspace / Managed Integration | `wakeflow-program-instruction-body-authority.ts` | accepted / verified | Config language＋Host Profile确定正文；用户文本数据化、无旧TS虚假文件声明 |
| `MI-004` | Workspace / Managed Integration | `wakeflow-gitignore-inspection.ts` | implemented / verified | 保留source/envelope/Git双验证；absent跳过无意义current Git并清理概率测试 |
| `MI-005` | Workspace / Managed Integration | `wakeflow-program-instruction-inspection.ts` | implemented / verified | 保留Matrix/Profile/Config/known-language只读gate；区分source/target容量 |
| `MI-006` | Workspace / Managed Integration | `wakeflow-gitignore-recomposition-contract.ts`、`wakeflow-gitignore-recomposition.ts`、`wakeflow-gitignore-recomposition-recovery.ts` | implemented / verified | 锁内create/replace＋Git readback；提交后忽略取消、Recovery先准入options |
| `MI-007` | Workspace / Managed Integration | `wakeflow-program-instruction-recomposition-contract.ts`、`wakeflow-program-instruction-recomposition.ts`、`wakeflow-program-instruction-recomposition-recovery.ts` | implemented / verified | 与Gitignore统一锁/CAS/readback/recovery及提交后取消语义 |
| `MNT-001` | Workspace / Maintenance | `wakeflow-maintenance-operation-id.ts` | accepted / verified | domain-local UUIDv4关联gate/intent/journal，不进入durable entity taxonomy |
| `MNT-002` | Workspace / Maintenance | `wakeflow-static-materialization-preview-contract.ts` | implemented / verified | preview闭合shape、拓扑规范、action/Config关系与稳定错误 |
| `MNT-003` | Workspace / Maintenance | `wakeflow-static-materialization-preview.ts` | implemented / verified | 只读组合真实owner inspection；取消不降级为blocker；producer自验合同 |
| `MNT-004` | Workspace / Maintenance | `wakeflow-host-maintenance-contribution.ts`、`wakeflow-host-maintenance-capability.ts` | implemented / verified | 被动JSON contribution＋单一in-memory host port；删除不可复验摘要与无行为receipt tag |
| `MNT-005` | Workspace / Maintenance | `wakeflow-maintenance-execution-plan.ts` | implemented / verified | 从shared preview＋host contribution唯一重建；宿主DAG线性化并移除测试专用lookup API |
| `MNT-006` | Workspace / Maintenance | `wakeflow-maintenance-execution-preview.ts` | implemented / verified | 零写入组合shared plan与单Host contribution；修正reconcile缺失与取消语义 |
| `MNT-007` | Workspace / Maintenance | `wakeflow-maintenance-confirmation.ts` | implemented / verified | ready plan＋exact request＋Fresh launch intents确认；删除重复action与Profile基数 |
| `MNT-008` | Workspace / Maintenance | `wakeflow-maintenance-public-contract.ts`、Maintenance request/result Schemas | implemented / verified | 三种闭合请求＋4MiB准入；修正MCP摘要词法与结果判别关系 |
| `MNT-009` | Workspace / Maintenance | `wakeflow-maintenance-public-coordinator.ts`、`wakeflow-maintenance-public-host-facade.ts` | implemented / verified | 固定Facade快照＋生成Schema输出验证＋精确私有值防泄漏 |
| `MNT-010` | Workspace / Maintenance | `wakeflow-maintenance-execution-intent.ts`、Intent v1 Schema | implemented / verified | immutable恢复闭包；一次准入重建plan/request；持久v1保留二宿主基数 |
| `MNT-011` | Workspace / Maintenance | `wakeflow-maintenance-execution-intent-store.ts` | implemented / verified | 0600 absent-only lifecycle；精简source/publication表面并修正post-commit分类 |
| `MNT-012` | Workspace / Maintenance | `wakeflow-maintenance-journal.ts`、Journal v1 Schema | implemented / verified | 单调checkpoint而非Event Sourcing；收紧状态关系与step identity预算 |
| `MNT-013` | Workspace / Maintenance | `wakeflow-maintenance-journal-store.ts` | implemented / verified | 0600 create/CAS/retire生命周期；source返回统一、容量前置与post-commit分类 |
| `MNT-014` | Workspace / Maintenance | `wakeflow-maintenance-gate.ts`＋gate-bound preview revalidation | implemented / verified | exact lock、Core bootstrap重验与锁内完整plan CAS；关闭pre-lock TOCTOU |
| `MNT-015` | Workspace / Maintenance | `wakeflow-maintenance-execution-transaction.ts` | implemented / verified | 双重plan CAS＋Intent/Journal单调事务；统一取消、错误恢复指针与receipt判别 |
| `MNT-016` | Workspace / Maintenance | `wakeflow-maintenance-orphan-gate-recovery.ts`、`wakeflow-prepared-maintenance-recovery.ts` | implemented / verified | 明确区分pre-intent orphan与checkpoint-0 cancellation；保留显式运维恢复 |
| `MNT-017` | Workspace / Maintenance | `wakeflow-maintenance-resource-catalog.ts`、`wakeflow-workspace-core-layout-inspection.ts` | implemented / verified | 五项私有资源＋Active/Local稳定分类；修正Lock错误映射并收窄exports |
| `MNT-018` | Workspace / Maintenance | `wakeflow-static-materialization-step-executor.ts` | implemented / verified | 12种shared step闭合dispatcher；options前置、错误/close语义与exhaustive分派 |
| `TODO-001` | Governance / TODO | `todo-item-id.ts`、`todo-paths.ts` | implemented / verified | 可读opaque ID与SHA-256 storage key分离；key品牌化并补词法边界 |
| `TODO-002` | Governance / TODO | `todo-resource-catalog.ts` | implemented / verified | 静态Catalog接入Matrix；动态Item Catalog已由Transaction Storage执行recipe admission |
| `TODO-003` | Governance / TODO | `todo-intake-lineage.ts`、`todo-intake.ts` | implemented / verified | immutable intake与exact lineage；先准入草稿再读取clock，关闭跨ID路径别名 |
| `TODO-004` | Governance / TODO | `todo-state.ts` | implemented / verified | mutable snapshot CAS链；Archive授权与revision先准入、Clock最后读取 |
| `TODO-005` | Governance / TODO | `todo-transaction.ts` | simplified / verified | append/claim/archive immutable recovery plan；嵌套领域错误统一target分类 |
| `TODO-006` | Governance / TODO | `todo-collection.ts`、`todo-board-projection.ts` | implemented / verified | 唯一排序快照＋单向Markdown投影；去重状态并关闭GFM注入边界 |
| `TODO-007` | Governance / TODO | `todo-collection-authority.ts` | implemented / verified | 有界稳定tree→JSON authority；线性分组、16项批读与最终树复验 |
| `TODO-008` | Governance / TODO | `todo-collection-initialization-authority.ts`、`todo-collection-initialization.ts` | implemented / verified | 空集合唯一authority；Foundation目录receipt关闭strict-absent竞态 |
| `TODO-009` | Governance / TODO | `todo-collection-transaction-storage.ts` | implemented / verified | Journal前向恢复＋exact target stages；Catalog recipe admission与retirement-last commit |
| `TODO-010` | Governance / TODO | `todo-collection-service.ts`、`todo-collection-service-error.ts` | implemented / verified | 公共owner以Collection Lock串行所有写入与初始化；稳定只读保持lock-free观察 |
| `TODO-SYSTEM` | Governance / TODO | producer/consumer、状态合同、真实垂直消费者 | closed / verified | v1只保留四个owner状态；技术闭环完成，公开MCP与调度业务明确后置 |
| `LEDGER-001` | Governance / Ledger | `ledger-authority-layout.ts`、`ledger-authority-paths.ts` | simplified / verified | 三容器布局＋typed record路径；事务文件名不再重复编码family |
| `LEDGER-002` | Governance / Ledger | `ledger-authority-storage-policy.ts`、`ledger-resource-catalog.ts` | simplified / verified | 单一权限/容量矩阵；动态Catalog已接入真实发布effect admission |
| `LEDGER-003` | Governance / Ledger | `ledger-record-publisher.ts`、`ledger-record-publication-storage.ts` | implemented / verified | 锁内exact Intent stage恢复＋Catalog admission；跨记录stage互不阻断 |
| `LEDGER-004` | Governance / Ledger | `ledger-authority-record.ts`、Requirement/Confirmation Schemas | implemented / verified | immutable事实＋closed document inventory；先准入草稿再读取Clock |
| `LEDGER-005` | Governance / Ledger | `ledger-record-publication-intent.ts`、Intent Schema | simplified / verified | self-contained compact recovery plan；删除record已包含的family/recordId副本 |
| `LEDGER-006` | Governance / Ledger | `ledger-authority-store-contract.ts`、`ledger-authority-reader.ts` | implemented / verified | stable closed-tree reader＋family-discriminated member reference；Schema关闭组合关系 |
| `LEDGER-007` | Governance / Ledger | `ledger-authority-store.ts`、`ledger-record-publication-recovery.ts` | implemented / verified | root-scoped facade＋evidence-first recovery；结果统一为wroteAuthority |
| `LEDGER-SYSTEM` | Governance / Ledger | owner/authority/publication/reference/Demand consumers | closed / verified | Requirement/Confirmation技术闭环完成；Archive与public intake按真实业务后置 |
| `DEMAND-001` | Governance / Demand | `model/demand-identity.ts`、Identity Schema | implemented / verified | immutable aggregate identity；草稿完整准入后恰好读取一次Clock |
| `DEMAND-002` | Governance / Demand | `model/demand-authority.ts`、Authority Schema | implemented / verified | required Ledger role closure＋testing/placement；isolated ref改为逐字段exact关系 |
| `DEMAND-003` | Governance / Demand | `model/demand-aggregate-state.ts`、Aggregate State Schema | simplified / verified | reducer-only最小状态；删除无completion事件producer的completed占位 |
| `DEMAND-004` | Governance / Demand | `demand-event-stream-position.ts`、`demand-event-sourcing-paths.ts` | implemented / verified | 逻辑/物理位置统一下沉；commit/candidate filename形成闭合可逆词汇 |
| `DEMAND-005` | Governance / Demand | `demand-event-sourcing-event.ts`、`demand-event-sourcing-event-version-codec.ts` | simplified / verified | uncommitted business facts＋per-family v1 codec；不携带持久位置 |
| `DEMAND-006` | Governance / Demand | `demand-event-sourcing-state-version.ts`、`demand-event-sourcing-version-compatibility.ts` | simplified / verified | state/event支持矩阵唯一派生Snapshot compatibility digest |
| `DEMAND-007` | Governance / Demand | `demand-event-sourcing-persisted-event-envelope.ts`、`demand-event-sourcing-upcaster.ts` | simplified / verified | 跨版本Envelope与当前domain projection分层；未知版本延迟到Registry拒绝 |
| `DEMAND-008` | Governance / Demand | `demand-event-sourcing-stored-event.ts`、Stored Event Schema | simplified / verified | 当前版本writer与Envelope稳定错误门面；删除重复upcast别名 |
| `DEMAND-009` | Governance / Demand | `demand-event-stream-commit.ts`、Commit Schema | implemented / verified | one-command immutable batch＋previous digest chain＋in-process prepared capability |
| `DEMAND-010` | Governance / Demand | `demand-event-sourcing-aggregate.ts`、`demand-event-sourcing-decider.ts` | simplified / verified | cursor/tail aggregate＋pure command→event→state；无持久化职责 |
| `DEMAND-011` | Governance / Demand | `demand-event-sourcing-command-handler.ts` | implemented / verified | required expected revision＋bounded idempotency lookup＋pre-I/O cancellation |
| `DEMAND-012` | Governance / Demand | `demand-event-sourcing-snapshot.ts`、Snapshot Schema | simplified / verified | deletable compatible checkpoint；删除重复aggregateVersion并关闭cursor关系 |
| `DEMAND-013` | Governance / Demand | `demand-file-event-store-contract.ts`、`demand-file-event-store-reader.ts` | implemented / verified | private stable stream reader＋bounded deterministic concurrency＋branded cursor |
| `DEMAND-014` | Governance / Demand | `demand-file-event-store.ts` | implemented / verified | candidate→durable hard-link commit＋inactive recovery；Catalog进入真实effect |
| `DEMAND-015` | Governance / Demand | `demand-file-event-snapshot-store.ts` | implemented / verified | immutable no-replace checkpoints＋invalid fallback；写前容量与Catalog admission闭合 |
| `DEMAND-016` | Governance / Demand | `demand-event-sourcing-root-inventory.ts`、`demand-event-sourcing-root-authority.ts` | implemented / verified | stable closed root＋Ledger-resolved authority＋revision-1 publication closure |
| `DEMAND-017` | Governance / Demand | `demand-event-sourcing-repository.ts` | implemented / verified | single-root Event/Snapshot composition＋snapshot-tail load/full audit分离 |
| `DEMAND-018` | Governance / Demand | `demand-resource-catalog.ts` | simplified / verified | static publication roots＋typed Demand/Commit/Snapshot declarations；动态effect逐步接入 |
| `DEMAND-019` | Governance / Demand | `publication/demand-publication-paths.ts`、Publication Contract | simplified / verified | root/stage/sidecar/lock/marker固定路径＋wroteDemandRoot精确结果语义 |
| `DEMAND-020` | Governance / Demand | `demand-event-sourcing-publication-transaction.ts`、Transaction Schema | implemented / verified | self-contained immutable cross-resource plan；纯Commit计划不签发append capability |
| `DEMAND-021` | Governance / Demand | Publication Storage、Publication Stage | implemented / verified | targeted sidecar recovery＋Catalog-admitted root transaction＋durable rename/close semantics |
| `DEMAND-022` | Governance / Demand | Publication Service、Publication TODO bridge | implemented / verified | zero-write preflight＋sidecar-authorized TODO recovery＋root-first forward transaction |
| `DEMAND-SYSTEM` | Governance / Demand | Event Sourcing＋File Store＋Publication＋TODO/Ledger consumers | closed / verified | publish/cancel技术闭环；未实现业务区段保持不存在 |
| `WINDOW-001` | Workspace / Window Runtime | `wakeflow-window-host-binding-id.ts`、`wakeflow-window-runtime-paths.ts` | simplified / verified | local generation ID＋host-explicit binding/projection paths；磁盘路径不变 |
| `WINDOW-002` | Workspace / Window Runtime | `wakeflow-window-host-identity-profile.ts` | simplified / verified | opaque handle lexical policy；reserved set严格唯一排序且不授予host能力 |
| `WINDOW-003` | Hosts / Identity | Codex/Claude Window Host Identity Profiles | simplified / verified | 两宿主只声明opaque handle kind/limit/reserved placeholders |
| `WINDOW-004` | Workspace / Window Runtime | Desired Topology、Launch Intent | simplified / verified | single-pass Config indexes＋shared static window cap＋host effect/registration分离 |
| `WINDOW-005` | Workspace / Window Runtime | Fresh Authority、Projection Resource Catalog | implemented / verified | exact layout/projection authority；declaration与projection逐项关系闭合 |
| `WINDOW-006` | Workspace / Window Runtime | `wakeflow-window-runtime-fresh-publication.ts` | implemented / verified | strict-absent/affected recovery＋Catalog-admitted bounded projection publication |
| `WINDOW-007` | Workspace / Window Runtime | Unregistered Identity Source、Unregistered Projection＋Schema | simplified / verified | 删除伪空目录source；未注册状态只从Desired Topology派生，物理空目录证据归Fresh Publication |
| `WINDOW-008` | Workspace / Window Runtime | `wakeflow-window-host-binding.ts`＋Binding Schema | simplified / verified | Host Profile成为Binding codec必需上下文；跨层只公开bindingId/ref，不发布raw-handle摘要 |
| `WINDOW-009` | Workspace / Window Runtime | Binding Registration Authority、Registration | implemented / verified | 稳定注册身份幂等＋首次审计时间保留；Binding先提交、Projection前向恢复 |
| `WINDOW-010` | Workspace / Window Runtime | Binding Store、Binding Resource Catalog | implemented / verified | 完整私有inventory＋全宿主唯一handle；不可变快照、Clock-before-ID、no-replace commit |
| `WINDOW-011` | Workspace / Window Runtime | Registered Projection、Registered Projection Publication | simplified / verified | profile/binding/topology关系闭合；missing/unregistered/current/foreign来源显式分流 |
| `WINDOW-012` | Workspace / Window Runtime | Binding Public Contract、Public Coordinator＋MCP Schemas | simplified / verified | fixed Host facade＋self-contained MCP Schema＋redacted typed receipt |
| `WINDOW-SYSTEM` | Workspace / Window Runtime＋Hosts＋MCP consumer | Fresh初始化＋首次typed Binding注册闭环 | closed / verified | 唯一私有handle authority＋可重建脱敏projection；未实现业务保持不存在 |
| `MCP-001` | Entrypoints / MCP | Public MCP Server、Codex/Claude composition roots | simplified / verified | official SDK＋两个真实owner；options一次快照、双宿主只在composition注入 |
| `MCP-002` | Entrypoints / MCP | `wakeflow-mcp-stdio.ts` | implemented / verified | official serveStdio＋programmatic/signal统一幂等关闭＋稳定stderr |
| `ARTIFACT-001` | Tooling / Artifacts | TypeScript Artifact Candidate Builder＋test | simplified / verified | static ESM closure＋exact dependencies＋dual-host isolation＋deterministic manifest/modes |
| `TOOL-TEST-001` | Tooling / Testing | TypeScript test runner＋focused test | implemented / verified | current source manifest only＋real ancestor chains＋no stale compiled test execution |
| `TOOL-ARCH-001` | Tooling / Architecture | Dependency checker＋dependency-cruiser rules | implemented / verified | nonzero SWC scan＋foundation/identity/effect/host/composition机器边界 |
| `TECHNICAL-REVIEW-GATE` | 全部当前 TypeScript 技术骨干 | 逐文件台账＋系统门＋双宿主候选 | closed / verified | 685 TS tests全绿；在真实业务扩展前按约定暂停核实 |

## 5. FND-DATA-001

### 5.1 目标文件

- `src/foundation/data/passive-own-data.ts`
- `src/foundation/data/json-value.ts`

审阅阶段只读了直接测试、代表性生产 consumers、旧 canonical JSON、Foundation review 结论、TencentDB-Agent-Memory 对应实践和外部规范；用户确认后，仅按 5.7 修改了 `json-value.ts`，没有修改 `passive-own-data.ts` 或增加测试。

### 5.2 真实职责与消费者

`passive-own-data` 拥有浅层、无副作用的 JavaScript 自有数据读取：

- closed plain/null-prototype record snapshot；
- projected own-data property snapshot；
- standard dense array snapshot；
- Proxy、accessor、hidden、Symbol、extra/sparse array authority 拒绝；
- 无原型或标准数组浅冻结副本；
- 中立原因与 JSON Pointer 风格路径，不解释领域字段。

`json-value` 在其上拥有完整递归的 Wakeflow JSON 数据树准入：

- JSON primitive、plain object、standard dense array；
- detached recursive copy 与 recursive freeze；
- cycle 与 maximum depth；
- finite IEEE-754 number、negative-zero rejection；
- well-formed Unicode、lone-surrogate rejection；
- repeated non-cyclic reference 按 JSON value semantics 独立复制。

当前生产依赖图：

| 文件 | 直接 `src` dependents | 代表性 consumer |
| --- | ---: | --- |
| `passive-own-data.ts` | 93 | `json-value`、file-node snapshot、atomic contracts、Config、TODO、Demand、Maintenance、Host adapters |
| `json-value.ts` | 55 | canonical JSON、deterministic JSON、runtime Schema、Config records、Event Sourcing、projections、public contracts |

这两个文件属于最高扇入基础边界，不是测试 helper 或待消费候选。

### 5.3 旧 JS 对照

旧 `wakeflow-canonical-json.mjs` 在一个递归函数中同时负责：

- own descriptor 准入；
- JSON value 判断；
- cycle/depth；
- object key 排序；
- JSON 文本、UTF-8 与 SHA-256。

新版把它拆成：

```text
passive-own-data
  → json-value
      → canonical-json / deterministic-json-document
          → digest / file / domain owner
```

该拆分是正确的：Buffer、callback、host facade 等浅层非 JSON 输入可以复用 `passive-own-data`，而 JSON canonicalizer 不再拥有运行时 facade 语义。Accessor、hidden、Symbol、sparse、foreign prototype、cycle、depth 和输入自有 `toJSON` 的准入场景均已保留；`FND-DATA-002` 随后发现 inherited `toJSON` 在序列化阶段存在回归，不能把它记作本单元已闭合。

### 5.4 TencentDB-Agent-Memory 对照

腾讯项目主要采用两种路线：

- API/wire shape 使用 Zod，例如 `MemoryCore/src/gateway/v2-schemas.ts`；
- 内部 checkpoint 默认树使用 `structuredClone`，例如 `MemoryCore/src/utils/checkpoint.ts`。

它没有实现与 Wakeflow 相同的“对任意进程内对象执行 getter/proxy 零调用”基础能力。实测当前依赖版本：

```text
structuredClone getter calls: 1
Zod object.parse getter calls: 1
JSON.stringify toJSON calls: 1
```

因此可学习腾讯项目“Schema 负责 wire shape、clone 负责内部可信状态”的分层，但不能用 Zod 或 `structuredClone` 替换 Wakeflow 的 hostile in-process boundary。

### 5.5 外部标准事实

- Node 官方提供 [`util.types.isProxy`](https://nodejs.org/api/util.html#utiltypesisproxyvalue)，适合在任何会触发代理陷阱的反射操作前拒绝 Proxy。
- WHATWG structured clone 对普通对象枚举属性并读取成员值；它不是无 getter 执行的 admission primitive：[HTML structured data](https://html.spec.whatwg.org/multipage/structured-data.html)。
- ECMAScript `JSON.stringify` 的 `SerializeJSONProperty` 会先 `Get(holder, key)`，再读取并调用 `toJSON`：[ECMAScript JSON.stringify](https://tc39.es/ecma262/2024/multipage/structured-data.html#sec-json.stringify)。
- Zod 官方只承诺验证并返回 deep clone，没有 getter-zero 安全合同：[Zod basic usage](https://zod.dev/basics)。
- RFC 8785 要求 lone surrogate 失败、保留原始 Unicode、不接受 NaN/Infinity；verified erratum还建议对会 canonicalize 成 `0` 的负零报错：[RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html)、[Errata 7920](https://www.rfc-editor.org/errata/eid7920)。
- Node 24 使用的 ECMAScript 已提供标准 [`String.prototype.isWellFormed`](https://tc39.es/ecma262/2024/multipage/text-processing.html#sec-string.prototype.iswellformed)。

### 5.6 架构审阅结论

| 项目 | 结论 | 理由 |
| --- | --- | --- |
| 两文件是否应合并 | `accept separation` | 浅层非 JSON facade 与递归 JSON tree 是不同输入域和 consumer |
| 是否改用 Zod | `reject replacement` | Zod 适合 shape，但会读取成员；不能保证行为执行次数为零 |
| 是否改用 `structuredClone` | `reject replacement` | 支持更宽类型、cycle，并读取 getter；与合同不符 |
| 是否创建 `StrictData` class/manager | `reject abstraction` | 两层均为无状态纯函数，没有生命周期或实例状态 |
| Proxy 前置拒绝 | `accept` | Node 原生能力 + trap-zero tests，顺序正确 |
| null-prototype record snapshot | `accept` | 安全处理 `__proto__`/`constructor`，避免继承行为进入后续层 |
| standard dense array policy | `accept` | 与当前 Node/MCP/record 输入一致；跨 realm 数组不是当前需求 |
| negative zero rejection | `accept` | 避免 `-0` 与 `0` 映射到同一 JCS bytes；符合 verified JCS erratum |
| lone surrogate rejection | `accept` | JCS 明确要求失败 |
| 固定 depth 128 | `accept safety ceiling` | 阻止递归栈失控；更小领域预算仍由 consumer 拥有 |
| 总 node/property budget | `defer to system review` | 外部 bytes/collection capacity 应由 MCP/file/domain owner前置；当前不增加通用 options |
| property selection 的完整被动校验 | `accept for now` | 虽然5个生产调用均传静态常量，但公开函数仍承诺任意参数不执行行为；删除会削弱合同或引入picker factory |

### 5.7 已确认修改

`json-value.ts` 的 `containsLoneSurrogate()` 手写了 UTF-16 surrogate walker。Node 24 / ES2024 已有标准 `String.prototype.isWellFormed()`，项目其他模块也已经使用该 API。

用户确认采用以下简化：

- 删除 `containsLoneSurrogate()`；
- 字符串值与对象 key 统一改为 `!value.isWellFormed()`；
- 保持 `lone-surrogate` reason、路径、深度、复制、冻结和全部测试不变；
- 不新增 helper、依赖或测试文件。

这是 `simplify`，不是 bug 修复。实现已删除约 15 行自维护 Unicode walker，未改变错误分类、路径、深度、复制和冻结合同，也未增加 helper、依赖或测试文件。

### 5.8 测试审阅

当前两个 focused 文件包含20项测试，基线：

```text
20 pass / 0 fail / 0 skip / 60.374584ms
```

覆盖与合同一一对应，没有发现 stale fixture、重复 golden、跨系统集成或应删除的旧行为测试。`property-selection` 的恶意 selector cases 看似偏多，但它们正是公开函数“不执行行为”合同的唯一直接证据，当前不建议删除。

现有 string/key surrogate tests 已足够，因此没有增加测试。修改后重跑本单元与相邻 canonical/deterministic JSON tests：

```text
32 pass / 0 fail / 0 skip / 116.896167ms
```

聚焦命令同时通过 TypeScript project build。

### 5.9 单元结论

`FND-DATA-001` 已完成：

- `passive-own-data` 与 `json-value` 两层职责保持不变；
- 唯一局部复杂度已按用户确认删除；
- 未发现应删除的生产分支或测试；
- 聚焦与相邻测试全部通过。

下一审阅单元为 `canonical-json.ts + deterministic-json-document.ts`。

## 6. FND-DATA-002

### 6.1 目标文件

- `src/foundation/data/canonical-json.ts`
- `src/foundation/data/deterministic-json-document.ts`

审阅阶段只读了直接测试、代表性生产 consumers、旧 JS、当前 `canonicalize` 依赖源码、TencentDB-Agent-Memory 对照以及 RFC/ECMAScript 官方规范；用户确认后，按 6.6 的方案 A 修改了两份生产文件及其现有测试。

### 6.2 两种表示与真实消费者

`canonical-json` 拥有机器语义表示：

- 对任意输入重新执行 `JsonValue` 准入；
- 通过 `canonicalize@4.0.0` 生成 RFC 8785/JCS 文本；
- 输出无空白、无末尾换行的文本或独立 UTF-8 字节；
- 映射并脱敏依赖异常；
- 不拥有 SHA-256、文件格式或领域字段关系。

它有 5 个直接生产 dependents、12 个生产调用，主要用于 SHA-256、MCP 响应、公开合同和结构比较。

`deterministic-json-document` 拥有人类可读的持久化表示：

- 2 空格缩进、LF、末尾恰好一个 LF；
- 解析后重新渲染，拒绝重复键和表示漂移；
- 保留领域 owner 已构造的 ECMAScript 自有键顺序；
- 不拥有领域字段排序、Schema、文件原子性或语义摘要。

它有 31 个直接生产 dependents、42 个生产调用，覆盖 Config、file lock、TODO、Ledger、Demand Event Sourcing、Maintenance 和 Window Runtime 持久记录。领域 parser 会再按自身模型渲染并比较原文，因此基础 parser 不会冒充领域字段顺序 authority。

两者不能合并：Canonical JSON 面向哈希/比较，确定性格式化文档面向可读、可审查的本地持久化；它们的空白、键顺序和消费目的不同。

### 6.3 标准、依赖与腾讯项目事实

- [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html) 要求递归 UTF-16 键排序、原始 Unicode 保留、ECMAScript primitive serialization 和 UTF-8 输出；附录 G 明确列出 npm `canonicalize` 为兼容实现。
- 当前 npm registry 的 latest 是项目已锁定的 `canonicalize@4.0.0`。其[官方实现](https://github.com/erdtman/canonicalize/blob/master/lib/canonicalize.js)有意读取并调用 `value.toJSON`；这是 JCS/ECMAScript 支持 subtype 的语义，不是依赖异常。
- ECMAScript `JSON.stringify` 的 `SerializeJSONProperty` 同样会先读取并调用可调用的 `toJSON`：[ECMAScript JSON.stringify](https://tc39.es/ecma262/2024/multipage/structured-data.html#sec-json.stringify)。
- ECMAScript ordinary key order 并非任意插入顺序：数组索引键先按数值升序，其他字符串键才按创建顺序：[OrdinaryOwnPropertyKeys](https://tc39.es/ecma262/2024/multipage/ordinary-and-exotic-objects-behaviours.html#sec-ordinaryownpropertykeys)。
- 对照的另一成熟 TypeScript 包 `json-canonicalize` 也读取 `object.toJSON`，且默认行为带有 RFC 差异；单纯换包不能解决 Wakeflow 的严格合同。
- TencentDB-Agent-Memory 的 checkpoint、state、manifest 和 JSONL 主要直接使用 `JSON.stringify`，没有 JCS 或 hostile in-process serialization boundary。可学习其“用途直接对应表示”的简洁性，但不能复制为 Wakeflow authority/digest 的安全边界。

### 6.4 已确认的合同回归

`parseJsonValue` 会把对象快照转换为 `null` 原型，但数组按明确合同保留标准 `Array.prototype`。两份被审文件随后分别调用第三方 canonicalizer 和原生 `JSON.stringify`，因此仍会查找标准数组继承链上的 `toJSON`。

隔离探针在不改变输入数组的情况下得到：

```json
{
  "canonical": "\"forged\"",
  "document": "\"forged\"\n",
  "canonicalCalls": 1,
  "documentCalls": 1
}
```

这会让合法 `[true]` 静默变成字符串 `"forged"`，影响 canonical digest、MCP 输出和本地持久记录。旧 JS 明确用容器手写遍历避免再次把纯数据树交给 `JSON.stringify`，对应测试还要求 inherited hooks 下继续得到原值且调用次数为零。

当前 TS canonical 测试把抛异常的 `Array.prototype.toJSON` 归为“依赖失败”，只断言错误脱敏，没有断言 hook 调用次数；deterministic 测试完全没有 inherited hook 场景。因此现有 12 项测试全绿仍掩盖该回归。

结论为 `fix / P1 contract regression`。本质不是 `canonicalize` 实现错误，而是 Wakeflow 适配器把“已准入 JSON 数据”错误等同于“可安全交给拥有 `toJSON` 语义的 serializer”。

### 6.5 其余审阅结论

| 项目 | 结论 | 理由 |
| --- | --- | --- |
| 两种表示是否合并 | `reject merge` | 机器 canonical bytes 与可读磁盘文本是不同合同 |
| 是否删除 `canonicalize` | `reject` | 当前版本成熟、无运行时依赖、由 RFC 列举；数值/字符串/JCS 排序继续交给它更稳妥 |
| 是否换 `json-canonicalize` | `reject` | 同样读取 `toJSON`，默认还有额外非 JCS 行为与选项表面 |
| 是否创建 serializer class/manager | `reject` | 无状态、无生命周期；纯函数适配足够 |
| 是否增加通用格式选项 | `reject` | 会混合 canonical、pretty 和领域表示 authority |
| duplicate key round-trip | `accept` | 基础层准确拒绝表示漂移，领域 owner 再验证自己的字段顺序 |
| `render-failure` / `canonicalizer-failure` | `accept` | 可承载环境/依赖不变量失败，无需扩展公共错误 union |
| “领域插入顺序”措辞 | `fix documentation` | 应准确写为 ECMAScript 自有字符串键顺序，并说明数组索引键规则；不改变文件格式 |

### 6.6 真实备选方案

**A．描述符预检并 fail closed（已确认、已实现）**

在两份现有文件各保留一个很小的私有预检：调用 serializer 前仅通过 property descriptor 验证标准数组原型链仍为 `Array.prototype → Object.prototype → null`，且 `Array.prototype` / `Object.prototype` 没有自有 `toJSON`。不读取属性值、不调用 hook；不满足时分别返回现有 `canonicalizer-failure` / `render-failure`。

- 优点：保留成熟 JCS 依赖与原生 pretty renderer；不修改全局原型；不新增模块、依赖、配置或公共 API；避免静默内容替换。
- 代价：非标准全局原型环境中会拒绝全部序列化，而不是像旧 JS 一样继续成功；这是明确的 availability fail-closed。
- 代码/测试：两处局部 guard；改写现有 canonical 失败测试并扩展现有 deterministic 行为测试，各自同时覆盖 Object/Array prototype，断言调用次数为零。测试数量无需增加。

**B．建立无行为 serialization clone**

准入后再递归复制一份内部树，为每个数组遮蔽继承的 `toJSON`，然后交给现有 serializers。

- 优点：原型被扩展时仍可成功，接近旧 JS 的 availability。
- 代价：每次多一次完整树复制；隐藏属性必须与第三方实现细节保持兼容；会产生新的内部表示和更高维护成本。

**C．改回自维护容器 serializer**

仅对 primitive 调用原生 `JSON.stringify`，对象和数组都由 Wakeflow 遍历；Canonical 模式排序，pretty 模式缩进。

- 优点：能完全控制行为执行边界。
- 代价：重新拥有 RFC 8785 和 pretty serializer 的核心维护责任，撤销此前采用成熟依赖的决定；换另一成熟 JS 包也不能天然消除 `toJSON`。

### 6.7 测试审阅

当前两个 focused 文件共 12 项，基线：

```text
12 pass / 0 fail / 0 skip / 66.334375ms
```

除 inherited `toJSON` 缺口外，RFC 示例、UTF-16 排序、golden bytes/digest、UTF-8、输入准入、表示 profile、重复键和漂移均与合同对应。没有 stale fixture 或重复 golden；推荐把现有错误测试改正而不是追加一组新测试。测试标题 `domain insertion order` 同步改成准确的 ECMAScript key-order 描述。

### 6.8 用户决定与实现证据

用户确认采用 A。实现结果：

- 两份生产文件各增加一个私有 `assertNoInheritedArrayToJson()`；
- 调用 serializer 前验证 `Array.prototype → Object.prototype → null`，并通过 descriptor 检查两个标准 prototype 都不存在自有 `toJSON`；
- 检查不读取属性值、不执行 hook，也不修改任何全局对象；
- 非标准环境分别使用既有 `canonicalizer-failure` / `render-failure` fail closed；
- 保留 `canonicalize@4.0.0`、原生 pretty renderer、公开 API 和错误 union；
- 修正确定性文档注释及测试标题为 ECMAScript 自有键顺序；
- 改写原 canonical 失败测试、扩展原 deterministic 行为测试，测试总数仍为 12。

修复后的隔离探针：

```json
{
  "canonicalError": "canonicalizer-failure",
  "canonicalCalls": 0,
  "documentError": "render-failure",
  "documentCalls": 0
}
```

验证结果：

```text
目标双文件：12 pass / 0 fail / 0 skip / 73.188666ms
相邻四文件：32 pass / 0 fail / 0 skip / 113.649083ms
TypeScript project build: pass
```

本单元没有新增模块、依赖、配置、公共 API 或测试项；P1 合同回归已闭合。

## 7. Foundation Data 系统节点收束

### 7.1 最终依赖与职责

```text
unknown in-process input
  → passive-own-data
      浅层、自有、描述符驱动、零行为执行
  → json-value
      递归 JSON 数据域、独立副本、递归冻结
      ├─ canonical-json
      │    RFC 8785 机器语义文本 / UTF-8 bytes
      └─ deterministic-json-document
           可读、严格表示的本地 JSON 文档
```

四个文件各有一个明确 owner，依赖单向；Canonical JSON 与确定性格式化文档没有共享错误 authority 或格式选项。没有全局 manager、service locator、实例状态或第二 serializer facade。

### 7.2 架构检查

| 检查项 | 结论 |
| --- | --- |
| producer / consumer | 所有四个模块均有真实生产 consumer；`json-value` 和 deterministic document 为高扇入边界 |
| state / effect | 全部为同步纯转换；没有文件、网络、时钟或全局 mutation |
| authority | 基础层只拥有 JavaScript/JSON/表示不变量；领域字段、容量、摘要、文件耐久性均留给上层 owner |
| error boundary | 每层只映射自己的稳定错误；下层路径精度保留，第三方异常脱敏 |
| redundancy | 没有等价 production owner；两个 serializer 各保留一个私有 `toJSON` 预检，只有出现第三个真实 consumer 时才考虑提取 |
| tests | 4 个 focused 文件共 32 项，合同覆盖清晰；没有 stale fixture、重复 golden 或跨系统大集成 |
| dependencies | 仅 JCS 使用 `canonicalize@4.0.0`；成熟依赖负责标准算法，Wakeflow adapter 负责更窄的安全准入 |

### 7.3 明确剩余边界

- 当前合同防御 caller 输入携带的 Proxy、accessor、异常 descriptor/container，以及 serializer 明确拥有的 inherited `toJSON` 行为。
- 它不尝试对整个进程实施 SES/primordial lockdown，也不逐一防御任意代码重写所有 JavaScript intrinsic。若未来允许不可信代码与 Wakeflow 共用同一 isolate，应优先采用进程/isolate 隔离，而不是继续堆叠零散 guard。
- 通用 node/property/byte 总预算不进入 Data options；MCP、文件读取和领域 collection owner 必须在各自外部边界持有容量限制。

### 7.4 节点结论

`Foundation Data = closed for current technical skeleton`。当前没有待删除分支、待提取抽象或未解决 P1/P2；后续发现真实新 consumer 时再重开。下一依赖邻域调整为 Text / Crypto，再进入 Identity / Time / Numeric / Schema。

## 8. FND-TEXT-001

### 8.1 目标文件

- `src/foundation/text/utf8.ts`
- `src/foundation/text/base64url.ts`

本单元只读了两份实现、直接测试、全部生产引用、代表性文件/摘要 consumers、旧 JS 使用场景、TencentDB-Agent-Memory 和官方编码规范；尚未修改目标源码或测试。

### 8.2 真实职责与消费者

`utf8` 提供严格、无损的 `Uint8Array ↔ string` 边界：

- 只接受 primitive string 或 exact `Uint8Array` view；
- `Buffer` 和带偏移量的 `Uint8Array` 只处理可见区间；
- fatal decode，不产生替换字符；
- 编码前拒绝 lone surrogate；
- 保留起始 UTF-8 BOM 为 `U+FEFF`，把 BOM 接纳/拒绝留给上层；
- 返回独立字节并稳定映射错误。

它有 35 个直接生产 dependents、约 50 个生产调用，覆盖 Canonical JSON、严格文本文件、Git 输出、Config、TODO、Ledger、Demand Event Sourcing、Maintenance、Managed Integration 和 Window Runtime。它是实际高扇入底座。

`base64url` 提供规范、无填充的 RFC 4648 URL alphabet 编解码：

- 编码 exact `Uint8Array` view；
- 拒绝 padding、标准 base64 alphabet、空白、长度余 1 和非 ASCII；
- 通过 decode→encode round-trip 拒绝非零 pad-bit aliases；
- 返回独立字节。

当前 `src/` direct dependents 为 **0**，生产调用为 **0**。仓库中的其余引用只有自身测试、历史/核实文档、旧 JS artifact 和一条“不得把 payload base64url 写入 intent”的负断言；候选制品也不包含它。

### 8.3 官方标准事实

- Node 24 [`TextDecoder`](https://nodejs.org/docs/latest-v24.x/api/util.html) 在 `fatal: true` 时遇到解码错误会抛出；`ignoreBOM: true` 的含义是把 BOM 包含在返回文本中。当前实现与注释、测试一致。
- [WHATWG Encoding Standard](https://encoding.spec.whatwg.org/#utf-8-decode-without-bom-or-fail) 建议协议/格式中的标识符或字节序列使用“UTF-8 decode without BOM or fail”，并要求编码输入是 Unicode scalar values。当前 fatal decode + BOM 保留 + lone-surrogate 前置拒绝准确实现这一边界。
- [RFC 4648](https://www.rfc-editor.org/rfc/rfc4648.html) 定义 base64url 字母表；只有上层协议隐含数据长度时才能省略 padding，并要求未使用的 pad bits 为零以保证唯一表示。
- Node 24 [`Buffer` base64url](https://nodejs.org/docs/latest-v24.x/api/buffer.html#buffers-and-character-encodings) 编码会省略 padding，但解码也接受普通 base64 和其他宽松输入。因此若存在严格协议 consumer，正则、长度和 re-encode 验证仍有必要。

### 8.4 TencentDB-Agent-Memory 对照

腾讯项目没有统一的严格 UTF-8 Foundation，文件和网络路径主要直接使用 Node UTF-8 字符串能力；该路线不能满足 Wakeflow 对持久 authority 字节的 fatal decode 与 BOM 分层要求。

它只在具体协议 owner 中使用 base64url：

- `MemoryCore/src/metadata/utils/crypto.ts`：随机 user key、salt 和 password hash framing；
- `MemoryCore/src/core/memory-generation-log/store.ts`：分页 cursor。

这些 consumer 直接使用 `Buffer`，再由各自 owner 决定前缀、字节长度、分隔符、鉴权或 cursor shape。可学习的原则是“base64url 随具体 wire/storage 协议落地”；它不是保留一个无 consumer 通用模块的理由。

### 8.5 UTF-8 审阅结论

| 项目 | 结论 | 理由 |
| --- | --- | --- |
| 模块职责 | `accept` | 只拥有字节与 Unicode 字符串转换，不混入文件/BOM/NFC/换行领域规则 |
| `fatal: true` | `accept` | authority 输入不能以 U+FFFD 修复损坏字节 |
| `ignoreBOM: true` | `accept` | 基础层保留 BOM 事实；`strict-text-file` 已明确拒绝，外部混合文本可自行解释 |
| lone surrogate 前置拒绝 | `accept` | 避免 `TextEncoder` 静默替换为 U+FFFD；与 Data 层 Unicode 合同一致 |
| Buffer / offset view | `accept` | 符合 Node `Uint8Array` 模型且不会读取 backing store 的不可见区间 |
| 单例 encoder/decoder | `accept` | 非 streaming 同步调用；失败后状态重置已有测试证明 |
| class/service 抽象 | `reject` | 转换无实例状态；函数和稳定错误足够 |
| 领域容量选项 | `reject` | 文件/MCP/record owner 已在取得字节前拥有容量，不应在 codec 重复配置 |

当前 7 项 UTF-8 测试覆盖 round-trip、Unicode/NUL、Buffer/offset view、BOM、fatal malformed/truncated bytes、Proxy 零 trap、non-string/lone-surrogate、独立输出和错误脱敏；没有 stale 或重复测试，也没有建议修改。

### 8.6 Base64url 审阅结论

实现算法没有发现标准错误，但当前是 86 行生产 API + 25 行测试维护一个零 consumer 候选。单一测试只验证 happy path 和若干 invalid spelling；如果要把它作为真实基础合同保留，还缺少 error reason/path、Proxy、offset view、独立输出和非零 pad-bit alias 证据。为零 consumer 扩充测试会进一步增加无需求维护成本。

旧 JS 的 Claude settings/activity 确实直接使用 base64url 编码 workspace root 或 worker 参数，但它们尚未成为新 TS 的已确认 consumer；未来 TS owner 还需要决定编码的是原始 bytes、UTF-8 text、typed token 还是带容量和 framing 的协议值。现在冻结现有通用 API，反而可能让未来实现迁就旧候选。

当前 Technical Skeleton Review Gate 已把它列为 `consumer-needed candidate / exclude from artifact`，并明确写明后续仍无 consumer 时优先删除。逐文件审阅已经到达该删除门。

### 8.7 真实备选方案

**A．删除候选（已确认、已实现）**

删除 `src/foundation/text/base64url.ts` 与 `tests/foundation/text/base64url.test.ts`。不修改旧 JS artifact 或历史文档，也不发明替代 codec。第一个确认的 TS consumer 到来时，在同一垂直切片中根据实际协议重新引入最小实现与完整聚焦测试。

- 优点：立即移除零 consumer API、错误类型和欠完整测试；避免把旧 host framing 误当新 TS 标准。
- 代价：未来真实 consumer 需要重新引入约 80 行经过审阅的实现；RFC/Node 方案清楚，逆转成本低。

**B．继续显式 defer**

保留源码和单一测试，但继续从 artifact 排除，等待未来 consumer。

- 优点：未来可直接复用当前实现。
- 代价：持续维护无生产证明的 API；与本轮“及时清理冗余分支和测试”目标冲突，且测试合同不足。

**C．现在接入旧 JS 对应业务**

为了证明 consumer 而提前迁移 Claude settings/activity framing。

- 结论：`reject`。这会把一个 Foundation 审阅扩大为 host 业务实现，并让旧方案倒逼新 TS 技术选择。

### 8.8 测试基线

两份 focused 测试当前共 8 项：

```text
8 pass / 0 fail / 0 skip / 63.644ms
TypeScript project build: pass
```

若选择 A，删除测试不是降低真实覆盖：生产图没有任何 base64url 路径。删除后只重跑 `utf8.test.ts`、TypeScript build、依赖架构检查和源引用扫描；测试 runner 按当前 `.test.ts` 源清单运行，不会误执行 `.build` 中的旧输出。

### 8.9 用户决定与删除证据

用户确认接受 `utf8.ts` 原样不动，并选择 A。已经删除：

- `src/foundation/text/base64url.ts`；
- `tests/foundation/text/base64url.test.ts`。

旧 JS artifact、历史设计/核实文档、package dependencies 和其他 production/test 文件均未修改。仓库唯一剩余 `base64url` 测试代码是 Ledger 的负断言，用于证明 intent 不内嵌 member payload，并非被删除 codec 的 consumer。

删除后验证：

```text
UTF-8 focused tests: 7 pass / 0 fail / 0 skip / 53.017167ms
TypeScript project build: pass
Architecture: pass / 419 modules / 2578 dependencies
Current source import/reference scan: 0 base64url codec references
git diff --check: pass
```

两个删除文件仍可从 Git 基线提交 `df0eece` 恢复；当前不需要保留兼容入口或空测试。下一单元进入 Text 系统剩余的 `markdown-json-string-literal.ts`。

## 9. FND-TEXT-002

### 9.1 目标文件

- `src/foundation/text/markdown-json-string-literal.ts`

本单元只读了实现、唯一直接测试、三个生产 consumers 及其安全测试、配置/NFC 上游、旧 JS、TencentDB-Agent-Memory 和 CommonMark/GFM/Unicode 官方资料；尚未修改目标源码或测试。

### 9.2 真实职责与消费者

本模块把一个外部 primitive string 渲染为“单反引号 code span 包裹的 JSON string literal”：

- `JSON.stringify` 负责引号、反斜杠、C0 control 和 JSON 字符串语义；
- 换行不会成为真实 Markdown 换行；
- 反引号不会闭合 code span；
- `<`、`>`、`&` 不会形成 raw HTML、comment 或 entity；
- 输入必须是 well-formed NFC，不 trim、不规范化、不强制转换；
- 不渲染标题、链接、列表或完整文档，也不声称是通用 Markdown sanitizer。

它有 3 个直接生产 dependents：

1. `wakeflow-active-workspace-fresh-projection-authority.ts`；
2. `wakeflow-program-instruction-body-authority.ts`；
3. `wakeflow-support-memory-authority.ts`。

三者都把 literal 放在 bullet 或 blockquote 的行内文本位置，并把下层错误映射为各自的 `text` 错误。Active Projection 和 Program Instruction 已有外部换行、伪 heading、HTML marker、反引号注入测试；因此它是已有垂直 consumer 的共享边界，不应删除或回收到三个 owner 中。

### 9.3 标准与外部实践

- [CommonMark 0.31.2](https://spec.commonmark.org/0.31.2/#code-spans) 规定 code span 由等长 backtick strings 开闭；内部换行会转为空格。当前实现消除输入中的真实 backtick 与真实换行，因此 CommonMark 基础结构安全。
- [GFM table extension](https://github.github.com/gfm/#tables-extension-) 明确要求表格 cell 中的 pipe 即使位于其他 inline span 内也必须转义；当前输出保留原始 `|`，因此通用的“不会改变 Markdown 结构”声明不覆盖 GFM table context。
- [Unicode UTR #36](https://www.unicode.org/reports/tr36/#Bidirectional_Text_Spoofing) 指出双向控制可造成视觉重排，并明确建议绝不允许 bidi override characters。对于 Wakeflow 生成的 agent 指令/权威导航，保留原始 bidi controls 会让逻辑顺序与显示顺序分离。
- TencentDB-Agent-Memory 没有统一的 Markdown 外部文本 literal renderer 或 bidi/structure escaping；它主要直接拼接 prompt/Markdown。该实践不能替代 Wakeflow 三个持久生成文档共享的严格边界。

### 9.4 已接受的设计

| 项目 | 结论 | 理由 |
| --- | --- | --- |
| 独立 Foundation 函数 | `accept` | 三个真实文档 owner 共享同一行内数据合同，避免各自漏掉 marker/backtick/control |
| JSON string literal inside code span | `accept` | 同时提供明确数据边界、标准 escaping 和可逆表示，比自定义 Markdown backslash escaping 更稳定 |
| well-formed + NFC rejection | `accept` | 三个生成文档本身都要求 NFC；在字段路径处失败比等完整 body 生成后再报错精确 |
| 不自动 normalize | `accept` | 不把两个不同输入静默合并；由配置/调用者提交规范文本 |
| 稳定错误类 | `accept` | 三个 consumer 已映射其 path/reason；不存在第二错误 owner |
| parser / class / options | `reject` | 当前只需要同步纯渲染；没有反向解析、实例状态或多种 profile |
| 第三方 Markdown sanitizer | `reject` | HTML sanitizer/Markdown parser 不拥有原始 source literal 的确定字节、bidi 显示或 Wakeflow marker 合同 |

### 9.5 已确认的缺口

隔离输出包含真实 pipe 与 U+202E RIGHT-TO-LEFT OVERRIDE：

```json
{
  "rendered": "`\"left|right ‮ marker\"`",
  "rawCodePointsInclude": ["7c", "202e"]
}
```

当前三个 consumers 不位于 GFM table 中，所以没有现行结构逃逸；但模块名称和注释是可复用的 Foundation 合同，raw pipe 会在合理的新 consumer 中改变表格 cell，raw bidi override 也可能视觉重排 agent 读取的指令。结论为 `fix / P2 boundary completeness`，不是重做 Markdown 系统。

测试还有两个准确性缺口：

- 标题称“rejects coercion”，却只用 number，没有带 `toString` 行为的对象与调用次数断言；
- 输出称 JSON string literal，却没有直接执行“去掉 code-span 外壳后 `JSON.parse` 等于原输入”的 round-trip 断言。

### 9.6 真实备选方案

**A．补齐单一安全字符集（已确认、已实现）**

保留现有 API、错误和 consumers，把序列化后的多次替换收敛为一个私有 BMP escape pattern：

- C1 controls；
- U+2028/U+2029；
- `<`、`>`、`&`、backtick；
- GFM pipe `|`；
- Unicode Bidi_Control 的稳定 BMP 集合：U+061C、U+200E/U+200F、U+202A–U+202E、U+2066–U+2069。

所有命中字符统一输出小写 `\uXXXX`。JSON 字符串语义保持可逆；不拒绝 RTL 语言本身，也不拒绝合法 ZWJ/ZWNJ，只把显式方向控制显示成数据 escape。

同时：

- 把不可能接收 astral code point 的 `unicodeEscape()` 简化、重命名为按 BMP code unit 转义；
- 扩展现有第一项测试覆盖 pipe、bidi 与 JSON round-trip；
- 扩展现有第二项测试使用行为型 `toString` 并断言调用次数为零；
- 测试总数仍为 2，不增加依赖或公开表面。

**B．只收窄注释到当前三种非表格 context**

不改输出，只声明调用方不得在 GFM table 等新 context 使用。

- 优点：零行为变化。
- 代价：把 context 审计责任推给每个未来 consumer；bidi visual spoof 仍存在；与共享 Foundation 的目的冲突。

**C．引入 Markdown parser/sanitizer**

- 结论：`reject`。完整 parser 仍需要选择 dialect 和输出 renderer，也不会自动提供 bidi 或确定性原始 source 合同；对一个 inline primitive 明显过度设计。

### 9.7 测试基线

当前唯一 focused 文件共 2 项：

```text
2 pass / 0 fail / 0 skip / 53.723458ms
TypeScript project build: pass
```

现有 exact injection 与 Unicode failure cases 保留；方案 A 只增强这两项测试，不创建新 test case 或 fixture。

### 9.8 用户决定与实现证据

用户确认采用 A。实现结果：

- 将原有多次替换收敛为一个私有 `MARKDOWN_LITERAL_ESCAPE_PATTERN`；
- 保留 C1、U+2028/U+2029、HTML 边界、`&` 和 backtick escaping；
- 新增 GFM pipe 与完整 BMP Bidi_Control 集合；
- 把带不可能异常分支的 `unicodeEscape()` 简化为 `escapeBmpCodeUnit()`；
- 保留 well-formed/NFC 准入、JSON string literal、公开 API 与错误合同；
- 第一项测试新增 pipe、bidi 和 JSON round-trip；第二项测试新增行为型 `toString`，调用次数为零；测试总数仍为 2。

隔离探针：

```json
{
  "rendered": "`\"left\\u007cright \\u202e marker\"`",
  "roundTrip": true,
  "rawPipe": false,
  "rawBidi": false
}
```

验证结果：

```text
Direct focused tests: 2 pass / 0 fail / 0 skip / 51.195625ms
Direct + 3 consumer files: 11 pass / 0 fail / 0 skip / 191.442792ms
TypeScript project build: pass
```

本单元没有新增依赖、模块、公共 API、错误分支、测试项或 fixture；P2 边界缺口已闭合。

## 10. Foundation Text 系统节点收束

### 10.1 最终模块集合

```text
Uint8Array ↔ Unicode string
  → utf8

external NFC string → Markdown inline JSON data
  → markdown-json-string-literal

base64url
  → deleted until a real TS protocol consumer exists
```

### 10.2 架构结论

| 检查项 | 结论 |
| --- | --- |
| owner | `utf8` 只拥有严格字节转换；Markdown literal 只拥有一个 inline source 数据值；职责不重叠 |
| consumers | `utf8` 有 35 个生产 dependents；Markdown literal 有 3 个生成文档 consumers；零 consumer base64url 已删除 |
| effects | 两个保留模块均为同步纯函数，没有文件、网络、时钟、global mutation 或 instance lifecycle |
| standards | UTF-8 依托 WHATWG/Node；Markdown literal 依托 JSON string、CommonMark code span、GFM pipe 与 Unicode bidi guidance |
| policy placement | BOM/NFC/line endings/容量由对应文件或领域 owner 持有；Markdown literal 只拒绝生成文档已经要求的 NFC，不自动修复 |
| dependencies | 仅使用 Node/ECMAScript 原生能力；不需要 codec、Markdown parser 或 sanitizer 第三方依赖 |
| tests | 保留 9 项直接聚焦测试；删除 1 项无 consumer base64url 测试；三个 Markdown consumers 另有结构注入回归 |

### 10.3 明确剩余边界

- Markdown literal 是一个完整 inline token，不是任意 Markdown context 的 formatter；调用方不能把它拆开后放入 link destination、raw HTML attribute 或其他语法槽位。
- 它把显式 bidi controls 显示为 JSON escapes，但不禁止 RTL 语言字符、合法组合字符、ZWJ/ZWNJ 或所有 Unicode confusable；完整 Unicode identifier policy 仍由具体 identity owner 决定。
- UTF-8 不拥有调用方字节容量或共享内存并发；持久文件和公开输入在进入 codec 前必须已经形成有界、稳定字节快照。

### 10.4 节点结论

`Foundation Text = closed for current technical skeleton`。当前没有零 consumer、重复 owner、待抽象分支或未解决 P1/P2。下一邻域进入 Crypto，先审阅 one-shot SHA-256 与 Canonical JSON digest 组合，再单独审阅增量 hasher。

## 11. FND-CRYPTO-001

### 11.1 目标文件

- `src/foundation/crypto/sha256.ts`
- `src/foundation/crypto/canonical-json-sha256.ts`

本单元只读了两份实现、直接测试、全部生产引用、摘要 Schema/codegen、增量 hasher 作为相邻 consumer、旧 JS、TencentDB-Agent-Memory 和 Node/NIST 官方资料；尚未修改目标源码或测试。

### 11.2 真实职责与消费者

`sha256` 拥有 one-shot exact bytes 与摘要词法：

- 只接受 `Uint8Array` 可见区间，明确拒绝 string、ArrayBuffer、DataView 和其他 TypedArray；
- 通过 Node `createHash("sha256")` 生成完整 256-bit digest；
- 提供 lowercase 64-hex 与 `sha256:<hex>` 两种品牌类型；
- 严格解析两种词法，不接受大小写、空白、长度或前缀别名；
- 不编码字符串、不读取文件、不解释摘要为签名/授权/真实性。

它有约 110 个直接生产 dependents、86 个生产调用；`Sha256Digest` 是文件、Config、TODO、Ledger、Demand Event Sourcing、Maintenance、Window Runtime 和 Artifact contracts 的共同词法。

`canonical-json-sha256` 只组合 `encodeCanonicalJson` 与 `sha256`：

- Canonical JSON 继续拥有准入/JCS/UTF-8；
- SHA-256 继续拥有字节 hashing 与品牌；
- 组合层不捕获或重写任一错误 owner；
- 不加换行、domain separator、第三种错误或领域含义。

它有约 52 个直接生产 dependents、89 个生产调用，是结构 authority、plan、state、projection 和 operation digest 的实际高扇入入口。两文件职责不能合并。

### 11.3 标准与外部实践

- [NIST FIPS 180-4](https://csrc.nist.gov/pubs/fips/180-4/upd1/final) 定义 SHA-256 的 256-bit message digest；NIST 2026-08 更新的[Secure Hashing CAVP](https://csrc.nist.gov/Projects/Cryptographic-Algorithm-Validation-Program/Secure-Hashing)仍把 SHA-256 列为当前 SHA-2 validation target。
- Node 24 [`Hash.update`](https://nodejs.org/docs/latest-v24.x/api/crypto.html#hashupdatedata-inputencoding) 接受 Buffer/TypedArray/DataView，`digest("hex")` 返回完整字符串。Wakeflow 在其上进一步收窄为 exact Uint8Array view，避免隐式 string encoding 或更宽 input alias。
- 当前三组 direct vectors 是标准 SHA-256 vectors；Buffer/offset view 与输入零行为测试验证了 Node 适配边界，而不是重测 OpenSSL 实现细节。
- TencentDB-Agent-Memory 在 prompt、profile、cursor/ID 等具体 owner 中直接 `createHash("sha256")`，并多处截断 hex；它没有统一 bytes-only 准入、品牌类型、Schema pattern 或 prefixed digest。Wakeflow 可继续使用相同成熟 Node primitive，但不能退回分散 string hashing。

### 11.4 架构审阅结论

| 项目 | 结论 | 理由 |
| --- | --- | --- |
| Node `createHash` | `accept` | Node 24 原生、同步、无额外依赖；与本地有界字节和增量 hasher 场景匹配 |
| bytes-only 输入 | `accept` | 编码选择必须显式留给 UTF-8/Canonical/file owner |
| lowercase hex + prefixed digest | `accept` | hex 支持内部截断/Node结果复验，prefixed digest 是持久 portable contract |
| branded types | `accept` | 防止任意 string 在 TS 内直接冒充已解析摘要；runtime 仍由 parser/Schema负责 |
| Schema 派生 digest regex | `accept` | 持久词法只有一个 Schema source，运行时 parser 直接消费生成 pattern |
| 同步 one-shot | `accept` | 上层先有界；大文件/树扫描已有增量 hasher，不需要 Promise/Web Crypto 分叉 |
| generic algorithm registry | `reject` | 当前所有合同固定 SHA-256；算法 agility 没有 consumer，反而扩大每个 durable schema |
| timing-safe comparison | `not applicable` | 当前 digest 用于完整性/identity/CAS，不是 secret MAC；真实性仍需独立签名/授权 |
| domain separator | `domain-owned` | Canonical records 自带 kind/version/basis；基础层不替各领域决定语义 framing |
| 两文件合并 | `reject` | raw bytes hash 与 Canonical JSON semantic hash 有不同输入 authority 和 consumers |

### 11.5 可删除表面

代码图确认两项 export 没有生产 consumer：

1. `computeCanonicalJsonSha256Hex()` 只被直接测试调用；所有 52 个生产 dependents 使用 `computeCanonicalJsonSha256Digest()`。
2. `SHA256_HEX_LENGTH` 只在 `sha256.ts` 内部和直接测试使用；没有模块外生产 consumer。

它们不是错误，但属于 `simplify / zero-consumer public surface`：

- 删除 canonical hex 组合函数不会删除 raw-byte `computeSha256Hex()`、`parseSha256Hex()`、`Sha256Hex` 或增量 hasher 的 `hex` 结果；TODO path 和 hasher 仍有真实 hex 需求。
- `SHA256_HEX_LENGTH` 保持文件内私有常量 64，只移除 `export`；生成/解析行为完全不变。
- 旧 JS 的 `canonicalJsonDigestHex()` 仍留在旧 artifact；新 TS 不承担无 consumer 过渡 API。

### 11.6 真实备选方案

**A．收窄两个 export（已确认、已实现）**

- `SHA256_HEX_LENGTH` 改为文件内常量；
- 删除 `computeCanonicalJsonSha256Hex()` 及其 `computeSha256Hex` / `Sha256Hex` imports；
- 从两个现有测试删除仅验证这两个 export 的 import/assertion；
- 保留 9 个测试项、所有 NIST/golden/composition/error 场景和全部生产摘要字节。

优点是减少无 consumer API 与对称性测试；不改 Schema、生成文件、依赖、错误、类型、真实 consumer 或 artifact bytes。

**B．为 API 对称性继续保留**

保留 canonical hex/digest 两个入口和 exported length。

- 优点：调用方未来可能少写一次 raw combination。
- 代价：对称性不是需求；与刚执行的 consumer-driven 剪枝标准不一致。

**C．合并为 generic hash/canonical service**

- 结论：`reject`。会混合 bytes、text、JSON、算法选择和领域 framing，并撤销当前清楚的依赖方向。

### 11.7 测试基线

两个 focused 文件共 9 项：

```text
9 pass / 0 fail / 0 skip / 65.235459ms
TypeScript project build: pass
```

覆盖 NIST vectors、Buffer/offset view、品牌/词法、Proxy 零 trap、Canonical golden、object order、exact composition 和原 owner 错误传播。没有 stale fixture；方案 A 只删除零 consumer assertion，不减少任何生产路径证据。

### 11.8 用户决定与实现证据

用户确认采用 A。实现结果：

- `SHA256_HEX_LENGTH` 保持值 64，但改为 `sha256.ts` 文件内常量；
- 删除零 consumer 的 `computeCanonicalJsonSha256Hex()`；
- 删除 `canonical-json-sha256.ts` 中不再需要的 hex 函数/类型 imports；
- 删除两份测试中仅验证上述 exports 的 assertions/imports；
- 保留 raw-byte `computeSha256Hex()`、`parseSha256Hex()`、`Sha256Hex`、prefixed digest 与增量 hasher hex result；
- 9 个既有测试项和所有生产摘要字节保持不变。

验证结果：

```text
SHA-256 + Canonical digest + incremental hasher: 17 pass / 0 fail / 0 skip / 67.805834ms
TypeScript project build: pass
Architecture: pass / 419 modules / 2578 dependencies
Removed export source references: 0
git diff --check: pass
```

本单元没有修改 Schema、生成文件、错误、品牌类型、依赖、consumer 或 artifact framing。下一单元进入 `sha256-hasher.ts`。

## 12. FND-CRYPTO-002

### 12.1 目标文件

- `src/foundation/crypto/sha256-hasher.ts`

本单元只读了完整实现、直接测试、两个生产 consumer、`ByteCount` 依赖、one-shot SHA-256、旧 JS、TencentDB-Agent-Memory 和 Node Hash 官方生命周期；尚未修改目标源码或测试。

### 12.2 真实职责与消费者

`Sha256Hasher` 为顺序字节分块持有一个不可逆生命周期：

```text
constructor
  → active
      ├─ update exact Uint8Array chunk → active
      ├─ digest success → finalized
      └─ ByteCount / Node update / digest / lexical failure → failed

finalized / failed
  → 后续 update 或 digest 稳定拒绝
```

它负责：

- 隐藏 Node `Hash`，只允许 exact `Uint8Array` 分块；
- 每次成功 update 后用 `ByteCount` 精确累计；
- byte-count overflow 或 Node 状态不确定时永久 fail closed；
- digest 只能完成一次；
- 返回冻结的累计字节数与完整摘要；
- 不读取 stream/file、不选 chunk size、不拥有 AbortSignal 或 I/O 稳定性。

当前有 2 个直接生产 dependents：

1. `stable-file-read.ts`：在 positional read、growth probe 与节点重验期间同步累计摘要；
2. `durable-file-copy-candidate.ts`：复制 source、复验 candidate 时分别按预期字节数累计摘要。

两者都由自己的 I/O owner 决定 chunk、位置、取消、节点漂移和错误映射；它们只读取最终 `result.byteCount` 与 `result.digest`。

### 12.3 标准与外部实践

- Node 24 [`Hash`](https://nodejs.org/docs/latest-v24.x/api/crypto.html#class-hash) 官方支持 stream 或 `update()` / `digest()` 两种模式；`update()` 可多次调用，`digest()` 后实例不可再次使用。当前三态 wrapper 准确强化了这一生命周期。
- Wakeflow 不采用 Hash stream 作为基础 owner：稳定文件读取需要 positional exact-length reads、growth probe、节点身份重验和精确取消点；这些不变量不能交给一个普通 pipe。
- NIST SHA-256 支持的消息范围远大于 JavaScript safe integer，但 Wakeflow 文件循环和 `Buffer` API 使用 number；以 `ByteCount ≤ Number.MAX_SAFE_INTEGER` 作为本地计数上限是更严格、可精确的工程边界。
- TencentDB-Agent-Memory 主要对完整字符串执行 one-shot `createHash().update().digest()`；没有 reusable incremental file hasher、字节计数或失败状态 wrapper。它不能替代 Wakeflow 两个稳定文件 consumer 的需求。

### 12.4 架构审阅结论

| 项目 | 结论 | 理由 |
| --- | --- | --- |
| 使用 `class` | `accept` | Node Hash、累计 ByteCount 与不可逆状态属于同一实例生命周期 |
| active/finalized/failed | `accept` | 防止 digest 后复用，也防止底层失败后继续信任部分摘要 |
| update 顺序 | `accept` | 先验证输入和下一 ByteCount，再更新 Hash，成功后才提交计数 |
| digest 顺序 | `accept` | Node finalize、词法复验、状态提交和冻结结果顺序正确 |
| exact Uint8Array | `accept` | 与 one-shot hash/UTF-8 相同，不允许隐式 string encoding |
| ByteCount 集成 | `accept` | 两个文件 consumer 都需要验证实际累计 bytes 等于稳定预期 |
| chunk / stream / Abort | `consumer-owned` | 属于文件读取、复制与稳定观察，不应进入 crypto options |
| reset / copy / rolling snapshot | `reject` | 没有 consumer；会扩大状态机和部分摘要误用面 |
| 泛型 Hash factory | `reject` | 当前 durable contracts 固定 SHA-256，没有算法参数 consumer |
| 错误分支注入接口 | `reject` | 只为模拟 OpenSSL/内存故障增加 adapter 会污染生产构造函数；正常状态与真实 Node failure 仍 fail closed |

### 12.5 可删除表面

生产引用扫描确认：

- `hasher.byteCount` getter 的生产读取为 0；测试用它观察 update 中途计数。
- `Sha256HashResult.hex` 的生产读取为 0；两个 consumer 只使用 `byteCount` 和 prefixed `digest`。

这两项不是错误，但属于 `simplify / zero-consumer observation surface`。删除后：

- `#byteCount` 仍保留并在每次 update 中安全累计；最终 result 仍返回它。
- raw hex 能力仍由 one-shot `computeSha256Hex()` / `parseSha256Hex()` / `Sha256Hex` 持有；只是增量结果不再重复暴露。
- `digest()` 可直接把 Node hex 拼接前缀后交给 `parseSha256Digest()` 复验，删除 `parseSha256Hex` / `Sha256Hex` imports。
- `Sha256HashResult` 继续作为公开返回结构，收敛为 `byteCount + digest`。

### 12.6 真实备选方案

**A．收窄最终结果与中途观察（已确认、已实现）**

- 删除 public `byteCount` getter；
- 删除 `Sha256HashResult.hex`；
- 简化 digest lexical verification，只生成品牌化 prefixed digest；
- 调整现有 8 项测试：通过最终 result 证明累计数量，通过错误后继续合法 update/digest 证明 input rejection 未污染实例；不增加或删除 test case。

优点是公共表面与两个真实 consumers 完全一致，同时保留内部安全计数和所有状态不变量。

**B．保留进度与双表示观察**

- 优点：未来调试器或进度 UI 可直接读取中途数量，未来 consumer 可直接取得 hex。
- 代价：当前没有此类 consumer；观察便利性不足以冻结额外 API，与 consumer-driven 剪枝不一致。

**C．删除 wrapper，直接使用 Node Hash stream**

- 结论：`reject`。会丢失品牌 digest、ByteCount、稳定错误、失败状态与文件 owner 的 positional/stability 组合边界。

### 12.7 测试基线

当前直接测试共 8 项：

```text
8 pass / 0 fail / 0 skip / 63.92625ms
TypeScript project build: pass
```

覆盖 one-shot 等价、empty digest、Buffer/offset view、多 chunk 计数、invalid/Proxy、finalization 和 1 MiB 输入。底层 initialization/update/digest 故障与理论 ByteCount overflow 无法在不污染生产 API或消耗不合理资源的情况下直接触发；稳定 fail-closed 分支保留，但不为覆盖率制造注入 seam。

### 12.8 用户决定与实现证据

用户确认采用 A。实现结果：

- 删除 public `byteCount` getter；
- 删除 `Sha256HashResult.hex`；
- `#byteCount` 仍在每次成功 update 后精确提交，最终 result 仍返回 `byteCount`；
- digest lexical verification 直接把 Node hex 加前缀后交给 `parseSha256Digest()`；
- 删除不再需要的 `parseSha256Hex` / `Sha256Hex` imports；
- 8 项测试保持原数量，并改由最终结果证明计数、由 invalid/Proxy 后继续合法 update/digest 证明实例未被输入错误污染。

验证结果：

```text
SHA-256 + Canonical digest + incremental hasher: 17 pass / 0 fail / 0 skip / 62.572791ms
TypeScript project build: pass
Architecture: pass / 419 modules / 2578 dependencies
Removed observation source references: 0
git diff --check: pass
```

两个文件系统 consumers 无需修改；最终结果仍与它们使用的 `byteCount + digest` 完全一致。

## 13. Foundation Crypto 系统节点收束

### 13.1 最终依赖与职责

```text
exact bounded bytes
  → sha256
      one-shot full hex / prefixed digest / strict lexical parser

admitted Canonical JSON
  → canonical-json-sha256
      prefixed semantic digest only

sequential byte chunks
  → Sha256Hasher
      active / finalized / failed
      final byteCount + prefixed digest
```

持久 digest Schema 是 `sha256:<64 lowercase hex>` 的 wire authority；品牌类型只授予已经计算或严格解析的值。

### 13.2 架构结论

| 检查项 | 结论 |
| --- | --- |
| owner | raw bytes、Canonical JSON composition、incremental lifecycle 三层单向依赖，没有第二 hashing facade |
| consumers | one-shot/brand 与 canonical digest 均为高扇入；incremental hasher 有 stable read/copy 两个真实 consumers |
| state | 只有增量 hasher 使用 class；纯 one-shot/组合继续使用函数 |
| errors | raw hash/lexical 与 incremental lifecycle 分离；Canonical JSON 错误保持原 owner |
| standards | Node 24 `createHash` + NIST SHA-256；无第三方 crypto dependency 或自维护算法 |
| schemas | prefixed digest 由 JSON Schema/codegen 定义；hex 仅作为内部/局部能力，不另建 wire Schema |
| pruning | canonical hex export、length export、中途 count getter、incremental hex result 均因零 consumer 删除 |
| tests | 3 个 focused 文件共 17 项，覆盖标准 vectors、词法、组合、状态机、分块和大输入；无重复 test file |

### 13.3 明确剩余边界

- SHA-256 digest 证明输入字节相等性概率，不证明来源、授权、签名或抗主动篡改；需要真实性的领域必须引入独立 MAC/signature authority。
- Foundation 不规定文件/消息容量、chunk size、并发或取消；I/O/public/domain owner 在进入 hash 前持有这些预算。
- Foundation 不自动添加 domain separator。持久 record 必须由自己的 kind/schemaVersion/basis 构成可区分 Canonical JSON；裸字节 digest 的语义由字段 owner 定义。
- 当前固定 SHA-256，不建立没有 consumer 的算法 registry 或迁移层。

### 13.4 节点结论

`Foundation Crypto = closed for current technical skeleton`。当前没有零 consumer export、重复 owner、未解决 P1/P2 或需要补造的测试 seam。下一系统进入 Identity，先成对审阅 UUID v4 primitive 与 Wakeflow typed durable ID。

## 14. FND-IDENTITY-001

### 14.1 目标文件

- `src/foundation/identity/uuid-v4.ts`
- `src/foundation/identity/wakeflow-durable-id.ts`

本单元只读了两份实现、直接测试、全部生产调用、kind Schema/generated 作为依赖背景、旧 JS、TencentDB-Agent-Memory 和 RFC/Node 官方资料；尚未修改目标生产文件或测试。25-kind 词汇的真实 producer/consumer 去留不在本单元修改，下一单元单独审阅其 Schema authority。

### 14.2 UUIDv4 基础职责

`uuid-v4` 拥有：

- canonical lowercase `8-4-4-4-12` 文本；
- version nibble `4` 与 RFC variant `8/9/a/b`；
- `UuidV4` 品牌与 strict non-coercive parser；
- Node `crypto.randomUUID()` 默认生成；
- 可注入、恰好调用一次、返回值重新验证的 `UuidV4Factory`；
- 生成源异常与非法结果的稳定脱敏错误。

它有 11 个直接生产 dependents、约 20 个生产调用。除 durable IDs 外，还用于 atomic stage attempt、lock token、event-store owner token、maintenance operation ID 和 host binding generation；因此 UUID primitive 不应被 durable-ID 文件吸收。

### 14.3 Typed durable identity 职责

`wakeflow-durable-id` 拥有：

- Schema 派生的封闭 kind union；
- `<kind>_<canonical UUIDv4>` 生成与解析；
- kind-specific branded scalar；
- broad parse 返回冻结的 `{ kind, uuid, value }` 判别事实；
- expected-kind mismatch 与 unknown-kind 的稳定区分；
- 词法验证，不查实体、权限、生命周期或集合唯一性。

它有约 46 个直接生产 dependents；`parseWakeflowDurableIdOfKind()` 有 48 个生产调用，覆盖 Config、Demand Event Sourcing、TODO、Ledger、Workspace resources、Window Runtime 和 Maintenance。Broad parse 的 UUID component 还被 Config 用来检查跨 kind UUID collision。

### 14.4 标准与技术选择

- [RFC 9562](https://www.rfc-editor.org/rfc/rfc9562.html) 已取代 RFC 4122，定义 UUIDv4 的 122 random bits、version 4 和 variant `10xx`。RFC 文本允许大小写，Wakeflow 持久协议进一步收窄为 lowercase，避免一个 UUID 多个 spelling。
- Node 24 [`crypto.randomUUID()`](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptorandomuuidoptions) 使用密码学伪随机源，并默认缓存最多 128 个 UUID 所需随机数据。没有 forked-memory 或每次重新取熵的需求，`disableEntropyCache` 不应成为 Foundation option。
- Node 24 也提供 UUIDv7，但 Wakeflow IDs 不承担时间排序；创建时间/revision 有独立 authority。v4 不泄漏时间且已有稳定协议，当前不切换到 v7 或建立 version registry。
- TencentDB-Agent-Memory 同时存在三种路线：直接 `randomUUID()`、截断 UUID、以及 CSPRNG rejection-sampling base62 short ID；另有带时间戳和 `Math.random()` 的旧业务 ID。它说明 ID 必须按具体 collision/长度场景设计，也说明统一使用完整 typed UUIDv4 比混合弱短 ID 更适合 Wakeflow durable authority。
- 不引入第三方 UUID 库：Node 已负责 CSPRNG generation，Wakeflow 只需约 1 个固定 regex 完成更窄的 lowercase v4 admission。

### 14.5 架构审阅结论

| 项目 | 结论 | 理由 |
| --- | --- | --- |
| UUID primitive 与 durable ID 分层 | `accept` | transient token/operation 也复用 UUID，但不属于 durable kind vocabulary |
| strict lowercase parser | `accept` | RFC interoperability 的主动协议收窄，消除文本别名 |
| UUIDv4 | `accept` | 不需要时间排序或 host identity，122 random bits 足够且不泄漏时间 |
| Node entropy cache | `accept default` | 仍是 CSPRNG；绕过缓存没有当前安全或隔离需求 |
| injectable factory | `accept` | 多个真实 deterministic planning/lock/window tests 与 owners 使用，且结果重新准入 |
| typed prefix + brand | `accept` | 编译期阻止 program/window 等跨类别混用，runtime parser 仍 fail closed |
| broad parsed facts | `accept` | Config collision 检查和 Ledger recovery 需要 kind/uuid，而多数记录使用 narrow scalar parser |
| class/entity registry | `reject` | 词法能力无实例状态；存在性、唯一性与权限属于集合/领域 owner |
| short ID | `reject current` | 无长度受限 consumer；减少熵并引入 alphabet/framing 决策 |
| UUIDv7 | `reject current` | 无排序 consumer，迁移会改变持久协议并暴露生成时间 |

### 14.6 测试维护发现

当前生产代码可直接 `accept`，但两处测试不符合“准确、轻量、owner 单一”：

1. `uuid-v4.test.ts` 默认生成测试创建 32 个随机 UUID，并断言集合完全唯一和前两个不等。这不能证明 CSPRNG 质量，理论上还是概率断言；Node 自己拥有随机源测试。Wakeflow 只需证明一次默认调用返回符合自身 strict parser 的值。
2. `wakeflow-durable-id.test.ts` 直接从磁盘读取手写 Schema，再与 generated constant 比较，并硬编码 kind 数量 25。Schema→generated drift 已由 `schema:check` / codegen tests 唯一负责；Identity 单测应验证运行时 vocabulary 与 parser 可组合，而不是复制 codegen gate。

同时，当前测试只抽样少数 kind，没有证明未来 Schema 新增 kind 仍满足“kind 不含 `_`、可 create/parse”这一 parser 前提。

### 14.7 真实备选方案

**A．只清理测试职责（已确认、已实现）**

- 两份生产文件保持零修改；
- UUID 默认生成测试改为一次生成 + strict parse，不再做概率型唯一性断言，删除 `notEqual` import；
- durable kind 测试删除 `fs/path`、Schema JSON 读取、硬编码数量和抽样 kind assertion；
- 保留 generated vocabulary frozen assertion，并遍历每个当前 kind 做 `create → broad parse → expected-kind parse` round-trip；
- 14 个 test case 数量保持不变，`schema:check` 继续单独拥有 source/generated drift。

**B．保留现有交叉检查与随机样本**

- 优点：一个 focused test 同时观察 Schema 文件和简单随机重复。
- 代价：重复 codegen owner、硬编码 kind 数量、概率型测试都增加未来维护噪音，且没有更强保证。

**C．切换 UUIDv7、short ID 或第三方 UUID library**

- 结论：`reject`。没有真实排序/长度/多版本 parser consumer，也没有 Node primitive 缺口。

### 14.8 测试基线

两个 focused 文件共 14 项：

```text
14 pass / 0 fail / 0 skip / 57.765125ms
TypeScript project build: pass
```

除上述职责重叠外，版本/variant/alias、factory once/failure/result、零 coercion、品牌类型、kind mismatch、unknown non-durable kinds、冻结 facts 和错误脱敏均有准确覆盖。

### 14.9 后续词汇审阅边界

初步只读扫描曾记为 14 个；下一单元按 typed field/create/parse 而不是普通字符串重新核对后，确认 `evidence` 也没有 durable-ID consumer，因此正确数量是 **15** 个：

```text
evidence, delivery, delivery-run, dispatch-group, dispatch-packet,
pod, pod-design-handoff, pod-design-request, preservation,
review-candidate, target-result, target-task, task-package,
test-attempt, test-card
```

它们是否删除会影响手写 Schema、generated vocabulary 和可能的未来系统计划，属于下一单元 `FND-IDENTITY-002`；本单元不越界决定。

### 14.10 用户决定与实现证据

用户确认采用 A。实现结果：

- 两份生产文件零修改；
- UUID 默认生成测试从 32 次随机抽样及概率型唯一性断言收敛为一次生成 + strict parse；
- 删除不再需要的 `notEqual` import；
- durable vocabulary 测试不再读取 Schema 文件、不再硬编码 25 或抽样某个 kind；
- 删除测试侧 `node:fs` / `node:path` imports；
- 每个 generated runtime kind 现在都执行 create、broad parse 和 expected-kind parse round-trip；
- 14 个 test case 数量不变。

验证结果：

```text
Identity focused tests: 14 pass / 0 fail / 0 skip / 61.002083ms
TypeScript project build: pass
Schema/codegen check: pass / 34 schemas / 65 external ref edges
Generated digest: sha256:b1827fe9835b633ca933407a0bd526da340ca529b54b78b40701c6fe02437093
git diff --check: pass
```

Schema source/generated 漂移现在只由 codegen gate 负责，Identity focused test 只负责 runtime vocabulary/parser 兼容。下一单元独立审阅 durable kind Schema。

## 15. FND-IDENTITY-002

### 15.1 目标文件

- `src/contracts/identity/wakeflow-durable-id.ts`
- `src/contracts/schemas/identity/wakeflow-durable-id-kind.schema.json`

初始审阅时 runtime 与 Schema 仍分别位于 `src/foundation/identity/` 和 `src/contracts/schemas/foundation/`。用户随后确认业务 kind 不属于 Foundation，因此本单元扩展为两份主合同的职责移动。生成文件 `src/contracts/generated/identity/wakeflow-durable-id-kind.generated.ts` 只作为派生结果审阅，不是第二手写 authority。

### 15.2 “已知 durable kind”的语义

该 enum 不是 roadmap 列表。它会直接生成：

- `WakeflowDurableIdKind` 编译期 union；
- `WAKEFLOW_DURABLE_ID_KINDS` 运行时集合；
- `parseWakeflowDurableId()` 的 `kind-unknown` 准入边界；
- `createWakeflowDurableId()` 可创建的 durable identity 类别。

因此一个名字进入 enum，就表示当前 TS runtime 承认它是可生成、可解析、可在持久记录中出现的身份类别。没有 entity owner、typed field 或 parser consumer 的 roadmap 名词不应提前获得该语义。

### 15.3 保留的 10 个 kinds

| Kind | 当前真实 TS consumer / authority |
| --- | --- |
| `program` | Config 根身份、Window Runtime、Program Instruction、Support Memory |
| `repository` | Config topology、workspace resource、window root |
| `surface` | Config support surface、Support Memory/materialization、window root |
| `window` | Config topology、TODO owner/recommendation、Window Binding/Runtime |
| `requirement` | Ledger authority paths/records/store/reader |
| `confirmation` | Ledger authority paths/records/store/reader、Demand authority link |
| `demand` | TODO mount、Demand model、Event Sourcing、publication paths |
| `demand-event` | Event Sourcing event/envelope/snapshot/decider |
| `demand-event-commit` | Event stream commit、repository、paths、publication transaction |
| `archive` | TODO archived state 与 BusinessArchive receipt 的 typed `archiveId` |

这些 kinds 至少拥有一个明确 typed field 或 exact parser consumer；是否已有最终 public producer不影响其当前读取/验证职责。

### 15.4 应删除的 15 个占位 kinds

```text
evidence
delivery
delivery-run
dispatch-group
dispatch-packet
pod
pod-design-handoff
pod-design-request
preservation
review-candidate
target-result
target-task
task-package
test-attempt
test-card
```

逐项事实相同：

- 非 generated `src` 中没有 `WakeflowDurableId<kind>` typed field；
- 没有 `createWakeflowDurableId(kind)` producer；
- 没有 `parseWakeflowDurableIdOfKind(..., kind)` consumer；
- 其他当前 TS Schemas 没有对应 `<kind>_<uuid>` pattern；
- `evidence` 在现有 TS 中只作为 host resource family 普通字符串出现，不是 durable ID；
- `task-package`、`target-task`、`evidence` 仅被 Identity 测试当作示例，不能反向制造生产需求。

Technical Skeleton Gate §12 同时明确：TaskPackage/TargetTask/TestCard、Dispatch/Delivery、TargetResult/ReviewCandidate、Evidence owner、Preservation、Pod 等新 TS 业务尚未实现且不得误报。旧 JS 虽有对应系统与 ID，但用户已确认旧项目只作为功能参考，不决定新 TS 技术表面。

### 15.5 为什么不保留“reserved kinds”

保留未来名字会产生三项实际成本：

1. parser 会接受一个没有任何实体 owner 能解析或定位的“已知”ID；
2. TypeScript 允许领域代码声明尚不存在的 durable identity，削弱 exhaustiveness 与 dead-branch 检查；
3. 未来真实垂直切片被迫沿用今天猜测的名称、生命周期和是否需要独立 ID，而不能根据真实 aggregate/record 设计决定。

这与 base64url 的删除理由一致，但影响更直接：这里不是闲置 helper，而是持久协议词汇。

### 15.6 真实备选方案

**A．收敛为 10 个真实 kinds（已确认并扩展实现）**

- 从手写 Schema enum 删除上述 15 项；
- 运行 `schema:build` 更新唯一 generated vocabulary/type；
- 更新现有 Identity 测试：valid 示例改用 retained kinds，并把 15 个删除前缀加入同一 invalid-kind 矩阵；
- 运行 Identity focused、schema check、TypeScript、architecture 和 candidate artifact build；
- 不修改旧 JS、历史文档或任何业务 owner。

未来某个垂直切片第一次需要新 durable ID 时，由该切片同时提交 kind、typed field、producer、consumer、Schema 和 focused test；不能只把名字重新放回 enum。

**B．保留为显式 reserved vocabulary**

- 优点：未来实现可沿用当前名字，减少一次 enum 变更。
- 代价：runtime 仍会接受没有 owner 的 IDs；“reserved”不能修复 parser 语义，也会冻结未经真实业务验证的边界。

**C．拆成 active 与 reserved 两套 enum**

- 结论：`reject`。会增加第二词汇和转换规则；runtime 仍只需要 active kinds，roadmap 应留在计划而非协议 Schema。

### 15.7 变更与兼容边界

新版 TS 仍处于 `0.0.0-technical-skeleton`、未作为 public v3 release 切换；用户也已明确不需要旧 JS→TS 过渡兼容。因此本轮收敛无需新 Schema version、migration alias 或 deprecated parser。

旧 JS、0.9.6 artifacts、安装缓存和历史计划保持不变。重新加入 kind 是未来明确的协议扩展决定，不应在本轮假设版本策略。

### 15.8 当前验证基线

FND-IDENTITY-001 清理后：

```text
Identity focused tests: 14 pass / 0 fail / 0 skip / 61.002083ms
Schema/codegen check: pass / 34 schemas / 65 external ref edges
```

Schema 修改前，当前 generated enum 仍为 25 项；确认前不执行 codegen。

### 15.9 用户确认的职责修正

用户指出：业务相关类型应由业务层独立维护，而不是继续放在 Foundation。经讨论后确认以下边界：

- `uuid-v4.ts` 留在 Foundation，继续只拥有 RFC/Node UUID primitive；
- `WakeflowDurableId` 与 active kind Schema 作为 Wakeflow 跨领域应用合同，移动到 `contracts/identity`；
- “业务配置”是代码/Schema 拥有的静态封闭合同，不是 `wakeflow.config.json` 用户选项，也不是动态 registry；
- 不创建 generic typed-ID manager、active/reserved 双 enum 或兼容 re-export；
- active runtime enum 只保留 10 个真实 kinds；15 个确认存在的未来业务类型继续记录在本台账，随首个真实垂直 consumer 原名加入。

该修正比单纯 `25 → 10` 更根本：Foundation 不再知道任何 Wakeflow 业务实体名称。

### 15.10 实现内容

主要职责移动：

```text
src/foundation/identity/uuid-v4.ts
  → 保留：纯 UUIDv4 Foundation

src/foundation/identity/wakeflow-durable-id.ts
  → src/contracts/identity/wakeflow-durable-id.ts

src/contracts/schemas/foundation/wakeflow-durable-id-kind.schema.json
  → src/contracts/schemas/identity/wakeflow-durable-id-kind.schema.json

src/contracts/generated/foundation/wakeflow-durable-id-kind.generated.ts
  → src/contracts/generated/identity/wakeflow-durable-id-kind.generated.ts

tests/foundation/identity/wakeflow-durable-id.test.ts
  → tests/contracts/identity/wakeflow-durable-id.test.ts
```

Schema `$id` 从 `urn:wakeflow:foundation:identity:durable-id-kind:v1` 修正为 `urn:wakeflow:identity:durable-id-kind:v1`。Enum 收敛到：

```text
archive, confirmation, demand, demand-event, demand-event-commit,
program, repository, requirement, surface, window
```

其他随动修改：

- codegen whitelist 与测试路径/ID 更新为 `identity/`；
- runtime tsconfig 只新增 `contracts/identity/**/*.ts`，没有把整个 contracts 树混入手写 runtime；
- dependency-cruiser 禁止 Foundation 依赖 application identity 或其 generated contract；
- application identity contract 也禁止反向依赖 Configuration/Workspace/Governance/Hosts/Entrypoints；
- 66 个 runtime/test imports 指向 `contracts/identity`；其中 64 个既有 consumer 已逐文件证明只有路径发生机械变化；
- 没有旧路径 re-export、deprecated alias、双 parser 或 migration branch；
- 15 个 retired prefixes 全部进入现有 invalid-kind 矩阵；valid 测试示例改用 retained kinds。

### 15.11 验证证据

```text
Identity focused tests: 14 pass / 0 fail / 0 skip / 62.502791ms
Schema codegen focused tests: 6 pass / 0 fail / 0 skip / 799.428333ms
Schema build/check: pass / 34 schemas / 65 external ref edges
Generated digest: sha256:b7e8c75287883d2d0728f6e77875368ea1385d4ff9800245879fb1e79ed0d35e
TypeScript typecheck: pass
Architecture: pass / 422 modules / 2582 dependencies
Representative Configuration/Demand/Ledger/TODO/Window tests: 20 pass / 0 fail / 0 skip / 1847.181541ms
Old runtime/schema/generated path scan: 0
Retired typed field/create/parse scan: 0
Mechanical consumer diff mismatches: 0
git diff --check: pass
```

双宿主候选制品构建通过：

| Host | Compiled files | Manifest digest |
| --- | ---: | --- |
| Codex | 213 | `sha256:5849fb78df69cd87c8e84d7e2f4230bc960e2e8c727278a8938a95fec314c955` |
| Claude Code | 218 | `sha256:b011959fb097c85907ec2099fa9f8385c0da7440157a5172445d1add81a679b6` |

两份 artifact 只包含 `lib/contracts/identity/wakeflow-durable-id.js`，旧 Foundation runtime 路径为零。

## 16. Foundation / Application Identity 系统节点收束

### 16.1 最终分层

```text
Foundation / Identity
└─ uuid-v4
   RFC 9562 v4 + Node CSPRNG + strict lowercase parser + injectable factory

Contracts / Identity
├─ wakeflow-durable-id
└─ active durable kind Schema/generated vocabulary
   Wakeflow prefix + brand + broad/narrow parser

Business domains
├─ Configuration / Workspace: program, repository, surface, window
├─ Ledger: requirement, confirmation
├─ Demand Event Sourcing: demand, demand-event, demand-event-commit
└─ TODO / Archive receipt: archive

Future vertical slices
└─ evidence, delivery, task-package, target-result, test-card, pod, ...
   先拥有真实字段/producer/consumer，再加入 active contract
```

### 16.2 架构结论

| 检查项 | 结论 |
| --- | --- |
| Foundation purity | 只保留无业务词汇的 UUIDv4 primitive |
| Application contract | 一个跨领域 Wakeflow identity owner，不是用户配置或动态 registry |
| Domain ownership | 各领域拥有实体生命周期、集合唯一性、引用存在性和权限；共享合同只拥有词法 |
| Vocabulary | active 10 项均有 typed consumer；planned 15 项不进入 runtime acceptance |
| Extensibility | 新 kind 由首个真实垂直切片连同 Schema、字段、producer、consumer 和测试一起加入 |
| Compatibility | TS 尚未 release，无旧 TS 持久数据；本轮不需要版本别名或迁移 parser |
| Architecture enforcement | Foundation→Application Identity 与 Application Identity→Domain 两个反向依赖均被机器门禁止 |
| Tests | Foundation UUID 与 Contracts durable ID 各自有 focused owner；Schema/codegen 漂移独立验证 |

### 16.3 节点结论

`Foundation Identity + Wakeflow Application Identity Contract = closed for current technical skeleton`。未来 kinds 的需求没有删除，只从“runtime 已实现”降回“业务计划已确认”。下一系统进入 Foundation Time。

## 17. FND-TIME-001

### 17.1 目标文件

- `src/foundation/time/utc-instant.ts`
- `src/foundation/time/wall-clock.ts`

本单元只读了两份实现、直接测试、全部生产 consumers、UTC Schema/generated、相邻 monotonic 边界、旧 JS、TencentDB-Agent-Memory 和 RFC/TC39 资料；尚未修改目标源码或测试。

### 17.2 UTC instant 职责

`utc-instant` 拥有 Wakeflow 严格 UTC timestamp profile：

- 四位年份、大写 `T/Z`、只接受 UTC；
- 秒范围 00–59，不接受 leap second；
- 可无小数或保留 1–9 位小数秒；
- Schema regex 负责词法，runtime 复验真实 Gregorian 日期；
- `Date` 只解析整秒，`bigint` 独立保留 nanoseconds；
- 原始小数精度不被 trim、补零或改写；
- branded parser 与真实 nanosecond timeline comparison；
- 不读取当前时间、不定义 timeout/lease/retention。

它有 16 个直接生产 dependents、约 17 个生产调用，覆盖 Config-adjacent contracts、TODO、Ledger、Demand Event Sourcing、Window Binding/Runtime 和锁记录。

### 17.3 Wall clock 职责

`wall-clock` 只拥有一次“当前 UTC 应记录为何值”的 observation：

- 默认来源使用 `new Date().toISOString()`，保持系统毫秒精度；
- injectable `UtcWallClock` 用于 deterministic owner tests；
- 每次恰好调用一次并重新解析结果；
- source throw 与 invalid result 稳定区分并脱敏；
- 不缓存、不保证单调，允许系统校时回拨。

它有 8 个直接生产 dependents，主要是 TODO、Ledger、Demand identity、Window Binding store 和 rooted lock。领域 owner 决定时间关系；monotonic timeout 使用另一个系统。

### 17.4 标准与表示精度决定

- [RFC 3339](https://www.rfc-editor.org/rfc/rfc3339.html) 允许可选、任意正长度 fractional seconds；Wakeflow 进一步收窄到 0 或 1–9 位、UTC `Z`、大写分隔符和无 leap second。
- RFC 3339 同时指出：只有时区和 fractional digit 数相同时，字符串排序才等价于时间排序。当前代码没有依赖 lexical ordering，而是统一转换到 epoch nanoseconds 比较。
- [RFC 9557](https://www.rfc-editor.org/rfc/rfc9557.html) 扩展时区/annotation 信息，但 Wakeflow durable records 只需要 UTC instant，不接受扩展 suffix。
- TC39 [`Temporal.Instant`](https://tc39.es/proposal-temporal/docs/instant.html) 默认 `auto` serialization 会去掉 trailing zeros，也允许调用方指定 0–9 位输出精度。这说明精度是明确的序列化选择，不存在一个由标准强制的唯一 fractional spelling。

Wakeflow 当前选择“原始精度是 observation 的一部分”：`Z`、`.0Z` 和 `.000000000Z` 在 timeline 上相等，但保留不同来源精度并形成不同 record bytes。该选择已经写入 Schema、注释和 tests，且 system clock 稳定产生 3 位；本轮 `accept`，不做隐式 canonicalization。

### 17.5 实现审阅结论

| 项目 | 结论 | 理由 |
| --- | --- | --- |
| Schema regex + Date calendar recheck | `accept` | 词法与真实日期分层；显式处理 Date 对 0–99 年的 1900 offset 陷阱 |
| bigint nanosecond timeline | `accept` | 1–9 位精度和 1970 前负值均精确，无 floating-point loss |
| variable precision preservation | `accept explicit profile` | 精度作为记录来源事实；排序统一使用 comparison API |
| leap-second rejection | `accept` | JavaScript/Node 时间线不安全表示 leap second；不做静默 rollover |
| UTC-only | `accept` | durable record 不保存本地 zone/offset；展示转换不属于 Foundation |
| wall 与 monotonic 分离 | `accept` | wall clock 可回拨；deadline/elapsed time 不能使用它 |
| injected clock | `accept` | 多个真实 owner tests 使用；runtime 结果仍重新准入 |
| `class` | `reject` | parser/comparator/clock source 均无实例生命周期 |
| Temporal dependency/branch | `reject current` | 当前 Date+bigint 已覆盖 0000–9999 和 ns；没有 zone/calendar arithmetic consumer |
| automatic precision normalization | `reject current` | 会改写持久 bytes 和来源精度，属于协议迁移而非局部修复 |

### 17.6 可删除表面

生产引用扫描确认：

1. `utcInstantToEpochNanoseconds()` 没有模块外生产 consumer；只有 direct test 使用。真实领域只需要 `compareUtcInstants()`。
2. `systemUtcWallClock` 没有生产 import；所有 owner 通过 `readUtcWallClock()` 使用默认来源。直接导出还允许未来调用方绕过 clock failure/result 的稳定映射。

两项均为 `simplify / zero-consumer public surface`：

- epoch nanoseconds 继续作为私有解析/比较实现事实，不成为持久或跨领域数值 API；
- system clock 改为文件内常量，唯一公开 effect boundary 保持 `readUtcWallClock()`；
- 不改变 timestamp Schema、品牌、比较结果、默认毫秒文本或任何生产 consumer。

### 17.7 真实备选方案

**A．收窄两个 export（已确认、已实现）**

- 删除 public `utcInstantToEpochNanoseconds()`；
- `systemUtcWallClock` 改为 private const；
- 删除 direct epoch-number test，把 1970 前后和 1ns 边界合并到现有 comparison test；
- wall-clock 默认来源测试只通过 `readUtcWallClock()` 验证，不再直调底层常量；
- direct test case 从 13 收敛到 12，生产行为不变。

**B．保留作为低层便利 API**

- 优点：未来 duration/calendar consumer 可直接读取 epoch ns，测试可直调 system source。
- 代价：没有当前 consumer；system source 绕过错误边界，epoch bigint 还可能被误当 durable wire value。

**C．统一为 canonical Temporal serialization**

- 结论：`reject`。会改变所有持久 timestamp bytes和精度语义，并引入当前没有需求的 rounding/options/version边界。

### 17.8 测试基线

两个 focused 文件共 13 项：

```text
13 pass / 0 fail / 0 skip / 61.093458ms
TypeScript project build: pass
```

覆盖严格词法、Gregorian rollover/leap year、epoch 两侧 ns、timeline comparison、runtime revalidation、零 coercion、默认/注入/回拨 wall clock 和稳定错误。方案 A 只删除零 API 的直接观察，保留其真实 comparison/default behavior 证据。

### 17.9 用户决定与实现证据

用户确认采用 A。实现结果：

- 删除 public `utcInstantToEpochNanoseconds()`；
- `systemUtcWallClock` 改为文件内 const，所有生产调用继续通过 `readUtcWallClock()`；
- 删除 direct epoch bigint test，把 epoch 前 1ns、epoch、epoch 后 1ns 合并到 timeline comparison；
- forged calendar brand 的 runtime revalidation 改由 `compareUtcInstants()` 左参数证明；
- 默认系统时钟测试只通过公开 guarded boundary 读取；
- direct tests 从 13 收敛为 12，UTC Schema 和 variable precision 保持不变。

验证结果：

```text
UTC instant + wall clock focused: 12 pass / 0 fail / 0 skip / 111.409834ms
TypeScript project build: pass
Removed public symbol references: 0
git diff --check: pass
```

所有生产 consumers 无需修改。下一单元进入 monotonic duration/clock。

## 18. FND-TIME-002

### 18.1 目标文件

- `src/foundation/time/monotonic-duration.ts`
- `src/foundation/time/monotonic-clock.ts`

本单元只读了两份实现、直接测试、deadline/lock consumers、Node 24 官方文档、旧 JS 和 TencentDB-Agent-Memory；尚未修改目标源码或测试。

### 18.2 Monotonic clock 职责

`monotonic-clock` 把同步来源的非负 `bigint` 纳入进程内 `MonotonicMoment`：

- 默认来源为 `process.hrtime.bigint()`；
- 原点任意，与日期无关，不受墙上时钟校时影响；
- injectable clock 恰好调用一次；
- source throw、invalid result 和 wrong source type 稳定区分；
- 不缓存、不持久化，也不声称单次读数可证明多次调用递增。

Rooted lock 通过 `readMonotonicClock()` 获取默认读数；deadline 算法消费 `MonotonicMoment` 类型。任何 timeout/elapsed 判断都不使用 `Date.now()`。

### 18.3 Monotonic duration 职责

`monotonic-duration` 拥有两种纯构造：

1. 同一 clock source 的 `end - start` 精确非负纳秒；
2. 非负 safe-integer milliseconds 到 nanoseconds 的无损转换。

`MonotonicDuration` 与 `MonotonicMoment` 使用不同品牌，BigInt 不能进入 JSON。Deadline 与 rooted lock 实际消费 millisecond conversion 和 duration type；`monotonicDurationBetween()` 当前没有直接生产调用，但它是从 moments 得到 elapsed duration 的唯一基础运算。

### 18.4 标准与外部实践

- Node 24 [`process.hrtime.bigint()`](https://nodejs.org/docs/latest-v24.x/api/process.html#processhrtimebigint) 是官方推荐替代 legacy tuple `process.hrtime()` 的 bigint API，直接返回任意过去原点的单调纳秒。
- `performance.now()` 也是单调来源，但返回浮点 milliseconds；Wakeflow deadline 已使用 bigint nanoseconds，改用它会增加精度转换和 rounding policy，没有收益。
- TencentDB-Agent-Memory 的性能指标部分使用 `performance.now()`，但大量 timeout、lock TTL 和 elapsed 逻辑仍使用 `Date.now()`。Wall clock 回拨可能影响这些判断；Wakeflow 当前把 persisted wall time 与 process-local timeout 明确分离，技术边界更稳健。

### 18.5 架构审阅结论

| 项目 | 结论 | 理由 |
| --- | --- | --- |
| `hrtime.bigint()` | `accept` | Node 原生单调纳秒，无 float rounding 或第三方依赖 |
| injectable raw bigint clock | `accept` | deterministic tests 与 guarded runtime revalidation，恰好一次调用 |
| `MonotonicMoment` / `MonotonicDuration` 双品牌 | `accept` | 防止把原点读数当作时长，也阻止未准入 bigint |
| duration between moments | `accept foundation completeness` | 纯业务无关基本运算；完整 owner/error/tests，不是 future business vocabulary |
| milliseconds conversion | `accept` | lock options 使用 number ms，转换无损；领域上限仍由 lock owner 持有 |
| moment order rejection | `accept` | 不把跨来源/回拨造成的负差误作 duration |
| JSON serialization failure | `accept` | process-local moment/duration 不得进入 durable record |
| same-source runtime proof | `caller-owned` | bigint 品牌无法携带函数实例身份；为此引入 clock class/generic brand 过度设计 |
| clock/duration class | `reject` | clock source 是函数，duration 是 immutable bigint；无实例状态 |

### 18.6 Foundation completeness 与剪枝界线

`monotonicDurationBetween()` 虽然当前直接生产调用为零，但不建议删除：

- 它不是某个未来业务名词、配置字段或兼容入口；
- 它完成 `Moment × Moment → Duration` 的最小基础 algebra；
- 删除后模块只剩协议 milliseconds adapter，反而被 rooted lock 当前形态绑架；
- 现有 ordered/exact、runtime brand、reverse-order 测试直接证明该基础合同；
- 维护成本小，未来 elapsed/observability consumer 不需要重新发明差值和负值策略。

这与删除 base64url、未来 durable kinds 或重复 digest representation 不矛盾：后者冻结了没有 consumer 的协议/业务选择；本函数只表达同源单调数轴上的基本数学关系。

### 18.7 唯一建议修改

`systemMonotonicClock` 没有生产 import；rooted lock 和所有正常调用都通过 `readMonotonicClock()` 使用默认值。与 wall clock 相同，公开底层 source 允许未来调用方绕过稳定的 source/result 错误映射。

建议：

- 将 `systemMonotonicClock` 改为文件内 const；
- direct test 不再直调它，而是连续两次调用 `readMonotonicClock()` 验证 non-negative/nondecreasing default moments；
- 保留所有 14 个 test cases、所有 duration functions、类型、错误和 consumers。

### 18.8 真实备选方案

**A．只私有化 system source（推荐）**

保持完整 Foundation duration algebra，只让 guarded clock reader 成为公开 effect boundary。行为与生产调用不变。

**B．严格按当前调用删除 duration-between 与 system source**

- 优点：公共 API 最小化到 rooted lock 当前需要的集合。
- 代价：把通用 Foundation 反向塑造成一个 lock adapter；删除有清晰数学职责和准确测试的基础运算，收益不足。

**C．引入 clock instance/source brand**

- 结论：`reject`。可在类型层表达同源 moments，但会要求 generic clock objects、跨模块 source parameters 和更复杂测试；当前 caller context 已足够。

### 18.9 测试基线

两个 focused 文件共 14 项：

```text
14 pass / 0 fail / 0 skip / 65.29225ms
TypeScript project build: pass
```

覆盖默认/注入/多次 clock、错误/行为结果、BigInt wire fence、duration exact/ms conversion、brand、order 和边界值。没有 stale fixture 或重复 test file。

### 18.10 用户决定与实现证据

用户确认采用 A。实现结果：

- `systemMonotonicClock` 改为文件内 const；
- direct test 只通过 `readMonotonicClock()` 读取两次默认来源；
- `monotonicDurationBetween()`、全部 duration 类型和错误保持不变；
- 未引入 clock class、source generic brand 或兼容出口。

项目 canonical focused runner 验证结果：

```text
Monotonic clock + duration focused: 14 pass / 0 fail / 0 skip / 58.2845ms
Removed public symbol references: 0
git diff --check: pass
```

一次先行的临时 `node --test --import tsx` 命令因仓库没有 `tsx` 依赖而在测试加载前失败；该命令不是项目测试入口，也不计入测试证据。随后使用项目定义的 `npm run test:typescript:focused` 完成上述真实验证。

## 19. FND-TIME-003

### 19.1 目标文件

- `src/foundation/time/monotonic-deadline.ts`

本单元只读了实现、直接测试、唯一生产 consumer `rooted-exclusive-file-lock.ts` 及其聚焦测试、旧 JS、TencentDB-Agent-Memory 和外部标准；尚未修改目标源码或测试。

### 19.2 真实职责与消费者

`monotonic-deadline` 只拥有同一进程、同一单调时钟来源上的三个纯运算：

1. `Moment + Duration → Deadline`；
2. `Deadline × Moment → reached`；
3. `Deadline × Moment → remaining Duration`，到期后归零。

它不读取时钟、不调用 timer、不休眠、不处理取消，也不定义 retry interval、最大等待或错误映射。调用方必须显式提供 `now`，因此一次领域判断不会暗中产生第二次时间观察。

唯一真实生产 consumer 是 `rooted-exclusive-file-lock.ts`：

- 获取锁前创建一次 acquisition deadline；
- 每轮使用单调读数判断是否到期；
- 用同一个 `now` 计算剩余时长；
- 在 lock owner 内把剩余纳秒向上取整为 Node timer 毫秒，并同时受 retry interval 与 Node timer 上限约束。

因此 Time 只提供算术事实，Filesystem lock 继续拥有调度和失败语义。

### 19.3 标准与成熟实现对照

- Node 24 [`process.hrtime.bigint()`](https://nodejs.org/docs/latest-v24.x/api/process.html#processhrtimebigint) 明确支持直接相减得到经过纳秒；当前 Moment/Duration 分离沿用这一数值能力，但加上品牌和稳定准入边界。
- Rust [`std::time::Instant`](https://doc.rust-lang.org/std/time/struct.Instant.html) 把 monotonic instant 设计成只能与 `Duration` 运算和相互比较的不透明进程内值，并提供 `checked_add`、`checked_duration_since` 与 saturating duration。这支持 Wakeflow 将 wall time、moment、duration 和 deadline 分开的方向。
- Rust `Instant` 需要 checked addition 是因为底层平台表示有界；JavaScript `bigint` 的这里不发生整数溢出，Wakeflow 的业务等待上限继续由 lock owner 输入合同承担，不在纯算法层重复设置上限。
- TencentDB-Agent-Memory 在 worker lock wait 中直接使用 `Date.now() + ttl`，HTTP/LLM 部分主要使用 timer 或 `AbortSignal.timeout()`；它没有独立的单调 deadline algebra。该方案实现简单，但 wall clock 调整会影响进程内等待判断。Wakeflow 当前边界更适合本地锁这一真实场景，不应回退为 `Date.now()`。

### 19.4 架构审阅结论

| 项目 | 结论 | 理由 |
| --- | --- | --- |
| 独立 `MonotonicDeadline` 品牌 | `accept` | 防止 moment、duration、deadline 在调用处混用 |
| 三个纯函数 | `accept` | 都被真实 lock consumer 使用，组成最小完整 deadline algebra |
| 显式传入 `now` | `accept` | 避免 query 隐藏 clock effect，并允许同一观察复用于 reached/remaining |
| 到期后 remaining 归零 | `accept` | 表达“无需继续等待”；与 duration-between 的反向顺序错误语义不同 |
| runtime revalidation | `accept` | 品牌只提供编译期区分，公开边界仍拒绝 forged number/negative bigint |
| deadline class / clock object | `reject` | 没有实例状态、生命周期或多来源协调需求 |
| scheduler、sleep、AbortSignal | `caller-owned` | 这些是具体 operation 的调度和取消政策，不属于纯时间算术 |
| 持久化或 UTC 转换 | `reject` | 任意原点只在当前进程时钟上下文内有意义 |

### 19.5 测试与维护成本

direct test 共 7 项，分别覆盖精确构造、零时长、到期边界、剩余时长、forged brands、deadline/now 准入和非 wire 品牌。没有 fixture、snapshot、概率断言或重复测试文件。

连同唯一 consumer 的 7 项锁测试，验证结果：

```text
Deadline + rooted lock focused: 14 pass / 0 fail / 0 skip / 911.40225ms
TypeScript project build: pass
```

锁测试的主要耗时来自真实临时目录和锁竞争，不应复制到 Time direct test；当前 direct/consumer 分层准确。

### 19.6 待确认决定

**A．原样接受（推荐）**

不修改源码或 direct test。确认后运行 Foundation Time 全部 5 个聚焦测试文件及 architecture gate，形成系统级收束结论，再进入 Numeric。

**B．删除 `isMonotonicDeadlineReached()`，统一以 remaining 是否为零判断**

可以减少一个函数，但会让布尔查询调用方依赖 duration 的 bigint 表示，且零 remaining 的业务表达不如 reached 明确；真实 consumer 同时需要两种语义，收益不足。

**C．把 deadline、clock 与 timer 合为 class**

`reject`。会把纯算术、effect、调度与取消耦合，扩大测试面并削弱调用方对单次时间观察的控制。

### 19.7 用户决定与系统验证

用户确认选择 A，目标源码和 direct test 原样保留。Foundation Time 全部五个测试文件及架构门结果：

```text
Foundation Time focused: 33 pass / 0 fail / 0 skip / 84.802125ms
Architecture: pass / 422 modules / 2582 dependencies
git diff --check: pass
```

## 20. Foundation Time 系统节点收束

### 20.1 最终依赖与职责

```text
portable persisted time
  → utc-instant
      严格 UTC 词法、Gregorian 复验、timeline comparison
  → wall-clock
      一次 UTC 观察与稳定 source/result 错误

process-local elapsed time
  → monotonic-clock
      hrtime.bigint() / injectable observation
  → monotonic-duration
      moment difference / integer milliseconds conversion
  → monotonic-deadline
      after / reached / remaining pure algebra
  → rooted-exclusive-file-lock
      retry、timer、AbortSignal 与领域错误
```

### 20.2 架构检查

| 检查项 | 结论 |
| --- | --- |
| wall / monotonic separation | portable timestamp 与 process-local elapsed 完全分离，不能相互转换 |
| effect ownership | 两个 clock reader 各拥有一次同步观察；duration/deadline 全部为纯函数 |
| consumer direction | Foundation Time 不依赖业务层；monotonic 只进入锁等待，UTC 进入持久记录与排序 |
| persistence | 只有严格 UTC 文本可进入 JSON/Schema；三个 monotonic bigint 品牌在 JSON 边界失败 |
| scheduling | timer、重试、取消、领域 timeout 均留在 lock 或具体 operation owner |
| zero consumer | 只保留 `monotonicDurationBetween()` 这一完整基础桥接运算；默认 clock source 和 raw epoch 出口已删除 |
| tests | 五个 direct 文件共 33 项；唯一真实 monotonic consumer 另有独立锁测试，不复制真实 I/O 成本 |
| dependencies | 仅使用 Node 原生 `hrtime.bigint()` 与 `Date`；无 Temporal polyfill、日期库或 timer wrapper |

### 20.3 节点结论

`Foundation Time = closed for current technical skeleton`。没有待抽象 clock class、scheduler、持久化 monotonic 值或未解决 P1/P2。未来若出现跨进程 deadline、lease expiry 或日历运算，必须作为新的 portable/domain time contract 单独设计，不能扩张当前 monotonic 类型。

## 21. FND-NUMERIC-001

### 21.1 目标文件

- `src/foundation/numeric/byte-count.ts`

Numeric 当前只有这一份生产文件。本单元只读了完整实现、direct test、全部生产引用、代表性 Stats/range/read/tree/hash consumers、旧 JS、TencentDB-Agent-Memory 与 Node/ECMAScript 官方文档；尚未修改目标源码或测试。

### 21.2 真实职责与扇入

`ByteCount` 表示可由 JavaScript `number` 精确区分的非负整数字节数量。当前模块提供：

- unknown number 的严格、非强制转换准入；
- Node bigint Stats 到安全 number 的无损转换；
- 两个 ByteCount 的溢出前检查加法；
- 最大安全整数常量；
- 品牌、稳定错误分类和脱敏路径。

共有 37 个生产文件直接导入本模块。主要出口的真实消费者为：

| 出口 | 模块外生产消费者 | 用途 |
| --- | ---: | --- |
| `parseByteCount` | 34 | owner 容量、Buffer/Uint8Array 长度、持久记录字段准入 |
| `byteCountFromBigInt` | 1 | `file-node-snapshot` 的 bigint `stats.size` |
| `addByteCounts` | 4 | SHA-256 累计、树预算、artifact manifest totals |
| `MAX_SAFE_BYTE_COUNT` | 2 | range end overflow 与完整安全数轴边界 |
| `subtractByteCounts` | 0 | 仅 direct test |

### 21.3 标准与成熟实现对照

- ECMAScript [`Number.isSafeInteger` / `Number.MAX_SAFE_INTEGER`](https://tc39.es/ecma262/2024/multipage/numbers-and-dates.html#sec-number.issafeinteger) 把 safe integer 定义为不会与另一整数共享同一 Number 表示的整数；当前 `0..2^53-1` 准入和加法前检查正确。
- Node 24 [`fs.Stats.size`](https://nodejs.org/docs/latest-v24.x/api/fs.html#statssize) 在 bigint Stats 模式返回 `bigint`；先验证再转换避免悄然丢失文件大小精度。
- Node 24 [`buffer.constants.MAX_LENGTH`](https://nodejs.org/docs/latest-v24.x/api/buffer.html#bufferconstantsmax_length) 在 64 位架构等于 `Number.MAX_SAFE_INTEGER`，32 位架构则只有 `2^31-1`。因此 `ByteCount` 只证明数值精确，不应声称任意值都可成功分配单个 Buffer；实际容量、平台限制和内存可用性继续由 I/O owner 负责。
- TencentDB-Agent-Memory 对文件大小、累计字节和阈值主要直接使用普通 `number`、默认 number Stats 与裸加减。它更简洁，但没有安全整数、来源转换、溢出或类型混用边界；Wakeflow 的高扇入本地文件系统需要当前窄类型。

### 21.4 架构审阅结论

| 项目 | 结论 | 理由 |
| --- | --- | --- |
| branded `number` | `accept` | 与 Node/JSON/数组长度生态直接兼容，同时阻止未准入 number 静态混入 |
| `parseByteCount` | `accept` | 高扇入、无 coercion、运行时重验 forged brand |
| bigint Stats adapter | `accept` | 明确区分来源并在 Number 转换前检查精度 |
| checked addition | `accept` | 四个 totals consumer 必须保持 ByteCount 品牌并拒绝溢出 |
| public maximum | `accept` | 两个 range consumer 需要完整安全数轴上界；不是领域默认容量 |
| stable error class | `accept` | 高扇入边界需要 owner 可映射的稳定 reason/path |
| generic numeric class | `reject` | 数值无实例状态；函数和品牌类型足够 |
| BigInt 贯穿所有 ByteCount | `reject` | 会破坏 JSON/Node number API 适配，而真实文件预算远低于 safe integer 上界 |
| Buffer allocation guarantee | `reject` | ByteCount 只证明精确数值；资源可分配性属于平台和调用 owner |

### 21.5 零 consumer subtraction 分析

`subtractByteCounts()` 当前没有生产消费者。四处文件读取循环确实执行减法，但语义是 `ByteCount − FileByteOffset` 或 `ByteCount − position`，不是两个独立字节数量相减；强行改用该函数需要错误地把位置授予 ByteCount 品牌。

它与保留的 `monotonicDurationBetween()` 不同：后者是 `Moment × Moment → Duration` 的唯一类型桥，删除会留下缺口；ByteCount subtraction 只是普通 number 减法的预包装，当前类型图没有需要它连接的两个角色。注释中的“剩余读取预算”也是未来假设，不是现有 consumer 事实。

### 21.6 测试基线

direct test 当前 8 项：number/bigint 正反准入、checked addition/subtraction、forged arithmetic brands 和静态品牌。验证结果：

```text
ByteCount focused: 8 pass / 0 fail / 0 skip / 65.285792ms
TypeScript project build: pass
```

没有 fixture、snapshot、随机值或跨领域集成。删除 subtraction 后预计保留 7 项；不需要新增测试。

### 21.7 待确认决定

**A．收敛到真实数值合同（推荐）**

- 删除零 consumer `subtractByteCounts()`；
- 删除 `subtraction-underflow` reason/message 和对应测试分支；
- 润色模块注释，明确 ByteCount 证明“可精确表示”，不证明任意单 Buffer 可分配；
- 保留 parse、bigint adapter、checked addition、maximum、品牌和稳定错误。

**B．保留 subtraction 作为完整非负计数 algebra**

实现本身正确，维护成本不高；但会继续保留一个只由假设场景支撑的公共表面，与本轮 consumer-driven 剪枝原则不一致。

**C．改成 bigint ByteCount 或引入 Numeric class**

`reject`。两者都会增加 Node/JSON 适配成本，却不改善 Wakeflow 当前有界本地文件场景。

### 21.8 用户决定与实现证据

用户确认采用 A。实现结果：

- 删除 `subtractByteCounts()`、`subtraction-underflow` reason/message；
- direct test 删除 subtraction case，并把 forged arithmetic test 收敛为 addition；
- 模块说明改为“可由 `number` 精确表示”，明确不授予单 Buffer 或内存可分配性；
- 其余 37 个生产 importers 无需修改。

验证结果：

```text
ByteCount focused: 7 pass / 0 fail / 0 skip / 49.990708ms
Removed symbol/reason references: 0
Architecture: pass / 422 modules / 2582 dependencies
git diff --check: pass
```

## 22. Foundation Numeric 系统节点收束

### 22.1 最终职责

```text
unknown number ──parseByteCount──────────┐
Node bigint Stats ──byteCountFromBigInt─┼→ ByteCount
                                        ├→ checked totals addition
                                        └→ owner-specific capacity/range/I/O
```

Numeric 只拥有安全整数精度、非负准入和加法溢出；文件位置由 `FileByteOffset` 拥有，Buffer 分配、单文件/树容量和读取循环均由对应 Filesystem 或领域 owner 拥有。

### 22.2 节点结论

`Foundation Numeric = closed for current technical skeleton`。当前只有一个高扇入文件，无重复 numeric facade、无全局单位库、无零 consumer 出口或未解决 P1/P2。未来只有真实 consumer 同时需要新的量纲与运算时，才新增独立品牌；不预建通用 quantity class。

## 23. FND-SCHEMA-001

### 23.1 目标文件

- `src/foundation/schema/runtime-json-schema.ts`

Schema 系统当前分为三层：

```text
Foundation runtime adapter
  └─ runtime-json-schema.ts

Contract authority
  ├─ 34 source *.schema.json
  └─ 34 generated *.generated.ts

Tooling
  └─ schema-types.ts / schema drift tests / MCP self-contained gate
```

本单元只审阅第一层；只读了 direct test、全部 23 个生产 consumers、代表性 Config/Event Sourcing/Ledger/Window codecs、Schema 源与生成关系、Ajv 官方文档、JSON Schema 2020-12 和 TencentDB-Agent-Memory。尚未修改目标源码或测试。

### 23.2 真实职责与调用链

`createRuntimeJsonSchemaValidator()` 为一个调用方提供闭合本地 Schema catalog：

1. root Schema 与最多 64 个显式 dependency 先进入无行为 `JsonValue` 快照；
2. dependency 必须拥有唯一非空 `$id`；
3. 创建严格 Ajv 2020 实例并注册 Wakeflow annotation keyword 与 ECMAScript Unicode regex format；
4. 只通过同步 `compile()` 解析本地 `$ref`，缺失引用直接失败，不配置网络 loader；
5. 返回模块级复用 validator；
6. 每次验证后立即把 Ajv 可变 errors 转成冻结 `{ok,value}` 或 `{ok:false,path}`，不暴露 keyword、Schema、data 或 message。

23 个生产模块都在模块初始化时创建 validator，并在调用前先使用 `parseJsonValue()` 把 unknown 输入变成独立、递归冻结的值。Schema 只负责结构准入；领域 parser 随后继续验证 durable ID、UTC、拓扑、revision 和 authority 关系。

### 23.3 标准与成熟实现对照

- [Ajv managing schemas](https://ajv.js.org/guide/managing-schemas.html) 建议编译一次并复用 validation function；当前所有 validators 都在模块作用域创建，不在请求循环中重新编译。
- [Ajv strict mode](https://ajv.js.org/strict-mode.html) 用于拒绝未知 keyword/format 和被静默忽略的 Schema 写法；当前 `strict: true` 与显式 Wakeflow keyword/regex format 符合这一方向。
- [Ajv options](https://ajv.js.org/options) 明确 `removeAdditional`、`useDefaults`、`coerceTypes` 默认均为 false，并建议不要重复传默认配置；当前没有启用任何非标准数据 mutation。
- [Ajv API](https://ajv.js.org/api.html) 明确 validator 的 `errors` 会被下一次调用覆盖；当前同步调用后立即复制唯一需要的 instance path，没有把 Ajv errors 作为持久或共享 authority。
- JSON Schema 2020-12 允许未知 keyword 作为 annotation；Ajv strict mode 需要预先声明。`x-wakeflow-runtime-export` 只作为 codegen annotation 注册为永真 keyword，不改变数据验证结果。
- TencentDB-Agent-Memory 主要以 Zod `safeParse()` 维护请求合同，同时仍有较多 `JSON.parse(...) as T`。Wakeflow 的 Schema 还必须直接供官方 MCP SDK、生成类型和持久文件共同消费，继续选择 JSON Schema + Ajv 比复制一份 Zod 合同更合适。

### 23.4 单实例建议的适用边界

Ajv 对一般应用建议复用一个实例，主要避免同一 Schema 被重复编译。Wakeflow 当前每个 owner 使用独立小 catalog，虽然会重复载入少量基础 dependency，但有三个重要性质：

- Foundation 不需要导入 34 份业务 Schema；
- 不存在全局可变 `$id` registry、模块加载顺序或跨领域冲突；
- 每个 root 仍只编译一次，validator 在该 owner 内长期复用。

把所有 Schema 放进共享 Ajv 实例需要新增更高层 catalog owner、同 `$id` 同内容判定及注册顺序。当前没有启动性能证据证明这些复杂度有收益。Ajv standalone generation 可能适合短生命周期 CLI，但应在后续 codegen 单元结合真实 candidate 启动与 bundle 证据判断，不能塞进本文件。

### 23.5 架构审阅结论

| 项目 | 结论 | 理由 |
| --- | --- | --- |
| Ajv 8.20 exact dependency | `accept` | 成熟 Draft 2020-12 validator；不自建关键字执行器 |
| schema/dependency JsonValue snapshot | `accept` | 编译前不执行 accessor、Proxy 或 schema object 行为 |
| local explicit dependency catalog | `accept` | `$ref` 闭合、无网络、无全局 registry 或加载顺序 |
| strict compile | `accept` | Schema 错误在模块初始化阶段稳定失败，不降级为 warning |
| non-mutating validation | `accept` | 不 coerce、不补默认、不删除额外字段；领域 parser 获得原始 admitted value |
| frozen minimal result | `accept` | 隔离 Ajv 可变 errors 与内部诊断，不复制整个 error tree |
| generic `<Value>` cast | `accept with codegen gate` | TypeScript 无法从运行时 Schema 自动推导；同源生成类型和漂移检查承担一致性 |
| validator class | `reject` | Ajv 已拥有编译状态；Wakeflow 只需闭包隐藏依赖实例 |
| shared global Ajv registry | `defer` | 需真实性能证据和高层 catalog owner，不能污染 Foundation |
| Zod 替换 | `reject` | 会造成 JSON Schema/MCP 与运行时 Zod 双权威 |

### 23.6 Direct test 审阅

当前 4 项全部通过：

```text
Runtime JSON Schema focused: 4 pass / 0 fail / 0 skip / 170.389916ms
TypeScript project build: pass
```

测试数量和运行成本合理，但内容存在三处可在原测试内修正的准确性问题：

1. “Schema and dependency admission execute no accessors” 实际只传入 hostile root，没有测试 dependency；
2. error helper 只断言 code/reason，没有锁定已经公开的稳定 path；
3. direct test 没有直接证明本适配器注册的 `x-wakeflow-runtime-export`、`format: regex`，也没有证明 admitted data 不被默认值、类型强制转换或额外字段删除所修改；这些目前主要由领域测试间接覆盖。

### 23.7 待确认决定

**A．接受生产实现，只修正现有 4 项测试（推荐）**

- 第一项同时覆盖 local `$ref`、Wakeflow annotation keyword 和 regex format；
- 第二项在现有 case 中证明 rejected data 不被 coerce/remove/default；
- 第三项实际加入 hostile dependency，且 getter 调用仍为零；
- error helper 增加稳定 `name/path` 断言；
- 不增加测试项、不修改生产 API、不建立全局 Ajv registry。

**B．立即改成共享 Ajv catalog**

更贴近 Ajv 的一般性能建议，但会引入跨领域注册状态和 source→domain 依赖问题；当前无性能证据，`defer`。

**C．在本轮生成 standalone validators**

可能降低短生命周期进程启动成本，但属于 codegen、制品与 CSP 选择，不是 runtime adapter 局部修复；留到下一 Schema 单元比较。

### 23.8 用户决定与实现证据

用户确认采用 A。生产源码保持不变，只调整 `runtime-json-schema.test.ts`：

- 第一项同时证明本地 external `$ref`、`x-wakeflow-runtime-export` 和 Unicode regex format；
- 第二项证明 rejected admitted data 不被类型强制转换、额外字段删除或默认值填充；
- 第三项分别传入 hostile root 与 hostile dependency，两个 getter 均保持零调用；
- error helper 增加稳定 `name/path` 断言；
- 测试总数仍为 4。

验证结果：

```text
Runtime JSON Schema focused: 4 pass / 0 fail / 0 skip / 135.169375ms
TypeScript project build: pass
```

## 24. FND-SCHEMA-002

### 24.1 目标文件

- `tooling/codegen/schema-types.ts`
- `tests/codegen/schema-types.test.ts`

本单元完整阅读了 1068 行生成器和 291 行 owner test；只读相邻的 MCP wire self-contained test、34 份 Schema、34 份生成结果、package scripts、`json-schema-to-typescript` 15.0.4 源码/API、Ajv、RFC 8259、ECMAScript 排序语义和 TencentDB-Agent-Memory。尚未修改目标文件。

### 24.2 当前生成链

```text
src/contracts/schemas (34 source authorities)
  → enumerate / size / single-link / JSON / $id / $ref / Ajv strict catalog
  → specialized projections
      durable kind tuple
      UTC / path / SHA-256 / TODO pattern sources
  → json-schema-to-typescript structural declarations
  → optional frozen runtime Schema constants (32)
  → same-parent stage directory
  → src/contracts/generated (build)
     or two .build generations + committed-byte comparison (check)
```

现有 6 项测试全部通过，约 884ms；覆盖当前 catalog、完整生成清单、两次确定性生成、提交结果漂移、外部引用关闭和 scratch scope。生成文件是机械输出，不作为额外手写审阅单元。

### 24.3 已确认正确的设计

| 项目 | 结论 | 理由 |
| --- | --- | --- |
| Schema source / generated 分离 | `accept` | 34 份 JSON 是手写 authority；34 份 TS 只由工具更新 |
| Ajv strict catalog validation | `accept` | 类型生成前先验证 Draft 2020-12、本地 `$id/$ref` 和自定义 keyword/format |
| 成熟类型生成依赖 | `accept` | `json-schema-to-typescript` 负责结构投影，Wakeflow 不自建完整类型生成器 |
| specialized runtime projections | `accept` | 5 个投影均有真实 parser/identity consumer；不是通用 registry |
| `unknownAny` / strict index signatures | `accept` | 不把未知 Schema 结构静默扩大为 `any` |
| build/check 分离 | `accept` | build 才写提交目录；check 只写 `.build` 并比较两次生成与 committed bytes |
| output digest | `accept` | 路径、NUL 分隔和精确文件 bytes 共同进入 SHA-256 |
| output scope / symlink / hardlink / capacity | `accept within source-maintenance threat model` | 阻止常规越界与残留；不声称 Node 提供 openat 级并发敌手隔离 |

### 24.4 问题一：已准入 Schema 被第三方再次读取

`loadSchemaCatalog()` 已经读取、解析、验证并 `structuredClone` 每份 Schema；但普通生成分支随后调用 `compileFromFile(sourcePath)`。`json-schema-to-typescript` 的实现会再次 `readFileSync` 和解析根 Schema，而 external refs 却来自第一次快照的 `byId` map。

因此同一次生成可能组合：

```text
root = 第二次磁盘读取
dependencies / runtime constant = 第一次 admitted snapshot
```

如果文件在两次读取之间变化，生成类型和运行时 Schema 可以来自不同事实。这违反本工具自己声明的单一 authority，也让前面的 size/link/Ajv 检查不能完整约束真正交给生成器的 root。

官方 [`json-schema-to-typescript` API](https://github.com/bcherny/json-schema-to-typescript#api) 同时提供 `compile(schemaObject, name, options)`。应改为只把 `record.schema` 快照交给 `compile()`，删除 `sourcePath` 二次读取；外部 resolver 继续只返回同一 catalog 的 clone。

### 24.5 问题二：重复 JSON 名称被静默折叠

Schema source 当前直接 `JSON.parse()`。RFC 8259 指出对象名称 [SHOULD 唯一](https://www.rfc-editor.org/rfc/rfc8259#section-4)，不同实现对重复名称可能保留首项、末项、全部或报错。对 Schema authority 而言，重复 `$id`、`properties`、`required` 或约束关键字不能采用“最后一个获胜”。

仓库已经精确依赖 `jsonc-parser@3.3.1`，且 Claude settings owner 用其严格 parse tree 检测重复键。Codegen 应复用同一成熟 parser 的严格树，仅用于：

- 拒绝 comments / trailing comma / parse errors；
- 递归拒绝同一 object 的重复键；
- 然后再产生普通 JSON value 供 Ajv 和类型生成器使用。

不需要为 Schema 自建另一个 JSON parser，也不能只在顶层检查。

### 24.6 问题三：确定性排序依赖 locale

生成器三处目录/record 排序使用 `localeCompare()`。ECMA-402 将其定义为 locale-sensitive、部分实现相关的 collation，不适合生成摘要或跨主机 committed output。当前 `en-US` 环境已经可观察到：

```text
code-unit: Z.schema.json, a.schema.json
locale:    a.schema.json, Z.schema.json
```

应在本文件使用一个明确的 UTF-16 code-unit comparator，并统一所有 Schema/生成路径、refs 和 records 排序。其他 tooling 文件中的 `localeCompare()` 留给各自后续审阅单元，不能借本轮扩大修改范围。

### 24.7 问题四：JSON 到 JavaScript 对象字面量并非一一对应

`runtimeSchemaModuleLines()` 当前把 `JSON.stringify(record.schema)` 直接嵌入 TypeScript 对象字面量。普通键通常相同，但对象字面量中的 colon-form `"__proto__"` 具有特殊 prototype setter 语义：

```text
{"__proto__":{"marker":true}}
→ 没有 own "__proto__"，prototype 被替换

JSON.parse('{"__proto__":{"marker":true}}')
→ 保留 own "__proto__"，prototype 仍是 Object.prototype
```

JSON Schema 可以合法描述名为 `__proto__` 的 JSON 属性；生成器不能要求业务 Schema 回避它。建议将运行时 Schema 发射为双重转义的 JSON 文本，由原生 `JSON.parse()` 恢复，再递归冻结。32 个 runtime Schema 会机械重生成；消费者都把常量作为 Schema 值传入 Ajv/MCP，没有依赖对象字面量的 literal type。

### 24.8 不建议同步实施的扩张

- 不把四种 pattern projection 提前改成配置 registry；显式白名单仍小且真实。
- 不生成 standalone Ajv validators；启动性能尚无可信证据，且应与 candidate 制品一起评估。
- 不建立跨领域全局 Ajv catalog。
- 不把 Schema codegen 接入 runtime RootedDirectory；tooling 编译边界和 source-maintenance threat model 不同。
- 不顺手修改 test runner、artifact builder 中的其他 `localeCompare()`。
- 不把 recoverable generated directory replacement 升级为业务事务；build 输出可由 source 重建，check 本身不写提交目录。

### 24.9 测试基线与调整原则

当前：

```text
Schema codegen focused: 6 pass / 0 fail / 0 skip / 883.778583ms
34 schemas / 34 generated files
```

建议仍保留 6 项，不复制完整 build/check：

- catalog case 增加 code-unit 文件名顺序；
- invalid-catalog case 同时覆盖 recursive duplicate key 和 unknown external ref；
- generation case证明 runtime Schema 使用安全 JSON restore，并包含 own `__proto__` fixture；
- 现有 real catalog、两次 determinism、drift 和 scratch scope 保持。

### 24.10 待确认决定

**A．修复四个 codegen correctness 边界（推荐）**

1. `compileFromFile` → admitted snapshot `compile`；
2. strict parse tree 拒绝递归重复键；
3. 全文件使用 code-unit comparator；
4. runtime Schema 通过 JSON text restore 后递归冻结；
5. 仍保持 6 项 owner tests，运行 schema build/check、typecheck 和 architecture；
6. 机械重生成文件不逐个手改。

**B．只修复二次读取与排序**

改动较小，但继续允许重复 key authority 和 `__proto__` runtime 漂移；没有合理理由留下两个已知反例。

**C．同时引入 singleton/standalone/refactor registry**

`reject`。这些属于性能或可扩展性选择，不是本轮已证明的 correctness 缺口。

### 24.11 用户决定与实现证据

用户确认采用 A。实现结果：

- Schema source 先由 `jsonc-parser` strict parse tree 递归拒绝重复键，再产生 JSON value；
- 普通类型生成从 `compileFromFile()` 改为官方 `compile(admittedSchema, name)`，root 与 dependencies 均来自同一 catalog snapshot；
- Schema 文件、目录项、external refs、records 和生成输出统一使用 code-unit comparator；
- 32 个 runtime Schema 常量改由安全 JSON text restore 后递归冻结，`__proto__` fixture 保留为 own key；
- 34 份 generated 文件只通过 `npm run schema:build` 机械更新；
- owner tests 仍为 6 项，没有新增 test file 或 test count。

第一次手写修改后的 preflight TypeScript compile 在 `compile(...)` options 闭合处准确发现一处括号错误；该失败发生在 `schema:build` 前，没有改写提交型生成目录。修正后先在 `.build` 成功预生成，再执行正式 build。

验证证据：

```text
Schema codegen focused: 6 pass / 0 fail / 0 skip / 853.686875ms
Runtime Schema representative consumers: 12 pass / 0 fail / 0 skip / 690.85075ms
MCP self-contained Schema: 1 pass / 0 fail / 0 skip / 62.787375ms
Schema build/check: 34 schemas / 65 external-ref edges
Generated digest: sha256:34ca54989ed4779a561eddd81b3f3f83488cd02f7985a65f2f27701d5dd6757f
TypeScript typecheck: pass
Architecture: pass / 422 modules / 2582 dependencies
git diff --check: pass
```

双制品候选继续闭合：

```text
Codex: 213 compiled files / sha256:28a00a39cb194b226822ee8f20fa47e0a0403851930f653c25aa6c7090a31e23
Claude Code: 218 compiled files / sha256:b5a095bdace7938fb20b8c4d2bc7824237701aa37a3806f413bd48231af85faf
```

## 25. Foundation Schema / Schema Tooling 系统节点收束

### 25.1 最终职责

```text
Schema source authority
  → strict source catalog
      unique JSON keys / $id / local $ref / Ajv 2020 strict
  → admitted in-memory snapshot
      ├─ json-schema-to-typescript structural types
      ├─ explicit pattern / enum projections
      └─ safe restored + recursively frozen runtime Schema
  → committed generated output
      two-build determinism + exact-byte drift check

unknown runtime data
  → parseJsonValue passive frozen snapshot
  → isolated compiled Ajv validator
  → frozen minimal validation result
  → domain parser / owner authority
```

### 25.2 架构检查

| 检查项 | 结论 |
| --- | --- |
| source authority | 34 份 JSON Schema 是唯一手写结构合同；generated TS 不手改 |
| runtime validation | Ajv 8.20 严格编译、无网络、无 coercion/default/remove |
| codegen source identity | root、dependencies、runtime constant 全部来自一次 admitted catalog snapshot |
| determinism | code-unit order、两次独立生成、路径+NUL+bytes digest、committed drift gate |
| JSON interoperability | recursive duplicate keys fail closed；runtime restore 保留 `__proto__` own key |
| type/runtime boundary | generated type 是编译期 projection；Ajv 是结构 runtime gate；domain parser 拥有关系语义 |
| external MCP | entrypoint Schema 自包含且 Foundation 词法镜像有独立 gate；详细语义留到 MCP owner review |
| global state | 无全局 Ajv registry、无 Schema service locator、无网络 loader |
| tests | runtime 4 + codegen 6；真实 consumer/MCP gate 分层，不复制 34 份逐文件 snapshot |

### 25.3 节点结论

`Foundation Schema + Schema Tooling = closed for current technical skeleton`。每份业务 Schema 的字段语义将在对应 Config、TODO、Ledger、Demand、Window 或 MCP owner 单元中审阅，不把 34 份业务合同误当成 Foundation 一次性审完。Standalone validator 和共享 Ajv 只有在真实启动/制品证据出现时才重开。

Rooted Filesystem 依赖一个尚未系统审阅的 Node error observation，因此下一单元先补 `FND-NODE-001`，再进入路径、节点与 RootedDirectory。

## 26. FND-NODE-001

### 26.1 目标文件

- `src/foundation/node/node-system-error.ts`

本单元只读了完整实现、direct test、全部生产 consumers、Node 24 官方 Error/Util 文档、Rooted Filesystem/Git/Demand 调用链和 TencentDB-Agent-Memory；尚未修改目标源码或测试。

### 26.2 真实职责与扇入

该模块只从未知异常中取得一个稳定 `code` 字符串观察：

- 候选必须是真实 Error object；
- Proxy 在任何 descriptor reflection 前被拒绝；
- `code` 必须是自有 data descriptor，不执行 getter；
- 只接受 `E...` 大写词法并排除 Node `ERR_*` 内部错误；
- 不读取 `message/path/syscall/errno/stack/cause`；
- 不把 code 解释为文件身份、恢复许可或业务错误。

`readNodeSystemErrorCode()` 有 19 个模块外生产文件、27 个调用点，覆盖 `ENOENT`、`EEXIST`、`ELOOP`、`EXDEV`、`ESRCH` 等 Filesystem/Git/Event Store 分支。所有生产 consumers 都直接读取 code snapshot 后与自己拥有的 exact code 比较。

另外三个公开表面只有 direct test、没有生产 consumer：

- `isNodeSystemError()`；
- `hasNodeSystemErrorCode()`；
- `NodeSystemError` interface。

### 26.3 Node 24 标准变化

Node 官方 Errors 文档明确建议用 [`error.code`](https://nodejs.org/docs/latest-v24.x/api/errors.html#errorcode) 区分系统错误，因为 `message` 可在版本间变化；当前模块读取 code 的方向正确。

但 Node 24.2 已将 [`util.types.isNativeError()`](https://nodejs.org/docs/latest-v24.x/api/util.html#utiltypesisnativeerrorvalue) 标记 deprecated，要求使用 `Error.isError()`。项目 runtime engine 已冻结为 `>=24.19.0 <25`，本机 24.19.0 也实测：

```text
typeof Error.isError = function
real Error = true
Error.prototype spoof = false
```

官方说明 `Error.isError()` 与旧 API 都能识别 cross-realm Error，且不会把单纯继承 `Error.prototype` 的对象当作 Error。该 utility 只运行在异常路径，不构成保留 deprecated API 的性能理由。

### 26.4 架构审阅结论

| 项目 | 结论 | 理由 |
| --- | --- | --- |
| exact `error.code` snapshot | `accept` | Node 官方稳定分支字段；不携带路径和 message |
| own data descriptor | `accept` | accessor/inherited code 不执行、不授权 |
| Proxy precheck | `accept` | reflection 前 fail closed，保留 `types.isProxy()` |
| `Error.isError()` | `fix` | Node 24 当前标准；替换 deprecated `types.isNativeError()` |
| lexical E-code filter | `accept with provenance clarification` | 阻止 `ERR_*`/malformed；调用 operation context 而非词法证明错误确由 Node 抛出 |
| `isNodeSystemError()` | `delete` | 零 consumer；返回 type guard 后再读可变 `.code` 不如直接 snapshot |
| `hasNodeSystemErrorCode()` | `delete` | 零 consumer；生产代码已统一使用 `read(...) === exactCode` |
| `NodeSystemError` interface | `delete` | 只服务零 consumer type guard，不代表不可变错误事实 |
| class / registry / errno map | `reject` | 本模块无状态，也不需要把平台 code list 变成第二权威 |

### 26.5 Tencent 对照

TencentDB-Agent-Memory 多处直接使用 `(err as NodeJS.ErrnoException).code`。这种写法简洁，但 TypeScript cast 不做 runtime 验证，也可能读取 getter、Proxy 或普通 spoof record。Wakeflow 的 passive descriptor snapshot 更适合高扇入文件内核；只需切换已废弃的 Error 身份 API，不应退回 cast。

### 26.6 测试基线

当前 direct test 8 项全部通过：

```text
Node system error focused: 8 pass / 0 fail / 0 skip / 62.817292ms
TypeScript project build: pass
```

其中最后两项只测试零 consumer convenience APIs。推荐删除后保持 6 项，并在现有 native/plain-object cases 中补 cross-realm Error 正例和 `Error.prototype` spoof 反例，不新增 test。

### 26.7 待确认决定

**A．迁移 Node 24 标准并收敛到 code snapshot（推荐）**

- `types.isNativeError()` → `Error.isError()`；
- 删除不再需要的 `isObjectOrFunction()`；
- 删除 `isNodeSystemError()`、`hasNodeSystemErrorCode()`、`NodeSystemError`；
- 注释明确 code 是观察结果，不单独证明 Node provenance；
- direct tests 8 → 6，加入 cross-realm 与 prototype-spoof 证据。

**B．只替换 deprecated API，保留两个 convenience wrappers**

行为也正确，但继续维护零 consumer 表面和对应两项测试，不符合当前收敛原则。

**C．改用 `NodeJS.ErrnoException` cast 或错误 class hierarchy**

`reject`。cast 没有运行时安全性，class hierarchy 会把平台异常包装成多余状态对象。

### 26.8 用户决定与实现证据

用户确认采用 A。实现结果：

- `types.isNativeError()` 替换为 Node 24 `Error.isError()`；
- 当前 TypeScript lib 尚未声明该 Node 24.19 静态方法，因此只增加文件私有 `Node24ErrorConstructor` 类型桥，没有全局 augmentation；
- 删除 `isObjectOrFunction()`、`isNodeSystemError()`、`hasNodeSystemErrorCode()` 和 `NodeSystemError`；
- 保留唯一生产 API `readNodeSystemErrorCode()`、词法类型和 Proxy/descriptor 防线；
- direct tests 从 8 收敛为 6，并在原 cases 中补 cross-realm Error 与 Error.prototype spoof。

验证结果：

```text
Node system error focused: 6 pass / 0 fail / 0 skip / 54.244167ms
Removed API / deprecated symbol references: 0
TypeScript typecheck: pass
Architecture: pass / 422 modules / 2582 dependencies
git diff --check: pass
```

## 27. Foundation Node 系统节点收束

`Foundation Node = closed for current technical skeleton`。当前只保留一个无状态、无行为执行的 error code snapshot primitive；它不包装 Error、不建立 errno registry、不推断恢复性。Rooted Filesystem 和 Git owners 继续拥有各自 exact code 的语义映射。

## 28. FND-FS-001

### 28.1 目标文件

- `src/foundation/filesystem/portable-resource-path.ts`
- `src/foundation/filesystem/file-node-snapshot.ts`

本单元只读了两份实现、direct tests、portable path Schema/generated、全部生产引用、RootedDirectory/读写/atomic consumers、旧 JS、TencentDB-Agent-Memory、Node 24 Path/Stats 文档、Unicode UAX #15 与 POSIX stat；尚未修改目标源码或测试。

### 28.2 两种不同事实

```text
PortableResourcePath
  = 持久、根内、正斜杠分段的逻辑引用
  ≠ OS absolute path / URL / config placement / existence proof

FileNodeSnapshot
  = 一次 bigint Stats 的冻结物理观察
  ├─ dev + ino              → same physical identity observation
  └─ mode/link/owner/size/time → same complete observation
  ≠ content digest / path ownership / permission policy / recovery authority
```

两者不应合并：同一逻辑路径可在时间上指向不同 inode，同一 inode 可有多个 hard-link 路径。RootedDirectory 后续负责把逻辑 path 与根作用域物理观察组合。

### 28.3 Portable path 真实职责与扇入

该模块有 90 个直接生产 importers；`parsePortableResourcePath()` 被 46 个模块使用，`splitPortableResourcePath()` 被 10 个模块使用。它拥有：

- Schema 派生结构 pattern；
- non-empty、root-relative、`/` 分段；
- absolute、scheme-like、backslash、empty/dot/traversal、控制字符与 segment-edge whitespace 拒绝；
- well-formed Unicode 与 NFC；
- 不 trim、不 slash-convert、不 normalize；
- 品牌和稳定错误；
- 重新验证后的冻结非空 segments。

它明确不拥有路径长度、OS 保留名称、case/NFC collision、symlink、存在性和根解析。这些需要物理文件系统或具体 owner context。

Node [`path.normalize()`](https://nodejs.org/docs/latest-v24.x/api/path.html#pathnormalizepath) 会解析 dot segments、合并 separators 并转换为平台 separator，因此不适合作为 portable wire admission。Unicode [UAX #15](https://www.unicode.org/reports/tr15/) 说明 NFC 可让 canonically equivalent 文本取得唯一二进制表示；当前“必须已经是 NFC、不能自动修复”适合作为持久 identity 合同。

### 28.4 Portable path 冗余分支

当前 `parsePath()` 在 Schema pattern 通过后仍调用 `parseSegments()`；后者再次检查 empty、`.`、`..` 和 edge whitespace。但这些输入已经分别被同一 Schema pattern 的 leading/trailing slash、double slash、dot-segment 和 whitespace lookahead 拒绝。

结果是：

- `segment` error reason 没有测试或 consumer；
- 对 19,530 个由代表性字符组合出的候选执行诊断，没有一次到达 `segment`；
- 更关键的是，常用 `parsePortableResourcePath()` 每次都 split/freeze 一个随后立即丢弃的数组；只有 `splitPortableResourcePath()` 真正需要 segments。

应让 Schema 派生 pattern 成为唯一结构词法 owner，并只在 split API 中分段。

### 28.5 File node snapshot 真实职责与扇入

该模块有 61 个直接生产 importers；模块外使用量为：

| API | 生产文件 |
| --- | ---: |
| `createFileNodeSnapshot` | 11 |
| `sameFileNodeIdentity` | 14 |
| `sameFileNodeSnapshot` | 32 |

实现从一次 bigint Stats 的自有 data descriptors 取得 `dev/ino/mode/nlink/uid/gid/rdev/size/mtimeNs/ctimeNs`，忽略 Node Stats 的额外字段和原型方法。`kind` 与 `permissionBits` 从 raw mode 派生，size 经 ByteCount 准入；snapshot 比较前会重新复验 closed shape 与派生字段一致性。

POSIX 明确规定 [`st_dev + st_ino`](https://pubs.opengroup.org/onlinepubs/9699919799/basedefs/sys_stat.h.html) 共同标识系统内文件，Node 24 bigint Stats 提供相同字段及纳秒时间。当前区分 identity comparison 与 complete observation comparison 是正确的；文档也已明确 inode 复用、内容摘要和 authority 不由该结果证明。

### 28.6 架构审阅结论

| 项目 | 结论 | 理由 |
| --- | --- | --- |
| logical path / physical node 分离 | `accept` | 路径不是 inode，inode 也不是路径或业务身份 |
| Schema-derived path pattern | `accept` | wire 结构单一权威；运行时补 Unicode/NFC |
| strict no-normalize admission | `accept` | 不把多种调用方输入静默折叠成同一持久 identity |
| split API | `accept` | 10 个真实 parent/name/chain consumers；返回新冻结数组 |
| duplicate segment validator | `simplify` | 与 generated pattern 重复且不可达，普通 parse 还产生无效分配 |
| raw bigint Stats projection | `accept` | 不调用 Stats 方法、不损失 dev/ino/time 精度 |
| derived kind/permission | `accept` | 高扇入 policies 需要易读事实；raw mode 保留完整位域 |
| identity vs snapshot comparison | `accept` | 两种语义均有大量真实 consumers，不能合并 |
| class | `reject` | 路径与 snapshot 都是冻结数据；只有稳定错误使用 class |
| path manager / OS reserved registry | `reject` | 会把 portable wire、平台 policy 和 root effect 错误合并 |

### 28.7 旧项目与 Tencent 对照

旧 JS 在多个模块重复 `path.resolve(...ref.split("/"))`、`dev/ino` 比较和局部 Stats 检查；新 TS 将词法、节点事实与 RootedDirectory 分层，避免各业务 owner 自行定义安全边界。

TencentDB-Agent-Memory 主要直接 `path.join/resolve`、普通 number Stats，并存在 `resolved.startsWith(path.resolve(workspaceDir))` 形式的字符串前缀检查；后者无法区分 `/root/a` 与 `/root/ab`，也不处理 symlink chain。Wakeflow 不应回退到这一层级，但也不应把完整 RootedDirectory 行为塞进 portable path parser。

### 28.8 测试基线

```text
Portable path + file node snapshot: 16 pass / 0 fail / 0 skip / 63.894958ms
TypeScript project build: pass
```

两文件各 8 项。Path 覆盖词法、Unicode、NFC、split 和 brand；node 覆盖真实 file/directory/symlink、全部 mode 分类、精确物理字段、ByteCount、passive input、identity/snapshot 与 forged snapshot。没有重复 fixture 或不必要集成。

### 28.9 待确认决定

**A．只收敛 portable path 内部重复（推荐）**

- `parsePath()` 改为只返回已准入 `PortableResourcePath`；
- 普通 parse 不再 split/freeze 临时数组；
- `splitPortableResourcePath()` 在重新准入后才执行一次 `split("/")` 与 freeze；
- 删除不可达 `segment` reason/message 和 `ParsedPortableResourcePath`/重复 validator；
- accepted/rejected path 行为与现有 8 项测试保持不变；
- `file-node-snapshot.ts` 原样接受。

**B．保留双重 segment 检查作为防御**

不会造成功能错误，但让 Schema 与手写结构规则成为双权威，同时保留不可观察分支和高扇入无效分配。

**C．新增 Path class、parent/basename manager 或平台保留名配置**

`reject`。现有 split primitive 已满足真实 consumers；平台和根语义属于后续 RootedDirectory/owner。

### 28.10 用户决定与实现证据

用户确认采用 A。实现结果：

- 删除 `segment` reason/message、`ParsedPortableResourcePath` 和重复 `parseSegments()`；
- path admission 只返回品牌字符串，不再为 46 个 parse consumers 创建废弃 segments；
- `splitPortableResourcePath()` 重新准入后才执行一次 split/freeze；
- `file-node-snapshot.ts` 原样保留；
- 两份 direct tests 都未增加或删除 case。

验证结果：

```text
Portable path focused: 8 pass / 0 fail / 0 skip / 63.366917ms
Path + FileNodeSnapshot: 16 pass / 0 fail / 0 skip / 64.366166ms
Removed branch/type/helper references: 0
Architecture: pass / 422 modules / 2582 dependencies
git diff --check: pass
```

## 29. FND-FS-002

### 29.1 目标文件

- `src/foundation/filesystem/rooted-directory.ts`

本单元只读了 483 行实现、277 行 direct test、全部生产 consumers、相邻 parent/exact handle 与 stable read/atomic owners、旧 JS、TencentDB-Agent-Memory 和 Node 24 FileHandle/lstat/realpath/open flag 官方文档；尚未修改目标源码或测试。

### 29.2 核心职责

`RootedDirectory` 是少数应使用 class 的 Foundation 能力，因为它真实持有：

- 规范物理绝对根路径；
- 一个使用 `O_RDONLY | O_DIRECTORY | O_NOFOLLOW` 打开的目录 `FileHandle`；
- 初始根节点 snapshot；
- open/closed 生命周期。

打开过程执行：

```text
strict absolute input
→ lstat original spelling（final root 不得 symlink）
→ realpath 固定 trusted ancestor aliases
→ lstat canonical path
→ no-follow directory open
→ fstat(handle) + lstat(path) + realpath(path)
→ dev/ino identity closure
→ 签发 RootedDirectory
```

资源观察过程逐段 `lstat`，中间段必须是真实目录且不能是 symlink；最终 symlink 只观察链接本身。首轮观察后重新检查根与所有路径段，最终普通节点使用完整 snapshot，最终目录只使用 identity，以免合法 sibling mutation 被误判为目录替换。

### 29.3 真实扇入

该模块有 98 个直接生产 importers。主要公开面使用量：

| 能力 | 模块外生产文件 |
| --- | ---: |
| `RootedDirectory.open()` | 10（12 个调用点） |
| `absolutePath` | 19 |
| `assertCurrent()` | 20 |
| `inspectExistingResource()` | 27 |
| `close()` / disposal | 25 |
| `RootedResourceSnapshot` | 8 |
| `initialSnapshot` | 0 |
| `isClosed` | 0 |

RootedDirectory 是 Config、Workspace、TODO、Ledger、Demand、Git 和全部稳定/耐久文件操作的物理根能力，不是可删候选。

### 29.4 标准与平台边界

Node 24 文件系统文档确认：

- [`lstat()`](https://nodejs.org/docs/latest-v24.x/api/fs.html#fspromiseslstatpath-options) 观察 symlink 本身；
- `O_DIRECTORY` 保证 open target 是目录，`O_NOFOLLOW` 使 final symlink open 失败；
- [`FileHandle.stat()`](https://nodejs.org/docs/latest-v24.x/api/fs.html#filehandlestatoptions) 允许从已打开 descriptor 观察节点；
- FileHandle 必须显式关闭，Node 24.2 的 async disposal 已稳定。

Node 官方反对“stat 后直接操作”是因为单一 precheck 存在竞态；当前能力没有把 precheck 当证明，而是把 lstat、realpath、no-follow open、fstat 与 post-lstat 组合，并明确承认没有 `openat/openat2` 时仍不能抵抗持续恶意 rename/symlink swap。

`O_DIRECTORY/O_NOFOLLOW` 缺失时稳定返回 `unsupported-platform`，没有静默降级。当前 TS candidate engine 固定 Node 24.19；该合同适用于具有这些 no-follow directory flags 的宿主。

### 29.5 已确认合理的设计

| 项目 | 结论 | 理由 |
| --- | --- | --- |
| stateful class | `accept` | 持有 FileHandle、初始 identity 和关闭状态 |
| private constructor + static open | `accept` | 未闭合 root 检查前不签发实例 |
| ancestor alias canonicalization | `accept` | macOS `/var` 等 trusted ancestor alias 可固定成真实根；final root symlink 仍拒绝 |
| stepwise lstat | `accept` | 中间 symlink/non-directory 在进入上层 I/O 前失败 |
| final symlink observation | `accept` | inspection 不跟随目标，具体 owner 再决定是否拒绝 |
| handle/path/root identity closure | `accept` | descriptor 与 pathname 必须持续指向同一 dev/ino |
| directory identity-only recheck | `accept` | 合法 sibling mutation 会改变 mtime/ctime，不代表目录替换 |
| explicit close + async dispose | `accept` | FileHandle 生命周期确定；close 后 operation fail closed |
| physicalPath exposure | `accept process-local only` | 真实 I/O consumers 需要；不得进入 portable record |

### 29.6 问题一：零 consumer 状态观察面

`initialSnapshot` 和 `isClosed` 都只有 direct test 使用：

- `initialSnapshot` 是内部根 identity authority 的只读泄露，调用方没有需要自行比较它；
- `isClosed` 只是内部布尔状态镜像，真实合同已由幂等 `close()` 和关闭后所有 I/O 的稳定 `closed` 错误证明。

删除二者不会影响 98 个生产 importers，反而减少调用方把旧初始 snapshot 当当前状态或把布尔值当操作许可的风险。

### 29.7 问题二：初始缺失与观察期间消失未区分

`root-not-found` / `resource-not-found` 应表示首次观察时目标不存在；`root-changed` / `resource-changed` 应表示已经观察或打开后发生漂移。

当前存在两处混用：

- `assertCurrent()` 中已打开 root pathname 消失，仍由 `inspectPathNode(..., "root-not-found")` 返回初始缺失；
- `inspectExistingResource()` 第二轮复验已观察 entry 时消失，仍返回 `resource-not-found`。

这会让 owner 把竞态删除误作普通 absent。应让 private inspection helper 接受准确 missing reason：open 的首次 lstat 才使用 `root-not-found`，后续 root 复验使用 `root-changed`；资源首轮使用 `resource-not-found`，第二轮使用 `resource-changed`。在 lstat 后的 realpath 阶段遇到 ENOENT 也应映射为对应 changed reason。

### 29.8 不扩张的边界

- 不声称形成恶意进程沙箱；Node 仍无 openat/openat2。
- 不把 child FileHandle、parent mutation、stable read 或 atomic write 并入本 class；相邻模块各有真实生命周期。
- 不增加 root registry、全局 workspace manager 或缓存。
- 不因 no-follow 不可用而退化到字符串前缀检查。
- 不自动处理不存在的目标；create 路径由 parent-handle/materialization owner 管理。

TencentDB-Agent-Memory 主要使用 `path.resolve/join` 和字符串 `startsWith` containment，没有持有根目录 descriptor 或完成 pathname/handle identity closure；Wakeflow 当前实现更适合其高价值本地状态，不能回退。

### 29.9 测试基线

```text
RootedDirectory focused: 10 pass / 0 fail / 0 skip / 84.030083ms
TypeScript project build: pass
```

覆盖真实 handle root、input、root symlink/file、nested inspection、directory mutation、intermediate/final symlink、pathname replacement、forged path、close/disposal contract。没有重复 snapshot 或跨业务 fixture。

### 29.10 待确认决定

**A．保持核心设计，只收紧状态面与漂移分类（推荐）**

- 删除零 consumer `initialSnapshot`、`isClosed` getters；
- 保留 private initial snapshot 和 closed state；
- root 首次缺失保持 `root-not-found`，签发前后已观察消失改为 `root-changed`；
- resource 首轮缺失保持 `resource-not-found`，第二轮/realpath race 改为 `resource-changed`；
- 在现有 pathname replacement test 中同时证明 missing 与 replacement，测试总数仍为 10。

**B．只删除 getters，不调整错误分类**

公共面更小，但已知竞态仍被错误降格为普通 absent，不推荐。

**C．重写为 openat 风格 native addon 或引入第三方 sandbox**

`defer/reject for current scope`。会改变部署和平台边界；当前目标是受信任本地工作区中的稳健内核，现有 class 已明确能力上限。

### 29.11 用户决定与实现证据

用户确认采用 A。实现结果：

- 删除零 consumer `initialSnapshot`、`isClosed` getters，private identity/closed state 保留；
- `inspectPathNode()` 的缺失原因改为调用阶段显式传入；
- open 首次 lstat 缺失仍为 `root-not-found`，随后 realpath/canonical/open/post-open 缺失为 `root-changed`；
- `assertCurrent()` pathname 缺失改为 `root-changed`；
- resource 首轮 lstat 缺失保持 `resource-not-found`，已观察后的 realpath/第二轮 lstat 缺失改为 `resource-changed`；
- pathname replacement 原测试同时证明 missing 和 replacement，测试总数仍为 10。

验证结果：

```text
RootedDirectory focused: 10 pass / 0 fail / 0 skip / 73.38675ms
Removed getter production references: 0
TypeScript typecheck: pass
Architecture: pass / 422 modules / 2582 dependencies
git diff --check: pass
```

## 30. FND-FS-003

### 30.1 目标文件

- `src/foundation/filesystem/rooted-resource-parent-handle.ts`

本单元只读了 451 行实现、223 行 direct test、全部 9 个生产 importers、8 个 open consumers、atomic stage/target、directory materialization、link/rename/unlink/settlement owners、Node/POSIX durability 文档和 TencentDB-Agent-Memory；尚未修改目标源码或测试。

### 30.2 核心职责

`RootedResourceParentHandle` 是另一个合理使用 class 的 Foundation capability：

```text
RootedDirectory + PortableResourcePath
  → split target address
  → inspect real parent under root
  → O_DIRECTORY | O_NOFOLLOW open parent
  → fstat(handle) + RootedDirectory path recheck
  → bind parent inode + target absolute address
  → inspectTarget / parent fsync / close
```

它处理根级目标和嵌套目标，目标可以不存在；父目录必须已经存在且不是 symlink。`inspectTarget()` 用 `lstat` 观察 final entry 自身，在前后复验父目录，但只返回一次 target observation；允许的 target kind、预期存在性、权限、hard-link 和 mutation 继续由上层操作 owner 决定。

### 30.3 为什么需要独立 Parent Handle

RootedDirectory 证明全局根没有被替换；Parent Handle 进一步证明将被修改的直接目录项容器没有被替换，并提供可 `fsync` 的 descriptor。POSIX durability rationale 明确指出 rename 可能影响两个父目录，并且[目录修改并不天然耐久](https://pubs.opengroup.org/onlinepubs/9799919799/xrat/V4_xbd_chap01.html)：需要时应同步相关目录，跨父目录 rename 可能需要两次 fsync。

因此该类不是 RootedDirectory 的重复包装：

- create/link/unlink 需要目标父目录 descriptor；
- rename 需要源、目标两个 parent identities 和分别 sync；
- same-parent rename 通过 portable `parentResourcePath` 避免重复 sync；
- target 尚不存在时无法用 exact resource handle 替代 parent capability。

### 30.4 公开面实际消费者

| 表面 | 生产用途 |
| --- | --- |
| `parentResourcePath` | 2 个 rename same-parent 判定 |
| `parentAbsolutePath` | 1 个 same-directory stage address |
| `resourceAbsolutePath` | 8 个 create/link/rename/unlink owners |
| `initialParentSnapshot.deviceId` | 2 个 cross-device precheck |
| `assertCurrent()` | 10 个 parent identity closure 调用点 |
| `inspectTarget()` | 7 个 owner、13 个 absent/current target observation 调用点 |
| `sync()` | 10 个 durability 调用点；1 个 settlement receipt 消费返回 snapshot |
| `close()` | 8 个 owner cleanup wrapper |
| `resourcePath` | 0 |
| `resourceName` | 0 |
| `isClosed` | 0 |

### 30.5 已确认合理的设计

| 项目 | 结论 | 理由 |
| --- | --- | --- |
| stateful parent class | `accept` | 持有 parent FileHandle、initial identity、target address 与 close state |
| root / nested address split | `accept` | root 本身可作为 parent；nested parent 必须先由 RootedDirectory 检查 |
| O_DIRECTORY / O_NOFOLLOW | `accept` | parent pathname race 到 file/symlink 时 open fail closed |
| parent identity-only current check | `accept` | 同级目录项变化合法，不用完整 directory snapshot 阻断 mutation |
| final `lstat` target | `accept observation` | 不跟随 final symlink；exact target stability 由后续 exact handle/operation owner 建立 |
| directory `sync()` | `accept` | 为 create/link/rename/unlink 的目录项耐久性提供真实 primitive |
| sync result snapshot | `accept` | settlement receipt 有一个真实 consumer，不能改成 void |
| explicit close / async dispose | `accept` | descriptor 必须确定释放 |
| target mutation methods | `reject here` | mkdir/link/rename/unlink 各自拥有不同 expectation、receipt 与恢复边界 |

### 30.6 问题一：三个零 consumer getters

`resourcePath`、`resourceName` 和 `isClosed` 只有 direct test 使用：

- mutation owners 已持有调用参数，不需要 parent 再镜像 target ref；
- basename 只用于构造 private absolute target address，无外部 consumer；
- close 状态由 idempotent close 和 closed errors 证明。

可同时删除 `#resourcePath`、`#resourceName` 两个只为 getter 存在的字段；`ResourceAddress` 只需保留 parent ref 与局部 name 供构造阶段使用。

### 30.7 问题二：公开完整初始 snapshot 过宽

`initialParentSnapshot` 有两个生产 consumers，但都只读取 `.deviceId`，用于 source node 与 destination parent 的 cross-device precheck。公开完整旧 snapshot 容易被误当当前状态；应改成明确的 `parentDeviceId: bigint` getter：

- private initial snapshot 继续用于 `assertCurrent()`；
- link/rename 两个 consumers 改读 `destinationParent.parentDeviceId`；
- 不增加 device registry 或跨文件系统策略。

### 30.8 问题三：初始 parent 竞态映射过宽

`inspectInitialParent()` 从 `RootedDirectory.inspectExistingResource()` 接收结果。目前只有普通 absent/symlink/type 有精确映射；如果 RootedDirectory 返回 `resource-changed` 或 `resource-alias`，代码会降为 `root-scope`。

这两种错误都说明目标 parent 在建立句柄前发生漂移，应映射为 `parent-changed`；真正的 root failure 仍映射 `root-scope`。这样上层可以区分 workspace 根丢失和目标 parent race。

### 30.9 测试基线

```text
RootedResourceParentHandle focused: 6 pass / 0 fail / 0 skip / 100.871792ms
TypeScript project build: pass
```

现有 6 项覆盖 root/nested parent、absent target、final symlink、三类非法 parent、forged root/path、sibling mutation、parent replacement、sync 和 close。测试数量足够。

### 30.10 待确认决定

**A．保留 parent capability，收窄公共事实并修正映射（推荐）**

- 删除 `resourcePath`、`resourceName`、`isClosed` getters 及两个只读镜像字段；
- `initialParentSnapshot` getter 改为窄 `parentDeviceId`；
- 更新 link/rename 两个真实 consumers；
- `resource-changed/resource-alias` 映射为 `parent-changed`；
- existing parent replacement test 同时覆盖 missing/replacement；
- 保持 6 项 direct tests，不新增测试。

**B．只删除完全零 consumer getters**

改动更小，但继续暴露过宽旧 snapshot，并保留错误 authority 混淆。

**C．把 mutation 操作合并进 Parent Handle**

`reject`。会把 create/link/rename/unlink 的不同 expectation、durability receipt 和 recovery 规则塞进一个 manager class。

### 30.11 用户决定与实现证据

用户确认采用 A。实现结果：

- 删除 `resourcePath`、`resourceName`、`isClosed` getters 及只为前两者存在的 private mirror fields；
- `ResourceAddress` 只保留构造 parent ref 与 target absolute path 所需事实；
- `initialParentSnapshot` getter 收窄为 `parentDeviceId`，private snapshot 继续用于 identity closure；
- durable link/rename 两个 cross-device consumers 改读 `parentDeviceId`；
- initial parent 的 `resource-changed/resource-alias` 映射为 `parent-changed`；
- parent replacement direct test 同时覆盖 missing/replacement；
- 两个跨模块测试替身不再读取已删除的 resourcePath mirror，改用真实 `resourceAbsolutePath`。

验证结果：

```text
Parent Handle + link/rename focused: 21 pass / 0 fail / 0 skip / 180.345125ms
Affected atomic/event-store tests: 19 pass / 0 fail / 0 skip / 1113.722333ms
TypeScript typecheck: pass
Architecture: pass / 422 modules / 2582 dependencies
git diff --check: pass
```

## 31. FND-FS-004

### 31.1 目标文件

- `src/foundation/filesystem/rooted-exact-resource-handle.ts`

本单元只读了 454 行实现、349 行 direct test、4 个生产 owner、parent/root/node dependencies、link/rename/unlink/settlement 调用链、Node no-follow/nonblocking/FileHandle 文档和 POSIX link/rename/unlink 语义；尚未修改目标源码或测试。

### 31.2 核心职责

`RootedExactResourceHandle` 为一个已经存在且具有 exact expected snapshot 的最终节点签发 descriptor capability：

```text
RootedDirectory observation + frozen expected snapshot
  → admit regular-file 或 file-or-directory
  → O_NOFOLLOW | O_NONBLOCK [| O_DIRECTORY] open
  → fstat(handle) == initial full snapshot
  → RootedDirectory pathname full snapshot == handle
  → sign exact handle
```

`O_NONBLOCK` 不是性能选项，而是防止 regular-file pathname 在检查/open 竞态中被换成 FIFO 后阻塞；open 后仍通过 fstat kind/full snapshot 拒绝替换。

实例提供两组刻意不同的复验：

- `assertPathCurrent()`：提交前要求 expected、opened inode 和 pathname 全部完整一致；
- `inspectOpenedNode()`：rename/unlink 后只要求 kind + dev/ino identity，允许 link count、mtime/ctime 等合法改变；
- `syncOpenedNode()`：同步仍打开的 inode，不要求原 pathname 存在，并返回同步后的实际 snapshot 给 owner 比较或写 receipt。

### 31.3 真实消费者

模块只有 4 个直接生产 importers，恰好都是需要 exact source capability 的操作：

- durable regular-file link；
- durable resource rename；
- exact regular-file unlink；
- durable regular-file settlement。

三个 owner 使用 `openRegularFile()`，rename 使用 `openFileOrDirectory()`。公开事实/操作的真实用途：

| 表面 | 生产用途 |
| --- | --- |
| `resourceAbsolutePath` | 4 个 owner 与 parent target address 做 root-scope closure |
| `initialNodeSnapshot` | link/rename/unlink 的 expected、device、link-count 与 receipt 基准 |
| `kind` | rename result 保留 file/directory kind |
| `assertPathCurrent()` | 4 个 owner 的 pre-commit exact gate |
| `inspectOpenedNode()` | link/rename/unlink 的 post-commit inode observation |
| `syncOpenedNode()` | link/unlink/settlement 的 inode durability 与 receipt observation |
| `close()` | 4 个 owner cleanup paths |
| `resourcePath` | 0 |
| `isClosed` | 0 |

### 31.4 已确认合理的设计

| 项目 | 结论 | 理由 |
| --- | --- | --- |
| stateful exact class | `accept` | 持有 source FileHandle、initial snapshot、kind、path 与 close state |
| frozen expected requirement | `accept` | 阻止调用方在异步 open 期间改变 CAS 基准 |
| two named factories | `accept` | regular-file 与 file-or-directory admission 清晰，避免 options bag |
| O_NOFOLLOW + post-open fstat | `accept` | final symlink/race 不凭 precheck 放行 |
| O_NONBLOCK | `accept` | pathname race 到 FIFO/device 时避免 open hang，之后仍检查 kind |
| full pre-commit snapshot | `accept` | source 内容/metadata 漂移在 mutation 前被拒绝 |
| identity-only post-commit observation | `accept` | POSIX rename/unlink 后 descriptor 仍引用原 inode，link count 可合法变化 |
| sync after rename/unlink | `accept` | owner 可对仍打开 inode 建立 durability，再检查实际 snapshot |
| raw FileHandle exposure | `reject` | 防止绕过 kind/identity/currentness 和 close authority |
| read/write bytes | `caller-owned` | stable read/copy candidate 拥有内容循环、容量和 digest |

POSIX [`link()`](https://pubs.opengroup.org/onlinepubs/009695399/functions/link.html) 会增加同一 inode 的 link count；[`rename()`](https://pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html) 和 unlink 不使已打开 descriptor 失效。当前 pre/post 两套语义准确反映这一点。

### 31.5 问题一：两个零 consumer getters

`resourcePath` 和 `isClosed` 只有 direct test 使用：

- private `#resourcePath` 必须保留给 `assertPathCurrent()`，但无需公开镜像；
- closed state 已由 idempotent close 和所有 I/O 的稳定 `closed` error 证明。

删除 getters 不影响 4 个 production owners，也不改变内部 capability。

### 31.6 问题二：resource alias 映射

`inspectInitialResource()` 已把 RootedDirectory 的 `resource-changed` 映射为 exact handle `resource-changed`，但 `resource-alias` 会落入 `root-scope`。Alias 是最终资源 pathname 的非规范/漂移事实，不是根能力失败；应与 `resource-changed` 同样映射为 exact `resource-changed`。真正的 root replacement/closed/inspection failure 继续为 `root-scope`。

### 31.7 不扩张的边界

- 不把 parent handle 合并进 exact handle；目标可能 absent 时 exact handle 不成立。
- 不增加 write/open mode options；当前 class 是 source admission，不是通用 FD wrapper。
- 不把 digest、byte ranges、stable read 或 copy 循环加入本 class。
- 不把 link/rename/unlink/settlement 合为 method；各自拥有不同 atomicity、receipt 和 recovery。
- 不宣称 Node path-based open 等价于 openat。

### 31.8 测试基线

```text
RootedExactResourceHandle focused: 7 pass / 0 fail / 0 skip / 102.394458ms
TypeScript project build: pass
```

覆盖 file/directory factories、symlink、missing/stale expectation、passive inputs、metadata drift、opened identity、rename/unlink 后 observation/sync 和 close。数量准确，无重复 operation fixtures。

### 31.9 待确认决定

**A．保留 exact capability，只删除镜像与修正 alias（推荐）**

- 删除 public `resourcePath`、`isClosed` getters；private path/closed state 保留；
- `resource-alias` 映射为 `resource-changed`；
- direct tests 删除两个镜像断言，保持 7 项；
- 不修改四个 production consumers。

**B．原样保留 getters**

没有功能错误，但增加零 consumer 状态面，且 alias 分类仍不精确。

**C．公开 FileHandle 或吸收 mutation methods**

`reject`。会绕过当前 exact snapshot/identity gate，并把不同 durability transaction 混入一个 class。

### 31.10 用户决定与实现证据

用户确认采用 A。实现结果：

- 删除 public `resourcePath`、`isClosed` getters，private path/closed state 保留；
- initial inspection 的 `resource-alias` 映射为 exact `resource-changed`；
- direct tests 删除两个镜像断言，仍为 7 项；
- 四个 mutation consumers 无需修改。

验证结果：

```text
Exact Handle + four mutation consumers: 31 pass / 0 fail / 0 skip / 230.983833ms
Removed getter production references: 0
git diff --check: pass
```

## 32. FND-FS-005

### 32.1 目标文件

- `src/foundation/filesystem/stable-file-read.ts`

本单元只读了 509 行实现、326 行 direct test、全部 32 个生产 importers、RootedDirectory/NodeSnapshot/SHA-256/ByteCount dependencies、strict text/tree/atomic/Config/Ledger consumers、Node 24 positioned read 与 Buffer 文档、旧 JS 和 TencentDB-Agent-Memory；尚未修改目标源码或测试。

### 32.2 核心读取合同

```text
RootedDirectory + resource ref + explicit maximum
  → passive closed options / abort precheck
  → rooted initial observation
  → regular-file + optional expected full snapshot + capacity
  → O_RDONLY | O_NOFOLLOW | O_NONBLOCK open
  → fstat == initial full snapshot
  → positioned chunk loop + SHA-256
  → exact expected EOF + one-byte growth probe
  → fstat(handle) + rooted final pathname full snapshot
  → close with first-error authority
  → bytes result 或 digest-only StableFileSource
```

完整读取与仅摘要读取共享一个内核：bytes 模式分配文件等长 Buffer，digest 模式只保留固定 512 KiB scratch。两者都读取整个同一 FileHandle、计算 SHA-256，并返回最终 path/node/byteCount/digest 事实。

### 32.3 真实扇入与两种模式

该模块有 32 个直接 production importers：

| 表面 | 生产文件 | 主要用途 |
| --- | ---: | --- |
| `readStableFile()` | 7 | strict text、Config/Ledger、managed content、host settings |
| `readStableFileDigest()` | 3 | atomic expectation/recovery、resource tree identity |
| `StableFileSource` | 16 | CAS expectation、inspection facts、publication receipts |
| `StableFileReadResult` | 1 | bytes-owning上层读取合同 |
| `StableFileReadError` | 25 | owner-specific stable error mapping |

`byteCount` 虽也存在于 `node.byteCount`，但顶层字段是 16 个 StableFileSource/CAS contracts 的固定物理 receipt 形状，并在 durable atomic parser 中复验两者一致，不是无约束重复。

### 32.4 为什么不使用 `readFile()` 或 generic stream

Node 24 [`FileHandle.read(buffer, offset, length, position)`](https://nodejs.org/docs/latest-v24.x/api/fs.html#filehandlereadbuffer-offset-length-position) 明确返回实际 `bytesRead`，并在指定 position 时不改变隐式文件位置。当前循环由此获得：

- 明确的 safe-number byte positions；
- 短读处理；
- expected-size 前的意外 EOF 检测；
- expected-size 后的 growth probe；
- chunk 间 AbortSignal 检查；
- bytes/digest 两种内存策略共享同一算法。

`readFile()` 不提供同样清晰的 per-chunk count/hash/probe boundary；ReadableStream 仍需要额外计数、容量、摘要、close 和 pathname revalidation，反而增加状态层。

### 32.5 已确认合理的设计

| 项目 | 结论 | 理由 |
| --- | --- | --- |
| caller-required maximum | `accept` | Foundation 不猜默认容量；所有真实 owners 必须显式预算 |
| optional exact expectedNode | `accept` | 读取可作为 CAS source，也可完成首次稳定 observation |
| bytes/digest named functions | `accept` | 返回形状和内存成本清晰，不用 mode option 暴露内部 union |
| single shared kernel | `accept` | 稳定性、摘要、close/error 只有一个 owner |
| O_NOFOLLOW + O_NONBLOCK + fstat | `accept` | final symlink 与 FIFO race fail closed |
| positioned chunk loop | `accept` | 不依赖共享 file offset，精确处理短读和取消 |
| SHA-256 while reading | `accept` | 内容身份与读取 bytes 来自同一 handle/loop |
| growth probe | `accept` | 初始 size 后新增内容不能被误作完整读取 |
| full post-read handle/path snapshot | `accept` | metadata/identity drift 在签发结果前失败 |
| hard links | `accept observation` | linkCount 是事实；是否允许由 file owner 决定 |
| class | `reject` | 单次读取没有跨调用持久状态；函数与局部 FileHandle 足够 |

### 32.6 问题一：初始 resource drift 映射

`inspectInitialResource()` 精确映射 initial absent 和 forged path，但 RootedDirectory 的 `resource-changed/resource-alias` 会落入 `root-scope`。这两种情况表示待读 source 在准入期间漂移，不是根本身失效，应映射为 `source-changed`；真正 root change/closed/ancestor scope failure 继续为 `root-scope`。

### 32.7 问题二：Buffer allocation 未完全进入稳定错误边界

完整 bytes capture 已捕获 `Buffer.allocUnsafe(fileSize)` 失败并映射 `too-large`，但 digest scratch 和 one-byte growth probe 仍直接调用 `Buffer.allocUnsafe()`。即使长度很小，运行时资源耗尽也可能抛出原生 RangeError/ENOMEM，绕过 `StableFileReadError`。

建议增加一个 private `allocateReadBuffer(length)`：

- 所有 capture/scratch/probe 统一调用；
- allocation failure 统一为 `too-large`，符合现有“caller or runtime byte limit”合同；
- 不增加 allocator injection seam 或测试专用参数。

Node 的 [`buffer.constants.MAX_LENGTH`](https://nodejs.org/docs/latest-v24.x/api/buffer.html#bufferconstantsmax_length) 只是单 Buffer 理论上限，实际 allocation 仍可能失败；当前 caller maximum、MAX_LENGTH 和捕获分配异常三层都需要保留。

### 32.8 边界与对照

- 不解码 UTF-8、不解析 JSON；由 strict-text/deterministic JSON 层组合。
- 不拒绝 hard link、mode 或 owner；由配置/记录 policy 判断。
- 不把成功结果解释为文件未来不可变；它只证明这一读取窗口。
- 不复用 ExactResourceHandle，因为该 class 不暴露 raw FileHandle，而稳定读取必须实际读取 bytes；公开 handle 会破坏更重要的边界。
- 不加入重试；source drift 是调用 owner 的重新观察决定。

TencentDB-Agent-Memory 主要直接调用 `readFile/readFileSync`，部分读取后另算 hash，没有统一 root、no-follow、capacity、handle/path identity 或 before/after snapshot。Wakeflow 当前内核的复杂度由真实本地 authority/CAS 场景支撑，不应退化，但也不应加入通用 stream manager。

### 32.9 测试基线

```text
StableFileRead focused: 10 pass / 0 fail / 0 skip / 108.8235ms
TypeScript project build: pass
```

覆盖 bytes、跨 chunk digest、empty、capacity、expectedNode、file kind/symlink、missing/path、hard link、pre-abort 和 passive closed options。没有不稳定的并发计时测试；底层 source-change branches 由 snapshot/probe 组合与相邻 mutation tests 证明。

### 32.10 待确认决定

**A．保留读取内核，闭合两处错误边界（推荐）**

- initial `resource-changed/resource-alias` → `source-changed`；
- 新增 private `allocateReadBuffer()`，统一 capture/scratch/probe allocation failure；
- public API、结果形状、chunk size 和 10 项 tests 不变；
- 不新增测试 seam。

**B．只修正 RootedDirectory 错误映射**

主行为成立，但 digest 模式仍可能泄漏原生 allocation error，不推荐留下不一致边界。

**C．改为 readFile/stream/class**

`reject`。会丢失或重新实现当前已经闭合的 positioned count、growth probe、digest 和 pathname revalidation。

### 32.11 用户决定与实现证据

用户确认采用 A。实现结果：

- initial RootedDirectory `resource-changed/resource-alias` 映射为 `source-changed`；
- 新增 private `allocateReadBuffer()`；
- full capture、digest scratch 和 growth probe 全部经同一 stable allocation boundary；
- allocation failure 统一为 `too-large`；
- public API、结果、chunk size 和 10 项 tests 不变。

验证结果：

```text
StableFileRead focused: 10 pass / 0 fail / 0 skip / 104.681541ms
Strict-text adjacent consumer: 9 pass / 0 fail / 0 skip / 109.407625ms
TypeScript typecheck: pass
Architecture: pass / 422 modules / 2582 dependencies
git diff --check: pass
```

## 33. FND-FS-006

### 33.1 目标文件

- `src/foundation/filesystem/strict-text-file.ts`

本单元只读了 151 行实现、276 行 direct test、UTF-8 基础模块、StableFileRead、全部 15 个生产 importers、4 个直接读取 callers、deterministic JSON/Config/TODO/Workspace consumers、WHATWG Encoding、Unicode NFC、RFC 8259、旧 JS 与 TencentDB-Agent-Memory；尚未修改目标源码或测试。

### 33.2 文本 profile

Strict Text 在一次已经闭合的 StableFileRead 结果上只增加文本表示合同：

```text
stable exact bytes + source facts
  → fatal UTF-8 decode（保留 leading BOM 为 U+FEFF）
  → reject leading BOM
  → reject any CR / require LF-only
  → require exactly one final LF
  → require body length > 0
  → require source text already NFC
  → text + unchanged StableFileSource facts
```

它不 trim、不自动转换 CRLF、不删除 BOM、不 normalize Unicode，也不解析 JSON、Markdown 或 managed regions。外部/混合所有权文本必须从 stable bytes 进入自己的 owner，不能使用该 Wakeflow-owned profile。

### 33.3 标准依据与真实用途

[WHATWG Encoding](https://encoding.spec.whatwg.org/) 将 `fatal` 与 BOM handling 作为显式 decoder policy；Foundation UTF-8 使用 `fatal: true, ignoreBOM: true`，因此无效序列不会变成 U+FFFD，leading BOM 会保留给本层明确拒绝。

[Unicode UAX #15](https://www.unicode.org/reports/tr15/) 说明 NFC 为 canonically equivalent 文本提供唯一 binary representation。当前读取只验证，不改写磁盘文本，符合持久文件 deterministic identity。

RFC 8259 对 JSON 也规定发送方不得添加 BOM；Strict Text 的更一般 Wakeflow-owned profile因此可被 deterministic JSON 安全复用，但本层本身不声称所有文本都是 JSON。

生产扇入：

| 表面 | 使用情况 |
| --- | --- |
| `readStrictTextFile()` | 4 个直接 callers：deterministic JSON、TODO projection、active projection、window runtime |
| `StrictTextFileResult` | 2 个显式类型 consumers |
| `StrictTextFileError` | 14 个 direct/indirect owner mappers |
| `StrictTextFileOptions` | 0 个模块外显式 consumers |

### 33.4 已确认合理的设计

| 项目 | 结论 | 理由 |
| --- | --- | --- |
| named strict profile | `accept` | 当前 Wakeflow-owned text consumers 需要同一 representation |
| fatal UTF-8 | `accept` | 不允许 replacement character 隐式修复无效 bytes |
| explicit BOM rejection | `accept` | UTF-8 无字节序需求；保持唯一 source representation |
| LF-only + exactly one final LF | `accept` | deterministic local text，避免平台/editor aliases |
| non-empty body | `accept current consumers` | 当前 Config/JSON/projection authority 都不能是空文本；未来不同 profile 不加 option |
| NFC check | `accept` | 拒绝 canonical-equivalent byte aliases，不自动修改 source |
| preserved source facts | `accept` | digest/byteCount/node 仍对应原始 bytes，不对 normalized text 重算 |
| text class/options flags | `reject` | 单次 pure decode/profile check，无实例状态和多 profile 需求 |

### 33.5 重复 options owner

`StrictTextFileOptions` 与 `StableFileReadOptions` 字段完全相同。当前 Strict Text：

1. `parsePlainRecord()` 再次检查 closed shape；
2. 不验证字段，只把 maximum/expected/signal 强制 cast；
3. 重新构造同形 options；
4. StableFileRead 随后再次被动准入并完整验证字段。

这造成一条任意边界：unknown field/accessor 由 `StrictTextFileError("input")` 拒绝，非法 maximum/expected/signal 却由 `StableFileReadError("input")` 拒绝。Strict Text 没有自己的 read option 语义，不应成为第二 owner。

建议：

- `readStrictTextFile(..., options: StableFileReadOptions)` 直接传递 options；
- 删除 `StrictTextFileOptions`、`ParsedStrictTextFileOptions`、`parseOptions()` 及 passive/ByteCount/FileNode imports；
- 删除 strict `input` reason/message；
- Config 中不再检查不可能的 `StrictTextFileError.reason === "input"`，read option input 继续由现有 StableFileRead mapper 处理；
- direct options test 全部期望 StableFileReadError，仍保持一个 test case。

### 33.6 边界与外部对照

- 不把 strict profile 放回 UTF-8 primitive；BOM/LF/NFC/empty 是文件表示政策。
- 不为 CRLF/BOM/empty 增加兼容 options；新真实 profile 应使用独立 owner。
- 不返回 bytes；Stable source facts 已携带原始 digest/size，需要 bytes 的调用方应使用 lower layer。
- 不重读文件；文本与 source facts 必须来自同一 stable bytes。

TencentDB-Agent-Memory 多处直接以 `readFile(..., "utf-8")` 解码并调用 `trim()`、split/filter 或 JSON.parse，通常会接受/改写表示差异，也没有稳定源事实。Wakeflow 自有 authority 文件需要当前严格入口；外部内容则不应套用它。

### 33.7 测试基线

```text
StrictTextFile focused: 9 pass / 0 fail / 0 skip / 109.407625ms
TypeScript project build: pass
```

覆盖成功 source facts、invalid UTF-8、BOM、CRLF/mixed/CR、final LF、empty、NFC、expectedNode 和 option delegation。测试数量完整且轻量。

### 33.8 待确认决定

**A．保留 text profile，把 options 完全下沉给 StableFileRead（推荐）**

- 删除重复 options types/parser 和 strict `input` reason；
- 函数直接接受/传递 `StableFileReadOptions`；
- 更新一个 Config mapper 和现有 options test；
- 保持 9 项 tests、文本行为和成功结果不变。

**B．保留 wrapper-level closed-shape check**

行为可用，但继续让同一 options 由两层拥有，并维持不一致的 input error authority。

**C．增加多种 newline/BOM/empty options**

`reject`。会把清晰的单一 Wakeflow-owned profile 退化为通用文本配置器，外部/mixed-owned 文本应由自己的 owner 处理。

### 33.9 用户决定与实现证据

用户确认采用 A。实现结果：

- 删除 `StrictTextFileOptions`、中间解析类型、重复 passive-data 准入和 strict `input` 错误；
- `readStrictTextFile()` 直接接受并传递 `StableFileReadOptions`；
- Strict Text 只拥有 UTF-8、BOM、换行、空正文和 NFC 表示错误；
- Config mapper 删除不可能的 strict `input` 分支，读取参数错误仍由现有 StableFileRead mapper 处理；
- strict text 与 deterministic JSON 的既有 options 测试改为断言唯一的 `StableFileReadError`，未增加 case。

验证结果：

```text
Strict Text + Deterministic JSON + Config snapshot: 21 pass / 0 fail / 0 skip / 252.015583ms
TypeScript typecheck: pass
Architecture: pass / 422 modules / 2579 dependencies
git diff --check: pass
```

## 34. FND-FS-007

### 34.1 目标文件

- `src/foundation/filesystem/deterministic-json-file.ts`

本单元只读了 58 行实现、234 行 direct test、StrictTextFile、DeterministicJsonDocument、Canonical JSON SHA-256、全部 15 个生产 importers/17 个调用点、三个 semantic digest 读取点、旧 JS、TencentDB-Agent-Memory，以及 RFC 8259、RFC 8785 与 ECMAScript JSON 规范；尚未修改目标源码或本单元测试。

### 34.2 合理的组合骨干

当前主体是一条清晰的无状态组合：

```text
StableFileReadOptions
  → StrictTextFile：稳定 bytes + UTF-8/NFC/LF profile + physical source facts
  → DeterministicJsonDocument：JSON parse + detached/frozen JsonValue + pretty round-trip
  → DeterministicJsonFileResult
```

`readDeterministicJsonFile()` 有 15 个直接生产 importers、17 个调用点，覆盖 Config、file lock、TODO、Ledger、Demand Event Sourcing、Maintenance 与 Window Runtime；`DeterministicJsonFileResult` 有 13 个生产类型引用。它不是未来占位。

应保留：

- 一个命名明确的文件组合入口，避免每个 owner 重复稳定读取、严格文本和 JSON 表示准入；
- 原样保留 `resourcePath/node/byteCount/digest/text`，使物理 source facts 与已解析值来自同一次稳定读取；
- 返回递归冻结、解除源引用的 `value`；
- 让 Stable/Text/Document 三层错误保留各自 owner，不再包一层 generic 文件错误；
- 接受所有 JSON 顶层类型，具体 owner 再收紧对象和字段关系；
- 使用函数，不创建无状态 reader class、格式 registry 或 profile options。

### 34.3 重复读取 options

`DeterministicJsonFileOptions` 再次逐字段复制 `StableFileReadOptions`，且没有模块外生产类型 consumer。它没有 JSON 专属读取字段，也没有自己的 parser，因此只形成第三个相同 options 名称。

应与 Strict Text 的已确认边界一致：函数直接接受 `StableFileReadOptions`，删除 `DeterministicJsonFileOptions` 及仅为该类型存在的 ByteCount/FileNode imports。StableFileRead 继续是参数准入和 `input` 错误的唯一 owner。

### 34.4 无条件 raw semantic digest

当前每次读取都会对已经解析、冻结的 `value` 调用 `computeCanonicalJsonSha256Digest()`，因此在物理 source SHA-256 和 deterministic JSON parse/render 之外，又无条件执行一次完整 JSON 值准入/复制、JCS serialization、UTF-8 编码和 SHA-256。

实际情况：

| 证据 | 数量/结论 |
| --- | --- |
| deterministic JSON file 调用 | 17 |
| 读取 `semanticDigest` 的生产点 | 3 |
| 不使用该字段的调用 | 14 |
| 最大真实读取预算 | 24 MiB publication transaction；另有多文件 Event Sourcing/TODO 遍历 |

三个读取点都已经完成更强的领域表示复验：

1. Config：`parse model → domain render === read.text`；
2. Maintenance intent：领域 document parser 内部已做 `parse → domain render === text`；
3. Maintenance journal：`parse model → domain render === read.text`。

原文相等已经证明磁盘 JSON 值与领域 representation 相等；随后再次比较两者 JCS digest 是同一事实的散列后重复证明。三处仍会各自计算并返回真正有领域含义的 `configDigest/intentDigest/journalDigest`，不需要通用文件结果再携带 raw JSON semantic digest。

因此建议删除 `semanticDigest` 字段及无条件计算，并机械删除上述三条恒真比较。Canonical JSON SHA-256 基础能力保持不变，未来真正只需要通用 JSON 语义摘要的 owner 可以显式组合 `computeCanonicalJsonSha256Digest(read.value)`，成本和语义由该 owner 看得见地承担。

### 34.5 标准与外部对照

- [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259.html) 把 JSON object 描述为无序集合，并指出重复名称会导致实现间不可预测；当前 pretty round-trip 拒绝重复键和表示漂移，属于 Wakeflow 自有文件 profile，而不是冒充通用 JSON canonical form。
- [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html) 的目标是为 hashing/signing 产生不变表示，要求无 token 间空白和递归 UTF-16 属性排序；附录 C 同时指出 canonical 单行文本通常不利于调试。它支持继续分离“可审查 pretty file”与“显式语义 digest”，不支持对每次文件读取强制计算两者。
- [ECMAScript JSON.stringify](https://tc39.es/ecma262/multipage/structured-data.html#sec-json.stringify) 定义 pretty renderer 的序列化算法；其容器行为边界已在 FND-DATA-002 闭合，本文件无需再拥有 serializer。
- 旧 Wakeflow 与 TencentDB-Agent-Memory 都主要由具体 owner 直接 `readFile + JSON.parse/JSON.stringify`；没有统一稳定文件组合，也没有每次 pretty JSON 读取自动附加 JCS digest。新 TS 应保留更强的稳定读取/表示准入，但不应把不必要的摘要成本扩散到所有 owners。

### 34.6 测试审阅

当前 6 项 direct tests 全部对应现有行为，但其中一项“键顺序改变 source identity、JCS identity 不变”只重复 `canonical-json-sha256.test.ts` 已验证的构造顺序无关性，并仅服务拟删除字段。

基线：

```text
DeterministicJsonFile focused: 6 pass / 0 fail / 0 skip / 133.23875ms
```

建议保持其余 5 项：组合成功/冻结结果、全部顶层类型、表示漂移、跨层错误 owner、expectedNode/options delegation。首项改为核对精简后的结果 shape；不增加 case。

### 34.7 待确认决定

**A．保留 lean file adapter，删除重复 options 与无条件 raw semantic digest（推荐）**

- 接受并直接传递 `StableFileReadOptions`；
- 返回 physical source facts、`text` 和 frozen `value`；
- 删除 `semanticDigest`、JCS/SHA imports 和 1 项重复 direct test；
- 删除 Config、Maintenance intent、Maintenance journal 中 3 条恒真比较，保留各自领域 digest；
- 聚焦验证 direct adapter、三个受影响 owner、typecheck、architecture 和 diff check。

**B．只删除重复 options，继续自动计算 semantic digest**

API 较现状干净，但 14/17 调用继续承担没有 consumer 的完整 JCS 准入、序列化与哈希成本。

**C．增加 `includeSemanticDigest` option 或第二个 reader**

`reject`。只为三条恒真比较增加模式分支或第二表面；真正需要时显式组合现有 Canonical JSON SHA-256 函数更清楚。

### 34.8 用户决定与实现证据

用户确认采用 A。实现结果：

- 删除 `DeterministicJsonFileOptions`，读取函数直接接受 `StableFileReadOptions`；
- `DeterministicJsonFileResult` 只保留物理 source facts、严格文本和冻结 JSON 值；
- 删除无条件 JCS 准入/序列化/编码/SHA-256 及 `semanticDigest` 字段；
- 删除 Config、Maintenance intent 和 Maintenance journal 中三条由 exact domain render 已经证明的摘要比较，各自领域 digest 保持不变；
- direct tests 从 6 项精简为 5 项，删除 Canonical SHA-256 套件已有覆盖的键顺序语义测试，并在成功 case 核对精简后的 result shape；
- 全仓 `DeterministicJsonFileOptions` / `semanticDigest` 源码与测试引用均为 0。

验证结果：

```text
Deterministic JSON + Config + Maintenance intent/journal/transaction: 33 pass / 0 fail / 0 skip / 73.534400542s
TypeScript typecheck: pass
Architecture: pass / 422 modules / 2575 dependencies（此前 2579）
git diff --check: pass
```

完整 Maintenance transaction/recovery 套件已经证明跨 owner 行为，但单次约 73 秒；后续逐文件单元不重复运行该重型套件，只在 Maintenance 或 Filesystem 系统收束节点再次使用。

## 35. FND-FS-008

### 35.1 目标文件

- `src/foundation/filesystem/stable-directory-read.ts`

本单元只读了 650 行实现、339 行 direct test、RootedDirectory/FileNodeSnapshot/PortablePath/UTF-8 dependencies、全部 17 个生产 importers、bounded tree scan 与代表性 Config/TODO/Ledger/Demand/Maintenance/Window consumers、旧 JS、TencentDB-Agent-Memory、Node 24 fs 文档、POSIX readdir 以及 `p-limit` 官方实现说明；尚未修改目标源码或测试。

### 35.2 真实职责与扇入

```text
RootedDirectory + root/resource directory + explicit entry limit
  → initial rooted observation + optional exact expected node
  → O_DIRECTORY/O_NOFOLLOW held FileHandle + fstat
  → streaming name pass 1 + bounded parallel lstat pass 1
  → streaming name pass 2 + bounded parallel lstat pass 2
  → names/node snapshots exact comparison
  → held handle + final rooted pathname revalidation
  → code-unit sorted one-level inventory
```

该模块有 17 个直接生产 importers；`readStableResourceDirectory()` 被 16 个外部生产模块使用，`readStableRootDirectory()` 被 4 个外部生产模块使用。结果类型被 bounded tree scan、atomic stage recovery、Event Sourcing 和 Workspace layout 显式复用。真实调用预算从 0/1/2 项 inventory 到 100,000 个 atomic stage 条目和 196,608 个 TODO tree 条目，不是小目录专用 helper。

应保留的边界：

- root 自身用 `directoryResourcePath: null`，不伪造空 portable path；
- 单层读取与递归 tree scan 分离；
- `maximumEntries` 由真实 owner 显式给出，0 精确表示只接受空目录；
- 不信任 `Dirent` 节点类型，最终事实来自 bigint `lstat`；
- 子 symlink、hard link 和特殊节点只作为物理事实返回，策略由 owner/tree layer 决定；
- `name` 与完整 `resourcePath` 都有真实消费者，不能删除其一；
- UTF-16 code-unit 排序、冻结结果、两次 names/metadata 比较和最终 target revalidation；
- 函数而非 reader class；单次读取没有持久实例状态。

### 35.3 为什么双重枚举不是重复

[POSIX readdir](https://man7.org/linux/man-pages/man3/readdir.3p.html) 明确说明：文件在 `opendir()` 后被新增或删除时，后续 `readdir()` 是否返回该项是不确定的。单次 `readdir/readdirSync({withFileTypes:true})` 加一次目录 stat 不能证明一层 inventory；目录内容变化还可能只体现在子节点 metadata。

当前两次流式名称枚举、两次子节点 `lstat`、held directory fstat 与最终 pathname 检查共同证明“没有检测到 names/metadata/target 漂移”。它仍不声称返回后目录不可变，也不掩盖 Node 未提供 `openat/fstatat` 的路径竞态边界。不能为了代码短或对照 Tencent 的普通 `readdir` 而删成单次扫描。

### 35.4 问题一：initial resource drift 被误报为 root scope

`inspectInitialResource()` 已精确处理 missing、forged path 和 unsupported platform，但 RootedDirectory 的 `resource-changed/resource-alias` 当前落入 `root-scope`。这与已修正的 StableFileRead 不一致：目标目录准入期间漂移是 `source-changed`，真正 root/ancestor/closed failure 才是 `root-scope`。

多个真实 owner 区分两者，例如 atomic recovery 把 source change 映射为 busy、把 root scope 映射为根失效，因此应修正。

### 35.5 问题二：目录名 UTF-8 当前是有损准入

`opendir(..., {encoding: "utf8"})` 直接把物理名称解码成 JavaScript 字符串。Node 文档说明无效 UTF-8 字节会替换为 `U+FFFD`；随后 `PortableResourcePath` 只能看到替换后的文本，不能证明返回名称与磁盘字节是一一对应的。

Node 24 的 [`opendir`](https://nodejs.org/docs/latest-v24.x/api/fs.html#fspromisesopendirpath-options) 允许 encoding 控制后续目录读取；当前固定 Node 24.19 运行时已用一次临时探针证明 `encoding: "buffer"` 返回 Buffer 名称。建议建立一个文件内窄类型桥，使用 raw Buffer 模式，再交给现有 fatal `decodeUtf8()`：

- 无效字节稳定映射为 `entry-path`，不产生 replacement alias；
- 有效 UTF-8 解码后继续由 PortablePath 执行 well-formed/NFC/control/segment 准入；
- 不持久保存 raw bytes，不新增名称类型或 public API；
- 当前 APFS 拒绝创建无效名称，无法增加可靠跨平台 fixture；现有 normal/NFC cases 会覆盖 raw-mode 组合路径，UTF-8 模块已有 invalid-byte direct coverage。

### 35.6 局部复杂度与并发结论

1. `O_NONBLOCK` 对已经要求 `O_DIRECTORY` 的 open 没有额外防 FIFO 价值；RootedDirectory 本身也只使用 `O_RDONLY | O_DIRECTORY | O_NOFOLLOW`。建议删除该分支。
2. `snapshotOpenedDirectory()` 对任意异常都映射 `source-changed`，当前 `FileNodeSnapshotError` 条件分支没有不同结果；删除重复分支。
3. `inspectEntry()` 第一遍除 ENOENT 外全部映射 `io-failure`，当前单独检查 `FileNodeSnapshotError` 后仍执行同一失败；删除重复分支。
4. 当前 `p-limit@7.3.1`、内部并发 8 和 `Promise.allSettled` 应保留。显式 entry limit 同时界定结果与 pending tasks；`allSettled` 确保失败时没有后台 lstat 越过函数生命周期，并按输入顺序选择稳定首错。
5. [`p-limit` 官方 API](https://github.com/sindresorhus/p-limit) 支持把函数和参数直接传给 limiter，专门用于大量任务时避免不必要闭包。把 `limit(() => inspectEntry(...))` 改为 `limit(inspectEntry, ...)`，可在不换包、不加 worker pool 的情况下删除每项一个闭包。
6. direct test 标题“bounded parallel”没有观测并发，只观测 64 项的稳定顺序；改名为准确的 many-entry deterministic order，不新增测试 seam 或 case。

### 35.7 外部对照

- Node Promise fs 使用 libuv threadpool且操作并不自动同步；固定并发与显式复验是必要边界。[Node 24 fs](https://nodejs.org/docs/latest-v24.x/api/fs.html)
- 旧 Wakeflow 的 Evidence/Window/Transport 等模块有多处 before/after `readdirSync`，证明稳定 inventory 是真实功能需求，但实现分散、同步且限制/错误不统一。
- TencentDB-Agent-Memory 多数场景直接 `readdir/readdirSync({withFileTypes:true})`，部分任务使用 `p-limit`；适合普通缓存、导入和 UI inventory，但没有 root handle、entry budget、double observation 或 portable path admission，不能替代 Wakeflow authority 读取器。
- 不引入 `p-map/p-queue`：当前依赖已成熟且语义足够；新增第二并发库或自维护通用 worker pool没有当前必要性。

### 35.8 测试基线

```text
StableDirectoryRead focused: 9 pass / 0 fail / 0 skip / 118.885833ms
```

九项覆盖 root/nested one-level result、exact/zero capacity、expected node、many-entry order、target failure、hard link facts、non-portable name、passive options 与 pre-abort。没有不稳定的并发 mutation/中途 Abort 测试，也没有为 Node/p-limit internals 建 mock seam；当前测试规模准确、轻量。

### 35.9 待确认决定

**A．保留稳定目录内核，闭合 drift/raw-name 并删除局部冗余（推荐）**

- initial `resource-changed/resource-alias` → `source-changed`；
- raw Buffer 枚举 + Foundation fatal UTF-8 decode；
- 删除无用 `O_NONBLOCK` 与两个同结果异常分支；
- 使用 `p-limit` 参数转发删除 per-entry 内层闭包；
- 修正一项测试标题，保持 9 个 case 和 public result/options 不变；
- 验证 direct test、bounded tree adjacent test、typecheck、architecture 和 diff check。

**B．只修正 drift 映射与局部冗余**

变更更小，但 Linux/Unix 上无效 UTF-8 物理名称仍会先被 Node 替换，根作用域 inventory 不能证明名称字节无损。

**C．改用单次 `readdir({withFileTypes:true})` 或新增 generic scanner class**

`reject`。前者丢失 early capacity 与稳定性证明；后者把 one-level observation、递归策略和领域过滤重新混成一个 manager。

### 35.10 用户决定与实现证据

用户确认采用 A。实现结果：

- initial RootedDirectory `resource-changed/resource-alias` 现在精确映射为 `source-changed`；
- 增加文件内 Node 24 raw-name `opendir` 类型桥，目录项先以 Buffer 取得，再由 Foundation fatal UTF-8 解码；无效字节不会变成 replacement alias；
- raw-name bridge 只暴露 read/close，运行时还复验 `Buffer.isBuffer()`，未新增 public API 或持久类型；
- 删除目录 open 中对 `O_DIRECTORY` 无贡献的 `O_NONBLOCK`；
- 删除两处同结果异常分支；
- `p-limit` 改为函数参数转发，删除每项一个内层闭包，concurrency 8 与 all-settled drain 不变；
- 修正 many-entry 测试标题，仍保持 9 个 direct cases；
- 同步润色本文件一处重复的“持久化路径”注释。

验证结果：

```text
StableDirectoryRead + BoundedDirectoryTreeScan: 17 pass / 0 fail / 0 skip / 131.811791ms
TypeScript typecheck: pass
Architecture: pass / 422 modules / 2576 dependencies
git diff --check: pass
```

依赖数相对 FND-FS-007 增加 1，是 `stable-directory-read → utf8` 的真实严格名称准入边；没有增加第三方依赖、模块或测试 case。

## 36. FND-FS-009

### 36.1 目标文件

- `src/foundation/filesystem/bounded-directory-tree-scan.ts`

本单元只读了 400 行实现、355 行 direct test、StableDirectoryRead、全部生产 importers 与字段 consumers、StableResourceTree/TODO 两个直接 owner、旧 JS、TencentDB-Agent-Memory、Node recursive readdir、POSIX readdir、`readdirp` 和 `fast-glob`；尚未修改目标源码或测试。

### 36.2 真实职责与算法

该模块只有两个直接生产 importers，但都是真实高价值 owner：

- `stable-resource-tree-read`：读取文件摘要前后的完整 tree observation；
- `todo-collection-authority`：扫描最多 196,608 个后代、按 parent/depth 组合 TODO item，并在记录读取后再次扫描比较。

核心合同：

```text
StableDirectoryRead one-level observations
  → explicit total descendant budget
  → explicit relative depth budget
  → sequential directory DFS discovery
  → child directory exact-node expectation on entry
  → every observed node kind retained; symlink never followed
  → full resource-path code-unit sort
  → complete tree result or stable error（never truncated prefix）
```

`maximumDepth` 不是“到点停止并返回部分结果”：到达深度边界的目录仍以 `maximumEntries: 0` 读取，只有证明它为空才能成功；存在隐藏后代则返回 `depth-limit`。`maximumEntries` 同样按全树剩余预算传给每层，最后一个目录若还有后代会失败而不是返回前缀。这两项设计应保留。

输出的 `name/resourcePath/parentResourcePath/depth/node` 均有实际 owner 使用；`treeRootResourcePath: null` 与一层读取保持同一 root 表示。最终全路径排序也不能改为普通 DFS 顺序：例如 `a.txt` 与 `a/child` 的完整 code-unit 次序不等于 segment preorder。

### 36.3 问题一：null expectation 被静默当作 absent

options parser 有意把 `expectedNode` 的具体准入下沉给首个 StableDirectoryRead，但内部随后使用：

```text
expectedNode: options.expectedNode ?? null
```

`null` 因此与真正 absent 合并，`directoryReadOptions()` 又省略 null，导致外部 `expectedNode: null` 静默通过。`{}`、Proxy、未冻结或字段错误值都会被下层拒绝，只有 null 成为别名。

正确做法：

- `PendingDirectory.expectedNode` 使用 `FileNodeSnapshot | undefined`；
- initial 值原样使用 `options.expectedNode`，不使用 `??`；
- 仅 `=== undefined` 时省略 lower option；任何 null/其他 forged runtime 值都原样交给 StableDirectoryRead 的唯一 parser；
- internal adapter 返回类型直接使用 `StableDirectoryReadOptions`，不再手写同形结构。

这不在 tree 层复制 FileNodeSnapshot 准入，也不改变合法 TypeScript 调用。

### 36.4 问题二：已有 expectation 时目标重分类错误

每个 descendant directory 都携带父层观察到的 exact node。如果进入它之前已经 missing、变成 symlink 或变成非目录，StableDirectoryRead 会返回 `not-found/symlink/not-directory`；当前 tree layer 将其解释为初始 tree shape，而不是父子观察间的漂移。

`readOneDirectory()` 已知道本次是否携带 expectation。建议在 expectedNode 存在时把这三种 lower reason 统一映射为 `source-changed`，路径使用 `$options.expectedNode`；没有 expectation 的起始扫描继续保留 not-found/symlink/not-directory。现有 expected-node 测试改为确定性的 directory→symlink replacement，直接验证该组合语义。

### 36.5 可删除表面与测试

| 候选 | 事实 | 结论 |
| --- | --- | --- |
| `open-failure` | 没有生产/测试引用，也没有代码发出；lower 只有 `io-failure` | 删除 reason/message |
| `enumeration-failure` | 同上 | 删除 reason/message |
| `pending.depth > maximumDepth` | depth-limit 层以 0-entry 证明空目录，不会再入栈下一层 | 删除不可达分支 |
| final duplicate resource-path loop | StableDirectoryRead 已拒绝同层重名；每个 child 只入栈一次，跨 parent 路径天然不同 | 删除 O(N) 不可达复验 |
| tree hard-link direct test | tree 没有 hard-link 分支，只原样传递 lower node；FND-FS-008 已覆盖 | 删除重复 case/import |

其余 7 项 tests 保留；options case 内加入 `expectedNode: null`，expected-node case 改为类型替换，不增加 case。

### 36.6 成熟方案与边界

- Node 24 `readdir({recursive:true})` 一次性返回整棵列表，无法在分配前执行全局 entry budget，也不提供每目录 before/after observation 或 child exact expectation。[Node fs](https://nodejs.org/docs/latest-v24.x/api/fs.html)
- [`readdirp`](https://www.npmjs.com/package/readdirp) 提供成熟 stream/backpressure、depth 和 filter，适合普通大树消费；其 depth 是停止遍历，不证明边界目录为空，默认依赖 Dirent，`alwaysStat` 也不是稳定复验。
- [`fast-glob`](https://github.com/mrmlnc/fast-glob) 面向 pattern matching，结果可为任意顺序，默认跟随 symlink，并把 filter/unique/glob policy带入遍历；不适合作为 authority tree primitive。
- 因此不新增 traversal 依赖：Wakeflow 的特殊价值来自组合已经审阅的 root/stable observation，而不是重新实现通用 glob 或 stream library。
- 整棵树仍不是 OS 原子快照，模块注释已准确说明；需要权威内容事实的两个真实 owners 都执行整体第二次扫描。

### 36.7 测试基线

```text
BoundedDirectoryTreeScan focused: 8 pass / 0 fail / 0 skip / 123.623875ms
```

覆盖 root/resource tree、global path order、start expectation、total entry budget、depth completeness、lower error mapping、passive options/AbortSignal，以及一项拟删除的 lower hard-link重复证明。

### 36.8 待确认决定

**A．保留 complete-or-error tree scan，修复 expectation 并剪除不可达表面（推荐）**

- null sentinel 改为 undefined，并使用 `StableDirectoryReadOptions`；
- 有 expectation 时 missing/symlink/not-directory → source-changed；
- 删除 2 个零发出 error reasons、2 个不可达检查；
- direct tests 从 8 精简为 7，在现有 cases 中补 null 与 type-replacement 证明；
- public result、合法 options、遍历/排序/预算行为和两个 consumers 不变；
- 验证 direct、StableResourceTree adjacent、TODO authority focused、typecheck、architecture 与 diff check。

**B．只修复 null expectation**

关闭真实输入漏洞，但继续保留并发替换误分类、零发出错误和重复测试。

**C．改用 Node recursive readdir、readdirp 或 fast-glob**

`reject`。这些成熟方案适合普通遍历，但不能表达 Wakeflow 的 exact child expectation、complete-or-error depth/entry budget 和 before/after stable observation。

### 36.9 持续推进授权与实现证据

用户授权后续按同一节奏持续推进：客观、无实质取舍的已记录推荐可直接实现；只有职责边界、公共合同、依赖选择或其他真实权衡才暂停提供方案。本单元按 A 实现：

- internal expected-node 缺省由 null 改为 undefined，显式 null 不再被省略；
- lower options 直接使用 `StableDirectoryReadOptions`，只省略真正的 undefined；
- 携带 expectation 时，target missing/symlink/not-directory 统一为 `source-changed`；无 expectation 的初始扫描错误保持原分类；
- 删除零发出的 `open-failure/enumeration-failure` reason/message；
- 删除不可达的 over-depth 分支与 O(N) duplicate resource-path 复验；
- direct expected test 改为确定性的 directory→symlink replacement，options case 补 null；
- 删除下层已覆盖且 tree 无对应分支的 hard-link case，direct tests 从 8 精简为 7。

验证结果：

```text
BoundedDirectoryTreeScan direct: 7 pass / 0 fail / 0 skip / 120.377958ms
StableResourceTree + TODO authority consumers: 12 pass / 0 fail / 0 skip / 307.383166ms
TypeScript typecheck: pass
Architecture: pass / 422 modules / 2576 dependencies
git diff --check: pass
```

## 37. FND-FS-010

### 37.1 目标文件与结论

- `src/foundation/filesystem/stable-resource-tree-read.ts`

本单元阅读了 517 行原实现、291 行 direct test、BoundedDirectoryTreeScan/StableFileRead/ByteCount dependencies、三个生产 consumers 及其测试。结论为 `accept architecture / simplify local proof / fix error mapping`，没有需要用户选择的职责或依赖取舍，因此按持续推进授权直接实现。

真实组合保持不变：

```text
bounded structure scan before
  → preflight file-count/per-file/total-byte budgets
  → p-limit(8) stable digest reads with exact entry nodes
  → bounded structure scan after with exact root expectation
  → complete before/after tree comparison
  → entries + path-ordered file facts + per-path total bytes
```

该层不读取/保留完整 bytes，不解析文件，不拒绝 symlink/special node/hard link，不生成 artifact identity。Artifact、Directory Candidate、Ledger 三个真实 consumers 分别拥有这些策略。成熟 `readdirp/fast-glob` 不提供 exact-node digest read 和 whole-tree before/after comparison，因此不替换该组合。

### 37.2 已实施修正

- internal scan adapter 返回类型改为 `BoundedDirectoryTreeScanOptions`，不再维护同形内联类型；
- `expectedNode: null` 已由 FND-FS-009 下层修复拒绝，本单元 options table 增加同 case 锁定整条组合链；
- file entries 已在 preflight 证明 `byteCount <= maximumFileBytes`，随后每个 digest read 又携带 exact node；因此 lower `too-large` 不可能代表 caller file budget，只可能是 digest scratch 运行时分配失败，改映射为 `io-failure`；
- 删除文件读取后的第二次总字节求和与恒真 equality。StableFileRead 的 exact expected snapshot 已保证返回 byteCount 等于计划节点，after tree scan 又复验完整节点；结果直接使用 preflight `planned.totalBytes`；
- hard-link test 保留：本层需要证明同一 inode 的两个路径各自产生 file fact，且总量按路径累计；这不是下层测试重复。

### 37.3 验证

```text
StableResourceTree + Artifact identity + Directory candidate + Ledger store: 23 pass / 0 fail / 0 skip / 2.236221209s
TypeScript typecheck: pass
Architecture: pass / 422 modules / 2576 dependencies
git diff --check: pass
```

direct tests 仍为 6 项；只在现有 options case 增加 null row，没有增加测试文件或 case。

## 38. Foundation Filesystem 目录观察链收束

```text
StableDirectoryRead
  └─ one level / exact entry budget / double names+metadata observation
       ↓
BoundedDirectoryTreeScan
  └─ complete-or-error total entry+depth budget / all node kinds
       ↓
StableResourceTreeRead
  └─ file count+per-file+total bytes / stable digests / whole-tree rescan
       ↓
Artifact identity / Directory candidate / Ledger / TODO
```

架构收束结论：

- 三层各自拥有不同的不变量，没有第二 scanner facade、回调 filter、全局 registry 或无状态 class；
- `p-limit@7.3.1` 只限制本地 `lstat`/file-digest I/O 并发，entry/file 数量仍由 caller 明确预算；
- portable path、node snapshot、strict raw UTF-8 名称、结构预算、内容预算和领域节点 policy 单向分层；
- TODO 直接使用结构扫描并自行 rescan，Artifact/Ledger 使用内容树读取；消费者没有被迫承担不需要的 bytes；
- direct tests 当前为 9 + 7 + 6 = 22 项，分别验证各层新增合同；hard-link 仅在“一层物理事实”和“内容按路径计数”两处保留，不在纯 tree composition 重复；
- Node 未暴露 `openat/fstatat`，整树也不是 OS 原子快照；当前 held handles、no-follow、exact expectations 与 before/after observations是 Node-only 边界内的明确 best effort，文档没有夸大；
- 无待实现 profile、零 consumer branch 或需要用户决定的抽象。`Foundation directory observation = closed for current technical skeleton`。

下一依赖邻域进入文件内部定向操作，先审阅无 I/O 的 `file-byte-range.ts`，再根据真实 consumer 判断 `stable-file-range-read.ts` 是否保留。

## 39. FND-FS-011

### 39.1 目标文件与当前结论

- `src/foundation/filesystem/file-byte-range.ts`

该模块把独立品牌的绝对 `FileByteOffset` 与 `ByteCount` 组合为冻结半开区间 `[offset, endExclusive)`，在加法前检查 safe-integer overflow，并可复验完整 range shape 与显式 file boundary。它无 I/O、无文本/行/marker 语义、无文件版本，使用函数与冻结数据正确。

真实消费拆分：

- Managed Text Envelope 使用 `parseFileByteOffset + createFileByteRange + FileByteRange`，实际读取 offset/length/endExclusive 来保留 outside bytes、替换和删除 owned region；核心不能删除或业务化。
- `parseFileByteRange + assertFileByteRangeWithin` 当前唯一生产 consumer 是 `stable-file-range-read.ts`；后者目前没有生产 consumer，故这两项表面不能在未审阅 companion 前独立定案。

半开区间与 Node `Buffer.subarray(start, end)`、positioned file read 的 end-exclusive 语义一致；零长度 EOF range 接受、offset 超 EOF 拒绝、overflow 前置检查、品牌运行时重验均合理。没有必要创建 Range class、通用 interval algebra、行号/UTF-8 边界或 mutation 方法。

测试基线：

```text
FileByteRange direct: 7 pass / 0 fail / 0 skip / 64.763333ms
```

本单元暂不改代码或测试。核心结论 `accept`；companion-only parser/bounds 表面随 FND-FS-012 一并决定。

## 40. FND-FS-012

### 40.1 目标文件与事实

- `src/foundation/filesystem/stable-file-range-read.ts`（457 行）
- `tests/foundation/filesystem/stable-file-range-read.test.ts`（318 行、8 cases）

完整 production graph 结果：`readStableFileRange`、result/options/error types、chunk constant 和整个模块均有 **0 个生产 consumer**；唯一 importer 是 direct test。模块也不进入当前 artifact candidate closure。

该实现本身不是伪代码：它使用 no-follow/non-blocking handle、exact optional node、FileByteRange、positioned chunk reads、range-only SHA-256、handle/path final snapshot、首错优先 close，并支持 zero-length EOF range。Node [`FileHandle.read(..., position)`](https://nodejs.org/docs/latest-v24.x/api/fs.html#filehandlereadbuffer-offset-length-position) 是正确底层 primitive；[`read-chunk`](https://github.com/sindresorhus/read-chunk) 等成熟小库只提供普通 offset/length 读取，不具备 Wakeflow root/no-follow/version contract；[`strtok3`](https://github.com/Borewit/strtok3) 面向有状态 token/stream parsing，不能替代该安全边界。

问题不在算法是否可用，而在当前是否应继续拥有它。

### 40.2 原计划与当前功能事实

2026-08-27 rebaseline 把该模块标为 `consumer-needed`，计划由 INF-3 Managed Text 接线；2026-08-28 Technical Skeleton Gate进一步写明：完成精确文件区域/下一业务路线后仍无 consumer，应优先删除而不是继续维护。

现在 INF-3 已完成：

- Program Instruction 与 `.gitignore` 都通过 `readStableFile()` 读取完整文件，显式上限均为 2 MiB；
- Managed Text 必须验证完整 UTF-8、全文件 marker 数量/配对、outside digest，并在更新/删除时逐字节保留两侧区域后进行 whole-file CAS/atomic rewrite；
- 只读 marker/body range 无法证明 marker 唯一性或 outside bytes，也不能产生重组目标；为了“接线”再读一次区间只会增加 I/O 和第二错误边界；
- TODO 使用 JSON authority 与完整 Markdown projection，没有可信 offset index；Event Sourcing 当前按单 commit 文件存储，不是需要 tail range 的共享日志；
- 旧 Wakeflow 与 TencentDB-Agent-Memory 都没有可迁移的持久 offset+source-version index consumer。

因此当前没有“局部读比整文件更快”的真实调用：只有先建立可信索引、文件版本绑定且调用方不需要完整表示时，positioned range read 才成立。

### 40.3 若保留，仍需修正的债务

当前 8 项测试全部通过（95.968416ms），但逐文件审阅仍发现：

- initial `resource-changed/resource-alias` 仍误映射为 `root-scope`；
- expectation mismatch 路径与 StableFileRead 不一致；
- `snapshotOpenedFile()` 有同结果异常分支；
- exported chunk constant 没有生产 consumer；
- 457 行实现复制了 StableFileRead 的 root/open/fstat/path/close 生命周期，未来两者容易再次漂移；
- companion `parseFileByteRange/assertFileByteRangeWithin` 及 4 个 range tests 只为该零 consumer 模块存在。

保留不是零成本 defer：需要先修正并持续同步上述安全合同。

### 40.4 删除后的精确边界

推荐删除：

- `stable-file-range-read.ts` 与 8-case direct test；
- `file-byte-range.ts` 中仅 companion 使用的 `parseFileByteRange()`、`assertFileByteRangeWithin()`、完整-range parser，以及 `range-shape/range-field/file-size/out-of-bounds` reasons；
- `file-byte-range.test.ts` 中对应 4 个 cases（7 → 3）。

继续保留：

- `FileByteOffset`、`FileByteRange`；
- `parseFileByteOffset()`、`createFileByteRange()`；
- offset/length/end overflow 稳定错误；
- Managed Text 的四类实际 range facts 及其 consumer tests。

未来出现可信 offset index、巨大 append log tail、二进制 header 或其他真实 consumer 时，应从当时的 source-version/index/maximum/cancellation 语义重新建立范围读取，而不是承诺此候选 API 兼容。

### 40.5 需要用户决定

**A．删除零 consumer range reader 与 companion-only 表面（推荐）**

符合当前 Gate、已完成 INF-3 的事实和“及时清理未来占位”原则；减少 1 个生产模块、1 个测试文件、约 775 行及 12 个无真实 consumer tests。Managed Text 的真实 range 数据能力不受影响。

**B．保留为明确预建 Foundation 能力**

如果用户仍把“未来可信索引驱动的局部读取”视为当前 technical skeleton 的必备能力，则保留；但下一步必须修正 40.3 的漂移/错误/重复表面，并继续承担 8 项测试与双内核同步成本。它仍只能标记为 `consumer-needed`，不能宣称垂直能力完成。

**C．强行接入 Managed Text 以制造 consumer**

`reject`。会在完整读取之外增加一次无必要 range I/O，并削弱而非增强全文件 marker/outside authority。

### 40.6 用户决定与删除证据

用户确认按推荐 A 继续。已删除：

- `src/foundation/filesystem/stable-file-range-read.ts`（457 行）；
- `tests/foundation/filesystem/stable-file-range-read.test.ts`（318 行、8 cases）；
- `file-byte-range.ts` 中 range-reader-only parser、file-boundary assertion、4 个专属 error reasons 及 passive-data dependency；
- `file-byte-range.test.ts` 中 4 个 companion-only cases（7 → 3）。

已保留并验证 Managed Text 使用的 `FileByteOffset/FileByteRange/parseFileByteOffset/createFileByteRange`、overflow 准入和四类 envelope ranges。

验证结果：

```text
FileByteRange + Managed Text Envelope: 5 pass / 0 fail / 0 skip / 63.068166ms
Removed production/test symbol references: 0
TypeScript typecheck: pass
Architecture: pass / 420 modules / 2560 dependencies（此前 422 / 2576）
git diff --check: pass
```

删除是 Git 可恢复的未提交变更；没有删除任何持久数据、Workspace 文件或已安装插件内容。

## 41. FND-FS-013

### 41.1 目标文件与结论

- `src/foundation/filesystem/whole-file-content-transition.ts`

该纯函数是 Support Memory 的真实 whole-owned consumer gate：absent → create，exact desired → current，exact admitted previous render → replace，其他 bytes → reject。稳定读取、node policy、CAS、atomic publish、readback 和领域 authority 均留在 consumer，Foundation 不拥有 I/O 或业务 renderer。

结论为 `accept responsibility / simplify zero-consumer result surface`，没有用户取舍：

- 保留有界 `currentContents` 作为最多 8 个已知旧 renderer 的机械演进接缝；命名私有上限常量，未增加配置；
- 删除零生产 consumer 的 kind constant/field、matched index、source byte count/digest；source facts 已由调用 owner 的 StableFileSource持有；
- transition 只保留 `disposition/sourceAuthority/desiredByteCount/desiredDigest/desiredBytes` 五个真实使用字段；
- request closed-shape 在解析 dense current array 前完成，避免非闭合请求先进入成员准入；
- duplicate current 检查改为无 slice 分配的有界双循环；
- direct tests 仍为 2 项，在既有 cases 中增加 closed-shape 和精简 result shape，不新增 case。

验证结果：

```text
WholeFileTransition + Support inspection/publication: 9 pass / 0 fail / 0 skip / 416.574208ms
Removed field/symbol references: 0
TypeScript typecheck: pass
Architecture: pass / 420 modules / 2560 dependencies
git diff --check: pass
```

当前文件内部定向能力收束为：Managed Text 使用的半开 range facts，以及 whole-owned file 使用的 known-current transition。没有无 consumer positioned reader、原地变长写入或 generic region manager。

## 42. FND-FS-014

### 42.1 目标文件与结论

- `src/foundation/filesystem/durable-atomic-file-stage-address.ts`

该模块真实拥有同目录 atomic stage 的自描述文件名、target/input/mode route facts、进程/Worker/attempt owner token，以及同进程活动登记和跨进程保守 liveness observation。Stage IO、Stage Recovery、Config recovery 和两类 layout inventory 均为真实 consumers。

`process.kill(pid, 0)` 只作为保守存在性观察：Node 与 POSIX 均规定 signal 0 不发送信号，只检查存在性/权限；ESRCH 以外错误保持 unknown，PID reuse、zombie、不同 Worker 都只会延迟清理而不会授权误删。Stage filename和 owner state仍不单独授予删除权限，Recovery 继续复验 target route、content digest、mode、node/link与 owner state。

### 42.2 已实施修正

- crash residue filename 从无版本格式改为 `.wakeflow-atomic-v1-...`；宽保留前缀仍是 `.wakeflow-atomic-`，未知未来版本会被 inventory 识别为 residue但不会被当前 parser 清理；
- 增加 238 ASCII 字符的可解析上限，先拒绝超长伪造输入再执行正则；最大 safe pid/thread 仍可完整表示；
- 模块注释明确 target/input digest只用于路由与相等性，不提供保密性；
- owner-state 通过 descriptor-only 私有 helper读取 own data `fileName`，拒绝 Proxy/accessor且不执行 getter；
- 删除 0 生产 consumer 的 `durableAtomicFileStageRef()`；九个构造 crash residue 的测试改用 `tests/foundation/filesystem/durable-atomic-file-test-support.ts`，格式构造不再污染 Foundation API；
- direct cases仍为2项，在原 case 内补 v1、超长名称和 accessor zero-call；
- 同步润色模块标题为“耐久原子文件发布的自描述暂存地址”。

### 42.3 验证

```text
Stage Address + Stage Recovery + Atomic Write: 18 pass / 0 fail / 0 skip / 493.162583ms
Removed production stage-ref references: 0
TypeScript typecheck: pass
Architecture: pass / 421 modules / 2571 dependencies
git diff --check: pass
```

相对删除 range reader 后的 420/2560，新增的 1 个模块与 11 条依赖全部来自共享 test support；生产模块没有增加。

## 43. FND-FS-015

### 43.1 目标文件与结论

- `src/foundation/filesystem/durable-atomic-file-write-contract.ts`

该文件集中拥有 64 MiB recoverable-stage硬上限、create/replace options、完整 StableFileSource expectation、created/replaced receipts、atomic write稳定错误 vocabulary，以及供 facade/stage/target I/O 共用的无行为 options/input snapshots。21 个写入 consumers 与多个 replacement receipt consumers证明公共合同真实存在。

结论为 `accept contract / fix byte snapshot boundary / narrow internal types`：

- create/replace options与完整 expectation保持分离；replace继续要求 resourcePath/node/byteCount/digest 四项，实际 target path relation由 write facade在已知目标后复验；
- result保留 resourcePath/publication/node/byteCount/digest，replace额外 previous expectation；这些字段均参与 owner readback/CAS/commit-uncertain判断；
- 64 MiB上限继续属于单文件 recoverable stage，不是领域默认；artifact/tree等更大传输走其他能力；
- `ParsedDurableAtomicFileCreateOptions/ReplaceOptions` 没有模块外 consumer，改为私有；
- input snapshot新增 Proxy与 SharedArrayBuffer-backed Uint8Array拒绝，避免行为执行和并发可变来源；
- 先从有效 Uint8Array取得可见 byteCount并检查64 MiB上限，再复制；不再先分配超限副本；
- 合法输入的 Buffer复制失败改映射 `capacity`，不再误报 `input`；
- existing options test内补 Shared/Proxy zero-trap，测试 case数量不变；
- 两处中文标题由“持久化”润色为“耐久”。

验证结果：

```text
DurableAtomicFileWrite focused: 12 pass / 0 fail / 0 skip / 374.0895ms
Exported parsed option types: 0
TypeScript typecheck: pass
Architecture: pass / 421 modules / 2571 dependencies
git diff --check: pass
```

## 44. FND-FS-016

### 44.1 目标文件与结论

- `src/foundation/filesystem/exact-regular-file-unlink.ts`

该能力有8个生产 consumers，持有 exact source FileHandle与parent handle，在提交前复验 pathname/handle/expected snapshot，执行一次 `unlink` 后从仍打开的 inode证明 linkCount精确减1，再同步 inode与父目录。POSIX明确规定unlink删除目录项并递减链接数，最后链接删除后只要仍有打开描述符，文件内容和inode继续存在；当前实现以该标准语义完成提交后证明。

默认要求 pathname在两个settlement observation中保持 absent；仅 RootedExclusiveFileLock显式使用 `replacement-allowed`，允许不同 dev/ino 的新锁在 release后立即取得原名。相同 inode hard-link successor仍拒绝。Node没有暴露条件式 `unlinkat` CAS，提交前最后一次复验到unlink之间的路径竞态无法完全消除，因此文档正确要求领域锁/恢复意图且提交后失败一律按uncertain处理。

### 44.2 已实施修正

- options 中 `settlement` 从 nullish缺省改为只在 `undefined` 时缺省；显式 null 现在返回 `$options.settlement` input；
- receipt继续保留 `resourcePath/nodeBefore/nodeAfterUnlink/replacementObserved`；删除 `previousLinkCount/remainingLinkCount` 两个与节点快照完全重复且无生产 consumer的字段；
- direct tests改为从前后节点断言2→1与1→0，并在现有options case补null；test case数量仍为6；
- 模块与函数标题由“持久化删除”润色为“耐久删除”。

验证结果：

```text
ExactUnlink + RootedExclusiveLock + StageRecovery: 17 pass / 0 fail / 0 skip / 994.108375ms
TypeScript typecheck: pass
Architecture: pass / 421 modules / 2571 dependencies
git diff --check: pass
```

## 45. FND-FS-017

### 45.1 目标文件与结论

- `src/foundation/filesystem/durable-regular-file-settlement.ts`

该能力供 Atomic Stage Recovery 与 Demand File Event Store 在“目录项已经可见、原发布调用未完成 durability receipt”时补做 file inode fsync、parent fsync与最终 exact-node/path复验。它不创建、写入、link、rename、unlink或推断发布来源；调用 owner必须先以意图、digest、mode/link和节点身份准入目标。

两个生产 consumers 都只等待成功或映射失败，从未读取 `DurableRegularFileSettlementResult`。原 result 的 `parentNode` 来自 `parent.sync()` 返回时，之后还会执行 `assertParentCurrent`，把它暴露为“最终父目录事实”反而不准确。

已实施：

- 删除 0 consumer 的 result interface与 `{resourcePath,node,parentNode}` 对象；
- `settleRegularFileDurability()` 收敛为 `Promise<void>`；
- 内部保留 `settled` terminal invariant、首错优先 close、file sync→parent sync→parent/resource final revalidation完整流程；
- `syncParent()` 也收敛为 void，避免传播非最终 snapshot；
- direct test在结算返回后通过 RootedDirectory重新观察 exact target，仍证明2-link与1-link节点未漂移；3个cases不变。

验证结果：

```text
Settlement + StageRecovery + DemandFileEventStore: 14 pass / 0 fail / 0 skip / 958.400834ms
Removed result type references: 0
TypeScript typecheck: pass
Architecture: pass / 421 modules / 2571 dependencies
git diff --check: pass
```

## 46. FND-FS-018

### 46.1 目标文件与结论

- `src/foundation/filesystem/durable-atomic-file-stage-recovery.ts`

该模块有21个生产 importers，拥有三种明确恢复 scope：whole owned directory、closed same-parent target set（foreign stage preflight reject）、matching target subset（safe foreign stage ignore）。它只清理 inactive owner；active/unknown均保留。Single-link stage是非权威候选可exact rollback；create two-link stage必须与同级target构成same inode/full snapshot/mode/link/digest，并先补全target durability再exact unlink stage。

该策略与Stage Address、StableDirectoryRead、StableFileDigest、Settlement和ExactUnlink职责单向组合，没有自动mtime stale、跨目录恢复或“名称合法即可删除”。

### 46.2 已实施修正

- `targetForStage()` 原先对每个2-link stage重新filter并hash全部目录项，最坏 O(stage×entry)，与100,000项上限不相称；改为仅存在2-link stage时建立一次 `Sha256Digest → entries[]`索引，查找总成本 O(entry+stage)，collision/multiple match仍fail closed；
- target digest集合从 `ReadonlySet<string>`收紧为 `ReadonlySet<Sha256Digest>`；
- parse target scope时立即计算digest并把reserved-prefix等 `DurableAtomicFileStageAddressError` 映射为 Recovery input，direct existing case补该断言；
- 删除0外部consumer的 `DURABLE_ATOMIC_FILE_STAGE_MAXIMUM_BYTES` alias，直接使用write contract的64 MiB authority；
- 删除0生产consumer的 `recoverDurableAtomicFileStagesInTargetParent()`；三个direct场景改走真实 `recover...ForTargets([target])`，case数量仍为4；
- whole-directory、closed-target与matching-target三种真实API及receipt counters全部保留。

验证结果：

```text
StageRecovery + AtomicWrite: 16 pass / 0 fail / 0 skip / 428.709667ms
Removed alias/API references: 0
TypeScript typecheck: pass
Architecture: pass / 421 modules / 2572 dependencies
git diff --check: pass
```

新增1条架构依赖是Stage Recovery对 `Sha256Digest` 的真实type-only边，不是新模块或运行时依赖。

## 47. FND-FS-019

### 47.1 目标文件与结论

- `src/foundation/filesystem/durable-atomic-file-stage-io.ts`

该内部模块由Atomic Write facade独占使用，并向Target I/O共享opened-handle snapshot。它拥有：同父目录 `O_CREAT|O_EXCL|O_NOFOLLOW` stage创建、4次UUID collision尝试、exact positioned write、target mode chmod、stage fsync、byte-for-byte readback/growth probe、handle/path currentness、owned stage unlink与handle/address release。公开产品调用方仍只使用Atomic Write facade。

恢复preflight继续忽略安全active same-target stage（它不是锁），阻止unknown owner；busy stable inventory可让写入继续依赖最终OS no-replace/CAS提交点。Replace correctness仍要求领域锁，Stage token不冒充互斥。

### 47.2 已实施修正

- verify scratch与1-byte growth probe统一经过私有allocation helper；分配失败按调用阶段映射 `stage-changed` 或 `commit-uncertain`，不泄漏原生异常；
- `snapshotDurableAtomicFileHandle()` 与stage pathname snapshot删除同结果 `FileNodeSnapshotError` 分支；
- owned cleanup在unlink前新增file kind与1/2-link policy，继续核对path/opened inode；
- unlink成功后再次fstat opened handle，要求same identity且 linkCount 精确减1；pathname race不再可能被静默报告为cleanup成功；
- unlink返回ENOENT仍表示本调用没有删除别的路径名，安全视为stage pathname已不在；
- 模块标题由“持久化”润色为“耐久”。

验证结果：

```text
StageIO via AtomicWrite + StageRecovery: 16 pass / 0 fail / 0 skip / 447.33ms
TypeScript typecheck: pass
Architecture: pass / 421 modules / 2572 dependencies
git diff --check: pass
```

## 48. FND-FS-020

### 48.1 目标文件与结论

- `src/foundation/filesystem/durable-atomic-file-target-io.ts`

该内部模块组合 RootedResourceParentHandle、StableFileDigest 与 prepared stage handle，拥有parent open/current/sync/close、create target absence、replace full expectation reread和committed target physical observation。产品调用方不直接使用，Atomic Write facade是唯一 importer。

已实施两项无争议修正：

- replace expectation已先绑定exact node且 `maximumBytes === expected.byteCount`；lower `too-large`不可能表示caller byte budget，只能是digest scratch运行时分配失败，现落入 `expectation-read-failure`，不再误报 `expectation-changed`；
- committed target与opened stage handle除same identity外，新增 `sameFileNodeSnapshot(opened,target)`，在本层直接要求kind/mode/link/size/time等完整观察一致；facade后续before/after snapshot comparison继续保留。
- 模块标题由“持久化”润色为“耐久”。

验证结果：

```text
DurableAtomicFileWrite focused: 12 pass / 0 fail / 0 skip / 357.172ms
TypeScript typecheck: pass
Architecture: pass / 421 modules / 2572 dependencies
git diff --check: pass
```

## 49. FND-FS-021

### 49.1 目标文件与结论

- `src/foundation/filesystem/durable-atomic-file-write.ts`

Facade是21个生产模块使用的唯一atomic file writer。Create编排：same-parent exclusive stage→exact write/chmod/fsync→target absent复验→hard link no-replace→file sync/readback→parent sync→stage unlink→file+parent再同步→final exact receipt。Replace编排：full StableFileSource expectation两次复验→same-parent stage→exact readback→rename overwrite→file sync/readback→parent sync→final exact receipt。提交后不再响应AbortSignal，任何失败均保留commit-uncertain/durability语义。

[`write-file-atomic`](https://www.npmjs.com/package/write-file-atomic) 与 [`atomically`](https://github.com/fabiospampinato/atomically) 是成熟的一般方案，也采用PID/Worker临时名、fsync、rename和同路径队列；但它们不提供RootedDirectory、hard-link no-replace create、full StableFileSource expectation、自描述stage恢复、target-scoped residue policy和两次parent durability证明。用户也已明确不引入 `@openclaw/fs-safe`。当前自建内核由Wakeflow特有合同驱动，不应替换成一般库或再叠加adapter。

本单元未发现提交顺序、public result或error vocabulary的待选分歧；24个error reasons均有实际发出路径。唯一局部修正位于Stage I/O：byte-for-byte验证从每字节JS循环改为每chunk `Buffer.subarray().equals()`，保持精确比较与三次create/两次replace验证窗口，显著降低大文件CPU成本。Facade及三处中文注释统一使用“耐久”。

验证结果：

```text
AtomicWrite + StageRecovery: 16 pass / 0 fail / 0 skip / 394.901708ms
TypeScript typecheck: pass
Architecture: pass / 421 modules / 2572 dependencies
git diff --check: pass
```

## 50. Foundation Filesystem 耐久原子单文件链收束

```text
Write Contract + bounded immutable input
  → versioned Stage Address / conservative owner state
  → target-scoped Stage Recovery
  → exclusive Stage I/O + exact bytes + fsync
  → Parent/Expectation/Committed Target I/O
  → link(no-replace create) / rename(replace) commit facade
  → file fsync + parent fsync + exact readback receipt
```

系统结论：

- create与replace共享stage/verification/durability，不共享提交语义；没有generic mode switch暴露给产品层；
- 目标不存在、前序expectation、stage route、owner liveness、node/link/mode、bytes/digest与durability均有单一owner；
- active stage不冒充锁，replace继续要求领域互斥；unknown owner永不自动删除；
- create在link后与stage unlink后各同步parent，replace在rename后同步parent；失败不会伪装为未提交；
- exact unlink与durability settlement已作为独立可复用effect审阅；
- tests保持按层：Address 2、Recovery 4、Atomic Write 12、Exact Unlink 6、Settlement 3；重型领域recovery不复制到每个文件单元；
- 无零consumer生产模块、无未版本化stage格式、无test-only生产 helper、无隐藏queue/manager；
- Node没有conditional rename/unlink CAS，最终pathname竞态仍要求领域锁与恢复意图，文档已明确。

`Foundation durable atomic single-file mutation = closed for current technical skeleton`。下一基础邻域进入 Rooted Exclusive Lock，再审阅目录物化/候选/树发布或其他依赖顺序。

## 51. FND-FS-022

### 51.1 目标文件与策略结论

- `src/foundation/filesystem/rooted-exclusive-file-lock.ts`

该锁被Config、TODO、Ledger、Demand、Maintenance、Managed Integration和Window Runtime真实使用。获取通过DurableAtomicFileCreate的OS no-replace边界；竞争等待使用monotonic deadline与AbortSignal；临界区可跨await；release以exact created node删除并允许different-inode successor；crash residue只有领域owner提供意图证据、inactive owner与issued observation后才能退休。

[`proper-lockfile`](https://github.com/moxystudio/node-proper-lockfile) 使用mkdir、mtime heartbeat和stale takeover，适合其NFS/共享文件系统目标，也明确承认手工删除后重建等compromised窗口。Wakeflow已确认只承诺可靠本地文件系统，拒绝mtime自动夺锁；当前O_EXCL durable record＋exact release＋显式恢复不是成熟库的错误复刻，也不应为了引入依赖而改变安全模型。

### 51.2 已实施修正

- 删除无任何语义consumer的 `createdAt` 和 wall-clock/UTC parser依赖；同步锁只使用monotonic clock控制等待，record不再提供可能诱导stale判断的时间；
- v1 lock record收敛为 `kind/pid/threadId/token/version`；11份跨领域crash fixture统一使用 `rooted-exclusive-file-lock-test-support.ts` renderer，避免重复维护持久格式；
- 3个默认/容量常量无外部consumer，改为私有；
- timeout/retry只在字段真正undefined时使用默认值，显式null不再静默接受；
- residue `relatedTargetResourcePaths`同样只在undefined时缺省，显式null拒绝；并在任何I/O前验证全部related targets与lockPath同父目录；
- held lock node新增current euid policy（平台提供geteuid时），避免显式恢复信任foreign-owner record；
- timers/promises非Abort异常统一映射 `acquire-failure`，不泄漏下层错误；
- absent observation不再加入仅供held residue retirement使用的WeakSet；
- candidate render/UTF-8内部失败统一为 `acquire-failure`；
- direct 7 cases不变，在既有input/residue cases补null与跨父目录；三个代表性领域fixture套件全部通过。

### 51.3 验证

```text
RootedExclusiveFileLock direct: 7 pass / 0 fail / 0 skip / 847.562542ms
Config replacement + Maintenance orphan + Program Instruction: 14 pass / 0 fail / 0 skip / 1.141426375s
TypeScript typecheck: pass
Architecture: pass / 422 modules / 2582 dependencies
git diff --check: pass
```

架构相对前一节点增加1个test-support模块和10条test依赖，生产模块未增加。`Rooted exclusive local lock = closed for current technical skeleton`。

## 52. FND-FS-023

### 52.1 目标文件与结论

- `src/foundation/filesystem/absolute-directory-placement.ts`

该模块只负责规范非根绝对目录位置的只读物理准入：逐段拒绝符号链接和非目录，区分present/missing，并在present时给出规范真实路径及最终目录节点。配置根拓扑验证直接消费它；绝对目录物化把它作为创建前后的准入边界。它不创建目录、不授予根内I/O能力，也不拥有Workspace registry。

审阅发现present结果原先把逐段 `lstat` 得到的较早节点快照，与随后独立 `realpath` 得到的较晚路径拼成同一观察；并发替换时二者可能不再指向同一节点。Node官方文档明确Promise文件系统操作之间不会自动同步，并要求显式关闭FileHandle，因此单纯按调用顺序不能形成稳定观察。

### 52.2 已实施修正

- 保留逐段 `lstat` 对整条路径链的symlink/type准入；
- 最终present节点改由既有 `RootedDirectory.open()`＋`assertCurrent()` 的handle-backed准入生成，复用其realpath、opened handle、pathname与inode一致性证明；
- 无论成功或失败都显式关闭临时root；关闭失败或root漂移统一映射为脱敏 `inspection-failure`；
- CFG-002真实consumer随后证明missing目标必须同时验证最近已存在祖先的规范拼写；当前合同补充一个handle-backed `nearestExistingAncestor`，不包含创建计划、registry或权限；
- 无法不注入生产测试钩子而确定性制造pathname竞态，因此没有增加脆弱的概率型race测试，现有3项行为测试保持准确。

验证结果：

```text
AbsoluteDirectoryPlacement direct: 3 pass / 0 fail / 0 skip / 59.041208ms
TypeScript typecheck: pass
Architecture: pass / 422 modules / 2583 dependencies
git diff --check: pass
```

新增1条生产依赖是Placement复用已经存在的RootedDirectory稳定句柄能力，不是平行文件系统实现。

## 53. FND-FS-024

### 53.1 目标文件与结论

- `src/foundation/filesystem/absolute-directory-materialization.ts`

该模块是绝对位置与根内目录内核之间的窄适配层：先验证目标位置，找到非文件系统根的最近规范真实祖先，打开一次RootedDirectory，再复用 `materializeDirectoryPath()` 逐段创建并最终复验inode。它只执行上层已经确认的目录目标，不拥有Config/Catalog/Workspace布局决策；已有目录不改权限，失败不伪装成整条路径事务或自动回滚已耐久前缀。

原实现向上枚举每个候选祖先时，都调用Placement从文件系统根重新逐段扫描，深度为d的路径最坏执行O(d²)次路径观察。对于批量Workspace目录物化，这是没有增加正确性的系统调用放大。

### 53.2 已实施修正

- 直接消费Placement单次逐段观察返回的最近稳定祖先，不再自行向上探测或重复扫描；
- missing目标的准入与祖先固定合计O(d)；进入RootedDirectory/逐段mkdir前再次响应AbortSignal；
- 非预期系统错误继续按既有语义映射为脱敏 `path-changed`；symlink、type和alias仍由完整Placement稳定分类；
- `AbsoluteDirectoryMaterializationOptions/Entry/Result` 没有任何显式类型consumer，改为模块私有；函数结构化签名、返回推断和稳定Error/Reason保持对外；
- 未新增manager、registry、recursive mkdir捷径或第二套创建内核。

验证结果：

```text
Placement + Materialization direct: 5 pass / 0 fail / 0 skip / 148.370083ms
Materialization + Support Root + Static Step Executor: 6 pass / 0 fail / 0 skip / 2.43016825s
TypeScript typecheck: pass
Architecture: pass / 422 modules / 2584 dependencies
git diff --check: pass
```

CFG-002回补后，Materialization已删除lstat搜索与Node错误码依赖；目录创建与准入authority没有变化。

## 54. FND-FS-025

### 54.1 目标文件与结论

- `src/foundation/filesystem/durable-directory-materialization.ts`

该模块是目录创建effect authority。单段create执行：已打开parent准入→target absent→非递归 `mkdir(0700)`→`O_DIRECTORY|O_NOFOLLOW` 打开新目录→句柄chmod最终mode→目录fsync→parent fsync→parent/path/handle完整复验。多段materialize只按PortableResourcePath前缀组合该原语，已有目录只观察、不修权限，失败保留已耐久前缀。

[POSIX mkdir](https://pubs.opengroup.org/onlinepubs/9799919799/functions/mkdir.html) 保证单次目录项创建成功/失败的原子边界，并说明mode会受umask影响；[POSIX目录操作说明](https://pubs.opengroup.org/onlinepubs/9799919799/xrat/V4_xbd_chap01.html) 明确原子目录修改并不自动耐久，需要对目录执行fsync。Node提供非递归mkdir和FileHandle同步，但没有mkdirat；当前0700初建、handle chmod、目标/父目录双同步和路径复验符合Wakeflow本地多进程场景。TencentDB-Agent-Memory多数目录使用recursive mkdir，敏感数据库目录另行chmod 0700；该做法适合普通初始化，却不提供Wakeflow恢复链需要的root/inode/durability证据，不能替换本内核。

### 54.2 已实施修正

- 多段materialize已在入口完成root/options准入，内部改为直接调用私有 `performAtomicCreate()`，不再每个缺失段重复解析同一options和再次校验同一root；
- 删除仅为上述重复调用重新分配对象的 `publicOptions()`；
- prefix构造改为单次累积字符串，不再每层创建 `segments.slice()` 中间数组；每个前缀仍经过PortableResourcePath parser取得真实brand；
- 删除不增加状态证明的 `committed` 布尔位；成功result已经蕴含mkdir后完整提交链完成；
- `DurableDirectoryCreateResult/DirectoryMaterializationEntry/Result` 没有显式consumer，收回模块内部；真实外部消费的Options、Disposition、Error/Reason保留；
- `snapshotHandle()` 删除结果相同的重复异常分支，不改变脱敏错误语义。

验证结果：

```text
DurableDirectoryMaterialization direct: 8 pass / 0 fail / 0 skip / 278.428375ms
Active Layout + Demand File Event Store consumers: 9 pass / 0 fail / 0 skip / 1.022534042s
TypeScript typecheck: pass
Architecture: pass / 422 modules / 2584 dependencies
git diff --check: pass
```

## 55. Foundation Filesystem 目录物化链收束

```text
AbsoluteDirectoryPlacement (read-only physical admission)
  → AbsoluteDirectoryMaterialization (confirmed absolute target adapter)
    → RootedDirectory (handle-backed stable scope)
      → RootedResourceParentHandle (exact parent capability)
        → DurableDirectoryMaterialization (mkdir/chmod/fsync/verify effect)
```

系统结论：

- 配置/Workspace owner决定“哪些目录应该存在”，Foundation只观察位置或执行明确目标；
- 绝对路径准入、绝对到根内桥接、根能力、parent能力和创建effect各有单一职责，没有FileManager或Workspace registry；
- present observation不再拼接不同时间的path/node事实，祖先搜索不再反复从文件系统根扫描；
- 单段创建是namespace原子且file-system耐久的，多段物化明确不是事务、不会危险回滚；
- Node缺少mkdirat的pathname竞态限制在所有三层注释中一致声明，不伪装为恶意进程沙箱；
- direct tests分别维持Placement 3、Absolute Materialization 2、Durable Materialization 8，真实consumer只在边界节点抽样，不复制整个恢复系统。

`Foundation directory placement and durable materialization = closed for current technical skeleton`。

## 56. FND-FS-026

### 56.1 目标文件与已确认事实

- `src/foundation/filesystem/directory-tree-candidate-plan.ts`
- `src/foundation/filesystem/directory-tree-candidate-inspection.ts`

Candidate Plan把有序文件清单编译为目录闭包、逐文件mode/bytes/digest、总字节数和canonical tree digest；Inspection以该计划为精确inventory读取候选树。它们是Ledger Record发布、Loaded Artifact Tree transfer和generic tree publication共享的Foundation合同。

已确认的正确部分：文件输入必须严格排序；目录由文件父路径唯一派生；plan parser重建目录/总量/digest而非信任冗余字段；实际树按exact inventory、mode、link count、bytes和digest闭合；candidate本身不成为authority。

### 56.2 待解决的容量authority缺口

新建计划时 `DirectoryTreeCandidateOptions` 会限制depth/entries/files/per-file bytes/total bytes，但这些预算不进入plan。持久plan再次由 `parseDirectoryTreeCandidatePlan()` 准入时，只保留4096 files和8192 directories两个shape上限；path bytes、depth、per-file bytes与total bytes没有Foundation硬上限，也没有caller limits参数。Inspection随后直接把plan自报的最大文件和总字节数作为物理读取预算。

真实consumer并不等价：

- Loaded Artifact Tree通过manifest再次绑定64层、8192 entries、4096 files、1024 ref bytes、32 MiB/file、256 MiB total；
- Ledger创建端使用64层、256 entries、33 files、4 MiB/file、16 MiB total，但持久publication intent恢复解析只关联文件path/digest/mode，文档file byteCount与plan total没有完整重验；
- generic tree publication重新解析candidate中的plan，同样没有独立capacity参数。

因此“plan关系有效”和“允许按多大预算执行I/O”当前混在一起。合法digest不能成为资源使用授权。

### 56.3 已发现且不依赖方案的局部问题

- `assertPathClosure()` 对最多4096个文件执行全量两两prefix比较，为O(n²)；排序后只需相邻prefix检查；
- 父目录派生和maximum depth使用重复slice/map/spread，可改为有界线性循环；
- generic plan未拒绝 `A/...` 与 `a/...` 的跨平台目录/文件冲突，Loaded Artifact却在上层重复拥有同类规则；
- bytes入口未像Atomic Write合同一样拒绝SharedArrayBuffer，也没有把snapshot allocation失败映射为稳定capacity错误；
- `prepareDirectoryTreeCandidate()` 在同步复制和hash全部输入后才由effect consumer检查预先aborted signal。

这些局部修正将在容量方案确认后同一单元完成，避免先形成半套合同。

### 56.4 待选方案

1. 推荐：Foundation固定保守hard ceiling，owner只可收紧并在持久记录解析时重验自己的预算。当前可用已验证的最大真实场景作为v1 ceiling：64 depth、8192 entries、4096 files、1024 UTF-8 path bytes、32 MiB/file、256 MiB total。plan shape/schema/digest不增加policy字段。
2. 每次parse/inspect/publish都强制传入完整limits。预算最精确，但会扩张所有generic API和恢复调用，并反复传递同一政策对象。
3. 把limits写入Plan v2并纳入tree digest。记录自包含，但同一内容因政策不同产生不同identity，且需要Schema/version evolution；不推荐把准入政策变成树内容身份。

参考仓库的敏感入口同样采用固定系统上限，再由具体功能设置更小预算；这支持方案1的分层，而不支持信任持久manifest自报资源量。

### 56.5 用户决定与已实施合同

用户确认采用方案1。v1 Foundation ceiling固定为：64 depth、8192 total entries、4096 files、1024 UTF-8 path bytes、32 MiB/file、256 MiB total。它只限制资源消耗，不进入Plan字段或tree digest；同一内容不会因owner政策不同获得不同身份。

- `DirectoryTreeCandidateOptions` 在任何复制/hash前拒绝超过硬上限的请求，并在处理输入前响应预先aborted signal；
- bytes输入拒绝Proxy与SharedArrayBuffer-backed Uint8Array，先检查可见长度再复制；复制分配失败稳定映射capacity；
- `parseDirectoryTreeCandidatePlan(value, capacity?)` 始终执行Foundation ceiling；可选capacity是闭合被动数据且只能收紧；
- Schema同步将 `file.byteCount` 收紧到32 MiB、`totalBytes`收紧到256 MiB；UTF-8 bytes/depth/combined entries等跨字段关系继续由runtime重建；
- Loaded Artifact parser显式传入其manifest limits；Ledger publication intent parser显式传入64 depth、256 entries、33 files、4 MiB/file和16 MiB total；
- 新增Ledger回归使用不分配5 MiB payload的descriptor plan，证明“Foundation允许但Ledger超限”的持久计划会被owner拒绝。

### 56.6 复杂度与跨平台修正

- 文件路径prefix冲突从全量O(files²)比较改为file-path Set＋逐级parent查找，复杂度与总路径段数成正比；
- parent目录在派生过程中按combined-entry hard ceiling提前停止，不先构建超量集合；
- path depth改为无split计数，maximum depth不再map/spread所有条目；
- 目录与文件共享一个lowercase collision key集合，统一拒绝 `A/...`/`a/...` 以及file-vs-directory跨平台冲突；Loaded Artifact原有manifest collision验证仍作为其领域入口防线；
- Inspection在一次entries遍历中同时完成expected校验与observed集合，不再filter/map重复转换relative path；
- partial retry把missing数组转Set后求差，删除O(plan×missing) includes；已有文件的精确字节复验保留，但改用无复制Buffer view原生equals。

### 56.7 验证

```text
Plan/Candidate + owner parsers: 11 pass / 0 fail / 0 skip / 276.659334ms
Candidate → generic publication → Loaded transfer/publish → Ledger store: 30 pass / 0 fail / 0 skip / 2.663396708s
Schema build/check: pass / 34 schemas / 65 external ref edges
TypeScript typecheck: pass
Architecture: pass / 422 modules / 2586 dependencies
git diff --check: pass
```

两条新增生产依赖分别是Plan对Node Buffer byteLength的UTF-8容量计算，以及Inspection对Buffer view原生比较；没有新增模块、manager、持久字段或业务分支。`Directory tree candidate plan and inspection = closed for current technical skeleton`。

## 57. FND-FS-027

### 57.1 目标文件与结论

- `src/foundation/filesystem/durable-file-candidate.ts`

该模块创建调用方命名、可由领域恢复识别的非权威文件候选：parent capability→target absent→`O_CREAT|O_EXCL|O_NOFOLLOW`→exact write→handle chmod→byte readback→file fsync→parent/path复验→parent fsync→final readback。它不能替换为Atomic Write：这里的具名文件是待后续link/rename的candidate；Atomic Write的具名target已经是提交结果，其内部stage由另一地址协议拥有。

### 57.2 已实施修正

- 增加与Atomic Write一致的64 MiB Foundation硬上限；Options/Result/Reason无显式type consumer，收回模块内部；Error class与函数结构化签名保留；
- 在字节snapshot前响应预取消；拒绝Proxy、SharedArrayBuffer-backed Uint8Array和代理Signal；先检查可见长度，再执行Buffer copy；allocation与hash分别稳定映射capacity/hash-failure；
- readback每个chunk允许合法short read并循环补齐，不再把单次短读误判为candidate漂移；每轮响应AbortSignal；
- 逐字节JS比较改为Buffer subarray native equals；scratch allocation失败闭合为candidate-changed，零字节与growth probe复用同一至少1-byte scratch；
- handle.stat失败不再泄漏原生错误；所有正常路径的parent current/inspect/sync失败分别映射parent、candidate-changed或durability-failure；
- 失败清理在unlink前要求opened/path full snapshot与single link一致；unlink后重新fstat同一opened inode，要求linkCount精确1→0且mode/owner/bytes/mtime不漂移，再同步parent；
- 删除与result重复表达完成状态的 `completed` 布尔位。

### 57.3 验证

```text
DurableFileCandidate direct: 3 pass / 0 fail / 0 skip
DirectoryTreeCandidate + Demand File Event Store + Gitignore recovery: 17 pass / 0 fail / 0 skip
Combined focused: 20 pass / 0 fail / 0 skip / 1.360542208s
TypeScript typecheck: pass
Architecture: pass / 422 modules / 2586 dependencies
git diff --check: pass
```

没有为64 MiB边界分配65 MiB测试fixture；直接测试聚焦零mutation的pre-abort、SharedArrayBuffer/Proxy拒绝、parent映射与正常exact publish，重型cleanup/recovery由真实consumer套件覆盖。

## 58. FND-FS-028

### 58.1 目标文件与结论

- `src/foundation/filesystem/durable-directory-tree-candidate.ts`

该文件是窄facade，只组合Candidate Plan、candidate root/目录创建、具名File Candidate和最终Inspection；它不重复拥有路径闭包、字节验证、mkdir、文件I/O、发布rename、锁或残留归属。create只接受strict absent根；settle先证明已有树是同一计划的安全子集，再补齐缺失项。

### 58.2 已实施修正

- 删除prepare后同一同步turn内重复的AbortSignal检查；Plan preparation已经在复制/hash前完成该准入，各effect仍逐步响应取消；
- Plan directories是父目录完整闭包且按canonical text排序，父路径必先于子路径；目录创建从对每项调用multi-level `materializeDirectoryPath()` 改为逐项 `createDirectoryAtomically()`；
- 由此删除同一前缀被多次inspect/materialize的系统调用放大，每个计划目录只跨一次exclusive mkdir边界；
- directory error mapper增加target context：candidate根EEXIST仍为 `target-exists`，内部目录EEXIST为 `tree-conflict`，不会因优化而混淆调用方恢复判断；
- settle路径同样只创建Inspection判定缺失的exact目录，已有目录不改mode、不重新物化。

验证结果：

```text
DirectoryTreeCandidate + Loaded transfer candidate + Ledger store: 16 pass / 0 fail / 0 skip / 2.307035375s
TypeScript typecheck: pass
Architecture: pass / 422 modules / 2586 dependencies
git diff --check: pass
```

`Directory tree candidate materialization facade = closed for current technical skeleton`。下一依赖是tree publication唯一提交effect所使用的Durable Resource Rename。

## 59. FND-FS-029

### 59.1 目标文件与结论

- `src/foundation/filesystem/durable-resource-rename.ts`

该模块在同一RootedDirectory内移动一个expected exact file/directory：打开source exact handle和两侧parent→目标两次absent观察→source/parents current→单次rename提交→source absent＋destination/opened inode一致→同步一至两个parent→最终复验。regular-file内容耐久由写入者先建立；本层只拥有directory-entry move和parent durability。

Node未暴露 `renameat2(RENAME_NOREPLACE)`，因此晚到目标仍可能被普通rename替换；该限制继续明确要求调用方领域锁，不把precheck伪装成跨进程CAS。EXDEV只返回cross-device，不在本层偷偷copy/delete。

### 59.2 已实施修正

- source/destination品牌参数在任何相等、descendant或startsWith关系运算前重新调用PortableResourcePath parser；伪造非字符串不再可能泄漏原生异常；
- 所有后续parent/source打开、关系检查和成功receipt统一使用已准入路径；
- `DurableRenamedResourceKind/Result` 无显式type consumer，收回模块内部；Options与ErrorReason由直接测试使用，保留；
- close parent现在携带source/destination error path，source exact handle close也固定指向source，不再返回模糊 `$resourcePath`；
- 删除与成功result重复的 `committed` 布尔位；rename后任何复验/同步失败仍由primary error返回commit-uncertain或durability语义。

验证结果：

```text
DurableResourceRename direct + Tree Publication + TODO + Demand Publication: 25 pass / 0 fail / 0 skip / 10.094543292s
TypeScript typecheck: pass
Architecture: pass / 422 modules / 2586 dependencies
git diff --check: pass
```

`Durable same-root resource rename = closed for current technical skeleton`。

## 60. FND-FS-030

### 60.1 目标文件与结论

- `src/foundation/filesystem/durable-directory-tree-publication.ts`

该facade只执行：重新解析candidate/plan/rootNode→提交前按expected root稳定读取完整候选树→调用Durable Resource Rename唯一提交点→从最终路径按moved node重新读取完整树→返回plan/root identity。它不创建/补齐candidate、不获取锁、不解释intent、不跨设备fallback，也不清理失败残留。

### 60.2 已实施修正

- options与pre-abort移到大型candidate plan重建之前；已取消调用不会先消耗完整清单预算；
- 提交前inspection仍携带Signal，取消保持source candidate且不创建final；新增直接回归证明零提交；
- rename提交成功后，final inspection不再携带Signal；提交点之后取消不能把已经移动的树报告成普通 `aborted`；
- `mapCandidateError(afterCommit)`先判断提交阶段，任何最终回读失败统一映射 `commit-uncertain`；
- lower rename的post-commit parent current失败改为 `commit-uncertain`，pre-commit仍保留parent-changed；
- rename-failure和成功证明后的close-failure在publication层保守映射commit-uncertain，不再作为可安全重试的普通operation-failure；
- PublicationOptions没有显式type consumer，收回模块内部；真实被Loaded Artifact消费的PublicationResult保留。

验证结果：

```text
Rename + Tree Publication + Loaded Artifact Publication + Ledger Store: 21 pass / 0 fail / 0 skip / 2.441383667s
TypeScript typecheck: pass
Architecture: pass / 422 modules / 2586 dependencies
Schema check: pass / 34 schemas / 65 external ref edges
git diff --check: pass
```

## 61. Foundation Filesystem 内存字节目录树候选与发布链收束

```text
DirectoryTreeCandidatePlan
  → bounded immutable bytes / descriptors
  → derived directory closure + portable collision policy + tree digest
  → DirectoryTreeCandidateInspection (safe subset / exact complete)
  → DurableDirectoryTreeCandidate
      ├─ exact directory create
      └─ named durable file candidate
  → DurableResourceRename (locked cooperative commit point)
  → final exact tree readback
```

系统结论：

- 内容身份、业务容量政策、物理candidate和最终authority保持分离；Plan不保存或散列owner政策；
- Foundation v1 ceiling阻止持久计划授权无界I/O，Loaded Artifact与Ledger恢复各自重验更小预算；
- candidate创建/补齐可幂等恢复但不是事务，tree publication只有一次rename提交点；
- 目录和文件创建均使用exclusive边界、exact mode/bytes/inode与parent durability；
- 提交前可取消，提交后必须完成验证或返回commit-uncertain；
- late destination overwrite仍受Node无RENAME_NOREPLACE限制，必须由领域锁覆盖；没有伪CAS；
- direct tests维持Plan/Candidate 3、File Candidate 3、Rename 7、Tree Publication 3，复杂业务恢复只在系统节点抽样。

`Foundation in-memory manifested tree candidate and publication = closed for current technical skeleton`。下一邻域是Loaded Artifact使用的跨根streaming file copy candidate。

## 62. FND-FS-031

### 62.1 目标文件与结论

- `src/foundation/filesystem/durable-file-copy-candidate-contract.ts`
- `src/foundation/filesystem/durable-file-copy-candidate.ts`

该能力把source RootedDirectory内一个expected普通文件，以固定块流式复制到destination RootedDirectory的具名exclusive candidate。来源在复制前后绑定pathname/inode/full snapshot；复制时计算SHA-256并与byteCount/digest expectation比较；candidate采用0600初建、最终mode、全量二次hash、file fsync、parent fsync和最终path/handle一致性证明。

这里的 `maximumBytes` 是当前调用方提供的操作预算，不是从持久文件自报的资源授权；流式内存固定为512 KiB。Loaded Artifact owner已在manifest/Directory Plan层限制32 MiB/file，因此无需再把32 MiB固化为所有未来streaming copy的Foundation上限。

### 62.2 已实施修正

- 512 KiB chunk从公共contract移到I/O实现私有常量；无联合类型/生产consumer的Result `kind`删除，Result type不再从facade重导出；ParsedOptions收回contract内部；
- pre-abort在路径和expectation解析前执行；容量仍在任何source I/O前比较expectation与caller maximum；
- scratch allocation与Sha256Hasher initialization分别映射capacity、source-read-failure或candidate-changed；source/candidate growth probe复用既有至少1-byte scratch；
- 新增handle snapshot wrapper，所有source/candidate/cleanup `FileHandle.stat` 原生失败闭合为稳定错误；
- destination parent current/inspect/sync统一封装，正常路径不再泄漏RootedResourceParentHandleError；
- candidate cleanup在unlink前要求opened/path full snapshot、file kind和single link；unlink后重新fstat同一opened inode，要求linkCount精确1→0且mode/owner/bytes/mtime不漂移，再同步parent；
- 删除与result重复的 `completed` 状态；close错误仍只在没有更早primary error时生效；
- 原有short-read循环、source mutation检测、candidate二次hash、optional exact source node和跨根不同inode语义保留。

验证结果：

```text
DurableFileCopyCandidate direct + Loaded transfer candidate: 17 pass / 0 fail / 0 skip / 732.542042ms
TypeScript typecheck: pass
Architecture: pass / 422 modules / 2586 dependencies
git diff --check: pass
```

`Foundation caller-bounded streaming file copy candidate = closed for current technical skeleton`。

## 63. FND-FS-032

### 63.1 目标文件与结论

- `src/foundation/filesystem/durable-regular-file-link.ts`

该模块是Demand File Event Store固定commit槽位的no-replace提交原语：expected exact source→目标两次absent→单次hard link→source/destination/opened inode组成精确链接对→source inode sync→destination parent sync→最终复验。成功有意保留两个路径名，后续candidate unlink由领域恢复编排。

### 63.2 已实施修正

- source/destination品牌参数在相等判断和任何I/O前重新解析；伪造非字符串稳定返回input；
- post-link parent current失败映射commit-uncertain，pre-link仍保留parent-changed；
- source/destination parent与source exact handle close错误返回精确结构路径，不再使用模糊 `$resourcePath`；
- 删除与成功result重复的 `committed` 布尔位；
- Result type无显式consumer，收回模块内部；`previousLinkCount/linkedPairLinkCount`无生产consumer且可由expected/final node推导，从receipt删除；source/destination final node保留；
- no-replace EEXIST、EXDEV、link后2-path exact pair、inode/parent durability和“不自动删除目标”语义不变。

验证结果：

```text
DurableRegularFileLink direct + Demand File Event Store: 15 pass / 0 fail / 0 skip / 940.11925ms
TypeScript typecheck: pass
Architecture: pass / 422 modules / 2586 dependencies
git diff --check: pass
```

## 64. Foundation Filesystem 系统核实点

现存33个手写模块均至少有1个生产importer；不存在零consumer Foundation Filesystem模块。内部contract/I/O文件由唯一facade直接覆盖，不为每个私有文件复制测试。

能力矩阵：

```text
Portable path / node snapshot
  → handle-backed root / parent / exact resource
  → stable file / directory / bounded tree observation
  → strict text / deterministic JSON / whole-file transition
  → exact byte range for Managed Text
  → durable directory materialization
  → durable atomic single-file create/replace + stage recovery
  → local exclusive lock + explicit residue recovery
  → exact unlink / linked-target durability settlement
  → named file candidate / streaming cross-root copy candidate
  → manifested directory-tree plan / inspect / create / settle
  → hard-link no-replace or same-root rename commit
  → whole-tree final publication
```

系统结论：

- I/O原语只拥有词法、物理节点、容量、exact effect、durability和稳定错误；Config、Ledger、Demand、Artifact、TODO等owner决定资源意义和恢复意图；
- 所有写路径均通过RootedDirectory/ParentHandle/ExactHandle，不存在FileManager、workspace registry、第三方FS adapter或直接recursive业务写捷径；
- create、replace、link、rename、unlink分别保留不同OS提交语义，没有generic mutation mode掩盖差异；
- Node缺失openat/linkat/renameat2 CAS的限制显式保留，可靠本地文件系统与领域锁是当前承诺边界；
- 内存整文件硬上限、持久Plan hard ceiling、caller streaming budget和owner更小容量相互分层；
- 提交前取消，提交后settle/verify或commit-uncertain已经在Atomic Write、Rename和Tree Publication统一；
- 失败清理只删除能够通过path/opened inode、kind、single-link和unlink后link-count证明归属的candidate；未知/active residue不自动删除；
- 范围读取零consumer模块、base64url等早期占位已经删除；测试helper只位于tests；
- 28个Foundation Filesystem测试文件共172项全部通过，未运行旧JS或无关业务全量套件。

`Foundation Filesystem = closed and ready for upper Foundation Artifact/Git review`。

## 65. FND-ART-001

### 65.1 目标文件与既有决定

- `src/foundation/artifact/loaded-artifact-tree-identity.ts`

Loaded Artifact Tree是旧Evidence import、Archive和Preservation真实场景需要的位置无关文件制品身份。2026-08-27用户已确认保留INF-4 Manifested Tree Transfer Foundation，等待真实Evidence event/state consumer后再接业务；因此当前transfer顶层零consumer是明确defer，不是可直接删除的推测占位，也不得伪造Workspace Static Artifact owner。

v1 identity有意定义为非空regular-file集合：manifest只保存portable ref、bytes、digest与executable bit。空目录消耗物理scan entry预算，但不进入artifact digest，也不会由transfer重建；这与当前Schema、golden和文件制品语义一致，不升级v2。

### 65.2 已实施修正

- manifest parser从全部file refs派生唯一parent directory集合，`maxEntries`现在约束files＋derived directories，不再只在物理scan入口生效；
- directory/file共享lowercase resource key，拒绝 `A/x` 与 `a/y` 的目录级collision、file大小写collision以及file-as-parent (`a` 与 `a/child`)；
- derived resource数量在构建时即时执行owner maxEntries，避免先形成超量拓扑；
- path depth改为无split计数；父目录派生仍限制在64层硬上限内；
- 物理identity注释明确空目录不进入v1内容身份；golden relocation测试新增空目录并证明digest不变；
- ManifestValidator新增directory collision、file-parent与derived-entry limit回归；
- IdentityOptions/ManifestValidationOptions无显式type consumer，收回模块内部；常量字段列表已经canonical排序，`assertExactFields`不再为最多4096个文件重复复制并排序expected数组。

验证结果：

```text
Loaded Artifact Identity + Transfer Plan/Candidate/Publication: 22 pass / 0 fail / 0 skip / 839.041916ms
TypeScript typecheck: pass
Architecture: pass / 422 modules / 2586 dependencies
git diff --check: pass
```

## 66. FND-ART-002

### 66.1 目标文件与结论

- `src/foundation/artifact/loaded-artifact-tree-transfer-plan.ts`

该模块是纯转换：严格Manifest＋candidate root＋调用方目标mode政策→DirectoryTreeCandidatePlan＋逐文件source/candidate映射＋artifact/plan digest。它不打开根、不信任来源仍稳定、不创建/复制/发布文件，也不决定Evidence、Archive或Preservation归属。

### 66.2 已实施修正

- Directory Tree Candidate至少含一个文件且后续必须通过pathname创建/回读，因此generic plan新增可执行性准入：directoryMode必须含owner rwx，file mode必须含owner read；非法persisted plan同样拒绝；
- Schema comment同步说明mode capability由runtime关系校验，不增加字段或改变tree digest；
- Artifact目标mode进一步要求：directory含owner rwx；regular file含owner read且无任何execute bit；executable file含owner read＋owner execute；
- transfer plan parser对persisted directory plan执行相同executable关系，不再接受仅group/other executable但owner不可执行的伪造mode；
- PlanOptions和TransferCopy无显式type consumer，收回模块内部；公开TransferPlan及稳定Error/Reason保留；
- copies继续显式绑定source ref与candidate-root/ref；虽然当前1:1可派生，但它是未来恢复意图审查的明确effect mapping，不扩展transform能力。

验证结果：

```text
DirectoryTreeCandidate + Loaded Transfer Plan/Candidate: 14 pass / 0 fail / 0 skip / 888.035875ms
Schema build/check: pass / digest sha256:dbd54fcbac64f669e06856397efb08f92bda5770dc036bf808bb1120cf79f3ea
TypeScript typecheck: pass
Architecture: pass / 422 modules / 2586 dependencies
git diff --check: pass
```

## 67. FND-ART-003

### 67.1 目标文件与结论

- `src/foundation/artifact/loaded-artifact-tree-transfer-candidate.ts`

该facade执行：重新观察source artifact digest→创建或接纳candidate root→证明已有candidate是plan安全子集→补目录→逐missing file执行caller-bounded streaming copy→验证完整candidate→再次观察source identity。它不发布final、不删除source/candidate、不决定Evidence真实性或业务接受。

### 67.2 已实施修正

- options与pre-abort提前到大型transfer plan重建之前；已取消请求不先解析最多4096文件的清单；
- progress返回的missing directories来自canonical完整闭包，父目录先于子目录；逐目录effect由multi-level `materializeDirectoryPath` 改为exact `createDirectoryAtomically`，删除重复前缀扫描；
- 每轮目录/文件仍响应Signal；目录创建后的第二次progress保留，用于在复制前复验并发冲突；
- CandidateOptions/Result无显式生产type consumer，收回模块内部；无联合consumer的Result `kind` 删除；plan/sourceIdentity/candidate/copiedFiles保留；
- complete retry仍返回空copiedFiles，partial exact文件不替换，source复制前后整树digest不匹配仍保留candidate residue并报告source-changed。

验证结果：

```text
Loaded Transfer Candidate + Publication: 10 pass / 0 fail / 0 skip / 950.968916ms
TypeScript typecheck: pass
Architecture: pass / 422 modules / 2586 dependencies
git diff --check: pass
```

## 68. FND-ART-004

### 68.1 目标文件与结论

- `src/foundation/artifact/loaded-artifact-tree-transfer-publication.ts`

该facade在final存在时要求candidate absent并验证current exact tree；final缺失时验证complete candidate后调用generic Tree Publication唯一rename提交点。它不获取锁、不清理residue、不跨设备fallback，也不解释Evidence/Archive状态。

### 68.2 已实施修正

- options/pre-abort提前到Transfer Plan重建前；
- 删除generic Tree Publication之后重复的Directory Plan扫描和再次打开final root计算Artifact identity；generic下层已经在rename后完成exact tree readback；
- Transfer Plan parser严格证明manifest与directoryPlan的ref/bytes/digest/executable关系，因此Artifact identity安全派生为plan artifactDigest＋manifest，不降低物理证明；
- published result的finalTree由下层publication destination/rootNode和同tree digest计划构造；关系不一致稳定返回commit-uncertain；
- current路径仍执行一次exact tree scan，随后使用同一已验证plan派生identity；
- 提交后不再执行携带Signal的第三次全树读取，消除“已发布却因迟到取消返回aborted/uncertain”的额外窗口；
- PublicationOptions/Result无显式type consumer，收回模块内部；无联合consumer的Result `kind` 删除；disposition/publication/finalTree/artifactIdentity保留。

验证结果：

```text
Loaded Artifact Identity + Transfer Plan/Candidate/Publication: 22 pass / 0 fail / 0 skip / 875.023917ms
TypeScript typecheck: pass
Architecture: pass / 422 modules / 2586 dependencies
Schema check: pass / 34 schemas / 65 external ref edges
git diff --check: pass
```

## 69. Foundation Artifact 系统核实点

```text
StableRootResourceTree
  → file-set Manifest / Artifact digest
  → Transfer Plan (manifest relation + copy mapping + directory plan)
  → source-stable streaming copy / partial candidate resume
  → generic whole-tree rename publication
  → current or published exact result
```

- v1明确忽略空目录，只迁移非空regular-file集合；symlink/special node拒绝；
- hard limits、derived entries、path bytes/depth、case collision、file-parent、bytes/digest/executable全部闭合；
- source和candidate/final分别通过独立RootedDirectory观察，不把manifest digest冒充source仍稳定；
- transfer子图当前没有Evidence领域consumer，但用户已明确决定保留INF-4 Foundation；不得因此伪造Workspace owner或提前实现Evidence event/state；
- 4个Artifact直接测试文件共22项通过，没有新增Schema、Manager、锁或恢复状态机。

`Foundation Loaded Artifact Tree transfer = closed and deferred for confirmed Evidence/Archive/Preservation consumers`。

## 70. FND-GIT-001

### 70.1 目标文件与标准结论

- `src/foundation/git/git-ignore-observation.ts`
- `src/foundation/git/git-ignore-candidate-observation.ts`

第一层只执行固定 `git check-ignore --no-index --verbose --non-matching --stdin -z`，第二层把候选 `.gitignore` 写入操作私有临时worktree并复用第一层。Git官方协议确认NUL模式每项返回source/line/pattern/path四字段，non-matching只保留path，exit 0/1对应至少一项ignored/全部未ignored；当前parser和exit交叉检查正确。

环境删除继承的全部 `GIT_*` 后显式设置GIT_CONFIG_NOSYSTEM、空global/system config、GIT_OPTIONAL_LOCKS=0和GIT_TERMINAL_PROMPT=0；repository `.git/info/exclude`仍作为可观察事实返回source，但业务层只把source `.gitignore` 解释为managed rule命中。

### 70.2 已实施修正

- Git runner limits收回模块内部，新增最多2048 stdout chunks；1 MiB字节预算不再允许极多小chunk制造对象开销；
- stdout chunk直接保留Node Buffer，不再逐chunk复制；最终Buffer.concat allocation失败稳定映射output-limit；bounded stdin allocation失败映射query-failure；
- options/pre-abort在probe array解析前执行；
- GitIgnoreObservation/PatternDecision无显式type consumer，收回模块内部；无联合consumer的Observation `kind` 删除；paths/decision source facts不变；
- candidate 2 MiB上限收回模块内部，测试使用本地边界常量；pre-abort在bytes snapshot前执行；
- candidate bytes先检查visible length，再Buffer copy；拒绝Proxy/SAB，allocation与SHA失败分别稳定映射capacity/hash-failure；
- 临时worktree在close/rm前通过RootedDirectory.assertCurrent复验；若pathname不再指向本次创建inode，保留现场并返回cleanup-failure，不递归删除未知replacement；
- CandidateObservation `kind` 删除，byteCount/digest/paths保留；真实Workspace Gitignore owner不需要改动。

验证结果：

```text
Git Ignore Observation + Candidate + real Gitignore recovery: 25 pass / 0 fail / 0 skip / 1.311710625s
TypeScript typecheck: pass
Architecture: pass / 422 modules / 2586 dependencies
git diff --check: pass
```

未抽取任意argv GitClient；只有出现第二个真实且语义相同的Git进程协议consumer后才比较共享runner。`Foundation Git ignore observation = closed for current technical skeleton`。

## 71. FND-RES-001

### 71.1 目标文件与结论

- `src/foundation/resource/resource-processing-contract.ts`

该文件正是用户此前要求的清晰中间环节：具体owner Catalog为资源声明一个role、闭合allowed recipe集合与recovery；一次operation只能选择其中一个recipe。Workspace Matrix组合并拒绝越界，但不替owner选择或执行effect。用户已明确删除Owner–Resource Capability Binding，因此这里不能再增加router/registry/manager。

审阅确认保留显式discriminated union优于压缩为通用字符串表：Config、TODO、Demand、Ledger、Active、Window、Managed Integration和Host Catalog可在TypeScript编译期拒绝非法role/recipe/recovery组合。运行时parser再对持久/边界数据执行被动严格准入。代码长度主要来自有价值的静态关联，而不是重复I/O或状态机。

`external-reference/no-write` 与 `manifested-tree/tree-publish-or-move` 虽尚无concrete catalog declaration，但都来自已确认资源标准；后者对应用户明确保留的INF-4，前者为外部owner零写入分类。它们不执行effect、不创建路径，不按零consumer删除。

本单元未修改代码：

- role、recipe、recovery、directory container两分支和single-operation admission职责清晰；
- mutable snapshot允许create＋replace闭合集合，transaction artifact允许有序非空子集，符合真实多操作资源；
- directory materialization与exact directory publication不伪装成resource role，不取得descendant authority；
- 没有filesystem、path、owner、host或Config依赖，也没有万能 `execute(plan)` dispatcher。

验证结果：

```text
Resource Contract + Config/Demand/TODO/Managed Integration/Host Catalogs: 14 pass / 0 fail / 0 skip / 261.630959ms
TypeScript typecheck: pass
Architecture: pass / 422 modules / 2586 dependencies
git diff --check: pass
```

`Foundation Resource Processing Contract = accepted and closed`。

## 72. FND-ES-001

### 72.1 目标文件与标准结论

- `src/foundation/event-sourcing/event-sourcing-version-evolution.ts`

Registry为一个事件家族登记每版codec和连续 `vN→vN+1` upcast；读取时先以source codec准入，再逐步转换并由每个target codec复验，最终只返回current JsonValue。Microsoft Event Sourcing guidance与Axon官方文档都采用read-time chained upcaster并保持stored event不可变；Axon也明确upcaster只调整payload/metadata representation，不改aggregate/message identity。当前Foundation边界符合。

### 72.2 已实施修正

- `snapshotJson` 接受codec/upcast阶段分类；upcast返回undefined、function、Proxy或其他非JsonValue现在稳定返回upcast，不再误报codec；
- codec function调用与其返回值Json snapshot拆开；codec即使主动抛 `EventSourcingVersionEvolutionError` 也不能伪造reason/path，统一映射codec；
- 每级upcast输出先按 `$/steps/N` 形成冻结JsonValue，再交给 `$/codecs/N+1`；target codec exception与非法输出都归codec；
- 运行时missing-step/missing-codec路径统一为JSON Pointer风格 `$/steps/N`、`$/codecs/N`，修复原 `$steps`/`$codecs` 不一致；
- current version直接codec parse、unsupported version、definition连续性、最大256 codecs/255 steps和deep-frozen data保持不变；
- 新增一个聚焦case同时证明invalid upcast JSON与spoofing codec的稳定分类，不扩张未来v2业务fixture。

验证结果：

```text
Foundation Version Evolution + Demand Upcaster/Version/Repository: 6 pass / 0 fail / 0 skip / 576.150041ms
TypeScript typecheck: pass
Architecture: pass / 422 modules / 2586 dependencies
Schema check: pass / 34 schemas / 65 external ref edges
git diff --check: pass
```

`Foundation Event Sourcing version evolution = closed`。

## 73. Foundation 总核实点

已逐文件覆盖当前 `src/foundation/` 全部手写模块：Data、Text、Crypto、Identity、Time、Numeric、Node、Schema、Filesystem、Artifact、Git、Resource Processing与Event Sourcing Version Evolution。

最终分层：

```text
Passive Data / JsonValue
  → Canonical JSON / UTF-8 / SHA-256
  → Typed Identity / UTC / Monotonic / ByteCount / Schema
  → Portable Path / Physical Node / Handle-backed Root
  → Stable bounded observation
  → Durable exact single-resource effects / locks / recovery
  → Manifested tree candidate / copy / publication
  → Git fixed-protocol semantic observation
  → Resource role/recipe/recovery admission
  → read-time Event Sourcing version evolution
```

架构结论：

- Foundation没有Workspace、Config、Demand、TODO、Ledger、Host或MCP状态authority；只接受调用方明确提供的root、expected node、capacity、mode、plan或codec；
- 没有FileManager、Storage backend、GitClient、全局registry、可执行任意operation的dispatcher或第二事务状态机；
- 所有可持久内容采用严格被动准入、确定性表示或明确版本；所有物理effect区分OS提交语义、durability、commit uncertainty与owner recovery；
- class只用于有真实生命周期状态的Rooted handles、exclusive lock和Version Registry；纯计划、解析、比较、快照与effect组合使用函数/冻结数据；
- mature依赖保留在其真正优势处（Canonical JSON/Ajv/MCP后续）；Node原生文件能力由Wakeflow特定root/CAS/recovery合同组合，没有为了“有依赖”而牺牲语义；
- 旧JS只用于确认Evidence、Archive、Gitignore、Event Sourcing等真实场景；新TS不继承其同步I/O、手写MCP、全局manager或多形态写入；
- Foundation Artifact transfer顶层consumer按用户决定明确defer到Evidence/Archive/Preservation，不伪装为已实现业务。

验证结果：

```text
Foundation focused test files: 54
Foundation tests: 334 pass / 0 fail / 0 skip / 2.85377475s
TypeScript typecheck: pass
Architecture: pass / 422 modules / 2586 dependencies
Schema check: pass / 34 schemas / 65 external ref edges
git diff --check: pass
```

`TypeScript Foundation = reviewed, coherent, and closed for the current technical skeleton`。下一系统进入Configuration；后续若真实consumer证明缺少能力，再以垂直切片扩展Foundation，不预建万能服务。

## 74. CFG-001

### 74.1 目标文件与结论

- `src/configuration/wakeflow-config-v3.ts`
- `src/configuration/wakeflow-config-v3-document.ts`

Config v3模型先把任意输入snapshot为递归冻结JsonValue，再由生成Schema/Ajv闭合字段、值域、基数和词法；手写模型只补typed ID全局UUID collision、引用、Design/Test capability、每Repository至少一个Product window与residue关系。Document模块显式重建唯一领域字段顺序并渲染deterministic pretty JSON；两者不读取文件、物理root或当前配置。

### 74.2 已实施修正

- 独立 `parseWakeflowConfigPlacement()` 补齐Schema placement的反斜杠与Windows drive prefix拒绝；直接调用不再接受 `C:\\...` 或 `Design\\nested`；
- typed ID collision只需membership，`Map<uuid,path>`改为Set，不保留无消费路径值；
- Config indexes从windowById map＋product filter＋每repository filter＋controller/design/test三次find，收敛为一次windows遍历；
- 一次遍历同时构建window entries、role singleton、product list和repository分组，复杂度由O(R×W)降为O(R+W)；Schema没有repository/windows maxItems，因此不依赖“小配置”掩盖算法；
- 新增双Repository/三Product window分组测试；所有数组/records仍冻结，index不成为第二authority；
- Document field order、optional representation、presentation显式语言和Config semantic digest不变。

验证结果：

```text
Config v3 model + deterministic document: 9 pass / 0 fail / 0 skip / 183.560333ms
TypeScript typecheck: pass
Architecture: pass / 422 modules / 2586 dependencies
git diff --check: pass
```

## 75. CFG-002

### 75.1 目标文件与consumer驱动回补

- `src/configuration/wakeflow-config-root-placement.ts`
- 回补：`src/foundation/filesystem/absolute-directory-placement.ts`
- 简化：`src/foundation/filesystem/absolute-directory-materialization.ts`

Root Placement把fixed Active/Local与Config Ledger/Support/Repository placement编译为绝对路径，拒绝根之间same/containment、symlink/type/alias和已有真实路径重叠，但不创建目录或授予写权限。

审阅发现missing target在Foundation首次ENOENT即返回，未固定最近existing ancestor；case-insensitive filesystem上的非规范ancestor可能通过Config snapshot，却在materialization才失败。该需求属于通用物理观察，回补Foundation而非在Config复制向上扫描。

### 75.2 已实施修正

- AbsoluteDirectoryPlacement missing observation新增私有结构类型的 `nearestExistingAncestor`：absolute/real path、canonical spelling和handle-backed node；文件系统根不冒充安全写根；
- 最近祖先在首次missing前由同一次逐段scan确定，再复用RootedDirectory句柄稳定复验；present仍返回target稳定事实且ancestor为null；
- AbsoluteDirectoryMaterialization删除独立向上lstat搜索和Node error依赖，直接消费该事实；root-only ancestor返回scope，noncanonical ancestor返回alias；
- Config Root Placement对每个missing root要求非null、canonical最近祖先，因此快照在任何创建前即与后续物化准入一致；
- lexical和physical overlap从O(roots²)两两relative比较改为NFC/lowercase path index＋逐祖先查找，复杂度与root数量及路径深度成正比；
- portable case-fold使 `Design` 与 `design/child` 即使在Linux也被拒绝，避免配置迁移到case-insensitive host后碰撞；
- 新增2项Root Placement直接测试；macOS `/var`→`/private/var` 测试期望使用RootedDirectory canonical path。

验证结果：

```text
Placement + Materialization + Config Model/Root/Snapshot: 20 pass / 0 fail / 0 skip / 235.094292ms
TypeScript typecheck: pass
Architecture: pass / 423 modules / 2589 dependencies
git diff --check: pass
```

## 76. CFG-003

### 76.1 目标文件与结论

- `src/configuration/wakeflow-config-authority-snapshot.ts`

Snapshot是已有 `wakeflow.config.json` 的唯一正常运行准入：StableFile source bytes/node/digest＋strict UTF-8/deterministic JSON＋Config model/digest/indexes＋Root Placements/ledger absolute root。它是一次操作快照，不缓存current workspace，也不承诺返回后连续不变；writer仍须在锁/CAS内重读。

### 76.2 已实施修正

- 技术核实门已确认Config为tracked/shareable exact 0644；Snapshot source policy由“single link＋non-executable”收紧为current user（平台有geteuid时）＋single link＋exact 0644；
- 原有0600 direct fixture改为0644，并新增0600负例；0666/0700等同样不再通过；
- `WAKEFLOW_CONFIG_AUTHORITY_FILE_MODE`移到Snapshot作为读写共用authority常量；Publication继续兼容重导出，Replacement/Recovery importer无需改路径；
- Replacement Contract保留Snapshot `source-policy`分类，不再把新前置gate压成generic `source-invalid`；
- public read入口新增RootedDirectory runtime准入，并在任何文件读取前响应pre-abort；
- SnapshotSource/Options无显式type consumer，收回模块内部；纯内存Snapshot不持久化且没有联合consumer，删除零消费kind/schemaVersion及两个常量；
- source/config digest、deterministic representation、placement、indexes和ledger root输出不变。

验证结果：

```text
Config Snapshot + Publication + Replacement/Recovery: 16 pass / 0 fail / 0 skip / 1.08475275s
TypeScript typecheck: pass
Architecture: pass / 423 modules / 2589 dependencies
git diff --check: pass
```

## 77. CFG-004

### 77.1 目标文件与结论

- `src/configuration/wakeflow-config-authority-publication.ts`

该owner只执行fresh absent Config：strict model→deterministic bytes/1 MiB→current-user workspace root＋root placements→Foundation atomic create 0644→Snapshot exact readback。它不生成ID、不创建其他目录、不持锁、不替换现存Config，也不拥有Maintenance顺序。

### 77.2 已实施修正

- Atomic create跨过提交点后，Snapshot readback不再携带调用方Signal；迟到取消不能跳过本可完成的物理/领域证明；
- 提交前所有model/render/capacity/root/placement检查仍响应取消且零effect；Atomic create内部同样只在commit前响应；
- PublicationOptions/Receipt无显式type consumer，收回模块内部；
- 仅限create的receipt恒定 `disposition: published` 无生产consumer，删除；真实publication physical receipt和authority Snapshot保留；
- Config file mode继续从Snapshot单一常量导入，并从Publication兼容重导出给Replacement/Recovery。

验证结果：

```text
Config Publication + Maintenance Step/Transaction: 16 pass / 0 fail / 0 skip / 55.300993542s
TypeScript typecheck: pass
Architecture: pass / 423 modules / 2589 dependencies
git diff --check: pass
```

Maintenance transaction是本系统唯一一次重型真实consumer核验，后续Config文件单元不重复运行该55秒套件。

## 78. CFG-005

### 78.1 目标文件与结论

- `src/configuration/wakeflow-config-authority-replacement-contract.ts`
- `src/configuration/wakeflow-config-authority-replacement.ts`

Contract由正常replace与recovery共享typed expected projection、desired deterministic bytes/digests、P1 source/root policy、placement、options、lock映射和readback；Effect只在Config短锁内执行current读取、idempotent desired判断、expected CAS、program identity gate、atomic replace和exact readback。

### 78.2 已实施修正

- `readCurrentWakeflowConfigAuthority(..., afterCommit=true)`不再向Snapshot传Signal；atomic replace成功后必须完成readback，迟到取消不制造额外commit uncertainty；
- Snapshot source-policy错误在precommit读取中保持为Replacement `source-policy`，不再压成source-invalid；
- file mode authority由三个replacement文件直接从Snapshot导入；Publication不再作为同层常量broker，删除兼容重导出；Catalog测试同步读取真实owner；
- ParsedRecoveryOptions无显式consumer，收回contract内部；
- option record的两条同结果catch分支合并，不改变passive input错误；
- expected projection仍只读取configDigest、programId、workspaceRoot与StableFileSource，不信任调用方完整Snapshot对象；
- lock内placement/root二次检查、current desired幂等、programId不可变、exact previous source和lock-release commit marker保留。

验证结果：

```text
Config Replacement/Recovery + Resource Catalog: 8 pass / 0 fail / 0 skip / 994.894917ms
TypeScript typecheck: pass
Architecture: pass / 423 modules / 2585 dependencies
git diff --check: pass
```

## 79. CFG-006

### 79.1 目标文件与保留理由

- `src/configuration/wakeflow-config-authority-replacement-recovery.ts`

当前没有顶层production importer，但INF-1已确认显式recovery能力：普通Rooted lock有意不按mtime或owner inactivity自动夺锁；Config恢复必须同时证明inactive lock、current为expected或desired、同program、desired placements，以及Workspace根内所有Foundation atomic stages只属于同一Config replace或该lock create，随后才退休锁并重入normal replace。它不是第二writer或自动cleanup。

### 79.2 已实施修正

- Recovery不再返回 `{ disposition: recovered, replacement }` 的无consumer第二结果外壳；直接返回normal `WakeflowConfigAuthorityReplacementReceipt`，调用方只解释current/replaced；
- 删除RecoveryReceipt类型与facade type reexports；RecoveryOptions仍作为函数结构化参数，不从facade额外导出；
- stage address parse的两条同结果catch分支合并；malformed/foreign/active/unknown stage仍全部保留并返回recovery-required；
- mode常量直接来自Snapshot；inactive lock retirement后若Signal取消，normal retry安全保留target-scoped stages并可再次恢复；
- 无residue、active owner、different desired stage和forward recovery测试保持。

验证结果：

```text
Config Replacement + explicit Recovery: 7 pass / 0 fail / 0 skip / 985.255833ms
TypeScript typecheck: pass
Architecture: pass / 423 modules / 2585 dependencies
git diff --check: pass
```

该能力继续标记为“confirmed Foundation/owner recovery seam, top-level wiring deferred”，不能声称Maintenance已经自动消费。

## 80. CFG-007

### 80.1 目标文件与结论

- `src/configuration/wakeflow-fresh-config-selection.ts`
- `src/configuration/wakeflow-config-resource-catalog.ts`

Fresh Selection把request-local selectionKey编译为一次性typed Program/Repository/Surface/Window IDs、strict Config和可审查allocation；显示文本/路径不参与身份，缺失语言显式写`en`。Catalog只登记tracked Config authority与private short lock；atomic stages保持operation-scoped，不进入全局声明。

### 80.2 已实施修正

- selectionValue先整体通过JsonValue递归snapshot/deep-freeze，再解析字段；UUID factory无法在分配过程中改变后续Config或selectionDigest输入；
- repositories/supportSurfaces/windows各只执行一次dense-array snapshot，normalized selection复用同一事实，不再在UUID调用后重读原请求；
- 三数组除各自256边界外，新增合计最多256 entities；array length和合计超限稳定映射capacity；
- 全部entity shape、selectionKey唯一性、root kind/reference syntax和引用存在性在programId分配前完成；无效/超量请求对uuidFactory调用次数为0；
- allocation仍按输入实体顺序消费UUID，输出按selectionKey排序；全kind UUID collision保持；
- Compilation是内存结果且没有联合consumer，删除无消费kind/schemaVersion；selection/config digest与allocations保留；
- selection key/maximum常量、未使用Selection/Options/Allocation接口收回模块内部；公开Compilation由Maintenance Coordinator真实消费；
- Resource Catalog经审阅保持两项，不修改：Config mutable-snapshot(create+replace)与transaction lock(create+retire)。

验证结果：

```text
Fresh Selection + Config Model + Resource Catalog: 12 pass / 0 fail / 0 skip / 170.901125ms
TypeScript typecheck: pass
Architecture: pass / 423 modules / 2586 dependencies
git diff --check: pass
```

## 81. Configuration 系统核实点

```text
Fresh request-local selection
  → one-time typed ID allocation
  → strict Config v3 model / semantic digest
  → deterministic tracked 0644 document
  → root placement physical admission
  → Config Authority Snapshot
  → absent atomic publication
  → lock + expected-source atomic replacement
  → explicit dead-owner residue recovery
  → two-entry Resource Catalog
```

系统结论：

- Config只保存durable desired intent、presentation、topology、storage/governance/host policy；不保存runtime handle、physical observation、migration history或current state；
- 固定Active/Local root不进入Config可改字段；Ledger/Support/Repository placements经过portable词法、case-fold topology、stable ancestor和physical alias/overlap检查；
- `wakeflow.config.json`唯一表示是tracked/shareable current-user single-link 0644 deterministic JSON，1 MiB；source bytes digest与semantic config digest分离；
- Fresh只在完整selection准入后分配ID，不按标题/path派生，不保存selectionKey；
- Publication只create，Replacement只在Config短锁内expected-source replace，Recovery只处理可完整证明的inactive residue；
- Program ID在replace中不可改变；Repository/Surface/Window stable IDs与引用全局闭合；
- Resource Catalog只登记Config authority与lock，不登记atomic stage或动态全局pattern；
- 没有ConfigManager、current-workspace cache、compat writer、双格式、隐式默认注入或Owner–Capability Binding。

验证结果：

```text
Configuration focused test files: 8
Configuration tests: 32 pass / 0 fail / 0 skip / 1.362107417s
TypeScript typecheck: pass
Architecture: pass / 423 modules / 2586 dependencies
Schema check: pass / 34 schemas / 65 external ref edges
git diff --check: pass
```

`Configuration = reviewed and closed for current technical skeleton`。

## 82. WS-DECL-001

### 82.1 目标文件与结论

- `src/workspace/workspace-resource-declaration.ts`

该合同把Foundation processing role/allowed recipes/recovery与Workspace family、owner、scope、logical root placement、tracking/privacy和node policy组成一个冻结声明。它不解析绝对路径、不读文件、不选择host、不执行recipe；representation与动态owner factory留在领域Catalog。

本单元结论为accept，不修改代码：

- 12个family与workspace/ledger/support/repository逻辑根有唯一兼容规则；
- workspace root自身不能用null relative path，其他named root可声明root本身但只能是directory node；
- tracked/shareable与ignored/runtime-private模式、single-link、executable profile和owner-defined策略按已确认资源标准闭合；
- manifested-tree要求tree node，ordinary authority/projection要求file，transaction artifact可按真实形态使用file/directory/tree；
- directory-container只允许directory node且不取得descendant authority；
- declaration/owner IDs使用稳定、NFC、无行为词法；typed surface/repository root IDs严格重验；
- parser只组合纯数据，不含Owner–Capability Binding、operation router、filesystem manager或host branch。

验证结果：

```text
Workspace Declaration + Config/Demand/TODO/Host Catalogs: 11 pass / 0 fail / 0 skip / 256.668417ms
TypeScript typecheck: pass
Architecture: pass / 423 modules / 2586 dependencies
git diff --check: pass
```

## 83. WS-CAT-001

### 83.1 目标文件与结论

- `src/workspace/workspace-host-resource-profile.ts`
- `src/workspace/workspace-host-resource-catalog.ts`

Host Resource Profile只保存会改变静态矩阵形状的hostId、runtime/instruction单段名称和八项surface；不保存adapter、handle、launch preference、就绪状态或effect。Codex/Claude各自提供一个严格值。共享Catalog按surface数据组合声明，不通过hostId分支推断能力。

本单元结论为accept，不修改代码：

- runtimeDirectoryName必须与hostId一致；instruction/statusline是单段Portable component；settings portable/local path不同；statusline要求settings surface；
- baseline只声明host root/identity/projections、instruction、instruction lock和window-runtime projections root；
- window identity、Pod evidence、keep-live、locator、settings、statusline、activity与temp均由surface显式开关，零空动态Binding/lease/evidence/locator记录；
- Codex 13项、Claude 21项来自同一组合器；Claude额外8项完全由Profile事实产生；
- `.mjs` statusline是Node读取的0600 derived projection，不误设OS executable；
- path helper重复重验小型Profile是边界安全成本，不引入“trusted profile”旁路或host branch缓存。

验证结果：

```text
Host Profile/Catalog + Codex/Claude exact profiles: 7 pass / 0 fail / 0 skip / 74.311083ms
TypeScript typecheck: pass
Architecture: pass / 423 modules / 2586 dependencies
git diff --check: pass
```

## 84. WS-MATRIX-001

### 84.1 目标文件与结论

- `src/workspace/wakeflow-workspace-static-resource-matrix.ts`
- `src/workspace/wakeflow-workspace-static-resource-operation-context.ts`

Matrix显式组合八个shared owner Catalog与当前Host Catalog，重新准入、全局排序、计算shared/matrix digest并提供窄查询。Operation Context只把调用方已选declaration和唯一allowed recipe绑定到expected matrix digest；不选择recipe、不携带root handle/source bytes/lock或effect。

Matrix parser只证明传递快照内部闭合；真实owner request同时持有Host Profile并用 `create...Matrix(profile).matrixDigest`重建比较，因此不需要让共享parser导入host-specific profile、WeakSet签发registry或hostId switch。Operation Context不是独立public authority。

### 84.2 已实施修正

- logical placement从exact string Set升级为按logical root分组的portable topology；
- 每个path逐段登记NFC/case-folded prefix，拒绝 `A/x` 与 `a/y` 的派生目录拼写冲突，以及custom instruction与Config的case-only collision；
- exact declaration path仍唯一；若一个声明是另一声明祖先，ancestor必须是directory node且processing必须是directory-container；file、tree或transaction-owned directory不能吞后代声明；
- `.wakeflow-local`被自定义instruction file占据等物理不可能矩阵在编译期拒绝；
- 当前Codex40/Claude48声明全部满足新拓扑，所有真实parent都是`descendantAuthority: separate-declaration-required`的container；
- Matrix parser初次解析declarations后直接执行scope partition/uniqueness/topology/digest，不再由admission函数二次解析最多10,000项；
- Operation Context选中的declaration已经由Matrix parser解除别名并冻结，删除第三次Resource Declaration parse；operation admission仍重新验证processing合同；
- 测试增加case-only exact、file ancestor和case-folded settings parent三类反例。

验证结果：

```text
Static Matrix/Operation Context + Program Instruction/Gitignore consumers: 18 pass / 0 fail / 0 skip / 1.443369625s
TypeScript typecheck: pass
Architecture: pass / 423 modules / 2586 dependencies
git diff --check: pass
```

## 85. Workspace Catalog / Matrix / Operation Context 核实点

```text
Foundation Resource Processing Contract
  → owner-local Resource Catalogs
  → strict Host Resource Profile
  → shared + current-host Static Matrix
  → expected matrix digest + declarationId + one recipe
  → domain owner authority/source/lock/effect
```

- owner知道“谁的业务”，Declaration知道“何种资源”，Processing知道“允许哪些机械能力”，Operation Context只冻结本次选择；
- 不存在Owner–Capability Binding、动态registry、service locator、FileManager或generic execute dispatcher；
- 动态Demand/TODO/Window实例由owner factory产生，不进入静态全局矩阵；
- Matrix digest是可重建一致性证据，不是签名、写权限或host runtime identity；
- Host差异全部由Profile值产生，共享compiler零Codex/Claude分支。

`Workspace resource declaration/catalog/matrix spine = reviewed and closed`。

## 86. MI-001

### 86.1 目标文件与结论

- `src/workspace/managed-integration/wakeflow-managed-text-envelope.ts`
- `src/workspace/managed-integration/wakeflow-managed-text-authority-transition.ts`

Envelope是mixed-owned UTF-8文件内唯一marker block协议：outside原始bytes逐字保留，managed body使用NFC/LF/单尾换行profile，begin/end绑定component/owner/body digest/separator，所有range是同一source snapshot上的半开byte range。Transition只允许desired、明确current renderer或unmanaged source进入重组；合法marker不自动授予覆盖权。

### 86.2 已实施修正

- source/body/result摘要统一经过稳定hash helper；SHA初始化/update/digest失败不再泄漏下层错误，新增hash-failure；
- Buffer snapshot、render与concat allocation失败统一capacity；
- managed outside digest改用Sha256Hasher依次消费prefix/suffix，不再 `Buffer.concat` 整个outside；
- recomposition/removal的output本身已是新Buffer并与source解除别名，`resultBytes`不再整文件复制第二次；返回bytes仍由调用方独占可变；
- Transition删除无生产consumer的kind常量/字段、matchedCurrentTargetIndex、desiredBodyDigest、sourceEnvelope和desiredTarget；
- known-current查找从findIndex改为some，只保留是否准入；生产实际只消费disposition、sourceAuthority和target；
- Request/Source辅助类型收回模块内部；currentTargets仍最多8个、同component/owner、digest唯一且exact body二次比较；
- exact remove API当前无TS consumer，但已确认reconfigure/migration需要mixed-owned `remove-managed-block`，保留为未接线能力，不扩张自动删除。

验证结果：

```text
Envelope/Transition + Gitignore/Program Instruction/Support Memory consumers: 28 pass / 0 fail / 0 skip / 1.024713125s
TypeScript typecheck: pass
Architecture: pass / 423 modules / 2586 dependencies
git diff --check: pass
```

## 87. MI-002

### 87.1 目标文件与结论

- `src/workspace/managed-integration/wakeflow-gitignore-body-authority.ts`

Authority从完整Codex＋Claude Profile集合分别重建canonical Static Matrix，收集Workspace root下ignored且不已被Active/Local root覆盖的资源，生成根锚定literal rules。它不读取Git或文件；parse只证明record自洽，effect owner仍必须从Profiles重推authority。outside classifier只识别exact duplicate/negated lines，wildmatch/precedence由Git observer负责。

已确认保留：

- 固定 `/.wakeflow-active/`、`/.wakeflow-local/` 加Config/Managed/Host短锁和Claude local settings形成当前7条host-neutral并集；
- Git magic字符逐字escape，rule canonical排序去重；body/bodyDigest与profile/rule authorityDigest分离；
- envelope target component/owner/body关系完整重验；
- `.git/info/exclude`、global excludes、broader wildcard和后置negation不被词法层冒充shared authority。

唯一修正：ignored `tree` node的物理根与directory相同，应生成尾随`/`的directory-only pattern；原实现只对`directory`分支加`/`。当前矩阵没有private tree，因此golden不变，但Foundation INF-4未来接线不会获得过宽file-or-directory规则。

验证结果：

```text
Gitignore Body Authority + real Git Inspection: 18 pass / 0 fail / 0 skip / 986.70825ms
TypeScript typecheck: pass
Architecture: pass / 423 modules / 2586 dependencies
git diff --check: pass
```

## 88. MI-003

### 88.1 目标文件与结论

- `src/workspace/managed-integration/wakeflow-program-instruction-body-authority.ts`

本单元结论为accept，不修改代码。Authority只从strict Config与单个Host Profile生成目标managed body；Config提供Program/controller identity与持久language，Profile提供hostId/instruction filename。它不读取文件/outside，不执行recompose/CAS，也不保存host handle或launch事实。

确认事项：

- English与Simplified Chinese由`presentation.language`唯一选择，不按当前对话/host猜测；
- Program displayName/description、IDs、host/file name全部使用Markdown JSON literal，换行、backtick、HTML marker不能注入结构；
- body只引用当前稳定Config/Active/Local协议根，不声称旧activeIndex、workspace-current-status或ledgerRecordMap存在；
- unavailable-plugin边界明确只读定位、禁止手工复刻backend mutation；
- Config/Host重新推导是authority，parser中的kind/version/body/identity/envelope/digests只证明传递记录自洽；
- generated body满足Managed Envelope NFC/LF/单尾换行与reserved marker限制。

验证结果：

```text
Program Instruction Body Authority + Inspection: 6 pass / 0 fail / 0 skip / 349.141459ms
TypeScript typecheck: pass
Architecture: pass / 423 modules / 2586 dependencies
git diff --check: pass
```

## 89. MI-004

### 89.1 目标文件与结论

- `src/workspace/managed-integration/wakeflow-gitignore-inspection.ts`

Inspection组合expected Matrix operation、双Host authority、current-user 0644 stable source、Managed Envelope、outside exact预分类和Git最终语义；只返回current/satisfied-user-owned/recompose-required与候选，不写文件。

### 89.2 已实施修正

- root `.gitignore` absent时不再先启动current Git process：没有根文件时任何其他exclude source都不能成为source `.gitignore` 的shared authority，current checks确定性全false；
- absent路径直接构造同一probe的unmatched checks，只运行candidate Git，并在完成后再次证明source仍absent；
- existing user/managed source仍执行current Git＋source expected-node revalidation；candidate路径仍执行第二次Git及最终CAS前revalidation；
- Inspection kind无生产consumer删除；RuleCheck/Status收回模块内部；零使用Request接口删除；
- local/global/info exclude仍可作为Git事实，但`ignored`只有decision.source exact `.gitignore`才为true；
- exact outside negation、unknown managed body、broader后置negation、candidate digest/semantics和2 MiB capacity保持。

测试维护：原Managed Recomposition `source CAS conflict`通过轮询瞬时atomic stage制造竞争，属于时序概率测试；优化缩短stage窗口后失效。该case删除及三个专用imports，底层CAS由Atomic Write确定性stale expectation测试拥有，Managed层继续覆盖错误映射、锁timeout、recovery和byte preservation。

验证结果：

```text
Gitignore Inspection/Recomposition/Recovery: 31 pass / 0 fail / 0 skip / 1.495696875s
TypeScript typecheck: pass
Architecture: pass / 423 modules / 2585 dependencies
git diff --check: pass
```

## 90. MI-005

### 90.1 目标文件与结论

- `src/workspace/managed-integration/wakeflow-program-instruction-inspection.ts`

Inspection严格绑定Matrix与当前Profile重建digest、current/desired Config与语义digest、相同Program ID、目标host instruction declaration/recipe，以及current-user 0644 single-link source。current Config render是唯一admitted-current，desired render是唯一current；fresh current null只允许unmanaged或already desired。

### 90.2 已实施修正

- StableFileRead `too-large`原映射为target-capacity，实际尚未生成candidate；新增source-capacity稳定分类；
- target recomposition超过2 MiB继续使用target-capacity；
- Inspection kind无生产consumer删除；Status辅助type收回模块内部；
- context/current+desired digests/authorities/source/transition均被recomposition或maintenance evidence消费，保留；
- source读取后在返回前按expected node/digest/bytes再次稳定读取；absent source同样证明仍absent；
- known language transition、unknown managed body拒绝、profile instruction path、POSIX owner/mode和pre-abort不变。

验证结果：

```text
Program Instruction Inspection/Recomposition/Recovery: 8 pass / 0 fail / 0 skip / 843.033792ms
TypeScript typecheck: pass
Architecture: pass / 423 modules / 2585 dependencies
git diff --check: pass
```

## 91. MI-006

### 91.1 目标文件与结论

- `src/workspace/managed-integration/wakeflow-gitignore-recomposition-contract.ts`
- `src/workspace/managed-integration/wakeflow-gitignore-recomposition.ts`
- `src/workspace/managed-integration/wakeflow-gitignore-recomposition-recovery.ts`

Contract统一Matrix/Profile request、current-user root、lock recipes/options/error；Effect只在专属短锁内重跑完整Inspection，并根据source absent/present调用atomic create/replace；提交后重跑Envelope＋Git semantics。Recovery只在inactive exact lock下恢复 `.gitignore`/lock target-scoped stages、证明current可检查、退休lock，再重入normal owner。

已实施修正：

- public recomposition先解析options/pre-abort，再解析Matrix＋双Profile request；
- atomic effect成功后，`inspectCurrent(afterCommit=true)`不再传Signal；迟到取消不能跳过Git/envelope最终证明；任何失败仍commit-uncertain；
- Recovery同样先解析options/pre-abort，再解析request；
- precommit Inspection、Git candidate、lock acquire和Foundation stage recovery继续响应取消；
- current/satisfied-user-owned保持零effect；create/replace exact source、Matrix/body digests、0644/euid/single-link与Git rules完整readback不变；
- Recovery receipt保留retiredLockDigest、stageRecovery与normal recomposition，这些是有意义的恢复证据，不按Config空包装删除。

验证结果：

```text
Gitignore Recomposition + explicit Recovery: 15 pass / 0 fail / 0 skip / 1.354098s
TypeScript typecheck: pass
Architecture: pass / 423 modules / 2585 dependencies
git diff --check: pass
```

## 92. MI-007

### 92.1 目标文件与结论

- `src/workspace/managed-integration/wakeflow-program-instruction-recomposition-contract.ts`
- `src/workspace/managed-integration/wakeflow-program-instruction-recomposition.ts`
- `src/workspace/managed-integration/wakeflow-program-instruction-recomposition-recovery.ts`

三层职责与Gitignore一致：Contract绑定Matrix/Profile/current+desired Config及host-specific lock recipe；Effect锁内重跑Inspection并atomic create/replace；Recovery仅处理inactive exact lock与target-scoped stages，证明current可安全检查后退休锁并重入normal owner。

已实施修正：

- public effect与recovery均在大型Matrix/Config request解析前先处理options/pre-abort；
- atomic提交后Inspection不再携带Signal，必须完成Config/authority/envelope/node/digest readback或返回commit-uncertain；
- Inspection source-capacity与target-capacity均映射owner capacity，并保留不同结构路径；
- current/desired Config program identity、Matrix/Profile digest、known language render、outside byte preservation、0644/euid/single-link与lock/stage scope不变。

验证结果：

```text
Program Instruction Recomposition + explicit Recovery: 5 pass / 0 fail / 0 skip / 887.813375ms
TypeScript typecheck: pass
Architecture: pass / 423 modules / 2585 dependencies
git diff --check: pass
```

## 93. Managed Integration 系统核实点

```text
Config/Profile/Matrix authority
  → deterministic body authority
  → byte-exact mixed-owned envelope
  → known-current transition
  → stable source + semantic inspection
  → owner short lock
  → atomic create / expected-source replace
  → post-commit full readback
  → explicit inactive-lock/stage recovery
```

系统结论：

- `.gitignore`是host-neutral双Profile规则并集；Program Instruction是current-host Config语言/身份渲染；二者不共享领域正文模板，只共享Envelope/Transition机械能力；
- outside bytes逐字节保留；合法marker不是authority，unknown body始终阻断；已确认exact remove能力保留给未来decommission/migration；
- `.gitignore`最终语义只由固定Git machine protocol证明；user-owned规则已满足时零写入；
- Program Instruction只接纳desired或current Config render，语言变更可安全CAS更新；
- tracked文件统一current-user/single-link/0644，锁0600；所有effect提交前可取消，提交后完成readback；
- Recovery不按时间夺锁，只处理inactive exact owner和target-scoped Foundation stages；
- Catalog只登记host-neutral `.gitignore`/lock；Program Instruction资源来自Host Catalog，不重复声明；
- 无ManagedContentManager、GitClient、全局renderer registry或outside overwrite。

验证结果：

```text
Managed Integration focused test files: 10
Managed Integration tests: 50 pass / 0 fail / 0 skip / 2.034542208s
TypeScript typecheck: pass
Architecture: pass / 423 modules / 2585 dependencies
Schema check: pass / 34 schemas / 65 external ref edges
git diff --check: pass
```

`Managed Integration = reviewed and closed for current technical skeleton`。

## 94. MNT-001

### 94.1 目标文件与结论

- `src/workspace/maintenance/wakeflow-maintenance-operation-id.ts`

结论accept，无代码修改。Operation ID是单次Maintenance gate/intent/journal/recovery的短生命周期相关身份，不是业务实体，也不进入全局durable ID kind。格式固定 `maintenance_operation_<uuid-v4>`，factory只调用一次，错误脱敏；intent/journal refs都位于固定transactions root并由同一ID派生。

验证结果：

```text
Maintenance Operation ID + Gate/Journal consumer: 9 pass / 0 fail / 0 skip / 4.362312125s
TypeScript typecheck: pass
Architecture: pass / 423 modules / 2585 dependencies
git diff --check: pass
```

## 95. MNT-002

### 95.1 目标文件与结论

- `src/workspace/maintenance/wakeflow-static-materialization-preview-contract.ts`

Preview Contract只拥有跨进程可传递的action、blocker、共享步骤、Config摘要关系、拓扑顺序与plan digest；它不读取workspace、不决定owner业务正文，也不授予apply权限。

已实施修正：

- step kind由单一闭合tuple同时派生TypeScript union和runtime membership，删除重复词汇表；
- step/owner/target/dependency/blocker统一well-formed与256字符预算；target保持当前内部逻辑坐标的闭合token语法；
- dependency必须引用更早步骤，并按步骤位置严格递增；Config激活最多一次、固定最后且依赖全部先行步骤；
- fresh/reconfigure必须有desired Config；reconcile必须保持current/desired同摘要且不得发布Config；ready状态进一步证明fresh无current、其他action有current，并绑定Config步骤是否必要；
- Host Profile集合验证只转换已知Body Authority/Matrix领域错误，未知编程异常不再被伪装成profile输入错误；
- 新增小型直接合同测试，覆盖真实durable surface/Claude host key、反向dependency与action关系。

## 96. MNT-003

### 96.1 目标文件与结论

- `src/workspace/maintenance/wakeflow-static-materialization-preview.ts`

Static Materialization Preview是共享静态owner的只读组合器：它读取Core Layout、Config、Active、Ledger、Support、Gitignore与Program Instruction的真实inspection，生成确定性步骤和blocker，但不创建gate/journal、不写文件，也不把Host capability payload纳入共享层。

已实施修正：

- 按Node `AbortSignal`合同，开始前、owner边界和返回前统一检查取消；下游稳定`aborted`不再降级为普通业务blocker；
- Core Layout只转换已知inspection错误，未知异常继续暴露，避免隐藏实现缺陷；
- Support Root关闭失败与Ledger一致成为显式blocker，不从finally泄漏未分类RootedDirectory错误；
- producer在返回前用Preview Contract复验自身结果，防止本地构造与可传递合同漂移；
- 修正旧confirmation fixture中不可能的“fresh ready但无Config激活”计划；新增pre-abort测试，未增加时序概率测试。

核实依据：[Node AbortSignal](https://nodejs.org/docs/latest/api/globals.html#abortsignalthrowifaborted)与[Node File System](https://nodejs.org/docs/latest/api/fs.html#fspromisesreadfilepath-options)说明取消会使支持该能力的异步操作以AbortError拒绝，且`aborted`/`throwIfAborted()`表达的是终止当前操作，而不是领域检查结果；本模块据此把取消与blocker分离。文件系统检查仍是best-effort cancellation，已完成的只读系统调用不被描述为回滚。

验证结果：

```text
Preview Contract + Producer + Confirmation + Execution Plan: 14 pass / 0 fail / 0 skip / 2.134298667s
TypeScript typecheck: pass
Architecture: pass / 424 modules / 2587 dependencies
git diff --check: pass
```

## 97. MNT-004

### 97.1 目标文件与结论

- `src/workspace/maintenance/wakeflow-host-maintenance-contribution.ts`
- `src/workspace/maintenance/wakeflow-host-maintenance-capability.ts`

Contribution是Host planner向共享Maintenance提交的被动JSON计划数据；Capability是本次进程内唯一Host实现端口。共享层只验证身份、顺序、摘要和预算，不解释payload；Host executor必须在效果前按当前Config/Profile重新验证payload。它们不是registry、通用dispatcher或Owner–Resource Capability Binding。

已实施修正：

- 删除`sourcePlanDigest`：该字段只保存未同行传递的Host私有plan摘要，没有任何复验consumer，不能增加授权或证据强度；
- 删除单一receipt上的零consumer `kind`，保留operationId/disposition/observationDigest三项执行消费字段；
- targetKey收敛为256字符内、well-formed ASCII逻辑坐标；同一contribution禁止重复`ownerId + targetKey`，因为当前合同没有多次写同一资源的显式依赖模型；
- capabilityId补齐well-formed与长度预算；Claude capability的gate映射只捕获稳定Gate错误，未知异常不再被伪装；
- 沿真实consumer删除Claude临时Composition上随之成为零consumer的planDigest/kind/schemaVersion；旧JS中可被前后状态重验的同名sourcePlanDigest属于不同合同，未修改；
- 复用Execution Plan测试增加逻辑目标唯一性case，没有新建重复测试文件。

验证结果：

```text
Host Contribution/Capability + Claude Composition/Executor/Transaction: 18 pass / 0 fail / 0 skip / 13.875635791s
TypeScript typecheck: pass
Architecture: pass / 424 modules / 2587 dependencies
git diff --check: pass
```

## 98. MNT-005

### 98.1 目标文件与结论

- `src/workspace/maintenance/wakeflow-maintenance-execution-plan.ts`

Execution Plan只把严格Shared Preview和至多一个当前Host Contribution重建成唯一有序步骤序列；Host操作固定在Config激活前，完整嵌套来源继续同行，外层steps/blockers不能独立伪造。Plan仍是preview-only数据，confirmation与gate才构成后续执行边界。

已实施修正：

- 多个Host operation由“每项复制全部前序step IDs”改为只依赖直接前驱；传递闭包仍保持全序，依赖存储从二次增长收敛为线性；
- Config barrier继续显式依赖所有先行共享/Host步骤，保留激活前闭包证据；
- Transaction在入口已完整解析Plan，Host step执行改为直接复用该冻结Plan中的exact operation，不再逐步骤重复解析、snapshot和Canonical摘要整份Plan；
- 优化后`hostOperationForWakeflowMaintenanceStep`只剩测试consumer，已删除生产API；模拟恢复测试直接读取已验证Plan；
- 新增双Host operation小型case验证直接前驱链与最终Config barrier，完整Transaction恢复组继续通过。

验证结果：

```text
Execution Plan + full shared transaction recovery group: 19 pass / 0 fail / 0 skip / 61.7778655s
Execution Plan + Claude vertical recheck: 8 pass / 0 fail / 0 skip / 15.342196208s
TypeScript typecheck: pass
Architecture: pass / 424 modules / 2586 dependencies
git diff --check: pass
```

## 99. MNT-006

### 99.1 目标文件与结论

- `src/workspace/maintenance/wakeflow-maintenance-execution-preview.ts`

Execution Preview是零写入组合器：先生成共享Static Preview，再让固定的当前Host Capability生成至多一份被动Contribution，最后交给Execution Plan唯一重建。Capability在此没有gate，不能执行effect；Codex当前明确没有Host contribution，Claude固定使用portable-settings capability。

已实施修正：

- 增加稳定`shared-preview`与`aborted`分类；请求解析、共享preview和下游取消不再泄漏另一模块错误或降级为plan blocker；
- reconcile为Host planner二次读取Config时，若共享preview已证明非空摘要而快照失败，明确返回source-config，不再静默省略Host contribution并生成表面ready计划；
- capability返回后与最终返回前再次检查取消，保持“取消终止观察、领域不满足形成blocker”的边界；
- 二次Config快照只在当前Host确实有capability、需要生成payload时发生；Codex共享-only reconcile不再执行零consumer读取；
- shared preview结果显式保留ReturnType，避免组合边界退化为隐式any；新增Claude pre-abort纵向case。

验证结果：

```text
Codex/Claude fixed composition vertical tests: 5 pass / 0 fail / 0 skip / 14.688812334s
TypeScript typecheck: pass
Architecture: pass / 424 modules / 2588 dependencies
git diff --check: pass
```

## 100. MNT-007

### 100.1 目标文件与结论

- `src/workspace/maintenance/wakeflow-maintenance-confirmation.ts`

Confirmation是用户审阅后原样回传的被动envelope：绑定ready Execution Plan、无Signal的exact Request，以及仅Fresh动作派生的Launch Intent Set。Digest只证明同一数据内容，不是签名；apply仍重推导完整plan、取得gate并由各owner重验effect。

已实施修正：

- 删除顶层重复`action`；唯一值保留在`executionRequest.action`，Public Coordinator从该authority生成结果；
- Confirmation Request不再硬编码两个Host Profile的tuple与长度判断，复用Preview Request已经验证的完整闭合集合，避免未来Host集合调整时出现第二个基数authority；
- Launch Intent编译只把已知`WakeflowWindowLaunchIntentError`映射为稳定launch-intent分类，未知异常不再被catch-all隐藏；
- Launch Intent等价比较输入在外层已完成JSON snapshot，删除无差别catch，保留Canonical JSON exact equality；
- Fresh Config摘要、Plan action/host/matrix/ready状态、Launch Intent Set和Confirmation自身摘要关系保持完整；reconfigure/reconcile继续严格无launch intents。

验证结果：

```text
Confirmation + Public Contract + real Entrypoints: 9 pass / 0 fail / 0 skip / 11.792260417s
TypeScript typecheck: pass
Architecture: pass / 424 modules / 2588 dependencies
git diff --check: pass
```

## 101. MNT-008

### 101.1 目标文件与结论

- `src/workspace/maintenance/wakeflow-maintenance-public-contract.ts`
- `src/contracts/schemas/entrypoints/wakeflow-maintenance-public-request.schema.json`
- `src/contracts/schemas/entrypoints/wakeflow-maintenance-public-result.schema.json`

Public Contract只准入preview/apply/recover三种闭合JSON请求、4 MiB Canonical UTF-8容量和typed digest/operation ID；Schema是官方MCP SDK进入owner前以及structuredContent离开server前的实际验证合同，不是仅供阅读的文档。

已实施修正：

- Request/Result Schema的摘要原误写为裸64位hex，与Foundation及runtime `sha256:<64hex>`不一致；已统一为算法前缀词法并重建generated modules；
- Public result TypeScript类型改为ready/blocked preview与apply/recover mutation判别联合，删除不可能的mode/status/action/null组合；
- Result Schema使用Draft 2020-12条件关系：ready必须零blocker且有confirmation/digest；blocked必须有blocker且无confirmation/launch；apply不能返回recovered或null action/digest；recover固定recovered/null action/null confirmation digest/零launch且operation ID非空；
- 使用官方`@modelcontextprotocol`内存client/server新增真实apply调用，证明算法前缀摘要同时通过input/output Schema；新增反例证明SDK在handler结果离开server前拒绝不可能的ready preview；
- 未把领域Confirmation、receipt或Launch Intent字段复制到入口Schema，继续由真实owner重验嵌套关系。

外部核实：[MCP Tools规范](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/draft/server/tools.mdx)要求提供`outputSchema`时structured result必须符合它；[官方TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/server/src/server/mcp.ts)在调用handler前验证input、成功返回前验证structuredContent。因此本次Schema修正直接影响真实工具可调用性。

验证结果：

```text
Public Contract + official MCP server focused tests: 10 pass / 0 fail / 0 skip / 554.240208ms
Schema check: pass / 34 schemas / 65 external ref edges / sha256:5b31b244898ad852b5e34a2446457a228ee509fc131c6efa6bc2f07665211843
TypeScript typecheck: pass
Architecture: pass / 424 modules / 2589 dependencies
git diff --check: pass
```

## 102. MNT-009

### 102.1 目标文件与结论

- `src/workspace/maintenance/wakeflow-maintenance-public-coordinator.ts`
- `src/workspace/maintenance/wakeflow-maintenance-public-host-facade.ts`

Public Coordinator是preview/apply/recover的唯一公共编排边界；Facade由各制品entrypoint冻结注入，不是请求可选registry。协调器编译Config输入、打开一次RootedDirectory、调用真实Host composition、构造/核验Confirmation，并把内部结果收敛为有容量且脱敏的MCP数据。

已实施修正：

- Facade Host Profiles由硬编码二元tuple改为只读集合；准入直接复用Static Preview Request完整Profile集合验证，返回current/all profile快照供后续request与confirmation比较；
- 要求Facade及Profile集合冻结、三个端口为函数，阻止“固定composition root”在一次调用中漂移；两个entrypoint删除随之多余的tuple cast；
- Maintenance公共结果与Window Binding现有标准一致，模块初始化时编译generated Result Schema，direct entrypoint与MCP server现在都执行同一结构/条件验证，不再只做TypeScript cast；
- 私有值防泄漏由任意substring匹配收敛为结构化字符串的exact值匹配，避免用户正文偶然提到workspace路径就被误判；仍禁止真实request/canonical root作为独立输出字段；
- Fresh Selection/Config编译只转换两个已知领域错误，未知异常不再伪装成普通preview输入失败；
- Root handle关闭继续保证：正常路径关闭失败返回root错误，已有主要失败时保留主要错误，不伪装成功。

验证结果：

```text
Real Maintenance Entrypoints + official MCP server: 10 pass / 0 fail / 0 skip / 10.909821708s
Schema check: pass / 34 schemas / 65 external ref edges / sha256:5b31b244898ad852b5e34a2446457a228ee509fc131c6efa6bc2f07665211843
TypeScript typecheck: pass
Architecture: pass / 424 modules / 2591 dependencies
git diff --check: pass
```

## 103. MNT-010

### 103.1 目标文件与结论

- `src/workspace/maintenance/wakeflow-maintenance-execution-intent.ts`
- `src/contracts/schemas/workspace/maintenance-execution-intent.schema.json`

Execution Intent是0600私有、immutable、absent-only发布的崩溃恢复authority。它保存resolved desired Config、当前/完整Host Profiles、Shared Preview、Host Contribution、Operation ID与Plan Digest；聚合steps、绝对路径、文件正文、凭据、PID、锁token、时间戳和mutable checkpoint均不持久化。

已实施修正：

- Operation ID、Host Contribution、Preview Request准入只转换对应稳定领域错误，未知异常不再被catch-all伪装；
- Request parser已返回current Profile快照，删除第二次相同解析；
- 私有normalize保留已重建Plan，与Intent一起返回内部上下文；恢复API合并为`reconstructWakeflowMaintenanceExecutionFromIntent`，一次准入同时返回exact plan与无Signal request；
- 删除原来分别解析整份Intent的Plan/Request两个函数；normal transaction、crash recovery与prepared cancellation均切换到单次重建；
- Intent v1 Schema与TypeScript仍固定两项Host Profiles。这是磁盘恢复版本在创建时的完整集合，不等同公共Facade的当前集合约束；新增Host必须设计v2/upcast或要求先清空pending transaction，不能静默改变v1语义；
- deterministic document、Config摘要、ready/non-empty plan与resource declaration保持不变。

验证结果：

```text
Intent + full Transaction/Prepared Recovery group: 22 pass / 0 fail / 0 skip / 56.210180542s
TypeScript typecheck: pass
Architecture: pass / 424 modules / 2591 dependencies
Schema check: pass / 34 schemas / 65 external ref edges
git diff --check: pass
```

## 104. MNT-011

### 104.1 目标文件与结论

- `src/workspace/maintenance/wakeflow-maintenance-execution-intent-store.ts`

Intent Store拥有0600 current-user/single-link文件的absent-only原子创建、严格确定性读取、transactions目录精确闭包、target-scoped stage recovery与journal存在时的exact retirement。它不拥有Intent语义、Journal状态转换或Maintenance Gate。

已实施修正：

- 删除API没有Signal输入时不可达的`aborted`错误分类与分支；Intent/Journal元数据提交一旦进入gate内按耐久协议完成，不伪装为可取消普通读取；
- Publication返回值由零consumer的`{disposition, publication, source}`包装收敛为唯一真实consumer `IntentSource`；Source删除重复`byteCount`，物理长度直接来自node snapshot；
- candidate text只渲染/编码一次，容量检查复用同一bytes；读取复用`readDeterministicJsonFile.value`，避免再次JSON parse，同时仍比较领域render与磁盘文本；
- Operation ID与Gate只转换已知稳定错误；Strict Text/Deterministic JSON错误映射intent，未知读取异常不再被catch-all隐藏；
- absent-only create成功后任何readback失败统一`commit-uncertain`；exact unlink成功后transactions目录闭包失败同样标记已可能提交，不再误报普通source/shape失败；
- ISSUED_SOURCES、inode/digest/intentDigest CAS、stage recovery和journal-before-intent retirement顺序保持。

验证结果：

```text
Intent Store + full Transaction/Prepared Recovery group: 22 pass / 0 fail / 0 skip / 57.042567834s
TypeScript typecheck: pass
Architecture: pass / 424 modules / 2593 dependencies
git diff --check: pass
```

## 105. MNT-012

### 105.1 目标文件与结论

- `src/workspace/maintenance/wakeflow-maintenance-journal.ts`
- `src/contracts/schemas/workspace/maintenance-journal.schema.json`

Maintenance Journal是同一Operation/Intent/Plan的mutable checkpoint，不是Event Sourcing、业务历史或第二状态机。它只允许`prepared → affected current step → completed checkpoint → terminal`，一次exact-source replace推进一个后继；崩溃语义由affectedStepId与immutable Intent共同恢复。

已实施修正：

- 注释改为transaction checkpoint journal，明确其职责；保留action/Plan/Matrix/Config摘要与Step IDs，因为Transaction/Recovery逐项核对这些不可变事实；
- 删除从未产生的`representation`错误分类；Operation ID只转换已知typed-ID错误；
- Step ID与affectedStepId新增268字符持久预算：覆盖256字符Host operation ID加`host-effect:`前缀，并在Schema内解释来源；
- Canonical digest删除无意义的JsonValue类型断言；
- 新增非法prepared checkpoint、错误affected member、提前terminal与超长Step ID直接测试；不把相同状态关系重复编码成第二套业务状态机。

验证结果：

```text
Journal model + physical Store/Prepared Recovery: 11 pass / 0 fail / 0 skip / 4.241967708s
Schema check: pass / 34 schemas / 65 external ref edges / sha256:8cc808df6f5c8b6820036b39374e1ba8fa364115a335334a80a9ed4a178bd63e
TypeScript typecheck: pass
Architecture: pass / 424 modules / 2593 dependencies
git diff --check: pass
```

## 106. MNT-013

### 106.1 目标文件与结论

- `src/workspace/maintenance/wakeflow-maintenance-journal-store.ts`

Journal Store只拥有0600 current-user/single-link journal的absent-only create、合法单后继CAS replace、target-scoped stage recovery，以及Intent退休后的prepared/terminal exact retire。每次effect前都要求有效Gate、issued source与精确transactions namespace。

已实施修正：

- 删除无Signal API上的不可达`aborted`合同；Operation ID与Gate只转换已知稳定错误；Strict Text/Deterministic JSON分别映射journal，未知读取异常不再被catch-all隐藏；
- create与checkpoint直接返回新的JournalSource；删除无consumer的publication/replacement wrapper、disposition和Foundation result暴露；Source删除重复byteCount，统一使用node.byteCount；
- terminal retirement无consumer receipt改为void；Prepared retirement receipt继续保留，因为prepared cancellation会公开retirement/digest证据；
- initial与每个proposed checkpoint都在effect前用同一64 KiB预算检查；修复“初始journal刚好合格、affectedStepId使下一状态超限后才写入”的缺口；
- create/checkpoint candidate bytes与semantic digest各计算一次；原子提交后的readback失败统一commit-uncertain；两类unlink后的空transactions闭包失败同样不再误报普通source；
- 所有Transaction、Claude recovery与Store测试切换到准确的Source返回，不保留测试专用旧wrapper。

验证结果：

```text
Journal Store + full shared/Claude Transaction Recovery group: 22 pass / 0 fail / 0 skip / 57.546684708s
TypeScript typecheck: pass
Architecture: pass / 424 modules / 2595 dependencies
git diff --check: pass
```

## 107. MNT-014

### 107.1 目标文件与结论

- `src/workspace/maintenance/wakeflow-maintenance-gate.ts`
- 邻接修正：`wakeflow-static-materialization-preview.ts`、`wakeflow-maintenance-execution-preview.ts`、`wakeflow-maintenance-execution-transaction.ts`

Maintenance Gate是唯一允许在Intent之前执行的最小effect：建立安全0700 Local bootstrap、创建O_EXCL gate，并把同一UUID同时用于operation ID和lock token。Context只在当前callback和同一RootedDirectory内有效；它不是租约、进程活性authority或可持久化Binding。

根本问题与修正：

- 原流程在pre-gate preview后才等待lock；两个调用可同时通过旧观察，后到者等前一个完成再取得gate，却未重验plan。单纯缩短timeout仍留有“观察lock absent后被调度挂起”的竞态；
- normal gate现在取得自己的exact token后补齐transactions root，重验Active节点未漂移、Local为无issue的完整busy protocol，并把已验证pre-gate Core观察只绑定到active Context；
- Static Preview只有持有同root active GateContext时才能复用该Core观察，其余Config/Active Projection/Ledger/Support/Managed Integration/Host contribution全部在lock内重新执行真实inspection；
- Transaction比较gate-bound完整Plan Digest，一旦变化以带operation ID的plan-stale退出，且发生在任何Intent/Journal发布之前；仅安全空bootstrap可保留；
- GateContext删除零consumer kind，WeakSet＋Root WeakMap继续提供真实能力身份；normal Context额外绑定Core观察，existing recovery Context不能调用该通道；
- Operation ID factory移到首次filesystem effect之前并映射typed错误；factory可能产生的同步外部变化会被随后的Core/完整Plan观察纳入；
- 新增确定性测试：UUID factory在pre-gate preview后写入用户`.gitignore`，锁内重验拒绝旧plan、保留用户文件且transactions目录为空；另证invalid factory不会创建Local bootstrap。

标准依据：[AWS optimistic locking](https://docs.aws.amazon.com/us_en/amazondynamodb/latest/developerguide/BestPractices_OptimisticLocking.html)要求更新时检查当前版本仍等于先前读取值，冲突即失败；[Git lockfile API](https://git-scm.com/docs/api-lockfile/2.2.3)使用O_CREAT|O_EXCL检测并发writer。Wakeflow组合两者：O_EXCL只提供writer互斥，Plan Digest锁内重验才关闭旧观察窗口。

验证结果：

```text
Full shared Transaction Recovery: 12 pass / 0 fail / 0 skip / 56.829081458s
Gate + Orphan Gate Recovery: 10 pass / 0 fail / 0 skip / 4.117753958s
Codex/Claude host verticals: 5 pass / 0 fail / 0 skip / 13.476285041s
TypeScript typecheck: pass
Architecture: pass / 424 modules / 2597 dependencies
git diff --check: pass
```

## 108. MNT-015

### 108.1 目标文件与结论

- `src/workspace/maintenance/wakeflow-maintenance-execution-transaction.ts`

Execution Transaction是唯一把confirmed Plan变为effect的owner：pre-gate与gate-bound两次完整Plan CAS后，按`Intent create → Journal prepared → affected → exact owner effect/readback → checkpoint → terminal → Intent retire → Journal retire`推进；Recovery只从immutable Intent与Journal恢复，不从受影响文件反推操作。

已实施修正：

- Request Signal与Options Signal收敛为唯一来源；两者同时存在但不是同一对象时拒绝，pre-gate/locked preview/Gate/Config read/Step统一使用同一Signal；
- 新增稳定`aborted`事务分类：preview、Gate、shared step与Host step取消不再误报plan-stale/gate/step；每个新step开始前响应取消，owner effect成功后仍完成checkpoint；
- recovery runtime明确拒绝uuidFactory并在读取前响应取消；已存在持久事务的取消继续返回exact operation ID；
- pre-durable Intent/Journal容量或构造失败、lock内plan-stale、普通Gate busy/aborted不再返回无法recover的operation ID；只有已有Intent/Journal或orphan gate需要恢复时保留ID；
- Gate stale映射plan-stale，Store commit-uncertain/stage recovery-required映射事务recovery-required，transactions namespace单独保持transaction分类；
- Transaction receipt改为no-op/completed/recovered判别联合，operationId的nullability由status决定；删除内部零consumerkind/executionBoundary；Step receipt删除零consumer kind，保留公共结果实际消费字段；
- Host operation直接复用已验证Plan，不再全量重解析；Journal create/checkpoint直接Source返回已同步到所有纵向测试。

验证结果：

```text
Transaction + Claude + Public Entrypoints: 20 pass / 0 fail / 0 skip / 58.208601167s
TypeScript typecheck: pass
Architecture: pass / 424 modules / 2597 dependencies
Schema check: pass / 34 schemas / 65 external ref edges / sha256:8cc808df6f5c8b6820036b39374e1ba8fa364115a335334a80a9ed4a178bd63e
git diff --check: pass
```

## 109. MNT-016

### 109.1 目标文件与结论

- `src/workspace/maintenance/wakeflow-maintenance-orphan-gate-recovery.ts`
- `src/workspace/maintenance/wakeflow-prepared-maintenance-recovery.ts`

两项能力互斥：Orphan Gate只处理Intent发布前崩溃留下的inactive exact gate，要求同operation token且transactions为空；Prepared Recovery实际是checkpoint 0 cancellation，允许intent-only、intent+journal或安全的prepared journal-only前缀，绝不接受任何affected/checkpoint执行迹象。

保留决定：当前两者没有产品entrypoint consumer，但普通public recover无法处理“无Intent的gate”，也不表达“取消而非继续”的用户意图；它们是已确认锁/事务基础建设中的显式运维能力，继续保留，不伪装为当前已公开工具。

已实施修正：

- Prepared options parser下沉为Gate纯准入函数并在任何stage/read/lock观察前调用；pre-abort新增稳定分类，观察阶段之间再次检查，已开始exact retirement后完成耐久闭包；
- Operation ID只转换typed-ID错误；Intent/Journal Store的commit-uncertain与stage recovery-required统一映射recovery-required，不再降级为普通内容错误；Gate取消与残留恢复分别保留aborted/recovery-required；
- Orphan journal/transactions/Core检查只转换已知Rooted/Stable/Core错误，未知异常不再被catch-all隐藏；
- 两个单一API receipt删除零consumer kind，保留operation、retired lock、physical retirement与最终Core digest证据；
- 不根据mtime判断过期、不终止进程、不退休active/unknown owner、不接纳不匹配token或foreign transaction；
- 新增prepared cancellation在pre-abort时零filesystem effect测试。

验证结果：

```text
Gate/Prepared Cancellation + Orphan Gate Recovery: 11 pass / 0 fail / 0 skip / 4.029545083s
TypeScript typecheck: pass
Architecture: pass / 424 modules / 2597 dependencies
git diff --check: pass
```

## 110. MNT-017

### 110.1 目标文件与结论

- `src/workspace/maintenance/wakeflow-maintenance-resource-catalog.ts`
- `src/workspace/maintenance/wakeflow-workspace-core-layout-inspection.ts`

Catalog只声明Local/Runtime/Maintenance/Transactions四级0700目录与一个0600 Gate；Active由Active Catalog独立拥有，dynamic Intent/Journal由operation factory声明。Core Inspection只读分类Active两级容器和Local maintenance protocol，不解释transaction正文或其他领域runtime资源。

已实施修正：

- 删除Maintenance模块对Active declaration/path的零consumer re-export，保持相邻owner独立；
- Core Inspection删除零consumer result kind，以及仅文件内部使用的Status/Options exports；Digest basis继续保留domain kind分隔；
- Lock inspection错误原来把aborted/root-scope/input等全部降级为inactive residue；现在aborted/root-scope精确上卷，unsafe-lock与residue-changed分别形成conflict/recovery-required，其余为inspection；
- runtime fresh检查删除每次调用创建的单元素Set；
- 返回前再次检查Signal，避免最后一次lock/directory观察后迟到取消仍返回成功；
- installed Local/Runtime中的其他领域资源继续只令freshCompatible=false，不妨碍完整Maintenance protocol的idle状态；Maintenance root/transactions仍严格禁止foreign entries。

验证结果：

```text
Resource Catalog + Core Inspection + Gate consumers: 13 pass / 0 fail / 0 skip / 4.184300375s
TypeScript typecheck: pass
Architecture: pass / 424 modules / 2595 dependencies
git diff --check: pass
```

## 111. MNT-018

### 111.1 目标文件与结论

- `src/workspace/maintenance/wakeflow-static-materialization-step-executor.ts`

Step Executor是12种shared static step的闭合dispatcher。每个分支从confirmed Preview/Request重算领域authority，只调用既有owner；它不排序step、不推进Journal、不获取Gate，也不开放动态handler registry。`recoveringAffectedStep`只改变Fresh whole-owned exact-existing准入，不能改变目标authority。

已实施修正：

- options/source Config/Signal准入移到大型Preview/Request解析之前，pre-abort不再解码无关payload；Gate、Preview与Request只转换已知稳定错误；
- ready状态成为effect硬前置，Step ID补256字符/well-formed准入；
- 删除内部Step receipt零consumer kind与Canonical摘要无意义JsonValue断言；保留stepId/disposition/observationDigest三个真实Transaction/Public consumer字段；
- Support Root准确保留aborted；Support Memory显式映射root open，关闭失败不再覆盖主要owner错误，成功后关闭失败仍使affected step进入恢复；
- Config snapshot接入Signal；Config publication/replacement准确映射aborted/root-scope；Local Core inspection映射aborted/root-scope/owner；
- 最终Config不再作为所有未知未来kind的default，改成显式`publish-config`分支加never exhaustiveness；新增kind时若未实现dispatcher会在编译期失败；
- 新增“pre-abort先于非法plan解码”测试，保留Fresh Config-last、strict absent与affected replay纵向case。

验证结果：

```text
Step Executor direct vertical tests: 3 pass / 0 fail / 0 skip / 2.439439875s
Maintenance full focused system: 75 pass / 0 fail / 0 skip / 62.749749375s
TypeScript typecheck: pass
Architecture: pass / 424 modules / 2594 dependencies
Schema check: pass / 34 schemas / 65 external ref edges / sha256:8cc808df6f5c8b6820036b39374e1ba8fa364115a335334a80a9ed4a178bd63e
git diff --check: pass
```

## 112. Maintenance 系统核实点

```text
Public MCP Schema / fixed Host Facade
  → zero-write Shared + Host Preview
  → ready Confirmation + Fresh Launch Intents
  → pre-gate plan CAS
  → exact O_EXCL Gate + lock-bound plan CAS
  → immutable 0600 Intent
  → mutable 0600 single-successor Journal
  → closed shared / host step owner effects
  → post-effect checkpoint + terminal Config closure
  → Intent then Journal exact retirement
```

系统结论：

- Preview、Confirmation、Intent、Journal和Receipt各自只有一个职责；Digest证明内容相等，不是签名、授权或来源真实性；
- Gate是短生命周期进程内能力；不使用mtime lease、不自动夺active/unknown lock、不调用宿主窗口/Git/tmux/Node shell；
- pre-gate与lock-bound完整Plan CAS关闭等待锁后的旧观察窗口；所有文件owner仍在effect前执行自己的source/authority/CAS；
- Intent保存restart所需最小闭包，Journal只保存单调checkpoint，不是Event Sourcing；
- Config固定最后激活；取消在effect前终止，owner commit后完成readback/checkpoint；commit-uncertain明确要求recovery；
- Codex没有Host静态贡献；Claude只有固定portable-settings capability，共享层不解释payload；
- Public MCP使用官方SDK实际验证input/output Schema；Agent负责执行Launch Intent，Wakeflow不调用宿主创建窗口；
- Orphan Gate与Prepared Cancellation当前无产品entrypoint consumer，因覆盖普通recover无法表达的真实崩溃窗口而显式保留；不得描述为已公开功能；
- Intent v1的两Host Profile基数是持久版本事实；未来新增Host必须设计v2/upcast或先完成pending transaction清空策略；
- 没有MaintenanceManager、动态action/step/capability registry、第二状态机、SQLite或全局workspace registry。

`Workspace Maintenance = reviewed and closed for current technical skeleton`。

## 113. TODO-001

### 113.1 目标文件与结论

- `src/governance/todo/todo-item-id.ts`
- `src/governance/todo/todo-paths.ts`
- `src/contracts/schemas/governance/todo/todo-item-id.schema.json`

TODO ID保留1–128字符ASCII可读opaque词汇，不进入durable UUID kind；它区分大小写，不从标题、时间、路径或数组位置推导。磁盘item/transaction/stage路径使用`item-<full SHA-256(todoId UTF-8)>`，真实Intake仍保存todoId，Authority反核摘要目录名并执行碰撞检查。

已实施修正：

- 删除零consumer `TodoItemIdErrorReason` alias，稳定Error仍保留literal reason/path/code；
- `TodoItemStorageKey`从宽泛template string升级为函数唯一授予的brand，避免任意`item-*`在TypeScript层冒充已计算key；
- 路径构造继续在运行时重验Todo ID，typed参数不能绕过；冒号/大小写不会直接进入文件名；
- 复用Paths测试补最短/最长、超长、非法首字符、slash、空格、lone surrogate与case-sensitive hash；未新建独立重复测试文件。

验证结果：

```text
TODO ID/Paths + Catalog/Authority consumers: 11 pass / 0 fail / 0 skip / 343.084209ms
TypeScript typecheck: pass
Architecture: pass / 424 modules / 2594 dependencies
git diff --check: pass
```

## 114. TODO-002

### 114.1 目标文件与结论

- `src/governance/todo/todo-resource-catalog.ts`

Static Catalog的五项资源有真实Matrix/Initialization consumer：Collection/Items/Transactions三个0700容器、0600短锁与0600可重建Board Projection。Dynamic Item Catalog描述Intake immutable fact、Item Root exact tree publish、State mutable snapshot与Transaction artifact；append stage明确不是长期资源声明。

已实施修正：

- 五个只通过Static Catalog消费的individual declaration改为模块私有；
- 零consumer exported tuple type收回模块内部；
- file declaration helper的processing从unknown收紧为Resource Processing Contract，错误recipe在编译与parser两层失败；
- Board继续明确derived-projection/rebuild-from-authority，不升格为权威；Lock/Transaction继续transaction-artifact；
- Dynamic Item Catalog已由Transaction Storage按exact resource path消费，分别准入Journal create/retire、Item Root directory publish、State CAS replace；Static Board declaration准入deterministic rewrite，不再是测试专用表面。

验证结果：

```text
TODO Catalog + Matrix + Initialization consumers: 7 pass / 0 fail / 0 skip / 685.037833ms
TypeScript typecheck: pass
Architecture: pass / 424 modules / 2595 dependencies
git diff --check: pass
```

## 115. TODO-003

### 115.1 目标文件与结论

- `src/governance/todo/todo-intake-lineage.ts`
- `src/governance/todo/todo-intake.ts`
- 对应Lineage/Intake v1 Schemas

Intake是TODO创建时的immutable用户意图：typed IDs、初始状态、优先级、目标、测试决定、文档引用与createdAt；current status、Demand mount、revision和archive receipt属于State。Lineage是跨Aggregate只读引用，只绑定todoId、exact intakeRef与semantic digest，不引用Markdown row。

已实施修正：

- Lineage parser新增`intakeRef === todoIntakeRef(todoId)`关系；原测试中的任意`item-aaaa...`伪路径改为真实SHA-256 storage key，跨ID/路径别名不再只靠下游偶然发现；
- Lineage artifact/version与ErrorReason零consumer exports收回模块内部；
- Intake creator先用固定、合法且不发布的占位时刻完成全部draft Schema/typed-ID/Unicode/testing/doc关系准入，再恰好读取一次真实Clock；无效草稿不再调用外部时间来源；
- Wall Clock type/failure/result统一映射Intake time错误，不泄漏Foundation clock或注入函数异常；Clock改变原draft也无法影响已准入快照；
- Intake semantic digest删除无意义JsonValue断言；Intake artifact/version零consumer constants私有化；
- 新增clock调用顺序/失败映射与Lineage伪hash路径测试，Demand Identity/Publication真实consumer同步使用exact lineage。

验证结果：

```text
Intake/Transaction + Demand Lineage consumers: 16 pass / 0 fail / 0 skip / 1.516011333s
TypeScript typecheck: pass
Architecture: pass / 424 modules / 2600 dependencies
git diff --check: pass
```

## 116. TODO-004

### 116.1 目标文件与结论

- `src/governance/todo/todo-state.ts`
- `src/contracts/schemas/governance/todo/todo-state.schema.json`

TodoState是唯一mutable业务快照，不是Event Sourcing：revision与previousStateDigest形成当前文件的前向CAS链；Demand mount只在claimed/terminal mounted状态存在；Business Archive receipt把exact claimed state、TODO/Intake/Demand与manifest绑定为archived终态。磁盘事务仍负责历史恢复与原子替换。

已实施修正：

- State artifact/version零consumer constants私有化；Semantic digest删除无意义JsonValue断言；
- Wall Clock failure/type/result统一映射State time错误；
- 新增safe-integer revision上界检查，transition不会先调用clock再因revision溢出失败；
- Claim先完整准入current/mount、计算next revision/previous digest，再读取一次clock；
- Archive先验证closed receipt shape、TODO/Demand、archive ID、claimed/intake/manifest digests及next revision，全部成立后才读取clock；无效Business Archive授权不执行外部时间来源；
- clock成功后仍通过完整State parser关闭mount/status/archive/updatedAt关系；
- 新增无效claimed digest、最大revision和clock failure顺序测试。

系统收束决定：State v1只保留`pending-claim / parked / claimed / archived`。
`blocked / observing / completed / cancelled`没有TODO producer，且相应生命周期由Demand或
Task owner表达，已从Schema、生成类型和运行时关系中删除；不再接受手工注入的伪authority。

验证结果：

```text
State/Transaction/Collection Service + Demand Publication consumers: 27 pass / 0 fail / 0 skip / 10.195838667s
TypeScript typecheck: pass
Architecture: pass / 424 modules / 2600 dependencies
git diff --check: pass
```

## 117. TODO-005

### 117.1 目标文件与结论

- `src/governance/todo/todo-transaction.ts`
- `src/contracts/schemas/governance/todo/todo-transaction.schema.json`

TodoTransaction是append/claim/archive的一次immutable recovery plan，不保存mutable phase：绑定todoId、operation、createdAt、expected Collection/Intake/State digests、完整target State、append时完整target Intake，以及三个target semantic digests。物理顺序、lock、projection和retirement归Collection Transaction Storage。

已实施修正：

- Transaction artifact/version零consumer constants私有化；Semantic digest删除无意义JsonValue断言；
- 新增`parseTargetIntake`/`parseTargetState`窄边界：嵌套Schema虽合法但领域关系错误时统一映射Transaction target，不泄漏TodoIntakeError/TodoStateError；未知异常继续上卷；
- operation-specific nullability、append revision 1、claim/archive target status、previousStateDigest、createdAt与Collection digest变化关系保持；
- 新增嵌套research/testing不一致与revision chain不一致测试。

验证结果：

```text
Transaction + physical Storage + Collection Service: 15 pass / 0 fail / 0 skip / 6.37112525s
TypeScript typecheck: pass
Architecture: pass / 424 modules / 2600 dependencies
git diff --check: pass
```

## 118. TODO-006

### 118.1 目标文件与结论

- `src/governance/todo/todo-collection.ts`
- `src/governance/todo/todo-board-projection.ts`

Collection Snapshot从完整Intake/State配对唯一派生，按createdAt→todoId排序，验证ID/storage-key重复并以Intake/State semantic digests计算集合摘要。Board是单向Markdown projection；缺失/漂移可重建，Claim/Archive从不反向读取行文本。

已实施修正：

- 删除`TodoCollectionItem.status`对`state.status`的重复保存，Collection digest不再同时纳入stateDigest与派生status；所有consumer直接读取State authority；
- Snapshot/Board artifact/version零consumer constants私有化；digest basis删除JsonValue断言；
- nested Intake/State关系错误统一映射Collection item-shape；
- `activeItemCount`只排除TODO owner的`archived`终态；Projection同样只隐藏archived，
  pending/parked/claimed保持可观察；
- Authority的tree entry预算改从`TODO_COLLECTION_MAXIMUM_ITEMS * 3`唯一派生，删除65536重复常量；
- 普通用户文本列对HTML、table pipe、backtick、emphasis/link字符与bidi controls做结构中和；typed ID/enum/path保持可读原文；
- Document link destination按UTF-8 percent encoding逐段编码，并额外编码`!'()*`，anchor独立编码，不能用`)`、空格、`#`改变GFM link结构；
- [GFM规范](https://github.github.com/gfm/)明确table cell解析inline/pipe、raw HTML不自动转义、link destination对空格/括号有结构语义，本实现据此分开普通文本与受信link renderer；
- 新增HTML/bidi/unsafe destination测试。

验证结果：

```text
Collection/Projection + Authority/Storage/Service consumers: 23 pass / 0 fail / 0 skip / 5.962932834s
TypeScript typecheck: pass
Architecture: pass / 424 modules / 2599 dependencies
git diff --check: pass
```

## 119. TODO-007

### 119.1 目标文件与结论

- `src/governance/todo/todo-collection-authority.ts`

Collection Authority从RootedDirectory有界扫描`items/`，要求每个SHA storage-key目录精确包含0700 root＋两个0600 single-link Intake/State文件；稳定读取领域记录、反核todoId/key/path、二次/最终tree identity，并把Board只作为current/missing/stale/unsafe诊断。非空transactions阻断normal inspect。

已实施修正：

- Item tree由“每个目录filter整棵entries”的O(n²)分组改为一次`parentResourcePath → children`索引，保持exact三节点闭包；
- 最多65,536 items由逐项串行读取改为16项固定批次Promise.all；结果仍按扫描顺序收集，取消共享同一Signal，不创建无界任务集合；
- Projection观察与最终transactions检查后新增第三次items tree扫描，关闭writer在原第二次扫描后完成完整事务并退休journal导致旧快照返回的窗口；
- pre-abort在任何filesystem观察前失败；file too-large新增capacity分类，items/projection错误路径分离；
- Projection fallback只把已知Rooted缺失映射missing、其他Rooted问题映射unsafe，未知异常不再被catch-all隐藏；
- Tree entry预算唯一从Collection maximum items派生；tree budget/options/projection/source辅助类型exports收窄。

验证结果：

```text
Authority/Storage/Service + Demand Publication consumers: 23 pass / 0 fail / 0 skip / 11.104082584s
TypeScript typecheck: pass
Architecture: pass / 424 modules / 2599 dependencies
git diff --check: pass
```

## 120. TODO-008

### 120.1 目标文件与结论

- `src/governance/todo/todo-collection-initialization-authority.ts`
- `src/governance/todo/todo-collection-initialization.ts`

Initialization Authority唯一绑定Static Resource Catalog、空Collection digest与空Board projection；Fresh Effect只在Active Layout中首次建立该authority，affected recovery只接纳可证明为空的exact prefix与projection stage，不覆盖已有item/transaction/lock/unknown资源。

已实施修正：

- Authority digest删除无意义JsonValue断言；empty Collection/Projection继续导出给Active Projection真实consumer；
- `assertRecoverableEmptyPrefix`改为void contract：调用前观察为existing、随后消失不再被静默当成absent并由Service重建；
- 普通首次执行不再只做`lstat absent → idempotent Service`：先调用Foundation `materializeDirectoryPath`并要求TODO root最终段receipt为created，竞争出现的existing exact root也返回strict-absent；
- affected recovery允许created/existing，但仍先验证existing prefix为空；最终disposition来自Foundation receipt，不使用早期布尔观察猜测；
- 单元素allowed Set改为直接闭合名称判断；
- 目录创建、Signal、node policy、Service readback与empty authority digest继续逐层验证。

验证结果：

```text
Fresh Initialization + Maintenance/Active consumers: 10 pass / 0 fail / 0 skip / 2.757399375s
TypeScript typecheck: pass
Architecture: pass / 424 modules / 2599 dependencies
git diff --check: pass
```

## 121. TODO-009

### 121.1 目标文件与结论

- `src/governance/todo/todo-collection-transaction-storage.ts`

Transaction Storage在Collection Lock内执行`immutable Journal → target authority → Board projection → verified target snapshot → exact Journal retirement`。Append使用同transactions root的私有完整目录stage后exact rename；Claim/Archive使用State expected-source atomic replace；Recovery只按Journal保存的完整target前向完成。

已实施修正：

- Dynamic Item Catalog成为真实owner consumer：Journal exclusive-create/exact-retire、Item Root exact-directory-publish、State exact-source-replace均按exact path执行Resource Processing admission；Static Board declaration准入deterministic-rewrite；
- Atomic write的stage/commit/durability/cleanup/close问题映射recovery-required；Journal target exists同样视为待恢复，不再与普通CAS conflict混淆；
- Rename destination/commit/durability/close与Journal unlink commit不确定明确要求recovery；
- Journal与Append stage inventory统一执行current-user/mode/link node policy；Rooted/JSON/parser catch只转换已知错误；
- 恢复不再只扫描transactions直系目录：已验证Journal与Lock下按exact targets恢复Append nested intake/state、State replace与Board projection Foundation stages；同父目录其他stage导致失败关闭；
- Collection root新增闭合枚举：items/transactions、Board、Lock外的unknown entry失败；Projection stage在normal inspection中路由recovery，Board本身仍由Projection owner诊断unsafe；
- Projection发布后在Journal仍存在时用recovery inspection验证target Collection与current Projection；Journal retirement成为最后commit，删除“先删恢复记录、再做全量读取”的完成但不可恢复窗口，并减少一次大Collection扫描；
- Authority capacity错误精确映射capacity；post-retirement不再响应迟到取消。

验证结果：

```text
Catalog/Authority/Transaction Storage/Service + Demand Publication: 25 pass / 0 fail / 0 skip / 10.492476583s
TypeScript typecheck: pass
Architecture: pass / 424 modules / 2602 dependencies
git diff --check: pass
```

## 122. TODO-010

### 122.1 目标文件与结论

- `src/governance/todo/todo-collection-service.ts`
- `src/governance/todo/todo-collection-service-error.ts`

Collection Service是TODO JSON集合的唯一公共owner：输入准入、Collection digest CAS、
领域transition、集合锁、事务存储调用和稳定错误面都在这里闭合。只读检查不取得锁，
而是依赖Authority的事务记录门禁、稳定文件读取和前后tree复验；所有持久化操作以及
Fresh初始化的投影修复使用同一Collection Lock。

旧JS的`createTodoBoardIfAbsent`、append、claim和archive同样在board锁内执行；新版不
复制Markdown行作为authority，而是把Intake/State作为JSON事实、Board作为可重建
projection，并以稳定观察替代只读锁。

已实施修正：

- Fresh初始化先建立TODO根，再在Collection Lock内建立items/transactions并修复Board；
  不再允许初始化与已有集合变更交错后发布旧projection；
- 初始化完成前再次要求projection为current，无法证明postcondition时返回
  transaction-conflict；
- Authority的byte budget失败在公共边界保持capacity分类，不再误报为transaction
  conflict；Active Layout的input/not-current/aborted/root-scope按各自语义映射；
- public inspect的未知底层异常统一关闭为脱敏operation-failure，保持Service错误面；
- 收回无生产consumer的lock timeout和transaction maximum bytes常量导出；
- 新增“持有Collection Lock时初始化必须等待”和Authority超限分类回归测试。

验证结果：

```text
Service + Fresh Initialization + Demand Publication + Maintenance consumer: 23 pass / 0 fail / 0 skip / 11.299982333s
Schema/codegen: pass / 34 schemas / 65 external refs
Architecture: pass / 424 modules / 2603 dependencies
git diff --check: pass
```

## 123. TODO system gate（已关闭）

系统级producer/consumer核对发现一个必须在关闭TODO系统前决定的持久化合同问题：

- 新TS只有`append / claim / archive`三个事务producer，真实状态路径是
  `pending-claim → claimed → archived`，另允许以`parked`创建待依赖条目；
- `blocked / observing / completed / cancelled`目前只有Schema/parser/projection读取能力，
  没有任何合法transition、service operation或transaction producer；磁盘手工注入却会被
  当作有效authority；
- 旧JS同样只在parser中接受这四项，公开owner只实现append/claim/archive；它们不是可迁移
  的已闭合功能；
- `blocked/completed/cancelled`已经由Demand/Task生命周期owner表达，TODO重复保存会形成
  跨Aggregate双重状态；
- 已确认RH-1范围记录明确为JSON authority的append/claim/archive，BusinessArchive消费
  claimed TODO后归档。

用户确认采用收敛方案：TODO State v1删除四个无producer状态，只保留
`pending-claim / parked / claimed / archived`。Schema、生成类型、State关系和Collection
active计数已同步；删除零consumer的Archive authorization候选类型。`parked`已有真实intake
producer与projection consumer，表示显式依赖等待；解除等待属于后续调度业务，不在技术
骨干中预建transition。

系统闭包如下：

```text
typed TODO ID → immutable Intake + exact Lineage
              → revisioned State
              → deterministic Collection snapshot
              → bounded JSON authority + one-way Markdown projection
              → Collection Lock + immutable recovery Journal
              → append / claim / archive CAS
              → Demand publication claim + Active/Maintenance consumers
```

当前完成的是TODO技术系统，不宣称业务表面全部完成：Design/public MCP intake、next-work
选择、Auto Claim策略、parked解除与BusinessArchive owner仍须由后续真实consumer切片实现。
旧Markdown board继续只作功能证据，不是新TS兼容authority。

验证结果：

```text
TODO subsystem + Demand/Active/Maintenance consumers: 65 pass / 0 fail / 0 skip / 12.994597541s
TypeScript typecheck: pass
Architecture: pass / 424 modules / 2603 dependencies
Schema/codegen: pass / 34 schemas / 65 external refs / sha256:1258e5ab15e701d0f2bd1a788f9b761618bfdc344732c88d3cbb437ca9cc7641
git diff --check: pass
```

## 124. LEDGER-001

### 124.1 目标文件与结论

- `src/governance/ledger/ledger-authority-layout.ts`
- `src/governance/ledger/ledger-authority-paths.ts`

Ledger Layout只观察和物化`requirements / confirmations / transactions`三个固定容器，
不扫描记录树；Paths只从已验证Requirement/Confirmation记录或typed record ID派生最终
记录、成员与逐记录事务路径。长期Ledger根由Config Placement提供，两个模块都不保存
绝对路径、业务索引或全局registry。

已实施修正：

- Layout kind与entry status零consumer导出收回模块内部；authority/observation digest删除
  无意义JsonValue断言；
- transaction filenames不再同时保存family和已经带family的typed ID：从
  `requirement-requirement_<uuid>`收敛为`requirement_<uuid>`，Intent、Lock与Stage仍以
  后缀和dot-prefix明确区分；
- Requirement/Confirmation最终目录继续保留复数family容器＋完整typed ID，成员路径
  仍只能来自已准入记录；
- Compact Intent、Store/Recovery、Resource Catalog和Demand Publication真实消费者随
  路径合同完成回归，没有兼容双路径或迁移分支。

验证结果：

```text
Layout/Intent/Store/Catalog + Demand Publication consumers: 19 pass / 0 fail / 0 skip / 10.7445405s
Architecture: pass / 424 modules / 2602 dependencies
git diff --check: pass
```

## 125. LEDGER-002

### 125.1 目标文件与结论

- `src/governance/ledger/ledger-authority-storage-policy.ts`
- `src/governance/ledger/ledger-resource-catalog.ts`

Storage Policy集中保存shareable authority与runtime-private transaction的权限、文件/树/
Intent容量及文档数量边界。Static Catalog进入Workspace Matrix；Dynamic Catalog按已验证
record生成聚合根、record/member facts、Intent与Lock声明，不登记短期stage。

已实施修正：

- 三个只用于组成Static Catalog的声明常量收回模块内部；
- Dynamic declaration ID直接使用已经带family的typed record ID，不再形成
  `ledger.authority.requirement.requirement_<uuid>`重复前缀；
- 审阅时发现Dynamic Catalog只有测试consumer，因此没有直接接受描述性实现；在相邻
  LEDGER-003中已把Intent create/retire与record root exact-directory-publish接入真实
  Resource Processing admission；
- 现有权限与容量矩阵保持：0755/0644长期事实、0700/0600短期事务，32 documents、
  33 files、4 MiB member、16 MiB tree、1 MiB compact Intent。

## 126. LEDGER-003

### 126.1 目标文件与结论

- `src/governance/ledger/ledger-record-publisher.ts`
- `src/governance/ledger/ledger-record-publication-storage.ts`

Publisher在任何effect前准入record/member bytes并建立closed tree plan；Storage在逐记录
Lock内拥有Intent、stage、final tree publication、exact readback与Intent retirement。
不同record共享transactions父目录，但不能共享恢复命运。

已实施修正：

- Intent exclusive-create/exact-retire与record root exact-directory-publish在实际effect点
  查询Dynamic Catalog并执行recipe admission；Catalog不再只是测试说明；
- Intent的1 MiB预算在Publisher零写阶段及Storage防御边界双重检查，不能写出自身读取
  合同无法恢复的记录；
- 原全transactions目录stage扫描改为取得逐记录Lock后调用Foundation
  `recoverDurableAtomicFileStagesMatchingTargets`，只恢复当前Intent target；同目录其他
  安全stage保持原样且不阻断本记录；
- transaction Intent file与candidate stage新增current-user ownership复验；transactions
  0700 layout同样要求当前用户拥有；
- Atomic Intent create的capacity/root-scope/post-commit不确定性分别映射为稳定Store错误，
  不再全部降级为operation-failure；
- 新增“不相关Intent stage在另一记录发布后仍原样存在”回归，证明逐记录隔离。

验证结果：

```text
Layout/Intent/Store/Catalog + Demand Publication consumers: 19 pass / 0 fail / 0 skip / 10.529878333s
Architecture: pass / 424 modules / 2605 dependencies
git diff --check: pass
```

## 127. LEDGER-004

### 127.1 目标文件与结论

- `src/governance/ledger/ledger-authority-record.ts`
- `src/contracts/schemas/governance/ledger/requirement-record.schema.json`
- `src/contracts/schemas/governance/ledger/confirmation-record.schema.json`

Requirement是一次确认后不可变的需求材料清单；Confirmation是绑定预分配Demand ID的
确认事实。两者只记录Wakeflow写入时刻，不声称认证过某个人类actor，也不保存status、
反向Demand索引、member bytes或可变业务状态。Demand Authority才验证所需角色闭包和
跨记录关系。

已实施修正：

- Creator先用固定且不发布的合法时刻完成draft、typed ID、role、document path/digest、
  排序和关系准入，之后恰好读取一次Clock；无效草稿不再执行外部时间来源；
- Document tree从32项O(n²)两两前缀比较收敛为一次path-node索引，同时拒绝文件/目录
  前缀冲突、大小写不敏感目录碰撞和`Record.json`等跨平台manifest别名；规则与
  Foundation tree plan一致；
- 三个artifact/version零consumer constants私有化，删除不可达Array分支和render/digest
  的无意义JsonValue断言；Creator使用判别联合收窄，不再强制类型断言；
- Schema注释同步说明runtime case/prefix关系，没有增加字段或兼容分支；
- 新增大小写碰撞、reserved manifest别名、无效草稿零Clock和Clock failure映射测试。

验证结果：

```text
Record/Intent/Store/Catalog + Demand Identity/Publication consumers: 25 pass / 0 fail / 0 skip / 11.941306s
Schema/codegen: build pass / 34 schemas / 65 external refs / sha256:bf386a38c39d68d217e3181b369781322b57fcf4c1537b9ce7de9fc00f4846c0
```

## 128. LEDGER-005

### 128.1 目标文件与结论

- `src/governance/ledger/ledger-record-publication-intent.ts`
- `src/contracts/schemas/governance/ledger/ledger-record-publication-intent.schema.json`

Compact Intent是单条immutable record tree的自足恢复计划：保存完整已验证record、final/
intent/lock/stage logical refs与closed tree plan，但不复制最多16 MiB的member payload。
完整stage是待发布候选，final directory rename是authority commit point；stage不完整时恢复
明确要求原调用者重带exact member bytes。

已实施修正：

- 删除顶层`family`与`recordId`副本；两者已经由完整record判别联合唯一推导，所有consumer
  也必须解析record，重复字段没有索引或恢复价值；
- Recovery与Storage改从`intent.record`派生family/typed ID，仍与调用者record ID及exact
  lock path复验；
- Intent artifact/version零consumer constants私有化，renderer删除无意义JsonValue断言；
- owner tree capacity、record/plan file inventory、record bytes digest与全部physical refs关系
  继续在每次解析时重建验证；
- Schema与生成类型同步删除重复字段，没有保留兼容解析分支。

验证结果：

```text
Intent/Store/Catalog + Demand Publication consumers: 18 pass / 0 fail / 0 skip / 10.001496083s
Architecture: pass / 424 modules / 2606 dependencies
Schema/codegen: pass / 34 schemas / 65 external refs / sha256:cf9fc801206a7e8bc8cc1d8094ee865b514afaea31caa1a7a58f607ce40d6b70
git diff --check: pass
```

## 129. LEDGER-006

### 129.1 目标文件与结论

- `src/governance/ledger/ledger-authority-store-contract.ts`
- `src/governance/ledger/ledger-authority-reader.ts`
- `src/contracts/schemas/governance/ledger/ledger-authority-member-reference.schema.json`

Reader以一次有界稳定树观察绑定record root、全部目录/文件节点和文件摘要，再严格解析
deterministic `record.json`、重建exact tree closure并核对每个member digest。Member
Reference只携带跨领域读取所需的record/member logical refs、semantic/byte digests、role与
media type；解析引用不等于证明磁盘成员，Store resolve仍必须加载record并复验物理来源。

已实施修正：

- Member Reference TypeScript合同改为`family`与typed `recordId`的判别联合，删除Reader与
  Store中的ID强制断言；
- 按[JSON Schema Draft 2020-12条件应用规范](https://json-schema.org/draft/2020-12/json-schema-core)
  使用`if/then`关闭family→recordId kind/role关系；runtime继续执行typed-ID与ref关系
  复验，Schema不是唯一语义边界；
- 引用解析拒绝`record.json`的大小写别名及其后代，不能把manifest伪装成member；
- Reader复用Foundation path splitter，不再自行解释portable path；空的FileSource
  interface改为准确type alias；
- 删除全Ledger无任何producer的`not-initialized`错误词汇；缺失记录保持`not-found`，
  固定布局完整性由独立Layout inspection负责；
- 新增family/typed-ID不一致、family/role不一致和manifest alias引用测试。

验证结果：

```text
Record/Store + Demand Identity/Transaction/Publication consumers: 21 pass / 0 fail / 0 skip / 10.407076833s
Schema/codegen: build pass / 34 schemas / 65 external refs / sha256:7398f5f7b1663f52c75d25b4cfa54a4c4f41dd0efc4537cf7421a5ae83033c47
```

## 130. LEDGER-007

### 130.1 目标文件与结论

- `src/governance/ledger/ledger-authority-store.ts`
- `src/governance/ledger/ledger-record-publication-recovery.ts`

`LedgerAuthorityStore`使用class是合理的：它只持有一个已打开的Ledger RootedDirectory，
为记录读取、发布、恢复和引用解析提供同一根作用域门面；具体状态和effect仍归相邻纯
模块，不存在全局Store registry或可替换storage backend。Recovery只按typed record ID
定位Compact Intent并幂等前向完成。

已实施修正：

- 显式Recovery先恢复/读取并验证exact Intent，确认record family/ID与lock ref后才允许
  退休inactive Lock；无Intent时Lock保持现场，不再违反Foundation“先有领域恢复证据”
  合同；
- Publication result的歧义`created`改为`wroteAuthority`：只有本次调用跨越final tree
  commit才为true；final已提交、只结算Intent的恢复稳定返回false；
- Store publish使用Requirement/Confirmation overload保持类型精度，runtime implementation
  仍接收unknown并完整解析；load方法以判别联合收窄结果，不再使用Promise强制断言；
- 批量Member resolve先按typed record ID缓存每个完整记录，再以固定8项批次并发读取成员，
  `Promise.allSettled`按输入顺序返回首个失败；最多32项，不建立无界任务集合；
- 批量Reference parser只转换已知Store input错误，未知异常继续上卷；
- 删除Store facade对九个内部权限/容量常量的零consumer转发导出。

## 131. Ledger system gate（已关闭）

当前技术闭环：

```text
Config ledger root placement
→ requirements / confirmations / private transactions layout
→ immutable Requirement | Confirmation record + member digests
→ per-record Compact Intent + Lock + closed candidate tree
→ exact directory rename commit + Intent retirement
→ stable closed-tree load + semantic record digest
→ typed member reference + exact member resolve
→ Demand Identity / Authority / Publication consumers
```

系统边界明确：Ledger不保存Demand mutable state、不执行Git、不维护反向索引、不删除
immutable records，也不引入SQLite/通用repository abstraction。当前完成的是Requirement与
Confirmation技术系统；Design/public intake、Ledger indexes/projections和BusinessArchive
family必须由后续真实业务consumer扩展，不能据此宣称已完成完整Ledger产品功能。

验证结果：

```text
Ledger subsystem + Demand/Maintenance consumers: 36 pass / 0 fail / 0 skip / 14.896505833s
TypeScript typecheck: pass
Architecture: pass / 424 modules / 2605 dependencies
Schema/codegen: pass / 34 schemas / 65 external refs / sha256:7398f5f7b1663f52c75d25b4cfa54a4c4f41dd0efc4537cf7421a5ae83033c47
git diff --check: pass
```

## 132. DEMAND-001

### 132.1 目标文件与结论

- `src/governance/demand/model/demand-identity.ts`
- `src/contracts/schemas/governance/demand/demand-identity.schema.json`

Demand Identity是Event Sourcing Aggregate创建后不可变的身份事实：typed Program/Demand
ID、创建时间、标题/目标/完成定义、需求类型、exact TODO Intake Lineage与main/isolated
执行位置。它不是事件、快照、任务状态或宿主路由记录；isolated authorization只保存
Ledger Member Reference，完整同Program/同Demand授权由Demand Authority resolve。

已实施修正：

- Creator先以固定、合法且不发布的占位时刻完整准入draft、TODO lineage、文本、typed
  IDs与placement，再恰好读取一次真实Clock；无效草稿不执行外部时间来源；
- isolated authorization只将已知Ledger Store input错误映射placement，未知异常不再被
  catch-all隐藏；
- Identity artifact/version零consumer constants私有化，renderer与semantic digest删除
  无意义JsonValue断言；
- 新增伪造TODO lineage零Clock与Clock failure映射测试。

验证结果：

```text
Identity/Authority/Command/Repository/Publication consumers: 14 pass / 0 fail / 0 skip / 12.081965333s
```

## 133. DEMAND-002

### 133.1 目标文件与结论

- `src/governance/demand/model/demand-authority.ts`
- `src/contracts/schemas/governance/demand/demand-authority.schema.json`

Mandatory Demand Authority冻结Identity semantic digest、1～32个Ledger Member References和
测试决定。Demand type决定最低role closure；real-environment必须唯一指向一个已列入
authorityRefs的test-environment member；isolated placement必须由同一完整Confirmation
reference授权。Ledger Store admission进一步证明同Program、同Demand和exact member bytes。

已实施修正：

- 将Reference的“物理成员唯一键”与“完整引用相等”分开：Authority同一member location
  只能出现一次，isolated authorization则逐字段比较record/member digests、role、media type
  与全部refs；过期或伪造digest不能被另一条同路径引用替代；
- Creator先逐项解析一次draft references再按location key排序，不在sort comparator中重复
  解析；Reference错误只转换已知Ledger Store错误；
- parseReferences用真实非空tuple构造替代强制断言；admission loop删除不可能产生Ledger
  异常的catch分支；
- Authority artifact/version零consumer constants私有化，renderer/digest删除JsonValue断言；
- 新增isolated Identity stale member digest被Authority拒绝的回归。

验证结果：

```text
Identity/Authority + Root/Repository/Publication consumers: 14 pass / 0 fail / 0 skip / 13.01905225s
```

## 134. DEMAND-003

### 134.1 目标文件与结论

- `src/governance/demand/model/demand-aggregate-state.ts`
- `src/contracts/schemas/governance/demand/demand-aggregate-state.schema.json`

Aggregate State只保存domain event reducer拥有的最小业务状态，不保存stream revision、event
tail、Identity/Authority摘要、更新时间或空业务区段。当前真实事件只有Demand publication与
cancellation，因此合法状态只有`active / cancelled`。

已实施修正：

- 从State v1 Schema、生成类型和`DemandLifecycle`删除没有completion event、Decider或
  transition producer的`completed`；磁盘手工注入不能成为有效Aggregate authority；
- completion以后必须随真实事件、codec、Decider、reducer与consumer垂直加入，不能提前
  只扩枚举；
- Aggregate artifact/version零consumer constants私有化；semantic digest删除JsonValue
  断言；
- 新增completed与未实现Tasking占位均被Schema拒绝的测试。

验证结果：

```text
Aggregate/Decider/Command/Commit/Snapshot/Repository/File Store: 15 pass / 0 fail / 0 skip / 1.806512875s
Schema/codegen: build pass / 34 schemas / 65 external refs / sha256:d24da312d046b71cd180f14bf2266820496063898c6d89dfe3a082564c738a1a
```

## 135. DEMAND-004

### 135.1 目标文件与结论

- `src/governance/demand/event-sourcing/demand-event-stream-position.ts`
- `src/governance/demand/event-sourcing/demand-event-sourcing-paths.ts`

Position统一拥有逻辑`streamRevision`与物理`commitSequence`两个正安全整数品牌；Paths
拥有固定16位Commit/Snapshot文件名、逐尝试Append Candidate地址及Demand根内固定refs。
候选地址中的typed Commit ID和`pid-threadId-uuid`只用于保守判断候选owner，不进入
domain event或权威Commit identity。

已实施修正：

- `DemandEventCommitSequence`及parser从Aggregate下沉到Position，Paths/Store/Catalog/
  Snapshot不再为物理位置反向依赖聚合重建模块；Aggregate把Position错误映射回自己的
  cursor错误面；
- Commit filename format/parse从Commit领域codec移动到Paths，消除Paths→Commit高层依赖；
- Position error区分`stream-revision / commit-sequence`，不再用一个含糊revision reason；
- Candidate ref builder重新验证sequence、typed Commit ID及owner token安全整数/UUID，
  不能生成自身parser拒绝的超大PID路径；
- 新增稳定`DemandEventSourcingPathError`；Snapshot Store、Root Inventory与File Store
  Reader只映射该已知路径错误，不再catch-all隐藏未知异常；
- 新增position、Commit filename及Candidate round-trip/invalid owner测试。

验证结果：

```text
Position/Paths + Commit/Store/Snapshot/Inventory/Catalog: 15 pass / 0 fail / 0 skip / 1.668678042s
Architecture: pass / 424 modules / 2606 dependencies
git diff --check: pass
```

## 136. DEMAND-005

### 136.1 目标文件与结论

- `src/governance/demand/event-sourcing/demand-event-sourcing-event.ts`
- `src/governance/demand/event-sourcing/demand-event-sourcing-event-version-codec.ts`
- Published/Cancelled event data v1 Schemas

Uncommitted Event只描述已经发生的业务事实：typed event/demand ID、recordedAt、eventType
与closed data；不包含eventVersion、streamRevision、commitSequence、previous commit或
resulting state。每个event family拥有独立Version Evolution Registry和v1 payload Schema，
Current Writer只写当前版本，Reader按eventType+eventVersion显式演进后再进入domain parser。

审阅结论：

- 当前只有`publication.demand-published`与`lifecycle.demand-cancelled`两个真实producer，
  没有未来事件占位；
- Published事件只绑定Identity/Authority refs与semantic digests；Cancellation只保存有界、
  NFC、无危险控制字符的原因；
- 两个Registry而非动态handler registry适合当前规模，新增事件时仍需显式codec/Schema/
  reducer consumer；
- Current event type guard与两个仅作为函数返回细节的type exports收回模块内部；
- Encoder用JsonObject type guard重新准入Registry输出，删除强制JsonObject断言。

验证结果：

```text
Event/Codec/Upcaster/Decider/Commit/Command/Version Evolution: 6 pass / 0 fail / 0 skip / 0.779707334s
```

## 137. DEMAND-006

### 137.1 目标文件与结论

- `src/governance/demand/event-sourcing/demand-event-sourcing-state-version.ts`
- `src/governance/demand/event-sourcing/demand-event-sourcing-version-compatibility.ts`

State Model Version独立于event payload version：每个Stored Event声明生成
`resultingStateDigest`所用的状态模型版本；Snapshot compatibility digest则绑定全部event
family的current/supported versions及state model current/supported versions。矩阵变化只让
旧Snapshot失效并回退完整重放，不改写Event authority。

已实施修正：

- Event codec新增唯一、词法排序的`DEMAND_EVENT_SOURCING_EVENT_TYPES` tuple；Current
  Version Map与Supported Version Map使用`Record`完整性检查；
- Compatibility digest从该tuple派生，不再手写第二份event family列表，新增事件无法遗漏
  Snapshot兼容矩阵；
- Compatibility digest删除JsonValue断言；当前state v1与历史支持断言保持独立；
- 测试固定当前两个真实event families及state/event版本分离。

验证结果：

```text
State Version/Compatibility/Snapshot/Upcaster/Repository: 5 pass / 0 fail / 0 skip / 0.90619325s
```

## 138. DEMAND-007

### 138.1 目标文件与结论

- `src/governance/demand/event-sourcing/demand-event-sourcing-persisted-event-envelope.ts`
- `src/governance/demand/event-sourcing/demand-event-sourcing-upcaster.ts`

Persisted Envelope只准入跨版本稳定字段、原始JSONObject data和历史resulting state
metadata；词法合法的未知eventType/version在此层仍成立。Upcaster随后按family Registry
执行codec/upcast并投影为当前Uncommitted Event，未知类型/版本在Reducer前稳定拒绝。

已实施修正：

- 保留Envelope与Upcaster分层，不把Envelope收紧成只能读取当前版本的codec；
- Envelope使用JsonObject type guard准入data，renderer/digest删除JsonValue断言；
- streamRevision只将已知Position错误映射Envelope revision，未知异常继续上卷；
- 删除Upcaster对Current Event Versions的零consumer转发导出；
- 新增非法streamRevision经Upcaster稳定映射input的测试。

验证结果：

```text
Envelope/Upcaster/Commit/Snapshot/Repository/Version Evolution: 6 pass / 0 fail / 0 skip / 1.146902458s
```

## 139. DEMAND-008

### 139.1 目标文件与结论

- `src/governance/demand/event-sourcing/demand-event-sourcing-stored-event.ts`
- `src/contracts/schemas/governance/demand/demand-event-sourcing-stored-event.schema.json`

Stored Event是Event Store/Commit使用的稳定门面：Reader只解析跨版本Envelope；当前Writer
把已验证Uncommitted Event、分配后的streamRevision和Reducer生成的resulting state编码为
最新event version，并写入current state model version/digest。它不负责选择previous state
或分配Commit槽位。

已实施修正：

- 删除零consumer的Stored Event artifact/version转发导出；门面内部继续复用Envelope常量；
- 删除无人调用、与Upcaster完全重复的`toDemandUncommittedEvent`别名；
- 当前Writer只映射已知Position错误，unknown异常继续上卷；renderer删除JsonValue断言；
- Envelope/Stored Event双层错误面继续保留：前者服务版本路由，后者服务Commit/Store。

验证结果：

```text
Stored Event/Upcaster/Commit/Repository/File Store: 11 pass / 0 fail / 0 skip / 1.374979833s
```

## 140. DEMAND-009

### 140.1 目标文件与结论

- `src/governance/demand/event-sourcing/demand-event-stream-commit.ts`
- `src/contracts/schemas/governance/demand/demand-event-stream-commit.schema.json`

Event Stream Commit是一条命令产生的1～64个连续Stored Events的immutable batch。
`commitSequence`固定不替换物理槽位，expected/first/last stream revisions绑定逻辑位置，
previousCommitDigest形成提交链。Prepared Commit是WeakSet签发的进程内能力，并携带写入前
physical tail state expectation；磁盘JSON不能自行获得append权限。

已实施修正：

- Commit artifact/version/max-events零consumer constants私有化；events使用真实非空tuple
  构造，renderer/digest删除JsonValue断言；
- Commit parser统一把Position错误映射自己的position错误面，并在revision加法前检查
  safe-integer剩余空间；
- Prepare在运行Reducer和生成Stored Events前验证同一Demand、eventId唯一，以及
  commit/revision不会溢出；非法批次不再先执行部分纯状态演进；
- Prepared capability、全量apply replay、event/state version支持检查与resulting state
  digest逐事件验证保持；
- 新增重复eventId在Prepare前置关系门被拒绝的测试。

验证结果：

```text
Commit/Command/File Store/Snapshot/Repository/Publication Transaction: 13 pass / 0 fail / 0 skip / 1.769861125s
```

## 141. DEMAND-010

### 141.1 目标文件与结论

- `src/governance/demand/event-sourcing/demand-event-sourcing-aggregate.ts`
- `src/governance/demand/event-sourcing/demand-event-sourcing-decider.ts`

Aggregate是一次重建结果，只保存Demand ID、commit/stream cursor、last commit/event
digests、last Stored Event与current reducer state/digest；完整历史仍归Event Store。Decider
把closed transient Command变成未提交业务事件，Reducer把一个当前事件确定性应用到状态；
两者均不读取Clock、文件、Ledger或网络，也不分配持久位置。

审阅结论与修正：

- Aggregate复验tail event/schema/version、cursor、Demand identity和event/state semantic
  digests，不能单凭调用方对象成为重建结果；无完整Commit内容时不伪造previous history验证；
- Decider当前只拥有publish与cancel两条真实transition，无complete/Task等占位；
- Command先做一次passive exact snapshot，variant检查复用该快照，不再重复parsePlainRecord；
- 单事件结果使用显式tuple constructor替代强制断言；Command digest删除JsonValue断言；
- publication/cancel identity与state transition关系保持由同一Reducer在Prepare与Replay两次验证。

验证结果：

```text
Aggregate/Decider/Command/Commit/Snapshot/Repository/Publication: 7 pass / 0 fail / 0 skip / 1.253981417s
```

## 142. DEMAND-011

### 142.1 目标文件与结论

- `src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.ts`

Command Handler固定执行`parse command → load current → optimistic check/idempotency lookup →
decide → prepare → append`。Repository只提供持久化端口，业务准入仍完全归Decider；同一
commitId重试只在stale expected revision时执行有界历史查找，普通新命令不全流扫描。

已实施修正：

- `expectedStreamRevision`改为必填；全部真实consumer本就提供该CAS，省略时无法正确区分
  新命令与同commitId重试；
- Options runtime同样要求expected field，拒绝Proxy AbortSignal，并在命令完整准入后、
  Repository首次I/O前响应pre-abort；
- 同commitId只有同时匹配command digest与原expected revision才返回idempotent；其他
  stale情况保持concurrency/idempotency conflict；
- 删除无任何producer的`operation-failure`错误原因；
- 新增缺失expected revision在零Store effect前失败的测试。

验证结果：

```text
Command Handler + Version Evolution/Publication consumers: 8 pass / 0 fail / 0 skip / 13.512940541s
```

## 143. DEMAND-012

### 143.1 目标文件与结论

- `src/governance/demand/event-sourcing/demand-event-sourcing-snapshot.ts`
- `src/contracts/schemas/governance/demand/demand-event-sourcing-snapshot.schema.json`

Snapshot是某一完整Commit boundary的immutable、可删除checkpoint：绑定兼容矩阵摘要、
Demand/cursor、last Commit/Event digests与current state/digest。Restore必须取得指定Anchor
Commit并逐项复验；损坏或不兼容Snapshot只影响Repository优化选择，不修改Event authority。

已实施修正：

- 删除`aggregateVersion`：Snapshot已有wire `schemaVersion`，state/event current+supported
  versions又完整进入`versionCompatibilityDigest`，该字段没有第三种独立演进职责；
- 删除只有测试调用、与Commit filename formatter完全重复的Snapshot filename别名；
- Snapshot parser窄映射Position错误，并新增自身可证明的
  `commitSequence <= streamRevision`关系；
- Snapshot artifact/version/aggregate-version零consumer constants私有化或删除，renderer/
  digest删除JsonValue断言；
- Schema/生成类型同步，未保留旧字段兼容分支。

验证结果：

```text
Snapshot/Repository/Version Evolution/File Store/Publication: 16 pass / 0 fail / 0 skip / 13.284239417s
Schema/codegen: build pass / 34 schemas / 65 external refs / sha256:1875f6141b75f8316551d2d37c172cc39a6fae857b8003054c1003395458ed43
```

## 144. DEMAND-013

### 144.1 目标文件与结论

- `src/governance/demand/event-sourcing/demand-file-event-store-contract.ts`
- `src/governance/demand/event-sourcing/demand-file-event-store-reader.ts`

Reader稳定观察0700/0600 Commit目录：先读取有界排序inventory，再以固定并发读取每个
deterministic Commit，复验目录未漂移、commitSequence连续、Demand一致、previous digest
chain及全历史commit/event ID唯一。Snapshot tail读取包含并验证anchor Commit，再返回其后
commits；Append admission仍完整扫描最多64 MiB前缀以验证身份与physical state provenance。

已实施修正：

- 私有目录/文件node policy新增current-user ownership，不能仅凭0700/0600 mode接受其他
  用户节点；
- Cursor的streamRevision改为品牌类型，parse统一使用Position primitive；Commit-at和
  Cursor非法位置映射Store input，不泄漏底层Position错误；
- 重复的全流/tail Promise读取合并为8项有界helper，使用`Promise.allSettled`按输入顺序
  决定首个错误；
- `DemandFileEventStoreOptions`收回模块内部；exact deterministic Commit比较删除重复的
  ID/digest计算，只比较唯一renderer bytes；
- 新增非法Cursor revision测试。

验证结果：

```text
File Store/Reader + Command/Repository/Version Evolution: 10 pass / 0 fail / 0 skip / 1.629617625s
```

## 145. DEMAND-014

### 145.1 目标文件与结论

- `src/governance/demand/event-sourcing/demand-file-event-store.ts`

File Event Store class只持有一个Demand RootedDirectory。Append在完整前缀准入后创建
single-link private candidate，以no-replace hard link把同一inode发布到固定Commit槽位；
Foundation link已同步inode与目标父目录，随后exact retire candidate并回读Commit。
Recovery只清理inactive owner：single-link候选回滚，double-link residue先验证same inode/
Commit并结算耐久性，active或unknown owner保持现场。

已实施修正：

- Dynamic Commit Resource Declaration在真实append入口执行`exclusive-create`recipe
  admission，Demand Catalog不再只有测试consumer；
- Append receipt删除永远固定为`retired`的`candidateStatus`；成功返回本身已保证候选退休，
  失败通过cleanup/recovery错误表达；
- private目录注释修正为实际四个owner目录；Candidate filename只映射稳定Path错误；
- exact candidate retirement在Signal取消时返回`aborted`，不再误报cleanup-required；
- hard-link CAS、post-commit忽略迟到取消、destination race幂等判定及active/unknown owner保护
  保持不变。

验证结果：

```text
File Store/Command/Repository/Version Evolution/Catalog: 13 pass / 0 fail / 0 skip / 1.643834833s
Architecture: pass / 424 modules / 2604 dependencies
```

## 146. DEMAND-015

### 146.1 目标文件与结论

- `src/governance/demand/event-sourcing/demand-file-event-snapshot-store.ts`

Snapshot Store在固定sequence槽位执行0600 no-replace原子发布；读取时稳定观察完整目录，
按4项并发解析Snapshot。合法Snapshot进入Repository候选；容量/UTF-8/JSON/domain损坏只标记
invalid供更早Snapshot或full replay回退；未知名称、symlink、权限/owner漂移及inventory变化
仍失败关闭。正常读取不修复、覆盖或删除Snapshot。

已实施修正：

- 将三份重复options检查合并为passive parser，拒绝accessor/Proxy Signal，并在I/O前完成
  input/cancellation准入；
- private Snapshot目录/文件新增current-user ownership policy；
- 并发读取改为`Promise.allSettled`按目录顺序决定失败；
- 4 MiB读取预算同步成为发布前硬上限，不能写出自身Reader只会判invalid的Snapshot；
- Dynamic Snapshot Resource Declaration在真实publish入口执行`exclusive-create`admission；
- Atomic write区分capacity/root-scope/post-commit recovery-required与pre-commit operation
  failure，不再将所有非target-exists错误压平；
- 两个只在模块内使用的Snapshot file/byte预算常量私有化。

验证结果：

```text
Snapshot Store/Repository/Command/Version Evolution/Catalog/Publication: 13 pass / 0 fail / 0 skip / 10.2727315s
Architecture: pass / 424 modules / 2607 dependencies
```

## 147. DEMAND-016

### 147.1 目标文件与结论

- `src/governance/demand/event-sourcing/demand-event-sourcing-root-inventory.ts`
- `src/governance/demand/event-sourcing/demand-event-sourcing-root-authority.ts`

Root Inventory证明当前技术阶段Demand根的exact namespace：Identity/Authority、Event
Sourcing三目录、空Artifacts、健康时空Transactions/Append Candidates；publication phase
只额外允许一个`transactions/publication.json`。Root Authority在该结构上稳定读取
Identity/Authority、解析Ledger closure、Repository重建Aggregate并验证revision-1
publication事件绑定exact Identity/Authority digests。

已实施修正：

- empty Candidates/Artifacts/Transactions不再以`maximumEntries: 0`读取并误报capacity；
  改为最多观察1项后显式返回tree-shape；
- 每个子目录读取绑定上层刚观察到的expected node，最终Root复验再比较Event Sourcing/
  Artifacts/Transactions节点，计数与返回节点属于同一稳定观察窗口；
- private root/files/directories新增current-user ownership；五个固定子目录顺序读取，失败
  顺序确定且无需无界并发；
- Inventory与Root Authority options改为passive parser，拒绝accessor/Proxy Signal；
- revision-1闭包新增`first/last revision=1 + exactly one publication event`，不能把publish+
  cancel同批伪装成初始发布；
- Repository/File Store/final Inventory取消均保持aborted，不降级为stream/inventory；删除
  无producer的Root Authority operation-failure；
- `admitDemandAuthority`补充Signal并传入Ledger batch resolution，Authority/Root/Publication
  全链保留取消语义；
- 新增Candidate residue稳定归类tree-shape及Authority admission pre-abort测试。

验证结果：

```text
Root Inventory/Authority + Ledger/Demand/Publication consumers: 13 pass / 0 fail / 0 skip / 9.368428s
```

## 148. DEMAND-017

### 148.1 目标文件与结论

- `src/governance/demand/event-sourcing/demand-event-sourcing-repository.ts`

Repository组合Event Store与Snapshot Store：normal load从最新可恢复Snapshot尝试tail replay，
逐个回退后再full replay；audit始终从Commit 1完整读取和Reducer重放。历史Commit损坏可能被
更新Snapshot优化路径暂时遮蔽，这是显式设计，audit才是完整authority验证；normal load
不修复、不删除或重写Snapshot。

已实施修正：

- 构造器从接收两个无法证明同根的Store对象改为接收唯一RootedDirectory，并在内部构造
  Event/Snapshot Store；不能再组合Demand A事件与Demand B快照；
- options使用passive parser，拒绝accessor与Proxy Signal；
- `findCommitById`从unknown重新解析typed Commit ID，非法输入不触发全历史扫描；
- 删除`appendPreparedCommit`无作用的catch/rethrow；其余Store稳定错误继续由Command
  Handler映射；
- 新增跨层Store对象不能冒充Repository root的runtime测试。

验证结果：

```text
Repository/Command/Version Evolution/Publication: 9 pass / 0 fail / 0 skip / 9.264606834s
Architecture: pass / 424 modules / 2608 dependencies
```

## 149. DEMAND-018

### 149.1 目标文件与结论

- `src/governance/demand/demand-resource-catalog.ts`

Static Catalog只登记Workspace级Demand publication四个0700容器。Typed Demand Catalog
为一个具体Demand生成exact root、Identity/Authority facts、Event Sourcing/Artifacts/
Transactions目录及publication marker/transaction/lock；operation stage、append candidate与
Foundation atomic stage都不作为长期资源。Commit与Snapshot按branded sequence单独声明，
分别保持immutable fact与derived checkpoint角色。

已实施修正：

- Commit/Snapshot声明已分别进入File Event Store和Snapshot Store真实
  `exclusive-create`effect admission；
- 四个只用于组成Static Catalog的声明常量和只用于函数签名的12项tuple type收回模块
  内部；Snapshot sequence删除冗余显式类型；
- 完整Demand Catalog保留，等待紧邻Publication单元接入root publish、Intent/Lock与
  marker retirement；在接入前不把测试目录称为完整runtime能力；
- Matrix、Commit/Snapshot recipe与typed ID/sequence失败回归保持。

验证结果：

```text
Demand Catalog/File Store/Snapshot/Static Matrix: 14 pass / 0 fail / 0 skip / 0.914610291s
Architecture: pass / 424 modules / 2608 dependencies
git diff --check: pass
```

## 150. DEMAND-019

### 150.1 目标文件与结论

- `src/governance/demand/publication/demand-publication-paths.ts`
- `src/governance/demand/publication/demand-event-sourcing-publication-contract.ts`

Paths从typed Demand ID唯一派生final root、operation stage、Workspace sidecar、逐Demand
lock及final root内publication marker。Contract定义跨TODO/Demand/Ledger发布的稳定结果、
stored sidecar source和脱敏错误词汇；不引入第二业务状态机。

已实施修正：

- 删除Paths和Service对Active Current root的零consumer转发导出；调用方应从真正owner
  `workspace/active`导入；
- 删除无人调用、可由stage root＋marker常量直接表达的stage marker helper；
- Publication Result的`created`改为`wroteDemandRoot`并由Service记录本次是否实际跨越
  final directory publish；sidecar-only recovery为true，final root已存在的marker/TODO前向
  恢复与纯idempotent load均为false；
- 固定0700/0600与10秒逐Demand lock预算继续由Publication storage/service消费。

验证结果：

```text
Publication Service + Demand Catalog: 9 pass / 0 fail / 0 skip / 9.608577083s
Architecture: pass / 424 modules / 2608 dependencies
git diff --check: pass
```

## 151. DEMAND-020

### 151.1 目标文件与结论

- `src/governance/demand/publication/demand-event-sourcing-publication-transaction.ts`
- `src/contracts/schemas/governance/demand/demand-event-sourcing-publication-transaction.schema.json`

Publication Transaction是跨Workspace TODO、Demand root与Ledger admission的immutable、
无mutable phase恢复计划。它保存完整Identity/Authority、TODO collection/state CAS、exact
stage/final refs、initial transient Command和由同一Reducer得到的initial Commit及摘要；
Snapshot可重建，不进入事务authority。派生字段在每次parse时全部重算，作为plan drift和
关系篡改检测，不是第二业务状态。

已实施修正：

- Commit模块拆出`planDemandEventStreamCommit`纯计划入口；它完整运行Reducer/Commit
  validation但不登记WeakSet append capability；只有Command Handler调用Prepare签发；
- Transaction parse/create改用纯计划，解析磁盘Intent不再产生不可达但真实的写能力；
- expected TODO digests在Command/Commit计划前准入；
- Transaction artifact/version零consumer constants私有化，renderer/digest删除JsonValue
  断言；
- 新增未签发Commit计划无法通过Event Store prepared capability检查的测试。

验证结果：

```text
Transaction/Commit/Command/Publication/File Store: 17 pass / 0 fail / 0 skip / 9.495863459s
```

## 152. DEMAND-021

### 152.1 目标文件与结论

- `src/governance/demand/publication/demand-event-sourcing-publication-storage.ts`
- `src/governance/demand/publication/demand-event-sourcing-publication-stage.ts`

Storage拥有Workspace publication四目录、0600 sidecar/marker、exact retire与安全打开子
Root；Stage在0700 operation root内建立Identity/Authority、Event Store、publication marker
和revision-1 Commit/Snapshot，验证publication-phase root inventory后以同Root durable rename
整体发布。Final loader重新执行Root Authority＋Ledger closure并比对Transaction digests。

已实施修正：

- write helper在任何effect前编码并执行caller byte budget；Atomic create准确区分capacity、
  root-scope、post-commit recovery-required与pre-commit failure；
- private file/directory新增current-user ownership；打开stage/final子Root时绑定调用方刚观察
  的inode identity，失败路径可靠关闭未交付句柄；
- Static publication directories在实际materialization执行Catalog admission；Dynamic Demand
  Catalog在Workspace sidecar create/retire、final marker retire及exact root publish执行真实
  recipe admission；
- 显式sidecar stage恢复改为Foundation MatchingTargets，只处理当前Demand，其他Demand
  stage保持原样且不阻断；
- Transaction exact equality改用唯一deterministic bytes；physical path使用Foundation
  splitter，不自行解释路径；
- Stage/Final Root close采用primary-error优先；Snapshot/Repository/Command/Inventory取消保持
  aborted；rename commit-uncertain/durability/close返回recovery-required；
- 初始化逐目录回验最终node policy；exact unlink取消不再误报recovery；
- 新增其他Demand partial sidecar stage在本Demand recovery后仍存在的隔离测试。

验证结果：

```text
Publication/Command/Inventory/Catalog: 11 pass / 0 fail / 0 skip / 9.164936459s
Architecture: pass / 424 modules / 2611 dependencies
```

## 153. DEMAND-022

### 153.1 目标文件与结论

- `src/governance/demand/publication/demand-event-sourcing-publication-service.ts`
- `src/governance/demand/publication/demand-event-sourcing-publication-todo.ts`

Service按`Authority resolve + strict TODO preflight → publication storage → per-Demand Lock →
immutable sidecar → staged Demand root → durable root rename → exact TODO claim → marker retire →
final Root Authority load → sidecar retire`前向提交。Sidecar是恢复授权，Marker阻断未闭合
Demand的normal load；纯Event append不使用该跨资源锁。TODO bridge只验证exact Intake/
State CAS与Demand mount，不选择TODO。

已实施修正：

- `inspectTodoForDemandPublication`恢复为严格只读；正常publish遇到TODO Journal只返回
  recovery-required，sidecar前不产生业务写入；只有sidecar已存在的apply/recover调用显式
  `recoverTodoForDemandPublication`；
- TODO recovery catch只转换已知Service错误并保持aborted/recovery-required；claim同样保留
  TODO recovery-required而非压成generic conflict；
- Publication options拒绝Proxy Signal；Lock residue retirement在读回exact sidecar后且两次
  检查取消，再执行Foundation exact observation retirement；
- 无Publication transactions root的recovery直接not-found且零初始化effect；存在目标父目录
  后只恢复当前sidecar target，读到完整Intent才允许补齐其他静态目录与Lock；
- Publication Result已在DEMAND-019使用`wroteDemandRoot`精确区分root commit；
- 新增正常preflight不恢复TODO residue、无恢复证据零目录写入、foreign sidecar stage隔离与
  已发布root恢复返回false测试。

验证结果：

```text
Publication/TODO/Transaction/Inventory/Catalog: 25 pass / 0 fail / 0 skip / 12.510335792s
Architecture: pass / 424 modules / 2611 dependencies
```

## 154. Demand system gate（已关闭）

Demand Event Sourcing技术闭包：

```text
immutable Identity + Ledger-resolved Mandatory Authority + TODO Intake Lineage
→ transient Command
→ pure Decider emits Uncommitted Event
→ per-family version codec writes Stored Event Envelope
→ one-command immutable Commit batch + digest chain
→ private candidate + no-replace durable hard-link append
→ Reducer replay builds minimal Aggregate State
→ optional compatible immutable Snapshot + tail replay
→ explicit full audit from Commit 1
→ sidecar-authorized root-first Publication + exact TODO claim
```

架构结论：

- Event Sourcing只用于Demand Aggregate，不扩散到TODO、Config、Maintenance或Ledger；
- 当前唯一业务事件为publish/cancel，状态仅active/cancelled；Tasking、Delivery、Result、
  Test、Review、Evidence、Pod、Complete和Archive字段/事件均不存在；
- Event Commit是authority，Snapshot仅是可删除优化；normal load可使用Snapshot遮蔽旧前缀
  读取成本，完整历史完整性由显式audit负责，这一差异已有真实损坏回归测试；
- File Store只使用Node/Foundation本地文件能力：固定槽位、hard-link CAS、bounded full-prefix
  admission、candidate owner recovery；没有SQLite、通用repository adapter或全局锁；
- 跨TODO/Demand/Ledger首次发布使用单一self-contained sidecar、per-Demand lock、root-first
  marker和forward recovery；纯后续Event append不使用该跨资源事务；
- Dynamic Demand/Commit/Snapshot Catalog均已进入真实effect admission；stage/candidate不登记为
  长期资源；
- 当前完成的是技术骨干与publish/cancel垂直切片，不宣称完整Demand业务。后续业务必须以
  新Event＋Command＋Reducer＋Artifact consumer垂直加入，不能复刻旧大state对象。

验证结果：

```text
Demand subsystem + Ledger/TODO adjacent consumers: 56 pass / 0 fail / 0 skip / 13.562046166s
TypeScript typecheck: pass
Architecture: pass / 424 modules / 2611 dependencies
Schema/codegen: pass / 34 schemas / 65 external refs / sha256:1875f6141b75f8316551d2d37c172cc39a6fae857b8003054c1003395458ed43
git diff --check: pass
```

## 155. WINDOW-001

### 155.1 目标文件与结论

- `src/workspace/window-runtime/wakeflow-window-host-binding-id.ts`
- `src/workspace/window-runtime/wakeflow-window-runtime-paths.ts`

Durable `window_<uuid>`是Config/业务中的稳定Window身份；`window_binding_<uuid>`只是一次
host-local路由Binding的可替换代际ID，因此不进入durable ID kind Schema。Paths从严格Host
Profile与durable windowId派生host identity binding、共享mutation lock及redacted runtime
projection refs；不接受display name、raw handle或绝对路径。

已实施修正：

- Binding ID prefix零consumer constant私有化；随机UUIDv4创建、严格parse与factory错误分类
  保持；
- 路径函数从含糊`wakeflowWindowBinding*`改为
  `wakeflowWindowHostBindingRootRef/Ref`，明确属于Host Binding而非已删除的Owner–Resource
  Capability Binding概念；
- 所有Store、Registration、Projection、Catalog和Fresh Publication consumer机械同步；
  物理`window-bindings/<windowId>.json`路径未变化，无兼容分支。

验证结果：

```text
Binding/Fresh/Registered/Unregistered Projection + Static Matrix: 11 pass / 0 fail / 0 skip / 1.01699375s
TypeScript/Architecture: pass / 424 modules / 2611 dependencies
```

## 156. WINDOW-002

### 156.1 目标文件与结论

- `src/workspace/window-runtime/wakeflow-window-host-identity-profile.ts`

Host Identity Profile只声明host ID、opaque handle kind、长度上限与必须拒绝的placeholder
文本；Handle parser只做passive shape、NFC、trim、control、kind/length/reserved准入。
Wakeflow不解释UUID/thread/session/tmux格式，也不因此取得创建、读取、发送、归档或关闭
宿主窗口的能力。

已实施修正：

- Profile kind与两个hard-capacity零consumer constants私有化；
- `reservedHandleValues`作为语义集合现在必须按lowercase code-unit严格唯一升序，不自动
  normalize；顺序不再造成无意义Authority digest漂移；
- placeholder比较从locale-sensitive lowercasing改为确定性的`toLowerCase()`；
- 新增unsorted reserved profile拒绝测试。

## 157. WINDOW-003

### 157.1 目标文件与结论

- `src/hosts/codex/codex-window-host-identity-profile.ts`
- `src/hosts/claude-code/claude-code-window-host-identity-profile.ts`

Codex只声明`codex-thread`，Claude Code只声明`claude-session`；两者最大opaque value均为
1024字符，reserved集合包含当前/未知/模板占位，Claude额外拒绝误传的Codex占位。
它们是静态纯数据，不包含SDK client、宿主callback、tmux/git/node命令或ID正则猜测。

已实施修正：仅按WINDOW-002合同把两个reserved集合改为code-unit顺序；没有改变集合、
handle kind或容量，也没有新增宿主能力。

验证结果：

```text
Neutral/dual-host Identity + Binding/Projection/Maintenance consumers: 10 pass / 0 fail / 0 skip / 1.854628625s
Architecture: pass / 424 modules / 2611 dependencies
git diff --check: pass
```

## 158. WINDOW-004

### 158.1 目标文件与结论

- `src/workspace/window-runtime/wakeflow-window-runtime-desired-topology.ts`
- `src/workspace/window-runtime/wakeflow-window-launch-intent.ts`

Desired Topology只保存Config派生的稳定逻辑窗口、role、root identity/placement与host ID，
排除display/handle/runtime readiness。Launch Intent在此基础上增加displayTitle、Host Profile
digest、`create-window`非授权提示与后续Binding registration指针；仍不包含raw handle、宿主
工具名、tmux locator、project数据库ID或ready状态，也不执行host effect。

已实施修正：

- 两个compiler各自只建立一次Config indexes，不再为每个窗口find/重建索引；1024静态窗口
  上限由Desired Topology导出并由Launch独立执行；
- Desired kind/version零consumer constants私有化，Topology/Window/Launch/Set digests删除
  JsonValue断言；Profile digest同样直接使用已验证数据；
- Launch registration子对象删除与上层重复的windowId/hostId；Agent从同一Intent顶层和host
  字段取得，不形成可漂移副本；
- 现有create authorization、rawHandleSource和identityAuthority保持，明确Preview不授权宿主
  创建且真实handle只能来自Host create result；
- 新增registration无重复identity字段测试。

验证结果：

```text
Topology/Launch/Fresh/Projection/Maintenance/Entrypoint consumers: 20 pass / 0 fail / 0 skip / 10.284756166s
Architecture: pass / 424 modules / 2610 dependencies
git diff --check: pass
```

## 159. WINDOW-005

### 159.1 目标文件与结论

- `src/workspace/window-runtime/wakeflow-window-runtime-fresh-authority.ts`
- `src/workspace/window-runtime/wakeflow-window-runtime-resource-catalog.ts`

Fresh Authority绑定共享host-profiles root、当前host runtime/identity/projections、空
window-bindings namespace、window-runtime projection root、每个静态窗口的0600 derived
projection声明与完整unregistered projection set。它是纯目标，不观察文件系统、不创建
Binding，也不授权真实handle注册。

已实施修正：

- Projection编译错误新增稳定`projection`分类，不再从Authority compiler泄漏相邻模块错误；
- Projection declarations除数量外，逐项验证
  `hostId+windowId declarationId ↔ exact resourceRef`关系；
- Authority digest删除JsonValue断言；layout/projection declarations与projection-set digest
  继续共同进入目标摘要；
- Resource Catalog仍由unregistered projection set唯一派生，已被Fresh Publication和后续
  Binding Registration真实recipe admission消费。

验证结果：

```text
Fresh Authority/Publication/Projection/Binding/Maintenance consumers: 15 pass / 0 fail / 0 skip / 2.57462175s
Architecture: pass / 424 modules / 2609 dependencies
git diff --check: pass
```

## 160. WINDOW-006

### 160.1 目标文件与结论

- `src/workspace/window-runtime/wakeflow-window-runtime-fresh-publication.ts`

Fresh Publication普通执行要求当前host runtime前缀strict absent；Maintenance affected-step
recovery只接受当前用户0700 exact目录、空Binding namespace、expected 0600 unregistered
projections及其Foundation stages。未知目录项、foreign Binding/projection、字节/digest漂移
均保持现场并失败。

已实施修正：

- Authority全部layout declarations在目录effect前执行`materialize-directory`admission，全部
  projection declarations执行`deterministic-rewrite`admission；
- Projection document先编码并执行512 KiB预算，Atomic create准确区分capacity、
  root-scope、post-commit recovery-required与pre-commit failure；
- 新增`capacity/recovery-required`稳定错误原因；
- 创建/恢复投影后再次验证Binding root仍为空且inode未替换，并逐一复验六个layout目录
  仍是原始identity/current-user private directory；
- observation projection digest不再允许不可达null fallback；observation digest删除
  JsonValue断言；
- Foundation target-stage exact recovery、strict-absent竞态与foreign namespace拒绝保持。

验证结果：

```text
Fresh/Unregistered/Step Executor: 8 pass；Maintenance affected-step recovery: 1 pass
Architecture: pass / 424 modules / 2609 dependencies
git diff --check: pass
```

## 161. WINDOW-007

### 161.1 目标文件与结论

- `src/workspace/window-runtime/wakeflow-window-runtime-unregistered-identity-source.ts`
- `src/workspace/window-runtime/wakeflow-window-runtime-unregistered-projection.ts`
- 相邻合同：`window-runtime-unregistered-projection.schema.json`

Unregistered Projection是Desired Topology在“尚无当前窗口Binding”阶段的可重建派生视图；
它不是Binding inventory，也不能证明物理命名空间为空。原Identity Source没有接收目录
snapshot或owner observation，却写入`inventoryStatus: empty`，随后重复编译同一Topology并
执行必然成立的内部互证。其唯一consumer只是Projection compiler，`identitySourceDigest`
也在Registered Projection中立即消失，因此这层不是独立authority或真实source。

权威边界现统一为：

```text
Config + Host Profile
→ Desired Topology                         逻辑期望
→ Unregistered Projection                 可重建派生状态

RootedDirectory + exact empty inventory
→ Fresh Publication                       物理空目录证明与写入effect
```

已实施修正：

- 删除单consumer `wakeflow-window-runtime-unregistered-identity-source.ts`；不保留兼容层；
- Projection与Projection Set删除`identitySourceDigest`、`identityRootRef`和
  `inventoryStatus`语义，直接从单次Desired Topology结果派生；
- Projection root只编译一次，每窗口resource ref从该已验证根追加typed windowId，避免
  每条entry重复解析Host Profile；删除一次重复领域parser调用和零consumer Set kind export；
- Desired Topology失败统一映射为Projection稳定source错误；
- JSON Schema按Draft 2020-12 `if/then`关闭
  `controller→program/.`、`design|test→support-surface`、`product→repository`判别关系；
  顶层programId与logical root ID相等这类JSON Schema不能直接表达的关系仍由TS parser
  负责；
- 聚焦测试同时覆盖Schema判别关系、跨字段ID关系、摘要/确定性表示，并明确禁止伪
  identity source字段重新进入投影。

标准依据：JSON Schema Draft 2020-12 Core的条件应用语义，以及官方Understanding JSON
Schema对`if`/`then`/`else`的组合说明；Schema负责结构判别，领域parser负责外部authority
和值相等关系。

验证结果：

```text
Unregistered/Fresh/Registered Projection: 6 pass / 0 fail / 0 skip / 1.016429209s
TypeScript: pass
Architecture: pass / 423 modules / 2600 dependencies
Schema: pass / 34 schemas / 65 external refs / sha256:da51a6e6276d524ac653442d1265cab3799d24dd47ee9bec0145fd59758cc7cd
git diff --check: pass
```

## 162. WINDOW-008

### 162.1 目标文件与已确认结论

- `src/workspace/window-runtime/wakeflow-window-host-binding.ts`
- `src/contracts/schemas/workspace/window-host-binding.schema.json`

Binding是当前宿主内`durable windowId → opaque host handle`的唯一私有路由身份权威。
`programId/hostId/windowId`关闭跨作用域误读，`bindingId`标识一次可替换物理绑定代际，
`launchIntentDigest`绑定Agent执行的当前launch intent，`observedAt/registeredAt`分别保存
host-create结果观察与owner登记时点。role、display、cwd、root、Delivery、Lease、Pod与宿主
可用性均不属于该记录。

审阅发现原parser只按通用Schema检查handle词法，随后直接把字符串断言成Host Profile
准入后的品牌类型；Store读取时才用Identity Profile再次校验。这使类型承诺早于authority
关系，并重复解析相同Binding。

已实施修正：

- `parse/create/render/document`全部显式接收Host Identity Profile；
- Schema继续只拥有portable shape，TS owner关闭
  `record.hostId ↔ profile.hostId ↔ handle kind/value/reserved/capacity`关系；共享模块没有
  新增Codex/Claude分支；
- Store删除第二次handle校验，Registered Projection consumer显式传递同一Profile；
- Schema描述同步澄清portable与profile-owned关系；
- kind/version、create input与error-reason零consumer exports私有化；Schema已先拒绝的
  identifier/digest不可达错误类别收敛回`schema`；
- document parser直接渲染已准入Binding；
- 新增错误Host Profile及错误handle kind回归覆盖。

### 162.2 已确认：跨层不发布完整私有记录摘要

原`computeWakeflowWindowHostBindingDigest()`摘要完整Binding，因此包含raw handle。摘要本身
不会直接显示handle，但Host Profile刻意不保证handle高熵；当其他字段可知时，它可能成为
候选handle的离线验证器。修正前Registered Projection和公共MCP registration result都携带
该值，因此不能仅凭“SHA-256”称其为脱敏。

外部标准事实：RFC 8882明确警告，使用公开可计算hash隐藏敏感identifier可能遭受offline
dictionary attack；OWASP同样要求先做threat model、最小化敏感数据表面，且hash不是
encryption/authenticity。

用户确认采用推荐方案：删除完整Binding摘要函数，并从registration receipt、公共MCP结果、
Registered Projection identity和source fingerprints中删除`bindingDigest`。跨层只使用随机
`bindingId + bindingRef`标识代际；Projection仍由自己的`projectionDigest/documentDigest`
证明确定性表示。未来真实pre-send fence按reference重新读取Binding并比对
program/host/window/bindingId；如果出现必须固定完整私有字节的真实consumer，再由私有owner
基于当时威胁模型设计证据，不提前保留候选摘要。

不建议为此引入workspace secret/HMAC/key management；当前本地插件场景没有现成密钥
owner，这会显著扩大基础设施与恢复成本。

验证结果：

```text
Binding/Registered Projection/MCP integration: 11 pass / 0 fail / 0 skip / 6.188882791s
TypeScript: pass
Architecture: pass / 423 modules / 2599 dependencies
Schema: pass / 34 schemas / 65 external refs / sha256:865c5dd313330cab8d7ff465b841e2c45dbba2a2bc5ed181e3f019e59713491e
git diff --check: pass
```

## 163. WINDOW-009

### 163.1 目标文件与结论

- `src/workspace/window-runtime/wakeflow-window-host-binding-registration-authority.ts`
- `src/workspace/window-runtime/wakeflow-window-host-binding-registration.ts`

Registration Authority是无I/O的当前注册授权：它闭合Resource/Identity Profiles、Agent
host-create observation、当前Launch Intent、全部配置窗口Binding目标、目标未注册投影及
Catalog recipe。Registration编排只在Store专用锁内决定首次create、幂等重放和冲突，
Binding authority提交后再前向发布可重建Projection；它不调用宿主工具，不承担replace、
decommission、Lease、Delivery或Pod生命周期。

已实施修正：

- Authority不再把调用方`request.config`原始对象引用带入锁内Store，只保存从严格
  Unregistered Projection取得的`programId`；Store后续读写不可能重新访问可漂移Config
  alias；
- `observedAt`在纯Authority阶段重新执行UTC准入并映射为稳定`time`错误，失败发生在锁、
  Clock、UUID或文件effect之前；windowId与launchIntentDigest同样返回已验证Launch Intent
  中的规范值；
- 幂等匹配从`handle + launchIntentDigest + observedAt`收敛为稳定注册身份
  `window + handle + launchIntentDigest`。`observedAt`仅是首次host-result审计事实；重试传入
  新观察时间不会改写原Binding，也不会错误触发binding conflict；
- 同window不同handle/launch intent仍为`binding-conflict`；同handle指向不同window仍为
  `handle-conflict`；普通registration不会获得replacement语义；
- Binding no-replace commit继续是唯一身份提交点。其后Projection冲突、取消或恢复失败均
  返回`bindingAuthority=current`并保留Binding，由exact retry前向修复；commit uncertain
  继续返回`unknown`，不伪称回滚；
- 删除Registration层零consumer Request re-export、Receipt export和两组error reason
  exports；Store/Projection仍只消费必要Authority类型。

幂等依据：IETF HTTPAPI Idempotency-Key草案允许owner用选定payload字段构造fingerprint；
AWS等成熟API同样把稳定client token与业务参数用于识别重试，时间/日志元数据不应成为
每次变化的业务键。Wakeflow当前没有另加通用idempotency framework；现有Launch Intent
digest就是首次注册的稳定操作关联，未来replacement由独立authority和新bindingId负责。

验证结果：

```text
Binding Authority/Registration/Projection/MCP: 11 pass / 0 fail / 0 skip / 6.171901584s
TypeScript: pass
Architecture: pass / 423 modules / 2599 dependencies
Schema: pass / 34 schemas / 65 external refs / sha256:865c5dd313330cab8d7ff465b841e2c45dbba2a2bc5ed181e3f019e59713491e
git diff --check: pass
```

## 164. WINDOW-010

### 164.1 目标文件与结论

- `src/workspace/window-runtime/wakeflow-window-host-binding-store.ts`
- `src/workspace/window-runtime/wakeflow-window-host-binding-resource-catalog.ts`

Store拥有当前宿主全部静态窗口共用的短生命周期注册锁、受管Atomic stage恢复、完整Binding
inventory准入和0600 no-replace create。Catalog只为Config中的静态windowId登记一份
current-host私有Binding文件，并只授予`exclusive-create`；当前切片不提前声明replace、
decommission、Lease或Pod动态窗口。

保留的正确边界：

- stale lock只有在owner inactive且所有目标stage均可安全恢复后才按exact observation退休；
- 锁内先恢复全部配置窗口target stage，再稳定读取完整namespace；未知名称、非当前用户、
  错误0700/0600模式、多hard link、错误program/host/path/profile关系全部fail closed；
- inventory全局拒绝重复windowId、bindingId和`handle.kind + value`；同一真实handle不能绑定
  两个配置窗口；
- effect使用Foundation atomic create和父目录持久化；target exists、commit uncertain、
  durability/cleanup/close failure均保守报告`bindingAuthority=unknown`；
- Catalog recipe由Registration Authority在effect前准入，Store不成为通用资源dispatcher。

已实施修正：

- 删除`ReadonlyMap byWindowId`运行时可变投影；冻结inventory只保存唯一bindings数组，
  Registration按目标window执行一次线性查找。1024静态窗口上限下成本有界，并消除回调
  篡改Map后影响注册判断的表面；
- `identity-source`错误准确改名为`binding-id`，明确失败来自UUIDv4代际ID分配；
- owner Clock读取后先验证`registeredAt >= observedAt`，确认时间关系后才分配bindingId；未来
  observation不会消耗UUID或产生文件effect；
- Binding parser失败只在UTC/顺序原因时映射`time`，其他内部profile/schema漂移不再错误
  冒充Clock问题，而映射为写入失败；
- Store error reason零consumer export私有化；
- 真实MCP测试新增未来观察时间零写入、损坏Host Profile关系导致完整inventory拒绝、错误
  脱敏，以及并发同目标恰好一次registered/一次replayed覆盖。

验证结果：

```text
Binding Store/Catalog/Registration/Projection/MCP: 13 pass / 0 fail / 0 skip / 6.405714916s
TypeScript: pass
Architecture: pass / 423 modules / 2599 dependencies
Schema: pass / 34 schemas / 65 external refs / sha256:865c5dd313330cab8d7ff465b841e2c45dbba2a2bc5ed181e3f019e59713491e
git diff --check: pass
```

## 165. WINDOW-011

### 165.1 目标文件与结论

- `src/workspace/window-runtime/wakeflow-window-runtime-registered-projection.ts`
- `src/workspace/window-runtime/wakeflow-window-runtime-registered-projection-publication.ts`
- 相邻合同：`window-runtime-registered-projection.schema.json`

Registered Projection是Config/Desired Topology与当前私有Binding的0600脱敏派生视图。它只
公开program/host/window、role、logical root/configured placement、`bindingRef/bindingId`、
未观察root blocker和上游拓扑指纹；不包含raw handle、完整Binding摘要、host availability、
send/readback、cwd、Lease、Delivery或Pod事实。

Publication在Binding authority已经提交后运行，接受且只接受四种来源：

```text
missing                    → atomic create registered projection
exact unregistered         → CAS replace registered projection
exact current registered   → idempotent no-op
other/foreign/stale bytes  → preserve + conflict
```

已实施修正：

- Projection compiler新增Resource Profile准入，并关闭
  `resourceProfile.hostId/windowIdentity ↔ projection.hostId ↔ binding.hostId ↔ identityProfile`
  关系；不能再生成“codex记录＋claude-code路径”的混合投影；
- Binding、Unregistered Projection和Resource/Identity Profiles任一无效均在纯编译阶段失败；
  `bindingRef`只从已准入Profile生成；
- projection digest删除JsonValue断言；Registered Projection和Publication error reason
  零consumer exports私有化；
- 磁盘source字节与刚编译target完全相等时直接幂等返回；Generic deterministic reader已经
  验证规范JSON，exact byte equality又证明它就是当前完整领域目标，因此删除第二次完整
  source-aware parse；
- 保留target-specific Atomic stage恢复、当前用户0600/single-link检查、unregistered CAS
  expectation和Binding-first前向恢复语义；
- 测试新增交叉Host Profile拒绝及删除未注册投影后的missing→registered真实重建，同时继续
  覆盖foreign conflict、commit后恢复和raw handle/Binding摘要不泄漏。

验证结果：

```text
Registered Projection/Publication/Binding/MCP: 11 pass / 0 fail / 0 skip / 6.18860075s
TypeScript: pass
Architecture: pass / 423 modules / 2600 dependencies
Schema: pass / 34 schemas / 65 external refs / sha256:865c5dd313330cab8d7ff465b841e2c45dbba2a2bc5ed181e3f019e59713491e
git diff --check: pass
```

## 166. WINDOW-012

### 166.1 目标文件与结论

- `src/workspace/window-runtime/wakeflow-window-host-binding-public-contract.ts`
- `src/workspace/window-runtime/wakeflow-window-host-binding-public-coordinator.ts`
- 相邻合同：Binding registration request/result Schemas

公共工具只接收workspace绝对root与Agent已取得的host-create observation；不选择或调用宿主
工具。Coordinator固定当前Host的Resource/Identity Profiles，打开handle-backed workspace
root，读取当前Config authority，调用唯一Registration owner，并返回不含raw handle和绝对
root的闭合receipt。

已实施修正：

- 64KiB canonical request预算保留；Schema已拥有的window ID/SHA-256词法错误不再保留
  不可达`identifier/digest`类别，UTC calendar语义仍由parser映射`time`；
- request最大预算、Observation/Public Request结构与两组error reason零consumer exports
  私有化；tool name和Schema version继续作为真实MCP producer/consumer合同；
- Host Facade要求非Proxy冻结composition root；一次解析并返回规范`hostId + profiles`快照，
  后续不再重新读取原始`facade.hostId`，关闭composition TOCTOU；
- 公共结果继续先转为被动JsonValue、执行严格result Schema并检查绝对root精确泄漏；品牌类型
  恢复处增加明确注释。raw handle不能使用全树字符串黑名单，因为opaque值可能合法等于
  `codex`或其他公开字段；真正脱敏边界是typed receipt构造、closed Schema和不存在
  `handle`字段；
- `bindingRef/resourceRef`由任意字符串收紧为Portable Resource Path词法；公共MCP Schema
  使用同文档`#/$defs/portableResourcePath`，不暴露服务端私有URN `$ref`。MCP官方说明未解析
  external ref应拒绝且不得默认网络抓取，因此tool Schema必须self-contained；
- 新增越界`../outside.json`输出拒绝与listed output Schema零external URN ref测试；现有
  SDK输入/输出验证、稳定错误、commit unknown和真实端到端注册继续通过。

验证结果：

```text
Public Contract/Coordinator/MCP/real registration: 9 pass / 0 fail / 0 skip / 6.253890625s
TypeScript: pass
Architecture: pass / 423 modules / 2600 dependencies
Schema: pass / 34 schemas / 65 external refs / sha256:66cbc908135dc13a1130461c51ff87ff03761ad9d7c6ad08a7af0b8cbe4189eb
git diff --check: pass
```

## 167. Window Runtime system gate（已关闭）

完整技术调用链：

```text
Maintenance Fresh preview/apply
→ Fresh Window Runtime Authority
→ exact empty Binding namespace + deterministic unregistered projections

Agent executes current host create capability
→ closed MCP host-create observation
→ current Config/Launch Intent revalidation
→ current-host global Binding lock
→ complete private Binding inventory + unique handle/bindingId
→ 0600 no-replace Binding authority commit
→ redacted registered projection forward publication
→ closed public receipt
```

系统权威结论：

- Config/Desired Topology拥有逻辑窗口；Binding是raw host handle的唯一私有current identity
  authority；Window Runtime是可删除重建的脱敏投影，不能反向补写Config或Binding；
- Wakeflow公共工具只接收Agent已取得的真实host result，不选择、创建、读取、发送、关闭或
  探测Codex/Claude窗口；Host差异完全来自两类静态Profile，没有共享代码hostId分支；
- `bindingId`是跨层唯一绑定代际标识。完整Binding摘要已删除，Projection/MCP/未来transport
  不获得raw handle的可猜测hash verifier；
- 首次注册在一个current-host全局锁内读取完整配置窗口inventory，关闭重复window、generation
  ID和handle；Binding commit是不可回滚身份事实，Projection失败只允许前向恢复；
- Fresh只证明空Binding namespace并写unregistered projection；初始化绝不创建空Binding或
  placeholder handle；
- Resource Catalog只授予当前真实recipe：Fresh目录物化、Projection deterministic rewrite、
  Binding exclusive create。没有预埋通用registry、manager、adapter或replacement recipe；
- 清理系统零consumer表面：10组内部type/error exports私有化，删除测试专用Unregistered
  renderer与Registered document parser；测试不再成为生产API存在理由。

当前完成范围是“静态窗口首次物化＋首次host identity注册”的技术垂直切片。以下业务仍明确
不存在：

- root observation与从blocked进入ready的preflight；
- window replacement、decommission、host close/revoke evidence；
- 动态Pod windows及creation evidence；
- Delivery envelope、typed Lease、pre-send binding fence、host send/readback；
- host liveness/availability、Agent ready/idle判断；
- legacy registry/window-config迁移和正式插件切换。

这些能力必须由各自真实consumer垂直加入；不能扩写当前Binding或Projection成为综合窗口状态
对象。

系统验证：

```text
Window Runtime + MCP + adjacent Maintenance: 42 pass / 0 fail / 0 skip / 55.163990291s
TypeScript: pass
Architecture: pass / 423 modules / 2599 dependencies
Schema: pass / 34 schemas / 65 external refs / sha256:66cbc908135dc13a1130461c51ff87ff03761ad9d7c6ad08a7af0b8cbe4189eb
git diff --check: pass
```

## 168. MCP-001

### 168.1 目标文件与结论

- `src/entrypoints/wakeflow-public-mcp-server.ts`
- `src/entrypoints/codex-wakeflow-mcp.ts`
- `src/entrypoints/claude-code-wakeflow-mcp.ts`

共享Server使用官方`@modelcontextprotocol/server`，只注册已闭环的Maintenance与Window Host
Binding registration。官方SDK拥有initialize、tools/list、tools/call及调用前Schema验证；
domain coordinator继续拥有容量、关系、root、authority、mutation与输出脱敏。Codex/Claude
composition root只注入各自Maintenance/Binding执行器和server identity。

已实施修正：

- Server options先经Foundation plain-own-data快照并要求exact字段，拒绝Proxy/accessor/hidden/
  extra字段和Proxy executor；handler只闭包已准入本地函数，不再随调用方后续修改options而
  漂移；
- server name/version增加非空、128字符、trim、control、well-formed Unicode和NFC边界；
- instructions中的tool name改由公共常量插值，避免字符串与实际注册名漂移；
- executor/options/error-reason types私有化；测试通过factory参数类型推导，不维持测试专用
  生产exports；双宿主server name零consumer constants私有化；
- Codex/Claude注释修正为实际同时组合Maintenance与Window Binding，而非只声称Maintenance；
- 成功结果继续同时返回canonical TextContent和structuredContent；领域错误只返回稳定、
  脱敏、`isError=true`文本，不强行通过成功outputSchema；
- annotations保持真实：Maintenance可写且可能destructive/non-idempotent；首次Binding注册
  additive/idempotent/closed-world，且Wakeflow不执行host effect；
- 新增Proxy executor与额外options拒绝测试；官方Client工具列表、输入/输出Schema、错误
  脱敏和commit unknown证据继续通过。

验证结果：

```text
Public MCP Server + real Binding entrypoint: 10 pass / 0 fail / 0 skip / 6.231028792s
TypeScript: pass
Architecture: pass / 423 modules / 2600 dependencies
Schema: pass / 34 schemas / 65 external refs / sha256:66cbc908135dc13a1130461c51ff87ff03761ad9d7c6ad08a7af0b8cbe4189eb
git diff --check: pass
```

## 169. MCP-002

### 169.1 目标文件与结论

- `src/entrypoints/wakeflow-mcp-stdio.ts`

该文件是唯一进程级stdio transport边界。官方SDK `serveStdio()`拥有协议协商、连接时代选择、
分帧、单连接server pinning、输入buffer与transport关闭；Wakeflow只拥有稳定stderr、退出码
和SIGINT/SIGTERM生命周期连接，不解析JSON-RPC或写stdout日志。

已实施修正：

- 删除与SDK默认值重复的`legacy: "serve"`；依赖已固定为官方Server 2.0.0，其类型文档明确
  2025-era opening默认serve，协议兼容策略继续归SDK；
- 原实现返回SDK原始handle，但信号清理由另一闭包维护；调用方主动`handle.close()`不会移除
  SIGINT/SIGTERM listener，后续信号可能二次关闭。现在返回冻结包装handle，程序化关闭与
  信号关闭共享同一Promise并恰好移除同一listener；
- close同步抛出或Promise拒绝都转换为稳定shutdown error、设置`process.exitCode=1`；信号
  callback消费该拒绝避免unhandled rejection；程序化调用方仍可观察失败；
- transport `onerror`同样设置非零exitCode，只输出固定stderr文本，不输出异常message、stack、
  path或请求内容；stdout继续完全留给MCP；
- 未增加自定义transport/parser、legacy adapter或进程manager。

验证结果：

```text
Dual-host artifact official stdio Client: 2 pass / 0 fail / 0 skip / 1.872617792s
TypeScript: pass
Architecture: pass / 423 modules / 2600 dependencies
Schema: pass / 34 schemas / 65 external refs / sha256:66cbc908135dc13a1130461c51ff87ff03761ad9d7c6ad08a7af0b8cbe4189eb
git diff --check: pass
```

## 170. ARTIFACT-001

### 170.1 目标文件与结论

- `tooling/artifacts/build-typescript-artifact-candidates.ts`
- `tests/artifacts/typescript-artifact-candidates.test.ts`

Builder以两个已编译host MCP入口为唯一roots，使用`es-module-lexer`遍历静态ESM闭包，允许
Node builtin、拒绝非字面量dynamic import和越界/非JS模块；bare import收敛到精确root
`dependencies`版本。每份候选只允许当前host执行模块及另一host的一份静态Resource Profile，
从同一TS源码生成不可发布候选。

保留的物理边界：

- source、reference package、output/stage/backup逐级拒绝symlink和错误节点；module/file count
  有界；
- stage内exclusive write，完整成功后rename替换`.build`候选输出；失败删除exact stage并在
  替换失败时恢复backup；不会修改`plugins/`、安装cache或release version sources；
- launcher只有官方stdio入口，package只列真实可达external packages，manifest记录每个文件
  byte count、SHA-256、mode和host scope；manifest本身以独立digest返回；
- package固定`0.0.0-technical-skeleton`、`private:true`、Node 24，artifact manifest固定
  `releaseEligible:false`及当前技术骨干scope。

已实施修正：

- 注释修正为实际使用的成熟ES module lexer，而非错误声称TypeScript预处理器；
- manifest payload排序从locale-sensitive `localeCompare()`改为code-unit确定性比较；测试
  directory traversal使用同一顺序；
- reference package除name外增加version准入，避免manifest静默遗漏
  `referenceArtifactVersion`；
- Build Record/Result/Error零consumer exports私有化，唯一公共表面保持build函数；
- 测试除闭合文件列表、hash、bytes、无TS/map、依赖和peer isolation外，新增实际Unix mode
  与manifest `0644/0755`逐项一致验证；
- 双宿主候选均由官方stdio Client完成连接并列出相同两个真实工具，stderr为空。

验证结果：

```text
Artifact candidate deterministic/official stdio: 2 pass / 0 fail / 0 skip / 2.051647834s
TypeScript: pass
Architecture: pass / 423 modules / 2600 dependencies
git diff --check: pass
```

## 171. TOOL-TEST-001

### 171.1 目标文件与结论

- `tooling/testing/run-typescript-tests.ts`
- `tests/tooling/testing/run-typescript-tests.test.ts`

Runner不通过`.build/tests` glob发现测试，而以当前`tests/**/*.test.ts`源清单为唯一输入，映射
到相应编译JS后交给Node 24原生test runner。全量模式运行全部当前源；focused模式只接受
调用方显式列出的当前普通`.test.ts`，拒绝空清单、重复、越界、legacy `.mjs`、不存在或
symlink文件，因此删除TS测试后遗留的旧JS不会制造虚假覆盖。

已实施修正：

- 全量目录遍历顺序从locale-sensitive `localeCompare()`改为code-unit排序；focused清单也
  显式使用同一比较器；
- 新增root-to-parent逐级真实目录检查。全量遍历原本会直接看到symlink entry并拒绝，但
  focused直达路径只lstat最终文件，可能跟随中间symlink；现在source与compiled output两侧
  的每一级祖先都必须存在、非symlink且为目录；
- compiled test除普通非symlink文件外要求single link，减少alias执行面；
- 保留512文件预算、shell=false、绝对编译输出清单及child exit status传递，不新增glob、
  test registry、watch cache或旧JS兼容分支；
- 新增临时fixture证明`tests/linked/escaped.test.ts`即使最终节点是普通文件，也因symlink
  祖先在启动Node前被拒绝。

验证结果：

```text
TypeScript focused runner: 2 pass / 0 fail / 0 skip / 0.0597175s
```

## 172. TOOL-ARCH-001

### 172.1 目标文件与结论

- `tooling/architecture/check-dependencies.ts`
- `.dependency-cruiser.cjs`

Checker通过固定Node进程启动已声明的dependency-cruiser CLI，要求JSON报告、SWC parser、非零
modules/dependencies以及exit/error/warn/violations全部为零。16MiB有界报告、shell=false和稳定
摘要输出保持；缺parser、空扫描或无效报告不能伪装绿灯。

现有规则已机器关闭：循环、unresolvable、未声明生产包、runtime dev dependency、runtime→
tests/tooling/legacy、new tests→legacy JS、Foundation→application domains、application identity
contract→domains、host-neutral filesystem/process绕过Foundation，以及host-neutral→host
implementation反向依赖。

已补充三条缺失但已由当前架构实际遵守的seam：

- 普通`src` runtime不得反向依赖`src/entrypoints`composition root；
- `src/hosts/codex`不得导入Claude Code host implementation；
- `src/hosts/claude-code`不得导入Codex host implementation。

双宿主entrypoint仍可各自引用peer的一份静态Workspace Resource Profile；它是完整Config/
Maintenance资源矩阵的真实数据输入，不授予peer执行能力，并继续由Artifact closure白名单验证。
没有尝试按文件夹制造与当前代码矛盾的严格分层：Configuration与Governance的Resource Catalog
真实依赖Workspace declaration/active paths，这些关系留给后续owner重构而非用错误规则强禁。

验证结果：

```text
Architecture: pass / parser=swc / 423 modules / 2600 dependencies / 0 violations
TypeScript focused runner: 2 pass / 0 fail / 0 skip / 0.049952458s
git diff --check: pass
```

## 173. TypeScript technical review gate（已关闭）

### 173.1 当前完成的技术层与骨干

```text
Foundation
  passive data / JSON / canonicalization / crypto / typed time & identity
  rooted filesystem / stable reads / atomic create-replace / locks / tree publication
  artifact transfer / Git observation / resource processing / Event upcast registry

Configuration + Workspace
  strict Config v3 authority / placement / snapshot / CAS replacement / recovery
  static resource matrix / managed text / Gitignore / Program Instruction / Support memory
  durable Maintenance preview-confirm-intent-journal-gate-transaction-recovery

Governance technical slices
  TODO immutable intake + mutable state + projection + locked transaction/recovery
  Ledger immutable Requirement/Confirmation tree publication + exact member refs
  Demand Event Sourcing publish/cancel + append-only file store + snapshot + upcaster

Window Runtime
  Fresh empty Binding namespace + unregistered projections
  Agent-observed opaque host result → typed private Binding → redacted projection
  first-registration idempotency / complete inventory / unique handle / forward recovery

MCP + Tooling
  official MCP server/stdio, two real tools, self-contained public Schemas
  dual-host static ESM closure candidates, exact dependencies, manifest/hash/mode checks
  current-source-only TS runner and nonzero architecture/Schema gates
```

### 173.2 明确没有实现的真实业务

当前闭环不等于完整Wakeflow产品。以下仍不存在，不以字段、事件、工具或空文件占位：

- Demand Tasking、TaskPackage、Delivery、TargetResult、Test、Review、Evidence、Complete、Archive；
- Demand除publish/cancel之外的业务事件及对应state-model演进；
- root observation、Window ready/preflight完成、host availability/liveness；
- Window replacement/decommission、Pod fleet/materialization、Lease、pre-send fence、send/readback；
- BusinessArchive、公开TODO/Ledger intake、完整Demand Resource Catalog业务消费；
- legacy workspace显式迁移、旧新等价、正式plugin manifests/Skills/templates/commands；
- release version、正式制品、安装cache刷新、发布或当前旧JS runtime切换。

下一阶段不能以“尽快补齐RH/旧大对象”为目标。应重新从真实业务consumer选择一个垂直切片，
先冻结需求authority、事件/状态最小增量、资源owner、host effect seam和验收环境，再增加代码。

### 173.3 最终验证证据

```text
Node: v24.19.0
npm: 11.17.0
Current TS test sources: 153
Current src TypeScript files: 260
Current tooling TypeScript files: 4

TypeScript source-manifest tests: 685 pass / 0 fail / 0 skip / 75.342705041s
TypeScript typecheck: pass
Architecture: pass / parser=swc / 423 modules / 2600 dependencies / 0 violations
Schema: pass / 34 schemas / 65 external refs
Schema digest: sha256:66cbc908135dc13a1130461c51ff87ff03761ad9d7c6ad08a7af0b8cbe4189eb

Codex candidate: 196 compiled modules
  dependencies: @modelcontextprotocol/server, ajv, canonicalize, p-limit
  manifest: sha256:8d2f67f513bc4e7a3834b1d160cd430c59fda12cbb1467704ad65c2422ddf457
  npm pack dry-run: 200 entries / 312387 packed bytes / 1629014 unpacked bytes

Claude Code candidate: 201 compiled modules
  dependencies: @modelcontextprotocol/server, ajv, canonicalize, jsonc-parser, p-limit
  manifest: sha256:8ef56c585270053d4f0ba861a404faca0c79fa95dd35c88c94a6a015e9b220c6
  npm pack dry-run: 205 entries / 320922 packed bytes / 1684117 unpacked bytes

git diff --check: pass
```

全部测试来自当前TS源清单；没有运行旧JS全套、旧plugin validator/smoke、`npm test`或
release gate。候选仍为`0.0.0-technical-skeleton`、`private:true`、
`releaseEligible:false`。这些验证证明当前技术骨干内部一致，不证明旧新功能等价或release
ready。

### 173.4 工作树与核实暂停点

- branch：`main`，相对`origin/main` ahead 5；
- 本轮没有commit、push、tag、publish或cache refresh；
- 当前逐文件审阅累计修改346个tracked paths，另有本轮台账及此前新增TS合同/测试文件；
- `docs/wakeflow-typescript-technical-skeleton-review-gate-2026-08-28.md`是进入本轮前已存在的
  独立工作树修改，继续保留，未作为本台账的当前命令authority；
- 按用户此前约定，在技术层与骨干核实节点暂停。下一步先review本台账和代码diff，再由用户
  选择真实业务垂直切片或先形成一个提交节点。

## 174. TASKING-001～004（首个业务垂直切片已收束）

### 174.1 当前实现范围

本轮在已关闭技术骨干之后实现首个consumer-driven Tasking切片，范围严格停在
“规划一个implementation Target Task”：

- `task-package.ts`与Schema拥有不可变完整执行合同、`configDigest`、Demand Authority摘要、
  repository/window assignment、边界、完成预期、commit expectation和acceptance anchors；
- `tasking.target-task-planned.v1`把完整TaskPackage作为业务事件数据，事件流仍是唯一权威；
- Demand Aggregate只保存`authorityDigest`与按ID排序的最小Target Task摘要，不复制完整包、
  Config或投影路径；
- `artifacts/task-packages/<taskPackageId>.json`是按IDcreate-only、可删除重建的查询投影，
  existing冲突不得覆盖；
- `wakeflow_plan_target_task`通过官方MCP SDK提供`preview → apply`，同时进入Codex和Claude
  Code候选制品；不执行Delivery、Lease、消息发送、Git或任何宿主效果。

### 174.2 权威与提交顺序

```text
Preview（零写入）
  strict Config snapshot + configDigest
  → Demand root full audit + Ledger closure
  → selectedAuthorityMemberRefs解析为完整Authority refs
  → Wakeflow生成TaskPackage/TargetTask/Event/Commit ID和createdAt
  → pure Decider + exact prepared commit容量预检
  → immutable plan + Canonical planDigest

Apply
  exact plan + planDigest
  → 先按commitId检查是否已经提交
  → 未提交：重验Config、Demand Authority、Ledger refs、topology与stream expectation
  → Command Handler append（唯一业务commit point）
  → event-backed TaskPackage projection create/readback
  → structured MCP receipt
```

已提交重试不会因之后的Config重配而失去恢复能力；它先证明同一commitId、command digest与
expected revision已经绑定，然后只收敛投影。投影失败显式报告`eventAuthority=current`；无法
证明追加结果时报告`unknown`，不伪装回滚。

### 174.3 收束修正与剪枝

- `configDigest`进入TaskPackage，修复仅记录repository/window ID而无法说明准入拓扑版本的
  审计缺口；未建立不必要的Config Event Sourcing或历史仓库；
- 公共preview只接收Authority member paths，不让Agent复制或声明Ledger record/member摘要；
  Planning owner从当前Demand Authority恢复完整引用；
- Foundation `derived-projection`补齐`exclusive-create`形态，仍与`immutable-fact`和非查询型
  `derived-checkpoint`分离；
- Planning原1110行单文件拆为input、authority与service三个职责模块；service只保留
  preview/apply编排、event authority分类和投影后处理；
- TaskPackage authored-content准入下沉到TaskPackage owner，Planning input删除自建假Ledger
  reference结构；
- Tasking只读Event Store容量/目录常量改为直接依赖无副作用contract，不经完整Store门面；
- 删除重复的public-coordinator真实workspace测试；同一公共链由service业务测试和官方MCP
  Client端到端测试分别覆盖，不维持第三份等价集成测试；
- 两份MCP wire Schema因协议要求保持同文档`$ref`自包含；代码生成测试逐项比较共享plan、
  TaskPackage与词法defs，并核对公共TaskPackage字段集合与领域Schema，限制手写镜像漂移。

### 174.4 明确未进入的范围

当前Target Task只有`planned` phase。下列能力仍不存在，不能从当前工具或字段推断：

- Window Binding/availability/idle、coordination Lease与pre-send fence；
- Dispatch group、packet、envelope、host send/readback和delivery run；
- TargetResult、ReviewCandidate、rework/redesign、TestCard、completion与archive；
- documentation/research/test TaskPackage、dependency、continuation或replacement分支；
- 旧JS workspace迁移、旧新等价、release切换或安装cache刷新。

### 174.5 当前验证证据

```text
Affected TypeScript source-manifest tests: 90 pass / 0 fail / 0 skip / 16.805856583s
TypeScript: pass
Architecture: pass / parser=swc / 440 modules / 2765 dependencies / 0 violations
Schema: pass / 38 schemas / 70 external refs
Schema digest: sha256:cac20f3f7e0c4afc5fce4cfdfb6d34009ab311d8a3c516d5612a1b1a5a954118
Dual-host candidate official stdio: pass / same 3 public tools
git diff --check: pass
```

验证包含真实本地Event Store的preview/apply/idempotent retry、并发Apply收敛、Config drift
pre-commit阻断、post-commit projection conflict/recovery、官方MCP Client以及双宿主候选制品。
本轮按约定只运行受影响的新TypeScript测试；未运行旧JS全套、`npm test`、旧plugin smoke/
validator或release gate。

### 174.6 后续架构观察

- 当前Ledger member reference codec仍由既有Ledger Store门面转交；Tasking没有为此复制第二套
  parser。若后续Delivery也只需纯引用codec，应在Ledger文件审阅单元决定是否下沉，不能由
  Tasking私自建立兼容实现；
- 当前TS项目尚无已发布持久数据，因此新增Tasking状态仍直接完善state model v1，没有制造
  无真实历史的v2/upcaster；一旦真实版本发布，后续变化必须使用既有版本演进能力；
- 下一步在进入Delivery前应先由当前Tasking contract推导最小readiness需求，不能照搬旧JS
  的group/packet/lease大对象或把host effect放回Wakeflow。

## 175. DELIVERY-PRE-001（Agent Host Window Observation）

### 175.1 已确认边界

进入Delivery前先关闭Agent与私有Binding之间的宿主目标交接：Agent通过Codex/Claude宿主能力
取得候选handle并检查当前上下文，再把候选作为瞬时秘密交给Wakeflow；Wakeflow只做精确验证并
返回脱敏authority。Wakeflow不读取宿主、不执行send/read/create/close，也不把raw handle写入
事件、投影、日志或公共结果。

本单元新增：

- `agent-host-window-observation.schema.json`与生成合同：闭合
  `hostId/windowId/bindingId/candidate handle/configured-root attestation/observedAt`；
- `wakeflow-agent-host-window-observation.ts`：被动JSON、64KiB容量、typed ID、当前宿主handle、
  Config placement与UTC instant准入；
- `wakeflow-agent-host-window-observation-authority.ts`：闭合当前Host profiles、完整私有Binding、
  当前Config desired topology、Binding代际、候选handle、逻辑根和时间顺序；只输出脱敏摘要。

### 175.2 关键语义与剪枝

- `attestedRoot.status=matches-configured-root`明确是Agent声明，不是Wakeflow伪造的宿主证明；
- authority只证明观察晚于当前Binding registration；是否足够新、是否允许跨越host-effect边界
  由后续claim owner使用当前时钟和一次性业务claim判断，本单元不提前固化TTL；
- 候选handle用固定长度SHA-256指纹执行常量时间等值比较，指纹与原值均不进入返回authority；
- Binding中的`launchIntentDigest`是创建时历史来源。当前Config只要窗口逻辑根未变，显示标题、
  语言等非路由变化不会错误淘汰Binding；根或window topology变化会拒绝旧观察；
- 本单元不持久化root observation、不生成ready/liveness/availability、不创建WindowWorkClaim，
  也不新增Delivery event、MCP工具或旧式Group/Packet/Envelope/Run文件。

### 175.3 聚焦验证

```text
New TypeScript test: 4 pass / 0 fail / 0 skip
TypeScript compile: pass
Architecture: pass / parser=swc / 444 modules / 2803 dependencies / 0 violations
Schema: pass / 39 schemas / 77 external refs
Schema digest: sha256:eaaeaec2dee8ed684f5172914ec378017023ded3393c4a93e9300ca59bcbaa7c
git diff --check: pass
```

测试覆盖被动输入、额外字段/accessor拒绝、确定性脱敏authority、错误Binding代际、错误候选
handle、错误根、早于Binding的观察，以及“显示文本变化保持有效、根拓扑变化失效”。聚焦runner
只从已跟踪Git diff选取测试，无法看到当前未跟踪的新测试源，因此在同一次TypeScript编译后直接
执行该单一编译测试文件；没有改动暂存区，也没有运行旧JS或全量TS测试。

## 176. DELIVERY-001（Event-carried TargetDeliveryIntent）

### 176.1 当前实现范围

本单元把一个已规划implementation Target Task推进为唯一`delivery-prepared`业务事实，严格停在
prepare：

- 新增持久typed kind `target-delivery`，已有`TargetDeliveryIntent` producer、事件字段、
  Aggregate consumer与真实File Event Store consumer，不是未来占位；
- `TargetDeliveryIntent`只保存program/config/demand身份、TaskPackage ID/ref/digest、
  host/window/Binding代际、用户语言、`portablePrompt`、preparedAt与self-excluding digest；
- `delivery.target-delivery-prepared.v1`把完整Intent作为事件数据，加入现有Demand Event Sourcing
  Registry、current writer、upcaster、pure Decider和Aggregate reducer；
- Aggregate仍只保存当前Intent定位和后续Claim所需的最小摘要：
  `targetDeliveryId + intentDigest + hostId + bindingId`，完整Intent只在事件中；
- command瞬时携带完整TaskPackage，Decider验证Intent与TaskPackage逐项闭合后只持久化Intent，
  不在事件中复制第二份TaskPackage。

### 176.2 Prompt与导航修正

Intent不把可移植TaskPackage路径误称为最终宿主prompt。它保存`portablePrompt`：目标摘要、相对
Wakeflow workspace的TaskPackage入口和三条执行边界。后续TargetDeliveryAgentHostAction在Claim时才把调用方
已经提供的workspace root瞬时加入真实prompt；absolute root不进入Event Sourcing。

TaskPackage允许较长objective。portable prompt只保留前2048个Unicode code point并加省略号，
避免一个合法多字节TaskPackage因prompt容量而不可投递；Target仍被要求读取完整TaskPackage。
语言严格使用现有`en | zh-Hans`配置词汇，未建立第二套语言设置。

### 176.3 Event Sourcing状态边界

```text
target task: planned
  → command: delivery.prepare-target-delivery.v1
  → event: delivery.target-delivery-prepared.v1
  → target task: delivery-prepared + minimal currentDelivery summary
```

同一planned任务只能准备一次；重放由既有commitId幂等处理。当前TS尚未发布持久数据，因此本轮
继续直接完善state model v1，没有制造不存在的v2历史或空upcaster。事件家族仍有独立v1 codec，
未来真实版本变化继续使用现有version-evolution Registry。

### 176.4 明确未进入的范围

- 尚无Preparation preview/apply service或公共MCP入口；本单元先关闭领域记录与事件骨干；
- 尚未消费`AgentHostWindowObservationAuthority`，它属于紧邻宿主效果的Claim阶段；
- 未创建WindowWorkClaim、进程mutex、TTL、send generation、host action或outcome；
- 未执行Codex/Claude宿主能力，也未保存raw handle、absolute root、send/readback结果；
- 未创建旧式DispatchGroup、DispatchPacket、DeliveryEnvelope或DeliveryRun文件。

### 176.5 聚焦验证

```text
New/affected TypeScript tests: 10 pass / 0 fail / 0 skip
TypeScript: pass
Real File Event Store: prepared append + reload/full audit + commitId retry pass
Architecture: pass / parser=swc / 449 modules / 2846 dependencies / 0 violations
Schema: pass / 41 schemas / 88 external refs
Schema digest: sha256:55697dd86b0ab772331ff5ccde125efe5b500d72db1a28816c3cce0e750aac91
git diff --check: pass
```

验证只执行新Intent测试及直接受影响的Aggregate、Decider、upcaster、state-version与Command
Handler测试；没有运行旧JS、完整TS套件、插件validator/smoke或release gate。

## 177. DELIVERY-002（TargetDeliveryPreparationService）

### 177.1 真实Preparation纵切

本单元为`TargetDeliveryIntent`建立真实consumer-driven `preview → exact apply`服务：

```text
Preview（零写入）
  current Config + Demand/Ledger full audit
  → planned Target Task + exact TaskPackage projection
  → stable private Binding inventory observation
  → allocate targetDelivery/event/commit IDs
  → derive language + portablePrompt + Intent
  → pure Decider / exact commit bytes preflight
  → immutable plan + planDigest

Apply
  parse exact plan + digest
  → 从原始 target-task-planned event恢复TaskPackage
  → 先识别同commitId重放
  → 未提交：重开完整authority context
  → 重验TaskPackage/Config/topology/Binding/stream revision
  → 重算逐字节相同Intent
  → Config physical-source final check
  → Command Handler append唯一prepared事件
```

Apply结果只携带计划、事件/提交authority和摘要，不返回raw handle。已提交重试只依赖原始Tasking
事件与同Commit证明；后续Config变化或TaskPackage查询投影缺失不会阻断幂等恢复。

### 177.2 Binding Store基础能力修正

旧Binding Store读取入口直接接受`WindowHostBindingRegistrationAuthority`，把inventory读取错误
耦合到注册时handle/observation。当前已拆为：

- `WakeflowWindowHostBindingStoreAuthority`：program/profile/完整允许refs/root/lock的最小通用
  Store authority；
- `WakeflowWindowHostBindingCreateAuthority`：注册写入才额外要求window/ref/launch digest/handle/
  observedAt；
- `compileWakeflowWindowHostBindingStoreAuthority(...)`：从Config与固定Host profiles纯编译读取
  authority，不接受或伪造Agent observation；
- `inspectWakeflowWindowHostBindingInventory(...)`：零写入、前中后确认mutation lock absent并双读
  inventory；差异、stage residue、active/stale lock或节点违规均fail closed。Preview不会创建锁、
  恢复stage或清理残留。

注册流程继续使用扩展authority，现有真实MCP Binding注册测试保持通过。Delivery只读取完整私有
inventory并立即缩窄到目标Binding；handle不会进入plan、event、错误或返回值。

### 177.3 Demand通用操作上下文

Config snapshot、Ledger root、Demand root安全打开、完整Demand/Ledger audit、关闭顺序和Config
physical-source复验已从Tasking专用文件下沉为`DemandOperationAuthorityContext`。它不理解Tasking、
Delivery、Result或Review业务规则；Tasking现有authority改为委托该上下文，自己的拓扑与引用准入
保持不变。原Tasking 5项真实workspace测试全部通过，未复制第二套根目录安全逻辑。

### 177.4 文件职责收束

首次实现时Preparation Service达到1028行；文件审阅未接受该形态，已拆为：

- `target-delivery-preparation-input.ts`：request/options/AbortSignal/三项ID分配；
- `target-delivery-preparation-authority.ts`：TaskPackage投影、Demand闭合、Config拓扑、Binding
  inventory和事件来源恢复；
- `target-delivery-preparation-plan.ts`：关闭字段计划与plan digest；
- `target-delivery-preparation-service.ts`：preview/apply、commit preflight、event-authority分类和
  资源关闭顺序。

Service最终约748行，不再混入输入parser和完整authority加载实现。

### 177.5 明确未进入的范围

- 没有公开MCP/CLI；不暴露一条无法继续Claim的半成品公共流程；
- 没有WindowWorkClaim、auto-expiry Lease、send generation或host-effect claim事件；
- 没有消费Agent候选handle、生成最终TargetDeliveryAgentHostAction或执行Codex/Claude能力；
- 没有outcome/readback/rearm、TargetResult或Review；
- 没有Group/Packet/Envelope/Run兼容对象或独立Intent投影文件。

### 177.6 聚焦验证

```text
Direct affected TypeScript tests: 24 pass / 0 fail / 0 skip
Preparation workspace scenarios: preview zero-write; exact apply; idempotent retry;
  Config drift; Binding disappearance; concurrent apply; post-commit Config/projection drift
Tasking regression: 5 pass
Real MCP Binding registration regression: pass
TypeScript: pass
Architecture: pass / parser=swc / 457 modules / 2924 dependencies / 0 violations
Schema: pass / 41 schemas / 88 external refs
Schema digest: sha256:55697dd86b0ab772331ff5ccde125efe5b500d72db1a28816c3cce0e750aac91
git diff --check: pass
```

验证未运行旧JS、完整TS套件、插件validator/smoke或release gate。

## 178. DELIVERY-003（Non-expiring WindowWorkClaim）

### 178.1 Claim业务合同

本单元新增跨Demand、跨宿主适配层共享的当前窗口工作占用：

```text
.wakeflow-local/runtime/shared/coordination/window-work-claims/<windowId>.json
```

`WindowWorkClaim`固定保存：

- 独立`window_work_claim_<uuidv4>`代际ID；它是可释放运行时身份，不进入durable ID kind词汇；
- program、demand、targetTask、targetDelivery与Intent digest/preparedAt；
- host/window/Binding代际；
- 脱敏AgentHostWindowObservation authority digest与observedAt；
- 预分配Claim Event/Commit、expected stream revision与expected state digest；
- claimedAt与self-excluding claim digest。

时间顺序固定为`intentPreparedAt < host observedAt <= claimedAt`。记录不含`expiresAt`、TTL、
auto-retry、raw handle、send/readback结果或验收判断。墙上时间和进程退出不会自动释放Claim；宿主
本身不消费Wakeflow fencing token，因此本层也不伪造“可阻止旧Agent effect”的单调fence保证。

### 178.2 Store与并发语义

`WindowWorkClaimStore`实现：

- read-only `inspect`；目录或文件权限、symlink/type、single-link、确定性文档和window/path关系
  任一不满足都fail closed；
- per-window durable `exclusive-create`，相同完整Claim重放返回`current`，不同Claim返回`occupied`；
- `exact-retire`只删除同一文档与同一物理节点；不同Claim返回expectation mismatch；
- Claim缺失不能伪装成幂等释放成功，因为没有tombstone证明由谁删除，返回`not-found + unknown`；
- exact unlink使用`replacement-allowed`，仅允许另一个已授权Claim在旧inode删除后取得同名路径，
  不会误删后继Claim。

并发测试首次发现Foundation atomic create在stage cleanup前短暂保持双链接，第二个同进程writer
可能观察到合法但尚未结算的link count 2。没有放宽single-link策略；Store增加按
`workspace root + target ref`的短生命周期mutation queue，同进程create/release串行，队列完成即
删除且不保存业务authority。跨进程未结算仍返回`recovery-required + unknown`，不猜测occupied。

### 178.3 Shared Coordination静态布局

资源矩阵新增三层真实静态目录：

- `.wakeflow-local/runtime/shared`；
- `.wakeflow-local/runtime/shared/coordination`；
- `.wakeflow-local/runtime/shared/coordination/window-work-claims`。

三者均为0700、ignored、runtime-private目录；具体Claim为0600、single-link、
`transaction-artifact`，只准入`exclusive-create + exact-retire`。Fresh新增独立
`materialize-shared-coordination-layout`步骤；Recovery接受并补齐精确安全前缀，Reconcile补齐旧
工作区缺失目录，Fresh遇到预存目录则阻断。目录检查不枚举或删除合法活动Claim文件。

资源矩阵声明后又通过真实Fresh入口验证物理Claim根确实创建为0700，修复了“Schema/Matrix存在但
执行器未消费”的初始缺口。双宿主候选制品重新闭合，公共MCP仍保持原3项工具。

### 178.4 明确未进入的范围

- Claim Store不决定业务准入或释放时机；
- 尚未新增`delivery.target-host-effect-claimed.v1`事件或Aggregate phase；
- 尚未实现Claim文件→Demand事件的跨资源前向恢复；
- 尚未生成TargetDeliveryAgentHostAction、瞬时absolute workspace root或最终宿主prompt；
- 尚未执行host send/readback，也没有outcome/rearm/TargetResult/Review；
- Preparation仍未公开为半成品MCP流程。

### 178.5 聚焦验证

```text
Direct affected TypeScript tests: 23 pass / 0 fail / 0 skip
Claim: deterministic codec, no-TTL shape, time/digest/schema rejection
Claim Store: zero-write inspect, create/current/occupied, concurrent winner, exact release
Static Matrix + Preview + Step Executor + real Fresh entrypoint: pass
Dual-host candidate build + official stdio tools: pass / same 3 tools
TypeScript: pass
Architecture: pass / parser=swc / 466 modules / 2995 dependencies / 0 violations
Schema: pass / 42 schemas / 97 external refs
Schema digest: sha256:11392a833d2b35e89e76aa714e612899eaba6b4c60d1e9223a54b611bbe284f2
git diff --check: pass
```

验证未运行旧JS、完整TS套件、旧插件validator/smoke或release gate。

## 179. DELIVERY-004（Target Host Effect Claim Event）

### 179.1 Event Sourcing 与 Aggregate 闭合

本单元把已准备的单目标 Delivery 推进到“宿主效果已取得当前工作权”，但仍不声称发送已经发生：

```text
target: delivery-prepared
  → WindowWorkClaim exclusive-create
  → command: delivery.claim-target-host-effect.v1
  → event: delivery.target-host-effect-claimed.v1
  → target: host-effect-claimed + minimal workClaim summary
```

`delivery.target-host-effect-claimed.v1`把完整`WindowWorkClaim`作为不可变事件数据，进入既有事件
类型目录、当前版本writer、version-evolution Registry、upcaster、pure Decider与Aggregate reducer。
Aggregate只保留`claimId/ref/digest/claimedAt/hostObservationAuthorityDigest`，完整Claim继续由事件与
当前共享协调文件持有。

Claim内声明的`commitId + expectedStreamRevision`现在由Event Stream Commit在两处复验：写前准备
拒绝错配，磁盘完整重放也拒绝错配；`expectedStateDigest`继续由Aggregate reducer绑定前置状态。
因此调用方即使错误地把同一Claim装入另一Commit，既不能写入，也不能通过后续audit。Aggregate
新增外部路径/时间Schema引用后，Snapshot运行时Schema目录同步补齐传递依赖，避免生成类型通过但
Ajv严格编译失败。

### 179.2 Claim Service 与瞬时 TargetDeliveryAgentHostAction

`TargetHostEffectClaimService`固定执行：

```text
严格request + 当前Agent observation
  → 完整Demand audit定位唯一prepared Intent
  → 当前Config / Aggregate / private Binding / observation闭合
  → 读取逐window共享Claim
  → 创建新Claim或复用同一未提交Claim
  → Claim Event Commit容量与状态转换预检
  → 再次复验Config、Binding和observation
  → append唯一Claim Event
  → 仅首次committed返回TargetDeliveryAgentHostAction
```

Action是一次调用链内的冻结对象，不持久化。它携带最终prompt、absolute workspace root的JSON
字符串表示、脱敏route、Claim tuple、Claim Event receipt，以及**本次当前observation**的digest/
observedAt；它不携带raw handle。普通首次Claim中当前observation与Claim记录相同；崩溃恢复时，
Claim仍保留最初观察，而Action明确绑定恢复调用提交的新鲜观察，供后续宿主operation fence复验。
本服务本身不调用Codex或Claude宿主能力。

五分钟限制只属于Action签发前的Agent observation freshness，不是Claim TTL。Claim不会因时间推移
或进程退出自动失效；一个较早但仍合法的未提交Claim，可以由同一当前Binding的一份新鲜观察前向
完成，不会因最初观察变旧而形成永久占用。

### 179.3 双资源失败恢复

Claim文件与Demand事件位于两个独立本地资源边界，当前文件内核不能把二者伪装成单次原子事务。
实现采用显式的语义占用与可恢复编排：

- Claim先创建并预分配稳定claim/event/commit身份；事件缺失时重试使用原身份前向提交；
- Claim已存在且属于其他工作时返回`occupied`，不触碰对应Demand事件；
- Claim已创建但事件确定未写入，Config/Binding/预检失败会忽略原取消信号执行exact release；
- 无法证明事件或Claim当前状态时保留`unknown/recovery-required`，不猜测回滚；
- 事件首次提交才签发Action；commitId幂等重试返回`already-claimed + action=null`，不重新授权发送。

该选择与[AWS Saga continuation/compensation与幂等参与者建议](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga-patterns.html)
一致；同时接受[Microsoft Transactional Outbox对独立dual-write的限制说明](https://learn.microsoft.com/en-us/azure/architecture/databases/guide/transactional-out-box-cosmos)：
Wakeflow当前没有可覆盖两个本地资源的数据库事务，因此没有把本实现命名为outbox或声称exactly-once
host effect，而是使用exclusive Claim、Event CAS、稳定身份、前向恢复和可证明时的精确补偿。

### 179.4 测试维护与剪枝

- 两条崩溃恢复测试共用一个局部`seedUncommittedClaim` helper，删除重复的约40行事件前缀搭建；
- Action nominal/current-observation/no-raw-handle断言留在真实Claim Service纵切，不另建等价集成套件；
- Aggregate、Decider、Command Handler、upcaster与state-version各自只补一条Claim相邻断言；
- 首次审阅发现的Schema传递依赖、post-Claim错误authority误报、取消信号阻断补偿、旧observation
  阻断非过期Claim恢复及Commit/Claim身份脱节均以回归测试或既有完整audit覆盖关闭。

### 179.5 明确未进入的范围

- 没有执行host send/readback，也没有保存raw handle或宿主工具结果；
- 没有Delivery outcome、ambiguous/rejected分类、rearm generation或Claim释放业务owner；
- 没有TargetResult、Controller Review、TestCard、completion或archive；
- 没有新增公共MCP/CLI；现有公共工具面保持不变，Preparation/Claim仍是内部纵切；
- 没有SQLite、消息代理、后台outbox worker、通用Saga框架或旧Group/Packet/Envelope兼容层。

### 179.6 聚焦验证

```text
Foundation Time + Demand + Delivery TypeScript tests: 61 pass / 0 fail / 0 skip
Claim Service scenarios: first issue; idempotent retry; occupied; stale observation;
  Claim-before-Event forward recovery; fresh-observation recovery; post-Claim Binding drift compensation
TypeScript: pass
Architecture: pass / parser=swc / 473 modules / 3083 dependencies / 0 violations
Schema: pass / 43 schemas / 100 external refs
Schema digest: sha256:d9f870628ecbf9134fceb30822f1b1e21c87e67489cb36ecb75c0585e791c535
git diff --check: pass
```

验证只执行当前Foundation Time与新版Demand/Delivery TS范围；未运行旧JS、完整TS测试、插件
validator/smoke、`npm test`或release gate。

## 180. DELIVERY-005（Agent-observed Target Host Effect Outcome）

### 180.1 宿主效果与readback双轴合同

旧JS已经把transport与readback分开，但旧Codex指令曾把普通error-like结果直接解释为
`rejected-before-send`。该推断没有进入新TS。官方资料表明：

- [Codex App Server](https://developers.openai.com/codex/app-server)的`turn/start`成功响应只创建
  `inProgress` turn，完成由后续事件表达；JSON-RPC transport失败不能自动等同于宿主明确拒绝；
- [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/agent-loop)区分带ResultMessage的错误终态
  与连接/进程失败且没有ResultMessage的情形；后者不能证明prompt从未被接受；
- [AWS幂等API指南](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)
  明确说明无响应会留下side effect是否发生的不确定性，非幂等调用不能据此自动重试。

因此`TargetDeliveryHostEffectObservation`固定为两个独立维度：

```text
attempt.status = accepted | indeterminate | rejected-before-effect
readback.status = confirmed | pending | unavailable
```

`confirmed`可把缺少确定调用回执的`indeterminate`提升为最终`accepted`；
`rejected-before-effect`只允许`unavailable` readback。`sent-unconfirmed`仅作为
`accepted + pending/unavailable`的展示派生，不进入事件或Aggregate状态。

创建入口短暂接收宿主结果/readback的被动JSON，分别执行128KiB容量检查并只保存Canonical
SHA-256摘要。raw handle、完整宿主返回、错误文本、prompt和absolute workspace root都不会进入
Observation、Event、Aggregate、错误或公共结果。

### 180.2 Action命名与Event Sourcing

原`AgentHostAction`实际只包含Target Delivery字段，已在未发布阶段直接收窄为
`TargetDeliveryAgentHostAction`，同步修改运行时kind、错误代码、文件名和唯一producer，不保留
兼容alias。Action的workClaim tuple补齐expected state/Claim Commit身份，使后续Observation所有
并发字段都能由Claim、Aggregate和Event replay直接复验，而不是只依赖Service调用路径。

新增：

- `delivery.target-host-effect-observed.v1`事件、current writer、Registry、upcaster与Decider；
- Aggregate phase：`host-effect-accepted | host-effect-indeterminate | host-effect-rejected`；
- 最小hostEffect summary：observation digest、最终disposition、readback status、observedAt，以及
  `retain | release-authorized` Claim处理策略；
- Observation Event/Commit ID从唯一Claim ID的UUID在typed namespace中稳定派生，写前准备与完整
  audit同时复验Commit边界。

完整Observation仍只存在于Event；Aggregate不复制evidence digest或原始attempt内容。

### 180.3 Outcome Service与失败恢复

`TargetHostEffectOutcomeService`固定执行：

```text
严格outcome request
  → 完整audit定位原Claim Event
  → 由stored Claim Event恢复Action闭合元组
  → 脱敏attempt/readback evidence
  → preflight + append observed Event
  → accepted/indeterminate保留Claim
  → rejected-before-effect在Event提交后exact release Claim
```

Outcome是已经发生的历史观察，因此不会因效果之后的Config/Binding漂移而拒绝记录。它仍要求当前
Claim/Event/Aggregate lineage精确一致。若进程在rejected Event提交后、Claim释放前退出，重试先
按同Commit幂等确认Event，再只完成原Claim的exact release；Event与Claim任一无法证明时保留
`unknown/recovery-required`，不猜测释放或重新发送。

### 180.4 明确未进入的范围

- Wakeflow不执行Codex/Claude send/readback，不分类未提供的真实宿主对象；Observation明确是Agent
  observation，不伪装成宿主签名证明；
- accepted/indeterminate不会获得自动retry或Claim释放权限；
- 尚无TargetResult、Controller acceptance、Review、Test或completion；
- 尚未新增公共MCP/CLI，当前仍是内部consumer-driven纵切。

## 181. DELIVERY-006（Explicit Target Host Effect Rearm）

### 181.1 Rearm业务事实

`TargetHostEffectRearm`只接受当前精确`host-effect-rejected + release-authorized`尾部，绑定：

- demand/targetTask/targetDelivery；
- rejected Claim ID/digest与原Claim Event/Commit；
- 唯一rejected Observation digest；
- rearmedAt与self-excluding rearm digest。

`delivery.target-host-effect-rearmed.v1`只把Target恢复为`delivery-prepared`，不会复用旧Claim、复制旧
outcome或跨越宿主效果边界。Rearm Event使用原Claim Commit的独立随机UUID，Rearm Commit使用原
Claim Event的独立随机UUID；二者进入不同typed namespace并由Event Stream Commit复验，重试无需
重新分配身份。测试fixture原先人为复用的跨类型UUID已换成该测试域唯一值，未放宽真实冲突门禁。

### 181.2 Rearm Service与Binding基础能力

首次Rearm要求：

```text
exact rejected Observation tail
  + old Claim physically absent
  + current Config仍匹配原Intent
  + current private Binding仍匹配原route
  → append唯一Rearm Event
  → delivery-prepared
  → 后续Claim必须创建全新WindowWorkClaim
```

当前Binding inventory准入从Claim专用authority抽为窄的`TargetDeliveryBindingAuthority`，供Claim与
Rearm共同使用；它不持有workspace、不解释outcome、不创建Delivery manager，也不执行宿主能力。
已提交Rearm重试从完整事件历史恢复同一Rearm/Commit，不重新读取后来Config/Binding，也不会因下
一代Claim已经存在而篡改历史回执。

accepted与indeterminate outcome无法Rearm；旧Claim未完成释放、Observation不是精确尾部、Config或
Binding漂移都会在Rearm Event前阻断。真实纵切验证Rearm后再次调用Claim Service会签发不同Claim
ID的全新Action，没有send generation数字或隐藏自动重试状态。

### 181.3 聚焦验证

```text
Demand + Delivery TypeScript tests: 67 pass / 0 fail / 0 skip
Outcome: accepted retain; indeterminate retain; rejected exact release;
  Event-committed/Claim-present forward recovery; exact idempotent replay
Rearm: rejected-only; old Claim absent; Config/Binding current; idempotent replay;
  next attempt requires a new Claim; accepted blocked
Event Sourcing: observed/rearmed codecs, reducer phases, stable Event/Commit boundaries,
  upcaster, full local File Event Store replay and command idempotency pass
TypeScript: pass
Architecture: pass / parser=swc / 491 modules / 3244 dependencies / 0 violations
Schema: pass / 47 schemas / 113 external refs
Schema digest: sha256:ba300d69704783c3054db425d54a4300b27f6729c63f81d432538e58eb1429e9
git diff --check: pass
```

验证未运行旧JS、完整TS套件、插件validator/smoke、`npm test`或release gate；没有提交、发布或刷新
安装cache。

## 182. DELIVERY-007（Agent Report与TargetResult记录）

### 182.1 Report与Result分层

旧JS的结果对象同时混有窗口陈述、投递关系、Controller判断、Group/Envelope文件引用、Test映射与
多仓库数组。当前切片没有平移该形态，而是按事实来源拆成两层：

```text
TargetResultReport
  = Agent提交的业务陈述、单仓库变更、验证、风险与anchor evidence

TargetResult
  = Wakeflow用TaskPackage + Intent + Claim + Host Effect Event补齐的不可变记录
```

`completed | blocked | needs-review`都只是Agent对本次目标工作的陈述。三者都可以进入后续Review，
但任何一个值都不表示Controller acceptance、Demand完成或证据已经被相信。`completed`必须完整映射
TaskPackage的acceptance anchors并符合`commit | leave-uncommitted`约定；`blocked`与`needs-review`
允许只提供已取得的部分anchor evidence或不提供anchor evidence。所有anchor引用必须指向本Report
已声明的evidence locator，防止出现无法解析的悬空证据。

v1只接纳当前真实纵切需要的单仓库`implementation`结果。旧JS中的Group/Envelope结果文件、Test
字段映射、supersedes/correction轮次和多仓库结果数组没有作为未来占位进入Schema；只有出现真实
consumer后才扩展。

### 182.2 Git对象身份基础能力

结果记录不再把commit写成固定40位的模糊字符串。Foundation新增显式Git object ID：

```text
{ algorithm: "sha1", value: <40位小写完整OID> }
{ algorithm: "sha256", value: <64位小写完整OID> }
```

这与[Git SHA-256迁移文档](https://git-scm.com/docs/hash-function-transition/2.52.0.html)对两种对象格式
和完整对象名的定义一致。基础层拒绝缩写、大写与算法/长度错配，不执行Git命令，也不把branch、
working tree或宿主权限引入结果合同。Report同时约束`committed`必须至少声明一个commit；
`left-uncommitted | no-changes`不能伪装成已提交状态。

### 182.3 Event Sourcing状态转换

新增`result.target-result-recorded.v1`事件、current writer、version codec、upcaster、pure Decider、
Command Handler边界与Repository历史查询。Aggregate从
`host-effect-accepted | host-effect-indeterminate`推进到`result-reported`，只保存：

- TargetResult ID、digest、outcome与reportedAt；
- 精确Claim处理结论`release-authorized`；
- TaskPackage在后续Review真实需要的commit expectation与acceptance anchor IDs。

完整Report与Result保留在Event中，Aggregate不复制验证、风险、commit或evidence locator。Result
Event的recordedAt绑定Report的reportedAt；Result、Event与Commit身份从原Claim的稳定UUID在不同
typed namespace中派生，并与Rejected Rearm路线保持不同身份。完整stream replay会重新执行相同
关系验证，而不是只相信写入服务。

### 182.4 Import Service与Claim结算

`TargetResultImportService`固定执行：

```text
严格Result import request
  → 从事件历史恢复TaskPackage / Intent / Claim / Observation
  → 验证当前accepted或indeterminate尾部
  → 生成Agent Report与authority-enriched TargetResult
  → preflight + append result.target-result-recorded.v1
  → Event成功后exact release原WindowWorkClaim
```

accepted或indeterminate只证明宿主效果没有在发送前被拒绝，因此两者都允许Agent提交真实结果；
`rejected-before-effect`不能产生TargetResult。Result提交后释放Claim表示本次窗口工作占用已经结算，
不是接受结果。共享的`settleAuthorizedWindowWorkClaimRelease`只负责在领域Event已经授予释放权后执行
精确物理释放，没有升级成通用事务管理器。

若进程在Result Event提交后、Claim释放前退出，重试必须提交相同Report内容摘要，按同一Commit确认
幂等历史后只完成exact release；Event缺失但Claim已经消失则返回显式恢复要求，不猜测已完成。
Result描述的是已经发生的工作，因此导入时不以之后的Config或Binding漂移否定历史，但仍闭合原
TaskPackage、assignment、Claim、Observation和当前Aggregate尾部。

### 182.5 测试维护与明确边界

- fixture从真实TaskPackage Event恢复动态acceptance anchors，避免静态测试数据与真实纵切分叉；
- 独立覆盖SHA-1/SHA-256、Report矛盾、Result来源闭合、completed完整anchors、blocked空anchors、
  rejected阻断、accepted/indeterminate结算、幂等导入与Event已提交/Claim仍存在的恢复；
- Command Handler测试明确验证错误Commit身份返回decision-rejected，不只验证Service happy path；
- 尚未实现Controller Review、accept/rework/block决策、Test/Evidence归档、公共MCP或自动completion；
- 没有引入SQLite、Git进程调用、结果目录、通用Workflow manager或旧JS兼容分支。

### 182.6 聚焦验证

```text
Foundation Git + Demand + Delivery + Result TypeScript tests: 79 pass / 0 fail / 0 skip
Result: Report closed content; SHA-1/SHA-256; source lineage; completed/full anchors;
  blocked/empty anchors; rejected blocked; accepted/indeterminate import;
  exact idempotency; Event-committed/Claim-present forward recovery
TypeScript: pass
Architecture: pass / parser=swc / 507 modules / 3365 dependencies / 0 violations
Schema: pass / 51 schemas / 129 external refs
Schema digest: sha256:746d72a3d545f3b17dc839666f6c36b879cdc789e7f5c7e9619a1f2d340ccb0e
git diff --check: pass
```

验证只执行当前Foundation Git与新版Demand/Delivery/Result TS范围；未运行旧JS、完整TS套件、插件
validator/smoke、`npm test`或release gate。没有提交、发布或刷新安装cache。

## 183. DELIVERY-008（Demand Result Review Snapshot）

### 183.1 从旧Review系统剪枝

旧JS的Review入口建立在`DispatchGroupReviewSnapshot + immutable ReviewCandidate + Controller
Decision`上，并同时计算group return policy、callback units、allowed decisions与next action。这些
能力服务于旧DispatchGroup、Packet、Envelope、Test和多轮replacement体系；当前TS尚无对应真实
producer，直接平移会让Review再次成为提前拥有未来业务的第二状态机。

当前单元只保留旧实现中两项仍然正确的原则：

1. 当前结果必须由Aggregate selector与不可变Event形成exact closure，不能按目录、mtime或调用方
   自报选择；
2. Controller看到的审查输入必须绑定精确Event Stream基线，后续写决定时可以识别陈旧输入。

没有创建`ReviewCandidate`文件、Candidate ID、group、return policy、allowed decisions、next action、
structural gaps或pending review状态。是否需要持久化Candidate留给未来真实Controller Decision
consumer验证，不把早期计划当成当前命令。

### 183.2 CQRS与Event Sourcing选择

[Microsoft CQRS指南](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs)明确区分会改变
状态的Command与零写Query，并建议读模型按查询需要形成DTO或projection；同时警告CQRS与Event
Sourcing组合会增加显著复杂度。[Microsoft Event Sourcing指南](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)
和[AWS Event Sourcing指南](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/event-sourcing-pattern.html)
都把append-only Event Store视为事实来源，把read model/materialized view视为可由事件重建的
只读投影。

Wakeflow当前Demand流已限制为最多10000个Commit、64MiB总事件字节，因此选择同步、按需、一次
完整扫描的内存读模型：没有第二个read store、后台projector、projection checkpoint或eventual
consistency窗口。若未来测量证明Review读取成为瓶颈，再以同一Event Stream重建可丢弃缓存；当前
不为尚不存在的读取压力增加持久化协议。

### 183.3 中立History查询与Review解释分层

`DemandEventSourcingRepository.auditTargetResultHistory()`一次读取并完整重放Event Stream，同时只
投影两类不可变来源：

- 每个Target Task唯一的`tasking.target-task-planned`来源；
- 全部`result.target-result-recorded`历史来源。

Repository复验TaskPackage ID/digest、assignment、commit expectation、ordered acceptance anchor IDs，
并把Aggregate当前`result-reported` selector闭合到精确TargetResult ID/digest/outcome/reportedAt。
它只返回Event ID/digest/revision和完整领域载荷，不导入Review模块，也不解释Result应该被接受、
返工或阻断。

上层`DemandResultReviewSnapshot`再把当前Target Task投影成closed union：

```text
awaiting-result
  = 当前phase + TaskPackage tuple + assignment

reported
  = 完整TaskPackage + 完整TargetResult + 两个source Event tuple
    + reviewUnitDigest
```

目标按`targetTaskId`确定性排序。每个reported unit拥有独立`reviewUnitDigest`；整个Snapshot同时绑定
Demand lifecycle、Commit/Stream游标、tail Event、state digest与`snapshotDigest`。这为未来单目标
或整组决定分别提供精确并发基线，但本单元不提交决定。

Snapshot只存在于进程内，读取前后Event Store inventory不变。它没有持久化或公共wire consumer，
因此当前不新增JSON Schema；`kind/schemaVersion`只稳定内部DTO识别。未来若公共MCP真实输出该合同，
必须在那个切片补齐Schema与producer/consumer同步验证，而不是提前冻结半成品公开格式。

### 183.4 当前边界与下一Consumer

- Snapshot不会验证target声明的证据内容，也不会运行Git、测试或仓库检查；
- `completed | blocked | needs-review`原样作为Agent outcome呈现，不转换成review readiness；
- 没有Controller actor、decision reason、独立检查记录、accept/rework/redesign/blocked事件；
- 没有Demand完成、Test准入、TODO rollup、Controller-return或公共MCP；
- 读取入口要求调用方已经安全打开Demand Event Sourcing根，完整Config/Ledger/authority组合属于未来
  Review Pack consumer，不被本读模型暗中接管。

下一单元应先设计`Controller Review Decision`的真实业务事件与审查记录：决定必须引用精确
`reviewUnitDigest`或`snapshotDigest`，Command Handler在当前Aggregate上重新计算并通过Event Stream
optimistic CAS提交；不能因为Snapshot存在、Agent outcome为completed或结构无缺口而自动accept。

### 183.5 聚焦验证

```text
Foundation Git + Demand + Delivery + Result + Review TypeScript tests: 81 pass / 0 fail / 0 skip
Review Snapshot: awaiting-result closed variant; real Claim/Outcome/Result import;
  single-stream current closure; deterministic unit/snapshot digests; repeated zero-write read;
  no Candidate/allowedDecisions/nextAction; strict root/options input
TypeScript: pass
Architecture: pass / parser=swc / 509 modules / 3391 dependencies / 0 violations
Schema: pass / 51 schemas / 129 external refs (unchanged)
Schema digest: sha256:746d72a3d545f3b17dc839666f6c36b879cdc789e7f5c7e9619a1f2d340ccb0e
git diff --check: pass
```

验证只执行当前Foundation Git与新版Demand/Delivery/Result/Review TS范围；未运行旧JS、完整TS套件、
插件validator/smoke、`npm test`或release gate。没有提交、发布或刷新安装cache。

## 184. DELIVERY-009A（Controller Target Review Decision合同）

### 184.1 无Candidate路线的决定记录

用户确认采用DELIVERY-008推荐方案A：不持久化ReviewCandidate。当前文件单元先建立
`ControllerTargetReviewDecision`不可变合同，下一单元才接入Demand Event Sourcing与Aggregate。

旧JS决定事件只保存Candidate/Group/Result Set与`reason/decisionSummary`，审查事实主要留在Controller
自由文本中。新合同删除当前没有producer的Candidate、Group、return policy和result-set scope，改为
绑定一个真实Target的精确读模型基线：

- `snapshotDigest + reviewUnitDigest`；
- reviewed `stateDigest + streamRevision`；
- TaskPackage ID/digest；
- TargetResult ID/digest/outcome/reportedAt；
- Controller逻辑Window ID、决定时间与决定自身typed ID/digest。

`target-review-decision`进入durable ID活动词汇，因为本合同已同时拥有真实持久字段、创建器和后续
Event consumer。Decision/Event/Commit从一个新UUID进入三个独立typed namespace；没有随机ID池、
Candidate ID或调用方自由声明Event身份。

### 184.2 Controller独立审查内容

[NIST SP 800-53 Rev.5 AU-3](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-53r5.pdf)
要求审计记录能够确定事件类型、时间、位置、来源、结果和关联主体。Wakeflow不是安全审计产品，
但该最小事实集合适合作为Controller业务决定记录的结构参考。因此Decision除actor/subject/time/outcome
外，还保存：

```text
assessment.requirementAlignment
  = aligned | mismatch | unresolved

assessment.implementationQuality
  = satisfactory | defective | unverified

independentChecks[]
  = checkId + method + passed|failed|inconclusive + observation
```

`rationale`说明最终决定，`blockingReasons`只表达阻断，`residualRisks`保留已识别但不阻断的风险。
这些字段仍是Controller的可审计陈述，不是机器对代码真实性的证明；TargetResult、自报测试或结构
完整性不会自动生成它们。

### 184.3 四类决定的closed relation

| Decision | Requirement alignment | Implementation quality | 独立检查与阻断关系 |
| --- | --- | --- | --- |
| `accept` | `aligned` | `satisfactory` | 所有check必须passed；无blocking reason；不能接受blocked TargetResult |
| `rework` | `aligned` | `defective` | 至少一个failed check；无hard blocking reason |
| `redesign` | `mismatch` | 任一明确quality状态 | 至少一个failed或inconclusive check；无hard blocking reason |
| `blocked` | 不得同时为aligned+satisfactory | 不得同时形成可接受闭包 | 至少一个blocking reason |

该矩阵把产品代码缺陷与需求不匹配分开，也不引入`reworkCount`、自动第三次升级、Design路由或后续
TaskPackage。Controller仍可在下一事件单元中提交事实，后续owner再消费状态。

### 184.4 Event顺序不依赖墙上时钟

初稿要求`decidedAt > targetResultReportedAt`。文件复审时依据Foundation Wall Clock合同和
[Microsoft Event Sourcing指南](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)
撤销了该条件：墙上时钟可能重复或回拨；事件因果顺序应由current state、stream revision和
optimistic concurrency append保证。Decision继续保存严格UTC审计时间，但相同或回拨的合法时间
不会否定Event Store已经证明的先后关系。下一单元必须只允许从精确`result-reported`状态追加决定。

### 184.5 Schema与防御性JSON边界

Schema负责closed字段、容量、四类决定组合与基础词法；TS parser补充NFC、well-formed Unicode、
重复check ID、重复文本、typed ID、stream position和self digest。

聚焦测试还发现Ajv `uniqueItems`对无原型对象数组会进入第三方deep-equal的`valueOf`假设并抛出
TypeError。没有因此放宽Foundation的防御性JSON快照或恢复普通原型：对象集合的业务唯一键本来
就是`checkId`，所以对象数组由TS parser按该键判重；纯字符串列表继续使用Schema
`uniqueItems`并在parser复验。

### 184.6 明确未进入的范围

- 尚未新增`review.target-result-decided.v1`Event、Command、upcaster或Aggregate phase；
- 尚未验证Controller Window与当前Config拓扑关系；该关系属于下一个Service consumer；
- 尚未从`DemandResultReviewSnapshot`自动组装创建输入或执行stale重算；
- 尚未实现accept后的Test准入、rework重新Delivery、redesign路由、blocked解除或Demand完成；
- 没有ReviewCandidate文件、公共MCP、Git命令、外部Evidence capture或自动acceptance。

### 184.7 聚焦验证

```text
Foundation Git + Demand + Delivery + Result + Review TypeScript tests: 84 pass / 0 fail / 0 skip
Controller Decision: deterministic codec/digest; typed Decision/Event/Commit identity;
  four-decision relation matrix; duplicate check ID; illegal UTC; non-NFC text;
  digest drift; repeated wall-clock instant retained without ordering authority
TypeScript: pass
Architecture: pass / parser=swc / 512 modules / 3415 dependencies / 0 violations
Schema: pass / 52 schemas / 135 external refs
Schema digest: sha256:9fd9eaa657e13f6fa932d70f76f218ac599d94a8ebd8b9d47d5be735965fd4d9
git diff --check: pass
```

验证只执行当前Foundation Git与新版Demand/Delivery/Result/Review TS范围；未运行旧JS、完整TS套件、
插件validator/smoke、`npm test`或release gate。没有提交、发布或刷新安装cache。

## 185. DELIVERY-009B（Controller Review Decision Event）

### 185.1 修订原文件顺序

原计划把`review.target-result-decided.v1`的Event/codec/upcaster与Aggregate reducer拆成两个文件
单元。Event registry接线后的集成复审证明该顺序不安全：`DemandUncommittedEvent`一旦承认新类型，
generic upcaster就会把它交给`evolveDemandEventSourcingState()`；如果Reducer没有显式分支，旧尾部
会把该事件错误落入Demand cancel转换。

因此本单元把范围扩到**最小可重放闭环**，而没有留下“Schema可写但历史不可重建”的中间状态：

```text
ControllerTargetReviewDecision
  → review.target-result-decided.v1 data Schema
  → current event model
  → v1 codec Registry
  → generic upcaster
  → pure Decider
  → Aggregate reducer
  → Commit boundary
  → File Event Store full replay
  → Demand Result Review Snapshot
```

该修订遵循[Microsoft Event Sourcing指南](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)
关于事件是业务意图、事件流是事实来源且新状态必须可重放的原则。早期文件顺序不再高于当前代码
不变量。

### 185.2 Event家族与版本演进

新增`review.target-result-decided`当前事件家族，v1 data只包含完整
`ControllerTargetReviewDecision`。Aggregate summary、后续route、Candidate或公共MCP参数不复制进
Event data。

`DEMAND_EVENT_SOURCING_EVENT_TYPES`、current/supported version矩阵和
`EventSourcingVersionEvolutionRegistry`登记v1 codec。通用upcaster本身无需增加特殊分支：它继续按
`eventType + eventVersion`查Registry，再投影为当前Event模型。未知版本、额外data字段、错误Decision
Event ID、demand或recordedAt关系仍在Reducer前失败。

新增事件家族会改变`versionCompatibilityDigest`，因此旧Snapshot会安全回退到完整Event replay；
没有修改历史Event字节或伪造Snapshot兼容。

### 185.3 Aggregate最小状态矩阵

完整Decision继续只存在于Event；Aggregate在原`currentDelivery.targetResult`旁保存最小
`reviewDecision`摘要：

- Target Review Decision ID/digest；
- `accept | rework | redesign | blocked`；
- Controller Window ID；
- decidedAt。

Target phase显式映射为：

| Decision | Aggregate phase |
| --- | --- |
| `accept` | `accepted` |
| `rework` | `rework-requested` |
| `redesign` | `redesign-requested` |
| `blocked` | `review-blocked` |

Reducer只接纳当前`result-reported`目标，复验Demand/Target、TaskPackage、TargetResult
ID/digest/outcome/reportedAt及Decision reviewed state digest。已决定目标不能被第二次决定；其他Target
不受影响。该状态只记录已经发生的决定，不执行Test准入、重新Delivery、Design路由、解除阻断或
Demand完成。

### 185.4 双重陈旧防护与稳定提交身份

Decision Event/Commit ID从Decision typed ID的唯一UUID派生。Commit边界同时要求：

```text
commitId == controllerTargetReviewDecisionCommitId(decision)
decision.reviewed.streamRevision == commit.expectedStreamRevision
decision.reviewed.stateDigest == current Aggregate state digest
```

state digest由pure reducer复验，stream revision由Commit planner/完整磁盘replay复验。错误Commit ID、
陈旧Snapshot revision和陈旧state digest都会在文件副作用前失败。墙上时钟仍只作为审计事实，不
参与因果授权。

聚焦fixture复审还发现Decision UUID与既有Claim Event UUID重复。虽然Decision、Event、Commit属于
不同typed namespace，同一Event Stream内两个Event ID仍不得复用；fixture已换成测试域唯一UUID，
没有削弱Event Store的全历史identity conflict检查。

### 185.5 Review读模型跟进

Repository的一次扫描history投影现在同时收集TaskPackage、TargetResult和Review Decision来源，按
当前Aggregate selector闭合Decision ID/digest/type/controller/time。`DemandResultReviewSnapshot`
新增`review-decided` closed variant，返回原TaskPackage、TargetResult、Decision及三条source Event
tuple；它会重新计算原reported unit digest并与Decision reviewed digest比较。

Snapshot仍是零写CQRS读模型。它展示已经发生的决定，但不生成新决定、Candidate、allowed decision
或next action。

### 185.6 明确未进入的范围

- 尚无`ControllerTargetReviewDecisionService`、请求/options合同或公共MCP；
- 尚未以当前Config复验`controllerWindowId`确实属于Controller角色；
- 尚未在提交前由Service重读完整Config/Ledger authority并重算Snapshot；
- 尚未实现rework重新投递、redesign replacement、blocked解除、TestCard或Demand completion；
- 没有Group、ReviewCandidate、自动第三次rework升级或Controller-return transport。

### 185.7 聚焦验证

```text
Foundation Git + Demand + Delivery + Result + Review TypeScript tests: 85 pass / 0 fail / 0 skip
Review Event: v1 data codec; current event registry; generic upcast; event identity;
  four Aggregate phases; stale state rejection; stale stream revision rejection;
  wrong commit rejection; deterministic prepare/apply; real File Event Store full replay;
  review-decided Snapshot closure
TypeScript: pass
Architecture: pass / parser=swc / 515 modules / 3447 dependencies / 0 violations
Schema: pass / 53 schemas / 136 external refs
Schema digest: sha256:6a381d2ca6e59a72e1208866bee5e624f9e264a087b3ff94454b64e6db169f6c
git diff --check: pass
```

验证只执行当前Foundation Git与新版Demand/Delivery/Result/Review TS范围；未运行旧JS、完整TS套件、
插件validator/smoke、`npm test`或release gate。没有提交、发布或刷新安装cache。

## 186. DELIVERY-009C（Controller Review Decision Service）

### 186.1 无Candidate的直接决定请求

新增严格`ControllerTargetReviewDecisionRequest`，调用方只提交：

- Demand/Target Task/TargetResult精确identity；
- 原`DemandResultReviewSnapshot.snapshotDigest`与reported unit digest；
- 已在009A闭合的decision、双轴assessment、独立检查、rationale、blocking reasons与residual risks。

请求不接受Decision ID、Event/Commit ID、Controller Window ID、state digest、stream revision或决定时间。
这些字段分别由Service从随机UUID、当前Config、当前Review history和墙上时钟产生，避免调用方伪造
authority或持久位置。

Input parser在任何时钟/UUID读取前完成closed own-data、typed ID、摘要、NFC文本、容量、重复check ID
和四类judgment relation验证。额外字段、稀疏数组、accessor/proxy、陈旧摘要或不一致判断都不会先
分配身份，也不会写Event。

### 186.2 当前Controller逻辑authority

Service通过`DemandOperationAuthorityContext`打开当前Config、Ledger与Demand root，Controller Window
只从`config.indexes.controllerWindow`派生，同时闭合：

```text
current Config program
  == Demand identity program
  == reviewed TaskPackage program
```

这证明Decision记录使用当前配置中的唯一**逻辑Controller职责窗口**，但不伪装成宿主调用者认证：
Service没有raw thread handle、host session签名或Agent身份凭据。公共MCP/宿主入口未来仍必须保证只有
Controller职责窗口调用该Service。

### 186.3 Snapshot重算与提交边界

首次决定固定执行：

```text
strict request/options
  → Demand组合authority
  → 一次完整TargetResult/Review history审计
  → 重建当前零写Review Snapshot
  → exact reported target/result/snapshot/unit tuple
  → 派生Controller Window并创建Decision
  → Event/Commit容量与状态转换preflight
  → 复验Config仍current
  → Command Handler optimistic CAS append
```

Service直接复用history同一次扫描得到的Aggregate与Review Snapshot，不按Target重复扫描。最初实现曾在
Command Handler成功后再次完整audit；性能复审确认append receipt与返回Aggregate已经证明提交，而
幂等/并发路径也已从history取得完整Decision，因此删除该第三次最多64MiB的冗余扫描。组合authority
仍执行自己的根/Ledger审计，Review history再执行一次需要完整载荷的审计；没有增加持久化read cache。

### 186.4 语义幂等与并发恢复

Decision ID首次调用随机分配，但幂等键不是新的随机值，而是“同一TargetResult已有唯一Decision”。
重试先按TargetResult历史查找Decision，并比较：

- demand/target/result identity；
- 原snapshot/unit digest；
- 完整Controller judgment digest。

完全相同则使用原Decision ID、decidedAt、Event和Commit调用Command Handler的existing-commit路径；
新的clock/UUID不会改变历史。任一判断字段不同则是显式state conflict，不会覆盖Decision。

两个相同请求并发且各自尚未看到Decision时，可以生成不同候选UUID；只有一个CAS append成功。失败
调用遇到concurrency/stream不确定性后重载完整history：若发现语义相同的已提交Decision，就改用其
原Commit幂等返回；若没有或内容冲突，则保持state/event错误，不猜测成功。

### 186.5 明确未进入的范围

- 没有ReviewCandidate、preview artifact、group reducer或第二状态机；
- 没有验证代码、Git diff、测试输出或Agent陈述真实性；这些必须在调用Service前由Controller完成；
- 没有执行rework重新投递、redesign Design route、blocked解除、TestCard或Demand completion；
- 没有公共MCP、CLI、Controller-return transport或宿主身份认证；
- 没有后台worker、SQLite、消息队列或持久化Review read store。

### 186.6 聚焦验证

```text
Foundation Git + Demand + Delivery + Result + Review TypeScript tests: 88 pass / 0 fail / 0 skip
Decision Service: current Config Controller derivation; exact Snapshot/unit/result closure;
  first committed decision; retry with different clock/UUID returns original identity/time;
  conflicting judgment rejection; stale/extra input zero-write before clock/UUID;
  concurrent same request converges to committed + idempotent and one stream revision
TypeScript: pass
Architecture: pass / parser=swc / 519 modules / 3485 dependencies / 0 violations
Schema: pass / 53 schemas / 136 external refs (unchanged)
Schema digest: sha256:6a381d2ca6e59a72e1208866bee5e624f9e264a087b3ff94454b64e6db169f6c
git diff --check: pass
```

验证只执行当前Foundation Git与新版Demand/Delivery/Result/Review TS范围；未运行旧JS、完整TS套件、
插件validator/smoke、`npm test`或release gate。没有提交、发布或刷新安装cache。

## 187. Review Decision消费者架构核实节点

### 187.1 当前TS事实矩阵

009A–C已经能可靠记录`accept | rework | redesign | blocked`，但四种结果的下游并不处于同一成熟度：

| 当前phase | 已有真实能力 | 仍缺少的首个consumer |
| --- | --- | --- |
| `accepted` | Decision/Event/Aggregate/Review history闭合 | Testing Decision reduction、Test Tasking或Demand completion |
| `rework-requested` | 原TaskPackage、Result与Decision历史均保留 | 携带精确返工原因的新Target Delivery |
| `redesign-requested` | 非bug mismatch事实已持久化 | Authority supplement与same-repository replacement lineage |
| `review-blocked` | hard blocker与独立检查已持久化 | 明确的人类输入恢复/重新审查事件 |

当前TaskPackage v1只支持`implementation`，没有Test、dependency、replacement、continuation或rework
brief；Planning reducer禁止同一Demand出现第二个同repository Target。Demand lifecycle只有
`active | cancelled`，尚无complete。Demand Authority在publication时永久冻结，后续TaskPackage只能
选择原authority引用。因此不能把四条route当成四个只差一个状态判断的并行小改动。

### 187.2 旧JS保留事实与反例

旧JS ordinary rework允许`needs-rework + accepted/ambiguous previous delivery`直接生成新的Envelope，
继续使用同一个TaskPackage；这证明“返工是同一任务的新执行attempt”是实际功能需求。旧TaskPackage
还拥有`replacesTargetTask`，redesign replacement要求同repository、精确旧package/result/decision
链。

但旧`blocked`决定把Demand置为blocked、Task置为needs-rework，代码中没有对应unblock/resume-review
路径，Delivery planning也不接受blocked Demand。这不是应继承的标准，而是旧实现真实存在的闭环
缺口。

### 187.3 当前blocked语义缺口

当前新TS进一步把“一份TargetResult只能存在一个Decision”作为Service幂等规则。该规则对
`accept/rework/redesign`成立，因为它们终结本次Result review；对`blocked`不成立：blocked表示等待
人类或外部事实，不应永久消费同一Result的审查资格。

[Microsoft Durable Task human-interaction pattern](https://learn.microsoft.com/en-us/azure/durable-task/common/durable-task-human-interaction)
把人工审批建模为持久等待，并通过明确external event恢复；[Durable Functions external-event指南](https://learn.microsoft.com/en-us/Azure/Azure-functions/durable/durable-functions-external-events)
同时要求唯一事件身份以处理at-least-once重复。[AWS Step Functions human approval](https://docs.aws.amazon.com/step-functions/latest/dg/tutorial-human-approval.html)
也让执行暂停到明确callback后再推进，而不是把等待状态当成不可恢复终态。

因此推荐保留blocked Decision不可变历史，同时新增精确`review-blocked → result-reported`恢复事件；
恢复后Controller必须重新读取输入和运行检查，再创建**新一代**Decision。不得原地改写旧Decision，
也不得从block resolution直接accept。

这要求把Decision幂等范围从：

```text
unique(TargetResult ID)
```

修正为类似：

```text
unique(TargetResult ID + reviewed Snapshot digest)
```

并由block-resolution Event绑定精确blocked Decision ID/digest和恢复依据。同一请求仍幂等，不同Review
generation保留完整历史。当前无需引入TTL；用户取消仍走独立Demand cancellation。

### 187.4 rework不是简单放宽phase

rework可以继续复用原不可变TaskPackage，不需要新任务或额外“rearm”批准；Controller的rework
Decision本身就是新attempt的业务授权。[AWS Step Functions redrive](https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html)
同样保留既有成功历史并从未成功步骤继续，新的attempt仍作为execution history出现。

但仅把Delivery Preparation的准入从`planned`放宽到`rework-requested`仍不完整：当前
`TargetDeliveryIntent`和prompt只描述原TaskPackage，目标窗口看不到Controller复现的缺陷、failed
checks或精确前Result。标准rework纵切至少需要：

- Intent区分`initial | rework`；
- rework source绑定Decision与TargetResult ID/digest；
- prompt携带有界Controller rationale/失败检查摘要，并继续以完整Decision Event作为authority；
- 新TargetDelivery、Claim、Observation与TargetResult身份；
- 旧Result/Decision只留历史，不复制到新TaskPackage或覆盖。

重复返工刹车继续从Event history读取真实prior rework decisions，不增加可漂移`reworkCount`字段。

### 187.5 accepted与redesign的真实前置

`accepted`之后必须读取冻结`testingDecision`：

- `controller-only`：具备进入Demand completion设计的资格，但complete还要闭合全目标、TODO与终态事件；
- `real-environment`：必须先建设TestCard与Test TaskPackage，当前implementation-only TaskPackage不能
  被临时复用为Test；
- `not-applicable`：当前只允许research，而research不能创建implementation TaskPackage。

`redesign`更深：新需求依据通常不在publication时冻结的Authority refs中；当前Planning又禁止同repo
replacement。正确实现必须先选择“immutable base Authority + append-only supplement”还是“新Demand”
等authority模型，再设计replacement lineage。不能先复制旧`replacesTargetTask`字段并假装新Requirement
Design已获授权。

### 187.6 剪枝后的推荐顺序

```text
R-0  blocked Decision generation + explicit resume-review Event
  ↓
R-1  rework-aware TargetDeliveryIntent + same-TaskPackage new attempt
  ↓
R-2  accepted-target gate读取testingDecision
  ├─ controller-only → Demand completion纵切
  └─ real-environment → TestCard/Test Tasking纵切

R-3  redesign Authority supplement + replacement lineage（单独设计确认）
```

这里不新增通用Workflow manager、Group、ReviewCandidate、全局attempt counter或四条route统一抽象。
Snapshot/Event history已经是清晰中间层，各route只消费自己需要的事实。

### 187.7 待用户选择

1. **A（推荐）**：先修正blocked为可恢复Review generation，再实现rework纵切；之后回到accepted分支。
2. **B**：声明blocked必须通过新TargetResult才能解除，直接实现rework；实现更少，但会制造无产品改动
   的假返工，并保留与durable human gate不一致的语义。
3. **C**：先做accepted happy path；能更早进入completion/Test讨论，但会暂时保留当前blocked不可恢复
   和rework prompt缺失问题。

本节点只完成代码/文档/旧逻辑/官方实践审查与路线设计；没有修改TS运行时代码、Schema或测试，
也没有运行测试、提交、发布或刷新安装cache。

## 188. R-0（可恢复Review Block Generation）

### 188.1 从Result唯一Decision修正为Review generation

用户确认采用§187方案A。原Decision Service按TargetResult ID查找唯一Decision，对accept/rework/
redesign是正确终结语义，但会让blocked永久消费同一Result的审查资格。本单元把幂等范围修正为：

```text
TargetResult ID + reviewed Snapshot digest
```

同一Review generation仍只能有一个Decision；显式Resume提交后，Event Stream与Review history使新
Snapshot digest和unit digest变化，Controller才能为同一TargetResult创建下一代Decision。没有引入
可漂移generation数字或mutable current-review文件。

### 188.2 ControllerTargetReviewResume合同

新增`target-review-resume` durable ID和不可变`ControllerTargetReviewResume`，闭合：

- Program/Demand/Target与当前逻辑Controller Window；
- exact blocked Decision ID/digest；
- exact TargetResult ID/digest；
- blocked Snapshot/state digest与stream revision；
- resolution summary、resumedAt与self digest。

Resume不声明阻断事实真实解决，不撤销或覆盖旧Decision，也不携带accept/rework/redesign字段。
resolution summary只解释为什么Controller认为可以重新审查；新的业务判断必须由下一代Decision中的
新独立检查承担。

### 188.3 Event Sourcing闭环

新增`review.target-result-resumed.v1` data Schema、当前Event模型、v1 codec Registry、generic
upcaster、pure Decider、Aggregate reducer和Commit boundary。Reducer只接受：

```text
current phase = review-blocked
current Decision = blocked
exact Decision/Result tuple
resume.blockedSource.stateDigest = current state digest
resume.blockedSource.streamRevision = commit.expectedStreamRevision
```

转换只删除Aggregate当前`reviewDecision`摘要并把phase恢复为`result-reported`；TaskPackage、Delivery、
Host Effect和TargetResult summary逐字段保留。旧Decision与Resume完整载荷继续存在于Event Stream。
重复Resume因不再位于review-blocked状态而失败；同一blocked Decision也只能拥有一个Resume Event。

新增事件家族再次改变version compatibility digest，旧Snapshot会回退到完整replay，不修改历史字节。

### 188.4 Review Unit绑定历史

`DemandResultReviewSnapshot`的reported/review-decided target现在携带有序`priorReviewHistory`：

```text
decision source event + full Decision
resume source event + full Resume
```

首次审查history为空。当前Decision不进入它自己曾审阅的unit；只包含该Decision之前、属于同一
TargetResult的历史。Resume之后重新生成reported unit时，prior history包含`blocked Decision → Resume`，
所以unit digest必然不同。下一代Decision由此精确证明Controller看到了阻断与恢复背景。

Repository一次完整扫描同时投影TaskPackage、TargetResult、Decision和Resume，按stream revision排序
并复验Resume必须引用更早的blocked Decision。它不按mtime、目录顺序或generation counter选择当前项。

### 188.5 Resume Service与恢复边界

`ControllerTargetReviewResumeService`固定执行：

```text
strict request/options
  → Demand组合authority
  → 完整Review history + 当前Snapshot
  → exact review-blocked target/Decision/Result/Snapshot
  → 派生当前Config Controller Window
  → 创建Resume并preflight
  → 复验Config current
  → optimistic CAS append Resume Event
```

请求不允许调用方声明Resume/Event/Commit ID、Controller Window、state digest或stream revision。相同
blocked Decision的相同resolution request重试返回原Resume身份和时间；内容冲突不覆盖。并发/不确定
提交沿用Decision Service的“重读history→精确同语义则前向幂等”边界。

[Microsoft Durable Task human-interaction pattern](https://learn.microsoft.com/en-us/azure/durable-task/common/durable-task-human-interaction)
和[Durable Functions external-event指南](https://learn.microsoft.com/en-us/Azure/Azure-functions/durable/durable-functions-external-events)
所描述的“持久等待→明确外部事件恢复”在此被收敛为本地Event Sourcing事实；Wakeflow没有引入后台
orchestrator、timer或消息队列。

### 188.6 明确未进入的范围

- Resume没有TTL、自动超时、自动accept或自动路由；Demand取消仍是独立事件；
- 没有把resolution summary当成证据、用户签名或宿主身份认证；
- 尚未实现rework-aware TargetDeliveryIntent与新attempt；
- 尚未实现accepted Test/completion分流或redesign Authority supplement；
- 没有Group、ReviewCandidate、global generation counter或持久化Review read store。

### 188.7 聚焦验证

```text
Foundation Git + Demand + Delivery + Result + Review TypeScript tests: 91 pass / 0 fail / 0 skip
Review Resume: deterministic codec/digest and typed Resume/Event/Commit identity;
  v1 codec/upcast; exact blocked reducer; stale Snapshot zero-write before clock/UUID;
  first Resume + exact retry; prior decision/resume history ordering;
  changed review-unit digest; second-generation accept Decision on same TargetResult;
  exactly three additional stream revisions for blocked → resume → accept
TypeScript: pass
Architecture: pass / parser=swc / 527 modules / 3539 dependencies / 0 violations
Schema: pass / 55 schemas / 143 external refs
Schema digest: sha256:9bed70de8ebd20e27fa0b588a7841be429ef510173c01443040cefced4b502fd
git diff --check: pass
```

验证只执行当前Foundation Git与新版Demand/Delivery/Result/Review TS范围；未运行旧JS、完整TS套件、
插件validator/smoke、`npm test`或release gate。没有提交、发布或刷新安装cache。

## 189. R-1（同一TaskPackage的可审计返工尝试）

### 189.1 返工语义与边界

本单元把`rework-requested`实现为同一不可变TaskPackage的新执行尝试，而不是新建TaskPackage、
修改旧Result、复用旧TargetDelivery或借用Host Effect Rearm：

```text
previous TargetResult
  → Controller rework Decision
  → new TargetDeliveryIntent
  → new WindowWorkClaim / Host Effect / TargetResult
```

TaskPackage ID/ref/digest、Target Task、repository与window保持不变；每次尝试使用新的TargetDelivery、
Claim、Observation和Result身份。Decision本身就是业务返工授权，不再增加一条无信息量的rearm事件。

### 189.2 有界Rework Context与完整来源闭合

`TargetDeliveryIntent`新增可选`rework`投影。字段缺失表示初次尝试；字段存在时必须绑定：

- exact Controller Decision ID/digest；
- exact previous TargetResult ID/digest；
- 最长1024 code points的`rationaleSummary`；
- 每个未通过检查的ID/outcome，以及最长128/256 code points的method/observation summary；
- 至少一个`failed`检查，check ID不得重复。

完整Decision和Result不复制进Intent或prompt，继续由Demand Event Stream持有。新增薄适配缝
`target-delivery-rework-context.ts`先解析两份完整记录，复验Program/Demand/Target/TaskPackage/Result
关系，再生成有界投影。事件因果顺序继续由stream revision与optimistic append证明，不新增墙上时钟
先后门。摘要字段明确使用`Summary`命名，截断以Unicode code point执行并保留省略号，不把有界执行
消息伪装成完整Review authority。

为了让纯Decider也能证明Intent摘要确实来自对应Review历史，prepare command在返工路径额外携带
完整`reworkSource:{decision,previousResult}`。命令解析器重新投影并与Intent逐摘要比较；Event只保存
Intent，不复制命令来源。初次命令字节形状与command digest保持不变，返工命令缺少来源或来源不匹配
会在产生Event前失败。这个单向适配避免`TargetDeliveryIntent ↔ TargetResult`运行时循环依赖。

### 189.3 Prepared Event v2与历史兼容

`delivery.target-delivery-prepared`当前持久化版本升为v2：

- v1 Schema明确禁止`rework`，只代表历史初次尝试；
- v2同时接受初次与返工Intent；
- `v1 → v2`是身份upcast，因为旧初次Intent已经是当前内存形状；
- 当前writer对初次和返工都写v2；
- v1载荷带`rework`会被codec拒绝，不能用新语义伪装成旧事件。

事件版本兼容摘要随之变化，旧Snapshot会安全回退到完整replay；旧v1事件字节、Intent self digest与
历史resulting state digest均不改写。

### 189.4 Preparation与Aggregate准入

Preparation Authority现在只接受两个闭合分支：

```text
planned          + no rework context
rework-requested + exact current Decision/Result context
```

返工分支从完整Event历史定位当前Aggregate摘要指向的Decision/Result，复验历史Aggregate与组合上下文
处于同一state digest/revision，然后读取当前Config拓扑、TaskPackage投影和私有Binding。Apply重试从
Event历史恢复完整rework command source，不依赖可删除投影，也不要求Aggregate仍停在
`rework-requested`。

Reducer要求新Intent中的Decision/Result元组与当前summary完全一致，且TargetDelivery ID不同于上一
尝试。Service还在preview与提交前扫描完整历史，拒绝复用任一更早TargetDelivery ID；并发碰撞继续由
expected stream revision收敛。

### 189.5 多尝试历史与幂等修正

Repository按TargetDelivery ID定位prepared Event时不再错误要求它必须是Aggregate当前Delivery。
完整replay已经证明每条Event在其历史位置合法，定位后只复验Demand/Target/TaskPackage/window关系。
因此上一尝试的TargetResult在后续返工已开始后仍能按原command/commit精确幂等返回，不会因current
Delivery变化而把合法历史误报为损坏。

`DemandResultReviewSnapshot.priorReviewHistory`也从“同一TargetResult内的Decision/Resume”扩展为
“同一Target Task在当前Decision之前的全部有序Decision/Resume”。第二次尝试产生Result后，新的
review unit会明确包含第一次rework Decision；Controller可以从真实Event history实施重复返工刹车，
仍不增加`reworkCount`或另一份mutable lineage状态。

### 189.6 明确未进入的范围

- 没有改变TaskPackage内容、创建replacement或continuation；普通rework仍是同一任务；
- 没有实现redesign Authority supplement、accepted Test/completion分流或Demand complete；
- 没有自动重试、定时器、后台worker、Group、ReviewCandidate或全局attempt counter；
- 没有把Controller摘要当成事实证明；Controller独立验证与最终Decision权威保持不变；
- 没有公共MCP/CLI或真实宿主发送；测试只消费首次Claim签发的瞬时Action并记录模拟宿主事实。

### 189.7 聚焦验证

```text
Foundation Git + Demand + Delivery + Result + Review TypeScript tests: 111 pass / 0 fail / 0 skip
Rework vertical flow: Result → rework Decision → same TaskPackage/new Delivery v2
  → new Claim/Action → accepted Observation → second Result;
  old Result retry remains idempotent; TaskPackage count stays 1;
  second review unit contains prior rework Decision
Event evolution: v1 initial upcast; v1 rejects rework; current writer emits v2
Command closure: missing/mismatched full rework source rejected before Event creation
Identity: previous/historical TargetDelivery ID reuse rejected
TypeScript: pass
Architecture: pass / parser=swc / 529 modules / 3571 dependencies / 0 violations
Schema: pass / 56 schemas / 144 external refs
Schema digest: sha256:ac8ab6e44eaf32e0506d8709713cdf6f688fc6c6861b9b49dc262dc2ea290e6c
git diff --check: pass
```

验证只执行当前Foundation Git与新版Demand/Delivery/Result/Review TS范围；未运行旧JS、完整TS套件、
插件validator/smoke、`npm test`或release gate。没有提交、发布或刷新安装cache。

## 190. R-2（产品Target接受后的Testing Decision分流）

### 190.1 当前Authority、Review与旧实现事实

当前新TS并不缺测试决定本身：`DemandAuthority.testingDecision`已经在publication时永久冻结，并且：

- 非research只能是`controller-only | real-environment`；
- research只能是`not-applicable`；
- `real-environment`必须精确绑定唯一`test-environment` Ledger成员；
- Authority admission会稳定读取并复验全部Ledger成员、record/member digest及Program/Demand关系。

R-0/R-1后的Review Snapshot则能证明每个当前implementation Target是否拥有精确accepted
Decision/Result。缺口是两组事实之间没有可执行的中间路由，Controller只能自行重新解释。

旧JS `createTestCardArtifact`确实同时要求`authority.testDecision.mode=real-environment`和所有产品任务
accepted/superseded；旧completion owner还要继续检查idle review、lease、current Result、TaskPackage与
TestCard closure。因此旧逻辑只能作为需求证据：它支持“先分流、再由专属owner完整preflight”，不支持
把全部accepted直接等同于Demand完成。

TencentDB-Agent-Memory的README明确说明Memory不运行Agent loop，只为下一轮保存结果；它没有对应
的accepted/Test路由实现可复用，因此本单元没有把其memory分层误套为Wakeflow工作流状态。

[AWS Step Functions Choice](https://docs.aws.amazon.com/step-functions/latest/dg/state-choice.html)要求按输入
显式选择分支，并建议提供Default避免无匹配时无法转移；[GitHub Environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
和[Azure Pipelines环境](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/environments?view=azure-devops)
都把环境保护检查放在消费环境资源的stage开始之前。R-2据此保留显式`not-ready`默认分支，并且只在
真实环境路线成立后投影环境Authority引用。

### 190.2 DemandPostAcceptanceRoute读模型

新增`demand-post-acceptance-route.ts`，它是零写、可丢弃、可重建的CQRS读模型，不是持久化Artifact
或第二状态机。当前没有公共wire或文件消费者，因此没有提前增加JSON Schema；内部合同仍有
`kind/schemaVersion`、确定性`routeDigest`和稳定错误分类。

路由共同冻结：

- Program/Demand/type与Demand Authority digest；
- 原始testing decision；
- Review Snapshot digest；
- observed stream revision/state digest/last Event tuple；
- 每个accepted implementation Target的TaskPackage、Result和Decision精确身份。

后续owner必须重新复验这些tuple，不能把route本身当成写许可。

### 190.3 三类显式下一阶段

```text
not-ready
  ├─ demand-cancelled
  ├─ no-target-tasks
  ├─ targets-not-accepted + exact blocking target/phase
  └─ testing-not-applicable

completion-preflight
  └─ active + non-empty targets + all implementation targets accepted
     + testingDecision=controller-only

real-environment-test-planning
  └─ same acceptance gate + testingDecision=real-environment
     + exact test-environment Ledger authority reference
```

`completion-preflight`刻意不叫`completion-ready`：真正completion owner仍需建设并复验TODO、lease、
全目标与终态Event边界。`real-environment-test-planning`也不创建TestCard、不分配Test Target、不选择
环境、不执行命令。

### 190.4 环境Authority与信息边界

路由通过现有Demand组合Authority完整读取和验证Ledger闭包，因此不会跳过member bytes/digest验证；
但输出只包含现有`LedgerAuthorityMemberReference`，不解释或返回环境正文、secret、endpoint、raw handle、
thread/session ID。下一阶段TestCard owner必须从同一冻结成员显式构造测试合同，并再次验证当前Config、
Controller self-check和环境边界。

### 190.5 高负载回归暴露的Decision恢复窗口

R-2整组聚焦测试第一次运行时，既有Controller Decision并发测试出现一次真实瞬态：winner已把commit
link到最终槽位但尚未退休双链接candidate，loser立即完整audit时被普通reader保守分类为`stream`。
单独连续三轮均通过，证明不是持久损坏，但也不能把该偶发窗口忽略为测试噪声。

Decision Service的历史读取因此增加最多三次完整重读，只针对`repository.stream`；每次仍执行完整
Event chain与Review history审计，不使用sleep、timer、局部缓存或宽松解析。winner结算后读取收敛；
持续三次错误仍按state损坏失败。修正后同一109项高负载聚焦组完整通过。

### 190.6 明确未进入的范围

- 没有TestCard、Test TaskPackage、Test attempt、controllerSelfChecks或真实环境执行；
- 没有Demand completion Event、TODO settlement、lease closure、archive或continuation；
- 没有把research零Target捷径混入implementation接受路线；
- 没有公共MCP/CLI、宿主发送、environment secret或配置值输出；
- 没有通用Workflow manager、全局stage字段、后台worker或新持久化文件。

### 190.7 聚焦验证

```text
Tasking + Demand + Delivery + Result + Review TypeScript tests: 109 pass / 0 fail / 0 skip
Route vertical flow:
  result-reported → not-ready(targets-not-accepted)
  accepted + controller-only → completion-preflight
  accepted + real-environment → real-environment-test-planning + exact authority ref
  published/no target → not-ready(no-target-tasks)
  cancelled → not-ready(demand-cancelled)
Read behavior: deterministic digest; repeated reads byte-equivalent; root inventory zero-write
Concurrency regression: full high-load group passes after bounded complete-audit retry
TypeScript: pass
Architecture: pass / parser=swc / 531 modules / 3597 dependencies / 0 violations
Schema: pass / 56 schemas / 144 external refs (unchanged)
Schema digest: sha256:ac8ab6e44eaf32e0506d8709713cdf6f688fc6c6861b9b49dc262dc2ea290e6c
git diff --check: pass
```

验证只执行新版Tasking/Demand/Delivery/Result/Review TS范围；未运行旧JS、完整TS套件、插件
validator/smoke、`npm test`或release gate。没有提交、发布或刷新安装cache。

## 191. R-2A（controller-only Demand Completion终态）

### 191.1 Completion不是accepted别名

R-2只把`controller-only`路由到`completion-preflight`，没有授予写权限。本单元继续复验：

- Demand Authority仍为`controller-only`；
- 非空implementation Target全部拥有精确accepted Result/Decision；
- 当前Review Snapshot与Event Stream完全同修订；
- Demand来源TODO仍以claimed状态精确挂载，intake/state digest未漂移；
- 每个accepted产品窗口均无WindowWorkClaim；
- 当前Config仍能确定同一逻辑Controller Window。

[AWS Step Functions Succeed](https://docs.aws.amazon.com/step-functions/latest/dg/state-succeed.html)把成功定义为
无`Next`的终态；[Microsoft Event Sourcing](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)
则要求通过不可变append Event和乐观并发从历史重建状态。新TS据此把Completion实现为独立终态Event，
而不是在accepted读模型上增加一个展示布尔值。

### 191.2 TODO与Completion的职责边界

当前TODO状态词汇有意只有：

```text
pending-claim | parked | claimed | archived
```

它没有`completed`，因为TODO是调度Ledger，Demand业务生命周期不在其中重复保存。Completion因此只验证
TODO仍为exact claimed mount，不写TODO；后续BusinessArchive携带完整归档回执后，TODO才允许
`claimed → archived`。这避免创建第二套Demand终态，也保证完成后仍能从TODO挂载定位待归档Demand。

为支持真实Completion测试，Tasking工作区fixture已从硬编码TODO lineage摘要改为真实执行Active Layout、
TODO append和exact claim，再创建Demand/Event Stream。现有Tasking/Delivery/Review测试因此继续使用同一
真实来源链，而不是Completion专用假状态。

### 191.3 DemandCompletion与Plan合同

新增不可变`DemandCompletion`事件载荷，绑定：

- Program/Demand/逻辑Controller Window；
- Demand Authority digest；
- post-acceptance route与Review Snapshot digest；
- observed stream revision/state digest/last Event tuple；
- TODO ID、canonical intake ref、intake/state digest和state revision；
- completedAt与self-excluding completion digest。

Completion没有额外`completionId`：唯一持久身份已由Event ID与Commit ID分别承担，避免第四个等价ID。

`DemandCompletionPlan`冻结Completion、完整Demand Authority、Event/Commit ID和expected stream revision。
完整Authority进入plan是刻意的：已提交Apply重试可重建原command digest，不需要后来Config、Ledger或
TODO仍处于preflight状态。Plan digest不是授权；首次Apply仍重读全部外部来源。

### 191.4 Event Sourcing终态闭环

新增`lifecycle.demand-completed.v1`：

- strict event data Schema与v1 codec；
- current Event/Command parser、pure Decider、Event commit boundary和upcaster路径；
- Aggregate lifecycle新增`completed`；
- reducer只接受active、non-empty、all-accepted且state/authority digest精确匹配的状态；
- Schema进一步禁止`completed + empty/non-accepted targets`伪状态；
- completion Event要求observed stream revision等于Commit expected revision。

`completed`之后普通Planning、Delivery、Result、Review和Cancel都因非active lifecycle失败关闭；R-2 route
也返回`not-ready(demand-completed)`，不会再次建议completion。当前state-model version仍为v1，因为旧
Event产生的历史状态字节与摘要不变；新增Event家族会改变version compatibility digest，使旧Snapshot
安全回退到完整replay。

### 191.5 Completion Service事务边界

```text
preview（零写）
  → Demand组合Authority + Review route
  → exact claimed TODO
  → all accepted window claims absent
  → derive Controller + Completion + Event/Commit plan
  → preflight commit

apply（未提交）
  → 重读全部来源
  → exact plan/stream/route/TODO/Claim/Controller闭合
  → 复验Config current
  → optimistic append lifecycle.demand-completed

apply（已提交）
  → 只按plan冻结Authority重建同一command
  → 返回原Commit与completed aggregate
```

同计划并发Apply收敛为`committed + idempotent`和一个stream revision。首次Apply前新增WorkClaim或删除
TODO state都会失败且不追加Event；Event已提交后，即使Config展示字段变化，精确重试仍返回原终态。

### 191.6 明确未进入的范围

- 没有完成`real-environment` Demand；它仍必须先建设并接受TestCard/Test Task；
- 没有TODO archive、BusinessArchive、Pod close、宿主线程关闭或物理worktree处理；
- 没有completed Demand continuation/reopen，普通写命令保持终态失败；
- 没有completion projection文件、全局stage状态、后台worker或消息队列；
- 没有公共MCP/CLI或自动调用任何宿主能力。

### 191.7 聚焦验证

```text
Tasking + Demand + Delivery + Result + Review + Lifecycle TypeScript tests: 113 pass / 0 fail / 0 skip
Completion vertical flow:
  accepted + controller-only + claimed TODO + no WorkClaim
  → zero-write preview → exact Apply → lifecycle.demand-completed.v1
  → Aggregate completed / route not-ready(demand-completed) / TODO remains claimed
Negative gates:
  real-environment rejected; preview→Apply WorkClaim drift rejected;
  preview→Apply TODO source deletion rejected; completed→cancel rejected
Idempotency:
  exact retry after Config drift returns original Event;
  concurrent same plan converges to committed + idempotent and one revision
TypeScript: pass
Architecture: pass / parser=swc / 539 modules / 3670 dependencies / 0 violations
Schema: pass / 58 schemas / 149 external refs
Schema digest: sha256:4bcb47adf25c463dabe002737bcf1690e1a1acc5a4f246fe378b54231c63ee5c
git diff --check: pass
```

验证只执行新版Tasking/Demand/Delivery/Result/Review/Lifecycle TS范围；未运行旧JS、完整TS套件、插件
validator/smoke、`npm test`或release gate。没有提交、发布或刷新安装cache。

## 192. R-2B-1（real-environment TestCard耐久创建）

### 192.1 TestCard是测试合同，不是测试运行结果

R-2只路由到`real-environment-test-planning`，本单元把Controller已批准的真实环境测试意图冻结为
TestCard。[Azure Test Plans](https://learn.microsoft.com/en-us/azure/devops/test/overview?view=azure-devops)
区分可复用的Test Case、某次Test Run与具体Test Result；[GitHub deployment environments](https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments)
和[Azure Pipelines environments](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/environments?view=azure-devops)
则把环境保护放在runner或环境资源真正可用之前。因此当前TestCard只是输入合同，不伪装为
attempt、run、result或环境已准备的证明。

TencentDB-Agent-Memory的README明确由外部Agent loop消费Memory，项目本身不运行Agent loop；它没有
TestCard/Test Run对应合同可直接复用。本单元因此只学习其“底层能力与上层运行者分离”边界，
没有把Memory数据模型套入Wakeflow Testing。

### 192.2 受约束的TestCard合同

新增`governance/testing/test-card` Schema与手写codec，冻结：

- TestCard、预留Test Target、Program/Demand和Config Test Window的typed identity；
- 完整`test-environment` Ledger Authority member reference，但不包含secret、endpoint、raw handle或session/thread ID；
- post-acceptance route、Review Snapshot与Event Stream尾部tuple；
- 每个accepted implementation Target的TaskPackage、Repository、Window、Result和Review Decision精确基线；
- 原始Demand goal、已批准步骤、允许Skill、环境setup策略、最大attempt数与重启条件；
- question/object boundary、Controller self-check、真实场景条件、成功/失败/不可推断/停止边界、
  evidence与允许/禁止操作；
- `createdAt`和排除self field的Canonical JSON digest。

编写内容在读取UUID和时钟前完成严格准入：字段闭合、NFC文本、控制字符、空白/长度、唯一列表、
Skill token和`fresh-per-attempt`重启条件都显式校验。旧实现的四个固定false变更布尔值被剪枝为一个
`changeControl: return-blocked-to-controller`常量，不为尚不存在的流程增加状态空间。

### 192.3 Event Sourcing与Aggregate最小投影

新增`testing.test-card-created.v1`：

- strict event payload Schema、v1 codec与version-evolution registry；
- `testing.create-test-card` Command、pure Decider、uncommitted Event、Commit stream-position closure与Aggregate reducer；
- reducer要求active Demand、不存在旧TestCard、Authority/state digest精确一致，且全部产品Target的
  accepted Result/Decision基线逐项闭合；
- Aggregate只保存`testCardId/digest/targetTaskId/testWindowId`当前摘要，完整TestCard由不可变Event保存；
- post-acceptance route在TestCard存在后进入`test-task-planning`，不再重复创建Card；
- `completed` Aggregate明确禁止尚存TestCard，避免真实环境测试尚未关闭就被标记完成。

当前没有额外创建TestCard投影文件：Event Commit是耐久Authority，Aggregate是可重建的当前路由摘要。
后续Test TaskPackage owner如需独立文档入口，必须从该Event派生create-only投影，不创建第二权威。

### 192.4 Preview/Apply owner的事务边界

```text
preview（零写）
  → Demand组合Authority + accepted Review route
  → main placement + 产品Window WorkClaim absent
  → Config Test Window + TestCard/Event/Commit identity
  → exact immutable plan + Commit capacity preflight

apply（首次）
  → 重读Authority/route/Review/WorkClaim/Config
  → 重建同一TestCard并复验plan、stream与Authority
  → optimistic append testing.test-card-created.v1

apply（已提交）
  → 仅使用plan冻结Authority重建原Command
  → 返回原Commit，不依赖后来Config展示值
```

同计划并发Apply收敛为`committed + idempotent`且只增加一个stream revision。preview后若产品窗口重新出现
WorkClaim，Apply会在Event append前拒绝。关闭Demand/Ledger root的失败也映射为稳定service error，不泄漏底层异常形状。

### 192.5 明确未进入的范围

- 没有Test TaskPackage、Test Delivery、attempt/run/result、Test Review或Demand Completion；
- 没有获取environment secret、启动runner、调用宿主Agent、MCP/CLI或网络执行；
- 没有自动重试、timer、background worker、全局attempt counter或通用Workflow engine；
- 没有Pod/isolated placement支持；当前只实现已能被现有Authority完整验证的main placement；
- 没有TestCard独立物理文件、公共entrypoint或另一套持久状态机。

### 192.6 聚焦验证

```text
Tasking + Demand + Delivery + Result + Review + Lifecycle + Testing TypeScript tests:
  117 pass / 0 fail / 0 skip
TestCard vertical flow:
  accepted + real-environment + no product WorkClaim
  → zero-write preview → exact Apply → testing.test-card-created.v1
  → Aggregate minimal summary → route test-task-planning
Negative gates:
  controller-only rejected; preview→Apply WorkClaim drift rejected;
  completed state with a current TestCard rejected;
  empty boundary and fresh-per-attempt without restart condition rejected before UUID/clock
Idempotency:
  exact retry after Config display change returns original Event;
  concurrent same plan converges to committed + idempotent and one revision
TypeScript: pass
Architecture: pass / parser=swc / 547 modules / 3737 dependencies / 0 violations
Schema: pass / 60 schemas / 153 external refs
Schema digest: sha256:282367733e9cc9990c9d27c42879dbb5c12a677702dc75ac9c9a6452bc404b85
```

验证只执行新版Tasking/Demand/Delivery/Result/Review/Lifecycle/Testing TS范围；未运行旧JS、完整TS套件、
插件validator/smoke、`npm test`或release gate。没有提交、发布或刷新安装cache。

## 193. R-2B-2（Test TaskPackage与耐久规划）

### 193.1 TestCard、TaskPackage与运行事实分层

[Azure Test Plans](https://learn.microsoft.com/en-us/azure/devops/test/overview?view=azure-devops)
把Test Case、Test Run和Test Result分为可复用测试场景、一次执行实例与该次执行结果；
[Azure的Actual Result合同](https://learn.microsoft.com/en-us/azure/devops/test/actual-result?view=azure-devops)
进一步区分编写时expected outcome与执行时actual result。新TS据此固定：

```text
TestCard
  = Controller冻结的测试问题、批准步骤、环境、边界和判定合同

Test TaskPackage
  = 把该Card分配给一个精确Test Window的不可变任务合同

Test Delivery / attempt / Result
  = 后续才能发生的运行授权、执行事实与证据结果
```

[TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions)
建议使用字面量判别字段表达闭合变体；[JSON Schema条件校验](https://json-schema.org/understanding-json-schema/reference/conditionals)
也为`if/then/else`分支提供标准语义。因此没有新建第二个`wakeflow-test-task-package` Artifact，而是把同一
TaskPackage收敛为`workType: implementation | test`的严格判别联合。

TencentDB-Agent-Memory仍无Test Task/Run流程合同；其README明确Memory不运行Agent loop。本单元只继续
采用其“持久合同与外部运行者分离”思路，没有虚构可复用的Testing实现。

### 193.2 回溯修正TestCard的来源与安全边界

R-2B-1原合同冻结了`approvedPlan`正文，但没有证明该计划来自哪个冻结Demand Authority成员。
这会留下Controller临时编写未确认测试方法的结构缺口，因此本单元先补齐：

- TestCard新增完整`strategyAuthority` Ledger member reference；
- preview只接收`strategyAuthorityMemberRef`，owner从当前Demand Authority解析完整ref/digest关系；
- requirement只接受`requirement-design`，bug只接受`reproduction | scope`，supplement只接受
  `requirement-design | requirement-delta`；`test-environment`不能冒充策略来源；
- Plan parser、Command parser和首次Apply都复验strategy/environment完整引用仍在冻结Authority中；
- TestCard新增常量`productSourcePolicy: read-only`，产品源码只读不再仅依赖自由文本约定。

`allowedOperations`仍可授权Test-owned harness/fixture或确认环境内的有界操作，但不能改写上述
产品源码常量策略。

### 193.3 TaskPackage判别联合与剪枝

| 字段 | implementation | test |
| --- | --- | --- |
| `assignment` | exact repository + product window | exact Test window only |
| `commitExpectation` | required | forbidden |
| `acceptanceAnchors` | non-empty | exact empty array |
| `testCard` | forbidden | exact `{testCardId,testCardDigest}` |
| `selectedAuthorityRefs` | Controller选择且owner解析 | 由strategy + environment Authority确定性派生 |

Test TaskPackage不再复制`approvedPlan`、allowed skills、setup/attempt策略、环境操作或成功/失败边界；
它仅保存Card tuple，后续owner必须从`testing.test-card-created` Event读取完整合同。通用字段从Card
严格派生：

- `objective = question`；
- `confirmedContext = controllerSelfChecks`；
- `inScope = objectBoundary + realScenarioConditions`；
- `outOfScope = cannotConclude`；
- `forbidden = forbiddenOperations`；
- `completionExpectations = evidenceRequired`。

当前没有提前添加dependency、reviewInputContract或Test Result字段：accepted implementation baselines仍由
TestCard唯一保存，Test步骤证据映射属于后续Result纵切，不在不可变TaskPackage中创建第二份来源。

### 193.4 Event、Aggregate与历史摘要兼容

Test Task复用现有`tasking.target-task-planned.v1`和create-only TaskPackage查询投影，没有创建含义重复的
`testing.test-task-created` Event。Aggregate的Test target summary只保存：

```text
target/task package ID + package digest
+ workType:test + Test window
+ exact TestCard summary
+ phase:planned
```

重要的兼容修正：既有implementation target的持久字节不新增`workType` Task字段；Schema对其显式禁止
该字段，仅新Test变体写入`workType:test`。因此旧`tasking.target-task-planned.v1`归约的state bytes/digest
保持不变，state-model version仍为v1；没有用虚假v2或缺失历史reducer来掩盖摘要漂移。

Review Snapshot现在可表达一个尚未产生Result的Test target，但post-acceptance route只把implementation Target
纳入“产品已接受”门槛。Test Task创建前路由为`test-task-planning`；创建后精确进入
`test-delivery-planning`。现有product Delivery/Result owner显式拒绝Test变体，不会意外用implementation流程执行Test。

### 193.5 TargetTaskPlanningService的Test分支

不新建第二个大型preview/apply service。现有`TargetTaskPlanningService`在内部使用判别request：

```text
implementation request
  = Controller编写完整package content

test request
  = { workType: "test" }
  → owner读取当前TestCard Event并派生全部package content
```

Test preview依次复验main placement、`test-task-planning` route、精确TestCard Event、Config Test Window、
strategy/environment Authority、accepted baselines和产品Window WorkClaim absent，再分配TaskPackage/Event/Commit
身份。`targetTaskId`直接使用TestCard预留值，不分配第二个任务身份。

Apply首次提交前重读全部来源并从Card重建同一Package；因此伪造objective后即使重算plan digest也会
被拒绝。同plan并发Apply仍收敛为一条Event；Event已提交后的精确重试可修复/读回TaskPackage投影，
不依赖后来Config展示值。

当前公共`wakeflow_plan_target_task` MCP wire仍只暴露implementation变体；Test路线没有在Test Delivery、Result与
完整public consumer存在之前被误报为可用公开能力。

### 193.6 明确未进入的范围

- 没有Test Delivery Intent/packet/envelope、Window WorkClaim或宿主发送；
- 没有Test attempt/restart/resume、环境准备回执或外部资源互斥；
- 没有Test TargetResult、`test-step`证据映射、Controller Test Review或Demand Completion；
- 没有Pod Test access probe、isolated placement或任何产品源码修改权限；
- 没有新的TestCard物理投影、通用Workflow engine、timer或background worker。

### 193.7 聚焦验证

```text
Tasking + Demand + Delivery + Result + Review + Lifecycle + Testing + MCP wire tests:
  122 pass / 0 fail / 0 skip
Test Task vertical flow:
  accepted implementation targets + real-environment + TestCard Event
  → zero-write preview → derived Test TaskPackage
  → tasking.target-task-planned.v1 → create-only projection
  → Aggregate Test planned summary → route test-delivery-planning
Negative gates:
  no TestCard rejected; environment member cannot act as strategy source;
  forged derived package rejected after recomputed plan digest;
  preview→Apply product WorkClaim drift rejected;
  Test package cannot carry repository, commitExpectation or acceptance anchors
Compatibility:
  implementation Aggregate target still has no workType field;
  v1 upcast, real local v1 stream audit and immutable Snapshot tests pass
TypeScript: pass
Architecture: pass / parser=swc / 551 modules / 3785 dependencies / 0 violations
Schema: pass / 60 schemas / 153 external refs
Schema digest: sha256:ee1259296d677937acc4fddeadcc730719942b908d05506c9a2dc1a1c564ad51
git diff --check: pass
```

验证只执行新版Tasking/Demand/Delivery/Result/Review/Lifecycle/Testing与相关MCP wire TS范围；
未运行旧JS、完整TS套件、插件validator/smoke、`npm test`或release gate。没有提交、发布或刷新安装cache。

## 194. R-2B-3（initial Test Delivery/attempt授权骨干）

### 194.1 logical Test attempt不是host-send attempt

旧JS的有效需求是：一个logical Test attempt可能因`rejected-before-send`更换或重新授权宿主投递，
但不能因“消息还没有真正发出”就消耗新的Test attempt上maxAttempts。反之，一次真实Test执行结果后的
resume/restart必须绑定前一attempt和精确Test Result。

[Playwright retries](https://playwright.dev/docs/test-retries)把测试retry显式编号，并在失败后丢弃旧worker、
使用新worker重新执行；这说明执行attempt、worker/transport与环境重建不应被一个模糊计数器代替。
[Azure Test Runs](https://learn.microsoft.com/en-us/azure/devops/test/test-runs?view=azure-devops)也把一次run的outcome、duration、
environment和单项result作为执行事实，而不是反向改写Test Case。

因此新TS新增typed`test-attempt` ID和独立`TestExecutionAttempt`合同，v1只准入当前真实消费者：

```text
ordinal: 1
mode: initial
previous attempt/result: absent
restart authorization: absent
```

`resume | restart`没有作为未来占位进入Schema。当Test Result纵切能提供精确previous-result lineage时，
必须通过新版本演进增加，不得放宽v1解释。

### 194.2 environment setup是指令，不是回执

Initial attempt从TestCard的`setupPolicy`确定性派生：

| TestCard policy | initial directive |
| --- | --- |
| `reuse-existing` | `reuse-confirmed-environment` |
| `fresh-once` | `prepare-fresh-environment` |
| `fresh-per-attempt` | `prepare-fresh-environment` |

该字段只说明Test执行前要完成什么，不说明环境已经就绪。本轮main placement只使用当前唯一Test
Window Binding；没有新建环境lease、secret访问、自动rebuild或Pod跨窗口互斥。[GitHub Environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)
同样把environment protection和concurrency视为独立门槛：未通过protection前job不运行、不读取environment secrets；
concurrency也不由environment名自动推导。

### 194.3 TestDeliveryIntent与product Delivery的分界

没有把Test加入现有product `TargetDeliveryIntent` optional分支。新建`TestDeliveryIntent`，只共享底层
typed identity、TaskPackage入口、Binding route、Config language、Canonical digest和Event Store能力。它冻结：

- Target Delivery/Task/Package及create-only TaskPackage projection ref/digest；
- exact TestCard tuple；
- `TestExecutionAttempt`；
- Test Window、host和当前私有Binding generation；
- Config digest、presentation language、`preparedAt`和self-excluding digest。

它明确不包含：

- portable/final prompt；
- dispatch group/packet/envelope；
- WindowWorkClaim、raw handle或host observation；
- environment setup receipt；
- send/readback事实、Test Result、acceptance或retry permission。

这使Intent成为“准备该logical attempt的不可变授权”，后续dispatch owner必须再构造target-facing
packet/prompt并取得pre-send claim，不能把Intent Event当成已发送事实。因尚无target-facing文档消费者，
本轮仍不创建TestCard物理投影；packet设计必须先确认是派生create-only Card projection还是冻结有界execution
contract snapshot。

### 194.4 Event Sourcing与Aggregate attempt lineage

新增独立`testing.test-delivery-prepared.v1`，而不扩展product `delivery.target-delivery-prepared` Event语义：

- strict event data Schema、v1 codec和version-evolution registry；
- `testing.prepare-test-delivery` Command、pure Decider、Event parser和reducer；
- Command瞬时携带完整Test TaskPackage/TestCard用于关系校验，Event只保存Intent；
- Repository可按Target Delivery ID定位唯一Test prepared Event。

Aggregate从Test target `planned`进入`test-delivery-prepared`，最小当前摘要保存Delivery/Intent/Binding/
TestAttempt身份；`testAttempts`append-only数组在当前只能含一个真定initial attempt，其首个
`deliveryAuthorizations`绑定Target Delivery ID、Intent digest与preparedAt。它不是空数组占位，是后续
maxAttempts/previous-result/replacement authorization判定所需的当前域事实。

既有implementation Aggregate字节与归约逻辑保持不变，state-model仍为v1；新Event家族使version
compatibility digest变化，旧Snapshot会安全回退到完整replay。post-acceptance route在Test Delivery提交后从
`test-delivery-planning`进入`test-dispatch-planning`。

### 194.5 Preview/Apply事务边界

`TestDeliveryPreparationService`在preview中零写复验：

```text
main placement + test-delivery-planning route
→ exact Test TaskPackage projection + TestCard Event
→ accepted implementation baselines + product WorkClaim absent
→ exact Program/Demand Authority + frozen Config digest/Test Window
→ current private Test Binding
→ allocate TestAttempt/TargetDelivery/Event/Commit IDs
→ derive initial attempt + TestDeliveryIntent
→ pure Event/Commit capacity preflight
```

首次Apply重读全部来源、重建同一attempt/Intent，复验Config current后乐观追加。伪造Binding后即使重算
Intent/plan digest也会在首写前拒绝；preview后Config或产品Claim漂移也是零Event失败。已提交重试
只从原TaskPackage/TestCard Event恢复Command，不依赖后来Config展示值或Binding。

当前公共MCP仍不暴露Test Delivery；本轮没有宿主效果、未使用raw handle。

### 194.6 并发结算窗口的Foundation修正

扩大组合测试先后在TestCard和Completion并发测试暴露同一问题：winner的Commit已link，但原子
candidate尚未退休时，loser的append admission会看到对方active candidate并保守报`stream`。这不是
Testing业务错误，也不应由每个service各自重试。

修正下沉为：

- `DemandFileEventStore`以canonical Demand root为key，在同一进程内串行短append mutation；
- 队列只保存Promise tail，不保存业务状态，完成后删除key；
- 跨进程/worker竞争仍由candidate owner、exclusive no-replace link和保守recovery处理；
- `DemandEventSourcingCommandHandler`仅对`repository.stream`在load/commit lookup阶段最多三次完整重读，
  无sleep、无宽松解析，持续错误仍失败。

新Store直接回归证明同进程相同Append收敛为`committed + idempotent`，append-candidates目录最终为空。
Completion、TestCard与Test Delivery三组并发owner在同一高负载组合中通过。

### 194.7 明确未进入的范围

- 没有dispatch packet/envelope、target-facing prompt或TestCard物理投影；
- 没有Test WindowWorkClaim、pre-send fence、Agent Host Action、send/readback或outcome Event；
- 没有environment setup receipt、environment secret、外部资源lease或Pod Test access；
- 没有resume/restart、replacement authorization、host-send retry或自动重试；
- 没有Test TargetResult、test-step evidence mapping、Controller Test Review或Demand Completion；
- 没有公共MCP/CLI、实体Codex/Claude发送、版本发布或安装cache切换。

### 194.8 聚焦验证

```text
Tasking + Demand + Delivery + Result + Review + Lifecycle + Testing
+ MCP wire + Binding focused tests:
  130 pass / 0 fail / 0 skip
Initial Test Delivery flow:
  Test Task planned + exact TestCard + current Test Binding
  → zero-write preview → initial TestExecutionAttempt
  → TestDeliveryIntent → testing.test-delivery-prepared.v1
  → Aggregate test-delivery-prepared + one append-only attempt authorization
  → route test-dispatch-planning
Negative gates:
  missing Test Binding rejected; forged Binding rejected after recomputed digests;
  Config digest and product WorkClaim drift rejected before Event;
  attempt v1 rejects ordinal 2/resume/restart placeholders
Environment setup:
  reuse-existing → reuse-confirmed-environment;
  fresh-once/fresh-per-attempt initial → prepare-fresh-environment
Concurrency:
  Event Store same-process identical append → committed + idempotent;
  Completion/TestCard/Test Delivery concurrent plans converge
Compatibility:
  existing implementation state bytes remain unchanged;
  v1 upcast/local stream audit/Snapshot tests pass
TypeScript: pass
Architecture: pass / parser=swc / 562 modules / 3908 dependencies / 0 violations
Schema: pass / 63 schemas / 171 external refs
Schema digest: sha256:0e2e3f5117db7e8dba0e9df20412a0fa5b5b5624d9d7f46d225a6e33122878fa
git diff --check: pass
```

验证只执行新版Tasking/Demand/Delivery/Result/Review/Lifecycle/Testing、相关MCP wire与Binding TS范围；
未运行旧JS、完整TS套件、插件validator/smoke、`npm test`或release gate。没有提交、发布或刷新安装cache。

## 195. R-2B-4（Test target-facing dispatch packet与可重建读取投影）

### 195.1 没有恢复旧DispatchGroup/Packet/Envelope状态机

旧JS `dispatch-packet`同时复制Group、TaskPackage、完整边界、Result合同、Test合同、prompt和transport
字段，并为packet再分配独立身份。新TS的product Delivery已经有意收敛为Event中的单目标
`TargetDeliveryIntent`；Test不能因为多一个执行合同就恢复整套旧transport层。

[Azure Event Sourcing pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)
明确把append-only Event Store视为system of record，把materialized view视为可从Event重建的只读投影，
并建议Event表达业务意图而不是技术状态变化。因此本单元没有新增
`testing.test-dispatch-packet-created`技术Event，也没有改变Aggregate phase：

```text
testing.test-delivery-prepared Event
  = Test Delivery与logical attempt的业务授权

TestCard / TestDispatchPacket file
  = 目标窗口读取优化，可删除并从Event重建
```

packet与已有`targetDeliveryId`严格一一对应，没有重新启用已剪枝的`dispatch-packet` durable kind、
DispatchGroup或DeliveryEnvelope。后续Claim仍必须重新验证当前Binding；投影存在不表示已Claim、已发送、
环境已准备或Test已执行。

### 195.2 Foundation只创建确定性JSON资源原语

新增`foundation/filesystem/create-only-deterministic-json-resource`，组合现有根作用域能力：

```text
严格准入目录/文件路径、权限和容量
→ 幂等物化父目录
→ exclusive + durable file create
→ 稳定读取确定性JSON
→ 复验普通文件、exact mode、current user、single link和完整文本
```

已有目标只有字节完全相同时返回`current`；不同字节保持`conflict`，不会覆盖。双硬链接结算窗口返回
`recovery-required`，创建后无法证明目标则返回`commit-uncertain`。该原语不解释Schema、领域digest、
Event或资源目录准入，Testing owner仍须使用自己的parser和Event来源复验结果。

这避免为TestCard和packet各复制一套约五百行节点/原子写错误映射。现有TaskPackage projection store
暂不在本文件审阅单元中机械迁移；后续审阅它时可在不改变Tasking合同的前提下评估复用。

### 195.3 TestCard projection与有界TestDispatchPacket

目标窗口现在拥有三个明确、可导航的文件入口：

```text
artifacts/task-packages/<taskPackageId>.json
  = 完整目标任务、上下文与边界

artifacts/test-cards/<testCardId>.json
  = Controller冻结的问题、环境、方法、判定与操作边界

artifacts/test-dispatch-packets/<targetDeliveryId>.json
  = 本次Delivery的有界目标读取快照与轻量prompt
```

TestCard文件是`testing.test-card-created` Event原字节的create-only projection，不是第二权威。
packet只保留：

- prepared Event的ID/revision/digest和TestDeliveryIntent digest；
- exact TaskPackage/TestCard ID、可移植ref和SHA-256 digest；
- host/window/binding route与首个logical Test attempt；
- objective、前两项completion focus、第一条priority context、最高优先级critical boundary；
- 固定`wakeflow-target`→`wakeflow-test` Skill读取顺序；
- requirement goal、approved plan、allowed skills、environment setup、attempt上限、restart、change control
  和`productSourcePolicy: read-only`组成的有界execution contract；
- Config语言确定的英文或简体中文portable prompt、原Intent时间和self-excluding packet digest。

[OCI Descriptor specification](https://github.com/opencontainers/image-spec/blob/main/descriptor.md)
把digest作为content identifier，并要求消费前独立复验内容；packet同样不靠路径或ID暗示内容，所有外部
Artifact入口都绑定完整SHA-256。[CloudEvents specification](https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md)
还提醒通用传输存在大小与信息泄漏边界，并建议通过链接访问详细内容以支持选择性披露；因此prompt和
packet不复制完整Card/Package，也不携带raw handle、absolute workspace root、secret或环境回执。

TencentDB-Agent-Memory没有Test dispatch对应模型可直接复用；其
`MemoryProxy/src/request-prepare-adapter.ts`采用“领域扩展拥有完整语义，宿主只转交有界scalar
projection”的边界，本单元只学习该职责分离，没有移植其具体数据结构。

### 195.4 Demand根资源清单的闭合修正

首次实现后逐文件复读发现：旧`DemandEventSourcingRootInventory`只允许
`artifacts/task-packages`。如果只创建新目录而不扩展Inventory，下一次严格Demand Authority加载会把
合法Test投影误判为未知资源，形成“能写入但后续无法继续”的断链。

现已把`test-cards`和`test-dispatch-packets`加入封闭允许集合，并保持懒创建兼容：

- `task-packages`仍是必需目录；
- 两个Testing目录在真实投影出现前可严格absent，不为所有Demand预建空目录；
- 任一目录可独立存在，以允许多文件投影中断后的幂等前向修复；
- 出现后逐文件校验固定文件名、普通文件、`0600`、single link和current user；
- 未知artifact目录或非法文件名仍稳定拒绝；
- Inventory/RootAuthority把可选目录节点和全部artifact数量纳入双读稳定性比较。

真实回归在packet物化后重新执行完整`loadDemandEventSourcingRootAuthority`，证明Ledger、Event、
Inventory和新投影目录仍形成一个健康Demand根。

### 195.5 单次物化的来源与失败边界

`TestDispatchProjectionStore.materialize(targetDeliveryId)`按以下顺序执行：

```text
完整审计并定位唯一testing.test-delivery-prepared Event
→ 定位原始target-task-planned与test-card-created Event
→ 在任何写入前构造并复验完整期望packet
→ 幂等修复TaskPackage projection
→ 幂等创建/复验TestCard projection
→ 幂等创建/复验TestDispatchPacket projection
→ 再次交叉验证三个投影与prepared Event
```

三个文件不是跨文件业务事务：中途失败可留下已经耐久发布且来源正确的前缀，重试只会补齐缺失项；
任何不同字节都不会被覆盖。Repository的Test Delivery历史查询也改为依据稳定Task/Card/attempt
authorization lineage闭合，不再把“当前phase必须仍等于`test-delivery-prepared`”误当成历史Event存在条件，
为后续Claim后的投影复验保留空间。

### 195.6 明确未进入的范围

- 没有Test WindowWorkClaim、host-effect fence、Agent Host Action、raw handle解析、send/readback或outcome Event；
- 没有environment setup receipt、secret获取、runner启动、外部环境lease或Pod Test access；
- 没有resume/restart attempt、replacement authorization或自动重试；
- 没有Test TargetResult、`test-step` evidence mapping、`reviewInputContract`、`resultContract`、Controller Test Review
  或Demand Completion；这些合同尚无真实Test结果consumer，因此packet不会提前声称支持；
- 没有公共MCP/CLI、旧JS同步、实体Codex/Claude发送、版本发布或安装cache切换。

### 195.7 聚焦验证

```text
Tasking + Demand + Delivery + Result + Review + Lifecycle + Testing
+ MCP wire + Binding + 新Foundation聚焦测试:
  148 pass / 0 fail / 0 skip
Test target-facing flow:
  prepared Test Delivery Event
  → zero-business-write projection materialization
  → exact TaskPackage + TestCard + TestDispatchPacket files
  → second materialization all current
  → Event Stream revision unchanged
  → strict Demand Root Authority reload pass
Negative closure:
  same-schema forged briefing with recomputed packet digest
  → source cross-check rejects relation;
  different existing projection bytes → conflict without overwrite;
  illegal Test projection filename / unknown artifact directory → tree-shape reject
Language and privacy:
  English + zh-Hans prompt rendering pass;
  no raw handle / absolute workspace path / Claim / host effect / result contract
TypeScript: pass
Architecture: pass / parser=swc / 570 modules / 3994 dependencies / 0 violations
Schema: pass / 64 schemas / 189 external refs
Schema digest: sha256:86afb3c537a46f91b03eb1f8d826615384c08ddd6348e1d7fcb257a1f98313b4
git diff --check: pass
```

验证只执行新版相邻TS范围与新增Foundation文件；未运行旧JS、完整TS套件、插件validator/smoke、
`npm test`或release gate。没有提交、发布或刷新安装cache。

## 196. R-2B-5（Test pre-send WindowWorkClaim与Agent Host Action）

### 196.1 Claim是共享窗口能力，不是第二套Testing锁

Test和implementation在宿主效果前需要解决的是同一个业务无关问题：一个稳定Window同一时刻只能被
一个精确Demand/Task/Delivery代际占用，旧持有者不能释放或执行后继Claim。现有
`WindowWorkClaimStore`已经提供：

- 按`windowId`固定路径的durable exclusive create；
- 同一完整Claim重放返回`current`，不同Claim返回`occupied`；
- 精确Claim文档与同一文件节点的compare-before-retire；
- 无TTL、无进程存活推断、无按时间自动释放；
- Claim文件先于Demand Event建立，跨Demand排他与本Demand状态提交分离。

因此没有新增`TestWindowLock`、Test Claim Store或第二个Claim Event。`WindowWorkClaim`改为严格判别联合：

| Claim target | 持久字段 |
| --- | --- |
| implementation | 保持既有字段，继续省略`workType` |
| Test | `workType:test` + exact `testAttemptId` + `testDispatchPacketDigest` |

现有implementation Claim的领域渲染字节不增加空字段，Test才写入真实consumer需要的fence。

[Hazelcast FencedLock](https://docs.hazelcast.com/hazelcast/5.2/data-structures/fencedlock)
说明仅有“持有锁”不足以阻止暂停后恢复的旧客户端对外产生副作用，必须把递增fencing token交给外部资源；
[Redis distributed locks](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/)
也要求release时比较唯一owner token，且提醒TTL不能证明旧持有者仍安全。Wakeflow没有远程线性一致锁服务，
因此不伪造递增token或自动过期语义；它把Claim ID/digest、Binding generation、Intent digest、packet digest、
expected state digest和Event Stream revision一起传到后续宿主fence，释放时继续比较完整Claim与文件节点。

TencentDB-Agent-Memory的`checkpoint.ts`与conversation extract lock同样使用owner/token校验释放，但其
worker锁依赖TTL和超时接管。Wakeflow只学习“不能由旧owner删除新owner锁”的边界，不移植其时钟和接管模型。

### 196.2 请求判别与Test Claim Authority

`TargetHostEffectClaimRequest`现在显式要求：

```text
implementation
  → workType + Demand/Task/Delivery/Intent + Agent observation

test
  → 上述字段
  + exact TestDispatchPacket digest
```

没有使用“先查product Event，找不到再猜Test”的隐式分支。请求判别先确定唯一Event family；错误类型、缺失
packet digest或额外字段在打开业务写边界前拒绝。

Test Claim Authority依次复验：

```text
unique testing.test-delivery-prepared Event
→ Aggregate仍是同一test-delivery-prepared attempt
→ Config Program/digest与Test Window
→ 从Event幂等物化并复验TaskPackage/TestCard/TestDispatchPacket
→ caller确认的packet digest
→ 当前唯一Test Window Binding
→ 同Binding、同Config、同逻辑根的新鲜Agent Host observation
```

packet投影修复可以先发生，但它只是可重建read model；错误packet digest不会创建WindowWorkClaim或追加Event。
[Google Cloud Storage preconditions](https://docs.cloud.google.com/storage/docs/request-preconditions)
强调连续读取/写入必须绑定同一generation，否则元数据与内容可能来自不同对象。这里的Intent/Binding/packet/
state digest组合承担同类precondition作用：任何一项漂移都在Claim Event前失败。

### 196.3 共享Claim Event与Test Aggregate状态

`delivery.target-host-effect-claimed.v1`本身表达“Target Window宿主效果已取得持久占用”，并不拥有产品
源码语义，因此继续由implementation与Test共享。没有新增含义重复的
`testing.test-host-effect-claimed` Event family。

Reducer按Claim target判别：

```text
implementation delivery-prepared
  → host-effect-claimed

Test test-delivery-prepared
  → test-host-effect-claimed
```

Test current summary保留Target Delivery/Intent/Binding/TestAttempt、append-only attempt authorization和
WorkClaim摘要；WorkClaim摘要额外保留packet digest。完整Claim仍由不可变Event拥有，Aggregate不复制prompt、
packet正文或Agent observation。

post-acceptance route新增明确的`test-host-effect-claimed`读模型，暴露Test Delivery、attempt、packet与
Claim tuple，供后续真实host effect/outcome owner定位；它不表示消息已发送。

### 196.4 Test Agent Host Action

新增瞬时`WakeflowTestDeliveryAgentHostAction`。它只在Claim Event首次`committed`后返回，绑定：

- Claim ID/digest/ref、expected state digest与Claim Event/Commit；
- current host/window/binding和最新Agent observation digest/time；
- Target Delivery/Intent、logical Test attempt；
- TestDispatchPacket ref/digest；
- packet portable prompt加当前调用期workspace absolute root。

Action不持久化、不包含raw handle、send result、readback或retry permission。Agent仍须使用刚刚通过Authority
校验的同一候选handle调用宿主能力。相同Claim/Event重放返回`already-claimed + action:null`，不会重新签发
一次性发送授权。

[Amazon EC2 idempotency](https://docs.aws.amazon.com/ec2/latest/devguide/ec2-api-idempotency.html)
规定同client token只有在参数完全相同时才能幂等重放，参数漂移必须返回mismatch。Wakeflow同样允许同Claim
身份和全部来源参数前向恢复；packet、attempt、Binding或Intent不同都不会借用原Claim继续。

### 196.5 失败与恢复顺序

```text
加载并复验全部Authority来源
→ 检查observation freshness
→ 创建或确认同一WindowWorkClaim
→ pure reducer + Event Commit capacity preflight
→ 再次复验Config/Binding/packet/observation
→ 构造但不执行Agent Host Action
→ optimistic append共享Claim Event
→ 只有首次commit返回Action
```

Claim文件已经创建而Event缺失时，重试使用Claim内预分配Event/Commit身份前向完成，并只签发首次Action。
Claim创建后、Event提交前发生Binding/Config/packet漂移时，只删除仍与完整Claim和节点预期一致的原Claim；无法
证明时保留并报告unknown/recovery-required。Event已经提交后永不通过异常补偿删除Claim。

### 196.6 明确未进入的范围

- 没有调用Codex/Claude宿主发送工具，没有raw handle解析、send/readback或outcome Event；
- 没有Test Host Effect Observation、rejected-before-send rearm、resume/restart attempt或自动重试；
- 没有environment setup receipt、外部环境lease、secret获取、runner或Pod Test access；
- 没有Test TargetResult、test-step evidence、Controller Test Review、Demand Completion或public MCP/CLI；
- 没有修改旧JS/core、插件artifact、版本、发布或安装cache。

### 196.7 聚焦验证

```text
Tasking + Demand + Delivery + Result + Review + Lifecycle + Testing
+ MCP wire + Binding + 新Foundation相邻矩阵:
  152 pass / 0 fail / 0 skip
Shared Claim compatibility:
  既有6组implementation Claim/恢复测试全部通过;
  implementation Claim仍省略workType/test字段;
  同一delivery.target-host-effect-claimed.v1可归约两类Target
Test Claim vertical flow:
  exact Intent + packet + Binding + fresh observation
  → WindowWorkClaim exclusive create
  → shared Claim Event commit
  → Aggregate test-host-effect-claimed
  → packet-bound Test Agent Host Action
  → retry idempotent + action:null
Crash recovery:
  Claim file current + Event absent
  → reuse original Claim/Event/Commit IDs
  → forward commit + one first Action
Negative gates:
  missing workType / missing Test packet digest rejected at input;
  wrong packet digest rejected before Claim/Event;
  different current Claim remains occupied;
  stale observation and Binding drift retain existing compensation rules
Privacy/effect boundary:
  no raw handle / send result / readback / TTL / retry permission;
  no Codex or Claude host tool invoked
TypeScript: pass
Architecture: pass / parser=swc / 574 modules / 4051 dependencies / 0 violations
Schema: pass / 64 schemas / 190 external refs
Schema digest: sha256:39471ecf3abbdda241e6af19b9100f0dbc57c55f8cf6b127912bb63d80d6c562
git diff --check: pass
```

验证只执行新版相邻TS范围；未运行旧JS、完整TS套件、插件validator/smoke、`npm test`或release
gate。没有提交、发布或刷新安装cache。

## 197. R-2B-6（Test Host Effect Observation与Outcome recording）

### 197.1 Observation记录宿主投递事实，不是Test执行结果

R-2B-5签发的`WakeflowTestDeliveryAgentHostAction`只授权Agent调用当前宿主窗口。Agent把prompt发送到
Test窗口后，Wakeflow首先需要记录“消息投递发生了什么”；此时Test尚未完成真实环境步骤，也没有产生
Test Result。因此本单元继续严格区分：

```text
Host Effect Observation
  = 宿主消息尝试 + 最多一次readback的脱敏事实

Test Result
  = Test窗口执行approved plan后返回的步骤证据与结论
```

Observation的`accepted`只表示宿主接收或readback确认，不表示测试通过、实现正确或Demand可完成。

### 197.2 共享Observation内核，Test action增加lineage fence

implementation与Test的宿主投递都有相同双轴：

- attempt：`accepted | indeterminate | rejected-before-effect`；
- readback：`confirmed | pending | unavailable`；
- 原始attempt/readback JSON只参与有界Canonical SHA-256计算，不进入持久Event；
- `confirmed` readback可以把`indeterminate` attempt提升为最终`accepted`；
- `rejected-before-effect`只能配`unavailable` readback。

因此没有新增第二个Test Observation Store或Event family。现有
`WakeflowTargetDeliveryHostEffectObservation`的action改为判别联合：

| action | 持久字段 |
| --- | --- |
| implementation | 保持历史字段并省略`workType` |
| Test | 历史字段 + `workType:test` + `testAttemptId` + `testDispatchPacketDigest` |

完整Test packet、prompt、absolute workspace root、raw handle、宿主返回值和错误文本都不会进入Observation。

### 197.3 为什么保留indeterminate且不自动重发

[RFC 9110 §9.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2)
规定：非幂等请求只有在能证明语义幂等或原请求从未应用时才应自动重试；
[RFC 9113 Request Reliability](https://www.rfc-editor.org/rfc/rfc9113.html#section-8.7)
也强调一般错误下客户端无法判断服务端是否已经处理非幂等请求。Agent窗口消息可能已经触发目标执行，缺失
宿主响应不能被猜成“未发送”。

[Google Cloud Tasks](https://docs.cloud.google.com/tasks/docs/common-pitfalls#duplicate_execution)和
[Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues-at-least-once-delivery.html)
都明确要求消费者面对少量重复执行时保持幂等。Wakeflow当前无法证明任意Agent TaskPackage执行幂等，因此选择：

```text
accepted + pending/unavailable
  → retain Claim，展示层可派生sent-unconfirmed，不重发

indeterminate + pending/unavailable
  → retain Claim，等待TargetResult/人工事实，不重发

rejected-before-effect + unavailable
  → 先提交Observation Event，再授权精确释放Claim
```

TencentDB-Agent-Memory的`pending-writes.ts`明确选择“宁可重复、下游hash去重”，适用于其L0内存写入；
Wakeflow唤醒目标Agent可能重复执行代码修改或环境操作，不能套用该代价模型。

### 197.4 Outcome请求与Authority闭合

`TargetHostEffectOutcomeRequest`与Claim请求使用相同显式判别：

```text
implementation
  → workType + Demand/Task/Delivery/Action + observation digest + 双轴事实

test
  → 上述字段 + exact testAttemptId + TestDispatchPacket digest
```

Outcome Authority从唯一Claim Event恢复Action闭合字段，并复验：

- Demand/Task/Delivery和Claim Event身份；
- Aggregate当前Claim ID/digest、Event/Commit/revision和expected state digest；
- Claim route与Aggregate Host/Window/Binding；
- Agent observation authority digest与Claim时冻结值；
- Test request、Claim、Aggregate和Observation中的attempt/packet digest四方一致；
- 已结算Event重放只能生成与当前Aggregate host-effect摘要完全相同的Observation。

逐文件复读同时发现一个product既有缺口：Aggregate reducer此前没有比较
`hostObservationAuthorityDigest`，虽然Outcome Authority会构造该字段，但纯Decider仍可能接受伪造值。现已在
Authority和Reducer两层同时复验，并增加“错误digest不追加Event”的product回归。

### 197.5 共享Event、Test状态与后续路由

两类Target继续共用`delivery.target-host-effect-observed.v1`，因为Event表达相同宿主事实。Test reducer只在
`test-host-effect-claimed`接收带Test fence的Observation，并转为：

| disposition | Aggregate phase | Claim | next route |
| --- | --- | --- | --- |
| accepted | `test-host-effect-accepted` | retain | `test-result-planning` |
| indeterminate | `test-host-effect-indeterminate` | retain | `test-result-planning` |
| rejected-before-effect | `test-host-effect-rejected` | Event后exact release | `test-host-effect-rearm-planning` |

Test current summary继续保留原attempt authorization、packet-bound WorkClaim和最小host-effect摘要；原始Evidence只
保留digest。`test-result-planning`不是Test通过，`test-host-effect-rearm-planning`也不是自动重发许可。

Outcome Event使用Claim ID确定性派生Event/Commit ID；完全相同请求重放返回`already-recorded`。明确拒绝分支
若Event已经提交但Claim释放中断，重试只完成同一Claim的精确释放，不再次创建Observation或宿主效果。

### 197.6 明确未进入的范围

- 没有Wakeflow自主调用Codex/Claude发送、raw handle读取、重复readback或polling；
- 没有Test TargetResult、test-step evidence mapping、Controller Test Review或Demand Completion；
- 没有Test replacement delivery/rearm实现；当前只路由到独立rearm planning，不自动重发；
- 没有resume/restart logical Test attempt、environment setup receipt、runner、secret或Pod Test access；
- 没有public MCP/CLI、旧JS/core、插件artifact、版本、发布或安装cache改动。

### 197.7 聚焦验证

```text
Tasking + Demand + Delivery + Result + Review + Lifecycle + Testing
+ MCP wire + Binding + 新Foundation相邻矩阵:
  156 pass / 0 fail / 0 skip
Shared Observation compatibility:
  implementation action继续省略workType/test字段;
  既有accepted/indeterminate/rejected/release/rearm测试全部通过;
  同一delivery.target-host-effect-observed.v1可归约两类Target
Test host-effect matrix:
  accepted + pending
    → Test Observation Event + retain Claim + test-result-planning
  indeterminate + unavailable
    → retain Claim + no retry permission + test-result-planning
  rejected-before-effect + unavailable
    → Observation Event + exact Claim release + rearm planning
Idempotency/recovery:
  same action derives same Event/Commit IDs;
  exact replay already-recorded;
  rejected Event current + Claim residue → retry only settles release
Lineage/privacy:
  Test action/Claim/Aggregate/Observation attempt+packet digests close;
  wrong Agent observation authority digest rejected before Event;
  raw host attempt/readback evidence only contributes Canonical SHA-256
Effect boundary:
  no Codex/Claude host call, polling, automatic resend, Test Result or rearm
TypeScript: pass
Architecture: pass / parser=swc / 575 modules / 4068 dependencies / 0 violations
Schema: pass / 64 schemas / 191 external refs
Schema digest: sha256:7ee2debac36afbb24a545b214f283284c82139779fcc869a8552887dbd2e0610
git diff --check: pass
```

验证只执行新版相邻TS范围；未运行旧JS、完整TS套件、插件validator/smoke、`npm test`或release
gate。没有提交、发布或刷新安装cache。

## 198. R-2B-7（同一Test attempt的显式替代Delivery授权）

### 198.1 这不是自动重试，也不是创建新Test attempt

R-2B-6只在Agent明确报告`rejected-before-effect + unavailable`后记录Observation Event并精确释放
WindowWorkClaim。此时可以证明上一份宿主投递没有开始执行，但仍不能重新使用旧Delivery身份把变化后的请求
伪装成幂等重放。

[Stripe Idempotent Requests](https://docs.stripe.com/api/idempotent_requests)和
[Amazon EC2 Idempotency](https://docs.aws.amazon.com/ec2/latest/devguide/ec2-api-idempotency.html)都要求：同一
幂等身份只能重放相同参数；参数发生变化时必须拒绝mismatch或使用新的操作身份。
[Stripe Advanced Error Handling](https://docs.stripe.com/error-low-level#idempotency)进一步区分了“原请求是否已执行
不确定”与“执行前已拒绝”：不确定结果不能通过新身份盲目再发。

Wakeflow因此采用以下闭合语义：

```text
accepted / indeterminate
  → 保留原Claim，不产生替代授权

rejected-before-effect + unavailable + exact Claim released
  → 保留同一logical Test attempt
  → 分配新的Target Delivery / Intent / Event / Commit身份
  → 追加第N份Delivery authorization
  → 不调用宿主，不自动取得下一份Claim
```

旧JS `wakeflow-delivery-orchestration.mjs`也把该分支称为`replacement-authorization`并保留同一
`testAttemptId`。新版只采纳这项真实业务语义；没有复制旧DispatchGroup、Envelope、状态文件或宿主发送实现。

### 198.2 Intent与Aggregate使用追加型授权历史

`WakeflowTestDeliveryIntent`保持schema v1和已有initial持久字节不变：initial Intent仍省略`replacement`；
替代Intent新增严格上下文：

- 顺序连续的`authorizationOrdinal`；
- 上一份Target Delivery、Intent digest和TestDispatchPacket digest；
- 被拒绝Claim的ID/digest/Event/Commit；
- rejected Host Effect Observation digest与时间。

同一attempt最多保留32份有界授权，运行时代码使用单一常量，Schema保留相同上限。Aggregate不覆盖旧授权，
而是把新摘要追加到`deliveryAuthorizations`；每个ordinal必须等于数组位置、Target Delivery必须唯一、
`preparedAt`必须严格递增。currentDelivery只移动到最新授权，完整旧Intent/Claim/Observation仍由Event历史拥有。

本变化对旧Event和Snapshot保持向后可读：旧Intent没有可选字段，旧attempt仍只有ordinal 1；没有虚构一个
语义重复的Event family，也不需要为兼容性引入空字段或分支。

### 198.3 替代授权的组合Authority

Preparation请求现在具有显式判别：

```text
mode: initial
  → 创建新的logical Test attempt与首份Delivery授权

mode: replacement-authorization
  → 指向previousTargetDeliveryId + actionId + observationDigest
  → 沿用已有attempt，只分配新的Delivery/Event/Commit身份
```

替代preview在零写条件下同时复验：

- 当前route必须是`test-delivery-replacement-planning`；旧名
  `test-host-effect-rearm-planning`已删除，避免与implementation“重新打开同一Delivery”的Rearm混淆；
- Aggregate尾部必须是同一Test target的`test-host-effect-rejected`；
- previous Test Delivery Event、Claim Event和Observation Event形成唯一闭合历史；
- request、route、Aggregate、Intent、Claim、Observation中的Demand/Task/Delivery/attempt/packet/digest一致；
- Observation必须是`rejected-before-effect + unavailable`，Claim handling必须是`release-authorized`；
- 旧Test Window Claim和TestCard引用的product Window Claims均已物理absent；
- TaskPackage/TestCard Authority、当前Config与当前唯一Test Window Binding仍有效；
- 授权数量没有达到有界上限。

preview只返回不可变Plan。apply在Event不存在时重新加载上述当前Authority、按Plan时间重建Intent并比较完整
Canonical JSON，再执行stream revision/CAS append；Event已存在的精确重放只从不可变Event恢复TaskPackage与
TestCard，不依赖后来可删除的投影、Config或Binding。

### 198.4 与implementation Rearm的边界

现有`TargetHostEffectRearmService`服务implementation投递：它保留同一个Target Delivery/Intent，在旧Claim
明确释放后把状态重新打开为`delivery-prepared`。Test替代授权不能复用该模型，因为新的Test packet可能绑定
新的Binding和新的Intent digest，且必须保留每次授权的attempt lineage。

因此本轮没有把Test塞入`delivery.target-host-effect-rearmed`，也没有修改implementation Rearm。Test继续使用
既有`testing.test-delivery-prepared`事实，但Intent内明确说明initial或replacement来源；Reducer据此选择创建
attempt或追加授权。

### 198.5 新packet与下一次Claim仍是两个显式步骤

替代Event提交后，Test Dispatch Projection可以从Event重建一份绑定新Intent digest的packet；旧packet仍按旧
Target Delivery身份可审计。Preparation结果不含Agent Host Action，也不会创建WindowWorkClaim。

只有调用方随后提交新Target Delivery/Intent/packet和一份fresh Agent窗口观察，现有Claim owner才会：

```text
exclusive create新WindowWorkClaim
→ append共享Claim Event
→ 首次commit后签发新的packet-bound Agent Host Action
```

新的Claim和Action继续保留原`testAttemptId`，但绑定新Target Delivery、Intent和packet digest。这样“允许再次
投递”与“实际取得一次宿主效果占用”保持分离。

### 198.6 明确未进入的范围

- 没有Wakeflow自主调用Codex/Claude发送，没有自动重发、polling、readback或raw handle读取；
- 没有为accepted或indeterminate结果生成替代授权；
- 没有创建第二个Test attempt、resume/restart attempt或解释TestCard `maxAttempts`策略；
- 没有environment setup receipt、runner、secret、Pod Test access或Test Result；
- 没有public MCP/CLI、旧JS/core、插件artifact、版本、发布或安装cache改动。

### 198.7 聚焦验证

```text
Focused TypeScript tests:
  15 pass / 0 fail / 0 skip
Initial compatibility:
  initial mode仍创建一个attempt + ordinal 1;
  preview零写、Apply CAS、并发同Plan和已提交重放继续通过
Replacement vertical flow:
  rejected Observation Event + exact Claim release
  → forged observation digest rejected
  → zero-write replacement preview
  → same attempt + new Delivery + ordinal 2 Event
  → exact apply retry idempotent
  → packet projection rebuilt from replacement Event
  → explicit next Claim + new packet-bound Action
Safety boundaries:
  accepted/indeterminate仍进入test-result-planning并保留Claim;
  replacement apply不返回Action且不调用宿主;
  stale Config/Binding、错误packet和Claim恢复边界继续通过
Event evolution:
  state-model version isolation + event upcaster routing通过
TypeScript: pass
Architecture: pass / parser=swc / 575 modules / 4076 dependencies / 0 violations
Schema: pass / 64 schemas / 191 external refs
Schema digest: sha256:e7d32bc4375d92482ff86e246e4d0f5915c16acf1c1153b9344074221606902c
git diff --check: pass
```

验证只执行本轮新增与紧密相邻的新版TS测试；未运行旧JS、完整TS套件、插件validator/smoke、`npm test`或
release gate。没有提交、发布或刷新安装cache。

## 199. R-2B-8（Test Result模块边界与Report合同）

### 199.1 当前代码事实

当前`TargetResultReport`、`TargetResult`与`TargetResultImportService`不是通用结果骨干，而是明确限定为
单仓库implementation：Report要求一个`repositoryChange`和`anchorEvidence`，Result要求
`assignment.repositoryId`及product `TargetDeliveryIntent`，Import只查找product prepared Event，Aggregate
只允许`host-effect-accepted | host-effect-indeterminate → result-reported`。

另一方面，当前Test垂直链已经提供真实Result消费者所需的上游事实：TestCard approved plan、Test TaskPackage、
TestExecutionAttempt、TestDeliveryIntent、TestDispatchPacket、packet-bound Claim与Test Host Effect
Observation。route已明确进入`test-result-planning`，但尚无Test Report、Test Result Event、Claim结算或
`test-result-reported`状态。

因此R-2B-8不能只增加一个自由文本结果字段，也不能把Test结果伪装成repository result。它至少需要闭合：

- 同一Test attempt、最新Delivery authorization、packet、Claim与Observation；
- Agent执行结果的`completed | blocked | needs-review`陈述；
- 每个已返回approved plan step与exact evidence locator的关系；
- completed时全部approved steps按原顺序恰好映射一次；
- Test不能声明product repository change或acceptance-anchor evidence；
- Event提交后才精确释放Test WindowWorkClaim；
- Aggregate只保存后续Controller review所需最小摘要，完整证据仍留在Event Result中。

### 199.2 外部实践与适用边界

[Azure Test Plans Actual Result](https://learn.microsoft.com/en-us/azure/devops/test/actual-result)区分作者定义的
Expected Result、执行者记录的逐步Actual Result和非结构化Comment；Actual Result可以作为审计证据，但仍属于
某次run的执行事实。这支持Wakeflow把approved plan保留在TestCard，把逐步事实放在Test Report，而不是反向
改写Card。

[Open Test Reporting](https://github.com/ota4j-team/open-test-reporting)与
[JUnit Platform Reporting](https://docs.junit.org/6.0.0/advanced-topics/junit-platform-reporting.html)提供跨框架的
event/hierarchical测试报告格式。Wakeflow不应再发明通用runner report：JUnit/Open Test Reporting、CI日志、
截图或人工检查记录都可以作为外部Evidence Artifact，由Result保存portable ref + digest及approved-step映射。

[W3C PROV-DM](https://www.w3.org/TR/prov-dm/)把Entity、Activity、Agent、Generation和Derivation分开；当前
TestCard/attempt/Result/Event lineage已经是面向Wakeflow领域的窄化provenance，不需要引入完整PROV模型或依赖。

TencentDB-Agent-Memory的`core/report`把OpenTelemetry Trace实现为非侵入装饰层，并在后端失败时降级；
`api-sanitize.ts`负责有界脱敏。[OpenTelemetry Signals](https://opentelemetry.io/docs/concepts/signals/)也把trace、
metric和log定义为观察系统活动的signals。该模式可供未来Evidence采集学习，但Trace/日志不能替代
Event Sourcing Result authority，也不能因观测后端失败改变业务Result提交。

### 199.3 三个互斥方案

这些是模块边界选择，不是需要依次实施的三个阶段：

| 方案 | 结构 | 优点 | 代价 |
| --- | --- | --- | --- |
| A（用户已确认） | `ImplementationTargetResultReport`与`TestTargetResultReport`分别拥有Agent业务陈述；authority-enriched `TargetResult`使用`workType`判别联合，并共享Result Event、Import owner、Claim结算和Review历史 | 文件职责最清楚；Test没有伪repository字段；共享真正相同的下游事实；避免一个超大Report parser | 需要重命名当前implementation Report并同步现有消费者；当前TS尚未发布，按既有决策不承担兼容分支 |
| B | 单个`TargetResultReport`内使用`workType`和条件Schema，repository/anchor/step字段按分支出现；其余共享 | Artifact种类最少 | 当前Report已超过500行，继续加入两套关系验证会形成大文件；Agent输入职责混合，后续维护容易再膨胀 |
| C | 新建完整`TestTargetResult`、Test Result Event与独立Import Service | Test完全隔离 | 重复Result ID/Event/Claim settlement/Repository audit/Review管线；与一个TargetResult review入口相冲突，不建议 |

推荐A不是复制旧JS。旧JS的Group/Envelope、`repositoryChanges`多仓库数组、supersedes和完整transport closure
不会进入当前切片；新TS继续使用当前单Target Delivery + Event authority，只把“Agent业务报告不同、领域Result
事实共享”落成清晰模块。

### 199.4 推荐A的预期文件顺序

```text
1. implementation-target-result-report Schema + codec（由当前文件语义化重命名）
2. test-target-result-report Schema + codec（逐步evidence mapping）
3. target-result Schema + codec（显式workType判别联合）
4. target-result-import input/authority/service（同owner两类来源）
5. shared result.target-result-recorded Event + Test Aggregate reducer
6. Demand review snapshot + test-result-review-planning route
7. 一条小型真实纵切：Test outcome → report import → Event → Claim release → review-ready snapshot
```

用户确认采用方案A。R-2B-8仍不包含Controller对Test的accept/rework判断、新attempt resume/restart、
Demand completion、外部runner、Evidence文件owner或宿主调用；这些需要后续真实consumer再进入。

### 199.5 Report合同首个文件单元

现有泛化命名已收敛为`ImplementationTargetResultReport`：Schema ID、Artifact kind、生成类型、手写codec、
生产者、消费者和聚焦测试全部同步改名。它继续只拥有单仓库repository change与acceptance-anchor evidence，
行为没有扩展到Test。由于新TS尚未发布且用户已明确不承担过渡，本轮不保留旧kind、旧schema URI、重导出或
兼容parser；Event compatibility digest自然变化，已有开发期Snapshot会按既有机制回退完整replay。

新增`TestTargetResultReport`，只包含：

- `completed | blocked | needs-review`目标窗口陈述；
- 有界`{kind,ref,digest}` Evidence locators，Test中每个ref只能绑定一个digest；
- verification、risks和按`planIndex`严格递增的step evidence；
- 每个step evidence必须指向一条已声明的exact ref/digest tuple；
- reportedAt、self-excluding Canonical JSON digest与确定性文档表示。

Report层不知道TestCard，因此只验证索引有界、顺序和Evidence引用闭合。`completed`与完整approved plan逐项
相等的验证属于下一`TargetResult` authority单元，不能由Report猜测。blocked/needs-review可以返回空或部分
step evidence，但已返回的映射仍必须闭合。

两类Report真正共享的`TargetResultOutcome`与`TargetResultEvidenceLocator`下沉到窄
`target-result-report-contract.ts`；该文件只有领域值类型，不拥有parser、manager、状态或I/O。Test Report没有
repository、acceptance anchor、pass/fail verdict、runner输出、transport、Claim或Controller decision字段。

```text
Focused Result/Review tests: 15 pass / 0 fail / 0 skip
Implementation Report rename:
  schema/kind/codec/producers/consumers/tests close under the new semantic name
Test Report:
  deterministic round-trip + content digest;
  completed step evidence;
  blocked empty evidence;
  dangling tuple / duplicate ref / out-of-order plan index rejected
TypeScript: pass
Architecture: pass / parser=swc / 579 modules / 4095 dependencies / 0 violations
Schema: pass / 65 schemas / 194 external refs
Schema digest: sha256:89858a9e6b4e17d9acb1632bc7e846282501d3a99623321b7a89a3d7b4c517f3
git diff --check: pass
```

本单元未让Test Report进入TargetResult/Event/Import/Aggregate；下一单元才把两个Report接入同一个显式
`workType` TargetResult判别联合。

### 199.6 显式workType TargetResult判别联合

共享`WakeflowTargetResult`现在要求显式`workType: implementation | test`，没有通过字段缺失猜测类型：

| 分支 | assignment | Report | 分支特有事实 |
| --- | --- | --- | --- |
| implementation | exact repository + product window | `ImplementationTargetResultReport` | 禁止`testExecution` |
| test | exact Test window，无repository | `TestTargetResultReport` | attempt、TestCard tuple、TestDispatchPacket digest |

共享`target-result.ts`只负责严格Schema解析、typed身份、TaskPackage tuple、Host Effect摘要、Report判别、
self-excluding digest、确定性文档和从Claim派生的稳定Result/Event/Commit身份。来源闭合拆到两个相邻模块：

- `implementation-target-result.ts`继续验证单仓库TaskPackage、product Intent、Claim/Observation、commit policy
  与完整acceptance-anchor mapping；
- `test-target-result.ts`验证Test TaskPackage、TestCard、TestDeliveryIntent、prepared Event packet投影、
  packet-bound Claim/Observation与逐步Evidence mapping。

Test `completed` Result要求`stepEvidence`与`TestCard.approvedPlan`数量相同、按index连续且step文本逐字相等；
blocked/needs-review可以部分返回，但不能引用Card范围外或不同文本。Result保存`testAttemptId`、Card ID/digest与
packet digest，使后续新attempt/review owner无需从自由文本推断lineage。它不保存repository占位、Test verdict、
Controller decision、raw Evidence正文或runner输出。

现有implementation Result Event/Reducer/Import继续显式只接纳`workType: implementation`。虽然共享Result
Schema已经可以表达Test，当前还没有Service把Test Result写入Event；该能力属于下一垂直单元，避免“类型可构造”
被误报为Event Sourcing流程完成。

### 199.7 Foundation Schema的对象uniqueItems修正

真实Test Result包含两条step Evidence时暴露：Wakeflow安全JsonValue对象使用`null`原型，而Ajv内置
`uniqueItems`深比较会调用对象`valueOf`，导致对象数组在第二项比较时抛出TypeError。放宽Result Schema会把
底层缺口留给其他领域，因此修正在`runtime-json-schema.ts`：

- 保留原始无原型、递归冻结JsonValue，不转换或替换领域输入；
- 只替换Ajv的`uniqueItems`关键字执行器，使用不调用对象方法的JSON结构相等比较；
- 对象成员顺序不影响相等，数组顺序仍影响相等；
- 自有`valueOf`/`toString`/`__proto__`只作为普通JSON成员，不获得执行机会；
- Validator成功仍返回同一个原始冻结对象。

新增Foundation回归同时覆盖两个不同对象、两个重复对象和自有`valueOf`文本，证明修复不是只针对Result
fixture。没有fork Ajv、修改`node_modules`或为某个Schema删除`uniqueItems`。

```text
Focused Foundation/Delivery/Demand/Result/Review tests:
  31 pass / 0 fail / 0 skip
Implementation TargetResult:
  explicit workType + no testExecution;
  existing Report/commit/anchor/Claim/Event behavior retained
Test TargetResult:
  real Test Delivery Event + packet + Claim + accepted Observation
  → exact Card/attempt/packet source closure
  → completed ordered step mapping
  → deterministic shared TargetResult round-trip
  incomplete completed mapping rejected
Foundation Schema:
  null-prototype object uniqueItems + own valueOf safe;
  validator returns original frozen JsonValue
TypeScript: pass
Architecture: pass / parser=swc / 582 modules / 4128 dependencies / 0 violations
Schema: pass / 65 schemas / 194 external refs
Schema digest: sha256:c1cdc77a026bad3363adc2345bbd6bfed94b53020e0d7eafb0185b05bdf12ef2
git diff --check: pass
```

本单元未实现Test Result Import、Result Event reducer、Claim release、Review route或Controller Test Review。

### 199.8 Test Result Import与Event Sourcing纵切

`TargetResultImportRequest`现在同样使用显式`workType`：implementation保持原四元identity与
Implementation Report；Test额外要求`testAttemptId`和`testDispatchPacketDigest`，并只接受
Test Report content。Import输入不能通过字段缺失猜测目标类型。

新增`target-result-import-authority.ts`，从同一Demand Event Stream恢复：

```text
Claim Event + Host Effect Observation Event
  + implementation TargetDelivery/TaskPackage
或
  + TestDelivery/TestCard/Test TaskPackage
    → 从prepared Event确定性重建TestDispatchPacket（不依赖可删除投影）
```

Test分支逐项闭合request、Intent、attempt、packet、Claim和Observation中的Demand/Task/Delivery/
Claim/Event/Commit/packet tuple。两类Result创建器还同步补齐Claim expected-state digest、Claim Event revision、
host-observation authority digest、route与issuedAt fence，纯创建函数不依赖Service恰好传入正确来源。

两类Result继续共享`result.target-result-recorded.v1`，因为Event表达同一事实：“目标窗口提交的严格Result已由
Wakeflow authority补齐并记录”。没有创建`testing.test-result-recorded`重复Event family。Event成功后，Import
owner才授权并执行原Test WindowWorkClaim的exact release；同Report重试按原Commit幂等恢复，Claim已经absent
时只返回`already-recorded + released`，不会重建Result或宿主效果。

Aggregate新增`test-result-reported`，最小摘要继续保留原attempt authorization、packet-bound Claim、Host Effect
和`targetResultId/resultDigest/outcome/reportedAt/release-authorized`。完整Test Report与Evidence映射只存在于
Result Event。Reducer复验Card、attempt、packet、Claim、Observation和Result tuple，拒绝rejected-before-effect
或跨workType Result。

Repository一次审计现在把`test-result-reported`纳入Result历史闭合；Demand Review Snapshot返回
`status: reported`和完整Test TargetResult。post-acceptance route进入
`test-result-review-planning`，只表示Controller已有可审查输入，不表示Test通过或Demand可完成。

真实纵切验证：

```text
Test Delivery Event + TestCard/TaskPackage Events
→ deterministic packet
→ Test Claim Event
→ accepted Host Effect Observation Event
→ completed Test Report with exact approved-step Evidence
→ shared TargetResult Event
→ Aggregate test-result-reported
→ exact Test Claim release
→ reported Review Snapshot
→ test-result-review-planning
→ exact import retry idempotent
```

```text
Focused Foundation/Delivery/Demand/Result/Review tests:
  31 pass / 0 fail / 0 skip
TypeScript: pass
Architecture: pass / parser=swc / 583 modules / 4148 dependencies / 0 violations
Schema: pass / 65 schemas / 194 external refs
Schema digest: sha256:37c01a50e8c1836ed242ffd19692330b8446c8680068e48109e5c66622509e7d
git diff --check: pass
```

本单元仍未实现Controller Test Review Decision、accept/rework、后续resume/restart attempt、Demand Completion、
public MCP/CLI、外部runner或Evidence文件owner。

## 200. R-2B-9（Controller Test Review决策合同）

### 200.1 当前implementation Review不能直接复用

现有`ControllerTargetReviewDecision`实际是implementation专用合同：assessment固定为
`requirementAlignment + implementationQuality`，decision为`accept | rework | redesign | blocked`，Reducer把
`rework`解释为产品实现缺陷，把`redesign`解释为需求不匹配。Test Review没有repository implementation可评价，
“另一次Test attempt”也不是产品rework。

旧JS允许同一Review Candidate对Test使用通用`rework`，随后`needs-rework`再由Delivery判断resume/restart；
accept则关闭TestCard。该逻辑证明“Test可再执行”和“Test接受后关闭Card”是真实需求，但词汇把产品修复、
Test复测、环境问题和证据不足压进同一状态，不适合作为新TS标准。

### 200.2 执行结果、失败分类和工作流决策必须分离

[Azure Test Results](https://learn.microsoft.com/en-us/rest/api/azure/devops/test/results/get?view=azure-devops-rest-7.1)
分别保存一次执行的outcome、attempt、failure type、resolution和关联bug；
[Azure Failure Type](https://learn.microsoft.com/en-us/azure/devops/test/manage-test-failure-type)也把失败分类放在
post-run analysis，而不是用`Failed`本身推导唯一修复动作。
[Azure Pipeline Test glossary](https://learn.microsoft.com/en-us/azure/devops/pipelines/test/test-glossary)进一步区分
Passed、Failed、Inconclusive、Blocked、Error、Aborted等执行结果和flaky事实。

Wakeflow当前Test Report故意没有pass/fail verdict；Controller必须读取step evidence并独立检查后，分别记录：

```text
Result outcome
  = Test窗口是否完整/诚实地完成返回合同

Controller conclusion
  = 当前Evidence对冻结Test问题说明了什么

Controller decision
  = 接下来允许哪一种工作流动作
```

TencentDB-Agent-Memory没有Controller Test Review或attempt-resolution状态机可复用；其Trace status只属于
observability signal，不能提供这里的业务决策词汇。

### 200.3 三个互斥方案

| 方案 | Test Decision | 优点 | 代价 |
| --- | --- | --- | --- |
| A（用户已确认） | `accept`、`request-another-attempt`、`escalate-product-defect`、`blocked`；assessment分为`conclusion: satisfied | defect-observed | inconclusive`和`evidenceSufficiency: sufficient | insufficient` | 明确区分关闭环境风险、复测、产品缺陷与外部阻塞；后续route不会猜测`rework`含义 | 新增四个Test phase与明确关系矩阵；product-defect route暂时只阻塞/升级，不自动改产品任务 |
| B | `accept`、`request-another-attempt`、`blocked`；产品缺陷折叠进blocked reason | 状态更少 | 无法机器区分真实产品缺陷与环境/权限阻塞，后续产品remediation仍需解析人类文本 |
| C | 直接复用implementation的`accept | rework | redesign | blocked` | 改动最小 | `rework`同时表示产品修复和Test复测，assessment字段也不适用；延续旧项目歧义，不建议 |

推荐A的关系矩阵：

| decision | 必需assessment/检查 | 下一状态 | 当前切片动作 |
| --- | --- | --- | --- |
| accept | `satisfied + sufficient`，全部独立检查passed，Result必须completed，无blocking reason | `test-accepted` | 关闭Test Review；不自动完成Demand |
| request-another-attempt | `inconclusive`或evidence insufficient，至少一项failed/inconclusive，无blocking reason，attempt容量仍可用 | `test-another-attempt-requested` | 只授权后续attempt planning；不立即创建attempt |
| escalate-product-defect | `defect-observed + sufficient`，至少一项failed，无blocking reason | `test-product-defect` | 保留Evidence并显式阻塞到product remediation；不自动重开已接受任务 |
| blocked | blocking reason非空，不能同时声称`satisfied + sufficient` | `test-review-blocked` | 等待用户/环境/外部事实 |

### 200.4 推荐A的模块与Event边界

按已经确认的Result方案继续：

```text
ControllerImplementationReviewDecision（由当前文件语义化重命名）
ControllerTestReviewDecision（Test conclusion + decision）
                 ↓
共享ControllerReviewDecision判别联合
                 ↓
共享review.target-result-decided Event family
```

共享Event只表达“Controller已对精确Snapshot/Result作出审查决定”；两类assessment与状态转换由各自模块拥有。
Test Decision必须绑定TestCard、attempt、packet与TargetResult tuple，并重新验证ordered step evidence。当前切片不
创建下一attempt、不选择resume/restart condition、不修复产品、不完成Demand；这些分别由后续真实consumer拥有。

用户确认采用方案A。当前先完成Decision合同层；Event与Aggregate phase仍按后续独立单元接入。

### 200.5 implementation语义化重命名

现有泛化名称已完整收敛为`ControllerImplementationReviewDecision`：Schema ID、Artifact kind、生成类型、
手写codec、Input、Service、Event/Reducer/Rework/Completion消费者和全部fixture/test文件同步改名。没有保留旧
文件、旧kind、旧schema URI、重导出或兼容parser；当前TS尚未发布，version compatibility digest按新合同变化。

判断行为保持不变：implementation继续使用`requirementAlignment + implementationQuality`与
`accept | rework | redesign | blocked`，没有在重命名中改变产品review语义。

两类Decision真正共享的`ControllerIndependentReviewCheck`、check outcome和精确Snapshot/TargetResult reviewed
tuple下沉到`controller-review-decision-contract.ts`。该文件只有领域值类型，不拥有判断矩阵、状态、Event或I/O。

### 200.6 ControllerTestReviewDecision

新增独立Schema与codec，绑定：

- target-review-decision、Program/Demand/Test Target、Controller Window typed identity；
- Snapshot digest、review-unit digest、state digest/revision与TaskPackage/TargetResult精确tuple；
- Test attempt、TestCard ID/digest和TestDispatchPacket digest；
- conclusion、Evidence充分性、至少一项Controller独立检查、rationale、blocking reasons与residual risks；
- `decidedAt`必须晚于TargetResult `reportedAt`，以及self-excluding Canonical JSON digest。

关系矩阵同时由Schema和手写parser执行：

- accept只接受`completed + satisfied + sufficient + all checks passed + no blockers`；
- request-another-attempt要求inconclusive或Evidence不足、至少一项failed/inconclusive且无blocker；
- escalate-product-defect拒绝blocked Result，要求`defect-observed + sufficient + failed check`且无blocker；
- blocked必须有blocking reason，不能同时声称`satisfied + sufficient`。

Decision/Event/Commit身份继续共享同一随机UUID但使用独立typed namespace。Decision本身不包含next-attempt对象、
product mutation或Demand completion字段，防止合同创建时越权执行后续动作。

```text
Focused Implementation/Test Review + Event/Rework regression:
  18 pass / 0 fail / 0 skip
Implementation rename:
  Decision/Input/Service/Event/Reducer/Rework/Completion consumers close;
  existing four-decision matrix retained
Test Decision:
  accept / request-another-attempt / escalate-product-defect / blocked;
  deterministic document + Event/Commit identities;
  contradictory check/assessment/result and backward time rejected
TypeScript: pass
Architecture: pass / parser=swc / 587 modules / 4176 dependencies / 0 violations
Schema: pass / 66 schemas / 200 external refs
Schema digest: sha256:42146f00de9b3ecbce6a936471720552dd1e11b1472f51fb7d009617b2ef6953
git diff --check: pass
```

本单元尚未让Test Decision进入`review.target-result-decided` Event、Repository历史、Aggregate phase、Service或
route；也没有创建下一Test attempt、产品remediation或Demand completion。

### 200.7 共享Event family与来源专用Aggregate转换

`ControllerImplementationReviewDecision | ControllerTestReviewDecision`现已形成判别联合；
`review.target-result-decided.v1`的`decision`使用两份Schema的严格`oneOf`，Event、Decider与Commit身份统一按联合
解析。共享只发生在“Controller已对精确Result作出决定”这一持久事实，不合并两类assessment或状态词汇。

Aggregate分别执行两套转换：

- implementation仍只从`result-reported`进入`accepted | rework-requested | redesign-requested | review-blocked`；
- Test只从`test-result-reported`进入`test-accepted | test-another-attempt-requested | test-product-defect |
  test-review-blocked`；
- Test Decision除Snapshot、TaskPackage与TargetResult tuple外，还必须精确匹配当前TestAttempt、TestCard与
  TestDispatchPacket digest；
- 两类Decision都保存最小summary，完整不可变Decision继续由Event Stream提供，不能从Aggregate摘要反向扩展。

Repository审计历史同步改为Decision联合，并验证Decision kind与Target workType一致。TestCard创建事件也纳入同一
次完整重放的审计来源；Test Review Service不再为读取`maxAttempts`二次扫描Event Stream。

### 200.8 source-specific Service、attempt容量与显式route

新增`ControllerTestReviewDecisionInput/Service`。它与Implementation Service保持独立业务准入，但两者共享无状态的
`controller-review-decision-event-owner`，统一负责Event command、预检、commit容量、有限重读和append；没有建立
万能Review Service或把Test分支塞入Implementation Service。

Test Service保证：

- 只接受当前Review Snapshot中的Test reported unit，闭合Program/Demand/Controller authority；
- `request-another-attempt`在UUID和Event append之前，使用完整TestCard的`maxAttempts`与Aggregate已存在attempt数
  进行容量准入；
- Decision只授权后续owner，不创建下一attempt、Delivery、Claim或宿主效果；
- 相同Result/Snapshot/Judgment按已提交Decision身份幂等返回，并保留并发winner恢复语义。

判断关系由`ControllerTestReviewDecision`模块唯一拥有：Input可以在读取authority前提前调用同一关系断言，最终
Decision再结合权威Result outcome复验，避免两份矩阵漂移。

Post-acceptance route现显式区分：

```text
test-accepted                    -> 保留已接受Test Review事实
test-another-attempt-requested   -> test-another-attempt-planning
test-product-defect              -> test-product-defect-escalated
test-review-blocked              -> test-review-blocked
```

现有Demand Completion只支持`controller-only`，Aggregate completed合同也尚未定义TestCard/Test Target关闭。因此
`test-accepted`没有被伪装成`completion-preflight`；real-environment completion必须由后续独立切片先明确关闭语义。

### 200.9 聚焦验证与当前边界

真实小型测试覆盖两条Test专用路径：

- `maxAttempts = 1`时另一attempt请求零写拒绝，随后accept成功持久化、重放、生成Review Snapshot并精确幂等；
- `maxAttempts = 2`时另一attempt授权成功，route停在planning，且没有提前创建`nextAttempt`或replacement Delivery。

最终聚焦回归同时覆盖原Implementation Decision提交/并发、共享Event重放、Aggregate与原post-acceptance路线：

```text
Focused Demand/Implementation Review/Test Review regression:
  16 pass / 0 fail / 0 skip
TypeScript: pass
Architecture: pass / parser=swc / 593 modules / 4230 dependencies / 0 violations
Schema: pass / 66 schemas / 201 external refs
Schema digest: sha256:cb0d77e7c68b62d4c720b9dd0a75b3fe258ea7b1fab4188ce76bdf79e9e0618d
git diff --check: pass
```

本单元仍未实现下一TestAttempt的创建与restart condition选择、产品缺陷remediation、Test Review blocked resume、
real-environment Demand Completion/TestCard关闭、public MCP/CLI或外部runner。这些不能由当前Decision Service隐式
代办。

## 201. R-2B-10（另一Test attempt与环境setup语义预审）

### 201.1 当前TS的真实边界

当前已经存在两类不同重试，不能合并：

```text
宿主效果前 rejected-before-effect
  → 同一logical TestAttempt
  → replacement Delivery authorization
  → 不消耗TestCard.maxAttempts

Controller审查真实Test Result后request-another-attempt
  → 必须创建新logical TestAttempt
  → 消耗TestCard.maxAttempts
  → 尚未实现consumer
```

`TestExecutionAttempt`当前严格固定`ordinal:1 + mode:initial`；Aggregate的`testAttempts`类型和parser也只允许一个
entry。虽然Repository已经能在全部attempt中定位Delivery，Aggregate reducer与Replacement authority仍使用
`testAttempts[0]`。因此不能只给Delivery Service增加一个mode；必须把attempt合同、lineage、Aggregate非空有序数组、
latest-attempt消费者和聚焦测试一起迁移。

### 201.2 旧JS事实不是新TS标准

旧`wakeflow-delivery-orchestration.mjs`的后续attempt要求：

- 上一Delivery为accepted/ambiguous，且存在精确当前Result；
- ordinal连续，previousAttempt与previousResult闭合；
- `fresh-per-attempt`使用`mode:restart`，请求选择TestCard中一个`restartConditions`索引并写reason；
- `fresh-once`与`reuse-existing`都使用`mode:resume`；
- 新attempt和首份Delivery在同一个prepare事件中产生。

有效部分是“新attempt与传输替代分离”“绑定前一Result”“同一Card/TaskPackage”“有界ordinal”。问题在于
`resume/restart`同时承担logical rerun分类和环境setup分类；`restartConditions`又与Controller已经作出的
`request-another-attempt`判断重叠。旧状态文件、DispatchGroup和确定性ID仍不应复制。

TencentDB-Agent-Memory没有相邻的Test attempt领域模型。它可参考的只是较底层做法：公开结果把`retryable`分类与
服务端实际`attempts`次数分开，队列pause/start与业务重试分开，SQLite create race使用有界attempt并保留幂等唯一
约束。这支持Wakeflow继续区分“是否允许再试”“实际第几次执行”和“底层传输重发”，但不能提供TestCard语义。

### 201.3 官方资料校准

[Playwright retries](https://playwright.dev/docs/test-retries)为每次retry提供独立编号，失败后丢弃旧worker并启动新
worker；它把执行attempt、worker隔离和最终flaky分类分开。[Bazel `--flaky_test_attempts`](https://bazel.build/versions/9.1.0/reference/command-line-reference)
同样保存有界attempt语义，并把多次才通过标记为FLAKY。[GitHub Actions re-run](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs?tool=cli)
为同一run保留多次attempt，同时继续使用原始SHA/ref。

[Kubernetes Job failure policy](https://kubernetes.io/docs/tasks/job/pod-failure-policy/)把“该失败是否值得retry”的规则
与实际replacement Pod/失败计数分开，避免软件bug被无意义重试。[OpenTelemetry conventions](https://opentelemetry.io/docs/specs/semconv/how-to-write-conventions/)
也要求明确区分logical call和physical per-attempt操作。

这些来源共同支持：Wakeflow后续attempt应有新身份与连续ordinal，保留上一attempt/result/Controller Decision，
继续使用同一冻结TaskPackage/TestCard；环境是否重建应由setup policy独立派生，不应编码进含混的resume/restart
业务模式。

### 201.4 待用户选择的三种方案

| 方案 | Attempt语义 | TestCard变化 | 评价 |
| --- | --- | --- | --- |
| A（推荐） | `mode: initial | rerun`；later attempt绑定previous attempt/result和`request-another-attempt` Decision；environment directive独立按setup policy派生 | 删除冗余`restartConditions`；`setupPolicy + maxAttempts + Controller Decision`构成完整准入 | 最接近Playwright/GitHub/Bazel的attempt模型；没有自动retry，词义清楚，字段最少 |
| B | 与A相同，但把`restartConditions`改为`environmentRefreshConditions`；`fresh-per-attempt`的rerun必须选择一项并记录理由 | 保留一层人工环境重建白名单 | 控制更细，但raw text condition与Controller Decision可能重复；Card和attempt更复杂 |
| C | 复制旧`initial | resume | restart`与condition index | 基本保留旧字段 | 迁移最直接，但继续混淆logical rerun和环境setup，不建议 |

方案A的确定性setup矩阵：

| policy | initial | rerun |
| --- | --- | --- |
| `reuse-existing` | reuse confirmed | reuse confirmed |
| `fresh-once` | prepare fresh | reuse已确认的同一环境 |
| `fresh-per-attempt` | prepare fresh | prepare fresh |

三个方案都保持相同垂直切片：`test-another-attempt-planning`由Test Delivery Preparation消费，在一个
`testing.test-delivery-prepared`事件中追加新attempt与首份Delivery authorization；不创建新TaskPackage/TestCard，
不自动发送，不操作环境，不生成setup receipt。

当前推荐方案A，等待用户确认后再修改Schema和代码。

### 201.5 用户确认A后的合同收敛

用户确认采用方案A。新TS没有保留兼容字段或旧mode：

- TestCard authored content、持久Schema、codec/digest basis和TestDispatchPacket execution contract删除
  `restartConditions`；带该字段的输入按strict extra field拒绝；
- `TestExecutionAttempt.mode`严格为`initial | rerun`，ordinal范围1–10；
- initial固定ordinal 1且没有rerun source；rerun固定ordinal 2–10并必须保存：
  `previousAttemptId`、previous Result ID/digest、Controller Review Decision ID/digest；
- Rerun ID不得复用上一attempt ID；lineage ordinal连续、Card/Target一致，previous attempt必须是数组中的直接前驱；
- attempt创建函数只接收已经验证的Result/Decision tuple，不依赖Result/Review模块，避免Testing合同形成运行时循环。

环境setup继续是指令而非回执，按mode与TestCard policy唯一派生：

```text
reuse-existing:    initial reuse / rerun reuse
fresh-once:        initial fresh / rerun reuse
fresh-per-attempt: initial fresh / rerun fresh
```

因此“是否允许再执行”只由Controller `request-another-attempt`与`maxAttempts`决定；“本attempt执行前如何处理环境”
只由setup policy决定。

### 201.6 Aggregate与Event lineage

Aggregate的`testAttempts`从exact-one改为1–10有界非空lineage。Parser现在同时验证：

- attempt ID与全部Target Delivery ID全lineage唯一；
- ordinal从1连续递增，initial只在首位，rerun必须精确引用直接前驱；
- 每个attempt内部Delivery authorization ordinal连续且preparedAt递增；
- later attempt首份授权时间晚于上一attempt尾授权；
- previous Result与Review Decision身份不能被多个later attempt重复消费；
- currentDelivery只能选择最新attempt的最新authorization。

`testing.test-delivery-prepared`继续作为唯一提交事件：initial从planned创建首个attempt；rerun只从
`test-another-attempt-requested`追加新attempt；rejected-before-effect replacement只更新latest attempt并保留全部
历史。Rerun reducer同时复验当前Result/Decision summary、Decision类型、精确digest和`preparedAt > decidedAt`。

没有新增中间`attempt-planned`状态或空Event；attempt不会在没有首份可执行Delivery authorization时单独存在。

### 201.7 Delivery Preparation consumer

Test Delivery Preparation新增strict `mode:rerun` request，携带与Attempt相同的`rerunSource`。Authority在分配UUID前：

- 从一次完整Event Stream audit重建Review Snapshot与`test-another-attempt-planning` route；
- 闭合当前Aggregate、TaskPackage、TestCard、上一Test Result、Controller Test Decision与latest attempt；
- 要求Decision为`request-another-attempt`，Result/Decision的attempt、Card、packet tuple完全一致；
- 再验TestCard attempt容量、Config/Demand authority、当前Binding、产品窗口与Test窗口均无WorkClaim。

Preview分配新TestAttempt/TargetDelivery/Event/Commit身份并创建rerun Intent；Apply在当前authority下重建完全相同
Intent，随后通过原`testing.test-delivery-prepared`Event提交。精确Apply retry仍从Event恢复TaskPackage/TestCard并按
原Commit幂等返回。

错误词汇同步拆分为：

- `attempt-capacity`：TestCard logical attempt耗尽；
- `delivery-authorization-capacity`：同一attempt的rejected-before-effect替代授权耗尽；
- `commit-capacity`：Event Commit字节容量。

三者不再复用含混的`capacity`。

### 201.8 真实第二attempt验证

新增一条真实纵切，不只验证类型或route：

```text
first Test Result
→ Controller request-another-attempt Decision
→ test-another-attempt-planning
→ forged Decision digest在UUID前零写拒绝
→ rerun preview/apply
→ Aggregate attempts [initial, rerun]
→ second TestDispatchPacket（无restartConditions）
→ second Claim + Host Effect Observation
→ second TargetResult import + Claim release
→ Review Snapshot选择second Result
→ exact preparation Apply retry idempotent
```

轻量合同测试另外证明`fresh-once`的rerun复用环境、`fresh-per-attempt`的rerun准备新环境，并拒绝旧
`resume/restart`mode。相邻TestCard、packet、initial Delivery、Event upcaster和Test Review容量路径保持通过。

```text
Focused R-2B-10 regression:
  19 pass / 0 fail / 0 skip
TypeScript: pass
Architecture: pass / parser=swc / 593 modules / 4241 dependencies / 0 violations
Schema: pass / 66 schemas / 200 external refs
Schema digest: sha256:d2d30a19175317c1e9a5fd002f3412f9e8cf6265548f61250d3555d3f100bb92
git diff --check: pass
```

本单元没有创建新TaskPackage/TestCard、自动发送、环境setup receipt、flaky最终分类、Test blocked resume、产品缺陷
remediation、real-environment Completion、public MCP/CLI或Pod Test rerun。当前旧JS/core技能与Schema仍作为发布版
历史输入保留，未在新TS文件审阅中同步或修改。

## 202. R-2B-11（real-environment Completion与TestCard关闭预审）

### 202.1 当前Completion的早期假设

当前`DemandCompletion`骨干只允许`DemandAuthority.testingDecision.mode === controller-only`：

- Post-acceptance route在controller-only时返回`completion-preflight`；
- real-environment Test accepted仍停在`test-accepted`；
- Completion Plan明确拒绝任何非controller-only Authority；
- Aggregate completed Schema要求所有Target phase都为产品`accepted`并禁止`testCard`；
- Completion authority只检查accepted产品窗口的WorkClaim，不检查Test窗口。

因此不能只把route状态改名；否则Service会在Plan、Aggregate或Claim gate中继续失败，形成虚假consumer。

另外，`not-applicable`只允许research Demand，而当前Completion仍要求至少一个Target，所以zero-artifact research
Completion也是独立能力缺口。本单元不把它混入real-environment成功路径。

### 202.2 旧JS的有效关闭语义

旧JS在Controller接受Test Result时同时把：

```text
Test target lifecycleStatus → accepted
Test TaskPackage lifecycleStatus → closed
TestCard lifecycleStatus → closed
```

随后`demand.completed`只验证所有Target accepted/superseded、TaskPackage/TestCard closed/superseded，并保持三组状态
完全不变。有效原则是“Test接受先于Demand完成，Completion验证而不删除历史”。旧JS需要Card lifecycle字段，是因为
Card另有一份可变artifact-state summary；新TS TestCard本身是不可变Event载荷，Aggregate只保存当前摘要，不应照搬
第二套Card状态机。

TencentDB-Agent-Memory没有TestCard或Demand Completion的相邻领域模型，不能提供这一选择。其status/audit实践只能
支持“终态事实与历史记录分离”，不能决定Wakeflow的Test关闭语义。

### 202.3 官方资料校准

[Microsoft Event Sourcing pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)明确把append-only
Event Stream作为system of record；Snapshot/materialized view只是可重建的当前投影，不替代历史。Completion应新增
业务意图Event并更新投影，而不是删除既有Test事件或伪造从未存在的历史。

[Microsoft CQRS guidance](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs)同样强调读模型可以按查询需要
重建，但Event保留全部历史与意图。[Azure Test Plans](https://learn.microsoft.com/en-us/azure/devops/test/overview?source=recommendations&view=azure-devops)
在Test run完成后仍保留run summary、单项Result和附件，并用独立retention policy管理，不把“完成”解释为立即删除执行
事实。

对Wakeflow最合适的映射是：TestCard仍是不可变合同，`test-accepted`已经表达该Card对应Test target关闭；Demand
`completed`只是更高层终态，不需要再制造Card closed mutation。

### 202.4 三种互斥方案

| 方案 | Aggregate completed投影 | Event/Route | 评价 |
| --- | --- | --- | --- |
| A（推荐） | 保留implementation `accepted`、Test `test-accepted`、TestCard摘要和完整attempt lineage | `test-accepted` route升级为带精确Test closure的`completion-preflight`；一个`lifecycle.demand-completed`Event只改变Demand lifecycle | 与Event Sourcing和旧JS“先关闭、后验证、不删除”一致；无冗余状态机，Repository/Review历史继续可读 |
| B | 先新增`test-closed`phase和可变Card closed summary，再允许Completion | 新增`testing.test-card-closed`Event，随后Completion | 显式但重复`ControllerTestReviewDecision(accept)`事实；多一个Event/状态机/失败恢复边界，不建议 |
| C | Completion时从Aggregate删除Test target、TestCard与attempt摘要 | 一个Completion Event同时折叠投影 | Snapshot更小，但破坏稳定Target当前投影、Repository闭合和终态审计；Event虽仍在，常用读模型失去关键事实，不建议 |

### 202.5 方案A的拟定边界

若用户确认A，将实施：

1. `completion-preflight`携带判别式testing closure：
   - controller-only：无Test tuple；
   - real-environment：TestCard、Test target/TaskPackage、final attempt、TargetResult和Controller Decision精确tuple。
2. Completion authority接受controller-only或real-environment；后者要求Test target处于`test-accepted`、Decision为
   `accept`，并检查产品窗口和Test窗口均无WorkClaim。
3. Completion Plan允许两种testing mode，并要求Route closure与冻结Demand Authority一致。
4. Aggregate completed准入改为：implementation只可`accepted`，存在TestCard时唯一Test target只可
   `test-accepted`；Completion不删除或改写Target/TestCard/attempt。
5. Completion Event仍只绑定route/review/state/TODO digest，不复制整份Result或Card；精确closure已经包含在可重建
   route及其digest中，Event Stream保留完整来源。
6. 真实测试覆盖real-environment Test accept → Completion preview/apply →终态保留Test lineage →精确幂等retry。

当前推荐方案A，等待用户确认后再修改Completion Schema和代码。

### 202.6 用户确认A后的Route与Completion合同

用户确认采用方案A。Post-acceptance route的`completion-preflight`现携带判别式testing closure：

```text
controller-only
  → { mode: controller-only }

real-environment
  → { mode: real-environment, testReview: exact Test closure }
```

real-environment closure保存Test target/TaskPackage、TestCard、final attempt、TargetResult、Controller Decision与
Test window精确tuple。只有`test-accepted + decision:accept`能进入该route；another-attempt、product-defect和blocked
继续保留各自显式route。

`DemandCompletion`新增最小`testingMode: controller-only | real-environment`。完整Test closure不复制进Completion
Event；`postAcceptanceRouteDigest + reviewSnapshotDigest + observedState`继续绑定可重建投影，Event Stream保存完整Card、
attempt、Result与Decision来源。

### 202.7 Authority、Plan与Event Sourcing准入

Completion authority现在：

- 要求route testing closure mode与冻结Demand Authority testingDecision完全一致；
- controller-only检查全部accepted产品窗口无WorkClaim；
- real-environment额外检查closure中的Test窗口无WorkClaim；
- Route source只向Lifecycle投影`testingMode`，不把Review完整closure跨层传递。

Completion Plan与Demand Event Sourcing command parser同时允许controller-only/real-environment，但都要求
`completion.testingMode === authority.testingDecision.mode`并复验authority digest。不是把旧硬编码改成宽泛枚举；
`not-applicable`仍不能借此进入非research成功路径。

实现过程中架构门发现`DemandCompletion`直接引用Review route类型形成Lifecycle→Review→Demand→Lifecycle循环。最终没有
新增万能共享文件：Lifecycle本地拥有两值`DemandCompletionTestingMode`，Route完整closure继续由Review拥有，Authority
只投影mode。依赖循环由边界收窄消除。

### 202.8 completed Aggregate保留Test lineage

Aggregate completed Schema与reducer现在要求：

- 所有implementation target保持`accepted`；
- controller-only不能出现Test target或TestCard；
- real-environment必须有唯一Test target且保持`test-accepted`，TestCard摘要存在；
- Completion只把Demand lifecycle从active改为completed，不修改`targetTasks`、`testCard`、attempt、Delivery、Result或
  Review summary。

因此TestCard“关闭”由`test-accepted`与Demand terminal lifecycle共同表达，不新增`test-closed`phase、Card lifecycle
字段或第二个Event。Repository、Review Snapshot和后续BusinessArchive仍能从终态直接读取Test current summary，并从
Event Stream恢复完整历史。

### 202.9 真实Completion验证

新增real-environment真实纵切：

```text
Test Result reported
→ Controller Test Review accept
→ real-environment completion-preflight
→ DemandCompletion preview/apply
→ lifecycle.demand-completed
→ completed Aggregate保留TestCard与完整attempt lineage
→ Config变化后的exact Apply retry idempotent
```

测试同时保留：尚未创建/执行Test的real-environment route不能完成；残留WorkClaim与缺失claimed TODO仍失败关闭；
controller-only原路径、并发Completion、Event upcaster与Schema wire保持通过。

```text
Focused R-2B-11 regression:
  17 pass / 0 fail / 0 skip
TypeScript: pass
Architecture: pass / parser=swc / 593 modules / 4244 dependencies / 0 violations
Schema: pass / 66 schemas / 200 external refs
Schema digest: sha256:68c5ce0aec3eed8638134fae8fc6d7fcc5abe4bee50747853579e980726ced9c
git diff --check: pass
```

本单元没有实现zero-artifact research Completion、Test blocked resume、产品缺陷remediation、环境setup receipt、TODO
归档、BusinessArchive、宿主窗口关闭、public MCP/CLI或Pod close。Completion成功也不声称这些后续效果已经发生。

## 203. R-2B-12（Test Review blocked恢复预审）

### 203.1 当前合同已经是通用Resume

`ControllerTargetReviewResume`没有implementation assessment、repository或rework字段。它只绑定：

- Program/Demand/Target/Controller Window；
- blocked Decision ID/digest；
- 同一TargetResult ID/digest；
- blocked Snapshot/state digest与stream revision；
- resolution summary、resumedAt和self digest。

`review.target-result-resumed.v1`Event、Commit ID、Review history entry和Service request也没有workType分支。真正的早期
限制只有三处：

1. Resume Service只接受`phase === review-blocked`；
2. Aggregate reducer只转换`review-blocked → result-reported`；
3. Repository审计强制被引用Decision必须是Implementation Decision。

因此Test blocked恢复不需要新基础合同；应修正这些消费者，使同一Resume语义真正覆盖两种Decision。

### 203.2 恢复与rerun是不同动作

```text
review blocked
  → 外部/人类事实已具备重新审查条件
  → Resume同一TargetResult review generation
  → Controller重新读取Snapshot并独立检查
  → 新Decision

request another attempt
  → Controller已完成当前Result判断但证据仍不足
  → 新logical TestAttempt + 新Delivery + 新Result
```

Resume不能消耗`maxAttempts`、创建Delivery或改变TestCard。它只删除Aggregate current Decision summary，使phase回到
`test-result-reported`；旧blocked Decision和Resume仍按stream revision留在`priorReviewHistory`，新Snapshot/unit digest
随历史改变。

### 203.3 旧JS与官方实践

旧JS把blocked Test/implementation task都压成`needs-rework`并阻塞Demand，没有对应unblock/resume-review路径；这会让
纯外部阻断被迫制造假返工，属于旧系统缺口，不应继承。

[Microsoft Durable Task external events](https://learn.microsoft.com/en-us/azure/durable-task/common/durable-task-external-events?tabs=python)
把人类输入和外部触发建模为等待中的同一orchestration接收唯一外部事件，并建议用唯一ID处理at-least-once重复。
[Durable Task human interaction](https://learn.microsoft.com/en-us/azure/durable-task/common/durable-task-human-interaction?source=recommendations)
明确是workflow暂停等待输入后继续，而不是启动一份新的业务执行。[AWS Step Functions callback](https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html)
同样以Task Token绑定等待中的精确Task，callback后继续该execution。

这些来源支持复用现有Resume Event：精确blocked Decision相当于等待token，Resume ID提供去重身份，恢复同一Result审查；
Test attempt retry仍是另一条显式路径。

TencentDB-Agent-Memory没有Controller Review blocked或Test attempt领域模型，不能提供相邻实现；它的queue
pause/start也只说明暂停恢复与任务重试应分离。

### 203.4 三种互斥方案

| 方案 | 合同/Event | 恢复结果 | 评价 |
| --- | --- | --- | --- |
| A（推荐） | 泛化现有`ControllerTargetReviewResume`、`review.target-result-resumed`和同一Service | Implementation回`result-reported`；Test回`test-result-reported`；不创建attempt | 语义完全相同、无重复Schema/Event/Service；Review history天然支持两类Decision |
| B | 新建`ControllerTestReviewResume`与Test专用Event/Service | 同样回`test-result-reported` | 字段和幂等逻辑重复，Event family分裂但没有不同业务含义，不建议 |
| C | 把Test blocked resolution直接解释为`request-another-attempt` | 创建新attempt | 消耗容量、跳过同一Result重新判断，并把外部阻断伪装成测试执行不足，错误 |

### 203.5 方案A拟定边界

若用户确认A，将实施：

1. Resume Service同时接受`review-blocked | test-review-blocked`，并要求Decision kind与TaskPackage workType一致。
2. Aggregate按target workType恢复到`result-reported | test-result-reported`，逐字段保留Delivery、Host Effect、Result、
   TestCard和attempt lineage，仅移除current reviewDecision summary。
3. Repository审计允许Implementation/Test blocked Decision，但强制Decision kind与Target workType一致；一个blocked
   Decision仍只能有一个Resume。
4. 同一Resume Service保持exact request幂等；恢复后Implementation/Test Decision Service分别消费新Snapshot。
5. 真实测试覆盖Test blocked → Resume →同一Result重新reported →prior history顺序→Test accept，并证明attempt数量不变。

当前推荐方案A，等待用户确认后再修改Schema和代码。

### 203.6 用户确认A后的通用Resume转换

用户确认采用方案A。现有`ControllerTargetReviewResume`Schema、codec、Event、Commit和Service public shape均保持不变；
没有新增Test专用kind、Event family或兼容分支。

Aggregate Resume reducer现在接受：

```text
Implementation review-blocked → result-reported
Test test-review-blocked       → test-result-reported
```

两条转换共享同一不变量：Demand active、exact blocked state digest/revision、Decision必须为blocked、Decision/Result
ID与digest必须匹配current summary。转换只移除current `reviewDecision`；TaskPackage、Delivery、Host Effect、Result、
TestCard与attempt lineage逐字段保留。

### 203.7 Repository与Service来源闭合

Repository审计不再强制Resume引用Implementation Decision，而是要求：

```text
ControllerImplementationReviewDecision ↔ implementation Target
ControllerTestReviewDecision           ↔ Test Target
```

两类Decision都必须是blocked、早于Resume、Result tuple一致；同一blocked Decision仍只能有一个Resume。

`ControllerTargetReviewResumeService`同时接受`review-blocked | test-review-blocked`。它从Review Snapshot验证phase、
TaskPackage/TargetResult workType和Decision kind三者一致，然后继续使用原Controller authority、Config current check、
Commit容量、并发恢复与exact idempotency逻辑。Service不读取或改变TestCard.maxAttempts。

### 203.8 真实Test恢复验证

新增真实纵切：

```text
Test Result reported
→ Controller Test Decision blocked
→ test-review-blocked
→ ControllerTargetReviewResume
→ test-result-reported（同一Result、同一attempt）
→ priorReviewHistory = [decision, resume]
→ 新Snapshot/unit digest
→ Controller Test Decision accept
→ test-accepted
```

测试直接比较Resume前后`testAttempts`深度相等，证明没有消耗容量、创建Delivery或隐式rerun；最终accept仍保留原lineage。
原Implementation blocked→Resume→accept、Resume deterministic document/Event identity、Event replay和Test Decision
attempt-capacity路径均保持通过。

```text
Focused R-2B-12 regression:
  11 pass / 0 fail / 0 skip
TypeScript: pass
Architecture: pass / parser=swc / 593 modules / 4249 dependencies / 0 violations
Schema: pass / 66 schemas / 200 external refs
Schema digest: sha256:68c5ce0aec3eed8638134fae8fc6d7fcc5abe4bee50747853579e980726ced9c
git diff --check: pass
```

Resume的`resolutionSummary`仍是Controller陈述，不自动证明外部事实真实解决；下一代Decision必须通过新的独立检查
承担判断。当前仍未实现产品缺陷remediation、zero-artifact research Completion、环境setup receipt、public MCP/CLI
或Pod-specific blocked resolution。

## 204. R-2B-13（Test产品缺陷修复闭环预审）

### 204.1 产品缺陷不是另一Test attempt

当前`request-another-attempt`只适合实现基线没有变化、但环境、执行或Evidence仍不足的情形。
`escalate-product-defect`已经声明Controller从充分Evidence观察到产品缺陷；此时继续复用原TestCard并消耗下一attempt，
仍然只会验证TestCard冻结的旧Implementation Result/Decision基线，不能证明修复后的代码。

[GitHub Actions rerun](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs)
明确复用原事件的同一`GITHUB_SHA`与`GITHUB_REF`，反向证明代码变化后应形成新的workflow run，而不是原run的
rerun。[Kubernetes Pod failure policy](https://kubernetes.io/docs/tasks/job/pod-failure-policy/)也把不可重试的软件缺陷
与可重试运行失败分开，允许立即`FailJob`避免无意义重启。
[Azure Test Plans](https://learn.microsoft.com/en-us/azure/devops/test/run-manual-tests?view=azure-devops)则保留每次
Test Result、把失败Evidence关联到Bug，并允许修复后重新执行测试；可复用的是测试意图，不是旧Result或旧产品基线。

Event Sourcing下也不能删除旧accept或缺陷Event。
[Microsoft Event Sourcing pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)
要求历史Event保持不可变，通过新的补偿Event推进当前状态。因此正确闭环应保留旧Test缺陷事实，再显式授权产品修复和
新一代验证。

### 204.2 当前TS模型不能靠放宽一个phase闭合

现有事实之间存在四个硬边界：

1. `ControllerTestReviewDecision`只绑定Test Result/Card/attempt/packet和独立检查，没有指出一个多repository Demand中
   哪些Implementation Target需要修复。
2. TestCard的`implementationBaselines`冻结每个产品Target的TaskPackage、Result和accept Decision精确tuple；产品产生
   新Result后旧Card必然过期。
3. Aggregate当前强制“最多一个TestCard、最多一个Test Target”，且TestCard存在期间所有Implementation Target必须保持
   `accepted`；它无法表达“旧缺陷Test历史仍保留、产品正在返工、随后创建新TestCard”。
4. 现有Target Delivery `rework`来源只接受Implementation `rework` Decision；Test Delivery `replacement`只处理同一次
   attempt的宿主副作用被拒绝，不是产品修复或TestCard替换。

因此不能把`test-product-defect-escalated`直接接到已有rework Service，也不能伪造一份第二次Implementation Review
Decision来覆盖已经发生的accept。

### 204.3 旧JS与Tencent参考边界

旧JS把Implementation与Test都压进`accept | rework | redesign | blocked`，Test的通用`rework`继续使用同一TestCard；
`superseded`主要服务TaskPackage/Target replacement和归档生命周期。它没有一条把Test产品缺陷定位到产品Target、修复后
重建Implementation baseline、再生成新TestCard的完整路径。这正是新版TS需要修正的旧闭环缺口，不是迁移模板。

TencentDB-Agent-Memory没有Controller Test Review、产品缺陷修复或TestCard代际模型；其queue/trace/status实现不能为
这条业务闭环提供相邻抽象。可继续学习其模块边界、命名和注释，但不能从中推导Wakeflow状态机。

### 204.4 三种互斥闭环方案

| 方案 | 产品修复身份 | 修复后的验证 | 评价 |
| --- | --- | --- | --- |
| A（推荐） | 同一Demand、同一Implementation Target与TaskPackage进入新的产品返工执行；原accept Event保留 | 旧Test代际保留为缺陷历史，创建新TestCard、新Test Target与新attempt | 对原包范围内缺陷语义准确，复用已有rework骨干，新增模型最少 |
| B | 为缺陷创建新的Implementation Target/TaskPackage continuation或replacement lineage | 同样创建新TestCard/Test Target | 每次修复都是独立工作包，追踪更显式；但必须先引入repository lineage head、package replacement和completion规则，当前没有第二个真实消费者，设计面显著扩大 |
| C | 当前Demand保持阻塞或取消，创建关联的新Bug Demand | 新Demand完成修复与测试 | 隔离最强，但把原Requirement的成功闭环拆散，TODO、completion和Evidence需要跨Demand聚合 |

“继续使用原TestCard创建另一attempt”不是可选方案：它只验证旧Implementation baseline，会产生错误的通过证明。

### 204.5 方案A的建议骨干

方案A不把过去的accept改写成未发生，而是追加一份精确修复授权：

```text
Test Decision: escalate-product-defect
  → ControllerProductDefectRemediationAuthorization
      （精确Test Decision/Result/Card/attempt + 受影响Implementation Target + failed check映射）
  → review.product-defect-remediation-authorized.v1
  → 旧Test Target保留test-product-defect历史；当前TestCard槽位释放
  → 受影响Implementation Target进入product-defect-rework-requested
  → 新Delivery/Claim/Result/Implementation Review
  → 全部受影响产品Target重新accepted
  → 新TestCard（新baseline，显式链接旧Card与remediation authorization）
  → 新Test Target/attempt/Delivery/Result/Test Review
```

建议同步把Aggregate顶层`testCard`语义化为`currentTestCard`：`targetTasks`可保留多个已经终结的Test代际，但任一时刻
最多只有一个当前TestCard及其活动Test Target。这样旧缺陷Result仍是有效历史Evidence，而不会被误认成当前验证合同。

该授权只允许修复仍位于原TaskPackage边界和Authority内的缺陷；如果Controller判断需要改变需求、跨出包边界或选择新的
Authority，应转入独立redesign/new-Demand设计，而不是扩大rework权限。Delivery rework来源应形成显式判别联合：
`implementation-review-rework | test-product-defect-remediation`，不能伪造Implementation Decision。

本方案不新增通用Workflow engine、可变TestCase registry、全局generation counter或后台runner。Event Stream保存完整历史，
Aggregate只保存当前路由所需摘要；新TestCard可以复用经Controller再次确认的测试意图文本，但必须获得新身份和新实现基线。

### 204.6 当前核实结论

推荐方案A。它同时满足Event Sourcing不可变历史、同基线rerun与新基线retest分离、同一Demand闭环，以及当前“避免
过度设计、由真实consumer补基础能力”的约束。方案B只有在用户希望“任何产品缺陷修复都必须成为新的独立TaskPackage”
时才值得先建设完整任务lineage。

本预审只读取新版TS、旧JS、review ledger、Tencent项目和官方资料；没有修改运行时代码或测试，没有运行测试、提交、
发布或刷新安装cache。等待用户在A/B/C之间确认后，再按1–2个紧密文件的节奏先审查Aggregate/Test代际合同。

### 204.7 用户确认A后的当前Test代际合同

用户确认方案A。首个实现单元没有提前创建产品修复Authorization或Delivery分支，而是先关闭后续所有消费者共同依赖的
Aggregate不变量。

Aggregate顶层`testCard`已语义化为`currentTestCard`：它只指向当前可规划或执行的Test合同；每个Test Target继续在自身
摘要中保存精确Card tuple。当前TS尚未发布，因此Schema v1、生成类型和所有真实消费者直接同步修改，没有保留旧字段、
双读parser或兼容别名。

新的状态矩阵为：

| 当前Card | Test Target集合 | 允许的产品状态 | 含义 |
| --- | --- | --- | --- |
| absent | empty | 正常Tasking阶段 | 尚未进入真实环境Test |
| present，无匹配Target | 历史Target只能是`test-product-defect` | 全部Implementation accepted | 新Card已创建，等待Test Task planning |
| present，有一个精确匹配Target | 其他历史Target只能是`test-product-defect` | 全部Implementation accepted | 当前Test代际正在执行或已审查 |
| absent | 一个或多个`test-product-defect`历史Target | 可进入显式产品返工状态 | 缺陷Card已退出当前槽位，旧Evidence仍保留 |

每个Test Target现在还独立验证Card的`targetTaskId/testWindowId`与自身完全一致，并且同一Aggregate内TestCard ID不可复用。
没有当前Card时，`planned`、`test-another-attempt-requested`、`test-review-blocked`或`test-accepted`都不能伪装成历史代际。

普通Implementation Task Planning在任何Test历史已经存在后继续拒绝新TaskPackage，避免产品缺陷阶段借“当前Card absent”
扩张仓库或需求范围。方案A的产品修复必须由下一单元的精确remediation Authorization转换已有Implementation Target。

### 204.8 Event Repository、route与completion闭合

`DemandEventSourcingRepository`现在对每一个Test Target复验其TestCard创建Event早于TaskPackage规划Event，并要求所有
TestCard Event至少由`currentTestCard`或一个保留的Test Target引用。`findTestCardCreatedEvent`不再错误地只允许读取当前
Card；历史缺陷Card仍可按不可变身份恢复完整合同，供后续修复Authorization和审计使用。

Post-acceptance route按`currentTestCard`精确选择当前Test Target，不再把排序最前的历史缺陷Target误认为当前执行。
当产品修复期间存在未accepted Implementation Target时仍返回`targets-not-accepted`；产品重新accepted且当前Card absent后，
才重新进入`real-environment-test-planning`。

Completion的real-environment闭合允许：一个与`currentTestCard`精确匹配的`test-accepted`当前Target，加零个或多个
`test-product-defect`历史Target。它仍拒绝只有缺陷历史而没有新accepted测试的Demand。controller-only继续要求零Card、
零Test Target。

### 204.9 小型真实验证与当前边界

新增一条真实小型路径：

```text
Test Result recorded
→ Controller Test Decision: escalate-product-defect
→ Aggregate test-product-defect
→ 释放currentTestCard后的历史状态严格回读
→ 新currentTestCard与新planned Test Target可并存
```

同一测试同时证明非缺陷Test phase不能成为历史、普通Task Planning不能新增产品任务。扩展聚焦回归覆盖Aggregate、Repository、
Snapshot、State Version、Upcaster、TestCard/Task/Delivery、Controller Test Review、post-acceptance route和Completion；没有运行
旧JS或仓库全量测试。

```text
Focused R-2B-13 Aggregate/Test generation regression:
  32 pass / 0 fail / 0 skip
TypeScript: pass
Architecture: pass / parser=swc / 593 modules / 4250 dependencies / 0 violations
Schema: pass / 66 schemas / 200 external refs
Schema digest: sha256:cc44a2400a9f0d7d5ec272379d247dd81637a258931a7763744478e3a306ae23
git diff --check: pass
```

本单元仍没有允许产品返工：Event Stream中尚无`ControllerProductDefectRemediationAuthorization`或对应Event，任何现有Service
都不能清除`currentTestCard`或重新打开accepted Implementation Target。下一审阅单元应先设计这份Controller专属、精确绑定
Test Decision/Result/Card/attempt与受影响Implementation baseline的Authorization合同，再接入Event Sourcing；不能先放宽
现有Implementation rework入口。

### 204.10 产品缺陷修复Authorization不是可变工单

用户确认方案A后继续审阅Controller Resume、Implementation rework context、Event command/commit和官方实践。
[Microsoft Event Sourcing](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)要求Event记录业务意图，
而不是只记录“phase发生变化”的字段差异；Aggregate是接收Command、执行不变量并产生Event的一致性边界。
[Kurrent/EventStoreDB](https://docs.kurrent.io/clients/tcp/dotnet/21.2/appending)则以Event ID加expected version提供幂等append。
[AWS Step Functions redrive](https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html)保留成功历史，并明确只有
同一workflow definition才适合redrive；definition变化应创建新execution。

因此采用独立不可变`ControllerProductDefectRemediationAuthorization`，随后把它嵌入一个Domain Event；不创建单独物理
Authorization文件、registry或第二状态权威。Authorization固定`boundary: existing-task-packages-only`：原TaskPackage范围内
缺陷可恢复同一Target执行，需求/Authority/包边界变化仍必须走redesign或新Demand。

Authorization绑定：

- 精确post-acceptance route、Review Snapshot、Aggregate state digest与stream revision；
- Test Target、Card、attempt、packet、Result和`escalate-product-defect` Decision tuple；
- 从Test Decision确定性投影的全部failed checks；
- 一个或多个按Target ID排序的Implementation baseline，每个包含原package/result/accept Decision；
- 每个Target映射的failed check ID和不跨包的`correctionObjective`；
- Controller rationale、typed remediation ID、授权时间和self-excluding digest。

所有failed check必须至少映射到一个产品Target，映射不能引用passed/inconclusive或未知检查；Target、TaskPackage、repository、
Result和accept Decision身份均不可重复。Decision、route、映射和文本在读取UUID/时钟前准入。新持久身份kind为
`product-defect-remediation`，Authorization UUID后续确定性派生Event/Commit ID。

### 204.11 Event、Aggregate与Repository完整闭合

新增`review.product-defect-remediation-authorized.v1`。Command为
`review.authorize-product-defect-remediation`，当前Event codec、version registry、upcaster入口、stored envelope、Commit和
generic command handler全部接入；Event data只持有一份完整Authorization。

Aggregate没有伪装普通Implementation `rework` Decision，而是新增明确phase：

```text
accepted Implementation Target
  + Test product-defect Decision
  + Controller remediation Authorization
  → product-defect-rework-requested
```

目标继续保留原accept Decision/Result/Delivery摘要，并额外保存最小remediation摘要；`currentTestCard`由同一Event释放，旧Test
Target保持`test-product-defect`。这样过去的accept仍是历史事实，而当前状态明确表示产品因后续真实环境Evidence重新开放。

Reducer逐项复验当前Card、Test attempt/packet/Result/Decision、source state digest和每个产品baseline。Repository完整审计还
复验：Decision Event正好位于source revision、Authorization Event是下一revision、source state digest来自前一Stored Event、
TestCard确实冻结所有受影响baseline、failed-check投影与完整Test Decision一致，以及当前Aggregate remediation摘要可回指
唯一Authorization Event。

Result Review Snapshot把新phase作为仍携带原Result/Decision的review-decided产品Target；post-acceptance route把它列为
`targets-not-accepted` blocker，不能提前创建新TestCard或完成Demand。

### 204.12 Controller Service与真实纵切

新增严格Service Input与`ControllerProductDefectRemediationService`。调用方只能提交：

- Demand、Test Target与产品缺陷Decision身份；
- 当前post-acceptance route digest；
- 受影响产品Target ID、failed check映射、correction objective；
- authorization rationale。

baseline、TaskPackage/Result/Decision digest、TestCard、stream revision、Controller Window和Event/Commit身份全部由Service从
同一次Authority context、当前route与完整Event history派生。Service执行Config current fence、Commit容量预检、expected
revision append、同请求幂等恢复和并发winner恢复；相同Test Decision的不同映射或rationale按冲突拒绝。

真实小型路径现在为：

```text
Test Result
→ Controller Test Decision: escalate-product-defect
→ test-product-defect-escalated route
→ ControllerProductDefectRemediationService
→ immutable Authorization
→ review.product-defect-remediation-authorized.v1
→ currentTestCard absent
→ old Test Target remains test-product-defect
→ selected product Target product-defect-rework-requested
→ route targets-not-accepted
→ exact retry idempotent; conflicting retry rejected
```

聚焦测试还发现旧durable-ID测试把已经投入真实使用的`target-result/test-attempt/test-card`误列为retired kind；已删除这三个
过时断言，没有修改运行时词汇迁就错误测试。

```text
Focused R-2B-13 Authorization/Event/Service regression:
  36 pass / 0 fail / 0 skip
TypeScript: pass
Architecture: pass / parser=swc / 599 modules / 4297 dependencies / 0 violations
Schema: pass / 68 schemas / 203 external refs
Schema digest: sha256:0a1b3bd841eda5f79e5112d487ad1ff40c72d0b91b8011b98fb121190ccdfd29
git diff --check: pass
```

当前仍未创建产品修复Delivery。现有`TargetDeliveryIntent.rework`只接受Implementation Review Decision来源；下一单元必须
选择清晰的Intent来源模型并建设`product-defect-rework-requested → delivery-prepared`，不能丢失Authorization身份或把Test
Decision伪装成Implementation Decision。

## 205. R-2B-14（产品缺陷修复Delivery Intent预审）

### 205.1 当前Intent与Event版本事实

`TargetDeliveryIntent`当前Schema v1用可选`rework`表达Implementation Review返工；字段absent表示initial。Intent digest是
整个self-excluding对象的Canonical JSON摘要。持久Event已经存在两版：

- `delivery.target-delivery-prepared.v1`只允许没有`rework`的initial Intent；
- v2允许initial或现有Implementation `rework`；
- v1→v2 upcaster为identity，因为旧Intent字节也是当前内存形状。

因此把现有`rework`直接重命名成通用判别联合，或给所有旧Intent新增required purpose，会改变旧Intent digest，进而改变
Aggregate currentDelivery中的digest与Stored Event resulting-state digest。这不是一次普通字段重命名；若坚持该路线，必须同时
引入Intent v2、Event v3和state-model digest evolution。

[AWS Step Functions redrive](https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html)同样区分“保留同一定义的
redrive”和“定义变化后的新execution”。Wakeflow产品缺陷修复仍使用同一TaskPackage，因此可以是同Target的新执行；但它的
授权来源必须与普通Implementation Review rework明确分开。

### 205.2 三种互斥方案

| 方案 | 持久Intent | Event演进 | 评价 |
| --- | --- | --- | --- |
| A（推荐） | 保留现有可选`rework`，新增互斥可选`productDefectRemediation`；提供统一派生函数返回`initial | implementation-review-rework | product-defect-remediation` | 新增严格Event v3；v1继续禁止两类返工，v2明确禁止product字段，v2→v3 identity | 三类来源清晰，不改旧Intent/digest/state；新增最少且有真实consumer |
| B | 把Intent升级为required `executionBasis`判别联合并升为Schema v2 | Event v3加Intent与state-model digest upcaster | 持久形状最整齐，但为一个新增来源迁移所有历史Intent和状态digest，复杂度显著高于当前收益 |
| C | 继续复用现有`rework.decision`，把Test Decision或Authorization塞入旧字段 | 无新版本 | 丢失Authorization typed identity，现有历史恢复会把Test来源当Implementation Decision；语义错误 |

### 205.3 方案A拟定边界

`productDefectRemediation`只保存Target执行需要的有界投影：

- remediation Authorization ID/digest；
- source Test Review Decision ID/digest；
- 该产品Target先前accepted Result ID/digest；
- Authorization rationale、该Target correction objective和映射后的failed checks。

完整Authorization、Test Decision、Test Result与TestCard仍在Event Stream；Intent不复制整份记录。Schema强制`rework`与
`productDefectRemediation`互斥，派生`targetDeliveryPurpose(...)`成为消费者唯一分类入口。Preparation Authority只从完整
Event history重建对应来源；调用方不能自行拼接投影。

产品缺陷Delivery继续使用原TaskPackage、原repository/window、当前Binding与新TargetDelivery ID。Reducer只允许
`product-defect-rework-requested → delivery-prepared`，并要求Intent Authorization摘要与Aggregate remediation摘要精确一致。
新的Result与Controller Implementation Review随后按现有纵切运行；新accept后才重新进入TestCard planning。

当前推荐方案A，等待用户确认后再修改Intent Schema/codec、Event v3和Preparation纵切。本预审未修改本节所述Delivery代码，
没有把方案选择伪装成已经实现的能力。

### 205.4 用户确认A后的三类Intent来源

用户确认方案A。`TargetDeliveryIntent`保留现有Implementation `rework`，新增与其Schema互斥的
`productDefectRemediation`。所有消费者通过唯一`targetDeliveryPurpose(...)`分类：

```text
两个来源字段均absent       → initial
仅rework                   → implementation-review-rework
仅productDefectRemediation → product-defect-remediation
两个字段同时存在           → Schema/domain拒绝
```

产品缺陷投影只包含：Authorization ID/digest、Test Review Decision ID/digest、先前产品Result ID/digest、Controller
authorization rationale摘要、当前Target correction objective摘要和映射后的failed checks。完整Authorization、Test Decision、
Test Result与TestCard仍留在Demand Event Stream，不复制进Intent。

新增`target-delivery-product-defect-remediation-context.ts`，从完整Authorization和先前Implementation TargetResult验证
Program/Demand/Target/TaskPackage/repository/window/Result baseline及failed-check映射，再生成有界投影。prompt明确写为
“Product-defect remediation basis”，继续指向同一不可变TaskPackage，并展示Authorization、Test Decision、旧产品Result和
修复目标；它不把Test窗口变成产品修复者。

### 205.5 严格Event v3与Preparation来源恢复

`delivery.target-delivery-prepared`当前写入版本升为v3：

- v1同时禁止`rework`和`productDefectRemediation`；
- v2允许initial/Implementation rework，但显式禁止product字段；
- v3接受三类当前Intent；
- v1→v2和v2→v3均为identity upcast，因为新字段对旧Intent是absent，旧Intent digest与resulting-state digest不变；
- 将产品缺陷Intent伪装为v2会在payload codec处拒绝。

Preparation Authority现在形成三个判别来源：`initial | implementation-review-rework | product-defect-remediation`。产品缺陷
分支从完整Event history定位精确Authorization Event和先前产品Result，逐项复验Aggregate remediation摘要、Test Decision、
affected baseline、TaskPackage/Result digest和事件顺序，再创建Intent投影。Apply幂等恢复同样从Event history重建来源，不依赖
可删除投影或当前Aggregate仍停留在等待phase。

Command新增互斥`productDefectRemediationSource`，由完整Authorization与Result组成；Decider重新投影并与Intent Canonical JSON
比较。Reducer只允许：

```text
product-defect-rework-requested
  + exact productDefectRemediation Intent
  → delivery-prepared
```

转换时移除只属于等待phase的Aggregate remediation摘要；完整Authorization继续由Event Stream保存。普通initial与
Implementation rework路径不变。

### 205.6 完整产品修复与新Test代际真实验证

真实小型纵切已经从原Test缺陷运行到新Test Task planning：

```text
old Test Result
→ Test Decision: escalate-product-defect
→ remediation Authorization/Event
→ product-defect-rework-requested
→ product TargetDeliveryIntent / prepared Event v3
→ Claim / accepted Host Effect / new product TargetResult
→ Controller Implementation Review accept
→ real-environment-test-planning
→ new TestCard with new implementation Result/Decision baseline
→ test-task-planning
→ new planned Test Target
```

断言证明：

- 产品Delivery使用原TaskPackage、repository/window与新TargetDelivery ID；
- Intent携带精确Authorization和mapped failed check，旧Test窗口没有产品写权限；
- Preparation Apply与重试分别为committed/idempotent；
- 产品新Result重新经过Controller独立accept，未复用旧accept verdict；
- 新TestCard ID不同于旧Card，implementation baseline指向新产品Result；
- Aggregate同时保留旧`test-product-defect` Target和新`planned` Test Target；
- route依次经过`targets-not-accepted → real-environment-test-planning → test-task-planning → test-delivery-planning`。

测试维护同步删除了已经被真实纵切替代的手工“伪造reaccepted状态/新Card摘要”段，避免同一不变量维护两套fixture。

```text
Focused R-2B-14 adjacent regression:
  50 pass / 0 fail / 0 skip
Modified final vertical + v3 upcaster check:
  4 pass / 0 fail / 0 skip
TypeScript: pass
Architecture: pass / parser=swc / 601 modules / 4317 dependencies / 0 violations
Schema: pass / 69 schemas / 204 external refs
Schema digest: sha256:0e026491920e2857902216c5a038eeade88f0830b6f1e48dd9d11c5eef81ab7d
git diff --check: pass
```

本单元尚未给新TestCard保存显式的predecessor/remediation tuple；它当前通过source state digest、旧Test Target和Event history
保持可审计，但Card自身不能直接回答“由哪份缺陷Card和Authorization触发本次retest”。下一审阅单元应判断是否把该关系作为
真实Test generation lineage进入TestCard/Planning，而不是依赖调用方从全流推断。

## 206. R-2B-15（TestCard generation lineage预审）

### 206.1 回溯修正：lineage不应污染Test执行合同

完成真实产品修复→新Card→新Test Task纵切后，可以区分两个不同问题：

```text
TestCard回答：当前Test窗口被批准测试什么、如何测试、在哪个边界测试？
Generation lineage回答：为什么创建这份Card，它替代哪次缺陷验证？
```

Test窗口执行新Card不需要旧Card、旧Result或产品remediation全文；把这些历史tuple放进TestCard会扩大Target可见合同、改变
Card digest，并让初始Card与retest Card形成不必要的形状分支。

[Azure Test Plans](https://learn.microsoft.com/en-us/azure/devops/test/run-manual-tests?view=azure-devops)把可复用Test Case、每次
Test Result和关联Bug分开保存；修复后重新执行不会把旧Bug历史变成测试步骤本身。
[Microsoft Event Sourcing](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)则建议Event记录业务意图。
由此推断，Wakeflow应让Card creation Event记录generation cause，而不是让Card承担历史ledger职责。

### 206.2 三种互斥方案

| 方案 | 持久来源 | TestCard | 评价 |
| --- | --- | --- | --- |
| A（推荐） | `testing.test-card-created.v2`新增required判别`generationSource: initial | product-defect-retest`；retest绑定旧Card、Test Decision与remediation Authorization tuple | 保持当前执行合同不变 | Event直接表达创建原因；旧v1安全upcast为initial；Aggregate digest不变；Test不获得额外历史权限 |
| B | TestCard新增可选`retestSource` | Card自身可回答lineage | 读取方便，但把审计关系复制进执行合同、改变Card digest，并扩大Target-facing数据 |
| C | 不新增持久字段，只按Event先后与state digest推断 | 不变 | 实现最少，但无法区分未来其他Card重建原因，审计者必须重复推理 |

### 206.3 方案A拟定合同

Event v2建议形状：

```text
generationSource:
  { kind: "initial" }
或
  {
    kind: "product-defect-retest",
    previousTestCard: { testCardId, testCardDigest },
    testReviewDecision: { targetReviewDecisionId, decisionDigest },
    productDefectRemediation: {
      productDefectRemediationId,
      authorizationDigest
    }
  }
```

初始Card只能在没有历史Test Target时使用`initial`。存在历史`test-product-defect` Target时，新Card必须使用
`product-defect-retest`，并由Planning Authority从完整Event history派生三个精确tuple；调用方仍只提交TestCard authored
content。Reducer只需验证Card当前baseline/state digest，Repository audit负责闭合generationSource与旧Test Decision、
Authorization和事件顺序。

Event v1只包含Card；upcaster可安全添加`generationSource:{kind:"initial"}`，因为旧v1能力只允许首份Card。该字段不进入
Aggregate current summary，因此旧resulting-state digest保持不变。

当前推荐方案A，等待用户确认后再实现Event v2、Planning来源派生和真实retest lineage审计。

### 206.4 用户确认A后的Event v2与Planning来源

新增独立`TestCardGenerationSource`合同和两类严格判别值；TestCard本体保持原执行合同，不新增lineage字段。
`testing.test-card-created`当前写入版本升为v2：

- v1 payload仍只含`testCard`，upcaster确定性补为`generationSource:{kind:"initial"}`；
- v2 payload同时保存`testCard`与required `generationSource`；
- 初始Card只能声明`initial`，产品缺陷后的Card必须声明`product-defect-retest`；
- Event中的retest来源只保存旧Card、Test Decision和Remediation Authorization的identity/digest tuple，不复制完整历史记录。

Planning Plan把`generationSource`纳入自身digest，但TestCard digest不受影响。Planning Authority只审计一次完整Event Stream，
由当前状态和历史Event派生来源；调用方继续只提交Card authored content。Apply幂等路径按Plan中的tuple回查完整Authorization，
Command写入前要求完整Authorization并复验其Canonical digest及tuple投影，Event仍只保存最小来源。

Repository审计逐代验证：Card source revision和state digest、旧Card及旧Test Target、`escalate-product-defect` Decision、
Remediation Authorization、严格事件先后，以及旧Card和Authorization均不能被两个新Card重复消费。

### 206.5 纯Decider审查发现：仅靠Event lineage仍缺少写前证明

第一版实现把完整Authorization放入Command，并计划只由Repository在提交后闭合历史。进一步从纯Decider边界检查后发现：
Command中的Authorization即使内部自洽，Decider若只看“当前没有Card、存在旧缺陷Target”，仍不能证明这份Authorization已经
作为更早Event进入同一Demand Stream。Repository事后拒绝无法阻止低层调用先写入错误Stream。

[Microsoft Event Sourcing](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)明确要求Command Handler先从
Event Stream重建实体当前状态，再由Aggregate执行规则和产生新Event；Event Store仍是事实权威，Snapshot/投影只用于重建和
决策。依此修正，Aggregate新增最小`pendingTestRetest`投影：

```text
review.product-defect-remediation-authorized
  → set pendingTestRetest(previous Card + Test Decision + Authorization tuple)

product remediation Delivery / Result / reaccept
  → preserve pendingTestRetest

testing.test-card-created.v2 with exact generationSource
  → consume pendingTestRetest
  → set currentTestCard
```

该投影不是第二份Authorization，也不是可独立修改的业务文件；它只表示“同一Aggregate当前还欠一次已授权复测”。完整
Authorization和所有历史细节仍只由不可变Event保存。`pendingTestRetest`与`currentTestCard`互斥，必须回指历史
`test-product-defect` Target，completed状态不能保留pending。这样纯Decider在append之前就能拒绝伪造或重复消费。

Planning Authority不再从所有历史中猜测“唯一未消费Authorization”，而是先读取Aggregate明确的pending tuple，再回查唯一
完整Authorization。Repository审计额外要求：当前有pending时恰好存在一份对应的未消费Authorization；没有pending时不得残留
未消费Authorization。Event是source of truth，Aggregate是由Event重放得到的current decision state，两者权威没有混淆。

### 206.6 真实复测纵切与门禁结论

真实小型路径验证了pending投影的完整生命周期：Authorization后创建、产品修复Delivery和重新accept期间保留、新Card创建时
精确消费。测试还使用同一合法Card和当前state digest但替换Remediation identity，证明Aggregate在写入前按pending tuple拒绝
不匹配来源；新Card提交后Repository审计确认两代Card、旧缺陷Target及新当前Card均闭合。

```text
Focused lineage / Planning / real retest / Decider / Repository / Upcaster:
  12 pass / 0 fail / 0 skip
Focused Aggregate / Snapshot / Commit / Command Handler / state version:
  7 pass / 0 fail / 0 skip
TypeScript: pass
Architecture: pass / parser=swc / 605 modules / 4337 dependencies / 0 violations
Schema: pass / 71 schemas / 207 external refs
Schema digest: sha256:187867936f78fd60da1eea2d593eb27fd7aef25afc76ae9698384fc15fed0d2d
git diff --check: pass
```

R-2B-15至此完成。当前TestCard generation lineage既可从Event直接审计，也能由Aggregate在下一条Command写入前执行一致性规则；
没有把历史关系扩散进Test执行合同，也没有新增独立读模型或后台投影系统。

## 207. R-2B Testing系统架构核实节点

### 207.1 已闭合的内部业务骨干

R-2B目前已经覆盖一条完整的内部Controller/Test业务链：TestCard、Test Task、initial/rerun/replacement Delivery、target-facing
packet、Claim授权、Agent Host Action、Host Effect Observation、TargetResult、Controller Review、blocked恢复、Completion、产品缺陷
Authorization、产品修复Delivery和新Test代际。Event Store、Aggregate、Repository audit、create-only查询投影和Config current fence
各自拥有清晰职责。

当前Testing目录有19个手写TS模块、8507行生产源码；对应7个直接测试文件及fixtures共2887行。体量主要来自严格wire parser、
Authority恢复、preview/apply和真实纵切，不存在TODO/FIXME分支，也没有发现使用`node:child_process`、tmux、Git或宿主CLI的代码。
Test Claim只返回typed Agent Host Action；真正的Codex/Claude消息发送仍由调用Agent和宿主完成，符合“Wakeflow无权自行调用宿主”的
既定边界。

### 207.2 当前真正缺口不是另一项Testing内部能力

当前公共MCP只注册三项已经闭环的owner：Maintenance、Window Host Binding registration和Implementation Target Task Planning。
TestCard Planning、Test Delivery、Claim/Outcome、Result Import、Controller Test Review、Resume和Product Defect Remediation Service均
没有production composition-root consumer；它们目前只由聚焦测试直接驱动。

这不说明这些Service应删除：它们共同构成用户已确认并完成真实验证的业务骨干。它说明继续新增Evidence、Pod、更多Test状态或
直接复制旧JS工具表，都会扩大一组尚未真正接入产品入口的内部能力。R-2B应在此冻结；下一步必须先解决Controller如何读取当前
路线、理解允许动作并调用这些owner。

旧JS公共runtime有二十多个工具和大量action分支；原样迁移会把旧复杂度带回新版。MCP
[Tools规范](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)要求每项工具具有清晰name、description和JSON
Schema，并建议可变操作保留human-in-the-loop，但明确不规定唯一交互模式。因此工具粒度应由Wakeflow领域owner和确认边界决定，
不能以“协议要求”为由建立巨型统一工具或一Service一工具。

### 207.3 三条互斥后续路线

| 方案 | 下一步 | 优点 | 代价/风险 |
| --- | --- | --- | --- |
| A（推荐） | 先建设只读、可重建的Controller Route/Inspection application layer，统一回答当前Demand阶段、精确来源tuple、允许的下一动作和所需确认；再按真实动作组确定少量公共mutation coordinators | 先形成用户要求的清晰中间环节；不把Route变成权威；能用真实动作矩阵决定工具边界 | 暂不立刻让全部R-2B Service公开可调用 |
| B | 直接为每个现有Service建立独立public contract/coordinator/MCP tool | owner最明确，单工具Schema较小 | 立即增加约8项工具；Agent必须自行重建流程顺序，容易回到旧工具繁殖 |
| C | 建立单一`wakeflow_testing`巨型工具，用action判别联合覆盖全部操作 | 工具数量最少 | 一个入口混合planning、effect、result、review和remediation Authority；Schema、错误和确认边界再次变成大switch |

当前推荐A。它不是此前已删除的Owner–Resource Capability Binding：Route只从现有权威事实计算“现在可做什么”，不维护另一份
owner/resource注册表，也不授予权限。待用户确认后，下一单元先只读审阅现有Post-Acceptance Route、Result Review Snapshot、
Demand Aggregate和旧`next_work/status`场景，提出最小Controller Route合同；不会直接增加公共mutation工具。

## 208. Controller Route合同预审

### 208.1 已确认的目标与非目标

用户确认§207方案A：先建设只读、可重建的Controller Route/Inspection中间层，再根据真实动作矩阵决定少量公共mutation
coordinator。当前单元只决定Route的层级、语义和文件落点；不注册MCP tool、不调用任何现有写Service、不执行宿主效果，也不
把Route结果当成写许可。

目标是让Controller稳定回答：

```text
当前Demand有哪些并行责任前沿？
每个前沿由哪个领域owner负责？
它需要调用Wakeflow owner、等待Agent宿主事实，还是返回Design/用户？
结论来自哪一条精确Event Stream / Review / Post-Acceptance基线？
```

它不回答Controller的业务判断内容，例如新TaskPackage正文、Review verdict、修复目标、测试步骤或用户选择。

### 208.2 当前TS的三层事实已经存在

当前并不缺状态或审查事实：

1. `DemandAggregateState`是Event重放后的write-side current decision state，拥有lifecycle、每个Target phase、当前TestCard和
   `pendingTestRetest`；所有写准入仍由Reducer/Decider执行。
2. `DemandResultReviewSnapshot`是同步、零写、可重建的CQRS读模型，闭合当前Target与完整TaskPackage、Result、Decision和
   Event来源；它刻意不推导allowed decisions或next action。
3. `DemandPostAcceptanceRoute`在所有Implementation Target接受后选择Test/Completion领域下一阶段。目前有13个严格状态，且已被
   TestCard Planning、Test Task Planning、Test Delivery Preparation、Product Defect Remediation和Demand Completion五个真实
   写owner消费。每个owner仍会重读Config/Event/历史并复验Route tuple。

因此Controller Route不能重新解释Event历史，也不能取代Post-Acceptance Route成为新的写准入权威。它应组合这三层既有事实，
只投影Controller当前责任前沿。

### 208.3 旧JS与当前缺口核对

旧`wakeflow_next_work`实际是TODO Board资格扫描，不是单个Demand的下一业务动作；旧`wakeflow_status.nextActions`把Config、
Storage、Git、Binding、Transport、Lease、Pod和Maintenance的建议集中在2475行Observability模块中。历史审计已经把这些结果
定性为routing hint，并明确指出“全知aggregator”会成为第二个业务解释器。新版Controller Route不得复制该跨领域status集合。

当前状态矩阵还暴露三项诚实能力缺口：

- `redesign-requested`已有Event/Aggregate事实，但没有Authority supplement或replacement lineage consumer；应路由Design/用户，
  不能伪装为普通Task Planning可执行；
- `research + testing:not-applicable + zero Target`不能进入当前Completion，必须显示`research-completion-not-implemented`，不能
  借用Implementation/Test关闭合同；
- Cancel Event/Reducer/Command骨干存在，但没有Lifecycle Cancel Service/public owner；Route可以显示终态，却不能把低层Command
  冒充已完成的公共取消能力。

Route的价值之一正是把这些缺口显示为typed frontier，而不是让Agent从“not-ready”自由猜测。

### 208.4 标准实践与Tencent参考边界

[Microsoft CQRS](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs)要求Query零写并返回针对consumer优化的DTO，
不把read model变成write model；[Microsoft DDD application layer](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/ddd-oriented-microservice)
进一步要求application layer保持薄，只协调domain owner，不拥有业务规则或业务状态。
[AWS Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/workflow-states.html)把Action state与Flow state分开，并显式支持
Parallel分支。Wakeflow据此不使用单一`nextAction`：同一Demand可能有多个repository Target处于不同phase，Controller Route应
返回按Target ID稳定排序的多个责任前沿。

TencentDB-Agent-Memory没有Event-sourced Controller Route。其`offload_server/router.ts`只做HTTP route→handler分派，状态和
transition留在独立模块；这个“薄router不拥有领域状态”原则可借鉴。其`task-transition.ts`基于LLM judgment原地修改状态并以正则
解析MMD，适用于该项目的memory offload，不适合作为Wakeflow的确定性Event Sourcing路线。

### 208.5 三种互斥层级方案

| 方案 | 结构 | 优点 | 风险 |
| --- | --- | --- | --- |
| A（推荐） | 保留`DemandPostAcceptanceRoute`作为Test/Completion领域准入Route；新增`src/governance/controller/demand-controller-route.ts`作为薄application read model，组合Aggregate、Review Snapshot和精确Post-Acceptance Route | 现有五个写consumer不反向依赖Controller；统一视图可以列出并行frontier；领域规则仍各归owner | 存在两个有明确上下层关系的read model，必须用source digest和穷尽映射防止漂移 |
| B | 把`DemandPostAcceptanceRoute`整体扩展并重命名为`DemandControllerRoute`，迁移五个写consumer | 表面只有一个Route类型 | 一个模块同时拥有Implementation、Test、Completion和Controller presentation；写owner反向依赖全局application模型，容易成长为旧status aggregator |
| C | 不新增Route，只把Aggregate、Review Snapshot和Post-Acceptance Route一起公开，由Agent解释 | 改动最少 | 没有用户要求的清晰中间环节；每个Agent重复phase→owner映射，缺口和并行责任无法形成稳定合同 |

### 208.6 方案A的最小合同草案

```text
DemandControllerRoute
  kind / schemaVersion
  programId / demandId / demandType / lifecycle
  authorityDigest
  observedEventStream
  reviewSnapshotDigest
  postAcceptanceRouteDigest?   # 只有进入该领域Route时出现
  frontiers[]                  # 按scope + targetTaskId稳定排序
  blockers[]                   # typed capability/input gaps，不是自由文本建议
  routeDigest
```

`frontiers`使用closed discriminated union，不使用任意`owner/capability`注册表。Implementation至少映射：

```text
planned                         → Target Delivery Preparation
delivery-prepared               → Target Host Effect Claim
host-effect-claimed             → Agent Host Effect / Outcome fact
host-effect-accepted|indeterminate → TargetResult Import
host-effect-rejected            → Target Host Effect Rearm
result-reported                 → Controller Review Decision
rework-requested                → Target Delivery Preparation(rework)
product-defect-rework-requested → Target Delivery Preparation(remediation)
review-blocked                  → Controller Review Resume
redesign-requested              → Design/User authority gap
accepted                        → no target frontier
```

当所有Implementation关闭后，Controller Route只穷尽映射现有Post-Acceptance `nextStage`，不重算其准入。`currentTestCard`和历史
Test Target的选择继续由Post-Acceptance Route负责。

Route是函数和递归冻结数据即可，不使用class、manager、后台projection、持久文件或独立状态机。第一实现切片只应包含该纯Route
和聚焦测试；下一切片再决定公共只读Schema/coordinator/MCP tool。公共工具若建立，应为`readOnlyHint:true`、`openWorldHint:false`，
不需要preview/apply，并继续删除private root/handle。

当前推荐方案A，等待用户确认这一层级选择后再实现首文件。

### 208.7 用户确认A后的纯Controller Route

用户确认保留Post-Acceptance领域Route并在其上建立薄application read model。新增
`src/governance/controller/demand-controller-route.ts`，唯一公开构造入口为
`buildDemandControllerRoute(loaded, snapshot)`：

```text
同一次Loaded Demand Authority + Review Snapshot
  → buildDemandPostAcceptanceRoute（复用既有领域准入和relation检查）
  → 映射当前Implementation Target phase
  → 全部Implementation accepted时只映射Post-Acceptance nextStage
  → 稳定排序frontiers / typed blockers
  → Canonical route digest
```

顶层固定保存Program/Demand/type/lifecycle、Authority digest、Event Stream tuple、Review Snapshot digest和可选
Post-Acceptance Route digest。Frontier只保存`scope + kind + owner`和当前Target最小引用；它不复制完整TaskPackage、Delivery、Claim、
Host Effect、Result、Review Decision、Test环境Authority或Card正文。

Implementation phase映射完整覆盖当前Aggregate联合：

| 当前phase | Controller responsibility frontier |
| --- | --- |
| `planned / rework-requested / product-defect-rework-requested` | `implementation-delivery-planning` |
| `delivery-prepared` | `implementation-host-effect-claim` |
| `host-effect-claimed` | `implementation-host-effect-execution`，owner明确为`agent-host` |
| `host-effect-accepted / host-effect-indeterminate` | `implementation-target-result-import` |
| `host-effect-rejected` | `implementation-host-effect-rearm` |
| `result-reported` | `implementation-result-review` |
| `review-blocked` | `implementation-review-resume` |
| `redesign-requested` | Design frontier + typed capability blocker |
| `accepted` | 不产生Target frontier |

零Target非research Demand返回Task Planning；cancelled/completed返回空frontier terminal。全部Implementation accepted后，Route保存
Post-Acceptance digest，并穷尽映射Completion、Test Card/Task/Delivery、Agent Host、Result、Review、rerun、replacement、blocked
resume和Product Defect Remediation责任，不重新判断其领域资格。

### 208.8 实现中即时剪枝与验证

首个可编译草稿曾把每个Frontier的Delivery、Claim、Host Effect、Result和Decision摘要再次投影到Controller Route。文件复审立即
判定这会形成第二个领域read model：Controller只需知道当前责任owner，写owner会自行重读完整来源。该草稿在测试前删除，最终合同
只保留最小Target引用和上游读模型digest。这是本单元“避免过度设计”的实际修正，不保留兼容字段或废弃测试。

聚焦测试使用真实本地Event Stream纵切验证：

- 空Demand→Implementation Task Planning→planned Target→cancelled terminal；
- Delivery prepared→Claim→Agent Host Effect→Outcome→TargetResult Import；
- Result reported→Controller Review→controller-only Completion preflight；
- redesign Decision形成Design frontier和明确未实现blocker；
- real-environment接受后进入TestCard Planning，Card Event后进入Test Task Planning；
- Route digest自闭合、数组冻结、进入Post-Acceptance前不伪造其digest，也不泄漏完整环境Authority来源。

```text
Focused Controller Route + adjacent Post-Acceptance Route:
  9 pass / 0 fail / 0 skip
TypeScript: pass
Prettier: pass
Architecture: pass / parser=swc / 607 modules / 4366 dependencies / 0 violations
Schema: unchanged / no public wire added
git diff --check: pass
```

没有运行旧JS、完整TS套件、plugin validator/smoke或`npm test`；没有commit、push、发布或cache刷新。当前已知的
`research-completion-not-implemented`分支保持typed blocker，但本单元没有为尚无owner的research关闭路径扩建大型持久fixture；
真正建设Research Completion时必须用该纵切补上真实consumer测试。

首文件至此完成。下一单元应先审阅其第一个production consumer：建立直接公共只读Route Query，还是先增加内部root reader。
不应在没有consumer的情况下继续扩展更多frontier字段。

## 209. Controller Route公共只读Query预审

### 209.1 用户确认直接建立首个production consumer

用户确认不增加无consumer的内部reader，下一纵切直接建立公共只读Route Query。当前公共MCP只有Maintenance、Window Host Binding
registration和Implementation Target Task Planning三项工具；全部使用官方`@modelcontextprotocol/server@2.0.0`、
`fromJsonSchema(...)`、同时返回Canonical JSON TextContent与`structuredContent`，并给出严格`outputSchema`。

入口Schema当前有明确额外门：所有`src/contracts/schemas/entrypoints/*.schema.json`必须完全自包含，只允许同文档`#...`引用，
不能把领域Schema的外部URN交给MCP客户端解析。公共Coordinator仍会在SDK校验后重新解析输入，并在返回前执行输出Schema、容量和
私密路径扫描。

### 209.2 稳定MCP版本边界

本地官方SDK 2.0.0当前`LATEST_PROTOCOL_VERSION`为`2025-11-25`，同时兼容更早稳定版本。该稳定协议要求：声明
`outputSchema`时Server必须返回符合它的object `structuredContent`，并建议同时返回序列化TextContent。
[MCP Tools规范](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)支持本项目现有做法。

2026-07-28规范仍是release candidate；它计划把output提升为任意JSON Schema 2020-12，但本Query没有必要依赖候选能力。结果继续
使用object root，既能被当前SDK严格处理，也不阻碍未来升级。Tasks、resource link、subscription和pagination都不进入本地同步Route
读取。

### 209.3 Request最小边界与工具命名

Request只需要：

```text
{
  root: absolute workspace root,
  demandId: typed demand ID
}
```

它没有`mode`、`operation`、`preview/apply`、expected digest、时间、语言、host或caller声明。Root词法只做non-empty string；
Coordinator通过`RootedDirectory.open`验证真实根，Schema不编造跨平台absolute-path正则。

候选工具名：

| 方案 | 名称 | 评价 |
| --- | --- | --- |
| A（推荐） | `wakeflow_inspect_demand_route` | 动词、对象和只读目的完整；不会暗示改变Demand或返回全量Demand内容 |
| B | `wakeflow_inspect_controller_route` | 突出actor，但没有显式说明route属于哪个Demand对象 |
| C | `wakeflow_inspect_demand` | 简短，但容易被理解为全量状态/历史/文档查询，未来扩张风险最高 |

### 209.4 Result envelope三种方案

| 方案 | 公开结果 | 优点 | 风险 |
| --- | --- | --- | --- |
| A（推荐） | `{kind:"WakeflowDemandControllerRouteInspectionResult", schemaVersion:1, tool, status:"current", route:<exact DemandControllerRoute>}` | 公共协议身份与内部Route身份分开；`routeDigest`仍精确覆盖内部Route；与现有公共结果风格一致 | 多一层固定`route`字段 |
| B | 直接返回内部`DemandControllerRoute` | 字节最少 | 公共结果没有tool identity；未来public-only metadata无稳定位置；领域DTO被直接冻结成公共根合同 |
| C | 在Route顶层加入`tool/status`并重算public digest | 扁平 | 同一语义出现internal/public两种摘要；Coordinator必须重建全部字段，最容易漂移 |

推荐A。Envelope不另加`observedAt`或public digest；当前性已经由Route的stream revision/state/tail tuple证明，墙钟会破坏无变化重复读取的
确定性。

### 209.5 Public Route字段与容量

嵌套`route`公开当前内部最小合同：Program/Demand/type/lifecycle、Authority digest、Event Stream tuple、Review Snapshot digest、
可选Post-Acceptance digest、disposition、frontiers、blockers和route digest。Target frontier只含typed ID/digest、logical
repository/window ID、work type和phase；不含absolute root、raw handle、private Binding、TaskPackage正文、prompt、环境Authority、
Result/Decision正文或本地资源路径。

Schema闭合：

- request/result均为JSON Schema 2020-12 object、`additionalProperties:false`；
- frontiers通过`scope + kind + owner`闭合组合，Implementation/Test Target使用不同引用形状；
- `frontiers/blockers`最多10000项，与Aggregate现有Target容量一致；
- output Coordinator沿用24 MiB上限；超限返回稳定output error，不截断责任前沿；
- entrypoint Schema复制sha256和typed ID词法为local `$defs`，并由现有self-contained测试与领域词法做漂移比对；
- MCP annotations计划为`readOnlyHint:true`、`destructiveHint:false`、`idempotentHint:true`、`openWorldHint:false`。

### 209.6 建议首文件单元

用户确认方案A后，第一实现单元只包含：

1. `wakeflow-demand-controller-route-request.schema.json`；
2. `wakeflow-demand-controller-route-result.schema.json`；
3. codegen生成文件和精确Schema自包含/词法测试更新。

本单元不创建Coordinator、MCP注册或双宿主入口，避免在wire review前同时修改producer。Schema确认后，下一文件才建立公共Contract和
Coordinator真实消费Route。

当前推荐工具命名A + Result envelope A，等待用户确认后实现两份Schema。

### 209.7 用户确认后的公共wire实现

用户确认`wakeflow_inspect_demand_route`和嵌套Route envelope。新增两份自包含MCP Schema：

```text
wakeflow-demand-controller-route-request.schema.json
  { root, demandId }

wakeflow-demand-controller-route-result.schema.json
  {
    kind: WakeflowDemandControllerRouteInspectionResult,
    schemaVersion: 1,
    tool: wakeflow_inspect_demand_route,
    status: current,
    route: exact DemandControllerRoute
  }
```

Result Schema在同一文档内关闭全部typed ID、SHA-256、Event Stream、Implementation/Test Target、frontier和blocker词法。它按
`scope`区分Demand/Target责任，按`workType`区分Implementation/Test引用，并用严格conditional关系验证每个`kind → owner → phase`：
例如Delivery Planning不能携带Result phase，Agent Host责任只能对应claimed phase，Test Product Defect只能交给Remediation owner。

Route disposition关系也进入wire：terminal必须零frontier/零blocker且没有Post-Acceptance digest；blocked必须同时拥有frontier和
blocker；work-available必须至少一个frontier。数组容量与Aggregate保持10000，不引入分页或截断语义。

### 209.8 strict Schema实现修正与生成结果

首次Ajv strict compile发现conditional子Schema只写`maxItems/minItems/properties`、没有在同一子Schema声明`type`。虽然上层已约束
类型，Ajv `strictTypes`仍正确拒绝这种隐式假设。已在每个条件分支显式补充`type:"array"`或`type:"object"`，没有关闭strict、
降低Ajv配置或绕过codegen。

生成结果保持较小：request generated 40行，result generated 134行；手写result Schema较长是因为显式关闭22类责任关系，而不是
复制TaskPackage/Delivery/Result正文。当前没有抽取新的Schema DSL、生成前模板或跨文件外部引用；待更多同类公共Route出现真实
重复后再判断是否需要codegen bundling。

聚焦验证同时执行真实Event Stream：初始Demand和planned Implementation Target产生的Route envelope均通过Result Schema；错误
owner、错误phase、伪terminal、额外source/root泄漏字段和非法Request均失败。MCP entrypoint目录继续由通用测试证明零external ref，
新增request/result的Demand ID词法保持一致，Result SHA-256镜像Foundation权威。

```text
Focused public Route Schema + MCP self-contained:
  2 pass / 0 fail / 0 skip
Schema tooling:
  6 pass / 0 fail / 0 skip
TypeScript: pass
Prettier: pass
Architecture: pass / parser=swc / 610 modules / 4374 dependencies / 0 violations
Schema: pass / 73 schemas / 207 external refs
Schema digest: sha256:852a0f195cfaf4063e199036af6a543771e781519c5e9efe79ab54f4bdce503d
git diff --check: pass
```

本单元没有创建Public Contract、Coordinator、MCP注册或双宿主入口，也没有运行旧JS、完整TS、plugin smoke/validator或`npm test`。
下一紧邻单元应成对实现`demand-controller-route-public-contract.ts`与
`demand-controller-route-public-coordinator.ts`，让这两份wire获得第一个真实production producer/consumer；MCP注册继续留到随后
独立文件review。

### 209.9 Public Contract与Coordinator

新增`demand-controller-route-public-contract.ts`：

- 唯一工具名Authority为`wakeflow_inspect_demand_route`；
- request最大64 KiB，在任何根目录读取前完成passive JSON、Canonical byte capacity、自包含Schema和typed Demand ID准入；
- 返回递归冻结的`{root,demandId}`，不接受mode、operation、expected digest或其他调用方控制字段；
- 普通输入、容量、Schema和typed identity拥有稳定、带path的错误分类。

新增`demand-controller-route-public-coordinator.ts`，使用函数而不是持有状态的class。一次调用固定顺序为：

```text
parse public request
→ RootedDirectory.open(workspace)
→ open current Config + Ledger + audited Demand authority context
→ rebuild Review Snapshot
→ build pure DemandControllerRoute
→ re-read exact Config node/digest as current fence
→ build public envelope
→ passive JSON + 24 MiB + private path + Result Schema validation
→ close Demand/Ledger roots
→ close workspace root
```

Config current fence使`status:"current"`不只是“曾经读到一份合法Config”；若Config在组合读取期间变化，Query返回route error而不是
发布混合时点。Event Stream若在Authority load和Review audit之间变化，会由Route source relation拒绝，不会把旧Aggregate与新Review
拼成一份结果。

脱敏扫描覆盖调用方root、canonical workspace root、Config ledger root、实际Demand root和实际Ledger root的任意字符串包含关系。
输出只返回Schema允许的logical ID/digest/phase；Coordinator不读取host binding、不执行host tool、不访问产品repository，也不缓存
workspace状态。

### 209.10 聚焦验证与当前公共边界

真实本地Event Stream验证：

- 同一请求连续读取结果逐字段相同，Demand inventory前后完全不变；
- 初始Demand返回Implementation Task Planning；追加真实Task Event后stream revision加一并返回Delivery Planning；
- 公开结果递归冻结且不包含workspace绝对路径；
- extra mode、Proxy、70 KiB请求、missing workspace和missing Demand分别稳定归入Schema/JSON/capacity/root/route错误；
- missing Demand的内部cause保持`wakeflow-demand-operation-authority-context`，但不回显物理路径；
- 全Controller Route、public Schema与MCP self-contained相邻组共同通过。

请求/结果容量常量保持模块私有，测试使用明确越界样本，不为测试向production API增加getter或常量export。

```text
Focused Controller Route + public wire + Coordinator + MCP self-contained:
  9 pass / 0 fail / 0 skip
TypeScript: pass
Prettier: pass
Architecture: pass / parser=swc / 613 modules / 4395 dependencies / 0 violations
Schema: pass / 73 schemas / 207 external refs
Schema digest: sha256:852a0f195cfaf4063e199036af6a543771e781519c5e9efe79ab54f4bdce503d
git diff --check: pass
```

当前Coordinator是完整production owner，但尚未注册到MCP composition root，因此用户仍不能通过工具调用。下一单元必须把它接入
`wakeflow-public-mcp-server.ts`并保持Codex/Claude组合一致；不得在此之前继续增加其他Controller frontier或mutation工具。

### 209.11 官方MCP注册与双宿主组合

`wakeflow-public-mcp-server.ts`继续使用显式executor injection，而不是直接在SDK handler中实例化领域Coordinator。新增required
`inspectDemandRoute` executor，Server options仍要求闭合字段集、普通函数且拒绝Proxy；Codex与Claude Code composition root均注入
同一个host-neutral `executeDemandControllerRoutePublicRequest`。这样官方SDK适配层可独立测试，宿主文件只做组合，不复制Route逻辑。

第四项工具固定为：

```text
name: wakeflow_inspect_demand_route
title: Inspect Wakeflow Demand Route
inputSchema: exact self-contained request v1
outputSchema: exact self-contained result v1
annotations:
  readOnlyHint: true
  destructiveHint: false
  idempotentHint: true
  openWorldHint: false
```

Server instructions明确要求在选择领域owner前读取当前责任frontier，并同时声明Route只是read-only observation，不是mutation
authority或Controller acceptance。Tool description说明来源是Config、Event Stream、Review Snapshot和Post-Acceptance Route，且不
返回workspace path、host handle、prompt或完整业务记录。

Handler只把SDK已准入request交给注入executor，并同时返回Canonical JSON TextContent与structuredContent。Contract/Coordinator错误
进入既有`WakeflowMcpError` envelope，只公开code/reason/path或causeCode/causeReason；异常错误仍收敛为`wakeflow-unexpected`，不返回
stack或请求root。

### 209.12 MCP真实验证与当前可调用边界

官方InMemory MCP Client验证：

- `tools/list`现在精确四项，Route input/output Schema ID正确且无external URN；
- SDK在executor前拒绝额外参数；
- Route工具同时返回完全一致的structured result与JSON text；
- annotations完整表达只读、非破坏、幂等和closed-world；
- 真实workspace通过MCP调用返回Implementation Task Planning frontier且不回显root；
- Route Coordinator错误保留稳定authority-context cause，但不回显私密请求；
- Codex与Claude Code composition root运行时列出的四工具集合完全相同；
- 原Maintenance、Target Task Planning和Window Binding调用、输出Schema、真实Binding纵切均未回归。

```text
Focused Controller Route + MCP + dual-host + adjacent Binding/Tasking:
  27 pass / 0 fail / 0 skip
TypeScript: pass
Prettier: pass
Architecture: pass / parser=swc / 613 modules / 4405 dependencies / 0 violations
Schema: pass / 73 schemas / 207 external refs
Schema digest: sha256:852a0f195cfaf4063e199036af6a543771e781519c5e9efe79ab54f4bdce503d
git diff --check: pass
```

Controller Route公共纵切至此从纯读模型、wire、Contract、Coordinator一直闭合到双宿主官方MCP composition root。它尚未进入正式
插件制品构建、旧JS切换、发布或安装cache，因此不能描述为当前已安装Wakeflow新增了工具。

下一阶段不能直接批量公开全部R-2B Service。应以Route当前首个不可调用frontier为consumer，审查
`implementation-delivery-planning → TargetDeliveryPreparationService`的公共边界，并决定Delivery Preparation/Claim应保持两个工具
还是同一Delivery工具的严格分离operation；该选择需要先讨论。

## 210. Implementation Delivery公共工具粒度预审

### 210.1 当前责任链不是一个可自动执行的长事务

当前Route在Implementation Target `planned/rework-requested/product-defect-rework-requested`时返回
`implementation-delivery-planning`。下游实际有四个独立owner：

```text
TargetDeliveryPreparationService
  preview: zero write
  apply: append delivery.target-delivery-prepared Event
  no Claim / no Agent Action / no host effect

TargetHostEffectClaimService
  validate fresh Agent Host observation + current private Binding
  create cross-Demand exclusive Claim before Event
  append claimed Event
  issue Agent Host Action only on the first committed call

Agent invokes host capability outside Wakeflow

TargetHostEffectOutcomeService
  record the already-observed outcome
  append observed Event
  retain Claim for accepted/indeterminate
  release exact Claim only for rejected-before-effect

TargetHostEffectRearmService
  require rejected Event + physically released Claim + current Binding
  append rearm Event and return to delivery-prepared
  next effect must create a new Claim
```

Preparation只拥有Event authority；Claim同时拥有全局Claim authority和Event authority；Outcome可能处于
`claim=current|released|unknown`与`event=unchanged|current|unknown`组合；Rearm要求Claim已经released。把这些步骤合并为一次自动调用会
越过Agent宿主效果和崩溃恢复边界，明确禁止。

### 210.2 旧JS的有效原则与应删除部分

旧JS使用`wakeflow_prepare_delivery`七个operation，同时混合target preview/apply/claim/rearm和Controller-return preview/apply/pre-send；
另用`wakeflow_record_delivery`记录target/controller outcome。有效原则是Preparation、Claim、Host Effect、Outcome始终分步，Agent调用
宿主；不应继承的是一个工具同时拥有Target与Controller-return两套流程、七个operation和中央runtime switch。

新TS当前没有Controller-return领域consumer，也已有typed Controller Route，所以无需靠一个巨型工具替Agent解释下一阶段。

TencentDB-Agent-Memory没有Agent宿主投递协议。其`WorkerPermitPool`把`acquire/release`保持显式配对，并在不平衡时失败；内部worker用
`finally`结算permit。这个原则支持“资源Claim生命周期必须成对且可审计”，但它是进程内信号量，不能决定Wakeflow公共MCP工具如何
分组，也不能替代本地耐久Claim/Event恢复。

### 210.3 官方实践校准

[Microsoft CQRS](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs)建议Command表达具体业务任务，而不是低层状态更新；
Prepare Delivery、Claim Host Effect、Record Outcome和Rearm Rejected Effect分别是四个可审计业务意图。
[AWS callback task](https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html)明确把外部worker开始与callback结果分开，
workflow在中间暂停；这与Wakeflow Claim→Agent Host→Outcome的边界一致。

[MCP Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)的annotations属于整个tool而非单个operation。Outcome在
rejected路径会删除已授权Claim，因此可能是destructive；Preparation/Claim/Rearm主要做append/create。全部塞进一个tool会迫使所有
operation共享最宽风险提示和错误面。

### 210.4 三种互斥方案

| 方案 | 公共工具 | 优点 | 代价/风险 |
| --- | --- | --- | --- |
| A（推荐） | 四个明确命令工具：`wakeflow_prepare_implementation_delivery`、`wakeflow_claim_target_host_effect`、`wakeflow_record_target_host_effect_outcome`、`wakeflow_rearm_target_host_effect` | 一工具对应一个已存在owner和恢复合同；Schema/错误/annotations精确；Route直接告诉Agent选哪一个 | 最终增加四个工具，但按frontier逐个建设，不一次暴露 |
| B | 两个工具：Preparation preview/apply；`wakeflow_coordinate_target_host_effect`内含claim/outcome/rearm | 工具数量较少；Host Effect阶段仍与Preparation分开 | 新增一个当前不存在的公共协调switch；Outcome删除Claim使整工具风险提示变宽；三类authority结果形成大union |
| C | 一个`wakeflow_target_delivery`，含preview/apply/claim/outcome/rearm | 工具数最少、表面像一条流程 | 重新制造旧`prepare_delivery`大入口；确认、Agent callback、Claim补偿和错误authority混在一个Schema；不建议 |

### 210.5 方案A的实施顺序与命名

内部类名`TargetDeliveryPreparationService`的Target实际只接受`workType=implementation`；Test使用独立
`TestDeliveryPreparationService`。因此公共名推荐`wakeflow_prepare_implementation_delivery`，比
`wakeflow_prepare_target_delivery`更准确，避免未来Test工具产生语义重叠。

第一纵切只公开Preparation：

```text
Route: implementation-delivery-planning
→ wakeflow_prepare_implementation_delivery preview
→ user/controller confirms exact plan + digest
→ apply
→ Route: implementation-host-effect-claim
```

它不顺带创建Claim。下一纵切才设计`wakeflow_claim_target_host_effect`，并单独解决Agent Host Action中哪些绝对定位信息可以公开给调用
Agent。Outcome/Rearm继续等真实Route抵达相应frontier后逐项实现。

当前推荐方案A和精确工具名`wakeflow_prepare_implementation_delivery`，等待用户确认后从Preparation request/result Schema开始。

### 210.6 用户决定与首个公共wire边界

用户确认方案A，并确认第一项工具名为`wakeflow_prepare_implementation_delivery`。本单元只新增该工具未来使用的request/result
Schema、派生类型和聚焦验证；没有提前创建Public Contract、Coordinator、MCP注册、Claim或Agent Host Action。

Request保持两种严格模式：

```text
preview { root, mode, demandId, targetTaskId }
apply   { root, mode, plan, planDigest }
```

Preview只选择当前Demand与Implementation Target；完整TaskPackage、Config、Binding和Event Stream authority仍由现有
`TargetDeliveryPreparationService`恢复。Apply必须回送Preview产生的完整不可变Preparation Plan与Canonical digest，不接受调用方重新
提交host、binding、prompt、purpose或Event身份的零散字段。

Result保持确认面与提交回执分离：

- Preview返回完整Plan与`planDigest`，使Controller可在写入前审阅Intent、portable prompt、精确TaskPackage入口、当前Binding代际以及
  initial/rework/product-defect-remediation来源；
- Apply不重复返回完整Plan或内部Command/Aggregate，只返回disposition、`eventAuthority:"current"`、Demand/Plan/Command摘要、Event与
  Commit物理回执、state digest，以及最小`delivery-prepared` Target Delivery投影；
- Target Delivery投影明确返回purpose、TaskPackage/Target/Delivery身份、Intent摘要与host/window/binding路由，但不能出现raw handle、
  workspace root、Claim、host action、send/readback或Outcome；
- `phase`只能是`delivery-prepared`。因此本工具成功后只把Route推进到
  `implementation-host-effect-claim`，不会伪装宿主效果已被取得或执行。

### 210.7 自包含Schema与漂移控制

新增：

- `wakeflow-target-delivery-preparation-request.schema.json`；
- `wakeflow-target-delivery-preparation-result.schema.json`；
- 两份codegen派生类型；
- `target-delivery-preparation-public-schema.test.ts`。

两份MCP wire Schema不使用外部URN引用，分别在本地关闭Plan、Intent、rework、product-defect-remediation、typed IDs、Host、路径、摘要与
时间词法。该重复是当前官方MCP工具可独立发布input/output Schema的边界成本，不因此新增Schema DSL、运行时bundler或第三套domain
model。

通用MCP self-contained测试新增两类漂移证明：

1. request/result全部共享定义逐项完全相同；
2. public Intent的required字段与property集合必须和领域`TargetDeliveryIntent`一致。

真实Service测试证明preview request/result、exact apply request和最小apply result均通过Schema；额外`hostAction`、跨模式字段、错误
`host-effect-claimed` phase与raw handle泄漏均不能进入公共结果。现有Intent与Preparation Service相邻回归同时通过，包括零写入
Preview、Config/Binding漂移、并发Apply、已提交幂等重试和Implementation Review rework。

```text
Focused Intent + Preparation Service + public wire + MCP self-contained:
  13 pass / 0 fail / 0 skip
TypeScript: pass
Prettier: pass
Architecture: pass / parser=swc / 616 modules / 4414 dependencies / 0 violations
Schema: pass / 75 schemas / 207 external refs
Schema digest: sha256:4c03849c2b9031768e2054b95a1b9af036e42ed03bbb57a9c50d3914ee5b66fa
git diff --check: pass
```

本单元没有运行旧JS、完整TS、plugin validator/smoke或`npm test`。下一紧邻审阅单元应成对实现
`target-delivery-preparation-public-contract.ts`与`target-delivery-preparation-public-coordinator.ts`，由现有Service成为唯一业务owner，
实现请求容量、RootedDirectory生命周期、稳定脱敏错误、apply结果投影与private path/handle泄漏扫描；MCP注册继续留到再下一个独立
文件review。

### 210.8 Public Contract与容量修正

新增`target-delivery-preparation-public-contract.ts`，固定唯一工具名与Schema版本，并把MCP SDK后的请求重新准入为passive、递归冻结、
自包含Schema验证的数据。Contract不打开workspace、不解释Plan，也不调用Service。

早期草案曾建议沿用Route Query的64 KiB请求容量。文件审阅发现这会拒绝领域内完全合法的Apply：完整Intent本身允许64 KiB prompt，
还可能同时携带32项rework/product-defect correction投影与Plan元数据。最终采用模块私有512 KiB上限，覆盖当前v1全部有界字段，且不向
生产API导出测试常量。超限输入在打开任何root前稳定返回`capacity`。

### 210.9 固定Host Public Coordinator与稳定提交回执

新增`target-delivery-preparation-public-coordinator.ts`。composition root必须提供冻结且一致的`hostId + Resource Profile + Identity
Profile`；Coordinator重新解析两份Profile并要求当前宿主支持Window Identity，不通过请求字段选择Codex/Claude行为。

一次调用固定为：

```text
assert fixed Host facade
→ parse bounded public request
→ open RootedDirectory
→ instantiate existing TargetDeliveryPreparationService
→ preview(demandId, targetTaskId) OR apply(exact plan, digest)
→ project bounded redacted public result
→ close root with event-authority-aware error
```

Preview返回完整Plan供Controller确认，且Route和Claim资源保持不变。Apply只返回Plan/Command摘要、原Preparation Event/Commit回执、该Event
记录的resulting state digest以及最小`delivery-prepared`投影。Coordinator不读取raw handle、不创建WindowWorkClaim、不生成Agent Host
Action，也不调用宿主能力。

实现审阅发现一个重要幂等边界：Event Sourcing Command Handler在旧Commit重放时返回当前Aggregate；若后续Claim已经把phase推进到
`host-effect-claimed`，从当前Aggregate构造旧Preparation回执会错误违反`delivery-prepared` Result Schema。最终投影改为使用不可变
Plan和已存Preparation Event，并返回`event.resultingStateDigest`，而不是当前Aggregate digest。这样晚到重放仍稳定描述原提交，同时
Controller Route独立显示当前revision与最新责任前沿。Result Schema已补充这一字段语义。

Coordinator错误固定分类为`host/root/preview/apply/output`，只保留稳定`causeCode/causeReason`与
`eventAuthority=unchanged|current|unknown`。请求root及canonical root不会出现在成功结果任意字符串中；Schema同时从结构上排除Claim、
host action、raw handle与Outcome字段。

### 210.10 真实纵切验证与当前边界

新增聚焦测试证明：

- Contract拒绝Proxy、开放字段和超过512 KiB的请求；
- Preview递归冻结、零Event写入、零Claim，并且前后公共Controller Route逐字段相同；
- 错误Plan digest稳定映射为`apply/plan/eventAuthority:unchanged`；
- exact Apply追加原Preparation Event，返回`eventAuthority:current`并把Route推进到
  `implementation-host-effect-claim`；
- 相同Apply幂等重试不增加Event或Claim；
- 真实Claim Event把当前Aggregate推进到`host-effect-claimed`后，晚到Preparation重放仍返回原revision 3与原state digest；当前Route则
  正确位于revision 4的`implementation-host-effect-execution`；
- 全部成功结果均不包含workspace root或fixture raw handle；固定宿主和missing root拥有稳定错误。

```text
Focused Preparation public wire/Coordinator + Service + Claim + Route:
  18 pass / 0 fail / 0 skip
TypeScript: pass
Prettier: pass
Architecture: pass / parser=swc / 619 modules / 4441 dependencies / 0 violations
Schema: pass / 75 schemas / 207 external refs
Schema digest: sha256:527e984319ea3760c077c1e28941e8bc8d920ac47befeee38dc6b3b737a0908e
git diff --check: pass
```

本单元仍未注册MCP，因此`wakeflow_prepare_implementation_delivery`尚不能被Agent调用；也没有运行旧JS、完整TS、plugin
validator/smoke或`npm test`。下一单元只应把既有Coordinator注入公共MCP Server与Codex/Claude固定composition roots，验证官方SDK
input/output、错误脱敏、annotations、双宿主一致和真实Route推进。完成后按约定立即进入业务骨干收束检查点，不继续实现Claim公共工具。

### 210.11 官方MCP注册与风险语义

`wakeflow-public-mcp-server.ts`新增required unary executor `prepareImplementationDelivery`。Server options仍执行字段集合关闭、普通函数与
Proxy拒绝；缺失、额外或代理executor在创建MCP Server时失败，不形成运行时可选handler registry。

第五项工具固定为：

```text
name: wakeflow_prepare_implementation_delivery
title: Prepare Wakeflow Implementation Delivery
input/output: exact self-contained v1 Schema
annotations:
  readOnlyHint: false
  destructiveHint: false
  idempotentHint: true
  openWorldHint: false
```

工具整体不是read-only，因为Apply追加Event；它不删除或覆盖资源，因此不是destructive。Preview无副作用，exact Apply重复调用不会产生
新增effect，因此工具级idempotent成立。它只访问本地已配置权威，不调用外部宿主或网络能力，因此保持closed-world。

Server instructions要求只有当前Route选择`implementation-delivery-planning`时才进入Preparation，先审阅完整Intent和portable prompt，
再Apply同一Plan与digest；同时明确Apply不取得Claim、不授权host effect且不发送消息。Handler只传递SDK已准入request，并返回Canonical
JSON text与structuredContent。Contract/Coordinator错误只公开稳定code/reason/path/cause与`eventAuthority`，未知异常收敛为
`wakeflow-unexpected`。

### 210.12 双宿主固定组合与候选制品闭包

新增两个极小Host composition wrapper：

- `codex-wakeflow-target-delivery-preparation.ts`固定Codex Resource/Identity Profile；
- `claude-code-wakeflow-target-delivery-preparation.ts`固定Claude Code Resource/Identity Profile。

公共请求没有host selector。Codex/Claude MCP根只注入各自一元executor；两个新入口显式加入entrypoints TS project file list。该形态与现有
Window Binding composition一致，没有把具体Host依赖下沉到共享Delivery Coordinator。

候选制品复核发现原artifact stdio测试仍只断言Maintenance、Task Planning和Binding三项，先前Controller Route接入后没有同步该真实
consumer，因而完整candidate gate会失败。测试已直接修正为五项精确工具集合，同时包含Controller Route与本Preparation；没有
增加兼容分支或放宽为“至少包含”。两份候选artifact继续由静态ESM闭包构造，各自只带本宿主Identity执行文件，官方stdio Client均成功
列出相同五项工具。

### 210.13 MCP真实纵切与收束停点

官方InMemory MCP Client与真实Codex composition验证：

- tools/list精确五项，Preparation input/output Schema ID正确且无external URN；
- annotations完整，description明确不创建WindowWorkClaim；
- SDK在executor前拒绝额外`hostAction`字段；
- structuredContent与Canonical text逐字段一致；
- 真实Codex workspace先由Route返回Delivery Planning，MCP Preview零Claim，Apply返回committed并推进Route到Host Effect Claim；
- exact Apply重试返回idempotent且仍不创建Claim；
- 成功结果不包含workspace root或raw handle；
- Coordinator `eventAuthority:unknown`与稳定Event Store cause进入脱敏错误envelope，不回显请求root或stack；
- Codex与Claude Code source composition以及两份stdio候选artifact均列出相同五工具集合；
- Maintenance、Route、Task Planning与Binding现有MCP路径保持通过。

```text
Focused public MCP + Preparation + dual-host artifact candidates:
  27 pass / 0 fail / 0 skip
TypeScript: pass
Prettier: pass
Architecture: pass / parser=swc / 621 modules / 4461 dependencies / 0 violations
Schema: pass / 75 schemas / 207 external refs
Schema digest: sha256:527e984319ea3760c077c1e28941e8bc8d920ac47befeee38dc6b3b737a0908e
git diff --check: pass
```

Preparation公共纵切至此从领域Service、wire、Contract、Coordinator、官方MCP、双宿主source composition一直闭合到候选artifact。它尚未
同步正式`plugins/`制品、安装cache或发布版本，因此不能声称当前安装的Wakeflow已有该工具。

按照用户确认的路线，当前已经到达业务骨干收束检查点。下一步不是实现`wakeflow_claim_target_host_effect`，而是审阅当前大型未提交
业务波次、执行完整TS source-manifest测试、Schema/Architecture、双宿主candidate/stdio、零consumer与测试重复检查，并形成新的当前
checkpoint事实；旧JS/plugin validator/smoke与正式`npm test`是否进入本检查点，应先按“TS开发门还是release门”重新确认范围。

## 211. TypeScript业务骨干收束核实节点

### 211.1 范围与独立checkpoint

用户确认执行TS开发收束门，不进入旧JS、正式plugin validator/smoke、release或Claim实现。新增独立历史节点：

- [TypeScript Business Skeleton Consolidation Gate](./wakeflow-typescript-business-skeleton-consolidation-gate-2026-09-01.md)

该文档记录当前架构、14类Event、五项公共MCP、内部业务链、规模、测试成本、生产叶子、candidate与能力缺口；不改写2026-08-28的
Technical Skeleton历史节点。

### 211.2 完整测试发现与清理

从删除后的可丢弃`.build/tests`开始，使用`tsc --force`按当前198份`.test.ts`源重新构建。首次完整运行结果为835/838，三项失败都来自
Maintenance Transaction测试仍复制新增Shared Coordination Layout之前的14步与固定数组位置。

实现与Preview/Step Executor已正确拥有15步，因此只修正陈旧测试：回执数量改为与不可变Plan长度闭合，崩溃注入按
`core:active-layout` stepId定位并执行全部前置Plan步骤。相邻21项通过后，完整门重新运行：

```text
TypeScript source-manifest tests:
  838 pass / 0 fail / 0 cancelled / 0 skip
  duration 216.84971075s
```

本轮没有删除必要的CAS、并发、Claim释放或崩溃恢复测试。当前慢项集中在产品缺陷、Test、Completion与Maintenance真实磁盘纵切；后续只
能通过共享前缀或减少重复初始化优化，不能降低证据等级。

所有本轮变更/新增的手写TS与JSON已统一Prettier，排除generated、历史文档、旧JS/plugin与外部Atlas；静态门和MCP/artifact聚焦回归在
格式化后再次通过。

### 211.3 生产叶子与架构结论

`src`生产图共有22个零`src` dependent文件：2个artifact roots、12个待公开业务owner、8个技术恢复/Artifact owner。全部有直接测试和
明确职责，没有匿名placeholder；当前不删除，但业务owner只能按Route逐项接线，技术owner在首个真实consumer处再次决定接入或删除。

Governance无具体Host import、子进程、tmux或Git CLI调用；真实宿主效果仍属于Agent。依赖图无循环，Foundation不再横向扩展。

```text
Node: v24.19.0
TypeScript: pass
Architecture: parser=swc / 621 modules / 4461 dependencies / 0 violations / 0 cycles
Schema: 75 / 207 refs
Schema digest: sha256:527e984319ea3760c077c1e28941e8bc8d920ac47befeee38dc6b3b737a0908e
Prettier changed/new TS+JSON: pass
git diff --check: pass
Candidate stdio: Codex pass / Claude Code pass / exact five tools
```

最终candidate manifest：Codex 317 compiled files，digest
`sha256:07f80120c1a877fbb0b8358a65fac6e5b33c291f62ff36a196996d9568c12bbc`；Claude Code 322 files，digest
`sha256:126600fc8869826d323853eff9bb613b87d8990bbfa973c0c9de9f6e49294d1a`。两者仍为`releaseEligible:false`。

### 211.4 仓库与下一停点

当前`HEAD`仍为`8e0be68`，分支ahead 7；大型业务波次未提交。外部`wakeflow-architecture-atlas/`与历史Technical Skeleton Gate的预先异常
diff不属于本checkpoint，任何提交前必须排除。

下一步只进入`wakeflow_claim_target_host_effect`公共边界讨论，先比较Implementation/Test共用范围、Host Observation、瞬时Action、
raw-handle/privacy、双authority错误和Agent执行停点；用户确认方案后才能编码。

## 212. Target Host Effect Claim公共边界预审

### 212.1 当前共享owner与用户决定

现有`TargetHostEffectClaimService`已经同时拥有Implementation与Test Claim：两者共用WindowWorkClaim Store、
`delivery.target-host-effect-claimed` Event、跨Demand窗口排他、Claim→Event前向恢复与`claimAuthority/eventAuthority`双轴错误。Test只增加
`testAttemptId + testDispatchPacketDigest`来源闭包及专用Action投影。Controller Route也把Implementation/Test Claim指向同一owner。

因此比较三条路线：

- A：一个`wakeflow_claim_target_host_effect`，使用`workType`严格判别联合；
- B：当前只公开Implementation，Test以后升级wire；
- C：拆成Implementation/Test两个重复Claim工具。

用户确认A：第一版公共工具同时支持两个已经存在的真实变体，不建立Test placeholder，不复制Claim事务，也不把宿主发送合入Wakeflow。

### 212.2 Observation、一次性Action与标准校准

公共请求必须携带Agent刚从宿主能力取得的完整瞬时Observation，包括opaque raw handle、Binding ID、configured logical root声明和
`observedAt`；Wakeflow用当前Host Identity Profile准入，再与私有Binding和Config topology精确闭合。raw handle只参与内存中等值比较，
不能进入Claim、Event、Action结果或错误。

Claim固定顺序为：

```text
validate fresh Observation
→ create durable cross-Demand WindowWorkClaim
→ revalidate Config / Binding / Intent / optional Test packet
→ build transient Agent Host Action
→ append claimed Event
→ return Action only when this call first commits the Event
```

已提交重放返回`already-claimed + action:null`。如果Event已提交但MCP首次响应丢失，重试不能重签Action；没有host send idempotency key时，
重签会把未知“是否已经发送”变成潜在重复副作用，因此进入显式人工/恢复阻断。

[MCP 2025-11-25 Schema](https://modelcontextprotocol.io/specification/2025-11-25/schema)明确`idempotentHint`只描述重复调用是否产生额外环境
effect，annotations本身不是安全机制；[AWS callback task](https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html)把外部
worker effect与带token的结果回传分开；[Microsoft Durable Task](https://learn.microsoft.com/en-sg/azure/azure-functions/durable/durable-functions-types-features-overview)
说明Activity可能至少执行一次，因此副作用必须按幂等方式设计。这些标准支持持久Claim + 分离Outcome，而不支持Claim工具内部自动发送。

TencentDB-Agent-Memory的`WorkerPermitPool`只是在进程内执行FIFO acquire/release，并由Pipeline Worker在`finally`中归还；它不能保存
跨进程Claim/Event或崩溃后的unknown effect，因此只借鉴显式配对原则，不复用其内存信号量结构。

### 212.3 公共合同草案

Request使用一个self-contained判别联合：

```text
Implementation:
  root / workType=implementation
  demandId / targetTaskId / targetDeliveryId / intentDigest
  observation

Test:
  上述字段
  workType=test
  testDispatchPacketDigest
```

Result区分：

- `issued/committed`：最小Claim摘要、Event/Commit回执、post-claim state digest与Implementation/Test Action；
- `already-claimed/idempotent`：同一Claim/Event回执，`action:null`，明确禁止发送。

Action中只允许最终prompt携带JSON编码的canonical workspace root；raw handle仍不返回。Outcome后续可从Action取得`actionId`、
Host Observation authority digest、Target身份以及Test attempt/packet tuple。

工具annotations建议为`readOnly:false / destructive:false / idempotent:true / openWorld:false`；Claim是本地additive effect，真实宿主调用仍由
Agent执行。MCP task execution保持默认forbidden，因为Claim必须是立即返回的一次效果栅栏，不是后台长任务。

### 212.4 Action词汇修正

用户同时确认把容易被Controller误解为“调用者当前窗口”的：

```text
send-message-to-current-window
```

统一改为：

```text
send-message-to-observed-target-window
```

已同步`TargetDeliveryAgentHostAction`与`TestDeliveryAgentHostAction`两个内部合同及构造器，并在Implementation/Test真实Claim Service测试中
增加exact effect断言。没有保留alias、兼容值或双分支；新TS尚未发布，不需要版本迁移。

```text
Focused Implementation/Test Claim + Outcome:
  17 pass / 0 fail / 0 skip
TypeScript: pass
Prettier: pass
Architecture: pass / parser=swc / 621 modules / 4461 dependencies / 0 violations
Schema: unchanged / 75 schemas / 207 refs
Schema digest: sha256:527e984319ea3760c077c1e28941e8bc8d920ac47befeee38dc6b3b737a0908e
git diff --check: pass
```

下一单元只创建共享Claim request/result self-contained Schema、generated types和轻量Schema测试；不创建Contract、Coordinator、MCP注册或
宿主调用。

### 212.5 共享Claim Request Schema

新增`wakeflow-target-host-effect-claim-request.schema.json`，顶层只有一个Implementation/Test `oneOf`：

- Implementation要求`root/workType/demandId/targetTaskId/targetDeliveryId/intentDigest/observation`；
- Test要求上述字段并额外要求`testDispatchPacketDigest`；
- Implementation不能携带Test字段，Test不能省略packet digest；
- 两者共享完整瞬时`WakeflowAgentHostWindowObservation`，包括host/window/binding、opaque handle、logical root、configured placement和
  observedAt；
- raw handle字段明确标记为request-only secret，Schema关闭其kind/value容量和控制字符，但不把具体Codex/Claude handle格式写入共享wire；
  当前Host Identity Profile继续在Coordinator/Service层收紧。

Request Schema在同一文档本地关闭program/support-surface/repository logical root、placement、Host、UTC、SHA-256和typed IDs，零external
URN；它不判断窗口role、当前Binding、handle相等、root匹配或五分钟freshness，这些仍属于现有Authority/Service。

### 212.6 Claim Result Schema与一次性Action关系

新增`wakeflow-target-host-effect-claim-result.schema.json`。公共结果不返回完整内部Command/Aggregate或WindowWorkClaim，只返回：

```text
kind / schemaVersion / tool
status / disposition
claimAuthority=current / eventAuthority=current
minimal normalized Claim summary
Event / Commit receipts
post-Claim event stateDigest
action
```

Claim摘要显式规范化`target.workType=implementation|test`，避免沿用内部Implementation历史记录省略判别字段的持久兼容形态。Test摘要额外
携带`testAttemptId + testDispatchPacketDigest`。

Schema固定两层关系：

1. `issued → committed + non-null Action`；`already-claimed → idempotent + action:null`；
2. Implementation Claim只能配Implementation Action或null，Test Claim只能配Test Action或null。

两个Action都使用已确认的`effect:send-message-to-observed-target-window`。Implementation Action携带Claim/Observation/Event tuple与最终
prompt；Test Action再增加attempt与target-facing packet ref/digest。Action prompt有明确上限；result结构没有raw handle字段。canonical
workspace root只允许后续Coordinator在`issued.action.prompt`的精确位置通过，Schema本身不能判断字符串中哪段是私密路径。

跨字段相等关系——claim/action ID、route、digest、issuedAt、Event state digest——也继续留给Coordinator从真实Service结果投影和复验，
不在JSON Schema伪造data equality能力。

生成两份类型/runtime Schema后，通用MCP self-contained测试补充Claim request/result的SHA、UTC、Host和ID词法漂移检查，并要求公共
Observation字段集合与领域瞬时Observation一致。轻量测试使用纯wire fixture验证：

- 两种Request均准入且互斥；
- raw handle词法错误与额外hostAction被拒绝；
- Implementation/Test issued结果均准入；
- replay只有`action:null`有效；
- 旧effect、跨workType Action、额外handle字段被拒绝。

```text
Focused Claim public wire + MCP self-contained:
  3 pass / 0 fail / 0 skip
TypeScript: pass
Prettier: pass
Architecture: pass / parser=swc / 624 modules / 4464 dependencies / 0 violations
Schema: pass / 77 schemas / 207 external refs
Schema digest: sha256:9f88b130c3f204ad8d1050283dd660ee1af53fd5780898880607f369feb41ad9
git diff --check: pass
```

本单元没有打开workspace、创建Claim、生成真实Action、注册MCP或调用宿主。下一单元应成对实现
`target-host-effect-claim-public-contract.ts`与`target-host-effect-claim-public-coordinator.ts`，重点闭合request容量、固定Host facade、
Service错误双authority、issued prompt的唯一root例外、raw handle全输出禁入、最小Claim/Event/Commit投影和late replay不重签Action。

### 212.7 Public Contract与固定Host Coordinator

新增`target-host-effect-claim-public-contract.ts`：

- 唯一工具名Authority为`wakeflow_claim_target_host_effect`；
- 请求在打开workspace前完成passive JSON、Canonical UTF-8 128 KiB容量与self-contained Schema准入；
- 返回递归冻结的Implementation/Test联合，不解释Observation或Claim业务关系；
- 错误稳定区分`json/capacity/schema`并保留path，不回显请求内容。

新增`target-host-effect-claim-public-coordinator.ts`。composition root必须注入冻结、一致且支持Window Identity的
`hostId + Resource Profile + Identity Profile`；请求不能选择宿主，Observation host也必须等于固定facade。

调用顺序为：

```text
assert fixed Host facade
→ parse bounded request
→ open RootedDirectory
→ call shared TargetHostEffectClaimService
→ verify exact Claim/Event/Commit/Action relations
→ project normalized public Claim summary
→ validate 512 KiB result Schema and privacy boundary
→ close root without swallowing a unique issued Action
```

Public Claim摘要不返回完整WindowWorkClaim、Command或Aggregate；Implementation历史持久Claim虽省略`workType`，公共投影统一补为
`implementation`，Test保持`test + attempt + packet digest`。Event/Commit回执来自精确Claim Commit，`stateDigest`使用该Event记录的
resulting state，不使用可能后来推进的current Aggregate。

Coordinator逐项复验：Commit ID、Demand、command digest、expected revision、单Event范围、Event type、Event内完整Claim字节、Action/Claim
身份、route、workClaim、issuedAt与Claim Event tuple。Test Action还必须匹配Claim的attempt和packet digest。任何投影关系漂移都以
`output + claimAuthority:current + eventAuthority:current`失败，不能发布半可信Action。

### 212.8 一次性Action隐私与关闭语义

成功输出边界固定为：

- raw handle value不能出现在任何结果字符串中；
- caller root与canonical root不能进入普通字段；
- `issued`时canonical root只允许作为`$/action/prompt`最后一段JSON编码导航行；
- prompt正文不能提前复制caller/canonical root；
- `already-claimed`没有Action，因此结果任何位置都不能出现root；
- macOS可能把`/var/...`固定为`/private/var/...`，扫描先验证精确canonical prompt后缀，再允许该后缀自然包含系统别名；其它位置仍拒绝。

实现复审还关闭了唯一Action被本地cleanup吞掉的风险：Service成功形成`issued`结果后，如果Coordinator关闭只读RootedDirectory失败，不能
把唯一Action替换为root错误，因为Claim/Event已经current且重试不会重签。issued结果优先返回；`already-claimed`或尚未形成结果时，关闭
失败仍按双authority报告。

真实聚焦测试覆盖：

- Contract冻结、Proxy与超128 KiB请求；
- 非冻结Host facade、missing root、过期Observation及双unchanged错误；
- Implementation首次issued、Route进入`implementation-host-effect-execution`、重放action null；
- Test首次issued、packet/attempt投影、Route进入`test-host-effect-execution`、重放action null；
- issued root路径只位于Action prompt，重放零root；两种结果都零raw handle；
- 内部Implementation/Test Claim Service前向恢复和竞争场景保持通过。

```text
Focused Claim Public Coordinator + wire + Implementation/Test Service:
  14 pass / 0 fail / 0 skip
TypeScript: pass
Prettier: pass
Architecture: pass / parser=swc / 627 modules / 4488 dependencies / 0 violations
Schema: pass / 77 schemas / 207 external refs
Schema digest: sha256:9f88b130c3f204ad8d1050283dd660ee1af53fd5780898880607f369feb41ad9
git diff --check: pass
```

本单元没有注册MCP或执行宿主发送。下一单元只把现有Coordinator注入Public MCP Server与Codex/Claude固定composition wrappers，验证
官方SDK、双authority错误、一次性Action、双宿主五→六工具集合和candidate stdio；完成后再进入Outcome公共边界预审。

### 212.9 Claim MCP注册与公共错误投影

`wakeflow-public-mcp-server.ts`现已把`wakeflow_claim_target_host_effect`注册为第六个公开源码候选工具。注册直接使用已闭合的
self-contained request/result Schema，不创建第二套wire类型；server options只接受必需的一元Claim executor，并继续拒绝Proxy、未知
配置字段和缺失owner。

工具元数据固定为：

```text
readOnlyHint: false
destructiveHint: false
idempotentHint: true
openWorldHint: false
```

这里的`idempotent`只表示同一Claim重放返回`already-claimed + action:null`，不表示Agent可以重复执行首次取得的Action。MCP错误投影在现有
`stateAuthority/eventAuthority`之外增加`claimAuthority`，精确保留Service/Coordinator对Claim记录、Event结果和Commit不确定性的区分；
错误结果仍禁止回显workspace root、opaque handle、请求正文和stack。

### 212.10 双宿主composition与真实stdio验证

新增Codex与Claude Code两个极薄的Claim composition wrapper。每个wrapper只冻结本宿主的host ID、resource profile与identity profile，
然后调用同一个`claimTargetHostEffect`公共Coordinator；公共Server不根据请求或字符串分支判断宿主。

两个MCP composition root都必须注入Claim executor，entrypoint编译清单和候选制品可达闭包同步纳入新wrapper。候选测试证明两个入口通过
官方stdio Client发布完全相同的六工具集合；没有修改旧JS入口、插件制品或已安装缓存。

真实Codex MCP测试从隔离fixture依次完成：

```text
Preparation把Route推进到Claim
→ 首次Claim提交事件并返回issued Action
→ Route推进到Agent Host effect边界
→ 同一请求重放返回already-claimed + action:null
```

测试只检查Action合同，没有把prompt发送给真实Codex/Claude窗口。SDK还在进入executor前拒绝额外`sendNow`字段，并验证成功与失败输出都
不包含raw handle；workspace root只允许出现在首次issued Action prompt的既定后缀。

### 212.11 开发中间态与下一边界

六工具源码候选不是可发布的端到端Delivery能力。当前公开面能够原子记录Claim并签发一次性Action，但尚未公开对应的Outcome记录入口；
如果Agent现在执行真实宿主发送后丢失响应，公共MCP链路还没有标准方式提交`observed`或显式进入recovery。因此，在Outcome公共owner完成并
通过真实Claim→Agent effect→Outcome协议测试前：

- 不把该候选描述为release-ready；
- 不刷新插件缓存或发布制品；
- 不在源码测试之外执行真实宿主发送；
- 不为规避缺口而重签Action、自动发送或把Outcome塞回Claim工具。

```text
Focused MCP registration + candidate artifacts after formatting:
  25 pass / 0 fail / 0 skip
TypeScript: pass
Prettier: pass
Architecture: pass / parser=swc / 629 modules / 4504 dependencies / 0 violations
Schema: pass / 77 schemas / 207 external refs
Schema digest: sha256:9f88b130c3f204ad8d1050283dd660ee1af53fd5780898880607f369feb41ad9
git diff --check: pass
```

下一单元进入Target Host Effect Outcome公共边界预审：先核对Implementation/Test内部Outcome Service、Event语义、恢复分支与旧JS真实场景，再给出
共享工具、分离工具或暂不公开的候选方案；在用户确认前不直接实现。

## 213. DELIVERY-005-PUBLIC（Target Host Effect Outcome公共边界预审）

### 213.1 当前内部owner与旧JS差异

当前TS已经有一套由Implementation与Test共享的内部`TargetHostEffectOutcomeService`。它从
`delivery.target-host-effect-claimed` Event恢复Action权威字段，把Agent提供的宿主attempt与最多一次readback转换为只含摘要的
`TargetDeliveryHostEffectObservation`，再以稳定Action/Claim身份幂等追加唯一
`delivery.target-host-effect-observed` Event。`accepted | indeterminate`保留Claim；只有
`rejected-before-effect + unavailable readback`在Event提交后获得精确释放Claim的权限。

现有真实聚焦测试基线：

```text
Implementation/Test Outcome Service:
  8 pass / 0 fail / 0 skip
```

旧JS的`wakeflow_record_delivery`同时路由`target-outcome`与`controller-outcome`，请求还要求Agent填写
`stateRoot/targetTaskId/deliveryId/sendGeneration/hostMethod/hostMode/transportStatus`。该大工具和多项调用者声明不再作为TS标准；旧代码只证明
真实场景需要“宿主调用完成后，单独记录观察结果”。

TencentDB-Agent-Memory的`pending-writes.ts`允许在无idempotency key时重试L0写入，并明确接受少量重复，因为下游按hash去重且其业务取舍是
“宁可重复也不丢”。Wakeflow向Agent窗口发送prompt可能重复执行代码、测试或环境操作，代价模型不同；因此不能复制其自动重试方案，但可以保留
它把重试条件、attempt次数和重复风险写清楚的注释方式。

### 213.2 公开化前发现的权威状态错误

当前Service在Outcome Event成功提交后才释放`rejected-before-effect` Claim；这一顺序正确。但如果释放阶段抛出
`WindowWorkClaimStoreError`，外层catch固定构造：

```text
eventAuthority = unchanged
```

这会把“Event已经current、Claim结算失败或未知”错误描述成“Event未变化”。同一错误也会出现在已结算replay的Claim检查失败路径。它不影响现有
八项成功/幂等测试，却会误导公共调用方决定恢复动作，属于Outcome公开化前必须先修正的真实正确性问题。

修正应显式跟踪两个阶段：

```text
Claimed Aggregate且尚未append             -> eventAuthority=unchanged
已结算Aggregate replay或append成功返回     -> eventAuthority=current
append调用无法证明是否提交                -> eventAuthority=unknown
```

必须增加“Observed Event已存在/已提交，但Claim精确释放失败”的故障测试；不能只修改错误常量，也不能把它伪装成回滚。

### 213.3 标准证据对边界的约束

[RFC 9110 §9.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2)只允许在已知请求语义幂等或能证明原请求未应用时自动重试非幂等
请求。[AWS Builders' Library](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)也用无响应后的singleton创建说明：调用方不能
判断外部效果是否发生，直接重试可能产生第二个效果。因此Claim重放继续不重签Action；Outcome只记录`indeterminate`，不把未知变成拒绝或自动重发。

[Azure Event Sourcing](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)要求事件表达已经发生的领域事实、保持append-only，且重复
消费必须幂等。当前`target-host-effect-observed` Event、Action ID派生Commit身份和同参数重放符合这一方向；Claim文件释放是Event后的本地结算，不能
替代或修改已提交事件。

[MCP 2025-11-25 Schema](https://modelcontextprotocol.io/specification/2025-11-25/schema#toolannotations)明确：
`destructiveHint=false`只适用于纯additive更新；`idempotentHint=true`表示相同参数重复调用没有额外效果；短操作默认
`taskSupport=forbidden`。由于rejected Outcome可能精确删除Claim资源，公共Outcome工具应保守声明
`readOnly:false / destructive:true / idempotent:true / openWorld:false`；它只修改本地Wakeflow闭域记录，不执行外部宿主调用。

### 213.4 已可确定的公共结构

无需再引入多路大工具或分开的Implementation/Test Outcome工具。建议固定：

```text
wakeflow_claim_target_host_effect
  -> 只持久Claim并首次签发一次性Action

Agent调用当前宿主工具并做最多一次有界readback

wakeflow_record_target_host_effect_outcome
  -> 只记录已经观察到的双轴事实
```

Outcome使用同一个公共工具、同一个内部Service和同一个Observed Event family；stored Claim决定Implementation/Test。Codex与Claude Code只提供冻结
的当前host ID，Coordinator复验Claim route属于当前入口，不解析raw handle，也不重新验证效果后的Binding。工具结果投影digest-only Observation、
Event/Commit回执、post-event state digest与Claim结算状态；不返回raw evidence、workspace root、prompt、完整Command/Aggregate或stack。

Outcome是立即完成的本地Event append/Claim settlement，不启用MCP task execution。第七工具仍只是TS源码候选；本单元不顺带公开Rearm、TargetResult
或Controller Review。

### 213.5 需要用户确认的请求选择

第一项是公共请求重复多少Claim权威字段：

| 方案 | 公共selector | 评价 |
| --- | --- | --- |
| A（推荐） | `root + demandId + actionId + claimDigest` | 只让调用者选择历史Claim并证明拿到精确Claim回执；workType、Task/Delivery、Host observation与Test tuple全部由stored Claim Event派生，字段最少且不会把调用者声明当authority |
| B | 保持当前内部请求，额外要求workType、Task/Delivery、Host observation digest及Test attempt/packet | 多重echo可以发现调用者抄错字段，但模型调用成本高，且这些值最终仍必须被Event覆盖 |
| C | 回传完整一次性Action | 复制prompt与workspace root，扩大隐私面，也容易让replay Action被误当成再次发送权限；不建议 |

第二项是Evidence摘要由谁计算：

| 方案 | Evidence输入 | 评价 |
| --- | --- | --- |
| 1（推荐） | Agent提交最多128 KiB的被动JSON attempt/readback evidence，Wakeflow计算Canonical SHA-256后立即丢弃原值 | 摘要一定对应本次提交的精确JSON；延续现有内部合同，不把raw值写入Event或结果 |
| 2 | Agent只提交两个digest | 请求更小，但Wakeflow无法证明digest对应Agent刚观察到的对象，错误摘要也会永久进入Event |
| 3 | 持久化raw evidence | 扩大append-only隐私与兼容负担，违反当前最小Event设计；不建议 |

推荐选择`A + 1`。确认后按以下顺序逐文件实施：

```text
1. 为eventAuthority故障路径补测试并修正内部Service
2. 将内部Outcome selector收敛到Claim ID + Claim digest，由stored Event派生其余字段
3. 新增self-contained request/result Schema与轻量wire测试
4. 新增Public Contract + fixed-host Coordinator及真实Event/replay/隐私测试
5. 注入Codex/Claude composition、注册第七工具、验证官方stdio Client与候选闭包
6. TypeScript / architecture / Schema / formatting / diff门禁并更新台账
```

本预审没有修改Outcome生产代码、Schema、MCP注册或宿主行为。

### 213.6 用户决定与内部Outcome收敛

用户确认采用`A + 1`。内部`TargetHostEffectOutcomeRequest`现只接受：

```text
demandId + actionId + claimDigest
+ attempt(status + raw bounded JSON evidence)
+ readback(status + optional raw bounded JSON evidence)
+ observedAt
```

已删除调用者重复声明的`workType/targetTaskId/targetDeliveryId/hostObservationAuthorityDigest/testAttemptId/
testDispatchPacketDigest`。所有Implementation/Test、Task/Delivery、Host observation和Test packet lineage都从按`actionId`定位的stored Claim Event派生，
并由`claimDigest`证明调用者持有精确Claim回执。全部真实内部consumer及fixture已直接切换新形状，没有alias、兼容parser或双分支。

固定Host也不进入请求。`TargetHostEffectOutcomeService`由composition注入当前`codex | claude-code`，Outcome Authority在Event append前复验
stored Claim route；另一宿主不能替当前宿主记录观察。内部成功结果携带已审计Claim供公共Coordinator投影，但公共结果不返回完整Claim。

### 213.7 Event authority错误的完整修正

原Service在WindowWorkClaim Store错误中固定报告`eventAuthority=unchanged`。现改为从Aggregate阶段开始显式保持：

```text
host-effect-claimed / test-host-effect-claimed -> unchanged
accepted / indeterminate / rejected settled    -> current
append无法确认                                  -> execute owner报告unknown
```

该权威状态同时附着在Outcome Authority错误上，因此以下两类失败都不会再伪装成未写入：

- Observed Event已提交后，Claim结算目录不可安全读取；
- 已结算replay携带错误Claim digest或来自另一Host。

新增真实POSIX目录模式故障测试先提交rejected Observation Event，再使Claim根不满足`0700`准入；结果精确为
`claimAuthority=unknown + eventAuthority=current`。恢复目录模式后，相同请求只幂等确认Event并完成Claim释放。accepted settled replay的错误
Claim digest也明确保持`eventAuthority=current`。

### 213.8 公共wire、Contract与fixed-host Coordinator

新增self-contained：

- `wakeflow-target-host-effect-outcome-request.schema.json`；
- `wakeflow-target-host-effect-outcome-result.schema.json`；
- 对应两份生成类型/runtime Schema。

Request Schema只有已确认的最小selector和双轴Evidence。Public Contract在打开workspace前执行passive JSON、Schema、384 KiB总请求容量，以及
attempt/readback各128 KiB Canonical容量准入。raw evidence只在调用期参与Canonical SHA-256，随后不进入Event、结果或错误。

Result Schema只公开：

```text
recorded | already-recorded
committed | idempotent
effectDisposition / claimHandling / claimAuthority / eventAuthority
stored-Claim-derived target summary
actionId + claimDigest
digest-only observation summary
Observed Event / Commit receipts + resulting state digest
```

Schema关闭以下关系：

- recorded只能配committed；already-recorded只能配idempotent；
- accepted只能来自accepted attempt，或`indeterminate + confirmed readback`；
- indeterminate只能配`pending | unavailable`并保留Claim；
- rejected-before-effect只能配unavailable readback、release-authorized和released Claim；
- raw evidence、root、prompt、handle及任意额外字段都不能进入结果。

Public Coordinator逐项复验Claim/Observation Action、Host、Test tuple、Observed Event/Commit ID、单Event范围、command digest、event bytes、commit digest和
post-event state digest。Codex与Claude Code各自只有一个`{hostId}`冻结wrapper；共享Coordinator不导入具体宿主Profile，也不解析raw handle。

### 213.9 第七个官方MCP工具与候选制品

Public MCP现注册：

```text
wakeflow_record_target_host_effect_outcome
```

它与Claim保持明确的Agent effect seam：

```text
Claim首次返回一次性Action
-> Agent最多执行一次宿主调用并做最多一次有界readback
-> Outcome只记录已经观察到的事实
```

工具annotations按MCP标准保守声明为：

```text
readOnlyHint: false
destructiveHint: true
idempotentHint: true
openWorldHint: false
```

`destructive:true`来自rejected Outcome可能精确删除当前Claim文件；事件本身仍是append-only。MCP instructions明确
`accepted/indeterminate/pending/unavailable`都不授权再次发送，只有proved rejected-before-effect可以释放Claim，后续仍需显式owner。

Codex与Claude Code composition root、entrypoint编译清单、候选可达闭包和官方stdio工具集合已从六个同步变为七个。候选manifest继续
`releaseEligible:false`；没有修改旧JS/core、插件制品或安装cache。

### 213.10 验证与下一核实点

```text
Internal Outcome authority/selector:
  9 pass / 0 fail / 0 skip
Public Outcome Coordinator + wire:
  5 pass / 0 fail / 0 skip
MCP server + dual-host candidate stdio + self-contained wire:
  28 pass / 0 fail / 0 skip
Adjacent Rearm / Result / Delivery / Route / Review consumers:
  40 pass / 0 fail / 0 skip
TypeScript: pass
Prettier: pass
Architecture: pass / parser=swc / 637 modules / 4548 dependencies / 0 violations
Schema: pass / 79 schemas / 207 external refs
Schema digest: sha256:3a7bb52444336a02d8fb24e80a7e9d094c441113e7a3d5d23ed83e0dbae49cb2
git diff --check: pass
```

真实MCP纵切只模拟Agent已观察到的宿主结果，没有调用Codex/Claude发送能力。未运行旧JS全量`npm test`、插件validator/smoke、发布、缓存刷新或
提交。

下一单元不直接选择Rearm或TargetResult实现。应先读取Outcome后的真实Controller Route矩阵，比较：

- accepted/indeterminate的Implementation TargetResult Import与Test Result Planning；
- rejected-before-effect的Implementation Rearm与Test replacement Delivery；

再从用户主路径、公共能力闭合度和共享基础owner角度决定下一公共纵切，避免按旧JS工具顺序继续。

## 214. Post-Outcome Route矩阵与下一公共纵切预审

### 214.1 Route的真实四分支

`DemandControllerRoute`与`DemandPostAcceptanceRoute`共同证明，Outcome后的业务路径不是“Rearm或Test Result二选一”，而是四个严格phase映射：

| Outcome后phase | 公共Route frontier | 真实owner | Claim状态 | 路径性质 |
| --- | --- | --- | --- | --- |
| `host-effect-accepted | host-effect-indeterminate` | `implementation-target-result-import` | `TargetResultImportService` | current | Implementation正常主路径 |
| `host-effect-rejected` | `implementation-host-effect-rearm` | `TargetHostEffectRearmService` | released | Implementation投递前拒绝恢复 |
| `test-host-effect-accepted | test-host-effect-indeterminate` | `test-target-result-import` | 同一个`TargetResultImportService` | current | Test正常主路径 |
| `test-host-effect-rejected` | `test-delivery-replacement-planning` | `TestDeliveryPreparationService` | released | 同一logical Test attempt的替代Delivery |

因此“Test Result Planning”不是另一套结果服务。Implementation与Test正常路径已经共享同一个Result Import owner、同一个
`result.target-result-recorded` Event family、同一Claim结算与Review历史；差异只存在于两份Agent Report和authority-enriched TargetResult的判别变体。

### 214.2 三个候选owner的当前成熟度

**TargetResult Import**

- 同时服务Implementation/Test accepted与indeterminate，是S3正常出口；
- 从TaskPackage、Intent、Claim、Observed Event，以及Test Card/packet恢复完整authority；
- 由Agent业务Report创建严格TargetResult，append Result Event后才释放Claim；
- Result的`completed | blocked | needs-review`仍是Agent陈述，不产生Controller acceptance；
- Result/Event/Commit身份均从Action/Claim身份稳定派生，精确重试幂等。

公开前仍需先修正：当前Request重复要求workType、Task/Delivery和Test tuple；settled replay的错误Report、Claim Store读取失败等路径仍可能把已存在
Result Event误报为`unchanged`；Service也尚未注入固定Host。其生产者边界必须明确为“Agent提交Report，Wakeflow生成完整TargetResult”，不能让
Controller重新填写authority-enriched Result。

**Implementation Rearm**

- 内部Service已完整实现rejected-only、旧Claim absent、当前Config/Binding、唯一Rearm Event与幂等重放；
- 只恢复同一Implementation Delivery到`delivery-prepared`，下一次必须取得全新Claim；
- 公共化表面相对较小，但当前Input同样重复Task/Delivery字段；
- 它只解决较少见的Implementation拒绝路径，不会释放正常accepted/indeterminate路径仍持有的Claim，也不能服务Test拒绝。

**Test Delivery Preparation**

- 同一Service拥有`initial | rerun | replacement-authorization`三种preview/apply模式；
- replacement只增加同一logical attempt的Delivery授权，rerun则创建新logical attempt并绑定Result/Review Decision；
- 上游TestCard Planning与Test Task Planning尚未公开，直接先公开该Service会形成无法从公共入口正常抵达的中段大工具；
- 当前生产模块约1500行、测试约730行，必须在完整Test公共路线中单独设计，不能为了补一个rejected分支提前暴露全部模式。

### 214.3 旧JS、官方实践与Tencent参考

旧JS在Outcome后正常调用独立`wakeflow_record_target_result`，而Rearm只是`wakeflow_prepare_delivery`中的一个异常operation。这个真实使用顺序可作为
场景证据；旧实现让调用者提交完整transport-bound TargetResult和大量echo字段的方式不应保留。新TS已有更标准的分层：Agent只陈述Report，
Wakeflow从Event authority生成完整TargetResult。

[Azure Event Sourcing](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)要求command handler先重放Event Stream、执行业务规则，再生成
表达业务事实的Event；这支持“Report是外部Command输入，TargetResult/Event由owner生成”，而不是让调用者提交最终Event记录。
[SLSA Provenance](https://slsa.dev/spec/v1.0/provenance)区分external parameters、system/internal parameters与resolved dependencies，并建议尽量把
boilerplate及可从输入Artifact推导的值设为隐式；对应到Wakeflow，Agent Report是external parameter，Task/Delivery/Claim/Test lineage是系统恢复的
internal authority，Evidence ref/digest是resolved来源。

[AWS幂等API指南](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)要求同一request identity配不同参数时明确拒绝mismatch，并让
重放返回语义等价结果。TargetResult ID由Action ID派生，Report内容digest承担同参数证明；不同Report不能借同一Action覆盖历史。
[MCP 2025-11-25 Schema](https://modelcontextprotocol.io/specification/2025-11-25/schema)支持严格input/output Schema与structuredContent；Result Import是一次
立即完成的本地Event/Claim结算，不应使用task execution。

TencentDB-Agent-Memory没有TargetResult或Event-sourced Controller路线。可借鉴的是它把客户端安全错误与完整内部日志分离，并只对天然幂等的clear操作
自动重试；这支持Wakeflow继续发布稳定脱敏错误和精确幂等重放。它不能决定Wakeflow Result、Rearm或Test replacement的owner顺序。

### 214.4 下一纵切的三种顺序方案

| 方案 | 下一项 | 收益 | 代价/结论 |
| --- | --- | --- | --- |
| A（推荐） | 先公开共享TargetResult Import | 同时闭合Implementation/Test正常路径；Result Event后释放长期持有的Claim；Route进入Controller Review；延续S3主流程 | Report Schema较丰富，必须先做selector、authority与生产者合同收敛，但这是必要复杂度 |
| B | 先公开Implementation Rearm | 文件和wire较小；可恢复明确拒绝的Implementation投递 | 只覆盖异常分支；正常路径仍停在Result Import；Test rejected仍不闭合 |
| C | 先公开Test Delivery Preparation | 可承接Test rejected replacement，并为未来initial/rerun铺路 | 上游TestCard/Task公共能力缺失；一次引入三种模式，过早扩大工具与测试表面，不建议现在做 |

三个方案代表下一步顺序，不是最终能力互斥。预计合理顺序为：

```text
TargetResult Import
→ Implementation Rearm
→ 按完整Test公共路线建设TestCard / Test Task / Test Delivery
```

### 214.5 推荐A的公共合同草案

工具名推荐：

```text
wakeflow_import_target_result
```

“import”比旧`record_target_result`更准确：调用者提交的是目标Agent Report，owner返回并持久化authority-enriched TargetResult。

推荐Request：

```text
root
demandId
actionId
observationDigest
report:
  workType: implementation | test   # 只作Report wire判别，不作为业务authority
  content: ImplementationReportContent | TestReportContent
```

stored Claim/Observation决定真实workType、Task、Delivery、repository/window、Test attempt/card/packet和Event来源；`report.workType`不匹配时拒绝。Request不再
接受这些echo字段，也不接受完整TargetResult、reportedAt、Result/Event/Commit ID或state digest。

推荐Result返回：

- `recorded | already-recorded`与`committed | idempotent`；
- `claimAuthority=released / eventAuthority=current`；
- 完整严格TargetResult；
- Result Event/Commit回执与post-event state digest。

公共化前的实施顺序建议：

```text
1. 给settled Result replay与Claim结算故障补双authority测试并修正Service
2. 把内部selector收敛到Action + Observation + discriminated Agent Report
3. 明确Report是Target作者输入；Wakeflow补齐reportedAt、authority与Result identity
4. 建立self-contained request/result Schema与隐私/容量合同
5. fixed-host Coordinator复验完整Result/Event/Commit并在Result Event后释放Claim
6. 注册第八工具并验证Implementation/Test真实导入、重放、Route→Review和双宿主候选
```

建议annotations：`readOnly:false / destructive:true / idempotent:true / openWorld:false`。`destructive:true`来自Result Event提交后精确释放Claim；
TargetResult/Event本身仍是append-only。Report只允许portable Evidence refs/digests和有界陈述，公共边界还应拒绝workspace absolute root、raw handle、
prompt、stack或秘密原文进入持久Result。

本预审没有修改Result、Rearm、Test Delivery生产代码、Schema、MCP或测试。等待用户确认是否采用`A`以及推荐的Report-only公共合同后，再开始第一项
内部authority修正。

### 214.6 用户决定与Report-only内部请求

用户确认采用方案A，并确认公开工具名为：

```text
wakeflow_import_target_result
```

内部`TargetResultImportRequest`已删除调用者重复提交的`workType`、Target Task/Delivery和Test attempt/packet字段，只保留：

```text
demandId
actionId
observationDigest
report:
  workType: implementation | test
  content: ImplementationReportContent | TestReportContent
```

`report.workType`只承担外部Report语法判别。真实Implementation/Test类型、TaskPackage、Delivery Intent、Host、repository/window、Test
Card/attempt/packet以及Result/Event身份全部由stored Claim、Observation和Event Stream恢复并重新闭合。所有内部真实consumer与fixture已直接切换新请求，
没有旧字段alias、兼容parser或双写分支。

### 214.7 settled replay、Claim结算与领域错误修正

Result Import现在同时读取Claim Event、Observed Event和可能已存在的Result Event，并在任何后续失败中保持两条独立权威轴：

```text
Result Event: unchanged | current | unknown
Claim: current | released | unknown
```

已闭合以下恢复事实：

- Result Event已存在时，不同Report、不同Observation digest或错误Host都报告`eventAuthority=current`，不会伪装为未写入；
- Event已提交而Claim仍存在时，精确重试只执行Claim释放，不追加第二个Result Event；
- Event已提交后Claim Store不可安全读取时，错误仍保留Event current；恢复文件权限后可继续前向结算；
- 固定Host在Event append前复验stored Claim route，Claude Code入口不能替Codex Claim导入Result，反之亦然；
- Claim只有在Result Event成功提交后才精确释放；无法证明属于本次Action的Claim不会被删除。

真实MCP纵切还发现一个此前聚焦fixture没有暴露的错误门面缺口：`implementation-target-result`和`test-target-result`在最后调用共享
`parseTargetResult()`时，时间关系等共享解析失败会泄漏原始`TargetResultError`，最终被MCP降级为`wakeflow-unexpected`。两类creator现都把该内部
解析失败封装成稳定的领域`relation`错误，并各补一项“Report时间必须严格晚于Host Observation”的轻量测试。MCP公开错误仍只返回稳定code/reason和
Event/Claim authority，不回显stack、root或Report原文。

### 214.8 self-contained wire与fixed-host Public Coordinator

新增两份self-contained公共Schema及其生成类型/runtime Schema：

- `wakeflow-target-result-import-request.schema.json`；
- `wakeflow-target-result-import-result.schema.json`。

Request只有workspace root、Demand/Action/Observation selector和判别式Agent Report。它不接受完整TargetResult、`reportedAt`、Task/Delivery/Test
lineage、Result/Event/Commit身份、Controller Decision或acceptance。Public Contract在打开workspace前完成passive JSON、2 MiB Canonical容量、严格
Schema和workspace-root隐私准入；Evidence只能使用portable ref与SHA-256 digest。

固定Host Coordinator调用共享Service后逐项复验：

- Claim、Observation、TargetResult和当前Host关系；
- Result ID、Result Event ID和Commit ID的确定性派生；
- 单Event commit范围、command digest、Event内Result字节、commit digest与post-event state digest；
- 请求Report content digest与最终TargetResult Report一致；
- 成功结果恒为`eventAuthority=current + claimAuthority=released`。

Public Result返回完整严格TargetResult以及Event/Commit receipt，但不返回内部Claim、完整Observation、workspace root、raw host handle、prompt或stack。结果
是Controller review input，不执行真实性判断、Test verdict、Controller acceptance或Demand completion。

### 214.9 第八个官方MCP工具与真实纵切

Public MCP、Codex/Claude Code固定wrapper、entrypoint编译清单和candidate artifact闭包现共同发布第八项工具：

```text
wakeflow_import_target_result
```

annotations固定为：

```text
readOnlyHint: false
destructiveHint: true
idempotentHint: true
openWorldHint: false
```

`destructive:true`只来自Event提交后的精确Claim释放；工具不调用宿主、不访问开放网络，也不发送消息。MCP instructions明确要求使用exact
target-authored Report，禁止Agent合成Report或提交caller-authored TargetResult，并明确导入成功仍不等于Controller acceptance。

真实Codex MCP fixture现完整验证：

```text
Route: implementation-host-effect-claim
→ Claim首次签发一次性Action
→ Agent已观察Outcome（测试只提交事实，不执行宿主发送）
→ Route: implementation-target-result-import
→ Report-only TargetResult Import
→ Result Event committed
→ exact Claim released
→ Route: implementation-result-review
→ 相同请求幂等返回同一Result/Event
```

独立真实Test纵切也证明同一公共工具从Test Report恢复Card、attempt和packet lineage，并把Route推进到`test-result-review`，没有复制第二套Test
Result Import owner。

### 214.10 验证与本单元结论

```text
Result domain / Service / Public Schema / Coordinator / MCP / candidate:
  49 pass / 0 fail / 0 skip
Adjacent Delivery Claim / Outcome / Review consumers:
  55 pass / 0 fail / 0 skip
TypeScript: pass
Prettier: pass
Architecture: pass / parser=swc / 645 modules / 4607 dependencies / 0 violations
Schema: pass / 81 schemas / 207 external refs
Schema digest: sha256:6feea8e13b38d8742da67adcf467f73b128836c67055b6986dbbf64fbd119222
git diff --check: pass
```

本单元结论为`implemented / verified`：Implementation与Test accepted/indeterminate的共享S3正常出口已从内部owner闭合到公开MCP，且没有新增
manager、registry、兼容层、Host能力调用或第二状态机。旧JS/core、正式插件制品、安装cache和外部Atlas均未修改；未运行旧JS全量`npm test`、插件
validator/smoke、发布或提交。

下一项仍不应按文件名机械进入Rearm。先对当前Route中`implementation-host-effect-rearm`异常分支做公共化预审，并同时核对它与Test
replacement Delivery的共享/非共享边界；若公共Rearm只需最小selector和固定Host恢复同一Delivery，可作为下一小纵切，否则应先补足其authority设计再请求
用户选择。

## 215. Implementation Host Effect Rearm公共化预审

### 215.1 当前Implementation Rearm的真实职责

当前内部链已经严格区分：

```text
accepted / indeterminate
  → 不Rearm，进入TargetResult Import

rejected-before-effect + unavailable
  → Outcome Event先提交
  → exact旧Claim释放
  → Route: implementation-host-effect-rearm
  → 显式Rearm Event
  → 同一Target Delivery恢复为delivery-prepared
  → 重新取得fresh Claim后才可能签发下一份Agent Host Action
```

`TargetHostEffectRearmService`不执行Codex/Claude能力、不发送消息、不读取raw handle，也不创建或复用Claim。它在首次Event前复验：

- Demand仍active且Aggregate尾部是精确`host-effect-rejected`；
- Claim Event、Observation Event、Action和Observation digest形成同一拒绝尾部；
- Observation严格为`rejected-before-effect + unavailable`；
- 旧Claim文件已经物理absent；
- 原Target Delivery Intent仍属于当前Config和program；
- 当前私有Binding仍与原Intent的Host/Window/Binding一致；
- Config在Event append前没有漂移；
- Event/Commit容量、stream revision与确定性身份均可提交。

Rearm Event只恢复同一不可变Delivery/Intent，不改变TaskPackage或重新生成prompt。下一次Claim产生新的Claim ID和一次性Action，因此“允许重新取得效果占用”与
“实际宿主发送”仍是两个owner。

### 215.2 为什么不与Test replacement合并

Implementation和Test共享的只有前置证明：上一份效果明确没有发生，旧Claim已经释放。其后业务事实不同：

| 分支 | Implementation Rearm | Test replacement Delivery |
| --- | --- | --- |
| logical task/attempt | 同一Target Task | 同一Test logical attempt |
| Target Delivery | 保留同一ID | 分配新ID |
| Intent | 复用原不可变Intent | 创建带replacement lineage的新Intent |
| packet | 不存在Test packet | 从新Intent Event重建新TestDispatchPacket |
| Event family | `delivery.target-host-effect-rearmed` | `testing.test-delivery-prepared` |
| 历史 | 新Claim/Observation Event保留发送代际 | attempt内追加有界Delivery authorization |

Test replacement还必须维护authorization ordinal、previous Intent/packet、Card、attempt容量和新packet来源；把它塞入Implementation Rearm会让一个小owner
同时拥有两种身份分配和两种Event语义。反向把Implementation改成Test式replacement也会为没有Test attempt/packet需求的主路径制造新Delivery和新Intent。

因此当前分层应保留。未来Test公共链应在完整TestCard → Test Task → Test Delivery纵切中公开
`TestDeliveryPreparationService`的initial/rerun/replacement模式，不通过一个所谓“统一Retry/Rearm manager”提前暴露中段能力。

### 215.3 旧JS与Tencent参考

旧JS把`target-rearm`作为`wakeflow_prepare_delivery`的一种operation，并在同一大编排文件内同时处理lease generation、Envelope、Test
replacement authorization和宿主前置状态。可保留的功能事实是：只有精确`rejected-before-send`尾部可以重新授权，下一代授权必须有新占用身份；大工具、共享状态文件、
lease实现和Implementation/Test同文件分支不是新TS标准。

TencentDB-Agent-Memory的`pending-writes.ts`只在下游hash去重足以吸收重复、且“宁可重复不要丢”符合产品代价时自动重试；`pipeline-worker.ts`在重新入队时换新
task ID并保留retry count，对锁丢失则依赖明确幂等的下游写；Gateway错误合同把`retryable`与客户端安全错误分离。这些实践支持Wakeflow当前决定：

- 底层Event append的exact retry可以幂等；
- Agent宿主效果没有通用幂等保证，不能由Wakeflow自动重发；
- “可重试”必须由已记录事实和显式owner决定，不能只由网络错误、超时或Agent猜测决定。

Tencent项目没有Target Delivery、WindowWorkClaim或Test attempt lineage，不能决定Implementation与Test是否共用Rearm owner。

### 215.4 官方标准校准

[RFC 9110 §9.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#name-idempotent-methods)要求：非幂等请求不应自动重试，除非客户端能证明请求语义实际幂等，或能
检测原请求从未应用。Wakeflow的`rejected-before-effect`正是后一种强证明；accepted/indeterminate不具备该证明，因此继续禁止Rearm。

[AWS Builders' Library](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)建议用唯一请求身份表达调用者意图、相同身份重放返回语义等价
结果，并在同一身份携带不同参数时拒绝mismatch。Rearm的Action ID是稳定操作身份；Observation digest证明调用者选择的是同一拒绝事实；Task/Delivery则应由stored
authority派生，不需要由调用者重复声明。

[Google Cloud Retry Strategy](https://docs.cloud.google.com/storage/docs/retry-strategy)把错误是否可重试与操作是否幂等作为两个同时成立的条件，并默认不自动重试
非幂等操作。这支持Rearm工具自身exact replay幂等，但不支持工具内部自动执行下一次Host Action。

[MCP 2025-11-25 Schema](https://modelcontextprotocol.io/specification/2025-11-25/schema)规定`idempotentHint=true`只表示相同参数重复调用没有额外环境效果；
`destructiveHint=false`表示写操作只做additive更新。Rearm只追加Event，不删除Claim、不覆盖用户资源，因此推荐：

```text
readOnlyHint: false
destructiveHint: false
idempotentHint: true
openWorldHint: false
```

它是短时本地Event mutation，不使用MCP task execution。

### 215.5 公共化前必须修正的三个内部缺口

第一，当前Request仍要求调用者回传`targetTaskId + targetDeliveryId`。两者都能从Action对应的Claim/Observation和Aggregate恢复，是重复echo。建议内部与公共请求统一
收敛为：

```text
demandId
actionId
observationDigest
```

Action ID同时充当精确Rearm幂等身份；Observation digest用于拒绝“同一Action、不同拒绝事实”的参数mismatch。不能只用`targetTaskId`，否则同一Target后续出现新的
rejected generation时，相同请求参数可能产生第二次效果，不再满足精确幂等。

第二，当前Service只在首次Event路径通过当前Binding间接验证Host。`existingRearm !== null`的精确重放分支跳过Binding，因此用另一Host Profile调用已提交Rearm会返回
`already-rearmed`。公共化前必须从stored Claim route显式比较固定Host，并在首次与settled replay两条路径都拒绝cross-host调用；Service仍保留完整Host Profile依赖，用于
首次Event前复验当前私有Binding。

第三，当前稳定错误没有`eventAuthority`。若Rearm Event已经提交后发生错误Request、Host mismatch或Repository/Config问题，公共入口无法区分`unchanged`、`current`和
`unknown`。应与Outcome/Result采用同一原则：同时读取Claim、Observation和可能存在的Rearm Event；一旦定位Event，后续错误保持`current`；append结果无法确认时报告
`unknown`；普通前置拒绝保持`unchanged`。

这三个修正属于现有owner的authority完整性，不需要新Foundation、Manager、Retry Policy类或通用恢复框架。

### 215.6 推荐公共合同

推荐工具名：

```text
wakeflow_rearm_target_host_effect
```

名称保留“Host Effect”是为了说明被重新开放的是已证明未发生的效果代际，而不是重新规划Task或创建新Delivery。工具描述必须明确：它不执行Host Effect、不返回一次性
Action，也不自动取得Claim。

推荐Request：

```text
root
demandId
actionId
observationDigest
```

推荐Result：

- `rearmed | already-rearmed`与`committed | idempotent`；
- `claimAuthority=released / eventAuthority=current`，其中Claim明确指`actionId`选择的旧拒绝Claim；
- 完整不可变Rearm事实或其等价严格投影；
- Rearm Event/Commit receipt与post-event state digest。

Public Coordinator固定Codex或Claude Code的Resource/Identity Profile，复验Request、Claim、Observation、Host、Rearm、单Event Commit、command/commit digest和state digest；输出
拒绝workspace root、raw handle、prompt、stack和任意额外字段。成功后调用方必须重新读取Route；只有
`implementation-host-effect-claim` owner在fresh Agent窗口观察下才能创建下一份Claim和一次性Action。

Rearm是单一小Event、无外部输入计划、无宿主效果且身份从旧Claim稳定派生，因此不增加preview/apply二阶段。复杂Test replacement仍保留其既有preview/apply合同。

### 215.7 建议的轻量验证边界

内部Service只补当前缺失的风险证据：

1. 最小selector由stored Event派生Task/Delivery；错误echo字段不再存在；
2. wrong Host在首次与已提交replay都拒绝，settled错误保留`eventAuthority=current`；
3. 已提交重放不依赖后来Config/Binding，也不会因随后新Claim而追加Event；
4. accepted/indeterminate、旧Claim未释放和Event前Binding漂移继续拒绝。

公共层只保留：一份Request/Result wire测试、一份Coordinator真实/replay/隐私/Host测试，以及一条MCP真实纵切：

```text
rejected Outcome + released Claim
→ Route: implementation-host-effect-rearm
→ public Rearm
→ Route: implementation-host-effect-claim
→ fresh Observation + new Claim ID + one-shot Action
```

不复制内部所有关系测试到MCP层，不为Test replacement新增公共测试，也不运行旧JS套件。

当前未修改生产代码或Schema。现有Rearm、Test replacement、Outcome与Controller Route聚焦基线为：

```text
14 pass / 0 fail / 0 skip
```

### 215.8 待用户选择的下一步

| 方案 | 下一步 | 评价 |
| --- | --- | --- |
| A（推荐） | 按215.5–215.7先修内部Rearm，再完整公开Implementation-only `wakeflow_rearm_target_host_effect` | 闭合当前已公开Implementation rejected分支；边界小、无自动发送，也不提前暴露Test中段 |
| B | 只完成内部selector/Host/eventAuthority修正，暂不注册第九个MCP工具 | 可以继续巩固owner，但公共Route仍指向不可调用能力，纵切不完整 |
| C | 先抽象统一Implementation Rearm与Test replacement，再公开一个通用恢复工具 | 混合“同Delivery重开”和“新Delivery授权”两种Event/身份语义，增加无必要抽象；不建议 |

三项是互斥的本轮范围选择，不是都要做。当前推荐A；等待用户确认后再修改代码。

### 215.9 用户决定与内部Rearm authority修正

用户确认采用方案A。内部`TargetHostEffectRearmRequest`现只接受：

```text
demandId + actionId + observationDigest
```

已删除`targetTaskId + targetDeliveryId`echo字段。Service从Claim Event和Observed Event恢复Implementation Task/Delivery/Intent、Host/Window/Binding及完整拒绝
tuple，并重新闭合Claim digest、Claim Event/Commit、expected revision/state digest、Host observation authority和issued/observed事实。Test
Claim/Observation带workType fence，不能进入Implementation Rearm。

Service现在同时定位可能存在的Rearm Event，并让稳定错误携带：

```text
eventAuthority: unchanged | current | unknown
```

首次Event前的普通关系拒绝保持`unchanged`；Rearm Event已存在后，即使请求Observation不匹配或由错误Host重放，也保持`current`；Event Store无法确认append结果时使用
`unknown`。固定Host检查从间接Binding准入提升为stored Claim route的显式不变量，因此首次与settled replay都会拒绝cross-host调用。

首次Rearm仍要求旧Claim物理absent、当前Config/Binding有效；精确重放只依赖不可变Claim/Observation/Rearm Event和原Commit，不读取后来Binding，也不会因为后续已经取得新Claim而
追加第二个Rearm。内部成功结果增加Claim与Observation只供Public Coordinator复验，公共投影不会返回这两份完整内部记录。

### 215.10 self-contained wire与Public Coordinator

新增：

- `wakeflow-target-host-effect-rearm-request.schema.json`；
- `wakeflow-target-host-effect-rearm-result.schema.json`；
- 对应生成类型/runtime Schema；
- `target-host-effect-rearm-public-contract.ts`；
- `target-host-effect-rearm-public-coordinator.ts`。

Request只公开workspace root和三项最小selector，拒绝Task/Delivery echo、自动重试开关或额外字段。Public Contract在打开workspace前完成passive JSON、64 KiB Canonical容量与
严格Schema准入。

Result关闭：

```text
rearmed        <-> committed
already-rearmed <-> idempotent
claimAuthority = released
eventAuthority = current
```

并返回完整不可变Rearm事实、Event/Commit receipt和post-event state digest，不包含Action、root、handle、prompt或Test replacement字段。Coordinator固定当前Host
Resource/Identity Profile，并复验Claim/Observation、Host、Rearm、单Event Commit、确定性Event/Commit ID、command digest、Event bytes与commit digest。

真实测试在这里发现一项非Service错误：首次Coordinator实现把返回时的当前Aggregate phase强制当作Rearm Event的resulting state。Rearm后若已经取得fresh Claim，精确重放时
Aggregate自然前进到`host-effect-claimed`，旧Event仍完全有效。现改为：

- 首次`committed`复验返回Aggregate确实是`delivery-prepared`且state digest等于Event resulting digest；
- `idempotent`重放复验原Event/Commit及Rearm bytes，不要求后来Aggregate倒退到历史phase。

这保持Event authority与当前Projection的时间层级分离，没有放宽首次提交验证。

### 215.11 第九个MCP工具与双宿主纵切

Codex与Claude Code分别新增固定Profile wrapper，Public MCP和candidate artifact现共同发布：

```text
wakeflow_rearm_target_host_effect
```

工具annotations为：

```text
readOnlyHint: false
destructiveHint: false
idempotentHint: true
openWorldHint: false
```

`destructive:false`表示它只追加Rearm Event，不删除Claim或覆盖资源。MCP instructions明确：只有Implementation
`rejected-before-effect + old Claim released`可以调用；成功不返回Action，必须重新读取Route并取得fresh target-window observation后再调用Claim owner。Test
replacement仍由未来完整Test Delivery公共纵切拥有。

真实Codex MCP测试闭合：

```text
Claim首次签发one-shot Action
→ rejected-before-effect Outcome Event
→ exact old Claim released
→ Route: implementation-host-effect-rearm
→ public Rearm（zero Host effect / zero Action）
→ Route: implementation-host-effect-claim
→ fresh observation + new Claim ID + new one-shot Action
→ original Rearm request只返回already-rearmed和同一Event
```

测试只模拟Agent已经观察到的宿主事实，没有调用Codex/Claude消息发送能力。MCP错误信封保留Rearm Event authority并继续删除root和stack。

### 215.12 验证与本单元结论

```text
Rearm domain / Service / Public wire / Coordinator / MCP / candidate:
  42 pass / 0 fail / 0 skip
Adjacent Delivery / Controller Route / Post-Acceptance / Test replacement:
  75 pass / 0 fail / 0 skip
TypeScript: pass
Prettier: pass
Architecture: pass / parser=swc / 653 modules / 4663 dependencies / 0 violations
Schema: pass / 83 schemas / 207 external refs
Schema digest: sha256:5e5e409ebbcdc513739bd222bbd492393d35280b4930f46472a2cf0ae8a76d7a
git diff --check: pass
```

本单元结论为`implemented / verified`。Implementation accepted/indeterminate继续进入TargetResult Import，proved rejected-before-effect则可经过显式Rearm回到fresh
Claim；两条公共路径都不授权Wakeflow执行宿主能力。Implementation与Test恢复模型保持分立，没有新增Manager、Retry Policy、兼容parser、自动重发或第二状态机。

旧JS/core、正式插件制品、安装cache和外部Atlas均未修改；未运行旧JS全量`npm test`、插件validator/smoke、发布或提交。

当前Implementation公共主链的下一个真实停点是`implementation-result-review`。下一单元应先预审Controller Implementation Review公共合同，重点决定：如何让Controller提交
独立验证事实而不是复述Agent Result、accept/rework/redesign/blocked是否需要preview、Decision Event的幂等身份与公共Evidence容量，以及如何明确“只有Controller
Decision才是acceptance authority”。确认方案后再公开，不把内部Review Service直接机械注册为第十个工具。

## 216. Controller Implementation Review公共合同预审

### 216.1 直接注册Decision Service并不安全闭环

当前内部`ControllerImplementationReviewDecisionService`只接受已经完成独立审查后的精确命令：

```text
demandId
targetTaskId
targetResultId
snapshotDigest
reviewUnitDigest
decision + assessment + independentChecks + rationale
+ blockingReasons + residualRisks
```

Service重建当前`DemandResultReviewSnapshot`，再把完整TaskPackage、TargetResult、source Event、prior review history与上述digest闭合。现有公共
`wakeflow_inspect_demand_route`只告诉Controller当前frontier是`implementation-result-review`，不会返回完整审查单元、TargetResult ID、review unit digest或
Evidence locators。

因此若直接把Service注册成第十个工具，调用方只能依赖之前对话中偶然保留的TargetResult输出：

- Controller重启或上下文压缩后无法重新建立Decision请求；
- 独立检查无法证明绑定的是当前Result/Snapshot，而不是旧对话中的Result；
- Route若承载完整TaskPackage/TargetResult会从轻量责任中间层膨胀为Review业务读模型；
- 把snapshot/unit digest从请求删除，又会允许旧检查被绑定到后来Result。

正确公共纵切至少需要一个只读Review Context owner和一个Decision mutation owner。原先“第十个工具”假设需要修正为：第十个工具先建立可审查事实，第十一个工具才记录
Controller Decision。

### 216.2 当前内部Review闭包已经具备的事实

`DemandResultReviewSnapshot`是按需、零写、可丢弃的CQRS读模型。一次完整Event Stream审计返回当前Target的：

- 完整TaskPackage及其source Event ID/digest/revision；
- 完整authority-enriched TargetResult及其source Event；
- ordered prior Decision/Resume history；
- `reviewUnitDigest`；
- Demand lifecycle、current stream/state/tail tuple与`snapshotDigest`。

它不产生ReviewCandidate、allowed decisions、next action、分数或acceptance。`ControllerImplementationReviewDecisionService`随后：

```text
strict judgment request
→ current Config/Demand/Controller logical Window
→ one full Review history audit
→ exact reported unit + snapshot/unit/result tuple
→ server-generated Decision ID/time
→ Decision/Event/Commit preflight
→ Config current recheck
→ expected stream revision CAS append
```

相同TargetResult、Snapshot和完整judgment重放返回原Decision ID/time/Event；不同judgment不能覆盖。两个相同请求并发时，只有一个随机Decision身份提交，另一个从Event history恢复
winner并幂等返回。Decision只记录Controller的判断，不执行Git、测试、rework dispatch、Design路由、Test规划、Demand完成或宿主能力。

### 216.3 独立检查合同不应变成伪Evidence Store

当前Decision保存：

```text
assessment.requirementAlignment
assessment.implementationQuality
independentChecks[]:
  checkId + method + passed|failed|inconclusive + observation
rationale
blockingReasons
residualRisks
```

[Google Engineering Practices](https://google.github.io/eng-practices/review/reviewer/looking-for.html)要求reviewer检查设计、用户功能、上下文、并发、复杂度与测试，并明确指出测试本身
仍需人审，不能把“测试通过”当成自动结论。这与Wakeflow的边界一致：Target Report、测试输出和Evidence locator只是输入；Controller必须描述自己的method和observation。

[SLSA Verification Summary Attestation](https://slsa.dev/spec/v1.0/verification_summary)把被验证subject digest、verifier、policy、input attestations和verification result分开。
Wakeflow不是SLSA签名系统，但可借鉴其最小关系：Decision reviewed字段绑定Snapshot/unit/TaskPackage/TargetResult digest，Controller Window表示逻辑verifier，独立checks表达判断。

本轮不为`independentChecks`增加任意Evidence ref：

- TargetResult已经拥有目标作者Evidence locators；
- Controller fresh probe可能是即时命令/读取，没有已确认的持久Evidence owner；
- 添加无发布、读取和生命周期authority的ref只会制造“看起来有证据”的悬空字段；
- Decision Event仍是Controller可审计陈述，不应宣称为密码学attestation或机器真实性证明。

未来Evidence owner出现时，可用独立版本扩展check evidence；当前不预建通用Evidence Registry。

### 216.4 旧JS与Tencent参考

旧JS使用：

```text
DispatchGroupReviewSnapshot
→ persistent ReviewCandidate
→ reduce/group policy
→ decide-review-candidate
```

它同时拥有DispatchGroup、return policy、pending Candidate状态、allowed decisions和Controller-return transport。当前TS早已确认不持久化ReviewCandidate：Snapshot digest +
reviewUnit digest + Event Stream CAS已经提供陈旧检测；恢复Candidate会创建第二状态机和额外恢复事务，却不能证明Controller检查真实发生。

TencentDB-Agent-Memory没有Event-sourced Controller acceptance。可借鉴的是：Skill Review Agent先做role isolation、按完整会话arc审查，再输出严格合同；`skill-format.ts`把
parse与validate集中在领域边界；Gateway把客户端安全错误与内部日志分离。这支持Wakeflow继续：

- 把TargetResult当不可信审查输入，不被目标角色捕获；
- 先返回完整Review Context，再由Controller形成判断；
- Decision请求严格Schema/关系准入，公开错误不泄漏root、stack或内部记录。

Tencent的自动LLM review和quality gate不构成Wakeflow acceptance标准，也不能代替Controller独立检查。

### 216.5 为什么推荐“inspect + 单步record”，不增加Decision preview/apply

公共Decision的external parameters就是Controller已经明确写出的judgment和精确Snapshot selector；Decision ID、Controller Window、state/revision、Event/Commit ID和时间全部是
server-derived system parameters。只读inspect已经负责把完整subject和并发基线交给Controller。

额外Decision preview/apply只能：

- 回显同一judgment；
- 再增加Plan kind/schema/ID/digest、preview过期关系和两套请求结果；
- 仍不能判断独立检查是否真实；
- 把一次小型Event command扩成新的临时状态表面。

现有Service已经用Snapshot digest、reviewUnit digest、TargetResult ID和expected stream revision执行CAS，并用Event history提供语义幂等。因此推荐Decision保持一次显式提交；MCP
把它保守标为`destructiveHint:true`，由客户端显示高风险确认。MCP规范建议工具调用具备human-in-the-loop拒绝能力，但annotations只是提示，不是授权机制
（[MCP Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)）。真正authority仍是Controller职责规则、完整请求和Service重验。

[Microsoft Event Sourcing](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)建议Command根据当前状态生成Event，并要求重复Event消费幂等。当前
Decision Event append、semantic retry和并发winner恢复已经符合，不需要持久Preview Candidate。

### 216.6 推荐的两工具公共合同

第十个工具推荐：

```text
wakeflow_inspect_target_result_review
```

Request：

```text
root + demandId + targetTaskId
```

Result只接受当前`reported` unit，返回current Snapshot/Event Stream tuple、完整TaskPackage、完整TargetResult、source Events、prior review history、
`reviewUnitDigest + snapshotDigest`。它支持现有Implementation/Test共享Snapshot语义，但不决定、打分、运行检查或给出allowed decisions。annotations：

```text
readOnlyHint: true
destructiveHint: false
idempotentHint: true
openWorldHint: false
```

第十一个工具推荐：

```text
wakeflow_record_controller_implementation_review_decision
```

Decision Request建议删除可从TargetResult恢复的`targetTaskId`echo，只接受：

```text
root
demandId
targetResultId
snapshotDigest
reviewUnitDigest
decision / assessment / independentChecks / rationale
blockingReasons / residualRisks
```

Result返回`decided | already-decided`、`committed | idempotent`、`eventAuthority=current`、完整Decision和Event/Commit/state receipt。Coordinator逐项复验
request/Decision/Event/Commit与首次resulting Aggregate；settled replay不能把后来Aggregate phase误当Decision Event的历史state。

Decision annotations推荐：

```text
readOnlyHint: false
destructiveHint: true
idempotentHint: true
openWorldHint: false
```

`destructive:true`是保守业务语义：accept/rework/redesign/blocked会关闭当前reported review资格并改变后续责任，即使物理存储只是append-only Event。工具不使用MCP task
execution，不执行任何外部检查或Host effect。

四类Decision保持当前closed matrix；工具描述必须明确只有Controller可调用，`accept`只表示Controller在本次调用前已经独立建立目标行为，不由TargetResult outcome自动生成。

### 216.7 公共化前的内部修正与轻量测试

Decision Service首先需要两项收敛：

1. Request删除`targetTaskId`，由`targetResultId`和当前Review Snapshot恢复Target；inspect仍用Route给出的Target Task选择审查单元；
2. 已提交Decision存在时，错误snapshot/unit/judgment必须报告`eventAuthority=current`，不能因lookup过滤掉request snapshot而误报`unchanged`。

公共Inspector测试只覆盖：reported unit、Implementation/Test判别、零写、source/digest闭合、root/私密文本过滤和非reported拒绝。Decision公共测试只覆盖四类wire关系、真实
inspect→independent judgment→Decision Event、exact replay、stale selector、settled conflict、输出隐私和Route变化；MCP层保留一条Implementation accept或rework真实纵切，不复制全部
领域矩阵。

当前内部Review/Snapshot/Event/Route基线：

```text
14 pass / 0 fail / 0 skip
```

本预审没有修改Review生产代码、Schema、MCP或测试。

### 216.8 待用户选择的下一步

| 方案 | 公共结构 | 评价 |
| --- | --- | --- |
| A（推荐） | 成对实现共享只读Review Inspector + 单步Implementation Decision recorder；先修selector/eventAuthority，再按文件顺序完成两个工具 | 既提供可重建审查事实又保持唯一Decision owner；无Candidate、无Plan状态，公共链真实闭合 |
| B | Review Inspector + Decision preview/apply | 多一次确认，但只回显Controller judgment；增加Plan/过期/恢复Schema，不能提高检查真实性，不建议 |
| C | 把完整Review Context塞进Route，或用一个mode-based inspect/decide大工具 | Route膨胀、annotations无法准确表达、读写owner混合；重现旧大工具问题，不建议 |

三项是互斥的本轮架构选择，不是都要做。当前推荐A；确认后仍按紧密1–2文件节奏实现，但以Inspector→Decision的完整成对纵切作为完成条件。

### 216.9 用户决定与Decision selector收敛

用户确认方案A，并确认Inspector与Decision作为一个paired vertical slice完成。内部
`ControllerImplementationReviewDecisionRequest`删除`targetTaskId`echo，现由`targetResultId`在当前Review Snapshot中恢复精确Target Task。请求保留：

```text
demandId
targetResultId
snapshotDigest
reviewUnitDigest
Controller judgment
```

Service的Decision代际键仍是`TargetResult + Snapshot generation`，不是TargetResult单值。实现初期为了让settled错误报告Event current，曾把任意同Result旧Decision都视为当前
幂等Decision，回归立即证明这会错误阻断：

```text
blocked Decision
→ explicit Resume
→ same TargetResult / new Snapshot generation
→ second Controller Decision
```

最终规则为：

- 同Result + 同Snapshot已有Decision：完全相同judgment幂等返回；冲突judgment报告`eventAuthority=current`；
- 当前Snapshot已由Resume重新开放为reported：允许同Result的新一代Decision；
- 请求不匹配当前reported unit、但历史中已有该Result Decision：报告`review-snapshot + eventAuthority=current`；
- 尚无Decision的陈旧请求保持`unchanged`。

这同时保留semantic replay、settled权威和blocked generation，不引入generation counter或Candidate状态。

### 216.10 第十个工具：共享只读Review Inspector

新增self-contained：

- `wakeflow-target-result-review-inspection-request.schema.json`；
- `wakeflow-target-result-review-inspection-result.schema.json`；
- Public Contract / Coordinator及生成类型/runtime Schema；
- Codex / Claude Code薄wrapper。

工具名：

```text
wakeflow_inspect_target_result_review
```

Request只有`root + demandId + targetTaskId`。Coordinator通过Demand组合authority完整审计Event Stream，重建当前Snapshot，只接受精确`reported` target，并返回：

- current Demand/Event Stream/state tuple与`snapshotDigest`；
- 完整Implementation或Test TaskPackage；
- 完整authority-enriched TargetResult；
- 两份source Event receipt；
- `reviewUnitDigest`；
- prior Decision/Resume history的有界审查摘要，包括Decision assessment/checks/rationale与Resume blocked lineage。

Coordinator重新计算内部Snapshot/unit digest、复验Config仍current，再执行生成Schema、32 MiB公共容量和workspace/ledger/demand root隐私检查。输出不生成Decision、allowed decisions、
next action、score或verdict。annotations：

```text
readOnlyHint: true
destructiveHint: false
idempotentHint: true
openWorldHint: false
```

Inspector wire因MCP客户端不能解析仓库私有URN而必须self-contained；大型结构由现有TaskPackage/TargetResult Schema机械内联，并用codegen mirror test逐字段对齐领域authority，未新增
运行时Schema bundler或手工第二套领域parser。

真实测试覆盖：Implementation reported零写读取、Test reported共享读取、Decision后非reported拒绝，以及
`blocked Decision → Resume → reported`的公共prior Decision/Resume history投影。

### 216.11 第十一个工具：Controller Implementation Decision recorder

新增self-contained Decision request/result Schema、Public Contract / Coordinator、生成类型/runtime Schema及双宿主wrapper。工具名：

```text
wakeflow_record_controller_implementation_review_decision
```

Public Request严格包含Inspector返回的`targetResultId + snapshotDigest + reviewUnitDigest`和Controller judgment；拒绝Target Task echo、非NFC/重复检查、不闭合四类Decision及
workspace root进入判断文本。Decision ID、Controller logical Window、reviewed state/revision、Event/Commit身份和时间全部由Service派生。

Public Coordinator逐项复验：

- request与完整Decision judgment；
- reviewed Snapshot/unit/TargetResult identity；
- 单Decision Event、确定性Event/Commit ID、command/commit digest和Event bytes；
- 首次committed后的Aggregate phase/Decision summary与resulting state digest；
- idempotent replay只绑定历史Event/Commit，不要求后来Aggregate退回Decision时的phase。

Result返回`decided | already-decided`、`committed | idempotent`、`eventAuthority=current`、完整Decision和Event/Commit/state receipt。工具不运行检查、不从TargetResult推导
accept、不执行rework Delivery、Design、Test或Completion。annotations保守声明：

```text
readOnlyHint: false
destructiveHint: true
idempotentHint: true
openWorldHint: false
```

`destructive:true`表达Decision会关闭当前reported review资格并改变责任Route；物理Event Store仍是append-only。

### 216.12 双宿主MCP真实纵切与测试维护

Public MCP现精确发布11项已有owner的工具。MCP instructions固定顺序：

```text
TargetResult Import
→ Controller调用Review Inspector
→ Controller读取完整输入并在Wakeflow外运行fresh independent checks
→ Controller提交exact Decision request
→ Decision Event成为唯一implementation acceptance authority
→ 重新Inspect Route
```

真实Codex MCP fixture已从Claim/Outcome/TargetResult继续推进到Review Inspector、Controller accept Decision、
`demand-completion-preflight` Route和exact Decision replay；测试没有执行宿主发送，也没有把fixture judgment声称为真实产品acceptance。

MCP composition executor测试同步从逐段重复对象改为一个完整合法options基线加table-driven Proxy字段矩阵。新增工具只需增加一行field/reason，降低后续测试维护与遗漏成本。双宿主
candidate官方stdio Client列出完全相同的11工具集合，manifest继续`releaseEligible:false`。

### 216.13 验证与本单元结论

```text
Inspector / Decision domain / public wire / Coordinator / MCP / candidate:
  49 pass / 0 fail / 0 skip
All Review subsystem tests:
  32 pass / 0 fail / 0 skip
Adjacent Controller Route / rework Delivery / Completion:
  18 pass / 0 fail / 0 skip
TypeScript: pass
Prettier: pass
Architecture: pass / parser=swc / 668 modules / 4736 dependencies / 0 violations
Schema: pass / 87 schemas / 207 external refs
Schema digest: sha256:d4727340aec36f3626a51cc6073cff2685de4603989da111a642dfcd283026b0
git diff --check: pass
```

本单元结论为`implemented / verified`。Review Context与Decision保持Query/Command分离；没有恢复旧ReviewCandidate、Group reducer、preview plan、Evidence Registry、自动检查、自动
acceptance或第二状态机。TargetResult仍只是输入，只有Controller独立判断形成的Decision Event才改变Implementation Target review状态。

旧JS/core、正式插件制品、安装cache和外部Atlas均未修改；未运行旧JS全量`npm test`、插件validator/smoke、发布或提交。

Decision后的Route现在形成三个不同优先级的后续面：accept可能进入controller-only Completion或real-environment TestCard planning；rework已经能回到现有公开Delivery；blocked进入尚未
公开的Review Resume；redesign进入Design能力边界。下一单元应先重读这张post-Decision Route矩阵和真实产品主路径，再在Completion、Test入口与Review Resume之间选择顺序，不能按文件名
机械公开下一个Service。

## 217. Decision后Route矩阵与下一公共纵切预审

### 217.1 本轮范围与当前事实

本轮按Controller application层重新读取了：

- `DemandControllerRoute`与`DemandPostAcceptanceRoute`；
- `DemandCompletion`的Record、Authority、Plan、Service及五项直接测试；
- `TestCard Planning`、`Test Task Planning`及相邻真实纵切；
- 通用`ControllerTargetReviewResume`的Request、Record、Service及Implementation/Test恢复测试；
- 旧JS当前v3 lifecycle、TestCard public handler和历史流程文档；
- TencentDB-Agent-Memory的Task status、task-transition与session state manager；
- MCP、Durable Task、GitHub status checks与Google code review官方资料。

本轮不修改生产代码、Schema、生成文件或测试。Route当前已形成四条不同性质的责任路径：

| Decision / Authority | 当前frontier | 性质 | 当前公共可达性 |
| --- | --- | --- | --- |
| `accept + controller-only` | `demand-completion-preflight` | 正常成功路径 | Completion尚未公开 |
| `accept + real-environment` | `test-card-planning` | 条件成功路径的Test入口 | TestCard尚未公开 |
| `rework` | `implementation-delivery-planning` | 产品代码修复路径 | 已由现有Delivery公共纵切承接 |
| `blocked` | `implementation-review-resume` | 人类/外部阻断恢复 | Resume尚未公开 |
| `redesign` | `implementation-redesign-required` | 返回Design的需求级能力缺口 | 当前明确blocked，不应在本轮伪装实现 |

`controller-only`与`real-environment`不是全局默认和增强版的关系；二者由每个非research Demand冻结的测试决定选择。`research`使用
`not-applicable`，其zero-artifact Completion仍是另一项Lifecycle缺口，不应混入本轮三个候选。

### 217.2 Completion是两条成功路线的共同终点

内部`DemandCompletionService`已经具有完整的零写preview与exact-plan apply：

```text
current completion-preflight Route
→ claimed TODO精确挂载
→ 所有参与WindowWorkClaim均absent
→ Config current fence
→ lifecycle.demand-completed Event append
→ completed Aggregate
→ exact Commit重放幂等
```

它不只是controller-only专用能力。real-environment Test被Controller接受后，同一个Post-Acceptance Route也进入
`completion-preflight`，随后使用同一个Completion owner。因此公开Completion会先闭合当前已公开Implementation纵切在controller-only accept后的成功终点，并同时提前完成
real-environment路线最终必需的共同收口；不是为单一模式制作一次性工具。

Completion成功后有意保留：

- accepted Implementation/Test lineage；
- TestCard与attempt历史；
- `claimed` TODO及其精确挂载。

TODO删除必须等待未来BusinessArchive回执；宿主关闭、BusinessArchive、Retention和Pod close也仍由后续owner负责。`completed`本身是可稳定停留的业务终态，
但绝不能把Completion工具描述成“已归档、已清理或已关闭宿主”。

### 217.3 Resume是正确但较窄的异常恢复面

内部Resume已经统一覆盖：

```text
Implementation review-blocked → result-reported
Test test-review-blocked       → test-result-reported
```

它绑定精确blocked Decision、同一TargetResult、blocked Snapshot与resolution summary；一个blocked generation只追加一个幂等Resume Event。恢复后Controller仍必须重新Inspect、运行fresh
independent checks并形成下一代Decision。它不创建Test attempt、不触发Delivery，也不把resolution summary解释为acceptance。

因此Resume是应保留并最终公开的真实能力，但它是异常路径：当前Implementation blocked已经能从公共Decision抵达；Test blocked则要等Test公共链先可达。先做Resume可修复“公共流程遇到blocked后无法恢复”的缺口，
却不会让任何成功Demand抵达终态。

### 217.4 TestCard是条件路线入口，不是一个孤立工具

`TestCardPlanningService`当前只创建TestCard Event，不创建Test TaskPackage。即使只公开TestCard，Route也会立即推进到另一个尚未公开的
`test-task-planning`。完整real-environment公共路线至少还需要按现有owner顺序逐项审阅：

```text
TestCard Planning
→ Test Task Planning
→ Test Delivery Preparation
→ shared Claim / Agent Host Action / Outcome
→ shared TargetResult Import
→ Controller Test Review
→ Completion、another-attempt、blocked Resume或product-defect remediation
```

这条路线内部骨干已经存在，但公共合同中仍包含Controller编写的测试问题、边界、自检、环境条件、允许/禁止操作、证据要求、策略Authority与attempt政策。它适合继续按小切片公开，不适合用一个巨型
`wakeflow_testing` action工具一次暴露。只在“下一项”选择TestCard意味着主动开始一组较长的连续公共切片，而不是单文件后已经形成可用Test闭环。

### 217.5 旧JS与Tencent对照

旧JS当前v3提供`wakeflow_complete_demand preview/apply/recover`，因为其Lifecycle transaction在终态提交后还会释放精确coordination lease，属于跨资源前向恢复事务。新版TS Completion在准入时要求参与
WorkClaim已经absent，写效果只有单个Event Store commit；直接复制旧`recover`会制造没有恢复对象的公共分支。新版应保留内部现有preview/apply，不为旧工具表追求形状等价。

旧JS TestCard入口要求调用方提交近乎完整artifact和transition。新版TS从Demand、Config、Ledger和Route恢复Program、Window、实现接受基线、Event tail及typed identity，调用方只编写真实测试内容和选择策略Authority；该分层更适合作为新标准。

旧JS没有精确blocked generation的显式Review Resume；新版Resume修复的是旧系统真实楔死缺口，不是兼容扩张。

TencentDB-Agent-Memory没有Controller Review、TestCard或Event-sourced Demand Completion这一相邻领域。其`TaskStatus = running | completed`是粗粒度元数据，`OffloadStateManager`用绑定单Session的class持有可变缓存和持久状态，
`handleTaskTransition`直接组合判断、状态修改和Storage写入。这些代码能支持“持状态对象才使用class、状态词汇用判别值、恢复/重试显式表达”的一般实践，却不能作为Wakeflow post-Decision Route顺序或authority边界的模板。

### 217.6 官方实践校准

[MCP Tools规范](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)要求服务端严格校验输入，并建议敏感工具保持human-in-the-loop；Tool annotations只是客户端提示，不能代替服务端的
exact authority与CAS。Completion属于高后果终态写入，现有preview→确认→apply比单步命令更合适。

[Durable Task external events](https://learn.microsoft.com/en-us/azure/durable-task/common/durable-task-external-events?tabs=python)把人类批准/外部输入建模为唤醒同一持久执行的显式事件，并建议用唯一ID抵御at-least-once重复。
这与Wakeflow的精确blocked Decision→Resume ID模型一致，说明Resume设计正确；它没有要求异常恢复优先于正常成功路径。

[GitHub Status Checks](https://docs.github.com/en/pull-requests/reference/status-checks)把测试/构建检查建模为在被配置为required时才阻止最终合入的条件门，并保留check来源与结论。对应Wakeflow，real-environment Test必须服从冻结Demand testing decision；
不能把它提升为所有Demand的默认终态条件，也不能让Test替代Controller acceptance。

[Google Code Review](https://google.github.io/eng-practices/review/reviewer/looking-for.html)要求从整体设计、真实功能、并发、复杂度和测试有效性审查，并明确警惕尚无实际需求的泛化；其
[Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html)建议把功能分解为可独立审阅、逐步叠加的小变更。下一公共纵切应优先形成一个真实可用闭环，不应因内部Testing文件已经存在就一次公开整条大链。

### 217.7 三种互斥的下一切片方案

以下A/B/C只互斥“下一项先做什么”，不是最终能力三选一：

| 方案 | 下一切片 | 直接收益 | 代价与结论 |
| --- | --- | --- | --- |
| A（推荐） | 公开`wakeflow_complete_demand` preview/apply | 立即闭合当前公共Implementation纵切在controller-only accept后的成功终点；同时成为未来real-environment路线共同终点；内部owner与五项真实测试已成熟 | 是terminal mutation，wire与说明必须严格区分Completion和Archive；公共边界需保留确认步骤 |
| B | 公开通用Controller Target Review Resume | 闭合当前Implementation blocked异常路径；内部合同小且Implementation/Test共享 | 不推进正常成功路径；Test变体暂时没有公共上游；单步外部事实仍需保守高风险annotations |
| C | 从TestCard Planning开始连续公开real-environment路线 | 开始服务冻结为real-environment的Demand；复用完整内部Testing骨干 | 单独TestCard后仍停在Test Task Planning；后续工具、Schema与测试面明显更大，不能把整链压成一次实现 |

推荐顺序为先A。A完成后的B/C顺序仍在A的系统收束点根据真实公共Route、测试成本与用户优先级重新核实，不提前冻结长期路线。

### 217.8 推荐A的拟定公共边界

建议工具名保持领域动作清楚：

```text
wakeflow_complete_demand
```

请求判别为：

```text
preview: root + mode=preview + demandId
apply:   root + mode=apply + exact plan + planDigest
```

Preview返回完整self-contained `DemandCompletionPlan + planDigest`供Controller/用户审阅；Apply返回`completed | already-completed`、
`committed | idempotent`、`eventAuthority=current`、Completion/Event/Commit与resulting state receipt。调用方不能提交Controller Window、TODO、testing mode、Route、Review、时间或Event身份；全部由owner恢复/派生。

工具annotations建议：

```text
readOnlyHint: false
destructiveHint: true
idempotentHint: true
openWorldHint: false
```

`destructive:true`表达业务生命周期进入终态，虽然底层只追加不可变Event。它不注册`recover`、不归档TODO、不关闭窗口、不生成BusinessArchive，也不把`completed`自动解释为下一步已经完成。

若用户确认A，主要手写审阅单元仍只有紧密相邻的两个文件：

1. `governance/lifecycle/demand-completion-public-contract.ts`；
2. `governance/lifecycle/demand-completion-public-coordinator.ts`。

Schema/generated、Codex/Claude薄wrapper、MCP注册和聚焦测试作为同一公共纵切的机械闭包；不借机改写内部Completion、Testing、Resume、Archive或旧JS。测试优先复用现有accepted fixture，增加一次真实
`Decision accept → Route → MCP preview/apply → terminal Route`和exact replay，不复制内部五项owner测试。

当前结论为`pre-reviewed / awaiting user decision`，尚未创建上述文件。

### 217.9 用户确认A与公共wire落地

用户确认先公开Demand Completion。新增两份self-contained MCP Schema及其生成类型/runtime Schema：

- `wakeflow-demand-completion-request.schema.json`；
- `wakeflow-demand-completion-result.schema.json`。

Request保持两种闭合模式：

```text
preview → root + demandId
apply   → root + exact DemandCompletionPlan + planDigest
```

Apply Plan完整携带冻结Demand Authority与Completion，以便已提交重试不依赖后来Config、Ledger或TODO状态；调用方不能提交Controller Window、testing mode、TODO、Route、Review、时间、Event/Commit身份、Archive或清理字段。公共request/result各设
24 MiB Canonical JSON上限，为内部16 MiB Event Commit上限保留确定性封装余量。

wire中的Demand Authority、Completion、Ledger Authority Member、portable path、SHA-256、UTC、TODO ID与typed IDs均为本地定义；MCP Client不需要解析仓库私有URN。codegen mirror test逐字段对齐Domain Schema。Ledger Member的
family/record/role组合关系仍由Domain codec复验，公共Schema只复制可移植结构字段，不复制一套第二领域parser。

Result关系固定为：

```text
completed         ↔ committed
already-completed ↔ idempotent
```

Preview返回完整Plan与digest；Apply返回Completion、Event/Commit回执、command/plan digest和`eventAuthority=current`。Apply只返回Completion Event的
`resultingStateDigest`，不返回“调用时Aggregate一定仍为completed”的断言：未来completed Demand若通过正式continuation回到active，历史Completion exact replay仍应诚实指向原Event结果，而不是把当前状态与历史Event混淆。

### 217.10 两个主要手写文件与共享composition

新增主要手写文件：

1. `governance/lifecycle/demand-completion-public-contract.ts`；
2. `governance/lifecycle/demand-completion-public-coordinator.ts`。

Contract执行被动JSON、24 MiB容量和生成Schema准入。Coordinator：

- 打开并固定workspace根；
- preview时只把`demandId`交给现有Service；
- apply时只消费exact Plan/digest；
- 逐项复验单一Completion Event、Event/Commit/command identity、stream位置、Completion bytes、首次提交后的completed state和Commit digest；
- idempotent replay不要求后来Aggregate仍停在原phase，只返回原Event resulting state digest；
- 对输出重新执行生成Schema、容量和workspace root隐私检查；
- 保留稳定`root | preview | apply | output`错误与`unchanged | current | unknown` Event authority。

内部`DemandCompletion`、Authority、Plan和Service没有修改；既有owner已经正确实现Route、claimed TODO、absent WorkClaim、Config current、Event append与exact replay。

预审曾把双宿主wrapper列为机械闭包，实际依赖审查后未创建：Completion不消费host profile、Host observation、opaque handle或宿主效果，与Demand Route和Target Task Planning相同，Codex/Claude composition直接复用同一个host-neutral Coordinator。复制两个无差异文件只会增加维护面。

### 217.11 第十二个MCP工具与真实纵切

官方MCP新增：

```text
wakeflow_complete_demand
```

description明确：只有Route为`demand-completion-preflight`才可preview/apply；Completion不归档或删除TODO、不移动Demand、不创建BusinessArchive、不关闭宿主窗口、不prune transport、不清理资源。annotations：

```text
readOnlyHint: false
destructiveHint: true
idempotentHint: true
openWorldHint: false
```

`destructive:true`表示Demand进入成功终态；底层Event Store仍为append-only。MCP instructions要求Controller先Inspect Route、审阅完整Preview，再提交exact Plan/digest。

公共Server options、Proxy executor准入、错误envelope、Codex/Claude固定composition和candidate官方stdio Client均同步。两个宿主现发布相同12工具集合。

原Codex真实MCP纵切没有新增一份重复fixture，而是在现有链后继续：

```text
Claim
→ Outcome
→ TargetResult Import
→ Review Inspector
→ Controller accept Decision
→ demand-completion-preflight Route
→ Completion preview/apply
→ terminal Route
→ exact Completion replay
```

测试仍不执行宿主发送；Claim只返回Action，宿主效果由fixture observation模拟，Completion也没有任何宿主效果。

### 217.12 测试维护与验证结论

只新增一个Completion公共测试文件，包含两个真实测试：成功终态/幂等路径，以及root/preview/apply错误分类。没有新增独立Schema测试文件；真实Coordinator本身执行output Schema，现有MCP self-contained test承担Schema镜像，现有MCP纵切承担官方Client验证。这样避免重复复制内部五项Completion owner测试。

当前验证：

```text
Completion public + internal owner + MCP + codegen + candidate focused:
  45 pass / 0 fail / 0 skip
Latest Completion public + MCP + codegen after final Schema relation:
  38 pass / 0 fail / 0 skip
TypeScript: pass
Schema: pass / 89 schemas / 207 external refs
Schema digest: sha256:a20891eae9550d8c7ca3e72ca065f02f837c3bf6d60fc3fe263e587124610518
Architecture: pass / parser=swc / 673 modules / 4764 dependencies / 0 violations
Codex candidate: 383 compiled files / manifest sha256:5468ad4d6f028eb9de05690fb1de644834457c6bc5448155da78623f338583d7
Claude Code candidate: 388 compiled files / manifest sha256:8f01f867fc6119feba230221f920df19498556375fe899276a73b3967f34322e
Both candidates: 12 tools / releaseEligible=false
```

本单元结论为`implemented / verified`。Completion公共纵切闭合的是当前Implementation accept后的成功终点，不声称Demand创建、BusinessArchive、TODO归档、completed continuation、Research Completion、Pod close或完整旧JS等价已经公开。

旧JS/core、正式plugin制品、安装cache、版本和外部Atlas均未修改；没有运行旧JS全量`npm test`、正式plugin validator/smoke、发布或提交。下一Route选择应在通用Review Resume与real-environment TestCard公共入口之间重新核实；当前Implementation blocked已经可由公共Decision抵达，因此Resume是较小且真实的恢复缺口，但仍须先按同样节奏预审公共请求边界。

## 218. 通用Review Resume公共边界预审

### 218.1 现有内部Service不能直接注册

当前`ControllerTargetReviewResumeService`的Request要求调用方同时提交：

```text
demandId
targetTaskId
targetResultId
blockedDecisionId
blockedDecisionDigest
blockedSnapshotDigest
resolutionSummary
```

这些字段在内部测试中可以通过直接读取`DemandResultReviewSnapshot`构造，但现有公共链无法稳定取得。其中最关键的是`blockedSnapshotDigest`：它是blocked Decision Event提交后重建的新Snapshot digest，不是Decision请求中的旧reported Snapshot digest。

当前公共事实为：

- Decision Result返回完整blocked Decision、Event和resulting state digest，但不返回post-Decision Snapshot digest；
- `wakeflow_inspect_target_result_review`只接受当前`reported` Target，Decision后会明确拒绝`review-decided`；
- Demand Route能报告`implementation-review-resume | test-review-resume`、Target Task和当前Event Stream revision/state digest，但不承载完整Decision正文；
- Resume后的Inspector可以把旧Decision/Resume显示为prior history，但这不能帮助第一次Resume。

所以直接把内部Request做成公共Schema，会产生一种只能依赖测试helper或上一次对话中非公共内部读取才能构造的API。即使Agent完整保留blocked Decision响应，也仍缺当前blocked Snapshot digest；这不是字段太多的问题，而是公共producer不存在。

### 218.2 正确的durable selector应来自当前Route状态

Demand Route已经公开同一次Review Snapshot对应的：

```text
targetTaskId
observedEventStream.streamRevision
observedEventStream.stateDigest
```

这三项足以形成精确、可重启的blocked generation CAS selector：

```text
expectedBlockedState:
  streamRevision
  stateDigest
```

配合`targetTaskId`可区分同一Demand中的多个blocked Target。Service应从当前完整Event history自行恢复：

- 当前TargetResult与digest；
- blocked Decision ID/digest与Implementation/Test判别；
- 当前blocked Snapshot digest；
- Controller Window、Program、Event/Commit身份和时间。

调用方不应回填这些system authority。首次调用要求当前Aggregate revision/state与selector完全一致；相同请求重放则按`targetTaskId + blockedSource revision/state`找到已提交Resume。两个不同Target从同一blocked state并发恢复时，只允许一个CAS winner；另一个重新Inspect Route后再提交，避免把旧全局状态偷偷应用到新generation。

`stateDigest`不是新的状态权威；它等价于条件写入使用的opaque版本标签。Resume Event仍是唯一持久业务事实，Aggregate仍由Event重放产生。

### 218.3 仅有Route selector仍不足以支持负责的人类判断

Route刻意只回答“下一owner是谁”，不返回blocked Decision的assessment、独立检查、rationale和blocking reasons。Controller在重启、上下文压缩或换Agent后，不能只看`phase=review-blocked`就声明阻断已解决。

正确做法是扩展现有`wakeflow_inspect_target_result_review`，而不是把完整Decision塞进Route或新增第二个近似Inspector。建议让同一Inspector支持两种review unit：

```text
reported
  → 现有完整TaskPackage / TargetResult / prior history / reviewUnitDigest

review-blocked | test-review-blocked
  → 同一完整审查输入
  → current blocked Decision source + judgment summary
  → current blocked Snapshot/Event Stream tuple
  → prior history / reviewUnitDigest
```

accepted、rework、redesign、Test accepted/another-attempt/product-defect等其他decided状态仍由各自Route owner处理，不把Inspector扩大为通用Demand历史浏览器。blocked inspection只提供恢复判断所需事实，不生成“可Resume”结论、不判断resolution summary是否真实，也不自动调用Resume。

### 218.4 Resume与retry、rework、accept继续分离

Resume只表示外部/人类阻断条件已经具备重新审查的基础：

```text
blocked Decision
→ explicit Resume Event
→ 同一TargetResult重新reported
→ Controller重新Inspect并执行fresh independent checks
→ 新一代Decision
```

它不创建Test attempt、不重新Delivery、不消耗attempt预算、不修复产品代码，也不复用旧Decision。`resolutionSummary`是Controller陈述，不是自动acceptance证据。

旧JS/core没有精确blocked generation的Resume owner；blocked任务只能继续混入旧review/rework机制，属于旧实现缺口。TencentDB-Agent-Memory同样没有Controller Review blocked/Test attempt相邻模型；其Gateway`request_id`用于trace和错误关联，不是业务幂等键，其`approval-pending`处理只是跳过尚无有效结果的tool call。它不能决定Wakeflow Resume合同，只能再次说明trace identity、业务state identity与retry必须分开。

### 218.5 官方实践校准

[Microsoft Durable Task external events](https://learn.microsoft.com/en-us/azure/durable-task/common/durable-task-external-events?tabs=python)把人类输入建模为唤醒同一持久orchestration的显式外部事件，并指出external event具有at-least-once语义，应携带唯一身份用于去重。Wakeflow不需要调用方生成Resume ID；Service可用精确blocked state selector识别generation，再由服务器分配Resume/Event/Commit ID并从Event history完成语义去重。

[RFC 9110 If-Match](https://www.rfc-editor.org/rfc/rfc9110#section-13.1.1)要求状态修改在执行前验证当前representation tag，以避免并发lost update。`expectedBlockedState.streamRevision + stateDigest`正是Wakeflow本地Event-sourced资源的条件写入基线；它比回填一组可由服务器恢复的Decision/Result digest更直接。

[MCP Tool Schema](https://modelcontextprotocol.io/specification/2025-11-25/schema)把input/output Schema与annotations定义为工具描述和提示，不能替代服务端authority。Resume是一个立即完成的本地Event append，不需要实验性的MCP task execution；客户端仍可依据清晰description和风险提示让Controller/用户确认调用。

### 218.6 三种互斥的公共结构方案

以下A/B/C是本轮架构选择，不是三项都实现：

| 方案 | 公共结构 | 优点 | 代价/结论 |
| --- | --- | --- | --- |
| A（推荐） | 扩展现有Review Inspector支持当前blocked unit；内部Resume selector收敛为`demand + target + expectedBlockedState + resolutionSummary`；新增一个单步Resume recorder | 重启后可重建完整判断输入；Route保持轻量；请求只含external intent与CAS；不新增Candidate/Plan/重复Inspector | 需要同步调整现有Inspector result union和内部Service request，但都是修正真实producer/consumer闭包 |
| B | 新增专用Blocker Inspector，再新增单步Resume recorder | 不改变现有Inspector的reported-only结果联合 | 新增一个高度重叠的第13/14工具与第二套TaskPackage/TargetResult/Decision Schema；工具和测试表面不必要增长 |
| C | 新增Resume preview/apply工具；preview同时返回blocker context和完整Resume plan | 一个工具内完成读取、确认和写入 | 混合Query/Command annotations；增加Plan kind/digest、ID/time冻结和过期路径；对一次小型外部signal没有新增真实性或恢复能力 |

直接公开现有七字段内部Request不列为可选方案：`blockedSnapshotDigest`没有公共producer，属于确定的不可用合同。

### 218.7 推荐A的拟定公共合同与实施顺序

建议保留现有Inspector工具名并扩展其输出联合。新增写工具名：

```text
wakeflow_resume_target_result_review
```

Resume Request：

```text
root
demandId
targetTaskId
expectedBlockedState:
  streamRevision
  stateDigest
resolutionSummary
```

Result返回：

- `resumed | already-resumed`；
- `committed | idempotent`；
- `eventAuthority=current`；
- 完整不可变Resume；
- Resume Event/Commit与resulting state digest回执。

建议annotations：

```text
readOnlyHint: false
destructiveHint: false
idempotentHint: true
openWorldHint: false
```

`destructive:false`与现有Host Effect Rearm相同：Resume只追加授权/恢复Event，保留旧Decision与Result并重新开放审查资格；它不删除历史、不accept、不dispatch、不执行宿主效果。调用后必须重新调用Inspector并重新检查，不能沿用blocked前的判断。

若用户确认A，按紧密文件单元实施：

1. `controller-target-review-resume-input.ts`＋`controller-target-review-resume-service.ts`：删除derived echoes，改用exact blocked state selector，先闭合Implementation/Test/并发/replay测试；
2. `target-result-review-inspection-public-coordinator.ts`＋既有self-contained result Schema：增加blocked只读变体和重启恢复测试；
3. 新增Resume Public Contract/Coordinator、Schema、MCP注册与一条`blocked Decision → blocked inspect → Resume → reported inspect → second Decision`真实纵切。

每一步仍只把1–2个手写文件作为主要审阅对象；生成Schema、composition和聚焦测试属于对应纵切机械闭包。不修改旧JS/core、Test attempt、Delivery、Archive或Design。

### 218.8 本轮基线与停点

本轮没有修改生产代码、Schema或测试，只新增本节台账记录。当前基线：

```text
Resume Service + Review Inspector + Controller Route focused:
  9 pass / 0 fail / 0 skip
```

结论为`pre-reviewed / awaiting user decision`。当前推荐方案A。

### 218.9 用户确认A与第一个文件单元

用户确认方案A。本单元只修改：

1. `controller-target-review-resume-input.ts`；
2. `controller-target-review-resume-service.ts`；
3. 现有Service聚焦测试。

没有修改Review Inspector、公共Schema、MCP、Route、Test attempt、Delivery或Decision。

内部Request从七个字段收敛为：

```text
demandId
targetTaskId
expectedBlockedState:
  streamRevision
  stateDigest
resolutionSummary
```

删除的caller echoes：

```text
targetResultId
blockedDecisionId
blockedDecisionDigest
blockedSnapshotDigest
```

`expectedBlockedState`使用严格嵌套普通数据对象，stream revision复用Event Sourcing位置codec，state digest复用SHA-256 codec；未知字段、Proxy/accessor、非法位置、摘要和非canonical文本继续失败关闭。额外旧echo现在作为`input`拒绝，不保留兼容分支。

### 218.10 Service派生Authority与幂等generation key

首次Resume时，Service从同一次完整Event history自行重建Review Snapshot，并同时验证：

- Demand仍为active且identity闭合；
- Aggregate与Snapshot revision/state digest都匹配`expectedBlockedState`；
- 指定Target当前恰好为Implementation `review-blocked`或Test `test-review-blocked`；
- TaskPackage/TargetResult work type一致；
- 当前Decision kind与work type一致且Decision为`blocked`。

验证后才从当前事实派生TargetResult、Decision ID/digest、blocked Snapshot digest、Controller Window、Program和Event/Commit身份，并在读取clock/UUID前完成所有stale检查。

Resume的语义幂等generation key现为：

```text
targetTaskId
+ blockedSource.streamRevision
+ blockedSource.stateDigest
```

同一Demand root内该tuple唯一标识一个blocked generation。exact replay按此查找既有Resume并要求`resolutionSummary`完全一致；不同summary不能覆盖历史。不同Target从同一全局blocked state并发时仍由Event Stream CAS串行，失败者必须重新Inspect最新Route。

### 218.11 聚焦测试修正与验证

现有Implementation真实测试不再由helper回填Decision/Result/Snapshot摘要。它现在证明：

- stale state digest在clock/UUID读取前以`review-snapshot`拒绝；
- 旧`targetResultId`echo作为未知字段拒绝；
- 两个相同selector、不同候选Resume UUID并发时精确收敛为`committed + idempotent`；
- committed Resume中的Decision、Result与blocked Snapshot均由Service恢复且与Event history一致；
- exact replay返回winner原ID/time；
- Resume后同一Result形成新review generation并允许第二代Decision。

Test真实测试同步改用state selector，并继续证明Resume不创建attempt、不改变TestCard/Delivery/Result，只恢复到`test-result-reported`。

```text
Resume Service + Resume record + Review Snapshot focused:
  6 pass / 0 fail / 0 skip
TypeScript: pass
Architecture: pass / parser=swc / 673 modules / 4765 dependencies / 0 violations
Prettier: pass
git diff --check: pass
```

本单元结论为`implemented / verified`。第二个文件单元仍是扩展现有Review Inspector支持当前blocked unit；在该只读producer完成前，不创建Resume公共Schema或MCP工具。

### 218.12 第二个文件单元：复用现有Inspector

本单元扩展现有：

- `target-result-review-inspection-public-coordinator.ts`；
- `wakeflow-target-result-review-inspection-request/result` self-contained Schema与生成类型；
- 现有Inspector、codegen和MCP测试。

没有新增第二个Blocker Inspector工具，没有修改Demand Route，也没有创建Resume Public Contract/Coordinator。

Request保持不变：

```text
root + demandId + targetTaskId
```

Result中的`reviewUnit`从单一reported对象扩展为严格联合：

```text
reportedReviewUnit
  status: reported
  complete TaskPackage / TargetResult / source Events
  priorReviewHistory
  reviewUnitDigest

blockedReviewUnit
  status: review-blocked
  同一完整审查输入
  currentBlockedDecision:
    sourceEvent
    workType-correlated blocked Decision summary
  priorReviewHistory
  reviewUnitDigest
```

blocked变体同时支持Implementation `review-blocked`和Test `test-review-blocked`；Schema按work type强制TaskPackage、TargetResult、Decision summary类型一致，并强制current Decision只能为`blocked`。

### 218.13 reported digest与blocked Snapshot保持分层

`reviewUnitDigest`继续使用Decision提交前的reported basis：TaskPackage、TargetResult、source Events和Decision之前的prior history。当前blocked Decision不被塞回该digest，否则会改变Decision原来签署的review unit identity并制造循环关系。

blocked inspection额外返回：

- top-level current `snapshotDigest`；
- current Event Stream revision/state/tail；
- current blocked Decision source与judgment summary。

因此后续Resume可以：

1. 让Controller读取原审查输入与当前阻断理由；
2. 从top-level Event Stream取得`expectedBlockedState`；
3. 提交resolution summary；
4. 由Resume Service再重读完整history并执行CAS。

Inspector仍不判断阻断是否已解决，不返回allowed decisions，不创建Resume/Decision/acceptance，也不把current Decision重复放入prior history。Resume后它重新返回reported变体，旧Decision/Resume才进入有序prior history。

### 218.14 只准入当前blocked，不扩成历史浏览器

Coordinator当前只接受：

```text
reported
review-decided + Decision=blocked + exact blocked phase/work type
```

Implementation accepted/rework/redesign以及Test accepted/another-attempt/product-defect仍以`inspection`拒绝；这些状态已有各自Route owner。这样避免将Review Inspector扩大为任意Demand历史查询或隐藏Route。

MCP description与Server instructions同步说明：

- Implementation Result Review先Inspect再Decision；
- Implementation/Test Review Resume先Inspect current blocked Decision和state；
- Inspector不决定blocker resolution，也不创建Resume。

工具数量仍为12，annotations仍是纯只读：

```text
readOnlyHint: true
destructiveHint: false
idempotentHint: true
openWorldHint: false
```

### 218.15 测试维护与本单元验证

现有reported Implementation/Test测试保持原输出与零写语义。新增两个真实blocked案例：

- Implementation blocked：复验current Decision ID/source、阻断judgment、Snapshot/Event Stream CAS、reported reviewUnit digest和隐私；伪造`decision=accept`无法通过blocked output Schema；
- Test blocked：复验Test Decision判别、同一TargetResult与Test attempt identity。

既有accepted负例继续证明Inspector不会接受非blocked decided target。codegen mirror test固定reported/blocked联合、字段差异和currentBlockedDecision shape；没有新增独立Schema测试文件。

第一次MCP聚焦运行出现`39 pass / 1 fail`：失败只是原测试仍查找旧description连续子串`creates no Controller acceptance`，新文案已改成更准确的`creates no Resume, Controller acceptance`。断言随后拆成两个真实边界并重跑，MCP为`35/35`通过；没有修改生产行为迎合旧字符串。

```text
Review Inspector final focused:
  4 pass / 0 fail / 0 skip
Schema/codegen focused:
  4 pass / 0 fail / 0 skip
MCP focused after assertion cleanup:
  35 pass / 0 fail / 0 skip
TypeScript: pass
Schema: pass / 89 schemas / 207 external refs
Schema digest: sha256:e4f27b587cf713438e7c348e37fbf381d32f72dd771d394244747bce95df13e9
Architecture: pass / parser=swc / 673 modules / 4771 dependencies / 0 violations
Codex candidate: 383 compiled files / manifest sha256:1a1bec99a48ba3b2a82f5781f78ece1394b48f84227eb931ee098ceb13094a0e
Claude Code candidate: 388 compiled files / manifest sha256:ee15896ee00a4052a421764b855335f5a21051634664b24c3c14d823e3aadcf5
Both candidates: 12 tools / releaseEligible=false
Prettier: pass
git diff --check: pass
```

本单元结论为`implemented / verified`。方案A的只读producer现已完成；下一文件单元可以新增单步`wakeflow_resume_target_result_review` Public Contract/Coordinator和第13个MCP工具，并用当前blocked Inspector输出构造exact Resume request。

### 218.16 第三个文件单元：Resume公共wire

新增self-contained：

- `wakeflow-target-result-review-resume-request.schema.json`；
- `wakeflow-target-result-review-resume-result.schema.json`；
- 对应generated type/runtime Schema；
- `target-result-review-resume-public-contract.ts`；
- `target-result-review-resume-public-coordinator.ts`。

公共Request精确为：

```text
root
demandId
targetTaskId
expectedBlockedState:
  streamRevision
  stateDigest
resolutionSummary
```

Request Schema、64 KiB Canonical JSON容量和内部Resume selector codec三层准入。旧`targetResultId / blockedDecisionId / blockedDecisionDigest / blockedSnapshotDigest`均作为未知字段拒绝；公共调用方只提交Inspector/Route可取得的当前state CAS和Controller外部解决陈述。

Result返回：

```text
resumed | already-resumed
committed | idempotent
eventAuthority=current
完整ControllerTargetReviewResume
Resume Event/Commit receipt
Resume Event resultingStateDigest
```

status/disposition关系由self-contained Schema强制。Resume、blocked Decision/source和typed ID结构镜像Domain Schema；MCP wire不广告仓库私有URN，Domain codec继续拥有NFC、digest、Decision/Result/Snapshot和Event关系。

### 218.17 Public Coordinator与settled replay

Coordinator调用现有Service后逐项复验：

- request的Demand/Target/expected blocked state/resolution summary与Resume一致；
- 单一`review.target-result-resumed` Event及其确定性Event/Commit ID；
- Commit command digest、expected revision、first/last revision和Commit digest；
- Event recorded time、完整Resume bytes与resulting state digest；
- 首次committed时Target确实回到work type对应的`result-reported | test-result-reported`。

idempotent replay不要求后来Aggregate仍停在reported：Resume后形成第二代Decision时，exact Resume重放仍返回原Resume/Event/resulting state digest，不把当前accepted或其他phase误报成历史Resume失败。

Coordinator在Event append前拒绝resolution summary中的request/canonical workspace root，避免私有绝对路径进入持久Event；输出再次执行4 MiB容量、Schema和workspace root隐私检查。错误只公开`root | privacy | resume | output`、下层稳定code/reason和`unchanged | current | unknown` Event authority。

Completion与Resume一样为host-neutral owner：不消费Host Profile、Binding handle或宿主效果，因此Codex/Claude composition直接复用同一Coordinator，没有复制两个wrapper。

### 218.18 第十三个MCP工具

新增：

```text
wakeflow_resume_target_result_review
```

description与Server instructions固定正确顺序：

```text
Route → blocked Review Inspector
→ Controller核实外部阻断已解决
→ exact state Resume
→ Inspector重新返回reported generation
→ fresh independent checks
→ new Decision
```

工具不运行检查、不自动判断阻断已解决、不复用旧Decision、不accept/rework/redesign、不创建Test attempt/Delivery、不执行宿主效果。annotations：

```text
readOnlyHint: false
destructiveHint: false
idempotentHint: true
openWorldHint: false
```

`destructive:false`表达append-only恢复授权：旧Decision/Result全部保留，只重新开放审查资格，与现有Host Effect Rearm风险语义一致。

公共Server options/Proxy准入、稳定错误envelope、双宿主固定composition、官方stdio Client和candidate tool parity同步。两个候选现在发布相同13工具集合。

### 218.19 真实公共纵切与测试维护

新增一个Public Coordinator测试文件，仅两个真实测试：

1. Implementation完整路径：reported Inspector → public blocked Decision → blocked Inspector → stale/privacy拒绝 → public Resume → reported Inspector/prior history → public第二代accept Decision → settled Resume replay；
2. Test共享路径：内部Test blocked Decision → public blocked Inspector → public Resume → 同一Test Result/attempt identity → Test review Route重新开放。

MCP真实Codex测试增加一条独立短纵切，从现成reported fixture开始，不重复Claim/Outcome/Result前缀，也不执行宿主发送。它同时验证stale selector的脱敏错误和第二代Decision后的exact replay。

codegen mirror test固定：

- request/result self-contained与Foundation SHA/UTC词法；
- Request没有derived echoes；
- Result Resume字段与Domain Resume一致；
- blocked Decision/source字段集合不漂移。

最终聚焦组合：

```text
Resume internal Service
+ blocked/reported Inspector
+ Resume Public Coordinator
+ MCP
+ codegen
+ dual-host candidate:
  47 pass / 0 fail / 0 skip
TypeScript: pass
Schema: pass / 91 schemas / 207 external refs
Schema digest: sha256:d98726ce8347e69f73a4f4fd438107c57fb397a0211caf583a09d4baf8747c21
Architecture: pass / parser=swc / 678 modules / 4806 dependencies / 0 violations
Codex candidate: 389 compiled files / manifest sha256:2f5cd29bf8ec6cbafa695f26234e403e1e28215b23cc36100f0347eee5bea62c
Claude Code candidate: 394 compiled files / manifest sha256:b82c82d53992466407de0417b12b9c1a2b82d7a5979983c3483c9fd4ace0a4e2
Both candidates: 13 tools / releaseEligible=false
Prettier: pass
git diff --check: pass
```

### 218.20 方案A收束

方案A三个文件单元全部`implemented / verified`：

1. 内部Resume selector删除不可公开构造的derived echoes；
2. 现有Inspector增加当前blocked Context而不膨胀Route或新增重复Query工具；
3. 单步Resume公共工具用exact state CAS追加唯一Event，并要求重新Inspector/重新检查/新Decision。

旧JS/core、正式plugin制品、安装cache、版本、发布和外部Atlas均未修改；未运行旧JS全量`npm test`或正式plugin validator/smoke，没有提交。

当前公共Implementation路线已同时闭合accept→Completion、rework→Delivery和blocked→Resume；redesign仍是明确Design能力边界。下一主要Route缺口转向`real-environment-test-planning → TestCard Planning`公共入口，应先重新审阅TestCard authored content与策略Authority的公共最小输入，不直接批量公开整条Testing链。

## 219. real-environment TestCard Planning公共边界预审

### 219.1 本轮范围与结论状态

本轮同时按Governance、Controller和Test三个职责边界重新读取：

- `test-card.ts`、TestCard Schema、Planning Authority/Plan/Service与四项直接测试；
- Test Task Planning、Test TaskPackage派生和后续Test Delivery/Result对`approvedPlan`与Authority的消费；
- `DemandPostAcceptanceRoute`、`DemandControllerRoute`和当前13项公共MCP工具；
- 旧JS `createTestCardArtifact`、`wakeflow_intake_test_card`及旧TestCard Schema；
- TencentDB-Agent-Memory的Gateway schema→handler→store分层、`source_refs`溯源形状和粗粒度Task模型；
- ISTQB、Azure Test Plans与MCP当前官方资料。

本节最初结论为`pre-reviewed / awaiting decision`；用户随后确认方案A，实施结果记录在§219.8–§219.10。预审阶段本身没有修改生产代码、Schema、生成文件或测试。

### 219.2 TestCard的真实职责与可派生边界

TestCard仍应是S4→S5之间由Controller冻结的真实环境测试合同，不是Test自己制定的计划，也不是Test Task、attempt、run或Result：

```text
S1：用户确认Test决定、环境与原始测试意图
  ↓
S4：Controller完成Implementation功能验收并编写Card
  ↓
TestCard Event：冻结问题、测试章程、边界和来源
  ↓
Test Task Planning：把同一Card分配给Test Window
  ↓
Test执行批准合同；Result回到Controller审查
```

当前Planning owner已经正确派生并复验以下事实，公共调用方不应重复提交：

- Program/Demand identity、Demand goal与完整Authority digest；
- `test-environment`完整成员引用、Config Test Window和accepted Implementation baselines；
- Post-Acceptance Route、Review Snapshot与Event Stream尾部CAS；
- initial/retest generation source、TestCard/Target/Event/Commit identity与`createdAt`；
- `changeControl=return-blocked-to-controller`和`productSourcePolicy=read-only`。

当前15项`TestCardAuthoredContent`仍属于Controller判断：批准步骤、允许Skill、setup/attempt策略、单一问题、对象边界、Controller已完成检查、真实场景条件、成功/失败/不可推断/停止条件、证据以及允许/禁止操作。代码无法从Markdown Authority正文可靠推断这些语义，也不应让Test补写。

[ISTQB CTFL v4.0.1](https://istqb.org/wp-content/uploads/2024/11/ISTQB_CTFL_Syllabus_v4.0.1.pdf)区分test planning、test design、test implementation和test execution，并把test charter、test environment requirements、test logs分别放在不同工作产物中；其session-based exploratory testing也以目标导向的test charter约束探索，再记录实际步骤与发现。Wakeflow的S5正是“功能已由Controller接受后，对冻结环境风险做受约束探索”，因此当前`question + approvedPlan + boundaries + success/failure`形状合理；不把它机械改造成传统手工Test Case的逐步`Action/Expected Result`，避免引入并不存在的测试管理系统。

### 219.3 发现的根本问题：单一Strategy Authority不成立

R-2B-2曾把一个`strategyAuthority`加入TestCard，但当前代码事实证明该结论需要回溯修正：

- Ledger Authority允许同一role出现多个文档；它只保证成员路径唯一和稳定排序，不保证role唯一；
- requirement当前允许一个或多个`requirement-design`来源；
- bug的测试依据必须同时理解`reproduction`与`scope`，现实现却允许调用方任选其一；
- supplement必须同时理解原`requirement-design`与`requirement-delta`，现实现同样允许任选其一；
- 当前四项Planning测试只覆盖requirement的单个`requirement-design`，没有证明bug/supplement语义；
- 当前公共Controller Route只返回`test-card-planning`责任前沿，不返回可供调用方安全猜测的单一成员；直接公开现request会依赖Agent记住内部Ledger路径。

旧JS同样只校验`strategySource`命中任意一个冻结Authority成员，因此是问题来源，不是新TS应维持的标准。TencentDB-Agent-Memory没有TestCard相邻领域；它的`source_refs`会显式保存session与内容hash以便追踪，并明确不触发服务端跨接口隐式取数，只能支持“来源应显式、输入应在边界准入”这一一般原则，不能为单一测试策略来源提供依据。

[ISTQB的test basis→testware traceability](https://istqb.org/wp-content/uploads/2024/11/ISTQB_CTFL_Syllabus_v4.0.1.pdf)明确要求在test basis元素、testware、结果与缺陷之间保持可追踪关系；[Azure Test Plans](https://learn.microsoft.com/en-us/azure/devops/test/create-test-suites?view=azure-devops)也通过requirement-based suite把Test Case与Requirement建立明确关联。二者都支持“多来源可追踪”，不支持从多个有效来源中任意挑一个充当全部测试依据。

### 219.4 推荐的内部收敛

推荐把单一：

```text
strategyAuthority
strategyAuthorityMemberRef
```

替换为由owner确定性恢复的有序非空：

```text
testBasisAuthorities[]
```

第一阶段不建立可配置角色注册表，而按Demand类型固定最小basis集合：

| Demand type | Test basis roles |
| --- | --- |
| requirement | 全部`requirement-design` |
| bug | 全部`reproduction` + 全部`scope` |
| supplement | 全部`requirement-design` + 全部`requirement-delta` |
| research | 不允许进入real-environment TestCard Planning |

`test-environment`继续是独立`environmentAuthority`；完整Demand Authority digest继续覆盖non-goals、user confirmation和其余冻结来源。这样既不把所有需求文档复制为Test执行合同，也不会遗漏真正决定测试对象/方法的多份basis。

公共preview不再接收任何Authority路径选择，只接收`demandId + TestCardAuthoredContent`。Owner从当前冻结Authority恢复、校验、排序并写入完整`testBasisAuthorities`；Test TaskPackage随后确定性使用`testBasisAuthorities + environmentAuthority`作为导航引用。Caller仍负责语义上保证自己编写的Card来自这些已读basis，代码负责证明Card只引用当前冻结集合；不假装程序能够理解Markdown并自动生成测试判断。

### 219.5 公共工具和Route边界

建议新公共工具名：

```text
wakeflow_plan_test_card
```

它与`wakeflow_plan_target_task`保持同一命名层级，使用零写preview和exact-plan apply：

```text
preview:
  root + mode=preview + demandId + testCard authored content

apply:
  root + mode=apply + exact plan + planDigest
```

Preview返回完整TestCard/Event计划供Controller审阅；Apply只追加`testing.test-card-created` Event并返回Card与Event/Commit receipt。它不创建Test TaskPackage、不准备Delivery、不执行宿主效果、不运行环境操作，也不把Card解释为测试已经开始。Apply后必须重新Inspect Route，下一`test-task-planning`切片优先扩展现有`wakeflow_plan_target_task`接受内部已经支持的`{workType:"test"}`，不新增`wakeflow_plan_test_task`工具。

工具建议annotations：

```text
readOnlyHint: false
destructiveHint: false
idempotentHint: true
openWorldHint: false
```

TestCard写入是append-only且保留历史，不删除或覆盖旧事实；annotations仅是MCP提示，服务端仍必须执行Schema、容量、隐私、Authority、Route、CAS和Plan复验。[MCP 2025-11-25 Schema](https://modelcontextprotocol.io/specification/2025-11-25/schema)继续要求明确`inputSchema`，并允许`outputSchema`约束structured result；同一规范明确annotations只是hint，不能代替服务端授权。

另有一个必须在注册公共工具前修正的Route事实：当前全部Test Planning Authority只支持`executionPlacement.mode=main`，但Controller Route尚未据此阻止isolated/Pod Demand显示可执行`test-card-planning`。不应让Route先承诺能力、再由写工具返回`placement`失败。推荐增加typed `isolated-test-planning-not-implemented` blocker；本轮不顺带建设Pod Test access、multi-root probe或宿主能力。

### 219.6 三种互斥方案

| 方案 | Authority来源 | 公共边界 | 评价 |
| --- | --- | --- | --- |
| A（推荐） | `testBasisAuthorities[]`由Demand类型和全部匹配role确定性派生 | 修正main/isolated Route真实性后，独立公开`wakeflow_plan_test_card` preview/apply | 无调用方路径猜测；bug/supplement完整；工具最少；先修正确内部模型再冻结wire |
| B | 调用方从只读Planning Context选择一个或多个basis ref | 先新增Inspector/Route候选，再公开同一preview/apply | 追踪可更细，但增加新Query与选择状态；当前Authority没有“互斥候选”语义，容易让Agent遗漏必要来源 |
| C | 保留单一`strategyAuthorityMemberRef` | 直接包装现有Service | 改动最少，但把旧JS的单来源缺陷冻结进公共API，bug/supplement和同role多文档仍不闭合，不建议 |

把TestCard与Test Task合并为同一apply不列为候选：二者是两个独立Event owner，前者冻结测试合同，后者派生窗口任务；合并会删除当前Route检查点并扩大单次事务。

若确认A，仍按1–2个紧密文件的节奏推进：

1. `test-card.ts + test-card.schema.json`：单一Strategy改为非空Test Basis集合；
2. `test-card-planning-authority.ts + test-card-planning-service.ts`：确定性派生并删除caller selector；
3. `test-task-package.ts + 相邻Planning Authority`：消费复数basis并清理旧分支；
4. Controller Route及其wire：增加isolated Test capability blocker；
5. Public Contract/Coordinator；随后Schema/generated、MCP双宿主和聚焦测试作机械闭包。

测试保持轻量：保留现有requirement真实纵切；新增一个纯basis矩阵测试覆盖requirement/bug/supplement、多同role文档和稳定排序；不为每种Demand复制完整Delivery/Review fixture。

### 219.7 当前基线验证

```text
TestCard Planning + Test Task Planning + Controller Route focused:
  12 pass / 0 fail / 0 skip
```

该结果只证明现有单Requirement路径与相邻Route没有回归，不证明§219.3发现的多来源语义。未运行旧JS、完整TS套件、正式plugin validator/smoke、发布或提交。

### 219.8 方案A内部合同收敛

用户确认方案A后，先完成TestCard及其直接producer/consumer闭包，没有提前进入Route或公共MCP：

- `TestCardRouteSource`与`TestCard`删除单一`strategyAuthority`，改为非空`testBasisAuthorities`；
- codec要求basis按`memberRef`严格递增，拒绝重复、乱序、`test-environment`角色和环境成员复用；
- `createTestCard`从Route Source副本排序后构造Card，最终仍由同一严格parser复验；
- TestCard Schema同步改为1–32项完整Ledger Authority member reference数组；
- 没有保留旧字段、deprecated alias、双写或旧TS历史兼容分支。当前TS尚未发布，旧JS只作需求参考，不能成为新合同负担。

`TestCardAuthoredContent`、Card digest basis、generation source和accepted Implementation baselines均未改变。Test Basis只增加多来源追踪，不扩大Test判断权，也不把Authority Markdown正文复制进Card。

### 219.9 Planning确定性派生与直接消费者

`test-card-planning-authority.ts`新增纯函数`deriveTestCardBasisAuthorities`，固定矩阵为：

```text
requirement → 全部 requirement-design
bug         → 全部 reproduction + 全部 scope
supplement  → 全部 requirement-design + 全部 requirement-delta
research    → 拒绝
```

每个要求的role至少出现一次；返回值按`memberRef`稳定排序。Planning preview request因此删除`strategyAuthorityMemberRef`，只保留`demandId + testCard authored content`。Apply重建也直接从当前冻结Demand Authority恢复同一集合，不再从Plan取一个成员路径反向驱动来源选择。

直接消费者同步闭合：

- Planning Plan与Event Sourcing Command parser要求每个basis完整引用都存在于同一Demand Authority；
- Test TaskPackage的`selectedAuthorityRefs`由全部basis加独立environment引用确定性派生；
- Test Task Planning与Test Delivery Preparation逐项复验全部basis；
- `strategyAuthority`、`strategyAuthorityMemberRef`和`TEST_STRATEGY_ROLES`在`src/`与`tests/`中均已清零。

这里没有建立角色注册表、Strategy Resolver class、Test Basis投影文件或新状态。类型矩阵是TestCard Planning领域的闭合规则，纯函数足以表达。

### 219.10 测试维护与内部checkpoint

保留原Requirement真实纵切，只增加一项纯矩阵测试，覆盖：

- Requirement多份同role Design来源与稳定排序；
- Bug必须同时具有Reproduction和Scope，并保留多份Scope；
- Supplement同时具有原Design和Delta；
- Bug缺失Scope与Research均返回`test-basis`；
- Card Schema拒绝空basis，codec拒绝把environment混入basis。

没有为三种Demand复制完整Delivery/Review工作区fixture。原“caller传入environment冒充strategy”的测试随已删除输入一起移除，由Card codec和确定性派生测试覆盖真实风险。

```text
Focused Card / Task / Delivery / Test Review / Route / Decider / Upcaster:
  24 pass / 0 fail / 0 skip
TypeScript: pass
Schema: pass / 91 schemas / 207 external refs
Schema digest: sha256:5c5233025707f98f0243a7269dcdca6cd594fa430839b74d2e45ac58918ec630
Architecture: pass / parser=swc / 678 modules / 4806 dependencies / 0 violations
Prettier: pass
git diff --check: pass
```

方案A的内部Test Basis收敛至此`implemented / verified`。下一紧邻单元只修正Controller Route对main/isolated Test能力的真实表达；不会同时注册`wakeflow_plan_test_card`或建设Pod Test access。未运行旧JS、完整TS套件、正式plugin validator/smoke、发布或提交。

### 219.11 isolated Test Planning Route真实性

紧邻Route单元只修改Controller Route及其公共Result Schema，没有让Test Planning偷偷支持Pod：

- main placement继续返回`work-available + test-card-planning`；
- accepted real-environment Demand若为isolated placement，返回`blocked`；
- frontier仍明确指出被阻断的下一领域是`test-card-planning`；
- blocker固定为`isolated-test-planning-not-implemented / owner=test-card-planning`；
- 保留`postAcceptanceRouteDigest`，证明阻断发生在已重建的Post-Acceptance Test Route上，而不是缺失Route来源；
- controller-only isolated Demand的Completion Route不受影响。

公共Result Schema新增对应closed blocker，并严格区分两类blocked来源：isolated Test blocker必须携带`postAcceptanceRouteDigest`；既有redesign/research blocker继续禁止该字段。第一次Schema build因`contains`条件缺少显式`type:array`被Ajv strictTypes拒绝；补齐局部类型后正常通过，没有关闭strict mode或放宽Catalog验证。

测试fixture只增加可选`executionPlacement=isolated`：它发布同Demand的真实Confirmation member作为placement authorization，再由正常Identity/Authority admission进入现有Implementation接受纵切。Route测试因此使用真实已准入isolated Demand，不伪造Loaded Authority对象；同一测试同时证明公共Schema拒绝缺失Post-Acceptance digest和把普通research blocker伪装成Post-Acceptance blocker。

```text
Controller Route + public Schema/Coordinator + TestCard Planning focused:
  14 pass / 0 fail / 0 skip
TypeScript: pass
Schema: pass / 91 schemas / 207 external refs
Schema digest: sha256:d22ffaa25fa980f0d36efce259468cffbe0bfdfcdaeaea342b585cf65774a29c
Architecture: pass / parser=swc / 678 modules / 4808 dependencies / 0 violations
Prettier: pass
git diff --check: pass
```

Route真实性单元至此`implemented / verified`。它只诚实暴露当前能力缺口，没有创建Pod Test access、multi-root probe、Pod Binding、Test Task或宿主效果。下一单元可以开始`wakeflow_plan_test_card` Public Contract/Coordinator；内部Card来源与Route准入已经不再需要公共调用方猜测Authority路径。

### 219.12 `wakeflow_plan_test_card`公共wire

新增两份self-contained MCP Schema及generated type/runtime Schema：

- `wakeflow-test-card-planning-request.schema.json`；
- `wakeflow-test-card-planning-result.schema.json`。

Request为严格preview/apply判别联合：

```text
preview:
  root
  mode=preview
  demandId
  testCard = 15项Controller-authored content

apply:
  root
  mode=apply
  plan = 完整TestCard Planning Plan
  planDigest
```

Preview没有`strategyAuthorityMemberRef`、Test Basis selector、环境选择、Test Window、accepted baselines、generation source、时间或Event identity；这些事实全部由内部owner派生。Apply保留完整Demand Authority、TestCard和generation source，使Event已经提交后的精确重放仍能恢复原Command，而不依赖后来展示状态。

Result同样为严格联合：preview返回完整plan供Controller/用户审阅；apply返回`created | already-created`、`committed | idempotent`、`eventAuthority=current`、完整Card、generation source以及Event/Commit/state receipt。Schema固定status/disposition关系，不返回next action；调用方必须重新读取Controller Route。

两份Schema没有外部URN。TestCard、Demand Authority、Ledger member、Generation Source、Portable Path、SHA与UTC定义以内联`$defs`表达，并由codegen mirror test持续核对Domain字段集合和Foundation词法。公共preview的authored字段精确固定为15项，测试同时证明旧Strategy selector不能重新进入wire。

### 219.13 Public Contract与Coordinator

新增：

- `test-card-planning-public-contract.ts`：24 MiB Canonical JSON容量、passive JSON与self-contained request Schema准入；
- `test-card-planning-public-coordinator.ts`：RootedDirectory生命周期、隐私、内部Service调用和公共结果复验。

Coordinator不解释Card语义。它只执行：

```text
parse public request
→ hold canonical workspace root
→ reject request/canonical root text inside authored Card or frozen Plan
→ call internal preview/apply owner
→ verify exact Plan/Event/Commit/Card/generationSource closure
→ validate bounded redacted public result
→ close root
```

Apply结果逐项复验单一`testing.test-card-created` Event、expected/actual stream revision、Commit ID/sequence/digest、Command digest、Card createdAt和完整Event data。首次commit要求Aggregate current TestCard与Event resulting state闭合；idempotent replay返回原Event receipt，不要求后来Aggregate仍停在刚创建Card的阶段。

错误只公开`root | privacy | preview | apply | output`、下层稳定code/reason和`unchanged | current | unknown` Event authority。Coordinator不创建Test Task、Delivery/attempt、WorkClaim或宿主效果，也不根据Card内容作Test结论。

### 219.14 聚焦测试与维护记录

新增一个Public Coordinator测试文件，仅两项：

1. 真实accepted real-environment Demand：零写preview→exact apply→唯一Card Event→Route进入`test-task-planning`→exact replay idempotent；
2. 未知旧selector、Proxy、24 MiB容量、错误root、preview/apply私有绝对路径和伪造plan digest全部在Event写入前拒绝，Demand inventory保持不变。

第一次组合运行出现`12 pass / 1 fail`：失败来自断言把validator返回的null-prototype JSON对象与普通对象做`deepStrictEqual`，字段内容完全相同。断言改为验证`generationSource.kind`判别值后，Public测试`2/2`通过；没有修改runtime representation迎合测试。

```text
Public Contract/Coordinator + Domain Service + Route + codegen mirror:
  14 pass / 0 fail / 0 skip
TypeScript: pass
Schema: pass / 93 schemas / 207 external refs
Schema digest: sha256:8d5449fe95db831f192fe821300cd0c6e5ac5dd68eba3ae9c11fdb230f2f573d
Architecture: pass / parser=swc / 683 modules / 4826 dependencies / 0 violations
Prettier: pass
git diff --check: pass
```

Public Contract/Coordinator单元至此`implemented / verified`，但尚未形成production composition-root consumer。下一单元只注册第14个MCP工具、双宿主固定composition、Server instructions、稳定错误envelope和candidate parity；不会同时公开Test Task Planning。

### 219.15 第十四个MCP工具

公共Server新增：

```text
wakeflow_plan_test_card
```

工具title为`Plan Wakeflow Test Card`，input/output直接使用§219.12两份self-contained Schema。annotations固定为：

```text
readOnlyHint: false
destructiveHint: false
idempotentHint: true
openWorldHint: false
```

`destructive:false`表达append-only Card Event：它不删除或覆盖历史，也不关闭其他能力。Apply仍是状态写入，因此`readOnly:false`；exact plan retry返回同一Event receipt，因此`idempotent:true`。

Tool description和Server instructions同步固定正确顺序：

```text
inspect Demand Route
→ 仅当frontier=test-card-planning
→ Controller编写已确认Card内容
→ preview完整Card/Event plan
→ review exact plan
→ apply同一plan + digest
→ inspect Demand Route again
```

说明显式列出owner派生的Test Basis、environment Authority、accepted baselines、Test Window、generation source、时间和Event identities，避免Agent重新提交这些事实。同时明确工具不创建Test Task/Delivery、不运行Test、不执行宿主效果，也不产生Test结论。

### 219.16 Composition、错误边界与双宿主

`CreateWakeflowPublicMcpServerOptions`新增必需`planTestCard` executor，并在读取任何字段前继续执行closed options、function和Proxy拒绝。缺失、额外或Proxy executor分别稳定归入`options | test-card-planning-executor`，没有可选占位或运行时fallback。

错误envelope新增TestCard Public Contract/Coordinator映射：

- Contract只公开`code/reason/path`；
- Coordinator只公开`code/reason/causeCode?/causeReason?/eventAuthority`；
- workspace root、Card正文和Plan正文不会进入错误结果；
- 未知异常仍统一降为`wakeflow-unexpected/unexpected`。

Codex与Claude Code composition root都直接注入同一个host-neutral `executeTestCardPlanningPublicRequest`。没有创建两个host wrapper：Card Planning不消费Host Profile、Binding handle或宿主效果，双宿主分叉没有真实依据。

### 219.17 MCP真实纵切与候选制品

MCP测试维护包括：

- composition options新增Proxy负例；
- tools/list从13更新为14，并核对TestCard Schema ID、annotations、自包含Schema和职责文案；
- Codex/Claude Code工具名集合严格相同；
- 官方SDK在进入owner前拒绝旧`strategyAuthorityMemberRef`；
- Coordinator privacy错误通过稳定MCP envelope返回，且不回显workspace root；
- 真实Codex MCP纵切从`test-card-planning` Route开始，完成preview/apply/retry，最后Route进入`test-task-planning`；
- candidate manifest与两个stdio入口都核对同一14工具集合。

```text
MCP + Public Coordinator + codegen mirror focused:
  40 pass / 0 fail / 0 skip
Candidate build / stdio parity focused:
  2 pass / 0 fail / 0 skip
TypeScript: pass
Schema: pass / 93 schemas / 207 external refs
Schema digest: sha256:8d5449fe95db831f192fe821300cd0c6e5ac5dd68eba3ae9c11fdb230f2f573d
Architecture: pass / parser=swc / 683 modules / 4836 dependencies / 0 violations
Codex candidate: 396 compiled files / manifest sha256:f50325609a684c88d743518b2b2f138d936fddd83ee229c7c8ed38c1f8502128
Claude Code candidate: 401 compiled files / manifest sha256:d7f3543f8d42ded4a8610d9b97e9e8c33b874396d35d1162e814f28c0e5518c8
Both candidates: 14 tools / releaseEligible=false
Prettier: pass
git diff --check: pass
```

TestCard Planning公共纵切至此`implemented / verified`：内部Test Basis、main/isolated Route、Public Contract/Coordinator、MCP、双宿主和候选制品已经闭合。下一Route前沿为`test-task-planning`；进入下一单元前应重新审阅现有`wakeflow_plan_target_task`公共合同，优先扩展同一工具的`workType:test`判别分支，不新建重复Test Task工具。

## 220. `wakeflow_plan_target_task` Test分支

### 220.1 预审结论与旧公共边界问题

内部`TargetTaskPlanningService`、`TargetTaskPlanningInput`与`TestTaskPlanningAuthority`已经具有成熟Test分支：调用方只提交`{workType:"test"}`，owner从当前TestCard Event派生完整TaskPackage、复验Route/Config/Authority/baselines/WorkClaim并复用同一`tasking.target-task-planned`Event。这里没有需要用户重新选择的业务方案，也没有新建Test专用工具的依据。

真正缺口全部位于公共边界：

- Request/Result Schema把Plan和TaskPackage硬编码为implementation；
- Coordinator的apply projection显式拒绝Test；
- apply回执读取当前Aggregate phase/state digest，若同一Planning plan在后续Delivery之后精确重放，结果会随当前状态漂移；
- 公共request没有容量上限；
- Implementation authored content或Apply plan可以携带workspace root，直到output阶段才可能被间接发现，存在写入Event前的隐私缺口。

因此本单元不是给内部Service增加第二条流程，而是让公共wire忠实表达现有Domain联合，并回溯修正两个公共基础门禁。

### 220.2 Request与TaskPackage判别联合

同一`wakeflow_plan_target_task`保留preview/apply和工具身份。Preview request现在严格为：

```text
implementation:
  demandId
  taskPackage:
    workType=implementation
    assignment/objective/context/Authority refs/boundaries/
    completion/commit expectation/acceptance anchors

test:
  demandId
  taskPackage:
    workType=test
```

Test request的`additionalProperties:false`使assignment、objective、Authority、TestCard tuple、边界或完成条件全部无法由caller重写。Preview仍由内部owner恢复当前Card并派生完整Package；Test Target ID继续复用Card预留identity。

Apply Plan中的TaskPackage改为完整Domain判别联合，不再维护一份implementation-only近似Schema。Self-contained wire以内联定义镜像Domain的assignment、TestCard tuple、Authority refs、文本和typed IDs；codegen test固定Domain字段集合与两个request变体。

### 220.3 Apply Result与稳定Event receipt

Apply Result的`targetTask`新增公共判别字段：

```text
implementation:
  workType=implementation
  target/task package/repository/window
  phase=planned

test:
  workType=test
  target/task package/window
  phase=planned
  testCard tuple
```

Test分支禁止`repositoryId`；Implementation分支禁止`testCard`。这是新TS尚未发布的公共合同收敛，没有保留缺少`workType`的旧输出兼容形状。

Coordinator不再把当前Aggregate phase当作Planning receipt。它定位plan对应的唯一`tasking.target-task-planned`Event，并复验：

- request plan/digest与Service result；
- Command/Commit ID、revision、digest和单Event边界；
- Event完整TaskPackage与createdAt；
- Aggregate中同一Target identity与work type关系；
- create-only projection的source Event、完整Package和Package digest。

首次commit仍要求当前Aggregate位于该Event resulting state；idempotent replay允许Aggregate后来进入Delivery/Result阶段，但公共回执始终返回`phase=planned + Event resultingStateDigest`。因此Planning receipt表达“这条规划Event创建了什么”，不伪装成当前状态Query；当前状态继续由Controller Route拥有。

### 220.4 统一容量与隐私门禁

Public Contract新增24 MiB Canonical JSON请求容量，与16 MiB TaskPackage projection上限保留wire余量。Contract稳定增加`capacity`原因。

Coordinator在调用内部Service前扫描：

- Implementation preview authored package；
- Test preview最小selector；
- 两种work type的完整Apply plan。

request root和RootedDirectory canonical root均不得进入这些持久内容；命中时返回`privacy + eventAuthority=unchanged`。Output继续执行24 MiB、Schema和根文本检查。根路径`/`不作为子串扫描值，避免把所有portable path误判为隐私泄漏；实际Workspace authority仍由RootedDirectory和内部Service验证。

### 220.5 MCP说明与测试维护

工具数量保持14。Tool description和Server instructions现在区分：

- Implementation Task Planning：Controller提交完整authored package；
- Test Task Planning：只提交`taskPackage={workType:"test"}`，其余全部派生。

两者Apply都只追加Planning Event并物化create-only projection，不准备Delivery或执行宿主效果。

新增一个Public Coordinator测试文件，仅两项：

1. Test最小request→零写preview→完整派生Package→apply→typed Test Target receipt→Route进入`test-delivery-planning`→exact replay；
2. Implementation/Test共享容量与根隐私门禁，preview/apply失败后Demand inventory不变。

MCP真实Test纵切在既有TestCard案例上继续推进：Card apply/retry→Route `test-task-planning`→同一`wakeflow_plan_target_task` Test preview/apply/retry→Route `test-delivery-planning`。SDK另行证明带额外objective的Test request在进入owner前被拒绝。没有为Test复制一套MCP工具测试。

```text
Public/Domain Task Planning + Test Task + codegen mirror focused:
  11 pass / 0 fail / 0 skip
MCP focused:
  37 pass / 0 fail / 0 skip
Candidate build / stdio parity focused:
  2 pass / 0 fail / 0 skip
TypeScript: pass
Schema: pass / 93 schemas / 207 external refs
Schema digest: sha256:6266aa692f55a3f5ea94c02aa4903700dfce11841bc8f6d1d0a0645b3c7a10d5
Architecture: pass / parser=swc / 684 modules / 4846 dependencies / 0 violations
Codex candidate: 396 compiled files / manifest sha256:af2e461e60bb83c8f17f2bd5da2161ceeaa8ecc21ce96219fb9f6cfe8b5d6f10
Claude Code candidate: 401 compiled files / manifest sha256:5fe244332f3a126d3cbe429306f523829df038d6e8c5adda99b268e6e8ba46ed
Both candidates: 14 tools / releaseEligible=false
Prettier: pass
git diff --check: pass
```

Test Task公共纵切至此`implemented / verified`。当前Route下一前沿为`test-delivery-planning`；下一单元应先重读initial/rerun/replacement三种内部Test Delivery Preparation request，决定如何在不膨胀成巨型action工具的前提下扩展现有Delivery公共边界。

## 221. Test Delivery Preparation公共边界预审

### 221.1 当前内部三种模式的真实语义

`TestDeliveryPreparationService`当前使用同一preview/apply owner和同一`testing.test-delivery-prepared`Event family表达三种闭合变体：

| 当前mode | Route来源 | logical attempt | 新建身份 | 语义 |
| --- | --- | --- | --- | --- |
| `initial` | `test-delivery-planning` | 创建ordinal 1 | attempt + delivery + event + commit | Card首次执行授权 |
| `rerun` | `test-another-attempt-planning` | 创建下一连续ordinal | attempt + delivery + event + commit | Controller审查后授权新的logical attempt |
| `replacement-authorization` | `test-delivery-replacement-planning` | 沿用当前attempt | delivery + event + commit | 旧宿主效果明确未发生后的新Delivery授权 |

三者都会恢复同一Test TaskPackage/TestCard、当前Config、Test Window Binding和product WorkClaim absence，并创建新的`WakeflowTestDeliveryIntent`。Preparation从不创建WindowWorkClaim、不返回Agent Host Action、不运行环境操作，也不调用宿主。

Rerun与replacement不能合并：前者消耗`TestCard.maxAttempts`并绑定上一Result/Controller Decision；后者只增加同一attempt的有界Delivery authorization。Initial与rerun也不能被称为自动retry：Wakeflow没有timer/background retry，rerun必须由已经存在的`request-another-attempt` Decision准入。

### 221.2 发现的公共构造问题：当前request全是历史echo

当前内部preview request要求：

```text
initial:
  mode + demandId + targetTaskId

rerun:
  mode + demandId + targetTaskId
  + previousAttemptId
  + previous Result ID/digest
  + Review Decision ID/digest

replacement:
  mode + demandId + targetTaskId
  + previous Target Delivery ID
  + Claim/action ID
  + Observation digest
```

但后两组字段不是Controller的新选择：

- `test-another-attempt-planning`已唯一携带previous attempt、Result与Decision tuple；
- `test-delivery-replacement-planning`已唯一携带rejected Delivery、Claim和Observation tuple；
- Aggregate current tail和Event history再次保存同一关系；
- Authority loader当前只是把caller echo与这些唯一事实逐项比较，再从history读取完整对象。

Controller Route为了保持薄application read model，有意只公开frontier和Target摘要，不公开这些完整领域来源。要求公共调用方记住早先工具输出才能构造下一步，会破坏任务恢复，并把stale echo误当授权。

推荐先把内部preview request收敛为：

```text
{ demandId, targetTaskId }
```

Authority owner从当前Post-Acceptance Route唯一派生`initial | rerun | replacement-authorization`及其完整source。Plan/Intent仍显式记录attempt/replacement lineage；只删除Command边界的冗余输入，不删除持久审计事实。Apply继续按Plan内Intent恢复相同模式并重验当前来源。

### 221.3 Implementation与Test公共工具不应合并

现有Implementation公共工具为`wakeflow_prepare_implementation_delivery`；内部owner是`TargetDeliveryPreparationService`，Event为`delivery.target-delivery-prepared`，Intent包含Implementation rework/product-defect remediation和portable prompt。

Test使用独立`TestDeliveryPreparationService`、`testing.test-delivery-prepared`、Test attempt、TestCard、environment directive、replacement authorization和后续Test Dispatch Packet。两者相同的只有application动作“preview/apply一份Delivery Preparation”，并不共享Plan、Intent、Command、Event或领域错误。

把两者改成一个`wakeflow_prepare_target_delivery`需要：

- public request/result各自容纳两套大Plan/Intent；
- 一个Coordinator根据work type分派两个Service和两套host facade错误；
- 工具description同时解释Implementation rework与Test attempt/replacement；
- Route虽明确给出不同owner，公共层却重新合并。

这不会越过Claim/Host Effect边界，但会让一个原本清晰的工具成为大型判别入口。工具数减少1不是足够的领域依据。此前§210选择Implementation专名正是为了避免未来Test语义重叠；现在Test路线真实抵达，应补齐相邻Test工具，而不是推翻内部owner边界。

### 221.4 旧JS、Tencent与官方实践

旧JS `wakeflow_prepare_delivery`混合target preview/apply/claim/rearm和Controller-return preview/apply/pre-send共七个operation。它能证明Preparation、Claim、Outcome必须分步，却也是“大工具按operation分发”的反例。旧JS会从state自动判断初始、later attempt或replacement，这项“mode由当前状态派生”的原则可保留；其旧`resume/restart`与caller restart index已经被新TS删除。

TencentDB-Agent-Memory没有TestCard、Test attempt或Agent Delivery相邻模型。其Gateway/worker会区分`retryable`、attempt数和non-retryable错误，pipeline worker再按内部state决定requeue或dead letter；这支持“重试分类由owner根据当前事实决定，不由调用方回送内部计数”，但不能决定Wakeflow工具粒度。

[Playwright retries](https://playwright.dev/docs/test-retries)为每次retry保留独立序号并在失败后创建新worker；[GitHub Actions rerun](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs?tool=webui)保留原始SHA/ref并区分历史run attempt；[Kubernetes Pod failure policy](https://kubernetes.io/docs/tasks/job/pod-failure-policy/)把是否retry、是否忽略以及replacement行为交给Controller按失败事实分类。这些资料共同支持Wakeflow保留logical attempt、physical replacement与retry policy三层分离。

[MCP Tools规范](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)不规定工具交互模式，要求工具具有清晰name、description和input/output Schema；[2026-07 Release Candidate](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/)允许完整JSON Schema 2020-12判别联合。协议允许统一，不代表领域上应该统一；当前选择应由owner、确认边界和Schema可理解性决定。

### 221.5 三种互斥公共方案

| 方案 | 公共工具 | 优点 | 代价/结论 |
| --- | --- | --- | --- |
| A（推荐） | 保留`wakeflow_prepare_implementation_delivery`；新增一个`wakeflow_prepare_test_delivery`，内部覆盖initial/rerun/replacement | 一工具对应一个真实Event owner；Test三种模式仍在同一闭合联合；Schema、错误和说明清楚；Route owner直接映射 | 工具数从14增至15，但没有重复Capability |
| B | 把现有工具改名为`wakeflow_prepare_target_delivery`，用work type联合两个Service | 工具数保持14；表面动作统一 | 合并两套大Plan/Intent/Event/error；公共Coordinator成为跨bounded-context switch；不建议 |
| C | 新增Test工具但先只公开initial，rerun/replacement后续再补 | 首次实现较小 | 已知Route会在后两种状态形成公共死端；同一工具Schema反复演化，不能称完整Test路线 |

不把initial/rerun/replacement拆成三个工具：它们共享一个Test Delivery owner、Event和exact-plan确认边界，拆分只会复制Schema和说明。

### 221.6 推荐A的拟定公共边界

内部selector收敛后，Test工具Request建议为：

```text
preview:
  root + mode=preview + demandId + targetTaskId

apply:
  root + mode=apply + exact TestDeliveryPreparationPlan + planDigest
```

Preview result完整返回Intent，让Controller看到owner派生的是initial、rerun还是replacement；Apply result返回稳定Event/Commit receipt和：

```text
workType=test
authorizationKind=initial | rerun | replacement
target/task package/TestCard
testAttemptId + attemptOrdinal
targetDeliveryId + intentDigest
host/window/binding
phase=test-delivery-prepared
```

Result不返回Agent Host Action或Dispatch Packet；后者由下一Claim owner按已提交Intent物化/验证。工具annotations与Implementation Preparation相同：`readOnly=false / destructive=false / idempotent=true / openWorld=false`。

建议实施顺序：

1. `test-delivery-preparation-input.ts + authority.ts`：删除mode与历史echo，按Route派生完整source；
2. `test-delivery-preparation-service.ts + 聚焦测试`：preview选择派生source，三种真实纵切保持通过；
3. Test公共Request/Result Schema与Contract/Coordinator；
4. 第15个MCP工具、双宿主composition、真实initial/rerun/replacement公共测试和candidate parity。

### 221.7 当前基线

```text
Test Delivery initial/rerun/replacement
+ Implementation Preparation public boundary
+ Controller Route focused:
  19 pass / 0 fail / 0 skip
```

本轮只做预审与文档记录，没有修改生产代码、Schema、生成文件或测试。未运行旧JS、完整TS套件、正式plugin validator/smoke、发布或提交。当前推荐方案A，等待用户确认后从内部selector收敛开始。

### 221.8 用户确认A与内部selector收敛

用户确认方案A后，本单元只修改内部Test Delivery输入、Authority、Service及相邻测试，没有提前创建Public Schema或第15个工具。

`TestDeliveryPreparationPreviewRequest`现在精确为：

```text
{
  demandId,
  targetTaskId
}
```

删除内容包括：

- caller `mode: initial | rerun | replacement-authorization`；
- rerun的previous attempt/Result/Decision tuple；
- replacement的previous Delivery/Claim/Observation tuple；
- Input层只为这些旧echo存在的digest与WindowWorkClaim parser/error分支。

携带任何旧mode或source字段都会按closed input在打开Demand Context和分配UUID前返回`input`。没有deprecated alias、兼容分支或silent ignore。

### 221.9 Current Source Authority

Authority新增`loadCurrentTestDeliveryPreparationSources`作为唯一preview/apply当前来源入口。它先从已加载Aggregate定位同一Test Target，再按当前phase选择候选分支：

```text
planned                        → initial
test-another-attempt-requested → rerun
test-host-effect-rejected      → replacement-authorization
其他phase                      → route failure
```

该phase switch不是写授权。每个被选分支仍独立重建并复验完整Post-Acceptance Route、TaskPackage/TestCard、Config、Binding、product/Test Window Claims和Event history。

Rerun loader现在直接从`route.nextStage.testReview`构造`rerunSource`，再闭合Aggregate current Result/Decision和完整历史；Replacement loader直接从`route.nextStage.rejectedDelivery`恢复old Delivery/Claim/Observation selector，再闭合Prepared/Claim/Observed Event与物理Claim absence。返回给Service的discriminated sources和最终Intent形状保持不变。

Service preview不再根据caller mode分派。Apply首次写入也从当前phase/Route恢复唯一source，再按Plan中已冻结的attempt/replacement identity与时间重建完整Intent并做Canonical equality；因此伪造Plan模式或lineage仍会在Event append前失败。Event已提交的exact replay继续只从不可变Event恢复TaskPackage/TestCard，不依赖当前Route。

### 221.10 测试维护与内部checkpoint

测试删除了手工构造合法rerun/replacement source的重复代码，改为：

- 先由真实Controller Test Decision或rejected Host Effect形成Route；
- preview只提交Demand/Target；
- 直接检查Plan Intent中owner派生的rerun/replacement lineage；
- 旧initial/rerun/replacement request字段分别按`input`拒绝；
- UUID分配计数证明旧rerun echo在identity allocation前被拒绝。

真实语义保持：initial创建ordinal 1；rerun创建ordinal 2并绑定原Decision/Result；replacement沿用同一attempt并追加authorization ordinal 2；packet、Claim和下一次Agent Host Action继续闭合。

```text
Initial/rerun/replacement + packet/Claim/Outcome combined focused:
  14 pass / 0 fail / 0 skip
Final affected selector/Delivery/Outcome rerun:
  10 pass / 0 fail / 0 skip
TypeScript: pass
Schema: pass / 93 schemas / 207 external refs
Schema digest: sha256:6266aa692f55a3f5ea94c02aa4903700dfce11841bc8f6d1d0a0645b3c7a10d5
Architecture: pass / parser=swc / 684 modules / 4842 dependencies / 0 violations
Prettier: pass
git diff --check: pass
```

内部selector收敛至此`implemented / verified`。下一单元可以建立独立`wakeflow_prepare_test_delivery` Request/Result Schema与Public Contract/Coordinator；三种mode只出现在owner生成的Plan/Result，不再出现在preview Command输入。

### 221.11 Test Delivery公共Schema与Contract

本单元新增独立`wakeflow_prepare_test_delivery`的Request/Result Schema和手写Public Contract，但没有注册MCP工具。公共Request保持已确认的exact-plan边界：

```text
preview = root + mode=preview + demandId + targetTaskId
apply   = root + mode=apply + exact TestDeliveryPreparationPlan + planDigest
```

Preview没有`initial/rerun/replacement`选择器，也没有previous attempt、Result、Decision、Delivery、Claim或Observation echo。完整Test Delivery Intent仍在Plan中保留，并继续使用领域合同定义的：

- initial/rerun logical Test attempt；
- TestCard identity与环境准备directive；
- rejected-before-effect replacement authorization；
- TaskPackage、Host、Window和Binding lineage；
- Canonical Intent digest与prepared time。

两份wire Schema均为JSON Schema 2020-12自包含合同；`intent`与`testExecutionAttempt`字段集合分别镜像领域Schema，Foundation的SHA-256、UTC Instant和Portable Resource Path词法保持本地闭合。Request只包含Plan真正需要的30项定义，没有复制Result-only receipt或摘要定义。

Apply result明确投影：

```text
workType=test
authorizationKind=initial | rerun | replacement
targetTaskId + taskPackageId/digest + TestCard tuple
testAttemptId + attemptOrdinal
targetDeliveryId + intentDigest
hostId + windowId + bindingId
phase=test-delivery-prepared
```

`replacement` Plan中的Claim/Event/Observation digest tuple是拒绝历史的审计来源，不是新的WindowWorkClaim或宿主执行参数。公共Result不返回Dispatch Packet、完整Claim、Agent Host Action、raw handle或宿主效果。

### 221.12 Public Coordinator与Event闭合

`test-delivery-preparation-public-coordinator.ts`固定并复验当前Host Resource/Identity Profile，再把preview/apply交给现有`TestDeliveryPreparationService`。Coordinator不重新实现Route或mode判断，也没有跨Implementation/Test的统一switch。

Apply投影在输出前复验：

- request Plan与Service返回Plan Canonical相等，plan digest相同；
- Commit只包含唯一`testing.test-delivery-prepared` Event；
- Event/Commit/Demand/stream revision与Plan identity、expected revision闭合；
- Commit command digest与重新计算的commit digest闭合；
- Event recorded time和完整Intent与Plan一致；
- 首次提交时Aggregate current Test Target、attempt尾部、delivery authorization尾部和resulting state digest一致；
- exact idempotent replay可在后续Event已经推进Aggregate时继续返回原Event的稳定state digest；
- 输出通过容量、递归JSON、Schema和workspace root文本泄漏检查。

Public Coordinator只把Intent是否含replacement以及attempt mode映射为稳定`authorizationKind`；它不创建Dispatch Packet、Claim或Host Action。MCP Server、Codex/Claude入口和artifact candidate本单元均未修改，工具总数仍为14。

### 221.13 聚焦验证与下一核实点

新增公共测试真实完成一次initial纵切：preview零写、伪造digest在Event前失败、exact apply提交唯一Event、Route进入`test-dispatch-planning`、同Plan重放幂等且不泄漏workspace root/raw handle。边界测试同时拒绝旧mode、rerun/replacement echo、开放字段、Proxy、超容量、非冻结Host facade和不存在的根。

内部既有测试继续覆盖真正的rerun与replacement状态链；没有在Public测试中复制一套长流程fixture：

```text
Public Schema/Coordinator latest focused:
  3 pass / 0 fail / 0 skip
Public + internal initial/rerun/replacement/Outcome combined:
  13 pass / 0 fail / 0 skip
TypeScript: pass
Schema: pass / 95 schemas / 207 external refs
Schema digest: sha256:2e6f9ee059335e0601f0a1977e7d787577d966f4c23370585eaf1b28b2811916
Architecture: pass / parser=swc / 689 modules / 4865 dependencies / 0 violations
Prettier: pass（本单元人工维护文件）
git diff --check: pass
```

本单元至此`implemented / verified`，但还不是可调用MCP能力。下一单元应注册第15个`wakeflow_prepare_test_delivery`工具，接入Codex/Claude固定Host facade与annotations，并从公共入口补齐initial/rerun/replacement模式矩阵和双宿主artifact candidate parity；仍不得把Preparation与Claim/Host Effect合并。

### 221.14 MCP注册前的官方规范复核

本单元在接入共享MCP server前重新核对当前官方资料。MCP的`Tool`继续以name、description、input Schema、可选output Schema和annotations描述；声明output Schema时，成功结果的structured content必须满足该Schema。当前2026-07-28规范已把Tool Schema提升为完整JSON Schema 2020-12，input仍保持object根约束并支持`oneOf/$ref/$defs`，因此现有自包含preview/apply判别联合不需要退化为手写operation switch。

- [MCP 2026-07-28 Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)明确要求Tool Schema默认采用JSON Schema 2020-12、声明output Schema时structured content必须闭合，并建议同时返回序列化TextContent；
- [MCP 2026-07-28 Schema Reference](https://modelcontextprotocol.io/specification/2026-07-28/schema)保留`readOnlyHint/destructiveHint/idempotentHint/openWorldHint`结构；
- [Tool Annotations as Risk Vocabulary](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/)强调annotations只是风险提示，不是安全合同，硬保证必须来自授权层和runtime。

据此，Test Delivery Preparation annotations为：

```text
readOnlyHint=false
destructiveHint=false
idempotentHint=true
openWorldHint=false
```

理由是apply会追加本地Event，因此不是只读；更新是加法式且exact apply可幂等重放；它只访问root-scoped Wakeflow authority，不接触开放世界。Schema、Coordinator、Service和Event CAS仍是实际强制边界，annotations不承担授权职责。

### 221.15 第十五个MCP工具与双宿主composition

共享`wakeflow-public-mcp-server.ts`现在注册`wakeflow_prepare_test_delivery`，同时提供完整自包含input/output Schema、canonical text content和structured content。Server composition新增独立`prepareTestDelivery` executor准入、Proxy拒绝、稳定配置错误和脱敏领域错误envelope；没有复用Implementation executor或增加跨work type switch。

工具说明和server instructions固定以下顺序：

1. Controller先从Demand Route看到Test Delivery Planning；
2. preview只提交Demand和Test Target identity；
3. owner从当前Route/Aggregate/Event history派生initial、rerun或rejected-before-effect replacement；
4. Controller审阅完整Plan后原样apply；
5. apply只追加`testing.test-delivery-prepared` Event；
6. 重新查看Route，再进入共享Host Effect Claim owner。

Preview不得回送mode或previous attempt/Result/Decision/Delivery/Claim/Observation。Apply必须回送完整preview Plan；这不是caller重新声明lineage，而是exact-plan确认。

Host seam继续保持显式且薄：

- `codex-wakeflow-test-delivery-preparation.ts`固定Codex Resource/Identity Profile；
- `claude-code-wakeflow-test-delivery-preparation.ts`固定Claude Code Resource/Identity Profile；
- 两个Host MCP composition root只注入各自executor；
- Testing领域模块没有Codex/Claude条件分支。

工具总数由14增至15。Implementation与Test Preparation仍是两个工具；后续共享Claim/Outcome owner保持不变。

### 221.16 真实模式矩阵、候选制品与实现发现

没有为三种Test Delivery模式复制新的长fixture。现有真实纵切调整为：

- initial：通过Codex官方MCP Client执行preview/apply/replay，确认Route从`test-delivery-planning`进入Public frontier `test-host-effect-claim`；
- rerun：真实Controller `request-another-attempt` Decision后，合法Preparation改走Public Coordinator，Apply result明确为`authorizationKind=rerun`；
- replacement：真实rejected-before-effect Outcome释放Claim后，合法Preparation改走Public Coordinator，Apply result明确为`authorizationKind=replacement`，随后仍能物化Packet并取得fresh Claim；
- 三条路径都证明Preparation没有创建Claim、返回Action或执行Host Effect。

测试过程还确认了两个已有边界事实：Public Contract返回的递归JSON记录使用null prototype，测试不能用原型敏感断言把它误判为内容差异；内部`test-dispatch-planning`在Public Controller Route中按下一真实owner投影为`test-host-effect-claim`，不是同名状态透传。这两项只修正测试断言，没有修改生产行为。

最终验证：

```text
Shared MCP server focused: 38 pass / 0 fail / 0 skip
Test Delivery/Outcome/Public/Candidate focused: 14 pass / 0 fail / 0 skip
Final candidate-only rerun: 2 pass / 0 fail / 0 skip
TypeScript: pass
Schema: pass / 95 schemas / 207 external refs
Schema digest: sha256:2e6f9ee059335e0601f0a1977e7d787577d966f4c23370585eaf1b28b2811916
Architecture: pass / parser=swc / 691 modules / 4883 dependencies / 0 violations
Prettier: pass（本单元人工维护文件）
git diff --check: pass
```

最终候选制品仍为`releaseEligible=false`：

```text
Codex:      405 compiled files
            sha256:336007f7d132302e447dffeeae35d5a4119cfd7bf58c6b74e92b1a905e9b3d9f
Claude Code:410 compiled files
            sha256:9bdb47357d4649dd5da9afe679ccea91433dafd7a3ba15789cee2bc3dbd501f4
```

Test Delivery Preparation公共纵切至此`implemented / verified`。下一项不能直接跳到Test执行；当前Route在Result Import后会进入`controller-test-review`，而现有Public Decision只覆盖Implementation。下一审阅单元应先读取内部Controller Test Review Decision的真实语义，讨论独立Test Decision工具与现有Review Inspector/Resume的关系，再决定公共边界。

## 222. Controller Test Review Decision公共化预审

### 222.1 当前真实Route与owner边界

Test TargetResult Import之后，Post-Acceptance Route进入`test-result-review-planning`，Public Controller Route投影为：

```text
kind  = test-result-review
owner = controller-test-review
```

当前Public Review Inspector已经共享支持Implementation/Test reported与blocked unit；Public Review Resume也共享恢复`review-blocked | test-review-blocked`，并保留同一Result和prior Decision/Resume history。这两项语义真正相同，不需要复制Test版本。

Decision不同。内部已经存在独立的：

```text
ControllerImplementationReviewDecision
  accept | rework | redesign | blocked
  requirementAlignment + implementationQuality

ControllerTestReviewDecision
  accept | request-another-attempt | escalate-product-defect | blocked
  conclusion + evidenceSufficiency
  TestCard + logical attempt + Test Dispatch Packet lineage
```

两类Decision只共享`review.target-result-decided` Event family、reviewed Result/Snapshot tuple和独立检查结构；各自Service、判断矩阵、Aggregate phase和下游owner不同。Event持久化共享不等于Command语义相同。

### 222.2 Test Decision四种结果仍然合理

当前四种结果与真实consumer闭合：

| Decision | 结构准入 | 下一Route owner |
| --- | --- | --- |
| `accept` | Test Report outcome=`completed`、`satisfied+sufficient`、全部独立检查passed、无blocker | Demand Completion |
| `request-another-attempt` | inconclusive或Evidence不足、至少一项failed/inconclusive、Card容量可用 | Test Delivery rerun |
| `escalate-product-defect` | Result非blocked、`defect-observed+sufficient`、至少一项failed、无blocker | Product Defect Remediation Authorization |
| `blocked` | 至少一个外部阻断原因，不能同时声称`satisfied+sufficient` | shared Review Resume |

`accept`要求Report outcome=`completed`不是把Test verdict提升为权威。Test Report的completed只表示Test窗口完成全部批准步骤和返回合同，不表示测试通过；`needs-review/blocked`按Test Skill表示合同未完成，Controller不能把不完整执行伪装成环境风险已关闭。产品缺陷可以从`needs-review`升级，因为已取得的failed Evidence可能充分证明缺陷，而不要求剩余无关步骤完成。

Playwright把每次retry保留独立序号，并在所有尝试之后另行分类passed/flaky/failed；Azure Test Results也分别保存outcome、attempt、failure type、resolution与关联bug。这继续支持Wakeflow把执行陈述、Controller conclusion和后续工作流授权分开，而不是复用Implementation `rework`。[Playwright Retries](https://playwright.dev/docs/test-retries)、[Azure Test Results](https://learn.microsoft.com/en-us/rest/api/azure/devops/testresults/results/get-test-results?view=azure-devops-rest-7.1)

### 222.3 公共化前发现的三个内部正确性问题

#### 222.3.1 冗余Target selector

`ControllerTestReviewDecisionRequest`当前要求：

```text
demandId + targetTaskId + targetResultId + snapshotDigest + reviewUnitDigest
```

但`targetResultId + snapshotDigest + reviewUnitDigest`已经在当前Snapshot内唯一定位reported Test unit；Implementation Decision Service正是这样派生`targetTaskId`。Test caller再次回送`targetTaskId`是可推导echo，增加stale/伪造组合且没有性能收益。

建议在Public Schema前先把内部Test request收敛为与Implementation相同的selector；完整Decision仍持久化owner派生的`targetTaskId`。

#### 222.3.2 已提交Event冲突时误报authority

Test Service发现同一Result/Snapshot已有Decision但新请求Judgment不同，会进入`assertExistingMatchesRequest()`；当前该分支返回`state + eventAuthority=unchanged`。事实上Decision Event已经存在，Event authority应为`current`。Implementation Service已正确这样分类。

公共error envelope不能继承错误权威。修正后应增加exact retry幂等和different Judgment冲突测试，证明后者返回`current`且不覆盖原Decision。

#### 222.3.3 Test Decision重新引入wall-clock因果门

`ControllerTestReviewDecision`当前要求`decidedAt > targetResultReportedAt`，但Foundation Wall Clock明确允许重复、回拨和系统校时；Implementation Decision早已删除同类条件，使用current Aggregate、stream revision和optimistic CAS证明因果顺序。

更重要的是，这不是孤立一行。当前`compareUtcInstants()`除Foundation函数本身外共有23个生产调用，分布在13个consumer模块：Task/Intent、Binding、Claim、Host Effect Observation、TargetResult、Test attempt/Delivery、Review、Product Defect Authorization、Aggregate与TODO排序。绝大多数是跨Event或跨本地authority的时间先后门。只修Test Decision会让后续rerun或产品缺陷授权继续在系统时钟回拨时错误失败。

[Azure Event Sourcing](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)强调每个实体的有序Event Stream、重放和optimistic concurrency；[AWS Event Sourcing](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/event-sourcing-pattern.html)同样把有序append、version/optimistic collision control作为状态权威。UTC timestamp可以保留为审计事实，但Wakeflow已经拥有更强的per-Demand stream revision、state digest、typed source tuple和CAS，不应再把可回拨wall time当作同一因果关系的第二权威。JavaScript wall time会受系统校时影响而非单调这一点也符合[MDN High precision timing](https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/High_precision_timing)说明。

### 222.4 旧JS与Tencent参考

旧JS把Implementation/Test都压入`accept | rework | redesign | blocked`，随后再从work type和task state猜测`rework`是产品修改还是Test再执行。这是真实功能来源，但也是新TS已经明确删除的歧义，不应为了减少一个MCP工具恢复。

TencentDB-Agent-Memory没有Controller Result Review、TestCard或Event-sourced attempt-resolution模型，不能提供Decision公共边界。其相邻offload state对cache失效使用单调`_offloadMapVersion`，而`Date.now()`主要用于访问时间、retry age和耗时；它没有把wall time和业务Review Event顺序组合成可复用方案。因此只参考其“版本化状态与时间观察分离”的方向，不复制具体实现。

### 222.5 产品缺陷分支仍缺Public consumer

Test Decision的三个结果已有公共下游：

```text
accept                  → wakeflow_complete_demand
request-another-attempt → wakeflow_prepare_test_delivery
blocked                 → wakeflow_resume_target_result_review
```

但`escalate-product-defect`只存在内部`ControllerProductDefectRemediationService`，没有Public Schema/Coordinator/MCP。若现在直接注册Test Decision，第16个工具会公开一个已知死路。

Remediation内部Request目前还要求`testTargetTaskId + testReviewDecisionId + postAcceptanceRouteDigest`。前两项可以从当前product-defect Route唯一派生；Public边界真正需要Controller选择的是affected implementation Targets、failed check映射、correction objective与authorization rationale。该selector也应在公共化前单独复审，不能原样暴露所有内部echo。

### 222.6 三个互斥实施方案

| 方案 | 顺序 | 优点 | 代价/结论 |
| --- | --- | --- | --- |
| A（推荐） | 先做有界Event causal-time audit；再修Test Decision selector/authority；建立独立Test Decision Public Contract/Coordinator但暂不注册；随后收敛并公开Product Defect Remediation；最后同时注册两个真实owner | 不冻结已知错误；四种Decision都有公共consumer；Inspector/Resume继续共享，Decision语义不混合；Foundation与纵切同时加固 | 比直接加一个工具多几个文件级单元，最终工具数从15到17 |
| B | 只修Test Decision直接时间门和selector，立即注册第16个工具；Remediation后补 | 更快看到Test accept/rerun/blocked公共闭环 | `escalate-product-defect`成为已知公共死路；其他wall-clock因果门继续存在；不建议 |
| C | 把现有Implementation工具改成一个`wakeflow_record_controller_target_review_decision`联合入口，再补Remediation | 工具数比A少1，共享Event表面统一 | 一个工具容纳两套Decision/assessment/Route语义，Coordinator重新成为跨bounded-context switch；旧JS歧义换成大Schema，不建议 |

不建议保持15工具不动：`controller-test-review`已经是当前真实Route owner，继续缺失会让完整Test执行永远无法由公共路线接受、复测、阻塞恢复或升级产品缺陷。

### 222.7 推荐A的文件级收束顺序

仍按每次紧密相关1–2个生产文件审阅：

1. **FND/EVENT-TIME audit**：为23个consumer调用建立keep/remove/replace表；只保留展示/优先级排序或时间本身就是领域输入的比较。已有identity/revision/state digest/CAS证明因果的门删除，不新增Logical Clock类或第二Event序号系统。
2. `controller-test-review-decision.ts + direct test`：删除UTC因果门，保留`decidedAt`审计事实；增加equal/rollback clock通过测试。
3. `controller-test-review-decision-input.ts + service.ts`：删除`targetTaskId` command echo；按TargetResult唯一派生；修正existing Event冲突的`current` authority。
4. Test Decision Public Request/Result Schema + Contract/Coordinator：独立工具名建议`wakeflow_record_controller_test_review_decision`，direct command而非preview/apply；Result返回完整Decision与Event/Commit/state receipt。
5. Product Defect Remediation selector/Service预审与收敛；随后建立独立Public Contract/Coordinator。
6. 两个owner一起接入Codex/Claude composition；Decision annotations建议`readOnly=false / destructive=true / idempotent=true / openWorld=false`；真实四分支与candidate parity通过后工具数达到17。

现有聚焦基线：

```text
Controller Test Decision
+ shared Inspector/Resume
+ Product Defect Remediation:
  17 pass / 0 fail / 0 skip
```

本单元只做源码/历史/官方资料审查和文档记录，没有修改生产代码、Schema、生成文件、MCP工具或候选制品，也没有提交、发布或刷新cache。等待用户在A/B/C中确认路线后再开始第一个文件单元。

### 222.8 用户确认A与Event causal-time审计表

用户确认方案A后，对`compareUtcInstants()`全部生产consumer逐项复核。审计规则不是“删除所有时间比较”，而是区分：

```text
UTC timestamp = 可移植审计/展示事实
Event stream revision + typed source tuple + state digest + CAS = 业务因果权威
process-local timeout/elapsed = monotonic clock
```

时间字段继续进入Event、Decision、Intent和receipt的Canonical digest；只删除“如果wall time没有递增，则已由其他权威证明的后续动作无效”这一第二因果门。删除这些门不改Schema形状、不重写历史Event、不需要upcaster，也不引入Logical Clock、Lamport timestamp或另一套sequence。

原23个consumer调用的分类如下：

| Consumer组 | 原调用数 | 结论 | 替代/保留权威 |
| --- | ---: | --- | --- |
| Controller Test Decision + Test reviewed Aggregate parser | 2 | 本单元remove | exact reported Snapshot、reviewed stream revision/state digest、Event append CAS |
| TODO collection createdAt排序 | 1 | keep | createdAt本身就是集合展示/确定性排序字段；相同时间由TODO ID打破平局，不是Event准入门 |
| Implementation Delivery Intent相对TaskPackage | 1 | remove | exact TaskPackage ID/digest、planned phase、expected stream revision |
| Test Task、Delivery Intent与attempt/authorization lineage | 7 | remove | TestCard/Task/Attempt/Decision/Result/Observation typed tuple、attempt ordinal、authorization ordinal、Aggregate phase与CAS |
| Claim、Host Effect Observation、TargetResult与Rearm | 7 | remove | exact Action/Claim/Event/Observation digest、current phase、stream append顺序与Claim authority |
| Product Defect Remediation Authorization/Aggregate | 2 | remove | Test Decision、Route digest/revision、accepted implementation baseline与authorization Event CAS |
| Window Binding registration与fresh observation | 3 | remove | exact Host/Window/Binding ID、opaque handle、launch/config topology和current binding authority |

本单元完成后还剩21个consumer调用：1个确定性TODO排序保留，20个因果门按后续文件单元删除。Aggregate中的重复门必须与拥有原始领域对象的codec/service同一单元修改，避免“对象parser接受、Aggregate重放拒绝”或相反的双重矩阵。

### 222.9 第一文件单元：Controller Test Decision causal order

首个实现单元修改两份紧密生产文件：

- `controller-test-review-decision.ts`删除`decidedAt > targetResultReportedAt`；
- `demand-aggregate-state.ts`删除Test reviewed target parser中的同一重复门。

`decidedAt`仍由严格UTC Wall Clock生成、进入Decision basis与digest并持久化。Decision的合法因果顺序继续要求：

- current reported Test review unit；
- exact Snapshot/review-unit/state digest；
- reviewed stream revision与TargetResult tuple；
- exact TestCard/attempt/Dispatch Packet lineage；
- `review.target-result-decided`在expected stream revision上的optimistic append。

Direct test现在分别证明Decision wall clock与Result reported time相同、早于reported time时都能生成有效确定性Decision；矛盾Decision/assessment/check关系仍拒绝。真实Service测试使用早于Result的`decidedAt`完成Event提交、Aggregate进入`test-accepted`、Repository重放、Completion route与exact retry幂等，证明不是仅放宽孤立codec。

```text
Controller Test Decision direct/service
+ Demand Aggregate/Event handler focused:
  9 pass / 0 fail / 0 skip
TypeScript: pass
Schema: pass / 95 schemas / 207 external refs
Schema digest: sha256:2e6f9ee059335e0601f0a1977e7d787577d966f4c23370585eaf1b28b2811916
Architecture: pass / parser=swc / 691 modules / 4883 dependencies / 0 violations
Prettier: pass
git diff --check: pass
```

本单元`implemented / verified`。下一文件单元建议从`test-task-package.ts`及其direct/service测试开始：它是TestCard→Test Task最早且没有Aggregate重复门的一处单文件因果准入，适合先独立关闭，再进入需要与Aggregate成对修改的Test Delivery/attempt lineage。

### 222.10 第二文件单元：TestCard到Test Task

`test-task-package.ts`原先在完整TaskPackage创建后要求：

```text
taskPackage.createdAt > testCard.createdAt
```

该关系没有增加来源闭合。Test Task真正由以下事实唯一派生：

- 当前TestCard Event、Card ID/digest和Demand/target identity；
- Config digest与Card冻结的Test Window；
- Card的Test Basis/environment Authority引用；
- 由Card派生的objective、boundaries、completion expectations和零acceptance anchors；
- `tasking.target-task-planned`在当前stream revision上的Event append CAS。

本单元删除`compareUtcInstants`依赖、时间比较和已经没有producer的`TestTaskPackageErrorReason="time"`。TaskPackage的`createdAt`字段、UTC词法、TaskPackage digest、Event recorded time与projection均保持不变；没有Schema、Event版本或生成类型变化。

真实Task Planning测试把TestCard记录在`12:20Z`，随后注入回拨到`12:19Z`的Task wall clock，完整通过：

```text
preview zero-write
→ TestCard-derived Package/self-check
→ exact apply Event
→ projection create
→ Aggregate Test target planned
→ Route test-delivery-planning
→ Config变化后的exact retry idempotent
```

相邻`TestTargetResult`与`TestDeliveryPreparation`测试同步通过，证明`assertTestTaskPackageMatchesTestCard()`、Result closure和下一Delivery authority不会重新引入已删除门。

```text
Test Task Planning
+ TestTargetResult
+ Test Delivery downstream focused:
  10 pass / 0 fail / 0 skip
TypeScript: pass
Schema: pass / 95 schemas / 207 external refs
Schema digest: sha256:2e6f9ee059335e0601f0a1977e7d787577d966f4c23370585eaf1b28b2811916
Architecture: pass / parser=swc / 691 modules / 4883 dependencies / 0 violations
Prettier: pass
git diff --check: pass
```

当前剩余20个生产consumer：TODO createdAt确定性排序仍保留，19个跨authority/Event因果门待删除。下一单元建议成对处理`test-delivery-intent.ts + demand-aggregate-state.ts`，一次关闭Test initial/rerun/replacement Intent及attempt/delivery authorization lineage中的重复时间门，再用现有三种真实纵切验证。

### 222.11 第三文件单元：Test Delivery与attempt lineage

本单元成对修改`test-delivery-intent.ts`与`demand-aggregate-state.ts`，删除六个重复wall-clock因果门：

1. initial/rerun Intent不再要求`preparedAt > TaskPackage.createdAt`；
2. Intent不再要求`preparedAt > TestCard.createdAt`；
3. replacement Intent不再要求`preparedAt > rejected Host Effect observedAt`；
4. 同一attempt的Delivery authorizations不再按`preparedAt`严格递增；
5. 新logical attempt的首份authorization不再要求晚于上一attempt末份authorization；
6. rerun Intent不再要求`preparedAt > request-another-attempt Decision.decidedAt`。

这些时间门分别已有更精确的非时间权威：

```text
initial
  planned Test target
  + exact TaskPackage/TestCard/Binding
  + attempt mode=initial, ordinal=1

rerun
  test-another-attempt-requested phase
  + exact previous Result/Decision
  + unique testAttemptId, mode=rerun, next ordinal

replacement
  test-host-effect-rejected phase
  + exact previous Delivery/Claim/Observation
  + same attempt
  + new targetDeliveryId
  + next authorizationOrdinal

all
  expected stream revision + state digest + Event append CAS
```

`preparedAt`继续保存于每份Intent与authorization summary，参与Canonical digest和审计；attempt数组顺序、attempt ordinal、authorization ordinal、唯一Result/Decision/Delivery ID以及current phase继续由codec、Aggregate parser和Reducer严格验证。没有放宽mode、capacity、lineage tuple或Event身份。

测试故意使用与业务因果相反的UTC：

- TestCard=`12:20Z`、TaskPackage=`12:25Z`、initial Delivery=`12:19Z`；
- previous initial=`12:19Z`、Controller Decision=`12:35Z`、rerun Delivery=`12:18Z`；
- original authorization=`12:19Z`、rejected Observation=`12:33Z`、replacement Delivery=`12:18Z`。

三种路径均完成preview零写、exact apply、Aggregate/Event Store重放、Route、Packet、Claim/Outcome相邻闭合与幂等重试；测试额外断言rerun和replacement的较早`preparedAt`不会改变attempt/authorization ordinal。

```text
Test Delivery initial/rerun/replacement
+ Aggregate/Event handler/Public/Outcome focused:
  15 pass / 0 fail / 0 skip
Shared MCP server real verticals:
  38 pass / 0 fail / 0 skip
TypeScript: pass
Schema: pass / 95 schemas / 207 external refs
Schema digest: sha256:2e6f9ee059335e0601f0a1977e7d787577d966f4c23370585eaf1b28b2811916
Architecture: pass / parser=swc / 691 modules / 4883 dependencies / 0 violations
Prettier: pass
git diff --check: pass
```

当前剩余14个生产consumer：TODO createdAt确定性排序保留，13个因果门待删除。下一单元建议处理`target-delivery-intent.ts`及Implementation Delivery Preparation真实测试；它只有一处TaskPackage→Intent时间门且没有Aggregate重复，是下一个可独立关闭的单文件单元。

### 222.12 第四文件单元：Implementation Delivery Intent

`target-delivery-intent.ts`原先要求Implementation Intent的`preparedAt`严格晚于TaskPackage `createdAt`。该门现已删除；Intent仍必须闭合：

- Program/Config/Demand/Target/TaskPackage typed identity；
- 完整TaskPackage digest与assignment Window；
- current Binding ID与Host；
- 由同一TaskPackage和可选rework/product-defect context确定性渲染的portable prompt；
- planned/rework-requested/product-defect-rework-requested current phase；
- exact expected stream revision、state digest与Event append CAS。

`preparedAt`继续作为严格UTC审计事实进入Intent basis、intent digest与prepared Event recorded time。没有修改initial、implementation-review-rework、product-defect-remediation三种purpose或公共Schema。

Direct fixture把TaskPackage记录在`10:00Z`、Intent记录在`09:59Z`；另一案例证明两者完全相同时也能创建、解析并复验同一TaskPackage。真实Preparation fixture把Task Event记录在`12:00Z`、Intent记录在`11:59Z`，同时保留更晚的Binding observation/registration；完整通过preview零写、apply、Aggregate、Route、幂等、Config/Binding drift、并发与rework历史。

```text
Implementation Intent/Preparation/Public/Claim/Outcome focused:
  25 pass / 0 fail / 0 skip
Shared MCP server real verticals:
  38 pass / 0 fail / 0 skip
TypeScript: pass
Schema: pass / 95 schemas / 207 external refs
Schema digest: sha256:2e6f9ee059335e0601f0a1977e7d787577d966f4c23370585eaf1b28b2811916
Architecture: pass / parser=swc / 691 modules / 4884 dependencies / 0 violations
Prettier: pass
git diff --check: pass
```

### 222.13 审计补充：Claim observation freshness不是Event排序

相邻测试复核发现`TargetHostEffectClaimService`没有使用`compareUtcInstants()`，但通过`utcInstantEpochNanoseconds()`计算Agent Host Observation相对Claim now的年龄，并执行`0..5分钟`freshness gate。

该策略与已删除门不同：Observation年龄本身是一次Host Effect Claim的安全输入，而不是用时间替代Event顺序。它保持：

- 未来Observation或超过五分钟的Observation保守拒绝；
- 时钟调整造成的false negative只要求Agent重新取得fresh observation；
- freshness失败不会创建Claim、Event或Agent Host Action；
- 它不替代Binding/handle/root attestation或Demand Event authority。

因此审计范围修正为当前14个关系策略：13个`compareUtcInstants` consumer加1个明确age consumer。其中TODO createdAt排序和Claim freshness保留，剩余12个跨authority/Event因果门继续删除。

下一单元建议处理`window-work-claim.ts`的两处时间门：Host Observation不再必须晚于Intent，Claim record也不再必须晚于Observation；五分钟freshness继续由Claim Service独立拥有。该文件没有Aggregate重复时间门，可以继续保持单文件节奏。

### 222.14 第五文件单元：WindowWorkClaim记录与freshness分离

`window-work-claim.ts`原先在持久Claim codec中同时要求：

```text
hostObservation.observedAt > target.intentPreparedAt
claimedAt >= hostObservation.observedAt
```

这两项已删除。WindowWorkClaim继续严格保存和验证：

- Claim、Program、Demand、Target Task/Delivery与可选Test Attempt typed identity；
- exact Intent digest与其审计`intentPreparedAt`；
- Host/Window/Binding route；
- Host Observation authority digest；
- 预分配Claim Event/Commit、expected stream revision/state digest；
- Claim自身Canonical digest与确定性文档；
- 无TTL、无自动过期、无raw handle/Action/Result字段。

Claim record不拥有Observation freshness。`TargetHostEffectClaimService`仍在任何Claim/Event/Action创建前，使用当前Claim clock与Observation UTC执行`0..5分钟`年龄准入；未来Observation或超过五分钟Observation继续返回`stale-observation`。因此删除记录时间顺序不会让旧Observation取得Host Effect权限。

共享direct fixture故意记录：

```text
Intent preparedAt = 09:59Z
Observation       = 09:58Z
Claim claimedAt   = 09:57Z
```

它能完成Implementation/Test Claim解析、摘要、确定性文档和Store create/inspect/release。真实Claim Service仍以fresh Observation完成exclusive Claim、Event、一次性Action、前向恢复、Binding drift补偿与exact replay；超过五分钟负例保持通过。Outcome和TargetResult相邻consumer也继续闭合。

```text
Claim direct/store/service + Outcome/TargetResult focused:
  21 pass / 0 fail / 0 skip
Public Claim Implementation/Test verticals:
  2 pass / 0 fail / 0 skip
TypeScript: pass
Schema: pass / 95 schemas / 207 external refs
Schema digest: sha256:2e6f9ee059335e0601f0a1977e7d787577d966f4c23370585eaf1b28b2811916
Architecture: pass / parser=swc / 691 modules / 4884 dependencies / 0 violations
Prettier: pass
git diff --check: pass
```

当前剩余12个时间关系策略：TODO createdAt排序和Claim freshness保留，10个跨authority/Event因果门待删除。下一单元建议成对处理`target-delivery-host-effect-observation.ts + demand-aggregate-state.ts`，删除Outcome `observedAt > Action.issuedAt/Claim.claimedAt`的codec与Aggregate重复门，并用真实accepted/indeterminate/rejected纵切验证。

### 222.15 第六文件单元：Host Effect Observation审计时间与因果权威分离

`target-delivery-host-effect-observation.ts`原先要求Outcome `observedAt`严格晚于Action `issuedAt`；`demand-aggregate-state.ts`又重复要求持久摘要的`observedAt`严格晚于Claim `claimedAt`。两处墙钟门现已删除，Aggregate parser也不再接收只为该比较存在的`workClaim`参数。

`observedAt`仍是必填且严格解析的UTC审计事实，并继续进入Observation basis、Canonical digest、Event data和Aggregate摘要。Outcome的因果与准入继续由以下确定性关系闭合：

- exact Action、Target Delivery、Intent、Host、Window、Binding与Claim identity；
- Claim digest、Host Observation authority digest、Claim Event/Commit和expected state digest；
- Test工作额外闭合attempt与dispatch packet digest；
- Event stream revision、当前Aggregate状态与append CAS；
- attempt/readback双轴、evidence digest及`rejected-before-effect`只能搭配`unavailable` readback；
- accepted/indeterminate保留Claim，rejected-before-effect先提交Event再按授权释放Claim。

共享direct fixture故意把Outcome记录为`09:56Z`，早于Action/Claim的`09:57Z`。真实Implementation纵切把Outcome记录为`12:03Z`、Claim记录为`12:05Z`；真实Test纵切把Outcome记录为`12:30Z`、Claim记录为`12:32Z`。三者均通过codec、Aggregate、Event append、幂等、Claim结算、Controller Route与当前Result下游，证明跨来源UTC倒序不会改变因果权威。

```text
Observation/Aggregate/Outcome/Result focused:
  24 pass / 0 fail / 0 skip
Event decider/upcaster focused:
  2 pass / 0 fail / 0 skip
Shared MCP server real verticals:
  38 pass / 0 fail / 0 skip
TypeScript: pass
Schema: pass / 95 schemas / 207 external refs
Schema digest: sha256:2e6f9ee059335e0601f0a1977e7d787577d966f4c23370585eaf1b28b2811916
Architecture: pass / parser=swc / 691 modules / 4884 dependencies / 0 violations
Prettier: pass
git diff --check: pass
```

当前剩余10个时间关系策略：TODO createdAt确定性排序和Claim freshness保留，8个跨authority/Event因果门待删除。下一单元建议成对处理`target-result.ts + demand-aggregate-state.ts`，删除Result `reportedAt > Host Effect observedAt`的codec与Aggregate重复门，并用真实Implementation/Test Result导入的倒序UTC验证identity、report digest、Claim释放和Event CAS仍完整闭合。

### 222.16 第七文件单元：TargetResult审计时间与Review准入分离

`target-result.ts`原先要求Report `reportedAt`严格晚于Host Effect `observedAt`；`demand-aggregate-state.ts`又在持久TargetResult摘要中重复该比较。两处墙钟门现已删除，Aggregate parser也不再接收只为该比较存在的`hostEffect`参数。

`reportedAt`仍是Report必填且严格解析的UTC审计事实，并继续进入Implementation/Test Report、TargetResult basis、Canonical digest、Event data和Aggregate摘要。Result进入review的因果与准入仍由以下确定性关系闭合：

- TargetResult ID由Claim Action ID确定性派生，Observed Event ID与同一Action精确闭合；
- Program、Demand、Target Task、Delivery、TaskPackage ref/digest和assignment一致；
- Claim identity/digest/Event/Commit与Host Effect Observation digest、disposition、readback一致；
- Test工作额外闭合TestCard、attempt、dispatch packet和逐步Evidence mapping；
- Implementation工作继续执行acceptance anchor与commit policy结构校验；
- Event stream revision、当前Aggregate状态、append CAS和Result Event commit保持不变；
- Result Event提交后才释放Claim，Result本身仍只形成Controller review input，不产生acceptance。

测试清理删除了两个已经失效的“reportedAt不晚于observedAt必须失败”断言：一个独立Implementation负例和Test真实链中的simultaneous Report分支。它们没有被兼容分支替代，而是由更强的倒序正例覆盖：

```text
Direct Implementation: Report 09:55Z < Host Effect 09:56Z
Real Implementation:   Report 12:03Z < Host Effect 12:06Z
Real Test:             Report 12:29Z < Host Effect 12:33Z
Public Test:           Report 12:30Z < Host Effect 12:33Z
```

上述链路均完成codec、Aggregate、Event append、幂等、Claim释放、Route、Review projection和当前Controller下游；没有新增Schema、状态字段或时间兼容模式。

```text
Result/Aggregate/Import focused:
  13 pass / 0 fail / 0 skip
Adjacent Event/Schema/Review focused:
  14 pass / 0 fail / 0 skip
Shared MCP server real verticals:
  38 pass / 0 fail / 0 skip
TypeScript: pass
Schema: pass / 95 schemas / 207 external refs
Schema digest: sha256:2e6f9ee059335e0601f0a1977e7d787577d966f4c23370585eaf1b28b2811916
Architecture: pass / parser=swc / 691 modules / 4884 dependencies / 0 violations
Prettier: pass
git diff --check: pass
```

当前剩余8个时间关系策略：TODO createdAt确定性排序和Claim freshness保留，6个跨authority/Event因果门待删除。下一单元建议审阅`target-host-effect-rearm.ts + demand-aggregate-state.ts`：Rearm codec本身已正确只保存精确Rejected Attempt授权，但Aggregate仍要求`rearmedAt > rejected Host Effect observedAt`。应删除这一处孤立墙钟门，并用倒序Rearm真实链验证旧Claim已释放、精确Observation授权、fresh Claim准入和Event CAS。

### 222.17 第八文件单元：Rearm审计时间与Rejected Attempt授权分离

文件审阅确认`target-host-effect-rearm.ts`的codec本身没有设计错误：它始终只解析并保存目标identity、原Claim identity/digest/Event/Commit、被拒Observation digest、`rearmedAt`和Canonical digest，没有用墙钟准入。该文件仅补充中文注释，明确`rearmedAt`是审计事实而非因果序号。

唯一错误位于`demand-aggregate-state.ts`的Rearm纯状态转换：它额外要求`rearmedAt`严格晚于被拒Host Effect `observedAt`。该比较现已删除。Rearm仍必须同时满足：

- Demand处于active，Target仍精确位于`host-effect-rejected`；
- Target Task/Delivery与原Claim identity、digest、Event、Commit完全一致；
- Observation digest精确等于当前rejected Host Effect；
- disposition仍为`rejected-before-effect`且Claim handling已是`release-authorized`；
- Service在Event提交前复验Host、Binding与当前Event authority；
- Rearm Event使用稳定独立identity并通过expected revision/state digest CAS追加；
- Aggregate只回到`delivery-prepared`，不复活旧Claim、不创建Action、不自动执行重试；
- 下一次Action必须通过fresh Host Observation取得全新Claim。

Direct fixture把`rearmedAt`设为`09:55Z`，早于被拒Observation的`09:56Z`；真实Service与Public纵切把Rearm设为`12:03Z`，早于Outcome的`12:06Z`。三层均成功闭合摘要、Event append、Aggregate恢复、幂等、Route与fresh Claim，同时accepted Outcome、Binding漂移、错误Host和错误Observation仍被拒绝。

```text
Rearm/Aggregate/Event/Public focused:
  14 pass / 0 fail / 0 skip
Adjacent Test replacement verticals:
  4 pass / 0 fail / 0 skip
Shared MCP server real verticals:
  38 pass / 0 fail / 0 skip
TypeScript: pass
Schema: pass / 95 schemas / 207 external refs
Schema digest: sha256:2e6f9ee059335e0601f0a1977e7d787577d966f4c23370585eaf1b28b2811916
Architecture: pass / parser=swc / 691 modules / 4884 dependencies / 0 violations
Prettier: pass
git diff --check: pass
```

当前剩余7个时间关系策略：TODO createdAt确定性排序和Claim freshness保留，5个跨authority/Event因果门待删除。下一单元建议处理`controller-product-defect-remediation-authorization.ts + demand-aggregate-state.ts`：前者要求Authorization晚于Test Review Decision，后者又要求每个受影响Implementation accepted Decision早于Authorization。两项因果都已有精确Decision/Result/Target identity、state digest和Event CAS，应作为同一Remediation授权单元审阅；最后再单独处理Window Binding/Observation的三个时间门。

### 222.18 第九文件单元：Product Defect Remediation审计时间与Controller授权分离

`controller-product-defect-remediation-authorization.ts`原先要求Authorization `authorizedAt`严格晚于Test产品缺陷Decision `decidedAt`；`demand-aggregate-state.ts`又在每个受影响Implementation Target摘要中要求Authorization晚于原accepted Decision。两项墙钟门现已删除。

`authorizedAt`仍是必填且严格解析的UTC审计事实，并继续进入Authorization basis、Canonical digest、Event data和每个受影响Target的Aggregate摘要。Authorization的Controller因果与边界继续由以下精确关系闭合：

- 唯一准入Decision必须是`escalate-product-defect`，并闭合Controller、Program和Demand identity；
- Test Target、TestCard、attempt、dispatch packet、TargetResult和Test Decision ID/digest完全一致；
- route digest、review snapshot digest、state digest和stream revision绑定当前Event authority；
- 受影响Implementation只能来自TestCard冻结的baseline，并闭合TaskPackage、Repository、Window、Result和accepted Decision ID/digest；
- 所有failed check必须来自Controller独立复验，排序、唯一性和到affected target的映射保持完整；
- `existing-task-packages-only`、有界correction objective和Authorization rationale保持不变；
- Service继续执行当前Config/Controller/route复验、preflight、容量检查和expected revision CAS；
- Authorization只追加Event并打开精确产品返工，不让Test窗口修产品，也不直接创建Delivery。

`assertRelations`不再接收只为墙钟比较存在的可选`authorizedAt`参数，创建流程中读取时钟后的第二次重复关系调用也一并删除。错误Decision、缺失/未知check、baseline漂移、映射不闭合、顺序漂移和摘要篡改负例均保留。

Direct Authorization使用`12:33Z`，早于Test Decision的`12:35Z`。真实Service使用`12:10Z`，同时早于Implementation accepted Decision的`12:15Z`和Test产品缺陷Decision的`12:35Z`；完整通过Authorization Event、Aggregate产品返工、Delivery、Claim、Outcome、Result和下一Test代际。

```text
Authorization/Aggregate/Event/Delivery focused:
  17 pass / 0 fail / 0 skip
Adjacent Route/Review Snapshot focused:
  6 pass / 0 fail / 0 skip
Shared MCP server real verticals:
  38 pass / 0 fail / 0 skip
TypeScript: pass
Schema: pass / 95 schemas / 207 external refs
Schema digest: sha256:2e6f9ee059335e0601f0a1977e7d787577d966f4c23370585eaf1b28b2811916
Architecture: pass / parser=swc / 691 modules / 4884 dependencies / 0 violations
Prettier: pass
git diff --check: pass
```

当前剩余5个时间关系策略：TODO createdAt确定性排序和Claim freshness保留，3个Window Binding/Observation因果门待审阅。最后一簇跨越`wakeflow-window-host-binding.ts`、`wakeflow-window-host-binding-store.ts`和`wakeflow-agent-host-window-observation-authority.ts`，同时涉及注册记录、持久Store与后续Host Observation authority。下一单元不应机械删除：先完整核对三者的identity/digest/CAS与安全威胁模型，再判断三处墙钟是否全部冗余，或是否有某一处实际属于需要明确保留的freshness策略。

### 222.19 第十文件单元：Window Binding代际与墙钟策略收束

本单元先完成代码威胁模型和标准复核，再决定三处墙钟门，而非沿用前九个单元的结论：

- W3C High Resolution Time明确指出墙钟可能因系统调整而回拨，不适合记录事件顺序；单调时钟只在同一执行上下文内成立，不能作为跨进程、重启后持久记录的绝对时间：[W3C High Resolution Time](https://www.w3.org/TR/2026/WD-hr-time-3-20260225/)；
- Node官方文档说明`process.hrtime.bigint()`起点任意、与日期时间无关，适合测量同一进程内区间，不是可持久化Binding代际：[Node.js Process](https://nodejs.org/api/process.html#processhrtimebigint)；
- Lamport的经典模型把分布式因果建立在事件可影响关系与逻辑顺序上，而非假定物理时钟总序：[Time, Clocks and the Ordering of Events in a Distributed System](https://www.microsoft.com/en-us/research/publication/time-clocks-ordering-events-distributed-system/)。

代码审阅确认三处比较全部冗余：

1. `wakeflow-window-host-binding.ts`要求`registeredAt >= source.observedAt`；
2. `wakeflow-window-host-binding-store.ts`在写入前重复同一比较；
3. `wakeflow-agent-host-window-observation-authority.ts`要求后续Observation `observedAt >= binding.registeredAt`。

三处现已删除，且没有改用持久化单调时间、容差窗口或新的兼容字段。`source.observedAt`、`registeredAt`和后续`rootAttestation.observedAt`仍是必填、严格解析并进入持久记录/authority digest的UTC审计事实。

Binding代际与后续Observation authority继续由以下确定性关系闭合：

- 当前Config编译的唯一launch intent及其digest；
- Program、Host、Window typed identity；
- 每代随机且inventory唯一的`bindingId`；
- 当前Host Profile严格准入的opaque handle及constant-time fingerprint比较；
- 0700私有目录、0600单链接Binding文件、稳定完整inventory和跨Window handle唯一性；
- 专用exclusive mutation lock、stage recovery、no-replace atomic create与明确commit-unknown；
- 当前Config/runtime topology、logical root/configured placement和三层fingerprint；
- 后续Claim对Binding ID、Intent Config digest、Window和Observation authority digest的精确闭合。

真正的新鲜度策略仍唯一保留在`TargetHostEffectClaimService`：它在创建Claim/Event/Action前计算Observation相对当前Claim clock的年龄，严格执行`0..5分钟`，未来或过期Observation只要求重新观察且不产生状态写入。Binding注册时间不再伪装成freshness或安全证明。

测试同步完成清理型重写：

- Binding direct测试从“回拨必须失败”改为`registeredAt 10:00:01Z < source observedAt 10:00:02Z`正例；
- Observation authority使用`observedAt 09:59:59Z < registeredAt 10:00:01Z`，删除旧`time`负例；
- 真实MCP Binding注册把未来一分钟的Agent source time持久化为审计事实，同时保持私有handle、原子注册、幂等、冲突、并发与投影恢复；
- Implementation纵切使用`Binding registeredAt 12:02Z < source 12:03Z`，随后`Claim observation 12:01Z < registeredAt`，到Claim `12:05Z`仍在四分钟freshness内；
- Test纵切使用`Binding registeredAt 12:29Z < source 12:30Z`，随后`Claim observation 12:28Z < registeredAt`，到Claim `12:32Z`仍在四分钟freshness内；
- 一处把旧Claim observation `12:04Z`写死的恢复断言暴露后，已改为引用fixture权威常量，避免重复时间事实。

```text
Binding/Observation/Registration/Claim focused:
  13 pass / 0 fail / 0 skip
Implementation/Test Delivery + Claim + Outcome verticals:
  25 pass / 0 fail / 0 skip
Shared MCP server real verticals:
  38 pass / 0 fail / 0 skip
TypeScript: pass
Schema: pass / 95 schemas / 207 external refs
Schema digest: sha256:2e6f9ee059335e0601f0a1977e7d787577d966f4c23370585eaf1b28b2811916
Architecture: pass / parser=swc / 691 modules / 4884 dependencies / 0 violations
Prettier: pass
git diff --check: pass
```

跨authority/Event因果墙钟审计至此完成。生产代码中的`compareUtcInstants()`只剩TODO intake `createdAt`的确定性展示排序；唯一准入型墙钟策略是明确、有界、可重试的Claim freshness。下一审阅单元应回到本轮审计前已确认的问题：先处理Controller Test Review Decision的冗余selector与existing Event authority错误，再建设其Public Contract；随后建设Product Defect Remediation Public Contract，并把两项一起注册，避免公开死分支。

### 222.20 Controller Test Review Decision selector与Event authority修正

本单元对照已经完成真实Public/MCP验证的Implementation Decision模式，修正Test Decision内部Service边界，但不提前注册公共工具。

#### 请求selector收敛

`controller-test-review-decision-input.ts`原先同时要求：

```text
demandId + targetTaskId + targetResultId + snapshotDigest + reviewUnitDigest
```

其中`targetTaskId`是冗余echo：`targetResultId`已经唯一定位reported review unit，`snapshotDigest`和`reviewUnitDigest`分别冻结Event Stream审查快照与目标内容；Target Task必须由该Result派生，不能让调用方再提供第二份可能漂移的identity。

请求现收敛为：

```text
demandId + targetResultId + snapshotDigest + reviewUnitDigest + judgment
```

Input parser已从exact field set、类型和返回值中删除`targetTaskId`。Service从当前Review Snapshot按`targetResultId`要求恰好一个reported Test target，再使用派生的`target.targetTaskId`读取Aggregate并创建Decision。携带旧`targetTaskId`字段会在打开workspace前以`input + eventAuthority: unchanged`拒绝；没有兼容别名、忽略分支或双selector模式。

#### 已有Event authority修正

`controller-test-review-decision-service.ts`原先找到相同Result/Snapshot的已提交Test Decision后，如果Request的judgment或fence冲突，`assertExistingMatchesRequest()`会使用默认`eventAuthority: unchanged`。这与事实矛盾：当前Decision Event已经存在。

现已与Implementation Decision对齐：

- existing Decision查询要求零个或恰好一个匹配源；重复源以`state + current`失败；
- 已有Decision与Request的Demand、Result、Snapshot、Review Unit或judgment不一致，以`state + current`失败；
- 精确相同Request仍返回`already-decided + idempotent + current`；
- Event Store返回`idempotency-conflict`时，以`state + current`报告确定性Event/Commit身份已被占用；
- 真正尚未提交Event的input、attempt capacity、snapshot或preflight失败仍保持`unchanged`。

新增聚焦回归先证明多余`targetTaskId`零I/O拒绝，再提交accept Decision并精确重放，最后用同一Result/Snapshot提交合法的`request-another-attempt` judgment，确认冲突报告`eventAuthority: current`。完整产品缺陷授权、Resume、Completion、Inspection、rerun Delivery与Event decider/handler下游继续通过。

```text
Test Decision Input/Service/Decision focused:
  6 pass / 0 fail / 0 skip
Resume/Completion/Inspection/Test Delivery/Event downstream:
  21 pass / 0 fail / 0 skip
Shared MCP server:
  not rerun — this unit intentionally changes no registered Public/MCP surface
TypeScript: pass
Schema: pass / 95 schemas / 207 external refs
Schema digest: sha256:2e6f9ee059335e0601f0a1977e7d787577d966f4c23370585eaf1b28b2811916
Architecture: pass / parser=swc / 691 modules / 4884 dependencies / 0 violations
Prettier: pass
git diff --check: pass
```

下一审阅单元建设Controller Test Review Decision的独立Public Request/Result Schema、手写Public Contract和Public Coordinator，但暂不注册MCP。公共请求必须沿用本单元的单一`targetResultId` selector；公共结果必须保留Decision/Event/Commit/state摘要与`eventAuthority`，不回显root、判断私密文本或内部历史。完成后再以同样节奏建设Product Defect Remediation Public能力，最后两项一起注册并执行17工具完整MCP真实纵切，避免公开死分支。

### 222.21 Controller Test Review Decision Public能力（未注册）

本单元建设独立Public Request/Result Schema、手写Public Contract和Public Coordinator，但明确不修改Codex/Claude entrypoint、composition root或MCP工具清单。

#### 标准与Schema边界

当前依赖`@modelcontextprotocol/server` v2实现MCP 2026-07-28。该版本使用完整JSON Schema 2020-12描述工具输入/输出，声明`outputSchema`后服务端结果必须符合Schema；结构化结果仍需提供兼容的文本表示：[MCP 2026-07-28](https://blog.modelcontextprotocol.io/posts/2026-07-28/)、[TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/)。

Wakeflow继续采用比协议最低要求更严格的wire边界：

- Request/Result根均为object且`additionalProperties: false`；
- 两份Schema运行时完全自包含，不要求客户端解析外部URN `$ref`；
- Request保持唯一`targetResultId` selector，`snapshotDigest`和`reviewUnitDigest`作为fence，不接受`targetTaskId`；
- Request完整编码四类Test judgment关系：`accept`、`request-another-attempt`、`escalate-product-defect`、`blocked`；
- Result完整编码Test Decision与TestCard/attempt/dispatch packet lineage、status/disposition关系、Event/Commit receipt和state digest；
- Result不携带next attempt、remediation authorization、Delivery、Demand completion或workspace root。

新增Schema及生成物：

```text
src/contracts/schemas/entrypoints/
  wakeflow-controller-test-review-decision-request.schema.json
  wakeflow-controller-test-review-decision-result.schema.json

src/contracts/generated/entrypoints/
  wakeflow-controller-test-review-decision-request.generated.ts
  wakeflow-controller-test-review-decision-result.generated.ts
```

#### Public Contract

`controller-test-review-decision-public-contract.ts`拥有工具名：

```text
wakeflow_record_controller_test_review_decision
```

Contract在未来MCP SDK前置校验之后仍独立执行passive JSON、1 MiB容量、自包含Request Schema、领域Input parser和workspace root隐私检查。它不忽略扩展字段，也不把Schema通过等同于judgment正确。

#### Public Coordinator

`controller-test-review-decision-public-coordinator.ts`只打开精确workspace、调用已审阅Service并验证真实物理回执：

- Decision、request judgment与Result/Snapshot/Review Unit完全一致；
- Decision Event ID、Commit ID、command digest、expected/first/last revision闭合；
- committed结果的Aggregate phase与四类Decision分别对应：
  `test-accepted`、`test-another-attempt-requested`、`test-product-defect`、`test-review-blocked`；
- Event data等于完整Decision，resulting state digest等于Aggregate state digest；
- idempotent结果复用当前Event authority；
- 输出通过4 MiB容量、Result Schema及请求root/canonical root隐私复验。

真实Public测试从Test Review Inspector取得reported unit，只提交Result selector和Controller judgment，完成accept Event、Route进入completion preflight、精确重放，并证明同一Result/Snapshot的另一attempt judgment返回`decision/state + eventAuthority: current`。Schema测试独立覆盖四类judgment、状态/处置关系、Test lineage、拒绝Target echo和拒绝越界输出。

```text
Public Request/Result Schema + Coordinator:
  3 pass / 0 fail / 0 skip
Existing Test Decision Service regression:
  3 pass / 0 fail / 0 skip
MCP wire Schema self-contained gate:
  1 pass / 0 fail / 0 skip
Registered MCP server:
  not rerun — Public capability intentionally remains unregistered
TypeScript: pass
Schema: pass / 97 schemas / 207 external refs
Schema digest: sha256:4b88d90f5dce0d26cad7968ed00922f589f57783698f5a3a70c6dd895da548ea
Architecture: pass / parser=swc / 697 modules / 4908 dependencies / 0 violations
Prettier: pass
git diff --check: pass
```

下一单元先审阅`controller-product-defect-remediation-input.ts + controller-product-defect-remediation-service.ts`，再决定Public selector。当前内部Request同时携带`testReviewDecisionId`和`testTargetTaskId`；在完整Decision/Event history中，后者可能是可派生的identity echo。不得在未确认前把它固化进公共Schema。selector与existing Event authority收敛后，再建设Product Defect Remediation Public Contract/Coordinator，最后与Test Decision一起注册为第16、17个MCP工具。

### 222.22 Product Defect Remediation selector与Event authority修正

本单元先收敛内部Input/Service，不创建Public Schema、不注册工具。

#### selector分类

完整代码审阅把原Request字段分为三类：

| 字段 | 分类 | 结论 |
| --- | --- | --- |
| `testReviewDecisionId` | 唯一缺陷代际selector | 保留；从Event history定位精确`escalate-product-defect` Decision |
| `postAcceptanceRouteDigest` | 当前route fence | 保留；阻止Controller基于已漂移路线授权产品返工 |
| `affectedTargets[].targetTaskId` | Controller主动选择的产品修复范围 | 保留；映射到TestCard冻结Implementation baseline |
| 顶层`testTargetTaskId` | 可由Decision与route共同派生的identity echo | 删除；不允许调用方提供第二份可能漂移的Test Target identity |

`controller-product-defect-remediation-input.ts`已从Request类型、exact field set和parser结果删除顶层`testTargetTaskId`。携带旧字段会在任何workspace I/O前返回`input + eventAuthority: unchanged`；没有兼容别名或静默忽略。

#### Service派生与authority

`controller-product-defect-remediation-service.ts`现按以下顺序建立唯一来源：

1. 从当前Event Stream重建Review Snapshot与Post-Acceptance Route；
2. 以`testReviewDecisionId`要求恰好一个Decision source；
3. 要求其为`WakeflowControllerTestReviewDecision + escalate-product-defect`；
4. 将Decision派生的`targetTaskId`与route的Test target交叉复验；
5. 继续闭合TestCard、attempt、packet、Result、Controller Window、Program与当前state/revision；
6. 把Public候选`affectedTargets`映射到TestCard baseline和当前accepted target后创建Authorization。

已有Authorization authority也与前一单元对齐：

- 同一Test Decision的Authorization source要求零个或恰好一个；重复历史以`state + current`失败；
- 已有Authorization与Demand、Decision、route fence、rationale或affected mapping冲突，以`state + current`失败；
- 精确重放仍返回`already-authorized + idempotent + current`；
- Event Store `idempotency-conflict`报告`state + current`；
- Event尚未存在时的Input、route、mapping、preflight失败仍保持`unchanged`。

真实回归在产品缺陷Decision后首先证明旧`testTargetTaskId`零I/O拒绝，再验证未知check保持Authorization/unchanged失败，随后提交倒序UTC Authorization、精确重放，并以不同rationale验证已有Event冲突为current。完整baseline返工Delivery、Claim、Outcome、Result与新TestCard代际继续通过。

```text
Product Defect Authorization domain + Service vertical:
  6 pass / 0 fail / 0 skip
Registered MCP server:
  not rerun — this unit changes no registered Public/MCP surface
TypeScript: pass
Schema: pass / 97 schemas / 207 external refs
Schema digest: sha256:4b88d90f5dce0d26cad7968ed00922f589f57783698f5a3a70c6dd895da548ea
Architecture: pass / parser=swc / 697 modules / 4908 dependencies / 0 violations
Prettier: pass
git diff --check: pass
```

下一单元可安全建设Product Defect Remediation的独立Public Request/Result Schema、手写Public Contract和Public Coordinator，仍暂不注册。公共Request只能包含`root + demandId + testReviewDecisionId + postAcceptanceRouteDigest + affectedTargets + authorizationRationale`；公共Result应闭合Authorization、Event、Commit、state digest与`eventAuthority`，不得创建Delivery或把Test Decision本身伪装成产品修复授权。完成后再一次性增加Codex/Claude固定entrypoint并把Test Decision、Product Remediation同时注册为第16、17个MCP工具。

### 222.23 Product Defect Remediation Public能力（未注册）

本单元完成独立Public Request/Result Schema、手写Public Contract和Public Coordinator，并以真实公共Test Decision与Demand Controller Route作为上游；仍不修改host entrypoint、composition root或MCP工具列表。

#### 真实公共上游闭合

现有只读`wakeflow_route_demand`已经在Test缺陷状态公开：

- `postAcceptanceRouteDigest`；
- `product-defect-remediation-authorization` frontier；
- 当前Test target引用和owner分类。

因此Remediation调用不需要读取内部文件或新增只读工具。Controller使用刚提交的Test Decision ID、公共Route fence，以及创建TestCard时已知的Implementation baselines来选择affected targets。

#### Request/Result Schema

新增自包含Schema与生成类型：

```text
src/contracts/schemas/entrypoints/
  wakeflow-controller-product-defect-remediation-request.schema.json
  wakeflow-controller-product-defect-remediation-result.schema.json

src/contracts/generated/entrypoints/
  wakeflow-controller-product-defect-remediation-request.generated.ts
  wakeflow-controller-product-defect-remediation-result.generated.ts
```

Request严格只接受：

```text
root
demandId
testReviewDecisionId
postAcceptanceRouteDigest
affectedTargets[] = targetTaskId + failedCheckIds + correctionObjective
authorizationRationale
```

不接受顶层`testTargetTaskId`、baseline echo、Event位置、Controller Window、Authorization ID或时间。Result完整返回不可变Authorization、Event/Commit receipt、state digest和`eventAuthority: current`，并关闭`authorized/committed`、`already-authorized/idempotent`关系；不携带Delivery、Action、下一TestCard或Demand completion。

#### Public Contract

`controller-product-defect-remediation-public-contract.ts`拥有工具名：

```text
wakeflow_authorize_product_defect_remediation
```

Contract执行passive JSON、16 MiB容量、自包含Request Schema、内部Input parser和workspace root隐私准入。16 MiB与Demand单Commit上限对齐；Service preflight仍按完整Commit字节实施最终容量门。

#### Public Coordinator

`controller-product-defect-remediation-public-coordinator.ts`调用已审阅Service后复验：

- Request的Decision ID、route digest、rationale与affected mappings等于Authorization；
- 每个受影响Implementation Target进入`product-defect-rework-requested`，并闭合Authorization ID/digest、Test Decision、failed checks、objective和authorizedAt；
- 原Test Target保持`test-product-defect`，current TestCard已移除，pending retest精确绑定旧Card、Test Decision与Authorization；
- Event类型/ID/data、Commit ID、command digest、expected/first/last revision和resulting state digest完全闭合；
- 输出通过16 MiB容量、自包含Result Schema及请求root/canonical root隐私复验。

真实公共测试执行完整链：Test Review Inspector → `escalate-product-defect` Public Decision → Public Demand Route → Public Remediation Authorization → Public Demand Route中的唯一Implementation Delivery frontier；随后验证精确重放与不同rationale冲突的`eventAuthority: current`。结果不回显workspace root、raw handle或Target Delivery。

```text
Product Remediation Public Request/Result Schema + Coordinator:
  3 pass / 0 fail / 0 skip
Adjacent Test Decision Public vertical:
  3 pass / 0 fail / 0 skip
MCP wire Schema self-contained gate:
  1 pass / 0 fail / 0 skip
Registered MCP server:
  not rerun — both new Public capabilities intentionally remain unregistered
TypeScript: pass
Schema: pass / 99 schemas / 207 external refs
Schema digest: sha256:6b61ae4c9c1c009cc40573e33c26069db58fcd8dcc8cbbc4ccc6c0ed39f26daf
Architecture: pass / parser=swc / 703 modules / 4933 dependencies / 0 violations
Prettier: pass
git diff --check: pass
```

两项Controller Public能力现在都已拥有真实owner和独立验证，下一单元可以一次性完成发布闭合：增加Codex/Claude固定host entrypoint，接入`wakeflow-public-mcp-server.ts` composition root，同时注册`wakeflow_record_controller_test_review_decision`与`wakeflow_authorize_product_defect_remediation`为第16、17个工具。注册前需对照现有Implementation Decision重新判断两项tool annotations与描述；注册后必须执行17工具集合、官方SDK Schema前置拒绝、两条真实纵切、双host parity、wire自包含和artifact candidate完整验证。

### 222.24 第16、17个MCP工具与Controller业务闭环

Test Decision与Product Defect Remediation在各自Public能力完成后一次性注册，没有形成单边公开死分支。

#### 双host entrypoint

新增四个只固定制品边界的薄入口：

```text
src/entrypoints/
  codex-wakeflow-controller-test-review-decision.ts
  claude-code-wakeflow-controller-test-review-decision.ts
  codex-wakeflow-controller-product-defect-remediation.ts
  claude-code-wakeflow-controller-product-defect-remediation.ts
```

两项能力不依赖Host Profile分支；Codex与Claude Code入口均调用同一host-neutral Public Coordinator。四文件进入`src/entrypoints/tsconfig.json`显式构建清单，两个MCP composition root分别绑定自己的固定入口。

#### MCP注册与风险语义

共享server现发布17个真实owner。新增工具：

```text
wakeflow_record_controller_test_review_decision
wakeflow_authorize_product_defect_remediation
```

两项annotations均为：

```text
readOnlyHint=false
destructiveHint=true
idempotentHint=true
openWorldHint=false
```

它们都追加不可变Event并有意改变后续责任路线，因此不是只读且具有破坏性语义；精确重放由确定性Event/Commit identity保证幂等；所有外部Host/Test/产品执行效果均在工具外部，因此`openWorldHint=false`。

Server instructions与描述明确：

- Test Review必须先Inspect，再由Controller提交独立judgment；Decision不运行检查、不创建attempt、不授权产品修复；
- Product Remediation只在Route选中对应frontier后，使用精确Test Decision、post-acceptance route digest、既有产品Target与failed-check映射；
- Remediation只追加existing-TaskPackage Authorization Event，不创建Delivery、不执行修复、不允许Test改产品、不创建下一TestCard或完成Demand；
- 两项成功后都必须重新Inspect Route，不能从工具结果自行推断下一效果。

Server options的exact field set、Proxy executor准入、稳定配置错误、公共错误envelope和Event authority映射同步增加两项executor。Codex/Claude composition root通过同一17工具名称集合。

#### 官方SDK structuredContent适配修正

首次17工具真实纵切在Test Review Inspector的官方SDK outputSchema阶段暴露：领域Public结果使用Foundation规定的null-prototype JSON对象；Test Result内对象数组触发SDK校验器的`uniqueItems` deep-equal，其实现假定对象拥有可调用`valueOf`，返回`a.valueOf is not a function`。同一Public Coordinator直接调用与Wakeflow Runtime Schema均已通过，故问题明确位于协议适配层。

`wakeflow-public-mcp-server.ts`新增唯一`successfulToolResult()`：

```text
领域Public结果
→ Canonical JSON文本
→ JSON.parse为标准MCP JSON对象
→ 同一文本进入content
→ 标准对象进入structuredContent
```

这不修改领域对象、Schema或持久字节，也不为SDK建立第二份独立投影；text与structuredContent共享同一Canonical JSON事实。17个重复成功响应模板全部收敛到该函数，同时解决官方SDK对null-prototype对象的兼容问题并降低新增工具维护成本。

#### 真实MCP纵切

新增Codex官方Client真实链：

```text
Test Review Inspector
→ SDK拒绝旧targetTaskId echo
→ Test escalate-product-defect Decision
→ 冲突Decision返回state/current且不回显judgment
→ Demand Route + postAcceptanceRouteDigest
→ SDK拒绝旧testTargetTaskId echo
→ Product Remediation Authorization
→ 精确幂等重放
→ 冲突Authorization返回state/current且不回显rationale
→ Implementation Delivery Planning frontier
```

同时复验工具Schema ID、无外部URN `$ref`、四项annotations、描述边界、配置Proxy拒绝、错误envelope、既有14工具回归与双host parity。

```text
Shared MCP server:
  39 pass / 0 fail / 0 skip
MCP wire mirror + dual-host artifact candidates:
  3 pass / 0 fail / 0 skip
TypeScript: pass
Schema: pass / 99 schemas / 207 external refs
Schema digest: sha256:6b61ae4c9c1c009cc40573e33c26069db58fcd8dcc8cbbc4ccc6c0ed39f26daf
Architecture: pass / parser=swc / 707 modules / 4956 dependencies / 0 violations
Prettier: pass
git diff --check: pass
```

候选制品保持`releaseEligible=false`：

```text
Codex:
  419 files
  sha256:f521441e24d214c7e8a820b0f3ce7cb2eed07f867c675b8ac1b24c8f1cf821d7

Claude Code:
  424 files
  sha256:c37e56c5f14816f287c524c5de3adecc4d71e982c3b7ca712c2af8ecff4f94f6
```

本轮因果时间审计、Controller Test Decision与Product Defect Remediation公共闭环已经全部完成。下一步不应直接继续扩展业务文件；应进入一次技术骨干核实节点，从Route frontier→Public tool→Service→Event/Aggregate→下一frontier的全局矩阵重新审阅当前99 Schema、17工具、双host闭包、Foundation依赖和测试冗余，确认是否还有真实owner缺口、重复authority或可剪枝分支，再决定后续业务实现顺序。

### 222.25 技术骨干核实节点

已完成只读全局审阅并更新[Business Skeleton Consolidation Gate](./wakeflow-typescript-business-skeleton-consolidation-gate-2026-09-01.md#13-当前技术骨干核实节点17工具--901测试)。当前结论：

- 22种Demand Controller frontier中，全部当前可执行软件owner已有Public Tool；Research Completion和Implementation Redesign保持显式blocker，Host Effect execution保持Agent seam；
- 14个Event家族均有测试引用，17工具、99 Schema与双host候选闭包一致；
- 生产依赖图只有11个可解释叶子，没有孤立Review/Delivery/Test Service；Demand Publication Service是尚未公开的真实下一业务owner；
- Loaded Artifact transfer保持冻结，等待Evidence/Archive首个真实consumer复审，不继续横向扩张Foundation；
- 当前主要风险是测试维护：22种Route frontier仅10种有纯Route直接断言，MCP测试单文件4221行且helper拥有18个位置参数，Product Remediation重型纵切仍混在Test Decision Service测试中。

技术核实节点执行一次完整当前TS源清单门：

```text
901 pass / 0 fail / 0 cancelled / 0 skip
duration: 297.718717041s
```

当前规模与静态证据：

```text
handwritten src: 363 files / 122,565 lines
tests: 218 files / 56,871 lines
Schema: 99 / 207 external refs
Architecture: 707 modules / 4956 dependencies / 0 violations
Node: v24.19.0
npm: 11.17.0
```

后续方案：

1. `A — 测试与Route收敛（推荐）`：先把MCP测试改为exact override object、收敛职责边界、建立22项轻量Route矩阵证据、把Product Remediation测试移回其owner；随后进入Demand Publication Public。
2. `B — 直接Demand Publication Public`：更快增加用户功能，但继续放大当前测试债务。
3. `C — Evidence/Archive`：消费Artifact transfer，但业务生命周期入口与测试债务仍未解决。

推荐`A → B`。本节点没有修改旧JS、core、plugins、tools、旧test或外部Atlas，也没有commit、发布或cache刷新。

### 222.26 MCP测试辅助层收敛（方案A / A1）

本单元只review并重写`tests/entrypoints/wakeflow-public-mcp-server.test.ts`中的server连接辅助层。此前`connect(...)`按工具注册顺序接收18个位置参数；新增或重排工具时，调用方必须人工对齐大量默认函数，类型正确也无法直接表达每个实参属于哪个executor。

当前实现直接从`createWakeflowPublicMcpServer`的真实options类型推导`WakeflowMcpExecutorSet`，再以`Partial`形成具名override边界：

```text
真实PublicServerOptions
→ 排除serverName/serverVersion
→ 完整executor默认集合
→ connect(t, { capabilityName: testExecutor })
```

30个调用点均改为具名覆盖，并只写出该用例实际替换的executor。17个默认executor统一fail-fast，未声明的跨工具调用会立即失败，而不会被占位成功结果掩盖。这样不建立第二份手写executor签名，不改变MCP composition root，也不把测试便利类型带入生产代码。配置Proxy与额外options拒绝测试保持原状。

本单元没有修改生产实现、Schema、Event、持久化字节或公共协议。MCP测试文件从4,221行收敛至4,028行，减少193行；剩余4,028行仍包含catalog、SDK Schema准入、错误映射和真实磁盘纵切，后续必须按证据继续拆分，不能把相同17工具装配复制到多个文件。

```text
Shared MCP server: 39 pass / 0 fail / 0 skip
TypeScript: pass
Architecture: pass / parser=swc / 707 modules / 4956 dependencies / 0 violations
Prettier: pass
git diff --check: pass
```

下一单元继续方案A，但先以当前文件依赖和测试职责为事实选择边界：比较“抽取唯一MCP测试fixture后按catalog/真实纵切/error envelope拆分”与“先完成22项轻量Route映射证据”的维护收益。选择不得引入生产抽象，也不得复制领域fixture。

### 222.27 唯一MCP测试fixture边界（方案A / A2）

审阅4,028行MCP测试后，没有直接按行数拆成catalog、纵切和error三个文件。原因是当前领域结果样例与真实workspace fixture分别属于17个真实owner；先物理拆文件会复制大批import、builder和组合根装配，却不会提高行为证据的独立性。

本单元新增唯一`tests/entrypoints/wakeflow-public-mcp-server.fixture.ts`，仅下沉三类无业务判断的协议测试机械能力：

- 从真实Public Server options推导的17个fail-fast executor及exact override；
- 官方SDK `Client`、`InMemoryTransport`连接与成对关闭；
- 唯一文本内容块读取。

原测试的30个单能力连接继续使用`node:test`的`t.after`自动清理；8个双host或真实磁盘纵切使用同一连接函数，但保留显式`close → cleanup workspace`顺序；连接中途失败也会成对尝试关闭Client与Server；152个文本读取点复用同一结构检查。领域result builder、请求样例、Schema断言、Route判断和错误envelope期望均留在测试文件，不进入共享fixture。

```text
主MCP测试：4,028 → 3,889（-139）
共享fixture：126
两文件合计：4,015（相对A1减少13）
相对技术核实节点4,221行：合计减少206
Shared MCP server: 39 pass / 0 fail / 0 skip
TypeScript: pass
Architecture: pass / parser=swc / 708 modules / 4958 dependencies / 0 violations
Prettier: pass
git diff --check: pass
```

A2在共享装配边界处收束，没有修改生产代码、Schema、Event、公共协议、旧JS或双host制品。下一单元进入A3，直接建立22项轻量Route frontier→owner→phase表驱动证据；在该证据完成前不继续增加业务frontier。

### 222.28 Controller Route完整责任矩阵（方案A / A3）

审阅确认22种Controller frontier来自三类不同事实：2种无Implementation Target的Demand条件、8种Implementation责任前沿、12种ready Post-Acceptance责任前沿。原实现将这些映射嵌在两个私有switch和`routeBasis`分支中，纯Route测试只直接到达10种，剩余映射主要依赖重型相邻纵切。

本单元没有构造伪Aggregate，也没有导出测试专用状态修改口。`demand-controller-route.ts`将原映射提取为三个Controller owner纯函数，并让真实构建路径直接消费：

```text
resolveDemandControllerDemandFrontierDescriptor
resolveDemandControllerImplementationFrontierDescriptor
resolveDemandControllerPostAcceptanceFrontierDescriptor
```

函数只返回未附加Target引用的冻结descriptor，因此命名没有把它们伪装成完整Route frontier。完整Route继续拥有Target引用、redesign blocker、source关系、排序、digest与disposition。

新增`demand-controller-route-frontier-matrix.test.ts`，表内有22个唯一frontier kind；共享映射的多个phase逐项执行，`accepted`另行证明不产生Implementation frontier。TypeScript条件类型同时证明Demand condition、非accepted Implementation phase和全部ready Post-Acceptance status都已进入矩阵；后续union扩展若遗漏测试，会在编译期失败。

```text
Pure matrix runtime: about 2 ms
Pure frontier matrix: 1 pass / 0 fail / 0 skip
Focused total including matrix: 14 pass / 0 fail / 0 skip
TypeScript: pass
Architecture: pass / parser=swc / 709 modules / 4959 dependencies / 0 violations
Prettier: pass
git diff --check: pass
```

Route源文件从652行增至703行，新矩阵测试366行；该增长固定绑定真实Route policy，不随MCP consumer增加。本单元没有修改Schema、Event、持久化字节、MCP工具、旧JS或制品构建。901项全量结果仍是A1–A3前的核实节点证据，本单元没有伪称已重跑。

下一单元进入A4：将Product Defect Remediation完整纵切从Test Decision Service测试移回其owner测试，迁移后删除重复断言与不再使用的fixture依赖。

### 222.29 Product Defect Remediation测试归位（方案A / A4）

当前代码没有`controller-product-defect-remediation-service.test.ts`。Remediation Authorization已有纯单元测试，Public Coordinator已有协议纵切，但624行Service的完整Event/Aggregate/返工/retest链被放在`controller-test-review-decision-service.test.ts`第三个用例中，使Test Decision生产者测试同时拥有下游消费者生命周期。

本单元新增Service owner测试并迁移整条真实纵切：

```text
Test defect Decision
→ Post-Acceptance defect route
→ Product Remediation Authorization Event
→ affected Implementation Target返工
→ replacement Delivery / Host Effect / Result Import
→ Controller重新accept产品Target
→ product-defect retest TestCard
→ 新Test Task进入Delivery planning
```

Test Decision Service测试只保留自己的`accept`与`request-another-attempt`准入、Event history、Review Snapshot、Route和幂等/冲突证据。其Remediation、Delivery、Result、Implementation Review、TestCard/Task Planning imports与常量全部删除。

新的Remediation Service测试继续复用`controller-test-review-decision-service.fixture.ts`来产生前置reported Test状态；这是实际producer fixture，且当前同时被Public Coordinator消费。没有为单一Service测试新增只转发该fixture的包装层。

Authorization单元测试、Service真实纵切和Public Coordinator协议测试保留各自层级的必要重叠，没有复制第二条Service纵切：

```text
Test Decision Service test：854 → 222
Product Remediation Service test：新增649
两文件合计：871（净增17）
Test Decision + Remediation Service: 3 pass / 0 fail / 0 skip
Authorization + Public Coordinator: 4 pass / 0 fail / 0 skip
Owner surface total: 7 pass / 0 fail / 0 skip
TypeScript: pass
Architecture: pass / parser=swc / 710 modules / 4967 dependencies / 0 violations
Prettier: pass
git diff --check: pass
```

本单元没有修改生产代码、Schema、Event、持久化、MCP、旧JS或候选制品。方案A的四项测试/Route收敛完成后，重新执行当前完整TypeScript门：

```text
902 pass / 0 fail / 0 cancelled / 0 skip
duration: 325.564075125s
Schema: 99 / 207 external refs
Schema digest: sha256:6b61ae4c9c1c009cc40573e33c26069db58fcd8dcc8cbbc4ccc6c0ed39f26daf
Architecture: parser=swc / 710 modules / 4967 dependencies / 0 violations
```

双host候选manifest摘要保持不变，`releaseEligible=false`；完整门没有commit、push、tag、publish或cache刷新。下一步按既定`A → B`进入Demand Publication Public准备审阅：先读取现有Publication Service及其真实producer/consumer，不直接注册工具，也不在审阅前新增Foundation。
