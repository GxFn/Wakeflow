---
diagramId: "ts-foundation-tree-publication"
viewType: "recovery"
truthKind: "in-progress-worktree"
reviewDepth: "L5"
verifiedAt: "2026-10-02"
baselineCommit: "d8fafff33919c728e3a9b91ec04aa50ec5e07f0c"
audience: ["maintainer","reviewer"]
documentationOwner: "Wakeflow Architecture Atlas"
generatedBy: "manual-review"
testEvidence: "anchored"
sourcePaths: ["src/foundation/filesystem/directory-tree-candidate-plan.ts","src/foundation/filesystem/directory-tree-candidate-inspection.ts","src/foundation/filesystem/durable-directory-tree-candidate.ts","src/foundation/filesystem/durable-directory-tree-publication.ts","src/foundation/filesystem/durable-directory-tree-candidate-retirement.ts","src/foundation/filesystem/durable-resource-rename.ts","src/foundation/artifact/*.ts","src/capabilities/demand/archive.ts"]
schemaPaths: ["src/contracts/schemas/foundation/directory-tree-candidate-plan.schema.json","src/contracts/schemas/foundation/loaded-artifact-tree-manifest.schema.json"]
testPaths: ["tests/foundation/filesystem/durable-directory-tree-candidate.test.ts","tests/foundation/filesystem/durable-directory-tree-publication.test.ts","tests/foundation/filesystem/durable-directory-tree-candidate-retirement.test.ts","tests/foundation/artifact/loaded-artifact-tree-transfer-publication.test.ts"]
refreshTriggers: []
sourceFingerprint: "sha256:c7406790c6e528fda1f339d278929ef31cefca65a0b91c82ef9161411de48a82"
---


# 目录树：闭合计划、发布与精确退休

目录候选计划包含文件、推导的父目录、权限、字节数和摘要。它是可验证输入，是否以及何时发布/退休仍由业务 owner 决定；Foundation 不另建业务日志或状态机。

```mermaid
flowchart TB
  accTitle: 目录候选从计划到发布的实际调用
  accDescr: 计划严格固定闭合成员，创建或恢复仅补缺项，完整候选发布前后都核验；未知成员与字节漂移停止，不自动删除。
  planTree["planDirectoryTreeCandidate"]
  createTree["创建根、目录与文件候选"]
  partialTree["恢复：检查已存在成员"]
  missingTree["仅补 missingDirectories / missingFiles"]
  inspectTree["完整清单、模式、单链接与摘要核验"]
  publishTree["publishDirectoryTreeCandidateDurably"]
  renameTree["renameResourceDurably 同设备移动"]
  finalTree["目的目录重新按计划核验"]
  conflictTree["tree-conflict / source-changed：保留现场"]
  planTree -->|"E-TREE01-01 冻结字节与拓扑"| createTree
  planTree -->|"E-TREE01-02 同一计划恢复候选"| partialTree
  partialTree -->|"E-TREE01-03 现有字节精确一致"| missingTree
  partialTree -->|"E-TREE01-04 未知或不匹配成员"| conflictTree
  createTree -->|"E-TREE01-05 创建后检查完整性"| inspectTree
  missingTree -->|"E-TREE01-06 补齐后检查完整性"| inspectTree
  inspectTree -->|"E-TREE01-07 交给发布函数复验"| publishTree
  publishTree -->|"E-TREE01-08 原rootNode仍精确"| renameTree
  renameTree -->|"E-TREE01-09 提交后取消不截断物理复验"| finalTree
```

### 本图术语说明

