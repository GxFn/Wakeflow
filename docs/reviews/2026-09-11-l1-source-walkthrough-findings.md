# L1 源码逐文件走读：发现清单

> 状态：`proposed`，未经用户裁决，不具权威；本文只记录观察与建议，不改变任何现行合同
> 建立日期：2026-09-11
> 基线提交：`7ba1f38 feat: managed evidence sources and pod lifecycle with worktree receipts (L1 evidence 8, pod 9)`
> 范围：按阅读路线自底向上走读 `src/` 的 59 个主干文件（12 个阶段 A 到 L），覆盖内核、配置、治理域与九个已落地 L1 切片
> 方法：只读。每个文件读模块头、导出面、全部 `fail(` 分支与对应测试，并回查上下游 consumer。所有事实以代码为准，未运行任何修改，未跑额外测试

## 1. 本文的边界

- **未验证项已标注。** 凡是"如果这样改会怎样"的推断，文中写明是推断；凡是可被 grep 或读代码直接确认的，给出文件与行号。
- **不是任务队列。** 条目之间没有依赖关系假设，也没有排期。第 8 节给出按"修法成本 × 影响面"的排序建议，仅供裁决参考。
- **不覆盖**：`foundation/` 的 34 个文件系统原语、`workspace/maintenance/` 与 `managed-integration/`、`contracts/generated/`。这些在走读范围之外。

## 2. 四类同族问题

走读中反复出现的四个模式。每一族的单条都不大，但同族出现三次以上说明缺的是一条统一约束而不是一次疏忽。

### 2.1 重复的策略常量没有单一权威

| # | 常量 | 权威定义处 | 副本处 | 副本的类型 |
| --- | --- | --- | --- | --- |
| A1 | 可替代相位 | `src/governance/demand/model/demand-aggregate-state.ts:2748`（未导出） | `src/capabilities/tasking/decide.ts:122` | `readonly string[]`（丢失相位联合） |
| A2 | 投递代际上限 | `src/governance/delivery/delivery-rearm.ts:33` `DELIVERY_REARM_LIMIT = 3`（已导出，五处引用 `+1`） | `src/kernel/work-claims.ts:79` `MAXIMUM_GENERATION = 4` | 裸字面量，无注释 |
| A3 | 凭证类 finding 种类 | 无。`src/kernel/privacy-scan.ts` 只定义全集 | `src/capabilities/demand/decide.ts:92`、`src/governance/evidence/managed-evidence-capture-planning-service.ts:198` | 一处 `readonly string[]`，一处联合 |

三例形状一致：跨模块策略常量没有单一来源，副本之间没有编译期或测试期绑定，且至少一份副本的类型比权威侧弱。

A2 的成因是分层——`kernel/` 不能 import `governance/`，所以复制是被迫的。这恰好说明常量放错了层：内核已经实质依赖这个数字，应当由内核（或 `contracts/vocabulary`）拥有，治理域向下 import。

A3 后果最重：这条列表决定什么东西**绝对不能**进入受管证据和归档包。给 `privacy-scan.ts` 增加第六种 finding 种类时，必须同时改两个不同层的私有常量；漏一个，新的凭证种类就在那一道门上退化成可被 Controller 确认放行的软命中。

**建议**：A3 由 `privacy-scan.ts` 导出 `CREDENTIAL_PRIVACY_FINDING_KINDS`；A1 由 `demand-aggregate-state.ts` 导出 `REPLACEABLE_PHASES`；A2 把上限移进内核并让 `DELIVERY_REARM_LIMIT` 从它派生。

### 2.2 按联合成员分派的穷尽性保护强度不一

同一个子系统里三处"按事件类型分派"，保护强度递减，而**最危险的那处保护最弱**。

| # | 位置 | 保护 |
| --- | --- | --- |
| B1 | `src/governance/demand/event-sourcing/demand-event-sourcing-decider.ts` `evolveDemandEventSourcingState` | **无**。14 个显式 `if` 之后直接兜底 `cancelDemandAggregateState(state)`，`lifecycle.demand-cancelled` 靠落空处理 |
| B2 | `src/governance/demand/event-sourcing/demand-event-stream-commit.ts` `assertEventCommitBoundary` | **无**。硬编码 4 个 `if`，覆盖 15 类事件中的 4 类 |
| B3 | `demand-event-sourcing-event-version-codec.ts:515` `EVENT_VERSION_REGISTRIES` | 隐式。`satisfies Record<DemandEventSourcingCurrentEventType, ...>` 只绑定注册表与数组；与 `DemandUncommittedEvent` 的链接只靠 `encodeCurrentDemandEventVersion` 里一行索引表达式 |

B1 的失效模式最坏。`decide` 的同位置兜底因为读了 `command.reason`（仅 `CancelDemandCommand` 有）而**意外**得到类型收窄保护；`evolve` 的兜底一次都没碰 `event`，所以没有任何约束。加第 16 类事件、在联合与解析器里都加好、唯独漏掉 `evolve` 分支，结果是：

- 那类事件被静默当作取消处理
- 写路径用错误的 `evolve` 算出 `resultingStateDigest`，读路径用同一个错误函数重算，两边一致
- 「四层摘要锁」一层都不会响——它们校验"重放能否复现写入时的结果"，而写入时就是错的

