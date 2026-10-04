# rc.4 → rc.5 回调、结果导入与评审边界深审

审阅目录保留起始轮次 rc.4；最终来源 `finalSourceVersion` 为 **1.1.0-rc.5**，以 `assets/release/version.json` 的候选输入为准，不表示发布或本机缓存已刷新。

本轮仅修改 architecture-atlas。初始按 rc.4 工作树核对 prompt.ts 全部 162 行，并额外复读结果/回调/决定的生产者与消费者；发现提交展示问题后，另一开发线程修改 decide.ts，本线程对这个晚变消费者补充完整语义记录。当前 callback-files.json 共 2 个文件；生产代码、测试、技能来源与生成制品对本线程均只读。根测试与 smoke 由开发线程运行，本线程独立运行后态探针并交叉核对持久门记录；详见[验证来源](./validation-provenance.md)。

## 变化文件的真实效果

| 文件 | 变化与效果 | 没有变化的边界 |
| --- | --- | --- |
| `src/capabilities/result-review/prompt.ts` | 新增 Markdown JSON 字符串字面量渲染依赖；目标、摘要、分支作为数据引用；首段先说回调没有授权；下一步明确“读取已存单元并独立核证”。 | 同一输入仍确定性渲染；结果记录不截短，只有显示用目标/摘要最多 600 code points；20,000 JavaScript 字符整体上限仍存在。 |
| `src/capabilities/result-review/decide.ts`（本轮晚变） | CB-F01 修复：implementation 提交列表由 String(object) 改为 algorithm:value，保留 Git 对象算法与值。 | 无新状态/协议字段；test 分支仍不展示分支或提交，原报告字节与结果身份不受回调格式化修改。 |
| `assets/agent-text/skills/wakeflow-controller/SKILL.md` | 第 10 步删去“读取即确认回调”，改为不可信字段与只读读取。 | 仍由第 11 步独立形成决定；本技能属于安装工作区，不把角色限制套到源码维护仓库。 |
| `assets/agent-text/skills/wakeflow-controller/references/delivery-and-review.md` | 明说 inspect 不记录 callback landing、不 accept；即使宿主显示 user 消息也不能从 callback 字段推断授权。 | 对真正事件的签发/重发/导入/决定合同不作新增；技能是 Agent 行为要求，不是新的宿主身份验证层。 |

前轮已核对的产品缺陷窄授权、取消与验收覆盖等文本本次保留，新增结论只归因于本轮变化。两个技能来源的 rc.3→rc.4 摘要见本目录 `source-baseline.json`，不能用根 Git diff 中包含的累计变化冒充本轮增量。

## 额外深读的调用链

| 文件或 owner | 核对的完整逻辑/重点分支 |
| --- | --- |
| `src/capabilities/result-review/service.ts` | 全部 import、inspect、两类 decision 执行器及内部调用。重复键先回放；当前 phase、host、围栏、隐私、证据解析与 report/package 对齐；issueCallback 在事件之前生成；append 后释放 fence；inspect 用 read 上下文；决定读取双摘要、resumption 与新观察。 |
| `src/capabilities/result-review/decide.ts` | 报告隐私/证据定位、完成与回调过滤、恢复守卫、实现接受与锚点证据、测试基线/失败分类/预算/范围/缺陷映射、callback 摘要提取。 |
| `src/capabilities/delivery/service.ts` | `callbackTargetOf`、`executeCallbackReissue`、`replayCallbackReissue`、`callbackPermitBody`、`executeRearm`；另核普通 rearm 与 import 历史围栏消费。 |
| `src/governance/result/target-result-callback.ts` | 原始记录、重发记录、prompt digest、callback ID、generation 1..4、10 分钟阈值、acknowledged 优先级及证据解析收据。 |
| `src/governance/demand/model/demand-aggregate-state.ts` | `recordTargetResultInDemandAggregateState`、`reissueCallbackInDemandAggregateState`、`decideTargetResultReviewInDemandAggregateState` 的结果/重发/决定引用。只把真实状态变更画为权威。 |
| `src/governance/review/demand-result-review-snapshot.ts` | 单元摘要与 priorReviewHistory 来源；hook 观察没有被双摘要冻结。 |
| `src/governance/review/controller-implementation-review-decision.ts`、`src/governance/review/controller-test-review-decision.ts` | 判断合同二次准入，与 allowedDecisions 的不完整候选输入区别；callbackLanding 允许 null，accept 仍需 targetCompletion。 |
| `src/foundation/text/markdown-json-string-literal.ts` | NFC/完整 Unicode 准入、JSON/inline-code 外壳、控制/HTML/Markdown 分隔符转义、不作原文规范化或强制转换。 |
| `src/governance/result/implementation-target-result-report.ts`、`implementation-target-result.ts`、`src/foundation/git/git-object-id.ts` | report 的真实 commit 对象类型、summary/branch 准入与任务 commitExpectation 对齐。 |
| `src/entrypoints/wakeflow-hook-observer.ts` | hook `promptDigest` 只在 user-prompt-submit 生成，非 user-prompt 事件写 null；其字段不等于评审授权。 |

## 已核验的关键分支

