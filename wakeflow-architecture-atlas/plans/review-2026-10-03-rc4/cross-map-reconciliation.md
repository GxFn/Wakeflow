# rc.3 已核验图谱到 rc.5 源码候选的跨页收敛

起始检查得到 19 个来源指纹漂移页；另按主代理要求复核总体调用页的私有值边界，共 20 页。最终版本输入为 **1.1.0-rc.5 源码候选**。本任务只编辑既有 maps 页面与本记录，没有运行根编译、测试、制品或安装动作。

## 如何继承，何时重读

逐页用 `fingerprintInputs` 展开来源，再与 `plans/review-2026-10-03/source-baseline.json` 的 rc.3 文件摘要比较。相同 SHA 才继承此前语义审阅；SHA 不同则读取当前变更函数、消费者与相应测试；不在旧清单中的输入单独复核其当前用途，不能称作“相同”或据此断言“本轮修改”。完整路径、前后 SHA、图源码摘要和逐页理由在 [cross-map-reconciliation.json](./cross-map-reconciliation.json)。

根 Git diff 混有此前未提交实现，部分文件尚未被 Git 跟踪；旧 inventory 仅存摘要，没有旧字节。因此本记录将全文现态复核、已核验前轮记录和确切字节继承分开，不将当前全文读取虚称为所有文件的精确前后文本 diff。

## 逐页结论

计数为该页**初始展开输入**的三类数量；新增用于精确说明边界的源码/测试另存 `currentInputs`。相同文件会被多个页面引用，数量不可相加为文件审阅覆盖数。

