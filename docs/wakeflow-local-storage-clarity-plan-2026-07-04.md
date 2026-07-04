# Wakeflow 本地存储与文档引导：现状深读与整理规划 ——✅ 四阶段已于 2026-07-04 全部落地（0.7.9）

> 2026-07-04。现状证据来自活体工作区 AlembicWorkspace 的实测（文件数/体量/时效逐目录核对）+ v0.7.8 代码对照。以代码与磁盘为准。

---

## 1. 现状盘点（实测）

三层存储契约本身**清晰且被代码良好执行**——问题不在结构设计，在"结构之外"的部分：

| 层 | 实测 | 健康度 |
| --- | --- | --- |
| `wakeflow.config.json`（tracked） | 单文件，0.7.8 起规范名 + 旧名回退 | ✅ |
| `.wakeflow-active/`（活动态） | 仅 7 文件 / 208K：index + current/{index, status, board, test-exchange}；index.md 由总控维护得非常好（idle 状态、最近归档、残留项、逐需求条目全部在案） | ✅ 瘦而准 |
| `.wakeflow-local/`（运行时） | **12M / 1834 文件**，其中活跃传输目录（dispatch-packets/envelopes/runs/results/locks）**全部为空**，体量全在"无主树"（见 §2） | ⚠️ 结构性问题所在 |
| `wakeflow-ledger/`（耐久层，本例配置在工作区内） | 19M / 1800 文件：`workspace/record-map + 策略文档 + archive/2026-06/<demand>/` 月度归档 + 逐窗口台账 | ✅ 有序 |

## 2. 六棵无主树：`.wakeflow-local` 的真实问题

实测 `.wakeflow-local/` 下存在七个**现行代码没有任何生产者、全部文档零提及**的目录（grep 双向确认）：

| 目录 | 文件数 | 体量 | 最新 mtime | 推断来源 |
| --- | --- | --- | --- | --- |
| `preserved-state-roots/` | 591 | 5.0M | 06-29 | 人工把 redact 归档后留在 `current/` 的原件挪出（为"清空 current/"） |
| `preserved-wakeflow-delivery/` | 291 | 1.7M | 06-29 | 人工保全的旧传输 |
| `preserved-delivery-artifacts/` | 56 | 312K | 06-25 | 同上 |
| `runtime-quarantine/` | 140 | 812K | 06-25 | 历史修复/迁移隔离 |
| `wakeflow-delivery-quarantine/` | 137 | 676K | 06-26 | 同上 |
| `wakeflow-intake/` | 1 | 4K | 06-29 | 旧 intake 路径残留 |
| `wakeflow-delivery/archived-transport/` | 558 | 3.3M | 07-01 | **旧版本 prune 的归档目录**（现行 prune 直接删除，不再写这里） |

共约 **1,774 文件 / 11.8M**——占 `.wakeflow-local` 体量的绝大部分。它们的共同特征：

1. **无 manifest**：谁、何时、为什么、来自哪、保留到何时——全部无记录；
2. **无保留期与 GC 路径**：`prune-runtime` 只管现行传输文件，永远不会碰它们；
3. **对工具不可见**：`check-workspace` 不看存储健康，永远不会报告它们；
4. **对人不可解释**：新总控/人打开 `.wakeflow-local` 看到六棵神秘树，没有任何就地说明。

### 机器故事与现实的脱缝（根因）

`archive-demand --redact` 的设计是：**原件保留在 gitignored 活动层原地**（`current/<demand>`，状态 `archived`）供本地审计。但"留多久、谁清、清到哪"没有 convention——于是历史总控为了清空 `current/` 只能**发明自己的位置**人工挪走。每一次人工抢救都造一棵新无主树。残留不是事故，是**缺失 convention 的必然产物**。

## 3. 引导面的缺口

- **就地说明为零**：`.wakeflow-active/`、`.wakeflow-local/`、`wakeflow-delivery/`、`hosts/<host>/`、ledger 根，任何一处都没有 README。解释全部埋在 skills reference（wakeflow-ledgers.md / wakeflow-delivery.md）与 1300 行的架构文档里——离数据最远的地方。
- **健康面盲区**：`check-workspace` 覆盖 config/registry/permissions/overlay，但不看存储（孤儿树、传输增长、已归档原件堆积、legacy 残留如顶层旧 `thread-registry/`）。
- **词汇与位置变体**：ledger 位置是合法配置变体（本例在工作区内，新默认是 sibling），但引导文一律按默认讲——读者需要先看 config 才能对上路径，这一步没人提示。
- **小噪音**：`.DS_Store` 散落（gitignored 但污染 find/du）。

