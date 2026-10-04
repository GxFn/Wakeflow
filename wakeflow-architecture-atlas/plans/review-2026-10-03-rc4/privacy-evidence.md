# rc.4 基线 → rc.5 候选：隐私扫描、需求披露与证据内容门

起始 sourceVersion 为 `1.1.0-rc.4`，最终源码版本输入 `finalSourceVersion: 1.1.0-rc.5`；目录名保留起始基线。此处不宣称候选已发布或安装。

本轮完整语义审阅原定3个变化文件，并在发现的问题由另一开发线程修复后，追加完整重读 `src/capabilities/requirement/service.ts`。4条当前语义记录在 [privacy-evidence-files.json](./privacy-evidence-files.json)。生产文件由另一线程维护；本子任务只写图谱、报告和合成探针。

## 结论与修复前后证据

| 编号 | 前态观察 | 当前实现与复核 | 状态 |
| --- | --- | --- | --- |
| RC4-PRIV-01 | 64种不同重复章节占满诊断列表，随后隐私项被截掉；公开preview为blocked，但summary回显扫描器已经识别的合成密码。 | `PackageAnalysis.privacyHit` 独立积累标题/文档事实；`derivePublishAssessment` 再合并头部事实；`planPublish` 根据这个布尔值隐藏摘要。相同输入后态仍有64项诊断且无privacy项，但summary为null、公开结果不含合成值。 | 实现和独立探针已确认修复；新源码回归断言已读 |
| RC4-PRIV-02 | UUID正则在任意下划线/连字符前缀后不采集候选，导致未知前缀也绕过允许前缀表。 | 候选允许这两类前字符；`uuidIsPrefixed` 要求非空、完整已知前缀及前方词边界。裸UUID、未知前缀、伪已知后缀被拒；完整已知前缀可通过。 | 实现和后态探针已确认修复；新增回归明确正反边界 |
| RC4-PRIV-L01 | 有效UTF8即使含NUL/OSC仍识别合成凭证；无效UTF8只标opaque，人工确认可使其ready而不产文本命中。 | `classifyContent` 明确在严格解码失败时返回opaque与空findings；本轮没有修改此授权边界。 | 已知内容审阅限制，不宣称二进制已排除秘密 |

前态结果保存在 [privacy-evidence-probe-before-fix.json](./privacy-evidence-probe-before-fix.json)，原探针脚本 [privacy-evidence-probe.mjs](./privacy-evidence-probe.mjs) 保留旧函数接口，供历史重放。后态脚本 [privacy-evidence-probe-after-fix.mjs](./privacy-evidence-probe-after-fix.mjs) 与 [后态结果](./privacy-evidence-probe-after-fix.json) 分开保存，未覆盖失败证据。

探针把当前4个被审阅生产模块用 SWC 在内存转译，所有其他模块和一次性fixture复用既有 `.build`。没有执行根编译、改生产或构建制品。凭证样例仅由固定词重复生成；只读写专用一次性fixture，finally中清理；报告输出类别、位置和布尔值，不写真实根路径或凭据。前后结果均记录被转译源码和关联构建模块的SHA，不能将它们当作完整根测试门。

## 已读的实际分支

