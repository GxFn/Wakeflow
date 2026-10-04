# 1.1.0-rc.3 图谱更新交付记录

2026-10-03。源码仍以 `d8fafff33919c728e3a9b91ec04aa50ec5e07f0c` 为已提交基线，加当前未提交实现；版本输入为 `1.1.0-rc.3`。本线程只维护 `wakeflow-architecture-atlas/`，运行代码的修复由另一个开发线程负责。

## 本轮分析覆盖

对比10月2日已审阅字节，本轮有 **51个手写文件变化、7个新增**，均重新语义审阅；312个源文件只有在当前SHA、旧覆盖和旧原始记录一致时才继承既有结论。累计覆盖 **370个手写文件＝360运行时＋10工具**。

另外核对95份Schema、95份生成TS、297个测试/fixture/support的当前库存及关联。58份本轮记录包含职责、分支、副作用、真实消费者和测试定位；AST只验证静态关系和符号，不生成语义结论。继承源码关联到变化测试时，只重新证明定位有效，不自动继承旧断言结论。

[逐文件索引](../../maps/02-file-review-index.md) · [覆盖报告](./review-coverage.json) · [源基线](./source-baseline.json) · [静态导入数据](./import-graph.json)。覆盖汇总可用 `node wakeflow-architecture-atlas/plans/review-2026-10-03/refresh-review-coverage.mjs` 重跑；来源有变化必须先重新审阅，不能用汇总脚本绕过语义工作。

## 最新实现的主要变化

| 变化 | 已实现的边界 | 图谱入口 |
| --- | --- | --- |
| 工作区操作作用域 | 普通写者在领域上下文读取前进入shared/exclusive；read不取写许可，维护由owner选择进入点。维护残留即使进程结束仍阻挡新writer。 | [Kernel范围](../../maps/11-kernel/workspace-operation-scope.md) |
| 读写准入和owner实例 | 短latch串行登记，writer关闭新reader后排空在途reader。当前锁v2结合出生摘要、registry和活动token；unknown不按时间退休。 | [Foundation准入](../../maps/02-foundation/read-write-admission.md) |
| 维护与投影 | 静态维护gate＋exclusive、Demand候选恢复显式exclusive、权限收窄逐节点CAS。运行时投影在发布/绑定锁内重读配置，维护过渡使用intent目标。 | [配置与作用域](../../maps/03-configuration-workspace/operation-scope-and-config-baseline.md) |
| 项目聊天与执行根 | Codex角色共用外层Workspace项目，SessionStart在Workspace根；角色目录与产品Git检出独立准入。Claude保留会话根语义。 | [项目创建边界](../../maps/09-public-mcp-host-seams/project-chats-and-execution-roots.md)、[检出身份](../../maps/12-endpoint/execution-roots.md) |
| 运行证据分离 | status/verify v2分别表达本服务manifest、hook观察器摘要和窗口绑定；缺少可信目标MCP/指令关联时仍是unverified。 | [运行身份](../../maps/16-observation/runtime-evidence.md) |
| 安装与变更分派 | install:check只读拒绝同版本不同字节，不安装或预留。生成MCP在mutation分派前复验自身manifest，read/preview/inspect保留诊断。 | [安装与分派门](../../maps/17-artifacts-and-contracts/installation-and-runtime-identity.md) |
| 严格当前基线 | Config、锁、status/verify协议编号为2；不提供旧配置/锁格式迁移。正常同格式reconfigure/recover保留。 | [Schema与验证](../../maps/17-artifacts-and-contracts/schema-and-validation.md) |

程序仍只生成宿主动作意图与校验事实，Agent负责创建、发送和项目归属回读；Controller负责独立接受决定。项目标题、cwd、hook记录、发送回执、结果报告、业务验收各自不能替代另一项。

## 三个历史问题已闭环

- **DD-F01**：公共决定、授权生产者和仓储消费现在一致使用全部product-defect失败步骤；其他失败没有被伪装为pass。新增混合分类回归包含实际修复、retest、rerun和接受链。
- **DD-F02**：cancel豁免research成果门，complete仍要求成果；无document取消、撤回、归档与幂等恢复有回归。
- **DD-F03**：取消移除活动awaitingDecision，保留升级事件历史，不伪造用户回答；追加前与终态后中断恢复有回归。

[生产链与回归断言复核](./demand-delivery.md) · [当前修复与剩余限制](../../maps/10-end-to-end-business-flow/review-evidence.md)。10月2日原始失败输出保持原样，不能拿旧探针的预期失败继续描述新实现。

## 图谱与Figma更新

当前 **17个专题、71份maps文档、90张Mermaid图**，比原快照增加7页13图。分离静态import、运行调用、状态恢复和Agent规程；交叉复核纠正了许可登记前后的顺序、维护例外、执行根通过条件，以及测试未覆盖分支的表述。