| 术语 | 含义 |
| --- | --- |
| 闭合计划 | 文件排序唯一、目录由文件推导、无大小写或文件/目录冲突、明确容量和模式。 |
| 部分候选 | 只缺计划内成员；多余、变化或不安全成员是冲突，不能视作可补齐。 |
| 单设备 | 最终目录rename不能跨文件系统；复制到候选与最终发布是两种效果。 |
| rootNode | 候选目录的物理版本，用于避免换到另一棵同名树。 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-TREE01-01 | `src/foundation/filesystem/durable-directory-tree-candidate.ts#createDirectoryTreeCandidateDurably` | `tests/foundation/filesystem/durable-directory-tree-candidate.test.ts#createDirectoryTreeCandidateDurably` | 顺序建目录、文件，最终校验。 |
| E-TREE01-02 | `src/foundation/filesystem/durable-directory-tree-candidate.ts#settleDirectoryTreeCandidateDurably` | `tests/foundation/filesystem/durable-directory-tree-candidate.test.ts#settleDirectoryTreeCandidateDurably` | 恢复使用相同文件输入与计划。 |
| E-TREE01-03 | `src/foundation/filesystem/directory-tree-candidate-inspection.ts#inspectPartialDirectoryTreeCandidate` | 间接覆盖：`tests/foundation/filesystem/durable-directory-tree-candidate.test.ts#settleDirectoryTreeCandidateDurably`（只补缺项） | 存在成员额外按字节等值核对。 |
| E-TREE01-04 | `src/foundation/filesystem/directory-tree-candidate-inspection.ts#inspectDirectoryTreeCandidateProgress` | 间接覆盖：`tests/foundation/filesystem/durable-directory-tree-candidate.test.ts#settleDirectoryTreeCandidateDurably`（不匹配候选拒绝） | 未知成员不得被吞掉。 |
| E-TREE01-05 | `src/foundation/filesystem/durable-directory-tree-candidate.ts#createDirectoryTreeCandidateDurably` | `tests/foundation/filesystem/durable-directory-tree-candidate.test.ts#createDirectoryTreeCandidateDurably` | 完整清单才返回candidate回执。 |
| E-TREE01-06 | `src/foundation/filesystem/durable-directory-tree-candidate.ts#settleDirectoryTreeCandidateDurably` | `tests/foundation/filesystem/durable-directory-tree-candidate.test.ts#settleDirectoryTreeCandidateDurably` | 部分候选不能直接发布。 |
| E-TREE01-07 | `src/foundation/filesystem/durable-directory-tree-publication.ts#publishDirectoryTreeCandidateDurably` | `tests/foundation/filesystem/durable-directory-tree-publication.test.ts#publishDirectoryTreeCandidateDurably` | 发布函数重新检查计划和rootNode。 |
| E-TREE01-08 | `src/foundation/filesystem/durable-resource-rename.ts#renameResourceDurably` | 间接覆盖：`tests/foundation/filesystem/durable-directory-tree-publication.test.ts#publishDirectoryTreeCandidateDurably`（现存目的与来源漂移） | 两次观察目的缺失后调用rename；不能宣称OS级RENAME_NOREPLACE。 |
| E-TREE01-09 | `src/foundation/filesystem/durable-directory-tree-publication.ts#publishDirectoryTreeCandidateDurably` | `tests/foundation/filesystem/durable-directory-tree-publication.test.ts#publishDirectoryTreeCandidateDurably` | 移动后完整读取没有传signal；失败是commit-uncertain。 |

## 退休协议与发布协议分开

`src/foundation/filesystem/durable-directory-tree-candidate-retirement.ts#retireDirectoryTreeCandidateDurably` 要求先证明完整候选。恢复入口 `settleDirectoryTreeCandidateRetirement` 可接受已经缺失的成员，只有整根已不存在才返回 absent。

实际顺序是：按计划捕获剩余成员及hash → 逐个精确unlink文件 → 按深度从叶到根rmdir → 复验根消失。目录不空、身份变化或出现未知成员立即停止。它不使用 recursive rm，也不把任意目录当作可清理候选。各成员有独立提交点，部分退休可由同一计划续做。该保证仅适用于这组 Foundation 入口；Demand归档的活动根退休另有直接rm实现，见生命周期模块。

## 加载树迁移是可用库能力，不是自动升级流程

```mermaid
flowchart LR
  accTitle: 加载树身份到迁移发布的分责
  accDescr: 源树身份生成可移植清单，迁移计划保持可执行语义，候选复制前后复验源摘要，最终发布或匹配现有目标；候选残留阻断幂等读取。
  identityArtifact["inspectLoadedArtifactTree：清单与artifactDigest"]
  planArtifact["planLoadedArtifactTreeTransfer"]
  candidateArtifact["复制缺失文件；前后重读源身份"]
  publisherArtifact["publish入口：按同一plan读取现有状态"]
  destinationArtifact{"最终目录已存在"}
  currentArtifact["无候选残留且最终树匹配：current"]
  publishArtifact["完整候选同设备发布：published"]
  residueArtifact["candidate-residue / destination-conflict"]
  identityArtifact -->|"E-ART01-01 清单与执行位语义"| planArtifact
  planArtifact -->|"E-ART01-02 directoryPlan与copies精确对应"| candidateArtifact
  candidateArtifact -->|"E-ART01-03 首次物化后进入发布"| publisherArtifact
  publisherArtifact -->|"E-ART01-07 先检查最终目录"| destinationArtifact
  planArtifact -->|"E-ART01-08 重试直接调用publisher"| publisherArtifact
  destinationArtifact -->|"E-ART01-04 存在且复验一致"| currentArtifact
  destinationArtifact -->|"E-ART01-05 不存在"| publishArtifact
  destinationArtifact -->|"E-ART01-06 候选残留或内容不符"| residueArtifact
```