这是事件溯源里最坏的一类缺陷：**持久且自洽的错误**。

B2 守的是围栏令牌与流位置的对齐，漏掉一个新事件类型意味着那类事件的载荷位置不再被核对。

**建议**：三处统一成显式穷尽。B1 加 `const unhandled: never = event;`；B2 改成 `satisfies Readonly<Record<DemandUncommittedEvent["eventType"], ... | null>>` 的表，每类事件显式写"绑"或"不绑并说明理由"；B3 的 `satisfies` 改用 `DemandUncommittedEvent["eventType"]` 作为穷尽性来源，而不是自己派生出的类型。

### 2.3 已经在手里的数据没有往下传

五处都是"上游已经加载好了对象，下游重新去取"，都不涉及正确性取舍。

| # | 位置 | 重复的工作 |
| --- | --- | --- |
| C1 | `demand-event-sourcing-repository.ts` `#findUniqueEvent` → `#currentAggregate` → `this.load()` | 每次 `findXxxEvent` 一次完整 `load()`，而调用方（如 `delivery/service.ts:366` 等处）手里已有 `context.authority.loaded.aggregate` |
| C2 | `result-review/service.ts:710` `resolveEvidenceReference` | 带 `kind` 的 payload 引用把同一份受管证据记录加载两次（`readEvidenceMember` 内一次，kind 检查一次） |
| C3 | `result-review/service.ts:644` `resolveEvidence` | 引用之间无缓存。定位符上限 64（两份结果报告 Schema 的 `maxItems`） |
| C4 | `result-review/service.ts` 决定路径 | **每次评审决定做两次完整事件流重放**：`loadDecisionSources` 一次，`next` 里 `readDemandResultReviewSnapshot` 再一次（它自己 `new` 一个仓储） |
| C5 | `demand-event-stream-commit.ts` `buildDemandEventStreamCommit` | 主循环逐事件 `evolve` 一遍，末尾 `applyDemandEventStreamCommit` 再重新解析提交并 `evolve` 一遍 |

C5 是有意的（`apply` 是权威复验），其余四处不是。

具体开销叠加：一次投递命令走三次 `load()`（`openContext`、`loadEnvelope`、`loadTaskPackage`）；一次评审决定走两次全量审计；单个事件在写路径上经历三遍转移、约六次全量 `parseDemandAggregateState`（`decide` 守卫一次、build 循环一次、apply 复验一次，每次转移入口出口各解析一次）。

**建议**：C1/C2/C3 给相关函数加可选的已加载对象参数；C4 先量测再决定（见 8.3）。

### 2.4 多个拒绝点共用一个错误原因

| # | 位置 | 规模 |
| --- | --- | --- |
| D1 | `demand-aggregate-state.ts` | 46 处 `fail("transition", ...)`，其中 26 处共用 path `"$/targetTasks"`；整台状态机（23 相位、16 转移、数百条守卫子句）只有 `relation` 与 `transition` 两个 reason |
| D2 | `demand-controller-route.ts` + `demand-post-acceptance-route.ts` | 14 处 `fail("relation")`（8 + 6），且这两个错误类是走读范围内**唯一没有 `path` 字段**的错误类 |
| D3 | `task-package.ts` `normalizeWire` 测试分支 | 六条互不相干的互斥检查塌成同一个 `(schema, "$/testContract")`，其中三条是"变体带了不属于它的字段"，本该是 `relation` |
| D4 | `endpoint/decide.ts` | `handle-conflict` 有两个不同含义（别的窗口占着该句柄 / 本窗口已绑别的句柄），共用同一 reason 与 path，而调用方要采取的动作不同 |

D1 最要紧的一点：`transition` 里混着"状态摘要漂移"这种**可重试**的情况和"相位不对"这种不可重试的情况，调用方无法区分。

D2 的错误语义是"Wakeflow 自己的两个读模型对不上"——遇到它的人最需要知道是 14 条断言里的哪一条，而现在只有一句固定消息。

**建议**：D1 至少把摘要漂移拆成独立 reason（三个带 `stateDigest` 锚的转移各加一条前置，报可重试的 `state-drift`）；D2 把两个错误类补齐成 `(reason, path)` 两元组；D3 六行拆开；D4 后者改成 `binding-exists`。

## 3. 正确性缺口

按可能造成的后果排序。

### 3.1 结局的两步不原子，重放路径不补第二步

- **位置**：`src/capabilities/delivery/service.ts` `executeOutcome` / `replayOutcome`
- **事实**：`releaseClaimFor` 只在 `commandResult.disposition === "committed"` 时调用；`bound !== null` 的重放路径直接 `return replayOutcome(...)`，而 `replayOutcome` 不碰声明
- **后果**：追加成功后、释放声明前崩溃 → 重试走重放路径 → 声明残留。此时目标处于 `host-effect-rejected`，`rearm` 与 `prepare` 的 `takeClaim` 都会因 `deriveClaimBlocker` 第三条（`knownDeliveryIds.includes(holder.deliveryId)`）被拒且 `reclaim: false`。唯一出路是 endpoint 的恢复门，需要两小时过期、会话已结束或端点缺席三者之一
- **先例**：`src/capabilities/result-review/service.ts` `replayImport` **确实**调用了 `releaseFence`。同一个两步模式，一个切片补齐了重放路径，另一个没有
- **修法**：`releaseClaimFor` 本身已幂等（`claim === null || claimId 不符` 即返回），把释放动作提出 `committed` 分支，两条路径共用