[最新Figma合集](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=62-1739)选取12张关键视图，120个节点和116条连线已按显式标签映射对照，完整条件保留在图旁。12个面板均经过截图检查；狭窄连线使用短词或数字编号，分派判断采用中文别名，所有映射写入[派生清单](./figjam-derivation.json)。旧区已标为10月2日历史快照。

| 视图 | 派生阅读面 | 正典 |
| --- | --- | --- |
| 01 · 总体架构 | [FigJam](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=62-1743) · [截图](../evidence/2026-10-03-figjam-architecture.png) | [本地来源](../../maps/01-overall-architecture/README.md) |
| 02 · 工作区作用域 | [FigJam](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=62-1749) · [截图](../evidence/2026-10-03-figjam-operation-scope.png) | [本地来源](../../maps/11-kernel/workspace-operation-scope.md) |
| 03 · 共享与独占 | [FigJam](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=62-1755) · [截图](../evidence/2026-10-03-figjam-reader-writer.png) | [本地来源](../../maps/02-foundation/read-write-admission.md) |
| 04 · 项目聊天 | [FigJam](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=62-1761) · [截图](../evidence/2026-10-03-figjam-project-chats.png) | [本地来源](../../maps/09-public-mcp-host-seams/project-chats-and-execution-roots.md) |
| 05 · 产品执行根 | [FigJam](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=62-1767) · [截图](../evidence/2026-10-03-figjam-execution-roots.png) | [本地来源](../../maps/12-endpoint/execution-roots.md) |
| 06 · 投影来源 | [FigJam](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=62-1773) · [截图](../evidence/2026-10-03-figjam-projection.png) | [本地来源](../../maps/03-configuration-workspace/operation-scope-and-config-baseline.md) |
| 07 · 运行证据 | [FigJam](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=62-1779) · [截图](../evidence/2026-10-03-figjam-runtime-evidence.png) | [本地来源](../../maps/16-observation/runtime-evidence.md) |
| 08 · 测试与修复授权 | [FigJam](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=62-1785) · [截图](../evidence/2026-10-03-figjam-test-remediation.png) | [本地来源](../../maps/08-real-environment-testing/runtime-call-flow.md) |
| 09 · 取消与归档恢复 | [FigJam](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=62-1791) · [截图](../evidence/2026-10-03-figjam-cancellation.png) | [本地来源](../../maps/07-review-rework-completion/state-and-recovery.md) |
| 10 · 安装预检 | [FigJam](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=62-1797) · [截图](../evidence/2026-10-03-figjam-installation.png) | [本地来源](../../maps/17-artifacts-and-contracts/installation-and-runtime-identity.md) |
| 11 · 变更分派门 | [FigJam](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=62-1803) · [截图](../evidence/2026-10-03-figjam-mutation-guard.png) | [本地来源](../../maps/17-artifacts-and-contracts/installation-and-runtime-identity.md) |
| 12 · 业务接力 | [FigJam](https://www.figma.com/board/RWZG8LK8IK9DKOtV2mgKhc?node-id=62-1809) · [截图](../evidence/2026-10-03-figjam-business.png) | [本地来源](../../maps/10-end-to-end-business-flow/README.md) |

## 验证及证据等级

本轮实际执行：

- `WAKEFLOW_TEST_CONCURRENCY=4 npm test`：**1,217通过，0失败、0取消、0跳过**，测试阶段563652.264ms；类型、架构、Biome、knip、95份Schema漂移及双宿主制品一致性门均通过。既有5条lint warning、3条info保留，未自动改生产文件。
- `npm run smoke:artifacts`：Codex和Claude两个完整生成制品均通过20工具、fresh/reconcile、status/verify、Pod preview及hook真实子进程验证。
- 浏览器真实解析与渲染 **90/90**；[当前回执](../evidence/current-mermaid-render.json)与[10月2日历史回执](../evidence/2026-10-02-mermaid-render.json)分开保存。
- 图谱独立 `npm run check` 的最终结果、阅读器交互核验及 `git diff --check` 统一记入[验证回执](./validation-results.json)。

本线程没有新建或投递真实登录宿主会话，也没有刷新插件缓存。另一线程的现场验证仅作为背景，不能冒充本次运行回执。当前仍有目标runtime关联缺失、Claude缺失支撑根阻挡非fresh维护、有限Git合并观察等边界；图中保留其限制。

源码与图谱均存在未提交改动，main相对本地origin/main为ahead 0 / behind 0，未fetch。本轮未commit、push、tag或发布。原生产源码、测试、Schema、插件制品及10月2日审阅记录均未由本线程改写。

[总体职责](../../maps/01-overall-architecture/README.md) · [审阅与证据等级](../../maps/01-overall-architecture/review-evidence.md)。
