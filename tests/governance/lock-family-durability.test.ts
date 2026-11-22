import { deepEqual, equal } from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { parseWakeflowDurableIdOfKind } from "../../src/contracts/identity/wakeflow-durable-id.js";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../src/foundation/time/utc-instant.js";
import { createDemandAuthority } from "../../src/governance/demand/model/demand-authority.js";
import { createDemandIdentity } from "../../src/governance/demand/model/demand-identity.js";
import { publishDemandFromPackage } from "../../src/governance/demand/publication/demand-event-sourcing-publication-service.js";
import { demandPublicationLockRef } from "../../src/governance/demand/publication/demand-publication-paths.js";
import { LEDGER_TRANSACTIONS_ROOT_REF } from "../../src/governance/ledger/ledger-authority-paths.js";
import {
  createLedgerAuthorityMemberReference,
  LedgerAuthorityStore,
} from "../../src/governance/ledger/ledger-authority-store.js";
import { materializeActiveLayout } from "../../src/kernel/active-projection.js";
import { lockCycleEvents, traceDurability } from "../support/durability-trace.js";
import {
  placePendingClaimState,
  requirementLineageOf,
} from "./demand/requirement-board.fixture.js";
import {
  FIXTURE_REQUIREMENT_ID,
  publishFixtureRequirement,
} from "./ledger/requirement-package.fixture.js";

/**
 * Level 1 (component): 治理层的两个轻档锁族经各自的生产包装走一个周期的同步（1.4.1 第 1 段清单 2.1 节
 * L6 Demand 发布锁、L7 账本记录锁；七类锁按重排计划第 3 节路丙）。
 *
 * 两把锁都经同一次请求的幂等重放来数：第一遍在真实同步的一次性根上把记录或 Demand 发布出去，第二遍
 * 同样的请求在锁内只核对、不写，计到的只有锁本身（链接前的内容 1、释放时的父目录 1）；包装退回缺省档
 * 时会多出两次父目录同步。L6 的另一个调用点（维护的运行时恢复 applyDemandRuntimeRecovery）要一个带
 * 属主已死的追加候选、配置权威与身份都齐的 Demand 根，这里不造；它的档位由登记表按调用点钉住。
 *
 * 不调用 useDisposableDurability：本文件测的就是同步。计数补丁是进程全局的，用例顺序执行。
 */

const PROGRAM_ID = parseWakeflowDurableIdOfKind(
  "program_11111111-1111-4111-8111-111111111111",
  "program",
);
const DEMAND_ID = parseWakeflowDurableIdOfKind(
  "demand_22222222-2222-4222-8222-222222222222",
  "demand",
);
const EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_44444444-4444-4444-8444-444444444444",
  "demand-event",
);
const COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_77777777-7777-4777-8777-777777777777",
  "demand-event-commit",
);
const CREATED_AT = parseUtcInstant("2026-08-26T10:00:00.000Z");
const DURABLE = { durability: "fsync" } as const;

/** 一次性目录下的工作区根与账本根，都以真实同步打开；随 `t` 结束关闭并删除。 */
async function workspaceAndLedger(t: TestContext) {
  const base = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "wakeflow-lock-family-governance-")),
  );
  mkdirSync(path.join(base, "workspace"), { mode: 0o700 });
  mkdirSync(path.join(base, "ledger"), { mode: 0o700 });
  const workspaceRoot = await RootedDirectory.open(path.join(base, "workspace"), "$root", DURABLE);
  const ledgerRoot = await RootedDirectory.open(path.join(base, "ledger"), "$root", DURABLE);
  t.after(async () => {
    await workspaceRoot.close();
    await ledgerRoot.close();
    rmSync(base, { recursive: true, force: true });
  });
  const ledgerStore = new LedgerAuthorityStore(ledgerRoot);
  await ledgerStore.initialize({ freshLedger: true });
  return Object.freeze({ base, workspaceRoot, ledgerStore });
}

test("Demand publication lock (L6) through publishDemandFromPackage replaying a published Demand", async (t) => {
  const { base, workspaceRoot, ledgerStore } = await workspaceAndLedger(t);
  await materializeActiveLayout(workspaceRoot, { recovering: false });
  const loaded = await publishFixtureRequirement(ledgerStore);
  const claim = await placePendingClaimState(workspaceRoot, loaded);
  const identity = createDemandIdentity(
    {
      programId: PROGRAM_ID,
      demandId: DEMAND_ID,
      title: "Lock family durability",
      goal: "Demand 发布锁经发布服务取轻档",
      completionDefinition: "重放只走一个轻档锁周期",
      demandType: "requirement",
      source: requirementLineageOf(loaded),
      podId: "pod_99999999-9999-4999-8999-999999999999",
    },
    { clock: () => CREATED_AT },
  );
  const authority = createDemandAuthority(identity, {
    authorityRefs: loaded.documents.map((document) =>
      createLedgerAuthorityMemberReference(loaded, document.path),
    ),
    testingDecision: { mode: "controller-only", summary: "聚焦测试", environmentMemberRef: null },
  });
  const input = {
    identity,
    authority,
    eventId: EVENT_ID,
    commitId: COMMIT_ID,
    recordedAt: CREATED_AT,
    expectedClaimStateDigest: claim.digest,
  };
  equal((await publishDemandFromPackage(workspaceRoot, ledgerStore, input)).wroteDemandRoot, true);
  const traced = traceDurability(t, base);
  let wroteDemandRoot: boolean | undefined;
  const trace = await traced(async () => {
    wroteDemandRoot = (await publishDemandFromPackage(workspaceRoot, ledgerStore, input))
      .wroteDemandRoot;
  });
  equal(wroteDemandRoot, false);
  deepEqual(trace, {
    syncCount: 2,
    directorySyncCount: 1,
    events: lockCycleEvents(`workspace/${demandPublicationLockRef(DEMAND_ID)}`, "light"),
  });
});

test("ledger record lock (L7) through the ledger store publishing an identical record again", async (t) => {
  const { base, ledgerStore } = await workspaceAndLedger(t);
  await publishFixtureRequirement(ledgerStore);
  const trace = await traceDurability(t, base)(() => publishFixtureRequirement(ledgerStore));
  deepEqual(trace, {
    syncCount: 2,
    directorySyncCount: 1,
    events: lockCycleEvents(
      `ledger/${LEDGER_TRANSACTIONS_ROOT_REF}/${FIXTURE_REQUIREMENT_ID}.lock`,
      "light",
    ),
  });
});
