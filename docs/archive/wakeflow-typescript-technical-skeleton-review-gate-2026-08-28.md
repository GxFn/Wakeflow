# Wakeflow TypeScript Technical Skeleton Review Gate

> 日期：2026-08-28
> 状态：`reached / implementation-stopped / user-review-required`
> Owner：Wakeflow Design / Source Maintenance
> 范围：官方 MCP、TS 双宿主候选制品、Demand Core Skeleton、Window Runtime Identity、技术验证与测试清理
> 不代表：产品功能完成、旧 JS 等价验收、插件切换、release 或用户 acceptance

## 1. 结论

约定的 Technical Skeleton Review Gate 已经到达，节点前四项工作全部形成可运行证据：

1. 官方 `@modelcontextprotocol/server@2.0.0` 与 `serveStdio` 已接入；新 TS 不再实现 JSON-RPC、协议协商、分帧或工具路由底层。
2. 同一次 TS 编译结果能够确定性装配 Codex / Claude Code 两份闭合候选制品，真实 stdio Client、文件清单和 package dry-run 均通过。
3. Demand v1 Aggregate 已删除没有事件支撑的 Tasking、Delivery、Result、Testing、Review、Evidence、Pod 空占位，只保留当前真实事件拥有的 `demandId + lifecycle`。
4. Maintenance launch intent 已有唯一相邻 consumer：Agent 执行宿主 create 后，把 opaque host result 交给 Window Host Binding owner；Wakeflow 保存私有 Binding 并生成脱敏 registered projection。
5. 新 TS 测试执行只以当前 `.test.ts` 源清单为准；最终从空 `.build/tests` 强制重建后 `665/665` 通过。

按照用户确认的阶段门，本轮在这里停止。下文列出的 TaskPackage、Lease、Delivery、Result、Review、Evidence、Archive、Pod、Migration 与正式制品切换均未开始。

## 2. 本节点采用的最终技术决定

| 主题 | 已实施决定 | 被拒绝的旧路线 |
| --- | --- | --- |
| MCP | 官方 split package `@modelcontextprotocol/server@2.0.0`，`McpServer.registerTool` + `serveStdio(factory)` | 手写 JSON-RPC、line/Content-Length 双 framing、手写 tools/list/call dispatcher |
| MCP Schema | 仓库 JSON Schema → generated TS/runtime constant → `fromJsonSchema`；MCP wire Schema 自包含 | 另写一套 Zod 字段模型；向 Client 广告无法解析的外部 `$ref` |
| 双宿主源码 | 单一手写 TS；固定 Codex/Claude composition roots；同一共享编译求静态依赖闭包 | 复制 shared JS；运行时 host selector；动态 handler registry |
| Candidate artifact | 只写 `.build/artifacts/`，闭合 allowlist、摘要 manifest、非发布版本 `0.0.0-technical-skeleton` | 覆盖 `plugins/`、修改安装缓存、假称完整可发布插件 |
| Demand state | 当前 v1 只保存已有 publication/cancel 事件生成的最小状态 | 用空数组/null 提前固化未来业务模型；制造没有真实历史的 v2 |
| Host effect | Agent 调用 Codex/Claude 宿主能力；Wakeflow 只生成 intent、接收 observation、验证并持久化自己的 authority | Node adapter、MCP 内部转调、Bash/tmux/git wrapper、隐藏 fallback |
| Host handle | 按宿主 `handleKind`、容量、Unicode、控制字符与 reserved values 处理 opaque ID | 沿用旧代码未获官方保证的 UUID 正则或解释宿主内部格式 |
| Binding | 当前宿主私有 0600 no-replace authority；全 inventory 唯一性；专用 lock；同 observation 幂等 | 通用 Resource Capability Binding 中间层；无锁覆盖；把 raw handle 放入公开投影 |
| Projection | Binding 为提交点，projection 从 Binding + topology 重建；注册后仍以 `root-unobserved` 阻断 | 把“已登记身份”伪装成 host ready、root ready 或可 Delivery |
| Tests | source-manifest runner；focused 精确源文件；完整新 TS 门单独运行 | glob `.build/tests/*.js`；陈旧编译文件维持虚假测试；日常重复全部慢恢复场景 |

官方依据：

