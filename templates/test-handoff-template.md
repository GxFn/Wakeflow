# TestWindow Boundary Card Template

Use this template only when total control has already decided that a real
scenario, cold start, rescan, Dashboard observation, runtime monitor, or
cross-repository integration proof is required.

The machine source of truth is the active demand state root:

```bash
node scripts/control-intake.mjs test-card \
  --state-root <state-root> \
  --test-id <TEST-ID> \
  --target-window <TestWindow or IDE/Test window> \
  --question "<single question this test answers>" \
  --object-boundary "<project/thread/window boundary>" \
  --controller-self-check "<what total control already verified>" \
  --real-scenario-condition "<why this needs TestWindow>" \
  --success-means "<what success proves>" \
  --failure-means "<what failure proves>" \
  --cannot-conclude "<what this test cannot prove>" \
  --stop-condition "<when not to start or when to stop>" \
  --evidence-required "<raw evidence required>" \
  --allowed-operation "<allowed operation>" \
  --forbidden-operation "<forbidden operation>" \
  --write --json
```

After total control reviews the generated `test-cards/*.json`, create the
state-root task package with `controller-state.mjs add-task-package`. Do not
dispatch `TestWindow` from this template alone.

Optional human projection for `test-exchange.md`:

````text
### Test-<编号>：<测试名称>

状态：draft / pending / running / review / completed / blocked / paused
State root：<state-root>
Test card：<state-root>/test-cards/<id>.json
Task package：<task package id, after total control creates one>
执行窗口：<TestWindow / IDE test window>
目标项目：<真实测试项目 / fixture / mock project>

#### 测试目标

- <要证明的真实闭环>

#### 测试前边界

- 唯一问题：
- 对象 / 目标窗口 / 线程 / 项目边界：
- 总控已自测：
- 必须交给真实场景的条件：
- 成功能推出：
- 失败能推出：
- 不能推出：
- 停止条件：

#### 回填要求

- state-root / task package / target task / test card：
- 测试结论：
- 执行范围：
- 使用配置：
- job id / session id：
- Dashboard URL 摘要：
- 状态变化：
- 关键日志信号：
- 真实项目是否干净：
- 详细报告路径：
- 遗留风险：
- 下一步建议：
````
