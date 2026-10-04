# rc.4 → rc.5 并发准入、维护预留与候选恢复复核

本分支重新完整语义审阅 1 个变更文件：`src/foundation/filesystem/rooted-read-write-scope.ts`。字节与逐分支记录见 [concurrency-files.json](./concurrency-files.json)。其他读取是交叉验证，不重复计入新增文件覆盖，也未修改生产实现、测试或制品。

## 实际变更与已核验行为

rc.4 在 `retireInactive` 的 inspect/retire 两步外增加针对 `RootedExclusiveFileLockError/residue-changed` 的捕获。返回 true 的含义是“本轮按仍占用处理”；writer 保留自己的许可并继续下一轮观察。旧版直接抛错会让正常 reader 释放与读取交错成为失败。

正式新增用例在真实 reader 的稳定检查中注入释放时机，分别验证正常释放最终让 writer 进入，以及释放后同名 unknown registry 替换保持原字节、拒绝 writer。它并不证明任何不稳定来源都可以忽略：目录枚举只有 source-changed/expectation-changed 内部重试，unknown、权限或名称不安全仍关闭准入。

## 额外深读范围

| 文件 | 本轮读取范围与核验目的 |
| --- | --- |
| `src/foundation/filesystem/rooted-exclusive-file-lock.ts` | 全文；v2 记录、进程/registry/token 判定、签发观察、严格退休、获取截止、精确释放及 release Promise。 |
| `src/foundation/node/process-instance.ts` | 全文；ESRCH、OS 出生证据、同进程缓存和正面摘要差异，不能按 TTL 判死。 |
| `src/foundation/filesystem/stable-directory-read.ts` | 全文；两次名字枚举/节点检查、目录/根复验、重试错误边界与分页并非持久快照。 |
| `src/foundation/filesystem/exact-regular-file-unlink.ts` | 全文；unlink 后失去持久化证明不能等同未删除，replacement-allowed 只承认不同节点身份。 |
| `src/foundation/filesystem/rooted-resource-parent-handle.ts` | 父句柄合同、resourceAbsolutePath、sync 边界；为一次性故障注入选择真实接口，没有声称该文件本轮逐行重审。 |
| `src/foundation/filesystem/durable-atomic-file-stage-address.ts` | 名称解析、issue/release、owner 判定；确认 stage 没有锁 v2 的 birth/registry 机制。 |
| `src/kernel/workspace-operation-scope.ts` | 全文；当前协议、维护预留、guard、嵌套借用、跨根/升格/过期拒绝、错误映射。 |
| `src/kernel/command-shell.ts` | 全文；read/maintenance 分流，普通 writer 先取得许可，再 open/body/result/close。 |
| `src/kernel/publication-transaction.ts` | 全文；preview 不取作用域，apply 服务端重算计划，recover 直接交给领域 owner。 |
| `src/workspace/maintenance/wakeflow-maintenance-gate.ts` | 全文；关联 gate、context、内部 exclusive 准入、正常与 existing gate、bootstrap 前后复验。 |
| `src/governance/demand/demand-runtime-recovery.ts` | 全文；配置/身份/节点/候选摘要、进入独占后的重读、逐 Demand 发布锁、已恢复跳过、漂移拒绝。 |
| `src/capabilities/workspace/maintain-workspace.ts` | 公共执行器 apply/recover 分派段；区分 private-mode CAS、候选恢复 exclusive、静态维护 facade，不声称本轮重新全文审阅。 |
| `src/governance/demand/publication/demand-event-sourcing-publication-service.ts` | `prepareLockRecovery` 和 `recoverDemandPublication`；业务意图绑定后才授权锁退休，恢复前后重读，不以物理租约代替业务事实。 |

## CF-01：发现、前态证据与当前修复

旧实现只通过 `lease = await latched(...)` 接收业务许可；`latched` 要先在 finally 完成 latch.release。若其 body 已创建 writer，但 latch 的结算抛错，外层赋值没有发生，`lease` 仍为 null，最终释放被跳过。已创建许可的活动 token 也没有退役。