- [MCP TypeScript server package](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/server/README.md)
- [MCP stdio serving guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md)
- [MCP schema-library guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/advanced/schema-libraries.md)
- [MCP v2 migration guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md)

## 3. 当前架构骨干

```text
JSON Schema 2020-12
  → generated structural types + frozen runtime schemas
  → domain codecs / owners

Foundation
  data · crypto · identity · time · rooted filesystem · atomic · lock · tree · Git
      ↓
Configuration
  Config v3 authority / fresh selection / placement
      ↓
Workspace technical owners
  Resource Matrix · Maintenance · Active · Managed Integration · Host Layout
      ↓
  Window launch intent
      ↓
Agent host capability creates a window (outside Wakeflow)
      ↓ observation
Window Runtime Identity
  registration authority → private Binding store → redacted projection
      ↓
Fixed Codex / Claude entrypoints
      ↓
Official MCP server + stdio
      ↓
Closed `.build/artifacts/<host>` candidate

Governance skeleton (parallel host-neutral spine)
  TODO · Ledger · Demand identity/authority/Event Store/snapshot/upcaster
```

强制依赖方向仍为：

- Foundation 不依赖 Configuration、Workspace、Governance、Host 或 Entrypoint；
- host-neutral runtime 不导入具体 Host 实现；
- Host 只组合 shared ports/Profile 与自身实现；
- Entrypoint 固定 Host，不接受 host/capability selector；
- Tooling 和 Tests 不进入生产候选闭包；
- 新 TS 不 import `core/`、`plugins/`、旧 `tools/` 或旧 `test/`。

架构门最终实际扫描：`421 modules / 2579 dependencies / 0 violations`。

## 4. 当前代码规模

| 区域 | 文件数 | 行数 | 说明 |
| --- | ---: | ---: | --- |
| 手写 `src/`（排除 generated） | 228 | 69,154 | 当前 TS runtime、host、entrypoints |
| Foundation | 63 | 20,736 | 最大基础能力区；节点后禁止无 consumer 水平扩张 |
| Configuration | 10 | 3,306 | Config v3、selection、authority、placement |
| Workspace | 77 | 25,733 | Maintenance/Matrix/Managed/Window 等技术 owner |
| Governance | 59 | 16,656 | TODO、Ledger、Demand Skeleton |
| Hosts | 11 | 2,139 | Codex / Claude 明确差异 |
| Entrypoints | 8 | 584 | 固定 composition + official MCP/stdio |
| Generated contracts | 34 | 7,234 | Schema 派生，禁止手改 |
| JSON Schema | 34 | 4,532 | portable wire/record authority |
| Tests | 155 | 32,768 | 153份`.test.ts` + 2份typed fixture；665个cases/subtests |
| Tooling | 4 | 1,982 | codegen、architecture、test runner、artifact builder |

这一规模说明两个事实：

- Foundation 与 Workspace 已足以支撑真实技术 owner，不应继续按“可能未来需要”扩张。
- Maintenance 的完整耐久事务占据明显复杂度；后续业务必须复用现有 owner/recipe，不建立第二套全局事务或管理器。

Window registration 在复核时从单个 958 行混合文件拆为四个明确层：

```text
registration-authority       253 lines  pure
window-host-binding-store    514 lines  private authority I/O
registered-projection-publish 243 lines derived I/O
registration orchestrator    314 lines  decisions + receipt
```

拆分后 orchestrator import 从 32 个降为 14 个；没有新增状态机或公共工具。

## 5. 公共 MCP 表面

当前两个候选制品都只发布以下两个真实工具：

| Tool | 输入 | 成功输出 | Mutation / host effect |
| --- | --- | --- | --- |
| `wakeflow_maintain_workspace` | `preview` / exact-confirmed `apply` / operation-ID-only `recover` | redacted Maintenance result、Confirmation、Agent launch intents | 可修改 Wakeflow-owned files；不执行 host effect |
| `wakeflow_register_window_binding` | workspace root + exact Agent host-create observation | binding ref/generation/digest + projection ref/digests | no-replace 创建私有 Binding、重建投影；不创建/读取宿主窗口 |

MCP 适配层规则：