### 3.2 `releaseFence` 在清理阶段硬失败，而事件已经提交

- **位置**：`src/capabilities/result-review/service.ts:833`
- **事实**：`inspected.claim.claimId !== fence.claimId` 时 `fail("precondition-failed", "claim-foreign", ...)`；两条调用路径都在 `appendCommand` **之后**
- **后果**：导入成功 → 窗口被新投递重新取用 → 旧幂等键的重试走 `replayImport` → `claim-foreign` 硬失败。调用方拿到的错误指向 `$request.deliveryId`，实际情况是导入早已成功
- **与 3.1 合看**：两个切片对同一情形给了相反处理。正确答案是 delivery 的语义（不是自己的就跳过）配 result-review 的调用位置（提交路径与重放路径都调）
- **修法**：合并成一个共享助手，建议放进 `src/kernel/work-claims.ts`，例如 `releaseWorkClaimIfHeld(root, windowId, fence)`。两个切片各改两行，同时关掉 3.1 与 3.2

### 3.3 工作声明未在互斥门内重检（TOCTOU）

- **位置**：`src/capabilities/endpoint/service.ts` `mutateBinding`
- **事实**：`decideDecommission` / `decideReplace` 用锁外读到的 `loaded.claim` 判断 `claim-held`；进锁后只重检 `bindingDigest`，未重读声明
- **后果**：endpoint 读到"无声明" → delivery 取得声明并签发许可 → endpoint 拿到绑定锁 → 退役绑定。结果是一张指向已退役绑定的投递许可
- **性质**：可恢复（发送时失败、声明可走 `release-claim`），但同一处专门重检了绑定摘要，说明作者意识到了锁内外差异，只是漏了声明
- **修法**：闭包开头加一次 `loadClaim` 并比对 `claimId`，不匹配报 `concurrency-conflict/claim-changed`（可重试）

### 3.4 中止信号被吞

| 位置 | 事实 |
| --- | --- |
| `src/capabilities/demand/verify.ts:49` `guarded` | 捕获一切并转成 `gate(name, "unavailable", reason)`，包括 `aborted`。第 3 道门是全量审计重放，取消发生在这里时，剩余五道门也各自因同一信号失败，最终返回一份八道门全 `unavailable` 的完整 preview，看起来像正常的阻塞结果 |
| `demand-event-sourcing-repository.ts` `refreshCheckpoints` 退休阶段 | `catch` 吞掉全部 `DemandFileEventSnapshotStoreError`，包括 `aborted`。同一个类里的 `publishSnapshot` 显式区分了 `aborted` |

树里其他每一处错误映射的第一行都是 `if (error.reason === "aborted") fail("io-failure", "aborted", "$signal")`。这两处是例外。

**修法**：各加一行 `if (reason === "aborted") throw error;`。`guarded` 修好后还有附带收益——中止立刻上抛，剩下五道门不会白跑。

### 3.5 复测基线用自由文本做连接键

- **位置**：`src/capabilities/result-review/decide.ts` `deriveStepViews`；数据源在 `service.ts:1160`
- **事实**：同目标的更早尝试按 `stepId` 匹配（精确）；retest 链跨代际按 `then` **文本相等**匹配
- **后果**：
  - 复测合同里把 `then` 改一个词 → 上一代已通过的那一步失去基线 → `deriveUnionVerdict` 返回 `cannot-conclude` → `accept` 被挡，被迫重跑一个已通过的步骤。错误信息是 `verdict:cannot-conclude`，看不出根因是措辞变了
  - 两条不同验收条目的 `then` 文本相同（"no errors in the log" 这类断言容易撞）→ 基线挂到错误的步骤上，选哪个由 Map 插入顺序决定
- **更好的键就在同一个对象上**：`TestContractStep.requirementRef.itemId`。H 阶段的 `deriveTestStepReferenceBlockers` 已强制它命中真实验收条目，`parseTestContract` 已强制它在合同内唯一
- **修法**：`service.ts:1160` 的 map 值改成 `step.requirementRef.itemId`，`decide.ts` 的比较相应改；`expectedByStepId` 顺带改名

### 3.6 Controller 显式解决可引用任何一类 hook 记录

- **位置**：`src/capabilities/delivery/service.ts` `decideOutcome`
- **事实**：同一函数内，`landingRecords` 过滤成 `user-prompt-submit`，`resolutionRecordFound` 对**全部**记录做 `some`
- **后果**：把 indeterminate 投递解决成 `accepted` 时，引用的记录只需存在于该会话且时间晚于 `preparedAt`，不要求是落地记录。引用一条 `session-start` 即可通过——而它对"这次投递是否落地"零信息量（会话在投递之前就已启动）
- **分量**：`controller-resolution` 是人工覆盖自动判定的通道，产出的 `evidenceKind` 写进事件成为永久理由。它的证据要求现在比自动路径宽
- **修法**：复用上两行已有的 `landing` 数组。若有意允许更宽的集合（如 `stop` 也算），应显式写出允许集合并说明理由

### 3.7 `retireDemandRoot` 在没有 inode 期望的情况下递归删除

