import { types } from "node:util";
import { threadId } from "node:worker_threads";

import {
  createFileCandidateDurably,
  DurableFileCandidateError,
} from "../../../foundation/filesystem/durable-file-candidate.js";
import {
  materializeDirectoryPath,
  DurableDirectoryMaterializationError,
} from "../../../foundation/filesystem/durable-directory-materialization.js";
import {
  linkRegularFileWithoutReplacement,
  DurableRegularFileLinkError,
} from "../../../foundation/filesystem/durable-regular-file-link.js";
import {
  settleRegularFileDurability,
  DurableRegularFileSettlementError,
} from "../../../foundation/filesystem/durable-regular-file-settlement.js";
import {
  unlinkRegularFileExactly,
  ExactRegularFileUnlinkError,
} from "../../../foundation/filesystem/exact-regular-file-unlink.js";
import {
  sameFileNodeIdentity,
  type FileNodeSnapshot,
} from "../../../foundation/filesystem/file-node-snapshot.js";
import type { PortableResourcePath } from "../../../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../foundation/filesystem/rooted-directory.js";
import { createUuidV4 } from "../../../foundation/identity/uuid-v4.js";
import { readNodeSystemErrorCode } from "../../../foundation/node/node-system-error.js";
import {
  admitWakeflowResourceOperation,
  WakeflowResourceProcessingContractError,
} from "../../../foundation/resource/resource-processing-contract.js";
import { encodeUtf8 } from "../../../foundation/text/utf8.js";
import {
  createDemandEventStreamCommitResourceDeclaration,
} from "../demand-resource-catalog.js";
import {
  computeDemandEventStreamCommitDigest,
  assertPreparedDemandEventStreamCommit,
  parseDemandEventStreamCommit,
  renderDemandEventStreamCommit,
  DemandEventStreamCommitError,
  type DemandEventStreamCommit,
  type PreparedDemandEventStreamCommit,
} from "./demand-event-stream-commit.js";
import {
  demandEventAppendCandidateRef,
  demandEventStreamCommitRef,
  parseDemandEventAppendCandidateFileName,
  DemandEventSourcingPathError,
  DEMAND_EVENT_APPEND_CANDIDATES_ROOT_REF,
  DEMAND_EVENT_SOURCING_ROOT_REF,
  DEMAND_EVENT_SOURCING_SNAPSHOTS_ROOT_REF,
  DEMAND_EVENT_STREAM_COMMITS_ROOT_REF,
} from "./demand-event-sourcing-paths.js";
import {
  DEMAND_FILE_EVENT_STORE_DIRECTORY_MODE,
  DEMAND_FILE_EVENT_STORE_FILE_MODE,
  DemandFileEventStoreError,
  assertDemandFileEventStoreDirectory,
  assertDemandFileEventStoreFile,
  failDemandFileEventStore as fail,
  parseDemandFileEventStoreOptions,
  sameDemandEventStreamCommit,
  type DemandFileEventStoreAppendReceipt,
  type DemandFileEventStoreCandidateRecoveryReceipt,
  type DemandFileEventStoreReadResult,
  type DemandFileEventStoreTailReadResult,
} from "./demand-file-event-store-contract.js";
import {
  assertDemandFileEventAppendAdmission,
  readAllDemandFileEventCommits,
  readDemandFileEventCommit,
  readDemandFileEventCommitAt,
  readDemandFileEventCommitOrNull,
  readDemandFileEventCommitsAfter,
  readDemandFileEventDirectory,
} from "./demand-file-event-store-reader.js";

/**
 * Wakeflow Governance / Demand Event Sourcing：受根作用域约束的本地文件事件存储。
 *
 * 本类只持有一个 Demand 根目录，并协调初始化、候选资源到不替换目标提交，以及候选
 * 资源恢复。提交清单、读取逻辑和公共合同由相邻模块负责；事件存储不执行领域决策或
 * 状态演进，不解析 Ledger/TODO 引用，也不发布 Demand 根目录。
 */

const ACTIVE_APPEND_CANDIDATE_TOKENS = new Set<string>();