- SDK 在进入 owner 前执行自包含 JSON Schema 校验；领域 owner 仍独立复验关系和 authority。
- 成功同时返回 canonical text 与 `structuredContent`，并由 output Schema 校验。
- 已知错误只公开稳定 `code/reason/path/cause`；不公开 stack、异常消息、workspace root 或 raw handle。
- Binding 错误显式携带 `bindingAuthority = unchanged | current | unknown`。
- `unknown` 表示原子提交边界无法被证明，Agent 只能重试同一 observation，不得再创建第二个宿主窗口。
- stdout 只用于 MCP；transport/shutdown 摘要只写 stderr。
- 两个工具由固定 composition 直接注册，没有 31-tool placeholder 或动态 dispatcher。

## 6. Demand Core Skeleton 重新基线化

### 6.1 当前真实 Aggregate

```json
{
  "artifactKind": "wakeflow-demand-aggregate-state",
  "schemaVersion": 1,
  "demandId": "demand_<uuid-v4>",
  "lifecycle": "active | completed | cancelled"
}
```

当前只有 `publication.demand-published.v1` 与 `lifecycle.demand-cancelled.v1`。因此以下旧占位已从 Schema、generated type、model、digest、snapshot 嵌入和测试中删除：

- `tasking.taskPackages/targetTasks`；
- `delivery.currentDeliveries`；
- `result.currentResults`；
- `testing.testCards/testAttempts`；
- `review.pendingCandidate`；
- `evidence.items`；
- `pod`。

TS 版尚未发布或切换，不存在需要读取的已发布 Aggregate v1 数据，因此本次直接修正现有 v1，而没有制造虚假 v2/upcaster。未来第一条 Tasking 事件进入时，必须重新决定 state-model version、历史摘要兼容与真实 upcaster，而不是把空占位重新加回。

### 6.2 当前保留的 Event Sourcing 骨干

- typed Demand identity / authority；
- immutable append-commit file Event Store；
- stream revision、commit sequence、event ID uniqueness 与 digest chain；
- pure decide/evolve；
- snapshot as removable checkpoint；
- full audit from commit 1；
- per-event-family codec 与 version evolution registry；
- state-model compatibility digest；
- publication transaction + TODO lineage；
- cancellation。

不包含 TaskPackage、Delivery、Result、Review、Evidence 或 Pod 业务事实。

## 7. Window Runtime Identity Skeleton

### 7.1 完整调用链

```text
Maintenance preview
  → WakeflowWindowLaunchIntent(windowId, hostId, config/profile digest)
  → Agent calls current host create capability
  → Agent receives opaque host ID
  → wakeflow_register_window_binding(observation)
  → recompute current launch intent
  → host-specific opaque handle admission
  → current-host global Binding lock
  → recover admitted atomic stages
  → scan complete configured-window Binding inventory
  → enforce unique windowId / bindingId / handle
  → exclusive-create 0600 Binding authority   ← commit point
  → rebuild 0600 registered projection
  → redacted receipt
```

### 7.2 私有 Binding 与公开投影

Binding authority 保存：

- `programId / hostId / windowId`；
- `window_binding_<uuid-v4>` generation ID；
- `handle.kind + handle.value`（私有 opaque 值）；
- exact `launchIntentDigest`；
- Agent `observedAt` 与 store `registeredAt`。

Registered projection 只保存：

- logical topology 与 configured placement；
- `bindingRef / bindingId / bindingDigest`；
- source fingerprints；
- `rootObservation = unobserved`；
- `preflight = blocked(root-unobserved)`。

它明确不保存 raw handle、host liveness、send/close result、absolute root、Lease、Delivery 或 Pod state。

### 7.3 并发与恢复事实

- 同一 Host 全部静态窗口共用一把 `.registration.lock`，避免两个窗口并发绑定同一 handle。
- 完全相同 observation 重试返回原 bindingId 和 `replayed`，不重复分配。
- 同 window 不同 observation 返回 `binding-conflict`；同 handle 不同 window 返回 `handle-conflict`。
- Binding 创建采用 OS no-replace + file/parent fsync；projection 使用 exact-source create/replace。
- Binding 已提交但 projection 冲突时错误返回 `bindingAuthority=current`；修复 admitted source 后同一 observation 前向重建。
- 原子 create 报告 commit uncertain 时使用 `bindingAuthority=unknown`，不会伪称回滚。
- stale inactive lock 与受管 stages 有 owner-aware 恢复；active/unknown/foreign residue 保留并阻断。