| 页面 | 相同 SHA / 变化 / 未入旧清单 | 本次实际复核与结论 |
| --- | --- | --- |
| [17-artifacts-and-contracts/README.md](../../maps/17-artifacts-and-contracts/README.md) | 27 / 3 / 7 | 读制品闭包/输入输出/发布界限，构建器与profile等27项按旧SHA继承；两份技能全文已读；未列入旧inventory的元数据/品牌/lock/配置按限定当前语义重新核验。 版本改rc.5源码候选；说明本轮闭包代码和技能进入候选而非安装已加载，原13条组装边保持。 |
| [17-artifacts-and-contracts/file-dependencies.md](../../maps/17-artifacts-and-contracts/file-dependencies.md) | 38 / 3 / 7 | 读7条静态import、动态装载与独立工具表；38项旧输入SHA相同，两个技能和未入旧inventory的构建输入重新核验。 移除inspect-local-installation属于本轮新增的旧措辞，明确10工具按相同SHA继承；静态import结构未变。 |
| [17-artifacts-and-contracts/installation-and-runtime-identity.md](../../maps/17-artifacts-and-contracts/installation-and-runtime-identity.md) | 8 / 1 / 0 | 读安装预检/变更分派两图；唯一发生字节变化的已列输入为版本，8项源和测试按旧SHA继承。 改rc.5源码候选并明确不证明安装目录或运行会话使用它；15条行为边不变。 |
| [17-artifacts-and-contracts/schema-and-validation.md](../../maps/17-artifacts-and-contracts/schema-and-validation.md) | 207 / 1 / 3 | 读Schema生成时序、10层验证表和安装/发布限制；207项Schema/generated/源码等与rc.3相同；架构规则全文、lock和排程JSON当前限定读取。 候选版本改rc.5，内部协议仍2，95Schema与生成链未变；执行通过数字不在本页推定。 |
| [16-observation/projection-recovery.md](../../maps/16-observation/projection-recovery.md) | 5 / 1 / 0 | 读刷新/安全退休2图全部分支；5个旧输入SHA相同，operation-scope测试全文阅读并核在途Ledger暂停、writer等待、新Config摘要断言。 fixture准备调整不影响投影发布/退休事实；原13条边和正文保持。 |
| [11-kernel/README.md](../../maps/11-kernel/README.md) | 16 / 2 / 0 | 读公共外壳与所有权，全文复读privacy-scan、command-shell、redaction和读写准入；变化的operation-scope测试全文阅读。 shell节点明确已知私有值，E-KERN-06改为关闭/结算顺序；正文区分内容扫描与私有值，以及shell关闭首错和租约释放错误覆盖。 |
| [11-kernel/file-dependencies.md](../../maps/11-kernel/file-dependencies.md) | 15 / 1 / 0 | 读16条精选import与节点表；rooted-read-write-scope全文重读，其调用方workspace-operation-scope的SHA相同。 lease交接修复没有新增本地import，原图和依赖方向保持；运行分支由race下钻解释。 |
| [10-end-to-end-business-flow/README.md](../../maps/10-end-to-end-business-flow/README.md) | 20 / 3 / 0 | 读13边成功主线与所有下钻；阅读requirement.planPublish当前privacyHit分支、derivePublishAssessment及新增五类饱和诊断回归；其余SHA继承。 删除仍说DD三问题阻断的旧结论，改为当前修复及保留门；纠正E-BIZ01-11生产者为import和对应测试；补需求披露/callback下钻。Mermaid主体不变。 |
| [10-end-to-end-business-flow/state-and-recovery.md](../../maps/10-end-to-end-business-flow/state-and-recovery.md) | 34 / 1 / 0 | 读终态续接图与恢复矩阵；新增唯一源码变化为已全文复读的result-review.decide回调commit格式，业务转换分支未变。 保留状态图；补callback严格静默、仅未评审目标重发及只读inspect边界，去除过期本轮新增措辞。 |
| [09-public-mcp-host-seams/README.md](../../maps/09-public-mcp-host-seams/README.md) | 33 / 2 / 0 | 读公共装配与全部限制，入口/profile/工具均与rc.3相同；两份Controller技能全文已复读。 将旧本轮新增表述改为当前实现；补callback untrusted/user-role/inspect只读澄清并链接新页，装配边不变。 |
| [09-public-mcp-host-seams/file-dependencies.md](../../maps/09-public-mcp-host-seams/file-dependencies.md) | 20 / 2 / 0 | 读13条直接import及文件/consumer表；代码SHA继承，重读Controller文本实际语义变更。 技能的callback信任说明不改变import结构，保留原图。 |
| [09-public-mcp-host-seams/project-chats-and-execution-roots.md](../../maps/09-public-mcp-host-seams/project-chats-and-execution-roots.md) | 17 / 1 / 1 | 读两图、项目/启动/执行根全表；17项旧输入SHA一致；Controller文本全文重读；ADR-0019因无旧inventory摘要全文现态复核。 现有项目/local、ready句柄、SessionStart、worktree身份事实仍成立；ADR中的rc.3是历史决定说明，不改写为当前安装事实。保留图文。 |
| [09-public-mcp-host-seams/runtime-call-flow.md](../../maps/09-public-mcp-host-seams/runtime-call-flow.md) | 16 / 2 / 0 | 读MCP时序和边界，重读successfulToolResult/redactedErrorEnvelope及redaction全文；两个技能变更不修改协议。 E-MCP-07标签明确已知私有值检查，正文说明入口只含home、领域另扩展；没有通用凭证自动扫描。 |
| [04-governance-event-sourcing/runtime-call-flow.md](../../maps/04-governance-event-sourcing/runtime-call-flow.md) | 25 / 1 / 0 | 读追加/发布/写scope两图及表；复读command-shell与workspace作用域结算代码，rooted-read-write-scope全文及新故障测试。 收窄E-DEM05-07的首错表述：shell上下文关闭与租约finally不同，后者失败可覆盖；补race链接。状态/调用图结构不变。 |
| [03-configuration-workspace/README.md](../../maps/03-configuration-workspace/README.md) | 33 / 1 / 0 | 读配置/维护/资源所有权全部页面；33个源/合同等输入与rc.3相同，变化的operation-scope测试全文复读。 保留图文：测试现将3个耐久fixture在before hook内独立准备，配置在途投影、v1拒绝和中断恢复的实际断言仍支持原边；不是新增维护行为。 |
| [03-configuration-workspace/file-dependencies.md](../../maps/03-configuration-workspace/file-dependencies.md) | 22 / 1 / 0 | 读精选直接依赖13边及全部节点表；被引用生产文件按相同SHA继承；全文复读变化的operation-scope测试。 静态import完全未变；测试初始化分配变化不增加或移除依赖边。仅在核验后更新指纹。 |
| [03-configuration-workspace/runtime-call-flow.md](../../maps/03-configuration-workspace/runtime-call-flow.md) | 41 / 1 / 0 | 逐图读维护优先级、静态事务恢复、配置CAS与资源分支；41项已有输入相同；operation-scope测试全文件现态核对。 保留35条图边：current格式、maintenance门、exclusive等待和配置末位发布均未因fixture准备变化而改变。 |
| [02-foundation/README.md](../../maps/02-foundation/README.md) | 18 / 2 / 0 | 读总览全部保证；全文复读189行rooted-read-write-scope及223行聚焦测试；与并发agent前后探针互证。 去除过期的本轮新增文件叙述，说明取得即登记lease、residue-changed重观测、未知替换保护与cleanup错误可覆盖，链接race页。原物理能力图不变。 |
| [01-overall-architecture/README.md](../../maps/01-overall-architecture/README.md) | 36 / 2 / 2 | 读总体所有分层/工具/职责陈述，重读版本输入与读写准入全文件，架构规则全文核对；其他源码/测试按rc.3相同SHA继承。 版本收敛到rc.5源码候选并明确不证明安装；补许可交接、内容隐私、callback三类下钻。总体10条结构边未改变。 |
| [01-overall-architecture/runtime-call-flow.md](../../maps/01-overall-architecture/runtime-call-flow.md) | 16 / 0 / 2 | 额外审阅的非stale页；全文复读command-shell、redaction、privacy-scan，读取MCP结果边界函数与redaction全部测试。 shell节点从脱敏收窄为私有值；正文区分请求初始值集合、上下文后扩展、结果拒绝与内容扫描；不声称自动凭证输出扫描。 |