function admitCommitPublication(
  commit: Readonly<DemandEventStreamCommit>,
): void {
  const declaration = createDemandEventStreamCommitResourceDeclaration(
    commit.demandId,
    commit.commitSequence,
  );
  try {
    admitWakeflowResourceOperation(
      declaration.processing,
      "exclusive-create",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowResourceProcessingContractError) {
      fail("operation-failure", "$catalog");
    }
    throw error;
  }
}

function candidateOwnerState(
  address: ReturnType<typeof parseDemandEventAppendCandidateFileName>,
): "active" | "inactive" | "unknown" {
  if (address.pid === process.pid) {
    if (address.threadId !== threadId) return "unknown";
    return ACTIVE_APPEND_CANDIDATE_TOKENS.has(address.token)
      ? "active"
      : "inactive";
  }
  try {
    process.kill(address.pid, 0);
    return "active";
  } catch (error: unknown) {
    return readNodeSystemErrorCode(error) === "ESRCH" ? "inactive" : "unknown";
  }
}

/** 持有一个 Demand root 的 Event Store I/O 作用域。 */
export class DemandFileEventStore {
  readonly #root: RootedDirectory;

  constructor(root: RootedDirectory) {
    if (
      typeof root !== "object"
      || root === null
      || types.isProxy(root)
      || !(root instanceof RootedDirectory)
    ) {
      fail("input", "$root");
    }
    this.#root = root;
  }