## 8. Authority 与资源矩阵

| Authority / projection | 位置/形态 | Owner | 写入方式 | 公开性 |
| --- | --- | --- | --- | --- |
| Config v3 | `wakeflow.config.json`, 0644 tracked | Config Authority | absent create / exact replace | shareable |
| TODO | private JSON aggregate + Markdown projection | TODO Collection | lock+journal+CAS | projection shareable语义，JSON authority |
| Ledger | immutable Requirement/Confirmation trees | Ledger | staged tree publish | shareable records |
| Demand | immutable commits + removable snapshots | Demand Event Sourcing | append-commit / rebuild checkpoint | host-neutral private runtime |
| Maintenance | 0600 intent+journal+gate | Maintenance | unique aggregate transaction | private |
| Window Binding | per-host 0600 file | Window Host Binding | lock + exclusive create | raw handle private |
| Window projection | per-host 0600 file | Window Runtime Projection | deterministic rebuild | redacted private projection |

Static Matrix 当前新增一个每宿主 Binding lock 声明；动态 Binding files 由 Config window topology 生成，不进入静态全局 registry。Owner Catalog/Matrix 直接闭合 resource/recipe，没有恢复被用户删除的 Owner–Resource Capability Binding 中间层。

## 9. 双宿主候选制品

| 证据 | Codex | Claude Code |
| --- | ---: | ---: |
| 可达编译 JS | 213 | 218 |
| manifest payload files | 216 | 221 |
| npm pack entries | 217 | 222 |
| unpacked size | 1,707,048 bytes | 1,762,316 bytes |
| packed dry-run size | 318,876 bytes | 327,651 bytes |
| runtime dependencies | MCP server, Ajv, canonicalize, p-limit | 同左 + jsonc-parser |

共同事实：

- 候选版本为 `0.0.0-technical-skeleton`、`private: true`、`releaseEligible: false`；
- scope 为 `maintenance-and-window-identity-technical-skeleton`；
- `mcp/server.mjs` mode 为 0755；
- package dry-run 中 `.ts/.mts/.cts/.map` 数量为 0；
- 每个制品只包含入口真实依赖闭包，不复制整个 `.build/src`；
- Codex 不包含 Claude execution，Claude 不包含 Codex execution；只允许另一宿主的一份静态 Resource Profile，因为 Config/Maintenance 必须理解完整双宿主资源矩阵；
- 两份候选均由官方 stdio Client 启动并列出完全相同的两个工具；
- `plugins/codex-wakeflow/`、`plugins/claude-code-wakeflow/`、安装缓存和 0.9.6 release sources 均未修改或替换。

这两份输出是技术候选，不是完整插件：尚无 Skills、commands、模板、正式 plugin manifests、完整公共工具、validators/smoke 与 E3 新旧等价证据。

## 10. 测试与验证结果

### 10.1 最终门

```text
Node: 24.19.0
TypeScript source-manifest tests: 665 pass / 0 fail / 0 skip
Duration: 87.185658584s
Architecture: 421 modules / 2579 dependencies / 0 violations
Schema: 34 schemas / 65 external catalog refs / deterministic digest match
Artifact stdio: Codex pass / Claude pass
Package dry-run: Codex pass / Claude pass
git diff --check: pass
```

最终测试先验证并删除唯一可丢弃的 `.build/tests`，再使用 `tsc -b --force` 从当前153份`.test.ts`及其2份typed fixture重建，因此没有陈旧编译文件参与。

没有运行旧 JS 全套、旧插件 validator/smoke 或根 `npm test`：本节点不是 release-ready，用户明确要求开发期只维护新 TS 测试；正式 E3/E4 前仍必须另行执行旧新对照与仓库发布门。

### 10.2 日常与集成测试分层

`npm run test:typescript:focused -- <exact .test.ts files...>` 现在：

- 只接收 `tests/` 下当前普通 `.test.ts`；
- 拒绝不存在、越界、重复或 legacy 路径；
- 从源码路径映射编译输出，不枚举 `.build/tests`；
- 纯 MCP/Schema/codec 的 9 项聚焦样本约 0.65s；
- 完整 Window registration 垂直 fixture 约 6–16s，属于 integration 层。

完整门的主要慢项：