- **位置**：`src/capabilities/demand/archive.ts:583`
- **事实**：`demandRoot.close()` 之后用第 1 步捞到的 `observation.physicalPath` 调 `rm(..., { recursive: true, force: false })`；`observation.node` 未在删除前再核对，`fs.rm` 也不接受 inode 期望
- **与自身纪律不符**：全树其他文件操作一律带期望（`unlinkRegularFileExactly({ expectedNode })`、`replaceFileAtomically({ expected: {...} })`）。这是唯一一处例外，恰好落在唯一会销毁用户内容的操作上
- **现成的对偶写法就在同一文件**：`sealDemandArchive` 用"候选目录整树落盘 → 重命名到最终位置"保证创建原子性；删除侧的镜像是"先重命名成唯一退休名（可带 inode 期望），再删那个唯一名字"。附带好处是崩在中途只留下明显是垃圾的 `.retired-*` 目录
- **威胁模型**：能往工作区写入的人本来就能做更糟的事。这是纪律一致性问题，不是可利用的漏洞

### 3.8 `RESERVED_SOURCE_ROOT_SEGMENTS` 只检查路径第一段

- **位置**：`src/governance/evidence/managed-evidence-source-selection.ts:174, 284`
- **事实**：守卫意图是 `.git` / `.wakeflow-active` / `.wakeflow-local` 永不作为证据来源，但只看第 0 段。实测 `PORTABLE_RESOURCE_PATH_PATTERN`：`"."` 被拒（不能选根本身），`".git"` 被守卫拦下，**`"docs/.git/config"` 通过**（首段是 `docs`）
- **另一侧**：树捕获无排除列表。`captureTree` → `inspectLoadedArtifactTree(treeRoot, { limits })`，参数只有容量上限，没有排除谓词
- **后果边界**：容量上限会挡住真实的大 `.git`（那是容量错误，不是静默捕获）；小的 `.git` 内容能装下并走隐私扫描。扫描能否拦住 `.git/config` 里带 token 的远程 URL 取决于具体模式，**本次未逐一验证，不下断言**
- **先例**：`sealDemandArchive` 有 `ARCHIVE_EXCLUDED_PREFIXES`，树操作里用排除列表是有惯例的
- **修法**：检查每一段而非首段；树遍历传入同一个排除集合。第一条顺带拦住单仓库工作区（`configuredPlacement: "."`）下 `.wakeflow-local` 与仓库根重合的情形

### 3.9 隐私扫描对每个命中重新切分全文

- **位置**：`src/capabilities/requirement/decide.ts:79` `matchedText`
- **事实**：`text.split(/\r?\n/u)[finding.line - 1]` 每次调用全量切分；调用点在 `.filter()` 里，对每个 `unlisted-absolute-path` 命中执行一次。`scanPrivacy` 不限制返回条数（`src/kernel/privacy-scan.ts:112`），`PRIVACY_BLOCKER_MAXIMUM = 32` 在 filter **之后**才截断。单成员上限 4 MiB
- **触发条件完全良性**：一份列了几百个文件路径的需求文档（目录树、改动清单、接口路由表）。500 个命中 × 4 MB = 2 GB 的字符串切分，发生在一次 preview 里
- **修法**：行数组算一次传进去，或让 `scanPrivacy` 的 finding 带偏移量。顺带给 `scanPrivacy` 加返回上界——它是内核、被多处调用，无界返回是共性风险

### 3.10 一段取不到的分支把 `pod-busy:unknown` 送进公共 blocker

- **位置**：`src/governance/demand/publication/demand-active-guard.ts:157` → `src/capabilities/demand/service.ts:172` → `src/capabilities/demand/decide.ts:272`
- **事实**：guard 里 `details: state.claim === null ? {} : { demandId: ... }` 的左分支不可达（`parseRequirementClaimState` 规定 `status === "claimed" ⇒ claim !== null`），但它逼出了调用方的 `error.details?.demandId ?? "unknown"`，再变成公共 blocker `pod-busy:unknown`——告诉调用方 pod 忙却不告诉被谁占着
- **修法**：guard 里提前收窄 `if (state.status !== "claimed" || state.claim === null) continue;`，下游的 `?? "unknown"` 随之删除
- **附带**：`activeDemandOnPod` 把断言式 API 当查询用（正常的"pod 忙"要构造并抛一个带 stack 的 Error 再从 details 捞答案）。建议 guard 导出 `findActiveDemandOnPod(...): Promise<string | null>`，断言式建在它之上

## 4. 纪律一致性

### 4.1 三处持久化记录没有解析器

树里每一份持久化记录都有 `parseXxx`（严格键集 + 关系检查）、`renderXxx` 与字节往返核对。三处例外：