## 实质纠正

- 总体与制品页统一到 rc.5 源码候选；源码版本、生成制品、安装目录和运行会话仍分别验证，未宣称安装生效。
- Foundation 总览补上 lease 取得即登记、短 latch 结算失败仍清理、未知同名替换者保留的规则；链接两张竞态/交接细图。
- 总体调用、公共 MCP 与内核总览明确：已知私有值检查是 JSON 键/值中的字符串匹配，内容扫描由真实消费者显式调用，不能声称所有公共输出自动运行凭证正则。
- 业务总览删除三项 DD 问题“仍有阻断”的旧结论，保留取消与缺陷授权当前守卫；测试回传边的代码证据纠正为 import producer。
- 进一步收窄错误优先级：command shell 自己关闭上下文/根时保留已有主体错误，但读写租约 finally 的清理失败可能覆盖先前失败。04 与 11 页不再把局部首错规则推广到所有结算。

## 无旧摘要的输入

11 个输入不在 rc.3 inventory 中：两个 marketplace、LICENSE、两个品牌 SVG、package-lock、entrypoint tsconfig、架构规则、测试耗时表、ADR-0019、10 月 2 日历史 inventory。它们分别读取当前数据/规则与实际消费点，范围逐项记录在 JSON 的 `newlyReadUnlistedInputs`。package-lock 仅核对锁格式和根依赖结构，不声称审完第三方实现；耗时表仅为排程提示，不宣称重新测量；ADR 和旧 inventory 保留历史属性。

## Mermaid 派生面影响

本次没有新增图或关系边；只有以下 3 张图的文字内容变更，结构与稳定边 ID 不变。FigJam/浏览器应按新的原始 Mermaid 摘要同步，其余页面的图源码原样保留。

| 源图 | 修订前 SHA-256 | 修订后 SHA-256 |
| --- | --- | --- |
| [11-kernel/README.md #1](../../maps/11-kernel/README.md) | 65db5626004bc81b398718c767c78957a7d9b6b5b7c36f81130114885919039e | 8561c6c3b16e38438bd8953abed9e858d12c751c79094626f8dcf4500a86eb58 |
| [09-public-mcp-host-seams/runtime-call-flow.md #1](../../maps/09-public-mcp-host-seams/runtime-call-flow.md) | e9f5d2f78938b4b0b6f34b662d25e7774f64d90298985e1876c35d3d856e0682 | 4d5e36dbb53566e629a2efc3bda9e3cf8565fbb68b8deebbd78ae1f1f5b6f5e6 |
| [01-overall-architecture/runtime-call-flow.md #1](../../maps/01-overall-architecture/runtime-call-flow.md) | 61930d4b551ae3ce75f70873bc0bac3763ee50e7d50a23e7c35ade7197cd2aa3 | 9ea843e8f187d3a63dfa7bb55d57fcc0a09abdd2b31a4a5159287dec678a89ca |

## 验证边界

定向结构检查已经通过：20 页的来源、源码/测试符号、静态导入、相邻边证据和本地链接均无错误。没有把继承的测试锚点或源码静态通过解释成新的根测试通过；全图浏览器渲染、Figma 与根验证由主代理统一执行。

本轮全局 `check-atlas --require-current` 已通过：76 份 maps、100 张 Mermaid，剩余来源漂移 **0**、结构错误 **0**；原始结果见 [cross-map-structure-check.json](./cross-map-structure-check.json)。本轮修改的 20 页来源和图摘要复核仍一致，`git diff --check -- wakeflow-architecture-atlas` 通过。浏览器渲染不属于这个结构检查。