| 类别 | 代表耗时 | 处置 |
| --- | ---: | --- |
| Claude aggregate Maintenance | 14.4s | 集成层保留，不进普通 focused |
| Window launch→Binding 垂直场景 | 16.1s（全套并行负载下） | 每个 Window Identity 增量的 integration 证据 |
| Shared Maintenance transaction | 12.1s | crash/durability gate |
| Public Maintenance fresh/recovery | 10.4–14.5s | public integration，不复制到两宿主领域测试 |
| Demand publication recovery | 2.2–5.9s/场景 | Domain integration；codec/upcaster 保持毫秒级 |
| TODO transaction/recovery | 1.3–3.0s/场景 | Domain integration；record/projection 单测毫秒级 |

下一轮测试优化应减少重复 workspace 初始化 fixture 与重复 Maintenance 全链，而不能删除并发、CAS、crash recovery 或 durability 证据。

## 11. 无内部生产 dependent 的 leaf 审查

以 `src` 单独依赖图检查，以下 13 个文件没有其他 `src` dependent。它们不都等于死代码：

### 11.1 真实 artifact roots

- `src/entrypoints/codex-wakeflow-mcp.ts`
- `src/entrypoints/claude-code-wakeflow-mcp.ts`

它们由生成制品 launcher 消费，必须保留。

### 11.2 已验证、但尚未进入当前 MCP candidate 的 owner leaf

- Config replacement recovery；
- Demand publication service；
- Maintenance orphan/prepared recovery；
- Gitignore / Program Instruction / Support Memory recovery。

它们是明确 owner API，当前由 TS tests 直接验证；在对应 public/maintenance route 未接入前不进入候选制品。Gate 处置：`defer public wiring`，不得宣称已公开。

### 11.3 Foundation consumer-needed candidates

- loaded artifact transfer candidate/publication；
- stable file range read；
- base64url。

它们已被前期 Foundation review 接纳并有测试，但当前候选闭包不消费。Gate 处置：`explicit defer, exclude from artifact`。进入 Evidence/Archive、精确文件区域或第一个真实 base64url consumer 前重新复核；若下一业务路线仍无 consumer，应优先删除而不是继续维护。

## 12. 明确未实现与不得误报的内容

- TaskPackage / TargetTask / TestCard；
- Window Lease；
- Dispatch Group / Packet / Envelope / Delivery Run；
- Agent send outcome / rejected-before-send rearm；
- TargetResult / ReviewCandidate / Controller decision；
- complete / continue；
- Evidence event/state/manifest/privacy owner；
- BusinessArchive / Retention / Preservation；
- Pod state/evidence/lifecycle；
- host liveness、root observation、locator、send、close、activation 的新 TS 业务闭环；
- 完整 status/view/verify；
- Migration / legacy classifier / E3 comparison / E4 cutover；
- 正式插件 assets、31-tool compatibility、release version/tag/cache refresh。

旧 JS 继续只作为功能场景与失败反例，不决定上述新 TS 技术形态。

## 13. Gate 后待用户选择

本轮不替用户决定下一业务路线。后续至少有三种可讨论方向：

1. **Tasking-first**：先定义 TaskPackage/TargetTask artifacts 与 Tasking events，再让真实 Delivery 消费 Binding。
2. **Delivery vertical slice**：把 TaskPackage、Binding generation、Lease、Agent-mediated delivery plan/claim/outcome 作为一个更完整但更大的纵切。
3. **Technical consolidation**：在进入业务前先压缩重复 workspace fixtures、审查 Foundation consumer-needed leaves，并决定候选制品 manifest/依赖安装方案是否还需加固。

无论选择哪一项，都不能直接复刻旧 31-tool 表面或旧 mutable state；必须先明确首个用户结果、authority、事件、Agent effect handshake、恢复边界和最小聚焦测试。

## 14. 仓库状态与交付边界

- 当前分支：`main`，相对 `origin/main` ahead 4；
- 工作树包含本轮及此前连续 TS 重构的大量未提交改动；
- 本轮没有 commit、push、tag、publish、plugin sync 或 cache refresh；
- 现有 `plugins/` 与旧 `core/` 保持对照基线；
- `.build/artifacts/` 是 ignored、可重建输出；
- 本文是 review 证据，不是用户 acceptance 或下一阶段授权。

Technical Skeleton Review Gate 到此停止。
