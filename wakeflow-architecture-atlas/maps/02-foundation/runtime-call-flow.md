---
diagramId: ts-foundation-runtime-c0
viewType: call-flow
truthKind: current-code
reviewDepth: L4
verifiedAt: 2026-09-18
baselineCommit: 1480271ecc8a6c17bb9042321644402bd6cbda56
sourceFingerprint: sha256:34ae75e76a433c4e4c8dfda9b864bedebd0ef0b840629cc5b2691a47c2d682d9
audience: [maintainer, reviewer]
documentationOwner: Wakeflow Architecture Atlas
generatedBy: manual-review
sourcePaths:
  - src/configuration/*.ts
  - src/configuration/wakeflow-config-authority-snapshot.ts
  - src/contracts/generated/configuration/*.ts
  - src/contracts/generated/foundation/*.ts
  - src/contracts/generated/governance/board/*.ts
  - src/contracts/generated/identity/*.ts
  - src/contracts/identity/*.ts
  - src/contracts/vocabulary/*.ts
  - src/foundation/crypto/*.ts
  - src/foundation/data/*.ts
  - src/foundation/filesystem/*.ts
  - src/foundation/filesystem/deterministic-json-file.ts
  - src/foundation/filesystem/durable-atomic-file-write.ts
  - src/foundation/filesystem/rooted-directory.ts
  - src/foundation/filesystem/rooted-exclusive-file-lock.ts
  - src/foundation/filesystem/stable-file-read.ts
  - src/foundation/identity/*.ts
  - src/foundation/node/*.ts
  - src/foundation/numeric/*.ts
  - src/foundation/schema/*.ts
  - src/foundation/text/*.ts
  - src/foundation/time/*.ts
  - src/kernel/*.ts
  - src/kernel/requirement-board.ts
schemaPaths:
  - src/contracts/schemas/configuration/wakeflow-config-v3.schema.json
  - src/contracts/schemas/foundation/portable-resource-path.schema.json
  - src/contracts/schemas/foundation/sha256-digest.schema.json
  - src/contracts/schemas/foundation/utc-instant.schema.json
  - src/contracts/schemas/governance/board/requirement-claim-state.schema.json
  - src/contracts/schemas/identity/wakeflow-durable-id-kind.schema.json
testPaths:
  - tests/capabilities/requirement/service.test.ts
  - tests/foundation/filesystem/durable-atomic-file-write.test.ts
refreshTriggers:
  - .dependency-cruiser.cjs
  - docs/decisions/0013-target-architecture-and-slice-plan.md
---

# Foundation：稳定读取、提交与恢复

三张图分别描述读取、替换和只创建资源；跨调用业务恢复由拥有 journal 的领域负责。

> 核验基线：`1480271`（L1 observation 第十片已落地，20 个公共工具、18 个一次性场景）。工作树另有并行未提交改动（宿主 hook 通道等），本图不描绘；来源指纹按当前工作树计算。本文说明实现事实，未宣称双宿主真实会话已经验证。

## 稳定读取的节点与字节核对

```mermaid
sequenceDiagram
  accTitle: 稳定读取的节点与字节核对
  accDescr: 稳定读取的节点与字节核对；箭头区分当前代码步骤、返回事实与明确的条件。
  participant caller as 读取者
  participant root as 根能力
  participant read as 稳定读取
  participant json as 确定性解码
  caller->>root: E-L1006-01 固定真实根与句柄
  caller->>read: E-L1006-02 限定资源路径与容量
  read->>root: E-L1006-03 复验根仍是原节点
  read->>json: E-L1006-04 返回字节、节点与摘要
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| CAS | 比较已观察的摘要/修订后提交；来源已改变则拒绝。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| caller | `src/configuration/wakeflow-config-authority-snapshot.ts` | 读取者 |
| root | `src/foundation/filesystem/rooted-directory.ts#RootedDirectory` | 根能力 |
| read | `src/foundation/filesystem/stable-file-read.ts` | 稳定读取 |
| json | `src/foundation/filesystem/deterministic-json-file.ts` | 确定性解码 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1006-01 | `src/foundation/filesystem/rooted-directory.ts#RootedDirectory.open` | `tests/foundation/filesystem/durable-atomic-file-write.test.ts` | 固定真实根与句柄 |
| E-L1006-02 | `src/configuration/wakeflow-config-authority-snapshot.ts` | `tests/foundation/filesystem/durable-atomic-file-write.test.ts` | 限定资源路径与容量 |
| E-L1006-03 | `src/foundation/filesystem/stable-file-read.ts` | `tests/foundation/filesystem/durable-atomic-file-write.test.ts` | 复验根仍是原节点 |
| E-L1006-04 | `src/foundation/filesystem/deterministic-json-file.ts` | `tests/foundation/filesystem/durable-atomic-file-write.test.ts` | 返回字节、节点与摘要 |

## 精确文件替换与提交边界

```mermaid
sequenceDiagram
  accTitle: 精确文件替换与提交边界
  accDescr: 精确文件替换与提交边界；箭头区分当前代码步骤、返回事实与明确的条件。
  participant owner as 领域 owner
  participant lock as 独占锁
  participant writer as 原子写入器
  participant source as 稳定来源
  owner->>lock: E-L1007-01 持有互斥后重读当前值
  lock->>writer: E-L1007-02 携带节点与字节摘要预期
  writer->>source: E-L1007-03 准备 stage 并复验来源
  writer->>writer: E-L1007-04 rename 提交并完成持久性结算
  writer-->>owner: E-L1007-05 回执或提交不确定错误
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| CAS | 比较已观察的摘要/修订后提交；来源已改变则拒绝。 |
| commit | 一次不可变事件提交批；文件槽位以预期修订防止并发覆盖。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| owner | `src/kernel/requirement-board.ts` | 领域 owner |
| lock | `src/foundation/filesystem/rooted-exclusive-file-lock.ts` | 独占锁 |
| writer | `src/foundation/filesystem/durable-atomic-file-write.ts` | 原子写入器 |
| source | `src/foundation/filesystem/stable-file-read.ts` | 稳定来源 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1007-01 | `src/kernel/requirement-board.ts#replaceRequirementClaimStateFile` | `tests/capabilities/requirement/service.test.ts` | 持有互斥后重读当前值 |
| E-L1007-02 | `src/kernel/requirement-board.ts#replaceRequirementClaimStateFile` | `tests/capabilities/requirement/service.test.ts` | 携带节点与字节摘要预期 |
| E-L1007-03 | `src/foundation/filesystem/durable-atomic-file-write.ts#performWrite` | `tests/foundation/filesystem/durable-atomic-file-write.test.ts` | 准备 stage 并复验来源 |
| E-L1007-04 | `src/foundation/filesystem/durable-atomic-file-write.ts#performWrite` | `tests/foundation/filesystem/durable-atomic-file-write.test.ts` | rename 提交并完成持久性结算 |
| E-L1007-05 | `src/foundation/filesystem/durable-atomic-file-write.ts#performWrite` | `tests/foundation/filesystem/durable-atomic-file-write.test.ts` | 回执或提交不确定错误 |

## 具体 owner 的只创建记录幂等

```mermaid
sequenceDiagram
  accTitle: 具体 owner 的只创建记录幂等
  accDescr: 具体 owner 的只创建记录幂等；箭头区分当前代码步骤、返回事实与明确的条件。
  participant owner as 看板记录 owner
  participant writer as 只创建发布
  participant read as 读回已有资源
  owner->>writer: E-L1008-01 目标不存在时创建
  alt 目标已存在
  owner->>read: E-L1008-02 完整重读并比较确定性字节
  read-->>owner: E-L1008-03 相同为 current，不同为冲突
  end
```

### 本图术语说明

| 术语 | 本图含义 |
| --- | --- |
| CAS | 比较已观察的摘要/修订后提交；来源已改变则拒绝。 |
| projection | 根据权威重建的视图，不反向决定事实。 |

### 节点与实现定位

| 节点 | 文件 / 符号 | 责任 |
| --- | --- | --- |
| owner | `src/kernel/requirement-board.ts` | 看板记录 owner |
| writer | `src/foundation/filesystem/durable-atomic-file-write.ts` | 只创建发布 |
| read | `src/foundation/filesystem/deterministic-json-file.ts` | 读回已有资源 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-L1008-01 | `src/kernel/requirement-board.ts` | `tests/capabilities/requirement/service.test.ts` | 目标不存在时创建 |
| E-L1008-02 | `src/kernel/requirement-board.ts` | `tests/capabilities/requirement/service.test.ts` | 完整重读并比较确定性字节 |
| E-L1008-03 | `src/kernel/requirement-board.ts` | `tests/capabilities/requirement/service.test.ts` | 相同为 current，不同为冲突 |

## 守卫、恢复与验证范围

原通用 create-only helper 已删除；最后一图以看板记录 owner 为当前消费者示例。锁不会按时间自动打破；创建者和领域恢复器依照精确节点、记录及提交事实决定退休。文件系统原语不构成对恶意同权限进程的 OS 沙箱。

涉及的测试与核验入口：

- `tests/capabilities/requirement/service.test.ts`。
- `tests/foundation/filesystem/durable-atomic-file-write.test.ts`。

## 下钻与相关视图

- [本专题总览](./README.md)
- [图谱总索引](../README.md)
- [核验与剩余范围](../01-diagram-review-ledger.md)