| # | 记录 | 缺什么 | 分量 |
| --- | --- | --- | --- |
| E1 | 生命周期事务日志 `.wakeflow-active/current/lifecycle/<demandId>.json` | 读回只有 `kind` 字符串比较 + `as unknown as Journal`。`schemaVersion: 1` 写了从不读；`planDigest` 写了从不复算 | **它是"删掉 Demand 根"这一步的恢复权威**。`plan.commitId` 决定追加哪个提交、`plan.archive.archiveRef` 决定封到哪、`plan.windowIds` 决定扫哪些声明 |
| E2 | 强制释放回执 `hosts/<host>/observations/claim-releases/<claimId>.json` | 用 `JSON.stringify(receipt, null, 2)` 手写持久化（`src/` 下六处 `JSON.stringify` 里唯一一处这样用的）。无确定性表示、无解析器、无 Schema。`target-exists` 直接返回，不比内容 | 模块头承诺"Demand 侧由 delivery 切片对账"，但全库唯一提到 `claim-releases` 的其他地方是一句 `existsSync` |
| E3 | 身份与权威记录 | 无升版机制。事件与状态模型都有完整版本演进（逐版本编解码器、升版注册表、兼容摘要驱动快照失效），身份/权威只有写死的 `schemaVersion: 1` | 身份是**永久的、写一次、每次加载都要读回**的东西。发布之后用户工作区里的 `identity.json` 就是 v1 |

E1/E2 各补一个约 60 行的严格解析器即可，`planDigest` 同时从只写数据变成真正的完整性锚。E3 是架构缺口，建议记进 ADR 未决项而非现在建机制——`demand-event-sourcing-state-version.ts` 的模块头已经写清了正确走法（"未来新增状态模型时必须登记历史校验器或迁移器"），身份侧连这句都没有。

### 4.2 权威引用列表的规范顺序只有一半

- `demand-authority.ts` `parseReferences`：create 排序，parse 验证严格递增（排序 + 去重一次完成）
- `task-package.ts` `parseSelectedAuthorityRefs`：只按 `memberRef` 去重，保留调用方顺序

两个都是 `LedgerAuthorityMemberReference` 的非空列表，都会被摘要化并比对。后者导致 `taskPackageDigest` 依赖调用方给引用的顺序。

当前无活的缺陷（`taskPackageId` 由 `(demandId, idempotencyKey)` 派生而非内容派生；所有 `taskPackageDigest` 比较都在同一个包的两份拷贝之间）。但 `taskPackageDigest` 被广泛用作身份锚（`DemandImplementationTargetTaskStateBase`、`TestImplementationBaseline`、`DeliveryEnvelope.target`、`ControllerReviewDecision.reviewed`、`pendingTestRetest.previousTestTarget`），它回答的应该是"内容是否相同"，现在回答的是"对象是否相同"。

**修法**：把 `demand-authority.ts` 的 `referenceLocationKey`（五字段 NUL 连接）提到 ledger 合同层共用，两处都用严格递增。

### 4.3 角色唯一性未强制，而下游用 `.find` 取第一个

- `demand-authority.ts` `assertIdentityRelations` 只检查 `REQUIRED_ROLES` 的每个角色**存在**，不检查唯一；`referenceLocationKey` 的五个字段不含 `role`
- `src/governance/review/demand-post-acceptance-route.ts:328` `resolveDemandTestEnvironmentAuthority` 的注释写着"需求包里**唯一的**环境角色成员"，实现用 `.find`

环境权威决定真实环境测试跑在哪份环境说明上（它进 `TestContract.environment`，最终进测试任务包被 Agent 读取）。当前不可达（`createDemandAuthority` 的唯一调用点是单条记录的 `loaded.documents.map(...)`），但注释里的"唯一"是假设不是事实。

**修法**：`assertIdentityRelations` 把存在性检查升级成"每个必需角色恰好一个"。一行。

### 4.4 跨文件刷新不原子，且未注明

`src/capabilities/endpoint/service.ts` `mutateBinding` 在同一把锁里依次写四个文件：绑定文件、worktree 回执、tmux 定位器、投影文档。锁保证没有两个进程同时改，不保证要么全做要么全不做。取舍本身合理（投影可由 `maintain_workspace` 重算，回执与定位器会被下次 register/replace 覆盖），但没有任何注释说明这是有意的，也没有测试覆盖"投影落后于绑定时能修回来"。

### 4.5 看板索引刷新被放进终态事务的失败路径

`src/capabilities/demand/lifecycle.ts` `applyTerminal`：

```
retireDemandRoot(...)              ← 五步全部完成
refreshRequirementBoardIndex(...)  ← 可能抛 io-failure/board-index-contended
deleteJournal(...)
```

看板模块自己对这个失败的定性是"索引是投影……权威状态已提交不受影响"。但走到这一行时终态事件已写、归档包已封、需求包已置终态、声明已释放、Demand 根已删——唯一没做的是重写一份人读的 Markdown 表格。索引撞车会让整个 `wakeflow_complete_demand` 以 `io-failure` 返回，调用方不知道其实全都成功了。

后果不是数据损坏（日志还在、recover 会重放并收敛），但这是一次不必要的失败报告加一次不必要的重放，而重放要重新打开归档、重读看板、重扫工作声明。

**修法**：把索引刷新移到 `deleteJournal` 之后并单独捕获 `board-index-contended`。同一位置在 `requirement/service.ts` 的 `applyPublish` 也有一处，影响小得多，一致性上值得一起处理。

### 4.6 全树仅有的两个非空断言

```
src/governance/demand/model/demand-aggregate-state.ts:1242   testAttempts.at(-1)!
src/governance/demand/model/demand-aggregate-state.ts:1655   target.testAttempts.at(-1)!
```

`src/` 下非空断言总数是 2，两个都在这里。两处都安全（`DemandTestAttemptLineage` 是非空元组，TypeScript 对 `at()` 不做元组推断），但它们**看起来一样、论证不同**：1242 的非空性由刚构造它的代码保证，1655 由类型系统保证。