### 本图术语说明

| 术语 | 含义 |
| --- | --- |
| artifactDigest | 排序文件清单、每文件hash/字节数/可执行位组成的JCS摘要；不是发布授权。 |
| copies | 源相对路径到候选相对路径的闭合映射，不允许隐式多复制或漏复制。 |
| current | 既有最终树已经符合计划，且不存在冲突候选；不代表宿主正在加载它。 |
| 库入口 | 架构检查列明的独立生产入口；不能用“模块存在”推导已接入公开工具。 |

### 本图边级证据

| 编号 | 代码定位 | 测试 / 核验 | 关系依据 |
| --- | --- | --- | --- |
| E-ART01-01 | `src/foundation/artifact/loaded-artifact-tree-transfer-plan.ts#planLoadedArtifactTreeTransfer` | 间接覆盖：`tests/foundation/artifact/loaded-artifact-tree-transfer-publication.test.ts#planLoadedArtifactTreeTransfer`（构造真实计划） | 目录与文件mode不能破坏可执行语义。 |
| E-ART01-02 | `src/foundation/artifact/loaded-artifact-tree-transfer-candidate.ts#materializeLoadedArtifactTreeTransferCandidate` | `tests/foundation/artifact/loaded-artifact-tree-transfer-publication.test.ts#materializeLoadedArtifactTreeTransferCandidate` | 只复制缺项，且源摘要前后相等。 |
| E-ART01-03 | `src/foundation/artifact/loaded-artifact-tree-transfer-publication.ts#publishLoadedArtifactTreeTransferCandidate` | `tests/foundation/artifact/loaded-artifact-tree-transfer-publication.test.ts#publishLoadedArtifactTreeTransferCandidate` | 最终目录与候选状态分别读取。 |
| E-ART01-04 | `src/foundation/artifact/loaded-artifact-tree-transfer-publication.ts#readCurrentFinal` | 间接覆盖：`tests/foundation/artifact/loaded-artifact-tree-transfer-publication.test.ts#publishLoadedArtifactTreeTransferCandidate`（幂等最终读取） | 按directoryPlan复验全树。 |
| E-ART01-05 | `src/foundation/artifact/loaded-artifact-tree-transfer-publication.ts#publishLoadedArtifactTreeTransferCandidate` | `tests/foundation/artifact/loaded-artifact-tree-transfer-publication.test.ts#publishLoadedArtifactTreeTransferCandidate` | 不覆盖已观察到的最终树。 |
| E-ART01-07 | `src/foundation/artifact/loaded-artifact-tree-transfer-publication.ts#publishLoadedArtifactTreeTransferCandidate` | `tests/foundation/artifact/loaded-artifact-tree-transfer-publication.test.ts#publishLoadedArtifactTreeTransferCandidate` | current检查先于读取候选；不可要求先重复物化候选。 |
| E-ART01-08 | `src/foundation/artifact/loaded-artifact-tree-transfer-publication.ts#publishLoadedArtifactTreeTransferCandidate` | `tests/foundation/artifact/loaded-artifact-tree-transfer-publication.test.ts#publishLoadedArtifactTreeTransferCandidate` | 同计划的发布重放可直接从最终状态返回。 |
| E-ART01-06 | `src/foundation/artifact/loaded-artifact-tree-transfer-publication.ts#publishLoadedArtifactTreeTransferCandidate` | `tests/foundation/artifact/loaded-artifact-tree-transfer-publication.test.ts#publishLoadedArtifactTreeTransferCandidate` | 有候选残留或目的冲突则拒绝。 |

加载树身份不记录空目录本身，物理扫描仍对它们计预算。产品安装、版本选择、已运行进程更新与此处纯树能力是不同问题。

[基础总览](./README.md) · [文件发布](./file-publication-and-recovery.md) · [制品与合同生成](../17-artifacts-and-contracts/README.md)。