一次性[复现脚本](./concurrency-release-probe.mjs)通过真实父目录句柄接口，只注入一次“latch unlink 已成功后的 parent.sync 失败”。[观察结果](./concurrency-release-probe-before-fix.json)为：回调未进入、错误为 release-failure、仅剩 writer.lock、ownerState 为 active、同进程下一 shared 获取超时。目录在 finally 清理，进程退出；没有打开任何真实工作区。探针使用当前 `.build`，源文件和编译输出摘要随记录保存；它不是正式回归套件或真实宿主验证。

发现经主代理独立复现并交开发线程后，当前实现增加 `const acquired = await acquire…; lease = acquired; return acquired`，立即登记许可所有权，不再依赖 latch finally 成功返回。这项变更已重新全文复核，当前源码摘要、行数与分支记录更新于 `concurrency-files.json`；修复前 JSON 保持原字节。

新增正式回归包含：shared 首次、exclusive 首次和排空时第二次 latch 结算失败，均断言业务不进入、目录为空，同进程 shared/exclusive 可再次进入；另对两种模式注入未知同名替换记录，断言原字节不被 cleanup 删除，后续 exclusive 要求恢复。这里描述的是已核对的测试断言；根套件运行结果仍由主代理统一记录。

本分支另运行了独立[修复后探针](./concurrency-release-post-fix-probe.mjs)，5 个场景全部达到预期，[后态结果](./concurrency-release-probe-after-fix.json)单独存储，没有覆盖前态。它还区分了错误优先级：cleanup 成功时原 latch 错误 `$lock/durability-failure` 透传；未知替换导致 cleanup 失败时，外层 finally 的 `$lock/source-changed` 覆盖先前错误，两者均为 release-failure。当前没有首错与后错的复合错误保留；未知替换字节及 recovery-required 是保留下来的可检查事实。该行为不能被描述为“双失败仍保留原 latch 错误”。

## 图谱修正

- 新增 `02-foundation/admission-races-and-recovery.md` 两图，分别解释定向重观测与取得即登记/失败结算；CF-01 当前已修复，前态留在证据记录，不泛称 finally 可保证所有文件清空。
- 扩充 `02-foundation/read-write-admission.md` 排空→重试与未知替换者停止分支，区别已持 writer 的排空循环和首次登记循环。
- 细化 `03-configuration-workspace/operation-scope-and-config-baseline.md`：关联维护门覆盖等待与执行，只有准入 latch 很短；只读工具不参与 shared/exclusive 互斥，gate 和内部作用域的获取预算分别存在。
- 补充 `11-kernel/workspace-operation-scope.md` 的内部可重试错误与最终失败边界；beforeEnter 仍在登记许可之前。
- 重画 `04-governance-event-sourcing/state-and-recovery.md` 候选恢复图，显式区分公共独占、进入后计划重算、锁内漂移、已恢复跳过和实际回执；reconcile apply 与静态维护 recover 不是同一路径。

## 测试证据范围

全文阅读 `tests/foundation/filesystem/rooted-read-write-scope.test.ts`、`tests/kernel/workspace-operation-scope.test.ts`、`tests/foundation/node/process-instance.test.ts`、`tests/capabilities/workspace/demand-runtime-recovery.test.ts`；另核对独占锁 suite 的 active/unknown/inactive、超时保留、精确退休与操作异常用例，以及公共 operation-scope 的配置写后取消/恢复用例。

现有正式测试没有独立覆盖：latch/writer 上的 residue-changed、inactive 退休中的节点替换、排空取消/超时、operation 超出获取预算、beforeEnter 不返回、候选恢复锁内漂移与另一个恢复者提前完成。CF-01 的交接及未知替换者保护已经新增正式回归；双失败的具体错误 path 优先级由独立后态探针验证。证据表已逐边区分直接、间接、未覆盖，路径和符号存在不算测试断言证明。

本分支运行了 CF-01 修复前一次性探针、修复后 5 场景探针与图谱局部结构/来源检查；根测试、编译、制品、smoke 和浏览器渲染由主代理统一执行。最终状态见本轮总验证记录，不复用 rc.3 通过结果冒充 rc.4。