**修法**：加一个 `lastAttempt(lineage)` 小工具，两处各三行，换掉全树仅有的两个 `!`，并把"为什么一定非空"变成一句可读的话。

### 4.7 其余单点

| # | 位置 | 事实 | 修法 |
| --- | --- | --- | --- |
| F1 | `src/kernel/hook-observations.ts:409` | `skipped` 算的是 `total - candidates.length`，而 candidates 已被调用方的 `event`/`since` 过滤筛过。接口注释写的是"无法作为记录读入的条目数；调用方据此判断证据通道是否可信"，在任何过滤下都不成立 | 拆成两个计数。对照 `requirement-board.ts` 的 `listRequirementClaimStates`，同名字段在那里做对了 |
| F2 | `src/kernel/hook-observations.ts:445` | `readHostHookObservationRecord` 把同一文件读两遍——`readCandidateRecord` 内部已调 `readDeterministicJsonFile`（它返回 `digest` 与 `byteCount`），外面又 `readStableFile` 取回来 | 让 `readCandidateRecord` 返回整个读结果 |
| F3 | `src/capabilities/requirement/service.ts:636` | `requestPackages` WeakMap 把 `input.package` 从 plan 阶段绕回 apply 阶段，而 `apply(context, _input, plan)` 的 `_input` 本来就带着它 | 顺参数传，删掉 WeakMap 与 `requestPackageOf` |
| F4 | `src/capabilities/requirement/service.ts:967` | `loadExistingRecord(context as unknown as RequirementContext, ...)`——`BoardContext` 只少一个 `clock`，而函数只用 `store` 与 `signal` | 参数改成结构类型 `{ store, signal }`，双重断言消失 |
| F5 | `src/kernel/requirement-board.ts` `assertRelations` 第 8 条 | `status === "parked" && revision !== 1 && previousStateDigest === null` 在第 1 条通过后恒为假，不可达也不可测 | 删掉，或改成它真正想表达的转移层约束 |
| F6 | 三个切片各一行 | `computeDemandEventSourcingCommandDigest(command);` 返回值被丢弃（`tasking/service.ts:577`、`delivery/service.ts:525`、`result-review/service.ts:524`）。`command` 上一行刚由 `parseDemandEventSourcingCommand` 产出，所以既不校验也不使用，代价是对整个命令（含完整任务包 / 信封 / 结果）做一次规范 JSON 序列化加 SHA-256 | 三处删掉。真正需要摘要的地方在 `demand-event-sourcing-command-handler.ts:295` 自己算 |
| F7 | `src/capabilities/pod/service.ts` `recoverPod` | `retiredReceipts: removed ? 1 : 0`（`retirePodReceipts` 返回 `boolean`），而 `applyCloseComplete` 报实际条数。同一个公共结果字段在两条路径上是两种量纲 | 让 `retirePodReceipts` 返回 `Promise<number>`，或 recover 分支先 list 再删 |
| F8 | `src/capabilities/endpoint/decide.ts` `decideRegister` | 唯一不检查工作声明的变更操作。推理上安全（`register` 走到实际变更时 binding 必为 null），但这个不变量靠别的切片的行为保证，本文件看不出来 | 加一行注释说明，或补上不可达的检查 |

## 5. 测试缺口

| # | 缺什么 | 位置 |
| --- | --- | --- |
| G1 | **内核层的工作声明排他失败路径一条都没测** | `src/kernel/work-claims.ts` 无专属测试文件。`takeWorkClaim → window-claimed`（跨 Demand 排他，模块的头号不变量）、`releaseWorkClaim → claim-drift` / `claim-absent`、`parseWorkClaim → claim-digest` / `claim-generation`、`inspectWorkClaim → claim-representation` 全部无测试。测试里命中的 `window-claimed` / `claim-drift` 都指向 decide 层的纯函数预检——那一层看的是聚合视图，**看不见并发**；内核的独占创建才是真正的互斥点 |
| G2 | **未识别活性状态默认降级到人工门这条安全属性无测试** | `tests/capabilities/endpoint/decide.test.ts` 喂给 `decideEndpointCommand` 的活性值只有 5 种；`binding-mismatch` / `duplicate` / `coordinate-mismatch` / `metadata-mismatch` / `process-mismatch` / `host-context-drift` / `no-locator` 七个中间态只出现在同文件的**分类器**测试里。把 `alive` 误写成 `!absent` 现有测试全绿 |
| G3 | **事件模块十条关系检查只有一条有直接测试** | `src/governance/demand/event-sourcing/demand-event-sourcing-event.ts` 无专属测试文件。十处 `recordedAt` 必须等于载荷业务时刻的检查中，只有 managed-evidence 那条被直接测到（还是在 `tests/governance/evidence/` 里顺带测的）。这条规则是"事件可重构造"的基础，而 recover 路径建立在它之上 |
| G4 | **路由的 14 处交叉检查无测试** | 它们是"不可能发生"的断言，而"不可能发生"正是最需要在触发时说清楚的那类（见 D2） |
| G5 | **创建 Demand 的单元测试归属错位** | `tests/capabilities/demand/service.test.ts` 不导入 `executeDemandCreationRequest`（它测 `lifecycle.ts` 和路由查询）。创建路径的覆盖在 `tests/capabilities/requirement/service.test.ts:499` 与场景 `card-04/create-demand`。九个 blocker 里只有 `package-claim:*` 与 pod 两条被覆盖；`deriveCreationBlockers` 是纯函数，九个分支写成表驱动用例是十几行 |
| G6 | **规模基准缺失** | 全树没有任何地方量过"N 个提交、M 个目标的审计重放要多久"。`demand-aggregate-state` 的 `targetTasks` `maxItems` 是 **10000**，没有业务依据；配合 2.3 的重复系数，最坏情况一次追加做数万次变体解析 |

