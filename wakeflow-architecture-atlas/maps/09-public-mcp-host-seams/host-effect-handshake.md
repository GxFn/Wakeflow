---
diagramId: ts-agent-host-handshake-h1
viewType: runtime-call-sequence
truthKind: current-code
reviewDepth: L4
verifiedAt: 2026-09-01
snapshotObservedAt: 2026-09-01T06:42:28-07:00
baselineCommit: d17602ed9931a1898f713c740752c54b94bd8086
sourceFingerprint: sha256:76256d77e1692c887b3c9ac5e60404912ecb8ab0ee38fdadf5d8fe5637219ea7
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Source Maintenance
generatedBy: manual
sourcePaths: [src/governance/delivery/**, src/governance/testing/**, src/governance/result/**, src/governance/review/**, src/workspace/window-runtime/**]
---

# Agent宿主效果握手

```mermaid
sequenceDiagram
  accTitle: Wakeflow Agent宿主效果提交执行观察握手
  accDescr: Controller先按Route调用公共工具提交implementation或test prepared Intent。Agent提供当前窗口观察，Claim工具与0600私有Binding闭合并创建WindowWorkClaim、提交claimed Event；只有首次回执生成不含raw handle的瞬时Action。Agent执行后调用Outcome工具记录accepted、indeterminate或rejected Event。accepted在Result Event current后释放Claim；rejected在observed Event current后释放并可rearm或替代授权；indeterminate保留Claim。

  autonumber
  participant OWNER as Controller/领域服务
  participant REPO as Demand Repository
  participant BIND as 私有Binding Authority
  participant CLAIM as Claim Service / WorkClaim Store
  participant AGENT as Agent/宿主API
  participant OUTCOME as Outcome Service
  participant RESULT as Shared Result Import
  participant REVIEW as Work-type Review

  OWNER->>REPO: E-H1-01 提交prepared Intent Event
  AGENT->>CLAIM: E-H1-02 新鲜窗口Observation
  CLAIM->>BIND: E-H1-03 闭合host/window/root/handle fingerprint
  CLAIM->>CLAIM: E-H1-04 exclusive-create WorkClaim
  CLAIM->>REPO: E-H1-05 提交host-effect-claimed Event
  CLAIM-->>AGENT: E-H1-06 首次回执生成Host Action
  AGENT->>AGENT: E-H1-07 执行真实宿主效果
  AGENT->>OUTCOME: E-H1-08 回传accepted/indeterminate/rejected
  OUTCOME->>REPO: E-H1-09 提交host-effect-observed Event
  alt accepted
    alt implementation
      AGENT->>RESULT: E-H1-10 Implementation Report
      RESULT->>REPO: 提交shared Result Event
      RESULT->>CLAIM: E-H1-13 Result Event current后释放Claim
      REPO-->>REVIEW: Implementation Review Snapshot
    else test
      AGENT->>RESULT: E-H1-11 Test Report + ordered step evidence
      RESULT->>REPO: 提交shared Result Event
      RESULT->>CLAIM: E-H1-14 Result Event current后释放Claim
      REPO-->>REVIEW: test-result-review-planning
    end
  else rejected
    OUTCOME->>CLAIM: E-H1-15 observed Event current后释放Claim
    OWNER->>REPO: E-H1-12 implementation rearm或test替代授权
  else indeterminate
    OUTCOME-->>OWNER: 保留Claim并停止；禁止自动重试
  end
```

### 本图术语说明

| 术语 | 解释 |
| --- | --- |
| handle fingerprint | 对raw handle的不可逆闭合比较值；注册请求/私有Binding可见原值，Action、Event、投影和公开结果不携带 |
| 首次回执 | `committed` Claim Event回执；idempotent重放不重复签发Action |
| host effect | 创建/发送到窗口等真实外部副作用，不由事件文件本身执行 |
| indeterminate | 不能安全判断效果是否发生，必须人工/显式恢复 |
| workType | `implementation | test`判别来源；共享Claim/Observation/Result Event，但Report、lineage和Review判断不同 |
| test替代授权 | 仅在`rejected-before-effect + unavailable`后追加同一Test attempt的新Delivery Intent，不是自动重试 |

## H1边级证据

| 边编号 | 代码证据 | 核验结论 |
| --- | --- | --- |
| `E-H1-01`–`E-H1-06` | Preparation、Claim Authority/Service、Binding Store | Claim文件和claimed Event先于首次Action；idempotent重放不再签发 |
| `E-H1-07`–`E-H1-09` | Agent与Outcome Service | Agent执行外部效果；Wakeflow只记录观察 |
| `E-H1-10`、`E-H1-11`、`E-H1-13`、`E-H1-14` | Shared Result Import | accepted来源提交Result Event后精确释放Claim |
| `E-H1-12`、`E-H1-15` | Outcome/Rearm/Test Preparation | rejected Event后释放Claim，再显式rearm或replacement；indeterminate保留Claim |

## 停止边界

Claim、Outcome与Rearm已作为公共MCP工具发布；它们只管理Wakeflow事实，Agent仍是唯一宿主效果执行者。
