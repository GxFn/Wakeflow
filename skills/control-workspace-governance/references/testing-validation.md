# Testing And Validation Rules

Use this reference when deciding whether to test in total control, create an
`TestWindow` handoff, evaluate test evidence, or choose validation commands for
workspace governance work.

## Default Posture

- 总控默认自己验证不依赖真实场景的事项：workspace 脚本测试、文档校验、状态机验证、targeted unit / probe、轻量集成验证、可构造的最小复现和可直接读取证据的验收复核。
- `TestWindow` 只承接真实场景：真实测试项目操作、cold-start / rescan、Dashboard 手动观察、运行时监控、真实项目复现 / 回归、真实项目冒烟和跨仓库集成环境证据。
- 如果 workspace 定义了 IDE / Plugin 测试职责窗口，例如 AlembicWorkspace 的 `AlembicTest-IDE`，Codex Plugin、Codex host MCP、Codex 会话 / 本地环境、installed / packaged Plugin runtime smoke 和 direct-thread / IDE 投递读回走该窗口；真实 BiliDili / AlembicWorkspace cold-start / rescan / AI/provider 测试仍走 `TestWindow`。
- 总控已经看到具体代码缺口、文档缺口、脚本缺口、自动化状态机缺口或可由最小 probe 复现的问题时，先由总控或归属源码仓库完成最小修复和验证；修复后仍需要真实环境证明时，才让 `TestWindow` 复测。
- 测试相关可以交给 `TestWindow`，但总控负责控制节奏：先判断边界，再决定谁测；不能把自己已经能判断或验证的问题推给 Test。

## Pre-Test Boundary Gate

任何测试开始前先回答：

1. 测试要回答的唯一问题是什么？
2. 测试对象 / 目标窗口 / 线程 / 项目边界是什么？
3. 总控能自测哪些部分，已经自测了什么？
4. 必须依赖 `TestWindow` 或真实场景的条件是什么？
5. 成功能推出什么结论？
6. 失败能推出什么结论？
7. 哪些结论不能推出？
8. 什么条件下应停止，而不是启动测试？

没有这组判断，不得创建测试 card / 任务包、不得发送测试窗口、不得把测试结果写成主线事实。

## TestWindow Handoff

- 只在测试确实需要真实项目环境、cold-start / rescan、Dashboard 手动观察、运行时监控、真实项目复现 / 回归或跨仓库集成环境证据时，才创建 `TestWindow` 测试边界。
- 只在测试对象属于 Codex Plugin / host MCP / 本地环境 / IDE 投递读回时，才把 IDE / Plugin 测试职责窗口写为 `执行窗口`；不得为了方便把这类测试写给真实项目 `TestWindow`。
- 新流程先用 `node scripts/control-intake.mjs test-card --state-root <state-root> ... --write --json` 写入 state-root 下的 `test-cards/*.json`。这个 card 是测试边界机器数据，不是 dispatch、不是测试结果、不是验收。
- 总控复核 test card 后，如确认需要发送测试窗口，再用 `controller-state.mjs add-task-package --source-ref test-cards/<id>.json --target-window <TestWindow>` 建任务包；随后才允许 direct-thread delivery 或手工提示词。
- `test-exchange.md` 只作为短人读摘要 / exchange 投影；不得手工把它当机器状态源，也不得通过它绕过 state-root task package。
- 测试 card 必须写清总控自测排除理由、需要的真实场景、测试前边界与多条件判断、验证命令、回填证据和停止条件。
- 总控可以制定测试目标、验收标准、观察点、风险和回填要求；只有交给 `TestWindow` 的真实场景测试，测试脚本、测试配置、复现记录和长期验证报告才放在 `TestWindow/` 下。
- 总控与 `TestWindow` 的任务和结果交流必须可回溯到 state-root 的 test card / task package / target result；普通聊天不能替代测试范围、结果和下一步判断。

## Evidence And Acceptance

- 执行窗口和 `TestWindow` 的回填是证据输入，不是总控事实裁决。总控必须分开记录窗口自述、原始证据和总控独立裁决。
- 如果回填只有文档读取、脚本表面操作或自然语言判断，没有提交 hash、命令输出、runtime JSON、日志摘要、截图、报告路径或可复核文件证据，只能标为 `待补证` / `待裁决` / `阻塞`。
- 如果测试没有回答正确问题，或成功 / 失败结论被放大到不属于该边界的范围，必须暂停派发，先重新做边界判断；不得把答错题的结果写成主线事实。
- 总控验收时如果证据不足，先判断总控能否直接补做最小复核。只有证据缺口依赖真实场景或目标仓库专属环境时，才补派 `TestWindow` 或对应仓库窗口。
- `TestWindow` 自身的 probe、报告、脚本索引或临时测试资产可以保持未提交状态；只要测试回填证据足够、产品仓库和真实测试项目没有非预期改动，不得把这些未提交测试资产当作总控验收阻塞。提交 hash 可以记录为 `无`。

## Validation Commands

- 只改 workspace 文档、脚本或分派规则时，由总控自己运行对应 workspace 文档 / 边界 / 格式 / 脚本测试。
- 新建 / 激活目标阶段确认或 wave 执行计划后，优先运行 `node scripts/verify-control-center.mjs`。
- 当前计划使用 TODO 子模式影响派发、并行调度或下一波顺序时，运行 `node scripts/verify-control-center.mjs --require-todo`。
- 当前计划使用任务包派发时，运行 `node scripts/verify-control-center.mjs --require-task-packages`；同时使用 TODO 和任务包时合并为 `node scripts/verify-control-center.mjs --require-todo --require-task-packages`。
- 修改 workspace 脚本、脚本 README 或脚本 skill 指南时，运行 `node scripts/verify-control-center.mjs --with-script-tests`。
- 只改长期文档且当前计划未变化时，至少运行 workspace docs verification 和 `git diff --check`。

## Related Entrypoints

- 测试边界机器入口：`<state-root>/test-cards/*.json`
- 测试交流投影入口：`.workspace-active/workspace/current/test-exchange.md`
- 测试执行长期规则：内部模式为 `../workspace-ledger/testing/docs/testing-operation-policy.md`；外部模式为 `TestWindow/docs/testing-operation-policy.md`
- IDE / Plugin 测试职责窗口：读取 workspace config 的 `ideTestWindow`；没有该字段时，必须在当前计划中显式写清窗口名。
- 默认测试参数：`TestWindow/config/defaults.json`
- 测试 card 模板：`templates/test-handoff-template.md`
- 测试边界脚本：`scripts/control-intake.mjs test-card`
- 机械记录：测试边界先写入 state-root `test-cards/*.json`，再由总控决定是否生成任务包和派发；脚本不能替代总控验收。
