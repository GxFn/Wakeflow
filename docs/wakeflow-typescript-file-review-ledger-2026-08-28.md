# Wakeflow TypeScript 逐文件审阅台账

> 创建日期：2026-08-28
> 基线提交：`df0eece feat: establish TypeScript technical skeleton`
> 当前状态：`active / file-review-mode / implementation-by-confirmation`
> 当前单元：`TypeScript technical review gate closed / awaiting next-stage decision`
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