## 6. 文档漂移

| # | 位置 | 事实 |
| --- | --- | --- |
| H1 | `src/governance/delivery/delivery-envelope.ts` 模块头、`DELIVERY_PROMPT_MAXIMUM_CHARACTERS` 注释、`computeDeliveryPromptDigest` 注释 | 三处都描述"最终 prompt 由可移植 prompt 加工作区根派生"的两阶段模型，但代码里没有这个步骤。`computeDeliveryPromptDigest` 在 `src/` 只被调用一次，直接作用在 `portablePrompt` 上；工作区根本来就已在 prompt 里且是**相对**路径。留下的痕迹还有一对常量：`MAXIMUM_PORTABLE_CHARACTERS = 60_000`（`prompt.ts`）与 `DELIVERY_PROMPT_MAXIMUM_CHARACTERS = 65_536`，中间 5,536 的差额是当年留给"工作区根行"的余量。这条重要不是因为会出错，而是因为它描述的是**整条投递链上最关键的摘要**——按文档去补一个派生步骤才会真的坏事 |
| H2 | `src/capabilities/demand/archive.ts:581` | "这是本仓库唯一的递归删除点"可证伪：实际四处（`archive.ts:625`、`foundation/git/git-ignore-candidate-observation.ts:231` 与 `:345`、`kernel/pod-worktree-receipts.ts:751`）。注释的**本意**（唯一一处递归删除用户内容）成立，但一个 grep 就会让读者怀疑注释的可信度 |
| H3 | `src/kernel/hook-observations.ts:94` | `skipped` 的接口注释与实现不符，见 F1 |

（`src/kernel/command-shell.ts:68` 的"在打开根之前"已在本次走读中改正为"在打开上下文之前"，是本轮唯一的源码改动。）

## 7. 引导缺口

`src/capabilities/pod/decide.ts` `podMutationNext` 的 `pod-worktree-disposal` 前沿：

```
frontier: "pod-worktree-disposal",
owner: "controller",
suggestedTool: null,
blockers: presentCheckoutRepositoryIds.map((id) => `worktree-present:${id}`),
```

`suggestedTool: null` 是诚实的——Wakeflow 不 spawn git 也不删检出。但 blocker 文本只有 `worktree-present:<repositoryId>`，没说该用什么命令。这是全系统唯一一处把动作完全交给 Agent 却不给任何执行指引的前沿。

而 `worktreeCheckoutPresent`（`src/kernel/pod-worktree-receipts.ts:756`）只验"这里不再是一个 worktree 检出"（目录不在，或 `.git` 不是文件）。三种处置都通过：

| Agent 做了什么 | 检出目录 | `.git/worktrees/<name>` |
| --- | --- | --- |
| `git worktree remove` | 没了 | **清理了** |
| `rm -rf <checkout>` | 没了 | **留着（prunable）** |
| 转成独立克隆 | 还在但 `.git` 是目录 | 留着 |

对 Wakeflow 自身无影响（`parseGitWorktreePorcelain` 的消费方跳过 prunable）。对仓库有影响：每关一个用 `rm -rf` 处置的 pod，仓库里多一条 prunable 记录，直到有人 `git worktree prune`。

**建议**：在前沿描述或 blocker 里给出建议命令。E 阶段的 `worktreeInstructions` 已有给 Agent 宿主知识的先例（"`claude --worktree` 在 `.claude/worktrees/<name>` 下建检出"）。若要验证而不只引导，可让 `close-complete` 要求 Agent 交回一份新的 porcelain 确认目标检出已不在列表或已 prunable——与登记时准入 porcelain 同一套机制，方向反过来。

## 8. 排序建议

裁决用。三档按"修法成本 × 影响面"划分。

### 8.1 小改动、明确收益（建议优先）

| 条目 | 大致改动量 |
| --- | --- |
| 3.1 + 3.2 合并成共享的 `releaseWorkClaimIfHeld` | 内核加一个函数，两个切片各两行 |
| 3.4 两处中止上抛 | 各一行 |
| 3.10 guard 提前收窄，删下游 `?? "unknown"` | 两行 |
| 3.5 复测基线改用 `requirementRef.itemId` | 两处各一行 + 改名 |
| 3.6 `resolutionRecordFound` 复用 `landing` 数组 | 两行 |
| 2.1 三个常量归位 | 各一处 export + 各一处 import |
| 2.2 三处穷尽性显式化 | 各一到三行 |
| F6 三处删掉丢弃返回值的调用 | 三行 |
| 4.3 角色唯一性 | 一行 |
| 4.6 `lastAttempt` 小工具 | 六行 |
| 4.5 索引刷新移出失败路径 | 两处各三行 |
| H1 H2 H3 注释改正、两个 prompt 上限并成一个 | 文本 |
| 7 给 `pod-worktree-disposal` 加建议命令 | 文本 |

