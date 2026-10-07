# 测试捕获与导入回执：本轮审阅及验证来源

本轮2026-10-04，基线04769897加未提交维护工具；版本1.1.0-rc.5不变。运行时、Schema、agent-text、生成插件、hook定义及安装缓存均未修改。

## 实现与审阅范围

[8条完整语义记录](./tooling-files.json)覆盖7个新增维护文件与CLI。[覆盖报告](./review-coverage.json)对405个手写文件逐项核对：360运行时、45工具，其中397个继承前轮相同字节及原始semantic记录；95 Schema、95 generated、313测试相关TS（279测试入口）另列库存。所有引用的旧台账保留原始内容。[静态库存](./import-graph.json)包含500模块、3465本地导入，不代替调用或执行证明。

prepare核对既有Schema、摘要和关联引用；run仅执行一条显式命令，保存原始双流和前后观察；inspect离线复验记录完整性。代码不读snapshot、不批准重试、不自动继续、不登记业务证据。当前标记作用于同一维护仓库；换计划和输出目录不能重复同一attempt/step。receipt仅保存导入材料，不建立宿主授权或真实来源。

## 已观察结果

[16项聚焦回归及quick静态门](./validation/quick/report.json)通过，输入首尾一致。覆盖真实Git主根/linked checkout、同提交外来仓库拒绝、原始文件移除、限定retry、两个真实CLI进程的重复竞争、部分标记、链接/未知文件、原始流、非零/超时/取消/预算、运行前后修改、日志篡改及两个摘要约定。

[隔离CLI重放摘要](./validation/capture-replay.json)另从前轮原生场景保存的Git bundle、不可变commit、冻结task package与导入TargetResult，在本次独占可丢弃目录恢复两个linked checkout。实际CLI prepare仅允许ts-2/ts-3，ts-1在命令前拒绝；删除本次导入副本后仍执行10+12项真实模块断言并inspect匹配。重复ts-2在命令前拒绝。原Workspace6材料保持只读，核心合同和harness摘要再次核对。这里使用历史材料，不是重新授权的原生聊天执行，也没有写Wakeflow状态。

本地重放协调脚本在所有CLI检查通过后，末尾误把故意删除的副本也列入原件复核而报ENOENT。保留失败日志并仅修正结算，已通过的两个步骤没有再执行。该错误不来自capture；不能隐去它或将第一次协调脚本退出记为通过。

真实历史发送返回的文件摘要和完整JSON序列化摘要不同；receipt分别准确记录。记录成功不表示再次发送，也不意味着宿主效果经本工具验证。未导出请求、私有路径或聊天身份。

最终完整门和制品门已经实际完成，见下文；未以quick或前轮1297项结果替代。

## 保留边界

当前实现只支持committed且干净的实施基线。Git状态和选定文件观察不等于全文件或传递依赖隔离，显式命令不是沙箱。预算为周期观测，可短时超量；超量后保留原字节且不能绿色。导入合同不是实时claim/授权/绑定证明，离线摘要不是签名真实性。自然语言步骤顺序和停止条件、当前授权与Controller接受仍由现有责任方判断。

本批没有新增原生聊天。此前[main/worktree原生记录](../review-2026-10-04-lab-workflows/validation/native-scenarios.json)仍保留窗口运行关联、回调hook和列表回读缺口；本批工具不能补足。Windows、远端GitHub CI和新Claude登录会话仍未验证。


## 图谱与资源收尾

本轮[独立图谱检查](./validation/atlas-check.json)通过18项检查器回归、类型、81份文档、76份当前来源指纹及构建；110/110张图在真实浏览器渲染并保存回执，新页面也实际打开核对两张图。保留现有Vite大分块警告，不修改阈值。

两个本次linked checkout已用非force Git操作回收。第一次清理预检因人工文件列表漏列原commit内已有测试文件而拒绝，未删除任何内容；改为核对实际commit tree、干净Git状态和选定节点后才处置。保留该诊断。Test日志、冻结计划和主克隆仓库继续保存，历史配置已改名，避免它被发现为活动Wakeflow工作区；移除检出并改名配置后离线inspect仍匹配。没有新增项目或聊天。


## 完整门的资源敏感失败与隔离复验

首轮4 worker门观察到工作区准备阶段失败、worktree清理及固定双产品场景240秒超时，随后明确中断并保留[中断回执](./validation/interrupted-gate/report.json)和[部分失败观察](./validation/interrupted-observations.json)，不是完整通过。没有放宽测试超时或跳过fsync。同期机器其他进程占用较高；这一环境观察本身不能证明唯一根因。

随后仅选择工作区隔离与清理两个文件，在1 worker下[5项全部通过](./validation/isolated/report.json)，首尾输入一致；工作区3项、清理2项均保持原断言与预算。随后2 worker完整门已执行固定业务、二十场景及全部其余文件；这一完整通过与隔离通过分别留证。


## 最终完整门与制品核验

当前2809个输入文件指纹为 `sha256:7c9baccdf2ceb8a9b432a4750fe5f745da2a8b0e5650340e101d5c005b42240d`。2 worker实际执行 `npm test`，**1313项、279文件全部通过**，失败、取消、skip和todo均为零；完整命令1753415毫秒，首尾输入一致。先前出现失败的3处路径在本次完整执行中均通过。该结果证明当前字节在这次负载与并发下通过，不把首轮4 worker失败改写成成功，也不宣称高负载下已稳定。见[完整门](./validation/gate/report.json)。

独立[制品门](./validation/artifact/report.json)的build:check和双宿主smoke均通过，使用同一代码输入。两份rc.5清单摘要不变：Codex `sha256:ab9d9a1e308db758ce88a02fd334b89843f995cfbb4f3b78ceeacabbc5b18735`，Claude `sha256:fb4bf0c5eea17b6a25a233f74402cf47711b67d1ab8afe09f3b0b7d6fb203f9f`。这不是安装或新登录会话验收。

quick、隔离复验、中断门、完整门和制品门的受限导出均按[实际字节核验](./validation/bundle-integrity.json)，仍保留本地未签名来源。完整门另生成279文件耗时建议，仅存私有维护目录，没有覆盖调度表或改变本次门的输入。完整关系见[验证来源JSON](./validation-provenance.json)。

源码及文档未提交；main与本地origin/main对齐。没有推送、发布、升级版本、刷新缓存或重启Codex；本批不需要重新配置或信任hook。
