# ADR-0017 工作区操作作用域与运行证据主体

> 状态：`accepted`
> 日期：2026-10-02
> 后续裁决：旧工作区兼容/迁移部分由 [ADR-0018](./0018-current-workspace-baseline.md) 取代；并发和证据边界继续有效。决定 3 中"不可验证即门不通过"的后果于 2026-10-06 修订，见文末。
> 相关：ADR-0014、ADR-0016；[根因、反例和完整设计](../reviews/2026-10-02-authority-scope-and-runtime-evidence-design.md)

## 背景

现有绑定锁、projector 锁及文件预期检查不能保护在锁外捕获的配置；两个公开变更后的延迟刷新已复现旧投影覆盖。另一个生成进程反例证明，新 SessionStart 观察可以让仍运行旧 MCP 的目标被判为 current。缺口涉及事实有效期、提交作用域与证据主体，不能只靠重启或局部补锁解决。

## 决定

1. 普通运行时变更共享工作区准入，配置/共享布局维护独占准入并排空既有 writer；保留各 owner 的领域锁、事件权威、预期修订和幂等协议。只读观察不取得会写磁盘的许可。
2. 运行时投影在 publisher 边界内读取当前来源；维护过渡投影使用绑定现有 intent/journal 的目标配置。两个效果入口分别持有有效作用域，共用纯渲染函数。
3. 分别报告 MCP 服务实例、宿主选择的安装、hook 生产者、会话活动及所需协议。缺少主体关联就报告不可验证，不从 SessionStart/Stop 推断 MCP 或技能已重载。
4. 构建身份对应不可变产物，协议身份独立表达。按后续 ADR-0018 使用当前结构的新工作区，不实现旧工作区的兼容或迁移；未知格式拒绝，当前格式的中断仍走原有恢复。

## 取舍与前提

不采用全工作区长独占锁作为正常业务模型，不新增全局业务事件流或通用事务管理器。共享准入的 owner 实例、取消、崩溃恢复与锁序必须先通过真实进程验证；PID/超时不能被当作充分安全回收依据。混合版本、宿主可信身份和配置迁移的限制详见设计文档，不能用这个 ADR 宣称 Q5、Q11 或已有兼容缺口已经解决。

## 状态

用户于 2026-10-02 确认继续实施。该决定扩展 ADR-0014/0016 的一致性与证据边界；反例和模型结果见 gate-log §13.145。按设计顺序分段实施，每段明确已经落地与尚未落地的合同，并执行源码仓库的整门和双制品验收。

## 修订（2026-10-06）

§13.161 复审发现决定 3 的后果让严格验证永远不能通过：绑定窗口一律 `unverified`，runtime-artifact 门因此恒为 unavailable，Controller 拿到一个没有工具可用的 frontier，插件更新后同伴窗口的刷新也失去了依据。用户于 2026-10-06 裁决同意按下述方式收窄：

1. 主体分别报告的原则不变：hook 记录只标识观察器，SessionStart/Stop 仍不证明 MCP 或技能已重载，因此 `current` 从不被断言。
2. 新增一个只在一个方向上可靠的信号。宿主画像以 `surfaces.runtimeStaleness` 声明判定方式：Claude Code 为 `session-start-observer-digest`，绑定会话最近一条 session-start 记录的观察器摘要不等于本进程路径上已安装的制品清单，即该会话在更新前启动且此后没有重启过，报 `stale`；严格验证计 `windows-stale:<n>`，runtime-artifact 门失败，`next` 为 Controller 的 `window-artifact-stale`。Codex 声明 `unverified`。
3. `unverified` 不再使门 unavailable：它作为通过门上的信息码 `window-runtime-unverified:<n>` 报告，`verify.ok` 可以为 true；技能文本只对报 `stale` 的窗口执行宿主重启流程，对 `unverified` 的窗口不动。

反方向仍不成立：启动记录新不等于已重载。兄弟版本安装目标的识别仍按 open-items C6 开放。
