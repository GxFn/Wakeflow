import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { parseWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3.js";
import { renderWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3-document.js";
import {
  parseWakeflowDurableIdOfKind,
  type WakeflowDurableId,
} from "../../../src/contracts/identity/wakeflow-durable-id.js";
import type { Sha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { LedgerAuthorityStore } from "../../../src/governance/ledger/ledger-authority-store.js";
import { materializeWakeflowActiveLayout } from "../../../src/workspace/active/wakeflow-active-layout-materialization.js";
import { createMinimalWakeflowConfigV3 } from "../../configuration/wakeflow-config-v3.fixture.js";
import { publishFixtureRequirement } from "../ledger/requirement-package.fixture.js";
import {
  placePendingClaimState,
  type RequirementClaimStateFixture,
} from "./requirement-board.fixture.js";

export const PUBLICATION_REQUIREMENT_ID = parseWakeflowDurableIdOfKind(
  "requirement_33333333-3333-4333-8333-333333333333",
  "requirement",
);
export const PUBLICATION_SECOND_REQUIREMENT_ID = parseWakeflowDurableIdOfKind(
  "requirement_34343434-3434-4434-8434-343434343434",
  "requirement",
);
export const PUBLICATION_RECORDED_AT = parseUtcInstant(
  "2026-09-01T12:00:00.000Z",
);
/** 需求包全部成员按引用位置排序后的角色序列（`landing.md` 先于 `requirement.md`）。 */
export const PUBLICATION_PACKAGE_ROLES = ["landing", "requirement"] as const;

export interface DemandEventSourcingPublicationWorkspaceFixture {
  readonly fixtureRoot: string;
  readonly workspacePath: string;
  readonly ledgerPath: string;
  readonly workspaceRoot: RootedDirectory;
  readonly requirementId: WakeflowDurableId<"requirement">;
  readonly recordDigest: Sha256Digest;
  readonly initialClaimStateDigest: Sha256Digest;
}

/** 发布一份需求包记录并以 pending 状态放上看板。 */
export async function publishPendingPackage(
  workspaceRoot: RootedDirectory,
  ledgerPath: string,
  requirementId: WakeflowDurableId<"requirement">,
): Promise<
  Readonly<{
    readonly recordDigest: Sha256Digest;
    readonly claim: Readonly<RequirementClaimStateFixture>;
  }>
> {
  const ledgerRoot = await RootedDirectory.open(ledgerPath);
  try {
    const loaded = await publishFixtureRequirement(
      new LedgerAuthorityStore(ledgerRoot),
      { requirementId },
    );
    const claim = await placePendingClaimState(workspaceRoot, loaded);
    return Object.freeze({ recordDigest: loaded.recordDigest, claim });
  } finally {
    await ledgerRoot.close();
  }
}

/** 创建Preview、Apply和Recovery测试共用的一份待认领需求包及其Ledger记录。 */
export async function createDemandEventSourcingPublicationWorkspaceFixture(): Promise<
  Readonly<DemandEventSourcingPublicationWorkspaceFixture>
> {
  const fixtureRoot = mkdtempSync(
    path.join(os.tmpdir(), "wakeflow-demand-publication-planning-"),
  );
  const workspacePath = path.join(fixtureRoot, "Workspace");
  const ledgerPath = path.join(fixtureRoot, "wakeflow-ledger");
  const productPath = path.join(fixtureRoot, "ProductA");
  mkdirSync(workspacePath, { mode: 0o755 });
  mkdirSync(ledgerPath, { mode: 0o755 });
  mkdirSync(productPath, { mode: 0o755 });
  for (const relative of [".wakeflow-local", "Design", "Test"]) {
    mkdirSync(path.join(workspacePath, relative), { mode: 0o755 });
  }
  const config = parseWakeflowConfigV3(createMinimalWakeflowConfigV3());
  writeFileSync(
    path.join(workspacePath, "wakeflow.config.json"),
    renderWakeflowConfigV3(config),
    { mode: 0o644 },
  );
  const workspaceRoot = await RootedDirectory.open(workspacePath);
  try {
    await materializeWakeflowActiveLayout(workspaceRoot, {
      recoveringFreshLayout: false,
    });
    const ledgerRoot = await RootedDirectory.open(ledgerPath);
    try {
      await new LedgerAuthorityStore(ledgerRoot).initialize({ freshLedger: true });
    } finally {
      await ledgerRoot.close();
    }
    const published = await publishPendingPackage(
      workspaceRoot,
      ledgerPath,
      PUBLICATION_REQUIREMENT_ID,
    );
    return Object.freeze({
      fixtureRoot,
      workspacePath,
      ledgerPath,
      workspaceRoot,
      requirementId: PUBLICATION_REQUIREMENT_ID,
      recordDigest: published.recordDigest,
      initialClaimStateDigest: published.claim.digest,
    });
  } catch (error: unknown) {
    await workspaceRoot.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function cleanupDemandEventSourcingPublicationWorkspaceFixture(
  fixture: Readonly<DemandEventSourcingPublicationWorkspaceFixture>,
): Promise<void> {
  await fixture.workspaceRoot.close();
  rmSync(fixture.fixtureRoot, { recursive: true, force: true });
}

export function demandEventSourcingPublicationAuthoredDemand<
  const ExecutionPlacement,
>(executionPlacement: ExecutionPlacement) {
  return {
    title: "Demand Event Sourcing Publication",
    goal: "从看板上的需求包与Ledger生成完整revision 1计划",
    completionDefinition: "计划可精确Apply并支持前向Recovery",
    executionPlacement,
  };
}

export function demandEventSourcingPublicationUuidFactory(
  values: readonly string[],
  calls: { value: number },
) {
  return () => {
    const value = values[calls.value];
    calls.value += 1;
    if (value === undefined) throw new Error("Unexpected UUID allocation.");
    return value;
  };
}

export function demandEventSourcingPublicationPhysicalPath(
  root: string,
  ref: string,
): string {
  return path.join(root, ...ref.split("/"));
}