- **扫描器和原始位置**：原文始终扫描，CSI视图另扫并通过累计偏移二分映回原文；有CSI时只保留原文凭证命中，再合并视图命中。同(kind,index)取最长，按原文位置排序，以LF计算1起始的UTF16行列。未知控制字符保留opaque，不能让有效UTF8的凭证检查提前退出。
- **路径识别与包含**：file URI先解析、拒绝query/hash、百分号解码；盘符和UNC使用Windows语法，POSIX独立；点段正规化后必须根相等或完整子路径。HOME/波浪线不自动展开；不读realpath、不解析符号链接，Windows比较保持大小写敏感。
- **语境与误报**：需求允许普通站内路由，显式文件定位器及正规化后固定系统目录仍拒绝；普通JS正则、Unicode斜杠列表和https路由有具体回归。不能推广成任意语言/编码都被准确分类。
- **内容审阅门**：`reviewOf`按(ref,line,kind)排序去重，凭证与非凭证分组；被识别凭证无条件阻塞，非凭证超过64项也不可确认，公开阻塞最多16项。`reject`再拒opaque/非凭证，`controller-confirmed`只允许这两者。blocked不读捕获时钟。
- **来源一致性**：文件stable read绑定已观察节点；树先清单、逐文件读取与摘要校验、再全树清单，分类并发上限4。ready前复验Config与Demand权威/事件预期。公共apply重新观察源和计算内容摘要；物化又按Manifest长度/摘要复制，完整stage恢复不必重读原source。
- **已有记录的细节**：`replayRecorded`本身只读commit，但公共apply进入它之前仍走`planEvidence`并重新读取来源。不能把内部“不重读来源”的注释扩大成公开重试可在来源消失时直接回放。
- **投影与真实载荷**：hook只保留有限字段，不复制handle/cwd或transcript正文；link与commit仅保存定位投影，不访问网络或验证Git对象。link原文再扫凭证；其他限定字段依赖合同准入，并非对所有投影字段再跑通用扫描。
- **公开私有值边界**：redaction只查JSON键和值中的已知私有字符串，不是凭证正则，也不会补出未知秘密。命令壳先检查请求，再打开上下文扩充切片私有值，返回前检查整个结果。

## 测试与覆盖边界

修复前直接执行既有构建中的3个测试文件：

```sh
node --test .build/tests/kernel/privacy-scan.test.js .build/tests/capabilities/requirement/decide.test.js .build/tests/governance/evidence/managed-evidence-capture-planning-service.test.js
```

19项通过、0失败、0取消，耗时约19.1秒。这是既有构建验证，尚未包含后来两项修复的新回归；后态事实由独立当前源码探针补验。开发线程随后完成43项聚焦测试与1244项根测试，图谱主代理核对了持久记录和候选制品摘要；详见[验证来源](./validation-provenance.md)，不计为本子任务自行运行根门。

新 `tests/capabilities/requirement/service.test.ts#executeRequirementPublicationRequest` 回归实际构造64种不同重复标题，逐类检查需求正文、landing、title、testing summary、parked trigger，并断言摘要隐藏和JSON不包含合成凭据；干净的饱和列表仍应有摘要。新 `tests/kernel/privacy-scan.test.ts#scanPrivacy` 回归覆盖未知/伪前缀、空允许表、空前缀、全部已知前缀，并明确直接粘接字母数字或带后缀的复合标识符不采集。只读过断言的分支不会在本报告冒充已运行该新测试。

保留的覆盖缺口：扫描期间并发替换整树、超过64个去重非凭证命中的服务路径、畸形百分号URI与部分控制字符路径未找到专用聚焦断言。源码存在守卫不等于这些具体分支已做动态验证。URL编码、压缩内容、非UTF8格式和任意控制指令的语义解析不在扫描器承诺内。

## contextReadFiles：本轮实际深入核对的关联文件

以下文件是调用链、合同与断言的上下文读取，不追加为本轮全量手写语义审阅：