  /** 幂等创建文件事件存储自身拥有的四个私有目录。 */
  async initialize(options?: { readonly signal?: AbortSignal }): Promise<void> {
    const { signal } = parseDemandFileEventStoreOptions(options);
    for (const ref of [
      DEMAND_EVENT_SOURCING_ROOT_REF,
      DEMAND_EVENT_STREAM_COMMITS_ROOT_REF,
      DEMAND_EVENT_SOURCING_SNAPSHOTS_ROOT_REF,
      DEMAND_EVENT_APPEND_CANDIDATES_ROOT_REF,
    ]) {
      try {
        const result = await materializeDirectoryPath(this.#root, ref, {
          mode: DEMAND_FILE_EVENT_STORE_DIRECTORY_MODE,
          ...(signal === undefined ? {} : { signal }),
        });
        assertDemandFileEventStoreDirectory(result.node, `$${ref}`);
      } catch (error: unknown) {
        if (error instanceof DemandFileEventStoreError) throw error;
        if (error instanceof DurableDirectoryMaterializationError) {
          if (error.reason === "aborted") fail("aborted", "$signal");
          fail("operation-failure", `$${ref}`);
        }
        throw error;
      }
    }
  }

  async readCommits(
    options?: { readonly signal?: AbortSignal },
  ): Promise<Readonly<DemandFileEventStoreReadResult>> {
    const { signal } = parseDemandFileEventStoreOptions(options);
    return readAllDemandFileEventCommits(this.#root, signal);
  }

  async readCommitsAfter(
    cursor: unknown,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Readonly<DemandFileEventStoreTailReadResult>> {
    const { signal } = parseDemandFileEventStoreOptions(options);
    return readDemandFileEventCommitsAfter(this.#root, cursor, signal);
  }

  async readCommitAt(
    sequence: unknown,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Readonly<DemandEventStreamCommit> | null> {
    const { signal } = parseDemandFileEventStoreOptions(options);
    return readDemandFileEventCommitAt(this.#root, sequence, signal);
  }

  async #retireCandidate(
    ref: PortableResourcePath,
    node: Readonly<FileNodeSnapshot>,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    try {
      await unlinkRegularFileExactly(this.#root, ref, {
        expectedNode: node,
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error: unknown) {
      if (error instanceof ExactRegularFileUnlinkError) {
        if (error.reason === "aborted") fail("aborted", "$signal");
        fail("cleanup-required", "$candidate");
      }
      throw error;
    }
  }

  async #settleCommitTarget(
    ref: PortableResourcePath,
    node: Readonly<FileNodeSnapshot>,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    try {
      await settleRegularFileDurability(this.#root, ref, {
        expectedNode: node,
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error: unknown) {
      if (error instanceof DurableRegularFileSettlementError) {
        if (error.reason === "aborted") fail("aborted", "$signal");
        fail("commit-uncertain", "$commit");
      }
      throw error;
    }
  }

  /** 显式清理非活动的孤立候选、已链接残留或并发失败方。 */
  async recoverAppendCandidates(
    options?: { readonly signal?: AbortSignal },
  ): Promise<Readonly<DemandFileEventStoreCandidateRecoveryReceipt>> {
    const { signal } = parseDemandFileEventStoreOptions(options);
    const inventory = await readDemandFileEventDirectory(
      this.#root,
      DEMAND_EVENT_APPEND_CANDIDATES_ROOT_REF,
      256,
      signal,
    );
    const candidates = inventory.entries.map((entry, index) => {
      let address;
      try {
        address = parseDemandEventAppendCandidateFileName(entry.name);
      } catch (error: unknown) {
        if (error instanceof DemandEventSourcingPathError) {
          fail("candidate-conflict", `$candidates/${index}`);
        }
        throw error;
      }
      assertDemandFileEventStoreFile(
        entry.node,
        `$candidates/${index}`,
        [1n, 2n],
      );
      if (candidateOwnerState(address) !== "inactive") {
        fail("candidate-busy", `$candidates/${index}`);
      }
      return Object.freeze({ address, entry });
    });

    let committedResidueCount = 0;
    let durabilitySettledCommitCount = 0;
    let rolledBackCount = 0;
    let loserCount = 0;
    for (const [index, { address, entry }] of candidates.entries()) {
      const target = await readDemandFileEventCommitOrNull(
        this.#root,
        demandEventStreamCommitRef(address.commitSequence),
        signal,
        [1n, 2n],
      );
      let candidate;
      try {
        candidate = await readDemandFileEventCommit(
          this.#root,
          entry.resourcePath,
          entry.node,
          signal,
          `$candidates/${index}`,
          [1n, 2n],
        );
      } catch (error: unknown) {
        if (
          error instanceof DemandFileEventStoreError
          && error.reason === "stream-invalid"
          && entry.node.linkCount === 1n
        ) {
          await this.#retireCandidate(entry.resourcePath, entry.node, signal);
          rolledBackCount += 1;
          continue;
        }
        throw error;
      }
      if (
        candidate.commit.commitSequence !== address.commitSequence
        || candidate.commit.commitId !== address.commitId
      ) {
        fail("candidate-conflict", `$candidates/${index}`);
      }
      if (target === null) {
        if (entry.node.linkCount !== 1n) {
          fail("commit-uncertain", `$candidates/${index}`);
        }
        await this.#retireCandidate(entry.resourcePath, entry.node, signal);
        rolledBackCount += 1;
        continue;
      }
      const sameCommit = sameDemandEventStreamCommit(
        target.commit,
        candidate.commit,
      );
      if (entry.node.linkCount === 2n) {
        if (!sameCommit || !sameFileNodeIdentity(entry.node, target.node)) {
          fail("commit-uncertain", `$candidates/${index}`);
        }
      }
      if (sameCommit) {
        await this.#settleCommitTarget(
          demandEventStreamCommitRef(address.commitSequence),
          target.node,
          signal,
        );
        durabilitySettledCommitCount += 1;
        committedResidueCount += 1;
      } else {
        loserCount += 1;
      }
      await this.#retireCandidate(entry.resourcePath, entry.node, signal);
    }
    return Object.freeze({
      retiredCount: candidates.length,
      committedResidueCount,
      durabilitySettledCommitCount,
      rolledBackCount,
      loserCount,
    });
  }

  /** 在固定 `commitSequence` 槽位持久追加一条已经通过语义验证的提交记录。 */
  async append(
    preparedValue: Readonly<PreparedDemandEventStreamCommit>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Readonly<DemandFileEventStoreAppendReceipt>> {
    const { signal } = parseDemandFileEventStoreOptions(options);
    try {
      assertPreparedDemandEventStreamCommit(preparedValue);
    } catch (error: unknown) {
      if (error instanceof DemandEventStreamCommitError) fail("input", "$commit");
      throw error;
    }
    const commit = parseDemandEventStreamCommit(preparedValue.commit);
    admitCommitPublication(commit);
    const commitRef = demandEventStreamCommitRef(commit.commitSequence);
    const existing = await readDemandFileEventCommitOrNull(
      this.#root,
      commitRef,
      signal,
    );
    if (existing !== null) {
      if (!sameDemandEventStreamCommit(existing.commit, commit)) {
        fail("concurrency-conflict", "$commit");
      }
      return Object.freeze({
        disposition: "idempotent",
        commitSequence: commit.commitSequence,
        streamRevision: commit.lastStreamRevision,
        commitDigest: computeDemandEventStreamCommitDigest(commit),
      });
    }
    await assertDemandFileEventAppendAdmission(
      this.#root,
      preparedValue,
      signal,
    );

    const ownerToken = `${process.pid}-${threadId}-${createUuidV4()}`;
    const candidateRef = demandEventAppendCandidateRef(
      commit.commitSequence,
      commit.commitId,
      ownerToken,
    );
    let candidateNode: Readonly<FileNodeSnapshot>;
    ACTIVE_APPEND_CANDIDATE_TOKENS.add(ownerToken);
    try {
      candidateNode = (await createFileCandidateDurably(
        this.#root,
        candidateRef,
        encodeUtf8(renderDemandEventStreamCommit(commit)),
        {
          mode: DEMAND_FILE_EVENT_STORE_FILE_MODE,
          ...(signal === undefined ? {} : { signal }),
        },
      )).node;
    } catch (error: unknown) {
      ACTIVE_APPEND_CANDIDATE_TOKENS.delete(ownerToken);
      if (error instanceof DurableFileCandidateError) {
        if (error.reason === "aborted") fail("aborted", "$signal");
        if (error.reason === "target-exists") {
          fail("candidate-conflict", "$candidate");
        }
        fail("operation-failure", "$candidate");
      }
      throw error;
    }

    try {
      let linkedNode: Readonly<FileNodeSnapshot> | null = null;
      let disposition: DemandFileEventStoreAppendReceipt["disposition"] =
        "committed";
      try {
        linkedNode = (await linkRegularFileWithoutReplacement(
          this.#root,
          candidateRef,
          commitRef,
          {
            expectedSourceNode: candidateNode,
            ...(signal === undefined ? {} : { signal }),
          },
        )).sourceNode;
      } catch (error: unknown) {
        if (!(error instanceof DurableRegularFileLinkError)) {
          throw error;
        }
        const committed = await readDemandFileEventCommitOrNull(
          this.#root,
          commitRef,
          undefined,
          [1n, 2n],
        );
        if (
          committed === null
          || !sameDemandEventStreamCommit(committed.commit, commit)
        ) {
          await this.#retireCandidate(candidateRef, candidateNode, undefined);
          if (error.reason === "destination-exists") {
            fail("concurrency-conflict", "$commit");
          }
          fail("commit-uncertain", "$commit");
        }
        await this.#settleCommitTarget(commitRef, committed.node, undefined);
        linkedNode = (await readDemandFileEventCommitOrNull(
          this.#root,
          candidateRef,
          undefined,
          [1n, 2n],
        ))?.node ?? null;
        if (error.reason === "destination-exists") {
          disposition = "idempotent";
        }
      }
      if (linkedNode === null) {
        fail("commit-uncertain", "$commit");
      }
      await this.#retireCandidate(candidateRef, linkedNode, undefined);
      const committed = await readDemandFileEventCommitOrNull(
        this.#root,
        commitRef,
        undefined,
      );
      if (
        committed === null
        || !sameDemandEventStreamCommit(committed.commit, commit)
      ) {
        fail("commit-uncertain", "$commit");
      }
      return Object.freeze({
        disposition,
        commitSequence: commit.commitSequence,
        streamRevision: commit.lastStreamRevision,
        commitDigest: computeDemandEventStreamCommitDigest(commit),
      });
    } finally {
      ACTIVE_APPEND_CANDIDATE_TOKENS.delete(ownerToken);
    }
  }
}

export {
  DEMAND_FILE_EVENT_STORE_DIRECTORY_MODE,
  DEMAND_FILE_EVENT_STORE_FILE_MODE,
  DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMITS,
  DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMIT_BYTES,
  DEMAND_FILE_EVENT_STORE_MAXIMUM_TOTAL_BYTES,
  DemandFileEventStoreError,
  type DemandFileEventStoreAppendReceipt,
  type DemandFileEventStoreCandidateRecoveryReceipt,
  type DemandFileEventStoreCursor,
  type DemandFileEventStoreReadResult,
  type DemandFileEventStoreTailReadResult,
} from "./demand-file-event-store-contract.js";