### 8.2 中等改动、需要判断

| 条目 | 说明 |
| --- | --- |
| 3.3 锁内重检工作声明 | 需要确认 `claim-changed` 的可重试语义 |
| 3.8 每段检查 + 树遍历排除 | 需要决定命中时是跳过还是整体拒绝 |
| 3.9 隐私扫描切分 + `scanPrivacy` 返回上界 | 上界取值需要定 |
| 4.1 E1 E2 补解析器 | 各约 60 行，形状照抄现有记录模块 |
| 4.2 引用规范顺序 | 需要把 `referenceLocationKey` 提到共用层 |
| 2.3 C1 C2 C3 传递已加载对象 | 改签名，调用点跟着改 |
| D1 至少拆出 `state-drift` | 三处转移各加一条前置 |
| D2 两个路由错误类补 `path` | 14 处各给一个路径 |
| G1 G2 G3 G5 补测试 | 四份，其中 G1 最值（约 150 行，守的是全系统最基本的排他约束） |

### 8.3 需要先量测或先决策

| 条目 | 建议的第一步 |
| --- | --- |
| 2.3 C4（评审决定两次全量审计） | 先做 G6 的规模基准，再决定是并进内存还是接受现状 |
| G6 + `targetTasks` `maxItems: 10000` | 把上界收到有业务依据的数字（如 256），同时在仓储的"两条路径同 stateDigest"测试旁加一个规模基准 |
| 3.7 `retireDemandRoot` 改成"重命名再删" | 涉及唯一的销毁路径，建议单独一个提交并补对应测试 |
| 4.1 E3（身份/权威升版机制） | 不建议现在建机制。建议记进 ADR-0008 或 ADR-0013 的未决项，与 hook 观察记录的"保留与清理策略"一起 |
| hook 观察记录的保留策略与 `recordedAt` 来源 | ADR-0009 未决项已有"保留与清理策略"一条；建议把"`recordedAt` 由谁提供决定了重试幂等的边界"并入。两个宿主的 hook payload 都不带事件时刻，脚本若用本地时钟，崩溃重试会造出第二条记录 |
| `endpoint/service.ts` 1387 行拆分 | 结果投影约 250 行是纯函数，旁边已有 `projection.ts`。不急，但 L2 之前做比之后便宜 |

## 9. 走读中确认无误的设计（备查）

以下几点在走读中被反复验证成立，记在这里以免后续误改：

- **摘要作为跨层一致性锚**：`planDigest` / `bindingDigest` / `claimDigest` / `stateDigest` / `snapshotDigest` / `reviewUnitDigest` / `routeDigest` / `previousCommitDigest` / `resultingStateDigest` / `payloadTreeDigest` / `promptDigest`。评审决定被其中三个同时钉住（快照、评审单元、聚合状态），是全系统最重的乐观并发保护，与"人做判断耗时最长"匹配
- **把"当下"物化成值再往下传**：一次调用只读一次时钟，同一个值喂给身份、权威、事件、提交。所有 recover 因此是"重算"而非"续做"
- **Agent 说的必须由别的东西印证**：句柄由 `session-start` cwd 印证、投递落地由 `user-prompt-submit` 的 prompt 摘要印证、完成由 `stop` 记录印证、worktree 由三个 git 指针文件互相印证、证据由实际字节摘要印证
- **preview 必须预见 apply 的全部失败**：`candidateRecord` 造一份 ledger 记录再丢掉、`buildIdentityAndAuthority` 用 `DRAFT_INSTANT` 预演、evidence 的阻塞 preview 连时钟都不读
- **两个读模型互相交叉检查**：`demand-controller-route` 与 `demand-post-acceptance-route` 各自从同一份权威推导，每个分支上断言两者一致。这正是本文 2.1 那类"重复但无交叉检查"的正面对照
- **凭证永远阻塞**：`controller-confirmed` 能放行的只有路径、标识与 opaque 字节，凭证类命中没有任何确认可以覆盖，且放行的非凭证命中会被记进 Manifest
- **事件不带位置**：位置由提交流在追加时赋予；载荷里的流位置是业务锚（围栏令牌、评审时看的那一版），不是事件信封的位置

## 10. 处理记录

本文是评估建议，不是裁决；下面只记录哪些条目已经落地、落在哪里，权威记录在 `docs/progress/consolidation-gate-log.md`。

| 日期 | 范围 | 结论 |
| --- | --- | --- |
| 2026-09-17 | §8.1 全档（gate-log 13.93） | 十三项里十二项作为独立一批落地：3.1 + 3.2（`releaseWorkClaimIfHeld`，delivery 首次与重放路径共用，result-review 删 `claim-foreign` 硬失败）、3.4、3.10、3.5、3.6、2.1（A1 A2 A3）、2.2（B1 B2 B3）、F6、4.3、4.6、4.5、H1 H2 与 F1 / H3。第 13 项（§7 `pod-worktree-disposal` 建议命令）留给切片 10 设计：`NextProjection` 没有自由文本槽，加字段要改 Schema。每项附带回归：新增 `tests/kernel/work-claims.test.ts`，其余五份测试各加一个用例或断言 |
| 2026-09-17 | §8.2、§8.3 | 未动，待裁决 |