| 位置 | 实际核对范围 |
| --- | --- |
| `src/kernel/redaction.ts` | 全文件，已知值集合、键/值递归、结构路径净化、请求与结果失败分类 |
| `src/kernel/command-shell.ts` | 请求豁免、副本扫描、open后私有值扩充、结果检查与上下文生命周期 |
| `src/kernel/publication-transaction.ts` | apply重新plan、blocked/摘要漂移守卫及recover独立分支 |
| `src/capabilities/evidence/service.ts` | planEvidence、applyEvidence、replayRecorded、公共摘要组装与shared范围 |
| `src/capabilities/evidence/decide.ts` | 全文件，公开内容摘要与治理capture-plan摘要的区别 |
| `src/capabilities/demand/decide.ts`、`src/capabilities/demand/lifecycle.ts` | 归档隐私仅保留凭证类别及实际调用位置 |
| `src/capabilities/result-review/decide.ts`、`src/capabilities/result-review/service.ts` | 报告文本选择、规则集合与导入阻塞位置 |
| `src/governance/evidence/managed-evidence-source-selection.ts` | 来源闭集、kind配对、保留路径、URL准入和contentReview策略 |
| `src/governance/evidence/managed-evidence-source-projection.ts` | 全文件，引用投影字节由Manifest来源确定性重建 |
| `src/governance/evidence/managed-evidence-configured-source-root.ts` | 全文件，配置根/Pod worktree回执根的物理打开与别名核验 |
| `src/governance/evidence/managed-evidence-capture-plan.ts` | 计划shape、CAS四项、manifest关系、内部planDigest |
| `src/governance/evidence/managed-evidence-manifest.ts` | 内容审阅排序/子集/容量/凭证类别限制与payload摘要 |
| `src/governance/evidence/managed-evidence-publication-payload-materializer.ts` | 全文件，file/tree/projection三种物化与source-changed分类 |
| `src/governance/evidence/managed-evidence-publication-stage-materializer.ts` | journal、完整stage复用、Manifest-last、提交后readback |
| `src/governance/evidence/managed-evidence-publication-application-service.ts` | apply及recover的CAS/Config/stage/source关系与前向结算 |
| `src/contracts/schemas/governance/evidence/managed-evidence-manifest.schema.json` | contentReview只有路径/UUID，成员子集由codec复验，不允许凭证确认类别 |
| `src/contracts/schemas/entrypoints/wakeflow-record-evidence-request.schema.json`、`src/contracts/schemas/entrypoints/wakeflow-record-evidence-result.schema.json` | 来源、内容策略与公开计划投影 |
| `src/contracts/schemas/entrypoints/wakeflow-requirement-publication-result.schema.json` | blockers 64×256上限与可空summary |
| `tests/kernel/privacy-scan.test.ts`、`tests/kernel/redaction.test.ts` | 扫描/原始位置、路径包含、UUID和已知值边界断言 |
| `tests/capabilities/requirement/decide.test.ts`、`tests/capabilities/requirement/service.test.ts` | 纯评估及真实公开preview；新截断交互回归 |
| `tests/capabilities/evidence/service.test.ts` | source漂移、already-recorded与内容策略的公共路径 |
| `tests/capabilities/demand/decide.test.ts`、`tests/capabilities/result-review/decide.test.ts` | 归档/报告消费者的具体隐私断言 |
| `tests/governance/evidence/managed-evidence-capture-planning-service.test.ts` | 四类来源、colored/opaque凭证、白名单、去重、容量前提和取消 |
| `tests/governance/evidence/managed-evidence-manifest.test.ts` | 内容审阅子集、排序、disposition与payload的关系断言 |
| `tests/governance/evidence/managed-evidence-publication-stage-materializer.test.ts`、`tests/governance/evidence/managed-evidence-publication-application-service.test.ts` | 源漂移不发布Manifest、完整stage与Event后恢复不重读来源 |
| `tests/governance/evidence/managed-evidence-capture-planning-service.fixture.ts`、`tests/support/prepared-workspace.ts` | 专用一次性环境、清理边界和none durability的适用范围 |

## 图谱修正

新增5张分支图，分布于[内核扫描边界](../../maps/11-kernel/privacy-boundary.md)、[需求独立披露判定](../../maps/13-requirement/privacy-preview.md)、[证据内容门与来源一致性](../../maps/14-evidence/privacy-and-source-consistency.md)。两个模块的导入图补上真正的扫描器直接依赖；总览修正opaque定义、摘要隐藏和公开重试来源依赖。每条边附真实符号与具体测试范围，未覆盖分支有明确标注；原10月2日与rc.3审阅记录保持历史原貌。
