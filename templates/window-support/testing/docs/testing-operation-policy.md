# TestWindow Testing Operation Policy

状态：长期规则
维护窗口：TestWindow
适用范围：真实项目测试、冷启动监控、复现、smoke、回归和验证报告

## 核心规则

`ControlWorkspace` 总控窗口负责定义测试目标、分派测试窗口、验收回填证据和调整后续计划；`TestWindow` 负责需要真实环境的测试执行与证据整理。

以下操作默认归 `TestWindow`，且必须由用户确认过的当前总控 state-root 任务包授权；真实测试还必须能追溯到同一 state-root 下的 `test-cards/*.json`：

- 启动或重启测试运行时。
- 触发 cold-start / rescan / clean rebuild。
- 监控 Dashboard、Jobs API、daemon 日志或候选产出。
- 对 `workspace.config.json` 中声明的真实测试项目执行 smoke、复现或回归。
- 记录测试现象、失败原因、TODO、验证报告和后续建议。

总控能用 workspace 脚本、targeted unit、runtime JSON、日志或最小 probe 自己验证的问题，不应转交 `TestWindow` 重新发现。

## 配置归属

测试默认配置可放在 `config/defaults.json`：

- 默认测试目标项目，以及当前明确可选的真实测试项目清单。
- 被测本地仓库路径。
- restart / stop / status 等等待时间。
- monitor 轮询、超时、日志 tail 和信号匹配规则。

一次性差异通过脚本参数传入，不要把用户本机绝对路径、密钥、token 或临时端口写入长期配置。

## 脚本归属

真实项目测试脚本放在 `TestWindow/scripts/`。Control workspace 根 `scripts/` 只保留总控治理、文档校验、边界检查、Design/Test state-root intake、索引归档和派发检查脚本；不要把真实项目测试脚本放回总控根目录。

## 文档归属

长期测试计划、复现记录、监控记录和验证报告写入 `TestWindow/docs/`。跨仓库总控计划仍写在 controller state-root 和 `../workspace-ledger/workspace/`，但只链接或引用 `TestWindow` 回填的测试证据，不承载测试执行细节。`test-exchange.md` 只作人读摘要 / exchange 投影，不是测试授权或状态源。

## 回填要求

`TestWindow` 完成测试后，回填至少包含：

- state-root、task package、target task 和 test card 引用。
- 测试目标与触发入口。
- 使用配置或关键参数。
- job id / session id / UI URL 摘要。
- 状态变化和候选数量。
- 关键日志信号。
- 失败 / 取消 / timeout / completed 分类。
- 是否改动真实项目业务代码。
- 遗留风险和下一步建议。
