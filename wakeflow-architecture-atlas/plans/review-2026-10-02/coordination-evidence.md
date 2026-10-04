# 协调、需求、证据与观察：逐文件语义审阅

核验日期：2026-10-02。提交基线：`d8fafff33919c728e3a9b91ec04aa50ec5e07f0c`，并纳入当日已有未提交实现；运行时、Schema、测试和插件均只读。本轮改动限于图谱。

完整逐文件台账见 [coordination-evidence-files.json](./coordination-evidence-files.json)。81个手写TypeScript文件均实际全文阅读；长文件分段核对控制流、字段关系、I/O、异常和消费者。SHA-256只绑定读过的字节，不作为语义审阅替代。消费者与候选测试关系通过AST辅助复核，关键边的测试另读断言并在图中锚定；没有声称对所有测试文件做过全文审查或执行过真实宿主会话。

| 领域 | 手写文件数 | 审阅重点 |
| --- | ---: | --- |
| kernel | 22 | 命令外壳、hook分片与完整性、声明、Pod锁、验收语法、投影与索引 |
| endpoint | 6 | 六操作、Binding CAS、hook准入、locator与worktree回执 |
| requirement | 4 | 新发布验收列表、内容派生ID、Ledger先落地再上板、恢复 |
| pod capability | 3 | 配置事务、短锁、两段关闭与recover |
| evidence capability | 3 | 内容摘要、幂等Event身份、公开效果编排 |
| observation capability | 3 | status/verify、15门、制品缺失与错误降级 |
| governance ledger | 12 | 不可变包、逐记录intent/lock/stage、成员引用与精确恢复 |
| governance evidence | 19 | 捕获、隐私门、journal→stage→Event→final、读深度 |
| governance observation | 7 | 分域读取、事实投影、归档补读、Git指针与完整性 |
| governance pod | 2 | 纯派生状态、外部处置建议 |
| **合计** | **81** | **30,583行手写实现（含后续9行复核）** |

## 影响架构理解的结论

1. **Hook历史已改为可分片、可完整读取。** 新文件按UTC日与recordId前两位存储，旧平铺重试不迁移。每目录2048项稳定分页，query返回显式complete，streaming scan不以16384历史记录数截断。会话聚合仍有16384上限，失败时丢弃本地聚合并报告unavailable。
2. **保留策略与查询容量独立。** created才触发尽力修剪，每次最多检查4096项；30天截止受另一观察记录钳制，避免一次未来跳时越界删除。只有已知create/0600且inactive的旧stage可退休；不识别条目留给诊断。
3. **Pod占用与关闭已有共同短锁。** apply在锁内再次复验配置和计划。同Pod创建/关闭竞争必须序列化；不同Pod可并行。recover仅回执对账，当前实现未走这一锁和活动投影包装，不能扩写为所有Pod操作都受同一事务保护。
4. **非research新需求包必须有验收顶层列表。** 发布、规划、完成覆盖共用ac序号语法；旧v1 Ledger codec仍允许历史章节形状，不能把新发布准入误写成历史Schema升级。
5. **受管证据有不可逆Event边界。** 顺序是journal→完整stage→Event→final→事务期闭包→journal退休→健康闭包。Event后只前向；Event前CAS过期才允许安全退休candidate。引用来源存投影，不抓URL、不复制transcript正文、不验证Git对象。
6. **集合清点不是完整payload验证。** healthy inventory读Manifest与顶层结构，payloadVerification明确deferred；成员读取验证完整单文件，verifyRecord才验证整树。v1无分块摘要，不存在独立可验证byte-range能力。
7. **投影退休需要正面的完整观察。** 页面渲染缺项不能当作Demand不活动；任一Demand读不出即保留旧目录并写覆盖不全提示。正常刷新可恢复inactive projector锁；生成目标unsafe使整轮零写。
8. **manifest缺失不能误报同版。** 进程启动有manifest摘要但磁盘已读不到时，runtime-artifact门unavailable，下一责任归用户检查安装；启动本来无manifest仍not-applicable。

## 需要保留的实现限制与差异

- `release-claim`实际守卫是“超过2小时 **或** session-end **或** 端点缺席”，不是“过期且持有者消失”。相关纯决定测试明确覆盖expired加unobserved也接受；声明不会自动按TTL释放。
- `decommission`的manual-host-gate是证据等级，不是额外审批状态机，也不意味着工具自行调用宿主关闭。
- `publicResultBytes`当前仍24MiB。代码中的未来4MiB说明不当作已实现限制。
- status/verify在Config与Ledger入口打开失败时整体拒绝；只有进入工作区观察后才逐域降级。一次observeWorkspace不是跨全部目录的原子快照。
- verify的pass含有明确允许的过渡/人工文件分支：未注册窗口、creating Pod、closing待处置、手写活动投影均可能pass并带code，不能解释成所有执行环境已就绪。
- Git指针观察没有对象图，无法判断祖先合并或工作树清洁；只有完整分支清单允许从缺席推断删除，异分支尖端等于当前HEAD是唯一“已合并”简化条件。
- archive locator仅读公开摘要字段，不做完整归档包验收。归档补读有1024份清单、64份snapshot双预算，超限与读取失败分开报告。
- afterMutationRefresh只保证mutation已返回后投影取消不否定该返回；公共工具后续next/回读仍可能失败，不能扩大保证。

## 文档产物

共重建20份页面、30张Mermaid：保留六专题README、file-dependencies、runtime-call-flow的稳定地址；新增 [Hook历史](../../maps/11-kernel/hook-history.md) 与 [活动投影恢复](../../maps/16-observation/projection-recovery.md)。静态依赖由当前AST筛选；调用、状态派生、耐久恢复分别绘图。每图含中文无障碍说明、邻接术语、逐边代码与测试证据。旧开发阶段完成/未开始断言已从这些页面移除。

Schema复核采用源JSON Schema与对应运行时codec对照：需求记录、认领状态、证据Manifest、证据publication transaction及公开结果约束；生成链来自 `tooling/codegen/schema-types.ts` 与根schema:build/schema:check。generated文件只检查源映射与生成链，不算手写语义审阅。配置Schema实际路径为 `src/contracts/schemas/configuration/wakeflow-config.schema.json`，已修正旧图的v3文件名。

## 验证记录

自检覆盖这20页的边ID唯一对应、节点与符号存在、测试锚点真实使用、AST直接导入和来源指纹。首轮发现旧配置Schema路径与reclaim测试错误锚点，已分别改正为当前路径及Demand continue间接测试。全局图谱结构/浏览器Mermaid渲染/构建与根npm test由主审统一执行；本分支没有重复启动根测试，也未把未运行真实宿主会话列为通过。

## 后续来源复核

统一覆盖检查发现hook源码在首轮之后增加sameObservationDocument及两处调用。逐段复读并在内存撤销这些精确差异后，SHA与首轮台账完全相等，确认其余来源字节未变。新行为允许缺可选artifactManifestDigest的旧v1记录按null规范重放且保留原字节；已更新Hook图、分支记录及测试断言说明后更新指纹，没有只刷摘要。