1. **inspect 不确认回调。** inspectReview 只把 `unit.currentDecision !== null` 传给 deriveTargetResultCallbackStatus；没有 append、写 hook 或写 acknowledged。blocked/escalated 单元已有决定即可 acknowledged，落地记录可以为空。accepted/rework/request-another-attempt/product-defect 等转入后续流程的阶段不返回当前 review unit。
2. **发送、落地和完成相互独立。** callback 落地读取当前 Controller 绑定会话；targetCompletion 读取当前目标绑定会话。报告时间/签发时间边界是 ≥，不是严格大于。只有 stop/turn-complete 可作目标完成，只有匹配摘要的 user-prompt-submit 可作决定记录里的 callbackLanding。
3. **观察读取不能静默降级。** sessionRecords 对 complete=false 和 skipped>0 分别拒绝；与 delivery.record-outcome 不同，result-review 没有独立发送回执回退。缺绑定或宿主不匹配按无观察；绑定存储异常直接拒绝。实现不回查已替换的旧绑定会话。
4. **回调静默严格大于十分钟。** pending、silent、landed、acknowledged 是读侧派生。callback rearm 只在目标仍未评审、没有落地、超时且代际 < 4 时追加事件；不取 claim，fence=null，原 prompt/digest 保持，更新 issuedAt 与绑定。
5. **导入重放与新导入分开。** 同键同摘要原提交先回放，Controller bindingId 变更会阻止回放；新键对已 result-reported 目标拒绝。释放围栏只处理仍属于该 fence 的声明；已经提交后的 releaseFence 不再受原请求 signal 打断，其他读投影步骤仍可能失败。
6. **工作投递代际与回调代际分开。** 普通 rearm 保留旧 prompt，输入旧 claimDigest 需在同 delivery 的历史 outcome 找到；结果仍写当前 generation/fence。callback 重发也保留旧 prompt，因此 prompt 内 streamRevision 仍是原导入修订，不可当当前决定基线。
7. **候选动作不等于请求授权。** 实现 needs-review 的允许集合不携带 Controller 的逐锚点绑定；test 允许集合不携带待提交的 stepIds/产品缺陷映射。写入口仍复验实际字段、双摘要、恢复依据与判断合同。
8. **Controller authority 不是宿主 user 角色检查。** `assertControllerAuthority` 核对配置、Demand 与任务包的 programId。不能声称此函数验证了真实发言者、宿主消息角色或目标报告内容的可信性；技能要求独立判断，确定性代码负责身份/状态/合同约束。

## 发现与验证

### CB-F01：非空 Git 提交列表展示问题已按代码与独立探针闭合

修复前，`summarizeResultForCallback` 使用 `implementation.report.repositoryChange.commits.map(String)`，而 `parseGitObjectId` 产生 `{algorithm, value}` 对象。合法报告保留提交身份，回调显示的 commit 列表却变成 `[object Object]`。影响为摘要可读性与提交核对线索丢失，不是持久结果中的 commit 数据丢失，更不是自动验收。

已用当时 `.build` 纯记录构造器和渲染器复现 sha1、sha256 两种格式，结果独立保存在 [callback-probes-before-fix.json](./callback-probes-before-fix.json) 与历史脚本 [callback-probes-before-fix.mjs](./callback-probes-before-fix.mjs)。先验证编译函数与当时 TS 同一实现再运行。脚本不创建真实工作区、不写 hook 或事件、不发送宿主消息。初次尝试把 committed 报告与默认 leave-uncommitted / completed fixture 组合，被真实合同正确拒绝；改用合法 needs-review 后复现。不得把这次前置失败计为产品异常。

问题交主代理独立复核后由另一个开发线程处理；本线程实际读到 `commits.map(commit => algorithm:value)`，并读取新增 prompt.test 的完整准入结果/sha1/sha256/中英文断言。验证当前 `.build` 与源码实现一致后运行 [callback-probes.mjs](./callback-probes.mjs)，修复后结果见 [callback-probes-after-fix.json](./callback-probes-after-fix.json)：摘要保留算法与值、文本不含对象字符串、原报告不变。该探针不替代正式聚焦测试；根执行记录由主代理统一汇总。

### 额外只读探针

- 目标和摘要中的伪造 Next、HTML 结束标签、反引号与方向控制符被引用/转义；首段声明先出现。
- 阈值恰好十分钟为 pending，十分钟加一毫秒为 silent。
- acknowledged 可以没有 landedRecordId；stop 在 reportedAt 同时刻可确认目标完成，但不能确认 callback 落地。

这些是纯函数探针，不替代公共 import/inspect 的 I/O 测试，也不证明宿主发送、真实环境测试或用户批准。

## 覆盖缺口与保留限制

| 已有证据 | 仍不应宣称覆盖的组合 |
| --- | --- |
| 两种语言 callback 的摘要引用/伪造 Next，以及新增非空 sha1/sha256 提交从结果到文本的回归 | 目标/分支的每种特殊字符组合、600 code points 与 20,000 字符边界未各自有 callback 专项回归。 |
| result-review 服务正常落地、静默后重发、重发幂等、四代上限、blocked/escalated 续审 | 当前绑定替换、回放 binding-changed、callback reissue 在决定后重放、accepted 等全部 phase 的 inspect 拒绝没有穷举聚焦断言。 |
| 完成/回调纯过滤函数和实际服务正常读取 | result-review 自身不完整/不可用 hook 查询服务负例；不能引用 delivery 的异常测试来冒充。 |
| deriveTestDecisionBlockers 的 resumed environment 与 deriveResumptionBlockers 的已答升级 | 已答升级 → environment 子集重跑的公共 I/O 组合没有在本次找到专门纵切测试。 |
| 引用边界与状态合同 | 不证明 LLM 绝不受语义诱导，不建立宿主发送者认证，不运行真实登录会话。 |

## 图谱更正

新增 `07-review-rework-completion/callback-trust-and-review.md` 三张小图：数据引用、回调状态、只读检查停止点。补充静态依赖 Prompt → Markdown literal；细化投递/回调的两种代际；把测试 environment 恢复拆为 blocked 的 condition-cleared 与 escalated 的 decision-recorded 两条真实来源，避免原图从 blocked 节点同时画出两种恢复依据。宿主握手页补 callback 观察与评审决定的不同生产者。