## 4. 整理规划（四阶段，保持"提醒不设门、判断归 Agent/用户"）

### Phase A — 就地说明（零行为变更，最高杠杆）——✅ 已落地

1. **生成式 README**：五个位置各放一份由 setup/check-workspace 收敛的短 README（managed marker，机器再生，不手维护）：
   - `.wakeflow-active/README.md`——这层是什么、index 是唯一入口、state root 结构一览、"归档后原件的去处"；
   - `.wakeflow-local/README.md`——**核心一份**：逐目录表（是什么/谁写/authority-projection-transport 分类/能否手动删/对应 GC 命令）、"canonical preserved 之外的目录都是异常，见 check-workspace"；
   - `.wakeflow-local/wakeflow-delivery/README.md`——传输工件生命周期 + `wakeflow_prune_runtime` 是唯一 GC；
   - `hosts/<host>/README.md`——句柄层：registry/binding/锁/临时提示文件，全部可再生；
   - ledger 根 README——月度归档树 + record-map 是索引。
   每份 ≤40 行，答三个问题：**这是什么？谁写它？我能动它吗？**
2. **存储地图命令**：`wakeflow_view scope=storage`（复用 view 面，只读）——枚举全部已知树，输出 {size, files, newest, class}，class ∈ {authority, projection, transport, preserved, quarantine, **orphan**(无生产者), legacy}；每类带一句 agentNext（"orphan：路由用户裁决，不要自动删"）。LLM-native：把"这堆是什么"从考古变成一次工具调用。

### Phase B — 残留生命周期（把抢救变成 convention）——✅ 已落地

3. **Canonical 抢救位**：`.wakeflow-local/preserved/<YYYY-MM-DD>-<reason>/` + 必带 `MANIFEST.md`（who/why/source/retention）。skills 写明：任何人工保全只允许放这里。
4. **归档原件机器化**：`archive-demand --redact` 完成后把原件**机器移入** `preserved/<date>-archive-original-<demand>/`（自动生成 manifest），`current/` 自然清空——消灭"人工挪原件"这个无主树之源。（非 redact 归档行为不变：直接删除。）
5. **check-workspace 存储区**：新增 gap 类型（提示不拦截）：`unknown-tree`（`.wakeflow-local` 下不在已知清单的目录）、`legacy-residue`（顶层旧 thread-registry、archived-transport）、`preserved-aging`（超过 retention 的 preserved 条目）。
6. **prune-runtime 扩展**：`target=preserved`——dry-run 列出超龄 preserved/quarantine 候选，apply 删除或转 ledger 归档；orphan 树给一次性迁移提示而非自动处理。

### Phase C — 引导重写（文档跟上）——✅ 已落地

7. `wakeflow-ledgers.md` 以"存储地图"为骨架重写：三层契约 → 逐目录表（与 README 同源）→ GC 故事 → 抢救 convention → "ledger 位置看 config"提示。
8. CLAUDE.md 加一行指针（就地 README + storage 视图）；controller skill 加"空闲时瞥一眼存储地图；unknown-tree 一律路由用户"的习惯条。

### Phase D — AlembicWorkspace 一次性治理（真机验收场）——✅ 已落地（七棵树全部折入 canonical preserved/，unknown=0 legacy=0，删除权留给用户走 prune dry-run）

9. 六棵树逐棵分类处置（每棵你拍板删/留/转 canonical preserved 带补写 manifest），`archived-transport` 按 orphan 迁移提示处理。治理完成后 `check-workspace` 存储区应为 0 gap——这就是 Phase B 的验收。

## 5. 边界与不做的事

- **不自动删任何东西**：所有清理动作 dry-run 优先、apply 显式、orphan/unknown 一律人裁；
- **不新增状态机**：storage 视图与 check 区是只读投影 + 提醒，零门禁零打分；
- **不动三层契约本身**：结构是对的，缺的是就地解释、残留生命周期与健康可见性。

## 6. 一页总览

```
A  就地说明   5 份生成式 README + wakeflow_view scope=storage     S   最高杠杆，零风险
B  残留治理   canonical preserved/ + 归档原件机器化 + check 存储区 + prune target=preserved   M   消灭无主树之源
C  引导重写   wakeflow-ledgers.md 重写 + CLAUDE.md/skill 指针     S   与 A 同源
D  真机治理   AlembicWorkspace 六棵树逐棵拍板处置                 S   B 的验收场
```
