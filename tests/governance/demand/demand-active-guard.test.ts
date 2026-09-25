import { equal, rejects } from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { createDemandAuthority } from "../../../src/governance/demand/model/demand-authority.js";
import { createDemandIdentity } from "../../../src/governance/demand/model/demand-identity.js";
import { assertNoActiveDemand } from "../../../src/governance/demand/publication/demand-active-guard.js";
import { publishDemandFromPackage } from "../../../src/governance/demand/publication/demand-event-sourcing-publication-service.js";
import {
  createLedgerAuthorityMemberReference,
  LedgerAuthorityStore,
} from "../../../src/governance/ledger/ledger-authority-store.js";
import { materializeActiveLayout } from "../../../src/kernel/active-projection.js";
import { WakeflowError } from "../../../src/kernel/error.js";
import { publishFixtureRequirement } from "../ledger/requirement-package.fixture.js";
import { placePendingClaimState, requirementLineageOf } from "./requirement-board.fixture.js";

const CREATED_AT = parseUtcInstant("2026-08-26T10:00:00.000Z");
const OWNER_POD_ID = "pod_99999999-9999-4999-8999-999999999999";
const OTHER_POD_ID = "pod_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** 看板上一个已认领、未到终态、属于 OWNER_POD_ID 的 Demand。 */
async function activeDemandWorkspace() {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-active-guard-"));
  const workspacePath = path.join(fixtureRoot, "workspace");
  const ledgerPath = path.join(fixtureRoot, "ledger");
  mkdirSync(workspacePath, { mode: 0o700 });
  mkdirSync(ledgerPath, { mode: 0o700 });
  const workspaceRoot = await RootedDirectory.open(workspacePath);
  const ledgerRoot = await RootedDirectory.open(ledgerPath);
  await materializeActiveLayout(workspaceRoot, { recovering: false });
  const ledgerStore = new LedgerAuthorityStore(ledgerRoot);
  await ledgerStore.initialize({ freshLedger: true });
  const loaded = await publishFixtureRequirement(ledgerStore);
  const claim = await placePendingClaimState(workspaceRoot, loaded);
  const identity = createDemandIdentity({
    programId: parseWakeflowDurableIdOfKind("program_11111111-1111-4111-8111-111111111111", "program"),
    demandId: parseWakeflowDurableIdOfKind("demand_22222222-2222-4222-8222-222222222222", "demand"),
    title: "Active Guard",
    goal: "占用一个 pod",
    completionDefinition: "保持活动",
    demandType: "requirement",
    source: requirementLineageOf(loaded),
    podId: OWNER_POD_ID,
  }, { clock: () => CREATED_AT });
  await publishDemandFromPackage(workspaceRoot, ledgerStore, {
    identity,
    authority: createDemandAuthority(identity, {
      authorityRefs: loaded.documents.map((document) => (
        createLedgerAuthorityMemberReference(loaded, document.path)
      )),
      testingDecision: { mode: "controller-only", summary: "聚焦测试", environmentMemberRef: null },
    }),
    eventId: parseWakeflowDurableIdOfKind("demand-event_44444444-4444-4444-8444-444444444444", "demand-event"),
    commitId: parseWakeflowDurableIdOfKind("demand-event-commit_77777777-7777-4777-8777-777777777777", "demand-event-commit"),
    recordedAt: CREATED_AT,
    expectedClaimStateDigest: claim.digest,
  });
  return {
    workspaceRoot,
    async cleanup() {
      await workspaceRoot.close();
      await ledgerRoot.close();
      rmSync(fixtureRoot, { recursive: true, force: true });
    },
  };
}

/** 一个真实 AbortSignal，从第 `abortFrom` 次读取 `aborted` 起报告已中止，并记录每次读取的调用栈。 */
function scriptedSignal(abortFrom: number) {
  const stacks: string[] = [];
  const signal = new AbortController().signal;
  Object.defineProperty(signal, "aborted", {
    get: () => {
      stacks.push(new Error("probe").stack ?? "");
      return stacks.length > abortFrom;
    },
  });
  return { signal, stacks };
}

test("活动守卫在读取身份记录时被中止报告io-failure/aborted而不是pod-busy", async () => {
  const workspace = await activeDemandWorkspace();
  try {
    // 校准：不中止时，另一个 pod 的守卫通过；找出身份记录读取第一次检查信号的位置。
    const calibration = scriptedSignal(Number.POSITIVE_INFINITY);
    await assertNoActiveDemand(workspace.workspaceRoot, calibration.signal, null, OTHER_POD_ID);
    const identityCheck = calibration.stacks.findIndex((stack) => stack.includes("identityPodId"));
    equal(identityCheck > 0, true);

    const scripted = scriptedSignal(identityCheck);
    await rejects(
      assertNoActiveDemand(workspace.workspaceRoot, scripted.signal, null, OTHER_POD_ID),
      (error: unknown) => (
        error instanceof WakeflowError
        && error.code === "io-failure"
        && error.reason === "aborted"
      ),
    );
    equal(scripted.stacks[identityCheck]?.includes("identityPodId"), true);
  } finally {
    await workspace.cleanup();
  }
});
