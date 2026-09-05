import type { Sha256Digest } from "../../../src/foundation/crypto/sha256.js";
import type { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant, type UtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  parseRequirementLineageReference,
  type RequirementLineageReference,
} from "../../../src/governance/demand/model/requirement-lineage.js";
import type { RequirementRecord } from "../../../src/governance/ledger/ledger-authority-record.js";
import type { LoadedLedgerAuthorityRecord } from "../../../src/governance/ledger/ledger-authority-store-contract.js";
import {
  claimRequirementPackage,
  computeRequirementClaimStateDigest,
  createRequirementClaimState,
  createRequirementClaimStateFile,
  readRequirementClaimState,
  refreshRequirementBoardIndex,
  replaceRequirementClaimStateFile,
  type RequirementClaimState,
} from "../../../src/kernel/requirement-board.js";

/**
 * 看板 fixture：把已发布的需求包记录放上看板（pending），或以某个 Demand 认领它
 * （claimed，修订 2），供 demand、tasking、lifecycle 等测试直接使用内核状态机。
 */

export interface RequirementClaimStateFixture {
  readonly state: RequirementClaimState;
  readonly digest: Sha256Digest;
}

/** 发布即上板：修订 1 的 pending 状态加索引重写。 */
export async function placePendingClaimState(
  workspaceRoot: RootedDirectory,
  loaded: Readonly<LoadedLedgerAuthorityRecord<RequirementRecord>>,
): Promise<Readonly<RequirementClaimStateFixture>> {
  const state = createRequirementClaimState({
    requirementId: loaded.record.requirementId,
    programId: loaded.record.programId,
    recordDigest: loaded.recordDigest,
    title: loaded.record.title,
    demandType: loaded.record.demandType,
    priority: loaded.record.priority,
    publishedAt: parseUtcInstant(loaded.record.recordedAt),
    supersedes: loaded.record.supersedes,
    parkedTrigger: null,
  });
  await createRequirementClaimStateFile(workspaceRoot, state);
  await refreshRequirementBoardIndex(workspaceRoot);
  return Object.freeze({ state, digest: computeRequirementClaimStateDigest(state) });
}

/** 以 Demand 认领看板上的 pending 包：整文件 CAS 替换到修订 2，然后重写索引。 */
export async function claimFixtureRequirement(
  workspaceRoot: RootedDirectory,
  requirementId: string,
  demandId: string,
  at: UtcInstant,
): Promise<Readonly<RequirementClaimStateFixture>> {
  const source = await readRequirementClaimState(workspaceRoot, requirementId);
  if (source === null) throw new Error("Expected a pending claim state fixture.");
  const next = claimRequirementPackage(source.state, demandId, at);
  await replaceRequirementClaimStateFile(
    workspaceRoot,
    { digest: source.digest, read: source.read },
    next,
  );
  await refreshRequirementBoardIndex(workspaceRoot);
  return Object.freeze({ state: next, digest: computeRequirementClaimStateDigest(next) });
}

/** Demand identity 使用的需求包谱系引用。 */
export function requirementLineageOf(
  loaded: Readonly<LoadedLedgerAuthorityRecord<RequirementRecord>>,
): Readonly<RequirementLineageReference> {
  return parseRequirementLineageReference({
    artifactKind: "wakeflow-requirement-lineage",
    schemaVersion: 1,
    requirementId: loaded.record.requirementId,
    recordRef: loaded.recordRef,
    recordDigest: loaded.recordDigest,
  });
}
