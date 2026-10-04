# ADR-0019 Codex 项目聊天与执行目录分离

> 状态：`accepted`
> 日期：2026-10-03
> 来源：用户明确要求在外层 Workspace 项目内新建角色聊天，不为子目录建立项目，不使用外部会话替代，并将创建逻辑写入程序。
> 相关：修订 ADR-0010 的 Codex 创建方式；其 pod、隔离检出与分支处置不变量保持。ADR-0018 的当前格式首基线保持。

## 原因

此前启动说明把逻辑窗口的角色根直接作为会话 cwd，并建议产品窗口使用 Codex 项目的 worktree 环境。实际宿主创建工具以已保存项目为入口，没有任意 cwd 参数。目录相同也不证明聊天已归入桌面项目；项目的 worktree 环境操作主仓库，不能替代外层工作区里的各个产品仓库。

## 决定

1. Codex 的启动模板为 `project-thread`。所有角色在同一外层 Workspace 项目内通过 `create_thread` 的 project/local target 创建；项目按规范路径和当前 host 精确解析。项目缺失或含混时解决外层项目，不添加角色子项目，也不退回 projectless 或 CLI 会话。
2. 区分宿主项目归属、SessionStart 根和执行目录。Codex 的 SessionStart 必须来自工作区根；逻辑角色仍由配置中的 windowId 与私有唯一绑定决定。角色目录及产品检出通过启动说明、任务包、显式 workdir 和当地指令约束执行范围。项目归属不提供额外写权限。
3. 创建结果先留存，待 ready threadId 才可登记；clientThreadId 不是会话句柄。由宿主回读 projectId；宿主列表暂不可见时接受直接 UI 确认并披露限制，不能从 cwd、标题或 hook 推断侧栏归属。结果含混时先查明原聊天，不重复创建。
4. 工作树由 Agent 在配置的产品仓库里使用 `git worktree add` 从本地 HEAD 创建；角色聊天仍使用外层项目 local 环境。登记观察显式提交私有 `worktree.executionRoot`，内核核对 porcelain、common dir、双向 .git 指针、分支与 pod 独占归属。不得把外层仓库的工作树冒充产品检出。归档聊天不等于删除 Git 检出。
5. Claude 的会话仍在配置角色根或工作树根启动，执行根由真实 SessionStart 提供；不接受额外执行根覆盖。共享代码按宿主提供的启动模板分支，不按 hostId 猜测行为。
6. Wakeflow 只生成意图、校验观察、登记绑定；Agent 负责宿主创建与项目回读。用户请求的角色聊天保留可见，只有明确退役授权才归档。已有创建与消息授权不重复询问。

## 验证边界

自动回归覆盖工作区根准入、子目录会话拒绝、独立工作树根及 Git 身份核验，并保留原有 Claude 流程。真实验证分别记录创建调用、聊天执行输出、宿主 hook、绑定回执与 UI 确认；任何一项不能代替另一项。版本使用小版本候选 `1.1.0-rc.3`，不原地覆盖已安装候选。

宿主的项目与目录行为参考 [Projects and chats](https://learn.chatgpt.com/docs/projects)，具体创建参数以当前工具 Schema 为准。
